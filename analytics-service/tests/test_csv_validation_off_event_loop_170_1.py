"""170.1 / T-170.1-51 (event-loop half): CSV validation never runs ON the event loop.

The defect (security re-audit, `[170.1-CSV-ZONE-CHECK-COST]`): `validate_csv` is
synchronous and CPU-bound, and both callers (`routers/csv.py` and
`CsvAdapter.validate`, which serves `/process-key`) are `async def`. The service is
ONE uvicorn process, so a slow validation stalled every route, the health check
included. An authenticated tenant is bounded only by the rate limits, and the
measured worst shape took 58.8 s.

Pinned here, for both call sites:

  * while a slow validation runs, the loop keeps ticking (a ticker coroutine's
    worst gap stays far under the validation time) and the validation itself still
    answers correctly;
  * the validation runs in a worker thread that is NOT the loop's thread;
  * the caller's context (contextvars, which carry Sentry's scopes) reaches the
    worker, so nothing Sentry attaches is lost by moving the call;
  * the `except Exception` arm still catches a fault raised from the worker, and
    still answers with the fixed sentence.

The bounds are generous on purpose (a 1 s validation against a 0.5 s tick-gap
ceiling): the on-loop failure measures the whole second, and a loaded CI box does
not come near half of it.
"""
from __future__ import annotations

import asyncio
import contextvars
import threading
import time
from typing import Any
from unittest.mock import MagicMock, patch

import httpx
import pytest
from fastapi import FastAPI

from services import csv_validator

SLOW_SECONDS = 1.0
MAX_TICK_GAP = 0.5
_TOKEN = "a" * 64
_CSV = b"date,daily_return\n2024-01-01,0.01\n2024-01-02,0.02\n"
_OK_ENVELOPE: dict[str, Any] = {"ok": True, "preview": [], "daily_returns_series": [], "errors": []}


def _slow_validate(seen: dict[str, Any]):
    def validate(raw: bytes, fmt: str) -> dict[str, Any]:
        seen["thread"] = threading.current_thread()
        time.sleep(SLOW_SECONDS)  # stands in for the 58.8 s worst shape
        return _OK_ENVELOPE

    return validate


def _csv_router():
    # Imported at call time, never at module level: see `_process_key_router`.
    import routers.csv as csv_router

    return csv_router


def _process_key_router():
    """`tests/test_process_key.py` evicts and re-imports `routers.process_key` at
    ITS collection. A collection-time import here would make that re-import
    register the route's rate limits twice (`test_process_key_route_registers_both_limits`
    measured 4 groups instead of 2), so the module is resolved when a test runs."""
    import routers.process_key as process_key_router

    return process_key_router


def _csv_app() -> FastAPI:
    csv_router = _csv_router()
    app = FastAPI()
    app.state.limiter = csv_router.limiter
    app.include_router(csv_router.router)
    return app


def _process_key_app() -> FastAPI:
    process_key_router = _process_key_router()
    app = FastAPI()
    app.state.limiter = process_key_router.limiter
    app.include_router(process_key_router.router)
    return app


async def _post_csv_route(app: FastAPI) -> httpx.Response:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        return await c.post(
            "/api/csv/validate",
            files={"file": ("upload.csv", _CSV, "text/csv")},
            data={"fmt": "daily_returns", "wizard_session_id": "wiz-loop-170-1"},
        )


async def _post_process_key(app: FastAPI) -> httpx.Response:
    import base64

    with patch.object(_process_key_router(), "get_supabase", return_value=MagicMock()):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
            return await c.post(
                "/process-key",
                json={
                    "flow_type": "csv",
                    "source": "csv",
                    "context": {
                        "step": "validate",
                        "user_id": "u1",
                        "wizard_session_id": "wiz-loop-170-1",
                        "fmt": "daily_returns",
                        "raw_bytes_base64": base64.b64encode(_CSV).decode(),
                    },
                },
                headers={
                    "Authorization": f"Bearer {_TOKEN}",
                    "X-Correlation-Id": "11111111-1111-4111-8111-111111111111",
                },
            )


async def _measure_loop_gap(request_coro) -> tuple[httpx.Response, float, float]:
    """Run `request_coro` while a ticker records its worst gap between wake-ups.
    Returns (response, worst_gap_s, request_elapsed_s)."""
    stop = asyncio.Event()
    worst = 0.0

    async def ticker() -> None:
        nonlocal worst
        last = time.monotonic()
        while not stop.is_set():
            await asyncio.sleep(0.02)
            now = time.monotonic()
            worst = max(worst, now - last)
            last = now

    task = asyncio.create_task(ticker())
    await asyncio.sleep(0.1)  # let the ticker settle before the request starts
    started = time.monotonic()
    try:
        response = await request_coro
    finally:
        elapsed = time.monotonic() - started
        stop.set()
        await task
    return response, worst, elapsed


