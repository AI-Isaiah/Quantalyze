"""Shared dispatcher for the durable compute_jobs queue worker.

Called by main_worker.py's dispatch loop. One public entrypoint —
`dispatch(job)` — which routes by job['kind'] to a per-kind handler,
wraps each handler in an asyncio.wait_for timeout, classifies any
exception into (error_kind, sanitized message), and always (on strategy-
scoped jobs) updates the UI status bridge before returning.

Supported kinds:
  sync_trades            -> run_sync_trades_job             (15-minute timeout)
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
poll_positions, check the per-exchange cooldown window (Binance 120s,
OKX 300s, Bybit 600s). NEW-C12-10: the remaining cooldown is computed
SERVER-SIDE via the api_key_cooldown_remaining RPC (now() - last_429_at
both on the DB clock) so a stamp written by one Railway replica and the
check on another compare against ONE clock — no cross-container wall-clock
skew. If remaining > 0, call defer_compute_job and return
DispatchResult(outcome=DEFERRED).

On 429 (ccxt.RateLimitExceeded), stamp api_keys.last_429_at via the
stamp_api_key_429 RPC (DB clock) before classifying as transient. This
feeds the circuit breaker so subsequent jobs for the same API key defer
instead of hammering the exchange.
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import TYPE_CHECKING, Any, Final, Literal, cast

import ccxt
from cryptography.fernet import InvalidToken
from fastapi import HTTPException
# APIResponse is the documented return type of a PostgREST builder's
# `.execute()`; CountMethod is the StrEnum the `.select(count=...)` kwarg expects
# (a bare "exact" string is rejected under --strict). Pin the submodule paths
# (mirroring services/db.py): the postgrest package root does NOT re-export these
# on every version (CI's postgrest lacks `CountMethod` at the root), so a root
# import fails loudly at collection time on a postgrest pin bump.
from postgrest.base_request_builder import APIResponse
from postgrest.types import CountMethod
from supabase import Client

if TYPE_CHECKING:
    # Phase 104: the post-branch cash-series persist reads denominator_config
    # UNCONDITIONALLY (initialized at the branch-outer scope like mtm_returns), so
    # the outer-scope default needs the type name — imported type-only to avoid a
    # runtime import (the value is still parsed function-locally in the deribit arm).
    from services.allocated_capital import ReturnsDenominatorConfig

    # SFOX-05: pandas is imported lazily inside functions at runtime; the
    # `-> "pd.Series"` return annotation needs the name resolvable under mypy.
    import pandas as pd

from services.analytics_status import sync_strategy_analytics_status
from services.audit import log_audit_event
from services.geo_block import is_geo_blocked
from services.closed_sets import (  # B8b: single-sourced closed sets, re-exported
    CRYPTO_VENUES,
    SFOX_DISABLED_DETAIL,
    PositionDirection as PositionDirection,
    Side as Side,
    sfox_enabled_server,
)
from services.db import db_execute, get_supabase, one, rows
from services.encryption import decrypt_credentials, get_kek
from services.exchange import (
    aclose_exchange,
    create_exchange,
    fetch_all_trades,
    fetch_raw_trades,
    fetch_usdt_balance,
    get_and_clear_last_dq_flags,
    parse_since_ms,
)
from services.positions import fetch_positions, persist_position_snapshots
from services.sfox_client import SfoxClient  # type annotations only
from services.sfox_factory import make_sfox_client
from services.sfox_read import sfox_transactions_crawl_wallclock_budget_s


# ---------------------------------------------------------------------------
# Type aliases — G12.A.3
# ---------------------------------------------------------------------------
# Fill side ('buy'/'sell') and position direction ('long'/'short') were
# previously conflated as bare `str` throughout the worker / runner. The
# audit (G12.A.3, conf=10) flagged that downstream code branches on
# `'buy'/'sell'/'long'/'short'` interchangeably and `_compute_volume_metrics`
# historically aliased `long_volume_pct = buy_pct` — wrong for hedge-mode
# shorts opened via 'sell'. Migration 112 enforces the DB-side CHECK.
# B8b: `Side` / `PositionDirection` are now single-sourced from
# `services.closed_sets` (imported + re-exported above) so the type-layer
# distinction can't drift from the SQL one.

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

# M-1128: name the 4-tuple of partition columns that the claim RPCs dedupe
# by. The four columns mirror the partial unique indices
# `compute_jobs_one_inflight_per_kind_<col>` and the four
# `row_number() OVER (PARTITION BY kind, <col>)` clauses in
# `claim_compute_jobs` + `claim_compute_jobs_with_priority` (see migration
# 090 + the H-1235/H-1238/M-1133 hardening migration). Adding a 5th
# partition column (e.g. workspace_id) must touch BOTH this tuple AND the
# SQL — the test in tests/test_compute_jobs_fencing.py parses the SQL
# directly so the change is deliberate.
PARTITION_COLUMNS: Final[tuple[str, ...]] = (
    "portfolio_id",
    "strategy_id",
    "allocator_id",
    "api_key_id",
)

# M-0673: Feature flag is read once at module import — re-reading per job
# can produce rollout-window inconsistency (workers spawned mid-deploy with
# different env values processing different jobs differently). Tests can
# still flip behavior via monkeypatch on this module attribute.
_RAW_TRADE_INGESTION_ENABLED: Final[bool] = (
    os.environ.get("USE_RAW_TRADE_INGESTION", "false").lower() == "true"
)

# NEW-C12-05 (CL12): claim-token fence on the sync_trades epilogue cursor
# write (advance_sync_cursor RPC, migration 20260602173710). Defaults ON —
# the migration's back-compat NULL-token arm + the per-column monotonic
# guards make the fence safe to ship live, and an orphan write only drops
# when the watchdog genuinely reclaimed the job mid-epilogue. Set
# WORKER_FENCE_V2=false in the Railway worker env as an instant kill-switch:
# the worker then threads p_claim_token=NULL, the RPC's back-compat arm
# writes unconditionally, and behaviour is identical to pre-fence. Read once
# at import (same M-0673 rollout-window rationale as the flag above);
# tests flip it via monkeypatch on this module attribute.
WORKER_FENCE_V2: Final[bool] = (
    os.environ.get("WORKER_FENCE_V2", "true").lower() != "false"
)

# C2 (P70 review): a Deribit account holding more than this USD equity but
# producing ZERO return-bearing ledger rows is treated as a silently-empty ledger
# (fail loud), not "insufficient history". Above dust, below any real balance.
# The floor is VENUE-AGNOSTIC (also the sFOX material-balance analog, SFOX-05):
# any broker account holding >$100 but producing <2 usable NAV days is a
# silently-empty (green) track record, never genuine "insufficient history".
_DERIBIT_EMPTY_LEDGER_FLOOR_USD: Final[float] = 100.0

# ── FLIPRETRY-01 per-crawl wall-clock bounds, sized UNDER the outer budget ──
# derive_broker_dailies runs under a FIXED outer wait_for =
# TIMEOUT_PER_KIND["derive_broker_dailies"] (900s / 15 min; mirrored here because
# that dict is defined below — a parity test pins the two equal). A per-crawl bound
# converts a single hung LIVE crawl into a CLASSIFIED transient (the v1.11 FLIP
# wedge guard) — but it MUST NOT be tighter than the crawl's LEGITIMATE duration,
# or it just manufactures a false transient → infinite retry → failed_final (the
# exact failure the sfox-txn bound was raised to avoid, and the one the red team
# found the earlier flat-300s bounds re-created for OKX/bybit/deribit large
# accounts whose real crawls run many minutes). The outer wait_for + the
# FLIPRETRY-04 healthz heartbeat remain the real MULTI-crawl / true-wedge backstop;
# per-crawl bounds add single-crawl attribution and catch a lone hang just before
# the outer. Invariant (asserted by test): bh + txn + reserve ≤ outer.
_DERIVE_OUTER_BUDGET_S: Final[float] = 900.0  # == TIMEOUT_PER_KIND["derive_broker_dailies"]
# Reserve for the post-crawl PURE combine + derive_basis_series + persist (+ the
# preflight) that run inside the SAME outer budget after the serial crawls finish.
_DERIVE_POST_CRAWL_RESERVE_S: Final[float] = 90.0

# sfox balance-history: 50 daily windows × ~1s rate ≈ 50-80s real — a small hang
# guard, NOT the 300s the txn crawl needs (keeping it small preserves headroom for
# the txn crawl + reserve under the outer).
_SFOX_CRAWL_TIMEOUT_S: Final[float] = float(os.getenv("SFOX_CRAWL_TIMEOUT_S", "120"))

# sfox transactions: /v1/account/transactions is rate-gated at 10s/request, so the
# 50-page budget legitimately needs ~600-660s (rate + response latency; the 300s
# balance-history bound would false-time-out a >30-page ledger). Sized from the
# owning module's budget, then CAPPED so bh + txn + reserve ≤ the outer budget (the
# serial-sum-vs-outer invariant — a bound the account can pass while the OUTER
# wait_for still kills the job mid-persist is no fix at all).
_SFOX_TXN_CRAWL_TIMEOUT_S: Final[float] = float(
    os.getenv(
        "SFOX_TXN_CRAWL_TIMEOUT_S",
        str(min(
            sfox_transactions_crawl_wallclock_budget_s(),
            _DERIVE_OUTER_BUDGET_S - _SFOX_CRAWL_TIMEOUT_S - _DERIVE_POST_CRAWL_RESERVE_S,
        )),
    )
)

# deribit + ccxt crawls (full-history paginated: OKX/Binance inception, bybit 19k,
# deribit native ledger ~inception). Their LEGITIMATE durations reach many minutes
# — the v1.11 incident measured ~12 min — so the bound is sized at the outer
# envelope MINUS the post-crawl reserve, NOT a flat 300s that would convert those
# succeeding-under-the-outer accounts into deterministic false transients. A lone
# hung crawl is still caught (at ~reserve before the outer, with attribution); the
# outer + heartbeat catch the multi-crawl / true-wedge case.
_BROKER_CRAWL_TIMEOUT_S: Final[float] = float(
    os.getenv(
        "BROKER_CRAWL_TIMEOUT_S",
        str(_DERIVE_OUTER_BUDGET_S - _DERIVE_POST_CRAWL_RESERVE_S),
    )
)

# A1 (docs-silent depth): request the sfox history crawls from a far-past epoch
# so they reach empirical inception; the earliest returned point IS the
# inception (the crawl surfaces it, an earlier-than-requested start is never an
# error). 2015-01-01T00:00:00Z in epoch-ms — comfortably before sFOX existed.
_SFOX_FAR_PAST_EPOCH_MS: Final[int] = 1_420_070_400_000

# The venues whose daily-return series are produced NATIVELY inside the venue
# dispatch (deribit: combine_native_ledger; sfox: combine_sfox_balance_history)
# rather than by the ccxt USD-space combine_realized_and_funding pass below. The
# :2645 guard excludes these so the ccxt combine never OVERWRITES a native
# returns/meta with an empty realized/funding stream. Adding sfox here is the
# money-critical fix (SFOX-05): without it, combine_realized_and_funding runs on
# empty streams and clobbers the reconstructed sfox TWR. deribit stays byte
# -identical (it was, and remains, excluded).
_NATIVE_RETURNS_VENUES: Final[frozenset[str]] = frozenset({"deribit", "sfox"})

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
    "compute_analytics_from_csv": 10 * 60,   # Phase 19.1 — pure math, no exchange I/O
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
    "derive_broker_dailies": 15 * 60,  # full-history realized PnL + funding fetch (mirrors sync_trades envelope)
    "stitch_composite": 20 * 60,  # Phase 86 / COMP-02 — N-member fan-out (worst case 2× crawl per key when MTM open)
    "derive_allocator_equity": 5 * 60,  # Phase 115.1 / RD-3 Option B — pure DB + math, no exchange I/O (5 min < 10 min watchdog floor → no override needed)
}

# FIX-2 (Fable): the single-key MTM SECOND pass is a FULL-HISTORY crawl that runs
# INSIDE the same derive_broker_dailies budget as the cash pass. Bound it to a
# fraction of the REMAINING budget (never a blind global ceiling bump, which would
# also relax perp-only/ccxt derives and mask real hangs) so it can never push the
# whole derive past the outer wait_for into a silent transient→failed_final — which
# would ALSO sink the healthy cash headline. If too little budget remains to
# plausibly finish, the pass is skipped and DEGRADED loudly. Options books only.
_MTM_SECOND_PASS_BUDGET_FRACTION = 0.7
_MTM_SECOND_PASS_MIN_SECONDS = 60.0


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

    # Egress-region geo-block (CloudFront 403 "blocked from your country" /
    # Binance 451 "restricted location"). MUST be checked BEFORE the ccxt
    # hierarchy below: Bybit's CloudFront 403 is non-JSON, so ccxt mis-maps it
    # to RateLimitExceeded — which the NetworkError check would classify
    # "transient" and retry forever (re-hammering a host that will never answer
    # from this region) while stamping a phantom 429 cooldown. It is PERMANENT
    # from the current worker egress; surface an operator-actionable message so
    # the fix (move the worker region / proxy) is obvious, not a phantom rate
    # limit. Reuses the "permanent" kind (no compute_jobs.error_kind CHECK
    # migration needed).
    if is_geo_blocked(exc):
        return (
            "permanent",
            f"Exchange geo-blocked from worker egress region "
            f"(CloudFront/451 — move region or proxy): {str(exc)[:400]}",
        )

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
    supabase: Client, strategy_id: str
) -> tuple[dict[str, Any] | None, dict[str, Any] | None, str | None]:
    """Load strategy row and its api_key row. Returns (strategy, key_row, error_msg).

    On success, error_msg is None. On failure, strategy and key_row may be
    None and error_msg explains why.
    """
    def _load_strategy() -> dict[str, Any] | None:
        res = (
            supabase.table("strategies")
            .select("id, user_id, api_key_id, asset_class, returns_denominator_config")
            .eq("id", strategy_id)
            .maybe_single()
            .execute()
        )
        return one(res)

    strategy_row = await db_execute(_load_strategy)
    if not strategy_row or not strategy_row.get("api_key_id"):
        return None, None, "Strategy has no connected API key"

    def _load_key() -> dict[str, Any] | None:
        res = (
            supabase.table("api_keys")
            .select("*")
            .eq("id", strategy_row["api_key_id"])
            .maybe_single()
            .execute()
        )
        return one(res)

    key_row = await db_execute(_load_key)
    if not key_row:
        return strategy_row, None, "API key not found"

    if key_row.get("user_id") != strategy_row.get("user_id"):
        return strategy_row, key_row, "API key does not belong to strategy owner"

    return strategy_row, key_row, None


def _defer_lost_ownership(exc: Exception) -> bool:
    """True when a defer_compute_job call failed because THIS worker no longer
    owns the job. NEW-C12-06 fenced defer_compute_job on claim_token: a
    watchdog reclaim + re-claim under a fresh token makes defer raise
    serialization_failure (SQLSTATE 40001, message 'preempted by watchdog
    reclaim'); a row that is no longer 'running' raises no_data_found
    (message 'not found or not running'). Either way the job belongs to
    another worker now and must be yielded (DEFERRED), not failed/retried with
    a stale token. Matched by SQLSTATE when PostgREST surfaces it, else by the
    RPC's own RAISE-message text. Kept local to avoid a circular import with
    main_worker (which imports this module)."""
    if getattr(exc, "code", None) == "40001":  # serialization_failure
        return True
    msg = str(exc).lower()
    return (
        "preempted by watchdog reclaim" in msg
        or "not found or not running" in msg
    )


async def _check_circuit_breaker(
    supabase: Client, job: dict[str, Any], key_row: dict[str, Any]
) -> DispatchResult | None:
    """Check circuit breaker: if api_key has a recent 429, defer the job.

    Returns a DEFERRED DispatchResult if the job should be deferred, or
    None if the circuit breaker is not tripped (proceed normally).

    NEW-C12-10: the remaining cooldown is computed SERVER-SIDE via the
    api_key_cooldown_remaining RPC, which evaluates now() - last_429_at
    entirely on the DB clock. Because the stamp (stamp_api_key_429) and this
    check both reference the single DB clock, a stamp written by one Railway
    replica and a check on another are no longer compared across two
    wall clocks — the skew window where the breaker released early into a
    429 storm is eliminated. Once the fast path below is passed (the snapshot
    already shows a stamp), the RPC re-reads the freshest last_429_at, so a
    newer stamp on another replica is not masked by the stale snapshot. (When
    the snapshot's last_429_at is NULL the fast path returns early without the
    RPC — identical to the pre-fix behavior; a stamp landing on another replica
    after this job's key_row was loaded is first seen on the next dispatch.)
    """
    # Fast path: the per-job key_row snapshot (loaded fresh at dispatch) has
    # no stamp → no cooldown to evaluate, skip the RPC round-trip. The RPC
    # below re-reads last_429_at authoritatively for the case that matters.
    if not key_row.get("last_429_at"):
        return None

    exchange_name = key_row.get("exchange", "")
    cooldown = EXCHANGE_COOLDOWNS.get(exchange_name, 120)

    def _cooldown_remaining() -> APIResponse:
        # Boundary re-assertion: supabase 2.15.1 types Client.rpc() as Any, so
        # `.execute()` statically yields Any. Re-assert the genuine runtime
        # APIResponse here (the same stub-gap bridge services/db.py applies
        # in rows()/one()) so the consumed `res.data` read stays typed — no
        # cast, no ignore.
        resp: APIResponse = supabase.rpc("api_key_cooldown_remaining", {
            "p_api_key_id": key_row["id"],
            "p_cooldown_seconds": cooldown,
        }).execute()
        return resp

    try:
        res = await db_execute(_cooldown_remaining)
        # api_key_cooldown_remaining is declared to return an integer count of
        # remaining seconds; PostgREST surfaces that scalar on res.data. Narrow
        # via isinstance (a non-int means SQL contract drift — fall through to 0,
        # the same "no cooldown, proceed" outcome the old `res.data is None`
        # guard produced).
        remaining = res.data if isinstance(res.data, int) else 0
    except asyncio.CancelledError:
        raise  # never swallow cancellation — propagate to worker shutdown
    except Exception as _cd_exc:  # noqa: BLE001
        # silent-failure: log loudly. On a transient cooldown-RPC failure we
        # proceed (breaker check skipped) rather than deferring forever — a DB
        # blip must not park every job. The exchange's own rate limiter is the
        # backstop, and the next dispatch re-checks.
        logger.warning(
            "_check_circuit_breaker: api_key_cooldown_remaining RPC failed for "
            "api_key %s — proceeding without breaker check: %s",
            key_row.get("id"), _cd_exc,
        )
        return None

    if remaining <= 0:
        return None

    defer_seconds = remaining + 5  # small buffer

    def _defer() -> None:
        supabase.rpc("defer_compute_job", {
            "p_job_id": job["id"],
            "p_defer_seconds": defer_seconds,
            "p_reason": f"exchange_cooldown:{exchange_name}:{remaining}s_remaining",
            # NEW-C12-06: thread the claim token so a preempted worker cannot
            # defer a job the watchdog reclaimed and another worker re-claimed.
            "p_claim_token": job.get("claim_token"),
        }).execute()

    try:
        await db_execute(_defer)
    except asyncio.CancelledError:
        raise  # never swallow cancellation — propagate to worker shutdown
    except Exception as _defer_exc:  # noqa: BLE001
        # NEW-C12-06: defer_compute_job is now claim-token fenced. If THIS
        # worker was preempted (watchdog reclaim + another worker re-claimed
        # under a fresh token), the defer raises serialization_failure; if the
        # row is no longer running, no_data_found. In both cases this worker no
        # longer owns the job — yield it as DEFERRED (the owner will process
        # it). Owning the preemption signal HERE is the point: otherwise the
        # raw 40001 propagates to dispatch's catch-all, is classified
        # error_kind='unknown' and RETRIED, then carries our stale token into
        # mark_compute_job_failed — corruption-safe only incidentally via the
        # mig-117 mark fence. A genuine defer failure (DB down, etc.) is
        # re-raised so dispatch classifies it transient and retries.
        if _defer_lost_ownership(_defer_exc):
            logger.info(
                "Circuit-breaker defer preempted for job %s — another worker "
                "owns it after a watchdog reclaim; yielding without retry: %s",
                job["id"], _defer_exc,
            )
            return DispatchResult(outcome=DispatchOutcome.DEFERRED)
        raise

    logger.info(
        "Circuit breaker tripped for job %s (exchange=%s, %ds remaining)",
        job["id"], exchange_name, remaining,
    )
    return DispatchResult(outcome=DispatchOutcome.DEFERRED)


async def _stamp_429(
    supabase: Client, key_row: dict[str, Any], exc: BaseException
) -> None:
    """Stamp api_keys.last_429_at on a 429 response.

    Called before classify_exception returns, so subsequent jobs for the
    same API key will be deferred by the circuit breaker.

    Skips entirely for an exchange edge GEO-BLOCK (``is_geo_blocked``): Bybit's
    CloudFront 403 is mis-mapped by ccxt to ``RateLimitExceeded`` but is NOT a
    rate limit — stamping it would park every sibling job on this api_key behind
    the circuit breaker for the exchange cooldown (~10 min) even though the job
    is (correctly) classified 'permanent'. Skipping keeps the geo-block fix's
    no-phantom-cooldown promise instead of re-introducing it here.

    NEW-C12-10: stamp via the stamp_api_key_429 RPC so last_429_at is set
    from the DB clock (now()), not the stamping replica's Python wall clock.
    Paired with _check_circuit_breaker's api_key_cooldown_remaining RPC, this
    puts both the stamp and the cooldown comparison on the single DB clock —
    a stamp written by one Railway replica and a check on another no longer
    drift apart. A direct table().update() with datetime.now() would
    re-introduce the cross-container skew this RPC exists to remove.
    """
    if is_geo_blocked(exc):
        logger.info(
            "api_key %s: exchange geo-block (not a rate limit) — skipping "
            "last_429_at stamp so sibling jobs are not parked behind the "
            "circuit breaker",
            key_row.get("id"),
        )
        return

    def _stamp() -> None:
        supabase.rpc("stamp_api_key_429", {
            "p_api_key_id": key_row["id"],
        }).execute()

    try:
        await db_execute(_stamp)
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
    supabase: Client
    # strategy_row is None on the allocator path (_allocator_key_preflight),
    # which owns no strategy — only the strategy-side preflight populates it.
    strategy_row: dict[str, Any] | None
    key_row: dict[str, Any]
    # SFOX-05: sfox is a non-ccxt venue read through the GET-only SfoxClient. The
    # preflights construct that instead of a ccxt.Exchange; aclose_exchange routes
    # it to SfoxClient.aclose() at the single close chokepoint.
    exchange: ccxt.Exchange | SfoxClient


def _make_exchange_client(
    exchange_name: str,
    api_key: str,
    api_secret: str,
    passphrase: str | None,
) -> ccxt.Exchange | SfoxClient:
    """SFOX-05 — the SINGLE preflight construction chokepoint. Both
    _exchange_preflight and _allocator_key_preflight route through here, so the
    sfox-vs-ccxt decision lives in exactly ONE place.

    sFOX is NOT a ccxt exchange: create_exchange RAISES ValueError for it
    (EXCHANGE_CLASSES holds only ccxt classes). Construct the GET-only
    SfoxClient from the trimmed api_key instead. sFOX auth is a SINGLE Bearer
    token (the Q1 worker contract) — the api_secret is intentionally NEVER
    passed. The .strip() mirrors the validate/exchange-router credential
    chokepoint (a trailing-newline token must authenticate identically).

    Every ccxt venue is BYTE-IDENTICAL to the prior inline create_exchange call.
    """
    if exchange_name == "sfox":
        return make_sfox_client(api_key.strip())
    return create_exchange(exchange_name, api_key, api_secret, passphrase)


def _sfox_rows_to_usd_value_series(rows: list[dict[str, Any]]) -> "pd.Series":
    """SFOX-05 — parse sFOX balance-history rows into the daily ``usd_value`` NAV
    Series combine_sfox_balance_history consumes.

    Each row is ``{"timestamp": <epoch-ms>, "usd_value": <number|str>}``. We coerce
    to a UTC calendar-day DatetimeIndex [us] with float usd_value, FAIL LOUD
    (``SfoxFlowValuationError``) on a missing/garbage timestamp or usd_value —
    never silently coerce a bad value to 0.0 (that would fabricate NAV). On the
    rare duplicate-day row, last observation wins (the crawl advances the cursor
    past the latest point, so a boundary day can appear twice). An empty crawl
    yields an honest empty Series.
    """
    import pandas as pd

    from services.sfox_read import SfoxFlowValuationError

    if not rows:
        return pd.Series(dtype="float64", name="usd_value")

    by_day: dict[pd.Timestamp, float] = {}
    for row in rows:
        try:
            ts_ms = int(row["timestamp"])
            value = float(row["usd_value"])
        except (TypeError, ValueError, KeyError) as exc:
            raise SfoxFlowValuationError(
                "sFOX balance-history row carries no usable numeric "
                "timestamp/usd_value"
            ) from exc
        # F7 (P120 red-team): float("nan")/float("inf") SUCCEED — so a non-finite
        # usd_value would slip through as a poisoned NAV point despite the docstring
        # promising to fail loud on it (a NaN/inf NAV then silently corrupts the
        # whole TWR denominator chain). Reject it here, mirroring the ground-truth
        # _coerce_finite gate. Never coerce to 0.0 (that fabricates NAV).
        if not math.isfinite(value):
            raise SfoxFlowValuationError(
                "sFOX balance-history row carries a non-finite usd_value "
                "(NaN/Inf); refusing a poisoned NAV point"
            )
        day = pd.Timestamp(
            datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).date()
        ).as_unit("us")
        by_day[day] = value

    days = sorted(by_day)
    index = pd.DatetimeIndex(days).as_unit("us")
    return pd.Series([by_day[d] for d in days], index=index, name="usd_value")


async def _exchange_preflight(
    job: dict[str, Any], handler_name: str
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
    # _load_strategy_and_key's contract: error_msg is None iff both rows are
    # non-None. The `key_row is None` disjunct never fires independently of
    # error_msg at runtime — it is the type-level proof that lets key_row narrow
    # to dict below; the fallback message is unreachable in practice.
    if error_msg or key_row is None:
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message=error_msg or "preflight: API key row missing",
            error_kind="permanent",
        )

    defer_result = await _check_circuit_breaker(supabase, job, key_row)
    if defer_result is not None:
        return defer_result

    api_key, api_secret, passphrase = decrypt_credentials(key_row, kek)
    exchange = _make_exchange_client(
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
    job: dict[str, Any], handler_name: str
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

    def _load_key() -> dict[str, Any] | None:
        res = (
            supabase.table("api_keys")
            .select("*")
            .eq("id", api_key_id)
            .maybe_single()
            .execute()
        )
        return one(res)

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
    exchange = _make_exchange_client(
        key_row["exchange"], api_key, api_secret, passphrase
    )

    return _ExchangeContext(
        supabase=supabase,
        strategy_row=None,      # allocator path has no strategy — reuse dataclass with None
        key_row=key_row,
        exchange=exchange,
    )


# M-0670: The internal wrapper exists specifically for the api_key-anchored
# allocator event families — narrow `action` to a Literal so static checkers
# (and grep) flag any drift the moment a typo enters this call surface.
# entity_type is hard-coded to 'api_key' (the single discriminator this wrapper
# supports), so every action routed through here MUST be one whose canonical
# AUDIT_ACTION_ENTITY_TYPE_MAP entity is 'api_key'.
AllocatorHoldingsAction = Literal[
    "allocator.holdings.sync_requested",
    "allocator.holdings.sync_completed",
    "allocator.holdings.sync_failed",
    "allocator.holdings.persist_failed",
]

# services.equity_reconstruction routes its equity reconstruct/refresh audit
# events through this same wrapper (same allocator_id / api_key_id / api_key
# entity shape). Kept as a sibling Literal so the drift-detection contract above
# extends to the equity family; all members are also in services.audit.AuditAction
# and map to entity_type='api_key' (asserted cross-runtime by
# test_audit.py::test_action_literal_matches_ts_union).
AllocatorEquityAction = Literal[
    "allocator.equity.reconstruct_started",
    "allocator.equity.reconstruct_complete",
    "allocator.equity.reconstruct_failed",
    "allocator.equity.reconstruct_no_data",
    "allocator.equity.reconstruct_partial_unsupported",
    "allocator.equity.reconstruct_unexpected_noop",
    "allocator.equity.refresh_complete",
    "allocator.equity.refresh_failed",
    "allocator.equity.sibling_lookup_failed",
    "allocator.equity.perp_upnl_missing",
]


def _emit_audit(
    allocator_id: str,
    api_key_id: str,
    action: AllocatorHoldingsAction | AllocatorEquityAction,
    metadata: dict[str, Any] | None = None,
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

async def run_sync_trades_job(job: dict[str, Any]) -> DispatchResult:
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

    raw_fills: list[dict[str, Any]] = []
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
        # NEW-C12-02: track Phase-1 (daily-PnL) RPC failure separately.
        # Pre-fix the except only logger.warning'd, leaving: (a) trade_count
        # set to the *fetched* count not the *persisted* count; (b) last_sync_at
        # advancing past the unpersisted window permanently; (c) no DQ flag.
        phase1_failed = False
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
            except ccxt.RateLimitExceeded:
                # NEW-C12-01: RateLimitExceeded (⊂ Exception) was previously
                # absorbed by the broad `except Exception` below, so the outer
                # `except ccxt.RateLimitExceeded` at the top-level try never
                # ran → _stamp_429 was never called → circuit breaker never
                # tripped → next job immediately re-hammered the exchange.
                # Re-raise here so the outer handler stamps the 429 and the
                # circuit breaker fires.
                get_and_clear_last_dq_flags()
                raise
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
    except ccxt.RateLimitExceeded as exc:
        await _stamp_429(ctx.supabase, ctx.key_row, exc)
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
            await aclose_exchange(ctx.exchange)
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
            # sync_trades returns the integer inserted-row count on res.data;
            # narrow via isinstance (a non-int means SQL contract drift → 0, the
            # same value the old `res.data or 0` produced for a falsy/absent count).
            return res.data if isinstance(res.data, int) else 0

        try:
            inserted = await db_execute(_sync)
            logger.info(
                "sync_trades: persisted %s rows for strategy %s", inserted, strategy_id
            )
        except Exception as e:
            # NEW-C12-02: set flag so (a) last_sync_at is NOT advanced past
            # the unpersisted window, (b) trade_count reflects 0 persisted
            # rows, and (c) a DQ flag is emitted below for the health card.
            phase1_failed = True
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

            # B19 deferred: this per-exchange amendment probe is NOT routed
            # through services.db.chunked_in_query. It diverges from the helper's
            # single-list, sync, row-returning contract on three axes: it chunks
            # within per-exchange groups, it runs each chunk via `await
            # db_execute(...)` (async, off the event loop), and it accumulates a
            # set of (exchange, fill_id) tuples — and the enclosing except is
            # explicitly best-effort (DEBUG, never blocks the upsert), so a
            # coverage gap is already tolerated. Forcing the sync coverage helper
            # here would change those semantics (Rule 7). The IN-list is bounded
            # at 100 ids, so the 414 risk is already closed.
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
                            (exch_val, fill_id_val)
                            for row in rows(res)
                            if (exch_val := row.get("exchange"))
                            and (fill_id_val := row.get("exchange_fill_id"))
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
                def _insert_fills(batch_rows: list[dict[str, Any]] = batch) -> None:
                    ctx.supabase.table("trades").upsert(
                        [{"strategy_id": strategy_id, **fill} for fill in batch_rows],
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
    # NEW-C12-02: phase1_failed also requires a flag write to surface via
    # the admin health card (it has no pre-existing path for daily-PnL failures).
    needs_flag_write = phase2_failed or phase2_success or phase1_failed
    if needs_flag_write:
        def _load_existing_flags() -> dict[str, Any]:
            res = (
                ctx.supabase.table("strategy_analytics")
                .select("data_quality_flags")
                .eq("strategy_id", strategy_id)
                .maybe_single()
                .execute()
            )
            # one() yields {} when no strategy_analytics row exists yet (a fresh
            # strategy's first sync): maybe_single().execute() returns literal None
            # there, which the prior `res.data or {}` hit as an AttributeError
            # caught by the try/except below — which set flag_load_failed=True and,
            # on a clean Phase-2 run, wrote a spurious phase2_fill_ingestion_failed=
            # False "recovery" marker for a strategy that never failed. Routing
            # through one() makes this the intended empty-flags path (flag_load_failed
            # stays False, no spurious write) — what the author wrote `res.data or {}`
            # to mean, and what test_sync_trades_feature_flag_on already asserts (skip
            # the upsert). Deliberate latent-bug fix; only reachable when
            # USE_RAW_TRADE_INGESTION is on (off by default in prod).
            row = one(res) or {}
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

        # NEW-C12-02: emit DQ flag when Phase-1 (daily-PnL) RPC failed so
        # the admin health card lights up (pre-fix had no flag path for this).
        if phase1_failed:
            existing_flags["phase1_daily_pnl_persist_failed"] = True
            existing_flags["phase1_failed_at"] = datetime.now(timezone.utc).isoformat()
            write_needed = True
        elif existing_flags.get("phase1_daily_pnl_persist_failed"):
            # Clear stale flag on a successful Phase-1 run.
            existing_flags.pop("phase1_daily_pnl_persist_failed", None)
            existing_flags.pop("phase1_failed_at", None)
            write_needed = True

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
    #
    # red-team/C-1 (NEW-C12-02 follow-up): when Phase-1 failed AND Phase-2
    # succeeded, last_sync_at is correctly held back (NEW-C12-02), but
    # advancing last_fetched_trade_timestamp to now() would still break the
    # retry: parse_since_ms returns `preferred` (last_fetched_trade_timestamp)
    # over last_sync_at, so the next run's Phase-1 fetch starts from the
    # advanced timestamp — permanently skipping the unpersisted PnL window.
    # Gate: do NOT advance the fetched cursor when Phase-1 failed, so the
    # preferred=last_fetched_trade_timestamp path falls back to last_sync_at
    # on the next run. Phase-2 dedup (exchange_fill_id unique index) absorbs
    # the re-fetch cost.
    advance_fetched_cursor = (not raw_fills) or (phase2_complete and not phase1_failed)

    # NEW-C12-05 (CL12): fenced epilogue write. The two cursor checkpoints
    # (last_fetched_trade_timestamp, last_sync_at) and the balance snapshot are
    # written through the advance_sync_cursor SECDEF RPC (migration
    # 20260602173710) in ONE atomic, claim-token-fenced UPDATE — replacing the
    # prior two separate api_keys.update() calls. The fence drops the write
    # entirely if the watchdog reclaimed this job mid-epilogue and another
    # worker re-claimed it, closing the split-brain the per-column monotonic
    # guards only partially covered (account_balance_usdt has no ordering, so a
    # stale W1 could clobber W2's fresher snapshot). Those monotonic guards are
    # preserved INSIDE the RPC (CASE per timestamp) as defence-in-depth that
    # survives even when the fence is inert (WORKER_FENCE_V2 off / NULL token).
    #
    # Gating is unchanged from the pre-RPC two-write form; a NULL param means
    # "leave this column untouched", mirroring the old conditional builds:
    #   • last_fetched_trade_timestamp advances only when advance_fetched_cursor
    #     (G12.A.7 / red-team C-1: held back when Phase-1 failed so the next run
    #     re-fetches the unpersisted PnL window — parse_since_ms prefers it).
    #   • last_sync_at advances only when Phase-1 persisted rows (NEW-C12-02:
    #     advancing past an unpersisted window loses the daily-PnL permanently).
    #   • account_balance_usdt is written whenever present (no ordering).
    #
    # Error policy: this consolidates two writes (the old fetched-cursor write
    # was best-effort warn-and-continue; the old _update_cursor propagated) into
    # one best-effort write. Both checkpoints are idempotent — a missed stamp
    # just re-fetches one window next run (Phase-2 dedup absorbs it) — so
    # swallow-with-warning is safe and avoids a retry storm on a persistent
    # api_keys write fault. Not silent: the warning is surfaced loudly.
    _now_iso = datetime.now(timezone.utc).isoformat()
    _p_last_fetched = _now_iso if advance_fetched_cursor else None
    _p_last_sync = _now_iso if not phase1_failed else None

    if _p_last_fetched is None and _p_last_sync is None and account_balance is None:
        # silent-failure/F-04: nothing to write (fetched cursor held, Phase-1
        # failed, no balance). Log the deliberate skip so operators can
        # distinguish it from a write-path regression that drops the update.
        logger.info(
            "sync_trades: advance_sync_cursor skipped — no columns to write "
            "(advance_fetched_cursor=%s phase1_failed=%s account_balance=%s; "
            "last_sync_at intentionally held for retry)",
            advance_fetched_cursor, phase1_failed, account_balance,
        )
    else:
        def _advance_cursor() -> bool:
            res = ctx.supabase.rpc(
                "advance_sync_cursor",
                {
                    "p_api_key_id": ctx.key_row["id"],
                    "p_job_id": job["id"],
                    # WORKER_FENCE_V2 kill-switch: off → NULL token → the RPC's
                    # back-compat arm writes unconditionally (today's behaviour);
                    # on → thread the claim token so an orphaned (watchdog-
                    # reclaimed) worker's epilogue write is dropped.
                    "p_claim_token": (
                        job.get("claim_token") if WORKER_FENCE_V2 else None
                    ),
                    "p_last_fetched_ts": _p_last_fetched,
                    "p_last_sync_at": _p_last_sync,
                    "p_account_balance": account_balance,
                },
            ).execute()
            # Scalar BOOLEAN: True = owned/written, False = orphan-blocked.
            return bool(res.data)

        try:
            _owned = await db_execute(_advance_cursor)
            if not _owned:
                # NEW-C12-05: the fence dropped this write — the watchdog
                # reclaimed the job mid-epilogue and another worker owns the
                # cursor now. Loud, greppable signal so operators can confirm
                # the fence fires as intended rather than masking a bug.
                logger.warning(
                    "worker_orphan_write_blocked: advance_sync_cursor dropped "
                    "the epilogue cursor write for api_key %s (job %s) — "
                    "watchdog reclaim race; the re-claiming worker owns it now.",
                    ctx.key_row.get("id"), job.get("id"),
                )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Failed to advance sync cursor for api_key %s (job %s): %s",
                ctx.key_row.get("id"), job.get("id"), exc,
            )

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
    # Follow-on analytics kind: the funding-inclusive CSV route
    # (derive_broker_dailies → compute_analytics_from_csv). The legacy
    # trades-only compute_analytics re-entry was retired in 106-08.
    _follow_on_kind = "derive_broker_dailies"
    try:
        def _enqueue_follow_on() -> None:
            ctx.supabase.rpc(
                "enqueue_compute_job",
                {"p_strategy_id": strategy_id, "p_kind": _follow_on_kind},
            ).execute()

        await db_execute(_enqueue_follow_on)
        logger.info(
            "sync_trades: enqueued follow-on %s for strategy %s",
            _follow_on_kind, strategy_id,
        )
    except Exception as exc:  # noqa: BLE001
        # logger.exception (not warning) — operators must see the stack
        # trace in Railway logs; previous WARNING-and-swallow hid the
        # underlying cause for up to 24h.
        logger.exception(
            "sync_trades: failed to enqueue follow-on derive_broker_dailies "
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
                        # SI-02 (MEDIUM-2): clear the runner-owned warned marker on
                        # every terminal 'failed' so the status bridge (branches
                        # a/c) cannot resurrect a stale complete_with_warnings.
                        "computation_warned": False,
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
        # NEW-C12-02: trade_count must reflect PERSISTED rows, not fetched.
        # Pre-fix a Phase-1 failure still reported len(trades) which gave a
        # false green signal (admin sees "N rows synced" with 0 persisted).
        outcome=DispatchOutcome.DONE,
        trade_count=0 if phase1_failed else len(trades),
    )


async def run_compute_analytics_from_csv_job(job: dict[str, Any]) -> DispatchResult:
    """Phase 19.1 / CSV → analytics pipeline Plan 02 Task 3. Worker
    handler for the compute_analytics_from_csv kind. Delegates to
    services.analytics_runner.run_csv_strategy_analytics, which reads
    from csv_daily_returns and calls compute_all_metrics directly —
    no trades/fills/positions chain.

    strategy_id missing → permanent failure (no retry; this is a
    coding bug, not a transient).
    """
    strategy_id = job.get("strategy_id")
    if not strategy_id:
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message="run_compute_analytics_from_csv_job: strategy_id missing",
            error_kind="permanent",
        )

    # Lazy import to keep import-time cycles isolated.
    from services.analytics_runner import run_csv_strategy_analytics

    await run_csv_strategy_analytics(strategy_id)
    return DispatchResult(outcome=DispatchOutcome.DONE)


async def run_compute_portfolio_job(job: dict[str, Any]) -> DispatchResult:
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


# BYB-01 FIX A: funding sync derives `since_ms` from the FUNDING table's own
# cursor, re-fetching this many days of already-stored buckets on every run so a
# settlement that landed between the previous cursor and the funding cron is
# never permanently skipped. match_key + ignore_duplicates makes the overlap a
# free no-op at upsert.
FUNDING_CURSOR_OVERLAP_DAYS: Final[int] = 2


def _funding_since_from_cursor(
    max_ts: Any, overlap_days: int = FUNDING_CURSOR_OVERLAP_DAYS
) -> int | None:
    """Derive funding `since_ms` from the funding table's own newest timestamp.

    ``max_ts`` is the newest ``funding_fees.timestamp`` already stored for the
    strategy (ISO string), or None/absent when the table is empty for it.

    Returns:
      - ``None`` when ``max_ts`` is falsy or unparseable — callers fall through
        to the 365-day first-sync backfill (``funding_fetch`` ``since_ms=None``
        path). This is what lets keys that predate funding ingestion capture
        their full pre-adoption history.
      - otherwise ``max_ts`` minus ``overlap_days`` in epoch-milliseconds.

    Root cause (BYB-01 FIX A): the handler previously derived ``since_ms`` from
    ``api_keys.last_sync_at`` — the TRADES cursor advanced daily by cron sync —
    so (1) the None-path 365-day backfill NEVER fired for a key that already had
    a trades cursor set (its pre-adoption funding history was never captured),
    and (2) buckets settling between the trade tick and the funding cron were
    silently skipped forever (ignore_duplicates upsert with no lookback). This
    helper is deliberately pure (no I/O, no pandas) so the cursor arithmetic is
    unit-tested in isolation.
    """
    since_ms = parse_since_ms(max_ts if isinstance(max_ts, str) else None)
    if since_ms is None:
        return None
    return since_ms - overlap_days * 24 * 60 * 60 * 1000


async def run_sync_funding_job(job: dict[str, Any]) -> DispatchResult:
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

    # BYB-01 FIX A: derive the funding cursor from the funding table itself
    # (max stored funding_fees.timestamp for this strategy) — NOT the trades
    # cursor api_keys.last_sync_at. An empty table -> max_ts None -> since_ms
    # None -> the funding_fetch 365-day first-sync backfill path.
    def _load_funding_cursor() -> APIResponse:
        return (
            ctx.supabase.table("funding_fees")
            .select("timestamp")
            .eq("strategy_id", strategy_id)
            .order("timestamp", desc=True)
            .limit(1)
            .execute()
        )

    cursor_res = await db_execute(_load_funding_cursor)
    cursor_rows = getattr(cursor_res, "data", None) or []
    max_ts = cursor_rows[0].get("timestamp") if cursor_rows else None
    since_ms = _funding_since_from_cursor(max_ts)

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
    except ccxt.RateLimitExceeded as exc:
        await _stamp_429(ctx.supabase, ctx.key_row, exc)
        raise
    finally:
        try:
            await aclose_exchange(ctx.exchange)
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


async def _resolve_ccxt_flow_price_index(
    exchange: Any,
    venue: str,
    supabase: Any,
    rows: list[dict[str, Any]],
) -> dict[tuple[str, str], float]:
    """I/O price resolver for the ccxt flow adapter (FLOW-03, 76-04).

    Build the canonical same-UTC-day close ``price_index[(utc_day_iso,
    CCY_UPPER)]`` the pure ``ccxt_rows_to_dated_flows`` valuer needs for every
    NON-STABLE currency observed in the fetched deposit/withdrawal rows. REUSES
    the existing OHLCV → CoinGecko → token_price_history source
    (``services.equity_reconstruction``) — there is NO new price fetcher (RESEARCH
    Don't-Hand-Roll). Stablecoins are marked 1.0 inside the pure valuer and need
    no entry here; a non-stable flow whose same-day close is genuinely absent from
    every source is left OUT of the index so the pure valuer fails loud
    (``NavReconstructionError``) rather than fabricating a ±return.

    The day key uses ``epoch_ms_to_iso_day`` — the SAME 'YYYY-MM-DD' UTC-day
    derivation the pure valuer applies via ``_row_utc_day`` to the flow row's
    epoch-ms ``timestamp`` — so the injected keys line up exactly (canonical-key
    contract, 76-02 W4).

    WR-04: only ``ccxt.BadSymbol`` is caught on the primary OHLCV pass (feature
    detection → CoinGecko fallback). A transient network error on ``fetch_ohlcv``
    BUBBLES to the outer dispatcher (retryable), never silently degrading to an
    unpriced flow that would fail loud permanent.
    """
    from services.closed_sets import STABLECOINS
    from services.dateday import epoch_ms_to_iso_day
    from services.deribit_txn import _row_utc_day
    from services.equity_reconstruction import (
        _cache_coingecko_prices,
        _fetch_coingecko_daily_closes,
        _fetch_ohlcv_daily,
        _read_cached_prices,
    )

    # Collect the set of UTC days needed per NON-STABLE currency.
    needed_days: dict[str, set[str]] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        ccy = str(row.get("currency", "")).upper()
        if not ccy or ccy in STABLECOINS:
            continue
        try:
            day = _row_utc_day(row.get("timestamp"))
        except (ValueError, TypeError, OverflowError):
            # An undatable non-stable flow row: leave it unpriced so the pure
            # valuer fails loud on the row itself (never guess a day/price).
            continue
        needed_days.setdefault(ccy, set()).add(day)

    price_index: dict[tuple[str, str], float] = {}
    if not needed_days:
        return price_index

    all_days = sorted({d for days in needed_days.values() for d in days})
    start_iso, end_iso = all_days[0], all_days[-1]
    start_ms = int(
        datetime.fromisoformat(start_iso + "T00:00:00+00:00").timestamp() * 1000
    )
    end_ms = (
        int(datetime.fromisoformat(end_iso + "T00:00:00+00:00").timestamp() * 1000)
        + 24 * 60 * 60 * 1000
    )

    for ccy, days in needed_days.items():
        closes: dict[str, float] = {}
        # Pass 1 — primary-venue OHLCV daily closes for {ccy}/USDT.
        try:
            raw = await _fetch_ohlcv_daily(exchange, f"{ccy}/USDT", start_ms, end_ms)
            for candle in raw:
                closes[epoch_ms_to_iso_day(candle[0])] = float(candle[4])
        except ccxt.BadSymbol:
            closes = {}
        # Pass 2 — cached token_price_history + CoinGecko fallback for any day the
        # primary venue did not list/return.
        if days - set(closes):
            cached = await _read_cached_prices(supabase, ccy, start_iso, end_iso)
            for d, p in cached.items():
                closes.setdefault(d, p)
            if days - set(closes):
                cg = await _fetch_coingecko_daily_closes(
                    ccy,
                    int(
                        datetime.fromisoformat(
                            start_iso + "T00:00:00+00:00"
                        ).timestamp()
                    ),
                    int(
                        datetime.fromisoformat(
                            end_iso + "T00:00:00+00:00"
                        ).timestamp()
                    )
                    + 24 * 60 * 60,
                )
                if cg:
                    await _cache_coingecko_prices(supabase, ccy, cg)
                    for d, p in cg:
                        closes.setdefault(d, p)
        for d in days:
            if d in closes:
                price_index[(d, ccy)] = closes[d]
    return price_index


async def run_derive_broker_dailies_job(job: dict[str, Any]) -> DispatchResult:
    """Broker key full-history → daily-return series → csv_daily_returns.

    DUAL-MODE (Phase 35 / DAILIES-02):

    - Strategy-mode (job carries strategy_id): byte-unchanged behaviour.
      Downloads the API key's entire history (realized PnL bills + funding),
      derives ONE daily-return series anchored to current total equity (NAV
      incl. unrealized), upserts it keyed by (strategy_id, date), and enqueues
      compute_analytics_from_csv so the standard CSV pipeline compiles the
      factsheet.

    - Key-mode (job carries api_key_id, no strategy): the SAME realized+funding
      derivation, upserted keyed by (api_key_id, date) with the denormalized
      allocator_id (= api_keys.user_id, read from the preflight — never from the
      job payload). Key-mode does NOT enqueue compute_analytics_from_csv and does
      NOT stamp strategy_analytics — those are strategy-keyed; per-key reads land
      in Phase 36. The per-key series is "dark" (written, not yet read).

    Funding is INCLUDED in both modes because it is the dominant return driver
    for perp strategies and fetch_daily_pnl excludes it by design — a
    realized-only series understates the true return by a large margin (see
    services.broker_dailies for the live-account reconciliation).

    Pre-flight: strategy-mode loads strategy + api_key (_exchange_preflight);
    key-mode loads the api_key directly (_allocator_key_preflight, no strategy
    hop). Both run the per-exchange circuit breaker, decrypt, and create the
    exchange. On 429, stamps last_429_at.
    """
    is_key_mode = bool(job.get("api_key_id"))
    # FIX-2 (Fable): stamp the derive start on the event-loop monotonic clock so
    # the additive MTM second pass can bound itself to the REMAINING budget.
    _derive_start = asyncio.get_running_loop().time()
    if is_key_mode:
        ctx = await _allocator_key_preflight(job, "run_derive_broker_dailies_job")
    else:
        ctx = await _exchange_preflight(job, "run_derive_broker_dailies_job")
    if isinstance(ctx, DispatchResult):
        return ctx

    if is_key_mode:
        # allocator_id is the AUTHORITATIVE owner from api_keys.user_id — NEVER
        # trust a job-payload allocator_id (the owner-coherence trigger enforces
        # this at write time; sourcing it here keeps the worker honest).
        api_key_id: str = ctx.key_row["id"]
        allocator_id: str = ctx.key_row["user_id"]
        # The funding-fetch label is a log/match-key only (it never scopes the
        # exchange call); api_key_id is a stable, key-unique label in key-mode.
        funding_label = api_key_id
    else:
        strategy_id = job["strategy_id"]
        funding_label = strategy_id
    venue = ctx.key_row["exchange"]

    from services.broker_dailies import combine_realized_and_funding
    from services.nav_twr import (
        NavReconstructionError,
        apply_flow_coverage_terminus,
        flow_coverage_gap_evidence,
        flow_coverage_terminus_day,
        flow_retention_floor,
        negative_nav_guard_pre_terminus,
    )
    from services.exchange import fetch_account_equity_and_upnl_usd
    from services.nav_twr import DUST_NAV_FLOOR, NAV_TWR_GUARD_KEYS
    from services.external_flows import ExternalFlow
    from services.ccxt_flow_fetch import fetch_ccxt_transfers
    from services.ccxt_flows import ccxt_rows_to_dated_flows
    from services.funding_fetch import (
        fetch_funding_binance,
        fetch_funding_okx,
        fetch_funding_bybit,
    )

    # Dated external flows feed ONLY the core's F_t term. Both venue paths now set
    # them: the deribit branch from the native ledger crawl (:2519), the ccxt
    # branch via fetch_ccxt_transfers → ccxt_rows_to_dated_flows (:2612). This
    # stays None only until whichever branch runs (a safe pre-fetch default).
    external_flows: list[ExternalFlow] | None = None
    # CRITICAL-1: the ccxt else-branch sets this to the venue retention floor the
    # flow fetch was capped at; the DQ-02 terminus evidence gate (below) reads it
    # to decide whether a boundary flow proves a truncation. None on the deribit
    # branch (no ccxt retention cap → the terminus is None there anyway).
    _retention_floor: pd.Timestamp | None = None

    async def _dispose_broker_nav_error(
        exc: NavReconstructionError, *, stamp_detail: str, result_detail: str
    ) -> DispatchResult:
        """Shared TERMINAL disposition for a structural NavReconstructionError on
        the broker path — the ccxt flow-valuation seam (HIGH-1) AND the combine-site
        reconstruction seam use the IDENTICAL disposition so they can never drift.

        Mirrors the deribit LedgerValuationError disposition (:2040): scrub the
        message (T-74-03 account-size-leak — the schema-drift variants carry
        ``amount={raw!r}``), stamp a terminal 'failed' on strategy_analytics
        (strategy-mode only — key-mode has no per-key row, like the <2 branch), and
        return a PERMANENT FAILED so a structurally-unre-priceable input is never
        retried forever as a generic `unknown` (T-74-02 DoS) with the wizard poller
        stuck on an infinite 'computing' spinner."""
        from services.redact import scrub_freeform_string

        scrubbed = str(scrub_freeform_string(str(exc)))
        if not is_key_mode:
            def _stamp_nav_failed() -> None:
                ctx.supabase.table("strategy_analytics").upsert(
                    {
                        "strategy_id": strategy_id,
                        "computation_status": "failed",
                        # SI-02 (MEDIUM-2): clear the runner-owned warned marker.
                        "computation_warned": False,
                        "computation_error": stamp_detail + scrubbed,
                        "data_quality_flags": {"csv_source": True},
                        # F-4 (Fable): authoritative-clear the by-basis column on a
                        # terminal failure so a prior successful derive's object
                        # (composite-era or single-key MTM) can't render as a
                        # live-looking money number on a now-FAILED row.
                        "metrics_json_by_basis": None,
                    },
                    on_conflict="strategy_id",
                ).execute()

            await db_execute(_stamp_nav_failed)
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message=result_detail + scrubbed,
            error_kind="permanent",
        )

    # MTM-01 (Phase 101): the additive single-key mark_to_market SECOND pass
    # (Deribit options books only). Initialized at the branch-OUTER scope so the
    # post-branch persist reads them unconditionally on EVERY path — ccxt venues,
    # perp-only Deribit, and key-mode all leave them at these defaults (no second
    # crawl, no metrics_json_by_basis write) so SC-4 holds by construction.
    #   * mtm_returns    — the MTM daily-return Series (None ⇒ pass skipped/degraded)
    #   * mtm_gated_reason — the machine reason stamped on a STRUCTURAL degrade
    #   * mtm_attempted  — True iff the second pass ran (options/strategy/cash-basis);
    #     the post-branch persist keys the by-basis write off THIS (never off
    #     _completeness, which is undefined on the ccxt branch).
    mtm_returns: pd.Series | None = None
    mtm_gated_reason: str | None = None
    mtm_attempted: bool = False
    # SMTM-01 (Phase 132): the additive single-key smoothed_mtm THIRD pass (Deribit
    # options books only). Initialized at the branch-OUTER scope like the MTM pair so
    # the post-branch persist reads them unconditionally on EVERY path — ccxt, perp-
    # only Deribit, and key-mode all leave them at these defaults (no third crawl, no
    # smoothed series/by-basis write) so SC-4 holds by construction (a no-option key
    # persists NO smoothed artifacts).
    #   * smoothed_returns  — the smoothed daily-return Series (None ⇒ pass
    #     skipped/degraded — budget refusal, bounded-crawl timeout, or scalar
    #     compute-reject)
    #   * smoothed_attempted — True iff the third pass was REACHED on an options
    #     book (options/strategy/cash-basis) — set even when the budget floor
    #     refuses the crawl, so the guarded persist can heal a stale series row
    # There is deliberately NO smoothed_gated_reason channel yet (Phase 133 /
    # LOW-01): a degraded smoothed pass signals by by-basis OMISSION + a log line.
    # STRUCTURAL marks failures stay FAIL-LOUD (a holed-marks LedgerValuationError
    # fails the whole job — never a silent two-basis fallback); only the budget/
    # timeout and scalar-compute dispositions degrade (mirroring MTM's FIX-2).
    smoothed_returns: pd.Series | None = None
    smoothed_attempted: bool = False
    try:
        # Phase 105 (BB-02, MED-2): resolve the returns-denominator override HERE at the
        # branch-outer, VENUE-AGNOSTIC scope — mirroring run_csv_strategy_analytics
        # (analytics_runner.py:2304-2316), which parses it for EVERY venue. In Phase 104
        # this parse lived ONLY inside the deribit arm, so a ccxt strategy with a
        # simple/active override echoed the geometric/calendar DEFAULT (MED-2) and a
        # malformed ccxt config was silently ignored. Both the post-branch cash-series
        # persist + MTM echo AND (on the deribit arm) pnl_basis / exclude_spot_extraction
        # / combine_native_ledger read this SAME variable, so the derive path stays
        # branchless (collapse #6). Strategy-mode only — key-mode owns no strategy row.
        from services.allocated_capital import (
            ReturnsDenominatorConfigError,
            parse_returns_denominator_config,
        )
        from services.redact import scrub_freeform_string

        # Phase 105 (BB-02, D3 SECONDARY): heal-DELETE both persisted series rows
        # (cash_settlement + mtm_daily_returns) so a stale row never outlives an
        # authoritative-NULL terminal write — mirroring the MTM heal idiom. This is
        # DEFENSE-IN-DEPTH; the Plan-02 read gate is the primary guarantee. A heal
        # failure must NEVER mask the terminal stamp that invoked it — swallow + warn.
        # Strategy-mode only (key-mode owns no per-strategy series row).
        async def _heal_delete_basis_series() -> None:
            if is_key_mode:
                return
            from services.basis_series import persist_basis_series

            def _delete_both() -> None:
                persist_basis_series(
                    ctx.supabase, strategy_id, basis="cash_settlement", result=None,
                )
                persist_basis_series(
                    ctx.supabase, strategy_id, basis="mark_to_market", result=None,
                )

            try:
                await db_execute(_delete_both)
            except Exception as _heal_exc:  # noqa: BLE001
                logger.warning(
                    "derive_broker_dailies: series heal-delete failed for strategy "
                    "%s (terminal stamp already applied): %s",
                    strategy_id, _heal_exc,
                )

        # P72 — fail-loud analytics stamp, now VENUE-NEUTRAL (hoisted out of the deribit
        # arm + renamed; the arm keeps calling this SAME helper for its other permanent
        # failures). A terminal-FAIL must leave the wizard's SyncPreviewStep poller a
        # TERMINAL 'failed' gate instead of an infinitely-pending 'complete'. Strategy-
        # mode only: key-mode has no per-key strategy_analytics row (per-key reads land
        # in Phase 36).
        async def _stamp_strategy_analytics_failed(message: str) -> None:
            if is_key_mode:
                return
            scrubbed = str(scrub_freeform_string(message))

            def _upsert() -> None:
                ctx.supabase.table("strategy_analytics").upsert(
                    {
                        "strategy_id": strategy_id,
                        "computation_status": "failed",
                        # SI-02 (MEDIUM-2): clear the runner-owned warned marker.
                        "computation_warned": False,
                        "computation_error": scrubbed,
                        "data_quality_flags": {"csv_source": True},
                        # F-4 (Fable): authoritative-clear the by-basis column so a
                        # prior object can't render on a now-FAILED row.
                        "metrics_json_by_basis": None,
                    },
                    on_conflict="strategy_id",
                ).execute()

            await db_execute(_upsert)
            # D3 SECONDARY: single choke point — every terminal-failure stamp that flows
            # through this helper (parse-malformed + the deribit arm's ledger/scope/
            # valuation failures) heals both series rows.
            await _heal_delete_basis_series()

        # Per-strategy returns-denominator override (Zavara-only allocated capital).
        # ABSENT on every normal strategy (and in key-mode) → None → the unchanged NAV
        # path (byte-identical). A PRESENT-but-malformed config FAILS LOUD (permanent)
        # on EITHER venue — never ship a factsheet on a guessed capital base. Its
        # ``pnl_basis`` also drives the deribit native ledger's accrual basis
        # (cash_settlement default).
        denominator_config: "ReturnsDenominatorConfig | None" = None
        try:
            denominator_config = parse_returns_denominator_config(
                ctx.strategy_row.get("returns_denominator_config")
                if not is_key_mode and isinstance(ctx.strategy_row, dict)
                else None
            )
        except ReturnsDenominatorConfigError as exc:
            await _stamp_strategy_analytics_failed(
                "Strategy returns_denominator_config is malformed."
            )
            return DispatchResult(
                outcome=DispatchOutcome.FAILED,
                error_message=(
                    "derive_broker_dailies: "
                    f"{scrub_freeform_string(str(exc))}"
                ),
                error_kind="permanent",
            )

        if venue == "deribit":
            # D-08: realized returns come from the ONE txn-log ledger pass
            # (funding-inclusive settlement cash deltas) — NEVER fetch_all_trades
            # / the fills endpoint. Funding is INSIDE the settlement sum (A3/D-10)
            # → EMPTY funding_rows, no funding_fees write (count-once, DRB-07).
            from services.broker_dailies import combine_native_ledger
            from services.deribit_ingest import (
                CurrencyEnumerationError,
                DeribitTransientReadError,
                LedgerCompletenessError,
                LedgerTruncatedError,
                ScopeAuthError,
                assert_ledger_complete,
                build_deribit_native_ledger,
                fetch_deribit_native_account_state,
            )
            from services.allocated_capital import exclude_spot_extraction_for
            from services.deribit_txn import (
                DEFAULT_PNL_BASIS,
                LedgerValuationError,
                PNL_BASIS_MARK_TO_MARKET,
                PNL_BASIS_SMOOTHED_MTM,
            )
            from services.nav_twr import UNREALIZED_MATERIALITY_RATIO
            from services.native_nav import InceptionReconciliationError
            from services.stitch_composite import (
                MTM_REASON_ANCHOR_RACE,
                MTM_REASON_SECOND_PASS_TIMEOUT,
                MTM_REASON_SUMMARY_COVERAGE,
            )

            # 80-06 (HIGH-1+MEDIUM-1, one-read root-cause): read the Deribit anchor
            # ONCE for the WHOLE branch. fetch_deribit_native_account_state yields
            # BOTH the native maps the core anchors on AND the collapsed USD
            # equity/wedge that materiality + C2 judge, from the SAME
            # get_account_summaries response (D5) — so the core's anchor can never
            # diverge from the materiality basis, and there is no second summaries
            # fetch inside the builder. fetch_account_equity_usd does NOT cover
            # deribit (coin-margined USDT balance is not USD equity); the collapse
            # converts each currency's coin equity at its event/mark index into USD.
            # FLOW-04 (v1.8): the companion session-uPnL wedge (session_upl) rides
            # this SAME response + index_prices (77-02) — noise-guarded below before
            # it threads into the realized-basis roll terminal.
            # FLIPRETRY-01: the anchor summaries read is a LIVE crawl too — bound it
            # so a hang becomes a classified transient (via the same
            # DeribitTransientReadError retryable path the empty-read case uses
            # below), never an unbounded wedge of the sequential worker loop.
            try:
                account_state = await asyncio.wait_for(
                    fetch_deribit_native_account_state(ctx.exchange),
                    timeout=_BROKER_CRAWL_TIMEOUT_S,
                )
            except asyncio.TimeoutError as _exc:
                raise DeribitTransientReadError(
                    "Deribit get_account_summaries anchor read exceeded the "
                    f"{_BROKER_CRAWL_TIMEOUT_S}s per-crawl bound — retrying rather "
                    "than wedging the worker (FLIPRETRY-01)"
                ) from _exc
            # HIGH-1: a FAILED / empty summaries read yields EMPTY native maps. A
            # blank read is I/O, NOT a structural refusal — fail RETRYABLE rather
            # than build a ZERO-anchor ledger. A zero anchor rolls every bucket back
            # from 0.0 → the full_history §5 inception gate false-refuses
            # InceptionReconciliationError, which the deribit except chain
            # dispositions PERMANENT (no retry) — a transient blip would then
            # permanently kill analytics. Raise a non-ValueError /
            # non-NavReconstructionError type BEFORE the try so it escapes the
            # permanent except chain to the generic retryable dispatcher. An
            # unvaluable COLLAPSE (a held coin with no USD index) still carries
            # readable native maps (native_equity non-empty) → NOT this case; it is
            # left to the core's structural refusal so it is never retried forever
            # (T-80-10).
            if account_state.balance_error and not account_state.native_equity:
                raise DeribitTransientReadError(
                    "Deribit get_account_summaries anchor read failed/empty (no "
                    "native anchor) — retrying rather than building a zero-anchor "
                    "ledger."
                )
            equity = account_state.collapsed_equity_usd
            balance_error = account_state.balance_error
            open_unrealized_usd = account_state.collapsed_upnl_usd
            upnl_unreadable = account_state.upnl_unreadable
            # `denominator_config` was resolved VENUE-AGNOSTICALLY at the branch-outer
            # scope (Phase 105 MED-2 hoist) — the deribit consumers below read that SAME
            # value (byte-identical for deribit by construction). Its ``pnl_basis`` drives
            # the native ledger's accrual basis (cash_settlement default).
            pnl_basis = (
                denominator_config.pnl_basis
                if denominator_config is not None
                else DEFAULT_PNL_BASIS
            )
            # Bug B (spot-extraction exclusion) is ALLOCATED-PATH ONLY. It rides the
            # SAME signal (`denominator_config is not None`) that selects the
            # allocated returns path in `combine_native_ledger` below — so the
            # ledger's native_pnl and the returns path are ALWAYS built in the same
            # mode. On the NAV path (config=None → False) spot legs are RETAINED so
            # the §5 inception reconciliation closes (a dropped sell leg would leave
            # a §5 residual — no flow channel carries it). Never decouple these two.
            # F1: the SINGLE source shared with the acceptance harness.
            exclude_spot_extraction = exclude_spot_extraction_for(denominator_config)
            try:
                # v1.9 NATIVE SWITCH (80-03, NAT-05): every Deribit account —
                # USD-native included — is reconstructed in NATIVE units through
                # the landed core. There is NO per-account dispatch flag; §4 SC-4
                # bit-identity (ship gate i) is what licenses routing every account
                # the same way (route-by-data-availability, not by account type).
                # build_deribit_native_ledger runs the SAME single txn-log crawl the
                # old fetch_deribit_ledger_daily_records did (so the D-08
                # funding-inside-settlement and completeness accounting are
                # unchanged) and assembles the NativeLedger + CompletenessReport.
                # FLIPRETRY-01: the cash-pass crawl (deribit native ledger, ~inception
                # for a long-lived account) is HARD-BOUNDED by asyncio.wait_for so a
                # slow/hanging live read becomes a classified transient (the
                # `except asyncio.TimeoutError` arm below), never an unbounded wedge of
                # the SEQUENTIAL worker's event loop (the v1.11 FLIP rollback root
                # cause). The MTM SECOND pass at :2472 is separately bounded already.
                native_ledger, _completeness = await asyncio.wait_for(
                    build_deribit_native_ledger(
                        ctx.exchange, account_state=account_state, pnl_basis=pnl_basis,
                        exclude_spot_extraction=exclude_spot_extraction,
                    ),
                    timeout=_BROKER_CRAWL_TIMEOUT_S,
                )
                # Re-anchored D-02 gate: a silently-partial ledger FAILS LOUD
                # BEFORE any upsert — no partial track record is ever written. The
                # native path does NOT bypass this honesty gate.
                assert_ledger_complete(_completeness)
                # C2 — equity-vs-activity floor: a materially-funded account that
                # produced ZERO return-bearing rows across the whole window is a
                # silently-empty (green) ledger (broken key / wrong account / mass
                # -32602), not a genuine "insufficient history". Fail loud BEFORE
                # the native reconstruction runs (so a zero-row material account
                # never reaches combine).
                if (
                    not balance_error
                    and equity is not None
                    and abs(equity) > _DERIBIT_EMPTY_LEDGER_FLOOR_USD
                    and _completeness.total_return_rows == 0
                ):
                    await _stamp_strategy_analytics_failed(
                        "Deribit account holds equity but the ledger produced no "
                        "return-bearing activity in the window."
                    )
                    return DispatchResult(
                        outcome=DispatchOutcome.FAILED,
                        error_message=(
                            "derive_broker_dailies: deribit account holds material "
                            f"equity (~{abs(equity):.0f} USD) but the ledger "
                            "produced ZERO return-bearing rows — refusing an "
                            "empty-but-green track record (broken key / wrong "
                            "account / mass -32602)"
                        ),
                        error_kind="permanent",
                    )
                # Native reconstruction: NAV(d) = Σ_c B_c(d)×mark_c(d) rolled
                # backward per currency from today's native equity, chain-linked to
                # TWR, with the §5 inception gate + App A #6 unmarkable-wedge
                # refusal enforced INSIDE the core. combine_native_ledger reuses
                # gap_fill_daily_returns so (returns, meta) is byte-shape identical
                # to the legacy sibling → everything downstream is untouched (§9.2).
                # The EXACT indexable set the ledger's marks were built against is
                # threaded off the report — never re-probed (drift-free).
                returns, meta = combine_native_ledger(
                    native_ledger,
                    _completeness.indexable_currencies,
                    denominator_config=denominator_config,
                )
                # FLOW-04 materiality: the pure native core does not emit
                # unrealized_pnl_in_anchor (it subtracts the wedge per-currency, App
                # A #6). Preserve the v1.8 warning using the collapsed USD anchor +
                # wedge — a material open-uPnL wedge on a TRUSTWORTHY anchor stamps
                # complete_with_warnings exactly as the legacy USD-space deribit
                # path did (nav_twr.py:788 signed-anchor condition, mirrored on the
                # collapsed scalars; a dust/negative/balance-error anchor never
                # flags — the anchor itself is the flagged problem below).
                if (
                    not balance_error
                    and equity is not None
                    and equity > DUST_NAV_FLOOR
                    and abs(open_unrealized_usd) / equity
                    > UNREALIZED_MATERIALITY_RATIO
                ):
                    meta["unrealized_pnl_in_anchor"] = True
                # Q6: option rows outside their currency's summary coverage window
                # (pre-2025-01-12 rollout / trailing edge) fell back to cash-basis
                # `change` — premium noise persists there (no summary channel to
                # reshape it). Stamp the affected buckets so the status promotes to
                # complete_with_warnings (a non-empty list is a registered
                # NAV_TWR_GUARD_KEYS flag) — the factsheet caveats rather than
                # silently shipping pre-rollout noise as a clean track record.
                # (Same pattern as unrealized_pnl_unreadable: worker-stamped, not
                # emitted by the pure core.) The exact TOTAL stays honest (the
                # per-currency cash total == Σchange in both eras); only the daily
                # attribution on the cash-basis instruments is flagged.
                if _completeness.pre_coverage_option_days:
                    meta["pre_summary_rollout_option_dailies"] = [
                        f"{ccy}:{day}"
                        for ccy, day in _completeness.pre_coverage_option_days
                    ]
                # ── MTM-01 (Phase 101): additive mark_to_market SECOND pass ──
                # The single-key sibling of the composite dual-pass
                # (_reconstruct_deribit, :3135-3148). Runs a SECOND ledger pass in
                # mark_to_market basis and persists it ADDITIVELY into
                # strategy_analytics.metrics_json_by_basis.mark_to_market (below).
                # It NEVER reassigns the cash-pass objects (returns / meta /
                # _completeness / native_ledger) — those are what SC-4 protects — so
                # cash_settlement stays byte-identical by construction. ALL of these
                # must hold before it runs:
                #   * not is_key_mode          — key-mode owns no strategy_analytics
                #     row to persist a by-basis object into (per-key reads = Phase 36);
                #   * pnl_basis == DEFAULT_PNL_BASIS (cash_settlement) — if the
                #     configured headline basis is ALREADY mark_to_market there is
                #     nothing additive to compute (a dual write there is Phase-102);
                #   * _completeness.has_option_activity — the RESEARCH Q1 single-key
                #     gate signal; perp-only MTM ≡ cash (the Phase-82 amendment is
                #     dark under a no-option book), so skipping avoids doubling every
                #     Deribit crawl for zero information.
                # Timeout envelope (FIX-2, Fable — corrected): derive_broker_dailies
                # has a FIXED 15-min budget (:266) and this second pass is a FULL
                # -HISTORY crawl (since_ms=None) — the ENTIRE txn-log re-crawl PLUS a
                # second dense-marks index fetch, NOT a bounded ~90-day backfill. The
                # earlier "~120 s (composite per-crawl ceiling)" justification was
                # unsound: _COMPOSITE_PER_CRAWL_SECONDS is a ~90-day backfill ceiling,
                # whereas here BOTH crawls are full-history and share the one 15-min
                # budget. A large book whose single crawl already nears the budget
                # would, unbounded, push the whole derive past the outer wait_for →
                # asyncio.TimeoutError → classified transient → 3 attempts →
                # failed_final, SILENTLY, taking the healthy cash headline down with
                # it. Mitigation (options books only, no dispatch refactor / no blind
                # global ceiling bump): BOUND the second pass to a fraction of the
                # REMAINING budget so the cash pass always keeps its headroom, and on
                # timeout DEGRADE LOUDLY with a distinct machine reason. Residual: if
                # the CASH pass ALONE already nears the 15-min budget, the outer
                # wait_for can still fire during the cash pass — that is a cash-pass
                # sizing limit, not introduced by the second pass, and is out of scope
                # here (a true full-book budget tune is Phase-102 follow-up).
                if (
                    not is_key_mode
                    and pnl_basis == DEFAULT_PNL_BASIS
                    and _completeness.has_option_activity
                ):
                    mtm_attempted = True
                    _derive_budget = float(
                        TIMEOUT_PER_KIND.get("derive_broker_dailies", 15 * 60)
                    )
                    _mtm_remaining = _derive_budget - (
                        asyncio.get_running_loop().time() - _derive_start
                    )
                    _mtm_pass_timeout = (
                        _mtm_remaining * _MTM_SECOND_PASS_BUDGET_FRACTION
                    )
                    if _mtm_pass_timeout < _MTM_SECOND_PASS_MIN_SECONDS:
                        # The cash pass already consumed most of the budget — do NOT
                        # start a second full-history crawl that cannot plausibly
                        # finish (it would only risk sinking the derive). DEGRADE
                        # LOUD with the distinct timeout reason; the cash headline
                        # ships unaffected. (mtm_returns stays None → the persist
                        # writes an authoritative SQL NULL for the by-basis object.)
                        mtm_returns = None
                        mtm_gated_reason = MTM_REASON_SECOND_PASS_TIMEOUT
                        logger.warning(
                            "derive_broker_dailies: skipping mark_to_market second "
                            "pass for strategy %s — only %.0fs of the %.0fs derive "
                            "budget remained (below the %.0fs floor); degrading the "
                            "additive object, cash derive unaffected",
                            strategy_id, _mtm_remaining, _derive_budget,
                            _MTM_SECOND_PASS_MIN_SECONDS,
                        )
                    else:
                        try:
                            # Bound the full-history second crawl to the remaining
                            # budget so it can never sink the whole derive (FIX-2).
                            _mtm_ledger, _mtm_completeness = await asyncio.wait_for(
                                build_deribit_native_ledger(
                                    ctx.exchange,
                                    account_state=account_state,
                                    pnl_basis=PNL_BASIS_MARK_TO_MARKET,
                                    exclude_spot_extraction=exclude_spot_extraction,
                                ),
                                timeout=_mtm_pass_timeout,
                            )
                            assert_ledger_complete(_mtm_completeness)
                            # Bind to MTM-only names — NEVER reassign returns/meta/
                            # _completeness/native_ledger. The MTM meta guard flags
                            # are DISCARDED (mirror the composite Finding-9 discard):
                            # the cash-pass flags are authoritative.
                            mtm_returns, _mtm_meta = combine_native_ledger(
                                _mtm_ledger,
                                _mtm_completeness.indexable_currencies,
                                denominator_config=denominator_config,
                            )
                        except asyncio.TimeoutError:
                            # FIX-2: the bounded second crawl overran its slice of
                            # the remaining budget. DEGRADE LOUD with the distinct
                            # reason (never let it escape as a transient that retries
                            # the WHOLE derive to failed_final and sinks the cash
                            # headline).
                            mtm_returns = None
                            mtm_gated_reason = MTM_REASON_SECOND_PASS_TIMEOUT
                            logger.warning(
                                "derive_broker_dailies: mark_to_market second pass "
                                "exceeded its bounded %.0fs budget for strategy %s "
                                "— degrading the additive object, cash unaffected",
                                _mtm_pass_timeout, strategy_id,
                            )
                        except (
                            LedgerValuationError,
                            NavReconstructionError,
                            LedgerCompletenessError,
                            LedgerTruncatedError,
                            CurrencyEnumerationError,
                            ScopeAuthError,
                        ) as _mtm_exc:
                            # DELIBERATE ASYMMETRY vs the cash pass narrowing (:2249,
                            # rationale :2256-2259): a STRUCTURAL mark_to_market
                            # failure (a pre-rollout straddle with no boundary V₀
                            # anchor, or a mid-window summary hole —
                            # deribit_txn.py:636-650) DEGRADES — the cash factsheet
                            # still ships and we stamp a FIXED machine reason (no
                            # exception-text interpolation, T-74-03). We do NOT catch
                            # bare ValueError / json.JSONDecodeError: a transient
                            # network/parse ValueError escaping the second crawl must
                            # fall through and stay transient-retryable (the outer
                            # :2414 arm / dispatcher retries the WHOLE derive), NEVER
                            # be permanently stamped as a coverage reason.
                            # DeribitTransientReadError, ccxt network errors, and
                            # RateLimitExceeded likewise propagate. Structural ⇒
                            # degrade; transient ⇒ retry all.
                            #
                            # Phase 102 (deferred anchor-race resolution): the reason
                            # is LABEL-ONLY inside this EXISTING catch — no re-raise,
                            # no retry, no tuple change, degrade semantics untouched.
                            # An InceptionReconciliationError here is the same-anchor
                            # race (a mid-crawl event lands in the MTM rows but not the
                            # once-read anchor → the §5 native roll no longer
                            # reconciles), so it gets its OWN transient reason instead
                            # of the permanent-sounding coverage stamp. A genuinely
                            # PERSISTENT inception breach also lands here and STILL
                            # degrades (cash ships) — never propagate-to-retry, which
                            # would sink the healthy cash headline (deferred-items.md).
                            mtm_returns = None
                            mtm_gated_reason = (
                                MTM_REASON_ANCHOR_RACE
                                if isinstance(_mtm_exc, InceptionReconciliationError)
                                else MTM_REASON_SUMMARY_COVERAGE
                            )
                            logger.warning(
                                "derive_broker_dailies: mark_to_market second pass "
                                "degraded for strategy %s (structural reconstruction "
                                "failure) — cash derive unaffected: %s",
                                strategy_id,
                                scrub_freeform_string(str(_mtm_exc)),
                            )
                # ── SMTM-01 (Phase 132): additive smoothed_mtm THIRD pass ──
                # The single-key sibling of the composite third pass. Runs a THIRD
                # ledger pass in smoothed_mtm basis and persists it ADDITIVELY into
                # strategy_analytics.metrics_json_by_basis.smoothed_mtm (below). Gated
                # on the SAME (not is_key_mode AND cash-headline AND
                # has_option_activity) predicate as the MTM pass — NO new signal
                # invented (perp-only ⇒ no third crawl ⇒ SC-4, a no-option key persists
                # NO smoothed artifacts). It NEVER reassigns the cash-pass objects
                # (returns / meta / _completeness / native_ledger) NOR the MTM-pass
                # objects, so cash_settlement AND mark_to_market stay byte-identical.
                #
                # FAIL-LOUD on STRUCTURE (money-path): a LedgerValuationError (holed
                # marks — incl. the retention-STRADDLE / crawl-day cases pinned in
                # 131-01a) is deliberately NOT caught here; it propagates to the outer
                # permanent-FAILED handler (`except LedgerValuationError`) exactly
                # like the cash pass, so the job fails loud BEFORE any persist and NO
                # partial / interpolated smoothed basis is ever written (never a
                # silent two-basis fallback).
                #
                # Timeout envelope (HIGH-01, 132 review — the FIX-2 sibling): this
                # third pass is ANOTHER full-history crawl PLUS the dense-marks index
                # fetch, inside the SAME fixed 15-min outer budget the cash + MTM
                # passes already drew from. Bounding it at the fixed
                # _BROKER_CRAWL_TIMEOUT_S (810s, sized for the CASH pass as
                # outer-minus-reserve) guaranteed that a large options book whose
                # legitimate cash crawl ran long hit the OUTER wait_for mid-smoothed-
                # crawl → transient → 3 identical attempts → failed_final, sinking the
                # healthy cash headline (the exact failure FIX-2 was engineered out of
                # the MTM pass). Mirror the MTM FIX-2 machinery EXACTLY: bound the
                # crawl to _MTM_SECOND_PASS_BUDGET_FRACTION of the REMAINING budget,
                # REFUSE to start below the _MTM_SECOND_PASS_MIN_SECONDS floor, and on
                # refusal/timeout DEGRADE (skip — the by-basis simply lacks
                # smoothed_mtm; cash and MTM still ship DONE). There is no smoothed
                # degrade-REASON channel yet (deferred to Phase 133 per LOW-01) — the
                # by-basis omission is the signal; the degrade is logged.
                if (
                    not is_key_mode
                    and pnl_basis == DEFAULT_PNL_BASIS
                    and _completeness.has_option_activity
                ):
                    smoothed_attempted = True
                    _smoothed_budget = float(
                        TIMEOUT_PER_KIND.get("derive_broker_dailies", 15 * 60)
                    )
                    _smoothed_remaining = _smoothed_budget - (
                        asyncio.get_running_loop().time() - _derive_start
                    )
                    _smoothed_pass_timeout = (
                        _smoothed_remaining * _MTM_SECOND_PASS_BUDGET_FRACTION
                    )
                    if _smoothed_pass_timeout < _MTM_SECOND_PASS_MIN_SECONDS:
                        # The cash (+ MTM) passes already consumed most of the budget
                        # — do NOT start a third full-history crawl that cannot
                        # plausibly finish (it would only risk sinking the derive).
                        # DEGRADE: smoothed_returns stays None → no smoothed compute,
                        # no smoothed by-basis key; cash/MTM ship unaffected.
                        logger.warning(
                            "derive_broker_dailies: skipping smoothed_mtm third "
                            "pass for strategy %s — only %.0fs of the %.0fs derive "
                            "budget remained (below the %.0fs floor); degrading the "
                            "additive smoothed object, cash derive unaffected",
                            strategy_id, _smoothed_remaining, _smoothed_budget,
                            _MTM_SECOND_PASS_MIN_SECONDS,
                        )
                    else:
                        try:
                            # Bound the full-history third crawl to its slice of the
                            # remaining budget so it can never sink the whole derive.
                            _smoothed_ledger, _smoothed_completeness = (
                                await asyncio.wait_for(
                                    build_deribit_native_ledger(
                                        ctx.exchange,
                                        account_state=account_state,
                                        pnl_basis=PNL_BASIS_SMOOTHED_MTM,
                                        exclude_spot_extraction=(
                                            exclude_spot_extraction
                                        ),
                                    ),
                                    timeout=_smoothed_pass_timeout,
                                )
                            )
                            assert_ledger_complete(_smoothed_completeness)
                            # Bind to smoothed-only names — NEVER reassign the
                            # cash/MTM objects. The smoothed meta guard flags are
                            # DISCARDED (the cash-pass flags are authoritative),
                            # mirroring the MTM Finding-9 discard.
                            smoothed_returns, _smoothed_meta = combine_native_ledger(
                                _smoothed_ledger,
                                _smoothed_completeness.indexable_currencies,
                                denominator_config=denominator_config,
                            )
                            # pre_mark_retention_option_days →
                            # complete_with_warnings: option marks aged past the
                            # ~2.5yr retention horizon fell back to cash-basis for
                            # those (day, ccy) buckets (partial marks are NEVER
                            # interpolated — a straddler fails loud above). The
                            # redistribution TOTAL stays honest (telescoping); only
                            # those daily attributions are caveated. Stamp onto the
                            # AUTHORITATIVE cash-pass `meta` via the SAME registered-
                            # warning-key mechanism as the retired
                            # pre_summary_rollout_option_dailies stamp
                            # (NAV_TWR_GUARD_KEYS).
                            if _smoothed_completeness.pre_mark_retention_option_days:
                                meta["pre_mark_retention_option_dailies"] = [
                                    f"{ccy}:{day}"
                                    for ccy, day in (
                                        _smoothed_completeness
                                        .pre_mark_retention_option_days
                                    )
                                ]
                        except asyncio.TimeoutError:
                            # HIGH-01: the bounded third crawl overran its slice of
                            # the remaining budget. DEGRADE, attributed to the
                            # SMOOTHED pass (never let it escape to the outer arm,
                            # which blames the cash pass and retries the WHOLE derive
                            # to failed_final, sinking the cash headline).
                            smoothed_returns = None
                            logger.warning(
                                "derive_broker_dailies: smoothed_mtm third pass "
                                "exceeded its bounded %.0fs budget for strategy %s "
                                "— degrading the additive smoothed object, cash "
                                "unaffected",
                                _smoothed_pass_timeout, strategy_id,
                            )
            except asyncio.TimeoutError:
                # FLIPRETRY-01: the cash-pass crawl exceeded the per-crawl bound.
                # A hang is a CLASSIFIED, RETRYABLE transient — NEVER permanent, NEVER
                # an unbounded wedge, and NO terminal `failed` stamp (the next attempt
                # may succeed). This arm MUST precede the broader permanent-stamping
                # arms below: in Python 3.11+ asyncio.TimeoutError IS builtins.
                # TimeoutError (an OSError subclass), so an earlier broader catch would
                # mis-dispose the timeout as PERMANENT and defeat the retry intent. The
                # MTM second pass AND the smoothed third pass each have their own local
                # TimeoutError arm (budget-sliced, degrade-on-expiry — HIGH-01), so
                # this only ever fires for the cash pass. The `finally: aclose_exchange`
                # below still runs. Mirrors the sfox FLIPRETRY-01 block (:2680): static
                # scrubbed text only, never logger.exception / interpolated crawl
                # content (H-3 HMAC-in-URL leak class).
                logger.warning(
                    "derive_broker_dailies: deribit cash-pass crawl exceeded the %ss "
                    "per-crawl bound (label=%s) — classified transient, retrying "
                    "(FLIPRETRY-01)",
                    _BROKER_CRAWL_TIMEOUT_S, funding_label,
                )
                return DispatchResult(
                    outcome=DispatchOutcome.FAILED,
                    error_message=(
                        "derive_broker_dailies: deribit cash-pass crawl exceeded the "
                        f"per-crawl wall-clock bound ({_BROKER_CRAWL_TIMEOUT_S}s) — "
                        "retrying rather than wedging the worker (FLIPRETRY-01)"
                    ),
                    error_kind="transient",
                )
            except (
                LedgerCompletenessError,
                LedgerTruncatedError,
                CurrencyEnumerationError,
                ScopeAuthError,
            ) as exc:
                # An unenumerable currency universe, an unprovable single-scope
                # premise (>1 funded subaccount → ScopeAuthError), or a truncated
                # crawl all mean we cannot PROVE coverage → clean permanent FAILED,
                # never a silently-partial track record.
                await _stamp_strategy_analytics_failed(
                    "Deribit transaction history could not be verified as "
                    "complete. " + str(scrub_freeform_string(str(exc)))
                )
                return DispatchResult(
                    outcome=DispatchOutcome.FAILED,
                    error_message=(
                        "derive_broker_dailies: deribit ledger incomplete or "
                        "unenumerable — "
                        + str(scrub_freeform_string(str(exc)))
                    ),
                    error_kind="permanent",
                )
            except LedgerValuationError as exc:
                # A row→USD STRUCTURAL conversion failure from the crawl (a coin
                # cash row with no same-day index even after the settlement-index
                # fallback, an undatable timestamp, schema drift, or an unknown
                # type/currency) — retrying cannot help. It must fail PERMANENT (not
                # the transient "unknown" that burns 3 retries) AND stamp the
                # analytics row so the wizard reaches a terminal gate instead of an
                # infinite 'computing' spinner. Narrowed to the TYPED
                # LedgerValuationError (a ValueError subclass) so a transient
                # network ValueError/json.JSONDecodeError escaping the crawl falls
                # through to the outer generic handler and stays transient-retryable.
                scrubbed = str(scrub_freeform_string(str(exc)))
                await _stamp_strategy_analytics_failed(
                    "Deribit ledger contained a transaction that could not be "
                    "processed (unvaluable coin cash, undatable, or schema drift). "
                    + scrubbed
                )
                return DispatchResult(
                    outcome=DispatchOutcome.FAILED,
                    error_message=(
                        "derive_broker_dailies: deribit ledger row unvaluable — "
                        + scrubbed
                    ),
                    error_kind="permanent",
                )
            except NavReconstructionError as exc:
                # v1.9 NATIVE SWITCH: a STRUCTURAL refusal from the native core —
                # UnmarkableCurrencyError (§3.4: a value-bearing currency with no
                # resolvable {ccy}_usd mark, incl. the App A #6 unmarkable-wedge
                # refusal) or InceptionReconciliationError (§5: the full-history
                # native roll did not reconcile to a ~0 pre-history balance). Both
                # are permanent/structural — retrying cannot help — so they take the
                # IDENTICAL disposition as LedgerValuationError: permanent FAILED,
                # scrubbed message (the core errors already carry codes/counts/ratios
                # only — still scrubbed), and a terminal analytics stamp so the
                # wizard reaches a gate instead of an infinite 'computing' spinner.
                # Caught in this SAME try as the crawl so a native refusal is never
                # misclassified transient 'unknown' and retried forever (T-80-10).
                scrubbed = str(scrub_freeform_string(str(exc)))
                await _stamp_strategy_analytics_failed(
                    "Deribit native NAV reconstruction refused a structural input "
                    "(a value-bearing currency with no USD mark, or the "
                    "full-history roll did not reconcile to inception). " + scrubbed
                )
                return DispatchResult(
                    outcome=DispatchOutcome.FAILED,
                    error_message=(
                        "derive_broker_dailies: deribit native NAV reconstruction "
                        "refused structurally — " + scrubbed
                    ),
                    error_kind="permanent",
                )
            # The dated external flows are already inside the NativeLedger the core
            # reconstructed (native_flows, re-valued at the core's own day marks);
            # they are surfaced here for the DQ-02 terminus evidence gate (a no-op
            # for deribit — full_history has no retention cap → terminus is None).
            external_flows = _completeness.dated_external_flows
            # Funding is inside the ledger settlement cash delta — count-once
            # (D-08). The native path has no flat realized-records list; realized/
            # funding are retained (empty) only for the downstream log lines.
            funding: list[Any] = []
            realized: list[Any] = []
        elif venue == "sfox":
            # SFOX-06 kill-switch chokepoint: the QUEUE-executed path must honor the
            # founder go-live gate too, not just the request-facing routes. The DB
            # CHECK admits 'sfox' unconditionally and the derive-allocator-key cron
            # fans out one derive_broker_dailies per eligible key with NO exchange
            # filter, so after SFOX_ENABLED is turned off (an incident rollback — the
            # exact purpose of the switch) a stored sfox key would keep firing live
            # sFOX crawls here every run. Gate BEFORE any decrypt/crawl. Permanent
            # (not transient): the founder disabled it deliberately, so retrying is
            # wrong — it fails cleanly and stops, never a live read while disabled.
            if not sfox_enabled_server():
                return DispatchResult(
                    outcome=DispatchOutcome.FAILED,
                    error_message=f"derive_broker_dailies: {SFOX_DISABLED_DETAIL}",
                    error_kind="permanent",
                )
            # ── SFOX-05: the sFOX broker-dailies ONE-path (plan 120-03) ──
            # sFOX is the SIMPLEST broker-dailies venue: /v1/account/balance/history
            # HANDS us the daily usd_value NAV series directly, so there is NO
            # ledger reconstruction (no per-currency backward roll). We read the NAV
            # series + the typed transaction ledger, EACH crawl HARD-BOUNDED by
            # asyncio.wait_for (the FLIPRETRY-01 worker-wedge guard: a slow/hanging
            # live crawl becomes a classified TRANSIENT failure, never a wedge of the
            # SEQUENTIAL worker loop — the v1.11 FLIP rollback root cause), gate
            # honesty (a truncated/under-fetched crawl, an unvaluable flow, and a
            # materially-funded-but-uninterpretable account each fail loud), then feed
            # combine_sfox_balance_history → the UNCHANGED shared derive/persist below
            # (the ccxt combine at :2645 is excluded via _NATIVE_RETURNS_VENUES).
            from services.broker_dailies import combine_sfox_balance_history
            from services.sfox_read import (
                SfoxCrawlTruncatedError,
                SfoxFlowValuationError,
                crawl_sfox_balance_history,
                crawl_sfox_transactions,
                sfox_flows_by_day,
            )

            _sfox_now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
            try:
                # FLIPRETRY-01: EACH crawl is wall-clock bounded. asyncio.wait_for
                # cancels the inner crawl on timeout and raises asyncio.TimeoutError.
                _bh_rows, _earliest_ms = await asyncio.wait_for(
                    crawl_sfox_balance_history(
                        ctx.exchange,
                        start_date_ms=_SFOX_FAR_PAST_EPOCH_MS,
                        end_date_ms=_sfox_now_ms,
                    ),
                    timeout=_SFOX_CRAWL_TIMEOUT_S,
                )
                # The transactions crawl uses its OWN budget-sized bound (10s/req
                # rate × 50-page budget) — the 300s balance-history bound would
                # false-time-out a >30-page ledger into an infinite transient retry.
                _txn_rows = await asyncio.wait_for(
                    crawl_sfox_transactions(
                        ctx.exchange,
                        from_ms=_SFOX_FAR_PAST_EPOCH_MS,
                        to_ms=_sfox_now_ms,
                    ),
                    timeout=_SFOX_TXN_CRAWL_TIMEOUT_S,
                )
            except asyncio.TimeoutError:
                # A hang is a CLASSIFIED, RETRYABLE transient — NEVER permanent,
                # NEVER an unbounded wedge, and NO terminal `failed` stamp (the next
                # attempt may succeed). The `finally: aclose_exchange` below still
                # runs (bounded SfoxClient.aclose). This is the FLIPRETRY-01 guard.
                # Bound-agnostic: this arm covers BOTH sfox crawls (balance-history
                # at _SFOX_CRAWL_TIMEOUT_S and transactions at the larger
                # _SFOX_TXN_CRAWL_TIMEOUT_S), so it does not name a single number.
                logger.warning(
                    "derive_broker_dailies: sfox crawl exceeded its per-crawl "
                    "wall-clock bound (label=%s) — classified transient, retrying "
                    "(FLIPRETRY-01)",
                    funding_label,
                )
                return DispatchResult(
                    outcome=DispatchOutcome.FAILED,
                    error_message=(
                        "derive_broker_dailies: sfox crawl exceeded its per-crawl "
                        "wall-clock bound — retrying rather than wedging the worker "
                        "(FLIPRETRY-01)"
                    ),
                    error_kind="transient",
                )
            except SfoxCrawlTruncatedError as exc:
                # The assert_ledger_complete analog (D-02 honesty gate): a
                # silently-partial read must NEVER become a complete track record.
                # Permanent FAILED + terminal stamp — retrying cannot help.
                scrubbed = str(scrub_freeform_string(str(exc)))
                await _stamp_strategy_analytics_failed(
                    "sFOX history crawl could not be verified as complete. "
                    + scrubbed
                )
                return DispatchResult(
                    outcome=DispatchOutcome.FAILED,
                    error_message=(
                        "derive_broker_dailies: sfox crawl truncated/under-fetched "
                        "— " + scrubbed
                    ),
                    error_kind="permanent",
                )

            # Parse the balance-history rows → the usd_value pd.Series and extract
            # the typed daily flow series + ExternalFlow evidence. A typed
            # unvaluable-flow error (non-USD-family currency, malformed amount,
            # unrecognized action) OR a non-finite/garbage NAV point → permanent
            # FAILED + stamp (the LedgerValuationError disposition parity).
            try:
                _usd_value = _sfox_rows_to_usd_value_series(_bh_rows)
                _flows_series, _flow_evidence = sfox_flows_by_day(_txn_rows)
            except SfoxFlowValuationError as exc:
                scrubbed = str(scrub_freeform_string(str(exc)))
                await _stamp_strategy_analytics_failed(
                    "sFOX ledger contained a value that could not be interpreted "
                    "(a non-USD-family flow, a malformed amount, an unrecognized "
                    "action, or a non-finite NAV point). " + scrubbed
                )
                return DispatchResult(
                    outcome=DispatchOutcome.FAILED,
                    error_message=(
                        "derive_broker_dailies: sfox ledger value unvaluable — "
                        + scrubbed
                    ),
                    error_kind="permanent",
                )

            # Material-balance floor (the deribit C2 analog, venue-agnostic): a
            # materially-funded account that produced <2 usable observed NAV days is
            # a silently-empty (green) track record (broken key / wrong account),
            # NOT genuine "insufficient history". Fail loud BEFORE combine. A
            # genuinely tiny/empty account (terminal balance below the floor) instead
            # flows to the honest downstream <2-day gate (:2931) — no invented rows.
            _sfox_terminal_usd = (
                float(_usd_value.iloc[-1]) if len(_usd_value) else 0.0
            )
            _sfox_usable_nav_days = int(_usd_value.notna().sum())
            if (
                abs(_sfox_terminal_usd) > _DERIBIT_EMPTY_LEDGER_FLOOR_USD
                and _sfox_usable_nav_days < 2
            ):
                await _stamp_strategy_analytics_failed(
                    "sFOX account holds material equity but produced no "
                    "interpretable daily history."
                )
                return DispatchResult(
                    outcome=DispatchOutcome.FAILED,
                    error_message=(
                        "derive_broker_dailies: sfox account holds material equity "
                        f"(~{abs(_sfox_terminal_usd):.0f} USD) but produced <2 "
                        "usable NAV days — refusing an empty-but-green track record"
                    ),
                    error_kind="permanent",
                )

            # THE combine: usd_value NAV + typed flows → cashflow-neutral daily TWR
            # via the EXISTING chain_linked_twr (flow-in-numerator, full DQ-01 guard
            # set). No new backbone call site — (returns, meta) fall through to the
            # UNCHANGED derive_basis_series / persist_basis_series below.
            try:
                returns, meta = combine_sfox_balance_history(
                    _usd_value, _flows_series
                )
            except NavReconstructionError as exc:
                # CR-01 defense-in-depth: a STRUCTURAL NAV/TWR refusal from the
                # shared core must dispose PERMANENT with a terminal stamp — the
                # IDENTICAL disposition as the ccxt combine seam (:2934) and the
                # deribit native handler (:2589). This combine sits INSIDE the sfox
                # branch, whose only typed catches are asyncio.TimeoutError /
                # SfoxCrawlTruncatedError / SfoxFlowValuationError, and the enclosing
                # outer try catches ONLY ccxt.RateLimitExceeded — so without this
                # catch a NavReconstructionError escapes to the generic dispatcher →
                # retried FOREVER as `unknown` (T-74-02/T-80-10 DoS) with NO scrubbed
                # terminal `failed` stamp (the wizard spins on 'computing'). The
                # CR-01 union above already books the common boundary-flow case
                # cashflow-neutral (no raise); THIS guards a genuinely structural
                # residual (schema drift) so it reaches a terminal gate, never a spin.
                return await _dispose_broker_nav_error(
                    exc,
                    stamp_detail=(
                        "sFOX NAV/TWR reconstruction refused a structural input "
                        "(an orphan/undatable flow or a non-finite NAV/flow amount). "
                    ),
                    result_detail=(
                        "derive_broker_dailies: sfox NAV/TWR reconstruction failed "
                        "structurally — "
                    ),
                )

            # Set the shared downstream variables EXACTLY as the deribit branch does
            # so the post-dispatch code runs unchanged. usd_value IS the total MTM
            # equity of a spot NAV series — there is NO separate open-uPnL wedge — so
            # open_unrealized_usd is 0.0 and upnl_unreadable is False (the :2720
            # unreadable-uPnL warning never fires for sfox). sFOX returns are NATIVE
            # (already TWR from the NAV series) → no flat realized/funding record
            # list, mirroring the deribit branch's empty lists.
            equity = _sfox_terminal_usd
            balance_error = False
            open_unrealized_usd = 0.0
            upnl_unreadable = False
            funding = []
            realized = []
            # external_flows is the DQ-02 evidence shape the downstream terminus gate
            # consumes. The deribit branch sets it to _completeness.dated_external_flows
            # — a list[ExternalFlow] (deribit_ingest.py:732). sfox_flows_by_day yields
            # the SAME list[ExternalFlow] type (sfox_read.py:238), so the downstream
            # consumer accepts it identically. Shape parity CONFIRMED.
            external_flows = _flow_evidence
        else:
            # Current total equity = the initial-capital anchor (anchor-to-today,
            # reconstruct backward). OKX is read via raw totalEq inside
            # fetch_account_equity_and_upnl_usd (ccxt fetch_balance crashes on OKX).
            # FLOW-04 (v1.8): the venue-gated companion open-uPnL wedge rides the
            # SAME response (OKX upl; Bybit/Binance structural 0.0 — realized-basis
            # walletBalance, so a downstream subtract can never double-count, 77-02).
            # FLIPRETRY-01: the equity anchor + full-history trades + funding are
            # LIVE crawls (fetch_all_trades on the bybit-19k account was a named
            # v1.11 wedge) — bound EACH by asyncio.wait_for so a slow/hanging read
            # becomes a classified transient at the bound, never an unbounded wedge
            # of the SEQUENTIAL worker loop. Mirrors the ccxt flow-crawl block below
            # (:2945) and the deribit/sfox blocks: one shared TimeoutError arm,
            # static text, never logger.exception. The unsupported-venue branch is a
            # PERMANENT classification (a return, not a raise) so the timeout arm
            # never sees it.
            try:
                equity, balance_error, open_unrealized_usd, upnl_unreadable = (
                    await asyncio.wait_for(
                        fetch_account_equity_and_upnl_usd(ctx.exchange, venue),
                        timeout=_BROKER_CRAWL_TIMEOUT_S,
                    )
                )
                # since_ms=None ⇒ ENTIRE account history (OKX inception via archive
                # bills, Binance inception, Bybit last 365 days).
                realized = await asyncio.wait_for(
                    fetch_all_trades(ctx.exchange, since_ms=None),
                    timeout=_BROKER_CRAWL_TIMEOUT_S,
                )
                if venue == "binance":
                    funding = await asyncio.wait_for(
                        fetch_funding_binance(ctx.exchange, funding_label, None),
                        timeout=_BROKER_CRAWL_TIMEOUT_S,
                    )
                elif venue == "okx":
                    funding = await asyncio.wait_for(
                        fetch_funding_okx(ctx.exchange, funding_label, None),
                        timeout=_BROKER_CRAWL_TIMEOUT_S,
                    )
                elif venue == "bybit":
                    funding = await asyncio.wait_for(
                        fetch_funding_bybit(ctx.exchange, funding_label, None),
                        timeout=_BROKER_CRAWL_TIMEOUT_S,
                    )
                else:
                    return DispatchResult(
                        outcome=DispatchOutcome.FAILED,
                        error_message=f"derive_broker_dailies: venue {venue} not supported",
                        error_kind="permanent",
                    )
            except asyncio.TimeoutError:
                logger.warning(
                    "derive_broker_dailies: ccxt equity/trades/funding crawl exceeded "
                    "the %ss per-crawl bound (venue=%s, label=%s) — classified "
                    "transient, retrying (FLIPRETRY-01)",
                    _BROKER_CRAWL_TIMEOUT_S, venue, funding_label,
                )
                return DispatchResult(
                    outcome=DispatchOutcome.FAILED,
                    error_message=(
                        "derive_broker_dailies: ccxt equity/trades/funding crawl "
                        f"exceeded the per-crawl wall-clock bound ({_BROKER_CRAWL_TIMEOUT_S}s)"
                        " — retrying rather than wedging the worker (FLIPRETRY-01)"
                    ),
                    error_kind="transient",
                )
            # FLOW-03 (v1.8): enumerate + event-time-value real deposits/
            # withdrawals for the ccxt venues (binance/okx/bybit) and thread
            # them into the honest core's F_t term at the SAME seam the deribit
            # branch uses (external_flows → combine_realized_and_funding →
            # reconstruct_nav_and_twr). Read-only keys DO enumerate transfers now
            # (76-01 promoted fetch), so a mid-window deposit no longer silently
            # inflates the TWR (broker_dailies premise updated). The
            # derive_broker_dailies path is now the unconditional follow-on
            # (the funding kill-switch flag was retired in 106-08),
            # so flows need no extra guard. Bound the flow lookback to the
            # venue's deposit-history retention (OKX 90d / Bybit 365d); Binance
            # (no cap → None) fetches full history. This never spins empty
            # pre-inception windows AND the DQ-02 terminus (below) segments any
            # window the return series extends before that retention.
            _now_utc = datetime.now(timezone.utc)
            now_ms = int(_now_utc.timestamp() * 1000)
            # LOW-2: derive the flow-fetch lower bound from the SAME normalized
            # retention floor (midnight(now) − retention) the DQ-02 terminus gate
            # uses (flow_retention_floor), NOT a wall-clock `now − retention`. The
            # two "retention" definitions now share ONE source so they can never
            # drift by the ≤1-day midnight-vs-wall-clock gap as the constants are
            # tuned at P78. A no-cap venue (Binance) → None → since=0 (full history).
            _retention_floor = flow_retention_floor(venue, _now_utc)
            _flow_since_ms = (
                0
                if _retention_floor is None
                else max(0, int(_retention_floor.timestamp() * 1000))
            )
            # WR-04: fetch_ccxt_transfers bubbles every error but
            # ccxt.NotSupported (a transient auth/network blip stays RETRYABLE,
            # never a silent truncation), so these are NOT wrapped in a
            # segment-converting catch — a transient fetch error must reach the
            # outer dispatcher classifier, never be mistaken for a coverage gap.
            # FLIPRETRY-01: EACH live crawl (both transfer fetches + the price-index
            # resolve, which may hit venue OHLCV I/O) is HARD-BOUNDED by
            # asyncio.wait_for so a slow/hanging read (bybit 19k rows was the v1.11
            # wedge) becomes a classified transient at the bound, never an unbounded
            # wedge of the SEQUENTIAL worker loop. The wait_for wraps ONLY the awaits:
            # a non-timeout fetch error still bubbles to the dispatcher classifier
            # exactly as WR-04 requires (wait_for re-raises the inner exception
            # unchanged), and the HIGH-1 pure-valuer NavReconstructionError disposition
            # (its own try below) is untouched. Mirrors the sfox block (:2680): one
            # shared TimeoutError arm, static scrubbed text, never logger.exception.
            try:
                _deposits = await asyncio.wait_for(
                    fetch_ccxt_transfers(
                        ctx.exchange, "deposits", _flow_since_ms, now_ms
                    ),
                    timeout=_BROKER_CRAWL_TIMEOUT_S,
                )
                _withdrawals = await asyncio.wait_for(
                    fetch_ccxt_transfers(
                        ctx.exchange, "withdrawals", _flow_since_ms, now_ms
                    ),
                    timeout=_BROKER_CRAWL_TIMEOUT_S,
                )
                _flow_rows = list(_deposits) + list(_withdrawals)
                # Resolve the same-UTC-day close for every NON-STABLE flow currency
                # (I/O — reuses the existing OHLCV/CoinGecko/token_price_history
                # source; NO new price fetcher). The pure valuer marks stablecoins at
                # 1.0 and FAILS LOUD if a non-stable flow has no same-day price (never
                # 1.0 / current / drop → never a fabricated ±return that mis-anchors
                # the TWR base).
                _price_index = await asyncio.wait_for(
                    _resolve_ccxt_flow_price_index(
                        ctx.exchange, venue, ctx.supabase, _flow_rows
                    ),
                    timeout=_BROKER_CRAWL_TIMEOUT_S,
                )
            except asyncio.TimeoutError:
                # FLIPRETRY-01: a ccxt flow crawl exceeded the per-crawl bound. A hang
                # is a CLASSIFIED, RETRYABLE transient — NEVER permanent, NEVER an
                # unbounded wedge, no terminal stamp. The `finally: aclose_exchange`
                # below still runs. (asyncio.TimeoutError is caught HERE, locally, so a
                # transient network/parse error from fetch_ccxt_transfers still bubbles
                # to the outer dispatcher classifier per WR-04 — this arm only ever sees
                # the wait_for timeout.)
                logger.warning(
                    "derive_broker_dailies: ccxt flow crawl exceeded the %ss "
                    "per-crawl bound (venue=%s, label=%s) — classified transient, "
                    "retrying (FLIPRETRY-01)",
                    _BROKER_CRAWL_TIMEOUT_S, venue, funding_label,
                )
                return DispatchResult(
                    outcome=DispatchOutcome.FAILED,
                    error_message=(
                        "derive_broker_dailies: ccxt flow crawl exceeded the "
                        f"per-crawl wall-clock bound ({_BROKER_CRAWL_TIMEOUT_S}s) — "
                        "retrying rather than wedging the worker (FLIPRETRY-01)"
                    ),
                    error_kind="transient",
                )
            # HIGH-1: the PURE flow valuer raises NavReconstructionError
            # (permanent, structural) on the realistically-common case of a
            # non-stable coin flow with no resolvable same-UTC-day price AND on
            # schema-drift amounts (whose message carries ``amount={raw!r}``). It
            # sits INSIDE the fetch try, which only catches ccxt.RateLimitExceeded,
            # so without this split it escapes to the generic dispatcher → retried
            # FOREVER as `unknown` (T-74-02) with NO scrubbed terminal `failed`
            # stamp (wizard spins on 'computing') and the raw amount LEAKS
            # unscrubbed to compute_jobs.error_message (T-74-03). The WR-04
            # transient-bubble comment above is correct ONLY for the fetch — the
            # pure valuation is disposed permanent with the SAME terminal
            # disposition as the combine site below.
            try:
                external_flows = ccxt_rows_to_dated_flows(
                    _flow_rows, venue=venue, price_index=_price_index
                )
            except NavReconstructionError as exc:
                return await _dispose_broker_nav_error(
                    exc,
                    stamp_detail=(
                        "Broker flow valuation failed on a structural input (a "
                        "coin flow with no same-UTC-day price, or a schema-drifted"
                        "/undatable/non-finite flow amount). "
                    ),
                    result_detail=(
                        "derive_broker_dailies: ccxt flow valuation failed "
                        "structurally — "
                    ),
                )
    except ccxt.RateLimitExceeded as exc:
        await _stamp_429(ctx.supabase, ctx.key_row, exc)
        raise
    finally:
        try:
            await aclose_exchange(ctx.exchange)
        except Exception:  # pragma: no cover
            pass

    # v1.9 NATIVE SWITCH: the deribit venue already produced (returns, meta) via
    # the native core above (combine_native_ledger), with its per-currency wedge
    # subtracted INSIDE the core (App A #6) and materiality re-derived from the
    # collapsed anchor. SFOX-05: the sfox venue likewise already produced
    # (returns, meta) via combine_sfox_balance_history. The USD-space noise-guard
    # + combine below are the CCXT venues' path only — running
    # combine_realized_and_funding for a NATIVE-returns venue would OVERWRITE its
    # reconstructed returns with an empty realized/funding stream (the
    # money-critical clobber). Both native venues are excluded via the single
    # _NATIVE_RETURNS_VENUES set; deribit's exclusion is byte-identical to the
    # prior `!= "deribit"`.
    if venue not in _NATIVE_RETURNS_VENUES:
        # FLOW-04 (v1.8) NOISE GUARD (Pitfall 5 / T-77-08): the companion open-uPnL
        # wedge is only trustworthy relative to a trustworthy anchor. Force it to
        # 0.0 when the anchor is heuristic/dust — a balance_error read, a missing
        # equity, or a dust base (|equity| <= DUST_NAV_FLOOR, where the materiality
        # ratio is meaningless and a divide-by-tiny explodes into a false positive).
        # The wedge is NEVER subtracted onto such a base; a healthy anchor keeps the
        # real wedge.
        if (
            balance_error
            or equity is None
            or abs(equity) <= DUST_NAV_FLOOR
        ):
            open_unrealized_usd = 0.0

        try:
            # FLOW-04: the venue-gated, noise-guarded wedge threads into the honest
            # core's terminal seam (broker_dailies passes it straight to
            # reconstruct_nav_and_funding). The stored/displayed MTM equity anchor
            # is KEPT full — the reported CURRENT NAV re-add is DEFINITIONAL, so the
            # derive path writes ONLY csv_daily_returns and never mutates `equity`
            # (Q4 tail). OKX subtracts the real wedge (realized-basis terminal);
            # Bybit/Binance passed 0.0 above (no double-count).
            returns, meta = combine_realized_and_funding(
                realized, funding, account_balance=equity,
                balance_error=balance_error,
                external_flows=external_flows,
                open_unrealized_usd=open_unrealized_usd,
            )
        except NavReconstructionError as exc:
            # A STRUCTURAL NAV/TWR reconstruction failure surfacing from the honest
            # core (services.nav_twr) via combine_realized_and_funding — a schema
            # -drifted flow amount, an undatable/orphan flow, or a non-finite pnl.
            # This call sits OUTSIDE the deribit try, so without this typed catch
            # the error escapes to the generic dispatcher classifier and is retried
            # FOREVER as `unknown` (T-74-02 DoS). Narrowed to the TYPED subclass so
            # a transient ValueError (network parse blip) still falls through to the
            # generic handler and stays transient-retryable. Disposed via the SHARED
            # helper so this seam and the ccxt flow-valuation seam (HIGH-1) can never
            # drift.
            return await _dispose_broker_nav_error(
                exc,
                stamp_detail=(
                    "Broker return reconstruction failed on a structural input "
                    "(schema drift, undatable/orphan flow, or a non-finite amount). "
                ),
                result_detail=(
                    "derive_broker_dailies: broker NAV/TWR reconstruction failed "
                    "structurally — "
                ),
            )

    # FLOW-04 (v1.8): the open-uPnL materiality flag lives in ONE place — the honest
    # core (reconstruct_nav_and_twr) raises unrealized_pnl_in_anchor when
    # |wedge|/anchor > UNREALIZED_MATERIALITY_RATIO (signed anchor), and
    # transforms._merge_status_meta now carries that key THROUGH additively (MEDIUM-1
    # single-source). So `meta["unrealized_pnl_in_anchor"]` is already set here when
    # the core judged the wedge material; the previous job_worker recompute (which
    # divided by abs(equity) and diverged on a negative anchor) is DELETED. The wedge
    # is 0.0 on every dust/heuristic/balance-error anchor (forced above), so combine
    # sees open_unrealized_usd == 0.0 there and the core never flags — the pre-77
    # byte-identity accounts stay `complete`.

    # MUST-2 (specialist-silentfailure HIGH-1/MEDIUM-1): the open-uPnL wedge
    # FIELD was unreadable on a marked-to-market venue (Deribit session_upl
    # absent on every summary / OKX upl absent-or-garbled while totalEq read
    # cleanly). A wrong/renamed field would otherwise silently coalesce to a 0.0
    # wedge — indistinguishable from a genuinely flat book — leaving the full MTM
    # equity in the terminal, rescaling every return, and NEVER firing
    # unrealized_pnl_in_anchor (factsheet ships `complete`). Surface
    # unrealized_pnl_unreadable → complete_with_warnings so the wrong field name
    # is LOUD. Gated on a TRUSTWORTHY anchor: on a balance-error / missing / dust
    # base the wedge is already force-zeroed above and this warning would be
    # noise (the anchor itself is the flagged problem there). Bybit/Binance never
    # reach here as unreadable (realized-basis walletBalance has no wedge field).
    if upnl_unreadable and not (
        balance_error or equity is None or abs(equity) <= DUST_NAV_FLOOR
    ):
        meta["unrealized_pnl_unreadable"] = True

    # DQ-02 (v1.8): apply the flow-coverage terminus gate POST-COMBINE. When the
    # return window extends BEFORE the venue's deposit-history retention (OKX 90d /
    # Bybit 365d — Binance has no cap → None), the earliest capital moves are
    # UNFETCHABLE, so the pre-terminus reconstructed NAV cannot be trusted. The
    # standalone pure helper (nav_twr, 76-03) NaNs the pre-terminus days (refusing
    # a fabricated return over the gap) and raises the flow_coverage_incomplete
    # flag. Applied on the returns Series here — NOT threaded through transforms.py
    # — so the Phase 74 byte-identity pins stay GREEN. Only the set start-day
    # signal segments; a transient fetch error already bubbled retryable above
    # (WR-04), so a blip can never reach here as an over-truncation (T-76-04-TRANS).
    if not returns.empty:
        # The combined returns index is tz-NAIVE UTC calendar days
        # (gap_fill_daily_returns → pd.date_range), so supply a tz-naive UTC
        # `now` to the pure terminus helper (76-03) — a tz-aware value would
        # raise "Cannot compare tz-naive and tz-aware timestamps".
        _flow_coverage_start_day = flow_coverage_terminus_day(
            venue,
            first_return_day=returns.index[0],
            now_utc=datetime.now(timezone.utc).replace(tzinfo=None),
        )
        # CRITICAL-1 (v1.8 xhigh red team): the terminus mechanics above answer
        # "IF a flow gap exists, where is it?" — but the OLD wiring fired it
        # UNCONDITIONALLY for every past-retention window, blanket-truncating a
        # FLOW-LESS OKX/Bybit account's years of correct history to the retention
        # window and stamping flow_coverage_incomplete even with a clean positive
        # reconstructed NAV. That contradicts the "full history of a key" goal and
        # broke the SC-4 byte-identity invariant. Gate segmentation on EVIDENCE of
        # an actually-truncated flow: a pre-terminus negative-NAV guard (the harm
        # manifested) OR a real fetched flow at/near the retention floor (older
        # flows plausibly exist just beyond the unfetchable boundary). A flow-less
        # account with clean NAV has neither → keep FULL history, stay `complete`.
        if _flow_coverage_start_day is not None:
            _guard_pre_terminus = negative_nav_guard_pre_terminus(
                returns,
                terminus=_flow_coverage_start_day,
                negative_nav_guard_fired=bool(meta.get("negative_nav_guard")),
            )
            if not flow_coverage_gap_evidence(
                external_flows=external_flows,
                retention_floor=_retention_floor,
                pre_terminus_nav_guard_fired=_guard_pre_terminus,
            ):
                _flow_coverage_start_day = None  # no evidence → retain full history
        returns, _coverage_flags = apply_flow_coverage_terminus(
            returns, _flow_coverage_start_day
        )
        if _coverage_flags.get("flow_coverage_incomplete"):
            meta["flow_coverage_incomplete"] = True

    async def _run_key_mode_compose_epilogue() -> None:
        # ── 115.1 RD-3 OPTION B — key-mode compose epilogue ──────────────────
        # This derive ALREADY crawled the real external flows and read the live
        # account equity anchor above (deribit: the native ledger crawl +
        # account_state.collapsed_equity_usd; ccxt: fetch_ccxt_transfers +
        # fetch_account_equity_and_upnl_usd). Persist those ALREADY-FETCHED
        # inputs onto the NEW keyed surface as kind='key_inputs:<api_key_id>' so
        # the crawl-free `derive_allocator_equity` compose job never has to
        # decrypt the key or hit the exchange a SECOND time — then enqueue that
        # compose job for the AUTHORITATIVE owner. Self-healing: any key refresh
        # re-composes the whole allocator with zero added exchange I/O.
        #
        # F1(a): this runs for BOTH the >=2-day path AND the <2-day short-circuit
        # (an idle/short key with real capital must still land its anchored
        # key_inputs row so the compose core sees it — anchored-without-returns →
        # DROPPED_KEY → untrustworthy — instead of silently vanishing from a
        # "Derived" curve that understates its capital). The anchor + flows are
        # already fetched above, so this is I/O-cheap.
        import math

        # M1: Postgres JSONB rejects NaN/Inf, so a non-finite float would fail the
        # key_inputs upsert and bubble as a transient error → re-crawl loop. These
        # flows already passed the honest core, so a non-finite here is corruption:
        # SKIP it honestly (the drop is visible via the count log below), never
        # persist poison.
        _flows_payload = []
        _skipped_nonfinite_flows = 0
        for _f in (external_flows or []):
            _usd = float(_f.usd_signed)
            if not math.isfinite(_usd):
                _skipped_nonfinite_flows += 1
                continue
            _flows_payload.append(
                {"utc_day_iso": _f.utc_day_iso, "usd_signed": _usd}
            )
        # DERIVATIVE-NOTIONAL TRAP (T-115.1-16): the anchor is the venue's own
        # LIVE total-equity read (`equity` above) — deribit's collapsed native
        # equity or the ccxt fetch_account_equity_and_upnl_usd NAV — NOT an
        # allocator_holdings sum, and NEVER a blind value_usd sum (value_usd on a
        # derivative is NOTIONAL contract size, not equity). An untrustworthy read
        # (balance_error truthy or equity is None) persists an honest null anchor,
        # never a heuristic fallback; the compose core then honestly DROPS the key.
        # The anchor is trustworthy ONLY when it is a material, positive, finite
        # venue-equity read. Persist a null anchor (compose core then DROPS the key)
        # on every other case:
        #   M1  — non-finite (NaN/Inf) would poison the JSONB upsert;
        #   M2  — dust (|equity| <= DUST_NAV_FLOOR) is immaterial (mirrors the
        #         function's materiality contract at :2651-2655) and a NON-POSITIVE
        #         equity would make replay_key_equity raise non-positive-equity,
        #         permanently FAILING the WHOLE allocator compose. Both → null, not a
        #         permanent fail / a trustworthy near-zero curve basis.
        #   F3  — if ANY flow was DROPPED as non-finite above, the backward replay
        #         mis-levels the reconstructed curve with NO degrade signal. Null the
        #         anchor so the key degrades honestly (compose DROPS it) rather than
        #         reading trustworthy over a silently mis-leveled curve.
        #
        # F1a×F3/M2 seam: STAMP anchor_null_reason so the compose core can tell a
        # DUST null (materiality — silently omit, never pin the allocator to legacy)
        # apart from a REAL-CAPITAL read failure (balance_error/nonpositive/
        # nonfinite/flow_drop — degrade to legacy). Without the token a null-anchor
        # key that is ALSO absent from the returns axis (the <2-day / never-traded
        # idle key) falls into NONE of compose's B3 buckets → invisible → a
        # trustworthy partial curve. Order matters: nonpositive is checked BEFORE
        # dust so a small NEGATIVE equity (|equity| <= DUST but a real-capital
        # problem) degrades rather than being silently omitted as dust.
        _anchor_null_reason: str | None = None
        if balance_error or equity is None:
            _anchor_null_reason = "balance_error"
        elif not math.isfinite(float(equity)):
            _anchor_null_reason = "nonfinite"
        elif equity <= 0.0:
            _anchor_null_reason = "nonpositive"
        elif abs(equity) <= DUST_NAV_FLOOR:
            _anchor_null_reason = "dust"
        elif _skipped_nonfinite_flows > 0:
            _anchor_null_reason = "flow_drop"
        # equity is provably non-None when _anchor_null_reason is None (the
        # `equity is None` branch above stamps "balance_error"); the explicit
        # `equity is not None` is a mypy narrowing that changes no runtime path.
        _anchor_usd: float | None = (
            float(equity)
            if _anchor_null_reason is None and equity is not None
            else None
        )
        _key_inputs_payload = {
            "flows": _flows_payload,
            "anchor_usd": _anchor_usd,
            # A present/real anchor carries no reason token (None); a null anchor
            # records WHY so compose can gate dust-omit vs real-failure-degrade.
            "anchor_null_reason": _anchor_null_reason,
            "anchor_asof": datetime.now(timezone.utc).isoformat(),
            "venue": venue,
        }

        def _persist_key_inputs(
            payload: dict[str, Any] = _key_inputs_payload,
            kind: str = "key_inputs:" + api_key_id,
        ) -> None:
            ctx.supabase.table("allocator_equity_derived").upsert(
                {
                    "allocator_id": allocator_id,
                    "kind": kind,
                    "payload": payload,
                    "computed_at": datetime.now(timezone.utc).isoformat(),
                },
                on_conflict="allocator_id,kind",
            ).execute()

        # Transient DB errors BUBBLE (the job retries; the csv upsert is
        # idempotent, and the compose enqueue below is dedup-safe) — no silent
        # swallow, no outcome downgrade.
        await db_execute(_persist_key_inputs)

        # Enqueue the crawl-free compose for the AUTHORITATIVE owner — read from
        # ctx.key_row['user_id'] via `allocator_id`, NEVER a job-payload
        # allocator_id (T-115.1-02 / T-115-16 owner-spoof pin). A one-inflight
        # dedup collision is benign (the enqueue RPC is idempotent); a hard
        # enqueue failure is logged and swallowed — the per-key inputs are already
        # persisted and the next key refresh re-enqueues cleanly, so a compose
        # enqueue hiccup must never fail an already-done per-key derive.
        try:
            def _enqueue_compose(target: str = allocator_id) -> None:
                # p_strategy_id is passed EXPLICITLY as NULL — it is the RPC's
                # first positional param and has NO SQL DEFAULT, so a PostgREST
                # named-notation call that omits it cannot resolve the overload
                # ("function does not exist") and the compose would never enqueue.
                # Every SQL caller mirrors this (`p_strategy_id := NULL`); the
                # allocator-scoped inflight dedup (allocator_id,kind) makes a
                # collision benign, so no p_idempotency_key is required here.
                ctx.supabase.rpc(
                    "enqueue_compute_job",
                    {
                        "p_strategy_id": None,
                        "p_allocator_id": target,
                        "p_kind": "derive_allocator_equity",
                    },
                ).execute()

            await db_execute(_enqueue_compose)
        except Exception as _enq_exc:  # noqa: BLE001
            logger.warning(
                "derive_broker_dailies: compose enqueue for allocator %s failed "
                "(api_key %s) — per-key inputs persisted; next key refresh "
                "re-enqueues: %s",
                allocator_id, api_key_id, _enq_exc,
            )

        # Log carries NO USD magnitudes (T-115-05): key/allocator/venue + counts +
        # an anchor-present bool only.
        logger.info(
            "derive_broker_dailies: Option-B epilogue persisted key_inputs + "
            "enqueued compose for api_key %s (allocator %s venue=%s n_flows=%d "
            "skipped_nonfinite_flows=%d anchor_present=%s)",
            api_key_id, allocator_id, venue, len(_flows_payload),
            _skipped_nonfinite_flows, _anchor_usd is not None,
        )

    if int(returns.notna().sum()) < 2:
        # Brand-new / inactive account: not enough history to compile a
        # factsheet (compute_all_metrics needs >=2 days). MEDIUM-2: gate on the
        # count of INTERPRETABLE (non-NaN) rows, not the NaN-inclusive length —
        # after the DQ-01 guards and the DQ-02 terminus segmentation the series may
        # still CONTAIN NaN rows (guarded / pre-terminus days), and only the
        # non-NaN rows are actually written to csv_daily_returns (74-04 NaN policy).
        # A NaN-inclusive `len(returns) >= 2` would pass here then write < 2 real
        # rows → a confusing two-step "insufficient history" CSV failure instead of
        # this clean brand-new-account short-circuit.
        if is_key_mode:
            # Key-mode has no per-key analytics row to stamp (per-key reads are
            # Phase 36) — log and return DONE without touching strategy_analytics.
            logger.info(
                "derive_broker_dailies: <2 daily-return days for api_key %s "
                "(realized=%d funding=%d) — key-mode insufficient-history, "
                "no strategy_analytics stamp",
                api_key_id, len(realized), len(funding),
            )
            # F1(a): STILL persist the Option-B key_inputs (anchor + flows already
            # fetched) and enqueue the compose. An idle/short key with real capital
            # must be visible to the compose core (anchored-without-returns →
            # DROPPED_KEY → untrustworthy → legacy fallback), never silently absent
            # from a "Derived" curve that understates its capital. No csv_daily_
            # returns / strategy_analytics write here — only the key_inputs surface.
            await _run_key_mode_compose_epilogue()
            return DispatchResult(outcome=DispatchOutcome.DONE)

        # Strategy-mode: stamp a TERMINAL 'failed' status so the wizard's
        # sync-preview poller reaches a gate instead of spinning forever on a
        # never-arriving 'complete' — mirrors run_csv_strategy_analytics' own
        # <2 branch and the legacy compute_analytics path. The next sync
        # re-derives once history grows.
        logger.info(
            "derive_broker_dailies: <2 daily-return days for strategy %s "
            "(realized=%d funding=%d) — marking insufficient-history",
            strategy_id, len(realized), len(funding),
        )

        def _mark_insufficient() -> None:
            ctx.supabase.table("strategy_analytics").upsert(
                {
                    "strategy_id": strategy_id,
                    "computation_status": "failed",
                    # SI-02 (MEDIUM-2): clear the runner-owned warned marker.
                    "computation_warned": False,
                    "computation_error": (
                        "Insufficient broker history. At least 2 days of "
                        "activity required."
                    ),
                    "data_quality_flags": {"csv_source": True},
                    # F-4 (Fable): authoritative-clear the by-basis column so a
                    # prior object can't render on a now-FAILED (insufficient) row.
                    "metrics_json_by_basis": None,
                },
                on_conflict="strategy_id",
            ).execute()

        await db_execute(_mark_insufficient)
        # D3 SECONDARY (Phase 105): this terminal insufficient-history arm exits BEFORE
        # the cash/MTM series persists below, so a stale series row from a prior
        # (longer-history) derive would outlive the now-authoritative 'failed'. Heal both
        # rows (defense-in-depth; the Plan-02 read gate is the guarantee).
        await _heal_delete_basis_series()
        return DispatchResult(outcome=DispatchOutcome.DONE)

    # Service-role upsert into csv_daily_returns. The worker has no auth.uid()
    # session so it cannot call persist_csv_daily_returns (auth-gated); it
    # writes the table directly like it does for trades. The per-axis unique
    # index (strategy_id,date) / (api_key_id,date) makes the re-derive
    # idempotent. Chunked so a long-history account can't exceed PostgREST's
    # request-size ceiling in a single upsert.
    import pandas as pd

    # 74-04 NaN policy (74-01 sink-(b) finding). The flow-aware core
    # (services.nav_twr) emits np.nan for a GUARDED day (estimated_start<=0 ->
    # negative_nav_guard, dust, or flow-dominated) rather than silently
    # substituting a floor. csv_daily_returns is DOUBLE PRECISION (it *stores*
    # NaN), but the postgrest-py/httpx JSON encoder raises "Out of range float
    # values are not JSON compliant: nan" BEFORE the request is sent — so a NaN
    # row would crash the upsert fail-loud. A guarded day has no interpretable
    # return, so it must be honestly ABSENT: SKIP the NaN row (never coerce to
    # 0.0, which would fabricate a flat return; never crash). Applied
    # identically to both the is_key_mode and strategy-mode payload builders.
    if is_key_mode:
        rows_payload = [
            {
                "api_key_id": api_key_id,
                "allocator_id": allocator_id,
                "strategy_id": None,
                "date": ts.date().isoformat(),
                "daily_return": float(val),
            }
            for ts, val in returns.items()
            if pd.notna(val)
        ]
        _conflict = "api_key_id,date"
    else:
        rows_payload = [
            {
                "strategy_id": strategy_id,
                "date": ts.date().isoformat(),
                "daily_return": float(val),
            }
            for ts, val in returns.items()
            if pd.notna(val)
        ]
        _conflict = "strategy_id,date"

    # MEDIUM-HIGH (v1.9 xhigh red team): make the derive AUTHORITATIVE for the
    # strategy's series WITHIN its reconstructed span — an upsert alone never
    # DELETES. A day the CURRENT derive REFUSES (NaN -> skipped above, 74-04) but a
    # PRIOR derive wrote keeps its stale row; at load (run_csv_strategy_analytics)
    # that day looks "present", the MEDIUM-1 NaN reinstatement does NOT fire, and
    # cumulative_twr_segmented COMPOUNDS the stale return across a day this
    # reconstruction refused -> the headline is BRIDGED across a stale value instead
    # of suffix-only. At the v1.9 native cutover the native core's per-day DQ guards
    # differ from the legacy USD rows that populated the table, so recomputed track
    # records would silently mix stale legacy returns into refused days.
    #
    # Reconcile the axis: DELETE the strategy's csv_daily_returns rows inside the
    # derive's AUTHORITATIVE span, then re-insert the fresh payload below. A refused
    # day thereby becomes honestly ABSENT (the load boundary reinstates its NaN).
    #
    # SPAN/SCOPE bound — the delete must NEVER remove legitimate out-of-scope
    # history. The authoritative span is EXACTLY the dense reconstructed calendar
    # [returns.index.min(), returns.index.max()]. `returns` here is the POST-terminus
    # dense Series (gap_fill_daily_returns -> pd.date_range, then the DQ-02 terminus
    # segmentation), so its min/max cleanly bound the span for BOTH venue classes:
    #   - full_history (Deribit, no retention cap): [min,max] IS the whole strategy
    #     series — every stored row is in-scope and authoritative.
    #   - retention-windowed (ccxt OKX/Bybit): [min,max] is only the reconstructed
    #     window. Rows OLDER than index.min() (written by an EARLIER derive when the
    #     retention floor sat further back) are strictly < span_start and fall
    #     OUTSIDE the ranged delete -> PRESERVED. The delete is a bounded gte/lte on
    #     `date`, so it can only touch days this derive actually reconstructed.
    _span_start = returns.index.min().date().isoformat()
    _span_end = returns.index.max().date().isoformat()

    def _reconcile_span_delete(
        span_start: str = _span_start, span_end: str = _span_end,
    ) -> None:
        _q = (
            ctx.supabase.table("csv_daily_returns")
            .delete()
            .gte("date", span_start)
            .lte("date", span_end)
        )
        # Scope on the SAME axis as the upsert conflict arbiter (per-key vs
        # per-strategy) so the reconcile can never cross-wipe a sibling series.
        if is_key_mode:
            _q = _q.eq("api_key_id", api_key_id)
        else:
            _q = _q.eq("strategy_id", strategy_id)
        _q.execute()

    await db_execute(_reconcile_span_delete)

    _UPSERT_CHUNK = 1000
    for _start in range(0, len(rows_payload), _UPSERT_CHUNK):
        _batch = rows_payload[_start:_start + _UPSERT_CHUNK]

        def _upsert_dailies(
            batch: list[dict[str, Any]] = _batch, conflict: str = _conflict
        ) -> None:
            ctx.supabase.table("csv_daily_returns").upsert(
                batch, on_conflict=conflict,
            ).execute()

        await db_execute(_upsert_dailies)

    if is_key_mode:
        # Per-key series is "dark" until Phase 36 — no compute_analytics_from_csv
        # enqueue (that path is strategy-keyed), no strategy_analytics stamp.
        logger.info(
            "derive_broker_dailies: upserted %d per-key daily-return rows for "
            "api_key %s (allocator %s venue=%s realized=%d funding=%d "
            "heuristic_capital=%s) — key-mode, no CSV-analytics enqueue",
            len(rows_payload), api_key_id, allocator_id, venue,
            len(realized), len(funding), meta.get("used_heuristic_capital"),
        )
        # F1(a): the SAME Option-B epilogue the <2-day short-circuit runs (one
        # helper, so the two key-mode exits can never drift on the persist/enqueue
        # contract).
        await _run_key_mode_compose_epilogue()
        return DispatchResult(outcome=DispatchOutcome.DONE)

    logger.info(
        "derive_broker_dailies: upserted %d daily-return rows for strategy %s "
        "(venue=%s realized=%d funding=%d heuristic_capital=%s)",
        len(rows_payload), strategy_id, venue, len(realized), len(funding),
        meta.get("used_heuristic_capital"),
    )

    # ── MTM-01 (Phase 101): compute the additive mark_to_market metrics object ──
    # STRATEGY-mode only (key-mode returned above). When the second pass produced a
    # series (mtm_returns is not None) compute its seven-scalar headline object with
    # the SAME conventions run_csv_strategy_analytics threads for the cash headline
    # (analytics_runner.py:2291-2316) so the MTM object is convention-comparable:
    # asset-class annualization clock (#597 √365 crypto / √252 traditional) + the
    # allocated-capital cumulative_method/day_basis (geometric+calendar when no
    # override). This is the single-key sibling of the composite MTM compute
    # (:3834-3840, 4018-4020) MINUS the cash key — the headline IS the cash truth
    # for single-key, and the strict basis-metrics.ts overlay stays byte-identical
    # only when cash_settlement is ABSENT from the by-basis object.
    from services.metrics import periods_per_year_for_asset_class
    from services.allocated_capital import metrics_day_basis
    from services.stitch_composite import MTM_REASON_SERIES_UNCOMPUTABLE
    from services.basis_series import (
        BasisSeriesResult,
        derive_basis_series,
        persist_basis_series,
    )

    mtm_metrics_json: dict[str, Any] | None = None
    _mtm_basis_result: BasisSeriesResult | None = None
    if mtm_returns is not None:
        _mtm_periods = periods_per_year_for_asset_class(
            ctx.strategy_row.get("asset_class")
            if isinstance(ctx.strategy_row, dict)
            else None
        )
        if denominator_config is not None:
            _mtm_cumulative = denominator_config.cumulative_method
            _mtm_day_basis = metrics_day_basis(denominator_config.metrics_basis)
        else:
            _mtm_cumulative = "geometric"
            _mtm_day_basis = "calendar"
        # Benchmark: guarded exactly like the composite (:3808-3817). The seven
        # guaranteed scalars are benchmark-INVARIANT, so a BTC benchmark blip must
        # NEVER gate MTM — on failure log a warning and compute benchmark_rets=None.
        from services.benchmark import get_benchmark_returns

        _mtm_benchmark_rets: pd.Series | None = None
        try:
            _mtm_benchmark_rets, _ = await get_benchmark_returns("BTC")
        except Exception as _bench_exc:  # noqa: BLE001
            logger.warning(
                "derive_broker_dailies: MTM benchmark fetch failed for strategy "
                "%s (computing mark_to_market without the benchmark family): %s",
                strategy_id, _bench_exc,
            )
        try:
            # Phase 103 (MTM-04): series + scalars from the ONE shared
            # derive_basis_series — the dailies-canonical route the backbone merge
            # extends. Scalars remain a derived cache (round-trip guard in
            # test_basis_series.py). dict(result.metrics_json) is the SAME
            # already-JSON-safe object the composite persists (degenerate scalars are
            # JSON null via _safe_float; postgrest rejects NaN, so never hand-build).
            # The helper propagates compute_all_metrics's ValueError by design, so the
            # surrounding degrade arm is untouched.
            _mtm_basis_result = derive_basis_series(
                mtm_returns,
                _mtm_benchmark_rets,
                periods_per_year=_mtm_periods,
                cumulative_method=_mtm_cumulative,
                day_basis=_mtm_day_basis,
                # Phase 104 (104-SC5): carry the benchmark IDENTITY STRING in the
                # persisted MTM conventions echo so BOTH bases (cash + MTM) carry it
                # uniformly. Additive-only: no reader consumes conventions.benchmark
                # this phase (SC-4-safe), and the MTM benchmark RETURNS fetch above is
                # unchanged — this is only the identity label alongside conventions.
                benchmark_symbol="BTC",
            )
            mtm_metrics_json = dict(_mtm_basis_result.metrics_json)
        except ValueError as _mtm_compute_exc:
            # Mirror the composite F-5 guard (:3844) but DEGRADE instead of failing
            # the job: a cumulative_method='simple' series with an interior chain-break
            # rejects. The cash headline is unaffected, so stamp the machine reason and
            # omit the key rather than fail the whole derive.
            mtm_metrics_json = None
            # SERIES-UNCOMPUTABLE math failure (compute rejected the series), NOT a
            # settlement-summary coverage hole — stamp its own reason so Phase 102's
            # disabled-with-reason UI does not show a coverage explanation for a
            # non-coverage cause. The true crawl-level structural degrade (the MTM
            # second-pass `as _mtm_exc` catch) stamps MTM_REASON_SUMMARY_COVERAGE for
            # a non-inception structural failure, or MTM_REASON_ANCHOR_RACE when the
            # failure is an InceptionReconciliationError (the Phase-102 same-anchor
            # race classification).
            mtm_gated_reason = MTM_REASON_SERIES_UNCOMPUTABLE
            logger.warning(
                "derive_broker_dailies: mark_to_market metrics compute rejected the "
                "series for strategy %s (interior chain-break) — degrading: %s",
                strategy_id, scrub_freeform_string(str(_mtm_compute_exc)),
            )

    # ── SMTM-01 (Phase 132): compute the additive smoothed_mtm metrics object ──
    # Mirrors the MTM metrics compute above. The MONEY-PATH fail-loud discipline lives
    # UPSTREAM at the LEDGER/marks reconstruction: a holed-marks / retention-straddle
    # LedgerValuationError already failed the WHOLE job before this block (no
    # fabricated basis, no silent two-basis fallback). THIS block is the downstream
    # SCALAR compute over an already-honest smoothed daily series — a ValueError here
    # is a math chain-break (a cumulative_method='simple' interior gap), NOT a
    # marks/fabrication failure, so it DEGRADES symmetrically with MTM: omit the
    # smoothed key (and skip its series persist below), never fail the cash headline
    # over an uncomputable Sharpe. There is no smoothed_gated_reason channel yet
    # (131-03) — the by-basis omission is the signal; the degrade is logged. The
    # benchmark fetch stays guarded (the seven scalars are benchmark-invariant). The
    # MTM/cash locals are untouched — this block reads ONLY smoothed_returns + config.
    smoothed_metrics_json: dict[str, Any] | None = None
    _smoothed_basis_result: BasisSeriesResult | None = None
    if smoothed_returns is not None:
        _smoothed_periods = periods_per_year_for_asset_class(
            ctx.strategy_row.get("asset_class")
            if isinstance(ctx.strategy_row, dict)
            else None
        )
        if denominator_config is not None:
            _smoothed_cumulative = denominator_config.cumulative_method
            _smoothed_day_basis = metrics_day_basis(denominator_config.metrics_basis)
        else:
            _smoothed_cumulative = "geometric"
            _smoothed_day_basis = "calendar"
        from services.benchmark import get_benchmark_returns

        _smoothed_benchmark_rets: pd.Series | None = None
        try:
            _smoothed_benchmark_rets, _ = await get_benchmark_returns("BTC")
        except Exception as _bench_exc:  # noqa: BLE001
            logger.warning(
                "derive_broker_dailies: smoothed_mtm benchmark fetch failed for "
                "strategy %s (computing smoothed_mtm without the benchmark family): "
                "%s",
                strategy_id, _bench_exc,
            )
        try:
            _smoothed_basis_result = derive_basis_series(
                smoothed_returns,
                _smoothed_benchmark_rets,
                periods_per_year=_smoothed_periods,
                cumulative_method=_smoothed_cumulative,
                day_basis=_smoothed_day_basis,
                benchmark_symbol="BTC",
            )
            smoothed_metrics_json = dict(_smoothed_basis_result.metrics_json)
        except ValueError as _smoothed_compute_exc:
            # SCALAR compute reject (interior chain-break) — DEGRADE (mirror MTM): omit
            # the smoothed key, keep the cash headline. The honest smoothed daily
            # series was still built; only its scalar summary is uncomputable here.
            smoothed_metrics_json = None
            _smoothed_basis_result = None
            logger.warning(
                "derive_broker_dailies: smoothed_mtm metrics compute rejected the "
                "series for strategy %s (interior chain-break) — degrading (omitting "
                "the smoothed_mtm key), cash unaffected: %s",
                strategy_id, scrub_freeform_string(str(_smoothed_compute_exc)),
            )

    # DQ-02 + DQ-01 (v1.8): PRE-STAMP the coverage terminus flag AND the DQ-01
    # NAV-denominator guard flags (negative_nav_guard / dust_nav_guard /
    # flow_dominated_guard) onto strategy_analytics so the CSV analytics run
    # (run_csv_strategy_analytics) SURFACES them → complete_with_warnings.
    # csv_daily_returns carries ONLY the interpretable return rows — a
    # guard-broken day is np.nan and SKIPPED at write time (74-04 NaN policy),
    # and a coverage-gap day is honestly ABSENT — so these pre-stamped flags are
    # the ONLY channel telling the factsheet a day was refused (MED-2 closes the
    # P74 broker→CSV guard-meta gap). The CSV run reads these pre-existing flags.
    #
    # MED-3: the pre-stamp is UNCONDITIONAL and writes the FULL current flag state
    # (each warn flag set ONLY when this derive's meta raised it). The upsert
    # REPLACES the data_quality_flags JSONB column wholesale, so a CLEAN re-derive
    # writes {csv_source: True} and thereby CLEARS any stale flow_coverage / guard
    # flag left by an earlier gapped run — a healed account returns to `complete`
    # rather than staying stuck warned. Were this conditional, the stale flag would
    # survive across the csv_daily_returns boundary and re-warn a clean series.
    # SHOULD-1: pre-stamp the fired warn flags from the ONE shared
    # NAV_TWR_GUARD_KEYS source (the DQ-01 NAV guards + DQ-02 coverage + FLOW-04
    # materiality + MUST-2 unreadable-uPnL) so adding a guard propagates onto the
    # broker→CSV bridge by construction rather than being silently dropped here.
    from services.allocated_capital import ALLOCATED_CAPITAL_GUARD_KEYS

    _prestamp_flags: dict[str, Any] = {"csv_source": True}
    for _flag in NAV_TWR_GUARD_KEYS:
        if meta.get(_flag):
            _prestamp_flags[_flag] = True
    # S3 — the allocated-capital warn flags ride the SAME bridge via the ONE shared
    # ALLOCATED_CAPITAL_GUARD_KEYS source, iterated exactly like NAV_TWR_GUARD_KEYS.
    # Kept OUT of NAV_TWR_GUARD_KEYS (they originate in the allocated_capital meta,
    # not NavTWRMeta — the subset invariant test would break). One owner, two sites.
    for _flag in ALLOCATED_CAPITAL_GUARD_KEYS:
        if meta.get(_flag):
            _prestamp_flags[_flag] = True
    # MTM-01 (Phase 101): a STRUCTURAL mark_to_market degrade stamps the FIXED
    # machine reason. Only on degrade — the prestamp REPLACES data_quality_flags
    # wholesale (MED-3), so a stale reason self-heals on the next clean derive.
    if mtm_attempted and mtm_gated_reason is not None:
        _prestamp_flags["mtm_gated_reason"] = mtm_gated_reason

    # MTM-01 (Phase 101): this seam now ALSO owns the single-key by-basis write.
    # The prestamp runs BEFORE the CSV finalizer, and the finalizer's _mark_complete
    # upsert OMITS metrics_json_by_basis for never-composite rows (Finding 5 gates on
    # the prior `composite` flag), so a prestamped mark_to_market key SURVIVES the
    # finalizer. This mirrors the composite persist (:4016-4020) MINUS the cash key:
    # the headline IS the cash truth for single-key, and the strict basis-metrics.ts
    # overlay stays byte-identical only when cash_settlement is ABSENT from the
    # by-basis object (writing a cash key would activate a recomputed cash overlay
    # and risk SC-4 divergence).
    _prestamp_payload: dict[str, Any] = {
        "strategy_id": strategy_id,
        "data_quality_flags": _prestamp_flags,
    }
    # 106-02 (D5 / M2): the by-basis scalar assignment + prestamp upsert are DEFERRED
    # to AFTER both basis-series persists below (see the moved block just above the
    # CSV enqueue). Only the side-effect-free dict INIT lives here; the DONE-gating
    # write is series-first (self-healing partial-write window). `mtm_metrics_json`
    # is captured by the later assignment — its value is fixed before this point.

    # Phase 103 (MTM-04): persist (or HEAL) the mark_to_market daily-return series
    # row from the SAME BasisSeriesResult the scalar cache above came from — the
    # dailies-canonical route Plans 03/04 read. The success matrix MIRRORS the
    # authoritative metrics_json_by_basis write: a fresh series row ONLY when the
    # second pass SUCCEEDED (mtm_attempted and mtm_metrics_json is not None); every
    # other terminal-DONE shape (degrade / compute-reject / not-attempted) → DELETE
    # any stale row (Pitfall 5 heal, mirroring the by-basis SQL NULL) so a stale
    # series can never outlive an authoritative-NULL scalar write. Sync helper
    # wrapped in db_execute exactly like the prestamp above; fail-loud on the same
    # idiom (a persist failure retries the whole derive — cash rows already landed
    # above and re-derive idempotently).
    _persist_mtm_series_result = (
        _mtm_basis_result
        if (mtm_attempted and mtm_metrics_json is not None)
        else None
    )

    def _persist_mtm_series(
        result: BasisSeriesResult | None = _persist_mtm_series_result,
    ) -> None:
        persist_basis_series(
            ctx.supabase, strategy_id, basis="mark_to_market", result=result,
        )

    await db_execute(_persist_mtm_series)

    # ── Phase 104/105 (BB-01/BB-02): additive cash_settlement SERIES persist ─────
    # Persist the cash daily-return SERIES as strategy_analytics_series kind
    # ("cash_settlement") beside the MTM block above. Phase 105 (D1) makes this echo
    # ROUND-TRIP-COMPLETE: the derive receives scalar_returns=returns (the exact
    # legacy-conditioned series) + densify_policy="broker_nan", so the persisted
    # conventions carry {"densify": "broker_nan"} and the round-trip guard / 106 reader
    # can reconstruct the exact scalar input from the sparse rows. Collapse #6: the
    # per-source conditioning (broker → broker_nan) lives HERE at the preparation seam,
    # the derive stays branchless.
    #
    # STILL SERIES-ONLY for the AUTHORITATIVE scalars: persist_basis_series DISCARDS
    # metrics_json (it persists rows/gap_spans/conventions only), and the authoritative
    # single-key cash SCALARS still flip onto this route in Plan 04 (analytics_runner) —
    # NOT here. This seam's metrics_json_by_basis carries ONLY mark_to_market; no cash
    # scalar leaks into it. (Routing cash SCALARS through the shared derive before the
    # 04 reconciliation would still be an SC-4 violation — 104-RESEARCH Pitfall 1.)
    #
    # `returns` is the SAME dense post-terminus series the csv_daily_returns rows were
    # built from (:2842) — so scalar_returns=returns is byte-identical to the legacy
    # cash scalar input BY CONSTRUCTION, and _drop_nonfinite inside the helper reproduces
    # EXACTLY those finite rows (series round-trip identity by construction).
    #
    # benchmark_rets=None (positional): NO benchmark FETCH on the cash path. SC-5 needs
    # ONLY the benchmark IDENTITY STRING, so benchmark_symbol="BTC" is passed
    # UNCONDITIONALLY — every cash row carries the identity regardless of any MTM-side
    # fetch outcome. Conventions are resolved with the SAME expressions as the MTM block
    # (Pitfall 2) but computed separately (the MTM locals exist only when mtm_returns is
    # not None).
    #
    # A3 honesty: the sync_trades tail now enqueues derive_broker_dailies
    # unconditionally (the legacy compute_analytics re-entry + its funding
    # kill-switch flag were retired in 106-08), so every onboarding strategy
    # reaches this cash_settlement seam. Unified coverage lands with the
    # 105/106 route collapse.
    _cash_periods = periods_per_year_for_asset_class(
        ctx.strategy_row.get("asset_class")
        if isinstance(ctx.strategy_row, dict)
        else None
    )
    if denominator_config is not None:
        _cash_cumulative = denominator_config.cumulative_method
        _cash_day_basis = metrics_day_basis(denominator_config.metrics_basis)
    else:
        _cash_cumulative = "geometric"
        _cash_day_basis = "calendar"
    try:
        _cash_basis_result: BasisSeriesResult | None = derive_basis_series(
            returns,
            None,
            periods_per_year=_cash_periods,
            cumulative_method=_cash_cumulative,
            day_basis=_cash_day_basis,
            benchmark_symbol="BTC",
            # Collapse #6 (D1): the legacy-conditioned broker series IS `returns`
            # (dense with interior guard-NaN), and its densification is broker_nan —
            # so the scalar cache is byte-identical to the legacy cash scalar and the
            # round-trip guard can rebuild it from the sparse rows.
            scalar_returns=returns,
            densify_policy="broker_nan",
        )
    except ValueError:
        # Heal arm (Pitfall 5): effectively unreachable given the <2-day early exit
        # above, kept for the discipline — a rejected derive DELETEs any stale row.
        _cash_basis_result = None

    def _persist_cash_series(
        result: BasisSeriesResult | None = _cash_basis_result,
    ) -> None:
        persist_basis_series(
            ctx.supabase, strategy_id, basis="cash_settlement", result=result,
        )

    await db_execute(_persist_cash_series)

    # ── SMTM-01 (Phase 132): additive smoothed_mtm SERIES persist ──
    # GUARDED (unlike the always-heal MTM series persist above): persist ONLY when the
    # third pass ran AND produced a computable object. A no-option / perp-only /
    # key-mode / MTM-headline derive NEVER touches the smoothed_mtm series row — SC-4:
    # a no-option key persists NO smoothed artifacts, and this write is byte-invisible
    # there (the plan's "byte-identical persisted rows" requires NO smoothed RPC on a
    # no-option key, so this is deliberately NOT an unconditional heal). A started-
    # but-failed smoothed pass fails the WHOLE job upstream, so there is no
    # attempted-but-null smoothed persist to heal here.
    if smoothed_attempted and smoothed_metrics_json is not None:
        _persist_smoothed_series_result = _smoothed_basis_result

        def _persist_smoothed_series(
            result: BasisSeriesResult | None = _persist_smoothed_series_result,
        ) -> None:
            persist_basis_series(
                ctx.supabase, strategy_id, basis="smoothed_mtm", result=result,
            )

        await db_execute(_persist_smoothed_series)

    # 106-02 (D5 / carry-forward M2): the DONE-gating by-basis SCALAR prestamp lands
    # HERE — AFTER both basis series persist above — mirroring the composite seam
    # (cash series → MTM series → DONE-bearing scalar LAST). Ordering is load-bearing:
    # series-first REVERSES the partial-write window into the SELF-HEALING direction.
    # If the scalar landed FIRST and a series persist then failed, the read gate would
    # render fresh scalars over a stale/absent series (the HARMFUL mislabeled-read
    # direction). Persisting the series first means the only remaining transient window
    # is fresh-series + stale-SCALAR — benign (both rows are genuinely single-key; the
    # headline numbers lag the chart by one derive, never mislabel a basis) and the
    # next re-derive lands the matching scalar and heals it. A series-write failure
    # itself aborts the whole derive (fail-loud db_execute) BEFORE this scalar is
    # written, so the gate can never observe the harmful fresh-scalar + stale-series.
    # The prestamp must still land BEFORE the CSV enqueue below (the finalizer OMITS
    # metrics_json_by_basis on the broker route, so this authoritative write survives).
    #
    # MED-HIGH (Fable): metrics_json_by_basis is AUTHORITATIVE for a single-key
    # broker-derive row — this seam ALWAYS writes the column so no stale object can
    # survive. A fresh {"mark_to_market": …} object ONLY when the second pass
    # SUCCEEDED; every other terminal-DONE shape → SQL NULL (Python None, never JSON
    # null — the Phase-85 CHECK). This closes the whole stale-by-basis class on the
    # broker route:
    #   * mtm_attempted + success → the additive object;
    #   * mtm_attempted + degrade (compute-reject / structural) → NULL, healing a
    #     stale mark_to_market key from a prior successful derive whose data gated;
    #   * NOT attempted (perp-only, ccxt, MTM-configured headline, or a strategy
    #     RECONFIGURED from composite → single-key broker) → NULL, so a stale
    #     composite-shaped {cash_settlement, mark_to_market} object or a frozen
    #     prior MTM object can never linger next to the single-key headline.
    # The finalizer's Finding-5 clear is DEAD on the broker route (its
    # `_was_composite` reads the data_quality_flags THIS prestamp already replaced
    # with {csv_source}), so this authoritative write is the single source of truth:
    # the finalizer OMITS the column on the broker route and leaves this value
    # intact (that is also how the success-path mark_to_market object survives). A
    # single-key row's only legitimate by-basis content is the mark_to_market key
    # this path owns — anything else is stale by definition. (Broker-derive only
    # ever runs for single-key strategies; a genuine composite is authored by
    # run_stitch_composite_job / :4341, never this derive.) Non-options derives are
    # no longer byte-identical (they now write metrics_json_by_basis=NULL) — an
    # accepted, deliberate change vs the prior column-untouched behavior, because a
    # surviving stale object is a WRONG-MONEY-NUMBER hazard for Phase 102.
    #
    # SMTM-01 (Phase 132): the by-basis object gains the additive smoothed_mtm key. A
    # key is present ONLY from a completed pass (same omission contract as
    # mark_to_market — absent, never JSON null). Byte-identical to the prior write on
    # every non-options path: perp-only / ccxt / key-mode / MTM-headline leave BOTH
    # attempted flags False → the dict is empty → None (SQL NULL), exactly as before.
    # On an options book smoothing OPENS what MTM may keep closed — mark_to_market can
    # be ABSENT (degraded) while smoothed_mtm is PRESENT (the phase's value).
    _by_basis_obj: dict[str, Any] = {}
    if mtm_attempted and mtm_metrics_json is not None:
        _by_basis_obj["mark_to_market"] = mtm_metrics_json
    if smoothed_attempted and smoothed_metrics_json is not None:
        _by_basis_obj["smoothed_mtm"] = smoothed_metrics_json
    _prestamp_payload["metrics_json_by_basis"] = _by_basis_obj or None

    def _prestamp_dq_flags(payload: dict[str, Any] = _prestamp_payload) -> None:
        ctx.supabase.table("strategy_analytics").upsert(
            payload,
            on_conflict="strategy_id",
        ).execute()

    await db_execute(_prestamp_dq_flags)

    # Hand off to the standard CSV analytics route to compile the factsheet.
    def _enqueue_csv_analytics() -> None:
        ctx.supabase.rpc(
            "enqueue_compute_job",
            {"p_strategy_id": strategy_id, "p_kind": "compute_analytics_from_csv"},
        ).execute()

    await db_execute(_enqueue_csv_analytics)
    return DispatchResult(outcome=DispatchOutcome.DONE)


# Phase 86 (COMP-02, #597 blend): the exchange venues whose returns annualize on
# the crypto (365) clock. The composite periods_per_year is 365 if ANY member
# venue is crypto, else 252 — an explicit set so a future non-crypto venue flips
# the blend to 252 without touching the rule.
# MD-01: single-sourced from services.closed_sets.CRYPTO_VENUES (imported above) so
# the composite blend clock can never drift from the onboarding-teaser preview clock.
_COMPOSITE_CRYPTO_VENUES: frozenset[str] = CRYPTO_VENUES

# HARD-05 (Phase 93): the ccxt crypto venues a composite member can declare that
# this phase does NOT yet reconstruct natively (Plan 93-04 attaches the honest
# reconstruction attempt). A member on one of these venues is NOT a hard failure:
# it DEGRADES out of the stitch with a machine-readable data-quality reason
# (`venue_reconstruction_unavailable`) the user sees, rather than killing the whole
# composite (the Phase-86 Deribit-only fence is lifted). Derived from
# _COMPOSITE_CRYPTO_VENUES so the two sets can never drift.
#
# GUARD AUDIT (SFOX-05): sfox is now in CRYPTO_VENUES (√365 RISK basis) and thus
# in _COMPOSITE_CRYPTO_VENUES, so the #597 blend clock correctly annualizes a
# composite that contains an sfox leg on the crypto clock. But sfox has NO ccxt
# reconstruction path — its dailies come from the sfox broker-dailies branch
# (combine_sfox_balance_history via create_exchange→SfoxClient), which
# _reconstruct_ccxt_member does NOT invoke (it calls create_exchange, which
# raises ValueError for sfox). So sfox is EXCLUDED from _COMPOSITE_DEGRADE_VENUES:
# an sfox composite member (not a reachable flow until 122, but defended here)
# falls through to the `venue != "deribit"` arm below and gets an HONEST permanent
# "unsupported composite member venue" refusal, never a confusing ccxt-reconstruct
# crash. The blend-clock membership (crypto √365) and the degradable-member set
# (ccxt-reconstructable) are DIFFERENT questions; only the former includes sfox.
_COMPOSITE_DEGRADE_VENUES: frozenset[str] = _COMPOSITE_CRYPTO_VENUES - {
    "deribit",
    "sfox",
}


class _CcxtMemberDegrade(Exception):
    """HARD-05 (Phase 93.1 hardening): a ccxt composite member that reconstructed
    WITHOUT raising a structural ledger error but is nonetheless NOT honestly
    representable in the stitch — it must DEGRADE (visible DQ reason) rather than
    join. Carries a fixed machine-readable ``reason`` enum literal (leak-safe: no
    exception text / USD / NAV interpolated), routed to the SAME degrade channel as
    the structural `reconstruction_failed` path. Two cases (mirroring the single-key
    derive path's guards, which the composite ccxt arm previously OMITTED):

      * ``insufficient_history`` — the reconstructed series has < 2 interpretable
        (non-NaN) days (a brand-new / inactive account, or a series entirely NaN'd
        by the DQ-02 terminus). ``run_derive_broker_dailies_job`` short-circuits this
        at :2558; the composite arm let an EMPTY series reach ``clip_to_window`` →
        ``TypeError`` → 'unknown' retry-to-failed_final on the whole (healthy)
        composite, OR a 0-day member joining 'complete' with no caveat.
      * ``realized_stream_unavailable`` — the realized/closed-PnL trade stream is
        EMPTY while funding rows are PRESENT. A real perp trader has trades; an
        empty-realized + funding-present member is the Bybit-INVERSE gap (closed-PnL
        is fetched category='linear' only, so inverse realized is invisible) — it
        would reconstruct a fabricated funding-only track (100% of trading PnL
        absent). Degrade honestly instead of shipping fabrication (HARD-05
        OR-criterion). Full inverse SUPPORT is deferred (D-2).
    """

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason

# Phase 86 / Finding 8 — a composite fans out over its members with (worst case,
# when MTM is admissible) TWO sequential exchange crawls per member. The
# stitch_composite handler runs under a FIXED TIMEOUT_PER_KIND["stitch_composite"]
# budget that does NOT scale with member count, so a large-N composite would
# deterministically exceed the budget and be classified TRANSIENT → retried
# FOREVER (the wizard poller spins, never reaching a terminal gate). Rather than
# ship a silently-doomed job, cap the member count and fail LOUD PERMANENT above
# it. The cap is DERIVED from the budget and a conservative per-crawl estimate so
# it tracks the timeout automatically; ops can override via COMPOSITE_MAX_MEMBERS
# (a larger timeout + faster egress may justify a higher cap) without a code
# change. Scaling the actual budget by member count is the follow-up (it needs the
# member count plumbed into the dispatch-level wait_for AND the main_worker
# watchdog stale threshold — out of scope for this fail-safe).
_COMPOSITE_PER_CRAWL_SECONDS = 120.0  # ~90-day Deribit native backfill, conservative

# SF-2b — after this many CONSECUTIVE set_compute_job_progress write failures
# within a single stitch, escalate from a per-boundary warning to error-level so
# a PERSISTENT heartbeat-write outage (claim-token drift, permission regression,
# bad deploy) is visible rather than buried in easily-missed warnings. A single
# transient blip self-heals on the next boundary and stays at warning. Matches
# the frontend MAX_CONSECUTIVE_POLL_ERRORS=3 convention.
_MEMBER_PROGRESS_MAX_CONSECUTIVE_FAILURES = 3


def _composite_max_members() -> int:
    """The largest member count whose worst-case 2-crawls-per-member fan-out fits
    (with headroom) inside the stitch_composite timeout budget. Env-overridable via
    COMPOSITE_MAX_MEMBERS."""
    override = os.environ.get("COMPOSITE_MAX_MEMBERS")
    if override:
        try:
            parsed = int(override)
            if parsed > 0:
                return parsed
        except ValueError:
            logger.warning(
                "COMPOSITE_MAX_MEMBERS=%r is not a positive int; using derived cap",
                override,
            )
    budget = TIMEOUT_PER_KIND.get("stitch_composite", 20 * 60)
    # 2 crawls/member worst case; keep ~20% headroom for stitch + compute + persist.
    return max(1, int((budget * 0.8) / (2 * _COMPOSITE_PER_CRAWL_SECONDS)))


async def run_stitch_composite_job(job: dict[str, Any]) -> DispatchResult:
    """Phase 86 (COMP-02 / COMP-04) — the production multi-key composite stitch.

    Fans out over ``strategy_keys`` members ORDER BY ``seq`` (owner-coherent,
    Phase 85), reconstructs each member's dense daily-return series via the SAME
    per-key entry points the single-key derive path uses (``build_deribit_native_
    ledger`` + ``combine_native_ledger`` for Deribit; ``combine_realized_and_
    funding`` for ccxt), clips each to its half-open ``[window_start, window_end)``
    window, runs the two-layer fail-loud overlap guard, arithmetic-stitches the
    clipped series into ONE honest combined series, persists the stitched
    cash_settlement series to ``csv_daily_returns`` (gap/guarded days ABSENT —
    never 0.0 as performance, charting only), then computes the metrics ONCE from
    the in-memory stitched series via the ONE shared ``derive_basis_series`` helper
    (asset_class periods_per_year + the global BTC benchmark) and writes the
    HEADLINE ``strategy_analytics`` row DIRECTLY in a single atomic upsert: the
    headline scalars ARE ``metrics_json_by_basis.cash_settlement`` (both bases when
    MTM is admissible) spread into the row, so headline == by-basis by construction
    (the divergent single-key ``run_csv_strategy_analytics`` recompute is retired) +
    the coverage-mask/member-guard ``data_quality_flags``.

    Worker-only key decryption is LOCKED: the ONLY decrypt path is inside
    ``_allocator_key_preflight`` (per member). The Next.js route enqueues this kind
    and never decrypts.

    Error taxonomy (T-86-11 DoS): a 0-member composite, overlapping windows
    (``CompositeOverlapError``), a structurally-incomplete/unvaluable ledger
    (``LedgerCompletenessError`` / ``LedgerValuationError`` / ``NavReconstruction
    Error`` …), or a malformed ``returns_denominator_config`` are all PERMANENT
    (``failed``, never retried-forever) with a scrubbed message (T-86-10). A
    geo-blocked member crawl is TRANSIENT (retryable). M-3: this job NEVER advances
    verification/publish status (no composite GA before Phase 87's gate).
    """
    strategy_id = job.get("strategy_id")
    if not strategy_id:
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message="run_stitch_composite_job: strategy_id missing",
            error_kind="permanent",
        )

    import pandas as pd

    from services.stitch_composite import (
        CompositeOverlapError,
        MemberBasisSignal,
        MemberWindow,
        assert_windows_disjoint,
        clip_to_window,
        coverage_mask,
        mark_to_market_available,
        smoothed_mtm_available,
        stitch_clipped_series,
    )
    from services.broker_dailies import (
        combine_native_ledger,
        gap_fill_daily_returns,
    )
    from services.deribit_ingest import (
        CurrencyEnumerationError,
        LedgerCompletenessError,
        LedgerTruncatedError,
        ScopeAuthError,
        assert_ledger_complete,
        build_deribit_native_ledger,
        fetch_deribit_native_account_state,
    )
    from services.deribit_txn import (
        DEFAULT_PNL_BASIS,
        PNL_BASIS_MARK_TO_MARKET,
        PNL_BASIS_SMOOTHED_MTM,
        LedgerValuationError,
    )
    from services.allocated_capital import (
        ReturnsDenominatorConfigError,
        exclude_spot_extraction_for,
        metrics_day_basis,
        parse_returns_denominator_config,
    )
    from services.metrics import (
        DEFAULT_PERIODS_PER_YEAR,
        PERIODS_PER_YEAR_CRYPTO,
        compute_all_metrics,
        periods_per_year_for_asset_class,
    )
    from services.nav_twr import NavReconstructionError
    from services.redact import scrub_freeform_string

    supabase = get_supabase()

    async def _stamp_failed(message: str) -> None:
        """Terminal 'failed' stamp so the wizard poller reaches a gate instead of
        an infinite 'computing' spinner (mirrors the derive path). Scrubbed
        (T-86-10). Never touches verification/publish columns (M-3).

        M-2: read-modify-write on data_quality_flags. keys/sync re-enqueues
        stitch_composite for an already-live composite on owner resync, so a
        re-derive FAILURE lands on a live row whose metrics_json_by_basis survives
        and keeps rendering the public factsheet. Writing {csv_source, composite}
        WHOLESALE here would drop the live coverage-mask keys (per_key, gap_spans,
        gap_day_count, overlap_days, mtm_gated_reason) → deriveSegmentMarkers
        returns empty → real gap days render with NO FS-02 missing-segment
        annotation (a no-invented-data regression) until a successful re-derive.
        MERGE the two composite markers OVER the existing flags to PRESERVE the
        mask (mirror the SUCCESS path's read-modify-write idiom below). On a
        first-derive failure with no existing row this falls back to
        {csv_source, composite} — current behavior, byte-unchanged."""
        scrubbed = str(scrub_freeform_string(message))

        def _read_existing_failed_flags() -> dict[str, Any]:
            res = (
                supabase.table("strategy_analytics")
                .select("data_quality_flags")
                .eq("strategy_id", strategy_id)
                .maybe_single()
                .execute()
            )
            row = getattr(res, "data", None) or {}
            return dict(row.get("data_quality_flags") or {})

        existing_flags = await db_execute(_read_existing_failed_flags)
        merged_flags: dict[str, Any] = dict(existing_flags)
        merged_flags["csv_source"] = True
        merged_flags["composite"] = True

        def _upsert() -> None:
            supabase.table("strategy_analytics").upsert(
                {
                    "strategy_id": strategy_id,
                    "computation_status": "failed",
                    "computation_warned": False,
                    "computation_error": scrubbed,
                    "data_quality_flags": merged_flags,
                },
                on_conflict="strategy_id",
            ).execute()

        await db_execute(_upsert)

    # 1. Members ORDER BY seq (Phase 85). owner_id in the row is advisory — the
    # authoritative owner is re-read from the api_keys row inside preflight, never
    # trusted from the job payload (T-86-09).
    def _load_members() -> Any:
        return (
            supabase.table("strategy_keys")
            .select("api_key_id, owner_id, window_start, window_end, seq")
            .eq("strategy_id", strategy_id)
            .order("seq")
            .execute()
        )

    members_res = await db_execute(_load_members)
    members = list(getattr(members_res, "data", None) or [])
    if not members:
        await _stamp_failed("Composite strategy has no member keys.")
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message="run_stitch_composite_job: strategy has 0 strategy_keys members",
            error_kind="permanent",
        )

    # Finding 8: fail LOUD PERMANENT (before any crawl) above the member cap. A
    # composite with more members than the fixed timeout budget can crawl would
    # deterministically time out and be retried FOREVER as 'transient' — the wizard
    # poller spins with no terminal gate. A clear permanent failure is honest and
    # actionable (split the composite or raise COMPOSITE_MAX_MEMBERS / the timeout).
    _max_members = _composite_max_members()
    if len(members) > _max_members:
        await _stamp_failed(
            f"Composite has {len(members)} member keys, above the safe maximum of "
            f"{_max_members} for the current derive-timeout budget. Reduce members "
            "or contact support to raise the limit."
        )
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message=(
                f"run_stitch_composite_job: {len(members)} members exceeds cap "
                f"{_max_members} (would deterministically time out)"
            ),
            error_kind="permanent",
        )

    # 2. Declared-window overlap guard BEFORE any exchange crawl (fail fast, no
    # wasted fan-out). Either overlap layer → PERMANENT (T-86-11).
    windows = [
        MemberWindow(
            seq=int(m["seq"]),
            window_start=str(m["window_start"]),
            window_end=(None if m.get("window_end") is None else str(m["window_end"])),
        )
        for m in members
    ]
    try:
        assert_windows_disjoint(windows)
    except CompositeOverlapError as exc:
        scrubbed = str(scrub_freeform_string(str(exc)))
        await _stamp_failed("Composite member windows overlap. " + scrubbed)
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message=(
                "run_stitch_composite_job: overlapping declared windows — " + scrubbed
            ),
            error_kind="permanent",
        )

    # Per-strategy denominator override (Zavara allocated capital) — parsed ONCE,
    # threaded into combine_native_ledger. Its pnl_basis drives the cash ledger's
    # accrual basis; malformed → PERMANENT (never ship a guessed capital base).
    def _load_strategy() -> Any:
        return (
            supabase.table("strategies")
            .select("id, asset_class, returns_denominator_config")
            .eq("id", strategy_id)
            .single()
            .execute()
        )

    strat_res = await db_execute(_load_strategy)
    strat_row = getattr(strat_res, "data", None) or {}
    try:
        denominator_config = parse_returns_denominator_config(
            strat_row.get("returns_denominator_config")
            if isinstance(strat_row, dict)
            else None
        )
    except ReturnsDenominatorConfigError as exc:
        await _stamp_failed("Composite returns_denominator_config is malformed.")
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message=(
                "run_stitch_composite_job: malformed returns_denominator_config — "
                + str(scrub_freeform_string(str(exc)))
            ),
            error_kind="permanent",
        )

    cash_pnl_basis = (
        denominator_config.pnl_basis
        if denominator_config is not None
        else DEFAULT_PNL_BASIS
    )
    exclude_spot = exclude_spot_extraction_for(denominator_config)

    _PERMANENT_LEDGER_ERRORS = (
        LedgerCompletenessError,
        LedgerTruncatedError,
        CurrencyEnumerationError,
        ScopeAuthError,
        LedgerValuationError,
        NavReconstructionError,
    )

    async def _reconstruct_deribit(
        ctx: Any, basis: str
    ) -> tuple[pd.Series, bool, dict[str, Any]]:
        """One Deribit member's dense daily-return series for ``basis`` + its
        option-activity signal + the NavTWRMeta guard dict, through the EXISTING
        per-key entry points.

        WEDGE-01 (Eclipse incident 2026-07-19): this composite arm ran on the
        shared API/worker event loop with NONE of the derive path's protection —
        a multi-key Deribit stitch reached the heavy per-member reconstruction,
        the SYNCHRONOUS pandas assembly blocked the loop, the FLIPRETRY-04 healthz
        heartbeat (main_worker.py:642, advances LAST_TICK_AT only when the loop is
        SERVICING it) froze, and Railway 503-restarted the pod ~90s later —
        orphaning the job 'running' under the dead worker, BEFORE the 1200s outer
        wait_for could fire. Mirror the single-key derive path exactly: (a) HARD-
        BOUND each live crawl with asyncio.wait_for (the FLIPRETRY-01 pattern,
        run_derive_broker_dailies_job:2319/2386) so a slow read is a classified
        TRANSIENT, never an unbounded wedge; (b) run the CPU-bound pandas combine
        OFF the loop via asyncio.to_thread (the rescore pattern at :6398) so it
        can never starve the heartbeat AND the outer wait_for stays able to fire.
        """
        account_state = await asyncio.wait_for(
            fetch_deribit_native_account_state(ctx.exchange),
            timeout=_BROKER_CRAWL_TIMEOUT_S,
        )
        ledger, completeness = await asyncio.wait_for(
            build_deribit_native_ledger(
                ctx.exchange,
                account_state=account_state,
                pnl_basis=basis,
                exclude_spot_extraction=exclude_spot,
            ),
            timeout=_BROKER_CRAWL_TIMEOUT_S,
        )
        assert_ledger_complete(completeness)
        # WEDGE-01: combine_native_ledger is SYNCHRONOUS CPU-bound pandas
        # (broker_dailies.py:174). On the shared loop it blocks the healthz
        # heartbeat → false-stale → restart. Offload to a worker thread (the
        # awaits above stay on the loop — only this pure CPU work moves off).
        returns, member_meta = await asyncio.to_thread(
            combine_native_ledger,
            ledger,
            completeness.indexable_currencies,
            denominator_config=denominator_config,
        )
        return returns, bool(completeness.has_option_activity), dict(member_meta)

    async def _reconstruct_ccxt_member(
        ctx: Any, venue: str
    ) -> tuple[pd.Series, bool, dict[str, Any]]:
        """HARD-05 (Plan 93-04) — one ccxt (binance/okx/bybit) member's dense
        daily-return series reconstructed HONESTLY through the SAME derive-path
        primitives the single-key broker path uses (``run_derive_broker_dailies_
        job``, :2318-2560). NOT a fork: the math lives in the reused primitives
        (``combine_realized_and_funding`` + ``ccxt_rows_to_dated_flows`` + the
        evidence-gated flow-coverage terminus), so the reconstructed series is
        byte-consistent with the derive semantics (research A3 / SC-4). The derive
        path (``run_derive_broker_dailies_job``) is DELIBERATELY not refactored —
        composing the shared primitives here avoids extracting an orchestrator
        while keeping the MATH single-sourced (research Pitfall 3).

        Returns ``(returns, has_option_activity=False, meta)`` in the SAME shape as
        ``_reconstruct_deribit``. ``has_option_activity=False`` keeps the MTM gate
        OFF: ``mark_to_market_available`` already gates OFF any non-native (ccxt)
        venue, so the MTM second pass can never meaningfully request a ccxt member
        (it ships cash-only — no options book signal).

        Plan-checker Note 2: the derive primitives are imported FUNCTION-LOCALLY
        inside ``run_derive_broker_dailies_job`` (NOT in this scope), so they are
        re-imported here. ``fetch_all_trades`` is a module global and
        ``_resolve_ccxt_flow_price_index`` is module-level — both referenced
        directly.
        """
        from services.broker_dailies import combine_realized_and_funding
        from services.nav_twr import (
            DUST_NAV_FLOOR,
            apply_flow_coverage_terminus,
            flow_coverage_gap_evidence,
            flow_coverage_terminus_day,
            flow_retention_floor,
            negative_nav_guard_pre_terminus,
        )
        from services.exchange import fetch_account_equity_and_upnl_usd
        from services.ccxt_flow_fetch import fetch_ccxt_transfers
        from services.ccxt_flows import ccxt_rows_to_dated_flows
        from services.funding_fetch import (
            fetch_funding_binance,
            fetch_funding_bybit,
            fetch_funding_okx,
        )

        # Current total equity anchor + the venue-gated companion open-uPnL wedge
        # (OKX totalEq; Bybit/Binance realized-basis walletBalance → structural 0.0).
        equity, balance_error, open_unrealized_usd, upnl_unreadable = (
            await fetch_account_equity_and_upnl_usd(ctx.exchange, venue)
        )
        # since_ms=None ⇒ ENTIRE account history (mirrors the derive block).
        realized = await fetch_all_trades(ctx.exchange, since_ms=None)
        # Funding label is a log/match-key only (it never scopes the exchange call);
        # strategy_id is a stable label and the rows are consumed IN-MEMORY only
        # (fed straight to combine — NEVER upserted per-key here).
        if venue == "binance":
            funding = await fetch_funding_binance(ctx.exchange, strategy_id, None)
        elif venue == "okx":
            funding = await fetch_funding_okx(ctx.exchange, strategy_id, None)
        elif venue == "bybit":
            funding = await fetch_funding_bybit(ctx.exchange, strategy_id, None)
        else:  # pragma: no cover — routing only ever passes the 3 ccxt venues
            raise NavReconstructionError(
                f"unsupported ccxt composite venue {venue!r}"
            )

        # FIX B (Phase 93.1 red-team HIGH): realized-empty + funding-present is the
        # honest-reconstruction-impossible signal. `fetch_all_trades` fetches closed
        # PnL as category='linear' only (exchange.py:1576), so a Bybit-INVERSE perp
        # member's realized stream comes back EMPTY while its funding settlements do
        # NOT — combine would then fabricate a ~1e-8/day funding-only track (BTC
        # funding summed as USD over heuristic capital) with 100% of trading PnL
        # missing, flagged only by `used_heuristic_capital`. A real perp trader has
        # trades: an empty realized stream alongside present funding means realized
        # could not be fetched, not that the account never traded. DEGRADE visibly
        # rather than ship the fabrication (full inverse support is deferred — D-2).
        if not realized and funding:
            raise _CcxtMemberDegrade("realized_stream_unavailable")

        # Bound the flow lookback to the venue's deposit-history retention via the
        # SHARED normalized floor (LOW-2 — the SAME source the DQ-02 terminus gate
        # uses, so the two "retention" definitions can never drift).
        _now_utc = datetime.now(timezone.utc)
        now_ms = int(_now_utc.timestamp() * 1000)
        _retention_floor = flow_retention_floor(venue, _now_utc)
        _flow_since_ms = (
            0
            if _retention_floor is None
            else max(0, int(_retention_floor.timestamp() * 1000))
        )
        _deposits = await fetch_ccxt_transfers(
            ctx.exchange, "deposits", _flow_since_ms, now_ms
        )
        _withdrawals = await fetch_ccxt_transfers(
            ctx.exchange, "withdrawals", _flow_since_ms, now_ms
        )
        _flow_rows = list(_deposits) + list(_withdrawals)
        _price_index = await _resolve_ccxt_flow_price_index(
            ctx.exchange, venue, ctx.supabase, _flow_rows
        )
        # ccxt_rows_to_dated_flows raises NavReconstructionError (structural) on an
        # unpriceable non-stable flow — the routing catches it and DEGRADES.
        # WEDGE-01: pure CPU-bound (ccxt_flows.py:164) — off the shared loop so it
        # cannot starve the healthz heartbeat (mirrors the deribit arm).
        external_flows = await asyncio.to_thread(
            ccxt_rows_to_dated_flows, _flow_rows, venue=venue, price_index=_price_index
        )

        # FLOW-04 noise guard (Pitfall 5 / T-77-08): the open-uPnL wedge is only
        # trustworthy relative to a trustworthy anchor. Force it to 0.0 on a
        # balance-error read, a missing equity, or a dust base.
        if balance_error or equity is None or abs(equity) <= DUST_NAV_FLOOR:
            open_unrealized_usd = 0.0

        # WEDGE-01: combine_realized_and_funding is SYNCHRONOUS CPU-bound pandas
        # (broker_dailies.py:141). Offload off the shared loop so it cannot starve
        # the healthz heartbeat → false-stale restart (mirrors the deribit arm).
        returns, meta = await asyncio.to_thread(
            combine_realized_and_funding,
            realized,
            funding,
            account_balance=equity,
            balance_error=balance_error,
            external_flows=external_flows,
            open_unrealized_usd=open_unrealized_usd,
        )

        # MUST-2: an unreadable open-uPnL field on a TRUSTWORTHY anchor →
        # unrealized_pnl_unreadable (LOUD complete_with_warnings), so a wrong/renamed
        # field name never silently coalesces to a flat book. Gated on a healthy
        # anchor (the wedge is already force-zeroed on a dust/heuristic base above).
        if upnl_unreadable and not (
            balance_error or equity is None or abs(equity) <= DUST_NAV_FLOOR
        ):
            meta["unrealized_pnl_unreadable"] = True

        # DQ-02 (CRITICAL-1) evidence-gated flow-coverage terminus. When the return
        # window extends BEFORE the venue's deposit-history retention, the earliest
        # capital moves are UNFETCHABLE — segment ONLY on EVIDENCE of a real
        # truncation (a pre-terminus negative-NAV guard OR a fetched flow at the
        # retention floor); a flow-less account with clean NAV keeps FULL history.
        if not returns.empty:
            _flow_coverage_start_day = flow_coverage_terminus_day(
                venue,
                first_return_day=returns.index[0],
                now_utc=datetime.now(timezone.utc).replace(tzinfo=None),
            )
            if _flow_coverage_start_day is not None:
                _guard_pre_terminus = negative_nav_guard_pre_terminus(
                    returns,
                    terminus=_flow_coverage_start_day,
                    negative_nav_guard_fired=bool(meta.get("negative_nav_guard")),
                )
                if not flow_coverage_gap_evidence(
                    external_flows=external_flows,
                    retention_floor=_retention_floor,
                    pre_terminus_nav_guard_fired=_guard_pre_terminus,
                ):
                    _flow_coverage_start_day = None
            returns, _coverage_flags = apply_flow_coverage_terminus(
                returns, _flow_coverage_start_day
            )
            if _coverage_flags.get("flow_coverage_incomplete"):
                meta["flow_coverage_incomplete"] = True

        # FIX A (Phase 93.1 red-team HIGH): mirror the single-key derive path's
        # terminal insufficient-history short-circuit (run_derive_broker_dailies_job
        # :2558) the composite ccxt arm previously OMITTED. Gate on INTERPRETABLE
        # (non-NaN) days — after the DQ-02 terminus a thin series may be all-NaN or
        # < 2 real days. Raising HERE guarantees an empty/thin series NEVER reaches
        # `clip_to_window` at the append site (whose `>=` on an empty RangeIndex
        # raises TypeError → 'unknown' retry-to-failed_final on the whole composite),
        # and never joins the stitch as a silent 0-day 'complete' member. DEGRADE it.
        if returns.empty or int(returns.notna().sum()) < 2:
            raise _CcxtMemberDegrade("insufficient_history")

        # Cash basis only — has_option_activity is False for ccxt (no options book
        # signal; mark_to_market_available gates OFF non-native venues).
        return returns, False, dict(meta)

    async def _reconstruct_all(
        basis: str, report_progress: bool = False
    ) -> tuple[
        list[tuple[int, pd.Series]], list[MemberBasisSignal], list[str],
        list[dict[str, Any]], list[dict[str, Any]],
    ] | DispatchResult:
        """Fan out over every member for ``basis``: preflight (worker-only
        decrypt) → reconstruct → clip. Returns the clipped (seq, series) list +
        per-member MTM signals + venues + per-member NavTWRMeta guard dicts
        (Finding 3) + the DEGRADED members (HARD-05: ccxt members skipped from the
        stitch with a machine-readable DQ reason), or a DispatchResult on a
        preflight FAILED/DEFERRED or a typed permanent / transient reconstruction
        error.

        PROG-02: when ``report_progress`` is True (the CASH pass only — Pitfall 1:
        the MTM second pass must NOT restart the per-member counter), publish
        per-member ``{seq, exchange, label, status}`` progress into
        compute_jobs.metadata via the claim-token-fenced set_compute_job_progress
        RPC. Best-effort / fail-open: a progress-write failure NEVER fails the
        stitch (progress is a cosmetic side-channel; the stitch is authoritative)."""
        clipped: list[tuple[int, pd.Series]] = []
        signals: list[MemberBasisSignal] = []
        venues: list[str] = []
        metas: list[dict[str, Any]] = []
        degraded: list[dict[str, Any]] = []

        # PROG-02: per-seq progress records, seeded all-'waiting'. Entries are
        # built FIELD-BY-FIELD (never a key_row spread — WIZ-01 secretless
        # boundary) and back-filled with exchange/label once preflight resolves.
        progress_by_seq: dict[int, dict[str, Any]] = {
            int(m["seq"]): {
                "seq": int(m["seq"]),
                "exchange": None,
                "label": None,
                "status": "waiting",
            }
            for m in members
        }

        # SF-2b — consecutive set_compute_job_progress failure counter for THIS
        # stitch. Reset on any successful write; a run of >= the threshold means
        # the heartbeat is systemically frozen (not a one-off blip) and escalates
        # to error-level so a write outage is not buried in per-boundary warnings.
        progress_write_failures = 0
        # SF-2b latch — set once set_compute_job_progress RETURNS false (a fenced
        # NO-OP: this run lost its claim token — a watchdog reclaim + re-claim
        # rotated/NULLed it, or the row is no longer 'running'). The RPC's
        # documented contract is "false => lost ownership, stop writing"; an
        # explicit false is EXPECTED preemption, NOT a write outage, so we latch
        # OFF further member-progress writes for the remainder of this run
        # (a re-claimed worker owns the heartbeat now) rather than counting it
        # toward the SF-2b escalation. Latched (not re-derived each call) so the
        # preemption is logged EXACTLY ONCE.
        progress_fenced_off = False

        async def _write_member_progress() -> None:
            nonlocal progress_write_failures, progress_fenced_off
            # No-op off the cash pass (Pitfall 1), when the job carries no id
            # (unit harness / legacy call shape), or once this run has been
            # FENCED OFF (a prior write returned false → lost claim-token
            # ownership; a re-claimed worker owns the heartbeat now). Send a
            # SNAPSHOT (dict copy per entry) so later mutations never rewrite an
            # already-emitted payload.
            if (
                not report_progress
                or job.get("id") is None
                or progress_fenced_off
            ):
                return
            progress_list = [
                dict(progress_by_seq[s]) for s in sorted(progress_by_seq)
            ]

            def _rpc() -> APIResponse:
                # supabase.rpc() is typed Any (stub gap); re-assert the runtime
                # APIResponse (same boundary bridge as _cooldown_remaining) so the
                # fence boolean surfaced on `.data` stays typed for the caller.
                resp: APIResponse = supabase.rpc(
                    "set_compute_job_progress",
                    {
                        "p_job_id": job.get("id"),
                        "p_claim_token": job.get("claim_token"),
                        "p_progress": progress_list,
                    },
                ).execute()
                return resp

            try:
                resp = await db_execute(_rpc)
                # set_compute_job_progress RETURNS BOOLEAN: true = the fenced
                # merge WROTE; false = a fenced NO-OP (this run lost its claim
                # token — reclaim rotated/NULLed it, or the row is no longer
                # 'running'). An explicit false is EXPECTED preemption, NEVER a
                # write outage: honour the RPC's "false => stop writing" contract
                # by latching OFF further writes and logging ONCE, WITHOUT
                # touching progress_write_failures (it is neither a success to
                # reset nor an outage to escalate — escalating would let SF-2b
                # fire on ordinary preemption). Anything else (true, or contract
                # drift on .data) counts as a clean write and clears the streak,
                # exactly as before.
                if isinstance(resp.data, bool) and resp.data is False:
                    progress_fenced_off = True
                    logger.info(
                        "run_stitch_composite_job: set_compute_job_progress "
                        "returned false for job %s — this run lost its claim "
                        "token (watchdog reclaim + re-claim, or the job is no "
                        "longer running). Halting member-progress writes for the "
                        "rest of this run (a re-claimed worker owns the heartbeat "
                        "now); the stitch is authoritative and continues.",
                        job.get("id"),
                    )
                else:
                    # A clean write clears the consecutive-failure streak.
                    progress_write_failures = 0
            except asyncio.CancelledError:
                raise  # never swallow cancellation — propagate to worker shutdown
            except Exception as _prog_exc:  # noqa: BLE001
                # Fail-open: the stitch is authoritative; a progress-write blip
                # (DB hiccup, lost claim-token ownership) must never kill a
                # multi-minute crawl. The next boundary write self-heals.
                progress_write_failures += 1
                if (
                    progress_write_failures
                    >= _MEMBER_PROGRESS_MAX_CONSECUTIVE_FAILURES
                ):
                    # SF-2b: a PERSISTENT outage — the heartbeat is frozen and the
                    # stall channel may be blind to a live crawl. Escalate so it
                    # surfaces (claim-token drift / permission regression / bad
                    # deploy). Still fail-open: the stitch continues.
                    logger.error(
                        "run_stitch_composite_job: set_compute_job_progress write "
                        "failed %d times CONSECUTIVELY for job %s — heartbeat is "
                        "frozen (systemic write outage; the stall channel may be "
                        "blind to a live crawl). Stitch continues (fail-open): %s",
                        progress_write_failures, job.get("id"), _prog_exc,
                    )
                else:
                    logger.warning(
                        "run_stitch_composite_job: set_compute_job_progress write "
                        "failed for job %s (progress is cosmetic; stitch continues): %s",
                        job.get("id"), _prog_exc,
                    )

        # Initial all-'waiting' snapshot so the poller shows the full member
        # roster before the first crawl starts.
        await _write_member_progress()

        for m in members:
            seq = int(m["seq"])
            # PROG-02: this member's crawl is starting — mark in_process and
            # publish before the (slow) preflight + reconstruction begins.
            progress_by_seq[seq]["status"] = "in_process"
            await _write_member_progress()
            # M-1: thread the PARENT stitch job's id + claim_token into the member
            # preflight job. _allocator_key_preflight → _check_circuit_breaker →
            # _defer reads job["id"] / job.get("claim_token"); a member key with a
            # live last_429_at cooldown (e.g. 429'd in another crawl) would
            # otherwise raise KeyError('id') → the 429 is misclassified and RETRIED
            # instead of DEFERRED. Passing the parent job's id defers the PARENT
            # stitch job correctly (the composite has no per-member job row). The
            # dispatched compute_jobs row always carries its PK `id`; .get keeps
            # this defensive (a malformed job yields id=None, never a KeyError).
            member_job = {
                "api_key_id": m["api_key_id"],
                "strategy_id": strategy_id,
                "id": job.get("id"),
                "claim_token": job.get("claim_token"),
            }
            ctx = await _allocator_key_preflight(member_job, "run_stitch_composite_job")
            if isinstance(ctx, DispatchResult):
                # Finding 4: a PERMANENT preflight failure (missing / inactive
                # member key) returned here WITHOUT stamping strategy_analytics —
                # the wizard poller then spins on 'pending' forever with no gate.
                # Stamp a terminal 'failed' so the poller reaches a gate. DEFERRED
                # (circuit-breaker cooldown) and transient failures stay untouched:
                # they are legitimately retryable and re-run the job (a premature
                # 'failed' stamp would mask a recoverable condition). A geo-block on
                # a LIVE crawl is a separate transient handled in the except below.
                if (
                    ctx.outcome == DispatchOutcome.FAILED
                    and ctx.error_kind == "permanent"
                ):
                    await _stamp_failed(
                        "Composite member key preflight failed permanently "
                        "(missing or inactive member key)."
                    )
                return ctx
            venue = str(ctx.key_row["exchange"])
            # PROG-02: back-fill exchange + label FIELD-BY-FIELD from the resolved
            # api_keys row (never spread key_row — WIZ-01). This runs for BOTH the
            # degrade and success terminal writes below.
            progress_by_seq[seq]["exchange"] = venue
            progress_by_seq[seq]["label"] = ctx.key_row.get("label")
            if venue in _COMPOSITE_DEGRADE_VENUES:
                # HARD-05 (Plan 93-04): try-reconstruct-then-degrade. ATTEMPT honest
                # reconstruction of the ccxt (binance/okx/bybit) member through the
                # SAME derive-path primitives the single-key broker path uses. On
                # success the member joins the stitch exactly like a Deribit member
                # (its guard flags union into merged_flags by the EXISTING per-member
                # meta loop). On a STRUCTURAL failure it falls back to Plan 93-03's
                # degrade channel with the additive reason `reconstruction_failed`
                # (never a whole-job PERMANENT); a 429 / geo-block stays TRANSIENT
                # (whole-job retry — a rate limit is not a member defect). The close
                # discipline mirrors the deribit arm: `finally` closes the exchange on
                # EVERY path (success, degrade-continue, transient-return), so there
                # is no double-close.
                try:
                    returns, has_opt, member_meta = await _reconstruct_ccxt_member(
                        ctx, venue
                    )
                except _CcxtMemberDegrade as deg:
                    # FIX A / FIX B (Phase 93.1): the member reconstructed without a
                    # structural ledger error but is not honestly representable
                    # (insufficient_history / realized_stream_unavailable) → route to
                    # the SAME degrade channel with the distinct fixed reason. Same
                    # leak discipline as the structural arm (closed {seq, venue, reason}
                    # set, fixed literal). MUST precede the bare `except Exception`
                    # below so this typed signal is never swallowed by the geo/raise
                    # arm. The `finally` still closes the exchange.
                    degraded.append(
                        {"seq": seq, "venue": venue, "reason": deg.reason}
                    )
                    venues.append(venue)
                    progress_by_seq[seq]["status"] = "degraded"  # PROG-02
                    await _write_member_progress()
                    continue
                except (NavReconstructionError, *_PERMANENT_LEDGER_ERRORS):
                    # Structural: this MEMBER cannot be honestly reconstructed →
                    # DEGRADE visibly (the composite still completes). Leak discipline
                    # (T-93-04-01): the record stays the CLOSED {seq, venue, reason}
                    # set with `reason` the FIXED literal — the scrubbed exception
                    # text is DROPPED (never USD / NAV / raw error in the DQ flag).
                    degraded.append(
                        {
                            "seq": seq,
                            "venue": venue,
                            "reason": "reconstruction_failed",
                        }
                    )
                    venues.append(venue)
                    progress_by_seq[seq]["status"] = "degraded"  # PROG-02
                    await _write_member_progress()
                    continue
                except ccxt.RateLimitExceeded as exc:
                    # Mirror the deribit arm EXACTLY: stamp the member key row so the
                    # circuit breaker defers siblings during the cooldown, then yield
                    # TRANSIENT (retryable — a 429 is not a member defect).
                    await _stamp_429(ctx.supabase, ctx.key_row, exc)
                    return DispatchResult(
                        outcome=DispatchOutcome.FAILED,
                        error_message=(
                            "run_stitch_composite_job: ccxt member crawl "
                            "rate-limited (429) — "
                            + str(scrub_freeform_string(str(exc)))
                        ),
                        error_kind="transient",
                    )
                except Exception as exc:  # noqa: BLE001
                    if is_geo_blocked(exc):
                        # Worker-egress geo-restriction on a member crawl — RETRYABLE,
                        # not a structural refusal (mirror the deribit arm).
                        return DispatchResult(
                            outcome=DispatchOutcome.FAILED,
                            error_message=(
                                "run_stitch_composite_job: ccxt member crawl "
                                "geo-blocked — "
                                + str(scrub_freeform_string(str(exc)))
                            ),
                            error_kind="transient",
                        )
                    raise
                finally:
                    await aclose_exchange(ctx.exchange)
                # Success: the reconstructed ccxt member joins the stitch. Cash-only
                # (has_option_activity=False → mark_to_market_available gates MTM off
                # for the non-native venue). Append `venue` so the #597 blend
                # annualization keeps seeing the crypto venue.
                clipped.append(
                    (seq, clip_to_window(returns, m["window_start"], m.get("window_end")))
                )
                signals.append(
                    MemberBasisSignal(seq=seq, venue=venue, has_option_activity=False)
                )
                venues.append(venue)
                metas.append(member_meta)
                progress_by_seq[seq]["status"] = "successful"  # PROG-02
                await _write_member_progress()
                continue
            if venue != "deribit":
                # A venue OUTSIDE _COMPOSITE_CRYPTO_VENUES is a truly UNKNOWN
                # exchange — a structural configuration error, not a degradable
                # member. Keep the fail-loud PERMANENT semantics (the degrade channel
                # is deliberately scoped to the known ccxt crypto venues).
                await aclose_exchange(ctx.exchange)
                await _stamp_failed(
                    f"Composite member on venue {venue!r} is not a supported "
                    "exchange."
                )
                return DispatchResult(
                    outcome=DispatchOutcome.FAILED,
                    error_message=(
                        "run_stitch_composite_job: unsupported composite member "
                        f"venue {venue!r}"
                    ),
                    error_kind="permanent",
                )
            try:
                returns, has_opt, member_meta = await _reconstruct_deribit(ctx, basis)
            except asyncio.TimeoutError:
                # WEDGE-01: a member crawl blew its per-crawl wait_for bound
                # (_BROKER_CRAWL_TIMEOUT_S, set inside _reconstruct_deribit). Mirror
                # the derive path's FLIPRETRY-01 disposition: a slow/hung LIVE read
                # is a classified TRANSIENT (retryable whole-job), NEVER an unbounded
                # wedge of the shared loop and never a PERMANENT failure. The
                # `finally` still closes the exchange.
                return DispatchResult(
                    outcome=DispatchOutcome.FAILED,
                    error_message=(
                        "run_stitch_composite_job: member crawl exceeded the "
                        f"{_BROKER_CRAWL_TIMEOUT_S}s per-crawl bound — retrying "
                        "rather than wedging the worker (WEDGE-01)"
                    ),
                    error_kind="transient",
                )
            except _PERMANENT_LEDGER_ERRORS as exc:
                scrubbed = str(scrub_freeform_string(str(exc)))
                await _stamp_failed(
                    "Composite member reconstruction failed structurally "
                    "(incomplete/unvaluable ledger). " + scrubbed
                )
                return DispatchResult(
                    outcome=DispatchOutcome.FAILED,
                    error_message=(
                        "run_stitch_composite_job: member ledger unrecoverable — "
                        + scrubbed
                    ),
                    error_kind="permanent",
                )
            except ccxt.RateLimitExceeded as exc:
                # M-1: every other exchange-touching handler stamps last_429_at on
                # a 429 so the circuit breaker defers sibling jobs for this api_key
                # during the exchange cooldown; the member crawl was the one
                # omission (copy-paste-not-adapted — no RateLimitExceeded arm, so
                # _stamp_429 was never called here). Stamp the MEMBER key row, then
                # yield TRANSIENT (RateLimitExceeded is retryable) — mirror the
                # geo-block transient DispatchResult idiom below. _stamp_429
                # internally skips a geo-block mis-mapped to RateLimitExceeded, so
                # no phantom cooldown is introduced.
                await _stamp_429(ctx.supabase, ctx.key_row, exc)
                return DispatchResult(
                    outcome=DispatchOutcome.FAILED,
                    error_message=(
                        "run_stitch_composite_job: member crawl rate-limited (429) — "
                        + str(scrub_freeform_string(str(exc)))
                    ),
                    error_kind="transient",
                )
            except Exception as exc:  # noqa: BLE001
                if is_geo_blocked(exc):
                    # Worker-egress geo-restriction on a member crawl — RETRYABLE,
                    # not a structural refusal (Pitfall 4 / T-86 transient).
                    return DispatchResult(
                        outcome=DispatchOutcome.FAILED,
                        error_message=(
                            "run_stitch_composite_job: member crawl geo-blocked — "
                            + str(scrub_freeform_string(str(exc)))
                        ),
                        error_kind="transient",
                    )
                raise
            finally:
                await aclose_exchange(ctx.exchange)
            clipped.append((seq, clip_to_window(returns, m["window_start"], m.get("window_end"))))
            signals.append(MemberBasisSignal(seq=seq, venue=venue, has_option_activity=has_opt))
            venues.append(venue)
            metas.append(member_meta)
            progress_by_seq[seq]["status"] = "successful"  # PROG-02
            await _write_member_progress()
        return clipped, signals, venues, metas, degraded

    # 3. CASH_SETTLEMENT fan-out (always). PROG-02: report_progress=True ONLY on
    # the cash pass — the MTM second pass (below) stays default False so it can
    # never restart the per-member progress counter (Pitfall 1).
    cash_result = await _reconstruct_all(cash_pnl_basis, report_progress=True)
    if isinstance(cash_result, DispatchResult):
        return cash_result
    clipped_cash, member_signals, venues, member_metas, degraded_members = cash_result

    # HARD-05 honest floor: if NO member reconstructed (all members degraded or an
    # all-ccxt composite), fail PERMANENT with a scrubbed terminal stamp rather than
    # shipping an empty invented 'complete' track record. This preserves what the
    # removed Deribit-only rejection guaranteed implicitly (zero-member floor).
    if not clipped_cash:
        await _stamp_failed("No composite member could be reconstructed.")
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message="run_stitch_composite_job: no reconstructable member",
            error_kind="permanent",
        )

    # 4. Fail-loud post-clip overlap + arithmetic stitch (T-86-11 second layer).
    try:
        stitched_cash = stitch_clipped_series(clipped_cash)
    except CompositeOverlapError as exc:
        scrubbed = str(scrub_freeform_string(str(exc)))
        await _stamp_failed("Composite member series collide on a calendar day. " + scrubbed)
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message=(
                "run_stitch_composite_job: post-clip day collision — " + scrubbed
            ),
            error_kind="permanent",
        )

    # F2 (Phase 86): a near-fully-clipped or ≤1-day-history composite yields a
    # stitched series with <2 PRESENT days. compute_all_metrics (invoked just
    # below via _metrics_json_for → gap_fill → compute) raises a BARE
    # ValueError("...2 trading days...") on such a series; classify_exception maps
    # that to RETRYABLE → retry-forever, so the wizard poller spins and the row
    # never reaches terminal 'failed'. Hoist the terminal <2-day guard ABOVE the
    # compute so a degenerate composite is stamped PERMANENT failed instead of
    # raising unclassified. Counts PRESENT stitched days (gap/guarded days are
    # honestly absent — exactly the rows persisted to csv_daily_returns below).
    _present_day_count = int(stitched_cash.notna().sum())
    if _present_day_count < 2:
        await _stamp_failed(
            "Composite produced fewer than 2 stitched daily-return days."
        )
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message="run_stitch_composite_job: insufficient stitched history",
            error_kind="permanent",
        )

    # HARD-05 per_key visibility: a degraded ccxt member is EXCLUDED from the stitch
    # (never in clipped_cash), but it must still appear in the coverage mask's per_key
    # with honest zero coverage (n_days 0) so the wizard table renders its ENTERED
    # window via Plan 93-02's fallback. coverage_mask handles an empty per-member
    # series cleanly (empty index → {seq, first_day: None, last_day: None, n_days: 0}),
    # so feed each degraded member an empty series. The pure core (stitch_composite.py)
    # is untouched; coverage_mask sorts per_key by seq internally.
    _coverage_input = list(clipped_cash) + [
        (int(d["seq"]), pd.Series(dtype="float64")) for d in degraded_members
    ]
    mask = coverage_mask(_coverage_input)

    # 5. #5 collapse (D4): asset_class is THE annualization clock selector — the ONE
    # rule, periods_per_year_for_asset_class(strategies.asset_class) (√365 crypto /
    # √252 traditional). Every #597 asset-class surface (scenario blends, leg
    # annualization, OG card, peer-rank via src/lib/closed-sets.ts) recomputes from
    # this SAME strategies.asset_class, so the composite headline now agrees with them
    # by construction. finalize-wizard force-derives asset_class='crypto' for a
    # composite (F-1a); the strat_row was already loaded for the denominator config.
    periods_per_year = periods_per_year_for_asset_class(
        strat_row.get("asset_class") if isinstance(strat_row, dict) else None
    )
    # F-1 (retained fail-loud sanity assert, D4): the legacy #597 venue blend (365 if
    # ANY member venue crypto else 252) survives ONLY as a CROSS-CHECK — asset_class is
    # now the truth. finalize-wizard's asset_class='crypto' force-derive is
    # NON-BLOCKING, so a composite left at the 'traditional' default over a crypto-venue
    # book would silently annualize √252 while its factsheet / #597 surfaces expect
    # √365. FAIL LOUD PERMANENT on disagreement rather than ship that divergence — do
    # NOT silently annualize the wrong clock. _COMPOSITE_DEGRADE_VENUES stays the
    # unknown-venue backstop (a truly unknown venue degrades its member before it can
    # reach this blend). #5 is a provable no-op on live scalars: the F-1 backstop
    # landed in 044bee50 — the SAME commit that introduced stitch_composite.py — so no
    # live composite has EVER shipped with the two clocks disagreeing.
    _venue_blend_periods = (
        PERIODS_PER_YEAR_CRYPTO
        if any(v in _COMPOSITE_CRYPTO_VENUES for v in venues)
        else DEFAULT_PERIODS_PER_YEAR
    )
    if _venue_blend_periods != periods_per_year:
        await _stamp_failed(
            "Composite asset_class annualization clock "
            f"({periods_per_year}/yr) disagrees with the venue blend "
            f"({_venue_blend_periods}/yr); the factsheet and #597 surfaces would "
            "diverge. Re-derive asset_class (crypto for a crypto-venue composite)."
        )
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message=(
                "run_stitch_composite_job: asset_class periods_per_year "
                f"{periods_per_year} != venue-blend {_venue_blend_periods}"
            ),
            error_kind="permanent",
        )
    # Metrics conventions mirror run_csv_strategy_analytics: geometric/calendar by
    # default, simple/active under an allocated-capital override (Zavara).
    if denominator_config is not None:
        cumulative_method = denominator_config.cumulative_method
        day_basis = metrics_day_basis(denominator_config.metrics_basis)
    else:
        cumulative_method = "geometric"
        day_basis = "calendar"

    # F-2 (convergence red team): thread the GLOBAL BTC benchmark into the ONE
    # canonical composite compute so the factsheet keeps the benchmark family
    # (correlation / information_ratio / rolling alpha-beta / btc overlay) the
    # pre-refactor headline carried. The benchmark is strategy-INDEPENDENT (the
    # global BTC series), so passing it to the SAME compute for BOTH the headline
    # and the by-basis object preserves parity by construction — the four core
    # scalars stay benchmark-invariant, and the benchmark-derived family is
    # byte-identical across headline and metrics_json_by_basis.cash_settlement.
    # Guarded fetch (mirror run_csv_strategy_analytics): on failure the composite
    # still ships (benchmark_unavailable flag + note set below).
    from services.benchmark import get_benchmark_returns

    benchmark_rets, benchmark_stale = None, True
    try:
        benchmark_rets, benchmark_stale = await get_benchmark_returns("BTC")
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "stitch_composite: benchmark fetch failed for %s: %s",
            strategy_id, exc,
        )

    # Phase 105 (collapse #1): BOTH composite bases now route through the ONE shared
    # dailies-canonical helper (services/basis_series.py). Hoisted above the cash
    # derive because cash now precedes the MTM gate on the same helper. Cash + MTM +
    # the persist/heal all share this one import.
    from services.basis_series import (
        BasisSeriesResult,
        derive_basis_series,
        persist_basis_series,
    )

    # Collapse #1 (SC-1): the composite cash basis routes through the SAME shared
    # derive_basis_series as the single-key seam and the MTM arm — the bespoke
    # composite cash closure is DELETED (grep-gate). `stitched_cash` exists (:4206).
    try:
        _cash_basis_result: BasisSeriesResult | None = derive_basis_series(
            stitched_cash,
            benchmark_rets,
            periods_per_year=periods_per_year,
            cumulative_method=cumulative_method,
            day_basis=day_basis,
            # LOW-2: carry the BTC benchmark IDENTITY into the payload conventions
            # (payload-only; no reader consumes conventions.benchmark this phase).
            benchmark_symbol="BTC",
            # Collapse #1 (D1): the scalar input is `gap_fill_daily_returns(stitched_
            # cash)` — the EXACT input the deleted closure fed compute_all_metrics
            # (verbatim), so the cash scalar is byte-identical to the legacy oracle BY
            # CONSTRUCTION. densify='zero_fill' echoes that the composite densifies
            # absent inter-member days to 0.0 (flat) while an in-index member-guard NaN
            # is surfaced as `nan_dates` so the round-trip guard reinstates the chain
            # break rather than 0.0-bridging it.
            scalar_returns=gap_fill_daily_returns(stitched_cash),
            densify_policy="zero_fill",
        )
    except ValueError as exc:
        # F-5 (convergence red team), re-homed onto derive_basis_series's ValueError:
        # the derive propagates compute_all_metrics's BARE ValueError on a
        # cumulative_method='simple' series with an interior NaN guard day (arithmetic
        # Σr cannot honour a chain-break) — AND raises its OWN <2-finite-rows
        # ValueError. The hoisted _present_day_count guard (:4227) fires FIRST on the
        # length case, so this arm's interior-chain-break message stays honest.
        # classify_exception buckets a bare ValueError as 'unknown' → retries BURN the
        # attempt budget before the terminal gate; stamp PERMANENT so the wizard poller
        # reaches a gate immediately.
        # M1 (Fable red team, Phase 105): do NOT heal-delete the cash series row here.
        # `_stamp_failed` deliberately PRESERVES metrics_json_by_basis (M-2: an owner-
        # resync re-derive of an already-live composite keeps rendering the live
        # factsheet from the surviving scalars). Deleting the paired cash_settlement
        # series row while those scalars survive would leave scalar-live/series-absent —
        # exactly the inconsistency MED-1's read gate distrusts. Every other composite
        # terminal arm preserves; this arm does too. (A first-derive failure has no
        # prior series row to leave behind, so preserve is a no-op there.) The single-
        # key seam heals both rows because it carries NO live-preserve semantics —
        # that asymmetry is intentional, not an oversight.
        scrubbed = str(scrub_freeform_string(str(exc)))
        await _stamp_failed(
            "Composite metrics compute rejected the stitched series "
            "(interior chain-break under the arithmetic convention). " + scrubbed
        )
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message=(
                "run_stitch_composite_job: composite metrics ValueError — " + scrubbed
            ),
            error_kind="permanent",
        )
    # The composite try above assigns _cash_basis_result the derive result; its
    # `except ValueError` returns on failure, so control only reaches here when the
    # derive succeeded. It is non-None from this point (initialised None at the top,
    # never reassigned after) — assert so mypy --strict narrows the union for the
    # four downstream reads (metrics_json / insufficient_window / sibling_kinds).
    assert _cash_basis_result is not None
    cash_metrics_json = dict(_cash_basis_result.metrics_json)

    # 6. MTM honesty gate (OQ-1). Admissible ⇒ a SECOND ledger pass per Deribit
    # member (research A2 — no single-pass dual-basis path); gated ⇒ omit the MTM
    # key and carry the reason for Phase 90.
    # Phase 105 (collapse #1): BOTH the cash (above) and mark_to_market bases route
    # through the ONE shared dailies-canonical helper (services/basis_series.py) — the
    # bespoke composite compute is gone. Initialize the derived result to None so the
    # persist heal covers the gated (mtm_ok False) and any future degrade shape.
    mtm_ok, mtm_reason = mark_to_market_available(member_signals)
    mtm_metrics_json: dict[str, Any] | None = None
    _mtm_basis_result: BasisSeriesResult | None = None
    if mtm_ok:
        mtm_result = await _reconstruct_all(PNL_BASIS_MARK_TO_MARKET)
        if isinstance(mtm_result, DispatchResult):
            return mtm_result
        # Finding 9 (MTM TOCTOU): the SECOND (MTM) pass re-crawls each member and
        # produces its OWN option-activity signals (`_mtm_signals`), which we
        # deliberately DISCARD — the gate decision was already made from the cash
        # pass (`member_signals`). This is safe: `mark_to_market_available` gates on
        # an UN-SMOOTHED options book (`has_option_activity`), so if a member
        # OPENED an option position between the two passes, the ONLY honesty risk is
        # admitting MTM for a book that just became option-active. That window is
        # covered because (a) the gate is intentionally conservative — a book that
        # was option-active on the cash pass already gated MTM off before the second
        # pass runs; and (b) a book that becomes option-active strictly BETWEEN
        # passes is caught on the NEXT derive (re-derives are authoritative). The
        # sub-derive-interval TOCTOU is accepted; re-checking `_mtm_signals` here
        # would only defer, not eliminate, the same infinitesimal race.
        # HARD-05: the MTM pass re-runs the SAME member fan-out and produces its OWN
        # degraded list (`_mtm_degraded`). The venue routing is basis-independent, so
        # the two passes SHOULD degrade the same members — BUT each pass re-crawls
        # every member LIVE, and `_reconstruct_ccxt_member` does live network reads, so
        # a ccxt member that degraded in the cash pass could momentarily RECONSTRUCT in
        # the MTM re-crawl (e.g. a same-UTC-day flow price now cached) or vice versa.
        # If that happens the MTM basis would be computed over a DIFFERENT member set
        # than the cash headline while the factsheet says "Key N excluded" — mismatched
        # bases. So ENFORCE the invariant rather than assume it: compare the two
        # degraded seq-sets and FAIL LOUD on divergence. We take the authoritative
        # degraded list from the CASH pass (`degraded_members` above), mirroring how
        # the MTM option-activity signals are discarded. NOTE: the MTM pass DOES run
        # for a composite that contains a degraded ccxt member — that member is
        # `continue`d before its signal is appended, so `member_signals` is
        # Deribit-only and `mark_to_market_available` can return True on the perp-only
        # Deribit remainder.
        clipped_mtm, _mtm_signals, _mtm_venues, _mtm_metas, _mtm_degraded = mtm_result
        _cash_degraded_seqs = {int(d["seq"]) for d in degraded_members}
        _mtm_degraded_seqs = {int(d["seq"]) for d in _mtm_degraded}
        if _mtm_degraded_seqs != _cash_degraded_seqs:
            # TRANSIENT (retryable, NO terminal `_stamp_failed`): a re-run re-crawls
            # BOTH passes and they re-converge; this is a live-read race, not a
            # structural defect. Mirrors the 429 / geo-block transient returns above,
            # which likewise skip the terminal stamp so the retry re-runs cleanly.
            return DispatchResult(
                outcome=DispatchOutcome.FAILED,
                error_message=(
                    "run_stitch_composite_job: MTM pass degraded-member set "
                    f"{sorted(_mtm_degraded_seqs)} diverges from the cash pass "
                    f"{sorted(_cash_degraded_seqs)} — the two bases would be computed "
                    "over different member sets; retry to re-crawl both consistently"
                ),
                error_kind="transient",
            )
        try:
            # Phase 103 (MTM-04): stitch → the ONE shared derive_basis_series (same
            # convention variables the cash derive above uses). The
            # stitch stays INSIDE this try so CompositeOverlapError handling below is
            # untouched; derive_basis_series propagates compute_all_metrics's
            # ValueError into the existing F-5 arm. The persisted MTM dailies are the
            # canonical source for Plans 03/04.
            stitched_mtm = stitch_clipped_series(clipped_mtm)
            # Phase 103 (MTM-04, BACKEND FIX 3): a degenerate-length stitched MTM
            # series (< 2 interpretable days) raises a bare ValueError from
            # compute_all_metrics that the generic ValueError arm below would
            # MISATTRIBUTE to an "interior chain-break under the arithmetic
            # convention" (a distinct, structural cause). Detect the degenerate-length
            # case explicitly and stamp an accurate, dedicated message. Guards ONLY the
            # MTM second pass — cash behavior is unchanged (the cash compute has its
            # own < 2 guards at :2756 / :3675 / :4090).
            if int(stitched_mtm.notna().sum()) < 2:
                await _stamp_failed(
                    "Composite mark-to-market series has fewer than two interpretable "
                    "days after stitching, so mark-to-market metrics cannot be computed."
                )
                return DispatchResult(
                    outcome=DispatchOutcome.FAILED,
                    error_message=(
                        "run_stitch_composite_job: MTM series degenerate-length "
                        "(< 2 interpretable days after stitching)"
                    ),
                    error_kind="permanent",
                )
            _mtm_basis_result = derive_basis_series(
                stitched_mtm,
                benchmark_rets,
                periods_per_year=periods_per_year,
                cumulative_method=cumulative_method,
                day_basis=day_basis,
                # LOW-2: benchmark identity carry (payload-only; conventions.benchmark
                # is consumed by no reader this phase — byte-visible solely in the
                # persisted MTM series payload, mirroring the cash derive above).
                benchmark_symbol="BTC",
            )
            mtm_metrics_json = dict(_mtm_basis_result.metrics_json)
        except CompositeOverlapError as exc:
            scrubbed = str(scrub_freeform_string(str(exc)))
            await _stamp_failed(
                "Composite MTM member series collide on a calendar day. " + scrubbed
            )
            return DispatchResult(
                outcome=DispatchOutcome.FAILED,
                error_message=(
                    "run_stitch_composite_job: MTM post-clip day collision — " + scrubbed
                ),
                error_kind="permanent",
            )
        except ValueError as exc:
            # F-5: same bare-ValueError guard as the cash compute — a simple-basis
            # interior chain-break must fail PERMANENT, not retry-forever as 'unknown'.
            scrubbed = str(scrub_freeform_string(str(exc)))
            await _stamp_failed(
                "Composite MTM metrics compute rejected the stitched series "
                "(interior chain-break under the arithmetic convention). " + scrubbed
            )
            return DispatchResult(
                outcome=DispatchOutcome.FAILED,
                error_message=(
                    "run_stitch_composite_job: MTM metrics ValueError — " + scrubbed
                ),
                error_kind="permanent",
            )

    # 6b. SMTM-01 (Phase 132): additive smoothed_mtm THIRD pass. A SEPARATE
    # availability decision (smoothed_mtm_available) that OPENS exactly what the MTM
    # gate honestly keeps closed on an un-smoothed options book — it keys on
    # option-activity ALONE and does NOT consult or mutate mtm_ok / mtm_reason (the MTM
    # gate decision above stays byte-identical). Mirrors the MTM second pass: a THIRD
    # per-Deribit-member ledger fan-out in smoothed_mtm basis, stitched through the ONE
    # shared derive_basis_series. FAIL-LOUD throughout (mirroring the composite MTM
    # pass, which also fails the whole job rather than degrading): a per-leg
    # reconstruction failure surfaces as a DispatchResult from _reconstruct_all (its
    # _PERMANENT_LEDGER_ERRORS handler — LedgerValuationError included — stamps failed),
    # and a metrics/overlap/degenerate failure stamps + returns here. NEVER a silent
    # two-basis fallback, NEVER a gate-close on a leg failure. A no-option composite
    # (smoothed_ok False) runs NO third pass and persists NO smoothed artifacts (SC-4).
    smoothed_ok = smoothed_mtm_available(member_signals)
    smoothed_metrics_json: dict[str, Any] | None = None
    _smoothed_basis_result: BasisSeriesResult | None = None
    if smoothed_ok:
        smoothed_result = await _reconstruct_all(PNL_BASIS_SMOOTHED_MTM)
        if isinstance(smoothed_result, DispatchResult):
            # A per-leg smoothed reconstruction failure (holed marks / retention
            # straddle → LedgerValuationError) already stamped failed inside
            # _reconstruct_all — fail the WHOLE job loud, never a silent fallback.
            return smoothed_result
        clipped_smoothed, _sm_signals, _sm_venues, _sm_metas, _sm_degraded = (
            smoothed_result
        )
        # Degraded-member invariant (mirror the MTM pass): the smoothed pass must
        # exclude the SAME members as the authoritative cash pass, else the bases would
        # be computed over different member sets. Compare against degraded_members (the
        # cash pass's list) directly — _cash_degraded_seqs is scoped inside the mtm_ok
        # arm above and is undefined on the gated (options) path this pass serves.
        _sm_degraded_seqs = {int(d["seq"]) for d in _sm_degraded}
        if _sm_degraded_seqs != {int(d["seq"]) for d in degraded_members}:
            return DispatchResult(
                outcome=DispatchOutcome.FAILED,
                error_message=(
                    "run_stitch_composite_job: smoothed_mtm pass degraded-member set "
                    f"{sorted(_sm_degraded_seqs)} diverges from the cash pass — the "
                    "bases would span different member sets; retry to re-crawl both"
                ),
                error_kind="transient",
            )
        try:
            stitched_smoothed = stitch_clipped_series(clipped_smoothed)
            if int(stitched_smoothed.notna().sum()) < 2:
                await _stamp_failed(
                    "Composite smoothed-MTM series has fewer than two interpretable "
                    "days after stitching, so smoothed metrics cannot be computed."
                )
                return DispatchResult(
                    outcome=DispatchOutcome.FAILED,
                    error_message=(
                        "run_stitch_composite_job: smoothed_mtm series degenerate-"
                        "length (< 2 interpretable days after stitching)"
                    ),
                    error_kind="permanent",
                )
            _smoothed_basis_result = derive_basis_series(
                stitched_smoothed,
                benchmark_rets,
                periods_per_year=periods_per_year,
                cumulative_method=cumulative_method,
                day_basis=day_basis,
                benchmark_symbol="BTC",
            )
            smoothed_metrics_json = dict(_smoothed_basis_result.metrics_json)
        except CompositeOverlapError as exc:
            scrubbed = str(scrub_freeform_string(str(exc)))
            await _stamp_failed(
                "Composite smoothed-MTM member series collide on a calendar day. "
                + scrubbed
            )
            return DispatchResult(
                outcome=DispatchOutcome.FAILED,
                error_message=(
                    "run_stitch_composite_job: smoothed_mtm post-clip day collision — "
                    + scrubbed
                ),
                error_kind="permanent",
            )
        except ValueError as exc:
            scrubbed = str(scrub_freeform_string(str(exc)))
            await _stamp_failed(
                "Composite smoothed-MTM metrics compute rejected the stitched series "
                "(interior chain-break under the arithmetic convention). " + scrubbed
            )
            return DispatchResult(
                outcome=DispatchOutcome.FAILED,
                error_message=(
                    "run_stitch_composite_job: smoothed_mtm metrics ValueError — "
                    + scrubbed
                ),
                error_kind="permanent",
            )

    # 7. PERSIST (OQ-3 ordering): (1) csv_daily_returns, (2) headline CSV analytics,
    # (3) additive metrics_json_by_basis + merged DQ flags.
    #
    # (1) csv_daily_returns — the stitched cash_settlement series. Gap/guarded days
    # are honestly ABSENT (NaN-skip, 74-04 policy; never 0.0 as performance). The
    # reconcile-span-delete is scoped to strategy_id over the reconstructed span so
    # a re-derive is authoritative and idempotent.
    rows_payload = [
        {
            "strategy_id": strategy_id,
            "date": ts.date().isoformat(),
            "daily_return": float(val),
        }
        for ts, val in stitched_cash.items()
        if pd.notna(val)
    ]
    # (The <2-present-day guard is hoisted ABOVE the compute — see F2 above —
    # so rows_payload is guaranteed to carry ≥2 rows here.)

    def _reconcile_full_delete() -> None:
        # F5(a): the composite fully OWNS its csv_daily_returns series — an
        # authoritative re-derive replaces it WHOLESALE. Deleting only the NEW
        # [span_start, span_end] left stale rows OUTSIDE a SHRUNK span (e.g. a
        # re-derive after a member window shortened or a member was removed),
        # which run_csv_strategy_analytics then folded back into the headline.
        # Delete EVERY row for this strategy_id before the upsert so a shrinking
        # re-derive is idempotent and can't resurrect orphaned days.
        (
            supabase.table("csv_daily_returns")
            .delete()
            .eq("strategy_id", strategy_id)
            .execute()
        )

    await db_execute(_reconcile_full_delete)

    _UPSERT_CHUNK = 1000
    for _start in range(0, len(rows_payload), _UPSERT_CHUNK):
        _batch = rows_payload[_start:_start + _UPSERT_CHUNK]

        def _upsert_dailies(batch: list[dict[str, Any]] = _batch) -> None:
            supabase.table("csv_daily_returns").upsert(
                batch, on_conflict="strategy_id,date"
            ).execute()

        await db_execute(_upsert_dailies)

    # (2) + (3) ONE atomic headline + by-basis write (root-cause fix). The composite
    # HEADLINE metrics_json is the SAME cash_metrics_json spread into
    # metrics_json_by_basis.cash_settlement — computed ONCE from the in-memory
    # stitched series (same NaN handling, same venue-blend periods_per_year, same
    # cumulative/day-basis conventions). Previously the headline was delegated to
    # run_csv_strategy_analytics(composite_dense_gap_fill=True), which re-read the
    # SPARSE csv_daily_returns and applied SINGLE-KEY semantics that diverged:
    # periods_per_year_for_asset_class(strategies.asset_class) annualized a
    # 'traditional'-default composite on √252 while the by-basis object used the
    # venue blend (deribit → 365), and its 0.0 gap-fill fabricated flat performance
    # for refused/guard days the honest by-basis series leaves as chain breaks.
    # csv_daily_returns above stays for charting only; the headline no longer routes
    # through that recompute, so headline == by-basis.cash_settlement by construction.
    from services.allocated_capital import ALLOCATED_CAPITAL_GUARD_KEYS
    from services.nav_twr import NAV_TWR_GUARD_KEYS

    # The by-basis object OMITS an unavailable basis key (SQL NULL never JSON null —
    # Phase 85 CHECK): only computed bases are inserted.
    metrics_json_by_basis: dict[str, Any] = {"cash_settlement": cash_metrics_json}
    if mtm_metrics_json is not None:
        metrics_json_by_basis["mark_to_market"] = mtm_metrics_json
    # SMTM-01 (Phase 132): the additive smoothed_mtm key — present ONLY from a
    # completed smoothed pass (same omission contract as mark_to_market: absent, never
    # JSON null). Smoothing OPENS what MTM keeps closed, so on an options composite
    # mark_to_market is ABSENT here while smoothed_mtm is PRESENT.
    if smoothed_metrics_json is not None:
        metrics_json_by_basis["smoothed_mtm"] = smoothed_metrics_json

    # Finding 3: union each member's NavTWRMeta guard flags into the composite DQ
    # flags and promote to complete_with_warnings — mirror the single-key bridge in
    # run_csv_strategy_analytics (~2334-2347). run_stitch_composite_job previously
    # DISCARDED the per-member meta (`returns, _meta = combine_native_ledger(...)`),
    # so a composite built from a guard-day / heuristic-capital / chain-broken member
    # shipped a clean 'complete' factsheet with no honest caveat. The cash pass metas
    # carry the authoritative guard signal (the MTM pass is discarded on purpose).
    member_warn_flags: dict[str, bool] = {}
    member_warned = False
    for _member_meta in member_metas:
        for _flag in NAV_TWR_GUARD_KEYS:
            if _member_meta.get(_flag):
                member_warn_flags[_flag] = True
                member_warned = True
        for _flag in ALLOCATED_CAPITAL_GUARD_KEYS:
            if _member_meta.get(_flag):
                member_warn_flags[_flag] = True
                member_warned = True
        # used_heuristic_capital is a NON-guard NavTWRMeta key (kept OUT of
        # NAV_TWR_GUARD_KEYS by design) but still an honest data-quality caveat —
        # a member whose NAV denominator fell back to a heuristic capital base.
        if _member_meta.get("used_heuristic_capital"):
            member_warn_flags["used_heuristic_capital"] = True
            member_warned = True

    # HARD-05: a composite MISSING a member (a degraded ccxt member) IS warn-worthy —
    # it rides the existing complete_with_warnings promotion. This is deliberate per
    # research Pitfall 5 (unlike the pure-annotation insufficient_window, an excluded
    # member changes the composite's coverage, so the status must reflect it). The
    # degraded_members flag stays OUT of NAV_TWR_GUARD_KEYS (single-key blast radius
    # stays zero); this is a direct promotion, not a guard-key registration.
    if degraded_members:
        member_warned = True

    def _read_existing_flags() -> dict[str, Any]:
        res = (
            supabase.table("strategy_analytics")
            .select("data_quality_flags")
            .eq("strategy_id", strategy_id)
            .maybe_single()
            .execute()
        )
        row = getattr(res, "data", None) or {}
        return dict(row.get("data_quality_flags") or {})

    existing_flags = await db_execute(_read_existing_flags)
    # MERGE (read-modify-write) — preserve every existing flag (e.g. a prior derive's
    # benchmark_unavailable), add the composite coverage-mask fields.
    merged_flags: dict[str, Any] = dict(existing_flags)
    merged_flags["csv_source"] = True
    merged_flags["composite"] = True
    merged_flags["per_key"] = mask["per_key"]
    merged_flags["gap_spans"] = mask["gap_spans"]
    merged_flags["gap_day_count"] = mask["gap_day_count"]
    merged_flags["overlap_days"] = mask["overlap_days"]
    # Finding 5 (composite direction): mtm_gated_reason is the only conditionally-
    # present coverage-mask key. DROP a stale one when THIS derive ADMITS MTM, else a
    # prior gated run's reason would linger next to a now-present mark_to_market basis
    # (the per_key / gap_* keys are unconditionally overwritten above, so no stale).
    if not mtm_ok and mtm_reason is not None:
        merged_flags["mtm_gated_reason"] = mtm_reason
    else:
        merged_flags.pop("mtm_gated_reason", None)
    # HARD-04 (#67): lift the CAGR-site insufficient_window annotation, mirroring
    # the mtm_gated_reason drop-stale pattern above — a composite that GROWS past
    # MIN_ANNUALIZATION_DAYS heals (loses the flag) on the next re-stitch. Read
    # from the CANONICAL cash derive result (`_cash_basis_result`, the ONE shared
    # composite compute); the MTM second pass shares the same window by
    # construction. Annotation only — it deliberately does NOT touch
    # computation_status (not a NAV_TWR_GUARD_KEYS member).
    if _cash_basis_result.insufficient_window:
        merged_flags["insufficient_window"] = True
    else:
        merged_flags.pop("insufficient_window", None)
    # HARD-05 (#): lift the degraded-member records (ccxt members excluded from the
    # stitch this phase) so the user SEES the exclusion on both DQ surfaces. Drop-stale
    # heals on re-stitch (mtm_gated_reason / insufficient_window mirror): an all-Deribit
    # re-stitch, or one where a formerly-degraded member is later reconstructed (Plan
    # 93-04), pops the key. The list carries a CLOSED key-set {seq, venue, reason} with
    # `reason` a fixed enum literal — leak discipline (T-93-03-01), pinned by a test.
    if degraded_members:
        merged_flags["degraded_members"] = degraded_members
    else:
        merged_flags.pop("degraded_members", None)
    # HARD-03 (#69 / Phase-90 LOW-2): freeze the RAW cumulation method the ONE
    # canonical compute above actually used ("geometric"|"simple", decided at
    # :3312-3317) into the DQ flags so the factsheet read-path can PREFER it over a
    # live re-derive from strategies.returns_denominator_config — editing the config
    # after publish without re-stitching can no longer flip the chart basis away
    # from the frozen headline scalars. `cumulative_method` is always defined here,
    # so a plain unconditional set is the correct drop-stale form (every re-stitch
    # overwrites; no stale value survives). Persist the RAW worker string, NOT the
    # resolved "arithmetic"/"geometric" read basis — the "simple"→"arithmetic" map
    # lives in exactly ONE place (the read side), so persisted and live-fallback
    # share one rule and cannot diverge (research Pitfall 1).
    merged_flags["cumulative_method"] = cumulative_method
    # F-2: surface benchmark availability so the factsheet renders the "benchmark
    # unavailable" note instead of a silently-missing BTC family. DROP a stale flag
    # when the fetch succeeded this derive (the benchmark healed).
    if benchmark_stale or benchmark_rets is None:
        merged_flags["benchmark_unavailable"] = True
        merged_flags["benchmark_note"] = (
            "Benchmark data unavailable. Alpha, beta, and correlation not computed."
        )
    else:
        merged_flags.pop("benchmark_unavailable", None)
        merged_flags.pop("benchmark_note", None)
    for _flag, _val in member_warn_flags.items():
        merged_flags[_flag] = _val

    composite_status = "complete_with_warnings" if member_warned else "complete"

    headline_payload: dict[str, Any] = {
        "strategy_id": strategy_id,
        "computation_status": composite_status,
        "computation_warned": member_warned,
        "computation_error": None,
        "trade_metrics": None,     # composite has no fills
        "volume_metrics": None,
        "exposure_metrics": None,
        "metrics_json_by_basis": metrics_json_by_basis,
        "data_quality_flags": merged_flags,
    }
    # Spread the canonical composite scalars into the headline — the SAME object as
    # metrics_json_by_basis.cash_settlement. A single upsert also REPLACES
    # metrics_json_by_basis wholesale (Finding 5) so a prior mark_to_market basis
    # can't survive a now-gated re-derive.
    headline_payload.update(cash_metrics_json)

    # Phase 105 (SC-5 / D5): ORDERED-IDEMPOTENT finalize. BOTH basis series (cash +
    # MTM below) land BEFORE the DONE-bearing headline/by-basis scalar flip — together
    # with the reconcile-delete + dailies upserts above (:4520-4560). A worker death
    # before the flip therefore leaves NO complete scalar without its series (MED-1's
    # read gate un-trusts a scalar whose series is absent); the kill-point test pins
    # this. Cash ALWAYS persists a real row here — a rejected cash derive already
    # returned via the F-5 arm above, so `_cash_basis_result` is a genuine result.
    #
    # D5 HONEST BOUNDARY: ordered-idempotent = GATED EVENTUAL CONSISTENCY, not
    # atomicity — supabase-py has no cross-.table() transaction. On a RE-derive of an
    # already-complete strategy, a death between the dailies delete/upsert (:4520-4560,
    # PRE-EXISTING) and the scalar flip leaves old-scalar + partial-dailies visible
    # until the authoritative-re-derive retry heals it (_reconcile_full_delete
    # idempotence + single-row series upserts). That transient chart/KPI mismatch
    # window is PRE-EXISTING and UNCHANGED here — 105 makes nothing worse. Strict
    # atomicity (a service-role SECDEF finalize RPC) is deliberately DEFERRED to ride
    # 106's fold migration (which already carries DDL + test-project catch-up +
    # migration review); do NOT make 105 prod-DDL-affecting for a window that exists.
    def _persist_cash_series() -> None:
        persist_basis_series(
            supabase,
            strategy_id,
            basis="cash_settlement",
            result=_cash_basis_result,
        )

    await db_execute(_persist_cash_series)

    # Phase 103 (MTM-04, BACKEND FIX 2): persist (or HEAL) the stitched
    # mark_to_market daily-return series row BEFORE the DONE-bearing headline/by-basis
    # scalar upsert below — matching the single-key broker-derive seam, which (as of
    # 106-02 / D5) also lands both basis series before the DONE-gating by-basis scalar
    # prestamp the downstream csv-analytics job then compiles into the factsheet.
    # Ordering is load-bearing: the by-basis mark_to_market SCALAR is the F-4
    # read gate. This ordering does NOT ELIMINATE the partial-write window — it
    # REVERSES it into the SELF-HEALING direction. If the scalar landed FIRST and a
    # transient series upsert then failed on a re-stitch, the gate would render fresh
    # scalars over a stale/missing series (the HARMFUL direction — a mislabeled read).
    # Persisting the series first means the only remaining transient window is
    # fresh-series + stale-SCALAR (a scalar-upsert failure after a successful series
    # write on a re-stitch). That window is BENIGN: both rows are genuinely MTM (never
    # cash), so the read is a mixed stale-MTM-scalar + fresh-MTM-series — the headline
    # numbers lag the chart by one derive, never mislabel a basis — and the next
    # re-derive lands the matching scalar and heals it. A series-write failure itself
    # aborts the whole
    # derive (fail-loud db_execute) BEFORE the gating scalar is written, so the read
    # gate can never observe the harmful fresh-scalar + stale-series. Success
    # (mtm_metrics_json is not
    # None) → the row; every other shape — gated (mtm_ok False) or any future degrade →
    # persist_basis_series(result=None) DELETES any stale row (Pitfall 5), so a
    # previously-successful strategy that re-derives gated loses its stale series.
    def _persist_mtm_series() -> None:
        persist_basis_series(
            supabase,
            strategy_id,
            basis="mark_to_market",
            result=_mtm_basis_result if mtm_metrics_json is not None else None,
        )

    await db_execute(_persist_mtm_series)

    # SMTM-01 (Phase 132): persist the stitched smoothed_mtm daily-return series BEFORE
    # the DONE-bearing headline/by-basis scalar upsert (same ordering discipline as the
    # cash/MTM series above). GUARDED (unlike the always-heal MTM persist): written ONLY
    # when the third pass ran AND produced a computable object — a no-option composite
    # (smoothed_ok False) touches the smoothed_mtm series row not at all (SC-4: NO
    # smoothed artifacts, byte-invisible). A started-but-failed smoothed pass fails the
    # whole job upstream, so there is no attempted-but-null smoothed persist to heal.
    if smoothed_metrics_json is not None:
        _smoothed_persist_result = _smoothed_basis_result

        def _persist_smoothed_series() -> None:
            persist_basis_series(
                supabase,
                strategy_id,
                basis="smoothed_mtm",
                result=_smoothed_persist_result,
            )

        await db_execute(_persist_smoothed_series)

    def _write_headline_and_by_basis() -> None:
        supabase.table("strategy_analytics").upsert(
            headline_payload, on_conflict="strategy_id"
        ).execute()

    await db_execute(_write_headline_and_by_basis)

    # Above-the-fold sibling series (rolling metrics, drawdown curve) for the
    # composite factsheet charts — computed from the SAME canonical cash compute so
    # they agree with the headline. Guarded exactly like run_csv_strategy_analytics:
    # a transient RPC blip is logged, never fails the (already-persisted) derive.
    if _cash_basis_result.sibling_kinds:
        try:
            def _upsert_siblings() -> None:
                supabase.rpc(
                    "upsert_strategy_analytics_series_batch",
                    {
                        "p_strategy_id": strategy_id,
                        "p_kinds": _cash_basis_result.sibling_kinds,
                    },
                ).execute()

            await db_execute(_upsert_siblings)
        except Exception as sibling_exc:  # noqa: BLE001
            logger.warning(
                "stitch_composite: sibling-series batch upsert failed for %s: %s",
                strategy_id, str(sibling_exc),
            )

    logger.info(
        "stitch_composite: strategy %s stitched %d members (%d days, venues=%s, "
        "mtm=%s) — by-basis persisted",
        strategy_id, len(members), len(rows_payload), sorted(set(venues)),
        "on" if mtm_ok else f"gated:{mtm_reason}",
    )
    return DispatchResult(outcome=DispatchOutcome.DONE)


async def run_poll_positions_job(job: dict[str, Any]) -> DispatchResult:
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
    except ccxt.RateLimitExceeded as exc:
        await _stamp_429(ctx.supabase, ctx.key_row, exc)
        raise
    finally:
        try:
            await aclose_exchange(ctx.exchange)
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


async def run_poll_allocator_positions_job(job: dict[str, Any]) -> DispatchResult:
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
            await _stamp_429(ctx.supabase, ctx.key_row, exc)
            error_kind, msg = classify_exception(exc)
            sanitized = msg[:500]
            # A geo-block is mis-mapped to RateLimitExceeded but is NOT a rate
            # limit (classify_exception returns 'permanent'): don't persist a
            # misleading sync_status='rate_limited' for a key that is
            # permanently geo-blocked from this region — surface 'error'.
            sync_status = "error" if is_geo_blocked(exc) else "rate_limited"

            def _update_rate_limited() -> None:
                # Return value discarded by the caller; drop it (matches
                # _update_persist_err below) so we never annotate the Any-typed
                # `.execute()` as APIResponse.
                ctx.supabase.table("api_keys").update(
                    {"sync_status": sync_status, "sync_error": sanitized}
                ).eq("id", api_key_id).execute()

            try:
                await db_execute(_update_rate_limited)
            except Exception as upd_exc:  # noqa: BLE001
                logger.warning(
                    "poll_allocator_positions: failed to persist sync_status=%r "
                    "for api_key %s: %s",
                    sync_status, api_key_id, upd_exc,
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

            def _update_err() -> None:
                # Return value discarded by the caller; drop it (see
                # _update_rate_limited / _update_persist_err).
                ctx.supabase.table("api_keys").update(
                    {"sync_status": status_target, "sync_error": sanitized}
                ).eq("id", api_key_id).execute()

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
            await aclose_exchange(ctx.exchange)
        except Exception:  # pragma: no cover - defensive cleanup
            pass

    # Persist + success status update.
    # NEW-C12-03: wrap in a try/except that stamps sync_status='error' on
    # failure so the UI doesn't spin forever on 'syncing'. Pre-fix a
    # persist_allocator_holdings raise propagated to the compute_jobs FAILED
    # handler but sync_status was never moved off 'syncing'. A failed
    # _update_ok was previously a swallowed warning leaving the same stuck state.
    try:
        count = await persist_allocator_holdings(
            ctx.supabase, rows, allocator_id, api_key_id, today_str
        )

        spot_count = sum(1 for r in rows if r.get("holding_type") == "spot")
        deriv_count = sum(1 for r in rows if r.get("holding_type") == "derivative")

        final_status = "complete_with_warnings" if warning else "complete"

        def _update_ok() -> None:
            # Return value discarded by the caller; drop it (see
            # _update_rate_limited / _update_persist_err).
            ctx.supabase.table("api_keys").update({
                "sync_status": final_status,
                "sync_error": warning,
                "last_sync_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", api_key_id).execute()

        # NEW-C12-03: treat _update_ok failure as a hard error (not a swallowed
        # warning) — a missed sync_status write leaves the UI spinner stuck on
        # 'syncing' with no recovery path since allocator jobs have no strategy_id
        # bridge to the dispatch UI.
        await db_execute(_update_ok)
    except Exception as persist_exc:  # noqa: BLE001
        sanitized_persist = str(persist_exc)[:200]
        logger.exception(
            "poll_allocator_positions: persist/update failed for allocator %s "
            "(api_key %s) — stamping sync_status='error' to unblock UI: %s",
            allocator_id, api_key_id, sanitized_persist,
        )
        # Best-effort: stamp sync_status so the UI exits the spinner.
        try:
            def _update_persist_err() -> None:
                ctx.supabase.table("api_keys").update(
                    {"sync_status": "error", "sync_error": sanitized_persist}
                ).eq("id", api_key_id).execute()
            await db_execute(_update_persist_err)
        except Exception as stamp_exc:  # noqa: BLE001
            logger.warning(
                "poll_allocator_positions: failed to stamp sync_status='error' "
                "for api_key %s after persist failure: %s",
                api_key_id, stamp_exc,
            )
        _emit_audit(
            allocator_id, api_key_id, "allocator.holdings.persist_failed",
            {"sanitized_message": sanitized_persist},
        )
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message=sanitized_persist,
            error_kind="permanent",
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
    def _stamp_first_sync() -> None:
        # Return value discarded by the caller; drop it (see
        # _update_rate_limited / _update_persist_err).
        ctx.supabase.rpc(
            "stamp_first_sync_success",
            {"p_user_id": allocator_id},
        ).execute()

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


async def run_reconcile_strategy_job(job: dict[str, Any]) -> DispatchResult:
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
    except ccxt.RateLimitExceeded as exc:
        await _stamp_429(ctx.supabase, ctx.key_row, exc)
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
            await aclose_exchange(ctx.exchange)
        except Exception:  # pragma: no cover - defensive cleanup
            pass

    # Step 2: load DB fills for the same window. We only select the
    # columns that diff_strategy_fills actually reads (verified against
    # services/reconciliation.py:_summarize + matcher key extraction).
    # Hard cap at 50k rows so a runaway-strategy can't OOM the worker.
    def _load_db_fills() -> list[dict[str, Any]]:
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
        return rows(res)

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
    # When owner_id is unresolvable, the alerting fan-out below still runs so
    # the report is not lost. Two sub-cases, both searchable:
    #   - deleted strategy (no row): one() returns None → owner_id None → the
    #     M-0669 `else` warning ("reconcile.compare audit dropped … owner_id=None")
    #     fires. (Pre-B-mypy this no-row path raised AttributeError on
    #     `res.data`, caught below as `audit_owner_lookup_failed=true`; routing
    #     through one() makes the deleted-strategy case the graceful None the
    #     epilogue already handles.)
    #   - transient blip (503/RLS): the SELECT still raises → caught below →
    #     `audit_owner_lookup_failed=true` warning.
    def _load_strategy_owner() -> str | None:
        res = (
            ctx.supabase.table("strategies")
            .select("user_id")
            .eq("id", strategy_id)
            .maybe_single()
            .execute()
        )
        row = one(res)
        return row.get("user_id") if row else None

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
        # one() yields {} (→ "Strategy") if the strategy was deleted between
        # preflight and here. This call is not try/except-wrapped, so pre-B-mypy
        # the no-row path raised AttributeError on `res.data`, failing+retrying
        # the whole reconcile job; one() degrades it to the existing "Strategy"
        # fallback so the sync_failure alert fan-out still completes (a deleted
        # strategy should not perma-retry a reconcile).
        return (one(res) or {}).get("name") or "Strategy"

    def _load_portfolio_ids() -> list[str]:
        res = (
            ctx.supabase.table("portfolio_strategies")
            .select("portfolio_id")
            .eq("strategy_id", strategy_id)
            .execute()
        )
        return [r["portfolio_id"] for r in rows(res) if r.get("portfolio_id")]

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
    def _load_existing_alerts() -> dict[str, dict[str, Any]]:
        res = (
            ctx.supabase.table("portfolio_alerts")
            .select("id, portfolio_id, severity")
            .in_("portfolio_id", portfolio_ids)
            .eq("alert_type", "sync_failure")
            .is_("acknowledged_at", "null")
            .execute()
        )
        return {r["portfolio_id"]: r for r in rows(res)}

    existing_by_portfolio = await db_execute(_load_existing_alerts)

    new_severity_rank = SEVERITY_RANK.get(severity, 1)
    metadata = {
        "strategy_id": strategy_id,
        "report_date": report.report_date,
        "discrepancy_count": report.discrepancy_count,
        "status": report.status,
    }

    inserts: list[dict[str, Any]] = []
    escalations: list[dict[str, Any]] = []
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
            def _update(rid: str = row["id"]) -> None:
                ctx.supabase.table("portfolio_alerts").update(
                    update_payload
                ).eq("id", rid).execute()
            await db_execute(_update)

    return DispatchResult(outcome=DispatchOutcome.DONE)


async def run_compute_intro_snapshot_job(job: dict[str, Any]) -> DispatchResult:
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

    def _load_contact_request() -> dict[str, Any] | None:
        res = (
            supabase.table("contact_requests")
            .select("id, allocator_id, strategy_id")
            .eq("id", contact_request_id)
            .maybe_single()
            .execute()
        )
        return one(res)

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
    def _load_portfolio() -> dict[str, Any] | None:
        res = (
            supabase.table("portfolios")
            .select("id")
            .eq("user_id", allocator_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        data = rows(res)
        return data[0] if data else None

    portfolio = await db_execute(_load_portfolio)

    snapshot: dict[str, Any] = {
        "sharpe": None,
        "max_drawdown": None,
        "concentration": None,
        "top_3_strategies": [],
        "bottom_3_strategies": [],
        "alerts_last_7d": 0,
    }

    if portfolio:
        portfolio_id = portfolio["id"]

        def _load_portfolio_analytics() -> dict[str, Any] | None:
            res = (
                supabase.table("portfolio_analytics")
                .select("portfolio_sharpe, portfolio_max_drawdown")
                .eq("portfolio_id", portfolio_id)
                .order("computed_at", desc=True)
                .limit(1)
                .execute()
            )
            data = rows(res)
            return data[0] if data else None

        analytics = await db_execute(_load_portfolio_analytics)
        if analytics:
            snapshot["sharpe"] = analytics.get("portfolio_sharpe")
            snapshot["max_drawdown"] = analytics.get("portfolio_max_drawdown")

        # Strategy links + names
        def _load_links() -> list[dict[str, Any]]:
            res = (
                supabase.table("portfolio_strategies")
                .select(
                    "strategy_id, current_weight, allocated_amount, "
                    "strategies(id, name)"
                )
                .eq("portfolio_id", portfolio_id)
                .execute()
            )
            return rows(res)

        links = await db_execute(_load_links)

        # Per-strategy sharpe lookup (single query rather than N+1).
        strategy_ids = [link["strategy_id"] for link in links if link.get("strategy_id")]
        sharpe_map: dict[str, float | None] = {}
        if strategy_ids:
            def _load_strategy_sharpes() -> list[dict[str, Any]]:
                res = (
                    supabase.table("strategy_analytics")
                    .select("strategy_id, sharpe")
                    .in_("strategy_id", strategy_ids)
                    .execute()
                )
                return rows(res)

            sharpe_rows = await db_execute(_load_strategy_sharpes)
            for row in sharpe_rows:
                sharpe_map[row["strategy_id"]] = row.get("sharpe")

        # Concentration (HHI): prefer current_weight, fall back to allocated_amount.
        weights = [
            w for link in links
            if isinstance((w := link.get("current_weight")), (int, float))
        ]
        if len(weights) == len(links) and len(weights) > 0:
            total = sum(weights)
            if total > 0:
                snapshot["concentration"] = sum((w / total) ** 2 for w in weights)
        else:
            amounts = [
                a for link in links
                if isinstance((a := link.get("allocated_amount")), (int, float))
                and a > 0
            ]
            if amounts:
                total = sum(amounts)
                snapshot["concentration"] = sum((a / total) ** 2 for a in amounts)

        # Rank by sharpe for top/bottom 3 (strategies without a sharpe are
        # excluded — a NULL ranking tells the manager nothing).
        ranked = []
        for link in links:
            sid = link.get("strategy_id")
            strat = link.get("strategies") or {}
            name = strat.get("name") if isinstance(strat, dict) else None
            # sid is Any | None (link.get); sharpe_map.get needs a str key. A
            # None sid can't match any sharpe key anyway, so map it to None —
            # identical to the prior dict.get(None) → None lookup.
            sh = sharpe_map.get(sid) if sid is not None else None
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
                .select("id", count=CountMethod.exact)
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


async def _mark_intro_snapshot_failed(job: dict[str, Any]) -> None:
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


async def run_rescore_allocator_job(job: dict[str, Any]) -> DispatchResult:
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
    from routers.match import (
        _load_allocator_context,
        _load_candidate_universe,
        _score_one_allocator,
    )
    from services.feedback_engine import compute_adjusted_weights
    from services.match_engine import compute_effective_weights

    allocator_id = job.get("allocator_id")
    if not allocator_id:
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_kind="permanent",
            error_message="rescore_allocator job missing allocator_id — check migration 062 kind_target_coherence",
        )

    # NEW-C12-09: validate the allocator's OWN (cheap, single-allocator-scoped)
    # mandate BEFORE the ~30k-strategy, allocator-INDEPENDENT universe scan.
    # A structurally-broken mandate (corrupt allocator_preferences row, a
    # non-dict / non-numeric scoring_weight_overrides, corrupt feedback inputs)
    # raises a DETERMINISTIC Python error. Pre-fix that surfaced only inside
    # _score_one_allocator AFTER the scan, classified 'unknown', and was
    # RETRIED up to 3x — re-paying the entire universe scan + a _scoring_semaphore
    # slot on every attempt for a failure caused by one allocator's data,
    # throttling concurrent rescores and the daily cron for everyone. Catching
    # it here fails the job 'permanent' (no retry, no scan). ctx + overrides are
    # threaded into _score_one_allocator below so the healthy path neither
    # re-loads the allocator rows nor double-emits compute_adjusted_weights'
    # audit event.
    #
    # Discriminate by TYPE, NOT via classify_exception: a transient transport
    # fault (postgrest.APIError, httpx.*, OSError) is a plain Exception subclass
    # that classify_exception buckets as 'unknown' (and asyncio.TimeoutError as
    # 'transient') — neither is distinguishable from a deterministic mandate
    # error by classify_exception, and both are RETRYABLE. The point is they
    # must NOT be in the caught deterministic-error tuple, so a momentary DB
    # blip propagates to the post-scoring classifier and stays retryable instead
    # of permanently failing a recoverable allocator.
    try:
        ctx = await asyncio.to_thread(_load_allocator_context, allocator_id)
        overrides = await asyncio.to_thread(compute_adjusted_weights, allocator_id)
        # Approximate _score_one_allocator's preference normalization and
        # score_candidates' mode gate: a missing allocator_preferences row
        # (None → default mandate) and an empty/None overrides dict are VALID.
        # (_load_allocator_context always populates the 'preferences' key, so the
        # defensive .get vs the scorer's ctx["preferences"] never diverges.)
        # The overridable-weight renormalization runs ONLY in personalized mode
        # (portfolio_strategies present), so only validate it then — a
        # screening-mode allocator (no portfolio) never renormalizes overrides
        # and must not be rejected for them.
        preferences = ctx.get("preferences")
        if preferences is not None and not isinstance(preferences, dict):
            raise TypeError(
                f"allocator_preferences is not a mapping (allocator_id={allocator_id})"
            )
        if ctx.get("portfolio_strategies"):
            # compute_effective_weights normalizes falsy overrides to {} itself,
            # so pass overrides straight through (matches the score_candidates
            # call site).
            compute_effective_weights(overrides, allocator_id)
    except (
        KeyError,
        ValueError,
        TypeError,
        AttributeError,
        AssertionError,
        ZeroDivisionError,
    ) as exc:
        logger.exception(
            "run_rescore_allocator_job preflight: deterministic bad mandate for allocator=%s",
            allocator_id,
        )
        _, sanitized = classify_exception(exc)
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_kind="permanent",
            error_message=f"rescore mandate invalid: {sanitized}",
        )

    universe = await asyncio.to_thread(_load_candidate_universe)
    if not universe["strategies_by_id"]:
        # No eligible strategies — no-op success (not a failure).
        # Mirrors routers/match.cron_recompute's empty_universe short-circuit.
        return DispatchResult(outcome=DispatchOutcome.DONE)

    try:
        await _score_one_allocator(
            allocator_id,
            universe,
            precomputed_ctx=ctx,
            precomputed_overrides=overrides,
        )
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
        #
        # NEW-C12-09: the cheap-precheckable deterministic mandate errors
        # (corrupt allocator_preferences / overrides / feedback inputs) are now
        # caught by the preflight ABOVE and fail 'permanent' before the universe
        # is ever scanned. This backstop remains for errors that only surface
        # against real candidates inside _score_one_allocator (transient DB
        # persist faults stay retryable; a deterministic per-candidate bug still
        # reaches failed_final after the retry budget, never an infinite loop).
        logger.exception("run_rescore_allocator_job failed for allocator=%s", allocator_id)
        error_kind, sanitized = classify_exception(exc)
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_kind=error_kind,
            error_message=f"rescore failed: {sanitized}",
        )

    return DispatchResult(outcome=DispatchOutcome.DONE)


async def run_derive_allocator_equity_job(job: dict[str, Any]) -> DispatchResult:
    """Phase 115.1 (RD-3 Option B) — CRAWL-FREE, DECRYPTION-FREE allocator
    $-equity compose.

    Assembles the frozen P115 core's inputs entirely from the DB — per-key
    ``csv_daily_returns`` (the dense per-key return axis) and the
    ``kind='key_inputs:<api_key_id>'`` rows the key-mode derive epilogue already
    persisted (real external flows + the live equity anchor it already fetched) —
    calls the pure ``compose_allocator_equity`` composition layer, and atomically
    upserts EXACTLY ONE ``(allocator_id, 'equity_curve')`` display row onto the
    NEW keyed surface. It NEVER decrypts a key, NEVER touches an exchange, and
    NEVER writes ``allocator_equity_snapshots`` (BACKBONE-03 two-writers race —
    the legacy store stays untouched; T-115.1-13).

    ``allocator_id`` is the QUEUE target written by the SECDEF enqueue RPC (the
    owner-spoof surface is the epilogue enqueue, already pinned to
    ``key_row['user_id']``). Eligibility is the ONE shared predicate
    (``eligible_key_predicate``); a key that has returns but no ``key_inputs``
    row (or a null anchor) is honestly DROPPED by the compose core, never
    fabricated. Structural compose refusals (the core's loud asserts) →
    permanent FAILED with a scrubbed message (T-74-02 class); DB/network faults
    bubble transient.
    """
    import pandas as pd

    from services.allocator_equity_compose import compose_allocator_equity
    from services.allocator_equity_derive import eligible_key_predicate
    from services.external_flows import ExternalFlow, validate_flow_shape
    from services.nav_twr import NavReconstructionError
    from services.redact import scrub_freeform_string

    allocator_id = job["allocator_id"]
    supabase = get_supabase()

    async def _delete_equity_curve_row() -> None:
        # Degrade to the clean no-row legacy fallback (the SAFETY pin's no-row
        # case). Shared by the empty-compose (B2), incomplete-compose (F1b), and
        # permanent-failure (F2) paths so a structurally-failed / partial / empty
        # recompute can never leave a STALE trustworthy row rendering as "derived".
        def _del() -> None:
            supabase.table("allocator_equity_derived").delete().eq(
                "allocator_id", allocator_id
            ).eq("kind", "equity_curve").execute()

        await db_execute(_del)

    # ── 1. Eligible key set — the ONE predicate, never inlined. ──────────────
    def _load_keys() -> list[dict[str, Any]]:
        return cast(
            list[dict[str, Any]],
            supabase.table("api_keys")
            .select("id,is_active,sync_status,disconnected_at")
            .eq("user_id", allocator_id)
            .execute()
            .data
            or [],
        )

    key_rows = await db_execute(_load_keys)
    eligible_ids = {r["id"] for r in key_rows if eligible_key_predicate(r)}

    # ── 2. Per-key returns — ISO-STRING day index built DIRECTLY from the
    #      'date' column (carry-in #3). NEVER pd.to_datetime / DatetimeIndex:
    #      the core hard-asserts a 'YYYY-MM-DD' index and a DatetimeIndex would
    #      stringify to 'YYYY-MM-DD 00:00:00' and silently misalign flows. ──
    def _load_returns() -> list[dict[str, Any]]:
        return cast(
            list[dict[str, Any]],
            supabase.table("csv_daily_returns")
            .select("api_key_id,date,daily_return")
            .eq("allocator_id", allocator_id)
            .execute()
            .data
            or [],
        )

    async def _permanent_corrupt_input(exc: Exception) -> DispatchResult:
        # M3: a corrupt PERSISTED value (a NULL daily_return → float(None)
        # TypeError, a non-numeric usd_signed, a non-finite flow rejected by
        # validate_flow_shape) is NON-retryable — retrying re-reads the same poison
        # DB row FOREVER as transient `unknown` (the T-74-02 class). Dispose it as a
        # permanent scrubbed FAILED so the admin sees a terminal state, not an
        # infinite poison-retry. Scrubbed for defence in depth (no raw value leak).
        # F2: DELETE the stale equity_curve row first so a structurally-failed
        # recompute degrades to legacy instead of leaving a stale trustworthy row.
        await _delete_equity_curve_row()
        import re

        # F4b: the corrupt-input ValueError/TypeError echoes the raw value
        # (`could not convert string to float: '987654.32abc'`, `got 1e26`), and
        # scrub_freeform_string (the shared key=value/JWT scrubber) does NOT redact
        # bare numerics. Locally redact any numeric magnitude here (the T-115-05
        # no-raw-USD rule) — scoped to this corrupt-input path so the shared scrub /
        # the structural NavReconstructionError day-indices are untouched.
        scrubbed = str(scrub_freeform_string(str(exc)))
        scrubbed = re.sub(r"\d[\d.,]*(?:[eE][-+]?\d+)?", "<redacted-num>", scrubbed)
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message=(
                "derive_allocator_equity: corrupt persisted input — " + scrubbed
            ),
            error_kind="permanent",
        )

    csv_rows = await db_execute(_load_returns)
    _grouped: dict[str, list[dict[str, Any]]] = {}
    for r in csv_rows:
        k = r.get("api_key_id")
        if k is not None and k in eligible_ids:
            _grouped.setdefault(k, []).append(r)
    returns_by_key: dict[str, pd.Series] = {}
    try:
        for k, rws in _grouped.items():
            rws_sorted = sorted(rws, key=lambda x: str(x["date"]))
            returns_by_key[k] = pd.Series(
                [float(x["daily_return"]) for x in rws_sorted],
                index=[str(x["date"]) for x in rws_sorted],
                dtype="float64",
            )
    except (ValueError, TypeError, KeyError) as exc:
        return await _permanent_corrupt_input(exc)

    # ── 3. key_inputs rows → flows_by_key + anchors_by_key; orphan cleanup. ──
    def _load_key_inputs() -> list[dict[str, Any]]:
        return cast(
            list[dict[str, Any]],
            supabase.table("allocator_equity_derived")
            .select("kind,payload")
            .eq("allocator_id", allocator_id)
            .like("kind", "key_inputs:%")
            .execute()
            .data
            or []
        )

    ki_rows = await db_execute(_load_key_inputs)
    flows_by_key: dict[str, list[ExternalFlow]] = {}
    anchors_by_key: dict[str, float | None] = {}
    # F1a×F3/M2 seam: WHY the epilogue nulled an anchor ('dust' vs a real-capital
    # read failure). Threaded into compose so a null-anchor key ALSO absent from the
    # returns axis is gated dust-omit vs real-failure-degrade (never silently
    # omitted → a trustworthy partial curve).
    null_anchor_reasons: dict[str, str] = {}
    key_inputs_ids: set[str] = set()
    orphan_kinds: list[str] = []
    # M3: the JSONB→python coercions below (float(usd_signed), float(anchor_usd))
    # sit OUTSIDE the compose NavReconstructionError catch — a corrupt persisted
    # value would otherwise escape as a transient `unknown` and retry forever. M1:
    # each reconstructed ExternalFlow is shape-validated (validate_flow_shape) so a
    # non-finite usd_signed in JSONB is REJECTED here, never sailing into the core
    # as a silent NaN. Both dispose as a permanent scrubbed FAILED.
    try:
        for row in ki_rows:
            kind = str(row.get("kind", ""))
            api_key_id = kind.split(":", 1)[1] if ":" in kind else ""
            if api_key_id not in eligible_ids:
                # A key that is no longer eligible (revoked / disconnected /
                # deleted) keeps a stale key_inputs row — bounded orphan cleanup
                # below.
                orphan_kinds.append(kind)
                continue
            key_inputs_ids.add(api_key_id)
            payload = row.get("payload") or {}
            flows_by_key[api_key_id] = [
                validate_flow_shape(
                    ExternalFlow(
                        utc_day_iso=str(_f["utc_day_iso"]),
                        usd_signed=float(_f["usd_signed"]),
                    )
                )
                for _f in (payload.get("flows") or [])
            ]
            _anchor = payload.get("anchor_usd")
            anchors_by_key[api_key_id] = None if _anchor is None else float(_anchor)
            if _anchor is None:
                # Capture the reason token (absent on legacy pre-fix rows → None →
                # compose treats it as the SAFE non-dust/degrade default).
                _reason = payload.get("anchor_null_reason")
                if isinstance(_reason, str) and _reason:
                    null_anchor_reasons[api_key_id] = _reason
    except (ValueError, TypeError, KeyError) as exc:
        return await _permanent_corrupt_input(exc)

    # A key with returns but no key_inputs row → anchor None (compose honestly
    # DROPS it, exactly as an unanchored key). Never fabricate an anchor.
    for k in returns_by_key:
        anchors_by_key.setdefault(k, None)
        flows_by_key.setdefault(k, [])

    for _orphan_kind in orphan_kinds:
        def _delete_orphan(_k: str = _orphan_kind) -> None:
            supabase.table("allocator_equity_derived").delete().eq(
                "allocator_id", allocator_id
            ).eq("kind", _k).execute()

        await db_execute(_delete_orphan)

    # ── 3b. F1(b) ELIGIBLE-SET RECONCILIATION (the backfill-window closer). ──
    # The compose can only see keys that have EITHER a returns series OR a
    # key_inputs row. During the founder-gated backfill the FIRST key's compose
    # runs while sibling keys still have zero rows (all 517 prod keys start empty),
    # so composing now would emit a TRUSTWORTHY curve over a SUBSET of the
    # allocator's capital (a transient 1-of-N-capital curve labeled "Derived",
    # suppressing a legacy curve that included every key). If ANY eligible key is
    # absent from BOTH maps the compose is INCOMPLETE → refuse: delete the
    # equity_curve row (degrade to legacy) rather than compose a silently-partial
    # trustworthy curve. A key WITH a key_inputs row but no returns is NOT missing
    # here — it is visible to the compose core, which classifies it
    # anchored-without-returns → DROPPED_KEY → untrustworthy (B3). This gate is for
    # the strictly-invisible key (no returns AND no key_inputs — its derive has not
    # run yet). Self-healing: each sibling derive re-enqueues the compose.
    missing_ids = eligible_ids - (set(returns_by_key) | key_inputs_ids)
    if missing_ids:
        await _delete_equity_curve_row()
        logger.info(
            "derive_allocator_equity: INCOMPLETE compose for allocator %s "
            "(eligible_keys=%d returns_keys=%d key_inputs_keys=%d missing=%d) — "
            "an eligible key has neither returns nor key_inputs (backfill window); "
            "deleted any stale equity_curve row, degrading to legacy until every "
            "sibling derives (Option B, self-healing)",
            allocator_id, len(eligible_ids), len(returns_by_key),
            len(key_inputs_ids), len(missing_ids),
        )
        return DispatchResult(outcome=DispatchOutcome.DONE)

    # ── 4. The ONLY derivation call — the frozen-core composition layer. ──────
    try:
        payload = compose_allocator_equity(
            returns_by_key, flows_by_key, anchors_by_key, null_anchor_reasons
        )
    except NavReconstructionError as exc:
        # A STRUCTURAL compose refusal (the core's loud asserts — carry-in #3
        # DatetimeIndex slip, the segment-wise EXCLUSIVE_FILL canary, an
        # unpriceable flow, a ≤−100% liquidation day). Retrying cannot help →
        # permanent FAILED with a scrubbed message (the T-74-02 DoS class; the core
        # errors carry counts/day-indices only, still scrubbed for defence in
        # depth). F2: DELETE the stale equity_curve row first — otherwise a
        # post-liquidation poison input would leave the frozen pre-liquidation curve
        # rendering as trustworthy FOREVER; degrade to legacy instead.
        await _delete_equity_curve_row()
        scrubbed = str(scrub_freeform_string(str(exc)))
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message=(
                "derive_allocator_equity: compose refused a structural input — "
                + scrubbed
            ),
            error_kind="permanent",
        )

    # ── 5. B2 root cause: an EMPTY curve is NOT a renderable series. A
    #      zero-anchored-keys / zero-weight-mass compose (every prod allocator
    #      today) returns curve=[] — is_trustworthy may be True (benign honest-empty
    #      tokens: NO_ANCHORED_KEYS/ZERO_WEIGHT_MASS) OR False (all keys DROPPED_KEY
    #      post-B3); this branch keys on EMPTINESS, not on the trust flag, so both
    #      empty shapes degrade the same. Upserting it would blank the dashboard
    #      while suppressing the legacy render (which has real data), and a later
    #      structurally-empty recompute would leave a STALE trustworthy row (L1).
    #      Instead DELETE any existing equity_curve row → degrade to the clean
    #      no-row legacy fallback (the SAFETY pin's no-row case). The frontend
    #      extractTrustworthyDerivedCurve is the paired last-line defense (B2a). ──
    if not (payload.get("curve") or []):
        await _delete_equity_curve_row()
        logger.info(
            "derive_allocator_equity: empty compose for allocator %s "
            "(eligible_keys=%d returns_keys=%d orphans_cleaned=%d) — deleted any "
            "stale equity_curve row, degrading to the legacy fallback (Option B)",
            allocator_id, len(eligible_ids), len(returns_by_key), len(orphan_kinds),
        )
        return DispatchResult(outcome=DispatchOutcome.DONE)

    # ── 5b. Single-row ATOMIC upsert of the NON-EMPTY display row (never the
    #      legacy store — the fake-PostgREST raise pin enforces this forever). ──
    def _upsert_curve() -> None:
        supabase.table("allocator_equity_derived").upsert(
            {
                "allocator_id": allocator_id,
                "kind": "equity_curve",
                "payload": payload,
                "computed_at": datetime.now(timezone.utc).isoformat(),
            },
            on_conflict="allocator_id,kind",
        ).execute()

    await db_execute(_upsert_curve)

    # Log carries NO USD magnitudes (T-115-05): allocator + counts + trust bool.
    logger.info(
        "derive_allocator_equity: composed equity_curve for allocator %s "
        "(eligible_keys=%d returns_keys=%d curve_len=%d orphans_cleaned=%d "
        "trustworthy=%s) — crawl-free compose (Option B)",
        allocator_id, len(eligible_ids), len(returns_by_key),
        len(payload.get("curve", [])), len(orphan_kinds),
        payload.get("is_trustworthy"),
    )
    return DispatchResult(outcome=DispatchOutcome.DONE)


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------


async def dispatch(job: dict[str, Any]) -> DispatchResult:
    """Route a claimed job to its per-kind handler, wrap in timeout, classify.

    After the handler resolves (or raises) and before returning, a strategy-
    scoped job whose outcome is DEFERRED calls the UI status bridge (the only
    outcome with no post-mark bridge). Terminal outcomes (DONE/FAILED) are
    bridged authoritatively by mark_compute_job_done / mark_compute_job_failed
    AFTER main_worker flips the job row — see the DEFERRED-only rationale at the
    bridge call site below. Portfolio-scoped jobs never bridge (no
    strategy_analytics row).

    Handler lookup is done via if/elif rather than a dict so that
    monkeypatching the module-level run_*_job functions in tests works
    correctly (a dict captures references at import time, defeating mocks).
    """
    kind = job.get("kind")
    # kind is Any | None (job.get); TIMEOUT_PER_KIND is str-keyed. A non-str /
    # None kind has no entry, so it falls to the 5-minute default — identical to
    # the prior dict.get(kind, 5 * 60) for any non-matching key.
    timeout = TIMEOUT_PER_KIND.get(kind, 5 * 60) if isinstance(kind, str) else 5 * 60

    if kind == "sync_trades":
        handler = run_sync_trades_job
    elif kind == "compute_analytics_from_csv":
        # Phase 19.1 — CSV-sourced analytics. Routes through the
        # csv_daily_returns table instead of the trades/fills chain.
        handler = run_compute_analytics_from_csv_job
    elif kind == "compute_portfolio":
        handler = run_compute_portfolio_job
    elif kind == "poll_positions":
        handler = run_poll_positions_job
    elif kind == "sync_funding":
        handler = run_sync_funding_job
    elif kind == "derive_broker_dailies":
        # Broker key full-history → dailies → standard CSV route.
        handler = run_derive_broker_dailies_job
    elif kind == "stitch_composite":
        # Phase 86 / COMP-02 — multi-key composite: fan out over strategy_keys
        # members → clip → fail-loud overlap → arithmetic stitch → both-basis persist.
        handler = run_stitch_composite_job
    elif kind == "reconcile_strategy":
        handler = run_reconcile_strategy_job
    elif kind == "compute_intro_snapshot":
        handler = run_compute_intro_snapshot_job
    elif kind == "rescore_allocator":
        handler = run_rescore_allocator_job
    elif kind == "derive_allocator_equity":
        # Phase 115.1 / RD-3 Option B — crawl-free, decryption-free allocator
        # $-equity compose: DB reads (per-key dailies + persisted key_inputs) →
        # compose_allocator_equity → single-row equity_curve upsert.
        handler = run_derive_allocator_equity_job
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
    #
    # NEW-C12-04: also mark failed when the job exhausted its retry budget
    # (attempts >= max_attempts). Transient/unknown errors that reach the
    # last attempt transition to failed_final DB-side without returning
    # error_kind="permanent", so the original permanent-only guard never
    # fired → snapshot_status stayed 'pending' forever on the admin UI.
    if kind == "compute_intro_snapshot" and result.outcome == DispatchOutcome.FAILED:
        attempts = job.get("attempts", 0)
        max_attempts = job.get("max_attempts", 3)
        is_final = (
            result.error_kind == "permanent"
            or attempts >= max_attempts
        )
        if is_final:
            await _mark_intro_snapshot_failed(job)

    # UI status bridge (DEFERRED-only). For TERMINAL outcomes the authoritative
    # status bridge is the in-RPC `PERFORM sync_strategy_analytics_status`
    # inside mark_compute_job_done / mark_compute_job_failed, which fires AFTER
    # the compute_jobs row is flipped to its terminal state (main_worker calls
    # the mark RPC once dispatch returns).
    #
    # Calling the bridge HERE for a terminal outcome — pre-mark, while this
    # job's row is still 'running' — made the RPC take branch (a) ("any
    # non-terminal job" → 'computing') and OVERWRITE the runner's just-written
    # 'complete_with_warnings' terminal status. The later branch-(c) bridge from
    # mark_compute_job_done then read 'computing' and resolved to a plain
    # 'complete', laundering the warning on every queued path, every venue (the
    # whole complete_with_warnings channel was dead). See migration
    # 20260707120000_sync_status_preserve_warnings.sql.
    #
    # DEFERRED is the ONLY outcome with no post-mark bridge (main_worker runs no
    # mark RPC on defer), so it alone still needs a dispatch-side status refresh.
    strategy_id = job.get("strategy_id")
    if strategy_id and result.outcome == DispatchOutcome.DEFERRED:
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
