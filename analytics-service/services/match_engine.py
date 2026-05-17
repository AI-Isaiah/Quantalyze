"""Perfect Match Engine — scores quant strategies for each allocator.

Founder-amplifier model (see docs/superpowers/plans/2026-04-07-perfect-match-engine.md):
this module produces a ranked candidate list that ONLY the founder admin sees in
/admin/match. Allocators never see the score directly — the founder picks 3 candidates
per allocator and ships them via the existing intro flow.

Key design decisions baked in from the dual-voice eng review:
- Hard vs soft eligibility split: hard exclusions (owned, thumbs_down, excluded_exchange)
  are NEVER relaxed; soft exclusions (sharpe, track, dd) get relaxed when <5 candidates.
- add_weight derived from target_ticket_size_usd / portfolio_aum, not hardcoded 0.10.
- corr_with_portfolio returns None (not 0.0) when overlap is insufficient.
- Single-element candidate set falls back to absolute scoring (no NaN from min-max).
- Helpers imported via alias from portfolio_optimizer (no extraction risk).
- Two modes: 'personalized' (uses portfolio_fit) and 'screening' (cold-start, no portfolio).
- Deterministic: same inputs → identical output (modulo dict ordering).

The function signature matches the plan's Task 4. See tests/test_match_engine*.py
(test_match_engine.py for the original suite, test_match_engine_service.py for
the cluster-N regression suite added in audit-2026-05-07).
"""

import json
import logging
import math
from enum import Enum
from typing import Any, Literal, Optional, TypedDict

import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


# Mode identifier — typed at every signature so a typo (`'personlized'`) is
# a mypy error rather than a silent fall-through to the screening branch.
# DB column has CHECK (mode IN ('personalized', 'screening')) at
# supabase/migrations/011_perfect_match.sql:3082 — the two must agree.
Mode = Literal["personalized", "screening"]


class ExclusionReason(str, Enum):
    """Single source of truth for the exclusion-reason vocabulary.

    Mirrors `migration 011`'s SQL CHECK constraint on `match_candidates.
    exclusion_reason`. Inherits from `str` so existing JSONB persistence and
    `result['excluded'][i]['exclusion_reason']` string comparisons continue
    to work unchanged. New values added here MUST also be added to the SQL
    CHECK in a follow-up migration before any caller persists them.
    """

    OWNED = "owned"
    THUMBS_DOWN = "thumbs_down"
    EXCLUDED_EXCHANGE = "excluded_exchange"
    BELOW_MIN_SHARPE = "below_min_sharpe"
    BELOW_MIN_TRACK_RECORD = "below_min_track_record"
    EXCEEDS_MAX_DD = "exceeds_max_dd"
    OFF_MANDATE_TYPE = "off_mandate_type"
    STYLE_EXCLUDED = "style_excluded"
    # H-0705: explicit-exclusion-list reason — caller passed
    # `excluded_strategy_ids` (e.g. previously-served candidates) that
    # should hard-skip without conflating with `owned` or `thumbs_down`.
    # NOTE: only produced when callers pass `excluded_strategy_ids`;
    # `routers/match.py` does NOT pass it today, so the SQL CHECK never
    # sees this value in persisted rows. Adding it to the CHECK
    # constraint is a pre-req for any caller that wants to persist.
    EXPLICITLY_EXCLUDED = "explicitly_excluded"

    @property
    def is_hard(self) -> bool:
        # NOTE: _HARD_REASONS is defined BELOW this class. Safe only because
        # `is_hard` is a runtime property — the name is resolved at call
        # time, not at class-definition time. Do NOT introduce any code in
        # this class body (e.g. a default argument referencing _HARD_REASONS)
        # that would force resolution before _HARD_REASONS exists, or rely
        # on this property at class build.
        return self in _HARD_REASONS


# NOTE: _HARD_REASONS MUST stay defined after `ExclusionReason` — moving it
# above the class causes a NameError because the frozenset values reference
# `ExclusionReason.OWNED` etc. (the enum members do not exist until the
# class statement completes). The forward-reference pattern is documented
# on the `is_hard` property above.
_HARD_REASONS: frozenset["ExclusionReason"] = frozenset({
    ExclusionReason.OWNED,
    ExclusionReason.THUMBS_DOWN,
    ExclusionReason.EXCLUDED_EXCHANGE,
    ExclusionReason.EXPLICITLY_EXCLUDED,
})


# H-0698 / H-0702 fix: schema for the score_candidates return value. TypedDict
# (not BaseModel) keeps zero runtime cost — the existing JSONB persistence
# path consumes plain dicts — while giving mypy/IDE static checks for every
# downstream `result["candidates"]`, `result["mode"]`, etc. read site. Add
# new keys here ONLY in lockstep with persistence (`routers/match.py`) and
# any SQL CHECK constraint on `match_batches`.


class ScoredCandidate(TypedDict, total=False):
    strategy_id: str
    score: float
    score_error: bool
    rank: int
    score_breakdown: dict[str, Any]
    reasons: list[str]


class ExcludedCandidate(TypedDict, total=False):
    strategy_id: str
    exclusion_reason: str
    exclusion_provenance: Optional[str]


class ScoreCandidatesResult(TypedDict, total=False):
    mode: Mode
    filter_relaxed: bool
    engine_version: str
    weights_version: str
    effective_preferences: dict[str, Any]
    relaxed_overrides: Optional[dict[str, Any]]
    effective_thresholds: dict[str, Any]
    candidates: list[ScoredCandidate]
    excluded: list[ExcludedCandidate]
    excluded_total: int
    source_strategy_count: int

# Import existing private helpers without extracting them. Aliased for the file
# so the regression test can import them from this module too.
from services.portfolio_optimizer import (
    _avg_corr,
    _compute_sharpe,
    _max_drawdown,
)
from services.match_defaults import merge_with_defaults

# Public re-exports so callers can import from either location.
compute_sharpe = _compute_sharpe
avg_corr = _avg_corr
max_drawdown = _max_drawdown


