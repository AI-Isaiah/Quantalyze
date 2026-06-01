"""REGRESSION (QUANTALYZE-J/K): OKX /account/bills 429 (error 50011) handling.

cron_sync fans out BATCH_SIZE exchange instances concurrently; ccxt's
per-instance rate limiter does NOT coordinate across them, so concurrent OKX
keys trip 429 even though each instance is individually polite. A 429 here is
transient and must be retried with backoff — pre-fix it propagated immediately,
discarding the entire (already partially fetched) daily-PnL series and leaving
trades_fetched=0 for every OKX key.

WHY both tests matter (Rule 9): the fix must survive a *transient* burst
(test 1) WITHOUT weakening the NEW-C13-04 invariant that a *persistent* failure
still propagates so an incomplete series is rejected, not silently treated as
canonical daily PnL (test 2).
"""
from __future__ import annotations

import ccxt.async_support as ccxt
import pytest

from services import exchange as exchange_mod
from services.exchange import _okx_bills_fetch_with_backoff


class _ScriptedExchange:
    """Fake ccxt exchange: raise RateLimitExceeded `fail_times`, then return."""

    def __init__(self, fail_times: int, payload: dict) -> None:
        self._fail_times = fail_times
        self._payload = payload
        self.calls = 0

    async def private_get_account_bills(self, params: dict) -> dict:
        self.calls += 1
        if self.calls <= self._fail_times:
            raise ccxt.RateLimitExceeded(
                'okx {"msg":"Too Many Requests","code":"50011"}'
            )
        return self._payload


@pytest.mark.asyncio
async def test_transient_429_is_retried_then_succeeds(monkeypatch):
    # No real sleeping — record the backoff calls but return instantly.
    slept: list[float] = []

    async def _fake_sleep(delay: float) -> None:
        slept.append(delay)

    monkeypatch.setattr(exchange_mod.asyncio, "sleep", _fake_sleep)

    payload = {"data": [{"billId": "1"}]}
    ex = _ScriptedExchange(fail_times=2, payload=payload)

    result = await _okx_bills_fetch_with_backoff(
        ex, "private_get_account_bills", {"instType": "SWAP"}, label="SWAP", page=0
    )

    assert result == payload
    assert ex.calls == 3  # 2 transient 429s + 1 success
    assert len(slept) == 2  # backed off before each retry


@pytest.mark.asyncio
async def test_persistent_429_propagates_after_bounded_retries(monkeypatch):
    async def _fake_sleep(_delay: float) -> None:
        return None

    monkeypatch.setattr(exchange_mod.asyncio, "sleep", _fake_sleep)

    ex = _ScriptedExchange(fail_times=99, payload={"data": []})

    with pytest.raises(ccxt.RateLimitExceeded):
        await _okx_bills_fetch_with_backoff(
            ex, "private_get_account_bills", {"instType": "SWAP"}, label="SWAP", page=0
        )

    # Bounded: exactly OKX_BILLS_MAX_RETRIES attempts (no infinite loop), and the
    # final 429 propagates so the caller rejects the incomplete series.
    assert ex.calls == exchange_mod.OKX_BILLS_MAX_RETRIES
