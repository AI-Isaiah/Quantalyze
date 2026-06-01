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

import json
import logging
from typing import Any, Optional

from postgrest.types import CountMethod

from services.audit import log_audit_event
from services.db import Row, get_supabase, rows

logger = logging.getLogger("quantalyze.feedback_engine")


# ---------------------------------------------------------------------------
# Row shape — bridge_outcomes rows are consumed as the central `Row`
# (dict[str, Any]) primitive from services.db (B-mypy). A bespoke per-table
# TypedDict was removed in favour of the one shared contract: it was only ever
# an *annotation* (the producer returned the raw PostgREST `.data` union, so
# mypy never actually validated a row against it), and the campaign's
# established convention (see services/db.py) is a single loose `Row` rather
# than schema-drift-brittle per-table TypedDicts across 31 tables. The column
# contract this pipeline relies on is preserved here as documentation:
#   kind              TEXT NOT NULL   ('rejected' | 'allocated')
#   rejection_reason  TEXT NULL       (the five D-06 reasons; NULL on allocated)
#   strategy_id       UUID NULL       (holding-based outcomes carry NULL and are
#                                      dropped in _fetch_eligible_outcomes, so
#                                      every row reaching a consumer has it)
#   delta_30/90/180d  NUMERIC NULL    (PostgREST serializes numeric as a JSON
#                                      number OR string by magnitude; read sites
#                                      coerce via float())
#   percent_allocated NUMERIC NULL
# A typo'd column or reason no longer surfaces at type-check time, but the read
# sites already fail loud / log on unexpected shapes at runtime (e.g. the
# non-numeric-delta guard in _success_value), and the producer drops malformed
# rows — so the runtime contract is unchanged.

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

# H-0678: single source of truth for the feedback-engine output version emitted
# in audit metadata. Uses the vMAJOR.MINOR.PATCH form to match
# match_engine.ENGINE_VERSION's convention (currently "v2.1.0"), so audit
# consumers see one consistent version format. This is the FEEDBACK engine's
# version and is independent of match_engine.ENGINE_VERSION (which versions
# match_batches rows). Bump on any change to the attribution/shape contract.
FEEDBACK_ENGINE_VERSION = "v1.0.0"

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
        .select("id", count=CountMethod.exact)
        .eq("allocator_id", allocator_id)
        .limit(1)
        .execute()
    )
    return bool(rows(resp))


def _fetch_eligible_outcomes(allocator_id: str) -> list[Row]:
    """Query bridge_outcomes for this allocator, apply D-08 noise filters + D-03 pending drop.

    Two sequential queries (not one OR chain — Pitfall 5). D-08 drop order:
      1. kind='rejected' AND rejection_reason='already_owned' — filtered at SQL.
      2. kind='allocated' AND percent_allocated < 1.0 — filtered at SQL.
      3. kind='allocated' AND all delta_Xd IS NULL (pending) — filtered in Python (D-03).
    """
    supabase = get_supabase()
    rejected = rows(
        supabase.table("bridge_outcomes")
        .select("strategy_id, kind, rejection_reason, "
                "delta_30d, delta_90d, delta_180d, percent_allocated")
        .eq("allocator_id", allocator_id)
        .eq("kind", "rejected")
        .neq("rejection_reason", "already_owned")
        .execute()
    )

    allocated = rows(
        supabase.table("bridge_outcomes")
        .select("strategy_id, kind, rejection_reason, "
                "delta_30d, delta_90d, delta_180d, percent_allocated")
        .eq("allocator_id", allocator_id)
        .eq("kind", "allocated")
        .gte("percent_allocated", 1.0)
        .execute()
    )

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
    batch_ids = [b["id"] for b in rows(batches_result)]
    if not batch_ids:
        return {}
    cand_result = (
        supabase.table("match_candidates")
        .select("batch_id, strategy_id, score_breakdown")
        .in_("batch_id", batch_ids)
        .in_("strategy_id", strategy_ids)
        .execute()
    )
    # H-0679: the candidates query carries NO ORDER BY and there is no DB-level
    # unique constraint on (batch_id, strategy_id) in this slice, so Supabase's
    # within-batch row order is undefined. Cross-batch newest-wins is handled
    # below by iterating batch_ids newest-first; to make the WITHIN-batch choice
    # fully deterministic too (rather than depending on PostgREST internal
    # ordering), sort by (batch_id, strategy_id, serialized score_breakdown) and
    # keep the FIRST breakdown per (batch_id, strategy_id). The serialized-
    # breakdown tiebreaker means even a duplicate (batch_id, strategy_id) row
    # carrying a DIFFERENT payload resolves to the same (lexicographically-
    # smallest) breakdown regardless of return order — the result is independent
    # of Supabase's row order, not merely stable for distinct keys. Keeps the
    # test_determinism contract independent of Supabase's return order.
    by_batch: dict[str, dict[str, dict[str, Any]]] = {}
    sorted_rows = sorted(
        (r for r in rows(cand_result) if r.get("score_breakdown")),
        key=lambda r: (
            r["batch_id"],
            r["strategy_id"],
            json.dumps(r["score_breakdown"], sort_keys=True, default=str),
        ),
    )
    for row in sorted_rows:
        by_batch.setdefault(row["batch_id"], {}).setdefault(
            row["strategy_id"], row["score_breakdown"]
        )
    out: dict[str, dict[str, Any]] = {}
    for bid in batch_ids:
        for sid, bd in by_batch.get(bid, {}).items():
            if sid not in out:
                out[sid] = bd
    return out


