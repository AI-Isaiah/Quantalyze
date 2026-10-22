"""Archive-to-live reconciliation (Phase 167.1.2.2.2.1, plan 02; D-09, D-10).

WHY these tests matter (Rule 9): the OKX quarterly archive has no checksum, so the
reconciliation against the live endpoints is the ONLY content authentication a file
gets. If a parse, classification or truncation error could slip under the tolerance,
a wrong figure would be written into a public track record as if it were verified.
Every oracle below is a Decimal literal worked out by hand from the synthetic fixture
rows; none of them is computed by the modules under test.
"""
from __future__ import annotations

import inspect
from datetime import date, timedelta
from decimal import Decimal
from pathlib import Path

import pytest

from services import okx_archive_reconcile
from services.okx_archive_classify import aggregate_archive
from services.okx_archive_files import parse_archive_csv
from services.okx_archive_reconcile import (
    MIN_ACTIVE_DAYS,
    MIN_COMPARED_DAYS,
    TOLERANCE_USD,
    overlap_evidence,
    overlap_window,
    reconcile_leg,
)

FIXTURES = Path(__file__).parent / "fixtures" / "okx_archive"


def _q3_bytes() -> bytes:
    data = (FIXTURES / "q3_like.csv").read_bytes()
    assert data, "guard-the-guard: the Q3 fixture must not be empty"
    return data


# Hand-computed from fixtures/okx_archive/q3_like.csv (synthetic rows, invented amounts).
# Realized = pnl + fee, instType SWAP/FUTURES/SPOT/MARGIN only, non-funding trade-like
# subtypes. 2026-07-01 holds two rows: (10.50 - 0.25) + (-4.20 - 0.15) = 5.90.
# 2026-07-09 holds a SPOT row (0 - 0.12) and a SWAP row (7.77 - 0.30) = 7.35.
# 2026-07-15 is partial liquidation 100 only (-25.00 - 2.00); the 110 row is not P&L.
# 2026-07-20 is a USDC row (3.33 - 0.03); the OPTION row that day is excluded.
# The fixture's 2026-09-30 bills (-2.02) sit on Q3's tail edge: OKX cuts quarters at 00:00 UTC+8
# (D-15), so that UTC day is split with Q4, and without Q4 it has no daily total.
Q3_REALIZED = {
    "2026-07-01": Decimal("5.90"),
    "2026-07-09": Decimal("7.35"),
    "2026-07-15": Decimal("-27.00"),
    "2026-07-20": Decimal("3.30"),
    "2026-08-03": Decimal("12.00"),
    "2026-08-12": Decimal("-0.05"),
    "2026-08-20": Decimal("-12.22"),
    "2026-09-15": Decimal("99.00"),
}
Q3_FUNDING = {
    "2026-07-02": Decimal("0.75"),  # -1.30 + 2.05
    "2026-08-03": Decimal("-0.50"),
    "2026-09-02": Decimal("0.25"),  # -0.75 + 1.00
}
Q3_FLOWS = {
    "2026-07-05": Decimal("1000.00"),  # subType 11, transfer in
    "2026-08-10": Decimal("-250.00"),  # subType 12, transfer out
}
Q3_NON_EXTERNAL = {"2026-07-15": Decimal("30.00")}  # subType 110, a liquidation transfer
Q3_EXCLUDED = {"2026-07": {"OPTION": Decimal("2.90")}}  # 3.00 - 0.10


