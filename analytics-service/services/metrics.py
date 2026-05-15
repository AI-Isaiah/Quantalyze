import logging
import quantstats as qs
import pandas as pd
import numpy as np
import math
from dataclasses import dataclass, field
from typing import Any

from .transforms import downsample_series, cap_data_points

logger = logging.getLogger("quantalyze.analytics.metrics")


# Phase 12 / Pitfall 11: minimum acceptable return for Sortino.
# Single source of truth: `qs.stats.sortino(returns)` (which uses MAR=0 by default)
# AND `_rolling_sortino` MUST share this constant. Cross-runtime parity is gated
# by the `test_rolling_sortino_converges_to_scalar_at_full_window` test, which
# asserts the rolling helper at window == period agrees with the scalar to within 0.05.
MAR: float = 0.0


@dataclass
class MetricsResult:
    """Phase 12 / METRICS-11/12: split storage between strategy_analytics.metrics_json
    (light scalars + above-the-fold series) and strategy_analytics_series sibling table
    (heavy series keyed by kind). See D-01 / D-02 for split rules.

    Attributes
    ----------
    metrics_json: top-level dict spread into the strategy_analytics table upsert.
        Contains all existing qstats scalars + 10 new qstats scalars (merged into
        its inner "metrics_json" JSONB sub-dict) + above-the-fold series
        (returns_series, drawdown_series, sparklines, monthly_returns,
        rolling_metrics, return_quantiles).
    sibling_kinds: dict keyed by sibling-table `kind`. analytics_runner upserts
        each kind into strategy_analytics_series via the
        `upsert_strategy_analytics_series_batch` SECURITY DEFINER RPC (M-Grok-1
        atomic batch). 12 kinds total — 10 produced here in compute_all_metrics
        (daily_returns_grid, rolling_sortino_3m/6m/12m, rolling_volatility_3m/6m/12m,
        rolling_alpha, rolling_beta, log_returns_series); the runner adds 2 more
        (exposure_series, turnover_series) since they need position_snapshots data.

    `__getitem__` proxies to `metrics_json` for backward compat with existing
    test sites that subscripted the old bare-dict return shape (test_metrics.py,
    test_accuracy.py). New consumers should use attribute access directly.
    """

    metrics_json: dict[str, Any] = field(default_factory=dict)
    sibling_kinds: dict[str, Any] = field(default_factory=dict)

    def __getitem__(self, key: str) -> Any:
        # Backward-compat shim: old callers expected a bare dict; proxy
        # subscript access to metrics_json so legacy tests still work.
        return self.metrics_json[key]

    def __contains__(self, key: str) -> bool:
        return key in self.metrics_json

    def get(self, key: str, default: Any = None) -> Any:
        return self.metrics_json.get(key, default)

    def items(self):
        return self.metrics_json.items()

    def keys(self):
        return self.metrics_json.keys()

    def values(self):
        return self.metrics_json.values()


def _safe_float(value: Any) -> float | None:
    """Convert to float, returning None for NaN/Inf values."""
    try:
        f = float(value)
        if math.isnan(f) or math.isinf(f):
            return None
        return f
    except (TypeError, ValueError):
        return None


def sanitize_metrics(data: dict[str, Any]) -> dict[str, Any]:
    """Replace NaN/Inf with None in all numeric values before Supabase upsert."""
    result = {}
    for key, value in data.items():
        if isinstance(value, float):
            result[key] = _safe_float(value)
        elif isinstance(value, dict):
            result[key] = sanitize_metrics(value)
        elif isinstance(value, list):
            result[key] = [
                sanitize_metrics(item) if isinstance(item, dict)
                else _safe_float(item) if isinstance(item, (int, float)) and not isinstance(item, bool)
                else item
                for item in value
            ]
        else:
            result[key] = value
    return result


