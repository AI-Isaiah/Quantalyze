"""Tests for analytics-service/scripts/backfill_btc_benchmark.py (Phase 170.2, SC-5).

WHY THE SCRIPT EXISTS
---------------------
PROD's ``benchmark_prices`` cache starts later than the oldest strategy's first
return, so a strategy older than the cache pairs against a truncated benchmark and
loses alpha / beta / Treynor / R-squared history. The script writes the missing
older closes ONCE, through the product's own path
(``get_benchmark_returns("BTC", since=..., require_persist=True)``: fetch, cache-wins
merge, upsert only the new dates), so the consolidated recompute that follows pairs
every strategy over its full history even if Binance is unreachable that day.

WHAT THESE TESTS PROTECT
------------------------
* ``--dry-run`` reads and plans; it NEVER fetches or writes. An operator uses it on
  PROD to see the gap before spending a write.
* The exit code is the operator's only signal on a Railway shell. A result that is
  stale, or whose stored history still starts after the day the oldest strategy's
  first return needs, MUST exit 1: exit 0 there would let the recompute run over a
  benchmark that is still short and look healthy.
* The oldest-return read counts ONLY ``strategy_id``-keyed rows. ``csv_daily_returns``
  also holds per-API-key rows (``strategy_id`` NULL); an older per-key row must not
  pull the backfill target back.
* An unreadable or empty read raises, never prints zero (Rule 12).
* Output is dates and counts only: the script runs against PROD and its output is
  pasted into tracked planning notes in a public repo.

The Supabase client is a small stateful fake (not a call-recording MagicMock) so the
"after" read reflects what the patched ``get_benchmark_returns`` did to the cache.
"""
from __future__ import annotations

import re
from datetime import date, timedelta
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from scripts import backfill_btc_benchmark as bf
from services.benchmark import BenchmarkCacheWriteError, BTC_FIRST_DAY

_CACHE_OLDEST = date(2023, 8, 10)
_CACHE_NEWEST = date(2026, 10, 8)
_FIRST_RETURN = date(2023, 4, 26)


def _days(start: date, end: date) -> list[date]:
    return [start + timedelta(days=i) for i in range((end - start).days + 1)]


class _Not:
    def __init__(self, query: "_Query") -> None:
        self._query = query

    def is_(self, column: str, value: str) -> "_Query":
        self._query.filters.append(("not_is", column, value))
        return self._query


class _Query:
    def __init__(self, client: "_FakeSupabase", table: str) -> None:
        self.client = client
        self.table = table
        self.filters: list[tuple[str, str, Any]] = []
        self.count_mode: str | None = None
        self.desc = False
        self.limit_n: int | None = None
        self.order_col: str | None = None

    @property
    def not_(self) -> _Not:
        return _Not(self)

    def select(self, _cols: str, count: str | None = None) -> "_Query":
        self.count_mode = count
        return self

    def eq(self, column: str, value: Any) -> "_Query":
        self.filters.append(("eq", column, value))
        return self

    def order(self, column: str, desc: bool = False) -> "_Query":
        self.order_col, self.desc = column, desc
        return self

    def limit(self, n: int) -> "_Query":
        self.limit_n = n
        return self

    # A write on any path is recorded so a test can assert none happened.
    def upsert(self, *_a: Any, **_k: Any) -> "_Query":
        self.client.writes.append((self.table, "upsert"))
        return self

    def insert(self, *_a: Any, **_k: Any) -> "_Query":
        self.client.writes.append((self.table, "insert"))
        return self

    def update(self, *_a: Any, **_k: Any) -> "_Query":
        self.client.writes.append((self.table, "update"))
        return self

    def delete(self, *_a: Any, **_k: Any) -> "_Query":
        self.client.writes.append((self.table, "delete"))
        return self

    def execute(self) -> SimpleNamespace:
        if self.table == "csv_daily_returns":
            data = [dict(r) for r in self.client.csv_rows]
            for kind, col, _val in self.filters:
                if kind == "not_is":
                    data = [r for r in data if r.get(col) is not None]
        elif self.table == "benchmark_prices":
            data = [
                {"date": d.isoformat(), "symbol": "BTC", "close_price": 1.0}
                for d in sorted(self.client.bench_dates)
            ]
            for kind, col, val in self.filters:
                if kind == "eq" and col == "symbol":
                    assert val == "BTC"
        else:  # pragma: no cover - the script must read only these two tables
            raise AssertionError(f"unexpected table {self.table}")
        total = len(data)
        if self.order_col:
            data.sort(key=lambda r: str(r[self.order_col]), reverse=self.desc)
        if self.limit_n is not None:
            data = data[: self.limit_n]
        count = total if self.count_mode == "exact" else None
        if self.client.count_none:
            count = None
        return SimpleNamespace(data=data, count=count)


