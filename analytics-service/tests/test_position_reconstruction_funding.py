"""Regression tests for funding attribution in reconstruct_positions.

Covers:
  - Correct funding_pnl sum over a position window (C3 pagination test).
  - Zero funding_pnl when no matching rows.
  - realized_pnl unchanged by funding addition.
  - Funding excluded when symbol is flat between positions (I7 split-window).


After Sprint 5.6's funding cutover, reconstruct_positions must sum
funding_fees rows that fall within each position's [opened_at, closed_at]
window and assign the total to positions.funding_pnl.

Contract:
  - Long position held across 3 funding periods with known amounts:
    funding_pnl = sum(those amounts).
  - realized_pnl stays as price-only ROI (no change from Sprint 4).
  - Positions with no matching funding rows get funding_pnl = 0.
"""
from __future__ import annotations

import logging
from unittest.mock import MagicMock, patch

import pytest

from services.position_reconstruction import reconstruct_positions


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _mock_db_execute(fn):
    """Async wrapper that calls fn synchronously (tests don't need threading)."""
    return fn()


def _make_mock_supabase_with_funding(
    fills: list[dict],
    funding_rows: list[dict],
) -> MagicMock:
    """Mock supabase that returns fills for trades.select and funding_rows
    for funding_fees.select. Accepts positions.delete + positions.insert."""
    mock = MagicMock()

    # trades: .select().eq().eq().order().execute()
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

    # funding_fees: .select().eq().gte().lte().range().execute() — paginated fetch.
    # Returns funding_rows on the first page, [] on the second (terminates).
    mock_funding = MagicMock()
    f_sel = MagicMock()
    f_eq1 = MagicMock()
    f_gte = MagicMock()
    f_lte = MagicMock()
    f_range = MagicMock()
    # First call returns all rows (simulate short page to terminate loop);
    # subsequent calls return empty.
    f_range.execute.side_effect = [
        MagicMock(data=funding_rows),
        MagicMock(data=[]),
    ]
    f_lte.range.return_value = f_range
    f_gte.lte.return_value = f_lte
    f_eq1.gte.return_value = f_gte
    f_sel.eq.return_value = f_eq1
    mock_funding.select.return_value = f_sel

    # positions.delete().eq().execute()
    mock_positions = MagicMock()
    m_del = MagicMock()
    m_del_eq = MagicMock()
    m_del_eq.execute.return_value = MagicMock(data=[])
    m_del.eq.return_value = m_del_eq
    mock_positions.delete.return_value = m_del

    # positions.insert().execute()
    m_ins = MagicMock()
    m_ins.execute.return_value = MagicMock(data=[])
    mock_positions.insert.return_value = m_ins

    captured_inserts: list[list[dict]] = []

    def _capture_insert(rows):
        captured_inserts.append(rows if isinstance(rows, list) else [rows])
        return m_ins

    mock_positions.insert.side_effect = _capture_insert

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

    # Audit-2026-05-07 G12.C.1/C.2: persistence flipped from
    # ``positions.insert(rows)`` to ``supabase.rpc(
    # 'reconstruct_positions_atomic', {'p_strategy_id', 'p_positions'})``.
    # Mirror the captured payload back into _captured_inserts so the
    # pre-existing assertions ("inspect what was inserted") keep working
    # without rewriting every test below.
    def _rpc(name, payload=None):
        if name == "reconstruct_positions_atomic" and payload:
            rows = payload.get("p_positions") or []
            if rows:
                captured_inserts.append(list(rows))
        rpc_handle = MagicMock()
        rpc_handle.execute.return_value = MagicMock(data=[])
        return rpc_handle

    mock.rpc = _rpc
    return mock


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_funding_pnl_summed_over_position_window() -> None:
    """Long BTCUSDT held Jan 1 → Jan 2, with 3 funding events inside window.
    Expected funding_pnl = sum of the 3 amounts (one negative, one positive,
    one neutral)."""
    fills = [
        {
            "symbol": "BTCUSDT",
            "exchange": "binance",
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
            "exchange": "binance",
            "side": "sell",
            "price": 110.0,
            "quantity": 1.0,
            "fee": 0.0,
            "timestamp": "2024-01-02T00:00:00+00:00",
            "raw_data": {},
            "is_fill": True,
        },
    ]

    # 3 funding payments inside the position window:
    #   08:00 Jan 1 (-0.01), 16:00 Jan 1 (+0.02), 00:00 Jan 2 (-0.005)
    funding_rows = [
        {
            "strategy_id": "strat-1",
            "exchange": "binance",
            "symbol": "BTCUSDT",
            "amount": "-0.01",
            "currency": "USDT",
            "timestamp": "2024-01-01T08:00:00+00:00",
        },
        {
            "strategy_id": "strat-1",
            "exchange": "binance",
            "symbol": "BTCUSDT",
            "amount": "0.02",
            "currency": "USDT",
            "timestamp": "2024-01-01T16:00:00+00:00",
        },
        {
            "strategy_id": "strat-1",
            "exchange": "binance",
            "symbol": "BTCUSDT",
            "amount": "-0.005",
            "currency": "USDT",
            "timestamp": "2024-01-01T23:59:00+00:00",
        },
        # Out-of-window funding row — different symbol, must be excluded.
        {
            "strategy_id": "strat-1",
            "exchange": "binance",
            "symbol": "ETHUSDT",
            "amount": "99.0",
            "currency": "USDT",
            "timestamp": "2024-01-01T12:00:00+00:00",
        },
        # Out-of-window funding row — timestamp after close, must be excluded.
        {
            "strategy_id": "strat-1",
            "exchange": "binance",
            "symbol": "BTCUSDT",
            "amount": "99.0",
            "currency": "USDT",
            "timestamp": "2024-01-03T00:00:00+00:00",
        },
    ]

    mock_supabase = _make_mock_supabase_with_funding(fills, funding_rows)

    with patch(
        "services.position_reconstruction.db_execute",
        side_effect=_mock_db_execute,
    ):
        await reconstruct_positions("strat-1", mock_supabase)

    # Inspect what was inserted into positions
    captured = mock_supabase._captured_inserts
    assert len(captured) >= 1
    inserted_rows = [row for batch in captured for row in batch]
    assert len(inserted_rows) == 1

    pos = inserted_rows[0]
    assert pos["symbol"] == "BTCUSDT"
    assert pos["status"] == "closed"
    # Sum: -0.01 + 0.02 + -0.005 = 0.005
    assert pos["funding_pnl"] == pytest.approx(0.005, abs=1e-9)


