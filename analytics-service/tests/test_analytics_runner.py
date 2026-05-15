"""Tests for analytics-service/services/analytics_runner.py.

Sprint 4 regression and graceful degradation tests:

1. test_is_fill_filter_regression — the trades query uses
   .neq("is_fill", True) to exclude raw fill rows. Verify that inserting
   both daily_pnl (is_fill=false) AND fill rows (is_fill=true) does NOT
   inflate the trade count used by analytics.

2. test_graceful_degradation_position_failure — position_reconstruction
   raising an exception should NOT fail the overall analytics run. The
   runner should complete with computation_status="complete" and set
   data_quality_flags.position_metrics_failed=true.

Phase 12 Plan 06 additions:

3. test_run_strategy_analytics_writes_sibling_kinds — B-01 + H-A1 +
   M-Grok-1: per-kind data lands in strategy_analytics_series via the
   atomic batch upsert RPC.

4. test_run_strategy_analytics_derived_metrics_present — B-01: the merged
   trade_metrics JSONB has the 6 derived keys (expectancy, R:R, weighted
   R:R, SQN, profit_factor_long, profit_factor_short) + trade_mix.
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pandas as pd
import numpy as np
import pytest

from services.metrics import MetricsResult

# audit-2026-05-07 #9 (PR-7 consumer migration): the runner now imports
# `trades_to_daily_returns_with_status` (returns `(returns, meta)` tuple).
# Tests that previously patched the bare `trades_to_daily_returns` name
# break under the new shape because the import no longer exists at the
# old attribute. Use this default meta everywhere a clean (no-warnings)
# transform output is the right test fixture; the helper at
# _run_and_get_success_upsert lower in this file already accepts overrides
# for the heuristic-capital/balance_error branches.
_DEFAULT_RETURNS_META = {
    "used_heuristic_capital": False,
    "balance_error": False,
    "computation_status_hint": "complete",
}


# ---------------------------------------------------------------------------
# Regression: is_fill filter
# ---------------------------------------------------------------------------

class TestIsFillFilterRegression:
    """Verify that the trades query in run_strategy_analytics only returns
    rows where is_fill != True (daily PnL rows), not raw fill rows."""

    @pytest.mark.asyncio
    async def test_is_fill_filter_regression(self) -> None:
        """Insert both daily_pnl (is_fill=false) AND fill rows (is_fill=true)
        for same strategy. Run analytics. Verify the trades query only
        returns is_fill=false rows (result is not inflated by fill data)."""
        from services.analytics_runner import run_strategy_analytics

        # Daily PnL rows (is_fill=false or NULL) — these should be used
        daily_pnl_rows = [
            {
                "id": f"trade-{i}",
                "strategy_id": "strat-test",
                "symbol": "PORTFOLIO",
                "side": "buy" if i % 2 == 0 else "sell",
                "price": 100 + i,
                "quantity": 1,
                "fee": 0,
                "timestamp": f"2024-01-{i+1:02d}T00:00:00+00:00",
                "order_type": "daily_pnl",
                "is_fill": False,
            }
            for i in range(10)
        ]

        # Raw fill rows (is_fill=true) — these should be excluded
        fill_rows = [
            {
                "id": f"fill-{i}",
                "strategy_id": "strat-test",
                "symbol": "BTCUSDT",
                "side": "buy",
                "price": 60000,
                "quantity": 0.1,
                "fee": 0.6,
                "timestamp": f"2024-01-{i+1:02d}T12:00:00+00:00",
                "order_type": "fill",
                "is_fill": True,
            }
            for i in range(5)
        ]

        # Track what the analytics query actually gets
        captured_trades: list = []

        mock_supabase = MagicMock()

        # Build chainable mock for various table() calls
        call_count = {"table": 0}

        def _mock_table(name):
            call_count["table"] += 1
            mock_table = MagicMock()

            if name == "strategies":
                # select("id, user_id").eq("id", ...).single().execute()
                mock_chain = MagicMock()
                mock_chain.execute.return_value = MagicMock(
                    data={"id": "strat-test", "user_id": "user-1", "api_key_id": "key-1"}
                )
                mock_single = MagicMock(return_value=mock_chain)
                mock_eq = MagicMock()
                mock_eq.single = mock_single
                mock_eq.execute = mock_chain.execute
                mock_select = MagicMock()
                mock_select.eq.return_value = mock_eq
                mock_table.select.return_value = mock_select

            elif name == "strategy_analytics":
                mock_upsert = MagicMock()
                mock_upsert.execute.return_value = MagicMock(data=[])
                mock_table.upsert.return_value = mock_upsert

            elif name == "trades":
                mock_select = MagicMock()
                mock_eq_strat = MagicMock()

                def _neq(field, value):
                    """Simulate .neq("is_fill", True) — return only non-fill rows."""
                    mock_neq_result = MagicMock()
                    mock_order = MagicMock()
                    # Only return daily PnL rows (is_fill != True)
                    mock_order.execute.return_value = MagicMock(data=daily_pnl_rows)
                    mock_neq_result.order.return_value = mock_order
                    captured_trades.extend(daily_pnl_rows)
                    return mock_neq_result

                def _eq_fill(field, value):
                    """Simulate .eq("is_fill", True) — return fill rows."""
                    mock_fill_result = MagicMock()
                    mock_fill_result.execute.return_value = MagicMock(data=fill_rows)
                    return mock_fill_result

                mock_eq_strat.neq = _neq
                mock_eq_strat.eq = _eq_fill
                mock_select.eq.return_value = mock_eq_strat
                mock_table.select.return_value = mock_select

            elif name == "api_keys":
                mock_select = MagicMock()
                mock_eq = MagicMock()
                mock_single = MagicMock()
                mock_single.execute.return_value = MagicMock(
                    data={"account_balance_usdt": 10000}
                )
                mock_eq.single.return_value = mock_single
                mock_select.eq.return_value = mock_eq
                mock_table.select.return_value = mock_select

            return mock_table

        mock_supabase.table = _mock_table

        # Mock db_execute to just run the sync function in a thread
        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        # Phase 12 Plan 06: compute_all_metrics now returns MetricsResult dataclass.
        # The mock mirrors that contract — metrics_json carries the top-level
        # dict that gets spread into the strategy_analytics upsert.
        mock_metrics = MetricsResult(
            metrics_json={
                "cumulative_return": 0.1,
                "cagr": 0.12,
                "volatility": 0.2,
                "sharpe": 1.5,
                "sortino": 2.0,
                "calmar": 1.0,
                "max_drawdown": -0.05,
                "max_drawdown_duration_days": 5,
                "six_month_return": 0.06,
                "sparkline_returns": [],
                "sparkline_drawdown": [],
                "metrics_json": {},
                "returns_series": [],
                "drawdown_series": [],
                "monthly_returns": {},
                "rolling_metrics": {},
                "return_quantiles": {},
            },
            sibling_kinds={},
        )

        with patch("services.analytics_runner.get_supabase", return_value=mock_supabase), \
             patch("services.analytics_runner.db_execute", side_effect=_mock_db_execute), \
             patch("services.analytics_runner.trades_to_daily_returns_with_status") as mock_transform, \
             patch("services.analytics_runner.compute_all_metrics", return_value=mock_metrics), \
             patch("services.analytics_runner.get_benchmark_returns", new=AsyncMock(return_value=(None, True))), \
             patch("services.position_reconstruction.reconstruct_positions", new=AsyncMock(return_value={})), \
             patch("services.position_reconstruction.compute_exposure_metrics", new=AsyncMock(return_value={})):

            # trades_to_daily_returns_with_status returns (Series, meta).
            # audit-2026-05-07 #9 — meta is the no-warnings default; this
            # test pins the is_fill filter, not the DQF branches.
            np.random.seed(42)
            dates = pd.bdate_range("2024-01-01", periods=10)
            mock_transform.return_value = (
                pd.Series(np.random.normal(0.001, 0.01, 10), index=dates),
                _DEFAULT_RETURNS_META,
            )

            result = await run_strategy_analytics("strat-test")

        # The key assertion: the transform only received daily_pnl_rows, not fill_rows
        assert mock_transform.call_count == 1
        trades_arg = mock_transform.call_args[0][0]
        # All trades passed to transform should be daily_pnl type, not fills
        for trade in trades_arg:
            assert trade.get("is_fill") is not True, \
                "Fill row leaked into analytics trades — is_fill filter broken"


# ---------------------------------------------------------------------------
# Graceful degradation: position reconstruction failure
# ---------------------------------------------------------------------------

class TestGracefulDegradation:
    """When position_reconstruction raises, analytics_runner should still
    succeed with computation_status='complete' and flag the failure."""

    @pytest.mark.asyncio
    async def test_graceful_degradation_position_failure(self) -> None:
        """Mock position_reconstruction to raise. Verify analytics_runner
        still succeeds and sets data_quality_flags.position_metrics_failed=true."""
        from services.analytics_runner import run_strategy_analytics

        mock_supabase = MagicMock()
        upsert_calls: list[dict] = []

        def _mock_table(name):
            mock_table = MagicMock()

            if name == "strategies":
                mock_chain = MagicMock()
                mock_chain.execute.return_value = MagicMock(
                    data={"id": "strat-test", "user_id": "user-1", "api_key_id": "key-1"}
                )
                mock_single = MagicMock(return_value=mock_chain)
                mock_eq = MagicMock()
                mock_eq.single = mock_single
                mock_eq.execute = mock_chain.execute
                mock_select = MagicMock()
                mock_select.eq.return_value = mock_eq
                mock_table.select.return_value = mock_select

            elif name == "strategy_analytics":
                def _upsert(data, on_conflict=None):
                    upsert_calls.append(data)
                    mock_result = MagicMock()
                    mock_result.execute.return_value = MagicMock(data=[])
                    return mock_result
                mock_table.upsert = _upsert

            elif name == "trades":
                daily_rows = [
                    {
                        "id": f"trade-{i}",
                        "strategy_id": "strat-test",
                        "symbol": "PORTFOLIO",
                        "side": "buy",
                        "price": 100 + i,
                        "quantity": 1,
                        "fee": 0,
                        "timestamp": f"2024-01-{i+1:02d}T00:00:00+00:00",
                        "is_fill": False,
                    }
                    for i in range(10)
                ]
                mock_select = MagicMock()
                mock_eq = MagicMock()
                mock_neq = MagicMock()
                mock_order = MagicMock()
                mock_order.execute.return_value = MagicMock(data=daily_rows)
                mock_neq.order.return_value = mock_order
                mock_eq.neq.return_value = mock_neq
                mock_eq.eq.return_value = MagicMock(
                    execute=MagicMock(return_value=MagicMock(data=[]))
                )
                mock_select.eq.return_value = mock_eq
                mock_table.select.return_value = mock_select

            elif name == "api_keys":
                mock_select = MagicMock()
                mock_eq = MagicMock()
                mock_single = MagicMock()
                mock_single.execute.return_value = MagicMock(
                    data={"account_balance_usdt": 10000}
                )
                mock_eq.single.return_value = mock_single
                mock_select.eq.return_value = mock_eq
                mock_table.select.return_value = mock_select

            return mock_table

        mock_supabase.table = _mock_table

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        # Phase 12 Plan 06: MetricsResult dataclass return contract.
        mock_metrics = MetricsResult(
            metrics_json={
                "cumulative_return": 0.1, "cagr": 0.12, "volatility": 0.2,
                "sharpe": 1.5, "sortino": 2.0, "calmar": 1.0,
                "max_drawdown": -0.05, "max_drawdown_duration_days": 5,
                "six_month_return": 0.06, "sparkline_returns": [],
                "sparkline_drawdown": [], "metrics_json": {},
                "returns_series": [], "drawdown_series": [],
                "monthly_returns": {}, "rolling_metrics": {},
                "return_quantiles": {},
            },
            sibling_kinds={},
        )

        np.random.seed(42)
        dates = pd.bdate_range("2024-01-01", periods=10)
        mock_returns = pd.Series(np.random.normal(0.001, 0.01, 10), index=dates)

        # The key: position_reconstruction raises
        async def _failing_reconstruct(*args, **kwargs):
            raise RuntimeError("DB connection lost during position reconstruction")

        with patch("services.analytics_runner.get_supabase", return_value=mock_supabase), \
             patch("services.analytics_runner.db_execute", side_effect=_mock_db_execute), \
             patch("services.analytics_runner.trades_to_daily_returns_with_status", return_value=(mock_returns, _DEFAULT_RETURNS_META)), \
             patch("services.analytics_runner.compute_all_metrics", return_value=mock_metrics), \
             patch("services.analytics_runner.get_benchmark_returns", new=AsyncMock(return_value=(None, True))), \
             patch("services.position_reconstruction.reconstruct_positions", side_effect=_failing_reconstruct), \
             patch("services.position_reconstruction.compute_exposure_metrics", side_effect=_failing_reconstruct):

            result = await run_strategy_analytics("strat-test")

        assert result["status"] == "complete"

        # Find the upsert call that set data_quality_flags
        flag_upserts = [
            u for u in upsert_calls
            if isinstance(u, dict) and "data_quality_flags" in u
        ]
        # The runner should have flagged position_metrics_failed
        assert any(
            u.get("data_quality_flags", {}).get("position_metrics_failed") is True
            for u in flag_upserts
        ), f"Expected position_metrics_failed=true in upsert calls, got: {upsert_calls}"


# ---------------------------------------------------------------------------
# Phase 12 Plan 05 / METRICS-07 + METRICS-08 — derived trade metrics (B-01 path b)
# ---------------------------------------------------------------------------


def _sample_inputs():
    """Builds (volume_metrics, trade_metrics_from_positions) shaped per B-01 path (b).

    The position-side dict mirrors the extended `reconstruct_positions` return
    shape (Plan 12-05 Task 1 adds avg_winning_trade / avg_losing_trade /
    winners_count / losers_count / realized_pnl_per_trade alongside the
    existing legacy keys).
    """
    volume_metrics = {
        "buy_volume_pct": 0.55,
        "sell_volume_pct": 0.45,
        "long_volume_pct": 0.55,
        "short_volume_pct": 0.45,
        "total_fills": 250,
        "total_volume_usd": 250000.0,
    }
    trade_metrics_from_positions = {
        "total_positions": 50,
        "open_positions": 0,
        "closed_positions": 50,
        "win_rate": 0.6,
        "avg_roi": 0.025,
        "avg_duration_days": 4.0,
        "long_count": 28,
        "short_count": 22,
        "best_trade_roi": 0.40,
        "worst_trade_roi": -0.18,
        # Phase 12 extension (Plan 12-05 adds these to reconstruct_positions):
        "avg_winning_trade": 0.05,    # avg ROI of winners
        "avg_losing_trade": -0.025,   # avg ROI of losers (signed, negative)
        "winners_count": 30,
        "losers_count": 20,
        "realized_pnl_per_trade": [
            {"side": "long", "realized_pnl": 100.0},
            {"side": "long", "realized_pnl": -50.0},
            {"side": "short", "realized_pnl": 200.0},
            {"side": "short", "realized_pnl": -75.0},
            {"side": "long", "realized_pnl": 25.0},
            {"side": "short", "realized_pnl": -10.0},
        ] * 10,  # 60 closed positions; representative
    }
    return volume_metrics, trade_metrics_from_positions


def test_derived_trade_metrics_expectancy():
    """METRICS-07: expectancy = (win_rate × avg_win) - ((1-win_rate) × |avg_loss|)."""
    from services.analytics_runner import _compute_derived_trade_metrics

    v, t = _sample_inputs()
    result = _compute_derived_trade_metrics(v, t)
    assert "expectancy" in result
    wr = t["win_rate"]
    avg_w = t["avg_winning_trade"]
    avg_l = t["avg_losing_trade"]
    expected = wr * avg_w - (1 - wr) * abs(avg_l)
    assert abs(result["expectancy"] - expected) < 1e-6


def test_derived_trade_metrics_risk_reward_ratio():
    """METRICS-07: R:R = avg_win / |avg_loss|."""
    from services.analytics_runner import _compute_derived_trade_metrics

    v, t = _sample_inputs()
    result = _compute_derived_trade_metrics(v, t)
    assert "risk_reward_ratio" in result
    avg_w = t["avg_winning_trade"]
    avg_l = t["avg_losing_trade"]
    assert abs(result["risk_reward_ratio"] - avg_w / abs(avg_l)) < 1e-6


def test_derived_trade_metrics_weighted_risk_reward_ratio():
    """METRICS-07 (H-F): Weighted R:R = Σ(win_size × win_count) / Σ(loss_size × loss_count).

    Implemented as (avg_winning_trade × winners_count) / (|avg_losing_trade| × losers_count).
    """
    from services.analytics_runner import _compute_derived_trade_metrics

    v, t = _sample_inputs()
    result = _compute_derived_trade_metrics(v, t)
    assert "weighted_risk_reward_ratio" in result
    num = t["avg_winning_trade"] * t["winners_count"]
    den = abs(t["avg_losing_trade"]) * t["losers_count"]
    if den == 0:
        assert result["weighted_risk_reward_ratio"] is None
    else:
        assert abs(result["weighted_risk_reward_ratio"] - num / den) < 1e-6


def test_derived_trade_metrics_sqn():
    """METRICS-08: SQN = (mean(R)/std(R)) × sqrt(min(N,100)) over closed positions."""
    from services.analytics_runner import _compute_derived_trade_metrics

    v, t = _sample_inputs()
    result = _compute_derived_trade_metrics(v, t)
    assert "sqn" in result
    assert result["sqn"] is None or isinstance(result["sqn"], float)


def test_derived_trade_metrics_profit_factor_segmented():
    """METRICS-07: separate PF for long and short via realized_pnl_per_trade."""
    from services.analytics_runner import _compute_derived_trade_metrics

    v, t = _sample_inputs()
    result = _compute_derived_trade_metrics(v, t)
    assert "profit_factor_long" in result
    assert "profit_factor_short" in result
    for key in ["profit_factor_long", "profit_factor_short"]:
        assert result[key] is None or isinstance(result[key], (int, float))


def test_derived_trade_metrics_handles_empty_positions():
    """B-01 path (b): every metric returns None when position-side dict is empty/zero."""
    from services.analytics_runner import _compute_derived_trade_metrics

    v = {
        "buy_volume_pct": 0.0,
        "sell_volume_pct": 0.0,
        "long_volume_pct": 0.0,
        "short_volume_pct": 0.0,
        "total_fills": 0,
        "total_volume_usd": 0.0,
    }
    t_empty = {
        "win_rate": 0.0,
        "avg_winning_trade": 0.0,
        "avg_losing_trade": 0.0,
        "winners_count": 0,
        "losers_count": 0,
        "realized_pnl_per_trade": [],
    }
    result = _compute_derived_trade_metrics(v, t_empty)
    assert result["expectancy"] is None
    assert result["risk_reward_ratio"] is None
    assert result["weighted_risk_reward_ratio"] is None
    assert result["sqn"] is None
    assert result["profit_factor_long"] is None
    assert result["profit_factor_short"] is None


# ---------------------------------------------------------------------------
# Phase 12 Plan 05 / METRICS-09 — volume aggregator over raw fills
# Phase 12 Plan 05 / METRICS-10 — Trade Mix (audit-gated 4-bucket vs 2-bucket)
# ---------------------------------------------------------------------------


@pytest.fixture
def sample_fills() -> list[dict]:
    """Fills shaped per `raw_fills WHERE is_fill=true` for METRICS-09 input.

    Each fill has side, notional_usd, holding_period_hours, filled_at — the
    fields the volume aggregator + trade mix consume. Spans 3 distinct days
    in 2 distinct months so daily/monthly turnover have non-trivial denominators.
    """
    return [
        # Day 1 — 2024-01-15
        {"side": "long", "notional_usd": 1000.0, "holding_period_hours": 4.0,
         "filled_at": "2024-01-15T10:00:00+00:00"},
        {"side": "long", "notional_usd": 500.0, "holding_period_hours": 6.0,
         "filled_at": "2024-01-15T14:00:00+00:00"},
        {"side": "short", "notional_usd": 800.0, "holding_period_hours": 2.0,
         "filled_at": "2024-01-15T18:00:00+00:00"},
        # Day 2 — 2024-01-16
        {"side": "long", "notional_usd": 1200.0, "holding_period_hours": 8.0,
         "filled_at": "2024-01-16T11:00:00+00:00"},
        {"side": "short", "notional_usd": 600.0, "holding_period_hours": 3.0,
         "filled_at": "2024-01-16T15:00:00+00:00"},
        # Day 3 — 2024-02-05 (different month for monthly aggregation)
        {"side": "long", "notional_usd": 900.0, "holding_period_hours": 5.0,
         "filled_at": "2024-02-05T09:00:00+00:00"},
    ]


@pytest.fixture
def sample_fills_with_maker_taker(sample_fills) -> list[dict]:
    """Same fills as `sample_fills` but with `is_maker` flag populated.

    Used for the 4-bucket Trade Mix happy-path (TRADE_MIX_HAS_MAKER_TAKER=true).
    Mix of maker / taker so each of the 4 buckets gets non-zero counts.
    """
    pattern = [True, False, True, False, True, False]
    enriched: list[dict] = []
    for fill, is_maker in zip(sample_fills, pattern):
        enriched.append({**fill, "is_maker": is_maker})
    return enriched


def test_volume_aggregator_includes_required_keys(sample_fills):
    """METRICS-09: aggregator returns gross_volume_usd, mean_trade_size_usd,
    daily_turnover_usd, monthly_turnover_usd."""
    from services.analytics_runner import _compute_volume_aggregator

    result = _compute_volume_aggregator(sample_fills)
    for key in [
        "gross_volume_usd",
        "mean_trade_size_usd",
        "daily_turnover_usd",
        "monthly_turnover_usd",
    ]:
        assert key in result


def test_volume_aggregator_empty_fills():
    """METRICS-09: empty fills → every aggregate returns 0.0."""
    from services.analytics_runner import _compute_volume_aggregator

    result = _compute_volume_aggregator([])
    assert result["gross_volume_usd"] == 0.0
    assert result["mean_trade_size_usd"] == 0.0
    assert result["daily_turnover_usd"] == 0.0
    assert result["monthly_turnover_usd"] == 0.0


def test_volume_aggregator_computes_correct_values(sample_fills):
    """METRICS-09: gross_volume = sum(notional); mean = gross/N; daily =
    mean per-day total; monthly = mean per-month total."""
    from services.analytics_runner import _compute_volume_aggregator

    result = _compute_volume_aggregator(sample_fills)
    # gross = 1000 + 500 + 800 + 1200 + 600 + 900 = 5000
    assert abs(result["gross_volume_usd"] - 5000.0) < 1e-6
    # mean trade = 5000 / 6 ≈ 833.33
    assert abs(result["mean_trade_size_usd"] - 5000.0 / 6) < 1e-6
    # 3 distinct days: 2300 (1/15) + 1800 (1/16) + 900 (2/5) = 5000; mean = 5000/3
    assert abs(result["daily_turnover_usd"] - 5000.0 / 3) < 1e-6
    # 2 distinct months: 4100 (jan) + 900 (feb) = 5000; mean = 5000/2
    assert abs(result["monthly_turnover_usd"] - 5000.0 / 2) < 1e-6


def test_trade_mix_4_bucket(sample_fills_with_maker_taker):
    """METRICS-10: 4-bucket Trade Mix when audit passes (D-15 OK)."""
    from services.analytics_runner import _compute_trade_mix

    result = _compute_trade_mix(
        sample_fills_with_maker_taker, has_maker_taker=True
    )
    assert set(result.keys()) == {
        "long_maker", "long_taker", "short_maker", "short_taker"
    }
    for bucket_key in ["long_maker", "long_taker", "short_maker", "short_taker"]:
        bucket = result[bucket_key]
        assert "count" in bucket
        assert "total_notional" in bucket


def test_trade_mix_2_bucket_fallback(sample_fills):
    """METRICS-10: 2-bucket fallback when audit fails (TRADE_MIX_HAS_MAKER_TAKER=false)."""
    from services.analytics_runner import _compute_trade_mix

    result = _compute_trade_mix(sample_fills, has_maker_taker=False)
    assert set(result.keys()) == {"long", "short"}
    for bucket_key in ["long", "short"]:
        bucket = result[bucket_key]
        assert "count" in bucket
        assert "total_notional" in bucket
    # Long: 4 fills → count=4, notional=1000+500+1200+900=3600
    # Short: 2 fills → count=2, notional=800+600=1400
    assert result["long"]["count"] == 4
    assert abs(result["long"]["total_notional"] - 3600.0) < 1e-6
    assert result["short"]["count"] == 2
    assert abs(result["short"]["total_notional"] - 1400.0) < 1e-6


def test_trade_mix_empty_fills():
    """METRICS-10: empty fills → every bucket carries count=0, total_notional=0.0."""
    from services.analytics_runner import _compute_trade_mix

    result_4 = _compute_trade_mix([], has_maker_taker=True)
    assert set(result_4.keys()) == {
        "long_maker", "long_taker", "short_maker", "short_taker"
    }
    assert result_4["long_maker"]["count"] == 0
    assert result_4["long_maker"]["total_notional"] == 0.0

    result_2 = _compute_trade_mix([], has_maker_taker=False)
    assert set(result_2.keys()) == {"long", "short"}
    assert result_2["long"]["count"] == 0
    assert result_2["short"]["count"] == 0


def test_trade_mix_4_bucket_skips_fills_missing_is_maker():
    """METRICS-10 / T-12-05-04: in 4-bucket mode, fills with is_maker=None
    are skipped (cannot bucket into maker/taker without the flag)."""
    from services.analytics_runner import _compute_trade_mix

    fills = [
        {"side": "long", "is_maker": True, "notional_usd": 1000.0},
        # is_maker missing — must be skipped
        {"side": "long", "notional_usd": 500.0},
        {"side": "short", "is_maker": False, "notional_usd": 800.0},
    ]
    result = _compute_trade_mix(fills, has_maker_taker=True)
    assert result["long_maker"]["count"] == 1
    assert result["long_taker"]["count"] == 0  # the missing-flag fill is dropped
    assert result["short_taker"]["count"] == 1
    assert result["short_maker"]["count"] == 0


# ---------------------------------------------------------------------------
# KPI-17: per-strategy is_maker coverage gate (_has_maker_taker_coverage)
# ---------------------------------------------------------------------------


def test_has_maker_taker_coverage_empty_fills_returns_false():
    """No fills → cannot satisfy the audit gate; returns False."""
    from services.analytics_runner import _has_maker_taker_coverage

    assert _has_maker_taker_coverage([]) is False


def test_has_maker_taker_coverage_full_population_returns_true():
    """100% is_maker coverage (typical OKX prod shape) clears the gate."""
    from services.analytics_runner import _has_maker_taker_coverage

    fills = [{"is_maker": True}, {"is_maker": False}, {"is_maker": False}]
    assert _has_maker_taker_coverage(fills) is True


def test_has_maker_taker_coverage_below_threshold_returns_false():
    """Below 99% → falls back to 2-bucket so partial Binance/Bybit ingestion
    can't silently null out a strategy's Trade Mix."""
    from services.analytics_runner import _has_maker_taker_coverage

    # 98 of 100 populated = 98% coverage, below the 99% threshold.
    fills = [{"is_maker": True}] * 98 + [{"is_maker": None}, {}]
    assert _has_maker_taker_coverage(fills) is False


def test_has_maker_taker_coverage_threshold_inclusive():
    """Exactly 99% clears the gate (≥99%, not >99%)."""
    from services.analytics_runner import _has_maker_taker_coverage

    fills = [{"is_maker": True}] * 99 + [{"is_maker": None}]
    assert _has_maker_taker_coverage(fills) is True


def test_has_maker_taker_coverage_handles_missing_key():
    """Fills without an is_maker key count as unpopulated (same as None)."""
    from services.analytics_runner import _has_maker_taker_coverage

    fills = [{"side": "long"}, {"side": "short"}]  # no is_maker key at all
    assert _has_maker_taker_coverage(fills) is False


def test_trade_mix_buy_sell_side_normalized_to_long_short():
    """Raw fills carry buy/sell side from the venue; trade_mix buckets by
    long/short. Without normalization, _compute_trade_mix drops every fill
    and the 4-bucket render shows 0 counts (the bug surfaced in v0.17.1.14
    against the OKX prod fills: 200 fills with side=buy/sell, all dropped)."""
    from services.analytics_runner import _compute_trade_mix

    fills = [
        {"side": "buy", "is_maker": True, "notional_usd": 100.0,
         "holding_period_hours": 1.0},
        {"side": "buy", "is_maker": False, "notional_usd": 100.0,
         "holding_period_hours": 1.0},
        {"side": "sell", "is_maker": True, "notional_usd": 100.0,
         "holding_period_hours": 1.0},
        {"side": "sell", "is_maker": False, "notional_usd": 100.0,
         "holding_period_hours": 1.0},
    ]
    result = _compute_trade_mix(fills, has_maker_taker=True)
    assert result["long_maker"]["count"] == 1
    assert result["long_taker"]["count"] == 1
    assert result["short_maker"]["count"] == 1
    assert result["short_taker"]["count"] == 1


def test_trade_mix_2_bucket_buy_sell_normalized():
    """Same buy/sell normalization in 2-bucket fallback mode."""
    from services.analytics_runner import _compute_trade_mix

    fills = [
        {"side": "buy", "notional_usd": 100.0, "holding_period_hours": 1.0},
        {"side": "buy", "notional_usd": 100.0, "holding_period_hours": 1.0},
        {"side": "sell", "notional_usd": 100.0, "holding_period_hours": 1.0},
    ]
    result = _compute_trade_mix(fills, has_maker_taker=False)
    assert result["long"]["count"] == 2
    assert result["short"]["count"] == 1


# ---------------------------------------------------------------------------
# KPI-17 follow-up: position-side volume attribution
# ---------------------------------------------------------------------------


def test_position_side_volume_pcts_attributes_via_timestamp_window():
    """Fills inside a long-side position's window count as long volume; same
    for short. The classic v0.16.x bug aliased buy_volume_pct as
    long_volume_pct, which double-counted "buy to close short" as long
    volume — this test pins the corrected attribution."""
    from services.analytics_runner import _compute_position_side_volume_pcts

    positions = [
        {"side": "long", "opened_at": "2024-01-01T00:00:00+00:00",
         "closed_at": "2024-01-02T00:00:00+00:00"},
        {"side": "short", "opened_at": "2024-01-03T00:00:00+00:00",
         "closed_at": "2024-01-04T00:00:00+00:00"},
    ]
    fills = [
        {"side": "buy", "cost": 100.0, "timestamp": "2024-01-01T06:00:00+00:00"},
        {"side": "sell", "cost": 100.0, "timestamp": "2024-01-01T18:00:00+00:00"},
        {"side": "sell", "cost": 50.0, "timestamp": "2024-01-03T06:00:00+00:00"},
        {"side": "buy", "cost": 50.0, "timestamp": "2024-01-03T18:00:00+00:00"},
    ]
    result = _compute_position_side_volume_pcts(fills, positions)
    # long_volume = 200, short_volume = 100, total = 300 -> 0.6667 / 0.3333
    assert abs(result["long_volume_pct"] - 0.6667) < 0.001
    assert abs(result["short_volume_pct"] - 0.3333) < 0.001


def test_position_side_volume_pcts_open_position_no_close():
    """Open position (closed_at=None) attributes everything from opened_at
    onward — fills after the open should land in that side."""
    from services.analytics_runner import _compute_position_side_volume_pcts

    positions = [
        {"side": "long", "opened_at": "2024-01-01T00:00:00+00:00",
         "closed_at": None},
    ]
    fills = [
        {"side": "buy", "cost": 100.0, "timestamp": "2024-01-02T00:00:00+00:00"},
        {"side": "sell", "cost": 50.0, "timestamp": "2024-01-03T00:00:00+00:00"},
    ]
    result = _compute_position_side_volume_pcts(fills, positions)
    assert result["long_volume_pct"] == 1.0
    assert result["short_volume_pct"] == 0.0


def test_position_side_volume_pcts_skips_unattributable_fills():
    """A fill whose timestamp falls outside every position window doesn't
    inflate either side."""
    from services.analytics_runner import _compute_position_side_volume_pcts

    positions = [
        {"side": "long", "opened_at": "2024-01-01T00:00:00+00:00",
         "closed_at": "2024-01-02T00:00:00+00:00"},
    ]
    fills = [
        {"side": "buy", "cost": 100.0, "timestamp": "2024-01-01T12:00:00+00:00"},  # in window
        {"side": "sell", "cost": 999.0, "timestamp": "2024-01-10T00:00:00+00:00"},  # outside
    ]
    result = _compute_position_side_volume_pcts(fills, positions)
    # Only the in-window fill is attributed; pct over attributed_total = 100%
    assert result["long_volume_pct"] == 1.0
    assert result["short_volume_pct"] == 0.0


def test_position_side_volume_pcts_empty_inputs_return_zero():
    """No fills or no positions returns 0/0 (frontend renders '—')."""
    from services.analytics_runner import _compute_position_side_volume_pcts

    assert _compute_position_side_volume_pcts([], []) == {
        "long_volume_pct": 0.0, "short_volume_pct": 0.0,
    }
    assert _compute_position_side_volume_pcts(
        [{"side": "buy", "cost": 100.0, "timestamp": "2024-01-01T00:00:00+00:00"}],
        [],
    ) == {"long_volume_pct": 0.0, "short_volume_pct": 0.0}


def test_is_trade_mix_approximate_open_only_short_does_not_fire():
    """Open-only short (closed_at is None) does NOT trigger the chip — its
    sell fill is bucketed correctly as 'short' and there's no closing buy
    in the dataset yet to mis-attribute as 'long'."""
    from services.analytics_runner import _is_trade_mix_approximate

    positions = [
        {"side": "long", "opened_at": "2024-01-01", "closed_at": "2024-01-02"},
        {"side": "short", "opened_at": "2024-01-03", "closed_at": None},
    ]
    assert _is_trade_mix_approximate(positions) is False


def test_is_trade_mix_approximate_closed_short_fires():
    """Closed short means a buy-to-close fill exists in the dataset and
    will be mis-bucketed as a long entry — chip should fire."""
    from services.analytics_runner import _is_trade_mix_approximate

    positions = [
        {"side": "short", "opened_at": "2024-01-01", "closed_at": "2024-01-02"},
    ]
    assert _is_trade_mix_approximate(positions) is True


def test_is_trade_mix_approximate_long_only_does_not_fire():
    """Long-only strategy: the panel labels match fill bucketing for longs
    (buy=long entry). No mis-attribution, so no chip."""
    from services.analytics_runner import _is_trade_mix_approximate

    positions = [
        {"side": "long", "opened_at": "2024-01-01", "closed_at": "2024-01-02"},
        {"side": "long", "opened_at": "2024-01-03", "closed_at": None},
    ]
    assert _is_trade_mix_approximate(positions) is False


def test_is_trade_mix_approximate_empty_positions_does_not_fire():
    """No positions = no mis-attribution risk, no chip."""
    from services.analytics_runner import _is_trade_mix_approximate

    assert _is_trade_mix_approximate([]) is False


# ---------------------------------------------------------------------------
# Account-balance flag-split contract: account_balance_unavailable vs
# no_linked_api_key. The runner emits these as INDEPENDENT booleans into
# data_quality_flags but the writer's control flow guarantees mutual
# exclusion. These tests pin the emission contract by exercising
# `run_strategy_analytics` end-to-end and inspecting the persisted
# strategy_analytics upsert payload — a regression that flips the if/else
# (e.g., setting no_linked_api_key on the exception path) would silently
# mis-classify real failures as demo state. The TS-side tests in
# TradeAndPositionPanel.test.tsx + VolumeExposureTab.test.tsx only lock UI
# rendering given an input flag; they do not lock the Python emission
# decision. Earlier versions of these tests duplicated the if/else
# locally — a tautology that passed against a broken implementation
# (pr-test-analyzer Finding 6 / Task #19).
# ---------------------------------------------------------------------------


def _minimal_daily_rows(n: int = 15) -> list[dict]:
    """Daily PnL rows shaped for analytics_runner — ≥2 rows so the runner
    does not 400 on insufficient history."""
    return [
        {
            "id": f"trade-{i}",
            "strategy_id": "strat-test",
            "symbol": "PORTFOLIO",
            "side": "buy" if i % 2 == 0 else "sell",
            "price": 100 + i,
            "quantity": 1,
            "fee": 0,
            "timestamp": f"2024-01-{i+1:02d}T00:00:00+00:00",
            "is_fill": False,
        }
        for i in range(n)
    ]


def _build_balance_flag_mock_supabase(
    *,
    daily_pnl_rows: list[dict],
    sa_upsert_calls: list[dict],
    strategy_api_key_id: str | None,
    api_key_balance: float | int | None = 10000.0,
    api_keys_raises: bool = False,
    strategies_data_raises_on_get: bool = False,
):
    """Mock factory for balance flag-routing integration tests.

    Each parameter targets one branch in the runner's flag-routing logic:
      - strategy_api_key_id: value returned for strategies.data["api_key_id"]
        (None for demo / paper, a UUID-shaped string for linked exchanges).
      - api_key_balance: value at api_keys.data["account_balance_usdt"].
        Pass None to model "no balance configured" (column null).
      - api_keys_raises: when True, the api_keys lookup raises mid-flight
        (simulates a genuine fetch failure with api_key_id already
        resolved — the path that must emit account_balance_unavailable).
      - strategies_data_raises_on_get: when True, .get("api_key_id") on the
        strategies row throws — covers the rare path where api_key_id
        stays None and an exception fires before resolution can complete,
        which must emit no_linked_api_key (NOT account_balance_unavailable).
    """
    mock = MagicMock()

    def _table(name):
        t = MagicMock()
        if name == "strategies":
            base_data: dict = {
                "id": "strat-test",
                "user_id": "user-1",
                "api_key_id": strategy_api_key_id,
            }
            if strategies_data_raises_on_get:
                # ThrowingDict only overrides .get — __bool__ stays default
                # (truthy for non-empty dict) so the runner's earlier
                # `if not strategy_result.data:` 404 guard is unaffected.
                class _ThrowingDict(dict):
                    def get(self, key, default=None):
                        if key == "api_key_id":
                            raise RuntimeError(
                                "simulated lookup failure before api_key_id resolved"
                            )
                        return super().get(key, default)
                base_data = _ThrowingDict(base_data)
            chain = MagicMock()
            chain.execute.return_value = MagicMock(data=base_data)
            single = MagicMock(return_value=chain)
            eq = MagicMock()
            eq.single = single
            sel = MagicMock()
            sel.eq.return_value = eq
            t.select.return_value = sel
        elif name == "strategy_analytics":
            def _upsert(data, on_conflict=None):
                sa_upsert_calls.append(data)
                r = MagicMock()
                r.execute.return_value = MagicMock(data=[])
                return r
            t.upsert = _upsert
        elif name == "trades":
            sel = MagicMock()
            eq_strat = MagicMock()

            def _neq(field, value):
                r = MagicMock()
                order = MagicMock()
                order.execute.return_value = MagicMock(data=daily_pnl_rows)
                r.order.return_value = order
                return r

            def _eq_fill(field, value):
                r = MagicMock()
                r.execute.return_value = MagicMock(data=[])
                return r

            eq_strat.neq = _neq
            eq_strat.eq = _eq_fill
            sel.eq.return_value = eq_strat
            t.select = MagicMock(return_value=sel)
        elif name == "api_keys":
            sel = MagicMock()
            eq = MagicMock()
            single = MagicMock()
            if api_keys_raises:
                single.execute.side_effect = RuntimeError(
                    "simulated db_execute failure"
                )
            else:
                single.execute.return_value = MagicMock(
                    data={"account_balance_usdt": api_key_balance}
                )
            eq.single.return_value = single
            sel.eq.return_value = eq
            t.select.return_value = sel
        elif name == "trades":
            # Runner fetches raw fills at analytics_runner.py:756 via
            # `.select("side, cost, is_maker, timestamp").eq("strategy_id", ...).eq("is_fill", True)`.
            # Without an explicit stub the default MagicMock chain returns
            # another MagicMock for `.data`, which pollutes
            # `_compute_position_side_volume_pcts` and silently triggers
            # `position_side_volume_failed=True` — a test artifact that
            # contaminates the clean-path computation_status assertion
            # added in the audit-2026-05-07 #9 consumer migration.
            # Returning data=[] keeps fills_data empty so the runner
            # short-circuits the side-volume helper entirely.
            sel = MagicMock()
            eq_strat_t = MagicMock()
            eq_strat_t.execute.return_value = MagicMock(data=[])
            eq_t = MagicMock()
            eq_t.eq.return_value = eq_strat_t
            sel.eq.return_value = eq_t
            t.select.return_value = sel
        elif name == "position_snapshots":
            sel = MagicMock()
            eq = MagicMock()
            order = MagicMock()
            order.execute.return_value = MagicMock(data=[])
            eq.order = MagicMock(return_value=order)
            sel.eq.return_value = eq
            t.select.return_value = sel
        elif name == "positions":
            # Runner queries `positions` at analytics_runner.py:781 inside
            # `if fills_data:`. Tests seed empty fills so the guard is False
            # and we never reach this query — but stubbing the handler
            # avoids a default MagicMock if a future runner refactor moves
            # the query out of the guard. Returning data=[] keeps the
            # downstream _compute_position_side_volume_pcts happy.
            sel = MagicMock()
            eq = MagicMock()
            eq.execute.return_value = MagicMock(data=[])
            sel.eq.return_value = eq
            t.select.return_value = sel
        return t

    mock.table = _table

    def _rpc(name, params):
        r = MagicMock()
        r.execute.return_value = MagicMock(data=None)
        return r

    mock.rpc = _rpc
    return mock


async def _run_and_get_success_upsert(
    mock_supabase,
    sa_upsert_calls: list[dict],
    *,
    daily_rows_count: int = 15,
    used_heuristic_capital: bool = False,
    balance_error: bool = False,
) -> dict:
    """Invoke run_strategy_analytics with the standard patches and return
    the full success-path upsert (computation_status='complete' OR
    'complete_with_warnings' since the audit-2026-05-07 #9 consumer
    migration). Raises if the runner did not reach a success-path upsert.

    `daily_rows_count` keeps the patched returns series the same length
    as the seeded daily rows so a future test that varies the row count
    doesn't silently get a 15-day returns series capping rolling helpers.

    `used_heuristic_capital` / `balance_error` flow into the
    ReturnsComputationMeta returned by the patched
    trades_to_daily_returns_with_status — defaults reproduce the
    pre-migration "no warnings" path.
    """
    from services.analytics_runner import run_strategy_analytics

    async def _mock_db_execute(fn):
        return await asyncio.to_thread(fn)

    dates = pd.bdate_range("2024-01-01", periods=daily_rows_count)
    mock_returns = pd.Series([0.001] * daily_rows_count, index=dates)

    if used_heuristic_capital or balance_error:
        hint = "complete_with_warnings"
    else:
        hint = "complete"
    mock_meta = {
        "used_heuristic_capital": used_heuristic_capital,
        "balance_error": balance_error,
        "computation_status_hint": hint,
    }

    with patch("services.analytics_runner.get_supabase", return_value=mock_supabase), \
         patch("services.analytics_runner.db_execute", side_effect=_mock_db_execute), \
         patch(
             "services.analytics_runner.trades_to_daily_returns_with_status",
             return_value=(mock_returns, mock_meta),
         ), \
         patch("services.analytics_runner.get_benchmark_returns", new=AsyncMock(return_value=(None, True))), \
         patch("services.position_reconstruction.reconstruct_positions", new=AsyncMock(return_value={})), \
         patch("services.position_reconstruction.compute_exposure_metrics", new=AsyncMock(return_value={})):
        result = await run_strategy_analytics("strat-test")

    assert result["status"] == "complete", (
        f"Runner did not finish: {result}. Upserts: {sa_upsert_calls}"
    )

    completes = [
        u for u in sa_upsert_calls
        if u.get("computation_status") in ("complete", "complete_with_warnings")
    ]
    assert completes, (
        f"No success-path upsert captured. All upserts: {sa_upsert_calls!r}"
    )
    return completes[-1]


async def _run_and_get_data_quality_flags(
    mock_supabase, sa_upsert_calls: list[dict], *, daily_rows_count: int = 15,
) -> dict:
    """Backwards-compatible thin wrapper around _run_and_get_success_upsert
    that returns just the data_quality_flags dict for the existing
    balance-flag-routing tests below."""
    upsert = await _run_and_get_success_upsert(
        mock_supabase, sa_upsert_calls, daily_rows_count=daily_rows_count,
    )
    return upsert.get("data_quality_flags") or {}


@pytest.mark.asyncio
async def test_balance_flag_routing_no_api_key_id_emits_no_linked_api_key():
    """api_key_id=None on strategies → only no_linked_api_key=True in
    persisted data_quality_flags. Demo / paper strategies must not be
    classified as degraded — the 2026-04-30 split was added precisely
    so they don't render the 'Approximate' degraded-state chip."""
    sa_upsert_calls: list[dict] = []
    mock_supabase = _build_balance_flag_mock_supabase(
        daily_pnl_rows=_minimal_daily_rows(),
        sa_upsert_calls=sa_upsert_calls,
        strategy_api_key_id=None,
    )
    flags = await _run_and_get_data_quality_flags(mock_supabase, sa_upsert_calls)
    assert flags.get("no_linked_api_key") is True
    assert "account_balance_unavailable" not in flags


