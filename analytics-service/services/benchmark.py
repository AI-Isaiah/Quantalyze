import httpx
import pandas as pd
import sentry_sdk
from datetime import date, datetime, timedelta, timezone
from typing import Any
import logging
import math

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

# Phase 170.2 (SC-2) — the longest `days` CoinGecko's public (free) API answers.
# Measured 2026-10-09: days=365 -> HTTP 200, days=366 -> HTTP 401 with
# error_code 10012 ("limited to querying historical data within the past 365
# days"). The refresh asks for `days + 1` = 1001, so before this clamp ANY
# Binance failure lost the day.
COINGECKO_FREE_MAX_DAYS = 365

# Phase 170.2 (SC-5) — the first BTCUSDT daily candle Binance serves (measured
# 2026-10-09). No close exists before it, so a `since` older than this is
# floored here rather than asked of Binance.
BTC_FIRST_DAY = date(2017, 8, 17)

# Phase 170.2 (SC-5) — the cache read pages `benchmark_prices` newest-first by a
# keyset cursor. PostgREST caps a response at its `max_rows` (1000 on this
# project) and answers 200 with the partial body, so one request can never be
# trusted to hold a window and a SHORT page proves nothing about the end of
# data. 20 pages x 1000 rows is ~55 years of daily closes: a loop that reaches
# it is a bug, raised loud (it falls back to the fetch like any non-DB error).
_BENCHMARK_PAGE_SIZE = 1000
_BENCHMARK_MAX_PAGES = 20


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
    """Fallback: CoinGecko free API (handles US geo-restriction on Binance).

    Phase 170.2 (SC-2). The request is clamped to `COINGECKO_FREE_MAX_DAYS`, so
    this returns at most the last 365 days: the caller merges it with the
    cached history rather than expecting it to span the whole window.

    The body is untrusted (it becomes a stored close): a point is kept only if
    it is a `[ms, price]` pair stamped on a whole UTC day with a finite,
    positive price. The intraday "now" point CoinGecko appends is not a close
    and is dropped.
    """
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.get(
            "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart",
            params={
                "vs_currency": "usd",
                "days": str(min(days, COINGECKO_FREE_MAX_DAYS)),
                "interval": "daily",
            },
        )
        resp.raise_for_status()
        data = resp.json()

    dates = []
    closes = []
    for point in data.get("prices", []):
        if not isinstance(point, (list, tuple)) or len(point) < 2:
            continue
        try:
            ms = int(point[0])
            price = float(point[1])
        except (TypeError, ValueError, OverflowError):
            continue
        if ms % 86_400_000 != 0:
            continue  # the intraday "now" point: a partial day, not a close
        if not math.isfinite(price) or price <= 0:
            continue
        # A `D 00:00 UTC` stamp is the price at the START of day D, which is
        # Binance's close of day D-1 (measured 2026-10-09: same-date pairing
        # off by up to 2.6 percent, shifted pairing by about 0.05 percent).
        # CoinGecko publishes it at 00:10 UTC. Store it under D-1, the date
        # Binance would have used, so the two sources agree in the cache.
        dates.append((pd.Timestamp(ms, unit="ms") - pd.Timedelta(days=1)).date())
        closes.append(price)

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


class BenchmarkCacheWriteError(Exception):
    """The fresh prices could not be written to ``benchmark_prices``.

    Raised ONLY by ``get_benchmark_returns(..., require_persist=True)``, the
    mode the scheduled refresh uses (``routers.cron.benchmark_refresh``,
    review-fix round 2, REVIEW WR-02). The original error is chained as
    ``__cause__``. The message carries its type only, because an upstream or
    PostgREST message can carry URLs or response fragments.
    """


