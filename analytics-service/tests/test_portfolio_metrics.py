import pandas as pd
import numpy as np
from services.portfolio_metrics import compute_twr, compute_mwr, compute_modified_dietz, compute_period_returns


def test_twr_no_cash_flows():
    """With no deposits/withdrawals, TWR equals simple return."""
    dates = pd.date_range("2026-01-01", periods=30, freq="D")
    equity = pd.Series(np.linspace(100000, 110000, 30), index=dates)
    events = []
    twr = compute_twr(equity, events)
    assert abs(twr - 0.10) < 0.01  # ~10% return


def test_twr_mid_month_deposit():
    """$200K deposit on last day should NOT distort +10%."""
    dates = pd.date_range("2026-01-01", periods=30, freq="D")
    equity_before = np.linspace(100000, 110000, 29)
    equity_after = [316050]
    equity = pd.Series(np.concatenate([equity_before, equity_after]), index=dates)
    events = [{"event_date": dates[29].isoformat(), "event_type": "deposit", "amount": 200000}]
    twr = compute_twr(equity, events)
    assert twr > 0.09, f"TWR {twr} should be > 9%"


def test_twr_day_zero_deposit():
    """Day-0 deposit (initial capital) should not create a NaN sub-period."""
    dates = pd.date_range("2026-01-01", periods=30, freq="D")
    equity = pd.Series(np.linspace(100000, 110000, 30), index=dates)
    events = [{"event_date": dates[0].isoformat(), "event_type": "deposit", "amount": 100000}]
    twr = compute_twr(equity, events)
    assert twr is not None
    assert abs(twr - 0.10) < 0.02


def test_twr_day_zero_deposit_dropped_equals_no_events():
    """H-0800: a day-0 deposit must be DROPPED by the `ev_date > start_date`
    filter, so the TWR with a day-0 event is byte-identical to the no-events
    baseline on the same equity curve.

    The pre-existing test_twr_day_zero_deposit only proved day-0 doesn't NaN-out
    (it would pass even if ALL events were ignored, since equity grows linearly).
    This asserts the SPECIFIC filter contract: dropping the `> start_date`
    guard (treating day-0 as a breakpoint) would create a degenerate
    sub-period and change the result.
    """
    dates = pd.date_range("2026-01-01", periods=30, freq="D")
    equity = pd.Series(np.linspace(100000, 110000, 30), index=dates)

    baseline = compute_twr(equity, [])
    with_day0 = compute_twr(
        equity,
        [{"event_date": dates[0].isoformat(), "event_type": "deposit", "amount": 100000}],
    )
    assert baseline is not None
    # Exact equality: the day-0 event must be filtered out entirely.
    assert with_day0 == baseline


def test_twr_day_zero_dropped_but_mid_period_handled():
    """H-0800: with BOTH a day-0 deposit (must drop) and a mid-period deposit
    (must be handled), the TWR equals the mid-period-only result.

    Equity grows 100k→110k linearly but a 200k deposit lands on day 15,
    bumping the curve. The day-0 event must not perturb the breakpoint set;
    only the mid-period deposit forms a real sub-period boundary. Hand-checked
    against the mid-only baseline below (exact equality).
    """
    dates = pd.date_range("2026-01-01", periods=30, freq="D")
    eq = np.linspace(100000, 110000, 30).copy()
    eq[15:] += 200000  # 200k deposit injected at day 15
    equity = pd.Series(eq, index=dates)

    both = compute_twr(
        equity,
        [
            {"event_date": dates[0].isoformat(), "event_type": "deposit", "amount": 100000},
            {"event_date": dates[15].isoformat(), "event_type": "deposit", "amount": 200000},
        ],
    )
    mid_only = compute_twr(
        equity,
        [{"event_date": dates[15].isoformat(), "event_type": "deposit", "amount": 200000}],
    )
    assert mid_only is not None
    # Day-0 dropped → identical to mid-period-only; ~6.84% chained return.
    assert both == mid_only
    assert abs(mid_only - 0.0683615819) < 1e-6


def test_mwr_known_sequence():
    """MWR/IRR for a known cash flow should converge."""
    cash_flows = [
        {"amount": -100000, "date": "2026-01-01"},
        {"amount": -50000, "date": "2026-06-01"},
        {"amount": 170000, "date": "2026-12-31"},
    ]
    mwr = compute_mwr(cash_flows, final_value=170000)
    assert mwr is not None
    assert 0 < mwr < 0.5