@pytest.mark.asyncio
async def test_balance_flag_routing_balance_None_emits_account_balance_unavailable():
    """api_key_id set + balance lookup returns None → only
    account_balance_unavailable=True. Genuine degraded state — operator
    needs to configure balance."""
    sa_upsert_calls: list[dict] = []
    mock_supabase = _build_balance_flag_mock_supabase(
        daily_pnl_rows=_minimal_daily_rows(),
        sa_upsert_calls=sa_upsert_calls,
        strategy_api_key_id="00000000-0000-0000-0000-000000000001",
        api_key_balance=None,
    )
    flags = await _run_and_get_data_quality_flags(mock_supabase, sa_upsert_calls)
    assert flags.get("account_balance_unavailable") is True
    assert "no_linked_api_key" not in flags


@pytest.mark.asyncio
async def test_balance_flag_routing_balance_zero_does_NOT_emit_unavailable():
    """A literal 0.0 balance (drained / operator zeroed) must NOT
    trigger account_balance_unavailable — `is not None` keeps the cases
    distinct. A truthy check would silently mark drained accounts as
    degraded forever."""
    sa_upsert_calls: list[dict] = []
    mock_supabase = _build_balance_flag_mock_supabase(
        daily_pnl_rows=_minimal_daily_rows(),
        sa_upsert_calls=sa_upsert_calls,
        strategy_api_key_id="00000000-0000-0000-0000-000000000001",
        api_key_balance=0.0,
    )
    flags = await _run_and_get_data_quality_flags(mock_supabase, sa_upsert_calls)
    assert "account_balance_unavailable" not in flags
    assert "no_linked_api_key" not in flags


