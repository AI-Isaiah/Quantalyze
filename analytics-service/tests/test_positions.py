"""Tests for analytics-service/services/positions.py.

Exercises the position-fetching pipeline per exchange (Binance unified,
OKX hedge mode, Bybit CCXT + raw V5 fallback) and the persist upsert path.

Test matrix:
  1. Binance unified — 3 positions → 3 normalized dicts
  2. OKX hedge mode — 4 entries (2 symbols × long+short) → 4 rows
  3. Bybit CCXT happy — complete data → normalized
  4. Bybit CCXT incomplete → raw V5 fallback
  5. Zero positions — empty list
  6. Upsert idempotent — mock supabase .upsert()
  7. Bybit schema drift — real V5 response shape fixture

All tests mock CCXT exchanges at the instance level — no real exchange
connections, no real API calls.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Fixtures — per-exchange CCXT response shapes
# ---------------------------------------------------------------------------

# Binance unified positions (CCXT normalized schema)
BINANCE_POSITIONS = [
    {
        "symbol": "BTC/USDT:USDT",
        "side": "long",
        "contracts": 0.5,
        "contractSize": 1,
        "notional": 30000.0,
        "entryPrice": 60000.0,
        "markPrice": 61000.0,
        "unrealizedPnl": 500.0,
        "info": {"positionSide": "BOTH"},
    },
    {
        "symbol": "ETH/USDT:USDT",
        "side": "short",
        "contracts": 10.0,
        "contractSize": 1,
        "notional": 30000.0,
        "entryPrice": 3000.0,
        "markPrice": 2950.0,
        "unrealizedPnl": 500.0,
        "info": {"positionSide": "BOTH"},
    },
    {
        "symbol": "SOL/USDT:USDT",
        "side": "long",
        "contracts": 100.0,
        "contractSize": 1,
        "notional": 15000.0,
        "entryPrice": 150.0,
        "markPrice": 155.0,
        "unrealizedPnl": 500.0,
        "info": {"positionSide": "LONG"},
    },
]

# OKX hedge mode — 2 symbols × long+short = 4 entries
OKX_HEDGE_POSITIONS = [
    {
        "symbol": "BTC/USDT:USDT",
        "side": "long",
        "contracts": 1.0,
        "contractSize": 1,
        "notional": 60000.0,
        "entryPrice": 60000.0,
        "markPrice": 61000.0,
        "unrealizedPnl": 1000.0,
        "info": {"posSide": "long"},
    },
    {
        "symbol": "BTC/USDT:USDT",
        "side": "short",
        "contracts": 0.5,
        "contractSize": 1,
        "notional": 30000.0,
        "entryPrice": 62000.0,
        "markPrice": 61000.0,
        "unrealizedPnl": 500.0,
        "info": {"posSide": "short"},
    },
    {
        "symbol": "ETH/USDT:USDT",
        "side": "long",
        "contracts": 5.0,
        "contractSize": 1,
        "notional": 15000.0,
        "entryPrice": 3000.0,
        "markPrice": 3100.0,
        "unrealizedPnl": 500.0,
        "info": {"posSide": "long"},
    },
    {
        "symbol": "ETH/USDT:USDT",
        "side": "short",
        "contracts": 3.0,
        "contractSize": 1,
        "notional": 9000.0,
        "entryPrice": 3200.0,
        "markPrice": 3100.0,
        "unrealizedPnl": 300.0,
        "info": {"posSide": "short"},
    },
]

# Bybit CCXT happy path — complete unified data
BYBIT_CCXT_COMPLETE = [
    {
        "symbol": "BTC/USDT:USDT",
        "side": "long",
        "contracts": 0.1,
        "contractSize": 1,
        "notional": 6000.0,
        "entryPrice": 60000.0,
        "markPrice": 61000.0,
        "unrealizedPnl": 100.0,
        # ccxt's ``info`` is the raw v5 row, whose ``size`` the Bybit arm now requires.
        "info": {"size": "0.1", "positionValue": "6000"},
    },
]

# Bybit CCXT incomplete — missing markPrice triggers V5 fallback
BYBIT_CCXT_INCOMPLETE = [
    {
        "symbol": "BTC/USDT:USDT",
        "side": "long",
        "contracts": 0.1,
        "contractSize": 1,
        "notional": 6000.0,
        "entryPrice": 60000.0,
        "markPrice": None,  # Missing!
        "unrealizedPnl": None,  # Missing!
        "info": {},
    },
]

# Bybit raw V5 response — schema drift fixture (Grok finding #4)
BYBIT_V5_RAW_RESPONSE = {
    "retCode": 0,
    "retMsg": "OK",
    "result": {
        "category": "linear",
        "list": [
            {
                "symbol": "BTCUSDT",
                "side": "Buy",
                "size": "0.1",
                "positionValue": "6100",
                "avgPrice": "60000",
                "markPrice": "61000",
                "unrealisedPnl": "100",
                "leverage": "10",
                "positionIdx": "0",
                "tradeMode": 0,
                "riskId": 1,
                "takeProfit": "",
                "stopLoss": "",
                "trailingStop": "",
                "curRealisedPnl": "0",
                "createdTime": "1700000000000",
                "updatedTime": "1700000001000",
                "positionStatus": "Normal",
                "adlRankIndicator": 2,
            },
        ],
        "nextPageCursor": "",
    },
    "time": 1700000002000,
}


# ---------------------------------------------------------------------------
# Test: Binance unified
# ---------------------------------------------------------------------------

class TestFetchPositionsBinance:
    """Binance: exchange.fetch_positions() returns CCXT unified schema."""

    async def test_binance_three_positions_normalized(self) -> None:
        from services.positions import fetch_positions

        mock_exchange = AsyncMock()
        mock_exchange.id = "binance"
        mock_exchange.fetch_positions.return_value = BINANCE_POSITIONS

        result = await fetch_positions("binance", mock_exchange)

        assert len(result) == 3
        btc = next(r for r in result if "BTC" in r["symbol"])
        assert btc["side"] == "long"
        assert btc["size_base"] == 0.5
        assert btc["size_usd"] == 30000.0
        assert btc["entry_price"] == 60000.0
        assert btc["mark_price"] == 61000.0
        assert btc["unrealized_pnl"] == 500.0
        assert btc["exchange"] == "binance"


# ---------------------------------------------------------------------------
# Test: OKX hedge mode
# ---------------------------------------------------------------------------

class TestFetchPositionsOKX:
    """OKX hedge mode: dual-side produces 2 rows per symbol (long + short)."""

    async def test_okx_hedge_mode_four_entries(self) -> None:
        from services.positions import fetch_positions

        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        mock_exchange.fetch_positions.return_value = OKX_HEDGE_POSITIONS

        result = await fetch_positions("okx", mock_exchange)

        assert len(result) == 4
        btc_entries = [r for r in result if "BTC" in r["symbol"]]
        assert len(btc_entries) == 2
        sides = {r["side"] for r in btc_entries}
        assert sides == {"long", "short"}


# Phase 231 (VREAD-02): the Bybit read asks for three categories per poll, so a mock
# that answers every call with one list triples the rows. This exchange dispatches on
# the request like the venue does: ccxt's ``fetch_positions(None, params)`` by
# ``settleCoin`` / ``subType``, the raw V5 call by ``category`` / ``settleCoin``.
EMPTY_V5_PAGE = {"retCode": 0, "result": {"list": [], "nextPageCursor": ""}}


def _bybit_label(params: dict, *, raw: bool) -> str:
    if (params.get("category") == "inverse") if raw else (params.get("subType") == "inverse"):
        return "inverse"
    return "linear_usdc" if params.get("settleCoin") == "USDC" else "linear_usdt"


def _bybit_exchange(ccxt_rows: dict | None = None, raw_pages: dict | None = None) -> AsyncMock:
    """An AsyncMock Bybit; ``ccxt_rows`` / ``raw_pages`` map a category label
    (``linear_usdt``, ``linear_usdc``, ``inverse``) to what that category answers.
    Unnamed categories answer empty. Calls are recorded by the mocks."""
    import copy

    ex = AsyncMock()
    ex.id = "bybit"

    async def fetch_positions(symbols=None, params=None):
        return copy.deepcopy((ccxt_rows or {}).get(_bybit_label(params or {}, raw=False), []))

    async def raw_list(params):
        return copy.deepcopy((raw_pages or {}).get(_bybit_label(params, raw=True), EMPTY_V5_PAGE))

    ex.fetch_positions = AsyncMock(side_effect=fetch_positions)
    ex.private_get_v5_position_list = AsyncMock(side_effect=raw_list)
    return ex


# ---------------------------------------------------------------------------
# Test: Bybit CCXT happy path
# ---------------------------------------------------------------------------

class TestFetchPositionsBybitHappy:
    """Bybit: CCXT fetch_positions() returns complete data — no fallback."""

    async def test_bybit_ccxt_complete(self) -> None:
        from services.positions import fetch_positions

        # 231 flip: was ``fetch_positions.return_value = BYBIT_CCXT_COMPLETE`` and one
        # row. One list for every call would now return three copies of the row.
        mock_exchange = _bybit_exchange(ccxt_rows={"linear_usdt": BYBIT_CCXT_COMPLETE})

        result = await fetch_positions("bybit", mock_exchange)

        assert len(result) == 1
        pos = result[0]
        assert pos["symbol"] == "BTCUSDT"
        assert pos["side"] == "long"
        assert pos["size_base"] == 0.1
        assert pos["entry_price"] == 60000.0
        assert pos["mark_price"] == 61000.0
        assert pos["unrealized_pnl"] == 100.0
        assert pos["exchange"] == "bybit"
        # One ccxt request per category, in order.
        assert [c.args[1] for c in mock_exchange.fetch_positions.await_args_list] == [
            {"settleCoin": "USDT"},
            {"settleCoin": "USDC"},
            {"subType": "inverse"},
        ]
        # The two empty categories are re-read on the raw path (a flat account costs
        # three ccxt plus three raw calls); the complete USDT category is not.
        assert [
            (c.args[0]["category"], c.args[0].get("settleCoin"))
            for c in mock_exchange.private_get_v5_position_list.await_args_list
        ] == [("linear", "USDC"), ("inverse", None)]


# ---------------------------------------------------------------------------
# Test: Bybit CCXT incomplete → raw V5 fallback
# ---------------------------------------------------------------------------

class TestFetchPositionsBybitFallback:
    """Bybit: CCXT missing markPrice → falls back to raw V5 API."""

    async def test_bybit_fallback_to_v5(self) -> None:
        from services.positions import fetch_positions

        # 231 flip: was one ``fetch_positions.return_value`` and one raw page for
        # every call. The incomplete USDT category takes the raw page; the empty USDC
        # and inverse categories answer an empty raw page.
        mock_exchange = _bybit_exchange(
            ccxt_rows={"linear_usdt": BYBIT_CCXT_INCOMPLETE},
            raw_pages={"linear_usdt": BYBIT_V5_RAW_RESPONSE},
        )

        result = await fetch_positions("bybit", mock_exchange)

        assert len(result) == 1
        pos = result[0]
        assert pos["symbol"] == "BTCUSDT"
        assert pos["side"] == "long"
        assert pos["size_base"] == 0.1
        assert pos["mark_price"] == 61000.0
        assert pos["unrealized_pnl"] == 100.0
        assert pos["entry_price"] == 60000.0
        # Verify the fallback was actually invoked, once per category (was
        # ``assert_awaited_once``: the fan-out is three reads, one per category).
        assert [
            (c.args[0]["category"], c.args[0].get("settleCoin"))
            for c in mock_exchange.private_get_v5_position_list.await_args_list
        ] == [("linear", "USDT"), ("linear", "USDC"), ("inverse", None)]
        # Without ``limit`` Bybit answers its default page of 20: every raw request
        # carries it now.
        assert all(
            c.args[0]["limit"] == "200"
            for c in mock_exchange.private_get_v5_position_list.await_args_list
        )


# ---------------------------------------------------------------------------
# Test: Zero positions
# ---------------------------------------------------------------------------

class TestFetchPositionsEmpty:
    """Empty list → empty result."""

    async def test_zero_positions(self) -> None:
        from services.positions import fetch_positions

        mock_exchange = AsyncMock()
        mock_exchange.id = "binance"
        mock_exchange.fetch_positions.return_value = []

        result = await fetch_positions("binance", mock_exchange)
        assert result == []


# ---------------------------------------------------------------------------
# Test: Upsert idempotent
# ---------------------------------------------------------------------------

class TestPersistPositionSnapshots:
    """persist_position_snapshots upserts into position_snapshots table."""

    async def test_upsert_called_with_correct_data(self) -> None:
        from services.positions import persist_position_snapshots

        snapshots = [
            {
                "symbol": "BTCUSDT",
                "side": "long",
                "size_base": 0.5,
                "size_usd": 30000.0,
                "entry_price": 60000.0,
                "mark_price": 61000.0,
                "unrealized_pnl": 500.0,
                "exchange": "binance",
            },
        ]

        mock_supabase = MagicMock()
        mock_table = MagicMock()
        mock_upsert = MagicMock()
        mock_upsert.execute.return_value = MagicMock(data=[{"id": "snap-1"}])
        mock_table.upsert.return_value = mock_upsert
        mock_supabase.table.return_value = mock_table

        count = await persist_position_snapshots(
            mock_supabase, snapshots, "strat-1", "2026-04-11"
        )

        mock_supabase.table.assert_called_with("position_snapshots")
        mock_table.upsert.assert_called_once()
        # Verify the data passed to upsert contains the strategy_id and snapshot_date
        upsert_data = mock_table.upsert.call_args[0][0]
        assert len(upsert_data) == 1
        row = upsert_data[0]
        assert row["strategy_id"] == "strat-1"
        assert row["snapshot_date"] == "2026-04-11"
        assert row["symbol"] == "BTCUSDT"
        assert row["side"] == "long"
        assert count == 1

    async def test_upsert_empty_snapshots_returns_zero(self) -> None:
        from services.positions import persist_position_snapshots

        mock_supabase = MagicMock()
        count = await persist_position_snapshots(
            mock_supabase, [], "strat-1", "2026-04-11"
        )
        assert count == 0


# ---------------------------------------------------------------------------
# Test: Bybit schema drift (Grok finding #4)
# ---------------------------------------------------------------------------

class TestBybitSchemaDrift:
    """Fixture with a real Bybit V5 position response shape. Parse it and
    assert expected fields exist. If Bybit changes the shape, this test
    fails in CI — early warning for schema drift."""

    async def test_v5_response_has_expected_fields(self) -> None:
        """Validate that the raw V5 fixture has every field our parser relies on."""
        item = BYBIT_V5_RAW_RESPONSE["result"]["list"][0]
        # Every field our parser reads must exist and be non-empty
        required_fields = ["symbol", "side", "size", "positionValue",
                           "avgPrice", "markPrice", "unrealisedPnl"]
        for field in required_fields:
            assert field in item, f"Missing field: {field}"
            assert item[field] not in (None, ""), f"Empty field: {field}"

    async def test_v5_parsed_values_correct(self) -> None:
        """Parse the V5 fixture through our normalizer and verify output."""
        from services.positions import _parse_bybit_v5_positions

        result = _parse_bybit_v5_positions(BYBIT_V5_RAW_RESPONSE)
        assert len(result) == 1
        pos = result[0]
        assert pos["symbol"] == "BTCUSDT"
        assert pos["side"] == "long"  # "Buy" → "long"
        assert pos["size_base"] == 0.1
        assert pos["mark_price"] == 61000.0
        assert pos["entry_price"] == 60000.0
        assert pos["unrealized_pnl"] == 100.0


# ---------------------------------------------------------------------------
# Test: Deribit derivative positions (Phase 71 / DRB-09)
# ---------------------------------------------------------------------------
#
# Deribit unified CCXT positions INVERT the linear assumption in
# _normalize_ccxt_position. From the Deribit /private/get_position docs +
# CCXT 4.5.x parse_position, the raw ``info`` fields are authoritative:
#   size            = position size in QUOTE ccy (USD/USDC) for futures/perps,
#                     in BASE ccy for options
#   size_currency   = position size in BASE ccy (BTC/ETH) — futures only
#   floating_profit_loss = unrealized PnL in the SETTLE ccy (BTC/ETH for
#                     inverse, USDC for linear)
#   average_price / mark_price / index_price = USD
# The Deribit branch reads ``info`` directly and maps to our schema, converting
# inverse (coin-settled) PnL to USD at index_price. Reverting the branch (so
# Deribit falls through the linear path) swaps size_base/size_usd and leaves
# inverse PnL ~1e5× wrong — every assertion below reddens.

def _deribit_ccxt_position(info: dict, ccxt_symbol: str) -> dict:
    """A CCXT-unified Deribit position dict. The Deribit branch reads ``info``,
    so the top-level unified fields are intentionally the (wrong-for-Deribit)
    values CCXT would emit — proving the branch does NOT trust them."""
    return {
        "symbol": ccxt_symbol,
        # CCXT maps contracts=size (USD), notional=abs(size_currency) (coin),
        # unrealizedPnl=floating_profit_loss (coin) — all wrong if trusted.
        "contracts": info.get("size"),
        "contractSize": None,
        "notional": abs(info.get("size_currency") or info.get("size") or 0),
        "entryPrice": info.get("average_price"),
        "markPrice": info.get("mark_price"),
        "unrealizedPnl": info.get("floating_profit_loss"),
        "side": "long" if info.get("direction") == "buy" else "short",
        "info": info,
    }


class TestFetchPositionsDeribit:
    """Phase 71: Deribit derivative positions normalize correctly, with inverse
    (coin-settled) contracts converted coin→USD at index price."""

    async def test_inverse_perp_short_normalized(self) -> None:
        from services.positions import fetch_positions

        info = {
            "instrument_name": "BTC-PERPETUAL",
            "kind": "future",
            "direction": "sell",
            "size": -10000,            # USD notional (signed short)
            "size_currency": -0.2,     # BTC
            "floating_profit_loss": 0.05,  # BTC (settle ccy — inverse)
            "average_price": 48000.0,
            "mark_price": 49900.0,
            "index_price": 50000.0,
        }
        mock_exchange = AsyncMock()
        mock_exchange.id = "deribit"
        mock_exchange.fetch_positions.return_value = [
            _deribit_ccxt_position(info, "BTC/USD:BTC")
        ]

        result = await fetch_positions("deribit", mock_exchange)
        assert len(result) == 1
        p = result[0]
        assert p["symbol"] == "BTC-PERPETUAL"
        assert p["side"] == "short"
        assert p["size_base"] == 0.2           # BTC coin qty (size_currency)
        assert p["size_usd"] == 10000.0        # USD notional (size)
        assert p["entry_price"] == 48000.0
        assert p["mark_price"] == 49900.0
        # inverse PnL: 0.05 BTC × 50000 USD/BTC = 2500 USD
        assert p["unrealized_pnl"] == 2500.0
        assert p["exchange"] == "deribit"

    async def test_linear_usdc_perp_pnl_passthrough(self) -> None:
        # NOTE (P71 review, MEDIUM): the linear `size`=quote-ccy /
        # `size_currency`=base-ccy denomination is per the Deribit
        # /private/get_position docs ("size in quote currency for futures";
        # "size_currency ... in base currency"), the SAME rule verified for the
        # inverse path. Deribit has historically changed USDC-instrument field
        # denomination, so P72 onboarding (the LTP accounts are USDC/USDT) is the
        # live acceptance gate that confirms this against real positions; the
        # inverse path (the milestone's money-carrying case) is separately
        # verified against a CCXT live capture. PnL passthrough is correct
        # regardless of the size denomination.
        from services.positions import fetch_positions

        info = {
            "instrument_name": "BTC_USDC-PERPETUAL",
            "kind": "future",
            "direction": "buy",
            "size": 30000,             # USDC notional (quote ccy)
            "size_currency": 0.6,      # BTC (base ccy)
            "floating_profit_loss": 120.0,  # USDC (settle ccy — linear ≈ USD)
            "average_price": 49800.0,
            "mark_price": 50000.0,
            "index_price": 50000.0,
        }
        mock_exchange = AsyncMock()
        mock_exchange.id = "deribit"
        mock_exchange.fetch_positions.return_value = [
            _deribit_ccxt_position(info, "BTC/USDC:USDC")
        ]

        result = await fetch_positions("deribit", mock_exchange)
        p = result[0]
        assert p["symbol"] == "BTC_USDC-PERPETUAL"
        assert p["side"] == "long"
        assert p["size_base"] == 0.6
        assert p["size_usd"] == 30000.0
        # linear: PnL passes through in USDC (NOT ×index)
        assert p["unrealized_pnl"] == 120.0

    async def test_option_coin_size_and_pnl(self) -> None:
        from services.positions import fetch_positions

        info = {
            "instrument_name": "BTC-27DEC24-100000-C",
            "kind": "option",
            "direction": "buy",
            "size": 5,                 # option contracts = BASE ccy (BTC)
            # size_currency absent for options
            "floating_profit_loss": 0.01,  # BTC
            "average_price": 0.02,     # option premium in BTC
            "mark_price": 0.03,
            "index_price": 50000.0,
        }
        mock_exchange = AsyncMock()
        mock_exchange.id = "deribit"
        mock_exchange.fetch_positions.return_value = [
            _deribit_ccxt_position(info, "BTC/USD:BTC-27DEC24-100000-C")
        ]

        result = await fetch_positions("deribit", mock_exchange)
        p = result[0]
        assert p["symbol"] == "BTC-27DEC24-100000-C"
        assert p["side"] == "long"
        assert p["size_base"] == 5.0            # contracts (base ccy)
        # USD market VALUE = contracts × premium(coin) × index — NOT the
        # underlying notional (contracts × index), which overstated ~50× (WR-01).
        assert p["size_usd"] == 5 * 0.03 * 50000.0   # 7500, not 250000
        # prices converted coin→USD at index (premium per contract, in USD)
        assert p["entry_price"] == 0.02 * 50000.0    # 1000
        assert p["mark_price"] == 0.03 * 50000.0     # 1500
        # option PnL in coin → USD at index
        assert p["unrealized_pnl"] == 0.01 * 50000.0

    async def test_zero_direction_filtered(self) -> None:
        from services.positions import fetch_positions

        info = {
            "instrument_name": "ETH-PERPETUAL",
            "kind": "future",
            "direction": "zero",
            "size": 0,
            "size_currency": 0,
            "floating_profit_loss": 0.0,
            "average_price": 0.0,
            "mark_price": 3000.0,
            "index_price": 3000.0,
        }
        mock_exchange = AsyncMock()
        mock_exchange.id = "deribit"
        mock_exchange.fetch_positions.return_value = [
            _deribit_ccxt_position(info, "ETH/USD:ETH")
        ]

        result = await fetch_positions("deribit", mock_exchange)
        assert result == []

    async def test_inverse_index_and_mark_zero_fails_loud(self) -> None:
        """Coin→USD conversion needs a positive rate. If both index_price and
        mark_price are unusable, we FAIL LOUD rather than invent a $0 PnL."""
        from services.positions import _normalize_ccxt_position

        info = {
            "instrument_name": "BTC-PERPETUAL",
            "kind": "future",
            "direction": "sell",
            "size": -10000,
            "size_currency": -0.2,
            "floating_profit_loss": 0.05,
            "average_price": 48000.0,
            "mark_price": 0.0,
            "index_price": 0.0,
        }
        pos = _deribit_ccxt_position(info, "BTC/USD:BTC")
        with pytest.raises(ValueError, match="index"):
            _normalize_ccxt_position(pos, "deribit")

    async def test_unknown_coin_settled_currency_fails_loud(self) -> None:
        """Coin-settled classification is single-sourced in deribit_txn and
        FAILS LOUD on an unknown coin-margined currency (not BTC/ETH) — we
        refuse to blind-multiply an unknown coin by a USD index. (SOL on Deribit
        is USDC-linear; a bare 'SOL-...' coin-margined instrument is unknown.)"""
        from services.positions import _normalize_ccxt_position

        info = {
            "instrument_name": "SOL-PERPETUAL",  # no _USDC marker → coin-settled
            "kind": "future",
            "direction": "buy",
            "size": 1000,
            "size_currency": 10.0,
            "floating_profit_loss": 1.0,
            "average_price": 100.0,
            "mark_price": 100.0,
            "index_price": 100.0,
        }
        pos = _deribit_ccxt_position(info, "SOL/USD:SOL")
        with pytest.raises(ValueError, match="coin-margined|coin-settled"):
            _normalize_ccxt_position(pos, "deribit")

    async def test_one_bad_position_does_not_drop_the_batch(self) -> None:
        """P71 review (red team): a single un-normalizable Deribit position must
        NOT abort the whole batch — the allocator must still see every OTHER
        position. _normalize_ccxt_positions skips the bad one (loud log) and
        keeps the good one. Reverting the per-position guard drops both."""
        from services.positions import fetch_positions

        good = {
            "instrument_name": "BTC-PERPETUAL",
            "kind": "future",
            "direction": "sell",
            "size": -10000,
            "size_currency": -0.2,
            "floating_profit_loss": 0.05,
            "average_price": 48000.0,
            "mark_price": 49900.0,
            "index_price": 50000.0,
        }
        bad = {  # inverse but no usable index/mark → raises inside normalize
            "instrument_name": "ETH-PERPETUAL",
            "kind": "future",
            "direction": "buy",
            "size": 5000,
            "size_currency": 2.0,
            "floating_profit_loss": 0.1,
            "average_price": 2500.0,
            "mark_price": 0.0,
            "index_price": 0.0,
        }
        mock_exchange = AsyncMock()
        mock_exchange.id = "deribit"
        mock_exchange.fetch_positions.return_value = [
            _deribit_ccxt_position(bad, "ETH/USD:ETH"),
            _deribit_ccxt_position(good, "BTC/USD:BTC"),
        ]

        result = await fetch_positions("deribit", mock_exchange)
        assert len(result) == 1
        assert result[0]["symbol"] == "BTC-PERPETUAL"
        assert result[0]["unrealized_pnl"] == 2500.0

    async def test_linear_usdc_option_value_no_index(self) -> None:
        """P71 review (WR-01/IN-02): a linear (USDC) option's premium is already
        USD, so its USD value = contracts × premium with NO index multiply — a
        zero/absent index must NOT silently zero the value."""
        from services.positions import fetch_positions

        info = {
            "instrument_name": "BTC_USDC-27DEC24-100000-C",
            "kind": "option",
            "direction": "buy",
            "size": 3,               # contracts
            "floating_profit_loss": 40.0,  # USDC
            "average_price": 1200.0,  # premium in USDC per contract
            "mark_price": 1500.0,     # USDC
            "index_price": 0.0,       # absent — must not zero the value
        }
        mock_exchange = AsyncMock()
        mock_exchange.id = "deribit"
        mock_exchange.fetch_positions.return_value = [
            _deribit_ccxt_position(info, "BTC/USDC:USDC-27DEC24-100000-C")
        ]

        result = await fetch_positions("deribit", mock_exchange)
        p = result[0]
        assert p["size_base"] == 3.0
        assert p["size_usd"] == 3 * 1500.0     # 4500, premium×contracts (no index)
        assert p["entry_price"] == 1200.0
        assert p["mark_price"] == 1500.0
        assert p["unrealized_pnl"] == 40.0     # USDC passthrough

    async def test_combo_instrument_is_loud_skipped(self) -> None:
        """P71 review (IN-01): multi-leg combos don't follow the single-instrument
        size convention — value-loud-skip them rather than mis-value. The raise
        is contained by the batch normalizer, so a combo doesn't drop the batch."""
        from services.positions import _normalize_ccxt_position, fetch_positions

        info = {
            "instrument_name": "BTC-FS-27DEC24_PERP",
            "kind": "future_combo",
            "direction": "buy",
            "size": 1000,
            "size_currency": 0.02,
            "floating_profit_loss": 0.001,
            "average_price": 50000.0,
            "mark_price": 50100.0,
            "index_price": 50000.0,
        }
        pos = _deribit_ccxt_position(info, "BTC/USD:BTC-FS")
        with pytest.raises(ValueError, match="combo"):
            _normalize_ccxt_position(pos, "deribit")

        # Contained by the batch normalizer: combo skipped, real perp kept.
        good = {
            "instrument_name": "BTC-PERPETUAL", "kind": "future", "direction": "sell",
            "size": -10000, "size_currency": -0.2, "floating_profit_loss": 0.05,
            "average_price": 48000.0, "mark_price": 49900.0, "index_price": 50000.0,
        }
        mock_exchange = AsyncMock()
        mock_exchange.id = "deribit"
        mock_exchange.fetch_positions.return_value = [
            _deribit_ccxt_position(info, "BTC/USD:BTC-FS"),
            _deribit_ccxt_position(good, "BTC/USD:BTC"),
        ]
        result = await fetch_positions("deribit", mock_exchange)
        assert [r["symbol"] for r in result] == ["BTC-PERPETUAL"]

    async def test_non_deribit_malformed_still_fails_loud(self) -> None:
        """P71 review (WR-03): the per-position skip is Deribit-only. A malformed
        NON-Deribit position must NOT be silently dropped — other venues keep
        their fail-loud semantics. We prove the skip path doesn't wrap them by
        monkeypatching the single-position normalizer to raise for a bybit row
        and asserting _normalize_ccxt_positions propagates instead of swallowing."""
        import services.positions as positions_mod

        def _boom(pos, exchange_name, **_kwargs):
            # 231: the batch normalizer forwards ``bybit_category`` by keyword.
            raise ValueError("malformed okx position")

        original = positions_mod._normalize_ccxt_position
        positions_mod._normalize_ccxt_position = _boom  # type: ignore[assignment]
        try:
            with pytest.raises(ValueError, match="malformed"):
                positions_mod._normalize_ccxt_positions([{"info": {}}], "okx")
            # Deribit, by contrast, swallows + skips (returns []).
            assert positions_mod._normalize_ccxt_positions([{"info": {}}], "deribit") == []
        finally:
            positions_mod._normalize_ccxt_position = original  # type: ignore[assignment]


