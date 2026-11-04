"""Phase 188 TINYBASE plan 02 - the realized era: a day whose starting NAV is a sliver of the
account's recent peak has no return (188 D-02, D-03, D-04, SC-5, T-A1).

What this pins
--------------
``chain_linked_twr`` is the one place the realized era turns a NAV series into returns. The rule
(``services.tiny_base``, plan 01) says a day is tiny-base when its starting NAV is positive and
strictly under 5% of the highest end-of-day level over the previous 30 calendar days. Such a day
is the fourth member of the "this day has no return" family: NaN (never a substituted number),
the guard flag ``tiny_base_guard``, and the day's real P&L kept in ``tiny_base_day_pnl``.

Key C's shape, synthetic: 31 days at about 100000 (ordinary P&L), then a withdrawal day that
leaves a NAV of 400. The withdrawal day's own start NAV is normal (about 100000), so it is
measured (P&L 0, so a return of exactly 0.0). The three days after it open on 400, 588 and 278:
all under 5% of the 30-day peak, so all tiny. Their P&L is nav - prev - flow = 588 - 400 = +188,
278 - 588 = -310, 249 - 278 = -29. Without the rule the three returns are +0.47, -310/588 and
-29/278, which is the +47% / -53% the founder saw.

D-04 (founder 2026-11-03, "Split by era"): in the realized era a tiny day is a NaN that breaks
the chain like every guard day, so the headline restarts the day after the last tiny day. The
break itself is the existing ``cumulative_twr_segmented`` machinery; the test here is that the
day is NaN, never 0.0 (SC-5).

Every constant below is typed as a literal (400, 100000, 5000 = 5% of 100000), never read from
``services.tiny_base``: the oracle must not share the rule's number with the code under test.
"""
from __future__ import annotations

import math
from datetime import date, timedelta

import numpy as np
import pandas as pd
import pytest

D0 = date(2026, 2, 1)
ORDINARY = [250, -180, 310, 90, -220, 140, -60, 270, -330, 80]


def _iso(i: int) -> str:
    return (D0 + timedelta(days=i)).isoformat()


def _build(c0: int, pnl: list[int], flow: list[int]):
    """Forward NAV from an integer pre-history capital: nav_t = nav_{t-1} + pnl_t + flow_t.

    Integers throughout, so every level is exact in float."""
    idx = pd.date_range(D0.isoformat(), periods=len(pnl), freq="D").as_unit("us")
    nav: list[int] = []
    level = c0
    for p, f in zip(pnl, flow):
        level = level + p + f
        nav.append(level)
    return (
        pd.Series([float(x) for x in nav], index=idx, name="nav"),
        pd.Series([float(x) for x in pnl], index=idx, name="daily_pnl"),
        pd.Series([float(x) for x in flow], index=idx, name="flows"),
        nav,
    )


def _key_c(left: int = 400, tail: tuple[int, ...] = (188, -310, -29), ordinary_days: int = 31):
    """31 ordinary days from 100000, a withdrawal day leaving ``left``, then ``tail`` P&L days."""
    pnl = [ORDINARY[i % len(ORDINARY)] for i in range(ordinary_days)] + [0] + list(tail)
    flow = [0] * ordinary_days + [0] + [0] * len(tail)
    nav_before = 100000 + sum(pnl[:ordinary_days])
    flow[ordinary_days] = left - nav_before  # the withdrawal; the day's own P&L is 0
    return _build(100000, pnl, flow)


def _run(series, prev0: float | None = 100000.0, **kw):
    from services.nav_twr import chain_linked_twr

    nav, pnl, flows, _levels = series
    return chain_linked_twr(nav, pnl, flows, prev0=prev0, **kw)


# ── the rule, on key C's shape ───────────────────────────────────────────────


def test_the_three_days_after_a_near_total_withdrawal_have_no_return() -> None:
    series = _key_c()
    levels = series[3]
    assert levels[31] == 400  # the withdrawal day closes on 400 (start NAV about 100000)
    assert levels[32:] == [588, 278, 249]  # 400 + 188, 588 - 310, 278 - 29

    returns, flags = _run(series)

    for i in (32, 33, 34):
        assert math.isnan(returns.iloc[i]), _iso(i)
    assert flags["tiny_base_guard"] is True
    assert flags["tiny_base_days"] == [_iso(32), _iso(33), _iso(34)]
    assert flags["tiny_base_day_pnl"] == pytest.approx(
        {_iso(32): 188.0, _iso(33): -310.0, _iso(34): -29.0}, abs=1e-9
    )
    # every other day is measured, exactly pnl / prior nav (the withdrawal day: 0 / ~100000)
    assert returns.iloc[31] == 0.0
    for i in range(0, 31):
        prev = 100000 if i == 0 else levels[i - 1]
        assert returns.iloc[i] == pytest.approx(series[1].iloc[i] / prev, rel=1e-12), _iso(i)


