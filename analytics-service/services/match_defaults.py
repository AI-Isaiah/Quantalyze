"""Default preferences for the perfect-match engine.

Used when an allocator has no `allocator_preferences` row, or when specific fields
are NULL. Generous defaults so the eligibility filter doesn't strip the universe.
"""

from typing import Any, Optional, TypedDict


class AllocatorPreferences(TypedDict, total=False):
    """H-0694: the typed shape of the merged preference contract.

    This is the single most-consumed type in the match engine — read by
    _eligibility_check, _compute_preference_fit, _compute_capacity_fit,
    _compute_mandate_fit_score, score_candidates, and compute_holding_flags.
    Previously the contract was an untyped ``dict[str, Any]``, so a typo in a
    key (e.g. ``min_sharp``) silently read back None and the gate relaxed with
    no signal, and value types were unconstrained.

    A ``TypedDict`` (not a Pydantic ``BaseModel`` with ``extra='forbid'``) is
    used deliberately: ``merge_with_defaults`` is a fill-in, not a validator,
    and the live load path passes the full ``allocator_preferences`` row from
    ``select("*")`` (which carries DB-only columns like ``user_id``,
    ``mandate_edited_at`` that an ``extra='forbid'`` model would reject on every
    real allocator). The TypedDict gives mypy/IDE typo + value-type checking at
    ZERO runtime cost while preserving the documented passthrough contract
    (see tests/test_match_defaults.py). ``total=False`` because callers legally
    supply partial dicts; ``merge_with_defaults`` backfills the rest.
    """

    max_drawdown_tolerance: Optional[float]
    min_track_record_days: Optional[int]
    min_sharpe: Optional[float]
    target_ticket_size_usd: Optional[float]
    max_aum_concentration: Optional[float]
    preferred_strategy_types: list[str]
    preferred_markets: list[str]
    excluded_exchanges: list[str]
    mandate_archetype: Optional[str]
    # Phase 3 mandate keys (migrations 061 + 062).
    max_weight: Optional[float]
    correlation_ceiling: Optional[float]
    liquidity_preference: Optional[str]
    style_exclusions: list[str]
    scoring_weight_overrides: Optional[dict[str, float]]


DEFAULT_PREFERENCES: AllocatorPreferences = {
    "max_drawdown_tolerance": 0.30,    # 30% — generous
    "min_track_record_days": 180,      # 6 months
    "min_sharpe": 0.5,                 # half a Sharpe
    "target_ticket_size_usd": 50000.0, # $50k typical institutional ticket
    "max_aum_concentration": 0.20,     # 20% of manager AUM
    "preferred_strategy_types": [],    # empty = no filter
    "preferred_markets": [],           # empty = no filter
    "excluded_exchanges": [],          # empty = no exclusions
    "mandate_archetype": None,
    # Phase 3 mandate keys (migrations 061 + 062). merge_with_defaults skips
    # None-valued keys so first-visit allocators keep semantic clarity.
    "max_weight": None,
    "correlation_ceiling": None,
    "liquidity_preference": None,
    "style_exclusions": [],
    "scoring_weight_overrides": None,
}


def merge_with_defaults(prefs: dict[str, Any] | None) -> dict[str, Any]:
    """Fill in missing or null preference fields with the defaults.

    Used by the match engine before scoring. The returned dict has every key in
    DEFAULT_PREFERENCES populated.

    Accepts a plain ``dict`` (not ``AllocatorPreferences``) because the live
    caller passes the full ``select("*")`` row, which carries DB-only columns
    beyond the typed contract. The returned dict is a superset of
    ``AllocatorPreferences`` (every typed key is guaranteed present); callers
    that want static key-typo protection can annotate the result as
    ``AllocatorPreferences``.
    """
    merged: dict[str, Any] = dict(DEFAULT_PREFERENCES)
    if not prefs:
        return merged
    for key, value in prefs.items():
        if value is not None:
            merged[key] = value
    return merged
