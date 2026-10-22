"""OKX archive file parsing and classification stops (Phase 167.1.2.2.2.1, plan 02).

WHY these tests matter (Rule 9): the quarterly archive has no checksum and its rows
become dollars in a public track record. Every way a file can be misread - a drifted
header, a file for the wrong quarter, a subtype nobody classified, a coin that is not a
dollar, an instType the live path never summed - must stop the run LOUD with a class
name and never with data. Each test below fails if its stop is removed, so a regression
cannot turn a misread file into a plausible-looking figure.

Variant inputs are built here from the committed synthetic fixture text with small
edits; the modules under test never build a test's input. All amounts are invented.
"""
from __future__ import annotations

import ast
import csv
import io
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

import pytest

from services.okx_archive_classify import (
    ARCHIVE_USD_FAMILY,
    LIVE_REALIZED_INST_TYPES,
    MIN_CHAINED_PAIRS,
    SUBTYPE_BUCKETS,
    ArchiveAggregate,
    Bucket,
    aggregate_archive,
    verify_bal_chain,
)
from services.okx_archive_files import (
    ARCHIVE_HEADER,
    ArchiveParseError,
    longest_billless_run,
    parse_archive_csv,
    quarter_bounds,
)
from services.okx_archive_reconcile import reconcile_leg

FIXTURES = Path(__file__).parent / "fixtures" / "okx_archive"
EXCHANGE_SOURCE = Path(__file__).resolve().parents[1] / "services" / "exchange.py"


# --------------------------------------------------------------------------- helpers
def _read_fixture(name: str) -> tuple[list[str], list[list[str]]]:
    text = (FIXTURES / name).read_text(encoding="utf-8")
    assert text, f"guard-the-guard: fixture {name} must not be empty"
    rows = list(csv.reader(io.StringIO(text, newline="")))
    return rows[0], rows[1:]


def _emit(header: list[str], rows: list[list[str]]) -> bytes:
    out = io.StringIO(newline="")
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(header)
    writer.writerows(rows)
    return out.getvalue().encode("utf-8")


