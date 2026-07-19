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
     per-kind thresholds so long-running sync_trades (30 min ceiling)
     coexists with faster kinds without the watchdog prematurely
     reclaiming slow-but-healthy jobs.

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
from types import SimpleNamespace
from typing import Any, Final, TypedDict, cast

from dotenv import load_dotenv

# Load analytics-service/.env for local dev. In prod (Railway), env vars are
# injected directly and no .env file exists, so load_dotenv() is a no-op.
load_dotenv()

from services.db import db_execute, get_supabase
from services.encryption import validate_kek_on_startup
from services.job_worker import DispatchOutcome, JobStatus, Priority, dispatch

logger = logging.getLogger("quantalyze.analytics.worker")


# ---------------------------------------------------------------------------
# Claimed compute_jobs row shape (audit-2026-05-07 H-0529)
# ---------------------------------------------------------------------------
# The claim RPCs (`claim_compute_jobs_with_priority` / legacy
# `claim_compute_jobs`) both `RETURNS SETOF compute_jobs`, so each claimed row
# is a full compute_jobs table row (migration
# 20260411144407_compute_jobs_queue.sql + the claim_token column added by
# 20260515114555_compute_jobs_claim_token_fencing.sql). `claim_result.data`
# from PostgREST is otherwise typed `Any`, so the worker indexed rows as
# `j["id"]` / `job["id"]` / `job.get("claim_token")` with no static guard: a
# column rename in a future migration (e.g. `id` → `job_id` on the RETURNS
# shape) would surface as a runtime KeyError on the hot dispatch path rather
# than a type-check failure. `ClaimedJob` pins the row contract the worker
# relies on so the claim path is typed symmetrically with the
# `dispatch(job)` consumer in services.job_worker.
#
# `id` is the only field the worker dereferences unconditionally (`j["id"]`,
# `job["id"]` in the mark closures); everything else is read defensively via
# `.get()` or consumed inside `dispatch()`, so they are declared on a
# `total=False` block. `kind` is `str` (the DB column is
# `TEXT REFERENCES compute_job_kinds(name)` — there is no Python Literal mirror;
# `dispatch()` already branches on `job.get("kind")` and falls through to a
# FAILED outcome for an unknown kind).
class _ClaimedJobOptional(TypedDict, total=False):
    strategy_id: str | None
    portfolio_id: str | None
    kind: str
    status: JobStatus
    priority: Priority
    claim_token: str | None
    metadata: dict[str, Any] | None
    exchange: str | None


class ClaimedJob(_ClaimedJobOptional):
    # `id` is required: the worker indexes `job["id"]` unconditionally when
    # building the mark_done / mark_failed RPC closures. A claim row without it
    # is a contract violation, not a tolerable partial row.
    id: str

# ---------------------------------------------------------------------------
# Worker identity
# ---------------------------------------------------------------------------
WORKER_ID = f"worker-{socket.gethostname()}-{os.getpid()}"

# ---------------------------------------------------------------------------
# FLIPRETRY-02: role-aware claim scope (Phase 123)
# ---------------------------------------------------------------------------
# The v1.11 derived-allocator-curve backfill wedged the SEQUENTIAL prod worker:
# one slow/uncancellable live-exchange crawl blocked the shared loop, healthz
# went stale ~12min, and the 90s auto-restart never fired. Per-crawl wait_for
# alone cannot keep the shared loop's healthz fresh — the only structural
# guarantee is ISOLATION. A DEDICATED backfill worker claims ONLY the backfill
# kinds; the interactive prod worker EXCLUDES them.
#
# BACKFILL_KINDS: the derive chain that must leave the prod loop together. The
# cron fans out derive_broker_dailies, which follow-on-enqueues
# derive_allocator_equity (123-CONTEXT SCOPE CORRECTION) — isolating both
# isolates the whole chain. NOTE: role "interactive" also moves NEW-key
# broker-dailies ingestion (deribit/sfox key connects) onto the dedicated
# worker — INTENDED (those are exactly the long-crawl jobs), and the plan-03
# runbook makes the dedicated worker prod-critical from cutover. The sFOX-F5
# active-account crawl rides this worker for free (same derive_broker_dailies
# kind) — nothing sFOX-specific is built here.
BACKFILL_KINDS: Final[tuple[str, ...]] = (
    "derive_broker_dailies",
    "derive_allocator_equity",
)
_VALID_CLAIM_ROLES: Final[tuple[str, ...]] = ("all", "interactive", "backfill")


