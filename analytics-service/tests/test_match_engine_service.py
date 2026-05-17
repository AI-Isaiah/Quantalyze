"""Cluster N regression tests for analytics-service/services/match_engine.py.

These tests cover audit-2026-05-07 findings closed in cluster-N (2026-05-17):
  C-0230 / H-0699 — bare `assert total > 0` replaced with ValueError that
    survives `python -O`.
  H-0700 — correlation_ceiling==1.0 must not collapse mandate_fit to 0 on
    float jitter above 1.0.
  H-0704 — NaN final_score must surface `score_error=True` rather than
    silently coerce to a bottom-rank 0.
  H-0705 — `excluded_strategy_ids` must actually filter candidates and emit
    an `explicitly_excluded` exclusion row.
  H-0695 — `effective_preferences` must reflect the relaxed dict when the
    soft-filter relaxation fires, and `relaxed_overrides` must list deltas.
  H-0696 — `ExclusionReason` enum, `is_hard` property, and the
    HARD/SOFT_EXCLUSION_REASONS string-set views must round-trip.
  H-0697 — `Mode` Literal-type is importable.
  H-0698 — `ScoreCandidatesResult` TypedDict is importable and the
    candidate return dict satisfies the key set.
  M-0674 — out-of-vocab `liquidity_preference` degrades to neutral 1.0
    instead of KeyError.
  M-0676 — `_top_excluded` orders soft-failure candidates by closeness-to-
    passing (highest sharpe → top).
  M-0677 — `off_mandate_type` soft exclusion fires when candidate
    strategy_type is outside `preferred_strategy_types`.
  M-0678 — strict and hard-only eligibility paths agree on excluded-
    exchange normalization (case + None handling).
  M-0679 — relaxation magic numbers (5/90/1.0/0.0) live behind named
    constants.

Tests verify INTENT (Rule 9): each one must fail when the corresponding fix
is reverted, so the test encodes the WHY of the behaviour.
"""

from typing import Any

from services.match_engine import (
    ENGINE_VERSION,
    ExclusionReason,
    HARD_EXCLUSION_REASONS,
    Mode,
    RELAXATION_MAX_DD_TOLERANCE,
    RELAXATION_MIN_CANDIDATES,
    RELAXATION_MIN_SHARPE,
    RELAXATION_MIN_TRACK_DAYS,
    ScoreCandidatesResult,
    SOFT_EXCLUSION_REASONS,
    _compute_mandate_fit_score,
    _eligibility_check,
    _eligibility_check_hard_only,
    _top_excluded,
    score_candidates,
)


def _candidate(
    sid: str = "s1",
    sharpe: float = 1.5,
    track_record_days: int = 365,
    max_drawdown_pct: float = -0.15,
    manager_aum: float | None = 5_000_000,
    exchange: str = "binance",
    strategy_type: str = "trend_following",
) -> dict[str, Any]:
    return {
        "strategy_id": sid,
        "sharpe": sharpe,
        "track_record_days": track_record_days,
        "max_drawdown_pct": max_drawdown_pct,
        "manager_aum": manager_aum,
        "exchange": exchange,
        "strategy_type": strategy_type,
    }


# ---------------------------------------------------------------------------
# H-0696 — ExclusionReason enum
# ---------------------------------------------------------------------------


def test_exclusion_reason_enum_string_compat():
    """Enum values match the SQL CHECK vocabulary verbatim."""
    expected = {
        "owned",
        "thumbs_down",
        "excluded_exchange",
        "below_min_sharpe",
        "below_min_track_record",
        "exceeds_max_dd",
        "off_mandate_type",
        "style_excluded",
        "explicitly_excluded",
    }
    assert {r.value for r in ExclusionReason} == expected


def test_exclusion_reason_is_hard_property():
    assert ExclusionReason.OWNED.is_hard is True
    assert ExclusionReason.THUMBS_DOWN.is_hard is True
    assert ExclusionReason.EXCLUDED_EXCHANGE.is_hard is True
    assert ExclusionReason.EXPLICITLY_EXCLUDED.is_hard is True
    assert ExclusionReason.BELOW_MIN_SHARPE.is_hard is False
    assert ExclusionReason.STYLE_EXCLUDED.is_hard is False


def test_hard_and_soft_reason_sets_partition_enum():
    """HARD ∪ SOFT == all enum values; HARD ∩ SOFT == empty."""
    all_values = {r.value for r in ExclusionReason}
    assert HARD_EXCLUSION_REASONS | SOFT_EXCLUSION_REASONS == all_values
    assert HARD_EXCLUSION_REASONS & SOFT_EXCLUSION_REASONS == set()