# Versioning for the engine + weight set. Bump on any change to the scoring math
# so historical batches are reproducible / debuggable. Phase 3 bumped both to
# v2.0.0 in lockstep — SCORING-01. Phase 09 (D-17) bumps ENGINE_VERSION to
# v2.1.0 because the INPUT LAYER changed (holdings-sourced pseudo-strategies
# now feed score_candidates) — _should_skip_allocator trigger #2 auto-invalidates
# cached v2.0.0 batches on first post-ship cron run. WEIGHTS_VERSION stays
# v2.0.0 (weight composition identical; only input layer changed).
ENGINE_VERSION = "v2.1.0"
WEIGHTS_VERSION = "v2.0.0"

# Top-N candidates returned per batch
TOP_N_CANDIDATES = 30
# Cap on excluded rows persisted (closest-to-threshold first)
TOP_N_EXCLUDED = 50

# M-0679 fix: pull relaxation magic numbers out so the values 90, 1.0, and
# the <5 threshold are named once and only updated once. Tests can import
# these to assert against an actual constant instead of re-typing 90.
RELAXATION_MIN_CANDIDATES = 5
RELAXATION_MIN_TRACK_DAYS = 90
RELAXATION_MAX_DD_TOLERANCE = 1.0
RELAXATION_MIN_SHARPE = 0.0

# Weights for the personalized score
W_PORTFOLIO_FIT = 0.40
W_PREFERENCE_FIT = 0.30
W_TRACK_RECORD = 0.15
W_CAPACITY_FIT = 0.15

# Weights for the screening (cold-start) score
W_SCREENING_PREFERENCE_FIT = 0.60
W_SCREENING_TRACK_RECORD = 0.25
W_SCREENING_CAPACITY_FIT = 0.15

# Sub-weights inside portfolio_fit
W_SHARPE_LIFT = 0.50
W_CORR_REDUCTION = 0.30
W_DD_IMPROVEMENT = 0.20


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _safe_float(value: Any) -> Optional[float]:
    """Float conversion that returns None for NaN/Inf. Same shape as services.metrics."""
    try:
        f = float(value)
        if math.isnan(f) or math.isinf(f):
            return None
        return f
    except (TypeError, ValueError):
        return None


def _clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))


def _normalize_min_max(values: list[Optional[float]]) -> list[float]:
    """Min-max normalize a list to [0, 1]. Handles single-element and all-None edge cases.

    - None values become 0.0 in the output (no contribution to score).
    - If only one finite value, clamp it to [0, 1] directly (don't just hand out
      a 1.0 sky-high normalized score for a single negative value — that would
      reward a candidate that actively hurts the portfolio).
    - If all values are equal, returns 0.5 for all (no signal).
    """
    finite = [v for v in values if v is not None]
    if not finite:
        return [0.0] * len(values)
    if len(finite) == 1:
        return [_clamp(v, 0.0, 1.0) if v is not None else 0.0 for v in values]
    lo = min(finite)
    hi = max(finite)
    if hi == lo:
        return [0.5 if v is not None else 0.0 for v in values]
    span = hi - lo
    return [(v - lo) / span if v is not None else 0.0 for v in values]


def _compute_corr_with_portfolio(
    portfolio_returns: pd.Series,
    candidate_returns: pd.Series,
    min_overlap_days: int = 10,
) -> Optional[float]:
    """Returns the correlation of a candidate to the weighted portfolio returns.

    Returns None if the overlap is shorter than min_overlap_days. The previous
    behavior in find_improvement_candidates was to return 0.0 for short overlap,
    which silently misled the reason generator. None is the honest signal.
    """
    if portfolio_returns.empty or candidate_returns.empty:
        return None
    aligned = pd.concat(
        [portfolio_returns.rename("port"), candidate_returns.rename("cand")],
        axis=1,
    ).dropna()
    if len(aligned) < min_overlap_days:
        return None
    corr = aligned["port"].corr(aligned["cand"])
    return _safe_float(corr)


# ---------------------------------------------------------------------------
# Eligibility (hard + soft split)
# ---------------------------------------------------------------------------


# Public string-set views of the enum for backward-compat with code that
# still imports the old constants (e.g. `if reason in HARD_EXCLUSION_REASONS`).
HARD_EXCLUSION_REASONS: frozenset[str] = frozenset(r.value for r in _HARD_REASONS)
SOFT_EXCLUSION_REASONS: frozenset[str] = frozenset(
    r.value for r in ExclusionReason if r not in _HARD_REASONS
)


def _excluded_exchanges_lower(preferences: dict[str, Any]) -> set[str]:
    """Single source of truth for excluded-exchanges case normalization.

    M-0678 fix: previously the strict path used `{e.lower() for e in ...}` while
    the hard-only path used `{(e or '').lower() for e in ...}` — an asymmetric
    None-defensiveness that could make the same candidate pass strict but fail
    relaxed (or vice versa) if a None ever leaked into the list. Normalize once,
    same defensiveness in both paths.
    """
    return {(e or "").lower() for e in (preferences.get("excluded_exchanges") or [])}


def _eligibility_check_hard_inner(
    candidate: dict[str, Any],
    preferences: dict[str, Any],
    owned_set: set[str],
    thumbs_down_set: set[str],
    explicitly_excluded_set: set[str],
) -> tuple[Optional[ExclusionReason], Optional[str]]:
    """Shared hard-only eligibility check. Returns (reason_enum, provenance) or (None, None)."""
    sid = candidate["strategy_id"]
    if sid in owned_set:
        return (ExclusionReason.OWNED, "portfolio")
    if sid in thumbs_down_set:
        return (ExclusionReason.THUMBS_DOWN, "match_decision")
    # H-0705 fix: explicit exclusion set is honored as a hard filter so callers
    # can pass previously-served candidates or other ban-lists.
    if sid in explicitly_excluded_set:
        return (ExclusionReason.EXPLICITLY_EXCLUDED, "caller")
    excluded_exchanges_lower = _excluded_exchanges_lower(preferences)
    cand_exchange = (candidate.get("exchange") or "").lower()
    if cand_exchange and cand_exchange in excluded_exchanges_lower:
        return (ExclusionReason.EXCLUDED_EXCHANGE, cand_exchange)
    return (None, None)


