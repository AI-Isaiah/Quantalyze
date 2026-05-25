"""Tests for analytics-service/services/match_defaults.py"""

from services.match_defaults import DEFAULT_PREFERENCES, merge_with_defaults


def test_merge_with_none_returns_defaults():
    result = merge_with_defaults(None)
    assert result == DEFAULT_PREFERENCES
    assert result is not DEFAULT_PREFERENCES  # is a copy, not a reference


def test_merge_with_empty_returns_defaults():
    result = merge_with_defaults({})
    assert result == DEFAULT_PREFERENCES


def test_merge_overrides_default_when_set():
    result = merge_with_defaults({"min_sharpe": 1.5})
    assert result["min_sharpe"] == 1.5
    assert result["min_track_record_days"] == DEFAULT_PREFERENCES["min_track_record_days"]


def test_merge_keeps_default_when_value_is_none():
    """A None value in prefs should NOT override the default — fields are nullable."""
    result = merge_with_defaults({"min_sharpe": None})
    assert result["min_sharpe"] == DEFAULT_PREFERENCES["min_sharpe"]


def test_merge_keeps_zero_when_explicitly_set():
    """A 0 value should override the default (it's a valid number, not absent)."""
    result = merge_with_defaults({"min_sharpe": 0})
    assert result["min_sharpe"] == 0


def test_merge_handles_array_overrides():
    result = merge_with_defaults({"excluded_exchanges": ["bybit"]})
    assert result["excluded_exchanges"] == ["bybit"]


def test_default_preferences_unchanged_after_merge():
    """Calling merge_with_defaults should not mutate the global default."""
    snapshot = dict(DEFAULT_PREFERENCES)
    merge_with_defaults({"min_sharpe": 1.5})
    assert DEFAULT_PREFERENCES == snapshot


# =========================================================================
# Phase 3 / D-15 — DEFAULT_PREFERENCES mandate key extension tests
# =========================================================================
# These 5 stubs assert DEFAULT_PREFERENCES has the 5 new mandate keys added by
# Wave 1 (match_defaults.py extension). Intentional red during Wave 0.
# =========================================================================


def test_default_includes_max_weight_none():
    assert "max_weight" in DEFAULT_PREFERENCES
    assert DEFAULT_PREFERENCES["max_weight"] is None


def test_default_includes_correlation_ceiling_none():
    assert "correlation_ceiling" in DEFAULT_PREFERENCES
    assert DEFAULT_PREFERENCES["correlation_ceiling"] is None


def test_default_includes_liquidity_preference_none():
    assert "liquidity_preference" in DEFAULT_PREFERENCES
    assert DEFAULT_PREFERENCES["liquidity_preference"] is None


def test_default_includes_style_exclusions_empty_list():
    assert "style_exclusions" in DEFAULT_PREFERENCES
    assert DEFAULT_PREFERENCES["style_exclusions"] == []


def test_default_includes_scoring_weight_overrides_none():
    assert "scoring_weight_overrides" in DEFAULT_PREFERENCES
    assert DEFAULT_PREFERENCES["scoring_weight_overrides"] is None


# =========================================================================
# Audit closure M-0740 — merge_with_defaults INTERACTION on the new mandate
# keys (the prior 5 stubs only asserted existence + default value, never
# how merge behaves when a partial dict supplies / nulls these keys).
# =========================================================================


def test_merge_passes_scoring_weight_overrides_dict_through():
    """A user-supplied scoring_weight_overrides dict must survive the merge
    verbatim (merge is a fill-in, not a validator — it must not drop or
    rewrite a present non-None value)."""
    overrides = {"W_PORTFOLIO_FIT": 1.5}
    result = merge_with_defaults({"scoring_weight_overrides": overrides})
    assert result["scoring_weight_overrides"] == {"W_PORTFOLIO_FIT": 1.5}


def test_merge_passes_non_dict_scoring_weight_overrides_through_unvalidated():
    """merge_with_defaults does NOT type-check: a non-dict (e.g. 5.0) supplied
    for scoring_weight_overrides passes through unchanged. This pins the
    current contract — validation, if ever added, belongs at a higher layer,
    and a regression that silently coerced/dropped the value would change the
    documented passthrough semantics. (Not a tautology: asserts the float is
    preserved, not the default None.)"""
    result = merge_with_defaults({"scoring_weight_overrides": 5.0})
    assert result["scoring_weight_overrides"] == 5.0
    assert result["scoring_weight_overrides"] is not None


def test_merge_style_exclusions_none_falls_back_to_empty_list():
    """style_exclusions=None is a falsy/None value, so merge SKIPS it and the
    default empty list survives (NOT None). A regression that copied the None
    through would break downstream `subtype in style_exclusions` membership
    checks (TypeError on None)."""
    result = merge_with_defaults({"style_exclusions": None})
    assert result["style_exclusions"] == []


def test_merge_style_exclusions_explicit_list_overrides_default():
    """A non-None style_exclusions list replaces the default []."""
    result = merge_with_defaults({"style_exclusions": ["Mean Reversion"]})
    assert result["style_exclusions"] == ["Mean Reversion"]


def test_merge_of_default_preferences_is_idempotent_on_new_keys():
    """Round-trip: merging DEFAULT_PREFERENCES with itself yields an equal dict
    (idempotence). Notably the None-valued mandate keys (max_weight,
    correlation_ceiling, liquidity_preference, scoring_weight_overrides) must
    survive — merge SKIPS None inputs, so they stay at their None default
    rather than being dropped from the dict."""
    result = merge_with_defaults(dict(DEFAULT_PREFERENCES))
    assert result == DEFAULT_PREFERENCES
    for key in (
        "max_weight",
        "correlation_ceiling",
        "liquidity_preference",
        "scoring_weight_overrides",
    ):
        assert key in result
        assert result[key] is None
    assert result["style_exclusions"] == []
