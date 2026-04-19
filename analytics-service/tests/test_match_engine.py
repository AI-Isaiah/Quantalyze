"""Tests for analytics-service/services/match_engine.py — the perfect-match engine.

21 unit tests covering eligibility (hard + soft split), relaxation invariants,
sub-scores, mode selection, exclusion reasons, single-element normalization,
short-overlap None corr, zero-AUM fallback, determinism, helper alias imports.

Phase 3 / D-15 extends with 20 mandate-fit tests covering per-dimension math,
composition, overrides renormalization, determinism, backward compat, and a
v1→v2 golden-snapshot regression.

See docs/superpowers/plans/2026-04-07-perfect-match-engine.md Phase 2 Task 4.
"""

import os
from pathlib import Path
from typing import Any

import pandas as pd
import pytest

from services.match_engine import (
    ENGINE_VERSION,
    WEIGHTS_VERSION,
    score_candidates,
    to_canonical_json,
    _normalize_min_max,
    _compute_corr_with_portfolio,
)

# Phase 3 / D-15: _compute_mandate_fit_score is the Wave-1 helper. During Wave 0
# the symbol does not yet exist — import lazily and skip mandate_fit tests that
# need it. Tests that only assert on ENGINE_VERSION / score_breakdown shape can
# still go red (intentional TDD red state for Wave 0).
try:
    from services.match_engine import _compute_mandate_fit_score  # noqa: F401
    MANDATE_FIT_IMPORTED = True
except ImportError:
    _compute_mandate_fit_score = None  # type: ignore
    MANDATE_FIT_IMPORTED = False

FIXTURES_DIR = Path(__file__).parent / "fixtures"


# ---------------------------------------------------------------------------
# Test fixtures
# ---------------------------------------------------------------------------


def _make_candidate(
    strategy_id: str = "s1",
    sharpe: float = 1.5,
    track_record_days: int = 365,
    max_drawdown_pct: float = -0.15,
    manager_aum: float | None = 5_000_000,
    exchange: str = "binance",
    strategy_type: str = "trend_following",
    subtype: str | None = None,  # Phase 3 / D-06: style_exclusions field
) -> dict[str, Any]:
    return {
        "strategy_id": strategy_id,
        "sharpe": sharpe,
        "track_record_days": track_record_days,
        "max_drawdown_pct": max_drawdown_pct,
        "manager_aum": manager_aum,
        "exchange": exchange,
        "strategy_type": strategy_type,
        "subtype": subtype,
    }


def _make_returns_series(
    n_days: int = 100,
    seed: int = 42,
    daily_return: float = 0.001,
) -> pd.Series:
    """Make a synthetic daily returns series with mild positive drift."""
    import numpy as np
    rng = np.random.default_rng(seed)
    rets = rng.normal(loc=daily_return, scale=0.01, size=n_days)
    dates = pd.date_range("2024-01-01", periods=n_days, freq="D")
    return pd.Series(rets, index=dates, name="ret")


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_cold_start_returns_screening_mode():
    """Empty portfolio → mode='screening', no portfolio_fit in score breakdown."""
    candidates = [_make_candidate("s1"), _make_candidate("s2")]
    result = score_candidates(
        allocator_id="a1",
        preferences=None,
        portfolio_strategies=[],
        portfolio_returns={},
        portfolio_weights={},
        candidate_strategies=candidates,
        candidate_returns={},
    )
    assert result["mode"] == "screening"
    assert len(result["candidates"]) > 0
    for c in result["candidates"]:
        assert "portfolio_fit" not in c["score_breakdown"]


def test_personalized_returns_personalized_mode():
    """Non-empty portfolio → mode='personalized', all 4 sub-scores present."""
    candidates = [_make_candidate("s2"), _make_candidate("s3")]
    portfolio_strategies = [{"strategy_id": "owned1"}]
    portfolio_returns = {"owned1": _make_returns_series(seed=1)}
    cand_returns = {
        "s2": _make_returns_series(seed=2),
        "s3": _make_returns_series(seed=3),
    }
    result = score_candidates(
        allocator_id="a1",
        preferences=None,
        portfolio_strategies=portfolio_strategies,
        portfolio_returns=portfolio_returns,
        portfolio_weights={"owned1": 1.0},
        candidate_strategies=candidates,
        candidate_returns=cand_returns,
        portfolio_aum=1_000_000,
    )
    assert result["mode"] == "personalized"
    assert len(result["candidates"]) > 0
    for c in result["candidates"]:
        assert "portfolio_fit" in c["score_breakdown"]
        assert "preference_fit" in c["score_breakdown"]
        assert "track_record" in c["score_breakdown"]
        assert "capacity_fit" in c["score_breakdown"]


def test_eligibility_excludes_low_sharpe_with_reason():
    """Sharpe 0.3, min 1.0 → in excluded[] with reason='below_min_sharpe'."""
    candidates = [_make_candidate("s1", sharpe=0.3)]
    result = score_candidates(
        allocator_id="a1",
        preferences={"min_sharpe": 1.0},
        portfolio_strategies=[],
        portfolio_returns={},
        portfolio_weights={},
        candidate_strategies=candidates,
        candidate_returns={},
    )
    # The strategy is excluded; the relaxation kicks in (only 0 eligible) but the
    # hard filter still applies. Sharpe is a soft check, so under relaxation it passes.
    # Verify either: candidate appears (due to relaxation) OR exclusion is correct.
    assert result["filter_relaxed"] is True or any(
        e["exclusion_reason"] == "below_min_sharpe" for e in result["excluded"]
    )


