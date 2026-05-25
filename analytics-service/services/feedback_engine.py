"""Feedback-loop closer — Phase 4 / Sprint 8 / REQUIREMENTS.md FEEDBACK-01..06.

Reads `bridge_outcomes` history + `match_candidates.score_breakdown` for an
allocator, attributes each outcome to one of four top-level scoring dimensions
(D-05 hybrid), computes per-dimension success_rate, and emits a multiplicative
scale factor (D-13 step function — 0.5x / 1.0x / 1.5x) when the per-dimension
count >= 5 (D-15 gate, D-16 omit-key semantics).

Side effects:
  - Persists result to allocator_preferences.scoring_weight_overrides (D-10).
  - Emits fire-and-forget audit event (action='feedback.overrides_updated',
    entity_type='allocator_preference_feedback') on successful UPDATE.

Contract:
  compute_adjusted_weights(allocator_id) -> dict[str, float]
    {W_i: scale} for dimensions with >=5 attributed outcomes.
    Missing keys mean 1.0x (engine reads overrides.get(W_i, 1.0) defensively).
    Empty result -> column set to NULL (engine path unchanged).

Fast-path (D3 finding):
  An allocator with zero bridge_outcomes rows returns {} with at most ONE
  Supabase round-trip (a `count="exact"` probe). This preserves the Phase 3
  `_should_skip_allocator` optimization budget inside `_scoring_semaphore`.

Attribution table (D-06, with intentional omissions — D5 finding):
  Direct-mapping subset of CONTEXT.md D-06. Two omissions are INTENTIONAL:
    - 'already_owned': filtered at D-08 SQL stage, never reaches attribution.
    - 'other':         falls through to score-dominant attribution
                       (allocated-negative path).
  See .planning/phases/04-feedback-loop/04-CONTEXT.md D-06.

See .planning/phases/04-feedback-loop/04-CONTEXT.md for D-01..D-16 decision log.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from services.audit import log_audit_event
from services.db import get_supabase

logger = logging.getLogger("quantalyze.feedback_engine")

# D-06 direct-mapping subset. See module docstring for the two intentional
# omissions (already_owned and other) — both covered by tests
# test_rejection_reason_mapping and test_filter_already_owned.
REJECTION_REASON_TO_DIMENSION: dict[str, str] = {
    "mandate_conflict":       "W_PREFERENCE_FIT",
    "underperforming_peers":  "W_TRACK_RECORD",
    "timing_wrong":           "W_PORTFOLIO_FIT",
}

MIN_OUTCOMES_PER_DIMENSION = 5
SCALE_FLOOR = 0.5
SCALE_CEILING = 1.5
RATE_FLOOR_THRESHOLD = 0.4
RATE_CEILING_THRESHOLD = 0.7

ALL_DIMENSIONS: tuple[str, ...] = (
    "W_PORTFOLIO_FIT",
    "W_PREFERENCE_FIT",
    "W_TRACK_RECORD",
    "W_CAPACITY_FIT",
)

_DIM_TO_BREAKDOWN_KEY: dict[str, str] = {
    "W_PORTFOLIO_FIT":  "portfolio_fit",
    "W_PREFERENCE_FIT": "preference_fit",
    "W_TRACK_RECORD":   "track_record",
    "W_CAPACITY_FIT":   "capacity_fit",
}


def _has_any_bridge_outcomes(allocator_id: str) -> bool:
    """D3 fast-path — returns True iff at least one bridge_outcomes row exists
    for this allocator. One lightweight Supabase round-trip; no filter on kind
    (the D-08 filters are applied later in _fetch_eligible_outcomes). Used to
    short-circuit the full attribution path for allocators with no history.
    """
    supabase = get_supabase()
    resp = (
        supabase.table("bridge_outcomes")
        .select("id", count="exact")
        .eq("allocator_id", allocator_id)
        .limit(1)
        .execute()
    )
    return bool(resp.data)


def _fetch_eligible_outcomes(allocator_id: str) -> list[dict[str, Any]]:
    """Query bridge_outcomes for this allocator, apply D-08 noise filters + D-03 pending drop.

    Two sequential queries (not one OR chain — Pitfall 5). D-08 drop order:
      1. kind='rejected' AND rejection_reason='already_owned' — filtered at SQL.
      2. kind='allocated' AND percent_allocated < 1.0 — filtered at SQL.
      3. kind='allocated' AND all delta_Xd IS NULL (pending) — filtered in Python (D-03).
    """
    supabase = get_supabase()
    rejected = (
        supabase.table("bridge_outcomes")
        .select("strategy_id, kind, rejection_reason, "
                "delta_30d, delta_90d, delta_180d, percent_allocated")
        .eq("allocator_id", allocator_id)
        .eq("kind", "rejected")
        .neq("rejection_reason", "already_owned")
        .execute()
    ).data or []

    allocated = (
        supabase.table("bridge_outcomes")
        .select("strategy_id, kind, rejection_reason, "
                "delta_30d, delta_90d, delta_180d, percent_allocated")
        .eq("allocator_id", allocator_id)
        .eq("kind", "allocated")
        .gte("percent_allocated", 1.0)
        .execute()
    ).data or []

    mature_allocated = [
        o for o in allocated
        if o.get("delta_30d") is not None
        or o.get("delta_90d") is not None
        or o.get("delta_180d") is not None
    ]
    # Holding-based bridge outcomes (voluntary actions on real holdings) carry
    # strategy_id=NULL + original_holding_ref, not a platform strategy_id. They
    # are not attributable to a strategy's score dimensions, so drop them here.
    # Pre-fix a NULL strategy_id flowed into `sorted({...})` in
    # compute_adjusted_weights and raised TypeError: '<' not supported between
    # instances of 'str' and 'NoneType' (Sentry 122529822, cron-recompute).
    return [
        o for o in (rejected + mature_allocated)
        if o.get("strategy_id") is not None
    ]


def _fetch_score_breakdowns(
    allocator_id: str,
    strategy_ids: list[str],
) -> dict[str, dict[str, Any]]:
    """Batch-load match_candidates.score_breakdown for this allocator's eligible outcomes.
    Keeps only the most recent row per strategy_id — temporal ordering lives on
    match_batches.computed_at (match_candidates has no timestamp column), so we
    resolve batches newest-first and then walk candidates in that order.
    """
    if not strategy_ids:
        return {}
    supabase = get_supabase()
    batches_result = (
        supabase.table("match_batches")
        .select("id")
        .eq("allocator_id", allocator_id)
        .order("computed_at", desc=True)
        .execute()
    )
    batch_ids = [b["id"] for b in (batches_result.data or [])]
    if not batch_ids:
        return {}
    cand_result = (
        supabase.table("match_candidates")
        .select("batch_id, strategy_id, score_breakdown")
        .in_("batch_id", batch_ids)
        .in_("strategy_id", strategy_ids)
        .execute()
    )
    by_batch: dict[str, dict[str, dict[str, Any]]] = {}
    for row in cand_result.data or []:
        if not row.get("score_breakdown"):
            continue
        by_batch.setdefault(row["batch_id"], {})[row["strategy_id"]] = row["score_breakdown"]
    out: dict[str, dict[str, Any]] = {}
    for bid in batch_ids:
        for sid, bd in by_batch.get(bid, {}).items():
            if sid not in out:
                out[sid] = bd
    return out


def _success_value(outcome: dict[str, Any]) -> int:
    """D-01 + D-02: success = 1 iff most-mature non-NULL delta > 0; else 0.
    Rejected outcomes count as FAILURE (D-04). Precondition: outcome passed D-03/D-08 filters.
    """
    if outcome["kind"] == "rejected":
        return 0
    for key in ("delta_180d", "delta_90d", "delta_30d"):
        v = outcome.get(key)
        if v is not None:
            try:
                return 1 if float(v) > 0 else 0
            except (ValueError, TypeError):
                # M-0737 / review-A: a corrupt non-numeric delta (e.g. a bad
                # JSONB string) is NOT a usable signal. Don't fabricate a
                # failure (0) from it — counting corruption as a loss silently
                # biases the learning signal downward, and the module logger
                # was previously unused on this path. Log it and fall through
                # to the next (less-mature) maturity key; only if EVERY
                # maturity is missing/corrupt does the function reach the
                # terminal 0 below (genuine "no measurable improvement yet").
                logger.warning(
                    "feedback: non-numeric delta %r for key=%s — skipping "
                    "(no signal), trying next maturity",
                    v, key,
                )
                continue
    return 0


def _attribute_dimension(
    outcome: dict[str, Any],
    score_breakdown: Optional[dict[str, Any]],
) -> tuple[str, ...]:
    """D-05 hybrid attribution. Returns a tuple of dimension names:
      - Single-element for normal attribution (rejection enum OR score-dominant).
      - 4-element for D-07 uniform fallback (missing match_candidates row).
    Pitfall 6: screening-mode score_breakdown has no 'portfolio_fit' key.
    """
    if outcome["kind"] == "rejected":
        reason = outcome.get("rejection_reason")
        if reason in REJECTION_REASON_TO_DIMENSION:
            return (REJECTION_REASON_TO_DIMENSION[reason],)
        # 'other' or unmapped -> fall through to score-dominant

    if score_breakdown is None:
        return ALL_DIMENSIONS  # D-07 uniform fallback

    candidates = {
        dim: score_breakdown.get(_DIM_TO_BREAKDOWN_KEY[dim])
        for dim in ALL_DIMENSIONS
        if score_breakdown.get(_DIM_TO_BREAKDOWN_KEY[dim]) is not None
    }
    if not candidates:
        return ALL_DIMENSIONS
    max_dim = max(sorted(candidates.keys()), key=lambda w: candidates[w])
    return (max_dim,)


def _apply_shape(dim_outcomes: dict[str, list[int]]) -> dict[str, float]:
    """D-13 step function + D-15 min-5 gate + D-16 omit-key semantics.
    In-band (0.4..0.7) dimensions are OMITTED per D-16.
    """
    out: dict[str, float] = {}
    for dim, values in dim_outcomes.items():
        if len(values) < MIN_OUTCOMES_PER_DIMENSION:
            continue
        rate = sum(values) / len(values)
        if rate < RATE_FLOOR_THRESHOLD:
            out[dim] = SCALE_FLOOR
        elif rate > RATE_CEILING_THRESHOLD:
            out[dim] = SCALE_CEILING
    return out


def _persist_overrides(
    allocator_id: str,
    overrides: Optional[dict[str, float]],
) -> bool:
    """Writes result to allocator_preferences.scoring_weight_overrides.
    Returns True iff the UPDATE affected a row (for audit-emission gating).
    Pitfall 7: UPDATE of missing row is silent no-op.
    """
    supabase = get_supabase()
    result = supabase.table("allocator_preferences").update({
        "scoring_weight_overrides": overrides if overrides else None,
    }).eq("user_id", allocator_id).execute()
    affected = bool(result.data)
    if not affected:
        logger.debug(
            "feedback_engine: no allocator_preferences row for %s; "
            "overrides computed but not persisted (self-healing on next mandate write)",
            allocator_id,
        )
    return affected


def compute_adjusted_weights(allocator_id: str) -> dict[str, float]:
    """Phase 4 feedback engine public entry point.
    See module docstring + CONTEXT.md D-01..D-16.

    D3 fast-path: if _has_any_bridge_outcomes returns False, return {} after
    one lightweight probe query. No attribution path, no score_breakdown fetch,
    no write (cold allocator's allocator_preferences row remains untouched;
    D-16 "no override key" semantic is preserved).
    """
    # D3 finding — fast-path before any attribution work.
    if not _has_any_bridge_outcomes(allocator_id):
        return {}

    outcomes = _fetch_eligible_outcomes(allocator_id)
    if not outcomes:
        affected = _persist_overrides(allocator_id, None)
        if affected:
            log_audit_event(
                user_id=allocator_id,
                action="feedback.overrides_updated",
                entity_type="allocator_preference_feedback",
                entity_id=allocator_id,
                metadata={"dimensions_updated": [], "engine_version": "v1"},
            )
        return {}

    strategy_ids = sorted({o["strategy_id"] for o in outcomes})
    breakdowns = _fetch_score_breakdowns(allocator_id, strategy_ids)

    dim_outcomes: dict[str, list[int]] = {d: [] for d in ALL_DIMENSIONS}
    for outcome in outcomes:
        success = _success_value(outcome)
        dims = _attribute_dimension(outcome, breakdowns.get(outcome["strategy_id"]))
        for dim in dims:
            dim_outcomes[dim].append(success)

    result = _apply_shape(dim_outcomes)
    affected = _persist_overrides(allocator_id, result)
    if affected:
        log_audit_event(
            user_id=allocator_id,
            action="feedback.overrides_updated",
            entity_type="allocator_preference_feedback",
            entity_id=allocator_id,
            metadata={
                "dimensions_updated": sorted(result.keys()),
                "engine_version": "v1",
            },
        )
    return result
