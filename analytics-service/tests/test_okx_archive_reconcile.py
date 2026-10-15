"""Archive-to-live reconciliation (Phase 167.1.2.2.2.1, plan 02; D-09, D-10).

WHY these tests matter (Rule 9): the OKX quarterly archive has no checksum, so the
reconciliation against the live endpoints is the ONLY content authentication a file
gets. If a parse, classification or truncation error could slip under the tolerance,
a wrong figure would be written into a public track record as if it were verified.
Every oracle below is a Decimal literal worked out by hand from the synthetic fixture
rows; none of them is computed by the modules under test.
"""
from __future__ import annotations

from decimal import Decimal
from pathlib import Path

from services.okx_archive_classify import aggregate_archive
from services.okx_archive_files import parse_archive_csv
from services.okx_archive_reconcile import reconcile_leg

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
Q3_REALIZED = {
    "2026-07-01": Decimal("5.90"),
    "2026-07-09": Decimal("7.35"),
    "2026-07-15": Decimal("-27.00"),
    "2026-07-20": Decimal("3.30"),
    "2026-08-03": Decimal("12.00"),
    "2026-08-12": Decimal("-0.05"),
    "2026-08-20": Decimal("-12.22"),
    "2026-09-15": Decimal("99.00"),
    "2026-09-30": Decimal("-2.02"),
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
    """One synthetic Q3 file goes from bytes to a reconciled reading through all three modules."""

    def test_parse_reads_every_row_and_verifies_the_quarter(self):
        parsed = parse_archive_csv(_q3_bytes(), year=2026, quarter="Q3")
        assert parsed.row_count == 20
        assert parsed.ts_min_day == "2026-07-01"
        assert parsed.ts_max_day == "2026-09-30"
        assert len(parsed.covered_days) == 92
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
        assert len(agg.covered_days) == 92

    def test_reconcile_against_equal_live_map_is_ok_and_exact(self):
        parsed = parse_archive_csv(_q3_bytes(), year=2026, quarter="Q3")
        agg = aggregate_archive([parsed], None)
        window = ("2026-07-17", "2026-09-30")
        live = {d: v for d, v in Q3_REALIZED.items() if d >= window[0]}
        reading = reconcile_leg("realized", agg.realized_by_day, live, window)
        assert reading.ok is True
        assert reading.max_abs_diff == Decimal("0")
        assert reading.window_total_diff == Decimal("0")
        assert reading.days_compared == 76
        assert reading.misses == ()

    def test_one_day_off_by_a_cent_and_a_bit_is_a_named_miss(self):
        parsed = parse_archive_csv(_q3_bytes(), year=2026, quarter="Q3")
        agg = aggregate_archive([parsed], None)
        window = ("2026-07-17", "2026-09-30")
        live = {d: v for d, v in Q3_REALIZED.items() if d >= window[0]}
        live["2026-08-12"] = live["2026-08-12"] + Decimal("0.011")
        reading = reconcile_leg("realized", agg.realized_by_day, live, window)
        assert reading.ok is False
        assert reading.first_offending == ("2026-08-12",)
        assert reading.max_abs_diff == Decimal("0.011")
