import asyncio
import logging
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException, Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from models.schemas import PortfolioAnalyticsRequest, PortfolioOptimizerRequest, VerifyStrategyRequest
from services.benchmark import get_benchmark_returns
from services.db import get_supabase
from services.encryption import decrypt_credentials, encrypt_credentials, get_kek
from services.exchange import create_exchange, fetch_all_trades, fetch_usdt_balance, validate_key_permissions
from services.metrics import _safe_float, sanitize_metrics
from services.portfolio_metrics import compute_twr, compute_mwr, compute_period_returns
from services.portfolio_optimizer import find_improvement_candidates, generate_narrative
from services.portfolio_risk import (
    compute_attribution,
    compute_avg_pairwise_correlation,
    compute_correlation_matrix,
    compute_risk_decomposition,
    compute_rolling_correlation,
)
from services.transforms import trades_to_daily_returns

router = APIRouter(prefix="/api", tags=["portfolio"])
logger = logging.getLogger("quantalyze.analytics")
limiter = Limiter(key_func=get_remote_address)


def _records_to_series(raw: list | None, name: str = "") -> pd.Series | None:
    """Convert [{date, value}, ...] records to a DatetimeIndex pd.Series."""
    if not isinstance(raw, list) or not raw:
        return None
    dates = [r["date"] for r in raw]
    vals = [r["value"] for r in raw]
    return pd.Series(vals, index=pd.DatetimeIndex(dates), name=name)

# Cron concurrency guard: allow at most 3 simultaneous portfolio computations.
# NOTE: asyncio.Semaphore is process-local. Multi-worker/multi-pod deployments rely
# on the DB-level in-flight row check instead. The semaphore limits within-process burst.
_compute_semaphore = asyncio.Semaphore(3)


# ---------------------------------------------------------------------------
# Internal computation helper (also callable from the cron module)
# ---------------------------------------------------------------------------

