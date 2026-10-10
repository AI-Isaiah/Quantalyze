"""Phase 170.2 (SC-5) — the benchmark read is driven by the strategy's first date.

WHY these tests exist. ``get_benchmark_returns("BTC")`` used to read
``.limit(days + 1)`` with ``days=1000``, so a strategy older than 1000 days was
paired with only the trailing 1000 days of BTC: alpha, beta, Treynor and R^2
silently lost their history on every recompute. The reader now takes ``since``
(the strategy's first return date) and pages the cache read with a keyset
cursor, because the PostgREST server caps a response at ``max_rows`` (1000) and
answers 200 with the partial body: a read that trusts one page, or stops on a
short page, is the same truncation again.

The clock is pinned to 2026-10-09 00:30 UTC through ``benchmark_mod._utc_now``.
``tests/test_benchmark_refresh.py`` pins 2020-01-02, which is only ~867 days
after ``BTC_FIRST_DAY`` (2017-08-17), so any longer window would be clamped by
the floor there and these tests would measure the floor, not the paging.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any
from unittest.mock import MagicMock, patch

import httpx
import pandas as pd
import pytest

from services import benchmark as benchmark_mod
from tests.test_benchmark_refresh import _FakeTable

_NOW = datetime(2026, 10, 9, 0, 30, tzinfo=timezone.utc)
_TODAY = _NOW.date()
_YESTERDAY = _TODAY - timedelta(days=1)


def _close_for(d: date) -> float:
    """A deterministic close per calendar date, so a re-written row is visible."""
    return 20_000.0 + (d - date(2017, 8, 17)).days


def _seed(table: _FakeTable, first: date, last: date) -> None:
    d = first
    while d <= last:
        table.store[("BTC", d.isoformat())] = _close_for(d)
        d += timedelta(days=1)


@pytest.fixture
def pinned_clock(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(benchmark_mod, "_utc_now", lambda: _NOW)


def _install(monkeypatch: pytest.MonkeyPatch, table: _FakeTable) -> None:
    monkeypatch.setattr(benchmark_mod, "get_supabase", lambda: table)


class _FakeBinance:
    """Stands in for ``fetch_btc_daily_prices``: serves what Binance would for
    a request of ``days`` back from now, never earlier than ``BTC_FIRST_DAY``,
    and records every request. Includes today's partial row, as the real
    source does."""

    def __init__(self, floor: date = date(2017, 8, 17)) -> None:
        self.requested_days: list[int] = []
        self.floor = floor

    async def __call__(self, days: int = 1000) -> pd.Series:
        self.requested_days.append(days)
        # `now - days` at 00:30 falls inside day `today - days`, so the first
        # candle whose open is >= that instant is the next day's.
        first = max(_TODAY - timedelta(days=days) + timedelta(days=1), self.floor)
        dates: list[date] = []
        d = first
        while d <= _TODAY:
            dates.append(d)
            d += timedelta(days=1)
        return pd.Series(
            [_close_for(x) for x in dates],
            index=pd.DatetimeIndex([pd.Timestamp(x) for x in dates]),
            name="BTC",
        )

    @property
    def calls(self) -> int:
        return len(self.requested_days)


class _NoFetch:
    """A fetch stub that fails the test if it is ever awaited."""

    async def __call__(self, days: int = 1000) -> pd.Series:
        raise AssertionError(f"a cache hit must not fetch (asked for {days} days)")


# ── Task 1: the tracer ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_since_covers_the_first_date(
    monkeypatch: pytest.MonkeyPatch, pinned_clock: None
) -> None:
    """A strategy 1400 days old gets a benchmark that starts on or before its
    first return, read from a server that serves at most 1000 rows a request.
    On the old code this served only the trailing 1000 days."""
    table = _FakeTable(max_rows=1000)
    _seed(table, _YESTERDAY - timedelta(days=1499), _YESTERDAY)
    _install(monkeypatch, table)
    monkeypatch.setattr(benchmark_mod, "fetch_btc_daily_prices", _NoFetch())

    since = _YESTERDAY - timedelta(days=1400)
    returns, stale = await benchmark_mod.get_benchmark_returns("BTC", since=since)

    assert stale is False
    assert returns is not None
    assert returns.index.min().date() <= since, (
        f"benchmark starts {returns.index.min().date()}, after the strategy's "
        f"first date {since}: the history was truncated"
    )
    assert len(returns) >= 1400


@pytest.mark.asyncio
async def test_runner_pairs_the_benchmark_over_the_full_history(
    monkeypatch: pytest.MonkeyPatch, pinned_clock: None
) -> None:
    """The CSV runner hands its first return date to the benchmark read, so a
    1300-day strategy is paired over its whole history (SC-5 end to end)."""
    from services.analytics_runner import run_csv_strategy_analytics
    from tests.test_csv_analytics_runner import (
        _make_metrics_result,
        _make_supabase_mock,
    )

    table = _FakeTable(max_rows=1000)
    _seed(table, _YESTERDAY - timedelta(days=1499), _YESTERDAY)
    _install(monkeypatch, table)
    monkeypatch.setattr(benchmark_mod, "fetch_btc_daily_prices", _NoFetch())

    last = _YESTERDAY - timedelta(days=1)
    first = last - timedelta(days=1299)
    rows = [
        {"date": (first + timedelta(days=i)).isoformat(), "daily_return": 0.001 * ((i % 5) - 2)}
        for i in range(1300)
    ]
    sb = _make_supabase_mock(rows)

    real = benchmark_mod.get_benchmark_returns
    seen: dict[str, Any] = {}

    async def spy(*args: Any, **kwargs: Any) -> Any:
        out = await real(*args, **kwargs)
        seen["kwargs"] = kwargs
        seen["returns"] = out[0]
        return out

    with patch("services.analytics_runner.get_supabase", return_value=sb), patch(
        "services.analytics_runner.get_benchmark_returns", new=spy
    ), patch("services.basis_series.compute_all_metrics", return_value=_make_metrics_result()):
        result = await run_csv_strategy_analytics("test-strategy-uuid")

    assert result["status"] == "complete"
    assert seen["kwargs"].get("since") == first, (
        "the runner must pass the strategy's first return date as `since`"
    )
    bench = seen["returns"]
    assert bench is not None
    assert bench.index.min().date() <= first
    assert len(bench) > 1000


# ── Task 2: expansion ──────────────────────────────────────────────────────────


def _selects_with_cursor(table: _FakeTable) -> int:
    return sum(
        1 for _limit, filters in table.requests if any(op == "lt" for op, _c, _v in filters)
    )


@pytest.mark.asyncio
async def test_paged_read_reads_past_max_rows(
    monkeypatch: pytest.MonkeyPatch, pinned_clock: None
) -> None:
    """2500 stored rows behind a 1000-row server cap: a window of 2400 days is
    read in full over several requests and served as a cache hit. A single
    request would have served 1000 rows and a 'hit' of the wrong window."""
    table = _FakeTable(max_rows=1000)
    _seed(table, _YESTERDAY - timedelta(days=2499), _YESTERDAY)
    _install(monkeypatch, table)
    monkeypatch.setattr(benchmark_mod, "fetch_btc_daily_prices", _NoFetch())

    since = _YESTERDAY - timedelta(days=2399)
    returns, stale = await benchmark_mod.get_benchmark_returns("BTC", since=since)

    assert stale is False and returns is not None
    assert returns.index.min().date() == since
    assert len(returns) == 2400
    assert len(table.requests) >= 3, "the window needs at least three 1000-row pages"
    assert _selects_with_cursor(table) == len(table.requests) - 1, (
        "every page after the first must carry the keyset cursor"
    )
    assert table.upserts == [], "a cache hit writes nothing"
    # Independent oracle: the returns are the pct change of the stored closes.
    closes = [_close_for(since - timedelta(days=1) + timedelta(days=i)) for i in range(2401)]
    assert returns.iloc[0] == pytest.approx(closes[1] / closes[0] - 1)
    assert returns.iloc[-1] == pytest.approx(closes[-1] / closes[-2] - 1)


@pytest.mark.asyncio
async def test_a_server_cap_below_the_page_size_is_not_the_end_of_data(
    monkeypatch: pytest.MonkeyPatch, pinned_clock: None
) -> None:
    """A server that serves 400 rows a request makes EVERY page short. Stopping
    on a short page would serve 400 days as the whole cache; the loop must
    keep going until a page holds nothing older than its cursor."""
    table = _FakeTable(max_rows=400)
    _seed(table, _YESTERDAY - timedelta(days=1199), _YESTERDAY)
    _install(monkeypatch, table)
    monkeypatch.setattr(benchmark_mod, "fetch_btc_daily_prices", _NoFetch())

    returns, stale = await benchmark_mod.get_benchmark_returns("BTC")

    assert stale is False and returns is not None
    assert len(returns) == 999
    assert len(table.requests) == 3  # 400 + 400 + 200 (window reached on the third)


@pytest.mark.asyncio
async def test_page_cap_falls_back_to_the_fetch_and_reports(
    monkeypatch: pytest.MonkeyPatch, pinned_clock: None
) -> None:
    """A loop that hits the page cap raises a named RuntimeError into the logged
    non-DB-error path (Sentry capture), and the fetch still answers: the read
    can neither hang nor serve a half-read cache as complete."""
    table = _FakeTable(max_rows=1000)
    _seed(table, _YESTERDAY - timedelta(days=2499), _YESTERDAY)
    _install(monkeypatch, table)
    fetch = _FakeBinance()
    monkeypatch.setattr(benchmark_mod, "fetch_btc_daily_prices", fetch)
    monkeypatch.setattr(benchmark_mod, "_BENCHMARK_MAX_PAGES", 2)
    captured: list[BaseException] = []
    monkeypatch.setattr(benchmark_mod.sentry_sdk, "capture_exception", captured.append)

    since = _YESTERDAY - timedelta(days=2399)
    returns, stale = await benchmark_mod.get_benchmark_returns("BTC", since=since)

    assert len(captured) == 1 and "exceeded 2 pages" in str(captured[0])
    assert fetch.calls == 1
    assert stale is False and returns is not None
    assert returns.index.min().date() == since


@pytest.mark.asyncio
async def test_older_history_miss_backfills_once(
    monkeypatch: pytest.MonkeyPatch, pinned_clock: None
) -> None:
    """The cache starts at D0; the strategy starts 100 days earlier. That is a
    miss, the fetch covers it, ONLY the older dates are written (a cached
    close is the source of record and is never re-written), and the next
    identical call is a hit with no fetch."""
    d0 = _YESTERDAY - timedelta(days=1100)  # older than the 1000-day floor
    table = _FakeTable(max_rows=1000)
    _seed(table, d0, _YESTERDAY)
    # Distinguishable from the fetch's value for the same date: cache wins.
    for key in list(table.store):
        table.store[key] += 0.5
    before = dict(table.store)
    _install(monkeypatch, table)
    fetch = _FakeBinance()
    monkeypatch.setattr(benchmark_mod, "fetch_btc_daily_prices", fetch)

    since = d0 - timedelta(days=100)
    returns, stale = await benchmark_mod.get_benchmark_returns("BTC", since=since)

    assert stale is False and returns is not None
    assert returns.index.min().date() == since
    assert fetch.calls == 1
    written = {row["date"] for payload in table.upserts for row in payload}
    assert written, "the older dates must be written"
    assert all(date.fromisoformat(d) < d0 for d in written), (
        "a date already in the cache was re-written"
    )
    assert len(written) == 101  # since-1 .. d0-1
    for key, value in before.items():
        assert table.store[key] == value, f"cached close {key} was overwritten"

    again, again_stale = await benchmark_mod.get_benchmark_returns("BTC", since=since)
    assert again_stale is False and again is not None
    assert fetch.calls == 1, "the second call must be a cache hit"
    pd.testing.assert_series_equal(again, returns)


class _OtherSourceFetch:
    """Stands in for the fallback source (CoinGecko): the same days as Binance,
    but each close is offset, so a stored Binance close overwritten by this
    source's value is visible. Optionally runs a side effect when awaited."""

    OFFSET = 7.5

    def __init__(self, on_fetch: Any = None) -> None:
        self.calls = 0
        self._on_fetch = on_fetch

    async def __call__(self, days: int = 1000) -> pd.Series:
        self.calls += 1
        if self._on_fetch is not None:
            self._on_fetch()
        first = _TODAY - timedelta(days=days) + timedelta(days=1)
        dates = [first + timedelta(days=i) for i in range((_TODAY - first).days + 1)]
        return pd.Series(
            [_close_for(x) + self.OFFSET for x in dates],
            index=pd.DatetimeIndex([pd.Timestamp(x) for x in dates]),
            name="BTC",
        )