def compute_all_metrics(
    returns: pd.Series,
    benchmark_returns: pd.Series | None = None,
) -> "MetricsResult":
    """Compute all analytics from a daily returns series.

    Phase 12: returns a `MetricsResult` dataclass (NOT a bare dict) split per D-01/D-02:

    - `result.metrics_json`: spread into the `strategy_analytics` table upsert.
      Carries all existing qstats scalars (top-level cumulative_return, cagr, sharpe, ...)
      + 10 new qstats scalars (merged into the inner `metrics_json` JSONB sub-dict
      via `compute_qstats_scalars`).
    - `result.sibling_kinds`: dict {kind: payload} for the 10 sibling kinds emitted
      from this function (daily_returns_grid, rolling_sortino_3m/6m/12m,
      rolling_volatility_3m/6m/12m, rolling_alpha, rolling_beta, log_returns_series).
      analytics_runner appends 2 more (exposure_series, turnover_series) before the
      atomic batch upsert via `upsert_strategy_analytics_series_batch` RPC.

    Backward-compat: `MetricsResult.__getitem__` proxies to `.metrics_json` so
    legacy `result["sharpe"]` access still works for tests that have not yet
    been migrated to attribute access.
    """
    if len(returns) < 2:
        raise ValueError("Insufficient trade history. At least 2 trading days required.")

    # Core metrics (safe_float handles NaN/Inf from quantstats)
    cumulative = (1 + returns).cumprod()
    total_return = _safe_float(cumulative.iloc[-1] - 1)
    cagr = _safe_float(qs.stats.cagr(returns))
    volatility = _safe_float(qs.stats.volatility(returns))
    sharpe = _safe_float(qs.stats.sharpe(returns))
    sortino = _safe_float(qs.stats.sortino(returns))
    calmar = _safe_float(qs.stats.calmar(returns))
    max_dd = _safe_float(qs.stats.max_drawdown(returns))

    # Drawdown series
    dd_series = qs.stats.to_drawdown_series(returns)
    dd_duration = _max_dd_duration(dd_series)

    # Monthly returns (computed once, reused for grid + best/worst + VaR)
    monthly_rets = returns.resample("ME").apply(lambda x: (1 + x).prod() - 1)
    monthly = _monthly_returns_grid_from_series(monthly_rets)

    # Rolling metrics
    rolling = {
        "sharpe_30d": _rolling_sharpe(returns, 30),
        "sharpe_90d": _rolling_sharpe(returns, 90),
        "sharpe_365d": _rolling_sharpe(returns, 365),
    }

    # Return quantiles
    quantiles = _return_quantiles(returns)

    # Equity curve + drawdown as time series
    returns_series = [
        {"date": d.strftime("%Y-%m-%d"), "value": float(v)}
        for d, v in cumulative.items()
    ]
    drawdown_series = [
        {"date": d.strftime("%Y-%m-%d"), "value": float(v)}
        for d, v in dd_series.items()
    ]

    # Sparklines (downsampled)
    sparkline_returns = downsample_series(returns_series, 90)
    sparkline_drawdown = downsample_series(drawdown_series, 90)

    # Cap data points
    returns_series = cap_data_points(returns_series)
    drawdown_series = cap_data_points(drawdown_series)

    # Six month return
    six_month = _safe_float(returns.tail(126).add(1).prod() - 1) if len(returns) >= 126 else None

    # Extended metrics
    metrics_json: dict[str, Any] = {}
    try:
        metrics_json["var_1d_95"] = _safe_float(qs.stats.value_at_risk(returns, cutoff=0.05))
    except Exception:
        pass
    try:
        metrics_json["cvar"] = _safe_float(qs.stats.cvar(returns))
    except Exception:
        pass

    metrics_json["mtd"] = _safe_float(returns[returns.index >= pd.Timestamp(returns.index[-1].replace(day=1))].add(1).prod() - 1)
    metrics_json["ytd"] = _safe_float(returns[returns.index >= pd.Timestamp(f"{returns.index[-1].year}-01-01")].add(1).prod() - 1)
    metrics_json["best_day"] = _safe_float(returns.max())
    metrics_json["worst_day"] = _safe_float(returns.min())
    metrics_json["three_month"] = _safe_float(returns.tail(63).add(1).prod() - 1) if len(returns) >= 63 else None

    if len(monthly_rets) > 0:
        metrics_json["best_month"] = _safe_float(monthly_rets.max())
        metrics_json["worst_month"] = _safe_float(monthly_rets.min())

    # Additional risk metrics
    try:
        if len(monthly_rets) > 0:
            metrics_json["var_1m_99"] = _safe_float(np.percentile(monthly_rets, 1))
    except Exception:
        pass
    try:
        metrics_json["gini"] = _safe_float(qs.stats.gini(returns))
    except Exception:
        pass
    try:
        metrics_json["omega"] = _safe_float(qs.stats.omega(returns))
    except Exception:
        pass
    try:
        metrics_json["gain_pain"] = _safe_float(qs.stats.gain_to_pain_ratio(returns))
    except Exception:
        pass
    try:
        metrics_json["tail_ratio"] = _safe_float(qs.stats.tail_ratio(returns))
    except Exception:
        pass

    # Distribution metrics
    try:
        metrics_json["skewness"] = _safe_float(returns.skew())
    except Exception:
        pass
    try:
        metrics_json["kurtosis"] = _safe_float(returns.kurtosis())
    except Exception:
        pass
    try:
        metrics_json["smart_sharpe"] = _safe_float(qs.stats.smart_sharpe(returns))
    except Exception:
        pass
    try:
        metrics_json["smart_sortino"] = _safe_float(qs.stats.smart_sortino(returns))
    except Exception:
        pass

    # Win/Loss metrics
    wins = returns[returns > 0]
    losses = returns[returns < 0]
    if len(wins) > 0:
        metrics_json["avg_win"] = _safe_float(wins.mean())
    if len(losses) > 0:
        metrics_json["avg_loss"] = _safe_float(losses.mean())
    if len(losses) > 0 and len(wins) > 0:
        metrics_json["win_loss_ratio"] = _safe_float(len(wins) / len(losses))
        avg_loss_abs = abs(float(losses.mean()))
        if avg_loss_abs > 0:
            metrics_json["payoff_ratio"] = _safe_float(wins.mean() / avg_loss_abs)
    try:
        metrics_json["profit_factor"] = _safe_float(qs.stats.profit_factor(returns))
    except Exception:
        pass

    # Risk of Ruin (Cox-Miller approximation)
    if len(wins) > 0 and len(losses) > 0:
        total_trades = len(wins) + len(losses)
        wr = len(wins) / total_trades
        avg_loss_abs_rr = abs(float(losses.mean()))
        pr = float(wins.mean()) / avg_loss_abs_rr if avg_loss_abs_rr > 0 else 0.0
        avg_size = float(returns.abs().mean())
        if avg_size > 0:
            metrics_json["risk_of_ruin"] = compute_risk_of_ruin(wr, pr, avg_size)

    # Consecutive streaks
    is_positive = (returns > 0).astype(int)
    streaks = is_positive.groupby((is_positive != is_positive.shift()).cumsum())
    win_streaks = streaks.sum()
    loss_streaks = (~is_positive.astype(bool)).astype(int).groupby(
        (is_positive != is_positive.shift()).cumsum()
    ).sum()
    metrics_json["consecutive_wins"] = int(win_streaks.max()) if len(win_streaks) > 0 else 0
    metrics_json["consecutive_losses"] = int(loss_streaks.max()) if len(loss_streaks) > 0 else 0

    # Top drawdown episodes (peak -> trough -> recovery with depth + duration).
    # Note: qs.stats.drawdown_details expects the drawdown series (underwater curve),
    # not the returns series. Its output has columns ['start', 'valley', 'end',
    # 'days', 'max drawdown', ...] where `max drawdown` is a NEGATIVE percentage
    # (e.g. -12.5 means -12.5%) and start/valley/end are date strings (dtype=object).
    # Ongoing drawdowns are encoded as `end == last date` with dd_series.iloc[-1] < 0
    # (quantstats does NOT use NaN for ongoing episodes).
    try:
        details = qs.stats.drawdown_details(dd_series)
        if details is not None and len(details) > 0:
            # quantstats reports `max drawdown` as a NEGATIVE percentage;
            # sort by absolute value to get deepest-first.
            top = (
                details.assign(_abs_dd=details["max drawdown"].abs())
                .sort_values("_abs_dd", ascending=False)
                .head(5)
            )
            # Compare via datetime.date to be tz-agnostic. `returns.index` may be
            # tz-aware while quantstats-parsed `end` is tz-naive (or vice versa);
            # subtracting mixed Timestamps raises and gets swallowed by the outer
            # except, silently dropping the whole field. .date() sidesteps that.
            last_date_date = pd.Timestamp(returns.index[-1]).date()
            still_underwater = bool(float(dd_series.iloc[-1]) < 0)
            episodes: list[dict[str, Any]] = []
            for _, row in top.iterrows():
                start_date = pd.Timestamp(row["start"]).date()
                valley_date = pd.Timestamp(row["valley"]).date()
                end_date = pd.Timestamp(row["end"]).date()
                # Ongoing if this episode's end matches the last returns date and
                # the underwater curve is still below zero at that last date.
                is_current = still_underwater and end_date >= last_date_date
                recovery_date = None if is_current else end_date.strftime("%Y-%m-%d")
                # Duration: peak -> recovery (or peak -> last returns date if ongoing)
                effective_end = last_date_date if is_current else end_date
                duration_days = int((effective_end - start_date).days)
                episodes.append({
                    "peak_date": start_date.strftime("%Y-%m-%d"),
                    "trough_date": valley_date.strftime("%Y-%m-%d"),
                    "recovery_date": recovery_date,
                    "depth_pct": _safe_float(row["max drawdown"] / 100.0),
                    "duration_days": duration_days,
                    "is_current": bool(is_current),
                })
            metrics_json["drawdown_episodes"] = episodes
    except Exception as exc:  # noqa: BLE001
        # audit-2026-05-07 G11.E.1: replaced bare `except: pass` with structured
        # logging + a `drawdown_episodes_error` flag so the frontend can render
        # 'Drawdown episodes unavailable due to compute error' instead of silently
        # falling back to lower-fidelity client-side segmentation.
        logger.warning(
            "drawdown_episodes computation failed (returns_len=%s): %s",
            len(returns) if returns is not None else None,
            exc,
            exc_info=True,
        )
        metrics_json["drawdown_episodes_error"] = str(exc)[:200]

    # Outlier ratios
    try:
        mean_ret = float(returns.mean())
        std_ret = float(returns.std())
        if std_ret > 0:
            outlier_threshold = 2 * std_ret
            metrics_json["outlier_win_ratio"] = _safe_float((returns > mean_ret + outlier_threshold).mean())
            metrics_json["outlier_loss_ratio"] = _safe_float((returns < mean_ret - outlier_threshold).mean())
    except Exception:
        pass

    # Benchmark metrics (single greeks() call for alpha + beta)
    if benchmark_returns is not None and len(benchmark_returns) > 0:
        try:
            greeks = qs.stats.greeks(returns, benchmark_returns)
            metrics_json["alpha"] = _safe_float(greeks.get("alpha", 0))
            metrics_json["beta"] = _safe_float(greeks.get("beta", 0))
            aligned = returns.align(benchmark_returns, join="inner")
            if len(aligned[0]) > 1:
                metrics_json["correlation"] = _safe_float(aligned[0].corr(aligned[1]))
                excess = aligned[0] - aligned[1]
                te = float(excess.std() * np.sqrt(252))
                if te > 0:
                    metrics_json["info_ratio"] = _safe_float(excess.mean() * 252 / te)
                beta = metrics_json.get("beta", 0)
                if beta and beta != 0 and cagr is not None:
                    metrics_json["treynor"] = _safe_float(cagr / beta)
            if len(aligned[0]) >= 90:
                metrics_json["btc_rolling_correlation_90d"] = _rolling_correlation(aligned[0], aligned[1], 90)
        except Exception as exc:  # noqa: BLE001
            # audit-2026-05-07 G11.E.2: this `try` historically wrapped the entire
            # benchmark-metrics fan-out (greeks/alpha/beta/correlation/info_ratio/
            # treynor/btc_rolling_correlation_90d). One failure silently dropped ALL
            # of them. Log the exception with context so a regression in any of
            # those helpers surfaces in Railway logs instead of making the Risk
            # tab render "Insufficient data" forever.
            logger.warning(
                "benchmark_metrics fan-out failed (returns_len=%s, benchmark_len=%s): %s",
                len(returns) if returns is not None else None,
                len(benchmark_returns) if benchmark_returns is not None else None,
                exc,
                exc_info=True,
            )
            metrics_json["benchmark_metrics_error"] = str(exc)[:200]

        # Store benchmark cumulative returns series aligned to strategy dates
        try:
            strat_start = returns.index.min()
            strat_end = returns.index.max()
            bm_slice = benchmark_returns[(benchmark_returns.index >= strat_start) & (benchmark_returns.index <= strat_end)]
            if len(bm_slice) > 0:
                bm_cumulative = (1 + bm_slice).cumprod()
                metrics_json["benchmark_returns"] = [
                    {"date": d.strftime("%Y-%m-%d"), "value": round(float(v), 6)}
                    for d, v in bm_cumulative.items()
                ]
        except Exception as exc:  # noqa: BLE001
            # audit-2026-05-07 G11.E.3: silently dropping benchmark_returns also
            # kills the client-side correlation fallback in
            # CorrelationWithBenchmark.tsx. Log + emit an error flag so the
            # frontend can surface "Benchmark data unavailable due to compute
            # error" instead of the indistinguishable "no benchmark assigned"
            # empty state.
            logger.warning(
                "benchmark_returns serialization failed (returns_len=%s, benchmark_len=%s): %s",
                len(returns) if returns is not None else None,
                len(benchmark_returns) if benchmark_returns is not None else None,
                exc,
                exc_info=True,
            )
            metrics_json["benchmark_returns_error"] = str(exc)[:200]

    # METRICS-11: 10 new qstats scalars merged into the inner metrics_json
    # JSONB sub-dict (D-01 storage split — these are scalars, they live in
    # the metrics_json JSONB column on strategy_analytics, NOT new top-level
    # columns). Wired here in Phase 12 Plan 06; the helper itself shipped in
    # Plan 12-04. compute_qstats_scalars uses try/except per scalar so a
    # single qs failure can't take down the whole metrics computation.
    qstats_scalars = compute_qstats_scalars(returns, benchmark_returns)
    metrics_json.update(qstats_scalars)

    # All individual metrics already passed through _safe_float().
    # sanitize_metrics() is a final guardrail for nested structures (metrics_json, rolling, quantiles).
    sanitized = sanitize_metrics({
        "cumulative_return": total_return,
        "cagr": cagr,
        "volatility": volatility,
        "sharpe": sharpe,
        "sortino": sortino,
        "calmar": calmar,
        "max_drawdown": max_dd,
        "max_drawdown_duration_days": dd_duration,
        "six_month_return": six_month,
        "sparkline_returns": sparkline_returns,
        "sparkline_drawdown": sparkline_drawdown,
        "metrics_json": metrics_json,
        "returns_series": returns_series,
        "drawdown_series": drawdown_series,
        "monthly_returns": monthly,
        "rolling_metrics": rolling,
        "return_quantiles": quantiles,
    })

    # METRICS-04, METRICS-05, METRICS-06, METRICS-12: sibling-kind payloads.
    # 10 kinds emitted here (the 2 missing — exposure_series, turnover_series —
    # are added by analytics_runner since they require position_snapshots data).
    # Heavy-series storage per D-02 — these go to strategy_analytics_series via
    # the atomic batch RPC (M-Grok-1) at the runner level, NOT into metrics_json.
    has_benchmark = benchmark_returns is not None and len(benchmark_returns) > 0
    sibling_kinds: dict[str, Any] = {
        "daily_returns_grid": _daily_returns_grid_from_series(returns),
        "rolling_sortino_3m": _rolling_sortino(returns, 63),
        "rolling_sortino_6m": _rolling_sortino(returns, 126),
        "rolling_sortino_12m": _rolling_sortino(returns, 252),
        "rolling_volatility_3m": _rolling_volatility(returns, 63),
        "rolling_volatility_6m": _rolling_volatility(returns, 126),
        "rolling_volatility_12m": _rolling_volatility(returns, 252),
        "rolling_alpha": _rolling_alpha(returns, benchmark_returns, 90) if has_benchmark else [],
        "rolling_beta": _rolling_beta(returns, benchmark_returns, 90) if has_benchmark else [],
        "log_returns_series": _log_returns_series(returns),
    }

    return MetricsResult(metrics_json=sanitized, sibling_kinds=sibling_kinds)


