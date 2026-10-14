"""The durable "a page is open" record (Phase 164.6.8 OUTAGEALERT, review WR-01).

WHY THIS EXISTS. The MT5 outage tracker, the relaunch-debt page and the scrub-row
reader each remember "I paged, so a RECOVERED notice is owed" in process memory. A
redeploy is the most likely way an MT5 incident ends, and it forgets that memory:
the new process sees its first healthy reading with no open page, sends nothing, and
the founder's inbox ends on OUTAGE. This module is the memory that survives.

THE SINK, AND WHY THIS ONE. ``public.cron_runs`` under a NEW ``cron_name``,
``ops_alert_open``, with NO MIGRATION -- the same reasoning, verified rather than
assumed, that ``mt5_session_episodes``, ``mt5_handover`` and ``mt5_terminal_scrub``
record for their own names:

  * the table is service-role writable by its existing ``cron_runs_service_role``
    policy (``FOR ALL`` with a matching ``WITH CHECK``);
  * ``cron_runs.cron_name`` carries no CHECK constraint, so a new name needs no DDL;
  * ``status='running'`` IS the open page, and the partial index
    ``idx_cron_runs_running (cron_name, started_at DESC) WHERE status='running'``
    already supports reading it back;
  * ``latest_cron_success(p_cron_name)`` takes a NAME and enumerates none, so a new
    name raises no false stale alert, and no migration, retention job or SQL gate
    reads ``running`` rows of this table without narrowing by ``cron_name``.

⚠️ AND, like those modules, it stretches the table's stated purpose ("heartbeat rows
written by cron jobs"). These rows are open-page markers written by the analytics
service. ⛔ Do NOT "fix" that by editing the table's ``COMMENT`` (that is a
migration), and ⛔ NEVER ADD ``FORCE ROW LEVEL SECURITY`` TO ``cron_runs``: it would
silently drop the rows this repo's ledger gates depend on. ⛔ Never introduce an
unfiltered count over ``public.cron_runs`` yourself.

THE ROW. One ``running`` row per OPEN source. ``metadata`` is a closed key set:
``schema_version``, ``source`` (a member of ``OPS_ALERT_SOURCES``), ``cause`` (the
alert-cause charset) and ``since`` (an ISO timestamp or null). Never an account
number, login, server, host, port or credential. Closing a page updates the row to
``status='ok'`` with ``completed_at`` set, so a closed page is the same shape as the
point-event rows its siblings write.

THE CONTRACT with the callers (``mt5_outage_alert``, ``mt5_validation_liveness``):

* ``record_open_page`` writes the marker once a page was SENT; it is idempotent per
  source (an existing open row is kept, so ``since`` stays the earliest) and reports
  whether a row now stands, so the caller can retry on its next qualifying reading.
* ``read_open_page`` is consulted ONCE per source per process, on the first healthy
  reading, and RAISES when the sink cannot be read: "nothing open" and "could not
  look" are different answers, and only the first may stop the caller looking again.
* ``close_open_page`` closes every open row of the source. The callers call it only
  once a channel HAS the RECOVERED notice (``ops_alert.await_delivery``: a Sentry
  event id or a 2xx from the founder email), because the notice is one-shot and the
  open row is the only thing that can make it be sent again (review WR-R2-01).

THE REAL GUARANTEE, and its limits. A recovered notice that reached no channel, and a
crash between the notice and the close, both leave the row open. The caller then
leaves the source unmarked, so the next measured healthy reading of the same process
(or the first one after a restart) finds the row and sends the notice again. That
is at-least-once DELIVERY ATTEMPTS while the sink is reachable and healthy readings
keep arriving. It is NOT "never lost": a notice is lost when no channel ever takes
it, when the sink is down for the whole incident (no row was written), and when the
sink cannot be read after a restart (the check is retried, not skipped, but nothing
re-sends while it stays unreadable). A repeat is the accepted direction.

⛔ ``record_open_page`` and ``close_open_page`` NEVER RAISE ``Exception``: they run
inside the never-raises tracker, which runs inside the never-raises heal and monitor
tick. Each public coroutine is exactly one ``try`` with the IN-06 handler shape.
``asyncio.CancelledError`` is not an ``Exception`` and passes through.
"""

from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Final

from postgrest.types import CountMethod

from services.db import db_execute, get_supabase, rows
from services.ops_alert import OPS_ALERT_CAUSE_RE, OPS_ALERT_SOURCES

