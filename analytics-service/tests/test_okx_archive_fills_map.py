"""Phase 259 OKXARCHIVEFILLS plan 04: the archive trade-bill mapper, its refusals and the reconcile.

WHY THESE TESTS EXIST (Rule 9). An archive fill must equal, by value, the `fills-history` fill of
the same trade, or the backfill publishes a different trade history than the live read does. Every
refusal below exists because writing a shape that no real file has proven into PROD `trades` would
need a scoped repair, and every reconcile arm exists because a mismatch hidden by string or float
comparison would let the same wrong rows through. The expected rows are the hand-typed literals of
`_okx_archive_fills_fixtures` (never produced by the code under test), and every "equal" reconcile
arm feeds PostgREST-shaped stored rows (floats, padded quantity text, millisecond timestamps), so it
fails under a string comparison.
"""
from __future__ import annotations

import csv
import io
import json
from typing import Any

import pytest

from services import exchange as exchange_mod
from services import okx_archive_job
from services.exchange import _normalize_okx_fill
from services.okx_archive_classify import NONDIGIT_SHAPE_RE
from services.okx_archive_files import ARCHIVE_HEADER, ArchiveFile, parse_archive_csv
from services.okx_archive_fills_map import (
    ARCHIVE_SOURCE,
    ARCHIVE_TS_COLUMN,
    MAP_STOP_CLASSES,
    FillsMapError,
    MappedFill,
    archive_census,
    legacy_subset,
    map_trade_bills,
    parse_stored_fill,
    reconcile_window,
)
from tests._okx_archive_fills_fixtures import (
    EXPECTED_ROWS,
    FILLS_Q2_PATH,
    FILLS_Q3_PATH,
    TRADE_IDS_RECONCILE_WINDOW,
    TRADE_IDS_WRITE_WINDOW,
    stored_row,
)

STRATEGY = "00000000-0000-0000-0000-000000000001"
# 2026-07-15T08:00:00Z, inside the 2026 Q3 file range (cut 2026-06-30T16:00Z .. 2026-09-30T16:00Z).
_TS_BASE = 1784102400000


@pytest.fixture(autouse=True)
def _trim_raw_data(monkeypatch: pytest.MonkeyPatch) -> None:
    """Pin the production default (raw_data trimmed) whatever the environment says."""
    monkeypatch.setattr(exchange_mod, "_STORE_FULL_RAW_DATA", False)


def _fixture_files() -> tuple[ArchiveFile, ArchiveFile]:
    q2 = parse_archive_csv(FILLS_Q2_PATH.read_bytes(), year=2026, quarter="Q2")
    q3 = parse_archive_csv(FILLS_Q3_PATH.read_bytes(), year=2026, quarter="Q3")
    return q2, q3


def _bill(bill_id: str, **over: str) -> dict[str, str]:
    """One archive row (a trade bill by default) keyed by the real 28-column header."""
    cells = dict.fromkeys(ARCHIVE_HEADER, "")
    cells.update(
        instType="SWAP",
        billId=bill_id,
        subType="1",
        ts=str(_TS_BASE + 123),
        balChg="0",
        bal="5000",
        sz="3",
        px="3000.5",
        ccy="USDT",
        pnl="0",
        fee="-0.45",
        mgnMode="cross",
        instId="ETH-USDT-SWAP",
        ordId="770000101",
        execType="T",
        fillTime=str(_TS_BASE + 122),
        tradeId="880000101",
    )
    cells.update(over)
    return cells


def _parse(*bills: dict[str, str]) -> ArchiveFile:
    out = io.StringIO(newline="")
    writer = csv.DictWriter(out, fieldnames=list(ARCHIVE_HEADER), lineterminator="\n")
    writer.writeheader()
    writer.writerows(bills)
    return parse_archive_csv(out.getvalue().encode("utf-8"), year=2026, quarter="Q3")


def _mapped_fixture() -> list[MappedFill]:
    return map_trade_bills(list(_fixture_files()))


def _window(ids: tuple[str, ...]) -> list[MappedFill]:
    return [m for m in _mapped_fixture() if m.trade_id in ids]


def _stored(ids: tuple[str, ...]) -> list[dict[str, Any]]:
    return [stored_row(i, strategy_id=STRATEGY) for i in ids]


