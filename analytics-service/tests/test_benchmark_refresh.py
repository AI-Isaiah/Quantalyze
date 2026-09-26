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
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import date, datetime, timedelta, timezone
from typing import Any
from unittest.mock import AsyncMock

import httpx
import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers import cron as cron_mod

ROUTE = "/api/benchmark-refresh"


def _yesterday() -> date:
    return datetime.now(timezone.utc).date() - timedelta(days=1)


def _returns_ending(last: date, n: int = 3) -> pd.Series:
    idx = pd.DatetimeIndex(
        [pd.Timestamp(last - timedelta(days=n - 1 - i)) for i in range(n)]
    )
    return pd.Series([0.01, -0.02, 0.03][:n], index=idx, name="BTC")


@pytest.fixture
def client() -> Iterator[TestClient]:
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


def test_exception_answers_exactly_500_logged_by_type_only(client, monkeypatch, caplog):
    secret_detail = "upstream said: sensitive-detail-canary"
    _patch(monkeypatch, side_effect=RuntimeError(secret_detail))

    with caplog.at_level("ERROR", logger="quantalyze.analytics"):
        resp = client.post(ROUTE)

    assert resp.status_code == 500
    assert resp.status_code != 503
    assert "sensitive-detail-canary" not in resp.text
    messages = [r.getMessage() for r in caplog.records if r.levelname == "ERROR"]
    assert any("RuntimeError" in m for m in messages), messages
    assert not any("sensitive-detail-canary" in m for m in messages), messages


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
