"""Phase 177 DERIBITFLOWS plan 03 - the moved-flow price store, offline (SC-3, D-05).

What these pin, and why each can fail
-------------------------------------
``services.flow_price_store`` keeps each resolved at-instant price of a moved Deribit flow once
per ``(api_key_id, instrument, minute_ms)`` in ``public.api_key_flow_prices`` and hands the
STORED row back to the caller (the ``write_nav_mark`` rule: first writer wins, the stored row,
never the local read, is the authority). The tests below pin the chunk rule against PostgREST's
``max_rows`` clamp, the strict parse of every stored row, the write-once form of the write, and
that a fault never leaks a key, minute, instrument or price into an error text.

The in-memory ``FlowPricesTable`` below is a hand-written MIRROR of plan 02's table
(``supabase/migrations/20261101120000_api_key_flow_prices.sql``): the primary key
``(api_key_id, instrument, minute_ms)``, the four CHECKs (instrument pattern, minute grid, price
finite and positive, the closed source) and ``ON CONFLICT DO NOTHING`` when ``ignore_duplicates``
is set. The SQL gate (``supabase/tests/test_api_key_flow_prices.sql``) and the live probe
(``test_flow_price_store_live.py``) are the AUTHORITY on the table; a fake can drift from it. The
fake deliberately does NOT model the grants (service_role holds no UPDATE): a writer that turned
into an updating upsert must fail THESE assertions (the mirror replaces the row when
``ignore_duplicates`` is not set, so the change is visible), not be caught by a permission error
the fake invented. The fake has no ``update`` and no ``delete`` at all.

The expected numbers are typed by hand beside the arithmetic they come from; none is read back
from the code under test.
"""
from __future__ import annotations

import math
import re
from collections.abc import Callable
from typing import Any
from unittest.mock import MagicMock

import pytest

FLOW_PRICES = "api_key_flow_prices"
_SOURCE = "deribit_perp_1m_open"
_INSTRUMENT_RE = re.compile(r"^[A-Z0-9]{2,10}_USDC-PERPETUAL$")
_MINUTE = 60_000


# --------------------------------------------------------------------------------------
# The mirror of api_key_flow_prices
# --------------------------------------------------------------------------------------


class _Exec:
    def __init__(self, fn: Any) -> None:
        self._fn = fn

    def execute(self) -> Any:
        return MagicMock(data=self._fn())


class _FlowPricesQuery:
    """The PostgREST query surface the store uses: ``upsert`` and ``select/eq/in_``."""

    def __init__(self, table: "FlowPricesTable") -> None:
        self._t = table
        self._cols: list[str] = []
        self._eq: dict[str, Any] = {}
        self._in: tuple[str, list[Any]] | None = None

    def upsert(
        self, rows: list[dict[str, Any]], on_conflict: str | None = None,
        ignore_duplicates: bool = False,
    ) -> _Exec:
        self._t.upsert_calls += 1
        self._t.upserts.append((list(rows), on_conflict, ignore_duplicates))
        return _Exec(lambda: self._t.insert(rows, ignore_duplicates))

    def select(self, cols: str) -> "_FlowPricesQuery":
        self._cols = [c.strip() for c in cols.split(",")]
        return self

    def eq(self, col: str, val: Any) -> "_FlowPricesQuery":
        self._eq[col] = val
        return self

    def in_(self, col: str, values: list[Any]) -> "_FlowPricesQuery":
        self._in = (col, list(values))
        return self

    def execute(self) -> Any:
        t = self._t
        t.reads += 1
        assert self._in is not None, "the store never reads without an in_ list"
        col, values = self._in
        t.read_requests.append(
            (self._eq.get("api_key_id"), self._eq.get("instrument"), list(values))
        )
        if t.fail_reads is not None:
            raise t.fail_reads
        hook = t.after_first_read
        if hook is not None:
            t.after_first_read = None
            # A concurrent derive writes between this read and the caller's own write. The rows
            # this read returns are the ones from BEFORE the hook, as a real database would.
            pre = self._rows_now(col, values)
            hook()
            return MagicMock(data=pre)
        if t.read_override is not None:
            return MagicMock(data=[dict(r) for r in t.read_override])
        return MagicMock(data=self._rows_now(col, values))

    def _rows_now(self, col: str, values: list[Any]) -> list[dict[str, Any]]:
        rows = [
            r for r in self._t.rows.values()
            if all(r[c] == v for c, v in self._eq.items()) and r[col] in values
        ]
        rows.sort(key=lambda r: r["minute_ms"])
        return [{c: r[c] for c in self._cols} for r in rows]