@pytest.mark.asyncio
async def test_balance_flag_routing_exception_with_known_api_key_emits_unavailable():
    """Genuine api_keys fetch failure with a known api_key_id → emit
    account_balance_unavailable, NOT no_linked_api_key. A real outage
    must not be mis-labeled as 'Demo'."""
    sa_upsert_calls: list[dict] = []
    mock_supabase = _build_balance_flag_mock_supabase(
        daily_pnl_rows=_minimal_daily_rows(),
        sa_upsert_calls=sa_upsert_calls,
        strategy_api_key_id="00000000-0000-0000-0000-000000000001",
        api_keys_raises=True,
    )
    flags = await _run_and_get_data_quality_flags(mock_supabase, sa_upsert_calls)
    assert flags.get("account_balance_unavailable") is True
    assert "no_linked_api_key" not in flags


@pytest.mark.asyncio
async def test_balance_flag_routing_exception_with_no_api_key_emits_no_linked():
    """Throw before/during api_key_id resolution (api_key_id stays None)
    → emit no_linked_api_key. A transient lookup failure on a demo
    strategy must not be mis-classified as degraded."""
    sa_upsert_calls: list[dict] = []
    mock_supabase = _build_balance_flag_mock_supabase(
        daily_pnl_rows=_minimal_daily_rows(),
        sa_upsert_calls=sa_upsert_calls,
        strategy_api_key_id=None,
        strategies_data_raises_on_get=True,
    )
    flags = await _run_and_get_data_quality_flags(mock_supabase, sa_upsert_calls)
    assert flags.get("no_linked_api_key") is True
    assert "account_balance_unavailable" not in flags


