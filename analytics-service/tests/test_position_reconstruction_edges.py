"""Coverage extensions for services/position_reconstruction.py.

Covers gaps that the golden-path tests in test_position_reconstruction.py and
test_position_reconstruction_funding.py leave untested:

- `compute_exposure_metrics` (entire function — empty, single-day, multi-day
  long/short mix, missing size_usd fallback).
- FIFO overshoot flip, zero-qty skip, add-to-short branch, bad-timestamp
  duration fallback.
- `_attribute_funding` tolerance for missing fields, naive timestamps,
  unparseable amounts, and a supabase fetch that raises.
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from services.position_reconstruction import (
    _match_positions_fifo,
    compute_exposure_metrics,
    reconstruct_positions,
)


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

async def _mock_db_execute(fn):
    """Async wrapper matching db_execute's contract without a thread hop."""
    return fn()


def _make_fill(
    side: str,
    qty: float,
    price: float,
    ts: str,
    symbol: str = "BTCUSDT",
    raw_data: dict | None = None,
) -> dict:
    return {
        "symbol": symbol,
        "side": side,
        "price": price,
        "quantity": qty,
        "fee": 0.0,
        "timestamp": ts,
        "raw_data": raw_data or {},
        "is_fill": True,
    }


def _make_snapshots_mock(snapshots: list[dict]) -> MagicMock:
    """Mock supabase whose position_snapshots select chain returns `snapshots`."""
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


def _make_trades_funding_mock(
    fills: list[dict],
    funding_execute_side_effect,
) -> MagicMock:
    """Mock supabase for reconstruct_positions: trades returns `fills`; the
    funding_fees.execute chain applies `funding_execute_side_effect` (can raise
    to exercise the outer except, or return a sequence of pages)."""
    mock = MagicMock()

    mock_trades = MagicMock()
    m_sel = MagicMock()
    m_eq1 = MagicMock()
    m_eq2 = MagicMock()
    m_order = MagicMock()
    m_order.execute.return_value = MagicMock(data=fills)
    m_eq2.order.return_value = m_order
    m_eq1.eq.return_value = m_eq2
    m_sel.eq.return_value = m_eq1
    mock_trades.select.return_value = m_sel

    mock_funding = MagicMock()
    f_sel = MagicMock()
    f_eq1 = MagicMock()
    f_gte = MagicMock()
    f_lte = MagicMock()
    f_range = MagicMock()
    f_range.execute.side_effect = funding_execute_side_effect
    f_lte.range.return_value = f_range
    f_gte.lte.return_value = f_lte
    f_eq1.gte.return_value = f_gte
    f_sel.eq.return_value = f_eq1
    mock_funding.select.return_value = f_sel

    mock_positions = MagicMock()
    m_del = MagicMock()
    m_del_eq = MagicMock()
    m_del_eq.execute.return_value = MagicMock(data=[])
    m_del.eq.return_value = m_del_eq
    mock_positions.delete.return_value = m_del
    m_ins = MagicMock()
    m_ins.execute.return_value = MagicMock(data=[])
    mock_positions.insert.return_value = m_ins

    captured_inserts: list[list[dict]] = []

    def _capture(rows):
        captured_inserts.append(rows if isinstance(rows, list) else [rows])
        return m_ins

    mock_positions.insert.side_effect = _capture

    def _table(name: str):
        if name == "trades":
            return mock_trades
        if name == "positions":
            return mock_positions
        if name == "funding_fees":
            return mock_funding
        return MagicMock()

    mock.table = _table
    mock._captured_inserts = captured_inserts
    return mock


# ---------------------------------------------------------------------------
# compute_exposure_metrics
# ---------------------------------------------------------------------------

