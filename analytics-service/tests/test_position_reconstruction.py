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

        with patch("services.position_reconstruction.db_execute", side_effect=_run_sync):
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

        with patch("services.position_reconstruction.db_execute", side_effect=_run_sync):
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

        with patch("services.position_reconstruction.db_execute", side_effect=_run_sync):
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


# ---------------------------------------------------------------------------
# Phase 12 / Plan 04 — METRICS-05, METRICS-06 — RED tests
# ---------------------------------------------------------------------------
# METRICS-05: compute_exposure_metrics persists per-date exposure_series
#             alongside aggregates (refactor lines 461-487 — was discarded).
# METRICS-06: compute_turnover_series with explicit Pitfall #19 docstring
#             contract (turnover = abs(Δposition × price) / nav).

from services.position_reconstruction import (
    compute_exposure_metrics,
    compute_turnover_series,
)


def _make_exposure_snapshots_mock(snapshots: list[dict]) -> MagicMock:
    """Mock supabase whose position_snapshots select chain returns `snapshots`.

    Mirrors _make_snapshots_mock in test_position_reconstruction_edges.py.
    """
    mock = MagicMock()
    mock_table = MagicMock()
    m_sel = MagicMock()
    m_eq = MagicMock()
    m_order = MagicMock()
    m_order.execute.return_value = MagicMock(data=snapshots)
    m_eq.order.return_value = m_order
    m_sel.eq.return_value = m_eq
    mock_table.select.return_value = m_sel
    mock.table.return_value = mock_table
    return mock


@pytest.mark.asyncio
async def test_exposure_metrics_includes_series() -> None:
    """METRICS-05: per-date exposure arrays now persist as exposure_series
    alongside aggregates (was previously discarded after aggregation)."""
    snaps = [
        {"snapshot_date": "2024-01-01", "side": "long", "size_usd": 500.0},
        {"snapshot_date": "2024-01-01", "side": "short", "size_usd": 300.0},
        {"snapshot_date": "2024-01-02", "side": "long", "size_usd": 600.0},
        {"snapshot_date": "2024-01-02", "side": "short", "size_usd": 400.0},
    ]
    mock = _make_exposure_snapshots_mock(snaps)
    with patch("services.position_reconstruction.db_execute", side_effect=_run_sync):
        result = await compute_exposure_metrics("strat-1", mock)
    # Existing aggregates still present (no caller breakage)
    assert "mean_gross_exposure" in result
    assert "max_gross_exposure" in result
    # NEW: exposure_series with per-date entries
    assert "exposure_series" in result
    assert isinstance(result["exposure_series"], list)
    assert len(result["exposure_series"]) == 2
    for point in result["exposure_series"]:
        assert "date" in point
        assert "gross" in point
        assert "net" in point
    # Day 1: gross 800, net +200. Day 2: gross 1000, net +200.
    by_date = {p["date"]: p for p in result["exposure_series"]}
    assert by_date["2024-01-01"]["gross"] == 800.0
    assert by_date["2024-01-01"]["net"] == 200.0
    assert by_date["2024-01-02"]["gross"] == 1000.0
    assert by_date["2024-01-02"]["net"] == 200.0


@pytest.mark.asyncio
async def test_exposure_metrics_empty_when_no_snapshots() -> None:
    """METRICS-05: empty input still returns empty dict (no exposure_series key)."""
    mock = _make_exposure_snapshots_mock([])
    with patch("services.position_reconstruction.db_execute", side_effect=_run_sync):
        result = await compute_exposure_metrics("strat-1", mock)
    assert result == {}


def test_turnover_series_contract() -> None:
    """METRICS-06 / Pitfall 19: turnover = abs(Δposition × price) / NAV per docstring contract."""
    # Synthetic: position changes by 1.0 unit, price=100, nav=10000 → turnover = 0.01
    positions_by_date = {
        "2025-01-01": {"BTC": 0.0},
        "2025-01-02": {"BTC": 1.0},
        "2025-01-03": {"BTC": 1.0},
    }
    prices_by_date = {
        "2025-01-01": {"BTC": 100.0},
        "2025-01-02": {"BTC": 100.0},
        "2025-01-03": {"BTC": 100.0},
    }
    nav_by_date = {
        "2025-01-01": 10000.0,
        "2025-01-02": 10000.0,
        "2025-01-03": 10000.0,
    }
    series = compute_turnover_series(positions_by_date, prices_by_date, nav_by_date)
    assert isinstance(series, list)
    days = {p["date"]: p["turnover"] for p in series}
    # Day 1: no prior position → turnover = 0
    assert abs(days.get("2025-01-01", 999.0) - 0.0) < 1e-9
    # Day 2: Δ = 1.0, price = 100, nav = 10000 → 0.01
    assert "2025-01-02" in days
    assert abs(days["2025-01-02"] - 0.01) < 1e-9
    # Day 3: Δ = 0 → turnover = 0
    assert abs(days.get("2025-01-03", 0.0) - 0.0) < 1e-9


def test_turnover_series_empty_input() -> None:
    """METRICS-06: empty input returns empty list (graceful)."""
    assert compute_turnover_series({}, {}, {}) == []


def test_turnover_series_zero_nav_short_circuit() -> None:
    """METRICS-06 / T-12-04-02 mitigation: zero or negative NAV → turnover=0."""
    positions_by_date = {
        "2025-01-01": {"BTC": 0.0},
        "2025-01-02": {"BTC": 1.0},
    }
    prices_by_date = {
        "2025-01-01": {"BTC": 100.0},
        "2025-01-02": {"BTC": 100.0},
    }
    nav_by_date = {
        "2025-01-01": 10000.0,
        "2025-01-02": 0.0,  # zero NAV → must short-circuit, not raise ZeroDivisionError
    }
    series = compute_turnover_series(positions_by_date, prices_by_date, nav_by_date)
    days = {p["date"]: p["turnover"] for p in series}
    assert days["2025-01-02"] == 0.0


def test_turnover_series_multi_symbol() -> None:
    """METRICS-06: turnover sums abs(Δ × price) across all symbols, divided by NAV."""
    positions_by_date = {
        "2025-01-01": {"BTC": 0.0, "ETH": 0.0},
        "2025-01-02": {"BTC": 1.0, "ETH": 5.0},
    }
    prices_by_date = {
        "2025-01-01": {"BTC": 100.0, "ETH": 50.0},
        "2025-01-02": {"BTC": 100.0, "ETH": 50.0},
    }
    nav_by_date = {
        "2025-01-01": 10000.0,
        "2025-01-02": 10000.0,
    }
    series = compute_turnover_series(positions_by_date, prices_by_date, nav_by_date)
    days = {p["date"]: p["turnover"] for p in series}
    # Δ_BTC × P_BTC + Δ_ETH × P_ETH = 1*100 + 5*50 = 350; nav=10000 → 0.035
    assert abs(days["2025-01-02"] - 0.035) < 1e-9
