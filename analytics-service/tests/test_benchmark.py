"""Tests for analytics-service/services/benchmark.py.

These tests target the highest-leverage failure modes in the file:

1. The pure-math function `prices_to_returns` — small but it's the foundation
   of every Sharpe number on every factsheet. A regression here is invisible
   in normal use but corrupts everything downstream.

2. The Binance kline parser — guards `candle[4]` (the close price index),
   the most critical magic number in the file. If anyone reorders the
   indices or Binance changes their response shape, this catches it before
   the wrong number ships to an LP.

3. The unsupported-symbol guard — proves the ValueError fires.

4. The all-sources-fail escape hatch — proves the function returns
   (None, True) instead of raising when both data sources are down. This
   is the contract that lets factsheet code degrade gracefully.

5. The fresh-cache hit — proves a fresh cache is served without a refetch.

6. Completed days only (review-fix round 1, MEDIUM-5) — today's UTC row is a
   partial-day close: it is never served from the cache, never cached after a
   fetch, and never counts as fresh.

Skipped intentionally:
- The CoinGecko fallback parse (mirror of Binance — would just be a duplicate test)
- The 48-hour cache freshness gate (would need freezegun, marginal value).
  Superseded: the freshness rule is now "newest completed day >= yesterday",
  tested below with `_utc_today` patched to a fixed synthetic date.
- The cache-write round trip (mock-on-mock, low value)
- httpx pagination loop internals (testing the mock, not the code)
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pandas as pd
import pytest

from services.benchmark import (
    _fetch_from_binance,
    get_benchmark_returns,
    prices_to_returns,
)


def test_prices_to_returns_pct_change():
    """The pure-math function. 100 → 110 → 121 means 10% then 10%, with
    the first NaN dropped. This catches any regression where someone
    'optimizes' pct_change into manual diff math and gets the formula wrong.
    """
    prices = pd.Series(
        [100.0, 110.0, 121.0],
        index=pd.DatetimeIndex(["2026-04-01", "2026-04-02", "2026-04-03"]),
    )
    returns = prices_to_returns(prices)

    assert len(returns) == 2  # First NaN dropped
    assert returns.iloc[0] == pytest.approx(0.10)
    assert returns.iloc[1] == pytest.approx(0.10)
    # Index alignment: returns should be on the second and third dates
    assert returns.index[0] == pd.Timestamp("2026-04-02")
    assert returns.index[1] == pd.Timestamp("2026-04-03")


@pytest.mark.asyncio
async def test_binance_kline_parse_extracts_close_price():
    """THE test that guards candle[4] (close price index).

    A Binance kline has 12 fields per candle. Index 0 is open time (ms),
    index 4 is close price (string). If anyone refactors the parser,
    miscounts the indices, or Binance changes their response shape,
    factsheets silently report the wrong number. This test catches all
    of those.

    We patch httpx.AsyncClient with an AsyncMock that returns a
    hand-built kline. The kline has unique values at each index so a
    field-offset bug in the parser would produce a clearly wrong result.
    """
    # Build a kline with distinctive values: open=1.0, high=2.0, low=3.0,
    # close=12345.67, volume=5.0, close_time_ms = open_time_ms + 86_400_000
    open_time_ms = 1_700_000_000_000  # 2023-11-14T22:13:20Z (arbitrary)
    close_time_ms = open_time_ms + 86_400_000
    kline = [
        open_time_ms,
        "1.0",
        "2.0",
        "3.0",
        "12345.67",  # ← close price (index 4)
        "5.0",
        close_time_ms,
        "0",  # quote asset volume
        0,    # trades
        "0",  # taker buy base
        "0",  # taker buy quote
        "0",  # ignore
    ]

    # Mock the httpx response. AsyncClient is used as an async context
    # manager, so we need __aenter__/__aexit__.
    mock_response = MagicMock()
    mock_response.json.return_value = [kline]
    mock_response.raise_for_status = MagicMock()

    mock_client = MagicMock()
    mock_client.get = AsyncMock(return_value=mock_response)
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)

    with patch("services.benchmark.httpx.AsyncClient", return_value=mock_client):
        result = await _fetch_from_binance(days=1)

    assert len(result) == 1
    assert result.iloc[0] == pytest.approx(12345.67)
    # Index is the date from open_time_ms
    expected_date = pd.Timestamp(open_time_ms, unit="ms").date()
    assert result.index[0].date() == expected_date


@pytest.mark.asyncio
async def test_get_benchmark_returns_rejects_unsupported_symbol():
    """Only BTC is supported. Anything else must raise ValueError."""
    with pytest.raises(ValueError, match="Unsupported benchmark"):
        await get_benchmark_returns(symbol="ETH")


@pytest.mark.asyncio
async def test_get_benchmark_returns_returns_none_when_all_sources_fail():
    """The escape hatch contract: when the cache read fails AND the fresh
    fetch fails, return (None, True) so factsheet code can show 'stale'
    instead of crashing.

    We patch get_supabase to raise (cache read fails) and
    fetch_btc_daily_prices to also raise (fresh fetch fails). The function
    should fall through to the bottom error path and return (None, True).
    """
    with patch(
        "services.benchmark.get_supabase",
        side_effect=RuntimeError("cache unavailable"),
    ), patch(
        "services.benchmark.fetch_btc_daily_prices",
        side_effect=RuntimeError("network down"),
    ):
        result, is_stale = await get_benchmark_returns(symbol="BTC", days=30)

    assert result is None
    assert is_stale is True


@pytest.mark.asyncio
async def test_get_benchmark_returns_serves_a_fresh_cache_without_fetching():
    """A fresh cache (more than 10 rows, newest under 48 h old) must be SERVED,
    not refetched.

    Why this matters: from v0.35.0.4 until this test existed, the cache-read
    branch called the imported ``rows()`` helper while the same function later
    bound a LOCAL ``rows`` list. Python then treats ``rows`` as local for the
    whole function, so every cache read raised UnboundLocalError, the broad
    ``except`` swallowed it as "cache read failed", and every compute
    refetched Binance klines. Nothing failed loud; the cache was simply never
    used. This test asserts the observable contract: no network fetch, and the
    returns come from the cached closes.
    """
    today = pd.Timestamp.now(tz="UTC").normalize().tz_localize(None)
    # Completed days only, newest yesterday: today's row is a partial-day close
    # and is never served (review-fix round 1, MEDIUM-5).
    cached = [
        {
            "date": (today - pd.Timedelta(days=i + 1)).strftime("%Y-%m-%d"),
            "symbol": "BTC",
            "close_price": 100.0 + (30 - i),
        }
        # All 30 requested days: a shorter cache is a miss (MEDIUM-6).
        for i in range(30)
    ]
    result = MagicMock()
    result.data = cached
    fetch = AsyncMock(side_effect=AssertionError("fresh cache must not refetch"))

    with patch("services.benchmark.get_supabase", return_value=MagicMock()), patch(
        "services.benchmark.db_execute", AsyncMock(return_value=result)
    ), patch("services.benchmark.fetch_btc_daily_prices", fetch):
        returns, is_stale = await get_benchmark_returns(symbol="BTC", days=30)

    fetch.assert_not_awaited()
    assert is_stale is False
    assert returns is not None
    assert len(returns) == 29
    # Oldest close is 101, next is 102: the first return is 1/101.
    assert returns.iloc[0] == pytest.approx(1 / 101)


# ---------------------------------------------------------------------------
# Review-fix round 1 (MEDIUM-5) — today's UTC row is a partial-day close.
# `_utc_today` is patched to a fixed synthetic date so the tests never depend
# on the wall clock.
# ---------------------------------------------------------------------------

_TODAY = pd.Timestamp("2026-07-12")
_PARTIAL_CLOSE = 1_000_000_000.0  # absurd on purpose: a leak is unmissable


def _cache_rows(days_back: list[int], *, today_close: float | None = None) -> list[dict]:
    out = [
        {
            "date": (_TODAY - pd.Timedelta(days=d)).strftime("%Y-%m-%d"),
            "symbol": "BTC",
            "close_price": 100.0 + (100 - d),
        }
        for d in days_back
    ]
    if today_close is not None:
        out.insert(0, {"date": _TODAY.strftime("%Y-%m-%d"), "symbol": "BTC", "close_price": today_close})
    return out


async def _run_sync(fn):
    return fn()


@pytest.mark.asyncio
async def test_todays_partial_close_is_never_served_from_the_cache():
    cached = _cache_rows(list(range(1, 21)), today_close=_PARTIAL_CLOSE)
    supabase = MagicMock()
    supabase.table.return_value.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value = MagicMock(
        data=cached
    )
    fetch = AsyncMock(side_effect=AssertionError("a fresh cache must not refetch"))

    with patch("services.benchmark._utc_today", return_value=_TODAY.date()), patch(
        "services.benchmark.get_supabase", return_value=supabase
    ), patch("services.benchmark.db_execute", side_effect=_run_sync), patch(
        "services.benchmark.fetch_btc_daily_prices", fetch
    ):
        returns, is_stale = await get_benchmark_returns(symbol="BTC", days=20)

    fetch.assert_not_awaited()
    assert is_stale is False and returns is not None
    assert returns.index.max() < _TODAY, "today's partial-day row was served"
    assert returns.abs().max() < 1.0, "the partial-day close leaked into the returns"


@pytest.mark.asyncio
async def test_a_cache_without_yesterday_is_stale_even_with_a_row_for_today():
    """Freshness is the newest COMPLETED day. A cache holding today's partial
    row but not yesterday's close is stale and is refetched."""
    cached = _cache_rows(list(range(2, 22)), today_close=_PARTIAL_CLOSE)
    supabase = MagicMock()
    supabase.table.return_value.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value = MagicMock(
        data=cached
    )
    fresh = pd.Series(
        [100.0 + i for i in range(20)],
        index=pd.DatetimeIndex([_TODAY - pd.Timedelta(days=20 - i) for i in range(20)]),
        name="BTC",
    )
    fetch = AsyncMock(return_value=fresh)

    with patch("services.benchmark._utc_today", return_value=_TODAY.date()), patch(
        "services.benchmark.get_supabase", return_value=supabase
    ), patch("services.benchmark.db_execute", side_effect=_run_sync), patch(
        "services.benchmark.fetch_btc_daily_prices", fetch
    ):
        returns, is_stale = await get_benchmark_returns(symbol="BTC", days=20)

    fetch.assert_awaited_once()
    assert is_stale is False and returns is not None