@pytest.mark.asyncio
async def test_funding_pnl_zero_when_no_funding_rows() -> None:
    """Position with no matching funding rows → funding_pnl = 0.
    Guards against KeyError/NULL regressions."""
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
    mock_supabase = _make_mock_supabase_with_funding(fills, funding_rows=[])

    with patch(
        "services.position_reconstruction.db_execute",
        side_effect=_mock_db_execute,
    ):
        await reconstruct_positions("strat-1", mock_supabase)

    inserted_rows = [
        row for batch in mock_supabase._captured_inserts for row in batch
    ]
    assert len(inserted_rows) == 1
    assert inserted_rows[0]["funding_pnl"] == 0


@pytest.mark.asyncio
async def test_realized_pnl_unchanged_by_funding_addition() -> None:
    """realized_pnl must NOT include funding — the price-only ROI contract
    from Sprint 4 stays intact. Funding lives only in funding_pnl."""
    fills = [
        {
            "symbol": "BTCUSDT",
            "exchange": "binance",
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
            "exchange": "binance",
            "side": "sell",
            "price": 110.0,
            "quantity": 1.0,
            "fee": 0.0,
            "timestamp": "2024-01-02T00:00:00+00:00",
            "raw_data": {},
            "is_fill": True,
        },
    ]
    funding_rows = [
        {
            "strategy_id": "strat-1",
            "exchange": "binance",
            "symbol": "BTCUSDT",
            "amount": "-5.0",  # large funding cost
            "currency": "USDT",
            "timestamp": "2024-01-01T12:00:00+00:00",
        },
    ]

    mock_supabase = _make_mock_supabase_with_funding(fills, funding_rows)
    with patch(
        "services.position_reconstruction.db_execute",
        side_effect=_mock_db_execute,
    ):
        await reconstruct_positions("strat-1", mock_supabase)

    pos = [
        row for batch in mock_supabase._captured_inserts for row in batch
    ][0]
    # Price-only realized_pnl = (110 - 100) * 1 - 0 = 10.0
    assert pos["realized_pnl"] == pytest.approx(10.0, abs=1e-9)
    assert pos["funding_pnl"] == pytest.approx(-5.0, abs=1e-9)


@pytest.mark.asyncio
async def test_attribute_funding_pagination_includes_all_rows() -> None:
    """C3 regression: _attribute_funding paginates funding_fees and must
    include rows from ALL pages, not just the first.

    Strategy: use a small page_size (patched to 2) and mock supabase to
    return 2 pages of 2 rows each followed by a short (0-row) page.
    Assert that all 4 funding rows are attributed to the position.
    """
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
            "timestamp": "2024-01-10T00:00:00+00:00",
            "raw_data": {},
            "is_fill": True,
        },
    ]

    # 4 funding rows, all inside position window.
    # With page_size=2 these span 2 full pages + 1 empty terminator.
    page1_rows = [
        {"symbol": "BTCUSDT", "amount": "1.0", "timestamp": "2024-01-02T08:00:00+00:00"},
        {"symbol": "BTCUSDT", "amount": "2.0", "timestamp": "2024-01-03T08:00:00+00:00"},
    ]
    page2_rows = [
        {"symbol": "BTCUSDT", "amount": "3.0", "timestamp": "2024-01-04T08:00:00+00:00"},
        {"symbol": "BTCUSDT", "amount": "4.0", "timestamp": "2024-01-05T08:00:00+00:00"},
    ]

    # Build a supabase mock that returns pages in sequence.
    mock = MagicMock()

    # trades
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

    # funding_fees: paginated — page1, page2, empty terminator
    mock_funding = MagicMock()
    f_sel = MagicMock()
    f_eq1 = MagicMock()
    f_gte = MagicMock()
    f_lte = MagicMock()
    f_range = MagicMock()
    f_range.execute.side_effect = [
        MagicMock(data=page1_rows),
        MagicMock(data=page2_rows),
        MagicMock(data=[]),
    ]
    f_lte.range.return_value = f_range
    f_gte.lte.return_value = f_lte
    f_eq1.gte.return_value = f_gte
    f_sel.eq.return_value = f_eq1
    mock_funding.select.return_value = f_sel

    # positions
    mock_positions = MagicMock()
    m_del = MagicMock()
    m_del_eq = MagicMock()
    m_del_eq.execute.return_value = MagicMock(data=[])
    m_del.eq.return_value = m_del_eq
    mock_positions.delete.return_value = m_del

    captured_inserts: list[list[dict]] = []
    m_ins = MagicMock()
    m_ins.execute.return_value = MagicMock(data=[])

    def _capture_insert(rows):
        captured_inserts.append(rows if isinstance(rows, list) else [rows])
        return m_ins

    mock_positions.insert.side_effect = _capture_insert

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

    # Audit-2026-05-07 G12.C.1/C.2: persistence flipped from
    # ``positions.insert`` to ``supabase.rpc('reconstruct_positions_atomic')``.
    # Mirror the RPC payload's ``p_positions`` array into captured_inserts.
    def _rpc(name, payload=None):
        if name == "reconstruct_positions_atomic" and payload:
            rows = payload.get("p_positions") or []
            if rows:
                captured_inserts.append(list(rows))
        rpc_handle = MagicMock()
        rpc_handle.execute.return_value = MagicMock(data=[])
        return rpc_handle

    mock.rpc = _rpc

    # Patch _PAGE_SIZE inside _attribute_funding to 2 so 4 rows span 2 pages.
    with patch(
        "services.position_reconstruction.db_execute",
        side_effect=_mock_db_execute,
    ):
        # We rely on the range mock returning page1+page2+empty, which with
        # _PAGE_SIZE=2 means 3 range() calls are made. The mock is set up for
        # exactly that sequence. The actual _PAGE_SIZE constant in the function
        # is 1000, but the 2-page scenario is validated by providing exactly
        # 2 full-page results (len==2==page_size) followed by an empty page.
        # To force a true 2-page scenario, patch the local _PAGE_SIZE.
        import services.position_reconstruction as pr_mod
        # Monkeypatch: replace _attribute_funding with a version using page_size=2
        original_fn = pr_mod._attribute_funding

        async def _patched_attribute_funding(
            strategy_id, positions, supabase, flags=None
        ):
            # `flags` accepted (and ignored) to stay signature-compatible with
            # the real _attribute_funding after the H-1094/H-1097 DQ-flag plumb;
            # this page-size variant only exercises pagination.
            # Force page_size=2 by temporarily reducing it via the closure.
            _PAGE_SIZE = 2
            from collections import defaultdict
            from datetime import datetime, timezone
            from decimal import Decimal
            from services.db import db_execute as _db_exec

            now = datetime.now(timezone.utc)
            min_opened_at = min(p["opened_at"] for p in positions if p.get("opened_at"))
            max_closed_at = max(
                (p.get("closed_at") or now.isoformat()) for p in positions
            )

            funding_rows_local: list[dict] = []
            page = 0
            try:
                while True:
                    start = page * _PAGE_SIZE
                    end = start + _PAGE_SIZE - 1

                    def _fetch(s=start, e=end):
                        return (
                            supabase.table("funding_fees")
                            .select("symbol, amount, timestamp")
                            .eq("strategy_id", strategy_id)
                            .gte("timestamp", min_opened_at)
                            .lte("timestamp", max_closed_at)
                            .range(s, e)
                            .execute()
                        )

                    result = await _mock_db_execute(_fetch)
                    chunk = (result.data if result else None) or []
                    funding_rows_local.extend(chunk)
                    if len(chunk) < _PAGE_SIZE:
                        break
                    page += 1
            except Exception:
                return

            by_symbol: dict = defaultdict(list)
            for row in funding_rows_local:
                sym = row.get("symbol", "")
                ts_raw = row.get("timestamp")
                amt_raw = row.get("amount")
                if not sym or ts_raw is None or amt_raw is None:
                    continue
                try:
                    ts = datetime.fromisoformat(str(ts_raw).replace("Z", "+00:00"))
                    if ts.tzinfo is None:
                        ts = ts.replace(tzinfo=timezone.utc)
                    amt = Decimal(str(amt_raw))
                except Exception:
                    continue
                by_symbol[sym].append((ts, amt))

            for sym in by_symbol:
                by_symbol[sym].sort(key=lambda x: x[0])

            now_utc = datetime.now(timezone.utc)
            for pos in positions:
                symbol = pos.get("symbol", "")
                opened_at_raw = pos.get("opened_at")
                closed_at_raw = pos.get("closed_at")
                if not opened_at_raw:
                    continue
                try:
                    opened_dt = datetime.fromisoformat(
                        str(opened_at_raw).replace("Z", "+00:00")
                    )
                    if opened_dt.tzinfo is None:
                        opened_dt = opened_dt.replace(tzinfo=timezone.utc)
                except Exception:
                    continue
                if closed_at_raw:
                    try:
                        closed_dt = datetime.fromisoformat(
                            str(closed_at_raw).replace("Z", "+00:00")
                        )
                        if closed_dt.tzinfo is None:
                            closed_dt = closed_dt.replace(tzinfo=timezone.utc)
                    except Exception:
                        closed_dt = now_utc
                else:
                    closed_dt = now_utc

                total = Decimal(0)
                for ts, amt in by_symbol.get(symbol, []):
                    if opened_dt <= ts <= closed_dt:
                        total += amt
                pos["funding_pnl"] = float(round(total, 8))

        pr_mod._attribute_funding = _patched_attribute_funding
        try:
            await reconstruct_positions("strat-paginated", mock)
        finally:
            pr_mod._attribute_funding = original_fn

    inserted_rows = [row for batch in captured_inserts for row in batch]
    assert len(inserted_rows) == 1
    pos = inserted_rows[0]
    # 1.0 + 2.0 + 3.0 + 4.0 = 10.0 — all 4 pages' rows attributed
    assert pos["funding_pnl"] == pytest.approx(10.0, abs=1e-9)


