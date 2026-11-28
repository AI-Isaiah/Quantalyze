"""Phase 259 OKXARCHIVEFILLS: the trigger that chains the archive-fills read from ``sync_trades``.

WHY THIS EXISTS. OKX's ``fills-history`` endpoint reaches back about three months, so a strategy
whose track record starts earlier has no stored fills for its oldest quarters. Those fills are
recoverable only from OKX's bills archive (the ``okx_archive_rebuild`` job, mode ``fills_apply``).
Left to an operator that read is never run for a FUTURE strategy, so ``sync_trades`` chains it
itself, the way it already chains ``derive_broker_dailies`` (CONTEXT, "Trigger and scope").

THE PREDICATE, in prose. ``chain_okx_archive_fills`` enqueues one ``fills_apply`` job on the
syncing key when ALL of these hold, and returns one named verdict otherwise:

* the key is an OKX key that carries a ``venue_account_id`` (the job refuses a key with no account
  at its own account check, so there is nothing to chain);
* the strategy's earliest ``csv_daily_returns`` date (the ANCHOR) is below the write bound, which
  is one day above ``_okx_fills_begin_floor_ms(now)``: an anchor inside ``fills-history``'s reach
  has nothing the archive could add;
* the strategy's earliest stored OKX fill is absent, or more than two days after the anchor
  (``REACH_SLACK_MS``): a stored fill within two days of the anchor means the reach already
  covers the track record; an empty but clean read counts as answered by the cooldown below;
* no ``fills_apply`` job was created in the last 14 days on ANY OKX key of the same
  ``venue_account_id`` that is in flight, done, or failed with a PERMANENT named stop (``last_error``
  starts ``okx_archive_rebuild: `` and its class is not ``invalid_input`` or a transient class).
  The read itself is scoped per OKX account and one job serves every strategy of the account, so
  the cooldown is account-scoped, not key-scoped. A ``fills_calibrate`` job
  never counts (the mode filter is in the QUERY), so a dry run cannot suppress the backfill. A
  failure with no named stop, a ``last_error`` from anywhere else, ``invalid_input`` (what an old
  worker, mid-deploy, ends an unknown mode with), or a transient class that ran its retries out
  (``claim_budget_exceeded``, ``link_expired``, ``live_fetch_failed``, ``fills_write_failed``,
  ``fills_count_not_persisted``) does not count, so the next sync re-chains and the idempotent
  upsert completes a partial write.

THE SHAPE. This is a best-effort cross-target re-entry on the api_key, NOT a parented follow-on:
``JOB_CHAIN_FOLLOW_ON``, ``TIMEOUT_PER_KIND`` and the reaper ceiling are unchanged. The enqueue
carries ``{"mode": "fills_apply"}`` and nothing else: no strategy list and no quarter list,
because the per-api_key in-flight dedupe drops new metadata and the job derives both in-claim.
The caller (the seam at the tail of ``run_sync_trades_job``) never lets this change the sync's
outcome: it runs after the follow-on enqueue, on the DONE path only, in its own try/except.

Every malformed answer is fail-closed: no enqueue. An enqueue inside the 00:00 to 01:45 UTC
daily-chain window is deferred to 01:50 UTC the same day (``p_run_at``), so the archive job never
shares the window the OKXHISTORY runbook reserves for the daily chain.
"""

from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import Mapping
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Final

from services import exchange as _exchange
from services.db import db_execute, db_read_with_retry, rows
from services.exchange import _okx_fills_begin_floor_ms

logger = logging.getLogger(__name__)

CHAIN_KIND: Final = "okx_archive_rebuild"
FILLS_APPLY_MODE: Final = "fills_apply"
COOLDOWN_DAYS: Final = 14
#: The "more than 2 days" of the Addendum: an earliest stored fill this close to the anchor means
#: the endpoint's reach already covers the track record.
REACH_SLACK_MS: Final = 2 * 86_400_000
#: One day above the floor: the job's own write bound. This is the ONE definition; the job module
#: imports it from here and a test binds the two.
WRITE_BOUND_MARGIN_MS: Final = 86_400_000
CHAIN_TIMEOUT_S: float = 30.0
DAILY_CHAIN_WINDOW_END_UTC: Final = time(1, 45)
DEFERRED_RUN_AT_UTC: Final = time(1, 50)

_IN_FLIGHT_STATUSES: Final = ("pending", "running", "done_pending_children", "failed_retry")
#: ``last_error`` of a job the rebuild named: ``okx_archive_rebuild: <stop_class> ...``.
_NAMED_ERROR_PREFIX: Final = "okx_archive_rebuild: "
#: Stop classes that do NOT answer the read: ``invalid_input`` (what an old worker, mid-deploy, ends
#: an unknown mode with) and the transient classes, which a retry resumes and which only reach
#: ``failed_final`` when the retries ran out. This module cannot import the job modules (the fills
#: job imports this one), so ``test_cooldown_unanswered_classes_bind_the_job_sets`` binds the
#: transient part to ``TRANSIENT_STOP_CLASSES | FILLS_TRANSIENT_STOP_CLASSES``.
_UNANSWERED_STOP_CLASSES: Final = frozenset(
    {
        "invalid_input",
        "link_expired",
        "live_fetch_failed",
        "claim_budget_exceeded",
        "fills_write_failed",
        "fills_count_not_persisted",
    }
)
_DAY_MS: Final = 86_400_000
_EPOCH_ORDINAL: Final = date(1970, 1, 1).toordinal()
_DATE_RE: Final = re.compile(r"^\d{4}-\d{2}-\d{2}$")

CHAIN_VERDICTS: Final = frozenset(
    {
        "not_okx",
        "no_account",
        "no_anchor",
        "unreadable",
        "anchor_in_reach",
        "fills_reach_anchor",
        "cooldown",
        "enqueued",
    }
)


