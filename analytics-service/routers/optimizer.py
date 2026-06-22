"""Weight-optimizer route (Phase 28, OPT-01 + OPT-02).

Thin HTTP transport over the pure `services.optimizer.optimize_weights`. Mounted
under `/api`, so `main.verify_service_key` already enforces the X-Service-Key
shared secret (service-to-service only — the Next.js allocator route is the sole
caller and it forwards only the authenticated allocator's own draft-scoped
series). Stateless: no DB, no migration. All math + the degeneracy gate live in
the pure service so they are unit-tested without HTTP (test_optimizer.py).
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Request

from models.schemas import OptimizeWeightsRequest, OptimizeWeightsResponse
from services.optimizer import optimize_weights
from services.rate_limit import limiter

router = APIRouter(prefix="/api", tags=["optimizer"])
logger = logging.getLogger("quantalyze.analytics")


@router.post("/optimize-weights")
@limiter.limit("20/minute")
async def optimize_weights_endpoint(
    request: Request, req: OptimizeWeightsRequest
) -> OptimizeWeightsResponse:
    """Suggest long-only, fully-invested weights for the requested objective over
    the common-date overlap of the provided strategy series. Returns
    `weights: null` (ok=False) on a degenerate / under-sampled input — never a
    fabricated vector. `request` is required by the slowapi limiter decorator."""
    series = {
        sid: [(p.date, p.value) for p in points]
        for sid, points in req.series.items()
    }
    result = optimize_weights(series, req.objective)
    return OptimizeWeightsResponse(
        ok=result.ok,
        objective=result.objective,
        n=result.n,
        k=result.k,
        weights=result.weights,
        in_sample=result.in_sample,
        reason=result.reason,
    )
