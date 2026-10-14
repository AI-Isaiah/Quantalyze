"""Phase 164.6.8 (OUTAGEALERT) plan 06, D-09 -- the VALIDATION terminal's liveness.

``MT5-VALIDATION-TERMINAL-COVERAGE-01``. Until this module nothing measured the
validation gateway (``MT5_VALIDATION_GATEWAY_HOST`` / ``_PORT``) except a user's own
validation, so a wedged or logged-out validation terminal was noticed only when a
client's key failed to validate. This module closes that in the in-process session
monitor, the instrument that already runs on a cadence and already owns the
escalation threshold.

INSTRUMENT CHOICE, AND WHAT WAS DELIBERATELY NOT DONE (plan 06 objective):

* The prod-prober's mt5 arm is NOT extended to the validation service: it would need
  a new Railway service secret in GitHub, and its output is a GitHub issue, which is
  not the paging channel.
* The boot heal and the ipc-fault recycle are NOT extended to the validation
  terminal. The 164.6.6.1 scrub already ends and relaunches that terminal after each
  validation, and a second recycler on it would race the scrub. This module only
  READS the terminal, and pages.

TWO HALVES, both called from ``run_mt5_session_monitor_tick`` after the jobs heal:

(a) ``probe_validation_terminal`` -- one credential-free ``assert_session_authorized``
    (the SAME primitive the jobs heal's first probe is, ``Mt5Client.
    assert_session_authorized``, whose mapping to a verdict kind is repeated in
    ``_probe_blocking`` below) under a short bounded lease on the validation
    terminal's key. The reading goes to ``mt5_outage_alert.note_outage_reading``
    under ``ROLE_VALIDATION``, so the existing threshold, the hourly window, the
    "decided" kinds and the one recovered notice apply unchanged.
(b) ``read_unscrubbed_validation_terminal`` -- the ROW reader D-09 (b) names for
    the ``mt5_terminal_scrub`` ``cron_runs`` rows 164.6.6.1 writes. ``_alert_scrub_
    failed`` captures at WRITE time; nothing read the row back. A row whose kind is
    anything other than ``scrubbed`` means a client's saved login or deal history
    may still be on the terminal, and pages once per row.

THE PROBE NEVER LOGS IN. It sends no credential, changes no account, never touches
the scrub-owed mark and does not register as an unfinished validation probe (the
scrub's W-1 gate waits on those). Its lease is held for ``HOLDER_VALIDATION`` but no
login is recorded, so ``mt5_terminal_lease`` sees no holder change and writes no
handover row (pinned by ``tests/test_mt5_validation_liveness.py``). Its lease acquire
is SHORT and BOUNDED (``_MT5_RELOGIN_LEASE_WAIT_DEFAULT_S``): a validation that holds
the terminal makes the probe a ``busy_skip``, never a queue ahead of a human. A
``busy_skip`` is a ``not_measured`` reading that EXTENDS an outage run, because a
terminal held through every tick is not proven alive.

CADENCE. The monitor loop is sequential (wait, then tick), so these two calls run
after the jobs heal's own ``wait_for`` and stretch one tick by at most
``PROBE_TICK_BOUND_S + READ_TICK_BOUND_S``. They do not enter
``_MT5_SESSION_POLL_INTERVAL_FLOOR_S``: that floor protects the jobs heal's own
abandon arm, which a call running AFTER the heal cannot pre-empt.

NOTHING HERE RAISES. A raise reaches ``main.lifespan``'s ``_crash_handler``, which
stops the dispatch, watchdog and enqueue loops behind a green ``/health``. Each public
coroutine is exactly one ``try`` with the IN-06 handler shape, pinned by the shared
predicate. NOTHING HERE LOGS a host, port, login or server: kinds and codes only.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Final

from services import ops_alert, ops_alert_open
from services.ops_alert import await_delivery
from services.db import db_execute, get_supabase, rows
from services.mt5_client import (
    MT5_REQUEST_TIMEOUT_S,
    Mt5Client,
    Mt5ClientError,
    mt5_terminal_key,
)
from services.mt5_concurrency import Mt5TerminalBusyError, mt5_terminal_lease
from services.mt5_handover import (
    HOLDER_VALIDATION,
    SITE_VALIDATION_LIVENESS,
    _normalize_site,
)
from services.mt5_outage_alert import ROLE_VALIDATION, note_outage_reading
from services.mt5_relogin import (
    _MT5_NO_AUTHORIZED_ACCOUNT_CODE,
    _MT5_RELOGIN_CONNECT_SLACK_S,
    _MT5_RELOGIN_LEASE_WAIT_DEFAULT_S,
    read_env_validation_gateway_endpoint,
)
from services.mt5_session_episodes import (
    KIND_ALREADY_AUTHORIZED,
    KIND_BUDGET_ABANDONED,
    KIND_BUSY_SKIP,
    KIND_GATEWAY_NOT_CONFIGURED,
    KIND_IPC_FAULT,
    KIND_NO_AUTHORIZED_ACCOUNT,
    classify_reading,
)
from services.mt5_terminal_scrub import (
    _RELAUNCH_STATUSES,
    _SCRUB_KINDS,
    _SCRUB_RECORD_TIMEOUT_S,
    MT5_TERMINAL_SCRUB_CRON_NAME,
    SCRUB_KIND_SCRUBBED,
)

logger = logging.getLogger("quantalyze.analytics.mt5_validation_liveness")

#: The reading kind for a probe that raised something other than the typed
#: ``Mt5ClientError`` (the rpyc connect failing, a fenced zombie). The gateway did
#: not answer, so it is ``not_measured`` and counts toward the run. Not a decided
#: kind: it pages at the threshold.
KIND_PROBE_FAILED: Final[str] = "probe_failed"

#: The blocking probe's own bound: one rpyc request timeout (the bare
#: ``initialize()`` carries a shorter millisecond ceiling inside it) plus the connect
#: slack the jobs heal uses, because ``rpyc.classic.connect`` has no timeout of its own
#: and the client is built inside this bounded thread.
_PROBE_THREAD_BOUND_S: Final[float] = (
    MT5_REQUEST_TIMEOUT_S + _MT5_RELOGIN_CONNECT_SLACK_S
)

#: The monitor tick's bound on the whole probe call: the bounded lease acquire, the
#: thread bound, and the tracker's own inline work. ``page`` returns at once (a Sentry
#: capture and a scheduled POST) and a recovered notice's wait for its outcome runs in
#: a held task, so what the tracker awaits is ONE durable open-page read (a healthy
#: reading) or ONE write (an outage reading), each bounded by
#: ``ops_alert_open._OPEN_PAGE_TIMEOUT_S``.
PROBE_TICK_BOUND_S: Final[float] = (
    _MT5_RELOGIN_LEASE_WAIT_DEFAULT_S
    + _PROBE_THREAD_BOUND_S
    + ops_alert_open._OPEN_PAGE_TIMEOUT_S
)


def _probe_blocking(host: str, port: int) -> tuple[str, int | None]:
    """The blocking probe, run under ``to_thread`` inside the lease.

    Returns ``(kind, code)`` -- the same three-way mapping the jobs heal's first
    probe makes (``mt5_relogin._heal_blocking``): a clean probe is
    ``already_authorized``; code ``-6`` is ``no_authorized_account`` (the bridge
    answered and NO account is authorized); any other code is an ``ipc_fault``.

    ⛔ CREDENTIAL-FREE. It calls ``assert_session_authorized`` and nothing else:
    never ``initialize_with_credentials``, never ``login``, never a recycle or a
    scrub verb. The client is built HERE, inside the thread, because its rpyc connect
    has no timeout of its own and only the caller's ``wait_for`` bounds it. ``close``
    touches only our own socket and is exempt from the session fence.
    """
    client = Mt5Client(host, port)
    try:
        try:
            client.assert_session_authorized()
        except Mt5ClientError as err:
            if err.code == _MT5_NO_AUTHORIZED_ACCOUNT_CODE:
                return KIND_NO_AUTHORIZED_ACCOUNT, err.code
            return KIND_IPC_FAULT, err.code
        return KIND_ALREADY_AUTHORIZED, None
    finally:
        client.close()


async def probe_validation_terminal(*, poll_interval_s: float) -> None:
    """Measure the validation terminal once and feed the outage tracker. NEVER raises.

    ORDER: the validation endpoint (absent -> a COUNTED ``gateway_not_configured``
    reading, never a silent skip), the short bounded lease on its key, the
    credential-free probe off the loop, then ``classify_reading`` and the tracker.
    Every outcome is a reading: busy -> ``busy_skip``, the thread bound ->
    ``budget_abandoned`` (the thread is NOT cancelled; the lease release bumps the
    generation and fences it), any other raise -> ``probe_failed``. Only a measured
    ``authorized`` reading can end an outage run.
    """
    try:
        endpoint = read_env_validation_gateway_endpoint()
        if endpoint is None:
            kind: str = KIND_GATEWAY_NOT_CONFIGURED
            code: int | None = None
        else:
            host, port = endpoint
            try:
                async with mt5_terminal_lease(
                    mt5_terminal_key(host, port),
                    wait_s=_MT5_RELOGIN_LEASE_WAIT_DEFAULT_S,
                    holder=HOLDER_VALIDATION,
                    site=SITE_VALIDATION_LIVENESS,
                ):
                    kind, code = await asyncio.wait_for(
                        asyncio.to_thread(_probe_blocking, host, port),
                        timeout=_PROBE_THREAD_BOUND_S,
                    )
            except Mt5TerminalBusyError:
                kind, code = KIND_BUSY_SKIP, None
            except asyncio.TimeoutError:
                kind, code = KIND_BUDGET_ABANDONED, None
            except Exception as exc:  # noqa: BLE001 - a failed probe is a reading
                logger.warning(
                    "mt5 validation liveness: the probe raised and is counted as "
                    "not measured (exc_class=%s)",
                    type(exc).__name__,
                )
                kind, code = KIND_PROBE_FAILED, None
        reading = classify_reading(kind, code)
        logger.info(
            "mt5 validation liveness: state=%s kind=%s code=%s",
            reading.state,
            reading.kind,
            reading.code,
        )
        await note_outage_reading(
            ROLE_VALIDATION,
            reading.state,
            reading.kind,
            reading.code,
            poll_interval_s=poll_interval_s,
        )
    except Exception as exc:  # noqa: BLE001 - the control; see the module docstring
        try:
            logger.warning(
                "mt5 validation liveness: the probe did not complete - the "
                "monitor tick continues (exc_class=%s)",
                type(exc).__name__,
            )
        except BaseException:  # noqa: BLE001 - IN-06 shape, no await inside
            logger.warning(
                "mt5 validation liveness: the probe did not complete, and the "
                "failure could not be described"
            )


# --------------------------------------------------------------------------- #
# (b) The ROW reader for ``mt5_terminal_scrub`` (D-09 (b))
# --------------------------------------------------------------------------- #

#: The ``ops_alert`` source for a scrub row that is not ``scrubbed``.
_SCRUB_SOURCE: Final[str] = "mt5_terminal_scrub"

#: The cause for a ``metadata.kind`` outside the scrub's closed set. Never dropped:
#: a row the reader cannot read is still a row that did not say "scrubbed".
_CAUSE_UNRECOGNISED: Final[str] = "unrecognised"

_RECOVERED_PREFIX: Final[str] = "recovered_from_"

#: The bound on the one ``cron_runs`` read. A read is the same order of work as the
#: scrub's one-row INSERT (``_SCRUB_RECORD_TIMEOUT_S``, 5 s), so it is derived from
#: it, not hand-picked: a retuned record timeout carries through.
_READ_TIMEOUT_S: Final[float] = _SCRUB_RECORD_TIMEOUT_S

#: The monitor tick's bound on the whole reader call. The worst case is a recovery:
#: the newest-row read, the open-page read of the restart check, the wait for the
#: recovered notice's outcome (the founder email's total deadline plus slack) and the
#: close. An outage is the shorter path (the read and one record write). The reader
#: awaits its own recovery, unlike the tracker, because it records no reading that a
#: slow notice could cost.
READ_TICK_BOUND_S: Final[float] = (
    _READ_TIMEOUT_S
    + ops_alert_open._OPEN_PAGE_TIMEOUT_S
    + ops_alert._DELIVERY_WAIT_S
    + ops_alert_open._OPEN_PAGE_TIMEOUT_S
)


@dataclass
class _ScrubReaderState:
    """In-process memory of what this reader already paged.

    A redeploy forgets it, so the newest non-scrubbed row re-pages ONCE after a
    deploy. That is accepted: it costs one extra page for a state that is still
    true (the terminal was not scrubbed). The page's recovery is NOT accepted as
    lost (review WR-01): an open page is also recorded in ``services.ops_alert_
    open``, and the first ``scrubbed`` row of a process consults that record once,
    so a page the previous process left open still gets its recovered notice.
    """

    last_paged_identity: str | None = None
    outstanding_cause: str | None = None
    outstanding_since: datetime | None = None
    #: The durable open-page record (``services.ops_alert_open``) has landed for the
    #: outstanding page (review WR-01). Retried on the tick until it does.
    recorded: bool = False
    #: The durable record was consulted (or closed) in this process; a failed read
    #: does not set it, so "could not look" is retried.
    restart_checked: bool = False


_SCRUB_STATE = _ScrubReaderState()


def _reset_validation_liveness_state_for_tests() -> None:
    """Test-only: forget the reader's paged row and outstanding page."""
    global _SCRUB_STATE
    _SCRUB_STATE = _ScrubReaderState()


