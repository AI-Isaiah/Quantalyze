"""Load test for the dispatch loop: enqueue 100 pending jobs, run
dispatch_tick repeatedly, verify drain completes with no jobs left in
'running' state.

Uses a mocked Supabase client that simulates
claim_compute_jobs_with_priority returning batches of 5 and dispatch
returning DONE for each. Verifies:
  - All 100 jobs get dispatched
  - mark_compute_job_done called 100 times
  - No mark_compute_job_failed calls
  - No jobs stuck in 'running' (all moved to done)

Phase 12 / Plan 12-07: dispatch_tick now claims via the priority-aware RPC
(claim_compute_jobs_with_priority); the legacy claim_compute_jobs RPC is no
longer reached from the dispatch path. The mock dispatcher matches the new
RPC name.
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

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
            if name == "claim_compute_jobs_with_priority":
                # Return next batch (up to batch_size) from pending.
                # Phase 12 / Plan 12-07: dispatch_tick swapped to the
                # priority-aware claim RPC (migration 086). Legacy
                # claim_compute_jobs name is no longer reached.
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

        # H-0819 / M-0756: fresh DispatchResult per call. A single shared
        # return_value instance leaks state across all 100 awaits — if a
        # refactor gives DispatchResult mutable fields (e.g.
        # `metrics: dict = field(default_factory=dict)`) or the caller
        # mutates the result in place, every call sees the same object and a
        # cross-call corruption bug would pass spuriously. side_effect
        # constructs a new instance per invocation. We also track in-flight
        # concurrency here (H-0818) and record the per-call result object
        # identities (H-0819) so that reverting the mock to a shared
        # `return_value=<one DispatchResult>` is caught structurally below —
        # not left to rely solely on DispatchResult's frozen=True guard,
        # which a future un-freeze would silently remove.
        in_flight = 0
        max_in_flight = 0
        # Hold the actual DispatchResult OBJECTS (not their id()s). CPython
        # reuses an id() once the object is GC'd, so recording bare ids and
        # checking distinctness later flakes under memory pressure (a CI box
        # collected ~11 of 100 before the assertion). Keeping the objects alive
        # pins their ids, making the distinctness check deterministic.
        dispatched_results: list[DispatchResult] = []

        async def _dispatch_side_effect(job: dict) -> DispatchResult:
            nonlocal in_flight, max_in_flight
            in_flight += 1
            max_in_flight = max(max_in_flight, in_flight)
            try:
                # Yield control so that if dispatch_tick ever launched jobs
                # concurrently (e.g. asyncio.gather over the batch), overlap
                # would register in max_in_flight. With the current
                # sequential `await dispatch(job)` loop, in_flight returns to
                # 0 before the next job starts.
                await asyncio.sleep(0)
                res = DispatchResult(outcome=DispatchOutcome.DONE)
                dispatched_results.append(res)
                return res
            finally:
                in_flight -= 1

        mock_dispatch = AsyncMock(side_effect=_dispatch_side_effect)

        # H-0817: patch is_unified_backbone_active. The real implementation
        # is awaited every tick to populate p_unified_backbone_active. Under
        # the MagicMock supabase it would read .data.get('value') off a
        # MagicMock (truthy garbage) and cache the result — making the load
        # test depend on accidental mock behavior rather than a controlled
        # flag, and masking a regression that makes the flag fetch raise per
        # tick (it fail-softs to False, so throughput silently degrades with
        # no test failure). Pin it to a real boolean and assert it's used.
        with patch("main_worker.get_supabase", return_value=mock_supabase), \
             patch("main_worker.dispatch", new=mock_dispatch), \
             patch(
                 "main_worker.is_unified_backbone_active",
                 new=AsyncMock(return_value=True),
             ) as mock_flag:
            # Run dispatch_tick enough times to drain all 100 jobs
            # 100 jobs / 5 per batch = 20 ticks + 1 empty tick
            for _ in range(25):
                await dispatch_tick("worker-load-test")

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

        # --- H-0817: the unified-backbone flag is read every dispatch tick.
        # 25 ticks → at least the 21 non-empty-then-empty ticks call it once
        # each (the function itself caches, but dispatch_tick awaits it every
        # tick). Assert it was actually exercised and that the claimed flag
        # propagates into the claim RPC params.
        assert mock_flag.await_count >= 21, (
            f"is_unified_backbone_active must be read every tick; "
            f"got {mock_flag.await_count} awaits across 25 ticks"
        )
        claim_calls = [
            c for c in mock_supabase.rpc.call_args_list
            if c.args[0] == "claim_compute_jobs_with_priority"
        ]
        assert claim_calls, "claim RPC never called"
        for c in claim_calls:
            assert c.args[1]["p_unified_backbone_active"] is True, (
                "the per-tick flag value must flow into the claim RPC params"
            )

        # --- H-0818: in-flight concurrency characterization. dispatch_tick
        # processes a claimed batch with a sequential `await dispatch(job)`
        # loop, so at most ONE job is ever in flight at a time. Pin that:
        # a refactor to asyncio.gather(batch) (intended speedup) or an
        # accidental fire-and-forget would push max_in_flight above 1 and
        # break the claim-token/late-mark ordering assumptions. If a future
        # PR deliberately parallelizes, this assertion is the forcing
        # function to revisit the fence semantics.
        assert max_in_flight == 1, (
            f"dispatch_tick must process its batch sequentially "
            f"(one job in flight at a time); saw max_in_flight={max_in_flight}"
        )

        # --- H-0816 / H-0818: load characterization is asserted STRUCTURALLY,
        # not by wall-clock. A wall-clock budget (`elapsed < Ns`) inside a
        # fully-mocked async test measures the event loop's scheduling under
        # whatever else the suite is running, not real throughput — it flakes
        # intermittently under full-suite load while adding no signal the
        # deterministic assertions don't already give. The serialization
        # regression the budget was meant to catch (a blocking sync call in the
        # per-job hot loop) is caught structurally by `max_in_flight == 1`
        # (concurrency) + `mock_dispatch.await_count == total_jobs` (throughput:
        # every job dispatched) + the per-tick flag read above — all
        # deterministic and order-independent. The wall-clock was the only
        # non-deterministic assertion and is deliberately omitted.

        # --- H-0818: no job left un-terminal. Every claimed job must reach a
        # terminal mark (done or failed); none may be silently dropped
        # mid-batch (the docstring's 'no jobs stuck in running' promise,
        # previously unasserted).
        terminal_ids = set(done_ids) | set(failed_ids)
        assert terminal_ids == {j["id"] for j in all_jobs}, (
            "every claimed job must reach a terminal mark — none left in "
            "an implicit 'running' state"
        )

        # --- H-0819: every dispatch await must have produced its OWN
        # DispatchResult instance. The original load test shared a single
        # `return_value=DispatchResult(...)` across all 100 awaits, so a
        # cross-call state leak (a mutable field added for instrumentation, or
        # the caller mutating the result in place before the mark RPC) would
        # pass spuriously. With a fresh instance per call, the recorded object
        # ids are all distinct; a regression back to a shared instance
        # collapses them to a single id and trips this assertion regardless of
        # whether DispatchResult is still frozen. (Objects are held alive in
        # dispatched_results so their ids cannot be reused — see above.)
        assert len(dispatched_results) == total_jobs, (
            f"expected one result instance recorded per dispatched job; "
            f"got {len(dispatched_results)} for {total_jobs} jobs"
        )
        assert len({id(r) for r in dispatched_results}) == total_jobs, (
            "each dispatch await must yield a distinct DispatchResult "
            "instance — a shared return_value would collapse these ids and "
            "let a cross-call state-leak bug pass undetected"
        )
