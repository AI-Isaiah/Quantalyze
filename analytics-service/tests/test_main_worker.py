"""Tests for analytics-service/main_worker.py tick functions.

The worker runs three interleaved asyncio loops (dispatch, watchdog, daily
enqueue). Each loop's body is factored into a testable `*_tick()` function.
These tests call the tick functions directly — they never run the infinite
loops, never sleep, and never hit real exchanges or DB.

The three tick tests:
  1. dispatch_tick — claims jobs, dispatches, calls mark_done / mark_failed
  2. watchdog_tick — calls reset_stalled_compute_jobs with per-kind JSONB
  3. daily_enqueue_tick — calls enqueue_poll_positions_for_all_strategies

Plus a shutdown-signal test that verifies the SHUTDOWN event stops the loops.
"""

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# main_worker is a top-level module (not in services/) so it's importable
# directly via the pythonpath=. in pytest.ini.
from main_worker import (
    daily_enqueue_tick,
    dispatch_tick,
    watchdog_tick,
    WATCHDOG_PER_KIND_OVERRIDES,
)
from services.job_worker import DispatchOutcome, DispatchResult


# ---------------------------------------------------------------------------
# dispatch_tick
# ---------------------------------------------------------------------------

class TestDispatchTick:
    """dispatch_tick claims up to batch_size jobs via supabase RPC and
    dispatches each one. On DONE, calls mark_compute_job_done. On FAILED,
    calls mark_compute_job_failed. On DEFERRED, the handler already
    called defer_compute_job — no mark call.
    """

    @pytest.mark.asyncio
    async def test_zero_claimed_jobs_no_dispatch(self) -> None:
        """If claim_compute_jobs returns 0 rows, dispatch must never be
        called, and no mark_* calls happen."""
        mock_supabase = MagicMock()
        mock_rpc_chain = MagicMock()
        mock_rpc_chain.execute.return_value = MagicMock(data=[])
        mock_supabase.rpc.return_value = mock_rpc_chain

        with patch("main_worker.get_supabase", return_value=mock_supabase), \
             patch("main_worker.dispatch", new=AsyncMock()) as mock_dispatch:
            await dispatch_tick("worker-test-1")

        mock_dispatch.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_three_jobs_all_done(self) -> None:
        """3 claimed jobs, all dispatched, all return DONE → mark_done
        called 3 times, mark_failed called 0 times."""
        jobs = [
            {"id": f"job-{i}", "kind": "sync_trades", "strategy_id": f"s-{i}"}
            for i in range(3)
        ]
        mock_supabase = MagicMock()
        # claim_compute_jobs returns the 3 jobs
        claim_chain = MagicMock()
        claim_chain.execute.return_value = MagicMock(data=jobs)
        # mark_done and mark_failed
        mark_chain = MagicMock()
        mark_chain.execute.return_value = MagicMock(data=None)
        mock_supabase.rpc.return_value = claim_chain

        # After the first claim call, switch rpc to return mark_chain for
        # subsequent calls (mark_done / mark_failed). Phase 12 / METRICS-14:
        # claim path now goes through claim_compute_jobs_with_priority
        # (migration 086) — the legacy claim_compute_jobs name no longer
        # appears in main_worker.py's call site.
        call_count = 0

        def _rpc_side_effect(name: str, params: dict):
            nonlocal call_count
            call_count += 1
            if name == "claim_compute_jobs_with_priority":
                return claim_chain
            return mark_chain

        mock_supabase.rpc.side_effect = _rpc_side_effect

        with patch("main_worker.get_supabase", return_value=mock_supabase), \
             patch(
                 "main_worker.dispatch",
                 new=AsyncMock(return_value=DispatchResult(outcome=DispatchOutcome.DONE)),
             ):
            await dispatch_tick("worker-test-2")

        # Should have: 1 claim call + 3 mark_done calls = 4 total RPC calls
        rpc_calls = mock_supabase.rpc.call_args_list
        rpc_names = [c.args[0] for c in rpc_calls]
        assert rpc_names.count("claim_compute_jobs_with_priority") == 1
        assert rpc_names.count("mark_compute_job_done") == 3
        assert "mark_compute_job_failed" not in rpc_names

    @pytest.mark.asyncio
    async def test_dispatch_raising_exception_marks_failed(self) -> None:
        """If dispatch itself raises (not returns FAILED — actually raises),
        dispatch_tick's except handler must call mark_compute_job_failed
        with 'unknown' kind."""
        jobs = [{"id": "job-crash", "kind": "sync_trades", "strategy_id": "s-crash"}]
        mock_supabase = MagicMock()
        chain = MagicMock()
        chain.execute.return_value = MagicMock(data=None)

        def _rpc_side_effect(name: str, params: dict):
            if name == "claim_compute_jobs_with_priority":
                claim = MagicMock()
                claim.execute.return_value = MagicMock(data=jobs)
                return claim
            return chain

        mock_supabase.rpc.side_effect = _rpc_side_effect

        async def _explode(job: dict) -> DispatchResult:
            raise RuntimeError("worker-level crash that bypasses classify")

        with patch("main_worker.get_supabase", return_value=mock_supabase), \
             patch("main_worker.dispatch", new=_explode):
            await dispatch_tick("worker-test-3")

        # Find the mark_compute_job_failed call
        fail_calls = [
            c for c in mock_supabase.rpc.call_args_list
            if c.args[0] == "mark_compute_job_failed"
        ]
        assert len(fail_calls) == 1
        params = fail_calls[0].args[1]
        assert params["p_job_id"] == "job-crash"
        assert params["p_error_kind"] == "unknown"

    @pytest.mark.asyncio
    async def test_dispatch_deferred_no_mark(self) -> None:
        """If dispatch returns DEFERRED, no mark_* call is made — the
        handler already deferred via defer_compute_job RPC."""
        jobs = [{"id": "job-defer", "kind": "sync_trades", "strategy_id": "s-defer"}]
        mock_supabase = MagicMock()

        def _rpc_side_effect(name: str, params: dict):
            chain = MagicMock()
            if name == "claim_compute_jobs_with_priority":
                chain.execute.return_value = MagicMock(data=jobs)
            else:
                chain.execute.return_value = MagicMock(data=None)
            return chain

        mock_supabase.rpc.side_effect = _rpc_side_effect

        with patch("main_worker.get_supabase", return_value=mock_supabase), \
             patch(
                 "main_worker.dispatch",
                 new=AsyncMock(return_value=DispatchResult(outcome=DispatchOutcome.DEFERRED)),
             ):
            await dispatch_tick("worker-test-defer")

        rpc_names = [c.args[0] for c in mock_supabase.rpc.call_args_list]
        assert "mark_compute_job_done" not in rpc_names
        assert "mark_compute_job_failed" not in rpc_names

    # Regression: ISSUE-001 — healthz reported "stale" forever when the
    # worker was polling an empty queue. dispatch_tick used to early-return
    # at `if not jobs: return` before updating main_worker_healthz.LAST_TICK_AT.
    # Found by /qa on 2026-04-20
    # Report: .gstack/qa-reports/qa-report-quantalyze-phase-06-2026-04-20.md
    @pytest.mark.asyncio
    async def test_empty_claim_still_bumps_healthz_last_tick(self) -> None:
        """Idle worker (zero claimed jobs) must still update
        main_worker_healthz.LAST_TICK_AT — an empty queue is a healthy state,
        not a stale one."""
        import main_worker_healthz

        mock_supabase = MagicMock()
        chain = MagicMock()
        chain.execute.return_value = MagicMock(data=[])
        mock_supabase.rpc.return_value = chain

        main_worker_healthz.LAST_TICK_AT = 0.0
        before = main_worker_healthz.LAST_TICK_AT

        with patch("main_worker.get_supabase", return_value=mock_supabase), \
             patch("main_worker.dispatch", new=AsyncMock()):
            await dispatch_tick("worker-test-idle")

        after = main_worker_healthz.LAST_TICK_AT
        assert after > before, (
            "dispatch_tick with zero claimed jobs must still update "
            "LAST_TICK_AT; otherwise healthz lies about liveness."
        )

    @pytest.mark.asyncio
    async def test_non_empty_claim_bumps_healthz_last_tick(self) -> None:
        """Positive control for the idle test above — non-empty batch also
        updates LAST_TICK_AT."""
        import main_worker_healthz

        jobs = [{"id": "job-healthy", "kind": "sync_trades", "strategy_id": "s-1"}]
        mock_supabase = MagicMock()
        chain = MagicMock()
        chain.execute.return_value = MagicMock(data=jobs)
        mock_supabase.rpc.return_value = chain

        main_worker_healthz.LAST_TICK_AT = 0.0
        before = main_worker_healthz.LAST_TICK_AT

        with patch("main_worker.get_supabase", return_value=mock_supabase), \
             patch(
                 "main_worker.dispatch",
                 new=AsyncMock(return_value=DispatchResult(outcome=DispatchOutcome.DONE)),
             ):
            await dispatch_tick("worker-test-busy")

        after = main_worker_healthz.LAST_TICK_AT
        assert after > before

    # METRICS-14 / Plan 12-07: priority-aware claim path. The throttle MUST
    # live in the claim path (dispatch_tick), not in dispatch() — by the time
    # dispatch runs, the row is already claimed. Phase 12 SC#4: live
    # sync_trades jobs do not queue behind backfill on Phase 12 deploy.
    # See migration 086 for the RPC contract; see 12-RESEARCH.md §5d for
    # the throttle-location correction.
    @pytest.mark.asyncio
    async def test_dispatch_tick_calls_priority_rpc(self) -> None:
        """METRICS-14: dispatch_tick uses claim_compute_jobs_with_priority
        (migration 086) and NOT the legacy claim_compute_jobs RPC."""
        mock_supabase = MagicMock()
        chain = MagicMock()
        chain.execute.return_value = MagicMock(data=[])
        mock_supabase.rpc.return_value = chain

        with patch("main_worker.get_supabase", return_value=mock_supabase), \
             patch("main_worker.dispatch", new=AsyncMock()):
            await dispatch_tick("worker-test-priority")

        called_rpc_names = [c.args[0] for c in mock_supabase.rpc.call_args_list]
        assert "claim_compute_jobs_with_priority" in called_rpc_names, (
            f"Expected claim_compute_jobs_with_priority to be called; "
            f"got: {called_rpc_names}"
        )
        assert "claim_compute_jobs" not in called_rpc_names, (
            f"Legacy claim_compute_jobs RPC must NOT be called after the "
            f"Phase 12 / METRICS-14 swap; got: {called_rpc_names}"
        )

    # METRICS-14 (+ BACKBONE-05 update): confirm the new RPC is called with
    # the right parameter shape. Migration 086 ships the 2-arg signature
    # (p_batch_size INTEGER, p_worker_id TEXT); migration 104 (Phase 19)
    # extends it with `p_unified_backbone_active BOOLEAN DEFAULT NULL`.
    # The dispatch loop now passes all three so 104 can stamp the metadata
    # snapshot used by drain semantics. A wrong shape would cause a
    # PostgREST error at runtime even though the RPC name is correct.
    @pytest.mark.asyncio
    async def test_dispatch_tick_priority_rpc_param_shape(self) -> None:
        """The priority-aware RPC is called with batch_size=5, the
        worker_id passed through, and the BACKBONE-05 unified-backbone
        flag (boolean, captured once per tick)."""
        mock_supabase = MagicMock()
        chain = MagicMock()
        chain.execute.return_value = MagicMock(data=[])
        mock_supabase.rpc.return_value = chain

        with patch("main_worker.get_supabase", return_value=mock_supabase), \
             patch("main_worker.dispatch", new=AsyncMock()), \
             patch(
                 "main_worker.is_unified_backbone_active",
                 new=AsyncMock(return_value=True),
             ):
            await dispatch_tick("worker-test-shape")

        priority_calls = [
            c for c in mock_supabase.rpc.call_args_list
            if c.args[0] == "claim_compute_jobs_with_priority"
        ]
        assert len(priority_calls) == 1
        params = priority_calls[0].args[1]
        assert params == {
            "p_batch_size": 5,
            "p_worker_id": "worker-test-shape",
            "p_unified_backbone_active": True,
        }

    # Phase 19 / BACKBONE-05 — drain semantics: the dispatch loop must
    # always pass the third arg (boolean), even when the flag is OFF, so
    # migration 104 can stamp 'unified_backbone_at_claim' = 'false' for
    # legacy claims. The handler-side drain check then refuses to
    # process them through the unified path.
    @pytest.mark.asyncio
    async def test_dispatch_tick_passes_flag_off_when_disabled(self) -> None:
        """When is_unified_backbone_active() returns False, the third
        arg to claim_compute_jobs_with_priority is False (NOT omitted)."""
        mock_supabase = MagicMock()
        chain = MagicMock()
        chain.execute.return_value = MagicMock(data=[])
        mock_supabase.rpc.return_value = chain

        with patch("main_worker.get_supabase", return_value=mock_supabase), \
             patch("main_worker.dispatch", new=AsyncMock()), \
             patch(
                 "main_worker.is_unified_backbone_active",
                 new=AsyncMock(return_value=False),
             ):
            await dispatch_tick("worker-test-flag-off")

        priority_calls = [
            c for c in mock_supabase.rpc.call_args_list
            if c.args[0] == "claim_compute_jobs_with_priority"
        ]
        assert len(priority_calls) == 1
        params = priority_calls[0].args[1]
        assert params["p_unified_backbone_active"] is False


