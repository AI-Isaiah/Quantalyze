"""Mt5Client — a narrow, SYNCHRONOUS, READ-ONLY facade over a MetaTrader 5
terminal reached as a pure network client via `mt5linux.MetaTrader5` (RPyC).

MT5GW-02 contract. The worker NEVER imports the Windows-only `MetaTrader5`
package in-process; it wraps the RPyC proxy behind this typed interface, the same
isolation posture SfoxClient uses for its aiohttp session. Downstream phases 135
(Source registration / validate) and 136 (equity reconstruction) stub against the
shape defined here, so the disciplines below are load-bearing.

Contract:

  * Surface (read-only by CONSTRUCTION) — `login`, `account_info`,
    `terminal_info`, `history_deals_get`, `order_check` (probe only), `close`,
    `release`.
    Read-only is a STRUCTURAL property, not a probed scope claim: the underlying
    `mt5linux` client exposes the FULL trading surface (order_send,
    positions_get, orders_get, ...), but this facade composes ONLY the read
    methods plus the order_check probe and NEVER wraps the trade path. There is
    NO generic attribute-forwarding passthrough (no dunder getattr hook) — such a
    facade would silently re-expose that trade path and defeat the whole
    `api_verified` trust story. The forbidden trade method (referred to here
    without call parentheses so the grep gate stays clean) is absent.
    `terminal_info` (153.3 / D-31) reads OUR terminal: a READ-surface widening.

  * Return discipline (fail-loud, no invented data) — every read distinguishes
    `None` (RPyC/terminal error -> capture `last_error()` IMMEDIATELY and raise a
    typed `Mt5ClientError` carrying the (code, text)) from `()` (an honest empty
    result). Conflating them fabricates a flat/empty account — the highest-severity
    correctness pitfall for this source. A degenerate (non-namedtuple) shape also
    raises. `last_error()` must be read immediately because the next remote call
    overwrites it.

  * Materialization (netref -> native) — RPyC returns namedtuples as live netref
    proxies. Every structured read is materialized to a plain native dict via
    `._asdict()` before returning, so a caller never holds a proxy that dies with
    the connection.

  * Dual timeout (Pitfall 3 / T-134-04) — there are TWO independent timeouts and
    their ORDERING matters:
      - `MT5_REQUEST_TIMEOUT_S` sets the rpyc `sync_request_timeout` (via the
        mt5linux constructor `timeout=`): how long the worker waits for a remote
        round-trip before rpyc raises. Its implicit default is 300s — a hung
        terminal would block the SEQUENTIAL worker for 5 minutes, far past the
        ~90s healthz budget (the v1.11 WEDGE-01 failure class).
      - EVERY MT5 call that carries its own `timeout=` (milliseconds) is
        registered in `MT5_IPC_TIMEOUTS_MS` — `initialize` and `login` today —
        and each one MUST stay strictly BELOW the rpyc timeout, so MT5 fails its
        own pipe first and rpyc surfaces a clean error instead of a raw abort.
        The ordering is enforced for the WHOLE table at construction (153.3 /
        D-24); it used to be enforced for `login` alone, and the unregistered
        `initialize()` — running on MetaTrader5's vendor default of 60 000ms,
        2x the rpyc bound — is what censored 9/9 production logins at the 30s
        ceiling (2026-08-06/08).
    The chain is PER-INSTANCE: `request_timeout_s` and the per-call `*_timeout_ms`
    ctor overrides let an interactive caller build a LONGER chain without moving
    the module constants, which the SEQUENTIAL worker depends on staying at 30s
    (D-25).
    The outer `asyncio.to_thread` + `asyncio.wait_for` event-loop bound is a Phase
    136/137 worker-seam concern, NOT part of this synchronous, blocking client.

  * Teardown — TWO names, ONE implementation (153.3 / D-30 then D-35), because
    "I am done with the terminal" and "the terminal's IPC pipe should die" are NOT
    the same statement, and only the FIRST of them is ever ours to make:
      - `release()` and `close()` both end OUR use of the terminal. They latch
        `_closed`, close the rpyc TRANSPORT (our socket), and call `shutdown()`
        ZERO times. Both delegate to `_teardown_transport`, so the two public
        names cannot drift apart.
      - `mt5.shutdown()` ends the terminal's IPC attachment for EVERY caller of
        that gateway process — `mt5linux` serves every rpyc connection from ONE
        `ThreadedServer` process sharing ONE `MetaTrader5` module instance and ONE
        IPC pipe (153-EVIDENCE-mt5-platform §A2 / Correction C-1), so a concurrent
        caller then observes `-10004 No IPC connection`. D-30 took that call off
        the REQUEST path; **D-35 removed it from `close()` altogether**, which
        fixes the worker paths (`services/exchange.py`'s `aclose_exchange` mt5
        arm, `services/ingestion/mt5.py`'s adapter `finally`) at the SINK, with
        zero call-site edits.
      - The ONE surviving `shutdown()` is `restart()`'s deliberate heal of a
        genuinely wedged pipe (MT5CONC-01). It is lease-held at every call site,
        and `tests/test_mt5_shutdown_roster.py` derives that from source rather
        than believing it.
    We are NOT reclaiming a per-request resource by never calling it: per EVIDENCE
    §A6 `shutdown()` "closes the IPC connection. It does not close the terminal,
    does not log the account out, and does not reset terminal state." Attaching
    once and never tearing down is the EVIDENCE's own recommendation, not an
    oversight.

  * Secret hygiene (T-134-01) — the login / investor password / broker server
    NEVER appear in any exception message or log surface. `mt5linux`
    f-string-interpolates the password into the remotely-eval'd code, so a leaked
    error string is a real credential disclosure; every error detail passes
    through `services.redact.scrub_freeform_string` at `Mt5ClientError`
    construction, and the interpolated remote `code` string is never logged.

  * Instrumentation (153.3 / D-32) — EVERY MT5 round-trip is bracketed by
    `_timed()` and emits a structlog `mt5.stage` event carrying `stage` +
    `duration_ms`, on the SUCCESS path and on the FAILURE path alike. Before this
    the client contained no clock at all, which is why no uncensored measurement
    of a successful MT5 call existed anywhere: the only timer in the system was
    the timeout, so every recorded number was right-censored at a ceiling.
    ⛔ The event's field set is a CLOSED ALLOW-LIST (`emit_mt5_stage_event`) —
    stage, duration_ms, ok, error_class, terminal_key, outcome — precisely so the
    secret-hygiene rule above cannot be violated by a future caller passing
    "just a bit of context". The exception CLASS name is emitted; its MESSAGE is
    not, because a remote traceback carries the interpolated password.

  * Transport security (T-134-03, constraint documented; hardening owned by Phase
    139) — `mt5linux` speaks rpyc classic / SlaveService, an UNAUTHENTICATED
    arbitrary-remote-code channel. The bridge MUST only ever be reachable over a
    PRIVATE network (Railway internal / WireGuard / SSH tunnel), NEVER a public
    port.
"""
from __future__ import annotations

import logging
import os
import time
from contextvars import ContextVar, Token
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable, Final, NoReturn, TypeVar, cast

import structlog

from services.redact import scrub_freeform_string

logger = logging.getLogger("quantalyze.analytics")

_T = TypeVar("_T")

# --------------------------------------------------------------------------- #
# 153.3 / D-32 — MT5 STAGE TELEMETRY. The measurement this system has never had.
#
# WHY it exists: nine correlated gateway<->worker failures (2026-08-06/08) were
# ALL right-censored at the rpyc ceiling, and no successful stage duration has
# ever been recorded — not in Railway, not in Sentry, not in docs/evidence/. The
# 45 000ms / 55s / 60s / 75s / 20s / 10s validate chain is therefore PROVISIONAL,
# derived from vendor defaults and a client ceiling rather than from data
# (D-27). These events are what lets **Phase 155 (MT5-VERIFY)** replace that
# judgement with a real p50/p95. ⛔ This plan MEASURES and does not TUNE: moving a
# timeout in the same change that first measured it destroys the before/after.
#
# STAGE NAMING CONVENTION — stage names are the MT5 call name verbatim
# (`initialize`, `login`, `account_info`, `terminal_info`, `history_deals_get`,
# `order_check`, `close`, `release`, `restart`, plus `last_error` for the error
# round-trip). They are an AGGREGATION KEY across deploys: a rename silently
# splits a Phase-155 histogram in two, so rename only with that cost in mind. The
# router adds `lease_wait` and `validate` on the same event name.
#
# 🔒 The field set below is a CLOSED ALLOW-LIST and that is the whole hygiene
# mechanism. `terminal_key` (host:port) is OUR infrastructure identity — already
# the process-wide lock key — never a user value. NEVER add a parameter that can
# carry a login, an investor password, a broker server, `last_error()` text or
# the interpolated remote `code` string: `mt5linux` f-string-interpolates the
# password into the remotely-eval'd source, so exception TEXT is a credential
# disclosure surface (T-134-01 / T-153.3-23). Only the exception CLASS is safe.
# --------------------------------------------------------------------------- #
MT5_STAGE_EVENT = "mt5.stage"
_STAGE_LOGGER_NAME = "quantalyze.mt5"