def _anchor_ms(raw: Any) -> int | None:
    """The UTC start of a ``YYYY-MM-DD`` day in epoch ms (integer arithmetic), else None."""
    if not isinstance(raw, str) or _DATE_RE.match(raw) is None:
        return None
    try:
        day = date.fromisoformat(raw)
    except ValueError:
        return None
    return (day.toordinal() - _EPOCH_ORDINAL) * _DAY_MS


def _instant_ms(raw: Any) -> int | None:
    """An ISO instant in epoch ms (a naive value is read as UTC), else None."""
    if not isinstance(raw, str):
        return None
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return int(parsed.timestamp() * 1000)


def _counts_toward_cooldown(row: Mapping[str, Any]) -> bool:
    status = row.get("status")
    if status in _IN_FLIGHT_STATUSES or status == "done":
        return True
    if status == "failed_final":
        last_error = row.get("last_error")
        if not isinstance(last_error, str) or not last_error.startswith(_NAMED_ERROR_PREFIX):
            return False
        stop_class = last_error[len(_NAMED_ERROR_PREFIX):].split(None, 1)
        return bool(stop_class) and stop_class[0] not in _UNANSWERED_STOP_CLASSES
    return False


async def _chain(supabase: Any, key_row: Mapping[str, Any], strategy_id: str) -> str:
    if key_row.get("exchange") != "okx":
        return "not_okx"
    key_id = key_row.get("id")
    account = key_row.get("venue_account_id")
    if (
        not isinstance(key_id, str)
        or not key_id.strip()
        or not isinstance(account, str)
        or not account.strip()
    ):
        return "no_account"

    def _read_anchor() -> list[dict[str, Any]]:
        return rows(
            supabase.table("csv_daily_returns")
            .select("date")
            .eq("strategy_id", strategy_id)
            .order("date")
            .limit(1)
            .execute()
        )

    anchor_rows = await db_read_with_retry(_read_anchor)
    if not anchor_rows:
        return "no_anchor"
    anchor_ms = _anchor_ms(anchor_rows[0].get("date"))
    if anchor_ms is None:
        return "unreadable"

    now_ms = _exchange._now_ms()
    write_bound_ms = _okx_fills_begin_floor_ms(now_ms) + WRITE_BOUND_MARGIN_MS
    if anchor_ms >= write_bound_ms:
        return "anchor_in_reach"

    def _read_earliest_fill() -> list[dict[str, Any]]:
        return rows(
            supabase.table("trades")
            .select("timestamp")
            .eq("strategy_id", strategy_id)
            .eq("is_fill", True)
            .eq("exchange", "okx")
            .order("timestamp")
            .limit(1)
            .execute()
        )

    fill_rows = await db_read_with_retry(_read_earliest_fill)
    if fill_rows:
        fill_ms = _instant_ms(fill_rows[0].get("timestamp"))
        if fill_ms is None:
            return "unreadable"
        if fill_ms <= anchor_ms + REACH_SLACK_MS:
            return "fills_reach_anchor"

    def _read_account_keys() -> list[dict[str, Any]]:
        return rows(
            supabase.table("api_keys")
            .select("id")
            .eq("exchange", "okx")
            .eq("venue_account_id", account)
            .execute()
        )

    key_ids = {key_id}
    for krow in await db_read_with_retry(_read_account_keys):
        kid = krow.get("id")
        if isinstance(kid, str) and kid.strip():
            key_ids.add(kid)

    cutoff = (
        datetime.fromtimestamp(now_ms / 1000, tz=timezone.utc)
        - timedelta(days=COOLDOWN_DAYS)
    ).isoformat()

    def _read_recent_jobs() -> list[dict[str, Any]]:
        return rows(
            supabase.table("compute_jobs")
            .select("status,last_error")
            .eq("kind", CHAIN_KIND)
            .in_("api_key_id", sorted(key_ids))
            .eq("metadata->>mode", FILLS_APPLY_MODE)
            .gt("created_at", cutoff)
            .execute()
        )

    if any(_counts_toward_cooldown(r) for r in await db_read_with_retry(_read_recent_jobs)):
        return "cooldown"

    payload: dict[str, Any] = {
        "p_strategy_id": None,
        "p_api_key_id": key_id,
        "p_kind": CHAIN_KIND,
        "p_metadata": {"mode": FILLS_APPLY_MODE},
    }
    now_utc = datetime.fromtimestamp(now_ms / 1000, tz=timezone.utc)
    if now_utc.time() < DAILY_CHAIN_WINDOW_END_UTC:
        payload["p_run_at"] = datetime.combine(
            now_utc.date(), DEFERRED_RUN_AT_UTC, tzinfo=timezone.utc
        ).isoformat()

    def _enqueue() -> None:
        supabase.rpc("enqueue_compute_job", payload).execute()

    await db_execute(_enqueue)
    return "enqueued"


async def chain_okx_archive_fills(
    supabase: Any, key_row: Mapping[str, Any], strategy_id: str
) -> str:
    """Chain one ``okx_archive_rebuild`` job (mode ``fills_apply``) on the syncing OKX key when the
    predicate in the module docstring holds. Returns one verdict from ``CHAIN_VERDICTS``.

    The whole body runs inside ``asyncio.timeout(CHAIN_TIMEOUT_S)``. A raised read, a raised
    enqueue or a timeout propagates to the caller, which logs it and keeps the sync's outcome."""
    async with asyncio.timeout(CHAIN_TIMEOUT_S):
        verdict = await _chain(supabase, key_row, strategy_id)
    logger.info("okx archive fills chain: strategy %s verdict %s", strategy_id, verdict)
    return verdict
