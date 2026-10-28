"""Phase 167.2.1.1.1 NAVMTM plan 12 - the allocator curve uses the stored marks, and the compose reproduces them (SC-2, SC-3, W7, Pitfall 4).

What these pin, and why each can fail
-------------------------------------
``run_derive_broker_dailies_job`` in KEY mode persists two things the allocator compose reads
back: the key's ``csv_daily_returns`` rows and its ``key_inputs`` payload (realized terminal,
writer basis, flows, anchor). From the first stored mark on, the returns are the marked returns
(plan 03's ``apply_marks``), so the payload fields that describe the series must change with
them in the SAME derive (Pitfall 4): a marked series beside a realized terminal makes the
compose's backward roll land on the wrong levels, or degrade blocking
(``key_inputs_mismatch``) and flip My Allocation to the legacy fallback.

Every test here runs the REAL derive over an in-memory supabase that holds the marks table and
the key's csv rows, then feeds what the derive PERSISTED (the csv rows and the ``key_inputs``
payload, nothing else) to the REAL compose job (``run_derive_allocator_equity_job`` ->
``compose_allocator_equity``) and reads the drawn curve.

The oracles are the stored marks and this module's own arithmetic, never the code under test:
the expected return of a marked day is typed beside the sum it comes from, and the pre-start
levels are rolled back from the realized terminal with the compose's convention
``L(d-1) = (L(d) - F_d) / (1 + r_d)`` in ``realized_levels`` below.
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import ExitStack
from datetime import date, datetime, timedelta, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import ccxt
import pandas as pd
import pytest

from services.external_flows import ExternalFlow, FlowInstant
from services.job_worker import (
    DispatchOutcome,
    run_derive_allocator_equity_job,
    run_derive_broker_dailies_job,
)
from tests.test_allocator_equity_dropped_day_pnl import _key_inputs_payload
from tests.test_derive_allocator_equity_job import (
    DERIVED_TABLE,
    _extract_payload,
    _FakeSupabase,
    _is_equity_curve_upsert,
)
from tests.test_derive_broker_dailies_dualmode import _build_ctx
from tests.test_nav_marks_derive_apply import (
    REALIZED_THROUGH_0305,
    at_0010,
    seed_mark,
    series,
)
from tests.test_nav_marks_writer import (  # noqa: F401  (autouse: re-binds the real writer)
    FakeDb,
    _Exec,
    _real_marks_writer,
    route_marks,
)
from tests.test_flow_price_store import FlowPricesTable, route_flow_prices

KEY = "key-k"
USER = "user-1"
_VERDICT = "fill_derived_unproven"


# --------------------------------------------------------------------------------------
# An in-memory csv_daily_returns for the KEY axis, beside plan 06's marks mirror
# --------------------------------------------------------------------------------------


class KeyDb(FakeDb):
    """``FakeDb`` plus the key's ``csv_daily_returns``: upserts land in ``csv`` and the derive's
    span delete removes rows, so a stale row is observable as present or gone."""

    def __init__(self) -> None:
        super().__init__()
        self.csv: dict[tuple[str, str], float] = {}
        self.csv_upserts: list[list[dict[str, Any]]] = []
        self.csv_deletes: list[dict[str, Any]] = []

    def rows(self, key: str = KEY) -> dict[str, float]:
        return {d: v for (k, d), v in sorted(self.csv.items()) if k == key}


class _CsvDelete:
    def __init__(self, db: KeyDb) -> None:
        self._db = db
        self._eq: dict[str, Any] = {}
        self._gte: str | None = None
        self._lte: str | None = None
        self._in: list[str] | None = None

    def eq(self, col: str, val: Any) -> "_CsvDelete":
        self._eq[col] = val
        return self

    def gte(self, col: str, val: Any) -> "_CsvDelete":
        self._gte = val
        return self

    def lte(self, col: str, val: Any) -> "_CsvDelete":
        self._lte = val
        return self

    def in_(self, col: str, val: Any) -> "_CsvDelete":
        self._in = list(val)
        return self

    def execute(self) -> Any:
        key = self._eq["api_key_id"]
        gone = [
            (k, d) for (k, d) in list(self._db.csv)
            if k == key
            and (self._gte is None or d >= self._gte)
            and (self._lte is None or d <= self._lte)
            and (self._in is None or d in self._in)
        ]
        for pair in gone:
            del self._db.csv[pair]
        self._db.csv_deletes.append({"api_key_id": key, "days": sorted(d for _, d in gone)})
        return MagicMock(data=[], count=len(gone))


class _CsvQuery:
    def __init__(self, db: KeyDb) -> None:
        self._db = db

    def upsert(self, payload: list[dict[str, Any]], on_conflict: str | None = None,
               **_kw: Any) -> _Exec:
        assert on_conflict == "api_key_id,date"

        def _do() -> list[dict[str, Any]]:
            self._db.csv_upserts.append(list(payload))
            for row in payload:
                self._db.csv[(row["api_key_id"], row["date"])] = float(row["daily_return"])
            return payload

        return _Exec(_do)

    def delete(self, **_kw: Any) -> _CsvDelete:
        return _CsvDelete(self._db)


def route_key_csv(ctx: MagicMock, db: KeyDb) -> MagicMock:
    inner = ctx.supabase.table.side_effect

    def _routed(name: str) -> Any:
        return _CsvQuery(db) if name == "csv_daily_returns" else inner(name)

    ctx.supabase.table.side_effect = _routed
    return ctx


# --------------------------------------------------------------------------------------
# The key-mode derive harness (ccxt) and the compose job over what it persisted
# --------------------------------------------------------------------------------------

#: Realized through 03-05 with a realized terminal of 1000.0 (live equity less open profit).
#: Marks 03-06 (1050), 03-07 (1071) and 03-10 (1194.42), a +100 deposit on the gap day 03-08.
OKX_MARKS = {"2026-03-06": 1050.0, "2026-03-07": 1071.0, "2026-03-10": 1194.42}
OKX_FLOW_DAY = "2026-03-08"
OKX_FLOW = 100.0
OKX_TERMINAL = 1000.0


async def derive_key_ccxt(
    db: KeyDb, *, returns: pd.Series, now: datetime, equity: float, upl: float,
    venue: str = "okx", flows: list[ExternalFlow] | None = None, apply_nothing: bool = False,
    upnl_unreadable: bool = False, flow_instants: list[FlowInstant] | None = None,
) -> tuple[Any, dict[str, Any]]:
    """Run the real KEY-mode derive for one ccxt key. The derive's own equity read is
    ``(equity, upl)``, so its realized terminal is ``equity - upl`` on the last return day.
    ``flow_instants`` are what the flow producer reports into its ``instants`` out-list (D-23)."""

    def _dated_flows(*_args: Any, instants: list[FlowInstant] | None = None, **_kw: Any) -> Any:
        if instants is not None:
            instants.extend(flow_instants or [])
        return list(flows or [])

    ctx, capture = _build_ctx(
        key_row={"id": KEY, "exchange": venue, "user_id": USER}, strategy_row=None
    )
    route_key_csv(route_marks(ctx, db), db)
    meta = {"used_heuristic_capital": False, "series_completeness": _VERDICT}
    patches = [
        patch("services.job_worker._allocator_key_preflight", new=AsyncMock(return_value=ctx)),
        patch("services.job_worker.fetch_all_trades", new=AsyncMock(return_value=[])),
        patch("services.job_worker.aclose_exchange", new=AsyncMock()),
        patch(
            "services.exchange.fetch_account_equity_and_upnl_usd",
            new=AsyncMock(return_value=(equity, False, upl, upnl_unreadable)),
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
        # The DQ-02 retention terminus reads the WALL clock and these fixtures sit in March 2026,
        # so with a flow in the data it would NaN every pre-start day. It is another rule's
        # business: pinned off ("the whole window is inside retention") so the days before the
        # first mark are real and the test does not depend on the date it runs.
        patch("services.nav_twr.flow_coverage_terminus_day", new=MagicMock(return_value=None)),
        *([patch("services.job_worker.read_key_marks", new=MagicMock(return_value=[]))]
          if apply_nothing else []),
    ]
    with ExitStack() as stack:
        for p in patches:
            stack.enter_context(p)
        result = await run_derive_broker_dailies_job(
            {"id": "j", "kind": "derive_broker_dailies", "api_key_id": KEY}
        )
    return result, capture


SIBLING = "key-sibling"


async def compose_curve(
    db: KeyDb, capture: dict[str, Any], *, key: str = KEY, venue: str = "okx",
    sibling_days: list[str] | None = None,
) -> dict[str, Any]:
    """The allocator compose over exactly what the derive persisted for the key: its csv rows and
    its ``key_inputs`` payload. Returns the ``equity_curve`` payload the compose job upserted.

    ``sibling_days`` adds a second, unmarked key with a flat daily return on each of those days
    (a binance-shaped row with a live anchor of 5000.0). With one key the book's days are that
    key's own, so a day it skipped is not a day of the book; with a sibling that trades every
    day, the skipped day is a key-day inside the key's coverage with no level."""
    key_inputs = _key_inputs_payload(capture, key)
    keys = [{
        "id": key, "user_id": USER, "is_active": True, "sync_status": "connected",
        "disconnected_at": None, "exchange": venue,
    }]
    csv = [
        {"api_key_id": key, "allocator_id": USER, "date": d, "daily_return": r}
        for d, r in db.rows(key).items()
    ]
    derived = [{"allocator_id": USER, "kind": f"key_inputs:{key}", "payload": key_inputs}]
    if sibling_days:
        keys.append({
            "id": SIBLING, "user_id": USER, "is_active": True, "sync_status": "connected",
            "disconnected_at": None, "exchange": "binance",
        })
        csv += [
            {"api_key_id": SIBLING, "allocator_id": USER, "date": d, "daily_return": 0.001}
            for d in sibling_days
        ]
        derived.append({
            "allocator_id": USER, "kind": f"key_inputs:{SIBLING}",
            "payload": {
                "flows": [], "anchor_usd": 5000.0, "anchor_null_reason": None,
                "anchor_asof": "2026-03-11T00:10:00+00:00", "venue": "binance",
            },
        })
    fake = _FakeSupabase({
        "api_keys": keys,
        "csv_daily_returns": csv,
        DERIVED_TABLE: derived,
        "allocator_equity_snapshots": [],
    })
    with patch("services.job_worker.get_supabase", return_value=fake):
        result = await run_derive_allocator_equity_job(
            {"id": "j-compose", "kind": "derive_allocator_equity", "allocator_id": USER}
        )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    upserts = [u for u in fake.upserts if u[0] == DERIVED_TABLE and _is_equity_curve_upsert(u[1])]
    assert len(upserts) == 1, fake.upserts
    return _extract_payload(upserts[0][1])


def levels(curve_payload: dict[str, Any]) -> dict[str, float]:
    """The drawn curve as {day: dollars}."""
    return {str(p["date"]): float(p["equity_usd"]) for p in curve_payload["curve"]}


def realized_levels(
    returns: dict[str, float], terminal_day: str, terminal: float, flows: dict[str, float],
) -> dict[str, float]:
    """The test's own roll of the realized series back from its terminal, ``L(d-1) = (L(d) -
    F_d) / (1 + r_d)``. The oracle for every day before the first mark."""
    out = {terminal_day: terminal}
    level = terminal
    day = date.fromisoformat(terminal_day)
    first = date.fromisoformat(min(returns))
    while day > first:
        key = day.isoformat()
        level = (level - flows.get(key, 0.0)) / (1.0 + returns.get(key, 0.0))
        day -= timedelta(days=1)
        out[day.isoformat()] = level
    return out


def seed_okx_marks(
    db: KeyDb, marks: dict[str, float] | None = None, *, venue: str = "okx"
) -> None:
    for day, nav in (marks or OKX_MARKS).items():
        seed_mark(db, day, nav, key=KEY, open_pnl=nav - OKX_TERMINAL, venue=venue)


def okx_flows() -> list[ExternalFlow]:
    return [ExternalFlow(utc_day_iso=OKX_FLOW_DAY, usd_signed=OKX_FLOW)]


async def derive_okx(
    db: KeyDb, *, equity: float = 1194.42, now_day: str = "2026-03-11", **kw: Any
) -> tuple[Any, dict[str, Any]]:
    """The OKX key-mode derive for the Task 1 scenario. ``equity - upl`` is the 1000.0 terminal."""
    return await derive_key_ccxt(
        db, returns=series(REALIZED_THROUGH_0305), now=at_0010(now_day), equity=equity,
        upl=equity - OKX_TERMINAL, flows=okx_flows(), **kw,
    )


# --------------------------------------------------------------------------------------
# Task 1 - the tracer: OKX key mode end to end
# --------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_okx_key_mode_compose_reproduces_every_mark() -> None:
    """SC-2, SC-3 through the real compose. Realized through 03-05 (terminal 1000.0), marks 03-06
    1050.0, 03-07 1071.0 and 03-10 1194.42, a +100.0 deposit on the gap day 03-08, 03-09 a gap
    day with no flow. The persisted returns are
      r(03-06) = (1050 - 1000) / 1000                    = 0.05
      r(03-07) = (1071 - 1050) / 1050                    = 0.02
      r(03-10) = (1194.42 - (1071 + 100)) / (1071 + 100) = 23.42 / 1171 = 0.02
    (the gap-day deposit sits in the base of the return that spans it). Rolling them back from
    the 03-10 mark through the compose must land on each stored NAV, with no blocking degrade."""
    db = KeyDb()
    seed_okx_marks(db)
    result, capture = await derive_okx(db)
    assert result.outcome == DispatchOutcome.DONE, result.error_message

    rows = db.rows()
    assert {d: v for d, v in rows.items() if d < "2026-03-06"} == REALIZED_THROUGH_0305
    assert rows["2026-03-06"] == pytest.approx(0.05, abs=1e-12)
    assert rows["2026-03-07"] == pytest.approx(0.02, abs=1e-12)
    assert rows["2026-03-10"] == pytest.approx(23.42 / 1171.0, abs=1e-12)
    assert "2026-03-08" not in rows and "2026-03-09" not in rows

    payload = await compose_curve(db, capture)
    curve = levels(payload)
    for day, nav in OKX_MARKS.items():
        assert curve[day] == pytest.approx(nav, rel=1e-9), f"the compose does not reproduce {day}"
    # The deposit day carries the stepped level, and the flow-free gap day has no level of its own.
    assert curve["2026-03-08"] == pytest.approx(1071.0 + OKX_FLOW, rel=1e-9)
    # Before the first mark: the levels the realized series gives, rolled from the 1000.0 terminal
    # that sits on 03-05 (the pre-start boundary), independent of the compose.
    expected = realized_levels(REALIZED_THROUGH_0305, "2026-03-05", OKX_TERMINAL, {})
    for day, level in expected.items():
        assert curve[day] == pytest.approx(level, rel=1e-9), f"a pre-start level moved on {day}"
    assert payload["degrade_reasons"] == []
    assert payload["is_trustworthy"] is True


