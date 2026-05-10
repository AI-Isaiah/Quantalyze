import pandas as pd
import numpy as np
from typing import Any, TypedDict


class ReturnsComputationMeta(TypedDict):
    """Audit-2026-05-07 #9 — metadata about how `trades_to_daily_returns`
    computed initial_capital, plumbed up to the caller so it can populate
    `data_quality_flags` and `strategy_analytics.computation_status`
    accurately.

    Pre-fix the heuristic-capital fallback was indistinguishable from the
    real-balance path at the API surface — a transient exchange-API
    failure silently degraded a verified institutional strategy's
    CAGR/Sharpe by 5–10× and the factsheet rendered the result as
    canonical. The flags below are the contract callers (analytics_runner,
    portfolio router) must read to set the right DQF + computation_status:

      * ``used_heuristic_capital`` — initial_capital came from the
        heuristic fallback (off by 5–10× on volatile strategies),
        not from the exchange API. ALWAYS set when account_balance was
        None or below threshold. Maps to
        ``data_quality_flags.heuristic_capital_used = True``.
      * ``balance_error`` — caller passed ``balance_error=True`` because
        the exchange API failed (network, auth, rate-limit). Pre-fix
        this signal was destroyed by `fetch_usdt_balance` returning a
        bare None on every exception. Maps to
        ``data_quality_flags.balance_error = True``.
      * ``computation_status_hint`` — what the caller should set on
        ``strategy_analytics.computation_status``. Returns
        ``"complete_with_warnings"`` whenever the heuristic was used OR
        the balance read errored; ``"complete"`` only when initial_capital
        came from a legitimate balance read. Mirrors the existing
        complete_with_warnings convention used elsewhere in the runner.
    """
    used_heuristic_capital: bool
    balance_error: bool
    computation_status_hint: str


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

    Audit-2026-05-07 #9 — this is a thin wrapper around
    ``trades_to_daily_returns_with_status`` that drops the
    ``ReturnsComputationMeta`` flags. New code paths that feed
    ``data_quality_flags`` should call the *_with_status form so the
    caller can set ``data_quality_flags.heuristic_capital_used`` and
    ``balance_error`` accurately.
    """
    returns, _meta = trades_to_daily_returns_with_status(
        trades, account_balance=account_balance, balance_error=False
    )
    return returns


def trades_to_daily_returns_with_status(
    trades: list[dict[str, Any]],
    account_balance: float | None = None,
    balance_error: bool = False,
) -> tuple[pd.Series, ReturnsComputationMeta]:
    """Audit-2026-05-07 #9 — same conversion as ``trades_to_daily_returns``
    but ALSO returns a ``ReturnsComputationMeta`` describing how
    initial_capital was derived. The caller propagates the flags into
    ``data_quality_flags`` + ``strategy_analytics.computation_status``.

    Args:
        trades: same as ``trades_to_daily_returns``.
        account_balance: actual account balance from the exchange API
            (USDT). When None or below the per-strategy dust threshold,
            the heuristic-capital fallback is used (off by 5–10× on
            volatile strategies).
        balance_error: True when the caller's
            ``fetch_usdt_balance_with_status`` returned ``balance_error=True``.
            DISTINCT from "balance legitimately None" (e.g. drained
            paper account); pre-fix the API collapsed both into a bare
            None and the factsheet showed degraded numbers as canonical.

    Returns:
        ``(returns, meta)`` where ``meta`` is a ``ReturnsComputationMeta``
        dict with the three flags described in the TypedDict docstring.
    """
    used_heuristic_capital = False

    if not trades:
        return pd.Series(dtype=float), _build_meta(
            used_heuristic_capital=False,
            balance_error=balance_error,
        )

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

        # Minimum balance threshold: ignore dust accounts (e.g., $0.50 after withdrawal)
        # that would produce absurd percentage returns
        min_balance = max(daily_pnl.abs().max() * 2, 100) if len(daily_pnl) > 0 else 100
        if account_balance and account_balance > min_balance:
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
            # This can be off by 5-10x for volatile strategies. Audit-2026-05-07
            # #9: surface that we took this path so the caller can set
            # data_quality_flags.heuristic_capital_used = True and bump
            # computation_status to 'complete_with_warnings' on the
            # public factsheet.
            used_heuristic_capital = True
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

        min_balance_t = max(daily_agg["pnl"].abs().max(), 100) if len(daily_agg) > 0 else 100
        if account_balance and account_balance > min_balance_t:
            total_pnl = daily_agg["pnl"].sum()
            estimated_start = account_balance - total_pnl
            initial_capital = estimated_start if estimated_start > 0 else account_balance
        else:
            # Audit-2026-05-07 #9: same heuristic-capital surface for the
            # individual-trades path. `abs(...).iloc[0]` is even less
            # reliable than the daily_pnl heuristic above (samples one
            # day's net notional), but the fallback contract is identical
            # — the caller MUST treat the returns as approximate when
            # this branch fires.
            used_heuristic_capital = True
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

    return returns, _build_meta(
        used_heuristic_capital=used_heuristic_capital,
        balance_error=balance_error,
    )


def _build_meta(
    *, used_heuristic_capital: bool, balance_error: bool
) -> ReturnsComputationMeta:
    """Build the ``ReturnsComputationMeta`` returned to the caller.

    The ``computation_status_hint`` is "complete_with_warnings" when
    either ``used_heuristic_capital`` or ``balance_error`` is set,
    otherwise "complete". The consumer in ``analytics_runner.py``
    promotes ``strategy_analytics.computation_status`` to
    "complete_with_warnings" specifically when one of these two
    consumer-migration flags fires.

    Section-level flags (position_metrics_failed,
    position_side_volume_failed, trade_mix_approximation,
    account_balance_unavailable, no_linked_api_key,
    benchmark_unavailable, etc.) deliberately keep
    computation_status='complete' even when their corresponding DQF
    keys fire — eight frontend consumers gate exact-string on
    `computation_status === "complete"` (factsheet PDFs, discovery
    page, strategy detail, portfolios, queries, PerformanceReport,
    SyncProgress). Promoting those flags would break PDF rendering
    and metric grids on every demo strategy and every strategy with
    a stale benchmark. Migrating the consumers to accept both states
    is a separate follow-up PR.
    """
    if used_heuristic_capital or balance_error:
        hint = "complete_with_warnings"
    else:
        hint = "complete"
    return {
        "used_heuristic_capital": used_heuristic_capital,
        "balance_error": balance_error,
        "computation_status_hint": hint,
    }


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
