"""Phase 171 READCEILING, plan 02: a Bybit window above the page ceiling is read whole (SC-2).

WHY this file exists. The rebuild's Bybit read used to refuse a 7-day window the moment it held
more than ``_BYBIT_WINDOW_PAGE_CEILING`` pages (100 pages x 100 rows). An account with a busier week
than that could not be rebuilt at all. The window is now continued BY TIME inside a run: the end
bound is lowered to one millisecond past the oldest trade read and a new cursor-less segment starts
(the walk OKX already uses), so no cursor is relied on across segments and id dedupe absorbs the
overlap.

The older ceiling tests in ``test_trade_pages.py`` answer with an INFINITE fake (constant
timestamps, fresh ids, a fresh cursor forever). Such a fake cannot go RED at the old behaviour for
the reason that matters, because both the old and the new read stop on it. The tests here use a
FINITE book that the venue could serve to its end: the old read raised on it after exactly 100
calls, the new one returns every trade.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from services import equity_reconstruction as er
from services.job_worker import classify_exception
from tests._trade_pages import DAY_MS, VenueTradeBook, trade_rows
from tests.test_equity_reconstruction import _make_ohlcv_row
from tests.test_trade_pages import _LOGGER, _venue_exchange, _warnings

_SINCE = 1_700_000_000_000  # a fixed instant; the reads below never look at the wall clock


def falling_timestamps_exchange() -> tuple[Any, list[int]]:
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
            row["info"] = {"note": "SIGNATURE-signed-url-secret"}
        rows[-1]["info"]["nextPageCursor"] = f"cursor-{call}"
        return rows

    exchange = AsyncMock()
    exchange.id = "bybit"
    exchange.fetch_my_trades = AsyncMock(side_effect=_fall)
    return exchange, untils


async def test_an_over_ceiling_window_is_read_whole(caplog: pytest.LogCaptureFixture) -> None:
    """SC-2. A FINITE book of 10,500 trades inside one 7-day window holds more than one segment
    (100 pages x 100 rows = 10,000). At the old behaviour the read raised after exactly 100 calls;
    now the window is continued by time and every trade is read, with nothing to warn about."""
    trades = trade_rows(10_500, _SINCE + DAY_MS, 50, id_prefix="w")
    exchange = _venue_exchange("bybit", trades)

    caplog.set_level(logging.WARNING, logger=_LOGGER)
    read, _ = await er._fetch_trades_with_pagination(exchange, "bybit", _SINCE, _SINCE + 3 * DAY_MS)

    assert len(read) == 10_500
    assert len({t["id"] for t in read}) == 10_500
    assert len(exchange.book.calls) > er._BYBIT_WINDOW_PAGE_CEILING
    assert _warnings(caplog) == []


async def test_a_truncated_read_names_its_site(caplog: pytest.LogCaptureFixture) -> None:
    """D-01. Every truncation the Bybit walk raises carries a typed ``site`` from the closed set,
    so the allocator history probe can print WHY a read stopped. The class is still the
    ``ccxt.BadRequest`` every disposition already handles: classify_exception calls it permanent."""
    caplog.set_level(logging.WARNING, logger=_LOGGER)
    raised: dict[str, er.TruncatedTradeRead] = {}

    # A venue that answers the same full page whatever it is asked: the end cannot be lowered.
    page = trade_rows(100, _SINCE + DAY_MS, 60_000)
    page[-1]["info"]["nextPageCursor"] = "same-cursor"

    async def _same_page(*_args: Any, **_kwargs: Any) -> list[dict[str, Any]]:
        return [dict(t, info=dict(t["info"])) for t in page]

    repeating = AsyncMock()
    repeating.id = "bybit"
    repeating.fetch_my_trades = AsyncMock(side_effect=_same_page)
    with pytest.raises(er.TruncatedTradeRead) as repeated:
        await er._fetch_trades_with_pagination(repeating, "bybit", _SINCE, _SINCE + 3 * DAY_MS)
    raised["repeated"] = repeated.value

    # NotSupported after a row was read: the rows so far are not the book.
    calls = 0

    async def _then_not_supported(*_args: Any, **_kwargs: Any) -> list[dict[str, Any]]:
        nonlocal calls
        calls += 1
        if calls > 1:
            raise er.ccxt.NotSupported("fixture: not supported")
        rows = trade_rows(3, _SINCE + DAY_MS, 1000)
        rows[-1]["info"]["nextPageCursor"] = "more"
        return rows

    dropping = AsyncMock()
    dropping.id = "bybit"
    dropping.fetch_my_trades = AsyncMock(side_effect=_then_not_supported)
    with pytest.raises(er.TruncatedTradeRead) as unsupported:
        await er._fetch_trades_with_pagination(dropping, "bybit", _SINCE, _SINCE + 3 * DAY_MS)
    raised["unsupported"] = unsupported.value

    # Timestamps that keep falling forever: only the segment ceiling stops it.
    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(er, "_BYBIT_WINDOW_PAGE_CEILING", 2)
        patch.setattr(er, "_BYBIT_WINDOW_SEGMENT_CEILING", 3)
        falling, _untils = falling_timestamps_exchange()
        with pytest.raises(er.TruncatedTradeRead) as endless:
            await er._fetch_trades_with_pagination(falling, "bybit", _SINCE, _SINCE + 3 * DAY_MS)
    raised["endless"] = endless.value

    assert {name: exc.site for name, exc in raised.items()} == {
        "repeated": "bybit_no_advance",
        "unsupported": "bybit_not_supported",
        "endless": "bybit_segment_ceiling",
    }
    for exc in raised.values():
        assert exc.site in er.TRUNCATED_READ_SITES
        assert isinstance(exc, er.ccxt.BadRequest)
        assert classify_exception(exc)[0] == "permanent"