def test_the_same_account_without_the_withdrawal_is_measured_every_day() -> None:
    """Byte-identity partner: the same 188 / -310 / -29 P&L on an account that kept its capital
    is three ordinary days (188 / 100000 and so on), and no tiny-base key appears."""
    nav_before = 100000 + sum(ORDINARY[i % 10] for i in range(31))
    pnl = [ORDINARY[i % 10] for i in range(31)] + [0, 188, -310, -29]
    series = _build(100000, pnl, [0] * len(pnl))
    returns, flags = _run(series)

    assert not returns.isna().any()
    assert returns.iloc[32] == pytest.approx(188 / nav_before, rel=1e-12)
    assert returns.iloc[33] == pytest.approx(-310 / (nav_before + 188), rel=1e-12)
    assert returns.iloc[34] == pytest.approx(-29 / (nav_before + 188 - 310), rel=1e-12)
    assert not [k for k in flags if k.startswith("tiny_base")]


@pytest.mark.parametrize(
    ("left", "tiny"),
    [
        (5000, False),  # exactly 5% of a 100000 peak: not under it, so measured
        (4999, True),  # one dollar under
    ],
    ids=["exactly-5pct-measured", "just-under-5pct-tiny"],
)
def test_the_boundary_is_strictly_under_five_percent(left: int, tiny: bool) -> None:
    """A constant 100000 for 31 days makes the 30-day peak exactly 100000, so 5% is exactly
    5000. A base of 5000 is NOT tiny; 4999 is. Flipping the comparison to <= turns the first
    case red (the boundary drill)."""
    pnl = [0] * 31 + [0, 100]
    flow = [0] * 31 + [left - 100000, 0]
    series = _build(100000, pnl, flow)
    returns, flags = _run(series)

    assert math.isnan(returns.iloc[32]) is tiny
    assert flags.get("tiny_base_guard") is (True if tiny else None)
    if not tiny:
        assert returns.iloc[32] == pytest.approx(100 / 5000, rel=1e-12)  # 0.02, a real day


def test_a_normal_start_nav_is_measured_even_when_the_day_withdraws_almost_everything() -> None:
    """The judged base is the day's STARTING NAV, not its closing level: the withdrawal day
    itself opens on about 100000 and keeps its (zero) return."""
    returns, flags = _run(_key_c())
    assert returns.iloc[31] == 0.0
    assert _iso(31) not in flags["tiny_base_days"]


# ── precedence: the fourth guard is checked last ─────────────────────────────


def test_a_day_that_is_both_pnl_dominated_and_tiny_raises_only_pnl_dominated() -> None:
    """Base 400 (under 5% of the peak, above the 100 dust floor) and a P&L of 5000, at least
    ten times the base (4000): the existing guard owns the day and the new one never fires."""
    series = _key_c(tail=(5000, 0, 0))
    returns, flags = _run(series)

    assert math.isnan(returns.iloc[32])
    assert flags["pnl_dominated_guard"] is True
    # day 33 opens on 5400, which is 5.4% of the peak: measured, not tiny
    assert not math.isnan(returns.iloc[33])
    assert "tiny_base_guard" not in flags and "tiny_base_days" not in flags


def test_a_day_that_is_both_dust_and_tiny_raises_only_dust() -> None:
    """Base 50 is under the 100 dust floor and under 5% of the peak: dust owns the day."""
    series = _key_c(left=50, tail=(10, 0, 0))
    returns, flags = _run(series)

    assert math.isnan(returns.iloc[32])
    assert flags["dust_nav_guard"] is True
    assert "tiny_base_guard" not in flags


def test_a_base_at_or_below_zero_stays_with_the_negative_guard() -> None:
    """D-05: the tiny check never sees a non-positive base."""
    series = _key_c(left=0, tail=(10, 0, 0))
    returns, flags = _run(series)

    assert math.isnan(returns.iloc[32])
    assert flags["negative_nav_guard"] is True
    assert "tiny_base_guard" not in flags


