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

from typing import Any

import ccxt.async_support as ccxt
import pytest

from services.ccxt_flow_fetch import TransferPageStalled, fetch_ccxt_transfers

_DAY_MS = 24 * 60 * 60 * 1000
# Fixed clock — fetch_ccxt_transfers takes now_ms as a param (no internal now()),
# so the whole window walk is deterministic without touching the wall clock.
_NOW_MS = 1_780_000_000_000
_BYBIT_MAX_INTERVAL_MS = 30 * _DAY_MS


class _RecordingExchange:
    """Minimal ccxt double for the non-Bybit venues: records every (since, until) the
    paginator sends and answers an empty page, so the paginator advances to the next
    window."""

    def __init__(self, exchange_id: str) -> None:
        self.id = exchange_id
        self.calls: list[dict[str, int | None]] = []

    async def _fetch(self, code, since, limit, params=None):  # noqa: ANN001
        params = params or {}
        self.calls.append({"since": since, "until": params.get("until")})
        return []

    async def fetch_deposits(self, code, since, limit, params=None):  # noqa: ANN001
        return await self._fetch(code, since, limit, params)

    async def fetch_withdrawals(self, code, since, limit, params=None):  # noqa: ANN001
        return await self._fetch(code, since, limit, params)


class _RecordingBybit(ccxt.bybit):  # type: ignore[misc]
    """A real ccxt Bybit whose raw deposit / withdraw record endpoints are replaced by a
    recorder that enforces the venue's /v5/asset/*/query-record 30-day interval cap.

    A startTime-only query is what the pre-fix code sent; Bybit then values endTime at
    ``now``, so an old ``since`` blows past the 30-day cap and 131002s. That is exactly
    the production failure this reproduces."""

    def __init__(self) -> None:
        super().__init__()
        self.rateLimit = 0
        self.markets = {}
        self.calls: list[dict[str, int | None]] = []
        self.privateGetV5AssetDepositQueryRecord = self._record
        self.privateGetV5AssetWithdrawQueryRecord = self._record

    async def _record(self, request: dict[str, Any]) -> dict[str, Any]:
        since = request["startTime"]
        until = request.get("endTime")
        self.calls.append({"since": since, "until": until})
        effective_end = until if until is not None else _NOW_MS
        if effective_end - since > _BYBIT_MAX_INTERVAL_MS:
            raise ccxt.BadRequest(
                'bybit {"retCode":131002,"retMsg":"The interval between the '
                'startTime and endTime is incorrect"}'
            )
        return {"retCode": 0, "result": {"rows": [], "nextPageCursor": ""}}


@pytest.mark.asyncio
async def test_bybit_backfill_bounds_interval_and_passes_endtime() -> None:
    """A 365-day backfill must NOT 131002: every window carries an explicit
    endTime and an interval within Bybit's 30-day cap.

    Without the fix the paginator sends startTime-only 90-day windows; the
    recording exchange (mimicking Bybit) raises 131002 on the first (oldest)
    window and fetch_ccxt_transfers propagates it (only NotSupported is caught),
    so this test fails loud on the unfixed code.
    """
    ex = _RecordingBybit()
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
    ex = _RecordingBybit()
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
    ex = _RecordingExchange("binance")
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


