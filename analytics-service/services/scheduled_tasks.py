"""Daily scheduled tasks that used to run as Vercel Cron jobs.

The Vercel Hobby plan caps cron jobs at 2. While Quantalyze is on Hobby,
only two crons can live in vercel.json (warm-analytics + alert-digest).
The three compute-queue-related jobs moved here and run daily from the
Railway worker process alongside the existing dispatch/watchdog/daily
loops in main_worker.py.

Each tick mirrors the Next.js route of the same name, one-for-one:

  - enqueue_sync_funding_tick        → src/app/api/cron/sync-funding
  - enqueue_reconcile_strategies_tick → src/app/api/cron/reconcile-strategies
  - cleanup_ack_tokens_tick          → src/app/api/cron/cleanup-ack-tokens

The Next.js routes stay in place so operators can still curl them for
incident response (``Bearer $CRON_SECRET``). Removing from vercel.json
just stops the scheduled invocation; the handlers remain.

When the project upgrades to Vercel Pro, move all three back into
``vercel.json`` and delete this module. See
``docs/runbooks/vercel-cron-upgrade.md``.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from services.db import db_execute, get_supabase

logger = logging.getLogger("quantalyze.analytics.scheduled")

# Matches src/lib/utils.ts SUPPORTED_EXCHANGES and
# services/exchange.py EXCHANGE_CLASSES.
PERP_EXCHANGES: tuple[str, ...] = ("binance", "okx", "bybit")


def _enqueue_each(supabase: Any, strategy_ids: list[str], kind: str) -> tuple[int, list[str]]:
    """Call enqueue_compute_job once per strategy, aggregate results.

    Returns (enqueued_count, errors) where errors is capped at 5 messages
    for log surfacing — same shape as the TS cron handlers.
    """
    enqueued = 0
    errors: list[str] = []
    for sid in strategy_ids:
        try:
            result = supabase.rpc(
                "enqueue_compute_job",
                {"p_strategy_id": sid, "p_kind": kind},
            ).execute()
            if getattr(result, "data", None):
                enqueued += 1
        except Exception as exc:  # noqa: BLE001 — per-row isolation
            errors.append(f"{sid}: {exc}")
            logger.error("[scheduled/%s] enqueue failed for strategy=%s: %s", kind, sid, exc)
    return enqueued, errors


async def enqueue_sync_funding_tick() -> dict[str, int]:
    """Enqueue a ``sync_funding`` compute_job for every strategy on a
    perp-supporting exchange with an active api_key.

    Returns ``{enqueued, failed, total_candidates}`` — primarily for tests.
    """
    supabase = get_supabase()

    def _fetch():
        return (
            supabase.from_("strategies")
            .select("id, api_keys!inner(exchange, is_active)")
            .eq("api_keys.is_active", True)
            .in_("api_keys.exchange", list(PERP_EXCHANGES))
            .execute()
        )

    fetch_result = await db_execute(_fetch)
    rows = fetch_result.data or []
    strategy_ids = [r["id"] for r in rows]

    if not strategy_ids:
        logger.info("[scheduled/sync_funding] no candidates")
        return {"enqueued": 0, "failed": 0, "total_candidates": 0}

    enqueued, errors = await db_execute(
        lambda: _enqueue_each(supabase, strategy_ids, "sync_funding")
    )
    logger.info(
        "[scheduled/sync_funding] enqueued=%d failed=%d total=%d",
        enqueued, len(errors), len(strategy_ids),
    )
    return {
        "enqueued": enqueued,
        "failed": len(errors),
        "total_candidates": len(strategy_ids),
    }


async def enqueue_reconcile_strategies_tick() -> dict[str, int]:
    """Enqueue a ``reconcile_strategy`` compute_job for every strategy on
    a supported exchange whose api_key synced within the last 24h.

    Returns ``{enqueued, failed, total_candidates}``.
    """
    supabase = get_supabase()
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()

    def _fetch():
        return (
            supabase.from_("strategies")
            .select("id, api_keys!inner(exchange, is_active, last_sync_at)")
            .eq("api_keys.is_active", True)
            .in_("api_keys.exchange", list(PERP_EXCHANGES))
            .gt("api_keys.last_sync_at", cutoff)
            .execute()
        )

    fetch_result = await db_execute(_fetch)
    rows = fetch_result.data or []
    strategy_ids = [r["id"] for r in rows]

    if not strategy_ids:
        logger.info("[scheduled/reconcile_strategy] no candidates")
        return {"enqueued": 0, "failed": 0, "total_candidates": 0}

    enqueued, errors = await db_execute(
        lambda: _enqueue_each(supabase, strategy_ids, "reconcile_strategy")
    )
    logger.info(
        "[scheduled/reconcile_strategy] enqueued=%d failed=%d total=%d",
        enqueued, len(errors), len(strategy_ids),
    )
    return {
        "enqueued": enqueued,
        "failed": len(errors),
        "total_candidates": len(strategy_ids),
    }


async def cleanup_ack_tokens_tick() -> dict[str, int]:
    """Delete ``used_ack_tokens`` rows whose ``used_at`` is older than 30
    days. See src/app/api/cron/cleanup-ack-tokens for the rationale — the
    minted ack tokens TTL at 48h, so 30 days is forensic headroom, not a
    security boundary.

    Returns ``{deleted}``.
    """
    supabase = get_supabase()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()

    def _delete():
        return (
            supabase.from_("used_ack_tokens")
            .delete()
            .lt("used_at", cutoff)
            .execute()
        )

    result = await db_execute(_delete)
    deleted = len(result.data or [])
    logger.info("[scheduled/cleanup_ack_tokens] deleted=%d", deleted)
    return {"deleted": deleted}
