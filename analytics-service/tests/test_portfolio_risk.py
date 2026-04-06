import pytest
import numpy as np
import pandas as pd
from services.portfolio_risk import (
    compute_correlation_matrix, compute_avg_pairwise_correlation,
    compute_risk_decomposition, compute_attribution, compute_rolling_correlation
)

def test_perfect_correlation():
    dates = pd.date_range("2026-01-01", periods=60, freq="D")
    returns = np.random.normal(0.001, 0.02, 60)
    strategies = {"s1": pd.Series(returns, index=dates), "s2": pd.Series(returns, index=dates)}
    matrix = compute_correlation_matrix(strategies)
    assert abs(matrix["s1"]["s2"] - 1.0) < 0.01

def test_uncorrelated_returns():
    np.random.seed(42)
    dates = pd.date_range("2026-01-01", periods=250, freq="D")
    strategies = {
        "s1": pd.Series(np.random.normal(0, 0.02, 250), index=dates),
        "s2": pd.Series(np.random.normal(0, 0.02, 250), index=dates),
    }
    matrix = compute_correlation_matrix(strategies)
    assert abs(matrix["s1"]["s2"]) < 0.3

def test_mcr_sums_to_portfolio_vol():
    weights = [0.5, 0.3, 0.2]
    cov = np.array([[0.04, 0.01, 0.005], [0.01, 0.03, 0.002], [0.005, 0.002, 0.02]])
    result = compute_risk_decomposition(weights, cov)
    total_mcr = sum(r["marginal_risk_pct"] for r in result)
    assert abs(total_mcr - 100.0) < 1.0

def test_attribution_sums_to_portfolio_return():
    weights = [0.4, 0.35, 0.25]
    twrs = [0.18, 0.12, -0.03]
    portfolio_twr = sum(w * t for w, t in zip(weights, twrs))
    result = compute_attribution(weights, twrs, portfolio_twr)
    total_contribution = sum(r["contribution"] for r in result)
    assert abs(total_contribution - portfolio_twr) < 0.001