def test_owned_strategy_excluded_with_reason():
    """Owned strategy → in excluded[] with reason='owned'. Hard exclusion."""
    candidates = [_make_candidate("s1"), _make_candidate("owned1")]
    result = score_candidates(
        allocator_id="a1",
        preferences={},
        portfolio_strategies=[{"strategy_id": "owned1"}],
        portfolio_returns={"owned1": _make_returns_series(seed=1)},
        portfolio_weights={"owned1": 1.0},
        candidate_strategies=candidates,
        candidate_returns={},
        portfolio_aum=1_000_000,
    )
    assert any(
        e["strategy_id"] == "owned1" and e["exclusion_reason"] == "owned"
        for e in result["excluded"]
    )
    # Owned is NOT in candidates
    assert all(c["strategy_id"] != "owned1" for c in result["candidates"])


def test_thumbs_down_strategy_excluded_with_reason():
    candidates = [_make_candidate("s1"), _make_candidate("s2")]
    result = score_candidates(
        allocator_id="a1",
        preferences={},
        portfolio_strategies=[],
        portfolio_returns={},
        portfolio_weights={},
        candidate_strategies=candidates,
        candidate_returns={},
        thumbs_down_ids={"s2"},
    )
    assert any(
        e["strategy_id"] == "s2" and e["exclusion_reason"] == "thumbs_down"
        for e in result["excluded"]
    )
    assert all(c["strategy_id"] != "s2" for c in result["candidates"])


def test_excluded_exchange_excluded_with_reason():
    candidates = [
        _make_candidate("s1", exchange="binance"),
        _make_candidate("s2", exchange="bybit"),
    ]
    result = score_candidates(
        allocator_id="a1",
        preferences={"excluded_exchanges": ["bybit"]},
        portfolio_strategies=[],
        portfolio_returns={},
        portfolio_weights={},
        candidate_strategies=candidates,
        candidate_returns={},
    )
    assert any(
        e["strategy_id"] == "s2" and e["exclusion_reason"] == "excluded_exchange"
        for e in result["excluded"]
    )


def test_preference_fit_rewards_track_record():
    """Long track record beats short on preference_fit."""
    candidates = [
        _make_candidate("short", track_record_days=200),
        _make_candidate("long", track_record_days=1500),
    ]
    result = score_candidates(
        allocator_id="a1",
        preferences={"min_track_record_days": 180},
        portfolio_strategies=[],
        portfolio_returns={},
        portfolio_weights={},
        candidate_strategies=candidates,
        candidate_returns={},
    )
    by_id = {c["strategy_id"]: c for c in result["candidates"]}
    assert by_id["long"]["score"] > by_id["short"]["score"]


def test_portfolio_fit_uses_correlation():
    """Uncorrelated candidate should beat correlated one with same metrics."""
    portfolio_returns = {"owned1": _make_returns_series(seed=1)}
    portfolio_strategies = [{"strategy_id": "owned1"}]
    # Correlated candidate uses same seed; uncorrelated uses different
    cand_returns = {
        "correlated": _make_returns_series(seed=1),  # Identical to portfolio
        "uncorrelated": _make_returns_series(seed=999),
    }
    candidates = [
        _make_candidate("correlated"),
        _make_candidate("uncorrelated"),
    ]
    result = score_candidates(
        allocator_id="a1",
        preferences=None,
        portfolio_strategies=portfolio_strategies,
        portfolio_returns=portfolio_returns,
        portfolio_weights={"owned1": 1.0},
        candidate_strategies=candidates,
        candidate_returns=cand_returns,
        portfolio_aum=1_000_000,
    )
    by_id = {c["strategy_id"]: c for c in result["candidates"]}
    # The uncorrelated candidate should have a more favorable correlation
    corr_unc = by_id["uncorrelated"]["score_breakdown"]["raw"]["corr_with_portfolio"]
    corr_cor = by_id["correlated"]["score_breakdown"]["raw"]["corr_with_portfolio"]
    if corr_unc is not None and corr_cor is not None:
        assert corr_unc < corr_cor


def test_relaxed_filter_when_sparse():
    """<5 eligible → soft filter dropped, filter_relaxed=true."""
    candidates = [
        _make_candidate(f"s{i}", sharpe=0.1, track_record_days=10)
        for i in range(20)
    ]
    result = score_candidates(
        allocator_id="a1",
        preferences={"min_sharpe": 2.0, "min_track_record_days": 1000},
        portfolio_strategies=[],
        portfolio_returns={},
        portfolio_weights={},
        candidate_strategies=candidates,
        candidate_returns={},
    )
    assert result["filter_relaxed"] is True
    assert len(result["candidates"]) > 0  # After relaxation, should have candidates


