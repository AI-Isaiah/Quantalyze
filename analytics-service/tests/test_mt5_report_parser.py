"""PARITY-01: the MT5 All-History Report parser is a fail-loud header contract.

Every expectation about the deals comes from ``ledger_synthetic.json`` (written by
hand in plan 01), never from a value read back out of the parser. Broken copies are
built in memory from the UTF-8 fixture with plain string edits, one defect each,
so a test fails for the defect it names and for no other reason.
"""
from __future__ import annotations

import calendar
import json
import re
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Any

import pytest

import services.mt5_parity_report as report_module
from services.mt5_parity_report import (
    BALANCE_CONTINUITY_ABS_TOL,
    REPORT_KNOWN_HEADERS,
    REPORT_REQUIRED_HEADERS,
    BalanceContinuityRefused,
    DuplicateHeader,
    EmptyDeals,
    MissingHeader,
    MoneyCellRefused,
    ParsedReport,
    ReportEncodingRefused,
    ReportRefused,
    ReportTooLarge,
    RowShapeRefused,
    TimeCellRefused,
    TradingRowIncomplete,
    UnknownDealType,
    UnknownDirection,
    UnknownHeader,
    load_oracle_deals,
    oracle_deals_bytes,
    parse_report,
)

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "mt5_parity"
UTF8_BYTES = (FIXTURES / "report_synthetic.utf8.html").read_bytes()
UTF16_BYTES = (FIXTURES / "report_synthetic.utf16le.html").read_bytes()
UTF8_TEXT = UTF8_BYTES.decode("utf-8")
LEDGER = json.loads((FIXTURES / "ledger_synthetic.json").read_text(encoding="utf-8"))

_CELL_RE = re.compile(r"<(t[dh])[^>]*>(.*?)</t[dh]>")
_HEADER_LINE_START = "<tr><th>Time</th>"
_FOOTER_LINE_START = '<tr><td colspan="12"'

Mutator = Callable[[list[str], list[list[str]]], None]


def _mutate(text: str, fn: Mutator) -> str:
    """Rebuild the Deals header and rows after ``fn`` edits their cell texts.

    ``fn`` receives the header cell texts and a list of data rows (each a list of
    cell texts, in header order) and mutates them in place."""
    lines = text.split("\n")
    head = next(i for i, ln in enumerate(lines) if ln.startswith(_HEADER_LINE_START))
    foot = next(i for i, ln in enumerate(lines) if ln.startswith(_FOOTER_LINE_START))
    headers = [m.group(2) for m in _CELL_RE.finditer(lines[head])]
    rows = [[m.group(2) for m in _CELL_RE.finditer(ln)] for ln in lines[head + 1 : foot]]
    fn(headers, rows)
    lines[head] = "<tr>" + "".join(f"<th>{h}</th>" for h in headers) + "</tr>"
    lines[head + 1 : foot] = [
        "<tr>" + "".join(f"<td>{c}</td>" for c in row) + "</tr>" for row in rows
    ]
    return "\n".join(lines)


def _bytes(text: str) -> bytes:
    return text.encode("utf-8")


def _col(headers: list[str], name: str) -> int:
    return headers.index(name)


def _ledger_epoch(wall_time: str) -> int:
    return calendar.timegm(datetime.strptime(wall_time, "%Y.%m.%d %H:%M:%S").timetuple())


def _expected_ledger_deals() -> list[dict[str, Any]]:
    return [
        {
            "deal": d["deal"],
            "time": _ledger_epoch(d["wall_time"]),
            "type": d["type"],
            "entry": d["entry"],
            "profit": d["profit"],
            "swap": d["swap"],
            "commission": d["commission"],
            "fee": d["fee"],
            "balance": d["balance"],
            "position_id": None,
            "time_msc": None,
        }
        for d in LEDGER["deals"]
    ]


# --- the fixtures are renderings of plan 01's ledger -------------------------------


def test_both_fixtures_parse_to_the_ledger_deals_field_for_field() -> None:
    utf8 = parse_report(UTF8_BYTES)
    utf16 = parse_report(UTF16_BYTES)
    expected = _expected_ledger_deals()
    assert [dict(d) for d in utf8.deals] == expected
    assert [dict(d) for d in utf16.deals] == expected
    assert utf8.deals == utf16.deals
    assert utf8.encoding == "utf-8"
    assert utf16.encoding == "utf-16-le"
    assert utf8.fee_column_present is True
    assert utf8.headers == (
        "Time", "Deal", "Symbol", "Type", "Direction", "Volume", "Price",
        "Order", "Commission", "Fee", "Swap", "Profit", "Balance", "Comment",
    )  # fmt: skip
    # The Orders section (deal 2002 is an ORDER id) and the Summary are skipped.
    assert len(utf8.deals) == len(LEDGER["deals"])


