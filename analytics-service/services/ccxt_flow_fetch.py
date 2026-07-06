"""Shared ccxt capital-flow FETCH helpers (Phase 76-01).

This is the venue-agnostic ccxt transfer-fetch home. It is an I/O module —
NOT the pure flow-valuation module (76-02 builds that). It owns the ONE
paginated ``fetch_deposits`` / ``fetch_withdrawals`` path that both the
allocator-dashboard equity reconstruction and the ccxt flow adapter (76-04)
consume, so FLOW-03's "one flow-fetch path, not three copies" holds by
construction.

Promoted verbatim from ``services.equity_reconstruction`` (Phase 07). The
WR-04 exception discipline is preserved exactly: only ``ccxt.NotSupported``
is caught (feature detection); every other exception — auth revoked
mid-backfill, rate limit, network failure — MUST bubble to the caller's
outer handler so it lands in ``classify_exception`` + ``_emit_audit`` rather
than being silently swallowed behind a truncated row list.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

import ccxt.async_support as ccxt

logger = logging.getLogger("quantalyze.analytics.ccxt_flow_fetch")


async def _rate_limit_sleep(exchange: Any) -> None:
    """Back-off between paginated calls to the same exchange.

    CCXT's enableRateLimit flag is not guaranteed on every instance we
    receive — reach for the advertised per-call rateLimit attribute and
    sleep for that many ms. Falls through silently on AsyncMock / test
    doubles that have no rateLimit attribute so pytest stays fast.

    M-1030: narrow the swallow to ``TypeError``/``ValueError`` so
    ``asyncio.CancelledError`` (which subclasses ``BaseException`` on
    3.8+, but inherits from ``Exception`` on older interpreters) is
    NOT caught — workers that hit SIGTERM mid-sleep must propagate
    the cancellation so kubectl rollouts don't stall on a stuck loop.
    """
    ms = getattr(exchange, "rateLimit", None)
    if not isinstance(ms, (int, float)) or ms <= 0:
        return
    try:
        await asyncio.sleep(float(ms) / 1000.0)
    except (TypeError, ValueError) as exc:  # pragma: no cover
        logger.warning("_rate_limit_sleep skipped: %s", exc)


async def fetch_ccxt_transfers(
    exchange: Any, kind: str, since_ms: int, now_ms: int
) -> list[dict[str, Any]]:
    """Paginate fetch_deposits or fetch_withdrawals via 90-day windows.

    Binance/OKX both cap per-call windows at 90 days (RESEARCH.md §1A/§1B).
    We page forward through sliding 90-day windows and collect all rows.
    """
    fetcher_name = "fetch_deposits" if kind == "deposits" else "fetch_withdrawals"
    fetcher = getattr(exchange, fetcher_name, None)
    if fetcher is None:
        return []

    window_ms = 90 * 24 * 60 * 60 * 1000
    page_limit = 500
    all_rows: list[dict[str, Any]] = []
    window_start = since_ms
    while window_start < now_ms:
        window_end = min(window_start + window_ms, now_ms)
        # Paginate WITHIN each 90-day window so a bursty allocator with
        # >500 transfers per window doesn't lose rows past row 500.
        inner_cursor = window_start
        for _ in range(100):  # safety ceiling: 100 × 500 = 50k per window
            # WR-04: only catch ccxt.NotSupported here (feature detection —
            # the exchange cannot enumerate transfers at all). All other
            # exceptions (auth revoked mid-backfill, rate limit, network
            # failure) MUST bubble to the outer handler so they land in
            # classify_exception + _emit_audit rather than being silently
            # swallowed — the previous `break` returned a truncated list
            # that looked identical to "allocator has no transfers", which
            # caused zero-activity rows with no audit trail.
            try:
                page = await fetcher(None, inner_cursor, page_limit)
            except ccxt.NotSupported:
                return all_rows
            page = page or []
            if not page:
                break
            all_rows.extend(page)
            if len(page) < page_limit:
                break
            max_ts = max(
                (int(r.get("timestamp") or 0) for r in page), default=inner_cursor
            )
            if max_ts <= inner_cursor or max_ts >= window_end:
                break
            inner_cursor = max_ts + 1
            await _rate_limit_sleep(exchange)
        window_start += window_ms
        await _rate_limit_sleep(exchange)
    return all_rows
