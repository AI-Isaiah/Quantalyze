"""The mark-consumption rule as a pure function (Phase 167.2.1.1.1 NAVMTM, plan 03).

``services.nav_marks_apply.apply_marks`` turns a realized-basis daily-return series plus
the stored marked-to-market NAVs into the series the strategy and the compose publish
from the first mark on. Why each test exists:

* D-04: the first marked day books the boundary open profit as ONE return, so cumulative
  return keeps matching the change in NAV.
* L1 / D-09: with no marks nothing changes, and no day before the first mark is touched.
* D-05 (revised 2026-10-26): a day with no mark gets no row; the next mark's single return
  spans the gap.
* SC-3: the compose's own backward roll (``replay_key_equity``) reproduces every marked
  level, so the chart and the stored mark can never disagree.

Every test reaches the module through an import inside its body, so a missing module fails
each test at call time and never as a collection error. Oracles are computed here from the
marks and flows, never by the code under test. All values are synthetic.
"""
from __future__ import annotations

import datetime as dt
import math
import random
from typing import Any

import pandas as pd
import pytest

from services.allocator_equity_derive import replay_key_equity

REALIZED_DAYS = ["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05"]
REALIZED_VALUES = [0.010, -0.005, 0.002, 0.0, 0.004]


def _series(days: list[str], values: list[float]) -> pd.Series:
    return pd.Series(values, index=days, dtype="float64")


def _realized() -> pd.Series:
    return _series(REALIZED_DAYS, REALIZED_VALUES)


def test_no_marks_returns_the_input_unchanged() -> None:
    """L1 and D-09: a key with no stored marks keeps its realized series exactly, NaN
    positions included, and every mark-derived field is empty."""
    import services.nav_marks_apply as nma

    values = list(REALIZED_VALUES)
    values[2] = float("nan")
    realized = _series(REALIZED_DAYS, values)

    out = nma.apply_marks(realized, {}, [])

    pd.testing.assert_series_equal(out.returns, realized, check_exact=True)
    assert out.marks_since is None
    assert out.mark_gap_days == ()
    assert out.flow_moves == {}
    assert out.held_out_flow_days == ()
    assert out.marked_levels == {}
    assert out.writer_day_pnl == {}
    assert out.terminal is None
    assert out.covered_from is None
    assert out.covered_days == ()


def test_first_mark_books_the_boundary_open_profit_once() -> None:
    """D-04: realized level 1000.0 at 03-05, mark 1050.0 on 03-06 means the first marked
    day returns +5 percent (the boundary open profit, booked once); the next mark's return
    is its own day-over-day change from the stored level, not another step."""
    import services.nav_marks_apply as nma

    out = nma.apply_marks(
        _realized(),
        {},
        [nma.AppliedMark("2026-03-06", 1050.0, 50.0), nma.AppliedMark("2026-03-07", 1071.0, 71.0)],
    )

    assert list(out.returns.index) == REALIZED_DAYS + ["2026-03-06", "2026-03-07"]
    # L1: every day before the first mark keeps its input value byte for byte.
    assert list(out.returns.iloc[:5]) == REALIZED_VALUES
    assert math.isclose(out.returns["2026-03-06"], 0.05, rel_tol=1e-12)
    assert math.isclose(out.returns["2026-03-07"], 0.02, rel_tol=1e-12)
    assert out.marks_since == "2026-03-06"
    assert out.terminal == ("2026-03-07", 1071.0)
    assert out.marked_levels == {"2026-03-06": 1050.0, "2026-03-07": 1071.0}


def test_cumulative_matches_the_change_in_nav() -> None:
    """The reason D-04 books the step: with no flows, compounding the emitted returns from
    the first mark on must equal the last mark over the realized level before it. The
    oracle is the two stored figures, never the function's own output."""
    import services.nav_marks_apply as nma

    realized_level = 987.65
    marks = [("2026-03-06", 1043.7), ("2026-03-07", 1089.11), ("2026-03-08", 1075.5)]

    out = nma.apply_marks(
        _realized(),
        {},
        [nma.AppliedMark(day, nav, nav - realized_level) for day, nav in marks],
    )

    compounded = 1.0
    for day, _ in marks:
        compounded *= 1.0 + out.returns[day]
    assert math.isclose(compounded, marks[-1][1] / realized_level, rel_tol=1e-12)


def test_covered_from_is_the_day_after_the_last_pre_start_day() -> None:
    """Plan 07 stamps ``covered_from`` so the runner never re-derives it from stored rows,
    which lack the NaN days. A NaN day still counts as an input day; with no input day
    before the first mark the covered stretch starts on the first mark itself."""
    import services.nav_marks_apply as nma

    nan_tail = _series(["2026-03-01", "2026-03-02", "2026-03-03"], [0.01, 0.02, float("nan")])
    out = nma.apply_marks(
        nan_tail,
        {},
        [nma.AppliedMark("2026-03-06", 510.0, 10.0)],
    )
    assert out.covered_from == "2026-03-04"

    empty = pd.Series([], dtype="float64")
    out_empty = nma.apply_marks(
        empty,
        {},
        [nma.AppliedMark("2026-03-06", 510.0, 10.0), nma.AppliedMark("2026-03-07", 520.2, 20.2)],
    )
    assert out_empty.covered_from == "2026-03-06"