class _FakeSupabase:
    def __init__(
        self,
        *,
        csv_rows: list[dict[str, Any]] | None = None,
        bench_dates: list[date] | None = None,
        count_none: bool = False,
    ) -> None:
        self.csv_rows = (
            csv_rows
            if csv_rows is not None
            else [{"strategy_id": "s-1", "api_key_id": None, "date": _FIRST_RETURN.isoformat()}]
        )
        self.bench_dates = set(
            bench_dates if bench_dates is not None else _days(_CACHE_OLDEST, _CACHE_NEWEST)
        )
        self.count_none = count_none
        self.writes: list[tuple[str, str]] = []

    def table(self, name: str) -> _Query:
        return _Query(self, name)


def _backfilling(fake: _FakeSupabase, *, is_stale: bool = False, reach: date | None = None) -> AsyncMock:
    """A ``get_benchmark_returns`` double that lays older closes into the fake cache.

    ``reach`` is the oldest date the fetch managed to store (None: stored nothing).
    """

    async def _fn(symbol: str, *_a: Any, **kwargs: Any) -> tuple[Any, bool]:
        if reach is not None:
            fake.bench_dates.update(_days(reach, min(fake.bench_dates)))
        return object(), is_stale

    return AsyncMock(side_effect=_fn)


async def _run(
    fake: _FakeSupabase, gbr: AsyncMock, argv: list[str] | None = None
) -> int:
    with patch.object(bf, "get_supabase", return_value=fake), patch.object(
        bf, "get_benchmark_returns", gbr
    ):
        return await bf.main(argv or [])


# --------------------------------------------------------------------------- tracer


async def test_success_fetches_older_history_and_prints_before_and_after(capsys):
    """The tracer: CLI -> reads -> get_benchmark_returns(since) -> re-read -> exit 0."""
    fake = _FakeSupabase()
    gbr = _backfilling(fake, reach=_FIRST_RETURN - timedelta(days=1))

    code = await _run(fake, gbr)

    out = capsys.readouterr().out
    assert code == 0
    # The product path, driven with the oldest strategy return date, persisting loudly.
    gbr.assert_awaited_once()
    assert gbr.await_args.args == ("BTC",)
    assert gbr.await_args.kwargs == {"since": _FIRST_RETURN, "require_persist": True}
    # One before: line and one after: line, each with oldest, newest and row count.
    before = [ln for ln in out.splitlines() if ln.startswith("before:")]
    after = [ln for ln in out.splitlines() if ln.startswith("after:")]
    assert len(before) == 1 and len(after) == 1
    n_before = len(_days(_CACHE_OLDEST, _CACHE_NEWEST))
    assert f"oldest={_CACHE_OLDEST.isoformat()}" in before[0]
    assert f"newest={_CACHE_NEWEST.isoformat()}" in before[0]
    assert f"rows={n_before}" in before[0]
    assert f"oldest={(_FIRST_RETURN - timedelta(days=1)).isoformat()}" in after[0]
    assert f"newest={_CACHE_NEWEST.isoformat()}" in after[0]
    n_after = len(_days(_FIRST_RETURN - timedelta(days=1), _CACHE_NEWEST))
    assert f"rows={n_after}" in after[0]
    # The script itself never writes: the write is get_benchmark_returns' (patched).
    assert fake.writes == []


async def test_dry_run_reads_and_plans_but_neither_fetches_nor_writes(capsys):
    fake = _FakeSupabase()
    gbr = _backfilling(fake, reach=_FIRST_RETURN - timedelta(days=1))

    code = await _run(fake, gbr, ["--dry-run"])

    out = capsys.readouterr().out
    assert code == 0
    gbr.assert_not_awaited()
    assert fake.writes == []
    lines = out.splitlines()
    assert sum(ln.startswith("before:") for ln in lines) == 1
    assert any(ln.startswith("plan:") and f"since={_FIRST_RETURN.isoformat()}" in ln for ln in lines)
    assert not any(ln.startswith("after:") for ln in lines)
    # The cache is exactly as it was.
    assert min(fake.bench_dates) == _CACHE_OLDEST


# ------------------------------------------------------------------ fail-loud exits


async def test_stale_result_exits_1_and_names_the_stored_range(capsys):
    """Binance unreachable from the host: the fallback served the cache flagged stale."""
    fake = _FakeSupabase()
    gbr = _backfilling(fake, is_stale=True, reach=None)

    code = await _run(fake, gbr)

    out = capsys.readouterr().out
    assert code == 1
    assert "STALE" in out
    assert _CACHE_OLDEST.isoformat() in out and _CACHE_NEWEST.isoformat() in out


async def test_fresh_flag_but_history_still_short_exits_1(capsys):
    """A result not flagged stale whose stored oldest date is still too late must fail.

    Exit 0 here would send the recompute over a benchmark that does not reach the
    oldest strategy's first return.
    """
    fake = _FakeSupabase()
    # Reached 2023-04-30, but the oldest strategy needs 2023-04-25.
    gbr = _backfilling(fake, reach=date(2023, 4, 30))

    code = await _run(fake, gbr)

    out = capsys.readouterr().out
    assert code == 1
    assert "short" in out.lower()
    assert "2023-04-25" in out  # the date the history was required to reach


