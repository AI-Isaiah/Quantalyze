"""Standalone worker entry point for the durable compute_jobs queue.

Runs 3 interleaved asyncio loops on Railway (CMD override: python -m main_worker):

  1. **Dispatch loop** (every 30s) — claims pending jobs via
     claim_compute_jobs_with_priority(batch=5, worker_id) and dispatches
     to per-kind handlers in services.job_worker. Results
     (DONE/FAILED/DEFERRED) are routed back to the corresponding mark_*
     RPC. The priority-aware RPC (migration 086) prefers normal/high
     priority jobs and throttles low-priority backfill when live work is
     queued — see Phase 12 / METRICS-14.

  2. **Watchdog loop** (every 60s) — calls reset_stalled_compute_jobs with
     per-kind thresholds so long-running compute_analytics (20 min ceiling)
     coexists with faster sync_trades (10 min) without the watchdog
     prematurely reclaiming slow-but-healthy jobs.

  3. **Daily enqueue loop** (every 24h) — calls
     enqueue_poll_positions_for_all_strategies RPC once per day to seed
     position-polling jobs. Runs on startup and then every 86400s.

Each loop's body is factored into a testable `*_tick()` function. The
infinite loops wrap each tick in try-except so a single exception does
not crash the entire worker process.

CRITICAL: do NOT run a 0-minute reset on startup. A 0-minute threshold
would requeue jobs legitimately running on other replicas. The threshold-
based watchdog loop handles stuck rows after their per-kind timeout.

WORKER_ID identifies this replica: worker-{hostname}-{pid}.
"""
from __future__ import annotations

import asyncio
import logging
import os
import signal
import socket
import time

from dotenv import load_dotenv

# Load analytics-service/.env for local dev. In prod (Railway), env vars are
# injected directly and no .env file exists, so load_dotenv() is a no-op.
load_dotenv()

from services.db import db_execute, get_supabase
from services.encryption import validate_kek_on_startup
from services.job_worker import DispatchOutcome, dispatch

logger = logging.getLogger("quantalyze.analytics.worker")

# ---------------------------------------------------------------------------
# Worker identity
# ---------------------------------------------------------------------------
WORKER_ID = f"worker-{socket.gethostname()}-{os.getpid()}"

# ---------------------------------------------------------------------------
# Shutdown event — set by SIGTERM/SIGINT handler; all loops check this.
# Module-level is safe here: Railway runs one worker process per container,
# and asyncio.Event is bound to the running loop on first await. If this
# ever moves to multi-process, SHUTDOWN must be created inside main().
# ---------------------------------------------------------------------------
SHUTDOWN = asyncio.Event()

# ---------------------------------------------------------------------------
# Watchdog per-kind override map
# ---------------------------------------------------------------------------
# Matches the timeouts in services.job_worker.TIMEOUT_PER_KIND but with
# headroom. The watchdog threshold must be GREATER than the handler timeout
# so the handler has a chance to timeout-classify itself before the
# watchdog yanks the row. Example: compute_analytics handler timeout is
# 15 min, watchdog threshold is 20 min.
# Each value MUST be greater than services.job_worker.TIMEOUT_PER_KIND[kind].
# A watchdog threshold below the handler timeout requeues the job before the
# handler can fail-classify itself, leaving callers (the wizard polls
# strategy_analytics.computation_status for terminal state) to spin forever
# while the row bounces between pending and running. The
# `test_watchdog_threshold_exceeds_handler_timeout` test in
# tests/test_main_worker.py pins this invariant.
# IMPORTANT: every kind in services.job_worker.TIMEOUT_PER_KIND whose
# handler timeout EXCEEDS the global watchdog default (10 minutes —
# `watchdog_tick.p_stale_threshold` below) MUST have an entry here, or
# the watchdog will reclaim still-running jobs and re-create the
# wizard-hang condition this map was added to fix.
# `tests/test_main_worker.py::TestWatchdogInvariant::test_every_kind_has_watchdog_headroom`
# iterates TIMEOUT_PER_KIND (the source of truth) — adding a new long
# handler without an override fails CI.
WATCHDOG_PER_KIND_OVERRIDES: dict[str, str] = {
    "sync_trades": "20 minutes",       # handler timeout = 15 minutes
    "compute_analytics": "20 minutes", # handler timeout = 15 minutes
    "poll_positions": "5 minutes",     # handler timeout = 3 minutes
    "compute_portfolio": "15 minutes", # handler timeout = 10 minutes
    # Equity-history backfill is the longest-running kind in the system —
    # without this override, the global 10-minute default reclaims the
    # job 20+ minutes before the handler can fail-classify itself,
    # reproducing the wizard-hang failure mode for allocator equity
    # reconstruction. Caught by /review cross-PR audit, 2026-04-30.
    "reconstruct_allocator_history": "35 minutes",  # handler timeout = 30 minutes
}


