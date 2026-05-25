import pytest
import numpy as np
import pandas as pd
from services.portfolio_optimizer import find_improvement_candidates, generate_narrative

def test_negatively_correlated_improves_sharpe():
    np.random.seed(42)
    dates = pd.date_range("2026-01-01", periods=250, freq="D")
    base_returns = np.random.normal(0.001, 0.02, 250)
    portfolio = {"s1": pd.Series(base_returns, index=dates)}
    candidates = {"c1": pd.Series(-base_returns + np.random.normal(0.001, 0.01, 250), index=dates)}
    weights = {"s1": 1.0}
    results = find_improvement_candidates(portfolio, candidates, weights)
    assert len(results) == 1
    assert results[0]["corr_with_portfolio"] < 0
    assert results[0]["sharpe_lift"] > 0

def test_identical_candidate_no_improvement():
    np.random.seed(42)
    dates = pd.date_range("2026-01-01", periods=250, freq="D")
    returns = np.random.normal(0.001, 0.02, 250)
    portfolio = {"s1": pd.Series(returns, index=dates)}
    candidates = {"c1": pd.Series(returns, index=dates)}
    weights = {"s1": 1.0}
    results = find_improvement_candidates(portfolio, candidates, weights)
    assert results[0]["corr_with_portfolio"] > 0.9

def test_empty_portfolio_returns_empty_list():
    """M-0700 (a): port_df.empty → return []. An empty portfolio_returns
    dict yields an empty DataFrame after dropna, which must short-circuit
    to [] rather than crashing on the downstream sharpe / corr math."""
    results = find_improvement_candidates(
        {}, {"c1": pd.Series([0.01, 0.02])}, {}
    )
    assert results == []


def test_candidate_with_insufficient_history_is_skipped():
    """M-0700 (b): a candidate with fewer than 30 aligned rows is skipped
    (`if len(aligned) < 30: continue`). Without that guard the optimizer
    would emit suggestions computed on near-zero data."""
    np.random.seed(11)
    dates = pd.date_range("2026-01-01", periods=250, freq="D")
    portfolio = {"s1": pd.Series(np.random.normal(0.001, 0.02, 250), index=dates)}
    # Candidate overlaps only 10 days with the portfolio → < 30 aligned.
    short_dates = pd.date_range("2026-01-01", periods=10, freq="D")
    candidates = {
        "short": pd.Series(np.random.normal(0.0, 0.01, 10), index=short_dates)
    }
    results = find_improvement_candidates(portfolio, candidates, {"s1": 1.0})
    assert results == [], (
        "a candidate with < 30 aligned rows must be skipped, not ranked"
    )


def test_ranking_capped_at_top_5_and_sorted_descending():
    """M-0700 (c): with > 5 candidates the result is sorted DESC by score
    and capped at 5 (`[:5]` slice). The [:5] is the entire 'top-N' API
    contract — a regression to [:50] would expose internal candidates the
    contract should hide; a missing sort would surface low-score rows."""
    np.random.seed(7)
    dates = pd.date_range("2026-01-01", periods=250, freq="D")
    portfolio = {"s1": pd.Series(np.random.normal(0.001, 0.02, 250), index=dates)}
    candidates = {
        f"c{i}": pd.Series(np.random.normal(0.001, 0.02, 250), index=dates)
        for i in range(8)
    }
    results = find_improvement_candidates(portfolio, candidates, {"s1": 1.0})
    assert len(results) == 5, "result must be capped at the top 5 candidates"
    scores = [r["score"] for r in results]
    assert scores == sorted(scores, reverse=True), (
        "candidates must be ranked by score DESC"
    )


def test_zero_weight_sum_does_not_divide_by_zero():
    """M-0700 (d): when the resolved weight vector sums to 0 the
    `if w_arr.sum() > 0` guard skips the normalisation rather than dividing
    by zero (which would inject NaN into every downstream metric).
    Passing weights that map to none of the portfolio columns yields a
    zero-sum w_arr — the function must still return a list without raising.
    """
    np.random.seed(13)
    dates = pd.date_range("2026-01-01", periods=250, freq="D")
    portfolio = {"s1": pd.Series(np.random.normal(0.001, 0.02, 250), index=dates)}
    candidates = {
        "c1": pd.Series(np.random.normal(0.001, 0.02, 250), index=dates)
    }
    # weights reference an id NOT in the portfolio → w_arr = [0] → sum 0.
    results = find_improvement_candidates(portfolio, candidates, {"other": 1.0})
    assert isinstance(results, list)
    # No NaN leaked into the emitted score (would happen on a /0 normalise).
    for r in results:
        assert r["score"] is None or not (
            isinstance(r["score"], float) and r["score"] != r["score"]
        )


def test_narrative_contains_key_metrics():
    analytics = {
        "return_mtd": 0.048,
        "avg_pairwise_correlation": 0.18,
        "attribution_breakdown": [
            {"strategy_name": "Alpha-7", "contribution": 0.0756},
            {"strategy_name": "Beta-3", "contribution": 0.0396},
        ],
        "risk_decomposition": [
            {"strategy_name": "Alpha-7", "marginal_risk_pct": 55, "weight_pct": 42},
        ],
    }
    narrative = generate_narrative(analytics)
    assert "4.8%" in narrative or "4.80%" in narrative
    assert "Alpha-7" in narrative
    assert "0.18" in narrative