def test_compose_roll_reproduces_every_marked_level() -> None:
    """SC-3 at the function level. The compose stores these rows, then rolls them back from
    the latest mark with its own ``replay_key_equity``. If the roll does not land exactly
    on each stored mark, the drawn curve and the stored NAV disagree."""
    import services.nav_marks_apply as nma

    marks = [("2026-03-06", 1050.0), ("2026-03-07", 1071.0)]
    out = nma.apply_marks(
        _realized(),
        {},
        [nma.AppliedMark(day, nav, nav - 1000.0) for day, nav in marks],
    )

    last_day, last_nav = marks[-1]
    replay = replay_key_equity(
        out.returns, [], last_nav, realized_terminal=(last_day, last_nav)
    )

    assert replay.equity is not None
    assert replay.is_trustworthy
    for day, nav in marks:
        assert abs(replay.equity[day] - nav) <= 1e-9 * nav
    # The roll also reproduces the realized level the first return was built on.
    assert abs(replay.equity["2026-03-05"] - 1000.0) <= 1e-9 * 1000.0


# ---------------------------------------------------------------------------------------
# The whole rule set: gaps, flows, held-out flows, the D-14 day-P&L roll, refusals.
# ---------------------------------------------------------------------------------------

def _flows_list(flows: dict[str, float]) -> list[tuple[str, float]]:
    return sorted(flows.items())


def _ms(moment: dt.datetime) -> int:
    return int(moment.timestamp() * 1000)


def _approx(value: float, expected: float) -> bool:
    return math.isclose(value, expected, rel_tol=1e-12, abs_tol=1e-15)


def test_a_gap_day_has_no_row_and_the_next_mark_spans_it() -> None:
    """D-05 (revised 2026-10-26): no mark on 03-07 or 03-08 means no row, no level and no
    return of their own. The 03-09 mark's single return is the observed change since 03-06,
    and the two unmarked days are named."""
    import services.nav_marks_apply as nma

    out = nma.apply_marks(
        _realized(),
        {},
        [nma.AppliedMark("2026-03-06", 1050.0, 50.0), nma.AppliedMark("2026-03-09", 1081.5, 81.5)],
    )

    assert list(out.returns.index) == REALIZED_DAYS + ["2026-03-06", "2026-03-09"]
    assert _approx(out.returns["2026-03-09"], 0.03)
    assert out.mark_gap_days == ("2026-03-07", "2026-03-08")
    assert out.marked_levels == {"2026-03-06": 1050.0, "2026-03-09": 1081.5}


def test_a_gap_flow_enters_the_base_and_a_mark_day_flow_the_numerator() -> None:
    """The base convention is forced by the compose roll: a flow on a no-return day steps
    the stored level there, so the next return's base must be the stepped level. A flow on
    the mark day itself stays in the numerator. The gap flow is dated two days after the mark,
    so it is not a read-day flow (rule 10)."""
    import services.nav_marks_apply as nma

    flows = {"2026-03-08": 100.0, "2026-03-10": -50.0}
    out = nma.apply_marks(
        _realized(),
        flows,
        [nma.AppliedMark("2026-03-06", 1050.0, 50.0), nma.AppliedMark("2026-03-10", 1250.0, 200.0)],
    )

    base = 1050.0 + 100.0
    assert _approx(out.returns["2026-03-10"], (1250.0 - base - (-50.0)) / base)
    assert out.writer_day_pnl == {
        "2026-03-06": 50.0,
        "2026-03-08": 0.0,
        "2026-03-10": 1250.0 - (1050.0 + 100.0) + 50.0,
    }

    replay = replay_key_equity(
        out.returns, _flows_list(flows), 1250.0, realized_terminal=("2026-03-10", 1250.0)
    )
    assert replay.equity is not None
    assert replay.is_trustworthy
    assert abs(replay.equity["2026-03-10"] - 1250.0) <= 1e-9 * 1250.0
    assert abs(replay.equity["2026-03-06"] - 1050.0) <= 1e-9 * 1050.0


def test_realized_rows_on_or_after_the_first_mark_are_not_emitted() -> None:
    """Pitfall 7: a realized row on a post-start day (a funding day, the 10-minute row a
    00:00Z payment creates) would be a return of its own for an unmarked day and would
    double count what the next mark's return spans. Only mark days appear from S on."""
    import services.nav_marks_apply as nma

    days = REALIZED_DAYS + ["2026-03-06", "2026-03-07", "2026-03-08", "2026-03-09"]
    realized = _series(days, REALIZED_VALUES + [0.001, 0.0007, 0.002, -0.001])

    out = nma.apply_marks(
        realized,
        {},
        [nma.AppliedMark("2026-03-06", 1050.0, 50.0), nma.AppliedMark("2026-03-08", 1060.0, 60.0)],
    )

    assert list(out.returns.index) == REALIZED_DAYS + ["2026-03-06", "2026-03-08"]


def test_a_flow_after_the_last_mark_is_held_out() -> None:
    """A flow dated after the last mark is in no base and no numerator: the derive that
    stores it later places it. It is named, and no return moves."""
    import services.nav_marks_apply as nma

    marks = [nma.AppliedMark("2026-03-06", 1050.0, 50.0), nma.AppliedMark("2026-03-07", 1071.0, 71.0)]
    baseline = nma.apply_marks(_realized(), {}, marks)
    out = nma.apply_marks(
        _realized(),
        {"2026-03-08": 200.0, "2026-03-10": 300.0},
        marks,
    )

    assert out.held_out_flow_days == ("2026-03-08", "2026-03-10")
    pd.testing.assert_series_equal(out.returns, baseline.returns, check_exact=True)
    assert out.writer_day_pnl == baseline.writer_day_pnl


