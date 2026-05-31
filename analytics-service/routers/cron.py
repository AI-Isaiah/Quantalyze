import asyncio
import json
import logging
import time
from collections import defaultdict
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException

from services.db import get_supabase
from services.encryption import decrypt_credentials, get_kek
from services.exchange import create_exchange, fetch_all_trades, parse_since_ms, fetch_usdt_balance, validate_key_permissions

router = APIRouter(prefix="/api", tags=["cron"])
logger = logging.getLogger("quantalyze.analytics")

# audit-2026-05-07 C-0193 — per-key validation cache.
#
# Pre-fix every cron tick (currently every 15 min) called
# `validate_key_permissions` for EVERY active api_keys row, which hits the
# exchange's /account or /apiRestrictions endpoint per key. With N keys
# that's N exchange RPCs every 15 min just to confirm "yes, still valid",
# burning the per-IP rate-limit budget against work the user already paid
# for last tick.
#
# In-memory TTL keyed by api_keys.id:
#   * miss / expired entry  -> re-validate, refresh the entry on success
#   * fresh entry           -> assume valid, skip the exchange round-trip
#
# In-memory only (no migration), so a pod restart or a deploy invalidates
# the whole cache and the next tick re-validates everything from scratch
# — that's intentional: a TTL is a budget, not a guarantee.
#
# Failures (valid=False or validator raise) are NOT cached: the next tick
# must re-attempt so a transient exchange blip doesn't pin a key into
# permanent "needs revalidation" for the TTL window.
#
# PR #257 red-team: pre-fix the TTL was 24h, which gave a user who
# revoked a key at the exchange a worst-case 24h window where the cron
# kept treating it as `is_active=True`. With a 15-minute cron cadence,
# a 1h TTL still cuts ~96% of redundant validation calls while bounding
# the staleness window to one hour — closer to the actual revocation
# detection SLA the credential-purge flow needs.
KEY_VALIDATION_TTL_SECONDS = 60 * 60  # 1h
_key_validation_cache: dict[str, float] = {}


def _validation_cache_hit(key_id: str, *, now: float | None = None) -> bool:
    """Return True if `key_id` has a fresh validation entry.

    `now` is injectable so tests can advance time deterministically without
    monkey-patching `time.monotonic`.
    """
    entry = _key_validation_cache.get(key_id)
    if entry is None:
        return False
    current = time.monotonic() if now is None else now
    return (current - entry) < KEY_VALIDATION_TTL_SECONDS


def _record_validation_success(key_id: str, *, now: float | None = None) -> None:
    """Refresh the cache entry after a successful re-validation."""
    _key_validation_cache[key_id] = time.monotonic() if now is None else now


def _invalidate_validation_cache(key_id: str) -> None:
    """Drop a key from the cache (e.g. on credential rejection)."""
    _key_validation_cache.pop(key_id, None)

# Per-key timeout in seconds
KEY_SYNC_TIMEOUT = 60
# Max concurrent keys per batch
BATCH_SIZE = 5
# Delay between batches for the same exchange (seconds)
EXCHANGE_BATCH_DELAY = 2.0
# Per-portfolio recompute timeout (seconds). A wedged compute on one
# portfolio must not block the cron tick or starve live HTTP requests
# also competing for `_compute_semaphore`.
PORTFOLIO_RECOMPUTE_TIMEOUT = 90
# Cron-internal cap on how many portfolio recomputes are in flight at
# once. `_compute_semaphore` is shared with live `POST
# /api/portfolio-analytics` traffic; if cron `asyncio.gather`s N
# portfolios it monopolises every slot and live requests stall.
# Capping cron concurrency to (shared_limit - 1) leaves at least one
# slot for interactive users.
CRON_RECOMPUTE_CONCURRENCY = 2
# Cap the number of failure entries returned in `portfolio_recomputes.failures`.
# A platform-wide Supabase outage can fail N portfolios and the unbounded
# list would otherwise bloat the response body Sentry/log aggregators
# have to store and search.
RECOMPUTE_FAILURE_CAP = 50

# NEW-C32-02: cap the `results` list in the cron response body.
# `failures` is capped but `results` was unbounded — the LARGER payload
# (one full dict per active key with per-strategy stats), scaling 1:1 with
# active keys. During a platform-wide incident this produces the exact
# unbounded body the failures cap was introduced to prevent.
# Priority: non-ok statuses first (error/timeout/partial/key_revoked), then ok.
RESULTS_CAP = 50

# NEW-C32-01: page size for IN-list fetches in the portfolio recompute cascade.
# `synced_strategy_ids` and `candidate_portfolio_ids` are unbounded — they grow
# 1:1 with active keys × strategies. PostgREST serialises the IN list into the
# URL; on a large platform book this 414s (or silently truncates) and some
# portfolios skip their recompute. Reuses the 50-id chunk size already
# documented at routers/match.py (C-retention fix) and match.py:L874.
_CRON_IN_LIST_PAGE_SIZE = 50

