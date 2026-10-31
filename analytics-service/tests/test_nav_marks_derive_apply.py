"""Phase 167.2.1.1.1 NAVMTM plan 07 - the strategy-mode derive applies stored marks (SC-2, SC-3, D-04, D-05, D-12, D-14, D-15, L3).

What these pin, and why each can fail
-------------------------------------
``run_derive_broker_dailies_job`` in STRATEGY mode reads every stored mark of its key, hands the
realized series, the builder's own flows, the builder's realized terminal and the marks to
``apply_marks`` (plan 03), and persists what it returns to ``csv_daily_returns``. With no stored
marks nothing changes. The module runs the REAL derive over an in-memory supabase that holds
``api_key_nav_marks`` (plan 06's mirror, ``FakeDb``) and, here, ``csv_daily_returns`` too, so a
row the derive deletes is observable as a row that is gone.

Every expected number is a literal typed beside its arithmetic, taken from the stored marks, the
flows and the realized terminal that the test feeds. The oracle is never ``apply_marks`` or the
derive. ``test_strategy_rows_roll_back_to_every_stored_mark`` (SC-3) rolls the PERSISTED rows
back with the compose convention ``L(d-1) = (L(d) - F_d) / (1 + r_d)`` and compares to the stored
marks.

The derive writes ITS OWN mark for the closed day first (plan 06). Each test therefore seeds that
day's mark itself: the first writer wins, so the seeded NAV, not the derive's read, is the stored
one (D-06) and the test controls every mark the apply sees.
"""
from __future__ import annotations

import logging
from collections.abc import Callable, Iterable
from contextlib import ExitStack
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pandas as pd
import pytest

from services.deribit_ingest import DeribitNativeAccountState
from services.external_flows import ExternalFlow, FlowInstant
from services.job_worker import DispatchOutcome, run_derive_broker_dailies_job
from tests.test_derive_broker_dailies_dualmode import _build_ctx, _cash_series_payload
from tests.test_mt5_derive_branch import (
    _BTC_SCALE,
    _FROZEN_NOW,
    _CLOSE_DAY,
    _FakeMt5Transport,
    _btc_closes_on,
    _canonical_deals,
    _epoch,
    _reset_mt5_terminal_locks,  # noqa: F401  (autouse fixture: clears the terminal registry)
    _scaled_deals,
)
from tests.test_mt5_derive_branch import _build_ctx as _mt5_build_ctx
from tests.test_flow_price_store import FlowPricesTable, route_flow_prices
from tests.test_nav_marks_writer import (  # noqa: F401  (autouse: re-binds the real writer)
    FakeDb,
    _Exec,
    _real_marks_writer,
    route_marks,
)

KEY = "key-s"
STRATEGY = "strat-1"
USER = "user-1"
_VERDICT = "fill_derived_unproven"

# A denominator config that is NOT the allocated-capital NAV path on a non-Deribit venue: the
# ccxt, MT5 and sFOX combiners ignore it and return NAV changes (BLOCKER 1, D-14).
_CONFIG: dict[str, Any] = {
    "denominator": "allocated_capital",
    "pnl_basis": "cash_settlement",
    "metrics_basis": "calendar_day",
    "cumulative_method": "simple",
    "capital_schedule": [{"effective_from": "2026-01-01", "capital_usd": 1000.0}],
}


# --------------------------------------------------------------------------------------
# An in-memory csv_daily_returns beside plan 06's marks mirror
# --------------------------------------------------------------------------------------


class StrategyDb(FakeDb):
    """``FakeDb`` plus the strategy's ``csv_daily_returns``: upserts land in ``csv`` and the
    derive's span delete removes rows, so a stale row is observable as present or gone."""

    def __init__(self) -> None:
        super().__init__()
        self.csv: dict[tuple[str, str], float] = {}
        self.csv_upserts: list[list[dict[str, Any]]] = []
        self.csv_deletes: list[dict[str, Any]] = []

    def rows(self, strategy_id: str = STRATEGY) -> dict[str, float]:
        return {d: v for (s, d), v in sorted(self.csv.items()) if s == strategy_id}


class _CsvDelete:
    def __init__(self, db: StrategyDb) -> None:
        self._db = db
        self._eq: dict[str, Any] = {}
        self._gte: str | None = None
        self._lte: str | None = None
        self._in: list[str] | None = None

    def eq(self, col: str, val: Any) -> "_CsvDelete":
        self._eq[col] = val
        return self

    def gte(self, col: str, val: Any) -> "_CsvDelete":
        assert col == "date"
        self._gte = val
        return self

    def lte(self, col: str, val: Any) -> "_CsvDelete":
        assert col == "date"
        self._lte = val
        return self

    def in_(self, col: str, val: Iterable[str]) -> "_CsvDelete":
        assert col == "date"
        self._in = list(val)
        return self

    def execute(self) -> Any:
        sid = self._eq["strategy_id"]
        gone = [
            (s, d) for (s, d) in list(self._db.csv)
            if s == sid
            and (self._gte is None or d >= self._gte)
            and (self._lte is None or d <= self._lte)
            and (self._in is None or d in self._in)
        ]
        for k in gone:
            del self._db.csv[k]
        self._db.csv_deletes.append({"strategy_id": sid, "days": sorted(d for _, d in gone)})
        return MagicMock(data=[], count=len(gone))


class _CsvQuery:
    def __init__(self, db: StrategyDb) -> None:
        self._db = db

    def upsert(self, payload: list[dict[str, Any]], on_conflict: str | None = None,
               **_kw: Any) -> _Exec:
        assert on_conflict == "strategy_id,date"

        def _do() -> list[dict[str, Any]]:
            self._db.csv_upserts.append(list(payload))
            for r in payload:
                self._db.csv[(r["strategy_id"], r["date"])] = float(r["daily_return"])
            return payload

        return _Exec(_do)

    def delete(self, **_kw: Any) -> _CsvDelete:
        return _CsvDelete(self._db)


def route_csv(ctx: MagicMock, db: StrategyDb) -> MagicMock:
    inner = ctx.supabase.table.side_effect

    def _routed(name: str) -> Any:
        return _CsvQuery(db) if name == "csv_daily_returns" else inner(name)

    ctx.supabase.table.side_effect = _routed
    return ctx


def seed_mark(
    db: FakeDb, day: str, nav: float, *, key: str = KEY, open_pnl: float = 0.0,
    venue: str = "okx", native_unit: str | None = "USD", nav_native: float | None = None,
    open_pnl_native: float | None = None,
) -> None:
    """Store a mark exactly as the table would hold it. ``marked_at`` is 00:10Z of the next day
    (the label CHECK: ``mark_day = date(marked_at at UTC) - 1``)."""
    d = date.fromisoformat(day)
    at = datetime(d.year, d.month, d.day, 0, 10, tzinfo=timezone.utc) + timedelta(days=1)
    if nav_native is None and native_unit == "USD":
        nav_native = nav
    if open_pnl_native is None and native_unit == "USD":
        open_pnl_native = open_pnl
    db.marks[(key, day)] = {
        "api_key_id": key, "allocator_id": USER, "mark_day": day, "marked_at": at.isoformat(),
        "venue": venue, "nav_usd": nav, "open_pnl_usd": open_pnl,
        "nav_native": nav_native, "open_pnl_native": open_pnl_native,
        "native_unit": native_unit,
    }


def at_0010(day_after: str) -> datetime:
    """The derive's clock: 00:10:30Z on ``day_after``, so the closed (labelled) day is the day before."""
    d = date.fromisoformat(day_after)
    return datetime(d.year, d.month, d.day, 0, 10, 30, tzinfo=timezone.utc)


def series(values: dict[str, float]) -> pd.Series:
    return pd.Series(
        list(values.values()), index=pd.DatetimeIndex(list(values)), dtype="float64"
    )


def prestamp(capture: dict[str, Any]) -> dict[str, Any]:
    flags: dict[str, Any] = {}
    for name, payload, _oc in capture["upserts"]:
        if name == "strategy_analytics" and isinstance(payload, dict):
            f = payload.get("data_quality_flags")
            if isinstance(f, dict):
                flags = f
    return flags


# --------------------------------------------------------------------------------------
# The ccxt strategy-mode derive harness
# --------------------------------------------------------------------------------------

#: Realized history through 2026-03-05. The numbers are arbitrary: the apply keeps these days
#: verbatim (L1) and the tests assert that they are kept.
REALIZED_THROUGH_0305 = {
    "2026-03-01": 0.01, "2026-03-02": -0.005, "2026-03-03": 0.002,
    "2026-03-04": 0.003, "2026-03-05": 0.004,
}


