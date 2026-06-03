import logging

import pandas as pd
import numpy as np
import pytest
from services.portfolio_metrics import (
    compute_twr, compute_mwr, compute_modified_dietz, compute_period_returns,
    _parse_date,
)

_METRICS_LOGGER = "quantalyze.analytics.portfolio_metrics"


def test_twr_no_cash_flows():
    """With no deposits/withdrawals, TWR equals simple return."""
    dates = pd.date_range("2026-01-01", periods=30, freq="D")
    equity = pd.Series(np.linspace(100000, 110000, 30), index=dates)
    events = []
    twr = compute_twr(equity, events)
    assert abs(twr - 0.10) < 0.01  # ~10% return


def test_twr_mid_month_deposit():
    """H-0801: a $200K deposit on the last day must be SUBTRACTED before the
    sub-period ratio is formed, so it neither inflates nor over-deflates the
    return. The result is pinned exactly, not just bounded below.

    The equity curve runs 100,000 → 110,000 over the first 29 observations,
    then the 30th observation jumps to 316,050 because a 200,000 deposit lands
    that day. There is a single sub-period (start → end), so:
        begin_val     = 100,000
        end_val       = 316,050
        cf_adjustment = +200,000   (deposit on the closing breakpoint)
        end_before_cf = 316,050 - 200,000 = 116,050
        TWR           = 116,050 / 100,000 - 1 = 0.1605

    Why an EXACT assertion and not the old `twr > 0.09`: the loose lower bound
    silently passed under several over/under-adjustment regressions, each of
    which an exact pin now catches:
      - deposit NOT subtracted (end_before_cf = 316,050) → TWR = 2.1605
      - sign flipped (treated as withdrawal, +200K added) → TWR = 4.1605
      - over-removal (subtracted twice, -400K) → TWR = -1.8395
    All three exceed `> 0.09` and would have passed the original test.
    """
    dates = pd.date_range("2026-01-01", periods=30, freq="D")
    equity_before = np.linspace(100000, 110000, 29)
    equity_after = [316050]
    equity = pd.Series(np.concatenate([equity_before, equity_after]), index=dates)
    events = [{"event_date": dates[29].isoformat(), "event_type": "deposit", "amount": 200000}]
    twr = compute_twr(equity, events)
    assert twr is not None
    # Lower-bounded (return is genuinely positive) AND upper-bounded: an
    # un-subtracted or sign-flipped deposit would blow this far past 0.1605.
    assert abs(twr - 0.1605) < 1e-9, (
        f"TWR {twr} should be exactly 0.1605 — deposit must be subtracted "
        f"from the end value once, with the correct sign"
    )


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
    """M-0748: pin the IRR to its hand-computed value instead of the loose
    `0 < mwr < 0.5` band, which spanned 50 percentage points and would pass a
    buggy implementation returning anything in (0, 0.5).

    Cash flows: -100,000 @ 2026-01-01, -50,000 @ 2026-06-01, +170,000 @
    2026-12-31. net_cf = +20,000 >= 0, so the terminal-value guard does NOT
    append final_value (the +170,000 IS the terminal inflow). Year fractions
    from t0 (365.25-day basis): t = [0, 151/365.25, 364/365.25]. Solving
        -100000 - 50000/(1+r)^0.413415 + 170000/(1+r)^0.996578 = 0
    gives r ~ 0.156367 (15.64%). Matches the file's H-0732 exact-pin convention
    (test_mwr_single_outflow_one_year_exact_irr etc.).
    """
    cash_flows = [
        {"amount": -100000, "date": "2026-01-01"},
        {"amount": -50000, "date": "2026-06-01"},
        {"amount": 170000, "date": "2026-12-31"},
    ]
    mwr = compute_mwr(cash_flows, final_value=170000)
    assert mwr is not None
    assert abs(mwr - 0.15636675) < 1e-6


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
    """H-0802: compute 24h, MTD, YTD returns and check the NUMERIC values, not
    just key presence.

    The series is SEEDED (was unseeded random before) so the values are
    reproducible, and each value is validated against an INDEPENDENT oracle
    computed by positional slicing — deliberately NOT the date-mask slicing the
    production code uses, so a window-boundary regression (e.g. MTD computed as
    `idx <= month_start` instead of `>=`, or YTD failing to reset on Jan 1)
    produces a different slice and fails this test.

    Calendar: 90 daily points from 2026-01-01, so the last date is 2026-03-31.
      return_24h = the final daily return
      return_mtd = compound of March 2026 only      (positions 59..89, 31 days)
      return_ytd = compound of all of 2026 so far    (positions 0..89, 90 days)
    The original test asserted only `'return_24h' in result`, so it passed even
    if every value were None or the windows were inverted.
    """
    np.random.seed(42)
    dates = pd.date_range("2026-01-01", periods=90, freq="D")
    returns = pd.Series(np.random.normal(0.001, 0.02, 90), index=dates)
    result = compute_period_returns(returns)

    # Sanity-check the calendar assumptions the oracle relies on.
    assert dates[-1] == pd.Timestamp("2026-03-31")
    assert dates[59] == pd.Timestamp("2026-03-01")

    # Independent oracle via positional slicing (not date masks).
    expected_24h = float(returns.iloc[-1])
    expected_mtd = float(np.prod(1.0 + returns.iloc[59:].to_numpy()) - 1.0)
    expected_ytd = float(np.prod(1.0 + returns.to_numpy()) - 1.0)

    assert abs(result["return_24h"] - expected_24h) < 1e-12
    assert abs(result["return_mtd"] - expected_mtd) < 1e-12
    assert abs(result["return_ytd"] - expected_ytd) < 1e-12
    # MTD compounds strictly fewer days than YTD here, so they must differ —
    # guards against MTD silently falling back to the full-series YTD slice.
    assert abs(result["return_mtd"] - result["return_ytd"]) > 1e-6


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


