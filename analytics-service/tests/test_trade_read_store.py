"""Phase 171 READCEILING, plan 04: the store a resumable Bybit read keeps its progress in (D-02).

Every test runs ``services.trade_read_store`` over the repo's in-memory Supabase fake. The
fake used here additionally round-trips every written payload through JSON with
``allow_nan=False``, because the real store is a jsonb column: a float that does not survive
the wire, or a NaN, must show up in these tests and not in production.

The module is imported inside each test (``from services import trade_read_store as store``)
so a missing module fails the test itself, not collection.
"""
from __future__ import annotations

import json
from datetime import date, datetime, timezone
from typing import Any

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