class FlowPricesTable:
    """One shared store per test: rows keyed ``(api_key_id, instrument, minute_ms)``, every read
    request and every upsert recorded, and injectable faults.

    ``reads`` / ``upsert_calls`` count executions. ``read_requests`` holds ``(api_key_id,
    instrument, minute list)`` per read, ``upserts`` holds ``(rows, on_conflict,
    ignore_duplicates)`` per write. ``read_override`` makes every read return exactly those rows
    (to feed the strict parse a malformed row); ``fail_reads`` / ``fail_inserts`` raise from
    ``execute``."""

    def __init__(self) -> None:
        self.rows: dict[tuple[str, str, int], dict[str, Any]] = {}
        self.reads = 0
        self.upsert_calls = 0
        self.read_requests: list[tuple[Any, Any, list[Any]]] = []
        self.upserts: list[tuple[list[dict[str, Any]], str | None, bool]] = []
        self.fail_reads: Exception | None = None
        self.fail_inserts: Exception | None = None
        self.read_override: list[dict[str, Any]] | None = None
        #: Called once, right after the next read answers: a concurrent writer's insert.
        self.after_first_read: Callable[[], None] | None = None

    def seed(self, api_key_id: str, instrument: str, minute_ms: int, price: float) -> None:
        """Put a stored row straight in, as an earlier derive would have left it."""
        self.insert(
            [{"api_key_id": api_key_id, "instrument": instrument, "minute_ms": minute_ms,
              "price": price, "source": _SOURCE}],
            True,
        )

    def insert(self, rows: list[dict[str, Any]], ignore_duplicates: bool) -> list[dict[str, Any]]:
        if self.fail_inserts is not None:
            raise self.fail_inserts
        written: list[dict[str, Any]] = []
        for row in rows:
            assert _INSTRUMENT_RE.match(row["instrument"]), "instrument CHECK"
            assert row["minute_ms"] > 0 and row["minute_ms"] % _MINUTE == 0, "minute CHECK"
            assert math.isfinite(row["price"]) and row["price"] > 0, "price CHECK"
            assert row["source"] == _SOURCE, "source CHECK"
            key = (row["api_key_id"], row["instrument"], row["minute_ms"])
            if key in self.rows:
                if ignore_duplicates:
                    continue  # ON CONFLICT DO NOTHING
                self.rows[key] = dict(row)  # an updating upsert: what write-once forbids
                written.append(row)
                continue
            self.rows[key] = dict(row)
            written.append(row)
        return written

    def prices(self, api_key_id: str) -> dict[tuple[str, int], float]:
        return {
            (i, m): r["price"] for (k, i, m), r in sorted(self.rows.items()) if k == api_key_id
        }


def route_flow_prices(ctx: MagicMock, table: FlowPricesTable) -> MagicMock:
    """Route ``ctx.supabase.table("api_key_flow_prices")`` to the mirror and chain every other
    table name to the previous side effect, so a derive harness from another suite becomes a
    flow-price harness with this one call."""
    inner = ctx.supabase.table.side_effect

    def _routed(name: str) -> Any:
        return _FlowPricesQuery(table) if name == FLOW_PRICES else inner(name)

    ctx.supabase.table.side_effect = _routed
    return ctx


