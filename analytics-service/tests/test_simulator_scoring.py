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

        # Both curves cover the same candidate∩portfolio intersection
        # window (NEW-C11-03 fix) and must be non-empty for a happy path.
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
        # SF-5: both current and proposed metrics are None in the insufficient_data
        # branch. Current metrics were computed over the same sub-MIN_DATA_POINTS
        # window — they are numerically unreliable (<30 days Sharpe/MaxDD) and
        # must not be rendered as trusted portfolio state. current_metrics_reliable
        # signals callers that the portfolio-side values should not be shown.
        assert result["proposed"]["sharpe"] is None
        assert result["current"]["sharpe"] is None
        assert result["current_metrics_reliable"] is False
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

    def test_window_coincident_current_metrics(self):
        """NEW-C11-03 regression: current_* metrics for deltas must be scored
        over the same intersection window as proposed_*, not the full port_df.

        Pre-fix: current metrics used port_df (full history); proposed used
        aligned (shorter intersection). A candidate with only a recent calm
        history manufactured an artificial Sharpe lift from regime mismatch.

        Test setup: portfolio has 300-day history; candidate has only 60 days.
        With the pre-fix code, current_sharpe was scored over 300 days; now it
        must be scored over ~60 days so the delta is window-coincident.

        We verify this by asserting that the returned current metrics are
        consistent with a 60-day window — specifically that both
        equity_curve_current and equity_curve_proposed have the same length
        (both scored over the intersection). Pre-fix equity_curve_current used
        the full 300-day window and would be much longer.
        """
        # Portfolio: 300 days of calm positive drift
        port_dates_long = pd.date_range("2024-01-01", periods=300, freq="B")
        rng = np.random.default_rng(77)
        s1_long = pd.Series(rng.normal(0.001, 0.015, 300), index=port_dates_long)
        s2_long = pd.Series(rng.normal(0.001, 0.015, 300), index=port_dates_long)

        # Candidate: only last 60 business days (subset of portfolio window)
        candidate_dates = port_dates_long[-60:]
        candidate_short = pd.Series(rng.normal(0.005, 0.005, 60), index=candidate_dates)

        result = simulate_add_candidate(
            portfolio_returns={"s1": s1_long, "s2": s2_long},
            candidate_id="c_short",
            candidate_returns=candidate_short,
            weights={"s1": 0.5, "s2": 0.5},
        )

        assert result["status"] == "ok"
        # overlap_days should be ~60 (the candidate window)
        assert result["overlap_days"] <= 62

        # NEW-C11-03: both curves must cover the same (intersection) window.
        # Pre-fix: equity_curve_current used all 300 days → len ≈ 300;
        # equity_curve_proposed used 60 days → delta was window-mismatched.
        # Post-fix: both are scored over the ~60-day intersection.
        len_current = len(result["equity_curve_current"])
        len_proposed = len(result["equity_curve_proposed"])
        assert len_current == len_proposed, (
            f"NEW-C11-03: equity curves must share the same intersection window. "
            f"current={len_current} days vs proposed={len_proposed} days. "
            f"Pre-fix: current used full port history ({len(port_dates_long)} days)."
        )
        # Both curves should be ~60 points (not 300).
        assert len_current <= 65, (
            f"equity_curve_current has {len_current} points but should be "
            f"≤65 (the ~60-day intersection). Pre-fix: it would be ~300."
        )

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


# ---------------------------------------------------------------------------
# Red-team regression tests (2026-05-26)
# ---------------------------------------------------------------------------


class TestRedteamRegressions:
    def test_insufficient_data_equity_curve_current_is_empty(self):
        """H-3 (red-team): equity_curve_current must be [] in the
        insufficient_data branch — not a short sub-MIN_DATA_POINTS curve.

        Pre-fix: the branch emitted _cumulative_curve(current_returns) for
        equity_curve_current even while nulling metric chips. A sub-30-day
        curve rendered alongside null chips (sharpe=None etc.) is visually
        inconsistent: the chart implies "representative history" while
        the numbers show "—". The curve also starts at an arbitrary recent
        date rather than a meaningful base.

        Post-fix: equity_curve_current=[] in the insufficient_data branch,
        matching equity_curve_proposed=[] for a consistent "no data" UI state.
        """
        portfolio = {
            "s1": _make_returns(1, n=60),
            "s2": _make_returns(2, n=60),
        }
        # Candidate with only 10 overlap days → below MIN_DATA_POINTS=30
        candidate = _make_returns(10, n=10)
        weights = {"s1": 0.5, "s2": 0.5}

        result = simulate_add_candidate(
            portfolio_returns=portfolio,
            candidate_id="c1",
            candidate_returns=candidate,
            weights=weights,
        )

        assert result["status"] == "insufficient_data"
        assert result["equity_curve_current"] == [], (
            "H-3: equity_curve_current must be [] in insufficient_data. "
            "Pre-fix: it was _cumulative_curve(current_returns) over the "
            "sub-30-day window, inconsistent with the nulled metric chips."
        )
        assert result["equity_curve_proposed"] == []

    def test_ok_branch_has_current_metrics_reliable_true(self):
        """M-3 (red-team): the ok branch must include current_metrics_reliable=True.

        Pre-fix: only the insufficient_data branch emitted current_metrics_reliable
        (False). The ok branch did not emit the field. A caller using
        result.get("current_metrics_reliable") would get None (falsy) on the ok
        path, potentially triggering a "metrics unreliable" UI state for a fully
        valid simulation result.

        Post-fix: both branches emit the field — False for insufficient_data,
        True for ok.
        """
        portfolio = {
            "s1": _make_returns(1, n=180),
            "s2": _make_returns(2, n=180),
        }
        candidate = _make_returns(10, n=180)
        weights = {"s1": 0.5, "s2": 0.5}

        result = simulate_add_candidate(
            portfolio_returns=portfolio,
            candidate_id="c1",
            candidate_returns=candidate,
            weights=weights,
        )

        assert result["status"] == "ok"
        assert "current_metrics_reliable" in result, (
            "M-3: ok branch must include current_metrics_reliable key. "
            "Pre-fix: the key was absent → result.get('current_metrics_reliable') "
            "returned None (falsy), triggering a spurious UI warning."
        )
        assert result["current_metrics_reliable"] is True, (
            "M-3: current_metrics_reliable must be True in the ok branch "
            f"(overlap_days={result['overlap_days']} >= MIN_DATA_POINTS=30)."
        )

    def test_both_branches_have_consistent_result_shape(self):
        """M-3 complement: current_metrics_reliable is present in BOTH
        branches with appropriate values — no KeyError for callers that
        access the field unconditionally.
        """
        # Scenario 1: ok branch
        port = {"s1": _make_returns(1, n=200), "s2": _make_returns(2, n=200)}
        cand_ok = _make_returns(10, n=200)
        r_ok = simulate_add_candidate(
            portfolio_returns=port, candidate_id="c_ok",
            candidate_returns=cand_ok, weights={"s1": 0.5, "s2": 0.5},
        )
        assert r_ok["status"] == "ok"
        assert r_ok["current_metrics_reliable"] is True

        # Scenario 2: insufficient_data branch
        cand_short = _make_returns(10, n=5)  # 5 overlap days << 30
        r_short = simulate_add_candidate(
            portfolio_returns=port, candidate_id="c_short",
            candidate_returns=cand_short, weights={"s1": 0.5, "s2": 0.5},
        )
        assert r_short["status"] == "insufficient_data"
        assert r_short["current_metrics_reliable"] is False