def _eligibility_check(
    candidate: dict[str, Any],
    preferences: dict[str, Any],
    owned_set: set[str],
    thumbs_down_set: set[str],
    explicitly_excluded_set: Optional[set[str]] = None,
) -> tuple[Optional[str], Optional[str]]:
    """Run eligibility checks. Returns (exclusion_reason, exclusion_provenance) or (None, None).

    Hard exclusions are checked first. Soft exclusions only run if no hard exclusion fired.
    The returned reason is the string form for direct JSONB persistence.
    """
    if explicitly_excluded_set is None:
        explicitly_excluded_set = set()
    hard_reason, hard_provenance = _eligibility_check_hard_inner(
        candidate, preferences, owned_set, thumbs_down_set, explicitly_excluded_set,
    )
    if hard_reason is not None:
        return (hard_reason.value, hard_provenance)

    # Soft exclusions
    sharpe = candidate.get("sharpe")
    if sharpe is not None and preferences.get("min_sharpe") is not None:
        if sharpe < preferences["min_sharpe"]:
            return (ExclusionReason.BELOW_MIN_SHARPE.value, f"{sharpe:.2f}")

    track_days = candidate.get("track_record_days") or 0
    if preferences.get("min_track_record_days") is not None:
        if track_days < preferences["min_track_record_days"]:
            return (ExclusionReason.BELOW_MIN_TRACK_RECORD.value, str(track_days))

    max_dd = candidate.get("max_drawdown_pct")
    if max_dd is not None and preferences.get("max_drawdown_tolerance") is not None:
        if abs(max_dd) > preferences["max_drawdown_tolerance"]:
            return (ExclusionReason.EXCEEDS_MAX_DD.value, f"{abs(max_dd):.2f}")

    pref_types = preferences.get("preferred_strategy_types") or []
    if pref_types:
        cand_type = candidate.get("strategy_type")
        if cand_type and cand_type not in pref_types:
            return (ExclusionReason.OFF_MANDATE_TYPE.value, cand_type)

    # Phase 3 / D-06: style_exclusions SOFT exclude. Candidate's subtype
    # (populated from strategies.subtypes[0] in routers/match.py per Phase 3
    # Plan 03-02) is compared against the allocator's SUBTYPES list. SOFT
    # because <5-eligible relaxation drops it — preserves "show SOMETHING"
    # invariant on sparse universes without breaking full-universe exclusions.
    style_exclusions = preferences.get("style_exclusions") or []
    if style_exclusions:
        cand_subtype = candidate.get("subtype")
        if cand_subtype and cand_subtype in style_exclusions:
            return (ExclusionReason.STYLE_EXCLUDED.value, cand_subtype)

    return (None, None)


def _eligibility_check_hard_only(
    candidate: dict[str, Any],
    preferences: dict[str, Any],
    owned_set: set[str],
    thumbs_down_set: set[str],
    explicitly_excluded_set: Optional[set[str]] = None,
) -> tuple[Optional[str], Optional[str]]:
    """Same as _eligibility_check but only the hard rules. Used during relaxation."""
    if explicitly_excluded_set is None:
        explicitly_excluded_set = set()
    hard_reason, hard_provenance = _eligibility_check_hard_inner(
        candidate, preferences, owned_set, thumbs_down_set, explicitly_excluded_set,
    )
    if hard_reason is None:
        return (None, None)
    return (hard_reason.value, hard_provenance)


# ---------------------------------------------------------------------------
# Sub-scores
# ---------------------------------------------------------------------------


def _compute_preference_fit(
    candidate: dict[str, Any],
    preferences: dict[str, Any],
) -> float:
    """Three sub-components averaged: sharpe headroom, track-record headroom, DD headroom."""
    sub_scores = []

    sharpe = candidate.get("sharpe")
    min_sharpe = preferences.get("min_sharpe") or 0.0
    if sharpe is not None:
        # Headroom above the floor, scaled by the floor itself (with a small
        # lower bound so floor=0 still produces meaningful scores).
        # Smooth across min_sharpe — no kink at min_sharpe=1.0.
        cap = max(min_sharpe, 0.5) * 2
        if cap > 0:
            sub_scores.append(_clamp((sharpe - min_sharpe) / cap, 0, 1))

    track = candidate.get("track_record_days") or 0
    min_track = preferences.get("min_track_record_days") or 1
    if min_track > 0:
        sub_scores.append(_clamp((track - min_track) / min_track, 0, 1))

    max_dd = candidate.get("max_drawdown_pct")
    max_dd_tol = preferences.get("max_drawdown_tolerance")
    if max_dd is not None and max_dd_tol is not None and max_dd_tol > 0:
        sub_scores.append(_clamp(1 - (abs(max_dd) / max_dd_tol), 0, 1))

    if not sub_scores:
        return 0.5
    return sum(sub_scores) / len(sub_scores)


# ---------------------------------------------------------------------------
# Phase 3 / D-01: mandate_fit_score — AVERAGE of four per-dimension
# contributions (max_weight, correlation_ceiling, liquidity_preference,
# style_exclusions). Each contribution ∈ [0, 1]. Empty mandates → each
# dimension returns 1.0 → mandate_fit_score = 1.0 (SCORING-04 graceful
# degradation). style_exclusions does NOT contribute numerically —
# excluded candidates never reach this helper (SOFT exclusion drops them
# before scoring). The dimension reports True for the `_honored` flag
# purely for debuggability.
# ---------------------------------------------------------------------------

# Liquidity tier thresholds (D-05). Allocator tier order for gap math:
# high > medium > low. Gap = allocator_rank - candidate_rank; penalize only
# when candidate tier is LOWER than allocator's (more liquid is strictly
# better, per D-05 gap direction).
_LIQUIDITY_TIER_RANK = {"low": 0, "medium": 1, "high": 2}


def _liquidity_tier_from_aum(manager_aum: Optional[float]) -> Optional[str]:
    """Map candidate manager_aum → tier string or None when unknown/zero.
    Thresholds per D-05: >=$10M high, >=$1M medium, >0 low, else None.
    """
    if manager_aum is None or manager_aum <= 0:
        return None
    if manager_aum >= 10_000_000:
        return "high"
    if manager_aum >= 1_000_000:
        return "medium"
    return "low"