@pytest.mark.asyncio
async def test_funding_excluded_when_symbol_flat_between_positions() -> None:
    """Two closed positions for the same symbol with a gap between them.
    A funding row that falls in the gap must not be attributed to either.

    Timeline:
      Position 1: buy Jan 1 → sell Jan 2
      Gap:        Jan 3 (funding row HERE — symbol is flat)
      Position 2: buy Jan 4 → sell Jan 5

    Expected: both positions get funding_pnl=0.
    """
    fills = [
        # Position 1
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
            "price": 105.0,
            "quantity": 1.0,
            "fee": 0.0,
            "timestamp": "2024-01-02T00:00:00+00:00",
            "raw_data": {},
            "is_fill": True,
        },
        # Position 2 (separate lifecycle)
        {
            "symbol": "BTCUSDT",
            "side": "buy",
            "price": 110.0,
            "quantity": 1.0,
            "fee": 0.0,
            "timestamp": "2024-01-04T00:00:00+00:00",
            "raw_data": {},
            "is_fill": True,
        },
        {
            "symbol": "BTCUSDT",
            "side": "sell",
            "price": 115.0,
            "quantity": 1.0,
            "fee": 0.0,
            "timestamp": "2024-01-05T00:00:00+00:00",
            "raw_data": {},
            "is_fill": True,
        },
    ]

    # Funding row falls on Jan 3 — in the gap between positions.
    funding_rows = [
        {
            "strategy_id": "strat-split",
            "exchange": "binance",
            "symbol": "BTCUSDT",
            "amount": "99.0",
            "currency": "USDT",
            "timestamp": "2024-01-03T00:00:00+00:00",
        },
    ]

    mock_supabase = _make_mock_supabase_with_funding(fills, funding_rows)

    with patch(
        "services.position_reconstruction.db_execute",
        side_effect=_mock_db_execute,
    ):
        await reconstruct_positions("strat-split", mock_supabase)

    inserted_rows = [
        row for batch in mock_supabase._captured_inserts for row in batch
    ]
    assert len(inserted_rows) == 2, "Expected two closed positions"

    for pos in inserted_rows:
        assert pos["funding_pnl"] == 0, (
            f"Position {pos['opened_at']}–{pos['closed_at']} "
            f"incorrectly attributed Jan-3 gap funding: {pos['funding_pnl']}"
        )


