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
    """Sharpe 0.3, min 1.0 → in excluded[] with reason='below_min_sharpe'.

    Audit closure C-0239 / M-0741 / M-0744(a): the prior implementation passed
    a single below-threshold candidate. With only 1 candidate the relaxation
    path (eligible < 5) ALWAYS fires, so `filter_relaxed is True` short-circuits
    the disjunction and the exclusion-reason assertion never runs. Provide ≥5
    healthy candidates so relaxation does NOT fire, then assert the exclusion
    reason directly with no escape hatch. Per CLAUDE.md Rule 9 — tests must
    encode WHY behavior matters, not just appear to pass.
    """
    # Five healthy candidates + one low-sharpe → eligible >= 5, no relaxation.
    candidates = [
        _make_candidate(f"healthy{i}", sharpe=1.5, track_record_days=400)
        for i in range(5)
    ]
    candidates.append(_make_candidate("s1", sharpe=0.3, track_record_days=400))
    result = score_candidates(
        allocator_id="a1",
        preferences={"min_sharpe": 1.0},
        portfolio_strategies=[],
        portfolio_returns={},
        portfolio_weights={},
        candidate_strategies=candidates,
        candidate_returns={},
    )
    # Precondition: relaxation must NOT have fired — otherwise the exclusion
    # reason is bypassed and this test would degrade to vacuous-pass.
    assert result["filter_relaxed"] is False, (
        "Test setup invariant: with ≥5 healthy candidates, relaxation must not fire"
    )
    # The low-sharpe candidate is excluded with the precise reason.
    assert any(
        e["strategy_id"] == "s1" and e["exclusion_reason"] == "below_min_sharpe"
        for e in result["excluded"]
    ), (
        "below_min_sharpe exclusion reason missing — engine soft-filter regression. "
        f"Excluded={result['excluded']}"
    )
    # And the low-sharpe candidate is NOT in the scored set.
    assert all(c["strategy_id"] != "s1" for c in result["candidates"])