# ---------------------------------------------------------------------------
# watchdog_tick
# ---------------------------------------------------------------------------

class TestWatchdogTick:
    """watchdog_tick calls reset_stalled_compute_jobs with the per-kind
    overrides JSONB. The RPC lives in migration 033."""

    @pytest.mark.asyncio
    async def test_calls_rpc_with_overrides(self) -> None:
        mock_supabase = MagicMock()
        chain = MagicMock()
        chain.execute.return_value = MagicMock(data=0)
        mock_supabase.rpc.return_value = chain

        with patch("main_worker.get_supabase", return_value=mock_supabase):
            await watchdog_tick()

        mock_supabase.rpc.assert_called_once()
        call_args = mock_supabase.rpc.call_args
        assert call_args.args[0] == "reset_stalled_compute_jobs"
        params = call_args.args[1]
        assert params["p_stale_threshold"] == "10 minutes"
        # Per-kind overrides must be passed as a native dict so PostgREST
        # coerces it to a JSONB object. A stringified JSON would land as a
        # JSONB scalar and break jsonb_object_keys() inside the RPC.
        overrides = params["p_per_kind_overrides"]
        assert isinstance(overrides, dict), (
            f"overrides must be dict (not str) to coerce to JSONB object; got {type(overrides).__name__}"
        )
        # Watchdog thresholds must EXCEED the corresponding handler timeout —
        # see TestWatchdogInvariant for the source-of-truth invariant. Bumped
        # sync_trades 10→20m and compute_portfolio 10→15m after a wizard hang
        # caused by sync_trades retrying past the watchdog instead of failing.
        # audit-2026-05-07 P97 / G12.A.2 (mig 117): bumped sync_trades 20→30m
        # so OKX backfills (legitimately 12+ min) don't routinely trip the
        # watchdog and trigger Race A 2-worker overlap.
        assert overrides["sync_trades"] == "30 minutes"
        assert overrides["compute_analytics"] == "20 minutes"
        assert overrides["poll_positions"] == "5 minutes"
        assert overrides["compute_portfolio"] == "15 minutes"


