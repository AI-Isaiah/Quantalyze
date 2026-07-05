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

from supabase import Client

from services.db import db_execute

logger = logging.getLogger("quantalyze.analytics.positions")


# ---------------------------------------------------------------------------
# Bybit V5 raw response parser
# ---------------------------------------------------------------------------

def _parse_bybit_v5_positions(raw_response: dict[str, Any]) -> list[dict[str, Any]]:
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
    positions: list[dict[str, Any]] = []

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

def _normalize_deribit_position(pos: dict[str, Any]) -> dict[str, Any] | None:
    """Normalize a Deribit derivative position (Phase 71 / DRB-09).

    Deribit INVERTS the linear CCXT assumption, so we read the raw ``info``
    fields (authoritative, matching the /private/get_position docs) rather
    than the unified ``contracts``/``notional``/``unrealizedPnl`` which CCXT
    maps in a Deribit-specific way:

      size            = position size in QUOTE ccy (USD/USDC) for futures/perps,
                        in BASE ccy (contracts) for options.
      size_currency   = position size in BASE ccy (BTC/ETH) — futures only.
      floating_profit_loss = unrealized PnL in the SETTLE ccy: BTC/ETH for
                        coin-settled (inverse) instruments, USDC for linear.
      average_price / mark_price / index_price = USD for perps/futures. For
                        options mark/average are the per-contract PREMIUM (in the
                        coin for inverse, USDC for linear); we convert them coin→
                        USD at the index so every emitted price/value field is USD.

    Inverse (coin-settled) PnL is converted coin→USD at ``index_price`` (the
    same convention the P70 ledger uses); linear (USDC-settled) PnL already ≈
    USD and passes through. Options report USD market VALUE (contracts ×
    premium), not underlying notional. Combos are value-loud-skipped. Returns
    None for a zero / flat position.
    """
    info = pos.get("info") or {}
    if not info:
        # A Deribit position with no raw payload is an unexpected shape —
        # fail loud rather than silently mis-normalize (no invented data).
        raise ValueError("deribit position missing raw 'info' payload")

    direction = str(info.get("direction") or "").lower()
    size = float(info.get("size") or 0)
    if direction == "zero" or size == 0:
        return None
    if direction == "buy":
        side = "long"
    elif direction == "sell":
        side = "short"
    else:  # missing direction — fall back to the sign of size
        side = "short" if size < 0 else "long"

    kind = str(info.get("kind") or "").lower()
    # Combos (future_combo / option_combo) are multi-leg; their size / price
    # fields don't follow the single-instrument convention, so value-loud-skip
    # them (contained by _normalize_ccxt_positions) rather than mis-value.
    if "combo" in kind:
        raise ValueError(
            f"deribit combo instrument {info.get('instrument_name')!r} "
            "(multi-leg) is not yet valued for the holdings panel"
        )
    option_style = kind == "option"

    index_price = float(info.get("index_price") or 0)
    mark_price = float(info.get("mark_price") or 0)
    average_price = float(info.get("average_price") or 0)

    # Coin-vs-USD settlement is decided by the SINGLE-SOURCE, instrument-name
    # classifier (deribit_txn) — NOT the ccxt-symbol shape. instrument_name is
    # always present in the raw Deribit payload, whereas pos["symbol"] can
    # degrade to the bare instrument name for an unresolved market (no ':'),
    # which would silently mis-read a coin-settled position as linear and
    # understate its uPnL ~index×. The classifier also FAILS LOUD on an unknown
    # coin-margined currency (mirroring the ledger's guard), and that raise is
    # contained per-position by _normalize_ccxt_positions.
    from services.deribit_txn import classify_instrument_settlement

    name = str(info.get("instrument_name") or pos.get("symbol") or "")
    coin_settled, _base = classify_instrument_settlement(name)

    if coin_settled:
        # coin→USD rate: index_price is the underlying spot. mark_price is a
        # valid BTC/USD rate for perps/futures but NOT for options (there it
        # is the premium in coin), so only fall back to mark for non-options.
        if index_price > 0:
            rate = index_price
        elif (not option_style) and mark_price > 0:
            rate = mark_price
        else:
            raise ValueError(
                "deribit inverse position: no usable index_price for coin→USD "
                f"conversion (index={index_price}, mark={mark_price})"
            )
        unrealized_pnl = float(info.get("floating_profit_loss") or 0) * rate
    else:
        # Linear (USDC-settled): PnL already ≈ USD.
        rate = 0.0
        unrealized_pnl = float(info.get("floating_profit_loss") or 0)

    if option_style:
        # Options: `size` is the base-ccy contract count; mark/average are the
        # per-contract PREMIUM (in the coin for inverse, in USDC for linear).
        # USD market VALUE = contracts × premium, converted coin→USD at the
        # index for coin-settled (px_to_usd=rate=index), pass-through for linear
        # (px_to_usd=1). This reports the position's worth, NOT the underlying
        # notional (contracts × index) — that overstated value_usd ~50× (WR-01).
        px_to_usd = rate if coin_settled else 1.0
        entry_price = average_price * px_to_usd
        mark_price_usd = mark_price * px_to_usd
        size_base = abs(size)
        size_usd = abs(size) * mark_price_usd
        mark_out = mark_price_usd
    else:
        # Futures/perps (+ future_combo handled above): `size` is the quote-ccy
        # notional; `size_currency` is the base-ccy coin amount. Prices are USD.
        entry_price = average_price
        size_base = abs(float(info.get("size_currency") or 0))
        size_usd = abs(size)
        mark_out = mark_price

    symbol = info.get("instrument_name") or str(pos.get("symbol") or "")

    return {
        "symbol": symbol,
        "side": side,
        "size_base": size_base,
        "size_usd": size_usd,
        "entry_price": entry_price,
        "mark_price": mark_out,
        "unrealized_pnl": unrealized_pnl,
        "exchange": "deribit",
    }