def _success_value(outcome: Row) -> int:
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
    outcome: Row,
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
        dim: v
        for dim in ALL_DIMENSIONS
        if (v := score_breakdown.get(_DIM_TO_BREAKDOWN_KEY[dim])) is not None
    }
    if not candidates:
        return ALL_DIMENSIONS
    # F_fb (red-team 2026-05-27): on a tie for the max score, credit the
    # outcome to ALL tied-max dimensions, not just one. The prior
    # `max(sorted(candidates.keys()), key=...)` returned the alphabetically-
    # FIRST tied dimension (`max` returns the first maximal element of the
    # ascending-sorted keys), so a 3-way tie attributed the entire
    # success/failure to one arbitrarily-chosen dimension while the other
    # tied dims got zero credit — over many ties this biases a dimension's
    # success_rate by an alphabetical accident. Splitting credit across every
    # tied-max dimension is order-independent and deterministic (ALL_DIMENSIONS
    # is a fixed-order tuple, so the returned subset preserves that order).
    # compute_adjusted_weights already iterates the returned tuple and appends
    # the outcome to each dimension, so a multi-element return Just Works.
    max_score = max(candidates.values())
    return tuple(dim for dim in ALL_DIMENSIONS if candidates.get(dim) == max_score)


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
    # supabase-py update() defaults to Prefer: return=representation (postgrest
    # ReturnMethod.representation), so a matched UPDATE returns the affected
    # row(s) and a no-match UPDATE returns [] — bool(result.data) is a reliable
    # affected-row signal under the supabase-py 2.x client.
    affected = bool(result.data)
    if not affected:
        # H-0676/H-0677/M-0668: a missing allocator_preferences row means the
        # overrides we just computed are NOT durably persisted here. The caller
        # (compute_adjusted_weights) STILL returns them and match scoring still
        # consumes them for this run, so the effect is real — it just self-heals
        # to a persisted state on the next mandate write (which UPSERTs the row).
        # The old debug-level log was invisible under the default WARNING root
        # level, so this drop was silent. Surface it at WARNING with the override
        # shape so an incident reviewer can correlate it with the audit event the
        # caller emits with persisted=false. Creating the row here is intentionally
        # avoided — it could violate other NOT NULL invariants on
        # allocator_preferences and is out of this function's contract.
        logger.warning(
            "feedback_engine: no allocator_preferences row for %s; computed "
            "overrides=%s NOT persisted (applied to this scoring run + recorded "
            "in audit with persisted=false; self-heals on next mandate write)",
            allocator_id, overrides if overrides else None,
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
        # Unlike the main path below, this branch only CLEARS overrides and
        # returns {} — when no row exists (affected False) nothing was cleared
        # and nothing reaches scoring, so there is no effect to audit. When a
        # row WAS cleared, record it (persisted is True here by construction).
        if affected:
            log_audit_event(
                user_id=allocator_id,
                action="feedback.overrides_updated",
                entity_type="allocator_preference_feedback",
                entity_id=allocator_id,
                metadata={
                    "dimensions_updated": [],
                    "engine_version": FEEDBACK_ENGINE_VERSION,
                    "persisted": affected,
                },
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
    # H-0676 / silent-failure: `result` is returned and applied to live match
    # scoring (routers/match.py) REGARDLESS of whether the row persisted, so the
    # audit event must fire unconditionally on this path. Gating it on `affected`
    # (the prior behaviour) made the forensic trail silently omit exactly the
    # allocators whose preferences row is missing — even though their scoring was
    # still adjusted by these overrides. `persisted` records whether the override
    # was durably saved, so the audit record matches what scoring actually did.
    log_audit_event(
        user_id=allocator_id,
        action="feedback.overrides_updated",
        entity_type="allocator_preference_feedback",
        entity_id=allocator_id,
        metadata={
            "dimensions_updated": sorted(result.keys()),
            "engine_version": FEEDBACK_ENGINE_VERSION,
            "persisted": affected,
        },
    )
    return result
