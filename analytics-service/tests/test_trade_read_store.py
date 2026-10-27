"""Phase 171 READCEILING, plan 04: the store a resumable Bybit read keeps its progress in (D-02).

Every test runs ``services.trade_read_store`` over the repo's in-memory Supabase fake. The
fake used here additionally round-trips every written payload through JSON with
``allow_nan=False``, because the real store is a jsonb column: a float that does not survive
the wire, or a NaN, must show up in these tests and not in production.

The module is imported inside each test (``from services import trade_read_store as store``)
so a missing module fails the test itself, not collection.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any

import pytest
from postgrest.exceptions import APIError

from tests._trade_pages import trade_rows
from tests.test_equity_reconstruction import FakeSupabaseClient, _FakeTable

KEY = "00000000-0000-0000-0000-0000000000a1"
OTHER_KEY = "00000000-0000-0000-0000-0000000000a2"
JOB = "00000000-0000-0000-0000-0000000000b1"
OTHER_JOB = "00000000-0000-0000-0000-0000000000b2"

DAY_MS = 24 * 60 * 60 * 1000
WEEK_MS = 7 * DAY_MS
# A synthetic grid origin: a Thursday 00:00 UTC in 2026. Any millisecond would do.
ORIGIN_MS = 1_767_225_600_000


class _JsonTable(_FakeTable):
    """A table whose writes cross a JSON boundary, as they do on the way to jsonb."""

    def upsert(self, rows: Any, on_conflict: Any = None, ignore_duplicates: bool = False,
               count: Any = None, returning: Any = None) -> Any:
        wire = json.loads(json.dumps(rows, allow_nan=False))
        return super().upsert(wire, on_conflict=on_conflict, ignore_duplicates=ignore_duplicates,
                              count=count, returning=returning)

    def update(self, payload: dict) -> Any:
        return super().update(json.loads(json.dumps(payload, allow_nan=False)))


class JsonFakeClient(FakeSupabaseClient):
    def table(self, name: str) -> _FakeTable:
        return _JsonTable(name, self.store)


def _window_rows(client: FakeSupabaseClient, key: str = KEY) -> list[dict[str, Any]]:
    from services import trade_read_store as store

    rows = [
        dict(r) for (tbl, _pk), r in client.store.items()
        if tbl == store.WINDOW_TABLE and r.get("api_key_id") == key
    ]
    return sorted(rows, key=lambda r: (r["window_start_ms"], r["chunk_index"]))


def _fee_shaped_trades(count: int, first_ms: int, step_ms: int) -> list[dict[str, Any]]:
    """ccxt-shaped trades with the fee and cost shapes a venue produces and floats that are
    not exactly representable, so a lossy round trip cannot hide."""
    trades = trade_rows(count, first_ms, step_ms)
    for i, t in enumerate(trades):
        t["price"] = 50000.0 + i * 0.1
        t["amount"] = 0.001 * (i % 13 + 1)
        t["cost"] = None if i % 7 == 0 else t["price"] * t["amount"]
        if i % 3 == 0:
            t["fee"] = {"cost": None, "currency": "USDT"}
        elif i % 3 == 1:
            t["fee"] = 0.0001 * (i + 1)
        else:
            t["fee"] = None
    return trades


async def test_a_stored_window_round_trips_to_the_same_trades() -> None:
    """D-02: a window of any size is kept as chunks of at most 5,000 trades and read back as
    exactly the trades the replay would have seen, in the same order, float for float."""
    from services import trade_read_store as store

    client = JsonFakeClient()
    originals = _fee_shaped_trades(12_001, ORIGIN_MS + 1_000, 40)
    window_end = ORIGIN_MS + WEEK_MS

    saved = await store.save_window(client, KEY, ORIGIN_MS, window_end, originals)
    assert saved is True

    chunks = _window_rows(client)
    assert [c["chunk_index"] for c in chunks] == [0, 1, 2]
    assert [c["n_trades"] for c in chunks] == [5000, 5000, 2001]
    assert {c["chunk_count"] for c in chunks} == {3}
    assert all(len(c["trades"]) == c["n_trades"] for c in chunks)
    assert all(c["read_version"] == store.TRADE_READ_VERSION for c in chunks)

    state = await store.begin_claim(client, KEY, venue="bybit", since_ms=ORIGIN_MS, job_id=JOB)
    assert state is not None, "the store answered; a None here would be a swallowed fault"
    assert list(state.stored) == [ORIGIN_MS]
    meta = state.stored[ORIGIN_MS]
    assert (meta.window_start_ms, meta.window_end_ms) == (ORIGIN_MS, window_end)
    assert (meta.chunk_count, meta.n_trades) == (3, 12_001)

    loaded = await store.load_window(client, KEY, meta)
    assert loaded is not None
    assert loaded == [store.unproject_trade(store.project_trade(t)) for t in originals]
    assert len(loaded) == len(originals)
    for got, want in zip(loaded, originals, strict=True):
        assert got["timestamp"] == want["timestamp"]
        assert got["price"] == want["price"]
        assert got["amount"] == want["amount"]
        assert got["cost"] == want["cost"]
        assert tuple(got) == store.PROJECTION_FIELDS


async def test_the_projection_is_replay_equal_for_every_fee_shape() -> None:
    """The stored form must replay exactly as the venue's rows: a dict fee with a None cost, a
    dict fee with a cost, a float fee and no fee at all each give equal equity rows."""
    from services import trade_read_store as store
    from services.equity_reconstruction import _compute_daily_equity

    day_1, day_2 = date(2026, 4, 15), date(2026, 4, 16)
    ts_1 = int(datetime(2026, 4, 15, 9, tzinfo=timezone.utc).timestamp() * 1000)
    ts_2 = int(datetime(2026, 4, 16, 9, tzinfo=timezone.utc).timestamp() * 1000)
    ohlcv = {"BTC": [(day_1.isoformat(), 50_000.0), (day_2.isoformat(), 51_000.0)]}

    def _replay(trades: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return _compute_daily_equity(
            trades=trades, deposits=[], withdrawals=[], ohlcv_by_symbol=ohlcv,
            coingecko_by_symbol={}, start_date=day_1, end_date=day_2, venue="bybit",
        )

    fee_shapes: dict[str, Any] = {
        "dict_cost_none": {"cost": None, "currency": "USDT"},
        "dict_with_cost": {"cost": 7.25, "currency": "USDT"},
        "float": 3.5,
        "none": None,
    }
    for name, fee in fee_shaped_cases(fee_shapes, ts_1, ts_2):
        client = JsonFakeClient()
        saved = await store.save_window(client, KEY, ts_1 - 1, ts_2 + 1, fee)
        assert saved is True, name
        state = await store.begin_claim(client, KEY, venue="bybit", since_ms=ts_1 - 1, job_id=JOB)
        assert state is not None, name
        loaded = await store.load_window(client, KEY, state.stored[ts_1 - 1])
        assert loaded is not None, name
        assert _replay(loaded) == _replay(fee), name

    # The comparison can fail: a fee is not noise to the replay.
    with_fee = _replay([_spot_trade(ts_1, "buy", 7.25)])
    without_fee = _replay([_spot_trade(ts_1, "buy", None)])
    assert with_fee != without_fee


def _spot_trade(ts_ms: int, side: str, fee: Any) -> dict[str, Any]:
    return {
        "id": f"s{ts_ms}{side}", "timestamp": ts_ms, "symbol": "BTC/USDT", "side": side,
        "amount": 0.5, "price": 50_000.0, "cost": 25_000.0, "fee": fee, "info": {},
    }


def fee_shaped_cases(
    fee_shapes: dict[str, Any], ts_1: int, ts_2: int
) -> list[tuple[str, list[dict[str, Any]]]]:
    """One two-day trade list per fee shape: a buy on day one and a partial sell on day two."""
    return [
        (name, [_spot_trade(ts_1, "buy", fee), _spot_trade(ts_2, "sell", fee)])
        for name, fee in fee_shapes.items()
    ]


# ---------------------------------------------------------------------------
# The fake itself: a delete must filter like a select, or a purge test is vacuous.
# ---------------------------------------------------------------------------


def _numbered_table(client: FakeSupabaseClient) -> None:
    client.table("t").upsert(
        [{"id": i, "n": i * 10} for i in range(1, 6)], on_conflict="id"
    ).execute()


def _ids(client: FakeSupabaseClient) -> list[int]:
    return sorted(r["id"] for (tbl, _pk), r in client.store.items() if tbl == "t")


def test_the_fake_delete_honours_range_and_in_filters() -> None:
    client = FakeSupabaseClient()

    _numbered_table(client)
    client.table("t").delete().lte("n", 30).execute()
    assert _ids(client) == [4, 5], "lte removes the rows at or below the bound only"

    client = FakeSupabaseClient()
    _numbered_table(client)
    client.table("t").delete().lt("n", 30).execute()
    assert _ids(client) == [3, 4, 5], "lt removes the rows strictly below the bound only"

    client = FakeSupabaseClient()
    _numbered_table(client)
    client.table("t").delete().in_("id", [2, 4]).execute()
    assert _ids(client) == [1, 3, 5], "in_ removes the listed values only"

    client = FakeSupabaseClient()
    _numbered_table(client)
    client.table("t").delete().gte("n", 40).in_("id", [1, 4]).execute()
    assert _ids(client) == [1, 2, 3, 5], "filters combine"

    # A select is unchanged: same predicates, nothing removed.
    client = FakeSupabaseClient()
    _numbered_table(client)
    assert [r["id"] for r in client.table("t").select("*").lt("n", 30).execute().data] == [1, 2]
    assert [r["id"] for r in client.table("t").select("*").in_("id", [3, 5]).execute().data] == [3, 5]
    assert _ids(client) == [1, 2, 3, 4, 5]


# ---------------------------------------------------------------------------
# Helpers for the claim, staleness and purge tests
# ---------------------------------------------------------------------------

_LOGGER = "quantalyze.analytics.trade_read_store"
#: A planted signature: stored in a row or raised by a client, it must reach no log record.
_SIGNATURE = "SIGNATURE-planted-symbol-secret"


class _Clock:
    """The store's wall-clock seam, frozen unless a test moves it."""

    def __init__(self, now_ms: int) -> None:
        self.now_ms = now_ms

    def __call__(self) -> int:
        return self.now_ms


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> _Clock:
    from services import trade_read_store as store

    frozen = _Clock(int(datetime(2026, 10, 27, 12, tzinfo=timezone.utc).timestamp() * 1000))
    monkeypatch.setattr(store, "_wall_ms", frozen)
    return frozen