# --------------------------------------------------------------------------- Task 1: the tracer
def test_map_one_fixture_bill_equals_expected_row() -> None:
    q3 = _fixture_files()[1]
    first_id = TRADE_IDS_RECONCILE_WINDOW[0]
    mapped = {m.trade_id: m for m in map_trade_bills([q3])}
    fill = mapped[first_id]
    assert fill.row == EXPECTED_ROWS[first_id]
    assert fill.trade_id == first_id
    bill = next(r for r in q3.rows if r.trade_id == first_id)
    assert fill.bill_ts_ms == bill.ts_ms
    assert fill.row_ms == bill.ts_ms


def test_mapped_row_equals_live_helper_row() -> None:
    """The mapper adds nothing of its own: the row is the live helper's row plus `source`."""
    first_id = TRADE_IDS_RECONCILE_WINDOW[0]
    live_shaped = {
        "instType": "SWAP",
        "instId": "ETH-USDT-SWAP",
        "side": "buy",
        "posSide": "net",
        "fillPx": "3150.75",
        "fillSz": "6",
        "fee": "-0.95",
        "feeCcy": "USDT",
        "ts": "1788422400123",
        "fillTime": "1788422400122",
        "ordId": "770000007",
        "tradeId": first_id,
        "execType": "T",
    }
    expected = _normalize_okx_fill(live_shaped, "SWAP", None)
    assert expected is not None
    expected["raw_data"] = {**expected["raw_data"], "source": "okx_bills_history_archive"}
    mapped = {m.trade_id: m for m in _mapped_fixture()}
    assert mapped[first_id].row == expected


# --------------------------------------------------------------------------- Task 2: mapping and refusals
@pytest.mark.parametrize(
    ("sub_type", "side", "pos_side", "direction"),
    [
        pytest.param("1", "buy", "net", None, id="1"),
        pytest.param("2", "sell", "net", None, id="2"),
        pytest.param("3", "buy", "long", "long", id="3"),
        pytest.param("4", "sell", "short", "short", id="4"),
        pytest.param("5", "sell", "long", "long", id="5"),
        pytest.param("6", "buy", "short", "short", id="6"),
    ],
)
def test_map_subtype_sides(sub_type: str, side: str, pos_side: str, direction: str | None) -> None:
    [fill] = map_trade_bills([_parse(_bill("910000101", subType=sub_type))])
    assert fill.row["side"] == side
    assert fill.row["raw_data"]["posSide"] == pos_side
    assert fill.row["raw_data"].get("position_direction") == direction
    assert ("position_direction" in fill.row["raw_data"]) is (direction is not None)
    assert fill.row["quantity"] == "0.3"  # sz 3 contracts of 0.1 ETH
    assert fill.row["raw_data"]["source"] == ARCHIVE_SOURCE


def test_non_trade_bills_are_not_fills() -> None:
    funding = _bill("910000102", subType="173", tradeId="", ordId="", px="", sz="", execType="", fillTime="")
    assert map_trade_bills([_parse(funding)]) == []


def _case(**over: str) -> dict[str, str]:
    cells = {"tradeId": "123456789012", "px": "3333.4444", "sz": "7777.5555", "fee": "-0.8888", **over}
    return _bill("910000103", **cells)


# One bill per refusal. Ids are the arm ids plan 08's neuters name. The sentinel cells
# (tradeId 123456789012, px 3333.4444, sz 7777.5555, fee -0.8888) must never reach a detail.
_UNPROVEN: dict[str, dict[str, str]] = {
    "SPOT": {"instType": "SPOT", "instId": "ETH-USDT"},
    "MARGIN": {"instType": "MARGIN", "instId": "ETH-USDT"},
    "FUTURES": {"instType": "FUTURES", "instId": "ETH-USDT-261225"},
    "OPTION": {"instType": "OPTION", "instId": "BTC-USD-261225-60000-C"},
    "INVERSE_SWAP": {"instId": "BTC-USD-SWAP", "ccy": "BTC"},
}
_UNREADABLE: dict[str, dict[str, str]] = {
    "blank_trade_id": {"tradeId": ""},
    "nondigit_trade_id": {"tradeId": "88x0y0001"},
    "blank_px": {"px": ""},
    "blank_sz": {"sz": ""},
    "exponent_px": {"px": "1e3"},
    "zero_sz": {"sz": "0"},
}


@pytest.mark.parametrize("name", list(_UNPROVEN), ids=list(_UNPROVEN))
def test_refuse_unproven_inst_type(name: str) -> None:
    with pytest.raises(FillsMapError) as raised:
        map_trade_bills([_parse(_case(**_UNPROVEN[name]))])
    assert raised.value.stop_class == "unproven_inst_type"
    assert raised.value.detail["count"] == 1


