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
import dataclasses
from unittest.mock import AsyncMock, MagicMock, patch

import pandas as pd
import numpy as np
import pytest
from supabase import Client

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
# Audit-2026-05-07 H-0770 — MetricsResult contract shape pin
# ---------------------------------------------------------------------------
# The MetricsResult literals scattered through these tests embed legacy
# series keys (`metrics_json`, `returns_series`, `drawdown_series`,
# `monthly_returns`, `rolling_metrics`, `return_quantiles`) INSIDE the
# `metrics_json` dict — a transitional (Phase 12) shape. The production
# contract is the dataclass itself: exactly TWO fields, `metrics_json`
# (top-level dict spread into strategy_analytics) and `sibling_kinds`
# (split-storage series keyed by kind). This test pins that contract via
# dataclasses.fields() so:
#   - a third dataclass field added in production (drifting the contract the
#     mock literals encode) fails loudly here, AND
#   - the split-storage invariant (`sibling_kinds` is NOT proxied by
#     subscript / `in`) stays locked, catching a mechanical
#     `result.sibling_kinds[k]` → `result[k]` refactor.


def test_metrics_result_dataclass_contract_shape():
    """Pin the real MetricsResult dataclass shape so the mock literals used
    throughout this module can't silently diverge from production."""
    assert dataclasses.is_dataclass(MetricsResult)

    field_names = {f.name for f in dataclasses.fields(MetricsResult)}
    assert field_names == {"metrics_json", "sibling_kinds"}, (
        "MetricsResult contract drifted. The mock literals in this module "
        "encode `MetricsResult(metrics_json=..., sibling_kinds=...)`; a new "
        "or renamed field means those mocks no longer match production. "
        f"Got fields: {sorted(field_names)}"
    )

    # Both fields default to empty containers (field(default_factory=dict)) so
    # MetricsResult() is constructible with no args — relied on by callers.
    empty = MetricsResult()
    assert empty.metrics_json == {}
    assert empty.sibling_kinds == {}

    # Split-storage invariant: subscript / `in` proxy ONLY to metrics_json.
    # A series key that lives in sibling_kinds must NOT be visible via the
    # bare-dict compatibility shim (D-01/D-02). This is the exact misuse the
    # production __getitem__ guards against.
    result = MetricsResult(
        metrics_json={"sharpe": 1.5},
        sibling_kinds={"exposure_series": [{"date": "2024-01-15", "gross": 1.0}]},
    )
    assert "sharpe" in result
    assert result["sharpe"] == 1.5
    assert "exposure_series" not in result, (
        "sibling_kinds keys must NOT be visible via `in` (split storage)."
    )
    with pytest.raises(KeyError):
        # Subscripting a sibling_kinds-only key must raise, not silently
        # return it — guards the mechanical .sibling_kinds[k] → [k] refactor.
        _ = result["exposure_series"]


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
    """METRICS-07 (H-F): Weighted R:R is the pnl-weighted average of per-trade
    R-multiples: Σ(R_i × |pnl_i|) / Σ|pnl_i|.

    Audit-2026-05-07 H-0627 / H-0628 ratchet: the previous formulation
    `(avg_win × winners_count) / (|avg_loss| × losers_count)` is algebraically
    identical to Profit Factor and was reporting the same number under two
    labels. The new pnl-weighted formula varies independently of Profit Factor
    when individual trade magnitudes are heterogeneous.
    """
    from services.analytics_runner import _compute_derived_trade_metrics

    v, t = _sample_inputs()
    result = _compute_derived_trade_metrics(v, t)
    assert "weighted_risk_reward_ratio" in result

    risk_unit = abs(t["avg_losing_trade"])
    if risk_unit == 0 or not t["realized_pnl_per_trade"]:
        assert result["weighted_risk_reward_ratio"] is None
        return

    num = 0.0
    den = 0.0
    for trade in t["realized_pnl_per_trade"]:
        pnl = float(trade["realized_pnl"])
        r = pnl / risk_unit
        w = abs(pnl)
        num += r * w
        den += w
    expected = num / den if den > 0 else None
    if expected is None:
        assert result["weighted_risk_reward_ratio"] is None
    else:
        assert abs(result["weighted_risk_reward_ratio"] - expected) < 1e-6


def test_weighted_rr_is_not_algebraically_profit_factor():
    """Audit-2026-05-07 H-0627 / H-0628: the genuine pnl-weighted R:R formula
    must produce a number distinct from Profit Factor when per-trade
    magnitudes are heterogeneous. Construct a deliberately asymmetric cohort
    and assert the two metrics diverge."""
    from services.analytics_runner import _compute_derived_trade_metrics

    t = {
        "win_rate": 0.5,
        "avg_winning_trade": 100.0,
        "avg_losing_trade": -50.0,
        "winners_count": 2,
        "losers_count": 2,
        # Heterogeneous magnitudes — large winners + small winners + medium
        # losers. The old (broken) formula collapses to gross_profit/|gross_loss|;
        # the new pnl-weighted formula weights each trade's R by its own |pnl|.
        "realized_pnl_per_trade": [
            {"side": "long", "realized_pnl": 500.0},
            {"side": "long", "realized_pnl": 10.0},
            {"side": "short", "realized_pnl": -100.0},
            {"side": "short", "realized_pnl": -50.0},
        ],
    }
    result = _compute_derived_trade_metrics({}, t)

    # Compute Profit Factor (aggregate, both sides).
    pnls = [trade["realized_pnl"] for trade in t["realized_pnl_per_trade"]]
    gross_profit = sum(p for p in pnls if p > 0)
    gross_loss = abs(sum(p for p in pnls if p < 0))
    profit_factor = gross_profit / gross_loss
    weighted_rr = result["weighted_risk_reward_ratio"]

    assert weighted_rr is not None
    # The whole point: the two MUST diverge on heterogeneous magnitudes.
    assert abs(weighted_rr - profit_factor) > 1e-3, (
        "weighted_risk_reward_ratio must not equal Profit Factor for "
        f"heterogeneous trade magnitudes; got weighted_rr={weighted_rr} "
        f"profit_factor={profit_factor}"
    )


def test_derived_trade_metrics_sqn():
    """METRICS-08: SQN = (mean(R)/std(R)) × sqrt(min(N,100)) over closed positions.

    Audit-2026-05-07 H-0766 ratchet: the prior assertion only checked
    `is None or isinstance(..., float)` — against `_sample_inputs()` (60
    closed positions) the None branch is unreachable and the float branch
    passes for ANY float, so a formula off by 2× (e.g. sqrt(N) instead of
    sqrt(min(N,100)), or population vs sample variance) would slip through.
    Pin the ABSOLUTE value, computed independently from the same fixture
    with the canonical Van Tharp formula (sample variance, N-1 denom).
    """
    import math

    from services.analytics_runner import (
        _compute_derived_trade_metrics,
        SQN_TRADE_COUNT_CAP,
    )

    v, t = _sample_inputs()
    result = _compute_derived_trade_metrics(v, t)
    assert "sqn" in result

    # Independently recompute SQN from the fixture: R = realized_pnl /
    # |avg_loss|, mean/std over R-multiples (N-1 sample variance), scaled by
    # sqrt(min(N, cap)).
    risk_unit = abs(t["avg_losing_trade"])
    r_multiples = [
        tr["realized_pnl"] / risk_unit for tr in t["realized_pnl_per_trade"]
    ]
    n = len(r_multiples)
    assert n == 60  # fixture invariant — 6-element pattern × 10
    mean_r = sum(r_multiples) / n
    var_r = sum((r - mean_r) ** 2 for r in r_multiples) / (n - 1)
    std_r = math.sqrt(var_r)
    expected_sqn = (mean_r / std_r) * math.sqrt(min(n, SQN_TRADE_COUNT_CAP))

    assert result["sqn"] == pytest.approx(expected_sqn), (
        f"SQN must equal (mean(R)/std(R)) × sqrt(min(N,{SQN_TRADE_COUNT_CAP})); "
        f"expected {expected_sqn}, got {result['sqn']}"
    )