def _cache_miss_reason(
    cached_dates: list[date],
    *,
    days: int,
    yesterday: date,
    window_start: date | None = None,
) -> str | None:
    """Why the cached completed days cannot answer a request for ``days`` of
    them, or None when they can (review-fix round 1, MEDIUM-5 and MEDIUM-6).

    The newest ``days`` cached dates must be a contiguous run of calendar days
    ending on yesterday or later. BTC trades every day, so a missing date is a
    gap in the cache, not a closed market. A cache that is short or has gaps
    counts as a miss, and a fresh fetch fills it.

    Phase 170.2 (SC-5): when ``window_start`` is given the window is a date
    range, not a count. The contiguous run ending at the newest cached date
    must end on yesterday or later and reach back to ``window_start``; that is
    how a ``since`` older than the cache's oldest stored date becomes a miss.
    """
    if window_start is not None:
        run = _contiguous_run_ending_at_newest({d: 0.0 for d in cached_dates})
        if not run:
            return f"no completed days cached, window starts {window_start}"
        if run[-1] < yesterday:
            return f"newest completed day cached is {run[-1]}, needs {yesterday}"
        if run[0] > window_start:
            return (
                f"contiguous run starts {run[0]}, window starts {window_start}"
            )
        return None
    window = sorted(cached_dates)[-days:]
    if len(window) < days:
        return f"{len(window)} completed days cached, {days} requested"
    if window[-1] < yesterday:
        return f"newest completed day cached is {window[-1]}, needs {yesterday}"
    if (window[-1] - window[0]).days != days - 1:
        return f"gaps between {window[0]} and {window[-1]}"
    return None


def _series_for(window: list[date], by_date: dict[date, float], name: str) -> pd.Series:
    """The closes for ``window`` (oldest first) as a daily price series."""
    return pd.Series(
        [by_date[d] for d in window],
        index=pd.DatetimeIndex([pd.Timestamp(d) for d in window]),
        name=name,
    )


def _contiguous_run_ending_at_newest(by_date: dict[date, float]) -> list[date]:
    """Phase 170.2 (SC-2) — the maximal run of consecutive calendar days that
    ends at the newest date in ``by_date``, oldest first ([] when empty). BTC
    trades every day, so a missing date is a gap in the series, not a closed
    market; nothing older than a gap is served as part of the same window."""
    ordered = sorted(by_date)
    if not ordered:
        return []
    run = [ordered[-1]]
    for d in reversed(ordered[:-1]):
        if (run[-1] - d).days != 1:
            break
        run.append(d)
    run.reverse()
    return run


def prices_to_returns(prices: pd.Series) -> pd.Series:
    """Convert daily prices to daily returns."""
    return prices.pct_change().dropna()


