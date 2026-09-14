"""Phase 164.6.2 (MT5RELOGIN) — the BOOT HEAL: re-establish the MT5 terminal's
broker session from the environment triple, once, at the analytics worker's own
startup, without a human.

WHAT THIS IS FOR (criterion 1). The Wine terminal's broker session is established
ONCE, BY HAND, over VNC, and nothing re-establishes it — so any rotation, expiry
or broker-side event takes MT5 down silently and stays down until somebody opens
a VNC session. This module is the caller that closes that loop: it detects the
lost session with a CREDENTIAL-FREE probe and, only for that one fault, re-runs
``initialize()`` in its credentialed form from ``MT5_LOGIN`` / ``MT5_PASSWORD`` /
``MT5_SERVER``.

TWO DECISIONS ARE LOAD-BEARING HERE AND NEITHER IS THIS MODULE'S TO REVISIT.

  * **D-07** — the heal verb is ``Mt5Client.initialize_with_credentials``, NOT
    ``Mt5Client.login``. ``login()`` opens with a credential-LESS ``initialize()``
    and raises on its falsy return, and a credential-less ``initialize()`` is
    EXACTLY the call that answers ``-6`` when the terminal has no authorized
    account — so ``login()`` raises before reaching its own login and cannot heal
    the fault this module exists for (probed live, 2026-09-13).
  * **D-08** — STARTUP ONLY. The heal is called from ``main.lifespan`` and NOWHERE
    ELSE. D-01's "also heal on session open" was STRUCK on a measurement:
    ``job_worker._make_mt5_session`` runs in PREFLIGHT, outside and before the
    terminal lease, and ``Mt5Client._epoch`` binds on FIRST TOUCH — so a touch
    there would stamp the generation early and an unrelated lease release in the
    preflight-to-lease window would refuse a LEGITIMATE derive read with
    ``Mt5SessionAbandoned``. ⛔ A reader who finds the per-session half missing has
    found a DECISION, not a gap.

⛔ THREE THINGS THIS MODULE MUST BE STRUCTURALLY INCAPABLE OF DOING.

  1. **RAISING.** ``main.lifespan``'s ``_crash_handler`` calls ``SHUTDOWN.set()`` on
     ANY background-task exception, which stops the dispatch, watchdog and enqueue
     loops while the API — and therefore ``/health`` — stays green. A raising heal
     is a SILENT ANALYTICS OUTAGE behind a passing health check. Every path out of
     ``heal_mt5_terminal_session`` therefore sits inside ONE top-level
     ``except Exception``, and that property is asserted both structurally (the
     shape of the function's AST) and behaviourally (every internal step made to
     raise, the coroutine still returns ``None``).
  2. **BLOCKING THE EVENT LOOP.** ``rpyc.classic.connect(host, port)`` carries NO
     timeout of its own — ``MT5_REQUEST_TIMEOUT_S`` is applied only once the socket
     is up — so a blackholed mesh address would block ``/health`` against Railway's
     120 s ``healthcheckTimeout``. The ``Mt5Client`` is therefore CONSTRUCTED INSIDE
     the ``to_thread`` body, where the caller's ``wait_for`` bounds it.
  3. **TOUCHING THE TERMINAL FROM ANYWHERE BUT ITS OWN SINGLE LEASE.** There is
     exactly ONE ``mt5_terminal_lease`` acquisition in this module, at the top level
     of the async entry, and the client it covers is built and closed inside it.

⚠️ The bare-``initialize()`` idempotence assumption this path relies on ("a no-op
``True`` when the terminal is already attached") is an EMPIRICAL observation owned
by Phase 155 / MT5-VERIFY, not a MetaQuotes guarantee. If the D-06 window
measurement surprises, that assumption is the first suspect.
"""
from __future__ import annotations

import asyncio
import logging
import math
import os
from typing import Final

from services.closed_sets import mt5_enabled_server
from services.mt5_client import MT5_REQUEST_TIMEOUT_S as _MT5_REQUEST_TIMEOUT_S
from services.mt5_client import (
    Mt5Client,
    Mt5ClientError,
    _redact_credential_values,
    mt5_terminal_key,
)
from services.mt5_concurrency import Mt5TerminalBusyError, mt5_terminal_lease
from services.mt5_validation import Mt5ValidationError, parse_mt5_credentials
from services.redact import scrub_freeform_string

# ⛔ A STDLIB logger, bound at module scope under the `quantalyze.analytics.`
# prefix — the convention `services/job_worker.py` and `services/mt5_client.py`
# already use. ⛔ NEVER `structlog.get_logger(...).bind(...)` at module scope:
# `BoundLoggerLazyProxy.bind()` freezes whatever processor list is in force at
# import time, i.e. before any entrypoint calls `configure_logging()`, so the
# resulting logger carries the UNREDACTED chain forever
# (`tests/test_structlog_frozen_proxy.py`, Mode A).
logger = logging.getLogger("quantalyze.analytics.mt5_relogin")


# The MT5 error code for "no account is authorized on this terminal" — the ONE
# fault this module heals, and the vocabulary Phase 164.8.3 (PROBERAUTH) shipped
# for the prod prober ("Terminal: Authorization failed"). ⛔ Every OTHER code the
# detector can carry (-10003 / -10004 / -10005) is an IPC fault whose remedy is
# the OPPOSITE one — restart the pipe, look at the VNC screen — and re-sending a
# credential there heals nothing while re-collapsing exactly the distinction
# Phase 164.1 built.
_MT5_NO_AUTHORIZED_ACCOUNT_CODE: Final[int] = -6

# The three Railway variables the heal reads, in the order they are reported.
# ⛔ NAMES ONLY ever reach a log line — never a value, never a length, never a
# prefix, never a hash (T-164.6.2-12).
_MT5_CREDENTIAL_ENV_NAMES: Final[tuple[str, str, str]] = (
    "MT5_LOGIN",
    "MT5_PASSWORD",
    "MT5_SERVER",
)

_MT5_GATEWAY_ENV_NAMES: Final[tuple[str, str]] = (
    "MT5_GATEWAY_HOST",
    "MT5_GATEWAY_PORT",
)

