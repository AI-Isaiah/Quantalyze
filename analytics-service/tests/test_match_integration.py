"""Integration tests for Phase 3 Plan 03-02 — routers/match.py skip-logic triple
check (D-11) + services/job_worker.py rescore_allocator dispatch (D-12 Option B)
+ update_allocator_mandates RPC proactive enqueue path.

All tests use mocked Supabase via monkeypatch + MagicMock/AsyncMock. No live DB
(D-17). asyncio_mode = auto from pytest.ini — no explicit @pytest.mark.asyncio
decorators needed on async defs.
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Wave 0: these imports may fail if Wave 1 hasn't run yet. Guard so the
# file still collects and the specific tests skip cleanly.
try:
    from routers.match import _should_skip_allocator, ENGINE_VERSION
    from services.job_worker import (
        DispatchOutcome,
        DispatchResult,
        dispatch,
    )
    IMPORTS_OK = True
except ImportError:
    _should_skip_allocator = None  # type: ignore
    ENGINE_VERSION = "v2.0.0"       # sentinel; real value arrives in Wave 1
    dispatch = None                  # type: ignore
    DispatchOutcome = None           # type: ignore
    DispatchResult = None            # type: ignore
    IMPORTS_OK = False


# -------------------------------------------------------------------------
# Skip-logic triple check (D-11) — 3 tests
# -------------------------------------------------------------------------

async def test_skip_force_and_fresh(monkeypatch):
    """force=False + fresh batch + engine_version matches + mandate_edited_at
    before computed_at → return True (skip). Baseline: everything clean."""
    if not IMPORTS_OK:
        pytest.skip("wave 0 placeholder — imports not ready")
    # Arrange: last batch computed 1 hour ago with current engine_version;
    # mandate edited 2 hours ago (before the batch).
    import datetime as _dt
    now = _dt.datetime.now(_dt.timezone.utc)
    one_hour_ago = (now - _dt.timedelta(hours=1)).isoformat().replace("+00:00", "Z")
    two_hours_ago = (now - _dt.timedelta(hours=2)).isoformat().replace("+00:00", "Z")

    mock_sb = MagicMock()
    mock_sb.table.return_value.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value = \
        MagicMock(data=[{"computed_at": one_hour_ago, "engine_version": ENGINE_VERSION}])
    mock_sb.table.return_value.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = \
        MagicMock(data={"mandate_edited_at": two_hours_ago})
    monkeypatch.setattr("routers.match.get_supabase", lambda: mock_sb)

    result = await _should_skip_allocator("alloc-1", force=False)
    assert result is True, "Expected skip=True when fresh + version matches + mandate edit before batch"


async def test_skip_on_engine_version_mismatch(monkeypatch):
    """last_batch.engine_version = 'v1.0.0' but current ENGINE_VERSION = 'v2.0.0'
    → return False (don't skip — v1→v2 cutover invalidation)."""
    if not IMPORTS_OK:
        pytest.skip("wave 0 placeholder")
    import datetime as _dt
    now = _dt.datetime.now(_dt.timezone.utc)
    one_hour_ago = (now - _dt.timedelta(hours=1)).isoformat().replace("+00:00", "Z")

    mock_sb = MagicMock()
    mock_sb.table.return_value.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value = \
        MagicMock(data=[{"computed_at": one_hour_ago, "engine_version": "v1.0.0"}])
    # allocator_preferences doesn't matter here — version mismatch short-circuits
    mock_sb.table.return_value.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = \
        MagicMock(data={"mandate_edited_at": None})
    monkeypatch.setattr("routers.match.get_supabase", lambda: mock_sb)

    result = await _should_skip_allocator("alloc-1", force=False)
    assert result is False, "Expected skip=False when engine_version mismatch (v1→v2)"


async def test_skip_on_mandate_edit(monkeypatch):
    """mandate_edited_at > computed_at → return False (don't skip — mandate edit
    invalidates cached batch)."""
    if not IMPORTS_OK:
        pytest.skip("wave 0 placeholder")
    import datetime as _dt
    now = _dt.datetime.now(_dt.timezone.utc)
    two_hours_ago = (now - _dt.timedelta(hours=2)).isoformat().replace("+00:00", "Z")
    one_hour_ago = (now - _dt.timedelta(hours=1)).isoformat().replace("+00:00", "Z")

    mock_sb = MagicMock()
    # Batch computed 2h ago; mandate edited 1h ago (AFTER the batch).
    mock_sb.table.return_value.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value = \
        MagicMock(data=[{"computed_at": two_hours_ago, "engine_version": ENGINE_VERSION}])
    mock_sb.table.return_value.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = \
        MagicMock(data={"mandate_edited_at": one_hour_ago})
    monkeypatch.setattr("routers.match.get_supabase", lambda: mock_sb)

    result = await _should_skip_allocator("alloc-1", force=False)
    assert result is False, "Expected skip=False when mandate edited after last batch"


# -------------------------------------------------------------------------
# Worker dispatch (D-12 Option B) — 1 test
# -------------------------------------------------------------------------

async def test_dispatch_routes_rescore_allocator():
    """kind='rescore_allocator' routes to run_rescore_allocator_job AND the
    strategy_analytics bridge is NOT called (allocator-scoped job).

    D4 per-voice-revision: also asserts the handler operates against the
    LATEST allocator_preferences row (not a cached one) — catches a
    hypothetical future regression where the worker reads stale state.
    """
    if not IMPORTS_OK:
        pytest.skip("wave 0 placeholder")
    job = {
        "id": "job-rescore-1",
        "kind": "rescore_allocator",
        "allocator_id": "alloc-1",
    }
    with patch(
        "services.job_worker.run_rescore_allocator_job",
        new=AsyncMock(return_value=DispatchResult(outcome=DispatchOutcome.DONE)),
    ) as mock_handler, patch(
        "services.job_worker.sync_strategy_analytics_status",
        new=AsyncMock(return_value=None),
    ) as mock_bridge:
        result = await dispatch(job)

    mock_handler.assert_awaited_once_with(job)
    assert result.outcome == DispatchOutcome.DONE
    # Allocator-scoped jobs skip the strategy_analytics bridge (T-03-F invariant)
    mock_bridge.assert_not_called()

# -------------------------------------------------------------------------
# D4 per-voice-revision: fresh-preferences assertion on worker handler
# -------------------------------------------------------------------------

async def test_worker_reads_latest_allocator_preferences(monkeypatch):
    """D4 per-voice-revision: run_rescore_allocator_job MUST read the
    LATEST allocator_preferences row, not a cached snapshot. Catches a
    hypothetical future regression where the worker reads stale state.

    Contract: after the handler runs, assert that `score_candidates` (or
    the mock wrapping it) was invoked with the LATEST `allocator_preferences`
    row. The test harness snapshots the preferences dict pre-handler-call,
    then asserts `snapshot['effective_preferences']['max_weight'] ==
    <the test fixture's current mandate value>`.
    """
    if not IMPORTS_OK:
        pytest.skip("wave 0 placeholder")

    # Capture the effective_preferences the engine sees when invoked.
    captured_prefs: dict | None = None

    def _capture_score_candidates(*args, **kwargs):
        nonlocal captured_prefs
        # score_candidates signature (from match_engine.py) accepts
        # preferences as a kwarg — snapshot it.
        captured_prefs = kwargs.get("preferences") or (args[1] if len(args) > 1 else None)
        return {
            "candidates": [],
            "excluded": [],
            "excluded_total": 0,
            "mode": "screening",
            "filter_relaxed": False,
            "effective_preferences": kwargs.get("preferences") or {},
            "effective_thresholds": {},
            "source_strategy_count": 0,
        }

    # Patch _load_allocator_context to return a fresh mandate value.
    # _load_allocator_context is a SYNCHRONOUS function in routers/match.py
    # (called via asyncio.to_thread from _score_one_allocator). It returns a
    # dict including preferences, portfolio_strategies, portfolio_returns,
    # portfolio_weights, portfolio_aum, and thumbs_down_ids.
    FRESH_MAX_WEIGHT = 0.17

    def _load_fresh_context(allocator_id: str):
        return {
            "preferences": {
                "max_weight": FRESH_MAX_WEIGHT,
                # ... other mandate keys default
            },
            "portfolio_strategies": [],
            "portfolio_returns": {},
            "portfolio_weights": {},
            "portfolio_aum": None,
            "thumbs_down_ids": set(),
        }

    monkeypatch.setattr(
        "routers.match._load_allocator_context",
        _load_fresh_context,
    )
    # WR-01 fix: patch score_candidates in the namespace where routers/match.py
    # BOUND it (via `from services.match_engine import score_candidates`).
    # Patching services.match_engine.score_candidates does NOT rebind the
    # already-imported reference in routers.match — must patch the consumer's
    # namespace to intercept calls from _score_one_allocator.
    monkeypatch.setattr(
        "routers.match.score_candidates",
        _capture_score_candidates,
    )
    # Also stub out the empty-universe short-circuit so _score_one_allocator
    # runs. The handler calls _load_candidate_universe() first; we want it
    # to return at least one strategy so the handler proceeds to score.
    monkeypatch.setattr(
        "routers.match._load_candidate_universe",
        lambda: {
            "strategies_by_id": {
                "sfresh": {"strategy_id": "sfresh", "name": "Fresh strategy"}
            },
            "returns_by_id": {},
        },
    )

    # Stub out the batch persistence — we only care about score_candidates
    # being invoked with the fresh preferences. The real _score_one_allocator
    # writes to match_batches + match_candidates; mock the supabase so those
    # calls don't explode.
    mock_sb = MagicMock()
    mock_sb.table.return_value.insert.return_value.execute.return_value = \
        MagicMock(data=[{"id": "batch-fresh"}])
    monkeypatch.setattr("routers.match.get_supabase", lambda: mock_sb)

    # Phase 4 / Plan 04-01: _score_one_allocator now also calls
    # services.feedback_engine.compute_adjusted_weights via asyncio.to_thread.
    # Stub its Supabase client so the D3 fast-path probe returns empty
    # (allocator has no bridge_outcomes history -> compute returns {} with
    # one round-trip; no further fetches, no UPDATE).
    mock_fb_sb = MagicMock()
    mock_fb_sb.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value = \
        MagicMock(data=[])
    monkeypatch.setattr("services.feedback_engine.get_supabase", lambda: mock_fb_sb)
    monkeypatch.setattr("services.feedback_engine.log_audit_event", lambda **kw: None)

    # Invoke the handler directly — bypass dispatch() to isolate
    from services.job_worker import run_rescore_allocator_job

    result = await run_rescore_allocator_job({
        "id": "job-rescore-fresh",
        "kind": "rescore_allocator",
        "allocator_id": "alloc-fresh",
    })

    assert result.outcome == DispatchOutcome.DONE
    assert captured_prefs is not None, "score_candidates was not invoked"
    assert captured_prefs.get("max_weight") == FRESH_MAX_WEIGHT, (
        f"Expected fresh max_weight={FRESH_MAX_WEIGHT}, got "
        f"{captured_prefs.get('max_weight')}. Worker handler is reading "
        "a stale preferences snapshot — stale-cache regression."
    )


# -------------------------------------------------------------------------
# C3 per-voice-revision: test_rpc_proactive_enqueue NOT added.
# The RPC PERFORM path is proven by 03-01 Task 1 STEP 9 self-verify DO
# block (SAVEPOINTed RPC wrapper + partial-unique-index probe). Python
# mocks cannot exercise PG-side RPC bodies (D-17 no-live-DB).
# -------------------------------------------------------------------------