@pytest.mark.asyncio
async def test_todays_partial_close_is_never_cached_or_served_after_a_fetch():
    supabase = MagicMock()
    supabase.table.return_value.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value = MagicMock(
        data=[]
    )
    fetched = pd.Series(
        [100.0 + i for i in range(20)] + [_PARTIAL_CLOSE],
        index=pd.DatetimeIndex(
            [_TODAY - pd.Timedelta(days=20 - i) for i in range(20)] + [_TODAY]
        ),
        name="BTC",
    )

    with patch("services.benchmark._utc_today", return_value=_TODAY.date()), patch(
        "services.benchmark.get_supabase", return_value=supabase
    ), patch("services.benchmark.db_execute", side_effect=_run_sync), patch(
        "services.benchmark.fetch_btc_daily_prices", AsyncMock(return_value=fetched)
    ):
        returns, is_stale = await get_benchmark_returns(symbol="BTC", days=20)

    assert is_stale is False and returns is not None
    assert returns.index.max() < _TODAY, "today's partial-day row was served"
    upserted = supabase.table.return_value.upsert.call_args.args[0]
    assert upserted, "the completed days must still be cached"
    assert all(r["date"] < _TODAY.strftime("%Y-%m-%d") for r in upserted), (
        "today's partial-day close was written to the cache"
    )


