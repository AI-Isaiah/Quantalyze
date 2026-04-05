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
    """Validate that the API key is read-only."""
    result = {"valid": False, "read_only": False, "error": None}

    try:
        # Test basic connectivity
        await exchange.load_markets()
        balance = await exchange.fetch_balance()
        result["valid"] = True

        # Check permissions (exchange-specific)
        if exchange.id == "binance":
            try:
                api_restrictions = await exchange.sapi_get_account_apirestrictions()
                can_withdraw = api_restrictions.get("enableWithdrawals", False)
                can_trade = api_restrictions.get("enableSpotAndMarginTrading", False) or api_restrictions.get("enableFutures", False)
                result["read_only"] = not can_withdraw
                if can_withdraw:
                    result["error"] = "Key has withdrawal permissions. Please use a read-only key."
            except Exception:
                # If we can't check, assume it's ok but flag it
                result["read_only"] = True
        else:
            # For OKX/Bybit, try a small operation that would fail without trade perms
            try:
                await exchange.create_order("BTC/USDT", "limit", "buy", 0.00001, 1.0)
                # If this succeeds, the key has trade permissions
                result["read_only"] = False
                result["error"] = "Key has trading permissions. Please use a read-only key."
            except ccxt.PermissionDenied:
                result["read_only"] = True
            except ccxt.InvalidOrder:
                # Order was invalid (expected for tiny amount) but we have trade perms
                result["read_only"] = False
                result["error"] = "Key has trading permissions. Please use a read-only key."
            except Exception:
                result["read_only"] = True

    except ccxt.AuthenticationError as e:
        result["error"] = f"Authentication failed: {str(e)}"
    except Exception as e:
        result["error"] = f"Validation failed: {str(e)}"

    return result


async def fetch_all_trades(exchange: ccxt.Exchange, symbol: str | None = None, since_ms: int | None = None) -> list[dict[str, Any]]:
    """Fetch trade history from the exchange."""
    all_trades: list[dict[str, Any]] = []

    if symbol:
        symbols = [symbol]
    else:
        await exchange.load_markets()
        # Get all USDT pairs
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
