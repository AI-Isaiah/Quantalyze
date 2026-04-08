"""Perfect Match Engine router — admin-only match queue computations.

POST /api/match/recompute            Single-allocator recompute (called from Next.js admin)
POST /api/match/cron-recompute       Daily cron that loops all allocators

See docs/superpowers/plans/2026-04-07-perfect-match-engine.md Phase 2.
"""

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Any

import pandas as pd
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.db import get_supabase
from services.match_engine import (
    ENGINE_VERSION,
    TOP_N_CANDIDATES,
    WEIGHTS_VERSION,
    score_candidates,
)
from services.match_eval import compute_hit_rate_metrics

router = APIRouter(prefix="/api/match", tags=["match"])
logger = logging.getLogger("quantalyze.analytics")

# Per-allocator scoring concurrency. Semaphore is process-local; multi-worker
# deploys rely on the in-flight marker pattern from portfolio cron.
_scoring_semaphore = asyncio.Semaphore(3)

# Skip recompute if the last batch is newer than this threshold (unless forced)
RECOMPUTE_MIN_AGE_HOURS = 12


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------


class RecomputeRequest(BaseModel):
    allocator_id: str
    force: bool = False


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _records_to_series(raw: list | None, name: str = "") -> pd.Series | None:
    """Convert [{date, value}, ...] JSONB records to a DatetimeIndex pd.Series."""
    if not isinstance(raw, list) or not raw:
        return None
    dates = [r["date"] for r in raw]
    vals = [r["value"] for r in raw]
    return pd.Series(vals, index=pd.DatetimeIndex(dates), name=name)


def _kill_switch_enabled() -> bool:
    """Check the kill switch. Returns True if the engine should run."""
    supabase = get_supabase()
    try:
        result = supabase.table("system_flags").select("enabled").eq(
            "key", "match_engine_enabled"
        ).maybe_single().execute()
        if not result.data:
            return True  # No row = default enabled
        return bool(result.data.get("enabled", True))
    except Exception as err:
        logger.warning("match_engine: kill switch check failed, defaulting to enabled: %s", err)
        return True


def _load_candidate_universe() -> dict[str, Any]:
    """Load all strategies, analytics, and returns ONCE per cron run.

    Returns a dict:
    {
      "strategies_by_id": {sid: {...}},
      "returns_by_id": {sid: pd.Series},
    }
    """
    supabase = get_supabase()

    strategies_result = (
        supabase.table("strategies")
        .select(
            "id, name, codename, strategy_types, supported_exchanges, "
            "status, aum, max_capacity, user_id, start_date"
        )
        .eq("status", "published")
        .execute()
    )
    strategies = strategies_result.data or []
    strategy_ids = [s["id"] for s in strategies]

    if not strategy_ids:
        return {"strategies_by_id": {}, "returns_by_id": {}}

    analytics_result = (
        supabase.table("strategy_analytics")
        .select(
            "strategy_id, returns_series, sharpe, max_drawdown, "
            "cumulative_return, cagr, volatility"
        )
        .in_("strategy_id", strategy_ids)
        .execute()
    )
    analytics_by_sid = {row["strategy_id"]: row for row in (analytics_result.data or [])}

    strategies_by_id: dict[str, dict[str, Any]] = {}
    returns_by_id: dict[str, pd.Series] = {}

    for strategy in strategies:
        sid = strategy["id"]
        analytics = analytics_by_sid.get(sid, {})

        # Track record days from start_date. start_date is a DATE column,
        # so fromisoformat returns a naive datetime — promote to UTC before
        # subtracting from the aware now().
        track_record_days = 0
        if strategy.get("start_date"):
            try:
                start = datetime.fromisoformat(strategy["start_date"].replace("Z", "+00:00"))
                if start.tzinfo is None:
                    start = start.replace(tzinfo=timezone.utc)
                track_record_days = (datetime.now(timezone.utc) - start).days
            except (ValueError, AttributeError):
                pass

        # First strategy type as primary
        types = strategy.get("strategy_types") or []
        primary_type = types[0] if types else None

        # First exchange as primary
        exchanges = strategy.get("supported_exchanges") or []
        primary_exchange = exchanges[0] if exchanges else None

        strategies_by_id[sid] = {
            "strategy_id": sid,
            "name": strategy.get("name"),
            "codename": strategy.get("codename"),
            "manager_id": strategy.get("user_id"),
            "manager_aum": float(strategy.get("aum")) if strategy.get("aum") else None,
            "strategy_type": primary_type,
            "exchange": primary_exchange,
            "sharpe": analytics.get("sharpe"),
            "max_drawdown_pct": analytics.get("max_drawdown"),
            "track_record_days": track_record_days,
        }

        returns_series = _records_to_series(analytics.get("returns_series"), name=sid)
        if returns_series is not None:
            returns_by_id[sid] = returns_series

    return {
        "strategies_by_id": strategies_by_id,
        "returns_by_id": returns_by_id,
    }


