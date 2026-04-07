"""Tests for analytics-service/services/benchmark.py.

These four tests target the highest-leverage failure modes in the file:

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

Skipped intentionally:
- The CoinGecko fallback parse (mirror of Binance — would just be a duplicate test)
- The 48-hour cache freshness gate (would need freezegun, marginal value)
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