def _a_trade(ts_ms: int, symbol: str = "BTC/USDT") -> dict[str, Any]:
    return {
        "timestamp": ts_ms, "symbol": symbol, "side": "buy", "amount": 0.5, "price": 50_000.5,
        "cost": 25_000.25, "fee": {"cost": 1.5, "currency": "USDT"}, "info": {},
    }


async def _claim(client: FakeSupabaseClient, key: str = KEY, *, since_ms: int = ORIGIN_MS,
                 job_id: str | None = JOB) -> Any:
    from services import trade_read_store as store

    state = await store.begin_claim(client, key, venue="bybit", since_ms=since_ms, job_id=job_id)
    assert state is not None, "the store answered; a None here would be a swallowed fault"
    return state


async def _store_week(client: FakeSupabaseClient, week: int, key: str = KEY, n: int = 3) -> int:
    """Store the n-trade window `week` weeks after the origin; returns its start."""
    from services import trade_read_store as store

    start = ORIGIN_MS + week * WEEK_MS
    saved = await store.save_window(
        client, key, start, start + WEEK_MS, [_a_trade(start + i + 1) for i in range(n)]
    )
    assert saved is True
    return start


def _state_row(client: FakeSupabaseClient, key: str = KEY) -> dict[str, Any] | None:
    from services import trade_read_store as store

    for (tbl, _pk), r in client.store.items():
        if tbl == store.STATE_TABLE and r.get("api_key_id") == key:
            return dict(r)
    return None


