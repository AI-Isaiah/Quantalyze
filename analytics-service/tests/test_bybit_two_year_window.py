"""Phase 167.2.1.1.2.1 TRADEPAGES, plan 03: the Bybit two-year edge (D-01).

WHY these tests exist. Bybit rejects a trade query whose start is older than two years
(retCode 10001, which ccxt raises as ``BadRequest``). A rebuild window of 730 days from
UTC midnight starts at ``730 days + the time of day`` old, so on PROD it crossed the limit
and the account refused ``account_key_read_failed`` (the a2 refusal of ACCTREBUILD SC-3).
Founder decision D-01 (2026-10-23): an account holding a Bybit key starts its window at the
first whole UTC day Bybit still serves, 729 days back, with no new refusal token.

1. The window rule (``_account_rebuild_window`` for a forced rebuild, the unforced start of
   ``run_reconstruct_allocator_history_job``): a Bybit key gives 729 days back, OKX still
   wins with its 89, every other venue keeps 730. ``window_days`` stays 730.
2. The tracer: a forced rebuild started mid-morning against a fake that rejects a start older
   than two years the way Bybit does, completes and records its boundary 729 days back.
3. The midnight edge (research Pitfall 4): the window is fixed when the job starts and the
   trade read runs later, so a job begun before 00:00 UTC whose read begins after it asks for a
   start older than two years. That crawl is REFUSED before any trade request and writes
   nothing; it is never clamped (a clamp would start the trades after the curve starts, so the
   replay's opening balance would be wrong).

Fakes are the venue-faithful ones of ``tests/_trade_pages.py``; no test touches a venue or
a database.
"""

from __future__ import annotations

import copy
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any
from unittest.mock import AsyncMock

import pytest

from services import equity_reconstruction as er
from services.equity_reconstruction import run_reconstruct_allocator_history_job
from services.job_worker import DispatchOutcome
from tests._trade_pages import VenueTradeBook
from tests.test_equity_reconstruction import (
    ALLOCATOR_ID,
    API_KEY_ID_1,
    API_KEY_ID_2,
    _install_fake_audit,
    _install_fake_preflight,
)
from tests.test_reconstruct_force_rebuild import (
    COMPLETE,
    LEAKED_SIGNATURE,
    STARTED,
    _audit_metadata,
    _bybit_exchange,
    _forced_job,
    _freeze_now_at,
    _seed_sentinel_rows,
)
from tests.test_reconstruct_marker_writer import (
    END_DATE,
    _crawl_exchange,
    _job,
    _marker_of,
    _MarkerFake,
    _seed_key,
)
from tests.test_reconstruct_whole_account import (
    _assert_account_rebuild_refused,
    _book_state,
    _install_account_preflight,
    _key,
    _seed_account_key,
    _seed_two_account_book,
    _sibling_bybit_exchange,
    _window_rpc_calls,
)

MID_MORNING = END_DATE + timedelta(hours=10)


def _ms(instant: datetime) -> int:
    return int(instant.timestamp() * 1000)


def _clock_ms() -> float:
    """The current UTC instant in ms on the clock the code under test reads
    (``er.datetime``), whichever freeze is installed when the request arrives."""
    return er.datetime.now(timezone.utc).timestamp() * 1000


def _enforce_two_year_limit(exchange: Any) -> VenueTradeBook:
    """Swap an exchange's trade read for the SAME trades behind a Bybit that rejects a
    start older than two years, measured on the frozen clock."""
    book = exchange.fetch_my_trades.side_effect
    assert isinstance(book, VenueTradeBook), type(book)
    limited = VenueTradeBook(exchange, book.trades, two_year_limit_now=_clock_ms)
    exchange.fetch_my_trades = AsyncMock(side_effect=limited)
    return limited


# --------------------------------------------------------------------------- the window rule