# ---------------------------------------------------------------------------
# Test: unrealized P&L is NULL when the venue reports none (167.1.1.2 D-05)
# ---------------------------------------------------------------------------
#
# A derivative writer that coerces "the venue said nothing" to 0.0 fabricates a
# real zero that no reader can tell from a reported one. Every site below must
# return None for absent / null / blank and keep a REPORTED zero as 0.0. All
# inputs and expected values are typed by hand (never derived from the code
# under test).


class TestReportedPnlHelper:
    @pytest.mark.parametrize(
        "raw, expected",
        [
            (None, None),
            ("", None),
            ("   ", None),
            (0, 0.0),
            (0.0, 0.0),
            ("0", 0.0),
            ("-12.5", -12.5),
            (42.5, 42.5),
        ],
    )
    def test_reported_versus_not_reported(self, raw, expected) -> None:
        from services.positions import reported_pnl

        got = reported_pnl(raw)
        assert got == expected
        assert (got is None) == (expected is None)

    def test_non_numeric_string_still_fails_loud(self) -> None:
        from services.positions import reported_pnl

        with pytest.raises(ValueError):
            reported_pnl("abc")


class TestBybitV5ReportedPnl:
    @staticmethod
    def _response(pnl_fields: dict) -> dict:
        item = {
            "symbol": "BTCUSDT",
            "side": "Buy",
            "size": "0.1",
            "positionValue": "6100",
            "avgPrice": "60000",
            "markPrice": "61000",
            **pnl_fields,
        }
        return {"retCode": 0, "result": {"list": [item]}}

    @pytest.mark.parametrize(
        "pnl_fields, expected",
        [
            ({}, None),                          # key absent
            ({"unrealisedPnl": ""}, None),       # blank (was ValueError, aborted the batch)
            ({"unrealisedPnl": "0"}, 0.0),       # reported zero
            ({"unrealisedPnl": "100"}, 100.0),
        ],
        ids=["absent", "empty", "zero", "number"],
    )
    def test_unrealised_pnl(self, pnl_fields, expected) -> None:
        from services.positions import _parse_bybit_v5_positions

        result = _parse_bybit_v5_positions(self._response(pnl_fields))
        assert len(result) == 1
        assert result[0]["unrealized_pnl"] == expected
        assert (result[0]["unrealized_pnl"] is None) == (expected is None)

    async def test_ccxt_none_still_routes_to_v5_and_v5_zero_is_a_real_zero(self) -> None:
        """RESEARCH finding 1: ccxt's Bybit parser nulls an exact-zero P&L, so a
        CCXT None must still take the raw V5 fallback, and the V5 string "0" is
        the only source that can say "reported zero" -> 0.0, not None."""
        from services.positions import fetch_positions

        # 231 flip: the raw page is the USDT category's; the other two answer empty.
        mock_exchange = _bybit_exchange(
            ccxt_rows={"linear_usdt": BYBIT_CCXT_INCOMPLETE},
            raw_pages={"linear_usdt": self._response({"unrealisedPnl": "0"})},
        )

        result = await fetch_positions("bybit", mock_exchange)

        # One raw read per category (was ``assert_awaited_once``), each with ``limit``.
        assert mock_exchange.private_get_v5_position_list.await_count == 3
        assert all(
            c.args[0]["limit"] == "200"
            for c in mock_exchange.private_get_v5_position_list.await_args_list
        )
        assert len(result) == 1
        assert result[0]["unrealized_pnl"] == 0.0
        assert result[0]["unrealized_pnl"] is not None


