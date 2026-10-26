"""Phase 167.2.1.1.1 NAVMTM plan 06 - the marks writer, offline (SC-1, D-02, D-06, D-09, D-11).

What these pin, and why each can fail
-------------------------------------
Every run of ``run_derive_broker_dailies_job`` stores ONE mark for its key and the UTC day
that just closed, from the equity read the derive already made, write-once, and the derive
keeps the row the database holds (Pitfall 1) and never its own read.

The in-memory ``api_key_nav_marks`` below is a hand-written MIRROR of plan 01's table
(``supabase/migrations/20261029120000_api_key_nav_marks.sql``): the unique key
``(api_key_id, mark_day)``, the label CHECK ``mark_day = date(marked_at at UTC) - 1``, the
closed venue set, and ``ON CONFLICT DO NOTHING`` when ``ignore_duplicates`` is set. The SQL gate
(``supabase/tests/test_api_key_nav_marks.sql``) and the lane probe
(``test_nav_marks_writer_live.py``) are the AUTHORITY on the table; a fake can drift from it.
The fake deliberately does NOT model the grants (service_role holds no UPDATE): a writer that
turned into an updating upsert must fail THESE assertions, not be caught by a permission error
the fake invented. The fake has no ``update`` and no ``delete`` at all.

Every oracle is a literal from the fake venue payload, never a value the code under test computed.
"""
from __future__ import annotations

from contextlib import ExitStack
from datetime import date, datetime, timedelta, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pandas as pd
import pytest

from services.job_worker import DispatchOutcome, run_derive_broker_dailies_job
from tests.test_derive_broker_dailies_dualmode import _build_ctx

MARKS = "api_key_nav_marks"
_VENUES = {"okx", "bybit", "binance", "deribit", "mt5", "sfox"}


@pytest.fixture(autouse=True)
def _real_marks_writer(monkeypatch: pytest.MonkeyPatch) -> None:
    """This module is ABOUT the writer: undo conftest's default stand-in (which runs first)."""
    import services.job_worker as job_worker
    import services.nav_marks as nav_marks

    monkeypatch.setattr(job_worker, "write_nav_mark", nav_marks.write_nav_mark)


def marks_not_applied() -> Any:
    """Plan 12 (167.2.1.1.1-12): from the first stored mark a KEY-mode derive persists the MARKED
    series and re-states its key_inputs terminal on the mark (``apply_marks``), as the strategy-mode
    derive has since plan 07. A suite that is ABOUT what the derive reads and writes of the mark
    itself (its fields, its refusals, its echo), over fixtures that carry no realized terminal or
    ledger to apply it to, reads no stored mark back, which is the derive as it ran before the
    series consumed marks. The apply has its own suites (``test_nav_marks_derive_apply.py``,
    ``test_nav_marks_compose_roundtrip.py``)."""
    return patch("services.job_worker.read_key_marks", new=MagicMock(return_value=[]))


def _nm() -> Any:
    """The module under test, imported inside each test so a missing module FAILS the test."""
    import services.nav_marks as nav_marks

    return nav_marks


# --------------------------------------------------------------------------------------
# The mirror of api_key_nav_marks
# --------------------------------------------------------------------------------------


class _Exec:
    def __init__(self, fn: Any) -> None:
        self._fn = fn

    def execute(self) -> Any:
        return MagicMock(data=self._fn())


class _MarksQuery:
    """The PostgREST query surface the writer uses: upsert, and select/eq/gt/order/limit."""

    def __init__(self, db: "FakeDb") -> None:
        self._db = db
        self._cols: list[str] | None = None
        self._eq: dict[str, Any] = {}
        self._gt: dict[str, Any] = {}
        self._order: str | None = None
        self._limit: int | None = None

    def upsert(self, row: dict[str, Any], on_conflict: str | None = None,
               ignore_duplicates: bool = False) -> _Exec:
        self._db.upserts.append((MARKS, row, on_conflict, ignore_duplicates))
        return _Exec(lambda: self._db.insert_mark(row, ignore_duplicates))

    def select(self, cols: str) -> "_MarksQuery":
        self._cols = [c.strip() for c in cols.split(",")]
        return self

    def eq(self, col: str, val: Any) -> "_MarksQuery":
        self._eq[col] = val
        return self

    def gt(self, col: str, val: Any) -> "_MarksQuery":
        self._gt[col] = val
        return self

    def order(self, col: str, desc: bool = False) -> "_MarksQuery":
        assert not desc, "the writer reads ascending"
        self._order = col
        return self

    def limit(self, n: int) -> "_MarksQuery":
        self._limit = n
        return self

    def execute(self) -> Any:
        self._db.select_executions += 1
        rows = [
            r for r in self._db.marks.values()
            if all(r[c] == v for c, v in self._eq.items())
            and all(r[c] > v for c, v in self._gt.items())
        ]
        if self._order:
            rows.sort(key=lambda r: r[self._order])
        if self._limit is not None:
            rows = rows[: self._limit]
        cols = self._cols or []
        return MagicMock(data=[{c: r[c] for c in cols} for r in rows])