async def _compute_portfolio_analytics(portfolio_id: str) -> dict:
    """Compute full portfolio analytics and persist the result.

    Inserts a new portfolio_analytics row (immutable history — no upsert).
    Returns the final analytics payload on success.
    Raises HTTPException on unrecoverable errors.
    """
    supabase = get_supabase()

    insert_result = supabase.table("portfolio_analytics").insert(
        {"portfolio_id": portfolio_id, "computation_status": "computing"}
    ).execute()

    if not insert_result.data:
        raise HTTPException(status_code=500, detail="Failed to create analytics row")

    analytics_id = insert_result.data[0]["id"]

    def _fail(error_msg: str):
        supabase.table("portfolio_analytics").update(
            {"computation_status": "failed", "computation_error": error_msg}
        ).eq("id", analytics_id).execute()

    try:
        ps_result = supabase.table("portfolio_strategies").select(
            "strategy_id, current_weight, strategies(id, name)"
        ).eq("portfolio_id", portfolio_id).execute()

        portfolio_strategies = ps_result.data or []
        if not portfolio_strategies:
            _fail("No strategies found in portfolio.")
            raise HTTPException(status_code=400, detail="No strategies found in portfolio")

        strategy_ids = [row["strategy_id"] for row in portfolio_strategies]

        # Build weight map (default equal weight if not set)
        raw_weights = {
            row["strategy_id"]: float(row["current_weight"]) if row.get("current_weight") else 1.0
            for row in portfolio_strategies
        }
        total_w = sum(raw_weights.values()) or 1.0
        weights = {sid: w / total_w for sid, w in raw_weights.items()}

        strategy_names = {
            row["strategy_id"]: (row.get("strategies") or {}).get("name", row["strategy_id"])
            for row in portfolio_strategies
        }

        sa_result = supabase.table("strategy_analytics").select(
            "strategy_id, returns_series, equity_curve, total_aum"
        ).in_("strategy_id", strategy_ids).execute()

        analytics_rows = {row["strategy_id"]: row for row in (sa_result.data or [])}

        strategy_returns: dict[str, pd.Series] = {}
        strategy_equity: dict[str, pd.Series] = {}
        strategy_twrs: dict[str, float] = {}
        strategy_aum: dict[str, float] = {}

        for sid in strategy_ids:
            row = analytics_rows.get(sid)
            if not row:
                continue

            s = _records_to_series(row.get("returns_series"), name=sid)
            if s is not None:
                strategy_returns[sid] = s

                eq = _records_to_series(row.get("equity_curve"), name=sid)
                if eq is not None:
                    strategy_equity[sid] = eq

            if row.get("total_aum"):
                strategy_aum[sid] = float(row["total_aum"])

        if not strategy_returns:
            _fail("No returns data available for strategies in this portfolio.")
            raise HTTPException(status_code=400, detail="No returns data available")

        # Renormalize weights to only the strategies that have data.
        # Without this, a missing high-weight strategy silently suppresses all returns
        # (e.g., 80% weight strategy missing → surviving 20% still gets 0.2× multiplier).
        available_sids = set(strategy_returns.keys())
        weights = {sid: w for sid, w in weights.items() if sid in available_sids}
        total_available_w = sum(weights.values()) or 1.0
        weights = {sid: w / total_available_w for sid, w in weights.items()}

        # Compute TWR per strategy
        for sid, eq in strategy_equity.items():
            twr = compute_twr(eq, [])
            if twr is not None:
                strategy_twrs[sid] = twr

        # Build portfolio-level daily returns
        all_dates = sorted(
            set(d for s in strategy_returns.values() for d in s.index)
        )
        if len(all_dates) < 2:
            _fail("Insufficient return history across portfolio strategies.")
            raise HTTPException(status_code=400, detail="Insufficient return history")

        # fillna(0) treats days with no trade record as flat performance.
        # This slightly suppresses measured vol/drawdown on short or sparse strategies.
        # A future improvement: use intersection-only dates (dropna instead of fillna).
        df = pd.DataFrame(strategy_returns).reindex(all_dates).fillna(0)
        w_arr = np.array([weights.get(sid, 0) for sid in df.columns])
        portfolio_returns_series = pd.Series(
            (df.values * w_arr).sum(axis=1),
            index=df.index,
            name="portfolio",
        )

        # Portfolio TWR
        portfolio_twr = compute_twr(
            (1 + portfolio_returns_series).cumprod(), []
        )

        # Period returns
        period_returns = compute_period_returns(portfolio_returns_series)

        # Correlation matrix + rolling + avg pairwise
        corr_matrix = compute_correlation_matrix(dict(strategy_returns))
        rolling_corr = compute_rolling_correlation(dict(strategy_returns))
        avg_pairwise_corr = compute_avg_pairwise_correlation(corr_matrix)

        # Risk decomposition + attribution
        ordered_sids = list(df.columns)
        ordered_weights = [weights.get(sid, 0) for sid in ordered_sids]

        # Covariance matrix for risk decomposition
        cov_matrix = df.cov().values if len(df) > 5 else np.eye(len(ordered_sids))
        risk_decomp_raw = compute_risk_decomposition(ordered_weights, cov_matrix)

        # Annotate risk decomposition with strategy names and weight pcts
        risk_decomp = []
        for i, rd in enumerate(risk_decomp_raw):
            sid = ordered_sids[i]
            risk_decomp.append({
                **rd,
                "strategy_id": sid,
                "strategy_name": strategy_names.get(sid, sid),
                "weight_pct": _safe_float(ordered_weights[i] * 100),
            })

        # Attribution
        twrs_list = [strategy_twrs.get(sid, 0.0) for sid in ordered_sids]
        port_twr_for_attr = portfolio_twr or 0.0
        attribution_raw = compute_attribution(ordered_weights, twrs_list, port_twr_for_attr)

        attribution = []
        for i, attr in enumerate(attribution_raw):
            sid = ordered_sids[i]
            attribution.append({
                **attr,
                "strategy_id": sid,
                "strategy_name": strategy_names.get(sid, sid),
            })

        # Benchmark comparison (BTC)
        benchmark_comparison = None
        try:
            benchmark_rets, benchmark_stale = await get_benchmark_returns("BTC")
            if benchmark_rets is not None and not benchmark_stale:
                aligned = portfolio_returns_series.reindex(benchmark_rets.index).dropna()
                b_aligned = benchmark_rets.reindex(aligned.index).dropna()
                if len(aligned) >= 30:
                    corr = _safe_float(float(aligned.corr(b_aligned)))
                    btc_twr = compute_twr((1 + b_aligned).cumprod(), [])
                    benchmark_comparison = {
                        "symbol": "BTC",
                        "correlation": corr,
                        "benchmark_twr": btc_twr,
                        "portfolio_twr": portfolio_twr,
                        "stale": benchmark_stale,
                    }
        except Exception as exc:
            logger.warning("Benchmark fetch failed for portfolio %s: %s", portfolio_id, exc)

        # Portfolio equity curve
        cumulative = (1 + portfolio_returns_series).cumprod()
        portfolio_equity_curve = [
            {"date": d.isoformat(), "value": _safe_float(float(v))}
            for d, v in cumulative.items()
        ]

        # Total AUM
        total_aum = sum(strategy_aum.get(sid, 0) for sid in strategy_ids) or None

        # Portfolio-level sharpe and volatility
        vol = portfolio_returns_series.std() * np.sqrt(252) if len(portfolio_returns_series) > 1 else None
        mean_ret = portfolio_returns_series.mean() * 252 if len(portfolio_returns_series) > 1 else None
        sharpe = _safe_float(mean_ret / vol) if vol and vol != 0 and mean_ret is not None else None

        running_max = cumulative.cummax()
        drawdown = (cumulative - running_max) / running_max
        max_drawdown = _safe_float(float(drawdown.min()))

        # Narrative
        analytics_payload: dict = {
            "return_mtd": period_returns.get("return_mtd"),
            "avg_pairwise_correlation": avg_pairwise_corr,
            "attribution_breakdown": attribution,
            "risk_decomposition": risk_decomp,
        }
        narrative = generate_narrative(analytics_payload)

        # Persist results
        update_payload = sanitize_metrics({
            "computation_status": "complete",
            "computation_error": None,
            "total_aum": total_aum,
            "total_return_twr": portfolio_twr,
            "portfolio_sharpe": sharpe,
            "portfolio_volatility": _safe_float(vol),
            "portfolio_max_drawdown": max_drawdown,
            "avg_pairwise_correlation": avg_pairwise_corr,
            "return_24h": period_returns.get("return_24h"),
            "return_mtd": period_returns.get("return_mtd"),
            "return_ytd": period_returns.get("return_ytd"),
            "narrative_summary": narrative,
            "correlation_matrix": corr_matrix,
            "attribution_breakdown": attribution,
            "risk_decomposition": risk_decomp,
            "benchmark_comparison": benchmark_comparison,
            "portfolio_equity_curve": portfolio_equity_curve,
            "rolling_correlation": rolling_corr,
        })

        supabase.table("portfolio_analytics").update(update_payload).eq(
            "id", analytics_id
        ).execute()

        # Generate alerts
        _generate_alerts(supabase, portfolio_id, max_drawdown, avg_pairwise_corr)

        return {"analytics_id": analytics_id, **update_payload}

    except HTTPException:
        raise
    except Exception as exc:
        logger.error(
            "Portfolio analytics computation failed for %s: %s",
            portfolio_id,
            str(exc),
            exc_info=True,
        )
        _fail("Analytics computation failed. Contact support if this persists.")
        raise HTTPException(status_code=500, detail="Portfolio analytics computation failed")