class TestCcxtUnifiedReportedPnl:
    @pytest.mark.parametrize(
        "pnl_fields, expected",
        [
            ({}, None),                          # key absent
            ({"unrealizedPnl": None}, None),     # null
            ({"unrealizedPnl": 0}, 0.0),         # reported zero
            ({"unrealizedPnl": 42.5}, 42.5),
        ],
        ids=["absent", "null", "zero", "number"],
    )
    def test_binance_okx_shape(self, pnl_fields, expected) -> None:
        from services.positions import _normalize_ccxt_position

        pos = {
            "symbol": "BTC/USDT:USDT",
            "side": "long",
            "contracts": 0.5,
            "contractSize": 1,
            "notional": 30000.0,
            "entryPrice": 60000.0,
            "markPrice": 61000.0,
            **pnl_fields,
        }
        out = _normalize_ccxt_position(pos, "binance")
        assert out is not None
        assert out["unrealized_pnl"] == expected
        assert (out["unrealized_pnl"] is None) == (expected is None)


class TestDeribitReportedPnl:
    @staticmethod
    def _info(instrument: str, pnl_fields: dict) -> dict:
        return {
            "instrument_name": instrument,
            "kind": "future",
            "direction": "sell",
            "size": -10000,
            "size_currency": -0.2,
            "average_price": 48000.0,
            "mark_price": 49900.0,
            "index_price": 50000.0,
            **pnl_fields,
        }

    @pytest.mark.parametrize(
        "pnl_fields, expected",
        [
            ({}, None),
            ({"floating_profit_loss": None}, None),
            ({"floating_profit_loss": ""}, None),
            ({"floating_profit_loss": 0}, 0.0),
            ({"floating_profit_loss": 0.05}, 2500.0),   # 0.05 BTC x 50000
        ],
        ids=["absent", "null", "empty", "zero", "reported-btc"],
    )
    async def test_coin_settled_branch(self, pnl_fields, expected) -> None:
        from services.positions import fetch_positions

        info = self._info("BTC-PERPETUAL", pnl_fields)
        mock_exchange = AsyncMock()
        mock_exchange.id = "deribit"
        mock_exchange.fetch_positions.return_value = [_deribit_ccxt_position(info, "BTC/USD:BTC")]

        result = await fetch_positions("deribit", mock_exchange)
        assert len(result) == 1
        assert result[0]["unrealized_pnl"] == expected
        assert (result[0]["unrealized_pnl"] is None) == (expected is None)

    @pytest.mark.parametrize(
        "pnl_fields, expected",
        [
            ({}, None),
            ({"floating_profit_loss": None}, None),
            ({"floating_profit_loss": ""}, None),
            ({"floating_profit_loss": 0}, 0.0),
            ({"floating_profit_loss": 120.0}, 120.0),
        ],
        ids=["absent", "null", "empty", "zero", "reported-usdc"],
    )
    async def test_linear_branch(self, pnl_fields, expected) -> None:
        from services.positions import fetch_positions

        info = self._info("BTC_USDC-PERPETUAL", pnl_fields)
        mock_exchange = AsyncMock()
        mock_exchange.id = "deribit"
        mock_exchange.fetch_positions.return_value = [
            _deribit_ccxt_position(info, "BTC/USDC:USDC")
        ]

        result = await fetch_positions("deribit", mock_exchange)
        assert len(result) == 1
        assert result[0]["unrealized_pnl"] == expected
        assert (result[0]["unrealized_pnl"] is None) == (expected is None)