# ---------------------------------------------------------------------------
# daily_enqueue_tick
# ---------------------------------------------------------------------------

class TestDailyEnqueueTick:
    """daily_enqueue_tick calls enqueue_poll_positions_for_all_strategies
    and logs the returned count."""

    @pytest.mark.asyncio
    async def test_calls_rpc_and_returns_count(self) -> None:
        mock_supabase = MagicMock()
        chain = MagicMock()
        chain.execute.return_value = MagicMock(data=7)
        mock_supabase.rpc.return_value = chain

        with patch("main_worker.get_supabase", return_value=mock_supabase):
            await daily_enqueue_tick()

        mock_supabase.rpc.assert_called_once_with(
            "enqueue_poll_positions_for_all_strategies", {}
        )
        chain.execute.assert_called_once()


# ---------------------------------------------------------------------------
# Shutdown signal
# ---------------------------------------------------------------------------

class TestShutdown:
    """The SHUTDOWN asyncio.Event must cause all loops to exit cleanly when
    set. We test this by running a loop with a near-zero interval and
    setting SHUTDOWN shortly after."""

    @pytest.mark.asyncio
    async def test_dispatch_loop_exits_on_shutdown(self) -> None:
        from main_worker import dispatch_loop, SHUTDOWN

        # Clear from any prior test state
        SHUTDOWN.clear()

        mock_supabase = MagicMock()
        chain = MagicMock()
        chain.execute.return_value = MagicMock(data=[])
        mock_supabase.rpc.return_value = chain

        async def _set_shutdown_soon():
            await asyncio.sleep(0.05)
            SHUTDOWN.set()

        with patch("main_worker.get_supabase", return_value=mock_supabase), \
             patch("main_worker.dispatch", new=AsyncMock()):
            # Run the loop with a very short interval so it ticks fast
            loop_task = asyncio.create_task(
                dispatch_loop("test-worker", interval=0.01)
            )
            shutdown_task = asyncio.create_task(_set_shutdown_soon())

            # The loop must finish within a reasonable window
            done, pending = await asyncio.wait(
                {loop_task, shutdown_task}, timeout=2.0
            )
            for p in pending:
                p.cancel()

        assert loop_task.done(), "dispatch_loop did not exit within timeout"
        # Clean up for next test
        SHUTDOWN.clear()


