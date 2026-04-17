"""
Sprint 6 Task 6.4: Portfolio impact simulator router.

POST /api/simulator — ADD-scenario simulation for a single candidate strategy
against a user's portfolio. Mirrors the Bridge V1 shape: user-scoped ownership
check at the service boundary, published-only candidate, allocator-safe
response (no profile data, no admin internals).

NOTE ON FILE LOCATION: The plan spec says `analytics-service/api/simulator.py`
but every existing router in this codebase lives in `analytics-service/routers/`.
Keeping the plan's path would split the convention for one endpoint and make
the main.py include list inconsistent. Placed in `routers/` to match the
existing pattern.

Rate limit: 20/hour (configured on the Next.js side as `simulatorLimiter`).
The FastAPI-level limit here is lower because the Next.js layer is the
authoritative user-level limit; this is only a safety net against an
uncapped direct call from another service.
"""

import logging

import pandas as pd
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from slowapi import Limiter
from slowapi.util import get_remote_address

from services.audit import log_audit_event
from services.db import get_supabase
from services.simulator_scoring import simulate_add_candidate

router = APIRouter(prefix="/api", tags=["simulator"])
logger = logging.getLogger("quantalyze.analytics")
limiter = Limiter(key_func=get_remote_address)


class SimulatorRequest(BaseModel):
    portfolio_id: str
    candidate_strategy_id: str
    user_id: str


def _records_to_series(raw: list | None, name: str = "") -> pd.Series | None:
    """Convert [{date, value}, ...] records to a DatetimeIndex pd.Series.

    Duplicates `routers.portfolio._records_to_series` — kept local so the
    simulator router doesn't cross-import from another router.
    """
    if not isinstance(raw, list) or not raw:
        return None
    dates = [r["date"] for r in raw]
    vals = [r["value"] for r in raw]
    return pd.Series(vals, index=pd.DatetimeIndex(dates), name=name)


@router.post("/simulator")
@limiter.limit("30/hour")
async def portfolio_simulator(request: Request, req: SimulatorRequest):
    """Simulate ADDing a candidate strategy to the user's portfolio.

    Returns Sharpe / MaxDD / correlation / concentration deltas plus the
    before/after equity-curve overlay series. The response is
    allocator-safe: no profile data, no admin internals.
    """
    supabase = get_supabase()

    # Defense-in-depth ownership check. The Next.js layer already validates
    # this, but the Python service uses a service-role client that bypasses
    # RLS — if the service were ever reachable from another path we still
    # want to enforce portfolio ownership here.
    portfolio_result = (
        supabase.table("portfolios")
        .select("id")
        .eq("id", req.portfolio_id)
        .eq("user_id", req.user_id)
        .single()
        .execute()
    )
    if not portfolio_result.data:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    # Reject candidates that aren't published — same guardrail as the
    # portfolio-optimizer + bridge endpoints.
    candidate_row = (
        supabase.table("strategies")
        .select("id, name, status")
        .eq("id", req.candidate_strategy_id)
        .eq("status", "published")
        .maybe_single()
        .execute()
    )
    if not candidate_row.data:
        raise HTTPException(
            status_code=404,
            detail="Candidate strategy not found or not published",
        )
    candidate_name = candidate_row.data.get("name") or req.candidate_strategy_id

    # Current portfolio composition + weights
    ps_result = (
        supabase.table("portfolio_strategies")
        .select("strategy_id, current_weight")
        .eq("portfolio_id", req.portfolio_id)
        .execute()
    )
    portfolio_strategies = ps_result.data or []
    if not portfolio_strategies:
        raise HTTPException(
            status_code=400,
            detail="No strategies found in portfolio",
        )

    # If the candidate is already in the portfolio, fail fast — the ADD
    # scenario is ill-defined. The scoring module also guards this, but
    # surfacing a 400 here keeps the UX message crisp.
    existing_ids = {row["strategy_id"] for row in portfolio_strategies}
    if req.candidate_strategy_id in existing_ids:
        raise HTTPException(
            status_code=400,
            detail="Candidate is already in this portfolio",
        )

    raw_weights = {
        row["strategy_id"]: (
            float(row["current_weight"]) if row.get("current_weight") else 1.0
        )
        for row in portfolio_strategies
    }
    total_w = sum(raw_weights.values()) or 1.0
    weights = {sid: w / total_w for sid, w in raw_weights.items()}

    # Fetch returns for portfolio strategies in one call
    portfolio_ids = list(existing_ids)
    sa_port_result = (
        supabase.table("strategy_analytics")
        .select("strategy_id, returns_series")
        .in_("strategy_id", portfolio_ids)
        .execute()
    )
    portfolio_returns: dict[str, pd.Series] = {}
    for row in (sa_port_result.data or []):
        s = _records_to_series(row.get("returns_series"), name=row["strategy_id"])
        if s is not None:
            portfolio_returns[row["strategy_id"]] = s

    if not portfolio_returns:
        raise HTTPException(
            status_code=400,
            detail="No returns data available for portfolio strategies",
        )

    # Fetch candidate returns
    sa_cand_result = (
        supabase.table("strategy_analytics")
        .select("strategy_id, returns_series")
        .eq("strategy_id", req.candidate_strategy_id)
        .maybe_single()
        .execute()
    )
    if not sa_cand_result.data:
        raise HTTPException(
            status_code=400,
            detail="No returns data available for the candidate",
        )
    candidate_series = _records_to_series(
        sa_cand_result.data.get("returns_series"),
        name=req.candidate_strategy_id,
    )
    if candidate_series is None:
        raise HTTPException(
            status_code=400,
            detail="Candidate has no returns history",
        )

    result = simulate_add_candidate(
        portfolio_returns=portfolio_returns,
        candidate_id=req.candidate_strategy_id,
        candidate_returns=candidate_series,
        weights=weights,
    )

    # Hydrate the response with the human-readable candidate name so the
    # UI can render it without a second round-trip.
    result["candidate_name"] = candidate_name
    result["portfolio_id"] = req.portfolio_id

    # Sprint 6 Task 7.1b — audit the simulator run. entity is the
    # portfolio the ADD scenario targeted; user_id carried in the
    # request shape (SimulatorRequest.user_id).
    log_audit_event(
        user_id=req.user_id,
        action="simulator.run",
        entity_type="simulator_run",
        entity_id=req.portfolio_id,
        metadata={"candidate_strategy_id": req.candidate_strategy_id},
    )

    return result
