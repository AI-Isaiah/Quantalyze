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
    `session_snapshot` (164.6.5 review round 2) reads those two reads' heal
    fields through one committed remote expression; it wraps no new MT5 call.

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

import json
import logging
import os
import re
import time
from contextvars import ContextVar, Token
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable, Final, NamedTuple, NoReturn, TypeVar, cast

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
    """Obtain the stage logger PER CALL rather than once at import.

    ⚠️ Not a style choice, but the reason is narrower than this docstring used to
    claim, and the claim itself is now false. It read:

        "A module imported before the process configures its logging — which is
        this one: `main.py` configures inside the lifespan, long after import"

    ⛔ REFUTED, twice over, as of OPS-05 (Phase 163, 2026-08-26):

    1. `main.py` does not configure inside the lifespan and has not for a long
       time — `configure_logging()` runs at MODULE scope there, and since this
       phase it runs above every first-party import. `main_worker.py` now does
       the same at its own module scope. Both entrypoints configure before any
       first-party module can emit, and
       `tests/test_structlog_frozen_proxy.py::TestEntrypointOrdering` fails if
       either ordering regresses.
    2. The freeze mechanism is not what "``cache_logger_on_first_use=True`` ...
       freezes at FIRST use" implies for THIS function. MEASURED 2026-08-26:
       structlog's *default* config (the one in force before
       `configure_logging()` runs) carries ``cache_logger_on_first_use=False``,
       so `BoundLoggerLazyProxy.bind` does NOT install its `finalized_bind`
       closure and a plain module-scope ``structlog.get_logger(...)`` proxy
       re-reads `_CONFIG` on every use — it self-heals once configure runs. What
       is permanently frozen is a module-scope ``.bind(...)`` RESULT: that is a
       concrete BoundLogger holding the default (unredacted) processor list
       forever. That shape is the one gated by
       `tests/test_structlog_frozen_proxy.py::TestModeAModuleScopeBind`.

    So the live hazard this function dodges is the pre-configure WINDOW, not a
    permanent proxy freeze: any line emitted before `configure_logging()` renders
    through the default chain, i.e. WITHOUT the `_redact_processor` PII scrub —
    and MT5 lines are exactly the ones that must never do that, since `mt5linux`
    interpolates the password into remotely-eval'd source (see the module header).
    Both entrypoints now close that window, so this per-call lookup is
    belt-and-braces: it costs one proxy allocation next to a network round-trip,
    it cannot go stale, and it is what keeps the events observable to
    `structlog.testing`. Keep it.
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


def mt5_terminal_key(host: str, port: int) -> str:
    """The process-wide terminal identity (``host:port``) — ONE spelling, and one
    that is reachable WITHOUT constructing an ``Mt5Client``.

    It is the key of BOTH registries that fence the single shared Wine terminal:
    the epoch registry above and ``mt5_concurrency._MT5_TERMINAL_LOCKS``. The two
    MUST be byte-identical or the fence guards a different terminal than the lock
    serializes, which is the two-registries class ``services/mt5_concurrency.py``'s
    module header forbids.

    ⭐ WHY a module function and not only the ``Mt5Client.terminal_key`` property it
    now backs: ``Mt5Client.__init__`` performs a BLOCKING ``rpyc.classic.connect``
    that carries no timeout of its own, so a caller that must know the LEASE KEY
    *before* it is willing to open a transport — take the lease, then construct —
    structurally cannot read it off an instance. The only alternative was a second
    hand-spelled ``f"{host}:{port}"`` at that call site, i.e. the very drift this
    function exists to remove.

    ⛔ ``Mt5Client.terminal_key`` DELEGATES here. Do not let the two spellings drift
    apart by "inlining" either one.
    """
    return f"{host}:{port}"


def _credential_renderings(literal: str) -> tuple[str, ...]:
    """Every byte sequence ONE credential value can reach a log as.

    ⛔ 164.6.2 CR-01 — THE RAW LITERAL IS NOT THE PRODUCTION SHAPE. ``mt5linux``
    0.1.9 builds its remote call as SOURCE TEXT
    (``f'mt5.initialize(*{args},**{kwargs})'``), so the credentials arrive in a
    remote traceback as the ``repr()`` OF A DICT — and ``repr()`` ESCAPES. A
    by-value pass matching only the unescaped literal fires on an
    ``[A-Za-z0-9-]`` password and MISSES every password carrying a backslash, a
    quote pair or a control character; MEASURED against the shipped loop on
    2026-09-14, the login and the server were redacted and the password survived
    verbatim.

    ⛔ That miss is the WHOLE control, not half of it: ``scrub_freeform_string``
    is a measured NO-OP on the kwargs-repr shape (its ``SENSITIVE_KEY_VALUE``
    pattern needs ``key`` immediately followed by ``[:=]`` and the repr puts a
    closing quote between them), so the by-value pass is the SOLE thing standing
    between a broker password and a PUBLIC Actions log.

    Returns the raw literal plus the ESCAPED BODIES ``repr()``, ``ascii()`` and
    ``json.dumps()`` produce — the three differ for a value carrying both quote
    types or any non-ASCII character, and a structured-log encoder reaches for the
    JSON one. Empty renderings are dropped: ``"".replace`` splices the marker
    between every character.

    ⛔ IN-01 (164.6.2 round 2) — ``ascii()`` IS THE THIRD FORM AND IT WAS MISSING
    WHILE THE FIRST LINE OF THIS DOCSTRING PROMISED AN ABSOLUTE. ``repr()`` and
    ``ascii()`` are IDENTICAL for an ASCII-only value and DIVERGE the moment one
    is not: MEASURED, ``ascii("pässw0rd")[1:-1]`` is ``p\\xe4ssw0rd`` while
    ``repr()`` yields ``pässw0rd`` and ``json.dumps()`` yields ``p\\u00e4ssw0rd``
    — three distinct byte sequences for one password, of which the loop matched
    two. The ``%a`` conversion and ``{!a}`` are the reachable producers.

    ⚠️ NO LIVE CALL SITE PRODUCING THE ``ascii()`` FORM WAS FOUND (the 164.6.2
    round-2 review looked and says so), so this form is UNPROVEN-REACHABLE rather
    than measured-reachable. It is added anyway, because the alternative was to
    narrow an absolute this function's whole contract rests on: a redactor
    documented as covering "every byte sequence" is read by every future caller as
    a licence not to check, and a one-line form is cheaper than that ambiguity.
    A broker password carrying a non-ASCII character is not exotic.

    Ordered longest-first so a shorter rendering that is a SUBSTRING of a longer
    one cannot consume part of it and strand the remainder unredacted.
    """
    forms = {
        literal,
        repr(literal)[1:-1],
        ascii(literal)[1:-1],
        json.dumps(literal)[1:-1],
    }
    return tuple(sorted((form for form in forms if form), key=len, reverse=True))


def _redact_credential_values(
    text: str, login: int, password: str, server: str
) -> str:
    """Shape-scrub ``text``, THEN redact the three credential values BY VALUE —
    in EVERY rendering, never only the raw literal (``_credential_renderings``).

    ⛔ T-134-01 — this is a SHIPPED CONTROL travelling with the credentials, not a
    belt-and-braces nicety. ``mt5linux`` 0.1.9 builds every remote call as SOURCE
    TEXT (``f'mt5.initialize(*{args},**{kwargs})'``) and evals it on the far side,
    so a raw rpyc remote traceback carries the login, the password and the broker
    server VERBATIM. ``scrub_freeform_string`` is SHAPE-based — it catches
    ``password=<value>`` key/value shapes — and is structurally unable to catch a
    bare literal that arrives without its key. Only the by-value pass can, which is
    why routing a credential through a path that lacks this loop would be a
    REGRESSION of the control rather than an omission from it.

    Empty literals are skipped: ``"".replace`` splices the marker between every
    character of the message.

    ⛔ ALL THREE VALUES GET THE ESCAPE-AWARE TREATMENT, not just the password. A
    broker SERVER string can carry an escapable character too (a Windows-shaped
    path, a tab from a mis-pasted Railway variable), and a fix applied to the
    password alone would have stayed green against a corpus that never tried one.

    ⭐ ``Mt5Client.login`` IS routed through here as of the D-07 amendment
    (founder, 2026-09-14). It previously carried a private copy of this loop that
    matched the RAW literal only, so its transport-raise arm disclosed an
    escape-carrying password in its ``repr()`` rendering — a LIVE disclosure on
    four shipped per-account callers that pass a real vault password, booked and
    MEASURED as ``[164.6.2-LOGIN-ESCAPE-BLIND]``, now CLOSED. D-07's freeze existed
    to keep a shipped live-path method out of a REFACTOR; applying the identical,
    already-proven redaction was not one.

    The property is enforced by the signature-DERIVED redaction gate in
    ``tests/test_mt5_client_contract.py``, which drives EVERY credential-carrying
    verb — including a third one added later — and by
    ``test_CREDENTIAL_REDACTION_every_credentialed_verb_routes_through_the_shared_redactor``,
    whose expectation is now the EMPTY SET: a verb written without this helper reds
    there rather than shipping a raw-literal-only scrub.
    """
    safe = scrub_freeform_string(str(text))
    # ⛔ ONE GLOBAL LONGEST-FIRST PASS ACROSS ALL THREE LITERALS, never a
    # per-literal loop in a fixed order. `_credential_renderings` sorts
    # longest-first WITHIN one literal, which is not enough: when one credential
    # is a SUBSTRING of another — a password containing the account number is the
    # commonest human choice for a numeric login — walking `login` first consumes
    # that span, and the password's full-literal match then FAILS. MEASURED on the
    # exact mt5linux kwargs-repr shape, login=<8 digits> inside the password:
    #     'password': 'Quant[REDACTED]!x', 'server': 'Broker-[REDACTED]-2'
    # The password's prefix, suffix, length and structure reach the log verbatim,
    # and the span actually masked is the account number — which whoever reads
    # that line already has. Every corpus assertion still PASSED, because they all
    # assert the FULL literal absent and a partial mask is not the full literal.
    renderings = sorted(
        {
            rendering
            for literal in (str(login), password, server)
            for rendering in _credential_renderings(literal)
        },
        key=len,
        reverse=True,
    )
    for rendering in renderings:
        safe = safe.replace(rendering, "[REDACTED]")
    return str(safe)


def _redact_with_optional_credentials(
    text: str, credentials: tuple[int, str, str] | None
) -> str:
    """``text`` redacted BY VALUE whenever the three values are known, shape-scrubbed
    only when they are not — the two-armed shape ``mt5_relogin._describe_exception_for_log``
    already ships, reused here rather than re-derived.

    ⛔ [164.6.2-RAISE-LAST-SHAPE-ONLY], CLOSED by Phase 164.6.4 criterion 5 (founder
    decision 2026-09-15, routed in from Phase 164.6.2 criterion 9). ``Mt5Client._raise_last``
    builds its detail from the TERMINAL's own ``last_error()`` text and used to scrub it
    by SHAPE alone — and ``_redact_credential_values``' own docstring records that scrub
    as a MEASURED NO-OP on the ``mt5linux`` kwargs-repr shape. A broker that echoes the
    submitted account or server back into ``last_error()`` therefore disclosed it, on a
    PUBLIC repo with Sentry attached. This helper is what the shared raise site now calls.

    ⛔ THE ``None`` ARM IS NOT A WEAKENING, IT IS THE CORRECT BEHAVIOUR — the identical
    argument ``_describe_exception_for_log`` records. Where no credential is in scope
    there is nothing to redact BY, and calling ``_redact_credential_values`` with
    placeholder values would be actively WORSE than useless: a placeholder login of ``0``
    would replace every ``0`` in the message with the marker, mangling the very text an
    operator needs. The callers that HOLD credentials pass them; the five that do not,
    do not.

    ⛔ A SECOND COPY OF THE REDACTION LOOP IS THE DRIFT ITS OWN GATE EXISTS TO PREVENT.
    This function DELEGATES to ``_redact_credential_values``; a raw-literal-only
    re-implementation was a MEASURED live disclosure ([164.6.2-LOGIN-ESCAPE-BLIND]).
    """
    if credentials is None:
        return str(scrub_freeform_string(text))
    login, password, server = credentials
    return _redact_credential_values(text, login, password, server)


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


# --------------------------------------------------------------------------- #
# ⭐ "THE TERMINAL ANSWERED" — a per-terminal COUNT of bare `initialize()` calls
# that returned truthy, from ANY caller in this process (164.6.5 review round 1,
# SFH-05 / WR-08).
#
# WHY IT EXISTS. The heal's ipc_fault escalation is debounced to one terminal
# recycle per run of consecutive wedged readings, and a run must end when the
# terminal is SEEN answering again. The heal's own probe is not the only thing
# that sees it: the job path's `login()` opens with the same bare `initialize()`,
# and while jobs hold the lease every monitor tick is a busy SKIP that measures
# nothing. Before this count, a recovery only jobs observed left the gate
# disarmed, and the NEXT wedge was debounced as if it were the old one.
#
# ⛔ WHAT COUNTS: a bare `initialize()` returning truthy — the terminal answered
# its IPC. Never a `last_error()` (bridge-local), never a raise, never a falsy
# return (a wedged terminal answers falsy). The count carries no credential and
# no account: it is a number per `host:port`.
#
# ⛔ LOCK-FREE, like `_MT5_TERMINAL_EPOCHS` above and for the same reason. Two
# racing increments can lose one, and that is harmless: the only question ever
# asked of the count is "has it CHANGED since the escalation was claimed", and a
# lost increment still changes it.
# --------------------------------------------------------------------------- #
_MT5_TERMINAL_ANSWERS: dict[str, int] = {}


def _note_terminal_answered(terminal_key: str) -> None:
    """Record that a bare ``initialize()`` on this terminal returned truthy."""
    _MT5_TERMINAL_ANSWERS[terminal_key] = _MT5_TERMINAL_ANSWERS.get(terminal_key, 0) + 1


def mt5_terminal_answer_count(terminal_key: str) -> int:
    """How many times, in this process, the terminal has answered a bare
    ``initialize()`` truthily. Unknown key -> 0. A READ never mints an entry."""
    return _MT5_TERMINAL_ANSWERS.get(terminal_key, 0)


def _reset_mt5_epochs_for_tests() -> None:
    """Clear the epoch registry between tests (RESEARCH Pitfall 8).

    Five test modules already hand-clear `_MT5_TERMINAL_LOCKS`; a leaked EPOCH
    would be a sixth flake mechanism under `-n auto --dist loadgroup` (a bump from
    one test fencing a client built by the next). ⛔ Not called from production
    code, and not to be: it is reached through the ONE shared
    `mt5_concurrency.reset_terminal_state_for_tests()` so a future third registry
    has exactly one home to be added to.

    ⭐ It also clears the answered-count registry above (164.6.5 review round 1):
    that IS the third registry, and this is the one home it was promised.
    """
    _MT5_TERMINAL_EPOCHS.clear()
    _MT5_TERMINAL_ANSWERS.clear()


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


class Mt5LoginRefusedError(Mt5ClientError):
    """The terminal ANSWERED the ``login()`` call itself, and the answer was no.

    Raised from exactly ONE place: the falsy-return arm of ``Mt5Client.login``,
    after ``initialize()`` attached and the credentialed ``login()`` round-trip
    completed. It carries the terminal's own ``last_error()`` code and text,
    redacted exactly as the parent's would be — construction is inherited
    unchanged.

    ⭐ WHY A MARKER TYPE (Phase 167 CR-01 / WR-01). A caller holding a bare
    ``Mt5ClientError`` cannot tell which STAGE produced it: ``initialize()``
    failing before any credential is sent, the transport dropping mid-login,
    and ``account_info()`` / ``order_check()`` failing AFTER a successful login
    all arrive as the same type. Treating every one of them as a refused sign-in
    told every MT5 owner to fix a working credential whenever the shared gateway
    wedged or redeployed. Only this subclass means "a sign-in was attempted and
    refused"; ``services.mt5_validation.is_mt5_login_refusal`` is the ONE
    predicate over it that both the wizard and the holdings poll consult.

    ⛔ A subclass, so every existing ``except Mt5ClientError`` arm still catches
    it — no disposition anywhere changes unless the caller asks for this type.
    """


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
    SUBSTRING against ``_WRONG_SERVER_PHRASES`` / ``_AUTH_PHRASES``
    (``services/mt5_validation.py``, cited by symbol). Until 164.5.4 those tables
    held BARE WORDS and the fenced stage names were literally members —
    ``terminal_info`` and ``connect`` contain ``terminal``/``connect``, ``login``
    and ``account_info`` contain ``login``/``account`` — so interpolating the
    stage would have re-run the documented ``routers/exchange.py:678-684``
    incident, where an operator-side refusal became a 400 telling the user their
    BROKER SERVER was wrong.

    ⚠️ 164.5.4 made those tables ANCHORED PHRASES and added the refusal rule, so an
    unrecognised message degrades to ``transient``. The hazard is NARROWER, not
    gone, and the message stays fixed: the tables are ``[ASSUMED]`` pending the
    live spike and will GAIN members as pairs are measured, so a message built
    from free text could start matching at any time. Keeping the stage out is a
    structural guarantee; relying on today's phrase set is a bet.

    The stage is kept as an ATTRIBUTE (``self.stage``) for the callers that route
    on it, and it is safe in the fence's WARNING log — a log line is never
    classified.

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


# The name the remote materializer is bound to in the rpyc server namespace, and
# the source that defines it. See `Mt5Client._materialize_rows` for WHY this runs
# on the far side of the wire; the short version is that `_materialize` costs ONE
# ROUND-TRIP PER FIELD, so materializing N deals client-side costs O(N x fields)
# round-trips (MEASURED 2026-08-13, live gateway: 60ms/deal, 29.9s for 493 deals
# against a 40s bound — MT5DEAL-01).
#
# ⛔ This source is a STRING executed in a REMOTE interpreter, so it cannot import
# from this module, cannot be type-checked, and must stay self-contained. It is a
# deliberate mirror of `_coerce` + `_materialize` above: the same scalar pass-list,
# the same stringify-everything-else fallback, and the same fail-loud on a
# degenerate (non-namedtuple) shape. ⚠️ Change one, change both — the contract tests
# exec THIS STRING against the offline doubles, so a divergence reds them.
_REMOTE_MATERIALIZE_FN = "_qz_materialize_deals"
_REMOTE_MATERIALIZE_SRC = f"""
import json as _qz_json