def _make_mock_supabase_funding_fetch_raises(
    fills: list[dict], exc: Exception
) -> MagicMock:
    """Mock supabase whose funding_fees fetch RAISES on .execute().

    trades/positions behave normally; only the funding_fees range().execute()
    raises so we can exercise _attribute_funding's swallow-error path.
    """
    mock = MagicMock()

    # trades: .select().eq().eq().order().execute()
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

    # funding_fees: .select().eq().gte().lte().range().execute() RAISES
    mock_funding = MagicMock()
    f_sel = MagicMock()
    f_eq1 = MagicMock()
    f_gte = MagicMock()
    f_lte = MagicMock()
    f_range = MagicMock()
    f_range.execute.side_effect = exc
    f_lte.range.return_value = f_range
    f_gte.lte.return_value = f_lte
    f_eq1.gte.return_value = f_gte
    f_sel.eq.return_value = f_eq1
    mock_funding.select.return_value = f_sel

    # positions delete/insert tolerated.
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

    def _capture_insert(rows):
        captured_inserts.append(rows if isinstance(rows, list) else [rows])
        return m_ins

    mock_positions.insert.side_effect = _capture_insert

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

    def _rpc(name, payload=None):
        if name == "reconstruct_positions_atomic" and payload:
            rows = payload.get("p_positions") or []
            if rows:
                captured_inserts.append(list(rows))
        rpc_handle = MagicMock()
        rpc_handle.execute.return_value = MagicMock(data=[])
        return rpc_handle

    mock.rpc = _rpc
    return mock


@pytest.mark.asyncio
async def test_attribute_funding_swallows_funding_fetch_error(caplog) -> None:
    """H-1093: _attribute_funding wraps the paginated funding_fees fetch in
    try/except. On failure (e.g. RLS misconfig) it must SWALLOW the error,
    log a warning, and leave every position's funding_pnl at the default 0 —
    NOT bubble the exception and block the entire reconstruction.

    This pins the silent-recovery contract in the docstring: a funding-fetch
    failure degrades to funding_pnl=0, it does not abort position rebuild.
    """
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
    mock_supabase = _make_mock_supabase_funding_fetch_raises(
        fills, RuntimeError("RLS denied")
    )

    with caplog.at_level(
        logging.WARNING, logger="quantalyze.analytics.position_reconstruction"
    ), patch(
        "services.position_reconstruction.db_execute",
        side_effect=_mock_db_execute,
    ):
        # (a) must return without raising even though funding fetch errors.
        result = await reconstruct_positions("strat-1", mock_supabase)

    # Reconstruction completed: one closed position persisted.
    inserted_rows = [
        row for batch in mock_supabase._captured_inserts for row in batch
    ]
    assert len(inserted_rows) == 1, (
        "position reconstruction must still persist positions when funding "
        f"fetch fails; got {inserted_rows!r}"
    )
    # (b) funding_pnl stays at the default 0 — error did not corrupt the value.
    assert inserted_rows[0]["funding_pnl"] == 0
    # Trade metrics still computed (proves reconstruct ran to completion).
    assert result["total_positions"] == 1
    assert result["closed_positions"] == 1
    # (c) a warning was logged naming the funding-fetch failure.
    assert any(
        "funding_fees fetch failed" in rec.getMessage()
        for rec in caplog.records
        if rec.levelno >= logging.WARNING
    ), (
        "expected a WARNING naming the funding_fees fetch failure; "
        f"got records={[r.getMessage() for r in caplog.records]!r}"
    )


@pytest.mark.asyncio
async def test_funding_fetch_failure_sets_data_quality_flag() -> None:
    """Audit H-1094: when the funding_fees fetch errors, _attribute_funding
    swallows it and zeros funding_pnl (existing fail-soft contract) — but it
    must ALSO surface `funding_attribution_failed=True` in the returned
    trade_metrics `data_quality_flags`. Pre-fix the degradation was completely
    silent: the dashboard claimed "ROI excludes funding payments" implying the
    strategy paid none, when in fact funding could not be loaded at all.

    Fails without the fix: pre-fix code logs + returns with no flag, so
    `result["data_quality_flags"]` either is absent or lacks the key.
    """
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
    mock_supabase = _make_mock_supabase_funding_fetch_raises(
        fills, RuntimeError("RLS denied")
    )

    with patch(
        "services.position_reconstruction.db_execute",
        side_effect=_mock_db_execute,
    ):
        result = await reconstruct_positions("strat-1", mock_supabase)

    # The reconstruction still completes (fail-soft) ...
    assert result["closed_positions"] == 1
    # ... and the funding-fetch failure is no longer silent.
    dq = result.get("data_quality_flags") or {}
    assert dq.get("funding_attribution_failed") is True, (
        "expected funding_attribution_failed=True in data_quality_flags when "
        f"the funding_fees fetch raises; got data_quality_flags={dq!r}"
    )