class FakeDb:
    """Shared across derives in one test: one store, every table name touched, all upserts."""

    def __init__(self) -> None:
        self.marks: dict[tuple[str, str], dict[str, Any]] = {}
        self.touched: list[str] = []
        self.upserts: list[tuple[Any, ...]] = []
        self.select_executions = 0
        self.fail_inserts: Exception | None = None

    def insert_mark(self, row: dict[str, Any], ignore_duplicates: bool) -> list[dict[str, Any]]:
        if self.fail_inserts is not None:
            raise self.fail_inserts
        assert row["venue"] in _VENUES, "venue CHECK"
        marked = datetime.fromisoformat(row["marked_at"]).astimezone(timezone.utc)
        assert row["mark_day"] == (marked.date() - timedelta(days=1)).isoformat(), (
            "label CHECK: mark_day = date(marked_at at UTC) - 1"
        )
        key = (row["api_key_id"], row["mark_day"])
        if key in self.marks:
            if ignore_duplicates:
                return []  # ON CONFLICT DO NOTHING
            self.marks[key] = dict(row)  # an updating upsert: what write-once forbids
            return [row]
        self.marks[key] = dict(row)
        return [row]


def route_marks(ctx: MagicMock, db: FakeDb) -> MagicMock:
    """Route ``ctx.supabase.table("api_key_nav_marks")`` to the mirror ``db`` and record every
    table name any query touches. Every other table keeps whatever the harness gave it, so a
    derive harness from another suite becomes a marks harness with this one call."""
    inner = ctx.supabase.table.side_effect

    def _routed(name: str) -> Any:
        db.touched.append(name)
        return _MarksQuery(db) if name == MARKS else inner(name)

    ctx.supabase.table.side_effect = _routed
    return ctx


def _ctx(db: FakeDb, *, key_id: str, user_id: str, venue: str = "okx",
         strategy_id: str | None = None) -> tuple[MagicMock, dict[str, Any]]:
    ctx, capture = _build_ctx(
        key_row={"id": key_id, "exchange": venue, "user_id": user_id},
        strategy_row=None if strategy_id is None else {"id": strategy_id, "user_id": user_id},
    )
    return route_marks(ctx, db), capture


def _returns(days: int) -> pd.Series:
    idx = pd.DatetimeIndex(["2026-02-27", "2026-02-28", "2026-03-01"][:days])
    return pd.Series([0.01, -0.02, 0.005][:days], index=idx, dtype="float64")


async def _derive_okx(
    db: FakeDb, *, now: datetime, equity: float = 1050.0, upl: float = 50.0,
    upnl_unreadable: bool = False, balance_error: bool = False, venue: str = "okx",
    key_mode: bool = True, days: int = 2, key_id: str = "key-1", user_id: str = "alloc-1",
    job_extra: dict[str, Any] | None = None,
) -> tuple[Any, dict[str, Any]]:
    ctx, capture = _ctx(
        db, key_id=key_id, user_id=user_id, venue=venue,
        strategy_id=None if key_mode else "strat-1",
    )
    preflight = "services.job_worker._allocator_key_preflight" if key_mode else (
        "services.job_worker._exchange_preflight"
    )
    meta = {"used_heuristic_capital": False, "series_completeness": "fill_derived_unproven"}
    patches = [
        patch(preflight, new=AsyncMock(return_value=ctx)),
        patch("services.job_worker.fetch_all_trades", new=AsyncMock(return_value=[])),
        patch("services.job_worker.aclose_exchange", new=AsyncMock()),
        patch(
            "services.exchange.fetch_account_equity_and_upnl_usd",
            new=AsyncMock(return_value=(equity, balance_error, upl, upnl_unreadable)),
        ),
        patch("services.funding_fetch.fetch_funding_okx", new=AsyncMock(return_value=[])),
        patch("services.funding_fetch.fetch_funding_binance", new=AsyncMock(return_value=[])),
        patch("services.funding_fetch.fetch_funding_bybit", new=AsyncMock(return_value=[])),
        patch("services.ccxt_flow_fetch.fetch_ccxt_transfers", new=AsyncMock(return_value=[])),
        patch("services.job_worker._resolve_ccxt_flow_price_index", new=AsyncMock(return_value={})),
        patch(
            "services.broker_dailies.combine_realized_and_funding",
            new=MagicMock(return_value=(_returns(days), dict(meta))),
        ),
        patch("services.job_worker.db_execute", new=AsyncMock(side_effect=lambda fn: fn())),
        patch("services.job_worker._utc_now", new=MagicMock(return_value=now)),
    ]
    job: dict[str, Any] = {"id": "j", "kind": "derive_broker_dailies"}
    job.update({"api_key_id": "key-1"} if key_mode else {"strategy_id": "strat-1"})
    job.update(job_extra or {})
    with ExitStack() as stack:
        for p in patches:
            stack.enter_context(p)
        result = await run_derive_broker_dailies_job(job)
    return result, capture