def _stage_logger() -> Any:
    """Bind the stage logger PER CALL rather than once at import.

    ⚠️ Not a style choice. `services/logging_config.py` configures structlog with
    ``cache_logger_on_first_use=True``, so a module-level
    ``structlog.get_logger(...)`` proxy freezes the processor chain that happened
    to be installed at its FIRST use and ignores every later
    ``structlog.configure``. A module imported before the process configures its
    logging — which is this one: `main.py` configures inside the lifespan, long
    after import — would then emit through a stale chain, i.e. WITHOUT the
    `_redact_processor` PII scrub the configured pipeline installs. Binding here
    costs a proxy allocation next to a network round-trip and cannot go stale.
    (It is also what makes the events observable to `structlog.testing`.)
    """
    return structlog.get_logger(_STAGE_LOGGER_NAME)


def emit_mt5_stage_event(
    stage: str,
    started_at: float,
    *,
    ok: bool,
    terminal_key: str | None = None,
    error_class: str | None = None,
    outcome: str | None = None,
) -> None:
    """Emit ONE structured `mt5.stage` event for a bracketed MT5 stage.

    `started_at` is a `time.perf_counter()` reading taken before the call; the
    duration is computed here so no call site can get the arithmetic wrong or
    emit a duration in the wrong unit.

    Fields are STRUCTURED, never interpolated into a message string — the entire
    point is that Phase 155 can aggregate `duration_ms` by `stage` and by `ok`
    rather than regex a prose line. `ok=False` events carry the exception CLASS
    name so a 30s censor (a timeout class, duration at the ceiling) is separable
    from a fast rejection in a single Railway query.

    ⛔ NEVER raises. Instrumentation must not change what a caller observes
    (T-153.3-24): a logging pipeline fault must not turn a successful terminal
    read into a failed validate. A failure here is reported once, loudly, on the
    stdlib logger — never swallowed silently.
    """
    fields: dict[str, Any] = {
        "stage": stage,
        "duration_ms": int((time.perf_counter() - started_at) * 1000),
        "ok": ok,
    }
    if terminal_key is not None:
        fields["terminal_key"] = terminal_key
    if error_class is not None:
        fields["error_class"] = error_class
    if outcome is not None:
        fields["outcome"] = outcome
    try:
        _stage_logger().info(MT5_STAGE_EVENT, **fields)
    except Exception:  # noqa: BLE001 — telemetry must never break the path it measures
        logger.warning("emit_mt5_stage_event: stage telemetry failed to emit.")

# rpyc `sync_request_timeout` (seconds). rpyc 5.x's own DEFAULT_CONFIG default is
# 30s (NOT 300s — that is mt5linux 0.1.10's hardcode, and we pin 0.1.9), so an
# unset knob would already bound a hung terminal at 30s; we set it EXPLICITLY on
# the connection (see `_default_connect`) so this env var, not the rpyc default,
# governs the wire. A hung terminal must not wedge the SEQUENTIAL worker past the
# ~90s healthz budget (v1.11 WEDGE-01); 30s is comfortably above normal MT5 read
# latency yet well under the healthz budget, so a stalled bridge fails loud fast.
MT5_REQUEST_TIMEOUT_S = float(os.getenv("MT5_REQUEST_TIMEOUT_S", "30"))

# The rpyc `sync_request_timeout` for the INTERACTIVE validate chain (153.3 /
# D-25), deliberately SEPARATE from the worker's 30s above rather than a raise of
# it. Two reasons, and both are load-bearing:
#   * ⛔ MT5_REQUEST_TIMEOUT_S must NOT move. It bounds the SEQUENTIAL worker, where
#     a hung terminal held past the ~90s healthz budget is the v1.11 WEDGE-01
#     wedge class. A "harmonised" single constant buys the validate path its
#     headroom by re-arming that wedge for every job.
#   * The validate path needs the headroom because MetaQuotes budgets 60 000ms for
#     `initialize()`/`login()` (the vendor default), and our 20s IPC / 30s rpyc
#     pair truncated the legitimate tail of a real interactive login — a login that
#     WOULD have answered was censored by our own ceiling (EVIDENCE Correction
#     C-3). 55s carries a 45 000ms IPC ceiling with 10s of rpyc headroom.
# A caller opts in by passing `request_timeout_s=MT5_VALIDATE_REQUEST_TIMEOUT_S`
# together with the matching per-call IPC overrides; a construction that passes
# nothing still gets the worker's chain.
MT5_VALIDATE_REQUEST_TIMEOUT_S = float(os.getenv("MT5_VALIDATE_REQUEST_TIMEOUT_S", "55"))

# MT5's own IPC pipe timeout (milliseconds) passed to login(timeout=...). MUST
# stay strictly BELOW MT5_REQUEST_TIMEOUT_S (converted to ms) so MT5 fails its
# own pipe first and rpyc surfaces a clean error rather than a raw mid-handshake
# abort (Pitfall 3 / T-134-04). 20000ms < 30_000ms with headroom.
MT5_LOGIN_TIMEOUT_MS = int(os.getenv("MT5_LOGIN_TIMEOUT_MS", "20000"))

# MT5's own IPC pipe timeout (milliseconds) passed to initialize(timeout=...).
# 153.3 / D-24 — THE ROOT CAUSE this constant exists to delete: MetaTrader5's
# vendor default for `initialize(timeout=...)` is 60000ms, i.e. 2x the 30000ms
# rpyc bound above. Left unset, the FIRST MT5 call of every login is structurally
# incapable of returning an MT5-level answer before rpyc gives up — which is why
# all 9/9 correlated gateway<->worker failures on 2026-08-06/08 clustered at
# 30.1-31.0s (a fixed ceiling, not a latency distribution). Like the login value
# it MUST stay strictly below the EFFECTIVE request_timeout_s (the ctor arg, not
# necessarily the module constant); the guard in __init__ enforces that.
MT5_INITIALIZE_TIMEOUT_MS = int(os.getenv("MT5_INITIALIZE_TIMEOUT_MS", "20000"))

# The registry of every MT5 call that carries its OWN `timeout=` (milliseconds),
# mapped to its default value.
#
# ⛔ ANY MT5 call that carries its own timeout MUST appear here. Both the
# construction-time ordering guard (`Mt5Client.__init__`) and the source-derived
# completeness test (`tests/test_mt5_client_contract.py`) read this table, so a
# call bound OUTSIDE it is unguarded and untested — which is exactly the D-24
# defect: `initialize()` was bound nowhere, the guard covered `login()` only, and
# the resulting inversion censored every production verdict for months.
MT5_IPC_TIMEOUTS_MS: dict[str, int] = {
    "initialize": MT5_INITIALIZE_TIMEOUT_MS,
    "login": MT5_LOGIN_TIMEOUT_MS,
}