def compute_risk_of_ruin(
    win_rate: float,
    payoff_ratio: float,
    avg_trade_size: float,
) -> list[dict[str, float | None]]:
    """Cox-Miller analytical approximation for probability of reaching various loss levels.

    If p * r > q the strategy has a positive edge and ruin probability decays
    exponentially with loss depth.  Otherwise ruin is certain at every level.
    """
    p = win_rate
    q = 1.0 - p
    r = payoff_ratio
    loss_levels = [0.10, 0.20, 0.30, 0.50, 1.00]

    results: list[dict[str, float | None]] = []
    for level in loss_levels:
        if p <= 0 or avg_trade_size <= 0:
            prob = _safe_float(1.0)
        elif p * r > q:
            exponent = min(level / max(avg_trade_size, 0.001), 500)
            prob = _safe_float((q / p) ** exponent)
        else:
            prob = _safe_float(1.0)
        results.append({
            "loss_pct": _safe_float(level * 100),
            "probability": prob,
        })
    return results


def _max_dd_duration(dd_series: pd.Series) -> int:
    """Calculate max drawdown duration in days."""
    in_dd = dd_series < 0
    groups = (~in_dd).cumsum()
    if not in_dd.any():
        return 0
    durations = in_dd.groupby(groups).sum()
    return int(durations.max())