def _validate_claim_role(role: str) -> str:
    """Validate WORKER_CLAIM_ROLE; raise a LOUD ValueError on any other value
    (no silent default — a misconfigured role changes claim scope)."""
    if role not in _VALID_CLAIM_ROLES:
        raise ValueError(
            f"WORKER_CLAIM_ROLE={role!r} is invalid; must be one of "
            f"{_VALID_CLAIM_ROLES}"
        )
    return role


# Read ONCE at import/startup. Default "all" is the byte-identical merge-safe
# choice: merging this plan changes NO prod behavior until the founder cuts
# over BOTH workers in the plan-03 runbook — the same structural-gate
# discipline as SFOX_ENABLED (Phase 122).
WORKER_CLAIM_ROLE: str = _validate_claim_role(os.getenv("WORKER_CLAIM_ROLE", "all"))


def _claim_kind_args(role: str) -> dict[str, list[str]]:
    """Role → the p_kind_* keys to ADD to the claim RPC payload.

    role "all" returns {} so the payload stays BYTE-IDENTICAL to prod today
    (the RPC's NULL defaults preserve behavior). "interactive" excludes the
    backfill kinds; "backfill" includes only them."""
    if role == "interactive":
        return {"p_kind_exclude": list(BACKFILL_KINDS)}
    if role == "backfill":
        return {"p_kind_include": list(BACKFILL_KINDS)}
    return {}

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
# watchdog yanks the row. Example: compute_portfolio handler timeout is
# 10 min, watchdog threshold is 15 min.
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
    # audit-2026-05-07 P97 / G12.A.2 (mig 117): bumped sync_trades 20→30
    # min so OKX backfills (legitimately 12+ min) don't routinely trip
    # the watchdog and trigger the Race A 2-worker overlap that the
    # claim-token fence detects but doesn't prevent. INVEST-P97
    # §Recommendation pairs the fence with this override:
    # `.planning/audit-2026-05-07/INVEST-P97.md`.
    "sync_trades": "30 minutes",       # handler timeout = 15 minutes (mig 117)
    # Phase 19.1 — handler timeout = 10 minutes; watchdog must be
    # strictly greater (the test_every_kind_has_watchdog_headroom
    # invariant enforces). Mirrors compute_portfolio.
    "compute_analytics_from_csv": "15 minutes",
    "poll_positions": "5 minutes",     # handler timeout = 3 minutes
    "compute_portfolio": "15 minutes", # handler timeout = 10 minutes
    # Equity-history backfill is the longest-running kind in the system —
    # without this override, the global 10-minute default reclaims the
    # job 20+ minutes before the handler can fail-classify itself,
    # reproducing the wizard-hang failure mode for allocator equity
    # reconstruction. Caught by /review cross-PR audit, 2026-04-30.
    "reconstruct_allocator_history": "35 minutes",  # handler timeout = 30 minutes
    # Phase 19 / BACKBONE-09 / MC-6 — process_key_long handler timeout is
    # 30 minutes (90-day OKX archive backfill). Watchdog threshold is set
    # to 40 minutes (≥ handler timeout + 30% slack = 39 minutes minimum).
    # Without this override, the global 10-minute default reclaims slow
    # legitimate backfills mid-run and produces duplicate state-machine
    # transitions through transition_strategy_verification.
    "process_key_long": "40 minutes",  # handler timeout = 30 minutes
    # Broker key full-history → dailies → CSV route. Handler timeout = 15
    # minutes (full-history realized PnL + funding fetch); watchdog must be
    # strictly greater. Mirrors the sync_trades 15→30 pairing.
    "derive_broker_dailies": "30 minutes",  # handler timeout = 15 minutes
    # Phase 86 (COMP-02) — the composite fans out over N member keys and, when
    # MTM is admissible, crawls each Deribit member TWICE (cash + mark_to_market),
    # so its handler timeout is 20 minutes. Watchdog must be strictly greater;
    # 30 minutes mirrors the derive/sync_trades 15→30 headroom pairing.
    "stitch_composite": "30 minutes",  # handler timeout = 20 minutes
}