class TestComputeExposureMetrics:
    """Covers services/position_reconstruction.py lines 441-489."""

    @pytest.mark.asyncio
    async def test_empty_snapshots_returns_empty_dict(self) -> None:
        mock = _make_snapshots_mock([])
        with patch(
            "services.position_reconstruction.db_execute",
            side_effect=_mock_db_execute,
        ):
            result = await compute_exposure_metrics("s-1", mock)
        assert result == {}

    @pytest.mark.asyncio
    async def test_single_date_long_position(self) -> None:
        """One snapshot day → mean=max=size, std=0 (single point)."""
        snaps = [
            {"snapshot_date": "2024-01-01", "side": "long", "size_usd": 1000.0}
        ]
        mock = _make_snapshots_mock(snaps)
        with patch(
            "services.position_reconstruction.db_execute",
            side_effect=_mock_db_execute,
        ):
            result = await compute_exposure_metrics("s-1", mock)
        assert result["mean_gross_exposure"] == 1000.0
        assert result["max_gross_exposure"] == 1000.0
        assert result["std_gross_exposure"] == 0.0
        assert result["mean_net_exposure"] == 1000.0
        assert result["max_net_exposure"] == 1000.0
        assert result["std_net_exposure"] == 0.0

    @pytest.mark.asyncio
    async def test_multi_date_long_and_short_mix(self) -> None:
        """Day 1: gross 800, net +200. Day 2: gross 1000, net +200."""
        snaps = [
            {"snapshot_date": "2024-01-01", "side": "long", "size_usd": 500.0},
            {"snapshot_date": "2024-01-01", "side": "short", "size_usd": 300.0},
            {"snapshot_date": "2024-01-02", "side": "long", "size_usd": 600.0},
            {"snapshot_date": "2024-01-02", "side": "short", "size_usd": 400.0},
        ]
        mock = _make_snapshots_mock(snaps)
        with patch(
            "services.position_reconstruction.db_execute",
            side_effect=_mock_db_execute,
        ):
            result = await compute_exposure_metrics("s-1", mock)
        assert result["mean_gross_exposure"] == 900.0
        assert result["max_gross_exposure"] == 1000.0
        assert result["std_gross_exposure"] > 0
        assert result["mean_net_exposure"] == 200.0
        assert result["max_net_exposure"] == 200.0
        assert result["std_net_exposure"] == 0.0

    @pytest.mark.asyncio
    async def test_short_dominant_net_negative(self) -> None:
        """Net exposure max tracks the largest absolute value, preserving sign."""
        snaps = [
            {"snapshot_date": "2024-01-01", "side": "short", "size_usd": 800.0},
            {"snapshot_date": "2024-01-02", "side": "long", "size_usd": 200.0},
        ]
        mock = _make_snapshots_mock(snaps)
        with patch(
            "services.position_reconstruction.db_execute",
            side_effect=_mock_db_execute,
        ):
            result = await compute_exposure_metrics("s-1", mock)
        assert result["max_net_exposure"] == -800.0

    @pytest.mark.asyncio
    async def test_missing_size_defaults_to_zero(self) -> None:
        """size_usd = None on a snapshot is coerced to 0 by the `or 0` guard."""
        snaps = [
            {"snapshot_date": "2024-01-01", "side": "long", "size_usd": 100.0},
            {"snapshot_date": "2024-01-01", "side": "long", "size_usd": None},
        ]
        mock = _make_snapshots_mock(snaps)
        with patch(
            "services.position_reconstruction.db_execute",
            side_effect=_mock_db_execute,
        ):
            result = await compute_exposure_metrics("s-1", mock)
        assert result["mean_gross_exposure"] == 100.0


# ---------------------------------------------------------------------------
# FIFO edge cases: overshoot flip, zero-qty, add-to-short, bad timestamp
# ---------------------------------------------------------------------------

class TestFifoEdges:
    def test_overshoot_flips_direction(self) -> None:
        """buy 1, sell 2 → closes long with qty=1, opens short with qty=1.

        Covers lines 386-397 (remainder > 1e-12 flip branch).
        """
        fills = [
            _make_fill("buy", 1.0, 100.0, "2024-01-01T00:00:00+00:00"),
            _make_fill("sell", 2.0, 110.0, "2024-01-02T00:00:00+00:00"),
        ]
        positions = _match_positions_fifo("BTCUSDT", fills, "s-1")
        closed = [p for p in positions if p["status"] == "closed"]
        opens = [p for p in positions if p["status"] == "open"]
        assert len(closed) == 1 and closed[0]["side"] == "long"
        assert len(opens) == 1 and opens[0]["side"] == "short"
        assert opens[0]["size_base"] == 1.0

    def test_short_overshoots_to_long(self) -> None:
        """sell 1, buy 3 → closes short with qty=1, opens long with qty=2."""
        fills = [
            _make_fill("sell", 1.0, 110.0, "2024-01-01T00:00:00+00:00"),
            _make_fill("buy", 3.0, 100.0, "2024-01-02T00:00:00+00:00"),
        ]
        positions = _match_positions_fifo("BTCUSDT", fills, "s-1")
        closed = [p for p in positions if p["status"] == "closed"]
        opens = [p for p in positions if p["status"] == "open"]
        assert len(closed) == 1 and closed[0]["side"] == "short"
        assert len(opens) == 1 and opens[0]["side"] == "long"
        assert opens[0]["size_base"] == 2.0

    def test_zero_qty_fills_are_ignored(self) -> None:
        """qty=0 fills are skipped before opening/closing (line 288)."""
        fills = [
            _make_fill("buy", 0.0, 100.0, "2024-01-01T00:00:00+00:00"),
            _make_fill("buy", 1.0, 100.0, "2024-01-02T00:00:00+00:00"),
            _make_fill("sell", 1.0, 110.0, "2024-01-03T00:00:00+00:00"),
        ]
        positions = _match_positions_fifo("BTCUSDT", fills, "s-1")
        assert len(positions) == 1
        assert positions[0]["entry_price_avg"] == 100.0

    def test_add_to_existing_short(self) -> None:
        """Consecutive sells grow the short position (lines 324-328)."""
        fills = [
            _make_fill("sell", 1.0, 110.0, "2024-01-01T00:00:00+00:00"),
            _make_fill("sell", 1.0, 120.0, "2024-01-02T00:00:00+00:00"),
            _make_fill("buy", 2.0, 100.0, "2024-01-03T00:00:00+00:00"),
        ]
        positions = _match_positions_fifo("BTCUSDT", fills, "s-1")
        assert len(positions) == 1
        pos = positions[0]
        assert pos["side"] == "short"
        assert pos["size_base"] == 2.0
        assert pos["entry_price_avg"] == 115.0  # (110 + 120) / 2

    def test_bad_timestamps_yield_none_duration(self) -> None:
        """Unparseable ISO timestamps on the closing fill silently yield
        duration_days=None (lines 359-360)."""
        fills = [
            _make_fill("buy", 1.0, 100.0, "not-a-timestamp"),
            _make_fill("sell", 1.0, 110.0, "also-not-valid"),
        ]
        positions = _match_positions_fifo("BTCUSDT", fills, "s-1")
        assert len(positions) == 1
        assert positions[0]["duration_days"] is None

    def test_hedge_mode_posside_override(self) -> None:
        """posSide='short' in raw_data opens a short even on a buy fill."""
        fills = [
            _make_fill(
                "buy",
                1.0,
                100.0,
                "2024-01-01T00:00:00+00:00",
                raw_data={"posSide": "short"},
            ),
            _make_fill(
                "sell",
                1.0,
                90.0,
                "2024-01-02T00:00:00+00:00",
                raw_data={"posSide": "short"},
            ),
        ]
        positions = _match_positions_fifo("BTCUSDT", fills, "s-1")
        # With posSide forcing short, the first fill opens short; second fill
        # (sell) adds to short. No close → one open position with qty=2.
        opens = [p for p in positions if p["status"] == "open"]
        assert len(opens) == 1
        assert opens[0]["side"] == "short"


