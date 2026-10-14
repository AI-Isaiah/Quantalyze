"""The MT5 terminal OUTAGE TRACKER (Phase 164.6.8 OUTAGEALERT, plan 04; D-04, D-05,
D-06, D-13).

WHY THIS EXISTS. ``mt5_session_episodes`` counts a "blind run" (consecutive
readings that MEASURED NOTHING) and raised it from INFO to WARNING, which is
below the Sentry event level, so nothing outside that module ever read it. And a
measured ``dark`` reading (code -6) RESETS that counter, so a terminal that is
logged out and says so on every tick never escalated at all. This module keeps a
SEPARATE run, keyed by terminal role, that counts every reading which is not a
MEASURED ``authorized`` one and pages a human through ``ops_alert.page``.

THE RULES, one line each:

* D-04 -- page when the run reaches ``blind_run_escalation_threshold(
  poll_interval_s)``, the EXISTING threshold. No new number is invented here.
* D-05 -- ``page`` is called on every qualifying reading and the helper's hourly
  window per ``(source, cause, event)`` bounds the captures and emails. A kind in
  ``_DECIDED_BLIND_KINDS`` (the deliberate kill switch) is counted but never pages.
  The page's cause is PINNED for the run at the threshold crossing (``_Run.
  page_cause``), so one wedge is one fingerprint however the reading kind changes
  (review WR-02 (b)); the recovery clears the source's outage window (WR-02 (a)).
* D-06 -- the ONLY thing that ends a paged run is a MEASURED ``authorized``
  reading, which sends exactly one "recovered" notice. A busy skip, a budget
  abandon and the ``code=0`` sentinel are ``not_measured``: they EXTEND the run.
* D-13 -- the page carries the wedge evidence captured BEFORE the run's first
  recycle (``note_wedge_evidence``), scrubbed of account digits, broker server
  name and machine paths. The page path runs outside the terminal lease and never
  touches the terminal: it delivers a snapshot already taken, it does not take one.

⚠️ THE THRESHOLD COUNTS READINGS, NOT TICKS. ``record_mt5_heal_outcome`` records
TWO readings on a tick where the heal ran (the first probe and the final one), so
a persisting fault the heal acts on reaches the threshold in fewer ticks than one
per reading. That is the existing threshold's own semantics (it is defined in
readings, exactly as ``_count_blind_reading`` counts them), not a new number.

⚠️ THE RUN IS IN-PROCESS, like the blind-run counter: a redeploy forgets it and
delays a page by at most one threshold. The boot heal passes ``poll_interval_s=
None``, so its threshold is ``None`` and it never pages, exactly as it never
escalates.

⭐ THE OPEN PAGE IS NOT (review WR-01). A redeploy is the most likely way an MT5
incident ends, and a run that lived only in memory made the recovery vanish with it:
the new process saw a healthy reading with no run, and the founder's inbox ended on
OUTAGE. So a page that goes out is also recorded in ``services.ops_alert_open`` (a
``cron_runs`` row per open source, no migration), and the first MEASURED authorized
reading of a process consults that record once per source and sends the recovered
notice for a page the previous process left open. The relaunch-debt set is
process-local too, so the new process owes no debt: the same first healthy jobs
reading settles a debt page the previous process left open.

⛔ IMPORT ORDER. This module imports ``mt5_session_episodes`` at module level (the
state constants and the threshold). ``mt5_session_episodes`` therefore must NOT
import this module at module level: its hook is a FUNCTION-LOCAL import inside
``record_mt5_session_reading``'s single ``try``. This module never imports
``mt5_relogin`` or ``mt5_session_monitor``; ``mt5_relogin`` imports this one.

⛔ NOTHING HERE RAISES. The tracker runs inside the never-raises heal and monitor
path; an alert call raising into ``_crash_handler`` would stop the worker loops
behind a green ``/health``. Each public function is exactly one ``try`` with the
IN-06 handler shape, and the tests pin that shape with the shared predicate.
"""

