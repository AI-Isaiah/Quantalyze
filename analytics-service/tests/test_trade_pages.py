"""Phase 167.2.1.1.2.1 TRADEPAGES, plan 01: the rebuild's trade read reaches every
trade the venue holds, for Bybit and for every venue that is neither OKX nor Bybit.

D-02: the read stops only on an empty page, on a cursor that does not advance, or at
the end of its window. It never stops on a page shorter than the requested limit.
Bybit is read in 7-day windows with an explicit end.

The fakes answer like the venue (see ``tests/_trade_pages.py``): a loop that stops
early reads fewer trades than the book holds and these tests see it.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from services import equity_reconstruction as er
from services.job_worker import classify_exception
from tests._trade_pages import DAY_MS, VenueTradeBook, real_ccxt_client, trade_rows
from tests.test_equity_reconstruction import _make_ohlcv_row


def _utc_midnight(day: Any) -> int:
    return int(datetime(day.year, day.month, day.day, tzinfo=timezone.utc).timestamp() * 1000)


async def test_a_bybit_window_with_a_quiet_first_week_and_more_than_one_page_reaches_the_replay_whole(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A Bybit account with nothing in its first weeks and 200 trades in one 7-day window
    must reach the replay whole. Before the fix the read asked with a start only, which
    Bybit answers as its first 7 days (empty here), so the replay saw none of them."""
    end_date = datetime.now(timezone.utc).date()
    start_date = end_date - timedelta(days=60)
    start_ms = _utc_midnight(start_date)

    # One trade on day 20 (window 2), 199 packed into days 22-27 (window 3, which holds
    # more than one 100-row page), 50 spread over days 30-40.
    trades = (
        trade_rows(1, start_ms + 20 * DAY_MS + 3_600_000, DAY_MS, id_prefix="a")
        + trade_rows(199, start_ms + 22 * DAY_MS, (5 * DAY_MS) // 199, id_prefix="b")
        + trade_rows(50, start_ms + 30 * DAY_MS, (10 * DAY_MS) // 50, id_prefix="c")
    )
    assert len(trades) == 250

    exchange = AsyncMock()
    exchange.id = "bybit"
    exchange.fetch_my_trades = AsyncMock(side_effect=VenueTradeBook(exchange, trades))
    exchange.fetch_deposits = AsyncMock(return_value=[])
    exchange.fetch_withdrawals = AsyncMock(return_value=[])
    exchange.fetch_ohlcv = AsyncMock(
        return_value=[_make_ohlcv_row(start_ms + d * DAY_MS, 50000.0) for d in range(62)]
    )

    seen: list[list[dict[str, Any]]] = []
    original = er._compute_daily_equity

    def _spy(trades_in: list[dict[str, Any]], *args: Any, **kwargs: Any) -> Any:
        seen.append(list(trades_in))
        return original(trades_in, *args, **kwargs)

    monkeypatch.setattr(er, "_compute_daily_equity", _spy)

    await er._fetch_and_price_window(exchange, "bybit", MagicMock(), start_date, end_date)

    assert len(seen) == 1
    assert len(seen[0]) == 250
    assert len({t["id"] for t in seen[0]}) == 250


# ---------------------------------------------------------------------------
# Task 2: the request shape and every page on REAL ccxt; the other-venue walk
# ---------------------------------------------------------------------------

_LOGGER = "quantalyze.analytics.equity_reconstruction"
_T0 = 1_700_000_000_000  # a fixed instant; the reads below never look at the wall clock
_SIGNATURE = "SIGNATURE-signed-url-secret"


def _venue_exchange(venue: str, trades: list[dict[str, Any]], *, page_cap: int | None = None) -> Any:
    exchange = AsyncMock()
    exchange.id = venue
    book = VenueTradeBook(exchange, trades, page_cap=page_cap)
    exchange.fetch_my_trades = AsyncMock(side_effect=book)
    exchange.book = book
    return exchange


def _warnings(caplog: pytest.LogCaptureFixture) -> list[logging.LogRecord]:
    return [r for r in caplog.records if r.name == _LOGGER and r.levelno == logging.WARNING]


def _falling_timestamps_exchange() -> tuple[Any, list[int]]:
    """A Bybit exchange that never runs out and never repeats itself: every call answers a full
    page of fresh ids whose timestamps all sit just below the ``until`` it was sent, with a fresh
    cursor. Each segment therefore lowers the end bound by a hundred milliseconds, so only the
    segment ceiling can stop it. Returns the exchange and its list of call ``until`` values."""
    untils: list[int] = []

    async def _fall(_symbol: Any, _since: Any, _limit: Any, params: dict[str, Any]) -> list[dict[str, Any]]:
        untils.append(int(params["until"]))
        call = len(untils)
        rows = trade_rows(100, int(params["until"]) - 100, 1, id_prefix=f"f{call}-")
        for row in rows:
            row["info"] = {"note": _SIGNATURE}
        rows[-1]["info"]["nextPageCursor"] = f"cursor-{call}"
        return rows

    exchange = AsyncMock()
    exchange.id = "bybit"
    exchange.fetch_my_trades = AsyncMock(side_effect=_fall)
    return exchange, untils


async def test_bybit_reads_every_page_of_a_window_holding_more_than_one_page() -> None:
    """250 trades inside one 7-day window, served at most 100 per page, are all read.
    Real ccxt builds the request and parses the answer."""
    trades = trade_rows(250, _T0 + DAY_MS, 60_000)
    client = real_ccxt_client("bybit", trades)
    try:
        read, hit_terminus = await er._fetch_trades_with_pagination(
            client, "bybit", _T0, _T0 + 6 * DAY_MS
        )
    finally:
        await client.close()
    assert hit_terminus is False
    assert len(read) == 250
    assert len({t["id"] for t in read}) == 250


async def test_bybit_reads_trades_after_a_quiet_first_week() -> None:
    """Nothing in the first 30 days of a 120-day range: the trades after day 30 are read.
    A request carrying only a start is answered as the first 7 days, which are empty."""
    trades = trade_rows(60, _T0 + 31 * DAY_MS, DAY_MS, symbol="ETH/USDT")
    client = real_ccxt_client("bybit", trades)
    try:
        read, _ = await er._fetch_trades_with_pagination(
            client, "bybit", _T0, _T0 + 120 * DAY_MS
        )
    finally:
        await client.close()
    assert len({t["id"] for t in read}) == 60


async def test_every_bybit_request_names_a_start_and_an_end_at_most_seven_days_apart() -> None:
    """Every raw request carries startTime and endTime at most 7 days apart and a limit of
    100, and the windows tile [since, now] with no gap and no overlap."""
    now = _T0 + 120 * DAY_MS + 12_345
    trades = trade_rows(250, _T0 + 40 * DAY_MS, 60_000)
    client = real_ccxt_client("bybit", trades)
    try:
        read, _ = await er._fetch_trades_with_pagination(client, "bybit", _T0, now)
    finally:
        await client.close()

    assert len({t["id"] for t in read}) == 250
    requests = client.raw_requests
    assert requests
    for request in requests:
        assert "startTime" in request and "endTime" in request
        assert request["endTime"] - request["startTime"] <= 7 * DAY_MS
        assert request["limit"] == 100

    windows = sorted({(r["startTime"], r["endTime"]) for r in requests})
    assert windows[0][0] == _T0
    assert windows[-1][1] == now
    for (_, previous_end), (next_start, _) in zip(windows, windows[1:]):
        assert next_start == previous_end + 1


async def test_the_other_venue_walk_reads_past_a_page_shorter_than_its_request() -> None:
    """A venue serving at most 100 rows to a 500-row request has not run out of trades
    when a page holds 100. All 250 are read."""
    trades = trade_rows(250, _T0 + DAY_MS, 60_000)
    exchange = _venue_exchange("binance", trades, page_cap=100)
    read, hit_terminus = await er._fetch_trades_with_pagination(
        exchange, "binance", _T0, _T0 + 10 * DAY_MS
    )
    assert hit_terminus is False
    assert len({t["id"] for t in read}) == 250
    assert all(call["limit"] == 500 for call in exchange.book.calls)


async def test_binance_walks_forward_and_ends_on_a_page_that_adds_nothing() -> None:
    """One page of trades then a page holding only the newest of them again (the cursor sits
    on it) is two calls, and no OKX or Bybit parameter is ever sent."""
    exchange = _venue_exchange("binance", trade_rows(3, _T0 + DAY_MS, 60_000))
    read, _ = await er._fetch_trades_with_pagination(
        exchange, "binance", _T0, _T0 + 10 * DAY_MS
    )
    assert len(read) == 3
    assert [call["rows"] for call in exchange.book.calls] == [3, 1]
    for call in exchange.book.calls:
        assert not ({"type", "until", "cursor"} & set(call["params"]))


@pytest.mark.parametrize("venue", ["bybit", "binance"])
async def test_a_venue_that_repeats_its_page_ends_the_read_with_one_warning(
    venue: str, caplog: pytest.LogCaptureFixture
) -> None:
    """A venue that answers the same full page whatever it is asked cannot be read to its
    end: the read raises a permanent-class error rather than hand back that one page as the
    whole book, one WARNING carries the venue and counts, and nothing the venue sent reaches
    a log record."""
    page = trade_rows(100, _T0 + DAY_MS, 60_000)
    for row in page:
        row["info"] = {"note": _SIGNATURE}
    if venue == "bybit":
        page[-1]["info"]["nextPageCursor"] = "same-cursor"
        since, now = _T0, _T0 + 3 * DAY_MS  # one window, so one repeat

    else:
        since, now = _T0, _T0 + 10 * DAY_MS

    async def _same_page(*_args: Any, **_kwargs: Any) -> list[dict[str, Any]]:
        return [dict(t, info=dict(t["info"])) for t in page]

    exchange = AsyncMock()
    exchange.id = venue
    exchange.fetch_my_trades = AsyncMock(side_effect=_same_page)

    caplog.set_level(logging.WARNING, logger=_LOGGER)
    with pytest.raises(er.TruncatedTradeRead) as excinfo:
        await er._fetch_trades_with_pagination(exchange, venue, since, now)

    # The forced gather converter maps a permanent class to account_key_read_failed.
    assert classify_exception(excinfo.value)[0] == "permanent"
    assert excinfo.value.site == ("bybit_no_advance" if venue == "bybit" else "generic_no_advance")
    warnings = _warnings(caplog)
    assert len(warnings) == 1
    message = warnings[0].getMessage()
    assert venue in message
    assert "100" in message
    for record in caplog.records:
        assert _SIGNATURE not in record.getMessage()


async def test_a_window_that_ends_on_a_short_page_logs_nothing(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Windows that end on a short last page and on an empty page are the normal end of a
    window, not a warning."""
    week = 7 * DAY_MS
    trades = (
        trade_rows(130, _T0 + 1000, 1000, id_prefix="a")  # window 1: a full page, then 30
        + trade_rows(7, _T0 + 3 * week + 1000, 1000, id_prefix="c")  # window 4: a short page
    )
    exchange = _venue_exchange("bybit", trades)
    caplog.set_level(logging.WARNING, logger=_LOGGER)
    read, _ = await er._fetch_trades_with_pagination(exchange, "bybit", _T0, _T0 + 5 * week)
    assert len({t["id"] for t in read}) == 137
    assert any(call["rows"] == 0 for call in exchange.book.calls)  # windows 2, 3 and 5
    assert _warnings(caplog) == []


async def test_a_bybit_window_ending_on_a_full_page_with_no_cursor_warns_but_is_not_refused(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A window whose last page is full and carries no cursor may have more rows behind it,
    so one counts-only WARNING is logged. It is not refused: a final page of exactly 100 rows
    legitimately has no cursor, and the 100 rows are still read."""
    trades = trade_rows(100, _T0 + 1000, 1000, symbol="BTC/USDT", id_prefix="b")
    for row in trades:
        row["info"] = {"note": _SIGNATURE}
    exchange = _venue_exchange("bybit", trades)
    caplog.set_level(logging.WARNING, logger=_LOGGER)
    read, _ = await er._fetch_trades_with_pagination(exchange, "bybit", _T0, _T0 + 3 * DAY_MS)

    assert len({t["id"] for t in read}) == 100
    warnings = _warnings(caplog)
    assert len(warnings) == 1
    message = warnings[0].getMessage()
    assert "no cursor" in message and "bybit" in message and "100" in message
    for record in caplog.records:
        assert _SIGNATURE not in record.getMessage()


async def test_a_bybit_window_that_never_runs_out_stops_loudly_when_its_end_cannot_be_lowered(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A venue that answers a full page of new rows and a new cursor forever, all at the same
    timestamps, is cut off: one WARNING that carries counts only, and the read raises rather
    than hand back the rows read so far as the whole window.

    READCEILING (Phase 171) moved this pin. It used to assert ``calls == page ceiling`` and a
    "ceiling" WARNING, because the first segment's ceiling was the stop. A window is now
    continued by time, so this fake reads two segments (the second ends on the same oldest
    timestamp, its end bound one past it), takes the one retry with the end AT the oldest
    timestamp (its pages carry rows newer than the oldest), and only then stops, on the rule
    that the end bound cannot be lowered: three segments of pages."""
    calls = 0

    async def _endless(*_args: Any, **_kwargs: Any) -> list[dict[str, Any]]:
        nonlocal calls
        calls += 1
        rows = trade_rows(100, _T0 + DAY_MS, 1000, id_prefix=f"p{calls}-")
        for row in rows:
            row["info"] = {"note": _SIGNATURE}
        rows[-1]["info"]["nextPageCursor"] = f"cursor-{calls}"
        return rows

    exchange = AsyncMock()
    exchange.id = "bybit"
    exchange.fetch_my_trades = AsyncMock(side_effect=_endless)

    caplog.set_level(logging.WARNING, logger=_LOGGER)
    with pytest.raises(er.TruncatedTradeRead) as excinfo:
        await er._fetch_trades_with_pagination(exchange, "bybit", _T0, _T0 + 3 * DAY_MS)

    assert calls == 3 * er._BYBIT_WINDOW_PAGE_CEILING
    assert excinfo.value.site == "bybit_no_advance"
    warnings = _warnings(caplog)
    assert len(warnings) == 1
    assert "did not advance" in warnings[0].getMessage()
    for record in caplog.records:
        assert _SIGNATURE not in record.getMessage()


async def test_the_other_venue_walk_that_never_runs_out_hits_the_page_ceiling_loudly(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A venue answering a full page of newer new rows forever is cut off at the ceiling:
    one WARNING that carries counts only, and the read raises rather than hand back the
    first 500 pages as the whole book."""
    calls = 0

    async def _newer_every_time(*_args: Any, **_kwargs: Any) -> list[dict[str, Any]]:
        nonlocal calls
        calls += 1
        rows = trade_rows(100, _T0 + calls * DAY_MS, 1000, id_prefix=f"p{calls}-")
        for row in rows:
            row["info"] = {"note": _SIGNATURE}
        return rows

    exchange = AsyncMock()
    exchange.id = "binance"
    exchange.fetch_my_trades = AsyncMock(side_effect=_newer_every_time)

    caplog.set_level(logging.WARNING, logger=_LOGGER)
    with pytest.raises(er.TruncatedTradeRead) as excinfo:
        await er._fetch_trades_with_pagination(exchange, "binance", _T0, _T0 + 10 * DAY_MS)

    assert excinfo.value.site == "generic_page_ceiling"
    assert calls == er._TRADE_PASS_PAGE_CEILING
    warnings = _warnings(caplog)
    assert len(warnings) == 1
    assert "ceiling" in warnings[0].getMessage()
    for record in caplog.records:
        assert _SIGNATURE not in record.getMessage()


# ---------------------------------------------------------------------------
# Plan 02: OKX, each instrument type walked backward with an explicit end (D-02)
# ---------------------------------------------------------------------------


async def test_an_okx_account_s_fills_older_than_the_newest_page_reach_the_replay_whole(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An OKX account with 250 swap fills inside its 90-day window must reach the replay
    whole. OKX answers the NEWEST 100 fills of its range, so a forward cursor (start = newest
    + 1) can never reach the older ones: before the fix the read kept 100 of 250."""
    end_date = datetime.now(timezone.utc).date()
    start_date = end_date - timedelta(days=60)
    start_ms = _utc_midnight(start_date)

    trades = trade_rows(
        250,
        start_ms + DAY_MS,
        (58 * DAY_MS) // 250,
        symbol="BTC/USDT:USDT",
        inst_type="SWAP",
    )
    assert len(trades) == 250

    exchange = AsyncMock()
    exchange.id = "okx"
    exchange.fetch_my_trades = AsyncMock(side_effect=VenueTradeBook(exchange, trades))
    exchange.fetch_deposits = AsyncMock(return_value=[])
    exchange.fetch_withdrawals = AsyncMock(return_value=[])
    exchange.fetch_ohlcv = AsyncMock(
        return_value=[_make_ohlcv_row(start_ms + d * DAY_MS, 50000.0) for d in range(62)]
    )

    seen: list[list[dict[str, Any]]] = []
    original = er._compute_daily_equity

    def _spy(trades_in: list[dict[str, Any]], *args: Any, **kwargs: Any) -> Any:
        seen.append(list(trades_in))
        return original(trades_in, *args, **kwargs)

    monkeypatch.setattr(er, "_compute_daily_equity", _spy)

    await er._fetch_and_price_window(exchange, "okx", MagicMock(), start_date, end_date)

    assert len(seen) == 1
    assert len(seen[0]) == 250
    assert len({t["id"] for t in seen[0]}) == 250


# ---------------------------------------------------------------------------
# Task 2: the OKX request shape, ties at the page edge and the loud stops
# ---------------------------------------------------------------------------


async def _read_okx(client: Any, *, now: int, since: int) -> list[dict[str, Any]]:
    try:
        read, hit_terminus = await er._fetch_trades_with_pagination(client, "okx", since, now)
    finally:
        await client.close()
    assert hit_terminus is False
    return read


async def test_okx_reads_fills_older_than_the_newest_page() -> None:
    """250 swap fills over 80 days, served newest 100 first by real ccxt okx, are all read."""
    now = _T0 + 100 * DAY_MS
    trades = trade_rows(
        250, now - 85 * DAY_MS, (80 * DAY_MS) // 250, symbol="BTC/USDT:USDT", inst_type="SWAP"
    )
    client = real_ccxt_client("okx", trades)
    read = await _read_okx(client, now=now, since=now - 86 * DAY_MS)
    assert len(read) == 250
    assert len({t["id"] for t in read}) == 250


async def test_okx_reads_every_instrument_type_backward() -> None:
    """Fills split over SPOT and SWAP, more than 100 in each, are all read. Every request
    after a pass's first names an end and the same instType; no request carries a limit."""
    now = _T0 + 100 * DAY_MS
    since = now - 86 * DAY_MS
    spot = trade_rows(150, now - 80 * DAY_MS, 60_000, symbol="ETH/USDT", inst_type="SPOT", id_prefix="s")
    swap = trade_rows(
        220, now - 70 * DAY_MS, 90_000, symbol="BTC/USDT:USDT", inst_type="SWAP", id_prefix="w"
    )
    client = real_ccxt_client("okx", spot + swap)
    read = await _read_okx(client, now=now, since=since)
    assert len({t["id"] for t in read}) == 370
    assert len(read) == 370

    by_type: dict[str, list[dict[str, Any]]] = {}
    for request in client.raw_requests:
        by_type.setdefault(request["instType"], []).append(request)
        assert "limit" not in request
        assert request["begin"] == since
    assert set(by_type) == {t.upper() for t in er.OKX_INSTRUMENT_TYPES}
    for requests in by_type.values():
        assert "end" not in requests[0]
        ends = [r["end"] for r in requests[1:]]
        assert len(ends) == len(requests) - 1
        assert ends == sorted(ends, reverse=True)
    assert len(by_type["SPOT"]) >= 2 and len(by_type["SWAP"]) >= 3


@pytest.mark.parametrize("end_exclusive", [False, True], ids=["inclusive", "exclusive"])
async def test_okx_reads_a_same_millisecond_group_split_at_the_page_edge_once(
    end_exclusive: bool,
) -> None:
    """The 30 fills ranked 85th to 114th newest share one millisecond, so the 100-row page
    edge splits the group. Under either reading of OKX's end bound all 250 fills are read,
    each once."""
    now = _T0 + 100 * DAY_MS
    trades = trade_rows(
        250, now - 80 * DAY_MS, 60_000, symbol="BTC/USDT:USDT", inst_type="SWAP"
    )
    # newest-first ranks 85..114 are ascending indices 136..165
    group_ms = trades[136]["timestamp"]
    for trade in trades[136:166]:
        trade["timestamp"] = group_ms
    client = real_ccxt_client("okx", trades, end_exclusive=end_exclusive)
    read = await _read_okx(client, now=now, since=now - 86 * DAY_MS)
    ids = [t["id"] for t in read]
    assert len(ids) == 250
    assert len(set(ids)) == 250


@pytest.mark.parametrize("end_exclusive", [False, True], ids=["inclusive", "exclusive"])
async def test_okx_reads_a_burst_spanning_two_adjacent_milliseconds_whole(
    end_exclusive: bool,
) -> None:
    """One large order filled against 110 resting orders over two adjacent milliseconds (50
    at T, 60 at T+1) with 30 older fills. Under an inclusive end the fills at T+1 are asked
    for again and take page capacity, so the walk used to stop on a page that did not advance
    and the account could never be rebuilt. All 140 fills are read under either bound."""
    now = _T0 + 100 * DAY_MS
    burst = now - 10 * DAY_MS
    older = trade_rows(30, now - 50 * DAY_MS, 60_000, symbol="BTC/USDT:USDT", inst_type="SWAP", id_prefix="o")
    at_t = trade_rows(50, burst, 0, symbol="BTC/USDT:USDT", inst_type="SWAP", id_prefix="g")
    at_t1 = trade_rows(60, burst + 1, 0, symbol="BTC/USDT:USDT", inst_type="SWAP", id_prefix="h")
    client = real_ccxt_client("okx", older + at_t + at_t1, end_exclusive=end_exclusive)
    read = await _read_okx(client, now=now, since=now - 86 * DAY_MS)
    assert len(read) == 140
    assert len({t["id"] for t in read}) == 140


@pytest.mark.parametrize("end_exclusive", [False, True], ids=["inclusive", "exclusive"])
async def test_okx_refuses_a_single_millisecond_group_larger_than_a_page(
    end_exclusive: bool,
) -> None:
    """120 fills at one millisecond cannot be passed by any timestamp bound. The retry must
    not step the end below them: under an exclusive end that would skip the rest of the group
    and hand back the older fills as the whole book. The read raises instead, either way."""
    now = _T0 + 100 * DAY_MS
    older = trade_rows(30, now - 50 * DAY_MS, 60_000, symbol="BTC/USDT:USDT", inst_type="SWAP", id_prefix="o")
    group = trade_rows(120, now - 10 * DAY_MS, 0, symbol="BTC/USDT:USDT", inst_type="SWAP", id_prefix="g")
    client = real_ccxt_client("okx", older + group, end_exclusive=end_exclusive)
    with pytest.raises(er.TruncatedTradeRead) as excinfo:
        await _read_okx(client, now=now, since=now - 86 * DAY_MS)
    assert excinfo.value.site == "okx_no_advance"


def _okx_only_swap(page_for: Any) -> Any:
    exchange = AsyncMock()
    exchange.id = "okx"

    async def _fetch(
        _symbol: Any, _since: Any, _limit: Any, params: dict[str, Any]
    ) -> list[dict[str, Any]]:
        if params.get("type") != "swap":
            return []
        return page_for(dict(params))  # type: ignore[no-any-return]

    exchange.fetch_my_trades = AsyncMock(side_effect=_fetch)
    return exchange


async def test_an_okx_pass_that_repeats_its_page_ends_with_one_warning(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A venue answering the same full page whatever end it is asked cannot be read to its
    end: the read raises a permanent-class error rather than hand back that page as the
    whole pass, one WARNING names okx and counts, and no venue text is logged."""
    now = _T0 + 100 * DAY_MS
    page = trade_rows(100, now - 50 * DAY_MS, 60_000, symbol="BTC/USDT:USDT", inst_type="SWAP")
    for row in page:
        row["info"]["note"] = _SIGNATURE
    exchange = _okx_only_swap(lambda _params: [dict(t, info=dict(t["info"])) for t in page])

    caplog.set_level(logging.WARNING, logger=_LOGGER)
    with pytest.raises(er.TruncatedTradeRead) as excinfo:
        await er._fetch_trades_with_pagination(exchange, "okx", now - 86 * DAY_MS, now)

    assert classify_exception(excinfo.value)[0] == "permanent"
    assert excinfo.value.site == "okx_no_advance"
    warnings = _warnings(caplog)
    assert len(warnings) == 1
    message = warnings[0].getMessage()
    assert "okx" in message and "swap" in message.lower()
    assert "100" in message
    for record in caplog.records:
        assert _SIGNATURE not in record.getMessage()


async def test_an_okx_pass_that_ends_on_a_short_page_logs_nothing(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A normal walk over 150 fills ends on a short page; that is the end, not a warning."""
    now = _T0 + 100 * DAY_MS
    trades = trade_rows(150, now - 60 * DAY_MS, 60_000, symbol="BTC/USDT:USDT", inst_type="SWAP")
    exchange = AsyncMock()
    exchange.id = "okx"
    exchange.fetch_my_trades = AsyncMock(side_effect=VenueTradeBook(exchange, trades))
    caplog.set_level(logging.WARNING, logger=_LOGGER)
    read, _ = await er._fetch_trades_with_pagination(exchange, "okx", now - 86 * DAY_MS, now)
    assert len({t["id"] for t in read}) == 150
    assert _warnings(caplog) == []


async def test_an_okx_pass_that_never_runs_out_hits_the_page_ceiling_loudly(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A venue answering a full page of ever older new fills forever is cut off at the
    ceiling: one WARNING that carries counts only, and the read raises rather than hand back
    the newest 50,000 fills as the whole pass."""
    now = _T0 + 100 * DAY_MS
    top = now - 10 * DAY_MS
    calls = 0

    def _older_every_time(_params: dict[str, Any]) -> list[dict[str, Any]]:
        nonlocal calls
        calls += 1
        rows = trade_rows(
            100, top - calls * 100, 1, symbol="BTC/USDT:USDT", inst_type="SWAP", id_prefix=f"p{calls}-"
        )
        for row in rows:
            row["info"]["note"] = _SIGNATURE
        return rows

    exchange = _okx_only_swap(_older_every_time)
    caplog.set_level(logging.WARNING, logger=_LOGGER)
    with pytest.raises(er.TruncatedTradeRead) as excinfo:
        await er._fetch_trades_with_pagination(exchange, "okx", now - 86 * DAY_MS, now)

    assert excinfo.value.site == "okx_page_ceiling"
    assert calls == er._TRADE_PASS_PAGE_CEILING
    warnings = _warnings(caplog)
    assert len(warnings) == 1
    assert "ceiling" in warnings[0].getMessage()
    for record in caplog.records:
        assert _SIGNATURE not in record.getMessage()


# ---------------------------------------------------------------------------
# Fixer round 1 (review CR-01): the dedupe key names the instrument
# ---------------------------------------------------------------------------


async def test_okx_fills_of_two_instruments_that_share_a_trade_id_are_both_read() -> None:
    """OKX numbers ``tradeId`` per instrument, so a BTC swap fill and an ETH swap fill of
    one pass can carry the same id. Deduping on the id alone dropped every ETH fill whose
    id a BTC fill held; both instruments' fills must reach the replay."""
    now = _T0 + 100 * DAY_MS
    first = now - 50 * DAY_MS
    btc = trade_rows(5, first, 60_000, symbol="BTC/USDT:USDT", inst_type="SWAP")
    eth = trade_rows(5, first + 1, 60_000, symbol="ETH/USDT:USDT", inst_type="SWAP")
    assert {t["id"] for t in btc} == {t["id"] for t in eth}

    client = real_ccxt_client("okx", btc + eth)
    read = await _read_okx(client, now=now, since=now - 86 * DAY_MS)

    assert len(read) == 10
    assert len({t["symbol"] for t in read}) == 2


# ---------------------------------------------------------------------------
# Fixer round 1 (review SFH F3): NotSupported mid-walk is a cut-short read
# ---------------------------------------------------------------------------


def _not_supported_after_first_page(venue: str, now: int) -> Any:
    """An exchange whose first ``fetch_my_trades`` answers a page that invites a second
    (a Bybit cursor, a full OKX page, a fresh other-venue page) and whose every later call
    raises ``NotSupported``."""
    calls = 0

    async def _fetch(*_args: Any, **_kwargs: Any) -> list[dict[str, Any]]:
        nonlocal calls
        calls += 1
        if calls > 1:
            raise er.ccxt.NotSupported("fixture: not supported")
        if venue == "okx":
            return trade_rows(100, now - 50 * DAY_MS, 1000, symbol="BTC/USDT:USDT", inst_type="SWAP")
        rows = trade_rows(3, now - 50 * DAY_MS, 1000)
        if venue == "bybit":
            rows[-1]["info"]["nextPageCursor"] = "more"
        return rows

    exchange = AsyncMock()
    exchange.id = venue
    exchange.fetch_my_trades = AsyncMock(side_effect=_fetch)
    return exchange


@pytest.mark.parametrize("venue", ["bybit", "okx", "binance"])
async def test_not_supported_after_rows_were_read_fails_the_read(venue: str) -> None:
    """The venue stops answering part way through a walk: the rows read so far are not the
    book, so the read raises a permanent-class error instead of returning them."""
    now = _T0 + 100 * DAY_MS
    exchange = _not_supported_after_first_page(venue, now)
    with pytest.raises(er.TruncatedTradeRead) as excinfo:
        await er._fetch_trades_with_pagination(exchange, venue, now - 86 * DAY_MS, now)
    assert classify_exception(excinfo.value)[0] == "permanent"
    assert excinfo.value.site == ("generic" if venue == "binance" else venue) + "_not_supported"


@pytest.mark.parametrize("venue", ["bybit", "okx", "binance"])
async def test_not_supported_before_any_row_was_read_returns_nothing(venue: str) -> None:
    """A venue that cannot enumerate trades at all still yields an empty book, as before."""
    exchange = AsyncMock()
    exchange.id = venue
    exchange.fetch_my_trades = AsyncMock(side_effect=er.ccxt.NotSupported("fixture"))
    read, _ = await er._fetch_trades_with_pagination(
        exchange, venue, _T0 + 90 * DAY_MS, _T0 + 100 * DAY_MS
    )
    assert read == []


# ---------------------------------------------------------------------------
# Fixer round 1 (review WR-02 / SFH F2): the other-venue walk keeps rows at its cursor
# ---------------------------------------------------------------------------


async def test_the_other_venue_walk_reads_a_last_page_sitting_exactly_on_the_cursor() -> None:
    """101 trades 1 ms apart, served 100 at a time: the 101st is the only row of the second
    page that is new, and it is one millisecond past the first page's newest. A cursor that
    stepped past the newest row, and a check that called this page non-advancing, dropped it."""
    exchange = _venue_exchange("binance", trade_rows(101, _T0 + DAY_MS, 1), page_cap=100)
    read, _ = await er._fetch_trades_with_pagination(
        exchange, "binance", _T0, _T0 + 10 * DAY_MS
    )
    assert len({t["id"] for t in read}) == 101
    assert len(read) == 101


async def test_the_other_venue_walk_reads_the_rest_of_a_same_millisecond_group_cut_by_a_page() -> None:
    """30 fills share one millisecond and the 100-row page edge falls inside that group. The
    rest of the group is read, each fill once."""
    trades = trade_rows(150, _T0 + DAY_MS, 60_000)
    group_ms = trades[85]["timestamp"]
    for trade in trades[85:115]:
        trade["timestamp"] = group_ms
    exchange = _venue_exchange("binance", trades, page_cap=100)
    read, _ = await er._fetch_trades_with_pagination(
        exchange, "binance", _T0, _T0 + 10 * DAY_MS
    )
    assert len({t["id"] for t in read}) == 150
    assert len(read) == 150


async def test_the_other_venue_walk_reads_rows_with_no_id_once_each() -> None:
    """A row with no id cannot be deduped, so the cursor must step past the newest one: the
    boundary row is not read again on every page, and the walk ends instead of running to the
    page ceiling (which would fail the read)."""
    rows = trade_rows(150, _T0 + DAY_MS, 1)
    for row in rows:
        del row["id"]

    async def _serve(_symbol: Any, since: int, _limit: int, _params: dict[str, Any]) -> list[dict[str, Any]]:
        return [dict(r) for r in rows if r["timestamp"] >= since][:100]

    exchange = AsyncMock()
    exchange.id = "binance"
    exchange.fetch_my_trades = AsyncMock(side_effect=_serve)
    read, _ = await er._fetch_trades_with_pagination(
        exchange, "binance", _T0, _T0 + 10 * DAY_MS
    )
    assert len(read) == 150
    assert len({t["timestamp"] for t in read}) == 150


# ---------------------------------------------------------------------------
# Phase 171 READCEILING plan 02: the boundary cases of continuing a window by time
# ---------------------------------------------------------------------------

_SEGMENT_PAGES = 3  # pages per segment in the small-segment tests below
_SEGMENT_CAP = 10  # rows per page, so a segment holds 30 rows


def _small_segments(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(er, "_BYBIT_WINDOW_PAGE_CEILING", _SEGMENT_PAGES)


async def test_a_same_millisecond_group_across_a_segment_edge_is_read_whole(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """The first 30-row segment ends INSIDE a group of rows sharing one millisecond: 15 rows at
    T+1 and 15 of the 18 at T. The next segment re-reads that boundary by design (an inclusive
    end bound), so it adds nothing and is not a stall; the one retry with the end AT T then
    reaches the rest of the group and everything older. Every row is read, with no WARNING."""
    _small_segments(monkeypatch)
    group_ms = _T0 + 2 * DAY_MS
    trades = (
        trade_rows(25, _T0 + DAY_MS, 1000, id_prefix="o")
        + trade_rows(18, group_ms, 0, id_prefix="g")
        + trade_rows(15, group_ms + 1, 0, id_prefix="h")
    )
    exchange = _venue_exchange("bybit", trades, page_cap=_SEGMENT_CAP)

    caplog.set_level(logging.WARNING, logger=_LOGGER)
    read, _ = await er._fetch_trades_with_pagination(exchange, "bybit", _T0, _T0 + 3 * DAY_MS)

    assert len({t["id"] for t in read}) == 58
    assert len(read) == 58
    assert _warnings(caplog) == []


async def test_more_than_a_segment_of_executions_at_one_millisecond_stops_loudly(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """31 rows at ONE millisecond cannot be passed by any timestamp bound when a segment holds
    30: the next segment re-reads the same 30. It must stop, loudly and once, rather than hand
    back 30 of 31 as the whole window."""
    _small_segments(monkeypatch)
    trades = trade_rows(31, _T0 + 2 * DAY_MS, 0, id_prefix="g")
    for row in trades:
        row["info"]["note"] = _SIGNATURE
    exchange = _venue_exchange("bybit", trades, page_cap=_SEGMENT_CAP)

    caplog.set_level(logging.WARNING, logger=_LOGGER)
    with pytest.raises(er.TruncatedTradeRead) as excinfo:
        await er._fetch_trades_with_pagination(exchange, "bybit", _T0, _T0 + 3 * DAY_MS)

    assert excinfo.value.site == "bybit_no_advance"
    warnings = _warnings(caplog)
    assert len(warnings) == 1
    assert "did not advance" in warnings[0].getMessage()
    for record in caplog.records:
        assert _SIGNATURE not in record.getMessage()


async def test_a_bybit_window_whose_timestamps_never_run_out_stops_at_the_segment_ceiling(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """Every segment of this venue lowers the end bound, so the strict-lowering stop never
    fires; only the segment ceiling can end it. Four segments of three pages, then one WARNING
    and a typed site."""
    monkeypatch.setattr(er, "_BYBIT_WINDOW_PAGE_CEILING", _SEGMENT_PAGES)
    monkeypatch.setattr(er, "_BYBIT_WINDOW_SEGMENT_CEILING", 4)
    exchange, untils = _falling_timestamps_exchange()

    caplog.set_level(logging.WARNING, logger=_LOGGER)
    with pytest.raises(er.TruncatedTradeRead) as excinfo:
        await er._fetch_trades_with_pagination(exchange, "bybit", _T0, _T0 + 3 * DAY_MS)

    assert excinfo.value.site == "bybit_segment_ceiling"
    assert len(untils) == 4 * _SEGMENT_PAGES
    per_segment = untils[::_SEGMENT_PAGES]
    assert per_segment == sorted(set(per_segment), reverse=True)  # each segment's end is strictly lower
    warnings = _warnings(caplog)
    assert len(warnings) == 1
    assert "segment ceiling" in warnings[0].getMessage()
    for record in caplog.records:
        assert _SIGNATURE not in record.getMessage()


async def test_an_empty_first_page_of_a_continuation_segment_is_refused_not_taken_as_the_end(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """WR-01 (171 fix round 1). A continuation segment asks for ``[start, oldest + 1]``, which holds
    the rows already read at ``oldest``, so an EMPTY answer to its first page means the venue
    misbehaved. It was taken as the end of the window: 30 of 100 rows came back as the whole
    window with no warning. It is refused, once and counts-only, as an uncertain stop."""
    _small_segments(monkeypatch)
    trades = trade_rows(100, _T0 + DAY_MS, 1000, id_prefix="e")
    for row in trades:
        row["info"]["note"] = _SIGNATURE
    exchange = _venue_exchange("bybit", trades, page_cap=_SEGMENT_CAP)
    book = exchange.book
    cursorless = 0

    async def _empty_on_the_second_segment(symbol: Any, since: Any, limit: Any, params: dict[str, Any]) -> Any:
        nonlocal cursorless
        if not params.get("cursor"):
            cursorless += 1
            if cursorless == 2:
                return []
        return await book(symbol, since, limit, params)

    exchange.fetch_my_trades = AsyncMock(side_effect=_empty_on_the_second_segment)

    caplog.set_level(logging.WARNING, logger=_LOGGER)
    with pytest.raises(er.TruncatedTradeRead) as excinfo:
        await er._fetch_trades_with_pagination(exchange, "bybit", _T0, _T0 + 3 * DAY_MS)

    assert excinfo.value.site == "bybit_no_advance"
    warnings = _warnings(caplog)
    assert len(warnings) == 1
    assert "did not advance" in warnings[0].getMessage()
    for record in caplog.records:
        assert _SIGNATURE not in record.getMessage()


def _short_last_page_that_keeps_a_cursor(*, same_cursor: bool) -> tuple[Any, list[Any]]:
    """A Bybit exchange holding 150 rows (distinct milliseconds). The first page is the newest 100
    with a cursor; every request that carries a cursor answers the same short 50-row last page
    WITH a cursor again, the one it was sent (``same_cursor``) or a fresh one (so the page adds no
    new row). Returns the exchange and the list of cursors sent."""
    newest_first = sorted(trade_rows(150, _T0 + DAY_MS, 1000, id_prefix="r"), key=lambda r: -r["timestamp"])
    sent: list[Any] = []

    async def _fetch(_symbol: Any, _since: Any, _limit: Any, params: dict[str, Any]) -> list[dict[str, Any]]:
        cursor = params.get("cursor")
        sent.append(cursor)
        if cursor is None:
            page, nxt = newest_first[:100], "c1"
        else:
            page, nxt = newest_first[100:], ("c1" if same_cursor else f"c{len(sent)}")
        page = [dict(r, info=dict(r["info"])) for r in page]
        page[0]["info"]["nextPageCursor"] = nxt
        return list(reversed(page))  # ccxt re-sorts a page ascending

    exchange = AsyncMock()
    exchange.id = "bybit"
    exchange.fetch_my_trades = AsyncMock(side_effect=_fetch)
    return exchange, sent


@pytest.mark.parametrize("same_cursor", [True, False])
async def test_a_short_page_that_repeats_its_cursor_or_adds_nothing_ends_the_window(
    same_cursor: bool, caplog: pytest.LogCaptureFixture
) -> None:
    """WR-02 (171 fix round 1), TRADEPAGES D-02: a walk stops on an empty page, a non-advancing
    cursor or the window end. A SHORT page that repeats its cursor or adds no row is such a
    non-advancing end, and the window is complete with every row read. Plan 02 had made it a
    stalled segment continued by time, which ends in a permanent ``bybit_no_advance`` refusal for a
    venue quirk the deployed read had always survived. Only a FULL stalled page continues by time."""
    exchange, sent = _short_last_page_that_keeps_a_cursor(same_cursor=same_cursor)

    caplog.set_level(logging.WARNING, logger=_LOGGER)
    read, _ = await er._fetch_trades_with_pagination(exchange, "bybit", _T0, _T0 + 3 * DAY_MS)

    assert len({t["id"] for t in read}) == 150
    # first page, last page; a fresh cursor needs one more request to show the page adds nothing
    assert len(sent) == (2 if same_cursor else 3)
    assert _warnings(caplog) == []


def test_every_truncated_read_names_a_closed_site() -> None:
    """D-01 pin. Every place the module raises ``TruncatedTradeRead`` passes the shared message
    and a string-literal ``site=``, the literals are exactly ``TRUNCATED_READ_SITES``, and a site
    outside the set cannot be constructed. A raise site that forgot its site would otherwise only
    show as a probe row that prints no site."""
    import ast
    import inspect

    tree = ast.parse(inspect.getsource(er))
    sites: list[str] = []
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "TruncatedTradeRead"):
            continue
        assert len(node.args) == 1 and isinstance(node.args[0], ast.Name)
        assert node.args[0].id == "_TRUNCATED_READ_MESSAGE"
        assert [k.arg for k in node.keywords] == ["site"], f"line {node.lineno}"
        value = node.keywords[0].value
        assert isinstance(value, ast.Constant) and isinstance(value.value, str), f"line {node.lineno}"
        sites.append(value.value)

    assert sorted(sites) == sorted(er.TRUNCATED_READ_SITES)  # nine raise sites, one token each
    with pytest.raises(ValueError):
        er.TruncatedTradeRead("x", site="nope")