def test_the_account_window_is_729_days_back_when_a_bybit_key_is_selected() -> None:
    """D-01: a Bybit key starts the window 729 days back (Bybit rejects a start older than two
    years, and 730 days back from UTC midnight is older than that for the whole UTC day).
    ``window_days`` stays 730. OKX's tighter 89-day window still wins on a mixed account; a
    book with no Bybit key keeps 730."""
    end = date(2026, 4, 15)
    d729 = end - timedelta(days=729)
    d730 = end - timedelta(days=730)
    assert er._account_rebuild_window([_key("k1", "bybit")], end) == (d729, 730)
    assert er._account_rebuild_window([_key("k1", "bybit"), _key("k2", "mt5")], end) == (d729, 730)
    assert er._account_rebuild_window([_key("k1", "okx"), _key("k2", "bybit")], end) == (
        end - timedelta(days=89),
        90,
    )
    assert er._account_rebuild_window([_key("k1", "mt5")], end) == (d730, 730)
    assert er._account_rebuild_window([_key("k1", "binance")], end) == (d730, 730)
    assert er._account_rebuild_window(
        [_key("k1", "binance"), _key("k2", "mt5")], end
    ) == (d730, 730)


def test_the_window_constants_are_the_ones_the_rule_names() -> None:
    """The cap sentinel stays 730 (a TypeScript mirror and an audit field read it) and the
    Bybit limit is its own named constant, so moving the window is a decision about Bybit."""
    assert er.BACKFILL_CAP_DAYS == 730
    assert er.BYBIT_TRADE_TERMINUS_DAYS == 730
    assert er._bybit_window_start(date(2026, 4, 15)) == date(2026, 4, 15) - timedelta(days=729)


# --------------------------------------------------------------------------- the tracer


@pytest.mark.asyncio
async def test_a_bybit_account_rebuilt_mid_morning_starts_inside_the_two_year_limit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-01 end to end, the tracer. An allocator holds two Bybit exchange accounts and a forced
    rebuild runs at 10:00 UTC against venues that REJECT a trade start older than two years
    (retCode 10001 as ccxt ``BadRequest``). The rebuild completes, replaces its window in one
    call, records the seam 729 days back, and no Bybit request starts earlier than that. The day
    older than the window keeps every column.

    RED at the base commit: the 730-day start is older than two years at 10:00, the venue
    rejects it, and the account refuses ``account_key_read_failed`` (the a2 refusal on PROD).
    RED under drill D: a window helper that returns 730 days back."""
    fake = _MarkerFake()
    _seed_two_account_book(fake)
    older_asof = (END_DATE - timedelta(days=800)).date().isoformat()
    older_key = ("allocator_equity_snapshots", (ALLOCATOR_ID, older_asof))
    older_before = copy.deepcopy(fake.store[older_key])
    audit = _install_fake_audit(monkeypatch)
    exchange_1 = await _bybit_exchange()
    exchange_2 = await _sibling_bybit_exchange()
    books = [_enforce_two_year_limit(exchange_1), _enforce_two_year_limit(exchange_2)]
    _install_account_preflight(
        monkeypatch, fake, {API_KEY_ID_1: exchange_1, API_KEY_ID_2: exchange_2}
    )
    _freeze_now_at(monkeypatch, MID_MORNING)

    result = await run_reconstruct_allocator_history_job(_forced_job())

    assert result.outcome == DispatchOutcome.DONE, result
    assert len(_window_rpc_calls(fake)) == 1, fake.rpc_calls

    boundary = fake.store[("allocator_equity_derived", (ALLOCATOR_ID, "snapshot_rebuild_boundary"))]
    assert boundary["payload"] == {
        "boundary_date": (END_DATE - timedelta(days=729)).date().isoformat()  # D-01
    }
    (complete,) = _audit_metadata(audit, COMPLETE)
    assert complete["window_days"] == 730
    assert complete["forced_rebuild"] is True

    earliest_allowed = _ms(END_DATE - timedelta(days=729))
    for index, book in enumerate(books):
        assert book.calls, f"exchange {index} saw no trade request"
        starts = [call["since"] for call in book.calls]
        assert min(starts) >= earliest_allowed, (
            f"exchange {index} asked for a start {min(starts)} before {earliest_allowed}"
        )
        assert min(starts) == earliest_allowed, "the first request is the window start itself"
    assert fake.store[older_key] == older_before, "the day older than the window was rewritten"


# --------------------------------------------------------------------------- the unforced start


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("venue", "days_back"), [("bybit", 729), ("binance", 730)]
)
async def test_an_unforced_bybit_reconstruct_starts_729_days_back(
    monkeypatch: pytest.MonkeyPatch, venue: str, days_back: int
) -> None:
    """D-01 on the unforced first-connect path: a Bybit key's first trade request starts 729
    days back, on a venue that rejects anything older than two years, at 10:00 UTC. A Binance
    key keeps 730 days back, and the ``reconstruct_started`` audit metadata is unchanged for both
    (``backfill_cap_days`` stays the 730 cap).

    RED at the base commit for Bybit: the 730-day start is rejected and the job fails."""
    fake = _MarkerFake()
    _seed_key(fake, API_KEY_ID_1, marker=None, exchange=venue)
    audit = _install_fake_audit(monkeypatch)
    exchange = await _bybit_exchange() if venue == "bybit" else _crawl_exchange()
    if venue == "bybit":
        book = _enforce_two_year_limit(exchange)
    else:
        book = exchange.fetch_my_trades.side_effect
    _install_fake_preflight(monkeypatch, venue, fake, exchange)
    _freeze_now_at(monkeypatch, MID_MORNING)

    result = await run_reconstruct_allocator_history_job(_job())

    assert result.outcome == DispatchOutcome.DONE, result
    assert book.calls, "no trade request was sent"
    assert book.calls[0]["since"] == _ms(END_DATE - timedelta(days=days_back))
    assert _audit_metadata(audit, STARTED) == [{"venue": venue, "backfill_cap_days": 730}]
    assert _marker_of(fake, API_KEY_ID_1) is not None



# --------------------------------------------------------------------------- the midnight edge


def _install_two_clocks(
    monkeypatch: pytest.MonkeyPatch, job_start: datetime, crawl_start: datetime
) -> None:
    """``er.datetime.now`` answers ``job_start`` until the window crawl begins and ``crawl_start``
    from then on. The switch happens inside a wrapper around ``er._fetch_and_price_window`` that
    moves the clock and calls the original, so ``end_date`` (read at job start) and the trade
    read's ``now_ms`` (read when the crawl begins) straddle the instant between them."""
    clock = {"now": job_start}

    class _FakeDatetime(datetime):
        @classmethod
        def now(cls, tz: Any = None) -> Any:  # type: ignore[override]
            instant = clock["now"]
            return instant if tz else instant.replace(tzinfo=None)

    monkeypatch.setattr(er, "datetime", _FakeDatetime)
    original = er._fetch_and_price_window

    async def _crawl(*args: Any, **kwargs: Any) -> Any:
        clock["now"] = crawl_start
        return await original(*args, **kwargs)

    monkeypatch.setattr(er, "_fetch_and_price_window", _crawl)