def _key_inputs(capture: dict[str, Any]) -> dict[str, Any]:
    rows = [
        u[1] for u in capture["upserts"]
        if u[0] == "allocator_equity_derived" and str(u[1].get("kind", "")).startswith("key_inputs:")
    ]
    assert len(rows) == 1, f"expected one key_inputs upsert, got {capture['upserts']!r}"
    payload: dict[str, Any] = rows[0]["payload"]
    return payload


T_0010 = datetime(2026, 3, 2, 0, 10, 30, tzinfo=timezone.utc)


# --------------------------------------------------------------------------------------
# Task 1 - the tracer: OKX, both modes
# --------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_okx_key_mode_writes_one_mark_labelled_the_closed_day() -> None:
    db = FakeDb()
    result, capture = await _derive_okx(db, now=T_0010)
    assert result.outcome == DispatchOutcome.DONE
    assert list(db.marks) == [("key-1", "2026-03-01")]
    row = db.marks[("key-1", "2026-03-01")]
    assert row["marked_at"] == "2026-03-02T00:10:30+00:00"
    assert row["venue"] == "okx"
    assert row["nav_usd"] == 1050.0 and row["open_pnl_usd"] == 50.0
    assert row["native_unit"] == "USD" and row["nav_native"] == 1050.0
    assert row["open_pnl_native"] == 50.0 and row["price_day"] is None
    assert row["allocator_id"] == "alloc-1"
    # The write-once key and the do-nothing-on-conflict arbiter (D-06).
    assert db.upserts[0][2:] == ("api_key_id,mark_day", True)
    # The derive kept the row the database holds and echoed it for plan 07.
    echo = _key_inputs(capture)["nav_mark"]
    assert echo == {
        "mark_day": "2026-03-01", "nav_usd": 1050.0, "open_pnl_usd": 50.0,
        "marked_at": "2026-03-02T00:10:30+00:00",
    }
    assert "nav_mark_refusal" not in _key_inputs(capture)


@pytest.mark.asyncio
async def test_okx_strategy_mode_writes_the_same_mark() -> None:
    """api_key_id and allocator_id come from the key row, never from the job payload."""
    db = FakeDb()
    result, _capture = await _derive_okx(
        db, now=T_0010, key_mode=False, user_id="owner-from-key-row",
        job_extra={"allocator_id": "spoofed-by-payload"},
    )
    assert result.outcome == DispatchOutcome.DONE
    assert list(db.marks) == [("key-1", "2026-03-01")]
    row = db.marks[("key-1", "2026-03-01")]
    assert row["allocator_id"] == "owner-from-key-row"
    assert row["nav_usd"] == 1050.0 and row["open_pnl_usd"] == 50.0 and row["venue"] == "okx"


@pytest.mark.asyncio
async def test_idle_key_short_circuit_still_writes_its_mark() -> None:
    """SC-1: a key-mode derive with fewer than 2 return days still stores its mark and its
    key_inputs row (an idle key still gets its mark)."""
    db = FakeDb()
    with marks_not_applied():
        result, capture = await _derive_okx(db, now=T_0010, days=1)
    assert result.outcome == DispatchOutcome.DONE
    assert [u for u in capture["upserts"] if u[0] == "csv_daily_returns"] == []
    assert list(db.marks) == [("key-1", "2026-03-01")]
    assert _key_inputs(capture)["nav_mark"]["nav_usd"] == 1050.0