# ---------------------------------------------------------------------------
# H-0697 — Mode Literal
# ---------------------------------------------------------------------------


def test_mode_literal_importable():
    """Mode is a Literal type alias — `__args__` exposes the two valid values."""
    assert set(Mode.__args__) == {"personalized", "screening"}  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# H-0698 — ScoreCandidatesResult TypedDict
# ---------------------------------------------------------------------------


def test_score_candidates_result_typeddict_keys():
    """Required keys of the persistence contract are declared on the TypedDict."""
    keys = ScoreCandidatesResult.__annotations__.keys()
    required = {
        "mode",
        "filter_relaxed",
        "engine_version",
        "weights_version",
        "effective_preferences",
        "relaxed_overrides",
        "effective_thresholds",
        "candidates",
        "excluded",
        "excluded_total",
        "source_strategy_count",
    }
    assert required.issubset(keys)


def test_score_candidates_screening_return_matches_typeddict():
    """A real screening-mode call emits a dict with every required key."""
    result = score_candidates(
        allocator_id="a1",
        preferences=None,
        portfolio_strategies=[],
        portfolio_returns={},
        portfolio_weights={},
        candidate_strategies=[_candidate("s1"), _candidate("s2")],
        candidate_returns={},
    )
    for k in ScoreCandidatesResult.__annotations__.keys():
        assert k in result, f"missing key {k}"
    assert result["engine_version"] == ENGINE_VERSION


# ---------------------------------------------------------------------------
# H-0700 — correlation_ceiling == 1.0 must not collapse on jitter
# ---------------------------------------------------------------------------


def test_correlation_ceiling_one_is_no_penalty_even_with_float_jitter():
    """ceiling=1.0 means 'no cap'; corr=1.0+1e-15 should still score 1.0."""
    score_at_jitter, breakdown_jitter = _compute_mandate_fit_score(
        candidate={"manager_aum": 5_000_000},
        preferences={"correlation_ceiling": 1.0},
        corr_with_portfolio=1.0 + 1e-12,  # float-precision drift above 1.0
        add_weight=0.1,
        mode="personalized",
    )
    assert breakdown_jitter["correlation_ceiling"] == 1.0
    # And exact 1.0 also returns 1.0
    _, breakdown_exact = _compute_mandate_fit_score(
        candidate={"manager_aum": 5_000_000},
        preferences={"correlation_ceiling": 1.0},
        corr_with_portfolio=1.0,
        add_weight=0.1,
        mode="personalized",
    )
    assert breakdown_exact["correlation_ceiling"] == 1.0


def test_correlation_ceiling_below_one_still_penalizes_above():
    """ceiling=0.7 + corr=1.0 still pegs to 0.0 (regression guard for H-0700 fix)."""
    _, breakdown = _compute_mandate_fit_score(
        candidate={"manager_aum": 5_000_000},
        preferences={"correlation_ceiling": 0.7},
        corr_with_portfolio=1.0,
        add_weight=0.1,
        mode="personalized",
    )
    assert breakdown["correlation_ceiling"] == 0.0


# ---------------------------------------------------------------------------
# M-0674 — out-of-vocab liquidity_preference must not KeyError
# ---------------------------------------------------------------------------


def test_liquidity_preference_unknown_value_degrades_to_neutral():
    """Allocator pref outside {high,medium,low} → lp_score=1.0 (no KeyError)."""
    score, breakdown = _compute_mandate_fit_score(
        candidate={"manager_aum": 5_000_000},
        preferences={"liquidity_preference": "ultra"},  # not in vocab
        corr_with_portfolio=None,
        add_weight=0.1,
        mode="personalized",
    )
    assert breakdown["liquidity_preference"] == 1.0


# ---------------------------------------------------------------------------
# H-0705 — excluded_strategy_ids must actually filter
# ---------------------------------------------------------------------------


def test_excluded_strategy_ids_filters_candidate():
    """Caller-provided excluded_strategy_ids excludes the candidate with
    `explicitly_excluded` reason — distinct from owned/thumbs_down provenance."""
    result = score_candidates(
        allocator_id="a1",
        preferences=None,
        portfolio_strategies=[],
        portfolio_returns={},
        portfolio_weights={},
        candidate_strategies=[
            _candidate("s1"),
            _candidate("s2"),
            _candidate("s3"),
        ],
        candidate_returns={},
        excluded_strategy_ids={"s2"},
    )
    sids = {c["strategy_id"] for c in result["candidates"]}
    assert "s2" not in sids
    excluded_s2 = [e for e in result["excluded"] if e["strategy_id"] == "s2"]
    assert len(excluded_s2) == 1
    assert excluded_s2[0]["exclusion_reason"] == "explicitly_excluded"


