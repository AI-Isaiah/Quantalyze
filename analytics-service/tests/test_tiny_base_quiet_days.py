"""Phase 188 TINYBASE plan 04 - a QUIET day on a near-empty account is judged like every other
day (188 D-02, D-03, D-08, SC-2, SC-5).

Why this exists
---------------
D-03 judges EVERY day by its starting NAV. In the realized era the NAV index is sparse - the
``broker_dailies`` paragraph reads "THE INDEX IS DELIBERATELY SPARSE": a day with no P&L and no
flow is absent from it (``nav_twr._union_flow_days``). ``chain_linked_twr`` never sees such a
day, and the NAV combiners then gap-fill it to ``r = 0.0``: a flat day counted in the stats on
an account that holds 0.4% of what it ran with. The founder decided those days are left out too
(D-08, 2026-11-03, "Yes, leave them out too": "Every calendar day under the threshold is treated
the same, active or quiet").

What the two halves pin
-----------------------
* Core (``chain_linked_twr``): every calendar day strictly between two consecutive index days is
  judged against the level carried into it (the earlier index day's NAV: no flow and no P&L can
  have moved it) and the same 30-day window peak. A tiny one is listed in ``tiny_base_days``
  with a 0.0 in ``tiny_base_day_pnl`` and raises ``tiny_base_guard``. The returned series keeps
  its index exactly.
* Combiners (``combine_realized_and_funding``, ``combine_native_ledger``'s NAV path,
  ``combine_mt5_deal_ledger``): the days the meta names stay NaN after the gap fill, never 0.0.

The arithmetic is typed beside each expected value. 0.05 and 30 are restated as literals (5% of
about 100000 is about 5000; the 30-day window), never read from ``services.tiny_base``: the
oracle must not share the rule's numbers with the code under test.
"""
from __future__ import annotations

import math
from datetime import date, timedelta

import numpy as np
import pandas as pd
import pytest


# ── a sparse NAV series, built by hand from integers ─────────────────────────


def _iso(day: date) -> str:
    return day.isoformat()


def _january() -> tuple[list[date], list[int], list[int]]:
    """31 January days, each with a small NON-ZERO P&L so every one is an index day.

    The P&L is +100, -100 fifteen times (net 0) then +50 on 2026-01-31. From a pre-history
    capital of 99950 the closing level on 2026-01-31 is 99950 + 0 + 50 = 100000, and no January
    level exceeds 100050 (so 5% of any January peak is at most 5002.5, far over the 400 left
    behind by the withdrawal and far under the 6000 left in the not-tiny shape)."""
    days = [date(2026, 1, 1) + timedelta(days=i) for i in range(31)]
    pnl = [100, -100] * 15 + [50]
    return days, pnl, [0] * 31


def _series(extra: list[tuple[date, int, int]], pre: int = 99950, nan_days: tuple[date, ...] = ()):
    """January plus ``extra`` (day, pnl, flow) index days. nav_t = nav_{t-1} + pnl_t + flow_t,
    every value an integer so the levels are exact in float. Returns (nav, pnl, flows, levels)."""
    days, pnl, flow = _january()
    all_days = days + [d for d, _, _ in extra]
    all_pnl = pnl + [p for _, p, _ in extra]
    all_flow = flow + [f for _, _, f in extra]
    level = pre
    levels: list[float] = []
    for day, p, f in zip(all_days, all_pnl, all_flow):
        level = level + p + f
        levels.append(float("nan") if day in nan_days else float(level))
    idx = pd.DatetimeIndex([pd.Timestamp(d) for d in all_days]).as_unit("us")
    return (
        pd.Series(levels, index=idx, name="nav"),
        pd.Series([float(p) for p in all_pnl], index=idx, name="daily_pnl"),
        pd.Series([float(f) for f in all_flow], index=idx, name="flows"),
        levels,
    )


def _run(series, prev0: float = 99950.0):
    from services.nav_twr import chain_linked_twr

    nav, pnl, flows, _levels = series
    return chain_linked_twr(nav, pnl, flows, prev0=prev0)


def _days_between(first: date, count: int) -> list[str]:
    return [_iso(first + timedelta(days=i)) for i in range(count)]


# The withdrawal day: P&L 0, the flow takes the account from 100000 to 400 (-99600).
WITHDRAW_TO_400 = (date(2026, 2, 1), 0, -99600)
# ... or from 100000 to 6000 (-94000), which is NOT under 5% of the ~100000 peak.
WITHDRAW_TO_6000 = (date(2026, 2, 1), 0, -94000)


# ── Task 1: the core names a quiet day ───────────────────────────────────────