def test_a_flow_after_the_read_stays_on_its_own_day_and_is_held_out() -> None:
    """D-23. A mark is read on the UTC day after its label. A flow dated that read day but made
    AFTER the read is not in the mark: it keeps its own day, so after the last mark it is held out
    for the next derive, and nothing moves."""
    import services.nav_marks_apply as nma

    read = dt.datetime(2026, 3, 10, 0, 10, tzinfo=dt.timezone.utc)
    marks = [
        nma.AppliedMark("2026-03-06", 1050.0, 50.0),
        nma.AppliedMark("2026-03-09", 1081.5, 81.5, read),
    ]
    baseline = nma.apply_marks(_realized(), {}, marks)
    after = _ms(dt.datetime(2026, 3, 10, 0, 40, tzinfo=dt.timezone.utc))
    out = nma.apply_marks(
        _realized(),
        {"2026-03-10": 100.0},
        marks,
        flow_instants=[nma.FlowInstant(after, "2026-03-10", 100.0)],
    )

    assert out.flow_moves == {}
    assert out.held_out_flow_days == ("2026-03-10",)
    pd.testing.assert_series_equal(out.returns, baseline.returns, check_exact=True)


def test_base_is_the_first_marks_wallet_rolled_back_through_its_own_day() -> None:
    """When the realized series runs past the first mark, L_real(S-1) is the first mark's own
    wallet (nav - open_pnl) rolled back one day with the compose's convention
    ``L(S-1) = (w_S - F_S) / (1 + r_S)``. Nothing after S is read: replacing every later
    realized return must move nothing. The oracle is that roll written out by hand."""
    import services.nav_marks_apply as nma

    days = REALIZED_DAYS + ["2026-03-06", "2026-03-07", "2026-03-08"]
    flows = {"2026-03-06": 40.0}
    marks = [nma.AppliedMark("2026-03-06", 1100.0, 60.0), nma.AppliedMark("2026-03-08", 1180.0, 90.0)]
    wallet = 1100.0 - 60.0
    level_05 = (wallet - 40.0) / (1.0 + 0.01)

    def run(later: list[float]) -> Any:
        return nma.apply_marks(
            _series(days, REALIZED_VALUES + [0.01, *later]), flows, marks
        )

    out = run([-0.02, 0.03])

    assert _approx(out.returns["2026-03-06"], (1100.0 - level_05 - 40.0) / level_05)
    base = 1100.0
    assert _approx(out.returns["2026-03-08"], (1180.0 - base) / base)
    assert list(out.returns.iloc[:5]) == REALIZED_VALUES
    other = run([0.2, -0.3])
    assert other.returns["2026-03-06"] == out.returns["2026-03-06"]


def test_the_first_marked_day_does_not_move_between_derives() -> None:
    """CR-01. The first marked day's return is booked ONCE (D-04). Derive B runs a day later
    on the same stored marks and the same realized rows on and before S, but the live wallet
    has moved by $2,000 that the realized P&L and flows do not explain (a spot coin revalued
    inside OKX totalEq - upl). Before the fix that $2,000 was absorbed into the rolled-back
    base, so the same stored mark published 0.05 on derive A and a different figure on B."""
    import services.nav_marks_apply as nma

    days_a = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"]
    r_a = _series(days_a, [0.01, 0.0, -0.005, 0.0, 0.0])
    marks_a = [nma.AppliedMark("2026-11-04", 105_000.0, 5_000.0),
               nma.AppliedMark("2026-11-05", 105_500.0, 5_500.0)]
    a = nma.apply_marks(r_a, {}, marks_a)

    r_b = _series(days_a + ["2026-11-06"], [0.01, 0.0, -0.005, 0.0, 0.0, 0.0])
    marks_b = [*marks_a, nma.AppliedMark("2026-11-06", 107_600.0, 5_600.0)]
    b = nma.apply_marks(r_b, {}, marks_b)

    assert _approx(a.returns["2026-11-04"], 0.05)
    assert b.returns["2026-11-04"] == a.returns["2026-11-04"]
    assert b.returns["2026-11-05"] == a.returns["2026-11-05"]


def test_a_nan_first_marked_day_uses_day_pnl_or_has_no_base() -> None:
    """A NaN realized return on S itself has no factor to divide by. The writer's day P&L
    stands in for it when it holds S (L(S-1) = w_S - P_S - F_S); otherwise S has no base, gets
    no row and is covered by the next mark (D-05). It is not a refusal: S never changes, so a
    refusal would fail every later derive too (review CR-02)."""
    import services.nav_marks_apply as nma

    days = REALIZED_DAYS + ["2026-03-06", "2026-03-07"]
    realized = _series(days, REALIZED_VALUES + [float("nan"), 0.0])
    marks = [nma.AppliedMark("2026-03-06", 1000.0, 30.0), nma.AppliedMark("2026-03-07", 1010.0, 40.0)]

    out = nma.apply_marks(realized, {}, marks, day_pnl={"2026-03-06": 20.0})
    level_05 = (1000.0 - 30.0) - 20.0
    assert _approx(out.returns["2026-03-06"], (1000.0 - level_05) / level_05)

    gap = nma.apply_marks(realized, {}, marks)
    assert "2026-03-06" not in gap.returns.index
    assert _approx(gap.returns["2026-03-07"], (1010.0 - 1000.0) / 1000.0)
    assert gap.covered_days == ("2026-03-06",)