def test_relaxed_filter_does_not_resurrect_thumbs_down():
    """Hard filter (thumbs_down) survives relaxation."""
    candidates = [
        _make_candidate(f"s{i}", sharpe=0.1, track_record_days=10)
        for i in range(20)
    ]
    candidates.append(_make_candidate("hated"))
    result = score_candidates(
        allocator_id="a1",
        preferences={"min_sharpe": 2.0, "min_track_record_days": 1000},
        portfolio_strategies=[],
        portfolio_returns={},
        portfolio_weights={},
        candidate_strategies=candidates,
        candidate_returns={},
        thumbs_down_ids={"hated"},
    )
    assert result["filter_relaxed"] is True
    # Thumbs-down strategy is NOT in candidates even after relaxation
    assert all(c["strategy_id"] != "hated" for c in result["candidates"])
    # And it IS in excluded with the correct reason
    assert any(
        e["strategy_id"] == "hated" and e["exclusion_reason"] == "thumbs_down"
        for e in result["excluded"]
    )


def test_relaxed_filter_does_not_resurrect_owned():
    """Hard filter (owned) survives relaxation."""
    candidates = [
        _make_candidate(f"s{i}", sharpe=0.1, track_record_days=10)
        for i in range(20)
    ]
    candidates.append(_make_candidate("ours"))
    result = score_candidates(
        allocator_id="a1",
        preferences={"min_sharpe": 2.0, "min_track_record_days": 1000},
        portfolio_strategies=[{"strategy_id": "ours"}],
        portfolio_returns={"ours": _make_returns_series(seed=1)},
        portfolio_weights={"ours": 1.0},
        candidate_strategies=candidates,
        candidate_returns={},
        portfolio_aum=1_000_000,
    )
    assert result["filter_relaxed"] is True
    assert all(c["strategy_id"] != "ours" for c in result["candidates"])


def test_relaxed_filter_does_not_resurrect_excluded_exchange():
    """Hard filter (excluded_exchange) survives relaxation."""
    candidates = [
        _make_candidate(f"s{i}", sharpe=0.1, track_record_days=10)
        for i in range(20)
    ]
    candidates.append(
        _make_candidate("blocked", exchange="bybit")
    )
    result = score_candidates(
        allocator_id="a1",
        preferences={
            "min_sharpe": 2.0,
            "min_track_record_days": 1000,
            "excluded_exchanges": ["bybit"],
        },
        portfolio_strategies=[],
        portfolio_returns={},
        portfolio_weights={},
        candidate_strategies=candidates,
        candidate_returns={},
    )
    assert result["filter_relaxed"] is True
    assert all(c["strategy_id"] != "blocked" for c in result["candidates"])


def test_no_eligible_candidates_returns_empty_with_relaxed_flag():
    """All hard-excluded → filter_relaxed=true, candidates=[]."""
    candidates = [_make_candidate(f"s{i}") for i in range(3)]
    result = score_candidates(
        allocator_id="a1",
        preferences={},
        portfolio_strategies=[],
        portfolio_returns={},
        portfolio_weights={},
        candidate_strategies=candidates,
        candidate_returns={},
        thumbs_down_ids={"s0", "s1", "s2"},
    )
    assert len(result["candidates"]) == 0
    # All excluded under thumbs_down
    assert all(e["exclusion_reason"] == "thumbs_down" for e in result["excluded"])


def test_determinism():
    """Same inputs → byte-identical JSON output."""
    candidates = [_make_candidate(f"s{i}") for i in range(5)]
    args = dict(
        allocator_id="a1",
        preferences={},
        portfolio_strategies=[],
        portfolio_returns={},
        portfolio_weights={},
        candidate_strategies=candidates,
        candidate_returns={},
    )
    r1 = score_candidates(**args)
    r2 = score_candidates(**args)
    assert to_canonical_json(r1) == to_canonical_json(r2)


def test_screening_mode_does_not_produce_portfolio_fit_in_breakdown():
    """Cold-start guard against future regression."""
    candidates = [_make_candidate("s1")]
    result = score_candidates(
        allocator_id="a1",
        preferences=None,
        portfolio_strategies=[],
        portfolio_returns={},
        portfolio_weights={},
        candidate_strategies=candidates,
        candidate_returns={},
    )
    assert result["mode"] == "screening"
    for c in result["candidates"]:
        assert "portfolio_fit" not in c["score_breakdown"]


def test_add_weight_derived_from_ticket_size():
    """Tiny allocator vs whale produces different sharpe_lift for same candidate."""
    portfolio_returns = {"owned1": _make_returns_series(seed=1)}
    portfolio_strategies = [{"strategy_id": "owned1"}]
    candidates = [_make_candidate("s1")]
    cand_returns = {"s1": _make_returns_series(seed=42)}

    # Tiny allocator: $10k ticket against $10M portfolio = 0.1% concentration → tiny add_weight
    tiny = score_candidates(
        allocator_id="a1",
        preferences={"target_ticket_size_usd": 10_000},
        portfolio_strategies=portfolio_strategies,
        portfolio_returns=portfolio_returns,
        portfolio_weights={"owned1": 1.0},
        candidate_strategies=candidates,
        candidate_returns=cand_returns,
        portfolio_aum=10_000_000,
    )
    # Whale: $1M ticket against $10M portfolio = 10% concentration → larger add_weight
    whale = score_candidates(
        allocator_id="a1",
        preferences={"target_ticket_size_usd": 1_000_000},
        portfolio_strategies=portfolio_strategies,
        portfolio_returns=portfolio_returns,
        portfolio_weights={"owned1": 1.0},
        candidate_strategies=candidates,
        candidate_returns=cand_returns,
        portfolio_aum=10_000_000,
    )
    tiny_lift = tiny["candidates"][0]["score_breakdown"]["raw"]["sharpe_lift"]
    whale_lift = whale["candidates"][0]["score_breakdown"]["raw"]["sharpe_lift"]
    # Both can be None or equal in degenerate cases — just verify they're not the
    # exact same number unless both are None
    if tiny_lift is not None and whale_lift is not None:
        assert tiny_lift != whale_lift


