import httpx
import pandas as pd
import sentry_sdk
from datetime import date, datetime, timedelta, timezone
from typing import Any
import logging

from postgrest.exceptions import APIError

from .db import get_supabase, db_execute, rows

logger = logging.getLogger("quantalyze.analytics")

# Review-fix round 1 (MEDIUM-6), narrowed in round 2 (SFH LOW-7) — the
# failures a benchmark CACHE READ may meet and still fall back to a fresh fetch
# quietly: a PostgREST error, and a transport or timeout error. Anything else
# (a KeyError, a TypeError, an UnboundLocalError, a RuntimeError) is a
# programming or infrastructure error. It still falls back to the fetch, but at
# error level with a Sentry capture, so a broken cache can never again pass as
# a miss.
#
# `RuntimeError` was in this tuple, justified by two raises. `get_supabase`'s
# "not configured" raise is now caught at that one call (`_benchmark_client`).
# The other, "`db_execute` raises it when its thread pool is saturated", is not
# how `ThreadPoolExecutor` behaves: it queues without bound and raises
# RuntimeError only after shutdown, which is not an expected cache miss. A bare
# `RuntimeError` here would also have swallowed any library bug that raises
# one.
_CACHE_READ_ERRORS: tuple[type[BaseException], ...] = (
    APIError,
    httpx.HTTPError,
    OSError,
)

# Round-2 review (reviewer #4) — how old the newest cached completed day may be
# (measured from its UTC midnight) and still be served, flagged stale, when the
# fresh fetch fails. 48 h is the freshness bound this cache used before round 1.
_STALE_FALLBACK_MAX_AGE = timedelta(hours=48)


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


def _utc_now() -> datetime:
    """The one wall-clock read in this module, so tests can pin it."""
    return datetime.now(timezone.utc)


def _utc_today() -> date:
    """Today's UTC date: the day whose daily close does not exist yet."""
    return _utc_now().date()


def _benchmark_client() -> Any:
    """The Supabase client, or None when the service is not configured.

    Catches ONLY `get_supabase`'s own "not configured" RuntimeError, so an
    unconfigured cache is a quiet miss and nothing else is swallowed."""
    try:
        return get_supabase()
    except RuntimeError as e:
        logger.warning("Benchmark cache unavailable: %s", str(e))
        return None


def _stale_cache_fallback(
    by_date: dict[date, float], *, days: int, now: datetime
) -> pd.Series | None:
    """Round-2 review (reviewer #4) — the completed days the cache read already
    returned, as prices, when the newest is at most `_STALE_FALLBACK_MAX_AGE`
    old; else None. Served only when the fresh fetch failed, and always
    flagged stale by the caller."""
    if len(by_date) < 2:
        return None
    newest = max(by_date)
    newest_midnight = datetime(newest.year, newest.month, newest.day, tzinfo=timezone.utc)
    if now - newest_midnight > _STALE_FALLBACK_MAX_AGE:
        return None
    window = sorted(by_date)[-days:]
    return pd.Series(
        [by_date[d] for d in window],
        index=pd.DatetimeIndex([pd.Timestamp(d) for d in window]),
        name="BTC",
    )


def _completed_days_only(prices: pd.Series, today: date) -> pd.Series:
    """Drop the row for ``today`` (and anything later). A daily source's row for
    the current UTC day is the price so far, a partial-day close, not a close.
    It is never cached or served (review-fix round 1, MEDIUM-5)."""
    return prices[prices.index < pd.Timestamp(today)]


class _CacheUnavailable(Exception):
    """Internal: the cache client is not configured (already logged)."""


def _cache_miss_reason(
    cached_dates: list[date], *, days: int, yesterday: date
) -> str | None:
    """Why the cached completed days cannot answer a request for ``days`` of
    them, or None when they can (review-fix round 1, MEDIUM-5 and MEDIUM-6).

    The newest ``days`` cached dates must be a contiguous run of calendar days
    ending on yesterday or later. BTC trades every day, so a missing date is a
    gap in the cache, not a closed market. A cache that is short or has gaps
    counts as a miss, and a fresh fetch fills it.
    """
    window = sorted(cached_dates)[-days:]
    if len(window) < days:
        return f"{len(window)} completed days cached, {days} requested"
    if window[-1] < yesterday:
        return f"newest completed day cached is {window[-1]}, needs {yesterday}"
    if (window[-1] - window[0]).days != days - 1:
        return f"gaps between {window[0]} and {window[-1]}"
    return None


