from fastapi import APIRouter, HTTPException
from models.schemas import ComputeRequest
from services.metrics import compute_all_metrics
from services.transforms import trades_to_daily_returns
import os
from supabase import create_client

router = APIRouter(prefix="/api", tags=["analytics"])

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")


@router.post("/compute-analytics")
async def compute_analytics(req: ComputeRequest):
    """Compute analytics for a strategy from its trade history."""
    supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

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

        # Auto-publish: update strategy status if currently draft
        supabase.table("strategies").update({
            "status": "published"
        }).eq("id", req.strategy_id).in_("status", ["draft", "pending_review"]).execute()

        return {"status": "complete", "strategy_id": req.strategy_id}

    except HTTPException:
        raise
    except Exception as e:
        supabase.table("strategy_analytics").upsert({
            "strategy_id": req.strategy_id,
            "computation_status": "failed",
            "computation_error": str(e),
        }).execute()
        raise HTTPException(status_code=500, detail=str(e))