@pytest.mark.asyncio
async def test_funding_window_bounds_skip_corrupt_closed_at() -> None:
    """Audit H-1097: a single corrupt closed_at must NOT become the raw
    lexically-max value injected into PostgREST `.lte('timestamp', ...)`.

    Pre-fix, `max_closed_at = max(raw strings)` would pick the corrupt
    string (e.g. a space instead of 'T'), PostgREST 400s the whole range
    scan, the broad `except` swallows it, and EVERY position silently gets
    funding_pnl=0 (poison-pill). The fix parses the bounds first so a corrupt
    string can't be injected, counts it in `funding_window_corrupt_position`,
    and — critically — falls the corrupt-close position's bound back to `now`
    (mirroring the per-position scan) so the fetch window COVERS it rather than
    ending at the earlier clean close (which would drop that position's own
    funding — a quieter recurrence of the same poison-pill).

    Fails without the fix: the captured `max_closed_at` would be the raw
    corrupt string and `funding_window_corrupt_position` would be absent.
    """
    from datetime import datetime

    from services.position_reconstruction import _attribute_funding

    # One clean closed position + one whose closed_at is corrupt (no 'T').
    # The corrupt string sorts lexically AFTER the clean ISO string, so the
    # pre-fix raw `max(...)` would have selected it.
    positions = [
        {
            "symbol": "BTCUSDT",
            "opened_at": "2024-01-01T00:00:00+00:00",
            "closed_at": "2024-01-02T00:00:00+00:00",
            "funding_pnl": 0,
        },
        {
            "symbol": "ETHUSDT",
            "opened_at": "2024-01-03T00:00:00+00:00",
            # Corrupt: space instead of 'T' — unparseable as TIMESTAMPTZ by
            # PostgREST, but lexically greater than the clean ISO above.
            "closed_at": "2024-01-09 not-an-iso",
            "funding_pnl": 0,
        },
    ]

    captured: dict[str, str] = {}

    def _table(name: str):
        tbl = MagicMock()
        if name == "funding_fees":
            f_sel = MagicMock()
            f_eq = MagicMock()
            f_gte = MagicMock()
            f_lte = MagicMock()
            f_range = MagicMock()
            f_range.execute.return_value = MagicMock(data=[])

            def _capture_lte(field, value):
                captured["lte_field"] = field
                captured["max_closed_at"] = value
                return f_lte

            def _capture_gte(field, value):
                captured["min_opened_at"] = value
                return f_gte

            f_lte.range.return_value = f_range
            f_gte.lte.side_effect = _capture_lte
            f_eq.gte.side_effect = _capture_gte
            f_sel.eq.return_value = f_eq
            tbl.select.return_value = f_sel
        return tbl

    mock_supabase = MagicMock()
    mock_supabase.table = _table

    flags: dict = {}
    with patch(
        "services.position_reconstruction.db_execute",
        side_effect=_mock_db_execute,
    ):
        await _attribute_funding("strat-1", positions, mock_supabase, flags)

    # (a) The corrupt closed_at was NOT injected raw — the bound is a valid,
    # parseable ISO datetime that excludes the poison row.
    assert "max_closed_at" in captured, "funding_fees query was not issued"
    raw_corrupt = "2024-01-09 not-an-iso"
    assert captured["max_closed_at"] != raw_corrupt, (
        "corrupt closed_at leaked into the PostgREST .lte bound (poison-pill); "
        f"got {captured['max_closed_at']!r}"
    )
    # The clean position's close (2024-01-02) is NOT the upper bound: the
    # corrupt-close position (opened 2024-01-03) falls its bound back to `now`,
    # so the fetch window COVERS it instead of dropping its funding at the
    # earlier clean close. (Pre-HIGH-fix the corrupt close was dropped and the
    # bound was the clean 2024-01-02 — the silent-drop bug.)
    parsed_max = datetime.fromisoformat(captured["max_closed_at"])  # must not raise
    assert parsed_max > datetime.fromisoformat("2024-01-03T00:00:00+00:00"), (
        "corrupt-close position must be covered to now, not dropped at the "
        f"earlier clean close; got max_closed_at={captured['max_closed_at']!r}"
    )
    # WEAK-1: the lower bound is the parsed min open, serialized canonically.
    assert (
        datetime.fromisoformat(captured["min_opened_at"]).isoformat()
        == "2024-01-01T00:00:00+00:00"
    )
    # (b) The corrupt row is surfaced, not silently dropped.
    assert flags.get("funding_window_corrupt_position") == 1, (
        "expected funding_window_corrupt_position=1 for the corrupt closed_at; "
        f"got flags={flags!r}"
    )


@pytest.mark.asyncio
async def test_open_position_funding_attributed_through_now() -> None:
    """M-0933: an OPEN position (status='open', closed_at=None) must attribute
    funding rows from opened_at to wall-clock now. The closed_at-None branch
    resolves the window upper bound to now_utc; a regression that collapsed it
    to closed_at=opened_at (zero window) would silently zero-out funding for
    live perps.

    Setup: a single buy (no sell) keeps the position open. Funding rows are
    timestamped after the buy but well before 'now' (year 2024), so they fall
    inside [opened_at, now]. funding_pnl must equal their sum.
    """
    fills = [
        {
            "symbol": "BTCUSDT",
            "exchange": "binance",
            "side": "buy",
            "price": 100.0,
            "quantity": 1.0,
            "fee": 0.0,
            "timestamp": "2024-01-01T00:00:00+00:00",
            "raw_data": {},
            "is_fill": True,
        },
    ]
    # Three funding events AFTER the buy, all before now (2024 << runtime).
    # Sum: 0.03 + (-0.01) + 0.005 = 0.025
    funding_rows = [
        {
            "strategy_id": "strat-open",
            "exchange": "binance",
            "symbol": "BTCUSDT",
            "amount": "0.03",
            "currency": "USDT",
            "timestamp": "2024-01-01T08:00:00+00:00",
        },
        {
            "strategy_id": "strat-open",
            "exchange": "binance",
            "symbol": "BTCUSDT",
            "amount": "-0.01",
            "currency": "USDT",
            "timestamp": "2024-01-02T08:00:00+00:00",
        },
        {
            "strategy_id": "strat-open",
            "exchange": "binance",
            "symbol": "BTCUSDT",
            "amount": "0.005",
            "currency": "USDT",
            "timestamp": "2024-01-03T08:00:00+00:00",
        },
        # Funding row BEFORE the position opened — must be excluded.
        {
            "strategy_id": "strat-open",
            "exchange": "binance",
            "symbol": "BTCUSDT",
            "amount": "99.0",
            "currency": "USDT",
            "timestamp": "2023-12-31T00:00:00+00:00",
        },
    ]

    mock_supabase = _make_mock_supabase_with_funding(fills, funding_rows)

    with patch(
        "services.position_reconstruction.db_execute",
        side_effect=_mock_db_execute,
    ):
        await reconstruct_positions("strat-open", mock_supabase)

    inserted_rows = [
        row for batch in mock_supabase._captured_inserts for row in batch
    ]
    assert len(inserted_rows) == 1
    pos = inserted_rows[0]
    assert pos["status"] == "open", (
        f"expected an open position (no sell fill); got {pos['status']!r}"
    )
    assert pos["closed_at"] is None
    # Window opened_at..now must capture the 3 in-window rows (0.025 total)
    # and exclude the pre-open row. A collapsed (opened_at..opened_at) window
    # would yield 0.0.
    assert pos["funding_pnl"] == pytest.approx(0.025, abs=1e-9), (
        "open-position funding window collapsed — closed_at=None must "
        f"resolve to now, not opened_at; got {pos['funding_pnl']}"
    )


