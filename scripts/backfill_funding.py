#!/usr/bin/env python3
"""One-shot backfill script: populate funding_fees from exchange funding APIs.

Usage (from repo root):
    cd analytics-service && ../scripts/backfill_funding.py [--strategy-id UUID]

Or with the venv python:
    analytics-service/.venv/bin/python scripts/backfill_funding.py

Behavior
--------
- Enumerates all active strategies with a connected api_key whose
  exchange supports perpetual funding (binance/okx/bybit).
- For each, calls services.funding_fetch.fetch_funding with a
  90-day lookback (overridable via FUNDING_BACKFILL_DAYS env var).
- Upserts into funding_fees using on_conflict='match_key',
  ignore_duplicates=True — so re-runs are idempotent.
- Optional --strategy-id flag runs a single-strategy backfill.
- Logs per-strategy: rows fetched, rows inserted, any errors.

Security
--------
Requires SUPABASE_URL, SUPABASE_SERVICE_KEY, KEK_BASE64 env vars —
same as the analytics worker. API keys decrypted in-process via
services.encryption.decrypt_credentials.
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# Ensure the analytics-service package is importable when run from repo root.
_REPO_ROOT = Path(__file__).resolve().parent.parent
_ANALYTICS_DIR = _REPO_ROOT / "analytics-service"
if str(_ANALYTICS_DIR) not in sys.path:
    sys.path.insert(0, str(_ANALYTICS_DIR))

from services.db import db_execute, get_supabase  # noqa: E402
from services.encryption import decrypt_credentials, get_kek  # noqa: E402
from services.funding_fetch import (  # noqa: E402
    fetch_funding,
    upsert_funding_rows as _shared_upsert_funding_rows,
)

logger = logging.getLogger("backfill_funding")

SUPPORTED_EXCHANGES = {"binance", "okx", "bybit"}
DEFAULT_LOOKBACK_DAYS = int(os.environ.get("FUNDING_BACKFILL_DAYS", "90"))


async def upsert_funding_rows(supabase, rows: list[dict]) -> int:
    """Upsert funding rows into funding_fees in batches.

    Delegates to services.funding_fetch.upsert_funding_rows so the
    serialization and conflict-resolution logic is shared with job_worker.
    Returns the number of rows attempted (duplicates are silently dropped
    by PostgreSQL DO NOTHING — not observable at this layer).
    """
    result = await _shared_upsert_funding_rows(supabase, rows)
    return result["inserted"]


async def backfill_one_strategy(
    supabase,
    kek,
    strategy_row: dict,
    lookback_days: int,
    key_row: dict | None = None,
) -> tuple[int, int]:
    """Backfill a single strategy. Returns (fetched, inserted) counts.

    key_row should be pre-fetched by the caller via the batch key load
    in main(). If None, the strategy is skipped.
    """
    strategy_id = strategy_row["id"]
    api_key_id = strategy_row.get("api_key_id")
    if not api_key_id:
        logger.info("strategy=%s: no api_key, skipping", strategy_id)
        return 0, 0

    if key_row is None:
        logger.warning("strategy=%s: api_key %s missing, skipping", strategy_id, api_key_id)
        return 0, 0

    exchange_name = key_row.get("exchange", "")
    if exchange_name not in SUPPORTED_EXCHANGES:
        logger.info(
            "strategy=%s: exchange %s not supported for funding, skipping",
            strategy_id, exchange_name,
        )
        return 0, 0

    api_key, api_secret, passphrase = decrypt_credentials(key_row, kek)
    since_ms = int(
        (datetime.now(timezone.utc).timestamp() - lookback_days * 86400) * 1000
    )

    try:
        rows = await fetch_funding(
            exchange_name, api_key, api_secret, strategy_id, since_ms, passphrase
        )
    except Exception as exc:
        logger.error(
            "strategy=%s exchange=%s: fetch_funding failed: %s",
            strategy_id, exchange_name, exc,
        )
        return 0, 0

    inserted = await upsert_funding_rows(supabase, rows)
    logger.info(
        "strategy=%s exchange=%s: fetched=%d inserted=%d (lookback=%dd)",
        strategy_id, exchange_name, len(rows), inserted, lookback_days,
    )
    return len(rows), inserted


async def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill funding_fees")
    parser.add_argument(
        "--strategy-id",
        help="Only backfill this strategy id (default: all active strategies)",
    )
    parser.add_argument(
        "--lookback-days",
        type=int,
        default=DEFAULT_LOOKBACK_DAYS,
        help="Days of history to fetch (default: 90; env FUNDING_BACKFILL_DAYS)",
    )
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s: %(message)s",
    )

    supabase = get_supabase()
    kek = get_kek()

    def _list_strategies():
        q = supabase.table("strategies").select("id, user_id, api_key_id")
        q = q.not_.is_("api_key_id", "null")
        if args.strategy_id:
            q = q.eq("id", args.strategy_id)
        return q.execute()

    strategies_res = await db_execute(_list_strategies)
    strategies = strategies_res.data or []
    logger.info("Backfilling funding for %d strategies", len(strategies))

    # Batch-fetch all api_key rows in one query to avoid N serial SELECTs.
    api_key_ids = [s["api_key_id"] for s in strategies if s.get("api_key_id")]
    keys_by_id: dict[str, dict] = {}
    if api_key_ids:
        def _batch_load_keys():
            return (
                supabase.table("api_keys")
                .select("*")
                .in_("id", api_key_ids)
                .execute()
            )

        keys_res = await db_execute(_batch_load_keys)
        for k in (keys_res.data or []):
            keys_by_id[k["id"]] = k

    total_fetched = 0
    total_inserted = 0
    for strategy_row in strategies:
        key_row = keys_by_id.get(strategy_row.get("api_key_id", ""))
        fetched, inserted = await backfill_one_strategy(
            supabase, kek, strategy_row, args.lookback_days, key_row=key_row
        )
        total_fetched += fetched
        total_inserted += inserted

    logger.info(
        "DONE: %d strategies, %d rows fetched, %d rows upserted",
        len(strategies), total_fetched, total_inserted,
    )
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