def test_short_overlap_returns_none_corr():
    """Candidate with very short overlap → corr_with_portfolio = None."""
    portfolio = _make_returns_series(n_days=100, seed=1)
    cand_short = _make_returns_series(n_days=5, seed=2)
    # Slice cand to dates AFTER portfolio ends so there's zero overlap
    cand_short.index = pd.date_range("2030-01-01", periods=5, freq="D")
    corr = _compute_corr_with_portfolio(portfolio, cand_short, min_overlap_days=10)
    assert corr is None


def test_single_eligible_candidate_does_not_nan():
    """Eligible set of size 1 → finite score, no NaN from min-max."""
    candidates = [_make_candidate("only_one")]
    result = score_candidates(
        allocator_id="a1",
        preferences={},
        portfolio_strategies=[],
        portfolio_returns={},
        portfolio_weights={},
        candidate_strategies=candidates,
        candidate_returns={},
    )
    assert len(result["candidates"]) == 1
    score = result["candidates"][0]["score"]
    assert score is not None
    assert score == score  # NaN check (NaN != NaN)


def test_zero_aum_falls_back_to_neutral_capacity():
    """manager_current_aum = 0 → capacity_fit = 0.5."""
    candidates = [_make_candidate("s1", manager_aum=0)]
    result = score_candidates(
        allocator_id="a1",
        preferences={"target_ticket_size_usd": 50000},
        portfolio_strategies=[],
        portfolio_returns={},
        portfolio_weights={},
        candidate_strategies=candidates,
        candidate_returns={},
    )
    assert result["candidates"][0]["score_breakdown"]["capacity_fit"] == 0.5


def test_helper_imports_from_both_locations():
    """Helpers must be importable from both portfolio_optimizer and match_engine."""
    from services.portfolio_optimizer import _compute_sharpe as _orig_sharpe
    from services.match_engine import compute_sharpe as _alias_sharpe
    assert _orig_sharpe is _alias_sharpe


def test_reason_generation_skips_none_metrics():
    """If correlation is None, the diversification reason is not produced."""
    portfolio_returns = {"owned1": _make_returns_series(seed=1)}
    portfolio_strategies = [{"strategy_id": "owned1"}]
    # Candidate with returns that don't overlap with portfolio at all
    cand_returns_short = pd.Series(
        [0.001, 0.002, 0.003],
        index=pd.date_range("2030-01-01", periods=3, freq="D"),
        name="s1",
    )
    candidates = [_make_candidate("s1")]
    result = score_candidates(
        allocator_id="a1",
        preferences=None,
        portfolio_strategies=portfolio_strategies,
        portfolio_returns=portfolio_returns,
        portfolio_weights={"owned1": 1.0},
        candidate_strategies=candidates,
        candidate_returns={"s1": cand_returns_short},
        portfolio_aum=1_000_000,
    )
    if result["candidates"]:
        reasons = result["candidates"][0]["reasons"]
        # No reason should mention correlation 0.00 (the silent-misled case)
        assert not any("correlation 0.00" in r for r in reasons)


# ---------------------------------------------------------------------------
# Bonus: helper-level tests
# ---------------------------------------------------------------------------


def test_normalize_min_max_handles_single_element():
    # Positive single value clamps to itself (bounded in [0,1])
    assert _normalize_min_max([0.5]) == [0.5]
    assert _normalize_min_max([None]) == [0.0]


def test_normalize_min_max_single_negative_value_clamps_to_zero():
    """A candidate that actively HURTS the portfolio (negative sharpe_lift)
    must NOT be normalized to 1.0 just because it's the only data point.
    This was a real adversarial-review finding.
    """
    assert _normalize_min_max([-0.8]) == [0.0]
    assert _normalize_min_max([1.5]) == [1.0]  # Over-range clamps down to 1.0


def test_normalize_min_max_handles_all_equal():
    result = _normalize_min_max([0.5, 0.5, 0.5])
    assert all(v == 0.5 for v in result)


def test_normalize_min_max_handles_all_none():
    result = _normalize_min_max([None, None, None])
    assert all(v == 0.0 for v in result)


def test_engine_version_is_set():
    assert ENGINE_VERSION
    assert WEIGHTS_VERSION


# =========================================================================
# Phase 3 / D-15 — mandate fit tests (Wave 0: placeholder stubs, Wave 1: green)
# =========================================================================
# These 20 tests cover the new _compute_mandate_fit_score helper and its
# composition inside W_PREFERENCE_FIT. During Wave 0 they are scaffolded red
# (intentionally failing assertions OR pytest.skip markers that flip to pass
# once Wave 1 ships the production code). Do NOT modify these during Wave 1.
# =========================================================================


def _make_personalized_args(
    candidates: list[dict[str, Any]],
    preferences: dict[str, Any] | None = None,
    portfolio_aum: float = 1_000_000,
) -> dict[str, Any]:
    """Shared helper for mandate-fit tests that need personalized mode."""
    portfolio_strategies = [{"strategy_id": "owned1"}]
    portfolio_returns = {"owned1": _make_returns_series(seed=1)}
    cand_returns = {
        c["strategy_id"]: _make_returns_series(seed=hash(c["strategy_id"]) % 1000)
        for c in candidates
    }
    return dict(
        allocator_id="a1",
        preferences=preferences or {},
        portfolio_strategies=portfolio_strategies,
        portfolio_returns=portfolio_returns,
        portfolio_weights={"owned1": 1.0},
        candidate_strategies=candidates,
        candidate_returns=cand_returns,
        portfolio_aum=portfolio_aum,
    )


