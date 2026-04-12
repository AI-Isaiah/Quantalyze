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
        # subsequent calls (mark_done / mark_failed).
        call_count = 0

        def _rpc_side_effect(name: str, params: dict):
            nonlocal call_count
            call_count += 1
            if name == "claim_compute_jobs":
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
        assert rpc_names.count("claim_compute_jobs") == 1
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
            if name == "claim_compute_jobs":
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
            if name == "claim_compute_jobs":
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
        # Per-kind overrides must match the module-level constant
        overrides = json.loads(params["p_per_kind_overrides"])
        assert overrides["sync_trades"] == "10 minutes"
        assert overrides["compute_analytics"] == "20 minutes"
        assert overrides["poll_positions"] == "5 minutes"
        assert overrides["compute_portfolio"] == "10 minutes"


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
