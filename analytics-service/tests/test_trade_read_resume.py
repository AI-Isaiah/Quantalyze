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

import asyncio
import copy
import logging
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock

import pytest
from postgrest.exceptions import APIError

from services import equity_reconstruction as er
from services import trade_read_store as store
from services.job_worker import DispatchOutcome, classify_exception
from tests._trade_pages import BYBIT_WINDOW_MS, DAY_MS, VenueTradeBook, trade_rows
from tests.test_equity_reconstruction import (
    API_KEY_ID_1,
    FakeSupabaseClient,
    _install_fake_audit,
    _install_fake_preflight,
    _make_ohlcv_row,
)
from tests.test_reconstruct_force_rebuild import _bybit_exchange, _freeze_now_at
from tests.test_reconstruct_marker_writer import END_DATE, _job, _seed_key
from tests.test_trade_pages import _LOGGER, _falling_timestamps_exchange, _venue_exchange, _warnings

_SINCE = 1_700_000_000_000  # a fixed instant; the reads below never look at the wall clock


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
        falling, _untils = _falling_timestamps_exchange()
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


async def test_an_a6_shaped_book_is_read_whole_and_replays_equal() -> None:
    """SC-1, layer 1. The shape of the account that motivated this phase: a finite book over a
    729-day range whose weeks are small (40 trades) except ONE that holds more than a segment
    (10,500). The read returns every trade, and the equity replay over what was read equals the
    replay over the book itself, field for field, so the continuation loses and duplicates
    nothing. (Timestamps are unique, so the replay's order does not depend on read order.)"""
    heavy_window = 40
    book: list[dict[str, Any]] = []
    for window in range(105):  # 729 days tile into 105 seven-day windows
        first_ms = _SINCE + window * BYBIT_WINDOW_MS + 1000
        if window == heavy_window:
            book += trade_rows(10_500, first_ms, 50, id_prefix="big-")
        else:
            book += trade_rows(40, first_ms, 60_000, id_prefix=f"s{window:03d}-")
    assert len(book) == 104 * 40 + 10_500
    now_ms = _SINCE + 729 * DAY_MS
    exchange = _venue_exchange("bybit", book)

    read, _ = await er._fetch_trades_with_pagination(exchange, "bybit", _SINCE, now_ms)

    assert len(read) == len(book)
    assert len(exchange.book.calls) > 105 + er._BYBIT_WINDOW_PAGE_CEILING  # the heavy week took a second segment
    assert {t["id"] for t in read} == {t["id"] for t in book}

    def _day(ms: int) -> Any:
        return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).date()

    start_date, end_date = _day(_SINCE), _day(now_ms)
    days = (end_date - start_date).days + 1
    ohlcv = {
        "BTC": [(str(start_date.fromordinal(start_date.toordinal() + d)), 40_000.0 + 25.0 * d) for d in range(days)]
    }
    deposits = [{"timestamp": _SINCE, "currency": "USDT", "amount": 2_000_000.0}]

    def _replay(trades: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return er._compute_daily_equity(trades, deposits, [], ohlcv, {}, start_date, end_date)

    replayed = _replay(read)
    assert len(replayed) == days
    assert replayed == _replay(book)
    assert replayed[-1]["value_usd"] != replayed[0]["value_usd"]  # the replay is not trivially flat


# --------------------------------------------------------------------------- layer 2 (plan 07)
#
# A reconstruct of a Bybit book too big for one claim: the handler's first claim stores the
# windows it reads and defers; a later claim reuses them, reads the rest, and writes the history
# once. The fake venue is the finite VenueTradeBook of tests/_trade_pages.py and the database is
# the in-memory FakeSupabaseClient; the claim budget runs on a fake monotonic clock that advances
# one second per venue request, so "the budget ran out" is a count of requests, not a wall time.

_JOB_ID = "00000000-0000-0000-0000-0000000000f1"
_WINDOWS = 105  # 729 days from the start tile into 105 seven-day grid windows
_START_MS = int((END_DATE - timedelta(days=729)).timestamp() * 1000)
_NOW_MS = int(END_DATE.timestamp() * 1000)
_DEFER_REASON = re.compile(r"^trade read deferred \(windows [0-9]+/[0-9]+, trades [0-9]+\)$")
_SIGNATURE = "SIG-resume-4f1c9a"


class _Clock:
    """The fake clocks behind ``store._monotonic`` (``t``, seconds) and ``store._wall_ms``
    (``wall_ms``, epoch milliseconds, at the handler's frozen instant). The job-age rule and the
    rows' expiry read the wall clock, so a test that runs a job created at ``END_DATE`` must move
    that clock too, or the real date makes every such job a day old."""

    def __init__(self) -> None:
        self.t = 1000.0
        self.wall_ms = _NOW_MS


def _window_start(k: int) -> int:
    return _START_MS + k * BYBIT_WINDOW_MS


def _big_book(*, signature: bool = False) -> list[dict[str, Any]]:
    """A finite Bybit book: 40 trades in each of the 30 oldest grid windows (window 3 holds 450,
    more than one 2-page segment once the page ceiling is lowered), five in the window that holds
    now, and an amount that differs per window so the replayed equity moves."""
    book: list[dict[str, Any]] = []
    for k in range(30):
        rows = (
            trade_rows(450, _window_start(k) + 1000, 50, id_prefix=f"w{k:03d}-")
            if k == 3
            else trade_rows(40, _window_start(k) + 1000, 60_000, id_prefix=f"w{k:03d}-")
        )
        for row in rows:
            row["amount"] = 0.001 * (k + 1)
            row["cost"] = row["price"] * row["amount"]
            if signature:
                row["info"] = {"note": _SIGNATURE}
        book += rows
    tail = trade_rows(5, _window_start(104) + 3_600_000, 60_000, id_prefix="tail-")
    for row in tail:
        row["amount"] = 0.5
        row["cost"] = row["price"] * row["amount"]
        if signature:
            row["info"] = {"note": _SIGNATURE}
    return book + tail


def _ohlcv() -> list[list[Any]]:
    return [_make_ohlcv_row(_START_MS + d * DAY_MS, 40_000.0 + 15.0 * d) for d in range(730)]


async def _venue(book: list[dict[str, Any]], clock: _Clock) -> Any:
    """A Bybit exchange whose every trade request costs the fake clock one second."""
    exchange = await _bybit_exchange()
    venue_book = VenueTradeBook(exchange, book)

    async def _fetch(*args: Any, **kwargs: Any) -> list[dict[str, Any]]:
        clock.t += 1.0
        return await venue_book(*args, **kwargs)

    exchange.fetch_my_trades = AsyncMock(side_effect=_fetch)
    exchange.fetch_ohlcv = AsyncMock(return_value=_ohlcv())
    return exchange


def _claim_job(token: str) -> dict[str, Any]:
    return {
        **_job(),
        "id": _JOB_ID,
        "claim_token": token,
        "created_at": (END_DATE - timedelta(hours=1)).isoformat(),
    }


def _rig(monkeypatch: pytest.MonkeyPatch, clock: _Clock, *, budget_s: float) -> FakeSupabaseClient:
    """A database with the job's key, the frozen handler clock, the fake monotonic clock, a
    lowered page ceiling, the budget, and the offline preflight and audit."""
    fake = FakeSupabaseClient()
    _seed_key(fake, API_KEY_ID_1, exchange="bybit", attempts=0)
    monkeypatch.setattr(store, "_monotonic", lambda: clock.t)
    monkeypatch.setattr(store, "_wall_ms", lambda: clock.wall_ms)
    monkeypatch.setattr(er, "_TRADE_READ_CLAIM_BUDGET_S", budget_s)
    monkeypatch.setattr(er, "_BYBIT_WINDOW_PAGE_CEILING", 2)
    _freeze_now_at(monkeypatch, END_DATE)
    return fake


def _install(monkeypatch: pytest.MonkeyPatch, fake: FakeSupabaseClient, exchange: Any) -> Any:
    audit = _install_fake_audit(monkeypatch)
    _install_fake_preflight(monkeypatch, "bybit", fake, exchange)
    return audit


def _snapshots(fake: FakeSupabaseClient) -> list[dict[str, Any]]:
    return sorted(fake.rows_for("allocator_equity_snapshots"), key=lambda r: str(r["asof"]))


def _failure_audits(audit: Any) -> list[Any]:
    return [
        c for c in audit.call_args_list
        if c.kwargs.get("action") == "allocator.equity.reconstruct_failed"
    ]


def _defer_calls(fake: FakeSupabaseClient) -> list[dict[str, Any]]:
    return [params for name, params in fake.rpc_calls if name == "defer_compute_job"]


def _store_rows(fake: FakeSupabaseClient) -> list[dict[str, Any]]:
    return fake.rows_for(store.STATE_TABLE) + fake.rows_for(store.WINDOW_TABLE)


async def _single_pass(
    monkeypatch: pytest.MonkeyPatch, book: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], int]:
    """The oracle: the same book, read by layer 1 alone (no scope is ever visible to the read),
    through the same handler. Returns the persisted snapshots and the venue request count."""
    clock = _Clock()
    fake = _rig(monkeypatch, clock, budget_s=1e9)
    exchange = await _venue(book, clock)
    _install(monkeypatch, fake, exchange)
    with monkeypatch.context() as unscoped:
        unscoped.setattr(store, "current_trade_read_scope", lambda: None)
        result = await er.run_reconstruct_allocator_history_job(_claim_job("oracle"))
    assert result.outcome == DispatchOutcome.DONE, result
    assert fake.rpc_calls and not _defer_calls(fake)
    return _snapshots(fake), exchange.fetch_my_trades.await_count