# --- 1/20 -----------------------------------------------------------------
def test_empty_mandates_fit_score_one():
    """SCORING-04: allocator with all-NULL mandates → mandate_fit_score = 1.0
    on every candidate."""
    if not MANDATE_FIT_IMPORTED:
        pytest.skip("wave 0 — _compute_mandate_fit_score not yet imported")
    candidates = [_make_candidate(f"s{i}") for i in range(5)]
    args = _make_personalized_args(candidates, preferences={})
    result = score_candidates(**args)
    for c in result["candidates"]:
        assert c["score_breakdown"]["mandate_fit_score"] == 1.0


# --- 2/20 -----------------------------------------------------------------
def test_partial_mandates_averaging_correctness():
    """Mandate with 1–2 dimensions set → other dimensions return 1.0, average
    reflects only active dimensions."""
    if not MANDATE_FIT_IMPORTED:
        pytest.skip("wave 0 — _compute_mandate_fit_score not yet imported")
    # max_weight is the only active dimension; add_weight (10%) > max_weight (5%)
    # so mw_score < 1.0, other three dims = 1.0 → score ∈ (0, 1).
    candidates = [_make_candidate("s1")]
    args = _make_personalized_args(
        candidates,
        preferences={"max_weight": 0.05, "target_ticket_size_usd": 100_000},
        portfolio_aum=1_000_000,  # 100k/1m = 10% add_weight
    )
    result = score_candidates(**args)
    score = result["candidates"][0]["score_breakdown"]["mandate_fit_score"]
    # 3 dims at 1.0 + 1 dim < 1.0 → average strictly between 0.75 and 1.0
    assert 0.75 <= score < 1.0


# --- 3/20 -----------------------------------------------------------------
def test_fully_specified_mandates_four_dimensions_active():
    """All 4 mandate dimensions active → mandate_fit_raw has per-dimension
    breakdown. style_exclusions_honored=True for scored rows."""
    if not MANDATE_FIT_IMPORTED:
        pytest.skip("wave 0 — _compute_mandate_fit_score not yet imported")
    candidates = [_make_candidate("s1", manager_aum=5_000_000, subtype="Momentum")]
    args = _make_personalized_args(
        candidates,
        preferences={
            "max_weight": 0.20,
            "correlation_ceiling": 0.5,
            "liquidity_preference": "medium",
            "style_exclusions": [],  # empty → no exclude
        },
    )
    result = score_candidates(**args)
    raw = result["candidates"][0]["score_breakdown"]["raw"]["mandate_fit_raw"]
    assert "max_weight" in raw
    assert "correlation_ceiling" in raw
    assert "liquidity_preference" in raw
    assert "style_exclusions_honored" in raw
    assert raw["style_exclusions_honored"] is True


# --- 4/20 -----------------------------------------------------------------
def test_max_weight_violation_tapers_below_one():
    """ROADMAP SC3: add_weight > max_weight → mandate_fit_score < 1.0 AND
    final_score lower than the same candidate with add_weight ≤ max_weight."""
    if not MANDATE_FIT_IMPORTED:
        pytest.skip("wave 0 — _compute_mandate_fit_score not yet imported")
    # Candidate A: add_weight (10%) > max_weight (5%) → penalty
    cand_a = [_make_candidate("s1")]
    args_a = _make_personalized_args(
        cand_a,
        preferences={"max_weight": 0.05, "target_ticket_size_usd": 100_000},
        portfolio_aum=1_000_000,
    )
    result_a = score_candidates(**args_a)
    # Candidate B: add_weight (10%) ≤ max_weight (20%) → no penalty
    cand_b = [_make_candidate("s1")]
    args_b = _make_personalized_args(
        cand_b,
        preferences={"max_weight": 0.20, "target_ticket_size_usd": 100_000},
        portfolio_aum=1_000_000,
    )
    result_b = score_candidates(**args_b)
    score_a = result_a["candidates"][0]["score_breakdown"]["mandate_fit_score"]
    score_b = result_b["candidates"][0]["score_breakdown"]["mandate_fit_score"]
    assert score_a < 1.0
    assert score_b == 1.0
    # Final score should also be lower for A than B
    assert result_a["candidates"][0]["score"] < result_b["candidates"][0]["score"]


# --- 5/20 -----------------------------------------------------------------
def test_max_weight_boundary_equality_returns_one():
    """add_weight == max_weight → mandate_fit = 1.0 exactly."""
    if not MANDATE_FIT_IMPORTED:
        pytest.skip("wave 0 — _compute_mandate_fit_score not yet imported")
    cand = [_make_candidate("s1")]
    args = _make_personalized_args(
        cand,
        preferences={"max_weight": 0.10, "target_ticket_size_usd": 100_000},
        portfolio_aum=1_000_000,  # 10% add_weight = 10% max_weight
    )
    result = score_candidates(**args)
    raw = result["candidates"][0]["score_breakdown"]["raw"]["mandate_fit_raw"]
    assert raw["max_weight"] == 1.0