def _monthly_returns_grid_from_series(monthly: pd.Series) -> dict[str, dict[str, float]]:
    """Year x Month grid from pre-computed monthly returns."""
    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    grid: dict[str, dict[str, float]] = {}
    for date, val in monthly.items():
        year = str(date.year)
        month = months[date.month - 1]
        if year not in grid:
            grid[year] = {}
        grid[year][month] = round(float(val), 6)
    return grid


def _daily_returns_grid_from_series(returns: pd.Series) -> list[dict[str, Any]]:
    """Flat per-day return list. Sibling-table kind = 'daily_returns_grid'.

    Output shape: [{date: 'YYYY-MM-DD', value: float}, …].
    Heat-map renderer (Phase 14b) reshapes into 12-month × N-year grid client-side.
    Matches the per-date shape of every other series kind (exposure_series,
    turnover_series, rolling_*).

    Mirrors `_monthly_returns_grid_from_series` template above (D-03 storage
    decision: flat list serializes smaller and matches per-date shape of every
    other series kind per RESEARCH.md §5b).
    """
    if len(returns) == 0:
        return []
    return [
        {"date": d.strftime("%Y-%m-%d"), "value": round(float(v), 6)}
        for d, v in returns.items()
    ]


def compute_qstats_scalars(
    returns: pd.Series,
    benchmark: pd.Series | None,
) -> dict[str, float | None | str]:
    """METRICS-11: Compute the 10 new qstats scalars.

    Audit 2026-05-07 H-0710 / H-0713 / H-0723:
        Each scalar is still wrapped in try/except so a single qs failure
        doesn't take down the whole metrics computation, but each `except`
        now emits `logger.warning(..., exc_info=True)` with the scalar name
        + returns length context. This converts "10 scalars silently degrade
        to None" into a triggerable operator signal (Railway log). Also closes
        the timing-oracle side channel insofar as the per-scalar throw is now
        attributable in logs rather than only inferrable from latency.

    Audit 2026-05-07 H-0718:
        `r_squared` previously collapsed three states ('no benchmark',
        'benchmark present but qs raised', 'benchmark present + qs returned
        NaN/Inf') into the single None sentinel. We now emit a companion
        `r_squared_status` key with one of 'no_benchmark' | 'ok' | 'error'
        so operators can disambiguate the failure mode without reading logs.

    Audit 2026-05-07 H-0724:
        `time_in_market` previously used `qs.stats.exposure(returns)`, whose
        internal `_ceil(ex * 100) / 100` rounds UP to the nearest percent
        (e.g., 1 active day in 252 displays as 1% instead of 0.4%). We now
        compute the unbiased fraction directly: `(returns != 0).sum() / len(returns)`.

    All keys are always present in the output dict; the value is None when
    the underlying computation fails or input is missing.

    Output keys (D-01 sibling-table contract):
        recovery_factor, ulcer_index, upi (ulcer_performance_index),
        kelly_criterion, probabilistic_sharpe_ratio (qs.stats.probabilistic_ratio),
        common_sense_ratio, cpc_index, serenity_index, r_squared (vs benchmark),
        time_in_market (fraction in [0, 1], not ceil-rounded percent),
        r_squared_status (companion: 'no_benchmark' | 'ok' | 'error').
    """
    result: dict[str, float | None | str] = {
        "recovery_factor": None,
        "ulcer_index": None,
        "upi": None,
        "kelly_criterion": None,
        "probabilistic_sharpe_ratio": None,
        "common_sense_ratio": None,
        "cpc_index": None,
        "serenity_index": None,
        "r_squared": None,
        "r_squared_status": "no_benchmark",
        "time_in_market": None,
    }
    returns_len = len(returns) if returns is not None else None

    try:
        result["recovery_factor"] = _safe_float(qs.stats.recovery_factor(returns))
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "qstats scalar recovery_factor failed (returns_len=%s): %s",
            returns_len, exc, exc_info=True,
        )
    try:
        result["ulcer_index"] = _safe_float(qs.stats.ulcer_index(returns))
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "qstats scalar ulcer_index failed (returns_len=%s): %s",
            returns_len, exc, exc_info=True,
        )
    try:
        result["upi"] = _safe_float(qs.stats.ulcer_performance_index(returns))
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "qstats scalar upi failed (returns_len=%s): %s",
            returns_len, exc, exc_info=True,
        )
    try:
        result["kelly_criterion"] = _safe_float(qs.stats.kelly_criterion(returns))
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "qstats scalar kelly_criterion failed (returns_len=%s): %s",
            returns_len, exc, exc_info=True,
        )
    try:
        result["probabilistic_sharpe_ratio"] = _safe_float(qs.stats.probabilistic_ratio(returns))
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "qstats scalar probabilistic_sharpe_ratio failed (returns_len=%s): %s",
            returns_len, exc, exc_info=True,
        )
    try:
        result["common_sense_ratio"] = _safe_float(qs.stats.common_sense_ratio(returns))
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "qstats scalar common_sense_ratio failed (returns_len=%s): %s",
            returns_len, exc, exc_info=True,
        )
    try:
        result["cpc_index"] = _safe_float(qs.stats.cpc_index(returns))
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "qstats scalar cpc_index failed (returns_len=%s): %s",
            returns_len, exc, exc_info=True,
        )
    try:
        result["serenity_index"] = _safe_float(qs.stats.serenity_index(returns))
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "qstats scalar serenity_index failed (returns_len=%s): %s",
            returns_len, exc, exc_info=True,
        )
    # H-0718: distinguish 'no benchmark' (default), 'ok', and 'error' for r_squared.
    if benchmark is not None and len(benchmark) > 0:
        try:
            result["r_squared"] = _safe_float(qs.stats.r_squared(returns, benchmark))
            result["r_squared_status"] = "ok"
        except Exception as exc:  # noqa: BLE001
            result["r_squared_status"] = "error"
            logger.warning(
                "qstats scalar r_squared failed (returns_len=%s, benchmark_len=%s): %s",
                returns_len, len(benchmark), exc, exc_info=True,
            )
    # H-0724: unbiased time-in-market fraction (qs.stats.exposure ceil-rounds UP).
    try:
        if returns_len and returns_len > 0:
            result["time_in_market"] = _safe_float(
                float((returns != 0).sum()) / float(returns_len)
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "qstats scalar time_in_market failed (returns_len=%s): %s",
            returns_len, exc, exc_info=True,
        )

    return result


