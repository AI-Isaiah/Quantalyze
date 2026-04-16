"""Edge-case coverage extensions for services/{portfolio_optimizer,
bridge_scoring, simulator_scoring, portfolio_metrics}.py.

Each module keeps its primary behaviour tests in its own file; this one
just closes well-defined gaps (early returns, None guards, unreachable
fallbacks) that the golden-path suites miss.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from services.bridge_scoring import find_replacement_candidates
from services.portfolio_metrics import (
    _parse_date,
    compute_modified_dietz,
    compute_mwr,
    compute_period_returns,
    compute_twr,
)
from services.portfolio_optimizer import (
    _avg_corr,
    _compute_sharpe,
    _max_drawdown,
    find_improvement_candidates,
    generate_narrative,
)
from services.simulator_scoring import (
    _cumulative_curve,
    _delta,
    _herfindahl,
)


# ---------------------------------------------------------------------------
# portfolio_optimizer
# ---------------------------------------------------------------------------

class TestPortfolioOptimizerEdges:
    def test_find_candidates_returns_empty_for_empty_portfolio(self) -> None:
        """port_df empty → early return (line 17)."""
        result = find_improvement_candidates(
            portfolio_returns={"s1": pd.Series([], dtype=float)},
            candidate_returns={"c1": pd.Series([1, 2, 3], dtype=float)},
            weights={"s1": 1.0},
        )
        assert result == []

    def test_find_candidates_skips_too_few_aligned_rows(self) -> None:
        """Candidate with <30 aligned rows is skipped (line 29)."""
        dates = pd.date_range("2026-01-01", periods=10, freq="D")
        portfolio = {"s1": pd.Series(np.zeros(10), index=dates)}
        # Candidate only overlaps 10 rows — below the 30-row threshold.
        candidates = {"c1": pd.Series(np.zeros(10), index=dates)}
        result = find_improvement_candidates(
            portfolio_returns=portfolio,
            candidate_returns=candidates,
            weights={"s1": 1.0},
        )
        assert result == []

    def test_compute_sharpe_returns_none_for_zero_std(self) -> None:
        """std == 0 → None (line 141)."""
        returns = pd.Series([0.01, 0.01, 0.01])
        assert _compute_sharpe(returns) is None

    def test_compute_sharpe_returns_none_for_empty(self) -> None:
        assert _compute_sharpe(pd.Series([], dtype=float)) is None

    def test_max_drawdown_returns_none_for_empty(self) -> None:
        """Empty returns series → None (line 156)."""
        assert _max_drawdown(pd.Series([], dtype=float)) is None

    def test_avg_corr_returns_none_for_single_column(self) -> None:
        """Single-strategy frame has no pairs → None."""
        df = pd.DataFrame({"s1": [0.01, 0.02, -0.01]})
        assert _avg_corr(df) is None

    def test_narrative_per_month_breakdown_and_optimizer_hint(self) -> None:
        """Covers lines 93-107 (monthly_returns) + 115-130 (optimizer
        recommendation) in generate_narrative."""
        analytics = {
            "return_mtd": 0.032,
            "avg_pairwise_correlation": 0.22,
            "attribution_breakdown": [
                {"strategy_name": "Alpha-7", "contribution": 0.08},
                {"strategy_name": "Beta-3", "contribution": -0.02},
            ],
            "risk_decomposition": [
                {"strategy_name": "Alpha-7", "marginal_risk_pct": 55, "weight_pct": 42},
            ],
            "monthly_returns": {
                "2026": {"01": 0.05, "02": -0.02, "03": 0.04},
                # Year with an unparsable month to exercise the fallback.
                "bad": {"xx": 0.01},
            },
            "portfolio_sharpe": 1.2,
            "optimizer_suggestions": [
                {"strategy_name": "Gamma-9", "sharpe_lift": 0.25},
            ],
        }
        narrative = generate_narrative(analytics)
        assert "Alpha-7" in narrative
        # Monthly breakdown lands in prose.
        assert "January 2026" in narrative or "March 2026" in narrative
        # Optimizer recommendation lands.
        assert "Gamma-9" in narrative
        assert "1.20" in narrative and "1.45" in narrative

    def test_narrative_empty_parts_returns_fallback(self) -> None:
        """No fields populated → default sentence (else branch of the join)."""
        assert generate_narrative({}) == "Portfolio analytics pending computation."


# ---------------------------------------------------------------------------
# bridge_scoring
# ---------------------------------------------------------------------------

class TestBridgeScoringEdges:
    def test_returns_empty_when_incumbent_weight_zero(self) -> None:
        """incumbent_weight <= 0 → early return (line 56)."""
        dates = pd.date_range("2026-01-01", periods=40, freq="D")
        portfolio = {
            "inc": pd.Series(np.zeros(40), index=dates),
            "s2": pd.Series(np.zeros(40), index=dates),
        }
        result = find_replacement_candidates(
            portfolio_returns=portfolio,
            candidate_returns={"c1": pd.Series(np.zeros(40), index=dates)},
            weights={"inc": 0.0, "s2": 1.0},
            incumbent_strategy_id="inc",
        )
        assert result == []

    def test_returns_empty_when_only_incumbent_remains(self) -> None:
        """Portfolio of 1 strategy (the incumbent) → no remaining (line 61)."""
        dates = pd.date_range("2026-01-01", periods=40, freq="D")
        portfolio = {"inc": pd.Series(np.zeros(40), index=dates)}
        result = find_replacement_candidates(
            portfolio_returns=portfolio,
            candidate_returns={"c1": pd.Series(np.zeros(40), index=dates)},
            weights={"inc": 1.0},
            incumbent_strategy_id="inc",
        )
        assert result == []

    def test_returns_empty_when_incumbent_not_in_portfolio(self) -> None:
        dates = pd.date_range("2026-01-01", periods=40, freq="D")
        portfolio = {"s1": pd.Series(np.zeros(40), index=dates)}
        result = find_replacement_candidates(
            portfolio_returns=portfolio,
            candidate_returns={"c1": pd.Series(np.zeros(40), index=dates)},
            weights={"s1": 1.0},
            incumbent_strategy_id="ghost",
        )
        assert result == []


# ---------------------------------------------------------------------------
# simulator_scoring helpers
# ---------------------------------------------------------------------------

class TestSimulatorScoringHelpers:
    def test_delta_treats_none_as_zero(self) -> None:
        """_delta coerces None to 0.0 (line 193)."""
        assert _delta(None, 0.5) == 0.0
        assert _delta(0.5, None) == 0.0
        assert _delta(1.0, 0.4) == pytest.approx(0.6)

    def test_herfindahl_empty_returns_none(self) -> None:
        """No positive weights → None (line 206)."""
        assert _herfindahl({}) is None
        # None weights are filtered; if only-None, also treated as empty.
        assert _herfindahl({"s1": None}) is None  # type: ignore[dict-item]

    def test_cumulative_curve_empty_returns_empty_list(self) -> None:
        """Empty returns series → [] (line 237)."""
        assert _cumulative_curve(pd.Series([], dtype=float)) == []


# ---------------------------------------------------------------------------
# portfolio_metrics
# ---------------------------------------------------------------------------

class TestPortfolioMetricsEdges:
    def test_compute_twr_too_short_returns_none(self) -> None:
        """<2 equity points → None (line 50)."""
        assert compute_twr(pd.Series([], dtype=float), []) is None
        assert compute_twr(pd.Series([100.0]), []) is None

    def test_compute_twr_skips_day_zero_cashflows(self) -> None:
        """Cash flow on the first equity date is ignored (cf_dates filter)."""
        dates = pd.to_datetime(["2026-01-01", "2026-01-02", "2026-01-03"])
        equity = pd.Series([100.0, 110.0, 121.0], index=dates)
        # Same-day deposit should be skipped (no prior value to ratio).
        events = [
            {"event_date": "2026-01-01", "event_type": "deposit", "amount": 100},
        ]
        assert compute_twr(equity, events) == pytest.approx(0.21, rel=1e-3)

    def test_compute_twr_with_midperiod_withdrawal(self) -> None:
        """Mid-period withdrawal lifts the end-before-cf value (cf_adjustment)."""
        dates = pd.to_datetime(
            ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"]
        )
        equity = pd.Series([100.0, 110.0, 55.0, 60.0], index=dates)
        events = [
            {"event_date": "2026-01-03", "event_type": "withdrawal", "amount": 50},
        ]
        twr = compute_twr(equity, events)
        assert twr is not None and twr > 0  # Removing the withdrawal gives a positive TWR

    def test_compute_twr_returns_none_when_all_subperiods_invalid(self) -> None:
        """begin_val == 0 on every sub-period → None (line 101)."""
        dates = pd.to_datetime(["2026-01-01", "2026-01-02"])
        equity = pd.Series([0.0, 10.0], index=dates)
        assert compute_twr(equity, []) is None

    def test_compute_mwr_empty_cash_flows_returns_none(self) -> None:
        """Empty input → None (line 133)."""
        assert compute_mwr([], 0.0) is None

    def test_compute_mwr_newton_success(self) -> None:
        """Happy path: one outflow then a larger inflow → positive IRR."""
        cash_flows = [
            {"date": "2025-01-01", "amount": -1000.0},
            {"date": "2026-01-01", "amount": 1100.0},
        ]
        irr = compute_mwr(cash_flows, final_value=0.0)
        assert irr is not None and irr == pytest.approx(0.1, abs=0.01)

    def test_compute_mwr_with_final_value_appended(self) -> None:
        """Negative-net cash flows + positive final_value → terminal append
        branch (line 151)."""
        cash_flows = [
            {"date": "2025-01-01", "amount": -1000.0},
        ]
        irr = compute_mwr(cash_flows, final_value=1100.0, end_date="2026-01-01")
        assert irr is not None and irr > 0

    def test_compute_modified_dietz_begin_value_zero_returns_none(self) -> None:
        """begin_value == 0 → None (line 203)."""
        assert compute_modified_dietz(0.0, 100.0, [], 30) is None

    def test_compute_modified_dietz_zero_denominator_returns_none(self) -> None:
        """Weighted CF exactly offsets begin_value → None (line 219)."""
        # Weight for day 0 = (period - 0) / period = 1. To hit denom == 0:
        # begin_value + 1 * amount == 0 → amount = -begin_value.
        result = compute_modified_dietz(
            begin_value=100.0,
            end_value=100.0,
            cash_flows=[{"amount": -100.0, "day": 0}],
            period_days=30,
        )
        assert result is None

    def test_compute_modified_dietz_simple_growth(self) -> None:
        """No cash flows, 10% growth → 0.10."""
        result = compute_modified_dietz(100.0, 110.0, [], 30)
        assert result == pytest.approx(0.1)

    def test_compute_period_returns_empty_series(self) -> None:
        """Empty returns → all None (line 236)."""
        empty = pd.Series([], dtype=float)
        result = compute_period_returns(empty)
        assert result == {"return_24h": None, "return_mtd": None, "return_ytd": None}

    def test_compute_period_returns_populates_all_buckets(self) -> None:
        dates = pd.to_datetime(
            ["2026-01-01", "2026-01-15", "2026-02-01", "2026-02-15"]
        )
        returns = pd.Series([0.01, 0.02, -0.005, 0.015], index=dates)
        result = compute_period_returns(returns)
        assert result["return_24h"] == pytest.approx(0.015)
        assert result["return_mtd"] is not None
        assert result["return_ytd"] is not None

    def test_parse_date_accepts_timestamp_and_datetime(self) -> None:
        """_parse_date fast-paths pd.Timestamp and date/datetime inputs
        (lines 25, 27)."""
        from datetime import date as _date, datetime as _dt

        assert _parse_date(pd.Timestamp("2026-01-01")) == pd.Timestamp("2026-01-01")
        assert _parse_date(_date(2026, 1, 1)) == pd.Timestamp("2026-01-01")
        assert _parse_date(_dt(2026, 1, 1, 12, 0)) == pd.Timestamp(
            "2026-01-01 12:00:00"
        )

    def test_compute_twr_skips_sub_period_with_single_obs(self) -> None:
        """A breakpoint that isolates a single equity point trips the
        `len(segment) < 2: continue` guard (line 76). The surrounding
        sub-periods still chain to a finite TWR."""
        dates = pd.to_datetime(
            ["2026-01-01", "2026-01-02", "2026-01-05", "2026-01-06"]
        )
        equity = pd.Series([100.0, 110.0, 105.0, 108.0], index=dates)
        # Cash flow on Jan 3 (no equity obs that day) creates a segment
        # spanning only Jan 2→Jan 3 with the single Jan 2 observation.
        events = [
            {"event_date": "2026-01-03", "event_type": "deposit", "amount": 50},
        ]
        twr = compute_twr(equity, events)
        assert twr is not None

    def test_compute_mwr_falls_back_to_brentq(self) -> None:
        """A contrived flow where Newton hits a stationary point forces the
        brentq fallback (lines 172-179)."""
        cash_flows = [
            {"date": "2025-01-01", "amount": -100.0},
            {"date": "2025-07-01", "amount": 50.0},
            {"date": "2026-01-01", "amount": 60.0},
        ]
        irr = compute_mwr(cash_flows, final_value=0.0)
        assert irr is not None