# ---------------------------------------------------------------------------
# audit-2026-05-07 #9 — PR-7 consumer migration regression
# ---------------------------------------------------------------------------
#
# PR-7 added the `_with_status` API surface in transforms.py /
# exchange.py to plumb (used_heuristic_capital, balance_error) flags
# through to data_quality_flags + computation_status. PR-7's subagent
# explicitly did NOT migrate the consumer (analytics_runner.py) because
# it was outside that PR's allowlist. These tests pin the consumer-side
# contract: the persisted DQF surfaces both flags and computation_status
# upgrades to 'complete_with_warnings' when either fires.


@pytest.mark.asyncio
async def test_consumer_migration_used_heuristic_capital_surfaces_in_dqf_and_status():
    """audit-2026-05-07 #9 — when transforms returns
    used_heuristic_capital=True (heuristic-capital fallback fired
    because account_balance was None / below dust threshold), the
    runner must:

      1. set data_quality_flags.used_heuristic_capital = True; AND
      2. persist computation_status = 'complete_with_warnings'.

    Pre-migration the runner threw away the flag and persisted
    computation_status = 'complete', rendering the heuristic-derived
    CAGR/Sharpe as canonical on the public factsheet (off by 5–10×
    for volatile strategies).
    """
    sa_upsert_calls: list[dict] = []
    mock_supabase = _build_balance_flag_mock_supabase(
        daily_pnl_rows=_minimal_daily_rows(),
        sa_upsert_calls=sa_upsert_calls,
        strategy_api_key_id="00000000-0000-0000-0000-000000000001",
        api_key_balance=10000.0,  # account_balance available, so heuristic
                                  # is NOT suppressed by the no-double-count
                                  # rule — used_heuristic_capital surfaces.
    )
    upsert = await _run_and_get_success_upsert(
        mock_supabase,
        sa_upsert_calls,
        used_heuristic_capital=True,
    )
    flags = upsert.get("data_quality_flags") or {}
    assert flags.get("used_heuristic_capital") is True, (
        f"DQF must surface used_heuristic_capital=True; got: {flags!r}"
    )
    assert upsert.get("computation_status") == "complete_with_warnings", (
        "computation_status must upgrade to 'complete_with_warnings' when "
        f"transforms reports degraded inputs; got: {upsert.get('computation_status')!r}"
    )