def test_a_nan_realized_day_after_the_first_mark_is_never_read() -> None:
    """CR-02(b). The base rolls back one day from S, so a guard-NaN realized day LATER than S
    (a dust base, a pnl-dominated guard, an inception-like deposit-only day) cannot refuse the
    apply, today or on any later derive."""
    import services.nav_marks_apply as nma

    days = REALIZED_DAYS + ["2026-03-06", "2026-03-07", "2026-03-08"]
    values = REALIZED_VALUES + [0.0, float("nan"), 0.0]
    marks = [nma.AppliedMark("2026-03-06", 1050.0, 50.0), nma.AppliedMark("2026-03-08", 1071.0, 71.0)]

    out = nma.apply_marks(_series(days, values), {}, marks)

    assert _approx(out.returns["2026-03-06"], 0.05)
    assert _approx(out.returns["2026-03-08"], (1071.0 - 1050.0) / 1050.0)


def test_day_pnl_roll_basis_ignores_the_input_returns() -> None:
    """D-14: an allocated-capital input carries P&L over scheduled capital, not NAV changes,
    so rolling it by (1 + r) would roll the wrong level. Under roll_basis="day_pnl" the base
    comes from the day P&L and flows alone. Replacing every input return must move nothing
    from the first mark on."""
    import services.nav_marks_apply as nma

    days = REALIZED_DAYS + ["2026-03-06", "2026-03-07"]
    marks = [nma.AppliedMark("2026-03-06", 1900.0, 30.0), nma.AppliedMark("2026-03-07", 1910.0, 40.0)]
    day_pnl = {"2026-03-06": 20.0, "2026-03-07": 5.0}
    flows = {"2026-03-06": 100.0}

    def run(value_each: float) -> Any:
        return nma.apply_marks(
            _series(days, [value_each] * len(days)),
            flows,
            marks,
            day_pnl=day_pnl,
            roll_basis="day_pnl",
        )

    out = run(0.01)
    level_05 = (1900.0 - 30.0) - 20.0 - 100.0
    assert level_05 == 1750.0
    assert _approx(out.returns["2026-03-06"], (1900.0 - 1750.0 - 100.0) / 1750.0)
    assert _approx(out.returns["2026-03-07"], (1910.0 - 1900.0) / 1900.0)
    assert list(out.returns.iloc[:5]) == [0.01] * 5

    other = run(0.5)
    pd.testing.assert_series_equal(
        other.returns.loc[["2026-03-06", "2026-03-07"]],
        out.returns.loc[["2026-03-06", "2026-03-07"]],
        check_exact=True,
    )


def test_day_pnl_roll_basis_with_no_pnl_reads_the_day_as_flat() -> None:
    """A day absent from the day P&L is P = 0 with its flow, so an empty P&L leaves the base at
    the first mark's wallet less its own flow. It is not a refusal: an empty ledger window
    repeats on every derive."""
    import services.nav_marks_apply as nma

    days = REALIZED_DAYS + ["2026-03-06", "2026-03-07"]
    realized = _series(days, [0.01] * len(days))
    out = nma.apply_marks(
        realized, {}, [nma.AppliedMark("2026-03-06", 1900.0, 50.0)], roll_basis="day_pnl"
    )
    assert _approx(out.returns["2026-03-06"], 50.0 / 1850.0)


def test_a_mark_with_no_usable_base_is_a_gap_the_next_mark_covers() -> None:
    """CR-02 / D-05 "No row; next mark covers it". Marks and flows are history, so a refusal
    here would repeat on every later derive for ever. An owner empties the account on 03-07
    (that day's mark was refused dust, so none is stored) and refunds it on 03-08: the 03-08
    mark's base is 1000 + (-1000) = 0, which has no return. The mark is pinned at 500, so the
    NEXT mark measures from it and the series heals. The 03-06 mark keeps its row (a flat 0.0:
    nothing moved before the flows); the days after it up to 03-08 are covered by one return."""
    import services.nav_marks_apply as nma

    realized = _series(REALIZED_DAYS, [0.0] * 5)
    flows = {"2026-03-07": -1000.0, "2026-03-08": 500.0}
    marks = [
        nma.AppliedMark("2026-03-06", 1000.0, 0.0),
        nma.AppliedMark("2026-03-08", 500.0, 0.0),
        nma.AppliedMark("2026-03-09", 505.0, 5.0),
    ]

    out = nma.apply_marks(realized, flows, marks)

    assert list(out.returns.index) == REALIZED_DAYS + ["2026-03-06", "2026-03-09"]
    assert _approx(out.returns["2026-03-06"], 0.0)
    assert _approx(out.returns["2026-03-09"], 0.01)
    assert out.mark_gap_days == ("2026-03-07", "2026-03-08")
    assert out.covered_days == ("2026-03-07", "2026-03-08")
    # The writer basis still steps the compose's level by both flows on days with no return.
    assert out.writer_day_pnl == {
        "2026-03-06": 0.0, "2026-03-07": 0.0, "2026-03-08": 0.0, "2026-03-09": 5.0
    }
    replay = replay_key_equity(
        out.returns, _flows_list(flows), 505.0, realized_terminal=("2026-03-09", 505.0)
    )
    assert replay.equity is not None
    for day, nav in (("2026-03-08", 500.0), ("2026-03-09", 505.0)):
        assert abs(replay.equity[day] - nav) <= 1e-9 * nav


