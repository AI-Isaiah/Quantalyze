import logging
from fastapi import APIRouter, HTTPException, Request
from slowapi import Limiter
from slowapi.util import get_remote_address
from models.schemas import ComputeRequest
from services.metrics import compute_all_metrics
from services.transforms import trades_to_daily_returns
from services.benchmark import get_benchmark_returns
from services.db import get_supabase, db_execute

router = APIRouter(prefix="/api", tags=["analytics"])
logger = logging.getLogger("quantalyze.analytics")
limiter = Limiter(key_func=get_remote_address)


@router.post("/compute-analytics")
@limiter.limit("10/hour")
async def compute_analytics(request: Request, req: ComputeRequest):
    """Compute analytics for a strategy from its trade history."""
    supabase = get_supabase()

    # Verify strategy exists
    strategy_result = supabase.table("strategies").select("id, user_id").eq(
        "id", req.strategy_id
    ).single().execute()

    if not strategy_result.data:
        raise HTTPException(status_code=404, detail="Strategy not found")

    # Update status to computing
    supabase.table("strategy_analytics").upsert(
        {"strategy_id": req.strategy_id, "computation_status": "computing"},
        on_conflict="strategy_id",
    ).execute()

    try:
        # Fetch trades
        result = supabase.table("trades").select("*").eq(
            "strategy_id", req.strategy_id
        ).order("timestamp").execute()

        trades = result.data
        if not trades or len(trades) < 2:
            supabase.table("strategy_analytics").upsert(
                {
                    "strategy_id": req.strategy_id,
                    "computation_status": "failed",
                    "computation_error": "Insufficient trade history. At least 2 trading days required.",
                },
                on_conflict="strategy_id",
            ).execute()
            raise HTTPException(status_code=400, detail="Insufficient trade history")

        # Fetch account balance for accurate capital estimation
        # Link: strategies.api_key_id -> api_keys.id (api_keys has no strategy_id column)
        account_balance = None
        try:
            strategy_with_key = supabase.table("strategies").select("api_key_id").eq(
                "id", req.strategy_id
            ).single().execute()
            api_key_id = strategy_with_key.data.get("api_key_id") if strategy_with_key.data else None
            if api_key_id:
                key_result = supabase.table("api_keys").select("account_balance_usdt").eq(
                    "id", api_key_id
                ).single().execute()
                if key_result.data and key_result.data.get("account_balance_usdt"):
                    account_balance = float(key_result.data["account_balance_usdt"])
        except Exception as e:
            logger.warning("Could not fetch account balance for %s: %s", req.strategy_id, str(e))

        # Transform trades to daily returns
        returns = trades_to_daily_returns(trades, account_balance=account_balance)

        if len(returns) < 2:
            supabase.table("strategy_analytics").upsert(
                {
                    "strategy_id": req.strategy_id,
                    "computation_status": "failed",
                    "computation_error": "Insufficient trading days after aggregation.",
                },
                on_conflict="strategy_id",
            ).execute()
            raise HTTPException(status_code=400, detail="Insufficient trading days")

        # Fetch benchmark returns for BTC overlay
        benchmark_stale = False
        try:
            benchmark_rets, benchmark_stale = await get_benchmark_returns("BTC")
        except Exception as e:
            logger.warning("Benchmark fetch failed: %s", str(e))
            benchmark_rets = None
            benchmark_stale = True

        # Compute all metrics
        metrics = compute_all_metrics(returns, benchmark_rets)

        # Build data quality flags
        data_quality_flags = {}
        if benchmark_stale or benchmark_rets is None:
            data_quality_flags["benchmark_unavailable"] = True
            data_quality_flags["benchmark_note"] = "Benchmark data unavailable. Alpha, beta, and correlation not computed."

        # Store results
        supabase.table("strategy_analytics").upsert(
            {
                "strategy_id": req.strategy_id,
                "computation_status": "complete",
                "computation_error": None,
                "data_quality_flags": data_quality_flags if data_quality_flags else None,
                **metrics,
            },
            on_conflict="strategy_id",
        ).execute()

        return {"status": "complete", "strategy_id": req.strategy_id}

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Compute analytics failed for %s: %s", req.strategy_id, str(e))
        supabase.table("strategy_analytics").upsert(
            {
                "strategy_id": req.strategy_id,
                "computation_status": "failed",
                "computation_error": "Analytics computation failed. Contact support if this persists.",
            },
            on_conflict="strategy_id",
        ).execute()
        raise HTTPException(status_code=500, detail="Analytics computation failed")