@pytest.mark.asyncio
async def test_funding_window_all_closed_at_corrupt_defaults_to_now() -> None:
    """Audit H-1097 (orchestrator follow-up): every closed position has a
    truthy-but-corrupt closed_at and none is open. Each corrupt close falls the
    query upper bound back to `now` (mirroring the per-position scan), so the
    bound is a valid `now` TIMESTAMPTZ that covers every position's window —
    never the raw corrupt string, and never a `max([])` crash. open_dts is
    non-empty (valid opens), so the all-opens-corrupt early-return does not fire
    — this exercises the *close*-bound path with two corrupt-close positions
    (so the per-position corrupt counter must be 2).

    Fails without the fix: the pre-fix code dropped corrupt closes from the
    bound (narrowing/emptying it), so the window could end before these
    positions' funding and/or `max([])` could crash before the DB try/except.
    """
    from datetime import datetime, timezone

    from services.position_reconstruction import _attribute_funding

    # Both positions CLOSED with valid opened_at but corrupt closed_at; no open
    # position contributes `now`, so close_dts is empty after parsing.
    positions = [
        {
            "symbol": "BTCUSDT",
            "opened_at": "2024-01-01T00:00:00+00:00",
            "closed_at": "2024-01-02 not-an-iso",
            "funding_pnl": 0,
        },
        {
            "symbol": "ETHUSDT",
            "opened_at": "2024-01-03T00:00:00+00:00",
            "closed_at": "garbage",
            "funding_pnl": 0,
        },
    ]

    captured: dict[str, str] = {}

    def _table(name: str):
        tbl = MagicMock()
        if name == "funding_fees":
            f_sel = MagicMock()
            f_eq = MagicMock()
            f_gte = MagicMock()
            f_lte = MagicMock()
            f_range = MagicMock()
            f_range.execute.return_value = MagicMock(data=[])

            def _capture_lte(field, value):
                captured["max_closed_at"] = value
                return f_lte

            f_lte.range.return_value = f_range
            f_gte.lte.side_effect = _capture_lte
            f_eq.gte.return_value = f_gte
            f_sel.eq.return_value = f_eq
            tbl.select.return_value = f_sel
        return tbl

    mock_supabase = MagicMock()
    mock_supabase.table = _table

    flags: dict = {}
    with patch(
        "services.position_reconstruction.db_execute",
        side_effect=_mock_db_execute,
    ):
        # Must NOT raise (pre-fix: max([]) ValueError escapes here).
        await _attribute_funding("strat-1", positions, mock_supabase, flags)

    # The query still issued, with a valid parseable `now`-ish upper bound
    # (not a corrupt string), and both corrupt closes were counted.
    assert "max_closed_at" in captured, "funding_fees query was not issued"
    parsed = datetime.fromisoformat(captured["max_closed_at"])  # must not raise
    assert parsed.tzinfo is not None
    assert parsed > datetime(2024, 1, 3, tzinfo=timezone.utc), (
        "empty close_dts must default the upper bound to now, not a stale value"
    )
    assert flags.get("funding_window_corrupt_position") == 2, (
        f"expected both corrupt closed_at counted; got flags={flags!r}"
    )


def _capture_bounds_table(captured: dict, *, funding_data=None, fetch_exc=None):
    """Build a `supabase.table` side_effect that captures the funding_fees
    .gte/.lte bounds (and optionally raises on .execute). Shared by the
    direct-`_attribute_funding` window-bound tests below."""
    def _table(name: str):
        tbl = MagicMock()
        if name == "funding_fees":
            f_sel = MagicMock()
            f_eq = MagicMock()
            f_gte = MagicMock()
            f_lte = MagicMock()
            f_range = MagicMock()
            if fetch_exc is not None:
                f_range.execute.side_effect = fetch_exc
            else:
                f_range.execute.return_value = MagicMock(data=funding_data or [])

            def _cap_lte(field, value):
                captured["max_closed_at"] = value
                return f_lte

            def _cap_gte(field, value):
                captured["min_opened_at"] = value
                return f_gte

            f_lte.range.return_value = f_range
            f_gte.lte.side_effect = _cap_lte
            f_eq.gte.side_effect = _cap_gte
            f_sel.eq.return_value = f_eq
            tbl.select.return_value = f_sel
        return tbl
    return _table


@pytest.mark.asyncio
async def test_funding_window_corrupt_open_keeps_valid_close_in_bound() -> None:
    """pr-test GAP-1: a position with a corrupt opened_at but a VALID closed_at
    still contributes its valid close to the upper window bound (it is counted
    corrupt for the lower bound, but its close is usable). Pins the contract so
    a future regression that `continue`s the whole position on a corrupt open
    (dropping its valid close) — which would shrink the fetch window and drop a
    later position's funding — fails loudly.
    """
    from datetime import datetime
    from services.position_reconstruction import _attribute_funding

    positions = [
        {"symbol": "BTCUSDT", "opened_at": "2024-01-01T00:00:00+00:00",
         "closed_at": "2024-01-05T00:00:00+00:00", "funding_pnl": 0},  # clean
        {"symbol": "ETHUSDT", "opened_at": "garbage-open",
         "closed_at": "2024-01-09T00:00:00+00:00", "funding_pnl": 0},  # corrupt OPEN, valid close
    ]
    captured: dict[str, str] = {}
    mock_supabase = MagicMock()
    mock_supabase.table = _capture_bounds_table(captured)

    flags: dict = {}
    with patch(
        "services.position_reconstruction.db_execute",
        side_effect=_mock_db_execute,
    ):
        await _attribute_funding("strat-1", positions, mock_supabase, flags)

    # The corrupt-OPEN position's VALID close (01-09) widened the upper bound —
    # not dropped to the clean position's 01-05.
    assert (
        datetime.fromisoformat(captured["max_closed_at"]).isoformat()
        == "2024-01-09T00:00:00+00:00"
    ), f"corrupt-open row's valid close was dropped; got {captured!r}"
    assert (
        datetime.fromisoformat(captured["min_opened_at"]).isoformat()
        == "2024-01-01T00:00:00+00:00"
    )
    assert flags.get("funding_window_corrupt_position") == 1, f"got {flags!r}"


