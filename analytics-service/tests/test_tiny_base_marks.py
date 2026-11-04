"""Phase 188 TINYBASE plan 01 - the level map apply_marks judges the marks against (D-02, D-03, T-LM).

``apply_marks`` judges each mark's base against the highest level of the previous 30 days. The
level map is built from EVERY mark's level, always, plus the level at S-1 whenever it was
computed and is finite, usable as a base or not. These arms pin the two series a map gated on
``base0`` would leave unjudged: one with no input day before its first mark (marks only) and one
whose first base is at or below the dust floor.

Plan 03 extends this module with 188 D-02, D-03, T-GAP and T-A1 (SC-5): a withheld mark takes
the days its single return would have covered with it, so a multi-key book sits the key out of
every one of them instead of reading them at r = 0; a gap deposit lifts the base and keeps the
mark measured; the 30-day roll-off lands on the day the rule says; key C's own dates replay
exactly on the writer chain; the composite summary names the withheld days as tiny-base days
(round 1: not as covered or gap days).

Task 2 adds T-OQ4 (the 30-day window reaches before the first mark, rolled back from the S-1
level whether or not it is a usable base), the withheld first mark (T-GAP's first-mark half) and
KL-3 (a recorded limit: the roll stops at an unknown day instead of inventing a level).

Every value is synthetic and typed beside the sum it comes from. Each test imports the module
under test inside its body, so a missing module fails the test at call time.
"""
from __future__ import annotations

import pandas as pd
import pytest

from services.external_flows import ExternalFlow
from services.job_worker import DispatchOutcome
from tests.test_allocator_equity_dropped_day_pnl import _key_inputs_payload
from tests.test_nav_marks_compose_roundtrip import KeyDb, compose_curve, derive_key_ccxt
from tests.test_nav_marks_derive_apply import REALIZED_THROUGH_0305, at_0010, seed_mark, series

REALIZED_DAYS = ["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05"]


def _series(days: list[str], values: list[float]) -> pd.Series:
    return pd.Series(values, index=days, dtype="float64")


def test_a_marks_only_series_is_judged_against_its_marks() -> None:
    """No input day before the first mark, so ``base0`` is None and 03-06 has no row (today's
    rule). 03-07: base 100000, nav 100000, r = 0.0. 03-08: base 100000, flow -99600, nav 400,
    r = (400 - 100000 + 99600) / 100000 = 0.0. 03-09: base 400 against a peak of 100000 is
    under 5000, so tiny: no row, P&L 588 - 400 - 0 = 188.0. A level map built only when
    ``base0`` is not None leaves 03-09 measured at +0.47."""
    import services.nav_marks_apply as nma

    marks = [
        nma.AppliedMark("2026-03-06", 100000.0, 0.0),
        nma.AppliedMark("2026-03-07", 100000.0, 0.0),
        nma.AppliedMark("2026-03-08", 400.0, 0.0),
        nma.AppliedMark("2026-03-09", 588.0, 0.0),
    ]
    out = nma.apply_marks(
        _series(["2026-03-06"], [0.0]), {"2026-03-08": -99600.0}, marks, dust_floor=100.0
    )
    rows = {str(k)[:10]: v for k, v in out.returns.items()}
    assert "2026-03-06" not in rows  # no base: today's rule, the next mark covers it
    assert "2026-03-09" not in rows
    assert rows["2026-03-07"] == pytest.approx(0.0, abs=1e-12)
    assert rows["2026-03-08"] == pytest.approx(0.0, abs=1e-12)
    assert out.tiny_base_days == ("2026-03-09",)
    assert out.writer_day_pnl["2026-03-09"] == pytest.approx(188.0, abs=1e-9)
    assert "2026-03-09" not in out.covered_days
    assert "2026-03-09" not in out.mark_gap_days


