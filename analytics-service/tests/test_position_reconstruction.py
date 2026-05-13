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
    select and accepts DELETE + INSERT (legacy) or the atomic
    rebuild RPC (audit-2026-05-07 G12.C.1/C.2) without error.

    Records every `supabase.rpc(name, payload)` call into
    ``mock.rpc_calls`` (a list of (name, payload) tuples) so tests can
    assert the new atomic-rebuild contract.
    """
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

    # positions.delete().eq().execute() → ok (legacy path; the atomic
    # rebuild fix removes this from the live code path, but the mock
    # still tolerates it so any unrelated test that exercises the old
    # contract does not blow up.)
    mock_table_positions = MagicMock()
    mock_delete = MagicMock()
    mock_delete_eq = MagicMock()
    mock_delete_eq.execute.return_value = MagicMock(data=[])
    mock_delete.eq.return_value = mock_delete_eq
    mock_table_positions.delete.return_value = mock_delete

    # positions.insert().execute() → ok (legacy path, same rationale as above)
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
    mock.table_positions = mock_table_positions

    # supabase.rpc(name, payload).execute() — capture all calls for
    # contract assertions (G12.C.1/C.2 atomic rebuild).
    rpc_calls: list[tuple[str, dict]] = []
    mock.rpc_calls = rpc_calls

    def _rpc(name: str, payload: dict | None = None):
        rpc_calls.append((name, payload))
        rpc_handle = MagicMock()
        rpc_handle.execute.return_value = MagicMock(data=[])
        return rpc_handle

    mock.rpc = _rpc
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

    def test_roi_net_of_fees_classifies_fee_only_loser_as_loser(self) -> None:
        """KPI-17 follow-up regression. The prior ROI formula was
        `(exit-entry)/entry` (gross price change), which classified a
        flat-price + fees-eat-everything position as a winner because
        ROI=0 and the winner test was `roi > 0`. The new formula is
        `realized_pnl / notional` (net return), so the same position
        registers ROI < 0 and is correctly bucketed as a loser. Confirmed
        in production against OKX strategy 07c14340 where 2 closed
        positions had price exit==entry but realized_pnl=-fees."""
        fills = [
            _make_fill(side="buy", price=1991.69, quantity=1.0, fee=11.16,
                       timestamp="2024-01-01T00:00:00+00:00"),
            _make_fill(side="sell", price=1991.69, quantity=1.0, fee=0.0,
                       timestamp="2024-01-01T00:00:01+00:00"),
        ]
        positions = _match_positions_fifo("BTCUSDT", fills, "strat-1")
        assert len(positions) == 1
        pos = positions[0]
        assert pos["realized_pnl"] < 0
        # ROI is now NET of fees -> negative for fee-only-loser position
        assert pos["roi"] < 0

    def test_duration_days_fractional_for_sub_day_holds(self) -> None:
        """KPI-17 follow-up: positions held for hours within a single day
        produce fractional duration_days (round to 4 decimals) instead of
        int-truncating to 0. Migration 092 widened the column from
        INTEGER to NUMERIC."""
        fills = [
            _make_fill(side="buy", price=100.0, quantity=1.0,
                       timestamp="2024-01-01T08:00:00+00:00"),
            _make_fill(side="sell", price=110.0, quantity=1.0,
                       timestamp="2024-01-01T18:00:00+00:00"),  # 10h later
        ]
        positions = _match_positions_fifo("BTCUSDT", fills, "strat-1")
        assert len(positions) == 1
        # 10 hours of 24 = 0.4167 days
        assert abs(positions[0]["duration_days"] - 10 / 24) < 0.001


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


# ---------------------------------------------------------------------------
# Audit-2026-05-07 G12.C.* — regression tests
# ---------------------------------------------------------------------------
# Each test below pins one finding in the FIX-LIST so a future regression
# fails the suite at the expected point.


class TestAtomicRebuildRPC:
    """G12.C.1 / G12.C.2: persistence flips from
    ``positions.delete().insert()`` (PostgREST, no transaction) to a
    SECURITY DEFINER RPC `reconstruct_positions_atomic(uuid, jsonb)`
    (migration 113) that does DELETE+INSERT atomically per-strategy
    under an advisory xact lock."""

    @pytest.mark.asyncio
    async def test_reconstruct_calls_atomic_rebuild_rpc_with_payload(self) -> None:
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
        mock_supabase = _make_mock_supabase(fills=fills)

        with patch("services.position_reconstruction.db_execute", side_effect=_run_sync):
            await reconstruct_positions("strat-1", mock_supabase)

        # Exactly one RPC invocation, with the expected name and payload shape.
        assert len(mock_supabase.rpc_calls) == 1
        name, payload = mock_supabase.rpc_calls[0]
        assert name == "reconstruct_positions_atomic"
        assert payload is not None
        assert payload["p_strategy_id"] == "strat-1"
        assert isinstance(payload["p_positions"], list)
        assert len(payload["p_positions"]) == 1
        # Payload row carries every column the legacy INSERT wrote.
        row = payload["p_positions"][0]
        for col in (
            "strategy_id", "symbol", "side", "status",
            "entry_price_avg", "exit_price_avg", "size_base", "size_peak",
            "realized_pnl", "fee_total", "roi", "duration_days",
            "opened_at", "closed_at", "fill_count", "funding_pnl",
        ):
            assert col in row, f"missing column {col} in atomic-rebuild payload"

    @pytest.mark.asyncio
    async def test_reconstruct_does_not_use_legacy_delete_path(self) -> None:
        """Audit G12.C.1: the legacy ``positions.delete()`` PostgREST
        path is NOT called. All persistence must flow through the RPC."""
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
        mock_supabase = _make_mock_supabase(fills=fills)

        with patch("services.position_reconstruction.db_execute", side_effect=_run_sync):
            await reconstruct_positions("strat-1", mock_supabase)

        # Old path: supabase.table('positions').delete() — must not be called.
        assert not mock_supabase.table_positions.delete.called, (
            "regression: legacy positions.delete() PostgREST path was invoked; "
            "atomic-rebuild RPC must own DELETE+INSERT (G12.C.1)"
        )
        # And no direct positions.insert() either.
        assert not mock_supabase.table_positions.insert.called, (
            "regression: legacy positions.insert() PostgREST path was invoked"
        )


class TestFlipFillFeeProration:
    """G12.C.3: a closing fill that overshoots and flips direction must
    prorate the fill's fee between the closed leg and the new opening
    leg by ``size_used / qty``. The previous code reset
    ``total_fees=0.0`` after recording the closed position, so the new
    leg started with fee_total=0 even though its opening fill paid a fee.
    """

    def test_flip_fill_fee_split_preserves_total(self) -> None:
        """fees(closed) + total_fees(seed of new leg) == fee on the
        flip-fill (prior fees cleanly attributed to the closed leg)."""
        # Open long 1 unit @100, then sell 2 units @110 (closes long,
        # opens short of 1 unit). The sell fee is 1.0 — half should
        # close the long (1/2 ratio), half should seed the short.
        fills = [
            _make_fill(side="buy", price=100.0, quantity=1.0, fee=0.0,
                       timestamp="2024-01-01T00:00:00+00:00"),
            _make_fill(side="sell", price=110.0, quantity=2.0, fee=1.0,
                       timestamp="2024-01-02T00:00:00+00:00"),
        ]
        positions = _match_positions_fifo("BTCUSDT", fills, "strat-1")
        # Two positions: closed long, then open short.
        assert len(positions) == 2
        closed = next(p for p in positions if p["status"] == "closed")
        opened = next(p for p in positions if p["status"] == "open")

        # G12.C.3: closing-fill fee (1.0) is split 50/50 because the
        # 2-unit sell closed 1 unit of long and opened 1 unit of short.
        assert abs(closed["fee_total"] - 0.5) < 1e-9, (
            f"expected closed fee 0.5, got {closed['fee_total']}"
        )
        assert abs(opened["fee_total"] - 0.5) < 1e-9, (
            f"expected opened-leg seed fee 0.5, got {opened['fee_total']}"
        )
        # And the total across both legs equals the original fee on the fill.
        assert abs(closed["fee_total"] + opened["fee_total"] - 1.0) < 1e-9


class TestPosSideAdversarialInjection:
    """G12.C.4: posSide from raw_data is treated as a HINT only — when
    it disagrees with the side-derived direction we PREFER side and
    flag the mismatch. Previously a hostile exchange response could
    flip the published position direction unconditionally."""

    def test_pos_side_conflicts_with_side_prefers_side_and_flags(self) -> None:
        # A 'buy' fill with posSide='short' — pre-fix this opened a
        # short. Post-fix it opens a long and flags the mismatch.
        fills = [
            _make_fill(
                side="buy", price=100.0, quantity=1.0,
                timestamp="2024-01-01T00:00:00+00:00",
                raw_data={"posSide": "short"},
            ),
        ]
        positions = _match_positions_fifo("BTCUSDT", fills, "strat-1")
        assert len(positions) == 1
        pos = positions[0]
        assert pos["side"] == "long", (
            "side-derived direction must win over hostile posSide"
        )
        assert pos.get("data_quality_flags", {}).get("posSide_side_mismatch") is True

    def test_pos_side_garbage_value_is_ignored(self) -> None:
        """G12.C.4: posSide values outside the whitelist are dropped to
        empty so they cannot influence direction at all."""
        fills = [
            _make_fill(
                side="buy", price=100.0, quantity=1.0,
                timestamp="2024-01-01T00:00:00+00:00",
                raw_data={"posSide": "<script>"},
            ),
        ]
        positions = _match_positions_fifo("BTCUSDT", fills, "strat-1")
        assert len(positions) == 1
        # No mismatch flag — posSide was sanitized BEFORE direction
        # determination, so there is no conflict to report.
        assert positions[0]["side"] == "long"
        flags = positions[0].get("data_quality_flags", {}) or {}
        assert flags.get("posSide_side_mismatch") is not True


class TestExitVWAPAcrossClosingFills:
    """G12.C.5: exit_avg must be VWAP across ALL closing fills, not the
    last fill's price. Multi-leg exits (sell 0.3 @99, sell 0.3 @101,
    sell 0.4 @103) must roll up to ~101.2."""

    def test_multi_fill_exit_uses_vwap(self) -> None:
        fills = [
            _make_fill(side="buy", price=100.0, quantity=1.0, fee=0.0,
                       timestamp="2024-01-01T00:00:00+00:00"),
            _make_fill(side="sell", price=99.0, quantity=0.3, fee=0.0,
                       timestamp="2024-01-02T00:00:00+00:00"),
            _make_fill(side="sell", price=101.0, quantity=0.3, fee=0.0,
                       timestamp="2024-01-03T00:00:00+00:00"),
            _make_fill(side="sell", price=103.0, quantity=0.4, fee=0.0,
                       timestamp="2024-01-04T00:00:00+00:00"),
        ]
        positions = _match_positions_fifo("BTCUSDT", fills, "strat-1")
        assert len(positions) == 1
        pos = positions[0]
        # VWAP = (99*0.3 + 101*0.3 + 103*0.4) / 1.0 = 29.7 + 30.3 + 41.2 = 101.2
        assert abs(pos["exit_price_avg"] - 101.2) < 1e-6, (
            f"expected VWAP 101.2, got {pos['exit_price_avg']}"
        )
        # And realized_pnl uses VWAP, not last-fill price (103).
        # entry=100, exit_vwap=101.2, qty=1 → realized_pnl=1.2
        assert abs(pos["realized_pnl"] - 1.2) < 1e-6


class TestSymbolAndExchangeBucketing:
    """G12.C.6: bucket fills by (symbol, exchange) and DROP fills with
    no symbol (don't bucket under 'UNKNOWN')."""

    @pytest.mark.asyncio
    async def test_separate_lifecycles_for_same_symbol_different_exchange(self) -> None:
        """A Binance BTCUSDT trade and an OKX BTCUSDT-SWAP trade must
        produce two independent FIFO lifecycles (or here: two separate
        opens), not be merged into one bucket."""
        fills = [
            {
                "symbol": "BTCUSDT", "exchange": "binance", "side": "buy",
                "price": 100.0, "quantity": 1.0, "fee": 0.0,
                "timestamp": "2024-01-01T00:00:00+00:00",
                "raw_data": {}, "is_fill": True,
            },
            {
                "symbol": "BTCUSDT-SWAP", "exchange": "okx", "side": "buy",
                "price": 100.0, "quantity": 1.0, "fee": 0.0,
                "timestamp": "2024-01-01T00:00:01+00:00",
                "raw_data": {}, "is_fill": True,
            },
        ]
        mock_supabase = _make_mock_supabase(fills=fills)

        with patch("services.position_reconstruction.db_execute", side_effect=_run_sync):
            await reconstruct_positions("strat-1", mock_supabase)

        # Two separate (open) positions in the persisted payload,
        # one per (symbol, exchange) bucket — proves we did NOT merge.
        assert len(mock_supabase.rpc_calls) == 1
        _, payload = mock_supabase.rpc_calls[0]
        rows = payload["p_positions"]
        assert len(rows) == 2, (
            f"expected 2 separate position lifecycles (one per "
            f"(symbol, exchange)), got {len(rows)}"
        )

    @pytest.mark.asyncio
    async def test_symbol_less_fills_dropped_and_flagged(self) -> None:
        """Fills with no `symbol` key are dropped from FIFO matching and
        a `fills_dropped_no_symbol` counter is exposed in the result's
        data_quality_flags so analytics_runner can persist it."""
        fills = [
            {
                "symbol": "", "exchange": "binance", "side": "buy",
                "price": 100.0, "quantity": 1.0, "fee": 0.0,
                "timestamp": "2024-01-01T00:00:00+00:00",
                "raw_data": {"hint": "instId=missing"}, "is_fill": True,
            },
            {
                "symbol": None, "exchange": "binance", "side": "sell",
                "price": 110.0, "quantity": 1.0, "fee": 0.0,
                "timestamp": "2024-01-02T00:00:00+00:00",
                "raw_data": {}, "is_fill": True,
            },
        ]
        mock_supabase = _make_mock_supabase(fills=fills)

        with patch("services.position_reconstruction.db_execute", side_effect=_run_sync):
            result = await reconstruct_positions("strat-1", mock_supabase)

        flags = result.get("data_quality_flags") or {}
        assert flags.get("fills_dropped_no_symbol") == 2, (
            f"expected 2 dropped fills, got flags={flags}"
        )
        # Atomic rebuild was still called (idempotent — empty positions
        # rebuild just wipes any stale rows).
        assert len(mock_supabase.rpc_calls) == 1
        assert mock_supabase.rpc_calls[0][1]["p_positions"] == []


class TestExposureSharedApiKeyGuard:
    """G12.C.7: when two strategies share an api_key_id, position_snapshots
    contains account-level (not strategy-level) exposure. Computing
    exposure_metrics in that case mixes the strategies. The guard
    refuses to compute and surfaces a flag."""

    @pytest.mark.asyncio
    async def test_shared_api_key_skips_exposure_with_flag(self) -> None:
        # Build a mock that:
        #   strategies.select('api_key_id').eq('id', X).limit(1).execute()
        #     -> [{'api_key_id': 'shared-key'}]
        #   strategies.select('id').eq('api_key_id', 'shared-key').execute()
        #     -> [{'id': 'A'}, {'id': 'B'}]   ← shared
        mock = MagicMock()

        # First call (api_key_id lookup): chain ends in .limit(1).execute()
        first_chain_execute = MagicMock(return_value=MagicMock(
            data=[{"api_key_id": "shared-key"}]
        ))
        # Second call (sibling lookup): chain ends in .eq().execute()
        second_chain_execute = MagicMock(return_value=MagicMock(
            data=[{"id": "A"}, {"id": "B"}]
        ))

        # Build a shared select() handle whose .eq() can return either
        # branch depending on whether .limit() is then called.
        select_handle = MagicMock()
        eq_handle = MagicMock()
        # .limit(1).execute() goes to first_chain_execute
        limit_handle = MagicMock()
        limit_handle.execute = first_chain_execute
        eq_handle.limit.return_value = limit_handle
        # .execute() (no .limit) goes to second_chain_execute
        eq_handle.execute = second_chain_execute
        select_handle.eq.return_value = eq_handle

        strategies_table = MagicMock()
        strategies_table.select.return_value = select_handle

        def _table(name: str):
            if name == "strategies":
                return strategies_table
            return MagicMock()

        mock.table = _table

        with patch("services.position_reconstruction.db_execute", side_effect=_run_sync):
            result = await compute_exposure_metrics("strat-A", mock)

        # When shared, computation is REFUSED — only the flag is returned.
        assert "mean_gross_exposure" not in result
        assert (
            result.get("data_quality_flags", {}).get(
                "exposure_metrics_skipped_shared_api_key"
            ) is True
        )


class TestDurationSecondsWritten:
    """G12.C.9 (paired with D.3): position duration_seconds is written
    alongside duration_days. A 23h59m position has duration_days=0
    (legacy INTEGER column) but duration_seconds=86340 — preserves
    sub-day granularity for downstream consumers."""

    def test_duration_seconds_for_sub_day_hold(self) -> None:
        # 23h59m hold (86340 seconds, 0 calendar days when truncated)
        fills = [
            _make_fill(side="buy", price=100.0, quantity=1.0,
                       timestamp="2024-01-01T00:00:00+00:00"),
            _make_fill(side="sell", price=110.0, quantity=1.0,
                       timestamp="2024-01-01T23:59:00+00:00"),
        ]
        positions = _match_positions_fifo("BTCUSDT", fills, "strat-1")
        assert len(positions) == 1
        pos = positions[0]
        # int-truncated days: floor(86340/86400) == 0
        assert int(pos["duration_days"]) == 0
        # but sub-day-aware seconds preserved
        assert pos["duration_seconds"] == 86340

    @pytest.mark.asyncio
    async def test_duration_seconds_in_atomic_rebuild_payload(self) -> None:
        """Persistence path also includes duration_seconds (column added
        by migration 114; the JSONB→column projection in the 113 RPC
        ignores keys not in its column list, so it's safe to write
        before 114 lands)."""
        fills = [
            {
                "symbol": "BTCUSDT", "exchange": "binance", "side": "buy",
                "price": 100.0, "quantity": 1.0, "fee": 0.0,
                "timestamp": "2024-01-01T00:00:00+00:00",
                "raw_data": {}, "is_fill": True,
            },
            {
                "symbol": "BTCUSDT", "exchange": "binance", "side": "sell",
                "price": 110.0, "quantity": 1.0, "fee": 0.0,
                "timestamp": "2024-01-01T23:59:00+00:00",
                "raw_data": {}, "is_fill": True,
            },
        ]
        mock_supabase = _make_mock_supabase(fills=fills)
        with patch("services.position_reconstruction.db_execute", side_effect=_run_sync):
            await reconstruct_positions("strat-1", mock_supabase)
        rows = mock_supabase.rpc_calls[0][1]["p_positions"]
        assert len(rows) == 1
        assert rows[0]["duration_seconds"] == 86340
        # And data_quality_flags is NOT in the DB payload (transient key
        # is stripped before sending to the RPC, since positions table
        # has no such column).
        assert "data_quality_flags" not in rows[0]


# ---------------------------------------------------------------------------
# Audit-2026-05-07 round-2 / Block A — P1994
# ---------------------------------------------------------------------------
# avg_winning_trade / avg_losing_trade contract change: bucket by sign of
# `realized_pnl` (dollars) instead of `roi` (ratio); sum dollars instead of
# ratios; surface breakeven positions and None-PnL closed positions in
# data_quality_flags rather than silently bucketing them as losers via the
# `roi or 0 <= 0` path. See PLAN-ROUND-2-CRITICAL.md Task A.1.


class TestAvgWinningLosingTradeDollars:
    """P1994: avg_winning_trade / avg_losing_trade must be DOLLAR sums of
    `realized_pnl`, not averages of `roi` ratios.

    Four compounding bugs in the prior code:
      1) Sums ratios where _compute_derived_trade_metrics expects dollars
         (R:R, expectancy, SQN all keyed off these values).
      2) `roi <= 0` lumped breakevens (roi=0) into the losers bucket.
      3) `(p.get("roi") or 0) > 0` / <= 0 coerced roi=None silently into
         the losers bucket instead of flagging the missing-data case.
      4) `realized_pnl_per_trade` used `float(p.get("realized_pnl") or 0.0)`,
         emitting phantom-zero breakeven rows whenever realized_pnl was None.
    """

    @pytest.mark.asyncio
    async def test_avg_winning_trade_is_dollar_sum_not_roi_ratio(self) -> None:
        """Two winners with realized_pnl=+$500 and +$200 → avg_winning_trade
        must be 350.0 (dollar mean), NOT a ratio like 0.45."""
        # First trade: buy 1@100, sell 1@600 → realized_pnl=+500, roi=5.0
        # Second trade: buy 1@100, sell 1@300 → realized_pnl=+200, roi=2.0
        # If avg_winning_trade averaged ROIs, we'd see ~3.5. If it sums
        # dollars and divides by count, we'd see 350.0.
        fills = [
            {
                "symbol": "BTCUSDT", "side": "buy",
                "price": 100.0, "quantity": 1.0, "fee": 0.0,
                "timestamp": "2024-01-01T00:00:00+00:00",
                "raw_data": {}, "is_fill": True,
            },
            {
                "symbol": "BTCUSDT", "side": "sell",
                "price": 600.0, "quantity": 1.0, "fee": 0.0,
                "timestamp": "2024-01-02T00:00:00+00:00",
                "raw_data": {}, "is_fill": True,
            },
            {
                "symbol": "BTCUSDT", "side": "buy",
                "price": 100.0, "quantity": 1.0, "fee": 0.0,
                "timestamp": "2024-01-03T00:00:00+00:00",
                "raw_data": {}, "is_fill": True,
            },
            {
                "symbol": "BTCUSDT", "side": "sell",
                "price": 300.0, "quantity": 1.0, "fee": 0.0,
                "timestamp": "2024-01-04T00:00:00+00:00",
                "raw_data": {}, "is_fill": True,
            },
        ]
        mock_supabase = _make_mock_supabase(fills=fills)

        with patch("services.position_reconstruction.db_execute", side_effect=_run_sync):
            result = await reconstruct_positions("strat-1", mock_supabase)

        assert result["winners_count"] == 2
        assert result["losers_count"] == 0
        # Dollar mean: (500 + 200) / 2 = 350.0. NOT a ratio mean (~3.5).
        assert abs(result["avg_winning_trade"] - 350.0) < 1e-4, (
            f"expected dollar mean 350.0, got {result['avg_winning_trade']} "
            f"(if ~3.5, you're still averaging ROI ratios)"
        )

    @pytest.mark.asyncio
    async def test_breakeven_position_excluded_from_winners_and_losers(self) -> None:
        """A position with realized_pnl=0.0 (exit==entry, no fees) is a
        BREAKEVEN — not a winner, not a loser. The pre-fix code's
        `roi <= 0` bucketing lumped breakevens into losers, polluting
        avg_losing_trade with zeros and depressing the average.

        Post-fix: breakevens are excluded from both buckets and counted
        in data_quality_flags['breakeven_positions'] for surfacing."""
        # One winner ($100), one breakeven (0), one loser (-$50).
        # Patch _match_positions_fifo to return crafted positions so we
        # can hit the bucketing logic deterministically without depending
        # on FIFO arithmetic.
        crafted_positions = [
            {
                "strategy_id": "strat-1", "symbol": "BTCUSDT",
                "side": "long", "status": "closed",
                "entry_price_avg": 100.0, "exit_price_avg": 200.0,
                "size_base": 1.0, "size_peak": 1.0,
                "realized_pnl": 100.0, "fee_total": 0.0, "roi": 1.0,
                "duration_days": 1.0, "duration_seconds": 86400,
                "opened_at": "2024-01-01T00:00:00+00:00",
                "closed_at": "2024-01-02T00:00:00+00:00",
                "fill_count": 2, "funding_pnl": 0,
            },
            {
                "strategy_id": "strat-1", "symbol": "ETHUSDT",
                "side": "long", "status": "closed",
                "entry_price_avg": 100.0, "exit_price_avg": 100.0,
                "size_base": 1.0, "size_peak": 1.0,
                "realized_pnl": 0.0, "fee_total": 0.0, "roi": 0.0,
                "duration_days": 1.0, "duration_seconds": 86400,
                "opened_at": "2024-01-01T00:00:00+00:00",
                "closed_at": "2024-01-02T00:00:00+00:00",
                "fill_count": 2, "funding_pnl": 0,
            },
            {
                "strategy_id": "strat-1", "symbol": "SOLUSDT",
                "side": "long", "status": "closed",
                "entry_price_avg": 100.0, "exit_price_avg": 50.0,
                "size_base": 1.0, "size_peak": 1.0,
                "realized_pnl": -50.0, "fee_total": 0.0, "roi": -0.5,
                "duration_days": 1.0, "duration_seconds": 86400,
                "opened_at": "2024-01-01T00:00:00+00:00",
                "closed_at": "2024-01-02T00:00:00+00:00",
                "fill_count": 2, "funding_pnl": 0,
            },
        ]
        # Supabase just needs SOMETHING in fills to enter the loop.
        fills = [
            {
                "symbol": "BTCUSDT", "side": "buy",
                "price": 100.0, "quantity": 1.0, "fee": 0.0,
                "timestamp": "2024-01-01T00:00:00+00:00",
                "raw_data": {}, "is_fill": True,
            },
        ]
        mock_supabase = _make_mock_supabase(fills=fills)

        with patch(
            "services.position_reconstruction.db_execute",
            side_effect=_run_sync,
        ), patch(
            "services.position_reconstruction._match_positions_fifo",
            return_value=crafted_positions,
        ):
            result = await reconstruct_positions("strat-1", mock_supabase)

        assert result["winners_count"] == 1
        assert result["losers_count"] == 1
        # Win rate denominator excludes the breakeven (1 of 2, not 1 of 3).
        assert abs(result["win_rate"] - 0.5) < 1e-9, (
            f"expected win_rate 0.5 (1 winner / 2 decided), got {result['win_rate']}"
        )
        # avg_winning_trade = $100 (sum of winner dollars / 1).
        assert abs(result["avg_winning_trade"] - 100.0) < 1e-6
        # avg_losing_trade = -$50 (loser-only — breakeven NOT included).
        assert abs(result["avg_losing_trade"] - (-50.0)) < 1e-6
        flags = result.get("data_quality_flags") or {}
        assert flags.get("breakeven_positions") == 1, (
            f"breakeven position must surface in data_quality_flags, got {flags}"
        )

    @pytest.mark.asyncio
    async def test_closed_position_missing_realized_pnl_is_surfaced(self) -> None:
        """A closed position with realized_pnl=None / roi=None is a data
        integrity hole — surfacing it as `positions_missing_realized_pnl`
        is correct. The pre-fix `or 0` coalescing silently bucketed it
        into losers (because 0 <= 0) and added a phantom breakeven row
        to realized_pnl_per_trade."""
        crafted_positions = [
            # Real winner so the metrics dict has populated buckets too.
            {
                "strategy_id": "strat-1", "symbol": "BTCUSDT",
                "side": "long", "status": "closed",
                "entry_price_avg": 100.0, "exit_price_avg": 110.0,
                "size_base": 1.0, "size_peak": 1.0,
                "realized_pnl": 10.0, "fee_total": 0.0, "roi": 0.1,
                "duration_days": 1.0, "duration_seconds": 86400,
                "opened_at": "2024-01-01T00:00:00+00:00",
                "closed_at": "2024-01-02T00:00:00+00:00",
                "fill_count": 2, "funding_pnl": 0,
            },
            # Closed but missing realized_pnl / roi (a data integrity hole).
            {
                "strategy_id": "strat-1", "symbol": "ETHUSDT",
                "side": "long", "status": "closed",
                "entry_price_avg": 100.0, "exit_price_avg": None,
                "size_base": 1.0, "size_peak": 1.0,
                "realized_pnl": None, "fee_total": 0.0, "roi": None,
                "duration_days": 1.0, "duration_seconds": 86400,
                "opened_at": "2024-01-01T00:00:00+00:00",
                "closed_at": "2024-01-02T00:00:00+00:00",
                "fill_count": 2, "funding_pnl": 0,
            },
        ]
        fills = [
            {
                "symbol": "BTCUSDT", "side": "buy",
                "price": 100.0, "quantity": 1.0, "fee": 0.0,
                "timestamp": "2024-01-01T00:00:00+00:00",
                "raw_data": {}, "is_fill": True,
            },
        ]
        mock_supabase = _make_mock_supabase(fills=fills)

        with patch(
            "services.position_reconstruction.db_execute",
            side_effect=_run_sync,
        ), patch(
            "services.position_reconstruction._match_positions_fifo",
            return_value=crafted_positions,
        ):
            result = await reconstruct_positions("strat-1", mock_supabase)

        # Missing-PnL row must NOT have been bucketed as a loser via `or 0`.
        assert result["winners_count"] == 1
        assert result["losers_count"] == 0
        flags = result.get("data_quality_flags") or {}
        assert flags.get("positions_missing_realized_pnl") == 1, (
            f"closed position with None realized_pnl must surface in "
            f"data_quality_flags['positions_missing_realized_pnl'], got {flags}"
        )
        # And realized_pnl_per_trade must NOT phantom-coerce the None to 0.0.
        rpt = result["realized_pnl_per_trade"]
        assert len(rpt) == 2
        # Find the ETHUSDT row (the missing one) — its realized_pnl must
        # be None, not 0.0 (which would be a phantom breakeven).
        # Note: realized_pnl_per_trade rows only contain `side` and
        # `realized_pnl`. The order matches `closed` (the BTC winner first,
        # ETH missing-pnl second).
        assert rpt[0]["realized_pnl"] == 10.0
        assert rpt[1]["realized_pnl"] is None, (
            f"missing-PnL position should emit None, not phantom 0.0; got "
            f"{rpt[1]['realized_pnl']}"
        )


# ---------------------------------------------------------------------------
# Audit-2026-05-07 round-2 / Block A — P1995
# ---------------------------------------------------------------------------
# compute_turnover_series sparse-day fix:
#   1) First observed date must NOT emit a phantom turnover spike (pre-fix
#      it treated the opening position as a same-day rotation against
#      prev_positions={}).
#   2) When sorted dates skip more than one day (sparse calendar), the
#      post-gap row divides a multi-day position delta by a single-day NAV,
#      inflating turnover. The new `_with_flags` helper surfaces those
#      dates via `data_quality_flags['turnover_gap_dates']`.


class TestComputeTurnoverSeries:
    """P1995: first-day exclusion + sparse-gap flagging."""

    def test_first_day_phantom_excluded_when_opening_position(self) -> None:
        """Day 0 has a non-zero opening position; day 1 unchanged. Pre-fix
        day 0 emitted turnover = (position * price) / nav (phantom spike,
        because prev_positions={} treated the entire opening as a same-day
        rotation). Post-fix: day 0 is either absent OR turnover=0.0."""
        positions_by_date = {
            "2025-01-01": {"BTC": 10.0},
            "2025-01-02": {"BTC": 10.0},
        }
        prices_by_date = {
            "2025-01-01": {"BTC": 1000.0},
            "2025-01-02": {"BTC": 1000.0},
        }
        nav_by_date = {
            "2025-01-01": 10000.0,
            "2025-01-02": 10000.0,
        }
        series = compute_turnover_series(
            positions_by_date, prices_by_date, nav_by_date
        )
        days = {p["date"]: p["turnover"] for p in series}
        # Spec: first observed date EITHER absent OR turnover==0.0.
        first = days.get("2025-01-01")
        assert first is None or abs(first - 0.0) < 1e-9, (
            f"first-day phantom: expected absent or 0.0, got {first}. "
            f"Pre-fix this was 1.0 (10*1000/10000) — the entire opening "
            f"position treated as a same-day rotation against prev={{}}."
        )
        # Day 2 should still be 0 (no change between day 1 and day 2).
        assert "2025-01-02" in days
        assert abs(days["2025-01-02"] - 0.0) < 1e-9

    def test_sparse_calendar_gap_dates_surfaced_in_flags(self) -> None:
        """A 7-day skip from Mon 2025-01-06 to Mon 2025-01-13 with a
        position change in between must surface the post-gap date in
        `data_quality_flags['turnover_gap_dates']`. Pre-fix the 7-day
        delta was divided by single-day NAV with no warning."""
        from services.position_reconstruction import (
            compute_turnover_series_with_flags,
        )

        positions_by_date = {
            "2025-01-06": {"BTC": 1.0},  # Monday
            "2025-01-13": {"BTC": 2.0},  # following Monday — 7-day skip
        }
        prices_by_date = {
            "2025-01-06": {"BTC": 100.0},
            "2025-01-13": {"BTC": 100.0},
        }
        nav_by_date = {
            "2025-01-06": 10000.0,
            "2025-01-13": 10000.0,
        }
        series, flags = compute_turnover_series_with_flags(
            positions_by_date, prices_by_date, nav_by_date
        )
        # The 7-day skip post-gap date must surface in flags.
        gap_dates = flags.get("turnover_gap_dates") or []
        assert "2025-01-13" in gap_dates, (
            f"expected 2025-01-13 (post-gap row) in turnover_gap_dates; "
            f"got flags={flags}"
        )
        # And the plain helper still returns a bare list (no flags) so
        # existing callers don't have to change.
        plain_series = compute_turnover_series(
            positions_by_date, prices_by_date, nav_by_date
        )
        assert isinstance(plain_series, list)
        assert all(isinstance(p, dict) for p in plain_series)