def client_for(table: FlowPricesTable) -> MagicMock:
    """A bare supabase stand-in whose only table is the mirror (for the store's unit tests)."""
    client = MagicMock()
    client.table.side_effect = lambda name: (
        _FlowPricesQuery(table) if name == FLOW_PRICES else pytest.fail(f"unexpected table {name}")
    )
    return client


# --------------------------------------------------------------------------------------
# The store, against the mirror
# --------------------------------------------------------------------------------------

KEY = "key-secret-123"
BTC = "BTC_USDC-PERPETUAL"
ETH = "ETH_USDC-PERPETUAL"
M0 = 1_773_187_500_000  # 2026-03-11T00:05:00Z, a multiple of 60_000


def _store() -> Any:
    import services.flow_price_store as store

    return store


def _row(minute: int = M0, *, instrument: str = BTC, price: Any = 101_000.0,
         source: str = _SOURCE) -> dict[str, Any]:
    return {"instrument": instrument, "minute_ms": minute, "price": price, "source": source}


def test_flow_price_store_mirror_enforces_the_table_checks_and_do_nothing() -> None:
    """The mirror is not vacuous: each CHECK of plan 02's table refuses its violation, and a
    duplicate key keeps the first row only when duplicates are ignored (so an updating writer is
    visible to every test below)."""
    t = FlowPricesTable()
    good = {"api_key_id": KEY, "instrument": BTC, "minute_ms": M0, "price": 1.0, "source": _SOURCE}
    for bad in (
        {**good, "instrument": "btc_usdc-perpetual"},
        {**good, "instrument": "BTC_USDT-PERPETUAL"},
        {**good, "minute_ms": M0 + 1},
        {**good, "minute_ms": 0},
        {**good, "price": float("nan")},
        {**good, "price": 0.0},
        {**good, "source": "other"},
    ):
        with pytest.raises(AssertionError):
            t.insert([bad], True)
    t.insert([good], True)
    t.insert([{**good, "price": 2.0}], True)
    assert t.rows[(KEY, BTC, M0)]["price"] == 1.0
    t.insert([{**good, "price": 2.0}], False)
    assert t.rows[(KEY, BTC, M0)]["price"] == 2.0


def test_flow_price_store_chunks_reads_and_writes_at_100_minutes_per_request() -> None:
    """250 minutes of one instrument are read in three requests of 100, 100 and 50 and written in
    three upserts (100 rows a request is far below PostgREST's 1000-row clamp, so a read can never
    be silently truncated). Two instruments are read per instrument. The 250 prices are typed as
    base + minute index so the round trip is checked value by value."""
    store = _store()
    t = FlowPricesTable()
    client = client_for(t)
    prices = {(BTC, M0 + i * _MINUTE): 100_000.0 + i for i in range(250)}
    assert store.write_flow_prices(client, KEY, prices) == prices
    assert [len(rows) for rows, _, _ in t.upserts] == [100, 100, 50]
    assert t.reads == 3
    assert [len(m) for _, _, m in t.read_requests] == [100, 100, 50]
    assert all(m == sorted(m) for _, _, m in t.read_requests)

    t.reads = 0
    t.read_requests.clear()
    t.insert([{"api_key_id": KEY, "instrument": ETH, "minute_ms": M0, "price": 2_000.0,
               "source": _SOURCE}], True)
    got = store.read_flow_prices(client, KEY, [(BTC, M0), (ETH, M0), (BTC, M0 + _MINUTE)])
    assert got == {(BTC, M0): 100_000.0, (BTC, M0 + _MINUTE): 100_001.0, (ETH, M0): 2_000.0}
    assert t.reads == 2
    assert sorted(i for _, i, _ in t.read_requests) == [BTC, ETH]