# ---------------------------------------------------------------------------
# Tick functions (testable)
# ---------------------------------------------------------------------------

async def dispatch_tick(worker_id: str) -> None:
    """Claim up to 5 jobs and dispatch each one.

    For each claimed row:
      - DONE      → call mark_compute_job_done
      - FAILED    → call mark_compute_job_failed with error + kind
      - DEFERRED  → no mark call (handler already called defer_compute_job)
    """
    supabase = get_supabase()

    # Phase 12 / METRICS-14 / D-06: priority-aware claim with backfill
    # throttle. Migration 086's claim_compute_jobs_with_priority RPC
    # atomically prefers normal/high jobs and excludes priority='low' rows
    # this tick whenever any normal/high pending row exists. The 5-jobs-
    # per-tick × ~12 ticks/min × low-deferral combination delivers D-06's
    # 5 backfill jobs/min cap without any Python-side rate limiter — the
    # throttle lives in the SQL claim path (per 12-RESEARCH.md §5d
    # correction: by the time dispatch() runs, the row is already claimed).
    # Same atomic concurrency primitive (FOR UPDATE SKIP LOCKED) as the
    # legacy claim_compute_jobs (migration 032), so two replicas claiming
    # in parallel still get disjoint result sets.
    def _claim():
        return supabase.rpc(
            "claim_compute_jobs_with_priority",
            {"p_batch_size": 5, "p_worker_id": worker_id},
        ).execute()

    claim_result = await db_execute(_claim)
    jobs = claim_result.data or []

    # Update healthz timestamp as soon as the claim RPC succeeds — an idle
    # queue means the worker is healthy, not stale. The previous early-return
    # path (before this line) made healthz report "stale" whenever there was
    # nothing to do, defeating the liveness check.
    import main_worker_healthz

    main_worker_healthz.LAST_TICK_AT = time.time()

    if not jobs:
        return

    logger.info("Claimed %d jobs: %s", len(jobs), [j["id"] for j in jobs])

    for job in jobs:
        try:
            result = await dispatch(job)

            if result.outcome == DispatchOutcome.DONE:
                def _mark_done(jid=job["id"]):
                    supabase.rpc(
                        "mark_compute_job_done", {"p_job_id": jid}
                    ).execute()

                await db_execute(_mark_done)
                logger.info("Job %s done (trade_count=%s)", job["id"], result.trade_count)

            elif result.outcome == DispatchOutcome.FAILED:
                def _mark_failed(
                    jid=job["id"],
                    err=result.error_message,
                    kind=result.error_kind,
                ):
                    supabase.rpc(
                        "mark_compute_job_failed",
                        {
                            "p_job_id": jid,
                            "p_error": err or "Unknown error",
                            "p_error_kind": kind or "unknown",
                        },
                    ).execute()

                await db_execute(_mark_failed)
                logger.warning(
                    "Job %s failed (%s): %s",
                    job["id"],
                    result.error_kind,
                    result.error_message,
                )

            elif result.outcome == DispatchOutcome.DEFERRED:
                logger.info("Job %s deferred (handler already called defer_compute_job)", job["id"])

        except Exception as exc:  # noqa: BLE001
            # dispatch() itself crashed — this should not normally happen
            # because dispatch has its own try-except. Defense in depth.
            logger.error(
                "dispatch_tick: unhandled error for job %s: %s",
                job.get("id"),
                exc,
                exc_info=True,
            )
            try:
                def _mark_failed_fallback(
                    jid=job["id"], err=str(exc)[:500]
                ):
                    supabase.rpc(
                        "mark_compute_job_failed",
                        {
                            "p_job_id": jid,
                            "p_error": err,
                            "p_error_kind": "unknown",
                        },
                    ).execute()

                await db_execute(_mark_failed_fallback)
            except Exception as mark_exc:  # noqa: BLE001
                logger.error(
                    "dispatch_tick: could not mark job %s failed: %s",
                    job.get("id"),
                    mark_exc,
                )