def test_derived_trade_metrics_sqn_caps_at_sqrt_100():
    """Audit-2026-05-07 H-0652 regression — SQN scaling factor is capped at
    sqrt(min(N, 100)), NOT the academic sqrt(N).

    Build two cohorts with IDENTICAL R-multiple shape (same mean and std)
    but different N. If the cap is active, sqn(N=200) / sqn(N=50) ==
    sqrt(100)/sqrt(50) == sqrt(2). Without the cap, the ratio would be
    sqrt(200)/sqrt(50) == 2. A future refactor that drops the cap would
    fail THIS test specifically (assertNotEqual on the wrong-formula
    ratio).
    """
    import math

    from services.analytics_runner import _compute_derived_trade_metrics

    # Asymmetric pattern produces positive mean R-multiple so SQN ≠ 0.
    # [+15, -10] alternating, avg_loss=-10 → risk_unit=10 → R = [1.5, -1.0].
    # Identical (mean_R, std_R) across N, so any SQN scale ratio comes
    # purely from sqrt(min(N, cap)).
    def _pnls(n: int) -> list[dict]:
        pattern = [15.0, -10.0]
        return [
            {"side": "long", "realized_pnl": pattern[i % 2]}
            for i in range(n)
        ]

    v = {
        "buy_volume_pct": 50.0, "sell_volume_pct": 50.0,
        "long_volume_pct": 100.0, "short_volume_pct": 0.0,
        "total_fills": 0, "total_volume_usd": 0.0,
    }
    base_metrics = {
        "win_rate": 0.5,
        "avg_winning_trade": 15.0,
        "avg_losing_trade": -10.0,
        "winners_count": 0,  # set below
        "losers_count": 0,   # set below
    }

    t50 = {**base_metrics, "winners_count": 25, "losers_count": 25,
           "realized_pnl_per_trade": _pnls(50)}
    t200 = {**base_metrics, "winners_count": 100, "losers_count": 100,
            "realized_pnl_per_trade": _pnls(200)}

    sqn_50 = _compute_derived_trade_metrics(v, t50)["sqn"]
    sqn_200 = _compute_derived_trade_metrics(v, t200)["sqn"]

    assert sqn_50 is not None and sqn_200 is not None
    # With cap: ratio ≈ sqrt(100/50) ≈ 1.414. Without cap: ratio ≈
    # sqrt(200/50) ≈ 2.0. Slight deviation from the exact ratio arises
    # from the N-1 sample-variance denominator differing between cohorts;
    # 2% relative tolerance keeps the assertion robust while still
    # distinguishing the two formulas (gap > 40%).
    ratio = sqn_200 / sqn_50
    assert ratio == pytest.approx(math.sqrt(2), rel=0.02), (
        f"SQN cap regression: ratio={ratio} expected≈{math.sqrt(2)}. "
        "If this jumps to ~2.0 the sqrt(min(N,100)) cap was dropped."
    )


def test_derived_trade_metrics_profit_factor_segmented():
    """METRICS-07: separate PF for long and short via realized_pnl_per_trade.

    Audit-2026-05-07 H-0766 ratchet: the prior assertion only checked
    `is None or isinstance(..., (int, float))` — a production formula that
    summed the wrong side, double-counted, or returned gross_profit/N
    instead of gross_profit/gross_loss would still pass. Pin the ABSOLUTE
    numeric value computed independently from the fixture so a wrong scalar
    fails loudly.
    """
    from services.analytics_runner import _compute_derived_trade_metrics

    v, t = _sample_inputs()
    result = _compute_derived_trade_metrics(v, t)
    assert "profit_factor_long" in result
    assert "profit_factor_short" in result

    # Independently recompute PF = gross_profit / |gross_loss| per side from
    # the SAME realized_pnl_per_trade fixture the production code consumes.
    long_pnls = [
        tr["realized_pnl"] for tr in t["realized_pnl_per_trade"]
        if tr["side"] == "long"
    ]
    short_pnls = [
        tr["realized_pnl"] for tr in t["realized_pnl_per_trade"]
        if tr["side"] == "short"
    ]
    expected_pf_long = (
        sum(p for p in long_pnls if p > 0)
        / abs(sum(p for p in long_pnls if p < 0))
    )
    expected_pf_short = (
        sum(p for p in short_pnls if p > 0)
        / abs(sum(p for p in short_pnls if p < 0))
    )
    # Sanity: the fixture is built so both sides have a finite, > 1 PF.
    assert expected_pf_long == pytest.approx(2.5)        # 1250 / 500
    assert expected_pf_short == pytest.approx(2000 / 850)  # ≈ 2.3529

    assert result["profit_factor_long"] == pytest.approx(expected_pf_long), (
        f"profit_factor_long must equal gross_profit/|gross_loss| for the "
        f"long side; expected {expected_pf_long}, got {result['profit_factor_long']}"
    )
    assert result["profit_factor_short"] == pytest.approx(expected_pf_short), (
        f"profit_factor_short must equal gross_profit/|gross_loss| for the "
        f"short side; expected {expected_pf_short}, got {result['profit_factor_short']}"
    )


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


def test_derived_trade_metrics_drops_non_finite_realized_pnl():
    """Audit-2026-05-07 H-0647 / H-0648: NaN / inf realized_pnl (commonly an
    upstream divide-by-zero from reconstruct_positions when entry price is 0)
    must NOT poison SQN, profit_factor_long, or profit_factor_short.

    Compare two inputs that differ only by an extra NaN / inf trade per side.
    The output for the clean cohort and the polluted-but-filtered cohort
    must match — pinning that the non-finite values were dropped at the
    boundary rather than silently propagating into JSONB.
    """
    from services.analytics_runner import _compute_derived_trade_metrics

    v = {}
    clean = {
        "avg_winning_trade": 100.0,
        "avg_losing_trade": -50.0,
        "winners_count": 2,
        "losers_count": 2,
        "win_rate": 0.5,
        "realized_pnl_per_trade": [
            {"side": "long", "realized_pnl": 100.0},
            {"side": "long", "realized_pnl": -50.0},
            {"side": "short", "realized_pnl": 200.0},
            {"side": "short", "realized_pnl": -75.0},
        ],
    }
    polluted = {
        **clean,
        "realized_pnl_per_trade": clean["realized_pnl_per_trade"] + [
            {"side": "long", "realized_pnl": float("nan")},
            {"side": "short", "realized_pnl": float("inf")},
        ],
    }
    a = _compute_derived_trade_metrics(v, clean)
    b = _compute_derived_trade_metrics(v, polluted)

    assert a["sqn"] == b["sqn"], (
        f"NaN/inf must be filtered out of r_multiples before SQN math. "
        f"clean={a['sqn']} polluted={b['sqn']}"
    )
    assert a["profit_factor_long"] == b["profit_factor_long"], (
        "NaN long-side realized_pnl must NOT change profit_factor_long. "
        f"clean={a['profit_factor_long']} polluted={b['profit_factor_long']}"
    )
    assert a["profit_factor_short"] == b["profit_factor_short"], (
        "inf short-side realized_pnl must NOT change profit_factor_short. "
        f"clean={a['profit_factor_short']} polluted={b['profit_factor_short']}"
    )


def test_derived_trade_metrics_normalizes_percent_win_rate():
    """Audit-2026-05-07 H-0645 / H-0653: if a future refactor of
    `reconstruct_positions` returns win_rate in percent (60.0) instead of
    fraction (0.6), the consumer here MUST normalize defensively so
    expectancy doesn't blow up ~100×.

    Compare expectancy from win_rate=0.6 vs win_rate=60.0 — both should
    collapse to the same number after normalization.
    """
    from services.analytics_runner import _compute_derived_trade_metrics

    v = {
        "buy_volume_pct": 0.0,
        "sell_volume_pct": 0.0,
        "total_fills": 0,
        "total_volume_usd": 0.0,
    }
    base = {
        "avg_winning_trade": 0.05,
        "avg_losing_trade": -0.025,
        "winners_count": 30,
        "losers_count": 20,
        "realized_pnl_per_trade": [],
    }
    fraction_result = _compute_derived_trade_metrics(
        v, {**base, "win_rate": 0.6}
    )
    percent_result = _compute_derived_trade_metrics(
        v, {**base, "win_rate": 60.0}
    )
    assert fraction_result["expectancy"] == percent_result["expectancy"], (
        "win_rate=60.0 (percent) must be normalized to 0.6 (fraction). "
        f"Without the normalize, expectancy diverges by ~100×: "
        f"fraction={fraction_result['expectancy']} "
        f"percent={percent_result['expectancy']}"
    )