# Wire-format status values for a per-key sync result. Annotated on
# `_sync_single_key` / `_sync_key_with_timeout` returns so misspelled
# comparisons (`"OK"`, `"errored"`) are caught at type-check time
# before they silently misclassify a result in the summary counters.
SyncStatus = Literal[
    "ok",
    "partial",
    "key_revoked",
    "transient_failure",
    "error",
    "timeout",
]

# Outcome bucket for a per-portfolio recompute attempt. `in_flight` is
# distinct from `ok` so the response payload doesn't conflate "I
# computed this" with "someone else might be computing this" — alerting
# on `pr["failed"] == 0 and pr["ok"] == pr["attempted"]` would otherwise
# silently treat unfinished work as success.
RecomputeStatus = Literal["ok", "in_flight", "skipped", "failed"]

# Only these validation error codes mean "credentials are bad, deactivate the
# key." Transient codes (rate limit, network, exchange-down, unexpected) mean
# "try again next tick" — treating them as credential failure would let a 30s
# network blip permanently disable a user's key.
CREDENTIAL_REJECTION_CODES = {
    "AUTH_FAILED",
    "PERMISSION_DENIED",
    "WITHDRAW_SCOPE",
    "TRADE_SCOPE",
}

# Lifecycle statuses that may receive cron-synced trades. Syncing into an
# archived or deleted strategy can overwrite its submission snapshot and flip
# its approval-gate verdict between Submit and Approve.
ALLOWED_STRATEGY_STATUSES = {"draft", "pending_review", "published"}