__all__ = [
    "OPS_ALERT_OPEN_CRON_NAME",
    "OpenPage",
    "SCHEMA_VERSION",
    "close_open_page",
    "mark_open_page_stale",
    "read_open_page",
    "record_open_page",
]

logger = logging.getLogger("quantalyze.analytics.ops_alert_open")

#: ⭐ THE NEW NAME. Nothing else writes it and no alert enumerates it.
OPS_ALERT_OPEN_CRON_NAME: Final[str] = "ops_alert_open"

#: The metadata contract's version.
SCHEMA_VERSION: Final[int] = 1

#: The bound on ONE call (a read-then-write is two round trips): the same order of
#: work as the scrub's one-row INSERT, so it is a constant here and not a guess at
#: Supabase's latency. The callers sit inside bounded monitor ticks.
_OPEN_PAGE_TIMEOUT_S: Final[float] = 5.0

_CAUSE_RE = re.compile(OPS_ALERT_CAUSE_RE)
_UNRECOGNISED: Final[str] = "unrecognised"

#: Sources whose open row THIS process knows is stale: its recovery was attempted
#: here and the row is still `running` (the close failed, or the notice reached no
#: channel and the row was kept on purpose for a re-send). ``_record`` replaces such
#: a row instead of keeping it, so a NEW incident never inherits the old incident's
#: cause or ``since`` (review WR-R2-02). Process-local on purpose: a row left by a
#: PREVIOUS process is a redeploy in the middle of an outage, i.e. very likely the
#: same incident, and it keeps its earlier ``since``. Lock-free: every writer runs on
#: the event loop thread.
_STALE_SOURCES: set[str] = set()


def mark_open_page_stale(source: str) -> None:
    """Tell this module the open row of ``source`` belongs to a finished incident.

    Called by a caller that attempted the recovery here but left the row open on
    purpose (the notice reached no channel). A failed close marks it itself. A
    successful close, or the next ``record_open_page`` of the source, clears it.
    """
    _STALE_SOURCES.add(source)


