"""Phase 262 OKXREACHGUARD part 1 - a nightly OKX derive never overwrites a stored row older than the bills reach.

Founder ruling 2026-11-28, verbatim choice: "Urgent phase now (Recommended)". Part 1 ships first as
its own small PR: stop the nightly overwrite. Parts 2 (restore) and 3 (lost mark) are later plans.

The defect, D-01..D-03 by id
----------------------------
OKX funding reaches back further than the 93-day bills walk (``OKX_BILLS_REACH_DAYS`` in
``services/exchange.py``). ``combine_realized_and_funding`` holds a guard (``realized_reach_start``)
that drops funding dated before the realized fetch's reach, but no production caller passed it, so
every nightly derive opened the series at the oldest funding day and the authoritative reconcile
overwrote the realized rows earlier derives had stored between that day and the bills reach.

* D-01: the reach is the UTC day of ``now - OKX_BILLS_REACH_DAYS``, from ONE helper
  (``job_worker._okx_bills_reach_day``), read from the derive's own clock taken after the bills fetch.
* D-02: the non-switched derive passes it on OKX only; ``build_switched_series`` bounds its USD-side
  funding by ``bills_from_day`` (the same helper's value), so the whole USD run, the R2-02 early run
  and the ``usd_has_history`` verdict see one bounded funding.
* D-03: the proof drives the REAL derive with the REAL combiner (never a mock of it) over a stateful
  ``csv_daily_returns`` fake, so an overwritten row is observable as a changed value.

What each class pins, and why it can fail
-----------------------------------------
``TestNonSwitchedDeriveKeepsPreReachRows`` (T-262-01): a stored row dated between the oldest funding
day and the reach is byte-unchanged after a DONE derive, nothing before the reach is written, and the
in-reach funding-only day still is (the guard drops by the fetch's reach, never by the first realized
record). Fails if the non-switched call stops passing the reach, or passes a reach that is too late.
``TestOtherVenuesPassNoReach`` (SC-2, T-262-04): Bybit and Binance still open on their old funding.
Fails if the reach is passed to a venue whose realized read reaches 365 days or inception.
``TestSwitchedBuilderBoundsUsdFunding`` (T-262-02): the builder drops USD-side funding older than
``bills_from_day`` for both USD runs and for the history verdict, and keeps funding ON that day.
``TestSwitchedDeriveKeepsPreReachRows`` (T-262-02): the real switched derive issues no
``csv_daily_returns`` write naming a day before the reach (that harness holds no rows, so the claim is
about writes, which is what can change a stored row).

Oracle rule: dates and the reach are typed from today minus a LITERAL 93 (the value of
``OKX_BILLS_REACH_DAYS``), never read back from the helper under test. Every expected in-reach day
sits at least 5 days inside the reach and every reach comparison is ``>=``. A UTC midnight between
test start and the derive's own clock moves the derive's reach one day LATER (D-01), so no assertion
can flip.

PROOF-01 (each guard neutered ALONE from a byte backup, its own class goes RED, restored, GREEN)
-----------------------------------------------------------------------------------------------
| id | guard | neuter | class that goes RED |
|----|-------|--------|---------------------|
| N1 | the non-switched ``realized_reach_start=`` kwarg | delete the kwarg line | TestNonSwitchedDeriveKeepsPreReachRows |
| N2 | the builder's USD-side bound | delete the bound | TestSwitchedBuilderBoundsUsdFunding + TestSwitchedDeriveKeepsPreReachRows |
| N4 | the OKX-only condition | pass the reach on every venue | TestOtherVenuesPassNoReach |

(N3, the stitched member, is out of plan 01 by decision D-05: the composite stitch owns its series
wholesale, so the same kwarg there would delete rows instead of keeping them.)
"""
from __future__ import annotations

from collections.abc import Sequence
from contextlib import ExitStack
from datetime import date, datetime, timedelta, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pandas as pd
import pytest