def test_the_utf16le_twin_is_the_utf8_text_with_a_bom_byte_for_byte() -> None:
    assert UTF16_BYTES == b"\xff\xfe" + UTF8_TEXT.encode("utf-16-le")
    # The fixture exercises the three thousands-separator spellings.
    assert " " in UTF8_TEXT
    assert "10 000.00" in UTF8_TEXT


# --- encoding ----------------------------------------------------------------------


def test_utf16be_and_utf8_bom_parse_and_a_bomless_non_utf8_body_is_refused() -> None:
    be = b"\xfe\xff" + UTF8_TEXT.encode("utf-16-be")
    assert parse_report(be).deals == parse_report(UTF8_BYTES).deals
    assert parse_report(be).encoding == "utf-16-be"

    with_bom = b"\xef\xbb\xbf" + UTF8_BYTES
    assert parse_report(with_bom).encoding == "utf-8-sig"
    assert parse_report(with_bom).deals == parse_report(UTF8_BYTES).deals

    bomless_le = UTF16_BYTES[2:]
    with pytest.raises(ReportEncodingRefused):
        parse_report(bomless_le)


def test_bomless_ascii_utf16_is_refused_by_its_nul_bytes_never_guessed() -> None:
    # All-ASCII UTF-16 without a BOM is "valid" UTF-8 (NUL is a character), so a
    # NUL guard is the only thing standing between it and a mis-parse.
    ascii_only = UTF8_TEXT.replace(" ", " ")
    with pytest.raises(ReportEncodingRefused):
        parse_report(ascii_only.encode("utf-16-le"))


def test_a_report_over_the_size_cap_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(report_module, "MAX_REPORT_BYTES", 100)
    with pytest.raises(ReportTooLarge):
        parse_report(UTF8_BYTES)


# --- header contract ---------------------------------------------------------------


def test_an_unknown_header_is_refused_by_name() -> None:
    broken = UTF8_TEXT.replace("<th>Profit</th>", "<th>Gewinn</th>")
    with pytest.raises(UnknownHeader, match="Gewinn"):
        parse_report(_bytes(broken))


def test_a_missing_required_header_is_refused_by_name() -> None:
    def drop_balance(headers: list[str], rows: list[list[str]]) -> None:
        idx = _col(headers, "Balance")
        del headers[idx]
        for row in rows:
            del row[idx]

    broken = _mutate(UTF8_TEXT, drop_balance)
    # The Deals marker still says colspan 14; only the header and rows shrank.
    with pytest.raises(MissingHeader, match="Balance"):
        parse_report(_bytes(broken))


def test_a_duplicate_header_is_refused_by_name() -> None:
    def second_swap(headers: list[str], rows: list[list[str]]) -> None:
        headers[_col(headers, "Order")] = "Swap"

    with pytest.raises(DuplicateHeader, match="Swap"):
        parse_report(_bytes(_mutate(UTF8_TEXT, second_swap)))


def test_header_matching_is_case_and_whitespace_insensitive_but_closed() -> None:
    loose = UTF8_TEXT.replace("<th>Profit</th>", "<th>  pROFIT </th>")
    assert parse_report(_bytes(loose)).deals == parse_report(UTF8_BYTES).deals
    assert REPORT_REQUIRED_HEADERS <= REPORT_KNOWN_HEADERS


def test_a_missing_fee_header_reads_zero_and_says_so() -> None:
    def drop_fee(headers: list[str], rows: list[list[str]]) -> None:
        idx = _col(headers, "Fee")
        del headers[idx]
        for row in rows:
            del row[idx]

    parsed = parse_report(_bytes(_mutate(UTF8_TEXT, drop_fee).replace('colspan="14"', 'colspan="13"').replace('colspan="12"', 'colspan="11"')))
    assert parsed.fee_column_present is False
    assert all(d["fee"] == 0.0 for d in parsed.deals)


def test_columns_are_found_by_header_text_not_by_index() -> None:
    def swap(headers: list[str], rows: list[list[str]]) -> None:
        a, b = _col(headers, "Commission"), _col(headers, "Profit")
        headers[a], headers[b] = headers[b], headers[a]
        for row in rows:
            row[a], row[b] = row[b], row[a]

    permuted = parse_report(_bytes(_mutate(UTF8_TEXT, swap)))
    assert permuted.deals == parse_report(UTF8_BYTES).deals
    assert permuted.headers.index("Profit") < permuted.headers.index("Commission")


def test_rows_with_equal_time_keep_file_order() -> None:
    def same_time(headers: list[str], rows: list[list[str]]) -> None:
        t = _col(headers, "Time")
        rows[2][t] = rows[1][t]  # deals 1003 and 1002 now share a Time

    parsed = parse_report(_bytes(_mutate(UTF8_TEXT, same_time)))
    assert parsed.deals[1]["time"] == parsed.deals[2]["time"]
    assert [d["deal"] for d in parsed.deals] == [d["deal"] for d in LEDGER["deals"]]


