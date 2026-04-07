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