async def get_benchmark_returns(
    symbol: str = "BTC",
    days: int = 1000,
    *,
    since: date | None = None,
    require_persist: bool = False,
) -> tuple[pd.Series | None, bool]:
    """Get benchmark daily returns, using cache if available.

    Returns (returns_series, is_stale) where is_stale=True means benchmark data
    could not be refreshed and should be flagged in data_quality_flags.

    ``since`` (Phase 170.2, SC-5): the date of the strategy's first return. The
    window then starts at ``min(yesterday - (days - 1), since - 1 day)``,
    floored at ``BTC_FIRST_DAY``: the return dated ``since`` needs the close of
    the day before it. ``days`` stays a floor, so ``since=None`` (or a ``since``
    inside the default window) reads exactly the trailing ``days`` closes as
    before. A ``since`` older than the cache's oldest stored date is a cache
    miss; the fetch covers it and only the new older dates are written.

    ``require_persist`` (review-fix round 2, REVIEW WR-02): by default a failed
    cache write after a fresh fetch is logged at warning level and the fresh
    series is still returned, because an analytics compute can use it either
    way. The scheduled refresh exists to MAKE the write, so it passes
    ``require_persist=True``, and then a failed write (including an
    unconfigured client) raises ``BenchmarkCacheWriteError`` instead of being
    swallowed. A cache HIT writes nothing and is unaffected by the flag.
    """
    if symbol != "BTC":
        raise ValueError(f"Unsupported benchmark: {symbol}")

    # Only COMPLETED UTC days are ever served or cached: today's row is a
    # partial-day close (review-fix round 1, MEDIUM-5).
    today = _utc_today()
    yesterday = today - timedelta(days=1)

    # Phase 170.2 (SC-5): the window is a date range driven by `since`, with
    # `days` as its floor. The return dated `since` needs the close of
    # `since - 1`. No close exists before `BTC_FIRST_DAY`.
    window_start = yesterday - timedelta(days=days - 1)
    if since is not None:
        window_start = min(window_start, since - timedelta(days=1))
    window_start = max(window_start, BTC_FIRST_DAY)

    # Try cache first. It answers only with a contiguous run of completed days
    # from `window_start` to yesterday or later (`_cache_miss_reason`); anything
    # less is a miss. What it read is kept (`by_date`) for the stale fallback
    # below.
    by_date: dict[date, float] = {}
    try:
        supabase = _benchmark_client()
        if supabase is None:
            raise _CacheUnavailable()
        # Keyset-paged, newest first (see `_BENCHMARK_PAGE_SIZE`). Page 1 is
        # the plain chain; later pages add `.lt("date", cursor)`. The loop ends
        # when a page holds no row strictly older than the cursor (end of data;
        # never raised, so a fixed-data double cannot loop), or once the oldest
        # date read reaches `window_start`. NEVER on a short page: a server cap
        # below the page size makes every page short.
        cursor: str | None = None
        for _page in range(_BENCHMARK_MAX_PAGES):
            def _read_page(before: str | None = cursor) -> Any:
                query = supabase.table("benchmark_prices").select("*").eq(
                    "symbol", symbol
                )
                if before is not None:
                    query = query.lt("date", before)
                return query.order("date", desc=True).limit(
                    _BENCHMARK_PAGE_SIZE
                ).execute()

            batch = rows(await db_execute(_read_page))
            older = [
                row for row in batch
                if cursor is None or str(row["date"])[:10] < cursor
            ]
            if not older:
                break
            for row in older:
                # A row for today (cached before the completed-days rule) is
                # dropped here, so it can neither be served nor count as fresh.
                if str(row["date"])[:10] < today.isoformat():
                    by_date[date.fromisoformat(str(row["date"])[:10])] = float(
                        row["close_price"]
                    )
            cursor = min(str(row["date"])[:10] for row in older)
            if date.fromisoformat(cursor) <= window_start:
                break
        else:
            raise RuntimeError(
                f"benchmark_prices read exceeded {_BENCHMARK_MAX_PAGES} pages "
                "without reaching the window start"
            )
        miss_reason = _cache_miss_reason(
            list(by_date), days=days, yesterday=yesterday, window_start=window_start
        )
        if miss_reason is None:
            window = [d for d in sorted(by_date) if d >= window_start]
            return prices_to_returns(_series_for(window, by_date, symbol)), False
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
        # `+ 1`: a daily source's window can start the day after `now - days`,
        # and today's partial row is dropped, so asking for one extra day
        # keeps every completed day from `window_start`, enough for the next
        # cache read to be a hit. With `since=None` this is `days + 1`.
        fetch_days = (today - window_start).days + 1
        fetched = _completed_days_only(await fetch_btc_daily_prices(fetch_days), today)
        if fetched.empty:
            # A source that answered with no completed day is a failed source:
            # the existing all-sources-failed path below owns it.
            raise ValueError("benchmark source returned no completed days")

        # Phase 170.2 (SC-2) — merge with the cache, the cache wins. The
        # fallback source can only span 365 days (`COINGECKO_FREE_MAX_DAYS`),
        # so the window is the fetched days laid over the cached history. A
        # cached close is the source of record (Binance's): it is never
        # re-written with a fetched one, only dates ABSENT from the cache are
        # written. In memory that is the ``to_write`` filter; in the database
        # it is ``ON CONFLICT DO NOTHING`` (review MD-01), so the invariant
        # holds even when this call's cache read failed or was partial, or a
        # concurrent job wrote the same dates while this one was fetching. A
        # day missed while every source was down is therefore written by the
        # next run, whose window still covers it.
        fetched_by_date = {ts.date(): float(v) for ts, v in fetched.items()}
        merged = {**fetched_by_date, **by_date}
        to_write = {d: v for d, v in fetched_by_date.items() if d not in by_date}

        # Cache for next time (nothing to write is not a write failure)
        if to_write:
            try:
                supabase = get_supabase()
                cache_rows = [
                    {"date": d.strftime("%Y-%m-%d"), "symbol": symbol, "close_price": v}
                    for d, v in sorted(to_write.items())
                ]
                # (symbol, date) is the table's primary key. Insert-only: an
                # existing close is never replaced (``ignore_duplicates`` is
                # ``ON CONFLICT DO NOTHING``), whatever ``by_date`` saw.
                await db_execute(
                    lambda: supabase.table("benchmark_prices")
                    .upsert(cache_rows, on_conflict="symbol,date", ignore_duplicates=True)
                    .execute()
                )
            except Exception as e:
                if require_persist:
                    raise BenchmarkCacheWriteError(
                        f"Benchmark cache write failed: {type(e).__name__}"
                    ) from e
                logger.warning("Benchmark cache write failed: %s", str(e))

        # Fresh only when the merged run reaches yesterday AND spans the whole
        # requested window; anything shorter (a cold cache, a fallback that
        # cannot span the window) is served flagged stale, never as fresh.
        run = _contiguous_run_ending_at_newest(merged)
        if run[-1] == yesterday and run[0] <= window_start:
            window = [d for d in run if d >= window_start]
            return prices_to_returns(_series_for(window, merged, symbol)), False
        logger.warning(
            "Benchmark window not covered: contiguous run %s to %s, needs %s to %s. "
            "Serving it flagged stale.",
            run[0], run[-1], window_start, yesterday,
        )
        return prices_to_returns(_series_for(run, merged, symbol)), True
    except BenchmarkCacheWriteError:
        # Not a source failure: the fetch succeeded. Must not fall into the
        # stale-cache fallback below, which would hide the lost write.
        raise
    except Exception as e:
        # Round-2 review (reviewer #4) — never None while a recent enough
        # completed-day cache is in hand: serve it, flagged stale.
        fallback = _stale_cache_fallback(
            by_date,
            days=max(days, (yesterday - window_start).days + 1),
            now=_utc_now(),
        )
        if fallback is not None:
            logger.warning(
                "All benchmark sources failed: %s. Serving the cached completed "
                "days (newest %s), flagged stale.",
                str(e), fallback.index.max().date().isoformat(),
            )
            return prices_to_returns(fallback), True
        logger.warning("All benchmark sources failed: %s. Returning None.", str(e))
        return None, True


