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
from services.equity_reconstruction import reconstruct_symbol_returns
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

# Phase 09 / D-06 + RESEARCH A3. Scale is 0..100 per match_engine.py final_score.
# D-06's "composite >= 0.50" on the normalized [0,1] scale corresponds to score >= 50
# on the stored match_candidates.score column. Parity asserted by SSR-side
# constant in Plan 09-03 (finding f5 requires engine-side + SSR-side agreement).
FLAG_COMPOSITE_THRESHOLD = 50


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
            "id, name, codename, strategy_types, subtypes, supported_exchanges, "
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

        # First subtype as primary (Phase 3 / Pitfall 1 — SUBTYPES enum,
        # compared against allocator.style_exclusions in match_engine._eligibility_check)
        subtypes = strategy.get("subtypes") or []
        primary_subtype = subtypes[0] if subtypes else None

        strategies_by_id[sid] = {
            "strategy_id": sid,
            "name": strategy.get("name"),
            "codename": strategy.get("codename"),
            "manager_id": strategy.get("user_id"),
            "manager_aum": float(strategy.get("aum")) if strategy.get("aum") else None,
            "strategy_type": primary_type,
            "subtype": primary_subtype,  # Phase 3 / SCORING-07
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


def _load_holding_portfolio_context(allocator_id: str) -> dict[str, Any]:
    """Phase 09 / D-01 + D-16. Load allocator_holdings and reconstruct per-symbol
    returns from allocator_equity_snapshots.breakdown.

    Mirrors the TypeScript queries.ts holdingsMap collapse (latest-asof-per-
    (venue, symbol, holding_type) wins). Applies the Phase 07 D-03 warm-up gate:
    holdings whose per-symbol series has fewer than 30 daily returns are excluded
    from portfolio math entirely (not flagged, not compared).

    This helper is SYNC (plain def) — called from _load_allocator_context which is
    itself sync and invoked via asyncio.to_thread. Per finding f1: MUST NOT be
    converted to async def.

    Returns dict with:
      portfolio_strategies: list[dict]  (pseudo-strategy dicts, strategy_id = "holding:V:S:T")
      portfolio_weights:    dict[str, float]  (value_usd / total_eligible_value, sums to 1.0)
      portfolio_returns:    dict[str, pd.Series]  (one Series per eligible holding)
      portfolio_aum:        float  (sum of eligible holding value_usd)
      holdings_rows_eligible: list[dict]  (raw holding rows that passed warm-up gate, for
                                           compute_holding_flags consumption in Task 3)
    """
    supabase = get_supabase()

    # --- Step 1: fetch all holdings for this allocator, most-recent-first ---
    holdings_result = (
        supabase.table("allocator_holdings")
        .select("venue, symbol, holding_type, value_usd, asof")
        .eq("allocator_id", allocator_id)
        .order("asof", desc=True)
        .execute()
    )
    holdings_rows = holdings_result.data or []

    # --- Step 2: collapse to latest-asof-per-(venue, symbol, holding_type) ---
    # First row wins because we ordered DESC — mirrors queries.ts:791-795 holdingsMap
    holdings_map: dict[tuple[str, str, str], dict] = {}
    for row in holdings_rows:
        key = (row["venue"], row["symbol"], row["holding_type"])
        if key not in holdings_map:
            holdings_map[key] = row
    collapsed = list(holdings_map.values())

    if not collapsed:
        return {
            "portfolio_strategies": [],
            "portfolio_weights": {},
            "portfolio_returns": {},
            "portfolio_aum": 0.0,
            "holdings_rows_eligible": [],
        }

    # --- Step 3: fetch equity snapshots ordered ASC (needed for pct_change) ---
    snapshots_result = (
        supabase.table("allocator_equity_snapshots")
        .select("asof, breakdown")
        .eq("allocator_id", allocator_id)
        .order("asof", desc=False)
        .execute()
    )
    snapshots = snapshots_result.data or []

    # --- Step 4: reconstruct per-symbol returns + apply 30-day warm-up gate ---
    portfolio_strategies: list[dict[str, Any]] = []
    portfolio_returns: dict[str, pd.Series] = {}
    holdings_rows_eligible: list[dict] = []
    raw_values: dict[str, float] = {}  # pseudo_id -> value_usd (for weight computation)

    for row in collapsed:
        venue = row["venue"]
        symbol = row["symbol"]
        holding_type = row["holding_type"]
        pseudo_id = f"holding:{venue}:{symbol}:{holding_type}"
        value_usd = float(row.get("value_usd") or 0.0)

        series = reconstruct_symbol_returns(snapshots, symbol)
        if series is None or len(series) < 30:
            # Warm-up gate: insufficient history — exclude entirely (Phase 07 D-03 analog)
            continue

        portfolio_strategies.append({"strategy_id": pseudo_id})
        portfolio_returns[pseudo_id] = series
        holdings_rows_eligible.append(row)
        raw_values[pseudo_id] = value_usd

    # --- Step 5: compute weights (value_usd / total_eligible_value) ---
    total_eligible_value = sum(raw_values.values())
    portfolio_weights: dict[str, float] = {}
    if total_eligible_value > 0:
        for pid, val in raw_values.items():
            portfolio_weights[pid] = val / total_eligible_value
    else:
        # All values zero — equal weight as fallback
        for pid in raw_values:
            portfolio_weights[pid] = 1.0 / len(raw_values) if raw_values else 0.0

    return {
        "portfolio_strategies": portfolio_strategies,
        "portfolio_weights": portfolio_weights,
        "portfolio_returns": portfolio_returns,
        "portfolio_aum": total_eligible_value,
        "holdings_rows_eligible": holdings_rows_eligible,
    }


def _load_allocator_context(allocator_id: str) -> dict[str, Any]:
    """Load per-allocator data: preferences, portfolio, thumbs-down history.

    Phase 09 / D-16: merges both portfolio_strategies (legacy) and
    allocator_holdings (real holdings as pseudo-strategies) into the combined
    context dicts. Weights are renormalized across the combined set so they sum
    to 1.0. This function remains a synchronous `def` — it is called via
    asyncio.to_thread at line ~268 (finding f1 mandate: MUST NOT be async def).
    """
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
    strategy_aum: float = 0.0
    # Track raw value per strategy id for combined renormalization
    strategy_raw_values: dict[str, float] = {}

    if portfolio_ids:
        ps_result = (
            supabase.table("portfolio_strategies")
            .select("strategy_id, current_weight, portfolio_id, allocated_amount")
            .in_("portfolio_id", portfolio_ids)
            .execute()
        )
        ps_rows = ps_result.data or []

        strategy_ids = list({row["strategy_id"] for row in ps_rows})
        sa_result = (
            supabase.table("strategy_analytics")
            .select("strategy_id, returns_series")
            .in_("strategy_id", strategy_ids)
            .execute()
        ) if strategy_ids else None

        if sa_result:
            analytics_by_sid = {row["strategy_id"]: row for row in (sa_result.data or [])}
            for row in ps_rows:
                sid = row["strategy_id"]
                if sid not in portfolio_weights:
                    portfolio_strategies.append({"strategy_id": sid})
                    # NULL current_weight defaults to 1.0 as a cold-start placeholder.
                    # match_engine.score_candidates re-normalizes the weights dict to
                    # sum=1.0 before scoring, so a single NULL row won't break the
                    # math — but a portfolio with mixed NULL and filled rows will
                    # still skew toward the NULL row. Seeded data always fills weights;
                    # this path is for user-created portfolios with partial data.
                    portfolio_weights[sid] = float(row.get("current_weight") or 1.0)
                    sa = analytics_by_sid.get(sid, {})
                    returns = _records_to_series(sa.get("returns_series"), name=sid)
                    if returns is not None:
                        portfolio_returns[sid] = returns
                    allocated = row.get("allocated_amount")
                    if allocated:
                        alloc_val = float(allocated)
                        strategy_aum += alloc_val
                        strategy_raw_values[sid] = alloc_val

    # Phase 09 / D-01 + D-16: load holdings-sourced pseudo-strategies
    holdings_ctx = _load_holding_portfolio_context(allocator_id)
    holding_strategies = holdings_ctx["portfolio_strategies"]
    holding_weights_raw = holdings_ctx["portfolio_returns"]  # keyed by pseudo_id
    holding_returns = holdings_ctx["portfolio_returns"]
    holding_aum = holdings_ctx["portfolio_aum"]
    holdings_rows_eligible = holdings_ctx["holdings_rows_eligible"]

    # Merge strategies + holdings into combined dicts
    portfolio_strategies.extend(holding_strategies)
    portfolio_returns.update(holding_returns)

    # Combined AUM
    combined_aum = strategy_aum + holding_aum

    # Renormalize weights across the combined set so they sum to 1.0 (D-16).
    # Strategy side: use allocated_amount as the value basis.
    # Holdings side: use value_usd (already in holdings_ctx["portfolio_weights"] as fractions
    #   of the holdings total, but we need absolute values for combined renorm).
    # Reconstruct absolute values for holding side from their individual value_usd.
    holding_abs_values: dict[str, float] = {}
    for row in holdings_rows_eligible:
        pseudo_id = f"holding:{row['venue']}:{row['symbol']}:{row['holding_type']}"
        holding_abs_values[pseudo_id] = float(row.get("value_usd") or 0.0)

    if combined_aum > 0:
        # Strategies side
        for sid, val in strategy_raw_values.items():
            portfolio_weights[sid] = val / combined_aum
        # Holdings side
        for pid, val in holding_abs_values.items():
            portfolio_weights[pid] = val / combined_aum
    elif holding_strategies or portfolio_strategies:
        # Fall back: equal weights when no AUM data available
        all_ids = [ps["strategy_id"] for ps in portfolio_strategies]
        eq_w = 1.0 / len(all_ids) if all_ids else 0.0
        for pid in all_ids:
            portfolio_weights[pid] = eq_w

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
        "portfolio_aum": combined_aum if combined_aum > 0 else None,
        "thumbs_down_ids": thumbs_down_ids,
        # Internal-use: passed to compute_holding_flags in _score_one_allocator (Task 3)
        "_holdings_rows_eligible": holdings_rows_eligible,
    }


