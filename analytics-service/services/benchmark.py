import httpx
import pandas as pd
from datetime import datetime, timedelta, timezone
from typing import Any
import logging

from .db import get_supabase, db_execute

logger = logging.getLogger("quantalyze.analytics")


async def fetch_btc_daily_prices(days: int = 1000) -> pd.Series:
    """Fetch BTC daily closing prices. Try Binance first, fall back to CoinGecko."""
    try:
        return await _fetch_from_binance(days)
    except Exception as e:
        logger.warning("Binance fetch failed (may be geo-blocked): %s. Trying CoinGecko.", str(e))
        return await _fetch_from_coingecko(days)


async def _fetch_from_binance(days: int) -> pd.Series:
    """Fetch from Binance public klines API with pagination (1000 candles per request max)."""
    now = datetime.now(timezone.utc)
    end_ms = int(now.timestamp() * 1000)
    start_ms = int((now - timedelta(days=days)).timestamp() * 1000)

    all_candles: list[list[Any]] = []
    cursor_ms = start_ms

    max_pages = 20
    async with httpx.AsyncClient(timeout=30) as client:
        while cursor_ms < end_ms and max_pages > 0:
            max_pages -= 1
            resp = await client.get(
                "https://api.binance.com/api/v3/klines",
                params={
                    "symbol": "BTCUSDT",
                    "interval": "1d",
                    "startTime": cursor_ms,
                    "endTime": end_ms,
                    "limit": 1000,
                },
            )
            resp.raise_for_status()
            batch = resp.json()
            if not batch:
                break
            all_candles.extend(batch)
            new_cursor = int(batch[-1][6]) + 1
            if new_cursor <= cursor_ms:
                break
            cursor_ms = new_cursor

    dates = []
    closes = []
    for candle in all_candles:
        dates.append(pd.Timestamp(candle[0], unit="ms").date())
        closes.append(float(candle[4]))  # Close price

    return pd.Series(closes, index=pd.DatetimeIndex(dates), name="BTC")


async def _fetch_from_coingecko(days: int) -> pd.Series:
    """Fallback: CoinGecko free API (handles US geo-restriction on Binance)."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart",
            params={"vs_currency": "usd", "days": str(days), "interval": "daily"},
        )
        resp.raise_for_status()
        data = resp.json()

    dates = []
    closes = []
    for point in data.get("prices", []):
        dates.append(pd.Timestamp(point[0], unit="ms").date())
        closes.append(float(point[1]))

    return pd.Series(closes, index=pd.DatetimeIndex(dates), name="BTC")


def prices_to_returns(prices: pd.Series) -> pd.Series:
    """Convert daily prices to daily returns."""
    return prices.pct_change().dropna()


async def get_benchmark_returns(symbol: str = "BTC", days: int = 1000) -> pd.Series:
    """Get benchmark daily returns, using cache if available."""
    if symbol != "BTC":
        raise ValueError(f"Unsupported benchmark: {symbol}")

    # Try cache first
    try:
        supabase = get_supabase()
        result = await db_execute(
            lambda: supabase.table("benchmark_prices").select("*").eq(
                "symbol", symbol
            ).order("date", desc=True).limit(days).execute()
        )

        if result.data and len(result.data) > 10:
            df = pd.DataFrame(result.data)
            prices = pd.Series(
                df["close_price"].astype(float).values,
                index=pd.DatetimeIndex(pd.to_datetime(df["date"])),
                name=symbol,
            ).sort_index()
            return prices_to_returns(prices)
    except Exception as e:
        logger.warning("Benchmark cache read failed: %s", str(e))

    # Fetch fresh
    prices = await fetch_btc_daily_prices(days)
    returns = prices_to_returns(prices)

    # Cache for next time
    try:
        supabase = get_supabase()
        rows = [
            {"date": d.strftime("%Y-%m-%d"), "symbol": symbol, "close_price": float(v)}
            for d, v in prices.items()
        ]
        await db_execute(lambda: supabase.table("benchmark_prices").upsert(rows).execute())
    except Exception as e:
        logger.warning("Benchmark cache write failed: %s", str(e))

    return returns
