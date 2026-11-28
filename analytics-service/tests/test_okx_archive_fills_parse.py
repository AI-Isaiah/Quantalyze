"""The archive parser keeps the trade cells the Phase 259 fills read needs (plan 259-02).

WHY these tests matter (Rule 9): the fills read turns archive trade bills into stored fills,
and it can only do that from cells the parser used to drop (tradeId, ordId, instId, px, sz,
execType, fillTime). If the parser stops keeping one, a fill is written with a blank id or a
wrong price and the dedupe against ``fills-history`` rows silently stops matching. The
daily-returns rebuild depends on the opposite: the parser's existing behaviour must not move,
so the old fixture is re-parsed here and compared with what it gave before. Both directions
are pinned in this module.

Variant inputs are built from in-test CSV text, never by editing a fixture file. All amounts
are invented.
"""
from __future__ import annotations

import csv
import dataclasses
import io
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

import pytest

from services.okx_archive_classify import verify_bal_chain
from services.okx_archive_files import ARCHIVE_HEADER, ArchiveFile, ArchiveParseError, ArchiveRow, parse_archive_csv
from tests._okx_archive_fills_fixtures import (
    ANCHOR_MS,
    EXPECTED_ROWS,
    FILLS_Q2_PATH,
    FILLS_Q3_PATH,
    QUARTER_BALANCES,
    TRADE_IDS_BEFORE_ANCHOR,
    TRADE_IDS_RECONCILE_WINDOW,
    TRADE_IDS_WRITE_WINDOW,
    WRITE_BOUND_MS,
    stored_row,
)

FIXTURES = Path(__file__).parent / "fixtures" / "okx_archive"
FILLS_Q3 = FILLS_Q3_PATH
LEGACY_Q3 = FIXTURES / "q3_like.csv"

_NEW_FIELDS = ("trade_id", "ord_id", "inst_id", "px_raw", "sz_raw", "exec_type", "fill_time_raw")


def _q3_rows() -> dict[str, ArchiveRow]:
    parsed = parse_archive_csv(FILLS_Q3.read_bytes(), year=2026, quarter="Q3")
    assert parsed.rows, "guard-the-guard: the Q3 fills fixture must not parse to zero rows"
    return {row.bill_id: row for row in parsed.rows}


def test_trade_bill_keeps_every_trade_cell() -> None:
    # 2026-07-15T08:00:00.123Z, subType 1: every trade cell is on the row, byte for byte.
    row = _q3_rows()["910000009"]
    assert row.trade_id == "880000005"
    assert row.ord_id == "770000005"
    assert row.inst_id == "ETH-USDT-SWAP"
    assert row.px_raw == "3000.5"
    assert row.sz_raw == "3"
    assert row.exec_type == "T"
    assert row.fill_time_raw == "1784102400122"


def test_funding_bill_trade_cells_are_blank() -> None:
    # A funding bill (subType 173) has no fill: the new fields default to the empty string.
    row = _q3_rows()["910000008"]
    assert row.sub_type == "173"
    for name in _NEW_FIELDS:
        value = getattr(row, name)
        if name == "inst_id":
            assert value == "ETH-USDT-SWAP"  # instId is filled on funding bills too
        else:
            assert value == "", name


def test_committed_fixture_parses_unchanged() -> None:
    # The committed q3_like.csv has blank trade cells on its trade bills. It must parse to the
    # same rows as before the extension: same counts, same money, same ids.
    parsed = parse_archive_csv(LEGACY_Q3.read_bytes(), year=2026, quarter="Q3")
    reader = list(csv.DictReader(io.StringIO(LEGACY_Q3.read_text(encoding="utf-8"), newline="")))
    assert len(reader) == parsed.row_count == len(parsed.rows) == 22
    for cells, row in zip(reader, parsed.rows):
        assert row.bill_id == cells["billId"]
        assert row.pnl == Decimal(cells["pnl"])
        assert row.fee == Decimal(cells["fee"])
        assert row.bal_chg == Decimal(cells["balChg"])
        assert row.bal == Decimal(cells["bal"])
        # Blank cells stay blank; instId is the one cell this fixture fills on every row it has.
        assert row.trade_id == row.ord_id == row.px_raw == row.sz_raw == ""
        assert row.exec_type == row.fill_time_raw == ""
        assert row.inst_id == cells["instId"]


# --------------------------------------------------------------------------- helpers (arms 4-9)
def _q2_file() -> ArchiveFile:
    return parse_archive_csv(FILLS_Q2_PATH.read_bytes(), year=2026, quarter="Q2")