def _ms(stamp: str) -> str:
    dt = datetime.strptime(stamp, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
    return str(int(dt.timestamp()) * 1000)


def _new_row(header: list[str], **cells: str) -> list[str]:
    row = {name: "" for name in header}
    row.update(cells)
    return [row[name] for name in header]


def _q3_with(*extra_rows: dict[str, str]) -> bytes:
    """The Q3 fixture plus extra synthetic rows (all inside the quarter)."""
    header, rows = _read_fixture("q3_like.csv")
    rows = rows + [_new_row(header, **extra) for extra in extra_rows]
    return _emit(header, rows)


def _aggregate_q3(data: bytes, subtype_types=None):
    return aggregate_archive([parse_archive_csv(data, year=2026, quarter="Q3")], subtype_types)


def _stop(callable_, *args, **kwargs) -> ArchiveParseError:
    with pytest.raises(ArchiveParseError) as info:
        callable_(*args, **kwargs)
    return info.value


def _chain(files, summed_ccys=None):
    """``verify_bal_chain`` as the job calls it: the floor is scoped to the currencies the
    aggregate sums, so the aggregate is built first (``_census_of``) and its ``summed_ccys``
    passed. Pass ``summed_ccys`` explicitly to pin a floor scope without classifying."""
    if summed_ccys is None:
        summed_ccys = aggregate_archive(files, None).summed_ccys
    return verify_bal_chain(files, summed_ccys)


def _row_kwargs(bill_id: str, sub: str, when: str, **overrides: str) -> dict[str, str]:
    base = {
        "instType": "SWAP",
        "billId": bill_id,
        "subType": sub,
        "ts": _ms(when),
        "balChg": "0",
        "bal": "1",
        "ccy": "USDT",
        "pnl": "0",
        "fee": "0",
    }
    base.update(overrides)
    return base


def _detail_text(err: ArchiveParseError) -> str:
    return repr(err.detail) + str(err)


# ---------------------------------------------------------------------- the quarter
class TestQuarterBounds:
    """The plain calendar reading is the one asserted against every file.

    These are calendar dates; the file's instants are cut at 00:00 UTC+8 on them (D-15)."""

    @pytest.mark.parametrize(
        ("quarter", "start", "end"),
        [
            ("Q1", "2026-01-01", "2026-04-01"),
            ("Q2", "2026-04-01", "2026-07-01"),
            ("Q3", "2026-07-01", "2026-10-01"),
            ("Q4", "2026-10-01", "2027-01-01"),
        ],
    )
    def test_quarter_bounds_are_the_plain_calendar_half_open_range(self, quarter, start, end):
        got = quarter_bounds(2026, quarter)
        assert (got[0].isoformat(), got[1].isoformat()) == (start, end)

    def test_unknown_quarter_label_is_refused(self):
        with pytest.raises(ValueError):
            quarter_bounds(2026, "Q5")


class TestQuarterRangeAssertion:
    """A file for the wrong quarter must stop, never be remapped.

    OKX's own doc example labels 2024 Q2 as a July-September range; if the assertion
    were missing, a mislabelled file would write another quarter's P&L onto the wrong days.
    The quarter's calendar dates are cut at 00:00 UTC+8, i.e. 16:00 UTC the day before (D-15).
    """

    def test_quarter_q3_file_parsed_as_q2_is_a_named_stop_with_requested_and_observed_dates(self):
        err = _stop(parse_archive_csv, (FIXTURES / "q3_like.csv").read_bytes(), year=2026, quarter="Q2")
        assert err.stop_class == "quarter_range_mismatch"
        assert err.detail["requested"] == "2026 Q2"
        assert err.detail["observed_min_day"] == "2026-07-01"
        assert err.detail["observed_max_day"] == "2026-09-30"

    def test_quarter_q2_file_parsed_as_q3_is_a_named_stop(self):
        err = _stop(parse_archive_csv, (FIXTURES / "q2_like.csv").read_bytes(), year=2026, quarter="Q3")
        assert err.stop_class == "quarter_range_mismatch"
        assert err.detail["requested"] == "2026 Q3"

    def test_quarter_row_one_millisecond_before_the_start_is_a_stop(self):
        """D-15: Q3 starts at 2026-06-30T16:00:00.000Z (07-01 00:00 UTC+8); one ms earlier is Q2's."""
        header, rows = _read_fixture("q3_like.csv")
        rows[0][header.index("ts")] = "1782835199999"
        err = _stop(parse_archive_csv, _emit(header, rows), year=2026, quarter="Q3")
        assert err.stop_class == "quarter_range_mismatch"
        assert err.detail["observed_min_day"] == "2026-06-30"
        assert err.detail["rows_outside"] == 1

    def test_quarter_row_at_the_exclusive_end_is_a_stop(self):
        """D-15: Q3 ends, exclusive, at 2026-09-30T16:00:00.000Z (10-01 00:00 UTC+8)."""
        header, rows = _read_fixture("q3_like.csv")
        rows[-1][header.index("ts")] = "1790784000000"
        err = _stop(parse_archive_csv, _emit(header, rows), year=2026, quarter="Q3")
        assert err.stop_class == "quarter_range_mismatch"
        assert err.detail["observed_max_day"] == "2026-09-30"

    def test_a_ts_beyond_the_calendar_is_still_a_named_stop_with_no_observed_days(self):
        """A 16-digit (microsecond-unit) ts is accepted by the digit check but lies past the year
        9999, so its day cannot be computed. It must stay the named stop, not an OverflowError."""
        header, rows = _read_fixture("q3_like.csv")
        rows[-1][header.index("ts")] = "1751328000000000"
        err = _stop(parse_archive_csv, _emit(header, rows), year=2026, quarter="Q3")
        assert err.stop_class == "quarter_range_mismatch"
        assert err.detail["observed_min_day"] is None and err.detail["observed_max_day"] is None
        assert err.detail["rows_outside"] == 1

    def test_quarter_first_and_last_millisecond_are_inside(self):
        # q3_like.csv carries rows at 07-01T00:00:00.000Z and 09-30T15:59:59.999Z (D-15: the last
        # millisecond before the UTC+8 cut).
        parsed = parse_archive_csv((FIXTURES / "q3_like.csv").read_bytes(), year=2026, quarter="Q3")
        assert (parsed.ts_min_day, parsed.ts_max_day) == ("2026-07-01", "2026-09-30")

    def test_quarter_q2_fixture_covers_ninety_whole_utc_days(self):
        """D-15: Q2 alone covers 04-01..06-29 as whole UTC days; 03-31 and 06-30 are its edges."""
        parsed = parse_archive_csv((FIXTURES / "q2_like.csv").read_bytes(), year=2026, quarter="Q2")
        assert (parsed.row_count, len(parsed.covered_days)) == (14, 90)
        assert (parsed.ts_min_day, parsed.ts_max_day) == ("2026-04-01", "2026-06-30")
        assert (parsed.head_edge_day, parsed.tail_edge_day) == ("2026-03-31", "2026-06-30")

    def test_quarter_detail_carries_dates_and_counts_only(self):
        err = _stop(parse_archive_csv, (FIXTURES / "q3_like.csv").read_bytes(), year=2026, quarter="Q2")
        assert all(isinstance(v, (str, int)) for v in err.detail.values())


# ----------------------------------------------------------------------- the header
class TestHeaderPin:
    """T-PARSE-HDR: any header but the pinned 28 columns is a permanent stop.

    The reconciliation is only meaningful if column N means what the parser thinks it
    means; a silently reordered or renamed column would sum the wrong field as dollars.
    """

    def test_header_pinned_constant_has_the_28_documented_columns_in_order(self):
        assert len(ARCHIVE_HEADER) == 28
        assert ARCHIVE_HEADER[:4] == ("instType", "billId", "subType", "ts")
        assert ARCHIVE_HEADER[-1] == "fillFwdPx"

    def test_header_missing_column_is_header_drift(self):
        header, rows = _read_fixture("q3_like.csv")
        drop = header.index("fee")
        data = _emit(header[:drop] + header[drop + 1 :], [r[:drop] + r[drop + 1 :] for r in rows])
        err = _stop(parse_archive_csv, data, year=2026, quarter="Q3")
        assert err.stop_class == "header_drift"
        assert err.detail["missing"] == ["fee"]

    def test_header_extra_unknown_column_is_header_drift(self):
        header, rows = _read_fixture("q3_like.csv")
        data = _emit(header + ["surprise"], [r + ["x"] for r in rows])
        err = _stop(parse_archive_csv, data, year=2026, quarter="Q3")
        assert err.stop_class == "header_drift"
        assert err.detail["unexpected"] == ["surprise"]

    def test_header_reordered_columns_are_header_drift(self):
        header, rows = _read_fixture("q3_like.csv")
        i, j = header.index("pnl"), header.index("fee")
        swapped = list(header)
        swapped[i], swapped[j] = swapped[j], swapped[i]
        data = _emit(swapped, rows)  # values stay put, so the labels now lie
        err = _stop(parse_archive_csv, data, year=2026, quarter="Q3")
        assert err.stop_class == "header_drift"
        assert err.detail["order_changed"] is True

    def test_header_empty_file_is_header_drift(self):
        assert _stop(parse_archive_csv, b"", year=2026, quarter="Q3").stop_class == "header_drift"

    def test_header_with_added_type_column_parses_and_is_flagged(self):
        header, rows = _read_fixture("q3_like.csv")
        pos = header.index("billId") + 1
        data = _emit(
            header[:pos] + ["type"] + header[pos:],
            [r[:pos] + ["T" + r[header.index("subType")]] + r[pos:] for r in rows],
        )
        parsed = parse_archive_csv(data, year=2026, quarter="Q3")
        assert parsed.has_type_column is True
        assert parsed.rows[0].type_raw == "T2"
        assert parsed.row_count == 22

    def test_header_type_column_disagreeing_with_the_live_subtype_map_is_a_stop(self):
        header, rows = _read_fixture("q3_like.csv")
        pos = header.index("billId") + 1
        sub_idx = header.index("subType")
        type_rows = [r[:pos] + ["T" + r[sub_idx]] + r[pos:] for r in rows]
        type_header = header[:pos] + ["type"] + header[pos:]
        subtype_map = {r[sub_idx]: "T" + r[sub_idx] for r in rows}

        # consistent map: no stop
        ok = parse_archive_csv(_emit(type_header, type_rows), year=2026, quarter="Q3")
        assert aggregate_archive([ok], subtype_map).census["rows"] == 22

        # one row's type contradicts the live map for its subType
        type_rows[1][pos] = "WRONG"
        bad = parse_archive_csv(_emit(type_header, type_rows), year=2026, quarter="Q3")
        err = _stop(aggregate_archive, [bad], subtype_map)
        assert err.stop_class == "subtype_map_drift"
        assert err.detail["sub_types"] == {"1": 1}

    def test_header_without_type_column_skips_the_cross_check(self):
        agg = _aggregate_q3((FIXTURES / "q3_like.csv").read_bytes(), {"1": "totally-different"})
        assert agg.census["rows"] == 22


# --------------------------------------------------------------------- amounts, rows
class TestUnparseableAmounts:
    """Money is parsed with Decimal from plain decimal strings; anything else stops."""

    @pytest.mark.parametrize("bad", ["NaN", "Infinity", "-inf", "abc", "", "1,5", "1e999", "0x10", "1_0", " 7"])
    @pytest.mark.parametrize("field", ["pnl", "fee", "balChg", "bal"])
    def test_non_finite_or_non_numeric_money_is_unparseable_amount(self, field, bad):
        header, rows = _read_fixture("q3_like.csv")
        rows[3][header.index(field)] = bad
        err = _stop(parse_archive_csv, _emit(header, rows), year=2026, quarter="Q3")
        assert err.stop_class == "unparseable_amount"
        assert err.detail["field"] == field
        assert bad not in _detail_text(err) or bad == ""  # the raw cell is never echoed

    def test_ordinary_decimal_strings_parse_exactly(self):
        header, rows = _read_fixture("q3_like.csv")
        rows[0][header.index("pnl")] = "0.1"
        rows[0][header.index("fee")] = "-1E-8"
        parsed = parse_archive_csv(_emit(header, rows), year=2026, quarter="Q3")
        assert parsed.rows[0].pnl == Decimal("0.1")
        assert parsed.rows[0].fee == Decimal("-0.00000001")
        assert isinstance(parsed.rows[0].pnl, Decimal)

    def test_non_digit_ts_is_unparseable_ts(self):
        header, rows = _read_fixture("q3_like.csv")
        rows[2][header.index("ts")] = "2026-07-02T08:00:00Z"
        assert _stop(parse_archive_csv, _emit(header, rows), year=2026, quarter="Q3").stop_class == "unparseable_ts"

    def test_short_row_is_malformed_row(self):
        header, rows = _read_fixture("q3_like.csv")
        rows[4] = rows[4][:-3]
        err = _stop(parse_archive_csv, _emit(header, rows), year=2026, quarter="Q3")
        assert err.stop_class == "malformed_row"

    def test_header_only_file_is_empty_file_because_no_row_can_verify_the_quarter(self):
        header, _ = _read_fixture("q3_like.csv")
        assert _stop(parse_archive_csv, _emit(header, []), year=2026, quarter="Q3").stop_class == "empty_file"

    def test_bytes_that_are_not_utf8_are_undecodable(self):
        assert _stop(parse_archive_csv, b"\xff\xfe\xfa", year=2026, quarter="Q3").stop_class == "undecodable_file"

    def test_a_utf8_byte_order_mark_is_tolerated(self):
        data = b"\xef\xbb\xbf" + (FIXTURES / "q3_like.csv").read_bytes()
        assert parse_archive_csv(data, year=2026, quarter="Q3").row_count == 22


class TestDuplicateBills:
    """A repeated billId is either the same bill (dropped) or a conflict (stop)."""

    def test_identical_duplicate_bill_is_counted_once(self):
        header, rows = _read_fixture("q3_like.csv")
        parsed = parse_archive_csv(_emit(header, rows + [list(rows[1])]), year=2026, quarter="Q3")
        assert parsed.row_count == 22
        assert parsed.duplicate_rows_dropped == 1

    def test_same_bill_id_with_different_content_is_duplicate_bill_conflict(self):
        header, rows = _read_fixture("q3_like.csv")
        clone = list(rows[1])
        clone[header.index("pnl")] = "-4.21"
        err = _stop(parse_archive_csv, _emit(header, rows + [clone]), year=2026, quarter="Q3")
        assert err.stop_class == "duplicate_bill_conflict"
        assert "-4.21" not in _detail_text(err)

    def test_blank_bill_id_is_a_stop_because_dedup_is_impossible(self):
        header, rows = _read_fixture("q3_like.csv")
        rows[5][header.index("billId")] = ""
        assert _stop(parse_archive_csv, _emit(header, rows), year=2026, quarter="Q3").stop_class == "missing_bill_id"

    def test_conflicting_bill_across_two_files_is_duplicate_bill_conflict(self):
        data = (FIXTURES / "q3_like.csv").read_bytes()
        first = parse_archive_csv(data, year=2026, quarter="Q3")
        header, rows = _read_fixture("q3_like.csv")
        rows[1][header.index("pnl")] = "-4.21"
        second = parse_archive_csv(_emit(header, rows), year=2026, quarter="Q3")
        assert _stop(aggregate_archive, [first, second], None).stop_class == "duplicate_bill_conflict"
        # the very same file twice is not a conflict, and is not double counted
        twice = aggregate_archive([first, first], None)
        assert twice.realized_by_day["2026-07-01"] == Decimal("5.90")


# ----------------------------------------------------------------- classification D-08
class TestUnknownSubtypeClassification:
    """T-CLASS-1: a subType the table does not list can never be silently bucketed.

    A new OKX subtype with a nonzero effect is money the model does not understand;
    folding it into P&L or ignoring it would misstate the track record either way.
    """

    def test_unknown_subtype_with_nonzero_pnl_is_a_stop_naming_the_subtype(self):
        data = _q3_with(_row_kwargs("799999001", "999", "2026-07-12 12:00:00", pnl="123.45"))
        err = _stop(_aggregate_q3, data)
        assert err.stop_class == "unknown_subtype_nonzero"
        assert err.detail["sub_types"] == {"999": 1}
        assert "999" in str(err)
        assert "123.45" not in _detail_text(err)

    @pytest.mark.parametrize("field", ["pnl", "fee", "balChg"])
    def test_unknown_subtype_with_any_nonzero_effect_field_is_a_stop(self, field):
        data = _q3_with(_row_kwargs("799999002", "998", "2026-07-12 12:00:00", **{field: "0.5"}))
        assert _stop(_aggregate_q3, data).stop_class == "unknown_subtype_nonzero"

    def test_unknown_subtype_with_zero_effect_is_counted_and_does_not_raise(self):
        data = _q3_with(_row_kwargs("799999003", "999", "2026-07-12 12:00:00"))
        agg = _aggregate_q3(data)
        assert agg.unknown_zero_effect == 1
        assert agg.census["by_sub_type"]["999"] == 1

    def test_unknown_subtype_adl_and_clawback_are_not_guessed(self):
        # RESEARCH Section 3 quotes no ADL or clawback subtype number, so none is encoded.
        assert all(SUBTYPE_BUCKETS.get(s) is None for s in ("9", "10", "13", "14", "15"))


class TestFlowAndFundingClassification:
    """D-08: transfers 11/12 are external flows, 110/111 are not, funding is its own stream."""

    def test_liquidation_transfers_are_non_external_never_flows(self):
        agg = _aggregate_q3(
            _q3_with(_row_kwargs("799999004", "111", "2026-07-12 12:00:00", balChg="-7.5"))
        )
        assert agg.non_external_by_day["2026-07-12"] == Decimal("-7.5")
        assert "2026-07-12" not in agg.flows_by_day
        assert agg.flows_by_day == {"2026-07-05": Decimal("1000.00"), "2026-08-10": Decimal("-250.00")}
        assert SUBTYPE_BUCKETS["110"] is Bucket.NON_EXTERNAL
        assert SUBTYPE_BUCKETS["111"] is Bucket.NON_EXTERNAL

    def test_transfer_in_and_out_are_flows_signed_by_balance_change(self):
        agg = _aggregate_q3(
            _q3_with(
                _row_kwargs("799999005", "11", "2026-07-12 12:00:00", instType="", balChg="40.25"),
                _row_kwargs("799999006", "12", "2026-07-12 13:00:00", instType="", balChg="-15.75"),
            )
        )
        assert agg.flows_by_day["2026-07-12"] == Decimal("24.50")
        assert agg.flows_by_day["2026-07-05"] == Decimal("1000.00")
        assert "2026-07-12" not in agg.realized_by_day

    def test_funding_is_its_own_stream_regardless_of_inst_type(self):
        agg = _aggregate_q3(
            _q3_with(
                _row_kwargs("799999007", "173", "2026-07-12 08:00:00", instType="", pnl="-0.40"),
                _row_kwargs("799999008", "174", "2026-07-12 16:00:00", instType="OPTION", pnl="0.90"),
            )
        )
        assert agg.funding_by_day["2026-07-12"] == Decimal("0.50")
        assert "2026-07-12" not in agg.realized_by_day
        assert agg.excluded_by_month.get("2026-07") == {"OPTION": Decimal("2.90")}

    def test_every_listed_subtype_sits_in_exactly_one_bucket(self):
        assert SUBTYPE_BUCKETS["173"] is Bucket.FUNDING and SUBTYPE_BUCKETS["174"] is Bucket.FUNDING
        assert SUBTYPE_BUCKETS["11"] is Bucket.FLOW and SUBTYPE_BUCKETS["12"] is Bucket.FLOW
        assert all(isinstance(b, Bucket) and b is not Bucket.UNKNOWN for b in SUBTYPE_BUCKETS.values())


class TestCurrencyStop:
    """Founder must-settle (currency): nothing is converted; a non-dollar counted row stops.

    The live path sums pnl+fee across every ccy with no conversion. If a BTC-denominated
    fee were summed as dollars the reconciliation could pass or fail for the wrong reason
    and a rebuilt day would carry a coin amount labelled as dollars.
    """

    def test_currency_realized_row_in_btc_is_a_stop_with_a_count_and_month_census(self):
        data = _q3_with(
            _row_kwargs("799999009", "2", "2026-07-12 12:00:00", ccy="BTC", pnl="0.5"),
            _row_kwargs("799999010", "2", "2026-08-12 12:00:00", ccy="BTC", fee="-0.01"),
        )
        err = _stop(_aggregate_q3, data)
        assert err.stop_class == "non_usd_ccy"
        assert err.detail["ccys"] == {"BTC": {"rows": 2, "months": ["2026-07", "2026-08"]}}
        assert "0.5" not in _detail_text(err) and "-0.01" not in _detail_text(err)

    def test_currency_funding_and_flow_rows_in_a_coin_are_also_stops(self):
        funding = _q3_with(_row_kwargs("799999011", "173", "2026-07-12 08:00:00", ccy="ETH", pnl="-0.2"))
        flow = _q3_with(_row_kwargs("799999012", "11", "2026-07-12 08:00:00", instType="", ccy="BTC", balChg="1"))
        assert _stop(_aggregate_q3, funding).stop_class == "non_usd_ccy"
        assert _stop(_aggregate_q3, flow).stop_class == "non_usd_ccy"

    def test_currency_non_external_row_in_btc_is_a_stop_because_the_live_path_would_sum_it_as_dollars(self):
        # WR-01. The live aggregator sums pnl + fee of EVERY non-funding bill in its four
        # instTypes with no ccy conversion, a liquidation transfer included. A coin-denominated
        # one inside that set therefore cannot be compared like for like, and was skipped by a
        # ``continue`` that ran before the currency check. It must hit ``non_usd_ccy`` like
        # every other counted bucket.
        data = _q3_with(_row_kwargs("799999013", "110", "2026-07-12 12:00:00", ccy="BTC", pnl="0.3"))
        err = _stop(_aggregate_q3, data)
        assert err.stop_class == "non_usd_ccy"
        assert err.detail["ccys"] == {"BTC": {"rows": 1, "months": ["2026-07"]}}
        assert "0.3" not in _detail_text(err)

    def test_currency_non_external_coin_row_the_live_path_never_sees_is_counted_not_a_stop(self):
        # Outside the live instTypes (a blank instType) the live path never reads the row, so
        # there is nothing to reproduce: counted like the excluded realized classes.
        agg = _aggregate_q3(
            _q3_with(_row_kwargs("799999013", "110", "2026-07-12 12:00:00", instType="", ccy="BTC", balChg="0.3"))
        )
        assert agg.census["by_ccy"]["BTC"] == 1
        assert agg.census["excluded_non_usd_rows"] == 1
        assert "2026-07-12" not in agg.non_external_by_day  # a coin amount is never summed as dollars
        assert agg.non_external_by_day == {"2026-07-15": Decimal("30.00")}

    def test_currency_zero_effect_coin_row_does_not_raise(self):
        agg = _aggregate_q3(_q3_with(_row_kwargs("799999014", "2", "2026-07-12 12:00:00", ccy="BTC")))
        assert agg.census["by_ccy"]["BTC"] == 1
        assert "2026-07-12" not in agg.realized_by_day

    def test_currency_usd_family_is_exactly_usdt_usdc_usd(self):
        assert ARCHIVE_USD_FAMILY == frozenset({"USDT", "USDC", "USD"})

    def test_currency_usdc_and_usd_rows_are_summed_as_dollars(self):
        agg = _aggregate_q3(
            _q3_with(
                _row_kwargs("799999015", "2", "2026-07-12 12:00:00", ccy="USDC", pnl="1.25"),
                _row_kwargs("799999016", "2", "2026-07-12 13:00:00", ccy="USD", pnl="2.00", fee="-0.25"),
            )
        )
        assert agg.realized_by_day["2026-07-12"] == Decimal("3.00")

    def test_currency_blank_ccy_with_a_nonzero_effect_is_a_stop(self):
        data = _q3_with(_row_kwargs("799999017", "2", "2026-07-12 12:00:00", ccy="", pnl="1"))
        err = _stop(_aggregate_q3, data)
        assert err.stop_class == "non_usd_ccy"
        assert "(blank)" in err.detail["ccys"]


class TestExcludedInstTypeClasses:
    """T-RECON-3: realized rows the live path never sees are reported, never summed in."""

    def test_option_events_and_blank_inst_type_realized_rows_are_excluded_per_month(self):
        agg = _aggregate_q3(
            _q3_with(
                _row_kwargs("799999018", "2", "2026-07-12 12:00:00", instType="OPTION", pnl="1.00", fee="-0.10"),
                _row_kwargs("799999019", "2", "2026-08-12 12:00:00", instType="EVENTS", pnl="-4.00"),
                _row_kwargs("799999020", "2", "2026-08-13 12:00:00", instType="", pnl="0.25"),
            )
        )
        assert agg.excluded_by_month == {
            "2026-07": {"OPTION": Decimal("3.80")},  # the fixture's own OPTION row 2.90 plus 0.90
            "2026-08": {"EVENTS": Decimal("-4.00"), "BLANK": Decimal("0.25")},
        }
        # nothing excluded leaks into the realized leg
        assert "2026-07-12" not in agg.realized_by_day
        assert "2026-08-13" not in agg.realized_by_day
        assert agg.realized_by_day["2026-08-12"] == Decimal("-0.05")

    def test_option_rows_in_a_coin_are_not_summed_as_dollars(self):
        agg = _aggregate_q3(
            _q3_with(_row_kwargs("799999021", "2", "2026-09-12 12:00:00", instType="OPTION", ccy="BTC", pnl="0.1"))
        )
        assert "2026-09" not in agg.excluded_by_month
        assert agg.census["excluded_non_usd_rows"] == 1


class TestNonExternalRealizedParity:
    """WR-01: the archive realized leg is ``pnl + fee`` of every non-funding bill in the live
    path's four instTypes, whatever its subtype (``exchange.fetch_daily_pnl`` filters on
    ``instType`` and drops only type 8). The seed table keeps liquidation transfers and forced
    repayments out of FLOWS (they are not external capital), but their ``pnl`` and ``fee`` are
    inside the live number, so leaving them out of the archive leg changes the P&L of every
    gap day, where nothing reconciles, relative to the method D-07 promises is identical."""

    def test_a_forced_repayment_row_adds_its_pnl_and_fee_to_the_day(self):
        # Independent literal: one 114 row, pnl -3.00 and fee -0.50, on a day with no other bill.
        agg = _aggregate_q3(
            _q3_with(
                _row_kwargs("799999030", "114", "2026-07-12 12:00:00", pnl="-3.00", fee="-0.50", balChg="-3.50")
            )
        )
        assert agg.realized_by_day["2026-07-12"] == Decimal("-3.50")
        # ... and its balance change is still reported as non-external, never as a flow.
        assert agg.non_external_by_day["2026-07-12"] == Decimal("-3.50")
        assert "2026-07-12" not in agg.flows_by_day

    def test_it_is_added_to_a_trade_of_the_same_day_not_instead_of_it(self):
        agg = _aggregate_q3(
            _q3_with(
                _row_kwargs("799999031", "2", "2026-07-12 10:00:00", pnl="10.00", fee="-0.25", balChg="9.75"),
                _row_kwargs("799999032", "115", "2026-07-12 11:00:00", pnl="-4.00", fee="-1.00", balChg="-5.00"),
            )
        )
        assert agg.realized_by_day["2026-07-12"] == Decimal("4.75")

    def test_a_non_external_row_outside_the_live_inst_types_is_excluded_and_reported(self):
        agg = _aggregate_q3(
            _q3_with(
                _row_kwargs("799999033", "16", "2026-07-12 12:00:00", instType="OPTION", pnl="-2.00", fee="-0.20")
            )
        )
        assert agg.realized_by_day.get("2026-07-12", Decimal(0)) == 0
        assert agg.excluded_by_month["2026-07"]["OPTION"] == Decimal("2.90") - Decimal("2.20")

    def test_a_zero_effect_liquidation_transfer_changes_nothing(self):
        # The fixture's own 110 row (SWAP, pnl 0, fee 0, balChg 30) shares 07-15 with a
        # partial liquidation of pnl -25.00 and fee -2.00: the day's realized stays -27.00.
        agg = _aggregate_q3((FIXTURES / "q3_like.csv").read_bytes())
        assert agg.realized_by_day["2026-07-15"] == Decimal("-27.00")
        assert agg.non_external_by_day == {"2026-07-15": Decimal("30.00")}


class TestLiveInstTypePin:
    """D-09: the archive's realized leg uses the same instType set as the live path.

    If fetch_daily_pnl ever widened or narrowed its instType loop, the archive leg would
    reconcile against a different set of rows than the live leg and a cent-level miss
    would be a classification artifact. The read is of the source text, and it must find
    at least one list so that a refactor hiding the list cannot pass vacuously.
    """

    @staticmethod
    def _find_inst_type_lists(source: str) -> list[tuple[str, ...]]:
        tree = ast.parse(source)
        fn = next(
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.AsyncFunctionDef) and node.name == "fetch_daily_pnl"
        )
        found: list[tuple[str, ...]] = []
        for node in ast.walk(fn):
            if (
                isinstance(node, ast.For)
                and isinstance(node.target, ast.Name)
                and node.target.id == "inst_type"
                and isinstance(node.iter, (ast.List, ast.Tuple))
                and all(isinstance(e, ast.Constant) and isinstance(e.value, str) for e in node.iter.elts)
            ):
                found.append(tuple(e.value for e in node.iter.elts))
        return found

    @staticmethod
    def _drifted_positions(found: list[tuple[str, ...]], expected: tuple[str, ...]) -> list[int]:
        if not found:
            raise AssertionError("no instType list literal found in fetch_daily_pnl; the pin would be vacuous")
        return [i + 1 for i, lst in enumerate(found) if lst != expected]

    def test_live_realized_inst_types_equal_every_list_in_fetch_daily_pnl(self):
        found = self._find_inst_type_lists(EXCHANGE_SOURCE.read_text(encoding="utf-8"))
        assert len(found) >= 1
        drifted = self._drifted_positions(found, LIVE_REALIZED_INST_TYPES)
        assert drifted == [], f"instType list(s) number {drifted} of {len(found)} differ from LIVE_REALIZED_INST_TYPES"

    def test_pin_guard_fails_when_no_list_is_found(self):
        src = "async def fetch_daily_pnl(x):\n    for inst_type in INST_TYPES:\n        pass\n"
        found = self._find_inst_type_lists(src)
        assert found == []
        with pytest.raises(AssertionError, match="vacuous"):
            self._drifted_positions(found, LIVE_REALIZED_INST_TYPES)

    def test_pin_guard_names_the_drifted_list_by_position(self):
        src = (
            "async def fetch_daily_pnl(x):\n"
            "    for inst_type in ['SWAP', 'FUTURES', 'SPOT', 'MARGIN']:\n        pass\n"
            "    for inst_type in ['SWAP', 'FUTURES', 'SPOT']:\n        pass\n"
        )
        found = self._find_inst_type_lists(src)
        assert self._drifted_positions(found, LIVE_REALIZED_INST_TYPES) == [2]

    def test_pin_guard_catches_a_reordered_list(self):
        src = "async def fetch_daily_pnl(x):\n    for inst_type in ['SPOT', 'SWAP', 'FUTURES', 'MARGIN']:\n        pass\n"
        assert self._drifted_positions(self._find_inst_type_lists(src), LIVE_REALIZED_INST_TYPES) == [1]

    def test_realized_leg_applies_the_filter_to_a_margin_row(self):
        agg = _aggregate_q3(_q3_with(_row_kwargs("799999022", "1", "2026-07-12 12:00:00", instType="MARGIN", pnl="2.5")))
        assert agg.realized_by_day["2026-07-12"] == Decimal("2.5")