from __future__ import annotations

import asyncio
import logging
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Final

from services import ops_alert, ops_alert_open
from services.ops_alert import await_delivery
from services.mt5_session_episodes import (
    _DECIDED_BLIND_KINDS,
    STATE_AUTHORIZED,
    STATE_DARK,
    blind_run_escalation_threshold,
)

logger = logging.getLogger("quantalyze.analytics.mt5_outage_alert")

#: Terminal roles. Plan 06 reuses the tracker for the validation terminal.
ROLE_JOBS: Final[str] = "jobs"
ROLE_VALIDATION: Final[str] = "validation"

#: role -> ``ops_alert`` source. Both members of ``OPS_ALERT_SOURCES``; a parity
#: test pins that, because a source outside the set is paged as ``unrecognised``.
_SOURCE_BY_ROLE: Final[dict[str, str]] = {
    ROLE_JOBS: "mt5_jobs_terminal",
    ROLE_VALIDATION: "mt5_validation_terminal",
}

#: The cause for a measured ``dark`` reading. Every other cause is the reading's
#: own ``kind`` (``ipc_fault``, ``busy_skip``, ``budget_abandoned``, ...).
CAUSE_DARK: Final[str] = "dark"

#: Plan 07 (SC-2): the relaunch-debt page. ``mt5_relaunch_debt`` is a member of
#: ``OPS_ALERT_SOURCES`` (a parity test pins that, as it does for the role sources).
SOURCE_RELAUNCH_DEBT: Final[str] = "mt5_relaunch_debt"
CAUSE_DEBT_LEASE_BUSY: Final[str] = "lease_busy_with_relaunch_debt"

_RECOVERED_PREFIX: Final[str] = "recovered_from_"
#: ``OPS_ALERT_CAUSE_RE`` admits 64 characters; the prefix takes 15 of them.
_CAUSE_MAX: Final[int] = 64
_RECOVERED_CAUSE_TAIL_MAX: Final[int] = _CAUSE_MAX - len(_RECOVERED_PREFIX)

_EVIDENCE_NOT_CAPTURED: Final[str] = (
    "not_captured (no recycle ran in this outage run)"
)
_FILE_VERSIONS_NOT_CAPTURED: Final[str] = "not_captured"


@dataclass
class _Run:
    """One terminal role's outage run.

    ``count == 0`` with an ``evidence`` value is a STASH WITH NO RUN OPEN: the
    heal thread stashes BEFORE the reading that opens the run reaches the event
    loop, and opening the run must keep it.
    """

    count: int = 0
    since: datetime | None = None
    last_cause: str | None = None
    #: The cause at the threshold crossing, PINNED for the run (review WR-02 (b)).
    #: The reading kind changes inside one wedge (``ipc_fault``, ``busy_skip``,
    #: ``budget_abandoned``, ``dark``); each new kind would otherwise be a fresh
    #: window key and a fresh Sentry fingerprint, so one incident paged three or
    #: four times an hour. The run pages, and recovers, under this one cause.
    page_cause: str | None = None
    paged: bool = False
    #: The FIRST pre-recycle fragment of the run (``build=... connected=...``).
    evidence: str | None = None
    #: The LATEST bridge-side file versions, read by the recycle itself AFTER the
    #: pre-recycle capture, so it is its own field and not subject to first-wins.
    file_versions: str | None = None
    #: The durable open-page record has landed for this run (review WR-01). False
    #: until ``ops_alert_open.record_open_page`` reports a row, so a sink hiccup at
    #: the moment of the page is retried on the next qualifying reading.
    recorded: bool = False


#: The heal stashes from a worker THREAD (``_heal_blocking``); the tracker reads
#: from the event loop. Every access holds the lock; none awaits inside it.
_LOCK = threading.Lock()
_RUNS: dict[str, _Run] = {}