def _put_chunk(client: FakeSupabaseClient, start: int, index: int, count: int, *, key: str = KEY,
               **overrides: Any) -> None:
    """Write one chunk row straight into the fake, whole and current unless overridden."""
    from services import trade_read_store as store

    row: dict[str, Any] = {
        "api_key_id": key, "window_start_ms": start, "chunk_index": index, "chunk_count": count,
        "window_end_ms": start + WEEK_MS, "read_version": store.TRADE_READ_VERSION, "n_trades": 1,
        "trades": [[start + 1, "BTC/USDT", "buy", 1.0, 2.0, 2.0, 0.0]],
        "expires_at": store._iso(store._wall_ms() + store.STORE_EXPIRY_S * 1000),
    }
    row.update(overrides)
    client.table(store.WINDOW_TABLE).upsert(
        row, on_conflict="api_key_id,window_start_ms,chunk_index"
    ).execute()


def _warnings(caplog: pytest.LogCaptureFixture) -> list[str]:
    return [r.getMessage() for r in caplog.records if r.levelno >= logging.WARNING and r.name == _LOGGER]


# ---------------------------------------------------------------------------
# One claim's bookkeeping
# ---------------------------------------------------------------------------


async def test_a_first_claim_creates_the_state_with_its_origin(clock: _Clock) -> None:
    from services import trade_read_store as store

    client = JsonFakeClient()
    state = await _claim(client)

    assert state.stored == {}
    assert (state.grid_origin_ms, state.claims, state.stalled_claims) == (ORIGIN_MS, 1, 1)
    row = _state_row(client)
    assert row is not None
    assert row["venue"] == "bybit"
    assert row["grid_origin_ms"] == ORIGIN_MS
    assert row["read_version"] == store.TRADE_READ_VERSION
    assert (row["claims"], row["stalled_claims"]) == (1, 1)
    assert row["last_job_id"] == JOB
    assert row["expires_at"] == store._iso(clock.now_ms + store.STORE_EXPIRY_S * 1000)
    assert set(row) == set(store.STATE_COLUMNS)