def test_excluded_strategy_ids_is_hard_filter_surviving_relaxation():
    """Even when <5 eligible triggers relaxation, explicitly_excluded sticks."""
    result = score_candidates(
        allocator_id="a1",
        preferences=None,
        portfolio_strategies=[],
        portfolio_returns={},
        portfolio_weights={},
        candidate_strategies=[
            _candidate("only-one"),
            _candidate("explicitly-banned"),
        ],
        candidate_returns={},
        excluded_strategy_ids={"explicitly-banned"},
    )
    sids = {c["strategy_id"] for c in result["candidates"]}
    assert "explicitly-banned" not in sids


# ---------------------------------------------------------------------------
# H-0704 — NaN final_score surfaces `score_error=True`
# ---------------------------------------------------------------------------


def test_score_error_flag_present_on_happy_path():
    """Healthy scoring path emits score_error=False."""
    result = score_candidates(
        allocator_id="a1",
        preferences=None,
        portfolio_strategies=[],
        portfolio_returns={},
        portfolio_weights={},
        candidate_strategies=[_candidate("s1")],
        candidate_returns={},
    )
    assert result["candidates"][0]["score_error"] is False


# ---------------------------------------------------------------------------
# H-0695 — effective_preferences reflects relaxation
# ---------------------------------------------------------------------------


def test_effective_preferences_reflects_relaxation():
    """When relaxation fires, returned effective_preferences uses the relaxed dict."""
    # Make all candidates fail soft filters so relaxation kicks in
    candidates = [
        _candidate(f"s{i}", sharpe=0.1, track_record_days=30)
        for i in range(3)
    ]
    result = score_candidates(
        allocator_id="a1",
        preferences={
            "min_sharpe": 2.0,
            "min_track_record_days": 365,
            "max_drawdown_tolerance": 0.1,
        },
        portfolio_strategies=[],
        portfolio_returns={},
        portfolio_weights={},
        candidate_strategies=candidates,
        candidate_returns={},
    )
    assert result["filter_relaxed"] is True
    assert result["effective_preferences"]["min_sharpe"] == RELAXATION_MIN_SHARPE
    assert result["effective_preferences"]["min_track_record_days"] == RELAXATION_MIN_TRACK_DAYS
    assert result["effective_preferences"]["max_drawdown_tolerance"] == RELAXATION_MAX_DD_TOLERANCE
    # relaxed_overrides documents the deltas explicitly
    assert result["relaxed_overrides"] is not None
    assert result["relaxed_overrides"]["min_sharpe"] == RELAXATION_MIN_SHARPE


def test_effective_preferences_unchanged_without_relaxation():
    """No relaxation → relaxed_overrides is None, effective_preferences == prefs."""
    candidates = [_candidate(f"s{i}") for i in range(10)]  # plenty pass
    result = score_candidates(
        allocator_id="a1",
        preferences={"min_sharpe": 0.5},
        portfolio_strategies=[],
        portfolio_returns={},
        portfolio_weights={},
        candidate_strategies=candidates,
        candidate_returns={},
    )
    assert result["filter_relaxed"] is False
    assert result["relaxed_overrides"] is None
    assert result["effective_preferences"]["min_sharpe"] == 0.5


# ---------------------------------------------------------------------------
# M-0677 — off_mandate_type soft exclusion fires
# ---------------------------------------------------------------------------


def test_off_mandate_type_soft_exclusion_fires():
    """Candidate strategy_type outside preferred_strategy_types → off_mandate_type."""
    cand = _candidate("s1", strategy_type="market_making")
    reason, provenance = _eligibility_check(
        candidate=cand,
        preferences={"preferred_strategy_types": ["trend_following", "mean_reversion"]},
        owned_set=set(),
        thumbs_down_set=set(),
    )
    assert reason == "off_mandate_type"
    assert provenance == "market_making"


def test_off_mandate_type_does_not_fire_when_type_matches():
    cand = _candidate("s1", strategy_type="trend_following")
    reason, _ = _eligibility_check(
        candidate=cand,
        preferences={"preferred_strategy_types": ["trend_following"]},
        owned_set=set(),
        thumbs_down_set=set(),
    )
    assert reason is None


# ---------------------------------------------------------------------------
# M-0678 — strict and hard-only paths agree on exchange normalization
# ---------------------------------------------------------------------------