def test_refuse_unmapped_trade_subtype() -> None:
    with pytest.raises(FillsMapError) as raised:
        map_trade_bills([_parse(_case(subType="104"))])
    assert raised.value.stop_class == "unmapped_trade_subtype"
    assert raised.value.detail["count"] == 1


@pytest.mark.parametrize("name", list(_UNREADABLE), ids=list(_UNREADABLE))
def test_refuse_unreadable_trade_bill(name: str) -> None:
    with pytest.raises(FillsMapError) as raised:
        map_trade_bills([_parse(_case(**_UNREADABLE[name]))])
    assert raised.value.stop_class == "unreadable_trade_bill"
    shape = raised.value.detail["shape"]
    if name == "nondigit_trade_id":
        assert isinstance(shape, str) and NONDIGIT_SHAPE_RE.fullmatch(shape)
        assert "88x0y0001" not in shape
    else:
        assert shape is None


def test_refuse_unknown_contract_size() -> None:
    with pytest.raises(FillsMapError) as raised:
        map_trade_bills([_parse(_case(instId="PEPE-USDT-SWAP"))])
    assert raised.value.stop_class == "unknown_contract_size"


def test_refuse_duplicate_trade_id() -> None:
    first = _case()
    second = {**_case(), "billId": "910000104"}
    with pytest.raises(FillsMapError) as raised:
        map_trade_bills([_parse(first, second)])
    assert raised.value.stop_class == "duplicate_trade_id"
    assert raised.value.detail["count"] == 1


def test_refusal_precedence_and_counts() -> None:
    spot = _bill("910000105", instType="SPOT", instId="ETH-USDT", tradeId="880000201")
    odd_a = _bill("910000106", subType="104", tradeId="880000202")
    odd_b = _bill("910000107", subType="104", tradeId="880000203")
    file = _parse(spot, odd_a, odd_b)
    with pytest.raises(FillsMapError) as raised:
        map_trade_bills([file])
    assert raised.value.stop_class == "unproven_inst_type"
    assert raised.value.detail["count"] == 1
    assert raised.value.detail["classes"] == {"unproven_inst_type": 1, "unmapped_trade_subtype": 2}
    census = archive_census([file])
    assert census["trade_bills"] == 3


def test_census_never_raises() -> None:
    spot = _bill("910000105", instType="SPOT", instId="ETH-USDT", tradeId="880000201")
    odd = _bill("910000106", subType="104", tradeId="880000202", px="", fillTime="")
    funding = _bill("910000108", subType="173", tradeId="", ordId="", px="", sz="", execType="", fillTime="")
    file = _parse(spot, odd, funding)
    census = archive_census([file])
    assert census["bills"] == 3
    assert census["by_inst_type"] == {"SPOT": 1, "SWAP": 2}
    assert census["by_sub_type"] == {"1": 1, "104": 1, "173": 1}
    assert census["trade_bills"] == 2
    assert census["trade_bills_by_inst_type"] == {"SPOT": 1, "SWAP": 1}
    assert census["readable"] == {"trade_id": 2, "px": 1, "sz": 2, "fill_time": 1, "ord_id": 2, "exec_type": 2}
    assert census["trade_id_shapes"] == {}


def test_census_merges_shapes_past_ten() -> None:
    bills = [_bill(f"9100002{k:02d}", tradeId="a" * k + "1") for k in range(1, 13)]
    shapes = archive_census([_parse(*bills)])["trade_id_shapes"]
    assert len(shapes) == 11
    assert shapes["(more)"] == 2
    assert all(NONDIGIT_SHAPE_RE.fullmatch(s) for s in shapes if s != "(more)")


def test_archive_source_literal_is_shared() -> None:
    assert ARCHIVE_SOURCE == okx_archive_job._ARCHIVE_SOURCE


def test_ts_column_is_the_live_normalisers() -> None:
    assert ARCHIVE_TS_COLUMN == "ts"


def _refusal_inputs() -> list[tuple[str, ArchiveFile]]:
    cases: list[tuple[str, ArchiveFile]] = []
    cases += [(f"unproven:{n}", _parse(_case(**o))) for n, o in _UNPROVEN.items()]
    cases += [(f"unreadable:{n}", _parse(_case(**o))) for n, o in _UNREADABLE.items()]
    cases.append(("subtype", _parse(_case(subType="104"))))
    cases.append(("contract", _parse(_case(instId="PEPE-USDT-SWAP"))))
    cases.append(("duplicate", _parse(_case(), {**_case(), "billId": "910000104"})))
    return cases