@dataclass
class _DebtRun:
    """The relaunch-debt page state (plan 07, SC-2): the first tick of this run
    whose bounded lease acquire expired with a debt owed, how many such ticks, and
    whether a page was sent (a recovered notice is owed only after a page)."""

    since: datetime | None = None
    busy_ticks: int = 0
    debt_paged: bool = False
    #: As ``_Run.recorded``: the durable open-page record has landed.
    recorded: bool = False


_DEBT = _DebtRun()

#: Sources whose durable open record this process has already consulted (or closed).
#: The record is read ONCE per source per process, on the first healthy reading; a
#: read that FAILED does not enter this set, so it is retried (review WR-01).
_DURABLE_CHECKED: set[str] = set()


#: Strong references to the held recovery tasks (CPython keeps only a weak one).
_RECOVERY_TASKS: set[asyncio.Task[None]] = set()

#: Why a source's recovered notice is owed AGAIN by THIS process, so the re-send says
#: so. A source absent here that has an open record is a page a PREVIOUS process left
#: open: only that case may say the service restarted (review WR-R3-02).
_REASON_RESTART: Final[str] = "after the analytics service restarted while a page was open"
_REASON_UNDELIVERED: Final[str] = (
    "after the recovered notice for this page reached no channel, so this is a re-send"
)
_REASON_CLOSE_FAILED: Final[str] = (
    "after the recovered notice for this page was sent but its open-page record "
    "could not be closed, so this is a retried close"
)
_RESEND_REASON: dict[str, str] = {}


def _reset_outage_state_for_tests() -> None:
    """Test-only: forget every role's run and stash, and the debt page state."""
    global _DEBT
    with _LOCK:
        _RUNS.clear()
        _DEBT = _DebtRun()
        _DURABLE_CHECKED.clear()
        _RESEND_REASON.clear()
    for task in list(_RECOVERY_TASKS):
        task.cancel()
    _RECOVERY_TASKS.clear()


async def _drain_recovery_tasks_for_tests() -> None:
    """Test-only: wait for every held recovery task to finish."""
    pending = list(_RECOVERY_TASKS)
    if pending:
        await asyncio.gather(*pending, return_exceptions=True)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _cause_for(reading_state: str, kind: str) -> str:
    return CAUSE_DARK if reading_state == STATE_DARK else kind[:_CAUSE_MAX]


def _format_code(code: int | None) -> str:
    """The MT5 code, formatted so the 5-digit digit-run scrub does not eat it.

    ``ops_alert.scrub_alert_detail`` replaces every run of five or more digits
    (account numbers), and the IPC fault codes ``-10003`` .. ``-10005`` are exactly
    five digits. Thousands separators keep the code legible; the value is an
    ``int`` the classifier produced, never an account number.
    """
    return "none" if code is None else f"{code:,}"


def _scrubbed(text: str | None, fallback: str) -> str:
    return ops_alert.scrub_alert_detail(text if text else fallback)


def _outage_detail(
    role: str,
    run: _Run,
    cause: str,
    latest_cause: str,
    code: int | None,
    threshold: int,
) -> str:
    since = run.since
    return (
        f"terminal={role} cause={cause} latest_reading_cause={latest_cause} "
        f"code={_format_code(code)} "
        f"consecutive_readings={run.count} escalation_threshold={threshold} "
        f"since={since.isoformat(timespec='seconds') if since else 'unknown'} "
        f"wedge_evidence=[{_scrubbed(run.evidence, _EVIDENCE_NOT_CAPTURED)}] "
        f"recycle_file_versions=["
        f"{_scrubbed(run.file_versions, _FILE_VERSIONS_NOT_CAPTURED)}]"
    )