@pytest.mark.asyncio
async def test_consumer_migration_balance_error_surfaces_in_dqf_and_status():
    """audit-2026-05-07 #9 — when the upstream pipeline propagates
    balance_error=True into trades_to_daily_returns_with_status, the
    runner must surface DQF.balance_error AND upgrade
    computation_status. Note: the runner itself currently passes
    balance_error=False because analytics_runner reads
    api_keys.account_balance_usdt (a DB column) rather than calling
    the exchange API. Wiring the exchange-API error flag down to this
    consumer requires a balance_error column on api_keys (PR-7c, see
    the migration TODO inline at the call-site). This test uses the
    helper to inject balance_error=True so the consumer's branch is
    pinned; once PR-7c lands the call-site flips from
    balance_error=False to the api_keys column read.
    """
    sa_upsert_calls: list[dict] = []
    mock_supabase = _build_balance_flag_mock_supabase(
        daily_pnl_rows=_minimal_daily_rows(),
        sa_upsert_calls=sa_upsert_calls,
        strategy_api_key_id="00000000-0000-0000-0000-000000000001",
        api_key_balance=10000.0,
    )
    upsert = await _run_and_get_success_upsert(
        mock_supabase,
        sa_upsert_calls,
        balance_error=True,
    )
    flags = upsert.get("data_quality_flags") or {}
    assert flags.get("balance_error") is True, (
        f"DQF must surface balance_error=True; got: {flags!r}"
    )
    assert upsert.get("computation_status") == "complete_with_warnings", (
        "computation_status must upgrade to 'complete_with_warnings' when "
        f"balance_error fires; got: {upsert.get('computation_status')!r}"
    )


@pytest.mark.asyncio
async def test_consumer_migration_section_flag_alone_keeps_status_complete():
    """Frontend-consumer compatibility pin: when ONLY a section-level
    flag fires (no_linked_api_key in this case — set when api_key_id
    is None) and used_heuristic_capital / balance_error are both
    False, the runner MUST keep computation_status='complete'.

    Eight frontend consumers gate exact-string on
    `computation_status === "complete"` (factsheet PDFs, discovery,
    strategy detail, portfolios, PerformanceReport, SyncProgress,
    queries). Promoting status on every section flag would break
    PDF rendering and hide metric grids on every demo strategy.
    Migrating those consumers to accept both states is a separate
    follow-up PR; until then ONLY the audit-2026-05-07 #9 consumer
    flags (used_heuristic_capital, balance_error) upgrade status.
    """
    sa_upsert_calls: list[dict] = []
    mock_supabase = _build_balance_flag_mock_supabase(
        daily_pnl_rows=_minimal_daily_rows(),
        sa_upsert_calls=sa_upsert_calls,
        strategy_api_key_id=None,  # → no_linked_api_key flag fires
    )
    upsert = await _run_and_get_success_upsert(mock_supabase, sa_upsert_calls)
    flags = upsert.get("data_quality_flags") or {}
    assert flags.get("no_linked_api_key") is True
    assert "used_heuristic_capital" not in flags
    assert "balance_error" not in flags
    assert upsert.get("computation_status") == "complete", (
        "Section-level DQF flags must NOT promote computation_status "
        "(would break frontend gates that exact-match 'complete'); "
        f"got: {upsert.get('computation_status')!r}"
    )


@pytest.mark.asyncio
async def test_consumer_migration_no_double_count_when_account_balance_unavailable():
    """Red-team finding: when account_balance_unavailable fires AND
    the heuristic-capital path also activates (because account_balance
    is None as a downstream consequence), the runner must NOT
    double-surface both flags. The factsheet would render two
    redundant 'approximate' chips for one underlying state.

    Suppression rule (analytics_runner.py:961+): used_heuristic_capital
    is gated `not (account_balance_unavailable or no_linked_api_key)`.
    """
    sa_upsert_calls: list[dict] = []
    mock_supabase = _build_balance_flag_mock_supabase(
        daily_pnl_rows=_minimal_daily_rows(),
        sa_upsert_calls=sa_upsert_calls,
        strategy_api_key_id="00000000-0000-0000-0000-000000000001",
        api_key_balance=None,  # → account_balance_unavailable
    )
    # Inject heuristic-capital=True via the helper to simulate the
    # downstream consequence — same shape as if production transforms
    # fell into the heuristic branch because account_balance was None.
    upsert = await _run_and_get_success_upsert(
        mock_supabase, sa_upsert_calls, used_heuristic_capital=True,
    )
    flags = upsert.get("data_quality_flags") or {}
    assert flags.get("account_balance_unavailable") is True
    assert "used_heuristic_capital" not in flags, (
        "used_heuristic_capital must be suppressed when "
        "account_balance_unavailable already fires (one root cause, "
        f"not two). got: {flags!r}"
    )
    assert upsert.get("computation_status") == "complete", (
        "computation_status stays 'complete' when only section flags "
        f"fire; got: {upsert.get('computation_status')!r}"
    )


@pytest.mark.asyncio
async def test_consumer_migration_clean_path_does_not_leak_consumer_specific_keys():
    """Negative regression: when transforms reports no warnings
    (used_heuristic_capital=False, balance_error=False), the runner
    must NOT surface either of the two new DQF keys. Guards against
    the consumer leaking spurious 'used_heuristic_capital' /
    'balance_error' chips on every successful run.

    NOTE on computation_status: `_run_and_get_success_upsert` patches
    `get_benchmark_returns` to `(None, True)` which sets
    `benchmark_unavailable=True` in DQF. Per the contract documented
    in transforms.py::_build_meta and implemented at
    analytics_runner.py:971+ (the OR), ANY DQF flag promotes status
    to 'complete_with_warnings'. So we cannot assert
    status=='complete' here without also stubbing the benchmark; we
    only assert the two consumer-specific keys are absent.
    `test_consumer_migration_used_heuristic_capital_*` /
    `..._balance_error_*` cover the positive paths.
    """
    sa_upsert_calls: list[dict] = []
    mock_supabase = _build_balance_flag_mock_supabase(
        daily_pnl_rows=_minimal_daily_rows(),
        sa_upsert_calls=sa_upsert_calls,
        strategy_api_key_id="00000000-0000-0000-0000-000000000001",
        api_key_balance=10000.0,
    )
    upsert = await _run_and_get_success_upsert(mock_supabase, sa_upsert_calls)
    flags = upsert.get("data_quality_flags") or {}
    assert "used_heuristic_capital" not in flags, (
        f"Consumer must not set used_heuristic_capital on a clean run; got: {flags!r}"
    )
    assert "balance_error" not in flags, (
        f"Consumer must not set balance_error on a clean run; got: {flags!r}"
    )


def test_volume_metrics_no_longer_aliases_long_to_buy():
    """_compute_volume_metrics dropped the misleading long_volume_pct /
    short_volume_pct aliases that copied buy/sell percentages. Those
    fields now come from _compute_position_side_volume_pcts so the field
    name reflects the actual computation."""
    from services.analytics_runner import _compute_volume_metrics

    fills = [
        {"side": "buy", "cost": 100.0},
        {"side": "sell", "cost": 200.0},
    ]
    result = _compute_volume_metrics(fills)
    assert "buy_volume_pct" in result
    assert "sell_volume_pct" in result
    # Misleading aliases gone
    assert "long_volume_pct" not in result
    assert "short_volume_pct" not in result


# ---------------------------------------------------------------------------
# Audit 2026-05-07 G12.G.4 — _compute_volume_metrics edge-case coverage
# ---------------------------------------------------------------------------