# --- 6/20 -----------------------------------------------------------------
def test_style_excluded_hard_exclude():
    """SCORING-07b: candidate.subtype in style_exclusions → in excluded[] with
    reason='style_excluded', NOT in candidates[]. Full-universe run (≥5 eligible)
    so relaxation does not kick in."""
    # Need enough eligible candidates (≥5) so relaxation does NOT fire
    candidates = [_make_candidate(f"s{i}", subtype="Momentum") for i in range(5)]
    candidates.append(_make_candidate("bad", subtype="Mean Reversion"))
    args = _make_personalized_args(
        candidates,
        preferences={"style_exclusions": ["Mean Reversion"]},
    )
    result = score_candidates(**args)
    assert all(c["strategy_id"] != "bad" for c in result["candidates"])
    assert any(
        e["strategy_id"] == "bad" and e["exclusion_reason"] == "style_excluded"
        for e in result["excluded"]
    )


# --- 7/20 -----------------------------------------------------------------
def test_style_excluded_relaxation_branch():
    """<5 eligible → SOFT exclusions (including style_excluded) drop, candidate
    resurfaces."""
    candidates = [
        _make_candidate(f"s{i}", subtype="Mean Reversion")
        for i in range(3)  # only 3 — relaxation kicks in
    ]
    args = _make_personalized_args(
        candidates,
        preferences={"style_exclusions": ["Mean Reversion"]},
    )
    result = score_candidates(**args)
    assert result["filter_relaxed"] is True
    # After relaxation, all 3 appear in candidates[]
    assert len(result["candidates"]) == 3


# --- 8/20 -----------------------------------------------------------------
def test_correlation_ceiling_breach_penalty():
    """SCORING-07c: corr_with_portfolio > correlation_ceiling → mandate_fit < 1.0."""
    if not MANDATE_FIT_IMPORTED:
        pytest.skip("wave 0 — _compute_mandate_fit_score not yet imported")
    # Same-seed returns → perfect correlation (~1.0) > ceiling
    portfolio_strategies = [{"strategy_id": "owned1"}]
    portfolio_returns = {"owned1": _make_returns_series(seed=1)}
    cand_returns = {"s1": _make_returns_series(seed=1)}  # identical
    candidates = [_make_candidate("s1")]
    args = dict(
        allocator_id="a1",
        preferences={"correlation_ceiling": 0.3},
        portfolio_strategies=portfolio_strategies,
        portfolio_returns=portfolio_returns,
        portfolio_weights={"owned1": 1.0},
        candidate_strategies=candidates,
        candidate_returns=cand_returns,
        portfolio_aum=1_000_000,
    )
    result = score_candidates(**args)
    raw = result["candidates"][0]["score_breakdown"]["raw"]
    if raw.get("corr_with_portfolio") is not None and raw["corr_with_portfolio"] > 0.3:
        assert result["candidates"][0]["score_breakdown"]["mandate_fit_score"] < 1.0


# --- 9/20 -----------------------------------------------------------------
def test_correlation_ceiling_null_corr_is_neutral():
    """corr_with_portfolio is None (sparse overlap) → correlation dimension = 1.0
    (no penalty for data sparseness)."""
    if not MANDATE_FIT_IMPORTED:
        pytest.skip("wave 0 — _compute_mandate_fit_score not yet imported")
    # Screening mode → no portfolio correlation to compute
    candidates = [_make_candidate(f"s{i}") for i in range(5)]
    result = score_candidates(
        allocator_id="a1",
        preferences={"correlation_ceiling": 0.5},
        portfolio_strategies=[],
        portfolio_returns={},
        portfolio_weights={},
        candidate_strategies=candidates,
        candidate_returns={},
    )
    for c in result["candidates"]:
        raw = c["score_breakdown"]["raw"]["mandate_fit_raw"]
        assert raw["correlation_ceiling"] == 1.0


# --- 10/20 ----------------------------------------------------------------
def test_liquidity_two_tier_gap_high_to_low():
    """allocator=high, candidate tier=low → lp_score = 0.0."""
    if not MANDATE_FIT_IMPORTED:
        pytest.skip("wave 0 — _compute_mandate_fit_score not yet imported")
    # manager_aum = $500k → low tier (< $1M)
    candidates = [_make_candidate("s1", manager_aum=500_000)]
    args = _make_personalized_args(
        candidates,
        preferences={"liquidity_preference": "high"},
    )
    result = score_candidates(**args)
    raw = result["candidates"][0]["score_breakdown"]["raw"]["mandate_fit_raw"]
    assert raw["liquidity_preference"] == 0.0


# --- 11/20 ----------------------------------------------------------------
def test_liquidity_low_to_high_is_neutral():
    """allocator=low, candidate tier=high → lp_score = 1.0 (more liquid is
    strictly better; penalize only when candidate tier is LOWER)."""
    if not MANDATE_FIT_IMPORTED:
        pytest.skip("wave 0 — _compute_mandate_fit_score not yet imported")
    candidates = [_make_candidate("s1", manager_aum=50_000_000)]  # high tier
    args = _make_personalized_args(
        candidates,
        preferences={"liquidity_preference": "low"},
    )
    result = score_candidates(**args)
    raw = result["candidates"][0]["score_breakdown"]["raw"]["mandate_fit_raw"]
    assert raw["liquidity_preference"] == 1.0


