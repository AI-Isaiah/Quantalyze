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
    """All-zero weights produce zero portfolio vol → the marginal/component
    decomposition is genuinely undefined (you cannot attribute a share of a
    portfolio that carries no risk), so marginal_risk_pct and component_var
    must be 0 for every entry.

    NOTE: this test deliberately does NOT assert standalone_vol == 0.
    standalone_vol is sqrt(cov[i][i]) — a per-strategy property independent of
    the portfolio weights, so its financially correct values are nonzero even
    here (H-0803 fixed the zero-vol branch to return them). The per-strategy
    invariant is pinned by test_risk_decomposition_zero_weights_standalone_vol_
    is_per_strategy below; this test only pins the two values that are correctly
    zero, so it stays valid regardless of the standalone_vol value.
    """
    weights = [0.0, 0.0, 0.0]
    cov = np.array([[0.04, 0.01, 0.005], [0.01, 0.03, 0.002], [0.005, 0.002, 0.02]])
    result = compute_risk_decomposition(weights, cov)
    assert all(r["marginal_risk_pct"] == 0 for r in result)
    assert all(r["component_var"] == 0 for r in result)


def test_risk_decomposition_zero_weights_standalone_vol_is_per_strategy():
    """H-0803: standalone_vol = sqrt(cov[i][i]) is a per-strategy property
    and MUST be independent of the portfolio weights. With all-zero weights
    (portfolio vol == 0) the diagonal variances 0.04, 0.03, 0.02 still imply
    standalone vols of 0.2000, 0.1732, 0.1414 — they do not collapse to 0.

    Pre-H-0803 the zero-portfolio-vol branch returned standalone_vol=0; the fix
    returns sqrt(cov[i][i]). This test pins the per-strategy invariant and fails
    if a regression re-zeroes standalone_vol in that branch.
    """
    weights = [0.0, 0.0, 0.0]
    cov = np.array([[0.04, 0.01, 0.005], [0.01, 0.03, 0.002], [0.005, 0.002, 0.02]])
    result = compute_risk_decomposition(weights, cov)
    expected_standalone = [float(np.sqrt(cov[i][i])) for i in range(len(weights))]
    assert [r["standalone_vol"] for r in result] == pytest.approx(expected_standalone)
    # The decomposition itself remains undefined at zero portfolio vol.
    assert all(r["marginal_risk_pct"] == 0 for r in result)
    assert all(r["component_var"] == 0 for r in result)


def test_risk_decomposition_negative_variance_collapses_to_zeros():
    """M-0706: `port_var = w @ cov @ w; port_vol = sqrt(port_var) if
    port_var > 0 else 0`. A non-PSD covariance matrix (numerical
    instability / a near-singular cov produced by float arithmetic) can
    yield port_var < 0. The `if port_var > 0 else 0` guard must collapse
    port_vol to 0 so the marginal/component ATTRIBUTION is zero (undefined at
    zero portfolio vol) rather than taking sqrt of a negative port_var (→ NaN).
    standalone_vol = sqrt(cov[i][i]) is per-strategy and stays nonzero (H-0803).
    Tests only ever fed positive-definite cov + the all-zero-weight case before;
    the negative-variance branch was unexercised.
    """
    # Non-PSD matrix: eigenvalues 3 and -1. With w=[0.5, -0.5],
    # w @ cov @ w = -0.5 < 0.
    cov_non_psd = np.array([[1.0, 2.0], [2.0, 1.0]])
    weights = [0.5, -0.5]
    assert (np.array(weights) @ cov_non_psd @ np.array(weights)) < 0
    result = compute_risk_decomposition(weights, cov_non_psd)
    # Negative port_var → port_vol == 0 → the zero-vol branch zeroes the
    # ATTRIBUTION (marginal/component) with no NaN from sqrt of a negative...
    assert len(result) == 2
    assert all(r["marginal_risk_pct"] == 0 for r in result)
    assert all(r["component_var"] == 0 for r in result)
    # ...but standalone_vol = sqrt(cov[i][i]) is a per-strategy property,
    # independent of weights/port_vol — here sqrt(1.0) = 1.0, NOT 0 (H-0803).
    expected_standalone = [float(np.sqrt(cov_non_psd[i][i])) for i in range(len(weights))]
    assert [r["standalone_vol"] for r in result] == pytest.approx(expected_standalone)


def test_attribution_empty_weights_returns_empty_list():
    """M-0705: compute_attribution with n=0 (empty weights/twrs) → the
    `equal_weight = 1.0/n if n > 0 else 0` guard avoids divide-by-zero and
    the empty range yields []. Only the 3-weight happy path was tested
    before; the n=0 boundary was unexercised.
    """
    assert compute_attribution([], [], 0.0) == []


def test_attribution_all_equal_weights_zero_allocation_effect():
    """M-0705 (c): when every weight equals the equal-weight baseline
    (1/n), the `(weights[i] - equal_weight)` factor is 0 for every
    strategy → allocation_effect == 0 across the board, regardless of the
    twr spread. Pins that allocation_effect measures DEVIATION from equal
    weight, not absolute return.
    """
    n = 4
    weights = [1.0 / n] * n  # exactly equal-weight
    twrs = [0.10, -0.05, 0.20, 0.02]
    portfolio_twr = sum(w * t for w, t in zip(weights, twrs))
    result = compute_attribution(weights, twrs, portfolio_twr)
    assert len(result) == n
    assert all(r["allocation_effect"] == pytest.approx(0.0) for r in result), (
        "equal weights → zero allocation effect for every strategy"
    )