def test_exception_detail_is_value_free() -> None:
    sentinels = ("123456789012", "3333.4444", "7777.5555", "0.8888", "88x0y0001")
    seen = 0
    for name, file in _refusal_inputs():
        with pytest.raises(FillsMapError) as raised:
            map_trade_bills([file])
        exc = raised.value
        assert str(exc) == exc.stop_class, name
        assert exc.stop_class in MAP_STOP_CLASSES
        text = json.dumps(exc.detail)
        for sentinel in sentinels:
            assert sentinel not in text, (name, sentinel)
        seen += 1
    assert seen == len(_UNPROVEN) + len(_UNREADABLE) + 3


def test_unknown_stop_class_is_refused() -> None:
    with pytest.raises(AssertionError):
        FillsMapError("not_a_class")


# --------------------------------------------------------------------------- Task 3: reconcile
def test_reconcile_equal_by_value() -> None:
    result = reconcile_window(_window(TRADE_IDS_RECONCILE_WINDOW), _stored(TRADE_IDS_RECONCILE_WINDOW), position=3)
    assert result["state"] == "equal"
    assert result["pairs"] == len(TRADE_IDS_RECONCILE_WINDOW)
    assert result["ts_match"] == result["pairs"]
    assert result["fill_time_match"] == 0  # the fixture's fillTime is ts minus one millisecond
    assert result["position"] == 3
    assert result["ts_column"] == "ts"


def _altered(trade_id: str, **over: Any) -> tuple[list[MappedFill], list[dict[str, Any]]]:
    ids = TRADE_IDS_RECONCILE_WINDOW
    stored = _stored(ids)
    target = next(r for r in stored if r["exchange_fill_id"] == trade_id)
    target.update(over)
    return _window(ids), stored


def _assert_miss(field: str, over: dict[str, Any]) -> None:
    mapped, stored = _altered(TRADE_IDS_RECONCILE_WINDOW[0], **over)
    with pytest.raises(FillsMapError) as raised:
        reconcile_window(mapped, stored, position=0)
    assert raised.value.stop_class == "fills_reconcile_miss"
    assert raised.value.detail["field"] == field
    assert raised.value.detail["misses_by_field"] == {field: 1}


def test_reconcile_miss_quantity() -> None:
    _assert_miss("quantity", {"quantity": "0.70000000"})


def test_reconcile_miss_price() -> None:
    _assert_miss("price", {"price": 3150.76})


def test_reconcile_miss_fee() -> None:
    _assert_miss("fee", {"fee": -0.96})


def test_reconcile_miss_side() -> None:
    _assert_miss("side", {"side": "sell"})


def test_reconcile_miss_symbol() -> None:
    _assert_miss("symbol", {"symbol": "BTCUSDTSWAP"})


def test_reconcile_miss_fee_currency() -> None:
    _assert_miss("fee_currency", {"fee_currency": "USDC"})


def test_reconcile_miss_null_stored_fee() -> None:
    mapped, stored = _altered(TRADE_IDS_RECONCILE_WINDOW[0], fee=None)
    with pytest.raises(FillsMapError) as raised:
        reconcile_window(mapped, stored, position=0)
    assert raised.value.detail["field"] == "fee"


def test_reconcile_miss_timestamp_names_both_columns() -> None:
    # 880000007: ts 2026-09-03T08:00:00.123Z, fillTime one millisecond earlier.
    mapped, stored = _altered(TRADE_IDS_RECONCILE_WINDOW[0], timestamp="2026-09-03T08:00:00.122+00:00")
    with pytest.raises(FillsMapError) as raised:
        reconcile_window(mapped, stored, position=0)
    detail = raised.value.detail
    assert detail["field"] == "timestamp"
    assert detail["pairs"] == 2
    assert detail["ts_match"] == detail["pairs"] - 1
    assert detail["fill_time_match"] == 1


def test_reconcile_absent_in_stored() -> None:
    ids = TRADE_IDS_RECONCILE_WINDOW
    with pytest.raises(FillsMapError) as raised:
        reconcile_window(_window(ids), _stored(ids[:1]), position=0)
    assert raised.value.detail["field"] == "absent_in_stored"
    assert raised.value.detail["archive_count"] == 2
    assert raised.value.detail["stored_count"] == 1