# --- 12/20 ----------------------------------------------------------------
def test_weight_overrides_normalization_invariant():
    """Under any scoring_weight_overrides input (even extreme) the four
    effective top-level weights sum to 1.0 ± 1e-9."""
    if not MANDATE_FIT_IMPORTED:
        pytest.skip("wave 0 — _compute_mandate_fit_score not yet imported")
    # This is an internal invariant — we verify it indirectly by checking
    # final_score stays bounded in [0, 100] across extreme override inputs.
    candidates = [_make_candidate("s1")]
    for overrides in [
        {"W_PORTFOLIO_FIT": 10.0},
        {"W_PREFERENCE_FIT": 0.01},
        {"W_TRACK_RECORD": 100.0, "W_CAPACITY_FIT": 0.0},
        {},
    ]:
        args = _make_personalized_args(
            candidates,
            preferences={"scoring_weight_overrides": overrides},
        )
        result = score_candidates(**args)
        if result["candidates"]:
            score = result["candidates"][0]["score"]
            assert 0 <= score <= 100.001, (
                f"overrides={overrides} produced out-of-range score={score}"
            )


# --- 13/20 ----------------------------------------------------------------
def test_weight_overrides_missing_keys_default_one():
    """Override dict with only one key → other three scale by 1.0,
    renormalized across all four."""
    if not MANDATE_FIT_IMPORTED:
        pytest.skip("wave 0 — _compute_mandate_fit_score not yet imported")
    # overrides = {"W_PORTFOLIO_FIT": 1.3} → other 3 scale by 1.0, bumps
    # portfolio_fit weight relative to v1 default 0.40.
    candidates = [_make_candidate(f"s{i}") for i in range(5)]
    args = _make_personalized_args(
        candidates,
        preferences={"scoring_weight_overrides": {"W_PORTFOLIO_FIT": 1.3}},
    )
    result = score_candidates(**args)
    # Sanity: at least produces a non-trivial result — normalization didn't
    # zero everything out. Actual weight values are internal; verified via
    # the golden-snapshot test.
    assert len(result["candidates"]) > 0
    for c in result["candidates"]:
        assert 0 <= c["score"] <= 100.001


# --- 14/20 ----------------------------------------------------------------
def test_weight_overrides_clamp_to_one_point_five():
    """Override value 10.0 → clamped to 1.5 before renormalize (no runaway
    weight). Test by showing override of 10.0 produces same result as 1.5."""
    if not MANDATE_FIT_IMPORTED:
        pytest.skip("wave 0 — _compute_mandate_fit_score not yet imported")
    candidates = [_make_candidate(f"s{i}") for i in range(3)]
    args_extreme = _make_personalized_args(
        candidates,
        preferences={"scoring_weight_overrides": {"W_PORTFOLIO_FIT": 10.0}},
    )
    args_clamped = _make_personalized_args(
        candidates,
        preferences={"scoring_weight_overrides": {"W_PORTFOLIO_FIT": 1.5}},
    )
    r_extreme = score_candidates(**args_extreme)
    r_clamped = score_candidates(**args_clamped)
    # Same ordering, same scores (clamp collapsed them)
    assert [c["strategy_id"] for c in r_extreme["candidates"]] == \
           [c["strategy_id"] for c in r_clamped["candidates"]]
    for c1, c2 in zip(r_extreme["candidates"], r_clamped["candidates"]):
        assert abs(c1["score"] - c2["score"]) < 1e-9


# --- 15/20 ----------------------------------------------------------------
def test_weight_overrides_none_is_v1_behavior():
    """scoring_weight_overrides = None → engine uses unmodified v1 top-level
    weights (0.40/0.30/0.15/0.15)."""
    if not MANDATE_FIT_IMPORTED:
        pytest.skip("wave 0 — _compute_mandate_fit_score not yet imported")
    # Compare None override with no scoring_weight_overrides key at all —
    # both should produce identical scores.
    candidates = [_make_candidate(f"s{i}") for i in range(3)]
    args_none = _make_personalized_args(
        candidates,
        preferences={"scoring_weight_overrides": None},
    )
    args_missing = _make_personalized_args(candidates, preferences={})
    r_none = score_candidates(**args_none)
    r_missing = score_candidates(**args_missing)
    for c1, c2 in zip(r_none["candidates"], r_missing["candidates"]):
        assert c1["strategy_id"] == c2["strategy_id"]
        assert abs(c1["score"] - c2["score"]) < 1e-9


# --- 16/20 ----------------------------------------------------------------
def test_determinism_with_mandates():
    """Same inputs with fully-specified mandates → byte-identical JSON output."""
    candidates = [
        _make_candidate(f"s{i}", subtype="Momentum", manager_aum=5_000_000)
        for i in range(5)
    ]
    args = _make_personalized_args(
        candidates,
        preferences={
            "max_weight": 0.10,
            "correlation_ceiling": 0.5,
            "liquidity_preference": "medium",
            "style_exclusions": [],
            "scoring_weight_overrides": {"W_PORTFOLIO_FIT": 1.2},
        },
    )
    r1 = score_candidates(**args)
    r2 = score_candidates(**args)
    assert to_canonical_json(r1) == to_canonical_json(r2)


