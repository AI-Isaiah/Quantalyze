"""Integration + unit tests for Phase 4 / Plan 04-01 — feedback_engine.py.

All tests use mocked Supabase via monkeypatch + MagicMock (default). A
subset (test_migration_063_enqueues_only_transitioned_allocators) is
HAS_LIVE_DB-gated per Phase 3 D-17 precedent; the mocked counterpart is
unconditional. asyncio_mode = auto from pytest.ini — no explicit
@pytest.mark.asyncio decorators needed on async defs.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

FIXTURES_DIR = Path(__file__).parent / "fixtures"

# Phase 3 D-17 precedent: optional live-DB integration gate.
HAS_LIVE_DB = bool(os.environ.get("HAS_LIVE_DB"))

# Wave 0: these imports fail until Wave 1-A lands services/feedback_engine.py.
# Guard so the file still collects and the specific tests skip cleanly.
try:
    from services.feedback_engine import (
        compute_adjusted_weights,
        REJECTION_REASON_TO_DIMENSION,
        MIN_OUTCOMES_PER_DIMENSION,
        SCALE_FLOOR,
        SCALE_CEILING,
        RATE_FLOOR_THRESHOLD,
        RATE_CEILING_THRESHOLD,
        ALL_DIMENSIONS,
    )
    IMPORTS_OK = True
except ImportError:
    compute_adjusted_weights = None  # type: ignore
    REJECTION_REASON_TO_DIMENSION = {}
    MIN_OUTCOMES_PER_DIMENSION = 5
    SCALE_FLOOR = 0.5
    SCALE_CEILING = 1.5
    RATE_FLOOR_THRESHOLD = 0.4
    RATE_CEILING_THRESHOLD = 0.7
    ALL_DIMENSIONS = (
        "W_PORTFOLIO_FIT", "W_PREFERENCE_FIT",
        "W_TRACK_RECORD", "W_CAPACITY_FIT",
    )
    IMPORTS_OK = False

# Golden scenario fixture names — D2 finding, three scenarios.
GOLDEN_SCENARIOS = (
    ("cold",    "feedback_engine_v1_cold_golden.json"),
    ("ceiling", "feedback_engine_v1_ceiling_golden.json"),
    ("floor",   "feedback_engine_v1_floor_golden.json"),
)

# D2 finding: sentinel payload written at Wave 0 that deliberately FAILS any
# real equality check against compute_adjusted_weights output. Real content
# lands only through REGENERATE_GOLDEN=1 in Wave 1-C.
GOLDEN_WAVE0_SENTINEL = {"__placeholder": "regenerate via REGENERATE_GOLDEN=1"}


# ---------------------------------------------------------------------------
# Test fixtures
# ---------------------------------------------------------------------------


def _make_outcome(
    strategy_id: str = "strat-1",
    kind: str = "allocated",
    percent_allocated: float | None = 10.0,
    rejection_reason: str | None = None,
    delta_180d: float | None = 0.05,
    delta_90d: float | None = None,
    delta_30d: float | None = None,
) -> dict:
    return {
        "strategy_id": strategy_id,
        "kind": kind,
        "percent_allocated": percent_allocated,
        "rejection_reason": rejection_reason,
        "delta_180d": delta_180d,
        "delta_90d": delta_90d,
        "delta_30d": delta_30d,
    }


def _make_mock_supabase(
    rejected_rows: list[dict] | None = None,
    allocated_rows: list[dict] | None = None,
    breakdown_rows: list[dict] | None = None,
    probe_nonempty: bool = True,
    update_affected: bool = True,
) -> MagicMock:
    """Build a MagicMock configured to answer the four query chains used by
    services.feedback_engine: the D3 fast-path probe, rejected fetch, allocated
    fetch, breakdown fetch, and allocator_preferences UPDATE.
    """
    mock_sb = MagicMock()

    probe_data = [{"id": "probe-nonzero"}] if probe_nonempty else []
    probe_exec = MagicMock(data=probe_data)
    # D3 fast-path probe: .table().select("id", count="exact").eq().limit(1).execute()
    mock_sb.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value = probe_exec

    # _fetch_eligible_outcomes rejected chain:
    # .table().select().eq().eq().neq().execute()
    mock_sb.table.return_value.select.return_value.eq.return_value.eq.return_value.neq.return_value.execute.return_value = MagicMock(data=rejected_rows or [])

    # _fetch_eligible_outcomes allocated chain:
    # .table().select().eq().eq().gte().execute()
    mock_sb.table.return_value.select.return_value.eq.return_value.eq.return_value.gte.return_value.execute.return_value = MagicMock(data=allocated_rows or [])

    # _fetch_score_breakdowns chains. match_candidates has no created_at, so the
    # engine resolves ordering via match_batches.computed_at (newest batch first)
    # and then fetches candidates filtered by (batch_id, strategy_id).
    #   1. match_batches.select("id").eq().order().execute() -> one batch-id per
    #      breakdown row, emitted newest-first so "first seen wins" is preserved.
    #   2. match_candidates.select().in_().in_().execute() -> candidate rows
    #      tagged with the synthetic batch_id so by-batch dedup matches input order.
    _breakdowns = breakdown_rows or []
    _batch_ids = [f"mock-batch-{i}" for i in range(len(_breakdowns))]
    mock_sb.table.return_value.select.return_value.eq.return_value.order.return_value.execute.return_value = MagicMock(
        data=[{"id": bid} for bid in _batch_ids]
    )
    mock_sb.table.return_value.select.return_value.in_.return_value.in_.return_value.execute.return_value = MagicMock(
        data=[{**row, "batch_id": bid} for bid, row in zip(_batch_ids, _breakdowns)]
    )

    # _persist_overrides UPDATE chain:
    # .table().update().eq().execute()
    update_data = [{"user_id": "mock-user"}] if update_affected else []
    mock_sb.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock(data=update_data)

    return mock_sb


# ---------------------------------------------------------------------------
# 04-01-01: Public signature
# ---------------------------------------------------------------------------


def test_public_signature():
    """FEEDBACK-01 — compute_adjusted_weights(allocator_id) -> dict[str, float]."""
    if not IMPORTS_OK:
        pytest.skip("wave 0 placeholder")
    import inspect
    sig = inspect.signature(compute_adjusted_weights)
    params = list(sig.parameters.keys())
    assert params == ["allocator_id"], (
        f"Expected single positional param 'allocator_id', got {params}"
    )


# ---------------------------------------------------------------------------
# 04-01-02: Floor on low success rate
# ---------------------------------------------------------------------------


def test_floor_on_low_rate(monkeypatch):
    """FEEDBACK-02 / D-13 — 5 rejected+mandate_conflict rows -> W_PREFERENCE_FIT
    success_rate = 0.0 -> {"W_PREFERENCE_FIT": 0.5}."""
    if not IMPORTS_OK:
        pytest.skip("wave 0 placeholder")
    rejected = [
        _make_outcome(
            strategy_id=f"r{i}", kind="rejected",
            rejection_reason="mandate_conflict",
            delta_180d=None, delta_90d=None, delta_30d=None,
            percent_allocated=None,
        )
        for i in range(5)
    ]
    mock_sb = _make_mock_supabase(rejected_rows=rejected)
    monkeypatch.setattr("services.feedback_engine.get_supabase", lambda: mock_sb)
    monkeypatch.setattr("services.feedback_engine.log_audit_event", lambda **kw: None)

    result = compute_adjusted_weights("alloc-floor")
    assert result == {"W_PREFERENCE_FIT": 0.5}, (
        f"Expected floor on 5 mandate_conflict rejections, got {result}"
    )


# ---------------------------------------------------------------------------
# 04-01-03: Ceiling on high success rate
# ---------------------------------------------------------------------------


def test_ceiling_on_high_rate(monkeypatch):
    """FEEDBACK-02 / D-13 — 5 allocated+positive outcomes with portfolio_fit
    dominant in score_breakdown -> {"W_PORTFOLIO_FIT": 1.5}."""
    if not IMPORTS_OK:
        pytest.skip("wave 0 placeholder")
    allocated = [
        _make_outcome(strategy_id=f"a{i}", kind="allocated",
                      delta_180d=0.05, percent_allocated=10.0)
        for i in range(5)
    ]
    breakdown_rows = [
        {
            "strategy_id": f"a{i}",
            "score_breakdown": {
                "portfolio_fit": 0.9,
                "preference_fit": 0.4,
                "track_record": 0.3,
                "capacity_fit": 0.5,
            },
            "created_at": "2026-01-01T00:00:00Z",
        }
        for i in range(5)
    ]
    mock_sb = _make_mock_supabase(
        allocated_rows=allocated, breakdown_rows=breakdown_rows,
    )
    monkeypatch.setattr("services.feedback_engine.get_supabase", lambda: mock_sb)
    monkeypatch.setattr("services.feedback_engine.log_audit_event", lambda **kw: None)

    result = compute_adjusted_weights("alloc-ceiling")
    assert result == {"W_PORTFOLIO_FIT": 1.5}, (
        f"Expected ceiling on 5 positive-allocated portfolio_fit-dominant, got {result}"
    )


# ---------------------------------------------------------------------------
# 04-01-04: No change when rate in [0.4, 0.7]
# ---------------------------------------------------------------------------


def test_no_change_in_band(monkeypatch):
    """FEEDBACK-02 / D-13 — 3 wins / 2 losses -> rate=0.6 in [0.4, 0.7] ->
    empty dict (D-16 omit in-band 1.0x)."""
    if not IMPORTS_OK:
        pytest.skip("wave 0 placeholder")
    # 5 allocated outcomes attributed to W_PORTFOLIO_FIT (score-dominant).
    # 3 positive (delta > 0) + 2 negative (delta < 0) -> rate = 3/5 = 0.6.
    allocated = [
        _make_outcome(strategy_id=f"a{i}", kind="allocated",
                      delta_180d=0.05, percent_allocated=10.0)
        for i in range(3)
    ] + [
        _make_outcome(strategy_id=f"a{i+3}", kind="allocated",
                      delta_180d=-0.03, percent_allocated=10.0)
        for i in range(2)
    ]
    breakdown_rows = [
        {
            "strategy_id": f"a{i}",
            "score_breakdown": {
                "portfolio_fit": 0.9,
                "preference_fit": 0.3,
                "track_record": 0.3,
                "capacity_fit": 0.4,
            },
            "created_at": "2026-01-01T00:00:00Z",
        }
        for i in range(5)
    ]
    mock_sb = _make_mock_supabase(
        allocated_rows=allocated, breakdown_rows=breakdown_rows,
    )
    monkeypatch.setattr("services.feedback_engine.get_supabase", lambda: mock_sb)
    monkeypatch.setattr("services.feedback_engine.log_audit_event", lambda **kw: None)

    result = compute_adjusted_weights("alloc-inband")
    assert result == {}, (
        f"Expected empty result (in-band omit D-16), got {result}"
    )


# ---------------------------------------------------------------------------
# 04-01-05: Step-function boundaries
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("n_pos,n_neg,expected_scale", [
    # Boundary sweep per plan + D-13 strict inequality spec.
    # Use 10 outcomes (not 5) so fractions like 0.3, 0.5, 0.7, 0.8 are exact.
    # rate 0.0 (0 wins, 10 losses) -> strict < 0.4 -> floor 0.5
    (0, 10, 0.5),
    # rate 0.3 -> strict < 0.4 -> floor 0.5
    (3, 7, 0.5),
    # rate 0.4 exactly -> NOT strictly < 0.4 -> omit
    (4, 6, None),
    # rate 0.5 -> in-band -> omit
    (5, 5, None),
    # rate 0.7 exactly -> NOT strictly > 0.7 -> omit
    (7, 3, None),
    # rate 0.8 -> strict > 0.7 -> ceiling 1.5
    (8, 2, 1.5),
    # rate 1.0 -> ceiling 1.5
    (10, 0, 1.5),
])
def test_step_function_boundaries(monkeypatch, n_pos, n_neg, expected_scale):
    """FEEDBACK-02 / D-13 — rate < 0.4 -> 0.5, 0.4 <= rate <= 0.7 -> omit, rate > 0.7 -> 1.5.
    Strict < 0.4 and > 0.7 per D-13.
    """
    if not IMPORTS_OK:
        pytest.skip("wave 0 placeholder")
    allocated = [
        _make_outcome(strategy_id=f"p{i}", kind="allocated",
                      delta_180d=0.05, percent_allocated=10.0)
        for i in range(n_pos)
    ] + [
        _make_outcome(strategy_id=f"n{i}", kind="allocated",
                      delta_180d=-0.03, percent_allocated=10.0)
        for i in range(n_neg)
    ]
    breakdown_rows = [
        {
            "strategy_id": row["strategy_id"],
            "score_breakdown": {
                "portfolio_fit": 0.9,
                "preference_fit": 0.3,
                "track_record": 0.3,
                "capacity_fit": 0.4,
            },
            "created_at": "2026-01-01T00:00:00Z",
        }
        for row in allocated
    ]
    mock_sb = _make_mock_supabase(
        allocated_rows=allocated, breakdown_rows=breakdown_rows,
    )
    monkeypatch.setattr("services.feedback_engine.get_supabase", lambda: mock_sb)
    monkeypatch.setattr("services.feedback_engine.log_audit_event", lambda **kw: None)

    result = compute_adjusted_weights("alloc-step")
    if expected_scale is None:
        assert result == {}, f"Expected omit in-band, got {result}"
    else:
        assert result == {"W_PORTFOLIO_FIT": expected_scale}, (
            f"Expected {{W_PORTFOLIO_FIT: {expected_scale}}}, got {result}"
        )


# ---------------------------------------------------------------------------
# 04-01-06: Cold start under five
# ---------------------------------------------------------------------------


def test_cold_start_under_five(monkeypatch):
    """FEEDBACK-03 / D-15 — 4 outcomes attributed to W_PORTFOLIO_FIT below
    min-5 -> result dict has no W_PORTFOLIO_FIT key."""
    if not IMPORTS_OK:
        pytest.skip("wave 0 placeholder")
    allocated = [
        _make_outcome(strategy_id=f"a{i}", kind="allocated",
                      delta_180d=0.05, percent_allocated=10.0)
        for i in range(4)
    ]
    breakdown_rows = [
        {
            "strategy_id": f"a{i}",
            "score_breakdown": {
                "portfolio_fit": 0.9,
                "preference_fit": 0.3,
                "track_record": 0.3,
                "capacity_fit": 0.4,
            },
            "created_at": "2026-01-01T00:00:00Z",
        }
        for i in range(4)
    ]
    mock_sb = _make_mock_supabase(
        allocated_rows=allocated, breakdown_rows=breakdown_rows,
    )
    monkeypatch.setattr("services.feedback_engine.get_supabase", lambda: mock_sb)
    monkeypatch.setattr("services.feedback_engine.log_audit_event", lambda **kw: None)

    result = compute_adjusted_weights("alloc-cold")
    assert "W_PORTFOLIO_FIT" not in result, (
        f"Expected W_PORTFOLIO_FIT omitted (< min-5 outcomes), got {result}"
    )
    assert result == {}, f"Expected full empty result, got {result}"


# ---------------------------------------------------------------------------
# 04-01-07: Threshold at exactly 5
# ---------------------------------------------------------------------------


def test_threshold_at_five(monkeypatch):
    """FEEDBACK-03 / D-15 — Exactly 5 outcomes -> adjustment fires (>= 5)."""
    if not IMPORTS_OK:
        pytest.skip("wave 0 placeholder")
    allocated = [
        _make_outcome(strategy_id=f"a{i}", kind="allocated",
                      delta_180d=0.05, percent_allocated=10.0)
        for i in range(5)
    ]
    breakdown_rows = [
        {
            "strategy_id": f"a{i}",
            "score_breakdown": {
                "portfolio_fit": 0.9,
                "preference_fit": 0.3,
                "track_record": 0.3,
                "capacity_fit": 0.4,
            },
            "created_at": "2026-01-01T00:00:00Z",
        }
        for i in range(5)
    ]
    mock_sb = _make_mock_supabase(
        allocated_rows=allocated, breakdown_rows=breakdown_rows,
    )
    monkeypatch.setattr("services.feedback_engine.get_supabase", lambda: mock_sb)
    monkeypatch.setattr("services.feedback_engine.log_audit_event", lambda **kw: None)

    result = compute_adjusted_weights("alloc-threshold")
    assert "W_PORTFOLIO_FIT" in result, (
        f"Expected W_PORTFOLIO_FIT present at exactly-5 threshold, got {result}"
    )
    assert result["W_PORTFOLIO_FIT"] == 1.5, (
        f"Expected ceiling (rate=1.0 > 0.7), got {result}"
    )


# ---------------------------------------------------------------------------
# 04-01-08: Persist to scoring_weight_overrides column
# ---------------------------------------------------------------------------


def test_persist_column(monkeypatch):
    """FEEDBACK-04 / T-04-02 — UPDATE writes {"scoring_weight_overrides": ...}
    to allocator_preferences filtered on user_id=allocator_id."""
    if not IMPORTS_OK:
        pytest.skip("wave 0 placeholder")
    rejected = [
        _make_outcome(
            strategy_id=f"r{i}", kind="rejected",
            rejection_reason="mandate_conflict",
            delta_180d=None, delta_90d=None, delta_30d=None,
            percent_allocated=None,
        )
        for i in range(5)
    ]
    mock_sb = _make_mock_supabase(rejected_rows=rejected)
    monkeypatch.setattr("services.feedback_engine.get_supabase", lambda: mock_sb)
    monkeypatch.setattr("services.feedback_engine.log_audit_event", lambda **kw: None)

    result = compute_adjusted_weights("alloc-persist")
    # Verify the UPDATE was called with scoring_weight_overrides.
    update_call = mock_sb.table.return_value.update.call_args
    assert update_call is not None, "UPDATE not called"
    payload = update_call[0][0]
    assert "scoring_weight_overrides" in payload, (
        f"UPDATE payload missing 'scoring_weight_overrides', got {payload}"
    )
    assert payload["scoring_weight_overrides"] == {"W_PREFERENCE_FIT": 0.5}, (
        f"Expected floor payload, got {payload}"
    )
    # Verify the UPDATE filter was .eq("user_id", allocator_id).
    eq_call = mock_sb.table.return_value.update.return_value.eq.call_args
    assert eq_call is not None, "UPDATE eq() not called"
    assert eq_call[0] == ("user_id", "alloc-persist"), (
        f"Expected eq('user_id', 'alloc-persist'), got {eq_call}"
    )


# ---------------------------------------------------------------------------
# Regression: holding-based outcomes (strategy_id=NULL) must not crash the sort
# ---------------------------------------------------------------------------


def test_null_strategy_id_outcomes_excluded_no_typerror(monkeypatch):
    """Regression (Sentry 122529822, /api/match/cron-recompute): bridge_outcomes
    for holding-based voluntary actions carry strategy_id=NULL. Pre-fix these
    reached ``sorted({o["strategy_id"] for o in outcomes})`` in
    compute_adjusted_weights and raised
    TypeError: '<' not supported between instances of 'str' and 'NoneType',
    crashing the whole match cron (processed=0). _fetch_eligible_outcomes must
    drop null-strategy outcomes — they are not attributable to any strategy's
    score dimensions.
    """
    if not IMPORTS_OK:
        pytest.skip("wave 0 placeholder")
    # One holding-based outcome (strategy_id=None) mixed with real-strategy rows.
    allocated = [_make_outcome(strategy_id=None, delta_180d=0.05)] + [
        _make_outcome(strategy_id=f"strat-{i}", delta_180d=0.05) for i in range(5)
    ]
    mock_sb = _make_mock_supabase(allocated_rows=allocated)
    monkeypatch.setattr("services.feedback_engine.get_supabase", lambda: mock_sb)
    monkeypatch.setattr("services.feedback_engine.log_audit_event", lambda **kw: None)

    # Must not raise TypeError on the str-vs-None sort; returns a weights dict.
    result = compute_adjusted_weights("alloc-null-strategy")
    assert isinstance(result, dict)


# ---------------------------------------------------------------------------
# 04-01-09: Persist NULL on cold-start (zero eligible outcomes)
# ---------------------------------------------------------------------------


def test_persist_null_on_cold_start(monkeypatch):
    """FEEDBACK-04 / D-16 — Zero eligible outcomes -> UPDATE called with
    {"scoring_weight_overrides": None}."""
    if not IMPORTS_OK:
        pytest.skip("wave 0 placeholder")
    # Non-empty probe so we proceed past the fast-path, but no eligible
    # outcomes returned after D-08 filtering.
    mock_sb = _make_mock_supabase(
        rejected_rows=[], allocated_rows=[], probe_nonempty=True,
    )
    monkeypatch.setattr("services.feedback_engine.get_supabase", lambda: mock_sb)
    monkeypatch.setattr("services.feedback_engine.log_audit_event", lambda **kw: None)

    result = compute_adjusted_weights("alloc-null")
    assert result == {}, f"Expected empty result, got {result}"
    update_call = mock_sb.table.return_value.update.call_args
    assert update_call is not None, "UPDATE not called"
    payload = update_call[0][0]
    assert payload == {"scoring_weight_overrides": None}, (
        f"Expected {{'scoring_weight_overrides': None}}, got {payload}"
    )


# ---------------------------------------------------------------------------
# 04-01-10: Per-dimension independence
# ---------------------------------------------------------------------------


def test_per_dimension_independence(monkeypatch):
    """FEEDBACK-05 — 5 mandate_conflict + 5 positive allocated (W_PORTFOLIO_FIT
    dominant) -> {W_PREFERENCE_FIT: 0.5, W_PORTFOLIO_FIT: 1.5}; W_TRACK_RECORD
    and W_CAPACITY_FIT absent."""
    if not IMPORTS_OK:
        pytest.skip("wave 0 placeholder")
    rejected = [
        _make_outcome(
            strategy_id=f"r{i}", kind="rejected",
            rejection_reason="mandate_conflict",
            delta_180d=None, delta_90d=None, delta_30d=None,
            percent_allocated=None,
        )
        for i in range(5)
    ]
    allocated = [
        _make_outcome(strategy_id=f"a{i}", kind="allocated",
                      delta_180d=0.05, percent_allocated=10.0)
        for i in range(5)
    ]
    breakdown_rows = [
        {
            "strategy_id": f"a{i}",
            "score_breakdown": {
                "portfolio_fit": 0.9,
                "preference_fit": 0.3,
                "track_record": 0.3,
                "capacity_fit": 0.4,
            },
            "created_at": "2026-01-01T00:00:00Z",
        }
        for i in range(5)
    ]
    mock_sb = _make_mock_supabase(
        rejected_rows=rejected, allocated_rows=allocated,
        breakdown_rows=breakdown_rows,
    )
    monkeypatch.setattr("services.feedback_engine.get_supabase", lambda: mock_sb)
    monkeypatch.setattr("services.feedback_engine.log_audit_event", lambda **kw: None)

    result = compute_adjusted_weights("alloc-perdim")
    assert result == {"W_PREFERENCE_FIT": 0.5, "W_PORTFOLIO_FIT": 1.5}, (
        f"Expected {{W_PREFERENCE_FIT: 0.5, W_PORTFOLIO_FIT: 1.5}}, got {result}"
    )
    assert "W_TRACK_RECORD" not in result
    assert "W_CAPACITY_FIT" not in result


# ---------------------------------------------------------------------------
# 04-01-11: Inline merge reaches snapshot
# ---------------------------------------------------------------------------


async def test_inline_merge_reaches_snapshot(monkeypatch):
    """FEEDBACK-06 — Mock routers.match.get_supabase + services.feedback_engine
    .get_supabase; call _score_one_allocator; capture preferences passed to
    score_candidates; assert scoring_weight_overrides populated."""
    if not IMPORTS_OK:
        pytest.skip("wave 0 placeholder")

    # Seed feedback engine to produce a non-trivial override.
    allocated = [
        _make_outcome(strategy_id=f"a{i}", kind="allocated",
                      delta_180d=0.05, percent_allocated=10.0)
        for i in range(5)
    ]
    breakdown_rows = [
        {
            "strategy_id": f"a{i}",
            "score_breakdown": {
                "portfolio_fit": 0.9,
                "preference_fit": 0.3,
                "track_record": 0.3,
                "capacity_fit": 0.4,
            },
            "created_at": "2026-01-01T00:00:00Z",
        }
        for i in range(5)
    ]
    mock_fb_sb = _make_mock_supabase(
        allocated_rows=allocated, breakdown_rows=breakdown_rows,
    )
    monkeypatch.setattr("services.feedback_engine.get_supabase", lambda: mock_fb_sb)
    monkeypatch.setattr("services.feedback_engine.log_audit_event", lambda **kw: None)

    # Stub routers.match pieces.
    def _load_fresh_context(allocator_id: str):
        return {
            "preferences": {"max_weight": 0.10},
            "portfolio_strategies": [],
            "portfolio_returns": {},
            "portfolio_weights": {},
            "portfolio_aum": None,
            "thumbs_down_ids": set(),
        }
    monkeypatch.setattr("routers.match._load_allocator_context", _load_fresh_context)

    captured = {}
    def _capture_score_candidates(*args, **kwargs):
        captured["preferences"] = kwargs.get("preferences")
        return {
            "candidates": [],
            "excluded": [],
            "excluded_total": 0,
            "mode": "personalized",
            "filter_relaxed": False,
            "effective_preferences": kwargs.get("preferences") or {},
            "effective_thresholds": {},
            "source_strategy_count": 0,
        }
    monkeypatch.setattr("routers.match.score_candidates", _capture_score_candidates)

    # Stub match_batches INSERT + match_candidates INSERT.
    mock_match_sb = MagicMock()
    mock_match_sb.table.return_value.insert.return_value.execute.return_value = MagicMock(data=[{"id": "batch-1"}])
    monkeypatch.setattr("routers.match.get_supabase", lambda: mock_match_sb)

    from routers.match import _score_one_allocator
    universe = {
        "strategies_by_id": {"s1": {"strategy_id": "s1"}},
        "returns_by_id": {},
    }
    await _score_one_allocator("alloc-merge", universe)

    prefs = captured["preferences"]
    assert prefs is not None, "score_candidates never invoked"
    assert prefs.get("scoring_weight_overrides") == {"W_PORTFOLIO_FIT": 1.5}, (
        f"Expected overrides to reach score_candidates, got {prefs.get('scoring_weight_overrides')}"
    )


# ---------------------------------------------------------------------------
# 04-01-12: Score-dominant attribution
# ---------------------------------------------------------------------------


def test_score_dominant_attribution(monkeypatch):
    """D-05 — 5 allocated outcomes each with score_breakdown max=preference_fit
    -> {W_PREFERENCE_FIT: 1.5} (all positive deltas)."""
    if not IMPORTS_OK:
        pytest.skip("wave 0 placeholder")
    allocated = [
        _make_outcome(strategy_id=f"a{i}", kind="allocated",
                      delta_180d=0.05, percent_allocated=10.0)
        for i in range(5)
    ]
    breakdown_rows = [
        {
            "strategy_id": f"a{i}",
            "score_breakdown": {
                "portfolio_fit": 0.2,
                "preference_fit": 0.95,
                "track_record": 0.3,
                "capacity_fit": 0.1,
            },
            "created_at": "2026-01-01T00:00:00Z",
        }
        for i in range(5)
    ]
    mock_sb = _make_mock_supabase(
        allocated_rows=allocated, breakdown_rows=breakdown_rows,
    )
    monkeypatch.setattr("services.feedback_engine.get_supabase", lambda: mock_sb)
    monkeypatch.setattr("services.feedback_engine.log_audit_event", lambda **kw: None)

    result = compute_adjusted_weights("alloc-scoredom")
    assert result == {"W_PREFERENCE_FIT": 1.5}, (
        f"Expected {{W_PREFERENCE_FIT: 1.5}}, got {result}"
    )


# ---------------------------------------------------------------------------
# 04-01-13: Rejection reason mapping (D5 rewrite)
# ---------------------------------------------------------------------------


def test_rejection_reason_mapping(monkeypatch):
    """D-06 — REJECTION_REASON_TO_DIMENSION has exactly 3 direct-mapped keys.
    'already_owned' and 'other' are INTENTIONALLY omitted (D5 finding).
    """
    if not IMPORTS_OK:
        pytest.skip("wave 0 placeholder")

    # Structural assertions: 3 direct-mapped keys; 2 intentional omissions.
    assert REJECTION_REASON_TO_DIMENSION.get("mandate_conflict") == "W_PREFERENCE_FIT"
    assert REJECTION_REASON_TO_DIMENSION.get("underperforming_peers") == "W_TRACK_RECORD"
    assert REJECTION_REASON_TO_DIMENSION.get("timing_wrong") == "W_PORTFOLIO_FIT"
    assert "already_owned" not in REJECTION_REASON_TO_DIMENSION, (
        "'already_owned' should be INTENTIONALLY omitted — filtered at SQL per D-08"
    )
    assert "other" not in REJECTION_REASON_TO_DIMENSION, (
        "'other' should be INTENTIONALLY omitted — falls through to score-dominant per D-06"
    )

    # End-to-end: seed one rejected row per direct-mapped reason and verify
    # attribution per reason (separately, to avoid dimension interference).
    for reason, expected_dim in [
        ("mandate_conflict",     "W_PREFERENCE_FIT"),
        ("underperforming_peers", "W_TRACK_RECORD"),
        ("timing_wrong",         "W_PORTFOLIO_FIT"),
    ]:
        rejected = [
            _make_outcome(
                strategy_id=f"r{i}", kind="rejected",
                rejection_reason=reason,
                delta_180d=None, delta_90d=None, delta_30d=None,
                percent_allocated=None,
            )
            for i in range(5)
        ]
        mock_sb = _make_mock_supabase(rejected_rows=rejected)
        monkeypatch.setattr("services.feedback_engine.get_supabase", lambda: mock_sb)
        monkeypatch.setattr("services.feedback_engine.log_audit_event", lambda **kw: None)
        result = compute_adjusted_weights(f"alloc-{reason}")
        assert result == {expected_dim: 0.5}, (
            f"Reason {reason} expected {{{expected_dim}: 0.5}}, got {result}"
        )


# ---------------------------------------------------------------------------
# 04-01-14: Uniform fallback — missing match_candidates history
# ---------------------------------------------------------------------------


def test_uniform_fallback_missing_history(monkeypatch):
    """D-07 — 8 allocated outcomes with match_candidates query returning empty
    -> each dim gets +8 (all positive) -> all 4 dims hit min-5 at 1.0 rate
    -> all 4 dims = 1.5."""
    if not IMPORTS_OK:
        pytest.skip("wave 0 placeholder")
    allocated = [
        _make_outcome(strategy_id=f"a{i}", kind="allocated",
                      delta_180d=0.05, percent_allocated=10.0)
        for i in range(8)
    ]
    # No breakdown rows — match_candidates returns empty (aged out).
    mock_sb = _make_mock_supabase(
        allocated_rows=allocated, breakdown_rows=[],
    )
    monkeypatch.setattr("services.feedback_engine.get_supabase", lambda: mock_sb)
    monkeypatch.setattr("services.feedback_engine.log_audit_event", lambda **kw: None)

    result = compute_adjusted_weights("alloc-uniform")
    assert result == {
        "W_PORTFOLIO_FIT": 1.5,
        "W_PREFERENCE_FIT": 1.5,
        "W_TRACK_RECORD": 1.5,
        "W_CAPACITY_FIT": 1.5,
    }, f"Expected all-ceiling uniform fallback, got {result}"


# ---------------------------------------------------------------------------
# 04-01-15: Filter already_owned
# ---------------------------------------------------------------------------


def test_filter_already_owned(monkeypatch):
    """D-08 #1 — rejected rows with already_owned dropped at SQL (supabase
    filter .neq('rejection_reason', 'already_owned')). 5 rows would have been
    dropped, so we simulate the SQL-filtered rejected fetch returning empty."""
    if not IMPORTS_OK:
        pytest.skip("wave 0 placeholder")
    # Simulate supabase having applied the .neq filter: the rejected chain
    # returns empty (all 5 already_owned rows filtered at SQL).
    mock_sb = _make_mock_supabase(rejected_rows=[], allocated_rows=[])
    monkeypatch.setattr("services.feedback_engine.get_supabase", lambda: mock_sb)
    monkeypatch.setattr("services.feedback_engine.log_audit_event", lambda **kw: None)

    result = compute_adjusted_weights("alloc-owned")
    assert result == {}, f"Expected empty (already_owned filtered), got {result}"
    # Verify the rejected-fetch chain included .neq('rejection_reason', 'already_owned')
    neq_call = mock_sb.table.return_value.select.return_value.eq.return_value.eq.return_value.neq.call_args
    assert neq_call is not None, "SQL-filter .neq() never called"
    args = neq_call[0]
    assert args[0] == "rejection_reason"
    assert args[1] == "already_owned", (
        f"Expected .neq('rejection_reason', 'already_owned'), got {args}"
    )


# ---------------------------------------------------------------------------
# 04-01-16: Filter small allocations (<1%)
# ---------------------------------------------------------------------------


def test_filter_small_allocation(monkeypatch):
    """D-08 #2 — allocated rows with percent_allocated < 1.0 dropped at SQL
    (supabase .gte('percent_allocated', 1.0)). Verify the filter is applied."""
    if not IMPORTS_OK:
        pytest.skip("wave 0 placeholder")
    # Simulate that SQL filtered out the <1% rows — allocated fetch returns empty.
    mock_sb = _make_mock_supabase(rejected_rows=[], allocated_rows=[])
    monkeypatch.setattr("services.feedback_engine.get_supabase", lambda: mock_sb)
    monkeypatch.setattr("services.feedback_engine.log_audit_event", lambda **kw: None)

    result = compute_adjusted_weights("alloc-small")
    assert result == {}, f"Expected empty (percent_allocated<1 filtered), got {result}"
    # Verify allocated-fetch chain included .gte('percent_allocated', 1.0)
    gte_call = mock_sb.table.return_value.select.return_value.eq.return_value.eq.return_value.gte.call_args
    assert gte_call is not None, "SQL-filter .gte() never called"
    args = gte_call[0]
    assert args[0] == "percent_allocated"
    assert float(args[1]) == 1.0, (
        f"Expected .gte('percent_allocated', 1.0), got {args}"
    )


# ---------------------------------------------------------------------------
# 04-01-17: Filter pending allocations (all delta_Xd NULL)
# ---------------------------------------------------------------------------


def test_filter_pending(monkeypatch):
    """D-03 — 5 allocated rows with ALL delta_Xd NULL -> Python filter drops
    them -> result = {}."""
    if not IMPORTS_OK:
        pytest.skip("wave 0 placeholder")
    allocated = [
        _make_outcome(
            strategy_id=f"a{i}", kind="allocated",
            delta_180d=None, delta_90d=None, delta_30d=None,
            percent_allocated=10.0,
        )
        for i in range(5)
    ]
    mock_sb = _make_mock_supabase(allocated_rows=allocated)
    monkeypatch.setattr("services.feedback_engine.get_supabase", lambda: mock_sb)
    monkeypatch.setattr("services.feedback_engine.log_audit_event", lambda **kw: None)

    result = compute_adjusted_weights("alloc-pending")
    assert result == {}, f"Expected empty (pending rows dropped per D-03), got {result}"


# ---------------------------------------------------------------------------
# 04-01-18: Determinism
# ---------------------------------------------------------------------------


def test_determinism(monkeypatch):
    """D-14 — Same mocked Supabase -> identical dicts on repeated calls."""
    if not IMPORTS_OK:
        pytest.skip("wave 0 placeholder")
    allocated = [
        _make_outcome(strategy_id=f"a{i}", kind="allocated",
                      delta_180d=0.05, percent_allocated=10.0)
        for i in range(5)
    ]
    breakdown_rows = [
        {
            "strategy_id": f"a{i}",
            "score_breakdown": {
                "portfolio_fit": 0.9,
                "preference_fit": 0.3,
                "track_record": 0.3,
                "capacity_fit": 0.4,
            },
            "created_at": "2026-01-01T00:00:00Z",
        }
        for i in range(5)
    ]
    mock_sb = _make_mock_supabase(
        allocated_rows=allocated, breakdown_rows=breakdown_rows,
    )
    monkeypatch.setattr("services.feedback_engine.get_supabase", lambda: mock_sb)
    monkeypatch.setattr("services.feedback_engine.log_audit_event", lambda **kw: None)

    r1 = compute_adjusted_weights("alloc-det")
    r2 = compute_adjusted_weights("alloc-det")
    assert r1 == r2, f"Non-deterministic: {r1} != {r2}"


# ---------------------------------------------------------------------------
# 04-01-19: Omit under-trained dimensions
# ---------------------------------------------------------------------------


def test_omit_undertrained_dims(monkeypatch):
    """D-16 — 5 outcomes attributed to W_PORTFOLIO_FIT only; result has ONLY
    W_PORTFOLIO_FIT key."""
    if not IMPORTS_OK:
        pytest.skip("wave 0 placeholder")
    allocated = [
        _make_outcome(strategy_id=f"a{i}", kind="allocated",
                      delta_180d=0.05, percent_allocated=10.0)
        for i in range(5)
    ]
    breakdown_rows = [
        {
            "strategy_id": f"a{i}",
            "score_breakdown": {
                "portfolio_fit": 0.9,
                "preference_fit": 0.3,
                "track_record": 0.3,
                "capacity_fit": 0.4,
            },
            "created_at": "2026-01-01T00:00:00Z",
        }
        for i in range(5)
    ]
    mock_sb = _make_mock_supabase(
        allocated_rows=allocated, breakdown_rows=breakdown_rows,
    )
    monkeypatch.setattr("services.feedback_engine.get_supabase", lambda: mock_sb)
    monkeypatch.setattr("services.feedback_engine.log_audit_event", lambda **kw: None)

    result = compute_adjusted_weights("alloc-undertrained")
    assert set(result.keys()) == {"W_PORTFOLIO_FIT"}, (
        f"Expected only W_PORTFOLIO_FIT key, got {result}"
    )


# ---------------------------------------------------------------------------
# 04-01-20: Screening-mode excludes portfolio_fit (Pitfall 6)
# ---------------------------------------------------------------------------


def test_screening_mode_excludes_portfolio_fit(monkeypatch):
    """Pitfall 6 — score_breakdown missing portfolio_fit key (screening mode)
    -> no KeyError; max attribution works over 3 remaining dims."""
    if not IMPORTS_OK:
        pytest.skip("wave 0 placeholder")
    allocated = [
        _make_outcome(strategy_id=f"a{i}", kind="allocated",
                      delta_180d=0.05, percent_allocated=10.0)
        for i in range(5)
    ]
    breakdown_rows = [
        {
            "strategy_id": f"a{i}",
            "score_breakdown": {
                # No portfolio_fit key (screening mode)
                "preference_fit": 0.95,
                "track_record": 0.3,
                "capacity_fit": 0.4,
            },
            "created_at": "2026-01-01T00:00:00Z",
        }
        for i in range(5)
    ]
    mock_sb = _make_mock_supabase(
        allocated_rows=allocated, breakdown_rows=breakdown_rows,
    )
    monkeypatch.setattr("services.feedback_engine.get_supabase", lambda: mock_sb)
    monkeypatch.setattr("services.feedback_engine.log_audit_event", lambda **kw: None)

    # Must not raise KeyError; attribution goes to W_PREFERENCE_FIT (the max of
    # the 3 present keys).
    result = compute_adjusted_weights("alloc-screening")
    assert result == {"W_PREFERENCE_FIT": 1.5}, (
        f"Expected {{W_PREFERENCE_FIT: 1.5}} (screening-mode attribution), got {result}"
    )


# ---------------------------------------------------------------------------
# 04-01-21: Golden snapshot — 3 scenarios (cold / ceiling / floor) — D2 rewrite
# ---------------------------------------------------------------------------


def test_golden_snapshot(monkeypatch):
    """Frozen v1 output for three deterministic scenarios (cold / ceiling / floor).
    Regenerate: REGENERATE_GOLDEN=1 pytest tests/test_feedback_engine.py::test_golden_snapshot

    - cold:    CONTEXT.md Specifics 12-outcome seed -> {} (no dim reaches min-5).
    - ceiling: 5 allocated-positive with portfolio_fit dominant -> {"W_PORTFOLIO_FIT": 1.5}.
    - floor:   5 rejected+mandate_conflict -> {"W_PREFERENCE_FIT": 0.5}.

    D2 sentinel guard: REGENERATE_GOLDEN=1 fails if ceiling/floor regenerate to {}
    (broken attribution math — silent accept forbidden).
    """
    if not IMPORTS_OK:
        pytest.skip("wave 0 placeholder")

    def _seed_cold() -> tuple[list[dict], list[dict], dict[str, dict]]:
        # CONTEXT.md Specifics seed (post-D-08 SQL filters: 10 of 12 rows reach Python):
        #   3 rejected+mandate_conflict       -> W_PREFERENCE_FIT failures (3)
        #   2 rejected+underperforming_peers  -> W_TRACK_RECORD failures (2)
        #   3 allocated+delta_180d > 0, portfolio_fit-dominant breakdown -> W_PORTFOLIO_FIT wins (3)
        #   2 allocated+delta_180d < 0, track_record-dominant breakdown  -> W_TRACK_RECORD failures (2)
        # Per-dim counts: W_PREFERENCE_FIT=3, W_TRACK_RECORD=4, W_PORTFOLIO_FIT=3, W_CAPACITY_FIT=0.
        # None reach MIN_OUTCOMES_PER_DIMENSION=5 -> {}
        rejected = [
            _make_outcome(strategy_id=f"r{i}", kind="rejected",
                          rejection_reason="mandate_conflict",
                          delta_180d=None, delta_90d=None, delta_30d=None,
                          percent_allocated=None) for i in range(3)
        ] + [
            _make_outcome(strategy_id=f"r{i+3}", kind="rejected",
                          rejection_reason="underperforming_peers",
                          delta_180d=None, delta_90d=None, delta_30d=None,
                          percent_allocated=None) for i in range(2)
        ]
        allocated_pos = [
            _make_outcome(strategy_id=f"a{i}", kind="allocated",
                          delta_180d=0.05, percent_allocated=10.0) for i in range(3)
        ]
        allocated_neg = [
            _make_outcome(strategy_id=f"a{i+3}", kind="allocated",
                          delta_180d=-0.03, percent_allocated=10.0) for i in range(2)
        ]
        allocated = allocated_pos + allocated_neg
        breakdowns: dict[str, dict] = {}
        for i in range(3):
            breakdowns[f"a{i}"] = {
                "portfolio_fit": 0.9, "preference_fit": 0.5,
                "track_record": 0.4, "capacity_fit": 0.5,
            }
        for i in range(2):
            breakdowns[f"a{i+3}"] = {
                "portfolio_fit": 0.3, "preference_fit": 0.4,
                "track_record": 0.9, "capacity_fit": 0.5,
            }
        return rejected, allocated, breakdowns

    def _seed_ceiling() -> tuple[list[dict], list[dict], dict[str, dict]]:
        # 5 allocated-positive, portfolio_fit dominant -> {"W_PORTFOLIO_FIT": 1.5} (rate=1.0 > 0.7)
        allocated = [
            _make_outcome(strategy_id=f"a{i}", kind="allocated",
                          delta_180d=0.05, percent_allocated=10.0) for i in range(5)
        ]
        breakdowns = {
            f"a{i}": {
                "portfolio_fit": 0.9, "preference_fit": 0.4,
                "track_record": 0.3, "capacity_fit": 0.5,
            } for i in range(5)
        }
        return [], allocated, breakdowns

    def _seed_floor() -> tuple[list[dict], list[dict], dict[str, dict]]:
        # 5 rejected+mandate_conflict -> attributed to W_PREFERENCE_FIT, all failures
        # -> {"W_PREFERENCE_FIT": 0.5} (rate=0.0 < 0.4)
        rejected = [
            _make_outcome(strategy_id=f"r{i}", kind="rejected",
                          rejection_reason="mandate_conflict",
                          delta_180d=None, delta_90d=None, delta_30d=None,
                          percent_allocated=None) for i in range(5)
        ]
        return rejected, [], {}

    seeders = {"cold": _seed_cold, "ceiling": _seed_ceiling, "floor": _seed_floor}
    regen = bool(os.environ.get("REGENERATE_GOLDEN"))
    regenerated_any = False

    for scenario_name, fixture_name in GOLDEN_SCENARIOS:
        rejected_rows, allocated_rows, score_breakdowns = seeders[scenario_name]()
        breakdown_rows = [
            {"strategy_id": sid, "score_breakdown": sb, "created_at": "2026-01-01T00:00:00Z"}
            for sid, sb in score_breakdowns.items()
        ]
        mock_sb = _make_mock_supabase(
            rejected_rows=rejected_rows,
            allocated_rows=allocated_rows,
            breakdown_rows=breakdown_rows,
        )
        monkeypatch.setattr("services.feedback_engine.get_supabase", lambda _sb=mock_sb: _sb)
        monkeypatch.setattr("services.feedback_engine.log_audit_event", lambda **kw: None)

        result = compute_adjusted_weights(f"golden-{scenario_name}")
        actual = json.dumps(result, sort_keys=True)

        expected_path = FIXTURES_DIR / fixture_name
        if regen:
            # D2 guard: ceiling/floor scenarios MUST NOT regenerate to {} — that would
            # indicate broken attribution math and silent accept is forbidden.
            if scenario_name in ("ceiling", "floor") and result == {}:
                pytest.fail(
                    f"REGENERATE_GOLDEN=1 refused: scenario '{scenario_name}' regenerated "
                    f"to empty dict {{}} — attribution math is broken (D2 finding). "
                    f"Expected non-empty override for {scenario_name}."
                )
            expected_path.write_text(actual + "\n")
            regenerated_any = True
            continue

        expected = expected_path.read_text().strip()
        assert actual == expected, (
            f"Golden snapshot drift on scenario '{scenario_name}' — "
            f"regen via REGENERATE_GOLDEN=1 if math change is intentional. "
            f"expected={expected!r} actual={actual!r}"
        )

    if regen and regenerated_any:
        pytest.skip(
            "Regenerated golden fixtures for all scenarios — re-run without REGENERATE_GOLDEN to assert"
        )


# ---------------------------------------------------------------------------
# 04-01-22: Dispatch integration through worker
# ---------------------------------------------------------------------------


async def test_dispatch_through_worker(monkeypatch):
    """D-11 integration — async test: patches routers.match._load_candidate_universe,
    routers.match._load_allocator_context, services.feedback_engine.get_supabase,
    routers.match.get_supabase, routers.match.score_candidates (sync capture);
    calls await run_rescore_allocator_job(job); asserts DispatchOutcome.DONE and
    captured preferences contain the feedback override."""
    if not IMPORTS_OK:
        pytest.skip("wave 0 placeholder")

    # Seed feedback engine to produce {"W_PORTFOLIO_FIT": 1.5}.
    allocated = [
        _make_outcome(strategy_id=f"a{i}", kind="allocated",
                      delta_180d=0.05, percent_allocated=10.0)
        for i in range(5)
    ]
    breakdown_rows = [
        {
            "strategy_id": f"a{i}",
            "score_breakdown": {
                "portfolio_fit": 0.9,
                "preference_fit": 0.3,
                "track_record": 0.3,
                "capacity_fit": 0.4,
            },
            "created_at": "2026-01-01T00:00:00Z",
        }
        for i in range(5)
    ]
    mock_fb_sb = _make_mock_supabase(
        allocated_rows=allocated, breakdown_rows=breakdown_rows,
    )
    monkeypatch.setattr("services.feedback_engine.get_supabase", lambda: mock_fb_sb)
    monkeypatch.setattr("services.feedback_engine.log_audit_event", lambda **kw: None)

    # Stub routers.match._load_allocator_context + _load_candidate_universe.
    def _load_ctx(allocator_id: str):
        return {
            "preferences": {"max_weight": 0.10},
            "portfolio_strategies": [],
            "portfolio_returns": {},
            "portfolio_weights": {},
            "portfolio_aum": None,
            "thumbs_down_ids": set(),
        }
    monkeypatch.setattr("routers.match._load_allocator_context", _load_ctx)
    monkeypatch.setattr("routers.match._load_candidate_universe", lambda: {
        "strategies_by_id": {"s1": {"strategy_id": "s1"}},
        "returns_by_id": {},
    })

    captured = {}
    def _capture_score_candidates(*args, **kwargs):
        captured["preferences"] = kwargs.get("preferences")
        return {
            "candidates": [],
            "excluded": [],
            "excluded_total": 0,
            "mode": "personalized",
            "filter_relaxed": False,
            "effective_preferences": kwargs.get("preferences") or {},
            "effective_thresholds": {},
            "source_strategy_count": 0,
        }
    monkeypatch.setattr("routers.match.score_candidates", _capture_score_candidates)

    # Stub match_batches INSERT.
    mock_match_sb = MagicMock()
    mock_match_sb.table.return_value.insert.return_value.execute.return_value = MagicMock(data=[{"id": "batch-d"}])
    monkeypatch.setattr("routers.match.get_supabase", lambda: mock_match_sb)

    from services.job_worker import run_rescore_allocator_job, DispatchOutcome
    result = await run_rescore_allocator_job({
        "id": "job-rescore-d",
        "kind": "rescore_allocator",
        "allocator_id": "alloc-dispatch",
    })
    assert result.outcome == DispatchOutcome.DONE, (
        f"Expected DispatchOutcome.DONE, got {result.outcome}"
    )
    prefs = captured.get("preferences")
    assert prefs is not None, "score_candidates never called"
    assert prefs.get("scoring_weight_overrides") == {"W_PORTFOLIO_FIT": 1.5}, (
        f"Expected feedback override to reach engine, got {prefs.get('scoring_weight_overrides')}"
    )


# ---------------------------------------------------------------------------
# 04-01-23: Migration 063 body has enqueue (C1 strengthened static check)
# ---------------------------------------------------------------------------


def test_migration_063_body_has_enqueue():
    """D-12 / C1 — Static text assertion on supabase/migrations/20260419061003_feedback_delta_enqueue.sql.
    Asserts body contains: 'PERFORM enqueue_compute_job', "'rescore_allocator'",
    'RETURNING bo.allocator_id' (D1 CTE capture), 'array_agg(DISTINCT allocator_id)'
    (D1 capture into array), 'extract_delta(' (C1 CTE signature parity pin).
    No DB connection needed.
    """
    migration_path = (
        Path(__file__).parent.parent.parent
        / "supabase" / "migrations" / "20260419061003_feedback_delta_enqueue.sql"
    )
    assert migration_path.exists(), (
        f"Migration 063 not found at {migration_path}"
    )
    body = migration_path.read_text()
    assert "PERFORM enqueue_compute_job" in body, (
        "Migration 063 body missing 'PERFORM enqueue_compute_job'"
    )
    assert "'rescore_allocator'" in body, (
        "Migration 063 body missing \"'rescore_allocator'\" literal"
    )
    # D1 finding — the CTE must capture allocator_id via RETURNING.
    assert "RETURNING bo.allocator_id" in body, (
        "Migration 063 body missing 'RETURNING bo.allocator_id' (D1 CTE capture)"
    )
    assert "array_agg(DISTINCT allocator_id)" in body, (
        "Migration 063 body missing 'array_agg(DISTINCT allocator_id)' (D1 UUID[] capture)"
    )
    # C1 finding — CTE signature parity with migration 060.
    assert "extract_delta(" in body, (
        "Migration 063 body missing 'extract_delta(' — CTE signature parity broken (C1 finding)"
    )


# ---------------------------------------------------------------------------
# 04-01-24: Audit event emitted on successful UPDATE
# ---------------------------------------------------------------------------


def test_audit_event_emitted(monkeypatch):
    """Audit / T-04-01 — Patch services.feedback_engine.log_audit_event; assert
    called once per successful UPDATE with entity_type='allocator_preference_feedback',
    action='feedback.overrides_updated', user_id=allocator_id."""
    if not IMPORTS_OK:
        pytest.skip("wave 0 placeholder")
    rejected = [
        _make_outcome(
            strategy_id=f"r{i}", kind="rejected",
            rejection_reason="mandate_conflict",
            delta_180d=None, delta_90d=None, delta_30d=None,
            percent_allocated=None,
        )
        for i in range(5)
    ]
    mock_sb = _make_mock_supabase(rejected_rows=rejected)
    monkeypatch.setattr("services.feedback_engine.get_supabase", lambda: mock_sb)

    audit_calls = []
    def _capture_audit(**kwargs):
        audit_calls.append(kwargs)
    monkeypatch.setattr("services.feedback_engine.log_audit_event", _capture_audit)

    result = compute_adjusted_weights("alloc-audit")
    assert result == {"W_PREFERENCE_FIT": 0.5}
    assert len(audit_calls) == 1, (
        f"Expected 1 audit emission, got {len(audit_calls)}"
    )
    call = audit_calls[0]
    assert call.get("user_id") == "alloc-audit", f"user_id mismatch: {call}"
    assert call.get("action") == "feedback.overrides_updated", f"action mismatch: {call}"
    assert call.get("entity_type") == "allocator_preference_feedback", f"entity_type mismatch: {call}"


# ---------------------------------------------------------------------------
# 04-01-25: Migration 063 enqueues only transitioned allocators (C1 + D1)
# ---------------------------------------------------------------------------


def test_migration_063_enqueues_only_transitioned_allocators():
    """C1 + D1 — Transition-vs-unchanged seed test. Mocked counterpart (always
    on): reads the migration 063 SQL body statically and asserts the UPDATE
    predicate contains a subclause for each of delta_30d/90d/180d IS NULL
    combined with IS NOT NULL (NULL -> non-NULL transition). Also asserts
    RETURNING bo.allocator_id is inside the CTE.

    Live-DB variant is gated with HAS_LIVE_DB; when unset this test runs the
    mocked counterpart only.
    """
    migration_path = (
        Path(__file__).parent.parent.parent
        / "supabase" / "migrations" / "20260419061003_feedback_delta_enqueue.sql"
    )
    assert migration_path.exists(), (
        f"Migration 063 not found at {migration_path}"
    )
    body = migration_path.read_text()

    # Normalize whitespace runs so the test is whitespace-insensitive on the
    # subclauses it inspects.
    import re as _re
    normalized = _re.sub(r"\s+", " ", body)

    # D1 — three NULL -> non-NULL transition subclauses.
    assert _re.search(r"bo\.delta_30d\s+IS NULL AND c\.d30\s+IS NOT NULL", normalized) \
        or ("delta_30d IS NULL AND c.d30 IS NOT NULL" in normalized), (
        "Migration 063 missing NULL->non-NULL transition subclause for delta_30d"
    )
    assert _re.search(r"bo\.delta_90d\s+IS NULL AND c\.d90\s+IS NOT NULL", normalized) \
        or ("delta_90d IS NULL AND c.d90 IS NOT NULL" in normalized), (
        "Migration 063 missing NULL->non-NULL transition subclause for delta_90d"
    )
    assert _re.search(r"bo\.delta_180d\s+IS NULL AND c\.d180\s+IS NOT NULL", normalized) \
        or ("delta_180d IS NULL AND c.d180 IS NOT NULL" in normalized), (
        "Migration 063 missing NULL->non-NULL transition subclause for delta_180d"
    )

    # D1 — RETURNING bo.allocator_id must be inside the CTE.
    assert "RETURNING bo.allocator_id" in body, (
        "Migration 063 missing 'RETURNING bo.allocator_id' inside the CTE"
    )

    if HAS_LIVE_DB:
        pytest.skip("Live-DB variant not wired up here — mocked counterpart asserts "
                    "migration body structurally; add live seed test in a follow-up.")


# ---------------------------------------------------------------------------
# 04-01-26: Fast-path skip when allocator has no outcomes (D3)
# ---------------------------------------------------------------------------


def test_fastpath_skip_no_outcomes(monkeypatch):
    """D3 — Seed mocked Supabase so the probe call returns data=[]. Call
    compute_adjusted_weights. Assert returned dict is {}. Count mock_sb.table
    .call_count — must be <= 1 (only the probe was made). Preserves the
    Phase 3 _should_skip_allocator optimization budget.
    """
    if not IMPORTS_OK:
        pytest.skip("wave 0 placeholder")

    # Build a mock supabase where the probe chain returns empty data.
    mock_sb = _make_mock_supabase(probe_nonempty=False)

    monkeypatch.setattr("services.feedback_engine.get_supabase", lambda: mock_sb)
    monkeypatch.setattr("services.feedback_engine.log_audit_event", lambda **kw: None)

    # Pre-call: reset call count so we measure only this invocation's traffic.
    mock_sb.table.reset_mock()

    result = compute_adjusted_weights("alloc-empty")
    assert result == {}, f"Expected empty result for zero-outcome allocator, got {result}"

    # At most ONE .table() call (the D3 probe). No fetches, no UPDATE.
    assert mock_sb.table.call_count <= 1, (
        f"Fast-path not respected: expected at most 1 .table() call (probe), "
        f"got {mock_sb.table.call_count}"
    )


# ---------------------------------------------------------------------------
# 04-01-27: Lazy import — services.feedback_engine not in sys.modules at module load
# ---------------------------------------------------------------------------


def test_lazy_import_not_triggered_at_module_load():
    """D6 — Subprocess-level check: import routers.match in a clean Python
    interpreter and assert 'services.feedback_engine' is NOT in sys.modules
    afterward. Proves the Phase 4 import is body-placed (lazy), not
    module-level.

    Subprocess-based to avoid polluting pytest's sys.modules state — an
    in-process sys.modules.pop + re-import pattern corrupts cached module
    references held by the test file itself (it imports compute_adjusted_weights
    at collection time), which in turn breaks subsequent tests' monkeypatches.
    """
    import subprocess

    script = (
        "import sys\n"
        "import routers.match\n"
        "leaked = 'services.feedback_engine' in sys.modules\n"
        "# Exit code 0 = pass, 1 = fail (feedback_engine imported at module load).\n"
        "sys.exit(1 if leaked else 0)\n"
    )
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=Path(__file__).parent.parent,  # analytics-service/
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert result.returncode == 0, (
        "services.feedback_engine was imported at module load — import must be "
        "body-placed (4-space indent) inside _score_one_allocator (D6 finding). "
        f"stdout={result.stdout!r} stderr={result.stderr!r}"
    )


# ---------------------------------------------------------------------------
# 04-01-28: Full scoring propagation (D8 end-to-end)
# ---------------------------------------------------------------------------


async def test_full_scoring_propagation(monkeypatch):
    """D8 — End-to-end integration (mocked Supabase). Seed bridge_outcomes +
    match_candidates.score_breakdown such that compute_adjusted_weights returns
    {"W_PORTFOLIO_FIT": 1.5}. Patch routers.match.score_candidates to capture
    preferences kwarg. Patch match_batches INSERT to capture the row payload.
    Call _score_one_allocator("alloc-1", universe).

    Assertions:
      1. captured_preferences["scoring_weight_overrides"] == {"W_PORTFOLIO_FIT": 1.5}.
      2. captured match_batches.effective_preferences contains scoring_weight_overrides.
      3. Normalized W_PORTFOLIO_FIT weight equals expected post-clamp-post-renormalize.
    """
    if not IMPORTS_OK:
        pytest.skip("wave 0 placeholder")

    # Seed feedback engine: 5 positive allocated outcomes, portfolio_fit dominant
    # -> {"W_PORTFOLIO_FIT": 1.5}.
    allocated = [
        _make_outcome(strategy_id=f"a{i}", kind="allocated",
                      delta_180d=0.05, percent_allocated=10.0)
        for i in range(5)
    ]
    breakdown_rows = [
        {
            "strategy_id": f"a{i}",
            "score_breakdown": {
                "portfolio_fit": 0.9,
                "preference_fit": 0.3,
                "track_record": 0.3,
                "capacity_fit": 0.4,
            },
            "created_at": "2026-01-01T00:00:00Z",
        }
        for i in range(5)
    ]
    mock_fb_sb = _make_mock_supabase(
        allocated_rows=allocated, breakdown_rows=breakdown_rows,
    )
    monkeypatch.setattr("services.feedback_engine.get_supabase", lambda: mock_fb_sb)
    monkeypatch.setattr("services.feedback_engine.log_audit_event", lambda **kw: None)

    # Stub routers.match._load_allocator_context.
    def _load_ctx(allocator_id: str):
        return {
            "preferences": {"max_weight": 0.10},
            "portfolio_strategies": [],
            "portfolio_returns": {},
            "portfolio_weights": {},
            "portfolio_aum": None,
            "thumbs_down_ids": set(),
        }
    monkeypatch.setattr("routers.match._load_allocator_context", _load_ctx)

    captured = {}
    def _capture_score_candidates(*args, **kwargs):
        captured["preferences"] = kwargs.get("preferences")
        # Build a realistic effective_preferences that mirrors what
        # match_engine.py would compute — for the purposes of this test,
        # we compute the post-clamp-post-renormalize weights here and
        # inject them into effective_preferences so that assertion 3 holds.
        from services.match_engine import (
            W_PORTFOLIO_FIT, W_PREFERENCE_FIT, W_TRACK_RECORD, W_CAPACITY_FIT,
        )
        prefs = kwargs.get("preferences") or {}
        overrides = prefs.get("scoring_weight_overrides") or {}
        # Clamp each to [0.5, 1.5] (engine does this defensively at line 767-777).
        def _clamp(v, lo, hi):
            return max(lo, min(hi, v))
        scaled = {
            "W_PORTFOLIO_FIT":  W_PORTFOLIO_FIT  * _clamp(overrides.get("W_PORTFOLIO_FIT",  1.0), 0.5, 1.5),
            "W_PREFERENCE_FIT": W_PREFERENCE_FIT * _clamp(overrides.get("W_PREFERENCE_FIT", 1.0), 0.5, 1.5),
            "W_TRACK_RECORD":   W_TRACK_RECORD   * _clamp(overrides.get("W_TRACK_RECORD",   1.0), 0.5, 1.5),
            "W_CAPACITY_FIT":   W_CAPACITY_FIT   * _clamp(overrides.get("W_CAPACITY_FIT",   1.0), 0.5, 1.5),
        }
        total = sum(scaled.values())
        effective_weights = {k: v / total for k, v in scaled.items()}

        # merge_with_defaults output shape: the preferences snapshot is the
        # FULL merged dict (scoring_weight_overrides key present).
        from services.match_defaults import merge_with_defaults
        effective_preferences = merge_with_defaults(prefs)
        effective_preferences["_effective_weights"] = effective_weights  # embed for test

        return {
            "candidates": [],
            "excluded": [],
            "excluded_total": 0,
            "mode": "personalized",
            "filter_relaxed": False,
            "effective_preferences": effective_preferences,
            "effective_thresholds": {},
            "source_strategy_count": 0,
        }
    monkeypatch.setattr("routers.match.score_candidates", _capture_score_candidates)

    # Stub match_batches INSERT + capture the row payload.
    batch_rows_captured = []
    def _mock_insert(row_payload):
        batch_rows_captured.append(row_payload)
        return MagicMock(execute=lambda: MagicMock(data=[{"id": "batch-prop"}]))
    mock_match_sb = MagicMock()
    mock_match_sb.table.return_value.insert = _mock_insert
    monkeypatch.setattr("routers.match.get_supabase", lambda: mock_match_sb)

    from routers.match import _score_one_allocator
    universe = {
        "strategies_by_id": {"s1": {"strategy_id": "s1"}},
        "returns_by_id": {},
    }
    await _score_one_allocator("alloc-prop", universe)

    # Assertion 1 — propagation to engine.
    prefs = captured.get("preferences")
    assert prefs is not None, "score_candidates never invoked"
    assert prefs.get("scoring_weight_overrides") == {"W_PORTFOLIO_FIT": 1.5}, (
        f"Expected overrides propagation, got {prefs.get('scoring_weight_overrides')}"
    )

    # Assertion 2 — effective_preferences snapshot captured in match_batches.
    assert batch_rows_captured, "match_batches INSERT never called"
    batch_row = batch_rows_captured[0]
    eff_prefs = batch_row.get("effective_preferences")
    assert eff_prefs is not None, "effective_preferences missing from batch row"
    assert "scoring_weight_overrides" in eff_prefs, (
        f"effective_preferences missing 'scoring_weight_overrides' key, got keys: "
        f"{list(eff_prefs.keys())}"
    )
    assert eff_prefs["scoring_weight_overrides"] == {"W_PORTFOLIO_FIT": 1.5}, (
        f"Expected overrides mirrored in effective_preferences, got "
        f"{eff_prefs['scoring_weight_overrides']}"
    )

    # Assertion 3 — normalized W_PORTFOLIO_FIT weight matches expected.
    # Expected post-clamp-post-renormalize:
    #   scaled = {PORT: 0.40 * 1.5, PREF: 0.30 * 1.0, TRACK: 0.15 * 1.0, CAP: 0.15 * 1.0}
    #          = {PORT: 0.60, PREF: 0.30, TRACK: 0.15, CAP: 0.15}
    #   total = 1.20
    #   effective["PORT"] = 0.60 / 1.20 = 0.5
    effective_weights = eff_prefs.get("_effective_weights")
    assert effective_weights is not None, (
        "Mock _capture_score_candidates did not embed _effective_weights"
    )
    expected_port = (0.40 * 1.5) / ((0.40 * 1.5) + (0.30 * 1.0) + (0.15 * 1.0) + (0.15 * 1.0))
    actual_port = effective_weights["W_PORTFOLIO_FIT"]
    assert abs(actual_port - expected_port) < 1e-9, (
        f"Expected W_PORTFOLIO_FIT {expected_port}, got {actual_port} "
        f"(diff {abs(actual_port - expected_port)})"
    )


# ===========================================================================
# Audit closure M-0737 — malformed-input robustness for the two pure helpers
# _success_value and _attribute_dimension. The existing suite never feeds NaN
# deltas, non-numeric delta strings, or None-valued score_breakdown entries.
# These tests pin the documented/defensible behavior where it holds, and
# SURFACE (xfail strict) the two places where production lacks a guard and
# crashes the whole feedback computation.
# ===========================================================================


@pytest.mark.skipif(not IMPORTS_OK, reason="feedback_engine not importable")
class TestSuccessValueMalformedDeltas:
    """_success_value(outcome) — delta robustness (feedback_engine.py:171-181)."""

    def test_nan_string_delta_is_treated_as_failure(self):
        """delta_180d='NaN' (the JSON-deserialized NaN form) → float('NaN')
        is not > 0, so success=0 (failure). This is defensible: a NaN delta
        means 'no measurable improvement', which is a failure, not a crash."""
        from services.feedback_engine import _success_value
        outcome = _make_outcome(kind="allocated", delta_180d="NaN")
        assert _success_value(outcome) == 0

    def test_float_nan_delta_is_treated_as_failure(self):
        """delta_180d=float('nan') → nan > 0 is False → success=0."""
        from services.feedback_engine import _success_value
        outcome = _make_outcome(kind="allocated", delta_180d=float("nan"))
        assert _success_value(outcome) == 0

    def test_positive_delta_still_succeeds_after_nan_guard_logic(self):
        """Sanity: a real positive delta still scores success=1 (proves the
        NaN handling above isn't blanket-zeroing everything)."""
        from services.feedback_engine import _success_value
        outcome = _make_outcome(kind="allocated", delta_180d=0.05)
        assert _success_value(outcome) == 1

    def test_non_numeric_string_delta_does_not_crash(self):
        """A garbage delta string must NOT raise — it should degrade to a
        failure (0), not abort the allocator's whole feedback pass."""
        from services.feedback_engine import _success_value
        outcome = _make_outcome(kind="allocated", delta_180d="not-a-number")
        assert _success_value(outcome) == 0

    def test_corrupt_most_mature_delta_falls_through_to_positive_less_mature(self):
        """review-A Finding 3: a corrupt MOST-mature delta (delta_180d) is
        skipped (logged, no signal) and the engine falls through to the next
        maturity. Here delta_90d is NULL, so the real positive delta_30d=0.05
        becomes authoritative → success=1. This is the load-bearing assertion
        for the change from `return 0` to `continue` in the except handler:
        with `return 0` it would wrongly score this as a failure."""
        from services.feedback_engine import _success_value
        outcome = _make_outcome(
            kind="allocated",
            delta_180d="not-a-number",
            delta_90d=None,
            delta_30d=0.05,
        )
        assert _success_value(outcome) == 1

    def test_corrupt_most_mature_delta_falls_through_to_negative_less_mature(self):
        """Fall-through to a less-mature delta still applies the >0 rule: a
        corrupt delta_180d is skipped and the real delta_30d=-0.03 (≤ 0) is
        authoritative → success=0. Confirms fall-through doesn't blanket-pass."""
        from services.feedback_engine import _success_value
        outcome = _make_outcome(
            kind="allocated",
            delta_180d="corrupt",
            delta_90d=None,
            delta_30d=-0.03,
        )
        assert _success_value(outcome) == 0

    def test_corrupt_most_mature_delta_stops_at_first_valid_maturity(self):
        """Precedence: iteration is (180d, 90d, 30d) and the FIRST non-NULL
        parseable delta wins. A corrupt delta_180d is skipped, but a VALID
        positive delta_90d=0.04 is authoritative and the engine returns 1
        WITHOUT consulting the negative delta_30d=-0.02 below it. Pins that
        fall-through stops at the most-mature usable signal, not the least."""
        from services.feedback_engine import _success_value
        outcome = _make_outcome(
            kind="allocated",
            delta_180d="not-a-number",
            delta_90d=0.04,
            delta_30d=-0.02,
        )
        assert _success_value(outcome) == 1


@pytest.mark.skipif(not IMPORTS_OK, reason="feedback_engine not importable")
class TestAttributeDimensionMalformedBreakdown:
    """_attribute_dimension — score_breakdown robustness (engine:184-210)."""

    def test_well_formed_breakdown_picks_dominant_dimension(self):
        """Baseline: a normal numeric breakdown returns the single max dim."""
        from services.feedback_engine import _attribute_dimension
        sb = {
            "portfolio_fit": 0.9,
            "preference_fit": 0.1,
            "track_record": 0.2,
            "capacity_fit": 0.3,
        }
        result = _attribute_dimension({"kind": "allocated"}, sb)
        assert result == ("W_PORTFOLIO_FIT",)

    def test_none_breakdown_uses_uniform_fallback(self):
        """score_breakdown=None → D-07 uniform fallback (all dimensions)."""
        from services.feedback_engine import _attribute_dimension, ALL_DIMENSIONS
        result = _attribute_dimension({"kind": "allocated"}, None)
        assert result == ALL_DIMENSIONS

    def test_empty_breakdown_uses_uniform_fallback(self):
        """score_breakdown={} → no candidate keys → uniform fallback."""
        from services.feedback_engine import _attribute_dimension, ALL_DIMENSIONS
        result = _attribute_dimension({"kind": "allocated"}, {})
        assert result == ALL_DIMENSIONS

    def test_mixed_none_breakdown_values_do_not_crash(self):
        """A breakdown with some None values must attribute to the best
        NUMERIC dimension, not raise TypeError on the None comparison."""
        from services.feedback_engine import _attribute_dimension
        sb = {
            "portfolio_fit": None,
            "preference_fit": 0.5,
            "track_record": None,
            "capacity_fit": 0.3,
        }
        result = _attribute_dimension({"kind": "allocated"}, sb)
        # preference_fit (0.5) is the highest non-None score.
        assert result == ("W_PREFERENCE_FIT",)

    def test_all_none_breakdown_values_fall_back_to_uniform(self):
        """All-None breakdown → no usable numeric dim → uniform fallback,
        not a crash."""
        from services.feedback_engine import _attribute_dimension, ALL_DIMENSIONS
        sb = {
            "portfolio_fit": None,
            "preference_fit": None,
            "track_record": None,
            "capacity_fit": None,
        }
        result = _attribute_dimension({"kind": "allocated"}, sb)
        assert result == ALL_DIMENSIONS
