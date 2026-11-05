"""Phase 188 TINYBASE plan 13 - the reconcile delete covers every day the derive states as left out
(VERIFICATION gaps 1 to 3; CONTEXT D-02, D-04, D-11).

What this pins, and why each test can fail
------------------------------------------
``apply_marks`` gives a left-out marked day no index entry (D-04: from a key's first mark on, a
tiny day is skipped, never a chain break). The reconcile delete took its span from the series
index alone, so on a tiny TAIL (key C's PROD shape) the span ended at the last measured day and a
row an earlier derive stored on a stated day stayed. The stored ``dropped_day_pnl`` and that row
then sat on the same day, the compose read them as a double count and named the book
``key_inputs_mismatch``. The same holds at a tiny LEADING EDGE (a key with no realized day before
its first mark): the span started at the first measured row. Both edges, in key mode and strategy
mode, are pinned here. Today the span ends at the last measured day, so a stated tail day is never
named by the delete, and the span starts at the first measured day, so a stated leading day is not
either.

Fixture 1, key C's tail (the roundtrip harness' shape, ``MARKS`` / ``TINY_DAYS``): realized
2026-03-01..2026-03-05, a -99600.0 withdrawal on 03-06, marks 03-06 = 400.0, 03-07 = 588.0,
03-08 = 278.0, 03-09 = 249.0. Day 03-06 is measured (r = 0.0); 03-07, 03-08 and 03-09 are measured
against bases of 400, 588 and 278, all under 5% of the 30-day peak 100000, so they are stated and
have no row. A pre-188 derive stored those three days as 188/400, -310/588 and -29/278; they are
typed beside the sums below.

Fixture 2, the leading edge (``LEAD_*``): realized returns 2026-03-06..2026-03-11 all 0.0, so there
is no realized day before the first mark and the first mark has no base; marks (open profit 0.0)
03-06 = 100000.0, 03-08 = 588.0, 03-10 = 100800.0, 03-11 = 101000.0; flows 03-07 = -99600.0 and
03-09 = +100000.0; the derive runs at 00:10Z on 03-12 with equity 101000.0. Hand arithmetic:
03-08's base is 100000 - 99600 = 400, under 5% of the 30-day peak 100000, so 03-08 is tiny, and
its gap day 03-07 (no mark) is stated with it; 03-10's base is 588 + 100000 = 100588, measured,
r = (100800 - 100588 - 0) / 100588 = 212/100588; 03-11's base is 100800, r = 200/100800. The rows
are exactly those two days. A stale 03-09 (a gap day inside the widened span) goes with them.

Every stale-row arm fails today: the delete never names a stated day outside the old span. The two
scope arms are the guards the fix must not break: a row before the earliest and after the latest
day of (payload days and stated days) is kept, so is a sibling's row, and with no stated day the
span is the payload span exactly. A hull that reached further than the run's own stated days is
what reddens them (the neuter drills in the plan's SUMMARY).
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from services.external_flows import ExternalFlow
from services.job_worker import DispatchOutcome
from tests.test_allocator_equity_dropped_day_pnl import _key_inputs_payload
from tests.test_nav_marks_compose_roundtrip import (
    KEY,
    SIBLING,
    KeyDb,
    compose_curve,
    derive_key_ccxt,
    derive_okx,
    levels,
    seed_okx_marks,
)
from tests.test_nav_marks_derive_apply import (
    REALIZED_THROUGH_0305,
    STRATEGY,
    StrategyDb,
    at_0010,
    derive_ccxt_strategy,
    prestamp,
    seed_mark,
    series,
)
from tests.test_tiny_base_roundtrip import (
    MARKS,
    TINY_DAYS,
    WITHDRAWAL,
)

# What a pre-188 derive stored on key C's three tiny days: the old row is P&L over base.
STALE_TAIL = {
    "2026-03-07": 188.0 / 400.0,
    "2026-03-08": -310.0 / 588.0,
    "2026-03-09": -29.0 / 278.0,
}

# The leading-edge fixture (module docstring).
LEAD_REALIZED = {f"2026-03-{d:02d}": 0.0 for d in range(6, 12)}
LEAD_MARKS = {
    "2026-03-06": 100000.0, "2026-03-08": 588.0, "2026-03-10": 100800.0, "2026-03-11": 101000.0,
}
LEAD_FLOWS = [
    ExternalFlow(utc_day_iso="2026-03-07", usd_signed=-99600.0),
    ExternalFlow(utc_day_iso="2026-03-09", usd_signed=100000.0),
]
LEAD_STATED = ["2026-03-07", "2026-03-08"]
# Rows the leading-edge derive stores: (100800 - 100588) / 100588 and (101000 - 100800) / 100800.
LEAD_ROWS = {"2026-03-10": 212.0 / 100588.0, "2026-03-11": 200.0 / 100800.0}
# Stale rows an earlier (pre-marks) derive left over LEAD_REALIZED: 03-06 = 0.05 (the first mark
# day, which has no base and so no row and is not stated), 03-07 = 0.0, 03-08 = 188/400 and
# 03-09 = 0.001 (a gap day).
LEAD_STALE = {
    "2026-03-06": 0.05, "2026-03-07": 0.0, "2026-03-08": 188.0 / 400.0, "2026-03-09": 0.001,
}


def stored_on_stated(rows: dict[str, float], stated: list[str]) -> set[str]:
    """The stated days that still hold a stored return row."""
    return {day for day in stated if day in rows}


def _seed_tail_marks(db: KeyDb | StrategyDb, key: str) -> None:
    for day, nav in MARKS.items():
        seed_mark(db, day, nav, key=key, open_pnl=0.0, venue="okx")


async def _derive_tail_key(db: KeyDb) -> dict:
    result, capture = await derive_key_ccxt(
        db,
        returns=series(REALIZED_THROUGH_0305),
        now=at_0010("2026-03-10"),
        equity=249.0,
        upl=0.0,
        flows=[ExternalFlow(utc_day_iso="2026-03-06", usd_signed=WITHDRAWAL)],
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    return capture


@pytest.mark.asyncio
async def test_key_tail_stale_rows_on_stated_days_are_deleted() -> None:
    """VERIFICATION gap 1, key C's PROD shape. The rows a pre-188 derive stored on the three tiny
    tail days are gone after the derive, the stated list is unchanged, and nothing else moved.
    Fails today: the span ended at 2026-03-06 (the last measured day), so none of the three stated
    days was named by the delete and all three stale rows remain."""
    db = KeyDb()
    _seed_tail_marks(db, KEY)
    for day, value in STALE_TAIL.items():
        db.csv[(KEY, day)] = value
    capture = await _derive_tail_key(db)

    ki = _key_inputs_payload(capture, KEY)
    assert ki["tiny_base_days"] == TINY_DAYS
    rows = db.rows()
    assert stored_on_stated(rows, ki["tiny_base_days"]) == set(), "a stale row sits on a stated day"
    assert {d: v for d, v in rows.items() if d < "2026-03-06"} == REALIZED_THROUGH_0305
    assert rows["2026-03-06"] == pytest.approx(0.0, abs=1e-12)


@pytest.mark.asyncio
async def test_key_tail_book_is_trustworthy_after_the_derive() -> None:
    """VERIFICATION gap 2. A key that held stale rows on its stated days composes trustworthy once
    it is derived: no ``key_inputs_mismatch``, no tiny day in the book's returns, and the curve
    still reproduces every mark. Fails today: the stale rows and the stated P&L coexist, and the
    compose degrades the book with ``key_inputs_mismatch``."""
    db = KeyDb()
    _seed_tail_marks(db, KEY)
    for day, value in STALE_TAIL.items():
        db.csv[(KEY, day)] = value
    capture = await _derive_tail_key(db)

    payload = await compose_curve(db, capture)
    assert payload["degrade_reasons"] == []
    assert payload["is_trustworthy"] is True
    book = {row["date"]: row["r"] for row in payload["returns"]}
    for day in TINY_DAYS:
        assert day not in book, f"the book holds a return on the stated day {day}"
    curve = levels(payload)
    for day, nav in MARKS.items():
        assert curve[day] == pytest.approx(nav, rel=1e-9), f"the curve lost {day}"


async def _derive_lead_key(db: KeyDb) -> dict:
    result, capture = await derive_key_ccxt(
        db,
        returns=series(LEAD_REALIZED),
        now=at_0010("2026-03-12"),
        equity=101000.0,
        upl=0.0,
        flows=LEAD_FLOWS,
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    return capture


async def _derive_strategy(
    db: StrategyDb, *, returns_by_day: dict[str, float], now_day: str, equity: float,
    flows: list[ExternalFlow],
) -> dict:
    """The strategy-mode derive. The wall-clock retention terminus is pinned off, as the key
    harness pins it: these fixtures sit in March 2026, and with a flow in the data the terminus
    would NaN every pre-start day and end the derive at ``<2 interpretable daily-return days``."""
    with patch("services.nav_twr.flow_coverage_terminus_day", new=MagicMock(return_value=None)):
        result, capture = await derive_ccxt_strategy(
            db, returns=series(returns_by_day), now=at_0010(now_day), equity=equity, upl=0.0,
            flows=flows,
        )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    return capture


@pytest.mark.asyncio
async def test_key_leading_edge_stale_rows_are_deleted() -> None:
    """The leading edge, key mode. 03-07 (a gap day) and 03-08 (measured against 400) are stated;
    the rows an earlier derive left on them and on the gap day 03-09 are gone, and the rows are
    exactly the two measured days. Fails today: the span starts at the first measured row (03-10),
    so no stale row before it is named by the delete."""
    db = KeyDb()
    for day, nav in LEAD_MARKS.items():
        seed_mark(db, day, nav, key=KEY, open_pnl=0.0, venue="okx")
    for day, value in LEAD_STALE.items():
        db.csv[(KEY, day)] = value
    capture = await _derive_lead_key(db)

    ki = _key_inputs_payload(capture, KEY)
    assert ki["tiny_base_days"] == LEAD_STATED
    rows = db.rows()
    assert stored_on_stated(rows, ki["tiny_base_days"]) == set()
    assert rows == pytest.approx(LEAD_ROWS, abs=1e-12)
    assert set(rows) == set(LEAD_ROWS)


@pytest.mark.asyncio
async def test_strategy_tail_stale_rows_on_stated_days_are_deleted() -> None:
    """Key C's tail on the strategy axis. The pre-stamp states the three tiny days and no stale
    row of the strategy survives on them. Fails today for the same reason as the key arm."""
    db = StrategyDb()
    _seed_tail_marks(db, "key-s")
    for day, value in STALE_TAIL.items():
        db.csv[(STRATEGY, day)] = value
    capture = await _derive_strategy(
        db, returns_by_day=REALIZED_THROUGH_0305, now_day="2026-03-10", equity=249.0,
        flows=[ExternalFlow(utc_day_iso="2026-03-06", usd_signed=WITHDRAWAL)],
    )

    stated = prestamp(capture)["tiny_base_days"]
    assert stated == TINY_DAYS
    rows = db.rows()
    assert stored_on_stated(rows, stated) == set(), "a stale row sits on a stated day"
    assert {d: v for d, v in rows.items() if d < "2026-03-06"} == REALIZED_THROUGH_0305
    assert rows["2026-03-06"] == pytest.approx(0.0, abs=1e-12)


@pytest.mark.asyncio
async def test_strategy_leading_edge_stale_rows_are_deleted() -> None:
    """The leading edge on the strategy axis, the key arm's fixture and expectations."""
    db = StrategyDb()
    for day, nav in LEAD_MARKS.items():
        seed_mark(db, day, nav, open_pnl=0.0, venue="okx")
    for day, value in LEAD_STALE.items():
        db.csv[(STRATEGY, day)] = value
    capture = await _derive_strategy(
        db, returns_by_day=LEAD_REALIZED, now_day="2026-03-12", equity=101000.0, flows=LEAD_FLOWS,
    )

    stated = prestamp(capture)["tiny_base_days"]
    assert stated == LEAD_STATED
    rows = db.rows()
    assert stored_on_stated(rows, stated) == set()
    assert rows == pytest.approx(LEAD_ROWS, abs=1e-12)
    assert set(rows) == set(LEAD_ROWS)