def _q3_file() -> ArchiveFile:
    return parse_archive_csv(FILLS_Q3_PATH.read_bytes(), year=2026, quarter="Q3")


def _csv_bytes(rows: list[dict[str, str]]) -> bytes:
    """A Q3 2026 file from in-test rows: the pinned header, every other cell blank by default."""
    out = io.StringIO(newline="")
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(ARCHIVE_HEADER)
    for cells in rows:
        writer.writerow([cells.get(name, "") for name in ARCHIVE_HEADER])
    return out.getvalue().encode("utf-8")


def _trade_bill(**overrides: str) -> dict[str, str]:
    base = {
        "instType": "SWAP", "billId": "910000999", "subType": "1", "ts": "1784102400123",
        "balChg": "-0.45", "posBalChg": "0", "bal": "100.00", "posBal": "0", "sz": "3", "px": "3000.5",
        "ccy": "USDT", "pnl": "0", "fee": "-0.45", "mgnMode": "cross", "instId": "ETH-USDT-SWAP",
        "ordId": "3001", "execType": "T", "fillTime": "1784102400122", "tradeId": "2001",
    }
    base.update(overrides)
    return base


def _fixture_trade_bills() -> list[tuple[ArchiveRow, ArchiveFile]]:
    """Every subType 1 or 2 bill of both fixtures in ts order, beside the file it came from."""
    bills = [(row, file) for file in (_q2_file(), _q3_file()) for row in file.rows if row.sub_type in ("1", "2")]
    assert bills, "guard-the-guard: the fixtures must carry trade bills"
    return sorted(bills, key=lambda pair: pair[0].ts_ms)


# --------------------------------------------------------------------------- arm 4: the seam
def test_fixtures_chain_across_the_quarter_seam() -> None:
    q2, q3 = _q2_file(), _q3_file()
    reading = verify_bal_chain([q2, q3], {"USDT"})
    assert reading["total_pairs"] >= 4
    # The module's hand-typed seam balances are the files' own: a drift in either breaks here,
    # before a later test relies on QUARTER_BALANCES to tamper with the seam on purpose.
    assert str(q2.rows[-1].bal) == QUARTER_BALANCES["q2_last_bal"]
    assert str(q3.rows[0].bal) == QUARTER_BALANCES["q3_first_bal"]
    assert q3.rows[0].bal == q2.rows[-1].bal + q3.rows[0].bal_chg


# --------------------------------------------------------------------------- arms 5-6: wrap strip
def test_wrapped_trade_id_difference_still_conflicts_in_file() -> None:
    # The in-file dedupe compares the UNSTRIPPED cells, as it did before this extension. Two
    # rows for one bill whose only difference is a wrapped tradeId are therefore two different
    # rows, and the duplicate-conflict stop fires. If the strip moved before the dedupe tuple,
    # they would collapse into one and a corrupted export would pass as a clean one.
    wrapped = _trade_bill(tradeId="'2001")
    plain = _trade_bill(tradeId="2001")
    with pytest.raises(ArchiveParseError) as caught:
        parse_archive_csv(_csv_bytes([wrapped, plain]), year=2026, quarter="Q3")
    assert caught.value.stop_class == "duplicate_bill_conflict"
    # Control: the same wrapped row twice is an exact duplicate and is dropped, so the stop
    # above is caused by the tradeId bytes and not by the file shape.
    twice = parse_archive_csv(_csv_bytes([wrapped, wrapped]), year=2026, quarter="Q3")
    assert twice.duplicate_rows_dropped == 1
    assert twice.rows[0].trade_id == "2001"


def test_wrapped_trade_and_order_ids_are_stripped() -> None:
    # D-17: the export wraps ids in apostrophes or quotes. A wrapped tradeId stored as the
    # exchange_fill_id would never equal the live fill's id, and the dedupe against the
    # fills-history rows would silently stop matching.
    row = _trade_bill(tradeId="'2001'", ordId='"3001"')
    parsed = parse_archive_csv(_csv_bytes([row]), year=2026, quarter="Q3")
    assert parsed.rows[0].trade_id == "2001"
    assert parsed.rows[0].ord_id == "3001"