# ---------------------------------------------------------------------------
# Late-mark detection (audit-2026-05-07 P97 / G12.A.2 — claim-token fence)
# ---------------------------------------------------------------------------
# Migration 117 raises `serialization_failure` (PostgreSQL SQLSTATE 40001)
# from mark_compute_job_done / mark_compute_job_failed when the caller's
# p_claim_token doesn't match the row's current claim_token. This means
# the watchdog reclaimed the row and a second worker has taken over —
# the late mark is expected behavior, not a failure. Detect by:
#   (a) sniffing the PostgREST APIError `.code` attribute for the
#       SQLSTATE '40001', OR
#   (b) for transports that don't surface .code cleanly, checking for our
#       specific RAISE message literal 'preempted by watchdog reclaim'
#       (set in migration 117 STEP 4 + STEP 5).
#
# PR #149 review I4 (maintainability conf 8 + security conf 6): the
# previous version also matched the bare strings '40001' and
# 'serialization_failure' anywhere in the message. That collides with
# any OTHER source of a serialization conflict (manual SERIALIZABLE
# isolation, advisory-lock contention surfacing as 40001, third-party
# library messages embedding '40001' for unrelated reasons). Tighten to:
# either .code == '40001' OR our specific message literal. This makes
# the detection P97-specific and prevents silent swallowing of unrelated
# 40001s.
_PREEMPTED_MESSAGE_LITERAL = "preempted by watchdog reclaim"


def _is_serialization_failure(exc: BaseException) -> bool:
    code = getattr(exc, "code", None)
    if code == "40001":
        return True
    msg = str(exc) if exc is not None else ""
    return _PREEMPTED_MESSAGE_LITERAL in msg


# ---------------------------------------------------------------------------
# Missing-RPC fallback (audit-2026-05-07 C-0190)
# ---------------------------------------------------------------------------
# PostgreSQL SQLSTATE 42883 = `undefined_function`. PostgREST surfaces it on
# `APIError.code` when the named RPC does not exist (e.g. the
# `claim_compute_jobs_with_priority` migration 086 has not been applied to
# this Supabase project yet). Without an explicit fallback, the worker boots,
# the dispatch loop fires every 30s, and every tick logs an opaque error
# while zero jobs are claimed — a silent total-stall failure mode.
#
# We catch 42883 specifically and fall back to the legacy
# `claim_compute_jobs(p_batch_size, p_worker_id)` RPC (the pre-086 signature).
# Once a fallback succeeds we latch the choice in `_FALLBACK_CLAIM_RPC` so
# subsequent ticks skip the missing-RPC probe — but only for a bounded
# window (see the TTL re-probe below), not for the process lifetime.
_SQLSTATE_UNDEFINED_FUNCTION = "42883"
_FALLBACK_CLAIM_RPC: bool = False

# redteam-2026-05 W1 (MED8): the latch must NOT be permanent. A 42883
# ("does not exist") is raised TRANSIENTLY by PostgreSQL while a migration is
# mid-`CREATE OR REPLACE` (functions drop-recreate, and migrations auto-apply
# on merge in this project). A single transient hit previously demoted the
# worker to the legacy 2-arg claim for the entire process lifetime — silently
# disabling priority-aware claiming + the backfill throttle until the next
# restart, with only a one-time WARNING. Two changes fix this:
#   1. The LATCH decision now requires the STRUCTURED SQLSTATE `code == 42883`
#      (`_is_undefined_function_structured`). The loose message-substring path
#      in `_is_undefined_function` is kept ONLY for the one-shot per-tick
#      fallback (a best-effort attempt to still claim something this tick), but
#      a message-only match no longer latches the worker into legacy mode.
#   2. The latch self-heals: it carries a timestamp and is re-probed every
#      `_FALLBACK_REPROBE_INTERVAL_S`. After the window elapses, the next tick
#      re-attempts the priority RPC; if the function genuinely doesn't exist
#      (migration not applied) it simply 42883s again and re-latches, so the
#      log noise stays bounded. While latched we re-emit the WARNING so the
#      degradation stays VISIBLE in logs rather than going silent after the
#      first line.
_FALLBACK_REPROBE_INTERVAL_S: float = 300.0  # re-probe the priority RPC every 5 min
_FALLBACK_LATCHED_AT: float = 0.0