@pytest.mark.asyncio
async def test_failed_cache_read_cannot_overwrite_stored_closes(
    monkeypatch: pytest.MonkeyPatch, pinned_clock: None
) -> None:
    """170.2 review MD-01 / SFH-02. 'The cache wins' used to hold only in
    memory: when the cache READ failed (PostgREST 503, a dropped page), the
    in-call ``by_date`` was empty, every fetched day looked new, and a plain
    upsert (``ON CONFLICT DO UPDATE``) replaced a window of stored Binance
    closes with the fallback source's. The write must be insert-only on its own,
    whatever the read managed to see."""
    days = 30
    table = _FakeTable()
    _seed(table, _YESTERDAY - timedelta(days=days + 5), _YESTERDAY)
    stored = dict(table.store)
    _install(monkeypatch, table)
    table.read_error = httpx.ConnectError("cache read refused")
    fetch = _OtherSourceFetch()
    monkeypatch.setattr(benchmark_mod, "fetch_btc_daily_prices", fetch)

    await benchmark_mod.get_benchmark_returns("BTC", days=days)

    assert fetch.calls == 1, "the failed read must fall through to the fetch"
    assert table.upserts, "the fetched days are still offered to the cache"
    for key, value in stored.items():
        assert table.store[key] == value, (
            f"stored close {key} was overwritten by a fetched one"
        )
    assert all(
        kw["ignore_duplicates"] is True and kw["on_conflict"] == "symbol,date"
        for kw in table.upsert_kwargs
    ), f"the cache write must be ON CONFLICT DO NOTHING, got {table.upsert_kwargs}"


