"""Phase 188 TINYBASE plan 02 - every venue combiner leaves a realized-era tiny-base day out
(SC-2) as a NaN, never a 0.0 (SC-5), and says so in its meta (D-02, D-03, D-04).

What this pins
--------------
The same synthetic account, key C's realized shape, goes through the four REAL combiners:

* ``ccxt`` - OKX/Bybit/Binance, ``combine_realized_and_funding`` (realized records + flows),
* ``deribit`` - ``combine_native_ledger`` over a USDC-shaped native ledger,
* ``sfox`` - ``combine_sfox_balance_history`` over the observed USD balance series and flows,
* ``mt5`` - ``combine_mt5_deal_ledger`` over a deal ledger.

The account: day 0 funds 100000 (with 250 of P&L), days 1..30 run ordinary P&L, day 31
withdraws almost everything (NAV 400, P&L +100), and days 32..34 carry P&L +188, -310, -29, so
their starting NAVs are 400, 588 and 278, each under 5% of the 30-day peak (about 100000).

Hand arithmetic of every expected value: the tiny days are 2026-03-05, 2026-03-06 and
2026-03-07 (day 32 + 2026-02-01 is 2026-03-05, in a 28-day February). Their P&L is the
closing level minus the starting level with no flow: 588 - 400 = 188, 278 - 588 = -310,
249 - 278 = -29.

Why each arm can fail: on code without the guard the three days hold +0.47, -310/588 and
-29/278 (finite numbers), so the NaN assertions fail; and a combiner that dropped the meta
carry fails the three meta assertions.
"""
from __future__ import annotations

from fractions import Fraction

import pandas as pd
import pytest

from tests.test_allocator_equity_dropped_day_pnl import (
    Book,
    _iso,
    _mt5_deals,
    _usdc_native_ledger,
    _window_pnl,
)

TINY_DAYS = ["2026-03-05", "2026-03-06", "2026-03-07"]
TINY_PNL = {"2026-03-05": 188.0, "2026-03-06": -310.0, "2026-03-07": -29.0}


def _key_c_book() -> Book:
    """Day 0 funds 100000; days 1..30 ordinary; day 31 withdraws to NAV 400; days 32..34 tiny."""
    pnl = [Fraction(250)] + _window_pnl(30) + [Fraction(100)] + [Fraction(p) for p in (188, -310, -29)]
    flow = [Fraction(100000)] + [Fraction(0)] * 30 + [Fraction(0)] + [Fraction(0)] * 3
    book = Book(Fraction(0), pnl, flow)
    # the withdrawal that leaves exactly 400 after day 31's +100
    withdrawal = Fraction(400) - book.nav[30] - Fraction(100)
    flow[31] = withdrawal
    return Book(Fraction(0), pnl, flow)


def _okx_record(day: str, pnl: float) -> dict:
    """Shape mirrors ``services.exchange.fetch_daily_pnl`` output."""
    return {
        "exchange": "okx",
        "symbol": "PORTFOLIO",
        "side": "buy" if pnl >= 0 else "sell",
        "price": abs(pnl),
        "quantity": 1,
        "fee": 0,
        "fee_currency": "USDT",
        "timestamp": f"{day}T00:00:00+00:00",
        "order_type": "daily_pnl",
    }


def _ccxt(book: Book):
    from services.broker_dailies import combine_realized_and_funding

    records = [_okx_record(_iso(i), float(p)) for i, p in enumerate(book.pnl)]
    flows = [(_iso(i), float(f)) for i, f in enumerate(book.flow) if f != 0]
    return combine_realized_and_funding(
        records, [], account_balance=book.anchor, external_flows=flows, full_history=True
    )


def _deribit(book: Book):
    from services.broker_dailies import combine_native_ledger

    return combine_native_ledger(_usdc_native_ledger(book), frozenset())


def _sfox(book: Book):
    from services.broker_dailies import combine_sfox_balance_history

    index = pd.DatetimeIndex([pd.Timestamp(d) for d in book.days]).as_unit("us")
    usd_value = pd.Series([float(x) for x in book.nav], index=index, name="usd_value")
    flows = pd.Series(
        {pd.Timestamp(f.utc_day_iso).as_unit("us"): f.usd_signed for f in book.flows}, name="flows"
    ).sort_index()
    return combine_sfox_balance_history(usd_value, flows)


def _mt5(book: Book):
    from services.broker_dailies import combine_mt5_deal_ledger

    return combine_mt5_deal_ledger(
        _mt5_deals(book), account_equity=book.anchor, account_balance=book.anchor,
        server_utc_offset_s=0,
    )


VENUES = [
    pytest.param(_ccxt, id="ccxt"),
    pytest.param(_deribit, id="deribit"),
    pytest.param(_sfox, id="sfox"),
    pytest.param(_mt5, id="mt5"),
]


def test_the_fixture_is_the_shape_it_claims() -> None:
    """Independent of every combiner: the closing levels and the days the arithmetic says."""
    book = _key_c_book()
    assert [_iso(i) for i in (32, 33, 34)] == TINY_DAYS
    assert [float(book.nav[i]) for i in (31, 32, 33, 34)] == [400.0, 588.0, 278.0, 249.0]
    # each tiny day opens on a level under 5% of 100000 (5000), and the withdrawal day does not
    assert [float(book.prev[i]) for i in (32, 33, 34)] == [400.0, 588.0, 278.0]
    assert float(book.prev[31]) > 90000


@pytest.mark.parametrize("combine", VENUES)
def test_a_tiny_day_is_nan_never_zero_and_the_meta_says_so(combine) -> None:
    returns, meta = combine(_key_c_book())

    for day in TINY_DAYS:
        value = returns.loc[pd.Timestamp(day)]
        assert pd.isna(value), (day, value)  # SC-5: a gap, not an invented 0.0
    assert meta["tiny_base_guard"] is True
    assert meta["tiny_base_days"] == TINY_DAYS
    assert meta["tiny_base_day_pnl"] == pytest.approx(TINY_PNL, abs=1e-6)
    assert meta["computation_status_hint"] == "complete_with_warnings"


@pytest.mark.parametrize("combine", VENUES)
def test_the_days_around_the_tiny_ones_are_unchanged(combine) -> None:
    """The day BEFORE the three (the withdrawal day, which opens on about 100000) is measured,
    and so is an ordinary day in the middle of the run: the rule touches only the tiny days."""
    book = _key_c_book()
    returns, _meta = combine(book)

    for i in (15, 31):
        value = returns.loc[pd.Timestamp(_iso(i))]
        assert pd.notna(value), _iso(i)
        assert value == pytest.approx(float(book.pnl[i] / book.prev[i]), rel=1e-9), _iso(i)


@pytest.mark.parametrize("combine", VENUES)
def test_a_clean_account_carries_no_tiny_base_key(combine) -> None:
    """The partner of the arm above: the same account that kept its capital (the withdrawal is
    replaced by nothing) has no tiny day and none of the three keys."""
    pnl = [Fraction(250)] + _window_pnl(30) + [Fraction(100)] + [Fraction(p) for p in (188, -310, -29)]
    flow = [Fraction(100000)] + [Fraction(0)] * 34
    book = Book(Fraction(0), pnl, flow)
    returns, meta = combine(book)

    assert not [k for k in meta if k.startswith("tiny_base")]
    assert returns.loc[pd.Timestamp(TINY_DAYS[0])] == pytest.approx(
        float(book.pnl[32] / book.prev[32]), rel=1e-9
    )