# The kill switch's variable NAME, so the disabled-return log line can name it
# without re-spelling the string `services/closed_sets.py` owns (HIGH-1).
_MT5_ENABLED_ENV_NAME: Final[str] = "MT5_ENABLED"

# The two tuning knobs. ⛔ READ PER CALL AND NEVER AT IMPORT — 164.6.2 CR-02.
#
# They WERE `float(os.getenv(...))` at module scope, and `main.lifespan` imports
# this module unguarded before its `yield`. MEASURED 2026-09-14:
#
#     $ MT5_RELOGIN_BUDGET_S="45s" python -c "import services.mt5_relogin"
#     ValueError: could not convert string to float: '45s'
#
# so an operator typo in a Railway variable raised out of the lifespan context
# manager, aborted uvicorn startup, and `restartPolicyType ON_FAILURE x3` took
# the WHOLE analytics service down — the dispatch loop, the watchdog, the enqueue
# loop and `/health` — for a best-effort heal of a gateway nobody needed. That is
# VERBATIM the outcome D-08's own comment in `main.lifespan` says the
# `create_task` shape exists to prevent; the unguarded import defeated it one
# line above the task. The asymmetry was the tell: every OTHER misconfiguration
# here is handled by log-once-and-return (D-02) and only the two knobs that exist
# purely to TUNE the heal were fatal.
#
# Reading per call also restores the property `read_env_mt5_credentials`'s
# docstring argues for at length — a go-live variable flip must take effect
# without a reimport — which these two were the module's only violators of.
_MT5_RELOGIN_BUDGET_ENV: Final[str] = "MT5_RELOGIN_BUDGET_S"
_MT5_RELOGIN_LEASE_WAIT_ENV: Final[str] = "MT5_RELOGIN_LEASE_WAIT_S"

# ⭐ THE BUDGET IS DERIVED FROM THE NUMBER OF ROUND-TRIPS THE PATH ACTUALLY
# MAKES (WR-03), not from one. The `-6` path — the path a heal exists for — is:
#
#   | step                                            | ceiling                 |
#   |-------------------------------------------------|-------------------------|
#   | `rpyc.classic.connect` in `Mt5Client.__init__`   | NONE of its own; this   |
#   |                                                 | `wait_for` is the only  |
#   |                                                 | thing bounding it       |
#   | `assert_session_authorized` -> `initialize()`    | 20 s MT5 IPC / 30 s rpyc|
#   | `_raise_last` -> `last_error()`                  | 30 s rpyc — D-32's own  |
#   |                                                 | EVIDENCE §1b records a  |
#   |                                                 | failed attempt paying a |
#   |                                                 | SECOND full 30 s here   |
#   | `initialize_with_credentials` -> `initialize(…)` | 20 s MT5 IPC / 30 s rpyc|
#   | the WR-02 RE-PROBE -> `initialize()`             | 20 s MT5 IPC / 30 s rpyc|
#   | the RE-PROBE's `_raise_last` -> `last_error()`   | 30 s rpyc — the SAME     |
#   |                                                 | second round-trip as row |
#   |                                                 | three, on the second     |
#   |                                                 | probe. This row was      |
#   |                                                 | MISSING (WR-02 r2)       |
#
# The old `_MT5_REQUEST_TIMEOUT_S + 10.0` (40 s) bounded ~80 s of work, so a
# genuinely-`-6` terminal on a slow Wine bridge — the condition under which a
# heal is MOST needed — had its `wait_for` fire MID-`initialize`: the coroutine
# unwinds, the lease releases and bumps the generation, the zombie thread's
# in-flight credentialed `initialize` is abandoned against the shared terminal,
# and whether the session came up is unknowable from the log. Still DERIVED from
# the rpyc bound (the house idiom) so a retune carries through.
#
# ⛔ IT WAS 4, AND THE PATH MAKES 5. The table's last row was missed: WR-02's
# re-probe is a DETECTOR, and a detector that answers falsy goes on to
# `_raise_last` -> `last_error()` exactly as the first probe does. The five-trip
# path is not an exotic one — it is the path that produces
# `still_unauthorized` / `heal_sent_ipc_fault_on_reprobe`, i.e. the single most
# VALUABLE verdict this module emits, the one that says a human must act.
# MEASURED: 5 x 30 s = 150 s against a 130 s budget, so on a slow Wine bridge the
# `wait_for` fired mid-`last_error` and the operator got the generic
# `did not complete` INSTEAD of the verdict — and a zombie thread was left in
# flight against the shared terminal for the difference. 5 x 30 + 10 = 160 s,
# comfortably under the 300 s ceiling derived below.
#
# ⛔ The count is GATED, not asserted: `test_the_budget_covers_every_round_trip_
# the_worst_case_path_makes` drives the five-trip path against the double and
# counts the remote calls it actually makes. A sixth round-trip added to the path
# reds there rather than silently re-opening this window.
_MT5_RELOGIN_ROUND_TRIPS: Final[int] = 5

# The slack over the round-trips, covering the unbounded `rpyc.classic.connect`.
_MT5_RELOGIN_CONNECT_SLACK_S: Final[float] = 10.0

# ⛔ WR-06 — THE DECLARED CEILING, and it is a DERIVATION rather than a taste.
# Any value `float()` accepts was previously used verbatim as an `asyncio.wait_for`
# timeout: `MT5_RELOGIN_BUDGET_S=0` cancelled the heal immediately and logged
# "did not complete" on every boot FOREVER (indistinguishable from a transient
# gateway problem), and `inf` removed the bound entirely and held
# `mt5_terminal_lease` for as long as a wedged rpyc connect lasted — while every
# batch caller (`run_derive_broker_dailies_job`, `_fetch_mt5_account_balance`,
# `_fetch_mt5_account_rows`) acquires with `wait_s=None`, i.e. UNBOUNDED. A
# best-effort heal took out the batch.
#
# 300 s is ONE THIRD of the 15-minute dispatch ceiling those batch callers wait
# against, so even a maximally mis-tuned budget leaves a derive job two thirds of
# its own ceiling. ⛔ It bounds a TYPO, not a tuning decision; raising it means
# arguing about the dispatch ceiling, not about this line.
_MT5_RELOGIN_BUDGET_CEILING_S: Final[float] = 300.0