def _compute_mandate_fit_score(
    candidate: dict[str, Any],
    preferences: dict[str, Any],
    corr_with_portfolio: Optional[float],
    add_weight: float,
    mode: Mode,
) -> tuple[float, dict[str, Any]]:
    """Four per-dimension contributions averaged. Returns (score, breakdown).

    breakdown keys: max_weight, correlation_ceiling, liquidity_preference,
    style_exclusions_honored (always True for scored rows). D-01..D-05.
    """
    # Dimension 1 — max_weight linear taper (D-03). add_weight is clamped to
    # [0.01, 0.5] in score_candidates for personalized mode; screening mode
    # defaults to 0.10. Taper reaches 0 at 2× ceiling.
    max_w = preferences.get("max_weight")
    if max_w is None:
        mw_score = 1.0
    elif add_weight <= max_w:
        mw_score = 1.0
    else:
        mw_score = max(0.0, 1 - (add_weight - max_w) / max_w)

    # Dimension 2 — correlation_ceiling smooth degradation (D-04). Reuses
    # the corr_with_portfolio scalar already produced by
    # _compute_portfolio_fit_components. Neutral 1.0 when ceiling is NULL,
    # corr is None (sparse overlap — don't penalize data sparseness), or
    # in screening mode (no portfolio to correlate against).
    ceiling = preferences.get("correlation_ceiling")
    if ceiling is None or corr_with_portfolio is None or mode == "screening":
        cc_score = 1.0
    # H-0700 fix: ceiling == 1.0 semantically means "no correlation cap"
    # (the UI clamp permits 0..1 inclusive; 1.0 is the no-penalty endpoint).
    # The old branch returned 0.0 on any micro-jitter above 1.0 from
    # near-perfect correlation series — silently collapsing mandate_fit
    # for allocators who legitimately said "no cap". Treat ceiling >= 1.0
    # as "no penalty regardless of corr value".
    elif ceiling >= 1.0:
        cc_score = 1.0
    elif corr_with_portfolio <= ceiling:
        cc_score = 1.0
    else:
        denom = 1.0 - ceiling
        # denom > 0 holds by the elif chain above (ceiling < 1.0 here).
        cc_score = max(0.0, 1 - (corr_with_portfolio - ceiling) / denom)

    # Dimension 3 — liquidity_preference tier-gap (D-05). Gap direction
    # matters: allocator wants high and gets low → penalty; allocator wants
    # low and gets high → 1.0 (more liquid is strictly better).
    allocator_pref = preferences.get("liquidity_preference")
    if allocator_pref is None:
        lp_score = 1.0
    else:
        cand_tier = _liquidity_tier_from_aum(candidate.get("manager_aum"))
        # M-0674 fix: dict lookup is .get() so an out-of-vocab allocator_pref
        # (legacy/corrupted row that somehow bypassed the SQL CHECK) returns
        # None and we degrade to neutral 1.0 instead of KeyError-crashing
        # the whole batch.
        a_rank = _LIQUIDITY_TIER_RANK.get(allocator_pref)
        c_rank = _LIQUIDITY_TIER_RANK.get(cand_tier) if cand_tier else None
        if a_rank is None or c_rank is None:
            lp_score = 1.0
        else:
            gap = a_rank - c_rank  # positive only when candidate is LOWER
            if gap <= 0:
                lp_score = 1.0
            elif gap == 1:
                lp_score = 0.5
            else:
                lp_score = 0.0

    # Dimension 4 — style_exclusions_honored: always 1.0 for scored rows
    # (excluded rows don't reach this helper; see SOFT_EXCLUSION_REASONS).
    se_score = 1.0

    contribs = [mw_score, cc_score, lp_score, se_score]
    score = sum(contribs) / len(contribs)

    breakdown: dict[str, Any] = {
        "max_weight": mw_score,
        "correlation_ceiling": cc_score,
        "liquidity_preference": lp_score,
        "style_exclusions_honored": True,
    }
    return (score, breakdown)


def _compute_track_record_score(candidate: dict[str, Any]) -> float:
    """min(1, track_record_days / 730) — 2 years = full credit."""
    track = candidate.get("track_record_days") or 0
    return min(1.0, track / 730)


def _compute_capacity_fit(
    candidate: dict[str, Any],
    preferences: dict[str, Any],
) -> float:
    """Concentration headroom. 0 = saturated, 1 = plenty of room."""
    manager_aum = candidate.get("manager_aum")
    ticket_size = preferences.get("target_ticket_size_usd")
    max_concentration = preferences.get("max_aum_concentration") or 0.20

    # Unknown manager AUM → neutral
    if not manager_aum or manager_aum <= 0:
        return 0.5
    if not ticket_size or ticket_size <= 0:
        return 0.5

    concentration = ticket_size / manager_aum
    if concentration > max_concentration:
        return 0.0
    return _clamp(1 - (concentration / max_concentration), 0, 1)


def _empty_pf_components() -> dict[str, Optional[float]]:
    """Single source of truth for the empty portfolio_fit components dict.

    Returns a fresh dict on each call so callers can mutate without aliasing.
    Adding a new portfolio_fit sidecar field (e.g. M-0675 data_completeness)
    requires ONE edit here — previously four sites needed lockstep updates.
    """
    return {
        "sharpe_lift": None,
        "corr_reduction": None,
        "dd_improvement": None,
        "corr_with_portfolio": None,
        "data_completeness": None,
    }