@pytest.mark.parametrize("stale", ["another_version", "expired", "earlier_start"])
async def test_stale_state_is_discarded(clock: _Clock, stale: str) -> None:
    """A state row of another read version, past its expiry, or older than a wider window starts
    over: both tables lose the key's rows. A neighbour key is never touched."""
    from services import trade_read_store as store

    client = JsonFakeClient()
    await _claim(client)
    await _store_week(client, 0)
    await _store_week(client, 0, key=OTHER_KEY)
    await _claim(client, OTHER_KEY)
    assert len(_window_rows(client)) == 1

    since = ORIGIN_MS
    row_key = next(k for k, r in client.store.items()
                   if k[0] == store.STATE_TABLE and r["api_key_id"] == KEY)
    if stale == "another_version":
        client.store[row_key]["read_version"] = store.TRADE_READ_VERSION + 1
    elif stale == "expired":
        client.store[row_key]["expires_at"] = store._iso(clock.now_ms - 1)
    else:
        since = ORIGIN_MS - DAY_MS

    state = await _claim(client, since_ms=since)

    assert state.stored == {}, "the stored window must not survive a stale state"
    assert _window_rows(client) == []
    assert (state.grid_origin_ms, state.claims, state.stalled_claims) == (since, 1, 1)
    fresh = _state_row(client)
    assert fresh is not None
    assert fresh["read_version"] == store.TRADE_READ_VERSION
    assert fresh["grid_origin_ms"] == since
    assert len(_window_rows(client, OTHER_KEY)) == 1, "a neighbour key keeps its window"
    neighbour = _state_row(client, OTHER_KEY)
    assert neighbour is not None and neighbour["claims"] == 1


async def test_a_later_start_keeps_the_state_and_its_windows(clock: _Clock) -> None:
    client = JsonFakeClient()
    await _claim(client)
    start = await _store_week(client, 0)

    state = await _claim(client, since_ms=ORIGIN_MS + DAY_MS)

    assert list(state.stored) == [start]
    assert state.grid_origin_ms == ORIGIN_MS, "only the first claim's start is the grid origin"
    assert state.claims == 2
    row = _state_row(client)
    assert row is not None and row["grid_origin_ms"] == ORIGIN_MS
    assert len(_window_rows(client)) == 1