def test_flow_price_store_write_once_returns_the_stored_price_not_the_local_read() -> None:
    """The stored row is the authority (Pitfall 1). A minute already stored at 101_000.0 is written
    again with 99_999.0 beside a new minute at 5.0: the call returns 101_000.0 for the first and
    5.0 for the second, the table still holds 101_000.0, and every upsert was the
    ON CONFLICT DO NOTHING form on the three-column key."""
    store = _store()
    t = FlowPricesTable()
    t.seed(KEY, BTC, M0, 101_000.0)
    out = store.write_flow_prices(
        client_for(t), KEY, {(BTC, M0): 99_999.0, (BTC, M0 + _MINUTE): 5.0}
    )
    assert out == {(BTC, M0): 101_000.0, (BTC, M0 + _MINUTE): 5.0}
    assert t.prices(KEY) == {(BTC, M0): 101_000.0, (BTC, M0 + _MINUTE): 5.0}
    assert t.upserts and all(
        conflict == "api_key_id,instrument,minute_ms" and ignore is True
        for _, conflict, ignore in t.upserts
    )
    assert {r["source"] for rows, _, _ in t.upserts for r in rows} == {_SOURCE}


def test_flow_price_store_a_valid_stored_row_parses() -> None:
    """The control for the parametrized refusals below: the same row with a numeric string price
    (a NUMERIC column may be served as text) parses to a float."""
    t = FlowPricesTable()
    t.read_override = [_row(price="101000.5")]
    assert _store().read_flow_prices(client_for(t), KEY, [(BTC, M0)]) == {(BTC, M0): 101_000.5}


@pytest.mark.parametrize(
    "bad",
    [
        _row(price="NaN"),
        _row(price=float("inf")),
        _row(price=0),
        _row(price=-1),
        _row(price=None),
        _row(price="abc"),
        _row(M0 + _MINUTE),
        _row(minute="abc"),  # type: ignore[arg-type]
        _row(instrument=ETH),
        _row(source="deribit_index"),
        {k: v for k, v in _row().items() if k != "price"},
        {k: v for k, v in _row().items() if k != "source"},
    ],
    ids=["nan", "inf", "zero", "negative", "none", "text", "other-minute", "bad-minute",
         "other-instrument", "other-source", "no-price", "no-source"],
)
def test_flow_price_store_a_malformed_stored_row_raises_and_is_never_skipped(bad: dict[str, Any]) -> None:
    """A stored row that cannot be trusted is a refusal, never a skipped row (a skipped row would be
    re-read from the venue and could disagree with what the database holds)."""
    t = FlowPricesTable()
    t.read_override = [bad]
    with pytest.raises(_store().FlowPriceStoreError):
        _store().read_flow_prices(client_for(t), KEY, [(BTC, M0)])


def test_flow_price_store_more_rows_than_asked_or_a_repeated_minute_raises() -> None:
    """A response larger than its chunk (a clamp or a corrupted filter) and a minute served twice
    are refused."""
    store = _store()
    t = FlowPricesTable()
    t.read_override = [_row(M0), _row(M0 + _MINUTE)]
    with pytest.raises(store.FlowPriceStoreError):
        store.read_flow_prices(client_for(t), KEY, [(BTC, M0)])
    t.read_override = [_row(M0), _row(M0)]
    with pytest.raises(store.FlowPriceStoreError):
        store.read_flow_prices(client_for(t), KEY, [(BTC, M0), (BTC, M0 + _MINUTE)])


def test_flow_price_store_a_missing_row_after_the_insert_raises() -> None:
    """The re-select can only lose to an existing row. If it returns nothing, the write refuses
    instead of handing the caller a price the database does not hold."""
    t = FlowPricesTable()
    t.read_override = []
    with pytest.raises(_store().FlowPriceStoreError):
        _store().write_flow_prices(client_for(t), KEY, {(BTC, M0): 101_000.0})