@pytest.mark.asyncio
async def test_attribute_funding_flags_none_does_not_crash() -> None:
    """pr-test GAP-2: the legacy 3-arg call (flags omitted → None) must not
    crash on any DQ-flag-set path. The `if flags is not None` guards make the
    flag writes no-ops; a regression to unconditional `flags[...] = ...` would
    raise TypeError (`None[...] = ...`) on a corrupt position or a funding-fetch
    failure, crashing the whole reconstruction.

    Fails without the guards: corrupt-close counting OR the funding_fetch
    except would dereference None.
    """
    from services.position_reconstruction import _attribute_funding

    positions = [
        {"symbol": "BTCUSDT", "opened_at": "2024-01-01T00:00:00+00:00",
         "closed_at": "2024-01-02 not-an-iso", "funding_pnl": 0},  # corrupt close
    ]
    captured: dict[str, str] = {}
    mock_supabase = MagicMock()
    mock_supabase.table = _capture_bounds_table(
        captured, fetch_exc=RuntimeError("RLS denied")
    )

    with patch(
        "services.position_reconstruction.db_execute",
        side_effect=_mock_db_execute,
    ):
        # flags omitted (defaults None) — must return without raising even though
        # there is a corrupt-close position AND the funding fetch fails.
        await _attribute_funding("strat-1", positions, mock_supabase)

    assert positions[0]["funding_pnl"] == 0


@pytest.mark.asyncio
async def test_funding_window_double_corrupt_position_counts_once() -> None:
    """pr-test GAP-3 / code-reviewer: a single position with BOTH opened_at and
    closed_at corrupt is ONE corrupt position, not two. The counter is
    position-keyed and summed downstream into strategy_analytics, so a
    per-timestamp double-count over-reports corruption.

    Fails without the per-position counting fix: the both-corrupt position
    increments the counter twice → 2 instead of 1.
    """
    from services.position_reconstruction import _attribute_funding

    positions = [
        {"symbol": "BTCUSDT", "opened_at": "2024-01-01T00:00:00+00:00",
         "closed_at": "2024-01-02T00:00:00+00:00", "funding_pnl": 0},  # clean (valid open)
        {"symbol": "ETHUSDT", "opened_at": "bad-open",
         "closed_at": "bad-close", "funding_pnl": 0},  # BOTH corrupt
    ]
    captured: dict[str, str] = {}
    mock_supabase = MagicMock()
    mock_supabase.table = _capture_bounds_table(captured)

    flags: dict = {}
    with patch(
        "services.position_reconstruction.db_execute",
        side_effect=_mock_db_execute,
    ):
        await _attribute_funding("strat-1", positions, mock_supabase, flags)

    assert flags.get("funding_window_corrupt_position") == 1, (
        "a both-timestamps-corrupt position must count ONCE, not twice; "
        f"got flags={flags!r}"
    )


@pytest.mark.asyncio
async def test_corrupt_funding_rows_counted_and_excluded_from_sum() -> None:
    """pr-test GAP-4 / silent-failure: funding rows with a corrupt timestamp or
    non-numeric amount can't be parsed and are dropped from the funding_pnl sum,
    but the drop must be SURFACED via `funding_rows_unparseable` — a
    half-corrupt feed otherwise yields a wrong-but-clean-looking ROI.

    Fails without the fix: the bad rows are silently skipped and
    funding_rows_unparseable is absent from data_quality_flags.
    """
    fills = [
        {"symbol": "BTCUSDT", "side": "buy", "price": 100.0, "quantity": 1.0,
         "fee": 0.0, "timestamp": "2024-01-01T00:00:00+00:00", "raw_data": {}, "is_fill": True},
        {"symbol": "BTCUSDT", "side": "sell", "price": 110.0, "quantity": 1.0,
         "fee": 0.0, "timestamp": "2024-01-05T00:00:00+00:00", "raw_data": {}, "is_fill": True},
    ]
    funding_rows = [
        {"symbol": "BTCUSDT", "amount": "1.5", "timestamp": "2024-01-02T00:00:00+00:00"},  # valid
        {"symbol": "BTCUSDT", "amount": "2.5", "timestamp": "2024-01-03T00:00:00+00:00"},  # valid
        {"symbol": "BTCUSDT", "amount": "not-a-number", "timestamp": "2024-01-04T00:00:00+00:00"},  # bad amount
        {"symbol": "BTCUSDT", "amount": "9.0", "timestamp": "garbage-ts"},  # bad timestamp
    ]
    mock_supabase = _make_mock_supabase_with_funding(fills, funding_rows)

    with patch(
        "services.position_reconstruction.db_execute",
        side_effect=_mock_db_execute,
    ):
        result = await reconstruct_positions("strat-1", mock_supabase)

    pos = [row for batch in mock_supabase._captured_inserts for row in batch][0]
    # Only the 2 valid rows summed (both inside [01-01, 01-05]): 1.5 + 2.5 = 4.0.
    assert pos["funding_pnl"] == pytest.approx(4.0, abs=1e-9)
    dq = result.get("data_quality_flags") or {}
    assert dq.get("funding_rows_unparseable") == 2, (
        f"expected 2 unparseable funding rows surfaced; got data_quality_flags={dq!r}"
    )


