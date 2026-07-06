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
    # LOW-1: contiguous 90-day windows overlap at their inclusive boundary (the
    # next window's `since` == the prior window's end, and a venue page may also
    # spill rows a few ms past the requested window end). A boundary-timestamp
    # transfer therefore gets fetched in BOTH adjacent windows. Dedup by the ccxt
    # transfer `id` so such a flow is counted exactly once (a double-counted
    # deposit/withdrawal would corrupt the flow-aware TWR base). Rows with no `id`
    # are kept as-is (cannot be de-duplicated; ccxt transfers always carry one).
    seen_ids: set[Any] = set()
    window_start = since_ms
    while window_start < now_ms:
        window_end = min(window_start + window_ms, now_ms)
        # Paginate WITHIN each 90-day window so a bursty allocator with a
        # large per-window transfer count doesn't lose rows past page 1.
        inner_cursor = window_start
        # Safety ceiling only — real termination is cursor-non-advance /
        # empty page / window-end below. We request page_limit=500 but the
        # venue may cap far lower (OKX 100, Bybit 50), so size the ceiling
        # off the smallest realistic cap (50) to preserve ~50k rows/window
        # of headroom regardless of venue: 1000 × 50 = 50k.
        for _ in range(1000):
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
            for _row in page:
                _rid = _row.get("id") if isinstance(_row, dict) else None
                if _rid is not None:
                    if _rid in seen_ids:
                        continue  # already collected from the overlapping window
                    seen_ids.add(_rid)
                all_rows.append(_row)
            # Phase 76-01 (RESEARCH Pitfall 3): do NOT break on
            # ``len(page) < page_limit``. OKX caps transfer history at
            # 100 rows/page and Bybit at 50 — a FULL venue-capped page is
            # always shorter than our requested page_limit of 500, so the
            # old short-page break mistook page 1 for end-of-history and
            # silently dropped every transfer past it (threat T-76-01-TRUNC,
            # mirroring the identical _fetch_ohlcv_daily fix). Termination is
            # driven purely by cursor-non-advance / empty page / window-end.
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
