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

import asyncio
import logging
import time
from typing import Any

import pandas as pd
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from slowapi.util import get_remote_address

from services.audit import log_audit_event
from services.db import get_supabase, one, rows
from services.portfolio_limits import assert_portfolio_within_cap
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

    S1 (red-team MED8) follow-up: this IP-keyed decorator is now only the
    process-wide CEILING backstop. The EFFECTIVE per-tenant quota is enforced
    in-handler against ``req.user_id`` (see ``_check_simulator_user_rate`` and
    its call in ``portfolio_simulator``) — slowapi's key_func cannot see the
    parsed request body, so per-user keying must live in the handler. ``user_id``
    is set server-side by Next.js from the authenticated session and only the
    Next.js front door reaches this route (X-Service-Key trust boundary), so it
    is non-spoofable here — unlike the rejected ``X-User-Id`` header above.
    """
    return f"simulator:ip:{get_remote_address(request)}"


# S1 (red-team MED8): per-USER sliding-window rate limit for /api/simulator.
#
# The @limiter.limit("20/hour") decorator below keys on remote IP, but behind
# Vercel's egress NAT every tenant collapses into ONE shared bucket — the first
# few users each hour exhaust the 20/hour ceiling and everyone else 429s
# (effective platform-wide 20/hour). slowapi's key_func only sees the Request,
# not the parsed body, so the per-user quota cannot be expressed in the
# decorator. We enforce it IN-HANDLER against ``req.user_id`` instead, mirroring
# routers/portfolio.py's ``_check_sliding_window_rate`` pattern. The decorator
# stays as a coarse per-IP ceiling backstop; the per-user check is the
# authoritative per-tenant quota.
#
# In-process only (not distributed-safe across workers); the Next.js front-door
# Upstash limiter remains the cross-worker authority. Bound on distinct users
# tracked so the dict can't grow unbounded; LRU-ish eviction via insertion-order
# re-insertion (same as the portfolio limiter).
_SIMULATOR_USER_RATE_LIMIT = 20          # match the 20/hour front-door ceiling
_SIMULATOR_USER_RATE_WINDOW_SEC = 3600   # 1 hour
_SIMULATOR_USER_CACHE_MAX = 10_000
_simulator_user_attempts: dict[str, list[float]] = {}


def _check_simulator_user_rate(user_id: str | None) -> bool:
    """Return True if ``user_id`` is under the per-user simulator budget.

    Sliding-window check with LRU-bounded cache, keyed on the request-body
    ``user_id`` (server-set by Next.js, non-spoofable behind the X-Service-Key
    boundary). Returning False means the caller must reject with HTTP 429 even
    though the IP-based slowapi ceiling let the request through. Uses wall clock
    (``time.time()``) so timestamps stay comparable; the cache itself is
    in-process and resets on worker recycle (see the in-process-only note above).
    Prunes expired timestamps + records the current attempt on the under-budget branch.

    A missing user_id passes through as True; SimulatorRequest already enforces
    ``user_id`` min_length=1 so this is defensive only.
    """
    if not user_id:
        return True
    now = time.time()
    cutoff = now - _SIMULATOR_USER_RATE_WINDOW_SEC
    bucket = [t for t in _simulator_user_attempts.get(user_id, []) if t >= cutoff]
    if len(bucket) >= _SIMULATOR_USER_RATE_LIMIT:
        # Refresh LRU position even on reject so a rate-limited user can't be
        # evicted by a wave of fresh callers and silently regain quota (same
        # red-team hardening as routers/portfolio._check_sliding_window_rate).
        _simulator_user_attempts.pop(user_id, None)
        _simulator_user_attempts[user_id] = bucket
        while len(_simulator_user_attempts) > _SIMULATOR_USER_CACHE_MAX:
            oldest = next(iter(_simulator_user_attempts))
            _simulator_user_attempts.pop(oldest, None)
        return False
    bucket.append(now)
    _simulator_user_attempts.pop(user_id, None)
    _simulator_user_attempts[user_id] = bucket
    while len(_simulator_user_attempts) > _SIMULATOR_USER_CACHE_MAX:
        oldest = next(iter(_simulator_user_attempts))
        _simulator_user_attempts.pop(oldest, None)
    return True


class SimulatorRequest(BaseModel):
    # G15-010 (audit-2026-05-07, M-0974): mirror the TS contract
    # (src/lib/api/simulatorSchema.ts — `z.string().min(1)`). Bare `str`
    # let an empty-string id parse and fall through to a Supabase no-rows
    # query (a silent 404 instead of a clear 422). `min_length=1` rejects
    # empty / NULL-byte-only payloads at the Pydantic boundary with a
    # structured 422. UUID-format validation stays upstream (Next.js
    # layer) per the documented trust boundary — the DB-layer 404 is the
    # surface this router owns.
    portfolio_id: str = Field(min_length=1)
    candidate_strategy_id: str = Field(min_length=1)
    user_id: str = Field(min_length=1)


def _records_to_series(raw: list[Any] | None, name: str = "") -> pd.Series | None:
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

    G15-008/G15-009 (audit-2026-05-07, M-0975/M-0976): tolerate malformed
    records. ``returns_series`` is JSONB written by the analytics worker;
    a single row missing ``date`` or ``value`` (legacy schema, partial
    backfill, manual SQL fixup) previously raised KeyError in the list
    comprehension, propagating up through ``portfolio_simulator`` as an
    unhandled 500 — taking down the simulator for any portfolio that
    contained one corrupted strategy row. We now skip malformed entries,
    warn once, and return None when nothing usable remains so the router
    falls into its "No returns data available" 400 path with a clear
    message instead of a 500. Mirrors the hardened
    ``routers.portfolio._records_to_series``.
    """
    if not isinstance(raw, list) or not raw:
        return None

    dates: list[Any] = []
    vals: list[Any] = []
    skipped = 0
    for r in raw:
        if not isinstance(r, dict):
            skipped += 1
            continue
        d = r.get("date")
        v = r.get("value")
        if d is None or v is None:
            skipped += 1
            continue
        dates.append(d)
        vals.append(v)

    if skipped:
        logger.warning(
            "_records_to_series: skipped %d malformed records for %s",
            skipped, name or "<unnamed>",
        )

    if not dates:
        return None

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
async def portfolio_simulator(request: Request, req: SimulatorRequest) -> dict[str, Any]:
    """Simulate ADDing a candidate strategy to the user's portfolio.

    Returns Sharpe / MaxDD / correlation / concentration deltas plus the
    before/after equity-curve overlay series. The response is
    allocator-safe: no profile data, no admin internals.
    """
    # S1 (red-team MED8): per-USER quota. The @limiter.limit decorator keys on
    # remote IP, which collapses every tenant behind Vercel's NAT into one
    # shared 20/hour bucket. Enforce the real per-tenant limit here against the
    # server-set ``req.user_id`` (the key_func cannot see the parsed body). One
    # user exhausting their quota must NOT 429 another user on the same IP.
    if not _check_simulator_user_rate(req.user_id):
        raise HTTPException(
            status_code=429,
            detail=(
                "Simulator rate limit exceeded "
                f"({_SIMULATOR_USER_RATE_LIMIT}/hour per user) — please retry later"
            ),
        )

    supabase = get_supabase()

    # G15-012 (audit-2026-05-07, M-0973): the first three reads —
    # (1) portfolio ownership, (2) candidate published-check, and
    # (3) portfolio_strategies composition — have NO inter-dependencies
    # (none consumes another's result), so they ran ~90-180ms of serial
    # Supabase RTT on every call. Fan them out with asyncio.gather over
    # asyncio.to_thread (the supabase-py client is SYNC — calling
    # `.execute()` directly would block the event loop; to_thread offloads
    # it, matching routers/match.py's pattern). The results are checked in
    # the SAME order as before so the 404/400 error PRECEDENCE is
    # unchanged (portfolio 404 wins over candidate 404 wins over empty-
    # portfolio 400) — the parallelism is purely a latency win, not a
    # contract change.
    portfolio_result, candidate_row, ps_result = await asyncio.gather(
        asyncio.to_thread(
            lambda: supabase.table("portfolios")
            .select("id")
            .eq("id", req.portfolio_id)
            .eq("user_id", req.user_id)
            .single()
            .execute()
        ),
        asyncio.to_thread(
            lambda: supabase.table("strategies")
            .select("id, name, status")
            .eq("id", req.candidate_strategy_id)
            .eq("status", "published")
            .maybe_single()
            .execute()
        ),
        asyncio.to_thread(
            lambda: supabase.table("portfolio_strategies")
            .select("strategy_id, current_weight")
            .eq("portfolio_id", req.portfolio_id)
            .execute()
        ),
    )

    portfolio_row = one(portfolio_result)
    candidate = one(candidate_row)

    # Defense-in-depth ownership check. The Next.js layer already validates
    # this, but the Python service uses a service-role client that bypasses
    # RLS — if the service were ever reachable from another path we still
    # want to enforce portfolio ownership here.
    if not portfolio_row:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    # Reject candidates that aren't published — same guardrail as the
    # portfolio-optimizer + bridge endpoints.
    if not candidate:
        raise HTTPException(
            status_code=404,
            detail="Candidate strategy not found or not published",
        )
    candidate_name = candidate.get("name") or req.candidate_strategy_id

    # Current portfolio composition + weights
    portfolio_strategies = rows(ps_result)
    if not portfolio_strategies:
        raise HTTPException(
            status_code=400,
            detail="No strategies found in portfolio",
        )
    # NEW-C19-07: the simulator is a 4th OWN-membership O(N^2) path —
    # simulate_add_candidate builds an (N+1)-column DataFrame and runs df.corr()
    # (_avg_corr) over OWN membership, under asyncio.to_thread WITHOUT the
    # _compute_semaphore. Cap N before the returns map + correlation matmul.
    assert_portfolio_within_cap(portfolio_strategies)

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

    # G15-011 (audit-2026-05-07, M-0972): fetch returns for the portfolio
    # strategies AND the candidate in ONE strategy_analytics query instead
    # of two round-trips to the same table on the same connection. Split
    # the result locally by strategy_id. Both target the same table — a
    # single `.in_(portfolio_ids + [candidate_id])` saves one full RTT
    # (~30-80ms) on every successful run.
    portfolio_ids = list(existing_ids)
    sa_result = await asyncio.to_thread(
        lambda: supabase.table("strategy_analytics")
        .select("strategy_id, returns_series")
        .in_("strategy_id", portfolio_ids + [req.candidate_strategy_id])
        .execute()
    )
    # Index the rows by strategy_id so we can split portfolio vs candidate
    # without a second query. `candidate_row_present` distinguishes the two
    # candidate-failure messages preserved below: a wholly-MISSING analytics
    # row ("No returns data available for the candidate") vs a row that
    # EXISTS but has empty/None returns_series ("Candidate has no returns
    # history"). Folding into the IN query would otherwise collapse those
    # two branches — the existing tests assert both distinctly.
    rows_by_id: dict[str, dict[str, Any]] = {}
    candidate_row_present = False
    for row in rows(sa_result):
        sid = row.get("strategy_id")
        if sid is None:
            continue
        rows_by_id[sid] = row
        if sid == req.candidate_strategy_id:
            candidate_row_present = True

    portfolio_returns: dict[str, pd.Series] = {}
    for sid in existing_ids:
        sa_row = rows_by_id.get(sid)
        if sa_row is None:
            continue
        s = _records_to_series(sa_row.get("returns_series"), name=sid)
        if s is not None:
            portfolio_returns[sid] = s

    if not portfolio_returns:
        raise HTTPException(
            status_code=400,
            detail="No returns data available for portfolio strategies",
        )

    # Candidate returns — split out of the same result set.
    if not candidate_row_present:
        raise HTTPException(
            status_code=400,
            detail="No returns data available for the candidate",
        )
    candidate_series = _records_to_series(
        rows_by_id[req.candidate_strategy_id].get("returns_series"),
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
    # H-0815 (final): wrap the happy-path emit. log_audit_event already
    # Sentry-captures + logs the serious classes (permission_denied / unknown)
    # before re-raising (audit.py P907/P908), so swallowing here does NOT hide
    # the regression from ops — it only prevents one audit-path failure from
    # 500-ing every successful simulation. Matches job_worker._emit_audit. (The
    # failure-path emit above is also wrapped, additionally so an audit failure
    # there cannot mask the original raised exception.)
    try:
        log_audit_event(
            user_id=req.user_id,
            action="simulator.run",
            entity_type="simulator_run",
            entity_id=req.portfolio_id,
            metadata={"candidate_strategy_id": req.candidate_strategy_id},
        )
    except Exception as audit_exc:  # noqa: BLE001
        logger.error(
            "simulator run audit emit failed (run still succeeded): %s",
            audit_exc, exc_info=True,
        )

    return result