class TestOneChainNotTwo:
    """There is ONE bal reading and it is the gated chain. An ungated second reading
    (``bal_continuity``) could disagree with the gate and leave the founder two numbers for the
    same fact, so the aggregate no longer carries it."""

    def test_the_aggregate_carries_no_second_ungated_continuity_reading(self):
        assert "bal_continuity" not in ArchiveAggregate.__dataclass_fields__
        assert not hasattr(_aggregate_q3((FIXTURES / "q3_like.csv").read_bytes()), "bal_continuity")


class TestBalChainCompleteness:
    """F1 (silent-failure-hunter, HIGH): a quarter file is treated as the COMPLETE ledger of
    its quarter, so a covered day with no bill becomes an explicit 0.0 return. A file that is
    missing rows (a truncated download, a partial export) must therefore be refused, or its
    missing weeks are published as quiet days. OKX's ``bal`` is the balance after each bill,
    so per ccy and in billId order ``bal == previous bal + balChg`` must hold; a dropped row
    breaks the chain at the next bill."""

    def _file(self, name="q3_like.csv", *, quarter="Q3", drop=(), edit=None):
        header, rows = _read_fixture(name)
        rows = [r for r in rows if r[header.index("billId")] not in drop]
        if edit is not None:
            edit(header, rows)
        return parse_archive_csv(_emit(header, rows), year=2026, quarter=quarter)

    def test_a_chaining_file_passes_and_returns_its_reading(self):
        reading = _chain([self._file("q2_like.csv", quarter="Q2")])
        # q2_like.csv carries 14 USDT bills: 13 consecutive pairs, first bill 04-01, last 06-30.
        assert reading == {
            "ccys": {"USDT": {"pairs_checked": 13, "first_day": "2026-04-01", "last_day": "2026-06-30"}},
            "total_pairs": 13,
        }

    def test_the_q3_fixture_chains_with_the_floor_met_by_each_of_its_ccys(self):
        reading = _chain([self._file()])
        # 19 USDT bills -> 18 pairs; 3 USDC bills -> 2 pairs, exactly the floor.
        assert reading["ccys"]["USDT"]["pairs_checked"] == 18
        assert reading["ccys"]["USDC"]["pairs_checked"] == MIN_CHAINED_PAIRS == 2
        assert reading["total_pairs"] == 20

    def test_an_interior_row_dropped_from_the_file_is_archive_incomplete(self):
        # 700000007 (a 7.47 trade) is removed: the next bill's bal no longer follows.
        err = _stop(_chain, [self._file(drop={"700000007"})])
        assert err.stop_class == "archive_incomplete"
        assert err.detail["reason"] == "bal_chain_break"
        usdt = err.detail["ccys"]["USDT"]
        assert usdt["breaks"] == 1
        # The first row AFTER the gap is 700000008 on 2026-07-15 (ts 1784106000000).
        assert usdt["first_break_day"] == "2026-07-15"
        assert usdt["seam_breaks"] == 0

    def test_the_stop_carries_counts_and_dates_never_an_amount(self):
        err = _stop(_chain, [self._file(drop={"700000007"})])
        text = _detail_text(err)
        for amount in ("3915.45", "3942.45", "7.47", "27.00", "3945.45"):
            assert amount not in text, f"an amount leaked into the stop detail: {amount}"

    def test_dropping_the_last_row_of_a_ccy_cannot_be_seen_and_is_the_documented_residual(self):
        # A tail loss leaves the surviving prefix intact: the chain proves INTERIOR
        # completeness only (plus the seam between adjacent quarters). The head of the
        # earliest file and the tail of the latest are what ts_min_day / ts_max_day and the
        # longest bill-less run are for; this test records the limit instead of hiding it.
        _chain([self._file(drop={"700000020"})])

    def test_a_row_with_no_ccy_cannot_be_chained_and_stops_rather_than_assuming(self):
        def blank_ccy(header, rows):
            rows[3][header.index("ccy")] = ""

        err = _stop(verify_bal_chain, [self._file(edit=blank_ccy)], frozenset())
        assert err.stop_class == "archive_incomplete"
        assert err.detail["reason"] == "unchainable_row"

    def test_a_non_numeric_bill_id_cannot_be_ordered_and_stops_rather_than_assuming(self):
        def odd_id(header, rows):
            rows[3][header.index("billId")] = "abc-3"

        err = _stop(verify_bal_chain, [self._file(edit=odd_id)], frozenset())
        assert err.stop_class == "archive_incomplete"
        assert err.detail["reason"] == "unchainable_row"

    def test_a_bill_with_both_causes_is_one_stopping_row_counted_under_each_cause(self):
        """D-16. The cause counts may overlap, but ``rows`` is how many bills stopped the run,
        so a bill with both causes must count once there or the founder over-reads the damage.
        The bill has an effect (``balChg`` and ``pnl`` nonzero), so this holds unchanged once
        the blank-ccy count is narrowed to bills with an effect."""

        def both(header, rows):
            rows[3][header.index("ccy")] = ""
            rows[3][header.index("billId")] = "abc-3"

        err = _stop(verify_bal_chain, [self._file(edit=both)], frozenset())
        assert err.stop_class == "archive_incomplete"
        detail = err.detail
        assert (
            detail["reason"], detail["rows"], detail["blank_ccy"], detail["nondigit_bill_id"],
            detail["first_day"], detail["last_day"],
        ) == ("unchainable_row", 1, 1, 1, "2026-07-02", "2026-07-02")
        assert [f["rows"] for f in detail["files"]] == [1]


