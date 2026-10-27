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

import copy
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any
from unittest.mock import AsyncMock

import pytest

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
    """The fake monotonic clock behind ``store._monotonic``."""

    def __init__(self) -> None:
        self.t = 1000.0


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