# ---------------------------------------------------------------------------
# Migration 090 — partition-key dedupe contract
# ---------------------------------------------------------------------------

class TestClaimDedupe:
    """Migration 090 (claim_dedupe_partition_keys) added partition-key
    deduplication inside `claim_compute_jobs_with_priority`. When two
    eligible rows share `(kind, allocator_id)` (or any other partition
    column covered by a partial unique inflight index), the SQL function
    returns at most one of them per call, so the batch UPDATE cannot
    23505 on those indices.

    From the worker's perspective this is invisible — claim just returns
    fewer rows than the queue depth. These tests capture that contract:
    when the SQL dedupes, dispatch_tick still processes the survivor
    cleanly and does not assume `len(jobs) == p_batch_size`. The actual
    SQL regression is gated by the migration's structural DO block (see
    supabase/migrations/20260428190907_claim_dedupe_partition_keys.sql) plus the
    one-shot live test recorded in the v0.17.0.2 deploy report.
    """

    @pytest.mark.asyncio
    async def test_partial_batch_from_dedupe_dispatches_survivor(self) -> None:
        """When claim returns 1 row (the dedupe winner) instead of 2 rows
        sharing a partition, dispatch must still be called for the
        survivor and mark_done must fire exactly once."""
        survivor = {
            "id": "rescore-survivor",
            "kind": "rescore_allocator",
            "allocator_id": "alloc-shared",
        }
        mock_supabase = MagicMock()
        claim_chain = MagicMock()
        claim_chain.execute.return_value = MagicMock(data=[survivor])
        mark_chain = MagicMock()
        mark_chain.execute.return_value = MagicMock(data=None)

        def _rpc_side_effect(name: str, params: dict):
            if name == "claim_compute_jobs_with_priority":
                return claim_chain
            return mark_chain

        mock_supabase.rpc.side_effect = _rpc_side_effect

        with patch("main_worker.get_supabase", return_value=mock_supabase), \
             patch(
                 "main_worker.dispatch",
                 new=AsyncMock(return_value=DispatchResult(outcome=DispatchOutcome.DONE)),
             ) as mock_dispatch:
            await dispatch_tick("worker-dedupe-test")

        mock_dispatch.assert_awaited_once()
        rpc_names = [c.args[0] for c in mock_supabase.rpc.call_args_list]
        assert rpc_names.count("claim_compute_jobs_with_priority") == 1
        assert rpc_names.count("mark_compute_job_done") == 1
        assert rpc_names.count("mark_compute_job_failed") == 0

    @pytest.mark.asyncio
    async def test_empty_claim_after_dedupe_no_dispatch(self) -> None:
        """If dedupe + concurrent locks reduce the batch to zero rows
        (worker A locks the partition winner, worker B's claim returns
        empty), dispatch_tick must early-exit cleanly with no mark_*
        calls."""
        mock_supabase = MagicMock()
        claim_chain = MagicMock()
        claim_chain.execute.return_value = MagicMock(data=[])
        mock_supabase.rpc.return_value = claim_chain

        with patch("main_worker.get_supabase", return_value=mock_supabase), \
             patch("main_worker.dispatch", new=AsyncMock()) as mock_dispatch:
            await dispatch_tick("worker-dedupe-empty")

        mock_dispatch.assert_not_awaited()
        rpc_names = [c.args[0] for c in mock_supabase.rpc.call_args_list]
        assert rpc_names == ["claim_compute_jobs_with_priority"]