@pytest.mark.asyncio
async def test_a_gap_day_raises_only_the_benign_carry_flag() -> None:
    """D-05 / D-15 on the allocator curve. A gap day carries no return of its own; the compose
    draws the level through it from the next mark's single return. Beside a sibling key that
    trades every day, the flow-free gap day 03-09 is a key-day inside this key's coverage with no
    level: the compose names it with the benign ``missing_return_inside_coverage`` and degrades
    nothing (the deposit day 03-08 has a level, through the flow-day union, so it is no gap)."""
    db = KeyDb()
    seed_okx_marks(db)
    _result, capture = await derive_okx(db)
    sibling_days = [f"2026-03-{d:02d}" for d in range(1, 11)]
    payload = await compose_curve(db, capture, sibling_days=sibling_days)
    assert "missing_return_inside_coverage" in payload["flags"]
    assert payload["degrade_reasons"] == []
    assert payload["is_trustworthy"] is True


@pytest.mark.asyncio
async def test_anchor_is_the_stored_mark_not_the_live_read() -> None:
    """W7 / SC-2. The 03-10 mark is stored at 1194.42; this derive's own live read of the same
    closed day is 1215.0 (it lost the D-06 race, or read later the same day under D-11). The
    persisted anchor is the STORED mark, and the compose's last level is the stored mark."""
    db = KeyDb()
    seed_okx_marks(db)
    result, capture = await derive_okx(db, equity=1215.0)
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    assert db.marks[(KEY, "2026-03-10")]["nav_usd"] == 1194.42  # first writer won (D-06)

    ki = _key_inputs_payload(capture, KEY)
    assert ki["anchor_usd"] == pytest.approx(1194.42, abs=1e-9)
    assert ki["anchor_null_reason"] is None
    # The realized terminal travels with the marks: the last mark day and its stored NAV.
    assert ki["realized_terminal_day"] == "2026-03-10"
    assert ki["realized_terminal_usd"] == pytest.approx(1194.42, abs=1e-9)

    curve = levels(await compose_curve(db, capture))
    assert curve["2026-03-10"] == pytest.approx(1194.42, rel=1e-9)