def test_strict_and_hard_only_agree_on_mixed_case_exchange():
    cand = _candidate("s1", exchange="Binance")
    prefs = {"excluded_exchanges": ["BINANCE"]}
    strict_reason, _ = _eligibility_check(
        candidate=cand,
        preferences=prefs,
        owned_set=set(),
        thumbs_down_set=set(),
    )
    hard_reason, _ = _eligibility_check_hard_only(
        candidate=cand,
        preferences=prefs,
        owned_set=set(),
        thumbs_down_set=set(),
    )
    assert strict_reason == "excluded_exchange"
    assert hard_reason == "excluded_exchange"


def test_strict_and_hard_only_agree_on_none_in_excluded_list():
    """A None leaking into excluded_exchanges (legacy data) must not crash
    EITHER path AND must not produce divergent exclusion decisions."""
    cand = _candidate("s1", exchange="binance")
    prefs = {"excluded_exchanges": [None, "binance"]}
    strict_reason, _ = _eligibility_check(
        candidate=cand,
        preferences=prefs,
        owned_set=set(),
        thumbs_down_set=set(),
    )
    hard_reason, _ = _eligibility_check_hard_only(
        candidate=cand,
        preferences=prefs,
        owned_set=set(),
        thumbs_down_set=set(),
    )
    assert strict_reason == "excluded_exchange"
    assert hard_reason == "excluded_exchange"


# ---------------------------------------------------------------------------
# M-0679 — relaxation magic numbers are named constants
# ---------------------------------------------------------------------------


def test_relaxation_constants_have_expected_values():
    """Lock the relaxation policy: <5 eligible triggers, drops to 0 sharpe /
    90 days / 1.0 DD tolerance. Changing any constant requires updating BOTH
    this assertion and any external runbook documenting allocator semantics."""
    assert RELAXATION_MIN_CANDIDATES == 5
    assert RELAXATION_MIN_SHARPE == 0.0
    assert RELAXATION_MIN_TRACK_DAYS == 90
    assert RELAXATION_MAX_DD_TOLERANCE == 1.0


# ---------------------------------------------------------------------------
# M-0676 — _top_excluded ordering by closeness-to-passing
# ---------------------------------------------------------------------------


def test_top_excluded_sorts_soft_failures_by_closeness_to_passing():
    """Two candidates fail min_sharpe: one with sharpe=0.9 (close), one with
    sharpe=0.1 (far). The closer one must sort FIRST in _top_excluded."""
    near_miss = {
        "strategy_id": "near",
        "exclusion_reason": "below_min_sharpe",
        "exclusion_provenance": "0.90",
        "candidate": _candidate("near", sharpe=0.9),
    }
    far_miss = {
        "strategy_id": "far",
        "exclusion_reason": "below_min_sharpe",
        "exclusion_provenance": "0.10",
        "candidate": _candidate("far", sharpe=0.1),
    }
    sorted_ = _top_excluded([far_miss, near_miss], {"min_sharpe": 1.0})
    assert [item["strategy_id"] for item in sorted_] == ["near", "far"]


def test_top_excluded_sorts_hard_exclusions_to_bottom():
    """Hard exclusions (owned/thumbs_down) sort below soft-failure rows."""
    soft = {
        "strategy_id": "soft",
        "exclusion_reason": "below_min_sharpe",
        "exclusion_provenance": "0.9",
        "candidate": _candidate("soft", sharpe=0.9),
    }
    hard = {
        "strategy_id": "hard",
        "exclusion_reason": "owned",
        "exclusion_provenance": "portfolio",
        "candidate": _candidate("hard"),
    }
    sorted_ = _top_excluded([hard, soft], {"min_sharpe": 1.0})
    assert sorted_[0]["strategy_id"] == "soft"
    assert sorted_[-1]["strategy_id"] == "hard"


# ---------------------------------------------------------------------------
# C-0230 / H-0699 — overrides renormalization guard survives `python -O`
# ---------------------------------------------------------------------------


def test_renormalization_guard_is_not_a_bare_assert():
    """Source-level: the renormalization site uses `raise ValueError`, not
    `assert`. A bare assert is stripped under `python -O` and would let the
    next-line divide-by-zero produce silent NaN scores. Bytecode-level test
    is overkill — source pattern is the contract."""
    import inspect

    import services.match_engine as me

    src = inspect.getsource(me.score_candidates)
    # The renormalization site must NOT contain a bare assert on `total`.
    assert "assert total" not in src, (
        "Bare assert detected — Python -O strips it. "
        "Use explicit `if total <= 0: raise ValueError(...)`."
    )
    # And the explicit guard must be present.
    assert "if total <= 0" in src or "if total <= 0:" in src