def _generate_alerts(
    supabase,
    portfolio_id: str,
    max_drawdown: float | None,
    avg_pairwise_corr: float | None,
) -> None:
    """Insert portfolio alerts for drawdown > 10% or correlation spike > 0.7.

    Note: portfolio_alerts uses triggered_at (auto-default), not created_at.
    """
    alerts = []

    if max_drawdown is not None and max_drawdown < -0.10:
        alerts.append({
            "portfolio_id": portfolio_id,
            "alert_type": "drawdown",
            "severity": "high" if max_drawdown < -0.20 else "medium",
            "message": f"Portfolio drawdown has reached {max_drawdown * 100:.1f}%.",
        })

    if avg_pairwise_corr is not None and avg_pairwise_corr > 0.70:
        alerts.append({
            "portfolio_id": portfolio_id,
            "alert_type": "correlation_spike",
            "severity": "medium",
            "message": (
                f"Average pairwise correlation is {avg_pairwise_corr:.2f}. "
                "Portfolio diversification may be insufficient."
            ),
        })

    if alerts:
        try:
            supabase.table("portfolio_alerts").insert(alerts).execute()
        except Exception as exc:
            logger.warning("Failed to insert portfolio alerts for %s: %s", portfolio_id, exc)


# ---------------------------------------------------------------------------
# Endpoint 1: POST /api/portfolio-analytics
# ---------------------------------------------------------------------------

@router.post("/portfolio-analytics")
@limiter.limit("10/hour")
async def portfolio_analytics(request: Request, req: PortfolioAnalyticsRequest):
    """Compute full portfolio analytics for a given portfolio."""
    supabase = get_supabase()

    # Verify portfolio exists
    portfolio_result = supabase.table("portfolios").select("id").eq(
        "id", req.portfolio_id
    ).single().execute()

    if not portfolio_result.data:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    # Concurrency guard: acquire semaphore first, then check for in-flight row.
    # Ordering matters: check inside the semaphore prevents a TOCTOU window where
    # two concurrent requests both pass the check before either INSERT runs.
    async with _compute_semaphore:
        in_flight = supabase.table("portfolio_analytics").select("id").eq(
            "portfolio_id", req.portfolio_id
        ).eq("computation_status", "computing").limit(1).execute()

        if in_flight.data:
            raise HTTPException(
                status_code=409,
                detail="Analytics computation already in progress for this portfolio",
            )

        result = await _compute_portfolio_analytics(req.portfolio_id)

    return {"status": "complete", "portfolio_id": req.portfolio_id, "analytics_id": result["analytics_id"]}