def _load_allocator_context(allocator_id: str) -> dict[str, Any]:
    """Load per-allocator data: preferences, portfolio, thumbs-down history."""
    supabase = get_supabase()

    # Preferences
    prefs_result = supabase.table("allocator_preferences").select("*").eq(
        "user_id", allocator_id
    ).maybe_single().execute()
    preferences = prefs_result.data

    # Portfolio strategies + weights. Iterate all portfolios owned by this allocator.
    portfolios_result = supabase.table("portfolios").select("id").eq(
        "user_id", allocator_id
    ).execute()
    portfolio_ids = [p["id"] for p in (portfolios_result.data or [])]

    portfolio_strategies: list[dict[str, Any]] = []
    portfolio_weights: dict[str, float] = {}
    portfolio_returns: dict[str, pd.Series] = {}
    portfolio_aum: float = 0.0

    if portfolio_ids:
        ps_result = (
            supabase.table("portfolio_strategies")
            .select("strategy_id, weight, portfolio_id")
            .in_("portfolio_id", portfolio_ids)
            .execute()
        )
        ps_rows = ps_result.data or []

        strategy_ids = list({row["strategy_id"] for row in ps_rows})
        sa_result = (
            supabase.table("strategy_analytics")
            .select("strategy_id, returns_series, total_aum")
            .in_("strategy_id", strategy_ids)
            .execute()
        ) if strategy_ids else None

        if sa_result:
            analytics_by_sid = {row["strategy_id"]: row for row in (sa_result.data or [])}
            for row in ps_rows:
                sid = row["strategy_id"]
                if sid not in portfolio_weights:
                    portfolio_strategies.append({"strategy_id": sid})
                    portfolio_weights[sid] = float(row.get("weight") or 1.0)
                    sa = analytics_by_sid.get(sid, {})
                    returns = _records_to_series(sa.get("returns_series"), name=sid)
                    if returns is not None:
                        portfolio_returns[sid] = returns
                    if sa.get("total_aum"):
                        portfolio_aum += float(sa["total_aum"])

    # Thumbs-down history
    td_result = (
        supabase.table("match_decisions")
        .select("strategy_id")
        .eq("allocator_id", allocator_id)
        .eq("decision", "thumbs_down")
        .execute()
    )
    thumbs_down_ids = {row["strategy_id"] for row in (td_result.data or [])}

    return {
        "preferences": preferences,
        "portfolio_strategies": portfolio_strategies,
        "portfolio_weights": portfolio_weights,
        "portfolio_returns": portfolio_returns,
        "portfolio_aum": portfolio_aum if portfolio_aum > 0 else None,
        "thumbs_down_ids": thumbs_down_ids,
    }