def _compute_portfolio_fit_components(
    portfolio_returns_series: pd.Series,
    portfolio_weights: dict[str, float],
    portfolio_strategies_returns: dict[str, pd.Series],
    candidate_returns: pd.Series,
    add_weight: float,
) -> dict[str, Optional[float]]:
    """Compute sharpe_lift, corr_reduction, dd_improvement, corr_with_portfolio.

    All four can be None if the data is too sparse to compute meaningfully.
    """
    if portfolio_returns_series.empty or candidate_returns.empty:
        return _empty_pf_components()

    # Align candidate to portfolio dates
    port_df = pd.DataFrame(portfolio_strategies_returns).dropna()
    if port_df.empty:
        return _empty_pf_components()

    w_arr = np.array([portfolio_weights.get(sid, 0) for sid in port_df.columns])
    if w_arr.sum() > 0:
        w_arr = w_arr / w_arr.sum()
    current_port = (port_df * w_arr).sum(axis=1)
    current_sharpe = _compute_sharpe(current_port)
    current_avg_corr = _avg_corr(port_df)
    current_max_dd = _max_drawdown(current_port)

    # New portfolio = old × (1 - add_weight) + candidate × add_weight
    aligned = pd.concat([port_df, candidate_returns.rename("__cand__")], axis=1).dropna()
    if len(aligned) < 30:
        portfolio_count = max(len(portfolio_weights), 1)
        data_completeness_short = len(port_df.columns) / portfolio_count
        components = _empty_pf_components()
        components["corr_with_portfolio"] = _compute_corr_with_portfolio(
            current_port, candidate_returns,
        )
        components["data_completeness"] = _safe_float(data_completeness_short)
        return components

    new_weights = {sid: w * (1 - add_weight) for sid, w in portfolio_weights.items()}
    new_weights["__cand__"] = add_weight
    w_new = np.array([new_weights.get(col, 0) for col in aligned.columns])
    if w_new.sum() > 0:
        w_new = w_new / w_new.sum()

    new_port = (aligned * w_new).sum(axis=1)
    new_sharpe = _compute_sharpe(new_port)
    new_avg_corr = _avg_corr(aligned)
    new_max_dd = _max_drawdown(new_port)

    sharpe_lift = (
        new_sharpe - current_sharpe
        if current_sharpe is not None and new_sharpe is not None
        else None
    )
    corr_reduction = (
        current_avg_corr - new_avg_corr
        if current_avg_corr is not None and new_avg_corr is not None
        else None
    )
    dd_improvement = (
        current_max_dd - new_max_dd
        if current_max_dd is not None and new_max_dd is not None
        else None
    )

    corr_with_portfolio = _compute_corr_with_portfolio(current_port, candidate_returns)

    # M-0675 fix: surface a `data_completeness` sidecar — the ratio of
    # portfolio strategies that survived the returns-dropna join — so callers
    # can warn (e.g. "scored against 3 of 5 holdings; 2 lack returns") rather
    # than blindly trusting a portfolio-fit score computed on a subset of
    # the book. Apples-to-apples is preserved (both current_port and new_port
    # use only columns present in port_df / aligned), but transparency is
    # cheap and stops the silent-subset failure mode the audit flagged.
    portfolio_count = max(len(portfolio_weights), 1)
    data_completeness = len(port_df.columns) / portfolio_count

    return {
        "sharpe_lift": _safe_float(sharpe_lift),
        "corr_reduction": _safe_float(corr_reduction),
        "dd_improvement": _safe_float(dd_improvement),
        "corr_with_portfolio": corr_with_portfolio,
        "data_completeness": _safe_float(data_completeness),
    }


# ---------------------------------------------------------------------------
# Reason generation
# ---------------------------------------------------------------------------


def _generate_reasons(
    candidate: dict[str, Any],
    preferences: dict[str, Any],
    score_breakdown: dict[str, Any],
    mode: Mode,
) -> list[str]:
    """Pick the top 3 most-relevant reasons for this candidate."""
    raw = score_breakdown["raw"]
    candidates: list[tuple[float, str]] = []  # (priority, text)

    corr = raw.get("corr_with_portfolio")
    if mode == "personalized" and corr is not None and corr < 0.2:
        candidates.append((0.95, f"Diversifies the book (correlation {corr:+.2f} with existing strategies)"))

    sharpe_lift = raw.get("sharpe_lift")
    if mode == "personalized" and sharpe_lift is not None and sharpe_lift > 0.1:
        candidates.append((0.90, f"Lifts portfolio Sharpe by {sharpe_lift:+.2f}"))

    track = candidate.get("track_record_days") or 0
    if track > 730:
        years = track / 365
        candidates.append((0.80, f"Long track record ({years:.1f} years)"))
    elif preferences.get("min_track_record_days") and track > preferences["min_track_record_days"] * 1.5:
        candidates.append((0.70, "Comfortably above the minimum track record we screen for"))

    raw_concentration = raw.get("ticket_concentration")
    if raw_concentration is not None and raw_concentration < 0.05:
        candidates.append((0.65, "Capacity headroom for the ticket size"))

    pref_types = preferences.get("preferred_strategy_types") or []
    if pref_types and candidate.get("strategy_type") in pref_types:
        candidates.append((0.60, f"Matches the {candidate['strategy_type']} mandate"))

    if (
        mode == "screening"
        and track > 365
        and (candidate.get("sharpe") or 0) > 1.5
    ):
        candidates.append((0.85, "High-conviction screening pick"))

    sharpe = candidate.get("sharpe")
    if sharpe is not None and sharpe > 2.0:
        candidates.append((0.55, f"Strong risk-adjusted return (Sharpe {sharpe:.1f})"))

    max_dd = candidate.get("max_drawdown_pct")
    if max_dd is not None and abs(max_dd) < 0.10:
        candidates.append((0.50, f"Shallow drawdown profile (max DD {abs(max_dd) * 100:.1f}%)"))

    # Sort by priority desc, take top 3
    candidates.sort(key=lambda c: c[0], reverse=True)
    return [c[1] for c in candidates[:3]]


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