def _recovered_detail(role: str, run: _Run, kind: str, now: datetime) -> str:
    since = run.since
    minutes = (
        int((now - since).total_seconds() // 60) if since is not None else None
    )
    return (
        f"terminal={role} recovered: the first MEASURED authorized reading "
        f"(kind={kind}) after {run.count} consecutive non-authorized readings, "
        f"since={since.isoformat(timespec='seconds') if since else 'unknown'} "
        f"duration_min={minutes if minutes is not None else 'unknown'}"
    )


def _advance_run(
    role: str,
    reading_state: str,
    kind: str,
    code: int | None,
    poll_interval_s: float | None,
) -> dict[str, Any] | None:
    """Apply ONE reading to the role's run and return the page to send, if any.

    Synchronous and awaitless on purpose: the whole state change happens under the
    lock, then the (async) page is sent outside it.
    """
    source = _SOURCE_BY_ROLE[role]
    now = _utcnow()
    with _LOCK:
        if reading_state == STATE_AUTHORIZED:
            # D-06: the ONLY exit from a run. Popping clears the stash too, so
            # the next outage run starts with its own evidence.
            run = _RUNS.pop(role, None)
            if run is None or not run.paged:
                return None
            tail = (run.page_cause or run.last_cause or "unknown")[
                :_RECOVERED_CAUSE_TAIL_MAX
            ]
            return {
                "source": source,
                "cause": _RECOVERED_PREFIX + tail,
                "event": "recovered",
                "since": run.since,
                "detail": _recovered_detail(role, run, kind, now),
            }

        run = _RUNS.setdefault(role, _Run())
        if run.count == 0:
            # Opening the run keeps any stash that is already present.
            run.since = now
        run.count += 1
        cause = _cause_for(reading_state, kind)
        run.last_cause = cause
        threshold = blind_run_escalation_threshold(poll_interval_s)
        if (
            threshold is None
            or run.count < threshold
            or kind in _DECIDED_BLIND_KINDS
        ):
            return None
        if run.page_cause is None:
            run.page_cause = cause
        run.paged = True
        return {
            "source": source,
            "cause": run.page_cause,
            "event": "outage",
            "since": run.since,
            "detail": _outage_detail(
                role, run, run.page_cause, cause, code, threshold
            ),
            "needs_record": not run.recorded,
        }


def _owed_recovered_detail(
    label: str,
    found: ops_alert_open.OpenPage,
    kind: str,
    now: datetime,
    reason: str,
) -> str:
    since = found.since
    minutes = (
        int((now - since).total_seconds() // 60) if since is not None else None
    )
    return (
        f"{label} recovered: the first MEASURED authorized reading (kind={kind}) "
        f"{reason}, "
        f"since={since.isoformat(timespec='seconds') if since else 'unknown'} "
        f"duration_min={minutes if minutes is not None else 'unknown'}"
    )


async def _durable_recovery_request(
    source: str, label: str, kind: str
) -> dict[str, Any] | None:
    """The recovered notice owed for a page a PREVIOUS process left open, or None.

    Consults the durable record at most once per source per process: a read that
    answers (open or not) marks the source checked, and a read that FAILS does not,
    so "could not look" is retried on the next healthy reading rather than being
    mistaken for "nothing is open" (review WR-01). The caller is the never-raises
    tracker; this catches its own read failure so the other source still runs.
    """
    with _LOCK:
        if source in _DURABLE_CHECKED:
            return None
    try:
        found = await ops_alert_open.read_open_page(source)
    except Exception as exc:  # noqa: BLE001 - retried on the next healthy reading
        logger.warning(
            "mt5 outage alert: the open-page record could not be read; the "
            "restart recovery is retried on the next healthy reading "
            "(exc_class=%s)",
            type(exc).__name__,
        )
        return None
    with _LOCK:
        _DURABLE_CHECKED.add(source)
        # An in-process retry carries the reason this process recorded; no entry
        # means the open record is a previous process's, and only then is "the
        # service restarted" true.
        reason = _RESEND_REASON.get(source, _REASON_RESTART)
        if found is None:
            _RESEND_REASON.pop(source, None)
    if found is None:
        return None
    return {
        "source": source,
        "cause": _RECOVERED_PREFIX + found.cause[:_RECOVERED_CAUSE_TAIL_MAX],
        "event": "recovered",
        "since": found.since,
        "detail": _owed_recovered_detail(label, found, kind, _utcnow(), reason),
    }


def _mark_run_recorded(role: str) -> None:
    with _LOCK:
        run = _RUNS.get(role)
        if run is not None:
            run.recorded = True


async def _finish_recovered(source: str, delivery: object) -> None:
    """Close the durable record IF a channel has the recovered notice. Never raises.

    The held half of ``_send_recovered``. A recovered notice is one-shot: the run (or
    the debt state) is already gone, so nothing but the durable record can make it be
    sent again (review WR-R2-01). The record is therefore closed only once the notice
    reached a channel. Otherwise it stays open and is marked STALE (a NEW incident
    that records first replaces it instead of inheriting its cause and ``since``), and
    the source is left UNMARKED, so the next measured healthy reading finds the record
    and sends the notice again. That holds on every way out that did not close the
    record, a cancelled wait included (review WR-R3-03).
    """
    closed = False
    delivered = False
    try:
        if not await await_delivery(delivery):
            logger.error(
                "mt5 outage alert: the recovered notice reached no channel; the "
                "open-page record stays open and the next healthy reading sends "
                "it again (source=%s)",
                source,
            )
            return
        delivered = True
        closed = await ops_alert_open.close_open_page(source)
    except Exception as exc:  # noqa: BLE001 - a held task must not die with an unretrieved error
        try:
            logger.warning(
                "mt5 outage alert: closing the open-page record failed - it is "
                "retried on the next healthy reading (source=%s exc_class=%s)",
                source,
                type(exc).__name__,
            )
        except BaseException:  # noqa: BLE001 - IN-06 shape, no await inside
            pass
    finally:
        if not closed:
            ops_alert_open.mark_open_page_stale(source)
        with _LOCK:
            if closed:
                _DURABLE_CHECKED.add(source)
                _RESEND_REASON.pop(source, None)
            else:
                _DURABLE_CHECKED.discard(source)
                _RESEND_REASON[source] = (
                    _REASON_CLOSE_FAILED if delivered else _REASON_UNDELIVERED
                )


async def _send_recovered(
    source: str,
    cause: str,
    since: datetime | None,
    detail: str,
) -> None:
    """Send ONE RECOVERED notice, then close the durable record IF a channel has it.

    ``page`` returns at once (a Sentry capture and a scheduled POST), so this sends the
    notice inline. The WAIT for its outcome and the close (``_finish_recovered``) run
    as a held task when the outcome is still open, NOT on the caller's path: this is
    awaited from ``record_mt5_session_reading`` BEFORE it writes the healthy episode
    row and from the heal after its work, both inside bounds that cancel, and a slow
    founder email must never cost the reading that ends the episode (review
    R3-SFH-01). An outcome that is already decided is acted on inline.
    """
    scheduled = False
    try:
        delivery = await ops_alert.page(
            source, cause, event="recovered", since=since, detail=detail
        )
        if isinstance(delivery, asyncio.Future) and not delivery.done():
            task = asyncio.get_running_loop().create_task(
                _finish_recovered(source, delivery)
            )
            _RECOVERY_TASKS.add(task)
            task.add_done_callback(_RECOVERY_TASKS.discard)
            scheduled = True
        else:
            scheduled = True
            await _finish_recovered(source, delivery)
    finally:
        if not scheduled:
            with _LOCK:
                _DURABLE_CHECKED.discard(source)


async def _send_request(role: str | None, request: dict[str, Any]) -> None:
    """Send ONE page, then keep the durable open-page record in step with it.

    An OUTAGE that has no record yet writes one (retried on the next qualifying
    reading if the sink refused); a RECOVERED closes it only after a channel took
    the notice (``_send_recovered``).
    """
    if request["event"] == "recovered":
        await _send_recovered(
            request["source"], request["cause"], request["since"], request["detail"]
        )
        return
    await ops_alert.page(
        request["source"],
        request["cause"],
        event=request["event"],
        since=request["since"],
        detail=request["detail"],
    )
    if request.get("needs_record") and role is not None:
        if await ops_alert_open.record_open_page(
            request["source"], request["cause"], request["since"]
        ):
            _mark_run_recorded(role)


async def note_outage_reading(
    role: str,
    reading_state: str,
    kind: str,
    code: int | None,
    *,
    poll_interval_s: float | None,
) -> None:
    """Feed ONE session reading to the role's outage run. Never raises.

    Called once per reading from ``record_mt5_session_reading``, BEFORE its
    ``not_measured`` early return, so both branches reach it. A ``page`` call
    that raises is swallowed here and never reaches the episode recorder.
    """
    try:
        request = _advance_run(role, reading_state, kind, code, poll_interval_s)
        measured_healthy = reading_state == STATE_AUTHORIZED
        if request is None and measured_healthy:
            # A page the PREVIOUS process left open (review WR-01): this process
            # has no run for it, so the durable record is the only memory of it.
            request = await _durable_recovery_request(
                _SOURCE_BY_ROLE[role], f"terminal={role}", kind
            )
        if request is not None:
            await _send_request(role, request)
        if measured_healthy and role == ROLE_JOBS:
            # The relaunch-debt set is process-local, so a restarted process owes
            # no debt: a debt page the previous process left open ends here, unless
            # THIS process has paged one (only its settle may end that).
            with _LOCK:
                debt_paged_here = _DEBT.debt_paged
            if not debt_paged_here:
                debt_request = await _durable_recovery_request(
                    SOURCE_RELAUNCH_DEBT, f"terminal={role} relaunch debt", kind
                )
                if debt_request is not None:
                    await _send_request(None, debt_request)
    except Exception as exc:  # noqa: BLE001 - an alert must never replace the reading
        try:
            logger.warning(
                "mt5 outage alert: the outage tracker failed - the reading is "
                "recorded as usual (exc_class=%s)",
                type(exc).__name__,
            )
        except BaseException:  # noqa: BLE001 - IN-06 shape, no await inside
            logger.warning(
                "mt5 outage alert: the outage tracker failed, and the failure "
                "could not be described"
            )


def note_wedge_evidence(role: str, fragment: str) -> None:
    """Stash the PRE-RECYCLE evidence fragment for the role. Never raises.

    Keeps the FIRST fragment of a run: a second recycle attempt in the same run
    must not overwrite the snapshot taken before the first one. Called from the
    heal's worker thread, BEFORE the reading reaches the event loop, so it may
    create the role's state with no run open (opening the run keeps it).
    """
    try:
        with _LOCK:
            run = _RUNS.setdefault(role, _Run())
            if run.evidence is None:
                run.evidence = fragment
    except Exception as exc:  # noqa: BLE001 - the heal must never see this
        try:
            logger.warning(
                "mt5 outage alert: the wedge evidence could not be stashed "
                "(exc_class=%s)",
                type(exc).__name__,
            )
        except BaseException:  # noqa: BLE001 - IN-06 shape
            logger.warning(
                "mt5 outage alert: the wedge evidence could not be stashed, "
                "and the failure could not be described"
            )


def note_recycle_file_versions(role: str, file_versions: str) -> None:
    """Stash the bridge-side file versions the recycle read. Never raises.

    A SEPARATE field that keeps the LATEST value: the recycle reads it AFTER the
    pre-recycle capture, and a later recycle's reading is the more current one.
    """
    try:
        with _LOCK:
            _RUNS.setdefault(role, _Run()).file_versions = file_versions
    except Exception as exc:  # noqa: BLE001 - the heal must never see this
        try:
            logger.warning(
                "mt5 outage alert: the recycle file versions could not be "
                "stashed (exc_class=%s)",
                type(exc).__name__,
            )
        except BaseException:  # noqa: BLE001 - IN-06 shape
            logger.warning(
                "mt5 outage alert: the recycle file versions could not be "
                "stashed, and the failure could not be described"
            )


async def note_relaunch_debt_lease_busy(*, detail: str) -> None:
    """The heal's bounded lease acquire expired while a relaunch debt is owed. Page.

    Plan 07 (SC-2, D-14). The ERROR log line the busy arm already writes reaches a
    human only through an unverified Sentry rule; this is the page that does. It is
    called on EVERY such tick and the helper's hourly window per ``(source, cause,
    event)`` bounds the captures and emails (D-05), exactly as the outage tracker
    relies on it. ``since`` is the first such tick of this run, kept so the page
    names the incident and not the latest tick. ``detail`` is closed text: the
    caller passes no host, port, account or credential, and ``ops_alert`` scrubs it
    once more. Never raises.
    """
    try:
        now = _utcnow()
        with _LOCK:
            if _DEBT.since is None:
                _DEBT.since = now
            _DEBT.busy_ticks += 1
            _DEBT.debt_paged = True
            since = _DEBT.since
            busy_ticks = _DEBT.busy_ticks
            needs_record = not _DEBT.recorded
        await ops_alert.page(
            SOURCE_RELAUNCH_DEBT,
            CAUSE_DEBT_LEASE_BUSY,
            event="outage",
            since=since,
            detail=f"{detail} busy_ticks={busy_ticks}",
        )
        if needs_record and await ops_alert_open.record_open_page(
            SOURCE_RELAUNCH_DEBT, CAUSE_DEBT_LEASE_BUSY, since
        ):
            with _LOCK:
                _DEBT.recorded = True
    except Exception as exc:  # noqa: BLE001 - an alert must never replace the heal
        try:
            logger.warning(
                "mt5 outage alert: the relaunch-debt page failed - the heal is "
                "unaffected (exc_class=%s)",
                type(exc).__name__,
            )
        except BaseException:  # noqa: BLE001 - IN-06 shape, no await inside
            logger.warning(
                "mt5 outage alert: the relaunch-debt page failed, and the failure "
                "could not be described"
            )


async def note_relaunch_debt_settled() -> None:
    """A heal paid the relaunch debt. Send ONE recovered notice if a page was sent.

    Plan 07 (D-06). A debt paid with no prior page (the debt was cleared on the
    first tick it was seen) sends nothing. The state is cleared BEFORE the page
    goes out, so a page that fails cannot resend. Never raises.
    """
    try:
        now = _utcnow()
        with _LOCK:
            run = _DEBT
            paged = run.debt_paged
            since = run.since
            busy_ticks = run.busy_ticks
            run.since = None
            run.busy_ticks = 0
            run.debt_paged = False
            run.recorded = False
        if not paged:
            # No page from THIS process; one the previous process left open is
            # still owed its recovered notice (review WR-01).
            restart_request = await _durable_recovery_request(
                SOURCE_RELAUNCH_DEBT, "terminal=jobs relaunch debt", "debt_paid"
            )
            if restart_request is not None:
                await _send_request(None, restart_request)
            return
        minutes = int((now - since).total_seconds() // 60) if since else None
        await _send_recovered(
            SOURCE_RELAUNCH_DEBT,
            _RECOVERED_PREFIX + CAUSE_DEBT_LEASE_BUSY,
            since,
            (
                "terminal=jobs recovered: a heal won the terminal lease and "
                f"paid the relaunch debt after {busy_ticks} tick(s) that could "
                f"not get it, since="
                f"{since.isoformat(timespec='seconds') if since else 'unknown'} "
                f"duration_min={minutes if minutes is not None else 'unknown'}"
            ),
        )
    except Exception as exc:  # noqa: BLE001 - an alert must never replace the heal
        try:
            logger.warning(
                "mt5 outage alert: the relaunch-debt recovered notice failed - "
                "the heal is unaffected (exc_class=%s)",
                type(exc).__name__,
            )
        except BaseException:  # noqa: BLE001 - IN-06 shape, no await inside
            logger.warning(
                "mt5 outage alert: the relaunch-debt recovered notice failed, and "
                "the failure could not be described"
            )