async def test_a_half_written_window_is_not_used(
    clock: _Clock, caplog: pytest.LogCaptureFixture
) -> None:
    """Chunks missing, two chunk counts, another read version, an expired chunk, a chunk whose
    count differs from its array, a malformed trade: none of them is used."""
    from services import trade_read_store as store

    client = JsonFakeClient()
    starts = {name: ORIGIN_MS + i * WEEK_MS for i, name in enumerate(
        ["missing_chunk", "two_counts", "other_version", "expired_chunk", "count_mismatch",
         "malformed_trade", "whole"]
    )}
    past = store._iso(clock.now_ms - 1000)
    _put_chunk(client, starts["missing_chunk"], 0, 3)
    _put_chunk(client, starts["missing_chunk"], 2, 3)
    _put_chunk(client, starts["two_counts"], 0, 2)
    _put_chunk(client, starts["two_counts"], 1, 3)
    _put_chunk(client, starts["other_version"], 0, 1, read_version=store.TRADE_READ_VERSION + 1)
    _put_chunk(client, starts["expired_chunk"], 0, 2)
    _put_chunk(client, starts["expired_chunk"], 1, 2, expires_at=past)
    _put_chunk(client, starts["count_mismatch"], 0, 1, n_trades=2)
    _put_chunk(client, starts["malformed_trade"], 0, 1, trades=[["not-an-int", "BTC/USDT", "buy", 1.0, 2.0, 2.0, 0.0]])
    _put_chunk(client, starts["whole"], 0, 1)

    state = await _claim(client)

    # The four defects metadata can see never enter `stored`. The two it cannot see (a count that
    # differs from the array, a malformed trade; the database refuses both rows) pass the
    # metadata filter and are caught when the trades are loaded: nothing partial is ever used.
    for name in ("missing_chunk", "two_counts", "other_version", "expired_chunk"):
        assert starts[name] not in state.stored, name
    usable = [
        start for start, meta in sorted(state.stored.items())
        if await store.load_window(client, KEY, meta) is not None
    ]
    assert usable == [starts["whole"]]
    whole = await store.load_window(client, KEY, state.stored[starts["whole"]])
    assert whole is not None and len(whole) == 1

    # Forged metadata for every defective window: nothing is returned, one WARNING each.
    forged = {
        "missing_chunk": store.WindowMeta(starts["missing_chunk"], starts["missing_chunk"] + WEEK_MS, 3, 2),
        "two_counts": store.WindowMeta(starts["two_counts"], starts["two_counts"] + WEEK_MS, 2, 2),
        "other_version": store.WindowMeta(starts["other_version"], starts["other_version"] + WEEK_MS, 1, 1),
        "expired_chunk": store.WindowMeta(starts["expired_chunk"], starts["expired_chunk"] + WEEK_MS, 2, 2),
        "count_mismatch": store.WindowMeta(starts["count_mismatch"], starts["count_mismatch"] + WEEK_MS, 1, 2),
        "malformed_trade": store.WindowMeta(starts["malformed_trade"], starts["malformed_trade"] + WEEK_MS, 1, 1),
    }
    for name, meta in forged.items():
        caplog.clear()
        with caplog.at_level(logging.WARNING, logger=_LOGGER):
            assert await store.load_window(client, KEY, meta) is None, name
        assert len(_warnings(caplog)) == 1, name


async def test_duplicate_writers_of_one_window_leave_one_identical_set(clock: _Clock) -> None:
    from services import trade_read_store as store

    client = JsonFakeClient()
    trades = [_a_trade(ORIGIN_MS + i + 1) for i in range(12_001)]
    window_end = ORIGIN_MS + WEEK_MS

    assert await store.save_window(client, KEY, ORIGIN_MS, window_end, trades) is True
    first = json.dumps(_window_rows(client), sort_keys=True)
    assert await store.save_window(client, KEY, ORIGIN_MS, window_end, trades) is True
    second = json.dumps(_window_rows(client), sort_keys=True)
    assert first == second, "a second write of the same window leaves the same rows"
    assert [c["chunk_index"] for c in _window_rows(client)] == [0, 1, 2]

    # A re-read that holds fewer trades leaves no chunk of the first beyond its own count.
    assert await store.save_window(client, KEY, ORIGIN_MS, window_end, trades[:5_001]) is True
    after = _window_rows(client)
    assert [c["chunk_index"] for c in after] == [0, 1]
    assert {c["chunk_count"] for c in after} == {2}
    assert [c["n_trades"] for c in after] == [5000, 1]


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf")])
async def test_a_non_finite_value_is_not_stored(
    clock: _Clock, caplog: pytest.LogCaptureFixture, bad: float
) -> None:
    from services import trade_read_store as store

    client = JsonFakeClient()
    start = await _store_week(client, 0)
    before = json.dumps(_window_rows(client), sort_keys=True)
    trades = [_a_trade(start + 1), _a_trade(start + 2)]
    trades[1]["price"] = bad

    with caplog.at_level(logging.WARNING, logger=_LOGGER):
        saved = await store.save_window(client, KEY, start, start + WEEK_MS, trades)

    assert saved is False
    assert json.dumps(_window_rows(client), sort_keys=True) == before, (
        "nothing is written, and the window stored earlier is not deleted either"
    )
    messages = _warnings(caplog)
    assert len(messages) == 1
    assert "unstorable_value" in messages[0]
    assert "nan" not in messages[0].lower() and "inf" not in messages[0].lower()


