"""Tests for POST /api/benchmark-refresh (analytics-service/routers/cron.py).

Phase 169.2 / plan 01 (SC3, D-08). The daily Vercel cron (plan 169.2-02) calls
this endpoint to refresh the BTC benchmark cache through the ONE existing
fetcher, ``services.benchmark.get_benchmark_returns``. Nothing refreshed that
cache on a schedule before, so the benchmark went stale silently.

WHY the status assertions are exact:

* A refresh that produced no current series (``None``, a stale series, an
  exception) must answer NON-2xx, because the cron runner only alarms on a
  non-2xx (RESEARCH Pitfall 5). A 200 with a stale body would read green.
* It must answer exactly 500 and NEVER 503 (W2): in the TypeScript seam's
  status table only a 503 records a breaker failure, and that breaker is
  shared by every analytics call. One stale upstream price must not be able
  to trip it. The ``!= 503`` assertions are separate so a neuter that flips
  the status to 503 reddens a line that names the reason.

``get_benchmark_returns`` is patched where ``routers.cron`` looks it up: no
network, no database. Router-logic cases run against a bare app; the
service-key case drives the real ``main.app`` middleware stack, mirroring the
split in ``tests/test_prober_cadence_alert.py``.

Review-fix round 1 (REVIEW CR-01 / WR-01, SFH CR-01 / HR-01): a 200 must
prove the TABLE moved, not that the fetcher returned. ``get_benchmark_returns``
swallows a failed cache upsert and still returns ``(series, False)``, and its
fresh-fetch arm never compares the series to the calendar. So the handler
re-reads the newest stored completed BTC day and answers 500 unless it is at
least yesterday (UTC), and reports ``through`` from that row. Every test here
therefore installs an in-memory ``benchmark_prices`` table (``_FakeTable``) at
both places the code looks the client up; the real-path cases run the real
``get_benchmark_returns`` with only the upstream fetch patched.
"""

from __future__ import annotations

import asyncio
import re
from collections.abc import Iterator
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import httpx
import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers import cron as cron_mod
from services import benchmark as benchmark_mod

ROUTE = "/api/benchmark-refresh"


# Review-fix round 2 (REVIEW IN-02): the clock is PINNED, through the one
# wall-clock read ``services.benchmark._utc_now`` that both the fetcher and the
# handler use, so no case can flip across 00:00 UTC. The pin is in the PAST on
# purpose: a handler that read ``datetime.now`` instead would compute a
# yesterday years after every seeded row and answer 500 on every 200 case, so
# the pin itself proves the handler reads the pinnable clock.
_NOW = datetime(2020, 1, 2, 0, 10, tzinfo=timezone.utc)
_TODAY = _NOW.date()


def _yesterday() -> date:
    return _TODAY - timedelta(days=1)


def _returns_ending(last: date, n: int = 3) -> pd.Series:
    idx = pd.DatetimeIndex(
        [pd.Timestamp(last - timedelta(days=n - 1 - i)) for i in range(n)]
    )
    return pd.Series([0.01, -0.02, 0.03][:n], index=idx, name="BTC")


def _prices_ending(last: date, n: int = 6) -> pd.Series:
    """Upstream daily closes ending on ``last``, plus a partial row for today
    (which the real fetcher drops before caching)."""
    days = [last - timedelta(days=n - 1 - i) for i in range(n)]
    if last < _TODAY:
        days.append(_TODAY)
    idx = pd.DatetimeIndex([pd.Timestamp(d) for d in days])
    return pd.Series(
        [40_000.0 + 100.0 * i for i in range(len(days))], index=idx, name="BTC"
    )


class _Resp:
    def __init__(self, data: list[dict[str, Any]]) -> None:
        self.data = data