def _ledger(quarter, bills, *, opening, first_id, ccy="USDT"):
    """One chaining quarter file built from ``(when, balChg)`` pairs: ``bal`` is the running
    balance after each bill, so the file chains exactly as a complete real one does. Returns
    the typed header and rows (so a test can drop some) and the closing balance."""
    header, _ = _read_fixture("q3_like.csv")
    bal, rows = Decimal(opening), []
    for i, (when, chg) in enumerate(bills):
        bal += Decimal(chg)
        rows.append(
            _new_row(
                header, instType="SWAP", billId=str(first_id + i), subType="2", ts=_ms(when),
                balChg=chg, bal=str(bal), ccy=ccy, pnl=chg, fee="0",
            )
        )
    return header, rows, bal


def _parsed(header, rows, quarter):
    return parse_archive_csv(_emit(header, rows), year=2026, quarter=quarter)


Q2_BILLS = [("2026-04-02 10:00:00", "10"), ("2026-05-10 10:00:00", "20"),
            ("2026-06-20 10:00:00", "5"), ("2026-06-29 10:00:00", "7")]
Q3_BILLS = [("2026-07-02 10:00:00", "3"), ("2026-07-15 10:00:00", "4"),
            ("2026-08-10 10:00:00", "6"), ("2026-09-01 10:00:00", "8")]


