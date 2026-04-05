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
        "sharpe_30d": _rolling_metric(returns, 30, qs.stats.sharpe),
        "sharpe_90d": _rolling_metric(returns, 90, qs.stats.sharpe),
        "sharpe_365d": _rolling_metric(returns, 365, qs.stats.sharpe),
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

    monthly_rets = returns.resample("M").apply(lambda x: (1 + x).prod() - 1)
    if len(monthly_rets) > 0:
        metrics_json["best_month"] = float(monthly_rets.max())
        metrics_json["worst_month"] = float(monthly_rets.min())

    # Benchmark metrics
    if benchmark_returns is not None and len(benchmark_returns) > 0:
        try:
            metrics_json["alpha"] = float(qs.stats.greeks(returns, benchmark_returns).get("alpha", 0))
            metrics_json["beta"] = float(qs.stats.greeks(returns, benchmark_returns).get("beta", 0))
            aligned = returns.align(benchmark_returns, join="inner")
            if len(aligned[0]) > 1:
                metrics_json["correlation"] = float(aligned[0].corr(aligned[1]))
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


def _rolling_metric(returns: pd.Series, window: int, fn) -> list[dict[str, Any]]:
    """Compute a rolling metric over a window."""
    result = []
    if len(returns) < window:
        return result
    for i in range(window, len(returns)):
        chunk = returns.iloc[i - window:i]
        try:
            val = float(fn(chunk))
            if np.isnan(val) or np.isinf(val):
                continue
        except Exception:
            continue
        result.append({
            "date": returns.index[i].strftime("%Y-%m-%d"),
            "value": val,
        })
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