async def _sync_single_key(
    key_row: dict,
    kek: bytes,
) -> dict:
    """Sync a single API key: decrypt, fetch trades, store, update cursor.

    Returns a structured result dict for logging.
    """
    key_id = key_row["id"]
    exchange_name = key_row["exchange"]
    # One API key can back N strategies — the FK lives on
    # `strategies.api_key_id`, so a single `key_id` appears in the join N
    # times. `strategy_ids` is the authoritative list (each gets its own
    # `sync_trades` RPC); `strategy_id` is the primary, kept only for
    # result-payload back-compat.
    strategy_ids: list[str] = list(key_row.get("strategy_ids") or [])
    strategy_id = strategy_ids[0] if strategy_ids else None
    start = time.monotonic()

    try:
        # Decrypt credentials
        api_key, api_secret, passphrase = decrypt_credentials(key_row, kek)
        exchange = create_exchange(exchange_name, api_key, api_secret, passphrase)

        try:
            # audit-2026-05-07 C-0193 — skip the exchange round-trip when a
            # recent successful validation is still within TTL. Tests use
            # `_validation_cache_hit` directly; the production path treats a
            # hit as "valid, no re-check needed."
            if _validation_cache_hit(key_id):
                validation = {"valid": True, "error": None, "error_code": None}
            else:
                # Re-validate key permissions before syncing
                validation = await validate_key_permissions(exchange)
            if not validation["valid"]:
                error_code = validation.get("error_code")
                is_credential_failure = error_code in CREDENTIAL_REJECTION_CODES

                supabase = get_supabase()
                if is_credential_failure and strategy_id:
                    # audit-2026-05-07 C-0195 — before flipping is_active=False,
                    # check whether this key backs any allocator_holdings rows.
                    # An allocator's portfolio of holdings depends on the key
                    # staying active for the next sync window; silently flipping
                    # is_active=False breaks the allocator's holdings ingest
                    # without surfacing why. ON DELETE RESTRICT on the FK
                    # already prevents row deletion, but a soft-deactivate has
                    # the same operational effect.
                    allocator_used = False
                    try:
                        ah_result = (
                            supabase.table("allocator_holdings")
                            .select("id")
                            .eq("api_key_id", key_id)
                            .limit(1)
                            .execute()
                        )
                        allocator_used = bool(getattr(ah_result, "data", None))
                    except Exception:
                        # A Supabase blip on the linkage probe must NOT silently
                        # green-light deactivation. Fail closed: treat the key
                        # as allocator-used and skip the flip; the next tick
                        # will retry. logger.exception so the traceback reaches
                        # Sentry.
                        logger.exception(
                            "cron_sync: allocator_holdings linkage probe failed "
                            "for key %s — failing closed (skipping deactivation)",
                            key_id,
                        )
                        allocator_used = True

                    if allocator_used:
                        logger.warning(
                            "cron_sync: key %s failed validation (code=%s) but "
                            "backs allocator_holdings rows — NOT deactivating "
                            "(allocator-protected path)",
                            key_id,
                            error_code,
                        )
                        _invalidate_validation_cache(key_id)
                        return {
                            "key_id": key_id,
                            "strategy_id": strategy_id,
                            "strategy_ids": strategy_ids,
                            "exchange": exchange_name,
                            "trades_fetched": 0,
                            "duration_s": round(time.monotonic() - start, 2),
                            "status": "key_revoked",
                            "error_code": error_code,
                            "error": validation.get("error", "Key no longer valid"),
                            "allocator_protected": True,
                        }

                    logger.warning(
                        "cron_sync: key %s failed validation (code=%s): %s — deactivating",
                        key_id,
                        error_code,
                        validation.get("error", "unknown"),
                    )
                    update_result = supabase.table("api_keys").update(
                        {"is_active": False}
                    ).eq("id", key_id).execute()
                    # A no-op UPDATE (row was deleted or re-keyed between
                    # the cron SELECT and now) looks identical to success
                    # in the logs unless we inspect `.data` here.
                    if not getattr(update_result, "data", None):
                        logger.error(
                            "cron_sync: deactivation no-op for key %s — row "
                            "vanished mid-tick (deleted/re-keyed by another writer)",
                            key_id,
                        )
                    _invalidate_validation_cache(key_id)
                else:
                    # Transient failure — leave is_active=True, retry next tick.
                    logger.warning(
                        "cron_sync: key %s transient validation failure (code=%s): %s — NOT deactivating",
                        key_id,
                        error_code,
                        validation.get("error", "unknown"),
                    )
                    # Transient failures evict from cache so next tick
                    # re-validates instead of trusting a stale entry.
                    _invalidate_validation_cache(key_id)
                return {
                    "key_id": key_id,
                    "strategy_id": strategy_id,
                    "strategy_ids": strategy_ids,
                    "exchange": exchange_name,
                    "trades_fetched": 0,
                    "duration_s": round(time.monotonic() - start, 2),
                    "status": "key_revoked" if is_credential_failure else "transient_failure",
                    "error_code": error_code,
                    "error": validation.get("error", "Key no longer valid"),
                }

            # Cache the successful validation so subsequent ticks within the
            # TTL window can skip the exchange round-trip (C-0193).
            _record_validation_success(key_id)

            since_ms = parse_since_ms(key_row.get("last_sync_at"))
            trades = await fetch_all_trades(exchange, since_ms=since_ms)
            account_balance = await fetch_usdt_balance(exchange)
        finally:
            await exchange.close()

        # Store trades atomically via RPC — one call per linked strategy.
        # Each RPC is wrapped so one failing strategy does NOT abort the
        # rest of the fan-out or skip the `last_sync_at` UPDATE; otherwise
        # the next tick refetches the same trades and we lose the cursor.
        supabase = get_supabase()
        trades_stored = 0
        per_strategy_stored: dict[str, int] = {}
        strategy_errors: dict[str, str] = {}

        if trades and strategy_ids:
            trades_json = json.dumps(trades, default=str)
            for sid in strategy_ids:
                try:
                    result = supabase.rpc(
                        "sync_trades",
                        {"p_strategy_id": sid, "p_trades": trades_json},
                    ).execute()
                except Exception as rpc_exc:
                    logger.exception(
                        "cron_sync: sync_trades RPC failed for key %s strategy %s",
                        key_id,
                        sid,
                    )
                    per_strategy_stored[sid] = 0
                    strategy_errors[sid] = f"{type(rpc_exc).__name__}: {rpc_exc}"
                    continue
                if isinstance(result.data, int):
                    stored = result.data
                else:
                    # Contract drift: sync_trades is declared to return
                    # the integer row count. A dict / list / None here
                    # means the SQL function changed shape; fall back to
                    # `len(trades)` but log loudly so the drift surfaces.
                    logger.error(
                        "cron_sync: sync_trades returned unexpected shape "
                        "for key %s strategy %s: %r — assuming %d stored",
                        key_id,
                        sid,
                        result.data,
                        len(trades),
                    )
                    stored = len(trades)
                per_strategy_stored[sid] = stored
            # `trades_stored` reflects the primary strategy for back-compat;
            # `per_strategy_stored` carries the per-strategy breakdown.
            trades_stored = per_strategy_stored.get(strategy_id, 0)

        # audit-2026-05-07 C-0198 — only advance `last_sync_at` when something
        # was actually stored, OR when there were no trades to store at all
        # (idle tick). The pre-fix branch advanced the cursor on EVERY return,
        # so a tick where the worker fetched trades but every per-strategy RPC
        # failed (concurrent advisory-lock contention, deadlock, etc.) would
        # silently lose those trades on the next tick because `last_sync_at`
        # already pointed past them. With this gate, a 100%-RPC-failure tick
        # leaves the cursor alone so the next tick retries the same window.
        #
        # Balance updates are independent of the cursor gate — fetching the
        # USDT balance succeeded if we got here, and stashing it doesn't
        # affect trade replay semantics.
        synced_count = sum(per_strategy_stored.values())
        any_trades_to_store = bool(trades) and bool(strategy_ids)
        should_advance_cursor = (not any_trades_to_store) or synced_count > 0

        update_data: dict = {}
        if should_advance_cursor:
            update_data["last_sync_at"] = datetime.now(timezone.utc).isoformat()
        if account_balance is not None:
            update_data["account_balance_usdt"] = account_balance
        if update_data:
            supabase.table("api_keys").update(update_data).eq("id", key_id).execute()
        if not should_advance_cursor:
            logger.warning(
                "cron_sync: key %s held last_sync_at unchanged — %d trade(s) "
                "fetched but 0 stored (all per-strategy RPCs failed); next "
                "tick will retry the same window",
                key_id,
                len(trades),
            )

        # audit-2026-05-07 C-0197 — mark strategy_analytics rows stale for
        # strategies that actually received new trades. The downstream
        # analytics cron will pick up `computation_status='stale'` rows and
        # recompute; pre-fix the cron synced trades but never told the
        # analytics layer that its inputs had changed, so KPI rows stayed
        # stale until a user-triggered recompute (or the daily portfolio
        # recompute cascade) happened to touch them.
        stale_strategy_ids = [
            sid for sid, stored in per_strategy_stored.items() if stored > 0
        ]
        if stale_strategy_ids:
            try:
                # B19 deferred: this is an UPDATE ... WHERE IN (...), not a
                # SELECT-IN. services.db.chunked_in_query returns SELECT-row
                # coverage, which is meaningless for an UPDATE — out of scope
                # (same exclusion as the retention DELETE-IN at match.py:1442).
                supabase.table("strategy_analytics").update(
                    {"computation_status": "stale"}
                ).in_("strategy_id", stale_strategy_ids).execute()
            except Exception:
                # Non-fatal: the next analytics cron tick will still pick
                # the rows up if they were already stale; if they weren't,
                # the user-facing KPIs are stale by one cron cycle until a
                # downstream recompute touches them. logger.exception so
                # the traceback reaches Sentry.
                logger.exception(
                    "cron_sync: failed to mark strategy_analytics stale for %d "
                    "strategy id(s) on key %s — analytics may lag one cycle",
                    len(stale_strategy_ids),
                    key_id,
                )

        duration = time.monotonic() - start
        # `partial` means *some* strategies landed AND *some* failed.
        # If every per-strategy RPC raised, that's `error`, not
        # `partial` — calling it partial would mislead the operator
        # into thinking trades were stored when none were. The
        # "no strategies attempted" case (empty list or no trades) is
        # `ok` because there was nothing to do.
        any_stored = any(n > 0 for n in per_strategy_stored.values())
        if strategy_errors and any_stored:
            status: SyncStatus = "partial"
        elif strategy_errors:
            status = "error"
        else:
            status = "ok"
        result: dict = {
            "key_id": key_id,
            "strategy_id": strategy_id,
            "strategy_ids": strategy_ids,
            "exchange": exchange_name,
            "trades_fetched": len(trades),
            "trades_stored": trades_stored,
            "per_strategy_stored": per_strategy_stored,
            "balance_usdt": account_balance,
            "duration_s": round(duration, 2),
            "status": status,
        }
        if strategy_errors:
            result["strategy_errors"] = strategy_errors
            # When every strategy failed, surface a top-level error too
            # for consumers that switch on `r.get("error")`.
            if status == "error":
                first_sid = next(iter(strategy_errors))
                result["error"] = strategy_errors[first_sid]
        return result

    except Exception as e:
        duration = time.monotonic() - start
        logger.exception(
            "cron_sync: key %s failed after %.1fs",
            key_id,
            duration,
        )
        return {
            "key_id": key_id,
            "strategy_id": strategy_id,
            "strategy_ids": strategy_ids,
            "exchange": exchange_name,
            "trades_fetched": 0,
            "duration_s": round(duration, 2),
            "status": "error",
            "error": str(e),
        }


