"""Phase 259 OKXARCHIVEFILLS plan 01: a golden of the live OKX fills normaliser.

WHY THIS FILE EXISTS. Phase 259 builds each stored archive fill with the SAME code the live
`fills-history` pager uses, so an archive fill and a `fills-history` fill of one trade are equal on
symbol, side, price, quantity (through the same contract-value conversion), fee, timestamp and
exchange_fill_id. That needs the per-fill body of `_fetch_raw_trades_okx_inst_type` to live in one
helper, and a helper extracted from a loop is only provably behaviour-preserving if the loop's
output was recorded first.

This golden pins what the live code does, through `_fetch_raw_trades_okx_inst_type` with a fake
exchange, with EVERY expected row a hand-typed literal (never produced by the code under test). It
was committed green on unmodified `services/exchange.py`, before the extraction, and must stay
green after it. A change to any expected value here is a behaviour change to stored OKX fills and
needs its own reason.

QUIRKS THE LITERALS RECORD ON PURPOSE (they are what the code does today, not what a reader might
expect, and a "fix" is a stored-data change):

  * Linear SWAP/FUTURES quantity is `Decimal(fillSz) * Decimal(str(ctVal))`, and ctVal is a float,
    so a ctVal of `1.0` stringifies as "1.0" and the stored quantity keeps a trailing zero:
    `fillSz "2"` on `SOL-USDT-SWAP` is stored as "2.0", not "2". `cost` inherits the zeros.
  * `_ingest_ctval` is stamped into raw_data only when ctVal != 1.0 (SOL and the unknown-prefix
    fallback carry none).
  * The stored timestamp is built from `ts`, never `fillTime`. Every input here carries a
    `fillTime` one millisecond earlier than `ts` (as the OKX docs example does), so a normaliser
    that read `fillTime` fails every timestamp literal.
  * A posSide outside {long, short, net} is scrubbed from raw_data and leaves no position_direction.

Instant used by every arm (hand-typed, never computed by the code under test):

    1782907200123  2026-07-01T12:00:00.123Z  `ts`
    1782907200122  2026-07-01T12:00:00.122Z  `fillTime`
"""

from __future__ import annotations

import copy
from typing import Any

import pytest

from services.exchange import _fetch_raw_trades_okx_inst_type, _normalize_okx_fill

TS = "1782907200123"
FILL_TIME = "1782907200122"
STORED_TS = "2026-07-01T12:00:00.123000+00:00"


class FakeOkxExchange:
    """A plain fake, NOT an AsyncMock: an AsyncMock answers every attribute, so
    `exchange.markets.get(...)` would return a coroutine and the contract-size fallback would
    misbehave. `markets = {}` makes an unknown instId prefix fall through to ctVal 1.0, as it does
    when a real exchange has not loaded its markets."""

    id = "okx"

    def __init__(self, pages: dict[str, list[dict[str, Any]]] | None = None) -> None:
        self.markets: dict[str, Any] = {}
        self._pages = pages or {}
        self._served: set[str] = set()

    async def private_get_trade_fills_history(self, params: dict[str, str]) -> dict[str, Any]:
        inst_type = params["instType"]
        if inst_type in self._served:
            return {"data": []}
        self._served.add(inst_type)
        return {"data": copy.deepcopy(self._pages.get(inst_type, []))}


@pytest.fixture(autouse=True)
def _pin_raw_data_trim(monkeypatch: pytest.MonkeyPatch) -> None:
    """The trim reads an env flag at import. Pin it False so the raw_data literals are the same
    whatever the environment says."""
    monkeypatch.setattr("services.exchange._STORE_FULL_RAW_DATA", False)