# Phase B pr-test-analyzer F11: the named boundary case for the
# WIN_RATE_PERCENT_HEURISTIC_THRESHOLD constant. A ULP drift from
# `winners/total` at 100% winners (e.g. 1.0001) must stay fractional. The
# OLD threshold of `> 1.0` would have rescaled this to 0.010001 — shipping
# a 1% win-rate for a 100%-winner strategy (catastrophic 100× error in the
# WRONG direction). The current `> 1.5` threshold pins the regression.
def test_derived_trade_metrics_win_rate_ulp_drift_stays_fractional():
    from services.analytics_runner import (
        _compute_derived_trade_metrics,
        WIN_RATE_PERCENT_HEURISTIC_THRESHOLD,
    )

    # Pin the threshold value too — a refactor that lowers it back to 1.0
    # would re-introduce the catastrophic mis-rescale.
    assert WIN_RATE_PERCENT_HEURISTIC_THRESHOLD == 1.5, (
        "WIN_RATE_PERCENT_HEURISTIC_THRESHOLD must stay at 1.5 to keep ULP "
        f"drift at 1.0 fractional; got {WIN_RATE_PERCENT_HEURISTIC_THRESHOLD}"
    )

    v = {
        "buy_volume_pct": 0.0,
        "sell_volume_pct": 0.0,
        "total_fills": 0,
        "total_volume_usd": 0.0,
    }
    base = {
        "avg_winning_trade": 0.05,
        "avg_losing_trade": -0.025,
        "winners_count": 30,
        "losers_count": 20,
        "realized_pnl_per_trade": [],
    }
    baseline = _compute_derived_trade_metrics(v, {**base, "win_rate": 1.0})
    ulp_drift = _compute_derived_trade_metrics(v, {**base, "win_rate": 1.0001})
    # Both should yield expectancy = 1.0 * avg_win - 0 * |avg_loss| = avg_win.
    # If the rescale fires, ulp_drift's expectancy would be ~0.01 * avg_win
    # minus 0.99 * |avg_loss| = ~-0.0245 — a 100× error in the wrong
    # direction (positive expectancy flips negative). Tolerance is the
    # natural ULP gap between win_rate=1.0 and win_rate=1.0001 baselines.
    assert baseline["expectancy"] is not None
    assert ulp_drift["expectancy"] is not None
    assert abs(baseline["expectancy"] - ulp_drift["expectancy"]) < 1e-3, (
        f"win_rate=1.0001 must stay fractional (no /100 rescale). "
        f"baseline={baseline['expectancy']} ulp={ulp_drift['expectancy']}"
    )


# /simplify Phase B+C test-coverage HIGH #2: comprehensive boundary
# parametrize covering ULP drift near 1.0, the 1.5 strict threshold, percent
# values, and non-finite producer drift. A future "tidy" that flips the
# threshold back to `> 1.0` (or relaxes it to `>= 1.5`) fails this loudly
# across 13 cases — complementary to the ULP-drift test above, which pins
# the named constant.
@pytest.mark.parametrize(
    "raw_win_rate, expected_normalized",
    [
        # Legitimate fractional values near 1.0 stay fractional.
        (0.0, 0.0),
        (0.5, 0.5),
        (1.0, 1.0),
        (1.0001, 1.0),     # ULP drift — clamped to 1.0, NOT divided by 100
        (1.4999, 1.0),     # still below the 1.5 percent threshold
        (1.5, 1.0),        # exactly at threshold (`> 1.5` is False) — clamp
        (1.5001, 0.015001),  # just above threshold → percent → /100
        (60.0, 0.6),
        (100.0, 1.0),
        (-0.1, 0.0),       # negative → clamped to 0
        # Non-finite producer drift collapses to 0 (NOT NaN propagating).
        (float("inf"), 0.0),
        (float("-inf"), 0.0),
        (float("nan"), 0.0),
    ],
)
def test_derived_trade_metrics_win_rate_boundary(
    raw_win_rate: float, expected_normalized: float,
) -> None:
    """Pins win_rate normalization across the load-bearing boundary (1.5,
    ULP drift near 1.0, non-finite). Asserts expectancy reflects the
    normalized win_rate by computing it independently against the same
    avg_win / avg_loss.
    """
    from services.analytics_runner import _compute_derived_trade_metrics

    v = {
        "buy_volume_pct": 0.0,
        "sell_volume_pct": 0.0,
        "total_fills": 0,
        "total_volume_usd": 0.0,
    }
    avg_win = 1.0
    avg_loss = -1.0
    result = _compute_derived_trade_metrics(
        v,
        {
            "win_rate": raw_win_rate,
            "avg_winning_trade": avg_win,
            "avg_losing_trade": avg_loss,
            "winners_count": 0,
            "losers_count": 0,
            "realized_pnl_per_trade": [],
        },
    )
    # expectancy = wr * avg_win - (1 - wr) * |avg_loss|
    expected_expectancy = (
        expected_normalized * avg_win
        - (1 - expected_normalized) * abs(avg_loss)
    )
    assert result["expectancy"] == pytest.approx(expected_expectancy), (
        f"raw_win_rate={raw_win_rate!r} expected normalized "
        f"{expected_normalized}, got expectancy {result['expectancy']} "
        f"(expected {expected_expectancy})"
    )


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


def test_volume_aggregator_malformed_timestamp_kept_in_gross_excluded_from_turnover():
    """M-0650: the `if not ts or len(ts) < 10: continue` defensive branch
    drops fills with missing / short timestamps from the daily/monthly
    turnover buckets while STILL counting their notional in gross_volume +
    mean_trade_size. A regression that swapped `continue` for `break` (or
    dropped the notional from gross too) silently changes aggregate
    semantics — no existing test exercises ts=None or a length-7 prefix.
    """
    from services.analytics_runner import _compute_volume_aggregator

    fills = [
        # Well-formed: contributes to BOTH gross and daily/monthly.
        {"notional_usd": 1000.0, "filled_at": "2024-01-15T10:00:00+00:00"},
        # ts is None → skipped from daily/monthly, KEPT in gross.
        {"notional_usd": 500.0, "filled_at": None},
        # ts is "2024-01" (length 7 < 10) → skipped from daily/monthly,
        # KEPT in gross. This is the exact short-prefix case the finding
        # named.
        {"notional_usd": 300.0, "filled_at": "2024-01"},
    ]
    result = _compute_volume_aggregator(fills)
    # All three notionals survive into gross + mean.
    assert result["gross_volume_usd"] == pytest.approx(1800.0)
    assert result["mean_trade_size_usd"] == pytest.approx(1800.0 / 3)
    # Only the well-formed fill reaches the daily/monthly buckets → 1 day
    # carrying 1000.0 → mean over 1 day = 1000.0. If `continue` were
    # `break`, the loop would have exited and daily would still be 1000;
    # but if gross also dropped the malformed fills, the assertions above
    # would catch that. The turnover figure pins the exclusion side.
    assert result["daily_turnover_usd"] == pytest.approx(1000.0)
    assert result["monthly_turnover_usd"] == pytest.approx(1000.0)


def test_volume_aggregator_uses_created_at_when_filled_at_missing():
    """M-0650 companion: the `f.get('filled_at') or f.get('created_at')`
    fallback path is untested because the sample_fills fixture always
    populates filled_at. A fill with only created_at must still bucket
    into daily/monthly turnover."""
    from services.analytics_runner import _compute_volume_aggregator

    fills = [
        {"notional_usd": 2000.0, "created_at": "2024-02-20T00:00:00+00:00"},
    ]
    result = _compute_volume_aggregator(fills)
    assert result["gross_volume_usd"] == pytest.approx(2000.0)
    # created_at fallback drove the daily bucket (single day → mean 2000).
    assert result["daily_turnover_usd"] == pytest.approx(2000.0)
    assert result["monthly_turnover_usd"] == pytest.approx(2000.0)


def test_derived_trade_metrics_sqn_degenerate_variance_returns_none():
    """M-0648: all-identical R-multiples → sample variance 0 → std_r == 0,
    so the `if std_r > 0` guard leaves SQN as None (avoids a divide-by-zero
    blow-up). No prior test exercises this branch — the existing SQN tests
    all use heterogeneous R-multiples with non-zero variance.
    """
    from services.analytics_runner import _compute_derived_trade_metrics

    v = {}
    # Four closed trades, ALL with realized_pnl == 50.0 → every R-multiple
    # is identical (50/|−10| = 5.0) → variance 0 → std 0 → SQN None.
    t = {
        "win_rate": 1.0,
        "avg_winning_trade": 50.0,
        "avg_losing_trade": -10.0,
        "winners_count": 4,
        "losers_count": 0,
        "realized_pnl_per_trade": [
            {"side": "long", "realized_pnl": 50.0} for _ in range(4)
        ],
    }
    result = _compute_derived_trade_metrics(v, t)
    assert result["sqn"] is None, (
        "All-identical R-multiples produce zero variance; SQN must be None "
        "(the `if std_r > 0` guard), not a NaN/Inf from dividing by std=0."
    )


