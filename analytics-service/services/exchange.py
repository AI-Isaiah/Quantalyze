import ccxt.async_support as ccxt
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

logger = logging.getLogger("quantalyze.analytics")


EXCHANGE_CLASSES: dict[str, type] = {
    "binance": ccxt.binance,
    "okx": ccxt.okx,
    "bybit": ccxt.bybit,
}


def create_exchange(exchange_name: str, api_key: str, api_secret: str, passphrase: str | None = None) -> ccxt.Exchange:
    """Create a CCXT exchange instance with read-only credentials."""
    cls = EXCHANGE_CLASSES.get(exchange_name)
    if not cls:
        raise ValueError(f"Unsupported exchange: {exchange_name}")

    config: dict[str, Any] = {
        "apiKey": api_key,
        "secret": api_secret,
        "enableRateLimit": True,
    }
    if passphrase:
        config["password"] = passphrase

    return cls(config)


async def validate_key_permissions(exchange: ccxt.Exchange) -> dict[str, Any]:
    """Validate that the API key is functional using safe read-only operations.

    Public shape preserved for backwards compat: ``{valid, read_only, error}``.
    Sprint 5 Task 5.8 moved the per-exchange permission probes into
    ``services.key_permissions`` so the new live viewer can reuse the same
    parsers. ``read_only`` here is derived from the new triple as
    ``read and not trade and not withdraw`` — same semantics as before.
    """
    from services.key_permissions import detect_permissions

    result: dict[str, Any] = {"valid": False, "read_only": False, "error": None}

    try:
        await exchange.load_markets()
        await exchange.fetch_balance()
        result["valid"] = True
    except ccxt.AuthenticationError:
        result["error"] = "Authentication failed. Check your API key and secret."
        return result
    except Exception:
        result["error"] = "Key validation failed. Please verify your credentials."
        return result

    if exchange.id not in EXCHANGE_CLASSES:
        result["error"] = "Unsupported exchange for permission verification."
        return result

    # Pre-store path: no api_key_id yet, bypass cache.
    perms = await detect_permissions(exchange, api_key_id=None)
    has_withdraw = perms.get("withdraw", False)
    has_trade = perms.get("trade", False)
    has_read = perms.get("read", False)
    probe_error = perms.get("probe_error", False)

    result["read_only"] = bool(has_read and not has_trade and not has_withdraw)
    # Surface the transient flag so callers can avoid persisting a
    # fail-CLOSED default as if it were a real probe result.
    result["probe_error"] = bool(probe_error)

    if has_withdraw:
        result["error"] = "Key has withdrawal permissions. Please use a read-only key."
    elif has_trade:
        result["error"] = "Key has trading permissions. Please use a read-only key."

    return result