# ⛔ IN-03 (round 2) — THE FLOOR, and it is ONE ROUND-TRIP because anything less is
# a budget that cannot complete a single bounded call. `MT5_RELOGIN_BUDGET_S=0` was
# already rejected while `0.5` and `0.001` were accepted SILENTLY (measured), and
# the sub-round-trip values are the WORSE of the two: zero cancels before the
# thread starts, whereas `0.5` lets it start and then expires MID-`initialize_with_
# credentials` on the `-6` path, so EVERY boot abandons a credentialed call against
# the shared terminal after the lease released and bumped the generation. Derived
# from the rpyc bound like every other number here, so a retune carries through.
_MT5_RELOGIN_BUDGET_FLOOR_S: Final[float] = _MT5_REQUEST_TIMEOUT_S

# ⭐ The bound on ACQUIRING the terminal, and it is deliberately SHORT — a
# different quantity from the bound on OPERATING it (the D-29 distinction).
#
# WHY IT IS BOUNDED AT ALL: an unbounded acquire at boot would put a BEST-EFFORT
# heal ahead of real work in the terminal queue — the batch derive read, a user
# sitting in front of an interactive validate — for as long as that work takes.
# And the correct behaviour when the terminal is already busy is to SKIP: a busy
# terminal is a terminal somebody is already successfully using, which is itself
# evidence that the session is fine and there is nothing here to heal. ⛔ A
# timed-out acquire holds nothing, bumps nothing and stamps nothing
# (`mt5_terminal_lease`'s release discipline), so skipping costs the next holder
# exactly zero.
#
# ⚠️ IN-04 — THE ASYMMETRY, STATED RATHER THAN IMPLIED. This bound is deliberate
# on ONE side only: the heal refuses to queue behind real work, but real work
# DOES queue behind the heal. The three job call sites
# (`run_derive_broker_dailies_job`, `_fetch_mt5_account_balance`,
# `_fetch_mt5_account_rows`) acquire the same lease with `wait_s=None`, i.e.
# UNBOUNDED. Concretely: the worker boots, `dispatch_loop` claims a
# `derive_broker_dailies` job within a second or two, the heal already holds the
# lease, and the job waits inside its own unbounded acquire for up to the whole
# budget. That is harmless against the 15-minute dispatch ceiling and it is the
# direction the "a busy terminal is a terminal somebody is already using"
# argument above does NOT cover — and it grows in proportion to any budget
# increase, which is why `_MT5_RELOGIN_BUDGET_CEILING_S` is derived from that
# dispatch ceiling rather than picked.
_MT5_RELOGIN_LEASE_WAIT_DEFAULT_S: Final[float] = 2.0

# Its ceiling is ONE rpyc round-trip, and that follows from the argument above:
# waiting LONGER for a terminal somebody else is driving than a single round-trip
# takes contradicts the whole "a busy terminal is evidence the session is fine,
# so skip" posture this bound exists to express.
_MT5_RELOGIN_LEASE_WAIT_CEILING_S: Final[float] = _MT5_REQUEST_TIMEOUT_S

# ⛔ Its floor is a DIFFERENT quantity from the budget's and is deliberately tiny.
# This bound governs ACQUIRING, not operating (the D-29 distinction), and the
# correct behaviour when the terminal is busy is to SKIP — so a short wait is a
# legitimate tuning choice, not a typo. The floor exists only to keep the knob out
# of the region where "bounded" stops meaning anything: a wait of `0.001 s` cannot
# lose a race it never entered, so the heal would skip on every boot and the log
# would fill with a designed-looking INFO skip forever.
_MT5_RELOGIN_LEASE_WAIT_FLOOR_S: Final[float] = 0.1

# The verdict tokens `_heal_blocking` hands back for the caller to log. Short,
# fixed strings: they name what happened to the SESSION and carry no credential,
# no host and no port.
_VERDICT_ALREADY_AUTHORIZED: Final[str] = "already_authorized"

#: ⭐ WR-02 — this token is now MEASURED. It used to be returned on the sole basis
#: that ``initialize_with_credentials`` did not raise, i.e. named after exactly
#: the signal both docstrings say must never be trusted. ``_heal_blocking`` now
#: re-runs the credential-free detector inside the same lease and the same budget
#: before returning it, so the log line and the doctrine agree.
_VERDICT_HEALED: Final[str] = "healed"

#: Every non-heal verdict starts with this, and the caller's log LEVEL keys off
#: it (WR-01). ⛔ A new failure verdict that does not carry the prefix is silently
#: demoted to INFO — `_heal_blocking`'s verdicts are built through `_not_healed`
#: for exactly that reason.
_VERDICT_NOT_HEALED_PREFIX: Final[str] = "not_healed:"

#: Reason keys already logged in THIS process. D-02 — an absent or unparseable
#: configuration must LOG ONCE and then stay quiet: the heal runs once per boot
#: today, but a second call in the same process (a test, a future caller) must not
#: re-emit. Composed from `main._capture_secret_misconfig`'s monotonic throttle
#: (keyed by fault-and-NAME, holding no value) simplified to once-per-process,
#: because there is no interval to tune when the event fires once per boot.
#: ⛔ It holds REASON KEYS, never a credential value.
_LOGGED_CONFIGURATION_FAULTS: set[str] = set()


def _reset_relogin_log_throttle_for_tests() -> None:
    """Clear the once-per-process log throttle.

    ⛔ Test-only. Production wants exactly the opposite of this: the throttle is
    what keeps an unconfigured deploy from re-stating the same missing-variable
    line on every future call.

    ⚠️ IN-03 — A TEST-ONLY MUTATOR SHIPPING IN A ``services/`` MODULE IS A
    DECISION HERE, NOT AN OVERSIGHT. It is underscore-prefixed, documented as
    test-only, and matches `mt5_client._reset_mt5_epochs_for_tests` — the same
    shape, in the same package, for the same reason (module-level state a test
    must be able to clear). ⛔ Production never calls it, and a future caller that
    does is removing a log-once guarantee the operator depends on. Recorded so
    the convention stays a decision rather than drifting into a habit.
    """
    _LOGGED_CONFIGURATION_FAULTS.clear()