# --------------------------------------------------------------------------- #
# WIZFORM-ABANDON / D-36 (AMENDED) — THE TERMINAL EPOCH REGISTRY.
#
# WHY it exists: `asyncio.to_thread` work OUTLIVES its `asyncio.wait_for`. Python
# threads cannot be interrupted, so when the bound fires the caller unwinds and
# RELEASES the terminal lease while the abandoned thread keeps driving the SAME
# process-global MT5 session — under the NEXT holder's lease. The generation
# counter below is the sink that fences those zombies: the lease bumps a
# terminal's generation on release, and every session-touching method checks its
# own bound generation FIRST and refuses on a stale one (`Mt5Client._assert_live`).
#
# ⛔ It lives HERE, in `mt5_client.py`, and NOT in `mt5_concurrency.py`, for two
# independent reasons and either alone is decisive:
#   * the import edge is strictly ONE-WAY — `mt5_concurrency.py` imports from this
#     module, whose only in-tree import is `services.redact`, so a registry over
#     there that this module had to read would be a circular import;
#   * `mt5_terminal_lease(terminal_key: str, ...)` receives a STRING and nothing
#     else. It holds no client reference and structurally cannot bump an instance
#     attribute — which is also why the epoch is keyed by `terminal_key` rather
#     than carried per-instance. The lease imports `bump_mt5_terminal_epoch`.
#
# Keyed by `terminal_key` (host:port — OUR infrastructure identity, the same key
# `_MT5_TERMINAL_LOCKS` already uses), so every client built against the ONE
# shared Wine terminal reads the SAME generation.
#
# The dict grows unboundedly BY DESIGN (the same rationale as the terminal-lock
# registry it mirrors): evicting a generation would silently reset a live client's
# comparison to "fresh" and un-fence exactly the zombie this exists to catch, and
# terminal cardinality is bounded anyway (v1 = ONE gateway terminal, O(1) keys).
#
# ⛔ CROSS-THREAD, DELIBERATELY LOCK-FREE. `_assert_live` runs on an
# `asyncio.to_thread` worker while the event-loop thread writes this dict from the
# lease's `finally`. `dict.get` and `dict.__setitem__` on an `int` are single
# bytecodes under the GIL, so the read can observe the old or the new generation
# but never a torn one — and either observation is correct (it is precisely the
# release the fence is racing). Do NOT add a `threading.Lock`: it would put a lock
# on the hot path of every MT5 round-trip AND raise a lock-ORDERING question
# against the terminal lease that does not exist today.
# --------------------------------------------------------------------------- #
_MT5_TERMINAL_EPOCHS: dict[str, int] = {}


def _mt5_epoch_for(terminal_key: str) -> int:
    """The current generation of one terminal. Unknown key -> generation 0.

    ⛔ `dict.get` with a default, NEVER `setdefault`: a READ must not mint a
    registry entry. `_assert_live` calls this on every session touch, and a read
    that wrote would make the "grows unboundedly by design" note above a claim
    about traffic rather than about terminals.
    """
    return _MT5_TERMINAL_EPOCHS.get(terminal_key, 0)


def bump_mt5_terminal_epoch(terminal_key: str) -> int:
    """Advance one terminal's generation and return the new value.

    PUBLIC (no leading underscore) because it deliberately crosses a module
    boundary: `services.mt5_concurrency.mt5_terminal_lease` calls it from its
    `finally`, and the worker's raw-lock call sites call it on their own release
    paths. Everything else about the epoch is private to this module.
    """
    nxt = _MT5_TERMINAL_EPOCHS.get(terminal_key, 0) + 1
    _MT5_TERMINAL_EPOCHS[terminal_key] = nxt
    return nxt


def _reset_mt5_epochs_for_tests() -> None:
    """Clear the epoch registry between tests (RESEARCH Pitfall 8).

    Five test modules already hand-clear `_MT5_TERMINAL_LOCKS`; a leaked EPOCH
    would be a sixth flake mechanism under `-n auto --dist loadgroup` (a bump from
    one test fencing a client built by the next). ⛔ Not called from production
    code, and not to be: it is reached through the ONE shared
    `mt5_concurrency.reset_terminal_state_for_tests()` so a future third registry
    has exactly one home to be added to.
    """
    _MT5_TERMINAL_EPOCHS.clear()


# --------------------------------------------------------------------------- #
# WIZFORM-ABANDON / D-36 AMENDED (ii) — LEASE OCCUPANCY.
#
# The epoch above fences METHOD CALLS. It cannot fence CONSTRUCTION: in findings
# #6a/#6b the abandoned thread is parked inside `Mt5Client.__init__`'s blocking
# connect and makes no subsequent session call, so there is no method for a guard
# to sit in front of. This ContextVar is the other half — the construction fence
# reads it (plan 02).
#
# WHY a ContextVar rather than a construction-time epoch snapshot: `to_thread`
# copies the caller's `contextvars.Context` at spawn and `wait_for`'s task
# inherits it, so an abandoned thread keeps carrying the OLD occupancy tuple while
# the registry moves on. Critically it also removes a FALSE POSITIVE
# structurally: `job_worker._make_mt5_session` builds its client in PREFLIGHT,
# outside and before the lease, so it carries NO token and is exempt — not as a
# special case someone maintains, but as the honest encoding of "this construction
# is not happening under anyone's lease".
#
# ⛔ The default is an immutable `None`, never a mutable container: a mutable
# ContextVar default is shared by every context that never `set()` it, so a caller
# that mutated it in place would corrupt every other request
# (the `services/exchange.py:56-69` trap).
#
# ⛔ It lives in THIS leaf for the same one-way-import reason as the registry:
# `mt5_concurrency` imports FROM `mt5_client`, never the reverse.
# --------------------------------------------------------------------------- #
_MT5_LEASE_OCCUPANCY: ContextVar[tuple[str, int] | None] = ContextVar(
    "mt5_lease_occupancy", default=None
)


def begin_mt5_lease_occupancy(terminal_key: str) -> Token[tuple[str, int] | None]:
    """Stamp the current context as operating under a lease on `terminal_key`.

    The stamped generation is the one CURRENT AT ACQUISITION, so a construction
    fence can tell "built under the lease that is still running" from "built under
    a lease that has since released" (the zombie).
    """
    return _MT5_LEASE_OCCUPANCY.set((terminal_key, _mt5_epoch_for(terminal_key)))


def end_mt5_lease_occupancy(token: Token[tuple[str, int] | None]) -> None:
    """Un-stamp the caller's context via the Token the `begin` returned.

    `Token.reset` (not `set(None)`) so nested leases restore the OUTER value
    rather than flattening it — the same discipline `logging_config.py:43` uses.
    """
    _MT5_LEASE_OCCUPANCY.reset(token)


class Mt5ClientError(RuntimeError):
    """Fail-loud typed error carrying the MT5 `(code, text)` from `last_error()`.

    Carries `self.code` so callers (Phase 135 validate branch) can distinguish
    auth/server failures from transient errors. The message NEVER contains a
    secret; the detail text is scrubbed via `scrub_freeform_string` at
    construction (T-134-01).
    """

    def __init__(self, code: int, detail: str) -> None:
        self.code = code
        super().__init__(f"MT5 client error (code={code}): {scrub_freeform_string(detail)}")


class Mt5AccountMismatchError(Exception):
    """MT5CONC-02 — the live terminal presented an account whose ``login`` does NOT
    match the connected key's expected login (or omitted the field entirely).

    Deliberately a PLAIN ``Exception``, NOT an ``Mt5ClientError`` subclass: a
    mismatch is a mis-routed/stale-terminal INFRA fault, never a user-credential
    fault, so the job-worker's ``except Mt5ClientError`` classify/stamp arm (which
    can write a user-attributed permanent ``failed`` analytics row) must be
    structurally UNABLE to absorb it. It routes instead to a dedicated no-stamp,
    no-persist, transient+restart branch — THE guarantee that ``api_verified`` is
    never stamped on the wrong account's numbers.

    Secret hygiene: the message carries ONLY the two login values (an account
    number is an ``int``, not a secret). The broker server and password are NEVER
    interpolated, so — unlike ``Mt5ClientError`` — no scrubbing dependency applies
    (nothing freeform enters the message).
    """

    def __init__(self, expected: object, actual: object) -> None:
        self.expected = expected
        self.actual = actual
        super().__init__(
            f"MT5 account mismatch: expected login {expected}, "
            f"terminal presented {actual}"
        )


# The refusal message is a FIXED string and MUST stay one — see
# `Mt5SessionAbandoned` below for why interpolating the stage would be a defect.
_MT5_SESSION_ABANDONED_MESSAGE: Final[str] = (
    "MT5 session abandoned: the lease under which it operated has ended"
)


