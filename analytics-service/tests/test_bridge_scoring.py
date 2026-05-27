"""Tests for Bridge V1 REPLACE scoring."""

import pandas as pd
import numpy as np
import pytest
from services.bridge_scoring import (
    find_replacement_candidates,
    _fit_label,
    _normalize,
    SHARPE_SCALE,
    CORR_SCALE,
    DD_SCALE,
)


def _make_returns(seed: int, n: int = 60, mu: float = 0.001, sigma: float = 0.02) -> pd.Series:
    """Generate a synthetic daily returns series."""
    rng = np.random.default_rng(seed)
    dates = pd.date_range("2025-01-01", periods=n, freq="B")
    return pd.Series(rng.normal(mu, sigma, n), index=dates)


def _series(values: list[float]) -> pd.Series:
    """Deterministic daily returns series from explicit values."""
    dates = pd.date_range("2025-01-01", periods=len(values), freq="B")
    return pd.Series(values, index=dates, dtype=float)


class TestFindReplacementCandidates:
    def test_returns_sorted_by_composite_score(self):
        portfolio = {
            "s1": _make_returns(1, mu=0.001),
            "s2": _make_returns(2, mu=-0.001),  # underperformer
            "s3": _make_returns(3, mu=0.002),
        }
        candidates = {
            "c1": _make_returns(10, mu=0.003),
            "c2": _make_returns(20, mu=0.002),
            "c3": _make_returns(30, mu=0.001),
        }
        weights = {"s1": 0.4, "s2": 0.3, "s3": 0.3}

        results = find_replacement_candidates(
            portfolio, candidates, weights, incumbent_strategy_id="s2"
        )

        assert len(results) > 0
        scores = [r["composite_score"] for r in results]
        assert scores == sorted(scores, reverse=True)

    def test_excludes_existing_portfolio_strategies(self):
        portfolio = {
            "s1": _make_returns(1),
            "s2": _make_returns(2),
        }
        # c1 has the same id as s1 — should be excluded
        candidates = {
            "s1": _make_returns(10),
            "c2": _make_returns(20),
        }
        weights = {"s1": 0.5, "s2": 0.5}

        results = find_replacement_candidates(
            portfolio, candidates, weights, incumbent_strategy_id="s2"
        )

        result_ids = {r["strategy_id"] for r in results}
        assert "s1" not in result_ids

    def test_returns_max_5_candidates(self):
        portfolio = {"s1": _make_returns(1), "s2": _make_returns(2)}
        candidates = {f"c{i}": _make_returns(i + 10) for i in range(10)}
        weights = {"s1": 0.5, "s2": 0.5}

        results = find_replacement_candidates(
            portfolio, candidates, weights, incumbent_strategy_id="s2"
        )

        assert len(results) <= 5

    def test_empty_when_incumbent_not_in_portfolio(self):
        portfolio = {"s1": _make_returns(1), "s2": _make_returns(2)}
        candidates = {"c1": _make_returns(10)}
        weights = {"s1": 0.5, "s2": 0.5}

        results = find_replacement_candidates(
            portfolio, candidates, weights, incumbent_strategy_id="nonexistent"
        )

        assert results == []

    def test_empty_when_no_candidates(self):
        portfolio = {"s1": _make_returns(1), "s2": _make_returns(2)}
        weights = {"s1": 0.5, "s2": 0.5}

        results = find_replacement_candidates(
            portfolio, {}, weights, incumbent_strategy_id="s2"
        )

        assert results == []

    def test_two_strategy_portfolio(self):
        """When one of two strategies underperforms, remaining is a single strategy."""
        portfolio = {"s1": _make_returns(1), "s2": _make_returns(2)}
        candidates = {"c1": _make_returns(10)}
        weights = {"s1": 0.5, "s2": 0.5}

        results = find_replacement_candidates(
            portfolio, candidates, weights, incumbent_strategy_id="s2"
        )

        # Should still work — avg_corr returns None for single-column df
        # but scoring handles it gracefully
        assert isinstance(results, list)

    def test_result_fields(self):
        portfolio = {"s1": _make_returns(1), "s2": _make_returns(2)}
        candidates = {"c1": _make_returns(10)}
        weights = {"s1": 0.5, "s2": 0.5}

        results = find_replacement_candidates(
            portfolio, candidates, weights, incumbent_strategy_id="s2"
        )

        if results:
            r = results[0]
            assert "strategy_id" in r
            assert "sharpe_delta" in r
            assert "dd_delta" in r
            assert "corr_delta" in r
            assert "composite_score" in r
            assert "fit_label" in r
            assert r["fit_label"] in ("Strong fit", "Good fit", "Moderate fit", "Weak fit")
            # strategy_name is intentionally NOT in the raw scoring output.
            # It is hydrated by the router (portfolio.py) from the strategies
            # table before returning to the client. The Zod BridgeResponseSchema
            # requires it, so the router MUST add it.
            assert "strategy_name" not in r

    def test_skips_candidates_with_insufficient_data(self):
        portfolio = {"s1": _make_returns(1, n=60), "s2": _make_returns(2, n=60)}
        # Candidate with only 10 data points (< 30 minimum)
        candidates = {"c1": _make_returns(10, n=10)}
        weights = {"s1": 0.5, "s2": 0.5}

        results = find_replacement_candidates(
            portfolio, candidates, weights, incumbent_strategy_id="s2"
        )

        assert results == []