# ---------------------------------------------------------------------------
# Review-fix round 1 (MEDIUM-6) — a cache that does not span the requested
# days is a miss, and only DB/network errors pass quietly.
# ---------------------------------------------------------------------------


def _fresh_series(n: int) -> pd.Series:
    return pd.Series(
        [100.0 + i for i in range(n)],
        index=pd.DatetimeIndex([_TODAY - pd.Timedelta(days=n - i) for i in range(n)]),
        name="BTC",
    )


def _supabase_returning(cached: list[dict]) -> MagicMock:
    supabase = MagicMock()
    supabase.table.return_value.select.return_value.eq.return_value.order.return_value.limit.return_value.execute.return_value = MagicMock(
        data=cached
    )
    return supabase


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "days_back",
    [
        pytest.param([d for d in range(1, 22) if d != 7], id="a-gap-inside-the-window"),
        pytest.param(list(range(1, 16)), id="shorter-than-the-requested-days"),
        pytest.param([1, 5, 10, 20], id="sparse-rows-spanning-the-full-window"),
    ],
)
async def test_a_cache_that_does_not_span_the_requested_days_is_a_miss(days_back):
    """Before this rule, any fresh cache of more than 10 rows was served, so
    returns built across a missing day (one "daily" return spanning two days)
    or over a shorter window than asked for reached the factsheet."""
    fetch = AsyncMock(return_value=_fresh_series(21))

    with patch("services.benchmark._utc_today", return_value=_TODAY.date()), patch(
        "services.benchmark.get_supabase", return_value=_supabase_returning(_cache_rows(days_back))
    ), patch("services.benchmark.db_execute", side_effect=_run_sync), patch(
        "services.benchmark.fetch_btc_daily_prices", fetch
    ):
        returns, is_stale = await get_benchmark_returns(symbol="BTC", days=20)

    fetch.assert_awaited_once()
    assert is_stale is False and returns is not None