async def test_a_bybit_book_too_big_for_one_claim_defers_then_completes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-02 end to end. Claim 1 runs out of budget at a window boundary: the handler asks
    ``defer_compute_job`` (the job's own claim token, 120 s, a static counts-only reason) and
    returns DEFERRED, with the windows it read kept in the store and NOTHING written to the
    allocator's history. Claim 2 reuses those windows, reads only what is left and the window
    holding now, persists the same rows one unscoped read would, and leaves no store row behind.
    At the old behaviour claim 1 read the whole book in one pass (or refused), so it never
    deferred."""
    book = _big_book()
    oracle_rows, single_pass_calls = await _single_pass(monkeypatch, book)
    assert len({r["value_usd"] for r in oracle_rows}) > 5, "the oracle curve must move"

    clock = _Clock()
    fake = _rig(monkeypatch, clock, budget_s=45.0)
    exchange = await _venue(book, clock)
    audit = _install(monkeypatch, fake, exchange)
    key_before = copy.deepcopy(fake.store[("api_keys", (API_KEY_ID_1,))])

    first = await er.run_reconstruct_allocator_history_job(_claim_job("T1"))

    assert first.outcome == DispatchOutcome.DEFERRED, first
    (defer,) = _defer_calls(fake)
    assert defer["p_job_id"] == _JOB_ID
    assert defer["p_claim_token"] == "T1"
    assert defer["p_defer_seconds"] == 120
    assert _DEFER_REASON.match(defer["p_reason"]), defer["p_reason"]
    stored_windows = {r["window_start_ms"] for r in fake.rows_for(store.WINDOW_TABLE)}
    done, total = map(int, re.findall(r"[0-9]+", defer["p_reason"])[:2])
    assert total == _WINDOWS and 0 < done < total
    assert len(stored_windows) == done
    assert not _snapshots(fake) and not fake.rows_for("allocator_equity_derived")
    assert fake.store[("api_keys", (API_KEY_ID_1,))] == key_before
    assert not _failure_audits(audit)
    claim_one_calls = exchange.fetch_my_trades.await_count

    monkeypatch.setattr(er, "_TRADE_READ_CLAIM_BUDGET_S", 1e9)
    second = await er.run_reconstruct_allocator_history_job(_claim_job("T2"))

    assert second.outcome == DispatchOutcome.DONE, second
    claim_two_calls = exchange.fetch_my_trades.await_count - claim_one_calls
    assert 0 < claim_two_calls < single_pass_calls, (claim_one_calls, claim_two_calls, single_pass_calls)
    assert _snapshots(fake) == oracle_rows
    assert not _store_rows(fake), "the key's store rows are purged once the history is written"
    assert len(_defer_calls(fake)) == 1


async def test_a_reclaimed_job_yields_instead_of_failing(monkeypatch: pytest.MonkeyPatch) -> None:
    """T-171-23. A watchdog reclaim re-claims the job under a fresh token, so the worker's
    ``defer_compute_job`` raises SQLSTATE 55006. The job belongs to another worker: the handler
    yields (DEFERRED) and writes no failure audit, instead of failing or retrying a stale token."""
    clock = _Clock()
    fake = _rig(monkeypatch, clock, budget_s=0.5)

    class _Preempted(Exception):
        code = "55006"

    class _Refusing:
        def execute(self) -> Any:
            raise _Preempted("fixture: preempted")

    real_rpc = fake.rpc

    def _rpc(name: str, params: dict[str, Any] | None = None) -> Any:
        if name == "defer_compute_job":
            fake.rpc_calls.append((name, params or {}))
            return _Refusing()
        return real_rpc(name, params)

    monkeypatch.setattr(fake, "rpc", _rpc)
    exchange = await _venue(_big_book(), clock)
    audit = _install(monkeypatch, fake, exchange)

    result = await er.run_reconstruct_allocator_history_job(_claim_job("T1"))

    assert result.outcome == DispatchOutcome.DEFERRED, result
    assert len(_defer_calls(fake)) == 1
    assert not _failure_audits(audit)
    assert not _snapshots(fake)


# --------------------------------------------------------------------------- direct reads
#
# The tests below call ``er._fetch_bybit_trades`` under a hand-built scope, so they can look at
# the store (the handler purges it on DONE) and put the deadline exactly where the rule under
# test is decided.


def _clocked_exchange(book: list[dict[str, Any]], clock: _Clock) -> Any:
    """A bare Bybit exchange over ``book``; every trade request costs the fake clock a second."""
    exchange = AsyncMock()
    exchange.id = "bybit"
    venue_book = VenueTradeBook(exchange, book)

    async def _fetch(*args: Any, **kwargs: Any) -> list[dict[str, Any]]:
        clock.t += 1.0
        return await venue_book(*args, **kwargs)

    exchange.fetch_my_trades = AsyncMock(side_effect=_fetch)
    return exchange


def _scope(
    fake: Any, clock: _Clock, monkeypatch: pytest.MonkeyPatch, *, budget_s: float, job_id: str | None = _JOB_ID
) -> store.TradeReadScope:
    monkeypatch.setattr(store, "_monotonic", lambda: clock.t)
    monkeypatch.setattr(store, "_wall_ms", lambda: clock.wall_ms)
    return store.TradeReadScope(
        supabase=fake,
        api_key_id=API_KEY_ID_1,
        deadline=store.claim_deadline(budget_s),
        job_id=job_id,
        job_created_at=(END_DATE - timedelta(hours=1)).isoformat(),
    )


async def _read(
    exchange: Any, scope: store.TradeReadScope, since_ms: int = _START_MS, now_ms: int = _NOW_MS
) -> list[dict[str, Any]]:
    with store.trade_read_scope(scope):
        return await er._fetch_bybit_trades(exchange, since_ms, now_ms)


def _fingerprint(trades: list[dict[str, Any]]) -> list[tuple[Any, ...]]:
    """What the replay reads of a trade, sorted: the oracle compares a read to the book itself."""
    return sorted((t["timestamp"], t["symbol"], t["side"], t["amount"], t["price"], t["cost"]) for t in trades)


def _expected(book: list[dict[str, Any]], since_ms: int, now_ms: int) -> list[tuple[Any, ...]]:
    return _fingerprint([t for t in book if since_ms <= t["timestamp"] <= now_ms])


def _stored_starts(fake: FakeSupabaseClient) -> set[int]:
    return {r["window_start_ms"] for r in fake.rows_for(store.WINDOW_TABLE)}


def _spread_book(windows: range, *, step_ms: int = 4 * 3_600_000) -> list[dict[str, Any]]:
    """40 trades in each given grid window, spread over its first 6.7 days (an amount per window)."""
    book: list[dict[str, Any]] = []
    for k in windows:
        for row in trade_rows(40, _window_start(k) + 1000, step_ms, id_prefix=f"s{k:03d}-"):
            row["amount"] = 0.001 * (k + 1)
            row["cost"] = row["price"] * row["amount"]
            book.append(row)
    return book


async def test_the_window_holding_now_is_never_stored(monkeypatch: pytest.MonkeyPatch) -> None:
    """RESEARCH section 2. A window is stored only when it is complete AND settled: the window
    holding now is still receiving trades, and so is the one that ended inside the last hour. The
    read is made 30 minutes into grid window 10, so windows 0 to 8 are stored, window 9 (ended 30
    minutes ago) and window 10 (holding now) are read live and kept out of the store, and every
    trade is still in the output."""
    clock = _Clock()
    fake = FakeSupabaseClient()
    now_ms = _window_start(10) + 1_800_000
    book = _spread_book(range(0, 12))
    exchange = _clocked_exchange(book, clock)

    read = await _read(exchange, _scope(fake, clock, monkeypatch, budget_s=1e9), now_ms=now_ms)

    assert _fingerprint(read) == _expected(book, _START_MS, now_ms)
    assert _stored_starts(fake) == {_window_start(k) for k in range(9)}
    assert any(_window_start(9) <= t["timestamp"] <= now_ms for t in read), "the settle hour holds trades"


async def test_a_window_starting_before_the_read_start_is_read_but_never_stored(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """RESEARCH section 2. Claim A (one job) stores grid window 0 and defers. Claim B, a later job
    whose start sits 10 days in, finds window 0 stored (it is cut to the new start: all of it lies
    before) and window 1 STRADDLING the start: window 1 begins before the read start, so it is read
    over ``[start, window end]``, its earlier trades are not asked for, and it is NOT stored, because
    a stored window is always a whole grid window."""
    clock = _Clock()
    fake = FakeSupabaseClient()
    book = _spread_book(range(0, 4))
    exchange = _clocked_exchange(book, clock)

    with pytest.raises(store.TradeReadDeferred):
        await _read(exchange, _scope(fake, clock, monkeypatch, budget_s=0.5))
    assert _stored_starts(fake) == {_window_start(0)}

    later_start = _START_MS + 10 * DAY_MS
    clock.t += 10_000
    read = await _read(
        exchange,
        _scope(fake, clock, monkeypatch, budget_s=1e9, job_id="00000000-0000-0000-0000-0000000000f2"),
        since_ms=later_start,
    )

    assert _fingerprint(read) == _expected(book, later_start, _NOW_MS)
    assert any(_window_start(1) < t["timestamp"] < later_start for t in book), "window 1 holds earlier trades"
    assert all(t["timestamp"] >= later_start for t in read)
    stored = _stored_starts(fake)
    assert _window_start(1) not in stored
    assert _window_start(0) in stored and _window_start(2) in stored


async def test_the_tail_is_read_even_after_the_deadline(monkeypatch: pytest.MonkeyPatch) -> None:
    """D-02. The budget is checked only before a window that could be stored. Here the deadline
    passes right after the last storable window (window 1), yet the two windows left (the settle
    hour's and the one holding now) are always read in the claim that reaches them: the claim
    completes instead of deferring on a window that can never be stored."""
    clock = _Clock()
    fake = FakeSupabaseClient()
    now_ms = _window_start(3) + 1_800_000
    book = _spread_book(range(0, 4))
    exchange = _clocked_exchange(book, clock)

    read = await _read(exchange, _scope(fake, clock, monkeypatch, budget_s=2.0), now_ms=now_ms)

    assert store.deadline_passed(_scope(fake, clock, monkeypatch, budget_s=0.0)) is True
    assert clock.t >= 1000.0 + 2.0, "the deadline had passed before the tail was read"
    assert _fingerprint(read) == _expected(book, _START_MS, now_ms)
    assert _stored_starts(fake) == {_window_start(0), _window_start(1)}


def _short_page_that_keeps_its_cursor(
    first_window_rows: list[dict[str, Any]], rest: Any, clock: _Clock
) -> Any:
    """A Bybit exchange that answers grid window 0 like a quirky venue (the newest 100 rows with a
    cursor, then the short last page again whatever cursor it is sent, with the same cursor) and
    every other window from ``rest``, a VenueTradeBook."""
    newest_first = sorted(first_window_rows, key=lambda r: -r["timestamp"])

    async def _fetch(symbol: Any, since: Any, limit: Any, params: dict[str, Any]) -> list[dict[str, Any]]:
        clock.t += 1.0
        if since != _window_start(0):
            return await rest(symbol, since, limit, params)
        page = newest_first[:100] if not params.get("cursor") else newest_first[100:]
        page = [dict(r, info=dict(r["info"])) for r in page]
        page[0]["info"]["nextPageCursor"] = "c1"
        return list(reversed(page))  # ccxt re-sorts a page ascending

    exchange = AsyncMock()
    exchange.id = "bybit"
    exchange.fetch_my_trades = AsyncMock(side_effect=_fetch)
    return exchange


@pytest.mark.parametrize("shape", ["full_page_no_cursor", "short_stalled_page"])
async def test_a_window_that_ended_on_an_uncertain_stop_is_used_but_never_stored(
    shape: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """S-1 (171 fix round 1), T-171-04: a stored window is reused by every later claim and job of
    the key for days, so it must be one the venue ran out of trades for. Grid window 0 here ends
    on an uncertain stop: a FULL page that carries no cursor (it may have had more behind it), or a
    short page that repeats its cursor (the venue's last page, or a quirk hiding more). Its trades
    are still in this claim's output, but only the window that ended on an empty page or a short
    page with no cursor (window 1) is stored."""
    clock = _Clock()
    fake = FakeSupabaseClient()
    now_ms = _window_start(3) + 1_800_000
    rest = _spread_book(range(1, 4))
    if shape == "full_page_no_cursor":
        first = trade_rows(100, _window_start(0) + 1000, 60_000, id_prefix="u")
        exchange = _clocked_exchange(first + rest, clock)
    else:
        first = trade_rows(150, _window_start(0) + 1000, 60_000, id_prefix="u")
        quirky = AsyncMock()
        quirky.id = "bybit"
        exchange = _short_page_that_keeps_its_cursor(first, VenueTradeBook(quirky, rest), clock)

    read = await _read(exchange, _scope(fake, clock, monkeypatch, budget_s=1e9), now_ms=now_ms)

    assert _fingerprint(read) == _expected(first + rest, _START_MS, now_ms)
    assert _stored_starts(fake) == {_window_start(1)}  # window 2 sits in the settle hour


# --------------------------------------------------------------------------- store faults


class _StoreDown(FakeSupabaseClient):
    """A database whose trade-read tables do not exist (the worker deployed before the migration
    applied). The error text carries a planted signature: nothing may log it."""

    def table(self, name: str) -> Any:
        if name in (store.STATE_TABLE, store.WINDOW_TABLE):
            raise APIError(
                {"code": "42P01", "message": f"relation does not exist {_SIGNATURE}", "details": None, "hint": None}
            )
        return super().table(name)


class _WindowWritesRefused(FakeSupabaseClient):
    """A database that answers every read but refuses every write to the windows table."""

    def table(self, name: str) -> Any:
        inner = super().table(name)
        if name != store.WINDOW_TABLE:
            return inner

        class _Refusing:
            def __getattr__(self, attr: str) -> Any:
                if attr in ("upsert", "delete", "insert"):
                    raise APIError(
                        {"code": "57014", "message": f"write refused {_SIGNATURE}", "details": None, "hint": None}
                    )
                return getattr(inner, attr)

        return _Refusing()


def _store_warnings(caplog: pytest.LogCaptureFixture) -> list[logging.LogRecord]:
    return [
        r for r in caplog.records
        if r.name == "quantalyze.analytics.trade_read_store" and r.levelno == logging.WARNING
    ]


async def _run_with_database(
    monkeypatch: pytest.MonkeyPatch, fake: FakeSupabaseClient, book: list[dict[str, Any]], budget_s: float
) -> tuple[Any, Any, Any, _Clock]:
    clock = _Clock()
    monkeypatch.setattr(store, "_monotonic", lambda: clock.t)
    monkeypatch.setattr(store, "_wall_ms", lambda: clock.wall_ms)
    monkeypatch.setattr(er, "_TRADE_READ_CLAIM_BUDGET_S", budget_s)
    monkeypatch.setattr(er, "_BYBIT_WINDOW_PAGE_CEILING", 2)
    _freeze_now_at(monkeypatch, END_DATE)
    _seed_key(fake, API_KEY_ID_1, exchange="bybit", attempts=0)
    exchange = await _venue(book, clock)
    audit = _install(monkeypatch, fake, exchange)
    result = await er.run_reconstruct_allocator_history_job(_claim_job("T1"))
    return result, exchange, audit, clock


async def test_a_store_fault_reads_the_book_without_the_store(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """T-171-34. The worker can run before the migration applies, so the tables may not exist. A
    Bybit reconstruct must then end exactly as it did before the store existed: with a budget
    small enough that a working store WOULD defer, the job still reads the whole book in one pass
    (the same venue requests as layer 1 alone, no budget), makes no ``defer_compute_job`` call and
    persists the same rows. The store logs its fault once, by class name, never by the error text."""
    book = _big_book()
    oracle_rows, single_pass_calls = await _single_pass(monkeypatch, book)

    caplog.set_level(logging.INFO)
    caplog.clear()
    fake = _StoreDown()
    result, exchange, audit, _clock = await _run_with_database(monkeypatch, fake, book, budget_s=45.0)

    assert result.outcome == DispatchOutcome.DONE, result
    assert not _defer_calls(fake)
    assert exchange.fetch_my_trades.await_count == single_pass_calls
    assert _snapshots(fake) == oracle_rows
    assert not _failure_audits(audit)
    faults = [r for r in _store_warnings(caplog) if "this claim reads without the store" in r.getMessage()]
    assert len(faults) == 1
    assert "APIError" in faults[0].getMessage()
    assert all("APIError" in r.getMessage() for r in _store_warnings(caplog))
    assert not [r for r in caplog.records if _SIGNATURE in r.getMessage()]


async def test_a_book_over_one_run_with_the_store_down_ends_on_the_crawl_timeout_as_transient(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """Round-2 WR-01. With the store down there is no resume and layer 1 has no page or run budget:
    a book too big for one run ends on the crawl's wall-clock bound, ``asyncio.TimeoutError``, which
    the handler already classes TRANSIENT (retried once the store is back). Nothing is persisted."""
    book = _big_book(signature=True)

    async def _slow_sleep(_exchange: Any) -> None:
        await asyncio.sleep(0.05)

    monkeypatch.setattr(er, "_rate_limit_sleep", _slow_sleep)
    monkeypatch.setattr(er, "_RECONSTRUCT_CRAWL_TIMEOUT_S", 0.3)

    caplog.set_level(logging.INFO)
    caplog.clear()
    fake = _StoreDown()
    result, _exchange, _audit, _clock = await _run_with_database(monkeypatch, fake, book, budget_s=45.0)

    assert result.outcome == DispatchOutcome.FAILED, result
    assert result.error_kind == "transient", result
    assert "per-crawl wall-clock bound" in (result.error_message or "")
    assert _SIGNATURE not in (result.error_message or "")
    assert not _snapshots(fake)
    assert not _defer_calls(fake)
    assert not [r for r in caplog.records if _SIGNATURE in r.getMessage()]


@pytest.mark.parametrize("store_up", [True, False])
async def test_a_truncated_read_stays_permanent_whether_the_store_is_up_or_down(
    store_up: bool, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """Round-2 WR-01. ``TruncatedTradeRead`` is the venue's deterministic per-window refusal (here
    ``bybit_segment_ceiling``). The resumable read refuses it permanently, and the store being down
    must not turn the same refusal into a retry that blames the store. Nothing is persisted."""
    book = _big_book(signature=True)
    monkeypatch.setattr(er, "_BYBIT_WINDOW_SEGMENT_CEILING", 1)  # window 3 (450 trades) is over the ceiling

    caplog.set_level(logging.INFO)
    caplog.clear()
    fake = FakeSupabaseClient() if store_up else _StoreDown()
    result, _exchange, _audit, _clock = await _run_with_database(monkeypatch, fake, book, budget_s=1e9)

    assert result.outcome == DispatchOutcome.FAILED, result
    assert result.error_kind == "permanent", result
    assert _SIGNATURE not in (result.error_message or "")
    assert not _snapshots(fake)
    assert not [r for r in caplog.records if _SIGNATURE in r.getMessage()]


async def test_a_store_fault_on_save_keeps_the_trades_in_the_claim(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """T-171-34. The store answers but refuses every window write: ``save_window`` returns False,
    each window stays unstored and its trades stay in this claim's read, so with a budget that
    never runs out the job completes with the rows one unscoped read persists. No window row exists."""
    book = _big_book()
    oracle_rows, _single_pass_calls = await _single_pass(monkeypatch, book)

    caplog.set_level(logging.INFO)
    caplog.clear()
    fake = _WindowWritesRefused()
    result, _exchange, audit, _clock = await _run_with_database(monkeypatch, fake, book, budget_s=1e9)

    assert result.outcome == DispatchOutcome.DONE, result
    assert not _defer_calls(fake)
    assert _snapshots(fake) == oracle_rows
    assert not fake.rows_for(store.WINDOW_TABLE)
    assert not _failure_audits(audit)
    assert not [r for r in caplog.records if _SIGNATURE in r.getMessage()]


# --------------------------------------------------------------------------- the budget, hygiene


def test_the_claim_budget_must_sit_below_the_crawl_bound() -> None:
    """The soft budget is only soft if the hard bound can still fire after it: a budget at or above
    the bound, one that is not positive, and text that is not a number all fail the import."""
    assert er._validated_claim_budget("900", 1500.0) == 900.0
    assert er._validated_claim_budget(None, 1500.0) == 900.0
    for bad in ("0", "-1", "1500", "1500.5", "nan", "abc", ""):
        with pytest.raises(ValueError):
            er._validated_claim_budget(bad, 1500.0)
    assert 0.0 < er._TRADE_READ_CLAIM_BUDGET_S < er._RECONSTRUCT_CRAWL_TIMEOUT_S


async def test_no_deferral_text_carries_venue_text(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """T-171-24. A signature planted in every trade's ``info`` (venue text) reaches no log record,
    no audit call, no RPC argument and no stored row, across a deferred claim and the claim that
    completes."""
    book = _big_book(signature=True)
    clock = _Clock()
    fake = _rig(monkeypatch, clock, budget_s=45.0)
    exchange = await _venue(book, clock)
    audit = _install(monkeypatch, fake, exchange)
    caplog.set_level(logging.DEBUG)
    caplog.clear()

    first = await er.run_reconstruct_allocator_history_job(_claim_job("T1"))
    stored_after_first = repr(_store_rows(fake))
    monkeypatch.setattr(er, "_TRADE_READ_CLAIM_BUDGET_S", 1e9)
    second = await er.run_reconstruct_allocator_history_job(_claim_job("T2"))

    assert (first.outcome, second.outcome) == (DispatchOutcome.DEFERRED, DispatchOutcome.DONE)
    assert _defer_calls(fake), "the claim did defer"
    assert _SIGNATURE not in stored_after_first
    assert _SIGNATURE not in repr(fake.rpc_calls)
    assert _SIGNATURE not in repr(audit.call_args_list)
    assert not [r for r in caplog.records if _SIGNATURE in r.getMessage() or _SIGNATURE in repr(r.args)]


def test_the_store_names_match_the_migration() -> None:
    """The store writes columns by NAME and the migration declares them: a rename on either side
    alone would make every write fail at the first claim. Read straight from plan 03's file."""
    repo_root = Path(__file__).resolve().parents[2]
    (migration,) = (repo_root / "supabase" / "migrations").glob("*_allocator_trade_reads.sql")
    sql = "\n".join(
        line for line in migration.read_text().splitlines() if not line.lstrip().startswith("--")
    )
    blocks = dict(
        re.findall(r"CREATE TABLE public\.(allocator_trade_read\w*)\s*\((.*?)\n\);", sql, re.DOTALL)
    )
    assert set(blocks) == {store.STATE_TABLE, store.WINDOW_TABLE}

    def _columns(block: str) -> set[str]:
        # A column line is indented two spaces and starts with a lowercase name; constraints,
        # keys and their continuation lines start with a keyword or sit deeper.
        return set(re.findall(r"^  ([a-z][a-z0-9_]*)\s+[A-Z]", block, re.MULTILINE))

    assert _columns(blocks[store.STATE_TABLE]) == set(store.STATE_COLUMNS)
    assert _columns(blocks[store.WINDOW_TABLE]) == set(store.WINDOW_COLUMNS)


async def test_an_unscoped_read_is_layer_one_exactly(monkeypatch: pytest.MonkeyPatch) -> None:
    """Without a scope (the probe, any caller that sets none), and with a scope that names no job,
    the Bybit read is plan 02's layer 1: one request per window, tiled from the start, and not one
    store call. The expected requests are written out here, not taken from the code under test."""
    for name in ("begin_claim", "load_window", "save_window", "record_progress", "purge_keys"):
        async def _forbidden(*_a: Any, **_k: Any) -> Any:
            raise AssertionError("the store was reached by an unscoped read")

        monkeypatch.setattr(store, name, _forbidden)
    book = _spread_book(range(0, 3))
    now_ms = _START_MS + 20 * DAY_MS
    expected_windows = []
    w_start = _START_MS
    while w_start <= now_ms:
        expected_windows.append((w_start, min(w_start + BYBIT_WINDOW_MS - 1, now_ms)))
        w_start = expected_windows[-1][1] + 1

    unscoped = _clocked_exchange(book, _Clock())
    read = await er._fetch_bybit_trades(unscoped, _START_MS, now_ms)

    assert [
        (c.args[1], c.args[3]["until"]) for c in unscoped.fetch_my_trades.await_args_list
    ] == expected_windows
    assert _fingerprint(read) == _expected(book, _START_MS, now_ms)

    clock = _Clock()
    jobless = _clocked_exchange(book, clock)
    refusing = _StoreDown()
    read_again = await _read(
        jobless, _scope(refusing, clock, monkeypatch, budget_s=0.0, job_id=None), now_ms=now_ms
    )
    assert jobless.fetch_my_trades.await_args_list == unscoped.fetch_my_trades.await_args_list
    assert _fingerprint(read_again) == _fingerprint(read)


async def test_not_supported_keeps_its_meaning_across_windows_and_claims(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Plan 02's rule, now that each window is read into its own list: ``NotSupported`` is the
    empty book only when no trade was read at all. After a window that held trades (read in this
    claim, or STORED by an earlier one) it is a typed truncation, never a quietly short book."""
    book = _spread_book(range(0, 1))

    def _unsupported_after_window_zero(exchange: Any) -> Any:
        real = exchange.fetch_my_trades.side_effect

        async def _fetch(symbol: Any, since: Any, limit: Any, params: Any) -> list[dict[str, Any]]:
            if since >= _window_start(1):
                raise er.ccxt.NotSupported("fixture: not supported")
            return await real(symbol, since, limit, params)

        exchange.fetch_my_trades = AsyncMock(side_effect=_fetch)
        return exchange

    clock = _Clock()
    fake = FakeSupabaseClient()
    exchange = _unsupported_after_window_zero(_clocked_exchange(book, clock))
    with pytest.raises(er.TruncatedTradeRead) as in_claim:
        await _read(exchange, _scope(fake, clock, monkeypatch, budget_s=1e9))
    assert in_claim.value.site == "bybit_not_supported"
    assert _stored_starts(fake) == {_window_start(0)}

    # A later job: window 0 comes from the store, so this claim reads no trade from the venue,
    # and the refusal at window 1 still sees the trades window 0 held.
    with pytest.raises(er.TruncatedTradeRead) as from_store:
        await _read(
            exchange,
            _scope(fake, clock, monkeypatch, budget_s=1e9, job_id="00000000-0000-0000-0000-0000000000f2"),
        )
    assert from_store.value.site == "bybit_not_supported"

    # Nothing read at all: the empty book, as in layer 1.
    empty = AsyncMock()
    empty.id = "bybit"
    empty.fetch_my_trades = AsyncMock(side_effect=er.ccxt.NotSupported("fixture: not supported"))
    fresh_clock = _Clock()
    assert await _read(empty, _scope(FakeSupabaseClient(), fresh_clock, monkeypatch, budget_s=1e9)) == []


# --------------------------------------------------------------------------- plan 08
#
# A read that makes no progress stops by name (T-171-22), and kept progress does not outlive its
# expiry even when no job ever comes back for it (T-171-35, the watchdog sweep).

_STALL_MESSAGE = re.compile(
    r"^trade read stopped: cause=(stalled_claims|job_age) claims=[0-9]+; nothing was written to the "
    r"allocator's history, the stored windows are kept and a later run resumes from them$"
)
_OTHER_JOB_ID = "00000000-0000-0000-0000-0000000000f2"
_WEEK_S = 7 * 24 * 3600


async def _seed_one_stored_window(fake: FakeSupabaseClient, book: list[dict[str, Any]]) -> None:
    """Window 0 of the book kept in the store by an earlier job, the way a completed claim leaves
    it: a state row (grid origin = the read start) and one whole window."""
    state = await store.begin_claim(
        fake, API_KEY_ID_1, venue="bybit", since_ms=_START_MS, job_id="00000000-0000-0000-0000-0000000000e0"
    )
    assert state is not None
    start, end = _window_start(0), _window_start(0) + BYBIT_WINDOW_MS - 1
    assert await store.save_window(
        fake, API_KEY_ID_1, start, end, [t for t in book if start <= t["timestamp"] <= end]
    )


def _stall_job(token: str, job_id: str = _JOB_ID) -> dict[str, Any]:
    return {**_claim_job(token), "id": job_id}


async def test_three_stalled_claims_stop_the_unforced_job_by_name_and_the_sweep_removes_the_expired_rows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """T-171-22 and T-171-35, D-02. With a budget of zero no NEW window is ever stored, so a job
    that claims again and again makes no progress. Defer burns no attempt, so only the stalled-claims
    count can end it: claims 1 to 3 DEFER, claim 4 FAILS permanent with a static message naming the
    cause and the claim count, with ONE ``reconstruct_failed`` audit, the history unwritten and the
    stored window and state row KEPT (a later job resumes from them: a new job id defers again, it
    does not stall at once). The kept rows are then removed by ``main_worker``'s sweep once they are
    past their 7 day expiry, though no claim ever touches the key again, and that sweep runs at most
    once per interval. At the old behaviour claim 4 reached the generic arm (a different message)
    and nothing removed the rows."""
    import main_worker

    book = _big_book()
    clock = _Clock()
    fake = _rig(monkeypatch, clock, budget_s=0.0)
    exchange = await _venue(book, clock)
    audit = _install(monkeypatch, fake, exchange)
    await _seed_one_stored_window(fake, book)
    key_before = copy.deepcopy(fake.store[("api_keys", (API_KEY_ID_1,))])

    for n in (1, 2, 3):
        deferred = await er.run_reconstruct_allocator_history_job(_stall_job(f"T{n}"))
        assert deferred.outcome == DispatchOutcome.DEFERRED, (n, deferred)
    assert len(_defer_calls(fake)) == 3
    assert not _failure_audits(audit)

    stopped = await er.run_reconstruct_allocator_history_job(_stall_job("T4"))

    assert stopped.outcome == DispatchOutcome.FAILED, stopped
    assert stopped.error_kind == "permanent"
    assert _STALL_MESSAGE.match(stopped.error_message or ""), stopped.error_message
    assert "cause=stalled_claims" in (stopped.error_message or "")
    (failure,) = _failure_audits(audit)
    assert failure.kwargs["metadata"] == {
        "error_kind": "permanent", "sanitized_message": stopped.error_message,
    }
    assert len(_defer_calls(fake)) == 3, "the stop is not a deferral"
    assert not _snapshots(fake) and not fake.rows_for("allocator_equity_derived")
    assert fake.store[("api_keys", (API_KEY_ID_1,))] == key_before
    (state_row,) = fake.rows_for(store.STATE_TABLE)
    assert state_row["stalled_claims"] == store.STALLED_CLAIMS_LIMIT
    assert _stored_starts(fake) == {_window_start(0)}, "the stored window is kept"

    # A NEW job reads again from the kept window: it defers, it is not stopped at once.
    again = await er.run_reconstruct_allocator_history_job(_stall_job("T5", _OTHER_JOB_ID))
    assert again.outcome == DispatchOutcome.DEFERRED, again
    assert len(_defer_calls(fake)) == 4
    assert _stored_starts(fake) == {_window_start(0)}
    assert len(_store_rows(fake)) == 2  # the state row and window 0

    # Nobody comes back for the key. The store's wall clock moves past the expiry, and the worker's
    # sweep (not a claim) removes the rows, at most once per interval.
    purge_calls = 0
    real_purge = main_worker.trade_read_store.purge_expired

    async def _counting_purge(supabase: Any) -> None:
        nonlocal purge_calls
        purge_calls += 1
        await real_purge(supabase)

    sweep_now = [5000.0]
    monkeypatch.setattr(main_worker.trade_read_store, "purge_expired", _counting_purge)
    monkeypatch.setattr(main_worker, "get_supabase", lambda: fake)
    monkeypatch.setattr(main_worker, "_sweep_clock", lambda: sweep_now[0])
    monkeypatch.setattr(main_worker, "_last_trade_read_sweep", None)

    clock.wall_ms += (_WEEK_S + 1) * 1000
    assert len(_store_rows(fake)) == 2
    await main_worker.sweep_expired_trade_reads()
    assert purge_calls == 1
    assert not _store_rows(fake), "an expired key's rows are swept without any claim"

    sweep_now[0] += 60.0
    await main_worker.sweep_expired_trade_reads()
    assert purge_calls == 1, "a sweep 60 s after the last one deletes nothing"

    sweep_now[0] += main_worker._TRADE_READ_SWEEP_INTERVAL_S
    await main_worker.sweep_expired_trade_reads()
    assert purge_calls == 2


# ------------------------------------------------------------ SC-1: claims replay as one pass


def _day_of(ms: int) -> Any:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).date()


def _replay(trades: list[dict[str, Any]], since_ms: int, now_ms: int) -> list[dict[str, Any]]:
    """The equity replay of a trade list over [since, now]: the number the dashboard shows."""
    start_date, end_date = _day_of(since_ms), _day_of(now_ms)
    days = (end_date - start_date).days + 1
    ohlcv = {
        "BTC": [
            (str(start_date.fromordinal(start_date.toordinal() + d)), 40_000.0 + 25.0 * d)
            for d in range(days)
        ]
    }
    deposits = [{"timestamp": since_ms, "currency": "USDT", "amount": 50_000_000.0}]
    return er._compute_daily_equity(trades, deposits, [], ohlcv, {}, start_date, end_date)


def _a6_shaped_book() -> list[dict[str, Any]]:
    """The shape that motivated the phase: a finite book over the 105 grid windows of a 729 day
    range, 40 small trades in each (one more than a segment, 10,500, in window 40), fees in all
    three shapes the venue sends (a dict, a bare number, none), an amount that differs per window
    so the replayed equity moves, and a handful of trades in the window that holds now."""
    book: list[dict[str, Any]] = []
    for k in range(_WINDOWS):
        rows = (
            trade_rows(10_500, _window_start(k) + 1000, 50, id_prefix=f"big{k:03d}-")
            if k == 40
            else trade_rows(40, _window_start(k) + 1000, 60_000, id_prefix=f"s{k:03d}-")
        )
        for i, row in enumerate(rows):
            row["amount"] = 0.001 * (1 + k % 7)
            row["cost"] = row["price"] * row["amount"]
            row["fee"] = (
                {"cost": 0.05 * (1 + i % 3), "currency": "USDT"} if i % 3 == 0
                else 0.02 if i % 3 == 1
                else None
            )
        book += rows
    return book


async def test_a_book_read_across_claims_equals_a_single_pass(monkeypatch: pytest.MonkeyPatch) -> None:
    """SC-1, the equivalence oracle. An a6-shaped book read across several claims of ONE job (a
    small budget, so each claim stores some windows and defers) gives the same equity replay as one
    unscoped pass over the book, every field of every day. The oracle is the unscoped read plus the
    replay, not a re-implementation of the claim logic: a window lost, doubled or reordered by the
    claims shows as a different curve. At the old behaviour (no store) there is nothing to resume,
    so this property did not exist."""
    book = _a6_shaped_book()
    clock = _Clock()
    fake = FakeSupabaseClient()

    single = await er._fetch_trades_with_pagination(
        _clocked_exchange(book, _Clock()), "bybit", _START_MS, _NOW_MS
    )
    oracle_trades = single[0]
    assert len(oracle_trades) == len(book)

    exchange = _clocked_exchange(book, clock)
    claims = 0
    resumed: list[dict[str, Any]] | None = None
    while resumed is None:
        claims += 1
        assert claims < 40, "the job must finish"
        scope = _scope(fake, clock, monkeypatch, budget_s=25.0)
        windows_before = len(_stored_starts(fake))
        try:
            with store.trade_read_scope(scope):
                resumed, _terminus = await er._fetch_trades_with_pagination(
                    exchange, "bybit", _START_MS, _NOW_MS
                )
        except store.TradeReadDeferred:
            assert len(_stored_starts(fake)) > windows_before, "every deferred claim stored a window"

    assert claims >= 4, f"the oracle needs a read across at least four claims, got {claims}"
    assert len(resumed) == len(book)
    assert {(t["symbol"], t["timestamp"], t["amount"]) for t in resumed} == {
        (t["symbol"], t["timestamp"], t["amount"]) for t in oracle_trades
    }
    replayed = _replay(resumed, _START_MS, _NOW_MS)
    assert len(replayed) == 730
    assert len({r["value_usd"] for r in replayed}) > 5, "the curve must move"
    assert replayed == _replay(oracle_trades, _START_MS, _NOW_MS)


async def test_a_resumed_read_on_the_next_day_equals_a_single_pass_from_the_new_start(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """SC-1, the next UTC day. Claim 1 (day D) stores some windows and defers. Claim 2 runs a day
    later: the read start and "now" both moved forward a day. The grid origin of the first claim is
    KEPT (so the stored windows still line up), the output holds no trade before the new start, and
    its replay equals one unscoped pass that starts at the new start."""
    book = _spread_book(range(0, 10))
    clock = _Clock()
    fake = FakeSupabaseClient()
    exchange = _clocked_exchange(book, clock)
    now_one = _window_start(9) + 2 * DAY_MS
    since_two, now_two = _START_MS + DAY_MS, now_one + DAY_MS

    with pytest.raises(store.TradeReadDeferred):
        with store.trade_read_scope(_scope(fake, clock, monkeypatch, budget_s=2.5)):
            await er._fetch_trades_with_pagination(exchange, "bybit", _START_MS, now_one)
    assert _stored_starts(fake) == {_window_start(k) for k in range(3)}

    clock.t += 120.0
    clock.wall_ms += DAY_MS
    with store.trade_read_scope(_scope(fake, clock, monkeypatch, budget_s=1e9)):
        resumed, _terminus = await er._fetch_trades_with_pagination(exchange, "bybit", since_two, now_two)

    (state_row,) = fake.rows_for(store.STATE_TABLE)
    assert state_row["grid_origin_ms"] == _START_MS, "the first claim's grid origin is kept"
    assert any(t["timestamp"] < since_two for t in book), "the book holds trades before the new start"
    assert all(t["timestamp"] >= since_two for t in resumed)
    oracle, _ = await er._fetch_trades_with_pagination(
        _clocked_exchange(book, _Clock()), "bybit", since_two, now_two
    )
    assert _fingerprint(resumed) == _fingerprint(oracle)
    replayed = _replay(resumed, since_two, now_two)
    assert len({r["value_usd"] for r in replayed}) > 3, "the curve must move"
    assert replayed == _replay(oracle, since_two, now_two)


async def _one_claim(
    monkeypatch: pytest.MonkeyPatch, created_at: Any
) -> tuple[Any, FakeSupabaseClient, Any]:
    """One claim of a job created at ``created_at``, with a budget that runs out at a boundary."""
    clock = _Clock()
    fake = _rig(monkeypatch, clock, budget_s=45.0)
    exchange = await _venue(_big_book(), clock)
    audit = _install(monkeypatch, fake, exchange)
    job = {**_claim_job("T1"), "created_at": created_at}
    return await er.run_reconstruct_allocator_history_job(job), fake, audit


async def test_a_day_old_job_is_stalled_by_name_at_its_defer_point(monkeypatch: pytest.MonkeyPatch) -> None:
    """T-171-22, the backstop. A defer burns no attempt, so a job that keeps being deferred past
    a day is stopped at its defer point, by name (cause ``job_age``), with its windows kept. A
    ``created_at`` that cannot be read counts as too old (a bound that cannot be evaluated must not
    become no bound). The same point on a job one hour old DEFERS."""
    young, fake_young, audit_young = await _one_claim(
        monkeypatch, (END_DATE - timedelta(hours=1)).isoformat()
    )
    assert young.outcome == DispatchOutcome.DEFERRED, young
    assert not _failure_audits(audit_young)

    for created_at in ((END_DATE - timedelta(hours=25)).isoformat(), "not a timestamp", None):
        stopped, fake, audit = await _one_claim(monkeypatch, created_at)

        assert stopped.outcome == DispatchOutcome.FAILED, (created_at, stopped)
        assert stopped.error_kind == "permanent"
        assert _STALL_MESSAGE.match(stopped.error_message or ""), stopped.error_message
        assert "cause=job_age" in (stopped.error_message or "")
        assert len(_failure_audits(audit)) == 1
        assert not _defer_calls(fake)
        assert not _snapshots(fake)
        assert _stored_starts(fake), "the windows read so far are kept for a later job"


async def test_the_watchdog_loop_runs_the_trade_read_sweep_and_survives_its_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """T-171-35 and T-171-36. The sweep is only worth having if the watchdog loop calls it, and it
    must never stop the loop: a sweep that raises on its first call is called again on the next
    tick, and the loop task ends without an exception. (The orphan-sweep loop test's technique.)"""
    import asyncio

    import main_worker

    calls = 0
    shutdown = asyncio.Event()
    monkeypatch.setattr(main_worker, "SHUTDOWN", shutdown)

    async def _tick() -> None:
        return None

    async def _orphans() -> None:
        return None

    async def _sweep() -> None:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise RuntimeError("fixture: sweep blew up")
        shutdown.set()

    monkeypatch.setattr(main_worker, "watchdog_tick", _tick)
    monkeypatch.setattr(main_worker, "report_orphaned_capped_reconstructs", _orphans)
    monkeypatch.setattr(main_worker, "sweep_expired_trade_reads", _sweep)

    task = asyncio.create_task(main_worker.watchdog_loop(interval=0.01))
    done, pending = await asyncio.wait({task}, timeout=3.0)
    for p in pending:
        p.cancel()

    assert task in done, "watchdog_loop hung"
    assert calls >= 2, f"the trade read sweep ran {calls} time(s); a failing sweep stopped the loop"
    assert task.exception() is None


async def test_a_stalled_job_carries_no_venue_text(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """H-3 and T-171-24 for the stop. A signature planted in every trade's ``info`` (venue text)
    reaches no log record, no audit call, no RPC argument, no stored row and neither stall message,
    across the stalled-claims stop and the job-age stop. Both messages are a closed cause plus an
    integer, so nothing a venue said can ride into ``compute_jobs.last_error`` or the audit trail."""
    book = _big_book(signature=True)
    clock = _Clock()
    fake = _rig(monkeypatch, clock, budget_s=0.0)
    exchange = await _venue(book, clock)
    audit = _install(monkeypatch, fake, exchange)
    await _seed_one_stored_window(fake, book)
    caplog.set_level(logging.DEBUG)
    caplog.clear()

    results = [await er.run_reconstruct_allocator_history_job(_stall_job(f"T{n}")) for n in (1, 2, 3, 4)]
    old = await er.run_reconstruct_allocator_history_job(
        {**_stall_job("T5", _OTHER_JOB_ID), "created_at": (END_DATE - timedelta(hours=30)).isoformat()}
    )

    assert [r.outcome for r in results] == [DispatchOutcome.DEFERRED] * 3 + [DispatchOutcome.FAILED]
    assert old.outcome == DispatchOutcome.FAILED
    assert "cause=stalled_claims" in (results[3].error_message or "")
    assert "cause=job_age" in (old.error_message or "")
    assert len(_failure_audits(audit)) == 2
    for text in (repr(results), repr(old), repr(audit.call_args_list), repr(fake.rpc_calls), repr(_store_rows(fake))):
        assert _SIGNATURE not in text
    assert not [r for r in caplog.records if _SIGNATURE in r.getMessage() or _SIGNATURE in repr(r.args)]
