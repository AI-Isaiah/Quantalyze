import logging
from fastapi import APIRouter, Request
from slowapi import Limiter
from slowapi.util import get_remote_address
from models.schemas import ComputeRequest
from services.analytics_runner import run_strategy_analytics

router = APIRouter(prefix="/api", tags=["analytics"])
logger = logging.getLogger("quantalyze.analytics")
limiter = Limiter(key_func=get_remote_address)


@router.post("/compute-analytics")
@limiter.limit("10/hour")
async def compute_analytics(request: Request, req: ComputeRequest):
    """Compute analytics for a strategy from its trade history.

    Thin HTTP wrapper. All work lives in services.analytics_runner.
    run_strategy_analytics so the compute_jobs worker (services.job_worker.
    run_compute_analytics_job) can reuse the same implementation.
    """
    return await run_strategy_analytics(req.strategy_id)
