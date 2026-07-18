"""SFOX-05 — the sFOX reconstruction math (Wave-0 gap closed).

Two units under test, both feeding the EXISTING primitives (never a bespoke
TWR/derive loop):

  * ``services.broker_dailies.combine_sfox_balance_history`` — the sFOX
    ``usd_value`` NAV series + typed deposit/withdraw flows → a cashflow-neutral
    daily TWR series via the EXISTING ``nav_twr.chain_linked_twr``
    (flow-in-numerator, full DQ-01 guard set). Sibling of
    ``combine_native_ledger``.
  * ``services.sfox_read`` bounded crawls + typed-flow extraction (Task 2).

P115 discipline (money-math oracles must pin ECONOMICS, never re-assert the
impl's own formula): every numeric expectation in the ``combine_*`` suite is
HAND-DERIVED in the test — computed by hand in the comment, written as a literal,
and asserted to ~1e-12. NONE of them is produced by calling the module (or
``chain_linked_twr``) and re-asserting its own output against itself. The
deposit-day anti-pin additionally proves the cashflow-neutral return is
materially different from the naive ``usd_value.pct_change()`` that would book a
deposit as return (Pitfall 1).
"""
from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest

from services.broker_dailies import combine_sfox_balance_history


# ---------------------------------------------------------------------------
# fixtures: build a NAV series + a flows series with hand-chosen values.
# ---------------------------------------------------------------------------
def _nav(values, start: str = "2026-01-01") -> pd.Series:
    """Consecutive-daily ``usd_value`` observations on an [us] DatetimeIndex."""
    idx = pd.date_range(start, periods=len(values), freq="D").as_unit("us")
    return pd.Series([float(v) for v in values], index=idx, name="usd_value")


def _flows(mapping: dict[str, float]) -> pd.Series:
    """Signed USD flow-per-day Series ({'YYYY-MM-DD': usd_signed})."""
    if not mapping:
        return pd.Series(dtype="float64", name="flows")
    days = sorted(mapping)
    idx = pd.DatetimeIndex([pd.Timestamp(d) for d in days]).as_unit("us")
    return pd.Series([float(mapping[d]) for d in days], index=idx, name="flows")


# ---------------------------------------------------------------------------
# Task 1: combine_sfox_balance_history — cashflow-neutral TWR
# ---------------------------------------------------------------------------
def test_deposit_day_books_real_pnl_not_the_deposit_hand_derived_oracle():
    """The load-bearing P115 oracle: a +500 deposit on day 2 must book ONLY the
    day's real PnL (~0.495%), never the deposit (~50%).

    NAV = [1000, 1010, 1515, 1500.15] on 4 consecutive days; +500 deposit day 2.
    HAND-DERIVED expected returns (arithmetic done BY HAND, not by the module):
      day0 = anchor (prev0 = first NAV = 1000)      -> 0.0
      day1 = (1010 - 1000) / 1000                    = 0.01
      day2 = (1515 - 1010 - 500) / 1010 = 5/1010     = 0.004950495049504950...
      day3 = (1500.15 - 1515) / 1515 = -14.85/1515   = -0.009801980198019801...
    The deposit is REMOVED from the numerator so day 2 books $5, not $500.
    """
    nav = _nav([1000.0, 1010.0, 1515.0, 1500.15], start="2026-01-01")
    flows = _flows({"2026-01-03": 500.0})

    returns, meta = combine_sfox_balance_history(nav, flows)

    assert returns.iloc[0] == pytest.approx(0.0, abs=1e-12)
    assert returns.iloc[1] == pytest.approx(0.01, abs=1e-12)
    assert returns.iloc[2] == pytest.approx(0.004950495049504950, abs=1e-12)
    assert returns.iloc[3] == pytest.approx(-0.009801980198019801, abs=1e-12)

    # The deposit day books ~0.495%, categorically NOT ~50%.
    assert abs(returns.iloc[2]) < 0.01

    # Anti-pin (Pitfall 1): the cashflow-neutral return on the deposit day is
    # materially different from the naive usd_value.pct_change() (which counts the
    # deposit as a +50% "return"). This is the check that catches a regression
    # back to usd_value.pct_change().
    naive = nav.pct_change().iloc[2]
    assert naive == pytest.approx(0.5, abs=1e-12)  # (1515 - 1010) / 1010
    assert abs(returns.iloc[2] - naive) > 0.4

    # A clean fixture fires no DQ guard.
    assert meta.get("computation_status_hint") == "complete"


def test_withdrawal_day_books_only_real_pnl():
    """Symmetric to the deposit: a -300 withdrawal books only the real PnL.

    NAV = [1000, 1010, 720, 725]; -300 withdrawal on day 2. Equity DROPS
    1010 -> 720, but 300 of that was withdrawn, so the real PnL is positive:
      day2 = (720 - 1010 - (-300)) / 1010 = 10/1010 = 0.009900990099009901
    (HAND-DERIVED.) The naive pct_change would show ~-28.7%.
    """
    nav = _nav([1000.0, 1010.0, 720.0, 725.0], start="2026-02-01")
    flows = _flows({"2026-02-03": -300.0})

    returns, meta = combine_sfox_balance_history(nav, flows)

    assert returns.iloc[2] == pytest.approx(0.009900990099009901, abs=1e-12)
    # Real PnL is POSITIVE despite equity falling — the withdrawal is removed.
    assert returns.iloc[2] > 0
    naive = nav.pct_change().iloc[2]  # (720 - 1010) / 1010 = -0.2871...
    assert naive < -0.2
    assert abs(returns.iloc[2] - naive) > 0.25


