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


class TestBaselineWindowAlignment:
    """M-0893: the incumbent-portfolio baseline (sharpe/corr/dd) must be
    recomputed over EACH candidate's overlap window, not once over the full
    portfolio window. Otherwise a candidate with a short, favourable history is
    scored against a full-history baseline that endured regimes the candidate
    never faced — an apples-to-oranges delta that ranks short bull-run
    candidates spuriously high. The existing fixtures all use equal-length
    (same-window) series, so they cannot reach this code path.
    """

    def test_baseline_is_resliced_to_short_candidate_window(self):
        # Portfolio (incumbent `inc` + remaining `r1`) spans 120 business days
        # with two regimes: a STRONG uptrend for the first 60 days and a FLAT
        # stretch for the last 60. The candidate `cand` has history ONLY over
        # the last 60 days, and its returns EXACTLY clone the incumbent's last
        # 60 days. Over that aligned window, swapping inc -> cand is a no-op, so
        # an honest (window-aligned) comparison must report ~0 on every delta.
        #
        # Rule 9: the pre-fix code computed the baseline over the full 120-day
        # window (strong+flat) while new_* spans the flat last-60 — yielding a
        # large spurious NEGATIVE sharpe_delta. This test fails on that code and
        # passes only once the baseline is resliced to the candidate window.
        dates = pd.date_range("2025-01-01", periods=120, freq="B")

        def _two_regime(seed: int) -> pd.Series:
            rng = np.random.default_rng(seed)
            strong = rng.normal(0.004, 0.010, 60)  # first 60d: clear uptrend
            flat = rng.normal(0.000, 0.010, 60)    # last 60d: drift-free
            return pd.Series(np.concatenate([strong, flat]), index=dates)

        inc = _two_regime(1)
        r1 = _two_regime(2)
        # Candidate = the incumbent's LAST 60 days, on those same last-60 dates.
        cand = pd.Series(inc.to_numpy()[60:], index=dates[60:])

        results = find_replacement_candidates(
            portfolio_returns={"inc": inc, "r1": r1},
            candidate_returns={"cand": cand},
            weights={"inc": 0.5, "r1": 0.5},
            incumbent_strategy_id="inc",
        )

        assert len(results) == 1
        res = results[0]
        # Same returns on both sides of every delta over the aligned window.
        assert abs(res["sharpe_delta"]) < 1e-9
        assert abs(res["corr_delta"]) < 1e-9
        assert abs(res["dd_delta"]) < 1e-9

    def test_equal_length_candidate_unaffected(self):
        # Regression guard: when the candidate already spans the full portfolio
        # window, port_df_aligned == port_df, so the aligned baseline is the
        # full-window baseline and scoring is unchanged from before the fix.
        portfolio = {
            "s1": _make_returns(1, mu=0.001),
            "s2": _make_returns(2, mu=-0.001),
        }
        candidates = {"c1": _make_returns(10, n=60, mu=0.003)}
        results = find_replacement_candidates(
            portfolio, candidates, {"s1": 0.5, "s2": 0.5}, incumbent_strategy_id="s2"
        )
        assert len(results) == 1
        # A genuinely-better full-window candidate still produces a finite,
        # ranked composite (no NaN/None leakage from the reslice).
        assert results[0]["composite_score"] == results[0]["composite_score"]  # not NaN

    def test_partial_overlap_below_min_is_skipped(self):
        # Guards the index-subset precondition the reslice rests on: a candidate
        # that spans many dates but overlaps the PORTFOLIO on fewer than 30 of
        # them must be skipped by the len(all_returns) < 30 gate BEFORE the
        # reslice runs (so port_df.loc[all_returns.index] is never reached with a
        # short/partial window). Distinct from the globally-short candidate skip.
        dates = pd.date_range("2025-01-01", periods=60, freq="B")
        inc = pd.Series(np.full(60, 0.001), index=dates)
        r1 = pd.Series(np.full(60, 0.002), index=dates)
        # Candidate starts near the portfolio's end → only ~20 overlapping dates,
        # then continues past the portfolio window (dates the portfolio lacks).
        cand_dates = pd.date_range(dates[40], periods=60, freq="B")
        cand = pd.Series(np.linspace(0.001, 0.005, 60), index=cand_dates)
        results = find_replacement_candidates(
            portfolio_returns={"inc": inc, "r1": r1},
            candidate_returns={"cand": cand},
            weights={"inc": 0.5, "r1": 0.5},
            incumbent_strategy_id="inc",
        )
        assert results == []

    def test_duplicate_timestamp_portfolio_is_deduped_not_amplified(self):
        # A returns_series carrying a repeated date (routers/portfolio.py
        # documents that _records_to_series does NOT dedupe its JSONB input)
        # must NOT cartesian-amplify the per-candidate baseline reslice. The
        # function dedupes port_df last-write-wins, so a duplicate-timestamp
        # portfolio scores IDENTICALLY to the same portfolio with the duplicate
        # row already collapsed.
        base = pd.date_range("2025-01-01", periods=60, freq="B")
        inc_vals = np.linspace(0.001, 0.004, 60)
        r1_vals = np.linspace(0.002, 0.001, 60)
        cand = _make_returns(10, n=60, mu=0.003)

        def _score(inc: pd.Series, r1: pd.Series):
            return find_replacement_candidates(
                portfolio_returns={"inc": inc, "r1": r1},
                candidate_returns={"cand": pd.Series(cand.to_numpy(), index=r1.index[: len(cand)])},
                weights={"inc": 0.5, "r1": 0.5},
                incumbent_strategy_id="inc",
            )

        clean = _score(pd.Series(inc_vals, index=base), pd.Series(r1_vals, index=base))
        # Inject a duplicate of the LAST date (last-write-wins keeps the same value).
        dup_idx = base.append(pd.DatetimeIndex([base[-1]]))
        inc_dup = pd.Series(np.append(inc_vals, inc_vals[-1]), index=dup_idx)
        r1_dup = pd.Series(np.append(r1_vals, r1_vals[-1]), index=dup_idx)
        dirty = _score(inc_dup, r1_dup)

        assert len(clean) == len(dirty) == 1
        # Identical scoring: the duplicate row was collapsed, not double-counted
        # into an amplified baseline window.
        assert dirty[0]["composite_score"] == pytest.approx(clean[0]["composite_score"])
        assert dirty[0]["sharpe_delta"] == pytest.approx(clean[0]["sharpe_delta"])