class _Query:
    """The two PostgREST chains the refresh path uses, over an in-memory table:
    ``select/eq/lt/order/limit/execute`` and ``upsert/execute``. A chain method
    this fake does not implement raises AttributeError, so a new query shape
    cannot silently read as a pass."""

    def __init__(self, table: "_FakeTable") -> None:
        self._t = table
        self._filters: list[tuple[str, str, Any]] = []
        self._desc = False
        self._limit: int | None = None
        self._upsert: list[dict[str, Any]] | None = None

    def select(self, _cols: str) -> "_Query":
        return self

    def eq(self, col: str, val: Any) -> "_Query":
        self._filters.append(("eq", col, val))
        return self

    def lt(self, col: str, val: Any) -> "_Query":
        self._filters.append(("lt", col, val))
        return self

    def order(self, _col: str, desc: bool = False) -> "_Query":
        self._desc = desc
        return self

    def limit(self, n: int) -> "_Query":
        self._limit = n
        return self

    def upsert(self, payload: list[dict[str, Any]]) -> "_Query":
        self._upsert = payload
        return self

    def execute(self) -> _Resp:
        if self._upsert is not None:
            if self._t.upsert_error is not None:
                raise self._t.upsert_error
            for r in self._upsert:
                self._t.store[(r["symbol"], r["date"])] = float(r["close_price"])
            return _Resp(list(self._upsert))
        out = [
            {"symbol": s, "date": d, "close_price": c}
            for (s, d), c in self._t.store.items()
        ]
        for op, col, val in self._filters:
            if op == "eq":
                out = [r for r in out if r[col] == val]
            else:
                out = [r for r in out if r[col] < val]
        out.sort(key=lambda r: r["date"], reverse=self._desc)
        if self._limit is not None:
            out = out[: self._limit]
        return _Resp(out)


class _FakeTable:
    """An in-memory ``benchmark_prices`` behind a Supabase-client-shaped object."""

    def __init__(self) -> None:
        self.store: dict[tuple[str, str], float] = {}
        self.upsert_error: BaseException | None = None

    def seed_through(self, last: date, n: int = 5) -> None:
        for i in range(n):
            d = last - timedelta(days=i)
            self.store[("BTC", d.isoformat())] = 50_000.0 + i

    def newest(self) -> str | None:
        dates = [d for (s, d) in self.store if s == "BTC"]
        return max(dates) if dates else None

    def table(self, name: str) -> _Query:
        assert name == "benchmark_prices", name
        return _Query(self)


@pytest.fixture
def table(monkeypatch: pytest.MonkeyPatch) -> _FakeTable:
    """Rows through yesterday by default, installed where the handler reads the
    table (``routers.cron.get_supabase``) and where the real fetcher reads and
    writes it (``services.benchmark.get_supabase``)."""
    monkeypatch.setattr(benchmark_mod, "_utc_now", lambda: _NOW)
    fake = _FakeTable()
    fake.seed_through(_yesterday())
    monkeypatch.setattr(cron_mod, "get_supabase", lambda: fake)
    monkeypatch.setattr(benchmark_mod, "get_supabase", lambda: fake)
    return fake


@pytest.fixture
def client(table: _FakeTable) -> Iterator[TestClient]:
    app = FastAPI()
    app.include_router(cron_mod.router)
    yield TestClient(app, raise_server_exceptions=False)


def _patch(monkeypatch: pytest.MonkeyPatch, **kwargs: Any) -> AsyncMock:
    mock = AsyncMock(**kwargs)
    monkeypatch.setattr(cron_mod, "get_benchmark_returns", mock, raising=False)
    return mock


def test_current_series_answers_200_with_through(client, monkeypatch):
    yesterday = _yesterday()
    mock = _patch(monkeypatch, return_value=(_returns_ending(yesterday), False))

    resp = client.post(ROUTE)

    assert resp.status_code == 200
    assert resp.json() == {
        "symbol": "BTC",
        "through": yesterday.isoformat(),
        "stale": False,
        "points": 3,
    }
    mock.assert_awaited_once()
    assert mock.await_args.args[0] == "BTC"
    # REVIEW WR-02: the refresh is the one caller that must see a failed write.
    assert mock.await_args.kwargs["require_persist"] is True


def test_none_refresh_answers_exactly_500(client, monkeypatch):
    _patch(monkeypatch, return_value=(None, True))

    resp = client.post(ROUTE)

    assert resp.status_code == 500
    assert "benchmark refresh" in resp.text.lower()
    # No series detail leaks: the body names the failure, nothing else.
    assert "points" not in resp.text