def _log_configuration_fault_once(reason: str, message: str, *args: object) -> None:
    """Emit ``message`` at WARNING at most once per process per ``reason``.

    ⛔ LOG-AND-PROCEED, never silence (the posture `main_worker.daily_enqueue_loop`'s
    startup gate already uses in this repo's own voice). ⛔ Do NOT copy
    `sentry_init.init_sentry`'s silent early return: silence is the defect class
    this milestone exists to remove, and an MT5 gateway that never heals because
    nobody set a variable must be visible in the operator's log.
    """
    if reason in _LOGGED_CONFIGURATION_FAULTS:
        return
    _LOGGED_CONFIGURATION_FAULTS.add(reason)
    logger.warning(message, *args)


def _env_float(name: str, default: float, *, floor: float, ceiling: float) -> float:
    """One tuning knob, read PER CALL, with the SAME posture as the credential
    readers: a bad value logs once and falls back to the derived default.

    ⛔ STRUCTURALLY INCAPABLE OF RAISING, and that is the whole point (CR-02).
    Absent, blank, non-numeric, zero, negative, `nan` and `inf` all take the
    default. There is no input that reaches an `asyncio.wait_for` unvalidated and
    none that reaches the caller as an exception.

    ⛔ IN-03 (round 2) — THE WINDOW IS BOUNDED AT BOTH ENDS, AND THE FLOOR IS THE
    HALF THAT WAS MISSING. `MT5_RELOGIN_BUDGET_S=0` was rejected while `0.5` and
    `0.001` were accepted SILENTLY (measured) — and a SUB-ROUND-TRIP budget is
    strictly WORSE than zero. Zero cancels before the thread starts; `0.5` lets the
    thread start and then expires MID-`initialize_with_credentials` on the `-6`
    path, so EVERY boot leaves a credentialed call in flight against the shared
    terminal after the lease released and bumped the generation — the
    abandoned-thread state WR-03's whole derivation exists to avoid, arrived at by
    a typo. ⛔ The presence of a validated ceiling was itself the hazard: a knob
    that rejects `inf` and `0` reads as "this one is range-checked", and an
    operator has no reason to look for the end that is not.

    ⛔ The value is NEVER logged — only the variable NAME and the fault class.
    These knobs carry no credential today, but the module's rule (T-164.6.2-12)
    is names only, and an exception to it at one site is how a rule stops being
    one.
    """
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError:
        _log_configuration_fault_once(
            f"{name}_not_numeric",
            "mt5 boot heal: %s is set but is not a number; falling back to the "
            "derived default. This is a SERVER misconfiguration, never a "
            "credential failure — the heal still runs (D-02).",
            name,
        )
        return default
    # ⚠️ The ceiling can never sit BELOW the default it guards. Both defaults are
    # derived from `MT5_REQUEST_TIMEOUT_S`, which is itself tunable, so a large
    # retune there could otherwise produce a window that rejects every value the
    # module would happily use itself — a ceiling that forbids its own default is
    # not a bound, it is a bug.
    effective_ceiling = max(ceiling, default)
    # ⚠️ And by the SAME argument in the other direction: a floor above the default
    # would reject the value the module would happily use itself. Clamped to the
    # default so the window can never be empty from either end.
    effective_floor = min(floor, default)
    # `math.isfinite` covers BOTH `inf` and `nan`, and `float("nan")` is the
    # nastier of the two: every comparison against it is False, so a naive
    # `floor <= value <= ceiling` range check would ACCEPT it and hand `nan` to
    # `wait_for`. Test the finiteness first, explicitly.
    if not math.isfinite(value) or not effective_floor <= value <= effective_ceiling:
        _log_configuration_fault_once(
            f"{name}_out_of_range",
            "mt5 boot heal: %s is set to a value outside [%s, %s] seconds; "
            "falling back to the derived default. Below the floor the budget "
            "expires MID-round-trip and leaves a call in flight against the "
            "shared terminal on EVERY boot; zero would disable the heal silently "
            "forever, and an unbounded value would hold the terminal lease while "
            "the batch derive queues behind it. This is a SERVER "
            "misconfiguration, never a credential failure (D-02).",
            name,
            effective_floor,
            effective_ceiling,
        )
        return default
    return value


def _relogin_budget_s() -> float:
    """The WHOLE heal's wall-clock budget — the rpyc connect plus the bounded
    round-trips the `-6` path actually makes (see the derivation above)."""
    return _env_float(
        _MT5_RELOGIN_BUDGET_ENV,
        _MT5_RELOGIN_ROUND_TRIPS * _MT5_REQUEST_TIMEOUT_S
        + _MT5_RELOGIN_CONNECT_SLACK_S,
        floor=_MT5_RELOGIN_BUDGET_FLOOR_S,
        ceiling=_MT5_RELOGIN_BUDGET_CEILING_S,
    )


def _relogin_lease_wait_s() -> float:
    """The bound on ACQUIRING the terminal — deliberately short (D-29)."""
    return _env_float(
        _MT5_RELOGIN_LEASE_WAIT_ENV,
        _MT5_RELOGIN_LEASE_WAIT_DEFAULT_S,
        floor=_MT5_RELOGIN_LEASE_WAIT_FLOOR_S,
        ceiling=_MT5_RELOGIN_LEASE_WAIT_CEILING_S,
    )


