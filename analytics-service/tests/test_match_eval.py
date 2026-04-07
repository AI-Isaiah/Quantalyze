"""Tests for analytics-service/services/match_eval.py"""

from services.match_eval import _empty_metrics, _week_start_iso


def test_week_start_iso_returns_monday():
    # 2026-04-07 is a Tuesday, so Monday is 2026-04-06
    result = _week_start_iso("2026-04-07T10:00:00Z")
    assert result == "2026-04-06"


def test_week_start_iso_handles_sunday():
    # 2026-04-05 is a Sunday, Monday of that week is 2026-03-30
    result = _week_start_iso("2026-04-05T10:00:00Z")
    assert result == "2026-03-30"


def test_empty_metrics_shape():
    result = _empty_metrics(28)
    assert result["window_days"] == 28
    assert result["intros_shipped"] == 0
    assert result["hits_top_3"] == 0
    assert result["hits_top_10"] == 0
    assert result["hit_rate_top_3"] == 0.0
    assert result["hit_rate_top_10"] == 0.0
    assert result["weekly"] == []
    assert result["missed"] == []