def test_a_nonpositive_first_base_is_a_gap_not_a_refusal() -> None:
    """The first mark's own base (its wallet less its own flow) can be zero or negative; S has
    no return, is pinned, and the next mark chains from it."""
    import services.nav_marks_apply as nma

    out = nma.apply_marks(
        _realized(),
        {},
        [nma.AppliedMark("2026-03-06", 1050.0, 1050.0), nma.AppliedMark("2026-03-07", 1071.0, 71.0)],
    )

    assert "2026-03-06" not in out.returns.index
    assert _approx(out.returns["2026-03-07"], (1071.0 - 1050.0) / 1050.0)
    assert out.marked_levels["2026-03-06"] == 1050.0


def test_a_base_under_the_dust_floor_is_a_gap() -> None:
    """A gap-day withdrawal that leaves a base of 50 (above zero, under a 100 dust floor) must
    not publish a return of several hundred percent: the realized path NaN-guards the same
    base. The mark is pinned and the next mark, measured from 50 + ..., is the one that counts."""
    import services.nav_marks_apply as nma

    realized = _series(REALIZED_DAYS, [0.0] * 5)
    marks = [nma.AppliedMark("2026-03-06", 1000.0, 0.0), nma.AppliedMark("2026-03-08", 400.0, 0.0)]
    flows = {"2026-03-07": -950.0}

    unguarded = nma.apply_marks(realized, flows, marks)
    assert _approx(unguarded.returns["2026-03-08"], (400.0 - 50.0) / 50.0)  # +700 percent

    guarded = nma.apply_marks(realized, flows, marks, dust_floor=100.0)
    assert "2026-03-08" not in guarded.returns.index
    assert guarded.mark_gap_days == ("2026-03-07",)


def test_a_deposit_made_before_the_mark_read_is_counted_in_that_marks_day() -> None:
    """D-23. Mark 03-07 is read at 00:10Z on 03-08. A 500.0 deposit at 00:05Z on 03-08 is inside
    that read (NAV 1600.0) but dated 03-08. Booked as dated it would be +60 percent on 03-07 (the
    deposit as profit) and -31 percent on 03-08 (the deposit as a loss). Placed by its instant it
    is a 03-07 flow: 03-07 returns (1600 - 1000 - 500) / 1000 = 10 percent and 03-08 returns
    (1604 - 1600) / 1600. The same deposit made AFTER the read (so the mark is 1100.0) stays on
    03-08 and the two days return 10 percent and (1604 - 1100 - 500) / 1100."""
    import services.nav_marks_apply as nma

    realized = _series(REALIZED_DAYS, [0.0] * 5)
    read = dt.datetime(2026, 3, 8, 0, 10, tzinfo=dt.timezone.utc)
    read_next = dt.datetime(2026, 3, 9, 0, 10, tzinfo=dt.timezone.utc)
    flows = {"2026-03-08": 500.0}

    def run(nav_07: float, deposit_at: dt.datetime) -> Any:
        marks = [
            nma.AppliedMark("2026-03-06", 1000.0, 0.0, dt.datetime(2026, 3, 7, 0, 10, tzinfo=dt.timezone.utc)),
            nma.AppliedMark("2026-03-07", nav_07, nav_07 - 1000.0, read),
            nma.AppliedMark("2026-03-08", 1604.0, 604.0, read_next),
        ]
        return nma.apply_marks(
            realized,
            flows,
            marks,
            flow_instants=[nma.FlowInstant(_ms(deposit_at), "2026-03-08", 500.0)],
        )

    before = run(1600.0, dt.datetime(2026, 3, 8, 0, 5, tzinfo=dt.timezone.utc))
    assert before.flow_moves == {"2026-03-07": 500.0}
    assert _approx(before.returns["2026-03-07"], (1600.0 - 1000.0 - 500.0) / 1000.0)
    assert _approx(before.returns["2026-03-08"], (1604.0 - 1600.0) / 1600.0)
    assert before.marked_levels["2026-03-07"] == 1600.0, "every mark is a level, none is skipped"
    assert before.mark_gap_days == () and before.covered_days == ()
    # The compose's own roll, fed the flows as the apply placed them, lands on every level.
    placed = {"2026-03-07": 500.0, "2026-03-08": 0.0}
    replay = replay_key_equity(
        before.returns, _flows_list(placed), 1604.0, realized_terminal=("2026-03-08", 1604.0)
    )
    assert replay.equity is not None
    for day, nav in (("2026-03-08", 1604.0), ("2026-03-07", 1600.0), ("2026-03-06", 1000.0)):
        assert abs(replay.equity[day] - nav) <= 1e-9 * nav

    after = run(1100.0, dt.datetime(2026, 3, 8, 0, 15, tzinfo=dt.timezone.utc))
    assert after.flow_moves == {}
    assert _approx(after.returns["2026-03-07"], (1100.0 - 1000.0) / 1000.0)
    assert _approx(after.returns["2026-03-08"], (1604.0 - 1100.0 - 500.0) / 1100.0)