def _finalize_rolling(series: pd.Series) -> list[dict[str, Any]]:
    """Drop NaN/±inf, format as {date, value} rounded to 4 decimals, cap size.

    Audit 2026-05-07 G11.E.17: when a significant fraction of points are
    dropped (NaN/Inf — usually persistent zero-variance windows for
    rolling sharpe/correlation), allocators see a chart with silent
    gaps and no indication that half the windows had undefined output.
    Now we log a WARNING when the drop ratio exceeds 10%, including the
    dropped count + total — operators can spot strategies whose
    rolling charts are mostly noise. The output shape is unchanged
    (list[{date, value}]); the per-series dropped count is intentionally
    not surfaced in metrics_json here because the caller already
    has multiple finalize_rolling sites and threading a tuple through
    each would balloon the diff. The frontend warning gate is left as
    a follow-up: this fix surfaces the signal in server logs.
    """
    total = len(series)
    cleaned = series.dropna().replace([np.inf, -np.inf], np.nan).dropna()
    dropped = total - len(cleaned)
    # 10% threshold — below that, the legitimate window-warmup phase of
    # any rolling indicator dominates and we'd spam the log on every
    # healthy strategy.
    if total > 0 and dropped / total > 0.10:
        logger.warning(
            "rolling-series finalize: dropped %d/%d (%.1f%%) NaN/Inf points",
            dropped,
            total,
            100.0 * dropped / total,
        )
    result = [
        {"date": d.strftime("%Y-%m-%d"), "value": round(float(v), 4)}
        for d, v in cleaned.items()
    ]
    return cap_data_points(result)