def test_an_unusable_first_base_still_judges_the_later_marks() -> None:
    """The first mark's base is (100000 - 99950) / (1 + 0) = 50.0, at or below the 100.0 floor,
    so ``base0`` is None and 03-06 has no row. 03-07 r = (100000 - 100000 - 0) / 100000 = 0.0.
    03-09 (03-08 is a gap day it covers) r = (400 - 100000 + 99600) / 100000 = 0.0. 03-10:
    base 400 against a peak of 100000 is tiny: no row, P&L 588 - 400 - 0 = 188.0. The S-1
    level 50.0 is in the map and makes no day tiny."""
    import services.nav_marks_apply as nma

    marks = [
        nma.AppliedMark("2026-03-06", 100000.0, 0.0),
        nma.AppliedMark("2026-03-07", 100000.0, 0.0),
        nma.AppliedMark("2026-03-09", 400.0, 0.0),
        nma.AppliedMark("2026-03-10", 588.0, 0.0),
    ]
    out = nma.apply_marks(
        _series(REALIZED_DAYS, [0.0] * 5),
        {"2026-03-06": 99950.0, "2026-03-09": -99600.0},
        marks,
        dust_floor=100.0,
    )
    rows = {str(k)[:10]: v for k, v in out.returns.items()}
    assert "2026-03-06" not in rows
    assert rows["2026-03-07"] == pytest.approx(0.0, abs=1e-12)
    assert rows["2026-03-09"] == pytest.approx(0.0, abs=1e-12)
    assert "2026-03-10" not in rows
    assert out.tiny_base_days == ("2026-03-10",)
    assert out.writer_day_pnl["2026-03-10"] == pytest.approx(188.0, abs=1e-9)


# ---------------------------------------------------------------------------------------
# Plan 03, Task 1: T-GAP, the days a withheld mark's return would have covered.
# ---------------------------------------------------------------------------------------

def _flows_list(flows: dict[str, float]) -> list[tuple[str, float]]:
    return sorted(flows.items())


def _withheld_gap_marks() -> list["object"]:
    import services.nav_marks_apply as nma

    return [
        nma.AppliedMark("2026-03-06", 400.0, 0.0),
        nma.AppliedMark("2026-03-09", 588.0, 0.0),
    ]


def test_gap_days_before_a_withheld_mark_are_left_out_with_it() -> None:
    """T-GAP. The first mark's base is its wallet rolled back one day, (400 + 99600) / (1 + 0) =
    100000.0, and 03-06 r = (400 - 100000 + 99600) / 100000 = 0.0. The 03-09 mark's base is
    400 + 0 = 400.0 against the 100000.0 peak (under 5000): no row. The two gap days (03-07,
    03-08) are inside no return, so they leave with it: listed, out of the covered set, and
    given a 0.0 P&L (rule 8: the period's whole P&L, 588 - 400 - 0 = 188.0, lands on 03-09)."""
    import services.nav_marks_apply as nma

    out = nma.apply_marks(
        _series(REALIZED_DAYS, [0.0] * 5), {"2026-03-06": -99600.0}, _withheld_gap_marks()
    )
    assert out.tiny_base_days == ("2026-03-07", "2026-03-08", "2026-03-09")
    assert out.covered_days == ()
    assert out.mark_gap_days == ()
    assert out.writer_day_pnl == {
        "2026-03-06": 0.0,
        "2026-03-07": 0.0,
        "2026-03-08": 0.0,
        "2026-03-09": pytest.approx(188.0, abs=1e-9),
    }
    rows = {str(k)[:10]: v for k, v in out.returns.items()}
    assert "2026-03-09" not in rows and "2026-03-08" not in rows and "2026-03-07" not in rows


