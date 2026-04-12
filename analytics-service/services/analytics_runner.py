"""Shared strategy analytics runner.

The HTTP endpoint (routers/analytics.py::compute_analytics) and the
compute_jobs worker handler (services/job_worker.py::run_compute_analytics_job)
both need to run the same "load trades → compute metrics → upsert
strategy_analytics" sequence. Before Sprint 3 they would have duplicated
the logic; this helper exists so both callers share one implementation.

Contract
--------
async def run_strategy_analytics(strategy_id: str) -> dict

Returns a {status, strategy_id} payload on success. Raises HTTPException
on recoverable failures (missing strategy, insufficient history) so the
HTTP endpoint's FastAPI layer surfaces them as 4xx/5xx. The worker
dispatcher catches the exception and maps it through classify_exception
into (error_kind, sanitized_message) for compute_jobs.

Side effects
------------
1. On entry, upserts strategy_analytics.computation_status = 'computing'.
2. On success, upserts computation_status = 'complete' + full metrics.
3. On failure, upserts computation_status = 'failed' + sanitized error.

Note
----
The worker-side UI status bridge (sync_strategy_analytics_status via the
038 RPC) runs AFTER the job finishes, inside job_worker.dispatch. The
bridge's mapping considers the compute_jobs aggregate, so if this helper
landed 'complete' but a sibling sync_trades job is still running, the
bridge will rewrite computation_status back to 'computing' before the
caller sees the row. That's the intended interaction — Finding 2-C says
the UI surface reflects the queue, not the individual handler.
"""
from __future__ import annotations

import logging

from fastapi import HTTPException

from services.benchmark import get_benchmark_returns
from services.db import db_execute, get_supabase
from services.metrics import compute_all_metrics
from services.transforms import trades_to_daily_returns

logger = logging.getLogger("quantalyze.analytics.runner")


def _compute_volume_metrics(fills: list[dict]) -> dict:
    """Compute volume metrics from raw fill data.

    fills: list of dicts with 'side' and 'cost' keys.
    """
    total_cost = 0.0
    buy_cost = 0.0
    sell_cost = 0.0

    for fill in fills:
        cost = float(fill.get("cost", 0) or 0)
        side = (fill.get("side") or "").lower()
        total_cost += cost
        if side == "buy":
            buy_cost += cost
        elif side == "sell":
            sell_cost += cost

    buy_pct = buy_cost / total_cost if total_cost > 0 else 0.0
    sell_pct = sell_cost / total_cost if total_cost > 0 else 0.0

    return {
        "buy_volume_pct": round(buy_pct, 4),
        "sell_volume_pct": round(sell_pct, 4),
        "long_volume_pct": round(buy_pct, 4),  # approximation from fill sides
        "short_volume_pct": round(sell_pct, 4),
        "total_fills": len(fills),
        "total_volume_usd": round(total_cost, 2),
    }