@pytest.mark.asyncio
async def test_second_writer_keeps_the_first_row_and_uses_it() -> None:
    """D-06 and Pitfall 1: two derives for one key the same UTC day, reads 1050.0 then 1060.0.
    One stored row holds 1050.0, and the SECOND derive uses that row, not its own read."""
    db = FakeDb()
    _r1, first = await _derive_okx(db, now=T_0010, equity=1050.0, upl=50.0)
    later = datetime(2026, 3, 2, 0, 50, 0, tzinfo=timezone.utc)
    _r2, second = await _derive_okx(db, now=later, equity=1060.0, upl=60.0)
    assert len(db.marks) == 1
    stored = db.marks[("key-1", "2026-03-01")]
    assert stored["nav_usd"] == 1050.0 and stored["open_pnl_usd"] == 50.0
    assert stored["marked_at"] == "2026-03-02T00:10:30+00:00"
    assert _key_inputs(first)["nav_mark"]["nav_usd"] == 1050.0
    assert _key_inputs(second)["nav_mark"]["nav_usd"] == 1050.0, (
        "the loser of the race must use the stored row, never its own read"
    )
    assert _key_inputs(second)["nav_mark"]["marked_at"] == "2026-03-02T00:10:30+00:00"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "when",
    [
        datetime(2026, 3, 2, 0, 0, 0, tzinfo=timezone.utc),
        datetime(2026, 3, 2, 5, 0, 0, tzinfo=timezone.utc),
        datetime(2026, 3, 2, 23, 59, 59, tzinfo=timezone.utc),
    ],
)
async def test_a_late_read_still_writes_the_closed_day(when: datetime) -> None:
    """D-11: there is no time-of-day window. A read at any time of the UTC day after the
    label still writes the mark, and marked_at records the real time."""
    db = FakeDb()
    await _derive_okx(db, now=when)
    assert list(db.marks) == [("key-1", "2026-03-01")]
    assert db.marks[("key-1", "2026-03-01")]["marked_at"] == when.isoformat()


@pytest.mark.asyncio
async def test_writer_reads_no_position_history() -> None:
    """D-09: the mark is built from the equity read alone. The spy records every table the
    derive touched; it is not vacuous (the marks table IS in it)."""
    db = FakeDb()
    await _derive_okx(db, now=T_0010)
    assert MARKS in db.touched
    assert not {"allocator_holdings", "position_snapshots"} & set(db.touched), db.touched


@pytest.mark.asyncio
async def test_an_unreadable_upnl_writes_no_mark_and_says_why() -> None:
    """Refuse, never invent: OKX totalEq read cleanly but upl did not. No row, the derive
    still finishes, and the token (never an amount) rides in key_inputs."""
    db = FakeDb()
    result, capture = await _derive_okx(db, now=T_0010, upl=0.0, upnl_unreadable=True)
    assert result.outcome == DispatchOutcome.DONE
    assert db.marks == {}
    payload = _key_inputs(capture)
    assert payload["nav_mark_refusal"] == "upnl_unreadable"
    assert "nav_mark" not in payload


# Bybit and Binance (L4, D-16) were plan 15's and wrote no mark under plan 06; plan 15 gave
# them theirs, pinned in tests/test_nav_marks_l4_read.py. The set that stays out of the
# uniform-read venues is still pinned below (test_priced_unit_is_the_derives_btc_unit_...).


@pytest.mark.asyncio
async def test_a_database_error_on_the_insert_bubbles() -> None:
    """A mark that cannot be stored is not a mark that can be skipped: the job retries."""
    db = FakeDb()
    db.fail_inserts = RuntimeError("insert refused")
    with pytest.raises(RuntimeError, match="insert refused"):
        await _derive_okx(db, now=T_0010)


# --------------------------------------------------------------------------------------
# The module itself
# --------------------------------------------------------------------------------------


def test_refusal_tokens_are_the_closed_set_of_seventeen() -> None:
    # Ten from plans 06 and 15, plus plan 18's five D-17 reasons for a Bybit account the
    # Unified Trading Account totals cannot describe, plus plan 19's two D-18 reasons: an OKX or
    # Binance account holding option value the NAV is not shown to carry, or whose option
    # positions could not be read.
    assert _nm().MARK_REFUSAL_TOKENS == frozenset({
        "balance_error", "upnl_unreadable", "nonfinite", "nonpositive", "dust",
        "native_unit", "native_unpriced", "positions_unreadable", "wallet_unpriced",
        "wallet_basis_mismatch",
        "account_mode_unsupported", "isolated_margin_unsupported", "borrow_present",
        "uta_totals_unreadable", "uta_wallet_mismatch",
        "option_value_unverified", "option_value_unreadable",
    })


def test_priced_unit_is_the_derives_btc_unit_and_bybit_binance_are_not_uniform() -> None:
    import services.job_worker as jw

    nm = _nm()
    assert nm.PRICED_NATIVE_UNIT == jw._BTC_PRICED_UNIT
    assert nm.UNIFORM_READ_VENUES == frozenset({"okx", "deribit", "mt5", "sfox"})