# Each entry: arm id -> (inst_type, input fill, expected stored row, or None when the fill is dropped).
GOLDEN_CASES: dict[str, tuple[str, dict[str, Any], dict[str, Any] | None]] = {
    "eth_linear_net": (
        "SWAP",
        {
            "instType": "SWAP", "instId": "ETH-USDT-SWAP", "tradeId": "1001", "ordId": "ord-1",
            "billId": "9001", "fillPx": "3000.5", "fillSz": "3", "side": "buy", "posSide": "net",
            "execType": "T", "feeCcy": "USDT", "fee": "-0.45", "ts": TS, "fillTime": FILL_TIME,
        },
        {
            "exchange": "okx", "symbol": "ETHUSDTSWAP", "side": "buy", "price": "3000.5",
            "quantity": "0.3", "fee": "-0.45", "fee_currency": "USDT", "timestamp": STORED_TS,
            "order_type": "fill", "exchange_order_id": "ord-1", "exchange_fill_id": "1001",
            "is_fill": True, "is_maker": False, "cost": "900.15",
            "raw_data": {
                "posSide": "net", "instType": "SWAP", "execType": "T", "feeCcy": "USDT",
                "_ingest_ctval": 0.1,
            },
        },
    ),
    "btc_linear_long": (
        "SWAP",
        {
            "instType": "SWAP", "instId": "BTC-USDT-SWAP", "tradeId": "1002", "ordId": "ord-2",
            "billId": "9002", "fillPx": "65000", "fillSz": "50", "side": "buy", "posSide": "long",
            "execType": "T", "feeCcy": "USDT", "fee": "-1.3", "ts": TS, "fillTime": FILL_TIME,
        },
        {
            "exchange": "okx", "symbol": "BTCUSDTSWAP", "side": "buy", "price": "65000",
            "quantity": "0.50", "fee": "-1.3", "fee_currency": "USDT", "timestamp": STORED_TS,
            "order_type": "fill", "exchange_order_id": "ord-2", "exchange_fill_id": "1002",
            "is_fill": True, "is_maker": False, "cost": "32500.00",
            "raw_data": {
                "posSide": "long", "instType": "SWAP", "execType": "T", "feeCcy": "USDT",
                "_ingest_ctval": 0.01, "position_direction": "long",
            },
        },
    ),
    "sol_ctval_one": (
        "SWAP",
        {
            "instType": "SWAP", "instId": "SOL-USDT-SWAP", "tradeId": "1003", "ordId": "ord-3",
            "billId": "9003", "fillPx": "150.25", "fillSz": "2", "side": "sell", "posSide": "net",
            "execType": "T", "feeCcy": "USDT", "fee": "-0.15", "ts": TS, "fillTime": FILL_TIME,
        },
        {
            "exchange": "okx", "symbol": "SOLUSDTSWAP", "side": "sell", "price": "150.25",
            "quantity": "2.0", "fee": "-0.15", "fee_currency": "USDT", "timestamp": STORED_TS,
            "order_type": "fill", "exchange_order_id": "ord-3", "exchange_fill_id": "1003",
            "is_fill": True, "is_maker": False, "cost": "300.500",
            "raw_data": {
                "posSide": "net", "instType": "SWAP", "execType": "T", "feeCcy": "USDT",
            },
        },
    ),
    "inverse_btc_usd": (
        "SWAP",
        {
            "instType": "SWAP", "instId": "BTC-USD-SWAP", "tradeId": "1004", "ordId": "ord-4",
            "billId": "9004", "fillPx": "65000", "fillSz": "10", "side": "buy", "posSide": "net",
            "execType": "T", "feeCcy": "BTC", "fee": "-0.00001", "ts": TS, "fillTime": FILL_TIME,
        },
        {
            "exchange": "okx", "symbol": "BTCUSDSWAP", "side": "buy", "price": "65000",
            "quantity": "10", "fee": "-0.00001", "fee_currency": "BTC", "timestamp": STORED_TS,
            "order_type": "fill", "exchange_order_id": "ord-4", "exchange_fill_id": "1004",
            "is_fill": True, "is_maker": False, "cost": "650000",
            "raw_data": {
                "posSide": "net", "instType": "SWAP", "execType": "T", "feeCcy": "BTC",
            },
        },
    ),
    "unknown_ctval_pepe": (
        "SWAP",
        {
            "instType": "SWAP", "instId": "PEPE-USDT-SWAP", "tradeId": "1005", "ordId": "ord-5",
            "billId": "9005", "fillPx": "0.5", "fillSz": "1000", "side": "buy", "posSide": "net",
            "execType": "T", "feeCcy": "USDT", "fee": "-0.2", "ts": TS, "fillTime": FILL_TIME,
        },
        {
            "exchange": "okx", "symbol": "PEPEUSDTSWAP", "side": "buy", "price": "0.5",
            "quantity": "1000.0", "fee": "-0.2", "fee_currency": "USDT", "timestamp": STORED_TS,
            "order_type": "fill", "exchange_order_id": "ord-5", "exchange_fill_id": "1005",
            "is_fill": True, "is_maker": False, "cost": "500.00",
            "raw_data": {
                "posSide": "net", "instType": "SWAP", "execType": "T", "feeCcy": "USDT",
            },
        },
    ),
    "maker_short": (
        "SWAP",
        {
            "instType": "SWAP", "instId": "ETH-USDT-SWAP", "tradeId": "1006", "ordId": "ord-6",
            "billId": "9006", "fillPx": "3100", "fillSz": "10", "side": "sell", "posSide": "short",
            "execType": "M", "feeCcy": "USDT", "fee": "0.31", "ts": TS, "fillTime": FILL_TIME,
        },
        {
            "exchange": "okx", "symbol": "ETHUSDTSWAP", "side": "sell", "price": "3100",
            "quantity": "1.0", "fee": "0.31", "fee_currency": "USDT", "timestamp": STORED_TS,
            "order_type": "fill", "exchange_order_id": "ord-6", "exchange_fill_id": "1006",
            "is_fill": True, "is_maker": True, "cost": "3100.0",
            "raw_data": {
                "posSide": "short", "instType": "SWAP", "execType": "M", "feeCcy": "USDT",
                "_ingest_ctval": 0.1, "position_direction": "short",
            },
        },
    ),
    "missing_fee": (
        "SWAP",
        {
            "instType": "SWAP", "instId": "ETH-USDT-SWAP", "tradeId": "1007", "ordId": "ord-7",
            "billId": "9007", "fillPx": "3000", "fillSz": "1", "side": "buy", "posSide": "net",
            "execType": "T", "feeCcy": "USDT", "ts": TS, "fillTime": FILL_TIME,
        },
        {
            "exchange": "okx", "symbol": "ETHUSDTSWAP", "side": "buy", "price": "3000",
            "quantity": "0.1", "fee": "0", "fee_currency": "USDT", "timestamp": STORED_TS,
            "order_type": "fill", "exchange_order_id": "ord-7", "exchange_fill_id": "1007",
            "is_fill": True, "is_maker": False, "cost": "300.0",
            "raw_data": {
                "posSide": "net", "instType": "SWAP", "execType": "T", "feeCcy": "USDT",
                "_ingest_ctval": 0.1,
            },
        },
    ),
    "invalid_posside": (
        "SWAP",
        {
            "instType": "SWAP", "instId": "ETH-USDT-SWAP", "tradeId": "1008", "ordId": "ord-8",
            "billId": "9008", "fillPx": "3000", "fillSz": "2", "side": "buy", "posSide": "both",
            "execType": "T", "feeCcy": "USDT", "fee": "-0.3", "ts": TS, "fillTime": FILL_TIME,
        },
        {
            "exchange": "okx", "symbol": "ETHUSDTSWAP", "side": "buy", "price": "3000",
            "quantity": "0.2", "fee": "-0.3", "fee_currency": "USDT", "timestamp": STORED_TS,
            "order_type": "fill", "exchange_order_id": "ord-8", "exchange_fill_id": "1008",
            "is_fill": True, "is_maker": False, "cost": "600.0",
            "raw_data": {
                "instType": "SWAP", "execType": "T", "feeCcy": "USDT", "_ingest_ctval": 0.1,
            },
        },
    ),
    "spot_passthrough": (
        "SPOT",
        {
            "instType": "SPOT", "instId": "BTC-USDT", "tradeId": "1009", "ordId": "ord-9",
            "billId": "9009", "fillPx": "65000.5", "fillSz": "0.01", "side": "buy",
            "execType": "T", "feeCcy": "BTC", "fee": "-0.00001", "ts": TS, "fillTime": FILL_TIME,
        },
        {
            "exchange": "okx", "symbol": "BTCUSDT", "side": "buy", "price": "65000.5",
            "quantity": "0.01", "fee": "-0.00001", "fee_currency": "BTC", "timestamp": STORED_TS,
            "order_type": "fill", "exchange_order_id": "ord-9", "exchange_fill_id": "1009",
            "is_fill": True, "is_maker": False, "cost": "650.005",
            "raw_data": {"instType": "SPOT", "execType": "T", "feeCcy": "BTC"},
        },
    ),
    "bad_ts": (
        "SWAP",
        {
            "instType": "SWAP", "instId": "ETH-USDT-SWAP", "tradeId": "1010", "ordId": "ord-10",
            "billId": "9010", "fillPx": "3000", "fillSz": "1", "side": "buy", "posSide": "net",
            "execType": "T", "feeCcy": "USDT", "fee": "-0.1", "ts": "abc", "fillTime": FILL_TIME,
        },
        None,
    ),
    "nan_px": (
        "SWAP",
        {
            "instType": "SWAP", "instId": "ETH-USDT-SWAP", "tradeId": "1011", "ordId": "ord-11",
            "billId": "9011", "fillPx": "NaN", "fillSz": "1", "side": "buy", "posSide": "net",
            "execType": "T", "feeCcy": "USDT", "fee": "-0.1", "ts": TS, "fillTime": FILL_TIME,
        },
        None,
    ),
    "zero_sz": (
        "SWAP",
        {
            "instType": "SWAP", "instId": "ETH-USDT-SWAP", "tradeId": "1012", "ordId": "ord-12",
            "billId": "9012", "fillPx": "3000", "fillSz": "0", "side": "buy", "posSide": "net",
            "execType": "T", "feeCcy": "USDT", "fee": "-0.1", "ts": TS, "fillTime": FILL_TIME,
        },
        None,
    ),
}