def _normalize_ccxt_position(pos: dict[str, Any], exchange_name: str) -> dict[str, Any] | None:
    """Normalize a single CCXT unified position dict to our schema.

    Returns None if position has zero size (filtered out by caller).
    """
    # Deribit inverts the linear CCXT mapping (coin-settled contracts, PnL in
    # the coin) — normalize it from the raw `info` fields, never the linear path.
    if exchange_name == "deribit":
        return _normalize_deribit_position(pos)

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


def _bybit_ccxt_has_critical_fields(positions: list[dict[str, Any]]) -> bool:
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

def _normalize_ccxt_positions(raw: list[dict[str, Any]], exchange_name: str) -> list[dict[str, Any]]:
    """Normalize a list of CCXT unified positions, filtering out zero-size.

    Deribit ONLY: a single un-normalizable position (fails the coin→USD guard —
    no usable index_price, unknown coin-margined currency, or a combo leg) is
    SKIPPED with a loud log rather than aborting the whole batch, so one
    anomalous instrument can't hide every other position the account holds
    ("the allocator sees their positions"). We skip, never invent a value; the
    anomaly is surfaced via the log/telemetry, not a wrong number.

    Other venues keep their existing FAIL-LOUD semantics — the Deribit branch is
    the only normalizer that raises by design, and a malformed Bybit/OKX row
    should still abort loudly (never be silently dropped, WR-03), so we don't
    swallow their exceptions.
    """
    if exchange_name != "deribit":
        return [
            n for pos in raw
            if (n := _normalize_ccxt_position(pos, exchange_name)) is not None
        ]

    out: list[dict[str, Any]] = []
    for pos in raw:
        try:
            n = _normalize_ccxt_position(pos, exchange_name)
        except ValueError as exc:
            logger.warning(
                "positions: skipping un-normalizable deribit position instrument=%r: %s",
                (pos.get("info") or {}).get("instrument_name") or pos.get("symbol"),
                exc,
            )
            continue
        if n is not None:
            out.append(n)
    return out


# ---------------------------------------------------------------------------
# Public: fetch_positions
# ---------------------------------------------------------------------------

async def fetch_positions(exchange_name: str, exchange: Any) -> list[dict[str, Any]]:
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


async def _fetch_positions_bybit(exchange: Any) -> list[dict[str, Any]]:
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
    supabase_client: Client,
    snapshots: list[dict[str, Any]],
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

    def _upsert() -> None:
        supabase_client.table("position_snapshots").upsert(
            rows,
            on_conflict="strategy_id,snapshot_date,symbol,side",
        ).execute()

    await db_execute(_upsert)
    return len(rows)