class _NewestFirstBybitTransfers(ccxt.bybit):  # type: ignore[misc]
    """A real ccxt Bybit whose raw deposit / withdraw record endpoints answer the way the
    venue does, so ccxt's own ``add_pagination_cursor_to_result`` and
    ``parse_transactions`` run on the raw rows.

    Rows inside ``[startTime, endTime]`` are served NEWEST FIRST, at most 50 a page, from
    the offset an opaque cursor names; the answer carries ``result.nextPageCursor``. The
    repo's other transfer doubles answer ascending, which is why the one-millisecond
    advance past the newest row never showed (RESEARCH Pitfall 5). Like production,
    ``last_json_response`` is never set (``enableLastJsonResponse`` is off by default).

    Options: ``repeat_cursor`` answers the cursor it was sent on every page after the
    first; ``cursors`` answers those cursors in order, one per call (a cycle);
    ``unstamped_newest`` gives the newest row of every page ``successAt`` "0", so ccxt
    drops it while parsing, and its cursor with it (a deposit still in flight);
    ``not_supported_on_call`` raises ``ccxt.NotSupported`` on that (1-based) call.
    """

    def __init__(
        self,
        rows: list[dict[str, Any]],
        *,
        repeat_cursor: bool = False,
        cursors: list[str] | None = None,
        unstamped_newest: bool = False,
        not_supported_on_call: int | None = None,
    ) -> None:
        super().__init__()
        self.rateLimit = 0
        self.markets = {}
        self._rows = rows
        self._repeat = repeat_cursor
        self._cursors = cursors
        self._unstamped_newest = unstamped_newest
        self._not_supported_on = not_supported_on_call
        self.calls: list[tuple[int | None, int, int, str | None]] = []
        self.privateGetV5AssetDepositQueryRecord = self._record
        self.privateGetV5AssetWithdrawQueryRecord = self._record

    async def _record(self, request: dict[str, Any]) -> dict[str, Any]:
        since, until = request["startTime"], request["endTime"]
        cursor = request.get("cursor")
        self.calls.append((since, until, request["limit"], cursor))
        if self._not_supported_on == len(self.calls):
            raise ccxt.NotSupported("bybit fetchDeposits")
        inside = sorted(
            (r for r in self._rows if since <= r["timestamp"] <= until),
            key=lambda r: r["timestamp"],
            reverse=True,
        )
        offset = int(cursor.removeprefix("off:")) if cursor else 0
        take = inside[offset : offset + min(request["limit"], 50)]
        raw_rows = [
            {
                "id": r["id"],
                "coin": "USDT",
                "amount": str(r["amount"]),
                "status": 3,
                "depositFee": "",
                "successAt": str(r["timestamp"]),
            }
            for r in take
        ]
        if self._unstamped_newest and raw_rows:
            raw_rows[0]["successAt"] = "0"
        more = offset + len(take) < len(inside)
        next_cursor = ""
        if self._cursors is not None:
            next_cursor = self._cursors[len(self.calls) - 1]
        elif raw_rows and (more or (self._repeat and cursor)):
            next_cursor = cursor if self._repeat and cursor else f"off:{offset + len(take)}"
        return {
            "retCode": 0,
            "retMsg": "success",
            "result": {"rows": raw_rows, "nextPageCursor": next_cursor},
        }


def _transfer_rows(n: int, newest_ts: int) -> list[dict[str, Any]]:
    return [
        {"id": f"t{i}", "timestamp": newest_ts - i * 60_000, "amount": 1.0}
        for i in range(n)
    ]


@pytest.mark.asyncio
async def test_a_bybit_window_holding_more_than_one_page_returns_every_row() -> None:
    """D-02 / SC-2: 120 transfers in one 30-day window, 50 a page, newest first, come
    back whole in exactly 3 calls. The old one-millisecond advance past the newest
    row of page 1 jumped over the 70 older rows (RED with 50 rows)."""
    since = _NOW_MS - 20 * _DAY_MS
    ex = _NewestFirstBybitTransfers(_transfer_rows(120, _NOW_MS - 1_000))
    rows = await fetch_ccxt_transfers(ex, "deposits", since_ms=since, now_ms=_NOW_MS)
    assert len(rows) == 120
    assert len({r["id"] for r in rows}) == 120
    assert len(ex.calls) == 3
    assert [c[0] for c in ex.calls] == [since] * 3, "the window start never moves"
    assert [c[1] for c in ex.calls] == [_NOW_MS] * 3
    assert [c[2] for c in ex.calls] == [50] * 3
    assert [c[3] for c in ex.calls] == [None, "off:50", "off:100"]


@pytest.mark.asyncio
async def test_a_repeated_bybit_cursor_raises_instead_of_truncating() -> None:
    """A cursor that does not advance must not read as "no more transfers"."""
    ex = _NewestFirstBybitTransfers(
        _transfer_rows(120, _NOW_MS - 1_000), repeat_cursor=True
    )
    with pytest.raises(TransferPageStalled) as err:
        await fetch_ccxt_transfers(
            ex, "deposits", since_ms=_NOW_MS - 20 * _DAY_MS, now_ms=_NOW_MS
        )
    assert "deposits" in str(err.value)
    assert len(ex.calls) == 2