class TestTracerQ3:
    """One synthetic Q3 file goes from bytes to a reconciled reading through all three modules.

    D-15: the file is cut at 00:00 UTC+8, so it covers the whole UTC days 07-01..09-29 (91) and
    splits 06-30 and 09-30 with its neighbours; with no neighbour read, those two have no total."""

    def test_parse_reads_every_row_and_verifies_the_quarter(self):
        parsed = parse_archive_csv(_q3_bytes(), year=2026, quarter="Q3")
        assert parsed.row_count == 22
        assert parsed.ts_min_day == "2026-07-01"
        assert parsed.ts_max_day == "2026-09-30"
        assert len(parsed.covered_days) == 91
        assert (parsed.head_edge_day, parsed.tail_edge_day) == ("2026-06-30", "2026-09-30")
        assert parsed.has_type_column is False

    def test_aggregate_matches_the_hand_computed_legs(self):
        parsed = parse_archive_csv(_q3_bytes(), year=2026, quarter="Q3")
        agg = aggregate_archive([parsed], None)
        assert agg.realized_by_day == Q3_REALIZED
        assert agg.funding_by_day == Q3_FUNDING
        assert agg.flows_by_day == Q3_FLOWS
        assert agg.non_external_by_day == Q3_NON_EXTERNAL
        assert agg.excluded_by_month == Q3_EXCLUDED
        assert agg.unknown_zero_effect == 0
        assert len(agg.covered_days) == 91
        assert agg.edge_days_missing == frozenset({"2026-06-30", "2026-09-30"})

    def test_reconcile_against_equal_live_map_is_ok_and_exact(self):
        parsed = parse_archive_csv(_q3_bytes(), year=2026, quarter="Q3")
        agg = aggregate_archive([parsed], None)
        window = ("2026-07-17", "2026-09-29")
        live = {d: v for d, v in Q3_REALIZED.items() if d >= window[0]}
        reading = reconcile_leg("realized", agg.realized_by_day, live, window)
        assert reading.ok is True
        assert reading.max_abs_diff == Decimal("0")
        assert reading.window_total_diff == Decimal("0")
        assert reading.days_compared == 75
        assert reading.misses == ()

    def test_one_day_off_by_a_cent_and_a_bit_is_a_named_miss(self):
        parsed = parse_archive_csv(_q3_bytes(), year=2026, quarter="Q3")
        agg = aggregate_archive([parsed], None)
        window = ("2026-07-17", "2026-09-29")
        live = {d: v for d, v in Q3_REALIZED.items() if d >= window[0]}
        live["2026-08-12"] = live["2026-08-12"] + Decimal("0.011")
        reading = reconcile_leg("realized", agg.realized_by_day, live, window)
        assert reading.ok is False
        assert reading.first_offending == ("2026-08-12",)
        assert reading.max_abs_diff == Decimal("0.011")


WINDOW = ("2026-08-01", "2026-08-10")  # ten calendar days, both ends inclusive


def _leg(archive: dict[str, str], live: dict[str, str], window=WINDOW):
    return reconcile_leg(
        "realized",
        {d: Decimal(v) for d, v in archive.items()},
        {d: Decimal(v) for d, v in live.items()},
        window,
    )


class TestToleranceBoundaries:
    """T-RECON-1: the one-cent line is exact, per day AND on the window total.

    A tolerance that drifts by a tenth of a cent is a tolerance that eventually admits a
    mis-parsed day; these cases sit on both sides of the line so any shift is caught.
    """

    def test_a_day_off_by_0_011_is_a_miss(self):
        reading = _leg({"2026-08-04": "10.011"}, {"2026-08-04": "10.000"})
        assert reading.ok is False
        assert reading.first_offending == ("2026-08-04",)
        assert reading.misses == (("2026-08-04", Decimal("10.011"), Decimal("10.000")),)
        assert reading.days_over_cent == 1

    def test_a_day_off_by_exactly_0_010_passes(self):
        reading = _leg({"2026-08-04": "10.010"}, {"2026-08-04": "10.000"})
        assert reading.ok is True
        assert reading.misses == ()
        assert reading.days_over_cent == 0
        assert reading.days_over_half_cent == 1

    def test_the_sign_of_the_difference_does_not_matter(self):
        assert _leg({"2026-08-04": "9.989"}, {"2026-08-04": "10.000"}).ok is False
        assert _leg({"2026-08-04": "9.990"}, {"2026-08-04": "10.000"}).ok is True

    def test_every_day_within_a_cent_but_window_total_off_by_0_011_is_a_miss(self):
        reading = _leg(
            {"2026-08-02": "1.0055", "2026-08-03": "2.0055"},
            {"2026-08-02": "1.0000", "2026-08-03": "2.0000"},
        )
        assert reading.misses == ()
        assert reading.days_over_cent == 0
        assert reading.window_total_diff == Decimal("0.0110")
        assert reading.ok is False

    def test_window_total_off_by_exactly_a_cent_passes(self):
        reading = _leg({"2026-08-02": "1.005", "2026-08-03": "2.005"}, {"2026-08-02": "1", "2026-08-03": "2"})
        assert reading.window_total_diff == Decimal("0.010")
        assert reading.ok is True

    def test_half_cent_and_cent_counters_count_each_day_once(self):
        # per-day differences: 0.004 (neither), 0.006 (half only), 0.010 (half only),
        # 0.011 (both), 0.020 (both)
        archive = {
            "2026-08-01": "0.004",
            "2026-08-02": "0.006",
            "2026-08-03": "0.010",
            "2026-08-04": "0.011",
            "2026-08-05": "0.020",
        }
        reading = _leg(archive, {})
        assert reading.days_over_half_cent == 4
        assert reading.days_over_cent == 2
        assert reading.max_abs_diff == Decimal("0.020")
        assert reading.first_offending == ("2026-08-04", "2026-08-05")
        assert reading.days_compared == 10

    def test_first_offending_holds_at_most_ten_sorted_dates(self):
        window = ("2026-08-01", "2026-08-20")
        archive = {f"2026-08-{d:02d}": "1" for d in range(20, 4, -1)}  # 16 offending days, reverse order
        reading = _leg(archive, {}, window)
        assert len(reading.misses) == 16
        assert reading.first_offending == tuple(f"2026-08-{d:02d}" for d in range(5, 15))
        assert list(reading.first_offending) == sorted(reading.first_offending)

    def test_reading_carries_the_leg_name(self):
        assert _leg({}, {}).name == "realized"

    def test_inverted_window_is_refused(self):
        with pytest.raises(ValueError):
            _leg({}, {}, ("2026-08-10", "2026-08-01"))