BEFORE_MIDNIGHT = END_DATE + timedelta(hours=23, minutes=50)
AFTER_MIDNIGHT = END_DATE + timedelta(days=1, minutes=5)


@pytest.mark.asyncio
async def test_a_bybit_crawl_that_crosses_midnight_refuses_and_writes_nothing(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """Research Pitfall 4, forced. The job begins at 23:50 UTC (its window starts 729 days back
    from that day) and its trade read begins at 00:05 the next day, when that start is already
    older than two years. The crawl is REFUSED before any trade request, never clamped: a clamp
    would start the trades after the curve starts and the replay's opening balance would be wrong
    (T-167.2.1.1.2.1-05). The job ends FAILED/permanent naming ``account_key_read_failed``, the
    existing token (D-01: no new one), with zero trade requests (so no clamped start was asked
    for either), no window or replace call, and every snapshot, derived and api_keys row as it
    was. The guard logs one WARNING naming the venue and the start's age in whole days, and no
    fixture signature reaches any log record.

    RED under drill E (the guard deleted): the request goes out, the limit-enforcing fake rejects
    it, and the test sees a trade request that must not exist."""
    caplog.set_level(logging.WARNING)
    fake = _MarkerFake()
    _seed_account_key(fake, API_KEY_ID_1, "bybit", venue_account_id="fixture-acct-1")
    _seed_sentinel_rows(fake)
    audit = _install_fake_audit(monkeypatch)
    exchange = await _bybit_exchange()
    book = _enforce_two_year_limit(exchange)
    _install_account_preflight(monkeypatch, fake, {API_KEY_ID_1: exchange})
    _install_two_clocks(monkeypatch, BEFORE_MIDNIGHT, AFTER_MIDNIGHT)
    before = _book_state(fake)

    result = await run_reconstruct_allocator_history_job(_forced_job())

    assert exchange.fetch_my_trades.await_count == 0, (
        f"{exchange.fetch_my_trades.await_count} trade request(s) were sent, "
        f"starts {[c['since'] for c in book.calls]}"
    )
    _assert_account_rebuild_refused(
        fake,
        result,
        audit,
        "account_key_read_failed",
        before=before,
        exchanges_crawled=(),
        exchanges_untouched=(),
        caplog=caplog,
    )
    guard_records = [r.getMessage() for r in caplog.records if "two-year limit" in r.getMessage()]
    assert len(guard_records) == 1, guard_records
    assert "venue=bybit" in guard_records[0], guard_records
    assert "window_age_days=730" in guard_records[0], guard_records
    assert LEAKED_SIGNATURE not in guard_records[0]


@pytest.mark.asyncio
async def test_an_unforced_bybit_crawl_that_crosses_midnight_fails_and_writes_nothing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Research Pitfall 4, unforced first-connect. The same clock: the guard's ``BadRequest`` is
    the class Bybit's own rejection arrives as, so the generic handler arm fails the job
    ``permanent`` exactly as it already does for the venue's own refusal. Zero trade requests, no
    snapshot written, no replace call, and the key's marker unchanged."""
    fake = _MarkerFake()
    _seed_key(fake, API_KEY_ID_1, marker=None, exchange="bybit")
    audit = _install_fake_audit(monkeypatch)
    exchange = await _bybit_exchange()
    _enforce_two_year_limit(exchange)
    _install_fake_preflight(monkeypatch, "bybit", fake, exchange)
    _install_two_clocks(monkeypatch, BEFORE_MIDNIGHT, AFTER_MIDNIGHT)

    result = await run_reconstruct_allocator_history_job(_job())

    assert result.outcome == DispatchOutcome.FAILED, result
    assert result.error_kind == "permanent", result
    assert "two-year limit" in (result.error_message or ""), result.error_message
    assert exchange.fetch_my_trades.await_count == 0
    assert fake.rows_for("allocator_equity_snapshots") == []
    assert [n for (n, _p) in fake.rpc_calls if n.startswith("replace_allocator_equity")] == []
    assert _marker_of(fake, API_KEY_ID_1) is None
    assert fake.api_key_updates() == [], fake.api_key_updates()
    assert not [
        c for c in audit.call_args_list if c.kwargs.get("action") == COMPLETE
    ], "a refused crawl wrote a completion audit"


@pytest.mark.asyncio
async def test_a_bybit_crawl_inside_the_day_is_not_refused(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The guard leaves every in-day crawl alone: at 23:59 UTC for both the job start and the
    crawl, the 729-day start is still under two years old, so the rebuild completes and its first
    request starts exactly 729 days back."""
    fake = _MarkerFake()
    _seed_key(fake, API_KEY_ID_1, marker=None, exchange="bybit")
    _install_fake_audit(monkeypatch)
    exchange = await _bybit_exchange()
    book = _enforce_two_year_limit(exchange)
    _install_fake_preflight(monkeypatch, "bybit", fake, exchange)
    _freeze_now_at(monkeypatch, END_DATE + timedelta(hours=23, minutes=59))

    result = await run_reconstruct_allocator_history_job(_job())

    assert result.outcome == DispatchOutcome.DONE, result
    assert book.calls[0]["since"] == _ms(END_DATE - timedelta(days=729))


@pytest.mark.asyncio
async def test_the_two_year_refusal_adds_no_token() -> None:
    """D-01 'No new refusal token': the two-year guard adds no token to the closed set of
    forced-rebuild refusal reasons, and the guard's own message is not one of them (it reaches the
    forced path as the existing ``account_key_read_failed`` through the gather converter).

    2026-10-27 (Phase 171 READCEILING plan 10): the set is 16 tokens. The 16th,
    ``account_key_read_stalled``, is Phase 171's (a forced read that makes no progress); the
    two-year guard still adds none."""
    assert len(er.FORCED_REBUILD_REFUSAL_REASONS) == 16
    exchange = AsyncMock()
    exchange.id = "bybit"
    now_ms = _ms(AFTER_MIDNIGHT)
    too_old = now_ms - 730 * 24 * 60 * 60 * 1000 - 1
    with pytest.raises(er.ccxt.BadRequest) as excinfo:
        await er._fetch_bybit_trades(exchange, too_old, now_ms)
    assert str(excinfo.value) not in er.FORCED_REBUILD_REFUSAL_REASONS
    # The guard stays a plain BadRequest: only a cut-short read is a TruncatedTradeRead, so the
    # allocator history probe can tell the two apart.
    assert type(excinfo.value) is er.ccxt.BadRequest
    assert exchange.fetch_my_trades.await_count == 0
