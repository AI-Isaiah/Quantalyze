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


class TestBaselineWindowAlignment:
    """The incumbent baseline (sharpe / avg_corr / max_dd) must be resliced to
    each candidate's overlap window before being differenced against that
    candidate's blended metrics — the ADD-semantics sibling of
    bridge_scoring.find_replacement_candidates' M-0893 window-alignment fix.

    `_compute_sharpe` annualizes ×√252 regardless of sample length, so a baseline
    computed once over the FULL port_df window and compared against a candidate
    scored over its shorter `aligned` window mixes regimes/sample sizes and ranks
    short-history candidates spuriously. All existing tests use full-window
    candidates (aligned == port_df), so they never exercise the mismatch.
    """

    @staticmethod
    def _two_regime() -> np.ndarray:
        # 60 days of a strong, near-constant positive drift (high Sharpe) followed
        # by 60 days of a flat, mean-zero noisy regime (~0 Sharpe). The FULL-window
        # Sharpe (≈ strong) differs sharply from the last-60-window Sharpe (≈ 0),
        # which is exactly what a window-misaligned baseline conflates.
        strong = np.linspace(0.010, 0.014, 60)
        flat = np.random.RandomState(2024).normal(0.0, 0.01, 60)
        return np.concatenate([strong, flat])

    def test_self_clone_over_short_window_scores_zero_lift(self):
        """A candidate that is an exact clone of an existing holding, but only over
        that holding's most-recent (flat-regime) sub-window, diversifies NOTHING —
        adding 10% of a strategy you already hold over its own window must net ~0
        on every axis. With the window bug the baseline is the full-120-day
        (strong-regime) Sharpe while the candidate is scored on the flat last-60
        window → a large spurious negative sharpe_lift. Once the baseline is
        resliced to the aligned window, new_port == port_baseline exactly → 0 lift.

        Rule-9: reverting the per-candidate reslice (baseline over full port_df)
        makes sharpe_lift ≈ -12 (regime mismatch); this assertion then fails.
        """
        dates = pd.date_range("2025-01-01", periods=120, freq="D")
        s1 = pd.Series(self._two_regime(), index=dates)
        clone_last60 = pd.Series(s1.values[60:], index=dates[60:])
        results = find_improvement_candidates(
            {"s1": s1}, {"c1": clone_last60}, {"s1": 1.0}
        )
        assert len(results) == 1, "the self-clone candidate must still be scored"
        r = results[0]
        assert abs(r["sharpe_lift"]) < 1e-9, (
            f"a self-clone over its own window must add ~0 Sharpe once windows "
            f"align; got {r['sharpe_lift']} (window-misaligned baseline?)"
        )
        assert abs(r["dd_improvement"]) < 1e-9, (
            f"drawdown delta must be ~0 for a self-clone; got {r['dd_improvement']}"
        )
        assert abs(r["score"]) < 1e-9, (
            f"composite score must be ~0 for a self-clone; got {r['score']}"
        )

    def test_resliced_baseline_ignores_pre_window_history(self):
        """A candidate whose history overlaps ONLY the portfolio's recent window
        must be scored from that window alone — the resliced baseline must IGNORE
        returns that predate the candidate. Two 2-strategy portfolios that are
        byte-identical over the candidate's aligned window but differ arbitrarily
        in their pre-window history must therefore produce an IDENTICAL score.

        This pins ALL THREE resliced axes at once (sharpe / avg_corr / max_dd):
        with the full-window-baseline bug each portfolio's baseline absorbs its
        own pre-window regime → the scores diverge. The corr axis in particular
        has no other guard — a corr-only revert leaves every other test green but
        makes these two scores differ.

        Rule-9: reverting the reslice on ANY single axis (sharpe → sharpe_lift
        diverges; dd → dd_improvement diverges; avg_corr → the composite score
        diverges) breaks one of the equalities below.
        """
        full = pd.date_range("2025-01-01", periods=150, freq="D")
        win = full[90:]  # the 60-day window the candidate overlaps
        rng = np.random.RandomState(101)
        # Identical last-60 window for BOTH portfolios (shared values).
        s1_win = rng.normal(0.001, 0.02, 60)
        s2_win = rng.normal(0.0008, 0.018, 60)
        cand_win = rng.normal(0.0009, 0.02, 60)
        # Portfolio A pre-window: two INDEPENDENT strong series (low pairwise
        # corr, strong drift, shallow drawdown).
        a1_pre = rng.normal(0.004, 0.01, 90)
        a2_pre = rng.normal(0.004, 0.01, 90)
        # Portfolio B pre-window: two NEAR-IDENTICAL weak series with a deep
        # drawdown (high pairwise corr, ~0 drift, large drawdown) — a different
        # regime on every axis (sharpe, corr, dd).
        b_common = rng.normal(-0.001, 0.03, 90)
        b1_pre = b_common
        b2_pre = b_common + rng.normal(0.0, 0.001, 90)

        def _port(p1_pre, p2_pre):
            return {
                "s1": pd.Series(np.concatenate([p1_pre, s1_win]), index=full),
                "s2": pd.Series(np.concatenate([p2_pre, s2_win]), index=full),
            }

        cand = {"c1": pd.Series(cand_win, index=win)}
        weights = {"s1": 0.6, "s2": 0.4}
        res_a = find_improvement_candidates(
            _port(a1_pre, a2_pre), {k: v.copy() for k, v in cand.items()}, weights
        )
        res_b = find_improvement_candidates(
            _port(b1_pre, b2_pre), {k: v.copy() for k, v in cand.items()}, weights
        )
        assert len(res_a) == 1 and len(res_b) == 1
        assert res_a[0]["score"] == pytest.approx(res_b[0]["score"]), (
            "score must depend only on the candidate's aligned window; a differing "
            "pre-window regime leaked in → a baseline-window axis was not resliced "
            "(this is the corr-axis guard — corr_reduction flows only into score)"
        )
        assert res_a[0]["sharpe_lift"] == pytest.approx(res_b[0]["sharpe_lift"]), (
            "sharpe_lift must ignore pre-window history (sharpe-axis reslice guard)"
        )
        assert res_a[0]["dd_improvement"] == pytest.approx(res_b[0]["dd_improvement"]), (
            "dd_improvement must ignore pre-window history (dd-axis reslice guard)"
        )

    def test_multi_strategy_duplicate_dates_on_different_days_does_not_raise(self):
        """Red-team gap: `pd.DataFrame(portfolio_returns)` raises 'cannot reindex
        on an axis with duplicate labels' for a MULTI-strategy portfolio whose
        strategies carry duplicate dates on DIFFERENT days — which 500'd the whole
        optimizer request before the row-level dedupe could run. Deduping each
        series BEFORE the frame is built makes a dup-date multi-strategy portfolio
        score identically to its clean twin.

        Rule-9: moving the dedupe back to AFTER the constructor (or removing it)
        makes this case raise in the DataFrame constructor.
        """
        rng = np.random.RandomState(303)
        dates = pd.date_range("2025-02-01", periods=60, freq="D")
        s1v = rng.normal(0.001, 0.02, 60)
        s2v = rng.normal(0.0008, 0.018, 60)
        candv = rng.normal(0.0009, 0.02, 60)
        clean = {
            "s1": pd.Series(s1v, index=dates),
            "s2": pd.Series(s2v, index=dates),
        }
        # s1 duplicates date[10]; s2 duplicates a DIFFERENT date[20] — the case
        # that raises in the DataFrame constructor. Same value → last-write-wins
        # collapses back to the clean twin.
        dup = {
            "s1": pd.Series(
                np.concatenate([s1v, [s1v[10]]]),
                index=dates.append(pd.DatetimeIndex([dates[10]])),
            ),
            "s2": pd.Series(
                np.concatenate([s2v, [s2v[20]]]),
                index=dates.append(pd.DatetimeIndex([dates[20]])),
            ),
        }
        cand = {"c1": pd.Series(candv, index=dates)}
        weights = {"s1": 0.6, "s2": 0.4}
        clean_res = find_improvement_candidates(
            clean, {k: v.copy() for k, v in cand.items()}, weights
        )
        dup_res = find_improvement_candidates(
            dup, {k: v.copy() for k, v in cand.items()}, weights
        )
        assert len(clean_res) == 1 and len(dup_res) == 1
        assert dup_res[0]["score"] == pytest.approx(clean_res[0]["score"]), (
            "a multi-strategy portfolio with dup dates on different days must "
            "dedupe to its clean twin, not 500 in the DataFrame constructor"
        )

    def test_duplicate_timestamp_portfolio_is_deduped_not_amplified(self):
        """`_records_to_series` does NOT dedupe — a duplicate-date row is a
        documented JSONB shape. The per-candidate `pd.concat(..., axis=1)` aligns
        on the index, and a non-unique index either raises InvalidIndexError
        (pandas cannot reindex on duplicate labels → a dup-date portfolio 500s the
        optimizer) or silently MULTIPLIES rows on the join (amplifying the
        baseline window → corrupt scores), depending on the pandas version. Both
        are bugs; dedupe-at-entry (last-write-wins) makes a dup-date portfolio
        score identically to its already-clean twin.

        Rule-9: removing the `port_df`/`c_returns` dedupe makes the dup case
        raise or amplify, so the equality assertion fails.
        """
        rng = np.random.RandomState(7)
        base = rng.normal(0.001, 0.02, 60)
        dates = pd.date_range("2025-03-01", periods=60, freq="D")
        clean = pd.Series(base, index=dates)
        # Duplicate the final date with the SAME value → last-write-wins collapses
        # it back to the clean twin.
        dup = pd.Series(
            np.concatenate([base, [base[-1]]]),
            index=dates.append(pd.DatetimeIndex([dates[-1]])),
        )
        cand = pd.Series(rng.normal(0.0008, 0.018, 60), index=dates)
        clean_res = find_improvement_candidates(
            {"s1": clean}, {"c1": cand.copy()}, {"s1": 1.0}
        )
        dup_res = find_improvement_candidates(
            {"s1": dup}, {"c1": cand.copy()}, {"s1": 1.0}
        )
        assert len(clean_res) == 1 and len(dup_res) == 1
        assert dup_res[0]["score"] == pytest.approx(clean_res[0]["score"]), (
            "a duplicate-timestamp portfolio must dedupe to its clean twin, not "
            "amplify/raise through the per-candidate alignment join"
        )