async def fetch_daily_pnl(exchange: ccxt.Exchange, since_ms: int | None = None) -> list[dict[str, Any]]:
    """Fetch daily PnL from the exchange account bills/ledger.

    Instead of scanning every trading pair for individual trades (200+ API calls),
    this fetches account-level P&L history directly. Much faster and gives us
    exactly what we need for analytics: daily profit/loss.
    """
    daily_pnl: list[dict[str, Any]] = []

    try:
        if exchange.id == "okx":
            # OKX: fetch account bills (P&L history) with pagination for full history
            from datetime import datetime, timezone, timedelta
            all_bills: list[dict] = []

            # Fetch bills across all instrument types, paginate for full history
            for inst_type in ["SWAP", "FUTURES", "SPOT", "MARGIN"]:
                after_id = ""
                type_count = 0

                for page in range(100):
                    params: dict[str, str] = {"instType": inst_type, "limit": "100"}
                    if since_ms:
                        params["begin"] = str(since_ms)
                    if after_id:
                        params["after"] = after_id

                    try:
                        bills = await exchange.private_get_account_bills(params)
                        data = bills.get("data", [])
                        if not data:
                            break
                        all_bills.extend(data)
                        type_count += len(data)
                        after_id = data[-1].get("billId", "")
                        if len(data) < 100:
                            break
                    except Exception as e:
                        logger.warning("OKX bills fetch failed for %s page %d: %s", inst_type, page, str(e))
                        break

                if type_count > 0:
                    logger.info("OKX %s: fetched %d bills", inst_type, type_count)

            # Fetch bills-archive for older history (>3 months)
            # Only fetch archive if we need data older than 90 days
            archive_bills: list[dict] = []
            three_months_ago_ms = int((datetime.now(timezone.utc) - timedelta(days=90)).timestamp() * 1000)
            should_fetch_archive = since_ms is None or since_ms < three_months_ago_ms
            if not should_fetch_archive:
                logger.info("OKX: skipping archive API (since_ms is within 3 months)")
            else:
                logger.info("OKX: fetching archive API for older history...")
                for inst_type in ["SWAP", "FUTURES", "SPOT", "MARGIN"]:
                    after_id = ""
                    type_count = 0
                    for page in range(100):
                        params: dict[str, str] = {"instType": inst_type, "limit": "100"}
                        if since_ms:
                            params["begin"] = str(since_ms)
                        if after_id:
                            params["after"] = after_id
                        try:
                            bills = await exchange.private_get_account_bills_archive(params)
                            data = bills.get("data", [])
                            if not data:
                                break
                            archive_bills.extend(data)
                            type_count += len(data)
                            after_id = data[-1].get("billId", "")
                            if len(data) < 100:
                                break
                        except Exception as e:
                            logger.warning("OKX archive failed for %s: %s", inst_type, str(e))
                            break
                    if type_count > 0:
                        logger.info("OKX archive %s: fetched %d bills", inst_type, type_count)

            # Merge recent + archive and deduplicate by billId
            merged_bills = all_bills + archive_bills
            seen_ids: set[str] = set()
            unique_bills: list[dict] = []
            for bill in merged_bills:
                bid = bill.get("billId", "")
                if bid and bid not in seen_ids:
                    seen_ids.add(bid)
                    unique_bills.append(bill)
                elif not bid:
                    logger.warning("OKX bill missing billId, cannot deduplicate: %s", bill.get("ts", "unknown"))
                    unique_bills.append(bill)
            all_bills = unique_bills

            logger.info(
                "OKX total: %d bills (%d recent + %d archive, %d after dedup)",
                len(all_bills), len(merged_bills) - len(archive_bills),
                len(archive_bills), len(all_bills)
            )

            # Aggregate bills into daily PnL
            from collections import defaultdict
            daily_totals: dict[str, float] = defaultdict(float)

            for bill in all_bills:
                pnl_val = float(bill.get("pnl", 0)) + float(bill.get("fee", 0))
                ts_raw = bill.get("ts", "")
                if ts_raw and ts_raw.isdigit():
                    dt = datetime.fromtimestamp(int(ts_raw) / 1000, tz=timezone.utc)
                    day_key = dt.strftime("%Y-%m-%d")
                    daily_totals[day_key] += pnl_val

            logger.info(
                "OKX: %d bills aggregated to %d daily PnL entries",
                len(all_bills), len(daily_totals)
            )

            for day, pnl in sorted(daily_totals.items()):
                daily_pnl.append({
                    "exchange": "okx",
                    "symbol": "PORTFOLIO",
                    "side": "buy" if pnl >= 0 else "sell",
                    "price": abs(pnl),
                    "quantity": 1,
                    "fee": 0,
                    "fee_currency": "USDT",
                    "timestamp": f"{day}T00:00:00+00:00",
                    "order_type": "daily_pnl",
                })

        elif exchange.id == "binance":
            # Binance: fetch income history (futures P&L)
            try:
                params = {"limit": 1000}
                if since_ms:
                    params["startTime"] = since_ms
                income = await exchange.fapiPrivate_get_income(params)
                for item in income:
                    # Sprint 5.6 cutover: FUNDING_FEE no longer routes into
                    # daily_pnl. Funding is ingested separately via
                    # services.funding_fetch → funding_fees table.
                    # See migration 044 for the forward-only rationale.
                    if item.get("incomeType") in ("REALIZED_PNL", "COMMISSION"):
                        daily_pnl.append({
                            "exchange": "binance",
                            "symbol": item.get("symbol", "PORTFOLIO"),
                            "side": "buy" if float(item.get("income", 0)) >= 0 else "sell",
                            "price": abs(float(item.get("income", 0))),
                            "quantity": 1,
                            "fee": 0,
                            "fee_currency": "USDT",
                            "timestamp": item.get("time", ""),
                            "order_type": "daily_pnl",
                        })
                for entry in daily_pnl:
                    if entry["timestamp"] and str(entry["timestamp"]).isdigit():
                        from datetime import datetime, timezone
                        ts = int(entry["timestamp"]) / 1000
                        entry["timestamp"] = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
            except Exception:
                # Fallback: fetch spot trades for BTC only
                trades = await exchange.fetch_my_trades("BTC/USDT", since=since_ms, limit=1000)
                for t in trades:
                    daily_pnl.append({
                        "exchange": "binance", "symbol": t["symbol"],
                        "side": t["side"], "price": t["price"],
                        "quantity": t["amount"],
                        "fee": t.get("fee", {}).get("cost"),
                        "fee_currency": t.get("fee", {}).get("currency"),
                        "timestamp": t["datetime"], "order_type": t.get("type"),
                    })

        elif exchange.id == "bybit":
            # Bybit: fetch closed PnL
            try:
                params = {"category": "linear", "limit": 200}
                result = await exchange.private_get_v5_position_closed_pnl(params)
                items = result.get("result", {}).get("list", [])
                for item in items:
                    daily_pnl.append({
                        "exchange": "bybit",
                        "symbol": item.get("symbol", "PORTFOLIO"),
                        "side": "buy" if float(item.get("closedPnl", 0)) >= 0 else "sell",
                        "price": abs(float(item.get("closedPnl", 0))),
                        "quantity": 1,
                        "fee": 0,
                        "fee_currency": "USDT",
                        "timestamp": item.get("createdTime", ""),
                        "order_type": "daily_pnl",
                    })
                for entry in daily_pnl:
                    if entry["timestamp"] and str(entry["timestamp"]).isdigit():
                        from datetime import datetime, timezone
                        ts = int(entry["timestamp"]) / 1000
                        entry["timestamp"] = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
            except Exception:
                pass

    except Exception as e:
        logger.error("fetch_daily_pnl failed: %s", str(e))

    return daily_pnl