# ── a timed day is judged on its starting NAV (T-A1) ─────────────────────────


def test_a_timed_day_whose_starting_nav_is_tiny_is_left_out() -> None:
    """A day with a ``DayTiming`` record and a tiny starting NAV gets the same treatment as a
    day-level day: NaN, flagged, P&L kept. Hand: prev 400, one trade of +188, nav 588."""
    from services.nav_twr import DayTiming

    series = _key_c(tail=(188, 0, 0))
    day32 = series[0].index[32]
    timing = {day32: DayTiming(flows=(), pnl=((None, 188.0, 5000),))}
    returns, flags = _run(series, timing=timing)

    assert math.isnan(returns.iloc[32])
    assert flags["tiny_base_guard"] is True
    # the two zero-P&L days after it open on 588 and stay tiny; the timed day's P&L is 188
    assert flags["tiny_base_days"] == [_iso(32), _iso(33), _iso(34)]
    assert flags["tiny_base_day_pnl"] == pytest.approx(
        {_iso(32): 188.0, _iso(33): 0.0, _iso(34): 0.0}, abs=1e-9
    )


def test_a_timed_day_with_a_normal_starting_nav_is_measured_though_its_cohort_base_is_small() -> None:
    """T-A1: the rule is judged on ``prev``, never on a cohort base. Day 31 opens on 100000, a
    99600 withdrawal at instant 1000 leaves 400, and a trade opened at 2000 earns +188. The
    second cohort's base is 400 (a sliver of the peak) yet the day is measured: cohort 0 earns
    nothing (growth 1.0), cohort 1 earns 188 / 400 = 0.47. The NEXT day opens on 588 and is tiny."""
    from services.nav_twr import DayTiming

    pnl = [0] * 31 + [188, -310, -29]
    flow = [0] * 31 + [-99600, 0, 0]
    series = _build(100000, pnl, flow)
    assert series[3][31] == 588  # 100000 - 99600 + 188
    day31 = series[0].index[31]
    timing = {day31: DayTiming(flows=((1000, -99600.0),), pnl=((2000, 188.0, 3000),))}
    returns, flags = _run(series, timing=timing)

    assert returns.iloc[31] == pytest.approx(188 / 400, abs=1e-12)  # 0.47, measured
    assert _iso(31) not in flags.get("tiny_base_days", [])
    assert flags["tiny_base_days"] == [_iso(32), _iso(33)]  # prev 588 and 278


# ── the window sees across a sparse index, and day 0 is never tiny ───────────


def test_a_peak_that_sits_before_a_gap_in_the_nav_index_still_counts() -> None:
    """The NAV index is sparse (a no-activity day is absent). Entries on day 0 and day 1
    (100000), a withdrawal on day 31 to 400, then day 33. Day 33's window is days 3..32, which
    holds only the day-31 entry (400); the 100000 sits on day 1, before the window, and is the
    level in force at its first day, so it counts: 400 is under 5% of 100000, tiny.

    Day 32 (2026-03-05) is a quiet day, absent from the sparse index and carried at 400, under 5%
    of the 100000 peak: plan 04 lists it under 188 D-08 ("quiet days are left out too") with a
    0.0 P&L, beside the measured day 33. The peak-across-the-gap intent is unchanged."""
    from services.nav_twr import chain_linked_twr

    days = [D0 + timedelta(days=n) for n in (0, 1, 31, 33)]
    idx = pd.DatetimeIndex([pd.Timestamp(d) for d in days]).as_unit("us")
    nav = pd.Series([100000.0, 100000.0, 400.0, 588.0], index=idx)
    pnl = pd.Series([0.0, 0.0, 0.0, 188.0], index=idx)
    flows = pd.Series([0.0, 0.0, -99600.0, 0.0], index=idx)

    returns, flags = chain_linked_twr(nav, pnl, flows, prev0=100000.0)

    assert math.isnan(returns.iloc[3])
    assert flags["tiny_base_days"] == ["2026-03-05", _iso(33)]  # quiet day 32, then measured 33
    assert flags["tiny_base_day_pnl"] == pytest.approx({"2026-03-05": 0.0, _iso(33): 188.0}, abs=1e-9)