def test_quiet_days_after_a_near_total_withdrawal_are_named_with_zero_pnl() -> None:
    """Index: January, the withdrawal on 02-01 (400 left), then NOTHING until 02-05 (+4, 404).

    02-02, 02-03, 02-04 are absent from the index. Each opens on the carried 400, under 5% of
    the window peak (about 100000, so about 5000): tiny, P&L 0.0 (nothing happened). 02-05 is
    the measured case plan 02 already handles: prev 400, tiny, its P&L is 404 - 400 - 0 = 4."""
    series = _series([WITHDRAW_TO_400, (date(2026, 2, 5), 4, 0)])
    levels = series[3]
    assert levels[31] == 400.0 and levels[32] == 404.0  # 100000 - 99600 and 400 + 4

    returns, flags = _run(series)

    assert flags["tiny_base_days"] == ["2026-02-02", "2026-02-03", "2026-02-04", "2026-02-05"]
    assert flags["tiny_base_day_pnl"] == {
        "2026-02-02": 0.0,
        "2026-02-03": 0.0,
        "2026-02-04": 0.0,
        "2026-02-05": 4.0,
    }
    assert flags["tiny_base_guard"] is True
    # the series keeps its index exactly: no label is added for a quiet day
    assert returns.index.equals(series[0].index)
    assert math.isnan(returns.loc[pd.Timestamp("2026-02-05")])
    # the withdrawal day itself opens on 100000 and had P&L 0: measured, exactly 0.0
    assert returns.loc[pd.Timestamp("2026-02-01")] == 0.0


def test_a_quiet_day_on_a_base_that_is_not_tiny_is_not_listed() -> None:
    """The partner: 6000 left (the 5% line is about 5000), so the quiet days and 02-05 are
    ordinary. 02-05's P&L of 4 on 6000 is not P&L-dominated, so it is measured: 4 / 6000."""
    series = _series([WITHDRAW_TO_6000, (date(2026, 2, 5), 4, 0)])
    assert series[3][31] == 6000.0

    returns, flags = _run(series)

    assert not [k for k in flags if k.startswith("tiny_base")]
    assert returns.loc[pd.Timestamp("2026-02-05")] == pytest.approx(4 / 6000, rel=1e-12)


def test_the_window_rolls_off_on_a_quiet_stretch() -> None:
    """400 left on 02-01 and then nothing until 03-10 (+4).

    Day d is tiny while the 100000 level of 01-31 is inside d-30..d-1. 2026-03-02 minus 30 days
    is 2026-01-31 (February has 28 days), the last day that level is in force, so 02-02 through
    03-02 are listed: 27 February days + 2 March days = 29. On 03-03 the window starts on 02-01
    (400), its peak is 400 and 400 is not under 5% of 400: not listed, and neither are
    03-04..03-09. The measured 03-10 (start NAV 400, window 02-08..03-09, peak 400) is not tiny."""
    series = _series([WITHDRAW_TO_400, (date(2026, 3, 10), 4, 0)])

    returns, flags = _run(series)

    listed = _days_between(date(2026, 2, 2), 29)
    assert listed[0] == "2026-02-02" and listed[-1] == "2026-03-02"
    assert flags["tiny_base_days"] == listed
    assert all(flags["tiny_base_day_pnl"][day] == 0.0 for day in listed)
    for day in _days_between(date(2026, 3, 3), 7):  # 03-03 .. 03-09
        assert day not in flags["tiny_base_days"], day
    assert returns.loc[pd.Timestamp("2026-03-10")] == pytest.approx(4 / 400, rel=1e-12)


def test_a_quiet_stretch_after_an_unobserved_day_names_nothing() -> None:
    """sFOX-shaped: the earlier index day is an UNOBSERVED (NaN) day. There is no carried level,
    so nothing is listed for the days after it and nothing raises."""
    series = _series(
        [(date(2026, 2, 1), 10, 0), (date(2026, 2, 8), 10, 0)],
        nan_days=(date(2026, 2, 1),),
    )

    returns, flags = _run(series)

    assert not [k for k in flags if k.startswith("tiny_base")]
    assert returns.index.equals(series[0].index)


def test_a_day_outside_the_index_span_is_never_judged_and_no_day_is_listed_twice() -> None:
    """No day before 2026-01-01 or after the last index day is listed, and a quiet day is never
    also a guard day: the merged list has no duplicate."""
    series = _series([WITHDRAW_TO_400, (date(2026, 2, 5), 4, 0)])

    _returns, flags = _run(series)

    days = flags["tiny_base_days"]
    assert days == sorted(days) and len(days) == len(set(days))
    assert all("2026-01-31" < day <= "2026-02-05" for day in days)
    assert "2025-12-31" not in days and "2026-02-06" not in days
    assert np.isfinite(series[0].iloc[:31]).all()