@dataclass
class RawFill:
    exchange_order_id: str
    exchange_fill_id: str
    symbol: str
    side: str  # "buy" or "sell"
    price: Decimal
    amount: Decimal
    cost: Decimal
    fee: Decimal
    fee_currency: str
    is_maker: bool
    timestamp: datetime
    exchange: str
    raw_data: dict | None = None


async def fetch_raw_trades(
    exchange: ccxt.Exchange,
    strategy_id: str,
    supabase,
    since_ms: int | None = None,
) -> list[dict[str, Any]]:
    """Fetch raw fill-level trades from the exchange.

    Returns a list of dicts normalized to the trades table schema with
    is_fill=True. Overlap window: subtracts 1 hour from since_ms for
    late-arriving fills; dedup is handled by the DB partial unique index.
    """
    from services.db import db_execute

    fills: list[dict[str, Any]] = []

    # Apply overlap window for late-arriving fills
    effective_since = None
    if since_ms is not None:
        effective_since = since_ms - 3_600_000  # subtract 1 hour

    try:
        if exchange.id == "binance":
            fills = await _fetch_raw_trades_binance(
                exchange, strategy_id, supabase, effective_since
            )
        elif exchange.id == "okx":
            fills = await _fetch_raw_trades_okx(exchange, effective_since)
        elif exchange.id == "bybit":
            fills = await _fetch_raw_trades_bybit(exchange, effective_since)
        else:
            logger.warning("fetch_raw_trades: unsupported exchange %s", exchange.id)
    except Exception as e:
        logger.error("fetch_raw_trades failed for %s: %s", exchange.id, str(e))
        raise

    logger.info(
        "fetch_raw_trades: %d fills from %s for strategy %s",
        len(fills), exchange.id, strategy_id,
    )
    return fills