def prices_to_returns(prices: pd.Series) -> pd.Series:
    """Convert daily prices to daily returns."""
    return prices.pct_change().dropna()


async def get_benchmark_returns(
    symbol: str = "BTC", days: int = 1000
) -> tuple[pd.Series | None, bool]:
    """Get benchmark daily returns, using cache if available.

    Returns (returns_series, is_stale) where is_stale=True means benchmark data
    could not be refreshed and should be flagged in data_quality_flags.
    """
    if symbol != "BTC":
        raise ValueError(f"Unsupported benchmark: {symbol}")

    # Only COMPLETED UTC days are ever served or cached: today's row is a
    # partial-day close (review-fix round 1, MEDIUM-5).
    today = _utc_today()
    yesterday = today - timedelta(days=1)

    # Try cache first. It answers only with `days` contiguous completed days
    # ending yesterday or later (`_cache_miss_reason`); anything less is a miss.
    # What it read is kept (`by_date`) for the stale fallback below.
    by_date: dict[date, float] = {}
    try:
        supabase = _benchmark_client()
        if supabase is None:
            raise _CacheUnavailable()
        # `days + 1`: one extra row, so a row for today cached before the
        # completed-days rule cannot push the window one day short.
        result = await db_execute(
            lambda: supabase.table("benchmark_prices").select("*").eq(
                "symbol", symbol
            ).order("date", desc=True).limit(days + 1).execute()
        )
        # A row for today (cached before this rule existed) is dropped here, so
        # it can neither be served nor count as fresh.
        by_date = {
            date.fromisoformat(str(row["date"])[:10]): float(row["close_price"])
            for row in rows(result)
            if str(row["date"])[:10] < today.isoformat()
        }
        miss_reason = _cache_miss_reason(list(by_date), days=days, yesterday=yesterday)
        if miss_reason is None:
            window = sorted(by_date)[-days:]
            prices = pd.Series(
                [by_date[d] for d in window],
                index=pd.DatetimeIndex([pd.Timestamp(d) for d in window]),
                name=symbol,
            )
            return prices_to_returns(prices), False
        logger.info("Benchmark cache miss (%s). Fetching fresh data.", miss_reason)
    except _CacheUnavailable:
        pass  # already logged by `_benchmark_client`
    except _CACHE_READ_ERRORS as e:
        logger.warning("Benchmark cache read failed: %s", str(e))
    except Exception as e:  # noqa: BLE001 — a programming error: loud, then fall back
        logger.error(
            "Benchmark cache read raised a non-DB error (%s); fetching fresh data.",
            type(e).__name__,
            exc_info=True,
        )
        sentry_sdk.capture_exception(e)

    # Fetch fresh
    try:
        # `days + 1`: a daily source's window can start the day after
        # `now - days`, and today's partial row is dropped, so asking for one
        # extra day keeps at least `days` completed days, enough for the next
        # cache read to be a hit.
        prices = _completed_days_only(await fetch_btc_daily_prices(days + 1), today)
        returns = prices_to_returns(prices)

        # Cache for next time
        try:
            supabase = get_supabase()
            cache_rows = [
                {"date": d.strftime("%Y-%m-%d"), "symbol": symbol, "close_price": float(v)}
                for d, v in prices.items()
            ]
            await db_execute(lambda: supabase.table("benchmark_prices").upsert(cache_rows).execute())
        except Exception as e:
            logger.warning("Benchmark cache write failed: %s", str(e))

        return returns, False
    except Exception as e:
        # Round-2 review (reviewer #4) — never None while a recent enough
        # completed-day cache is in hand: serve it, flagged stale.
        fallback = _stale_cache_fallback(by_date, days=days, now=_utc_now())
        if fallback is not None:
            logger.warning(
                "All benchmark sources failed: %s. Serving the cached completed "
                "days (newest %s), flagged stale.",
                str(e), fallback.index.max().date().isoformat(),
            )
            return prices_to_returns(fallback), True
        logger.warning("All benchmark sources failed: %s. Returning None.", str(e))
        return None, True