def test_the_last_marks_read_day_flow_made_before_the_read_is_not_published_as_profit() -> None:
    """D-23, the last mark. A 500.0 deposit dated 03-07 made before the 03-06 mark's read is inside
    its NAV 1500.0, so that mark's return is (1500 - 1000 - 500) / 1000 = 0, never the +50 percent
    the flow's own day would publish. The same deposit made after the read is held out for the
    next derive and the mark returns 0 too (NAV 1000.0)."""
    import services.nav_marks_apply as nma

    realized = _series(REALIZED_DAYS, [0.0] * 5)
    read = dt.datetime(2026, 3, 7, 0, 10, tzinfo=dt.timezone.utc)

    before = nma.apply_marks(
        realized,
        {"2026-03-07": 500.0},
        [nma.AppliedMark("2026-03-06", 1500.0, 0.0, read)],
        flow_instants=[nma.FlowInstant(_ms(read - dt.timedelta(minutes=5)), "2026-03-07", 500.0)],
    )
    assert _approx(before.returns["2026-03-06"], 0.0)
    assert before.flow_moves == {"2026-03-06": 500.0}

    after = nma.apply_marks(
        realized,
        {"2026-03-07": 500.0},
        [nma.AppliedMark("2026-03-06", 1000.0, 0.0, read)],
        flow_instants=[nma.FlowInstant(_ms(read + dt.timedelta(minutes=5)), "2026-03-07", 500.0)],
    )
    assert _approx(after.returns["2026-03-06"], 0.0)
    assert after.held_out_flow_days == ("2026-03-07",)


def test_covered_days_lists_quiet_and_gap_days() -> None:
    """Callers hand ``covered_days`` to ``derive_basis_series`` so the days a stored mark's
    return covers are neither refused as gaps nor filled with a flat 0.0. That is the quiet
    days between the last pre-start day and S plus the gap days between marks."""
    import services.nav_marks_apply as nma

    out = nma.apply_marks(
        _series(REALIZED_DAYS[:3], REALIZED_VALUES[:3]),
        {},
        [
            nma.AppliedMark("2026-03-06", 510.0, 10.0),
            nma.AppliedMark("2026-03-07", 520.2, 20.2),
            nma.AppliedMark("2026-03-09", 530.0, 30.0),
        ],
    )

    assert out.covered_from == "2026-03-04"
    assert out.covered_days == ("2026-03-04", "2026-03-05", "2026-03-08")
    assert out.mark_gap_days == ("2026-03-08",)


def test_no_prior_level_means_no_return_on_the_first_mark() -> None:
    """With no input day before S there is no level to measure the first mark against, so
    S gets no row (nothing is invented, D-09), its level is still pinned, and the second
    mark chains from it. S is then a covered day: no row, covered by the next return."""
    import services.nav_marks_apply as nma

    out = nma.apply_marks(
        _series(["2026-03-06", "2026-03-07"], [0.01, 0.02]),
        {},
        [nma.AppliedMark("2026-03-06", 1050.0, 50.0), nma.AppliedMark("2026-03-07", 1071.0, 71.0)],
    )

    assert list(out.returns.index) == ["2026-03-07"]
    assert _approx(out.returns["2026-03-07"], (1071.0 - 1050.0) / 1050.0)
    assert out.marked_levels == {"2026-03-06": 1050.0, "2026-03-07": 1071.0}
    assert out.covered_from == "2026-03-06"
    assert out.covered_days == ("2026-03-06",)


def test_a_datetime_index_input_keeps_its_index_type() -> None:
    """The series derive builds a ``DatetimeIndex``; the compose reads ISO strings. Both
    must come back in the flavor they went in, or one caller silently misaligns days."""
    import services.nav_marks_apply as nma

    index = pd.DatetimeIndex(REALIZED_DAYS).as_unit("us")
    realized = pd.Series(REALIZED_VALUES, index=index, dtype="float64")

    out = nma.apply_marks(
        realized,
        {},
        [nma.AppliedMark("2026-03-06", 1050.0, 50.0)],
    )

    assert isinstance(out.returns.index, pd.DatetimeIndex)
    assert out.returns.index.unit == "us"
    assert out.returns.index[-1] == pd.Timestamp("2026-03-06")
    assert out.returns.iloc[-1] == pytest.approx(0.05, rel=1e-12)


def _default_call(**overrides: Any) -> Any:
    import services.nav_marks_apply as nma

    args: dict[str, Any] = {
        "returns": _realized(),
        "flows_by_day": {},
        "marks": [nma.AppliedMark("2026-03-06", 1050.0, 50.0), nma.AppliedMark("2026-03-07", 1071.0, 71.0)],
    }
    args.update(overrides)
    return nma.apply_marks(
        args.pop("returns"),
        args.pop("flows_by_day"),
        args.pop("marks"),
        **args,
    )


def _refusal_cases() -> list[Any]:
    import services.nav_marks_apply as nma

    mark = nma.AppliedMark
    return [
        pytest.param(
            {"marks": [mark("2026-03-06", float("nan"), 50.0)]},
            "mark_input_nonfinite",
            id="nan-nav",
        ),
        pytest.param(
            {"marks": [mark("2026-03-06", 1050.0, float("nan"))]},
            "mark_input_nonfinite",
            id="nan-open-pnl",
        ),
        pytest.param(
            {"flows_by_day": {"2026-03-06": float("inf")}},
            "mark_input_nonfinite",
            id="infinite-flow",
        ),
        pytest.param(
            {"marks": [mark("2026-03-06", 1050.0, 50.0), mark("2026-03-06", 1060.0, 60.0)]},
            "mark_days_not_ascending",
            id="duplicate-mark-day",
        ),
        pytest.param(
            {"marks": [mark("2026-03-07", 1071.0, 71.0), mark("2026-03-06", 1050.0, 50.0)]},
            "mark_days_not_ascending",
            id="unsorted-mark-days",
        ),
    ]