# ---------------------------------------------------------------------------
# M-0695 — Modified Dietz clamps out-of-range day indices
# ---------------------------------------------------------------------------

def test_modified_dietz_clamps_day_beyond_period():
    """M-0695: a day index beyond the period must clamp to period_days (weight
    0), NOT produce a negative weight that inverts the cash flow's denominator
    contribution and flips the return's sign.

    Pre-fix, day=35 over a 30-day period gives weight = (30-35)/30 = -0.1667, so
    a +50,000 deposit contributes -8,333 to the denominator (100,000 - 8,333 =
    91,667) and the return becomes 10,000/91,667 = 0.1091 instead of the
    clamped-day-30 value 10,000/100,000 = 0.10. The two must now be equal.
    """
    over = compute_modified_dietz(100000, 160000, [{"amount": 50000, "day": 35}], 30)
    at_end = compute_modified_dietz(100000, 160000, [{"amount": 50000, "day": 30}], 30)
    assert over is not None and at_end is not None
    assert abs(over - at_end) < 1e-12, (
        "an out-of-range day (35 > period 30) must clamp to period_days, "
        "matching a day-30 cash flow (weight 0)"
    )


def test_modified_dietz_clamps_negative_day():
    """M-0695: a negative day index must clamp to 0 (weight 1.0), matching a
    day-0 deposit, rather than producing a weight > 1 that over-weights the
    cash flow."""
    neg = compute_modified_dietz(100000, 160000, [{"amount": 50000, "day": -5}], 30)
    at_start = compute_modified_dietz(100000, 160000, [{"amount": 50000, "day": 0}], 30)
    assert neg is not None and at_start is not None
    assert abs(neg - at_start) < 1e-12


# ---------------------------------------------------------------------------
# M-0696 — _parse_date fails loud on numeric epochs, no silent truncation
# ---------------------------------------------------------------------------

def test_parse_date_rejects_numeric_epoch_loudly():
    """M-0696: a numeric epoch must raise, not silently truncate to a 1970-era
    date. The old `str(value)[:10]` turned 1700000000000 into '1700000000',
    which mis-parsed with no error; numeric input now raises TypeError so the
    units bug surfaces at the boundary."""
    with pytest.raises(TypeError):
        _parse_date(1700000000000)
    with pytest.raises(TypeError):
        _parse_date(1700000000.0)


def test_parse_date_parses_iso_without_truncation():
    """M-0696: an ISO datetime string parses to its tz-naive calendar day,
    preserving the historical date-only contract (no [:10] truncation), so
    happy-path inputs are byte-compatible with the previous behaviour."""
    assert _parse_date("2026-01-03T12:30:00Z") == pd.Timestamp("2026-01-03")
    assert _parse_date("2026-01-03") == pd.Timestamp("2026-01-03")
    assert _parse_date("2026-01-03").tz is None