class TestComputeVolumeMetrics:
    """Audit 2026-05-07 G12.G.4 regression: the helper had zero test
    coverage for the data-quality cases that come up in production
    (negative cost from rebates / exchange adjustments, zero cost from
    a price=0 or qty=0 fill, missing 'cost' key, capitalized 'Buy',
    empty side string). All paths must produce sane percentages bounded
    [0, 1] and a non-negative total_volume_usd.
    """

    def test_basic_buy_sell_split(self) -> None:
        from services.analytics_runner import _compute_volume_metrics

        result = _compute_volume_metrics(
            [
                {"side": "buy", "cost": 100.0},
                {"side": "sell", "cost": 100.0},
            ],
        )
        assert result["buy_volume_pct"] == 0.5
        assert result["sell_volume_pct"] == 0.5
        assert result["total_volume_usd"] == 200.0
        assert result["total_fills"] == 2

    def test_empty_fills_list(self) -> None:
        from services.analytics_runner import _compute_volume_metrics

        result = _compute_volume_metrics([])
        # No division-by-zero, all percentages 0, total 0.
        assert result["buy_volume_pct"] == 0.0
        assert result["sell_volume_pct"] == 0.0
        assert result["total_volume_usd"] == 0.0
        assert result["total_fills"] == 0

    def test_negative_cost_does_not_skew_percentages_above_one(self) -> None:
        """Negative cost (rebate / exchange-side adjustment) MUST NOT
        produce buy_pct or sell_pct outside [0, 1]. Pre-audit code summed
        the signed cost: a fill with cost=-50 inflated the side
        asymmetrically and could yield percentages > 1 or < 0. The fix
        takes abs(cost) so volume is treated as a magnitude.
        """
        from services.analytics_runner import _compute_volume_metrics

        result = _compute_volume_metrics(
            [
                {"side": "buy", "cost": 100.0},
                {"side": "sell", "cost": -50.0},  # rebate
            ],
        )
        # Each percentage is in [0, 1].
        assert 0.0 <= result["buy_volume_pct"] <= 1.0
        assert 0.0 <= result["sell_volume_pct"] <= 1.0
        # Sum of buy + sell <= 1.0 (no over-attribution).
        assert (
            result["buy_volume_pct"] + result["sell_volume_pct"]
            <= 1.0 + 1e-9
        )
        # total_volume_usd is the absolute sum of magnitudes (100 + 50).
        assert result["total_volume_usd"] >= 0
        assert result["total_volume_usd"] == 150.0

    def test_zero_cost_fills_dont_break_totals(self) -> None:
        """Fills with cost=0 (price=0 or qty=0) MUST NOT cause a
        division-by-zero. Total_volume stays correct.
        """
        from services.analytics_runner import _compute_volume_metrics

        result = _compute_volume_metrics(
            [
                {"side": "buy", "cost": 0.0},
                {"side": "sell", "cost": 0.0},
            ],
        )
        # Percentages collapse to 0 (no volume to attribute).
        assert result["buy_volume_pct"] == 0.0
        assert result["sell_volume_pct"] == 0.0
        assert result["total_volume_usd"] == 0.0
        assert result["total_fills"] == 2

    def test_missing_cost_key_defaults_to_zero(self) -> None:
        """Fills with no 'cost' key (upstream parser bug, missing column)
        MUST NOT raise KeyError or crash the analytics run.
        """
        from services.analytics_runner import _compute_volume_metrics

        result = _compute_volume_metrics(
            [
                {"side": "buy"},  # missing cost
                {"side": "sell", "cost": 100.0},
            ],
        )
        # The fill with missing cost contributes 0 to total/buy.
        assert result["buy_volume_pct"] == 0.0
        assert result["sell_volume_pct"] == 1.0
        assert result["total_volume_usd"] == 100.0

    def test_capitalized_side_is_normalized(self) -> None:
        """'Buy', 'BUY', 'sell', 'SELL' all fold into the lowercase
        comparison branches.
        """
        from services.analytics_runner import _compute_volume_metrics

        result = _compute_volume_metrics(
            [
                {"side": "Buy", "cost": 100.0},
                {"side": "SELL", "cost": 100.0},
            ],
        )
        assert result["buy_volume_pct"] == 0.5
        assert result["sell_volume_pct"] == 0.5
        assert result["total_volume_usd"] == 200.0

    def test_empty_side_contributes_to_total_but_neither_bucket(self) -> None:
        """Fills with empty/unknown side strings contribute volume to the
        total (so the figure stays accurate) but to neither buy nor sell.
        Caller can detect the residual via 1 - buy_pct - sell_pct.
        """
        from services.analytics_runner import _compute_volume_metrics

        result = _compute_volume_metrics(
            [
                {"side": "buy", "cost": 100.0},
                {"side": "", "cost": 50.0},  # unknown side
                {"side": None, "cost": 25.0},  # null side
            ],
        )
        # Buy is 100/175 ≈ 0.5714; sell is 0; residual is 75/175 ≈ 0.4286.
        assert 0.0 <= result["buy_volume_pct"] <= 1.0
        assert result["sell_volume_pct"] == 0.0
        assert (
            result["buy_volume_pct"] + result["sell_volume_pct"]
            <= 1.0 + 1e-9
        )
        assert result["total_volume_usd"] == 175.0

    def test_non_numeric_cost_defaults_to_zero(self) -> None:
        """A string cost from a malformed upstream payload MUST NOT crash
        the runner. It defaults to 0 and the fill contributes nothing to
        the totals.
        """
        from services.analytics_runner import _compute_volume_metrics

        result = _compute_volume_metrics(
            [
                {"side": "buy", "cost": "garbage"},
                {"side": "sell", "cost": 100.0},
            ],
        )
        assert result["buy_volume_pct"] == 0.0
        assert result["sell_volume_pct"] == 1.0
        assert result["total_volume_usd"] == 100.0


# ---------------------------------------------------------------------------
# Phase 12 Plan 06 / METRICS-15 / METRICS-17 — runner integration smoke tests
# ---------------------------------------------------------------------------
# These verify the full B-01 + H-A1 + M-Grok-1 wiring inside
# run_strategy_analytics:
#   - merged trade_metrics JSONB carries the 6 derived keys + trade_mix
#   - sibling-table writes go through the atomic batch RPC
#     `upsert_strategy_analytics_series_batch` (NOT a per-kind loop)
#   - exposure_series + turnover_series populate when position_snapshots
#     are present
# Mocking pattern mirrors the existing `test_is_fill_filter_regression` /
# `test_graceful_degradation_position_failure` tests above.


def _build_runner_mock_supabase(
    *,
    daily_pnl_rows: list[dict],
    fills_rows: list[dict],
    snapshot_rows: list[dict],
    rpc_calls: list[dict],
    sa_upsert_calls: list[dict],
    trades_select_calls: list[str] | None = None,
):
    """Shared MagicMock factory for the Plan 06 smoke tests.

    Captures:
      - rpc_calls: every supabase.rpc(name, params) invocation
      - sa_upsert_calls: every strategy_analytics.upsert(data) invocation
      - trades_select_calls (optional): every trades.select(cols) column list
        — pass `[]` to capture; pin the projection in regression tests so a
        future PostgREST 42703 doesn't go latent again.
    """
    mock = MagicMock()

    def _table(name):
        t = MagicMock()
        if name == "strategies":
            chain = MagicMock()
            chain.execute.return_value = MagicMock(
                data={
                    "id": "strat-test",
                    "user_id": "user-1",
                    "api_key_id": "key-1",
                }
            )
            single = MagicMock(return_value=chain)
            eq = MagicMock()
            eq.single = single
            eq.execute = chain.execute
            sel = MagicMock()
            sel.eq.return_value = eq
            t.select.return_value = sel
        elif name == "strategy_analytics":
            def _upsert(data, on_conflict=None):
                sa_upsert_calls.append(data)
                r = MagicMock()
                r.execute.return_value = MagicMock(data=[])
                return r
            t.upsert = _upsert
        elif name == "trades":
            sel = MagicMock()
            eq_strat = MagicMock()

            def _neq(field, value):
                # is_fill != True → daily PnL rows for the qstats path
                r = MagicMock()
                order = MagicMock()
                order.execute.return_value = MagicMock(data=daily_pnl_rows)
                r.order.return_value = order
                return r

            def _eq_fill(field, value):
                # is_fill = True → raw fills for B-01 path b
                r = MagicMock()
                r.execute.return_value = MagicMock(data=fills_rows)
                return r

            eq_strat.neq = _neq
            eq_strat.eq = _eq_fill
            sel.eq.return_value = eq_strat

            def _select(cols):
                if trades_select_calls is not None:
                    trades_select_calls.append(cols)
                return sel

            t.select = _select
        elif name == "api_keys":
            sel = MagicMock()
            eq = MagicMock()
            single = MagicMock()
            single.execute.return_value = MagicMock(
                data={"account_balance_usdt": 10000}
            )
            eq.single.return_value = single
            sel.eq.return_value = eq
            t.select.return_value = sel
        elif name == "position_snapshots":
            # H-A1: position_snapshots is BOTH the position grid AND the
            # price grid source — _load_position_time_series consumes it.
            sel = MagicMock()
            eq = MagicMock()
            order = MagicMock()
            order.execute.return_value = MagicMock(data=snapshot_rows)
            eq.order = MagicMock(return_value=order)
            sel.eq.return_value = eq
            t.select.return_value = sel
        return t

    mock.table = _table

    def _rpc(name, params):
        rpc_calls.append({"name": name, "params": params})
        r = MagicMock()
        r.execute.return_value = MagicMock(data=None)
        return r

    mock.rpc = _rpc
    return mock


def _sample_position_snapshot_rows() -> list[dict]:
    """Two days of snapshots for a single symbol — enough to make
    compute_turnover_series produce a non-empty series."""
    return [
        {
            "snapshot_date": "2024-01-15",
            "symbol": "BTCUSDT",
            "side": "long",
            "size_usd": "10000",
            "mark_price": "65000",
        },
        {
            "snapshot_date": "2024-01-16",
            "symbol": "BTCUSDT",
            "side": "long",
            "size_usd": "12000",
            "mark_price": "66000",
        },
    ]


@pytest.mark.asyncio
async def test_run_strategy_analytics_writes_sibling_kinds() -> None:
    """B-01 + H-A1 + M-Grok-1: sibling kinds land via the atomic batch RPC.

    Asserts:
      - supabase.rpc("upsert_strategy_analytics_series_batch", ...) called
      - payload contains expected sibling kinds (10 from metrics.py + 2 from runner)
      - exposure_series + turnover_series present when position_snapshots non-empty
    """
    from services.analytics_runner import run_strategy_analytics

    daily_rows = [
        {
            "id": f"trade-{i}",
            "strategy_id": "strat-test",
            "symbol": "PORTFOLIO",
            "side": "buy" if i % 2 == 0 else "sell",
            "price": 100 + i,
            "quantity": 1,
            "fee": 0,
            "timestamp": f"2024-01-{i+1:02d}T00:00:00+00:00",
            "is_fill": False,
        }
        for i in range(120)  # ≥90 days so rolling helpers populate
    ]
    rpc_calls: list[dict] = []
    sa_upsert_calls: list[dict] = []
    snap_rows = _sample_position_snapshot_rows()

    mock_supabase = _build_runner_mock_supabase(
        daily_pnl_rows=daily_rows,
        fills_rows=[],
        snapshot_rows=snap_rows,
        rpc_calls=rpc_calls,
        sa_upsert_calls=sa_upsert_calls,
    )

    async def _mock_db_execute(fn):
        return await asyncio.to_thread(fn)

    np.random.seed(7)
    dates = pd.bdate_range("2024-01-01", periods=120)
    mock_returns = pd.Series(np.random.normal(0.001, 0.01, 120), index=dates)

    bench_dates = pd.bdate_range("2024-01-01", periods=120)
    mock_benchmark = pd.Series(
        np.random.normal(0.0005, 0.015, 120), index=bench_dates, name="BTC"
    )

    # Make compute_exposure_metrics return a real exposure_series so it
    # gets piped into sibling_kinds. Mirror the Plan 12-04 contract:
    # {mean/std/max gross/net + exposure_series}.
    fake_exposure = {
        "mean_gross_exposure": 11000.0,
        "std_gross_exposure": 1414.21,
        "max_gross_exposure": 12000.0,
        "mean_net_exposure": 11000.0,
        "std_net_exposure": 1414.21,
        "max_net_exposure": 12000.0,
        "exposure_series": [
            {"date": "2024-01-15", "gross": 10000.0, "net": 10000.0},
            {"date": "2024-01-16", "gross": 12000.0, "net": 12000.0},
        ],
    }

    with patch("services.analytics_runner.get_supabase", return_value=mock_supabase), \
         patch("services.analytics_runner.db_execute", side_effect=_mock_db_execute), \
         patch("services.analytics_runner.trades_to_daily_returns_with_status", return_value=(mock_returns, _DEFAULT_RETURNS_META)), \
         patch("services.analytics_runner.get_benchmark_returns", new=AsyncMock(return_value=(mock_benchmark, False))), \
         patch("services.position_reconstruction.reconstruct_positions", new=AsyncMock(return_value={})), \
         patch("services.position_reconstruction.compute_exposure_metrics", new=AsyncMock(return_value=fake_exposure)):
        result = await run_strategy_analytics("strat-test")

    assert result["status"] == "complete"

    # M-Grok-1: assert the atomic batch RPC was called.
    batch_calls = [
        c for c in rpc_calls
        if c["name"] == "upsert_strategy_analytics_series_batch"
    ]
    assert len(batch_calls) == 1, (
        f"Expected exactly one batch RPC call, got {len(batch_calls)}: "
        f"{[c['name'] for c in rpc_calls]}"
    )
    params = batch_calls[0]["params"]
    assert params["p_strategy_id"] == "strat-test"
    kinds_payload = params["p_kinds"]

    # Required sibling kinds always populated:
    assert "daily_returns_grid" in kinds_payload
    assert "rolling_sortino_3m" in kinds_payload
    assert "log_returns_series" in kinds_payload

    # H-A1: exposure_series + turnover_series populated from real
    # position_snapshots-derived data (NOT silently skipped).
    assert "exposure_series" in kinds_payload, (
        "H-A1 violated: exposure_series missing from sibling_kinds"
    )
    assert "turnover_series" in kinds_payload, (
        "H-A1 violated: turnover_series missing from sibling_kinds"
    )