@pytest.mark.parametrize(("overrides", "token"), _refusal_cases())
def test_inputs_the_rule_cannot_apply_are_refused_by_token(
    overrides: dict[str, Any], token: str
) -> None:
    """L3: an input the rule cannot apply raises one closed token with static text. The
    text feeds job rows and logs, so it must carry no amount (T-167.2.1.1.1-11); static
    text has no digit at all, which is stricter than 'no input digit'."""
    import services.nav_marks_apply as nma

    with pytest.raises(nma.MarkApplyRefusal) as excinfo:
        _default_call(**overrides)

    assert excinfo.value.token == token
    assert token in nma.MARK_APPLY_REFUSAL_TOKENS
    assert str(excinfo.value) == f"mark apply refused ({token})"
    assert not any(ch.isdigit() for ch in str(excinfo.value))


def test_the_token_set_is_closed() -> None:
    """A caller that matches on tokens must be able to enumerate them."""
    import services.nav_marks_apply as nma

    assert nma.MARK_APPLY_REFUSAL_TOKENS == frozenset(
        {
            "mark_input_nonfinite",
            "mark_days_not_ascending",
        }
    )
    with pytest.raises(ValueError):
        nma.MarkApplyRefusal("not_a_token")


def _random_case(rng: random.Random) -> dict[str, Any]:
    """A seeded realized history, flows and marks. Levels stay far from zero."""
    n_pre = rng.randint(2, 6)
    first = 739000 + rng.randint(0, 200)
    pre_days = [first + k for k in range(n_pre)]
    start = pre_days[-1] + 1 + rng.randint(0, 2)
    mark_days: list[int] = [start]
    for _ in range(rng.randint(1, 5)):
        mark_days.append(mark_days[-1] + 1 + rng.randint(0, 3))
    navs = []
    level = 1000.0 + rng.uniform(-200.0, 200.0)
    for _ in mark_days:
        level *= 1.0 + rng.uniform(-0.04, 0.05)
        navs.append(level)
    flows: dict[int, float] = {}
    for day in range(start, mark_days[-1] + 1):
        if rng.random() < 0.3:
            flows[day] = rng.choice([-1.0, 1.0]) * rng.uniform(1.0, 60.0)
    return {
        "pre_days": pre_days,
        "pre_returns": [rng.uniform(-0.02, 0.02) for _ in pre_days],
        "terminal_level": 900.0 + rng.uniform(-100.0, 300.0),
        "marks": list(zip(mark_days, navs)),
        "flows": flows,
    }


def _iso_of(ordinal: int) -> str:
    return dt.date.fromordinal(ordinal).isoformat()


def test_compose_roll_property_over_random_marks_and_flows() -> None:
    """SC-3 as a property: over seeded random histories, gaps and flows, the compose's own
    ``replay_key_equity`` rolled back from the latest mark lands on every stored mark. The
    oracle is the compose, not this module."""
    import services.nav_marks_apply as nma

    rng = random.Random(20261026)
    for _ in range(300):
        case = _random_case(rng)
        pre_iso = [_iso_of(d) for d in case["pre_days"]]
        realized = _series(pre_iso, case["pre_returns"])
        flows = {_iso_of(d): v for d, v in case["flows"].items()}
        # The first mark's wallet puts the realized level before it at ``terminal_level``.
        first_day = _iso_of(case["marks"][0][0])
        wallet0 = case["terminal_level"] + flows.get(first_day, 0.0)
        marks = [
            nma.AppliedMark(_iso_of(d), nav, nav - (wallet0 if k == 0 else nav))
            for k, (d, nav) in enumerate(case["marks"])
        ]

        out = nma.apply_marks(realized, flows, marks)

        last = marks[-1]
        in_window = {d: v for d, v in flows.items() if d <= last.day}
        replay = replay_key_equity(
            out.returns,
            _flows_list(in_window),
            last.nav,
            realized_terminal=(last.day, last.nav),
        )
        assert replay.equity is not None
        for mark in marks:
            assert abs(replay.equity[mark.day] - mark.nav) <= 1e-9 * abs(mark.nav)


def test_first_mark_base_equals_the_compose_roll_of_the_realized_series() -> None:
    """D-04's base is the realized level the compose itself would draw the day before the
    first mark. Over seeded histories whose realized series runs past the first mark, the
    first marked return must put the stored NAV exactly one step above that level."""
    import services.nav_marks_apply as nma

    rng = random.Random(20261027)
    for _ in range(200):
        n_days = rng.randint(6, 10)
        first = 739500 + rng.randint(0, 200)
        days = [_iso_of(first + k) for k in range(n_days)]
        start_idx = rng.randint(2, n_days - 2)
        realized = _series(days, [rng.uniform(-0.02, 0.02) for _ in days])
        flows = {
            days[k]: rng.choice([-1.0, 1.0]) * rng.uniform(1.0, 40.0)
            for k in range(1, n_days)
            if rng.random() < 0.3
        }
        terminal = (days[-1], 1000.0 + rng.uniform(-100.0, 200.0))
        mark_nav = terminal[1] * (1.0 + rng.uniform(-0.05, 0.05))

        oracle = replay_key_equity(
            realized,
            _flows_list(flows),
            terminal[1],
            realized_terminal=terminal,
        )
        assert oracle.equity is not None
        level_before_start = float(oracle.equity[days[start_idx - 1]])

        wallet_at_start = float(oracle.equity[days[start_idx]])
        out = nma.apply_marks(
            realized,
            flows,
            [nma.AppliedMark(days[start_idx], mark_nav, mark_nav - wallet_at_start)],
        )

        implied = level_before_start * (1.0 + out.returns[days[start_idx]]) + flows.get(
            days[start_idx], 0.0
        )
        assert abs(implied - mark_nav) <= 1e-9 * abs(mark_nav)