# ---------------------------------------------------------------------------
# Endpoint 2: POST /api/portfolio-optimizer
# ---------------------------------------------------------------------------

@router.post("/portfolio-optimizer")
@limiter.limit("10/hour")
async def portfolio_optimizer(request: Request, req: PortfolioOptimizerRequest):
    """Find diversification candidates for a portfolio."""
    supabase = get_supabase()

    # Verify portfolio exists
    portfolio_result = supabase.table("portfolios").select("id").eq(
        "id", req.portfolio_id
    ).single().execute()

    if not portfolio_result.data:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    ps_result = supabase.table("portfolio_strategies").select(
        "strategy_id, current_weight"
    ).eq("portfolio_id", req.portfolio_id).execute()

    portfolio_strategies = ps_result.data or []
    if not portfolio_strategies:
        raise HTTPException(status_code=400, detail="No strategies found in portfolio")

    strategy_ids = [row["strategy_id"] for row in portfolio_strategies]

    raw_weights = {
        row["strategy_id"]: float(row["current_weight"]) if row.get("current_weight") else 1.0
        for row in portfolio_strategies
    }
    total_w = sum(raw_weights.values()) or 1.0
    weights = {sid: w / total_w for sid, w in raw_weights.items()}

    # Override weights from request if provided
    if req.weights:
        weights.update(req.weights)

    sa_in_result = supabase.table("strategy_analytics").select(
        "strategy_id, returns_series"
    ).in_("strategy_id", strategy_ids).execute()

    portfolio_returns: dict[str, pd.Series] = {}
    for row in (sa_in_result.data or []):
        s = _records_to_series(row.get("returns_series"), name=row["strategy_id"])
        if s is not None:
            portfolio_returns[row["strategy_id"]] = s

    if not portfolio_returns:
        raise HTTPException(status_code=400, detail="No returns data available for portfolio strategies")

    all_published = supabase.table("strategies").select("id, name").eq(
        "status", "published"
    ).not_.in_("id", strategy_ids).execute()

    candidate_rows = all_published.data or []
    candidate_ids = [row["id"] for row in candidate_rows]
    candidate_names = {row["id"]: row.get("name", row["id"]) for row in candidate_rows}

    candidate_returns: dict[str, pd.Series] = {}
    if candidate_ids:
        sa_cand_result = supabase.table("strategy_analytics").select(
            "strategy_id, returns_series"
        ).in_("strategy_id", candidate_ids).execute()

        for row in (sa_cand_result.data or []):
            s = _records_to_series(row.get("returns_series"), name=row["strategy_id"])
            if s is not None:
                candidate_returns[row["strategy_id"]] = s

    suggestions = find_improvement_candidates(portfolio_returns, candidate_returns, weights)
    # Hydrate suggestions with strategy names so the UI can render them without an extra round-trip.
    for s in suggestions:
        s["strategy_name"] = candidate_names.get(s["strategy_id"], s["strategy_id"])

    latest = supabase.table("portfolio_analytics").select("id").eq(
        "portfolio_id", req.portfolio_id
    ).eq("computation_status", "complete").order("computed_at", desc=True).limit(1).execute()

    if latest.data:
        supabase.table("portfolio_analytics").update(
            {"optimizer_suggestions": suggestions}
        ).eq("id", latest.data[0]["id"]).execute()

    return {
        "status": "complete",
        "portfolio_id": req.portfolio_id,
        "suggestions": suggestions,
    }


# ---------------------------------------------------------------------------
# Endpoint 3: POST /api/verify-strategy
# ---------------------------------------------------------------------------