class TestToleranceCannotBeWidened:
    """D-10: no parameter, no override, one literal.

    A calibration miss is a founder STOP. If a keyword could loosen the comparison, the
    first awkward real file would be 'fixed' by passing a bigger number instead of by
    looking at why the archive and the live endpoint disagree.
    """

    def test_tolerance_constant_is_one_cent(self):
        assert TOLERANCE_USD == Decimal("0.01")

    def test_no_function_takes_a_tolerance_parameter(self):
        for fn in (reconcile_leg, overlap_window):
            names = list(inspect.signature(fn).parameters)
            assert names, "guard-the-guard: the signature read must find parameters"
            assert not [n for n in names if "tol" in n.lower()], (fn.__name__, names)
        assert list(inspect.signature(reconcile_leg).parameters) == [
            "name",
            "archive_by_day",
            "live_by_day",
            "window",
        ]

    def test_source_has_the_cent_literal_exactly_once_and_reads_no_environment(self):
        source = inspect.getsource(okx_archive_reconcile)
        assert source.count('Decimal("0.01")') == 1
        for forbidden in ("environ", "getenv", "import os", "argparse", "sys.argv"):
            assert forbidden not in source, forbidden

    def test_a_cent_and_a_bit_cannot_be_tolerated_through_any_keyword(self):
        with pytest.raises(TypeError):
            reconcile_leg("x", {}, {}, WINDOW, tolerance=Decimal("1"))  # type: ignore[call-arg]


class TestTruncationDetector:
    """T-RECON-2: inside the overlap window, a one-sided day is a miss in both directions.

    An archive-only day with activity means the LIVE fetch lost it (the persistent
    truncation class); a live-only day means the ARCHIVE dropped it. Either would
    silently shift a rebuilt day's return if it passed.
    """

    def test_archive_only_day_with_activity_is_a_miss(self):
        reading = _leg({"2026-08-06": "-12.34"}, {})
        assert reading.ok is False
        assert reading.misses == (("2026-08-06", Decimal("-12.34"), Decimal("0")),)

    def test_live_only_day_is_a_miss(self):
        reading = _leg({}, {"2026-08-06": "5.55"})
        assert reading.ok is False
        assert reading.misses == (("2026-08-06", Decimal("0"), Decimal("5.55")),)

    def test_one_sided_days_outside_the_window_do_not_count(self):
        reading = _leg(
            {"2026-07-31": "100", "2026-08-11": "100", "2026-08-05": "3"},
            {"2026-07-30": "-50", "2026-08-12": "-50", "2026-08-05": "3"},
        )
        assert reading.ok is True
        assert reading.window_total_diff == Decimal("0")

    def test_window_ends_are_inclusive(self):
        reading = _leg({"2026-08-01": "1", "2026-08-10": "1"}, {})
        assert [m[0] for m in reading.misses] == ["2026-08-01", "2026-08-10"]