def _q2_q3_ledgers():
    """Two adjacent quarters of ONE account: Q3 opens on Q2's closing balance (1042)."""
    h2, r2, closing = _ledger("Q2", Q2_BILLS, opening="1000", first_id=100)
    h3, r3, _ = _ledger("Q3", Q3_BILLS, opening=closing, first_id=200)
    return (h2, r2), (h3, r3)


class TestBalChainCrossesTheQuarterSeam:
    """WR-01 / N2. Chaining each file on its own never checks the Q2 tail -> Q3 head seam, and
    a truncated tail or head there is published as 0.0 days inside the gaps, outside the
    reconcile window and D-03. The chain runs per currency across the deduplicated rows of
    every ADJACENT requested quarter, in billId order."""

    def test_two_adjacent_quarters_that_chain_across_the_seam_pass(self):
        (h2, r2), (h3, r3) = _q2_q3_ledgers()
        reading = _chain([_parsed(h2, r2, "Q2"), _parsed(h3, r3, "Q3")])
        # 8 bills in one USDT chain: 7 pairs, one of them the seam pair (06-29 -> 07-02).
        assert reading == {
            "ccys": {"USDT": {"pairs_checked": 7, "first_day": "2026-04-02", "last_day": "2026-09-01"}},
            "total_pairs": 7,
        }

    def test_a_q2_file_missing_its_last_rows_stops_at_the_seam(self):
        (h2, r2), (h3, r3) = _q2_q3_ledgers()
        truncated = r2[:3]  # the 06-29 bill is gone; Q2 still chains on its own (2 pairs)
        _chain([_parsed(h2, truncated, "Q2")])
        err = _stop(_chain, [_parsed(h2, truncated, "Q2"), _parsed(h3, r3, "Q3")])
        assert err.stop_class == "archive_incomplete" and err.detail["reason"] == "bal_chain_break"
        usdt = err.detail["ccys"]["USDT"]
        assert (usdt["breaks"], usdt["seam_breaks"], usdt["first_break_day"]) == (1, 1, "2026-07-02")

    def test_a_q3_file_missing_its_first_rows_stops_at_the_seam(self):
        (h2, r2), (h3, r3) = _q2_q3_ledgers()
        truncated = r3[1:]  # the 07-02 bill is gone; Q3 still chains on its own (2 pairs)
        _chain([_parsed(h3, truncated, "Q3")])
        err = _stop(_chain, [_parsed(h2, r2, "Q2"), _parsed(h3, truncated, "Q3")])
        assert err.stop_class == "archive_incomplete"
        usdt = err.detail["ccys"]["USDT"]
        assert (usdt["breaks"], usdt["seam_breaks"], usdt["first_break_day"]) == (1, 1, "2026-07-15")

    def test_the_order_the_files_are_passed_in_does_not_matter(self):
        (h2, r2), (h3, r3) = _q2_q3_ledgers()
        err = _stop(_chain, [_parsed(h3, r3[1:], "Q3"), _parsed(h2, r2, "Q2")])
        assert err.detail["ccys"]["USDT"]["seam_breaks"] == 1

    def test_quarters_that_are_not_adjacent_are_never_chained_to_each_other(self):
        # Q2 and Q4 of the same account: Q3 is missing, so the balances legitimately differ.
        # Chaining across the hole would be a false stop on a complete pair of files.
        h2, r2, _ = _ledger("Q2", Q2_BILLS, opening="1000", first_id=100)
        h4, r4, _ = _ledger(
            "Q4", [("2026-10-05 10:00:00", "2"), ("2026-11-05 10:00:00", "3"), ("2026-12-05 10:00:00", "4")],
            opening="9000", first_id=300,
        )
        reading = _chain([_parsed(h2, r2, "Q2"), _parsed(h4, r4, "Q4")])
        assert reading["ccys"]["USDT"]["pairs_checked"] == 3 + 2

    def test_a_break_inside_one_file_is_still_found_and_not_called_a_seam_break(self):
        (h2, r2), (h3, r3) = _q2_q3_ledgers()
        err = _stop(_chain, [_parsed(h2, r2, "Q2"), _parsed(h3, r3[:1] + r3[2:], "Q3")])
        usdt = err.detail["ccys"]["USDT"]
        assert (usdt["breaks"], usdt["seam_breaks"], usdt["first_break_day"]) == (1, 0, "2026-08-10")

    def test_the_stop_names_each_file_range_for_the_founder(self):
        (h2, r2), (h3, r3) = _q2_q3_ledgers()
        err = _stop(_chain, [_parsed(h2, r2[:2], "Q2"), _parsed(h3, r3, "Q3")])
        assert err.detail["files"] == [
            {"ts_min_day": "2026-04-02", "ts_max_day": "2026-05-10"},
            {"ts_min_day": "2026-07-02", "ts_max_day": "2026-09-01"},
        ]