async def test_three_stalled_claims_of_one_job_stop_by_name(clock: _Clock) -> None:
    from services import trade_read_store as store

    client = JsonFakeClient()
    start = await _store_week(client, 0)
    for expected in (1, 2, 3):
        state = await _claim(client)
        assert (state.claims, state.stalled_claims) == (expected, expected)
    before = _state_row(client)

    with pytest.raises(store.TradeReadStalled) as stopped:
        await store.begin_claim(client, KEY, venue="bybit", since_ms=ORIGIN_MS, job_id=JOB)
    assert stopped.value.cause == "stalled_claims"
    assert stopped.value.claims == 3
    assert _state_row(client) == before, "the stop writes nothing"
    assert [c["window_start_ms"] for c in _window_rows(client)] == [start], "windows are kept"

    # Progress resets the count, so the same job is not stopped.
    other = OTHER_KEY
    for _ in range(3):
        await _claim(client, other)
    await store.record_progress(client, other)
    row = _state_row(client, other)
    assert row is not None and row["stalled_claims"] == 0 and row["claims"] == 3
    state = await _claim(client, other)
    assert (state.claims, state.stalled_claims) == (4, 1)


async def test_a_new_job_starts_with_a_fresh_count_and_the_stored_windows(clock: _Clock) -> None:
    from services import trade_read_store as store

    client = JsonFakeClient()
    start = await _store_week(client, 0)
    for _ in range(3):
        await _claim(client)
    with pytest.raises(store.TradeReadStalled):
        await store.begin_claim(client, KEY, venue="bybit", since_ms=ORIGIN_MS, job_id=JOB)

    state = await _claim(client, job_id=OTHER_JOB)

    assert list(state.stored) == [start]
    assert state.stalled_claims == 1
    row = _state_row(client)
    assert row is not None and row["last_job_id"] == OTHER_JOB and row["stalled_claims"] == 1


def _scope_created(created_at: Any) -> Any:
    from services import trade_read_store as store

    return store.TradeReadScope(
        supabase=None, api_key_id=KEY, deadline=0.0, job_id=JOB, job_created_at=created_at
    )


def test_the_job_age_backstop(clock: _Clock) -> None:
    """24 h from the job's own created_at; a created_at that cannot be read counts as too old,
    because a bound that cannot be evaluated must not become no bound at all."""
    from services import trade_read_store as store

    now = datetime.fromtimestamp(clock.now_ms / 1000, tz=timezone.utc)
    too_old = [
        (now - timedelta(hours=24)).isoformat(),
        (now - timedelta(days=3)).isoformat(),
        (now - timedelta(hours=25)).replace(tzinfo=None).isoformat(),
        now - timedelta(hours=30),
        None, "", "   ", "not a timestamp", 12345,
    ]
    for created in too_old:
        assert store.job_too_old(_scope_created(created)) is True, repr(created)
    young = [
        (now - timedelta(hours=1)).isoformat(),
        (now - timedelta(hours=23, minutes=59)).isoformat(),
        (now + timedelta(minutes=5)).isoformat(),
        now - timedelta(hours=1),
    ]
    for created in young:
        assert store.job_too_old(_scope_created(created)) is False, repr(created)