class Mt5SessionAbandoned(Exception):
    """WIZFORM-ABANDON / D-36 — a session touch arrived from work that OUTLIVED
    its `asyncio.wait_for`, after the lease it began under had already released.

    Deliberately a PLAIN ``Exception``, NOT an ``Mt5ClientError`` subclass — the
    same discipline as ``Mt5AccountMismatchError`` above and
    ``Mt5TerminalBusyError`` / ``_Mt5PostReadVerificationError`` in
    ``mt5_concurrency``, and for the same structural reason: the credential
    classify/stamp arms match on ``Mt5ClientError``, so a fence refusal that
    inherited from it could be absorbed into a USER-ATTRIBUTED verdict
    (``auth`` / ``wrong_server``) and blame a working key for OUR abandoned
    thread. Plain ``Exception`` makes that structurally impossible rather than
    carefully avoided.

    ⛔ THE MESSAGE IS FIXED AND CARRIES NO STAGE (D-42). The classifier matches by
    SUBSTRING against ``_WRONG_SERVER_TOKENS`` / ``_AUTH_TOKENS``
    (``services/mt5_validation.py:66-83``), and the fenced stage names are
    themselves members of those tables — ``terminal_info`` and ``connect`` contain
    ``terminal``/``connect``, ``login`` and ``account_info`` contain
    ``login``/``account``. Interpolating the stage would therefore re-run the
    documented ``routers/exchange.py:678-684`` incident, where an operator-side
    refusal became a 400 telling the user their BROKER SERVER was wrong. The stage
    is kept as an ATTRIBUTE (``self.stage``) for the callers that route on it, and
    it is safe in the fence's WARNING log — a log line is never classified.

    ⛔ It carries no host, port, terminal key, credential or generation number: the
    abandoned lease is OUR infrastructure and nothing about it may reach a
    response body (WIZFORM-03 / T-134-01).
    """

    def __init__(self, stage: str) -> None:
        self.stage = stage
        super().__init__(_MT5_SESSION_ABANDONED_MESSAGE)


def _default_connect(*, host: str, port: int, timeout: float) -> Any:
    """Construct the real `mt5linux.MetaTrader5` transport.

    The `mt5linux` import is LAZY — inside this function body only — so importing
    `services.mt5_client` does not require the package. `mt5linux` is not installed
    until the plan 134-03 human-verify gate clears; a module-level import would red
    the whole analytics suite in CI today.

    mt5linux 0.1.9's constructor is ``MetaTrader5(host, port)`` ONLY — it hardwires
    ``rpyc.classic.connect(host, port)`` internally with NO ``timeout=`` knob (that
    param exists only in >=0.1.10, which we deliberately pin OUT — the 0.1.10
    ``shell=True`` server regression, see the go-live runbook / gateway constraint).
    Passing ``timeout`` as a third positional raised ``TypeError`` on EVERY real
    connect (masked in CI: the contract tests inject a ``_connect`` double and
    mt5linux is never installed). So construct with ``(host, port)`` and set the
    rpyc ``sync_request_timeout`` directly on the private connection — the only knob
    0.1.9 exposes — so ``MT5_REQUEST_TIMEOUT_S`` actually governs the wire (its own
    default is 30s, NOT 300s).
    """
    from mt5linux import MetaTrader5  # type: ignore[import-not-found]  # noqa: PLC0415 — intentional lazy transport import

    mt5 = MetaTrader5(host, port)
    # ponytail: name-mangled private attr (`__conn`) + rpyc-internal `_config`;
    # stable because mt5linux is pinned ==0.1.9 and rpyc `_config` is stable across
    # the 5.x line. This is the ONLY per-request timeout knob 0.1.9 exposes.
    mt5._MetaTrader5__conn._config["sync_request_timeout"] = timeout
    return mt5


def _epoch_bound(ts: Any) -> Any:
    """Coerce a history-window bound to int epoch seconds for mt5linux 0.1.9's
    datetime-less remote eval (see `Mt5Client.history_deals_get`): a `datetime` bound
    would f-string-interpolate as `datetime.datetime(...)` and remote-NameError.
    `datetime` -> `int(timestamp())`; int/float -> int; anything else unchanged (a
    surprising type fails loud downstream rather than being silently mangled)."""
    if isinstance(ts, datetime):
        return int(ts.timestamp())
    if isinstance(ts, bool):  # bool is an int subclass — never a valid epoch bound
        return ts
    if isinstance(ts, (int, float)):
        return int(ts)
    return ts


def _coerce(value: Any) -> Any:
    """Coerce a materialized field to a native scalar. Pass int/float/str/bool/None
    through; stringify anything else so a netref scalar never leaks to the caller."""
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    return str(value)


def _materialize(obj: Any) -> dict[str, Any]:
    """Materialize a netref namedtuple to a native dict. Fail loud on a degenerate
    (non-namedtuple) shape — never coerce it into an empty/partial dict."""
    asdict = getattr(obj, "_asdict", None)
    if asdict is None:
        raise Mt5ClientError(0, "MT5 returned a non-namedtuple/degenerate shape")
    return {str(k): _coerce(v) for k, v in asdict().items()}


