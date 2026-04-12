"""Tests for Bridge V1 REPLACE scoring."""

import pandas as pd
import numpy as np
import pytest
from services.bridge_scoring import find_replacement_candidates


def _make_returns(seed: int, n: int = 60, mu: float = 0.001, sigma: float = 0.02) -> pd.Series:
    """Generate a synthetic daily returns series."""
    rng = np.random.default_rng(seed)
    dates = pd.date_range("2025-01-01", periods=n, freq="B")
    return pd.Series(rng.normal(mu, sigma, n), index=dates)


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