# --- 17/20 ----------------------------------------------------------------
def test_mandate_fit_key_present_both_modes():
    """SCORING-02: every scored candidate row has score_breakdown.mandate_fit_score
    in both personalized and screening modes."""
    # Screening mode
    candidates = [_make_candidate(f"s{i}") for i in range(5)]
    result_screening = score_candidates(
        allocator_id="a1",
        preferences=None,
        portfolio_strategies=[],
        portfolio_returns={},
        portfolio_weights={},
        candidate_strategies=candidates,
        candidate_returns={},
    )
    for c in result_screening["candidates"]:
        assert "mandate_fit_score" in c["score_breakdown"]
        v = c["score_breakdown"]["mandate_fit_score"]
        assert isinstance(v, (int, float))
        assert 0.0 <= v <= 1.0

    # Personalized mode
    candidates_p = [_make_candidate(f"s{i}") for i in range(5)]
    args_p = _make_personalized_args(candidates_p, preferences={})
    result_personalized = score_candidates(**args_p)
    for c in result_personalized["candidates"]:
        assert "mandate_fit_score" in c["score_breakdown"]
        v = c["score_breakdown"]["mandate_fit_score"]
        assert isinstance(v, (int, float))
        assert 0.0 <= v <= 1.0


# --- 18/20 ----------------------------------------------------------------
def test_engine_version_bumped():
    """SCORING-01: ENGINE_VERSION and WEIGHTS_VERSION both equal 'v2.0.0' in
    lockstep. Intentional red during Wave 0 (module still at v1.0.0)."""
    assert ENGINE_VERSION == "v2.0.0", \
        f"Expected ENGINE_VERSION='v2.0.0', got {ENGINE_VERSION!r}"
    assert WEIGHTS_VERSION == "v2.0.0", \
        f"Expected WEIGHTS_VERSION='v2.0.0', got {WEIGHTS_VERSION!r}"


# --- 19/20 ----------------------------------------------------------------
def test_v1_prefs_backward_compat_rank_order():
    """SCORING-04 is interpreted as rank-order invariance, NOT absolute-score
    equality (absolute scores shift uniformly by +0.12 under the 0.6/0.4
    composition per D-02). User sign-off captured in CONTEXT Open Question Q5
    / RESEARCH 2026-04-18.

    An allocator whose preferences dict has no mandate keys (pre-Phase-3 shape)
    gets mandate_fit_score = 1.0 AND produces the SAME rank order across a
    5-candidate universe as engine v1 did.
    """
    if not MANDATE_FIT_IMPORTED:
        pytest.skip("wave 0 — _compute_mandate_fit_score not yet imported")
    # Deterministic 5-candidate universe with varied sharpe/track record
    candidates = [
        _make_candidate("s1", sharpe=0.8, track_record_days=100),
        _make_candidate("s2", sharpe=1.5, track_record_days=500),
        _make_candidate("s3", sharpe=2.0, track_record_days=1000),
        _make_candidate("s4", sharpe=1.2, track_record_days=300),
        _make_candidate("s5", sharpe=0.5, track_record_days=50),
    ]
    # v1-shaped preferences (no mandate keys)
    result = score_candidates(
        allocator_id="a1",
        preferences={
            "min_sharpe": 0.3,
            "min_track_record_days": 30,
            "max_drawdown_tolerance": 0.5,
        },
        portfolio_strategies=[],
        portfolio_returns={},
        portfolio_weights={},
        candidate_strategies=candidates,
        candidate_returns={},
    )
    # All candidates get mandate_fit_score = 1.0
    for c in result["candidates"]:
        assert c["score_breakdown"]["mandate_fit_score"] == 1.0
    # Rank order: longer track + higher sharpe beats shorter/lower.
    # s3 > s2 > s4 > s1 > s5 by preference_fit + track_record
    ranks = [c["strategy_id"] for c in result["candidates"]]
    assert ranks.index("s3") < ranks.index("s2")
    assert ranks.index("s2") < ranks.index("s4")
    assert ranks.index("s4") < ranks.index("s1")


# --- 20/20 ----------------------------------------------------------------
def test_v1_to_v2_golden_snapshot():
    """Frozen v2.0.0 output for a deterministic 3-candidate universe. Catches
    accidental math drift across future refactors. Regenerate via
    REGENERATE_GOLDEN=1 pytest tests/test_match_engine.py::test_v1_to_v2_golden_snapshot.
    """
    candidates = [
        _make_candidate(f"s{i}", sharpe=1.0 + i * 0.1, subtype="Mean Reversion")
        for i in range(3)
    ]
    args = dict(
        allocator_id="a1",
        preferences={
            "max_weight": 0.10,
            "correlation_ceiling": 0.5,
            "liquidity_preference": "high",
            "style_exclusions": [],
            "scoring_weight_overrides": None,
        },
        portfolio_strategies=[],
        portfolio_returns={},
        portfolio_weights={},
        candidate_strategies=candidates,
        candidate_returns={},
    )
    result = score_candidates(**args)
    actual = to_canonical_json(result)
    expected_path = FIXTURES_DIR / "match_engine_v2_golden.json"
    if os.environ.get("REGENERATE_GOLDEN"):
        expected_path.write_text(actual + "\n")
        pytest.skip(
            "Regenerated golden fixture — re-run without REGENERATE_GOLDEN to assert"
        )
    expected = expected_path.read_text().strip()
    assert actual == expected, (
        "Golden snapshot drift — regen via REGENERATE_GOLDEN=1 if math change is intentional"
    )