from services.job_worker import DispatchOutcome, _okx_bills_reach_day, run_derive_broker_dailies_job
from tests.test_derive_broker_dailies_dualmode import _build_ctx
from tests.test_nav_marks_derive_apply import (
    KEY,
    STRATEGY,
    USER,
    StrategyDb,
    _CsvDelete,
    route_csv,
    seed_mark,
)
from tests.fixtures.okx_unit_switch_derive_harness import Calendar, founder_closes, run_switched_derive
from tests.test_nav_marks_writer import (  # noqa: F401  (autouse: re-binds the real writer)
    _real_marks_writer,
    route_marks,
)
from tests.test_unit_switch_series import (
    _R2_FIRST_COIN_BILL,
    _build,
    _by_day,
    _iso,
    _ok,
    _r2_build,
    _r2_marks,
)
from services.unit_switch import SplitPnl

# The value of ``OKX_BILLS_REACH_DAYS``. Typed here, never read back from the code under test.
REACH_DAYS = 93


def _day(today: date, back: int) -> str:
    return (today - timedelta(days=back)).isoformat()


def _funding(day: str, amount: float) -> dict[str, Any]:
    return {"amount": amount, "timestamp": datetime.fromisoformat(f"{day}T08:00:00+00:00")}


def _realized(venue: str, day: str, pnl: float) -> dict[str, Any]:
    """A daily-pnl realized record, the shape ``fetch_daily_pnl`` returns."""
    return {
        "exchange": venue,
        "symbol": "PORTFOLIO",
        "side": "buy" if pnl >= 0 else "sell",
        "price": abs(pnl),
        "quantity": 1,
        "fee": 0,
        "fee_currency": "USDT",
        "timestamp": f"{day}T00:00:00+00:00",
        "order_type": "daily_pnl",
    }


# --------------------------------------------------------------------------------------
# The non-switched derive harness: the REAL combiner over a stateful csv_daily_returns
# --------------------------------------------------------------------------------------


class _BoundsDb(StrategyDb):
    """``StrategyDb`` plus the ``gte``/``lte``/``in`` bound of every delete the derive issues."""

    def __init__(self) -> None:
        super().__init__()
        self.delete_bounds: list[dict[str, Any]] = []


class _RecordingCsvDelete(_CsvDelete):
    def execute(self) -> Any:
        db = self._db
        assert isinstance(db, _BoundsDb)
        db.delete_bounds.append({"gte": self._gte, "lte": self._lte, "in": self._in})
        return super().execute()


class _RecordingCsvQuery:
    """``route_csv``'s query class, with the recording delete."""

    def __init__(self, db: _BoundsDb) -> None:
        from tests.test_nav_marks_derive_apply import _CsvQuery

        self._inner = _CsvQuery(db)
        self._db = db

    def upsert(self, *args: Any, **kwargs: Any) -> Any:
        return self._inner.upsert(*args, **kwargs)

    def delete(self, **_kw: Any) -> _RecordingCsvDelete:
        return _RecordingCsvDelete(self._db)


