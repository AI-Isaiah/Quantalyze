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
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pandas as pd
import numpy as np
import pytest


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

        # Mock compute_all_metrics to avoid pulling in quantstats
        mock_metrics = {
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
        }

        with patch("services.analytics_runner.get_supabase", return_value=mock_supabase), \
             patch("services.analytics_runner.db_execute", side_effect=_mock_db_execute), \
             patch("services.analytics_runner.trades_to_daily_returns") as mock_transform, \
             patch("services.analytics_runner.compute_all_metrics", return_value=mock_metrics), \
             patch("services.analytics_runner.get_benchmark_returns", new=AsyncMock(return_value=(None, True))), \
             patch("services.position_reconstruction.reconstruct_positions", new=AsyncMock(return_value={})), \
             patch("services.position_reconstruction.compute_exposure_metrics", new=AsyncMock(return_value={})):

            # trades_to_daily_returns needs to return a valid Series
            np.random.seed(42)
            dates = pd.bdate_range("2024-01-01", periods=10)
            mock_transform.return_value = pd.Series(
                np.random.normal(0.001, 0.01, 10), index=dates
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

        mock_metrics = {
            "cumulative_return": 0.1, "cagr": 0.12, "volatility": 0.2,
            "sharpe": 1.5, "sortino": 2.0, "calmar": 1.0,
            "max_drawdown": -0.05, "max_drawdown_duration_days": 5,
            "six_month_return": 0.06, "sparkline_returns": [],
            "sparkline_drawdown": [], "metrics_json": {},
            "returns_series": [], "drawdown_series": [],
            "monthly_returns": {}, "rolling_metrics": {},
            "return_quantiles": {},
        }

        np.random.seed(42)
        dates = pd.bdate_range("2024-01-01", periods=10)
        mock_returns = pd.Series(np.random.normal(0.001, 0.01, 10), index=dates)

        # The key: position_reconstruction raises
        async def _failing_reconstruct(*args, **kwargs):
            raise RuntimeError("DB connection lost during position reconstruction")

        with patch("services.analytics_runner.get_supabase", return_value=mock_supabase), \
             patch("services.analytics_runner.db_execute", side_effect=_mock_db_execute), \
             patch("services.analytics_runner.trades_to_daily_returns", return_value=mock_returns), \
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