# ---------------------------------------------------------------------------
# Watchdog-vs-handler-timeout invariant (regression for /investigate root
# cause: the wizard's "Verify data" step hung at 2674s because the
# sync_trades watchdog yanked the still-running job back to 'pending' before
# the handler could fail-classify itself, looping forever and never writing
# strategy_analytics.computation_status to a terminal state).
# ---------------------------------------------------------------------------


def _parse_minutes(s: str) -> int:
    """'10 minutes' -> 10. Tolerant of singular/plural for forward compat."""
    parts = s.strip().split()
    assert len(parts) == 2 and parts[1] in ("minute", "minutes"), (
        f"Unexpected watchdog threshold format: {s!r}"
    )
    return int(parts[0])


class TestWatchdogInvariant:
    """The watchdog reset threshold for every kind MUST exceed that kind's
    handler timeout. If it doesn't, the watchdog reclaims still-running jobs,
    they retry forever, and any caller polling for terminal status (e.g. the
    Strategy Wizard) hangs without ever seeing 'failed' or 'complete'."""

    def test_watchdog_threshold_exceeds_handler_timeout(self) -> None:
        """The original test scoped to declared overrides — kept for
        coverage of every override's correctness."""
        from main_worker import WATCHDOG_PER_KIND_OVERRIDES
        from services.job_worker import TIMEOUT_PER_KIND

        for kind, watchdog_str in WATCHDOG_PER_KIND_OVERRIDES.items():
            handler_seconds = TIMEOUT_PER_KIND.get(kind)
            assert handler_seconds is not None, (
                f"Watchdog override declared for unknown kind {kind!r}"
            )
            handler_minutes = handler_seconds / 60
            watchdog_minutes = _parse_minutes(watchdog_str)
            assert watchdog_minutes > handler_minutes, (
                f"Watchdog threshold for {kind!r} ({watchdog_minutes}m) is not "
                f"greater than its handler timeout ({handler_minutes:.1f}m). "
                "The handler must have a chance to fail-classify itself before "
                "the watchdog yanks the row — otherwise the job loops forever "
                "and any caller polling for terminal status hangs."
            )

    def test_every_kind_has_watchdog_headroom(self) -> None:
        """The override-only test above missed kinds that fall through to
        the global default. PR #106's `compute_analytics` watchdog fix
        only covered kinds with explicit overrides — `reconstruct_allocator_history`
        had a 30-minute handler timeout and inherited the 10-minute
        default, reproducing the wizard-hang for allocator equity
        backfill. This test iterates TIMEOUT_PER_KIND (source of truth)
        and asserts every kind has watchdog headroom, including ones
        that take the default."""
        from main_worker import WATCHDOG_PER_KIND_OVERRIDES
        from services.job_worker import TIMEOUT_PER_KIND

        # Mirror of main_worker.watchdog_tick `p_stale_threshold` default.
        # Keep in lock-step with that literal — a future change to that
        # default is a breaking contract change for every kind without
        # an explicit override and must update this constant too.
        DEFAULT_WATCHDOG_MINUTES = 10

        for kind, handler_seconds in TIMEOUT_PER_KIND.items():
            handler_minutes = handler_seconds / 60
            override = WATCHDOG_PER_KIND_OVERRIDES.get(kind)
            watchdog_minutes = (
                _parse_minutes(override) if override else DEFAULT_WATCHDOG_MINUTES
            )
            assert watchdog_minutes > handler_minutes, (
                f"Kind {kind!r}: handler timeout {handler_minutes:.1f}m "
                f"exceeds watchdog threshold {watchdog_minutes}m. "
                f"Add an entry to WATCHDOG_PER_KIND_OVERRIDES with a "
                f"value greater than {handler_minutes:.1f} minutes — "
                "otherwise the watchdog reclaims the still-running job "
                "and any caller polling for terminal status hangs."
            )