# ---------------------------------------------------------------------------
# Test: Bybit reads three position categories (Phase 231 BYBITREADS, VREAD-02)
# ---------------------------------------------------------------------------
#
# Every position below goes through ccxt's REAL ``bybit.fetch_positions`` and
# ``parse_position`` on markets built from the recorded instruments-info replies, and
# a book that answers like Bybit's position list (``tests/_bybit_real_markets.py``).
# No mock returns the same list for every call, which is how three category reads
# would have shipped unseen. Row values are Bybit-documented v5 shapes with the
# arithmetic typed beside every expected number, never produced by the code under test.

from tests._bybit_real_markets import (  # noqa: E402
    install_position_book,
    linear_symbols,
    real_bybit_with_markets,
)


def _v5_row(symbol: str, **fields: str) -> dict:
    """A v5 position-list row (unified account shape). Defaults: Buy 0.05 at 58000,
    mark 60000, uPnL 100 = (60000 - 58000) x 0.05, positionValue 3000 = 0.05 x 60000."""
    row = {
        "symbol": symbol,
        "side": "Buy",
        "size": "0.05",
        "positionValue": "3000",
        "avgPrice": "58000",
        "markPrice": "60000",
        "unrealisedPnl": "100",
        "positionIdx": 0,
        "liqPrice": "",
        "bustPrice": "",
    }
    row.update(fields)
    return row


