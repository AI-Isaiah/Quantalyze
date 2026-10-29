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

# Bybit's documented page size for the deposit and withdraw record endpoints (1 to 50).
_BYBIT_TRANSFER_PAGE_LIMIT: int = 50


class TransferPageStalled(RuntimeError):
    """A Bybit transfer window's page cursor did not advance (Phase 180, D-02).

    Raised instead of returning a short list: a truncated list reads as "no more
    transfers" to every caller. The text is static: the kind and the window start
    only, never venue text.
    """


def _bybit_next_cursor(response: Any) -> str | None:
    """The ``result.nextPageCursor`` of one raw Bybit answer, or None.

    Read from the answer of the call just made, never from a parsed row and never from
    ``exchange.last_json_response``: ccxt writes the cursor onto one raw row and drops
    any parsed row stamped 0 or None, taking the cursor with it, and it only keeps
    ``last_json_response`` when ``enableLastJsonResponse`` is on (it is off by default,
    and is shared state on the exchange). Phase 180 round 1, WR-02."""
    result = response.get("result") if isinstance(response, dict) else None
    cursor = result.get("nextPageCursor") if isinstance(result, dict) else None
    return str(cursor) if cursor else None


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


async def _read_bybit_transfer_window(
    exchange: Any,
    kind: str,
    window_start: int,
    window_end: int,
    all_rows: list[dict[str, Any]],
    seen_ids: set[Any],
) -> bool:
    """Read one Bybit window ``[window_start, window_end]`` whole by Bybit's cursor.

    Appends the rows to ``all_rows`` (deduplicated by id against ``seen_ids``).
    Returns False when the exchange cannot enumerate transfers (``ccxt.NotSupported``,
    the only exception caught, WR-04), True otherwise. Raises ``TransferPageStalled``
    on a cursor already seen in this window (a repeat or a cycle) and on reaching the
    1000-page ceiling, never a short list. The window start never moves: Bybit pages by
    cursor, newest first.
    """
    # The raw endpoint ``fetch_deposits`` / ``fetch_withdrawals`` call (ccxt 4.5.85 and
    # 4.5.88 are identical here), so the cursor comes from this call's own answer.
    endpoint = (
        exchange.privateGetV5AssetDepositQueryRecord
        if kind == "deposits"
        else exchange.privateGetV5AssetWithdrawQueryRecord
    )
    cursor: str | None = None
    seen_cursors: set[str] = set()
    for _ in range(1000):
        request: dict[str, Any] = {
            "startTime": window_start,
            "limit": _BYBIT_TRANSFER_PAGE_LIMIT,
            "endTime": window_end,
        }
        if cursor is not None:
            request["cursor"] = cursor
        try:
            if exchange.markets is None:
                await exchange.load_markets()
            response = await endpoint(request)
        except ccxt.NotSupported:
            return False
        raw_rows = exchange.add_pagination_cursor_to_result(response)
        if not raw_rows:
            # An empty answer ends the window whatever cursor it carries (plan 05; the
            # Unified reader and ccxt's own cursor paginator stop the same way).
            return True
        # What ``fetch_deposits`` does with the answer: the parsed transactions callers
        # get today (sorted ascending, rows stamped 0 or None dropped, at most 50).
        page = exchange.parse_transactions(
            raw_rows, None, window_start, _BYBIT_TRANSFER_PAGE_LIMIT
        )
        if len(page) < len(raw_rows):
            # Counts only, never ids, amounts or venue text. Most drops are a deposit
            # not yet credited (stamp 0), but nothing else tells that from a drifted field.
            logger.warning(
                "Bybit transfer rows dropped by parsing (kind=%s window_start_ms=%d "
                "raw_rows=%d parsed_rows=%d)",
                kind,
                window_start,
                len(raw_rows),
                len(page),
            )
        nxt = _bybit_next_cursor(response)
        for _row in page:
            _rid = _row.get("id") if isinstance(_row, dict) else None
            if _rid is not None:
                if _rid in seen_ids:
                    continue  # already collected from the overlapping window
                seen_ids.add(_rid)
            all_rows.append(_row)
        if nxt is None:
            return True
        if nxt in seen_cursors:
            raise TransferPageStalled(
                "a Bybit transfer window's page cursor did not advance; nothing "
                f"past it was read (kind={kind}, window_start_ms={window_start})"
            )
        seen_cursors.add(nxt)
        cursor = nxt
        await _rate_limit_sleep(exchange)
    raise TransferPageStalled(
        "a Bybit transfer window exceeded 1000 pages; nothing past it was read "
        f"(kind={kind}, window_start_ms={window_start})"
    )


