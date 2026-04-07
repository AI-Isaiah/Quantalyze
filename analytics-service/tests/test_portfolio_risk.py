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


def test_correlation_matrix_empty():
    assert compute_correlation_matrix({}) == {}


def test_correlation_matrix_single_strategy():
    dates = pd.date_range("2026-01-01", periods=30, freq="D")
    strategies = {"s1": pd.Series(np.random.normal(0, 0.02, 30), index=dates)}
    matrix = compute_correlation_matrix(strategies)
    assert matrix == {"s1": {"s1": 1.0}}


def test_correlation_matrix_insufficient_data():
    """Less than 10 overlapping rows returns None values."""
    dates = pd.date_range("2026-01-01", periods=5, freq="D")
    strategies = {
        "s1": pd.Series([0.01, 0.02, -0.01, 0.005, 0.0], index=dates),
        "s2": pd.Series([0.01, 0.02, -0.01, 0.005, 0.0], index=dates),
    }
    matrix = compute_correlation_matrix(strategies)
    assert matrix["s1"]["s2"] is None


def test_avg_pairwise_correlation_basic():
    matrix = {
        "s1": {"s1": 1.0, "s2": 0.5, "s3": 0.3},
        "s2": {"s1": 0.5, "s2": 1.0, "s3": 0.7},
        "s3": {"s1": 0.3, "s2": 0.7, "s3": 1.0},
    }
    avg = compute_avg_pairwise_correlation(matrix)
    assert abs(avg - 0.5) < 0.01


def test_avg_pairwise_correlation_too_few():
    assert compute_avg_pairwise_correlation({"s1": {"s1": 1.0}}) is None
    assert compute_avg_pairwise_correlation({}) is None


def test_avg_pairwise_correlation_skips_none():
    matrix = {
        "s1": {"s1": 1.0, "s2": None, "s3": 0.4},
        "s2": {"s1": None, "s2": 1.0, "s3": 0.6},
        "s3": {"s1": 0.4, "s2": 0.6, "s3": 1.0},
    }
    avg = compute_avg_pairwise_correlation(matrix)
    assert abs(avg - 0.5) < 0.01


def test_rolling_correlation_basic():
    np.random.seed(42)
    dates = pd.date_range("2026-01-01", periods=120, freq="D")
    strategies = {
        "s1": pd.Series(np.random.normal(0.001, 0.02, 120), index=dates),
        "s2": pd.Series(np.random.normal(0.001, 0.02, 120), index=dates),
    }
    result = compute_rolling_correlation(strategies)
    assert "s1:s2" in result
    assert len(result["s1:s2"]) > 0


def test_rolling_correlation_too_few_strategies():
    dates = pd.date_range("2026-01-01", periods=60, freq="D")
    strategies = {"s1": pd.Series(np.random.normal(0, 0.02, 60), index=dates)}
    assert compute_rolling_correlation(strategies) == {}


def test_rolling_correlation_too_many_strategies():
    """n > MAX_STRATEGIES_FOR_ROLLING (20) returns empty dict."""
    dates = pd.date_range("2026-01-01", periods=60, freq="D")
    strategies = {
        f"s{i}": pd.Series(np.random.normal(0, 0.02, 60), index=dates)
        for i in range(25)
    }
    assert compute_rolling_correlation(strategies) == {}


def test_rolling_correlation_caps_top_pairs():
    """When n > MAX_ROLLING_PAIRS (10), result is capped to 10 pairs."""
    np.random.seed(42)
    dates = pd.date_range("2026-01-01", periods=120, freq="D")
    strategies = {
        f"s{i}": pd.Series(np.random.normal(0.001, 0.02, 120), index=dates)
        for i in range(12)
    }
    result = compute_rolling_correlation(strategies)
    assert len(result) <= 10


def test_risk_decomposition_zero_volatility():
    """All-zero weights produce zero portfolio vol; should return zero entries."""
    weights = [0.0, 0.0, 0.0]
    cov = np.array([[0.04, 0.01, 0.005], [0.01, 0.03, 0.002], [0.005, 0.002, 0.02]])
    result = compute_risk_decomposition(weights, cov)
    assert all(r["marginal_risk_pct"] == 0 for r in result)
    assert all(r["standalone_vol"] == 0 for r in result)
