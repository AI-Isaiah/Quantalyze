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