def test_mark_day_is_the_utc_date_before_the_read_whatever_the_zone() -> None:
    nm = _nm()
    assert nm.mark_day_for(datetime(2026, 3, 2, 0, 0, 0, tzinfo=timezone.utc)) == date(2026, 3, 1)
    assert nm.mark_day_for(datetime(2026, 3, 2, 23, 59, 59, tzinfo=timezone.utc)) == date(2026, 3, 1)
    # 2026-03-01T23:30 at UTC-05:00 is 2026-03-02T04:30Z: the label is read in UTC.
    est = timezone(timedelta(hours=-5))
    assert nm.mark_day_for(datetime(2026, 3, 1, 23, 30, tzinfo=est)) == date(2026, 3, 1)
    with pytest.raises(ValueError):
        nm.mark_day_for(datetime(2026, 3, 2, 0, 10))


def test_write_nav_mark_returns_the_first_row_both_times() -> None:
    nm = _nm()
    db = FakeDb()
    supabase = MagicMock()
    supabase.table.side_effect = lambda name: _MarksQuery(db)

    def _read(nav: float) -> Any:
        r = nm.build_mark_read(
            venue="okx", marked_at=T_0010, equity=nav, open_pnl=5.0,
            balance_error=False, upnl_unreadable=False,
        )
        assert not isinstance(r, str)
        return r

    one = nm.write_nav_mark(supabase, _read(2000.0), api_key_id="k", allocator_id="a")
    two = nm.write_nav_mark(supabase, _read(2500.0), api_key_id="k", allocator_id="a")
    assert one == two
    assert one.nav_usd == 2000.0 and one.mark_day == "2026-03-01"
    assert len(db.marks) == 1


def test_write_nav_mark_raises_when_the_row_is_absent_after_the_insert() -> None:
    """The row 'cannot be absent'; if it is, the writer says so instead of inventing one."""
    nm = _nm()

    class _Vanishing(_MarksQuery):
        def upsert(self, row: dict[str, Any], on_conflict: str | None = None,
                   ignore_duplicates: bool = False) -> _Exec:
            return _Exec(lambda: [])  # inserts nothing at all

    db = FakeDb()
    supabase = MagicMock()
    supabase.table.side_effect = lambda name: _Vanishing(db)
    read = nm.build_mark_read(
        venue="okx", marked_at=T_0010, equity=2000.0, open_pnl=5.0,
        balance_error=False, upnl_unreadable=False,
    )
    with pytest.raises(nm.NavMarkError):
        nm.write_nav_mark(supabase, read, api_key_id="k", allocator_id="a")


def test_read_key_marks_is_keyset_paginated_ascending_with_no_repeat_or_skip(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    nm = _nm()
    db = FakeDb()
    supabase = MagicMock()
    supabase.table.side_effect = lambda name: _MarksQuery(db)
    monkeypatch.setattr(nm, "_MARKS_PAGE_SIZE", 2)
    # Written out of order, for two keys: only this key's days come back, ascending.
    for day in (5, 1, 4, 2, 3):
        marked = datetime(2026, 3, day + 1, 0, 10, tzinfo=timezone.utc)
        read = nm.build_mark_read(
            venue="okx", marked_at=marked, equity=1000.0 + day, open_pnl=1.0,
            balance_error=False, upnl_unreadable=False,
        )
        nm.write_nav_mark(supabase, read, api_key_id="k", allocator_id="a")
    other = nm.build_mark_read(
        venue="okx", marked_at=T_0010, equity=9999.0, open_pnl=1.0,
        balance_error=False, upnl_unreadable=False,
    )
    nm.write_nav_mark(supabase, other, api_key_id="other", allocator_id="a")
    db.select_executions = 0
    marks = nm.read_key_marks(supabase, "k")
    assert [m.mark_day for m in marks] == [f"2026-03-0{d}" for d in (1, 2, 3, 4, 5)]
    assert [m.nav_usd for m in marks] == [1001.0, 1002.0, 1003.0, 1004.0, 1005.0]
    assert db.select_executions == 4  # pages of 2, 2, 1, then the empty page that ends it


def test_to_row_refuses_a_non_finite_amount() -> None:
    nm = _nm()
    read = nm.MarkRead(
        venue="okx", mark_day=date(2026, 3, 1), marked_at=T_0010, nav_usd=float("nan"),
        open_pnl_usd=1.0, nav_native=None, open_pnl_native=None, native_unit="USD",
        price_day=None, native_detail=None,
    )
    with pytest.raises(ValueError):
        read.to_row("k", "a")