def {_REMOTE_MATERIALIZE_FN}(deals):
    rows = []
    for deal in deals:
        asdict = getattr(deal, "_asdict", None)
        if asdict is None:
            raise TypeError("MT5 returned a non-namedtuple/degenerate shape")
        rows.append({{
            str(k): (v if v is None or isinstance(v, (bool, int, float, str))
                     else str(v))
            for k, v in asdict().items()
        }})
    return _qz_json.dumps(rows)
"""


# 164.6.5 / D-05 (Option 2, founder-ratified 2026-09-25) — the TERMINAL-PROCESS
# recycle. `Mt5Client.recycle_terminal_process` pushes this source across the rpyc
# classic channel and calls it; see that method for the whole contract. The name
# the remote function is bound to, and the source that defines it.
#
# ⛔ THIS IS A STRING EXECUTED IN A REMOTE INTERPRETER — the WINE-SIDE `python.exe`
# that serves the rpyc bridge, i.e. WINDOWS Python. It cannot import from this
# module, cannot be type-checked, and must stay self-contained. Its imports live
# inside the function body so defining it is harmless on any platform.
#
# ⛔ A PLAIN LITERAL, NOT AN F-STRING, AND NEVER ASSEMBLED AT RUN TIME. The rpyc
# channel is the unauthenticated arbitrary-remote-code channel T-134-03 names;
# the only way it carries a new class of command safely is if that command is
# fixed in this file. The function name is therefore written out inside the
# source rather than interpolated from `_REMOTE_TERMINAL_RECYCLE_FN`, and the ONE
# run-time value (the exit wait) crosses as a by-value int ARGUMENT, never as
# text. `tests/test_mt5_client_contract.py` asserts the assignment is an AST
# string constant, that it carries no brace at all, and that the two names agree.
#
# ⛔ IT TERMINATES A PROCESS AND DOES NOTHING ELSE. It does not delete, move,
# reset or rebuild ANYTHING under the persistent Wine prefix or the named volume
# (D-07, ONE-WAY). The saved terminal state there is what made the MEASURED
# unattended recoveries possible; restoring it after a wipe needs a human at the
# VNC console, which is exactly the 1h39m manual step this phase removes. It takes
# NO credential and names no account, server or path.
#
# ⚠️ 164.6.6 CONSTRAINT (recorded 2026-09-25, 164.6.5 review round 1, IN-07): it
# ends EVERY `terminal64.exe` in the bridge's wineserver. That is correct while
# v1 runs ONE shared terminal. Under per-client terminals (Phase 164.6.6,
# MT5TERMINALISOLATION) one client's wedge would kill every client's terminal;
# the match must then be scoped to the wedged terminal's own process before a
# second terminal ships.
#
# ⭐ WHY TERMINATE-ONLY IS A FULL RECYCLE (founder live spike, 2026-09-25). Nothing
# supervises the terminal, but the MetaTrader5 package's own `initialize()`
# LAUNCHES a terminal that is not running. Twice the terminal process was killed
# and, with no human action, the bridge's next `initialize()` relaunched it and it
# came back authorized with live quotes. So the relaunch is the next bare
# `initialize()` — which `recycle_terminal_process` issues itself — and no
# Linux-side launch command is needed or sent.
#
# Mechanism: Toolhelp32 enumerates processes, `TerminateProcess` ends every one
# whose image is `terminal64.exe` (an abrupt end, the same class as the spike's
# `kill`), and `WaitForSingleObject` bounds the wait for each to exit. It returns
# a by-value JSON string, never a proxy. A snapshot failure RAISES (and the
# caller's `_guarded_read` scrubs it); a process that cannot be opened or
# terminated is COUNTED (matched but not terminated), never silently dropped.
#
# ⭐ SFH-09 (164.6.5 review round 1) — AND ITS REASON TRAVELS WITH IT. A refused
# `OpenProcess` or `TerminateProcess` used to add nothing but a smaller
# `terminated`, so the first live run could not tell "access denied" (5) from
# "the process is already gone" (87, invalid parameter, for a vanished pid).
# Each refusal now appends its `GetLastError()` — an INT, read through
# `use_last_error=True` — to `open_errors` / `terminate_errors`. Still a
# committed literal: only the RETURN dict grew.
#
# ⭐ SFH-04 (164.6.5 review round 1) — THE BUILD, READ BRIDGE-SIDE, BEFORE THE
# TERMINATE. The heal's pre-recycle capture reads the build through
# `terminal_info()`, which crosses the SAME dead terminal IPC a `-10005` names,
# so on a true wedge it is expected to be `not_captured`. The one piece of D-03a
# evidence that does not need that IPC is the terminal's EXECUTABLE: for each
# matched process this reads the file version of its image (`QueryFullProcess
# ImageNameW` + `GetFileVersionInfoW`), returned as four INTS in
# `file_versions` (the image PATH is never returned: it names the prefix). ⚠️ It
# is the file ON DISK at the running image's path — the running build unless the
# file was replaced after launch, which a self-update may do. A failure is an int
# in `file_version_errors` (`-1` for a Python-side raise) and NEVER blocks the
# terminate that follows it. ⚠️ Like the terminate, never exercised live.
#
# ⭐ 164.6.5 review round 2, Topic B — WHAT THE BODY RETURNS BESIDE THE COUNTS.
#   - R2-SFH-04: each process's open + terminate is caught PER PROCESS, so a raise
#     on a later pid (a ctypes marshalling error, say) can no longer escape after
#     an earlier terminate landed and turn a real kill into "not known".
#     `attempted` counts every `TerminateProcess` issued (a raising one included);
#     `pid_errors` names each caught exception by CLASS.
#   - WR-06: `unprocessed` counts matched processes never started because the
#     in-bridge budget ran out (see `_TERMINAL_EXIT_WAIT_MS`).
#   - R2-SFH-06: `enumerated` is every process the snapshot walked, and
#     `enumerate_error` is `GetLastError()` when `Process32FirstW` fails, so a
#     failed enumeration no longer reads like "no terminal running".
#   - R2-SFH-07: `file_version_exc` is the version read's exception CLASS name
#     (a bridge-local identifier, never its message) beside the `-1`, so a
#     missing `version.dll` and a signature mismatch stop reading the same.
# ⚠️ IN-01: every Win32 function it calls declares `argtypes` (and `restype` when
# it returns something other than BOOL). The contract suite pins that the
# declarations EXIST; under a faked `WinDLL` it cannot show they are RIGHT under
# Wine. Live marshalling is unmeasured (`.planning/WINDOWS.md` entry 68).
_REMOTE_TERMINAL_RECYCLE_FN = "_qz_recycle_terminal_process"
_REMOTE_TERMINAL_RECYCLE_SRC = """
def _qz_recycle_terminal_process(exit_wait_ms):
    import ctypes
    import json
    import time
    from ctypes import wintypes

    image = "terminal64.exe"
    th32cs_snapprocess = 0x00000002
    process_terminate = 0x0001
    process_query_limited_information = 0x1000
    synchronize = 0x00100000
    wait_object_0 = 0x00000000

    class FixedFileInfo(ctypes.Structure):
        _fields_ = [
            ("dwSignature", wintypes.DWORD),
            ("dwStrucVersion", wintypes.DWORD),
            ("dwFileVersionMS", wintypes.DWORD),
            ("dwFileVersionLS", wintypes.DWORD),
        ]

    class ProcessEntry32W(ctypes.Structure):
        _fields_ = [
            ("dwSize", wintypes.DWORD),
            ("cntUsage", wintypes.DWORD),
            ("th32ProcessID", wintypes.DWORD),
            ("th32DefaultHeapID", ctypes.c_size_t),
            ("th32ModuleID", wintypes.DWORD),
            ("cntThreads", wintypes.DWORD),
            ("th32ParentProcessID", wintypes.DWORD),
            ("pcPriClassBase", ctypes.c_long),
            ("dwFlags", wintypes.DWORD),
            ("szExeFile", ctypes.c_wchar * 260),
        ]

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    kernel32.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
    kernel32.Process32FirstW.argtypes = [wintypes.HANDLE, ctypes.c_void_p]
    kernel32.Process32NextW.argtypes = [wintypes.HANDLE, ctypes.c_void_p]
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel32.TerminateProcess.argtypes = [wintypes.HANDLE, wintypes.UINT]
    kernel32.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel32.WaitForSingleObject.restype = wintypes.DWORD
    kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel32.QueryFullProcessImageNameW.argtypes = [
        wintypes.HANDLE,
        wintypes.DWORD,
        wintypes.LPWSTR,
        ctypes.POINTER(wintypes.DWORD),
    ]

    def file_version(pid):
        handle = kernel32.OpenProcess(process_query_limited_information, False, pid)
        if not handle:
            return None, int(ctypes.get_last_error())
        try:
            size = wintypes.DWORD(1024)
            path = ctypes.create_unicode_buffer(1024)
            if not kernel32.QueryFullProcessImageNameW(
                handle, 0, path, ctypes.byref(size)
            ):
                return None, int(ctypes.get_last_error())
        finally:
            kernel32.CloseHandle(handle)
        ver = ctypes.WinDLL("version", use_last_error=True)
        ver.GetFileVersionInfoSizeW.argtypes = [wintypes.LPCWSTR, ctypes.c_void_p]
        ver.GetFileVersionInfoSizeW.restype = wintypes.DWORD
        ver.GetFileVersionInfoW.argtypes = [
            wintypes.LPCWSTR,
            wintypes.DWORD,
            wintypes.DWORD,
            ctypes.c_void_p,
        ]
        ver.VerQueryValueW.argtypes = [
            ctypes.c_void_p,
            wintypes.LPCWSTR,
            ctypes.POINTER(ctypes.c_void_p),
            ctypes.POINTER(wintypes.UINT),
        ]
        length = ver.GetFileVersionInfoSizeW(path.value, None)
        if not length:
            return None, int(ctypes.get_last_error())
        data = ctypes.create_string_buffer(length)
        if not ver.GetFileVersionInfoW(path.value, 0, length, data):
            return None, int(ctypes.get_last_error())
        block = ctypes.c_void_p()
        block_len = wintypes.UINT()
        if not ver.VerQueryValueW(
            data, chr(92), ctypes.byref(block), ctypes.byref(block_len)
        ):
            return None, int(ctypes.get_last_error())
        fixed = ctypes.cast(block, ctypes.POINTER(FixedFileInfo)).contents
        high = int(fixed.dwFileVersionMS)
        low = int(fixed.dwFileVersionLS)
        return [high >> 16, high & 0xFFFF, low >> 16, low & 0xFFFF], 0

    def failure_name(exc):
        return type(exc).__name__

    budget_ms = 3 * exit_wait_ms
    deadline = time.monotonic() + budget_ms / 1000.0

    def remaining_ms():
        return max(0, int((deadline - time.monotonic()) * 1000))

    snapshot = kernel32.CreateToolhelp32Snapshot(th32cs_snapprocess, 0)
    if snapshot is None or snapshot == ctypes.c_void_p(-1).value:
        raise OSError(ctypes.get_last_error(), "process snapshot failed")
    pids = []
    enumerated = 0
    enumerate_error = 0
    try:
        entry = ProcessEntry32W()
        entry.dwSize = ctypes.sizeof(ProcessEntry32W)
        more = kernel32.Process32FirstW(snapshot, ctypes.byref(entry))
        if not more:
            enumerate_error = int(ctypes.get_last_error())
        while more:
            enumerated += 1
            if entry.szExeFile.lower() == image:
                pids.append(int(entry.th32ProcessID))
            more = kernel32.Process32NextW(snapshot, ctypes.byref(entry))
    finally:
        kernel32.CloseHandle(snapshot)

    attempted = 0
    terminated = 0
    exited = 0
    unprocessed = 0
    open_errors = []
    terminate_errors = []
    pid_errors = []
    file_versions = []
    file_version_errors = []
    file_version_exc = []
    handles = []
    ended = []
    try:
        for index, pid in enumerate(pids):
            if remaining_ms() <= 0:
                unprocessed = len(pids) - index
                break
            try:
                version, version_error = file_version(pid)
                version_exc = None
            except Exception as exc:
                version, version_error, version_exc = None, -1, failure_name(exc)
            file_versions.append(version)
            file_version_errors.append(version_error)
            file_version_exc.append(version_exc)
            try:
                handle = kernel32.OpenProcess(
                    process_terminate | synchronize, False, pid
                )
                if not handle:
                    open_errors.append(int(ctypes.get_last_error()))
                    continue
                handles.append(handle)
                attempted += 1
                if kernel32.TerminateProcess(handle, 1):
                    terminated += 1
                    ended.append(handle)
                else:
                    terminate_errors.append(int(ctypes.get_last_error()))
            except Exception as exc:
                pid_errors.append(failure_name(exc))
        for handle in ended:
            try:
                wait_ms = min(exit_wait_ms, remaining_ms())
                if kernel32.WaitForSingleObject(handle, wait_ms) == wait_object_0:
                    exited += 1
            except Exception as exc:
                pid_errors.append(failure_name(exc))
    finally:
        for handle in handles:
            try:
                kernel32.CloseHandle(handle)
            except Exception as exc:
                pid_errors.append(failure_name(exc))
    return json.dumps(
        dict(
            matched=len(pids),
            terminated=terminated,
            exited=exited,
            attempted=attempted,
            unprocessed=unprocessed,
            enumerated=enumerated,
            enumerate_error=enumerate_error,
            open_errors=open_errors,
            terminate_errors=terminate_errors,
            pid_errors=pid_errors,
            file_versions=file_versions,
            file_version_errors=file_version_errors,
            file_version_exc=file_version_exc,
        )
    )
