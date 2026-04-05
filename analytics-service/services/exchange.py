import ccxt
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
                perm_type = config.get("data", [{}])[0].get("permType", "")
                result["read_only"] = perm_type == "read_only"
                if not result["read_only"]:
                    result["error"] = f"Key has '{perm_type}' permissions. Please use a read-only key."
            except Exception:
                result["error"] = "Could not verify OKX key permissions. Please ensure your key is read-only."
                result["read_only"] = False
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


async def fetch_all_trades(exchange: ccxt.Exchange, symbol: str | None = None, since_ms: int | None = None) -> list[dict[str, Any]]:
    """Fetch trade history from the exchange."""
    all_trades: list[dict[str, Any]] = []

    if symbol:
        symbols = [symbol]
    else:
        await exchange.load_markets()
        symbols = [s for s in exchange.symbols if s.endswith("/USDT")]

    for sym in symbols:
        try:
            trades = await exchange.fetch_my_trades(sym, since=since_ms, limit=1000)
            for trade in trades:
                all_trades.append({
                    "exchange": exchange.id,
                    "symbol": trade["symbol"],
                    "side": trade["side"],
                    "price": trade["price"],
                    "quantity": trade["amount"],
                    "fee": trade.get("fee", {}).get("cost"),
                    "fee_currency": trade.get("fee", {}).get("currency"),
                    "timestamp": trade["datetime"],
                    "order_type": trade.get("type"),
                })
        except Exception:
            continue

    return all_trades