# ---------------------------------------------------------------------------------------
# D-23 (review round 2 CR-01, CR-02, WR-01): real composed flows, and the first mark's read.
# ---------------------------------------------------------------------------------------

def _usdc_ledger(days: pd.DatetimeIndex, daily: float, terminal: float, flows: list[Any]) -> Any:
    from services.native_nav import NativeLedger

    return NativeLedger(
        native_pnl={"USDC": pd.Series([daily] * len(days), index=days, dtype="float64")},
        terminal_native_equity={"USDC": terminal},
        marks={},
        native_flows=flows,
        terminal_upnl_native={},
        full_history=False,
    )


def test_a_deribit_account_with_daily_settlement_keeps_one_row_per_mark_day() -> None:
    """CR-01. ``native_ledger_composed_flows`` returns a flow on EVERY NAV day, zero where none
    landed, so a rule that tests whether a day is a key of the flows dict drops almost every
    Deribit mark. Six daily marks with no flow at all must give six rows. The oracle is the stored
    NAVs: each row after the first is the day-over-day change in NAV (no flow), so compounding
    the rows lands on the last NAV."""
    import services.nav_marks_apply as nma
    from services.broker_dailies import native_ledger_composed_flows, native_ledger_day_pnl
    from services.job_worker import _iso_day_amounts

    days = pd.date_range("2026-11-01", "2026-11-09", freq="D")
    ledger = _usdc_ledger(days, 10.0, 100_000.0 + 90.0, [])
    flows = _iso_day_amounts(native_ledger_composed_flows(ledger, frozenset()))
    assert set(flows) == {d.date().isoformat() for d in days}, "the real shape: a zero on every day"
    assert all(v == 0.0 for v in flows.values())
    day_pnl = _iso_day_amounts(native_ledger_day_pnl(ledger, frozenset()))
    realized = pd.Series([1e-4] * 8, index=days[:8])
    navs = {f"2026-11-{d:02d}": 100_000.0 + 10 * d + 50 * (d - 2) for d in range(3, 9)}
    marks = [
        nma.AppliedMark(day, nav, 50.0 * (int(day[-2:]) - 2)) for day, nav in navs.items()
    ]

    out = nma.apply_marks(realized, flows, marks, day_pnl=day_pnl)

    rows = [i.date().isoformat() for i in out.returns.index if i.date().isoformat() >= "2026-11-03"]
    assert rows == list(navs), "one row per mark day"
    assert out.mark_gap_days == ()
    ordered = list(navs.values())
    for day, prev, nav in zip(list(navs)[1:], ordered, ordered[1:]):
        assert _approx(out.returns[pd.Timestamp(day)], (nav - prev) / prev)


def test_a_first_mark_deposit_made_before_the_read_publishes_the_true_step() -> None:
    """CR-02. Realized level 100,000 at the end of 11-03, open profit 2,000 at the first mark
    (11-04), no P&L after, and a 50,000 deposit dated 11-05 (the read day). Made BEFORE the 11-04
    read, it sits in the mark's wallet; the truth in both orderings is one +2 percent step and a
    flat day after it. Before D-23 the first ordering published -32 percent."""
    import services.nav_marks_apply as nma

    realized = pd.Series([0.0, 0.0, 0.0], index=pd.date_range("2026-11-01", "2026-11-03", freq="D"))
    flows = {"2026-11-05": 50_000.0}
    read = dt.datetime(2026, 11, 5, 0, 10, tzinfo=dt.timezone.utc)
    read_next = dt.datetime(2026, 11, 6, 0, 10, tzinfo=dt.timezone.utc)

    def run(nav_s: float, deposit_at: dt.datetime) -> Any:
        marks = [
            nma.AppliedMark("2026-11-04", nav_s, 2_000.0, read),
            nma.AppliedMark("2026-11-05", 152_000.0, 2_000.0, read_next),
            nma.AppliedMark("2026-11-06", 152_000.0, 2_000.0, read_next + dt.timedelta(days=1)),
        ]
        return nma.apply_marks(
            realized, flows, marks,
            flow_instants=[nma.FlowInstant(_ms(deposit_at), "2026-11-05", 50_000.0)],
        )

    for label, out in (
        ("before the read", run(152_000.0, read - dt.timedelta(minutes=5))),
        ("after the read", run(102_000.0, read + dt.timedelta(minutes=5))),
    ):
        rows = {i.date().isoformat(): v for i, v in out.returns.items() if i.date().isoformat() >= "2026-11-04"}
        assert _approx(rows["2026-11-04"], 0.02), label
        assert _approx((1 + out.returns).prod() - 1, 0.02), label