@pytest.mark.asyncio
async def test_a_cycling_bybit_cursor_raises_instead_of_truncating() -> None:
    """Round 1 WR-03: a cursor that cycles (A, B, A) is not an immediate repeat, but it
    is a cursor already seen in this window and must raise, not walk to the ceiling."""
    ex = _NewestFirstBybitTransfers(
        _transfer_rows(120, _NOW_MS - 1_000), cursors=["off:50", "off:0", "off:50"]
    )
    with pytest.raises(TransferPageStalled) as err:
        await fetch_ccxt_transfers(
            ex, "deposits", since_ms=_NOW_MS - 20 * _DAY_MS, now_ms=_NOW_MS
        )
    assert "deposits" in str(err.value)
    assert len(ex.calls) == 3


@pytest.mark.asyncio
async def test_a_bybit_window_past_the_page_ceiling_raises_instead_of_truncating() -> None:
    """Round 1 WR-03: a cursor that keeps changing never ends the window. The 1000-page
    ceiling raises; it used to log and return the short list as a success."""
    ex = _NewestFirstBybitTransfers(
        _transfer_rows(1100, _NOW_MS - 1_000),
        cursors=[f"off:{i + 1}" for i in range(1001)],
    )
    with pytest.raises(TransferPageStalled) as err:
        await fetch_ccxt_transfers(
            ex, "deposits", since_ms=_NOW_MS - 20 * _DAY_MS, now_ms=_NOW_MS
        )
    assert "1000 pages" in str(err.value)
    assert len(ex.calls) == 1000


@pytest.mark.asyncio
async def test_a_bybit_page_whose_cursor_row_is_dropped_by_parsing_still_continues() -> None:
    """Round 1 WR-02 / H-1: ccxt writes the cursor onto one raw row and then drops any
    parsed row stamped 0 or None. When that row is the cursor carrier the parsed page
    holds no cursor, but the raw answer still does. Reading the cursor from the parsed
    row, or from ``exchange.last_json_response`` (off by default, so None in
    production), ended the window after page 1 and lost every older row (D-02). It is
    read from the raw answer of the call itself: 3 pages, one dropped row each, the
    other 117 rows come back."""
    ex = _NewestFirstBybitTransfers(
        _transfer_rows(120, _NOW_MS - 1_000), unstamped_newest=True
    )
    rows = await fetch_ccxt_transfers(
        ex, "deposits", since_ms=_NOW_MS - 20 * _DAY_MS, now_ms=_NOW_MS
    )
    assert [c[3] for c in ex.calls] == [None, "off:50", "off:100"]
    assert len(rows) == 117


@pytest.mark.asyncio
async def test_an_empty_bybit_page_ends_the_window_even_when_its_cursor_repeats() -> None:
    """Round 2 CR-01: a full page answers cursor ``off:50``, then the next answer holds no
    rows and still carries ``off:50``. An empty answer ends the window whatever cursor it
    carries (plan 05), so the 50 rows come back and nothing raises. Deciding the stop on
    the parsed page, with the cursor then already seen, raised ``TransferPageStalled`` on
    a complete read."""
    ex = _NewestFirstBybitTransfers(
        _transfer_rows(50, _NOW_MS - 1_000), cursors=["off:50", "off:50"]
    )
    rows = await fetch_ccxt_transfers(
        ex, "deposits", since_ms=_NOW_MS - 20 * _DAY_MS, now_ms=_NOW_MS
    )
    assert len(rows) == 50
    assert [c[3] for c in ex.calls] == [None, "off:50"]


class _FirstPageAllUnstamped(_NewestFirstBybitTransfers):
    """Page 1's rows are all stamped successAt "0", so ccxt parses every one away; the
    raw page is full and still carries a live cursor."""

    async def _record(self, request: dict[str, Any]) -> dict[str, Any]:
        answer = await super()._record(request)
        if len(self.calls) == 1:
            for row in answer["result"]["rows"]:
                row["successAt"] = "0"
        return answer


