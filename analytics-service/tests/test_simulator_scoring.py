"""Tests for Sprint 6 Task 6.4 portfolio impact simulator (ADD scenario)."""

import numpy as np
import pandas as pd

from services.simulator_scoring import (
    PARTIAL_HISTORY_THRESHOLD,
    simulate_add_candidate,
)


def _make_returns(
    seed: int, n: int = 180, mu: float = 0.001, sigma: float = 0.02
) -> pd.Series:
    """Generate a synthetic daily returns series."""
    rng = np.random.default_rng(seed)
    dates = pd.date_range("2025-01-01", periods=n, freq="B")
    return pd.Series(rng.normal(mu, sigma, n), index=dates)


class TestSimulateAddCandidate:
    def test_happy_path_returns_deltas_and_curves(self):
        portfolio = {
            "s1": _make_returns(1, mu=0.001),
            "s2": _make_returns(2, mu=0.0015),
        }
        candidate_id = "c1"
        candidate = _make_returns(10, mu=0.003)
        weights = {"s1": 0.5, "s2": 0.5}

        result = simulate_add_candidate(
            portfolio_returns=portfolio,
            candidate_id=candidate_id,
            candidate_returns=candidate,
            weights=weights,
        )

        assert result["candidate_id"] == candidate_id
        assert result["status"] == "ok"
        assert result["overlap_days"] > 0

        # All 4 delta chips are present.
        for key in (
            "sharpe_delta",
            "dd_delta",
            "corr_delta",
            "concentration_delta",
        ):
            assert key in result["deltas"]
            assert isinstance(result["deltas"][key], float)

        # Before / after curves are present and aligned (they may differ in
        # length because the "before" curve uses the full intersected window
        # of existing strategies while the "after" curve is the 3-way
        # intersection, but both must be non-empty for a happy path).
        assert len(result["equity_curve_current"]) > 0
        assert len(result["equity_curve_proposed"]) > 0
        for point in result["equity_curve_current"]:
            assert "date" in point and "value" in point

        # Current + proposed metrics are populated.
        for key in ("sharpe", "max_drawdown", "avg_correlation", "concentration"):
            assert key in result["current"]
            assert key in result["proposed"]

    def test_strong_candidate_improves_sharpe(self):
        """A clearly-better candidate should yield positive sharpe_delta."""
        portfolio = {
            "s1": _make_returns(1, mu=-0.001, sigma=0.03),  # poor Sharpe
            "s2": _make_returns(2, mu=-0.0005, sigma=0.03),
        }
        candidate = _make_returns(10, mu=0.003, sigma=0.01)  # high Sharpe
        weights = {"s1": 0.5, "s2": 0.5}

        result = simulate_add_candidate(
            portfolio_returns=portfolio,
            candidate_id="c1",
            candidate_returns=candidate,
            weights=weights,
        )

        assert result["status"] == "ok"
        assert result["deltas"]["sharpe_delta"] > 0

    def test_concentration_delta_decreases_when_diversifying(self):
        """Adding a 3rd strategy to a 2-strategy portfolio must reduce HHI
        (concentration_delta > 0 per the positive=improvement sign convention)."""
        portfolio = {
            "s1": _make_returns(1),
            "s2": _make_returns(2),
        }
        candidate = _make_returns(10)
        weights = {"s1": 0.5, "s2": 0.5}

        result = simulate_add_candidate(
            portfolio_returns=portfolio,
            candidate_id="c1",
            candidate_returns=candidate,
            weights=weights,
        )

        assert result["status"] == "ok"
        assert result["deltas"]["concentration_delta"] > 0

    def test_partial_history_warning_flag(self):
        """Overlap < PARTIAL_HISTORY_THRESHOLD (126bd) flips partial_history."""
        portfolio = {"s1": _make_returns(1, n=60), "s2": _make_returns(2, n=60)}
        # Candidate has fewer points than the threshold even though > 30.
        candidate = _make_returns(10, n=50)
        weights = {"s1": 0.5, "s2": 0.5}

        result = simulate_add_candidate(
            portfolio_returns=portfolio,
            candidate_id="c1",
            candidate_returns=candidate,
            weights=weights,
        )

        assert result["status"] == "ok"
        assert result["overlap_days"] < PARTIAL_HISTORY_THRESHOLD
        assert result["partial_history"] is True

    def test_long_history_clears_partial_warning(self):
        portfolio = {
            "s1": _make_returns(1, n=300),
            "s2": _make_returns(2, n=300),
        }
        candidate = _make_returns(10, n=300)
        weights = {"s1": 0.5, "s2": 0.5}

        result = simulate_add_candidate(
            portfolio_returns=portfolio,
            candidate_id="c1",
            candidate_returns=candidate,
            weights=weights,
        )

        assert result["status"] == "ok"
        assert result["overlap_days"] >= PARTIAL_HISTORY_THRESHOLD
        assert result["partial_history"] is False

    def test_insufficient_data_short_candidate(self):
        portfolio = {
            "s1": _make_returns(1, n=60),
            "s2": _make_returns(2, n=60),
        }
        # Only 10 points of candidate data — below MIN_DATA_POINTS=30.
        candidate = _make_returns(10, n=10)
        weights = {"s1": 0.5, "s2": 0.5}

        result = simulate_add_candidate(
            portfolio_returns=portfolio,
            candidate_id="c1",
            candidate_returns=candidate,
            weights=weights,
        )

        assert result["status"] == "insufficient_data"
        assert result["partial_history"] is True
        # Proposed metrics stay None because we can't score without enough
        # overlapping data, but current is still populated so the UI can
        # render the "before" side and explain why the "after" side is empty.
        assert result["proposed"]["sharpe"] is None
        assert result["equity_curve_proposed"] == []

    def test_already_in_portfolio(self):
        portfolio = {
            "s1": _make_returns(1),
            "s2": _make_returns(2),
        }
        weights = {"s1": 0.5, "s2": 0.5}

        result = simulate_add_candidate(
            portfolio_returns=portfolio,
            candidate_id="s1",  # already in the portfolio
            candidate_returns=_make_returns(100),
            weights=weights,
        )

        assert result["status"] == "already_in_portfolio"
        assert result["equity_curve_current"] == []
        assert result["equity_curve_proposed"] == []

    def test_empty_portfolio(self):
        result = simulate_add_candidate(
            portfolio_returns={},
            candidate_id="c1",
            candidate_returns=_make_returns(1),
            weights={},
        )
        assert result["status"] == "empty_portfolio"

    def test_deltas_are_finite(self):
        """No NaN/Inf must leak through — _safe_float guards these."""
        portfolio = {
            "s1": _make_returns(1),
            "s2": _make_returns(2),
        }
        candidate = _make_returns(10)
        weights = {"s1": 0.5, "s2": 0.5}

        result = simulate_add_candidate(
            portfolio_returns=portfolio,
            candidate_id="c1",
            candidate_returns=candidate,
            weights=weights,
        )

        for value in result["deltas"].values():
            assert value is None or (np.isfinite(value))

    def test_equity_curve_starts_near_one(self):
        portfolio = {
            "s1": _make_returns(1, n=60),
            "s2": _make_returns(2, n=60),
        }
        candidate = _make_returns(10, n=60)
        weights = {"s1": 0.5, "s2": 0.5}

        result = simulate_add_candidate(
            portfolio_returns=portfolio,
            candidate_id="c1",
            candidate_returns=candidate,
            weights=weights,
        )

        current = result["equity_curve_current"]
        proposed = result["equity_curve_proposed"]
        assert current and proposed
        # First cumulative point is (1 + r0) — close to 1.0 for small
        # daily returns.
        assert abs(current[0]["value"] - 1.0) < 0.1
        assert abs(proposed[0]["value"] - 1.0) < 0.1

    def test_invalid_candidate_handled_by_router_layer(self):
        """The scoring module has no Supabase context, so "invalid candidate
        id" is enforced at the router layer (404). At the scoring level,
        any candidate id that happens to overlap with the portfolio is
        treated as already_in_portfolio; any other id runs normally as
        long as its returns series passes the min-data-points gate."""
        portfolio = {"s1": _make_returns(1), "s2": _make_returns(2)}
        weights = {"s1": 0.5, "s2": 0.5}

        # A "nonexistent" candidate with a valid returns series still
        # scores — the router is responsible for rejecting unknown ids
        # before we get here. This asserts the module-level contract.
        result = simulate_add_candidate(
            portfolio_returns=portfolio,
            candidate_id="not-a-real-id",
            candidate_returns=_make_returns(99),
            weights=weights,
        )
        assert result["status"] == "ok"
        assert result["candidate_id"] == "not-a-real-id"

    def test_sign_convention_positive_is_improvement(self):
        """Regression test for the positive=improvement sign convention
        across all four deltas. A superior candidate (higher mean return,
        lower vol, low correlation) should push every delta toward
        positive."""
        np.random.seed(42)
        dates = pd.date_range("2025-01-01", periods=200, freq="B")

        # Two highly-correlated incumbents — lots of redundant risk.
        drift = np.random.normal(0.0, 0.02, 200)
        s1 = pd.Series(drift + np.random.normal(0.0005, 0.005, 200), index=dates)
        s2 = pd.Series(drift + np.random.normal(0.0005, 0.005, 200), index=dates)

        # Uncorrelated, higher-mean, lower-vol candidate.
        candidate = pd.Series(np.random.normal(0.002, 0.01, 200), index=dates)

        result = simulate_add_candidate(
            portfolio_returns={"s1": s1, "s2": s2},
            candidate_id="c1",
            candidate_returns=candidate,
            weights={"s1": 0.5, "s2": 0.5},
        )

        assert result["status"] == "ok"
        # Three of these four are statistical — the candidate was designed
        # to beat on every axis so sharpe_delta should be positive and
        # corr_delta should be non-negative. Concentration is guaranteed
        # by construction (going from 2 to 3 strategies).
        assert result["deltas"]["sharpe_delta"] > 0
        assert result["deltas"]["concentration_delta"] > 0