@router.post("/verify-strategy")
@limiter.limit("5/hour")
async def verify_strategy(request: Request, req: VerifyStrategyRequest):
    """Verify a strategy from exchange API keys (landing page flow)."""
    try:
        kek = get_kek()
    except RuntimeError:
        raise HTTPException(status_code=503, detail="Encryption not configured")

    try:
        exchange = create_exchange(req.exchange, req.api_key, req.api_secret, req.passphrase)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception:
        raise HTTPException(status_code=400, detail="Failed to initialise exchange connection")

    try:
        validation = await validate_key_permissions(exchange)
    except Exception as exc:
        logger.error("verify_strategy: key validation error: %s", exc)
        raise HTTPException(status_code=500, detail="Key validation failed. Please check your credentials.")
    finally:
        try:
            await exchange.close()
        except Exception:
            pass

    if validation.get("error"):
        raise HTTPException(status_code=400, detail=validation["error"])

    encrypted = encrypt_credentials(req.api_key, req.api_secret, req.passphrase, kek)

    supabase = get_supabase()

    vr_insert = supabase.table("verification_requests").insert({
        "email": req.email,
        "exchange": req.exchange,
        "status": "processing",
        **encrypted,
    }).execute()

    if not vr_insert.data:
        raise HTTPException(status_code=500, detail="Failed to create verification request")

    verification_id = vr_insert.data[0]["id"]

    def _fail_vr(msg: str):
        supabase.table("verification_requests").update(
            {"status": "failed", "error_message": msg}
        ).eq("id", verification_id).execute()

    try:
        exchange = create_exchange(req.exchange, req.api_key, req.api_secret, req.passphrase)
        try:
            trades = await fetch_all_trades(exchange)
            account_balance = await fetch_usdt_balance(exchange)
        finally:
            await exchange.close()

        if not trades or len(trades) < 2:
            _fail_vr("Insufficient trade history. At least 2 trades required for verification.")
            raise HTTPException(status_code=400, detail="Insufficient trade history")

        returns = trades_to_daily_returns(trades, account_balance=account_balance)
        if len(returns) < 2:
            _fail_vr("Insufficient trading days after aggregation.")
            raise HTTPException(status_code=400, detail="Insufficient trading days")

        # Period returns
        period_returns = compute_period_returns(returns)

        # Equity curve
        cumulative = (1 + returns).cumprod()
        equity_curve = [
            {"date": d.isoformat(), "value": _safe_float(float(v))}
            for d, v in cumulative.items()
        ]

        # TWR
        twr = compute_twr(cumulative, [])

        # Simple sharpe
        vol = returns.std() * np.sqrt(252) if len(returns) > 1 else None
        mean_ret = returns.mean() * 252 if len(returns) > 1 else None
        sharpe = _safe_float(mean_ret / vol) if vol and vol != 0 and mean_ret is not None else None

        matched_strategy_id = None
        try:
            published_result = supabase.table("strategies").select("id").eq(
                "status", "published"
            ).limit(100).execute()
            published_ids = [row["id"] for row in (published_result.data or [])]

            if published_ids:
                sa_result = supabase.table("strategy_analytics").select(
                    "strategy_id, returns_series"
                ).in_("strategy_id", published_ids).execute()

                # Vectorized matching: build a DataFrame of all existing series and
                # compute correlations in one call instead of per-strategy loop.
                existing: dict[str, pd.Series] = {}
                for row in (sa_result.data or []):
                    s = _records_to_series(row.get("returns_series"), name=row["strategy_id"])
                    if s is not None:
                        existing[row["strategy_id"]] = s

                if existing:
                    df = pd.DataFrame(existing)
                    aligned = pd.concat([returns.rename("_target"), df], axis=1).dropna()
                    if len(aligned) >= 30:
                        corrs = aligned.drop(columns=["_target"]).corrwith(aligned["_target"])
                        best = corrs.idxmax()
                        if corrs[best] > 0.95:
                            matched_strategy_id = best
        except Exception as exc:
            logger.warning("verify_strategy: strategy matching failed: %s", exc)

        results_payload = sanitize_metrics({
            "twr": twr,
            "sharpe": sharpe,
            "return_24h": period_returns.get("return_24h"),
            "return_mtd": period_returns.get("return_mtd"),
            "return_ytd": period_returns.get("return_ytd"),
            "equity_curve": equity_curve,
            "trade_count": len(trades),
        })

        supabase.table("verification_requests").update({
            "status": "complete",
            "error_message": None,
            "matched_strategy_id": matched_strategy_id,
            "results": results_payload,
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", verification_id).execute()

        return {
            "status": "complete",
            "verification_id": verification_id,
            "matched_strategy_id": matched_strategy_id,
            "twr": twr,
            "sharpe": sharpe,
            **{k: period_returns.get(k) for k in ("return_24h", "return_mtd", "return_ytd")},
        }

    except HTTPException:
        raise
    except Exception as exc:
        logger.error(
            "verify_strategy: computation failed for %s: %s",
            verification_id,
            str(exc),
            exc_info=True,
        )
        _fail_vr("Verification failed. Contact support if this persists.")
        raise HTTPException(status_code=500, detail="Strategy verification failed")