@pytest.mark.parametrize("prev0", [100000.0, None], ids=["prev0-supplied", "prev0-derived"])
def test_a_day_zero_withdrawal_makes_day_one_tiny_and_day_zero_never_is(prev0) -> None:
    """Day 0 closes on 400 after withdrawing 99600 (pre-history capital 100000, either supplied
    or reconstructed as cur - pnl - flow = 400 - 0 + 99600). Day 0's start is the 100000 itself:
    never tiny. Day 1 opens on 400, under 5% of the day-before level 100000: tiny."""
    series = _build(100000, [0, 188, -310], [-99600, 0, 0])
    returns, flags = _run(series, prev0=prev0)

    assert returns.iloc[0] == 0.0
    assert math.isnan(returns.iloc[1])
    assert flags["tiny_base_days"] == [_iso(1), _iso(2)]  # prev 400 then 588


def test_a_nan_nav_level_never_reaches_the_peak_computation_or_raises() -> None:
    """An sFOX-style unobserved day is a NaN level. It is left out of the level map (the peak
    helper refuses non-finite input), and a day whose own start NAV is NaN is not tiny."""
    nav, pnl, flows, _ = _build(100000, [0] * 40, [0] * 40)
    nav.iloc[35] = np.nan
    returns, flags = _run((nav, pnl, flows, []))

    assert math.isnan(returns.iloc[35]) and math.isnan(returns.iloc[36])
    assert "tiny_base_guard" not in flags


# ── the meta carries and the registry ────────────────────────────────────────


def test_the_meta_carries_the_flag_and_both_lists_present_only() -> None:
    from services.nav_twr import _build_nav_meta

    returns, flags = _run(_key_c())
    meta = _build_nav_meta(flags)

    assert meta["computation_status_hint"] == "complete_with_warnings"
    assert meta["tiny_base_guard"] is True
    assert meta["tiny_base_days"] == [_iso(32), _iso(33), _iso(34)]
    assert meta["tiny_base_day_pnl"] == pytest.approx(
        {_iso(32): 188.0, _iso(33): -310.0, _iso(34): -29.0}, abs=1e-9
    )

    clean = _build_nav_meta({})
    assert not [k for k in clean if k.startswith("tiny_base")]
    assert clean["computation_status_hint"] == "complete"


def test_the_annotation_alone_never_warns() -> None:
    """The two lists are annotations; only the bool promotes the status."""
    from services.nav_twr import _build_nav_meta

    meta = _build_nav_meta({"tiny_base_days": ["2026-02-02"], "tiny_base_day_pnl": {"2026-02-02": 1.0}})
    assert meta["computation_status_hint"] == "complete"
    assert "tiny_base_guard" not in meta


def test_the_transforms_merge_carries_the_flag_and_both_lists() -> None:
    from services.nav_twr import _build_nav_meta
    from services.transforms import _merge_status_meta

    _returns, flags = _run(_key_c())
    merged = _merge_status_meta(
        _build_nav_meta(flags), used_heuristic_capital=False, balance_error=False
    )
    assert merged["computation_status_hint"] == "complete_with_warnings"
    assert merged["tiny_base_guard"] is True
    assert merged["tiny_base_days"] == [_iso(32), _iso(33), _iso(34)]
    assert merged["tiny_base_day_pnl"] == pytest.approx(
        {_iso(32): 188.0, _iso(33): -310.0, _iso(34): -29.0}, abs=1e-9
    )

    clean = _merge_status_meta(_build_nav_meta({}), used_heuristic_capital=False, balance_error=False)
    assert not [k for k in clean if k.startswith("tiny_base")]


def test_the_registry_places_the_guard_last_and_the_amounts_outside_it() -> None:
    import services.nav_twr as nav_twr

    assert nav_twr.NAV_TWR_GUARD_KEYS[-1] == "tiny_base_guard"
    declared = set(nav_twr.NavTWRMeta.__annotations__)
    assert {"tiny_base_guard", "tiny_base_days", "tiny_base_day_pnl"} <= declared
    assert nav_twr.NAV_TWR_ANNOTATION_KEYS[-2:] == ("tiny_base_days", "tiny_base_day_pnl")
    # T-188-06: an amount must never ride a loop that persists or logs guard keys
    assert "tiny_base_days" not in nav_twr.NAV_TWR_GUARD_KEYS
    assert "tiny_base_day_pnl" not in nav_twr.NAV_TWR_GUARD_KEYS