@pytest.mark.asyncio
async def test_concurrent_writer_cannot_be_overwritten(
    monkeypatch: pytest.MonkeyPatch, pinned_clock: None
) -> None:
    """The race variant of MD-01: the cache read sees an EMPTY table (a clean
    miss, not an error), and another job writes the Binance closes while this
    call is fetching. This call's write then meets rows it never saw."""
    days = 30
    table = _FakeTable()
    _install(monkeypatch, table)
    binance = {
        ("BTC", (_YESTERDAY - timedelta(days=i)).isoformat()): _close_for(
            _YESTERDAY - timedelta(days=i)
        )
        for i in range(days + 2)
    }

    def other_job_writes() -> None:
        table.store.update(binance)

    fetch = _OtherSourceFetch(on_fetch=other_job_writes)
    monkeypatch.setattr(benchmark_mod, "fetch_btc_daily_prices", fetch)

    await benchmark_mod.get_benchmark_returns("BTC", days=days)

    assert fetch.calls == 1
    for key, value in binance.items():
        assert table.store[key] == value, f"concurrently stored close {key} was overwritten"


@pytest.mark.asyncio
@pytest.mark.parametrize("since_back", [None, 200])
async def test_since_inside_the_window_is_unchanged(
    monkeypatch: pytest.MonkeyPatch, pinned_clock: None, since_back: int | None
) -> None:
    """No `since`, or one inside the default window, serves exactly the
    trailing 1000 closes even when the cache holds more, and a cold cache asks
    the source for `days + 1`, as before SC-5."""
    since = None if since_back is None else _YESTERDAY - timedelta(days=since_back)

    warm = _FakeTable(max_rows=1000)
    _seed(warm, _YESTERDAY - timedelta(days=1199), _YESTERDAY)
    _install(monkeypatch, warm)
    monkeypatch.setattr(benchmark_mod, "fetch_btc_daily_prices", _NoFetch())
    returns, stale = await benchmark_mod.get_benchmark_returns("BTC", since=since)

    expected = pd.Series(
        [_close_for(_YESTERDAY - timedelta(days=999 - i)) for i in range(1000)]
    ).pct_change().dropna()
    assert stale is False and returns is not None
    assert len(returns) == 999
    assert returns.index.min().date() == _YESTERDAY - timedelta(days=998)
    assert returns.to_numpy() == pytest.approx(expected.to_numpy())

    cold = _FakeTable(max_rows=1000)
    _install(monkeypatch, cold)
    fetch = _FakeBinance()
    monkeypatch.setattr(benchmark_mod, "fetch_btc_daily_prices", fetch)
    cold_returns, cold_stale = await benchmark_mod.get_benchmark_returns("BTC", since=since)
    assert fetch.requested_days == [1001]
    assert cold_stale is False and cold_returns is not None
    assert cold_returns.to_numpy() == pytest.approx(expected.to_numpy())


@pytest.mark.asyncio
async def test_since_before_btc_first_day_is_floored(
    monkeypatch: pytest.MonkeyPatch, pinned_clock: None
) -> None:
    """A `since` older than the first BTCUSDT candle is floored at
    BTC_FIRST_DAY: the source is asked for no more than that day (plus the
    one-day slack every request carries), and the result is still fresh."""
    table = _FakeTable(max_rows=1000)
    _install(monkeypatch, table)
    fetch = _FakeBinance()
    monkeypatch.setattr(benchmark_mod, "fetch_btc_daily_prices", fetch)

    returns, stale = await benchmark_mod.get_benchmark_returns(
        "BTC", since=date(2015, 1, 1)
    )

    assert benchmark_mod.BTC_FIRST_DAY == date(2017, 8, 17)
    assert fetch.requested_days == [(_TODAY - benchmark_mod.BTC_FIRST_DAY).days + 1]
    assert stale is False and returns is not None
    assert returns.index.min().date() == benchmark_mod.BTC_FIRST_DAY + timedelta(days=1)
    stored = sorted(date.fromisoformat(d) for (_s, d) in table.store)
    assert stored[0] == benchmark_mod.BTC_FIRST_DAY
    assert stored[-1] == _YESTERDAY