@dataclass(frozen=True)
class OpenPage:
    """One open page as read back: the source, the cause it was paged under, and when
    the incident began (None when the writer did not know)."""

    source: str
    cause: str
    since: datetime | None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_since(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _normalise_cause(cause: object) -> str:
    return cause if isinstance(cause, str) and _CAUSE_RE.fullmatch(cause) else _UNRECOGNISED


async def _select_open_rows() -> list[dict[str, Any]]:
    supabase = get_supabase()

    def _select() -> Any:
        return (
            supabase.table("cron_runs")
            .select("id,started_at,metadata")
            .eq("cron_name", OPS_ALERT_OPEN_CRON_NAME)
            .eq("status", "running")
            .order("started_at", desc=False)
            .execute()
        )

    return rows(await db_execute(_select))


def _row_source(row: dict[str, Any]) -> object:
    metadata = row.get("metadata")
    return metadata.get("source") if isinstance(metadata, dict) else None


async def _read(source: str) -> OpenPage | None:
    for row in await _select_open_rows():
        if _row_source(row) != source:
            continue
        metadata = row.get("metadata")
        meta: dict[str, Any] = metadata if isinstance(metadata, dict) else {}
        return OpenPage(
            source=source,
            cause=_normalise_cause(meta.get("cause")),
            since=_parse_since(meta.get("since")),
        )
    return None


async def read_open_page(source: str) -> OpenPage | None:
    """The earliest open page of ``source``, or None when none is open.

    RAISES when the sink cannot be read (timeout included): the caller must be able
    to tell "nothing is open" from "could not look", and only the former may stop it
    looking again. The caller is a never-raises wrapper that catches this.
    """
    return await asyncio.wait_for(_read(source), timeout=_OPEN_PAGE_TIMEOUT_S)


async def _record(source: str, cause: str, since: datetime | None) -> bool:
    existing = [row for row in await _select_open_rows() if _row_source(row) == source]
    if existing:
        if source not in _STALE_SOURCES:
            return True
        # ⛔ NEVER TWO OPEN ROWS for one source (a read returns the earliest). If the
        # stale row cannot be closed the new incident is not recorded, and the caller
        # retries on its next qualifying reading.
        if not await _close_rows(existing):
            return False
        _STALE_SOURCES.discard(source)
    now = _now_iso()
    payload: dict[str, Any] = {
        "cron_name": OPS_ALERT_OPEN_CRON_NAME,
        # ⭐ `running` IS the open page; `completed_at` stays null until it closes.
        "started_at": now,
        "status": "running",
        "error": None,
        # ⛔ A closed key set. No account, login, server, host, port or credential.
        "metadata": {
            "schema_version": SCHEMA_VERSION,
            "source": source,
            "cause": _normalise_cause(cause),
            "since": since.isoformat() if since is not None else None,
        },
    }
    supabase = get_supabase()

    def _insert() -> Any:
        return supabase.table("cron_runs").insert(payload).execute()

    response = await db_execute(_insert)
    if not rows(response):
        logger.error(
            "ops alert open-page record: the INSERT returned no rows - a "
            "redeploy before recovery would lose the recovered notice"
        )
        return False
    return True


async def record_open_page(
    source: str, cause: str, since: datetime | None
) -> bool:
    """Record that a page for ``source`` is open. True when a row now stands.

    Idempotent: an open row for the source is kept as it is, so a redeploy in the
    middle of an outage keeps the earlier ``since``. The one exception is a row this
    process KNOWS is stale (``mark_open_page_stale``, or a close that failed here):
    it is closed and replaced, so a new incident never inherits an old one's cause
    or ``since`` (review WR-R2-02). NEVER RAISES ``Exception``; a False return means
    the next qualifying reading should retry.
    """
    try:
        if source not in OPS_ALERT_SOURCES:
            return False
        return await asyncio.wait_for(
            _record(source, cause, since), timeout=_OPEN_PAGE_TIMEOUT_S
        )
    except Exception as exc:  # noqa: BLE001 - see the module docstring; the control
        try:
            logger.warning(
                "ops alert open-page record: the open page could not be "
                "recorded (exc_class=%s)",
                type(exc).__name__,
            )
        except BaseException:  # noqa: BLE001 - IN-06 shape, no await inside
            logger.warning(
                "ops alert open-page record: the open page could not be "
                "recorded, and the failure could not be described"
            )
        return False


async def _close_rows(open_rows: list[dict[str, Any]]) -> bool:
    """Close each listed row. True only when EVERY update matched its row.

    The UPDATE's outcome is READ, never assumed (review WR-R2-02): ``count=exact``,
    as ``mt5_session_episodes._close_row`` does, with a fallback to the returned
    rows for a transport that does not set it. An UPDATE that matched nothing (the
    compare-and-set lost, or a policy hid the row) is a FAILURE, because the caller
    would otherwise mark the source done over a row that is still ``running``.
    """
    supabase = get_supabase()
    now = _now_iso()
    all_closed = True
    for row in open_rows:
        row_id = row.get("id")

        def _update(row_id: object = row_id) -> Any:
            return (
                supabase.table("cron_runs")
                .update({"status": "ok", "completed_at": now}, count=CountMethod.exact)
                .eq("id", row_id)
                # ⛔ THE COMPARE-AND-SET: only a still-open row is closed.
                .eq("status", "running")
                .execute()
            )

        response = await db_execute(_update)
        matched = getattr(response, "count", None)
        if not isinstance(matched, int) or isinstance(matched, bool):
            matched = len(rows(response))
        if not matched:
            all_closed = False
    return all_closed


async def _close(source: str) -> bool:
    return await _close_rows(
        [row for row in await _select_open_rows() if _row_source(row) == source]
    )


async def close_open_page(source: str) -> bool:
    """Close every open row of ``source``. True only when no open row is left.

    NEVER RAISES ``Exception``. A False return (the sink failed, or an UPDATE
    matched no row) leaves a row open and marks the source stale in this process,
    so the next incident does not inherit it. The CALLER must leave the source
    unmarked so its next healthy reading closes the row again; a restart would send
    the recovered notice once more, which is the safe direction.
    """
    try:
        closed = await asyncio.wait_for(_close(source), timeout=_OPEN_PAGE_TIMEOUT_S)
        if closed:
            _STALE_SOURCES.discard(source)
            return True
        _STALE_SOURCES.add(source)
        logger.warning(
            "ops alert open-page record: the open page could not be closed (an "
            "UPDATE matched no open row)"
        )
        return False
    except Exception as exc:  # noqa: BLE001 - see the module docstring; the control
        _STALE_SOURCES.add(source)
        try:
            logger.warning(
                "ops alert open-page record: the open page could not be closed "
                "(exc_class=%s)",
                type(exc).__name__,
            )
        except BaseException:  # noqa: BLE001 - IN-06 shape, no await inside
            logger.warning(
                "ops alert open-page record: the open page could not be closed, "
                "and the failure could not be described"
            )
        return False