def test_none_refresh_is_never_503(client, monkeypatch):
    """W2: a 503 would record a failure on the breaker every analytics call reads."""
    _patch(monkeypatch, return_value=(None, True))

    resp = client.post(ROUTE)

    assert resp.status_code != 503


def test_stale_series_answers_exactly_500_and_names_through(client, monkeypatch):
    stale_through = _yesterday() - timedelta(days=4)
    _patch(monkeypatch, return_value=(_returns_ending(stale_through), True))

    resp = client.post(ROUTE)

    assert resp.status_code == 500
    assert resp.status_code != 503
    # The operator sees HOW stale from the alarm itself.
    assert stale_through.isoformat() in resp.text


def test_empty_series_answers_exactly_500(client, monkeypatch):
    empty = pd.Series([], index=pd.DatetimeIndex([]), dtype=float, name="BTC")
    _patch(monkeypatch, return_value=(empty, False))

    resp = client.post(ROUTE)

    assert resp.status_code == 500


def test_failure_arms_answer_the_error_contract_envelope(client, monkeypatch):
    """Every failure arm goes through ``service_error``, never a raw 500.

    A raw ``HTTPException(500)`` skips the contract's ``_validate`` and answers a
    bare ``{"detail": "<string>"}``, which ``test_raw_5xx_census.py`` forbids.
    The envelope must say ``retryable: false`` (R-1: the cron's retry is
    tomorrow's run) and name NO dependency, so the TypeScript budget row's
    ``dependencies: []`` stays true and no breaker key can be minted.
    """
    stale_through = _yesterday() - timedelta(days=4)
    arms = {
        "no series": {"return_value": (None, True)},
        "stale": {"return_value": (_returns_ending(stale_through), True)},
        "raised": {"side_effect": RuntimeError("boom")},
    }
    for label, kwargs in arms.items():
        _patch(monkeypatch, **kwargs)

        resp = client.post(ROUTE)

        assert resp.status_code == 500, (label, resp.text)
        envelope = resp.json()["detail"]
        assert envelope["code"] == "BENCHMARK_REFRESH_FAILED", (label, envelope)
        assert envelope["retryable"] is False, (label, envelope)
        assert envelope["dependency"] is None, (label, envelope)
        assert envelope["detail"].startswith("Benchmark refresh"), (label, envelope)


def test_exception_answers_exactly_500_logged_by_type_only(client, monkeypatch, caplog):
    secret_detail = "upstream said: sensitive-detail-canary"
    raised = RuntimeError(secret_detail)
    _patch(monkeypatch, side_effect=raised)
    # REVIEW IN-04 / SFH MD-02: the log line and the response stay type-only,
    # but the exception itself (with its stack) goes to Sentry, where
    # `sentry_init`'s redacting `before_send` applies. Without the capture the
    # daily alarm says only "RuntimeError".
    capture = MagicMock()
    monkeypatch.setattr(cron_mod.sentry_sdk, "capture_exception", capture)

    with caplog.at_level("ERROR", logger="quantalyze.analytics"):
        resp = client.post(ROUTE)

    assert resp.status_code == 500
    assert resp.status_code != 503
    assert "sensitive-detail-canary" not in resp.text
    messages = [r.getMessage() for r in caplog.records if r.levelname == "ERROR"]
    assert any("RuntimeError" in m for m in messages), messages
    assert not any("sensitive-detail-canary" in m for m in messages), messages
    capture.assert_called_once_with(raised)


# --- Review-fix round 1: the 200 must be proven by the TABLE ----------------


def test_through_is_reported_from_the_table_not_the_series(client, monkeypatch, table):
    """A current in-memory series is not a refresh: the handler reports what the
    table holds. Here the series ends yesterday but the table stops 3 days
    earlier (the write was lost), so the answer is 500 naming the stored day."""
    table.store.clear()
    stored = _yesterday() - timedelta(days=3)
    table.seed_through(stored)
    _patch(monkeypatch, return_value=(_returns_ending(_yesterday()), False))

    resp = client.post(ROUTE)

    assert resp.status_code == 500, resp.text
    assert resp.status_code != 503
    assert stored.isoformat() in resp.text


