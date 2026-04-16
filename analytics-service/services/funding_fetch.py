"""Funding-fee ingestion for perpetual futures.

Three exchange-specific normalizers that fetch signed funding payments
from Binance (fapiPrivate_get_income with incomeType=FUNDING_FEE), OKX
(private_get_account_bills with type=8), and Bybit
(private_get_v5_account_transaction_log with SETTLEMENT type filter).

All three return a uniform list of dicts ready for UPSERT into the
funding_fees table (migration 044). The match_key column is computed
client-side as a deterministic bucket across the 8-hour funding cycle,
so repeated runs are idempotent via ON CONFLICT (match_key) DO NOTHING.

Why client-side match_key (not a DB generated column)?
  - Bybit rotates transaction IDs across responses; primary dedup on
    raw exchange IDs fails.
  - Binance/OKX/Bybit all pay funding on an 8-hour cycle (00:00, 08:00,
    16:00 UTC). Bucketing to that cadence gives one canonical row per
    window.
  - Python-computed key lets the backfill script and the sync_funding
    worker use the identical hashing logic with no DB dependency.

Shared upsert helpers (serialize_funding_row, upsert_funding_rows) live
here so both job_worker.py and scripts/backfill_funding.py use identical
serialization and conflict-resolution logic.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

import ccxt.async_support as ccxt

from services.db import db_execute
from services.exchange import EXCHANGE_CLASSES, create_exchange

logger = logging.getLogger("quantalyze.analytics.funding_fetch")


# Binance's /income endpoint caps a single request at 1000 rows.
BINANCE_PAGE_SIZE = 1000
# OKX caps at 100 per page.
OKX_PAGE_SIZE = 100
# Bybit v5 transaction-log caps at 50 per page.
BYBIT_PAGE_SIZE = 50

# Safety cap on exchange pagination.
# Binance 1000/page, OKX 100/page, Bybit 50/page × MAX_PAGES=200 →
# caps at 200k, 20k, 10k rows respectively per fetch run.
MAX_PAGES = 200

# Batch size for UPSERT into funding_fees. Shared with job_worker.py and
# scripts/backfill_funding.py to keep all three callers consistent.
FUNDING_UPSERT_BATCH_SIZE = 100


# ---------------------------------------------------------------------------
# Match key — deterministic 8-hour bucket dedup
# ---------------------------------------------------------------------------


def _bucket_8h(ts: datetime) -> str:
    """Round a UTC datetime down to its 8-hour funding window start.

    Windows: [00:00, 08:00), [08:00, 16:00), [16:00, 24:00) UTC.
    Returns an ISO-like string suitable for embedding in a match_key.
    """
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    else:
        ts = ts.astimezone(timezone.utc)
    hour_bucket = (ts.hour // 8) * 8
    bucketed = ts.replace(hour=hour_bucket, minute=0, second=0, microsecond=0)
    return bucketed.strftime("%Y-%m-%dT%H:%M:%S+00:00")


def _build_match_key(
    strategy_id: str, exchange: str, symbol: str, ts: datetime
) -> str:
    return f"{strategy_id}:{exchange}:{symbol}:{_bucket_8h(ts)}"


def _normalize_funding_row(
    strategy_id: str,
    exchange: str,
    symbol: str,
    amount_raw: Any,
    ts_raw: Any,
    currency: str,
    raw_item: dict,
) -> "dict[str, Any] | None":
    """Build a uniform funding_fees dict from raw exchange fields.

    Computes the match_key and handles Decimal conversion. Returns None on
    parse failure (caller should continue/skip the row).
    """
    if not symbol:
        return None
    if amount_raw is None:
        return None
    try:
        amount = Decimal(str(amount_raw))
    except Exception:
        return None

    ts = _parse_ts_ms(ts_raw)
    if ts is None:
        return None

    return {
        "strategy_id": strategy_id,
        "exchange": exchange,
        "symbol": symbol,
        "amount": amount,
        "currency": currency or "USDT",
        "timestamp": ts,
        "match_key": _build_match_key(strategy_id, exchange, symbol, ts),
        "raw_data": dict(raw_item),
    }


def _parse_ts_ms(value: Any) -> "datetime | None":
    """Parse an exchange timestamp (string or int millis) into UTC datetime.

    Returns None on parse failure so callers can skip the row.
    """
    if value is None:
        logger.warning("Failed to parse timestamp: %s", value)
        return None
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(int(value) / 1000, tz=timezone.utc)
    if isinstance(value, str):
        if value.isdigit():
            return datetime.fromtimestamp(int(value) / 1000, tz=timezone.utc)
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            logger.warning("Failed to parse timestamp: %s", value)
            return None
    logger.warning("Failed to parse timestamp: %s", value)
    return None


# ---------------------------------------------------------------------------
# Binance
# ---------------------------------------------------------------------------

async def fetch_funding_binance(
    exchange: ccxt.Exchange,
    strategy_id: str,
    since_ms: int | None,
) -> list[dict[str, Any]]:
    """Fetch signed funding fees from Binance fapiPrivate_get_income.

    Uses incomeType=FUNDING_FEE filter (Binance enforces a 30-day max
    lookback window per-request — caller is expected to pass an
    appropriate since_ms; the 90-day backfill script paginates by
    rolling the time window forward).

    Signed amount: Binance returns `income` as a signed string — negative
    = paid, positive = received. Preserved verbatim via Decimal to avoid
    float drift.
    """
    rows: list[dict[str, Any]] = []
    current_since = since_ms
    last_seen_ts: int | None = None

    for page_idx in range(MAX_PAGES):
        params: dict[str, Any] = {
            "incomeType": "FUNDING_FEE",
            "limit": BINANCE_PAGE_SIZE,
        }
        if current_since is not None:
            params["startTime"] = current_since

        try:
            data = await exchange.fapiPrivate_get_income(params)
        except Exception as exc:
            logger.warning(
                "Binance funding fetch failed page %d: %s", page_idx, exc
            )
            break

        if not data:
            break

        for item in data:
            # Defense-in-depth: filter by incomeType even though we asked
            # for FUNDING_FEE (some exchange variants return extras).
            if item.get("incomeType") != "FUNDING_FEE":
                continue

            row = _normalize_funding_row(
                strategy_id=strategy_id,
                exchange="binance",
                symbol=item.get("symbol") or "",
                amount_raw=item.get("income"),
                ts_raw=item.get("time"),
                currency=item.get("asset", "USDT") or "USDT",
                raw_item=item,
            )
            if row is None:
                continue

            rows.append(row)
            ts_ms = int(row["timestamp"].timestamp() * 1000)
            if last_seen_ts is None or ts_ms > last_seen_ts:
                last_seen_ts = ts_ms

        # Pagination: if we got a full page, advance startTime past the
        # last row's timestamp (+ 1ms to avoid re-reading the boundary).
        if len(data) < BINANCE_PAGE_SIZE:
            break
        if last_seen_ts is None:
            break
        current_since = last_seen_ts + 1

    logger.info(
        "binance funding_fetch: %d rows for strategy %s", len(rows), strategy_id
    )
    return rows


# ---------------------------------------------------------------------------
# OKX
# ---------------------------------------------------------------------------

async def fetch_funding_okx(
    exchange: ccxt.Exchange,
    strategy_id: str,
    since_ms: int | None,
) -> list[dict[str, Any]]:
    """Fetch signed funding fees from OKX private_get_account_bills type=8.

    OKX caps recent bills at 3 months; the archive endpoint
    (account/bills-archive) covers older history. We call the archive
    endpoint when since_ms is older than ~90 days.
    """
    rows: list[dict[str, Any]] = []
    three_months_ago_ms = int(
        (datetime.now(timezone.utc).timestamp() - 90 * 86400) * 1000
    )
    need_archive = since_ms is not None and since_ms < three_months_ago_ms

    async def _paginate(endpoint_name: str) -> None:
        endpoint = getattr(exchange, endpoint_name, None)
        if endpoint is None:
            return
        after_id = ""
        for page_idx in range(MAX_PAGES):
            params: dict[str, str] = {
                "type": "8",
                "limit": str(OKX_PAGE_SIZE),
            }
            if since_ms is not None:
                params["begin"] = str(since_ms)
            if after_id:
                params["after"] = after_id

            try:
                result = await endpoint(params)
            except Exception as exc:
                logger.warning(
                    "OKX %s funding fetch failed page %d: %s",
                    endpoint_name, page_idx, exc,
                )
                return

            if not isinstance(result, dict):
                return
            data = result.get("data", [])
            if not data or not isinstance(data, list):
                return

            for item in data:
                inst_id = item.get("instId", "") or ""
                symbol = inst_id.replace("-", "")
                row = _normalize_funding_row(
                    strategy_id=strategy_id,
                    exchange="okx",
                    symbol=symbol,
                    amount_raw=item.get("pnl"),
                    ts_raw=item.get("ts"),
                    currency=item.get("ccy", "USDT") or "USDT",
                    raw_item=item,
                )
                if row is None:
                    continue
                rows.append(row)

            after_id = data[-1].get("billId", "") or ""
            if len(data) < OKX_PAGE_SIZE or not after_id:
                return

    await _paginate("private_get_account_bills")
    if need_archive:
        await _paginate("private_get_account_bills_archive")

    # Dedup by match_key (archive + recent may overlap)
    seen: set[str] = set()
    deduped: list[dict[str, Any]] = []
    for row in rows:
        if row["match_key"] in seen:
            continue
        seen.add(row["match_key"])
        deduped.append(row)

    logger.info(
        "okx funding_fetch: %d rows (%d after dedup) for strategy %s",
        len(rows), len(deduped), strategy_id,
    )
    return deduped


# ---------------------------------------------------------------------------
# Bybit (new endpoint: v5/account/transaction-log)
# ---------------------------------------------------------------------------

async def fetch_funding_bybit(
    exchange: ccxt.Exchange,
    strategy_id: str,
    since_ms: int | None,
) -> list[dict[str, Any]]:
    """Fetch signed funding fees from Bybit v5/account/transaction-log.

    Filters for type=SETTLEMENT which covers perpetual funding settlements.
    Unlike private_get_v5_position_closed_pnl (which mixes realized trade
    P&L with funding into one number), this endpoint isolates funding only.

    Uses cursor-based pagination.
    """
    rows: list[dict[str, Any]] = []
    cursor = ""

    for page_idx in range(MAX_PAGES):
        params: dict[str, str] = {
            "category": "linear",
            "type": "SETTLEMENT",
            "limit": str(BYBIT_PAGE_SIZE),
        }
        if since_ms is not None and not cursor:
            params["startTime"] = str(since_ms)
        if cursor:
            params["cursor"] = cursor

        try:
            result = await exchange.private_get_v5_account_transaction_log(
                params
            )
        except Exception as exc:
            logger.warning(
                "Bybit funding fetch failed page %d: %s", page_idx, exc
            )
            break

        items = result.get("result", {}).get("list", [])
        if not items:
            break

        for item in items:
            funding_raw = (
                item.get("funding")
                or item.get("change")
                or item.get("cashFlow")
                or "0"
            )
            row = _normalize_funding_row(
                strategy_id=strategy_id,
                exchange="bybit",
                symbol=item.get("symbol", "") or "",
                amount_raw=funding_raw,
                ts_raw=item.get("transactionTime") or item.get("created_time"),
                currency=item.get("currency", "USDT") or "USDT",
                raw_item=item,
            )
            if row is None:
                continue
            rows.append(row)

        next_cursor = result.get("result", {}).get("nextPageCursor", "")
        if not next_cursor:
            break
        cursor = next_cursor

    logger.info(
        "bybit funding_fetch: %d rows for strategy %s", len(rows), strategy_id
    )
    return rows


# ---------------------------------------------------------------------------
# Top-level dispatcher
# ---------------------------------------------------------------------------

async def fetch_funding(
    exchange_name: str,
    api_key: str,
    api_secret: str,
    strategy_id: str,
    since_ms: int | None,
    passphrase: str | None = None,
) -> list[dict[str, Any]]:
    """Convenience dispatcher that constructs the exchange, routes to the
    right normalizer, and closes the connection in a finally block.

    Raises ValueError for unsupported exchanges.
    """
    if exchange_name not in EXCHANGE_CLASSES:
        raise ValueError(f"Unsupported exchange for funding: {exchange_name}")

    exchange = create_exchange(exchange_name, api_key, api_secret, passphrase)
    try:
        if exchange_name == "binance":
            return await fetch_funding_binance(exchange, strategy_id, since_ms)
        if exchange_name == "okx":
            return await fetch_funding_okx(exchange, strategy_id, since_ms)
        if exchange_name == "bybit":
            return await fetch_funding_bybit(exchange, strategy_id, since_ms)
        raise ValueError(f"Unsupported exchange for funding: {exchange_name}")
    finally:
        try:
            await exchange.close()
        except Exception:  # pragma: no cover
            pass


# ---------------------------------------------------------------------------
# Shared upsert helpers — used by job_worker.py and scripts/backfill_funding.py
# ---------------------------------------------------------------------------


def serialize_funding_row(row: dict) -> dict:
    """Serialize a funding_fees dict for JSON-safe UPSERT.

    Converts Decimal amounts to strings and datetime timestamps to ISO
    strings. Returns a new dict; does not mutate the input.
    """
    ts = row["timestamp"]
    if hasattr(ts, "isoformat"):
        ts = ts.isoformat()
    return {
        "strategy_id": row["strategy_id"],
        "exchange": row["exchange"],
        "symbol": row["symbol"],
        "amount": str(row["amount"]),
        "currency": row["currency"],
        "timestamp": ts,
        "match_key": row["match_key"],
        "raw_data": row.get("raw_data"),
    }


async def upsert_funding_rows(
    supabase,
    rows: list[dict],
    batch_size: int = FUNDING_UPSERT_BATCH_SIZE,
) -> dict:
    """Upsert funding rows into funding_fees in batches.

    Uses on_conflict='match_key' + ignore_duplicates=True so repeated
    runs over the same time window are no-ops at the DB layer (idempotent
    by design — Bybit fill_id rotation makes dedup on raw IDs unsafe).

    Returns {'inserted': N, 'skipped': 0, 'errors': []}.
    The 'skipped' count is not observable at the Python layer (PostgreSQL
    DO NOTHING is silent); callers should treat inserted as rows_attempted.
    """
    if not rows:
        return {"inserted": 0, "skipped": 0, "errors": []}

    errors: list[str] = []
    total = 0

    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        payload = [serialize_funding_row(r) for r in batch]

        def _upsert(rows_to_insert=payload):
            supabase.table("funding_fees").upsert(
                rows_to_insert,
                on_conflict="match_key",
                ignore_duplicates=True,
            ).execute()

        try:
            await db_execute(_upsert)
            total += len(batch)
        except Exception as exc:  # noqa: BLE001
            errors.append(str(exc)[:200])
            logger.warning(
                "upsert_funding_rows batch %d failed: %s", i // batch_size, exc
            )

    return {"inserted": total, "skipped": 0, "errors": errors}