async def derive_ccxt_strategy(
    db: StrategyDb, *, returns: pd.Series, now: datetime, equity: float = 1071.0,
    upl: float = 71.0, venue: str = "okx", flows: list[ExternalFlow] | None = None,
    strategy_extra: dict[str, Any] | None = None, apply_nothing: bool = False,
    balance_error: bool = False, flow_instants: list[FlowInstant] | None = None,
) -> tuple[Any, dict[str, Any]]:
    """Run the real strategy-mode derive for one ccxt key. The derive's own equity read is
    ``(equity, balance_error, upl, False)``. The first mark's base comes from that mark's own
    wallet, so the read is not an input to the apply (review CR-01, SFH F1)."""
    ctx, capture = _build_ctx(
        key_row={"id": KEY, "exchange": venue, "user_id": USER},
        strategy_row={"id": STRATEGY, "user_id": USER, **(strategy_extra or {})},
    )
    route_csv(route_marks(ctx, db), db)
    meta = {"used_heuristic_capital": False, "series_completeness": _VERDICT}

    def _dated_flows(*_args: Any, instants: list[FlowInstant] | None = None, **_kw: Any) -> Any:
        if instants is not None:
            instants.extend(flow_instants or [])
        return list(flows or [])

    patches = [
        patch("services.job_worker._exchange_preflight", new=AsyncMock(return_value=ctx)),
        patch("services.job_worker.fetch_all_trades", new=AsyncMock(return_value=[])),
        patch("services.job_worker.aclose_exchange", new=AsyncMock()),
        patch(
            "services.exchange.fetch_account_equity_and_upnl_usd",
            new=AsyncMock(return_value=(equity, balance_error, upl, False)),
        ),
        patch("services.funding_fetch.fetch_funding_okx", new=AsyncMock(return_value=[])),
        patch("services.funding_fetch.fetch_funding_binance", new=AsyncMock(return_value=[])),
        patch("services.funding_fetch.fetch_funding_bybit", new=AsyncMock(return_value=[])),
        patch("services.ccxt_flow_fetch.fetch_ccxt_transfers", new=AsyncMock(return_value=[])),
        patch("services.job_worker._resolve_ccxt_flow_price_index", new=AsyncMock(return_value={})),
        patch(
            "services.ccxt_flows.ccxt_rows_to_dated_flows",
            new=MagicMock(side_effect=_dated_flows),
        ),
        patch(
            "services.broker_dailies.combine_realized_and_funding",
            new=MagicMock(return_value=(returns, dict(meta))),
        ),
        patch("services.job_worker.db_execute", new=AsyncMock(side_effect=lambda fn: fn())),
        patch("services.job_worker._utc_now", new=MagicMock(return_value=now)),
        *_no_marks_read(apply_nothing),
    ]
    with ExitStack() as stack:
        for p in patches:
            stack.enter_context(p)
        result = await run_derive_broker_dailies_job(
            {"id": "j", "kind": "derive_broker_dailies", "strategy_id": STRATEGY}
        )
    return result, capture


def _no_marks_read(apply_nothing: bool) -> list[Any]:
    """``apply_nothing`` makes the derive read no stored mark, which is exactly today's derive
    (the baseline a marked run's pre-start rows are compared with)."""
    if not apply_nothing:
        return []
    return [patch("services.job_worker.read_key_marks", new=MagicMock(return_value=[]))]