def test_failed_upsert_through_the_real_fetcher_answers_500(client, monkeypatch, table):
    """REVIEW CR-01 / SFH CR-01, end to end through the REAL
    ``get_benchmark_returns``: the upstream fetch succeeds, the cache upsert
    raises, the fetcher swallows it at warning level and returns
    ``(series, False)``. The table never moved, so the cron must NOT read
    green. Before the fix this answered 200 with ``through`` = yesterday.

    Since review-fix round 2 (REVIEW WR-02) the refresh passes
    ``require_persist=True``, so the lost write is named directly
    (``BenchmarkCacheWriteError``) before the table read-back is reached. The
    read-back itself stays pinned by
    ``test_through_is_reported_from_the_table_not_the_series``."""
    table.store.clear()
    stored = _yesterday() - timedelta(days=3)
    table.seed_through(stored)
    table.upsert_error = RuntimeError("permission denied for table benchmark_prices")
    monkeypatch.setattr(
        benchmark_mod,
        "fetch_btc_daily_prices",
        AsyncMock(return_value=_prices_ending(_yesterday())),
    )

    resp = client.post(ROUTE)

    assert resp.status_code == 500, resp.text
    assert resp.status_code != 503
    assert "BenchmarkCacheWriteError" in resp.text
    assert table.newest() == stored.isoformat()


def test_successful_upsert_through_the_real_fetcher_answers_200(client, monkeypatch, table):
    """The control for the case above: same fetch, the upsert lands, so the
    table reaches yesterday and ``through`` is read back from it."""
    table.store.clear()
    table.seed_through(_yesterday() - timedelta(days=3))
    monkeypatch.setattr(
        benchmark_mod,
        "fetch_btc_daily_prices",
        AsyncMock(return_value=_prices_ending(_yesterday())),
    )

    resp = client.post(ROUTE)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["through"] == _yesterday().isoformat()
    assert body["stale"] is False
    assert body["symbol"] == "BTC"
    assert table.newest() == _yesterday().isoformat()


def test_fetch_ending_before_yesterday_answers_500(client, monkeypatch, table):
    """REVIEW WR-01 / SFH HR-01: the fetcher's fresh arm returns ``is_stale=False``
    for whatever the upstream sent. A lagging upstream whose newest completed
    day is the day before yesterday is written, but it is not a current
    benchmark, so the cron must page."""
    table.store.clear()
    lagging = _yesterday() - timedelta(days=1)
    monkeypatch.setattr(
        benchmark_mod,
        "fetch_btc_daily_prices",
        AsyncMock(return_value=_prices_ending(lagging)),
    )

    resp = client.post(ROUTE)

    assert resp.status_code == 500, resp.text
    assert resp.status_code != 503
    assert lagging.isoformat() in resp.text
    # The lagging rows DID land: this is a freshness failure, not a write one.
    assert table.newest() == lagging.isoformat()


def test_a_row_for_today_does_not_count_as_fresh(client, monkeypatch, table):
    """Only COMPLETED UTC days count (the fetcher's own rule,
    ``_completed_days_only``). A partial-day row for today must not satisfy the
    freshness check when yesterday is missing."""
    table.store.clear()
    today = _yesterday() + timedelta(days=1)
    table.seed_through(_yesterday() - timedelta(days=2))
    table.store[("BTC", today.isoformat())] = 60_000.0
    _patch(monkeypatch, return_value=(_returns_ending(_yesterday()), False))

    resp = client.post(ROUTE)

    assert resp.status_code == 500, resp.text
    # The read picked the newest COMPLETED day, not today's partial row.
    assert (_yesterday() - timedelta(days=2)).isoformat() in resp.text


def test_empty_table_answers_500(client, monkeypatch, table):
    table.store.clear()
    _patch(monkeypatch, return_value=(_returns_ending(_yesterday()), False))

    resp = client.post(ROUTE)

    assert resp.status_code == 500, resp.text
    assert resp.status_code != 503