def test_mwr_single_outflow_one_year_exact_irr():
    """H-0732: pin the IRR to a hand-computed value instead of the loose
    `0 < mwr < 0.5` band.

    One outflow of -100,000 at t0; final_value 110,000 exactly one calendar
    year later (365 days). The terminal value is appended because net_cf<0,
    then NPV solves -100000 + 110000/(1+r)^(365/365.25) = 0.
    => 1+r = 1.1^(365.25/365), r ≈ 0.1000718.
    A weight/sign regression would move this materially.
    """
    mwr = compute_mwr(
        [{"amount": -100000, "date": "2025-01-01"}],
        final_value=110000,
        end_date="2026-01-01",
    )
    assert mwr is not None
    assert abs(mwr - 0.10007186) < 1e-6


def test_mwr_empty_cash_flows_returns_none():
    """H-0732(a): empty cash_flows → None (guard at top of compute_mwr)."""
    assert compute_mwr([], final_value=100000) is None


def test_mwr_terminal_not_double_counted_when_net_cf_nonnegative():
    """H-0732(d): the documented anti-double-count guard.

    When the caller already supplies the final liquidation as a cash-flow
    entry, net_cf >= 0 and the terminal final_value must NOT be appended a
    second time. Cash flows: -100,000 at t0 and +110,000 one year later
    (net_cf = +10,000 >= 0). final_value is also 110,000.

    Correct (guard ON): solve -100000 + 110000/(1+r)^t = 0 → r ≈ 0.1000718.
    Broken (guard OFF, terminal double-appended): the solver would instead
    see +220,000 of inflow against -100,000 → r ≈ 1.20. A sign flip on the
    `net_cf < 0` condition is therefore caught by this exact-value assertion.
    """
    mwr = compute_mwr(
        [
            {"amount": -100000, "date": "2025-01-01"},
            {"amount": 110000, "date": "2026-01-01"},
        ],
        final_value=110000,
    )
    assert mwr is not None
    assert abs(mwr - 0.10007181) < 1e-6
    # Guardrail: must be nowhere near the ~1.20 double-counted result.
    assert mwr < 0.5


def test_mwr_all_positive_cash_flows_unsolvable_returns_none():
    """H-0732(f): all-positive cash flows have no IRR (NPV > 0 for every
    rate > -1), so both Newton and brentq fail → None. net_cf>0 also means
    no terminal value is appended."""
    result = compute_mwr(
        [
            {"amount": 100, "date": "2025-01-01"},
            {"amount": 200, "date": "2026-01-01"},
        ],
        final_value=0,
    )
    assert result is None


def test_modified_dietz_matches_twr():
    """Modified Dietz should approximate TWR within tolerance when data is daily."""
    md = compute_modified_dietz(100000, 110000, [], 30)
    assert abs(md - 0.10) < 0.01


def test_modified_dietz_weighted_cash_flows_analytical():
    """H-0731: exercise the actual time-weighting accumulator with non-empty
    cash flows, validated against the analytical Modified Dietz formula.

    begin=100,000; period=30 days.
    Deposit 50,000 on day 0  → weight = (30-0)/30 = 1.0
    Deposit 50,000 on day 30 → weight = (30-30)/30 = 0.0
      total_cf    = 100,000
      weighted_cf = 1.0*50,000 + 0.0*50,000 = 50,000
      denominator = begin + weighted_cf = 150,000
    Choose end so the return is exactly 10%:
      numerator = 0.10 * 150,000 = 15,000
      end = begin + total_cf + numerator = 215,000
    => result = 15,000 / 150,000 = 0.10.
    """
    cash_flows = [{"amount": 50000, "day": 0}, {"amount": 50000, "day": 30}]
    md = compute_modified_dietz(100000, 215000, cash_flows, 30)
    assert md is not None
    assert abs(md - 0.10) < 1e-9