def _is_undefined_function(exc: BaseException) -> bool:
    """Return True iff `exc` looks like a PostgREST APIError signaling SQLSTATE
    42883 (function does not exist). Matches the STRUCTURED SQLSTATE on `.code`
    / `.details["code"]` OR — defensively, for postgrest versions that surface
    the SQLSTATE only in the message string — the canonical phrase 'does not
    exist' alongside the RPC name.

    Used for the per-tick fallback DECISION (try the legacy RPC this tick). The
    permanent LATCH uses the stricter `_is_undefined_function_structured` so a
    transient message-only error can never demote the worker for the process
    lifetime (redteam-2026-05 W1)."""
    if _is_undefined_function_structured(exc):
        return True
    # Defensive: some PostgREST versions stash the SQLSTATE only inside the
    # message string. Match on the canonical PostgreSQL phrase.
    msg = str(exc) if exc is not None else ""
    if "claim_compute_jobs_with_priority" in msg and "does not exist" in msg:
        return True
    return False


def _is_undefined_function_structured(exc: BaseException) -> bool:
    """Return True iff `exc` carries the STRUCTURED SQLSTATE 42883 on `.code`
    or `.details["code"]`. This is the predicate that gates the fallback LATCH
    (redteam-2026-05 W1): a loose message-substring match must never latch the
    worker permanently, because a mid-`CREATE OR REPLACE` migration raises a
    transient 42883."""
    code = getattr(exc, "code", None)
    if code == _SQLSTATE_UNDEFINED_FUNCTION:
        return True
    details = getattr(exc, "details", None)
    if isinstance(details, dict) and details.get("code") == _SQLSTATE_UNDEFINED_FUNCTION:
        return True
    return False


