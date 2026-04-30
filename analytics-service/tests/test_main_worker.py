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

    # METRICS-14: confirm the new RPC is called with the same parameter
    # shape as the legacy one. Migration 086 keeps the signature
    # (p_batch_size INTEGER, p_worker_id TEXT) — a wrong shape would cause
    # a PostgREST error at runtime even though the RPC name is correct.
    @pytest.mark.asyncio
    async def test_dispatch_tick_priority_rpc_param_shape(self) -> None:
        """The priority-aware RPC is called with batch_size=5 and the
        worker_id passed through."""
        mock_supabase = MagicMock()
        chain = MagicMock()
        chain.execute.return_value = MagicMock(data=[])
        mock_supabase.rpc.return_value = chain

        with patch("main_worker.get_supabase", return_value=mock_supabase), \
             patch("main_worker.dispatch", new=AsyncMock()):
            await dispatch_tick("worker-test-shape")

        priority_calls = [
            c for c in mock_supabase.rpc.call_args_list
            if c.args[0] == "claim_compute_jobs_with_priority"
        ]
        assert len(priority_calls) == 1
        params = priority_calls[0].args[1]
        assert params == {"p_batch_size": 5, "p_worker_id": "worker-test-shape"}


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
        assert overrides["sync_trades"] == "20 minutes"
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
    supabase/migrations/090_claim_dedupe_partition_keys.sql) plus the
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