@pytest.mark.asyncio
async def test_run_strategy_analytics_derived_metrics_present() -> None:
    """B-01: trade_metrics JSONB has the 6 derived keys + trade_mix after
    run_strategy_analytics merges fill-side + position-side dicts."""
    from services.analytics_runner import run_strategy_analytics

    daily_rows = [
        {
            "id": f"trade-{i}",
            "strategy_id": "strat-test",
            "symbol": "PORTFOLIO",
            "side": "buy" if i % 2 == 0 else "sell",
            "price": 100 + i,
            "quantity": 1,
            "fee": 0,
            "timestamp": f"2024-01-{i+1:02d}T00:00:00+00:00",
            "is_fill": False,
        }
        for i in range(15)
    ]
    fills_rows = [
        {
            "side": "long",
            "cost": 100.0,
            "is_maker": True,
            "notional_usd": 1000.0,
            "holding_period_hours": 4.0,
            "filled_at": "2024-01-15T10:00:00+00:00",
        },
        {
            "side": "short",
            "cost": 80.0,
            "is_maker": False,
            "notional_usd": 800.0,
            "holding_period_hours": 2.0,
            "filled_at": "2024-01-15T14:00:00+00:00",
        },
    ]
    rpc_calls: list[dict] = []
    sa_upsert_calls: list[dict] = []

    mock_supabase = _build_runner_mock_supabase(
        daily_pnl_rows=daily_rows,
        fills_rows=fills_rows,
        snapshot_rows=[],
        rpc_calls=rpc_calls,
        sa_upsert_calls=sa_upsert_calls,
    )

    async def _mock_db_execute(fn):
        return await asyncio.to_thread(fn)

    np.random.seed(11)
    dates = pd.bdate_range("2024-01-01", periods=15)
    mock_returns = pd.Series(np.random.normal(0.001, 0.01, 15), index=dates)

    # Position-side dict that exercises ALL 6 derived metrics — winners,
    # losers, both sides represented in realized_pnl_per_trade.
    fake_position_metrics = {
        "total_positions": 6,
        "open_positions": 0,
        "closed_positions": 6,
        "win_rate": 0.5,
        "avg_roi": 0.0,
        "avg_duration_days": 1.0,
        "long_count": 3,
        "short_count": 3,
        "best_trade_roi": 0.20,
        "worst_trade_roi": -0.10,
        "avg_winning_trade": 0.10,
        "avg_losing_trade": -0.05,
        "winners_count": 3,
        "losers_count": 3,
        "realized_pnl_per_trade": [
            {"side": "long", "realized_pnl": 100.0},
            {"side": "long", "realized_pnl": -50.0},
            {"side": "short", "realized_pnl": 200.0},
            {"side": "short", "realized_pnl": -75.0},
            {"side": "long", "realized_pnl": 25.0},
            {"side": "short", "realized_pnl": -10.0},
        ],
    }

    with patch("services.analytics_runner.get_supabase", return_value=mock_supabase), \
         patch("services.analytics_runner.db_execute", side_effect=_mock_db_execute), \
         patch("services.analytics_runner.trades_to_daily_returns_with_status", return_value=(mock_returns, _DEFAULT_RETURNS_META)), \
         patch("services.analytics_runner.get_benchmark_returns", new=AsyncMock(return_value=(None, True))), \
         patch("services.position_reconstruction.reconstruct_positions", new=AsyncMock(return_value=fake_position_metrics)), \
         patch("services.position_reconstruction.compute_exposure_metrics", new=AsyncMock(return_value={})):
        result = await run_strategy_analytics("strat-test")

    assert result["status"] == "complete"

    # Find the strategy_analytics upsert that carries trade_metrics
    # (the success-path upsert; the initial computing-status upsert has no
    # trade_metrics key).
    tm_upserts = [u for u in sa_upsert_calls if "trade_metrics" in u]
    assert tm_upserts, (
        f"Expected at least one upsert with trade_metrics. "
        f"All upserts: {sa_upsert_calls}"
    )
    tm = tm_upserts[-1]["trade_metrics"]

    # B-01 / METRICS-07 / METRICS-08 / H-F:
    assert "expectancy" in tm
    assert "risk_reward_ratio" in tm
    assert "weighted_risk_reward_ratio" in tm  # H-F
    assert "sqn" in tm
    assert "profit_factor_long" in tm
    assert "profit_factor_short" in tm
    assert "trade_mix" in tm


@pytest.mark.asyncio
async def test_run_strategy_analytics_pins_fills_select_column_list() -> None:
    """KPI-17 follow-up: pin the trades-fills SELECT column list.

    PR #96 (v0.17.1.14) narrowed the projection to columns that actually exist
    in the trades schema (`side, cost, is_maker, timestamp`). The prior list
    (`notional_usd, holding_period_hours, filled_at, created_at`) hit
    PostgREST 42703 ("column does not exist") and was swallowed by the
    fills-fetch try/except — analytics ran with empty fills for ~3 versions
    until the cascade became visible.

    Pin the column string so any future drift (a column rename, a typo on
    re-add, a copy-paste from a sibling helper) surfaces in CI instead of
    going latent again.
    """
    from services.analytics_runner import run_strategy_analytics

    rpc_calls: list[dict] = []
    sa_upsert_calls: list[dict] = []
    trades_select_calls: list[str] = []

    daily_rows = [
        {
            "id": f"trade-{i}",
            "strategy_id": "strat-test",
            "symbol": "PORTFOLIO",
            "side": "buy" if i % 2 == 0 else "sell",
            "price": 100 + i,
            "quantity": 1,
            "fee": 0,
            "timestamp": f"2024-01-{i+1:02d}T00:00:00+00:00",
            "is_fill": False,
        }
        for i in range(10)
    ]
    mock_supabase = _build_runner_mock_supabase(
        daily_pnl_rows=daily_rows,
        fills_rows=[],
        snapshot_rows=[],
        rpc_calls=rpc_calls,
        sa_upsert_calls=sa_upsert_calls,
        trades_select_calls=trades_select_calls,
    )

    async def _mock_db_execute(fn):
        return await asyncio.to_thread(fn)

    dates = pd.bdate_range("2024-01-01", periods=10)
    mock_returns = pd.Series([0.001] * 10, index=dates)

    with patch("services.analytics_runner.get_supabase", return_value=mock_supabase), \
         patch("services.analytics_runner.db_execute", side_effect=_mock_db_execute), \
         patch("services.analytics_runner.trades_to_daily_returns_with_status", return_value=(mock_returns, _DEFAULT_RETURNS_META)), \
         patch("services.analytics_runner.get_benchmark_returns", new=AsyncMock(return_value=(None, True))), \
         patch("services.position_reconstruction.reconstruct_positions", new=AsyncMock(return_value={})), \
         patch("services.position_reconstruction.compute_exposure_metrics", new=AsyncMock(return_value={})):
        await run_strategy_analytics("strat-test")

    fills_selects = [
        c for c in trades_select_calls
        if "is_maker" in c or "cost" in c
    ]
    assert fills_selects, (
        "Expected at least one fills SELECT with is_maker/cost. "
        f"All trades.select() column-lists captured: {trades_select_calls!r}"
    )
    columns = fills_selects[0]
    assert "is_maker" in columns
    assert "cost" in columns
    assert "side" in columns
    assert "timestamp" in columns
    assert "notional_usd" not in columns, (
        f"trades schema has no notional_usd column (PostgREST 42703 — see PR #96). "
        f"Found in select: {columns!r}"
    )
    assert "holding_period_hours" not in columns, (
        f"trades schema has no holding_period_hours column. Found: {columns!r}"
    )
    assert "filled_at" not in columns, (
        f"trades schema has no filled_at column (it is `timestamp`). "
        f"Found: {columns!r}"
    )
    assert "created_at" not in columns, (
        f"trades schema has no created_at column on fills. Found: {columns!r}"
    )


# ---------------------------------------------------------------------------
# Audit-2026-05-07 round-2 / red-team CRIT-1 + CRIT-2 follow-up:
# inner `data_quality_flags` from reconstruct_positions and the new
# turnover-series flags MUST be lifted to the top-level
# `strategy_analytics.data_quality_flags` column the dashboard reads.
# Pre-fix, the inner dict was buried inside `trade_metrics.data_quality_flags`
# (nested JSONB) and the turnover wrapper discarded its flags entirely.
# ---------------------------------------------------------------------------


class TestPositionFlagsPropagateToTopLevel:
    """Pin the round-trip: position-reconstruction inner flags + turnover
    flags reach `strategy_analytics.data_quality_flags` in the upsert."""

    @pytest.mark.asyncio
    async def test_inner_breakeven_and_missing_pnl_flags_reach_top_level(
        self,
    ) -> None:
        """reconstruct_positions returns inner flags
        `{breakeven_positions: 2, positions_missing_realized_pnl: 1}`. The
        runner must merge them into the top-level data_quality_flags
        column (not just leave them nested inside trade_metrics)."""
        from services.analytics_runner import run_strategy_analytics

        sa_upsert_calls: list[dict] = []
        mock_supabase = _build_balance_flag_mock_supabase(
            daily_pnl_rows=_minimal_daily_rows(),
            sa_upsert_calls=sa_upsert_calls,
            strategy_api_key_id="key-1",
        )

        # Craft a reconstruct_positions return value containing inner flags.
        position_flags = {
            "breakeven_positions": 2,
            "positions_missing_realized_pnl": 1,
        }
        crafted_trade_metrics = {
            "total_positions": 3,
            "open_positions": 0,
            "closed_positions": 3,
            "win_rate": 0.0,
            "avg_roi": 0.0,
            "winners_count": 0,
            "losers_count": 0,
            "avg_winning_trade": 0.0,
            "avg_losing_trade": 0.0,
            "realized_pnl_per_trade": [],
            "data_quality_flags": position_flags,
        }

        async def _mock_reconstruct(*_args, **_kwargs):
            return crafted_trade_metrics

        async def _mock_exposure(*_args, **_kwargs):
            return {}

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        mock_returns = pd.Series(
            [0.001] * 15, index=pd.bdate_range("2024-01-01", periods=15)
        )
        mock_metrics = MetricsResult(
            metrics_json={
                "cumulative_return": 0.01, "cagr": 0.05, "volatility": 0.1,
                "sharpe": 0.5, "sortino": 0.7, "calmar": 0.3,
                "max_drawdown": -0.02, "max_drawdown_duration_days": 3,
                "six_month_return": 0.02, "sparkline_returns": [],
                "sparkline_drawdown": [], "metrics_json": {},
                "returns_series": [], "drawdown_series": [],
                "monthly_returns": {}, "rolling_metrics": {},
                "return_quantiles": {},
            },
            sibling_kinds={},
        )

        with patch(
            "services.analytics_runner.get_supabase", return_value=mock_supabase
        ), patch(
            "services.analytics_runner.db_execute", side_effect=_mock_db_execute
        ), patch(
            "services.analytics_runner.trades_to_daily_returns_with_status",
            return_value=(mock_returns, _DEFAULT_RETURNS_META),
        ), patch(
            "services.analytics_runner.compute_all_metrics",
            return_value=mock_metrics,
        ), patch(
            "services.analytics_runner.get_benchmark_returns",
            new=AsyncMock(return_value=(None, True)),
        ), patch(
            "services.position_reconstruction.reconstruct_positions",
            side_effect=_mock_reconstruct,
        ), patch(
            "services.position_reconstruction.compute_exposure_metrics",
            side_effect=_mock_exposure,
        ):
            result = await run_strategy_analytics("strat-test")

        assert result["status"] == "complete"

        successes = [
            u for u in sa_upsert_calls
            if u.get("computation_status") in ("complete", "complete_with_warnings")
        ]
        assert successes, f"no success upsert; saw {sa_upsert_calls!r}"
        top_flags = successes[-1].get("data_quality_flags") or {}

        assert top_flags.get("breakeven_positions") == 2, (
            f"breakeven_positions must reach top-level data_quality_flags; "
            f"got top={top_flags}, trade_metrics inner="
            f"{(successes[-1].get('trade_metrics') or {}).get('data_quality_flags')}"
        )
        assert top_flags.get("positions_missing_realized_pnl") == 1, (
            f"positions_missing_realized_pnl must reach top-level; got {top_flags}"
        )

    @pytest.mark.asyncio
    async def test_turnover_gap_dates_flag_reaches_top_level(self) -> None:
        """The turnover series helper returns `flags['turnover_gap_dates']`.
        The runner must merge that into the top-level data_quality_flags
        column. Pre-fix the wrapper `compute_turnover_series` discarded
        the flags dict entirely."""
        from services.analytics_runner import run_strategy_analytics

        sa_upsert_calls: list[dict] = []
        mock_supabase = _build_balance_flag_mock_supabase(
            daily_pnl_rows=_minimal_daily_rows(),
            sa_upsert_calls=sa_upsert_calls,
            strategy_api_key_id="key-1",
        )

        async def _mock_reconstruct(*_args, **_kwargs):
            return {}

        async def _mock_exposure(*_args, **_kwargs):
            return {}

        def _mock_turnover_with_flags(*_args, **_kwargs):
            # Return a tuple matching the new _with_flags contract: the
            # second element is a flags dict that includes a 2-day-gap
            # entry. If the runner reverts to calling the bare wrapper
            # the patched flags are discarded and the assertion below fails.
            return (
                [{"date": "2025-01-01", "turnover": 0.0}],
                {"turnover_gap_dates": ["2025-01-15"]},
            )

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        mock_returns = pd.Series(
            [0.001] * 15, index=pd.bdate_range("2024-01-01", periods=15)
        )
        mock_metrics = MetricsResult(
            metrics_json={
                "cumulative_return": 0.01, "cagr": 0.05, "volatility": 0.1,
                "sharpe": 0.5, "sortino": 0.7, "calmar": 0.3,
                "max_drawdown": -0.02, "max_drawdown_duration_days": 3,
                "six_month_return": 0.02, "sparkline_returns": [],
                "sparkline_drawdown": [], "metrics_json": {},
                "returns_series": [], "drawdown_series": [],
                "monthly_returns": {}, "rolling_metrics": {},
                "return_quantiles": {},
            },
            sibling_kinds={},
        )

        with patch(
            "services.analytics_runner.get_supabase", return_value=mock_supabase
        ), patch(
            "services.analytics_runner.db_execute", side_effect=_mock_db_execute
        ), patch(
            "services.analytics_runner.trades_to_daily_returns_with_status",
            return_value=(mock_returns, _DEFAULT_RETURNS_META),
        ), patch(
            "services.analytics_runner.compute_all_metrics",
            return_value=mock_metrics,
        ), patch(
            "services.analytics_runner.get_benchmark_returns",
            new=AsyncMock(return_value=(None, True)),
        ), patch(
            "services.position_reconstruction.reconstruct_positions",
            side_effect=_mock_reconstruct,
        ), patch(
            "services.position_reconstruction.compute_exposure_metrics",
            side_effect=_mock_exposure,
        ), patch(
            "services.position_reconstruction.compute_turnover_series_with_flags",
            side_effect=_mock_turnover_with_flags,
        ):
            result = await run_strategy_analytics("strat-test")

        assert result["status"] == "complete"

        successes = [
            u for u in sa_upsert_calls
            if u.get("computation_status") in ("complete", "complete_with_warnings")
        ]
        assert successes, f"no success upsert; saw {sa_upsert_calls!r}"
        top_flags = successes[-1].get("data_quality_flags") or {}

        assert top_flags.get("turnover_gap_dates") == ["2025-01-15"], (
            f"turnover_gap_dates must reach top-level data_quality_flags. "
            f"If absent or empty, the runner is still calling the bare wrapper "
            f"that discards flags. Got: {top_flags}"
        )