async def test_metadata_is_paged_past_a_row_cap(
    clock: _Clock, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A server row cap below the page size makes every page short; stopping on a short page
    would report two windows of seven as the whole store."""
    client = JsonFakeClient()
    starts = [await _store_week(client, week, n=1) for week in range(7)]
    monkeypatch.setattr(_FakeTable, "max_rows", 2)
    try:
        state = await _claim(client)
    finally:
        monkeypatch.setattr(_FakeTable, "max_rows", None)

    assert sorted(state.stored) == starts


def _seed_two_keys(client: FakeSupabaseClient, clock: _Clock) -> None:
    from services import trade_read_store as store

    past = store._iso(clock.now_ms - 1000)
    future = store._iso(clock.now_ms + 1000)
    for key, expires in ((KEY, past), (OTHER_KEY, future)):
        client.table(store.STATE_TABLE).upsert({
            "api_key_id": key, "venue": "bybit", "grid_origin_ms": ORIGIN_MS,
            "read_version": store.TRADE_READ_VERSION, "claims": 1, "stalled_claims": 0,
            "last_job_id": None, "updated_at": future, "expires_at": expires,
        }, on_conflict="api_key_id").execute()
        _put_chunk(client, ORIGIN_MS, 0, 1, key=key, expires_at=expires)
        _put_chunk(client, ORIGIN_MS + WEEK_MS, 0, 1, key=key, expires_at=future)


def _remaining(client: FakeSupabaseClient) -> dict[str, list[tuple[str, int]]]:
    from services import trade_read_store as store

    out: dict[str, list[tuple[str, int]]] = {store.STATE_TABLE: [], store.WINDOW_TABLE: []}
    for (tbl, _pk), r in client.store.items():
        out[tbl].append((r["api_key_id"], r.get("window_start_ms", -1)))
    return {tbl: sorted(v) for tbl, v in out.items()}


async def test_purges_are_best_effort_and_scoped(
    clock: _Clock, caplog: pytest.LogCaptureFixture
) -> None:
    from services import trade_read_store as store

    client = JsonFakeClient()
    _seed_two_keys(client, clock)
    await store.purge_keys(client, [KEY])
    assert _remaining(client) == {
        store.STATE_TABLE: [(OTHER_KEY, -1)],
        store.WINDOW_TABLE: [(OTHER_KEY, ORIGIN_MS), (OTHER_KEY, ORIGIN_MS + WEEK_MS)],
    }

    client = JsonFakeClient()
    _seed_two_keys(client, clock)
    await store.purge_expired(client)
    assert _remaining(client) == {
        store.STATE_TABLE: [(OTHER_KEY, -1)],
        store.WINDOW_TABLE: sorted([
            (KEY, ORIGIN_MS + WEEK_MS), (OTHER_KEY, ORIGIN_MS + WEEK_MS),
            (OTHER_KEY, ORIGIN_MS),
        ]),
    }, "only expired rows go, of every key"

    class _DeleteRaises(JsonFakeClient):
        def table(self, name: str) -> _FakeTable:
            table = super().table(name)

            def _boom(*_a: Any, **_k: Any) -> Any:
                raise RuntimeError(_SIGNATURE)

            table.delete = _boom  # type: ignore[method-assign]
            return table

    broken = _DeleteRaises()
    for call in (lambda: store.purge_keys(broken, [KEY]), lambda: store.purge_expired(broken)):
        caplog.clear()
        with caplog.at_level(logging.WARNING, logger=_LOGGER):
            assert await call() is None
        messages = _warnings(caplog)
        assert len(messages) == 1 and "RuntimeError" in messages[0]
        assert _SIGNATURE not in messages[0]


class _BrokenClient:
    """Every table call raises, as the gateway does for a table that does not exist yet."""

    def __init__(self, exc: BaseException) -> None:
        self._exc = exc

    def table(self, _name: str) -> Any:
        raise self._exc


async def test_a_store_fault_is_a_disposition_not_a_crash(
    clock: _Clock, caplog: pytest.LogCaptureFixture
) -> None:
    from services import trade_read_store as store

    fault = APIError({"message": f"relation {_SIGNATURE} does not exist", "code": "42P01",
                      "hint": None, "details": None})
    broken = _BrokenClient(fault)
    meta = store.WindowMeta(ORIGIN_MS, ORIGIN_MS + WEEK_MS, 1, 1)
    calls: dict[str, Any] = {
        "begin_claim": lambda: store.begin_claim(broken, KEY, venue="bybit", since_ms=ORIGIN_MS, job_id=JOB),
        "load_window": lambda: store.load_window(broken, KEY, meta),
        "save_window": lambda: store.save_window(broken, KEY, ORIGIN_MS, ORIGIN_MS + WEEK_MS, [_a_trade(ORIGIN_MS + 1)]),
        "record_progress": lambda: store.record_progress(broken, KEY),
    }
    expected = {"begin_claim": None, "load_window": None, "save_window": False, "record_progress": None}
    for name, call in calls.items():
        caplog.clear()
        with caplog.at_level(logging.WARNING, logger=_LOGGER):
            assert await call() is expected[name], name
        messages = _warnings(caplog)
        assert len(messages) == 1, (name, messages)
        assert "APIError" in messages[0] and KEY in messages[0], name
        assert _SIGNATURE not in messages[0], name

    # A cancellation is not a fault: it must reach the caller.
    cancelling = _BrokenClient(asyncio.CancelledError())
    with pytest.raises(asyncio.CancelledError):
        await store.begin_claim(cancelling, KEY, venue="bybit", since_ms=ORIGIN_MS, job_id=JOB)