# ---------------------------------------------------------------------------
# _attribute_funding edge cases via reconstruct_positions
# ---------------------------------------------------------------------------

class TestAttributeFundingEdges:
    @pytest.mark.asyncio
    async def test_funding_fetch_exception_leaves_pnl_zero(self) -> None:
        """If the funding_fees fetch raises, positions keep funding_pnl=0
        (covers the outer except — lines 184-191)."""
        fills = [
            _make_fill("buy", 1.0, 100.0, "2024-01-01T00:00:00+00:00"),
            _make_fill("sell", 1.0, 110.0, "2024-01-02T00:00:00+00:00"),
        ]
        mock = _make_trades_funding_mock(
            fills,
            funding_execute_side_effect=RuntimeError("funding unavailable"),
        )
        with patch(
            "services.position_reconstruction.db_execute",
            side_effect=_mock_db_execute,
        ):
            result = await reconstruct_positions("s-1", mock)

        inserted = [row for batch in mock._captured_inserts for row in batch]
        assert len(inserted) == 1
        assert inserted[0]["funding_pnl"] == 0
        assert result["closed_positions"] == 1

    @pytest.mark.asyncio
    async def test_funding_skips_invalid_rows(self) -> None:
        """Rows with missing symbol/timestamp/amount, unparseable timestamps,
        or bad amounts are dropped silently (lines 203, 207, 209-210)."""
        fills = [
            _make_fill("buy", 1.0, 100.0, "2024-01-01T00:00:00+00:00"),
            _make_fill("sell", 1.0, 110.0, "2024-01-03T00:00:00+00:00"),
        ]
        funding_rows = [
            {"symbol": "", "timestamp": "2024-01-02T00:00:00+00:00", "amount": "1"},
            {"symbol": "BTCUSDT", "timestamp": None, "amount": "1"},
            {"symbol": "BTCUSDT", "timestamp": "2024-01-02T00:00:00+00:00", "amount": None},
            {"symbol": "BTCUSDT", "timestamp": "gibberish", "amount": "1"},
            {"symbol": "BTCUSDT", "timestamp": "2024-01-02T00:00:00+00:00", "amount": "not-a-number"},
            # Naive timestamp (no tz suffix) — exercises lines 206-208 (timezone
            # default branch). This one is valid and should land as funding.
            {"symbol": "BTCUSDT", "timestamp": "2024-01-02T12:00:00", "amount": "0.25"},
        ]
        mock = _make_trades_funding_mock(
            fills,
            funding_execute_side_effect=[
                MagicMock(data=funding_rows),
                MagicMock(data=[]),
            ],
        )
        with patch(
            "services.position_reconstruction.db_execute",
            side_effect=_mock_db_execute,
        ):
            await reconstruct_positions("s-1", mock)

        inserted = [row for batch in mock._captured_inserts for row in batch]
        assert len(inserted) == 1
        # Only the naive-timestamp row survived parsing.
        assert inserted[0]["funding_pnl"] == 0.25