async def _sync_key_with_timeout(key_row: dict, kek: bytes) -> dict:
    """Wrap _sync_single_key with a per-key timeout."""
    try:
        return await asyncio.wait_for(
            _sync_single_key(key_row, kek),
            timeout=KEY_SYNC_TIMEOUT,
        )
    except asyncio.TimeoutError:
        # `wait_for` cancels the inner coroutine, which best-effort runs
        # the inner `finally: await exchange.close()`. A cancelled
        # finally can itself be interrupted, so the aiohttp session may
        # leak. Log so the symptom ("Unclosed connector" warnings) maps
        # back to a specific key and isn't a mystery.
        strategy_ids = list(key_row.get("strategy_ids") or [])
        logger.warning(
            "cron_sync: key %s timed out after %ds — exchange connection "
            "may have leaked (cancelled `finally` is best-effort)",
            key_row["id"],
            KEY_SYNC_TIMEOUT,
        )
        return {
            "key_id": key_row["id"],
            "strategy_id": strategy_ids[0] if strategy_ids else None,
            "strategy_ids": strategy_ids,
            "exchange": key_row.get("exchange"),
            "trades_fetched": 0,
            "duration_s": KEY_SYNC_TIMEOUT,
            "status": "timeout",
            "error": f"Timed out after {KEY_SYNC_TIMEOUT}s",
        }


