"""Position polling per exchange via CCXT async.

Two public functions:
  fetch_positions(exchange_name, exchange) -> list[dict]
    Fetches current positions from a pre-constructed async CCXT exchange.
    Per-exchange implementations handle schema differences:
    - Binance futures: CCXT unified fetch_positions()
    - OKX hedge mode: dual-side (long + short per symbol) via unified API
    - Bybit: CCXT first, fallback to raw V5 if critical fields are missing

  persist_position_snapshots(supabase_client, snapshots, strategy_id, snapshot_date) -> int
    Upserts into position_snapshots table with ON CONFLICT idempotency.

Internal helper:
  _parse_bybit_v5_positions(raw_response) -> list[dict]
    Parses raw Bybit V5 position list response into normalized dicts.
"""
from __future__ import annotations

import logging
from typing import Any

from services.db import db_execute

logger = logging.getLogger("quantalyze.analytics.positions")


# ---------------------------------------------------------------------------
# Bybit V5 raw response parser
# ---------------------------------------------------------------------------

def _parse_bybit_v5_positions(raw_response: dict) -> list[dict]:
    """Parse raw Bybit V5 position list response into normalized dicts.

    Expected response structure (from private_get_v5_position_list):
    {
        "result": {
            "list": [
                {
                    "symbol": "BTCUSDT",
                    "side": "Buy" | "Sell",
                    "size": "0.1",
                    "positionValue": "6100",
                    "avgPrice": "60000",
                    "markPrice": "61000",
                    "unrealisedPnl": "100",
                    ...
                },
            ]
        }
    }

    Maps Buy → long, Sell → short, None/empty → flat.
    Filters out zero-size positions.
    """
    items = raw_response.get("result", {}).get("list", [])
    positions: list[dict] = []

    for item in items:
        size_raw = item.get("size", "0")
        size_base = abs(float(size_raw)) if size_raw else 0.0
        if size_base < 1e-12:
            continue

        raw_side = item.get("side", "")
        if raw_side == "Buy":
            side = "long"
        elif raw_side == "Sell":
            side = "short"
        else:
            side = "flat"

        positions.append({
            "symbol": item.get("symbol", ""),
            "side": side,
            "size_base": size_base,
            "size_usd": float(item.get("positionValue", 0)),
            "entry_price": float(item.get("avgPrice", 0)),
            "mark_price": float(item.get("markPrice", 0)),
            "unrealized_pnl": float(item.get("unrealisedPnl", 0)),
            "exchange": "bybit",
        })

    return positions


# ---------------------------------------------------------------------------
# Unified position normalizer from CCXT schema
# ---------------------------------------------------------------------------

def _normalize_ccxt_position(pos: dict, exchange_name: str) -> dict | None:
    """Normalize a single CCXT unified position dict to our schema.

    Returns None if position has zero size (filtered out by caller).
    """
    # CCXT unified: contracts * contractSize = base quantity
    contracts = pos.get("contracts") or 0
    contract_size = pos.get("contractSize") or 1
    size_base = abs(float(contracts) * float(contract_size))

    if size_base < 1e-12:
        return None

    # Side mapping: CCXT unified uses "long" / "short" / None
    raw_side = pos.get("side", "")
    if raw_side in ("long", "short"):
        side = raw_side
    else:
        side = "flat"

    # Symbol: strip the funding/settlement suffix for display
    # "BTC/USDT:USDT" → "BTCUSDT"
    symbol = pos.get("symbol", "")
    symbol = symbol.replace("/", "").replace(":USDT", "").replace(":USD", "")

    return {
        "symbol": symbol,
        "side": side,
        "size_base": size_base,
        "size_usd": float(pos.get("notional") or 0),
        "entry_price": float(pos.get("entryPrice") or 0),
        "mark_price": float(pos.get("markPrice") or 0),
        "unrealized_pnl": float(pos.get("unrealizedPnl") or 0),
        "exchange": exchange_name,
    }


def _bybit_ccxt_has_critical_fields(positions: list[dict]) -> bool:
    """Check if Bybit CCXT positions have all critical fields populated.

    If any position is missing markPrice, entryPrice, or unrealizedPnl,
    we need to fall back to the raw V5 API.
    """
    return all(
        pos.get("markPrice") is not None
        and pos.get("entryPrice") is not None
        and pos.get("unrealizedPnl") is not None
        for pos in positions
    )


# ---------------------------------------------------------------------------
# Internal: batch normalize CCXT positions
# ---------------------------------------------------------------------------

def _normalize_ccxt_positions(raw: list[dict], exchange_name: str) -> list[dict]:
    """Normalize a list of CCXT unified positions, filtering out zero-size."""
    return [
        n for pos in raw
        if (n := _normalize_ccxt_position(pos, exchange_name)) is not None
    ]


# ---------------------------------------------------------------------------
# Public: fetch_positions
# ---------------------------------------------------------------------------

async def fetch_positions(exchange_name: str, exchange: Any) -> list[dict]:
    """Fetch current positions from exchange via async CCXT.

    The exchange must already be constructed (via create_exchange) with
    valid decrypted credentials.

    Per-exchange implementations:
    - Binance futures: exchange.fetch_positions() (CCXT unified schema)
    - OKX hedge mode: exchange.fetch_positions() — dual-side returns
      separate long/short entries per symbol
    - Bybit: exchange.fetch_positions() first. If critical fields are missing
      (entryPrice, markPrice, unrealizedPnl), fall back to raw
      exchange.private_get_v5_position_list.

    Returns normalized dicts, filtering out zero-size positions.
    """
    if exchange_name == "bybit":
        return await _fetch_positions_bybit(exchange)

    # Binance and OKX both use the CCXT unified fetch_positions
    raw_positions = await exchange.fetch_positions()
    return _normalize_ccxt_positions(raw_positions, exchange_name)


async def _fetch_positions_bybit(exchange: Any) -> list[dict]:
    """Bybit-specific: try CCXT unified first, fall back to raw V5."""
    raw_positions = await exchange.fetch_positions()

    # Check if CCXT returned complete data
    if raw_positions and _bybit_ccxt_has_critical_fields(raw_positions):
        return _normalize_ccxt_positions(raw_positions, "bybit")

    # Fallback: raw V5 API
    logger.info("Bybit CCXT positions missing critical fields, falling back to V5 API")
    raw_response = await exchange.private_get_v5_position_list(
        {"category": "linear", "settleCoin": "USDT"}
    )
    return _parse_bybit_v5_positions(raw_response)


# ---------------------------------------------------------------------------
# Public: persist_position_snapshots
# ---------------------------------------------------------------------------

async def persist_position_snapshots(
    supabase_client: Any,
    snapshots: list[dict],
    strategy_id: str,
    snapshot_date: str,
) -> int:
    """Upsert snapshots into position_snapshots table.

    Uses ON CONFLICT (strategy_id, snapshot_date, symbol, side) DO UPDATE
    to be idempotent. Returns count of rows upserted.
    """
    if not snapshots:
        return 0

    rows = [
        {**snap, "strategy_id": strategy_id, "snapshot_date": snapshot_date}
        for snap in snapshots
    ]

    def _upsert():
        return supabase_client.table("position_snapshots").upsert(
            rows,
            on_conflict="strategy_id,snapshot_date,symbol,side",
        ).execute()

    result = await db_execute(_upsert)
    return len(rows)