def test_modified_dietz_weight_sign_convention():
    """H-0731: pin the weight orientation `(period_days - day)/period_days`.

    A single 50,000 deposit on day 0 has weight 1.0:
      total_cf = 50,000, weighted_cf = 50,000, denominator = 150,000
      numerator = end - begin - total_cf = 160,000 - 100,000 - 50,000 = 10,000
      result = 10,000 / 150,000 = 0.0666667
    Under a sign-flipped weight `day/period_days` the day-0 weight would be
    0.0, denominator 100,000, result 0.10 — so this exact value catches the
    regression the audit describes.
    """
    md = compute_modified_dietz(100000, 160000, [{"amount": 50000, "day": 0}], 30)
    assert md is not None
    assert abs(md - (10000.0 / 150000.0)) < 1e-9


def test_modified_dietz_zero_denominator_returns_none():
    """H-0731: the denominator==0 guard. A withdrawal equal to begin_value at
    day 0 (weight 1.0) makes denominator = begin + weighted_cf = 100,000 +
    (-100,000) = 0 → None (not a division crash)."""
    md = compute_modified_dietz(100000, 50000, [{"amount": -100000, "day": 0}], 30)
    assert md is None


def test_period_returns():
    """Compute 24h, MTD, YTD returns from a returns series."""
    dates = pd.date_range("2026-01-01", periods=90, freq="D")
    returns = pd.Series(np.random.normal(0.001, 0.02, 90), index=dates)
    result = compute_period_returns(returns)
    assert "return_24h" in result
    assert "return_mtd" in result
    assert "return_ytd" in result


def test_period_returns_known_values_single_month():
    """H-0799: deterministic returns, all within one month, validated against
    hand-computed compounded values (no random seed, no key-presence-only).

    return_24h = last daily return = 0.05
    MTD/YTD compound all five days (all in March 2026):
      (1.01)(1.02)(0.99)(1.03)(1.05) - 1
    """
    dates = pd.date_range("2026-03-01", periods=5, freq="D")
    returns = pd.Series([0.01, 0.02, -0.01, 0.03, 0.05], index=dates)
    result = compute_period_returns(returns)

    expected_compound = (1.01 * 1.02 * 0.99 * 1.03 * 1.05) - 1
    assert abs(result["return_24h"] - 0.05) < 1e-12
    assert abs(result["return_mtd"] - expected_compound) < 1e-12
    assert abs(result["return_ytd"] - expected_compound) < 1e-12


def test_period_returns_mtd_excludes_prior_month():
    """H-0799: MTD must compound ONLY from the first day of the current month,
    not include prior-month data.

    Series spans Feb 27 → Mar 3 2026. last_date is Mar 3, so:
      MTD = (1.01)(1.02)(1.03) - 1   (March only, Feb 27/28 excluded)
      YTD = (1.10)(1.10)(1.01)(1.02)(1.03) - 1   (all of 2026 so far)
    """
    dates = pd.to_datetime(
        ["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02", "2026-03-03"]
    )
    returns = pd.Series([0.10, 0.10, 0.01, 0.02, 0.03], index=dates)
    result = compute_period_returns(returns)

    expected_mtd = (1.01 * 1.02 * 1.03) - 1
    expected_ytd = (1.10 * 1.10 * 1.01 * 1.02 * 1.03) - 1
    assert abs(result["return_mtd"] - expected_mtd) < 1e-12
    assert abs(result["return_ytd"] - expected_ytd) < 1e-12


def test_period_returns_ytd_resets_at_year_boundary():
    """H-0799: YTD must reset on Jan 1 — prior-year data is excluded.

    Series spans Dec 30 2025 → Jan 2 2026. last_date is Jan 2 2026, so both
    YTD and MTD compound ONLY the two January 2026 days:
      (1.05)(1.03) - 1 = 0.0815
    The two December 2025 days (+20% each) must be dropped.
    """
    dates = pd.to_datetime(["2025-12-30", "2025-12-31", "2026-01-01", "2026-01-02"])
    returns = pd.Series([0.20, 0.20, 0.05, 0.03], index=dates)
    result = compute_period_returns(returns)

    expected_jan = (1.05 * 1.03) - 1
    assert abs(result["return_ytd"] - expected_jan) < 1e-12
    assert abs(result["return_mtd"] - expected_jan) < 1e-12


def test_period_returns_empty_and_none_all_none():
    """H-0799: empty series and None both return an all-None dict."""
    empty = compute_period_returns(pd.Series([], dtype=float))
    assert empty == {"return_24h": None, "return_mtd": None, "return_ytd": None}

    none_result = compute_period_returns(None)
    assert none_result == {"return_24h": None, "return_mtd": None, "return_ytd": None}
