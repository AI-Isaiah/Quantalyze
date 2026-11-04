"""Phase 188 TINYBASE plan 01 - the tracer: key C's shape through a real OKX key-mode derive and
the real allocator compose (D-02, D-03, SC-3, SC-5).

What this pins, and why each test can fail
------------------------------------------
Key C's evidence, moved to the round-trip harness dates: a near-total withdrawal on the first
mark day, then marked moves of +47%, -53% and -10% on what is left. The fixture is synthetic.

* Realized rows 2026-03-01..2026-03-05 (``REALIZED_THROUGH_0305``).
* One external flow of -99600.0 dated 2026-03-06 (the near-total withdrawal).
* Marks (``open_pnl`` 0.0): 03-06 nav 400.0, 03-07 nav 588.0, 03-08 nav 278.0, 03-09 nav 249.0.
* The derive runs at 00:10Z on 2026-03-10 with a live read of equity 249.0, upl 0.0.

The first mark's base is its wallet rolled back one day: (400.0 - (-99600.0)) / (1 + 0) =
100000.0 at 2026-03-05. Hand arithmetic of every expected value:

* r(03-06) = (400 - 100000 - (-99600)) / 100000 = 0 / 100000 = 0.0, a real measured day.
* 03-07: base 400.0 against a 30-day peak of 100000.0, 400 < 0.05 * 100000 = 5000, so tiny.
  Its P&L is 588 - 400 - 0 = +188.0 (the old row would be 188/400 = +0.47).
* 03-08: base 588.0 against the same peak, tiny. P&L 278 - 588 - 0 = -310.0 (old -310/588).
* 03-09: base 278.0, tiny. P&L 249 - 278 - 0 = -29.0 (old -29/278).

A tiny-base day has NO stored return row (the column is NOT NULL, so null means no row, and a
0.0 would be an invented number). Its P&L rides ``key_inputs.dropped_day_pnl``, which the compose
already reads, so the dollar curve still reproduces every mark.

Why each test can fail: on code that measures the tiny days, the row test sees the +0.47 /
-310/588 / -29/278 rows, the P&L test sees an empty ``dropped_day_pnl``, the sole-key test sees
the extra return rows, and the two-key test sees a blend of +0.47 and 0.001 instead of the
sibling's 0.001. A rule that dropped the rows but forgot the P&L fails the curve pin (the
compose could not step the level through the three days).
"""
from __future__ import annotations

import pytest

from services.external_flows import ExternalFlow
from services.job_worker import DispatchOutcome
from tests.test_nav_marks_compose_roundtrip import (
    KeyDb,
    compose_curve,
    derive_key_ccxt,
    levels,
    realized_levels,
)
from tests.test_nav_marks_derive_apply import (
    REALIZED_THROUGH_0305,
    at_0010,
    seed_mark,
    series,
)
from tests.test_allocator_equity_dropped_day_pnl import _key_inputs_payload

KEY = "key-k"
MARKS = {
    "2026-03-06": 400.0,
    "2026-03-07": 588.0,
    "2026-03-08": 278.0,
    "2026-03-09": 249.0,
}
TINY_DAYS = ["2026-03-07", "2026-03-08", "2026-03-09"]
# nav - base - flow, typed beside the sum it comes from (588-400, 278-588, 249-278).
TINY_PNL = {"2026-03-07": 188.0, "2026-03-08": -310.0, "2026-03-09": -29.0}
WITHDRAWAL = -99600.0
START_LEVEL = 100000.0  # (400 - (-99600)) / (1 + 0)


async def _derive_key_c() -> tuple[KeyDb, dict]:
    db = KeyDb()
    for day, nav in MARKS.items():
        seed_mark(db, day, nav, key=KEY, open_pnl=0.0, venue="okx")
    result, capture = await derive_key_ccxt(
        db,
        returns=series(REALIZED_THROUGH_0305),
        now=at_0010("2026-03-10"),
        equity=249.0,
        upl=0.0,
        flows=[ExternalFlow(utc_day_iso="2026-03-06", usd_signed=WITHDRAWAL)],
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    return db, capture


@pytest.mark.asyncio
async def test_key_c_shape_tiny_days_have_no_row() -> None:
    """SC-3's RED: the three days measured against a 400.0 base have no stored return."""
    db, _capture = await _derive_key_c()
    rows = db.rows()
    assert {d: v for d, v in rows.items() if d < "2026-03-06"} == REALIZED_THROUGH_0305
    assert rows["2026-03-06"] == pytest.approx(0.0, abs=1e-12)
    for day in TINY_DAYS:
        assert day not in rows, f"{day} is measured against a near-empty account"


@pytest.mark.asyncio
async def test_key_c_shape_pnl_reaches_key_inputs() -> None:
    """SC-5: the tiny days' real P&L is carried in key_inputs.dropped_day_pnl, each day once,
    ascending, and never as 0.0."""
    _db, capture = await _derive_key_c()
    ki = _key_inputs_payload(capture, KEY)
    rows = ki["dropped_day_pnl"]
    assert [r["utc_day_iso"] for r in rows] == TINY_DAYS
    for row in rows:
        assert row["pnl_usd"] == pytest.approx(TINY_PNL[row["utc_day_iso"]], abs=1e-9)
        assert row["pnl_usd"] != 0.0


@pytest.mark.asyncio
async def test_sole_key_book_leaves_the_tiny_days_out_and_keeps_the_curve() -> None:
    """A sole-key book has no return row on the tiny days and still has them in its dollar
    curve, which reproduces every mark and the pre-start levels."""
    db, capture = await _derive_key_c()
    payload = await compose_curve(db, capture)
    book = {row["date"]: row["r"] for row in payload["returns"]}
    assert book["2026-03-06"] == pytest.approx(0.0, abs=1e-12)
    for day in TINY_DAYS:
        assert day not in book, f"the book invented a return on {day}"
    curve = levels(payload)
    for day, nav in MARKS.items():
        assert curve[day] == pytest.approx(nav, rel=1e-9), f"the curve lost {day}"
    expected = realized_levels(REALIZED_THROUGH_0305, "2026-03-05", START_LEVEL, {})
    for day, level in expected.items():
        assert curve[day] == pytest.approx(level, rel=1e-9), f"a pre-start level moved on {day}"
    assert payload["degrade_reasons"] == []
    assert payload["is_trustworthy"] is True


@pytest.mark.asyncio
async def test_two_key_book_tiny_key_sits_out() -> None:
    """With a sibling that trades every day the tiny key sits out BOTH numerator and denominator
    of the book return on its tiny days: the book return is the sibling's 0.001 exactly."""
    db, capture = await _derive_key_c()
    sibling_days = [f"2026-03-{d:02d}" for d in range(1, 10)]
    payload = await compose_curve(db, capture, sibling_days=sibling_days)
    book = {row["date"]: row["r"] for row in payload["returns"]}
    for day in TINY_DAYS:
        assert book[day] == pytest.approx(0.001, abs=1e-12), f"{day} blended the tiny key in"
    assert "missing_return_inside_coverage" in payload["flags"]
    assert payload["is_trustworthy"] is True