async def _score_one_allocator(
    allocator_id: str,
    universe: dict[str, Any],
) -> dict[str, Any]:
    """Score a single allocator and persist the batch + candidates."""
    # Phase 4 / D-06 + D-09 + D-10 — compute feedback overrides BEFORE scoring.
    # D6: this import is intentionally body-placed (4-space function-body indent)
    # to stay lazy — services.feedback_engine MUST NOT appear in sys.modules at
    # module load time, only when a scoring call lands here. D3 fast-path guard
    # inside compute_adjusted_weights short-circuits allocators with no
    # bridge_outcomes (at most 1 Supabase round-trip before returning {}).
    # Pitfall 1: ctx["preferences"] can be None when the allocator has no
    # allocator_preferences row — normalize to {} before merging.
    from services.feedback_engine import compute_adjusted_weights
    async with _scoring_semaphore:
        start = time.monotonic()

        ctx = await asyncio.to_thread(_load_allocator_context, allocator_id)

        overrides = await asyncio.to_thread(compute_adjusted_weights, allocator_id)
        if ctx["preferences"] is None:
            ctx["preferences"] = {}
        ctx["preferences"]["scoring_weight_overrides"] = overrides or None

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
    """D-11 triple check — return False (don't skip) when ANY of:
      1. force == True (caller explicit override)
      2. last_batch.engine_version != ENGINE_VERSION (v1→v2 cutover or future bump)
      3. allocator_preferences.mandate_edited_at > last_batch.computed_at (mandate edit)
    Otherwise apply the RECOMPUTE_MIN_AGE_HOURS age guard.
    Phase 3 / SCORING-05.
    """
    if force:
        return False
    supabase = get_supabase()
    result = await asyncio.to_thread(
        lambda: supabase.table("match_batches")
        .select("computed_at, engine_version")
        .eq("allocator_id", allocator_id)
        .order("computed_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = result.data or []
    if not rows:
        return False
    last_row = rows[0]
    # Trigger 2: engine_version mismatch — invalidate v1 batches for the
    # v1→v2 cutover and any future bump. Short-circuits BEFORE the age
    # check so a fresh v1 batch is still recomputed.
    if last_row.get("engine_version") != ENGINE_VERSION:
        return False
    try:
        last_at = datetime.fromisoformat(last_row["computed_at"].replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return False
    # Trigger 3: mandate_edited_at > computed_at — mandate edit invalidates
    # the cached batch. One extra query against allocator_preferences
    # (indexed by user_id PK, O(1) lookup).
    prefs_result = await asyncio.to_thread(
        lambda: supabase.table("allocator_preferences")
        .select("mandate_edited_at")
        .eq("user_id", allocator_id)
        .maybe_single()
        .execute()
    )
    prefs = (prefs_result.data or {}) if prefs_result else {}
    edited_raw = prefs.get("mandate_edited_at") if isinstance(prefs, dict) else None
    if edited_raw:
        try:
            edited_at = datetime.fromisoformat(edited_raw.replace("Z", "+00:00"))
            if edited_at > last_at:
                return False
        except (ValueError, AttributeError):
            pass
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
async def eval_metrics(
    lookback_days: int = 28,
    partner_tag: str | None = None,
) -> dict[str, Any]:
    """Compute hit-rate metrics for the /admin/match/eval dashboard.

    Optional `partner_tag` query param scopes the metrics to allocators tagged
    into a partner pilot (see migration 016 + /admin/partner-import).
    """
    if lookback_days < 1 or lookback_days > 365:
        raise HTTPException(status_code=400, detail="lookback_days must be between 1 and 365")
    try:
        return await asyncio.to_thread(
            compute_hit_rate_metrics, lookback_days, partner_tag
        )
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