# --------------------------------------------------------------------------- arm 7: widened equality
def test_same_bill_with_different_trade_cells_conflicts_across_files() -> None:
    # ArchiveRow equality drives the cross-file duplicate check. One bill seen in two adjacent
    # files must be the same row, trade cells included: a bill that disagrees with itself about
    # its fill is not a bill to build a stored fill from.
    q2, q3 = _q2_file(), _q3_file()
    seam_bill = q2.rows[-1]
    same = dataclasses.replace(q3, rows=q3.rows + (seam_bill,))
    verify_bal_chain([q2, same], {"USDT"})  # control: an identical copy is one bill, no stop
    other = dataclasses.replace(seam_bill, trade_id="880000999")
    differing = dataclasses.replace(q3, rows=q3.rows + (other,))
    with pytest.raises(ArchiveParseError) as caught:
        verify_bal_chain([q2, differing], {"USDT"})
    assert caught.value.stop_class == "duplicate_bill_conflict"


# --------------------------------------------------------------------------- arm 8: the oracle
def test_expected_rows_match_the_fixture_cells() -> None:
    # EXPECTED_ROWS is typed by hand; the fixture cells are the source it was typed from.
    # Each row is re-derived here from the parsed raw cells with plain Decimal and datetime
    # arithmetic (never the mapper), so a typo in either place fails.
    bills = _fixture_trade_bills()
    assert {row.trade_id for row, _ in bills} == set(EXPECTED_ROWS)
    for row, _ in bills:
        want = EXPECTED_ROWS[row.trade_id]
        assert len(want) == 15
        quantity = Decimal(row.sz_raw) * Decimal("0.1")
        assert Decimal(want["quantity"]) == quantity
        assert want["price"] == row.px_raw
        assert Decimal(want["fee"]) == row.fee
        assert Decimal(want["cost"]) == Decimal(row.px_raw) * quantity
        assert want["timestamp"] == datetime.fromtimestamp(row.ts_ms / 1000, tz=timezone.utc).isoformat()
        assert want["exchange_fill_id"] == row.trade_id
        assert want["exchange_order_id"] == row.ord_id
        assert want["side"] == {"1": "buy", "2": "sell"}[row.sub_type]
        assert want["is_maker"] is (row.exec_type == "M")
        assert want["raw_data"]["execType"] == row.exec_type
        assert want["raw_data"]["source"] == "okx_bills_history_archive"
        assert row.fill_time_raw == str(row.ts_ms - 1)  # reconcile counts the ts column, not fillTime
        # The PostgREST-shaped twin is the same fill by VALUE and a different text.
        stored = stored_row(row.trade_id, strategy_id="S1")
        assert Decimal(str(stored["price"])) == Decimal(want["price"])
        assert Decimal(stored["quantity"]) == Decimal(want["quantity"])
        assert Decimal(str(stored["fee"])) == Decimal(want["fee"])
        assert datetime.fromisoformat(stored["timestamp"]) == datetime.fromisoformat(want["timestamp"])
        assert stored["quantity"] != want["quantity"]
        assert stored["timestamp"] != want["timestamp"]


# --------------------------------------------------------------------------- arm 9: the windows
def test_window_id_tuples_match_the_fixtures() -> None:
    # The three tuples are what plans 04-07 count against. They are re-derived from the fixtures'
    # own timestamps, so a fixture edit that moves a bill across the anchor or the write bound,
    # or empties a window, fails here and not three plans later.
    bills = _fixture_trade_bills()
    before = tuple(row.trade_id for row, _ in bills if row.ts_ms < ANCHOR_MS)
    write = tuple(row.trade_id for row, _ in bills if ANCHOR_MS <= row.ts_ms < WRITE_BOUND_MS)
    reconcile = tuple(row.trade_id for row, _ in bills if row.ts_ms >= WRITE_BOUND_MS)
    assert before == TRADE_IDS_BEFORE_ANCHOR
    assert write == TRADE_IDS_WRITE_WINDOW
    assert reconcile == TRADE_IDS_RECONCILE_WINDOW
    assert len(TRADE_IDS_BEFORE_ANCHOR) >= 1
    assert len(TRADE_IDS_WRITE_WINDOW) >= 4
    assert len(TRADE_IDS_RECONCILE_WINDOW) >= 2
    # Every reconcile-window bill sits in Q3, the only quarter the reconcile reads.
    q3_ids = {row.trade_id for row in _q3_file().rows}
    assert set(TRADE_IDS_RECONCILE_WINDOW) <= q3_ids
    # Trade ids are unique across both files.
    all_ids = [row.trade_id for row, _ in bills]
    assert len(all_ids) == len(set(all_ids))