def test_a_gap_flow_before_a_withheld_mark_keeps_its_step() -> None:
    """The same, plus a +50.0 deposit on 03-08: base 400 + 50 = 450.0, still under 5000.0. The
    three days are listed; 03-07 and 03-08 hold 0.0 (the flow day keeps the 0.0 rule 8 gives it)
    and 03-09 holds 588 - 450 - 0 = 138.0. The compose's replay lands on 400.0 at 03-06 and on
    588.0 at 03-09."""
    import services.nav_marks_apply as nma
    from services.allocator_equity_derive import replay_key_equity

    flows = {"2026-03-06": -99600.0, "2026-03-08": 50.0}
    out = nma.apply_marks(_series(REALIZED_DAYS, [0.0] * 5), flows, _withheld_gap_marks())
    assert out.tiny_base_days == ("2026-03-07", "2026-03-08", "2026-03-09")
    assert out.writer_day_pnl["2026-03-07"] == 0.0
    assert out.writer_day_pnl["2026-03-08"] == 0.0
    assert out.writer_day_pnl["2026-03-09"] == pytest.approx(138.0, abs=1e-9)

    replay = replay_key_equity(
        out.returns,
        _flows_list(flows),
        588.0,
        realized_terminal=("2026-03-09", 588.0),
        dropped_day_pnl={"2026-03-07": 0.0, "2026-03-08": 0.0, "2026-03-09": 138.0},
    )
    assert replay.equity is not None
    assert replay.equity["2026-03-06"] == pytest.approx(400.0, rel=1e-9)
    assert replay.equity["2026-03-09"] == pytest.approx(588.0, rel=1e-9)


