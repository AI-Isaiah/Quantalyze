"""Load test for the dispatch loop: enqueue 100 pending jobs, run
dispatch_tick repeatedly, verify drain completes with no jobs left in
'running' state.

Uses a mocked Supabase client that simulates claim_compute_jobs returning
batches of 5 and dispatch returning DONE for each. Verifies:
  - All 100 jobs get dispatched
  - mark_compute_job_done called 100 times
  - No mark_compute_job_failed calls
  - No jobs stuck in 'running' (all moved to done)
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from main_worker import dispatch_tick
from services.job_worker import DispatchOutcome, DispatchResult


class TestWorkerLoadDrain:
    """Drain 100 jobs through dispatch_tick in batches of 5."""

    async def test_drain_100_jobs(self) -> None:
        total_jobs = 100
        batch_size = 5
        # Generate 100 pending jobs
        all_jobs = [
            {"id": f"job-{i}", "kind": "sync_trades", "strategy_id": f"s-{i}"}
            for i in range(total_jobs)
        ]

        # Track state: jobs move from pending → done
        pending = list(all_jobs)
        done_ids: list[str] = []
        failed_ids: list[str] = []

        mock_supabase = MagicMock()

        def _rpc_side_effect(name: str, params: dict):
            chain = MagicMock()
            if name == "claim_compute_jobs":
                # Return next batch (up to batch_size) from pending
                batch = pending[:batch_size]
                del pending[:batch_size]
                chain.execute.return_value = MagicMock(data=batch)
            elif name == "mark_compute_job_done":
                done_ids.append(params["p_job_id"])
                chain.execute.return_value = MagicMock(data=None)
            elif name == "mark_compute_job_failed":
                failed_ids.append(params["p_job_id"])
                chain.execute.return_value = MagicMock(data=None)
            else:
                chain.execute.return_value = MagicMock(data=None)
            return chain

        mock_supabase.rpc.side_effect = _rpc_side_effect

        mock_dispatch = AsyncMock(
            return_value=DispatchResult(outcome=DispatchOutcome.DONE)
        )

        with patch("main_worker.get_supabase", return_value=mock_supabase), \
             patch("main_worker.dispatch", new=mock_dispatch):
            # Run dispatch_tick enough times to drain all 100 jobs
            # 100 jobs / 5 per batch = 20 ticks + 1 empty tick
            for _ in range(25):
                await dispatch_tick("worker-load-test")
                if not pending:
                    # One more tick to get the final batch processed,
                    # then a final empty one to confirm drain
                    pass

        # All 100 jobs should have been dispatched
        assert mock_dispatch.await_count == total_jobs
        # All 100 should be marked done
        assert len(done_ids) == total_jobs
        # No failures
        assert len(failed_ids) == 0
        # No jobs left in pending (all drained)
        assert len(pending) == 0
        # Verify unique job IDs — no duplicates
        assert len(set(done_ids)) == total_jobs
