"""The page for a strategy whose reconcile readmit hit its ceiling (Phase 227 JOBLEDGER,
plan 09, requirement HEAL-03).

WHY THIS EXISTS. The reconcile sweep readmits a strategy that lost its worker and stops at
three orphan markers. When that ceiling holds, the strategy simply drops out of the sweep and
nothing says so. Plan 04 gave that a durable row (``public.reconcile_readmit_exhaustions``)
and a SQL detector (``record_reconcile_readmit_exhaustions``). A row nobody reads is the same
silence, so this module pages a human from it.

FOUNDER RULING 2026-11-23 (CONTEXT, HEAL-03), quoted: "Both: a durable row that outlives the
job rows' retention, plus a page through the existing ops_alert channel ... the SQL writes the
durable row and a Python reader pages from it." The SQL decides and writes; this reader only
pages.

DECISIONS
---------
DEC-09-A  The cause carries the strategy id: ``readmit_ceiling:<strategy uuid>``. ``ops_alert``
    windows a page per (source, cause, event) for an hour, so one shared cause would collapse
    two strategies exhausting within the hour into one page and lose the second. A lowercase
    uuid after the prefix is 52 characters, inside ``OPS_ALERT_CAUSE_RE``.
DEC-09-B  The stamp is delivery-gated, like ``mt5_outage_alert._finish_recovered``:
    ``paged_at`` is set only after ``await_delivery`` reports the page reached a channel, by
    ``UPDATE ... SET paged_at = <now> WHERE id = <row> AND paged_at IS NULL``. An undelivered
    page leaves the row unpaged, so the next pass pages again. Two processes can both page
    one row (the stamp guard stops only a double stamp); a duplicate page is accepted, because
    at least once beats at most once for a stranded strategy.
DEC-09-C  Placement: one guarded call in the worker's ``watchdog_loop``, throttled by this
    module's own interval, with no new task, loop or cron job.

NEVER RAISES. The ``ops_alert`` contract is that a page never raises, and this reader runs
inside the worker's watchdog loop: a fault here must not end the loop. The whole body is one
``try``. A missing detector or table (the rollout window between the worker deploy and the
migration apply) is detected by structured code, logged once per process and reads as zero.
Every other failure logs the exception CLASS only (a database error can quote a row) and
returns zero. ``asyncio.CancelledError`` is not caught: shutdown must get through.

The detail of a page is built from our own tokens only (a count, a generation key and a
timestamp), never from an error message or a user record.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any, Final

from services import ops_alert
from services.db import db_execute, get_supabase

logger = logging.getLogger("quantalyze.analytics.readmit_ceiling_alert")

#: At most one pass per this many seconds per process.
_READMIT_PAGE_INTERVAL_S: Final[float] = 300.0
#: At most this many rows are paged per pass.
_BATCH: Final[int] = 25
#: A member of ``ops_alert.OPS_ALERT_SOURCES`` (the TypeScript set carries it too).
_SOURCE: Final = "reconcile_readmit_ceiling"

_TABLE: Final = "reconcile_readmit_exhaustions"
_DETECTOR: Final = "record_reconcile_readmit_exhaustions"

#: 42883 / PGRST202: the detector function is not deployed. 42P01 / PGRST205: the table is not.
_MISSING_OBJECT_CODES: Final = frozenset({"42883", "PGRST202", "42P01", "PGRST205"})

#: The clock (a seam: tests drive it) and the instant of the last pass. Rebound, never
#: mutated, so a test can reset it with ``monkeypatch.setattr``.
_clock = time.monotonic
_last_run: float | None = None
_objects_missing_logged: bool = False


def _is_missing_object(exc: BaseException) -> bool:
    """True iff `exc` carries a structured code saying the detector or the table is absent.

    Structured codes only (on ``.code`` or ``.details["code"]``), never message text: a
    message that merely mentions a table must not downgrade a real fault to a rollout note.
    Local to this module because ``main_worker`` imports it, so the reverse import would be
    circular.
    """
    code = getattr(exc, "code", None)
    if isinstance(code, str) and code.strip().upper() in _MISSING_OBJECT_CODES:
        return True
    details = getattr(exc, "details", None)
    if isinstance(details, dict):
        inner = details.get("code")
        return isinstance(inner, str) and inner.strip().upper() in _MISSING_OBJECT_CODES
    return False


def _cause_for(strategy_id: str) -> str:
    return f"readmit_ceiling:{strategy_id.lower()}"


def _detail_for(row: dict[str, Any]) -> str:
    return (
        f"marker_count={row['marker_count']} "
        f"generation_key={row['generation_key']} "
        f"detected_at={row['detected_at']}"
    )


async def page_readmit_exhaustions() -> int:
    """Page a human for every unpaged exhaustion row; return how many pages were delivered.

    Runs the SQL detector first (it writes the durable rows), reads at most ``_BATCH`` unpaged
    rows oldest first, pages each, and stamps a row only when its page reached a channel.
    Returns 0 inside ``_READMIT_PAGE_INTERVAL_S`` of the previous pass. Never raises.
    """
    global _last_run, _objects_missing_logged
    now = _clock()
    last = _last_run
    if last is not None and now - last < _READMIT_PAGE_INTERVAL_S:
        return 0
    # Stamped BEFORE the work, so a failing database is retried one interval later and not
    # on every watchdog tick.
    _last_run = now

    try:
        supabase = get_supabase()

        def _detect() -> Any:
            return supabase.rpc(_DETECTOR, {}).execute()

        try:
            await db_execute(_detect)
        except Exception as detect_exc:  # noqa: BLE001
            if _is_missing_object(detect_exc):
                raise
            # A failing detector must not hide rows already on disk: log the class
            # only (a database error can quote a row) and still page them.
            logger.error(
                "readmit ceiling alert: the detector failed (exc_class=%s); rows "
                "already recorded are still paged",
                type(detect_exc).__name__,
                extra={"event_type": "readmit_ceiling_detector_failed"},
            )

        def _read_unpaged() -> Any:
            return (
                supabase.table(_TABLE)
                .select("id, strategy_id, generation_key, marker_count, detected_at")
                .is_("paged_at", "null")
                .order("detected_at")
                .limit(_BATCH)
                .execute()
            )

        result = await db_execute(_read_unpaged)

        delivered_count = 0
        for row in result.data or []:
            delivery = await ops_alert.page(
                _SOURCE,
                _cause_for(str(row["strategy_id"])),
                event="outage",
                detail=_detail_for(row),
            )
            if not await ops_alert.await_delivery(delivery):
                # A channel that did not take this page will not take the next
                # one either, and each wait is up to 15 s inside watchdog_loop.
                # The rows stay unpaged and the next pass pages them again.
                break

            row_id = row["id"]
            stamp = datetime.now(timezone.utc).isoformat()

            def _stamp(row_id: Any = row_id, stamp: str = stamp) -> Any:
                return (
                    supabase.table(_TABLE)
                    .update({"paged_at": stamp})
                    .eq("id", row_id)
                    .is_("paged_at", "null")
                    .execute()
                )

            await db_execute(_stamp)
            delivered_count += 1
        return delivered_count
    except Exception as exc:  # noqa: BLE001 - this reader must never end the watchdog loop
        try:
            if _is_missing_object(exc):
                if not _objects_missing_logged:
                    _objects_missing_logged = True
                    logger.warning(
                        "readmit ceiling alert: the detector function or the exhaustion "
                        "table is not deployed yet (exc_class=%s); paging nothing until "
                        "migration 20261124120300 applies. Logged once per process.",
                        type(exc).__name__,
                        extra={"event_type": "readmit_ceiling_objects_missing"},
                    )
            else:
                logger.error(
                    "readmit ceiling alert: a pass failed (exc_class=%s); an unpaged row "
                    "stays unpaged and the next pass pages it again",
                    type(exc).__name__,
                    extra={"event_type": "readmit_ceiling_page_failed"},
                )
        except BaseException:  # noqa: BLE001 - IN-06 shape: logging must not re-raise
            pass
        return 0