async def _score_one_allocator(
    allocator_id: str,
    universe: dict[str, Any],
) -> dict[str, Any]:
    """Score a single allocator and persist the batch + candidates."""
    async with _scoring_semaphore:
        start = time.monotonic()

        ctx = await asyncio.to_thread(_load_allocator_context, allocator_id)

        # Build the candidate list from the cached universe
        candidate_strategies = list(universe["strategies_by_id"].values())
        candidate_returns = universe["returns_by_id"]

        result = score_candidates(
            allocator_id=allocator_id,
            preferences=ctx["preferences"],
            portfolio_strategies=ctx["portfolio_strategies"],
            portfolio_returns=ctx["portfolio_returns"],
            portfolio_weights=ctx["portfolio_weights"],
            candidate_strategies=candidate_strategies,
            candidate_returns=candidate_returns,
            thumbs_down_ids=ctx["thumbs_down_ids"],
            portfolio_aum=ctx["portfolio_aum"],
        )

        latency_ms = int((time.monotonic() - start) * 1000)

        # Persist: one match_batches row, N match_candidates rows.
        supabase = get_supabase()

        batch_row = {
            "allocator_id": allocator_id,
            "mode": result["mode"],
            "filter_relaxed": result["filter_relaxed"],
            "candidate_count": len(result["candidates"]),
            # Use the TRUE excluded count, not the length of the persisted list
            # (which is capped at TOP_N_EXCLUDED for storage efficiency).
            "excluded_count": result.get("excluded_total", len(result["excluded"])),
            "engine_version": ENGINE_VERSION,
            "weights_version": WEIGHTS_VERSION,
            "effective_preferences": result["effective_preferences"],
            "effective_thresholds": result["effective_thresholds"],
            "source_strategy_count": result["source_strategy_count"],
            "latency_ms": latency_ms,
        }
        batch_insert = await asyncio.to_thread(
            lambda: supabase.table("match_batches").insert(batch_row).execute()
        )
        if not batch_insert.data:
            raise RuntimeError(f"Failed to insert match_batches for {allocator_id}")
        batch_id = batch_insert.data[0]["id"]

        # Insert candidates (top 30) + excluded (up to 50) into match_candidates
        rows_to_insert = []
        for cand in result["candidates"]:
            rows_to_insert.append({
                "batch_id": batch_id,
                "allocator_id": allocator_id,
                "strategy_id": cand["strategy_id"],
                "score": cand["score"],
                "score_breakdown": cand["score_breakdown"],
                "reasons": cand["reasons"],
                "rank": cand["rank"],
                "exclusion_reason": None,
                "exclusion_provenance": None,
            })
        for exc in result["excluded"]:
            rows_to_insert.append({
                "batch_id": batch_id,
                "allocator_id": allocator_id,
                "strategy_id": exc["strategy_id"],
                "score": 0,
                "score_breakdown": {"raw": {}},
                "reasons": [],
                "rank": None,
                "exclusion_reason": exc["exclusion_reason"],
                "exclusion_provenance": exc.get("exclusion_provenance"),
            })

        if rows_to_insert:
            await asyncio.to_thread(
                lambda: supabase.table("match_candidates").insert(rows_to_insert).execute()
            )

        logger.info(
            "match_engine recompute: allocator=%s batch=%s mode=%s "
            "candidates=%d excluded=%d filter_relaxed=%s latency_ms=%d",
            allocator_id, batch_id, result["mode"],
            len(result["candidates"]), len(result["excluded"]),
            result["filter_relaxed"], latency_ms,
        )

        return {
            "allocator_id": allocator_id,
            "batch_id": batch_id,
            "candidate_count": len(result["candidates"]),
            "excluded_count": len(result["excluded"]),
            "mode": result["mode"],
            "filter_relaxed": result["filter_relaxed"],
            "latency_ms": latency_ms,
        }