# --- cells -------------------------------------------------------------------------


def test_relabelling_a_deposit_as_buy_is_a_parser_level_refusal() -> None:
    # RESEARCH Pitfall 3: Symbol and Volume stay empty, so this is not a verdict flip.
    def relabel(headers: list[str], rows: list[list[str]]) -> None:
        rows[3][_col(headers, "Type")] = "buy"  # deal 1004, the deposit

    with pytest.raises(TradingRowIncomplete):
        parse_report(_bytes(_mutate(UTF8_TEXT, relabel)))


def test_a_decimal_comma_is_refused_naming_the_column_and_never_the_value() -> None:
    def comma(headers: list[str], rows: list[list[str]]) -> None:
        rows[2][_col(headers, "Profit")] = "1,5"

    with pytest.raises(MoneyCellRefused) as caught:
        parse_report(_bytes(_mutate(UTF8_TEXT, comma)))
    assert "Profit" in str(caught.value)
    assert "1,5" not in str(caught.value)


@pytest.mark.parametrize("bad", ["1 23.00", "12abc", "--5.00", "1e3", "NaN", ""])
def test_malformed_money_cells_are_refused(bad: str) -> None:
    def put(headers: list[str], rows: list[list[str]]) -> None:
        rows[4][_col(headers, "Balance")] = bad

    with pytest.raises(MoneyCellRefused, match="Balance"):
        parse_report(_bytes(_mutate(UTF8_TEXT, put)))


def test_an_unknown_type_and_an_unknown_direction_are_refused() -> None:
    def bad_type(headers: list[str], rows: list[list[str]]) -> None:
        rows[2][_col(headers, "Type")] = "transfer"

    def bad_direction(headers: list[str], rows: list[list[str]]) -> None:
        rows[2][_col(headers, "Direction")] = "sideways"

    with pytest.raises(UnknownDealType, match="transfer"):
        parse_report(_bytes(_mutate(UTF8_TEXT, bad_type)))
    with pytest.raises(UnknownDirection, match="sideways"):
        parse_report(_bytes(_mutate(UTF8_TEXT, bad_direction)))


def test_the_fail_loud_deal_types_keep_their_codes_so_classify_deal_refuses_them() -> None:
    def interest(headers: list[str], rows: list[list[str]]) -> None:
        rows[9][_col(headers, "Type")] = "Interest"  # deal 1010 (case-folded lookup)

    parsed = parse_report(_bytes(_mutate(UTF8_TEXT, interest)))
    assert parsed.deals[9]["type"] == 12


def test_a_bad_time_cell_is_refused() -> None:
    def put(headers: list[str], rows: list[list[str]]) -> None:
        rows[1][_col(headers, "Time")] = "2026-10-05 10:00:00"

    with pytest.raises(TimeCellRefused, match="Time"):
        parse_report(_bytes(_mutate(UTF8_TEXT, put)))

    def impossible(headers: list[str], rows: list[list[str]]) -> None:
        rows[1][_col(headers, "Time")] = "2026.13.45 10:00:00"

    with pytest.raises(TimeCellRefused):
        parse_report(_bytes(_mutate(UTF8_TEXT, impossible)))


def test_a_row_that_does_not_fit_the_header_is_refused() -> None:
    def short(headers: list[str], rows: list[list[str]]) -> None:
        del rows[5][-1]

    with pytest.raises(RowShapeRefused, match="row 6"):
        parse_report(_bytes(_mutate(UTF8_TEXT, short)))


def test_a_deal_shaped_row_after_a_mid_table_footer_is_refused_not_truncated() -> None:
    # Why: the Deals loop stops at the first footer-shaped row. A subtotal row in the
    # middle of the table would cut the oracle short and the shorter ledger would still
    # be balance-continuous, so the parser must refuse rather than return fewer deals.
    lines = UTF8_TEXT.split("\n")
    foot = next(i for i, ln in enumerate(lines) if ln.startswith(_FOOTER_LINE_START))
    lines.insert(foot - 2, lines[foot])
    with pytest.raises(RowShapeRefused, match="follows a footer-shaped row"):
        parse_report(_bytes("\n".join(lines)))
    # The untouched report, whose footer really is last, still parses to every deal.
    assert len(parse_report(UTF8_BYTES).deals) == len(LEDGER["deals"])


def test_a_repeated_deal_id_is_refused() -> None:
    def repeat(headers: list[str], rows: list[list[str]]) -> None:
        rows[6][_col(headers, "Deal")] = rows[5][_col(headers, "Deal")]

    with pytest.raises(RowShapeRefused, match="repeats"):
        parse_report(_bytes(_mutate(UTF8_TEXT, repeat)))


