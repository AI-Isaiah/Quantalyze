"""CR-perf-1 regression — services/exchange.fetch_mark_prices OKX path
must run per-symbol calls concurrently via asyncio.gather, not sequentially.

The naive serial implementation took N * RTT for N open perps; under
asyncio.gather it takes ~max(RTT). We assert this structurally, by patching
public_get_public_mark_price and recording how many calls are in flight at
once — serial peaks at 1, parallel at N. No wall-clock is read.
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from services import exchange as exchange_service


@pytest.mark.asyncio
async def test_fetch_mark_prices_okx_runs_in_parallel(monkeypatch):
    """N per-symbol calls are in flight TOGETHER, not one after another.

    Pre-fix the OKX branch ran ``for sym in to_fetch: await ...``, so the
    calls were strictly serial. Post-fix ``asyncio.gather`` starts them all
    before any one completes.

    ⛔ STRUCTURE, NOT A STOPWATCH. This used to time the batch against 0.6x the
    serial duration (5 calls x 50 ms), which left a 100 ms margin that a
    CPU-starved xdist worker could burn through while the batch was perfectly
    parallel. The property is exact and needs no clock: the peak number of calls
    in flight. Every ``gather`` child runs its first step in the same event-loop
    pass, before any of them can resume, so a parallel implementation reaches N
    and a serial one never exceeds 1, however slow the box is.
    """
    exchange_service._reset_mark_price_cache_for_tests()

    call_count = 0
    in_flight = 0
    peak_in_flight = 0

    async def fake_call(params):
        nonlocal call_count, in_flight, peak_in_flight
        call_count += 1
        in_flight += 1
        peak_in_flight = max(peak_in_flight, in_flight)
        try:
            await asyncio.sleep(0)  # yield: a serial caller would not have started the next
        finally:
            in_flight -= 1
        return {"data": [{"markPx": "100.0"}]}

    fake_exchange = MagicMock()
    fake_exchange.id = "okx"
    fake_exchange.public_get_public_mark_price = AsyncMock(side_effect=fake_call)

    syms = ["BTC-USDT-SWAP", "ETH-USDT-SWAP", "SOL-USDT-SWAP", "XRP-USDT-SWAP", "DOGE-USDT-SWAP"]

    out = await exchange_service.fetch_mark_prices(fake_exchange, syms)

    assert call_count == len(syms), "Each symbol must be fetched once"
    assert len(out) == len(syms), "All symbols must have a price returned"
    assert peak_in_flight == len(syms), (
        f"CR-perf-1: fetch_mark_prices OKX must run in parallel; at most "
        f"{peak_in_flight} of {len(syms)} calls were ever in flight together"
    )


@pytest.mark.asyncio
async def test_fetch_mark_prices_okx_one_failure_does_not_kill_batch(monkeypatch):
    """A single failed symbol must not fail the whole asyncio.gather batch."""
    exchange_service._reset_mark_price_cache_for_tests()

    async def fake_call(params):
        if params["instId"] == "FAIL-USDT-SWAP":
            raise RuntimeError("simulated network error")
        return {"data": [{"markPx": "42.0"}]}

    fake_exchange = MagicMock()
    fake_exchange.id = "okx"
    fake_exchange.public_get_public_mark_price = AsyncMock(side_effect=fake_call)

    syms = ["OK-USDT-SWAP", "FAIL-USDT-SWAP", "OK2-USDT-SWAP"]
    out = await exchange_service.fetch_mark_prices(fake_exchange, syms)

    assert "OK-USDT-SWAP" in out
    assert "OK2-USDT-SWAP" in out
    assert "FAIL-USDT-SWAP" not in out