@pytest.mark.asyncio
async def test_a_programming_error_in_the_cache_read_is_loud():
    """A non-DB error in the cache read (the UnboundLocalError class that hid
    the cache for months) falls back to a fetch, but at error level with a
    Sentry capture, never as a quiet "cache read failed"."""
    fetch = AsyncMock(return_value=_fresh_series(21))
    bug = TypeError("synthetic programming error")

    with patch("services.benchmark._utc_today", return_value=_TODAY.date()), patch(
        "services.benchmark.get_supabase", return_value=MagicMock()
    ), patch("services.benchmark.db_execute", AsyncMock(side_effect=[bug, None])), patch(
        "services.benchmark.fetch_btc_daily_prices", fetch
    ), patch("services.benchmark.sentry_sdk.capture_exception") as capture, patch(
        "services.benchmark.logger"
    ) as log:
        returns, _ = await get_benchmark_returns(symbol="BTC", days=20)

    capture.assert_called_once_with(bug)
    assert log.error.called, "a programming error must log at error level"
    fetch.assert_awaited_once()
    assert returns is not None


@pytest.mark.asyncio
async def test_a_db_error_in_the_cache_read_stays_a_quiet_fallback():
    """Control: a DB-side failure is an expected miss, a warning, no Sentry."""
    fetch = AsyncMock(return_value=_fresh_series(21))

    with patch("services.benchmark._utc_today", return_value=_TODAY.date()), patch(
        "services.benchmark.get_supabase", return_value=MagicMock()
    ), patch(
        "services.benchmark.db_execute",
        AsyncMock(side_effect=[RuntimeError("db pool saturated"), None]),
    ), patch("services.benchmark.fetch_btc_daily_prices", fetch), patch(
        "services.benchmark.sentry_sdk.capture_exception"
    ) as capture:
        returns, _ = await get_benchmark_returns(symbol="BTC", days=20)

    capture.assert_not_called()
    fetch.assert_awaited_once()
    assert returns is not None