# The twelve arm ids of the plan's behaviour list; a lost arm fails at import, loudly.
assert list(GOLDEN_CASES) == [
    "eth_linear_net", "btc_linear_long", "sol_ctval_one", "inverse_btc_usd",
    "unknown_ctval_pepe", "maker_short", "missing_fee", "invalid_posside",
    "spot_passthrough", "bad_ts", "nan_px", "zero_sz",
]

EMITTING_ARMS = [k for k, v in GOLDEN_CASES.items() if v[2] is not None]
DROP_ARMS = [k for k, v in GOLDEN_CASES.items() if v[2] is None]


async def _page_through_pager(
    inst_type: str, page: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    fake = FakeOkxExchange({inst_type: page})
    fills, cap_hit = await _fetch_raw_trades_okx_inst_type(fake, None, inst_type)  # type: ignore[arg-type]
    assert cap_hit is False  # one short page ends on the natural break
    return fills


class TestLiveOkxFillsGolden:
    """The live pager's output, recorded on unmodified exchange.py, compared whole with `==`."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize("arm", EMITTING_ARMS)
    async def test_emitting_arm_is_the_literal_row(self, arm: str) -> None:
        inst_type, fill, expected = GOLDEN_CASES[arm]
        out = await _page_through_pager(inst_type, [copy.deepcopy(fill)])
        assert out == [expected]

    @pytest.mark.asyncio
    @pytest.mark.parametrize("arm", DROP_ARMS)
    async def test_dropped_fill_is_absent_and_neighbours_survive(self, arm: str) -> None:
        inst_type, bad_fill, expected = GOLDEN_CASES[arm]
        assert expected is None
        first = GOLDEN_CASES["eth_linear_net"]
        last = GOLDEN_CASES["btc_linear_long"]
        page = [copy.deepcopy(first[1]), copy.deepcopy(bad_fill), copy.deepcopy(last[1])]
        out = await _page_through_pager(inst_type, page)
        assert out == [first[2], last[2]]


class TestNormalizeOkxFillDirect:
    """The extracted helper, called directly on the same inputs. Plan 04's archive mapper calls this
    function, so an archive fill and a `fills-history` fill of one trade are built by one body of
    code: these arms pin that the helper alone reproduces the pager's golden rows (and None for
    every dropped input), without the pager in between."""

    @pytest.mark.parametrize("arm", list(GOLDEN_CASES))
    def test_helper_returns_the_golden_row_or_none(self, arm: str) -> None:
        inst_type, fill, expected = GOLDEN_CASES[arm]
        assert _normalize_okx_fill(copy.deepcopy(fill), inst_type, FakeOkxExchange()) == expected

    def test_helper_stamps_ingest_ctval_on_the_dict_it_was_given(self) -> None:
        # The live loop always mutated the venue dict before `raw_data = dict(fill)` was taken;
        # the stamped ctVal reaching raw_data depends on that order, so pin the mutation itself.
        inst_type, fill, _ = GOLDEN_CASES["eth_linear_net"]
        given = copy.deepcopy(fill)
        assert "_ingest_ctval" not in given
        _normalize_okx_fill(given, inst_type, FakeOkxExchange())
        assert given["_ingest_ctval"] == 0.1

    def test_helper_accepts_no_exchange(self) -> None:
        # `exchange` only feeds the markets fallback for an unknown prefix; None means ctVal 1.0.
        inst_type, fill, expected = GOLDEN_CASES["unknown_ctval_pepe"]
        assert _normalize_okx_fill(copy.deepcopy(fill), inst_type, None) == expected