@router.post("/cron-sync")
async def cron_sync():
    """Daily cron endpoint: sync trades for ALL active API keys.

    - Groups keys by exchange for rate-limit awareness
    - Processes each exchange group in batches of BATCH_SIZE with asyncio.gather
    - Per-key timeout of KEY_SYNC_TIMEOUT seconds
    - Individual key failures do not stop the batch
    """
    overall_start = time.monotonic()

    try:
        kek = get_kek()
    except RuntimeError:
        # Raise 500 — the cron runner only alarms on non-2xx; a 200 body
        # with `error:` is silently treated as success and KEK outages
        # go undetected.
        logger.critical("cron_sync: KEK not configured, aborting")
        raise HTTPException(status_code=500, detail="Encryption not configured (KEK missing)")

    supabase = get_supabase()

    # Pull `status` alongside `id` so we can filter live strategies
    # in-process. PostgREST's embedded-resource filter has behaved
    # inconsistently across the supabase-py versions we ship; local
    # filtering is robust to that churn.
    try:
        keys_result = (
            supabase.table("api_keys")
            .select("*, strategies!strategies_api_key_id_fkey(id, status)")
            .eq("is_active", True)
            .execute()
        )
    except Exception as exc:
        logger.exception("cron_sync: initial api_keys SELECT failed (%s)", type(exc).__name__)
        raise HTTPException(
            status_code=500,
            detail=f"cron_sync: api_keys SELECT failed: {type(exc).__name__}",
        ) from exc
    raw_keys = keys_result.data or []

    # Flatten the embed: `strategy_ids` is the full linked set (each
    # downstream `sync_trades` RPC fans out across all of them);
    # `strategy_id` is the primary, kept only for result-payload
    # back-compat. A strategy missing `status` entirely is dropped —
    # the SELECT above always pulls `status`, so a missing key signals
    # PostgREST or schema drift and we fail closed (don't sync into
    # something whose lifecycle we can't verify).
    keys = []
    for row in raw_keys:
        strategy_rel = row.pop("strategies", None)
        if isinstance(strategy_rel, list):
            entries = strategy_rel
        elif isinstance(strategy_rel, dict):
            entries = [strategy_rel]
        else:
            entries = []

        strategy_ids = [
            e["id"]
            for e in entries
            if isinstance(e, dict)
            and e.get("id")
            and e.get("status") in ALLOWED_STRATEGY_STATUSES
        ]

        row["strategy_ids"] = strategy_ids
        row["strategy_id"] = strategy_ids[0] if strategy_ids else None
        keys.append(row)

    if not keys:
        logger.info("cron_sync: no active API keys found")
        return {"synced": 0, "failed": 0, "total_keys": 0, "duration_s": 0}

    logger.info("cron_sync: found %d active API keys", len(keys))

    # Group by exchange for rate-limit awareness
    exchange_groups: dict[str, list[dict]] = defaultdict(list)
    for key in keys:
        exchange_groups[key.get("exchange", "unknown")].append(key)

    all_results: list[dict] = []

    for exchange_name, group_keys in exchange_groups.items():
        logger.info(
            "cron_sync: processing %d keys for exchange %s",
            len(group_keys),
            exchange_name,
        )

        # Process in batches of BATCH_SIZE
        for i in range(0, len(group_keys), BATCH_SIZE):
            batch = group_keys[i : i + BATCH_SIZE]
            batch_results = await asyncio.gather(
                *[_sync_key_with_timeout(k, kek) for k in batch]
            )
            all_results.extend(batch_results)

            # Delay between batches for the same exchange (skip after last batch)
            if i + BATCH_SIZE < len(group_keys):
                await asyncio.sleep(EXCHANGE_BATCH_DELAY)

    # Summary — every status bucket must be counted or the cron runner's
    # alarm conditions (which watch the response body) silently misclassify
    # a tick where every key hit a transient validation failure as
    # "0 synced, 0 failed = idle" instead of "everything failed transiently."
    synced = sum(1 for r in all_results if r["status"] == "ok")
    partial = sum(1 for r in all_results if r["status"] == "partial")
    failed = sum(1 for r in all_results if r["status"] == "error")
    timed_out = sum(1 for r in all_results if r["status"] == "timeout")
    revoked = sum(1 for r in all_results if r["status"] == "key_revoked")
    transient = sum(1 for r in all_results if r["status"] == "transient_failure")
    total_trades = sum(r.get("trades_fetched", 0) for r in all_results)
    overall_duration = round(time.monotonic() - overall_start, 2)

    logger.info(
        "cron_sync complete: %d synced, %d partial, %d failed, %d timed out, "
        "%d revoked, %d transient, %d total trades, %.1fs total duration",
        synced,
        partial,
        failed,
        timed_out,
        revoked,
        transient,
        total_trades,
        overall_duration,
    )

    # Log each key result for observability
    for r in all_results:
        level = logging.INFO if r["status"] == "ok" else logging.WARNING
        logger.log(
            level,
            "cron_sync key_id=%s exchange=%s strategy=%s trades=%d "
            "duration=%.1fs status=%s%s",
            r.get("key_id"),
            r.get("exchange"),
            r.get("strategy_id"),
            r.get("trades_fetched", 0),
            r.get("duration_s", 0),
            r["status"],
            f" error={r['error']}" if r.get("error") else "",
        )

    # Recompute analytics for portfolios affected by synced strategies.
    #
    # audit-2026-05-07 G8.F.2 / FIX-LIST P164 — filter on is_test=false
    # before triggering recompute. Post-v0.4.0 pivot, allocators can
    # save what-if scenarios as is_test=true portfolios that share
    # strategy ids with their real book. Without this filter, cron
    # recomputes analytics for every scenario portfolio on every tick:
    #   * wastes compute proportional to saved-scenarios per allocator
    #   * inflates portfolio_analytics row volume
    #   * fires portfolio_alerts (rebalance drift, etc.) for hypothetical
    #     positions that nobody is monitoring
    #   * triggers email dispatches via notification_dispatches for
    #     scenario books — alert spam to the allocator's inbox
    # The Test Portfolios surface was hidden from the allocator sidebar
    # in the v0.4.0 pivot specifically because scenario books are
    # exploratory; the cron path was overlooked at that time.
    # Include `partial` keys: at least one of their per-strategy RPCs
    # succeeded, and the portfolios backed by those successful
    # strategies still need a recompute. Iterating
    # `per_strategy_stored` (instead of `strategy_ids`) restricts the
    # cascade to the strategies that actually received trades, so a
    # partial key doesn't drag its failed strategies' portfolios in.
    synced_strategy_ids = list({
        sid
        for r in all_results
        if r["status"] in ("ok", "partial")
        for sid, stored in r.get("per_strategy_stored", {}).items()
        if stored > 0
    })
    portfolio_recomputes_error: str | None = None
    if synced_strategy_ids:
        try:
            # NEW-C32-01: paginate the synced_strategy_ids IN-list.
            # An unbounded list grows 1:1 with active keys × strategies and
            # can exceed the PostgREST URL limit (HTTP 414 / silent truncation),
            # silently dropping affected portfolios from the recompute cascade.
            # match.py:L1126 already documents this hazard; same fix here.
            #
            # B19 deferred: these two loops are NOT routed through
            # services.db.chunked_in_query. The helper does the whole walk
            # internally and propagates a chunk failure, hiding the partial
            # accumulator — but the A3-03 / L-1 blast-radius contract requires
            # the except block below to log `_ps_collected = len(ps_data)` (how
            # many portfolio_ids were collected before a mid-walk DB blip). That
            # per-chunk-error-context shape is a deliberately different pattern
            # the all-or-nothing coverage helper does not model (Rule 7); forcing
            # it would either regress A3-03/L-1 or bloat the helper with a
            # single-caller partial-on-error type. The IN-list is already bounded
            # at _CRON_IN_LIST_PAGE_SIZE here, so the 414 risk is closed; only the
            # uniform coverage flag is forgone.
            ps_data: list[dict] = []
            for _page_start in range(0, len(synced_strategy_ids), _CRON_IN_LIST_PAGE_SIZE):
                _chunk = synced_strategy_ids[_page_start:_page_start + _CRON_IN_LIST_PAGE_SIZE]
                _page = (
                    supabase.table("portfolio_strategies")
                    .select("portfolio_id")
                    .in_("strategy_id", _chunk)
                    .execute()
                )
                ps_data.extend(_page.data or [])
            candidate_portfolio_ids = list(
                set(r["portfolio_id"] for r in ps_data)
            )

            # Second round-trip filters out is_test=true portfolios. We
            # could in principle do this in one query via PostgREST's
            # embedded-resource filter, but a simple .in_() on the
            # already-deduped candidate id list is clearer and survives
            # supabase-py syntax churn.
            # NEW-C32-01 (continued): also paginate candidate_portfolio_ids.
            portfolio_ids: list[str] = []
            if candidate_portfolio_ids:
                real_data: list[dict] = []
                for _page_start in range(
                    0, len(candidate_portfolio_ids), _CRON_IN_LIST_PAGE_SIZE
                ):
                    _chunk = candidate_portfolio_ids[
                        _page_start:_page_start + _CRON_IN_LIST_PAGE_SIZE
                    ]
                    _page = (
                        supabase.table("portfolios")
                        .select("id")
                        .in_("id", _chunk)
                        .eq("is_test", False)
                        .execute()
                    )
                    real_data.extend(_page.data or [])
                portfolio_ids = [r["id"] for r in real_data]
        except Exception as exc:
            # A Supabase blip on the recompute lookup must NOT lose the
            # per-key sync results we already collected. Record the
            # error in the response and short-circuit the recompute
            # branch instead of letting the exception propagate.
            #
            # A3-03: include page-context in the log so the blast radius is
            # visible. Pre-fix the log only showed the exception type, making
            # it impossible to determine which chunk failed and how many
            # portfolio_ids had already been successfully collected before the
            # failure — those are silently dropped when we reset to [].
            _ps_collected = len(ps_data)
            _n_strat_pages = (
                (len(synced_strategy_ids) + _CRON_IN_LIST_PAGE_SIZE - 1)
                // _CRON_IN_LIST_PAGE_SIZE
            )
            logger.exception(
                "cron_sync: recompute lookup failed (%s) — "
                "%d portfolio_ids already collected (from %d strategy pages) will be dropped; "
                "sync results preserved",
                type(exc).__name__,
                _ps_collected,
                _n_strat_pages,
            )
            portfolio_recomputes_error = f"{type(exc).__name__}: {exc}"
            portfolio_ids = []
            candidate_portfolio_ids = []

        skipped_test = len(candidate_portfolio_ids) - len(portfolio_ids)
        if skipped_test > 0:
            logger.info(
                "cron_recompute skipped %d is_test=true portfolio(s); recomputing %d real portfolio(s)",
                skipped_test,
                len(portfolio_ids),
            )

        # C-0213: reset stalled portfolio_analytics rows older than threshold before recomputing
        # audit-2026-05-07 C-0213 — reap any orphan computation_status='computing'
        # rows before the per-portfolio in-flight check below. If a previous
        # tick / pod was SIGKILL'd between the INSERT and the final UPDATE,
        # the row sits in 'computing' forever and `_guarded_recompute` would
        # otherwise classify the portfolio as `in_flight` indefinitely. The
        # reaper RPC was added in migration
        # 20260516122247_portfolio_analytics_stuck_row_reaper.sql.
        try:
            reaped = supabase.rpc(
                "reset_stalled_portfolio_analytics",
                {"p_stale_threshold": "30 minutes"},
            ).execute()
            if reaped.data:
                logger.info(
                    "cron_recompute: reaped %s stale portfolio_analytics rows",
                    reaped.data,
                )
        except Exception:
            # Non-fatal — the in-flight check will still classify the orphan
            # row as `in_flight` (not `ok`), but the user-facing 409 from
            # `POST /api/portfolio-analytics` won't auto-clear this tick.
            # Fail-loud via logger.exception so the traceback reaches Sentry
            # instead of being swallowed.
            logger.exception(
                "cron_recompute: stale-row reaper RPC failed",
            )

        # Best-effort within-process throttle via the shared
        # `_compute_semaphore` (process-local, so it does NOT prevent
        # double-compute across Vercel function instances or worker
        # pods; nor does it serialize same-pod races — the Semaphore
        # admits up to 3 coroutines concurrently and the DB-level
        # in-flight check is itself TOCTOU between SELECT and the
        # implicit INSERT inside `_compute_portfolio_analytics`).
        # A real cross-process guard would need a UNIQUE INDEX on
        # `portfolio_analytics(portfolio_id) WHERE computation_status='computing'`
        # or a Postgres advisory lock — tracked separately.
        #
        # The cron-internal `cron_recompute_sem` caps how many of the
        # shared 3 slots cron itself is allowed to hold, leaving at
        # least one slot for live `POST /api/portfolio-analytics`
        # traffic during long cron ticks.
        #
        # Per-portfolio outcomes are aggregated into the response so a
        # 100%-failure tick is not indistinguishable from a healthy one.
        #
        # Lazy import: test isolation (other test files have been
        # observed to unload `routers.portfolio` from sys.modules; see
        # test_cron_router.py TestPortfolioRecomputeErrorIsolation).
        from routers.portfolio import (
            _compute_portfolio_analytics,
            _compute_semaphore,
        )

        cron_recompute_sem = asyncio.Semaphore(CRON_RECOMPUTE_CONCURRENCY)

        async def _guarded_recompute(
            pid: str,
        ) -> tuple[str, RecomputeStatus, str | None]:
            """Acquire the cron-internal cap, then the shared
            semaphore, then check for an in-flight 'computing' row
            before recomputing. Mirrors the public POST
            /api/portfolio-analytics guard. Returns
            (portfolio_id, status, error_repr).
            """
            try:
                async with cron_recompute_sem, _compute_semaphore:
                    in_flight = (
                        supabase.table("portfolio_analytics")
                        .select("id")
                        .eq("portfolio_id", pid)
                        .eq("computation_status", "computing")
                        .limit(1)
                        .execute()
                    )
                    if in_flight.data:
                        # Distinct bucket from `ok` and `failed`: we
                        # neither computed nor crashed. Conflating
                        # this with `ok` would let a stuck "computing"
                        # row (the other worker may have died) report
                        # as success forever — exactly the silent-
                        # failure pattern this audit is closing.
                        logger.info(
                            "cron_recompute: portfolio %s already in-flight elsewhere",
                            pid,
                        )
                        return (pid, "in_flight", None)
                    await asyncio.wait_for(
                        _compute_portfolio_analytics(pid),
                        timeout=PORTFOLIO_RECOMPUTE_TIMEOUT,
                    )
                    return (pid, "ok", None)
            except asyncio.TimeoutError:
                # Capacity issue, not a logic bug — log as warning so
                # the failure bucket sees it but Sentry doesn't open a
                # ticket per portfolio.
                logger.warning(
                    "cron_recompute: portfolio %s exceeded %ds timeout",
                    pid,
                    PORTFOLIO_RECOMPUTE_TIMEOUT,
                )
                return (pid, "failed", f"TimeoutError: exceeded {PORTFOLIO_RECOMPUTE_TIMEOUT}s")
            except HTTPException as http_exc:
                # `_compute_portfolio_analytics` raises HTTP 400 for
                # benign business states ("No strategies", "No returns
                # data") — those are *skipped*, not failures. Anything
                # else (500-level, unexpected) is a real failure.
                if http_exc.status_code == 400:
                    logger.info(
                        "cron_recompute: portfolio %s skipped (benign): %s",
                        pid,
                        http_exc.detail,
                    )
                    return (pid, "skipped", None)
                logger.exception(
                    "Portfolio recompute failed for %s (HTTPException %d)",
                    pid,
                    http_exc.status_code,
                )
                return (pid, "failed", f"HTTPException {http_exc.status_code}: {http_exc.detail}")
            except Exception as exc:
                logger.exception(
                    "Portfolio recompute failed for %s (%s)",
                    pid,
                    type(exc).__name__,
                )
                return (pid, "failed", f"{type(exc).__name__}: {exc}")

        recompute_outcomes: list[tuple[str, RecomputeStatus, str | None]] = []
        if portfolio_ids:
            recompute_outcomes = await asyncio.gather(
                *[_guarded_recompute(pid) for pid in portfolio_ids],
                return_exceptions=False,
            )

        recompute_ok = sum(1 for _, status, _ in recompute_outcomes if status == "ok")
        recompute_in_flight = sum(
            1 for _, status, _ in recompute_outcomes if status == "in_flight"
        )
        recompute_skipped = sum(
            1 for _, status, _ in recompute_outcomes if status == "skipped"
        )
        recompute_failed = sum(
            1 for _, status, _ in recompute_outcomes if status == "failed"
        )
        all_failures = [
            {"portfolio_id": pid, "error": err}
            for pid, status, err in recompute_outcomes
            if status == "failed"
        ]
        # Cap the failures list — a platform-wide outage can produce
        # thousands of entries; the cap keeps the response payload
        # usable in Sentry / log search and bounds the body size the
        # cron runner has to store.
        if len(all_failures) > RECOMPUTE_FAILURE_CAP:
            recompute_failures = all_failures[:RECOMPUTE_FAILURE_CAP]
            failures_truncated = True
        else:
            recompute_failures = all_failures
            failures_truncated = False

        portfolio_recomputes = {
            "attempted": len(recompute_outcomes),
            "ok": recompute_ok,
            "in_flight": recompute_in_flight,
            "skipped": recompute_skipped,
            "failed": recompute_failed,
            "failures": recompute_failures,
            "failures_truncated": failures_truncated,
            "total_failures": len(all_failures),
        }
        if portfolio_recomputes_error:
            portfolio_recomputes["lookup_error"] = portfolio_recomputes_error
    else:
        portfolio_recomputes = {
            "attempted": 0,
            "ok": 0,
            "in_flight": 0,
            "skipped": 0,
            "failed": 0,
            "failures": [],
            "failures_truncated": False,
            "total_failures": 0,
        }

    # NEW-C32-02: cap the results list. `all_results` scales 1:1 with active
    # keys (each entry has per-strategy stats), so a large platform-wide
    # incident produces an unbounded body — the exact scenario the
    # RECOMPUTE_FAILURE_CAP was introduced to prevent, but for a LARGER
    # payload. Prefer non-ok statuses so the body is maximally diagnostic.
    _NON_OK_STATUSES = {"error", "timeout", "key_revoked", "transient_failure", "partial"}
    non_ok_results = [r for r in all_results if r.get("status") in _NON_OK_STATUSES]
    ok_results = [r for r in all_results if r.get("status") not in _NON_OK_STATUSES]
    if len(all_results) > RESULTS_CAP:
        # Fill cap with non-ok first, then ok results.
        capped_results = (non_ok_results + ok_results)[:RESULTS_CAP]
        results_truncated = True
    else:
        capped_results = all_results
        results_truncated = False

    return {
        "synced": synced,
        "partial": partial,
        "failed": failed,
        "timed_out": timed_out,
        "revoked": revoked,
        "transient": transient,
        "total_keys": len(keys),
        "total_trades": total_trades,
        "total_results": len(all_results),
        "results_truncated": results_truncated,
        "duration_s": overall_duration,
        "results": capped_results,
        "portfolio_recomputes": portfolio_recomputes,
    }