# ── Task 2: the real NAV combiners leave a named quiet day NaN ───────────────
#
# Ledgers are built HERE (not with ``_mt5_deals`` / ``_usdc_native_ledger`` from
# ``test_allocator_equity_dropped_day_pnl``): ``_mt5_deals`` asserts a trading deal every day,
# precisely so the writer adds no gap-filled day, and so it cannot build a quiet day. These
# builders copy its deal shape and the native ledger's shape but carry NO entry at all for a
# quiet day: no realized record, no funding row, no native P&L entry, no deal, no flow.
#
# The account (hand arithmetic, all integers): 2026-01-01 funds 99950 and earns +100 (level
# 100050); the other January days earn +100/-100 (net 0) and +50 on 01-31 (level 100000); on
# 02-01 a withdrawal of 99600 (or 94000) leaves 400 (or 6000); 02-02..02-04 are QUIET; 02-05
# earns +4 (level 404, or 6004). Total flow 99950 - 99600 = 350, total P&L 50 + 4 = 54, and
# 350 + 54 = 404 is the terminal level the combiners anchor on.

_QUIET = ["2026-02-02", "2026-02-03", "2026-02-04"]
_TINY_LIST = [*_QUIET, "2026-02-05"]


def _entries(withdrawn: int) -> tuple[list[tuple[date, int]], list[tuple[date, int]], int]:
    """(P&L entries, flow entries, terminal level). A day with a zero P&L has no P&L entry."""
    days, pnl, _ = _january()
    pnl_entries = [(d, p) for d, p in zip(days, pnl)]
    pnl_entries.append((date(2026, 2, 5), 4))
    flow_entries = [(date(2026, 1, 1), 99950), (date(2026, 2, 1), -withdrawn)]
    terminal = 99950 + 50 + 4 - withdrawn
    return pnl_entries, flow_entries, terminal


def _ccxt_quiet(withdrawn: int):
    from services.broker_dailies import combine_realized_and_funding

    pnl_entries, flow_entries, terminal = _entries(withdrawn)
    records = [
        {
            "exchange": "okx", "symbol": "PORTFOLIO", "side": "buy" if p >= 0 else "sell",
            "price": abs(float(p)), "quantity": 1, "fee": 0, "fee_currency": "USDT",
            "timestamp": f"{_iso(d)}T00:00:00+00:00", "order_type": "daily_pnl",
        }
        for d, p in pnl_entries
    ]
    flows = [(_iso(d), float(f)) for d, f in flow_entries]
    return combine_realized_and_funding(
        records, [], account_balance=float(terminal), external_flows=flows, full_history=True
    )


def _deribit_quiet(withdrawn: int):
    from services.broker_dailies import combine_native_ledger
    from services.external_flows import ExternalFlow
    from services.native_nav import NativeLedger

    pnl_entries, flow_entries, terminal = _entries(withdrawn)
    native_pnl = pd.Series(
        [float(p) for _, p in pnl_entries],
        index=pd.DatetimeIndex([pd.Timestamp(d) for d, _ in pnl_entries]),
        name="native_pnl",
    )
    ledger = NativeLedger(
        native_pnl={"USDC": native_pnl},
        terminal_native_equity={"USDC": float(terminal)},
        marks={},
        native_flows=[ExternalFlow(_iso(d), float(f), "USDC", float(f)) for d, f in flow_entries],
        terminal_upnl_native={},
        full_history=True,
    )
    return combine_native_ledger(ledger, frozenset())


def _mt5_quiet(withdrawn: int):
    from datetime import datetime, timezone

    from services.broker_dailies import combine_mt5_deal_ledger

    def epoch(d: date) -> int:
        return int(datetime(d.year, d.month, d.day, 12, tzinfo=timezone.utc).timestamp())

    pnl_entries, flow_entries, terminal = _entries(withdrawn)
    deals = [
        {"type": 2, "profit": float(f), "swap": 0.0, "commission": 0.0, "fee": 0.0,
         "time": epoch(d)}
        for d, f in flow_entries
    ] + [
        {"type": 1, "entry": 1, "profit": float(p), "swap": 0.0, "commission": 0.0, "fee": 0.0,
         "time": epoch(d)}
        for d, p in pnl_entries
    ]
    return combine_mt5_deal_ledger(
        deals, account_equity=float(terminal), account_balance=float(terminal),
        server_utc_offset_s=0,
    )


_QUIET_VENUES = [
    pytest.param(_ccxt_quiet, id="ccxt"),
    pytest.param(_deribit_quiet, id="deribit"),
    pytest.param(_mt5_quiet, id="mt5"),
]


