import pandas as pd
import numpy as np
from typing import Any


def trades_to_daily_returns(trades: list[dict[str, Any]]) -> pd.Series:
    """Convert trade records to portfolio-level daily returns in USDT terms."""
    if not trades:
        return pd.Series(dtype=float)

    df = pd.DataFrame(trades)
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    df["date"] = df["timestamp"].dt.date

    # Calculate PnL per trade: (price * quantity) with direction
    df["notional"] = df["price"].astype(float) * df["quantity"].astype(float)
    df.loc[df["side"] == "sell", "notional"] *= -1

    # Subtract fees (converted to USDT approximation)
    df["fee_usd"] = df["fee"].fillna(0).astype(float)

    # Daily net PnL
    daily_pnl = df.groupby("date").agg(
        net_notional=("notional", "sum"),
        total_fees=("fee_usd", "sum"),
    )
    daily_pnl["pnl"] = daily_pnl["net_notional"] - daily_pnl["total_fees"]

    # Convert PnL to returns (using cumulative capital)
    capital = abs(daily_pnl["net_notional"].iloc[0]) or 10000
    daily_pnl["return"] = daily_pnl["pnl"] / capital

    returns = pd.Series(
        daily_pnl["return"].values,
        index=pd.DatetimeIndex(daily_pnl.index),
        name="returns",
    )

    return returns


def downsample_series(series: list[dict], target_points: int = 90) -> list[float]:
    """Downsample a time series to target_points for sparklines."""
    if len(series) <= target_points:
        return [p["value"] for p in series]

    step = len(series) / target_points
    return [series[int(i * step)]["value"] for i in range(target_points)]


def cap_data_points(data: list, max_points: int = 5000) -> list:
    """Truncate data to max_points, keeping the most recent."""
    if len(data) <= max_points:
        return data
    return data[-max_points:]