def read_env_mt5_credentials() -> tuple[int, str, str] | None:
    """The ``(login, password, server)`` triple from the environment, or ``None``.

    ⛔ ``os.getenv`` is read PER CALL, never bound into a module-level constant.
    The reason is written in `services/closed_sets.py`'s module comment and it is
    load-bearing here twice over: a go-live variable flip must take effect without
    a reimport, and the tests monkeypatch the environment — a constant resolved at
    import would silently pin every one of them to import-time state.

    The parse goes through ``parse_mt5_credentials``, the ONE fail-closed OFFLINE
    seam the rest of the service uses (credential-slot reuse: login -> ``api_key``,
    investor password -> ``api_secret``, broker server -> ``passphrase``). ⛔ Never
    a hand-rolled ``int()`` plus two ``strip()``s — that drifts silently from the
    seam every other MT5 call site defers to.

    ⛔ Absent or unparseable configuration LOGS ONCE AND RETURNS (D-02). It does
    NOT copy `job_worker._make_mt5_session`'s ``RuntimeError``: that raise is
    correct for a JOB that cannot proceed, and wrong here, where the caller is the
    worker's boot and MT5 is one arm of many.
    """
    raw = (
        os.getenv("MT5_LOGIN"),
        os.getenv("MT5_PASSWORD"),
        os.getenv("MT5_SERVER"),
    )
    missing = [
        name
        for name, value in zip(_MT5_CREDENTIAL_ENV_NAMES, raw)
        if not (value or "").strip()
    ]
    if missing:
        _log_configuration_fault_once(
            "mt5_credentials_absent",
            "mt5 boot heal: skipped — the broker-session variables are not "
            "configured: %s. This is a SERVER misconfiguration, never a "
            "credential failure; the terminal keeps whatever session it already "
            "has and the next boot will try again (D-02).",
            ", ".join(missing),
        )
        return None
    try:
        return parse_mt5_credentials(raw[0], raw[1], raw[2])
    except Mt5ValidationError:
        _log_configuration_fault_once(
            "mt5_credentials_invalid",
            "mt5 boot heal: skipped — the broker-session variables %s are set "
            "but do not form a usable login/password/server triple. This is a "
            "SERVER misconfiguration, never a credential failure (D-02).",
            ", ".join(_MT5_CREDENTIAL_ENV_NAMES),
        )
        return None


def read_env_gateway_endpoint() -> tuple[str, int] | None:
    """The ``(host, port)`` of the RPyC gateway from the environment, or ``None``.

    Same per-call read and same log-once-and-return posture as the credential
    reader above, and for the same D-02 reason.
    """
    raw_host = (os.getenv("MT5_GATEWAY_HOST") or "").strip()
    raw_port = (os.getenv("MT5_GATEWAY_PORT") or "").strip()
    missing = [
        name
        for name, value in zip(_MT5_GATEWAY_ENV_NAMES, (raw_host, raw_port))
        if not value
    ]
    if missing:
        _log_configuration_fault_once(
            "mt5_gateway_absent",
            "mt5 boot heal: skipped — the gateway endpoint is not configured: "
            "%s. This is a SERVER misconfiguration, never a credential failure.",
            ", ".join(missing),
        )
        return None
    try:
        port = int(raw_port)
    except ValueError:
        _log_configuration_fault_once(
            "mt5_gateway_port_not_numeric",
            "mt5 boot heal: skipped — %s is set but is not an integer port. "
            "This is a SERVER misconfiguration, never a credential failure.",
            _MT5_GATEWAY_ENV_NAMES[1],
        )
        return None
    return raw_host, port


def _not_healed(
    reason: str, err: Mt5ClientError, login: int, password: str, server: str
) -> str:
    """A ``not_healed`` verdict that CARRIES THE DETAIL — WR-01.

    The verdict used to be ``not_healed:ipc_fault:code={code}`` and nothing else,
    which threw away a failure description that was already safe to log. Two
    measured consequences, both unactionable for an operator:

      * ``code=0`` is the sentinel ``_raise_last`` uses for THREE distinct faults
        — an unknown ``last_error``, a malformed ``last_error`` shape, and a
        transport raise converted by its own except arm — so the one verdict named
        neither the transport class nor the reason.
      * it named no remedy. ``-10005`` is a modal login dialog on the VNC screen;
        ``-10004`` is a dead IPC pipe. Same verdict, opposite remedies.

    ⛔ REDACTED BY VALUE, not merely shape-scrubbed. ``Mt5ClientError.__init__``
    scrubs at construction, but that scrub is SHAPE-based — and this text can be
    the TERMINAL's own ``last_error()`` message, which a broker is free to echo
    the submitted account or server back into. The three values are in scope here,
    so the by-value control travels with them exactly as it does inside the client
    (T-164.6.2-12: a value must never reach a log line).

    ⛔ ``_redact_credential_values`` is imported from ``services.mt5_client``
    despite its leading underscore, DELIBERATELY. It is the SHIPPED control and
    the phase's signature-derived gate is written against that exact name; a
    second copy here would be the drift the gate exists to prevent, and renaming
    it for tidiness would silently take it out of the gate's derivation.
    """
    detail = _redact_credential_values(str(err), login, password, server)
    return f"{_VERDICT_NOT_HEALED_PREFIX}{reason}:{detail}"


def _describe_exception_for_log(
    exc: BaseException, credentials: tuple[int, str, str] | None
) -> str:
    """The entry catch-all's scrubbed description of ``exc`` — BY VALUE whenever the
    three values are known, shape-scrubbed only when they are not.

    ⛔ HIGH-2 (secondary). The catch-all used to redact with ``scrub_freeform_string``
    ALONE, which ``_redact_credential_values``' own docstring records as a MEASURED
    NO-OP on the ``mt5linux`` kwargs-repr shape: its ``SENSITIVE_KEY_VALUE`` pattern
    needs ``key`` immediately followed by ``[:=]`` and the repr puts a closing quote
    between them. So the handler was safe only by the CALLEE's discipline — every
    credential-carrying verb in ``mt5_client`` redacts before raising — and not by
    its own. That is an inherited property, and an inherited property is one refactor
    away from being absent: the catch-all is the LAST handler on a path that carries
    a live broker password to a PUBLIC Actions log.

    ⛔ THE ``None`` ARM IS NOT A WEAKENING, IT IS THE CORRECT BEHAVIOUR. Before the
    credential read there is nothing to redact by value, and ``_redact_credential_values``
    with placeholder values would be actively WORSE than useless: a placeholder login
    of ``0`` would replace every ``0`` in the message with the marker, mangling the
    very text an operator needs. The callers that HAVE credentials pass them.

    ⛔ ``str(exc)`` is evaluated HERE, inside the function the caller invokes from
    inside its own nested guard (IN-06), so an exception whose ``__str__`` misbehaves
    still lands on the fallback line rather than escaping.
    """
    text = str(exc)
    if credentials is None:
        return str(scrub_freeform_string(text))
    login, password, server = credentials
    return _redact_credential_values(text, login, password, server)