def _rolling_sharpe(returns: pd.Series, window: int) -> list[dict[str, Any]]:
    """Compute rolling annualized Sharpe using vectorized pandas rolling."""
    if len(returns) < window:
        return []
    roll_mean = returns.rolling(window).mean()
    roll_std = returns.rolling(window).std()
    return _finalize_rolling((roll_mean / roll_std) * np.sqrt(252))


def _rolling_sortino(returns: pd.Series, window: int, mar: float = MAR) -> list[dict[str, Any]]:
    """Compute rolling annualized Sortino using downside RMS (MAR-floored).

    Pitfall 11 single source of truth: this MUST mirror `qs.stats.sortino`'s
    downside formula so the cross-runtime parity test holds at window == period.
    qs.stats.sortino uses:
        downside = sqrt(sum(x^2 for x in returns if x < MAR) / len(returns))
        sortino = mean(returns) / downside * sqrt(252)
    Re-implementing this on a rolling window:
        neg_sq[t]   = x[t]^2 if x[t] < MAR else 0
        roll_dstd   = sqrt(neg_sq.rolling(window).sum() / window)
        roll_mean   = returns.rolling(window).mean()
        sortino[t]  = roll_mean[t] / roll_dstd[t] * sqrt(252)

    NOTE: pandas `.rolling().std()` (which `_rolling_sharpe` uses for Sharpe)
    is NOT used here — it subtracts the rolling mean and divides by (N-1), which
    diverges from qs.stats.sortino's RMS formula. Mirroring the QS math is the
    cross-runtime contract; mirroring the _rolling_sharpe SHAPE (window guard,
    _finalize_rolling) is the file convention. Both are honored.

    Mirrors _rolling_sharpe at metrics.py for shape; mirrors qs.stats.sortino
    for math.
    """
    if len(returns) < window:
        return []
    neg_sq = (returns.where(returns < mar, 0.0)) ** 2
    roll_dstd = (neg_sq.rolling(window).sum() / window) ** 0.5
    roll_mean = returns.rolling(window).mean()
    # _finalize_rolling scrubs NaN/Inf so the consumer never sees them.
    return _finalize_rolling((roll_mean / roll_dstd) * np.sqrt(252))


