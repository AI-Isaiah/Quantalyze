"""Phase 09 / Task 2 TDD tests for _load_allocator_context holdings merge.

Tests:
- Holdings-only allocator produces holding-sourced pseudo-strategies (LIVE-01)
- Mixed portfolio (strategies + holdings) weights normalize across combined set (D-16)
- Warm-up gate: holding with <30d breakdown excluded entirely (Phase 07 D-03 analog)
- FLAG_COMPOSITE_THRESHOLD constant equals 50 (D-06 + RESEARCH A3)

All tests are plain `def` (NOT async def) per finding f1.
_load_allocator_context is a synchronous `def` at routers/match.py:172 — called via
asyncio.to_thread from _score_one_allocator. Tests call it without await.
"""
from __future__ import annotations

import pytest
from unittest.mock import MagicMock

# NOTE per finding f1: _load_allocator_context is sync `def` at routers/match.py:172.
# Tests MUST be plain `def` (NOT `async def`) and call without `await`. Adding
# @pytest.mark.asyncio + await on a sync function raises
# `TypeError: object dict can't be used in 'await' expression`.
from routers.match import _load_allocator_context, FLAG_COMPOSITE_THRESHOLD


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_snapshot_series(days: int, symbol: str, start_value: float = 100.0, daily_return: float = 0.01) -> list[dict]:
    """Generate N days of breakdown snapshots with the given symbol compounding at daily_return."""
    from datetime import date, timedelta
    snapshots = []
    value = start_value
    base = date(2026, 1, 1)
    for i in range(days):
        d = base + timedelta(days=i)
        snapshots.append({
            "asof": d.isoformat(),
            "breakdown": {symbol: round(value, 4)},
        })
        value *= (1 + daily_return)
    return snapshots


def _make_multi_symbol_snapshots(days: int, symbols: dict[str, float], daily_return: float = 0.01) -> list[dict]:
    """Generate N days of breakdown snapshots covering multiple symbols."""
    from datetime import date, timedelta
    base = date(2026, 1, 1)
    snapshots = []
    values = {sym: start for sym, start in symbols.items()}
    for i in range(days):
        d = base + timedelta(days=i)
        bd = {sym: round(v, 4) for sym, v in values.items()}
        snapshots.append({"asof": d.isoformat(), "breakdown": bd})
        for sym in values:
            values[sym] *= (1 + daily_return)
    return snapshots


def _build_mock_supabase(
    *,
    prefs: dict | None = None,
    portfolios: list[dict] | None = None,
    portfolio_strategies: list[dict] | None = None,
    strategy_analytics: list[dict] | None = None,
    holdings: list[dict] | None = None,
    snapshots: list[dict] | None = None,
    thumbs_down: list[dict] | None = None,
) -> MagicMock:
    """Build a MagicMock Supabase client routing table queries to fixtures.

    Uses side_effect on mock_sb.table() to return different mock builders
    depending on table name.
    """
    prefs = prefs or {}
    portfolios = portfolios or []
    portfolio_strategies = portfolio_strategies or []
    strategy_analytics = strategy_analytics or []
    holdings = holdings or []
    snapshots = snapshots or []
    thumbs_down = thumbs_down or []

    # Build a minimal query-builder chain that returns .execute() -> MagicMock(data=...)
    def _chain(data):
        """Return a MagicMock that, at any query-chain terminus, returns MagicMock(data=data)."""
        result = MagicMock(data=data)
        mock = MagicMock()
        # Ensure any attribute access / chaining returns mock itself until .execute()
        mock.select.return_value = mock
        mock.eq.return_value = mock
        mock.in_.return_value = mock
        mock.order.return_value = mock
        mock.limit.return_value = mock
        mock.maybe_single.return_value = mock
        mock.execute.return_value = result
        return mock

    def _table_router(table_name: str):
        if table_name == "allocator_preferences":
            return _chain(prefs)
        if table_name == "portfolios":
            return _chain(portfolios)
        if table_name == "portfolio_strategies":
            return _chain(portfolio_strategies)
        if table_name == "strategy_analytics":
            return _chain(strategy_analytics)
        if table_name == "allocator_holdings":
            return _chain(holdings)
        if table_name == "allocator_equity_snapshots":
            return _chain(snapshots)
        if table_name == "match_decisions":
            return _chain(thumbs_down)
        # Fallback for any other table
        return _chain([])

    mock_sb = MagicMock()
    mock_sb.table.side_effect = _table_router
    return mock_sb


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_load_allocator_context_holdings_only(monkeypatch):
    """LIVE-01: holdings-only allocator produces holding-sourced pseudo-strategies only.

    NOTE per finding f1: plain `def`, no await — function is sync.
    """
    holdings = [
        {
            "venue": "binance", "symbol": "BTC", "holding_type": "spot",
            "value_usd": 50000.0, "asof": "2026-02-10",
        },
        {
            "venue": "binance", "symbol": "ETH", "holding_type": "spot",
            "value_usd": 30000.0, "asof": "2026-02-10",
        },
    ]
    # 41 days of snapshots so warm-up gate (>=30 returns) passes
    snapshots = _make_multi_symbol_snapshots(
        41,
        {"BTC": 50000.0, "ETH": 30000.0},
    )

    mock_sb = _build_mock_supabase(holdings=holdings, snapshots=snapshots)
    monkeypatch.setattr("routers.match.get_supabase", lambda: mock_sb)

    result = _load_allocator_context("alloc-1")  # NO await — function is sync

    assert len(result["portfolio_strategies"]) == 2
    pseudo_ids = [ps["strategy_id"] for ps in result["portfolio_strategies"]]
    assert all(pid.startswith("holding:") for pid in pseudo_ids)
    assert "holding:binance:BTC:spot" in pseudo_ids
    assert "holding:binance:ETH:spot" in pseudo_ids

    # Weights sum to 1.0 over eligible holdings
    assert abs(sum(result["portfolio_weights"].values()) - 1.0) < 1e-9

    # BTC weight = 50000 / 80000
    assert abs(result["portfolio_weights"]["holding:binance:BTC:spot"] - (50000.0 / 80000.0)) < 1e-9

    # Each series has >=30 returns (41 snapshots → 40 returns)
    assert all(len(s) >= 30 for s in result["portfolio_returns"].values())

    # portfolio_aum = sum of holding value_usd
    assert result["portfolio_aum"] == pytest.approx(80000.0)


