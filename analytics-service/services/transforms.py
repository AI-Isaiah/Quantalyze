import pandas as pd
import numpy as np
from typing import Any


def trades_to_daily_returns(
    trades: list[dict[str, Any]],
    account_balance: float | None = None,
) -> pd.Series:
    """Convert trade/PnL records to portfolio-level daily returns.

    Args:
        trades: Trade or daily PnL records from the exchange
        account_balance: Actual account balance from exchange API (USDT).
            When provided, used as initial capital for accurate percentage returns.
            When None, falls back to heuristic estimation (less accurate).

    Handles two data formats:
    1. Daily PnL records (order_type='daily_pnl'): dollar P&L per day from exchange bills or CSV
    2. Individual trades: buy/sell with price/quantity
    """
    if not trades:
        return pd.Series(dtype=float)

    df = pd.DataFrame(trades)
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    df["date"] = df["timestamp"].dt.date

    # Check if this is daily PnL data (from exchange bills API or CSV upload)
    is_daily_pnl = df["order_type"].iloc[0] == "daily_pnl" if "order_type" in df.columns else False

    if is_daily_pnl:
        # Daily PnL: price field contains the dollar P&L for that day
        # side='buy' means profit, side='sell' means loss
        df["daily_pnl"] = df.apply(
            lambda r: float(r["price"]) if r["side"] == "buy" else -float(r["price"]),
            axis=1,
        )
        daily_pnl = df.groupby("date")["daily_pnl"].sum()

        if account_balance and account_balance > 0:
            # Derive starting balance from current balance and cumulative PnL.
            # current_balance = starting_balance + total_pnl, so:
            # starting_balance = current_balance - total_pnl
            total_pnl = daily_pnl.sum()
            estimated_start = account_balance - total_pnl
            if estimated_start > 0:
                initial_capital = estimated_start
            else:
                # Account gained more than its starting balance (e.g., 10x return).
                # Use current balance as a reasonable upper bound.
                initial_capital = account_balance
        else:
            # Fallback heuristic for CSV uploads where no balance is available.
            # This can be off by 5-10x for volatile strategies.
            mean_abs_pnl = daily_pnl.abs().mean()
            initial_capital = max(mean_abs_pnl * 100, abs(daily_pnl.sum()), 10000)

        # Build equity curve and compute returns
        equity = initial_capital + daily_pnl.cumsum()
        prev_equity = equity.shift(1).fillna(initial_capital)
        # Avoid division by zero
        prev_equity = prev_equity.replace(0, initial_capital)
        returns_values = daily_pnl / prev_equity

    else:
        # Individual trades: use account balance if available
        df["notional"] = df["price"].astype(float) * df["quantity"].astype(float)
        df.loc[df["side"] == "sell", "notional"] *= -1
        df["fee_usd"] = df["fee"].fillna(0).astype(float)

        daily_agg = df.groupby("date").agg(
            net_notional=("notional", "sum"),
            total_fees=("fee_usd", "sum"),
        )
        daily_agg["pnl"] = daily_agg["net_notional"] - daily_agg["total_fees"]

        if account_balance and account_balance > 0:
            total_pnl = daily_agg["pnl"].sum()
            estimated_start = account_balance - total_pnl
            initial_capital = estimated_start if estimated_start > 0 else account_balance
        else:
            initial_capital = abs(daily_agg["net_notional"].iloc[0]) or 10000
        equity = initial_capital + daily_agg["pnl"].cumsum()
        prev_equity = equity.shift(1).fillna(initial_capital)
        prev_equity = prev_equity.replace(0, initial_capital)
        returns_values = daily_agg["pnl"] / prev_equity

    returns = pd.Series(
        returns_values.values,
        index=pd.DatetimeIndex(returns_values.index),
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