async def test_no_series_returned_exits_1():
    fake = _FakeSupabase()
    gbr = AsyncMock(return_value=(None, True))

    assert await _run(fake, gbr) == 1


async def test_already_covered_cache_exits_0_and_is_idempotent(capsys):
    """Re-running after the backfill: the cache already reaches `since - 1`; exit 0."""
    covered = _days(_FIRST_RETURN - timedelta(days=1), _CACHE_NEWEST)
    fake = _FakeSupabase(bench_dates=covered)
    gbr = _backfilling(fake, reach=None)  # nothing new to store

    code = await _run(fake, gbr)

    assert code == 0
    out = capsys.readouterr().out
    assert out.count("oldest=2023-04-25") == 2  # before: and after: agree
    assert fake.writes == []


async def test_since_before_btc_first_day_requires_only_btc_first_day(capsys):
    """No close exists before BTC_FIRST_DAY; a cache that reaches it is complete."""
    early = BTC_FIRST_DAY
    fake = _FakeSupabase(
        csv_rows=[{"strategy_id": "s-1", "api_key_id": None, "date": BTC_FIRST_DAY.isoformat()}],
        bench_dates=_days(BTC_FIRST_DAY + timedelta(days=30), _CACHE_NEWEST),
    )
    gbr = _backfilling(fake, reach=early)

    assert await _run(fake, gbr) == 0
    assert gbr.await_args.kwargs["since"] == BTC_FIRST_DAY


# ------------------------------------------------------------- reads and overrides


async def test_since_flag_overrides_the_csv_read():
    fake = _FakeSupabase()
    gbr = _backfilling(fake, reach=date(2022, 12, 31))

    code = await _run(fake, gbr, ["--since", "2023-01-01"])

    assert code == 0
    assert gbr.await_args.kwargs["since"] == date(2023, 1, 1)


async def test_oldest_return_ignores_per_key_rows_without_a_strategy_id(capsys):
    """A per-API-key row (strategy_id NULL) older than every strategy row is ignored."""
    fake = _FakeSupabase(
        csv_rows=[
            {"strategy_id": None, "api_key_id": "k-1", "date": "2020-01-01"},
            {"strategy_id": "s-1", "api_key_id": None, "date": "2023-04-26"},
            {"strategy_id": "s-2", "api_key_id": None, "date": "2024-02-02"},
        ]
    )
    gbr = _backfilling(fake, reach=date(2023, 4, 25))

    assert await _run(fake, gbr, ["--dry-run"]) == 0
    assert "since=2023-04-26" in capsys.readouterr().out


async def test_empty_strategy_return_read_raises_instead_of_printing_zero():
    fake = _FakeSupabase(csv_rows=[{"strategy_id": None, "api_key_id": "k-1", "date": "2022-01-01"}])
    gbr = _backfilling(fake)

    with pytest.raises(RuntimeError, match="csv_daily_returns"):
        await _run(fake, gbr)
    gbr.assert_not_awaited()


async def test_empty_benchmark_cache_raises_instead_of_printing_zero():
    fake = _FakeSupabase(bench_dates=[])
    gbr = _backfilling(fake)

    with pytest.raises(RuntimeError, match="benchmark_prices"):
        await _run(fake, gbr)
    gbr.assert_not_awaited()


async def test_unreadable_count_raises():
    fake = _FakeSupabase(count_none=True)
    gbr = _backfilling(fake)

    with pytest.raises(RuntimeError, match="count"):
        await _run(fake, gbr)
    gbr.assert_not_awaited()


async def test_a_failed_cache_write_propagates():
    """require_persist=True makes a lost write loud; the script must not swallow it."""
    fake = _FakeSupabase()
    gbr = AsyncMock(side_effect=BenchmarkCacheWriteError("Benchmark cache write failed: X"))

    with pytest.raises(BenchmarkCacheWriteError):
        await _run(fake, gbr)


async def test_bad_since_value_is_rejected_by_the_parser():
    fake = _FakeSupabase()
    with pytest.raises(SystemExit):
        await _run(fake, _backfilling(fake), ["--since", "not-a-date"])


# ----------------------------------------------------------------- output hygiene


async def test_output_is_dates_and_counts_only(capsys, monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example-project.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_KEY", "service-key-value-0123456789")
    fake = _FakeSupabase(
        csv_rows=[{"strategy_id": "strategy-uuid-aaaa", "api_key_id": None, "date": "2023-04-26"}]
    )
    gbr = _backfilling(fake, reach=date(2023, 4, 25))

    await _run(fake, gbr)

    out = capsys.readouterr().out
    assert "http" not in out
    assert "supabase" not in out.lower()
    assert "service-key-value" not in out
    assert "strategy-uuid" not in out
    # Every printed line is one of the script's own, fixed prefixes.
    for line in out.splitlines():
        assert re.match(r"^(before|plan|after|ok|FAIL):", line), line