def test_reconcile_absent_in_archive() -> None:
    ids = TRADE_IDS_RECONCILE_WINDOW
    stored = _stored(ids)
    stored.append({**stored_row(ids[0], strategy_id=STRATEGY), "exchange_fill_id": "999999999999"})
    with pytest.raises(FillsMapError) as raised:
        reconcile_window(_window(ids), stored, position=0)
    assert raised.value.detail["field"] == "absent_in_archive"


def test_reconcile_stored_unreadable() -> None:
    mapped, stored = _altered(TRADE_IDS_RECONCILE_WINDOW[0], price="abc")
    with pytest.raises(FillsMapError) as raised:
        reconcile_window(mapped, stored, position=0)
    assert raised.value.detail["field"] == "stored_unreadable"


def test_reconcile_stored_duplicate() -> None:
    ids = TRADE_IDS_RECONCILE_WINDOW
    with pytest.raises(FillsMapError) as raised:
        reconcile_window(_window(ids), _stored(ids) + _stored(ids[:1]), position=0)
    assert raised.value.detail["field"] == "stored_duplicate"


def test_reconcile_count_when_archive_repeats_an_id() -> None:
    ids = TRADE_IDS_RECONCILE_WINDOW
    mapped = _window(ids)
    with pytest.raises(FillsMapError) as raised:
        reconcile_window(mapped + mapped[:1], _stored(ids), position=0)
    assert raised.value.detail["field"] == "count"


def test_reconcile_window_empty() -> None:
    result = reconcile_window([], [], position=1)
    assert result["state"] == "window_empty"
    assert result["pairs"] == 0


def test_reconcile_detail_is_value_free() -> None:
    ids = TRADE_IDS_RECONCILE_WINDOW
    arms: list[tuple[list[MappedFill], list[dict[str, Any]]]] = [
        _altered(ids[0], quantity="0.70000000"),
        _altered(ids[0], price=3150.76),
        _altered(ids[0], timestamp="2026-09-03T08:00:00.122+00:00"),
        (_window(ids), _stored(ids[:1])),
        (_window(ids[:1]), _stored(ids)),
        _altered(ids[0], price="abc"),
    ]
    forbidden = list(ids) + ["3150.75", "3200.25", "0.95", "0.96", "770000007", "770000008"]
    for mapped, stored in arms:
        with pytest.raises(FillsMapError) as raised:
            reconcile_window(mapped, stored, position=0)
        text = json.dumps(raised.value.detail)
        assert str(raised.value) == "fills_reconcile_miss"
        for token in forbidden:
            assert token not in text, token


def test_parse_stored_fill_reads_postgrest_forms() -> None:
    parsed = parse_stored_fill(stored_row("880000007", strategy_id=STRATEGY))
    assert parsed is not None
    assert str(parsed.price) == "3150.75"
    assert str(parsed.quantity) == "0.60000000"
    assert parsed.fee is not None and str(parsed.fee) == "-0.95"
    naive = {**stored_row("880000007", strategy_id=STRATEGY), "timestamp": "2026-09-03T08:00:00.123"}
    reread = parse_stored_fill(naive)
    assert reread is not None and parsed.instant == reread.instant
    assert parse_stored_fill({**naive, "exchange_fill_id": "  "}) is None
    assert parse_stored_fill({**naive, "quantity": "nan"}) is None
    assert parse_stored_fill({**naive, "fee": "abc"}) is None


# --------------------------------------------------------------------------- Task 3: legacy subset
def test_legacy_subset_counts() -> None:
    write = _window(TRADE_IDS_WRITE_WINDOW)
    equal = stored_row("880000002", strategy_id=STRATEGY)
    off_fee = {**stored_row("880000003", strategy_id=STRATEGY), "fee": -0.62}
    ghost = {**stored_row("880000004", strategy_id=STRATEGY), "exchange_fill_id": "999999999999"}
    result = legacy_subset(write, [equal, off_fee, ghost])
    assert result == {
        "stored": 3,
        "matched": 1,
        "unequal": 1,
        "unequal_by_field": {"fee": 1},
        "absent_in_archive": 1,
        "unreadable": 0,
    }


def test_legacy_subset_counts_unreadable_and_never_raises() -> None:
    write = _window(TRADE_IDS_WRITE_WINDOW)
    broken = {**stored_row("880000002", strategy_id=STRATEGY), "price": "abc"}
    result = legacy_subset(write, [broken])
    assert result["unreadable"] == 1 and result["matched"] == 0