async def _fetch_raw_trades_binance(
    exchange: ccxt.Exchange,
    strategy_id: str,
    supabase,
    since_ms: int | None,
) -> list[dict[str, Any]]:
    """Binance: per-symbol iteration using fetch_my_trades."""
    from services.db import db_execute

    # Get symbol list: DISTINCT symbols from trades + position_snapshots
    def _get_symbols():
        trade_syms = (
            supabase.table("trades")
            .select("symbol")
            .eq("strategy_id", strategy_id)
            .eq("is_fill", True)
            .execute()
        )
        pos_syms = (
            supabase.table("position_snapshots")
            .select("symbol")
            .eq("strategy_id", strategy_id)
            .execute()
        )
        symbols = set()
        for row in trade_syms.data or []:
            if row.get("symbol"):
                symbols.add(row["symbol"])
        for row in pos_syms.data or []:
            if row.get("symbol"):
                symbols.add(row["symbol"])
        return list(symbols)

    symbols = await db_execute(_get_symbols)

    # Cold start: fetch current positions to get symbols
    if not symbols:
        try:
            positions = await exchange.fetch_positions()
            for pos in positions:
                sym = pos.get("symbol")
                contracts = pos.get("contracts") or 0
                if sym and float(contracts) > 0:
                    symbols.append(sym)
            # Deduplicate
            symbols = list(set(symbols))
            logger.info(
                "Binance cold start: discovered %d symbols from positions", len(symbols)
            )
        except Exception as e:
            logger.warning("Binance cold start position fetch failed: %s", str(e))

    fills: list[dict[str, Any]] = []
    for symbol in symbols:
        try:
            # Normalize symbol for CCXT: BTCUSDT -> BTC/USDT:USDT
            ccxt_symbol = symbol
            if "/" not in ccxt_symbol:
                # Try to find the symbol in loaded markets
                if hasattr(exchange, "markets") and exchange.markets:
                    for mkt_symbol, mkt in exchange.markets.items():
                        normalized = mkt_symbol.replace("/", "").replace(":USDT", "").replace(":USD", "")
                        if normalized == symbol:
                            ccxt_symbol = mkt_symbol
                            break

            trades = await exchange.fetch_my_trades(
                ccxt_symbol, since=since_ms, limit=1000
            )
            for t in trades:
                fills.append(_normalize_fill(t, exchange.id))
        except Exception as e:
            logger.warning(
                "Binance fetch_my_trades failed for %s: %s", symbol, str(e)
            )
            continue

    return fills


async def _fetch_raw_trades_okx(
    exchange: ccxt.Exchange,
    since_ms: int | None,
) -> list[dict[str, Any]]:
    """OKX: private_get_trade_fills_history with cursor-based pagination."""
    fills: list[dict[str, Any]] = []
    cursor = ""

    for page in range(100):
        params: dict[str, str] = {"instType": "SWAP", "limit": "100"}
        if cursor:
            params["before"] = cursor
        if since_ms and not cursor:
            params["begin"] = str(since_ms)

        try:
            result = await exchange.private_get_trade_fills_history(params)
            data = result.get("data", [])
            if not data:
                break

            for fill in data:
                ts_raw = fill.get("ts", "")
                if ts_raw and ts_raw.isdigit():
                    ts_dt = datetime.fromtimestamp(
                        int(ts_raw) / 1000, tz=timezone.utc
                    )
                else:
                    ts_dt = datetime.now(timezone.utc)

                symbol = fill.get("instId", "").replace("-", "")
                side = fill.get("side", "").lower()
                price = float(fill.get("fillPx", 0))
                amount = float(fill.get("fillSz", 0))
                fee = abs(float(fill.get("fee", 0)))
                fee_currency = fill.get("feeCcy", "USDT")
                is_maker = fill.get("execType", "") == "M"

                raw_data = dict(fill)
                # Include posSide for hedge mode
                if fill.get("posSide"):
                    raw_data["posSide"] = fill["posSide"]

                fills.append({
                    "exchange": "okx",
                    "symbol": symbol,
                    "side": side,
                    "price": price,
                    "quantity": amount,
                    "fee": fee,
                    "fee_currency": fee_currency,
                    "timestamp": ts_dt.isoformat(),
                    "order_type": "fill",
                    "exchange_order_id": fill.get("ordId", ""),
                    "exchange_fill_id": fill.get("tradeId", ""),
                    "is_fill": True,
                    "is_maker": is_maker,
                    "cost": price * amount,
                    "raw_data": raw_data,
                })

            cursor = data[-1].get("tradeId", "")
            if len(data) < 100:
                break
        except Exception as e:
            logger.warning("OKX fills fetch failed page %d: %s", page, str(e))
            break

    return fills