def test_day0_is_anchor_no_return():
    """A3 [ASSUMED]: prev0 = first OBSERVED usd_value → day-0 emits no movement
    (0.0 anchor); returns begin on day 1. Convention resolves empirically in the
    SFOX-06 founder evidence run — if the live run contradicts, amend HERE."""
    nav = _nav([2000.0, 2100.0], start="2026-03-01")
    returns, meta = combine_sfox_balance_history(nav, _flows({}))
    assert returns.iloc[0] == pytest.approx(0.0, abs=1e-12)
    assert returns.iloc[1] == pytest.approx(0.05, abs=1e-12)  # (2100-2000)/2000


def test_interior_missing_nav_day_breaks_that_day_and_next_never_bridged():
    """An UNOBSERVED interior NAV day is UNKNOWN, not flat: it must break, and a
    bridged multi-day return must never appear on the following day, nor may the
    missing day be fabricated as 0.0.

    Feed observes 04-01, 04-02, 04-04, 04-05 (04-03 ABSENT). Reindexed to every
    calendar day, 04-03 is NaN (never 0.0-filled) → it breaks, and 04-04 (NaN
    prev) breaks too. 04-05 (consecutive observed pair 04-04 -> 04-05) IS
    computed. The bridged (1030-1010)/1010 return must appear NOWHERE.
    """
    idx = pd.DatetimeIndex(
        [pd.Timestamp(d) for d in ("2026-04-01", "2026-04-02", "2026-04-04", "2026-04-05")]
    ).as_unit("us")
    nav = pd.Series([1000.0, 1010.0, 1030.0, 1040.0], index=idx, name="usd_value")

    returns, meta = combine_sfox_balance_history(nav, _flows({}))

    d3 = pd.Timestamp("2026-04-03").as_unit("us")
    d4 = pd.Timestamp("2026-04-04").as_unit("us")
    d5 = pd.Timestamp("2026-04-05").as_unit("us")
    assert math.isnan(returns.loc[d3])  # missing day itself breaks (not 0.0)
    assert math.isnan(returns.loc[d4])  # next day (NaN prev) also breaks
    assert returns.loc[d5] == pytest.approx((1040.0 - 1030.0) / 1030.0, abs=1e-12)

    bridged = (1030.0 - 1010.0) / 1010.0
    assert not np.any(np.isclose(returns.dropna().to_numpy(), bridged))


def test_flow_dominated_guard_fires_and_surfaces_in_meta():
    """DQ-01 inherited: |flow| >= FLOW_DOM_RATIO(1.0) * prior NAV → the day breaks
    (NaN) and flow_dominated_guard rides the meta."""
    nav = _nav([2000.0, 2010.0, 5100.0, 5110.0], start="2026-05-01")
    flows = _flows({"2026-05-03": 3000.0})  # 3000 >= 1.0 * 2010 → dominated

    returns, meta = combine_sfox_balance_history(nav, flows)

    d = pd.Timestamp("2026-05-03").as_unit("us")
    assert math.isnan(returns.loc[d])
    assert meta.get("flow_dominated_guard") is True
    assert meta.get("computation_status_hint") == "complete_with_warnings"


def test_dust_nav_guard_fires_when_prev_below_floor():
    """DQ-01 inherited: a prior NAV below DUST_NAV_FLOOR ($1000) is not a usable
    denominator → dust_nav_guard break."""
    nav = _nav([500.0, 600.0, 650.0], start="2026-06-01")
    returns, meta = combine_sfox_balance_history(nav, _flows({}))
    assert math.isnan(returns.iloc[1])  # prev = 500 < floor
    assert meta.get("dust_nav_guard") is True
    assert meta.get("computation_status_hint") == "complete_with_warnings"


def test_negative_nav_guard_fires_when_prev_nav_nonpositive():
    """DQ-01 inherited: a prior NAV of exactly 0 (divide-by-zero) → negative_nav_guard."""
    nav = _nav([2000.0, 0.0, 2000.0], start="2026-07-01")
    returns, meta = combine_sfox_balance_history(nav, _flows({}))
    d = pd.Timestamp("2026-07-03").as_unit("us")  # prev (07-02) == 0
    assert math.isnan(returns.loc[d])
    assert meta.get("negative_nav_guard") is True


def test_empty_nav_returns_empty_series_honest():
    """Degenerate: empty NAV → empty Series (honest; the <2-finite gate proper
    lives downstream in derive_basis_series)."""
    returns, meta = combine_sfox_balance_history(
        pd.Series(dtype="float64"), _flows({})
    )
    assert returns.empty


def test_single_point_nav_no_computable_return():
    """Degenerate: a single observed point has no prior day → no computable
    return; never an invented row."""
    nav = _nav([1000.0], start="2026-08-01")
    returns, meta = combine_sfox_balance_history(nav, _flows({}))
    assert returns.empty


def test_non_finite_usd_value_point_breaks_never_propagates_number():
    """A non-finite usd_value point (NaN/Inf in the feed) breaks that day AND the
    following day (NaN prev), never propagating a fabricated number."""
    nav = _nav([1000.0, float("nan"), 1030.0, 1040.0], start="2026-09-01")
    returns, meta = combine_sfox_balance_history(nav, _flows({}))
    d2 = pd.Timestamp("2026-09-02").as_unit("us")
    d3 = pd.Timestamp("2026-09-03").as_unit("us")
    d4 = pd.Timestamp("2026-09-04").as_unit("us")
    assert math.isnan(returns.loc[d2])  # the NaN point breaks
    assert math.isnan(returns.loc[d3])  # the following day (NaN prev) breaks
    assert returns.loc[d4] == pytest.approx((1040.0 - 1030.0) / 1030.0, abs=1e-12)
