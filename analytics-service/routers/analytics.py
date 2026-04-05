import logging
from fastapi import APIRouter, HTTPException, Request
from slowapi import Limiter
from slowapi.util import get_remote_address
from models.schemas import ComputeRequest
from services.metrics import compute_all_metrics
from services.transforms import trades_to_daily_returns
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
    supabase.table("strategy_analytics").upsert({
        "strategy_id": req.strategy_id,
        "computation_status": "computing",
    }).execute()

    try:
        # Fetch trades
        result = supabase.table("trades").select("*").eq(
            "strategy_id", req.strategy_id
        ).order("timestamp").execute()

        trades = result.data
        if not trades or len(trades) < 2:
            supabase.table("strategy_analytics").upsert({
                "strategy_id": req.strategy_id,
                "computation_status": "failed",
                "computation_error": "Insufficient trade history. At least 2 trading days required.",
            }).execute()
            raise HTTPException(status_code=400, detail="Insufficient trade history")

        # Transform trades to daily returns
        returns = trades_to_daily_returns(trades)

        if len(returns) < 2:
            supabase.table("strategy_analytics").upsert({
                "strategy_id": req.strategy_id,
                "computation_status": "failed",
                "computation_error": "Insufficient trading days after aggregation.",
            }).execute()
            raise HTTPException(status_code=400, detail="Insufficient trading days")

        # Compute all metrics
        metrics = compute_all_metrics(returns)

        # Store results
        supabase.table("strategy_analytics").upsert({
            "strategy_id": req.strategy_id,
            "computation_status": "complete",
            "computation_error": None,
            **metrics,
        }).execute()

        # NOTE: Auto-publish removed from HTTP endpoint for security.
        # Strategy publishing should be handled by the frontend or an admin endpoint
        # after verifying ownership.

        return {"status": "complete", "strategy_id": req.strategy_id}

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Compute analytics failed for %s: %s", req.strategy_id, str(e))
        supabase.table("strategy_analytics").upsert({
            "strategy_id": req.strategy_id,
            "computation_status": "failed",
            "computation_error": "Analytics computation failed. Contact support if this persists.",
        }).execute()
        raise HTTPException(status_code=500, detail="Analytics computation failed")