async def _fetch_raw_trades_bybit(
    exchange: ccxt.Exchange,
    since_ms: int | None,
) -> list[dict[str, Any]]:
    """Bybit: private_get_v5_execution_list with cursor-based pagination."""
    fills: list[dict[str, Any]] = []
    cursor = ""

    for page in range(100):
        params: dict[str, str] = {"category": "linear", "limit": "100"}
        if cursor:
            params["cursor"] = cursor
        if since_ms and not cursor:
            params["startTime"] = str(since_ms)

        try:
            result = await exchange.private_get_v5_execution_list(params)
            items = result.get("result", {}).get("list", [])
            if not items:
                break

            for fill in items:
                ts_raw = fill.get("execTime", "")
                if ts_raw and ts_raw.isdigit():
                    ts_dt = datetime.fromtimestamp(
                        int(ts_raw) / 1000, tz=timezone.utc
                    )
                else:
                    ts_dt = datetime.now(timezone.utc)

                symbol = fill.get("symbol", "")
                side = fill.get("side", "").lower()
                price = float(fill.get("execPrice", 0))
                amount = float(fill.get("execQty", 0))
                fee = abs(float(fill.get("execFee", 0)))
                fee_currency = fill.get("feeCurrency", "USDT")
                is_maker = fill.get("isMaker", "false") == "true"

                fills.append({
                    "exchange": "bybit",
                    "symbol": symbol,
                    "side": side,
                    "price": price,
                    "quantity": amount,
                    "fee": fee,
                    "fee_currency": fee_currency,
                    "timestamp": ts_dt.isoformat(),
                    "order_type": "fill",
                    "exchange_order_id": fill.get("orderId", ""),
                    "exchange_fill_id": fill.get("execId", ""),
                    "is_fill": True,
                    "is_maker": is_maker,
                    "cost": price * amount,
                    "raw_data": dict(fill),
                })

            next_cursor = result.get("result", {}).get("nextPageCursor", "")
            if not next_cursor:
                break
            cursor = next_cursor
        except Exception as e:
            logger.warning("Bybit execution list failed page %d: %s", page, str(e))
            break

    return fills


def _normalize_fill(trade: dict, exchange_id: str) -> dict[str, Any]:
    """Normalize a CCXT unified trade to our fill dict shape."""
    fee_info = trade.get("fee") or {}
    fee_cost = abs(float(fee_info.get("cost", 0) or 0))
    fee_currency = fee_info.get("currency", "USDT") or "USDT"
    price = float(trade.get("price", 0))
    amount = float(trade.get("amount", 0))

    return {
        "exchange": exchange_id,
        "symbol": (trade.get("symbol", "")
                   .replace("/", "").replace(":USDT", "").replace(":USD", "")),
        "side": trade.get("side", ""),
        "price": price,
        "quantity": amount,
        "fee": fee_cost,
        "fee_currency": fee_currency,
        "timestamp": trade.get("datetime", ""),
        "order_type": "fill",
        "exchange_order_id": trade.get("order", ""),
        "exchange_fill_id": trade.get("id", ""),
        "is_fill": True,
        "is_maker": trade.get("takerOrMaker") == "maker",
        "cost": price * amount,
        "raw_data": trade.get("info"),
    }


async def fetch_all_trades(exchange: ccxt.Exchange, symbol: str | None = None, since_ms: int | None = None) -> list[dict[str, Any]]:
    """Fetch daily PnL from exchange. Uses account-level APIs instead of
    scanning individual trading pairs (which is 200+ API calls on OKX)."""
    return await fetch_daily_pnl(exchange, since_ms)


def parse_since_ms(
    last_sync_at: str | None,
    preferred: str | None = None,
) -> int | None:
    """Parse an ISO timestamp to milliseconds epoch.

    When `preferred` is provided and non-null, it is used in place of
    `last_sync_at`. This is how sync_trades resumes from the
    `last_fetched_trade_timestamp` partial-success checkpoint (migration 045)
    while keeping `last_sync_at` fallback behavior for callers that haven't
    adopted the new cursor.
    """
    value = preferred if preferred is not None else last_sync_at
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return int(dt.timestamp() * 1000)
    except Exception:
        return None


async def fetch_usdt_balance(exchange: ccxt.Exchange) -> float | None:
    """Fetch total USDT balance from exchange. Returns None on failure."""
    try:
        balance = await exchange.fetch_balance()
        usdt_total = balance.get("total", {}).get("USDT", 0)
        if usdt_total and float(usdt_total) > 0:
            return float(usdt_total)
    except Exception as e:
        logger.warning("Could not fetch account balance: %s", str(e))
    return None
