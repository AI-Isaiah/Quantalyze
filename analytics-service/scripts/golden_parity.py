"""ACC-01 golden-parity: the FROZEN anchor-to-today oracle.

This module re-materialises the OLD (pre-73, silently-inflated) daily-returns
behaviour so the golden old-vs-new parity harness has an honest OLD series to
diff the NEW flow-aware core against.

The OLD formula was DELETED from ``services/transforms.py`` in P73/P74. It
survives verbatim at the v1.8-branch merge-base commit ``9a1e7b8e``. The two
functions below are a VERBATIM TRANSCRIPTION of that code — NOT a paraphrase,
NOT a runtime import of the deleted module (RESEARCH rejected re-importing the
old ``transforms`` because it pulls the whole service graph and would drift).

Provenance (source of truth for BOTH branches):
    git show 9a1e7b8e:analytics-service/services/transforms.py  (L148-215)
    9a1e7b8e == `git merge-base v1.8-flow-aware-twr main` (confirmed).
    daily_pnl branch:          def trades_to_daily_returns_with_status @ L70,
                               dust-floor + equity math @ L146-181.
    individual-trades branch:  same function, else-branch @ L183-217.

DO NOT "fix" anything here. The `estimated_start <= 0 -> account_balance`
fallback IS the +458% LTP068 inflation bug — reproducing it exactly is the
whole point. Any drift from the real pre-73 output is caught by the
mutation-honest golden pin in tests/test_golden_parity.py.

Security (T-78-01): this module returns pandas Series / booleans only. It never
prints or embeds raw USD NAV / flow / balance magnitudes anywhere (account-size
leak class, T-73-02 / T-77-02 discipline).

stdlib + pandas + numpy ONLY. No import of services.transforms / services.nav_twr.
"""

from __future__ import annotations

from typing import Any

import pandas as pd

# Fixed absolute dust floor (audit-2026-05-07 C-0233), NOT PnL-scaled.
# Verbatim from 9a1e7b8e:services/transforms.py L146 / L195.
_DUST_BALANCE_THRESHOLD = 1000.0  # USDT


def old_anchor_to_today_returns(
    daily_pnl: pd.Series,
    account_balance: float | None,
) -> pd.Series:
    """Frozen pre-73 anchor-to-today returns — daily_pnl branch (the LTP path).

    frozen from 9a1e7b8e:services/transforms.py L148-215 — DO NOT "fix", this
    IS the OLD behaviour we diff against. The `estimated_start > 0 else
    account_balance` fallback IS the +458% LTP068 bug.

    Args:
        daily_pnl: dollar P&L per day, indexed by date (already grouped — this
            is the ``daily_pnl = df.groupby("date")["daily_pnl"].sum()`` result
            in the real pre-73 code; the deterministic parse/group prelude is
            upstream of the buggy formula and is not transcribed here).
        account_balance: current account balance (USDT), or None.

    Returns:
        The OLD daily-returns Series (index=DatetimeIndex, name="returns"),
        byte-identical to pre-73 ``trades_to_daily_returns_with_status`` on the
        same aggregated daily_pnl.
    """
    # --- verbatim from 9a1e7b8e:services/transforms.py L146-176 (daily_pnl branch) ---
    min_balance = _DUST_BALANCE_THRESHOLD
    if account_balance and account_balance > min_balance:
        # Derive starting balance from current balance and cumulative PnL.
        # starting_balance = current_balance - total_pnl
        total_pnl = daily_pnl.sum()
        estimated_start = account_balance - total_pnl
        if estimated_start > 0:
            initial_capital = estimated_start
        else:
            # Account gained more than its starting balance (e.g. 10x return).
            # Use current balance as a reasonable upper bound.  <-- THE BUG
            initial_capital = account_balance
    else:
        # Fallback heuristic for CSV uploads where no balance is available.
        # Off by 5-10x for volatile strategies.
        mean_abs_pnl = daily_pnl.abs().mean()
        initial_capital = max(mean_abs_pnl * 100, abs(daily_pnl.sum()), 10000)

    # Build equity curve and compute returns.
    equity = initial_capital + daily_pnl.cumsum()
    prev_equity = equity.shift(1).fillna(initial_capital)
    # Avoid division by zero.
    prev_equity = prev_equity.replace(0, initial_capital)
    returns_values = daily_pnl / prev_equity
    # --- end verbatim (daily_pnl branch) ---

    return pd.Series(
        returns_values.values,
        index=pd.DatetimeIndex(returns_values.index),
        name="returns",
    )


def old_anchor_to_today_returns_from_trades(
    trades: list[dict[str, Any]],
    account_balance: float | None,
) -> pd.Series:
    """Frozen pre-73 anchor-to-today returns — individual-trades branch.

    frozen from 9a1e7b8e:services/transforms.py L148-215 — DO NOT "fix", this
    IS the OLD behaviour we diff against (Open Question 2: the parallel
    individual-trades branch at the same ref). Same `estimated_start > 0 else
    account_balance` fallback and `.replace(0, initial_capital)` divide-guard as
    the daily_pnl branch. Fixture coverage lives on the daily_pnl branch (the
    LTP path); this branch is covered-by-transcription.

    Args:
        trades: individual buy/sell records (order_type != 'daily_pnl') with
            timestamp / side / price / quantity / fee fields.
        account_balance: current account balance (USDT), or None.

    Returns:
        The OLD daily-returns Series (index=DatetimeIndex, name="returns").
    """
    # --- verbatim from 9a1e7b8e:services/transforms.py L98-116 + L178-212 ---
    df = pd.DataFrame(trades)
    df["timestamp"] = pd.to_datetime(df["timestamp"], format="ISO8601", utc=True)
    df["date"] = df["timestamp"].dt.date

    df["notional"] = df["price"].astype(float) * df["quantity"].astype(float)
    df.loc[df["side"] == "sell", "notional"] *= -1
    df["fee_usd"] = df["fee"].fillna(0).astype(float)

    daily_agg = df.groupby("date").agg(
        net_notional=("notional", "sum"),
        total_fees=("fee_usd", "sum"),
    )
    daily_agg["pnl"] = daily_agg["net_notional"] - daily_agg["total_fees"]

    min_balance_t = _DUST_BALANCE_THRESHOLD  # 1000.0 — fixed dust floor, matches daily_pnl path
    if account_balance and account_balance > min_balance_t:
        total_pnl = daily_agg["pnl"].sum()
        estimated_start = account_balance - total_pnl
        initial_capital = estimated_start if estimated_start > 0 else account_balance
    else:
        initial_capital = abs(daily_agg["net_notional"].iloc[0]) or 10000

    equity = initial_capital + daily_agg["pnl"].cumsum()
    prev_equity = equity.shift(1).fillna(initial_capital)
    prev_equity = prev_equity.replace(0, initial_capital)
    returns_values = daily_agg["pnl"] / prev_equity
    # --- end verbatim (individual-trades branch) ---

    return pd.Series(
        returns_values.values,
        index=pd.DatetimeIndex(returns_values.index),
        name="returns",
    )