def _rolling_volatility(returns: pd.Series, window: int) -> list[dict[str, Any]]:
    """Annualized rolling volatility = std * sqrt(252).

    Mirrors `qs.stats.volatility` (which is `returns.std() * sqrt(252)`) on a
    rolling window. Mirrors _rolling_sharpe at metrics.py for shape.
    """
    if len(returns) < window:
        return []
    return _finalize_rolling(returns.rolling(window).std() * np.sqrt(252))


def _rolling_alpha(returns: pd.Series, benchmark: pd.Series, window: int = 90) -> list[dict[str, Any]]:
    """Rolling alpha vs benchmark via qs.stats.rolling_greeks.

    Window default 90d trading per UC#6 BTC-only scope. qs.stats.rolling_greeks
    returns a DataFrame with columns ["beta", "alpha"]; we project the alpha
    column and finalize.
    """
    if benchmark is None or len(returns) < window:
        return []
    greeks = qs.stats.rolling_greeks(returns, benchmark, window)
    if "alpha" not in greeks:
        return []
    return _finalize_rolling(greeks["alpha"])


def _rolling_beta(returns: pd.Series, benchmark: pd.Series, window: int = 90) -> list[dict[str, Any]]:
    """Rolling beta vs benchmark via qs.stats.rolling_greeks."""
    if benchmark is None or len(returns) < window:
        return []
    greeks = qs.stats.rolling_greeks(returns, benchmark, window)
    if "beta" not in greeks:
        return []
    return _finalize_rolling(greeks["beta"])