def _blank(bill_id: str, when: str, **overrides: str) -> dict[str, str]:
    """The cells of a blank-ccy SWAP subType-2 bill: ``balChg``, ``bal``, ``pnl`` and ``fee``
    are all 0 unless overridden."""
    return {
        "instType": "SWAP", "billId": bill_id, "subType": "2", "ts": _ms(when), "ccy": "",
        "balChg": "0", "bal": "0", "pnl": "0", "fee": "0", **overrides,
    }


def _interleaved_q3(*extra: dict[str, str]):
    """The four-bill Q3 ledger with its billIds renumbered 2000, 2010, 2020 and 2030, plus one
    row per ``extra`` cells dict, so an extra billId between them sits between two USDT bills
    in billId order."""
    header, rows, _ = _ledger("Q3", Q3_BILLS, opening="1000", first_id=200)
    for row, bill_id in zip(rows, ("2000", "2010", "2020", "2030")):
        row[header.index("billId")] = bill_id
    return header, [*rows, *(_new_row(header, **cells) for cells in extra)]


class TestBlankCcyZeroEffectSkip:
    """D-16. A bill with a blank ``ccy`` fits no currency's chain. When its ``balChg``, ``pnl``
    and ``fee`` are all 0 it cannot have moved any balance, so it is left out of the chain and
    counted; any other bill the chain cannot place still stops. A skip that took a bill with
    money on it, or one the chain cannot order, would let a file missing that money pass the
    completeness proof and publish missing days as 0.0."""

    def test_a_zero_effect_blank_ccy_row_is_skipped_counted_and_its_neighbours_still_chain(self):
        """D-16. ``bal`` is the balance AFTER a bill (state, not effect), so the second blank
        row carries a nonzero ``bal`` and is still zero effect."""
        header, rows = _interleaved_q3(
            _blank("2005", "2026-07-03 10:00:00"), _blank("2015", "2026-07-20 10:00:00", bal="999"),
        )
        assert _chain([_parsed(header, rows, "Q3")]) == {
            "ccys": {"USDT": {"pairs_checked": 3, "first_day": "2026-07-02", "last_day": "2026-09-01"}},
            "total_pairs": 3,
            "blank_ccy_skipped": 2,
        }

    @pytest.mark.parametrize("field", ["balChg", "pnl", "fee"])
    def test_a_blank_ccy_row_with_any_effect_still_stops_as_blank_ccy(self, field):
        """D-16. Each of the three effect columns alone keeps the bill in the stop: a blank-ccy
        bill with money on it moved a balance the chain cannot attribute."""
        header, rows = _interleaved_q3(_blank("2005", "2026-07-03 10:00:00", **{field: "0.01"}))
        err = _stop(verify_bal_chain, [_parsed(header, rows, "Q3")], frozenset())
        assert err.stop_class == "archive_incomplete"
        detail = err.detail
        assert (
            detail["reason"], detail["rows"], detail["blank_ccy"], detail["nondigit_bill_id"],
            detail["blank_ccy_skipped"], detail["first_day"], detail["last_day"],
        ) == ("unchainable_row", 1, 1, 0, 0, "2026-07-03", "2026-07-03")

    def test_a_zero_effect_blank_ccy_row_with_a_non_digit_bill_id_still_stops(self):
        """D-16. A bill the chain cannot order is never skipped, whatever its effect: its
        position between its neighbours is unknown."""
        header, rows = _interleaved_q3(_blank("x2005", "2026-07-03 10:00:00"))
        err = _stop(verify_bal_chain, [_parsed(header, rows, "Q3")], frozenset())
        detail = err.detail
        assert (
            detail["reason"], detail["rows"], detail["blank_ccy"], detail["nondigit_bill_id"],
            detail["blank_ccy_skipped"],
        ) == ("unchainable_row", 1, 0, 1, 0)

    def test_a_skipped_row_cannot_hide_a_missing_bill(self):
        """D-16. The skipped bill sits where USDT bill 2010 was. The chain still breaks at the
        next USDT bill, so the missing bill is found whether or not the blank line is skipped."""
        header, rows = _interleaved_q3(_blank("2015", "2026-07-20 10:00:00"))
        rows = [r for r in rows if r[header.index("billId")] != "2010"]
        err = _stop(_chain, [_parsed(header, rows, "Q3")])
        assert err.detail["reason"] == "bal_chain_break"
        assert err.detail["ccys"]["USDT"]["first_break_day"] == "2026-08-10"
        assert err.detail["blank_ccy_skipped"] == 1


# D-15: OKX cuts a quarter file at 00:00 UTC+8 (16:00 UTC the day before), so a real Q2 file
# opens on 2026-03-31 and a real Q3 file on 2026-06-30. Each pair is (when UTC, balChg).
Q2_EDGE_BILLS = [("2026-03-31 20:00:00", "3"), ("2026-04-02 10:00:00", "10"),
                 ("2026-05-10 10:00:00", "20"), ("2026-06-20 10:00:00", "5"),
                 ("2026-06-30 10:00:00", "5")]
Q3_EDGE_BILLS = [("2026-06-30 20:00:00", "7"), ("2026-07-02 10:00:00", "3"),
                 ("2026-07-15 10:00:00", "4"), ("2026-08-10 10:00:00", "6"),
                 ("2026-09-01 10:00:00", "8"), ("2026-09-30 10:00:00", "4")]


def _edge_pair():
    """A Q2 and a Q3 file of ONE account cut at 00:00 UTC+8; Q3 opens on Q2's closing 1043."""
    h2, r2, closing = _ledger("Q2", Q2_EDGE_BILLS, opening="1000", first_id=100)
    h3, r3, _ = _ledger("Q3", Q3_EDGE_BILLS, opening=str(closing), first_id=200)
    return _parsed(h2, r2, "Q2"), _parsed(h3, r3, "Q3")


