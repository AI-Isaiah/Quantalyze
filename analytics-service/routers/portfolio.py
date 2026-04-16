import asyncio
import logging
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
from fastapi import APIRouter, HTTPException, Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from models.schemas import BridgeRequest, PortfolioAnalyticsRequest, PortfolioOptimizerRequest, VerifyStrategyRequest
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

        # Narrative — pass enriched payload for monthly breakdown + optimizer sentence
        analytics_payload: dict = {
            "return_mtd": period_returns.get("return_mtd"),
            "avg_pairwise_correlation": avg_pairwise_corr,
            "attribution_breakdown": attribution,
            "risk_decomposition": risk_decomp,
            "portfolio_sharpe": sharpe,
        }

        # Attempt to add monthly returns for per-month narrative breakdown.
        # Monthly returns are computed per-strategy in strategy_analytics; for the
        # portfolio-level narrative we build a weighted monthly return from the
        # daily portfolio returns series.
        try:
            monthly_returns: dict[str, dict[str, float]] = {}
            for d, v in portfolio_returns_series.items():
                year_str = str(d.year) if hasattr(d, "year") else str(d)[:4]
                month_str = str(d.month).zfill(2) if hasattr(d, "month") else str(d)[5:7]
                monthly_returns.setdefault(year_str, {}).setdefault(month_str, 1.0)
                monthly_returns[year_str][month_str] *= (1 + float(v))
            # Convert cumulative to period returns
            for year_str in monthly_returns:
                for month_str in monthly_returns[year_str]:
                    monthly_returns[year_str][month_str] -= 1.0
            analytics_payload["monthly_returns"] = monthly_returns
        except Exception:
            pass  # Monthly breakdown is best-effort

        # Attach optimizer suggestions from last completed analytics (if any)
        try:
            prev_analytics = supabase.table("portfolio_analytics").select(
                "optimizer_suggestions"
            ).eq("portfolio_id", portfolio_id).eq(
                "computation_status", "complete"
            ).order("computed_at", desc=True).limit(1).execute()
            if prev_analytics.data and prev_analytics.data[0].get("optimizer_suggestions"):
                analytics_payload["optimizer_suggestions"] = prev_analytics.data[0]["optimizer_suggestions"]
        except Exception:
            pass  # Optimizer sentence is best-effort

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
        _generate_alerts(
            supabase,
            portfolio_id,
            max_drawdown,
            avg_pairwise_corr,
            rolling_corr=rolling_corr,
            attribution=attribution,
            risk_decomp=risk_decomp,
        )

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
    rolling_corr: dict | None = None,
    attribution: list | None = None,
    risk_decomp: list | None = None,
    strategy_returns: dict | None = None,
) -> None:
    """Insert portfolio alerts for threshold breaches.

    Original rules: drawdown > 10%, correlation spike > 0.7.
    Sprint 4 additions: regime_shift, underperformance, concentration_creep.
    Sprint 5 addition: rebalance_drift (Task 5.4) with its own select-then-
    insert path because dedup is per (portfolio, strategy, UTC-week) rather
    than per (portfolio, alert_type).

    Uses select-then-insert per alert type. The partial unique index
    `portfolio_alerts_dedup_unacked` (migration 042, carved in 050 to
    exclude rebalance_drift) and the concurrent weekly index
    `portfolio_alerts_rebalance_drift_weekly` (migration 051) act as
    DB-level safety nets for any races.

    NOTE: `sync_failure` alerts are NOT generated here. They are inserted
    by `run_reconcile_strategy_job` in services/job_worker.py, which has
    the reconciliation diff in hand and knows which portfolios hold the
    affected strategy. See Sprint 5 Task 5.1b and migration 046.
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

    # ── Sprint 4: regime_shift ──────────────────────────────────────
    # Fires when the rolling correlation delta between the most recent and
    # prior window exceeds 0.15 for any strategy pair.
    if rolling_corr:
        window = 5
        best_delta = 0.0
        best_recent = 0.0
        best_prior = 0.0
        for series in rolling_corr.values():
            if not isinstance(series, list) or len(series) < window * 2:
                continue
            recent_vals = [p["value"] if isinstance(p, dict) else p for p in series[-window:]]
            prior_vals = [p["value"] if isinstance(p, dict) else p for p in series[-window * 2:-window]]
            recent_avg = sum(recent_vals) / len(recent_vals)
            prior_avg = sum(prior_vals) / len(prior_vals)
            delta = abs(recent_avg - prior_avg)
            if delta > best_delta:
                best_delta = delta
                best_recent = recent_avg
                best_prior = prior_avg
        if best_delta > 0.15:
            direction = "tightened" if best_recent > best_prior else "loosened"
            alerts.append({
                "portfolio_id": portfolio_id,
                "alert_type": "regime_shift",
                "severity": "medium",
                "message": (
                    f"Correlation regime shift detected: pairwise correlation "
                    f"{direction} from {best_prior:.2f} to {best_recent:.2f} (delta {best_delta:.2f})."
                ),
            })

    # ── Sprint 4: underperformance ──────────────────────────────────
    # Fires when the worst strategy trails the portfolio average contribution
    # by more than 1 standalone-vol band.
    if attribution and risk_decomp and len(attribution) >= 2:
        vol_by_sid = {r["strategy_id"]: r.get("standalone_vol", 0) for r in risk_decomp}
        avg_contribution = sum(a.get("contribution", 0) for a in attribution) / len(attribution)
        sorted_attr = sorted(attribution, key=lambda a: a.get("contribution", 0))
        worst = sorted_attr[0]
        band = vol_by_sid.get(worst.get("strategy_id", ""), 0.01)
        threshold = band if band > 0 else 0.01
        trail_distance = avg_contribution - worst.get("contribution", 0)
        if trail_distance > threshold:
            second = sorted_attr[1] if len(sorted_attr) > 1 else None
            if not second or (second.get("contribution", 0) - worst.get("contribution", 0)) >= 0.005:
                alerts.append({
                    "portfolio_id": portfolio_id,
                    "alert_type": "underperformance",
                    "severity": "medium",
                    "message": (
                        f"{worst.get('strategy_name', 'Unknown')} is trailing the portfolio "
                        f"baseline by {abs(trail_distance) * 100:.2f}% over the trailing window."
                    ),
                })

    # ── Sprint 4: concentration_creep ───────────────────────────────
    # Fires when any strategy weight exceeds 1.5x the equal-weight baseline
    # (only meaningful with 3+ strategies).
    if risk_decomp and len(risk_decomp) >= 3:
        equal_weight = 100.0 / len(risk_decomp)
        top = max(risk_decomp, key=lambda r: r.get("weight_pct", 0))
        if top.get("weight_pct", 0) >= equal_weight * 1.5:
            alerts.append({
                "portfolio_id": portfolio_id,
                "alert_type": "concentration_creep",
                "severity": "low",
                "message": (
                    f"{top.get('strategy_name', 'Unknown')} is {top['weight_pct']:.0f}% "
                    f"of the portfolio (equal-weight baseline is {equal_weight:.0f}%)."
                ),
            })

    if alerts:
        # Insert each alert individually, skipping if an unacknowledged alert
        # of the same type already exists. PostgREST's upsert cannot reference
        # the partial unique index (WHERE acknowledged_at IS NULL), so we do a
        # select-then-insert per type. The partial unique index in migration 042
        # serves as a DB-level safety net for any race conditions.
        for alert in alerts:
            try:
                existing = supabase.table("portfolio_alerts").select("id").eq(
                    "portfolio_id", alert["portfolio_id"]
                ).eq(
                    "alert_type", alert["alert_type"]
                ).is_(
                    "acknowledged_at", "null"
                ).limit(1).execute()
                if existing.data:
                    continue  # Already have an unacknowledged alert of this type
                supabase.table("portfolio_alerts").insert(alert).execute()
            except Exception as exc:
                logger.warning(
                    "Failed to insert %s alert for %s: %s",
                    alert.get("alert_type"), portfolio_id, exc,
                )

    # ── Sprint 5 Task 5.4: rebalance_drift ─────────────────────────────
    # Handled on its own because dedup is weekly per (portfolio, strategy),
    # not per (portfolio, alert_type). Kept AFTER the generic loop so a
    # Supabase failure in this block can't starve the other alerts.
    _generate_rebalance_drift_alert(supabase, portfolio_id)


def _generate_rebalance_drift_alert(supabase, portfolio_id: str) -> None:
    """Fire a rebalance_drift alert for the strategy with the largest drift > 5%.

    Two-layer safety against alert storms:
      1. Honeymoon: skip when portfolio age < 7 days.
      2. Null-target guard: skip strategies whose latest weight_snapshots
         target_weight is NULL. NULL is explicit ("not yet set"), not 0.

    Weekly dedup: at most one unacked alert per (portfolio, strategy, UTC
    week). Enforced in the query below and defended at the DB layer by
    the partial unique index from migration 051.

    Severity: drift > 10% → high; 5-10% → medium.

    Swallows all exceptions — alert generation is best-effort; a failure
    here must NOT break the analytics write that already succeeded above.
    """
    try:
        # Portfolio age → honeymoon guard
        portfolio_row = supabase.table("portfolios").select(
            "created_at"
        ).eq("id", portfolio_id).single().execute()
        if not portfolio_row.data:
            return
        created_at_str = portfolio_row.data.get("created_at")
        if not created_at_str:
            return
        created_at = datetime.fromisoformat(created_at_str.replace("Z", "+00:00"))
        age_days = (datetime.now(timezone.utc) - created_at).days
        if age_days < 7:
            return

        # Latest weight_snapshots row per strategy for this portfolio
        ws_rows = supabase.table("weight_snapshots").select(
            "strategy_id, target_weight, actual_weight, snapshot_date"
        ).eq("portfolio_id", portfolio_id).order(
            "snapshot_date", desc=True
        ).execute()
        if not ws_rows.data:
            return

        # Keep most recent per strategy. Rows come back ordered DESC.
        seen: set[str] = set()
        latest: list[dict] = []
        for row in ws_rows.data:
            sid = row.get("strategy_id")
            if sid in seen:
                continue
            seen.add(sid)
            latest.append(row)

        # Strategy names for the sentence
        strategy_ids = [row["strategy_id"] for row in latest]
        strat_rows = supabase.table("strategies").select(
            "id, name"
        ).in_("id", strategy_ids).execute()
        name_by_id = {
            r["id"]: r.get("name") or r["id"] for r in (strat_rows.data or [])
        }

        # Find worst-drift strategy with both values present
        worst: dict | None = None
        for row in latest:
            target = row.get("target_weight")
            actual = row.get("actual_weight")
            if target is None or actual is None:
                continue
            drift = abs(float(actual) - float(target))
            if worst is None or drift > worst["drift"]:
                worst = {
                    "strategy_id": row["strategy_id"],
                    "target": float(target),
                    "actual": float(actual),
                    "drift": drift,
                }

        if worst is None or worst["drift"] <= 0.05:
            return

        # Weekly dedup check: any unacked rebalance_drift for this
        # (portfolio, strategy) inside the current UTC ISO week?
        # Postgres `date_trunc('week', ...)` starts Monday 00:00 UTC.
        now = datetime.now(timezone.utc)
        # ISO week: Monday is weekday()==0
        week_start = (now - timedelta(days=now.weekday())).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        existing = supabase.table("portfolio_alerts").select("id").eq(
            "portfolio_id", portfolio_id
        ).eq(
            "strategy_id", worst["strategy_id"]
        ).eq(
            "alert_type", "rebalance_drift"
        ).is_(
            "acknowledged_at", "null"
        ).gte(
            "triggered_at", week_start.isoformat()
        ).limit(1).execute()
        if existing.data:
            return

        severity = "high" if worst["drift"] > 0.10 else "medium"
        strategy_name = name_by_id.get(worst["strategy_id"], worst["strategy_id"])
        message = (
            f"{strategy_name}'s weight is {worst['actual'] * 100:.0f}% "
            f"(target {worst['target'] * 100:.0f}%) — consider rebalancing."
        )

        try:
            supabase.table("portfolio_alerts").insert({
                "portfolio_id": portfolio_id,
                "strategy_id": worst["strategy_id"],
                "alert_type": "rebalance_drift",
                "severity": severity,
                "message": message,
                "metadata": {
                    "target_weight": worst["target"],
                    "actual_weight": worst["actual"],
                    "drift": worst["drift"],
                },
            }).execute()
        except Exception as exc:
            # The DB-side weekly unique index (migration 051) is the
            # authoritative race guard. A unique_violation here means
            # a concurrent writer won — silently skip.
            logger.warning(
                "Failed to insert rebalance_drift alert for %s: %s",
                portfolio_id, exc,
            )
    except Exception as exc:
        logger.warning(
            "rebalance_drift alert generation failed for %s: %s",
            portfolio_id, exc,
        )


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
# Endpoint 3: POST /api/portfolio-bridge
# ---------------------------------------------------------------------------

@router.post("/portfolio-bridge")
@limiter.limit("10/hour")
async def portfolio_bridge(request: Request, req: BridgeRequest):
    """Find replacement candidates for an underperforming strategy (Bridge V1).

    Uses REPLACE scoring: removes the incumbent, redistributes its weight,
    and scores each published candidate in that slot. Returns allocator-safe
    payload (no admin internals, no profile data).
    """
    from services.bridge_scoring import find_replacement_candidates

    supabase = get_supabase()

    # Verify portfolio exists AND belongs to the requesting user.
    # Defense-in-depth: Next.js layer already checks ownership, but the Python
    # service uses a service-role client that bypasses RLS. This closes the gap
    # if the service is ever reachable from another path.
    portfolio_result = supabase.table("portfolios").select("id").eq(
        "id", req.portfolio_id
    ).eq("user_id", req.user_id).single().execute()
    if not portfolio_result.data:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    # Verify the underperformer is actually in this portfolio
    ps_result = supabase.table("portfolio_strategies").select(
        "strategy_id, current_weight"
    ).eq("portfolio_id", req.portfolio_id).execute()

    portfolio_strategies = ps_result.data or []
    strategy_ids = [row["strategy_id"] for row in portfolio_strategies]

    if req.underperformer_strategy_id not in strategy_ids:
        raise HTTPException(
            status_code=400,
            detail="Strategy not found in this portfolio",
        )

    # Build weights
    raw_weights = {
        row["strategy_id"]: float(row["current_weight"]) if row.get("current_weight") else 1.0
        for row in portfolio_strategies
    }
    total_w = sum(raw_weights.values()) or 1.0
    weights = {sid: w / total_w for sid, w in raw_weights.items()}

    # Fetch portfolio strategy returns
    sa_in_result = supabase.table("strategy_analytics").select(
        "strategy_id, returns_series"
    ).in_("strategy_id", strategy_ids).execute()

    portfolio_returns: dict[str, pd.Series] = {}
    for row in (sa_in_result.data or []):
        s = _records_to_series(row.get("returns_series"), name=row["strategy_id"])
        if s is not None:
            portfolio_returns[row["strategy_id"]] = s

    if not portfolio_returns:
        raise HTTPException(status_code=400, detail="No returns data available")

    # Fetch all published candidate strategies (excluding portfolio members)
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

    if not candidate_returns:
        return {
            "status": "complete",
            "portfolio_id": req.portfolio_id,
            "underperformer_strategy_id": req.underperformer_strategy_id,
            "candidates": [],
        }

    candidates = find_replacement_candidates(
        portfolio_returns, candidate_returns, weights, req.underperformer_strategy_id
    )

    # Hydrate with strategy names (allocator-safe, no emails/profiles)
    for c in candidates:
        c["strategy_name"] = candidate_names.get(c["strategy_id"], c["strategy_id"])

    return {
        "status": "complete",
        "portfolio_id": req.portfolio_id,
        "underperformer_strategy_id": req.underperformer_strategy_id,
        "candidates": candidates,
    }


# ---------------------------------------------------------------------------
# Endpoint 4: POST /api/verify-strategy
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