async def _should_skip_allocator(allocator_id: str, force: bool) -> bool:
    """Skip if last batch is younger than RECOMPUTE_MIN_AGE_HOURS unless forced."""
    if force:
        return False
    supabase = get_supabase()
    result = await asyncio.to_thread(
        lambda: supabase.table("match_batches")
        .select("computed_at")
        .eq("allocator_id", allocator_id)
        .order("computed_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = result.data or []
    if not rows:
        return False
    try:
        last_at = datetime.fromisoformat(rows[0]["computed_at"].replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return False
    age_hours = (datetime.now(timezone.utc) - last_at).total_seconds() / 3600
    return age_hours < RECOMPUTE_MIN_AGE_HOURS


def _retention_sweep(allocator_id: str, keep: int = 7) -> int:
    """Delete old batches for this allocator, keeping the last `keep`.
    CASCADE drops match_candidates for the deleted batches.

    Returns the number of batches deleted.
    """
    supabase = get_supabase()
    # Get all batches ordered by computed_at DESC
    result = (
        supabase.table("match_batches")
        .select("id")
        .eq("allocator_id", allocator_id)
        .order("computed_at", desc=True)
        .execute()
    )
    rows = result.data or []
    if len(rows) <= keep:
        return 0
    ids_to_delete = [row["id"] for row in rows[keep:]]
    supabase.table("match_batches").delete().in_("id", ids_to_delete).execute()
    return len(ids_to_delete)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/recompute")
async def recompute(req: RecomputeRequest) -> dict[str, Any]:
    """Single-allocator recompute. Called from the Next.js admin /api/admin/match/recompute."""
    if not _kill_switch_enabled():
        logger.info("match_engine recompute: kill switch off, skipping allocator=%s", req.allocator_id)
        return {"disabled": True}

    if await _should_skip_allocator(req.allocator_id, req.force):
        logger.info("match_engine recompute: skipping recent batch for %s", req.allocator_id)
        return {"skipped": True, "reason": "recent_batch"}

    universe = await asyncio.to_thread(_load_candidate_universe)
    if not universe["strategies_by_id"]:
        raise HTTPException(status_code=400, detail="No eligible strategies in the directory")

    try:
        result = await _score_one_allocator(req.allocator_id, universe)
    except Exception as err:
        logger.exception("match_engine recompute failed for %s", req.allocator_id)
        raise HTTPException(status_code=500, detail=f"Scoring failed: {err}") from err

    # Retention sweep for this allocator (keep last 7)
    await asyncio.to_thread(_retention_sweep, req.allocator_id)

    return result


@router.get("/eval")
async def eval_metrics(lookback_days: int = 28) -> dict[str, Any]:
    """Compute hit-rate metrics for the /admin/match/eval dashboard."""
    if lookback_days < 1 or lookback_days > 365:
        raise HTTPException(status_code=400, detail="lookback_days must be between 1 and 365")
    try:
        return await asyncio.to_thread(compute_hit_rate_metrics, lookback_days)
    except Exception as err:
        logger.exception("match_engine eval failed")
        raise HTTPException(status_code=500, detail=f"Eval failed: {err}") from err


@router.post("/cron-recompute")
async def cron_recompute() -> dict[str, Any]:
    """Daily cron. Loops every allocator (+ role 'both'), recomputes their batch."""
    overall_start = time.monotonic()

    if not _kill_switch_enabled():
        logger.info("match_engine cron: kill switch off, skipping")
        return {"disabled": True, "processed": 0}

    supabase = get_supabase()

    # Load allocators (role = 'allocator' OR 'both')
    allocators_result = (
        supabase.table("profiles")
        .select("id")
        .in_("role", ["allocator", "both"])
        .execute()
    )
    allocators = allocators_result.data or []
    if not allocators:
        logger.info("match_engine cron: no allocators found")
        return {"processed": 0, "skipped": 0, "failed": 0, "duration_s": 0}

    # Load universe ONCE (eng review E16)
    universe = await asyncio.to_thread(_load_candidate_universe)
    if not universe["strategies_by_id"]:
        logger.warning("match_engine cron: no strategies in universe")
        return {"processed": 0, "skipped": 0, "failed": 0, "reason": "empty_universe"}

    processed = 0
    skipped = 0
    failed = 0

    for profile in allocators:
        allocator_id = profile["id"]

        # Re-check kill switch mid-run (founder may flip it)
        if not _kill_switch_enabled():
            logger.info("match_engine cron: kill switch flipped mid-run, aborting")
            break

        if await _should_skip_allocator(allocator_id, force=False):
            skipped += 1
            continue

        try:
            await _score_one_allocator(allocator_id, universe)
            processed += 1
        except Exception as err:
            logger.exception("match_engine cron: allocator %s failed: %s", allocator_id, err)
            failed += 1
            # Continue the loop — one allocator failure doesn't fail the cron

    # Retention sweep at end (per allocator that had a batch this run)
    retention_total = 0
    for profile in allocators:
        try:
            retention_total += await asyncio.to_thread(_retention_sweep, profile["id"])
        except Exception as err:
            logger.warning("match_engine cron: retention sweep failed for %s: %s", profile["id"], err)

    duration_s = round(time.monotonic() - overall_start, 2)
    logger.info(
        "match_engine cron complete: processed=%d skipped=%d failed=%d "
        "retention_deleted=%d duration_s=%.2f",
        processed, skipped, failed, retention_total, duration_s,
    )
    return {
        "processed": processed,
        "skipped": skipped,
        "failed": failed,
        "retention_deleted": retention_total,
        "duration_s": duration_s,
    }