@pytest.mark.asyncio
async def test_no_marks_key_inputs_are_unchanged() -> None:
    """With no stored mark the key_inputs payload is what it was before this plan: its field set,
    and the anchor is the live read. The derive's own read here is dust, which the mark rule
    refuses, so no mark exists for the apply to read."""
    db = KeyDb()
    result, capture = await derive_key_ccxt(
        db, returns=series(REALIZED_THROUGH_0305), now=at_0010("2026-03-11"), equity=50.0,
        upl=0.0, flows=okx_flows(),
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    assert db.marks == {}
    assert db.rows() == REALIZED_THROUGH_0305
    ki = _key_inputs_payload(capture, KEY)
    # equity 50.0 is dust: a null anchor with its reason, exactly as before.
    assert ki["anchor_usd"] is None and ki["anchor_null_reason"] == "dust"
    assert set(ki) == {
        "flows", "anchor_usd", "anchor_null_reason", "anchor_asof", "venue", "nav_mark_refusal",
    }
    assert ki["nav_mark_refusal"] == "dust"
    for absent in ("marks_since", "mark_gap_days", "realized_terminal_day"):
        assert absent not in ki

    # And a healthy live read with no marks anchors on the live read, as ever.
    base = KeyDb()
    _r, cap = await derive_okx(base, apply_nothing=True)
    live = _key_inputs_payload(cap, KEY)
    assert live["anchor_usd"] == pytest.approx(1194.42, abs=1e-9)
    assert live["realized_terminal_usd"] == pytest.approx(OKX_TERMINAL, abs=1e-9)
    assert live["realized_terminal_day"] == "2026-03-05"
    # The field set is the one this payload always had, plus plan 06's ``nav_mark`` echo.
    assert set(live) == {
        "flows", "anchor_usd", "anchor_null_reason", "anchor_asof", "venue",
        "realized_terminal_usd", "realized_terminal_day", "nav_mark",
    }


@pytest.mark.asyncio
async def test_key_inputs_name_where_marks_begin_and_which_days_they_skipped() -> None:
    """Additive fields in the 167.1.2.2 D-15 voice: ``marks_since`` (the first mark day) and
    ``mark_gap_days`` (the unmarked days between the first and the last mark)."""
    db = KeyDb()
    seed_okx_marks(db)
    _result, capture = await derive_okx(db)
    ki = _key_inputs_payload(capture, KEY)
    assert ki["marks_since"] == "2026-03-06"
    assert ki["mark_gap_days"] == ["2026-03-08", "2026-03-09"]
    assert "mark_flow_read_days" not in ki
    # The deposit is inside the marked window, so it stays in the stored flows.
    assert ki["flows"] == [{"utc_day_iso": OKX_FLOW_DAY, "usd_signed": OKX_FLOW}]


@pytest.mark.asyncio
async def test_key_inputs_name_where_a_key_stops_getting_marks() -> None:
    """SFH round 2 N1, the data half. Key mode returns before the strategy prestamp, so the day a
    key's series stops was computed and thrown away. The key's marks end at 03-07 and this derive
    (03-11, labelling 03-10) cannot take its own mark (the live read is dust): the rows stop after
    03-07 and ``key_inputs`` says ``marks_trailing_since`` is 2026-03-08. A key whose last mark
    is the label day carries no such field."""
    db = KeyDb()
    seed_okx_marks(db, {d: n for d, n in OKX_MARKS.items() if d <= "2026-03-07"})
    result, capture = await derive_okx(db, equity=50.0)
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    ki = _key_inputs_payload(capture, KEY)
    assert ki["marks_since"] == "2026-03-06"
    assert ki["marks_trailing_since"] == "2026-03-08"

    current = KeyDb()
    seed_okx_marks(current)
    _r, cap = await derive_okx(current)
    assert "marks_trailing_since" not in _key_inputs_payload(cap, KEY)


@pytest.mark.asyncio
async def test_stored_mark_anchor_carries_its_read_time() -> None:
    """Info 2. When the anchor is the stored mark, ``anchor_asof`` is that mark's ``marked_at``
    (00:10Z on 03-11, the instant its read finished), not the clock of the derive that persisted
    it. Under D-11 a retry the same day, hours later, still writes the day's mark; the derive
    clock is pinned to 05:00Z here, hours after ``marked_at``."""
    db = KeyDb()
    seed_okx_marks(db)
    marked_at = db.marks[(KEY, "2026-03-10")]["marked_at"]
    assert marked_at.startswith("2026-03-11T00:10")
    before = datetime.now(timezone.utc)
    _result, capture = await derive_key_ccxt(
        db, returns=series(REALIZED_THROUGH_0305),
        now=datetime(2026, 3, 11, 5, 0, tzinfo=timezone.utc), equity=1215.0,
        upl=215.0, flows=okx_flows(),
    )
    ki = _key_inputs_payload(capture, KEY)
    assert ki["anchor_usd"] == pytest.approx(1194.42, abs=1e-9)
    assert ki["anchor_asof"] == marked_at
    assert datetime.fromisoformat(ki["anchor_asof"]) < before - timedelta(days=1)


@pytest.mark.asyncio
async def test_stale_last_mark_is_the_anchor_when_the_live_read_is_sound() -> None:
    """Info 2, MARKSOURCE 167.2.1.1.1.1 plan 03 (D-02, a gap is named, never carried). Today's mark
    was refused (``upnl_unreadable``: the open profit could not be read, so no mark was stored for
    03-10), and the series' last day is the 03-08 mark, two days older than this derive's label.
    The live read (1215.0, a healthy balance) is a sound, material, positive read, so the ladder
    stays silent, and the anchor is the last STORED mark: 1071.0, read at that mark's own
    ``marked_at``. The live equity of 03-10 is never written onto mark day 03-08.

    The oracle moved with the behaviour (it was the live 1215.0 and this derive's own clock): the
    old rule booked the 144.0 between the mark and the live read as a one-day step on 03-08.

    The plan names a live read of 0.0 for this case. An OKX terminal is ``equity - upl``, which
    needs a usable equity (plan 07's rule: no realized terminal, no marked series, the derive
    refuses by name), so a live zero cannot reach the anchor here. That variant is
    ``test_stale_last_mark_does_not_mask_a_live_zero`` on Deribit, whose terminal does not come
    from the live read."""
    db = KeyDb()
    seed_okx_marks(db, {"2026-03-06": 1050.0, "2026-03-08": 1071.0})
    result, capture = await derive_key_ccxt(
        db, returns=series(REALIZED_THROUGH_0305), now=at_0010("2026-03-11"), equity=1215.0,
        upl=215.0, flows=[], upnl_unreadable=True,
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    assert (KEY, "2026-03-10") not in db.marks, "an unreadable open profit stores no mark"
    ki = _key_inputs_payload(capture, KEY)
    assert ki["nav_mark_refusal"] == "upnl_unreadable"
    assert ki["anchor_usd"] == pytest.approx(1071.0, abs=1e-9), "the stored mark is the anchor"
    assert ki["anchor_null_reason"] is None
    assert ki["anchor_asof"] == db.marks[(KEY, "2026-03-08")]["marked_at"]
    # The marks still apply to the series: its last day is the older mark, and the terminal
    # follows the series.
    assert ki["realized_terminal_day"] == "2026-03-08"
    assert ki["realized_terminal_usd"] == pytest.approx(1071.0, abs=1e-9)
    assert ki["marks_since"] == "2026-03-06"


@pytest.mark.asyncio
async def test_stale_mark_has_no_residual_step() -> None:
    """MARKSOURCE plan 03, the carried residual (NAVMTM D-05: no row, the next mark covers it).
    Marks 03-06 (1050.0) and 03-08 (1071.0); the derive at 00:10Z on 03-11 reads equity 1215.0 with
    an open profit of 215.0 it cannot read, so 03-10 stores no mark. Through the real compose, the
    drawn curve ends on the 03-08 stored mark, 1071.0, and has no level dated after it: the 144.0
    between that mark and the live read (1215.0 - 1071.0) is not booked as a step on 03-08."""
    db = KeyDb()
    seed_okx_marks(db, {"2026-03-06": 1050.0, "2026-03-08": 1071.0})
    result, capture = await derive_key_ccxt(
        db, returns=series(REALIZED_THROUGH_0305), now=at_0010("2026-03-11"), equity=1215.0,
        upl=215.0, flows=[], upnl_unreadable=True,
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    curve = levels(await compose_curve(db, capture))
    assert curve["2026-03-06"] == pytest.approx(1050.0, rel=1e-9)
    assert curve["2026-03-08"] == pytest.approx(1071.0, abs=1e-9), "no live step on the mark day"
    assert max(curve) == "2026-03-08", f"a level after the last mark: {sorted(curve)[-3:]}"


@pytest.mark.asyncio
async def test_stored_mark_anchor_is_no_empty_poll_proof(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Info 2 / T-167.2.1.1.1-57. A key_inputs row from the W7 case (a positive stored anchor
    read at 00:10Z of D+1) beside a clean, empty holdings poll at 04:03Z of D+1 is neither a
    proof of an empty account nor a contradiction: ``_polled_empty_since`` returns False and logs
    no contradiction warning. Stamped with the derive's wall clock instead, the same payload reads
    as a live read taken AFTER the empty poll and logs the false contradiction."""
    from services.equity_reconstruction import _polled_empty_since
    from tests.test_equity_reconstruction import ALLOCATOR_ID, FakeSupabaseClient
    from tests.test_refresh_allocator_equity_carry_forward import _at, _seed_poll_outcome

    db = KeyDb()
    seed_okx_marks(db)
    _result, capture = await derive_okx(db)
    payload = _key_inputs_payload(capture, KEY)
    assert payload["anchor_usd"] is not None

    last_day = date(2026, 3, 10)
    fake = FakeSupabaseClient()
    fake.store[("allocator_equity_derived", (ALLOCATOR_ID, f"key_inputs:{KEY}"))] = {
        "allocator_id": ALLOCATOR_ID, "kind": f"key_inputs:{KEY}", "payload": payload,
        "computed_at": payload["anchor_asof"],
    }
    _seed_poll_outcome(fake, KEY, _at(last_day + timedelta(days=1), hour=4))
    caplog.set_level(logging.INFO)
    proven = await _polled_empty_since(
        fake, ALLOCATOR_ID, [{"id": KEY, "exchange": "okx"}], last_day.isoformat()
    )
    assert proven is False
    assert not [
        r for r in caplog.records
        if r.levelno == logging.WARNING and "contradict" in r.getMessage()
    ]


# --------------------------------------------------------------------------------------
# Task 2 - every other venue in key mode: writer basis, held-out flows, the race loser
# --------------------------------------------------------------------------------------
#
# One scenario per venue, all of the same shape: a realized history that ends before the first
# mark, marks with ONE UNMARKED GAP DAY between them and ONE DEPOSIT ON THE GAP DAY (it sits in the
# base of the return that spans it, plan 03 rule 5). Each asserts what the OKX test asserts: the
# persisted returns, then the real compose over what the derive persisted reproduces every stored
# mark to 1e-9 relative, the deposit day carries the stepped level, no blocking degrade, and the
# days before the first mark are the levels the same derive gives with no marks.


def assert_levels(curve: dict[str, float], expected: dict[str, float]) -> None:
    for day, level in expected.items():
        assert curve[day] == pytest.approx(level, rel=1e-9), f"the compose level on {day}"


def assert_trustworthy(payload: dict[str, Any]) -> None:
    assert payload["degrade_reasons"] == []
    assert payload["is_trustworthy"] is True


def assert_same_before(a: dict[str, float], b: dict[str, float], first_mark: str) -> None:
    """The levels before the first mark are those of the no-marks compose (L1)."""
    before = {d: v for d, v in a.items() if d < first_mark}
    assert before, "no pre-start level to compare"
    assert {d: v for d, v in b.items() if d < first_mark} == pytest.approx(before, rel=1e-9)


# ---- Bybit ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_bybit_key_mode_compose_reproduces_every_mark() -> None:
    """Bybit. The derive's own wallet read is 1000.0 with a structural wedge of 0.0, so the
    realized terminal is the USDT wallet, 1000.0 on 03-05, the same literals as the OKX case. The
    live wallet (1000.0) is not the anchor: the stored 03-10 mark is. The label day's mark is
    stored, so the derive makes no marked-equity read (W3)."""
    db = KeyDb()
    seed_okx_marks(db, venue="bybit")
    result, capture = await derive_key_ccxt(
        db, returns=series(REALIZED_THROUGH_0305), now=at_0010("2026-03-11"), equity=1000.0,
        upl=0.0, venue="bybit", flows=okx_flows(),
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    rows = db.rows()
    assert {d: v for d, v in rows.items() if d < "2026-03-06"} == REALIZED_THROUGH_0305
    assert rows["2026-03-06"] == pytest.approx(0.05, abs=1e-12)
    assert rows["2026-03-07"] == pytest.approx(0.02, abs=1e-12)
    assert rows["2026-03-10"] == pytest.approx(23.42 / 1171.0, abs=1e-12)
    ki = _key_inputs_payload(capture, KEY)
    assert ki["anchor_usd"] == pytest.approx(1194.42, abs=1e-9)
    assert (ki["realized_terminal_day"], ki["realized_terminal_usd"]) == ("2026-03-10", 1194.42)
    payload = await compose_curve(db, capture, venue="bybit")
    curve = levels(payload)
    assert_levels(curve, OKX_MARKS)
    assert curve["2026-03-08"] == pytest.approx(1071.0 + OKX_FLOW, rel=1e-9)
    assert_levels(curve, realized_levels(REALIZED_THROUGH_0305, "2026-03-05", OKX_TERMINAL, {}))
    assert_trustworthy(payload)


# ---- sFOX ----------------------------------------------------------------------------

KEY_SFOX = "key-sfox"
#: The observed NAV 02-27 .. 03-05 and a 50 deposit on 03-04 (the gap day). The realized terminal is
#: the last observed usd_value (1110) on 03-05, so rolling the realized returns back
#: (r(03-05) = 10/1100, r(03-04) = (1100 - 1040 - 50)/1040, r(03-03) = 10/1030) gives
#: L(03-02) = 1030. Marks 03-03 (1045) and 03-05 (1110): r(03-03) = (1045 - 1030) / 1030 and, with
#: the gap day's deposit in the base, r(03-05) = (1110 - (1045 + 50)) / (1045 + 50) = 15 / 1095.
SFOX_NAV = (("2026-02-27", "1000"), ("2026-02-28", "1010"), ("2026-03-01", "1020"),
            ("2026-03-02", "1030"), ("2026-03-03", "1040"), ("2026-03-04", "1100"),
            ("2026-03-05", "1110"))
SFOX_MARKS = {"2026-03-03": 1045.0, "2026-03-05": 1110.0}
SFOX_WALLET = {"2026-03-03": 1040.0, "2026-03-05": 1110.0}


async def derive_sfox_key(
    monkeypatch: pytest.MonkeyPatch, db: KeyDb, *, apply_nothing: bool = False,
) -> tuple[Any, dict[str, Any]]:
    from tests.test_sfox_reconstruct import _apply as _sfox_apply
    from tests.test_sfox_reconstruct import _bh_row, _ms, _sfox_branch_patches

    monkeypatch.setenv("SFOX_ENABLED", "true")
    ctx, capture = _build_ctx(
        key_row={"id": KEY_SFOX, "exchange": "sfox", "user_id": USER}, strategy_row=None
    )
    route_key_csv(route_marks(ctx, db), db)
    if not apply_nothing:
        for day, nav in SFOX_MARKS.items():
            # The first mark's wallet is the observed NAV on its own day (1040 on 03-03).
            seed_mark(db, day, nav, key=KEY_SFOX, venue="sfox", open_pnl=nav - SFOX_WALLET[day])
    nav_rows = [_bh_row(d, v) for d, v in SFOX_NAV]
    txns = [{"id": 1, "action": "deposit", "currency": "USD", "amount": "50",
             "timestamp": _ms("2026-03-04") + 12 * 3_600_000}]  # noon: after the 00:10Z read of the 03-03 mark
    patches = _sfox_branch_patches(ctx, bh_return=nav_rows, txn_return=txns, key_mode=True) + [
        patch("services.job_worker._utc_now", new=MagicMock(return_value=at_0010("2026-03-06"))),
        *([patch("services.job_worker.read_key_marks", new=MagicMock(return_value=[]))]
          if apply_nothing else []),
    ]
    with _sfox_apply(patches):
        result = await run_derive_broker_dailies_job(
            {"id": "j-sfox", "kind": "derive_broker_dailies", "api_key_id": KEY_SFOX}
        )
    return result, capture


@pytest.mark.asyncio
async def test_sfox_key_mode_compose_reproduces_every_mark(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """sFOX: the NAV is the observed usd_value series, there is no open profit, and the terminal
    is its last point. The marks and the gap-day deposit are the scenario's."""
    db = KeyDb()
    result, capture = await derive_sfox_key(monkeypatch, db)
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    rows = db.rows(KEY_SFOX)
    assert rows["2026-03-03"] == pytest.approx(15.0 / 1030.0, abs=1e-12)
    assert rows["2026-03-05"] == pytest.approx(15.0 / 1095.0, abs=1e-12)
    assert "2026-03-04" not in rows
    ki = _key_inputs_payload(capture, KEY_SFOX)
    assert ki["marks_since"] == "2026-03-03" and ki["mark_gap_days"] == ["2026-03-04"]
    assert (ki["realized_terminal_day"], ki["realized_terminal_usd"]) == ("2026-03-05", 1110.0)
    assert ki["anchor_usd"] == pytest.approx(1110.0, abs=1e-9)
    payload = await compose_curve(db, capture, key=KEY_SFOX, venue="sfox")
    curve = levels(payload)
    assert_levels(curve, {**SFOX_MARKS, "2026-03-04": 1045.0 + 50.0})
    base_db = KeyDb()
    _r, base_cap = await derive_sfox_key(monkeypatch, base_db, apply_nothing=True)
    assert_same_before(
        curve, levels(await compose_curve(base_db, base_cap, key=KEY_SFOX, venue="sfox")),
        "2026-03-03",
    )
    assert_trustworthy(payload)


# ---- MT5, USD and BTC units ------------------------------------------------------------

KEY_MT5 = "key-mt5"


def _mt5_deals_with(
    deposits: dict[tuple[int, int, int], float], scale: float = 1.0
) -> list[dict[str, Any]]:
    from tests.test_mt5_derive_branch import _canonical_deals, _epoch, _scaled_deals

    deals = list(_scaled_deals(scale) if scale != 1.0 else _canonical_deals())
    for day, amount in deposits.items():
        deals.append({
            "type": 2, "profit": amount, "swap": 0.0, "commission": 0.0, "fee": 0.0,
            "time": _epoch(*day),
        })
    return deals


async def derive_mt5_key(
    monkeypatch: pytest.MonkeyPatch, db: KeyDb, *, account: dict[str, Any],
    deals: list[dict[str, Any]], closes: pd.Series | None = None, apply_nothing: bool = False,
    now: datetime | None = None,
) -> tuple[Any, dict[str, Any]]:
    from tests.test_mt5_derive_branch import _FROZEN_NOW, _FakeMt5Transport
    from tests.test_mt5_derive_branch import _build_ctx as _mt5_build_ctx

    monkeypatch.setenv("MT5_ENABLED", "true")
    transport = _FakeMt5Transport(account=dict(account), deals=[dict(d) for d in deals])
    ctx, capture = _mt5_build_ctx(transport, asset_class="traditional")
    ctx.strategy_row = None
    route_key_csv(route_marks(ctx, db), db)
    patches = [
        patch("services.job_worker._allocator_key_preflight", new=AsyncMock(return_value=ctx)),
        patch("services.job_worker.aclose_exchange", new=AsyncMock()),
        patch("services.job_worker.db_execute", new=AsyncMock(side_effect=lambda fn: fn())),
        patch("services.benchmark.read_btc_closes", new=AsyncMock(return_value=closes)),
        patch("services.job_worker._utc_now", new=lambda: now or _FROZEN_NOW),
        *([patch("services.job_worker.read_key_marks", new=MagicMock(return_value=[]))]
          if apply_nothing else []),
    ]
    with ExitStack() as stack:
        for p in patches:
            stack.enter_context(p)
        result = await run_derive_broker_dailies_job(
            {"id": "j-mt5-key", "kind": "derive_broker_dailies", "api_key_id": KEY_MT5}
        )
    return result, capture


#: USD account: balance 110_500 / equity 110_600 (100 open). Deposit 5000 on the gap day 10-07.
#: Marks 10-06 (105_550) and 10-08 (110_600): L(10-05) = 110_500 - 5000 = 105_500, so
#:   r(10-06) = (105_550 - 105_500) / 105_500                  = 50 / 105_500
#:   r(10-08) = (110_600 - (105_550 + 5000)) / (105_550 + 5000) = 50 / 110_550
MT5_MARKS = {"2026-10-06": 105_550.0, "2026-10-08": 110_600.0}
MT5_ACCOUNT = {"equity": 110_600.0, "balance": 110_500.0, "currency": "USD", "login": 123456}


def seed_mt5_marks(db: KeyDb) -> None:
    for day, nav in MT5_MARKS.items():
        seed_mark(db, day, nav, key=KEY_MT5, venue="mt5", open_pnl=nav - 105_500.0,
                  native_unit="USD")


@pytest.mark.asyncio
async def test_mt5_usd_key_mode_compose_reproduces_every_mark(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """MT5, USD unit, writer basis. The realized terminal is the BALANCE (110_500) on the last
    ledger day 10-07, not the equity. The writer basis the row stores is the deal ledger's day P&L
    before the first mark joined with the marks' own level identity after it (50 on 10-06, 0 on the
    deposit day, 50 on 10-08), and the composed flows are the 5000 deposit. The compose rolls on it
    from the 10-08 mark."""
    db = KeyDb()
    seed_mt5_marks(db)
    deals = _mt5_deals_with({(2026, 10, 7): 5000.0})
    result, capture = await derive_mt5_key(monkeypatch, db, account=MT5_ACCOUNT, deals=deals)
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    rows = db.rows(KEY_MT5)
    assert rows["2026-10-06"] == pytest.approx(50.0 / 105_500.0, abs=1e-12)
    assert rows["2026-10-08"] == pytest.approx(50.0 / 110_550.0, abs=1e-12)
    assert "2026-10-07" not in rows
    ki = _key_inputs_payload(capture, KEY_MT5)
    assert (ki["realized_terminal_day"], ki["realized_terminal_usd"]) == ("2026-10-08", 110_600.0)
    pnl = {r["utc_day_iso"]: r["pnl_usd"] for r in ki["composed_day_pnl"]}
    # After the start the writer P&L is the marks' level identity, never a realized value.
    assert {d: v for d, v in pnl.items() if d >= "2026-10-06"} == pytest.approx({
        "2026-10-06": 50.0, "2026-10-07": 0.0, "2026-10-08": 50.0,
    })
    # The canonical ledger's own 10_000 deposit (2025-06-04) and the gap-day 5000.
    assert ki["composed_flows"] == [
        {"utc_day_iso": "2025-06-04", "flow_usd": 10_000.0},
        {"utc_day_iso": "2026-10-07", "flow_usd": 5000.0},
    ]
    payload = await compose_curve(db, capture, key=KEY_MT5, venue="mt5")
    curve = levels(payload)
    assert_levels(curve, {**MT5_MARKS, "2026-10-07": 105_550.0 + 5000.0, "2026-10-05": 105_500.0})
    assert "writer_basis_mismatch" not in payload["flags"]
    base_db = KeyDb()
    _r, base_cap = await derive_mt5_key(
        monkeypatch, base_db, account=MT5_ACCOUNT, deals=deals, apply_nothing=True
    )
    assert_same_before(
        curve, levels(await compose_curve(base_db, base_cap, key=KEY_MT5, venue="mt5")),
        "2026-10-06",
    )
    assert_trustworthy(payload)


@pytest.mark.asyncio
async def test_read_day_flow_is_held_out(monkeypatch: pytest.MonkeyPatch) -> None:
    """A deposit dated the day after the last mark (the read day, 10-09) and made at noon, AFTER the
    10-08 mark's 00:10Z read, is in no base and no numerator: it is absent from the stored flows
    and the writer's composed flows. The next derive places it. The account is the same as above
    plus that 2000 deposit (balance 112_500), so the base is unchanged:
    L(10-05) = 112_500 - 2000 - 5000 = 105_500."""
    db = KeyDb()
    seed_mt5_marks(db)
    deals = _mt5_deals_with({(2026, 10, 7): 5000.0, (2026, 10, 9): 2000.0})
    account = {**MT5_ACCOUNT, "balance": 112_500.0}
    result, capture = await derive_mt5_key(monkeypatch, db, account=account, deals=deals)
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    ki = _key_inputs_payload(capture, KEY_MT5)
    assert [f["utc_day_iso"] for f in ki["flows"]] == ["2025-06-04", "2026-10-07"]
    assert [f["utc_day_iso"] for f in ki["composed_flows"]] == ["2025-06-04", "2026-10-07"]
    assert "2026-10-09" not in {r["utc_day_iso"] for r in ki["composed_day_pnl"]}
    assert (ki["realized_terminal_day"], ki["realized_terminal_usd"]) == ("2026-10-08", 110_600.0)
    rows = db.rows(KEY_MT5)
    assert rows["2026-10-06"] == pytest.approx(50.0 / 105_500.0, abs=1e-12)
    assert rows["2026-10-08"] == pytest.approx(50.0 / 110_550.0, abs=1e-12)
    payload = await compose_curve(db, capture, key=KEY_MT5, venue="mt5")
    assert_levels(levels(payload), MT5_MARKS)
    assert_trustworthy(payload)


@pytest.mark.asyncio
async def test_a_deposit_made_before_the_read_is_counted_in_the_mark_day_in_key_mode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-23, MT5 key mode end to end. The same 2000 deposit, dated 10-09 but made at 00:00Z, ten
    minutes BEFORE the 10-08 mark's 00:10Z read, is inside that mark: NAV 112_600 (wallet 112_500).
    The mark's return is (112_600 - 110_550 - 2000) / 110_550 = 50 / 110_550, the deposit is
    stored on 10-08 (not 10-09), and the compose rolls every level back exactly, so it is not
    booked as profit on 10-08 and as a loss on 10-09."""
    db = KeyDb()
    seed_mark(db, "2026-10-06", 105_550.0, key=KEY_MT5, venue="mt5", open_pnl=50.0, native_unit="USD")
    seed_mark(db, "2026-10-08", 112_600.0, key=KEY_MT5, venue="mt5", open_pnl=100.0, native_unit="USD")
    deals = _mt5_deals_with({(2026, 10, 7): 5000.0, (2026, 10, 9, 0): 2000.0})
    account = {**MT5_ACCOUNT, "equity": 112_600.0, "balance": 112_500.0}
    result, capture = await derive_mt5_key(monkeypatch, db, account=account, deals=deals)
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    ki = _key_inputs_payload(capture, KEY_MT5)
    assert [f["utc_day_iso"] for f in ki["composed_flows"]] == [
        "2025-06-04", "2026-10-07", "2026-10-08"
    ]
    assert [f["flow_usd"] for f in ki["composed_flows"]][-1] == pytest.approx(2000.0)
    rows = db.rows(KEY_MT5)
    assert rows["2026-10-06"] == pytest.approx(50.0 / 105_500.0, abs=1e-12)
    assert rows["2026-10-08"] == pytest.approx(50.0 / 110_550.0, abs=1e-12)
    payload = await compose_curve(db, capture, key=KEY_MT5, venue="mt5")
    assert_levels(levels(payload), {"2026-10-06": 105_550.0, "2026-10-08": 112_600.0})
    assert_trustworthy(payload)


#: BTC account at a constant close of 60_000 USD, every ledger amount a millionth of the USD
#: ledger's: balance 0.1105 / equity 0.1115 BTC, a deposit of 0.002 BTC on 10-06 (the gap day),
#: marks 10-05 (0.1090 BTC) and 10-08 (0.1115 BTC). L(10-04) = 0.1105 - 0.002 = 0.1085 BTC, so with
#: the price constant every dollar figure is the BTC one times 60_000:
#:   r(10-05) = 0.0005 / 0.1085 and r(10-08) = (0.1115 - (0.1090 + 0.002)) / (0.1090 + 0.002).
BTC_CLOSE = 60_000.0
BTC_MARKS_NATIVE = {"2026-10-05": 0.1090, "2026-10-08": 0.1115}
#: Each mark's wallet in BTC. The first one, 0.1085, is the base its return is measured against.
BTC_WALLET_NATIVE = {"2026-10-05": 0.1085, "2026-10-08": 0.1105}


def btc_closes() -> pd.Series:
    idx = pd.date_range("2025-06-01", "2026-10-08", freq="D")
    return pd.Series(BTC_CLOSE, index=idx, dtype="float64")


@pytest.mark.asyncio
async def test_mt5_btc_key_mode_compose_reproduces_every_mark(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """MT5, BTC unit, converted to dollars at the stored daily closes before anything is stored.
    The marks apply in USD (``nav_usd``, priced when the mark was written), the writer basis is
    the USD level identity, and the key is priced through the last mark."""
    db = KeyDb()
    for day, native in BTC_MARKS_NATIVE.items():
        seed_mark(
            db, day, native * BTC_CLOSE, key=KEY_MT5, venue="mt5",
            open_pnl=(native - BTC_WALLET_NATIVE[day]) * BTC_CLOSE,
            native_unit="BTC", nav_native=native,
            open_pnl_native=native - BTC_WALLET_NATIVE[day],
        )
    deals = _mt5_deals_with({(2026, 10, 6): 0.002}, scale=1e-6)
    account = {"equity": 0.1115, "balance": 0.1105, "currency": "BTC", "login": 123456}
    result, capture = await derive_mt5_key(
        monkeypatch, db, account=account, deals=deals, closes=btc_closes()
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    rows = db.rows(KEY_MT5)
    assert rows["2026-10-05"] == pytest.approx(0.0005 / 0.1085, abs=1e-9)
    assert rows["2026-10-08"] == pytest.approx(0.0005 / 0.1110, abs=1e-9)
    assert not {"2026-10-06", "2026-10-07"} & set(rows)
    ki = _key_inputs_payload(capture, KEY_MT5)
    assert ki["native_unit"] == "BTC" and ki["priced_through"] == "2026-10-08"
    assert ki["realized_terminal_day"] == "2026-10-08"
    assert ki["realized_terminal_usd"] == pytest.approx(0.1115 * BTC_CLOSE, rel=1e-9)
    payload = await compose_curve(db, capture, key=KEY_MT5, venue="mt5")
    expected = {d: n * BTC_CLOSE for d, n in BTC_MARKS_NATIVE.items()}
    assert_levels(levels(payload), {
        **expected, "2026-10-06": (0.1090 + 0.002) * BTC_CLOSE,
        "2026-10-04": 0.1085 * BTC_CLOSE,
    })
    base_db = KeyDb()
    _r, base_cap = await derive_mt5_key(
        monkeypatch, base_db, account=account, deals=deals, closes=btc_closes(),
        apply_nothing=True,
    )
    assert_same_before(
        levels(payload), levels(await compose_curve(base_db, base_cap, key=KEY_MT5, venue="mt5")),
        "2026-10-05",
    )
    assert_trustworthy(payload)


@pytest.mark.asyncio
async def test_mt5_btc_key_deposit_made_before_the_read_is_priced_and_counted_in_the_mark_day(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-23, MT5 in BTC, converted to dollars at the stored close of the flow's own day. The same
    0.002 BTC deposit, dated 10-06 and made at 00:00Z before the 00:10Z read of the 10-05 mark, is
    inside that mark (0.1110 BTC, wallet 0.1105). Both returns equal the deposit-after-the-read
    case, 0.0005 / 0.1085 and 0.0005 / 0.1110, the deposit is stored on 10-05 at 0.002 x 60_000
    dollars, and the compose lands on both marks."""
    marks_native = {"2026-10-05": 0.1110, "2026-10-08": 0.1115}
    wallet_native = {"2026-10-05": 0.1105, "2026-10-08": 0.1105}
    db = KeyDb()
    for day, native in marks_native.items():
        seed_mark(
            db, day, native * BTC_CLOSE, key=KEY_MT5, venue="mt5",
            open_pnl=(native - wallet_native[day]) * BTC_CLOSE,
            native_unit="BTC", nav_native=native, open_pnl_native=native - wallet_native[day],
        )
    deals = _mt5_deals_with({(2026, 10, 6, 0): 0.002}, scale=1e-6)
    account = {"equity": 0.1115, "balance": 0.1105, "currency": "BTC", "login": 123456}
    result, capture = await derive_mt5_key(
        monkeypatch, db, account=account, deals=deals, closes=btc_closes()
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    rows = db.rows(KEY_MT5)
    assert rows["2026-10-05"] == pytest.approx(0.0005 / 0.1085, abs=1e-9)
    assert rows["2026-10-08"] == pytest.approx(0.0005 / 0.1110, abs=1e-9)
    ki = _key_inputs_payload(capture, KEY_MT5)
    stored = {f["utc_day_iso"]: f["flow_usd"] for f in ki["composed_flows"]}
    assert stored["2026-10-05"] == pytest.approx(0.002 * BTC_CLOSE, rel=1e-9)
    assert "2026-10-06" not in stored or stored["2026-10-06"] == pytest.approx(0.0, abs=1e-6)
    payload = await compose_curve(db, capture, key=KEY_MT5, venue="mt5")
    assert_levels(levels(payload), {d: n * BTC_CLOSE for d, n in marks_native.items()})
    assert_trustworthy(payload)


def stepped_btc_closes(through: str) -> pd.Series:
    """BTC closes of 60_000.0 through 10-05 and 66_000.0 from 10-06 on, stored through ``through``.
    The mark day 10-05 and the day after it have different closes, which ``btc_closes`` (constant)
    hides: a flow priced at the wrong one of the two leaves a residue in the mark day's return."""
    idx = pd.date_range("2025-06-01", through, freq="D")
    return pd.Series(
        [60_000.0 if ts <= pd.Timestamp("2026-10-05") else 66_000.0 for ts in idx],
        index=idx, dtype="float64",
    )


@pytest.mark.asyncio
async def test_moved_btc_flow_priced_at_the_mark_day_close(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """MARKSOURCE plan 03, REVIEW-3 IN-02 (D-02: one rule for a moved flow). A 0.002 BTC deposit
    made at 00:00Z on 10-06, before the 00:10Z read of mark 10-05, is inside that mark's wallet.
    The mark itself is priced at close(10-05) = 60_000, so the deposit counted in 10-05 is
      0.002 x 60_000 = 120.0 USD        (the old code: 0.002 x close(10-06) = 0.002 x 66_000 = 132.0)
    and the base the mark's return is measured against is
      wallet 0.1105 x 60_000 = 6630.0, less 120.0 = 6510.0
      r(10-05) = (6660.0 - 6510.0 - 120.0) / 6510.0 = 30.0 / 6510.0 = 0.0005 / 0.1085
    (the old 132.0 leaves 12.0 of price residue: 30.0 / 6498.0). The flow the day aggregate stores
    on 10-06 is its own-day value, 132.0, and that is what leaves 10-06, so 10-06 nets to 0.0 and
    mark 10-08 (7359.0 = 0.1115 x 66_000) returns (7359.0 - 6660.0) / 6660.0 = 699.0 / 6660.0."""
    marks_native = {"2026-10-05": (0.1110, 60_000.0), "2026-10-08": (0.1115, 66_000.0)}
    wallet_native = {"2026-10-05": 0.1105, "2026-10-08": 0.1105}
    db = KeyDb()
    for day, (native, close) in marks_native.items():
        seed_mark(
            db, day, native * close, key=KEY_MT5, venue="mt5",
            open_pnl=(native - wallet_native[day]) * close,
            native_unit="BTC", nav_native=native, open_pnl_native=native - wallet_native[day],
        )
    deals = _mt5_deals_with({(2026, 10, 6, 0): 0.002}, scale=1e-6)
    account = {"equity": 0.1115, "balance": 0.1105, "currency": "BTC", "login": 123456}
    result, capture = await derive_mt5_key(
        monkeypatch, db, account=account, deals=deals, closes=stepped_btc_closes("2026-10-08")
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    rows = db.rows(KEY_MT5)
    assert rows["2026-10-05"] == pytest.approx(30.0 / 6510.0, abs=1e-9)
    assert rows["2026-10-08"] == pytest.approx(699.0 / 6660.0, abs=1e-9)
    ki = _key_inputs_payload(capture, KEY_MT5)
    stored = {f["utc_day_iso"]: f["flow_usd"] for f in ki["composed_flows"]}
    assert stored["2026-10-05"] == pytest.approx(120.0, abs=1e-6)
    assert stored.get("2026-10-06", 0.0) == pytest.approx(0.0, abs=1e-6)
    payload = await compose_curve(db, capture, key=KEY_MT5, venue="mt5")
    curve = levels(payload)
    assert curve["2026-10-05"] == pytest.approx(6660.0, rel=1e-9)
    assert curve["2026-10-08"] == pytest.approx(7359.0, rel=1e-9)
    assert_trustworthy(payload)


@pytest.mark.asyncio
async def test_moved_btc_flow_kept_before_its_own_close_lands(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """MARKSOURCE plan 03, REVIEW-3 IN-02. The same 0.002 BTC deposit, made at 00:00Z on 10-06,
    and a derive at 00:10:30Z on 10-06, when the closes are stored through 10-05 only. Marks 10-04
    (0.1085 BTC, flat) and 10-05 (0.1110 BTC, wallet 0.1105 BTC that already holds the deposit).
    The deposit has no own-day close yet, so no stored flow carries it; it is still inside mark
    10-05, valued at close(10-05) = 60_000: 0.002 x 60_000 = 120.0 USD.
      r(10-05) = (6660.0 - 6510.0 - 120.0) / 6510.0 = 30.0 / 6510.0
    Dropped (the old code), the deposit is read as profit: (6660.0 - 6510.0) / 6510.0 = 150.0 / 6510.0.
    Nothing leaves 10-06, because nothing was stored there."""
    marks_native = {"2026-10-04": (0.1085, 0.1085), "2026-10-05": (0.1110, 0.1105)}
    db = KeyDb()
    for day, (native, wallet) in marks_native.items():
        seed_mark(
            db, day, native * 60_000.0, key=KEY_MT5, venue="mt5",
            open_pnl=(native - wallet) * 60_000.0,
            native_unit="BTC", nav_native=native, open_pnl_native=native - wallet,
        )
    deals = _mt5_deals_with({(2026, 10, 6, 0): 0.002}, scale=1e-6)
    account = {"equity": 0.1110, "balance": 0.1105, "currency": "BTC", "login": 123456}
    result, capture = await derive_mt5_key(
        monkeypatch, db, account=account, deals=deals, closes=stepped_btc_closes("2026-10-05"),
        now=datetime(2026, 10, 6, 0, 10, 30, tzinfo=timezone.utc),
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    rows = db.rows(KEY_MT5)
    assert rows["2026-10-05"] == pytest.approx(30.0 / 6510.0, abs=1e-9)
    ki = _key_inputs_payload(capture, KEY_MT5)
    stored = {f["utc_day_iso"]: f["flow_usd"] for f in ki["composed_flows"]}
    assert stored["2026-10-05"] == pytest.approx(120.0, abs=1e-6)
    assert stored.get("2026-10-06", 0.0) == pytest.approx(0.0, abs=1e-6)


# ---- Deribit ---------------------------------------------------------------------------

KEY_DRB = "key-drb"


def realized_day_pnl(
    returns: dict[str, float], terminal_day: str, terminal: float,
) -> dict[str, float]:
    """The writer's own P&L per NAV day, ``P_d = L(d) - L(d-1)`` with no flow in the realized
    span, off this module's own roll of the realized series (the oracle)."""
    lv = realized_levels(returns, terminal_day, terminal, {})
    first = min(returns)
    out = {first: lv[first] - lv[first] / (1.0 + returns[first])}
    days = sorted(lv)
    for prev, day in zip(days, days[1:]):
        out[day] = lv[day] - lv[prev]
    return out


class _ScriptedChart:
    """A scripted stand-in for ``exchange.public_get_get_tradingview_chart_data``. It records every
    params dict, appends ``"chart"`` to ``events`` (the derive's close stand-in appends ``"close"``
    to the same list, so a test can order a read against the exchange close), and answers the
    scripted items in order: an exception instance is raised, anything else is returned. A call
    past the script fails the test loudly (a bare ``AsyncMock`` exchange would otherwise sit in the
    reader's real 1+2+...+128 s backoff)."""

    def __init__(self, script: list[Any]) -> None:
        self.events: list[str] = []
        self.script = list(script)
        self.calls: list[dict[str, Any]] = []

    async def __call__(self, params: dict[str, Any]) -> Any:
        self.events.append("chart")
        self.calls.append(dict(params))
        if not self.script:
            raise AssertionError("unscripted get_tradingview_chart_data call")
        item = self.script.pop(0)
        if isinstance(item, BaseException):
            raise item
        return item


async def derive_deribit_key(
    db: KeyDb, *, collapsed_equity: float, collapsed_upnl: float, now: datetime,
    apply_nothing: bool = False, returns: pd.Series | None = None,
    composed_flows: dict[str, float] | None = None, instants: tuple[FlowInstant, ...] = (),
    ledger_marks: dict[str, pd.Series] | None = None, chart: _ScriptedChart | None = None,
    flow_prices: FlowPricesTable | None = None, store_db_execute: Any = None,
) -> tuple[Any, dict[str, Any]]:
    """Deribit key-mode derive on the NAV path. The ledger quantities (realized terminal 1000.0
    on 03-05, the day P&L, a +100 composed flow on the gap day) are what the ledger helpers return;
    the day P&L is this module's own, rolled from the terminal, so the writer basis is coherent.

    ``ledger_marks`` (the stub ledger's per-currency day marks) is needed for any non-USD-family
    instant, which ``native_flow_instants`` values at its own-day mark. ``chart`` is the scripted
    ``get_tradingview_chart_data``; when given, the derive's exchange close is also recorded in
    ``chart.events`` as ``"close"``.

    ``store_db_execute`` replaces the inline ``db_execute`` the store reads go through (a test that
    needs a store read that hangs awaits there; a blocking sync stub cannot be cancelled).

    ``flow_prices`` is the in-memory ``api_key_flow_prices`` (Phase 177 plan 03). The store is
    ALWAYS routed (the given table, else a fresh one): a derive that reaches it through the
    harness's MagicMock would read nothing and then fail "no row after an insert"."""
    from dataclasses import replace

    from services.deribit_ingest import DeribitNativeAccountState
    from tests.test_mtm_single_key import _apply as _drb_apply
    from tests.test_mtm_single_key import (
        _base_patches,
        _ctx,
        _ledger_meta,
        _report,
        _stub_native_ledger,
    )

    ctx, capture = _ctx(strategy_row=None, key_mode=True)
    ctx.key_row = {"id": KEY_DRB, "user_id": USER, "exchange": "deribit"}
    if chart is not None:
        ctx.exchange.public_get_get_tradingview_chart_data = chart
    route_flow_prices(
        route_key_csv(route_marks(ctx, db), db), flow_prices if flow_prices is not None else FlowPricesTable()
    )
    state = DeribitNativeAccountState(
        native_equity={"BTC": 0.02}, native_upnl={"BTC": 0.001},
        collapsed_equity_usd=collapsed_equity, collapsed_upnl_usd=collapsed_upnl,
        balance_error=False, upnl_unreadable=False, native_options_value={},
        # D-21: the mark's open profit is NAV minus wallet at the read's own index, so the read
        # carries a balance and an index (this is not an input to the nav the mark stores).
        native_balance={"BTC": 0.0188}, index_usd_snapshot={"BTC": 100000.0},
    )
    pnl = realized_day_pnl(REALIZED_THROUGH_0305, "2026-03-05", OKX_TERMINAL)
    patches = _base_patches(
        ctx, key_mode=True,
        ledger_mock=AsyncMock(
            return_value=(
                replace(
                    _stub_native_ledger(), flow_instants=instants,
                    **({"marks": ledger_marks} if ledger_marks is not None else {}),
                ),
                _report(has_option_activity=False),
            )
        ),
        combine_mock=MagicMock(return_value=(
            series(REALIZED_THROUGH_0305) if returns is None else returns, _ledger_meta(),
        )),
        state_spy=AsyncMock(return_value=state),
    ) + [
        patch("services.job_worker._utc_now", new=MagicMock(return_value=now)),
        patch(
            "services.broker_dailies.native_ledger_realized_terminal",
            new=MagicMock(return_value=(pd.Timestamp("2026-03-05"), OKX_TERMINAL)),
        ),
        patch(
            "services.broker_dailies.native_ledger_day_pnl",
            new=MagicMock(return_value=series(pnl)),
        ),
        patch(
            "services.broker_dailies.native_ledger_composed_flows",
            new=MagicMock(return_value=series(
                composed_flows if composed_flows is not None else {OKX_FLOW_DAY: OKX_FLOW}
            )),
        ),
        *([patch("services.job_worker.read_key_marks", new=MagicMock(return_value=[]))]
          if apply_nothing else []),
        # The store calls run in order on the test thread, like the stand-in _base_patches
        # gives services.job_worker.db_execute.
        patch(
            "services.deribit_flow_prices.db_execute",
            new=store_db_execute or AsyncMock(side_effect=lambda fn: fn()),
        ),
        # Placed AFTER the base patches so it replaces their no-op close: the close is recorded in
        # the chart's own event list, which orders a read against the close (a mocked close would
        # otherwise hide a read made on a closed exchange).
        *([patch(
            "services.job_worker.aclose_exchange",
            new=AsyncMock(side_effect=lambda _ex: chart.events.append("close")),
        )] if chart is not None else []),
    ]
    with _drb_apply(patches):
        result = await run_derive_broker_dailies_job(
            {"id": "j-drb", "kind": "derive_broker_dailies", "api_key_id": KEY_DRB}
        )
    return result, capture


def seed_deribit_marks(db: KeyDb, marks: dict[str, float] | None = None) -> None:
    for day, nav in (marks or OKX_MARKS).items():
        seed_mark(db, day, nav, key=KEY_DRB, venue="deribit", open_pnl=nav - OKX_TERMINAL,
                  native_unit=None)


@pytest.mark.asyncio
async def test_deribit_key_mode_deposit_made_before_the_read_is_counted_in_the_mark_day() -> None:
    """D-23, Deribit key mode through the ledger's own instants and the writer basis. A 50.0 USDC
    deposit dated 03-11, made at 00:05Z before the 00:10Z read of the 03-10 mark, is inside that
    mark (NAV 1244.42). The writer basis stores it on 03-10 beside the 100.0 of 03-08, the 03-10
    return is 23.42 / 1171, and the compose lands on every mark."""
    marks = {**OKX_MARKS, "2026-03-10": 1244.42}
    db = KeyDb()
    seed_deribit_marks(db, marks)
    at = int(datetime(2026, 3, 11, 0, 5, tzinfo=timezone.utc).timestamp() * 1000)
    result, capture = await derive_deribit_key(
        db, collapsed_equity=1244.42, collapsed_upnl=244.42, now=at_0010("2026-03-11"),
        composed_flows={OKX_FLOW_DAY: OKX_FLOW, "2026-03-11": 50.0},
        instants=(FlowInstant(at, "2026-03-11", 50.0, "USDC"),),
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    assert db.rows(KEY_DRB)["2026-03-10"] == pytest.approx(23.42 / 1171.0, abs=1e-12)
    ki = _key_inputs_payload(capture, KEY_DRB)
    assert [(f["utc_day_iso"], f["flow_usd"]) for f in ki["composed_flows"]] == [
        (OKX_FLOW_DAY, 100.0), ("2026-03-10", 50.0)
    ]
    payload = await compose_curve(db, capture, key=KEY_DRB, venue="deribit")
    assert_levels(levels(payload), marks)
    assert_trustworthy(payload)


@pytest.mark.asyncio
async def test_deribit_moved_btc_flow_priced_at_the_instant_price() -> None:
    """Phase 177 DERIBITFLOWS D-02 (revisited), D-03, D-04. A 0.0005 BTC deposit made at 00:05:20Z
    on 03-11, before the 00:10Z read of the 03-10 mark, is inside that mark's wallet. The ledger's
    own-day mark for 03-11 is 102_000.0 (what the day aggregate stored, so what leaves 03-11:
    0.0005 x 102_000.0 = 51.0). The deposit is COUNTED in 03-10 at the open of the 1-minute
    BTC_USDC-PERPETUAL candle that contains it, 00:05, whose open is 101_000.0 (the neighbours
    00:04 and 00:06 open at 100_900.0 and 101_100.0, so an adjacent-candle rule is distinguishable):
      counted in 03-10:  0.0005 x 101_000.0 = 50.5
      base = level(03-07) 1071.0 + flow(03-08) 100.0 = 1171.0
      r(03-10) = (1244.42 - 1171.0 - 50.5) / 1171.0 = 22.92 / 1171.0
    The old own-day pricing counts 0.0005 x 102_000.0 = 51.0 and stores 22.42 / 1171.0. What
    leaves 03-11 is the stored 51.0, so 03-11 nets to 0.0 and the compose lands on every mark.
    The candle is read while the exchange is still open (the mocked close would otherwise hide a
    read on a closed exchange)."""
    marks = {**OKX_MARKS, "2026-03-10": 1244.42}
    db = KeyDb()
    seed_deribit_marks(db, marks)
    at = int(datetime(2026, 3, 11, 0, 5, 20, tzinfo=timezone.utc).timestamp() * 1000)
    minute = int(datetime(2026, 3, 11, 0, 5, tzinfo=timezone.utc).timestamp() * 1000)
    chart = _ScriptedChart([{
        "result": {
            "status": "ok",
            "ticks": [minute - 60_000, minute, minute + 60_000],
            "open": [100_900.0, 101_000.0, 101_100.0],
        }
    }])
    result, capture = await derive_deribit_key(
        db, collapsed_equity=1244.42, collapsed_upnl=244.42, now=at_0010("2026-03-11"),
        composed_flows={OKX_FLOW_DAY: OKX_FLOW, "2026-03-11": 51.0},
        instants=(FlowInstant(at, "2026-03-11", 0.0005, "BTC"),),
        ledger_marks={"BTC": series({"2026-03-10": 100_000.0, "2026-03-11": 102_000.0})},
        chart=chart,
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    assert db.rows(KEY_DRB)["2026-03-10"] == pytest.approx(22.92 / 1171.0, abs=1e-12)
    ki = _key_inputs_payload(capture, KEY_DRB)
    stored = {f["utc_day_iso"]: f["flow_usd"] for f in ki["composed_flows"]}
    assert stored[OKX_FLOW_DAY] == pytest.approx(100.0, abs=1e-9)
    assert stored["2026-03-10"] == pytest.approx(50.5, abs=1e-9)
    assert stored.get("2026-03-11", 0.0) == pytest.approx(0.0, abs=1e-9)
    payload = await compose_curve(db, capture, key=KEY_DRB, venue="deribit")
    assert_levels(levels(payload), marks)
    assert_trustworthy(payload)
    assert len(chart.calls) == 1
    assert chart.calls[0] == {
        "instrument_name": "BTC_USDC-PERPETUAL",
        "resolution": "1",
        "start_timestamp": int(datetime(2026, 3, 11, tzinfo=timezone.utc).timestamp() * 1000),
        "end_timestamp": at + 60_000,
    }
    assert chart.events.index("chart") < chart.events.index("close")


def _ms(*args: int) -> int:
    return int(datetime(*args, tzinfo=timezone.utc).timestamp() * 1000)


def _candles(*minutes_and_opens: tuple[int, float]) -> dict[str, Any]:
    """A scripted ``get_tradingview_chart_data`` ``ok`` body from ``(minute_ms, open)`` pairs."""
    return {"result": {
        "status": "ok",
        "ticks": [m for m, _ in minutes_and_opens],
        "open": [o for _, o in minutes_and_opens],
    }}


@pytest.mark.asyncio
async def test_flow_price_store_second_derive_reads_no_chart() -> None:
    """Phase 177 DERIBITFLOWS D-05 (founder, "Refuse + store prices"): a resolved at-instant price is
    stored once and reused, so an old moved flow is never re-read. The plan 01 scenario (0.0005 BTC
    at 00:05:20Z on 03-11, candle open 101_000.0, own-day mark 102_000.0, r(03-10) = 22.92 / 1171.0)
    is derived TWICE over the same marks and the same store. The first derive reads three candles
    and stores the 00:05 one; the second has an EMPTY chart script (any call fails the test) and
    stores the same 22.92 / 1171.0 from the stored row. Every write used the write-once form."""
    marks = {**OKX_MARKS, "2026-03-10": 1244.42}
    db = KeyDb()
    seed_deribit_marks(db, marks)
    table = FlowPricesTable()
    at = _ms(2026, 3, 11, 0, 5, 20)
    minute = _ms(2026, 3, 11, 0, 5)
    kwargs: dict[str, Any] = dict(
        collapsed_equity=1244.42, collapsed_upnl=244.42, now=at_0010("2026-03-11"),
        composed_flows={OKX_FLOW_DAY: OKX_FLOW, "2026-03-11": 51.0},
        instants=(FlowInstant(at, "2026-03-11", 0.0005, "BTC"),),
        ledger_marks={"BTC": series({"2026-03-10": 100_000.0, "2026-03-11": 102_000.0})},
        flow_prices=table,
    )
    first_chart = _ScriptedChart([
        _candles((minute - 60_000, 100_900.0), (minute, 101_000.0), (minute + 60_000, 101_100.0))
    ])
    result, _ = await derive_deribit_key(db, chart=first_chart, **kwargs)
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    assert db.rows(KEY_DRB)["2026-03-10"] == pytest.approx(22.92 / 1171.0, abs=1e-12)
    assert len(first_chart.calls) == 1
    assert table.rows == {
        (KEY_DRB, "BTC_USDC-PERPETUAL", minute): {
            "api_key_id": KEY_DRB, "instrument": "BTC_USDC-PERPETUAL", "minute_ms": minute,
            "price": 101_000.0, "source": "deribit_perp_1m_open",
        }
    }
    assert table.upsert_calls == 1
    assert all(
        conflict == "api_key_id,instrument,minute_ms" and ignore is True
        for _, conflict, ignore in table.upserts
    )

    second_chart = _ScriptedChart([])
    db.csv.clear()
    result, _ = await derive_deribit_key(db, chart=second_chart, **kwargs)
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    assert db.rows(KEY_DRB)["2026-03-10"] == pytest.approx(22.92 / 1171.0, abs=1e-12)
    assert second_chart.calls == []
    assert table.upsert_calls == 1


@pytest.mark.asyncio
async def test_flow_price_store_seeded_price_wins_over_the_chart() -> None:
    """D-05: the stored row is the authority (first writer wins), so a price already stored for the
    flow's minute is used even where the chart would answer a different open, and the venue is not
    read at all. The plan 01 scenario with the 00:05 minute pre-stored at 101_200.0 (the chart, were
    it read, would say 101_000.0):
      counted in 03-10:  0.0005 x 101_200.0 = 50.6
      base = level(03-07) 1071.0 + flow(03-08) 100.0 = 1171.0
      r(03-10) = (1244.42 - 1171.0 - 50.6) / 1171.0 = 22.82 / 1171.0
    (the chart's open would give 22.92 / 1171.0, own-day pricing 22.42 / 1171.0)."""
    marks = {**OKX_MARKS, "2026-03-10": 1244.42}
    db = KeyDb()
    seed_deribit_marks(db, marks)
    table = FlowPricesTable()
    at = _ms(2026, 3, 11, 0, 5, 20)
    minute = _ms(2026, 3, 11, 0, 5)
    table.seed(KEY_DRB, "BTC_USDC-PERPETUAL", minute, 101_200.0)
    chart = _ScriptedChart([
        _candles((minute - 60_000, 100_900.0), (minute, 101_000.0), (minute + 60_000, 101_100.0))
    ])
    result, capture = await derive_deribit_key(
        db, collapsed_equity=1244.42, collapsed_upnl=244.42, now=at_0010("2026-03-11"),
        composed_flows={OKX_FLOW_DAY: OKX_FLOW, "2026-03-11": 51.0},
        instants=(FlowInstant(at, "2026-03-11", 0.0005, "BTC"),),
        ledger_marks={"BTC": series({"2026-03-10": 100_000.0, "2026-03-11": 102_000.0})},
        chart=chart, flow_prices=table,
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    assert db.rows(KEY_DRB)["2026-03-10"] == pytest.approx(22.82 / 1171.0, abs=1e-12)
    ki = _key_inputs_payload(capture, KEY_DRB)
    stored = {f["utc_day_iso"]: f["flow_usd"] for f in ki["composed_flows"]}
    assert stored["2026-03-10"] == pytest.approx(50.6, abs=1e-9)
    assert chart.calls == []
    assert table.upsert_calls == 0
    assert table.prices(KEY_DRB) == {("BTC_USDC-PERPETUAL", minute): 101_200.0}


@pytest.mark.asyncio
async def test_flow_price_store_only_missing_minutes_are_read() -> None:
    """D-05: only MISSING minutes go to the venue. Two BTC deposits dated 03-11, 0.0002 at 00:03:10Z
    and 0.0005 at 00:05:20Z, inside the 03-10 mark (NAV 1264.58); the 00:03 minute is already stored
    at 100_800.0 and the chart is scripted once, with 00:03 deliberately different (100_700.0), 00:04
    (100_900.0), 00:05 (101_000.0) and 00:06 (101_100.0). Own-day mark 102_000.0, so 03-11 composes
    0.0002 x 102_000.0 + 0.0005 x 102_000.0 = 71.4.
      counted in 03-10:  0.0002 x 100_800.0 + 0.0005 x 101_000.0 = 20.16 + 50.5 = 70.66
      base = 1071.0 + 100.0 = 1171.0
      r(03-10) = (1264.58 - 1171.0 - 70.66) / 1171.0 = 22.92 / 1171.0
    Own-day pricing would give 22.18 / 1171.0, and using the chart's 00:03 open instead of the stored
    one 22.94 / 1171.0. One chart call, and the store gains exactly the 00:05 row."""
    marks = {**OKX_MARKS, "2026-03-10": 1264.58}
    db = KeyDb()
    seed_deribit_marks(db, marks)
    table = FlowPricesTable()
    early = _ms(2026, 3, 11, 0, 3, 10)
    late = _ms(2026, 3, 11, 0, 5, 20)
    m3, m5 = _ms(2026, 3, 11, 0, 3), _ms(2026, 3, 11, 0, 5)
    table.seed(KEY_DRB, "BTC_USDC-PERPETUAL", m3, 100_800.0)
    chart = _ScriptedChart([_candles(
        (m3, 100_700.0), (m3 + 60_000, 100_900.0), (m5, 101_000.0), (m5 + 60_000, 101_100.0)
    )])
    result, capture = await derive_deribit_key(
        db, collapsed_equity=1264.58, collapsed_upnl=264.58, now=at_0010("2026-03-11"),
        composed_flows={OKX_FLOW_DAY: OKX_FLOW, "2026-03-11": 71.4},
        instants=(
            FlowInstant(early, "2026-03-11", 0.0002, "BTC"),
            FlowInstant(late, "2026-03-11", 0.0005, "BTC"),
        ),
        ledger_marks={"BTC": series({"2026-03-10": 100_000.0, "2026-03-11": 102_000.0})},
        chart=chart, flow_prices=table,
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    assert db.rows(KEY_DRB)["2026-03-10"] == pytest.approx(22.92 / 1171.0, abs=1e-12)
    ki = _key_inputs_payload(capture, KEY_DRB)
    stored = {f["utc_day_iso"]: f["flow_usd"] for f in ki["composed_flows"]}
    assert stored["2026-03-10"] == pytest.approx(70.66, abs=1e-9)
    assert len(chart.calls) == 1
    assert chart.calls[0]["end_timestamp"] == late + 60_000
    assert table.prices(KEY_DRB) == {
        ("BTC_USDC-PERPETUAL", m3): 100_800.0, ("BTC_USDC-PERPETUAL", m5): 101_000.0,
    }
    assert table.upsert_calls == 1
    assert [r["minute_ms"] for r in table.upserts[0][0]] == [m5]


@pytest.mark.asyncio
async def test_flow_price_store_a_concurrent_writer_wins_the_race() -> None:
    """Pitfall 1: THE STORED ROW, NEVER THE LOCAL READ, IS THE AUTHORITY. The plan 01 scenario, but a
    concurrent derive of the same key stores the 00:05 minute at 101_200.0 right after this derive
    read the (still empty) store and before it writes. This derive read 101_000.0 from the chart; its
    insert loses to the existing row, the re-select hands back 101_200.0, and the index is built from
    that, so both derives value the flow identically:
      counted in 03-10:  0.0005 x 101_200.0 = 50.6
      r(03-10) = (1244.42 - 1171.0 - 50.6) / 1171.0 = 22.82 / 1171.0
    (the local read would give 22.92 / 1171.0). The table keeps 101_200.0."""
    marks = {**OKX_MARKS, "2026-03-10": 1244.42}
    db = KeyDb()
    seed_deribit_marks(db, marks)
    table = FlowPricesTable()
    at = _ms(2026, 3, 11, 0, 5, 20)
    minute = _ms(2026, 3, 11, 0, 5)
    table.after_first_read = lambda: table.seed(KEY_DRB, "BTC_USDC-PERPETUAL", minute, 101_200.0)
    chart = _ScriptedChart([
        _candles((minute - 60_000, 100_900.0), (minute, 101_000.0), (minute + 60_000, 101_100.0))
    ])
    result, capture = await derive_deribit_key(
        db, collapsed_equity=1244.42, collapsed_upnl=244.42, now=at_0010("2026-03-11"),
        composed_flows={OKX_FLOW_DAY: OKX_FLOW, "2026-03-11": 51.0},
        instants=(FlowInstant(at, "2026-03-11", 0.0005, "BTC"),),
        ledger_marks={"BTC": series({"2026-03-10": 100_000.0, "2026-03-11": 102_000.0})},
        chart=chart, flow_prices=table,
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    assert len(chart.calls) == 1
    assert table.upsert_calls == 1
    assert db.rows(KEY_DRB)["2026-03-10"] == pytest.approx(22.82 / 1171.0, abs=1e-12)
    ki = _key_inputs_payload(capture, KEY_DRB)
    stored = {f["utc_day_iso"]: f["flow_usd"] for f in ki["composed_flows"]}
    assert stored["2026-03-10"] == pytest.approx(50.6, abs=1e-9)
    assert table.prices(KEY_DRB) == {("BTC_USDC-PERPETUAL", minute): 101_200.0}


@pytest.mark.asyncio
async def test_flow_price_store_no_moved_indexed_flow_touches_nothing() -> None:
    """A derive that moves no INDEXED Deribit flow makes zero calls to the store table and zero chart
    calls, byte-identical to before the store. The 50.0 USDC deposit at 00:05Z on 03-11, inside the
    03-10 mark, is moved but USD-family, so it needs no price (r(03-10) = 23.42 / 1171.0)."""
    marks = {**OKX_MARKS, "2026-03-10": 1244.42}
    db = KeyDb()
    seed_deribit_marks(db, marks)
    table = FlowPricesTable()
    chart = _ScriptedChart([])
    at = _ms(2026, 3, 11, 0, 5)
    result, _ = await derive_deribit_key(
        db, collapsed_equity=1244.42, collapsed_upnl=244.42, now=at_0010("2026-03-11"),
        composed_flows={OKX_FLOW_DAY: OKX_FLOW, "2026-03-11": 50.0},
        instants=(FlowInstant(at, "2026-03-11", 50.0, "USDC"),),
        chart=chart, flow_prices=table,
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    assert db.rows(KEY_DRB)["2026-03-10"] == pytest.approx(23.42 / 1171.0, abs=1e-12)
    assert table.reads == 0 and table.upsert_calls == 0 and table.rows == {}
    assert chart.calls == []


# --------------------------------------------------------------------------------------
# Phase 177 plan 04 (D-05): the failure vocabulary of the at-instant price read
# --------------------------------------------------------------------------------------

_OWN_DAY = "2026-03-10"
_STORED_BEFORE = {"2026-03-06": 1050.0, "2026-03-07": 1071.0}


async def derive_moved_btc_without_a_stored_mark(
    db: KeyDb, *, chart: Any, table: FlowPricesTable | None = None, store_db_execute: Any = None,
) -> tuple[Any, dict[str, Any], FlowPricesTable]:
    """The plan 01 scenario with NO 03-10 mark stored, so THIS derive (clock 00:10:30Z on 03-11,
    collapsed equity 1244.42) writes its own 03-10 mark and the 0.0005 BTC deposit made at
    00:05:20Z on 03-11 is a moved INDEXED flow of that mark. Returns the store used."""
    seed_deribit_marks(db, _STORED_BEFORE)
    table = table if table is not None else FlowPricesTable()
    result, capture = await derive_deribit_key(
        db, collapsed_equity=1244.42, collapsed_upnl=244.42, now=at_0010("2026-03-11"),
        composed_flows={OKX_FLOW_DAY: OKX_FLOW, "2026-03-11": 51.0},
        instants=(FlowInstant(_ms(2026, 3, 11, 0, 5, 20), "2026-03-11", 0.0005, "BTC"),),
        ledger_marks={"BTC": series({"2026-03-10": 100_000.0, "2026-03-11": 102_000.0})},
        chart=chart, flow_prices=table, store_db_execute=store_db_execute,
    )
    return result, capture, table


def assert_mark_kept_and_nothing_else_written(
    db: KeyDb, capture: dict[str, Any], table: FlowPricesTable,
) -> None:
    """The day's mark IS stored (nav 1244.42) and no series, key_inputs or flow-price row was."""
    assert db.marks[(KEY_DRB, _OWN_DAY)]["nav_usd"] == pytest.approx(1244.42, abs=1e-9)
    assert db.csv_upserts == [] and db.csv_deletes == []
    assert not any(
        isinstance(payload, dict) and str(payload.get("kind", "")).startswith("key_inputs:")
        for name, payload, _oc in capture["upserts"] if name == "allocator_equity_derived"
    )
    assert table.rows == {}


def assert_transient_with_reason(result: Any, reason: str) -> None:
    assert result.outcome == DispatchOutcome.FAILED, result.error_message
    assert result.error_kind == "transient"
    assert f"reason={reason}" in result.error_message


def read_failure_warnings(caplog: pytest.LogCaptureFixture) -> list[str]:
    return [
        r.getMessage() for r in caplog.records
        if r.levelno == logging.WARNING and "moved-flow price read" in r.getMessage()
    ]


class _HungChart:
    """A chart stand-in whose read never returns: it records the call and then waits on an event
    nobody sets, like a Deribit request that hangs."""

    def __init__(self) -> None:
        self.events: list[str] = []
        self.calls: list[dict[str, Any]] = []
        self._never = asyncio.Event()

    async def __call__(self, params: dict[str, Any]) -> Any:
        self.events.append("chart")
        self.calls.append(dict(params))
        await self._never.wait()


@pytest.mark.asyncio
async def test_deribit_moved_flow_index_read_failure_is_named_and_keeps_the_mark(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture,
) -> None:
    """D-05 "a transient read retries", Pitfall 2. The chart times out on all nine attempts of the
    reader's budget (backoff zeroed). The failure is captured INSIDE the crawl, so the exchange
    closes, this derive's own 03-10 mark (nav 1244.42) is written, and the failure surfaces at the
    apply seam as a transient retry that names the reason. Nothing else is written, and the log
    line carries the reason and the exception class only (no key id, no amount)."""
    monkeypatch.setattr("services.deribit_ingest.PUBLIC_READ_BACKOFF_BASE_SECONDS", 0.0)
    db = KeyDb()
    chart = _ScriptedChart([ccxt.RequestTimeout("slow") for _ in range(9)])
    with caplog.at_level(logging.WARNING, logger="quantalyze.analytics.job_worker"):
        result, capture, table = await derive_moved_btc_without_a_stored_mark(db, chart=chart)
    assert_transient_with_reason(result, "read_transient")
    assert len(chart.calls) == 9
    assert_mark_kept_and_nothing_else_written(db, capture, table)
    lines = read_failure_warnings(caplog)
    assert len(lines) == 1, caplog.text
    assert "reason=read_transient" in lines[0] and "DeribitTransientReadError" in lines[0]
    assert KEY_DRB not in caplog.text and "0.0005" not in caplog.text


@pytest.mark.asyncio
async def test_deribit_moved_flow_index_timeout_below_the_floor_reads_nothing_and_keeps_the_mark(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture,
) -> None:
    """W2. With the derive budget set to the post-crawl reserve plus 1 s, at most 1 s remains for
    the prefetch once the reserve is kept, below the 10 s floor. The prefetch makes no chart call
    (the price is not stored), captures ``timeout``, and the day's mark is still written. The chart
    script is EMPTY, but 'no chart call' is asserted on the RECORDED calls: the reader turns any
    other exception, an over-run AssertionError included, into a structural no-data answer. The
    STORE is still read (WR-02): the floor bounds the venue read only."""
    import services.job_worker as jw

    monkeypatch.setitem(
        jw.TIMEOUT_PER_KIND, "derive_broker_dailies", jw._DERIVE_POST_CRAWL_RESERVE_S + 1.0
    )
    db = KeyDb()
    chart = _ScriptedChart([])
    with caplog.at_level(logging.WARNING, logger="quantalyze.analytics.job_worker"):
        result, capture, table = await derive_moved_btc_without_a_stored_mark(db, chart=chart)
    assert_transient_with_reason(result, "timeout")
    assert chart.calls == []
    assert table.reads == 1 and table.upsert_calls == 0
    assert_mark_kept_and_nothing_else_written(db, capture, table)
    lines = read_failure_warnings(caplog)
    assert len(lines) == 1 and "reason=timeout" in lines[0], caplog.text
    assert KEY_DRB not in caplog.text and "0.0005" not in caplog.text


@pytest.mark.asyncio
async def test_deribit_moved_flow_index_hung_store_read_below_the_floor_is_bounded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """SF-N2. Below the floor the venue is not read, but the store still is, and that read must be
    bounded too: a hung store read may not hold the derive past its budget or cost the day's mark
    (D-05). The floor is patched to 0.05 s and the budget is exactly the reserve, so the prefetch
    runs with no venue read and a store read that blocks. It must end as ``timeout`` with the
    mark kept. The 5 s guard makes an unbounded read fail this test instead of hanging it."""
    import services.job_worker as jw

    monkeypatch.setattr(jw, "_MOVED_FLOW_PRICE_MIN_SECONDS", 0.05)
    monkeypatch.setitem(
        jw.TIMEOUT_PER_KIND, "derive_broker_dailies", jw._DERIVE_POST_CRAWL_RESERVE_S
    )
    never = asyncio.Event()

    async def _hung_store_read(_fn: Any) -> Any:
        await never.wait()

    db = KeyDb()
    chart = _ScriptedChart([])
    result, capture, table = await asyncio.wait_for(
        derive_moved_btc_without_a_stored_mark(db, chart=chart, store_db_execute=_hung_store_read),
        timeout=5.0,
    )
    assert_transient_with_reason(result, "timeout")
    assert chart.calls == []
    assert_mark_kept_and_nothing_else_written(db, capture, table)


@pytest.mark.asyncio
async def test_deribit_moved_flow_index_below_the_floor_completes_from_the_store(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """WR-02. The budget floor bounds the VENUE read only. Every price the derive needs is already
    stored (the 0.0005 BTC deposit's 00:05 minute at 101_000.0), so a derive with less than the
    floor left is DONE from the stored price and makes no chart call. Before the fix the floor
    skipped the store read too, and a key whose prices were all stored retried on every attempt:
      counted in 03-10:  0.0005 x 101_000.0 = 50.5
      r(03-10) = (1244.42 - 1171.0 - 50.5) / 1171.0 = 22.92 / 1171.0"""
    import services.job_worker as jw

    monkeypatch.setitem(
        jw.TIMEOUT_PER_KIND, "derive_broker_dailies", jw._DERIVE_POST_CRAWL_RESERVE_S + 1.0
    )
    db = KeyDb()
    table = FlowPricesTable()
    table.seed(KEY_DRB, "BTC_USDC-PERPETUAL", _NO_DATA_MINUTE, 101_000.0)
    chart = _ScriptedChart([])
    result, _, table = await derive_moved_btc_without_a_stored_mark(db, chart=chart, table=table)
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    assert chart.calls == []
    assert db.rows(KEY_DRB)["2026-03-10"] == pytest.approx(22.92 / 1171.0, abs=1e-12)
    assert table.upsert_calls == 0


@pytest.mark.asyncio
async def test_deribit_moved_flow_index_timeout_is_bounded_by_the_remaining_budget(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """W2. The floor is lifted and the budget leaves 2 s above the reserve, and the chart hangs. A
    prefetch bounded by the fixed 810 s ``_BROKER_CRAWL_TIMEOUT_S`` would sit on the hung read; the
    remaining-budget bound cuts it after about 2 s, captures ``timeout``, and the day's mark is
    still written. The 15 s guard makes a bound that ignores the remaining budget fail this test
    instead of hanging it."""
    import services.job_worker as jw

    monkeypatch.setattr(jw, "_MOVED_FLOW_PRICE_MIN_SECONDS", 0.0)
    monkeypatch.setitem(
        jw.TIMEOUT_PER_KIND, "derive_broker_dailies", jw._DERIVE_POST_CRAWL_RESERVE_S + 2.0
    )
    db = KeyDb()
    chart = _HungChart()
    result, capture, table = await asyncio.wait_for(
        derive_moved_btc_without_a_stored_mark(db, chart=chart), timeout=15.0
    )
    assert_transient_with_reason(result, "timeout")
    assert len(chart.calls) == 1
    assert_mark_kept_and_nothing_else_written(db, capture, table)


@pytest.mark.asyncio
async def test_deribit_moved_flow_index_rate_limited_is_stamped_once_and_keeps_the_mark(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-05 "a 429 re-raises to ``_stamp_429``", T-177-19. The chart answers a 429 on all nine
    attempts. The reader re-raises the LAST one as itself, the prefetch stamps the key through
    ``_stamp_429`` exactly once with that very instance (the outer ``except`` arm then never sees
    it, so the key is not stamped twice), and the derive keeps the day's mark and retries."""
    monkeypatch.setattr("services.deribit_ingest.PUBLIC_READ_BACKOFF_BASE_SECONDS", 0.0)
    stamp = AsyncMock()
    monkeypatch.setattr("services.job_worker._stamp_429", stamp)
    limits = [ccxt.RateLimitExceeded(f"429 attempt {n}") for n in range(9)]
    db = KeyDb()
    chart = _ScriptedChart(list(limits))
    result, capture, table = await derive_moved_btc_without_a_stored_mark(db, chart=chart)
    assert_transient_with_reason(result, "rate_limited")
    assert len(chart.calls) == 9
    stamp.assert_awaited_once()
    assert stamp.await_args.args[1]["id"] == KEY_DRB
    assert stamp.await_args.args[2] is limits[8]
    assert_mark_kept_and_nothing_else_written(db, capture, table)


@pytest.mark.asyncio
async def test_deribit_moved_flow_index_ddos_protection_is_stamped_once_and_keeps_the_mark(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-05, WR-01. Deribit's real rate-limit reply is ``ccxt.DDoSProtection`` (body code 10028),
    which is not a ``RateLimitExceeded``. On the last attempt it reaches ``_stamp_429`` exactly like
    a 429 does, and the derive keeps the day's mark and retries."""
    monkeypatch.setattr("services.deribit_ingest.PUBLIC_READ_BACKOFF_BASE_SECONDS", 0.0)
    stamp = AsyncMock()
    monkeypatch.setattr("services.job_worker._stamp_429", stamp)
    limits = [ccxt.DDoSProtection(f"too_many_requests attempt {n}") for n in range(9)]
    db = KeyDb()
    chart = _ScriptedChart(list(limits))
    result, capture, table = await derive_moved_btc_without_a_stored_mark(db, chart=chart)
    assert_transient_with_reason(result, "rate_limited")
    assert len(chart.calls) == 9
    stamp.assert_awaited_once()
    assert stamp.await_args.args[1]["id"] == KEY_DRB
    assert stamp.await_args.args[2] is limits[8]
    assert_mark_kept_and_nothing_else_written(db, capture, table)


@pytest.mark.asyncio
async def test_deribit_moved_flow_index_plain_exchange_error_is_transient_not_a_refusal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """WR-03. A plain ``ExchangeError`` on every attempt is retried and ends as a transient read
    failure. It must never take the permanent ``mark_flow_index_unavailable`` refusal."""
    monkeypatch.setattr("services.deribit_ingest.PUBLIC_READ_BACKOFF_BASE_SECONDS", 0.0)
    db = KeyDb()
    chart = _ScriptedChart([ccxt.ExchangeError(f"unmapped {n}") for n in range(9)])
    result, capture, table = await derive_moved_btc_without_a_stored_mark(db, chart=chart)
    assert_transient_with_reason(result, "read_transient")
    assert len(chart.calls) == 9
    assert_mark_kept_and_nothing_else_written(db, capture, table)


_NO_DATA_MINUTE = _ms(2026, 3, 11, 0, 5)
_NO_DATA_KINDS: dict[str, Any] = {
    "no_data_status": {"result": {"status": "no_data"}},
    "bad_symbol": ccxt.BadSymbol("no such instrument"),
    "no_containing_candle": _candles(
        (_NO_DATA_MINUTE - 60_000, 100_900.0), (_NO_DATA_MINUTE + 60_000, 101_100.0)
    ),
    "nan_open": _candles(
        (_NO_DATA_MINUTE - 60_000, 100_900.0), (_NO_DATA_MINUTE, float("nan")),
        (_NO_DATA_MINUTE + 60_000, 101_100.0),
    ),
}


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", list(_NO_DATA_KINDS))
async def test_deribit_moved_flow_index_no_data_refuses_by_name(
    kind: str, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture,
) -> None:
    """D-05 "a structural no-data read refuses as ``mark_flow_index_unavailable``", T-177-17. Four
    structural answers for the moved BTC flow's minute: an explicit ``no_data`` body, a
    ``BadSymbol``, an ok body with no candle for the containing minute (its neighbours only) and a
    NaN open. None is retried (one chart call) and none falls back to the own-day or the day-D
    price: the derive takes the existing nav-marks refusal road, FAILED permanent, with the static
    text and the token only, the day's mark stored and nothing else written."""
    monkeypatch.setattr("services.deribit_ingest.PUBLIC_READ_BACKOFF_BASE_SECONDS", 0.0)
    db = KeyDb()
    chart = _ScriptedChart([_NO_DATA_KINDS[kind]])
    with caplog.at_level(logging.WARNING, logger="quantalyze.analytics.job_worker"):
        result, capture, table = await derive_moved_btc_without_a_stored_mark(db, chart=chart)
    assert result.outcome == DispatchOutcome.FAILED, result.error_message
    assert result.error_kind == "permanent"
    assert result.error_message == (
        "derive_broker_dailies: nav marks refused (mark_flow_index_unavailable)"
    )
    assert any(
        r.levelname == "ERROR" and "reason=mark_flow_index_unavailable" in r.getMessage()
        for r in caplog.records
    ), caplog.text
    assert len(chart.calls) == 1
    assert_mark_kept_and_nothing_else_written(db, capture, table)
    assert "0.0005" not in caplog.text


@pytest.mark.asyncio
@pytest.mark.parametrize("side", ["write", "read"])
async def test_deribit_moved_flow_index_store_fault_is_transient_and_keeps_the_mark(
    side: str,
) -> None:
    """D-05 / SC-3, a store fault retries: the price table failing to answer a read (which is also
    what an absent table, a worker deployed before its migration applied, looks like) or to take a
    write is a transient retry and never a price used without the store. The day's mark is kept
    and nothing else is written."""
    table = FlowPricesTable()
    if side == "write":
        table.fail_inserts = RuntimeError("insert refused")
    else:
        table.fail_reads = RuntimeError("relation does not exist")
    minute = _NO_DATA_MINUTE
    db = KeyDb()
    chart = _ScriptedChart([
        _candles((minute - 60_000, 100_900.0), (minute, 101_000.0), (minute + 60_000, 101_100.0))
    ])
    result, capture, table = await derive_moved_btc_without_a_stored_mark(
        db, chart=chart, table=table
    )
    assert_transient_with_reason(result, "store_fault")
    assert_mark_kept_and_nothing_else_written(db, capture, table)


@pytest.mark.asyncio
async def test_deribit_moved_flow_uses_this_derives_own_mark() -> None:
    """Pitfall 3, this derive's own mark is part of the prediction. No 03-10 mark is stored, so THIS
    derive writes it (nav 1244.42, read at 00:10:30Z on 03-11) after its exchange has closed. The
    0.0005 BTC deposit made at 00:05:20Z, before that read, is therefore a moved flow of a mark the
    prefetch could only know from the derive's own clock. The chart is read for it and the deposit
    is counted at its candle open, 101_000.0 (hand-typed as in plan 01):
      counted in 03-10:  0.0005 x 101_000.0 = 50.5
      r(03-10) = (1244.42 - 1171.0 - 50.5) / 1171.0 = 22.92 / 1171.0
    Without the own mark in the prediction nothing would be read and the coverage check would turn
    this into a ``prediction_miss`` retry on every derive of a fresh day."""
    db = KeyDb()
    minute = _NO_DATA_MINUTE
    chart = _ScriptedChart([
        _candles((minute - 60_000, 100_900.0), (minute, 101_000.0), (minute + 60_000, 101_100.0))
    ])
    result, _, table = await derive_moved_btc_without_a_stored_mark(db, chart=chart)
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    assert db.marks[(KEY_DRB, _OWN_DAY)]["nav_usd"] == pytest.approx(1244.42, abs=1e-9)
    assert db.rows(KEY_DRB)["2026-03-10"] == pytest.approx(22.92 / 1171.0, abs=1e-12)
    assert len(chart.calls) == 1
    assert table.prices(KEY_DRB) == {("BTC_USDC-PERPETUAL", minute): 101_000.0}


@pytest.mark.asyncio
async def test_deribit_coverage_check_turns_a_prediction_miss_into_a_retry() -> None:
    """Pitfall 3, T-177-16. A concurrent writer stored the 03-10 mark (read at 00:20:00Z on 03-11)
    between the prefetch's read of the marks and this derive's mark write, so the prefetch saw only
    03-06 and 03-07 and predicted THIS derive's own read at 00:10:30Z. That prediction does not
    place the 00:15:00Z BTC deposit, so nothing was read. The write-once insert loses, the stored
    00:20 row is the mark, and the FINAL marks do place the deposit. The coverage check on the
    final marks turns that into a named ``prediction_miss`` retry with no chart call and nothing
    written; the deposit is never counted at the own-day price (a DONE would be that bug)."""
    from services.nav_marks import read_key_marks as real_read_key_marks

    db = KeyDb()
    seed_deribit_marks(db, _STORED_BEFORE)
    seed_mark(db, _OWN_DAY, 1244.42, key=KEY_DRB, venue="deribit",
              open_pnl=1244.42 - OKX_TERMINAL, native_unit=None)
    db.marks[(KEY_DRB, _OWN_DAY)]["marked_at"] = "2026-03-11T00:20:00+00:00"
    reads: list[int] = []

    def first_read_misses_the_day(supabase: Any, key: str) -> Any:
        reads.append(1)
        stored = real_read_key_marks(supabase, key)
        return [m for m in stored if m.mark_day != _OWN_DAY] if len(reads) == 1 else stored

    chart = _ScriptedChart([])
    table = FlowPricesTable()
    with patch(
        "services.job_worker.read_key_marks", new=MagicMock(side_effect=first_read_misses_the_day)
    ):
        result, capture = await derive_deribit_key(
            db, collapsed_equity=1244.42, collapsed_upnl=244.42, now=at_0010("2026-03-11"),
            composed_flows={OKX_FLOW_DAY: OKX_FLOW, "2026-03-11": 51.0},
            instants=(FlowInstant(_ms(2026, 3, 11, 0, 15), "2026-03-11", 0.0005, "BTC"),),
            ledger_marks={"BTC": series({"2026-03-10": 100_000.0, "2026-03-11": 102_000.0})},
            chart=chart, flow_prices=table,
        )
    assert len(reads) >= 2, "the seam must read the marks again, on the final set"
    assert_transient_with_reason(result, "prediction_miss")
    assert chart.calls == [] and table.reads == 0 and table.upsert_calls == 0
    assert_mark_kept_and_nothing_else_written(db, capture, table)
    assert db.marks[(KEY_DRB, _OWN_DAY)]["marked_at"] == "2026-03-11T00:20:00+00:00"


def moved_flows_lines(caplog: pytest.LogCaptureFixture) -> list[str]:
    return [
        r.getMessage() for r in caplog.records
        if r.levelno == logging.INFO and r.getMessage().startswith(
            "derive_broker_dailies: deribit flows moved by marks"
        )
    ]


@pytest.mark.asyncio
async def test_deribit_flows_moved_log_key_mode(caplog: pytest.LogCaptureFixture) -> None:
    """D-01, plan 01's scenario: one BTC deposit moved into the last (03-10) mark and priced at its
    candle open. Exactly one counts line, and no record that carries its prefix names the key."""
    marks = {**OKX_MARKS, "2026-03-10": 1244.42}
    db = KeyDb()
    seed_deribit_marks(db, marks)
    minute = _ms(2026, 3, 11, 0, 5)
    chart = _ScriptedChart([
        _candles((minute - 60_000, 100_900.0), (minute, 101_000.0), (minute + 60_000, 101_100.0))
    ])
    with caplog.at_level(logging.INFO, logger="quantalyze.analytics.job_worker"):
        result, _ = await derive_deribit_key(
            db, collapsed_equity=1244.42, collapsed_upnl=244.42, now=at_0010("2026-03-11"),
            composed_flows={OKX_FLOW_DAY: OKX_FLOW, "2026-03-11": 51.0},
            instants=(FlowInstant(_ms(2026, 3, 11, 0, 5, 20), "2026-03-11", 0.0005, "BTC"),),
            ledger_marks={"BTC": series({"2026-03-10": 100_000.0, "2026-03-11": 102_000.0})},
            chart=chart,
        )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    assert moved_flows_lines(caplog) == [
        "derive_broker_dailies: deribit flows moved by marks "
        "(moved=1 at_instant=1 usd_family=0 on_last_mark=1 mode=key)"
    ]
    assert KEY_DRB not in moved_flows_lines(caplog)[0]


@pytest.mark.asyncio
async def test_deribit_flows_moved_log_at_zero(caplog: pytest.LogCaptureFixture) -> None:
    """D-01: the line is emitted even when no flow was moved, so its absence is never read as zero."""
    db = KeyDb()
    seed_deribit_marks(db, OKX_MARKS)
    with caplog.at_level(logging.INFO, logger="quantalyze.analytics.job_worker"):
        result, _ = await derive_deribit_key(
            db, collapsed_equity=1194.42, collapsed_upnl=194.42, now=at_0010("2026-03-11"),
        )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    assert moved_flows_lines(caplog) == [
        "derive_broker_dailies: deribit flows moved by marks "
        "(moved=0 at_instant=0 usd_family=0 on_last_mark=0 mode=key)"
    ]


_AT_RISEN = _ms(2026, 3, 11, 0, 5, 20)
_NO_READ_CASES: dict[str, dict[str, Any]] = {
    # A USDC deposit made before the 00:10Z read of the stored 03-10 mark is moved, but it is
    # USD-family and needs no price.
    "usdc_in_window": dict(
        marks={**OKX_MARKS, "2026-03-10": 1244.42}, equity=1244.42,
        flows={OKX_FLOW_DAY: OKX_FLOW, "2026-03-11": 50.0},
        instants=(FlowInstant(_AT_RISEN, "2026-03-11", 50.0, "USDC"),),
        expect=23.42 / 1171.0,
    ),
    # The same USDC deposit beside a BTC deposit made AFTER the read: the BTC one is not moved but
    # is INDEXED, so the derive does enter the prefetch, and the wanted-flow filter alone must
    # keep the USD-family one out.
    "usdc_beside_an_unmoved_btc": dict(
        marks={**OKX_MARKS, "2026-03-10": 1244.42}, equity=1244.42,
        flows={OKX_FLOW_DAY: OKX_FLOW, "2026-03-11": 101.0},
        instants=(
            FlowInstant(_AT_RISEN, "2026-03-11", 50.0, "USDC"),
            FlowInstant(_ms(2026, 3, 11, 0, 20), "2026-03-11", 0.0005, "BTC"),
        ),
        expect=23.42 / 1171.0,
    ),
    # A BTC deposit at 00:20:00Z, after the 00:10Z read of the stored 03-10 mark, stays in 03-11
    # at its own-day value, so the 03-10 mark holds no deposit: r(03-10) = (1194.42 - 1171.0) / 1171.0.
    "btc_after_the_read": dict(
        marks=OKX_MARKS, equity=1194.42, flows={OKX_FLOW_DAY: OKX_FLOW, "2026-03-11": 51.0},
        instants=(FlowInstant(_ms(2026, 3, 11, 0, 20), "2026-03-11", 0.0005, "BTC"),),
        expect=(1194.42 - 1171.0) / 1171.0,
    ),
    # 03-09 is not the read day of any stored mark (there is no 03-08 mark), so nothing moves it.
    "btc_off_a_read_day": dict(
        marks=OKX_MARKS, equity=1194.42, flows={OKX_FLOW_DAY: OKX_FLOW, "2026-03-09": 51.0},
        instants=(FlowInstant(_ms(2026, 3, 9, 0, 5), "2026-03-09", 0.0005, "BTC"),),
        expect=(1194.42 - 1171.0 - 51.0) / (1171.0 + 51.0),
    ),
}


@pytest.mark.asyncio
@pytest.mark.parametrize("case", list(_NO_READ_CASES))
async def test_deribit_no_chart_read_without_a_moved_indexed_flow(case: str) -> None:
    """A derive with no moved INDEXED flow reads neither the venue nor the store: a USD-family
    deposit in the window, that same deposit beside an unmoved BTC one, a BTC deposit after the
    read, and a BTC deposit on a day no stored mark was read. The chart script is EMPTY and the
    check is on its RECORDED calls (the reader would turn an over-run AssertionError into a
    structural no-data answer). The derive completes and the expected return is typed per case."""
    spec = _NO_READ_CASES[case]
    db = KeyDb()
    seed_deribit_marks(db, spec["marks"])
    table = FlowPricesTable()
    chart = _ScriptedChart([])
    result, _ = await derive_deribit_key(
        db, collapsed_equity=spec["equity"], collapsed_upnl=spec["equity"] - OKX_TERMINAL,
        now=at_0010("2026-03-11"), composed_flows=spec["flows"], instants=spec["instants"],
        ledger_marks={"BTC": series({
            "2026-03-09": 100_000.0, "2026-03-10": 100_000.0, "2026-03-11": 102_000.0,
        })},
        chart=chart, flow_prices=table,
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    assert db.rows(KEY_DRB)["2026-03-10"] == pytest.approx(spec["expect"], abs=1e-12)
    assert chart.calls == []
    assert table.reads == 0 and table.upsert_calls == 0 and table.rows == {}


@pytest.mark.asyncio
async def test_deribit_key_mode_compose_reproduces_every_mark() -> None:
    """Deribit, writer basis. The realized terminal is the ledger's 1000.0 on 03-05 (not the live
    collapsed equity, 1215.0), the pre-start day P&L is this module's own roll of the realized
    series, and after the start the writer basis is the marks' level identity (50, 21, 0 on the
    deposit day, 23.42; the flow-free gap day has no entry). The compose rolls on it from the
    03-10 mark and the stored mark, not the live read, is the anchor."""
    db = KeyDb()
    seed_deribit_marks(db)
    result, capture = await derive_deribit_key(
        db, collapsed_equity=1215.0, collapsed_upnl=215.0, now=at_0010("2026-03-11")
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    rows = db.rows(KEY_DRB)
    assert {d: v for d, v in rows.items() if d < "2026-03-06"} == REALIZED_THROUGH_0305
    assert rows["2026-03-06"] == pytest.approx(0.05, abs=1e-12)
    assert rows["2026-03-10"] == pytest.approx(23.42 / 1171.0, abs=1e-12)
    ki = _key_inputs_payload(capture, KEY_DRB)
    assert (ki["realized_terminal_day"], ki["realized_terminal_usd"]) == ("2026-03-10", 1194.42)
    assert ki["anchor_usd"] == pytest.approx(1194.42, abs=1e-9)
    pnl = {r["utc_day_iso"]: r["pnl_usd"] for r in ki["composed_day_pnl"]}
    # The marks' level identity M_d - base - F_d after the start: 1050 - 1000; 1071 - 1050;
    # the deposit day 0.0; 1194.42 - (1071 + 100).
    assert {d: v for d, v in pnl.items() if d >= "2026-03-06"} == pytest.approx({
        "2026-03-06": 50.0, "2026-03-07": 21.0, "2026-03-08": 0.0, "2026-03-10": 23.42,
    })
    assert ki["composed_flows"] == [{"utc_day_iso": OKX_FLOW_DAY, "flow_usd": OKX_FLOW}]
    payload = await compose_curve(db, capture, key=KEY_DRB, venue="deribit")
    curve = levels(payload)
    assert_levels(curve, OKX_MARKS)
    assert curve["2026-03-08"] == pytest.approx(1071.0 + OKX_FLOW, rel=1e-9)
    assert "writer_basis_mismatch" not in payload["flags"]
    assert_levels(curve, realized_levels(REALIZED_THROUGH_0305, "2026-03-05", OKX_TERMINAL, {}))
    assert_trustworthy(payload)


@pytest.mark.asyncio
async def test_stale_last_mark_does_not_mask_a_live_zero() -> None:
    """Info 2 / T-167.2.1.1.1-57, the plan's literal case. Today's mark is refused (the live
    collapsed equity is 0.0, ``nonpositive``), so the series' last day is the 03-08 mark, two days
    older than this derive's label (03-10). The stored 1071.0 must not stand in for a live zero:
    the live ladder decides, so the anchor is None with ``nonpositive`` and ``anchor_asof`` is this
    derive's own clock. A Deribit terminal comes from the ledger, so the marks still apply."""
    db = KeyDb()
    seed_deribit_marks(db, {"2026-03-06": 1050.0, "2026-03-08": 1071.0})
    before = datetime.now(timezone.utc)
    result, capture = await derive_deribit_key(
        db, collapsed_equity=0.0, collapsed_upnl=0.0, now=at_0010("2026-03-11")
    )
    after = datetime.now(timezone.utc)
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    assert (KEY_DRB, "2026-03-10") not in db.marks
    ki = _key_inputs_payload(capture, KEY_DRB)
    assert ki["nav_mark_refusal"] == "nonpositive"
    assert ki["anchor_usd"] is None and ki["anchor_null_reason"] == "nonpositive"
    assert before <= datetime.fromisoformat(ki["anchor_asof"]) <= after
    assert (ki["realized_terminal_day"], ki["realized_terminal_usd"]) == ("2026-03-08", 1071.0)


@pytest.mark.asyncio
async def test_dropped_day_pnl_exists_only_before_the_start() -> None:
    """D-15 (167.1.2.2) on a marked key. The writer drops 03-02 (a NaN return with a real P&L,
    before the first mark) and its guard also dropped 03-06 (a NaN realized return ON the first
    mark day). From the first mark on there is no dropped day: the realized row is replaced by the
    mark's return, so the stored ``dropped_day_pnl`` names 03-02 and only 03-02, and the compose
    reproduces every mark through it."""
    realized = series({
        **REALIZED_THROUGH_0305, "2026-03-02": float("nan"), "2026-03-06": float("nan"),
    })
    db = KeyDb()
    seed_deribit_marks(db)
    result, capture = await derive_deribit_key(
        db, collapsed_equity=1215.0, collapsed_upnl=215.0, now=at_0010("2026-03-11"),
        returns=realized,
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    ki = _key_inputs_payload(capture, KEY_DRB)
    assert [r["utc_day_iso"] for r in ki["dropped_day_pnl"]] == ["2026-03-02"]
    rows = db.rows(KEY_DRB)
    assert "2026-03-02" not in rows
    assert rows["2026-03-06"] == pytest.approx(0.05, abs=1e-12), "the mark's return, not a NaN"
    payload = await compose_curve(db, capture, key=KEY_DRB, venue="deribit")
    assert_levels(levels(payload), OKX_MARKS)
    assert_trustworthy(payload)


@pytest.mark.asyncio
async def test_read_day_flow_is_held_out_okx() -> None:
    """The ccxt twin of ``test_read_day_flow_is_held_out``. A deposit dated 03-11, the day after
    the last mark (03-10), is left out of the stored flows (stored, it sits past the terminal day
    and reads ``out_of_window_flow``). Its row carries no instant, so it is not moved."""
    db = KeyDb()
    seed_okx_marks(db)
    flows = [*okx_flows(), ExternalFlow(utc_day_iso="2026-03-11", usd_signed=50.0)]
    result, capture = await derive_key_ccxt(
        db, returns=series(REALIZED_THROUGH_0305), now=at_0010("2026-03-11"), equity=1194.42,
        upl=194.42, flows=flows,
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    ki = _key_inputs_payload(capture, KEY)
    assert ki["flows"] == [{"utc_day_iso": OKX_FLOW_DAY, "usd_signed": OKX_FLOW}]
    payload = await compose_curve(db, capture)
    assert_levels(levels(payload), OKX_MARKS)
    assert_trustworthy(payload)


@pytest.mark.asyncio
async def test_a_deposit_made_before_the_read_is_counted_in_the_mark_day_okx() -> None:
    """D-23, the ccxt twin. A 50.0 deposit dated 03-11 but made at 00:05Z, before the 03-10 mark's
    00:10Z read, is inside that mark (NAV 1244.42). It is stored on 03-10, so the stored flows are
    the 100.0 on 03-08 and the 50.0 on 03-10, r(03-10) = (1244.42 - 1171 - 50) / 1171 = 0.02, and
    the compose lands on every mark. Made at 00:15Z (after the read) it stays held out."""
    marks = {**OKX_MARKS, "2026-03-10": 1244.42}
    flows = [*okx_flows(), ExternalFlow(utc_day_iso="2026-03-11", usd_signed=50.0)]
    for minute, expect in ((5, [("2026-03-08", 100.0), ("2026-03-10", 50.0)]), (15, [("2026-03-08", 100.0)])):
        db = KeyDb()
        seed_okx_marks(db, marks if minute == 5 else None)
        at = int(datetime(2026, 3, 11, 0, minute, tzinfo=timezone.utc).timestamp() * 1000)
        result, capture = await derive_key_ccxt(
            db, returns=series(REALIZED_THROUGH_0305), now=at_0010("2026-03-11"),
            equity=1244.42 if minute == 5 else 1194.42, upl=(244.42 if minute == 5 else 194.42),
            flows=flows, flow_instants=[FlowInstant(at, "2026-03-11", 50.0)],
        )
        assert result.outcome == DispatchOutcome.DONE, result.error_message
        ki = _key_inputs_payload(capture, KEY)
        assert [(f["utc_day_iso"], f["usd_signed"]) for f in ki["flows"]] == expect
        assert db.rows()["2026-03-10"] == pytest.approx(23.42 / 1171.0, abs=1e-12)
        payload = await compose_curve(db, capture)
        assert_levels(levels(payload), marks if minute == 5 else OKX_MARKS)
        assert_trustworthy(payload)


# ---- the race loser ---------------------------------------------------------------------


@pytest.mark.asyncio
async def test_second_writer_derive_rolls_from_the_stored_mark() -> None:
    """Pitfall 1 on the allocator curve. The derive that lost the same-day race read 1060.0 while
    1050.0 is stored for the closed day: its row states the stored value as the terminal and as the
    anchor, so the compose's last level is the first writer's 1050.0, not its own read."""
    db = KeyDb()
    seed_mark(db, "2026-03-06", 1050.0, key=KEY, open_pnl=50.0)
    result, capture = await derive_key_ccxt(
        db, returns=series(REALIZED_THROUGH_0305), now=at_0010("2026-03-07"), equity=1060.0,
        upl=60.0, flows=[],
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    assert db.marks[(KEY, "2026-03-06")]["nav_usd"] == 1050.0
    ki = _key_inputs_payload(capture, KEY)
    assert (ki["realized_terminal_day"], ki["realized_terminal_usd"]) == ("2026-03-06", 1050.0)
    assert ki["anchor_usd"] == pytest.approx(1050.0, abs=1e-9)
    assert db.rows()["2026-03-06"] == pytest.approx(0.05, abs=1e-12)
    curve = levels(await compose_curve(db, capture))
    assert curve["2026-03-06"] == pytest.approx(1050.0, rel=1e-9)


# --------------------------------------------------------------------------------------
# Review fix round 1 (CR-02) - a mark with no usable base is a gap in key mode too
# --------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_a_nonpositive_first_base_is_a_gap_in_key_mode() -> None:
    """CR-02. The first mark's wallet is -100.0 (NAV 1050.0 less an open profit of 1150.0), so its
    base is not positive. The key derive used to refuse (FAILED permanent, `key_inputs` frozen on
    the last good row, My Allocation degraded for ever, because marks and flows never change).
    Now 03-06 is a gap, the key's rows, `key_inputs` row and compose enqueue are written, and the
    03-07 mark is measured from the stored 1050.0."""
    db = KeyDb()
    seed_okx_marks(db)
    seed_mark(db, "2026-03-06", 1050.0, key=KEY, open_pnl=1150.0)
    result, capture = await derive_key_ccxt(
        db, returns=series(REALIZED_THROUGH_0305), now=at_0010("2026-03-11"), equity=1000.0,
        upl=1100.0, flows=okx_flows(),
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    rows = db.rows()
    assert "2026-03-06" not in rows
    assert rows["2026-03-07"] == pytest.approx((1071.0 - 1050.0) / 1050.0, abs=1e-12)
    assert _key_inputs_payload(capture, KEY)["marks_since"] == "2026-03-06"