class Mt5Client:
    """Read-only narrowing facade over `mt5linux.MetaTrader5` (RPyC). Synchronous
    by construction — rpyc classic is blocking. See module docstring."""

    def __init__(
        self,
        host: str,
        port: int,
        *,
        _connect: Callable[..., Any] | None = None,
        request_timeout_s: float = MT5_REQUEST_TIMEOUT_S,
        initialize_timeout_ms: int | None = None,
        login_timeout_ms: int | None = None,
    ) -> None:
        # Resolve the PER-INSTANCE IPC-timeout chain (153.3 / D-25). The module
        # constants are the defaults, so a construction that passes no override is
        # byte-identical in behaviour to the pre-153.3 client — which is what keeps
        # job_worker.py, services/ingestion/mt5.py and scripts/mt5_spike.py (all of
        # which build `Mt5Client(host, port)`) on the worker's 30s chain. The
        # INTERACTIVE validate path is the caller that supplies longer values,
        # together with a longer `request_timeout_s`; raising the module constants
        # instead would lengthen the SEQUENTIAL worker's chain too and reopen the
        # v1.11 WEDGE-01 wedge class (a hung terminal past the ~90s healthz budget).
        # Resolution starts from the registry, so a call added to MT5_IPC_TIMEOUTS_MS
        # is carried on its default even before it earns a ctor override.
        ipc_timeouts_ms: dict[str, int] = dict(MT5_IPC_TIMEOUTS_MS)
        for _call_name, _override in (
            ("initialize", initialize_timeout_ms),
            ("login", login_timeout_ms),
        ):
            if _override is not None:
                ipc_timeouts_ms[_call_name] = _override

        # Enforce the load-bearing dual-timeout ORDERING (Pitfall 3 / T-134-04)
        # where the effective values finally meet: EVERY MT5 IPC timeout (ms) MUST
        # stay strictly BELOW the rpyc sync_request_timeout (s -> ms) so MT5 fails
        # its own pipe first and rpyc surfaces a clean error instead of a raw
        # mid-handshake abort. A too-small request_timeout_s (ctor arg or a low
        # MT5_REQUEST_TIMEOUT_S env) silently inverts it and reopens the v1.11
        # WEDGE-01 wedge class, so fail loud at construction rather than at a hung
        # live login.
        #
        # 153.3 / D-24: this guard used to check MT5_LOGIN_TIMEOUT_MS ALONE — the
        # instance its author had in mind — while `initialize()` ran unbound on
        # MetaTrader5's 60000ms vendor default, 2x the rpyc bound. That inversion is
        # what censored 9/9 correlated gateway<->worker failures at 30.1-31.0s on
        # 2026-08-06/08: the first MT5 call could not physically answer in time. The
        # guard therefore covers the whole CLASS — every entry of the per-instance
        # table resolved above — and the contract suite derives the set of
        # timeout-carrying calls from THIS source file so a third one cannot land
        # unregistered. Iteration is sorted so a multi-inversion always names the
        # same call first (a deterministic message, not an arbitrary dict order).
        request_timeout_ms = request_timeout_s * 1000
        for call_name in sorted(ipc_timeouts_ms):
            ipc_ms = ipc_timeouts_ms[call_name]
            if ipc_ms >= request_timeout_ms:
                raise ValueError(
                    f"MT5 {call_name}() IPC timeout must be strictly below the rpyc "
                    f"request timeout ({ipc_ms}ms >= "
                    f"{request_timeout_ms:.0f}ms) — this inversion reopens the "
                    "v1.11 WEDGE-01 wedge class."
                )
        # `_connect` is the injectable transport seam for the offline contract
        # suite (mirrors SfoxClient's _clock/_sleep injection). Default is the
        # lazy real transport.
        connect = _connect or _default_connect
        # Store the construction identity so restart() (MT5CONC-01) can rebuild the
        # transport with the SAME wiring. A blocked RPyC pipe never self-unblocks,
        # so recovering a wedged terminal means telling it to shut down and re-
        # establishing the transport — which requires the resolved factory + args.
        self._connect = connect
        self._host = host
        self._port = port
        self._request_timeout_s = request_timeout_s
        # The resolved per-call IPC ceilings live on the INSTANCE, so restart()
        # (which rebuilds the transport with the same wiring) cannot silently drop
        # back to the module constants.
        self._ipc_timeouts_ms = ipc_timeouts_ms
        self._mt5 = connect(host=host, port=port, timeout=request_timeout_s)
        self._closed = False
        # WIZFORM-ABANDON / D-36: the terminal generation this session belongs to.
        # ⛔ UNBOUND at construction and bound LAZILY on the first session touch —
        # see `_assert_live` for why an eager bind here would be a defect.
        self._epoch: int | None = None

    def _assert_live(self, stage: str) -> None:
        """Refuse — LOUDLY — a session touch from work that outlived its bound.

        WIZFORM-ABANDON / D-36. `asyncio.to_thread` work is never cancelled: when
        the caller's `wait_for` fires it unwinds and RELEASES the terminal lease
        while the abandoned thread keeps driving the same process-global MT5
        session, now under the NEXT holder's lease. The lease bumps the terminal's
        generation on release (`mt5_concurrency.mt5_terminal_lease`), so a zombie's
        next touch finds its own generation stale and is refused HERE, at the one
        sink, instead of at N call sites.

        ⭐ LAZY BIND, and it is load-bearing. `job_worker._make_mt5_session` builds
        its client in PREFLIGHT — outside and before the lease — so a generation
        stamped at construction would go stale merely because an UNRELATED lease
        released in that window, and a legitimate derive read would be refused.
        Binding on FIRST TOUCH costs nothing in fencing power: every zombie's first
        touch happened under the lease that later released. (Construction itself is
        fenced by the separate lease-occupancy ContextVar — D-36 AMENDED (ii).)

        ⭐ IT LOGS AS WELL AS RAISES (D-39). `asyncio.futures._copy_future_state`
        opens with `if dest.cancelled(): return`, so on the abandoned path the
        destination future is already cancelled and the raise reaches NOBODY. A
        refusal that only raised would be invisible — the silent-UNKNOWN class this
        milestone has spent four phases closing. The WARNING is the whole signal.

        ⛔ NOT a `mt5.stage` event. A refusal is not a round-trip; emitting one
        would pollute the `duration_ms` population Phase 155 depends on with
        zero-duration non-calls. If a COUNT is ever wanted it needs a distinct
        event name.

        ⛔ EXEMPT AND MUST STAY EXEMPT (D-41): `__init__`, `close`, `release` and
        `_teardown_transport`. Since D-35 those touch only OUR OWN rpyc socket, and
        fencing them would strand it — reintroducing exactly the Pitfall-6 leak
        that `routers/exchange.py:899-948` exists to prevent, i.e. the fix would
        cause the bug it is fixing. If you are here to "finish the job" by guarding
        the teardown verbs: don't.
        """
        current = _mt5_epoch_for(self.terminal_key)
        if self._epoch is None:
            # First touch — it happens under the lease that owns this session.
            self._epoch = current
            return
        if self._epoch == current:
            return
        logger.warning(
            "Mt5Client._assert_live: refusing the %s round-trip — this session was "
            "bound to terminal generation %d and the terminal is now on generation "
            "%d, so the lease it operated under has already been released and "
            "another holder may own the terminal (WIZFORM-ABANDON / D-36).",
            stage,
            self._epoch,
            current,
        )
        raise Mt5SessionAbandoned(stage)

    def _timed(self, stage: str, call: Callable[[], _T]) -> _T:
        """Run ONE MT5 round-trip under a `perf_counter` bracket, emitting its
        `stage` + `duration_ms` event on BOTH outcomes (153.3 / D-32).

        ONE helper, not a bracket copy-pasted at ten call sites: a per-site
        bracket is how half the sites end up un-instrumented, and a population
        that silently excludes the failures is exactly the censored measurement
        this exists to replace.

        ⛔ The exception is re-raised UNCHANGED — same object, same type, same
        message, same `__traceback__`. Timing must not alter what any caller
        observes (T-153.3-24); in particular this composes with `_guarded_read`
        rather than replacing it, so a raw transport raise is still converted to
        a scrubbed typed `Mt5ClientError` exactly as before. The bracket sits
        INSIDE that conversion deliberately, so `error_class` records the RAW
        transport class (an rpyc `EOFError`, a socket timeout) instead of the
        uniform `Mt5ClientError` every failure would otherwise report.

        `BaseException` is caught, not `Exception`: a cancellation or a
        `KeyboardInterrupt` mid-round-trip is precisely the long-tail case whose
        duration we want, and the bare `raise` means catching it changes nothing.
        """
        started_at = time.perf_counter()
        try:
            result = call()
        except BaseException as exc:  # noqa: BLE001 — re-raised bare on the next line
            emit_mt5_stage_event(
                stage,
                started_at,
                ok=False,
                terminal_key=self.terminal_key,
                error_class=type(exc).__name__,
            )
            raise
        emit_mt5_stage_event(
            stage, started_at, ok=True, terminal_key=self.terminal_key
        )
        return result

    def _raise_last(self) -> NoReturn:
        """Capture `last_error()` IMMEDIATELY (the next remote call overwrites it)
        and raise a typed, secret-scrubbed error."""
        # WIZFORM-ABANDON / D-36 — the fence is the FIRST statement, BEFORE the
        # try/except below, for a reason specific to this method: that except arm
        # converts anything it catches into a scrubbed `Mt5ClientError`, and an
        # `Mt5SessionAbandoned` converted into one is exactly the absorption D-42
        # makes structurally impossible. Fenced ahead of it, it escapes as itself.
        self._assert_live("last_error")
        # RED-TEAM: last_error() is itself a raw transport call. If the connection
        # died right after the None-return that triggered _raise_last, this call
        # can RAISE — and outside _guarded_read it would escape as a raw, untyped,
        # unscrubbed rpyc traceback, bypassing the single typed fail-loud choke
        # point (router 500 instead of clean 400; worker skips the mt5 classify
        # arms). Convert it exactly as _guarded_read does.
        #
        # D-32: it is TIMED for the same reason it is guarded — it is a full
        # remote round-trip taken AFTER the verdict is already known, and
        # EVIDENCE §1b records a failed attempt paying a SECOND full 30s here.
        # An un-timed `last_error` makes every failure look like one round-trip.
        try:
            err = self._timed("last_error", self._mt5.last_error)
        except Mt5ClientError:
            raise
        except Exception as exc:  # noqa: BLE001 — never let raw transport text escape
            raise Mt5ClientError(0, scrub_freeform_string(str(exc))) from None
        if not err:
            raise Mt5ClientError(0, "unknown")
        # A truthy-but-malformed shape (wrong-length tuple, non-subscriptable
        # scalar, dict, non-int code) must NOT escape as a raw
        # IndexError/TypeError/KeyError/ValueError — that would bypass the single
        # typed fail-loud choke point. Coerce defensively.
        try:
            code, text = int(err[0]), str(err[1])
        except (TypeError, IndexError, KeyError, ValueError):
            code, text = 0, "unknown (malformed last_error shape)"
        raise Mt5ClientError(code, text)

    def _guarded_read(self, call: Callable[[], Any], *, stage: str | None = None) -> Any:
        """Run a raw transport read, converting ANY transport-RAISED exception
        into a scrubbed, typed `Mt5ClientError` (T-134-01). `mt5linux` speaks rpyc
        classic: a round-trip that raises (a remote traceback carrying the
        interpolated `code` source line, a mid-handshake abort, an rpyc timeout)
        would otherwise escape UNSCRUBBED — the exact credential-disclosure class
        the module docstring flags. This is fail-loud, just scrubbed: the error
        still propagates, never swallowed. An `Mt5ClientError` we constructed
        (e.g. a `_materialize` degenerate-shape raise) passes through unchanged.
        Only RAISES are intercepted — the `None` (error) vs `()` (honest empty)
        RETURN discipline is untouched (the returned value is handed straight
        back).

        `stage` (153.3 / D-32) composes the timing bracket INTO this one wrapper
        — the single place every non-login read already passes through — rather
        than wrapping it from outside. Two consequences, both deliberate: the
        measured span is the RAW round-trip (not the round-trip plus our own
        conversion), and `error_class` names the raw transport exception instead
        of the `Mt5ClientError` this method uniformly produces. `stage=None`
        keeps the pre-D-32 behaviour byte-for-byte for any caller that has no
        stage to name."""
        try:
            return call() if stage is None else self._timed(stage, call)
        except Mt5ClientError:
            raise
        except Exception as exc:  # noqa: BLE001 — never let raw transport text escape
            raise Mt5ClientError(0, scrub_freeform_string(str(exc))) from None

    def login(self, login: int, password: str, server: str) -> None:
        """Log the terminal into the broker account. A falsy return (bad
        credentials / wrong server — both surface as an opaque False) -> typed
        raise. A transport-RAISED exception is caught and re-raised as a scrubbed
        typed error — `mt5linux` f-string-interpolates the password into the
        remotely-eval'd code, so a raw rpyc remote traceback is a real credential
        disclosure (T-134-01). Because the credential values are in scope here,
        they are ALSO redacted by value (login/server, not just `password=`
        shapes) on top of the shape-based `scrub_freeform_string`. BOTH MT5 calls
        below carry an explicit millisecond ceiling taken from this instance's
        `_ipc_timeouts_ms` (registered in ``MT5_IPC_TIMEOUTS_MS``, ordering-checked
        at construction), so each stays strictly below the rpyc request timeout and
        MT5 can fail its own pipe first (Pitfall 3 / D-24).

        initialize() FIRST (T-139 go-live): the MT5 Python API requires
        ``initialize()`` to attach the terminal's IPC pipe before ANY call —
        without it ``login()`` (and every subsequent read) returns
        ``-10004 'No IPC connection'`` against a real terminal (verified live on
        the prod gateway; the offline doubles never exercised it). The gateway
        terminal is already running and investor-auto-logged-in, so a bare
        ``initialize()`` attaches to the running instance ([ASSUMED] idempotent —
        a no-op True when already attached: that is OUR empirical observation, not
        a MetaQuotes-documented guarantee, EVIDENCE Correction C-7; owner Phase 155
        (MT5-VERIFY)), and the explicit ``login()`` below then (re)authenticates the
        EXPECTED investor account under our controlled timeout + read-only
        semantics. initialize() carries no credentials, but its transport text is
        scrubbed on the same fail-loud path for safety."""
        # WIZFORM-ABANDON / D-36. Ahead of BOTH `_timed` brackets so a refusal
        # never enters the D-32 `duration_ms` population, and ahead of the except
        # arms so it cannot be rewritten into a scrubbed `Mt5ClientError`.
        self._assert_live("login")
        try:
            inited = self._timed(
                "initialize",
                lambda: self._mt5.initialize(
                    timeout=self._ipc_timeouts_ms["initialize"]
                ),
            )
        except Mt5ClientError:
            raise
        except Exception as exc:  # noqa: BLE001 — never let raw transport text escape
            raise Mt5ClientError(0, scrub_freeform_string(str(exc))) from None
        if not inited:
            self._raise_last()
        try:
            ok = self._timed(
                "login",
                lambda: self._mt5.login(
                    login,
                    password=password,
                    server=server,
                    timeout=self._ipc_timeouts_ms["login"],
                ),
            )
        except Mt5ClientError:
            raise
        except Exception as exc:  # noqa: BLE001 — never let raw transport text escape
            safe = scrub_freeform_string(str(exc))
            for literal in (str(login), password, server):
                if literal:
                    safe = safe.replace(literal, "[REDACTED]")
            raise Mt5ClientError(0, safe) from None
        if not ok:
            self._raise_last()

    def account_info(self) -> dict[str, Any]:
        """Current account snapshot as a native dict. None (error) -> typed raise."""
        # WIZFORM-ABANDON / D-36 — ahead of `_guarded_read` (which would convert
        # the refusal into an `Mt5ClientError`) and ahead of `_timed`.
        self._assert_live("account_info")
        info = self._guarded_read(self._mt5.account_info, stage="account_info")
        if info is None:
            self._raise_last()
        return _materialize(info)

    def terminal_info(self) -> dict[str, Any]:
        """Current TERMINAL snapshot as a native dict. None (error) -> typed raise.

        This reads the state of the MetaTrader terminal WE operate (the gateway
        process), NOT the user's account — it carries no credential of theirs.
        Two fields are load-bearing for the Phase-153.3 capability rule (D-31,
        EVIDENCE §C12):

          * ``connected`` — is the terminal attached to a trade server. MQL5
            "Trade permission" lists "no connection to the trade server" as a
            SIBLING cause of ``account_info().trade_allowed`` being false, so a
            detached terminal makes the account-level negative unattributable.
          * ``trade_allowed`` — the terminal-level AutoTrading permission. It
            subsumes the terminal option *"Disable automatic trading through the
            external Python API"*, which MetaQuotes ships **ON by default, "for
            security reasons"**. With that option in force ``order_check`` is
            refused from Python REGARDLESS of investor vs master, so a MASTER
            password produces exactly the two negatives an investor password
            produces.

        That is why this method exists: a false ``trade_allowed`` here makes the
        account-level negatives UNINFORMATIVE, and a rule that concluded
        "read-only" from them would stamp a trade-capable password read-only —
        a fail-OPEN on the one security property the probe exists to prove.
        ``services.mt5_validation.classify_trade_capability`` therefore refuses
        (``"undetermined"``) rather than concluding.
        """
        # WIZFORM-ABANDON / D-36 — ahead of `_guarded_read` and `_timed`.
        self._assert_live("terminal_info")
        info = self._guarded_read(self._mt5.terminal_info, stage="terminal_info")
        if info is None:
            self._raise_last()
        return _materialize(info)

    def history_deals_get(self, from_ts: Any, to_ts: Any) -> list[dict[str, Any]]:
        """Deals in [from_ts, to_ts) as native dicts. `None` is an ERROR -> typed
        raise (NEVER a truthiness check on `deals` — that conflates the error with
        the honest empty `()`); `()` -> `[]`; a populated tuple -> materialized
        dicts. The raw
        server-time `time`/`time_msc` epochs are returned VERBATIM — the
        normalize-to-UTC seam is Phase 136, not this client.

        Bounds are coerced to INT epoch seconds: mt5linux 0.1.9 f-string-interpolates
        args into a remote eval whose Wine namespace has NO ``datetime`` import, so a
        ``datetime`` bound becomes ``datetime.datetime(...)`` → remote ``NameError``
        (0.1.10 added the import; we pin 0.1.9). MT5 accepts int epoch seconds, so
        coercing here lets EVERY caller work — the worker passes ints, the soak passes
        tz-aware datetimes; a naive/aware datetime → ``int(ts.timestamp())`` (the tz
        offset is immaterial for a range filter)."""
        # WIZFORM-ABANDON / D-36 — ahead of `_guarded_read` and `_timed`.
        self._assert_live("history_deals_get")
        _from, _to = _epoch_bound(from_ts), _epoch_bound(to_ts)
        deals = self._guarded_read(
            lambda: self._mt5.history_deals_get(_from, _to), stage="history_deals_get"
        )
        if deals is None:
            self._raise_last()
        return [_materialize(d) for d in deals]

    def order_check(self, request: dict[str, Any]) -> dict[str, Any]:
        """PROBE ONLY. Materialize an `order_check` result to a native dict; `None`
        (error) -> typed raise.

        This exists solely for the Phase-135 validate-time investor-vs-master
        rejection (MT5SRC-02); this facade never wraps the trade path (referred to
        here without call parentheses). `order_check` validates margin/funds and
        does NOT place an order. The exact investor retcode/comment signal is
        [ASSUMED] pending MT5SPIKE-01 leg 2 — the Phase-135 rule must combine the
        order_check retcode/comment WITH account_info().trade_allowed (Pitfall 4).

        The request is passed as KEYWORDS (``order_check(**request)``): mt5linux 0.1.9
        evals ``mt5.order_check(*args, **kwargs)``, and MT5's ``order_check`` rejects a
        positional dict with retcode ``-2 'Unnamed arguments not allowed'`` — it wants
        the named request fields (verified live). ``**request`` produces
        ``mt5.order_check(action=…, symbol=…, …)`` which MT5 accepts."""
        # WIZFORM-ABANDON / D-36 — ahead of `_guarded_read` and `_timed`.
        self._assert_live("order_check")
        result = self._guarded_read(
            lambda: self._mt5.order_check(**request), stage="order_check"
        )
        if result is None:
            self._raise_last()
        return _materialize(result)

    def _teardown_transport(
        self, mt5_obj: Any, *, who: str, stage: str | None
    ) -> None:
        """Close ONE rpyc transport, best-effort — the single teardown mechanism
        behind `close()`, `release()` and `restart()`'s stale disposal (153.3 / D-35).

        ONE implementation, three call sites, because two copies of a teardown are
        two teardowns that will diverge: `close()` and `release()` are two public
        names for exactly the same act, and the whole point of D-35 is that neither
        of them can quietly regrow a `shutdown()`.

        `stage=None` runs the close WITHOUT a `_timed` bracket — that is `restart()`,
        which is deliberately ONE timed stage end to end (recovery latency is the
        actionable number), so a nested `close`/`release` event there would double-
        count and misreport.

        `mt5_obj` is passed explicitly rather than read from `self._mt5` because
        `restart()` disposes the STALE connection AFTER the fresh one has already
        been swapped in (the WR-01 ordering).
        """
        # ponytail: mt5linux 0.1.9 exposes NO transport-close method of its own
        # (`shutdown` forwards to MetaTrader5, which is the very thing we must not
        # do), so reach the rpyc connection through the same name-mangled private
        # attribute `_default_connect` already sets `sync_request_timeout` on.
        # Stable for the same reason: mt5linux is pinned ==0.1.9 and rpyc's
        # `close()` is stable across the 5.x line.
        conn = getattr(mt5_obj, "_MetaTrader5__conn", None)
        transport_close = getattr(conn, "close", None)
        if not callable(transport_close):
            # ⛔ Never a silent no-op: a socket that is neither closed nor reported
            # is a leak nobody can see. This is the offline double's shape today (or
            # a future transport shape), and it must be VISIBLE if it ever becomes
            # production's shape.
            logger.warning(
                "%s: no rpyc transport close reachable "
                "(_MetaTrader5__conn.close absent) — the connection is abandoned, "
                "not closed.",
                who,
            )
            return
        closer = cast(Callable[[], Any], transport_close)
        try:
            if stage is None:
                closer()
            else:
                self._timed(stage, closer)
        except Exception:  # noqa: BLE001 — a teardown error must not mask caller errors
            logger.warning("%s: transport close() raised; swallowing.", who)

    def close(self) -> None:
        """End OUR use of the terminal. Bounded, idempotent, and it NEVER calls
        `mt5.shutdown()` (153.3 / D-35, completing D-30).

        WHY the shutdown is gone rather than merely moved: `mt5linux` serves EVERY
        rpyc connection from ONE `ThreadedServer` process over ONE shared
        `MetaTrader5` module instance holding ONE IPC pipe to ONE terminal
        (153-EVIDENCE-mt5-platform §A2 / Correction C-1). A `shutdown()` from ANY
        caller therefore destroys that pipe for EVERY concurrent caller, who then
        observe `-10004 No IPC connection`. D-30 took the call off the request path;
        that left the class half-closed, because two more callers still reached it
        from the other direction and `main.py:83-91` runs the worker loops INSIDE
        the API process — one `await` from a user's validate:
          - `services/exchange.py`'s `aclose_exchange` mt5 arm (the dispatch
            epilogue), and
          - `services/ingestion/mt5.py`'s adapter `finally`.
        Deleting the call HERE fixes both — and both operator scripts — with zero
        per-call-site edits. That is the difference between ending a class and
        adding a third point-fix. Neither caller can be fixed at its own site
        anyway: both run in a `finally` outside the terminal lease, so leasing them
        would mean queueing inside an error path to buy permission to do something
        destructive.

        What we give up by never calling it: nothing we had. Per EVIDENCE §A6,
        `shutdown()` "closes the IPC connection. It does not close the terminal,
        does not log the account out, and does not reset terminal state." We are
        not reclaiming a per-request resource; we were dropping a shared one — at a
        measured cost of a second full 30.02-30.03 s in all nine of the correlated
        2026-08-06/08 production failures. "Attach once, never tear down" is the
        EVIDENCE's own recommendation.

        What this still DOES: release our own rpyc socket (Pitfall 6). "Release my
        connection" and "shut down the terminal's IPC" are two different things, and
        this method now performs only the first. `release()` is the same act under
        the other name — one implementation, `_teardown_transport`.

        The ONLY remaining `shutdown()` in the tree is `restart()`'s: deliberate,
        the sole heal for a genuinely wedged pipe, and lease-held at every call
        site — asserted from source by `tests/test_mt5_shutdown_roster.py`.
        """
        if self._closed:
            return
        self._closed = True
        self._teardown_transport(self._mt5, who="Mt5Client.close", stage="close")

    def release(self) -> None:
        """Give up OUR use of the terminal WITHOUT ending anybody else's (153.3 / D-30).

        Since D-35 this is observationally identical to `close()` — same latch, same
        transport teardown, same zero `shutdown()` calls — and deliberately so: the
        two names share ONE implementation (`_teardown_transport`) precisely so they
        cannot diverge, and so an "also call close() for safety" line at any call
        site is harmless rather than destructive.

        It:
          1. latches `_closed` FIRST, so a later `close()` is a structural no-op;
          2. best-effort closes the rpyc TRANSPORT (our socket), which is what
             actually ends our lease on the shared server;
          3. swallows a raising teardown with a logged WARNING — a teardown failure
             must never mask the caller's verdict.

        The name is retained (rather than collapsed into `close()`) because it states
        the INTENT at the request-path call sites that D-30 re-pointed: this verb
        borrows the terminal, it never owns it.
        """
        if self._closed:
            return
        self._closed = True
        self._teardown_transport(self._mt5, who="Mt5Client.release", stage="release")

    def restart(self) -> None:
        """Tear down a wedged terminal and re-establish the transport (MT5CONC-01).

        A blocked RPyC/Wine pipe will NOT self-unblock, so the transport is
        re-established via the stored ``_connect`` factory and the stale connection
        is told to shut down. Best-effort teardown: a wedged/raising ``shutdown()``
        is swallowed with a logged warning (mirroring ``close()``) — a terminal too
        broken to tear down cleanly must still be rebuilt, never left un-restartable.

        ORDERING (WR-01): the fresh connection is built and swapped in as the live
        connection FIRST, and only THEN is the stale connection disposed. This is
        load-bearing for restart RELIABILITY under the abandon-thread recovery model.
        When restart is triggered by the derive read-timeout branch, the timed-out
        ``_mt5_read`` OS thread is ABANDONED but keeps running and may still be
        driving the SAME rpyc connection. rpyc classic is not concurrent-request-safe,
        so issuing ``shutdown()`` on that stale connection can itself HANG. Were the
        shutdown done FIRST (the old ordering), a hanging stale-shutdown would be
        abandoned by the bounded caller (``_mt5_bounded_restart``'s ``wait_for``)
        BEFORE the reconnect ran — leaving NO fresh terminal for the next retry and
        defeating the restart's whole purpose. Reconnecting first guarantees the
        client holds a FRESH usable connection whenever a connect is possible, EVEN
        IF the stale connection's shutdown would block; the abandoned stale shutdown
        can no longer prevent the reconnect.

        ⭐ THE ONE PERMITTED ``shutdown()`` (153.3 / D-35). Every other teardown in
        this client was deleted, because a ``shutdown()`` on this deployment
        destroys the ONE shared IPC pipe for every concurrent caller. This one
        STAYS, deliberately: with nobody else calling it, a genuinely wedged pipe is
        healed ONLY here (MT5CONC-01), and destroying a pipe that is already wedged
        is the point rather than the hazard. It is safe to keep because every one of
        its call sites holds the terminal lease — ``allocator_positions.py`` x2 and
        ``job_worker.py`` x2, all lexically inside ``async with
        _mt5_terminal_lock_for(...)`` / ``mt5_terminal_lease(...)`` — so no
        concurrent caller can be attached when it fires. That is not a belief:
        ``tests/test_mt5_shutdown_roster.py`` derives BOTH facts from source (this
        is the only ``shutdown()`` call node in the tree, and every restart call
        site is lease-enclosed) and reds when a new site appears.

        Unlike ``close()`` this does NOT gate on ``self._closed`` and NEVER calls
        ``close()``: restart's contract is teardown+rebuild regardless of prior
        state, and it clears ``self._closed`` so the fresh session is closable
        again. It never sleeps, retries, or joins the abandoned hung reader thread
        — the CALLER bounds this call with ``to_thread`` + ``wait_for`` (see
        ``mt5_concurrency._mt5_bounded_restart``) so restart can never itself
        nest-wedge the worker.

        Live ``initialize()`` semantics — and specifically whether ``shutdown()`` on
        a connection an abandoned reader is still parked on is safe or must be freed
        out-of-band — are [ASSUMED] (A1) pending the Phase-139 gateway spike; against
        the offline ``_connect`` double, reconnect + best-effort ``shutdown()`` is
        the full exercised surface.
        """
        # WIZFORM-ABANDON / D-36 — CHECK 1 of 2, the ENTRY check. An
        # already-abandoned restart must not open an rpyc socket nobody is left to
        # close. It sits OUTSIDE the `_timed` bracket below deliberately: a refusal
        # is not a round-trip, and letting one emit an `mt5.stage restart` event
        # would pollute the D-32 `duration_ms` population Phase 155 reads with
        # zero-duration non-calls. (It reuses the `restart` stage NAME in the log
        # only.) ⚠️ This check is the CHEAP half and closes almost nothing on its
        # own — see check 2.
        self._assert_live("restart")

        # D-32: the WHOLE restart is one timed stage, not two. Recovery latency is
        # what a Phase-155 reader needs (how long a wedged terminal costs us), and
        # the reconnect and the stale disposal are not independently actionable —
        # the ordering above deliberately makes the second one best-effort.
        def _reconnect_then_dispose_stale() -> None:
            stale = self._mt5
            # Rebuild + swap in the fresh connection FIRST (see ORDERING above).
            self._mt5 = self._connect(
                host=self._host, port=self._port, timeout=self._request_timeout_s
            )
            self._closed = False
            # ⭐ WIZFORM-ABANDON / D-36 — CHECK 2 of 2, AND IT IS THE LOAD-BEARING
            # ONE. Finding #5 is precisely the case where the entry check above
            # already passed and the damage happens LATER: `_mt5_bounded_restart`
            # gives this call ~10s, then ABANDONS it (a thread cannot be
            # interrupted); the caller unwinds, its lease releases and bumps the
            # generation, and this zombie — still parked in the reconnect — arrives
            # at the shared `stale.shutdown()` below UNDER THE NEXT HOLDER. One
            # `ThreadedServer`, one `MetaTrader5` instance, one IPC pipe (EVIDENCE
            # §A2 / C-1), so that late shutdown answers the next holder `-10004 No
            # IPC connection`. An entry-check-only fix reads as a fix and closes
            # nothing.
            #
            # ⛔ Compared INLINE rather than via `_assert_live`, because the three
            # cleanup steps below MUST run before the raise — `_assert_live` raises
            # immediately and would strand two sockets.
            if self._epoch != _mt5_epoch_for(self.terminal_key):
                logger.warning(
                    "Mt5Client.restart: this restart was abandoned by its caller "
                    "and the terminal has since been handed on (generation %s -> "
                    "%d) — SKIPPING the shared-IPC shutdown(), which would -10004 "
                    "the holder that owns the terminal now. Disposing only the "
                    "sockets that are OURS (WIZFORM-ABANDON / D-36).",
                    self._epoch,
                    _mt5_epoch_for(self.terminal_key),
                )
                # Three invariants, and all three are required — RESEARCH §Q4.
                # (1) Skipping the SHARED shutdown must not skip OUR OWN socket
                #     close; `stale`'s socket is ours on every path (D-35), and the
                #     un-fenced path below already treats the two as separate
                #     concerns for exactly this reason.
                self._teardown_transport(
                    stale, who="Mt5Client.restart(abandoned)", stage=None
                )
                # (2) The FRESH connection WR-01 forces us to open first is dead
                #     weight here — the caller that would have received it is gone.
                #     Leaving it open is a NEW leak the fence itself would create.
                self._teardown_transport(
                    self._mt5, who="Mt5Client.restart(abandoned)", stage=None
                )
                # (3) Restore the latch cleared two lines above. Otherwise a client
                #     its caller has already given up on is left latched-OPEN, and
                #     `close()` — exempt from the fence, and quite possibly already
                #     run by the dispatch epilogue — no-ops forever.
                self._closed = True
                raise Mt5SessionAbandoned("restart")
            # Best-effort dispose of the stale connection AFTER the fresh one is live,
            # so a shutdown() that blocks (an abandoned reader still driving `stale`)
            # can never prevent the reconnect. A raising teardown is swallowed like
            # close().
            try:
                stale.shutdown()
            except Exception:  # noqa: BLE001 — a wedged teardown must not abort recovery
                logger.warning(
                    "Mt5Client.restart: stale shutdown() raised; swallowing."
                )
            # D-35: and close the stale rpyc SOCKET too. Telling the terminal to
            # shut down never closed OUR end of the pipe, so every restart used to
            # leak one socket. This is a SEPARATE try from the shutdown above, both
            # ways round: a raising shutdown must not skip the socket close, and a
            # raising socket close must not mask the shutdown's warning.
            # ⚠️ ORDERING (WR-01) is preserved verbatim — reconnect FIRST, dispose
            # SECOND — and BOTH dispose steps are best-effort. Neither is bounded
            # here; the caller's `_MT5_RESTART_TIMEOUT_S` (mt5_concurrency:68-70)
            # is what stops a stale socket an abandoned reader is parked on from
            # blocking recovery, exactly as it already did for the shutdown.
            self._teardown_transport(stale, who="Mt5Client.restart", stage=None)

        self._timed("restart", _reconnect_then_dispose_stale)

    @property
    def terminal_key(self) -> str:
        """Process-wide terminal identity (``host:port``) — the key for the
        Phase-137 per-terminal serialization lock registry
        (``mt5_concurrency._MT5_TERMINAL_LOCKS``, MT5CONC-02).

        Two ``Mt5Client`` instances built for the SAME gateway (every job builds a
        fresh client via ``_make_mt5_session``) share this key, so a single
        module-level ``asyncio.Lock`` serializes every terminal-IPC region against
        the ONE shared Wine terminal. It must be derived from the construction
        identity (``_host``/``_port``, stored in ``__init__``), never from a
        per-Session attribute that would differ per job and serialize nothing.
        """
        return f"{self._host}:{self._port}"