def score_candidates(
    allocator_id: str,
    preferences: Optional[dict[str, Any]],
    portfolio_strategies: list[dict[str, Any]],
    portfolio_returns: dict[str, pd.Series],
    portfolio_weights: dict[str, float],
    candidate_strategies: list[dict[str, Any]],
    candidate_returns: dict[str, pd.Series],
    excluded_strategy_ids: Optional[set[str]] = None,
    thumbs_down_ids: Optional[set[str]] = None,
    portfolio_aum: Optional[float] = None,
) -> ScoreCandidatesResult:
    """Score every candidate strategy for an allocator. See module docstring.

    Returns a dict with shape (the canonical TypedDict is ScoreCandidatesResult):
    {
      "mode": "personalized" | "screening",
      "filter_relaxed": bool,
      "engine_version": str,
      "weights_version": str,
      "effective_preferences": dict,   # H-0695: reflects relaxed dict when relaxation fires
      "relaxed_overrides": dict | None,# H-0695: deltas applied; None when no relaxation
      "effective_thresholds": dict,
      "candidates": [
        {
          strategy_id, score, rank, score_breakdown, reasons,
          "score_error": bool,         # H-0704: True when math produced NaN/Inf
        },
        ...,
      ],
      "excluded": [{strategy_id, exclusion_reason, exclusion_provenance}, ...],
      "excluded_total": int,            # Full pre-_top_excluded count
      "source_strategy_count": int,     # Size of input candidate_strategies
    }
    """
    prefs = merge_with_defaults(preferences or {})
    owned_set: set[str] = {ps["strategy_id"] for ps in portfolio_strategies}
    if excluded_strategy_ids is None:
        excluded_strategy_ids = set()
    if thumbs_down_ids is None:
        thumbs_down_ids = set()

    # Mode selection
    mode: Mode = "personalized" if portfolio_strategies else "screening"

    # Pass 1: full eligibility (hard + soft)
    eligible: list[dict[str, Any]] = []
    excluded: list[dict[str, Any]] = []
    for cand in candidate_strategies:
        reason, provenance = _eligibility_check(
            cand, prefs, owned_set, thumbs_down_ids, excluded_strategy_ids,
        )
        if reason is None:
            eligible.append(cand)
        else:
            excluded.append({
                "strategy_id": cand["strategy_id"],
                "exclusion_reason": reason,
                "exclusion_provenance": provenance,
                "candidate": cand,  # Keep raw for "almost-passed" sort later
            })

    filter_relaxed = False
    # active_prefs is the dict actually used downstream for scoring + reasons.
    # H-0695 fix: prior code returned `effective_preferences: prefs` even after
    # relaxation, so the JSONB audit row lied about the inputs. Now we track
    # the relaxed dict and return THAT in effective_preferences when relaxation
    # fires, plus an explicit `relaxed_overrides` field documenting the deltas.
    active_prefs = prefs
    relaxed_overrides: Optional[dict[str, Any]] = None
    effective_thresholds: dict[str, Any] = {
        "min_sharpe": prefs.get("min_sharpe"),
        "min_track_record_days": prefs.get("min_track_record_days"),
        "max_drawdown_tolerance": prefs.get("max_drawdown_tolerance"),
    }

    # Relaxation: if <RELAXATION_MIN_CANDIDATES eligible, drop soft exclusions and re-filter
    if len(eligible) < RELAXATION_MIN_CANDIDATES:
        filter_relaxed = True
        relaxed_prefs = dict(prefs)
        relaxed_prefs["min_sharpe"] = RELAXATION_MIN_SHARPE
        relaxed_prefs["min_track_record_days"] = RELAXATION_MIN_TRACK_DAYS
        relaxed_prefs["max_drawdown_tolerance"] = RELAXATION_MAX_DD_TOLERANCE
        relaxed_prefs["preferred_strategy_types"] = []  # Drop type restriction too
        relaxed_overrides = {
            "min_sharpe": RELAXATION_MIN_SHARPE,
            "min_track_record_days": RELAXATION_MIN_TRACK_DAYS,
            "max_drawdown_tolerance": RELAXATION_MAX_DD_TOLERANCE,
            "preferred_strategy_types": [],
        }
        active_prefs = relaxed_prefs

        eligible = []
        excluded = []
        for cand in candidate_strategies:
            reason, provenance = _eligibility_check_hard_only(
                cand, relaxed_prefs, owned_set, thumbs_down_ids, excluded_strategy_ids,
            )
            if reason is None:
                eligible.append(cand)
            else:
                excluded.append({
                    "strategy_id": cand["strategy_id"],
                    "exclusion_reason": reason,
                    "exclusion_provenance": provenance,
                    "candidate": cand,
                })
        effective_thresholds = {
            "min_sharpe": RELAXATION_MIN_SHARPE,
            "min_track_record_days": RELAXATION_MIN_TRACK_DAYS,
            "max_drawdown_tolerance": RELAXATION_MAX_DD_TOLERANCE,
            "filter_relaxed": True,
        }
        logger.info(
            "match_engine: relaxation engaged for allocator=%s — "
            "min_sharpe %s→%s, min_track_days %s→%s, max_dd_tol %s→%s, "
            "preferred_strategy_types dropped",
            allocator_id,
            prefs.get("min_sharpe"), RELAXATION_MIN_SHARPE,
            prefs.get("min_track_record_days"), RELAXATION_MIN_TRACK_DAYS,
            prefs.get("max_drawdown_tolerance"), RELAXATION_MAX_DD_TOLERANCE,
        )

    # If still empty, return empty
    if not eligible:
        return {
            "mode": mode,
            "filter_relaxed": filter_relaxed,
            "engine_version": ENGINE_VERSION,
            "weights_version": WEIGHTS_VERSION,
            "effective_preferences": active_prefs,
            "relaxed_overrides": relaxed_overrides,
            "effective_thresholds": effective_thresholds,
            "candidates": [],
            "excluded": _serialize_excluded(_top_excluded(excluded, active_prefs)),
            "excluded_total": len(excluded),
            "source_strategy_count": len(candidate_strategies),
        }

    # NOTE: scoring math below uses `prefs` (the strict, un-relaxed user
    # preferences), NOT `active_prefs`. Relaxation widens the eligibility
    # gate so the founder sees SOMETHING on sparse universes, but rankings
    # within that wider set still reward strategies that would have passed
    # the strict gate. `active_prefs` / `relaxed_overrides` are persisted
    # in the audit trail so 'why was X scored this way?' replay is honest.

    # Compute add_weight from ticket size + portfolio AUM
    if mode == "personalized" and portfolio_aum and portfolio_aum > 0:
        ticket = prefs.get("target_ticket_size_usd") or 0
        add_weight = _clamp(ticket / portfolio_aum, 0.01, 0.5)
    else:
        add_weight = 0.10  # Default for cold-start or unknown AUM

    # Build the portfolio returns series once for personalized mode
    portfolio_returns_series: pd.Series
    if mode == "personalized" and portfolio_returns:
        port_df = pd.DataFrame(portfolio_returns).dropna()
        if not port_df.empty:
            w_arr = np.array(
                [portfolio_weights.get(sid, 0) for sid in port_df.columns]
            )
            if w_arr.sum() > 0:
                w_arr = w_arr / w_arr.sum()
            portfolio_returns_series = pd.Series(
                (port_df * w_arr).sum(axis=1),
                index=port_df.index,
                name="portfolio",
            )
        else:
            portfolio_returns_series = pd.Series(dtype=float)
    else:
        portfolio_returns_series = pd.Series(dtype=float)

    # Compute sub-scores for each eligible candidate
    raw_components: list[dict[str, Any]] = []
    for cand in eligible:
        sid = cand["strategy_id"]
        cand_returns = candidate_returns.get(sid)

        if mode == "personalized" and cand_returns is not None and not portfolio_returns_series.empty:
            pf_components = _compute_portfolio_fit_components(
                portfolio_returns_series,
                portfolio_weights,
                portfolio_returns,
                cand_returns,
                add_weight,
            )
        else:
            pf_components = _empty_pf_components()

        manager_aum = cand.get("manager_aum") or 0
        ticket = prefs.get("target_ticket_size_usd") or 0
        ticket_concentration = (
            ticket / manager_aum if manager_aum > 0 else None
        )

        raw_components.append({
            "candidate": cand,
            "sharpe_lift": pf_components["sharpe_lift"],
            "corr_reduction": pf_components["corr_reduction"],
            "dd_improvement": pf_components["dd_improvement"],
            "corr_with_portfolio": pf_components["corr_with_portfolio"],
            "data_completeness": pf_components.get("data_completeness"),
            "ticket_concentration": ticket_concentration,
        })

    # Normalize portfolio_fit components within the eligible set
    if mode == "personalized":
        sharpe_lifts = [r["sharpe_lift"] for r in raw_components]
        corr_reductions = [r["corr_reduction"] for r in raw_components]
        dd_improvements = [r["dd_improvement"] for r in raw_components]
        sharpe_lift_norm = _normalize_min_max(sharpe_lifts)
        corr_reduction_norm = _normalize_min_max(corr_reductions)
        dd_improvement_norm = _normalize_min_max(dd_improvements)
    else:
        sharpe_lift_norm = [0.0] * len(raw_components)
        corr_reduction_norm = [0.0] * len(raw_components)
        dd_improvement_norm = [0.0] * len(raw_components)

    # Final scoring
    scored: list[dict[str, Any]] = []
    for i, rc in enumerate(raw_components):
        cand = rc["candidate"]
        sid = cand["strategy_id"]

        if mode == "personalized":
            portfolio_fit = (
                W_SHARPE_LIFT * sharpe_lift_norm[i]
                + W_CORR_REDUCTION * corr_reduction_norm[i]
                + W_DD_IMPROVEMENT * dd_improvement_norm[i]
            )
        else:
            portfolio_fit = 0.0

        preference_fit = _compute_preference_fit(cand, prefs)

        # Phase 3 / D-02 composition — 0.6 * preference_fit + 0.4 *
        # mandate_fit_score lives INSIDE the W_PREFERENCE_FIT term. Applies
        # in both modes (screening mode still uses the composed value —
        # only the outer top-level weight constants differ).
        mandate_fit_score, mandate_fit_raw = _compute_mandate_fit_score(
            cand, prefs, rc["corr_with_portfolio"], add_weight, mode,
        )
        effective_preference_fit = 0.6 * preference_fit + 0.4 * mandate_fit_score

        track_record = _compute_track_record_score(cand)
        capacity_fit = _compute_capacity_fit(cand, prefs)

        if mode == "personalized":
            # Phase 3 / D-08 — multiplicative scoring_weight_overrides on the
            # four top-level weights (personalized mode only per D-09). Clamp
            # each scale to [0.5, 1.5], then renormalize so sum == 1.0.
            # Missing keys default to 1.0 (no scaling). Screening weights
            # are NOT overridable.
            overrides = prefs.get("scoring_weight_overrides") or {}
            scaled = {
                "W_PORTFOLIO_FIT":  W_PORTFOLIO_FIT
                    * _clamp(overrides.get("W_PORTFOLIO_FIT", 1.0), 0.5, 1.5),
                "W_PREFERENCE_FIT": W_PREFERENCE_FIT
                    * _clamp(overrides.get("W_PREFERENCE_FIT", 1.0), 0.5, 1.5),
                "W_TRACK_RECORD":   W_TRACK_RECORD
                    * _clamp(overrides.get("W_TRACK_RECORD", 1.0), 0.5, 1.5),
                "W_CAPACITY_FIT":   W_CAPACITY_FIT
                    * _clamp(overrides.get("W_CAPACITY_FIT", 1.0), 0.5, 1.5),
            }
            total = sum(scaled.values())
            # C-0230 / H-0699 fix: bare `assert` is stripped under `python -O`
            # (typical production container flag), which would let the next
            # line silently divide by zero and propagate NaN through every
            # candidate's score. Use an explicit raise so the guard survives
            # bytecode optimization.
            if total <= 0:
                raise ValueError(
                    "scoring_weight_overrides renormalization produced "
                    f"non-positive sum (allocator_id={allocator_id}, "
                    f"scaled={scaled})"
                )
            effective = {k: v / total for k, v in scaled.items()}

            final_score = 100 * (
                effective["W_PORTFOLIO_FIT"]   * portfolio_fit
                + effective["W_PREFERENCE_FIT"] * effective_preference_fit
                + effective["W_TRACK_RECORD"]   * track_record
                + effective["W_CAPACITY_FIT"]   * capacity_fit
            )
        else:
            # Screening mode — overrides not applied (D-09). Composition
            # still uses effective_preference_fit so mandate math contributes
            # in cold-start runs too.
            final_score = 100 * (
                W_SCREENING_PREFERENCE_FIT * effective_preference_fit
                + W_SCREENING_TRACK_RECORD * track_record
                + W_SCREENING_CAPACITY_FIT * capacity_fit
            )

        score_breakdown: dict[str, Any] = {
            "preference_fit": preference_fit,
            "mandate_fit_score": mandate_fit_score,  # Phase 3 / SCORING-02
            "track_record": track_record,
            "capacity_fit": capacity_fit,
            "raw": {
                "corr_with_portfolio": rc["corr_with_portfolio"],
                "sharpe_lift": rc["sharpe_lift"],
                "dd_improvement": rc["dd_improvement"],
                "track_record_days": cand.get("track_record_days"),
                "manager_aum": cand.get("manager_aum"),
                "ticket_concentration": rc["ticket_concentration"],
                "sharpe": cand.get("sharpe"),
                "max_drawdown_pct": cand.get("max_drawdown_pct"),
                "mandate_fit_raw": mandate_fit_raw,  # Phase 3 per-dimension detail
                "data_completeness": rc.get("data_completeness"),  # M-0675 sidecar
            },
        }
        # Only include portfolio_fit when in personalized mode — guards against
        # silent reversion to "personalized for you" framing on cold-start.
        if mode == "personalized":
            score_breakdown["portfolio_fit"] = portfolio_fit

        reasons = _generate_reasons(cand, prefs, score_breakdown, mode)

        # H-0704 fix: `_safe_float(final_score) or 0.0` silently collapses
        # NaN to 0 and the candidate sorts to the bottom indistinguishably
        # from a genuine zero. Compute the safe value first and tag the row
        # with `score_error=True` (plus a logger.warning) when the math
        # produced NaN/Inf so downstream consumers can surface it as
        # "computed with errors" rather than "low signal". Matches the
        # v0.17.1 KPI-17 lesson: silent zeros are the failure mode.
        safe_score = _safe_float(final_score)
        score_error = safe_score is None
        if score_error:
            logger.warning(
                "match_engine: NaN/Inf final_score for strategy=%s allocator=%s "
                "raw=%r portfolio_fit=%r effective_preference_fit=%r "
                "track_record=%r capacity_fit=%r — coerced to 0.0",
                sid, allocator_id, final_score, portfolio_fit,
                effective_preference_fit, track_record, capacity_fit,
            )

        scored.append({
            "strategy_id": sid,
            "score": safe_score if safe_score is not None else 0.0,
            "score_error": score_error,
            "score_breakdown": score_breakdown,
            "reasons": reasons,
        })

    # Sort descending by score, tie-break by strategy_id (deterministic).
    # Red-team HIGH fix (audit-2026-05-07 score-error-ghost-ranking): rows
    # with `score_error=True` (NaN/Inf math) must sink BELOW every legitimate
    # row regardless of their coerced score=0.0, so a single broken sub-score
    # cannot ride the strategy_id tie-break above a real low-score candidate
    # and silently get assigned a non-null rank in the persisted top-N.
    scored.sort(
        key=lambda x: (x.get("score_error", False), -x["score"], x["strategy_id"])
    )

    # Assign rank, take top N
    top = scored[:TOP_N_CANDIDATES]
    for i, item in enumerate(top):
        item["rank"] = i + 1

    return {
        "mode": mode,
        "filter_relaxed": filter_relaxed,
        "engine_version": ENGINE_VERSION,
        "weights_version": WEIGHTS_VERSION,
        "effective_preferences": active_prefs,
        "relaxed_overrides": relaxed_overrides,
        "effective_thresholds": effective_thresholds,
        "candidates": top,
        "excluded": _serialize_excluded(_top_excluded(excluded, active_prefs)),
        "excluded_total": len(excluded),
        "source_strategy_count": len(candidate_strategies),
    }