def _heal_blocking(
    host: str, port: int, login: int, password: str, server: str
) -> str:
    """The BLOCKING body, run under ``to_thread``. Returns a short verdict token.

    ⛔ THE CLIENT IS CONSTRUCTED HERE, AS THIS FUNCTION'S FIRST ACT, AND THAT IS
    THE POINT OF THE FUNCTION. ``Mt5Client.__init__`` performs
    ``rpyc.classic.connect(host, port)``, which carries NO timeout of its own; the
    caller's ``asyncio.wait_for`` is the only thing bounding it, and it can only
    bound it if the construction happens inside the thread rather than on the
    event loop.

    THE BRANCH, and its asymmetry is deliberate:

      * ``assert_session_authorized()`` returns cleanly -> a session already
        exists. Return the already-authorized verdict and send NO credential. ⛔ A
        credential sent to a terminal that did not need one is a disclosure
        surface opened for nothing.
      * it raises with code ``-6`` -> the saved Wine session was refused. THIS is
        ours to heal: call the credentialed verb.
      * it raises with ANY other code -> an IPC fault (wedged pipe, unreachable
        terminal, a modal dialog). Return a verdict NAMING the code and heal
        NOTHING. Applying the session remedy to an IPC fault re-collapses the
        distinction Phase 164.1 built and Phase 164.8.3 shipped.

    ⚠️ IN-02 — ``-6`` IS ONLY EVER OBSERVABLE THROUGH ``last_error()``, so the
    branch table above is conditional on that SECOND round-trip working. If
    ``last_error()`` itself raises, or answers a falsy/malformed shape,
    ``_raise_last`` produces ``code=0`` and the fault is classified as an IPC
    fault and healed NOT AT ALL. The fail-closed direction is the right one — a
    credential is never sent on a guess — but the consequence is worth stating
    plainly: the ONE fault this module exists for is UNDETECTABLE whenever the
    second round-trip is the broken one. The verdict's detail (below) is what
    tells an operator which of those it was.

    ⛔ THE CREDENTIALED VERB'S RETURN VALUE IS NOT INSPECTED — the oracle for "is
    the session authorized" is the NEXT PROBE, never this call's own boolean
    (RESEARCH question TWO). ⭐ WR-02: that next probe is now ACTUALLY TAKEN. It
    was not, and ``_VERDICT_HEALED`` was returned on the sole basis that
    ``initialize_with_credentials`` did not raise — i.e. the verdict was named
    after exactly the signal the design refuses to trust, and it was the only
    thing an operator saw. A broker that accepts the connection but rejects the
    account (a password rotated twice, a server rename) returns TRUTHY, and the
    log read ``healed`` over a gateway that was still down. The re-probe is the
    same credential-FREE detector, inside the same lease and the same budget —
    and, since WR-01 (round 2), it BRANCHES ON ITS CODE exactly as the first probe
    does. Folding every code into ``still_unauthorized`` asserted a session state
    the probe had not measured whenever the bridge dropped between the heal and the
    re-probe, which is the first probe's own conflation arriving backwards.

    ⛔ An ``Mt5SessionAbandoned`` raised by any step is NOT absorbed here. It is a
    PLAIN exception on purpose (D-42) so an OUR-INFRASTRUCTURE refusal can never
    be re-classified as a user credential fault; it propagates to the entry's
    catch-all, which logs its CLASS.
    """
    client = Mt5Client(host, port)
    try:
        try:
            client.assert_session_authorized()
        except Mt5ClientError as err:
            if err.code != _MT5_NO_AUTHORIZED_ACCOUNT_CODE:
                return _not_healed(
                    f"ipc_fault:code={err.code}", err, login, password, server
                )
        else:
            return _VERDICT_ALREADY_AUTHORIZED
        try:
            client.initialize_with_credentials(login, password, server)
        except Mt5ClientError as err:
            # ⛔ HIGH-2 — A CREDENTIAL REFUSAL IS NOT A TRANSIENT MISS, AND IT USED
            # TO BE LOGGED AS ONE. This was the ONLY credential-carrying call in
            # the module sitting UNGUARDED between two typed-handler blocks, so its
            # raise escaped to the entry's catch-all and the operator read
            # "mt5 boot heal did not complete — continuing without it … the next
            # boot will try again" — this module's wording for a TRANSIENT fault.
            # The truth is the opposite: rotate `MT5_PASSWORD` at the broker
            # without updating Railway and NOTHING heals, on this boot or any
            # future one, until a human edits a Railway variable. "The next boot
            # will try again" is then an actively misleading sentence.
            #
            # It also bypassed WR-01's severity ladder BY CONSTRUCTION: the ladder
            # keys off the `not_healed:` prefix, and a verdict that is never
            # produced carries no prefix. Routing it through `_not_healed` puts it
            # back on the ladder (WARNING), gives it a `code=` token like every
            # other failure here, and — because `_not_healed` redacts BY VALUE —
            # carries the broker's own refusal text safely.
            return _not_healed(
                f"credential_refused:code={err.code}", err, login, password, server
            )
        try:
            client.assert_session_authorized()
        except Mt5ClientError as err:
            # ⛔ WR-01 (round 2) — THE RE-PROBE CLASSIFIES ITS CODE, EXACTLY AS THE
            # FIRST PROBE DOES. It used to fold EVERY code into
            # `still_unauthorized`, which is a claim about the SESSION that the
            # probe did not measure whenever the code was not `-6`.
            #
            # The reachable sequence: the heal succeeds, and then the Wine bridge
            # drops (`-10004`) or a modal dialog appears (`-10005`) BEFORE the
            # re-probe returns. The verdict read
            # `not_healed:still_unauthorized:code=-10004` and the operator rotated
            # the broker password — while the session was fine and the actual
            # remedy was restart-the-pipe / look at the VNC screen.
            #
            # ⛔ That is the SAME conflation the first probe's branch refuses at
            # length ("re-sending a credential heals nothing while re-collapsing
            # exactly the distinction Phase 164.1 built"), arriving in the other
            # direction: WR-02 existed to stop the log asserting unmeasured session
            # state, and this arm reintroduced it. The classifier is therefore the
            # same constant, not a second spelling of the same rule.
            if err.code != _MT5_NO_AUTHORIZED_ACCOUNT_CODE:
                return _not_healed(
                    f"heal_sent_ipc_fault_on_reprobe:code={err.code}",
                    err,
                    login,
                    password,
                    server,
                )
            return _not_healed(
                f"still_unauthorized:code={err.code}", err, login, password, server
            )
        return _VERDICT_HEALED
    finally:
        # Closed on EVERY path, success and failure alike. `close` is deliberately
        # EXEMPT from the D-36 session fence (D-41) precisely so a teardown is
        # never stranded — it touches only our own rpyc socket and never the
        # terminal's shared IPC pipe.
        client.close()


