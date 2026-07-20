"""Regression tests for the paginated ccxt transfer fetch windowing.

BYBIT-131002: Bybit's deposit/withdraw record endpoints cap the
startTime->endTime interval at 30 days and treat a startTime-only query as
[startTime, now]. ``fetch_ccxt_transfers`` used a fixed 90-day window and never
passed an endTime, so a Phase-35 full-history backfill (since = now - 365d) sent
a 365-day implicit interval and Bybit rejected the whole crawl with retCode
131002. These tests pin the invariant: every windowed call bounds its interval
to the venue cap AND passes an explicit endTime.
"""
from __future__ import annotations

import ccxt.async_support as ccxt
import pytest

from services.ccxt_flow_fetch import fetch_ccxt_transfers

_DAY_MS = 24 * 60 * 60 * 1000
# Fixed clock — fetch_ccxt_transfers takes now_ms as a param (no internal now()),
# so the whole window walk is deterministic without touching the wall clock.
_NOW_MS = 1_780_000_000_000
_BYBIT_MAX_INTERVAL_MS = 30 * _DAY_MS


class _RecordingExchange:
    """Minimal ccxt double: records every (since, until) the paginator sends and
    (for Bybit) enforces the real /v5/asset/*/query-record 30-day interval cap.

    A startTime-only query (until is None) is what the pre-fix code sent; Bybit
    then values endTime at ``now`` — so an old ``since`` blows past the 30-day
    cap and 131002s. That is exactly the production failure this reproduces.
    """

    def __init__(self, exchange_id: str, enforce_bybit_cap: bool) -> None:
        self.id = exchange_id
        self._enforce = enforce_bybit_cap
        self.calls: list[dict[str, int | None]] = []

    async def _fetch(self, code, since, limit, params=None):  # noqa: ANN001
        params = params or {}
        until = params.get("until")
        self.calls.append({"since": since, "until": until})
        if self._enforce:
            effective_end = until if until is not None else _NOW_MS
            if effective_end - since > _BYBIT_MAX_INTERVAL_MS:
                raise ccxt.BadRequest(
                    'bybit {"retCode":131002,"retMsg":"The interval between the '
                    'startTime and endTime is incorrect"}'
                )
        return []  # empty page → paginator advances to the next window

    async def fetch_deposits(self, code, since, limit, params=None):  # noqa: ANN001
        return await self._fetch(code, since, limit, params)

    async def fetch_withdrawals(self, code, since, limit, params=None):  # noqa: ANN001
        return await self._fetch(code, since, limit, params)


@pytest.mark.asyncio
async def test_bybit_backfill_bounds_interval_and_passes_endtime() -> None:
    """A 365-day backfill must NOT 131002: every window carries an explicit
    endTime and an interval within Bybit's 30-day cap.

    Without the fix the paginator sends startTime-only 90-day windows; the
    recording exchange (mimicking Bybit) raises 131002 on the first (oldest)
    window and fetch_ccxt_transfers propagates it (only NotSupported is caught),
    so this test fails loud on the unfixed code.
    """
    ex = _RecordingExchange("bybit", enforce_bybit_cap=True)
    rows = await fetch_ccxt_transfers(
        ex, "deposits", since_ms=_NOW_MS - 365 * _DAY_MS, now_ms=_NOW_MS
    )
    assert rows == []
    assert ex.calls, "expected paginated deposit calls across the 365-day span"
    for call in ex.calls:
        assert call["until"] is not None, (
            "every Bybit window must pass an explicit endTime (131002 guard)"
        )
        interval = call["until"] - call["since"]
        assert 0 < interval <= _BYBIT_MAX_INTERVAL_MS, (
            f"Bybit window interval {interval}ms exceeds the 30-day cap"
        )


@pytest.mark.asyncio
async def test_bybit_windows_tile_the_full_history_without_gaps() -> None:
    """The narrower Bybit window must still cover the entire lookback — adjacent
    windows abut at their inclusive boundary (next.since == prev.until, an
    intentional 1-boundary overlap the caller dedups by transfer id), so no
    deposit day is skipped."""
    ex = _RecordingExchange("bybit", enforce_bybit_cap=True)
    start = _NOW_MS - 100 * _DAY_MS
    await fetch_ccxt_transfers(ex, "withdrawals", since_ms=start, now_ms=_NOW_MS)
    assert ex.calls[0]["since"] == start
    for prev, nxt in zip(ex.calls, ex.calls[1:]):
        assert nxt["since"] == prev["until"], "windows must abut (no gap)"
    assert ex.calls[-1]["until"] == _NOW_MS, "last window must reach now_ms"


@pytest.mark.asyncio
async def test_non_bybit_keeps_90_day_window() -> None:
    """The fix is venue-scoped: Binance/OKX keep the 90-day window (their
    documented cap) — the Bybit 30-day narrowing must not regress them."""
    ex = _RecordingExchange("binance", enforce_bybit_cap=False)
    await fetch_ccxt_transfers(
        ex, "deposits", since_ms=_NOW_MS - 200 * _DAY_MS, now_ms=_NOW_MS
    )
    # 200 days / 90-day windows → 3 windows (last clamped to now_ms).
    assert len(ex.calls) == 3
    assert ex.calls[0]["until"] - ex.calls[0]["since"] == 90 * _DAY_MS
    # Intent guard: the explicit endTime is passed for ALL venues, not just
    # Bybit — a future regression that dropped it for non-Bybit would be caught
    # here even though it happens to be harmless on Binance/OKX.
    assert all(c["until"] is not None for c in ex.calls)