def test_table_read_failure_answers_500_type_only_and_captured(client, monkeypatch, caplog):
    """The verification read itself failing (not configured, PostgREST error,
    transport) must page as a 500 too, type-only, with a Sentry capture."""
    _patch(monkeypatch, return_value=(_returns_ending(_yesterday()), False))
    raised = RuntimeError("Supabase not configured: read-canary")

    def _boom() -> Any:
        raise raised

    monkeypatch.setattr(cron_mod, "get_supabase", _boom)
    capture = MagicMock()
    monkeypatch.setattr(cron_mod.sentry_sdk, "capture_exception", capture)

    with caplog.at_level("ERROR", logger="quantalyze.analytics"):
        resp = client.post(ROUTE)

    assert resp.status_code == 500, resp.text
    assert resp.status_code != 503
    assert "read-canary" not in resp.text
    messages = [r.getMessage() for r in caplog.records if r.levelname == "ERROR"]
    assert any("RuntimeError" in m for m in messages), messages
    assert not any("read-canary" in m for m in messages), messages
    capture.assert_called_once_with(raised)


# --- Review-fix round 2 --------------------------------------------------------


def _seed_with_gap(table: _FakeTable, *, days: int = 1000) -> str:
    """``days + 1`` calendar days through yesterday with ONE middle day removed:
    the newest ``days`` rows then span ``days`` calendar days, so
    ``_cache_miss_reason`` reports a GAP (not too few rows, not a stale newest
    day). Returns the removed date."""
    table.store.clear()
    table.seed_through(_yesterday(), n=days + 1)
    hole = (_yesterday() - timedelta(days=days // 2)).isoformat()
    del table.store[("BTC", hole)]
    return hole


def test_gap_refetch_with_failed_upsert_answers_500(client, monkeypatch, table, caplog):
    """REVIEW WR-02. The newest stored day is ALREADY yesterday, so the table
    read-back alone reads green. The cache has a mid-window gap, so the fetcher
    refetches; the upsert that would fill the gap fails. Before the fix the
    fetcher swallowed that at warning level and the refresh answered 200 while
    the gap stayed in the table."""
    hole = _seed_with_gap(table)
    assert benchmark_mod._cache_miss_reason(
        [date.fromisoformat(d) for (_s, d) in table.store],
        days=1000,
        yesterday=_yesterday(),
    ).startswith("gaps between"), "precondition: the cache miss must be the GAP arm"
    raised = RuntimeError("permission denied: write-canary")
    table.upsert_error = raised
    monkeypatch.setattr(
        benchmark_mod,
        "fetch_btc_daily_prices",
        AsyncMock(return_value=_prices_ending(_yesterday(), n=1001)),
    )
    capture = MagicMock()
    monkeypatch.setattr(cron_mod.sentry_sdk, "capture_exception", capture)

    with caplog.at_level("ERROR", logger="quantalyze.analytics"):
        resp = client.post(ROUTE)

    assert resp.status_code == 500, resp.text
    assert resp.status_code != 503
    assert "BenchmarkCacheWriteError" in resp.text
    assert "write-canary" not in resp.text
    assert not any("write-canary" in r.getMessage() for r in caplog.records)
    # The newest day was current all along and the hole is still there: this
    # is a persist failure, not a freshness one.
    assert table.newest() == _yesterday().isoformat()
    assert ("BTC", hole) not in table.store
    capture.assert_called_once()
    sent = capture.call_args.args[0]
    assert isinstance(sent, benchmark_mod.BenchmarkCacheWriteError)
    assert sent.__cause__ is raised


def test_too_few_rows_refetch_with_failed_upsert_answers_500(client, monkeypatch, table):
    """REVIEW WR-02, the other miss arm: the default fixture holds 5 rows
    through yesterday, far fewer than the 1000-day window, so the fetcher
    refetches; its write fails, and the refresh must page."""
    table.upsert_error = RuntimeError("write failed")
    monkeypatch.setattr(
        benchmark_mod,
        "fetch_btc_daily_prices",
        AsyncMock(return_value=_prices_ending(_yesterday())),
    )

    resp = client.post(ROUTE)

    assert resp.status_code == 500, resp.text
    assert resp.status_code != 503
    # Tied to its cause (SFH LW-R3-03): the lost write, not any other 500.
    assert "BenchmarkCacheWriteError" in resp.text
    assert table.newest() == _yesterday().isoformat()


@pytest.mark.asyncio
async def test_other_callers_keep_the_lenient_write(monkeypatch, table):
    """``require_persist`` defaults to False: an analytics compute still gets
    the fresh series when the cache write fails (its pre-phase behaviour)."""
    table.upsert_error = RuntimeError("write failed")
    monkeypatch.setattr(
        benchmark_mod,
        "fetch_btc_daily_prices",
        AsyncMock(return_value=_prices_ending(_yesterday())),
    )

    series, is_stale = await benchmark_mod.get_benchmark_returns("BTC")

    assert series is not None and not series.empty
    assert is_stale is False


def test_refresh_past_its_deadline_answers_500_and_captures(client, monkeypatch, caplog):
    """REVIEW IN-01: a refresh that outlives its deadline is a 500 (never a
    503), logged and captured like the other failure arms, so the service
    answers before the TypeScript seam gives up on it."""
    monkeypatch.setattr(cron_mod, "_BENCHMARK_REFRESH_DEADLINE_S", 0.05)

    async def _hangs(*_a: Any, **_k: Any) -> Any:
        await asyncio.sleep(5)
        return _returns_ending(_yesterday()), False

    _patch(monkeypatch, side_effect=_hangs)
    capture = MagicMock()
    monkeypatch.setattr(cron_mod.sentry_sdk, "capture_exception", capture)

    with caplog.at_level("ERROR", logger="quantalyze.analytics"):
        resp = client.post(ROUTE)

    assert resp.status_code == 500, resp.text
    assert resp.status_code != 503
    assert "deadline" in resp.text
    assert any("deadline" in r.getMessage() for r in caplog.records)
    capture.assert_called_once()
    assert isinstance(capture.call_args.args[0], TimeoutError)


def test_deadline_sits_below_the_typescript_seam_budget():
    """REVIEW IN-01: the deadline only helps if the service answers BEFORE the
    TypeScript seam aborts. Read ``SEAM_BUDGETS["benchmark-refresh"].timeoutMs``
    from ``src/lib/resilient-fetch.ts`` by symbol (never a restated number) and
    require at least 10 s of margin for the network hop."""
    source = (
        Path(__file__).resolve().parents[2] / "src" / "lib" / "resilient-fetch.ts"
    ).read_text(encoding="utf-8")
    match = re.search(r'"benchmark-refresh":\s*\{\s*timeoutMs:\s*([\d_]+)', source)
    assert match, 'SEAM_BUDGETS["benchmark-refresh"].timeoutMs not found'
    budget_ms = int(match.group(1).replace("_", ""))
    deadline_ms = cron_mod._BENCHMARK_REFRESH_DEADLINE_S * 1000
    assert 0 < deadline_ms <= budget_ms - 10_000, (deadline_ms, budget_ms)


def test_today_is_read_once_before_the_fetch(client, monkeypatch, table):
    """REVIEW IN-02: a run that crosses 00:00 UTC while the fetch is in flight
    must judge freshness against the day the fetcher aimed at, not demand the
    next one. The clock advances a day DURING the (mocked) fetch; the table
    holds yesterday relative to the start, so the answer must be 200."""
    after_midnight = _NOW + timedelta(days=1)

    async def _crosses_midnight(*_a: Any, **_k: Any) -> Any:
        monkeypatch.setattr(benchmark_mod, "_utc_now", lambda: after_midnight)
        return _returns_ending(_yesterday()), False

    _patch(monkeypatch, side_effect=_crosses_midnight)

    resp = client.post(ROUTE)

    assert resp.status_code == 200, resp.text
    assert resp.json()["through"] == _yesterday().isoformat()


@pytest.mark.asyncio
async def test_missing_service_key_is_refused_by_the_middleware(monkeypatch):
    import main

    monkeypatch.setattr(main, "SERVICE_KEY", "a-real-service-key-value")
    mock = _patch(monkeypatch, return_value=(_returns_ending(_yesterday()), False))

    transport = httpx.ASGITransport(app=main.app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.post(ROUTE)

    assert resp.status_code == 401, resp.text
    mock.assert_not_awaited()