# --------------------------------------------------------------------------------------
# Task 1 - the tracer: OKX, strategy mode
# --------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_no_marks_strategy_series_is_unchanged() -> None:
    """L1: with no stored mark the persisted rows are the realized series verbatim and the
    prestamp carries nothing about marks. The derive's own read is dust (equity 50), which the
    mark rule refuses, so no mark exists for the apply to read."""
    db = StrategyDb()
    realized = series(REALIZED_THROUGH_0305)
    result, capture = await derive_ccxt_strategy(
        db, returns=realized, now=at_0010("2026-03-08"), equity=50.0, upl=0.0
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    assert db.marks == {}
    assert db.rows() == REALIZED_THROUGH_0305
    assert prestamp(capture) == {"csv_source": True}


@pytest.mark.asyncio
async def test_okx_strategy_series_uses_the_stored_marks() -> None:
    """Realized through 03-05, realized terminal 1000.0 (equity 1071.0 - upl 71.0), stored marks
    03-06 = 1050.0 and 03-07 = 1071.0:
    r(03-06) = (1050 - 1000) / 1000 = 0.05 and r(03-07) = (1071 - 1050) / 1050 = 0.02."""
    db = StrategyDb()
    seed_mark(db, "2026-03-06", 1050.0, open_pnl=50.0)
    seed_mark(db, "2026-03-07", 1071.0, open_pnl=71.0)
    result, capture = await derive_ccxt_strategy(
        db, returns=series(REALIZED_THROUGH_0305), now=at_0010("2026-03-08")
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    rows = db.rows()
    assert {d: v for d, v in rows.items() if d < "2026-03-06"} == REALIZED_THROUGH_0305
    assert rows["2026-03-06"] == pytest.approx(0.05, abs=1e-12)
    assert rows["2026-03-07"] == pytest.approx(0.02, abs=1e-12)
    assert sorted(rows) == [*REALIZED_THROUGH_0305, "2026-03-06", "2026-03-07"]
    assert prestamp(capture)["marks_since"] == "2026-03-06"
    assert db.marks[(KEY, "2026-03-07")]["nav_usd"] == 1071.0  # first writer won (D-06)


@pytest.mark.asyncio
async def test_a_stale_realized_row_inside_the_marked_span_is_deleted() -> None:
    """Pitfall 7 and the OKX-archive check. Realized rows run through 03-08 with terminal 1000.0
    on 03-08, and every realized return from 03-06 on is 0.0, so L(03-06) = 1000.0. Marks exist
    on 03-07 (1050.0) and 03-09 (1071.0) only: r(03-07) = (1050 - 1000) / 1000 = 0.05 and
    r(03-09) = (1071 - 1050) / 1050 = 0.02, with 03-08 a gap day. A realized-basis row for
    03-08 that an older derive left in the table must be gone, and no row may exist for the
    unmarked day."""
    db = StrategyDb()
    seed_mark(db, "2026-03-07", 1050.0, open_pnl=50.0)
    seed_mark(db, "2026-03-09", 1071.0, open_pnl=71.0)
    db.csv[(STRATEGY, "2026-03-08")] = 0.5  # the stale row
    realized = series({
        **REALIZED_THROUGH_0305, "2026-03-06": 0.0, "2026-03-07": 0.0, "2026-03-08": 0.0,
    })
    result, capture = await derive_ccxt_strategy(
        db, returns=realized, now=at_0010("2026-03-10")
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    rows = db.rows()
    assert "2026-03-08" not in rows, "a row for an unmarked day (D-05) must not survive"
    assert rows["2026-03-07"] == pytest.approx(0.05, abs=1e-12)
    assert rows["2026-03-09"] == pytest.approx(0.02, abs=1e-12)
    assert any("2026-03-08" in d["days"] for d in db.csv_deletes)
    flags = prestamp(capture)
    assert flags["mark_gap_days"] == ["2026-03-08"]
    assert flags["marks_since"] == "2026-03-07"


@pytest.mark.asyncio
async def test_cash_settlement_series_has_no_gap_a_mark_covers() -> None:
    """Realized through 03-05, marks 03-06, 03-07 and 03-09 (03-08 is a gap day a mark's return
    covers). The persisted cash_settlement series has no gap span on or after 03-06 and states
    one covered day; the prestamp names where the covered span starts."""
    db = StrategyDb()
    seed_mark(db, "2026-03-06", 1050.0, open_pnl=50.0)
    seed_mark(db, "2026-03-07", 1071.0, open_pnl=71.0)
    seed_mark(db, "2026-03-09", 1124.55, open_pnl=124.55)
    result, capture = await derive_ccxt_strategy(
        db, returns=series(REALIZED_THROUGH_0305), now=at_0010("2026-03-10"),
        equity=1124.0, upl=124.0,
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    cash = _cash_series_payload(capture)
    assert cash is not None
    assert [g for g in cash["gap_spans"] if g["end"] >= "2026-03-06"] == []
    assert cash["gap_spans"] == []
    assert cash["conventions"]["covered_day_count"] == 1
    assert prestamp(capture)["marks_covered_from"] == "2026-03-06"
    # 03-09 spans 03-08: one return, (1124.55 - 1071) / 1071 = 0.05.
    assert db.rows()["2026-03-09"] == pytest.approx(0.05, abs=1e-9)


@pytest.mark.asyncio
async def test_quiet_strategy_series_reaches_its_latest_mark() -> None:
    """Pitfall 5. Realized activity ends 03-03 (terminal 1000.0), marks 03-06, 03-07, 03-08:
    r(03-06) = (1050 - 1000) / 1000 = 0.05; r(03-07) = (1071 - 1050) / 1050 = 0.02;
    r(03-08) = (1092.42 - 1071) / 1071 = 0.02. The series ends on the latest mark."""
    db = StrategyDb()
    seed_mark(db, "2026-03-06", 1050.0, open_pnl=50.0)
    seed_mark(db, "2026-03-07", 1071.0, open_pnl=71.0)
    seed_mark(db, "2026-03-08", 1092.42, open_pnl=92.42)
    quiet = series({d: v for d, v in REALIZED_THROUGH_0305.items() if d <= "2026-03-03"})
    result, _capture = await derive_ccxt_strategy(
        db, returns=quiet, now=at_0010("2026-03-09"), equity=1092.0, upl=92.0
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    rows = db.rows()
    assert max(rows) == "2026-03-08"
    assert rows["2026-03-06"] == pytest.approx(0.05, abs=1e-12)
    assert rows["2026-03-07"] == pytest.approx(0.02, abs=1e-12)
    assert rows["2026-03-08"] == pytest.approx(0.02, abs=1e-9)


@pytest.mark.asyncio
async def test_configured_ccxt_strategy_applies_marks_by_the_returns_roll() -> None:
    """BLOCKER 1 / D-14. A returns_denominator_config on a ccxt strategy does not make its
    returns allocated-capital returns (only Deribit's combiner does that), so the marks apply by
    the returns roll: the same literals as the unconfigured OKX case."""
    db = StrategyDb()
    seed_mark(db, "2026-03-06", 1050.0, open_pnl=50.0)
    seed_mark(db, "2026-03-07", 1071.0, open_pnl=71.0)
    result, capture = await derive_ccxt_strategy(
        db, returns=series(REALIZED_THROUGH_0305), now=at_0010("2026-03-08"),
        strategy_extra={"returns_denominator_config": _CONFIG},
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    rows = db.rows()
    assert rows["2026-03-06"] == pytest.approx(0.05, abs=1e-12)
    assert rows["2026-03-07"] == pytest.approx(0.02, abs=1e-12)
    assert prestamp(capture)["marks_since"] == "2026-03-06"


# --------------------------------------------------------------------------------------
# Task 2 - every other NAV-path venue, and the strategy-level SC-3 roll
# --------------------------------------------------------------------------------------
#
# One scenario per venue, all of the same shape so the SC-3 roll can run over every one of them:
# realized history ending before the first mark, two stored marks with ONE UNMARKED GAP DAY
# between them, and ONE FLOW DATED ON THE GAP DAY. The convention (plan 03, rule 5): a flow
# inside a gap sits in the base of the next mark's return, so
#   r(S)    = (M_S - L(S-1)) / L(S-1)
#   r(next) = (M_next - (M_S + F_gap)) / (M_S + F_gap).


@dataclass
class Run:
    """What one venue scenario fed and what the derive persisted. ``marks`` and ``flows`` are in
    the SERIES unit (USD, or BTC for a native MT5 account)."""

    result: Any
    capture: dict[str, Any]
    db: StrategyDb
    rows: dict[str, float]
    baseline: dict[str, float]
    flows: dict[str, float]
    marks: dict[str, float]
    strategy_id: str = STRATEGY
    #: The marked run's scripted chart and flow-price store (Phase 177), when the scenario has them.
    chart: Any = None
    table: FlowPricesTable | None = None


def rolled_back_levels(
    rows: dict[str, float], flows: dict[str, float], marks: dict[str, float]
) -> dict[str, float]:
    """SC-3's instrument: from the LAST stored mark, roll the PERSISTED rows back with the
    compose's convention ``L(d-1) = (L(d) - F_d) / (1 + r_d)``. A day with no row is a day with
    ``r = 0`` (the compose's flow-day rule), and a flow dated on it steps the level."""
    last = max(marks)
    level = marks[last]
    day = date.fromisoformat(last)
    out = {last: level}
    first = date.fromisoformat(min(marks))
    while day > first:
        key = day.isoformat()
        level = (level - flows.get(key, 0.0)) / (1.0 + rows.get(key, 0.0))
        day -= timedelta(days=1)
        out[day.isoformat()] = level
    return out


def assert_rolls_back_to_every_mark(run: Run) -> None:
    levels = rolled_back_levels(run.rows, run.flows, run.marks)
    for day, nav in run.marks.items():
        assert levels[day] == pytest.approx(nav, rel=1e-9), f"the rows do not reproduce {day}"


def assert_marks_were_applied(run: Run, first: str) -> None:
    """Every row before the first mark is exactly what the derive writes without marks (L1)."""
    assert run.result.outcome == DispatchOutcome.DONE, run.result.error_message
    pre = {d: v for d, v in run.rows.items() if d < first}
    assert pre and pre == {d: v for d, v in run.baseline.items() if d < first}


# ---- ccxt: OKX, Bybit, Binance --------------------------------------------------------

CCXT_MARKS = {"2026-03-06": 1050.0, "2026-03-08": 1120.0}
CCXT_FLOWS = {"2026-03-07": 50.0}
# Realized terminal 1000.0 on 03-05. r(03-06) = (1050 - 1000) / 1000 = 0.05 and, with the gap day
# 03-07's deposit in the base, r(03-08) = (1120 - (1050 + 50)) / (1050 + 50) = 20 / 1100.
CCXT_R_0306 = 0.05
CCXT_R_0308 = 20.0 / 1100.0


async def run_ccxt(venue: str, *, config: bool = False) -> Run:
    flows = [ExternalFlow(utc_day_iso=d, usd_signed=a) for d, a in CCXT_FLOWS.items()]
    extra = {"returns_denominator_config": _CONFIG} if config else None
    db = StrategyDb()
    for day, nav in CCXT_MARKS.items():
        seed_mark(db, day, nav, venue=venue, open_pnl=nav - 1000.0)
    result, capture = await derive_ccxt_strategy(
        db, returns=series(REALIZED_THROUGH_0305), now=at_0010("2026-03-09"),
        equity=1120.0, upl=120.0, venue=venue, flows=flows, strategy_extra=extra,
    )
    base_db = StrategyDb()
    await derive_ccxt_strategy(
        base_db, returns=series(REALIZED_THROUGH_0305), now=at_0010("2026-03-09"),
        equity=1120.0, upl=120.0, venue=venue, flows=flows, apply_nothing=True,
    )
    return Run(result, capture, db, db.rows(), base_db.rows(), CCXT_FLOWS, CCXT_MARKS)


def assert_ccxt_literals(run: Run) -> None:
    assert_marks_were_applied(run, "2026-03-06")
    assert run.rows["2026-03-06"] == pytest.approx(CCXT_R_0306, abs=1e-12)
    assert run.rows["2026-03-08"] == pytest.approx(CCXT_R_0308, abs=1e-12)
    assert "2026-03-07" not in run.rows, "the gap day gets no row (D-05)"
    assert prestamp(run.capture)["marks_since"] == "2026-03-06"
    assert prestamp(run.capture)["mark_gap_days"] == ["2026-03-07"]


@pytest.mark.asyncio
async def test_bybit_strategy_series_uses_the_stored_marks() -> None:
    """Bybit: the realized terminal is the USDT wallet figure, because the derive's wedge is 0.0
    there (equity 1000.0, upl 0.0 would also give 1000.0). The marks and the gap-day flow are
    the scenario's."""
    db = StrategyDb()
    for day, nav in CCXT_MARKS.items():
        seed_mark(db, day, nav, venue="bybit", open_pnl=nav - 1000.0)
    flows = [ExternalFlow(utc_day_iso=d, usd_signed=a) for d, a in CCXT_FLOWS.items()]
    result, capture = await derive_ccxt_strategy(
        db, returns=series(REALIZED_THROUGH_0305), now=at_0010("2026-03-09"),
        equity=1000.0, upl=0.0, venue="bybit", flows=flows,
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    assert db.rows()["2026-03-06"] == pytest.approx(CCXT_R_0306, abs=1e-12)
    assert db.rows()["2026-03-08"] == pytest.approx(CCXT_R_0308, abs=1e-12)
    assert prestamp(capture)["marks_since"] == "2026-03-06"


@pytest.mark.asyncio
async def test_binance_strategy_series_uses_the_stored_marks() -> None:
    """Binance: the same wallet-basis terminal as Bybit (wedge 0.0)."""
    db = StrategyDb()
    for day, nav in CCXT_MARKS.items():
        seed_mark(db, day, nav, venue="binance", open_pnl=nav - 1000.0)
    flows = [ExternalFlow(utc_day_iso=d, usd_signed=a) for d, a in CCXT_FLOWS.items()]
    result, capture = await derive_ccxt_strategy(
        db, returns=series(REALIZED_THROUGH_0305), now=at_0010("2026-03-09"),
        equity=1000.0, upl=0.0, venue="binance", flows=flows,
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    assert db.rows()["2026-03-06"] == pytest.approx(CCXT_R_0306, abs=1e-12)
    assert db.rows()["2026-03-08"] == pytest.approx(CCXT_R_0308, abs=1e-12)
    assert prestamp(capture)["marks_since"] == "2026-03-06"


@pytest.mark.asyncio
async def test_a_ccxt_deposit_is_placed_by_its_instant_against_the_read() -> None:
    """D-23, ccxt strategy mode. Marks 03-06 and 03-07 (read at 00:10Z on 03-07 and 03-08) and a
    300.0 deposit dated 03-07, the read day of the 03-06 mark. Made at 00:05Z it is inside that
    mark: NAV 1350.0 (wallet 1300.0), r(03-06) = (1350 - 1000 - 300) / 1000 = 0.05 and
    r(03-07) = (1371 - 1350) / 1350. Made at 00:15Z it is not (NAV 1050.0): r(03-06) = 0.05 and
    r(03-07) = (1371 - 1050 - 300) / 1050. Booked by the flow's day alone the first case would be
    a +35 percent day followed by a -22 percent one."""
    flows = [ExternalFlow(utc_day_iso="2026-03-07", usd_signed=300.0)]
    for minute, nav_0306, r_0307 in (
        (5, 1350.0, (1371.0 - 1350.0) / 1350.0),
        (15, 1050.0, (1371.0 - 1050.0 - 300.0) / 1050.0),
    ):
        db = StrategyDb()
        seed_mark(db, "2026-03-06", nav_0306, open_pnl=50.0)
        seed_mark(db, "2026-03-07", 1371.0, open_pnl=71.0)
        at = int(datetime(2026, 3, 7, 0, minute, tzinfo=timezone.utc).timestamp() * 1000)
        result, _capture = await derive_ccxt_strategy(
            db, returns=series(REALIZED_THROUGH_0305), now=at_0010("2026-03-08"),
            equity=1371.0, upl=71.0, flows=flows,
            flow_instants=[FlowInstant(at, "2026-03-07", 300.0)],
        )
        assert result.outcome == DispatchOutcome.DONE, result.error_message
        rows = db.rows()
        assert rows["2026-03-06"] == pytest.approx(0.05, abs=1e-12), minute
        assert rows["2026-03-07"] == pytest.approx(r_0307, abs=1e-12), minute


# ---- MT5, USD and BTC units -----------------------------------------------------------


async def run_mt5(monkeypatch: pytest.MonkeyPatch, *, btc: bool, config: bool = False,
                  seed_unit: str | None = None, deposit_before_read: bool = False,
                  first_open: float | None = None) -> Run:
    """The canonical deal ledger (2025-06-02 .. 06-05), plus ONE deposit on a gap day, derived in
    strategy mode. USD: balance 110_500 / equity 110_600, a deposit of 5000 on 2026-10-07,
    marks 10-06 (105_550, seeded) and 10-08 (110_600, the derive's own equity). BTC (native
    series, every amount a millionth of the USD one): balance 0.1105 / equity 0.1115, a deposit of
    0.002 on 2026-10-06, marks 10-05 (0.1090, seeded) and 10-08 (0.1115, the derive's own).

    Realized: the deposit is the last ledger day and its return is 0.0, so
    L(S-1) = balance - deposit = 105_500 (USD) / 0.1085 (BTC), and
    r(S)    = (105_550 - 105_500) / 105_500                = 50 / 105_500
    r(next) = (110_600 - (105_550 + 5000)) / (105_550 + 5000) = 50 / 110_550
    (BTC: 0.0005 / 0.1085 and (0.1115 - (0.1090 + 0.002)) / (0.1090 + 0.002) = 0.0005 / 0.1110).

    ``first_open`` is the open profit the seeded mark stores, in the series unit (None keeps 50.0 /
    0.0005 BTC, the mark's wallet equal to the writer's level). A different one puts the mark's
    wallet off the writer's own level, which is what G-01 was about: the first return must not
    depend on it (D-25, D-26)."""
    monkeypatch.setenv("MT5_ENABLED", "true")
    if btc:
        scale = _BTC_SCALE
        deposit_day, deposit = (2026, 10, 6), 0.002
        account = {"equity": 0.1115, "balance": 0.1105, "currency": "BTC", "login": 123456}
        seed_day, seed_nav, seed_native = "2026-10-05", 0.1090, 0.1090
    else:
        scale = 1.0
        deposit_day, deposit = (2026, 10, 7), 5000.0
        account = {"equity": 110_600.0, "balance": 110_500.0, "currency": "USD", "login": 123456}
        seed_day, seed_nav, seed_native = "2026-10-06", 105_550.0, None
    if deposit_before_read and not btc:
        seed_nav = 105_550.0 + deposit
    deals = (_scaled_deals(scale) if btc else _canonical_deals()) + [{
        "type": 2, "profit": deposit, "swap": 0.0, "commission": 0.0, "fee": 0.0,
        # D-23: at 00:00Z of the 00:10Z read day the deposit is already inside the first mark.
        "time": _epoch(*deposit_day, 0 if deposit_before_read else 12),
    }]
    closes = _btc_closes_on((_CLOSE_DAY, 60000.0)) if btc else None

    async def _once(db: StrategyDb, *, apply_nothing: bool) -> tuple[Any, dict[str, Any]]:
        transport = _FakeMt5Transport(account=dict(account), deals=[dict(d) for d in deals])
        ctx, capture = _mt5_build_ctx(transport, asset_class="traditional")
        if config:
            ctx.strategy_row["returns_denominator_config"] = _CONFIG
        route_csv(route_marks(ctx, db), db)
        if not apply_nothing:
            unit = seed_unit if seed_unit is not None else ("BTC" if btc else "USD")
            # The first mark's own wallet is the base: 105_500 (USD) / 0.1085 BTC, so the open
            # profit is the 50 / 0.0005 BTC the NAV holds above it.
            open_native = (0.0005 if btc else 50.0) if first_open is None else first_open
            seed_mark(
                db, seed_day,
                seed_nav * 60000.0 if btc else seed_nav, key="key-mt5", venue="mt5",
                open_pnl=open_native * 60000.0 if btc else open_native, native_unit=unit,
                nav_native=seed_native if seed_unit != "USD" else seed_nav,
                open_pnl_native=open_native if seed_unit != "USD" else None,
            )
        patches = [
            patch("services.job_worker._exchange_preflight", new=AsyncMock(return_value=ctx)),
            patch("services.job_worker.aclose_exchange", new=AsyncMock()),
            patch("services.job_worker.db_execute", new=AsyncMock(side_effect=lambda fn: fn())),
            patch("services.benchmark.read_btc_closes", new=AsyncMock(return_value=closes)),
            patch("services.job_worker._utc_now", new=lambda: _FROZEN_NOW),
            *_no_marks_read(apply_nothing),
        ]
        with ExitStack() as stack:
            for p in patches:
                stack.enter_context(p)
            result = await run_derive_broker_dailies_job(
                {"id": "j-mt5", "kind": "derive_broker_dailies", "strategy_id": "strat-mt5"}
            )
        return result, capture

    db = StrategyDb()
    result, capture = await _once(db, apply_nothing=False)
    base_db = StrategyDb()
    await _once(base_db, apply_nothing=True)
    if btc:
        marks = {"2026-10-05": 0.1090, "2026-10-08": 0.1115}
        flows = {"2026-10-06": 0.002}
    else:
        marks = {"2026-10-06": 105_550.0, "2026-10-08": 110_600.0}
        flows = {"2026-10-07": 5000.0}
    return Run(
        result, capture, db, db.rows("strat-mt5"), base_db.rows("strat-mt5"), flows, marks,
        strategy_id="strat-mt5",
    )


def assert_mt5_literals(run: Run, *, btc: bool) -> None:
    if btc:
        first, nxt = "2026-10-05", "2026-10-08"
        r_first, r_next = 0.0005 / 0.1085, 0.0005 / 0.1110
        gap_days = ["2026-10-06", "2026-10-07"]
    else:
        first, nxt = "2026-10-06", "2026-10-08"
        r_first, r_next = 50.0 / 105_500.0, 50.0 / 110_550.0
        gap_days = ["2026-10-07"]
    assert_marks_were_applied(run, first)
    assert run.rows[first] == pytest.approx(r_first, abs=1e-9)
    assert run.rows[nxt] == pytest.approx(r_next, abs=1e-9)
    assert not set(gap_days) & set(run.rows), "gap days get no row (D-05)"
    assert prestamp(run.capture)["marks_since"] == first
    assert prestamp(run.capture)["mark_gap_days"] == gap_days


@pytest.mark.asyncio
async def test_mt5_usd_strategy_series_uses_the_stored_marks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """MT5, USD unit. The realized terminal is the BALANCE (110_500), not the equity: the
    equity (110_600) holds 100 of open profit the realized series never contained, and rolling
    from it would make the first marked day's step -50 / 105_600 instead of +50 / 105_500."""
    assert_mt5_literals(await run_mt5(monkeypatch, btc=False), btc=False)


@pytest.mark.asyncio
async def test_mt5_btc_strategy_series_applies_in_native_units(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """MT5, BTC unit: the marks enter as ``nav_native`` and the series stays native (every row is
    a ratio of BTC amounts, the deposit is 0.002 BTC)."""
    run = await run_mt5(monkeypatch, btc=True)
    assert_mt5_literals(run, btc=True)
    assert prestamp(run.capture)["native_unit"] == "BTC"


@pytest.mark.asyncio
async def test_mt5_deposit_made_before_the_read_is_counted_in_the_mark_day(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-23, MT5 USD strategy mode. The 5000 deposit is dated 10-07 (the read day of the 10-06
    mark) and made at 00:00Z, before the 00:10Z read, so the 10-06 mark holds it: NAV 110_550.
    Both returns are unchanged, 50 / 105_500 and 50 / 110_550, because the deposit is counted in
    10-06's numerator and sits in no base."""
    run = await run_mt5(monkeypatch, btc=False, deposit_before_read=True)
    assert_mt5_literals(run, btc=False)


# ---- Deribit, NAV path -----------------------------------------------------------------


async def run_deribit(
    *, marks: dict[str, float] | None = None, flows: dict[str, float] | None = None,
    dense_flows: bool = False, instants: tuple[FlowInstant, ...] = (),
    ledger_marks: dict[str, pd.Series] | None = None, chart: Callable[[], Any] | None = None,
    flow_prices: FlowPricesTable | None = None, marked_run_patches: list[Any] | None = None,
    mark_read_at: dict[str, str] | None = None, first_wallet: float | None = None,
) -> Run:
    """Deribit on the NAV path (no returns_denominator_config, so not ``_returns_are_allocated``).
    The realized terminal, the day P&L and the composed flows come from the cash-pass ledger,
    which strategy mode never computed before this plan (key mode only).

    Pitfall 6, the Deribit caveat: its realized terminal is the native balance at the mark of the
    LAST LEDGER DAY, while a mark is today's collapsed equity, so the first marked day's step also
    contains the coin's mark move since that ledger day. That is real marked-to-market profit and
    it is booked as the day's return, not an error.

    ``dense_flows`` hands the apply a composed-flow series with a 0.0 on every NAV day, which is
    the shape ``native_ledger_composed_flows`` really returns; ``instants`` are the ledger's
    per-row flow instants (D-23).

    Phase 177 (DERIBITFLOWS plan 05) keywords, all defaulting to today's behaviour: ``ledger_marks``
    is the stub ledger's per-currency day marks (what ``native_flow_instants`` values a non-USD
    instant at on its own day); ``chart`` is a FACTORY of the scripted
    ``get_tradingview_chart_data``, called once per derive run (the unmarked baseline run also
    predicts its own mark and may read the chart, so each run needs its own script); ``flow_prices``
    is the marked run's price store (the baseline run gets a fresh one); ``marked_run_patches``
    apply to the marked run only, after the base patches; ``mark_read_at`` maps a mark day to the
    ISO ``marked_at`` that replaces the seeded 00:10Z one. ``first_wallet`` is the wallet of the
    FIRST seeded mark (None keeps 1000.0, equal to the writer's level); a different one puts the
    mark's wallet off the writer's own level (G-01, D-26)."""
    from dataclasses import replace

    from tests.test_mtm_single_key import (
        _apply as _drb_apply,
        _base_patches,
        _ctx,
        _ledger_meta,
        _report,
        _stub_native_ledger,
    )

    use_marks = marks if marks is not None else CCXT_MARKS
    use_flows = flows if flows is not None else CCXT_FLOWS
    composed = (
        {d.date().isoformat(): 0.0 for d in pd.date_range("2026-03-01", "2026-03-12", freq="D")}
        if dense_flows else {}
    )
    composed.update(use_flows)

    async def _once(
        db: StrategyDb, *, apply_nothing: bool, table: FlowPricesTable,
        extra_patches: list[Any],
    ) -> tuple[Any, dict[str, Any], Any]:
        ctx, capture = _ctx(strategy_row={"id": STRATEGY, "user_id": USER, "asset_class": "crypto"})
        ctx.key_row = {"id": KEY, "user_id": USER, "exchange": "deribit"}
        scripted = chart() if chart is not None else None
        if scripted is not None:
            ctx.exchange.public_get_get_tradingview_chart_data = scripted
        route_flow_prices(route_csv(route_marks(ctx, db), db), table)
        if not apply_nothing:
            for k, (day, nav) in enumerate(use_marks.items()):
                wallet = first_wallet if (k == 0 and first_wallet is not None) else 1000.0
                seed_mark(db, day, nav, venue="deribit", open_pnl=nav - wallet, native_unit=None)
                if mark_read_at and day in mark_read_at:
                    db.marks[(KEY, day)]["marked_at"] = mark_read_at[day]
        state = DeribitNativeAccountState(
            native_equity={"BTC": 0.02}, native_upnl={"BTC": 0.001},
            collapsed_equity_usd=1120.0, collapsed_upnl_usd=120.0,
            balance_error=False, upnl_unreadable=False, native_options_value={},
            # D-21: the mark's open profit is NAV minus wallet at the read's own index:
            # (0.02 BTC - balance) x 56000 = 120, and 0.02 x 56000 is the 1120 nav above.
            native_balance={"BTC": 0.02 - 120.0 / 56000.0}, index_usd_snapshot={"BTC": 56000.0},
        )
        patches = _base_patches(
            ctx, key_mode=False,
            ledger_mock=AsyncMock(
                return_value=(
                    replace(
                        _stub_native_ledger(), flow_instants=instants,
                        **({"marks": ledger_marks} if ledger_marks is not None else {}),
                    ),
                    _report(has_option_activity=False),
                )
            ),
            combine_mock=MagicMock(
                return_value=(series(REALIZED_THROUGH_0305), _ledger_meta())
            ),
            state_spy=AsyncMock(return_value=state),
        ) + [
            patch("services.job_worker._utc_now", new=MagicMock(return_value=at_0010("2026-03-09"))),
            # The store calls run in order on the test thread, like the stand-in _base_patches
            # gives services.job_worker.db_execute.
            patch(
                "services.deribit_flow_prices.db_execute",
                new=AsyncMock(side_effect=lambda fn: fn()),
            ),
            patch(
                "services.broker_dailies.native_ledger_realized_terminal",
                new=MagicMock(return_value=(pd.Timestamp("2026-03-05"), 1000.0)),
            ),
            patch(
                "services.broker_dailies.native_ledger_day_pnl",
                new=MagicMock(return_value=series({
                    "2026-03-04": 3.0, "2026-03-05": 4.0,
                })),
            ),
            patch(
                "services.broker_dailies.native_ledger_composed_flows",
                new=MagicMock(return_value=series(composed)),
            ),
            *_no_marks_read(apply_nothing),
            *extra_patches,
        ]
        with _drb_apply(patches):
            result = await run_derive_broker_dailies_job(
                {"id": "j-drb", "kind": "derive_broker_dailies", "strategy_id": STRATEGY}
            )
        return result, capture, scripted

    db = StrategyDb()
    table = flow_prices if flow_prices is not None else FlowPricesTable()
    result, capture, marked_chart = await _once(
        db, apply_nothing=False, table=table, extra_patches=marked_run_patches or []
    )
    base_db = StrategyDb()
    await _once(base_db, apply_nothing=True, table=FlowPricesTable(), extra_patches=[])
    return Run(
        result, capture, db, db.rows(), base_db.rows(), use_flows, use_marks,
        chart=marked_chart, table=table,
    )


@pytest.mark.asyncio
async def test_deribit_strategy_series_uses_the_stored_marks() -> None:
    """Deribit on the NAV path: the same marks, flows and terminal as the ccxt scenario, taken
    from the ledger (``native_ledger_realized_terminal`` / ``_day_pnl`` / ``_composed_flows``)
    instead of the venue read. The docstring of ``run_deribit`` states the Pitfall 6 caveat."""
    assert_ccxt_literals(await run_deribit())


@pytest.mark.asyncio
async def test_deribit_strategy_keeps_every_mark_when_composed_flows_are_dense() -> None:
    """CR-01 at derive level. ``native_ledger_composed_flows`` has a 0.0 on every NAV day, not
    only on flow days. Four daily marks (03-06 .. 03-09) and no flow at all must give four rows,
    each the day-over-day change in the stored NAV, with no gap named; the old read-day skip
    kept only the last."""
    marks = {"2026-03-06": 1050.0, "2026-03-07": 1071.0, "2026-03-08": 1092.0, "2026-03-09": 1120.0}
    run = await run_deribit(marks=marks, flows={}, dense_flows=True)
    assert_marks_were_applied(run, "2026-03-06")
    assert run.rows["2026-03-06"] == pytest.approx(0.05, abs=1e-12)
    assert run.rows["2026-03-07"] == pytest.approx(21.0 / 1050.0, abs=1e-12)
    assert run.rows["2026-03-08"] == pytest.approx(21.0 / 1071.0, abs=1e-12)
    assert run.rows["2026-03-09"] == pytest.approx(28.0 / 1092.0, abs=1e-12)
    assert "mark_gap_days" not in prestamp(run.capture)
    assert_rolls_back_to_every_mark(run)


@pytest.mark.asyncio
async def test_deribit_deposit_made_before_the_read_is_counted_in_the_mark_day() -> None:
    """D-23, Deribit strategy mode through the ledger's own instants. A 20.0 USDC deposit dated
    03-09, the read day of the 03-08 mark, made at 00:05Z, is inside that mark: NAV 1140.0. The
    03-08 return is (1140 - 1100 - 20) / 1100 = 20 / 1100, the same as the literal case without
    the deposit (the 03-07 gap-day flow of 50 sits in the base), and the deposit is in no base."""
    at = int(datetime(2026, 3, 9, 0, 5, tzinfo=timezone.utc).timestamp() * 1000)
    run = await run_deribit(
        marks={"2026-03-06": 1050.0, "2026-03-08": 1140.0},
        flows={"2026-03-07": 50.0, "2026-03-09": 20.0},
        dense_flows=True,
        instants=(FlowInstant(at, "2026-03-09", 20.0, "USDC"),),
    )
    assert_marks_were_applied(run, "2026-03-06")
    assert run.rows["2026-03-08"] == pytest.approx(20.0 / 1100.0, abs=1e-12)


# ---- Deribit moved flows (Phase 177 DERIBITFLOWS plan 05) ------------------------------

def _ms(*args: int) -> int:
    return int(datetime(*args, tzinfo=timezone.utc).timestamp() * 1000)


def scripted_chart(*items: Any) -> Callable[[], Any]:
    """A factory of a scripted ``get_tradingview_chart_data`` (``run_deribit`` calls it once per
    derive run). Imported at call time: the roundtrip module imports this one."""
    from tests.test_nav_marks_compose_roundtrip import _ScriptedChart

    return lambda: _ScriptedChart(list(items))


def candles(*minutes_and_opens: tuple[int, float]) -> dict[str, Any]:
    return {"result": {
        "status": "ok",
        "ticks": [m for m, _ in minutes_and_opens],
        "open": [o for _, o in minutes_and_opens],
    }}


def concurrent_writer_marks(hidden_day: str) -> list[Any]:
    """A concurrent writer stored ``hidden_day``'s mark after the prefetch read the marks and
    before the apply seam reads them: ``services.job_worker.read_key_marks`` hides that day until
    the derive's exchange has closed (the exchange closes after the prefetch and before the seam's
    read), then delegates to the real reader. Keyed on the close, not on a call count, because the
    allocated path also reads the marks early. Patch these AFTER ``_base_patches`` so the close
    stand-in here replaces the base one."""
    from services.nav_marks import read_key_marks as real_read_key_marks

    closed: list[bool] = []

    def _read(supabase: Any, key: str) -> Any:
        stored = real_read_key_marks(supabase, key)
        return stored if closed else [m for m in stored if m.mark_day != hidden_day]

    async def _close(_exchange: Any) -> None:
        closed.append(True)

    return [
        patch("services.job_worker.read_key_marks", new=MagicMock(side_effect=_read)),
        patch("services.job_worker.aclose_exchange", new=AsyncMock(side_effect=_close)),
    ]


_STRATEGY_BTC_LEDGER = {"BTC": series({"2026-03-08": 100_000.0, "2026-03-09": 105_000.0})}
_STRATEGY_BTC_MINUTE = _ms(2026, 3, 9, 0, 5)
_STRATEGY_BTC_CANDLES = candles(
    (_STRATEGY_BTC_MINUTE - 60_000, 100_400.0), (_STRATEGY_BTC_MINUTE, 100_500.0),
    (_STRATEGY_BTC_MINUTE + 60_000, 100_600.0),
)
_STRATEGY_MOVED_MARKS = {"2026-03-06": 1050.0, "2026-03-08": 1140.0}
_STRATEGY_MOVED_FLOWS = {"2026-03-07": 50.0, "2026-03-09": 21.0}


@pytest.mark.asyncio
async def test_deribit_strategy_moved_btc_flow_priced_at_the_instant_price() -> None:
    """Phase 177 D-04 on the strategy-mode derive. A 0.0002 BTC deposit made at 00:05:20Z on 03-09,
    before the 00:10Z read of the 03-08 mark, is inside that mark's wallet. The ledger's own-day
    mark for 03-09 is 105000.0 (what the day aggregate stores, 0.0002 x 105000.0 = 21.0, and what
    leaves 03-09). The deposit is COUNTED in 03-08 at the open of the 1-minute BTC_USDC-PERPETUAL
    candle that contains it (00:05, open 100500.0; 00:04 and 00:06 open 100400.0 and 100600.0, so
    an adjacent-candle rule is distinguishable):
      counted in 03-08:  0.0002 x 100500.0 = 20.1
      base = level(03-06) 1050.0 + flow(03-07) 50.0 = 1100.0
      r(03-08) = (1140.0 - 1100.0 - 20.1) / 1100.0 = 19.9 / 1100.0
    The old own-day pricing counts 0.0002 x 105000.0 = 21.0 and stores 19.0 / 1100.0."""
    run = await run_deribit(
        marks=_STRATEGY_MOVED_MARKS, flows=_STRATEGY_MOVED_FLOWS, dense_flows=True,
        instants=(FlowInstant(_ms(2026, 3, 9, 0, 5, 20), "2026-03-09", 0.0002, "BTC"),),
        ledger_marks=_STRATEGY_BTC_LEDGER, chart=scripted_chart(_STRATEGY_BTC_CANDLES),
    )
    assert_marks_were_applied(run, "2026-03-06")
    assert run.rows["2026-03-08"] == pytest.approx(19.9 / 1100.0, abs=1e-12)
    assert len(run.chart.calls) == 1


@pytest.mark.asyncio
async def test_deribit_strategy_moved_flow_no_data_refuses_by_name(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """D-05 on the strategy-mode seam. The oracle's scenario with the chart answering ``no_data`` in
    both runs. The unmarked baseline run applies no mark, so no coverage check runs there and it
    stays DONE. The marked run takes the nav-marks refusal road with the token and nothing else:
    FAILED permanent, one chart call (a structural answer is not retried), no csv write, no
    flow-price row."""
    with caplog.at_level(logging.INFO, logger="quantalyze.analytics.job_worker"):
        run = await run_deribit(
            marks=_STRATEGY_MOVED_MARKS, flows=_STRATEGY_MOVED_FLOWS, dense_flows=True,
            instants=(FlowInstant(_ms(2026, 3, 9, 0, 5, 20), "2026-03-09", 0.0002, "BTC"),),
            ledger_marks=_STRATEGY_BTC_LEDGER,
            chart=scripted_chart({"result": {"status": "no_data"}}),
        )
    assert run.result.outcome == DispatchOutcome.FAILED, run.result.error_message
    assert run.result.error_kind == "permanent"
    assert run.result.error_message == (
        "derive_broker_dailies: nav marks refused (mark_flow_index_unavailable)"
    )
    assert len(run.chart.calls) == 1
    assert run.table is not None and run.table.rows == {}
    assert_refusal_cost_nothing(run.db, run.capture, {}, "mark_flow_index_unavailable", caplog)
    assert_flow_index_refusal_copy(failed_stamps(run.capture)[0]["computation_error"])


@pytest.mark.asyncio
async def test_deribit_strategy_moved_flow_prediction_miss_is_a_retry() -> None:
    """D-05 on the strategy-mode seam, Pitfall 3. A concurrent writer stored the 03-08 mark (read at
    00:20:00Z on 03-09) after the prefetch read the marks. The prefetch saw only 03-06 and predicted
    THIS derive's own read at 00:10:30Z, which does not place the 00:15:00Z BTC deposit, so nothing
    was read. The write-once insert loses, the stored 00:20 row is the mark, and the FINAL marks do
    place the deposit: the coverage check turns that into a named ``prediction_miss`` retry with no
    chart call and nothing written. A DONE would be the own-day price bug."""
    run = await run_deribit(
        marks=_STRATEGY_MOVED_MARKS, flows=_STRATEGY_MOVED_FLOWS, dense_flows=True,
        instants=(FlowInstant(_ms(2026, 3, 9, 0, 15), "2026-03-09", 0.0002, "BTC"),),
        ledger_marks=_STRATEGY_BTC_LEDGER, chart=scripted_chart(),
        mark_read_at={"2026-03-08": "2026-03-09T00:20:00+00:00"},
        marked_run_patches=concurrent_writer_marks("2026-03-08"),
    )
    assert run.result.outcome == DispatchOutcome.FAILED, run.result.error_message
    assert run.result.error_kind == "transient"
    assert "reason=prediction_miss" in run.result.error_message
    assert run.chart.calls == []
    assert run.db.csv_upserts == [] and run.db.csv_deletes == []
    assert not [p for n, p, _ in run.capture["upserts"] if n == "strategy_analytics"]


def moved_flows_log_lines(caplog: pytest.LogCaptureFixture) -> list[str]:
    """Every INFO record the D-01 counts line produced."""
    return [
        r.getMessage() for r in caplog.records
        if r.levelno == logging.INFO and r.getMessage().startswith(
            "derive_broker_dailies: deribit flows moved by marks"
        )
    ]


def test_moved_flow_counts_splits_the_flows_each_mark_moves() -> None:
    """D-01. Two marks, 03-08 (read 00:10Z on 03-09) and 03-10 (read 00:10Z on 03-11). The VALUED
    instants (every Deribit currency reads USD after valuation, so ``amount_prior_day`` is the one
    marker of an at-instant price): a USD-family deposit at 00:05Z on 03-09 (moved by the 03-08
    mark), a BTC deposit valued at its candle open at 00:05:20Z on 03-11 (moved by the 03-10 mark,
    the last), and a deposit at 00:20Z on 03-11, after that read, which no mark moves.
    Expected: moved 2, at_instant 1, usd_family 1, on_last_mark 1."""
    from services.deribit_flow_prices import MovedFlowCounts, moved_flow_counts

    instants = [
        FlowInstant(_ms(2026, 3, 9, 0, 5), "2026-03-09", 20.0),
        FlowInstant(_ms(2026, 3, 11, 0, 5, 20), "2026-03-11", 51.0, amount_prior_day=50.5),
        FlowInstant(_ms(2026, 3, 11, 0, 20), "2026-03-11", 30.0),
    ]
    marks = [
        ("2026-03-08", datetime(2026, 3, 9, 0, 10, tzinfo=timezone.utc)),
        ("2026-03-10", datetime(2026, 3, 11, 0, 10, tzinfo=timezone.utc)),
    ]
    assert moved_flow_counts(instants, marks) == MovedFlowCounts(2, 1, 1, 1)


def test_moved_flow_counts_is_all_zero_without_marks() -> None:
    from services.deribit_flow_prices import MovedFlowCounts, moved_flow_counts

    instants = [FlowInstant(_ms(2026, 3, 9, 0, 5), "2026-03-09", 20.0)]
    assert moved_flow_counts(instants, []) == MovedFlowCounts(0, 0, 0, 0)


@pytest.mark.asyncio
async def test_deribit_flows_moved_log_strategy_mode(caplog: pytest.LogCaptureFixture) -> None:
    """D-01 on the strategy-mode derive, the oracle scenario of
    ``test_deribit_strategy_moved_btc_flow_priced_at_the_instant_price``: one BTC deposit moved by
    the last (03-08) mark, priced at its candle open. The one line carries counts and the closed
    mode word only, never the strategy id or the key id."""
    with caplog.at_level(logging.INFO, logger="quantalyze.analytics.job_worker"):
        await run_deribit(
            marks=_STRATEGY_MOVED_MARKS, flows=_STRATEGY_MOVED_FLOWS, dense_flows=True,
            instants=(FlowInstant(_ms(2026, 3, 9, 0, 5, 20), "2026-03-09", 0.0002, "BTC"),),
            ledger_marks=_STRATEGY_BTC_LEDGER, chart=scripted_chart(_STRATEGY_BTC_CANDLES),
        )
    assert moved_flows_log_lines(caplog) == [
        "derive_broker_dailies: deribit flows moved by marks "
        "(moved=1 at_instant=1 usd_family=0 on_last_mark=1 mode=strategy)"
    ]
    assert STRATEGY not in moved_flows_log_lines(caplog)[0]
    assert KEY not in moved_flows_log_lines(caplog)[0]


# ---- sFOX -------------------------------------------------------------------------------


async def run_sfox(
    monkeypatch: pytest.MonkeyPatch, *, config: bool = False, deposit_before_read: bool = False
) -> Run:
    """sFOX: the observed NAV 02-27 .. 03-05 and a 50 deposit on 03-04. The realized terminal is
    the last observed usd_value (1110) on 03-05, so rolling back the realized returns
    (r(03-05) = 10/1100, r(03-04) = (1100 - 1040 - 50)/1040, r(03-03) = 10/1030) gives
    L(03-02) = 1030. Marks 03-03 (1045, seeded) and 03-05 (1110, the derive's own read):
    r(03-03) = (1045 - 1030) / 1030 and, with the gap day 03-04's deposit in the base,
    r(03-05) = (1110 - (1045 + 50)) / (1045 + 50) = 15 / 1095."""
    from tests.test_sfox_reconstruct import _apply as _sfox_apply
    from tests.test_sfox_reconstruct import _bh_row, _ms, _sfox_branch_patches

    monkeypatch.setenv("SFOX_ENABLED", "true")
    nav = (("2026-02-27", "1000"), ("2026-02-28", "1010"), ("2026-03-01", "1020"),
           ("2026-03-02", "1030"), ("2026-03-03", "1040"), ("2026-03-04", "1100"),
           ("2026-03-05", "1110"))
    nav_rows = [_bh_row(d, v) for d, v in nav]
    txns = [{"id": 1, "action": "deposit", "currency": "USD", "amount": "50",
             # noon: after the 00:10Z read of the 03-03 mark. D-23: at 00:05Z it is before it.
             "timestamp": _ms("2026-03-04") + (5 * 60_000 if deposit_before_read else 12 * 3_600_000)}]

    async def _once(db: StrategyDb, *, apply_nothing: bool) -> tuple[Any, dict[str, Any]]:
        ctx, capture = _build_ctx(
            key_row={"id": KEY, "exchange": "sfox", "user_id": USER},
            strategy_row={
                "id": STRATEGY, "user_id": USER,
                **({"returns_denominator_config": _CONFIG} if config else {}),
            },
        )
        route_csv(route_marks(ctx, db), db)
        if not apply_nothing:
            seed_mark(
                db, "2026-03-03", 1095.0 if deposit_before_read else 1045.0, venue="sfox",
                open_pnl=5.0,
            )
        patches = _sfox_branch_patches(
            ctx, bh_return=nav_rows, txn_return=txns, key_mode=False
        ) + [
            patch("services.job_worker._utc_now", new=MagicMock(return_value=at_0010("2026-03-06"))),
            *_no_marks_read(apply_nothing),
        ]
        with _sfox_apply(patches):
            result = await run_derive_broker_dailies_job(
                {"id": "j-sfox", "kind": "derive_broker_dailies", "strategy_id": STRATEGY}
            )
        return result, capture

    db = StrategyDb()
    result, capture = await _once(db, apply_nothing=False)
    base_db = StrategyDb()
    await _once(base_db, apply_nothing=True)
    return Run(
        result, capture, db, db.rows(), base_db.rows(), {"2026-03-04": 50.0},
        {"2026-03-03": 1045.0, "2026-03-05": 1110.0},
    )


def assert_sfox_literals(run: Run) -> None:
    assert_marks_were_applied(run, "2026-03-03")
    assert run.rows["2026-03-03"] == pytest.approx(15.0 / 1030.0, abs=1e-12)
    assert run.rows["2026-03-05"] == pytest.approx(15.0 / 1095.0, abs=1e-12)
    assert "2026-03-04" not in run.rows
    assert prestamp(run.capture)["marks_since"] == "2026-03-03"
    assert prestamp(run.capture)["mark_gap_days"] == ["2026-03-04"]


@pytest.mark.asyncio
async def test_sfox_strategy_series_uses_the_stored_marks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    assert_sfox_literals(await run_sfox(monkeypatch))


@pytest.mark.asyncio
async def test_sfox_deposit_made_before_the_read_is_counted_in_the_mark_day(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-23, sFOX through its real flow producer. The 50 deposit is dated 03-04, the read day of the
    03-03 mark, and made at 00:05Z, before the 00:10Z read, so that mark holds it: NAV 1095. Both
    returns equal the literals of the deposit-after-the-read case: (1095 - 1030 - 50) / 1030 and
    (1110 - 1095) / 1095, because the deposit is in 03-03's numerator and in no base."""
    assert_sfox_literals(await run_sfox(monkeypatch, deposit_before_read=True))


# ---- BLOCKER 1: a configured strategy of a non-Deribit venue still gets its marks -------


@pytest.mark.asyncio
@pytest.mark.parametrize("venue", ["mt5_usd", "sfox"])
async def test_configured_mt5_and_sfox_strategies_apply_marks(
    monkeypatch: pytest.MonkeyPatch, venue: str
) -> None:
    """D-14 / BLOCKER 1: a returns_denominator_config on an MT5 or sFOX strategy does not change
    its returns basis (only Deribit's combiner builds allocated-capital returns), so the marks
    apply and the persisted literals are those of the unconfigured case."""
    if venue == "sfox":
        assert_sfox_literals(await run_sfox(monkeypatch, config=True))
    else:
        assert_mt5_literals(await run_mt5(monkeypatch, btc=False, config=True), btc=False)


# ---- SC-3 at the strategy level --------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "venue", ["okx", "bybit", "binance", "mt5_usd", "mt5_btc", "deribit", "sfox"]
)
async def test_strategy_rows_roll_back_to_every_stored_mark(
    monkeypatch: pytest.MonkeyPatch, venue: str
) -> None:
    """SC-3. Rolling the PERSISTED csv rows back from the last stored mark with the compose
    convention reproduces every stored mark's NAV to 1e-9 relative, gap-day flows placed on their
    day and gap days at r = 0. The oracle is the stored marks themselves."""
    if venue in ("okx", "bybit", "binance"):
        run = await run_ccxt(venue)
    elif venue == "mt5_usd":
        run = await run_mt5(monkeypatch, btc=False)
    elif venue == "mt5_btc":
        run = await run_mt5(monkeypatch, btc=True)
    elif venue == "deribit":
        run = await run_deribit()
    else:
        run = await run_sfox(monkeypatch)
    assert run.result.outcome == DispatchOutcome.DONE, run.result.error_message
    assert_rolls_back_to_every_mark(run)


@pytest.mark.asyncio
async def test_unit_mismatch_is_refused(monkeypatch: pytest.MonkeyPatch) -> None:
    """A BTC-unit strategy series whose stored mark was stored in another unit is refused with
    ``mark_unit_mismatch`` (the nothing-written half is Task 3's test)."""
    run = await run_mt5(monkeypatch, btc=True, seed_unit="USD")
    assert run.result.outcome == DispatchOutcome.FAILED
    assert run.result.error_kind == "permanent"
    assert "mark_unit_mismatch" in run.result.error_message


# --------------------------------------------------------------------------------------
# Review fix round 1 - CR-01 and SFH F1: the base comes from the first mark, not the live read
# --------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_first_marked_day_is_booked_once_across_derives() -> None:
    """CR-01 / D-04 "once per key". The same stored marks (03-06 = 1050.0 with a wallet of 1000.0,
    03-07 = 1071.0) are applied by two derives a day apart. Between them the live wallet read
    moved 80.0 (1000.0 to 1080.0) that no realized P&L explains (a spot coin revalued inside
    totalEq - upl). Before the fix that 80.0 was absorbed into the base rolled back from the live
    terminal and the first marked day's return was re-stamped every derive: 0.05 on the first,
    (1050 - 1080) / 1080 on the second, for one and the same stored mark."""
    marks = {"2026-03-06": (1050.0, 50.0), "2026-03-07": (1071.0, 71.0)}
    first = StrategyDb()
    second = StrategyDb()
    for db in (first, second):
        for day, (nav, upl) in marks.items():
            seed_mark(db, day, nav, open_pnl=upl)
    r1, _c1 = await derive_ccxt_strategy(
        first, returns=series(REALIZED_THROUGH_0305), now=at_0010("2026-03-08"),
        equity=1071.0, upl=71.0,
    )
    r2, _c2 = await derive_ccxt_strategy(
        second, returns=series({**REALIZED_THROUGH_0305, "2026-03-06": 0.0}),
        now=at_0010("2026-03-08"), equity=1151.0, upl=71.0,
    )
    assert r1.outcome == DispatchOutcome.DONE, r1.error_message
    assert r2.outcome == DispatchOutcome.DONE, r2.error_message
    assert first.rows()["2026-03-06"] == pytest.approx(0.05, abs=1e-12)
    assert second.rows()["2026-03-06"] == first.rows()["2026-03-06"]
    assert second.rows()["2026-03-07"] == first.rows()["2026-03-07"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("equity", "upl", "balance_error"),
    [(50.0, 0.0, False), (None, 0.0, True)],
    ids=["dust-equity", "balance-error"],
)
async def test_an_unusable_live_read_does_not_fail_a_strategy_with_stored_marks(
    equity: float | None, upl: float, balance_error: bool
) -> None:
    """SFH F1. A dust equity (a wind-down) or a transient `balance_error` on a day AFTER marks
    began used to leave the apply with no terminal, so every such derive was refused
    `mark_base_unrollable`: FAILED permanent plus the user-visible failed stamp, for a read the
    stored marks do not need. The marks are final, so the derive applies them exactly as on a
    day with a clean read and stamps nothing failed."""
    db = StrategyDb()
    seed_mark(db, "2026-03-06", 1050.0, open_pnl=50.0)
    seed_mark(db, "2026-03-07", 1071.0, open_pnl=71.0)
    result, capture = await derive_ccxt_strategy(
        db, returns=series(REALIZED_THROUGH_0305), now=at_0010("2026-03-08"),
        equity=equity, upl=upl, balance_error=balance_error,  # type: ignore[arg-type]
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    assert failed_stamps(capture) == []
    assert db.rows()["2026-03-06"] == pytest.approx(0.05, abs=1e-12)
    assert db.rows()["2026-03-07"] == pytest.approx(0.02, abs=1e-12)


# --------------------------------------------------------------------------------------
# Task 3 - L3: a refusal names its reason and writes nothing
# --------------------------------------------------------------------------------------


def failed_stamps(capture: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        p for name, p, _oc in capture["upserts"]
        if name == "strategy_analytics" and isinstance(p, dict)
        and p.get("computation_status") == "failed"
    ]


def deleted_tables(capture: dict[str, Any]) -> list[str]:
    """The tables a derive deleted from. Two harnesses record a delete differently (a dict with
    its filters, or just the table name)."""
    return [d["table"] if isinstance(d, dict) else str(d) for d in capture["deletes"]]


def assert_refusal_cost_nothing(
    run_db: StrategyDb, capture: dict[str, Any], before: dict[tuple[str, str], float],
    token: str, caplog: pytest.LogCaptureFixture,
) -> None:
    """L3: no csv row written or deleted, no prestamp, no series write, no analytics enqueue; the
    one thing that happens is a single failed stamp whose user-visible text is static and whose
    operator detail (the log) carries only the token."""
    assert run_db.csv_upserts == [] and run_db.csv_deletes == []
    assert run_db.csv == before
    stamps = failed_stamps(capture)
    assert len(stamps) == 1, "exactly one failed stamp, and no prestamp beside it"
    assert [p for n, p, _ in capture["upserts"] if n == "strategy_analytics"] == stamps
    assert "marks_since" not in stamps[0].get("data_quality_flags", {})
    assert stamps[0]["computation_error"] and token not in stamps[0]["computation_error"]
    assert not any(ch.isdigit() for ch in stamps[0]["computation_error"])
    assert "strategy_analytics_series" not in deleted_tables(capture), "heal_series is False"
    assert not any(n == "upsert_strategy_analytics_series_batch" for n, _ in capture["rpc_calls"])
    assert not any(
        c[1].get("p_kind") == "compute_analytics_from_csv"
        for c in capture["rpc_calls"] if c[0] == "enqueue_compute_job"
    )
    # The operator detail (the log inside the stamp choke point) carries the token and nothing else.
    assert any(
        f"| detail: nav marks refused ({token})" in r.getMessage() for r in caplog.records
    )
    assert any(
        r.levelname == "ERROR" and f"reason={token}" in r.getMessage() for r in caplog.records
    )


def assert_flow_index_refusal_copy(text: str) -> None:
    """SF-04. This refusal recurs on every derive until support acts, so its stamped copy must not
    tell the account holder the issue "needs nothing from you"; it says what happened and that the
    daily returns are paused until support resolves it."""
    assert "needs nothing from you" not in text
    assert "could not be priced at its minute" in text
    assert "paused until support resolves it" in text


@pytest.mark.asyncio
async def test_a_nonpositive_first_base_is_a_gap_not_a_failed_derive() -> None:
    """CR-02. The first mark's wallet is -100.0 (NAV 1050.0 less an open profit of 1150.0), so its
    base is not positive and 03-06 has no return of its own. Marks and flows are history, so a
    refusal would fail every later derive too. The derive is DONE, 03-06 is a named gap, and the
    03-07 mark is measured from the stored 1050.0: (1071 - 1050) / 1050 = 0.02."""
    db = StrategyDb()
    seed_mark(db, "2026-03-06", 1050.0, open_pnl=1150.0)
    seed_mark(db, "2026-03-07", 1071.0, open_pnl=71.0)
    result, capture = await derive_ccxt_strategy(
        db, returns=series(REALIZED_THROUGH_0305), now=at_0010("2026-03-08"),
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    assert failed_stamps(capture) == []
    assert "2026-03-06" not in db.rows()
    assert db.rows()["2026-03-07"] == pytest.approx(0.02, abs=1e-12)


@pytest.mark.asyncio
async def test_an_emptied_then_refunded_account_heals_on_the_next_mark() -> None:
    """CR-02(a), the reproduced scenario. Marks 1000.0 on 03-06, the owner withdraws everything
    on 03-07 (a 1000.0 flow; that day's mark was refused dust so none is stored) and deposits
    500.0 on 03-08 (mark 500.0), then 03-09 marks 505.0. The 03-08 base is 1000 + (-1000) = 0:
    no return, a gap. 03-09 is measured from the stored 500: 5 / 500 = 0.01. Before the fix the
    03-08 mark raised `mark_base_nonpositive` and the strategy failed on every later derive."""
    db = StrategyDb()
    seed_mark(db, "2026-03-06", 1000.0, open_pnl=0.0)
    seed_mark(db, "2026-03-08", 500.0, open_pnl=0.0)
    seed_mark(db, "2026-03-09", 505.0, open_pnl=5.0)
    flows = [
        ExternalFlow(utc_day_iso="2026-03-07", usd_signed=-1000.0),
        ExternalFlow(utc_day_iso="2026-03-08", usd_signed=500.0),
    ]
    result, capture = await derive_ccxt_strategy(
        db, returns=series(REALIZED_THROUGH_0305), now=at_0010("2026-03-10"), flows=flows,
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    assert failed_stamps(capture) == []
    rows = db.rows()
    assert rows["2026-03-06"] == pytest.approx(0.0, abs=1e-12)
    assert "2026-03-08" not in rows and "2026-03-07" not in rows
    assert rows["2026-03-09"] == pytest.approx(0.01, abs=1e-12)
    assert prestamp(capture)["mark_gap_days"] == ["2026-03-07", "2026-03-08"]


@pytest.mark.asyncio
async def test_a_series_that_stops_before_the_labelled_day_says_so() -> None:
    """CR-03 / D-05. "The next mark covers it" holds only while a next mark comes. From 03-08 the
    account is in a state no mark can be taken in (here a dust read; `borrow_present` and
    `option_value_unverified` are the same shape and do not clear), so the stored marks end on
    03-07 while the derive labels 03-08. Every realized row after the last mark is dropped, so the
    published series silently ends 03-07. The prestamp names the first day it is missing:
    `marks_trailing_since` = 03-08. With a stored 03-08 mark the flag is absent."""
    db = StrategyDb()
    seed_mark(db, "2026-03-06", 1050.0, open_pnl=50.0)
    seed_mark(db, "2026-03-07", 1071.0, open_pnl=71.0)
    result, capture = await derive_ccxt_strategy(
        db, returns=series(REALIZED_THROUGH_0305), now=at_0010("2026-03-09"),
        equity=50.0, upl=0.0,
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    assert max(db.rows()) == "2026-03-07"
    flags = prestamp(capture)
    assert flags["marks_trailing_since"] == "2026-03-08"
    assert "computation_status" not in flags

    seed_mark(db, "2026-03-08", 1092.42, open_pnl=92.42)
    current, current_capture = await derive_ccxt_strategy(
        db, returns=series(REALIZED_THROUGH_0305), now=at_0010("2026-03-09"),
        equity=50.0, upl=0.0,
    )
    assert current.outcome == DispatchOutcome.DONE, current.error_message
    assert "marks_trailing_since" not in prestamp(current_capture)


@pytest.mark.asyncio
async def test_a_dust_base_is_a_gap_not_a_several_hundred_percent_day() -> None:
    """CR-02 (the small-base guard). The owner withdraws 950.0 on 03-07, leaving a base of 50.0:
    above zero but under the 100.0 dust floor the realized path NaN-guards. 03-08's mark of 400.0
    would publish (400 - 50) / 50 = +700 percent; it is a gap instead, and 03-09 (410.0) is
    measured from the stored 400.0."""
    db = StrategyDb()
    seed_mark(db, "2026-03-06", 1000.0, open_pnl=0.0)
    seed_mark(db, "2026-03-08", 400.0, open_pnl=0.0)
    seed_mark(db, "2026-03-09", 410.0, open_pnl=10.0)
    result, capture = await derive_ccxt_strategy(
        db, returns=series(REALIZED_THROUGH_0305), now=at_0010("2026-03-10"),
        flows=[ExternalFlow(utc_day_iso="2026-03-07", usd_signed=-950.0)],
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    rows = db.rows()
    assert "2026-03-08" not in rows
    assert rows["2026-03-09"] == pytest.approx(10.0 / 400.0, abs=1e-12)


@pytest.mark.asyncio
async def test_a_nan_realized_first_marked_day_does_not_fail_the_derive() -> None:
    """CR-02(b). A guard-NaN realized return on the first marked day (ccxt passes no day P&L)
    used to make the base unrollable on every derive from then on. The day has no row and the
    03-07 mark covers it: (1071 - 1050) / 1050 = 0.02."""
    db = StrategyDb()
    seed_mark(db, "2026-03-06", 1050.0, open_pnl=50.0)
    seed_mark(db, "2026-03-07", 1071.0, open_pnl=71.0)
    realized = series({**REALIZED_THROUGH_0305, "2026-03-06": float("nan")})
    result, capture = await derive_ccxt_strategy(
        db, returns=realized, now=at_0010("2026-03-08"),
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    assert failed_stamps(capture) == []
    assert "2026-03-06" not in db.rows()
    assert db.rows()["2026-03-07"] == pytest.approx(0.02, abs=1e-12)


@pytest.mark.asyncio
async def test_unit_mismatch_writes_nothing(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture,
) -> None:
    """The Task 2 mismatch case (a BTC-unit series, a mark stored in USD) writes no csv row and no
    prestamp and returns FAILED permanent naming ``mark_unit_mismatch``."""
    run = await run_mt5(monkeypatch, btc=True, seed_unit="USD")
    assert run.result.outcome == DispatchOutcome.FAILED
    assert run.result.error_kind == "permanent"
    assert "mark_unit_mismatch" in run.result.error_message
    assert_refusal_cost_nothing(run.db, run.capture, {}, "mark_unit_mismatch", caplog)