def _log_returns_series(returns: pd.Series) -> list[dict[str, Any]]:
    """Log returns series = np.log1p(returns).

    Same length as input (no window dropoff). Used by EquityCurve "Log Returns"
    toggle (METRICS-12). Routed through _finalize_rolling for NaN/Inf scrubbing
    + cap_data_points consistency with the other series helpers.
    """
    if len(returns) == 0:
        return []
    log_rets = np.log1p(returns)
    return _finalize_rolling(pd.Series(log_rets, index=returns.index))


def _rolling_correlation(a: pd.Series, b: pd.Series, window: int) -> list[dict[str, Any]]:
    """Vectorized rolling Pearson correlation between two aligned series."""
    if len(a) < window:
        return []
    return _finalize_rolling(a.rolling(window).corr(b))


def _return_quantiles(returns: pd.Series) -> dict[str, list[float]]:
    """Box plot data for different time periods."""
    result: dict[str, list[float]] = {}

    # Daily
    q = returns.quantile([0, 0.25, 0.5, 0.75, 1]).tolist()
    result["Daily"] = [float(v) for v in q]

    # Weekly
    weekly = returns.resample("W").apply(lambda x: (1 + x).prod() - 1)
    if len(weekly) >= 4:
        q = weekly.quantile([0, 0.25, 0.5, 0.75, 1]).tolist()
        result["Weekly"] = [float(v) for v in q]

    # Monthly
    monthly = returns.resample("ME").apply(lambda x: (1 + x).prod() - 1)
    if len(monthly) >= 3:
        q = monthly.quantile([0, 0.25, 0.5, 0.75, 1]).tolist()
        result["Monthly"] = [float(v) for v in q]

    return result