def test_mixed_portfolio_weights_sum_to_one(monkeypatch):
    """D-16: mixed portfolio (strategies + holdings) weights normalize across combined set.

    NOTE per finding f1: plain `def`, no await.
    """
    # Two strategy rows with allocated_amount
    portfolios = [{"id": "port-1"}]
    ps_rows = [
        {"strategy_id": "uuid-strat-1", "current_weight": 0.5, "portfolio_id": "port-1", "allocated_amount": 20000.0},
        {"strategy_id": "uuid-strat-2", "current_weight": 0.5, "portfolio_id": "port-1", "allocated_amount": 30000.0},
    ]
    sa_rows = [
        {"strategy_id": "uuid-strat-1", "returns_series": [{"date": "2026-01-01", "value": 0.01}]},
        {"strategy_id": "uuid-strat-2", "returns_series": [{"date": "2026-01-01", "value": 0.02}]},
    ]
    # Two holdings each with 41-day history
    holdings = [
        {"venue": "binance", "symbol": "SOL", "holding_type": "spot", "value_usd": 25000.0, "asof": "2026-02-10"},
        {"venue": "binance", "symbol": "AVAX", "holding_type": "spot", "value_usd": 25000.0, "asof": "2026-02-10"},
    ]
    snapshots = _make_multi_symbol_snapshots(41, {"SOL": 25000.0, "AVAX": 25000.0})

    mock_sb = _build_mock_supabase(
        portfolios=portfolios,
        portfolio_strategies=ps_rows,
        strategy_analytics=sa_rows,
        holdings=holdings,
        snapshots=snapshots,
    )
    monkeypatch.setattr("routers.match.get_supabase", lambda: mock_sb)

    result = _load_allocator_context("alloc-mixed")  # NO await

    # Combined: 2 strategy UUIDs + 2 holding pseudo-ids = 4 entries
    all_ids = [ps["strategy_id"] for ps in result["portfolio_strategies"]]
    assert len(all_ids) == 4
    uuid_ids = [i for i in all_ids if not i.startswith("holding:")]
    holding_ids = [i for i in all_ids if i.startswith("holding:")]
    assert len(uuid_ids) == 2
    assert len(holding_ids) == 2

    # Weights sum to 1.0 across combined set
    assert abs(sum(result["portfolio_weights"].values()) - 1.0) < 1e-9

    # portfolio_aum = strategy allocated_amounts + holding value_usd = 20000+30000+25000+25000
    assert result["portfolio_aum"] == pytest.approx(100000.0)


def test_warmup_gate_under_30d(monkeypatch):
    """Warm-up gate per Phase 07 D-03: holding with <30d breakdown excluded entirely.

    NOTE per finding f1: plain `def`, no await.
    """
    holdings = [
        {"venue": "binance", "symbol": "BTC", "holding_type": "spot", "value_usd": 50000.0, "asof": "2026-01-20"},
        {"venue": "binance", "symbol": "ETH", "holding_type": "spot", "value_usd": 30000.0, "asof": "2026-01-20"},
    ]
    # BTC gets only 20 days (→ 19 returns, < 30 warm-up gate); ETH gets 41 days (→ 40 returns, passes)
    btc_snaps = _make_snapshot_series(20, "BTC", start_value=50000.0)
    eth_snaps = _make_snapshot_series(41, "ETH", start_value=30000.0)
    # Merge into a unified snapshot list covering the same asof range
    combined: dict[str, dict] = {}
    for s in btc_snaps:
        combined.setdefault(s["asof"], {"asof": s["asof"], "breakdown": {}})
        combined[s["asof"]]["breakdown"].update(s["breakdown"])
    for s in eth_snaps:
        combined.setdefault(s["asof"], {"asof": s["asof"], "breakdown": {}})
        combined[s["asof"]]["breakdown"].update(s["breakdown"])
    snapshots = sorted(combined.values(), key=lambda x: x["asof"])

    mock_sb = _build_mock_supabase(holdings=holdings, snapshots=snapshots)
    monkeypatch.setattr("routers.match.get_supabase", lambda: mock_sb)

    result = _load_allocator_context("alloc-warmup")  # NO await

    pseudo_ids = [ps["strategy_id"] for ps in result["portfolio_strategies"]]
    assert "holding:binance:BTC:spot" not in pseudo_ids  # excluded by warm-up gate (<30 returns)
    assert "holding:binance:ETH:spot" in pseudo_ids

    # Remaining weight renormalizes to 1.0 over ETH alone
    assert result["portfolio_weights"].get("holding:binance:ETH:spot") == pytest.approx(1.0)


def test_flag_composite_threshold_equals_50():
    """D-06 + RESEARCH A3: composite >= 0.50 on [0,1] scale = score >= 50 on match_engine.py 0..100 scale.

    Also constitutes the constant-parity assertion required by finding f5
    (engine-side vs SSR-side agreement).
    """
    assert FLAG_COMPOSITE_THRESHOLD == 50