def test_flow_price_store_faults_raise_static_text_naming_nothing() -> None:
    """A read whose execute raises and an insert whose execute raises each become a
    FlowPriceStoreError chained from the cause. The cause carries the key, the minute, the
    instrument and the price (as a driver error would), the raised text carries none of them."""
    store = _store()
    cause = RuntimeError(f"boom {KEY} {M0} {BTC} 101000.0")
    t = FlowPricesTable()
    t.fail_reads = cause
    with pytest.raises(store.FlowPriceStoreError) as read_exc:
        store.read_flow_prices(client_for(t), KEY, [(BTC, M0)])
    assert read_exc.value.__cause__ is cause
    t = FlowPricesTable()
    t.fail_inserts = cause
    with pytest.raises(store.FlowPriceStoreError) as write_exc:
        store.write_flow_prices(client_for(t), KEY, {(BTC, M0): 101_000.0})
    assert write_exc.value.__cause__ is cause
    assert t.reads == 0, "no re-select after a failed insert"
    for exc in (read_exc.value, write_exc.value):
        text = str(exc)
        for secret in (KEY, str(M0), BTC, "101000", "101_000"):
            assert secret not in text


def test_flow_price_store_empty_input_makes_no_call() -> None:
    """Nothing to read and nothing to write is no request at all."""
    store = _store()
    t = FlowPricesTable()
    client = client_for(t)
    assert store.read_flow_prices(client, KEY, []) == {}
    assert store.write_flow_prices(client, KEY, {}) == {}
    assert t.reads == 0 and t.upsert_calls == 0
    client.table.assert_not_called()


@pytest.mark.asyncio
async def test_resolve_moved_flow_prices_stores_each_group_before_the_next_is_read() -> None:
    """SF-03. Two groups (BTC and ETH deposits made on 03-11, both moved by the 03-10 mark). The
    ETH read fails transiently after the BTC group was read. The BTC price is already STORED when
    the failure propagates, so the next derive reads it from the store and makes no chart call for
    BTC; before the fix every group was written once after the loop and the failure discarded the
    BTC price too. The prices are hand-typed (BTC 101_000.0, ETH 2_000.0)."""
    from datetime import datetime, timezone
    from unittest.mock import AsyncMock, patch

    import services.deribit_flow_prices as dfp
    from services.deribit_ingest import DeribitTransientReadError
    from services.external_flows import FlowInstant

    btc_ms = M0 + 20_000  # 00:05:20Z
    eth_ms = M0 + 3 * _MINUTE + 10_000  # 00:08:10Z
    flows = [
        FlowInstant(btc_ms, "2026-03-11", 0.0005, "BTC"),
        FlowInstant(eth_ms, "2026-03-11", 0.01, "ETH"),
    ]
    marks = [("2026-03-10", datetime(2026, 3, 11, 0, 10, 30, tzinfo=timezone.utc))]
    table = FlowPricesTable()
    client = client_for(table)
    asked: list[str] = []

    def fetch(eth_fails: bool) -> Any:
        async def _fetch(
            _ex: Any, currency: str, *, start_ms: int, end_ms: int, sleep: Any
        ) -> dict[int, float]:
            asked.append(currency)
            if currency == "ETH":
                if eth_fails:
                    raise DeribitTransientReadError("slow")
                return {M0 + 3 * _MINUTE: 2_000.0}
            return {M0: 101_000.0}

        return _fetch

    with patch.object(dfp, "db_execute", new=AsyncMock(side_effect=lambda fn: fn())):
        with patch.object(dfp, "fetch_deribit_perp_minute_prices", new=fetch(True)):
            with pytest.raises(DeribitTransientReadError):
                await dfp.resolve_moved_flow_prices(
                    MagicMock(), client, KEY, flows, marks, frozenset({"BTC", "ETH"})
                )
        assert table.prices(KEY) == {(BTC, M0): 101_000.0}
        asked.clear()
        with patch.object(dfp, "fetch_deribit_perp_minute_prices", new=fetch(False)):
            out = await dfp.resolve_moved_flow_prices(
                MagicMock(), client, KEY, flows, marks, frozenset({"BTC", "ETH"})
            )
    assert asked == ["ETH"], "BTC came from the store"
    assert out.index == {("BTC", btc_ms): 101_000.0, ("ETH", eth_ms): 2_000.0}