@dataclass
class Mt5Session:
    """MT5RECON-01 (Phase 136) — the worker's non-ccxt exchange holder for mt5.

    The job-worker's ``_make_exchange_client`` construction chokepoint builds this
    (the mt5 analog of the raw ``SfoxClient`` the sfox arm returns) so the derive
    branch can ``login`` + read + ``close`` a terminal session. It bundles the
    read-only ``Mt5Client`` with the PARSED credentials (login/investor password/
    broker server) resolved from the reused api_key/api_secret/passphrase slots
    (the 135 convention), because — unlike a ccxt exchange or the sfox Bearer
    client — an MT5 read requires an explicit per-account ``login(...)`` call at
    read time, not just at construction.

    ``aclose_exchange`` (the single close chokepoint) isinstance-routes this to
    ``client.close()`` (bounded via ``asyncio.to_thread`` — the sync facade), so
    every job-worker close site becomes mt5-safe with zero per-site edits.
    """

    # repr=False on the three credential-bearing fields (RED-TEAM hardening): the
    # dataclass auto-__repr__ would otherwise emit the plaintext investor password
    # (and the login/server, both treated as secrets by services.redact) into any
    # `%r`/f-string/structlog serialization of a Mt5Session — the same repr-leak
    # class schemas.py wraps in SecretStr for. This makes the "secrets never in
    # logs/exceptions" invariant STRUCTURAL, not call-site discipline.
    client: Mt5Client
    login: int = field(repr=False)
    investor_password: str = field(repr=False)
    server: str = field(repr=False)
