"""CR-perf-1 regression — services/exchange.fetch_mark_prices OKX path
must run per-symbol calls concurrently via asyncio.gather, not sequentially.

The naive serial implementation took N * RTT for N open perps; under
asyncio.gather it takes ~max(RTT). We assert this by patching
public_get_public_mark_price with a delay and timing the gather call —
serial would be N*delay, parallel ≈ delay.
"""
from __future__ import annotations

import asyncio
import time
from unittest.mock import AsyncMock, MagicMock

import pytest

from services import exchange as exchange_service


@pytest.mark.asyncio
async def test_fetch_mark_prices_okx_runs_in_parallel(monkeypatch):
    """N parallel per-symbol calls take ~one RTT, not N RTTs.

    Pre-fix the OKX branch ran ``for sym in to_fetch: await ...`` so 5
    symbols at 50ms each → ~250ms wall time. Post-fix, asyncio.gather
    runs them concurrently → ~50ms wall time. We allow generous slack
    (0.5x serial) so a slow CI box doesn't false-fail, but the timing
    gap between serial and parallel for 5 * 50ms is wide enough to be
    unambiguous.
    """
    exchange_service._reset_mark_price_cache_for_tests()

    delay_s = 0.05
    call_count = 0

    async def fake_call(params):
        nonlocal call_count
        call_count += 1
        await asyncio.sleep(delay_s)
        return {"data": [{"markPx": "100.0"}]}

    fake_exchange = MagicMock()
    fake_exchange.id = "okx"
    fake_exchange.public_get_public_mark_price = AsyncMock(side_effect=fake_call)

    syms = ["BTC-USDT-SWAP", "ETH-USDT-SWAP", "SOL-USDT-SWAP", "XRP-USDT-SWAP", "DOGE-USDT-SWAP"]

    started = time.monotonic()
    out = await exchange_service.fetch_mark_prices(fake_exchange, syms)
    elapsed = time.monotonic() - started

    assert call_count == len(syms), "Each symbol must be fetched once"
    assert len(out) == len(syms), "All symbols must have a price returned"
    # Serial-fix would be ~5 * 0.05 = 0.25s. Parallel target ≈ 0.05s.
    # Choose half-serial as the boundary; if we ever regress to serial it
    # would clearly cross.
    assert elapsed < (delay_s * len(syms) * 0.6), (
        f"CR-perf-1: fetch_mark_prices OKX must run in parallel; "
        f"elapsed={elapsed:.3f}s, expected < {delay_s * len(syms) * 0.6:.3f}s"
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