async def _derive_with_real_combine(
    db: _BoundsDb,
    *,
    venue: str,
    realized: Sequence[dict[str, Any]],
    funding: Sequence[dict[str, Any]],
    now: datetime,
    equity: float = 100000.0,
    stored_marks: bool = False,
) -> Any:
    """A private copy of ``derive_ccxt_strategy``'s patch list with three changes: the REAL
    ``combine_realized_and_funding`` runs (D-03); the realized and funding fetches return the given
    records (the funding patch of ``venue`` only, the other two return nothing); no stored mark is
    read (unless ``stored_marks``, which lets the derive read the marks seeded in ``db``) and the
    derive's clock is ``now``."""
    ctx, _capture = _build_ctx(
        key_row={"id": KEY, "exchange": venue, "user_id": USER},
        strategy_row={"id": STRATEGY, "user_id": USER},
    )
    route_csv(route_marks(ctx, db), db)
    inner = ctx.supabase.table.side_effect

    def _routed(name: str) -> Any:
        return _RecordingCsvQuery(db) if name == "csv_daily_returns" else inner(name)

    ctx.supabase.table.side_effect = _routed

    import services.exchange as ex

    ex.get_and_clear_last_dq_flags()
    ex.get_and_clear_last_unit_switch_read()
    ex.get_and_clear_last_okx_ccy_share()

    def _funding_for(name: str) -> AsyncMock:
        return AsyncMock(return_value=[dict(r) for r in funding] if name == venue else [])

    patches = [
        patch("services.job_worker._exchange_preflight", new=AsyncMock(return_value=ctx)),
        patch(
            "services.job_worker.fetch_all_trades",
            new=AsyncMock(return_value=[dict(r) for r in realized]),
        ),
        patch("services.job_worker.aclose_exchange", new=AsyncMock()),
        patch(
            "services.exchange.fetch_account_equity_and_upnl_usd",
            new=AsyncMock(return_value=(equity, False, 0.0, False)),
        ),
        patch("services.funding_fetch.fetch_funding_okx", new=_funding_for("okx")),
        patch("services.funding_fetch.fetch_funding_binance", new=_funding_for("binance")),
        patch("services.funding_fetch.fetch_funding_bybit", new=_funding_for("bybit")),
        patch("services.ccxt_flow_fetch.fetch_ccxt_transfers", new=AsyncMock(return_value=[])),
        patch("services.job_worker.fetch_bybit_unified_flows", new=AsyncMock(return_value=([], []))),
        patch("services.job_worker._resolve_ccxt_flow_price_index", new=AsyncMock(return_value={})),
        patch(
            "services.ccxt_flows.ccxt_rows_to_dated_flows",
            new=MagicMock(side_effect=lambda *_a, **_k: []),
        ),
        patch("services.job_worker.db_execute", new=AsyncMock(side_effect=lambda fn: fn())),
        patch("services.job_worker._utc_now", new=MagicMock(return_value=now)),
    ]
    if not stored_marks:
        patches.append(patch("services.job_worker.read_key_marks", new=MagicMock(return_value=[])))
    with ExitStack() as stack:
        for p in patches:
            stack.enter_context(p)
        return await run_derive_broker_dailies_job(
            {"id": "j", "kind": "derive_broker_dailies", "strategy_id": STRATEGY}
        )


def _upserted_days(db: StrategyDb) -> list[str]:
    return sorted(r["date"] for payload in db.csv_upserts for r in payload)


# The distinctive stored value no derive can produce.
_STORED = 0.0123