# ---------------------------------------------------------------------------
# audit-2026-05-07 C-0190 — missing-RPC fallback
# ---------------------------------------------------------------------------
# When the Supabase project hasn't applied migration 086 yet, PostgREST
# returns SQLSTATE 42883 (undefined_function) for
# `claim_compute_jobs_with_priority`. Pre-fix, the worker logged an opaque
# error every tick and claimed zero jobs forever — a silent total-stall
# failure mode. Post-fix, the worker catches 42883 specifically and falls
# back to the legacy `claim_compute_jobs(p_batch_size, p_worker_id)` RPC.
# ---------------------------------------------------------------------------


class TestClaimRpcFallback:
    """audit-2026-05-07 C-0190 — when migration 086 has not been applied,
    the worker must catch SQLSTATE 42883 from claim_compute_jobs_with_priority
    and fall back to the legacy claim_compute_jobs RPC."""

    def setup_method(self) -> None:
        # Reset the module-level latch so each test starts from "no
        # fallback yet". Necessary because the latch is process-wide so a
        # prior test that exercised the fallback would otherwise leak
        # state into this test class.
        import main_worker

        main_worker._FALLBACK_CLAIM_RPC = False

    @pytest.mark.asyncio
    async def test_undefined_function_falls_back_to_legacy_rpc(self) -> None:
        """If claim_compute_jobs_with_priority raises 42883 (function does
        not exist), dispatch_tick must call claim_compute_jobs (legacy)
        with the 2-arg pre-086 signature and process whatever it returns."""
        from postgrest.exceptions import APIError

        legacy_jobs = [
            {"id": "j-legacy-1", "kind": "sync_trades", "strategy_id": "s-1"},
        ]
        mock_supabase = MagicMock()

        priority_chain = MagicMock()
        priority_chain.execute.side_effect = APIError(
            {
                "message": (
                    "function public.claim_compute_jobs_with_priority"
                    "(p_batch_size => integer, p_worker_id => text, "
                    "p_unified_backbone_active => boolean) does not exist"
                ),
                "code": "42883",
            }
        )
        legacy_chain = MagicMock()
        legacy_chain.execute.return_value = MagicMock(data=legacy_jobs)
        mark_chain = MagicMock()
        mark_chain.execute.return_value = MagicMock(data=None)

        def _rpc_side_effect(name: str, params: dict):
            if name == "claim_compute_jobs_with_priority":
                return priority_chain
            if name == "claim_compute_jobs":
                return legacy_chain
            return mark_chain

        mock_supabase.rpc.side_effect = _rpc_side_effect

        with patch("main_worker.get_supabase", return_value=mock_supabase), \
             patch(
                 "main_worker.dispatch",
                 new=AsyncMock(return_value=DispatchResult(outcome=DispatchOutcome.DONE)),
             ) as mock_dispatch:
            await dispatch_tick("worker-fallback-1")

        called_rpc_names = [c.args[0] for c in mock_supabase.rpc.call_args_list]
        assert "claim_compute_jobs_with_priority" in called_rpc_names, (
            "priority RPC must be tried before the fallback fires"
        )
        assert "claim_compute_jobs" in called_rpc_names, (
            "legacy claim_compute_jobs RPC must be called when 42883 surfaces "
            f"on the priority RPC; got {called_rpc_names}"
        )
        # The legacy RPC takes only 2 args; passing the BACKBONE-05 flag
        # would 42883 on the legacy function signature too.
        legacy_calls = [
            c for c in mock_supabase.rpc.call_args_list
            if c.args[0] == "claim_compute_jobs"
        ]
        assert len(legacy_calls) == 1
        params = legacy_calls[0].args[1]
        assert params == {"p_batch_size": 5, "p_worker_id": "worker-fallback-1"}, (
            f"legacy RPC must use 2-arg signature; got {params}"
        )
        # The job returned by the legacy RPC must still flow through
        # dispatch + mark_done — falling back is not a no-op.
        mock_dispatch.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_undefined_function_latches_for_subsequent_ticks(self) -> None:
        """Once 42883 has been observed once, the worker latches the
        fallback choice — subsequent ticks must skip the priority RPC
        entirely. Probing the missing function every 30s would only
        pollute logs with identical errors."""
        from postgrest.exceptions import APIError

        mock_supabase = MagicMock()

        priority_chain = MagicMock()
        priority_chain.execute.side_effect = APIError(
            {
                "message": "function does not exist",
                "code": "42883",
            }
        )
        legacy_chain = MagicMock()
        legacy_chain.execute.return_value = MagicMock(data=[])

        def _rpc_side_effect(name: str, params: dict):
            if name == "claim_compute_jobs_with_priority":
                return priority_chain
            return legacy_chain

        mock_supabase.rpc.side_effect = _rpc_side_effect

        with patch("main_worker.get_supabase", return_value=mock_supabase), \
             patch("main_worker.dispatch", new=AsyncMock()):
            # First tick: hits 42883, latches fallback.
            await dispatch_tick("worker-latch-test")
            mock_supabase.rpc.reset_mock()
            # Second tick: must skip priority RPC entirely.
            await dispatch_tick("worker-latch-test")

        called_rpc_names = [c.args[0] for c in mock_supabase.rpc.call_args_list]
        assert "claim_compute_jobs_with_priority" not in called_rpc_names, (
            "after 42883 latches the fallback, subsequent ticks must skip "
            f"the priority RPC; got {called_rpc_names}"
        )
        assert "claim_compute_jobs" in called_rpc_names

    @pytest.mark.asyncio
    async def test_non_42883_error_propagates_no_fallback(self) -> None:
        """Errors that are NOT 42883 must propagate to the loop wrapper —
        we must not blanket-catch other APIErrors (rate-limit 429, 5xx,
        auth 42501, etc.) and silently fall back."""
        from postgrest.exceptions import APIError

        mock_supabase = MagicMock()

        priority_chain = MagicMock()
        priority_chain.execute.side_effect = APIError(
            {"message": "permission denied", "code": "42501"}
        )
        legacy_chain = MagicMock()
        legacy_chain.execute.return_value = MagicMock(data=[])

        def _rpc_side_effect(name: str, params: dict):
            if name == "claim_compute_jobs_with_priority":
                return priority_chain
            return legacy_chain

        mock_supabase.rpc.side_effect = _rpc_side_effect

        with patch("main_worker.get_supabase", return_value=mock_supabase), \
             patch("main_worker.dispatch", new=AsyncMock()):
            with pytest.raises(APIError) as excinfo:
                await dispatch_tick("worker-no-fallback")

        assert excinfo.value.code == "42501"
        called_rpc_names = [c.args[0] for c in mock_supabase.rpc.call_args_list]
        assert "claim_compute_jobs" not in called_rpc_names, (
            "non-42883 errors must NOT trigger the legacy fallback; "
            f"got {called_rpc_names}"
        )
        # Latch must stay False so the next dispatch_tick re-tries the
        # priority RPC instead of permanently degrading on a transient error.
        import main_worker

        assert main_worker._FALLBACK_CLAIM_RPC is False
