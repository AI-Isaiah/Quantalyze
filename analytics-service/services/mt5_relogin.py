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
import os
from typing import Final

from services.closed_sets import mt5_enabled_server
from services.mt5_client import MT5_REQUEST_TIMEOUT_S as _MT5_REQUEST_TIMEOUT_S
from services.mt5_client import Mt5Client, Mt5ClientError, mt5_terminal_key
from services.mt5_concurrency import mt5_terminal_lease
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

# The WHOLE heal's wall-clock budget: the rpyc connect plus at most two bounded
# round-trips. DERIVED from the rpyc request bound (the house idiom —
# `mt5_concurrency._MT5_DERIVE_READ_TIMEOUT_S` and `ingestion/mt5._MT5_PROBE_TIMEOUT_S`
# are both derived the same way) so a retuned rpyc bound carries through here
# instead of leaving a hardcoded ceiling behind to drift. It is the ONLY thing
# bounding `rpyc.classic.connect`, which carries no timeout of its own.
_MT5_RELOGIN_BUDGET_S: Final[float] = float(
    os.getenv("MT5_RELOGIN_BUDGET_S", str(_MT5_REQUEST_TIMEOUT_S + 10.0))
)

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
_MT5_RELOGIN_LEASE_WAIT_S: Final[float] = float(
    os.getenv("MT5_RELOGIN_LEASE_WAIT_S", "2.0")
)

# The verdict tokens `_heal_blocking` hands back for the caller to log. Short,
# fixed strings: they name what happened to the SESSION and carry no credential,
# no host and no port.
_VERDICT_ALREADY_AUTHORIZED: Final[str] = "already_authorized"
_VERDICT_HEALED: Final[str] = "healed"

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

    ⛔ The credentialed verb's return value is NOT inspected and must never be
    treated as proof the heal worked — the oracle for "is the session authorized"
    is the NEXT probe, never this call's own boolean (RESEARCH question TWO).

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
                return f"not_healed:ipc_fault:code={err.code}"
        else:
            return _VERDICT_ALREADY_AUTHORIZED
        client.initialize_with_credentials(login, password, server)
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
    forbids).
    """
    try:
        if not mt5_enabled_server():
            # ⛔ FIRST, and before any construction: fail-closed, read per call.
            return

        credentials = read_env_mt5_credentials()
        if credentials is None:
            return
        endpoint = read_env_gateway_endpoint()
        if endpoint is None:
            return

        login, password, server = credentials
        host, port = endpoint

        # The lease key WITHOUT a client — plan 01's helper exists for this call
        # site. ⛔ Never a second hand-spelled `f"{host}:{port}"`: the epoch
        # registry and the lock registry must be keyed byte-identically or the
        # fence guards a different terminal than the lock serializes.
        async with mt5_terminal_lease(
            mt5_terminal_key(host, port), wait_s=_MT5_RELOGIN_LEASE_WAIT_S
        ):
            verdict = await asyncio.wait_for(
                asyncio.to_thread(
                    _heal_blocking, host, port, login, password, server
                ),
                timeout=_MT5_RELOGIN_BUDGET_S,
            )
        logger.info("mt5 boot heal: %s", verdict)
    except Exception as exc:  # noqa: BLE001 — see the docstring; this is the control
        logger.warning(
            "mt5 boot heal did not complete — continuing without it; the terminal "
            "keeps whatever session it already has and the next boot will try "
            "again (exc_class=%s scrubbed=%s)",
            type(exc).__name__,
            scrub_freeform_string(str(exc)),
        )
