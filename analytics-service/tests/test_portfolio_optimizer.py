import logging

import pytest
import numpy as np
import pandas as pd
from services.portfolio_optimizer import find_improvement_candidates, generate_narrative

_OPTIMIZER_LOGGER = "quantalyze.analytics.portfolio_optimizer"

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


def test_uncomputable_candidate_is_excluded_not_zero_scored():
    """M-0701: a candidate whose blended PORTFOLIO is genuinely unscoreable
    (zero variance -> _compute_sharpe None) must be DROPPED, not collapsed to a
    score of 0 (indistinguishable from a real no-improvement candidate, which
    would silently pollute the ranked top-5).

    A constant base blended with a constant candidate yields a constant
    portfolio (zero variance) -> new_sharpe None -> the candidate is excluded.
    Pre-fix that None fell through `... else 0`, so the candidate was appended
    with a fabricated 0 score.
    """
    dates = pd.date_range("2026-01-01", periods=60, freq="D")
    portfolio = {"s1": pd.Series([0.001] * 60, index=dates)}     # flat base
    candidates = {"c1": pd.Series([0.002] * 60, index=dates)}    # flat -> flat blend
    results = find_improvement_candidates(portfolio, candidates, {"s1": 1.0})
    assert results == [], (
        "a candidate whose blended portfolio has zero variance is unscoreable "
        "and must be excluded, not scored 0"
    )


def test_single_strategy_base_still_ranks_candidates():
    """M-0701 (regression guard): a single-strategy base portfolio has no
    pairwise correlation, so current_avg_corr is legitimately None. The
    exclusion gate must NOT treat that structural None as a per-candidate
    failure — valid candidates must still be ranked (the optimizer's core
    single-strategy use case)."""
    np.random.seed(42)
    dates = pd.date_range("2026-01-01", periods=250, freq="D")
    base = np.random.normal(0.001, 0.02, 250)
    portfolio = {"s1": pd.Series(base, index=dates)}
    candidates = {
        "c1": pd.Series(-base + np.random.normal(0.001, 0.01, 250), index=dates)
    }
    results = find_improvement_candidates(portfolio, candidates, {"s1": 1.0})
    assert len(results) == 1, (
        "a structurally-absent correlation baseline (1-strategy base) must not "
        "exclude valid candidates"
    )


def test_flat_existing_strategy_does_not_drop_all_candidates():
    """M-0701 (red-team regression): _avg_corr is computed over the WHOLE
    blended frame, so a single flat EXISTING strategy (e.g. a paused strategy
    stored as daily 0.0) makes new_avg_corr None for EVERY candidate. The
    drop-gate must NOT key on new_avg_corr — otherwise one paused strategy
    silently nukes ALL optimizer suggestions. Valid diversifying candidates
    must still be ranked.

    Fails against the intermediate (buggy) gate that included new_avg_corr:
    every candidate dropped -> []. Passes once the gate keys only on the
    blended-portfolio metrics (new_sharpe / new_max_dd).
    """
    np.random.seed(99)
    dates = pd.date_range("2026-01-01", periods=180, freq="D")
    portfolio = {
        "active": pd.Series(np.random.normal(0.0008, 0.015, 180), index=dates),
        "paused": pd.Series([0.0] * 180, index=dates),  # flat -> poisons _avg_corr
    }
    weights = {"active": 0.7, "paused": 0.3}
    candidates = {
        f"c{i}": pd.Series(np.random.normal(0.001, 0.012, 180), index=dates)
        for i in range(3)
    }
    results = find_improvement_candidates(portfolio, candidates, weights)
    assert len(results) >= 1, (
        "a flat existing strategy must NOT drop all candidates — the gate must "
        "key on the blended portfolio (new_sharpe/new_max_dd), not the "
        "frame-wide avg_corr"
    )


def test_narrative_negative_month_says_decline_not_gain():
    """M-0903: a losing month must not be described as a 'gain'. top_share is a
    SIZE share (abs contribution), so the per-month noun must follow the sign of
    that month's return — 'decline' when negative, 'gain' when non-negative."""
    analytics = {
        "return_mtd": -0.03,
        "attribution_breakdown": [
            {"strategy_name": "Alpha", "contribution": -0.02},
            {"strategy_name": "Beta", "contribution": 0.005},
        ],
        "monthly_returns": {"2026": {"04": -0.03}},
    }
    narrative = generate_narrative(analytics)
    assert "of the decline" in narrative, (
        "a negative month must read 'of the decline', not 'of the gain'"
    )
    assert "of the gain" not in narrative


def test_narrative_positive_month_still_says_gain():
    """M-0903: a winning month keeps the 'gain' noun (guards against a
    sign-flipped fix that always says 'decline')."""
    analytics = {
        "return_mtd": 0.03,
        "attribution_breakdown": [
            {"strategy_name": "Alpha", "contribution": 0.02},
            {"strategy_name": "Beta", "contribution": 0.005},
        ],
        "monthly_returns": {"2026": {"04": 0.03}},
    }
    narrative = generate_narrative(analytics)
    assert "of the gain" in narrative
    assert "of the decline" not in narrative


def test_narrative_logs_when_recommendation_suppressed(caplog):
    """M-0904: when optimizer suggestions warrant a recommendation (positive
    sharpe_lift + named underperformer + non-empty risk decomposition) but
    portfolio_sharpe is missing, the actionable sentence is dropped — log a
    WARNING so the omission is visible rather than vanishing with no signal."""
    analytics = {
        "attribution_breakdown": [
            {"strategy_name": "Alpha", "contribution": 0.05},
            {"strategy_name": "Laggard", "contribution": -0.01},
        ],
        "optimizer_suggestions": [{"strategy_name": "NewCo", "sharpe_lift": 0.3}],
        "risk_decomposition": [
            {"strategy_name": "Alpha", "marginal_risk_pct": 50, "weight_pct": 40},
        ],
        # portfolio_sharpe deliberately absent -> recommendation suppressed.
    }
    with caplog.at_level(logging.WARNING, logger=_OPTIMIZER_LOGGER):
        narrative = generate_narrative(analytics)
    assert "expected Sharpe moves" not in narrative
    assert any("recommendation suppressed" in r.message for r in caplog.records), (
        "a suppressed recommendation must emit a WARNING naming the missing field"
    )
    assert any("portfolio_sharpe" in r.message for r in caplog.records)


def test_narrative_logs_when_recommendation_suppressed_missing_risk_decomp(caplog):
    """M-0904: the other suppression arm — portfolio_sharpe IS present but the
    risk_decomposition is empty. The recommendation is still dropped and the
    warning must name risk_decomposition (not portfolio_sharpe)."""
    analytics = {
        "attribution_breakdown": [
            {"strategy_name": "Alpha", "contribution": 0.05},
            {"strategy_name": "Laggard", "contribution": -0.01},
        ],
        "optimizer_suggestions": [{"strategy_name": "NewCo", "sharpe_lift": 0.3}],
        "portfolio_sharpe": 1.2,
        # risk_decomposition deliberately absent -> recommendation suppressed.
    }
    with caplog.at_level(logging.WARNING, logger=_OPTIMIZER_LOGGER):
        narrative = generate_narrative(analytics)
    assert "expected Sharpe moves" not in narrative
    assert any(
        "recommendation suppressed" in r.message and "risk_decomposition" in r.message
        for r in caplog.records
    ), "the missing-risk-decomposition arm must warn and name risk_decomposition"
