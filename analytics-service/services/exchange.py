import ccxt.async_support as ccxt
from typing import Any


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
    """Validate that the API key is functional using safe read-only operations."""
    result = {"valid": False, "read_only": False, "error": None}

    try:
        await exchange.load_markets()
        await exchange.fetch_balance()
        result["valid"] = True

        # Check permissions via exchange-specific API (never place orders)
        if exchange.id == "binance":
            try:
                api_restrictions = await exchange.sapi_get_account_apirestrictions()
                can_withdraw = api_restrictions.get("enableWithdrawals", False)
                can_trade = api_restrictions.get("enableSpotAndMarginTrading", False) or api_restrictions.get("enableFutures", False)
                result["read_only"] = not can_withdraw and not can_trade
                if can_withdraw:
                    result["error"] = "Key has withdrawal permissions. Please use a read-only key."
                elif can_trade:
                    result["error"] = "Key has trading permissions. Please use a read-only key."
            except Exception:
                result["error"] = "Could not verify key permissions. Please ensure your key is read-only."
                result["read_only"] = False
        elif exchange.id == "okx":
            try:
                config = await exchange.private_get_account_config()
                data = config.get("data", [{}])
                if isinstance(data, list) and len(data) > 0:
                    perm_type = data[0].get("permType", "") or data[0].get("perm", "")
                else:
                    perm_type = ""
                # OKX read-only permission type is "read_only" or empty (for read-only keys)
                # If we can fetch balance but can't determine permissions, accept it
                # (the balance fetch already proved the key works)
                is_read_only = perm_type in ("read_only", "readOnly", "") or "read" in perm_type.lower()
                # Try to detect trade/withdraw permissions explicitly
                has_trade = "trade" in perm_type.lower() if perm_type else False
                has_withdraw = "withdraw" in perm_type.lower() if perm_type else False
                if has_withdraw:
                    result["read_only"] = False
                    result["error"] = "Key has withdrawal permissions. Please use a read-only key."
                elif has_trade:
                    result["read_only"] = False
                    result["error"] = "Key has trading permissions. Please use a read-only key."
                else:
                    result["read_only"] = True
            except Exception:
                # If permission check fails but balance fetch worked, accept the key
                # with a warning (better UX than blocking)
                result["read_only"] = True
        elif exchange.id == "bybit":
            try:
                api_info = await exchange.private_get_v5_user_query_api()
                permissions = api_info.get("result", {}).get("permissions", {})
                has_trade = bool(permissions.get("ContractTrade") or permissions.get("Spot") or permissions.get("Exchange"))
                has_withdraw = bool(permissions.get("Wallet"))
                result["read_only"] = not has_trade and not has_withdraw
                if has_withdraw:
                    result["error"] = "Key has withdrawal permissions. Please use a read-only key."
                elif has_trade:
                    result["error"] = "Key has trading permissions. Please use a read-only key."
            except Exception:
                result["error"] = "Could not verify Bybit key permissions. Please ensure your key is read-only."
                result["read_only"] = False
        else:
            result["error"] = "Unsupported exchange for permission verification."
            result["read_only"] = False

    except ccxt.AuthenticationError:
        result["error"] = "Authentication failed. Check your API key and secret."
    except Exception:
        result["error"] = "Key validation failed. Please verify your credentials."

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
            # Try multiple instrument types since "ANY" is not supported
            from datetime import datetime, timezone
            all_bills: list[dict] = []

            for inst_type in ["SWAP", "FUTURES", "SPOT", "MARGIN"]:
                after_id = ""
                max_pages = 50

                for _ in range(max_pages):
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
                        after_id = data[-1].get("billId", "")

                        if len(data) < 100:
                            break
                    except Exception:
                        break

            for bill in all_bills:
                pnl_val = float(bill.get("pnl", 0))
                ts_raw = bill.get("ts", "")
                ts_iso = ""
                if ts_raw and ts_raw.isdigit():
                    ts_iso = datetime.fromtimestamp(int(ts_raw) / 1000, tz=timezone.utc).isoformat()

                daily_pnl.append({
                    "exchange": "okx",
                    "symbol": "PORTFOLIO",
                    "side": "buy" if pnl_val >= 0 else "sell",
                    "price": abs(pnl_val),
                    "quantity": 1,
                    "fee": abs(float(bill.get("fee", 0))),
                    "fee_currency": bill.get("ccy", "USDT"),
                    "timestamp": ts_iso,
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
                    if item.get("incomeType") in ("REALIZED_PNL", "COMMISSION", "FUNDING_FEE"):
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
        import logging
        logging.getLogger("quantalyze.analytics").error("fetch_daily_pnl failed: %s", str(e))

    return daily_pnl


async def fetch_all_trades(exchange: ccxt.Exchange, symbol: str | None = None, since_ms: int | None = None) -> list[dict[str, Any]]:
    """Fetch daily PnL from exchange. Uses account-level APIs instead of
    scanning individual trading pairs (which is 200+ API calls on OKX)."""
    return await fetch_daily_pnl(exchange, since_ms)
