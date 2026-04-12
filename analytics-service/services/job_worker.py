"""Shared dispatcher for the durable compute_jobs queue worker.

Called by main_worker.py's dispatch loop. One public entrypoint —
`dispatch(job)` — which routes by job['kind'] to a per-kind handler,
wraps each handler in an asyncio.wait_for timeout, classifies any
exception into (error_kind, sanitized message), and always (on strategy-
scoped jobs) updates the UI status bridge before returning.

Supported kinds (Sprint 3 commit 2):
  sync_trades       -> run_sync_trades_job      (5-minute timeout)
  compute_analytics -> run_compute_analytics_job (15-minute timeout)
  compute_portfolio -> run_compute_portfolio_job (10-minute timeout)
  poll_positions    -> stub (permanent failure until commit 3 wires it up)

Error classification table — drives mark_compute_job_failed's retry-vs-final
decision. See commit 2 plan for rationale:
  ccxt.NetworkError | RequestTimeout | RateLimitExceeded -> transient
  ccxt.AuthenticationError | PermissionDenied | BadRequest -> permanent
  cryptography.fernet.InvalidToken -> permanent (sanitized message)
  asyncio.TimeoutError -> transient (wait_for expiry)
  everything else -> unknown (retried by default)

TODO (commit 4): add circuit-breaker defer path based on api_keys.last_429_at
before calling create_exchange in run_sync_trades_job. When last_429_at is
within the per-exchange cooldown window, call defer_compute_job RPC and
return DispatchResult(outcome=DEFERRED) instead of proceeding.

TODO (commit 4): currently run_sync_trades_job decrypts credentials inline
via decrypt_credentials. Commit 4 will factor the credential loading +
circuit-breaker + exchange-construction sequence into a shared helper so the
same pre-flight runs for every exchange-touching handler.
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum

import ccxt
from cryptography.fernet import InvalidToken

from services.analytics_status import sync_strategy_analytics_status
from services.db import db_execute, get_supabase
from services.encryption import decrypt_credentials, get_kek
from services.exchange import (
    create_exchange,
    fetch_all_trades,
    fetch_usdt_balance,
    parse_since_ms,
)

logger = logging.getLogger("quantalyze.analytics.job_worker")


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
                mark_* — the DB row was already transitioned. (Commit 4
                path; commit 2 never returns this.)
    """

    DONE = "done"
    FAILED = "failed"
    DEFERRED = "deferred"


@dataclass
class DispatchResult:
    outcome: DispatchOutcome
    error_message: str | None = None
    error_kind: str | None = None  # 'transient' | 'permanent' | 'unknown'
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
    "sync_trades": 5 * 60,       # 5 minutes
    "compute_analytics": 15 * 60,  # 15 minutes
    "compute_portfolio": 10 * 60,  # 10 minutes
    "poll_positions": 3 * 60,    # 3 minutes (stub; real handler lands commit 3)
}


# ---------------------------------------------------------------------------
# Error classification
# ---------------------------------------------------------------------------

