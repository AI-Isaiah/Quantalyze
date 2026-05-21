"""Shared dispatcher for the durable compute_jobs queue worker.

Called by main_worker.py's dispatch loop. One public entrypoint —
`dispatch(job)` — which routes by job['kind'] to a per-kind handler,
wraps each handler in an asyncio.wait_for timeout, classifies any
exception into (error_kind, sanitized message), and always (on strategy-
scoped jobs) updates the UI status bridge before returning.

Supported kinds:
  sync_trades            -> run_sync_trades_job             (15-minute timeout)
  compute_analytics      -> run_compute_analytics_job       (15-minute timeout)
  compute_portfolio      -> run_compute_portfolio_job       (10-minute timeout)
  poll_positions         -> run_poll_positions_job          (3-minute timeout)
  sync_funding           -> run_sync_funding_job            (3-minute timeout)
  reconcile_strategy     -> run_reconcile_strategy_job      (5-minute timeout)
  compute_intro_snapshot -> run_compute_intro_snapshot_job  (2-minute timeout)
  process_key_long       -> run_process_key_long_job        (30-minute timeout) [Phase 19 / BACKBONE-09]

Error classification table — drives mark_compute_job_failed's retry-vs-final
decision:
  ccxt.NetworkError | RequestTimeout | RateLimitExceeded -> transient
  ccxt.AuthenticationError | PermissionDenied | BadRequest -> permanent
  cryptography.fernet.InvalidToken -> permanent (sanitized message)
  asyncio.TimeoutError -> transient (wait_for expiry)
  fastapi.HTTPException 4xx (except 408, 429) -> permanent
  fastapi.HTTPException 408, 429 -> transient
  everything else -> unknown (retried by default)

Circuit breaker: before creating the exchange in sync_trades and
poll_positions, check api_keys.last_429_at. If within the per-exchange
cooldown window (Binance 120s, OKX 300s, Bybit 600s), call defer_compute_job
RPC and return DispatchResult(outcome=DEFERRED).

On 429 (ccxt.RateLimitExceeded), stamp api_keys.last_429_at via
update_api_key_rate_limit before classifying as transient. This feeds the
circuit breaker so subsequent jobs for the same API key defer instead of
hammering the exchange.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any, Final, Literal

import ccxt
from cryptography.fernet import InvalidToken
from fastapi import HTTPException

from services.analytics_status import sync_strategy_analytics_status
from services.audit import log_audit_event
from services.db import db_execute, get_supabase
from services.encryption import decrypt_credentials, get_kek
from services.exchange import (
    create_exchange,
    fetch_all_trades,
    fetch_raw_trades,
    fetch_usdt_balance,
    get_and_clear_last_dq_flags,
    parse_since_ms,
)
from services.positions import fetch_positions, persist_position_snapshots


# ---------------------------------------------------------------------------
# Type aliases — G12.A.3
# ---------------------------------------------------------------------------
# Fill side ('buy'/'sell') and position direction ('long'/'short') were
# previously conflated as bare `str` throughout the worker / runner. The
# audit (G12.A.3, conf=10) flagged that downstream code branches on
# `'buy'/'sell'/'long'/'short'` interchangeably and `_compute_volume_metrics`
# historically aliased `long_volume_pct = buy_pct` — wrong for hedge-mode
# shorts opened via 'sell'. Migration 112 enforces the DB-side CHECK; these
# aliases enforce the same distinction at the type layer for future code.
Side = Literal["buy", "sell"]
PositionDirection = Literal["long", "short"]

# ---------------------------------------------------------------------------
# Compute-queue type aliases — G21 / audit-2026-05-07
# ---------------------------------------------------------------------------
# These aliases mirror DB CHECK constraints in `supabase/migrations/` (see
# 20260411144407_compute_jobs_queue.sql for status, 20260428120836 for
# priority). Migration 089 widened the claim filter to include 'failed_retry'
# — `CLAIMABLE_STATUSES` is the Python mirror of that SQL invariant so a
# future status addition or filter change forces an update on both sides.
#
# `ErrorKind` mirrors the 3-value DB CHECK on compute_jobs.error_kind enforced
# by `mark_compute_job_failed`. Keeping it as a Literal lets mypy/pyright
# catch capitalization drift ('Permanent') or vocabulary drift ('retry')
# statically rather than at the DB boundary.
ErrorKind = Literal["transient", "permanent", "unknown"]
JobStatus = Literal[
    "pending",
    "running",
    "done",
    "done_pending_children",
    "failed_retry",
    "failed_final",
]
Priority = Literal["low", "normal", "high"]

# Subset of JobStatus values that `claim_compute_jobs` is allowed to pick up
# (migration 089 widened the filter from {'pending'} → {'pending',
# 'failed_retry'} when the per-row next_attempt_at backoff has elapsed).
CLAIMABLE_STATUSES: Final[tuple[JobStatus, ...]] = ("pending", "failed_retry")

# M-0673: Feature flag is read once at module import — re-reading per job
# can produce rollout-window inconsistency (workers spawned mid-deploy with
# different env values processing different jobs differently). Tests can
# still flip behavior via monkeypatch on this module attribute.
_RAW_TRADE_INGESTION_ENABLED: Final[bool] = (
    os.environ.get("USE_RAW_TRADE_INGESTION", "false").lower() == "true"
)

logger = logging.getLogger("quantalyze.analytics.job_worker")


# ---------------------------------------------------------------------------
# Circuit breaker: per-exchange cooldown after 429
# ---------------------------------------------------------------------------
EXCHANGE_COOLDOWNS: dict[str, int] = {
    "binance": 120,   # 2 minutes
    "okx": 300,       # 5 minutes
    "bybit": 600,     # 10 minutes
}


# Severity ordering used by reconcile dedup. A new finding with a
# higher rank than the existing unacked row escalates in place; equal-
# or-lower rank skips. Source of truth lives in
# supabase/migrations/20260515113405_severity_critical.sql.
SEVERITY_RANK: dict[str, int] = {
    "low": 0,
    "medium": 1,
    "high": 2,
    "critical": 3,
}


# ---------------------------------------------------------------------------
# Public shape
# ---------------------------------------------------------------------------

class DispatchOutcome(str, Enum):
    """Three-way outcome of a dispatch call.

    DONE      - handler returned successfully; main_worker calls
                mark_compute_job_done next.
    FAILED    - handler raised or returned a terminal failure; main_worker
                calls mark_compute_job_failed(id, error, error_kind).
    DEFERRED  - handler itself already called defer_compute_job (e.g.
                circuit-breaker cooldown). main_worker must NOT call
                mark_* — the DB row was already transitioned.
    """

    DONE = "done"
    FAILED = "failed"
    DEFERRED = "deferred"


@dataclass(frozen=True, slots=True)
class DispatchResult:
    outcome: DispatchOutcome
    error_message: str | None = None
    # G21 / H-1110: typed as ErrorKind (Literal) — the DB CHECK on
    # compute_jobs.error_kind becomes defense-in-depth instead of the only
    # guard. `frozen=True` blocks accidental mutation; `slots=True` keeps
    # the dataclass compact.
    error_kind: ErrorKind | None = None
    trade_count: int | None = None  # sync_trades success only


# ---------------------------------------------------------------------------
# Per-kind timeout map (seconds)
# ---------------------------------------------------------------------------
# Matches the reset_stalled_compute_jobs per-kind overrides that main_worker
# passes to the watchdog. The handler timeout must be less than the watchdog
# stale threshold (10/20/10 minutes) so that a slow handler gets a chance
# to fail-classify itself rather than being yanked back to 'pending' by the
# watchdog while still running.
TIMEOUT_PER_KIND: dict[str, float] = {
    "sync_trades": 15 * 60,      # 15 minutes (supports 90-day raw fill backfill)
    "compute_analytics": 15 * 60,  # 15 minutes
    "compute_portfolio": 10 * 60,  # 10 minutes
    "poll_positions": 3 * 60,    # 3 minutes (services.positions.fetch_positions)
    "sync_funding": 3 * 60,      # 3 minutes (funding volume << trade volume)
    "reconcile_strategy": 5 * 60,  # 5 minutes (fetch_my_trades + DB scan + diff)
    "compute_intro_snapshot": 2 * 60,  # 2 minutes (pure DB; no exchange I/O)
    "rescore_allocator": 5 * 60,  # Phase 3 / D-12 Option B — full universe scan per allocator
    "poll_allocator_positions": 3 * 60,  # Phase 06 / INGEST-03 — same envelope as poll_positions
    "reconstruct_allocator_history": 30 * 60,   # Phase 07 / D-01 / RESEARCH.md §1E — 30 min full backfill
    "refresh_allocator_equity_daily": 3 * 60,   # Phase 07 / D-02 — one-day delta per key (VOICES-ACCEPTED f1)
    "process_key_long": 30 * 60,   # Phase 19 / BACKBONE-09 — 30 min ceiling supports 90-day OKX archive backfill
}


# ---------------------------------------------------------------------------
# Error classification
# ---------------------------------------------------------------------------

# HTTP 4xx codes that should be retried instead of going straight to
# failed_final. 408/429 are obvious upstream retries.
_HTTP_TRANSIENT_4XX: frozenset[int] = frozenset({408, 429})

# H-1113: 403/404 are NOT classified as permanent because internal routers
# (routers/internal.py) raise them for transient infrastructure states —
# 403 'Internal API not configured' during a deploy window, 404 'API key
# not found' during a rotation race. Treating them as permanent would
# terminate the job on the first deploy-time blip and require manual
# operator re-enqueue. Pre-fix these were 'permanent'; now they fall
# through to the 'unknown' branch (retried by default) so deploy-time
# self-heals work without operator intervention.
_HTTP_UNKNOWN_4XX: frozenset[int] = frozenset({403, 404})


def _format_http_detail(detail: object) -> str:
    """Coerce HTTPException.detail (typed `Any` by FastAPI) into a safe
    bounded string for last_error storage.

    H-1114 / M-0948 / M-0949 / M-0951: callers can raise
    HTTPException(detail=dict|list|BaseModel|str). str(dict) renders
    Python repr (single quotes, leaks internal keys); a non-stringifiable
    detail with a raising __str__ would propagate out of classify_exception
    itself, defeating the whole error envelope. Coerce explicitly: str
    passes through, mappings/sequences serialize via json.dumps, and any
    failure falls back to a fixed safe literal.
    """
    if isinstance(detail, str):
        return detail[:480]
    if detail is None:
        return ""
    try:
        return json.dumps(detail, default=str)[:480]
    except Exception:  # noqa: BLE001  - defensive against rogue __str__/__repr__
        return "<unstringifiable detail>"


def classify_exception(exc: Exception) -> tuple[ErrorKind, str]:
    """Map an exception to (error_kind, sanitized_message).

    Ordered most-specific → least-specific. Truncated to 500 chars so
    admin-UI rows stay bounded. See module docstring for the full table.

    H-1112 / H-1110: returns `tuple[ErrorKind, str]` so static checkers
    catch capitalization or vocabulary drift at the callsite. The DB
    CHECK on compute_jobs.error_kind becomes defense-in-depth instead of
    the only guard.
    """
    # asyncio.TimeoutError is raised by asyncio.wait_for when a handler
    # exceeds its per-kind timeout. Transient — we want to retry.
    if isinstance(exc, asyncio.TimeoutError):
        return ("transient", f"Handler exceeded timeout: {str(exc)[:200]}")

    # Fernet InvalidToken means the DEK cannot be unwrapped with the
    # current KEK — either a key rotation mismatch or a corrupted row.
    # The raw exception string is NOT safe to render (older fernet
    # versions included token bytes in error text). Ship a fixed message.
    if isinstance(exc, InvalidToken):
        return (
            "permanent",
            "Credentials could not be decrypted — key may have rotated",
        )

    # FastAPI HTTPException — analytics_runner raises 400 for "Insufficient
    # trade history" and similar pre-condition failures that no amount of
    # retry will fix (the input data is permanently absent).
    #
    # H-1113: HTTPException is checked BEFORE ccxt.BaseError so any future
    # multi-inheriting exception (unlikely but possible) gets the more
    # specific HTTP classification, not the catch-all 'unknown' bucket
    # — see test_http_exception_with_ccxt_baseerror_parent_still_permanent.
    #
    # The three buckets:
    #   408/429              → transient (upstream backpressure)
    #   403/404              → unknown   (deploy-time infra blips that
    #                                     routers/internal.py raises during
    #                                     env misconfig or key-rotation races
    #                                     — they self-heal so they should be
    #                                     retried, not failed_final'd)
    #   other 4xx (400/422)  → permanent (validation / pre-condition)
    #   5xx                  → fall through to 'unknown' (retried)
    #
    # M-0946: structured as a match/case so the trichotomy of 4xx is
    # explicit and exhaustive in the source rather than implicit in the
    # ordering of two `if status in ...` blocks.
    #
    # H-1114 / M-0947 / M-0948 / M-0949 / M-0951: include __cause__ repr
    # when present (preserves context across analytics_runner.py's
    # wrap-to-HTTPException(500) boundary) and coerce non-string detail
    # via _format_http_detail (FastAPI types HTTPException.detail as Any
    # — str(dict) would leak Python repr and could crash on rogue
    # __str__).
    if isinstance(exc, HTTPException):
        status = exc.status_code
        detail_str = _format_http_detail(exc.detail)
        cause = getattr(exc, "__cause__", None)
        if cause is not None:
            detail_str = f"{detail_str} (cause: {repr(cause)[:180]})"
        match status:
            case s if s in _HTTP_TRANSIENT_4XX:
                return ("transient", f"{status}: {detail_str}"[:500])
            case s if s in _HTTP_UNKNOWN_4XX:
                return ("unknown", f"{status}: {detail_str}"[:500])
            case s if 400 <= s < 500:
                return ("permanent", f"{status}: {detail_str}"[:500])
            case _:
                pass  # 5xx → falls through to 'unknown' below

    # CCXT hierarchy checks: RequestTimeout and RateLimitExceeded both
    # inherit from NetworkError, so `isinstance(..., NetworkError)` covers
    # all three. Kept explicit for readability + future drift safety.
    if isinstance(
        exc,
        (ccxt.NetworkError, ccxt.RequestTimeout, ccxt.RateLimitExceeded),
    ):
        return ("transient", str(exc)[:500])

    if isinstance(
        exc,
        (ccxt.AuthenticationError, ccxt.PermissionDenied, ccxt.BadRequest),
    ):
        return ("permanent", str(exc)[:500])

    # CCXT BaseError catch-all — many leaf types land here (ExchangeError,
    # InvalidOrder, NotSupported, ...). Treated as unknown so they retry,
    # and the admin UI sees error_kind='unknown' as the "needs a human look"
    # signal.
    if isinstance(exc, ccxt.BaseError):
        return ("unknown", str(exc)[:500])

    # Everything else (RuntimeError, ValueError, KeyError, ...).
    return ("unknown", str(exc)[:500])


# ---------------------------------------------------------------------------
# Shared helpers: API key loading, circuit breaker, 429 stamping
# ---------------------------------------------------------------------------

async def _load_strategy_and_key(
    supabase, strategy_id: str
) -> tuple[dict | None, dict | None, str | None]:
    """Load strategy row and its api_key row. Returns (strategy, key_row, error_msg).

    On success, error_msg is None. On failure, strategy and key_row may be
    None and error_msg explains why.
    """
    def _load_strategy() -> dict | None:
        res = (
            supabase.table("strategies")
            .select("id, user_id, api_key_id")
            .eq("id", strategy_id)
            .maybe_single()
            .execute()
        )
        return res.data

    strategy_row = await db_execute(_load_strategy)
    if not strategy_row or not strategy_row.get("api_key_id"):
        return None, None, "Strategy has no connected API key"

    def _load_key() -> dict | None:
        res = (
            supabase.table("api_keys")
            .select("*")
            .eq("id", strategy_row["api_key_id"])
            .maybe_single()
            .execute()
        )
        return res.data

    key_row = await db_execute(_load_key)
    if not key_row:
        return strategy_row, None, "API key not found"

    if key_row.get("user_id") != strategy_row.get("user_id"):
        return strategy_row, key_row, "API key does not belong to strategy owner"

    return strategy_row, key_row, None


async def _check_circuit_breaker(
    supabase, job: dict, key_row: dict
) -> DispatchResult | None:
    """Check circuit breaker: if api_key has a recent 429, defer the job.

    Returns a DEFERRED DispatchResult if the job should be deferred, or
    None if the circuit breaker is not tripped (proceed normally).
    """
    last_429_str = key_row.get("last_429_at")
    if not last_429_str:
        return None

    try:
        last_429 = datetime.fromisoformat(
            last_429_str.replace("Z", "+00:00")
        )
    except (ValueError, TypeError):
        return None

    now = datetime.now(timezone.utc)
    exchange_name = key_row.get("exchange", "")
    cooldown = EXCHANGE_COOLDOWNS.get(exchange_name, 120)
    remaining = cooldown - (now - last_429).total_seconds()

    if remaining <= 0:
        return None

    defer_seconds = int(remaining) + 5  # small buffer

    def _defer():
        supabase.rpc("defer_compute_job", {
            "p_job_id": job["id"],
            "p_defer_seconds": defer_seconds,
            "p_reason": f"exchange_cooldown:{exchange_name}:{int(remaining)}s_remaining",
        }).execute()

    await db_execute(_defer)

    logger.info(
        "Circuit breaker tripped for job %s (exchange=%s, %ds remaining)",
        job["id"], exchange_name, int(remaining),
    )
    return DispatchResult(outcome=DispatchOutcome.DEFERRED)


async def _stamp_429(supabase, key_row: dict) -> None:
    """Stamp api_keys.last_429_at on a 429 response.

    Called before classify_exception returns, so subsequent jobs for the
    same API key will be deferred by the circuit breaker.
    """
    def _update():
        supabase.table("api_keys").update({
            "last_429_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", key_row["id"]).execute()

    try:
        await db_execute(_update)
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "Failed to stamp last_429_at for api_key %s: %s",
            key_row.get("id"), exc,
        )


# ---------------------------------------------------------------------------
# Shared pre-flight for exchange-calling handlers
# ---------------------------------------------------------------------------

@dataclass
class _ExchangeContext:
    """Holds the shared state produced by pre-flight for exchange handlers."""
    supabase: object
    strategy_row: dict
    key_row: dict
    exchange: object


async def _exchange_preflight(
    job: dict, handler_name: str
) -> DispatchResult | _ExchangeContext:
    """Shared pre-flight for handlers that connect to an exchange.

    Loads the strategy + API key, checks the circuit breaker, decrypts
    credentials, and creates the exchange. Returns an _ExchangeContext
    on success, or a DispatchResult (FAILED/DEFERRED) if pre-flight
    cannot proceed.
    """
    strategy_id = job.get("strategy_id")
    if not strategy_id:
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message=f"{handler_name}: strategy_id missing",
            error_kind="permanent",
        )

    kek = get_kek()
    supabase = get_supabase()

    strategy_row, key_row, error_msg = await _load_strategy_and_key(
        supabase, strategy_id
    )
    if error_msg:
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message=error_msg,
            error_kind="permanent",
        )

    defer_result = await _check_circuit_breaker(supabase, job, key_row)
    if defer_result is not None:
        return defer_result

    api_key, api_secret, passphrase = decrypt_credentials(key_row, kek)
    exchange = create_exchange(
        key_row["exchange"], api_key, api_secret, passphrase
    )

    return _ExchangeContext(
        supabase=supabase,
        strategy_row=strategy_row,
        key_row=key_row,
        exchange=exchange,
    )


# ---------------------------------------------------------------------------
# Allocator-side preflight (Phase 06 — INGEST-03)
# ---------------------------------------------------------------------------
# f8 — Rate-limit contagion note:
# _check_circuit_breaker is per-exchange, shared with strategy-side
# poll_positions. A strategy-side 429 on Binance triggers a 120s cooldown
# (or up to 600s on Bybit per EXCHANGE_COOLDOWNS) that ALSO blocks allocator
# poll_allocator_positions on the same exchange. When this happens,
# _check_circuit_breaker returns DispatchResult(outcome=DispatchOutcome.DEFERRED,
# next_attempt_at=…) — a valid terminal state for THIS invocation that leaves
# the pending compute_jobs row queued with api_keys.sync_status='syncing'. The
# UI surfaces the queue state via the sync route's next_attempt_at (Plan 04
# helper text: "Queued — retry in {N}s"). Per-(exchange, api_key_id) breaker
# splitting is NOT in Phase 06 scope — tracked in PROJECT.md "Active —
# Inherited deferrals" for a future phase.


async def _allocator_key_preflight(
    job: dict, handler_name: str
) -> DispatchResult | _ExchangeContext:
    """D-05: Allocator worker preflight — skips the strategy hop.

    The allocator side does not own a strategy, so we load the api_key
    directly via job['api_key_id']. Still runs the per-exchange circuit
    breaker (f8 contagion accepted) and decrypts credentials before
    constructing the CCXT exchange.
    """
    api_key_id = job.get("api_key_id")
    if not api_key_id:
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message=f"{handler_name}: api_key_id missing",
            error_kind="permanent",
        )

    kek = get_kek()
    supabase = get_supabase()

    def _load_key() -> dict | None:
        res = (
            supabase.table("api_keys")
            .select("*")
            .eq("id", api_key_id)
            .maybe_single()
            .execute()
        )
        return res.data

    key_row = await db_execute(_load_key)
    if not key_row:
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message=f"{handler_name}: api_key {api_key_id} not found",
            error_kind="permanent",
        )
    if not key_row.get("is_active"):
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message=f"{handler_name}: api_key {api_key_id} is inactive",
            error_kind="permanent",
        )

    # f8 — this may return DEFERRED if the per-exchange breaker is cooling
    # down from a strategy-side 429; that's valid and the UI surfaces it via
    # next_attempt_at.
    defer_result = await _check_circuit_breaker(supabase, job, key_row)
    if defer_result is not None:
        return defer_result

    api_key, api_secret, passphrase = decrypt_credentials(key_row, kek)
    exchange = create_exchange(
        key_row["exchange"], api_key, api_secret, passphrase
    )

    return _ExchangeContext(
        supabase=supabase,
        strategy_row=None,      # allocator path has no strategy — reuse dataclass with None
        key_row=key_row,
        exchange=exchange,
    )


# M-0670: The internal wrapper exists specifically for the
# allocator.holdings.sync_* event family — narrow `action` to a Literal so
# static checkers (and grep) flag any drift the moment a typo enters this
# call surface. entity_type is hard-coded to 'api_key' (the single
# discriminator this wrapper supports).
AllocatorHoldingsAction = Literal[
    "allocator.holdings.sync_requested",
    "allocator.holdings.sync_completed",
    "allocator.holdings.sync_failed",
]


def _emit_audit(
    allocator_id: str,
    api_key_id: str,
    action: AllocatorHoldingsAction,
    metadata: dict | None = None,
) -> None:
    """f7 — Route allocator.holdings.sync_* audit events through
    services.audit.log_audit_event (NOT a local no-op).

    Fire-and-forget at the worker level: we wrap log_audit_event in a
    try/except because, per the audit-2026-05-07 P907 contract,
    services.audit.log_audit_event RE-RAISES on permission_denied
    (SQLSTATE 42501) and on unrecognized exception classes. An audit
    drop must never fail the compute path — at the success callsite
    (line ~1398) it would mark a complete holdings sync as FAILED;
    at the failure callsites (lines ~1322/~1352) it would swap the
    original error envelope (rate_limited / revoked credential) with an
    audit-system error in compute_jobs.last_error, hiding the real root
    cause from on-call. The function is re-imported locally rather than
    referenced at module scope so test monkeypatches on
    services.audit.log_audit_event resolve correctly.
    """
    from services import audit as audit_module
    try:
        audit_module.log_audit_event(
            user_id=allocator_id,
            action=action,
            entity_type="api_key",
            entity_id=api_key_id,
            metadata=metadata or {},
        )
    except Exception as audit_exc:  # noqa: BLE001
        logger.warning(
            "_emit_audit: audit emit %s failed for allocator=%s api_key=%s — "
            "compute path continues, audit row dropped: %s",
            action, allocator_id, api_key_id, audit_exc,
        )


# ---------------------------------------------------------------------------
# Per-kind handlers
# ---------------------------------------------------------------------------

async def run_sync_trades_job(job: dict) -> DispatchResult:
    """Decrypt the strategy's API key, fetch daily PnL from the exchange,
    and persist via the sync_trades RPC.

    Pre-flight: load API key, check circuit breaker (defer if 429 cooldown
    active), decrypt credentials, then create exchange.

    On ccxt.RateLimitExceeded (429), stamps api_keys.last_429_at before
    classifying so the circuit breaker kicks in for subsequent jobs.
    """
    ctx = await _exchange_preflight(job, "run_sync_trades_job")
    if isinstance(ctx, DispatchResult):
        return ctx

    strategy_id = job["strategy_id"]
    # Prefer the partial-success checkpoint (migration 045) so a prior run
    # that persisted fills but failed downstream doesn't re-fetch from scratch.
    since_ms = parse_since_ms(
        ctx.key_row.get("last_sync_at"),
        preferred=ctx.key_row.get("last_fetched_trade_timestamp"),
    )

    raw_fills: list = []
    # Audit-2026-05-07 red-team CRITICAL conf=9 — ``fetch_all_trades`` /
    # ``fetch_daily_pnl`` can write DQ flags into the per-task buffer
    # (historically ``bybit_daily_pnl_includes_funding`` pre-C-0319;
    # post-cutover the slot is reserved for future daily-PnL-branch
    # flags such as OKX archive truncation). The next call
    # (``fetch_raw_trades``) resets the buffer at its entry seam as
    # defense-in-depth against cross-task leaks; that reset would wipe
    # any daily-PnL flag before we can read it. Drain the buffer HERE
    # so the daily-PnL flags are captured into ``exchange_dq_flags``
    # and survive the ``fetch_raw_trades`` reset for the
    # strategy_analytics stamp below.
    exchange_dq_flags: dict[str, Any] = {}
    try:
        trades = await fetch_all_trades(ctx.exchange, since_ms=since_ms)
        # Drain BEFORE the next exchange call so daily-PnL flags do not
        # get clobbered by ``fetch_raw_trades``' entry-seam reset on
        # the same asyncio task.
        daily_pnl_dq_flags = get_and_clear_last_dq_flags()
        if daily_pnl_dq_flags:
            exchange_dq_flags.update(daily_pnl_dq_flags)
        account_balance = await fetch_usdt_balance(ctx.exchange)

        # --- Phase 2: Raw fill ingestion (gated by feature flag) ---
        # M-0673: feature flag is module-level constant. Re-reading per job
        # produced rollout-window inconsistency.
        #
        # H-0691: `phase2_failed` tracks BOTH fetch failures (caught below)
        # and persist failures (caught further down). When True, we stamp
        # `strategy_analytics.data_quality_flags.phase2_fill_ingestion_failed`
        # so the admin health card surfaces the silent-lag condition that
        # used to be log-only.
        phase2_failed = False
        phase2_error_message: str | None = None
        # Audit-2026-05-07 C-0225 / M-0663 / H-0670 — DQ flags surfaced by
        # ``fetch_raw_trades`` (partial-symbol failures, page-cap truncation,
        # fee-currency mismatch) MUST be drained immediately after the
        # await per the contract in ``services.exchange``. Otherwise the
        # ContextVar buffer leaks into the next call on the same task AND
        # the strategy_analytics stamp loop below cannot merge them into
        # ``data_quality_flags`` — silently dropping the very signals
        # that batch added.
        if _RAW_TRADE_INGESTION_ENABLED:
            try:
                raw_fills = await fetch_raw_trades(
                    ctx.exchange, strategy_id, ctx.supabase, since_ms=since_ms
                )
                fetch_raw_dq_flags = get_and_clear_last_dq_flags()
                if fetch_raw_dq_flags:
                    # Shallow merge — last-write-wins per key. The daily-PnL
                    # branch and the fetch_raw branch own disjoint key
                    # namespaces in practice (daily PnL: bybit_daily_pnl_*;
                    # fetch_raw: binance_partial_symbols, sync_truncated_*,
                    # fee_currency_mismatch*), so this is effectively a
                    # union.
                    exchange_dq_flags.update(fetch_raw_dq_flags)
            except Exception as e:
                # Drain even on failure so a partial accumulation does not
                # leak into the next call on this asyncio task. The drained
                # value is intentionally discarded — Phase 2 failed
                # end-to-end, so the H-0691 ``phase2_*`` stamp below is the
                # canonical signal; mixing partial truncation flags would
                # mislead operators.
                get_and_clear_last_dq_flags()
                # Phase 2 failure should NOT fail Phase 1.
                # G12.B.1 typed ColdStartSymbolDiscoveryError still lands
                # here intentionally — for sync_trades a cold-start
                # discovery failure means no fills were fetched, which
                # is the same effective outcome as any other Phase 2
                # error (Phase 1 succeeded; cursor stays put per
                # G12.A.7). The reconcile-job caller handles the typed
                # exception specifically (informational reconciles
                # should NOT alert on quiet accounts) — see
                # run_reconcile_strategy_job below.
                #
                # H-0691: Pre-fix, a Phase 2 failure logged a warning and the
                # job was reported as successful — fills silently lagged with
                # no admin signal. We now (a) keep the job DONE so we don't
                # retry the (succeeded) Phase 1, but (b) record the failure
                # into strategy_analytics.data_quality_flags so the admin
                # health card surfaces it. Best-effort: a stamp failure must
                # not change the job outcome.
                logger.warning(
                    "Raw fill ingestion failed for strategy %s (Phase 1 succeeded): %s",
                    strategy_id,
                    str(e),
                )
                phase2_failed = True
                phase2_error_message = str(e)[:200]
    except ccxt.RateLimitExceeded:
        await _stamp_429(ctx.supabase, ctx.key_row)
        # Audit-2026-05-07 red-team HIGH conf=8 — RateLimitExceeded can
        # bubble out of ``fetch_all_trades`` / ``fetch_usdt_balance`` /
        # ``fetch_raw_trades`` AFTER the daily-PnL branch or fetch_raw
        # has accumulated partial DQ flags (truncation, partial-symbol
        # failures, fee-currency mismatch). Worker pools reuse asyncio
        # tasks (see ``run_reconcile_strategy_job`` comment); a bare
        # re-raise here would leak those flags onto the next
        # compute_jobs task scheduled on the same asyncio task.
        # Mirror the explicit drain in ``run_reconcile_strategy_job``'s
        # RateLimitExceeded handler.
        get_and_clear_last_dq_flags()
        raise
    finally:
        try:
            await ctx.exchange.close()
        except Exception:  # pragma: no cover - defensive cleanup
            pass

    # Persist trades atomically via sync_trades RPC.
    #
    # PostgREST JSONB shape: pass `trades` (list[dict]) directly. The supabase
    # Python client serializes the params dict via json.dumps internally — if
    # we pre-serialize via json.dumps(trades), PostgREST receives a JSON STRING
    # (the literal "[…]" text) and casts it to a JSONB scalar string, not a
    # JSONB array. Then `jsonb_array_elements(p_trades)` inside migration 007's
    # sync_trades function fails with 22023 "cannot extract elements from a
    # scalar". Pass the raw list — supabase-py does the serialization once.
    #
    # Phase 1 wrapped in try/except: a 22023 (or any other persist failure on
    # the daily-PnL DELETE+INSERT path) must NOT abort Phase 2's raw-fill
    # ingestion below — raw fills are the canonical fill-level data that
    # downstream analytics + the wizard's verify-data gate count on.
    if trades:
        def _sync() -> int:
            res = ctx.supabase.rpc(
                "sync_trades",
                {"p_strategy_id": strategy_id, "p_trades": trades},
            ).execute()
            return int(res.data or 0)

        try:
            inserted = await db_execute(_sync)
            logger.info(
                "sync_trades: persisted %s rows for strategy %s", inserted, strategy_id
            )
        except Exception as e:
            logger.warning(
                "sync_trades Phase 1 (daily PnL) failed for strategy %s — "
                "continuing to Phase 2 raw-fill ingestion: %s",
                strategy_id, str(e),
            )

    # Persist raw fills (Phase 2, after exchange is closed).
    #
    # G12.A.7: previously the per-batch upsert had no error handling, so a
    # mid-stream failure (network blip on batch 3 of 5) would silently leave
    # batches 4-5 unpersisted while the cursor advance below moved
    # `last_fetched_trade_timestamp` past the failed window. Re-running the
    # job would not re-fetch the lost fills. We now track per-batch success
    # and gate the fetched-cursor advance on `phase2_complete`. The
    # last_sync_at cursor still advances (preserving prior daily-PnL
    # checkpoint semantics) but the granular fill-level checkpoint is held
    # back so the next run re-fetches the failed window.
    #
    # G12.A.6: `ignore_duplicates=True` silently discards exchange-amended
    # fills (final fee, settlement updates) that re-use the same
    # exchange_fill_id with mutated values. We don't change the persistence
    # semantics here (changing them is a bigger discussion — pending the
    # G12.A.6 follow-up), but we DO emit observability: a SELECT-and-compare
    # pass would add ~40 LOC of complexity, so per the audit plan we instead
    # emit a single warning per Phase 2 run with the count of fills that
    # collided with existing exchange_fill_ids. This is an under-counter
    # for amendments (it conflates true duplicates with amended fills) but
    # it makes the invisible visible. TODO(G12.A.6): upgrade to fee/price
    # diff detection if amendment volume justifies the round-trip.
    phase2_complete = False
    phase2_persisted = 0
    # G12.A.8 — grouping by (symbol, exchange) for cross-exchange contamination
    # is enforced in position_reconstruction.py per audit batch v0.22.12; this
    # worker only persists fills with the `exchange` field intact (the trades
    # table has an `exchange` column and we pass each fill dict through
    # unchanged), so no pre-aggregation drops the exchange dimension here.
    if raw_fills:
        # Direct insert with ON CONFLICT DO NOTHING (dedup via partial unique index)
        # Cannot use sync_trades RPC — it DELETE+INSERTs, which would destroy Phase 1 daily_pnl
        #
        # G12.A.6 amendment-detection SELECT — adversarial-review hardened
        # (PR #136 follow-up):
        #
        #   1. The upsert dedup key is `(strategy_id, exchange, exchange_fill_id)`.
        #      Pre-fix the SELECT only filtered `(strategy_id, exchange_fill_id)`
        #      so cross-exchange tradeId collisions (Bybit `execId` and Binance
        #      `id` namespaces are independent integer spaces) registered as
        #      false-positive amendments. Bucket by exchange first, then SELECT
        #      per-exchange so the predicate matches the upsert key exactly.
        #
        #   2. PostgREST `.in_()` URL-encodes the list. Backfills with thousands
        #      of fills exceed the ~8KB query string limit and the request 414/500s
        #      — silently swallowed at DEBUG, killing observability on exactly the
        #      runs where it matters most. Chunk per-exchange in 100-id batches
        #      matching the upsert chunk size so we stay well under the URL cap.
        existing_pairs: set[tuple[str, str]] = set()
        try:
            incoming_by_exchange: dict[str, list[str]] = {}
            for fill in raw_fills:
                fill_id = fill.get("exchange_fill_id")
                exch = fill.get("exchange")
                if fill_id and exch:
                    incoming_by_exchange.setdefault(exch, []).append(fill_id)

            for exch, fill_ids in incoming_by_exchange.items():
                for offset in range(0, len(fill_ids), 100):
                    chunk = fill_ids[offset:offset + 100]

                    def _select_existing(
                        _exch: str = exch,
                        _chunk: list[str] = chunk,
                    ) -> set[tuple[str, str]]:
                        res = (
                            ctx.supabase.table("trades")
                            .select("exchange,exchange_fill_id")
                            .eq("strategy_id", strategy_id)
                            .eq("exchange", _exch)
                            .in_("exchange_fill_id", _chunk)
                            .execute()
                        )
                        return {
                            (row.get("exchange"), row.get("exchange_fill_id"))
                            for row in (res.data or [])
                            if row.get("exchange") and row.get("exchange_fill_id")
                        }

                    existing_pairs |= await db_execute(_select_existing)
        except Exception as exc:  # noqa: BLE001
            # Observability is best-effort — never block the upsert.
            logger.debug(
                "sync_trades Phase 2: amendment-detection SELECT failed for "
                "strategy %s (continuing): %s",
                strategy_id, exc,
            )
            existing_pairs = set()

        try:
            for i in range(0, len(raw_fills), 100):
                batch = raw_fills[i:i + 100]
                def _insert_fills(rows=batch):
                    ctx.supabase.table("trades").upsert(
                        [{"strategy_id": strategy_id, **fill} for fill in rows],
                        on_conflict="strategy_id,exchange,exchange_fill_id",
                        ignore_duplicates=True,
                    ).execute()
                await db_execute(_insert_fills)
                phase2_persisted += len(batch)
            phase2_complete = True
        except Exception as exc:  # noqa: BLE001
            # Per-batch failure: do NOT advance the granular cursor below.
            # The next run will re-fetch the failed window and the
            # ignore_duplicates upsert keeps already-persisted batches
            # idempotent. H-0691: also stamp the data-quality flag so
            # the admin health card surfaces this lag.
            logger.warning(
                "sync_trades Phase 2: partial batch failure for strategy %s "
                "after %d/%d fills persisted — holding fetched-cursor so "
                "next run re-fetches lost fills. Error: %s",
                strategy_id, phase2_persisted, len(raw_fills), exc,
            )
            phase2_failed = True
            phase2_error_message = str(exc)[:200]

        # G12.A.6 amendment-detection observability (best-effort).
        amended_count = len(existing_pairs)
        if amended_count > 0:
            logger.warning(
                "fill_amendments_detected strategy=%s collisions=%d batch_size=%d "
                "(see G12.A.6 — ignore_duplicates may be hiding fee/price updates)",
                strategy_id, amended_count, len(raw_fills),
            )

        if phase2_complete:
            logger.info(
                "sync_trades Phase 2: persisted %d raw fills for strategy %s "
                "(%d collided with existing exchange_fill_ids)",
                phase2_persisted, strategy_id, amended_count,
            )

    # H-0691: When Phase 2 fetch or persist fails, surface the lag into
    # strategy_analytics.data_quality_flags so the admin "Position Metrics
    # Failed" health card lights up. Best-effort — stamp failure must not
    # change the job outcome (the trades are already persisted in Phase 1).
    #
    # Read-modify-write: data_quality_flags is shared with analytics_runner
    # (benchmark_unavailable / sibling_kinds_failed / position_metrics_failed
    # etc.); an unconditional upsert with just our keys would clobber those
    # signals. Read the current row, merge in our keys, then upsert.
    #
    # Known TOCTOU: per-strategy compute_jobs are serialized by status
    # (pending → running) and analytics_runner runs in a separate
    # compute_analytics job that is sequenced AFTER sync_trades via the
    # fan-in mechanism (migration 032 STEP 11/12). The window where
    # analytics_runner is running concurrently with this stamp is
    # therefore empty in practice. The stamp itself is best-effort —
    # losing a write here on a rare race means the next analytics_runner
    # invocation re-emits all flags it owns; we just lose the phase2
    # signal until the next sync_trades cron tick.
    #
    # Self-healing on success: when Phase 2 ran without raising
    # (phase2_failed=False), we ALSO clear the lingering phase2_* keys if
    # present so a recovered strategy stops looking "needs attention" to
    # the admin. We treat ANY non-failing Phase 2 run as a recovery
    # signal — including a successful fetch that returned ZERO new fills
    # (paused account, weekend, flat window). The earlier gate of
    # `phase2_complete` only flipped True when at least one batch was
    # persisted (gated by the `if raw_fills:` block above), so a healthy
    # strategy with no new fills would carry a stale phase2_fill_ingestion_failed=True
    # flag forever (HIGH code-review finding). We skip the read entirely
    # only when Phase 2 was not run at all (_RAW_TRADE_INGESTION_ENABLED
    # is False).
    phase2_success = _RAW_TRADE_INGESTION_ENABLED and not phase2_failed
    needs_flag_write = phase2_failed or phase2_success
    if needs_flag_write:
        def _load_existing_flags() -> dict:
            res = (
                ctx.supabase.table("strategy_analytics")
                .select("data_quality_flags")
                .eq("strategy_id", strategy_id)
                .maybe_single()
                .execute()
            )
            row = res.data or {}
            return dict(row.get("data_quality_flags") or {})

        flag_load_failed = False
        try:
            existing_flags = await db_execute(_load_existing_flags)
        except Exception as load_exc:  # noqa: BLE001
            # If the read fails, fall back to a fresh dict — we'd rather
            # potentially overwrite stale flags than skip the signal entirely
            # (analytics_runner re-emits its flags on the next computation).
            logger.warning(
                "sync_trades: failed to load existing data_quality_flags for "
                "strategy %s — proceeding with new-flag-only upsert: %s",
                strategy_id, load_exc,
            )
            existing_flags = {}
            flag_load_failed = True

        flag_was_set = existing_flags.get("phase2_fill_ingestion_failed") is True

        # Audit-2026-05-07 C-0225 / M-0663 / H-0670 — merge the DQ flags
        # drained from ``fetch_raw_trades`` (binance_partial_symbols,
        # sync_truncated_okx/_pages, sync_truncated_bybit/_pages,
        # fee_currency_mismatch, fee_currency_mismatch_samples) into the
        # row payload so they actually land on ``strategy_analytics``. We
        # do a shallow merge (last-write-wins per key) — analytics_runner
        # owns a disjoint key namespace (benchmark_*, sibling_kinds_*) so
        # cross-clobber is not a concern. ``exchange_dq_flags`` is {} on
        # the clean path (most common) so this is a no-op then.
        exchange_dq_flags_present = bool(exchange_dq_flags)
        if exchange_dq_flags_present:
            existing_flags.update(exchange_dq_flags)

        if phase2_failed:
            existing_flags["phase2_fill_ingestion_failed"] = True
            existing_flags["phase2_error"] = phase2_error_message or "unknown"
            existing_flags["phase2_failed_at"] = datetime.now(timezone.utc).isoformat()
            write_needed = True
        else:
            # Phase 2 ran without raising — clear the lingering flag if present.
            # Red-team M-conf=8: when the read itself failed we cannot tell
            # from an empty dict whether the DB row carries a stale failure
            # flag. Write the recovery payload defensively in that case so a
            # recovered strategy whose read transiently blipped no longer
            # perma-stays in "needs attention" on the admin health card.
            # PostgREST upsert merges JSONB keys, so emitting an EXPLICIT
            # `phase2_fill_ingestion_failed=False` is required on the
            # load-failed path (a pop here would not actually remove the
            # stale key from the DB row since we never read it).
            if flag_was_set:
                existing_flags.pop("phase2_fill_ingestion_failed", None)
                existing_flags.pop("phase2_error", None)
                existing_flags.pop("phase2_failed_at", None)
                existing_flags["phase2_recovered_at"] = (
                    datetime.now(timezone.utc).isoformat()
                )
                write_needed = True
            elif flag_load_failed:
                existing_flags["phase2_fill_ingestion_failed"] = False
                existing_flags["phase2_recovered_at"] = (
                    datetime.now(timezone.utc).isoformat()
                )
                write_needed = True
            elif exchange_dq_flags_present:
                # Phase 2 clean but ``fetch_raw_trades`` surfaced a DQ
                # signal (e.g. binance_partial_symbols, sync_truncated_*).
                # Persist so the admin health card can see it.
                write_needed = True
            else:
                write_needed = False

        if write_needed:
            def _stamp_phase2_flags() -> None:
                ctx.supabase.table("strategy_analytics").upsert(
                    {
                        "strategy_id": strategy_id,
                        "data_quality_flags": existing_flags,
                    },
                    on_conflict="strategy_id",
                ).execute()

            try:
                await db_execute(_stamp_phase2_flags)
            except Exception as flag_exc:  # noqa: BLE001
                logger.warning(
                    "sync_trades: failed to stamp data_quality_flags "
                    "phase2_* for strategy %s: %s",
                    strategy_id, flag_exc,
                )

    # Checkpoint cursor after any successful fetch (empty or not). Survives
    # downstream analytics/reconstruction failure. Best-effort — a missed
    # stamp just means re-fetching one window next run.
    #
    # G12.A.7: only advance the granular fetched-cursor if Phase 2 fully
    # succeeded (or wasn't run). A partial-batch failure leaves the cursor
    # untouched so the next run re-fetches the lost fills. Empty fetches
    # (`raw_fills == []`) and feature-flag-disabled paths still advance —
    # `phase2_complete` defaults False but `raw_fills` is also False so
    # the gate falls through.
    advance_fetched_cursor = (not raw_fills) or phase2_complete
    if advance_fetched_cursor:
        def _update_fetched_cursor() -> None:
            ctx.supabase.table("api_keys").update(
                {"last_fetched_trade_timestamp": datetime.now(timezone.utc).isoformat()}
            ).eq("id", ctx.key_row["id"]).execute()

        try:
            await db_execute(_update_fetched_cursor)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Failed to stamp last_fetched_trade_timestamp for api_key %s: %s",
                ctx.key_row.get("id"), exc,
            )

    # Advance sync cursor always (even for empty fetches).
    def _update_cursor() -> None:
        update_data: dict = {
            "last_sync_at": datetime.now(timezone.utc).isoformat()
        }
        if account_balance is not None:
            update_data["account_balance_usdt"] = account_balance
        ctx.supabase.table("api_keys").update(update_data).eq(
            "id", ctx.key_row["id"]
        ).execute()

    await db_execute(_update_cursor)

    # Phase 18 root-cause fix: enqueue the follow-on compute_analytics
    # job for THIS strategy. Without it, sync_trades completes, the
    # 099 atomic-bridge RPC sets strategy_analytics.computation_status
    # to 'complete' (because all compute_jobs rows for the strategy are
    # 'done'), the wizard advances — but the strategy_analytics row has
    # NULL metrics because nobody actually computed them. The wizard
    # then renders an empty factsheet.
    #
    # The chain compute_jobs → sync_trades → compute_analytics has been
    # the documented design since Sprint 3 (migration 032 STEP 11
    # check_fan_in_ready + STEP 12 mark_compute_job_done's children
    # advancement loop) but the enqueue side was never wired. The
    # /api/keys/sync route only enqueues sync_trades; daily crons only
    # rescore existing strategies. New-strategy onboarding via the
    # wizard was the only path that needed this and it has been broken
    # since the queue substrate was introduced.
    #
    # Enqueue is best-effort *for the job retry loop* — a transient failure
    # must not retry-loop sync_trades (the trades are already persisted and
    # the next cron tick re-enqueues cleanly). However, the wizard polls
    # strategy_analytics.computation_status and would otherwise spin for
    # up to 24h with no error UI until the daily cron tick (regression
    # of the same wizard-hang class PR #116 was meant to root-cause-fix).
    #
    # Fix: when the enqueue fails, write a `failed` row to strategy_analytics
    # with a discriminating computation_error so the wizard's polling loop
    # in SyncPreviewStep.tsx surfaces a GATE_ANALYTICS_FAILED envelope and
    # the user sees a real error instead of an indefinite spinner. The
    # daily cron will still re-enqueue and the next successful run will
    # upsert computation_status back to 'computing' / 'complete'.
    try:
        def _enqueue_compute_analytics() -> None:
            ctx.supabase.rpc(
                "enqueue_compute_job",
                {"p_strategy_id": strategy_id, "p_kind": "compute_analytics"},
            ).execute()

        await db_execute(_enqueue_compute_analytics)
        logger.info(
            "sync_trades: enqueued follow-on compute_analytics for strategy %s",
            strategy_id,
        )
    except Exception as exc:  # noqa: BLE001
        # logger.exception (not warning) — operators must see the stack
        # trace in Railway logs; previous WARNING-and-swallow hid the
        # underlying cause for up to 24h.
        logger.exception(
            "sync_trades: failed to enqueue follow-on compute_analytics "
            "for strategy %s — marking strategy_analytics as failed so "
            "the wizard surfaces an error envelope instead of hanging. "
            "Error: %s",
            strategy_id,
            exc,
        )

        # Mark strategy_analytics.computation_status='failed' so the
        # wizard's poller (SyncPreviewStep.tsx) breaks out of its
        # waiting_for_complete state and renders an error envelope.
        # Best-effort: if even this write fails, we log + swallow rather
        # than fail the job (the trades are already persisted).
        try:
            def _mark_analytics_failed() -> None:
                ctx.supabase.table("strategy_analytics").upsert(
                    {
                        "strategy_id": strategy_id,
                        "computation_status": "failed",
                        "computation_error": (
                            "Analytics enqueue failed during sync. "
                            "The next scheduled sync will retry — "
                            "contact support if this persists."
                        ),
                    },
                    on_conflict="strategy_id",
                ).execute()

            await db_execute(_mark_analytics_failed)
        except Exception as mark_exc:  # noqa: BLE001
            logger.exception(
                "sync_trades: failed to mark strategy_analytics as "
                "failed for strategy %s after enqueue failure — wizard "
                "may still hang. Error: %s",
                strategy_id,
                mark_exc,
            )

    return DispatchResult(
        outcome=DispatchOutcome.DONE, trade_count=len(trades)
    )


async def run_compute_analytics_job(job: dict) -> DispatchResult:
    """Run the full strategy analytics pipeline. Delegates to
    services.analytics_runner.run_strategy_analytics — the same helper the
    HTTP /api/compute-analytics endpoint uses. See the module docstring on
    analytics_runner.py for why this is a shared helper."""
    strategy_id = job.get("strategy_id")
    if not strategy_id:
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message="run_compute_analytics_job: strategy_id missing",
            error_kind="permanent",
        )

    # Imported lazily to avoid circular import risk with analytics_runner,
    # which itself imports from services.benchmark etc.
    from services.analytics_runner import run_strategy_analytics

    await run_strategy_analytics(strategy_id)
    return DispatchResult(outcome=DispatchOutcome.DONE)


async def run_compute_portfolio_job(job: dict) -> DispatchResult:
    """Run portfolio analytics via the existing routers.portfolio helper.

    _compute_portfolio_analytics is imported lazily — routers/portfolio.py
    pulls in FastAPI + slowapi + pydantic at import time, and the worker
    runs those imports only when a compute_portfolio job actually shows up
    in the queue.
    """
    portfolio_id = job.get("portfolio_id")
    if not portfolio_id:
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message="run_compute_portfolio_job: portfolio_id missing",
            error_kind="permanent",
        )

    from routers.portfolio import _compute_portfolio_analytics

    await _compute_portfolio_analytics(portfolio_id)
    return DispatchResult(outcome=DispatchOutcome.DONE)


async def run_sync_funding_job(job: dict) -> DispatchResult:
    """Fetch funding fees from the exchange and UPSERT into funding_fees.

    Uses services.funding_fetch to normalize Binance/OKX/Bybit funding
    into a uniform shape, then upserts with on_conflict='match_key',
    ignore_duplicates=True so re-runs are no-ops.

    Pre-flight: same as sync_trades (strategy + api_key load, circuit
    breaker, decrypt, exchange create). On 429, stamps last_429_at.
    """
    ctx = await _exchange_preflight(job, "run_sync_funding_job")
    if isinstance(ctx, DispatchResult):
        return ctx

    strategy_id = job["strategy_id"]
    exchange_name = ctx.key_row["exchange"]
    since_ms = parse_since_ms(ctx.key_row.get("last_sync_at"))

    # Import inside function to avoid hard dependency at module load
    # (funding_fetch imports ccxt.async_support which is heavy).
    from services.funding_fetch import (
        fetch_funding_binance,
        fetch_funding_okx,
        fetch_funding_bybit,
        upsert_funding_rows,
    )

    try:
        if exchange_name == "binance":
            rows = await fetch_funding_binance(ctx.exchange, strategy_id, since_ms)
        elif exchange_name == "okx":
            rows = await fetch_funding_okx(ctx.exchange, strategy_id, since_ms)
        elif exchange_name == "bybit":
            rows = await fetch_funding_bybit(ctx.exchange, strategy_id, since_ms)
        else:
            return DispatchResult(
                outcome=DispatchOutcome.FAILED,
                error_message=f"sync_funding: exchange {exchange_name} not supported",
                error_kind="permanent",
            )
    except ccxt.RateLimitExceeded:
        await _stamp_429(ctx.supabase, ctx.key_row)
        raise
    finally:
        try:
            await ctx.exchange.close()
        except Exception:  # pragma: no cover
            pass

    if not rows:
        logger.info("sync_funding: no funding rows for strategy %s", strategy_id)
        return DispatchResult(outcome=DispatchOutcome.DONE)

    result = await upsert_funding_rows(ctx.supabase, rows)
    upsert_errors = result.get("errors") or []
    if upsert_errors:
        # H-1115: upsert_funding_rows catches per-batch failures into a
        # `errors` list and continues; the worker previously ignored the
        # list and returned DONE with partial inserted count. A 9-of-10
        # batch failure produced `inserted=100` with no warning and 900
        # silently-missing rows. Now: log each entry with strategy_id (so
        # on-call has a searchable signature) and return FAILED transient
        # so the job retries.
        for err in upsert_errors:
            logger.error(
                "sync_funding: upsert_funding_rows batch failed for "
                "strategy %s: %s",
                strategy_id, err,
            )
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_kind="transient",
            error_message=(
                f"sync_funding: {len(upsert_errors)} upsert "
                f"batch(es) failed: {upsert_errors[:3]}"
            ),
        )

    logger.info(
        "sync_funding: upserted %d funding rows for strategy %s",
        result["inserted"], strategy_id,
    )
    return DispatchResult(outcome=DispatchOutcome.DONE)


async def run_poll_positions_job(job: dict) -> DispatchResult:
    """Fetch open positions from the exchange and persist as snapshots.

    Pre-flight: load API key, check circuit breaker (defer if 429 cooldown
    active), decrypt credentials, then create exchange.

    On ccxt.RateLimitExceeded (429), stamps api_keys.last_429_at before
    classifying so the circuit breaker kicks in for subsequent jobs.
    """
    ctx = await _exchange_preflight(job, "run_poll_positions_job")
    if isinstance(ctx, DispatchResult):
        return ctx

    strategy_id = job["strategy_id"]

    try:
        snapshots = await fetch_positions(ctx.key_row["exchange"], ctx.exchange)
    except ccxt.RateLimitExceeded:
        await _stamp_429(ctx.supabase, ctx.key_row)
        raise
    finally:
        try:
            await ctx.exchange.close()
        except Exception:  # pragma: no cover - defensive cleanup
            pass

    # Persist snapshots
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    count = await persist_position_snapshots(
        ctx.supabase, snapshots, strategy_id, today_str
    )
    logger.info(
        "poll_positions: persisted %d position snapshots for strategy %s",
        count, strategy_id,
    )

    return DispatchResult(outcome=DispatchOutcome.DONE)


async def run_poll_allocator_positions_job(job: dict) -> DispatchResult:
    """INGEST-03: poll allocator holdings (spot + derivatives) via CCXT
    and upsert into allocator_holdings.

    Preflight via _allocator_key_preflight — no strategy hop. On
    fetch_allocator_holdings failure, map the exception to
    api_keys.sync_status per D-07 ('revoked' / 'rate_limited' / 'error')
    and emit an ``allocator.holdings.sync_failed`` audit event (f7). On
    DONE, update sync_status / last_sync_at and emit
    ``allocator.holdings.sync_completed`` with row_count +
    holding_type_counts metadata.

    f8: _check_circuit_breaker shares the per-exchange cooldown with
    strategy-side poll_positions — if it's cooling down, preflight
    returns DispatchResult(outcome=DEFERRED) and we pass it straight
    through without touching api_keys (the job stays queued).
    """
    from services.allocator_positions import (
        fetch_allocator_holdings,
        persist_allocator_holdings,
        _map_exception_to_sync_status,
    )

    ctx = await _allocator_key_preflight(job, "run_poll_allocator_positions_job")
    if isinstance(ctx, DispatchResult):
        # f8: DEFERRED passes through unchanged; api_keys.sync_status
        # stays 'syncing' and compute_jobs stays pending.
        return ctx

    api_key_id = job["api_key_id"]
    allocator_id = ctx.key_row["user_id"]
    venue = ctx.key_row["exchange"]
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    try:
        try:
            rows, warning = await fetch_allocator_holdings(venue, ctx.exchange)
        except ccxt.RateLimitExceeded as exc:
            await _stamp_429(ctx.supabase, ctx.key_row)
            error_kind, msg = classify_exception(exc)
            sanitized = msg[:500]

            def _update_rate_limited():
                return (
                    ctx.supabase.table("api_keys")
                    .update({"sync_status": "rate_limited", "sync_error": sanitized})
                    .eq("id", api_key_id)
                    .execute()
                )

            try:
                await db_execute(_update_rate_limited)
            except Exception as upd_exc:  # noqa: BLE001
                logger.warning(
                    "poll_allocator_positions: failed to stamp sync_status='rate_limited' "
                    "for api_key %s: %s",
                    api_key_id, upd_exc,
                )
            _emit_audit(
                allocator_id, api_key_id, "allocator.holdings.sync_failed",
                {"error_kind": error_kind, "sanitized_message": sanitized},
            )
            return DispatchResult(
                outcome=DispatchOutcome.FAILED,
                error_message=sanitized,
                error_kind=error_kind,
            )
        except Exception as exc:  # noqa: BLE001
            error_kind, msg = classify_exception(exc)
            sanitized = msg[:500]
            status_target = _map_exception_to_sync_status(exc)

            def _update_err():
                return (
                    ctx.supabase.table("api_keys")
                    .update({"sync_status": status_target, "sync_error": sanitized})
                    .eq("id", api_key_id)
                    .execute()
                )

            try:
                await db_execute(_update_err)
            except Exception as upd_exc:  # noqa: BLE001
                logger.warning(
                    "poll_allocator_positions: failed to stamp sync_status='%s' "
                    "for api_key %s: %s",
                    status_target, api_key_id, upd_exc,
                )
            _emit_audit(
                allocator_id, api_key_id, "allocator.holdings.sync_failed",
                {"error_kind": error_kind, "sanitized_message": sanitized},
            )
            return DispatchResult(
                outcome=DispatchOutcome.FAILED,
                error_message=sanitized,
                error_kind=error_kind,
            )
    finally:
        try:
            await ctx.exchange.close()
        except Exception:  # pragma: no cover - defensive cleanup
            pass

    # Persist + success status update
    count = await persist_allocator_holdings(
        ctx.supabase, rows, allocator_id, api_key_id, today_str
    )

    spot_count = sum(1 for r in rows if r.get("holding_type") == "spot")
    deriv_count = sum(1 for r in rows if r.get("holding_type") == "derivative")

    final_status = "complete_with_warnings" if warning else "complete"

    def _update_ok():
        return (
            ctx.supabase.table("api_keys")
            .update({
                "sync_status": final_status,
                "sync_error": warning,
                "last_sync_at": datetime.now(timezone.utc).isoformat(),
            })
            .eq("id", api_key_id)
            .execute()
        )

    try:
        await db_execute(_update_ok)
    except Exception as upd_exc:  # noqa: BLE001
        logger.warning(
            "poll_allocator_positions: failed to stamp sync_status='%s' "
            "for api_key %s: %s",
            final_status, api_key_id, upd_exc,
        )

    _emit_audit(
        allocator_id, api_key_id, "allocator.holdings.sync_completed",
        {
            "row_count": count,
            "holding_type_counts": {"spot": spot_count, "derivative": deriv_count},
        },
    )

    # Phase 11 / Plan 03 / D-13 / ONBOARD-05 — stamp first_sync_success_at
    # marker via the SECURITY DEFINER RPC shipped by Plan 01 migration 084.
    # The RPC is idempotent (writes only when the marker is absent), so
    # subsequent successful syncs are a no-op for this side effect. The
    # /allocations Server Component reader fires the PostHog
    # `first_sync_success` event on the next dashboard request.
    #
    # Non-blocking: a stamp failure must not affect the compute job. The
    # RPC failure path is logged via logger.warning per the analytics-service
    # convention (services/audit.py error handling).
    def _stamp_first_sync():
        return (
            ctx.supabase.rpc(
                "stamp_first_sync_success",
                {"p_user_id": allocator_id},
            ).execute()
        )

    try:
        await db_execute(_stamp_first_sync)
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "poll_allocator_positions: failed to stamp first_sync_success_at "
            "for allocator %s: %s",
            allocator_id, exc,
        )

    logger.info(
        "poll_allocator_positions: persisted %d rows for allocator %s "
        "(spot=%d, derivative=%d, status=%s)",
        count, allocator_id, spot_count, deriv_count, final_status,
    )

    return DispatchResult(outcome=DispatchOutcome.DONE)


async def run_reconcile_strategy_job(job: dict) -> DispatchResult:
    """Compare live exchange fills against stored `trades` rows for the past 24h.

    Pre-flight: same as sync_trades (strategy + api_key load, circuit
    breaker, decrypt, exchange create). Then:
      1. Fetch raw fills from the exchange via services.exchange.fetch_raw_trades
         (the same seam sync_trades uses — fill-level, not daily aggregates).
      2. Select `trades` rows for this strategy with is_fill=true and
         timestamp in the past 24h.
      3. Call services.reconciliation.diff_strategy_fills to classify
         each mismatch (two-stage: PRIMARY by fill_id, SECONDARY by tuple
         with id_drift/N:M review escalation).
      4. UPSERT the report into reconciliation_reports
         ON CONFLICT (strategy_id, report_date).
      5. If the report is non-clean, insert one `sync_failure` alert per
         portfolio that contains this strategy (dedup'd by migration
         042's partial unique index on (portfolio_id, alert_type) WHERE
         acknowledged_at IS NULL).

    On ccxt.RateLimitExceeded (429), stamps api_keys.last_429_at before
    classifying so the circuit breaker kicks in for subsequent jobs.
    """
    ctx = await _exchange_preflight(job, "run_reconcile_strategy_job")
    if isinstance(ctx, DispatchResult):
        return ctx

    strategy_id = job["strategy_id"]
    now = datetime.now(timezone.utc)
    since = now - timedelta(hours=24)
    since_iso = since.isoformat()
    since_ms = parse_since_ms(None, preferred=since_iso)

    # Step 1: fetch raw exchange fills (past 24h window).
    # NB: `fetch_raw_trades` is imported at module scope (services.exchange);
    # we re-import only `ColdStartSymbolDiscoveryError` here because it is a
    # rarely-raised sentinel. Importing `fetch_raw_trades` locally would shadow
    # the module-level binding and break test patches that target
    # `services.job_worker.fetch_raw_trades` (PR-Y1 code-review HIGH).
    from services.exchange import ColdStartSymbolDiscoveryError

    try:
        exchange_fills = await fetch_raw_trades(
            ctx.exchange, strategy_id, ctx.supabase, since_ms=since_ms
        )
        # Audit-2026-05-07 C-0225 / M-0663 / H-0670 — drain the per-task
        # DQ buffer per the contract in ``services.exchange``. Reconcile
        # is an informational, read-only diff; it does not own a
        # strategy_analytics row to stamp these into, so we discard the
        # value. The drain is still required so the buffer is not left
        # populated for the NEXT call on this asyncio task (worker pools
        # reuse tasks).
        get_and_clear_last_dq_flags()
    except ccxt.RateLimitExceeded:
        await _stamp_429(ctx.supabase, ctx.key_row)
        # Drain so a rate-limit-truncated partial accumulation does not
        # leak forward on this asyncio task.
        get_and_clear_last_dq_flags()
        raise
    except ColdStartSymbolDiscoveryError as exc:
        # Cross-PR specialist finding: ColdStartSymbolDiscoveryError
        # (PR 2 / G12.B.1) is raised when fetch_positions() fails OR
        # returns no symbols. For sync_trades, that's a real failure
        # signal. For RECONCILE — which runs on a 24h window over an
        # informational read — a Binance allocator with no open
        # positions in the past 24h is normal (paused account, flat
        # for >24h). Pre-fix, the broad `except Exception` at the
        # dispatcher would treat this as a generic reconcile failure
        # and emit a portfolio-level `sync_failure` alert. That's a
        # user-visible UX bug for quiet accounts.
        #
        # Fix: treat ColdStart as "no fills to reconcile" — log NOTICE,
        # return DONE with an empty exchange_fills list. The
        # reconciliation diff against db_fills will still run and
        # surface real discrepancies; we just don't synthesize fills
        # we couldn't fetch.
        logger.info(
            "reconcile_strategy: strategy=%s — exchange returned no "
            "open-position symbols (%s); reconciling against DB fills only",
            strategy_id, exc,
        )
        exchange_fills = []
        # ColdStart raised before the per-exchange branch could populate
        # the DQ buffer with any meaningful data, but drain defensively
        # in case the entry-seam reset+partial work left a residue.
        get_and_clear_last_dq_flags()
    except Exception:
        # Audit-2026-05-07 red-team HIGH conf=8 — every untyped exception
        # path that escapes ``fetch_raw_trades`` (BinancePerSymbolFetchError,
        # ccxt.NetworkError, ccxt.ExchangeError, generic Exception) used to
        # propagate WITHOUT draining the per-task DQ buffer. Worker pools
        # reuse asyncio tasks, so a partial accumulation (e.g. truncated
        # binance_partial_symbols list or sync_truncated_okx=True) would
        # leak forward and surface on an unrelated strategy's
        # ``data_quality_flags`` row. The bare drain closes the gap left by
        # the explicit per-class handlers; we re-raise unchanged so the
        # outer dispatcher's classifier still sees the original exception.
        get_and_clear_last_dq_flags()
        raise
    finally:
        try:
            await ctx.exchange.close()
        except Exception:  # pragma: no cover - defensive cleanup
            pass

    # Step 2: load DB fills for the same window. We only select the
    # columns that diff_strategy_fills actually reads (verified against
    # services/reconciliation.py:_summarize + matcher key extraction).
    # Hard cap at 50k rows so a runaway-strategy can't OOM the worker.
    def _load_db_fills() -> list[dict]:
        res = (
            ctx.supabase.table("trades")
            .select(
                "exchange, exchange_fill_id, symbol, side, price, quantity, timestamp"
            )
            .eq("strategy_id", strategy_id)
            .eq("is_fill", True)
            .gte("timestamp", since_iso)
            .limit(50_000)
            .execute()
        )
        return list(res.data or [])

    db_fills = await db_execute(_load_db_fills)

    # Step 3: run the pure-function diff.
    from services.reconciliation import diff_strategy_fills

    report = diff_strategy_fills(
        strategy_id=strategy_id,
        date_range=(since, now),
        exchange_fills=exchange_fills,
        db_fills=db_fills,
    )

    # Step 4: UPSERT the report row.
    def _upsert_report() -> None:
        ctx.supabase.table("reconciliation_reports").upsert(
            {
                "strategy_id": report.strategy_id,
                "report_date": report.report_date,
                "status": report.status,
                "discrepancy_count": report.discrepancy_count,
                "discrepancies": report.discrepancies,
            },
            on_conflict="strategy_id,report_date",
        ).execute()

    await db_execute(_upsert_report)
    logger.info(
        "reconcile_strategy: strategy=%s status=%s count=%d",
        strategy_id, report.status, report.discrepancy_count,
    )

    # Sprint 6 Task 7.1b — audit the reconcile run. user_id is the
    # strategy owner (strategies.user_id); entity is the strategy being
    # reconciled.
    #
    # H-0683 / H-0685 / M-0669: db_execute does NOT catch the underlying
    # PostgREST exception, so a transient 503 or RLS surprise on the owner
    # SELECT would propagate, abort the reconcile epilogue, and skip the
    # downstream _generate_alerts fan-out — the reconcile report row would
    # exist with no alerts and no audit row. Wrap the owner lookup itself
    # so the "best-effort" contract in the comment matches the code.
    #
    # When owner_id is unresolvable (deleted strategy, transient blip),
    # emit a logger.warning with an `audit_owner_lookup_failed=true` tag
    # so on-call has a searchable signature; the alerting fan-out below
    # still runs so the report is not lost.
    def _load_strategy_owner() -> str | None:
        res = (
            ctx.supabase.table("strategies")
            .select("user_id")
            .eq("id", strategy_id)
            .maybe_single()
            .execute()
        )
        return (res.data or {}).get("user_id") if res.data else None

    owner_id: str | None = None
    try:
        owner_id = await db_execute(_load_strategy_owner)
    except Exception as owner_exc:  # noqa: BLE001
        logger.warning(
            "reconcile_strategy: audit_owner_lookup_failed=true strategy=%s "
            "exc=%s — audit event will be dropped, alert fan-out continues",
            strategy_id, owner_exc,
        )

    if owner_id:
        # Mirror the owner-lookup guard above: log_audit_event re-raises on
        # permission_denied / unknown exception classes per the
        # audit-2026-05-07 P907 contract. A bare call here would propagate
        # past the alert fan-out below — the reconcile_reports row has
        # already been upserted, so the report would exist with no alerts
        # and the worker would classify the audit error as the job
        # failure. Make the audit emit best-effort so step 5's alert
        # generation always runs.
        try:
            log_audit_event(
                user_id=owner_id,
                action="reconcile.compare",
                entity_type="reconcile_run",
                entity_id=strategy_id,
                metadata={
                    "status": report.status,
                    "discrepancy_count": report.discrepancy_count,
                },
            )
        except Exception as audit_exc:  # noqa: BLE001
            logger.warning(
                "reconcile_strategy: audit emit reconcile.compare failed "
                "strategy=%s exc=%s — alert fan-out continues",
                strategy_id, audit_exc,
            )
    else:
        # M-0669: explicit observability for the orphan-strategy /
        # owner-lookup-failed case. The comment used to normalize the drop;
        # the warning now makes it visible to forensic searches.
        logger.warning(
            "reconcile_strategy: reconcile.compare audit dropped — "
            "strategy=%s owner_id=None (strategy deleted or owner lookup "
            "skipped); report row already upserted, alert fan-out continues",
            strategy_id,
        )

    # Step 5: fan out `sync_failure` alerts to every portfolio that holds
    # this strategy. Skip on clean. We follow the select-then-insert
    # pattern from routers/portfolio.py:_generate_alerts — PostgREST
    # cannot reference migration 042's partial unique index in its
    # ON CONFLICT clause, but the index itself provides race-safe dedup.
    if report.status == "clean":
        return DispatchResult(outcome=DispatchOutcome.DONE)

    def _load_strategy_name() -> str:
        res = (
            ctx.supabase.table("strategies")
            .select("name")
            .eq("id", strategy_id)
            .maybe_single()
            .execute()
        )
        return (res.data or {}).get("name") or "Strategy"

    def _load_portfolio_ids() -> list[str]:
        res = (
            ctx.supabase.table("portfolio_strategies")
            .select("portfolio_id")
            .eq("strategy_id", strategy_id)
            .execute()
        )
        return [r["portfolio_id"] for r in (res.data or []) if r.get("portfolio_id")]

    strategy_name = await db_execute(_load_strategy_name)
    portfolio_ids = await db_execute(_load_portfolio_ids)

    severity = (
        "critical"
        if report.status == "needs_manual_review" or report.discrepancy_count > 5
        else "high"
    )
    message = (
        f"Strategy {strategy_name} has {report.discrepancy_count} unreconciled "
        f"fills for {report.report_date}."
    )

    if not portfolio_ids:
        return DispatchResult(outcome=DispatchOutcome.DONE)

    # Batch the fan-out: one SELECT for every existing unacked sync_failure
    # alert across the candidate portfolios, then a single bulk INSERT for
    # the never-seen-before set. Escalation (existing severity < new) still
    # loops one UPDATE per row because PostgREST can't express N different
    # update payloads in a single statement; in practice escalations are
    # rare so the per-row UPDATE is acceptable.
    def _load_existing_alerts() -> dict[str, dict]:
        res = (
            ctx.supabase.table("portfolio_alerts")
            .select("id, portfolio_id, severity")
            .in_("portfolio_id", portfolio_ids)
            .eq("alert_type", "sync_failure")
            .is_("acknowledged_at", "null")
            .execute()
        )
        return {r["portfolio_id"]: r for r in (res.data or [])}

    existing_by_portfolio = await db_execute(_load_existing_alerts)

    new_severity_rank = SEVERITY_RANK.get(severity, 1)
    metadata = {
        "strategy_id": strategy_id,
        "report_date": report.report_date,
        "discrepancy_count": report.discrepancy_count,
        "status": report.status,
    }

    inserts: list[dict] = []
    escalations: list[dict] = []
    for portfolio_id in portfolio_ids:
        existing = existing_by_portfolio.get(portfolio_id)
        if existing is None:
            inserts.append({
                "portfolio_id": portfolio_id,
                "alert_type": "sync_failure",
                "severity": severity,
                "message": message,
                "metadata": metadata,
            })
        elif new_severity_rank > SEVERITY_RANK.get(existing.get("severity", "medium"), 1):
            escalations.append(existing)
        # else: existing alert at >= severity → skip silently.

    if inserts:
        def _bulk_insert() -> None:
            ctx.supabase.table("portfolio_alerts").insert(inserts).execute()
        try:
            await db_execute(_bulk_insert)
        except Exception as exc:  # noqa: BLE001
            # Narrow swallow: the partial unique index can race two
            # parallel reconcile runs. Anything else must surface so the
            # worker classifies + retries.
            code = getattr(exc, "code", None)
            msg = str(exc)
            if code == "23505" or "23505" in msg or "duplicate key" in msg.lower():
                logger.warning(
                    "reconcile_strategy: dedup race on bulk sync_failure insert "
                    "(strategy %s, %d rows): %s",
                    strategy_id, len(inserts), exc,
                )
            else:
                logger.error(
                    "reconcile_strategy: bulk sync_failure insert failed "
                    "(strategy %s): %s",
                    strategy_id, exc,
                )
                raise

    if escalations:
        triggered_at = datetime.now(timezone.utc).isoformat()
        update_payload = {
            "severity": severity,
            "message": message,
            "triggered_at": triggered_at,
        }
        for row in escalations:
            def _update(rid=row["id"]) -> None:
                ctx.supabase.table("portfolio_alerts").update(
                    update_payload
                ).eq("id", rid).execute()
            await db_execute(_update)

    return DispatchResult(outcome=DispatchOutcome.DONE)


async def run_compute_intro_snapshot_job(job: dict) -> DispatchResult:
    """Compute the allocator-portfolio snapshot for a contact_request.

    Triggered by /api/intro when its 2s synchronous budget expires: the
    route inserts the contact_requests row with snapshot_status='pending'
    and enqueues this job carrying contact_request_id in metadata. The
    strategy_id on the job row is the intro target (required by the
    kind_target_coherence CHECK); the snapshot itself is keyed on the
    allocator_id we look up from contact_requests.

    Pure DB — no exchange I/O, no circuit breaker, no credential decrypt.
    The inputs are portfolios / portfolio_strategies / portfolio_analytics
    / strategy_analytics / portfolio_alerts, all of which live in Postgres.

    On success: UPDATE contact_requests SET portfolio_snapshot=<json>,
    snapshot_status='ready'. On permanent failure (missing row, schema
    drift): UPDATE snapshot_status='failed' and return permanent. On
    transient (DB blip): raise so the retry path kicks in.

    Shape matches src/lib/intro/snapshot.ts computePortfolioSnapshot —
    the TS and Python writers must produce the same JSON shape so the
    admin UI renders both paths identically.
    """
    metadata = job.get("metadata") or {}
    contact_request_id = metadata.get("contact_request_id")
    if not contact_request_id:
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message="run_compute_intro_snapshot_job: contact_request_id missing from metadata",
            error_kind="permanent",
        )

    supabase = get_supabase()

    def _load_contact_request() -> dict | None:
        res = (
            supabase.table("contact_requests")
            .select("id, allocator_id, strategy_id")
            .eq("id", contact_request_id)
            .maybe_single()
            .execute()
        )
        return res.data

    cr = await db_execute(_load_contact_request)
    if not cr:
        # The contact_request was deleted before we could compute. Nothing
        # to update — mark permanent so the job doesn't retry forever.
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message=f"contact_request {contact_request_id} not found",
            error_kind="permanent",
        )

    allocator_id = cr["allocator_id"]

    # Primary portfolio = most recently created for this allocator.
    def _load_portfolio() -> dict | None:
        res = (
            supabase.table("portfolios")
            .select("id")
            .eq("user_id", allocator_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        return rows[0] if rows else None

    portfolio = await db_execute(_load_portfolio)

    snapshot: dict = {
        "sharpe": None,
        "max_drawdown": None,
        "concentration": None,
        "top_3_strategies": [],
        "bottom_3_strategies": [],
        "alerts_last_7d": 0,
    }

    if portfolio:
        portfolio_id = portfolio["id"]

        def _load_portfolio_analytics() -> dict | None:
            res = (
                supabase.table("portfolio_analytics")
                .select("portfolio_sharpe, portfolio_max_drawdown")
                .eq("portfolio_id", portfolio_id)
                .order("computed_at", desc=True)
                .limit(1)
                .execute()
            )
            rows = res.data or []
            return rows[0] if rows else None

        analytics = await db_execute(_load_portfolio_analytics)
        if analytics:
            snapshot["sharpe"] = analytics.get("portfolio_sharpe")
            snapshot["max_drawdown"] = analytics.get("portfolio_max_drawdown")

        # Strategy links + names
        def _load_links() -> list[dict]:
            res = (
                supabase.table("portfolio_strategies")
                .select(
                    "strategy_id, current_weight, allocated_amount, "
                    "strategies(id, name)"
                )
                .eq("portfolio_id", portfolio_id)
                .execute()
            )
            return list(res.data or [])

        links = await db_execute(_load_links)

        # Per-strategy sharpe lookup (single query rather than N+1).
        strategy_ids = [l["strategy_id"] for l in links if l.get("strategy_id")]
        sharpe_map: dict[str, float | None] = {}
        if strategy_ids:
            def _load_strategy_sharpes() -> list[dict]:
                res = (
                    supabase.table("strategy_analytics")
                    .select("strategy_id, sharpe")
                    .in_("strategy_id", strategy_ids)
                    .execute()
                )
                return list(res.data or [])

            sharpe_rows = await db_execute(_load_strategy_sharpes)
            for row in sharpe_rows:
                sharpe_map[row["strategy_id"]] = row.get("sharpe")

        # Concentration (HHI): prefer current_weight, fall back to allocated_amount.
        weights = [
            l.get("current_weight") for l in links
            if isinstance(l.get("current_weight"), (int, float))
        ]
        if len(weights) == len(links) and len(weights) > 0:
            total = sum(weights)
            if total > 0:
                snapshot["concentration"] = sum((w / total) ** 2 for w in weights)
        else:
            amounts = [
                l.get("allocated_amount") for l in links
                if isinstance(l.get("allocated_amount"), (int, float))
                and l.get("allocated_amount") > 0
            ]
            if amounts:
                total = sum(amounts)
                snapshot["concentration"] = sum((a / total) ** 2 for a in amounts)

        # Rank by sharpe for top/bottom 3 (strategies without a sharpe are
        # excluded — a NULL ranking tells the manager nothing).
        ranked = []
        for l in links:
            sid = l.get("strategy_id")
            strat = l.get("strategies") or {}
            name = strat.get("name") if isinstance(strat, dict) else None
            sh = sharpe_map.get(sid)
            if sh is not None:
                ranked.append({
                    "strategy_id": sid,
                    "strategy_name": name or "Unnamed strategy",
                    "sharpe": sh,
                })
        ranked.sort(key=lambda r: r["sharpe"] or 0.0, reverse=True)
        snapshot["top_3_strategies"] = ranked[:3]
        # Bottom 3: slice the tail, reverse so worst is first.
        tail = ranked[-3:] if len(ranked) >= 3 else list(ranked)
        snapshot["bottom_3_strategies"] = list(reversed(tail)) if tail else []

        # Alerts last 7d
        seven_days_ago = (
            datetime.now(timezone.utc) - timedelta(days=7)
        ).isoformat()

        def _count_alerts() -> int:
            res = (
                supabase.table("portfolio_alerts")
                .select("id", count="exact")
                .eq("portfolio_id", portfolio_id)
                .gte("triggered_at", seven_days_ago)
                .execute()
            )
            # supabase-py returns count on res.count for 'exact'.
            return int(res.count or 0)

        snapshot["alerts_last_7d"] = await db_execute(_count_alerts)

    # Write back: portfolio_snapshot + snapshot_status='ready'.
    def _write_snapshot() -> None:
        supabase.table("contact_requests").update({
            "portfolio_snapshot": snapshot,
            "snapshot_status": "ready",
        }).eq("id", contact_request_id).execute()

    await db_execute(_write_snapshot)
    logger.info(
        "compute_intro_snapshot: wrote snapshot for contact_request %s (allocator %s)",
        contact_request_id, allocator_id,
    )
    return DispatchResult(outcome=DispatchOutcome.DONE)


async def _mark_intro_snapshot_failed(job: dict) -> None:
    """On permanent handler failure, set snapshot_status='failed' so the
    admin UI doesn't show a stale 'pending' forever. Best-effort; if
    this itself fails we log and move on."""
    metadata = job.get("metadata") or {}
    contact_request_id = metadata.get("contact_request_id")
    if not contact_request_id:
        return
    try:
        supabase = get_supabase()

        def _mark() -> None:
            supabase.table("contact_requests").update({
                "snapshot_status": "failed",
            }).eq("id", contact_request_id).execute()

        await db_execute(_mark)
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "Failed to mark contact_request %s snapshot_status='failed': %s",
            contact_request_id, exc,
        )


async def run_rescore_allocator_job(job: dict) -> DispatchResult:
    """Phase 3 / D-12 Option B — Dispatch handler for allocator-scoped
    rescore jobs enqueued by update_allocator_mandates RPC. Calls
    _score_one_allocator to produce a fresh v2.0.0 batch.

    The enqueue itself signals intent — no force flag is needed.
    _should_skip_allocator already returned False (mandate_edited_at >
    last computed_at triggered the enqueue). _score_one_allocator does
    not accept a force parameter; the skip gate fires only in the HTTP
    entry path and the daily cron's enqueue phase.

    NOTE: If a future refactor pushes _should_skip_allocator INTO
    _score_one_allocator, this handler MUST pass force=True so proactive
    rescore jobs don't silently no-op.
    """
    # Deferred import to avoid circular dependency — routers/match.py
    # imports from services.match_engine, which is a peer of services.job_worker.
    from routers.match import _load_candidate_universe, _score_one_allocator

    allocator_id = job.get("allocator_id")
    if not allocator_id:
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_kind="permanent",
            error_message="rescore_allocator job missing allocator_id — check migration 062 kind_target_coherence",
        )

    universe = await asyncio.to_thread(_load_candidate_universe)
    if not universe["strategies_by_id"]:
        # No eligible strategies — no-op success (not a failure).
        # Mirrors routers/match.cron_recompute's empty_universe short-circuit.
        return DispatchResult(outcome=DispatchOutcome.DONE)

    try:
        await _score_one_allocator(allocator_id, universe)
    except Exception as exc:  # noqa: BLE001
        # H-0682: previously hardcoded `error_kind='transient'` for every
        # exception — meaning KeyError on bad mandate, AssertionError on
        # renormalize, ValidationError on corrupt scoring_weight_overrides,
        # schema-drift TypeError all retried forever. Permanent bugs
        # repeatedly reloaded the full universe scan (~30k strategies),
        # saturating _scoring_semaphore and DoS-ing daily cron for all
        # allocators. Delegate to classify_exception so the standard 3-way
        # classifier decides — ccxt/network → transient, BadRequest/auth →
        # permanent, generic Python errors → unknown (still retried, but
        # the admin UI flags them for human triage instead of silent
        # infinite-loop).
        logger.exception("run_rescore_allocator_job failed for allocator=%s", allocator_id)
        error_kind, sanitized = classify_exception(exc)
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_kind=error_kind,
            error_message=f"rescore failed: {sanitized}",
        )

    return DispatchResult(outcome=DispatchOutcome.DONE)


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------


async def dispatch(job: dict) -> DispatchResult:
    """Route a claimed job to its per-kind handler, wrap in timeout, classify.

    After the handler resolves (or raises) and before returning, strategy-
    scoped jobs call the UI status bridge so strategy_analytics.computation_status
    reflects the new compute_jobs aggregate. Portfolio-scoped jobs skip
    the bridge (there is no strategy_analytics row to update).

    Handler lookup is done via if/elif rather than a dict so that
    monkeypatching the module-level run_*_job functions in tests works
    correctly (a dict captures references at import time, defeating mocks).
    """
    kind = job.get("kind")
    timeout = TIMEOUT_PER_KIND.get(kind, 5 * 60)

    if kind == "sync_trades":
        handler = run_sync_trades_job
    elif kind == "compute_analytics":
        handler = run_compute_analytics_job
    elif kind == "compute_portfolio":
        handler = run_compute_portfolio_job
    elif kind == "poll_positions":
        handler = run_poll_positions_job
    elif kind == "sync_funding":
        handler = run_sync_funding_job
    elif kind == "reconcile_strategy":
        handler = run_reconcile_strategy_job
    elif kind == "compute_intro_snapshot":
        handler = run_compute_intro_snapshot_job
    elif kind == "rescore_allocator":
        handler = run_rescore_allocator_job
    elif kind == "poll_allocator_positions":
        handler = run_poll_allocator_positions_job
    elif kind == "reconstruct_allocator_history":
        from services.equity_reconstruction import run_reconstruct_allocator_history_job
        handler = run_reconstruct_allocator_history_job
    elif kind == "refresh_allocator_equity_daily":
        from services.equity_reconstruction import run_refresh_allocator_equity_daily_job
        handler = run_refresh_allocator_equity_daily_job
    elif kind == "process_key_long":
        # Phase 19 / BACKBONE-09 — long-fetch worker handler. Lazy import
        # mirrors the equity_reconstruction pattern above; the
        # services.ingestion package depends on services.exchange which we
        # don't want to load on workers that never see this kind.
        from services.ingestion.long_fetch import run_process_key_long_job
        handler = run_process_key_long_job
    else:
        handler = None

    try:
        if handler is None:
            # Unknown kind — permanent failure so the DB row goes straight
            # to failed_final. Prevents a future new-kind insert from
            # retry-looping against an older worker that doesn't know about it.
            result = DispatchResult(
                outcome=DispatchOutcome.FAILED,
                error_message=f"Unknown job kind: {kind!r}",
                error_kind="permanent",
            )
        else:
            result = await asyncio.wait_for(handler(job), timeout=timeout)
    except Exception as exc:  # noqa: BLE001
        error_kind, sanitized = classify_exception(exc)
        result = DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message=sanitized,
            error_kind=error_kind,
        )

    # On permanent failure of a compute_intro_snapshot job, mark the
    # contact_request snapshot_status='failed' so /admin/intros doesn't
    # show 'pending' indefinitely. Skipped on transient (those will retry).
    if (
        kind == "compute_intro_snapshot"
        and result.outcome == DispatchOutcome.FAILED
        and result.error_kind == "permanent"
    ):
        await _mark_intro_snapshot_failed(job)

    # UI status bridge: after every strategy-scoped job, derive the UI
    # status from the compute_jobs aggregate and write it into
    # strategy_analytics.computation_status. Portfolio jobs skip the bridge.
    strategy_id = job.get("strategy_id")
    if strategy_id:
        try:
            await sync_strategy_analytics_status(strategy_id)
        except Exception as exc:  # noqa: BLE001
            # The status bridge is best-effort — a failure here does NOT
            # change the job's outcome. Log and move on.
            logger.warning(
                "sync_strategy_analytics_status failed for strategy %s: %s",
                strategy_id,
                exc,
            )

    return result