async def watchdog_tick() -> None:
    """Call reset_stalled_compute_jobs with per-kind thresholds."""
    supabase = get_supabase()

    # Pass the overrides dict directly; PostgREST coerces a JSON object to
    # JSONB. json.dumps() would send a JSON string, which becomes a JSONB
    # scalar and trips jsonb_object_keys() with "cannot call ... on a scalar".
    def _reset():
        return supabase.rpc(
            "reset_stalled_compute_jobs",
            {
                "p_stale_threshold": "10 minutes",
                "p_per_kind_overrides": WATCHDOG_PER_KIND_OVERRIDES,
            },
        ).execute()

    result = await db_execute(_reset)
    reset_count = result.data or 0
    if reset_count:
        logger.warning("Watchdog reclaimed %d stalled jobs", reset_count)


async def daily_enqueue_tick() -> None:
    """Call enqueue_poll_positions_for_all_strategies and log the count."""
    supabase = get_supabase()

    def _enqueue():
        return supabase.rpc(
            "enqueue_poll_positions_for_all_strategies", {}
        ).execute()

    result = await db_execute(_enqueue)
    count = result.data or 0
    logger.info("Daily enqueue: %d poll_positions jobs created", count)


# ---------------------------------------------------------------------------
# Infinite loop wrappers
# ---------------------------------------------------------------------------

async def dispatch_loop(worker_id: str, interval: float = 30.0) -> None:
    """Dispatch loop: claims + dispatches every `interval` seconds."""
    while not SHUTDOWN.is_set():
        try:
            await dispatch_tick(worker_id)
        except Exception as exc:  # noqa: BLE001
            logger.error("dispatch_loop tick failed: %s", exc, exc_info=True)

        # Wait for interval OR shutdown, whichever comes first
        try:
            await asyncio.wait_for(SHUTDOWN.wait(), timeout=interval)
            break  # SHUTDOWN was set
        except asyncio.TimeoutError:
            pass  # interval elapsed, loop again

    logger.info("dispatch_loop exiting (shutdown)")


async def watchdog_loop(interval: float = 60.0) -> None:
    """Watchdog loop: reclaims stalled jobs every `interval` seconds."""
    while not SHUTDOWN.is_set():
        try:
            await watchdog_tick()
        except Exception as exc:  # noqa: BLE001
            logger.error("watchdog_loop tick failed: %s", exc, exc_info=True)

        try:
            await asyncio.wait_for(SHUTDOWN.wait(), timeout=interval)
            break
        except asyncio.TimeoutError:
            pass

    logger.info("watchdog_loop exiting (shutdown)")


async def daily_enqueue_loop(interval: float = 86400.0) -> None:
    """Daily enqueue loop: once per day, seed poll_positions jobs."""
    # Run immediately on startup, then every interval
    try:
        await daily_enqueue_tick()
    except Exception as exc:  # noqa: BLE001
        logger.error("daily_enqueue initial tick failed: %s", exc, exc_info=True)

    while not SHUTDOWN.is_set():
        try:
            await asyncio.wait_for(SHUTDOWN.wait(), timeout=interval)
            break  # SHUTDOWN was set
        except asyncio.TimeoutError:
            pass  # interval elapsed, tick again

        try:
            await daily_enqueue_tick()
        except Exception as exc:  # noqa: BLE001
            logger.error("daily_enqueue_loop tick failed: %s", exc, exc_info=True)

    logger.info("daily_enqueue_loop exiting (shutdown)")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def main() -> None:
    """Entry point. Validates KEK, sets signal handlers, runs all loops."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )

    logger.info("Worker starting as %s", WORKER_ID)

    # Fail fast if KEK is bad — worker cannot process any jobs without it
    validate_kek_on_startup()
    logger.info("KEK validation passed")

    # Signal handlers for graceful shutdown — use loop.add_signal_handler
    # (the correct asyncio pattern) instead of signal.signal, which can
    # interact poorly with the event loop's signal wakeup fd.
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, SHUTDOWN.set)

    # Import healthz server
    from main_worker_healthz import start_healthz_server

    # Run all loops + healthz concurrently. sync_funding /
    # reconcile_strategies / cleanup_ack_tokens were temporarily co-located
    # here while Quantalyze was on the Vercel Hobby plan (2-cron cap); on
    # Pro they live in vercel.json again and the routes that handle them
    # (src/app/api/cron/...) thread correlation_id into compute_jobs.metadata.
    await asyncio.gather(
        dispatch_loop(WORKER_ID),
        watchdog_loop(),
        daily_enqueue_loop(),
        start_healthz_server(),
    )

    logger.info("Worker shut down cleanly")


if __name__ == "__main__":
    asyncio.run(main())