class TestQuarterCutAtUtcPlus8:
    """D-15. OKX cuts quarters at 00:00 UTC+8, not at 00:00 UTC. The real Q2 file therefore
    starts at 16:00 UTC on 03-31 and a parser on calendar-UTC bounds refuses a correct file.
    One that accepted it but kept summing by file would publish a partial 03-31, 06-30 or
    09-30 as if it were a whole day, so a quarter-edge UTC day counts only when both
    neighbouring files were read."""

    def test_a_q2_q3_pair_cut_at_utc_plus_8_parses_aggregates_whole_utc_days_and_chains_across_the_seam(self):
        q2, q3 = _edge_pair()
        # Imported here, after the parse, so the symbol need not exist for the file to collect.
        from services.okx_archive_files import quarter_edge_days

        assert (q2.ts_min_day, q2.ts_max_day, q2.row_count) == ("2026-03-31", "2026-06-30", 5)
        assert len(q2.covered_days) == 90
        assert (q2.head_edge_day, q2.tail_edge_day) == ("2026-03-31", "2026-06-30")
        assert q2.head_edge_day not in q2.covered_days and q2.tail_edge_day not in q2.covered_days
        assert (q3.ts_min_day, q3.ts_max_day, q3.row_count) == ("2026-06-30", "2026-09-30", 6)
        assert len(q3.covered_days) == 91
        assert (q3.head_edge_day, q3.tail_edge_day) == ("2026-06-30", "2026-09-30")
        assert q3.head_edge_day not in q3.covered_days and q3.tail_edge_day not in q3.covered_days

        assert quarter_edge_days([q2, q3]) == (
            frozenset({"2026-06-30"}),
            frozenset({"2026-03-31", "2026-09-30"}),
        )

        aggregate = aggregate_archive([q2, q3], None)
        assert aggregate.realized_by_day == {
            "2026-04-02": Decimal("10"),
            "2026-05-10": Decimal("20"),
            "2026-06-20": Decimal("5"),
            "2026-06-30": Decimal("12"),  # 5 from Q2's last hours + 7 from Q3's first hours
            "2026-07-02": Decimal("3"),
            "2026-07-15": Decimal("4"),
            "2026-08-10": Decimal("6"),
            "2026-09-01": Decimal("8"),
        }
        first = date(2026, 4, 1)
        assert aggregate.covered_days == frozenset(
            (first + timedelta(days=i)).isoformat() for i in range(182)  # 04-01 .. 09-29
        )
        assert max(aggregate.covered_days) == "2026-09-29"
        assert aggregate.edge_days_whole == frozenset({"2026-06-30"})
        assert aggregate.edge_days_missing == frozenset({"2026-03-31", "2026-09-30"})

        # 11 bills in one USDT chain, the seam pair and both edge-day bills included.
        assert verify_bal_chain([q2, q3], aggregate.summed_ccys) == {
            "ccys": {"USDT": {"pairs_checked": 10, "first_day": "2026-03-31", "last_day": "2026-09-30"}},
            "total_pairs": 10,
        }

        reading = reconcile_leg(
            "realized",
            aggregate.realized_by_day,
            {"2026-08-10": Decimal("6"), "2026-09-01": Decimal("8")},
            ("2026-08-03", "2026-09-29"),
        )
        assert reading.ok is True
        assert reading.days_compared == 58

    # ---- the exact-millisecond bounds (T-167.1.2.2.2.1-46)
    @staticmethod
    def _q2_without_its_tail_row():
        """The Q2 fixture minus its last data line, which sits one ms before the TAIL cut and
        would otherwise let a wrong tail bound decide a test about the HEAD bound."""
        header, rows = _read_fixture("q2_like.csv")
        return header, rows[:-1]

    def test_a_q2_row_at_16_00_utc_on_03_31_is_inside_the_quarter(self):
        """D-15: Q2 opens at 2026-03-31T16:00:00.000Z (04-01 00:00 UTC+8). A calendar-UTC bound
        refuses the real Q2 file; this is the first instant it must accept, and 03-31 is an
        edge day, not a covered one."""
        header, rows = self._q2_without_its_tail_row()
        rows.append(_new_row(header, **_row_kwargs("600000099", "2", "2026-04-01 00:00:00", ts="1774972800000")))
        parsed = parse_archive_csv(_emit(header, rows), year=2026, quarter="Q2")
        assert parsed.ts_min_day == "2026-03-31"
        assert "2026-03-31" not in parsed.covered_days

    def test_a_q2_row_one_millisecond_earlier_stops_with_the_utc_days_observed(self):
        """D-15: one ms before 2026-03-31T16:00Z belongs to Q1. A bound that is too wide
        (say nine hours instead of eight) would let another quarter's bill into Q2's days."""
        header, rows = self._q2_without_its_tail_row()
        rows.append(_new_row(header, **_row_kwargs("600000099", "2", "2026-04-01 00:00:00", ts="1774972799999")))
        err = _stop(parse_archive_csv, _emit(header, rows), year=2026, quarter="Q2")
        assert err.stop_class == "quarter_range_mismatch"
        assert err.detail["range_start"] == "2026-04-01"
        assert err.detail["range_end_exclusive"] == "2026-07-01"
        assert err.detail["observed_min_day"] == "2026-03-31"
        assert err.detail["rows_outside"] == 1

    def test_the_q2_file_ends_one_millisecond_before_16_00_utc_on_06_30(self):
        """D-15: Q2 ends, exclusive, at 2026-06-30T16:00:00.000Z. The fixture's last bill is the
        final millisecond inside; the next instant is Q3's first and must stop Q2."""
        parsed = parse_archive_csv((FIXTURES / "q2_like.csv").read_bytes(), year=2026, quarter="Q2")
        assert parsed.ts_max_day == "2026-06-30"
        header, rows = _read_fixture("q2_like.csv")
        rows[-1][header.index("ts")] = "1782835200000"
        err = _stop(parse_archive_csv, _emit(header, rows), year=2026, quarter="Q2")
        assert err.stop_class == "quarter_range_mismatch"
        assert err.detail["observed_max_day"] == "2026-06-30"
        assert err.detail["rows_outside"] == 1

    def test_a_q3_row_at_16_00_utc_on_06_30_is_inside_the_quarter(self):
        """D-15: the instant Q2 stops at is the first one Q3 accepts, so no bill is in both
        files and none falls in neither."""
        header, rows = _read_fixture("q3_like.csv")
        rows[0][header.index("ts")] = "1782835200000"
        parsed = parse_archive_csv(_emit(header, rows), year=2026, quarter="Q3")
        assert parsed.ts_min_day == "2026-06-30"

    # ---- the both-files rule for a quarter-edge UTC day (T-167.1.2.2.2.1-45)
    def test_an_edge_day_has_a_daily_total_only_when_both_neighbouring_files_were_read(self):
        """D-15 / TRADESYNC D-02: a quarter-edge UTC day one file reaches holds hours of a day.
        Summing it would publish a partial day as a whole one, so it has no total, no covered
        entry and no row until the other half is read."""
        q2, q3 = _edge_pair()
        only_q3 = aggregate_archive([q3], None)
        for day in ("2026-06-30", "2026-09-30"):
            assert day not in only_q3.realized_by_day
            assert day not in only_q3.covered_days
        assert only_q3.edge_days_missing == frozenset({"2026-06-30", "2026-09-30"})
        only_q2 = aggregate_archive([q2], None)
        for day in ("2026-03-31", "2026-06-30"):
            assert day not in only_q2.realized_by_day
            assert day not in only_q2.covered_days
        assert aggregate_archive([q2, q3], None).realized_by_day["2026-06-30"] == Decimal("12")

    def test_no_leg_and_no_excluded_month_carries_a_missing_edge_day(self):
        """D-15 / TRADESYNC D-02: the gate covers every sum, not only the realized one. A funding
        figure, a flow, a non-external transfer or an excluded-class amount on a day only one
        file reaches would be a partial day in a leg the factsheet publishes."""
        header, _ = _read_fixture("q3_like.csv")

        def five(prefix: str, when: str) -> list[list[str]]:
            kinds = [
                _row_kwargs(f"{prefix}1", "2", when, pnl="4", fee="-0.5", balChg="3.5"),  # SWAP realized
                _row_kwargs(f"{prefix}2", "174", when, pnl="0.9", balChg="0.9"),  # funding
                _row_kwargs(f"{prefix}3", "11", when, instType="", balChg="500"),  # external flow
                _row_kwargs(f"{prefix}4", "110", when, balChg="-15"),  # liquidation transfer
                _row_kwargs(f"{prefix}5", "2", when, instType="OPTION", pnl="-1.5", fee="-0.05"),  # excluded
            ]
            return [_new_row(header, **kind) for kind in kinds]

        rows = five("8001", "2026-06-30 20:00:00") + five("8002", "2026-07-01 10:00:00")
        aggregate = _aggregate_q3(_emit(header, rows))
        legs = (aggregate.realized_by_day, aggregate.funding_by_day,
                aggregate.flows_by_day, aggregate.non_external_by_day)
        for leg in legs:
            assert "2026-07-01" in leg  # the control day, same five rows, is summed
            assert "2026-06-30" not in leg
        assert aggregate.excluded_by_month == {"2026-07": {"OPTION": Decimal("-1.55")}}
        assert "2026-06-30" not in aggregate.covered_days

    @pytest.mark.parametrize(
        ("overrides", "stop_class"),
        [
            ({"subType": "99999", "pnl": "5"}, "unknown_subtype_nonzero"),
            ({"ccy": "BTC", "subType": "2", "pnl": "0.1"}, "non_usd_ccy"),
        ],
    )
    def test_a_bill_on_a_missing_edge_day_is_still_classified(self, overrides, stop_class):
        """D-08 / D-15: an accepted file is classified whole. The gate is on the SUMS, never on
        classification, so an unclassifiable or coin-denominated bill on an edge day still stops."""
        row = _row_kwargs("8003", "2", "2026-06-30 20:00:00", **overrides)
        err = _stop(_aggregate_q3, _q3_with(row))
        assert err.stop_class == stop_class


