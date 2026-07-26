"""Weight-optimizer route (Phase 28, OPT-01 + OPT-02).

Thin HTTP transport over the pure `services.optimizer.optimize_weights`. Mounted
under `/api`, so `main.verify_service_key` already enforces the X-Service-Key
shared secret (service-to-service only — the Next.js allocator route is the sole
caller and it forwards only the authenticated allocator's own draft-scoped
series). Stateless: no DB, no migration. All math + the degeneracy gate live in
the pure service so they are unit-tested without HTTP (test_optimizer.py).

NOTE — DO NOT add ``from __future__ import annotations`` to this module. Under
PEP-563 stringification the BaseModel-typed ``req`` body hint is resolved
through slowapi's wrapper globals (where the model isn't defined), so the
pinned CI fastapi (0.115.x) misclassifies it as a query param → 422. The newer
local fastapi (0.135.x) unwraps correctly and hides the bug. Same gotcha
documented in routers/process_key.py.
"""

import logging
from functools import partial

from fastapi import APIRouter, Request

from models.schemas import OptimizeWeightsRequest, OptimizeWeightsResponse
from services.optimizer import optimize_weights
from services.rate_limit import limiter, tenant_or_platform_key

router = APIRouter(prefix="/api", tags=["optimizer"])
logger = logging.getLogger("quantalyze.analytics")


# PYAPI-03 / L-9 ⭐ — the `key_func=` here is the whole fix for this route, and it
# is the one the "three routers declare a private Limiter" framing MISSES: this
# module always imported the canonical limiter correctly and simply never
# overrode its key, so it inherited `get_remote_address` by OMISSION. Behind
# Railway's edge that is the proxy ip, making 20/MINUTE a platform-wide ceiling —
# the tightest number on the seam, and two concurrent Scenario Composer users
# could 429 each other on it (RESEARCH X-4 / TRAP-5, G-10/G-11).
#
# `partial` is safe: slowapi decides whether to pass the request by looking for a
# parameter literally named `request` on the key function
# (slowapi/extension.py `__evaluate_limits`), and partial preserves it.
@router.post("/optimize-weights")
@limiter.limit(
    "20/minute", key_func=partial(tenant_or_platform_key, scope="optimize_weights")
)
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