@pytest.mark.asyncio
async def test_rows_outside_the_hull_and_other_scopes_are_kept() -> None:
    """T-188-28. Key C's tail (payload days 03-01..03-06, stated days through 03-09), plus a row
    before the earliest day (02-20), a row after the latest stated day (03-11) and a sibling key's
    row on a stated day (03-07). All three are kept unchanged; the stated days have no row.
    Reddens when the hull reaches past either end of the run's own days or the delete loses its
    per-key scope."""
    db = KeyDb()
    _seed_tail_marks(db, KEY)
    for day, value in STALE_TAIL.items():
        db.csv[(KEY, day)] = value
    kept_key = {"2026-02-20": 0.003, "2026-03-11": 0.004}
    for day, value in kept_key.items():
        db.csv[(KEY, day)] = value
    db.csv[(SIBLING, "2026-03-07")] = 0.0123
    capture = await _derive_tail_key(db)

    ki = _key_inputs_payload(capture, KEY)
    rows = db.rows()
    assert stored_on_stated(rows, ki["tiny_base_days"]) == set()
    for day, value in kept_key.items():
        assert rows[day] == value, f"{day} is outside the hull and must be kept"
    assert db.rows(SIBLING) == {"2026-03-07": 0.0123}


@pytest.mark.asyncio
async def test_key_under_two_measured_days_clears_the_marked_era() -> None:
    """GC1-02 and GC2-01. A young key whose marks leave fewer than two interpretable rows takes the
    insufficient-history short-circuit. The rows an earlier derive left on the days it states as
    left out (03-07, 03-08) and on the rest of the marked era (03-06 through the last mark 03-10)
    are gone, except the one day this derive measured (03-10, 212/100588), which is stored. A row
    before the era (03-05) and a sibling's row stay, and the book carries no ``key_inputs_mismatch``.
    Fails without the delete: the stale rows stay beside the stated ``dropped_day_pnl``. Fails when
    the delete drops the measured day: the key's series then ends before the stored
    ``realized_terminal_day`` and the compose names the book a mismatch."""
    db = KeyDb()
    for day, nav in {"2026-03-06": 100000.0, "2026-03-08": 588.0, "2026-03-10": 100800.0}.items():
        seed_mark(db, day, nav, key=KEY, open_pnl=0.0, venue="okx")
    for day, value in {**LEAD_STALE, "2026-03-10": 0.002}.items():
        db.csv[(KEY, day)] = value
    db.csv[(KEY, "2026-03-05")] = 0.004
    db.csv[(SIBLING, "2026-03-07")] = 0.0123
    result, capture = await derive_key_ccxt(
        db,
        returns=series(LEAD_REALIZED),
        now=at_0010("2026-03-11"),
        equity=100800.0,
        upl=0.0,
        flows=LEAD_FLOWS,
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message

    ki = _key_inputs_payload(capture, KEY)
    assert ki["tiny_base_days"] == LEAD_STATED
    assert stored_on_stated(db.rows(), ki["tiny_base_days"]) == set()
    assert db.rows() == pytest.approx(
        {"2026-03-05": 0.004, "2026-03-10": 212.0 / 100588.0}, abs=1e-12
    ), "the marked era holds a stale row, or lost the day this derive measured"
    assert db.rows(SIBLING) == {"2026-03-07": 0.0123}
    payload = await compose_curve(db, capture)
    assert "key_inputs_mismatch" not in payload["degrade_reasons"]


@pytest.mark.asyncio
async def test_key_dust_base_last_mark_day_stale_row_is_deleted() -> None:
    """GC1-01, the tail variant. The last mark's base (the previous mark, 50.0) is under the
    100.0 dust floor, so 03-08 is neither a row nor a stated day, yet the marks own it. A row an
    earlier derive stored there is gone after the derive. Fails without the marked-era hull: the
    span ends at the last measured day (03-07) and the 03-08 row stays."""
    db = KeyDb()
    for day, nav in {"2026-03-06": 100000.0, "2026-03-07": 50.0, "2026-03-08": 60.0}.items():
        seed_mark(db, day, nav, key=KEY, open_pnl=0.0, venue="okx")
    db.csv[(KEY, "2026-03-08")] = 0.07
    result, capture = await derive_key_ccxt(
        db,
        returns=series(REALIZED_THROUGH_0305),
        now=at_0010("2026-03-09"),
        equity=60.0,
        upl=0.0,
        flows=[],
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message

    assert "tiny_base_days" not in _key_inputs_payload(capture, KEY)
    rows = db.rows()
    assert "2026-03-07" in rows, "the last measured mark day must still carry its row"
    assert "2026-03-08" not in rows, "a stale row sits on the last mark day"


@pytest.mark.asyncio
async def test_with_no_stated_day_the_span_is_the_payload_span() -> None:
    """With no tiny day the hull is the payload span and nothing else: a row before the first
    payload day (02-20) and after the last (03-11) is kept, an interior gap day (03-08, which the
    marks do not cover) is deleted as it was before this fix. Reddens when the hull ignores that
    it has no stated day and widens anyway."""
    db = KeyDb()
    seed_okx_marks(db)
    db.csv[(KEY, "2026-02-20")] = 0.003
    db.csv[(KEY, "2026-03-11")] = 0.004
    db.csv[(KEY, "2026-03-08")] = 0.5
    result, capture = await derive_okx(db)
    assert result.outcome == DispatchOutcome.DONE, result.error_message

    assert "tiny_base_days" not in _key_inputs_payload(capture, KEY)
    rows = db.rows()
    assert rows["2026-02-20"] == 0.003
    assert rows["2026-03-11"] == 0.004
    assert "2026-03-08" not in rows
