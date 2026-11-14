"""Characterization pin for Phase 214 SC-1: a ledger-complete MT5 series ends on
its last ledger-activity day, whatever today is.

``combine_mt5_deal_ledger`` emits one row per ledger-activity day (a trading deal
or a balance operation) and gap-fills only BETWEEN the first and the last such
day. So a daily re-derive of an idle account rewrites the same last day, and
``last_return_date`` cannot advance while the account is idle.

This is evidence, not a fix. Trailing flat days of a ledger-complete account are a
routed design property (see 214-DIAGNOSIS.md), not a defect asserted here: changing
it would change annualisation inputs and needs its own decision.

Every case is independent of the wall clock: dates are fixed 2025 literals and no
assertion reads today's date. The expected dates and values were measured from the
function at the time of writing (cases A-E of 214-RESEARCH.md), not copied from it.
"""
from __future__ import annotations

from datetime import datetime, timezone

import pandas as pd
import pytest

from services.broker_dailies import combine_mt5_deal_ledger


def _epoch(month: int, day: int) -> int:
    return int(datetime(2025, month, day, 12, tzinfo=timezone.utc).timestamp())


def _trade(month: int, day: int, profit: float) -> dict:
    """A position-closing deal (type 0 = BUY, entry 1 = out); shape mirrors
    ``history_deals_get`` rows as ``tests/test_broker_dailies.py`` builds them."""
    return {"type": 0, "entry": 1, "profit": profit, "swap": 0.0, "commission": 0.0,
            "fee": 0.0, "time": _epoch(month, day)}


def _balance_op(month: int, day: int, amount: float) -> dict:
    """A balance operation (type 2): a deposit when positive, a withdrawal when negative."""
    return {"type": 2, "profit": amount, "swap": 0.0, "commission": 0.0, "fee": 0.0,
            "time": _epoch(month, day)}


def _combine(deals: list[dict], equity: float) -> tuple[pd.Series, dict]:
    return combine_mt5_deal_ledger(
        deals, account_equity=equity, account_balance=equity, server_utc_offset_s=0
    )


def _day(month: int, day: int) -> pd.Timestamp:
    return pd.Timestamp(2025, month, day)


def test_series_ends_on_last_deal_day_not_today():
    """Case A, healthy: the last deal is on 10-07. The series' last index is that
    day, however long ago it was. If the series were extended to the present, an
    idle account would stop reading stale and the SC-2 cap's premise would not hold."""
    returns, _meta = _combine(
        [_balance_op(9, 29, 10_000.0), _trade(10, 1, 500.0), _trade(10, 3, -200.0),
         _trade(10, 7, 300.0)],
        equity=10_600.0,
    )

    assert returns.index[-1] == _day(10, 7)
    assert returns.iloc[-1] == pytest.approx(300.0 / 10_300.0)


def test_withdrawal_after_blow_up_ends_series_on_withdrawal_day():
    """Case B: a large loss day (10-07), then a withdrawal two days later, equity
    left small but well above the $100 dust floor. The series ends on the withdrawal
    day. The interior day between them is exactly 0.0 (gap fill, a ledger-complete
    venue's flat day) and the withdrawal day is 0.0 too (a flow is neutral to the
    return: it sits in the numerator)."""
    returns, meta = _combine(
        [_balance_op(9, 29, 10_000.0), _trade(10, 1, 500.0), _trade(10, 3, -200.0),
         _trade(10, 7, -2_400.0), _balance_op(10, 9, -5_000.0)],
        equity=2_900.0,
    )

    assert returns.loc[_day(10, 7)] == pytest.approx(-2_400.0 / 10_300.0)
    assert returns.loc[_day(10, 8)] == 0.0
    assert returns.loc[_day(10, 9)] == 0.0
    assert returns.index[-1] == _day(10, 9)
    assert not meta.get("dust_nav_guard")


def test_dust_account_deal_days_after_the_drain_are_nan():
    """Case C: a small account drained under the $100 floor by a withdrawal on 10-09,
    then two tiny deals. Measured values: each deal day after the drain (10-10, 10-13)
    is NaN and ``dust_nav_guard`` is set; the quiet days between them (10-11, 10-12)
    are gap-filled 0.0. The index still reaches the last deal day (10-13), but the last
    NON-NaN row is 10-12, so what the derive stores ends there, not on the last deal."""
    returns, meta = _combine(
        [_balance_op(9, 29, 300.0), _trade(10, 1, 20.0), _trade(10, 3, -10.0),
         _trade(10, 7, -60.0), _balance_op(10, 9, -250.0), _trade(10, 10, 3.0),
         _trade(10, 13, 2.0)],
        equity=58.0,
    )

    assert meta["dust_nav_guard"] is True
    assert returns.loc[_day(10, 7)] == pytest.approx(-0.165289, abs=1e-6)
    assert returns.loc[_day(10, 8)] == 0.0
    assert returns.loc[_day(10, 9)] == 0.0
    assert pd.isna(returns.loc[_day(10, 10)])
    assert returns.loc[_day(10, 11)] == 0.0
    assert returns.loc[_day(10, 12)] == 0.0
    assert pd.isna(returns.loc[_day(10, 13)])
    assert returns.index[-1] == _day(10, 13)
    assert returns.dropna().index[-1] == _day(10, 12)


def test_idle_after_withdrawal_series_ends_on_withdrawal_day():
    """Case D: as case C with no deals after the withdrawal. Nothing after 10-09 is in
    the ledger, so nothing after 10-09 is in the series: it ends on the withdrawal day
    with a stored 0.0, and a re-derive of the same ledger cannot move that end."""
    returns, meta = _combine(
        [_balance_op(9, 29, 300.0), _trade(10, 1, 20.0), _trade(10, 3, -10.0),
         _trade(10, 7, -60.0), _balance_op(10, 9, -250.0)],
        equity=40.0,
    )

    assert meta["dust_nav_guard"] is True
    assert returns.index[-1] == _day(10, 9)
    assert returns.iloc[-1] == 0.0
    assert returns.dropna().index[-1] == _day(10, 9)

    again, _meta_again = _combine(
        [_balance_op(9, 29, 300.0), _trade(10, 1, 20.0), _trade(10, 3, -10.0),
         _trade(10, 7, -60.0), _balance_op(10, 9, -250.0)],
        equity=40.0,
    )
    pd.testing.assert_series_equal(returns, again)


def test_series_continues_to_last_deal_day_while_account_keeps_trading():
    """Case E: the counterpart. The ledger keeps growing (a deal on 10-13), and the
    series follows it day for day: the idle cases above are idle because the ledger
    is, not because the derive stops early."""
    returns, _meta = _combine(
        [_balance_op(9, 29, 10_000.0), _trade(10, 1, 500.0), _trade(10, 3, -200.0),
         _trade(10, 7, 300.0), _trade(10, 13, 150.0)],
        equity=10_750.0,
    )

    assert returns.index[-1] == _day(10, 13)
    assert returns.loc[_day(10, 8):_day(10, 12)].eq(0.0).all()
    assert returns.iloc[-1] == pytest.approx(150.0 / 10_600.0)
