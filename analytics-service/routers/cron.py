import asyncio
import json
import logging
import time
from collections import defaultdict
from datetime import datetime, timezone

from fastapi import APIRouter

from services.db import get_supabase
from services.encryption import decrypt_credentials, get_kek
from services.exchange import create_exchange, fetch_all_trades, parse_since_ms, fetch_usdt_balance

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
    strategy_id = key_row.get("strategy_id")
    start = time.monotonic()

    try:
        # Decrypt credentials
        api_key, api_secret, passphrase = decrypt_credentials(key_row, kek)
        exchange = create_exchange(exchange_name, api_key, api_secret, passphrase)

        try:
            since_ms = parse_since_ms(key_row.get("last_sync_at"))
            trades = await fetch_all_trades(exchange, since_ms=since_ms)
            account_balance = await fetch_usdt_balance(exchange)
        finally:
            await exchange.close()

        # Store trades atomically via RPC (only if we have a strategy and trades)
        supabase = get_supabase()
        trades_stored = 0

        if trades and strategy_id:
            trades_json = json.dumps(trades, default=str)
            result = supabase.rpc(
                "sync_trades",
                {"p_strategy_id": strategy_id, "p_trades": trades_json},
            ).execute()
            trades_stored = result.data if isinstance(result.data, int) else len(trades)

        # Update last_sync_at and balance
        update_data: dict = {"last_sync_at": datetime.now(timezone.utc).isoformat()}
        if account_balance is not None:
            update_data["account_balance_usdt"] = account_balance
        supabase.table("api_keys").update(update_data).eq("id", key_id).execute()

        duration = time.monotonic() - start
        return {
            "key_id": key_id,
            "strategy_id": strategy_id,
            "exchange": exchange_name,
            "trades_fetched": len(trades),
            "trades_stored": trades_stored,
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
        logger.error("cron_sync: KEK not configured, aborting")
        return {"error": "Encryption not configured", "synced": 0, "failed": 0}

    supabase = get_supabase()

    # Batch query: fetch all active keys with their linked strategy
    # Join through strategies table to get strategy_id for each key
    keys_result = (
        supabase.table("api_keys")
        .select("*, strategies!strategies_api_key_id_fkey(id)")
        .eq("is_active", True)
        .execute()
    )
    raw_keys = keys_result.data or []

    # Flatten: attach strategy_id from the join
    keys = []
    for row in raw_keys:
        strategy_rel = row.pop("strategies", None)
        if isinstance(strategy_rel, list) and strategy_rel:
            row["strategy_id"] = strategy_rel[0]["id"]
        elif isinstance(strategy_rel, dict) and strategy_rel.get("id"):
            row["strategy_id"] = strategy_rel["id"]
        else:
            row["strategy_id"] = None
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
    total_trades = sum(r.get("trades_fetched", 0) for r in all_results)
    overall_duration = round(time.monotonic() - overall_start, 2)

    logger.info(
        "cron_sync complete: %d synced, %d failed, %d timed out, "
        "%d total trades, %.1fs total duration",
        synced,
        failed,
        timed_out,
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

    return {
        "synced": synced,
        "failed": failed,
        "timed_out": timed_out,
        "total_keys": len(keys),
        "total_trades": total_trades,
        "duration_s": overall_duration,
        "results": all_results,
    }