def _helper_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    """Make the combiners' leave-out step an identity. ``raising=False``: before the helper
    exists this simply defines it, and the NaN assertions below are the ones that fail."""
    monkeypatch.setattr(
        "services.broker_dailies._leave_out_tiny_base_days",
        lambda returns, meta: returns,
        raising=False,
    )


@pytest.mark.parametrize("combine", _QUIET_VENUES)
def test_a_quiet_tiny_day_is_nan_never_zero_on_every_nav_combiner(combine, monkeypatch) -> None:
    """02-02..02-04 carry no entry, open on the carried 400 (under 5% of the ~100000 peak, so
    under ~5000): the combiners' gap fill writes 0.0 for them today. They must be NaN (SC-5),
    the meta must list them with the measured 02-05, and every day the list does not name must
    equal what the same combiner returns with the helper disabled, as exact floats."""
    returns, meta = combine(99600)

    assert meta["tiny_base_days"] == _TINY_LIST
    for day in _TINY_LIST:
        assert math.isnan(returns.loc[pd.Timestamp(day)]), day
    assert not any(returns.loc[pd.Timestamp(day)] == 0.0 for day in _QUIET)
    # the withdrawal day opened on ~100000 with no P&L: still exactly 0.0, not left out
    assert returns.loc[pd.Timestamp("2026-02-01")] == 0.0

    _helper_disabled(monkeypatch)
    baseline, _ = combine(99600)
    assert [baseline.loc[pd.Timestamp(day)] for day in _QUIET] == [0.0, 0.0, 0.0]  # the defect
    unnamed = [ts for ts in returns.index if ts.date().isoformat() not in _TINY_LIST]
    pd.testing.assert_series_equal(
        returns.loc[unnamed], baseline.loc[unnamed], check_exact=True
    )


@pytest.mark.parametrize("combine", _QUIET_VENUES)
def test_a_quiet_day_on_a_base_that_is_not_tiny_stays_zero_on_every_nav_combiner(
    combine, monkeypatch
) -> None:
    """The partner (SC-4: only days the rule names change). 6000 is left, over the ~5000 line,
    so 02-02..02-04 stay a flat 0.0 exactly as today and the whole series, meta key included,
    equals the helper-disabled run."""
    returns, meta = combine(94000)

    assert "tiny_base_days" not in meta
    assert [returns.loc[pd.Timestamp(day)] for day in _QUIET] == [0.0, 0.0, 0.0]

    _helper_disabled(monkeypatch)
    baseline, _ = combine(94000)
    pd.testing.assert_series_equal(returns, baseline, check_exact=True)


def test_the_allocated_capital_branch_and_sfox_are_not_a_leave_out_path(monkeypatch) -> None:
    """Neither the allocated-capital branch of ``combine_native_ledger`` (not a NAV-denominator
    path) nor ``combine_sfox_balance_history`` (its chain runs on the calendar span, an
    unobserved day is already NaN) calls the helper: a helper that NaN-ed a day would show."""
    from services import broker_dailies
    from services.allocated_capital import parse_returns_denominator_config
    from services.external_flows import ExternalFlow
    from services.native_nav import NativeLedger

    calls: list[int] = []
    monkeypatch.setattr(
        "services.broker_dailies._leave_out_tiny_base_days",
        lambda returns, meta: calls.append(1) or returns,
        raising=False,
    )
    config = parse_returns_denominator_config(
        {
            "denominator": "allocated_capital",
            "pnl_basis": "cash_settlement",
            "capital_schedule": [{"effective_from": "2026-01-01", "capital_usd": 100000}],
            "metrics_basis": "active_day",
        }
    )
    pnl_entries, flow_entries, terminal = _entries(99600)
    native_pnl = pd.Series(
        [float(p) for _, p in pnl_entries],
        index=pd.DatetimeIndex([pd.Timestamp(d) for d, _ in pnl_entries]),
    )
    ledger = NativeLedger(
        native_pnl={"USDC": native_pnl},
        terminal_native_equity={"USDC": float(terminal)},
        marks={},
        native_flows=[ExternalFlow(_iso(d), float(f), "USDC", float(f)) for d, f in flow_entries],
        terminal_upnl_native={},
        full_history=True,
    )
    broker_dailies.combine_native_ledger(ledger, frozenset(), denominator_config=config)

    index = pd.DatetimeIndex([pd.Timestamp(d) for d, _ in pnl_entries]).as_unit("us")
    usd_value = pd.Series([100000.0 + i for i in range(len(index))], index=index)
    broker_dailies.combine_sfox_balance_history(usd_value, pd.Series(dtype="float64"))

    assert calls == []