async def _holdings_exchange(rows: list[dict]):
    """A real ccxt Bybit with offline markets, the book, and a one-coin USDT balance."""
    ex = await real_bybit_with_markets()
    book = install_position_book(ex, rows)
    payload = {
        "retCode": 0,
        "retMsg": "OK",
        "result": {
            "list": [
                {
                    "accountType": "UNIFIED",
                    "coin": [
                        {
                            "coin": "USDT",
                            "walletBalance": "1000",
                            "equity": "1000",
                            "unrealisedPnl": "0",
                            "availableToWithdraw": "",
                            "totalPositionIM": "0",
                            "totalOrderIM": "0",
                            "borrowAmount": "0",
                            "spotBorrow": "0",
                            "accruedInterest": "0",
                        }
                    ],
                }
            ]
        },
    }
    ex.fetch_balance = AsyncMock(return_value=ex.parse_balance(payload))
    return ex, book


class TestBybitPositionCategories:
    """VREAD-02: linear USDT, linear USDC and inverse, with the symbol, unit,
    page-limit and cursor defects fixed in the same change."""

    async def test_tracer_usdc_perp_reaches_holdings_as_btcperp_with_its_upnl(self) -> None:
        from services.allocator_positions import fetch_allocator_holdings

        ex, _book = await _holdings_exchange(
            [_v5_row("BTCUSDT"), _v5_row("BTCPERP")]
        )
        try:
            rows, warning = await fetch_allocator_holdings("bybit", ex)
        finally:
            await ex.close()

        assert warning is None
        deriv = {r["symbol"]: r for r in rows if r["holding_type"] == "derivative"}
        # BTCUSDCC is what the plain symbol strip made of ccxt's BTC/USDC:USDC.
        assert set(deriv) == {"BTCUSDT", "BTCPERP"}, f"derivative rows: {sorted(deriv)}"
        # (60000 - 58000) x 0.05 = 100.0, USDC counted as USD (the stable rule).
        assert deriv["BTCPERP"]["unrealized_pnl_usd"] == 100.0
        assert deriv["BTCPERP"]["value_usd"] == 3000.0
        assert deriv["BTCPERP"]["side"] == "long"

    async def test_every_category_is_requested_once_on_the_ccxt_path(self) -> None:
        from services.positions import fetch_positions

        ex, book = await _holdings_exchange(
            [
                _v5_row("BTCUSDT"),
                _v5_row("BTCPERP"),
                _v5_row("BTCUSD", size="100", positionValue="0.00166667", avgPrice="57495", unrealisedPnl="0.00007"),
            ]
        )
        try:
            await fetch_positions("bybit", ex)
        finally:
            await ex.close()

        # Exactly the three requests, in order, as ccxt 4.5.x sends them (limit 200).
        assert [c["params"] for c in book.calls if c["entry"] == "ccxt"] == [
            {"settleCoin": "USDT", "limit": 200, "category": "linear"},
            {"settleCoin": "USDC", "limit": 200, "category": "linear"},
            {"category": "inverse", "limit": 200},
        ]
        # Every category answered complete rows, so none was re-read on the raw path.
        assert [c for c in book.calls if c["entry"] == "raw"] == []

    # -- Task 2: inverse rows in USD, the raw cursor path, named refusals ------

    # Inverse BTCUSD (coin-margined): ``size`` is USD contracts, ``positionValue`` and
    # ``unrealisedPnl`` are in BTC. positionValue 0.00166667 BTC = 100 / 60000, and at
    # the payload's mark of 60000 USD per BTC:
    #   size_usd       = 0.00166667 x 60000 = 100.0002
    #   unrealized_pnl = 0.00007    x 60000 = 4.2
    INVERSE_ROW_FIELDS = {
        "size": "100",
        "positionValue": "0.00166667",
        "avgPrice": "57495",
        "markPrice": "60000",
        "unrealisedPnl": "0.00007",
    }

    @staticmethod
    def _inverse_row(**overrides: str | None) -> dict:
        row = _v5_row("BTCUSD", **{**TestBybitPositionCategories.INVERSE_ROW_FIELDS})
        for key, value in overrides.items():
            if value is None:
                row.pop(key, None)
            else:
                row[key] = value
        return row

    @staticmethod
    async def _fetch(rows: list[dict]) -> list[dict]:
        from services.positions import fetch_positions

        ex, _book = await _holdings_exchange(rows)
        try:
            return await fetch_positions("bybit", ex)
        finally:
            await ex.close()

    @staticmethod
    def _raw_inverse(row: dict) -> list[dict]:
        from services.positions import _parse_bybit_v5_positions

        return _parse_bybit_v5_positions(
            {"retCode": 0, "result": {"list": [row], "nextPageCursor": ""}}, category="inverse"
        )

    @pytest.mark.parametrize("path", ["ccxt", "raw"])
    async def test_inverse_position_size_and_upnl_are_usd_at_the_payload_mark(self, path: str) -> None:
        rows = (
            await self._fetch([self._inverse_row()])
            if path == "ccxt"
            else self._raw_inverse(self._inverse_row())
        )
        assert len(rows) == 1
        pos = rows[0]
        assert pos["symbol"] == "BTCUSD"
        assert pos["side"] == "long"
        assert pos["size_base"] == pytest.approx(0.00166667)  # BTC, the payload's positionValue
        assert pos["size_usd"] == pytest.approx(100.0002, rel=1e-9)  # 0.00166667 x 60000
        assert pos["unrealized_pnl"] == pytest.approx(4.2, rel=1e-9)  # 0.00007 x 60000
        assert pos["mark_price"] == 60000.0
        assert pos["entry_price"] == 57495.0
        assert pos["exchange"] == "bybit"

    @pytest.mark.parametrize("path", ["ccxt", "raw"])
    async def test_inverse_symbol_is_the_raw_id_without_a_colon(self, path: str) -> None:
        rows = (
            await self._fetch([self._inverse_row()])
            if path == "ccxt"
            else self._raw_inverse(self._inverse_row())
        )
        # ccxt's symbol is BTC/USD:BTC: the plain strip left BTCUSD:BTC, whose colon
        # fails the holdings reference alphabet.
        assert [r["symbol"] for r in rows] == ["BTCUSD"]
        assert ":" not in rows[0]["symbol"]

    @pytest.mark.parametrize(
        "path, mark",
        [
            # Through real ccxt: an absent or blank mark makes ccxt's own markPrice
            # None, so the category takes the raw path and refuses there; "0" and
            # "-1" parse to numbers, so ccxt ships the row and the Bybit arm refuses.
            # ("nan" and "inf" never reach the arm through ccxt: its Precise division
            # raises first, which the arm-level rows below cover.)
            ("ccxt", None),
            ("ccxt", ""),
            ("ccxt", "0"),
            ("ccxt", "-1"),
            ("arm", None),
            ("arm", ""),
            ("arm", "0"),
            ("arm", "-1"),
            ("arm", "nan"),
            ("arm", "inf"),
            ("raw", None),
            ("raw", ""),
            ("raw", "0"),
            ("raw", "-1"),
            ("raw", "nan"),
            ("raw", "inf"),
        ],
    )
    async def test_an_inverse_row_without_a_usable_mark_refuses_by_name(
        self, path: str, mark: str | None
    ) -> None:
        from services.positions import BybitPositionReadRefused, _normalize_ccxt_position

        row = self._inverse_row(markPrice=mark)
        with pytest.raises(BybitPositionReadRefused) as caught:
            if path == "ccxt":
                await self._fetch([row])
            elif path == "raw":
                self._raw_inverse(row)
            else:
                # A ccxt-shaped dict whose own markPrice is fine but whose raw `info`
                # carries the bad mark: the arm reads the payload's mark, not ccxt's.
                _normalize_ccxt_position(
                    {
                        "symbol": "BTC/USD:BTC",
                        "side": "long",
                        "contracts": 100.0,
                        "contractSize": 1.0,
                        "notional": 0.00166667,
                        "entryPrice": 57495.0,
                        "markPrice": 60000.0,
                        "unrealizedPnl": 7e-05,
                        "info": row,
                    },
                    "bybit",
                    bybit_category="inverse",
                )
        # The text can reach logs and stored copy: static, no venue text, no digit.
        assert not any(ch.isdigit() for ch in str(caught.value)), str(caught.value)

    async def test_raw_fallback_reads_a_string_mark_for_an_inverse_row(self) -> None:
        # ``unrealisedPnl`` "0": ccxt nulls an exact zero, so the category is read on
        # the raw path, where markPrice is the STRING "60000". ``usable_price`` rejects
        # a numeric string, so the mark must be converted first or every raw inverse
        # row would refuse.
        rows = await self._fetch([self._inverse_row(unrealisedPnl="0")])
        assert len(rows) == 1
        assert rows[0]["size_usd"] == pytest.approx(100.0002, rel=1e-9)
        assert rows[0]["unrealized_pnl"] == 0.0  # a reported zero, not None
        assert rows[0]["mark_price"] == 60000.0

    @pytest.mark.parametrize("page_limit", [None, 10], ids=["default-200", "limit-10"])
    async def test_raw_fallback_sends_limit_and_follows_the_cursor_past_twenty_one_positions(
        self, monkeypatch: pytest.MonkeyPatch, page_limit: int | None
    ) -> None:
        import services.positions as positions_mod
        from services.positions import fetch_positions

        if page_limit is not None:
            monkeypatch.setattr(positions_mod, "BYBIT_POSITION_PAGE_LIMIT", page_limit)
        # 21 USDT-linear positions, each with unrealisedPnl "0": ccxt nulls an exact
        # zero, so the category is read on the raw path. Bybit's default page is 20.
        symbols = linear_symbols("USDT", 21)
        ex, book = await _holdings_exchange([_v5_row(s, unrealisedPnl="0") for s in symbols])
        try:
            result = await fetch_positions("bybit", ex)
        finally:
            await ex.close()

        assert sorted(r["symbol"] for r in result) == sorted(symbols), (
            f"first missing symbol: {sorted(set(symbols) - {r['symbol'] for r in result})[:1]}"
        )
        sent = book.calls_for("raw", category="linear", settleCoin="USDT")
        if page_limit is None:
            assert sent == [{"category": "linear", "settleCoin": "USDT", "limit": "200"}]
        else:
            assert sent == [
                {"category": "linear", "settleCoin": "USDT", "limit": "10"},
                {"category": "linear", "settleCoin": "USDT", "limit": "10", "cursor": "c10"},
                {"category": "linear", "settleCoin": "USDT", "limit": "10", "cursor": "c20"},
            ]

    async def test_a_full_ccxt_page_routes_the_category_to_the_raw_cursor_read(self) -> None:
        from services.positions import fetch_positions

        # 205 USDT-linear positions with a real uPnL: ccxt sends limit 200 and answers
        # a full page that cannot be told from a truncated one.
        symbols = linear_symbols("USDT", 205)
        ex, book = await _holdings_exchange([_v5_row(s) for s in symbols])
        try:
            result = await fetch_positions("bybit", ex)
        finally:
            await ex.close()

        assert len(result) == 205
        assert sorted(r["symbol"] for r in result) == sorted(symbols)
        assert len(book.calls_for("ccxt", category="linear", settleCoin="USDT")) == 1
        assert book.calls_for("raw", category="linear", settleCoin="USDT") == [
            {"category": "linear", "settleCoin": "USDT", "limit": "200"},
            {"category": "linear", "settleCoin": "USDT", "limit": "200", "cursor": "c200"},
        ]

    async def test_raw_page_cap_and_stuck_cursor_refuse_by_name(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        import services.positions as positions_mod
        from services.positions import BybitPositionReadRefused, fetch_positions

        monkeypatch.setattr(positions_mod, "BYBIT_POSITION_PAGE_LIMIT", 5)
        monkeypatch.setattr(positions_mod, "BYBIT_POSITION_RAW_PAGE_CAP", 3)

        # Boundary: 15 positions are exactly three pages of 5, so a cap of 3 is enough.
        ex, _book = await _holdings_exchange(
            [_v5_row(s, unrealisedPnl="0") for s in linear_symbols("USDT", 15)]
        )
        try:
            assert len(await fetch_positions("bybit", ex)) == 15
        finally:
            await ex.close()

        # 21 positions need five pages: a list still live after the cap refuses.
        ex, _book = await _holdings_exchange(
            [_v5_row(s, unrealisedPnl="0") for s in linear_symbols("USDT", 21)]
        )
        try:
            with pytest.raises(BybitPositionReadRefused) as capped:
                await fetch_positions("bybit", ex)
        finally:
            await ex.close()
        assert not any(ch.isdigit() for ch in str(capped.value)), str(capped.value)

        # A page that carries rows and answers the cursor it was sent refuses.
        def page(cursor: str) -> dict:
            return {
                "retCode": 0,
                "result": {"list": [_v5_row("BTCUSDT")], "nextPageCursor": cursor},
            }

        stuck = _bybit_exchange(ccxt_rows={})
        stuck.private_get_v5_position_list = AsyncMock(side_effect=[page("abc"), page("abc"), page("abc")])
        with pytest.raises(BybitPositionReadRefused) as repeated:
            await fetch_positions("bybit", stuck)
        assert not any(ch.isdigit() for ch in str(repeated.value)), str(repeated.value)
        assert stuck.private_get_v5_position_list.await_count == 2  # refused on the repeat

    async def test_a_failed_category_read_propagates_and_ships_no_rows(self) -> None:
        import ccxt

        from services.allocator_positions import (
            DERIVATIVE_FETCH_FAILED_NOTE,
            _venue_display,
            fetch_allocator_holdings,
        )
        from services.positions import fetch_positions

        rows = [_v5_row("BTCUSDT"), _v5_row("BTCPERP")]

        # A refused inverse category: the USDT and USDC rows already read do not ship.
        ex = await real_bybit_with_markets()
        install_position_book(ex, rows, refuse=frozenset({"inverse"}))
        try:
            with pytest.raises(ccxt.PermissionDenied):
                await fetch_positions("bybit", ex)
        finally:
            await ex.close()

        # A retryable failure of the last category keeps the holdings poll's existing
        # named handling: spot rows survive, derivative rows are none, and the warning
        # is the fixed copy. Never a book with the USDT and USDC rows but no inverse.
        ex, book = await _holdings_exchange(rows)
        delegate = ex.privateGetV5PositionList.side_effect

        async def inverse_network_error(params: dict) -> dict:
            if params.get("category") == "inverse":
                raise ccxt.NetworkError("bybit GET /v5/position/list network down")
            return await delegate(params)

        ex.privateGetV5PositionList = AsyncMock(side_effect=inverse_network_error)
        try:
            held, warning = await fetch_allocator_holdings("bybit", ex)
        finally:
            await ex.close()
        assert [r for r in held if r["holding_type"] == "derivative"] == []
        assert warning == DERIVATIVE_FETCH_FAILED_NOTE.format(venue=_venue_display("bybit"))

    async def test_usdt_rows_keep_their_stored_symbol(self) -> None:
        # Stored ``allocator_holdings`` and ``position_snapshots`` rows are keyed by
        # these symbols, so the fix must not re-derive them. The expected literals
        # were read off the code at the commit before this phase's change (a USDT perp
        # and a dated USDT future through ccxt, which writes the date as YYMMDD).
        rows = await self._fetch([_v5_row("BTCUSDT"), _v5_row("BTCUSDT-25SEP26")])
        assert [r["symbol"] for r in rows] == ["BTCUSDT", "BTCUSDT-260925"]
        # The raw path has always kept the venue's own id, dated form included.
        from services.positions import _parse_bybit_v5_positions

        raw = _parse_bybit_v5_positions(
            {"result": {"list": [_v5_row("BTCUSDT"), _v5_row("BTCUSDT-25SEP26")]}}
        )
        assert [r["symbol"] for r in raw] == ["BTCUSDT", "BTCUSDT-25SEP26"]

    # -- Task 3: census C12, the second caller of fetch_positions ---------------

    async def test_poll_positions_job_persists_the_usdc_row_with_the_corrected_symbol(self) -> None:
        """``run_poll_positions_job`` writes ``position_snapshots`` from the same
        ``fetch_positions``, so a USDC perp must reach the snapshot as BTCPERP with the
        USD figures, not as the garbled BTCUSDCC."""
        from types import SimpleNamespace

        from services.job_worker import run_poll_positions_job

        ex, _book = await _holdings_exchange([_v5_row("BTCPERP")])
        ctx = SimpleNamespace(
            supabase=MagicMock(),
            strategy_row={"id": "strategy-1"},
            key_row={"exchange": "bybit"},
            exchange=ex,
        )
        captured: list[list[dict]] = []

        async def capture(_client, snapshots, strategy_id, snapshot_date) -> int:
            assert strategy_id == "strategy-1"
            captured.append(snapshots)
            return len(snapshots)

        try:
            with patch(
                "services.job_worker._exchange_preflight", AsyncMock(return_value=ctx)
            ), patch(
                "services.job_worker.persist_position_snapshots", side_effect=capture
            ), patch("services.job_worker.aclose_exchange", AsyncMock()):
                await run_poll_positions_job({"strategy_id": "strategy-1"})
        finally:
            await ex.close()

        assert len(captured) == 1 and len(captured[0]) == 1, captured
        snap = captured[0][0]
        assert snap["symbol"] == "BTCPERP"
        assert snap["side"] == "long"
        assert snap["size_usd"] == 3000.0  # 0.05 x 60000
        assert snap["unrealized_pnl"] == 100.0  # (60000 - 58000) x 0.05
        assert snap["exchange"] == "bybit"

    # -- Review W2 WR-01 / SF-3: an answer with no list is not an empty book -----------------
    # Round 1 fixed this in the probe only. Here a reply with no ``result`` or no ``list`` read
    # as a flat category, so the holdings poll stored a book with no derivative rows and the
    # derivative leg of AUM read 0; a blank ``size`` read as a flat position.

    @pytest.mark.parametrize(
        "reply",
        [
            pytest.param({"retCode": 0}, id="no-result"),
            pytest.param({"retCode": 0, "result": {"nextPageCursor": ""}}, id="no-list"),
            pytest.param({"retCode": 0, "result": {"list": None}}, id="list-null"),
            pytest.param({"retCode": 0, "result": []}, id="result-not-an-object"),
        ],
    )
    async def test_a_reply_without_a_position_list_refuses_by_name(self, reply: dict) -> None:
        from services.positions import (
            BybitPositionReadRefused,
            _parse_bybit_v5_positions,
            fetch_positions,
        )

        with pytest.raises(BybitPositionReadRefused) as parsed:
            _parse_bybit_v5_positions(reply)

        # The poll: ccxt answers nothing, so the category is read on the raw path.
        ex = _bybit_exchange(ccxt_rows={}, raw_pages={"linear_usdt": reply})
        with pytest.raises(BybitPositionReadRefused) as polled:
            await fetch_positions("bybit", ex)

        for caught in (parsed.value, polled.value):
            assert not any(ch.isdigit() for ch in str(caught)), str(caught)
        assert str(parsed.value) == str(polled.value)

    @pytest.mark.parametrize("size", ["", "   ", None], ids=["blank", "spaces", "absent"])
    async def test_a_row_with_no_readable_size_refuses_instead_of_reading_flat(
        self, size: str | None
    ) -> None:
        from services.positions import (
            BybitPositionReadRefused,
            _parse_bybit_v5_positions,
            fetch_positions,
        )

        row = _v5_row("BTCUSDT")
        if size is None:
            row.pop("size")
        else:
            row["size"] = size
        page = {"retCode": 0, "result": {"list": [row], "nextPageCursor": ""}}

        with pytest.raises(BybitPositionReadRefused) as parsed:
            _parse_bybit_v5_positions(page)
        ex = _bybit_exchange(ccxt_rows={}, raw_pages={"linear_usdt": page})
        with pytest.raises(BybitPositionReadRefused):
            await fetch_positions("bybit", ex)
        assert not any(ch.isdigit() for ch in str(parsed.value)), str(parsed.value)

        # A REPORTED zero is still a flat position, not a refusal.
        flat = {"retCode": 0, "result": {"list": [{**row, "size": "0"}], "nextPageCursor": ""}}
        assert _parse_bybit_v5_positions(flat) == []

    # -- Review W2 SF-1: an inverse row's coin value and uPnL are refused, never shipped as 0/NaN --

    @pytest.mark.parametrize(
        "path, field, value",
        [
            ("ccxt", "positionValue", None),
            ("ccxt", "positionValue", ""),
            ("arm", "positionValue", None),
            ("arm", "positionValue", ""),
            ("arm", "positionValue", "   "),
            ("arm", "positionValue", "nan"),
            ("arm", "positionValue", "inf"),
            ("arm", "positionValue", "-0.001"),
            ("arm", "unrealisedPnl", "nan"),
            ("arm", "unrealisedPnl", "inf"),
            ("raw", "positionValue", None),
            ("raw", "positionValue", ""),
            ("raw", "positionValue", "nan"),
            ("raw", "positionValue", "-0.001"),
            ("raw", "unrealisedPnl", "nan"),
        ],
    )
    async def test_an_inverse_row_without_a_usable_value_or_upnl_refuses_by_name(
        self, path: str, field: str, value: str | None
    ) -> None:
        from services.positions import BybitPositionReadRefused, _normalize_ccxt_position

        row = self._inverse_row(**{field: value})
        with pytest.raises(BybitPositionReadRefused) as caught:
            if path == "ccxt":
                await self._fetch([row])
            elif path == "raw":
                self._raw_inverse(row)
            else:
                _normalize_ccxt_position(
                    {
                        "symbol": "BTC/USD:BTC",
                        "side": "long",
                        "contracts": 100.0,
                        "contractSize": 1.0,
                        "notional": 0.00166667,
                        "entryPrice": 57495.0,
                        "markPrice": 60000.0,
                        "unrealizedPnl": 7e-05,
                        "info": row,
                    },
                    "bybit",
                    bybit_category="inverse",
                )
        assert not any(ch.isdigit() for ch in str(caught.value)), str(caught.value)

    async def test_an_inverse_row_with_a_zero_value_or_an_absent_upnl_is_still_read(self) -> None:
        # A REPORTED zero value is a zero, and an absent uPnL stays None (the venue reported none).
        rows = self._raw_inverse(self._inverse_row(positionValue="0", unrealisedPnl=None))
        assert len(rows) == 1
        assert rows[0]["size_usd"] == 0.0
        assert rows[0]["unrealized_pnl"] is None

    # -- Review W2 WR-02 / census C28: Bybit options are not read, and a test says so ---------

    async def test_census_c28_the_poll_never_requests_bybit_options(self) -> None:
        """Census row C28 decides that Bybit option positions (``category=option``) are not read
        in this phase. If a later change adds an option read it must flip this test and the row
        deliberately, together with a normalizer for the option row (a premium, not a notional)."""
        from services.positions import fetch_positions

        # One zero-pnl row (ccxt nulls it, so USDT goes raw) and two empty categories (also raw):
        # both entry points are exercised for every category the poll reads.
        ex, book = await _holdings_exchange([_v5_row("BTCUSDT", unrealisedPnl="0")])
        try:
            await fetch_positions("bybit", ex)
        finally:
            await ex.close()

        entries = {c["entry"] for c in book.calls}
        assert entries == {"ccxt", "raw"}, entries
        categories = {c["params"].get("category") for c in book.calls}
        assert categories == {"linear", "inverse"}, (
            f"the poll asked for categories {sorted(map(str, categories))}; census row C28 decides "
            "that category=option is not read"
        )
        assert book.calls_for("ccxt", category="option") == []
        assert book.calls_for("raw", category="option") == []

    # -- Review W2 WR-01b: the ccxt path reads a blank size as zero contracts, i.e. flat -------

    # (A whitespace-only size never reaches the arm: ccxt's own parse raises ValueError first.)
    @pytest.mark.parametrize("size", ["", None], ids=["blank", "absent"])
    async def test_a_ccxt_row_with_no_readable_size_refuses_instead_of_reading_flat(
        self, size: str | None
    ) -> None:
        from services.positions import BybitPositionReadRefused

        row = _v5_row("BTCUSDT")
        if size is None:
            row.pop("size")
        else:
            row["size"] = size
        # Through real ccxt: its own ``contracts`` is None, and the row used to be dropped as flat.
        with pytest.raises(BybitPositionReadRefused) as caught:
            await self._fetch([row])
        assert not any(ch.isdigit() for ch in str(caught.value)), str(caught.value)

        # A REPORTED zero is still a flat position, not a refusal.
        assert await self._fetch([{**row, "size": "0"}]) == []

    # -- Review W2 round 2, R2-5: a linear open position's value and mark are never defaulted ----

    @staticmethod
    def _linear_row(**overrides: str | None) -> dict:
        row = _v5_row("BTCUSDT")
        for key, value in overrides.items():
            if value is None:
                row.pop(key, None)
            else:
                row[key] = value
        return row

    @pytest.mark.parametrize("field", ["positionValue", "markPrice"])
    @pytest.mark.parametrize("value", [None, "", "   "], ids=["absent", "blank", "spaces"])
    async def test_a_linear_row_without_a_value_or_mark_refuses_by_name(
        self, field: str, value: str | None
    ) -> None:
        from services.positions import BybitPositionReadRefused, _parse_bybit_v5_positions

        row = self._linear_row(**{field: value})
        with pytest.raises(BybitPositionReadRefused) as caught:
            _parse_bybit_v5_positions(
                {"retCode": 0, "result": {"list": [row], "nextPageCursor": ""}}
            )
        assert not any(ch.isdigit() for ch in str(caught.value)), str(caught.value)

        # A flat row (a reported zero size) is not an open position: no value is needed.
        flat = {**row, "size": "0"}
        assert _parse_bybit_v5_positions(
            {"retCode": 0, "result": {"list": [flat], "nextPageCursor": ""}}
        ) == []

    @pytest.mark.parametrize("field", ["positionValue", "markPrice"])
    @pytest.mark.parametrize("value", [None, ""], ids=["absent", "blank"])
    async def test_a_ccxt_linear_row_without_a_value_or_mark_refuses_by_name(
        self, field: str, value: str | None
    ) -> None:
        # Through real ccxt: an absent value makes ccxt's notional None and the row ships on the
        # ccxt path, where it used to read 0; an absent mark routes the category to the raw path.
        from services.positions import BybitPositionReadRefused

        with pytest.raises(BybitPositionReadRefused):
            await self._fetch([self._linear_row(**{field: value})])

    @pytest.mark.parametrize("category", ["linear_usdt", "inverse"])
    async def test_a_non_finite_size_refuses_by_name(self, category: str) -> None:
        from services.positions import (
            BybitPositionReadRefused,
            _normalize_ccxt_position,
            _parse_bybit_v5_positions,
        )

        row = self._inverse_row(size="nan") if category == "inverse" else self._linear_row(size="nan")
        with pytest.raises(BybitPositionReadRefused):
            _parse_bybit_v5_positions(
                {"retCode": 0, "result": {"list": [row], "nextPageCursor": ""}}, category=category
            )
        # The ccxt arm, with a ccxt dict whose own contracts are not finite.
        with pytest.raises(BybitPositionReadRefused):
            _normalize_ccxt_position(
                {
                    "symbol": "BTC/USDT:USDT",
                    "side": "long",
                    "contracts": float("nan"),
                    "contractSize": 1.0,
                    "notional": 3000.0,
                    "entryPrice": 58000.0,
                    "markPrice": 60000.0,
                    "unrealizedPnl": 100.0,
                    "info": {"size": "nan"},
                },
                "bybit",
                bybit_category=category,
            )