@pytest.mark.asyncio
async def test_a_full_bybit_page_whose_rows_all_parse_away_still_continues() -> None:
    """Round 3 WR-01: a full raw page whose parsed rows are all dropped (ccxt drops
    stamp 0) still carries a cursor, and the older rows behind it must be read (D-02).
    Stopping on the empty PARSED page would silently truncate the window."""
    ex = _FirstPageAllUnstamped(_transfer_rows(70, _NOW_MS - 1_000))
    rows = await fetch_ccxt_transfers(
        ex, "deposits", since_ms=_NOW_MS - 20 * _DAY_MS, now_ms=_NOW_MS
    )
    assert [c[3] for c in ex.calls] == [None, "off:50"]
    assert len(rows) == 20


@pytest.mark.asyncio
async def test_an_empty_bybit_page_with_a_fresh_cursor_ends_the_window() -> None:
    """Round 3 WR-01 (secondary): an empty RAW page ends the window even when it carries
    a cursor never seen before (plan 05); no further call is made."""
    ex = _NewestFirstBybitTransfers(
        _transfer_rows(50, _NOW_MS - 1_000), cursors=["off:50", "off:999", "off:1000"]
    )
    rows = await fetch_ccxt_transfers(
        ex, "deposits", since_ms=_NOW_MS - 20 * _DAY_MS, now_ms=_NOW_MS
    )
    assert len(rows) == 50
    assert len(ex.calls) == 2


@pytest.mark.asyncio
async def test_a_bybit_page_whose_rows_parsing_drops_logs_the_counts_only(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Round 2 F-2: ccxt's ``parse_transactions`` drops a row stamped 0 or None without a
    word, so a drifted stamp field reads as a clean list. The drop is logged as counts
    (kind, window start, raw rows, parsed rows) and nothing from the rows themselves."""
    ex = _NewestFirstBybitTransfers(
        _transfer_rows(3, _NOW_MS - 1_000), unstamped_newest=True
    )
    with caplog.at_level("WARNING", logger="quantalyze.analytics.ccxt_flow_fetch"):
        rows = await fetch_ccxt_transfers(
            ex, "deposits", since_ms=_NOW_MS - 20 * _DAY_MS, now_ms=_NOW_MS
        )
    assert len(rows) == 2
    drops = [r.getMessage() for r in caplog.records if "dropped by parsing" in r.getMessage()]
    assert len(drops) == 1
    assert "kind=deposits" in drops[0]
    assert "raw_rows=3" in drops[0]
    assert "parsed_rows=2" in drops[0]
    assert "t0" not in drops[0] and "USDT" not in drops[0]


@pytest.mark.asyncio
async def test_not_supported_on_a_later_bybit_page_returns_what_was_read() -> None:
    """WR-04: NotSupported is feature detection, so what was read is returned."""
    ex = _NewestFirstBybitTransfers(
        _transfer_rows(120, _NOW_MS - 1_000), not_supported_on_call=2
    )
    rows = await fetch_ccxt_transfers(
        ex, "deposits", since_ms=_NOW_MS - 20 * _DAY_MS, now_ms=_NOW_MS
    )
    assert len(ex.calls) == 2
    assert len(rows) == 50


@pytest.mark.asyncio
async def test_a_boundary_row_two_windows_return_is_kept_once() -> None:
    """Two abutting 30-day windows both return the row stamped on their shared
    boundary; it counts once (a double-counted flow corrupts the TWR base)."""
    since = _NOW_MS - 40 * _DAY_MS
    boundary = since + 30 * _DAY_MS
    rows_in = [
        {"id": "early", "timestamp": since + _DAY_MS, "amount": 1.0},
        {"id": "boundary", "timestamp": boundary, "amount": 2.0},
        {"id": "late", "timestamp": _NOW_MS - _DAY_MS, "amount": 3.0},
    ]
    ex = _NewestFirstBybitTransfers(rows_in)
    rows = await fetch_ccxt_transfers(ex, "deposits", since_ms=since, now_ms=_NOW_MS)
    assert len(ex.calls) == 2
    assert sorted(r["id"] for r in rows) == ["boundary", "early", "late"]