# --- empty -------------------------------------------------------------------------


def test_a_deals_section_with_only_its_header_row_is_refused() -> None:
    def drop_rows(headers: list[str], rows: list[list[str]]) -> None:
        rows.clear()

    with pytest.raises(EmptyDeals):
        parse_report(_bytes(_mutate(UTF8_TEXT, drop_rows)))


def test_a_report_without_a_deals_section_is_refused() -> None:
    broken = UTF8_TEXT.replace('<tr><th colspan="14">Deals</th></tr>', "")
    with pytest.raises(EmptyDeals, match="no Deals section"):
        parse_report(_bytes(broken))


# --- balance continuity ------------------------------------------------------------


def test_a_broken_balance_continuity_is_refused_naming_the_row() -> None:
    def put(headers: list[str], rows: list[list[str]]) -> None:
        rows[3][_col(headers, "Balance")] = "12 291.00"  # deal 1004, row 4

    with pytest.raises(BalanceContinuityRefused, match="row 4"):
        parse_report(_bytes(_mutate(UTF8_TEXT, put)))


def test_the_first_row_is_never_continuity_checked() -> None:
    # Its implied opening balance is the oracle identity input (plan 06): a first
    # row whose Balance disagrees with its own Profit must still parse.
    def put(headers: list[str], rows: list[list[str]]) -> None:
        rows[0][_col(headers, "Profit")] = "7 000.00"

    parsed = parse_report(_bytes(_mutate(UTF8_TEXT, put)))
    assert parsed.deals[0]["profit"] == 7000.0
    assert parsed.deals[0]["balance"] == 10000.0


def test_continuity_tolerance_is_half_a_cent() -> None:
    assert BALANCE_CONTINUITY_ABS_TOL == 0.005

    def within(headers: list[str], rows: list[list[str]]) -> None:
        # 9 995.00 -> 9 995.004: rounding noise, still continuous (deal 1002), and the
        # next row's own check starts from the edited value, so edit both ends.
        rows[1][_col(headers, "Balance")] = "9 995.004"
        rows[2][_col(headers, "Balance")] = "10 290.004"

    parse_report(_bytes(_mutate(UTF8_TEXT, within)))

    def beyond(headers: list[str], rows: list[list[str]]) -> None:
        rows[1][_col(headers, "Balance")] = "9 995.02"

    with pytest.raises(BalanceContinuityRefused):
        parse_report(_bytes(_mutate(UTF8_TEXT, beyond)))


# --- what is never returned --------------------------------------------------------


def test_the_header_block_symbol_and_comment_are_never_returned() -> None:
    assert "Synthetic Account" in UTF8_TEXT  # the header block exists: no vacuous pass
    parsed: ParsedReport = parse_report(UTF8_BYTES)
    blob = repr(parsed)
    for forbidden in ("Synthetic Account", "synthetic", "SYNUSD", "Synthetic"):
        assert forbidden not in blob
    for deal in parsed.deals:
        assert set(deal) == {
            "deal", "time", "type", "entry", "profit", "swap", "commission",
            "fee", "balance", "position_id", "time_msc",
        }  # fmt: skip


# --- the oracle byte form ----------------------------------------------------------


def test_oracle_deals_bytes_round_trip() -> None:
    parsed = parse_report(UTF8_BYTES)
    raw = oracle_deals_bytes(parsed)
    assert json.loads(raw)["oracle_version"] == 1
    assert load_oracle_deals(raw) == parsed.deals
    # Canonical: the same parse always seals to the same bytes.
    assert oracle_deals_bytes(parse_report(UTF16_BYTES)) == raw


def test_load_oracle_deals_validates_every_field() -> None:
    good = json.loads(oracle_deals_bytes(parse_report(UTF8_BYTES)))

    def with_deal(mutate: Callable[[dict[str, Any]], None]) -> bytes:
        obj = json.loads(json.dumps(good))
        mutate(obj["deals"][2])
        return json.dumps(obj).encode("utf-8")

    bad_payloads = {
        "extra key": with_deal(lambda d: d.update(symbol="X")),
        "type is a bool": with_deal(lambda d: d.update(type=True)),
        "profit is a string": with_deal(lambda d: d.update(profit="1.0")),
        "balance is NaN": b'{"oracle_version":1,"deals":[{"balance":NaN}]}',
        "position id set": with_deal(lambda d: d.update(position_id=7)),
        "wrong version": json.dumps({**good, "oracle_version": 2}).encode("utf-8"),
        "not json": b"not json",
    }
    for what, payload in bad_payloads.items():
        with pytest.raises(ReportRefused):
            load_oracle_deals(payload)
        assert what  # the dict key names the case in a failure report

    empty = json.dumps({"oracle_version": 1, "deals": []}).encode("utf-8")
    with pytest.raises(EmptyDeals):
        load_oracle_deals(empty)