def classify_exception(exc: Exception) -> tuple[str, str]:
    """Map an exception to (error_kind, sanitized_message).

    Ordered most-specific → least-specific. Truncated to 500 chars so
    admin-UI rows stay bounded. See module docstring for the full table.
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
# Per-kind handlers
# ---------------------------------------------------------------------------

async def run_sync_trades_job(job: dict) -> DispatchResult:
    """Decrypt the strategy's API key, fetch daily PnL from the exchange,
    and persist via the sync_trades RPC.

    Mirrors the logic in routers/exchange.py::fetch_trades. Refactoring the
    shared sequence into a single helper is commit 4's scope — commit 2
    keeps the two callers in parity but separate.

    Commit 4 will add the api_keys.last_429_at circuit-breaker check before
    create_exchange. If the exchange is in cooldown, the handler will call
    defer_compute_job and return DispatchResult(outcome=DEFERRED). Until
    then, the handler always proceeds straight to the exchange call.
    """
    strategy_id = job.get("strategy_id")
    if not strategy_id:
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message="run_sync_trades_job: strategy_id missing",
            error_kind="permanent",
        )

    kek = get_kek()
    supabase = get_supabase()

    # Look up the strategy to get api_key_id
    def _load_strategy() -> dict | None:
        res = (
            supabase.table("strategies")
            .select("id, user_id, api_key_id")
            .eq("id", strategy_id)
            .single()
            .execute()
        )
        return res.data

    strategy_row = await db_execute(_load_strategy)
    if not strategy_row or not strategy_row.get("api_key_id"):
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message="Strategy has no connected API key",
            error_kind="permanent",
        )

    def _load_key() -> dict | None:
        res = (
            supabase.table("api_keys")
            .select("*")
            .eq("id", strategy_row["api_key_id"])
            .single()
            .execute()
        )
        return res.data

    key_row = await db_execute(_load_key)
    if not key_row:
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message="API key not found",
            error_kind="permanent",
        )

    if key_row.get("user_id") != strategy_row.get("user_id"):
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message="API key does not belong to strategy owner",
            error_kind="permanent",
        )

    # TODO (commit 4): circuit-breaker defer check goes here. If
    # api_keys.last_429_at is within the per-exchange cooldown window
    # (Binance 120s, OKX 300s, Bybit 600s), call defer_compute_job(job['id'],
    # remaining_seconds, 'circuit_breaker_cooldown') and return
    # DispatchResult(outcome=DispatchOutcome.DEFERRED).

    # Decrypt credentials. InvalidToken → classify as permanent with a
    # sanitized message.
    api_key, api_secret, passphrase = decrypt_credentials(key_row, kek)

    exchange = create_exchange(
        key_row["exchange"], api_key, api_secret, passphrase
    )
    since_ms = parse_since_ms(key_row.get("last_sync_at"))

    try:
        trades = await fetch_all_trades(exchange, since_ms=since_ms)
        account_balance = await fetch_usdt_balance(exchange)
    finally:
        try:
            await exchange.close()
        except Exception:  # pragma: no cover - defensive cleanup
            pass

    # Persist trades atomically via sync_trades RPC
    if trades:
        import json as _json

        trades_json = _json.dumps(trades, default=str)

        def _sync() -> int:
            res = supabase.rpc(
                "sync_trades",
                {"p_strategy_id": strategy_id, "p_trades": trades_json},
            ).execute()
            return int(res.data or 0)

        inserted = await db_execute(_sync)
        logger.info(
            "sync_trades: persisted %s rows for strategy %s", inserted, strategy_id
        )

    # Advance sync cursor always (even for empty fetches).
    def _update_cursor() -> None:
        update_data: dict = {
            "last_sync_at": datetime.now(timezone.utc).isoformat()
        }
        if account_balance is not None:
            update_data["account_balance_usdt"] = account_balance
        supabase.table("api_keys").update(update_data).eq(
            "id", key_row["id"]
        ).execute()

    await db_execute(_update_cursor)

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


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

async def dispatch(job: dict) -> DispatchResult:
    """Route a claimed job to its per-kind handler, wrap in timeout, classify.

    After the handler resolves (or raises) and before returning, strategy-
    scoped jobs call the UI status bridge so strategy_analytics.computation_status
    reflects the new compute_jobs aggregate. Portfolio-scoped jobs skip
    the bridge (there is no strategy_analytics row to update).
    """
    kind = job.get("kind")
    timeout = TIMEOUT_PER_KIND.get(kind, 5 * 60)

    try:
        if kind == "sync_trades":
            result = await asyncio.wait_for(run_sync_trades_job(job), timeout=timeout)
        elif kind == "compute_analytics":
            result = await asyncio.wait_for(
                run_compute_analytics_job(job), timeout=timeout
            )
        elif kind == "compute_portfolio":
            result = await asyncio.wait_for(
                run_compute_portfolio_job(job), timeout=timeout
            )
        elif kind == "poll_positions":
            # TODO (commit 3): wire run_poll_positions_job(job) here.
            # The handler + services/positions.py land in commit 3 along
            # with the poll_positions error classification path.
            result = DispatchResult(
                outcome=DispatchOutcome.FAILED,
                error_message="poll_positions handler not yet implemented",
                error_kind="permanent",
            )
        else:
            # Unknown kind — permanent failure so the DB row goes straight
            # to failed_final. Prevents a future new-kind insert from
            # retry-looping against an older worker that doesn't know about it.
            result = DispatchResult(
                outcome=DispatchOutcome.FAILED,
                error_message=f"Unknown job kind: {kind!r}",
                error_kind="permanent",
            )
    except Exception as exc:  # noqa: BLE001
        error_kind, sanitized = classify_exception(exc)
        result = DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message=sanitized,
            error_kind=error_kind,
        )

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
