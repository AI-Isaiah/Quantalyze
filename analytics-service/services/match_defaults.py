"""Default preferences for the perfect-match engine.

Used when an allocator has no `allocator_preferences` row, or when specific fields
are NULL. Generous defaults so the eligibility filter doesn't strip the universe.
"""

from typing import Any

DEFAULT_PREFERENCES: dict[str, Any] = {
    "max_drawdown_tolerance": 0.30,    # 30% — generous
    "min_track_record_days": 180,      # 6 months
    "min_sharpe": 0.5,                 # half a Sharpe
    "target_ticket_size_usd": 50000.0, # $50k typical institutional ticket
    "max_aum_concentration": 0.20,     # 20% of manager AUM
    "preferred_strategy_types": [],    # empty = no filter
    "preferred_markets": [],           # empty = no filter
    "excluded_exchanges": [],          # empty = no exclusions
    "mandate_archetype": None,
}


def merge_with_defaults(prefs: dict[str, Any] | None) -> dict[str, Any]:
    """Fill in missing or null preference fields with the defaults.

    Used by the match engine before scoring. The returned dict has every key in
    DEFAULT_PREFERENCES populated.
    """
    merged = dict(DEFAULT_PREFERENCES)
    if not prefs:
        return merged
    for key, value in prefs.items():
        if value is not None:
            merged[key] = value
    return merged
