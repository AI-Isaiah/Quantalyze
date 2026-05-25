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

Rate limit: 20/hour, user-keyed (matches `simulatorLimiter` on the Next.js
side). The FastAPI-level limit matches the Next.js front-door ceiling so
a legitimate user who clears the front door cannot be 429'd by the
defense-in-depth limiter here. The key function reads `X-User-Id`
(forwarded by the Next.js handler) and falls back to the remote address
only when the header is absent (direct-from-elsewhere callers).

G15-005 (audit-2026-05-07): previously decorated with a 30/hour ceiling
keyed by `get_remote_address`. Behind Vercel's egress NAT every tenant
collapsed into one shared bucket — first-mover starvation. Per-user
keying mirrors routers/process_key.py:_process_key_rate_limit_key.
"""

import logging

import pandas as pd
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from slowapi.util import get_remote_address

from services.audit import log_audit_event
from services.db import get_supabase
from services.rate_limit import limiter
from services.simulator_scoring import simulate_add_candidate

router = APIRouter(prefix="/api", tags=["simulator"])
logger = logging.getLogger("quantalyze.analytics")

# G15-004 (audit-2026-05-07) — use the canonical process-wide Limiter
# from services.rate_limit (NOT a local instance) so the route's storage
# shares state with `app.state.limiter` registered in main.py. The
# previous local `Limiter(key_func=get_remote_address)` broke the API-5
# shared-storage invariant (per services/rate_limit.py module docstring):
# slowapi resolves rate-limit storage via the DECORATOR's Limiter
# instance, not app.state.limiter — so a future swap to Redis-backed
# storage on the shared limiter would have silently skipped this route.


def _simulator_rate_limit_key(request: Request) -> str:
    """Rate-limit key for /api/simulator.

    Keyed on remote IP. The pre-fix shape preferred an `X-User-Id` header
    forwarded by the Next.js front door for per-user buckets, but a
    PR #241 follow-up red-team turned up two problems with that path:

      1. `src/lib/analytics-client.ts` never actually forwards the
         header to FastAPI — so production traffic was already falling
         through to the IP path. The per-user keying was effectively
         dead code.
      2. A direct-to-FastAPI attacker holding the SERVICE_KEY could set
         `X-User-Id: <random-uuid-per-request>` and allocate a brand-new
         20/hour bucket on every request, bypassing the limiter entirely.

    The cleanest fix is to drop the header read so the spoof surface
    disappears. The downside — shared-NAT users still share a window —
    is a regression to the pre-G15-005 state, but the per-user surface
    didn't exist in production anyway. A proper per-user bucket would
    require an internal-signed `X-User-Id` (e.g., signed via
    INTERNAL_API_TOKEN) so the header is non-spoofable; that's a
    follow-up. Mirrors the same fix in
    routers/process_key.py:_process_key_rate_limit_key.
    """
    return f"simulator:ip:{get_remote_address(request)}"


class SimulatorRequest(BaseModel):
    portfolio_id: str
    candidate_strategy_id: str
    user_id: str


def _records_to_series(raw: list | None, name: str = "") -> pd.Series | None:
    """Convert [{date, value}, ...] records to a DatetimeIndex pd.Series.

    Duplicates `routers.portfolio._records_to_series` — kept local so the
    simulator router doesn't cross-import from another router.

    G15-006 (audit-2026-05-07): the returned Series is `.sort_index()`-ed
    and deduped (keep='last') so storage drift — duplicate-date backfill
    writes or out-of-order imports — cannot silently break the downstream
    `cumprod()` in `services/simulator_scoring.py:634`. cumprod is path-
    dependent; an unsorted index produces a garbage equity curve, and a
    duplicate index entry inflates the compounded factor for that date.
    These guards exist for storage-drift safety, not for the happy-path.
    """
    if not isinstance(raw, list) or not raw:
        return None
    dates = [r["date"] for r in raw]
    vals = [r["value"] for r in raw]
    series = pd.Series(vals, index=pd.DatetimeIndex(dates), name=name)
    # G15-006 — sort then dedupe (keep='last'). Order matters: dedupe BEFORE
    # sort would keep the last-by-input occurrence rather than the
    # last-by-date occurrence; in practice the two coincide on a well-formed
    # input but the contract is "last value on a given date wins" — which
    # only holds after sort.
    series = series.sort_index()
    series = series[~series.index.duplicated(keep="last")]
    return series


@router.post("/simulator")
@limiter.limit("20/hour", key_func=_simulator_rate_limit_key)
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

    # G15-007 (audit-2026-05-07) — wrap the math call in try/except so a
    # numpy/pandas blow-up is observable (audit_log + structured log line
    # tagged with the correlation_id) instead of escaping as a bare 500
    # with no trail. Mirrors the portfolio-router exception handling
    # pattern. Re-raised as HTTPException so the response carries the
    # correlation_id in the detail object — operators can join the wire-
    # level 500 to the analytics-service log by that id.
    correlation_id = request.headers.get("x-correlation-id") or ""
    try:
        result = simulate_add_candidate(
            portfolio_returns=portfolio_returns,
            candidate_id=req.candidate_strategy_id,
            candidate_returns=candidate_series,
            weights=weights,
        )
    except Exception as exc:
        logger.exception(
            "simulate_add_candidate failed (portfolio_id=%s candidate=%s "
            "correlation_id=%s): %s",
            req.portfolio_id,
            req.candidate_strategy_id,
            correlation_id,
            exc,
        )
        # Fire an audit row so operators can reconstruct WHO triggered
        # the failure from audit_log alone (the structured log has the
        # exception detail; the audit row has the user/entity context).
        try:
            log_audit_event(
                user_id=req.user_id,
                action="simulator.run.failed",
                entity_type="simulator_run",
                entity_id=req.portfolio_id,
                metadata={
                    "candidate_strategy_id": req.candidate_strategy_id,
                    "error_type": type(exc).__name__,
                    "error_message": str(exc)[:400],
                    "correlation_id": correlation_id,
                },
            )
        except Exception as audit_exc:
            # Don't let an audit-emit failure mask the original error.
            logger.error(
                "simulator failure audit emit failed: %s",
                audit_exc,
                exc_info=True,
            )
        raise HTTPException(
            status_code=500,
            detail={
                "error": "Portfolio impact simulation failed",
                "correlation_id": correlation_id,
            },
        )

    # Hydrate the response with the human-readable candidate name so the
    # UI can render it without a second round-trip.
    result["candidate_name"] = candidate_name
    result["portfolio_id"] = req.portfolio_id

    # Sprint 6 Task 7.1b — audit the simulator run. entity is the
    # portfolio the ADD scenario targeted; user_id carried in the
    # request shape (SimulatorRequest.user_id).
    # H-0815 (re-resolved): emit UNWRAPPED. log_audit_event's P907/P908 typed
    # dispatch already swallows transient httpx blips and deliberately
    # re-raises permission_denied + unknown errors (fail-loud, hard error). A
    # blanket except here would re-bury those serious errors behind a 200
    # successful run — defeating the emitter contract. The failure-path emit
    # above IS wrapped, for a different reason: there it must not mask the
    # original exception being raised; on the happy path there is none to mask.
    log_audit_event(
        user_id=req.user_id,
        action="simulator.run",
        entity_type="simulator_run",
        entity_id=req.portfolio_id,
        metadata={"candidate_strategy_id": req.candidate_strategy_id},
    )

    return result