def test_parse_date_offset_keeps_local_calendar_day():
    """M-0696: a non-UTC offset must keep the LOCAL wall-clock calendar day
    (tz_localize(None)), matching the old str(value)[:10] prefix — NOT convert
    to UTC. Both inputs CROSS the UTC date line, so a tz_convert('UTC')
    regression would shift them to an ADJACENT day and fail here (a non-crossing
    offset like +14:00 at 23:30 would pass under both impls and is a hollow
    guard):
      01:00+05:00 -> UTC 2026-01-02 20:00 (UTC day Jan 2); local day stays Jan 3.
      23:00-05:00 -> UTC 2026-01-04 04:00 (UTC day Jan 4); local day stays Jan 3.
    """
    assert _parse_date("2026-01-03T01:00:00+05:00") == pd.Timestamp("2026-01-03")
    assert _parse_date("2026-01-03T23:00:00-05:00") == pd.Timestamp("2026-01-03")


def test_parse_date_rejects_unparseable_string_loudly():
    """M-0696: an empty/whitespace string parses to NaT, which has no
    .normalize() — the old code returned that NaT and let the caller crash with
    a cryptic AttributeError. Now it fails loud with a clear ValueError."""
    with pytest.raises(ValueError):
        _parse_date("")
    with pytest.raises(ValueError):
        _parse_date("   ")


# ---------------------------------------------------------------------------
# M-0697 — compute_mwr logs convergence failures (None-from-no-data is silent)
# ---------------------------------------------------------------------------

def test_mwr_logs_warning_on_nonconvergence(caplog):
    """M-0697: when both solvers fail to find an IRR, compute_mwr must log a
    warning so a None from non-convergence is distinguishable in the logs from
    a None from no-data. All-positive cash flows have no IRR (NPV > 0 for every
    rate > -1) so both Newton and brentq fail."""
    with caplog.at_level(logging.WARNING, logger=_METRICS_LOGGER):
        result = compute_mwr(
            [
                {"amount": 100, "date": "2025-01-01"},
                {"amount": 200, "date": "2026-01-01"},
            ],
            final_value=0,
        )
    assert result is None
    assert any(
        "converge" in r.message.lower() or "brentq" in r.message
        for r in caplog.records
    ), "non-convergence must emit a WARNING so it is distinguishable from no-data"


def test_mwr_no_data_path_stays_silent(caplog):
    """M-0697: the no-cash-flows None must NOT log a convergence warning — that
    path is genuinely 'no data', not a solver failure. This pins the
    distinction the warning exists to create."""
    with caplog.at_level(logging.WARNING, logger=_METRICS_LOGGER):
        assert compute_mwr([], final_value=100000) is None
    assert not caplog.records


# ---------------------------------------------------------------------------
# M-0698 — compute_twr warns when a meaningful sub-period is silently dropped
# ---------------------------------------------------------------------------

def test_twr_warns_on_zero_begin_value(caplog):
    """M-0698: a sub-period whose begin value is 0 (the portfolio passed through
    zero — a meaningful blow-up event) is skipped, but must WARN so the
    resulting TWR being computed from a strict subset of sub-periods is visible.
    A series starting at 0 then recovering triggers the begin_val==0 skip."""
    dates = pd.date_range("2026-01-01", periods=3, freq="D")
    equity = pd.Series([0.0, 100.0, 110.0], index=dates)
    with caplog.at_level(logging.WARNING, logger=_METRICS_LOGGER):
        result = compute_twr(equity, [])
    assert result is None  # the only sub-period was dropped
    assert any("begin_val=0" in r.message for r in caplog.records), (
        "a zero begin-value sub-period must warn, not silently continue"
    )


def test_twr_debug_logs_too_short_segment(caplog):
    """M-0698: a sub-period with only one observation in range is dropped and
    must emit a DEBUG trace. A cash-flow breakpoint that falls between two
    equity observations (no equity point on that date) splits the series into
    two single-observation sub-periods, both of which are dropped."""
    # Equity on Jan 1 and Jan 3 (no Jan 2 point); a deposit event on Jan 2
    # inserts a breakpoint, so [Jan1, Jan2] and [Jan2, Jan3] each hold one
    # equity observation -> both hit the len(segment) < 2 debug skip.
    equity = pd.Series(
        [100.0, 110.0],
        index=pd.to_datetime(["2026-01-01", "2026-01-03"]),
    )
    events = [{"event_date": "2026-01-02", "event_type": "deposit", "amount": 5}]
    with caplog.at_level(logging.DEBUG, logger=_METRICS_LOGGER):
        result = compute_twr(equity, events)
    assert result is None  # every sub-period was too short
    assert any("dropping sub-period" in r.message for r in caplog.records), (
        "a single-observation sub-period must leave a DEBUG trace, not vanish"
    )
