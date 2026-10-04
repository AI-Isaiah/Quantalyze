"""Phase 164.6.6.1 (MT5SCRUB) criterion 1 on the VALIDATION terminal: after a
validation's verdict, end the validation terminal, delete its saved-account
database and every per-account deal cache, and relaunch it logged into the HOUSE
account. One supervised background task per terminal, in its own lease.

WHY IT RUNS AFTER THE VERDICT, OUT OF THE REQUEST (founder D-08, 2026-10-04).
A cold relaunch of a scrubbed terminal cannot fit the wizard's 75 s deadline
(60 s stage, 120 s client ceiling): the scrub alone is three rpyc crossings and
the credentialed relaunch two more, each bounded at the rpyc ceiling. So the
validate site answers first and then calls ``schedule_validation_terminal_scrub``,
which marks the terminal "scrub owed" and spawns this module's task. The task
takes its OWN ``mt5_terminal_lease`` (held for ``house``, site
``terminal_scrub``), so it queues behind whatever holds the terminal and nothing
can log in to the terminal while it scrubs. Only a scrub that DELETED
(``refused == 0`` and no ``accounts_errors``) and whose house relaunch VERIFIED
clears the mark, so a missed scrub is visible to the next validation, which
refuses (wizard) or pays the scrub inline (worker,
``run_owed_validation_scrub_in_lease``). Plan 06 wires those call sites.

THE BUDGET. The scrub builds its own ``Mt5Client`` on the WORKER chain
(``MT5_REQUEST_TIMEOUT_S`` 30 s rpyc, ``MT5_INITIALIZE_TIMEOUT_MS`` 20000), the
``timeout=20000`` S-09 and S-10 measured with. ``_VALIDATION_SCRUB_BUDGET_S`` is
``SCRUB_RELAUNCH_RESERVE_CROSSINGS`` crossings at that ceiling plus a 10 s
connect slack. It sits outside every request chain because the scrub runs after
the response.

W-1: NO SCRUB WHILE A PROBE THREAD MAY STILL BE MID-CALL. A validate site that
hit its stage timeout has abandoned a ``to_thread`` probe that may still be
logging a client in on the same terminal. A scrub that crossed then would
delete ``accounts.dat`` and the still-running login could write it straight
back. The gate is the probe thread's OWN ``threading.Event``, set by the thread
itself on exit, and never the exception type the site saw: the same timeout
exception is raised whether the thread is still running or already returned.
Every schedule registers its event, so a probe abandoned by an EARLIER request
also blocks a later scrub. The scrub waits, bounded by ``_SCRUB_PROBE_WAIT_S``,
for every registered event; one still unset at the bound means the scrub is
skipped, the mark stays, and a ``probe_in_flight`` alert fires.

THE FLAGGED DEFAULT (CONTEXT "Still OPEN", not asked). The scrub deletes
``Config/accounts.dat`` and every ``Bases/<server>/trades/<account>`` cache
(``delete_trades=1``). It does NOT delete the Journal ``logs``, nor per-account
``mail`` or ``subscriptions``. Plan 07 records that as named residue, and the
founder answers it there.

WHY THIS TASK IS NOT IN ``main.lifespan``'S TASK LIST. That list carries
``_crash_handler``, which calls ``SHUTDOWN.set()`` on any task exception and
stops the dispatch, watchdog and enqueue loops behind a green ``/health``. A
scrub is per-validation work, not a service loop. It is held in this module's
own strong-reference set (``routers/process_key.py::_audit_tasks``'s shape,
because CPython keeps only a weak reference to a task), and its coroutine is
structurally incapable of raising (the shared never-raises predicate,
``tests/test_mt5_session_episodes.py::_GUARDED_SYMBOLS``).

WHY THE LEASE LIVES HERE AND NOT IN ``mt5_relogin``. ``mt5_relogin``'s heal
promises exactly ONE lease acquisition per tick, and its source holds exactly
one call to the lease (pinned). The validation scrub reuses that module's
``scrub_and_relaunch_as_house`` under a lease of its own, on a different
terminal, so it gets its own module and its own roster entry.

THE ROW. One point-event row per attempt in ``public.cron_runs`` under
``cron_name = 'mt5_terminal_scrub'``, inserted already closed. ⭐ NO MIGRATION,
and the schema gate does not apply: ``cron_runs.cron_name`` has no CHECK, the
table is service-role writable, and ``latest_cron_success`` takes a name and
enumerates none (the reasoning ``services.mt5_handover`` records for its own
name). Metadata is a closed key set of kinds, counts and literals.
⛔ Never an account number, login, password, broker server, host, port or
terminal key, in a row, a log line or an alert.
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from datetime import datetime, timezone
from typing import Any, Final

import sentry_sdk

from services.db import db_execute, get_supabase, rows
from services.mt5_client import (
    HOLDER_HOUSE,
    MT5_REQUEST_TIMEOUT_S,
    MT5_VALIDATE_REQUEST_TIMEOUT_S,
    Mt5Client,
    _note_terminal_holder,
    clear_mt5_scrub_owed,
    mt5_terminal_key,
    note_mt5_scrub_owed,
)
from services.mt5_concurrency import mt5_terminal_lease
from services.mt5_handover import SITE_TERMINAL_SCRUB, _normalize_site
from services.mt5_relogin import (
    _POST_RELAUNCH_DEGRADED,
    _POST_RELAUNCH_NOT_REACHED,
    _POST_RELAUNCH_UNVERIFIED,
    _POST_RELAUNCH_VERIFIED,
    SCRUB_RELAUNCH_RESERVE_CROSSINGS,
    ScrubRelaunchResult,
    heal_deadline,
    read_env_mt5_credentials,
    scrub_and_relaunch_as_house,
)

__all__ = [
    "MT5_TERMINAL_SCRUB_CRON_NAME",
    "SCHEMA_VERSION",
    "SCRUB_KIND_ABANDONED",
    "SCRUB_KIND_FAILED",
    "SCRUB_KIND_REFUSED",
    "SCRUB_KIND_RELAUNCH_UNVERIFIED",
    "SCRUB_KIND_SCRUBBED",
    "SCRUB_KIND_SKIPPED_NO_HOUSE_CREDENTIALS",
    "SCRUB_KIND_SKIPPED_PROBE_IN_FLIGHT",
    "record_mt5_terminal_scrub",
    "report_scrub_owed_refusal",
    "run_owed_validation_scrub_in_lease",
    "schedule_validation_terminal_scrub",
    "scrub_validation_terminal",
]

# ⛔ A STDLIB logger under the `quantalyze.analytics.` prefix, as `mt5_relogin`
# and `mt5_handover` use: a module-scope `structlog` proxy freezes the processor
# list at import time.
logger = logging.getLogger("quantalyze.analytics.mt5_terminal_scrub")

#: ⭐ THE NEW NAME. Nothing else writes it and no alert enumerates it.
MT5_TERMINAL_SCRUB_CRON_NAME: Final[str] = "mt5_terminal_scrub"

#: The metadata contract's version.
SCHEMA_VERSION: Final[int] = 1

#: ⭐ The validation terminal's deal caches GO. 164.6.6 D-03 lets history go, and
#: Finding C: the validation terminal never reads deal history (a validation
#: probes the account and logs out), so nothing on it needs the caches. The jobs
#: terminal keeps its own (`mt5_relogin._JOB_TERMINAL_DELETE_TRADES`).
_VALIDATION_SCRUB_DELETE_TRADES: Final[int] = 1

#: The connect slack over the crossings: `rpyc.classic.connect` has no timeout
#: of its own, and the client is built inside the bounded thread.
_VALIDATION_SCRUB_CONNECT_SLACK_S: Final[float] = 10.0

#: The scrub's whole bound: the scrub verb and its credentialed relaunch reading
#: (`SCRUB_RELAUNCH_RESERVE_CROSSINGS`), each at the WORKER chain's rpyc ceiling,
#: plus the connect slack. 5 x 30 s + 10 s = 160 s at the defaults. Outside
#: every request chain: the scrub runs after the response.
_VALIDATION_SCRUB_BUDGET_S: Final[float] = (
    SCRUB_RELAUNCH_RESERVE_CROSSINGS * MT5_REQUEST_TIMEOUT_S
    + _VALIDATION_SCRUB_CONNECT_SLACK_S
)

#: How long the scrub waits for a still-running validation probe thread. The
#: larger of the two validate sites' per-call bounds, the wizard's
#: (`MT5_VALIDATE_REQUEST_TIMEOUT_S`, which `routers/exchange.py` imports from
#: `services.mt5_client` and builds its stage timeout from as `+ 5.0`), so a probe
#: that is still inside its own rpyc bound is always waited out. Taken from
#: `services.mt5_client` directly, as the router does, because importing the
#: router here would pull FastAPI into a service module.
_SCRUB_PROBE_WAIT_S: Final[float] = MT5_VALIDATE_REQUEST_TIMEOUT_S + 5.0

#: The bound on the one row insert (`mt5_handover._HANDOVER_RECORD_TIMEOUT_S`).
_SCRUB_RECORD_TIMEOUT_S: Final[float] = 5.0

#: At most one Sentry capture per cause per window; ERROR on every occurrence
#: (`mt5_probe._PARK_ALERT_WINDOW_S`'s shape).
_SCRUB_ALERT_WINDOW_S: Final[float] = 3600.0

# --------------------------------------------------------------------------- #
# The KINDS: what one scrub attempt came to. A closed set.
# --------------------------------------------------------------------------- #
#: Deleted (`refused == 0`, no `accounts_errors`) and house-VERIFIED. The ONLY
#: kind that clears the scrub-owed mark, and the only one that does not alert.
SCRUB_KIND_SCRUBBED: Final[str] = "scrubbed"
#: The terminal was (perhaps) ended but the delete did not land: the scrub
#: literal refused it (a process did not exit, none matched, the walk failed).
SCRUB_KIND_REFUSED: Final[str] = "refused"
#: Deleted, but the house relaunch did not verify (another login, disconnected,
#: refused with -6, not answering, or not affordable).
SCRUB_KIND_RELAUNCH_UNVERIFIED: Final[str] = "relaunch_unverified"
#: The verb raised, the delete reported errors, the client could not be built,
#: or something unexpected raised. Whether anything was deleted is unknown.
SCRUB_KIND_FAILED: Final[str] = "failed"
#: The scrub's own bound fired. Its thread may still be running; the lease
#: release fences it.
SCRUB_KIND_ABANDONED: Final[str] = "abandoned"
#: W-1: a validation probe thread was still in flight at the wait's bound.
#: Nothing crossed.
SCRUB_KIND_SKIPPED_PROBE_IN_FLIGHT: Final[str] = "skipped_probe_in_flight"
#: No house triple in the environment. Nothing crossed and nothing was deleted,
#: because a scrub without a credentialed relaunch leaves an account-less
#: terminal (S-03(b), S-10).
SCRUB_KIND_SKIPPED_NO_HOUSE_CREDENTIALS: Final[str] = "skipped_no_house_credentials"

_SCRUB_KINDS: Final[frozenset[str]] = frozenset(
    {
        SCRUB_KIND_SCRUBBED,
        SCRUB_KIND_REFUSED,
        SCRUB_KIND_RELAUNCH_UNVERIFIED,
        SCRUB_KIND_FAILED,
        SCRUB_KIND_ABANDONED,
        SCRUB_KIND_SKIPPED_PROBE_IN_FLIGHT,
        SCRUB_KIND_SKIPPED_NO_HOUSE_CREDENTIALS,
    }
)

# --------------------------------------------------------------------------- #
# The ALERT causes. ⛔ A NEW closed set, never `mt5_probe._PARK_ALERT_CAUSES`.
# --------------------------------------------------------------------------- #
_CAUSE_PROBE_IN_FLIGHT: Final[str] = "probe_in_flight"
_CAUSE_HOUSE_CREDENTIALS_UNSET: Final[str] = "house_credentials_unset"
#: Plan 06's validate sites: a validation refused because the terminal still owed
#: a scrub (`report_scrub_owed_refusal`).
_CAUSE_OWED_VALIDATION_REFUSED: Final[str] = "owed_validation_refused"
#: The member an unknown cause is mapped to, so no caller-supplied string is
#: ever interpolated into alert text.
_CAUSE_UNRECOGNISED: Final[str] = "unrecognised_cause"

#: Each non-scrubbed kind's alert cause.
_KIND_CAUSES: Final[dict[str, str]] = {
    SCRUB_KIND_REFUSED: SCRUB_KIND_REFUSED,
    SCRUB_KIND_RELAUNCH_UNVERIFIED: SCRUB_KIND_RELAUNCH_UNVERIFIED,
    SCRUB_KIND_FAILED: SCRUB_KIND_FAILED,
    SCRUB_KIND_ABANDONED: SCRUB_KIND_ABANDONED,
    SCRUB_KIND_SKIPPED_PROBE_IN_FLIGHT: _CAUSE_PROBE_IN_FLIGHT,
    SCRUB_KIND_SKIPPED_NO_HOUSE_CREDENTIALS: _CAUSE_HOUSE_CREDENTIALS_UNSET,
}

_SCRUB_ALERT_CAUSES: Final[frozenset[str]] = frozenset(
    {*_KIND_CAUSES.values(), _CAUSE_OWED_VALIDATION_REFUSED, _CAUSE_UNRECOGNISED}
)

#: The row's metadata keys, and nothing else (pinned by
#: `tests/test_mt5_terminal_scrub.py`).
_SCRUB_ROW_METADATA_KEYS: Final[frozenset[str]] = frozenset(
    {
        "schema_version",
        "kind",
        "terminal_role",
        "site",
        "refused",
        "accounts_deleted",
        "accounts_missing",
        "accounts_errors",
        "trades_deleted",
        "profile_accounts_found",
        "relaunch_status",
        "records_account_number",
    }
)

#: `ScrubRelaunchResult.post_status` values a row may carry.
_RELAUNCH_STATUSES: Final[frozenset[str]] = frozenset(
    {
        _POST_RELAUNCH_VERIFIED,
        _POST_RELAUNCH_UNVERIFIED,
        _POST_RELAUNCH_DEGRADED,
        _POST_RELAUNCH_NOT_REACHED,
    }
)

#: The terminal a row is about, as a ROLE literal. ⛔ Never the terminal key.
_TERMINAL_ROLE_VALIDATION: Final[str] = "validation"

# --------------------------------------------------------------------------- #
# Process-local registries. ⛔ LOCK-FREE: every writer runs on the event loop
# thread, and the probe threads only SET their own events.
# --------------------------------------------------------------------------- #
#: W-1: per terminal key, the events of validation probe threads that may still
#: be in flight. Pruned on read; a read never mints an entry.
_UNFINISHED_PROBES: dict[str, list[threading.Event]] = {}

#: Strong references to the running scrub tasks (CPython holds only a weak one).
_SCRUB_TASKS: set[asyncio.Task[None]] = set()

#: Terminal keys with a scrub task scheduled and not yet finished: at most one
#: pending task per terminal.
_PENDING_SCRUB_KEYS: set[str] = set()

_scrub_last_alert_at: dict[str, float] = {}


def _reset_terminal_scrub_state_for_tests() -> None:
    """Test-only: forget the probe registry, the pending set, the task set and
    the per-cause capture window."""
    _UNFINISHED_PROBES.clear()
    _SCRUB_TASKS.clear()
    _PENDING_SCRUB_KEYS.clear()
    _scrub_last_alert_at.clear()


def _alert_scrub_failed(cause: str, *, site: str) -> None:
    """The ONE home of the scrub alert. Never raises.

    One ``logger.error`` on every occurrence naming the cause and the site, then
    at most one Sentry capture per cause per ``_SCRUB_ALERT_WINDOW_S``. The cause
    is checked against the closed set and the site is normalized against the
    closed site set. ⛔ No login, password, server, host, port or key.

    ⚠️ A capture reaches an operator only when ``SENTRY_DSN`` is set; the ERROR
    line is the floor that always exists.
    """
    try:
        if cause not in _SCRUB_ALERT_CAUSES:
            cause = _CAUSE_UNRECOGNISED
        site = _normalize_site(site)
        logger.error(
            "mt5 validation terminal scrub: the validation terminal was NOT "
            "scrubbed and house-relaunched (cause=%s, site=%s). A client's saved "
            "login or deal history may still be on it; the next validation owes "
            "the scrub (Phase 164.6.6.1 D-08)",
            cause,
            site,
        )
        now = time.monotonic()
        last = _scrub_last_alert_at.get(cause)
        if last is not None and now - last < _SCRUB_ALERT_WINDOW_S:
            return
        _scrub_last_alert_at[cause] = now
        sentry_sdk.set_tag("mt5_validation_scrub_failed", cause)
        sentry_sdk.capture_message(
            f"mt5 validation terminal scrub failed: cause={cause} site={site}",
            level="error",
        )
    except Exception:  # noqa: BLE001 — an alert must never replace the outcome
        pass


def report_scrub_owed_refusal(*, site: str, key: str) -> None:
    """Plan 06's validate sites call this when they REFUSE a validation because
    the terminal still owes a scrub. Never raises.

    When a scrub task for ``key`` is already pending, the refusal is the ordinary
    D-29 queue case: a validation was queued behind another one and is refused
    while that one's scrub waits for the lock. One WARNING, NO Sentry capture
    (CONTEXT, "The queue-instead-of-fail rule from 164.6.6's D-29 is partly
    reversed"). When nothing is pending, the scrub was genuinely missed: ERROR and
    the windowed capture. ``key`` is only looked up, never logged.
    """
    try:
        if key in _PENDING_SCRUB_KEYS:
            logger.warning(
                "mt5 validation terminal scrub: a validation was refused because "
                "the validation terminal owes a scrub that is already queued "
                "(cause=%s, site=%s)",
                _CAUSE_OWED_VALIDATION_REFUSED,
                _normalize_site(site),
            )
            return
        _alert_scrub_failed(_CAUSE_OWED_VALIDATION_REFUSED, site=site)
    except Exception:  # noqa: BLE001 — a report must never replace the refusal
        pass


def _register_probe(key: str, event: threading.Event) -> None:
    """W-1: remember a validation probe thread's own done-event for ``key``."""
    _UNFINISHED_PROBES.setdefault(key, []).append(event)


def _unfinished_probes(key: str) -> list[threading.Event]:
    """The registered events for ``key`` that are still unset. Set ones are
    pruned; a key left with none is dropped. ⛔ A read never mints an entry."""
    events = _UNFINISHED_PROBES.get(key)
    if events is None:
        return []
    unset = [event for event in events if not event.is_set()]
    if unset:
        _UNFINISHED_PROBES[key] = unset
    else:
        del _UNFINISHED_PROBES[key]
    return unset


def _scrub_validation_terminal_blocking(
    host: str, port: int, house: tuple[int, str, str], deadline: float
) -> ScrubRelaunchResult:
    """The blocking body, run in a thread under the caller's ``wait_for``.

    The client is constructed HERE, inside the thread, because its rpyc connect
    has no timeout of its own and only the caller's bound covers it.

    ⭐ The explicit house re-stamp (PATTERNS (d2), `park_on_house_account`'s
    precedent): under the worker's inline path the held lease is the worker's
    ``validation`` lease, so the credentialed relaunch's own stamp would record
    the terminal as held by ``validation``. Under this module's own house lease
    the stamp is already right and the re-stamp is harmless. It goes through the
    one stamping door, whose epoch guard refuses it if this thread outlived its
    lease.
    """
    client = Mt5Client(host, port)
    try:
        result = scrub_and_relaunch_as_house(
            client,
            house=house,
            deadline=deadline,
            delete_trades=_VALIDATION_SCRUB_DELETE_TRADES,
        )
        if result.post_status == _POST_RELAUNCH_VERIFIED:
            _note_terminal_holder(
                client.terminal_key, holder=HOLDER_HOUSE, stage="terminal_scrub"
            )
        return result
    finally:
        client.close()


def _delete_landed(verdict: dict[str, object]) -> tuple[bool, bool]:
    """``(refused, errored)`` from the verb's verdict: whether the scrub literal
    refused the delete, and whether the delete reported an error or an
    unreadable error field. ⛔ Only an int ``refused == 0`` and an EMPTY
    ``accounts_errors`` list count as a clean delete."""
    refused_value = verdict.get("refused")
    refused = not (
        isinstance(refused_value, int)
        and not isinstance(refused_value, bool)
        and refused_value == 0
    )
    errors = verdict.get("accounts_errors")
    errored = not (isinstance(errors, list) and len(errors) == 0)
    return refused, errored


def _classify(result: ScrubRelaunchResult) -> str:
    """One kind from the structured result. ⛔ ``scrubbed`` if and only if the
    delete landed cleanly AND the house relaunch verified."""
    if result.verb_exc_class is not None:
        return SCRUB_KIND_FAILED
    refused, errored = _delete_landed(result.verdict)
    if refused:
        return SCRUB_KIND_REFUSED
    if errored:
        # A delete that reported an error did not prove the file is gone.
        return SCRUB_KIND_FAILED
    if result.post_status != _POST_RELAUNCH_VERIFIED:
        return SCRUB_KIND_RELAUNCH_UNVERIFIED
    return SCRUB_KIND_SCRUBBED


async def _wait_for_unfinished_probes(key: str) -> bool:
    """W-1: wait, bounded by ``_SCRUB_PROBE_WAIT_S`` in total, for every
    registered probe event on ``key``. True when none is left in flight.
    The registry is re-read after every wait, so a probe registered while the
    scrub waited is waited for too."""
    deadline = time.monotonic() + _SCRUB_PROBE_WAIT_S
    while True:
        unfinished = _unfinished_probes(key)
        if not unfinished:
            return True
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return False
        await asyncio.to_thread(unfinished[0].wait, remaining)


async def _scrub_decide(host: str, port: int) -> tuple[str, ScrubRelaunchResult | None]:
    key = mt5_terminal_key(host, port)
    if not await _wait_for_unfinished_probes(key):
        return SCRUB_KIND_SKIPPED_PROBE_IN_FLIGHT, None
    house = read_env_mt5_credentials()
    if house is None:
        return SCRUB_KIND_SKIPPED_NO_HOUSE_CREDENTIALS, None
    try:
        result = await asyncio.wait_for(
            asyncio.to_thread(
                _scrub_validation_terminal_blocking,
                host,
                port,
                house,
                heal_deadline(_VALIDATION_SCRUB_BUDGET_S),
            ),
            timeout=_VALIDATION_SCRUB_BUDGET_S,
        )
    except TimeoutError:
        return SCRUB_KIND_ABANDONED, None
    kind = _classify(result)
    if kind == SCRUB_KIND_SCRUBBED:
        clear_mt5_scrub_owed(key)
    return kind, result


async def _scrub_under_lease(host: str, port: int, *, site: str) -> str:
    """The scrub, with the validation terminal's lease ALREADY HELD. Returns the
    kind. Writes exactly one row and alerts on every non-scrubbed kind.

    In order: the W-1 wait; the house triple; the bounded blocking scrub; the
    classification; the mark cleared on ``scrubbed`` only; the alert; the row.
    Anything raising inside (the client's construction, ``Mt5SessionAbandoned``
    from the fence, an unexpected error) becomes ``failed`` and still gets its
    alert and its row. ``asyncio.CancelledError`` is not an ``Exception`` and
    passes through.
    """
    result: ScrubRelaunchResult | None = None
    try:
        kind, result = await _scrub_decide(host, port)
    except Exception as exc:  # noqa: BLE001 — every exit is a recorded kind
        logger.error(
            "mt5 validation terminal scrub: the scrub raised (exc_class=%s)",
            type(exc).__name__,
        )
        kind = SCRUB_KIND_FAILED
    if kind != SCRUB_KIND_SCRUBBED:
        _alert_scrub_failed(_KIND_CAUSES.get(kind, _CAUSE_UNRECOGNISED), site=site)
    else:
        logger.info(
            "mt5 validation terminal scrub: scrubbed and house-relaunched "
            "(site=%s)",
            _normalize_site(site),
        )
    await record_mt5_terminal_scrub(kind=kind, site=site, result=result)
    return kind


async def scrub_validation_terminal(host: str, port: int, *, site: str) -> None:
    """The scheduled task: the scrub in its OWN lease. NEVER RAISES ``Exception``.

    The lease is unbounded (``wait_s=None``): the task queues behind whoever
    holds the terminal, and nothing can log in while it scrubs. A raise from the
    lease itself still writes a ``failed`` row. The outer guard is the shared
    never-raises shape (one ``except Exception`` whose body is one nested
    ``try`` with a ``BaseException`` fallback).

    ⛔ The pending key is released INSIDE the lease body, while the lock is
    still held. The lease's own exit releases the lock and only then awaits the
    handover row (up to 5 s on a slow sink). A key released after that would
    still read as pending while the terminal is free: a validation that ran in
    that gap would schedule, be deduped onto this finished task, and leave the
    mark set with no scrub coming. A raise before the body ran (the lease's
    acquisition) releases the key in the outer ``finally`` instead, guarded by
    ``released`` so it never drops a key a newer task has since taken.
    """
    try:
        key = mt5_terminal_key(host, port)
        released = False
        try:
            async with mt5_terminal_lease(
                key, wait_s=None, holder=HOLDER_HOUSE, site=SITE_TERMINAL_SCRUB
            ):
                try:
                    await _scrub_under_lease(host, port, site=site)
                finally:
                    _PENDING_SCRUB_KEYS.discard(key)
                    released = True
        except Exception as lease_error:  # noqa: BLE001 — every exit is a recorded kind
            logger.error(
                "mt5 validation terminal scrub: the scrub's lease raised "
                "(exc_class=%s)",
                type(lease_error).__name__,
            )
            _alert_scrub_failed(SCRUB_KIND_FAILED, site=site)
            await record_mt5_terminal_scrub(
                kind=SCRUB_KIND_FAILED, site=site, result=None
            )
        finally:
            if not released:
                _PENDING_SCRUB_KEYS.discard(key)
    except Exception as exc:  # noqa: BLE001 — see the docstring; this is the control
        try:
            logger.error(
                "mt5 validation terminal scrub: the scrub task failed "
                "(exc_class=%s)",
                type(exc).__name__,
            )
        except BaseException:  # noqa: BLE001 — see the docstring; this is the control
            logger.error(
                "mt5 validation terminal scrub: the scrub task failed, and the "
                "failure could not be described"
            )


def schedule_validation_terminal_scrub(
    host: str,
    port: int,
    *,
    site: str,
    probe_thread_done: threading.Event | None,
) -> None:
    """Mark the validation terminal scrub-owed and spawn its scrub. Synchronous
    and NEVER RAISES. Call it from the event loop, while the validation's own
    lease is still held, so its probe event is registered before the scrub can
    acquire the terminal.

    The mark is set FIRST, so even a scrub that could not be spawned leaves the
    terminal visibly owing one. ``probe_thread_done`` (the validation probe
    thread's own event) is registered for W-1. At most one task is pending per
    terminal: a second schedule while one is pending only marks and registers.
    """
    try:
        key = mt5_terminal_key(host, port)
        note_mt5_scrub_owed(key)
        if probe_thread_done is not None:
            _register_probe(key, probe_thread_done)
        if key in _PENDING_SCRUB_KEYS:
            return
        loop = asyncio.get_running_loop()
        task = loop.create_task(scrub_validation_terminal(host, port, site=site))
        _PENDING_SCRUB_KEYS.add(key)
        _SCRUB_TASKS.add(task)

        def _done(finished: asyncio.Task[None]) -> None:
            _SCRUB_TASKS.discard(finished)
            if finished.cancelled():
                # Cancelled before its own `finally` could release the key.
                _PENDING_SCRUB_KEYS.discard(key)

        task.add_done_callback(_done)
    except Exception as exc:  # noqa: BLE001 — scheduling must never replace the verdict
        try:
            logger.error(
                "mt5 validation terminal scrub: the scrub could not be scheduled "
                "(exc_class=%s); the terminal stays marked as owing one",
                type(exc).__name__,
            )
        except BaseException:  # noqa: BLE001
            pass


async def run_owed_validation_scrub_in_lease(host: str, port: int, *, site: str) -> bool:
    """The worker's inline path (Decision 6): the worker already holds the
    validation terminal's lease, has no client budget, and pays an owed scrub
    before its probe. True only when the scrub came to ``scrubbed``. NEVER
    RAISES ``Exception``."""
    try:
        return await _scrub_under_lease(host, port, site=site) == SCRUB_KIND_SCRUBBED
    except Exception as exc:  # noqa: BLE001 — see the docstring; this is the control
        try:
            logger.error(
                "mt5 validation terminal scrub: the inline scrub failed "
                "(exc_class=%s)",
                type(exc).__name__,
            )
            return False
        except BaseException:  # noqa: BLE001 — see the docstring; this is the control
            return False


def _count_or_none(verdict: dict[str, object], key: str) -> int | None:
    value = verdict.get(key)
    if isinstance(value, int) and not isinstance(value, bool):
        return value
    return None


def _scrub_row_metadata(
    *, kind: object, site: object, result: ScrubRelaunchResult | None
) -> dict[str, Any]:
    verdict: dict[str, object] = result.verdict if result is not None else {}
    errors = verdict.get("accounts_errors")
    relaunch_status = (
        result.post_status
        if result is not None and result.post_status in _RELAUNCH_STATUSES
        else None
    )
    return {
        "schema_version": SCHEMA_VERSION,
        "kind": kind if isinstance(kind, str) and kind in _SCRUB_KINDS else _CAUSE_UNRECOGNISED,
        "terminal_role": _TERMINAL_ROLE_VALIDATION,
        "site": _normalize_site(site),
        "refused": _count_or_none(verdict, "refused"),
        "accounts_deleted": _count_or_none(verdict, "accounts_deleted"),
        "accounts_missing": _count_or_none(verdict, "accounts_missing"),
        "accounts_errors": len(errors) if isinstance(errors, list) else None,
        "trades_deleted": _count_or_none(verdict, "trades_deleted"),
        "profile_accounts_found": _count_or_none(verdict, "profile_accounts_found"),
        "relaunch_status": relaunch_status,
        "records_account_number": False,
    }


async def _insert_scrub_row(
    *, kind: object, site: object, result: ScrubRelaunchResult | None
) -> None:
    now = datetime.now(timezone.utc).isoformat()
    payload: dict[str, Any] = {
        "cron_name": MT5_TERMINAL_SCRUB_CRON_NAME,
        # ⭐ A POINT EVENT: closed at insert, never a `running` row.
        "started_at": now,
        "completed_at": now,
        "status": "ok",
        "error": None,
        # ⛔ A closed key set (`_SCRUB_ROW_METADATA_KEYS`).
        "metadata": _scrub_row_metadata(kind=kind, site=site, result=result),
    }
    supabase = get_supabase()

    def _insert() -> Any:
        return supabase.table("cron_runs").insert(payload).execute()

    response = await db_execute(_insert)
    if not rows(response):
        logger.error(
            "mt5 validation terminal scrub: the INSERT returned no rows — the "
            "record may not have landed"
        )


async def record_mt5_terminal_scrub(
    *, kind: str, site: str, result: ScrubRelaunchResult | None
) -> None:
    """Write ONE already-closed scrub row. NEVER RAISES ``Exception``.

    ``record_mt5_terminal_handover``'s shape: one ``try`` whose one handler
    catches bare ``Exception`` and whose body is one nested ``try`` with a
    ``BaseException`` fallback. The metadata build, the client, the insert and
    its bound all sit inside the outer ``try``. ``asyncio.CancelledError`` passes
    through.
    """
    try:
        await asyncio.wait_for(
            _insert_scrub_row(kind=kind, site=site, result=result),
            timeout=_SCRUB_RECORD_TIMEOUT_S,
        )
    except Exception as exc:  # noqa: BLE001 — see the docstring; this is the control
        try:
            logger.warning(
                "mt5 validation terminal scrub: the scrub outcome could not be "
                "recorded (exc_class=%s)",
                type(exc).__name__,
            )
        except BaseException:  # noqa: BLE001 — see the docstring; this is the control
            logger.warning(
                "mt5 validation terminal scrub: the scrub outcome could not be "
                "recorded, and the failure could not be described"
            )
