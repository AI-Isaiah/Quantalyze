import quantstats as qs
import pandas as pd
import numpy as np
import math
from typing import Any

from .transforms import downsample_series, cap_data_points


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


def compute_all_metrics(returns: pd.Series, benchmark_returns: pd.Series | None = None) -> dict[str, Any]:
    """Compute all analytics from a daily returns series."""
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
        except Exception:
            pass

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
        except Exception:
            pass

    # All individual metrics already passed through _safe_float().
    # sanitize_metrics() is a final guardrail for nested structures (metrics_json, rolling, quantiles).
    return sanitize_metrics({
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


def _rolling_sharpe(returns: pd.Series, window: int) -> list[dict[str, Any]]:
    """Compute rolling annualized Sharpe using vectorized pandas rolling."""
    if len(returns) < window:
        return []
    roll_mean = returns.rolling(window).mean()
    roll_std = returns.rolling(window).std()
    rolling_sharpe = (roll_mean / roll_std) * np.sqrt(252)
    rolling_sharpe = rolling_sharpe.dropna().replace([np.inf, -np.inf], np.nan).dropna()
    result = [
        {"date": d.strftime("%Y-%m-%d"), "value": round(float(v), 4)}
        for d, v in rolling_sharpe.items()
    ]
    return cap_data_points(result)


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