class TestDrawdownSign:
    """H-1065: dd_delta must be POSITIVE when a candidate reduces portfolio
    drawdown, so the positive-weighted composite rewards (not penalizes) the
    improvement. Under the old (current_dd - new_dd) convention this was
    negative and the REPLACE ranking favored candidates that worsened drawdown.
    """

    def test_dd_delta_positive_when_candidate_reduces_drawdown(self):
        n = 40
        mild = [0.001] * n
        # Incumbent crashes hard mid-window (deep drawdown).
        crash = [0.001] * 10 + [-0.05] * 10 + [0.001] * 20
        # Candidate is steadily positive — no drawdown.
        smooth = [0.002] * n
        portfolio = {"s1": _series(mild), "s2": _series(crash)}
        candidates = {"c1": _series(smooth)}
        weights = {"s1": 0.5, "s2": 0.5}

        results = find_replacement_candidates(
            portfolio, candidates, weights, incumbent_strategy_id="s2"
        )

        assert results, "expected the smooth candidate to be scored"
        # Replacing the crashing incumbent with a smooth candidate shallows the
        # portfolio drawdown → positive dd_delta under the corrected convention.
        assert results[0]["dd_delta"] > 0


class TestFitLabelCalibration:
    """H-1066: deltas are normalized per-axis to [-1, 1] before weighting, so the
    composite lives in [-1, 1] and the fit thresholds are reachable for realistic
    candidates (which previously all collapsed to 'Weak fit').
    """

    def test_normalize_scales_and_clamps(self):
        assert _normalize(0.5, 0.5) == 1.0
        assert _normalize(0.25, 0.5) == 0.5
        assert _normalize(0.0, 0.5) == 0.0
        # Beyond the reference magnitude clamps to the unit band.
        assert _normalize(1.0, 0.5) == 1.0
        assert _normalize(-1.0, 0.5) == -1.0

    def test_fit_label_thresholds(self):
        assert _fit_label(0.75) == "Strong fit"
        assert _fit_label(0.60) == "Good fit"
        assert _fit_label(0.30) == "Moderate fit"
        assert _fit_label(0.10) == "Weak fit"

    def _composite(self, sharpe_delta, corr_delta, dd_delta):
        # Mirrors find_replacement_candidates' composite with default weights.
        return (
            0.4 * _normalize(sharpe_delta, SHARPE_SCALE)
            + 0.3 * _normalize(corr_delta, CORR_SCALE)
            + 0.3 * _normalize(dd_delta, DD_SCALE)
        )

    def test_realistic_modest_candidate_escapes_weak(self):
        # The finding's realistic example (sharpe +0.3, corr -0.05, dd +0.02)
        # scored composite ~0.14 → 'Weak fit' under the un-normalized formula.
        # Normalized it reaches 'Moderate fit', so allocators no longer see every
        # candidate badged 'Weak'.
        assert _fit_label(self._composite(0.3, 0.05, 0.02)) == "Moderate fit"

    def test_strong_sharpe_and_corr_candidate_is_good_fit(self):
        # Finding's pinned case: a 0.5 Sharpe improvement + 0.1 correlation
        # reduction must reach 'Good fit', not 'Weak fit'.
        assert _fit_label(self._composite(0.5, 0.1, 0.0)) == "Good fit"

    def test_excellent_on_all_axes_is_strong_fit(self):
        assert _fit_label(self._composite(0.5, 0.15, 0.10)) == "Strong fit"