def _top_excluded(
    excluded: list[dict[str, Any]],
    preferences: dict[str, Any],
) -> list[dict[str, Any]]:
    """Pick the top 50 excluded by 'closest to passing' (sorted by softness of failure)."""
    def _almost_passed_score(item: dict[str, Any]) -> float:
        """Higher = closer to passing. Hard exclusions sort to the bottom."""
        reason = item["exclusion_reason"]
        cand = item["candidate"]
        # Normalize through the enum so a literal-string typo in either
        # this function or `_eligibility_check` is a NameError, not a
        # silent fall-through to the 0.5 default.
        try:
            reason_enum = ExclusionReason(reason)
        except ValueError:
            return 0.5
        if reason_enum.is_hard:
            return -1.0
        if reason_enum is ExclusionReason.BELOW_MIN_SHARPE:
            sharpe = cand.get("sharpe") or 0
            min_sharpe = preferences.get("min_sharpe") or 0
            return _clamp(sharpe / max(min_sharpe, 0.01), 0, 1)
        if reason_enum is ExclusionReason.BELOW_MIN_TRACK_RECORD:
            track = cand.get("track_record_days") or 0
            min_track = preferences.get("min_track_record_days") or 1
            return _clamp(track / min_track, 0, 1)
        if reason_enum is ExclusionReason.EXCEEDS_MAX_DD:
            max_dd = abs(cand.get("max_drawdown_pct") or 0)
            tol = preferences.get("max_drawdown_tolerance") or 1
            return _clamp(2 - max_dd / tol, 0, 1)
        # STYLE_EXCLUDED / OFF_MANDATE_TYPE / anything else soft → neutral 0.5
        return 0.5

    excluded_sorted = sorted(excluded, key=_almost_passed_score, reverse=True)
    return excluded_sorted[:TOP_N_EXCLUDED]


def _serialize_excluded(excluded: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Drop the raw `candidate` dict from excluded entries before returning."""
    return [
        {
            "strategy_id": item["strategy_id"],
            "exclusion_reason": item["exclusion_reason"],
            "exclusion_provenance": item.get("exclusion_provenance"),
        }
        for item in excluded
    ]


# ---------------------------------------------------------------------------
# Convenience for callers
# ---------------------------------------------------------------------------


def to_canonical_json(result: dict[str, Any]) -> str:
    """Stable JSON serialization for the determinism test."""
    return json.dumps(result, sort_keys=True, default=str)