@pytest.fixture(autouse=True)
def _token_and_fresh_limiter(monkeypatch):
    """The limiter is a process-wide singleton with in-memory storage: reset it on
    the way in and out so these requests leave no hits for another file to count."""
    from services.rate_limit import limiter

    monkeypatch.setenv("INTERNAL_API_TOKEN", _TOKEN)
    limiter.reset()
    yield
    limiter.reset()


# ---------------------------------------------------------------------------
# The loop stays responsive while a slow validation runs
# ---------------------------------------------------------------------------


def test_legacy_route_keeps_the_loop_responsive_during_a_slow_validation() -> None:
    seen: dict[str, Any] = {}
    with patch.object(_csv_router(), "validate_csv", _slow_validate(seen)):
        response, worst_gap, elapsed = asyncio.run(_measure_loop_gap(_post_csv_route(_csv_app())))

    assert response.status_code == 200, response.text
    assert response.json()["ok"] is True  # the answer is unchanged
    assert elapsed >= SLOW_SECONDS  # the validation really was slow
    assert worst_gap < MAX_TICK_GAP, f"the loop stalled for {worst_gap:.2f}s"
    assert seen["thread"] is not threading.main_thread()


def test_process_key_keeps_the_loop_responsive_during_a_slow_validation() -> None:
    seen: dict[str, Any] = {}
    with patch.object(csv_validator, "validate_csv", _slow_validate(seen)):
        response, worst_gap, elapsed = asyncio.run(
            _measure_loop_gap(_post_process_key(_process_key_app()))
        )

    assert response.status_code == 200, response.text
    assert elapsed >= SLOW_SECONDS
    assert worst_gap < MAX_TICK_GAP, f"the loop stalled for {worst_gap:.2f}s"
    assert seen["thread"] is not threading.main_thread()


# ---------------------------------------------------------------------------
# What moving the call must not change
# ---------------------------------------------------------------------------


def test_the_callers_context_reaches_the_worker() -> None:
    """contextvars carry Sentry's scopes: they must follow the call into the thread."""
    from services.csv_offload import run_csv_validation

    var: contextvars.ContextVar[str] = contextvars.ContextVar("probe", default="unset")
    seen: dict[str, str] = {}

    def validate(raw: bytes, fmt: str) -> dict[str, Any]:
        seen["value"] = var.get()
        return _OK_ENVELOPE

    async def go() -> None:
        var.set("from-the-request")
        await run_csv_validation(validate, b"", "daily_returns")

    asyncio.run(go())
    assert seen["value"] == "from-the-request"


def test_a_fault_raised_in_the_worker_reaches_the_caller_unchanged() -> None:
    from services.csv_offload import run_csv_validation

    class Boom(Exception):
        pass

    def validate(raw: bytes, fmt: str) -> dict[str, Any]:
        raise Boom("the worker's own text")

    async def go() -> None:
        await run_csv_validation(validate, b"", "daily_returns")

    with pytest.raises(Boom, match="the worker's own text"):
        asyncio.run(go())


def test_validations_do_not_overlap() -> None:
    """`validate_csv` wraps `warnings.catch_warnings`, which saves and restores a
    PROCESS-WIDE filter list: two overlapping validations can restore each other's
    stale snapshot and leave `ignore` installed for the whole process. One worker
    serialises them."""
    from services.csv_offload import run_csv_validation

    active = 0
    peak = 0
    lock = threading.Lock()

    def validate(raw: bytes, fmt: str) -> dict[str, Any]:
        nonlocal active, peak
        with lock:
            active += 1
            peak = max(peak, active)
        time.sleep(0.05)
        with lock:
            active -= 1
        return _OK_ENVELOPE

    async def go() -> None:
        await asyncio.gather(*(run_csv_validation(validate, b"", "daily_returns") for _ in range(4)))

    asyncio.run(go())
    assert peak == 1


def test_route_arm_still_answers_with_the_fixed_sentence_for_a_worker_fault() -> None:
    def boom(raw: bytes, fmt: str) -> dict[str, Any]:
        raise ValueError("could not convert string to float: 'ZXQCELL'")

    with patch.object(_csv_router(), "validate_csv", boom):
        response = asyncio.run(_post_csv_route(_csv_app()))

    assert response.status_code == 500
    assert response.json()["detail"]["code"] == "CSV_UPSTREAM_FAIL"
    assert "ZXQCELL" not in response.text


def test_adapter_arm_still_answers_with_the_fixed_sentence_for_a_worker_fault() -> None:
    def boom(raw: bytes, fmt: str) -> dict[str, Any]:
        raise ValueError("could not convert string to float: 'ZXQCELL'")

    with patch.object(csv_validator, "validate_csv", boom):
        response = asyncio.run(_post_process_key(_process_key_app()))

    assert "ZXQCELL" not in response.text
    assert "CSV_UPSTREAM_FAIL" in response.text
