import quantstats as qs
import pandas as pd
import numpy as np
from typing import Any

from .transforms import downsample_series, cap_data_points


def compute_all_metrics(returns: pd.Series, benchmark_returns: pd.Series | None = None) -> dict[str, Any]:
    """Compute all analytics from a daily returns series."""
    if len(returns) < 2:
        raise ValueError("Insufficient trade history. At least 2 trading days required.")

    # Core metrics
    cumulative = (1 + returns).cumprod()
    total_return = float(cumulative.iloc[-1] - 1)
    cagr = float(qs.stats.cagr(returns))
    volatility = float(qs.stats.volatility(returns))
    sharpe = float(qs.stats.sharpe(returns))
    sortino = float(qs.stats.sortino(returns))
    calmar = float(qs.stats.calmar(returns))
    max_dd = float(qs.stats.max_drawdown(returns))

    # Drawdown series
    dd_series = qs.stats.to_drawdown_series(returns)
    dd_duration = _max_dd_duration(dd_series)

    # Monthly returns grid
    monthly = _monthly_returns_grid(returns)

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
    six_month = float(returns.tail(126).add(1).prod() - 1) if len(returns) >= 126 else None

    # Extended metrics
    metrics_json: dict[str, Any] = {}
    try:
        metrics_json["var_1d_95"] = float(qs.stats.value_at_risk(returns, cutoff=0.05))
    except Exception:
        pass
    try:
        metrics_json["cvar"] = float(qs.stats.cvar(returns))
    except Exception:
        pass

    metrics_json["mtd"] = float(returns[returns.index >= pd.Timestamp(returns.index[-1].replace(day=1))].add(1).prod() - 1)
    metrics_json["ytd"] = float(returns[returns.index >= pd.Timestamp(f"{returns.index[-1].year}-01-01")].add(1).prod() - 1)
    metrics_json["best_day"] = float(returns.max())
    metrics_json["worst_day"] = float(returns.min())
    metrics_json["three_month"] = float(returns.tail(63).add(1).prod() - 1) if len(returns) >= 63 else None

    monthly_rets = returns.resample("M").apply(lambda x: (1 + x).prod() - 1)
    if len(monthly_rets) > 0:
        metrics_json["best_month"] = float(monthly_rets.max())
        metrics_json["worst_month"] = float(monthly_rets.min())

    # Additional risk metrics
    try:
        monthly_for_var = returns.resample("M").apply(lambda x: (1 + x).prod() - 1)
        if len(monthly_for_var) > 0:
            metrics_json["var_1m_99"] = float(np.percentile(monthly_for_var, 1))
    except Exception:
        pass
    try:
        metrics_json["gini"] = float(qs.stats.gini(returns))
    except Exception:
        pass
    try:
        metrics_json["omega"] = float(qs.stats.omega(returns))
    except Exception:
        pass
    try:
        metrics_json["gain_pain"] = float(qs.stats.gain_to_pain_ratio(returns))
    except Exception:
        pass
    try:
        metrics_json["tail_ratio"] = float(qs.stats.tail_ratio(returns))
    except Exception:
        pass

    # Distribution metrics
    try:
        metrics_json["skewness"] = float(returns.skew())
    except Exception:
        pass
    try:
        metrics_json["kurtosis"] = float(returns.kurtosis())
    except Exception:
        pass
    try:
        metrics_json["smart_sharpe"] = float(qs.stats.smart_sharpe(returns))
    except Exception:
        pass
    try:
        metrics_json["smart_sortino"] = float(qs.stats.smart_sortino(returns))
    except Exception:
        pass

    # Win/Loss metrics
    wins = returns[returns > 0]
    losses = returns[returns < 0]
    if len(wins) > 0:
        metrics_json["avg_win"] = float(wins.mean())
    if len(losses) > 0:
        metrics_json["avg_loss"] = float(losses.mean())
    if len(losses) > 0 and len(wins) > 0:
        metrics_json["win_loss_ratio"] = float(len(wins) / len(losses)) if len(losses) > 0 else None
        avg_loss_abs = abs(float(losses.mean()))
        if avg_loss_abs > 0:
            metrics_json["payoff_ratio"] = float(wins.mean() / avg_loss_abs)
    try:
        metrics_json["profit_factor"] = float(qs.stats.profit_factor(returns))
    except Exception:
        pass

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
            metrics_json["outlier_win_ratio"] = float((returns > mean_ret + outlier_threshold).mean())
            metrics_json["outlier_loss_ratio"] = float((returns < mean_ret - outlier_threshold).mean())
    except Exception:
        pass

    # Benchmark metrics (single greeks() call for alpha + beta)
    if benchmark_returns is not None and len(benchmark_returns) > 0:
        try:
            greeks = qs.stats.greeks(returns, benchmark_returns)
            metrics_json["alpha"] = float(greeks.get("alpha", 0))
            metrics_json["beta"] = float(greeks.get("beta", 0))
            aligned = returns.align(benchmark_returns, join="inner")
            if len(aligned[0]) > 1:
                metrics_json["correlation"] = float(aligned[0].corr(aligned[1]))
                excess = aligned[0] - aligned[1]
                te = float(excess.std() * np.sqrt(252))
                if te > 0:
                    metrics_json["info_ratio"] = float(excess.mean() * 252 / te)
                beta = metrics_json.get("beta", 0)
                if beta and beta != 0:
                    metrics_json["treynor"] = float((cagr - 0) / beta)
        except Exception:
            pass

    return {
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
    }


def _max_dd_duration(dd_series: pd.Series) -> int:
    """Calculate max drawdown duration in days."""
    in_dd = dd_series < 0
    groups = (~in_dd).cumsum()
    if not in_dd.any():
        return 0
    durations = in_dd.groupby(groups).sum()
    return int(durations.max())


def _monthly_returns_grid(returns: pd.Series) -> dict[str, dict[str, float]]:
    """Year x Month grid of returns."""
    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    monthly = returns.resample("M").apply(lambda x: (1 + x).prod() - 1)
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
    monthly = returns.resample("M").apply(lambda x: (1 + x).prod() - 1)
    if len(monthly) >= 3:
        q = monthly.quantile([0, 0.25, 0.5, 0.75, 1]).tolist()
        result["Monthly"] = [float(v) for v in q]

    return result