# ---------------------------------------------------------------------------
# Safe mark wrapper (DRY for the 3 try/except blocks in dispatch_tick)
# ---------------------------------------------------------------------------
# PR #149 review I5 (maintainability conf 9) + I6 (red-team conf 8):
# extract the "call mark RPC, swallow 40001, log LATE_MARK_IGNORED, re-
# raise anything else" pattern that was repeated 3 times in dispatch_tick.
# Single source of truth = single place to fix any future bug in the
# late-mark detection / logging contract.
#
# `label` is the short tag that appears in the log line — typically the
# RPC name ('mark_done' / 'mark_failed' / 'mark_failed (fallback)') so an
# operator scanning logs can tell which code path fired the late-mark.
#
# `outer_exc` is set when called from the outer-catch fallback path
# (I6): the original dispatch exception that triggered the
# `_mark_failed_fallback`. If `_safe_mark` itself swallows a 40001 in
# that path, the LATE_MARK_IGNORED log line carries
# `event_type="preempted_after_dispatch_error"` and includes the outer
# exception context — so the late-mark line subsumes the original
# error log instead of triplicating it.
#
# Returns: True iff `_safe_mark` swallowed a 40001 (LATE_MARK_IGNORED
# fired). False iff the mark succeeded normally. Re-raises any other
# exception. PR #149 second-pass review fix #4 (HIGH conf 8): callers
# in the outer-catch fallback path use the return value to decide
# whether to log the original `dispatch_tick: unhandled error` line —
# when LATE_MARK_IGNORED fired with `event_type="preempted_after_
# dispatch_error"`, the late-mark line ALREADY carries the outer
# context via the `extra` dict and the redundant error line would
# triplicate the same conceptual event for Sentry's severity-based
# alert pipeline.
async def _safe_mark(
    invoke_rpc,
    *,
    job_id: str,
    claim_token: str | None,
    worker_id: str,
    label: str,
    outer_exc: BaseException | None = None,
) -> bool:
    try:
        await db_execute(invoke_rpc)
        return False
    except Exception as mark_exc:  # noqa: BLE001
        if _is_serialization_failure(mark_exc):
            # event_type lets Sentry/log routing distinguish a clean
            # late-mark (worker preempted, nothing else wrong) from a
            # late-mark-after-dispatch-error (worker preempted AND the
            # original dispatch threw). The latter is structurally a
            # single conceptual event — the dispatch error is
            # explained by "another worker took over". Severity
            # pipelines that key on the latest log line will see
            # WARNING + the outer context together, not a stale
            # ERROR line that's already been superseded.
            event_type = (
                "preempted_after_dispatch_error" if outer_exc is not None else "preempted"
            )
            logger.warning(
                "LATE_MARK_IGNORED: job %s %s preempted by watchdog reclaim "
                "(claim_token=%s, worker=%s) — another worker has taken over",
                job_id, label, claim_token, worker_id,
                extra={
                    "event_type": event_type,
                    "job_id": job_id,
                    "label": label,
                    "worker_id": worker_id,
                    "claim_token": claim_token,
                    # repr() so structured-logging exporters get a
                    # stable string even when outer_exc carries
                    # non-serializable attrs (PostgREST APIError etc.).
                    "outer_exc": repr(outer_exc) if outer_exc is not None else None,
                },
            )
            return True
        raise


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
    #
    # Phase 106: backbone permanent-on; param retained — claim-RPC signature
    # unchanged, NO DDL in 106-proper. The former per-tick unified-backbone
    # flag read (whose value migration 104's claim RPC stamps into
    # compute_jobs.metadata) is now a literal True: the kill-switch reader is
    # deleted and the unified backbone is the only path. The RPC still receives
    # p_unified_backbone_active — passed constant true — so its signature and
    # the metadata stamp are byte-identical to prod's steady state.
    flag_active = True

    def _claim_priority():
        params: dict[str, Any] = {
            "p_batch_size": 5,
            "p_worker_id": worker_id,
            "p_unified_backbone_active": flag_active,
        }
        # FLIPRETRY-02: role "all" adds NO keys → byte-identical to prod today.
        params.update(_claim_kind_args(WORKER_CLAIM_ROLE))
        return supabase.rpc("claim_compute_jobs_with_priority", params).execute()

    def _claim_legacy():
        # Pre-migration-086 signature: 2 args, no priority/throttle.
        # Used only as the fallback path when migration 086 has not been
        # applied to this Supabase project (audit-2026-05-07 C-0190).
        #
        # FLIPRETRY-02: the legacy 2-arg claim CANNOT filter by kind. A
        # "backfill" worker must therefore REFUSE to claim on the fallback path
        # (it would take interactive jobs out-of-role); an "interactive" worker
        # still falls back (today's behavior) but the exclusion is degraded for
        # that tick — warn so it stays visible.
        if WORKER_CLAIM_ROLE == "backfill":
            logger.error(
                "claim_compute_jobs_with_priority unavailable (SQLSTATE 42883) "
                "and WORKER_CLAIM_ROLE=backfill: the legacy 2-arg claim cannot "
                "filter by kind, so a backfill worker REFUSES to claim (would "
                "take interactive jobs out-of-role). Claiming NOTHING this tick. "
                "Apply the kind-filter migration to restore backfill claiming.",
                extra={"event_type": "claim_rpc_fallback_backfill_refused"},
            )
            return SimpleNamespace(data=[])
        if WORKER_CLAIM_ROLE == "interactive":
            logger.warning(
                "claim_compute_jobs_with_priority unavailable (SQLSTATE 42883) "
                "and WORKER_CLAIM_ROLE=interactive: the legacy 2-arg claim "
                "cannot exclude the backfill kinds (%s) — this tick may claim "
                "backfill jobs. Apply the kind-filter migration to restore the "
                "exclusion.",
                ", ".join(BACKFILL_KINDS),
                extra={"event_type": "claim_rpc_fallback_interactive_degraded"},
            )
        return supabase.rpc(
            "claim_compute_jobs",
            {
                "p_batch_size": 5,
                "p_worker_id": worker_id,
            },
        ).execute()

    # audit-2026-05-07 C-0190: handle SQLSTATE 42883 (undefined_function)
    # from `claim_compute_jobs_with_priority` so a Supabase environment
    # without migration 086 falls back to the legacy claim RPC instead of
    # silently stalling.
    #
    # redteam-2026-05 W1 (MED8): the latch is NOT permanent. It carries a
    # timestamp (`_FALLBACK_LATCHED_AT`) and is re-probed every
    # `_FALLBACK_REPROBE_INTERVAL_S`. A transient 42883 (raised while a
    # migration is mid-`CREATE OR REPLACE`) therefore self-heals on the next
    # re-probe instead of demoting the worker to the legacy 2-arg claim for
    # the process lifetime. While latched we re-emit the WARNING so the
    # degradation stays visible. Only a STRUCTURED 42883 latches (a loose
    # message-substring match still triggers the one-shot per-tick fallback
    # but never latches).
    global _FALLBACK_CLAIM_RPC, _FALLBACK_LATCHED_AT
    now = time.monotonic()
    latched_and_fresh = (
        _FALLBACK_CLAIM_RPC
        and (now - _FALLBACK_LATCHED_AT) < _FALLBACK_REPROBE_INTERVAL_S
    )
    if latched_and_fresh:
        # Re-emit the WARNING so a latched degradation stays VISIBLE in logs
        # (not just the one-time line at latch time). The priority RPC will be
        # re-probed once the interval elapses.
        logger.warning(
            "claim_compute_jobs_with_priority still latched to legacy "
            "claim_compute_jobs RPC (SQLSTATE 42883 seen %.0fs ago); will "
            "re-probe the priority RPC after %.0fs. Apply migration 086 to "
            "restore priority-aware claiming.",
            now - _FALLBACK_LATCHED_AT,
            _FALLBACK_REPROBE_INTERVAL_S,
            extra={"event_type": "claim_rpc_fallback_latched"},
        )
        claim_result = await db_execute(_claim_legacy)
    else:
        # Either never latched, or the re-probe window elapsed — clear any
        # stale latch and re-attempt the priority RPC so a transient 42883
        # self-heals.
        if _FALLBACK_CLAIM_RPC:
            logger.info(
                "Re-probing claim_compute_jobs_with_priority after fallback "
                "window (%.0fs) elapsed.",
                _FALLBACK_REPROBE_INTERVAL_S,
                extra={"event_type": "claim_rpc_reprobe"},
            )
            _FALLBACK_CLAIM_RPC = False
        try:
            claim_result = await db_execute(_claim_priority)
        except Exception as exc:  # noqa: BLE001
            if _is_undefined_function(exc):
                # Only a STRUCTURED SQLSTATE 42883 latches; a message-only
                # match falls back for THIS tick but leaves the latch off so
                # the next tick re-attempts the priority RPC (redteam W1).
                structured = _is_undefined_function_structured(exc)
                if structured:
                    _FALLBACK_CLAIM_RPC = True
                    _FALLBACK_LATCHED_AT = now
                logger.warning(
                    "claim_compute_jobs_with_priority missing (SQLSTATE 42883%s); "
                    "falling back to legacy claim_compute_jobs RPC for this tick%s. "
                    "Apply migration 086 to restore priority-aware claiming.",
                    "" if structured else ", message-only match",
                    " and latching (will re-probe)" if structured else " (not latching)",
                    extra={
                        "event_type": "claim_rpc_fallback",
                        "latched": structured,
                    },
                )
                claim_result = await db_execute(_claim_legacy)
            else:
                raise
    # H-0529: type the claim path symmetrically with the dispatch() consumer.
    # claim_result.data is PostgREST `Any`; each row is a `SETOF compute_jobs`
    # record, so annotate as list[ClaimedJob] to pin the row contract the
    # worker dereferences below (`j["id"]`, `job["id"]`, `job.get("claim_token")`).
    jobs: list[ClaimedJob] = claim_result.data or []

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
        # FLIPRETRY-04: refresh healthz BETWEEN jobs. A dedicated backfill
        # worker processes a batch of bounded (wait_for-capped) 300s crawls
        # sequentially; without a per-job refresh, LAST_TICK_AT (stamped once
        # at claim above) freezes for the whole batch and healthz falsely
        # stales past 90s. Refreshing at the TOP of each iteration keeps the
        # signal HONEST — between jobs the loop is provably alive — while a
        # genuinely frozen dispatch gets no refresh and still goes stale (the
        # liveness check is not weakened). main_worker_healthz is imported
        # above at claim time.
        main_worker_healthz.LAST_TICK_AT = time.time()

        # audit-2026-05-07 P97 / G12.A.2 (mig 117): claim-token fence.
        # The claim RPC stamps a fresh UUID into compute_jobs.claim_token at
        # claim time; we read it from the row here and pass it through to the
        # mark RPCs. If the watchdog reclaims this row mid-handler and a
        # second worker takes over, our late mark RPC raises
        # serialization_failure — that's the expected late-mark-ignored path,
        # not a failure. INVEST-P97 §Recommendation point 2.
        claim_token = job.get("claim_token")
        try:
            # `dispatch(job: dict)` in services.job_worker accepts a plain dict;
            # a TypedDict is not assignable to `dict[Any, Any]` under mypy's
            # invariance rules even though `ClaimedJob` IS a dict at runtime.
            # Cast at this single boundary rather than loosening `ClaimedJob`
            # back to `Any` — the precise type still guards every `job["id"]`
            # / `job.get(...)` access in this module. Widening dispatch()'s
            # parameter to a Mapping is the symmetric cross-module follow-up
            # (services.job_worker is out of scope for H-0529).
            result = await dispatch(cast("dict[str, Any]", job))

            if result.outcome == DispatchOutcome.DONE:
                def _mark_done(jid=job["id"], tok=claim_token):
                    supabase.rpc(
                        "mark_compute_job_done",
                        {"p_job_id": jid, "p_claim_token": tok},
                    ).execute()

                await _safe_mark(
                    _mark_done,
                    job_id=job["id"],
                    claim_token=claim_token,
                    worker_id=worker_id,
                    label="mark_done",
                )
                logger.info("Job %s done (trade_count=%s)", job["id"], result.trade_count)

            elif result.outcome == DispatchOutcome.FAILED:
                def _mark_failed(
                    jid=job["id"],
                    err=result.error_message,
                    kind=result.error_kind,
                    tok=claim_token,
                ):
                    supabase.rpc(
                        "mark_compute_job_failed",
                        {
                            "p_job_id": jid,
                            "p_error": err or "Unknown error",
                            "p_error_kind": kind or "unknown",
                            "p_claim_token": tok,
                        },
                    ).execute()

                await _safe_mark(
                    _mark_failed,
                    job_id=job["id"],
                    claim_token=claim_token,
                    worker_id=worker_id,
                    label="mark_failed",
                )
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
            #
            # PR #149 second-pass review fix #4 (HIGH conf 8): defer the
            # "dispatch_tick: unhandled error" log line until AFTER the
            # fallback mark resolves. If the mark swallows a 40001
            # (LATE_MARK_IGNORED with event_type="preempted_after_
            # dispatch_error"), the late-mark line already carries the
            # outer_exc context via its `extra` dict — logging the
            # original error here would triplicate the same conceptual
            # event for Sentry's severity-based alert pipelines (ERROR
            # → WARNING cascade → WARNING) and the most-recent-severity
            # router would mis-classify a benign preemption as a
            # critical dispatch failure.
            try:
                def _mark_failed_fallback(
                    jid=job["id"], err=str(exc)[:500], tok=claim_token,
                ):
                    supabase.rpc(
                        "mark_compute_job_failed",
                        {
                            "p_job_id": jid,
                            "p_error": err,
                            "p_error_kind": "unknown",
                            "p_claim_token": tok,
                        },
                    ).execute()

                late_mark_swallowed = await _safe_mark(
                    _mark_failed_fallback,
                    job_id=job["id"],
                    claim_token=claim_token,
                    worker_id=worker_id,
                    label="mark_failed (fallback)",
                    outer_exc=exc,
                )
                if not late_mark_swallowed:
                    # mark_failed succeeded normally — the outer dispatch
                    # error is real and unattributed by any LATE_MARK_IGNORED
                    # line. Log it now at ERROR with the full traceback.
                    logger.error(
                        "dispatch_tick: unhandled error for job %s "
                        "(mark_failed succeeded): %s",
                        job.get("id"),
                        exc,
                        exc_info=exc,
                    )
                # else: LATE_MARK_IGNORED fired with
                # event_type="preempted_after_dispatch_error" and the
                # outer exc context lives in that record's `extra`
                # dict. Don't double-log.
            except Exception as mark_exc:  # noqa: BLE001
                # `_safe_mark` only re-raises NON-40001 exceptions, so we
                # reach this branch when the fallback mark itself failed
                # for a reason unrelated to the P97 fence. The original
                # dispatch error is also unattributed — log BOTH so the
                # operator sees the full chain.
                logger.error(
                    "dispatch_tick: unhandled error for job %s "
                    "(mark_failed also raised): %s",
                    job.get("id"),
                    exc,
                    exc_info=exc,
                )
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


