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
        assert "avg_holding_period_hours" in bucket


def test_trade_mix_2_bucket_fallback(sample_fills):
    """METRICS-10: 2-bucket fallback when audit fails (TRADE_MIX_HAS_MAKER_TAKER=false)."""
    from services.analytics_runner import _compute_trade_mix

    result = _compute_trade_mix(sample_fills, has_maker_taker=False)
    assert set(result.keys()) == {"long", "short"}
    for bucket_key in ["long", "short"]:
        bucket = result[bucket_key]
        assert "count" in bucket
        assert "total_notional" in bucket
        assert "avg_holding_period_hours" in bucket
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
    assert result_4["long_maker"]["avg_holding_period_hours"] == 0.0

    result_2 = _compute_trade_mix([], has_maker_taker=False)
    assert set(result_2.keys()) == {"long", "short"}
    assert result_2["long"]["count"] == 0
    assert result_2["short"]["count"] == 0


def test_trade_mix_4_bucket_skips_fills_missing_is_maker():
    """METRICS-10 / T-12-05-04: in 4-bucket mode, fills with is_maker=None
    are skipped (cannot bucket into maker/taker without the flag)."""
    from services.analytics_runner import _compute_trade_mix

    fills = [
        {"side": "long", "is_maker": True, "notional_usd": 1000.0,
         "holding_period_hours": 4.0},
        # is_maker missing — must be skipped
        {"side": "long", "notional_usd": 500.0, "holding_period_hours": 2.0},
        {"side": "short", "is_maker": False, "notional_usd": 800.0,
         "holding_period_hours": 3.0},
    ]
    result = _compute_trade_mix(fills, has_maker_taker=True)
    assert result["long_maker"]["count"] == 1
    assert result["long_taker"]["count"] == 0  # the missing-flag fill is dropped
    assert result["short_taker"]["count"] == 1
    assert result["short_maker"]["count"] == 0


def test_trade_mix_avg_holding_period_computed(sample_fills):
    """METRICS-10: avg_holding_period_hours = sum(holding_period) / count per bucket."""
    from services.analytics_runner import _compute_trade_mix

    result = _compute_trade_mix(sample_fills, has_maker_taker=False)
    # Long fills: holding_period [4, 6, 8, 5] → mean = 23/4 = 5.75
    assert abs(result["long"]["avg_holding_period_hours"] - 23.0 / 4) < 1e-6
    # Short fills: holding_period [2, 3] → mean = 5/2 = 2.5
    assert abs(result["short"]["avg_holding_period_hours"] - 2.5) < 1e-6


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
):
    """Shared MagicMock factory for the Plan 06 smoke tests.

    Captures:
      - rpc_calls: every supabase.rpc(name, params) invocation
      - sa_upsert_calls: every strategy_analytics.upsert(data) invocation
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
            t.select.return_value = sel
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
         patch("services.analytics_runner.trades_to_daily_returns", return_value=mock_returns), \
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
         patch("services.analytics_runner.trades_to_daily_returns", return_value=mock_returns), \
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
