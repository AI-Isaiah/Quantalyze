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
        # H-0776: make the call_count bookkeeping load-bearing instead of
        # dead scaffolding. The side-effect fires once per supabase.rpc()
        # call, so 1 claim + 3 mark_done = 4 — this pins that dispatch_tick
        # issues exactly one mark RPC per dispatched job (no extra probes,
        # no missed marks) independently of the name-count assertions above.
        assert call_count == 4, (
            f"expected 1 claim + 3 mark RPC calls = 4, got {call_count}"
        )

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

        # M-0738: LAST_TICK_AT is a module global read by healthz-probe code
        # elsewhere. Snapshot + restore in try/finally so this test's
        # mutation can't leak test-order-dependent state into downstream
        # tests (or other files) that read the same global.
        _saved_tick = main_worker_healthz.LAST_TICK_AT
        try:
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
        finally:
            main_worker_healthz.LAST_TICK_AT = _saved_tick

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

        # M-0738: snapshot + restore the global (see idle test above).
        _saved_tick = main_worker_healthz.LAST_TICK_AT
        try:
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
        finally:
            main_worker_healthz.LAST_TICK_AT = _saved_tick

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
        worker_id passed through, and p_unified_backbone_active as a
        constant True (Phase 106: backbone permanent-on; the former
        per-tick is_unified_backbone_active() read is now a literal True,
        claim-RPC signature unchanged)."""
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
        assert params == {
            "p_batch_size": 5,
            "p_worker_id": "worker-test-shape",
            "p_unified_backbone_active": True,
        }


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
        assert overrides["poll_positions"] == "5 minutes"
        assert overrides["compute_portfolio"] == "15 minutes"

    @pytest.mark.asyncio
    async def test_overrides_encode_as_jsonb_object_not_scalar(self) -> None:
        """H-0773: the JSONB-scalar prod bug.

        The fix dropped json.dumps() because passing a stringified dict to
        PostgREST encodes as a JSONB *scalar* (a JSON string), and the RPC's
        jsonb_object_keys(p_per_kind_overrides) then raises
        'cannot call jsonb_object_keys on a scalar'. The isinstance(dict)
        check above proves the Python type, but NOT the over-the-wire JSON
        shape that actually trips Postgres.

        PostgREST serializes RPC params with json.dumps. We replay that
        serialization on the exact object passed and assert the encoded form
        round-trips to a JSON OBJECT (`{...}`), not a JSON string scalar
        (`"{...}"`). A regression that re-wraps the dict in json.dumps()
        before the RPC call makes this fail because the param would encode
        as a double-escaped string scalar.
        """
        import json

        mock_supabase = MagicMock()
        chain = MagicMock()
        chain.execute.return_value = MagicMock(data=0)
        mock_supabase.rpc.return_value = chain

        with patch("main_worker.get_supabase", return_value=mock_supabase):
            await watchdog_tick()

        params = mock_supabase.rpc.call_args.args[1]
        param_value = params["p_per_kind_overrides"]

        # Emulate the PostgREST wire encoding of the RPC body.
        encoded = json.dumps({"p_per_kind_overrides": param_value})
        decoded = json.loads(encoded)["p_per_kind_overrides"]

        # Decoded back to a dict (JSONB object) — NOT a str (JSONB scalar)
        # which is what json.dumps()-then-send would produce.
        assert isinstance(decoded, dict), (
            "p_per_kind_overrides must encode as a JSON object so Postgres "
            "stores a JSONB object; a stringified dict encodes as a JSON "
            "string scalar and trips jsonb_object_keys() in the RPC."
        )
        # The raw JSON fragment for this key must open with '{', not '\"' —
        # i.e. an object literal, not a quoted string.
        key_pos = encoded.index('"p_per_kind_overrides"')
        colon_pos = encoded.index(":", key_pos)
        first_non_space = encoded[colon_pos + 1:].lstrip()[0]
        assert first_non_space == "{", (
            f"JSONB value must be an object literal; got leading {first_non_space!r}"
        )


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

        # H-0774: SHUTDOWN is a module-GLOBAL asyncio.Event. This test sets
        # it mid-body; if the body raised between set() and the cleanup
        # clear() (e.g. asyncio.wait timing out, an internal assertion),
        # SHUTDOWN would stay set and EVERY downstream test whose code awaits
        # a *_loop would exit immediately — an invisible, test-order-dependent
        # cross-contamination. try/finally guarantees restoration on any exit
        # path (assertion failure, CancelledError, KeyboardInterrupt).
        SHUTDOWN.clear()  # start from a known-clear state
        try:
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
        finally:
            # Guaranteed restoration so a failure above can't leave the
            # global SHUTDOWN set for the rest of the suite.
            SHUTDOWN.clear()


# ---------------------------------------------------------------------------
# Loop-level failure isolation + daily_enqueue_loop shutdown (M-1003)
# ---------------------------------------------------------------------------

class TestLoopFailureIsolation:
    """M-1003 (audit-2026-05-07 / reverify-2026-05-25).

    The three worker loops (dispatch_loop / watchdog_loop / daily_enqueue_loop)
    each wrap their tick in `try/except Exception` (`# noqa: BLE001`) so a
    single tick failure is logged but does NOT crash the gather — the worker
    must survive a transient DB blip and keep ticking. The tick functions
    themselves are covered (TestDispatchTick etc.) and dispatch_loop's
    SHUTDOWN exit is covered (TestShutdown), but the loop-level failure
    ISOLATION and daily_enqueue_loop's SHUTDOWN exit / initial-tick-failure
    paths were untested. A regression that let a tick exception escape the
    loop body (e.g. narrowing the except, or moving the wait_for outside the
    try) would crash the whole worker on the first transient error.

    Each test uses a near-zero interval and arms SHUTDOWN so the infinite loop
    terminates deterministically without sleeping a real interval.

    SHUTDOWN is a module-GLOBAL `asyncio.Event` created at import time, so it
    binds to the FIRST event loop that awaits it. pytest-asyncio gives each
    test a fresh loop, so a second SHUTDOWN-awaiting test on a new loop hits
    `RuntimeError: bound to a different event loop`. To keep these tests loop-
    isolated, each one swaps `main_worker.SHUTDOWN` with a fresh Event created
    inside its own running loop (via `_fresh_shutdown()`), and restores the
    original module global in `finally`. The loops read `main_worker.SHUTDOWN`
    by module attribute at await-time, so the swap takes effect for the loop
    task launched after it.
    """

    @staticmethod
    def _fresh_shutdown():
        """Install a fresh asyncio.Event() (bound to the current running loop)
        as main_worker.SHUTDOWN and return (new_event, restore_fn)."""
        import main_worker

        original = main_worker.SHUTDOWN
        new_event = asyncio.Event()
        main_worker.SHUTDOWN = new_event

        def restore() -> None:
            main_worker.SHUTDOWN = original

        return new_event, restore

    @staticmethod
    async def _gate_not_run_today() -> bool:
        """Force daily_enqueue_loop's startup gate to 'not run today' so the
        initial tick fires deterministically, independent of test-DB state.

        `_daily_enqueue_already_ran_today()` makes a REAL Supabase query and
        returns True whenever a `daily_loop` poll_positions row exists for the
        current UTC day. The two daily_enqueue tests below exercise the loop's
        initial-tick isolation and SHUTDOWN-exit paths — not the DB gate — so
        without this stub they fail (ticks=0, initial tick skipped) on any
        environment whose test DB happens to hold a same-day daily_loop row.
        The gate was added after these tests (redteam-2026-05 W1) and they were
        never updated to mock it."""
        return False

    @pytest.mark.asyncio
    async def test_dispatch_loop_survives_a_tick_exception_then_exits_on_shutdown(self) -> None:
        from main_worker import dispatch_loop

        shutdown, restore = self._fresh_shutdown()
        try:
            call_count = 0

            async def _flaky_tick(_worker_id: str) -> None:
                nonlocal call_count
                call_count += 1
                if call_count == 1:
                    # First tick raises — the loop MUST log + isolate it and
                    # proceed to the wait_for branch instead of crashing.
                    raise RuntimeError("transient DB blip")
                # Second tick onward: arm shutdown so the loop terminates after
                # proving it survived the first failure.
                shutdown.set()

            with patch("main_worker.dispatch_tick", new=_flaky_tick):
                loop_task = asyncio.create_task(
                    dispatch_loop("test-worker", interval=0.01)
                )
                done, pending = await asyncio.wait({loop_task}, timeout=2.0)
                for p in pending:
                    p.cancel()

            assert loop_task.done(), "dispatch_loop hung after a tick exception"
            # The loop did NOT crash on the first raise: the tick ran at least
            # twice (the failing tick + the survivor that armed shutdown).
            assert call_count >= 2, (
                f"dispatch_loop did not continue past the failing tick "
                f"(call_count={call_count})"
            )
            # The exception did not propagate out of the loop coroutine.
            assert loop_task.exception() is None, (
                f"tick exception escaped the loop: {loop_task.exception()!r}"
            )
        finally:
            restore()

    @pytest.mark.asyncio
    async def test_watchdog_loop_survives_a_tick_exception_then_exits_on_shutdown(self) -> None:
        from main_worker import watchdog_loop

        shutdown, restore = self._fresh_shutdown()
        try:
            call_count = 0

            async def _flaky_tick() -> None:
                nonlocal call_count
                call_count += 1
                if call_count == 1:
                    raise RuntimeError("reclaim RPC blip")
                shutdown.set()

            with patch("main_worker.watchdog_tick", new=_flaky_tick):
                loop_task = asyncio.create_task(watchdog_loop(interval=0.01))
                done, pending = await asyncio.wait({loop_task}, timeout=2.0)
                for p in pending:
                    p.cancel()

            assert loop_task.done(), "watchdog_loop hung after a tick exception"
            assert call_count >= 2, (
                f"watchdog_loop did not continue past the failing tick "
                f"(call_count={call_count})"
            )
            assert loop_task.exception() is None, (
                f"tick exception escaped watchdog_loop: {loop_task.exception()!r}"
            )
        finally:
            restore()

    @pytest.mark.asyncio
    async def test_daily_enqueue_loop_initial_tick_failure_does_not_crash_and_exits_on_shutdown(self) -> None:
        # daily_enqueue_loop runs an INITIAL tick on startup (outside the
        # while-loop) before entering the wait/tick cycle. That initial tick
        # has its own try/except; if it raised unguarded the worker's
        # asyncio.gather would crash at startup. Verify: initial tick raises →
        # loop still reaches the wait_for branch → SHUTDOWN exits it cleanly,
        # with no exception escaping.
        from main_worker import daily_enqueue_loop

        shutdown, restore = self._fresh_shutdown()
        # Arm shutdown immediately so the post-initial-tick wait_for returns at
        # once. The initial tick still fires (and raises) before the while.
        shutdown.set()
        try:
            ticks = 0

            async def _failing_initial_tick() -> None:
                nonlocal ticks
                ticks += 1
                raise RuntimeError("startup enqueue RPC down")

            with patch("main_worker.daily_enqueue_tick", new=_failing_initial_tick), \
                 patch("main_worker._daily_enqueue_already_ran_today", new=self._gate_not_run_today):
                loop_task = asyncio.create_task(
                    daily_enqueue_loop(interval=0.01)
                )
                done, pending = await asyncio.wait({loop_task}, timeout=2.0)
                for p in pending:
                    p.cancel()

            assert loop_task.done(), "daily_enqueue_loop hung after initial tick failure"
            assert ticks >= 1, "initial tick was never attempted"
            # The initial-tick exception was isolated, not propagated.
            assert loop_task.exception() is None, (
                f"initial-tick exception escaped daily_enqueue_loop: "
                f"{loop_task.exception()!r}"
            )
        finally:
            restore()

    @pytest.mark.asyncio
    async def test_daily_enqueue_loop_exits_on_shutdown(self) -> None:
        # The SHUTDOWN-exit path for daily_enqueue_loop was untested (only
        # dispatch_loop's was). With a healthy initial tick and SHUTDOWN armed,
        # the loop must run the initial tick then return promptly via the
        # wait_for(SHUTDOWN.wait()) branch — not block for a full `interval`.
        from main_worker import daily_enqueue_loop

        shutdown, restore = self._fresh_shutdown()
        shutdown.set()
        try:
            ticks = 0

            async def _ok_tick() -> None:
                nonlocal ticks
                ticks += 1

            with patch("main_worker.daily_enqueue_tick", new=_ok_tick), \
                 patch("main_worker._daily_enqueue_already_ran_today", new=self._gate_not_run_today):
                # interval is deliberately HUGE — if the loop ignored SHUTDOWN
                # and waited the interval, the 2s asyncio.wait timeout below
                # would leave the task pending and the assertion would fail.
                loop_task = asyncio.create_task(
                    daily_enqueue_loop(interval=3600.0)
                )
                done, pending = await asyncio.wait({loop_task}, timeout=2.0)
                for p in pending:
                    p.cancel()

            assert loop_task.done(), (
                "daily_enqueue_loop did not honor SHUTDOWN within the timeout "
                "(it waited the full interval instead of the wait_for race)"
            )
            assert ticks == 1, f"expected exactly one initial tick, got {ticks}"
        finally:
            restore()


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
    async def test_partial_batch_forwards_the_survivor_row_to_dispatch(self) -> None:
        """Audit closure M-1125: the test above asserts dispatch is awaited
        ONCE but never that the SURVIVOR row is what reached dispatch. If
        dispatch_tick had a bug indexing the claim result wrong (e.g. forwarded
        a stale/empty dict after dedupe), `assert_awaited_once()` still passes.
        Bind the IDENTITY of the forwarded job: dispatch must receive the exact
        survivor dict (id='rescore-survivor'), not just be called once."""
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
            await dispatch_tick("worker-dedupe-survivor-id")

        # The job forwarded to dispatch must BE the survivor (first positional).
        mock_dispatch.assert_awaited_once()
        forwarded_job = mock_dispatch.await_args.args[0]
        assert forwarded_job["id"] == "rescore-survivor", (
            f"dispatch received the wrong job after dedupe: {forwarded_job!r}"
        )
        assert forwarded_job == survivor

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
# Audit closure M-0739 — every dispatch_tick test uses kind='sync_trades'.
# dispatch_tick also handles non-sync_trades kinds (e.g.
# compute_analytics_from_csv). The PER-KIND HANDLER routing is covered in
# test_job_worker.py::test_dispatch_routes_*. The gap THIS test fills is at
# the dispatch_tick layer: dispatch_tick must forward a non-sync_trades row
# to dispatch() UNCHANGED — it must not silently filter/drop non-sync_trades
# kinds from the claim batch (which would no-op them while sync_trades tests
# stay green).
# ---------------------------------------------------------------------------


class TestDispatchTickKindAgnostic:
    @pytest.mark.asyncio
    async def test_compute_analytics_job_is_forwarded_to_dispatch(self) -> None:
        """A claimed non-sync_trades job reaches dispatch() with its
        kind intact — dispatch_tick is kind-agnostic and must not drop it."""
        job = {
            "id": "ca-job-1",
            "kind": "compute_analytics_from_csv",
            "strategy_id": "strat-backfill",
        }
        mock_supabase = MagicMock()
        claim_chain = MagicMock()
        claim_chain.execute.return_value = MagicMock(data=[job])
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
            await dispatch_tick("worker-compute-analytics")

        mock_dispatch.assert_awaited_once()
        forwarded = mock_dispatch.await_args.args[0]
        assert forwarded["kind"] == "compute_analytics_from_csv", (
            f"dispatch_tick mangled or dropped the compute_analytics_from_csv kind: "
            f"{forwarded!r}"
        )
        assert forwarded["id"] == "ca-job-1"
        # Success path: exactly one mark_done, no mark_failed.
        rpc_names = [c.args[0] for c in mock_supabase.rpc.call_args_list]
        assert rpc_names.count("mark_compute_job_done") == 1
        assert rpc_names.count("mark_compute_job_failed") == 0


# ---------------------------------------------------------------------------
# Watchdog-vs-handler-timeout invariant (regression for /investigate root
# cause: the wizard's "Verify data" step hung at 2674s because the
# sync_trades watchdog yanked the still-running job back to 'pending' before
# the handler could fail-classify itself, looping forever and never writing
# strategy_analytics.computation_status to a terminal state).
# ---------------------------------------------------------------------------


# Unit multipliers for the Postgres-INTERVAL strings that
# WATCHDOG_PER_KIND_OVERRIDES feeds straight into
# reset_stalled_compute_jobs(p_per_kind_overrides), where they are cast with
# `(p_per_kind_overrides ->> kind)::INTERVAL` (migration
# 20260412094449_compute_jobs_admin_and_defer.sql STEP 6). The override is a
# free-form interval string, NOT a minutes-only field: '30 seconds', '1 hour',
# and '15 minutes' are all legitimate Postgres intervals the cast accepts.
#
# H-0778: the previous oracle, `_parse_minutes`, hard-asserted the value
# matched `\d+ minute(s)`. That made it a duck-typed parser with a DIFFERENT
# unit contract than production: a maintainer who legitimately wrote
# '90 seconds' (a faster kind) crashed this helper with an AssertionError
# instead of having the invariant evaluated, and worse, the inverse typo
# ('60 minutes' meant as '60 seconds') sailed through because the helper only
# knew minutes. Mirror the production cast's unit handling here so the test
# oracle measures the SAME thing the watchdog SQL does — total seconds — and
# the lower/upper-bound invariants below hold across units.
_INTERVAL_UNIT_SECONDS: dict[str, int] = {
    "second": 1,
    "seconds": 1,
    "minute": 60,
    "minutes": 60,
    "hour": 3600,
    "hours": 3600,
}


def _watchdog_seconds(s: str) -> float:
    """Convert a single-term Postgres INTERVAL string ('30 seconds',
    '15 minutes', '1 hour') to total seconds, matching the unit semantics of
    the `::INTERVAL` cast in reset_stalled_compute_jobs. Unit-agnostic on
    purpose: the override map's contract is "any interval the SQL cast
    accepts", not "minutes only"."""
    parts = s.strip().split()
    assert len(parts) == 2 and parts[1] in _INTERVAL_UNIT_SECONDS, (
        f"Unexpected watchdog threshold format {s!r}: expected "
        f"'<int> <{'/'.join(sorted(_INTERVAL_UNIT_SECONDS))}>'. If a new "
        "Postgres interval unit is genuinely needed, add it to "
        "_INTERVAL_UNIT_SECONDS so the invariant can still measure it."
    )
    return int(parts[0]) * _INTERVAL_UNIT_SECONDS[parts[1]]


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
            watchdog_seconds = _watchdog_seconds(watchdog_str)
            assert watchdog_seconds > handler_seconds, (
                f"Watchdog threshold for {kind!r} ({watchdog_seconds}s) is not "
                f"greater than its handler timeout ({handler_seconds:.0f}s). "
                "The handler must have a chance to fail-classify itself before "
                "the watchdog yanks the row — otherwise the job loops forever "
                "and any caller polling for terminal status hangs."
            )

    def test_every_kind_has_watchdog_headroom(self) -> None:
        """The override-only test above missed kinds that fall through to
        the global default. The original per-kind watchdog fix (PR #106)
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
        # an explicit override and must update this constant too. Stored as
        # the same interval-string form the worker actually passes the SQL so
        # it goes through the identical _watchdog_seconds oracle as the
        # per-kind overrides (no second, divergent unit assumption).
        DEFAULT_WATCHDOG_INTERVAL = "10 minutes"

        for kind, handler_seconds in TIMEOUT_PER_KIND.items():
            override = WATCHDOG_PER_KIND_OVERRIDES.get(kind)
            watchdog_seconds = _watchdog_seconds(override or DEFAULT_WATCHDOG_INTERVAL)
            assert watchdog_seconds > handler_seconds, (
                f"Kind {kind!r}: handler timeout {handler_seconds:.0f}s "
                f"exceeds watchdog threshold {watchdog_seconds:.0f}s. "
                f"Add an entry to WATCHDOG_PER_KIND_OVERRIDES with a "
                f"value greater than {handler_seconds:.0f} seconds — "
                "otherwise the watchdog reclaims the still-running job "
                "and any caller polling for terminal status hangs."
            )

    def test_watchdog_threshold_has_sane_upper_bound(self) -> None:
        """H-0777: the watchdog override is a free-form human-typed string
        (`"60 minutes"`). The lower-bound invariant above only stops a
        watchdog SHORTER than the handler timeout. But a maintainer typo —
        e.g. `"60 minutes"` intended as `"60 seconds"`, or a stray extra
        digit — produces an absurdly large watchdog window. A 60x window
        means a genuinely-stuck job sits reclaimable-but-unreclaimed for an
        hour, the very stall the watchdog exists to break.

        Observed ratios across all current overrides are 1.17x–2.0x of the
        handler timeout. Cap at 4x: comfortably above every legitimate
        value yet far below the 60x a unit-vs-unit typo would yield. A
        deliberate larger window must update this bound (and justify why a
        stuck job should sit that long), which is the point — make the
        decision explicit instead of letting a typo through silently."""
        from main_worker import WATCHDOG_PER_KIND_OVERRIDES
        from services.job_worker import TIMEOUT_PER_KIND

        MAX_RATIO = 4.0
        for kind, watchdog_str in WATCHDOG_PER_KIND_OVERRIDES.items():
            handler_seconds = TIMEOUT_PER_KIND[kind]
            watchdog_seconds = _watchdog_seconds(watchdog_str)
            ratio = watchdog_seconds / handler_seconds
            assert ratio <= MAX_RATIO, (
                f"Kind {kind!r}: watchdog threshold {watchdog_seconds:.0f}s is "
                f"{ratio:.1f}x its {handler_seconds:.0f}s handler timeout — "
                f"above the {MAX_RATIO}x sanity cap. This smells like a "
                "unit typo (e.g. '60 minutes' where '60 seconds' was meant). "
                "A genuinely-stuck job would sit unreclaimed far too long. "
                "If the large window is intentional, raise MAX_RATIO and "
                "document why."
            )

    def test_no_override_disables_the_watchdog(self) -> None:
        """H-0778: a per-kind override of '0 minutes' (or '0 seconds') is the
        moral equivalent of DISABLING the watchdog for that kind, and it is a
        silent footgun. reset_stalled_compute_jobs validates only the GLOBAL
        p_stale_threshold (`<= interval '0'` raises) — it does NOT validate
        per-kind override values
        (`v_threshold := (p_per_kind_overrides ->> v_kind)::INTERVAL` with no
        bound check, migration 20260412094449 STEP 6). With a 0 threshold the
        per-kind UPDATE's `claimed_at < (now() - v_threshold)` is true for
        EVERY just-claimed running row, so the watchdog reclaims jobs the
        instant the worker claims them — they bounce pending↔running forever
        and never run to completion. The lower-bound test above catches 0 only
        as a side effect of `> handler_seconds`; this test pins the disable
        semantics directly so the intent ('a watchdog override must impose a
        real, positive window') survives even if handler timeouts are ever
        lowered toward zero."""
        from main_worker import WATCHDOG_PER_KIND_OVERRIDES

        for kind, watchdog_str in WATCHDOG_PER_KIND_OVERRIDES.items():
            watchdog_seconds = _watchdog_seconds(watchdog_str)
            assert watchdog_seconds > 0, (
                f"Kind {kind!r}: watchdog override {watchdog_str!r} resolves to "
                f"{watchdog_seconds}s. A zero (or negative) watchdog window "
                "effectively disables the watchdog: reset_stalled_compute_jobs "
                "reclaims the job the instant it is claimed (claimed_at < "
                "now() - interval '0'), so it never completes. The SQL does not "
                "guard per-kind overrides — this test is the only fence against "
                "an accidental '0 minutes' silently neutering the watchdog."
            )

    def test_watchdog_seconds_oracle_matches_postgres_interval_units(self) -> None:
        """H-0778 regression guard for the ORACLE itself. The override values
        are fed verbatim into Postgres `::INTERVAL`, so the test's parser must
        agree with Postgres on units — not silently re-interpret everything as
        minutes (the duck-typed `_parse_minutes` bug this finding flagged). If
        someone re-narrows the oracle back to minutes-only, the 'seconds' /
        'hours' cases below break, which is exactly the regression we want a
        red test for: a minutes-only oracle would crash on a legitimate
        '90 seconds' override and let a '60 minutes'-meant-as-'60 seconds' typo
        through (it would read 60, not 1)."""
        # Equality across units is the whole point: 1 minute == 60 seconds,
        # 1 hour == 60 minutes. A minutes-only parser cannot express these.
        assert _watchdog_seconds("90 seconds") == 90
        assert _watchdog_seconds("1 minute") == _watchdog_seconds("60 seconds")
        assert _watchdog_seconds("1 hour") == _watchdog_seconds("60 minutes")
        # The typo the finding describes: '60 minutes' written where
        # '60 seconds' was meant must read as 3600s, not collapse to 60.
        assert _watchdog_seconds("60 minutes") == 3600
        assert _watchdog_seconds("60 seconds") == 60
        # A garbage / unsupported-unit value must fail loudly (caught format),
        # never be coerced to a passing number.
        with pytest.raises(AssertionError):
            _watchdog_seconds("soon")
        with pytest.raises(AssertionError):
            _watchdog_seconds("10 fortnights")


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
        main_worker._FALLBACK_LATCHED_AT = 0.0

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

    # -----------------------------------------------------------------------
    # redteam-2026-05 W1 (MED8) — the latch must not be PERMANENT on a
    # TRANSIENT 42883. A 42883 is raised transiently while a migration is
    # mid-`CREATE OR REPLACE` (functions drop-recreate; migrations auto-apply
    # on merge). Pre-fix, a single hit demoted the worker to the legacy claim
    # for the process lifetime. Post-fix: (a) only a STRUCTURED SQLSTATE 42883
    # latches (a message-only match falls back for one tick but never latches),
    # and (b) even a structured latch self-heals after the re-probe interval.
    # -----------------------------------------------------------------------

    @pytest.mark.asyncio
    async def test_message_only_42883_does_not_latch_permanently(self) -> None:
        """A 42883 surfaced ONLY in the message string (no structured `.code`)
        triggers the one-shot per-tick fallback but must NOT latch. The very
        next tick must re-attempt the priority RPC — a transient drop during a
        mid-`CREATE OR REPLACE` migration self-heals."""
        import main_worker

        # Plain exception with the canonical phrase in the message and NO
        # structured `.code`/`.details` — exactly what a loose match sees.
        transient_exc = RuntimeError(
            "function public.claim_compute_jobs_with_priority(...) does not exist"
        )

        mock_supabase = MagicMock()
        priority_chain = MagicMock()
        # First tick: priority RPC transiently 42883s (message-only). Second
        # tick: priority RPC succeeds (migration finished re-creating it).
        priority_chain.execute.side_effect = [transient_exc, MagicMock(data=[])]
        legacy_chain = MagicMock()
        legacy_chain.execute.return_value = MagicMock(data=[])

        def _rpc_side_effect(name: str, params: dict):
            if name == "claim_compute_jobs_with_priority":
                return priority_chain
            return legacy_chain

        mock_supabase.rpc.side_effect = _rpc_side_effect

        with patch("main_worker.get_supabase", return_value=mock_supabase), \
             patch("main_worker.dispatch", new=AsyncMock()):
            # Tick 1: message-only 42883 → fallback for this tick only.
            await dispatch_tick("worker-msg-only")
            # The message-only match must NOT have latched.
            assert main_worker._FALLBACK_CLAIM_RPC is False, (
                "a message-only 42883 must not permanently latch the worker "
                "into legacy claim mode"
            )
            mock_supabase.rpc.reset_mock()
            # Tick 2: the priority RPC MUST be re-attempted (self-heal).
            await dispatch_tick("worker-msg-only")

        called = [c.args[0] for c in mock_supabase.rpc.call_args_list]
        assert "claim_compute_jobs_with_priority" in called, (
            "after a transient message-only 42883, the next tick must "
            f"re-probe the priority RPC; got {called}"
        )

    @pytest.mark.asyncio
    async def test_structured_42883_latch_reprobes_after_interval(self) -> None:
        """A STRUCTURED 42883 latches the worker to legacy claim — but the
        latch self-heals: once `_FALLBACK_REPROBE_INTERVAL_S` has elapsed, the
        next tick MUST re-attempt the priority RPC instead of staying demoted
        for the process lifetime."""
        from postgrest.exceptions import APIError

        import main_worker

        mock_supabase = MagicMock()
        priority_chain = MagicMock()
        # First priority attempt 42883s (structured). After the simulated
        # re-probe window, the priority RPC is back and succeeds.
        priority_chain.execute.side_effect = [
            APIError({"message": "does not exist", "code": "42883"}),
            MagicMock(data=[]),
        ]
        legacy_chain = MagicMock()
        legacy_chain.execute.return_value = MagicMock(data=[])

        def _rpc_side_effect(name: str, params: dict):
            if name == "claim_compute_jobs_with_priority":
                return priority_chain
            return legacy_chain

        mock_supabase.rpc.side_effect = _rpc_side_effect

        with patch("main_worker.get_supabase", return_value=mock_supabase), \
             patch("main_worker.dispatch", new=AsyncMock()):
            # Tick 1 at t=1000: structured 42883 → latch.
            with patch("main_worker.time.monotonic", return_value=1000.0):
                await dispatch_tick("worker-reprobe")
            assert main_worker._FALLBACK_CLAIM_RPC is True, (
                "a structured 42883 must latch the fallback"
            )

            # Tick 2 still within the re-probe window → stays on legacy, does
            # NOT touch the priority RPC.
            mock_supabase.rpc.reset_mock()
            with patch(
                "main_worker.time.monotonic",
                return_value=1000.0 + main_worker._FALLBACK_REPROBE_INTERVAL_S - 1.0,
            ):
                await dispatch_tick("worker-reprobe")
            within = [c.args[0] for c in mock_supabase.rpc.call_args_list]
            assert "claim_compute_jobs_with_priority" not in within, (
                "within the re-probe window the latch must skip the priority "
                f"RPC; got {within}"
            )

            # Tick 3 AFTER the re-probe window → must re-attempt the priority
            # RPC and clear the latch (self-heal).
            mock_supabase.rpc.reset_mock()
            with patch(
                "main_worker.time.monotonic",
                return_value=1000.0 + main_worker._FALLBACK_REPROBE_INTERVAL_S + 1.0,
            ):
                await dispatch_tick("worker-reprobe")

        after = [c.args[0] for c in mock_supabase.rpc.call_args_list]
        assert "claim_compute_jobs_with_priority" in after, (
            "after the re-probe window elapses, the latch must self-heal and "
            f"re-attempt the priority RPC; got {after}"
        )
        assert main_worker._FALLBACK_CLAIM_RPC is False, (
            "a successful re-probe must clear the latch"
        )


# ---------------------------------------------------------------------------
# Claimed-row contract (audit-2026-05-07 H-0529)
# ---------------------------------------------------------------------------
# The claim RPCs RETURN SETOF compute_jobs, so each claimed row is a full
# compute_jobs record. dispatch_tick dereferences `job["id"]` unconditionally
# when building the mark_done / mark_failed closures and reads
# `job.get("claim_token")` for the P97 fence. Before H-0529 the claim path was
# typed `Any`, so a column rename in a future migration (e.g. RETURNS shape
# `id` -> `job_id`) would surface as a runtime KeyError on the hot path rather
# than a type error. `ClaimedJob` pins that contract. These tests encode the
# intent: the keys the worker dereferences unconditionally MUST be required,
# and the optional/defensive ones MUST be declared so the row shape stays a
# single source of truth alongside the consumer.
# ---------------------------------------------------------------------------


class TestClaimedJobContract:
    def test_id_is_required(self) -> None:
        """`id` is dereferenced unconditionally (`j["id"]`, `job["id"]` in the
        mark closures), so it MUST be a required key on ClaimedJob. If a future
        edit demotes it to optional (or renames it), the worker's
        `job["id"]` KeyError risk returns silently — this assertion is the
        type-contract guard the finding asks for."""
        from main_worker import ClaimedJob

        assert "id" in ClaimedJob.__required_keys__, (
            "ClaimedJob.id must be required — dispatch_tick indexes job['id'] "
            "unconditionally when building mark_* RPC closures"
        )

    def test_fence_and_dispatch_keys_are_declared(self) -> None:
        """`claim_token` (P97 fence, read via .get()) and `kind` (forwarded to
        dispatch()) must be part of the declared contract so the row shape
        documents every field the worker / dispatch consumer touches."""
        from main_worker import ClaimedJob

        declared = ClaimedJob.__required_keys__ | ClaimedJob.__optional_keys__
        for key in ("claim_token", "kind", "strategy_id", "portfolio_id"):
            assert key in declared, (
                f"ClaimedJob must declare {key!r}: the worker or dispatch() "
                f"reads it. Declared keys: {sorted(declared)}"
            )

    @pytest.mark.asyncio
    async def test_claimed_row_drives_id_and_claim_token_through_marks(self) -> None:
        """A row shaped per ClaimedJob flows through dispatch_tick: `id` lands
        in the mark_done RPC and `claim_token` is threaded through as
        p_claim_token (the P97 fence). This pins that the worker reads the
        ClaimedJob fields by their contracted names."""
        job = {
            "id": "cj-contract-1",
            "kind": "compute_analytics_from_csv",
            "strategy_id": "strat-contract",
            "claim_token": "tok-contract-xyz",
        }
        mock_supabase = MagicMock()
        claim_chain = MagicMock()
        claim_chain.execute.return_value = MagicMock(data=[job])
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
             ):
            await dispatch_tick("worker-contract")

        mark_done_calls = [
            c for c in mock_supabase.rpc.call_args_list
            if c.args[0] == "mark_compute_job_done"
        ]
        assert len(mark_done_calls) == 1
        params = mark_done_calls[0].args[1]
        assert params["p_job_id"] == "cj-contract-1"
        assert params["p_claim_token"] == "tok-contract-xyz"

    @pytest.mark.asyncio
    async def test_c_pr5_02_no_null_claim_token_on_mark_done_for_fenced_jobs(
        self,
    ) -> None:
        """C-PR5-02 (audit-2026-05-07): for any claimed job that came with a
        non-NULL claim_token (i.e. every production claim through migration
        117), the mark_compute_job_done RPC MUST be called with
        ``p_claim_token != None``. A regression that passed NULL would
        silently bypass the P97 fence — exactly the production-critical
        gap the audit flagged. Pins the contract so a future refactor
        that drops ``claim_token=claim_token`` from the closure fails this
        test immediately rather than at the next watchdog reclaim.
        """
        job = {
            "id": "cj-c-pr5-02",
            "kind": "compute_analytics_from_csv",
            "strategy_id": "strat-c-pr5-02",
            "claim_token": "tok-must-thread",
        }
        mock_supabase = MagicMock()
        claim_chain = MagicMock()
        claim_chain.execute.return_value = MagicMock(data=[job])
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
             ):
            await dispatch_tick("worker-c-pr5-02")

        # The contract: EVERY mark RPC call (done or failed) carries a
        # non-NULL p_claim_token. If a future refactor drops the
        # threading, this assertion fails before the change ships.
        for c in mock_supabase.rpc.call_args_list:
            if c.args[0] in ("mark_compute_job_done", "mark_compute_job_failed"):
                assert c.args[1].get("p_claim_token") is not None, (
                    f"{c.args[0]} called with NULL p_claim_token — would silently "
                    "bypass the P97 fence (C-PR5-02)"
                )


# ---------------------------------------------------------------------------
# redteam-2026-05 W1 (LOW9) — daily-enqueue startup gate
# ---------------------------------------------------------------------------
# `daily_enqueue_loop` previously ran the FULL enqueue on EVERY worker startup.
# Railway redeploys/crashes within one day therefore triggered multiple full
# enqueue passes. The per-strategy partial-unique dedup only absorbs duplicates
# while the prior batch is still IN-FLIGHT (status pending/running/
# done_pending_children — migration 20260411144407); once those jobs complete,
# a same-day re-seed inserts FRESH duplicate poll_positions jobs → queue
# inflation. The startup tick is now gated on `_daily_enqueue_already_ran_today`
# so a restart within the same UTC day does NOT re-seed; the genuine 24h
# periodic tick is unaffected.
# ---------------------------------------------------------------------------


class TestDailyEnqueueStartupGate:
    @staticmethod
    def _supabase_with_latest(created_at):
        """Build a mock supabase whose poll_positions/daily_loop query returns
        a single row with the given created_at (or [] when None)."""
        mock_supabase = MagicMock()
        chain = MagicMock()
        # The gate builds: table().select().eq().eq().order().limit().execute()
        chain.select.return_value = chain
        chain.eq.return_value = chain
        chain.order.return_value = chain
        chain.limit.return_value = chain
        rows = [] if created_at is None else [{"created_at": created_at}]
        chain.execute.return_value = MagicMock(data=rows)
        mock_supabase.table.return_value = chain
        return mock_supabase

    @pytest.mark.asyncio
    async def test_gate_true_when_already_enqueued_today(self) -> None:
        """If the most-recent daily_loop poll_positions job was created earlier
        today (UTC), the gate returns True → startup enqueue must be skipped."""
        from datetime import datetime, timezone

        from main_worker import _daily_enqueue_already_ran_today

        today_iso = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
        mock_supabase = self._supabase_with_latest(today_iso)
        with patch("main_worker.get_supabase", return_value=mock_supabase):
            assert await _daily_enqueue_already_ran_today() is True

    @pytest.mark.asyncio
    async def test_gate_false_when_last_enqueue_was_yesterday(self) -> None:
        """A prior-day enqueue must NOT suppress today's startup seed."""
        from datetime import datetime, timedelta, timezone

        from main_worker import _daily_enqueue_already_ran_today

        yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).replace(
            microsecond=0
        ).isoformat()
        mock_supabase = self._supabase_with_latest(yesterday)
        with patch("main_worker.get_supabase", return_value=mock_supabase):
            assert await _daily_enqueue_already_ran_today() is False

    @pytest.mark.asyncio
    async def test_gate_false_when_no_prior_enqueue(self) -> None:
        """No daily_loop poll_positions job yet → gate must allow the seed."""
        from main_worker import _daily_enqueue_already_ran_today

        mock_supabase = self._supabase_with_latest(None)
        with patch("main_worker.get_supabase", return_value=mock_supabase):
            assert await _daily_enqueue_already_ran_today() is False

    @pytest.mark.asyncio
    async def test_gate_fail_safe_on_error(self) -> None:
        """Any error in the gate query (env unset, DB down) must FAIL SAFE to
        False so the legitimate daily seed still fires — skipping it would be
        the worse failure."""
        from main_worker import _daily_enqueue_already_ran_today

        with patch(
            "main_worker.get_supabase",
            side_effect=RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY required"),
        ):
            assert await _daily_enqueue_already_ran_today() is False

    @pytest.mark.asyncio
    async def test_startup_tick_skipped_when_gate_true(self) -> None:
        """The whole point (LOW9): a restart within the same day must NOT run a
        second full enqueue pass. With the gate True, daily_enqueue_loop's
        startup tick must NOT call daily_enqueue_tick."""
        import main_worker

        original = main_worker.SHUTDOWN
        main_worker.SHUTDOWN = asyncio.Event()
        main_worker.SHUTDOWN.set()  # exit the loop after the (skipped) startup
        try:
            tick_calls = 0

            async def _counting_tick() -> None:
                nonlocal tick_calls
                tick_calls += 1

            with patch("main_worker.daily_enqueue_tick", new=_counting_tick), \
                 patch(
                     "main_worker._daily_enqueue_already_ran_today",
                     new=AsyncMock(return_value=True),
                 ):
                loop_task = asyncio.create_task(
                    main_worker.daily_enqueue_loop(interval=3600.0)
                )
                done, pending = await asyncio.wait({loop_task}, timeout=2.0)
                for p in pending:
                    p.cancel()

            assert loop_task.done()
            assert tick_calls == 0, (
                "startup enqueue must be SKIPPED when the daily enqueue already "
                f"ran today; daily_enqueue_tick was called {tick_calls} times"
            )
        finally:
            main_worker.SHUTDOWN = original

    @pytest.mark.asyncio
    async def test_startup_tick_runs_when_gate_false(self) -> None:
        """Conversely, a fresh day (gate False) must still run the startup
        seed exactly once — the gate must not suppress legitimate seeding."""
        import main_worker

        original = main_worker.SHUTDOWN
        main_worker.SHUTDOWN = asyncio.Event()
        main_worker.SHUTDOWN.set()
        try:
            tick_calls = 0

            async def _counting_tick() -> None:
                nonlocal tick_calls
                tick_calls += 1

            with patch("main_worker.daily_enqueue_tick", new=_counting_tick), \
                 patch(
                     "main_worker._daily_enqueue_already_ran_today",
                     new=AsyncMock(return_value=False),
                 ):
                loop_task = asyncio.create_task(
                    main_worker.daily_enqueue_loop(interval=3600.0)
                )
                done, pending = await asyncio.wait({loop_task}, timeout=2.0)
                for p in pending:
                    p.cancel()

            assert loop_task.done()
            assert tick_calls == 1, (
                f"startup enqueue must run once on a fresh day; got {tick_calls}"
            )
        finally:
            main_worker.SHUTDOWN = original