def _parse_completed_at(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _count(value: object) -> str:
    """A metadata count as it may reach a page: an int, else ``unknown``."""
    return str(value) if isinstance(value, int) and not isinstance(value, bool) else "unknown"


def _scrub_row_detail(kind: str, metadata: dict[str, Any]) -> str:
    """The page's detail, built from the row's CLOSED key set only.

    The row carries no account, login, server, host or port; every string below is
    still checked against its closed set, and the whole text goes through
    ``scrub_alert_detail`` regardless.
    """
    site = metadata.get("site")
    relaunch = metadata.get("relaunch_status")
    detail = (
        f"kind={kind} "
        f"site={_normalize_site(site)} "
        f"relaunch_status={relaunch if relaunch in _RELAUNCH_STATUSES else 'unrecognised'} "
        f"refused={_count(metadata.get('refused'))} "
        f"accounts_deleted={_count(metadata.get('accounts_deleted'))} "
        f"accounts_errors={_count(metadata.get('accounts_errors'))} "
        f"trades_deleted={_count(metadata.get('trades_deleted'))} "
        f"trades_errors={_count(metadata.get('trades_errors'))} "
        f"profile_accounts_found={_count(metadata.get('profile_accounts_found'))} "
        f"profile_errors={_count(metadata.get('profile_errors'))}"
    )
    return ops_alert.scrub_alert_detail(detail)


async def _read_newest_scrub_row() -> dict[str, Any] | None:
    supabase = get_supabase()

    def _select() -> Any:
        return (
            supabase.table("cron_runs")
            .select("id,completed_at,metadata")
            .eq("cron_name", MT5_TERMINAL_SCRUB_CRON_NAME)
            .order("completed_at", desc=True)
            .limit(1)
            .execute()
        )

    found = rows(await db_execute(_select))
    return found[0] if found else None


def _advance_scrub_state(row: dict[str, Any] | None) -> dict[str, Any] | None:
    """Apply the newest scrub row to the reader's state; return the page to send.

    Synchronous and awaitless on purpose. ONE page per row (by id), recovered on
    the first ``scrubbed`` row after a page, nothing for a ``scrubbed`` row with no
    page outstanding and nothing when no row exists at all (no validation has run
    since 164.6.6.1 shipped is not an outage).
    """
    if row is None:
        return None
    raw_meta = row.get("metadata")
    metadata: dict[str, Any] = raw_meta if isinstance(raw_meta, dict) else {}
    raw_kind = metadata.get("kind")
    state = _SCRUB_STATE

    if raw_kind == SCRUB_KIND_SCRUBBED:
        if state.outstanding_cause is None:
            return None
        request: dict[str, Any] = {
            "source": _SCRUB_SOURCE,
            "cause": _RECOVERED_PREFIX + state.outstanding_cause,
            "event": "recovered",
            "since": state.outstanding_since,
            "detail": _scrub_row_detail(SCRUB_KIND_SCRUBBED, metadata),
        }
        state.outstanding_cause = None
        state.outstanding_since = None
        state.recorded = False
        return request

    kind = raw_kind if isinstance(raw_kind, str) and raw_kind in _SCRUB_KINDS else None
    cause = kind or _CAUSE_UNRECOGNISED
    row_id = row.get("id")
    identity = str(row_id) if row_id is not None else f"completed_at:{row.get('completed_at')}"
    if identity == state.last_paged_identity:
        return None
    since = _parse_completed_at(row.get("completed_at"))
    state.last_paged_identity = identity
    state.outstanding_cause = cause
    state.outstanding_since = since
    return {
        "source": _SCRUB_SOURCE,
        "cause": cause,
        "event": "outage",
        "since": since,
        "detail": _scrub_row_detail(cause, metadata),
    }


async def _scrub_restart_recovery(
    row: dict[str, Any] | None,
) -> dict[str, Any] | None:
    """The recovered notice owed for a page the PREVIOUS process left open.

    Only a ``scrubbed`` newest row is a recovery, and only when this process holds no
    outstanding page of its own (``_advance_scrub_state`` answered None). Consulted
    once per process; a failed read is retried on the next tick (review WR-01).
    """
    state = _SCRUB_STATE
    if row is None or state.restart_checked:
        return None
    raw_meta = row.get("metadata")
    metadata: dict[str, Any] = raw_meta if isinstance(raw_meta, dict) else {}
    if metadata.get("kind") != SCRUB_KIND_SCRUBBED:
        return None
    try:
        found = await ops_alert_open.read_open_page(_SCRUB_SOURCE)
    except Exception as exc:  # noqa: BLE001 - retried on the next tick
        logger.warning(
            "mt5 validation liveness: the open-page record could not be read; "
            "the restart recovery is retried on the next tick (exc_class=%s)",
            type(exc).__name__,
        )
        return None
    state.restart_checked = True
    if found is None:
        return None
    return {
        "source": _SCRUB_SOURCE,
        "cause": (_RECOVERED_PREFIX + found.cause)[:64],
        "event": "recovered",
        "since": found.since,
        "detail": _scrub_row_detail(SCRUB_KIND_SCRUBBED, metadata),
    }


async def _close_after_recovered(delivery: object) -> None:
    """Close the open-page record IF a channel took the recovered notice.

    The notice is one-shot (this process forgot the page the moment it recovered),
    so the record is the only thing that can make it be sent again (review
    WR-R2-01). It is closed only on a delivered notice. In every other case,
    including a cancelled wait (the monitor tick is bounded), the restart check is
    left to run again: the next tick finds the open record under a ``scrubbed`` row
    and sends the notice once more.
    """
    closed = False
    try:
        if not await await_delivery(delivery):
            logger.error(
                "mt5 validation liveness: the recovered notice reached no channel; "
                "the open-page record stays open and the next tick sends it again"
            )
            return
        closed = await ops_alert_open.close_open_page(_SCRUB_SOURCE)
    finally:
        if not closed:
            # Kept open on purpose, so mark it stale: a NEW incident that records
            # first replaces it instead of inheriting its cause and `since`. This
            # includes a cancelled wait (the monitor tick is bounded; review
            # WR-R3-03).
            ops_alert_open.mark_open_page_stale(_SCRUB_SOURCE)
        _SCRUB_STATE.restart_checked = closed


async def read_unscrubbed_validation_terminal() -> None:
    """Page once per ``mt5_terminal_scrub`` row that is not ``scrubbed``. NEVER raises.

    D-09 (b). The 164.6.6.1 scrub writes one point-event row per attempt and
    captures at write time; this reads the NEWEST row back on the monitor's cadence.
    A ``refused`` / ``failed`` / ``abandoned`` / ``relaunch_unverified`` /
    ``skipped_*`` row means a client's saved login or deal history may still be on
    the validation terminal. The first newer ``scrubbed`` row after a page sends one
    recovered notice. A read that raises or times out is logged at WARNING and the
    tick continues: an unreadable sink is not evidence either way.

    ⚠️ State is in-process (see ``_ScrubReaderState``): a redeploy forgets the paged
    row id, so the newest non-scrubbed row re-pages once after a deploy. The OPEN
    page is also recorded durably (``services.ops_alert_open``, review WR-01), so a
    page the previous process left open still gets its recovered notice on the first
    ``scrubbed`` row of the new one.
    """
    try:
        row = await asyncio.wait_for(_read_newest_scrub_row(), timeout=_READ_TIMEOUT_S)
        request = _advance_scrub_state(row)
        if request is None:
            request = await _scrub_restart_recovery(row)
        if request is not None:
            delivery = await ops_alert.page(
                request["source"],
                request["cause"],
                event=request["event"],
                since=request["since"],
                detail=request["detail"],
            )
            if request["event"] == "recovered":
                await _close_after_recovered(delivery)
        state = _SCRUB_STATE
        if (
            state.outstanding_cause is not None
            and not state.recorded
            and await ops_alert_open.record_open_page(
                _SCRUB_SOURCE, state.outstanding_cause, state.outstanding_since
            )
        ):
            state.recorded = True
    except Exception as exc:  # noqa: BLE001 - the control; see the module docstring
        try:
            logger.warning(
                "mt5 validation liveness: the scrub-row reader did not complete - "
                "the monitor tick continues (exc_class=%s)",
                type(exc).__name__,
            )
        except BaseException:  # noqa: BLE001 - IN-06 shape, no await inside
            logger.warning(
                "mt5 validation liveness: the scrub-row reader did not complete, "
                "and the failure could not be described"
            )