# Phase 164.6.6.2 (D-18, D-23). The ONE price window the BTC-native -> USD
# conversion reads, in BOTH runtimes: the stored `benchmark_prices` closes and
# nothing else. TypeScript `readBtcCloses` (src/lib/factsheet/benchmark-source.ts)
# reads the same rows and does NOT merge the bundled BTC_DAILY fixture (the
# analytics image cannot ship that file), and the shared oracle fixture
# `tests/fixtures/native_to_usd_oracle.json` pins this string as `closes_source`.
BTC_CLOSES_SOURCE = "benchmark_prices only"

_BTC_CLOSES_PAGE_SIZE = 1000
_BTC_CLOSES_MAX_PAGES = 50


async def get_btc_closes() -> pd.Series | None:
    """Every stored BTC close, ascending, for the native -> USD conversion.

    The Python twin of TypeScript ``readBtcCloses``: DB-only (``benchmark_prices``
    for ``BTC``), every stored row with a usable close, no completed-day trimming
    and no bundled-fixture prefix. A close that is not finite or not positive is
    dropped (it cannot price a return, and the conversion treats its date as
    missing, never as bridged). Paged by a keyset on ``date`` newest first,
    strictly decreasing across pages.

    Returns None when there is no price source: the read failed (logged), or no
    stored close is usable. The caller converts a BTC leg to an empty series then;
    nothing is fabricated.
    """
    try:
        supabase = _benchmark_client()
        if supabase is None:
            return None  # already logged by `_benchmark_client`
        found: dict[date, float] = {}
        before: str | None = None
        for page in range(_BTC_CLOSES_MAX_PAGES):
            def _page(cursor: str | None = before) -> Any:
                query = supabase.table("benchmark_prices").select(
                    "date, close_price"
                ).eq("symbol", "BTC")
                if cursor is not None:
                    query = query.lt("date", cursor)
                return query.order("date", desc=True).limit(_BTC_CLOSES_PAGE_SIZE).execute()

            batch = rows(await db_execute(_page))
            if not batch:
                break
            for row in batch:
                day = str(row["date"])[:10]
                if before is not None and not day < before:
                    raise RuntimeError(
                        f"benchmark_prices page {page + 1} returned {day}, "
                        f"not strictly older than {before}"
                    )
                before = day
                try:
                    close = float(row["close_price"])
                except (TypeError, ValueError):
                    continue
                if close > 0 and close < float("inf"):
                    found[date.fromisoformat(day)] = close
        else:
            raise RuntimeError(
                f"benchmark_prices read exceeded {_BTC_CLOSES_MAX_PAGES} pages "
                "without an empty page"
            )
    except _CACHE_READ_ERRORS as e:
        logger.warning("BTC closes read failed: %s", str(e))
        return None
    except Exception as e:  # noqa: BLE001 — a programming error: loud, then no price source
        logger.error(
            "BTC closes read raised a non-DB error (%s); no price source.",
            type(e).__name__,
            exc_info=True,
        )
        sentry_sdk.capture_exception(e)
        return None

    if not found:
        return None
    ordered = sorted(found)
    return pd.Series(
        [found[d] for d in ordered],
        index=pd.DatetimeIndex([pd.Timestamp(d) for d in ordered]),
        name="BTC",
        dtype=float,
    )
