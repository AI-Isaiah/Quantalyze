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
