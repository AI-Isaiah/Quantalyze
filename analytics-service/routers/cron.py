import asyncio
import json
import logging
import time
from collections import defaultdict
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException

from services.db import get_supabase
from services.encryption import decrypt_credentials, get_kek
from services.exchange import create_exchange, fetch_all_trades, parse_since_ms, fetch_usdt_balance, validate_key_permissions

router = APIRouter(prefix="/api", tags=["cron"])
logger = logging.getLogger("quantalyze.analytics")

# Per-key timeout in seconds
KEY_SYNC_TIMEOUT = 60
# Max concurrent keys per batch
BATCH_SIZE = 5
# Delay between batches for the same exchange (seconds)
EXCHANGE_BATCH_DELAY = 2.0


async def _sync_single_key(
    key_row: dict,
    kek: bytes,
) -> dict:
    """Sync a single API key: decrypt, fetch trades, store, update cursor.

    Returns a structured result dict for logging.
    """
    key_id = key_row["id"]
    exchange_name = key_row["exchange"]
    # audit-2026-05-07 C-0201 — an API key may link to MULTIPLE
    # strategies (the FK lives on strategies.api_key_id, so a single
    # key_id can appear N times). The pre-fix code did
    # `strategy_rel[0]["id"]` and silently dropped strategies 2..N — they
    # never received a sync_trades RPC and their windows went stale.
    # `strategy_ids` is the full list; `strategy_id` is retained as the
    # primary (first) entry for result-payload back-compat.
    strategy_ids: list[str] = list(key_row.get("strategy_ids") or [])
    strategy_id = strategy_ids[0] if strategy_ids else key_row.get("strategy_id")
    start = time.monotonic()

    try:
        # Decrypt credentials
        api_key, api_secret, passphrase = decrypt_credentials(key_row, kek)
        exchange = create_exchange(exchange_name, api_key, api_secret, passphrase)

        try:
            # Re-validate key permissions before syncing
            validation = await validate_key_permissions(exchange)
            if not validation["valid"]:
                # audit-2026-05-07 C-0194 — only deactivate keys for
                # credential-rejection error codes. Transient codes
                # (RATE_LIMITED, NETWORK_UNAVAILABLE, DDOS_PROTECTION,
                # EXCHANGE_UNAVAILABLE, VALIDATION_UNEXPECTED) flag the
                # validation as not-valid but mean "try again later"
                # NOT "credentials are bad" — pre-fix, a 30s network
                # blip permanently disabled the user's API key.
                CREDENTIAL_REJECTION_CODES = {
                    "AUTH_FAILED",
                    "PERMISSION_DENIED",
                    "WITHDRAW_SCOPE",
                    "TRADE_SCOPE",
                }
                error_code = validation.get("error_code")
                is_credential_failure = error_code in CREDENTIAL_REJECTION_CODES

                supabase = get_supabase()
                if is_credential_failure and strategy_id:
                    logger.warning(
                        "cron_sync: key %s failed validation (code=%s): %s — deactivating",
                        key_id,
                        error_code,
                        validation.get("error", "unknown"),
                    )
                    supabase.table("api_keys").update(
                        {"is_active": False}
                    ).eq("id", key_id).execute()
                else:
                    # Transient failure — leave is_active=True, retry next tick.
                    logger.warning(
                        "cron_sync: key %s transient validation failure (code=%s): %s — NOT deactivating",
                        key_id,
                        error_code,
                        validation.get("error", "unknown"),
                    )
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

            since_ms = parse_since_ms(key_row.get("last_sync_at"))
            trades = await fetch_all_trades(exchange, since_ms=since_ms)
            account_balance = await fetch_usdt_balance(exchange)
        finally:
            await exchange.close()

        # Store trades atomically via RPC.
        #
        # audit-2026-05-07 C-0201 — one API key can back N strategies
        # (strategies.api_key_id FK). Pre-fix this loop only invoked
        # sync_trades for the first strategy; all other linked
        # strategies missed the trade window. Run one RPC per linked
        # strategy so every strategy gets the freshly-fetched trades.
        supabase = get_supabase()
        trades_stored = 0
        per_strategy_stored: dict[str, int] = {}

        if trades and strategy_ids:
            trades_json = json.dumps(trades, default=str)
            for sid in strategy_ids:
                result = supabase.rpc(
                    "sync_trades",
                    {"p_strategy_id": sid, "p_trades": trades_json},
                ).execute()
                stored = result.data if isinstance(result.data, int) else len(trades)
                per_strategy_stored[sid] = stored
            # `trades_stored` reflects the primary strategy for back-compat;
            # `per_strategy_stored` carries the per-strategy breakdown.
            trades_stored = per_strategy_stored.get(strategy_id, 0)

        # Update last_sync_at and balance
        update_data: dict = {"last_sync_at": datetime.now(timezone.utc).isoformat()}
        if account_balance is not None:
            update_data["account_balance_usdt"] = account_balance
        supabase.table("api_keys").update(update_data).eq("id", key_id).execute()

        duration = time.monotonic() - start
        return {
            "key_id": key_id,
            "strategy_id": strategy_id,
            "strategy_ids": strategy_ids,
            "exchange": exchange_name,
            "trades_fetched": len(trades),
            "trades_stored": trades_stored,
            "per_strategy_stored": per_strategy_stored,
            "balance_usdt": account_balance,
            "duration_s": round(duration, 2),
            "status": "ok",
        }

    except Exception as e:
        duration = time.monotonic() - start
        logger.error(
            "cron_sync: key %s failed after %.1fs: %s",
            key_id,
            duration,
            str(e),
            exc_info=True,
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
        logger.warning(
            "cron_sync: key %s timed out after %ds",
            key_row["id"],
            KEY_SYNC_TIMEOUT,
        )
        return {
            "key_id": key_row["id"],
            "strategy_id": key_row.get("strategy_id"),
            "strategy_ids": list(key_row.get("strategy_ids") or []),
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
        # audit-2026-05-07 C-0199 — return HTTP 500 (not 200) so the
        # cron platform (Vercel/Railway) surfaces this as a failed
        # invocation and alarms fire. A 200 + error-in-body kept KEK
        # outages silent for days because the cron runner only watches
        # the HTTP status code.
        logger.critical("cron_sync: KEK not configured, aborting")
        raise HTTPException(status_code=500, detail="Encryption not configured (KEK missing)")

    supabase = get_supabase()

    # audit-2026-05-07 C-0200 — only sync into strategies whose
    # lifecycle status is live (draft/pending_review/published). Pre-fix
    # the cron joined every linked strategy regardless of status and
    # could overwrite the submission snapshot of an archived/deleted
    # strategy, flipping its approval-gate verdict between Submit and
    # Approve. Pull `status` along with `id` so we can filter
    # in-process (PostgREST embedded-resource filters across the
    # supabase-py versions we ship have been inconsistent — local
    # filtering is robust to that churn).
    ALLOWED_STRATEGY_STATUSES = {"draft", "pending_review", "published"}

    # Batch query: fetch all active keys with their linked strategies
    keys_result = (
        supabase.table("api_keys")
        .select("*, strategies!strategies_api_key_id_fkey(id, status)")
        .eq("is_active", True)
        .execute()
    )
    raw_keys = keys_result.data or []

    # Flatten: attach strategy_ids (full list) and strategy_id (primary)
    # from the join. audit-2026-05-07 C-0201 — preserve the full list of
    # linked strategies so _sync_single_key can fan out the sync_trades
    # RPC to every one. Pre-fix the list-shape branch took only
    # strategy_rel[0]["id"], silently dropping every strategy beyond the
    # first.
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
            and (e.get("status") in ALLOWED_STRATEGY_STATUSES if "status" in e else True)
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

    # Summary
    synced = sum(1 for r in all_results if r["status"] == "ok")
    failed = sum(1 for r in all_results if r["status"] == "error")
    timed_out = sum(1 for r in all_results if r["status"] == "timeout")
    revoked = sum(1 for r in all_results if r["status"] == "key_revoked")
    total_trades = sum(r.get("trades_fetched", 0) for r in all_results)
    overall_duration = round(time.monotonic() - overall_start, 2)

    logger.info(
        "cron_sync complete: %d synced, %d failed, %d timed out, %d revoked, "
        "%d total trades, %.1fs total duration",
        synced,
        failed,
        timed_out,
        revoked,
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
    # audit-2026-05-07 C-0201 — fan out across every strategy linked
    # to each successfully-synced key, not just the primary. A key
    # backing multiple strategies needs portfolio recompute for each.
    synced_strategy_ids: list[str] = []
    for r in all_results:
        if r["status"] != "ok":
            continue
        sids = r.get("strategy_ids") or ([r["strategy_id"]] if r.get("strategy_id") else [])
        for sid in sids:
            if sid:
                synced_strategy_ids.append(sid)
    synced_strategy_ids = list(set(synced_strategy_ids))
    if synced_strategy_ids:
        ps_rows = supabase.table("portfolio_strategies") \
            .select("portfolio_id") \
            .in_("strategy_id", synced_strategy_ids) \
            .execute()
        candidate_portfolio_ids = list(
            set(r["portfolio_id"] for r in (ps_rows.data or []))
        )

        # Second round-trip filters out is_test=true portfolios. We
        # could in principle do this in one query via PostgREST's
        # embedded-resource filter, but a simple .in_() on the
        # already-deduped candidate id list is clearer and survives
        # supabase-py syntax churn.
        portfolio_ids: list[str] = []
        if candidate_portfolio_ids:
            real_rows = supabase.table("portfolios") \
                .select("id") \
                .in_("id", candidate_portfolio_ids) \
                .eq("is_test", False) \
                .execute()
            portfolio_ids = [r["id"] for r in (real_rows.data or [])]

        skipped_test = len(candidate_portfolio_ids) - len(portfolio_ids)
        if skipped_test > 0:
            logger.info(
                "cron_recompute skipped %d is_test=true portfolio(s); recomputing %d real portfolio(s)",
                skipped_test,
                len(portfolio_ids),
            )

        # audit-2026-05-07 H-0546 — run portfolio recomputes
        # concurrently rather than awaiting one-at-a-time. The existing
        # _compute_semaphore(3) in routers.portfolio naturally caps
        # in-process concurrency; we wrap each call so the cron path
        # honours the same semaphore + in-flight DB check the public
        # HTTP handler enforces (C-0196 / H-0540 / H-0544).
        #
        # audit-2026-05-07 H-0542 — aggregate per-portfolio recompute
        # outcomes into the response so a 100% failure rate (e.g. DB
        # schema drift) does NOT look like a healthy cron run. Pre-fix
        # the cron returned the original synced/failed payload even
        # when every recompute raised, leaving HTTP 200 + 'failed=0'
        # masking total downstream collapse.
        #
        # audit-2026-05-07 H-0543 — use logger.exception so the
        # traceback (including the chained cause) lands in
        # Sentry/aggregator, not just the str(e) message.
        from routers.portfolio import (
            _compute_portfolio_analytics,
            _compute_semaphore,
        )

        async def _guarded_recompute(pid: str) -> tuple[str, bool, str | None]:
            """Acquire the shared semaphore + check for an in-flight
            'computing' row before recomputing, mirroring the public
            POST /api/portfolio-analytics guard. Returns
            (portfolio_id, ok, error_repr).
            """
            try:
                async with _compute_semaphore:
                    in_flight = (
                        supabase.table("portfolio_analytics")
                        .select("id")
                        .eq("portfolio_id", pid)
                        .eq("computation_status", "computing")
                        .limit(1)
                        .execute()
                    )
                    if in_flight.data:
                        logger.info(
                            "cron_recompute skipped portfolio %s — another "
                            "computation already in-flight",
                            pid,
                        )
                        return (pid, True, None)
                    await _compute_portfolio_analytics(pid)
                    return (pid, True, None)
            except Exception as exc:
                logger.exception(
                    "Portfolio recompute failed for %s (%s)",
                    pid,
                    type(exc).__name__,
                )
                return (pid, False, f"{type(exc).__name__}: {exc}")

        recompute_outcomes: list[tuple[str, bool, str | None]] = []
        if portfolio_ids:
            recompute_outcomes = await asyncio.gather(
                *[_guarded_recompute(pid) for pid in portfolio_ids],
                return_exceptions=False,
            )

        recompute_ok = sum(1 for _, ok, _ in recompute_outcomes if ok)
        recompute_failed = sum(1 for _, ok, _ in recompute_outcomes if not ok)
        recompute_failures = [
            {"portfolio_id": pid, "error": err}
            for pid, ok, err in recompute_outcomes
            if not ok
        ]

        portfolio_recomputes = {
            "attempted": len(recompute_outcomes),
            "ok": recompute_ok,
            "failed": recompute_failed,
            "failures": recompute_failures,
        }
    else:
        portfolio_recomputes = {
            "attempted": 0,
            "ok": 0,
            "failed": 0,
            "failures": [],
        }

    return {
        "synced": synced,
        "failed": failed,
        "timed_out": timed_out,
        "revoked": revoked,
        "total_keys": len(keys),
        "total_trades": total_trades,
        "duration_s": overall_duration,
        "results": all_results,
        "portfolio_recomputes": portfolio_recomputes,
    }