def test_derived_trade_metrics_profit_factor_zero_loss_returns_none_not_inf():
    """M-0649 / T-12-05-03: a side with gross losses summing to 0 (a
    long-only winning cohort) must yield profit_factor=None, NOT +Infinity.
    The existing segmented PF test always has losses on both sides, so the
    `if gl == 0: return None` branch is unexercised — and an isinstance
    check would PASS for math.inf (it's a float). Pin the None contract so
    a regression to `gp / gl if gl else math.inf` is caught: +inf would
    propagate into Supabase JSONB and break the downstream render.
    """
    import math

    from services.analytics_runner import _compute_derived_trade_metrics

    v = {}
    # Long side: only positive pnls (no losing long trade) → gross_loss = 0
    # → profit_factor_long must be None (NOT inf). Short side keeps a loss
    # so its PF stays finite — proving the None is the zero-loss branch,
    # not a global wipe.
    t = {
        "win_rate": 1.0,
        "avg_winning_trade": 50.0,
        "avg_losing_trade": -10.0,
        "winners_count": 3,
        "losers_count": 0,
        "realized_pnl_per_trade": [
            {"side": "long", "realized_pnl": 50.0},
            {"side": "long", "realized_pnl": 30.0},
            {"side": "long", "realized_pnl": 20.0},
            {"side": "short", "realized_pnl": -15.0},
            {"side": "short", "realized_pnl": 40.0},
        ],
    }
    result = _compute_derived_trade_metrics(v, t)
    assert result["profit_factor_long"] is None, (
        "Zero-loss long side must yield None, not +Infinity (T-12-05-03). "
        f"got {result['profit_factor_long']!r}"
    )
    # Guard against an isinstance-style regression: must NOT be inf.
    assert not (
        isinstance(result["profit_factor_long"], float)
        and math.isinf(result["profit_factor_long"])
    )
    # Short side has a real loss → PF is finite (gp=40 / |gl|=15 ≈ 2.667).
    assert result["profit_factor_short"] == pytest.approx(40.0 / 15.0)


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

    Audit-2026-05-07 H-0767: `spec=Client` (supabase-py) so signature /
    attribute drift on the real client surface (a renamed `rpc`, a
    `.postgrest` reach that doesn't exist) raises AttributeError instead of
    being silently swallowed by a bare MagicMock.
    """
    mock = MagicMock(spec=Client)

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
                # Runner fetches raw fills at analytics_runner.py:1009-1011 via
                # `.select("side, cost, is_maker, timestamp")
                #   .eq("strategy_id", ...).eq("is_fill", True)`.
                # Returning data=[] keeps fills_data empty so the runner
                # short-circuits _compute_position_side_volume_pcts — without
                # an explicit stub the default MagicMock chain would return
                # another MagicMock for `.data` (truthy, non-list), which
                # pollutes the side-volume helper and silently triggers
                # `position_side_volume_failed=True`, contaminating the
                # clean-path computation_status assertion added in the
                # audit-2026-05-07 #9 consumer migration.
                r = MagicMock()
                r.execute.return_value = MagicMock(data=[])
                # H-0630 pagination support. Composite order_by chains
                # multiple .order() calls — make .order chainable to self.
                order = MagicMock()
                order.execute.return_value = MagicMock(data=[])
                order.range = _make_paged_range([])
                order.order.return_value = order
                r.order.return_value = order
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
        elif name == "position_snapshots":
            sel = MagicMock()
            eq = MagicMock()
            order = MagicMock()
            order.execute.return_value = MagicMock(data=[])
            order.range = _make_paged_range([])
            order.order.return_value = order
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
    benchmark_return: tuple | None = None,
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

    `benchmark_return`: the `(series_or_None, stale_bool)` tuple the patched
    `get_benchmark_returns` returns. Defaults to `(None, True)` which sets
    `benchmark_unavailable=True` in DQF (the historical default for the
    balance-flag-routing tests). Pass a valid `(pd.Series, False)` tuple to
    exercise the genuinely-clean path where status MUST stay 'complete' with
    zero DQF flags (audit-2026-05-07 H-0768).
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

    bench_return = benchmark_return if benchmark_return is not None else (None, True)

    with patch("services.analytics_runner.get_supabase", return_value=mock_supabase), \
         patch("services.analytics_runner.db_execute", side_effect=_mock_db_execute), \
         patch(
             "services.analytics_runner.trades_to_daily_returns_with_status",
             return_value=(mock_returns, mock_meta),
         ), \
         patch("services.analytics_runner.get_benchmark_returns", new=AsyncMock(return_value=bench_return)), \
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


@pytest.mark.asyncio
async def test_consumer_migration_fully_clean_run_status_complete_no_flags():
    """audit-2026-05-07 H-0768 — close the assertion hole the
    `..._clean_path_does_not_leak_consumer_specific_keys` test documented
    (it could not assert status because its scaffolding forced
    `benchmark_unavailable=True`).

    Drive a GENUINELY clean run:
      - api_key linked + balance present → no account_balance_unavailable /
        no_linked_api_key
      - benchmark returns a VALID series (not stale) → no benchmark_unavailable
      - reconstruct/exposure return {} cleanly, snapshots + fills empty → no
        position_* / fills_* / side-volume flags
      - meta reports no warnings → no used_heuristic_capital / balance_error

    Under these conditions the runner MUST persist
    `computation_status == 'complete'` AND `data_quality_flags` must carry
    ZERO flags (None or {}). A regression that promotes status to
    'complete_with_warnings' on a clean run — or that leaks a spurious flag —
    breaks the eight frontend consumers that exact-match 'complete' and is
    invisible to every other test in this module.
    """
    sa_upsert_calls: list[dict] = []
    mock_supabase = _build_balance_flag_mock_supabase(
        daily_pnl_rows=_minimal_daily_rows(),
        sa_upsert_calls=sa_upsert_calls,
        strategy_api_key_id="00000000-0000-0000-0000-000000000001",
        api_key_balance=10000.0,
    )

    # A valid, non-stale benchmark series aligned to the patched returns
    # window (15 business days from 2024-01-01).
    bench_dates = pd.bdate_range("2024-01-01", periods=15)
    valid_benchmark = pd.Series([0.0005] * 15, index=bench_dates, name="BTC")

    upsert = await _run_and_get_success_upsert(
        mock_supabase,
        sa_upsert_calls,
        benchmark_return=(valid_benchmark, False),  # (series, stale=False)
    )

    assert upsert.get("computation_status") == "complete", (
        "A fully clean run must persist computation_status='complete' "
        f"(no warnings promotion); got: {upsert.get('computation_status')!r}"
    )
    flags = upsert.get("data_quality_flags")
    assert not flags, (
        "A fully clean run must carry zero data_quality_flags. "
        f"Got: {flags!r}"
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

    # Audit-2026-05-07 H-0769: NaN / inf cost coverage. A NaN cost from
    # an upstream parser divide-by-zero is a *numeric* float, so the
    # `except (TypeError, ValueError)` guard does NOT catch it — it survives
    # `abs(float(...))` and would propagate into total_volume_usd, which the
    # runner then writes into strategy_analytics JSONB. NaN/Inf are NOT
    # JSON-compliant (`json.dumps(..., allow_nan=False)` raises), so an
    # unsanitized non-finite cost corrupts the row or bypasses encoder
    # safeguards downstream.
    #
    # PR #290 closed the gap: _compute_volume_metrics now applies a
    # `math.isfinite(cost)` guard (coerce non-finite → 0, count + log it).
    # These two tests are therefore LIVE (NOT xfail) regression guards that
    # pin the CORRECT contract documented in the helper's docstring
    # ("total_volume_usd is the absolute sum"; percentages in [0,1]): the
    # output must be FINITE and JSON-serializable. If a future refactor drops
    # the isfinite guard, both tests fail hard — they ratchet the fix in
    # rather than silently tolerating a regression.

    def test_nan_cost_does_not_poison_totals(self) -> None:
        """A NaN cost (upstream divide-by-zero) must NOT propagate into
        total_volume_usd — the result must stay finite and JSON-serializable.
        """
        import json
        import math

        from services.analytics_runner import _compute_volume_metrics

        result = _compute_volume_metrics(
            [
                {"side": "buy", "cost": float("nan")},
                {"side": "sell", "cost": 100.0},
            ],
        )
        # total_volume_usd must be finite (the NaN fill contributes 0).
        assert math.isfinite(result["total_volume_usd"]), (
            f"NaN cost leaked into total_volume_usd: {result['total_volume_usd']!r}"
        )
        assert result["total_volume_usd"] == 100.0
        # Percentages stay bounded and finite.
        assert math.isfinite(result["buy_volume_pct"])
        assert math.isfinite(result["sell_volume_pct"])
        assert 0.0 <= result["buy_volume_pct"] <= 1.0
        assert 0.0 <= result["sell_volume_pct"] <= 1.0
        # The whole payload must round-trip through strict JSON (no NaN/Inf).
        json.dumps(result, allow_nan=False)

    def test_inf_cost_does_not_poison_totals(self) -> None:
        """An inf cost must NOT propagate into total_volume_usd / percentages
        — the result must stay finite and JSON-serializable.
        """
        import json
        import math

        from services.analytics_runner import _compute_volume_metrics

        result = _compute_volume_metrics(
            [
                {"side": "buy", "cost": float("inf")},
                {"side": "sell", "cost": 100.0},
            ],
        )
        assert math.isfinite(result["total_volume_usd"]), (
            f"inf cost leaked into total_volume_usd: {result['total_volume_usd']!r}"
        )
        assert result["total_volume_usd"] == 100.0
        assert math.isfinite(result["buy_volume_pct"])
        assert math.isfinite(result["sell_volume_pct"])
        assert 0.0 <= result["buy_volume_pct"] <= 1.0
        assert 0.0 <= result["sell_volume_pct"] <= 1.0
        json.dumps(result, allow_nan=False)


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


def _make_paged_range(rows: list[dict]):
    """Build a `.range(start, end)` mock that simulates PostgREST pagination.

    Returns a chainable that:
      - on the first call returns the full ``rows`` payload (the runner's
        page-1 fetch), and
      - on every subsequent call returns an empty list (so the runner's
        bounded pagination loop terminates after one page).

    Used by the H-0629 / H-0630 / H-0643 paginated SELECTs in the runner.
    """
    state = {"called": False}

    def _range(start, end):
        r = MagicMock()
        if not state["called"]:
            state["called"] = True
            r.execute.return_value = MagicMock(data=rows)
        else:
            r.execute.return_value = MagicMock(data=[])
        return r

    return MagicMock(side_effect=_range)


def _make_paginated_order_mock(rows: list[dict]) -> MagicMock:
    """Build a chainable `.order(...).order(...)...range(start, end).execute()` mock.

    The runner now uses composite order_by tuples (e.g. (snapshot_date,
    symbol, side) for snapshots, (timestamp, id) for fills) so
    ``paginated_select`` chains multiple ``.order(col, desc=...)`` calls
    before ``.range()``. Each ``.order()`` must land back on the same
    configured mock so the final ``.range()`` exposes ``_make_paged_range``.
    """
    order = MagicMock()
    order.execute.return_value = MagicMock(data=rows)
    order.range = _make_paged_range(rows)
    order.order.return_value = order
    return order


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

    Audit-2026-05-07 H-0767: the client is `spec=Client` (supabase-py) so a
    refactor that calls a method NOT on the real Client (e.g. renaming
    `rpc` or reaching for a `.postgrest` surface that doesn't exist) raises
    AttributeError instead of silently recording a phantom call against a
    bare MagicMock. The `.table` / `.rpc` callables we install below are
    both real Client attributes, so assignment is permitted under the spec.
    """
    mock = MagicMock(spec=Client)

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
                # Legacy unpaginated path: .execute() still returns all rows.
                r.execute.return_value = MagicMock(data=fills_rows)
                # H-0630 pagination: .order(...).order(...).range(...).execute()
                # — composite order_by (timestamp, id) chains two .order()
                # calls, so the second .order() must land back on the same
                # configured mock to expose .range().
                order = MagicMock()
                order.execute.return_value = MagicMock(data=fills_rows)
                order.range = _make_paged_range(fills_rows)
                order.order.return_value = order
                r.order.return_value = order
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
            # H-0629 pagination: simulate a paged response. First page
            # returns the full snapshot_rows list; subsequent pages
            # return [] so the runner's pagination loop terminates.
            # Composite order_by (snapshot_date, symbol, side) chains three
            # .order() calls — make .order chainable to self so the last
            # call exposes .range().
            order.range = _make_paged_range(snapshot_rows)
            order.order.return_value = order
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
      - exposure_series + turnover_series KEY PRESENCE in the RPC payload

    SCOPE NOTE (audit-2026-05-07 H-0763 / H-0765 / M-0726): this test
    patches `compute_exposure_metrics` to return a hand-fed `fake_exposure`,
    so the `exposure_series in kinds_payload` assertion below proves only
    the runner's WIRING — that whatever the exposure function returns is
    threaded through to the batch RPC payload. It deliberately does NOT
    exercise the real position_snapshots → exposure_series computation
    (that would be tautological: the mock returns X, we assert X is
    present). The genuine exposure computation is covered NON-tautologically
    by `test_real_compute_exposure_metrics_derives_series_from_snapshots`
    below, which drives the REAL `compute_exposure_metrics` against snapshot
    fixtures and pins the computed gross/net values.
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
    # NOTE: exposure_series here is the PATCHED fake_exposure value — see the
    # SCOPE NOTE in this test's docstring. The real derivation is pinned in
    # test_real_compute_exposure_metrics_derives_series_from_snapshots.
    assert "exposure_series" in kinds_payload, (
        "H-A1 violated: exposure_series missing from sibling_kinds"
    )
    assert "turnover_series" in kinds_payload, (
        "H-A1 violated: turnover_series missing from sibling_kinds"
    )


@pytest.mark.asyncio
async def test_real_compute_exposure_metrics_derives_series_from_snapshots() -> None:
    """audit-2026-05-07 H-0763 / H-0765 / M-0726 (non-tautological coverage).

    `test_run_strategy_analytics_writes_sibling_kinds` MOCKS
    `compute_exposure_metrics`, so it cannot detect a regression where the
    real function fails to derive exposure_series from position_snapshots.
    This test drives the REAL `compute_exposure_metrics` against a snapshot
    fixture and pins the COMPUTED gross/net values — the mock is told
    nothing, the assertions check what the production math produces.

    Fixture (two dates, mixed sides so net != gross on day 2):
      2024-01-15: long 10_000 + long 5_000              → gross 15_000, net +15_000
      2024-01-16: long 12_000 + short 4_000             → gross 16_000, net +8_000
    """
    from services.position_reconstruction import compute_exposure_metrics

    snapshot_rows = [
        {"snapshot_date": "2024-01-15", "side": "long", "size_usd": "10000",
         "mark_price": "65000"},
        {"snapshot_date": "2024-01-15", "side": "long", "size_usd": "5000",
         "mark_price": "65000"},
        {"snapshot_date": "2024-01-16", "side": "long", "size_usd": "12000",
         "mark_price": "66000"},
        {"snapshot_date": "2024-01-16", "side": "short", "size_usd": "4000",
         "mark_price": "66000"},
    ]

    # Mock supabase supporting the REAL compute_exposure_metrics call chains:
    #   strategies.select("api_key_id").eq("id",...).limit(1).execute()
    #   strategies.select("id").eq("api_key_id",...).execute()  (sibling check)
    #   position_snapshots.select(...).eq("strategy_id",...).order(...).execute()
    def _table(name):
        t = MagicMock()
        if name == "strategies":
            sel = MagicMock()

            def _select(cols):
                eq = MagicMock()
                if "api_key_id" in cols:
                    # self lookup: .eq("id", ...).limit(1).execute()
                    limit = MagicMock()
                    limit.execute.return_value = MagicMock(
                        data=[{"api_key_id": "key-1"}]
                    )
                    eq.limit.return_value = limit
                else:
                    # sibling check: .eq("api_key_id", ...).execute()
                    # Return exactly ONE row so the shared-api-key skip path
                    # does NOT fire (len(sib_rows) == 1).
                    eq.execute.return_value = MagicMock(
                        data=[{"id": "strat-test"}]
                    )
                sel.eq.return_value = eq
                return sel

            t.select = _select
        elif name == "position_snapshots":
            sel = MagicMock()
            eq = MagicMock()
            order = MagicMock()
            order.execute.return_value = MagicMock(data=snapshot_rows)
            eq.order.return_value = order
            sel.eq.return_value = eq
            t.select.return_value = sel
        return t

    mock_supabase = MagicMock(spec=Client)
    mock_supabase.table = _table

    async def _mock_db_execute(fn):
        return await asyncio.to_thread(fn)

    with patch(
        "services.position_reconstruction.db_execute",
        side_effect=_mock_db_execute,
    ):
        result = await compute_exposure_metrics("strat-test", mock_supabase)

    # The shared-key skip must NOT have fired (sibling check returned 1 row).
    assert "exposure_series" in result, (
        f"real compute_exposure_metrics did not produce exposure_series; "
        f"got keys {sorted(result.keys())}"
    )
    series = result["exposure_series"]
    assert len(series) == 2, f"expected one point per snapshot date; got {series!r}"

    by_date = {pt["date"]: pt for pt in series}
    # Day 1: gross = |10000| + |5000| = 15000; net = +10000 + 5000 = 15000.
    assert by_date["2024-01-15"]["gross"] == pytest.approx(15000.0)
    assert by_date["2024-01-15"]["net"] == pytest.approx(15000.0)
    # Day 2: gross = |12000| + |4000| = 16000; net = +12000 - 4000 = 8000.
    assert by_date["2024-01-16"]["gross"] == pytest.approx(16000.0)
    assert by_date["2024-01-16"]["net"] == pytest.approx(8000.0)

    # Aggregates are derived from the SAME per-date series, so pin them too.
    assert result["max_gross_exposure"] == pytest.approx(16000.0)
    assert result["mean_gross_exposure"] == pytest.approx((15000.0 + 16000.0) / 2)


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
    async def test_snapshot_failure_does_not_set_reconstruction_flag(
        self,
    ) -> None:
        """Audit-2026-05-07 H-0633: WR-03 split. A `_load_position_time_series`
        failure must set `position_snapshots_unavailable` but MUST NOT set
        `position_reconstruction_failed` (those are distinct surfaces:
        snapshots is for the turnover/exposure grid, reconstruction is the
        FIFO matching on raw fills). A regression that conflates them would
        be caught here.
        """
        from services.analytics_runner import run_strategy_analytics

        sa_upsert_calls: list[dict] = []
        mock_supabase = _build_balance_flag_mock_supabase(
            daily_pnl_rows=_minimal_daily_rows(),
            sa_upsert_calls=sa_upsert_calls,
            strategy_api_key_id="key-1",
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

        async def _snapshot_failure(*_args, **_kwargs):
            raise RuntimeError("simulated snapshot RLS failure")

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
            new=AsyncMock(return_value={}),
        ), patch(
            "services.position_reconstruction.compute_exposure_metrics",
            new=AsyncMock(return_value={}),
        ), patch(
            "services.analytics_runner._load_position_time_series",
            side_effect=_snapshot_failure,
        ):
            result = await run_strategy_analytics("strat-test")

        assert result["status"] == "complete"
        successes = [
            u for u in sa_upsert_calls
            if u.get("computation_status") in ("complete", "complete_with_warnings")
        ]
        assert successes
        flags = successes[-1].get("data_quality_flags") or {}
        # Distinct surface flag SET.
        assert flags.get("position_snapshots_unavailable") is True, (
            f"snapshots-side failure must set position_snapshots_unavailable. "
            f"Got flags={flags}"
        )
        # Reconstruction-side flag MUST NOT fire (FIFO matching is healthy).
        assert flags.get("position_reconstruction_failed") is not True, (
            "snapshots-side failure must NOT set position_reconstruction_failed "
            f"(the two surfaces are distinct). Got flags={flags}"
        )

    @pytest.mark.asyncio
    async def test_reconstruction_failure_does_not_set_snapshots_flag(
        self,
    ) -> None:
        """Audit-2026-05-07 H-0633 mirror: a `reconstruct_positions` failure
        must set `position_reconstruction_failed` but MUST NOT set
        `position_snapshots_unavailable`."""
        from services.analytics_runner import run_strategy_analytics

        sa_upsert_calls: list[dict] = []
        mock_supabase = _build_balance_flag_mock_supabase(
            daily_pnl_rows=_minimal_daily_rows(),
            sa_upsert_calls=sa_upsert_calls,
            strategy_api_key_id="key-1",
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

        async def _reconstruct_failure(*_args, **_kwargs):
            raise RuntimeError("simulated FIFO failure")

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
            side_effect=_reconstruct_failure,
        ), patch(
            "services.position_reconstruction.compute_exposure_metrics",
            new=AsyncMock(return_value={}),
        ):
            result = await run_strategy_analytics("strat-test")

        assert result["status"] == "complete"
        successes = [
            u for u in sa_upsert_calls
            if u.get("computation_status") in ("complete", "complete_with_warnings")
        ]
        assert successes
        flags = successes[-1].get("data_quality_flags") or {}
        assert flags.get("position_reconstruction_failed") is True, (
            f"reconstruction failure must set position_reconstruction_failed. "
            f"Got flags={flags}"
        )
        assert flags.get("position_snapshots_unavailable") is not True, (
            "reconstruction failure must NOT set position_snapshots_unavailable "
            f"(the two surfaces are distinct). Got flags={flags}"
        )

    @pytest.mark.asyncio
    async def test_sibling_kinds_rpc_failure_sets_flag(self) -> None:
        """Audit-2026-05-07 H-0634: when the atomic batch RPC
        `upsert_strategy_analytics_series_batch` raises, the runner must
        emit `data_quality_flags.sibling_kinds_failed=True` on the
        strategy_analytics row so the UI can route around the empty panels.
        """
        from services.analytics_runner import run_strategy_analytics

        sa_upsert_calls: list[dict] = []
        rpc_calls: list[dict] = []
        snap_rows = _sample_position_snapshot_rows()

        mock_supabase = _build_runner_mock_supabase(
            daily_pnl_rows=[
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
                for i in range(30)
            ],
            fills_rows=[],
            snapshot_rows=snap_rows,
            rpc_calls=rpc_calls,
            sa_upsert_calls=sa_upsert_calls,
        )

        # Make supabase.rpc raise for the batch RPC.
        def _rpc_raises(name, params):
            rpc_calls.append({"name": name, "params": params})
            r = MagicMock()
            r.execute.side_effect = RuntimeError("simulated RPC outage")
            return r

        mock_supabase.rpc = _rpc_raises

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        mock_returns = pd.Series(
            [0.001] * 30, index=pd.bdate_range("2024-01-01", periods=30)
        )

        with patch(
            "services.analytics_runner.get_supabase", return_value=mock_supabase
        ), patch(
            "services.analytics_runner.db_execute", side_effect=_mock_db_execute
        ), patch(
            "services.analytics_runner.trades_to_daily_returns_with_status",
            return_value=(mock_returns, _DEFAULT_RETURNS_META),
        ), patch(
            "services.analytics_runner.get_benchmark_returns",
            new=AsyncMock(return_value=(None, True)),
        ), patch(
            "services.position_reconstruction.reconstruct_positions",
            new=AsyncMock(return_value={}),
        ), patch(
            "services.position_reconstruction.compute_exposure_metrics",
            new=AsyncMock(return_value={}),
        ):
            result = await run_strategy_analytics("strat-test")

        assert result["status"] == "complete"
        # The successful upsert sets `computation_status=complete`, then the
        # nested fail-handler upsert sets data_quality_flags including
        # `sibling_kinds_failed=True`. Look at the LAST upsert which carries
        # data_quality_flags (the recovery upsert).
        flag_upserts = [
            u for u in sa_upsert_calls
            if (u.get("data_quality_flags") or {}).get("sibling_kinds_failed")
        ]
        assert flag_upserts, (
            f"H-0634: sibling-batch failure must trigger a recovery upsert "
            f"with sibling_kinds_failed=True. All upserts: {sa_upsert_calls!r}"
        )

    @pytest.mark.asyncio
    async def test_fills_missing_is_maker_pct_reaches_top_level(self) -> None:
        """Audit-2026-05-07 H-0646: when fills lack `is_maker` (e.g., a
        compromised connector or a venue that doesn't tag fills), the runner
        must surface the missing-pct in top-level data_quality_flags so the
        UI can warn that the trade_mix panel is built from an incomplete view.
        """
        from services.analytics_runner import run_strategy_analytics

        sa_upsert_calls: list[dict] = []
        # 5 fills total — 2 missing is_maker → 40% missing. The 2-bucket
        # path runs because per-strategy coverage (60%) is below the 99% gate.
        fills_rows = [
            {
                "side": "buy", "cost": 100.0, "is_maker": True,
                "notional_usd": 1000.0, "filled_at": "2024-01-15T10:00:00+00:00",
            },
            {
                "side": "buy", "cost": 100.0, "is_maker": False,
                "notional_usd": 1000.0, "filled_at": "2024-01-15T11:00:00+00:00",
            },
            {
                "side": "sell", "cost": 100.0, "is_maker": True,
                "notional_usd": 1000.0, "filled_at": "2024-01-15T12:00:00+00:00",
            },
            {
                "side": "buy", "cost": 100.0, "is_maker": None,
                "notional_usd": 1000.0, "filled_at": "2024-01-15T13:00:00+00:00",
            },
            {
                "side": "sell", "cost": 100.0, "is_maker": None,
                "notional_usd": 1000.0, "filled_at": "2024-01-15T14:00:00+00:00",
            },
        ]
        mock_supabase = _build_runner_mock_supabase(
            daily_pnl_rows=_minimal_daily_rows(),
            fills_rows=fills_rows,
            snapshot_rows=[],
            rpc_calls=[],
            sa_upsert_calls=sa_upsert_calls,
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
            new=AsyncMock(return_value={}),
        ), patch(
            "services.position_reconstruction.compute_exposure_metrics",
            new=AsyncMock(return_value={}),
        ):
            result = await run_strategy_analytics("strat-test")

        assert result["status"] == "complete"
        successes = [
            u for u in sa_upsert_calls
            if u.get("computation_status") in ("complete", "complete_with_warnings")
        ]
        assert successes, f"no success upsert; saw {sa_upsert_calls!r}"
        top_flags = successes[-1].get("data_quality_flags") or {}
        # 2/5 = 0.4 expected.
        assert top_flags.get("fills_missing_is_maker_pct") == 0.4, (
            "H-0646: fills_missing_is_maker_pct must reach top-level "
            f"data_quality_flags. Got top_flags={top_flags}"
        )

    @pytest.mark.asyncio
    async def test_fills_missing_is_maker_pct_rounds_to_four_decimals(self) -> None:
        """Audit-2026-05-07 H-0646 contract: the published ratio is rounded to
        4 decimals. Build a 7-fill set with 1 missing is_maker (1/7 ≈
        0.142857...) and assert the flag equals exactly 0.1429.

        Pins the rounding precision so a future refactor that drops the
        ``round(..., 4)`` or changes the precision (e.g. to 2) is caught.
        """
        from services.analytics_runner import run_strategy_analytics

        sa_upsert_calls: list[dict] = []
        # 7 fills, 1 missing is_maker → 1/7 ≈ 0.142857142... → rounds to 0.1429.
        fills_rows = (
            [{"side": "buy", "cost": 100.0, "is_maker": True,
              "notional_usd": 1000.0,
              "filled_at": f"2024-01-15T{h:02d}:00:00+00:00"}
             for h in range(6)]
            + [{"side": "sell", "cost": 100.0, "is_maker": None,
                "notional_usd": 1000.0,
                "filled_at": "2024-01-15T06:00:00+00:00"}]
        )
        mock_supabase = _build_runner_mock_supabase(
            daily_pnl_rows=_minimal_daily_rows(), fills_rows=fills_rows,
            snapshot_rows=[], rpc_calls=[], sa_upsert_calls=sa_upsert_calls,
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

        with patch("services.analytics_runner.get_supabase", return_value=mock_supabase), \
             patch("services.analytics_runner.db_execute", side_effect=_mock_db_execute), \
             patch("services.analytics_runner.trades_to_daily_returns_with_status",
                   return_value=(mock_returns, _DEFAULT_RETURNS_META)), \
             patch("services.analytics_runner.compute_all_metrics", return_value=mock_metrics), \
             patch("services.analytics_runner.get_benchmark_returns",
                   new=AsyncMock(return_value=(None, True))), \
             patch("services.position_reconstruction.reconstruct_positions",
                   new=AsyncMock(return_value={})), \
             patch("services.position_reconstruction.compute_exposure_metrics",
                   new=AsyncMock(return_value={})):
            await run_strategy_analytics("strat-test")

        successes = [
            u for u in sa_upsert_calls
            if u.get("computation_status") in ("complete", "complete_with_warnings")
        ]
        top_flags = successes[-1].get("data_quality_flags") or {}
        # 1/7 = 0.142857142... → MUST round to 0.1429 (4 decimals).
        assert top_flags.get("fills_missing_is_maker_pct") == 0.1429, (
            "H-0646 rounding contract: 1/7 must round to 0.1429 at 4 "
            f"decimals. Got {top_flags.get('fills_missing_is_maker_pct')!r}"
        )

    @pytest.mark.asyncio
    async def test_fills_missing_is_maker_pct_omitted_when_zero(self) -> None:
        """Audit-2026-05-07 H-0646 contract: the flag is OMITTED (not emitted
        as 0.0) when every fill has `is_maker` set. Prevents slot-leak in
        DQF JSONB and matches the existing convention for other count-style
        flags (e.g. ``breakeven_positions``, ``positions_missing_realized_pnl``).
        """
        from services.analytics_runner import run_strategy_analytics

        sa_upsert_calls: list[dict] = []
        # Every fill has is_maker set → flag must be omitted.
        fills_rows = [
            {"side": "buy", "cost": 100.0, "is_maker": True,
             "notional_usd": 1000.0,
             "filled_at": f"2024-01-15T{h:02d}:00:00+00:00"}
            for h in range(5)
        ]
        mock_supabase = _build_runner_mock_supabase(
            daily_pnl_rows=_minimal_daily_rows(), fills_rows=fills_rows,
            snapshot_rows=[], rpc_calls=[], sa_upsert_calls=sa_upsert_calls,
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

        with patch("services.analytics_runner.get_supabase", return_value=mock_supabase), \
             patch("services.analytics_runner.db_execute", side_effect=_mock_db_execute), \
             patch("services.analytics_runner.trades_to_daily_returns_with_status",
                   return_value=(mock_returns, _DEFAULT_RETURNS_META)), \
             patch("services.analytics_runner.compute_all_metrics", return_value=mock_metrics), \
             patch("services.analytics_runner.get_benchmark_returns",
                   new=AsyncMock(return_value=(None, True))), \
             patch("services.position_reconstruction.reconstruct_positions",
                   new=AsyncMock(return_value={})), \
             patch("services.position_reconstruction.compute_exposure_metrics",
                   new=AsyncMock(return_value={})):
            await run_strategy_analytics("strat-test")

        successes = [
            u for u in sa_upsert_calls
            if u.get("computation_status") in ("complete", "complete_with_warnings")
        ]
        top_flags = successes[-1].get("data_quality_flags") or {}
        assert "fills_missing_is_maker_pct" not in top_flags, (
            "H-0646 omission contract: when 0 fills are missing is_maker, "
            "the flag must be ABSENT from data_quality_flags (no 0.0 slot). "
            f"Got top_flags={top_flags}"
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
    async def test_nav_proxy_uses_rolling_max_gross_exposure(
        self,
    ) -> None:
        """C-0221 is now enforced by construction (account_balance is not a
        parameter of `_load_position_time_series`), but the NAV-proxy
        contract still needs a regression guard: nav values must equal the
        rolling-max gross exposure, constant within a run."""
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
        order.range = _make_paged_range(snapshot_rows)
        order.order.return_value = order
        eq.order = MagicMock(return_value=order)
        sel.eq.return_value = eq
        t.select.return_value = sel
        mock_supabase.table.return_value = t

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        with patch(
            "services.analytics_runner.db_execute", side_effect=_mock_db_execute
        ):
            _, _, nav_by_date = await _load_position_time_series(
                "strat-test", mock_supabase
            )

        # Contract: NAV proxy is per-strategy rolling max gross exposure,
        # constant within a run. max(|10000| over 2024-01-15, |12000| over
        # 2024-01-16) = 12000.
        assert nav_by_date, "expected NAV entries for the two snapshot dates"
        nav_values = set(nav_by_date.values())
        assert nav_values == {12000.0}, (
            f"NAV proxy must be the rolling-max gross exposure (12000) and "
            f"constant within the run; got distinct values {nav_values}"
        )

    @pytest.mark.asyncio
    async def test_nav_proxy_handles_multi_symbol_same_day(
        self,
    ) -> None:
        """NAV proxy sums |size_usd| across all symbols on a date when picking
        the rolling-max gross exposure (C-0221 + H-0636 follow-up).
        Pins the H-0632 branch."""
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
        order.range = _make_paged_range(snapshot_rows)
        order.order.return_value = order
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
                "strat-test", mock_supabase
            )

        # max_gross_exposure on 2024-01-15 = |10000| + |-5000| = 15000.
        # Constant within the run.
        assert set(nav.values()) == {15000.0}, (
            f"NAV proxy should be rolling-max gross exposure (15000); got {nav}"
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
        order.range = _make_paged_range([])
        order.order.return_value = order
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
                "strat-test", mock_supabase
            )

        assert positions == {} and prices == {} and nav == {}

    @pytest.mark.asyncio
    async def test_snapshot_fetch_uses_pagination(self) -> None:
        """H-0629 / H-0643 regression: `_load_position_time_series` paginates
        through `.range()` so PostgREST's 1000-row default cap does not
        silently truncate snapshot reads for multi-year / multi-symbol
        strategies. The runner should iterate `.range()` until a short page
        appears.
        """
        from services.analytics_runner import _load_position_time_series

        # Build a 2-page paginated mock: page 0 yields 1000 rows, page 1
        # yields 200 rows (short page → loop terminates).
        page_size = 1000
        page0_rows = [
            {
                "snapshot_date": "2024-01-01",
                "symbol": f"SYM{i}",
                "side": "long",
                "size_usd": "100",
                "mark_price": "1",
            }
            for i in range(page_size)
        ]
        page1_rows = [
            {
                "snapshot_date": "2024-01-02",
                "symbol": f"SYM{i}",
                "side": "long",
                "size_usd": "100",
                "mark_price": "1",
            }
            for i in range(200)
        ]
        pages = [page0_rows, page1_rows]
        range_calls: list[tuple[int, int]] = []
        order_calls: list[tuple[str, bool]] = []

        order = MagicMock()
        order.execute.return_value = MagicMock(data=[])

        def _range(start, end):
            range_calls.append((start, end))
            page_idx = start // page_size
            data = pages[page_idx] if page_idx < len(pages) else []
            r = MagicMock()
            r.execute.return_value = MagicMock(data=data)
            return r

        order.range = MagicMock(side_effect=_range)

        # Capture every .order() call on the configured mock so the
        # composite order_by contract (snapshot_date, symbol, side) is
        # pinned. A regression that drops a column or reorders them
        # would surface here instead of going latent.
        def _order_side_effect(column, *, desc=False, **_kw):
            order_calls.append((column, bool(desc)))
            return order

        order.order.side_effect = _order_side_effect

        mock_supabase = MagicMock()
        t = MagicMock()
        sel = MagicMock()
        eq = MagicMock()

        def _eq_order_side_effect(column, *, desc=False, **_kw):
            order_calls.append((column, bool(desc)))
            return order

        eq.order = MagicMock(side_effect=_eq_order_side_effect)
        sel.eq.return_value = eq
        t.select.return_value = sel
        mock_supabase.table.return_value = t

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        with patch(
            "services.analytics_runner.db_execute", side_effect=_mock_db_execute
        ):
            positions, _, _ = await _load_position_time_series(
                "strat-test", mock_supabase
            )

        # Both pages worth of symbols must appear in positions.
        assert len(range_calls) == 2, (
            f".range() should be invoked once per page until short-page; "
            f"got {len(range_calls)} calls: {range_calls}"
        )
        assert range_calls[0] == (0, page_size - 1)
        assert range_calls[1] == (page_size, 2 * page_size - 1)
        # Page 0 has 1000 unique symbols on 2024-01-01; page 1 has 200 on 2024-01-02.
        assert len(positions["2024-01-01"]) == 1000
        assert len(positions["2024-01-02"]) == 200

        # Audit-2026-05-07 follow-up: pin the composite order_by contract.
        # Non-unique sort keys allow PostgREST to reorder ties across
        # pages → cross-page duplicates / skips → corrupted aggregates.
        # The composite (snapshot_date, symbol, side) matches the
        # `position_snapshots_unique_per_day` index from migration 034.
        assert order_calls == [
            ("snapshot_date", False),
            ("symbol", False),
            ("side", False),
        ], (
            "Snapshot pagination must order by the unique composite "
            "(snapshot_date, symbol, side) so cross-page ties cannot "
            f"duplicate or skip rows. Got order calls: {order_calls!r}"
        )

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
        order.range = _make_paged_range(snapshot_rows)
        order.order.return_value = order
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
                "strat-test", mock_supabase
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
        order.range = _make_paged_range(snapshot_rows)
        order.order.return_value = order
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
                "strat-test", mock_supabase
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
        order.range = _make_paged_range(snapshot_rows)
        order.order.return_value = order
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
                "strat-test", mock_supabase
            )

        # Position recorded, price omitted.
        assert positions["2024-01-15"]["BTCUSDT"] == 10000.0
        assert "BTCUSDT" not in prices.get("2024-01-15", {})

    # Phase B pr-test-analyzer F7: `_load_position_time_series` declares
    # `except PaginatedSelectTruncated: raise` to fail loud. The runner has
    # a broad `except Exception` immediately after; a reorder regression
    # would let the typed exception fall through into the SNAPSHOTS_LOAD_FAILED
    # DQF path. This test pins the re-raise contract.
    @pytest.mark.asyncio
    async def test_snapshot_pagination_truncation_raises_typed_exception(
        self,
    ) -> None:
        from services.analytics_runner import _load_position_time_series
        from services.db import PaginatedSelectTruncated

        # Build a mock whose `.range()` ALWAYS returns a full page — the
        # helper will run until it hits hard_cap_pages and then raise.
        page_size = 1000
        full_page = [
            {
                "snapshot_date": "2024-01-01",
                "symbol": f"SYM{i}",
                "side": "long",
                "size_usd": "100",
                "mark_price": "1",
            }
            for i in range(page_size)
        ]

        order = MagicMock()
        order.execute.return_value = MagicMock(data=full_page)

        def _range(_start, _end):
            r = MagicMock()
            r.execute.return_value = MagicMock(data=full_page)
            return r

        order.range = MagicMock(side_effect=_range)
        order.order.return_value = order

        mock_supabase = MagicMock()
        t = MagicMock()
        sel = MagicMock()
        eq = MagicMock()
        eq.order.return_value = order
        sel.eq.return_value = eq
        t.select.return_value = sel
        mock_supabase.table.return_value = t

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        with patch(
            "services.analytics_runner.db_execute", side_effect=_mock_db_execute
        ):
            with pytest.raises(PaginatedSelectTruncated):
                await _load_position_time_series("strat-truncated", mock_supabase)

    # Phase C red-team Finding 1: the inner re-raise is half the story.
    # The outer `except Exception as e:` in `run_strategy_analytics` used
    # to swallow `PaginatedSelectTruncated`, map it to a generic
    # HTTPException(500), and lose the page-count + hint context. The
    # worker dispatcher then classified the 500 as `unknown` → indefinite
    # retry on a permanent fault. This test pins the new dedicated handler:
    # the typed exception must ESCAPE `run_strategy_analytics` AND the
    # strategy_analytics row must carry a truncation-specific error message.
    @pytest.mark.asyncio
    async def test_pagination_truncation_propagates_through_run_strategy_analytics(
        self,
    ) -> None:
        from services.analytics_runner import run_strategy_analytics
        from services.db import PaginatedSelectTruncated

        upsert_payloads: list[dict] = []
        trade_rows = _minimal_daily_rows(15)

        def _mock_table(name):
            t = MagicMock()
            if name == "strategy_analytics":
                def _upsert(payload, **kwargs):
                    upsert_payloads.append(payload)
                    return MagicMock(
                        execute=MagicMock(return_value=MagicMock(data=[payload]))
                    )

                t.upsert.side_effect = _upsert
            elif name == "strategies":
                # Minimal published strategy with no api_key_id.
                data = {"id": "strat-trunc", "user_id": "u1", "api_key_id": None}
                t.select.return_value.eq.return_value.single.return_value.execute.return_value = MagicMock(
                    data=data
                )
            elif name == "trades":
                # Provide enough rows so the runner clears the >=2 trade-
                # history check and reaches the position-snapshot load.
                t.select.return_value.eq.return_value.neq.return_value.order.return_value.execute.return_value = MagicMock(
                    data=trade_rows
                )
            return t

        mock_supabase = MagicMock()
        mock_supabase.table.side_effect = _mock_table

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        dates = pd.bdate_range("2024-01-01", periods=15)
        mock_returns = pd.Series([0.001] * 15, index=dates)
        mock_meta = {
            "used_heuristic_capital": False,
            "balance_error": False,
            "computation_status_hint": "complete",
        }

        async def _raise_truncated(*_args, **_kwargs):
            raise PaginatedSelectTruncated(
                page_count=1000,
                page_size=1000,
                hint="position_snapshots strategy_id=strat-trunc",
            )

        with (
            patch(
                "services.analytics_runner.db_execute",
                side_effect=_mock_db_execute,
            ),
            patch(
                "services.analytics_runner.get_supabase",
                return_value=mock_supabase,
            ),
            patch(
                "services.analytics_runner.trades_to_daily_returns_with_status",
                return_value=(mock_returns, mock_meta),
            ),
            patch(
                "services.analytics_runner.get_benchmark_returns",
                new=AsyncMock(return_value=(None, True)),
            ),
            patch(
                "services.position_reconstruction.reconstruct_positions",
                new=AsyncMock(return_value={}),
            ),
            patch(
                "services.analytics_runner._load_position_time_series",
                side_effect=_raise_truncated,
            ),
        ):
            with pytest.raises(PaginatedSelectTruncated):
                await run_strategy_analytics("strat-trunc")

        # The strategy_analytics row must carry the truncation-specific
        # message (page count + hint), not the generic
        # "Analytics computation failed" placeholder.
        failure_upserts = [
            p for p in upsert_payloads
            if p.get("computation_status") == "failed"
        ]
        assert failure_upserts, (
            "Expected a failed-status upsert when PaginatedSelectTruncated "
            "propagates through run_strategy_analytics"
        )
        last_failure = failure_upserts[-1]
        error_msg = last_failure.get("computation_error", "")
        assert "operator intervention required" in error_msg, (
            f"Expected truncation-specific computation_error; got: {error_msg!r}"
        )
        assert "position_snapshots" in error_msg, (
            f"Expected truncation hint in computation_error; got: {error_msg!r}"
        )