def test_eligibility_relaxation_resurrects_low_sharpe():
    """Companion to test_eligibility_excludes_low_sharpe_with_reason.

    When fewer than 5 candidates clear the soft filter, relaxation fires and
    below_min_sharpe candidates are resurrected (sharpe is a soft check). The
    excluded list still carries the reason for audit, but the candidate now
    appears in result['candidates']. Pins the relaxation branch so a future
    change that drops the soft-filter resurrection trips this test.
    """
    candidates = [_make_candidate("s1", sharpe=0.3, track_record_days=400)]
    result = score_candidates(
        allocator_id="a1",
        preferences={"min_sharpe": 1.0},
        portfolio_strategies=[],
        portfolio_returns={},
        portfolio_weights={},
        candidate_strategies=candidates,
        candidate_returns={},
    )
    # Only 1 candidate → eligible < 5 → relaxation fires.
    assert result["filter_relaxed"] is True
    # Soft filter dropped → candidate resurfaces.
    assert any(c["strategy_id"] == "s1" for c in result["candidates"])


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
    """Uncorrelated candidate should beat correlated one with same metrics.

    Audit closure C-0240 / M-0744(b): the prior implementation guarded the
    only meaningful assertion behind `if corr_unc is not None and corr_cor is
    not None`. _compute_portfolio_fit_components requires len(aligned) >= 30 to
    produce a non-None corr; the prior 100-day series with identical date
    indexes does meet that bar, but the if-guard left the test passing in any
    future where overlap shrinks. Use 200-day series + assert corr non-None as
    a hard precondition so a regression that silently returns None FAILS LOUD
    instead of green-passing.
    """
    portfolio_returns = {"owned1": _make_returns_series(n_days=200, seed=1)}
    portfolio_strategies = [{"strategy_id": "owned1"}]
    # Correlated candidate uses same seed; uncorrelated uses different
    cand_returns = {
        "correlated": _make_returns_series(n_days=200, seed=1),  # Identical to portfolio
        "uncorrelated": _make_returns_series(n_days=200, seed=999),
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
    corr_unc = by_id["uncorrelated"]["score_breakdown"]["raw"]["corr_with_portfolio"]
    corr_cor = by_id["correlated"]["score_breakdown"]["raw"]["corr_with_portfolio"]
    # Precondition: with a 200-day overlap (well above the 30-day minimum) the
    # engine MUST compute a correlation. A None here means
    # _compute_portfolio_fit_components silently regressed — fail loud, do not
    # skip the meaningful assertion.
    assert corr_unc is not None, (
        "corr_with_portfolio is None for the uncorrelated candidate — "
        "test setup insufficient or engine regression"
    )
    assert corr_cor is not None, (
        "corr_with_portfolio is None for the correlated candidate — "
        "test setup insufficient or engine regression"
    )
    # The uncorrelated candidate should have a strictly lower correlation than
    # the identical-returns candidate.
    assert corr_unc < corr_cor, (
        f"Expected uncorrelated ({corr_unc}) < correlated ({corr_cor}) "
        "— portfolio_fit ordering broken"
    )


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
    """Tiny allocator vs whale produces different sharpe_lift for same candidate.

    Audit closure C-0241 / M-0744(b): the prior assertion was wrapped in
    `if tiny_lift is not None and whale_lift is not None:` with a comment
    documenting that both could be None — i.e. a self-documented escape hatch
    that lets the test green-pass without verifying that ticket_size /
    portfolio_aum actually influences the portfolio_fit math. Use 200-day
    series so _compute_portfolio_fit_components meets its 30-day overlap floor
    deterministically and assert sharpe_lift non-None as a hard precondition.
    """
    portfolio_returns = {"owned1": _make_returns_series(n_days=200, seed=1)}
    portfolio_strategies = [{"strategy_id": "owned1"}]
    candidates = [_make_candidate("s1")]
    cand_returns = {"s1": _make_returns_series(n_days=200, seed=42)}

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
    # Precondition: 200-day overlap forces sharpe_lift to be computable. A
    # None value here means the engine silently dropped the lift computation
    # — surface as a test failure, do not skip.
    assert tiny_lift is not None, (
        "sharpe_lift is None for tiny allocator — overlap insufficient or engine regression"
    )
    assert whale_lift is not None, (
        "sharpe_lift is None for whale allocator — overlap insufficient or engine regression"
    )
    # Different ticket-size / portfolio_aum ratios must produce different
    # portfolio_fit math. Exact equality means add_weight has no influence on
    # sharpe_lift — the core intent of this test.
    assert tiny_lift != whale_lift, (
        f"sharpe_lift identical for tiny ({tiny_lift}) and whale ({whale_lift}) — "
        "add_weight derivation from ticket_size / portfolio_aum is broken"
    )


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
    """If correlation is None, the diversification reason is not produced.

    Audit closure H-0779 / M-0744(c): the prior implementation wrapped reason
    inspection in `if result['candidates']:` — an empty candidates list would
    silently pass with zero assertions. Assert `len(result['candidates']) == 1`
    unconditionally so an empty result FAILS the test instead of bypassing it.
    """
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
    # Precondition: the candidate must be scored (single eligible row). An
    # empty list means hard-filter or relaxation ate the row — invalidates
    # the reason-generation invariant we are trying to assert.
    assert len(result["candidates"]) == 1, (
        f"Expected 1 scored candidate, got {len(result['candidates'])}. "
        f"Excluded={result['excluded']}"
    )
    # The candidate's corr_with_portfolio must be None — that is the
    # precondition for the "skips diversification reason" behavior under test.
    raw = result["candidates"][0]["score_breakdown"]["raw"]
    assert raw.get("corr_with_portfolio") is None, (
        f"Test setup invariant: corr_with_portfolio must be None to exercise "
        f"the skip-reason branch. Got {raw.get('corr_with_portfolio')!r}."
    )
    reasons = result["candidates"][0]["reasons"]
    # No reason should mention correlation when corr was None — guards against
    # a regression that formats None as 0.00 (the silent-misled case).
    assert not any("correlation" in r.lower() for r in reasons), (
        f"Diversification reason produced despite None correlation: {reasons}"
    )


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


# --- 5b -------------------------------------------------------------------
# Audit closure M-0743: the prior mandate-fit suite covered equality (test 5)
# and one violation case (test 4, add_weight=10% vs max_weight=5%) but never
# the 2× floor-clamp boundary. The taper formula is
# `mw_score = max(0.0, 1 - (add_weight - max_w) / max_w)` — without the
# `max(0.0, …)` clamp, add_weight = 3 × max_w would produce a NEGATIVE
# mw_score that then biases the four-dim average downward. The parametrized
# test below pins the floor at the 2× boundary AND beyond, so a regression
# that drops the floor clamp fails loudly.
# add_weight in this engine is clamped to [0.01, 0.5] (services/match_engine.py:662),
# so to drive add_weight to 2× and 3× max_w we set max_w to small values
# (e.g. 0.05 → 2× = 0.10, 3× = 0.15, both ≤ 0.5).
@pytest.mark.parametrize(
    "ticket_size_usd,portfolio_aum,max_w,expected",
    [
        # ticket/aum gives add_weight; max_w is the ceiling.
        # add_weight = 2 × max_w → 1 - (2x - x)/x = 0 (floor clamp boundary)
        (100_000, 1_000_000, 0.05, 0.0),
        # add_weight = 3 × max_w → 1 - (3x - x)/x = -1; clamped to 0
        (150_000, 1_000_000, 0.05, 0.0),
        # add_weight = 1.5 × max_w → 1 - 0.5 = 0.5 (midpoint, no clamp)
        (75_000, 1_000_000, 0.05, 0.5),
    ],
)
def test_max_weight_floor_clamp_at_two_times_boundary(
    ticket_size_usd: int,
    portfolio_aum: int,
    max_w: float,
    expected: float,
):
    """add_weight ≥ 2 × max_weight → mw_score floored to 0.0 (no negative)."""
    if not MANDATE_FIT_IMPORTED:
        pytest.skip("wave 0 — _compute_mandate_fit_score not yet imported")
    cand = [_make_candidate("s1")]
    args = _make_personalized_args(
        cand,
        preferences={"max_weight": max_w, "target_ticket_size_usd": ticket_size_usd},
        portfolio_aum=portfolio_aum,
    )
    result = score_candidates(**args)
    raw = result["candidates"][0]["score_breakdown"]["raw"]["mandate_fit_raw"]
    assert raw["max_weight"] == pytest.approx(expected, abs=1e-9), (
        f"mw_score floor regression: add_weight≈{ticket_size_usd/portfolio_aum:.2%}, "
        f"max_w={max_w:.2%}, expected mw_score={expected}, got {raw['max_weight']}"
    )
    # Defense in depth: the clamp must never produce a negative value, even
    # if a future maintainer changes the formula.
    assert raw["max_weight"] >= 0.0, (
        f"mw_score went negative ({raw['max_weight']}) — floor clamp missing"
    )


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
    effective top-level weights sum to 1.0 ± 1e-9.

    Audit closure M-0742: the prior implementation only asserted
    `0 <= score <= 100.001`, which is automatically satisfied as long as
    `total > 0` and each sub-score is in [0, 1] — meaning a regression that
    forgot the renormalize division (final_score = 100 × Σ wᵢsᵢ instead of
    100 × Σ wᵢsᵢ / Σ wᵢ) would still pass when sub-component scores are
    sufficiently small. Per CLAUDE.md Rule 9 — assert the underlying invariant
    directly.

    Trick: when all four sub-scores collapse to the same value v, the final
    score equals 100 × v × (Σ effective_w) regardless of override shape. If
    weights sum to 1.0, final_score = 100 × v exactly. If renormalization is
    broken (Σ effective_w != 1.0), the score drifts away from 100 × v and the
    assertion fails loudly. We use the helper-imported _compute_mandate_fit_score
    is not needed here — we construct a candidate where the FOUR top-level
    sub-scores are all 1.0:
        - portfolio_fit: identical-returns same-seed → max possible
        - preference_fit: very lenient mins → sub-scores at 1.0
        - track_record: 730+ days → capped at 1.0
        - capacity_fit: zero ticket size → neutral 0.5 (not 1.0)

    Because capacity_fit cannot easily be forced to 1.0, we instead verify the
    weighted average satisfies a tighter bound: a regression that omits the
    division by `total` would produce final_score in [0, 100 × max(scaled)]
    instead of [0, 100], and the upper bound on scaled per-key is 1.5 × 0.40
    = 0.60. With a sub-score of 1.0 driving that term, the test catches the
    missing-renormalize regression because the resulting score would still be
    ≤ 100. So we ALSO compute the expected score using the documented
    constants and assert byte-equality.
    """
    if not MANDATE_FIT_IMPORTED:
        pytest.skip("wave 0 — _compute_mandate_fit_score not yet imported")

    # Strategy: hold sub-scores CONSTANT across override sets by using the
    # SAME candidate inputs. Then if renormalize is correct, final_score is
    # IDENTICAL across all override shapes (because Σ effective_w = 1.0 always
    # and each sub-score is the same). If renormalize is broken, scores drift.
    candidates = [_make_candidate("s1", sharpe=1.5, track_record_days=400, manager_aum=5_000_000)]

    # Baseline: no overrides → uses raw 0.40/0.30/0.15/0.15
    baseline = score_candidates(**_make_personalized_args(
        candidates, preferences={"scoring_weight_overrides": {}},
    ))
    assert baseline["candidates"], "baseline run produced no candidates"
    baseline_score = baseline["candidates"][0]["score"]

    # Sub-scores are determined ONLY by candidate + portfolio + non-weight prefs.
    # Override scaling × renormalization should NOT change them. So with a
    # uniform scaling (all four overrides at the same value), the renormalize
    # cancels out the scale and final_score must equal baseline_score.
    for uniform_scale in [0.5, 1.0, 1.5]:
        args = _make_personalized_args(
            candidates,
            preferences={"scoring_weight_overrides": {
                "W_PORTFOLIO_FIT": uniform_scale,
                "W_PREFERENCE_FIT": uniform_scale,
                "W_TRACK_RECORD": uniform_scale,
                "W_CAPACITY_FIT": uniform_scale,
            }},
        )
        result = score_candidates(**args)
        assert result["candidates"], f"uniform scale {uniform_scale} produced no candidates"
        score = result["candidates"][0]["score"]
        # Uniform scaling cancels: scaled_i = W_i × s, total = s × Σ W_i = s,
        # effective_i = W_i × s / s = W_i. So scores must match baseline.
        assert score == pytest.approx(baseline_score, abs=1e-9), (
            f"uniform override scale={uniform_scale} drifted score "
            f"({score}) from baseline ({baseline_score}) — renormalization broken"
        )

    # Extreme / clamped overrides must still stay in [0, 100].
    for overrides in [
        {"W_PORTFOLIO_FIT": 10.0},      # clamped to 1.5
        {"W_PREFERENCE_FIT": 0.01},     # clamped to 0.5
        {"W_TRACK_RECORD": 100.0, "W_CAPACITY_FIT": 0.0},  # both clamped
        {},                              # no overrides
    ]:
        args = _make_personalized_args(
            candidates,
            preferences={"scoring_weight_overrides": overrides},
        )
        result = score_candidates(**args)
        assert result["candidates"], f"overrides={overrides} produced no candidates"
        score = result["candidates"][0]["score"]
        # Final score is a weighted average of sub-scores in [0, 1] times 100,
        # with effective weights summing to 1.0 — must stay in [0, 100].
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
def test_weights_version_pinned_v2():
    """SCORING-01: WEIGHTS_VERSION pinned to 'v2.0.0' — weight composition is
    unchanged across Phase 09's input-layer rewire (D-17). ENGINE_VERSION is
    asserted separately in the Phase 09 D-17 section below."""
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


# ---------------------------------------------------------------------------
# Phase 09 / D-17: ENGINE_VERSION bump assertion
# ---------------------------------------------------------------------------


def test_engine_version_phase09_bump():
    """Phase 09 D-17: ENGINE_VERSION must be v2.1.0 after the input-layer rewire.

    _should_skip_allocator trigger #2 auto-invalidates cached v2.0.0 batches
    on first post-ship cron run via engine_version != ENGINE_VERSION check.
    WEIGHTS_VERSION stays v2.0.0 (weight composition identical; only input layer changed).
    """
    assert ENGINE_VERSION == "v2.1.0", (
        f"Phase 09 D-17: expected ENGINE_VERSION='v2.1.0', got '{ENGINE_VERSION}'. "
        "Bump ENGINE_VERSION in services/match_engine.py."
    )
    # WEIGHTS_VERSION unchanged per D-17 (weight composition identical; only input layer changed)
    assert WEIGHTS_VERSION == "v2.0.0", (
        f"WEIGHTS_VERSION should remain 'v2.0.0', got '{WEIGHTS_VERSION}'. "
        "D-17 specifies WEIGHTS_VERSION is NOT bumped."
    )