def _old_funding_inputs(venue: str, today: date) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Funding at today-113, today-103 and today-94 (all before the reach; today-94 is the day
    just before it, and a UTC midnight can only move the derive's reach later, so it stays
    pre-reach) and today-88 (inside it, a funding-only day), realized records from today-85 to
    today-2."""
    funding = [
        _funding(_day(today, 113), -2.0),
        _funding(_day(today, 103), -3.0),
        _funding(_day(today, REACH_DAYS + 1), -1.0),
        _funding(_day(today, 88), -4.0),
    ]
    realized = [
        _realized(venue, _day(today, back), pnl)
        for back, pnl in ((85, 120.0), (70, -60.0), (50, 90.0), (30, 40.0), (10, -20.0), (2, 30.0))
    ]
    return realized, funding


class TestNonSwitchedDeriveKeepsPreReachRows:
    @pytest.mark.asyncio
    async def test_a_stored_row_older_than_the_bills_reach_survives_an_okx_derive(self) -> None:
        now = datetime.now(timezone.utc)
        today = now.date()
        reach = _day(today, REACH_DAYS)
        realized, funding = _old_funding_inputs("okx", today)
        stored_day = _day(today, 103)
        day_before_reach = _day(today, REACH_DAYS + 1)
        db = _BoundsDb()
        db.csv[(STRATEGY, stored_day)] = _STORED
        db.csv[(STRATEGY, day_before_reach)] = _STORED + 1

        result = await _derive_with_real_combine(
            db, venue="okx", realized=realized, funding=funding, now=now
        )

        assert result.outcome == DispatchOutcome.DONE, result.error_message
        # The stored row older than the reach is byte-unchanged: an OKX derive can not see that day's
        # realized P&L, so it must not state a funding-only figure over it.
        assert db.csv.get((STRATEGY, stored_day)) == _STORED
        # The day just before the reach is the boundary pin: a reach one day early would rebuild it
        # from funding alone and overwrite this row.
        assert db.csv.get((STRATEGY, day_before_reach)) == _STORED + 1
        upserted = _upserted_days(db)
        assert upserted, "the derive wrote no row"
        assert all(d >= reach for d in upserted), [d for d in upserted if d < reach]
        # The in-reach funding-only day is still written: the guard drops by the fetch's reach, never
        # by the first realized record (a funding-only day inside the reach is a real day).
        assert upserted[0] == _day(today, 88)
        persisted = {d for (s, d) in db.csv if s == STRATEGY}
        assert {r["timestamp"][:10] for r in realized} <= persisted
        # This series is dense, so the reconcile issues no delete here; the delete bounds are pinned
        # where a delete is forced (TestMarkedDeriveKeepsTheFirstMarkRow, the switched derive arm).


class TestOtherVenuesPassNoReach:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("venue", ["bybit", "binance"])
    async def test_old_funding_still_opens_the_series_off_okx(self, venue: str) -> None:
        now = datetime.now(timezone.utc)
        today = now.date()
        realized, funding = _old_funding_inputs(venue, today)
        db = _BoundsDb()

        result = await _derive_with_real_combine(
            db, venue=venue, realized=realized, funding=funding, now=now
        )

        assert result.outcome == DispatchOutcome.DONE, result.error_message
        # These venues' realized reads reach 365 days or inception, so their old funding is a real
        # day and still opens the series.
        assert _upserted_days(db)[0] == _day(today, 113)


# --------------------------------------------------------------------------------------
# The switched path: build_switched_series bounds its USD-side funding by bills_from_day
# --------------------------------------------------------------------------------------


def _nov(day: int, amount: float = -5.0) -> dict[str, Any]:
    """A USD funding row at 08:00 UTC on 2026-11-``day``."""
    return {"amount": amount, "timestamp": datetime(2026, 11, day, 8, 0, tzinfo=timezone.utc)}


class TestSwitchedBuilderBoundsUsdFunding:
    """Each arm keeps S inside the window (``bills_from_day`` at or before S and at or before the
    first USD P&L day, as a real bills read guarantees); otherwise the USD segment is skipped both
    before and after the fix and the arm is vacuous."""

    def test_pre_reach_usd_funding_does_not_open_the_usd_run(self) -> None:
        bounded = _ok(_build(bills_from_day="2026-11-09", funding_rows=[_nov(3), _nov(8)]))
        never_had_it = _ok(_build(bills_from_day="2026-11-09", funding_rows=[]))
        usd_days = _iso(bounded.usd_returns.index)
        assert usd_days, "no USD run"
        assert usd_days[0] >= "2026-11-09", usd_days[0]
        # Dropping the rows is the same as never having them (usd_full_history is fixed here).
        assert _by_day(bounded.headline) == _by_day(never_had_it.headline)

    def test_the_r2_02_early_run_is_bounded_too(self) -> None:
        kwargs: dict[str, Any] = {
            "usd_marks": _r2_marks(13),
            "mixed_from_day": _R2_FIRST_COIN_BILL,
            "bills_from_day": "2026-11-05",
        }
        bounded = _ok(_r2_build(**kwargs, funding_rows=[_nov(2)]))
        never_had_it = _ok(_r2_build(**kwargs, funding_rows=[]))
        usd_days = _iso(bounded.usd_returns.index)
        assert usd_days, "no USD run"
        assert usd_days[0] >= "2026-11-05", usd_days[0]
        assert _by_day(bounded.headline) == _by_day(never_had_it.headline)

    def test_only_pre_reach_usd_funding_leaves_no_usd_history(self) -> None:
        result = _ok(
            _build(
                split=SplitPnl(usd_by_day={}, coin_by_day={"2026-11-20": -0.0009}),
                bills_from_day="2026-11-10",
                funding_rows=[_nov(5)],
            )
        )
        assert len(result.usd_returns) == 0
        assert _iso(result.headline.index)[0] == "2026-11-15"

    def test_funding_on_the_reach_day_stays(self) -> None:
        """A pin against an off-by-one: funding ON ``bills_from_day`` is inside the reach."""
        result = _ok(_build(bills_from_day="2026-11-09", funding_rows=[_nov(9)]))
        assert _iso(result.usd_returns.index)[0] == "2026-11-09"


class TestSwitchedDeriveKeepsPreReachRows:
    @pytest.mark.asyncio
    async def test_pre_reach_usd_funding_writes_no_row_before_the_reach(self) -> None:
        cal = Calendar.now()
        reach = cal.day(REACH_DAYS)
        old = datetime.combine(
            cal.today - timedelta(days=100), datetime.min.time(), tzinfo=timezone.utc
        ) + timedelta(hours=8)
        day_before_reach = datetime.combine(
            cal.today - timedelta(days=REACH_DAYS + 1), datetime.min.time(), tzinfo=timezone.utc
        ) + timedelta(hours=8)
        # Day -10 has no stored BTC close, so it is withheld: the reconcile must delete it, which
        # forces a delete and makes the delete-bound assertions below run.
        closes = founder_closes(cal).drop(pd.Timestamp(cal.day(10)))
        capture = await run_switched_derive(
            cal=cal,
            funding=[
                {"timestamp": old, "amount": -3.0},
                {"timestamp": day_before_reach, "amount": -1.0},
            ],
            closes=closes,
        )

        assert capture.result is not None
        assert capture.result.outcome == DispatchOutcome.DONE, capture.result.error_message
        written = [r["date"] for r in capture.csv_rows]
        assert written, "the derive wrote no csv_daily_returns row"
        assert all(d >= reach for d in written), [d for d in written if d < reach]
        csv_deletes = [d for d in capture.deletes if d["table"] == "csv_daily_returns"]
        assert csv_deletes, "no reconcile delete was issued"
        for record in csv_deletes:
            filters = record["filters"]
            assert filters["gte:date"] >= reach, filters
            assert filters["in:date"] and all(d >= reach for d in filters["in:date"]), filters


class TestMarkedDeriveKeepsTheFirstMarkRow:
    """WR-01: once the reach passes a strategy's first NAV mark, ``apply_marks`` gives that day no
    return row and names it ``covered_from``, so the reconcile span reached it and deleted its stored
    row, which is older than the reach.

    The marks hold 100,000 from today-100 and collapse to 100 from today-50, so the days after the
    collapse are tiny-base: absent from the payload, so the reconcile MUST delete their stored rows.
    That forces a delete, which makes every delete-bound assertion below actually run."""

    @pytest.mark.asyncio
    async def test_a_stored_first_mark_row_older_than_the_reach_survives(self) -> None:
        now = datetime.now(timezone.utc)
        today = now.date()
        reach = _day(today, REACH_DAYS)
        realized, funding = _old_funding_inputs("okx", today)
        first_mark_day = _day(today, 100)
        tiny_day = _day(today, 30)
        db = _BoundsDb()
        db.csv[(STRATEGY, first_mark_day)] = _STORED
        db.csv[(STRATEGY, tiny_day)] = _STORED + 1
        nav = 100000.0
        for back in range(100, 0, -1):
            seed_mark(db, _day(today, back), nav if back > 50 else 100.0)
            nav += 10.0

        result = await _derive_with_real_combine(
            db, venue="okx", realized=realized, funding=funding, now=now, stored_marks=True
        )

        assert result.outcome == DispatchOutcome.DONE, result.error_message
        assert db.csv.get((STRATEGY, first_mark_day)) == _STORED
        # The forced delete ran: the in-span tiny-base day's stored row is gone.
        assert (STRATEGY, tiny_day) not in db.csv
        # No delete names the first mark day. The marks state every day after it, including the
        # ones older than the reach, so the span may start the day after it but never on it.
        assert db.delete_bounds, "no reconcile delete was issued"
        assert reach > first_mark_day
        for bound in db.delete_bounds:
            assert bound["gte"] is not None and bound["gte"] > first_mark_day, bound
            assert bound["in"] and all(d > first_mark_day for d in bound["in"]), bound
        assert db.csv_deletes
        for record in db.csv_deletes:
            assert first_mark_day not in record["days"], record


class TestOkxBillsReachDay:
    """WR-02: the reach day pinned on literal instants, so a helper that is a day early or late
    fails here. The oracle is typed from the calendar, never read back from the helper."""

    @pytest.mark.parametrize(
        ("now", "expected"),
        [
            (datetime(2026, 11, 28, 5, 30, tzinfo=timezone.utc), "2026-08-27"),
            (datetime(2026, 11, 28, 23, 59, 59, tzinfo=timezone.utc), "2026-08-27"),
            (datetime(2026, 11, 29, 0, 0, 0, tzinfo=timezone.utc), "2026-08-28"),
        ],
    )
    def test_the_reach_is_the_utc_day_93_days_back(self, now: datetime, expected: str) -> None:
        assert _okx_bills_reach_day(now) == expected


async def _derive_nightly_marked(
    first_back: int, *, gap_after_first: int = 0, stale_back: int | None = None
) -> tuple[_BoundsDb, date]:
    """Round 2 (R2-01, R2-02): the state a NIGHTLY derive meets. A funding record sits ON the reach
    day, the first mark is ``first_back`` days back with a stored row on it, and the marks then run
    daily to yesterday, after an optional gap of ``gap_after_first`` unmarked days."""
    now = datetime.now(timezone.utc)
    today = now.date()
    realized, funding = _old_funding_inputs("okx", today)
    funding.append(_funding(_day(today, REACH_DAYS), -0.5))
    db = _BoundsDb()
    first = _day(today, first_back)
    db.csv[(STRATEGY, first)] = _STORED
    if stale_back is not None:
        db.csv[(STRATEGY, _day(today, stale_back))] = 0.5
    nav = 100000.0
    seed_mark(db, first, nav)
    for back in range(first_back - 1 - gap_after_first, 0, -1):
        nav += 10.0
        seed_mark(db, _day(today, back), nav)
    result = await _derive_with_real_combine(
        db, venue="okx", realized=realized, funding=funding, now=now, stored_marks=True
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    return db, today


class TestNightlyFirstMarkRow:
    """R2-01: the night the reach day EQUALS the first mark day is the night a nightly derive meets
    first, so the first mark's stored row must survive it (and every later night). R2-02: a stale row
    on a gap day between the first and the second mark is still reconciled away, because the next
    mark's return owns that gap (D-05)."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize("first_back", [REACH_DAYS + 7, REACH_DAYS + 1, REACH_DAYS])
    async def test_the_first_mark_row_survives_the_reach_reaching_it(self, first_back: int) -> None:
        db, today = await _derive_nightly_marked(first_back)
        assert db.csv.get((STRATEGY, _day(today, first_back))) == _STORED

    @pytest.mark.asyncio
    async def test_a_stale_gap_row_after_an_old_first_mark_is_deleted(self) -> None:
        db, today = await _derive_nightly_marked(REACH_DAYS + 7, gap_after_first=3, stale_back=REACH_DAYS + 5)
        assert (STRATEGY, _day(today, REACH_DAYS + 5)) not in db.csv
        assert db.csv.get((STRATEGY, _day(today, REACH_DAYS + 7))) == _STORED