"""

# How long the remote source waits for EACH terminated terminal to exit. The one
# remote crossing is bounded by the rpyc `sync_request_timeout` (30s on the worker
# chain), so this stays far below it; the relaunch that follows is a SEPARATE
# round-trip carrying its own registered `initialize` ceiling.
#
# ⛔ WR-06 (164.6.5 review round 2) — THE WAIT IS NOT THE WHOLE COST. The source
# spends at most THREE exit waits in total (`budget_ms = 3 * exit_wait_ms`),
# however many processes matched: it ends every process first and only then
# waits, each wait shrunk to what is left of the budget, and it stops STARTING
# new processes once the budget is spent (reporting them as `unprocessed`). The
# verb sends `min(_TERMINAL_EXIT_WAIT_MS, request_timeout / _TERMINAL_EXIT_WAIT_
# DIVISOR)`, so three waits fit in HALF of THIS client's `sync_request_timeout`
# and the other half covers the Win32 calls, whose cost under Wine is
# unmeasured. Before this, eight stray `terminal64.exe` modelled 40 s inside a
# 30 s request, and the timeout discarded the counts of terminates that landed.
_TERMINAL_EXIT_WAIT_MS = 5000
_TERMINAL_EXIT_WAIT_DIVISOR = 6

# R2-SFH-04 — a diagnostic field the client could not read. It replaces THAT
# field only, on the line and in the verdict; it never costs the counts.
_RECYCLE_UNPARSED = "unparsed"
# R2-SFH-07 — the only string shape a class-name field may carry: a Python
# identifier. A message or a path is not one, so remote free text cannot pass.
_RECYCLE_CLASS_NAME_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]{0,63}")


def _recycle_int_list(value: Any) -> list[int]:
    if not isinstance(value, list):
        raise TypeError("not a list")
    return [int(code) for code in value]


def _recycle_int(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise TypeError("not an int")
    return value


def _recycle_versions(value: Any) -> list[list[int] | None]:
    # SFH-04 — four ints per matched process, or None; never a path.
    if not isinstance(value, list):
        raise TypeError("not a list")
    return [None if v is None else [int(part) for part in v][:4] for v in value]


def _recycle_class_name(value: Any) -> str:
    if not isinstance(value, str) or not _RECYCLE_CLASS_NAME_RE.fullmatch(value):
        raise ValueError("not a class name")
    return value


def _recycle_class_names(value: Any) -> list[str | None]:
    if not isinstance(value, list):
        raise TypeError("not a list")
    return [None if v is None else _recycle_class_name(v) for v in value]


def _parse_recycle_diagnostics(counts: dict[str, Any]) -> dict[str, Any]:
    """Every field of the recycle verdict BESIDES the three counts, each parsed on
    its own. ⛔ R2-SFH-04: this cannot raise. A field that is missing or has an
    unexpected shape becomes ``"unparsed"`` and the others are kept, because by
    the time it runs every ``TerminateProcess`` has already happened and the
    counts must reach the log whatever the diagnostics look like."""
    parsers: tuple[tuple[str, Callable[[Any], Any]], ...] = (
        ("attempted", _recycle_int),
        ("unprocessed", _recycle_int),
        ("enumerated", _recycle_int),
        ("enumerate_error", _recycle_int),
        ("open_errors", _recycle_int_list),
        ("terminate_errors", _recycle_int_list),
        ("pid_errors", _recycle_class_names),
        ("file_versions", _recycle_versions),
        ("file_version_errors", _recycle_int_list),
        ("file_version_exc", _recycle_class_names),
    )
    parsed: dict[str, Any] = {}
    for key, parse in parsers:
        try:
            parsed[key] = parse(counts[key])
        except Exception:
            # Deliberately broad: a diagnostic's shape is unmeasured live, and
            # any surprise here must degrade to the placeholder, never unwind
            # past a terminate that already landed.
            parsed[key] = _RECYCLE_UNPARSED
    return parsed


# 164.6.5 review round 2, WR-03 ROOT CAUSE (2026-09-25) — THE HEAL'S SESSION
# SNAPSHOT, READ BRIDGE-SIDE IN ONE RPYC CROSSING.
#
# ⛔ WHY IT EXISTS. `terminal_info()` / `account_info()` hand back a netref
# namedtuple that `_materialize` walks on THIS side of the wire, one crossing per
# field (the MT5DEAL-01 cost model, see `_REMOTE_MATERIALIZE_SRC`): 29 and 35
# crossings at the package's documented field counts. The terminal heal
# (`mt5_relogin`) budgets in rpyc crossings at their 30 s ceiling, so at that cost
# its pre-recycle evidence capture and its post-relaunch house-session check fit no
# budget under the 300 s ceiling and were SKIPPED ON EVERY RUN (round 2 WR-03,
# commit 7662d7d8b). This expression reads both, keeps only the fields the heal
# uses, and returns them as a plain TUPLE OF SCALARS, which rpyc's brine copies
# BY VALUE. One `conn.eval` is one crossing, bounded by `sync_request_timeout`
# however many MetaTrader5 calls it makes on the far side.
#
# ⛔ A PLAIN LITERAL EXPRESSION, NOT AN F-STRING, AND NEVER ASSEMBLED AT RUN TIME
# (the rpyc channel is the unauthenticated arbitrary-remote-code channel T-134-03
# names, as for `_REMOTE_TERMINAL_RECYCLE_SRC`). It takes NO argument at all: the
# environment's login and server never cross the wire. It carries no brace, and
# `tests/test_mt5_client_contract.py` pins that, that it is an AST string
# constant, and that the only MetaTrader5 calls in it are `terminal_info`,
# `account_info` and `last_error`.
#
# ⛔ IT IS EVALUATED IN THE BRIDGE'S CLASSIC NAMESPACE, where `mt5linux` 0.1.9
# itself binds the package as `mt5` (every mt5linux call is a
# `conn.eval('mt5.<name>(...)')` there; `_credential_renderings` records the same
# shape for `initialize`). That binding is what it reads through.
#
# What it returns, one of three shapes, tagged:
#   ("terminal_unanswered", <last_error code>)            — `account_info` NOT read:
#                                                           a terminal that cannot
#                                                           answer one cannot answer
#                                                           the other
#   ("account_unanswered", build, connected, <code>)
#   ("answered", build, connected, login, server)
# `last_error()` is read on the far side IMMEDIATELY after the `None`, as
# `_raise_last` does, and only its CODE crosses, never its text. Every field is
# coerced the way `_coerce` does, so a non-scalar never turns the tuple into a
# netref. A field the answer does not carry reads as `None` (`getattr` with a
# default), exactly what the heal's former `.get()` on the materialized dict
# gave it, so the heal records THAT field `not_captured` and keeps the others.
# A far-side raise (a dead IPC mid-read) is turned into a scrubbed
# `Mt5ClientError` by `_guarded_read`.
#
# ⚠️ Never exercised against the live bridge (`.planning/WINDOWS.md` entry 68).
_REMOTE_SESSION_SNAPSHOT_SRC = """
(lambda scalar: (lambda terminal:
    ("terminal_unanswered", scalar(mt5.last_error()[0]))
    if terminal is None
    else (lambda build, connected, account:
        ("account_unanswered", build, connected, scalar(mt5.last_error()[0]))
        if account is None
        else ("answered", build, connected,
              scalar(getattr(account, "login", None)),
              scalar(getattr(account, "server", None)))
    )(scalar(getattr(terminal, "build", None)),
      scalar(getattr(terminal, "connected", None)),
      mt5.account_info())
)(mt5.terminal_info()))(
    lambda value: value
    if value is None or isinstance(value, (bool, int, float, str))
    else str(value)
)
"""


class Mt5SessionSnapshot(NamedTuple):
    """What ``Mt5Client.session_snapshot`` read, reduced to what the heal uses.

    ⛔ NO ACCOUNT NUMBER AND NO SERVER NAME. The session's login and server are
    compared with the caller's expected values inside the client and only the
    EQUALITY VERDICTS are kept (T-164.6.2-12).

    ``terminal_code`` is ``None`` when ``terminal_info()`` answered, else the
    ``last_error()`` code read after it (``0`` when that code was unreadable).
    ``account_code`` is the same for ``account_info()``, and ``account_read`` is
    ``False`` when it was not read because the terminal did not answer. ``build``
    is ``None`` unless the terminal reported an int, ``connected`` unless it
    reported a bool. ``login_matches`` is ``None`` when the session carried no
    int login or no expected login was given; ``server_matches`` is ``None`` when
    the session carried no server.
    """

    terminal_code: int | None
    build: int | None
    connected: bool | None
    account_read: bool
    account_code: int | None
    login_matches: bool | None
    server_matches: bool | None


def _snapshot_code(value: Any) -> int:
    """A ``last_error()`` code from the snapshot. Anything but an int is the
    ``0`` sentinel, the one ``_raise_last`` uses for an unreadable answer."""
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


def _parse_session_snapshot(
    raw: Any, expected_login: int | None, expected_server: str
) -> Mt5SessionSnapshot:
    """Validate the snapshot tuple and reduce it to verdicts. ⛔ ``type(raw) is
    tuple`` first: a result that came back as a netref (something on the far side
    was not brine-dumpable) is refused WITHOUT being indexed, since each index of
    a netref is another crossing."""
    if type(raw) is not tuple or not raw:
        raise Mt5ClientError(0, "MT5 session snapshot returned a malformed shape")
    tag = raw[0]
    if tag == "terminal_unanswered" and len(raw) == 2:
        return Mt5SessionSnapshot(
            terminal_code=_snapshot_code(raw[1]),
            build=None,
            connected=None,
            account_read=False,
            account_code=None,
            login_matches=None,
            server_matches=None,
        )
    if tag not in ("account_unanswered", "answered") or len(raw) != (
        4 if tag == "account_unanswered" else 5
    ):
        raise Mt5ClientError(0, "MT5 session snapshot returned a malformed shape")
    build = raw[1] if isinstance(raw[1], int) and not isinstance(raw[1], bool) else None
    connected = raw[2] if isinstance(raw[2], bool) else None
    if tag == "account_unanswered":
        return Mt5SessionSnapshot(
            terminal_code=None,
            build=build,
            connected=connected,
            account_read=True,
            account_code=_snapshot_code(raw[3]),
            login_matches=None,
            server_matches=None,
        )
    login, server = raw[3], raw[4]
    login_matches = (
        login == expected_login
        if expected_login is not None
        and isinstance(login, int)
        and not isinstance(login, bool)
        else None
    )
    server_matches = (
        server == expected_server if isinstance(server, str) and server else None
    )
    return Mt5SessionSnapshot(
        terminal_code=None,
        build=build,
        connected=connected,
        account_read=True,
        account_code=None,
        login_matches=login_matches,
        server_matches=server_matches,
    )


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
        # ------------------------------------------------------------------ #
        # WIZFORM-ABANDON / D-36 AMENDED (ii) — THE CONSTRUCTION FENCE.
        #
        # The method fence cannot reach findings #6a/#6b: there, the abandoned
        # thread is parked inside THIS blocking connect and makes no subsequent
        # session call, so there is no method for `_assert_live` to sit in front
        # of. And nobody is left holding the result — `routers/exchange.py`'s
        # Pitfall-6 `finally` sees `client is None` and releases NOTHING, and the
        # adapter's connect sits deliberately outside its close-`finally` ("there
        # is no client to close yet") — so the rpyc session is orphaned against
        # the gateway's `ThreadedServer` with no owner and no reaper.
        #
        # ⭐ THE TOKEN, NOT AN EPOCH SNAPSHOT, AND THAT IS THE WHOLE POINT. This
        # reads the lease-occupancy ContextVar `asyncio.to_thread` FROZE into the
        # zombie's thread at spawn. A construction-time epoch snapshot would
        # false-positive on `job_worker._make_mt5_session`, which builds its
        # client in PREFLIGHT — outside and before the lease — so an unrelated
        # release in that window would refuse a legitimate derive read. Here a
        # preflight build holds no lease, therefore carries NO token, therefore is
        # exempt: not a special case somebody maintains, but the honest encoding
        # of "this construction is not happening under anyone's lease"
        # (RESEARCH Open Q-1). ⛔ Which is also why there is no
        # `fence_construction=` constructor parameter — that opt-in alternative
        # was REJECTED with the Q-1 resolution.
        #
        # ⚠️ `occupancy_epoch` is NOT `self._epoch`. This one is the generation the
        # SPAWNING LEASE was on; `self._epoch` is the generation this session's
        # FIRST TOUCH lands on and stays `None` here (the lazy bind is load-bearing
        # for the same preflight reason — RESEARCH Pitfall 2 warns against
        # conflating the two, so they are named distinctly).
        #
        # A token for a DIFFERENT terminal is treated as no token at all: the
        # fence makes no claim across terminals.
        # ------------------------------------------------------------------ #
        occupancy = _MT5_LEASE_OCCUPANCY.get()
        occupancy_epoch: int | None = (
            occupancy[1]
            if occupancy is not None and occupancy[0] == self.terminal_key
            else None
        )
        if occupancy_epoch is not None and (
            _mt5_epoch_for(self.terminal_key) != occupancy_epoch
        ):
            # PRE-CONNECT. The answer is already known, so open nothing: a socket
            # never opened is a socket that cannot leak.
            logger.warning(
                "Mt5Client.__init__: refusing to connect — the lease this "
                "construction was spawned under (generation %d) has already "
                "released and the terminal is now on generation %d, so this "
                "client would belong to nobody (WIZFORM-ABANDON / D-36).",
                occupancy_epoch,
                _mt5_epoch_for(self.terminal_key),
            )
            raise Mt5SessionAbandoned("connect")
        self._mt5 = connect(host=host, port=port, timeout=request_timeout_s)
        self._closed = False
        # WIZFORM-ABANDON / D-36: the terminal generation this session belongs to.
        # ⛔ UNBOUND at construction and bound LAZILY on the first session touch —
        # see `_assert_live` for why an eager bind here would be a defect.
        self._epoch: int | None = None
        if occupancy_epoch is not None and (
            _mt5_epoch_for(self.terminal_key) != occupancy_epoch
        ):
            # POST-CONNECT — the #6 shape proper: the bound fired and the lease
            # released WHILE this blocking connect was on the wire.
            #
            # ⛔ THE TEARDOWN IS MANDATORY, NOT A COURTESY. A bare raise here
            # strands the socket we just opened, which is the Pitfall-6 leak in a
            # new costume — the exact leak this fence exists to close. The verb is
            # reachable because `_teardown_transport` is deliberately EXEMPT from
            # the method fence (D-41).
            logger.warning(
                "Mt5Client.__init__: the lease this construction was spawned "
                "under (generation %d) released while the connect was in flight "
                "and the terminal is now on generation %d — disposing the socket "
                "nobody is left to receive (WIZFORM-ABANDON / D-36).",
                occupancy_epoch,
                _mt5_epoch_for(self.terminal_key),
            )
            self._teardown_transport(
                self._mt5, who="Mt5Client.__init__(abandoned)", stage=None
            )
            self._closed = True
            raise Mt5SessionAbandoned("connect")

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
        except Mt5SessionAbandoned:
            # ⛔ NOT a `mt5.stage` event. A refusal is not a round-trip; emitting
            # one would pollute the `duration_ms` population Phase 155 depends on
            # with zero-duration non-calls. If a COUNT is ever wanted it needs a
            # distinct event name. (153.6 / B3 — the sentence is `_assert_live`'s
            # own, quoted deliberately: the two fences must state ONE contract.)
            #
            # ⭐ WHY THE ARM IS HERE AND NOT AT THE ONE CALL SITE. `restart()`'s
            # check 1 already sits OUTSIDE this bracket for exactly this reason,
            # and every `_assert_live` fence is written ahead of its `_timed` for
            # it too — but check 2 CANNOT be: three cleanup invariants must run
            # before its raise, so it is inline and inside. Making the contract
            # structural HERE means it holds for every stage, including whichever
            # fence somebody adds inside a bracket next.
            #
            # ⛔ FENCE TYPE ONLY, and that is the whole safety argument.
            # `Mt5SessionAbandoned` is raised at exactly four sites, all our own
            # fences (`__init__` x2, `_assert_live`, `restart`'s check 2 —
            # grep-verified), so nothing from transport can hide behind it.
            # Widening this to `Exception` would delete the FAILURE half of the
            # D-32 population, which is the censored measurement D-32 exists to
            # replace; `tests/test_mt5_client_contract.py`'s positive control
            # reds if anyone tries.
            #
            # Re-raised bare: same object, same type, same `__traceback__`.
            raise
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

    def _raise_last(
        self,
        *,
        credentials: tuple[int, str, str] | None = None,
        answered_type: type[Mt5ClientError] = Mt5ClientError,
    ) -> NoReturn:
        """Capture `last_error()` IMMEDIATELY (the next remote call overwrites it)
        and raise a typed, secret-scrubbed error.

        ⛔ `credentials` CLOSES [164.6.2-RAISE-LAST-SHAPE-ONLY] AT THE ONE SHARED SITE
        (Phase 164.6.4 criterion 5, founder decision 2026-09-15). The detail this method
        raises is the TERMINAL's own `last_error()` text, and `Mt5ClientError.__init__`
        scrubs it by SHAPE only — a measured NO-OP on the `mt5linux` kwargs-repr shape.
        A broker echoing the submitted account or server back into that text disclosed
        it. With the triple in scope every one of this method's THREE raise points now
        redacts BY VALUE through the shipped `_redact_credential_values`, via
        `_redact_with_optional_credentials`.

        ⚠️ STATE THE PROMISE HONESTLY: this method has EIGHT callers, not two. Fixing it
        here means every credential-CARRYING caller benefits, at one site, by
        construction — NOT that every caller benefits. The five that hold no credential
        (`assert_session_authorized`, `account_info`, `terminal_info`,
        `history_deals_get`, `order_check`) pass nothing and keep today's shape-only
        scrub, which is correct for them: there is no value to redact by.

        ⛔ KEYWORD-ONLY, and ⛔ the client caches NO credential of its own. Keyword-only
        so a positional mistake at any of the eight call sites is a `TypeError` rather
        than a silent mis-bind. A cached credential would turn a formatter into a
        credential holder — exactly the surface criterion 5 is shrinking.

        ⚠️ THE PARAMETER'S NAME AND SHAPE ARE A DECISION, NOT AN ACCIDENT.
        `tests/test_mt5_client_contract.py` classifies every `Mt5Client` method FROM
        SOURCE: positional params spelling the login/password/server triple with no
        keyword-only params make a method DRIVABLE, and the redaction driver then
        demands its credential-carrying transport call raise — `_raise_last` makes no
        such call, so that would red. A differently-spelled password parameter would
        make it RESIDUAL, which another gate asserts is empty. A keyword-only
        `credentials` TUPLE is NEITHER, and that is right rather than a dodge: the
        gate's class is "methods that hand a credential to a transport call", and this
        method hands credentials to nothing — it only formats.

        ``answered_type`` (Phase 167 CR-01) chooses the class of the ONE raise that
        carries the terminal's own ``last_error()`` answer — the last raise below.
        ``login``'s falsy arm passes ``Mt5LoginRefusedError`` so a refused sign-in is
        distinguishable by TYPE from every other stage's failure. ⛔ It deliberately
        does NOT apply to the two earlier raises, nor to a malformed answer: when the
        ``last_error()`` round-trip itself dies, answers nothing, or answers in a
        shape we cannot read, the terminal told us nothing about the login, and a
        transport drop must never be reported as a refused sign-in.
        The message and the redaction are identical for every class.
        """
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
            raise Mt5ClientError(
                0, _redact_with_optional_credentials(str(exc), credentials)
            ) from None
        if not err:
            raise Mt5ClientError(
                0, _redact_with_optional_credentials("unknown", credentials)
            )
        # A truthy-but-malformed shape (wrong-length tuple, non-subscriptable
        # scalar, dict, non-int code) must NOT escape as a raw
        # IndexError/TypeError/KeyError/ValueError — that would bypass the single
        # typed fail-loud choke point. Coerce defensively.
        try:
            code, text = int(err[0]), str(err[1])
        except (TypeError, IndexError, KeyError, ValueError):
            code, text = 0, "unknown (malformed last_error shape)"
            # ⛔ 167 SFH MEDIUM-1 — a malformed answer is the terminal telling us
            # NOTHING about the login, exactly like the two raises above, so it
            # must never carry the sign-in marker. Without this the coerced
            # code 0 passes `is_mt5_login_refusal` and a garbled bridge reply
            # is reported as a refused sign-in.
            answered_type = Mt5ClientError
        # ⛔ THE CODE IS PRESERVED THROUGH THE REDACTION. A heal that lost `-6` is
        # undebuggable from a log, and `-6` is the ONE fault this phase's detector
        # distinguishes — only the freeform TEXT is rewritten.
        raise answered_type(
            code, _redact_with_optional_credentials(text, credentials)
        )

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
            # Criterion 5 — the terminal's own `last_error()` text can echo the
            # submitted account or server back at us. The triple is in scope here, so
            # the shared raise site redacts it BY VALUE.
            self._raise_last(credentials=(login, password, server))
        # ⭐ 164.6.5 SFH-05 — the job path's bare `initialize()` answering is the
        # terminal answering, whoever asked. See `_MT5_TERMINAL_ANSWERS`.
        _note_terminal_answered(self.terminal_key)
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
            # D-07 AMENDED (founder, 2026-09-14) — this arm now routes through the
            # SHARED helper instead of carrying its own copy of the loop. The freeze
            # existed to keep a shipped live-path method out of a REFACTOR; applying
            # the identical, already-proven escape-aware redaction is not one, and
            # [164.6.2-LOGIN-ESCAPE-BLIND] was a LIVE disclosure on the four
            # per-account callers: the old copy matched the RAW literal only, so a
            # password carrying any character repr() escapes survived into the
            # rendering (MEASURED: 'pa\\ssw0rd' reached the message intact).
            raise Mt5ClientError(
                0, _redact_credential_values(str(exc), login, password, server)
            ) from None
        if not ok:
            # Criterion 5 — as above. This is the arm a bad credential or a wrong
            # server actually lands on, so it is the likeliest to carry an echo.
            #
            # Phase 167 CR-01 — and it is the ONLY arm of this method where the
            # terminal answered the sign-in itself, so it alone raises the
            # `Mt5LoginRefusedError` marker. The `initialize()` arms above and the
            # transport-raise arm stay plain `Mt5ClientError`: no sign-in verdict
            # exists on those paths.
            self._raise_last(
                credentials=(login, password, server),
                answered_type=Mt5LoginRefusedError,
            )

    def assert_session_authorized(self) -> None:
        """Assert that the terminal currently HAS an authorized broker account —
        the CREDENTIAL-FREE detector (criterion 1(a), RESEARCH question FOUR).

        Returns ``None`` when the terminal answers; raises a typed
        ``Mt5ClientError`` carrying ``last_error()``'s CODE otherwise. That code is
        the whole point: a bare ``initialize()`` is the one probe that distinguishes
        the faults whose remedies are OPPOSITE.

          * ``-6`` — no account is authorized. The saved Wine session was refused
            (rotation, expiry, a broker-side event), the RPyC bridge is HEALTHY, and
            this is the ONE fault this phase heals — by re-running ``initialize()``
            in its CREDENTIALED form (``initialize_with_credentials`` below).
          * ``-10003`` / ``-10004`` / ``-10005`` — IPC faults. The terminal is
            wedged, unreachable or sitting behind a modal dialog. Re-sending a
            credential heals NOTHING there and a caller that healed unconditionally
            would re-collapse exactly the distinction Phase 164.1 built.

        ⛔ NO credential is passed, and none may ever be added. A detector that
        carried a credential could not be used to DECIDE whether to send one — it
        would already have sent it — and the disclosure surface this phase spent a
        whole plan fencing would grow a second, unfenced mouth. The bare call is
        also the cheapest one available and, per ``login``'s ``[ASSUMED]``
        idempotence note (owner Phase 155 / MT5-VERIFY, not this phase), a no-op
        ``True`` when the terminal is already attached.

        Like every other MT5 round-trip here it carries an explicit millisecond
        ceiling from this instance's ``_ipc_timeouts_ms`` (registered under
        ``initialize`` in ``MT5_IPC_TIMEOUTS_MS``, ordering-checked at
        construction), so MT5 fails its own pipe before rpyc gives up (D-24).

        Its ``_timed`` stage is deliberately NOT ``initialize``: this probe runs on
        the boot path at a cadence nothing else shares, and folding its round-trips
        into the ``initialize`` duration population would contaminate the very
        measurement Phase 155 reads.
        """
        # WIZFORM-ABANDON / D-36 — FIRST executable statement, ahead of the `_timed`
        # bracket (so a refusal never enters the D-32 duration population) and ahead
        # of the except arm (so it cannot be rewritten into an `Mt5ClientError`).
        self._assert_live("session_authorized")
        try:
            inited = self._timed(
                "session_authorized",
                lambda: self._mt5.initialize(
                    timeout=self._ipc_timeouts_ms["initialize"]
                ),
            )
        except Mt5ClientError:
            raise
        except Exception as exc:  # noqa: BLE001 — never let raw transport text escape
            # Shape-based scrubbing ONLY, and that is correct HERE and only here:
            # no credential is in scope on this path, so there is no value to redact.
            raise Mt5ClientError(0, scrub_freeform_string(str(exc))) from None
        if not inited:
            self._raise_last()
        # ⭐ 164.6.5 SFH-05 — see `_MT5_TERMINAL_ANSWERS`.
        _note_terminal_answered(self.terminal_key)

    def initialize_with_credentials(
        self, login: int, password: str, server: str
    ) -> None:
        """Re-establish the TERMINAL's broker session by calling ``initialize()`` in
        its CREDENTIALED form — the heal verb (D-07, criterion 1(a)).

        ⛔ WHY THIS IS NOT ``Mt5Client.login``, and why it is a new method rather
        than an edit to that one. ``login()`` opens with a credential-LESS
        ``initialize()`` and raises on a falsy return, and a credential-less
        ``initialize()`` is EXACTLY the call that returns ``-6`` when the terminal
        has no authorized account. So ``login()`` raises before it ever reaches its
        own ``login()`` call and cannot heal the fault this phase exists for
        (probed live, 2026-09-13). The documented call form that CAN clear a ``-6``
        is ``initialize(login=…, password=…, server=…)``, which is what this method
        sends. It lands beside ``login()`` and not inside it because ``login()``'s
        four per-account callers are shipped and working (D-03/D-07) and a
        regression there would land on live job processing.

        ⛔ THE REDACTION IS NOT OPTIONAL AND IS THE REASON THIS METHOD'S PLAN RAN
        FIRST (T-134-01). ``mt5linux`` 0.1.9 f-string-interpolates its arguments
        into remotely-eval'd source, so the moment a password is passed here a raw
        rpyc remote traceback is a real credential disclosure — on a PUBLIC Actions
        log. BOTH failure arms therefore redact the three values BY VALUE on top of
        the shape-based scrub (``_redact_credential_values``): the transport-raise arm
        calls it DIRECTLY, and the falsy arm gets it from the shared ``_raise_last``,
        which now takes the triple.

        ⭐ THE ASYMMETRY WITH ``login()``'s FALSY ARM IS CLOSED, and this paragraph used
        to say the opposite. It recorded the asymmetry as "measured and deliberate"
        because "closing it would mean editing ``login()``, which D-07 forbids" —
        false as of Phase 164.6.4 criterion 5 (founder decision 2026-09-15, routed in
        from Phase 164.6.2 criterion 9, booked as [164.6.2-RAISE-LAST-SHAPE-ONLY], now
        CLOSED). What closed it was PARAMETERISING THE SHARED SITE rather than editing
        ``login()``'s body: D-07's freeze existed to keep a shipped live-path method
        out of a REFACTOR, and adding a keyword-only argument to a helper both verbs
        already call is not one. ⛔ It had to close here rather than later: this verb is
        what the keepalive drives ON A CADENCE, so leaving it open would have
        multiplied how often a known disclosure path can fire, forever.

        ⛔ The return value is NOT inspected beyond truthiness and must never be
        treated as proof the heal worked: the oracle for "is the session
        authorized" is the NEXT probe (``assert_session_authorized``), never this
        call's own boolean.

        ⚠️ The ``login``/``password``/``server`` KEYWORD names are the verbatim part
        that matters — they are forwarded unchanged into the real ``MetaTrader5``
        module, and no positional form is documented to work. The ``initialize``
        millisecond ceiling rides along from ``_ipc_timeouts_ms`` exactly as every
        other MT5 call's does (D-24).
        """
        # WIZFORM-ABANDON / D-36 — FIRST executable statement, for the same two
        # reasons as `login`'s: ahead of the `_timed` bracket and ahead of the
        # except arms that would otherwise absorb the refusal into a typed error.
        self._assert_live("initialize_credentialed")
        try:
            inited = self._timed(
                "initialize_credentialed",
                lambda: self._mt5.initialize(
                    login=login,
                    password=password,
                    server=server,
                    timeout=self._ipc_timeouts_ms["initialize"],
                ),
            )
        except Mt5ClientError:
            # ⛔ AN UNREDACTED PASS-THROUGH, AND THE ASYMMETRY WITH THE BROAD ARM
            # BELOW IS SAFE ONLY FOR A REASON WORTH WRITING DOWN (IN-01).
            # UNREACHABLE TODAY: nothing inside `self._timed(...)` can CONSTRUCT
            # an `Mt5ClientError` — `_timed` only re-raises, and `self._mt5` is
            # the raw mt5linux proxy. So the only `Mt5ClientError` that can arrive
            # here is one WE built elsewhere, already scrubbed at construction.
            # ⚠️ IF THAT EVER CHANGES — a future `_timed`/transport wrapper that
            # WRAPS a raw remote traceback into an `Mt5ClientError` — this arm
            # becomes a disclosure: the message would carry only the SHAPE scrub
            # `Mt5ClientError.__init__` applies, and `_redact_credential_values`'s
            # own docstring records that scrub as a measured NO-OP on the
            # mt5linux kwargs-repr shape. Route it through the by-value redaction
            # then; do not widen this arm and hope.
            raise
        except Mt5SessionAbandoned:
            # ⛔ EXPLICIT, ahead of the broad arm below. `Mt5SessionAbandoned` is a
            # PLAIN Exception on purpose (D-42) so an OUR-INFRASTRUCTURE refusal can
            # never be re-classified as a user credential fault; letting the
            # `except Exception` arm wrap it into an `Mt5ClientError` is precisely
            # the absorption that type choice exists to make impossible.
            raise
        except Exception as exc:  # noqa: BLE001 — never let raw transport text escape
            raise Mt5ClientError(
                0, _redact_credential_values(str(exc), login, password, server)
            ) from None
        if not inited:
            # ⛔ THE ARM CRITERION 5 MOVED INTO THE SHARED SITE (Phase 164.6.4, founder
            # decision 2026-09-15). `_raise_last` builds its detail from the TERMINAL's
            # own `last_error()` text, which `Mt5ClientError` scrubs by SHAPE only, so a
            # broker echoing the submitted account or server back in that text would
            # disclose it. It now redacts BY VALUE itself, given the triple — so the
            # catch/unwrap/re-raise this arm used to carry collapses to one call.
            #
            # Two consequences of the collapse, both improvements and both deliberate:
            #
            #   * THE ORIGINAL CODE SURVIVES BY CONSTRUCTION. `_raise_last` raises the
            #     terminal's own code and nothing re-wraps it. The deleted block
            #     preserved the code too, but only by stripping the typed prefix with
            #     `removeprefix` — whose own comment admitted it degrades to a no-op if
            #     the message format ever changes. There is no longer a string shape to
            #     depend on.
            #   * `Mt5SessionAbandoned` NOW ESCAPES UNTOUCHED STRUCTURALLY (D-42).
            #     `_raise_last` opens with its own `_assert_live`, so a refusal can
            #     arise on this line; the narrow `except Mt5ClientError` existed to keep
            #     it from being re-classified as a user credential fault. Deleting the
            #     catch entirely makes that structural more cheaply than the narrow arm
            #     did — there is nothing left that could absorb it.
            self._raise_last(credentials=(login, password, server))

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
          * ``trade_allowed`` — the terminal-level AutoTrading permission,
            i.e. the Expert-Advisors *"Allow algorithmic trading"* option
            (``Enabled`` in ``Config/terminal.ini`` ``[Experts]``). With it off,
            ``order_check`` is refused REGARDLESS of investor vs master, so a
            MASTER password produces exactly the two negatives an investor
            password produces.

            ⚠️ 161-02 CORRECTION: this flag does NOT subsume the separate
            *"Disable automatic trading through the external Python API"* option
            (``Api`` in the same block), which MetaQuotes ships **ON by default,
            "for security reasons"** and which the terminal reports on its own
            key, ``tradeapi_disabled``. Founder-measured on the live gateway
            2026-08-13: ``tradeapi_disabled`` was False while ``trade_allowed``
            was false — two independent switches, each sufficient on its own.
            The gateway re-sets ``Enabled`` off on every account change
            (``Account=1``/``Profile=1``), which is why the fault recurs.

            ⛔ CORRECTED 2026-09-25 (164.6.5; the sentence above is kept as
            lineage): the re-clear is CONDITIONAL, not on every account change.
            It happens only while the Experts option *"Disable algorithmic
            trading when the account has been changed"* (``[Experts]
            Account=1``) — or its profile sibling (``Profile=1``) — is TICKED.
            The founder read the gateway's Experts tab on 2026-09-24: *"Allow
            algorithmic trading"* checked and all four *"Disable ..."* options
            UNCHECKED, and a real authorization on 2026-09-16 left the options
            byte-identical. So the fault recurs when that box is ticked (the
            D-15 landmine), not because an account changed.

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

    def session_snapshot(
        self, *, expected_login: int | None, expected_server: str
    ) -> Mt5SessionSnapshot:
        """The terminal heal's session read, in ONE rpyc crossing (164.6.5 review
        round 2, WR-03 root cause).

        It reads what ``terminal_info()`` and ``account_info()`` would, on the far
        side of the wire through the committed ``_REMOTE_SESSION_SNAPSHOT_SRC``,
        and keeps only the fields the heal uses: the terminal ``build``, whether
        it is ``connected``, and whether the session's login and broker server
        EQUAL the expected ones. See the constant for why: materialized here, the
        two reads cost one crossing per field, and the heal could never afford
        them.

        ⛔ VERDICTS, NEVER VALUES. The session's account number and server name
        are compared here and dropped; neither is returned or logged. The
        expected values are used locally only: the remote source takes no
        argument, so nothing of the caller's crosses the wire. Keyword-only so a
        positional mistake is a ``TypeError``.

        ⛔ A terminal that does not answer is RETURNED (``terminal_code`` /
        ``account_code``), not raised, because the heal records it and carries on.
        A dead transport, a far-side raise or a malformed result RAISES a typed,
        scrubbed ``Mt5ClientError``, like every read.

        The existing ``terminal_info()`` / ``account_info()`` are unchanged; the
        validate path needs their full dicts.
        """
        # WIZFORM-ABANDON / D-36 — ahead of `_guarded_read` and `_timed`.
        self._assert_live("session_snapshot")
        conn = getattr(self._mt5, "_MetaTrader5__conn", None)
        if conn is None:
            # The same seam `_materialize_rows` depends on. Falling back to the
            # per-field reads would re-open WR-03 invisibly, so fail loud.
            raise Mt5ClientError(
                0, "MT5 rpyc transport is not reachable for the session snapshot"
            )

        def _remote_call() -> Any:
            return conn.eval(_REMOTE_SESSION_SNAPSHOT_SRC)

        raw = self._guarded_read(_remote_call, stage="session_snapshot")
        return _parse_session_snapshot(raw, expected_login, expected_server)

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
        return self._materialize_rows(deals)

    def _materialize_rows(self, deals: Any) -> list[dict[str, Any]]:
        """Materialize a netref tuple of deals in ONE wire crossing (MT5DEAL-01).

        ⭐ WHY THIS IS NOT `[_materialize(d) for d in deals]`. That comprehension
        reads like local work and is not: `deals` is an rpyc NETREF, so iterating it
        is a round-trip per element, `d._asdict()` is another, and every `k, v` of
        the returned remote mapping is another pair. MEASURED on the live gateway
        2026-08-13 from inside the worker container: **60ms per deal**, 29.9s for
        493 deals — against `_MT5_DERIVE_READ_TIMEOUT_S` (40s). That is why
        `derive_broker_dailies` failed FLIPRETRY-01 on every attempt for the first
        real account with history, while every stage event said `ok=true`: the cost
        was NOT in any single bounded call, so no rpyc `sync_request_timeout` (30s)
        could ever fire and no `mt5.stage` event covered it. The same probe measured
        this implementation at **18.5ms** for 495 deals.

        ⛔ The bound is NOT the thing to raise. The old cost is O(deals x fields)
        round-trips, so a bigger ceiling only buys a bigger account before the same
        failure returns (~15k deals exhausts the 900s outer derive budget), and the
        worker serializes on ONE shared Wine terminal, so the wait is charged to
        every other key too. This path is O(1) crossings + one payload, so the 40s
        bound goes back to being a WEDGE detector rather than an account-size limit.

        The per-deal work is shipped to the far side as source (`conn.execute`) and
        the result crosses once as a JSON `str` — a by-value type, so rpyc copies it
        instead of handing back another proxy. Re-executed per call rather than
        cached: `restart()` replaces the connection (and with it the namespace), and
        one extra round-trip is ~1ms against the 30s that caching would risk getting
        wrong after a reconnect.
        """
        # WIZFORM-ABANDON / D-36 — ahead of `_guarded_read` and `_timed`, and NOT
        # redundant with the fence `history_deals_get` already passed: the fetch it
        # sits behind takes seconds against a real account, which is exactly the
        # window in which a `wait_for` walks away and the lease passes to someone
        # else. Fencing only the fetch would leave this crossing driving the ONE
        # shared IPC pipe under the NEXT holder.
        self._assert_live("history_deals_materialize")
        conn = getattr(self._mt5, "_MetaTrader5__conn", None)
        if conn is None:
            # Same seam `close()`/`release()` depend on. Absent ⇒ we cannot push the
            # loop across the wire, and silently falling back to the client-side
            # comprehension would restore the 40s defect invisibly. Fail loud.
            raise Mt5ClientError(
                0, "MT5 rpyc transport is not reachable for deal materialization"
            )

        def _remote_call() -> str:
            conn.execute(_REMOTE_MATERIALIZE_SRC)
            return cast(str, conn.namespace[_REMOTE_MATERIALIZE_FN](deals))

        # Through `_guarded_read` for the SAME two reasons every other read is: a
        # remote traceback carries the interpolated source line (credential
        # disclosure, T-134-01) and must be scrubbed, and the stage bracket is the
        # instrumentation whose absence is what hid this defect for a whole phase.
        payload = self._guarded_read(_remote_call, stage="history_deals_materialize")
        return cast(list[dict[str, Any]], json.loads(payload))

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

        ⭐ RE-CUT 2026-08-11 (153.5 / WIZFORM-ABANDON). The reasoning above stays
        correct and is now ALSO bounded in consequence: the abandoned thread it
        describes no longer merely "keeps running", it is FENCED — the epoch check
        immediately before ``stale.shutdown()`` below refuses once the lease has
        moved on. ⚠️ D-43's honest limit, stated here rather than left for a
        reviewer to discover: the fence cannot un-send a call already on the wire.
        If the zombie had already DISPATCHED ``stale.shutdown()`` when the lease
        released, the pipe still dies for the next holder (``sync_request_timeout``
        is a purely client-side TTL — verified against the pinned rpyc 5.2.3 wheel
        — so an in-flight call completes server-side regardless). The fence closes
        the COMMON case, which is the zombie ARRIVING at the shutdown after the
        release; the ``_assert_expected_login`` detection bracket therefore stays.

        ⭐ THE ONE PERMITTED ``shutdown()`` (153.3 / D-35). Every other teardown in
        this client was deleted, because a ``shutdown()`` on this deployment
        destroys the ONE shared IPC pipe for every concurrent caller. This one
        STAYS, deliberately: with nobody else calling it, a genuinely wedged pipe is
        healed ONLY here (MT5CONC-01), and destroying a pipe that is already wedged
        is the point rather than the hazard.

        ⭐ WHY IT IS SAFE TO KEEP — RE-CUT 2026-08-11 (153.5 / WIZFORM-ABANDON,
        finding #5). This block used to say it was safe because *"every one of its
        call sites holds the terminal lease … that is not a belief:
        tests/test_mt5_shutdown_roster.py derives BOTH facts from source."* That
        argument was FALSE on one path and the roster could not see it: its
        enclosure proof is **lexical**, so it reads the ``shutdown`` as inside the
        ``async with`` and passes green — while at RUNTIME ``_mt5_bounded_restart``
        abandons this call at its ~10s bound, the caller unwinds, the lease
        releases, and the zombie reaches the shutdown under the NEXT holder. The
        premise the phase-153.3 fix rested on was repaired, not re-asserted.

        It is safe to keep because the epoch fence ENFORCES the premise AT RUNTIME:
        an entry check, and the load-bearing second check immediately before the
        ``stale.shutdown()`` below, both comparing this session's bound generation
        against the terminal's current one. The four lease-enclosed call sites
        (``allocator_positions.py`` x2, ``job_worker.py`` x2) are still derived from
        source by ``tests/test_mt5_shutdown_roster.py`` — but that derivation is now
        understood as the LEXICAL half only, green on the abandonment case by
        construction. The runtime half lives here and in
        ``tests/test_mt5_client_contract.py``'s fenced-restart case.

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

    def recycle_terminal_process(self) -> dict[str, Any]:
        """Recycle the Wine-hosted ``terminal64.exe`` PROCESS — terminate it over the
        rpyc channel, then relaunch it with a bare ``initialize()`` (164.6.5 / D-05,
        Option 2, founder-ratified 2026-09-25).

        ⛔ NOT ``restart``. ``restart`` replaces the rpyc CONNECTION and never touches
        the terminal; this ends the terminal PROCESS and leaves the connection
        alone (the bridge is a separate process and survived both spike runs with
        its pids unchanged). A reader who conflates the two believes the terminal
        was recycled when only the socket was.

        ⭐ THE ACTION HALF ONLY. Whether to recycle is DECIDED elsewhere, by the
        credential-free detector ``assert_session_authorized`` (D-06: a process-,
        window- or UI-liveness probe passed for the whole 1h39m outage). This verb
        never decides; it is dumb, callable once per call, and never loops — the
        once-per-episode debounce belongs to its caller.

        ⭐ WHAT IT DOES, AND WHY THAT IS A WHOLE RECYCLE (live spike, 2026-09-25).
          1. Executes the committed ``_REMOTE_TERMINAL_RECYCLE_SRC`` in the bridge's
             interpreter, ending every ``terminal64.exe``. A snapshot failure or a
             dead transport RAISES a typed, scrubbed ``Mt5ClientError`` — it never
             returns a verdict it did not measure.
          2. Calls ``assert_session_authorized`` — the same bare, bounded
             ``initialize()`` the detector uses. The MetaTrader5 package LAUNCHES a
             terminal that is not running, which is exactly what relaunched it,
             unattended, in both spike runs. No Linux-side launch command exists
             in this path.
        Step 2's failure is RECORDED, not raised: by then the process is already
        gone, and a raise would hide that from the caller. ``authorized`` is the
        detector's own answer; ``relaunch_code`` is its ``last_error()`` code
        (``-6`` no account yet, ``-10003``/``-10004``/``-10005`` IPC, ``0`` a
        transport failure) and ``None`` when it answered.

        ⛔ TAKES NO CREDENTIAL AND STRUCTURALLY CANNOT. Its signature has no login,
        password or server, and nothing about it crosses the wire as text. The
        terminal re-authorizes from the state it keeps in the persistent Wine
        prefix, or from whichever per-call login next selects an account — MEASURED:
        after a relaunch the terminal sat on whichever account the last service
        call had logged in to, so no caller may assume a fixed account after this.

        ⛔ NEVER TOUCHES THE PREFIX OR THE VOLUME (D-07, one-way). See the constant.

        ⚠️ DISRUPTIVE BY DESIGN: the terminal is shared, so this drops the IPC for
        every caller. Call it only under the terminal lease, and only after the
        detector has named an IPC fault.

        ⚠️ The spike measured a Linux-side ``kill`` followed by ``initialize()``;
        issuing the terminate FROM the bridge interpreter via ``TerminateProcess``
        is the same abrupt end but was NOT itself exercised live before this
        shipped — see ``deploy/mt5-gateway/railway-gateway.md``'s D-05 record.
        """
        # WIZFORM-ABANDON / D-36 — FIRST executable statement, ahead of every
        # `_timed` bracket and every except arm, exactly as every other session
        # touch does it. An abandoned recycle would kill the terminal out from
        # under whoever holds the lease now.
        self._assert_live("terminal_recycle")
        conn = getattr(self._mt5, "_MetaTrader5__conn", None)
        if conn is None:
            # The same seam `_materialize_rows` depends on. Absent ⇒ nothing was
            # sent and nothing was terminated; say so rather than return a verdict.
            raise Mt5ClientError(
                0, "MT5 rpyc transport is not reachable for the terminal recycle"
            )

        # WR-06 — three of these must fit in half of THIS client's rpyc bound.
        exit_wait_ms = min(
            _TERMINAL_EXIT_WAIT_MS,
            int(self._request_timeout_s * 1000) // _TERMINAL_EXIT_WAIT_DIVISOR,
        )

        def _remote_call() -> str:
            conn.execute(_REMOTE_TERMINAL_RECYCLE_SRC)
            return cast(
                str,
                conn.namespace[_REMOTE_TERMINAL_RECYCLE_FN](exit_wait_ms),
            )

        # Through `_guarded_read` for the reason every remote crossing is: a remote
        # traceback carries the executed source line and must be scrubbed, and the
        # stage bracket is what makes the recycle's cost visible.
        payload = self._guarded_read(_remote_call, stage="terminal_recycle")
        # ⛔ R2-SFH-04 (164.6.5 review round 2) — THE COUNTS FIRST, ON THEIR OWN.
        # They are the verdict: unreadable, the verb does not know what happened
        # and says so. Every OTHER field is parsed tolerantly after them, because
        # they come from Win32 code that has never run live and one surprise in
        # them used to fail this whole parse — after every terminate had landed.
        try:
            counts = json.loads(payload)
            matched = _recycle_int(counts["matched"])
            terminated = _recycle_int(counts["terminated"])
            exited = _recycle_int(counts["exited"])
        except (TypeError, ValueError, KeyError):
            raise Mt5ClientError(
                0, "MT5 terminal recycle returned a malformed verdict"
            ) from None
        diagnostics = _parse_recycle_diagnostics(counts)

        # ⛔ SFH-06 (164.6.5 review round 1) — THE COUNTS REACH THE LOG BEFORE THE
        # RELAUNCH, whatever happens to it. The relaunch below can raise
        # `Mt5SessionAbandoned` (the heal's budget fired and the lease bumped the
        # generation), which is not an `Mt5ClientError`, so it propagates out of
        # this verb and the verdict dict is discarded — and the ONLY evidence that
        # a shared terminal was ended and not relaunched by us went with it. The
        # generic "ABANDONED at the budget" line says nothing about a process
        # having been killed. Counts, Win32 codes and bridge-local exception CLASS
        # names only: no host, no port, no account, no remote message.
        logger.warning(
            "Mt5Client.recycle_terminal_process: terminate crossed — matched=%d "
            "terminated=%d exited=%d attempted=%s unprocessed=%s enumerated=%s "
            "enumerate_error=%s open_errors=%s terminate_errors=%s pid_errors=%s "
            "file_versions=%s file_version_errors=%s file_version_exc=%s; issuing "
            "the relaunch probe now (a later abandonment does not undo this).",
            matched,
            terminated,
            exited,
            diagnostics["attempted"],
            diagnostics["unprocessed"],
            diagnostics["enumerated"],
            diagnostics["enumerate_error"],
            diagnostics["open_errors"],
            diagnostics["terminate_errors"],
            diagnostics["pid_errors"],
            diagnostics["file_versions"],
            diagnostics["file_version_errors"],
            diagnostics["file_version_exc"],
        )
        authorized = True
        relaunch_code: int | None = None
        try:
            self.assert_session_authorized()
        except Mt5ClientError as exc:
            authorized = False
            relaunch_code = exc.code
        return {
            "matched": matched,
            "terminated": terminated,
            "exited": exited,
            **diagnostics,
            "authorized": authorized,
            "relaunch_code": relaunch_code,
        }

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

        The identity itself lives in the module-level ``mt5_terminal_key`` so a
        caller that needs the key BEFORE it is willing to pay this class's blocking
        connect can reach it without constructing anything; this property is the
        instance-bound spelling of that one function, never a second copy of it.
        """
        return mt5_terminal_key(self._host, self._port)


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
