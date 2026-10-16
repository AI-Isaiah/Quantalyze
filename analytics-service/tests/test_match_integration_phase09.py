"""Phase 09 / Task 2 TDD tests for _load_allocator_context holdings merge.

Tests:
- Holdings-only allocator produces holding-sourced pseudo-strategies (LIVE-01)
- Mixed portfolio (strategies + holdings) weights normalize across combined set (D-16)
- Short history: a spot holding with <30 priced days is withheld from the returns (named
  too_few_priced_days) and stays in the AUM and weights (167.1.1.1 D-01)
- FLAG_COMPOSITE_THRESHOLD constant equals 50 (D-06 + RESEARCH A3)

All tests are plain `def` (NOT async def) per finding f1.
_load_allocator_context is a synchronous `def` at routers/match.py:172 — called via
asyncio.to_thread from _score_one_allocator. Tests call it without await.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any

import pytest

# NOTE per finding f1: _load_allocator_context is sync `def` at routers/match.py:172.
# Tests MUST be plain `def` (NOT `async def`) and call without `await`. Adding
# @pytest.mark.asyncio + await on a sync function raises
# `TypeError: object dict can't be used in 'await' expression`.
from routers.match import _load_allocator_context, FLAG_COMPOSITE_THRESHOLD, compute_holding_flags
from tests._curve_fixtures import curve_from_returns
from tests.fake_postgrest import FakeDb

_STRAT_DATES = ["2026-01-01", "2026-01-02", "2026-01-03"]


@pytest.fixture(autouse=True)
def _history_window(monkeypatch):
    """Pin the holdings-history window start so the fixed 2026 calendar always lies in it."""
    monkeypatch.setattr("routers.match._holdings_history_window_start", lambda: "2025-01-01")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _mark_rows(
    allocator: str,
    symbol: str,
    days: int,
    *,
    value: float,
    first_mark: float,
    end: str = "2026-02-10",
    daily_return: float = 0.01,
) -> list[dict[str, Any]]:
    """One spot row per day for ``days`` adjacent days ending on ``end``. The mark compounds
    at ``daily_return``; ``value_usd`` is constant, so only the marks can make a return."""
    last = date.fromisoformat(end)
    rows: list[dict[str, Any]] = []
    for i in range(days):
        day = (last - timedelta(days=days - 1 - i)).isoformat()
        rows.append({
            "allocator_id": allocator, "api_key_id": "key-phase09", "venue": "binance",
            "symbol": symbol, "holding_type": "spot", "side": "flat",
            "value_usd": value, "mark_price": round(first_mark * (1 + daily_return) ** i, 4),
            "asof": day, "updated_at": f"{day}T04:00:00+00:00",
        })
    return rows


def _build_db(
    allocator: str,
    *,
    portfolios: list[dict] | None = None,
    portfolio_strategies: list[dict] | None = None,
    strategy_analytics: list[dict] | None = None,
    holdings: list[dict] | None = None,
) -> FakeDb:
    """The shared PostgREST fake seeded with the allocator's book: one API key, its
    portfolios and strategies, and its holdings rows."""
    return FakeDb({
        "api_keys": [{"id": "key-phase09", "user_id": allocator, "exchange": "binance"}],
        "portfolios": [{**p, "user_id": allocator} for p in (portfolios or [])],
        "portfolio_strategies": portfolio_strategies or [],
        "strategy_analytics": strategy_analytics or [],
        "allocator_holdings": holdings or [],
    })


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_load_allocator_context_holdings_only(monkeypatch):
    """LIVE-01: holdings-only allocator produces holding-sourced pseudo-strategies only.

    NOTE per finding f1: plain `def`, no await — function is sync.
    """
    # 41 adjacent days of marks so the 30-priced-day rule passes
    holdings = (
        _mark_rows("alloc-1", "BTC", 41, value=50000.0, first_mark=50000.0)
        + _mark_rows("alloc-1", "ETH", 41, value=30000.0, first_mark=30000.0)
    )

    mock_sb = _build_db("alloc-1", holdings=holdings)
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

    # Each series has >=30 returns (41 priced days → 40 returns)
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
    # 164.6.6.2.2: `returns_series` is the stored cumulative CURVE, so each strategy
    # carries a curve of at least two points (a one-point curve yields no daily
    # return, see test_one_point_curve_contributes_no_series_not_a_zero_return).
    # Geometric levels, hand-computed:
    #   strat-1 returns [0.0, 0.01, 0.02]  -> 1.0, 1.01, 1.0302 -> days 1..2 = 0.01, 0.02
    #   strat-2 returns [0.0, 0.02, -0.01] -> 1.0, 1.02, 1.0098 -> days 1..2 = 0.02, -0.01
    sa_rows = [
        {"strategy_id": "uuid-strat-1",
         "returns_series": curve_from_returns([0.0, 0.01, 0.02], _STRAT_DATES)},
        {"strategy_id": "uuid-strat-2",
         "returns_series": curve_from_returns([0.0, 0.02, -0.01], _STRAT_DATES)},
    ]
    # Two holdings each with a 41-day mark history
    holdings = (
        _mark_rows("alloc-mixed", "SOL", 41, value=25000.0, first_mark=25000.0)
        + _mark_rows("alloc-mixed", "AVAX", 41, value=25000.0, first_mark=25000.0)
    )

    mock_sb = _build_db(
        "alloc-mixed",
        portfolios=portfolios,
        portfolio_strategies=ps_rows,
        strategy_analytics=sa_rows,
        holdings=holdings,
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

    # The strategy legs of the blend are DAILY RETURNS derived from the stored curves,
    # not the curve levels (about 1.0) weighted as returns (CR-01).
    rets = result["portfolio_returns"]
    assert list(rets["uuid-strat-1"].values) == pytest.approx([0.01, 0.02], abs=1e-12)
    assert list(rets["uuid-strat-2"].values) == pytest.approx([0.02, -0.01], abs=1e-12)
    assert [d.strftime("%Y-%m-%d") for d in rets["uuid-strat-1"].index] == _STRAT_DATES[1:]


def test_one_point_curve_contributes_no_series_not_a_zero_return(monkeypatch):
    """A strategy whose stored curve has one point has no stored predecessor, so no
    daily return can be formed: it is absent from ``portfolio_returns`` (accounted like
    a strategy with no returns), never present as a 0 return. It stays in the book and
    keeps its weight; only its series is missing."""
    ps_rows = [
        {"strategy_id": "uuid-one-point", "current_weight": 0.5, "portfolio_id": "port-1",
         "allocated_amount": 20000.0},
        {"strategy_id": "uuid-full", "current_weight": 0.5, "portfolio_id": "port-1",
         "allocated_amount": 30000.0},
    ]
    sa_rows = [
        {"strategy_id": "uuid-one-point", "returns_series": [{"date": "2026-01-01", "value": 1.01}]},
        {"strategy_id": "uuid-full",
         "returns_series": curve_from_returns([0.0, 0.03, 0.01], _STRAT_DATES)},
    ]
    mock_sb = _build_db(
        "alloc-one-point",
        portfolios=[{"id": "port-1"}], portfolio_strategies=ps_rows, strategy_analytics=sa_rows,
    )
    monkeypatch.setattr("routers.match.get_supabase", lambda: mock_sb)

    result = _load_allocator_context("alloc-one-point")

    assert {ps["strategy_id"] for ps in result["portfolio_strategies"]} == {
        "uuid-one-point", "uuid-full",
    }
    assert result["portfolio_weights"]["uuid-one-point"] == pytest.approx(0.4)  # 20000 / 50000
    assert "uuid-one-point" not in result["portfolio_returns"]
    # uuid-full: levels 1.0, 1.03, 1.0403 -> days 1..2 = 0.03, 0.01
    assert list(result["portfolio_returns"]["uuid-full"].values) == pytest.approx(
        [0.03, 0.01], abs=1e-12
    )


def test_warmup_gate_under_30d(monkeypatch):
    """167.1.1.1 D-01 (the Phase 07 D-03 warm-up, now on priced days): a spot holding with
    fewer than 30 priced days is withheld from the returns by name, and it STAYS in the AUM
    and the weights. It is never zero-filled.

    NOTE per finding f1: plain `def`, no await.
    """
    # BTC gets only 20 priced days (< 30); ETH gets 41 (passes)
    holdings = (
        _mark_rows("alloc-warmup", "BTC", 20, value=50000.0, first_mark=50000.0, end="2026-01-20")
        + _mark_rows("alloc-warmup", "ETH", 41, value=30000.0, first_mark=30000.0, end="2026-01-20")
    )
    mock_sb = _build_db("alloc-warmup", holdings=holdings)
    monkeypatch.setattr("routers.match.get_supabase", lambda: mock_sb)

    result = _load_allocator_context("alloc-warmup")  # NO await

    pseudo_ids = [ps["strategy_id"] for ps in result["portfolio_strategies"]]
    assert "holding:binance:BTC:spot" not in pseudo_ids  # withheld: no return series
    assert "holding:binance:ETH:spot" in pseudo_ids
    assert "holding:binance:BTC:spot" not in result["portfolio_returns"]
    assert [
        (r["symbol"], r["withheld_reason"]) for r in result["_holdings_rows_withheld"]
    ] == [("BTC", "too_few_priced_days")]

    # D-01: the short-history holding keeps its dollars in the AUM and its weight.
    assert result["portfolio_aum"] == pytest.approx(80000.0)
    # CR-01: the SCORING weights cover the joined series only (ETH), so they sum to 1; the
    # withheld BTC has no series and no scoring weight. Its AUM share is what the flags carry.
    assert "holding:binance:BTC:spot" not in result["portfolio_weights"]
    assert result["portfolio_weights"] == {"holding:binance:ETH:spot": pytest.approx(1.0)}
    flags = {
        f["holding_ref"]: f
        for f in compute_holding_flags(
            holdings_rows_eligible=result["_holdings_rows_eligible"],
            holdings_rows_withheld=result["_holdings_rows_withheld"],
            portfolio_returns=result["portfolio_returns"],
            portfolio_weights=result["portfolio_weights"],
            portfolio_aum=result["portfolio_aum"],
            allocator_preferences={},
            scored_candidates_by_slot={},
        )
    }
    assert flags["holding:binance:BTC:spot"]["weight"] == pytest.approx(50000.0 / 80000.0)
    assert flags["holding:binance:ETH:spot"]["weight"] == pytest.approx(30000.0 / 80000.0)


def test_flag_composite_threshold_equals_50():
    """D-06 + RESEARCH A3: composite >= 0.50 on [0,1] scale = score >= 50 on match_engine.py 0..100 scale.

    Also constitutes the constant-parity assertion required by finding f5
    (engine-side vs SSR-side agreement).
    """
    assert FLAG_COMPOSITE_THRESHOLD == 50
