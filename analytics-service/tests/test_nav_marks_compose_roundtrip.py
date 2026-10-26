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

import logging
from contextlib import ExitStack
from datetime import date, datetime, timedelta, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

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
async def test_stale_last_mark_does_not_anchor() -> None:
    """Info 2. Today's mark was refused (``upnl_unreadable``: the open profit could not be read, so
    no mark was stored for 03-10), and the series' last day is the 03-08 mark, two days older than
    this derive's label. That stored value is not this derive's read: the live read (1215.0, a
    healthy balance) and its ladder are the anchor, ``anchor_asof`` is this derive's own clock, and
    the stale 1071.0 is not.

    The plan names a live read of 0.0 for this case. An OKX terminal is ``equity - upl``, which
    needs a usable equity (plan 07's rule: no realized terminal, no marked series, the derive
    refuses by name), so a live zero cannot reach the anchor here. That variant is
    ``test_stale_last_mark_does_not_mask_a_live_zero`` on Deribit, whose terminal does not come
    from the live read."""
    db = KeyDb()
    seed_okx_marks(db, {"2026-03-06": 1050.0, "2026-03-08": 1071.0})
    before = datetime.now(timezone.utc)
    result, capture = await derive_key_ccxt(
        db, returns=series(REALIZED_THROUGH_0305), now=at_0010("2026-03-11"), equity=1215.0,
        upl=215.0, flows=[], upnl_unreadable=True,
    )
    after = datetime.now(timezone.utc)
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    assert (KEY, "2026-03-10") not in db.marks, "an unreadable open profit stores no mark"
    ki = _key_inputs_payload(capture, KEY)
    assert ki["nav_mark_refusal"] == "upnl_unreadable"
    assert ki["anchor_usd"] == pytest.approx(1215.0, abs=1e-9), "the live read is the anchor"
    assert ki["anchor_null_reason"] is None
    assert before <= datetime.fromisoformat(ki["anchor_asof"]) <= after
    # The marks still apply to the series: its last day is the older mark, and the terminal
    # follows the series, not the anchor.
    assert ki["realized_terminal_day"] == "2026-03-08"
    assert ki["realized_terminal_usd"] == pytest.approx(1071.0, abs=1e-9)
    assert ki["marks_since"] == "2026-03-06"


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
        patch("services.job_worker._utc_now", new=lambda: _FROZEN_NOW),
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


async def derive_deribit_key(
    db: KeyDb, *, collapsed_equity: float, collapsed_upnl: float, now: datetime,
    apply_nothing: bool = False, returns: pd.Series | None = None,
    composed_flows: dict[str, float] | None = None, instants: tuple[FlowInstant, ...] = (),
) -> tuple[Any, dict[str, Any]]:
    """Deribit key-mode derive on the NAV path. The ledger quantities (realized terminal 1000.0
    on 03-05, the day P&L, a +100 composed flow on the gap day) are what the ledger helpers return;
    the day P&L is this module's own, rolled from the terminal, so the writer basis is coherent."""
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
    route_key_csv(route_marks(ctx, db), db)
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
                replace(_stub_native_ledger(), flow_instants=instants),
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