async def _daily_enqueue_already_ran_today() -> bool:
    """Return True iff the daily enqueue has already run on the current UTC
    calendar day (so a worker restart within the same day must NOT re-seed).

    redteam-2026-05 W1 (LOW9): `daily_enqueue_loop` runs the full enqueue on
    EVERY worker startup. Railway redeploys/crashes within one day therefore
    triggered multiple full enqueue passes. The per-strategy partial-unique
    dedup only absorbs duplicates while the prior day's poll_positions jobs are
    still in-flight (status pending/running/done_pending_children — see
    migration 20260411144407 index); once they complete, a same-day re-seed
    inserts FRESH duplicate jobs → transient queue inflation.

    Signal: the daily loop stamps `metadata.enqueued_by = 'daily_loop'` on each
    job it creates (migration 20260412094449 STEP 4). We query the most-recent
    such poll_positions job and compare its `created_at` UTC date to today's.

    Fail-safe: any error (env not configured, DB down, missing column) returns
    False so the startup enqueue still fires. A redundant enqueue is the
    pre-existing behavior and is mostly absorbed by the RPC's own per-strategy
    in-flight guard; SKIPPING a legitimately-needed daily seed would be the
    worse failure, so we bias toward running."""
    try:
        supabase = get_supabase()

        def _query():
            return (
                supabase.table("compute_jobs")
                .select("created_at")
                .eq("kind", "poll_positions")
                .eq("metadata->>enqueued_by", "daily_loop")
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )

        result = await db_execute(_query)
        rows = result.data or []
        if not rows:
            return False
        created_at = rows[0].get("created_at")
        if not created_at:
            return False
        # created_at is an ISO-8601 timestamptz string (PostgREST). Normalize
        # the trailing 'Z' that fromisoformat rejected before Python 3.11.
        from datetime import datetime, timezone

        ts = datetime.fromisoformat(str(created_at).replace("Z", "+00:00"))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        return ts.astimezone(timezone.utc).date() == datetime.now(timezone.utc).date()
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "daily_enqueue startup-gate check failed (%s); proceeding with "
            "startup enqueue (fail-safe).",
            exc,
            extra={"event_type": "daily_enqueue_gate_failed"},
        )
        return False


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
    # Run on startup ONLY if the daily enqueue hasn't already run today.
    # redteam-2026-05 W1 (LOW9): without this gate, every Railway
    # redeploy/crash within one day re-ran the full enqueue, inflating the
    # poll_positions queue once the prior batch had completed (the per-strategy
    # in-flight dedup no longer covers completed rows). The periodic tick below
    # is unaffected — it fires on the genuine 24h boundary.
    try:
        if await _daily_enqueue_already_ran_today():
            logger.info(
                "daily_enqueue: skipping startup tick — already ran today "
                "(restart within the same UTC day).",
                extra={"event_type": "daily_enqueue_startup_skipped"},
            )
        else:
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