async def run_strategy_analytics(strategy_id: str) -> dict:
    """Run the full analytics pipeline for a single strategy.

    See module docstring for contract and side effects.
    """
    supabase = get_supabase()

    # Verify strategy exists
    strategy_result = await db_execute(
        lambda: supabase.table("strategies")
        .select("id, user_id, api_key_id")
        .eq("id", strategy_id)
        .single()
        .execute()
    )

    if not strategy_result.data:
        raise HTTPException(status_code=404, detail="Strategy not found")

    # Update status to computing. The worker-side bridge (038 RPC) may
    # overwrite this soon after if the strategy has multiple concurrent
    # jobs, which is fine — the aggregate mapping is the source of truth.
    await db_execute(
        lambda: supabase.table("strategy_analytics").upsert(
            {"strategy_id": strategy_id, "computation_status": "computing"},
            on_conflict="strategy_id",
        ).execute()
    )

    try:
        # Fetch trades (exclude raw fills to avoid double-counting)
        result = await db_execute(
            lambda: supabase.table("trades")
            .select("*")
            .eq("strategy_id", strategy_id)
            .neq("is_fill", True)
            .order("timestamp")
            .execute()
        )

        trades = result.data
        if not trades or len(trades) < 2:
            await db_execute(
                lambda: supabase.table("strategy_analytics").upsert(
                    {
                        "strategy_id": strategy_id,
                        "computation_status": "failed",
                        "computation_error": "Insufficient trade history. At least 2 trading days required.",
                    },
                    on_conflict="strategy_id",
                ).execute()
            )
            raise HTTPException(status_code=400, detail="Insufficient trade history")

        # Fetch account balance for accurate capital estimation.
        # Link: strategies.api_key_id -> api_keys.id (api_keys has no
        # strategy_id column).
        account_balance = None
        try:
            api_key_id = (
                strategy_result.data.get("api_key_id")
                if strategy_result.data
                else None
            )
            if api_key_id:
                key_result = await db_execute(
                    lambda kid=api_key_id: supabase.table("api_keys")
                    .select("account_balance_usdt")
                    .eq("id", kid)
                    .single()
                    .execute()
                )
                if key_result.data and key_result.data.get("account_balance_usdt"):
                    account_balance = float(
                        key_result.data["account_balance_usdt"]
                    )
        except Exception as e:  # noqa: BLE001
            logger.warning(
                "Could not fetch account balance for %s: %s", strategy_id, str(e)
            )

        # Transform trades to daily returns
        returns = trades_to_daily_returns(
            trades, account_balance=account_balance
        )

        if len(returns) < 2:
            await db_execute(
                lambda: supabase.table("strategy_analytics").upsert(
                    {
                        "strategy_id": strategy_id,
                        "computation_status": "failed",
                        "computation_error": "Insufficient trading days after aggregation.",
                    },
                    on_conflict="strategy_id",
                ).execute()
            )
            raise HTTPException(status_code=400, detail="Insufficient trading days")

        # Fetch benchmark returns for BTC overlay
        benchmark_stale = False
        try:
            benchmark_rets, benchmark_stale = await get_benchmark_returns("BTC")
        except Exception as e:  # noqa: BLE001
            logger.warning("Benchmark fetch failed: %s", str(e))
            benchmark_rets = None
            benchmark_stale = True

        # Compute all metrics
        metrics = compute_all_metrics(returns, benchmark_rets)

        # Build data quality flags
        data_quality_flags: dict | None = None
        if benchmark_stale or benchmark_rets is None:
            data_quality_flags = {
                "benchmark_unavailable": True,
                "benchmark_note": "Benchmark data unavailable. Alpha, beta, and correlation not computed.",
            }

        # Store results
        await db_execute(
            lambda: supabase.table("strategy_analytics").upsert(
                {
                    "strategy_id": strategy_id,
                    "computation_status": "complete",
                    "computation_error": None,
                    "data_quality_flags": data_quality_flags,
                    **metrics,
                },
                on_conflict="strategy_id",
            ).execute()
        )

        # --- Sprint 4: Position reconstruction + fill metrics (graceful degradation) ---
        try:
            from services.position_reconstruction import (
                reconstruct_positions,
                compute_exposure_metrics,
            )

            trade_metrics = await reconstruct_positions(strategy_id, supabase)
            exposure_metrics = await compute_exposure_metrics(strategy_id, supabase)

            # Compute volume metrics from fills
            fills_result = await db_execute(
                lambda: supabase.table("trades")
                .select("side, cost")
                .eq("strategy_id", strategy_id)
                .eq("is_fill", True)
                .execute()
            )
            volume_metrics = (
                _compute_volume_metrics(fills_result.data)
                if fills_result.data
                else None
            )

            # Upsert fill metrics
            fill_update: dict = {"strategy_id": strategy_id}
            if trade_metrics:
                fill_update["trade_metrics"] = trade_metrics
            if volume_metrics:
                fill_update["volume_metrics"] = volume_metrics
            if exposure_metrics:
                fill_update["exposure_metrics"] = exposure_metrics

            if len(fill_update) > 1:  # more than just strategy_id
                await db_execute(
                    lambda: supabase.table("strategy_analytics")
                    .upsert(fill_update, on_conflict="strategy_id")
                    .execute()
                )
        except Exception as e:
            logger.warning(
                "Position reconstruction failed for %s: %s", strategy_id, str(e)
            )
            # Set data quality flag but don't fail the overall job
            try:
                existing = data_quality_flags or {}
                existing["position_metrics_failed"] = True
                existing["position_metrics_error"] = str(e)[:200]
                await db_execute(
                    lambda: supabase.table("strategy_analytics")
                    .upsert(
                        {
                            "strategy_id": strategy_id,
                            "data_quality_flags": existing,
                        },
                        on_conflict="strategy_id",
                    )
                    .execute()
                )
            except Exception:
                pass

        return {"status": "complete", "strategy_id": strategy_id}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Compute analytics failed for %s: %s", strategy_id, str(e)
        )
        await db_execute(
            lambda: supabase.table("strategy_analytics").upsert(
                {
                    "strategy_id": strategy_id,
                    "computation_status": "failed",
                    "computation_error": "Analytics computation failed. Contact support if this persists.",
                },
                on_conflict="strategy_id",
            ).execute()
        )
        raise HTTPException(status_code=500, detail="Analytics computation failed")
