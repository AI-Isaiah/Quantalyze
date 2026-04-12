"""Tests for analytics-service/services/position_reconstruction.py.

Exercises FIFO position matching from raw fills: single long/short,
multiple positions, partial fills, weighted average entry, ROI
calculations, empty fills, idempotency, and zero-entry guard.

All tests mock supabase via MagicMock — no real DB calls.
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from services.position_reconstruction import (
    _match_positions_fifo,
    reconstruct_positions,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_fill(
    symbol: str = "BTCUSDT",
    side: str = "buy",
    price: float = 100.0,
    quantity: float = 1.0,
    fee: float = 0.0,
    timestamp: str = "2024-01-01T00:00:00+00:00",
    raw_data: dict | None = None,
) -> dict:
    """Create a fill dict matching the trades table schema."""
    return {
        "symbol": symbol,
        "side": side,
        "price": price,
        "quantity": quantity,
        "fee": fee,
        "timestamp": timestamp,
        "raw_data": raw_data or {},
        "is_fill": True,
    }


def _make_mock_supabase(fills: list[dict]) -> MagicMock:
    """Create a mock supabase client that returns the given fills on
    select and accepts DELETE + INSERT without error."""
    mock = MagicMock()

    # trades.select().eq().eq().order().execute() → fills
    mock_table_trades = MagicMock()
    mock_select = MagicMock()
    mock_eq1 = MagicMock()
    mock_eq2 = MagicMock()
    mock_order = MagicMock()
    mock_order.execute.return_value = MagicMock(data=fills)
    mock_eq2.order.return_value = mock_order
    mock_eq1.eq.return_value = mock_eq2
    mock_select.eq.return_value = mock_eq1
    mock_table_trades.select.return_value = mock_select

    # positions.delete().eq().execute() → ok
    mock_table_positions = MagicMock()
    mock_delete = MagicMock()
    mock_delete_eq = MagicMock()
    mock_delete_eq.execute.return_value = MagicMock(data=[])
    mock_delete.eq.return_value = mock_delete_eq
    mock_table_positions.delete.return_value = mock_delete

    # positions.insert().execute() → ok
    mock_insert = MagicMock()
    mock_insert.execute.return_value = MagicMock(data=[])
    mock_table_positions.insert.return_value = mock_insert

    def _table(name: str):
        if name == "trades":
            return mock_table_trades
        if name == "positions":
            return mock_table_positions
        return MagicMock()

    mock.table = _table
    return mock


# ---------------------------------------------------------------------------
# FIFO matching: _match_positions_fifo (pure function, no DB)
# ---------------------------------------------------------------------------

class TestMatchPositionsFIFO:
    """Tests for _match_positions_fifo — the pure FIFO matching function."""

    def test_single_long_position(self) -> None:
        """buy 1 BTC -> sell 1 BTC -> 1 closed position."""
        fills = [
            _make_fill(side="buy", price=100.0, quantity=1.0, timestamp="2024-01-01T00:00:00+00:00"),
            _make_fill(side="sell", price=110.0, quantity=1.0, timestamp="2024-01-02T00:00:00+00:00"),
        ]
        positions = _match_positions_fifo("BTCUSDT", fills, "strat-1")

        assert len(positions) == 1
        pos = positions[0]
        assert pos["side"] == "long"
        assert pos["status"] == "closed"
        assert pos["entry_price_avg"] == 100.0
        assert pos["exit_price_avg"] == 110.0
        assert pos["size_base"] == 1.0
        assert pos["roi"] > 0  # (110-100)/100 = 0.1

    def test_single_short_position(self) -> None:
        """sell 1 BTC -> buy 1 BTC -> 1 closed position, ROI = (entry-exit)/entry."""
        fills = [
            _make_fill(side="sell", price=110.0, quantity=1.0, timestamp="2024-01-01T00:00:00+00:00"),
            _make_fill(side="buy", price=100.0, quantity=1.0, timestamp="2024-01-02T00:00:00+00:00"),
        ]
        positions = _match_positions_fifo("BTCUSDT", fills, "strat-1")

        assert len(positions) == 1
        pos = positions[0]
        assert pos["side"] == "short"
        assert pos["status"] == "closed"
        # ROI for short: (entry - exit) / entry = (110 - 100) / 110
        expected_roi = round((110.0 - 100.0) / 110.0, 6)
        assert pos["roi"] == expected_roi

    def test_multiple_positions(self) -> None:
        """buy -> sell -> buy -> sell -> 2 closed positions."""
        fills = [
            _make_fill(side="buy", price=100.0, quantity=1.0, timestamp="2024-01-01T00:00:00+00:00"),
            _make_fill(side="sell", price=110.0, quantity=1.0, timestamp="2024-01-02T00:00:00+00:00"),
            _make_fill(side="buy", price=105.0, quantity=1.0, timestamp="2024-01-03T00:00:00+00:00"),
            _make_fill(side="sell", price=115.0, quantity=1.0, timestamp="2024-01-04T00:00:00+00:00"),
        ]
        positions = _match_positions_fifo("BTCUSDT", fills, "strat-1")

        assert len(positions) == 2
        assert all(p["status"] == "closed" for p in positions)
        assert positions[0]["entry_price_avg"] == 100.0
        assert positions[1]["entry_price_avg"] == 105.0

    def test_partial_fills(self) -> None:
        """3 buys, 2 sells (total sell qty < total buy qty) -> position still open."""
        fills = [
            _make_fill(side="buy", price=100.0, quantity=1.0, timestamp="2024-01-01T00:00:00+00:00"),
            _make_fill(side="buy", price=105.0, quantity=1.0, timestamp="2024-01-02T00:00:00+00:00"),
            _make_fill(side="buy", price=110.0, quantity=1.0, timestamp="2024-01-03T00:00:00+00:00"),
            _make_fill(side="sell", price=115.0, quantity=1.0, timestamp="2024-01-04T00:00:00+00:00"),
            _make_fill(side="sell", price=120.0, quantity=1.0, timestamp="2024-01-05T00:00:00+00:00"),
        ]
        positions = _match_positions_fifo("BTCUSDT", fills, "strat-1")

        # net_qty = 3 - 2 = 1 remaining, so still open
        open_pos = [p for p in positions if p["status"] == "open"]
        assert len(open_pos) >= 1

    def test_weighted_average_entry(self) -> None:
        """buy 1@100, buy 2@200 -> avg entry = (100 + 400) / 3 = 166.67."""
        fills = [
            _make_fill(side="buy", price=100.0, quantity=1.0, timestamp="2024-01-01T00:00:00+00:00"),
            _make_fill(side="buy", price=200.0, quantity=2.0, timestamp="2024-01-02T00:00:00+00:00"),
            _make_fill(side="sell", price=250.0, quantity=3.0, timestamp="2024-01-03T00:00:00+00:00"),
        ]
        positions = _match_positions_fifo("BTCUSDT", fills, "strat-1")

        assert len(positions) == 1
        pos = positions[0]
        assert pos["status"] == "closed"
        # Weighted avg: (1*100 + 2*200) / 3 = 500/3 = 166.666...
        assert abs(pos["entry_price_avg"] - 166.66666667) < 0.01

    def test_roi_long_positive(self) -> None:
        """Long position: ROI = (exit - entry) / entry."""
        fills = [
            _make_fill(side="buy", price=100.0, quantity=1.0, timestamp="2024-01-01T00:00:00+00:00"),
            _make_fill(side="sell", price=120.0, quantity=1.0, timestamp="2024-01-02T00:00:00+00:00"),
        ]
        positions = _match_positions_fifo("BTCUSDT", fills, "strat-1")

        assert len(positions) == 1
        pos = positions[0]
        expected_roi = round((120.0 - 100.0) / 100.0, 6)
        assert pos["roi"] == expected_roi  # 0.2

    def test_roi_short_positive(self) -> None:
        """Short position: ROI = (entry - exit) / entry."""
        fills = [
            _make_fill(side="sell", price=120.0, quantity=1.0, timestamp="2024-01-01T00:00:00+00:00"),
            _make_fill(side="buy", price=100.0, quantity=1.0, timestamp="2024-01-02T00:00:00+00:00"),
        ]
        positions = _match_positions_fifo("BTCUSDT", fills, "strat-1")

        assert len(positions) == 1
        pos = positions[0]
        expected_roi = round((120.0 - 100.0) / 120.0, 6)
        assert pos["roi"] == expected_roi

    def test_empty_fills(self) -> None:
        """No fills -> no positions."""
        positions = _match_positions_fifo("BTCUSDT", [], "strat-1")
        assert positions == []

    def test_zero_entry_guard(self) -> None:
        """Fill with price=0 should not cause ZeroDivisionError in ROI calc."""
        fills = [
            _make_fill(side="buy", price=0.0, quantity=1.0, timestamp="2024-01-01T00:00:00+00:00"),
            _make_fill(side="sell", price=100.0, quantity=1.0, timestamp="2024-01-02T00:00:00+00:00"),
        ]
        # Should not raise
        positions = _match_positions_fifo("BTCUSDT", fills, "strat-1")
        assert len(positions) == 1
        # ROI when entry_avg is 0: the code returns 0 (guards against division by zero)
        assert positions[0]["roi"] == 0


# ---------------------------------------------------------------------------
# reconstruct_positions (async, requires DB mocking)
# ---------------------------------------------------------------------------

class TestReconstructPositions:
    """Tests for reconstruct_positions — the async entry point that queries
    fills from DB, runs FIFO matching, and persists positions."""

    @pytest.mark.asyncio
    async def test_empty_fills_returns_empty_metrics(self) -> None:
        """No fills in DB -> returns empty dict, trade_metrics all zeros."""
        mock_supabase = _make_mock_supabase(fills=[])

        with patch("services.position_reconstruction.db_execute", side_effect=lambda fn: _run_sync(fn)):
            result = await reconstruct_positions("strat-1", mock_supabase)

        assert result == {}

    @pytest.mark.asyncio
    async def test_single_position_metrics(self) -> None:
        """Single closed long position produces expected trade_metrics."""
        fills = [
            {
                "symbol": "BTCUSDT",
                "side": "buy",
                "price": 100.0,
                "quantity": 1.0,
                "fee": 0.1,
                "timestamp": "2024-01-01T00:00:00+00:00",
                "raw_data": {},
                "is_fill": True,
            },
            {
                "symbol": "BTCUSDT",
                "side": "sell",
                "price": 110.0,
                "quantity": 1.0,
                "fee": 0.1,
                "timestamp": "2024-01-02T00:00:00+00:00",
                "raw_data": {},
                "is_fill": True,
            },
        ]
        mock_supabase = _make_mock_supabase(fills=fills)

        with patch("services.position_reconstruction.db_execute", side_effect=lambda fn: _run_sync(fn)):
            result = await reconstruct_positions("strat-1", mock_supabase)

        assert result["total_positions"] == 1
        assert result["closed_positions"] == 1
        assert result["open_positions"] == 0
        assert result["win_rate"] == 1.0
        assert result["long_count"] == 1
        assert result["short_count"] == 0

    @pytest.mark.asyncio
    async def test_delete_and_reinsert_idempotent(self) -> None:
        """Run twice with same fills — result should be identical (idempotency)."""
        fills = [
            {
                "symbol": "BTCUSDT",
                "side": "buy",
                "price": 100.0,
                "quantity": 1.0,
                "fee": 0.0,
                "timestamp": "2024-01-01T00:00:00+00:00",
                "raw_data": {},
                "is_fill": True,
            },
            {
                "symbol": "BTCUSDT",
                "side": "sell",
                "price": 110.0,
                "quantity": 1.0,
                "fee": 0.0,
                "timestamp": "2024-01-02T00:00:00+00:00",
                "raw_data": {},
                "is_fill": True,
            },
        ]

        with patch("services.position_reconstruction.db_execute", side_effect=lambda fn: _run_sync(fn)):
            mock1 = _make_mock_supabase(fills=fills)
            result1 = await reconstruct_positions("strat-1", mock1)

            mock2 = _make_mock_supabase(fills=fills)
            result2 = await reconstruct_positions("strat-1", mock2)

        assert result1 == result2


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

import asyncio


async def _run_sync(fn):
    """Run a synchronous function in a thread, matching db_execute's contract."""
    return await asyncio.to_thread(fn)