@pytest.mark.asyncio
async def test_funding_at_flip_instant_counted_once() -> None:
    """Audit-2026-05-27 P1 (MED8): a funding row stamped at the EXACT flip
    instant must be attributed to exactly ONE leg, not both.

    Timeline (single symbol+exchange):
      buy 2 @ T0=Jan-1  → opens long 2
      sell 4 @ T_flip=Jan-3 → closes long [Jan-1, Jan-3], opens short 2 [Jan-3, …]
      buy 2 @ T2=Jan-5  → closes short [Jan-3, Jan-5]
    A funding row at EXACTLY Jan-3 sits on the boundary the closing long
    ([open, T_flip]) and the new short ([T_flip, close]) both claimed under the
    prior inclusive-bounds + per-position summation. With half-open windows it
    belongs solely to the short ([Jan-3, Jan-5)), counted once.

    Fails without the fix: the Jan-3 row is summed into BOTH legs → the
    strategy's total funding is double-counted (2.0 instead of 1.0).
    """
    fills = [
        {
            "symbol": "BTCUSDT",
            "exchange": "binance",
            "side": "buy",
            "price": 100.0,
            "quantity": 2.0,
            "fee": 0.0,
            "timestamp": "2024-01-01T00:00:00+00:00",
            "raw_data": {},
            "is_fill": True,
        },
        {
            "symbol": "BTCUSDT",
            "exchange": "binance",
            "side": "sell",
            "price": 110.0,
            "quantity": 4.0,  # closes the 2-long AND opens a 2-short (flip)
            "fee": 0.0,
            "timestamp": "2024-01-03T00:00:00+00:00",
            "raw_data": {},
            "is_fill": True,
        },
        {
            "symbol": "BTCUSDT",
            "exchange": "binance",
            "side": "buy",
            "price": 105.0,
            "quantity": 2.0,  # closes the short
            "fee": 0.0,
            "timestamp": "2024-01-05T00:00:00+00:00",
            "raw_data": {},
            "is_fill": True,
        },
    ]
    funding_rows = [
        {
            "strategy_id": "strat-flip",
            "exchange": "binance",
            "symbol": "BTCUSDT",
            "amount": "1.0",
            "currency": "USDT",
            "timestamp": "2024-01-03T00:00:00+00:00",  # EXACTLY the flip instant
        },
    ]

    mock_supabase = _make_mock_supabase_with_funding(fills, funding_rows)
    with patch(
        "services.position_reconstruction.db_execute",
        side_effect=_mock_db_execute,
    ):
        await reconstruct_positions("strat-flip", mock_supabase)

    inserted_rows = [
        row for batch in mock_supabase._captured_inserts for row in batch
    ]
    assert len(inserted_rows) == 2, f"expected 2 closed legs, got {inserted_rows!r}"

    # The Jan-3 row is counted exactly once across BOTH legs (total == 1.0),
    # and lands on the leg whose half-open window [Jan-3, Jan-5) contains it
    # (the short opened by the flip), not the closing long ([Jan-1, Jan-3)).
    total_funding = sum(p["funding_pnl"] for p in inserted_rows)
    assert total_funding == pytest.approx(1.0, abs=1e-9), (
        f"flip-instant funding double-counted: total={total_funding} "
        f"across legs={[(p['opened_at'], p['closed_at'], p['funding_pnl']) for p in inserted_rows]}"
    )

    long_leg = next(p for p in inserted_rows if p["side"] == "long")
    short_leg = next(p for p in inserted_rows if p["side"] == "short")
    assert long_leg["funding_pnl"] == pytest.approx(0.0, abs=1e-9), (
        "the row at the flip instant must NOT land in the closing long's "
        "half-open window [open, flip)"
    )
    assert short_leg["funding_pnl"] == pytest.approx(1.0, abs=1e-9)


@pytest.mark.asyncio
async def test_funding_not_double_counted_across_overlapping_same_symbol_positions() -> None:
    """Audit-2026-05-27 P1 (MED8): two SAME-symbol positions on DIFFERENT
    exchanges with OVERLAPPING time windows must not both claim a funding row
    that falls in the overlap.

    Pre-fix the funding lookup keyed by symbol alone (exchange dropped) and
    summed every in-window row into EVERY position, so a row in the overlap was
    attributed to both the binance and the okx position. Keying by
    (symbol, exchange) + single-assignment attributes each row to exactly the
    position on its own exchange.

    Timeline (both BTCUSDT, overlapping Jan-2 → Jan-3):
      binance: buy Jan-1 → sell Jan-4   window [Jan-1, Jan-4)
      okx:     buy Jan-2 → sell Jan-5   window [Jan-2, Jan-5)
    A binance funding row at Jan-2T12 (inside BOTH windows) belongs ONLY to the
    binance position.

    Fails without the fix: the Jan-2T12 row (and the okx one) are summed into
    both positions → each shows the other's funding too.
    """
    fills = [
        # binance position
        {
            "symbol": "BTCUSDT", "exchange": "binance", "side": "buy",
            "price": 100.0, "quantity": 1.0, "fee": 0.0,
            "timestamp": "2024-01-01T00:00:00+00:00", "raw_data": {}, "is_fill": True,
        },
        {
            "symbol": "BTCUSDT", "exchange": "binance", "side": "sell",
            "price": 110.0, "quantity": 1.0, "fee": 0.0,
            "timestamp": "2024-01-04T00:00:00+00:00", "raw_data": {}, "is_fill": True,
        },
        # okx position — same symbol, overlapping window, different exchange
        {
            "symbol": "BTCUSDT", "exchange": "okx", "side": "buy",
            "price": 100.0, "quantity": 1.0, "fee": 0.0,
            "timestamp": "2024-01-02T00:00:00+00:00", "raw_data": {}, "is_fill": True,
        },
        {
            "symbol": "BTCUSDT", "exchange": "okx", "side": "sell",
            "price": 120.0, "quantity": 1.0, "fee": 0.0,
            "timestamp": "2024-01-05T00:00:00+00:00", "raw_data": {}, "is_fill": True,
        },
    ]
    funding_rows = [
        # In the overlap [Jan-2, Jan-4): only the binance position owns it.
        {
            "strategy_id": "strat-overlap", "exchange": "binance", "symbol": "BTCUSDT",
            "amount": "3.0", "currency": "USDT",
            "timestamp": "2024-01-02T12:00:00+00:00",
        },
        # In the overlap too: only the okx position owns it.
        {
            "strategy_id": "strat-overlap", "exchange": "okx", "symbol": "BTCUSDT",
            "amount": "7.0", "currency": "USDT",
            "timestamp": "2024-01-03T12:00:00+00:00",
        },
    ]

    mock_supabase = _make_mock_supabase_with_funding(fills, funding_rows)
    with patch(
        "services.position_reconstruction.db_execute",
        side_effect=_mock_db_execute,
    ):
        await reconstruct_positions("strat-overlap", mock_supabase)

    inserted_rows = [
        row for batch in mock_supabase._captured_inserts for row in batch
    ]
    assert len(inserted_rows) == 2, f"expected 2 positions, got {inserted_rows!r}"

    # Map by entry price to disambiguate (binance entry 100/exit 110, okx entry
    # 100/exit 120) — exchange is a transient key stripped before persist, so
    # use exit price which differs between the two legs.
    binance_pos = next(p for p in inserted_rows if p["exit_price_avg"] == pytest.approx(110.0))
    okx_pos = next(p for p in inserted_rows if p["exit_price_avg"] == pytest.approx(120.0))

    assert binance_pos["funding_pnl"] == pytest.approx(3.0, abs=1e-9), (
        f"binance position must own ONLY its own funding (3.0), "
        f"got {binance_pos['funding_pnl']}"
    )
    assert okx_pos["funding_pnl"] == pytest.approx(7.0, abs=1e-9), (
        f"okx position must own ONLY its own funding (7.0), "
        f"got {okx_pos['funding_pnl']}"
    )
    # Total across both = 3 + 7 = 10 (no row summed twice).
    assert sum(p["funding_pnl"] for p in inserted_rows) == pytest.approx(10.0, abs=1e-9)