class TestBalChainFloor:
    """N1. A chain that checked 0 or 1 pairs for a currency that carries money proves
    nothing: a single link between two bills cannot tell a complete ledger from a truncated one.
    ``MIN_CHAINED_PAIRS`` (2: at least three bills, so the chain has an interior bill that is
    both a successor and a predecessor) is the floor; below it the currency is unprovable and
    the file stops as ``archive_incomplete`` rather than passing unexamined."""

    def test_the_floor_is_two_pairs(self):
        assert MIN_CHAINED_PAIRS == 2

    def _with_usdc(self, *, keep):
        header, rows = _read_fixture("q3_like.csv")
        rows = [r for r in rows if r[header.index("ccy")] != "USDC" or r[header.index("billId")] in keep]
        return parse_archive_csv(_emit(header, rows), year=2026, quarter="Q3")

    def test_one_pair_for_a_ccy_with_money_on_it_is_too_few(self):
        # 700000010 (3.33 pnl) and 700000021: two bills, ONE pair.
        err = _stop(_chain, [self._with_usdc(keep={"700000010", "700000021"})])
        assert err.stop_class == "archive_incomplete" and err.detail["reason"] == "too_few_pairs"
        assert err.detail["starved"] == ["USDC"]
        assert err.detail["ccys"]["USDC"]["pairs_checked"] == 1

    def test_a_lone_row_with_money_on_it_has_no_pair_at_all(self):
        err = _stop(_chain, [self._with_usdc(keep={"700000010"})])
        assert err.detail["reason"] == "too_few_pairs" and err.detail["starved"] == ["USDC"]

    def test_exactly_two_pairs_meets_the_floor(self):
        _chain([self._with_usdc(keep={"700000010", "700000021", "700000022"})])

    def test_a_ccy_whose_every_bill_is_zero_effect_needs_no_proof(self):
        header, rows = _read_fixture("q3_like.csv")
        rows = [r for r in rows if r[header.index("ccy")] != "USDC"]
        rows.append(
            _new_row(header, instType="SWAP", billId="700000030", subType="2", ts=_ms("2026-08-03 10:00:00"),
                     balChg="0", bal="50", ccy="USD", pnl="0", fee="0")
        )
        reading = _chain([parse_archive_csv(_emit(header, rows), year=2026, quarter="Q3")])
        assert reading["ccys"]["USD"]["pairs_checked"] == 0

    def test_a_chain_break_is_reported_before_the_floor(self):
        header, rows = _read_fixture("q3_like.csv")
        rows = [r for r in rows if r[header.index("billId")] not in {"700000007", "700000021", "700000022"}]
        err = _stop(_chain, [parse_archive_csv(_emit(header, rows), year=2026, quarter="Q3")])
        assert err.detail["reason"] == "bal_chain_break"


class TestBalChainFloorScope:
    """WR-01 (review round 3). The ``MIN_CHAINED_PAIRS`` floor proves the files are complete
    for the money the rebuild SUMS. A currency whose rows the aggregate never sums (a
    coin-margined option settles in BTC; a USD-family OPTION bill is reported per month and
    class, never added to the realized leg) has no published figure resting on its
    completeness, so a lone bill of it must not stop the job. The BREAK check is a different
    question - a break anywhere means a truncated file - and still runs on every currency."""

    @staticmethod
    def _q3_plus(*extra: dict[str, str]):
        return parse_archive_csv(_q3_with(*extra), year=2026, quarter="Q3")

    @staticmethod
    def _btc_option(bill_id: str, when: str, *, chg: str, bal: str) -> dict[str, str]:
        return dict(instType="OPTION", billId=bill_id, subType="2", ts=_ms(when), balChg=chg,
                    bal=bal, ccy="BTC", pnl=chg, fee="0")

    def test_summed_ccys_names_exactly_the_currencies_whose_money_the_aggregate_adds(self):
        file = self._q3_plus(
            self._btc_option("700000040", "2026-09-20 10:00:00", chg="0.5", bal="0.5"),
            dict(instType="OPTION", billId="700000041", subType="2", ts=_ms("2026-09-21 10:00:00"),
                 balChg="3", bal="3", ccy="USDC", pnl="3", fee="0"),
        )
        aggregate = aggregate_archive([file], None)
        # The fixture's USDT and USDC bills reach the realized/funding/flow legs; the BTC
        # option bill is counted in excluded_non_usd_rows and the USDC OPTION bill is only
        # reported under excluded_by_month. USDC stays because the fixture's own USDC bills sum.
        assert aggregate.summed_ccys == frozenset({"USDT", "USDC"})
        assert aggregate.census["excluded_non_usd_rows"] == 1

    def test_a_lone_coin_margined_option_bill_passes_the_floor_and_is_still_reported(self):
        file = self._q3_plus(self._btc_option("700000040", "2026-09-20 10:00:00", chg="0.5", bal="0.5"))
        reading = _chain([file])
        assert reading["ccys"]["BTC"] == {"pairs_checked": 0, "first_day": "2026-09-20", "last_day": "2026-09-20"}

    def test_a_lone_usdc_realized_bill_still_stops_the_floor(self):
        # The USD family IS summed, so a lone bill of it is unprovable and must stop.
        err = _stop(_chain, [TestBalChainFloor()._with_usdc(keep={"700000010"})])
        assert err.detail["reason"] == "too_few_pairs" and err.detail["starved"] == ["USDC"]

    def test_a_break_inside_an_unsummed_currency_still_stops(self):
        file = self._q3_plus(
            self._btc_option("700000040", "2026-09-20 10:00:00", chg="0.5", bal="0.5"),
            self._btc_option("700000041", "2026-09-21 10:00:00", chg="0.25", bal="0.75"),
            # a missing bill between: bal jumps by 1.0 while balChg says 0.25
            self._btc_option("700000042", "2026-09-22 10:00:00", chg="0.25", bal="1.75"),
        )
        err = _stop(_chain, [file])
        assert err.detail["reason"] == "bal_chain_break"
        assert err.detail["ccys"]["BTC"]["breaks"] == 1

    def test_the_floor_is_applied_to_the_summed_set_it_is_given(self):
        file = self._q3_plus(self._btc_option("700000040", "2026-09-20 10:00:00", chg="0.5", bal="0.5"))
        err = _stop(_chain, [file], frozenset({"BTC"}))
        assert err.detail["reason"] == "too_few_pairs" and err.detail["starved"] == ["BTC"]


class TestLongestBilllessRun:
    """F1: counts and dates only, per quarter, so a file whose head or tail is missing shows
    as one long quiet stretch the founder can read next to ``ts_min_day`` / ``ts_max_day``."""

    def test_q3_fixture_longest_run_is_worked_by_hand(self):
        # The Q3 fixture's bills fall on 13 UTC days (worked out with date arithmetic over the
        # file's ts column, not through the parser): 07-01 07-02 07-05 07-09 07-15 07-20 08-03
        # 08-10 08-12 08-20 09-02 09-15 09-30. The quiet stretches are 07-03..07-04 (2),
        # 07-06..07-08 (3), 07-10..07-14 (5), 07-16..07-19 (4), 07-21..08-02 (13), 08-04..08-09 (6),
        # 08-11 (1), 08-13..08-19 (7), 08-21..09-01 (12), 09-03..09-14 (12), 09-16..09-29 (14).
        # The longest is 14 days, 09-16..09-29.
        parsed = parse_archive_csv((FIXTURES / "q3_like.csv").read_bytes(), year=2026, quarter="Q3")
        assert longest_billless_run(parsed) == {"days": 14, "from": "2026-09-16", "to": "2026-09-29"}

    def test_a_file_missing_its_whole_tail_shows_the_tail_as_the_run(self):
        header, rows = _read_fixture("q3_like.csv")
        rows = [r for r in rows if int(r[header.index("ts")]) < 1_784_600_000_000]  # up to 07-20
        parsed = parse_archive_csv(_emit(header, rows), year=2026, quarter="Q3")
        run = longest_billless_run(parsed)
        assert run["to"] == "2026-09-29" and run["days"] >= 60  # D-15: 09-30 is the tail edge
