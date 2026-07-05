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
        "info": {},
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


# ---------------------------------------------------------------------------
# Test: Bybit CCXT happy path
# ---------------------------------------------------------------------------

class TestFetchPositionsBybitHappy:
    """Bybit: CCXT fetch_positions() returns complete data — no fallback."""

    async def test_bybit_ccxt_complete(self) -> None:
        from services.positions import fetch_positions

        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"
        mock_exchange.fetch_positions.return_value = BYBIT_CCXT_COMPLETE

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


# ---------------------------------------------------------------------------
# Test: Bybit CCXT incomplete → raw V5 fallback
# ---------------------------------------------------------------------------

class TestFetchPositionsBybitFallback:
    """Bybit: CCXT missing markPrice → falls back to raw V5 API."""

    async def test_bybit_fallback_to_v5(self) -> None:
        from services.positions import fetch_positions

        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"
        mock_exchange.fetch_positions.return_value = BYBIT_CCXT_INCOMPLETE
        mock_exchange.private_get_v5_position_list.return_value = BYBIT_V5_RAW_RESPONSE

        result = await fetch_positions("bybit", mock_exchange)

        assert len(result) == 1
        pos = result[0]
        assert pos["symbol"] == "BTCUSDT"
        assert pos["side"] == "long"
        assert pos["size_base"] == 0.1
        assert pos["mark_price"] == 61000.0
        assert pos["unrealized_pnl"] == 100.0
        assert pos["entry_price"] == 60000.0
        # Verify the fallback was actually invoked
        mock_exchange.private_get_v5_position_list.assert_awaited_once()


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

        def _boom(pos, exchange_name):
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