@pytest.mark.asyncio
async def test_a_two_key_book_sits_the_key_out_of_the_whole_withheld_period() -> None:
    """T-GAP end to end (SC-5, T-188-18). Plan 01's tracer fixture with marks ONLY on 03-06 (nav
    400.0) and 03-09 (nav 588.0). The stored ``dropped_day_pnl`` holds 03-07 0.0, 03-08 0.0 and
    03-09 188.0 (588 - 400 - 0). With a sibling that trades every day (flat 0.001) the book
    return on 03-07, 03-08 and 03-09 is the sibling's 0.001 exactly: the key sits out numerator
    and denominator. If the gap days stayed covered, 03-07 and 03-08 would read the key at r = 0
    at its carried level of about 400 beside the sibling's 5000, about 0.001 x 5000 / 5400."""
    db = KeyDb()
    seed_mark(db, "2026-03-06", 400.0, key="key-k", open_pnl=0.0, venue="okx")
    seed_mark(db, "2026-03-09", 588.0, key="key-k", open_pnl=0.0, venue="okx")
    result, capture = await derive_key_ccxt(
        db,
        returns=series(REALIZED_THROUGH_0305),
        now=at_0010("2026-03-10"),
        equity=588.0,
        upl=0.0,
        flows=[ExternalFlow(utc_day_iso="2026-03-06", usd_signed=-99600.0)],
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    rows = db.rows()
    for day in ("2026-03-07", "2026-03-08", "2026-03-09"):
        assert day not in rows
    stored = {
        r["utc_day_iso"]: r["pnl_usd"]
        for r in _key_inputs_payload(capture, "key-k")["dropped_day_pnl"]
    }
    assert sorted(stored) == ["2026-03-07", "2026-03-08", "2026-03-09"]
    assert stored["2026-03-07"] == 0.0
    assert stored["2026-03-08"] == 0.0
    assert stored["2026-03-09"] == pytest.approx(188.0, abs=1e-9)

    sibling_days = [f"2026-03-{d:02d}" for d in range(1, 10)]
    payload = await compose_curve(db, capture, sibling_days=sibling_days)
    book = {row["date"]: row["r"] for row in payload["returns"]}
    for day in ("2026-03-07", "2026-03-08", "2026-03-09"):
        assert book[day] == pytest.approx(0.001, abs=1e-12), f"{day} read the key at r = 0"


def test_key_c_dates_on_the_writer_chain_replay_every_marked_level() -> None:
    """Key C's own shape on the writer chain (synthetic dates, 2026-10-26 is S). The writer sat
    at 100000.0 at the end of 10-25 and a -99600.0 withdrawal lands on 10-26. Marks 400.0,
    588.0, 278.0, 249.0 on 10-26..10-29. 10-26: base 100000, r = (400 - 100000 + 99600) / 1e5 =
    0.0. 10-27..10-29 are tiny (400, 588, 278 against a 100000 peak): no row, P&L 588 - 400 =
    +188.0, 278 - 588 = -310.0, 249 - 278 = -29.0, none of them in the covered set. The
    compose's replay over the output, the writer basis and the three dropped P&L reproduces
    every marked level."""
    import services.nav_marks_apply as nma
    from services.allocator_equity_derive import replay_key_equity

    pre_days = [f"2026-10-{d:02d}" for d in range(20, 26)]
    flows = {"2026-10-26": -99600.0}
    marks = [
        nma.AppliedMark("2026-10-26", 400.0, 0.0),
        nma.AppliedMark("2026-10-27", 588.0, 0.0),
        nma.AppliedMark("2026-10-28", 278.0, 0.0),
        nma.AppliedMark("2026-10-29", 249.0, 0.0),
    ]
    out = nma.apply_marks(
        _series(pre_days, [0.0] * 6),
        flows,
        marks,
        day_pnl={"2026-10-25": 0.0},
        writer_terminal=("2026-10-25", 100000.0),
    )
    rows = {str(k)[:10]: v for k, v in out.returns.items()}
    assert rows["2026-10-26"] == pytest.approx(0.0, abs=1e-12)
    for day in ("2026-10-27", "2026-10-28", "2026-10-29"):
        assert day not in rows
    assert out.tiny_base_days == ("2026-10-27", "2026-10-28", "2026-10-29")
    for day, pnl in (("2026-10-27", 188.0), ("2026-10-28", -310.0), ("2026-10-29", -29.0)):
        assert out.writer_day_pnl[day] == pytest.approx(pnl, abs=1e-9)
        assert day not in out.covered_days and day not in out.mark_gap_days

    dropped = {d: out.writer_day_pnl[d] for d in out.tiny_base_days}
    replay = replay_key_equity(
        out.returns,
        _flows_list(flows),
        249.0,
        realized_terminal=("2026-10-29", 249.0),
        dropped_day_pnl=dropped,
        writer_day_pnl=out.writer_day_pnl,
        writer_flows=_flows_list(flows),
    )
    assert replay.equity is not None
    for day, nav in (
        ("2026-10-26", 400.0), ("2026-10-27", 588.0), ("2026-10-28", 278.0), ("2026-10-29", 249.0),
    ):
        assert replay.equity[day] == pytest.approx(nav, rel=1e-9), f"the replay lost {day}"
    assert replay.equity["2026-10-25"] == pytest.approx(100000.0, rel=1e-9)


def test_roll_off_the_thirty_first_day_is_measured_again() -> None:
    """D-03. After the same withdrawal daily marks stay at 400.0 through 11-26. The 100000.0
    level is the S-1 level (10-25). A day t counts the previous 30 days t-30..t-1, so 10-25 is in
    t's window while t - 30 <= 10-25, i.e. through t = 11-24 (11-24 minus 30 days is 10-25); on
    11-25 the peak is 400.0 and the base 400.0 is no longer tiny. Tiny days are 10-27 through
    11-24: 5 in October (27..31) + 24 in November = 29."""
    import services.nav_marks_apply as nma
    from datetime import date, timedelta

    pre_days = [f"2026-10-{d:02d}" for d in range(20, 26)]
    days = [date(2026, 10, 26) + timedelta(days=k) for k in range(32)]
    assert days[-1] == date(2026, 11, 26)
    marks = [nma.AppliedMark(d.isoformat(), 400.0, 0.0) for d in days]
    out = nma.apply_marks(
        _series(pre_days, [0.0] * 6),
        {"2026-10-26": -99600.0},
        marks,
        day_pnl={"2026-10-25": 0.0},
        writer_terminal=("2026-10-25", 100000.0),
    )
    expected = tuple(
        (date(2026, 10, 27) + timedelta(days=k)).isoformat() for k in range(29)
    )
    assert expected[0] == "2026-10-27" and expected[-1] == "2026-11-24"
    assert out.tiny_base_days == expected
    rows = {str(k)[:10]: v for k, v in out.returns.items()}
    assert rows["2026-11-25"] == pytest.approx(0.0, abs=1e-12)
    assert rows["2026-11-26"] == pytest.approx(0.0, abs=1e-12)
    assert "2026-11-24" not in rows


def test_a_gap_deposit_that_lifts_the_base_keeps_the_mark_measured() -> None:
    """T-A1: the gap flow is in the base, so T-GAP never fires on a measured mark. Marks on
    03-06 (nav 400.0, after a -99600.0 withdrawal that day) and 03-09; a +9600.0 deposit on 03-08
    makes the 03-09 base 400 + 9600 = 10000.0, over 5% of 100000.0 (5000.0): 03-09 has a row
    r = (10100 - 10000 - 0) / 10000 = 0.01, and nothing is listed."""
    import services.nav_marks_apply as nma

    marks = [
        nma.AppliedMark("2026-03-06", 400.0, 0.0),
        nma.AppliedMark("2026-03-09", 10100.0, 0.0),
    ]
    out = nma.apply_marks(
        _series(REALIZED_DAYS, [0.0] * 5),
        {"2026-03-06": -99600.0, "2026-03-08": 9600.0},
        marks,
    )
    assert out.tiny_base_days == ()
    rows = {str(k)[:10]: v for k, v in out.returns.items()}
    assert rows["2026-03-09"] == pytest.approx(0.01, abs=1e-12)
    assert out.covered_days == ("2026-03-07", "2026-03-08")


def test_the_composite_summary_names_the_withheld_days_as_tiny_base_not_covered() -> None:
    """Plan 09 composites read each member's covered and gap days through
    ``_composite_mark_summary``. The withheld gap days are in neither list, so the composite
    cannot hand them to ``coverage_mask`` as covered. Round 1 (HIGH-1, D-09): the summary now
    NAMES them as ``tiny_base_days`` so the composite leaves them out of its scalar input
    instead of 0.0-filling them (the earlier arm asserted the days were named nowhere)."""
    import services.nav_marks_apply as nma
    from services.job_worker import _composite_mark_summary

    out = nma.apply_marks(
        _series(REALIZED_DAYS, [0.0] * 5), {"2026-03-06": -99600.0}, _withheld_gap_marks()
    )
    summary = _composite_mark_summary({0: out}, {0: ("2026-03-01", None)})
    for day in ("2026-03-07", "2026-03-08", "2026-03-09"):
        assert day not in summary.covered_days
        assert day not in summary.mark_gap_days
        assert day in summary.tiny_base_days
    # A member's tiny day outside its half-open window is not the composite's.
    clipped = _composite_mark_summary({0: out}, {0: ("2026-03-01", "2026-03-09")})
    assert clipped.tiny_base_days == ("2026-03-07", "2026-03-08")


def test_no_marks_means_no_tiny_base_days() -> None:
    import services.nav_marks_apply as nma

    out = nma.apply_marks(_series(REALIZED_DAYS, [0.0] * 5), {}, [])
    assert out.tiny_base_days == ()


# ---------------------------------------------------------------------------------------
# Plan 03, Task 2: T-OQ4, the 30-day window reaches before the first mark.
# ---------------------------------------------------------------------------------------

def _daily_marks(first: str, count: int, nav0: float, step: float) -> list["object"]:
    """One mark per calendar day from ``first``: nav0, nav0 + step, nav0 + 2 step, ..."""
    import services.nav_marks_apply as nma
    from datetime import date, timedelta

    day0 = date.fromisoformat(first)
    return [
        nma.AppliedMark((day0 + timedelta(days=k)).isoformat(), nav0 + step * k, 0.0)
        for k in range(count)
    ]


PRE_DAYS = [f"2026-03-{d:02d}" for d in range(1, 20)]  # 03-01 .. 03-19, S - 1 is 03-19
# The level was 100000.0 at the end of 03-10 (S - 10); a -97000.0 withdrawal on 03-11 left 3000.0.
# Marks run daily from S = 03-20 at 3000.0 + 10.0 per day, so nav on 03-20 + k is 3000 + 10 k.
# A mark on day t looks at t-30 .. t-1, so 03-10 is in its window while t <= 04-09 (04-09 minus
# 30 days is 03-10); 04-10 minus 30 days is 03-11, the first day at 3000.0. The marks tiny
# against that 100000.0 peak are 03-20 through 04-09: 12 days in March (20..31) + 9 in April.
PRE_PEAK_TINY = tuple(
    [f"2026-03-{d:02d}" for d in range(20, 32)] + [f"2026-04-{d:02d}" for d in range(1, 10)]
)


def _assert_pre_peak_window(out: object) -> None:
    import services.nav_marks_apply as nma

    assert isinstance(out, nma.MarkedSeries)
    assert len(PRE_PEAK_TINY) == 21
    assert out.tiny_base_days == PRE_PEAK_TINY
    rows = {str(k)[:10]: v for k, v in out.returns.items()}
    assert "2026-04-09" not in rows
    # 04-10 and 04-11: the 100000.0 level has left the window; the peak is the 3000-ish marks.
    assert rows["2026-04-10"] == pytest.approx((3210.0 - 3200.0) / 3200.0, abs=1e-12)
    assert rows["2026-04-11"] == pytest.approx((3220.0 - 3210.0) / 3210.0, abs=1e-12)
    assert out.covered_days == ()


def test_pre_start_peak_on_the_writer_chain_makes_the_early_marks_tiny() -> None:
    """T-OQ4 on the writer chain. The writer terminal is 3000.0 at S-1 (03-19); the withdrawal of
    -97000.0 on 03-11 means L(03-10) = 3000 - 0 - (-97000) = 100000.0 when the roll goes back.
    Marks on and after S are tiny while 03-10 is in their window. Peak from S-1 and the marks
    only (the tracer) sees 3000.0 and measures every one of them."""
    import services.nav_marks_apply as nma

    out = nma.apply_marks(
        _series(PRE_DAYS, [0.0] * 19),
        {"2026-03-11": -97000.0},
        _daily_marks("2026-03-20", 23, 3000.0, 10.0),  # 03-20 .. 04-11
        day_pnl={"2026-03-19": 0.0},
        writer_terminal=("2026-03-19", 3000.0),
    )
    _assert_pre_peak_window(out)


def test_pre_start_peak_on_the_wallet_roll_makes_the_early_marks_tiny() -> None:
    """The same shape as input returns and flows, rolled back from the first mark's wallet: base
    (3000 - 0) / (1 + 0) = 3000.0 at 03-19, and the roll at 03-11 gives (3000 + 97000) / (1 + 0) =
    100000.0."""
    import services.nav_marks_apply as nma

    out = nma.apply_marks(
        _series(PRE_DAYS, [0.0] * 19),
        {"2026-03-11": -97000.0},
        _daily_marks("2026-03-20", 23, 3000.0, 10.0),
    )
    _assert_pre_peak_window(out)


def test_pre_start_peak_on_the_day_pnl_roll_ignores_the_input_returns() -> None:
    """``roll_basis="day_pnl"`` rolls by P&L and flow alone: L(03-10) = 3000 - (-1000) - (-96000)
    = 100000.0. The input returns (0.5 a day) are never read for the roll."""
    import services.nav_marks_apply as nma

    out = nma.apply_marks(
        _series(PRE_DAYS, [0.5] * 19),
        {"2026-03-11": -96000.0},
        _daily_marks("2026-03-20", 23, 3000.0, 10.0),
        day_pnl={"2026-03-11": -1000.0},
        roll_basis="day_pnl",
    )
    _assert_pre_peak_window(out)


def test_kl3_the_roll_stops_at_an_unknown_day_and_never_raises() -> None:
    """KL-3, a RECORDED LIMIT and not a refusal. A NaN input day (03-15) with no day P&L stops
    the wallet roll there: the levels 03-15..03-18 are 3000.0 and the 100000.0 of 03-10 is never
    seen, so the marks are measured. Rolling through an unknown day would invent a level (SC-5).
    On a ccxt venue (no day P&L) a guard day or a quiet day does the same."""
    import services.nav_marks_apply as nma

    values = [0.0] * 19
    values[14] = float("nan")  # 2026-03-15
    out = nma.apply_marks(
        _series(PRE_DAYS, values),
        {"2026-03-11": -97000.0},
        _daily_marks("2026-03-20", 23, 3000.0, 10.0),
    )
    assert out.tiny_base_days == ()
    rows = {str(k)[:10]: v for k, v in out.returns.items()}
    assert rows["2026-03-20"] == pytest.approx(0.0, abs=1e-12)
    assert rows["2026-03-21"] == pytest.approx(10.0 / 3000.0, abs=1e-12)


def test_an_unusable_s_minus_1_base_still_rolls_the_window_back() -> None:
    """T-LM with T-OQ4. Writer terminal 50.0 on S-1 (03-19) with a 100.0 dust floor: the base is
    unusable, so 03-20 has no row (today's rule), but the 50.0 level still rolls: L(03-14) = 50 -
    0 - (-99950) = 100000.0, inside 03-21's window. 03-21's base is 3000.0 (the 03-20 mark, no
    gap flow), tiny against 100000.0: no row, P&L 3100 - 3000 - 0 = 100.0. The +2950.0 flow on
    03-20 steps the compose's level there, so that day holds 0.0."""
    import services.nav_marks_apply as nma

    marks = [nma.AppliedMark("2026-03-20", 3000.0, 0.0), nma.AppliedMark("2026-03-21", 3100.0, 0.0)]
    out = nma.apply_marks(
        _series(PRE_DAYS, [0.0] * 19),
        {"2026-03-15": -99950.0, "2026-03-20": 2950.0},
        marks,
        day_pnl={},
        dust_floor=100.0,
        writer_terminal=("2026-03-19", 50.0),
    )
    rows = {str(k)[:10]: v for k, v in out.returns.items()}
    assert "2026-03-20" not in rows
    assert "2026-03-21" not in rows
    assert out.tiny_base_days == ("2026-03-21",)
    assert out.writer_day_pnl["2026-03-21"] == pytest.approx(100.0, abs=1e-9)
    assert out.writer_day_pnl["2026-03-20"] == 0.0


def test_a_withheld_first_mark_takes_its_pre_start_covered_days_with_it() -> None:
    """T-GAP's first-mark half. Input days 03-01..03-07 all r = 0.0, a -97000.0 flow on 03-05,
    marks 03-10 (nav 3100, open profit 100) and 03-11 (nav 3200, open profit 200). The first
    mark's wallet is 3000.0 and, with r = 0 on the absent 03-10, its base is 3000.0 = L(03-09).
    The roll gives 3000.0 back through 03-09..03-05's returns and (3000 + 97000) / (1 + 0) =
    100000.0 at 03-04. Both marks are tiny (3000 and 3100 under 5000), so the days from
    ``covered_from`` (03-08) through S-1 (03-09) leave with the first mark. Their P&L is 0.0; the
    marks' P&L is 3100 - 3000 - 0 and 3200 - 3100 - 0."""
    import services.nav_marks_apply as nma
    from services.allocator_equity_derive import replay_key_equity

    marks = [nma.AppliedMark("2026-03-10", 3100.0, 100.0), nma.AppliedMark("2026-03-11", 3200.0, 200.0)]
    flows = {"2026-03-05": -97000.0}
    out = nma.apply_marks(
        _series([f"2026-03-{d:02d}" for d in range(1, 8)], [0.0] * 7), flows, marks
    )
    assert out.tiny_base_days == ("2026-03-08", "2026-03-09", "2026-03-10", "2026-03-11")
    assert out.covered_from == "2026-03-08"
    assert out.covered_days == ()
    assert out.mark_gap_days == ()
    assert out.writer_day_pnl == {
        "2026-03-08": 0.0,
        "2026-03-09": 0.0,
        "2026-03-10": pytest.approx(100.0, abs=1e-9),
        "2026-03-11": pytest.approx(100.0, abs=1e-9),
    }
    assert {str(k)[:10] for k in out.returns.index} == {f"2026-03-{d:02d}" for d in range(1, 8)}

    replay = replay_key_equity(
        out.returns,
        _flows_list(flows),
        3200.0,
        realized_terminal=("2026-03-11", 3200.0),
        dropped_day_pnl=out.writer_day_pnl,
    )
    assert replay.equity is not None
    assert replay.equity["2026-03-11"] == pytest.approx(3200.0, rel=1e-9)
    assert replay.equity["2026-03-10"] == pytest.approx(3100.0, rel=1e-9)
    assert replay.equity["2026-03-09"] == pytest.approx(3000.0, rel=1e-9)
    assert replay.equity["2026-03-07"] == pytest.approx(3000.0, rel=1e-9)
    assert replay.equity["2026-03-04"] == pytest.approx(100000.0, rel=1e-9)
