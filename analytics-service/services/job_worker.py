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

Error classification table — drives mark_compute_job_failed's retry-vs-final
decision:
  ccxt.NetworkError | RequestTimeout | RateLimitExceeded -> transient
  ccxt.AuthenticationError | PermissionDenied | BadRequest -> permanent
  cryptography.fernet.InvalidToken -> permanent (sanitized message)
  asyncio.TimeoutError -> transient (wait_for expiry)
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
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
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
from services.positions import fetch_positions, persist_position_snapshots

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
# supabase/migrations/047c_severity_critical.sql.
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
    "sync_trades": 15 * 60,      # 15 minutes (supports 90-day raw fill backfill)
    "compute_analytics": 15 * 60,  # 15 minutes
    "compute_portfolio": 10 * 60,  # 10 minutes
    "poll_positions": 3 * 60,    # 3 minutes (stub; real handler lands commit 3)
    "sync_funding": 3 * 60,      # 3 minutes (funding volume << trade volume)
    "reconcile_strategy": 5 * 60,  # 5 minutes (fetch_my_trades + DB scan + diff)
    "compute_intro_snapshot": 2 * 60,  # 2 minutes (pure DB; no exchange I/O)
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
    try:
        trades = await fetch_all_trades(ctx.exchange, since_ms=since_ms)
        account_balance = await fetch_usdt_balance(ctx.exchange)

        # --- Phase 2: Raw fill ingestion (gated by feature flag) ---
        import os
        if os.environ.get("USE_RAW_TRADE_INGESTION", "false").lower() == "true":
            try:
                from services.exchange import fetch_raw_trades

                raw_fills = await fetch_raw_trades(
                    ctx.exchange, strategy_id, ctx.supabase, since_ms=since_ms
                )
            except Exception as e:
                # Phase 2 failure should NOT fail Phase 1
                logger.warning(
                    "Raw fill ingestion failed for strategy %s (Phase 1 succeeded): %s",
                    strategy_id,
                    str(e),
                )
    except ccxt.RateLimitExceeded:
        await _stamp_429(ctx.supabase, ctx.key_row)
        raise
    finally:
        try:
            await ctx.exchange.close()
        except Exception:  # pragma: no cover - defensive cleanup
            pass

    # Persist trades atomically via sync_trades RPC
    if trades:
        trades_json = json.dumps(trades, default=str)

        def _sync() -> int:
            res = ctx.supabase.rpc(
                "sync_trades",
                {"p_strategy_id": strategy_id, "p_trades": trades_json},
            ).execute()
            return int(res.data or 0)

        inserted = await db_execute(_sync)
        logger.info(
            "sync_trades: persisted %s rows for strategy %s", inserted, strategy_id
        )

    # Persist raw fills (Phase 2, after exchange is closed)
    if raw_fills:
        # Direct insert with ON CONFLICT DO NOTHING (dedup via partial unique index)
        # Cannot use sync_trades RPC — it DELETE+INSERTs, which would destroy Phase 1 daily_pnl
        for i in range(0, len(raw_fills), 100):
            batch = raw_fills[i:i + 100]
            def _insert_fills(rows=batch):
                ctx.supabase.table("trades").upsert(
                    [{"strategy_id": strategy_id, **fill} for fill in rows],
                    on_conflict="strategy_id,exchange,exchange_fill_id",
                    ignore_duplicates=True,
                ).execute()
            await db_execute(_insert_fills)
        logger.info(
            "sync_trades Phase 2: persisted %d raw fills for strategy %s",
            len(raw_fills), strategy_id,
        )

    # Checkpoint cursor after any successful fetch (empty or not). Survives
    # downstream analytics/reconstruction failure. Best-effort — a missed
    # stamp just means re-fetching one window next run.
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
    from services.exchange import fetch_raw_trades

    try:
        exchange_fills = await fetch_raw_trades(
            ctx.exchange, strategy_id, ctx.supabase, since_ms=since_ms
        )
    except ccxt.RateLimitExceeded:
        await _stamp_429(ctx.supabase, ctx.key_row)
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