class TestOverlapWindow:
    """The comparable window is where BOTH sources can speak, and it expires."""

    def test_window_runs_from_the_later_start_to_the_earlier_end(self):
        got = overlap_window(date(2026, 7, 1), date(2026, 10, 1), date(2026, 8, 2), date(2026, 10, 20))
        assert got == ("2026-08-02", "2026-09-30")

    def test_window_starts_at_the_quarter_when_the_live_reach_is_older(self):
        got = overlap_window(date(2026, 7, 1), date(2026, 10, 1), date(2026, 5, 1), date(2026, 10, 20))
        assert got == ("2026-07-01", "2026-09-30")

    def test_window_ends_the_day_before_today_while_the_quarter_is_running(self):
        got = overlap_window(date(2026, 7, 1), date(2026, 10, 1), date(2026, 8, 2), date(2026, 8, 10))
        assert got == ("2026-08-02", "2026-08-09")

    def test_window_is_none_when_the_live_reach_starts_after_the_quarter(self):
        assert overlap_window(date(2026, 7, 1), date(2026, 10, 1), date(2026, 10, 1), date(2026, 12, 30)) is None

    def test_q3_window_expires_around_2026_12_30(self):
        def window_on(today: date):
            return overlap_window(date(2026, 7, 1), date(2026, 10, 1), today - timedelta(days=90), today)

        assert window_on(date(2026, 12, 29)) == ("2026-09-30", "2026-09-30")
        assert window_on(date(2026, 12, 30)) is None

    def test_window_is_none_when_today_is_the_quarter_start(self):
        assert overlap_window(date(2026, 7, 1), date(2026, 10, 1), date(2026, 6, 1), date(2026, 7, 1)) is None


class TestOverlapEvidence:
    """F3. A comparison passes when two series agree, and two series that are both zero agree
    however wrong the archive file is. So agreement only authenticates a file when the window
    is long enough and active enough to have been able to disagree."""

    def _days(self, first: str, count: int) -> list[str]:
        start = date.fromisoformat(first)
        return [(start + timedelta(days=i)).isoformat() for i in range(count)]

    def test_the_floors_are_pinned_and_are_not_a_tolerance(self):
        assert (MIN_COMPARED_DAYS, MIN_ACTIVE_DAYS) == (14, 5)
        assert TOLERANCE_USD == Decimal("0.01")  # D-10: the cent is untouched
        assert list(inspect.signature(overlap_evidence).parameters) == ["readings"]

    def test_a_long_window_where_both_sides_are_zero_agrees_and_proves_nothing(self):
        window = ("2026-09-01", "2026-09-30")  # 30 days, nothing on either side
        reading = reconcile_leg("realized", {}, {}, window)
        assert reading.ok is True and reading.days_compared == 30 and reading.active_days == 0
        assert overlap_evidence([reading]) == (30, 0, False)

    def test_five_active_days_in_fourteen_is_exactly_enough(self):
        days = self._days("2026-09-01", 14)
        both = {d: Decimal("1.50") for d in days[:5]}
        reading = reconcile_leg("realized", both, dict(both), ("2026-09-01", "2026-09-14"))
        assert overlap_evidence([reading]) == (14, 5, True)

    def test_thirteen_days_or_four_active_days_is_not_enough(self):
        days = self._days("2026-09-01", 14)
        both = {d: Decimal("1.50") for d in days[:5]}
        short = reconcile_leg("realized", both, dict(both), ("2026-09-01", "2026-09-13"))
        assert overlap_evidence([short]) == (13, 5, False)
        four = {d: Decimal("1.50") for d in days[:4]}
        quiet = reconcile_leg("realized", four, dict(four), ("2026-09-01", "2026-09-14"))
        assert overlap_evidence([quiet]) == (14, 4, False)

    def test_a_day_counts_when_either_side_carries_it_and_dust_does_not(self):
        archive = {"2026-09-01": Decimal("2"), "2026-09-02": Decimal("0.004")}
        live = {"2026-09-03": Decimal("-2"), "2026-09-04": Decimal("0.005")}
        reading = reconcile_leg("realized", archive, live, ("2026-09-01", "2026-09-05"))
        # 09-01 archive only, 09-03 live only, 09-04 live at exactly half a cent: three
        # days; 09-02 is dust (0.004) and 09-05 is empty.
        assert reading.active_days == 3
        assert reading.ok is False  # the one-sided days are misses; the evidence is separate

    def test_the_evidence_sums_over_merged_windows(self):
        a = reconcile_leg("realized", {"2026-07-01": Decimal("1")}, {"2026-07-01": Decimal("1")},
                          ("2026-07-01", "2026-07-08"))
        b = reconcile_leg("realized", {"2026-09-01": Decimal("1")}, {"2026-09-01": Decimal("1")},
                          ("2026-09-01", "2026-09-08"))
        assert overlap_evidence([a, b]) == (16, 2, False)