async def heal_mt5_terminal_session() -> None:
    """Re-establish the terminal's broker session, once, at worker startup.

    THE ONE lease site in this module, and the ONE public entry. Returns ``None``
    on every path; ⛔ the return value is NOT an oracle for success — the oracle is
    the next probe (RESEARCH question TWO).

    ⛔ **THE ENTIRE BODY SITS INSIDE ONE TOP-LEVEL ``except Exception``, AND THAT
    CATCH IS WHAT STANDS BETWEEN A GATEWAY OUTAGE AND AN ANALYTICS OUTAGE.** This
    coroutine runs as a task in ``main.lifespan``'s task list, every member of
    which carries ``_crash_handler`` as a done-callback; ``_crash_handler`` calls
    ``SHUTDOWN.set()`` on ANY exception, which stops the dispatch, watchdog and
    enqueue loops while the API keeps answering ``/health`` green. A raise here is
    therefore a SILENT analytics outage, not an MT5 one. ⛔ Never move a statement
    outside the guard, and never narrow it to a specific exception type.

    ORDER, and the first step's position is a decision:
      1. the kill switch, consulted BEFORE anything is constructed. ⛔ The repo's
         own WR-08 residual is a gate that sits AFTER the transport opened;
         repeating that shape at a second site would be a knowing regression.
      2. the credential triple, then the gateway endpoint — absent either, log
         once and return (D-02).
      3. the lease, taken by KEY (``mt5_terminal_key``) BEFORE any client exists,
         and BOUNDED so a busy terminal means skip rather than queue.
      4. the blocking body, off the loop, under the whole-heal budget.

    ⚠️ A ``wait_for`` that fires does NOT cancel the thread. The thread keeps
    driving the shared session while this coroutine unwinds, the lease releases
    and the terminal's generation is bumped — at which point the zombie's next
    touch is refused by the client's own D-36 fence. That is the DESIGNED
    behaviour, not a leak; ⛔ do not "fix" it by joining the thread, which would
    hold the lease for exactly as long as the hang (the WEDGE-01 class D-25
    forbids). ⭐ WR-05: it is nonetheless the one outcome here that leaves the
    SYSTEM in a state nobody measured, so it is logged at ERROR under its own arm —
    above every verdict — rather than sharing the catch-all's transient wording
    with a busy-terminal SKIP, which is logged at INFO for the opposite reason.
    """
    try:
        # ⛔ HIGH-2 (secondary) — BOUND BEFORE THE FIRST STATEMENT THAT CAN RAISE, so
        # the catch-all below can redact BY VALUE whenever the values are known and
        # fall back to the shape scrub when they are not. An `except` arm that
        # referenced an unbound local would raise `NameError` from INSIDE the
        # handler and silently demote every early failure to the argument-free
        # fallback line.
        credentials: tuple[int, str, str] | None = None

        if not mt5_enabled_server():
            # ⛔ FIRST, and before any construction: fail-closed, read per call.
            #
            # ⛔ HIGH-1 — IT LOGS. This used to be the module's ONE unlogged exit,
            # and zero log lines was simultaneously consistent with FIVE
            # hypotheses: MT5 disabled, the `create_task` entry reverted, the
            # import failing, the process killed before the task was scheduled, or
            # `LOG_LEVEL` raised above INFO. Every OTHER early return here
            # (credentials absent, credentials invalid, gateway absent, port not
            # numeric) already obeys `_log_configuration_fault_once`'s stated
            # doctrine — "LOG-AND-PROCEED, never silence … silence is the defect
            # class this milestone exists to remove" — and the one exit that
            # violated it was the one an operator is most likely to hit.
            #
            # ⚠️ It NAMES the variable, because `mt5_enabled_server` is
            # `.strip().lower() == "true"`: `1`, `on` and `yes` all read OFF, so a
            # future edit to any of them would otherwise disable the heal with an
            # EMPTY log. (Booked as `[164.6.2-KILLSWITCH-COMMENT-DRIFT]`; this line
            # makes the consequence visible without touching that gate.)
            #
            # INFO, not WARNING: a disabled kill switch is an operator DECISION,
            # not a misconfiguration, and it is not throttled because it fires once
            # per boot.
            logger.info(
                "mt5 boot heal: skipped — %s is not set to true, so the heal is "
                "disabled. The terminal keeps whatever session it already has.",
                _MT5_ENABLED_ENV_NAME,
            )
            return

        credentials = read_env_mt5_credentials()
        if credentials is None:
            return
        endpoint = read_env_gateway_endpoint()
        if endpoint is None:
            return

        login, password, server = credentials
        host, port = endpoint

        # ⛔ HIGH-1's SECOND half, and the two only work together. The disabled
        # return above removes ONE hypothesis from an empty log; this line removes
        # the rest of them. Once it is present, an empty log means "the task never
        # ran" and NOTHING else — a heal that reached the lease always emits a
        # second line, whatever happens next (a verdict, a busy skip, a timeout, or
        # the catch-all). ⛔ It carries no host, no port and no credential: the
        # module's rule is NAMES ONLY (T-164.6.2-12), and the endpoint is not even
        # a name.
        logger.info(
            "mt5 boot heal: starting — acquiring the terminal and probing the "
            "broker session (a second line always follows)."
        )

        # The lease key WITHOUT a client — plan 01's helper exists for this call
        # site. ⛔ Never a second hand-spelled `f"{host}:{port}"`: the epoch
        # registry and the lock registry must be keyed byte-identically or the
        # fence guards a different terminal than the lock serializes.
        budget_s = _relogin_budget_s()
        # ⛔ WR-05 — TWO OUTCOMES THAT ARE NOT FAILURES OF THE SAME KIND, AND WERE
        # LOGGED AS ONE. Both used to exit through the entry's catch-all as
        # "mt5 boot heal did not complete" at WARNING, which is this module's
        # wording for a transient miss. ⛔ These handlers are NESTED inside the one
        # top-level `except Exception`, never beside it: the never-raises gate
        # requires the outer guard to carry exactly ONE handler, and narrowing or
        # multiplying it is the escape route that reaches `_crash_handler`.
        try:
            async with mt5_terminal_lease(
                mt5_terminal_key(host, port), wait_s=_relogin_lease_wait_s()
            ):
                verdict = await asyncio.wait_for(
                    asyncio.to_thread(
                        _heal_blocking, host, port, login, password, server
                    ),
                    timeout=budget_s,
                )
        except Mt5TerminalBusyError:
            # ⭐ A DESIGNED SKIP, and this module's own derivation says so: "the
            # correct behaviour when the terminal is already busy is to SKIP: a
            # busy terminal is a terminal somebody is already successfully using,
            # which is itself evidence that the session is fine and there is
            # nothing here to heal … skipping costs the next holder exactly zero."
            #
            # The race is the ordinary one IN-04 describes: `dispatch_loop` claims
            # a `derive_broker_dailies` job within a second or two of boot. So a
            # HEALTHY boot logged TWO warnings — this one and `mt5_terminal_lease`'s
            # own — and an operator who learns that a healthy boot warns twice has
            # been taught to ignore the channel this milestone exists to fill.
            #
            # ⚠️ The lease's own WARNING is NOT changed here. It belongs to a shared
            # helper whose other callers are the INTERACTIVE validate path, where
            # "gave up waiting for the terminal" genuinely is a warning.
            logger.info(
                "mt5 boot heal: skipped — the terminal was already in use when "
                "the bounded acquire expired, so the heal gave up rather than "
                "queueing ahead of real work. A busy terminal is a terminal "
                "somebody is already successfully using, which is itself evidence "
                "the session is fine (D-29)."
            )
            return
        except asyncio.TimeoutError:
            # ⛔ NOT a miss, and NOT the same event as a busy skip. The budget
            # fired, and `wait_for` DOES NOT CANCEL THE THREAD: a credential-free
            # probe, or a credentialed `initialize()` carrying the broker password,
            # is STILL IN FLIGHT against the shared terminal. The lease has
            # released and bumped the generation, so the zombie's next touch is
            # fenced (D-36) — but whether the broker session came up is UNKNOWABLE
            # from this log, and the next boot's detector is the only thing that
            # will answer it.
            #
            # ERROR, above every verdict: it is the one outcome here that leaves
            # the SYSTEM in a state nobody measured.
            logger.error(
                "mt5 boot heal: ABANDONED at the %.1fs budget — a round-trip is "
                "still in flight against the shared terminal on a thread that was "
                "NOT cancelled. The lease has released and fenced it (D-36), but "
                "whether the broker session came up is unknowable from here; the "
                "next boot's credential-free probe is what answers it.",
                budget_s,
            )
            return
        # ⛔ WR-01 — THE SEVERITY FOLLOWS THE VERDICT, and it did not. Every
        # outcome was INFO, so a wedged terminal behind a modal login dialog
        # (`-10005`) — a real gateway outage — was logged one level BELOW a
        # merely-unset `MT5_GATEWAY_PORT`, which `_log_configuration_fault_once`
        # emits at WARNING. That is a severity inversion inside a milestone whose
        # stated purpose is removing silent failure.
        if verdict.startswith(_VERDICT_NOT_HEALED_PREFIX):
            logger.warning("mt5 boot heal: %s", verdict)
        else:
            logger.info("mt5 boot heal: %s", verdict)
    except Exception as exc:  # noqa: BLE001 — see the docstring; this is the control
        # ⛔ IN-06 — THE HANDLER BODY IS ITSELF GUARDED, because "structurally
        # incapable of raising" is the declared standard and `logger.warning`'s
        # ARGUMENTS are evaluated before it is entered. stdlib `logging` swallows
        # formatting errors during emit; it does NOT swallow the evaluation of
        # `type(exc).__name__` or `scrub_freeform_string(str(exc))`. An exception
        # whose `__str__` misbehaves, or a `RecursionError`/`MemoryError` arriving
        # at an already-exhausted stack, escapes the outer guard from INSIDE it and
        # reaches `_crash_handler` — the one route this whole module is built to
        # close. ⛔ `BaseException`, not `Exception`: `RecursionError` is an
        # `Exception` but `MemoryError`'s neighbours in the stack-exhaustion class
        # are not, and a fallback that is itself narrower than the failure it
        # catches is not a fallback. The fallback line takes NO arguments to
        # evaluate, so it has nothing left that can raise.
        try:
            logger.warning(
                "mt5 boot heal did not complete — continuing without it; the "
                "terminal keeps whatever session it already has and the next boot "
                "will try again (exc_class=%s scrubbed=%s)",
                type(exc).__name__,
                # ⛔ HIGH-2 (secondary) — BY VALUE, not merely shape-scrubbed. The
                # bare `scrub_freeform_string` that stood here is a MEASURED NO-OP
                # on the `mt5linux` kwargs-repr shape, so this handler's safety was
                # INHERITED from the callee's discipline rather than structural —
                # and this is the last handler on a path carrying a live broker
                # password to a PUBLIC Actions log. See `_describe_exception_for_log`.
                _describe_exception_for_log(exc, credentials),
            )
        except BaseException:  # noqa: BLE001 — see the comment; this is the control
            logger.warning(
                "mt5 boot heal did not complete, and the failure could not be "
                "described — continuing without it"
            )