# ---------------------------------------------------------------------------
# Audit-2026-05-07 C-0221 — `_load_position_time_series` MUST NOT write the
# raw tenant `account_balance` into `nav_by_date` (the value propagates to
# the public `turnover_series` sibling row and is readable by anon via the
# `fetch_strategy_lazy_metrics` RPC). Use a normalized constant proxy.
# ---------------------------------------------------------------------------


class TestLoadPositionTimeSeriesNavSafety:
    @pytest.mark.asyncio
    async def test_nav_does_not_leak_account_balance_when_balance_present(
        self,
    ) -> None:
        """The constant 1.0 NAV proxy is the contract — if a future change
        re-introduces `nav_by_date[d] = float(account_balance)`, this test
        fails before the leak ships."""
        from services.analytics_runner import _load_position_time_series

        snapshot_rows = [
            {
                "snapshot_date": "2024-01-15",
                "symbol": "BTCUSDT",
                "side": "long",
                "size_usd": "10000",
                "mark_price": "65000",
            },
            {
                "snapshot_date": "2024-01-16",
                "symbol": "BTCUSDT",
                "side": "long",
                "size_usd": "12000",
                "mark_price": "66000",
            },
        ]

        mock_supabase = MagicMock()
        t = MagicMock()
        sel = MagicMock()
        eq = MagicMock()
        order = MagicMock()
        order.execute.return_value = MagicMock(data=snapshot_rows)
        eq.order = MagicMock(return_value=order)
        sel.eq.return_value = eq
        t.select.return_value = sel
        mock_supabase.table.return_value = t

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        secret_balance = 1234567.89  # canary value
        with patch(
            "services.analytics_runner.db_execute", side_effect=_mock_db_execute
        ):
            _, _, nav_by_date = await _load_position_time_series(
                "strat-test", mock_supabase, account_balance=secret_balance
            )

        # Must NOT echo the raw balance.
        assert secret_balance not in nav_by_date.values(), (
            "C-0221 regression: raw account_balance leaked into nav_by_date. "
            f"Got {nav_by_date}, secret={secret_balance}"
        )
        # Contract: every populated nav entry is the constant 1.0 proxy.
        assert nav_by_date, "expected NAV entries for the two snapshot dates"
        assert all(v == 1.0 for v in nav_by_date.values()), (
            f"NAV proxy must be constant 1.0 when balance is known; got {nav_by_date}"
        )

    @pytest.mark.asyncio
    async def test_nav_falls_back_to_gross_exposure_when_balance_missing(
        self,
    ) -> None:
        """When account_balance is None, NAV uses sum(|positions|) per date —
        gross-exposure proxy. Pins the H-0632 branch (untested previously)."""
        from services.analytics_runner import _load_position_time_series

        snapshot_rows = [
            {
                "snapshot_date": "2024-01-15",
                "symbol": "BTCUSDT",
                "side": "long",
                "size_usd": "10000",
                "mark_price": "65000",
            },
            {
                "snapshot_date": "2024-01-15",
                "symbol": "ETHUSDT",
                "side": "short",
                "size_usd": "5000",
                "mark_price": "3500",
            },
        ]
        mock_supabase = MagicMock()
        t = MagicMock()
        sel = MagicMock()
        eq = MagicMock()
        order = MagicMock()
        order.execute.return_value = MagicMock(data=snapshot_rows)
        eq.order = MagicMock(return_value=order)
        sel.eq.return_value = eq
        t.select.return_value = sel
        mock_supabase.table.return_value = t

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        with patch(
            "services.analytics_runner.db_execute", side_effect=_mock_db_execute
        ):
            _, _, nav = await _load_position_time_series(
                "strat-test", mock_supabase, account_balance=None
            )

        # sum(|10000|, |-5000|) = 15000
        assert nav.get("2024-01-15") == 15000.0, (
            f"gross-exposure fallback should equal sum(|positions|); got {nav}"
        )

    @pytest.mark.asyncio
    async def test_empty_snapshots_yields_empty_grids(self) -> None:
        """H-0631 coverage: empty snapshots → all three grids empty."""
        from services.analytics_runner import _load_position_time_series

        mock_supabase = MagicMock()
        t = MagicMock()
        sel = MagicMock()
        eq = MagicMock()
        order = MagicMock()
        order.execute.return_value = MagicMock(data=[])
        eq.order = MagicMock(return_value=order)
        sel.eq.return_value = eq
        t.select.return_value = sel
        mock_supabase.table.return_value = t

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        with patch(
            "services.analytics_runner.db_execute", side_effect=_mock_db_execute
        ):
            positions, prices, nav = await _load_position_time_series(
                "strat-test", mock_supabase, account_balance=10000.0
            )

        assert positions == {} and prices == {} and nav == {}

    @pytest.mark.asyncio
    async def test_short_side_is_signed_negative(self) -> None:
        """H-0631 coverage: short positions appear with negative signed size_usd."""
        from services.analytics_runner import _load_position_time_series

        snapshot_rows = [
            {
                "snapshot_date": "2024-01-15",
                "symbol": "ETHUSDT",
                "side": "short",
                "size_usd": "5000",
                "mark_price": "3500",
            },
        ]
        mock_supabase = MagicMock()
        t = MagicMock()
        sel = MagicMock()
        eq = MagicMock()
        order = MagicMock()
        order.execute.return_value = MagicMock(data=snapshot_rows)
        eq.order = MagicMock(return_value=order)
        sel.eq.return_value = eq
        t.select.return_value = sel
        mock_supabase.table.return_value = t

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        with patch(
            "services.analytics_runner.db_execute", side_effect=_mock_db_execute
        ):
            positions, _, _ = await _load_position_time_series(
                "strat-test", mock_supabase, account_balance=10000.0
            )

        assert positions["2024-01-15"]["ETHUSDT"] == -5000.0, (
            f"shorts must store signed-negative size_usd; got {positions}"
        )

    @pytest.mark.asyncio
    async def test_near_zero_size_is_skipped(self) -> None:
        """H-0644 / H-0654 regression: a NUMERIC residual like 1e-15 must be
        skipped just like an exact 0.0 — otherwise it poisons the
        positions/prices grids with phantom entries that show up as
        artificial turnover_series datapoints."""
        from services.analytics_runner import _load_position_time_series

        snapshot_rows = [
            {
                "snapshot_date": "2024-01-15",
                "symbol": "BTCUSDT",
                "side": "long",
                "size_usd": "1e-15",  # NUMERIC residual after partial close
                "mark_price": "65000",
            },
            {
                "snapshot_date": "2024-01-15",
                "symbol": "ETHUSDT",
                "side": "long",
                "size_usd": "10000",
                "mark_price": "3500",
            },
        ]
        mock_supabase = MagicMock()
        t = MagicMock()
        sel = MagicMock()
        eq = MagicMock()
        order = MagicMock()
        order.execute.return_value = MagicMock(data=snapshot_rows)
        eq.order = MagicMock(return_value=order)
        sel.eq.return_value = eq
        t.select.return_value = sel
        mock_supabase.table.return_value = t

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        with patch(
            "services.analytics_runner.db_execute", side_effect=_mock_db_execute
        ):
            positions, prices, _ = await _load_position_time_series(
                "strat-test", mock_supabase, account_balance=10000.0
            )

        # ETH is kept, BTC residual is skipped.
        assert "BTCUSDT" not in positions.get("2024-01-15", {}), (
            f"near-zero size_usd should be filtered out; got {positions}"
        )
        assert positions["2024-01-15"]["ETHUSDT"] == 10000.0
        # Prices grid likewise must not carry the residual symbol.
        assert "BTCUSDT" not in prices.get("2024-01-15", {})

    @pytest.mark.asyncio
    async def test_malformed_mark_price_does_not_poison_prices_grid(
        self,
    ) -> None:
        """H-0631 coverage: non-numeric mark_price must be skipped silently
        without breaking the positions grid for that snapshot."""
        from services.analytics_runner import _load_position_time_series

        snapshot_rows = [
            {
                "snapshot_date": "2024-01-15",
                "symbol": "BTCUSDT",
                "side": "long",
                "size_usd": "10000",
                "mark_price": "garbage",
            },
        ]
        mock_supabase = MagicMock()
        t = MagicMock()
        sel = MagicMock()
        eq = MagicMock()
        order = MagicMock()
        order.execute.return_value = MagicMock(data=snapshot_rows)
        eq.order = MagicMock(return_value=order)
        sel.eq.return_value = eq
        t.select.return_value = sel
        mock_supabase.table.return_value = t

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        with patch(
            "services.analytics_runner.db_execute", side_effect=_mock_db_execute
        ):
            positions, prices, _ = await _load_position_time_series(
                "strat-test", mock_supabase, account_balance=10000.0
            )

        # Position recorded, price omitted.
        assert positions["2024-01-15"]["BTCUSDT"] == 10000.0
        assert "BTCUSDT" not in prices.get("2024-01-15", {})