async def fetch_ccxt_transfers(
    exchange: Any, kind: str, since_ms: int, now_ms: int
) -> list[dict[str, Any]]:
    """Paginate fetch_deposits or fetch_withdrawals via per-venue windows.

    Binance/OKX cap per-call windows at 90 days (RESEARCH.md §1A/§1B); Bybit's
    deposit/withdraw record endpoints cap the startTime->endTime interval at 30
    days (BYBIT-131002). We page forward through sliding windows sized to the
    venue cap, passing an explicit endTime per window, and collect all rows.

    Phase 180 BYBITFUNDING (D-02, 2026-10-29): the Bybit branch follows
    ``nextPageCursor`` (read from the raw answer of the deposit / withdraw record call,
    which this branch makes itself) and asks for 50 rows a page. Bybit answers newest
    first, so the old advance to one millisecond past the newest row of a page jumped
    over every older row of the window once a window held more than one page. A cursor that does not advance raises
    ``TransferPageStalled``; it never returns a short list. Every caller inherits
    this:
    ``run_derive_broker_dailies_job`` and ``run_stitch_composite_job`` in
    ``services/job_worker.py`` and the rebuild's non-Bybit venues
    (``okx_archive_job`` reads OKX only). Binance and OKX read exactly as before.
    """
    fetcher_name = "fetch_deposits" if kind == "deposits" else "fetch_withdrawals"
    fetcher = getattr(exchange, fetcher_name, None)
    if fetcher is None:
        return []

    # BYBIT-131002: Bybit's deposit/withdraw record endpoints
    # (/v5/asset/{deposit,withdraw}/query-record) cap the startTime->endTime
    # interval at 30 days AND — unlike Binance/OKX — treat a startTime-only query
    # as [startTime, now], so a backfill whose oldest window starts at
    # ``now - BYBIT_DEPOSIT_TERMINUS_DAYS`` (365d) sends a 365-day implicit
    # interval and Bybit rejects the whole call with retCode 131002 ("The
    # interval between the startTime and endTime is incorrect"). A normal derive
    # keyed off a recent checkpoint never tripped it; the Phase-35 full-history
    # backfill does. Fix: size the window to the venue max range (Bybit 30d,
    # Binance/OKX 90d) AND pass an explicit endTime per window so the exchange
    # bounds the interval to [inner_cursor, window_end] instead of [start, now].
    exchange_id = getattr(exchange, "id", "")
    window_days = 30 if exchange_id == "bybit" else 90
    window_ms = window_days * 24 * 60 * 60 * 1000
    page_limit = 500
    all_rows: list[dict[str, Any]] = []
    # LOW-1: contiguous venue-sized windows overlap at their inclusive boundary
    # (the next window's `since` == the prior window's end, and a venue page may
    # spill rows a few ms past the requested window end). A boundary-timestamp
    # transfer therefore gets fetched in BOTH adjacent windows. Dedup by the ccxt
    # transfer `id` so such a flow is counted exactly once (a double-counted
    # deposit/withdrawal would corrupt the flow-aware TWR base). Rows with no `id`
    # are kept as-is (cannot be de-duplicated; ccxt transfers always carry one).
    seen_ids: set[Any] = set()
    window_start = since_ms
    while window_start < now_ms:
        window_end = min(window_start + window_ms, now_ms)
        if exchange_id == "bybit":
            if not await _read_bybit_transfer_window(
                exchange, kind, window_start, window_end, all_rows, seen_ids
            ):
                return all_rows
            window_start += window_ms
            await _rate_limit_sleep(exchange)
            continue
        # Paginate WITHIN each venue-sized window so a bursty allocator with a
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
                # Pass an explicit endTime (ccxt ``until``) so the exchange bounds
                # the query to [inner_cursor, window_end]; without it Bybit uses
                # ``now`` and a >cap interval 131002s the whole crawl (BYBIT-131002).
                page = await fetcher(
                    None, inner_cursor, page_limit, {"until": window_end}
                )
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
        else:
            # NIT-1 (specialist-silentfailure): the 1000-iteration safety ceiling
            # (~50k rows/window) was reached WITHOUT a natural termination (empty
            # page / cursor-non-advance / window-end). This is astronomically
            # unlikely for a real account, but silently falling through to the
            # next window would TRUNCATE transfer history with no signal — the
            # double-count-vs-truncation direction this module otherwise guards
            # hard. Log LOUD so a genuine ceiling hit is never a silent drop. No
            # raw amounts logged (account-size leak); only the window + count.
            logger.warning(
                "fetch_ccxt_transfers hit the %d-page ceiling for kind=%s "
                "window_start_ms=%d — transfer history for this window may be "
                "TRUNCATED (collected=%d rows so far); investigate before "
                "trusting the flow-aware TWR base for this account",
                1000, kind, window_start, len(all_rows),
            )
        window_start += window_ms
        await _rate_limit_sleep(exchange)
    return all_rows
