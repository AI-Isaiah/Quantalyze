"""Coverage for services/benchmark.py's HTTP fetch paths.

`httpx.AsyncClient` is replaced by a pair of stubs that return canned
Binance klines / CoinGecko market-chart payloads. This exercises the
Binance happy path, the empty-batch terminator, the cursor-non-advance
terminator, and the CoinGecko fallback triggered when Binance raises.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest


class _FakeResponse:
    def __init__(self, data):
        self._data = data

    def raise_for_status(self) -> None:  # noqa: D401
        return None

    def json(self):
        return self._data


def _recent_binance_page() -> list[list]:
    """Build two daily klines whose close_time advances past start_ms, so
    `_fetch_from_binance` does NOT short-circuit on the stagnant-cursor
    break. Timestamps are anchored to now so days=1 windows cover them."""
    now = datetime.now(timezone.utc)
    ms_now = int(now.timestamp() * 1000)
    day_ms = 24 * 3600 * 1000
    # Close times 12h and 2h before now → within a 1-day window.
    ct1 = ms_now - day_ms // 2
    ct2 = ms_now - 2 * 3600 * 1000
    # Schema: [open_time, open, high, low, close, volume, close_time, ...rest]
    return [
        [ct1 - day_ms, "100", "110", "99", "105", "1000",
         ct1, "100000", 500, "500000", "500000", "0"],
        [ct2 - day_ms, "105", "112", "104", "108", "1100",
         ct2, "118800", 600, "600000", "600000", "0"],
    ]


_COINGECKO_PAYLOAD = {
    "prices": [
        [1704067200000, 105.5],
        [1704153600000, 108.2],
    ]
}


class _BinanceSingleBatchClient:
    """Binance-only stub: first call returns the page, subsequent calls return
    [] so the while-loop terminates via the empty-batch break (line 47)."""

    _calls = 0

    def __init__(self, *args, **kwargs) -> None:
        pass

    async def __aenter__(self) -> "_BinanceSingleBatchClient":
        return self

    async def __aexit__(self, *args) -> None:
        return None

    async def get(self, url: str, params=None):
        _BinanceSingleBatchClient._calls += 1
        if _BinanceSingleBatchClient._calls == 1:
            return _FakeResponse(_recent_binance_page())
        return _FakeResponse([])


class _BinanceStagnantCursorClient:
    """Binance stub whose second page repeats the same close_time — forces
    the `new_cursor <= cursor_ms` terminator (line 52)."""

    _calls = 0

    def __init__(self, *args, **kwargs) -> None:
        pass

    async def __aenter__(self) -> "_BinanceStagnantCursorClient":
        return self

    async def __aexit__(self, *args) -> None:
        return None

    async def get(self, url: str, params=None):
        _BinanceStagnantCursorClient._calls += 1
        return _FakeResponse(_recent_binance_page())


class _CoingeckoClient:
    """CoinGecko-only stub. Binance is never queried in these tests."""

    def __init__(self, *args, **kwargs) -> None:
        pass

    async def __aenter__(self) -> "_CoingeckoClient":
        return self

    async def __aexit__(self, *args) -> None:
        return None

    async def get(self, url: str, params=None):
        return _FakeResponse(_COINGECKO_PAYLOAD)


class _FallbackClient:
    """Binance raises; CoinGecko succeeds. Verifies the except-fallback in
    fetch_btc_daily_prices (lines 14-18)."""

    def __init__(self, *args, **kwargs) -> None:
        pass

    async def __aenter__(self) -> "_FallbackClient":
        return self

    async def __aexit__(self, *args) -> None:
        return None

    async def get(self, url: str, params=None):
        if "binance" in url:
            raise RuntimeError("geo-blocked")
        return _FakeResponse(_COINGECKO_PAYLOAD)


@pytest.mark.asyncio
async def test_fetch_from_binance_single_batch() -> None:
    from services.benchmark import _fetch_from_binance

    _BinanceSingleBatchClient._calls = 0
    with patch("services.benchmark.httpx.AsyncClient", _BinanceSingleBatchClient):
        prices = await _fetch_from_binance(7)

    assert len(prices) == 2
    assert prices.iloc[0] == 105.0
    assert prices.iloc[1] == 108.0


@pytest.mark.asyncio
async def test_fetch_from_binance_breaks_on_stagnant_cursor() -> None:
    from services.benchmark import _fetch_from_binance

    _BinanceStagnantCursorClient._calls = 0
    with patch(
        "services.benchmark.httpx.AsyncClient", _BinanceStagnantCursorClient
    ):
        prices = await _fetch_from_binance(7)

    # Loop exits via the stagnant-cursor break after the second duplicate page
    # (iteration 2 sees new_cursor == cursor_ms → break), not the 20-page cap.
    assert len(prices) == 4
    assert _BinanceStagnantCursorClient._calls == 2


@pytest.mark.asyncio
async def test_fetch_from_coingecko() -> None:
    from services.benchmark import _fetch_from_coingecko

    with patch("services.benchmark.httpx.AsyncClient", _CoingeckoClient):
        prices = await _fetch_from_coingecko(7)

    assert len(prices) == 2
    assert prices.iloc[0] == 105.5


@pytest.mark.asyncio
async def test_fetch_btc_daily_prices_falls_back_to_coingecko() -> None:
    from services.benchmark import fetch_btc_daily_prices

    with patch("services.benchmark.httpx.AsyncClient", _FallbackClient):
        prices = await fetch_btc_daily_prices(7)

    assert len(prices) == 2
    assert prices.iloc[0] == 105.5


@pytest.mark.asyncio
async def test_get_benchmark_returns_rejects_unknown_symbol() -> None:
    from services.benchmark import get_benchmark_returns

    with pytest.raises(ValueError, match="Unsupported benchmark"):
        await get_benchmark_returns(symbol="ETH")


@pytest.mark.asyncio
async def test_get_benchmark_returns_uses_fresh_cache() -> None:
    """Cache-hit branch: supabase returns >10 rows, most recent < 48h old → no
    fresh fetch. Covers services/benchmark.py lines 101-125."""
    import pandas as pd

    from services.benchmark import get_benchmark_returns

    now = datetime.now(timezone.utc)
    cached_rows = [
        {
            "date": (now - timedelta(days=i)).strftime("%Y-%m-%d"),
            "close_price": 100.0 + i,
            "symbol": "BTC",
        }
        for i in range(15)
    ]

    mock_supabase = _build_cache_mock(cached_rows)

    async def _run(fn):
        return fn()

    with patch("services.benchmark.get_supabase", return_value=mock_supabase), \
         patch("services.benchmark.db_execute", side_effect=_run):
        returns, stale = await get_benchmark_returns(days=15)

    assert stale is False
    assert returns is not None
    assert isinstance(returns, pd.Series)
    assert len(returns) > 0


@pytest.mark.asyncio
async def test_get_benchmark_returns_stale_cache_refreshes_from_network() -> None:
    """Cache is old (>48h) → fetch fresh via binance stub, then cache-write
    path runs. Covers lines 113-117 (stale warning) + 132-145 (fresh fetch)."""
    from services.benchmark import get_benchmark_returns

    now = datetime.now(timezone.utc)
    stale_rows = [
        {
            "date": (now - timedelta(days=5 + i)).strftime("%Y-%m-%d"),
            "close_price": 100.0 + i,
            "symbol": "BTC",
        }
        for i in range(15)
    ]

    mock_supabase = _build_cache_mock(stale_rows, writable=True)

    async def _run(fn):
        return fn()

    _BinanceSingleBatchClient._calls = 0
    with patch("services.benchmark.get_supabase", return_value=mock_supabase), \
         patch("services.benchmark.db_execute", side_effect=_run), \
         patch("services.benchmark.httpx.AsyncClient", _BinanceSingleBatchClient):
        returns, stale = await get_benchmark_returns(days=7)

    assert stale is False
    assert returns is not None
    # The upsert cache-write path was taken.
    assert mock_supabase.table.call_args_list, "expected supabase.table() calls"


def _build_cache_mock(rows: list[dict], writable: bool = False):
    """Build a supabase mock whose benchmark_prices.select chain yields `rows`,
    and whose upsert chain (when `writable=True`) accepts a write."""
    from unittest.mock import MagicMock

    mock_supabase = MagicMock()
    mock_table = MagicMock()

    limit_exec = MagicMock()
    limit_exec.execute.return_value = MagicMock(data=rows)
    order_chain = MagicMock()
    order_chain.limit.return_value = limit_exec
    eq_chain = MagicMock()
    eq_chain.order.return_value = order_chain
    select_chain = MagicMock()
    select_chain.eq.return_value = eq_chain
    mock_table.select.return_value = select_chain

    if writable:
        upsert_exec = MagicMock()
        upsert_exec.execute.return_value = MagicMock(data=[])
        mock_table.upsert.return_value = upsert_exec

    mock_supabase.table.return_value = mock_table
    return mock_supabase


def test_prices_to_returns() -> None:
    """Smoke: prices_to_returns drops the first NaN and produces pct-change."""
    import pandas as pd

    from services.benchmark import prices_to_returns

    prices = pd.Series(
        [100.0, 110.0, 121.0],
        index=pd.to_datetime(["2026-01-01", "2026-01-02", "2026-01-03"]),
    )
    returns = prices_to_returns(prices)
    assert len(returns) == 2
    assert returns.iloc[0] == pytest.approx(0.10)
    assert returns.iloc[1] == pytest.approx(0.10)
