"""Phase 167.2.1.1.1.1 MARKSOURCE plan 06 - what is left of the cross-curve module after the legacy curve was deleted.

The module compared the legacy ``allocator_equity_snapshots`` curve, written by the daily refresh
job, with the derived curve over the key derive's marked series, on a hand-typed venue state per
marked day (D-01: agreement within max($1, 0.5% of level)). Phase 176 deleted the legacy writer,
so the comparison and its per-venue cases are gone. What stays is the one test that never
touched the legacy curve: a day with no stored mark, or a refused mark, has no derived level.
"""
from __future__ import annotations

import pytest

from services.job_worker import DispatchOutcome
from tests.test_allocator_positions_non_ccxt import (
    _reset_terminal_locks,
)
from tests.test_nav_marks_compose_roundtrip import (
    KEY,
    KeyDb,
    compose_curve,
    derive_key_ccxt,
    levels,
    seed_okx_marks,
)
from tests.test_nav_marks_derive_apply import REALIZED_THROUGH_0305, at_0010, series
from tests.test_nav_marks_writer import (  # noqa: F401  (autouse: re-binds the real writer)
    _real_marks_writer,
)


@pytest.mark.asyncio
async def test_excluded_no_mark_and_refused_mark_days_have_no_derived_level() -> None:
    """D-01 exclusion 3; NAVMTM D-05 and MARKSOURCE plan 03. A day with no stored mark has no
    derived level, and a day whose mark was REFUSED (the open profit was unreadable) gets none
    either, with no live-read step booked after the last mark. The cross-curve claim is made on
    the derived curve's own days, so these days are outside it.

    Typed (the roundtrip scenario): marks 03-06 = 1050.0 and 03-08 = 1071.0, so 03-07 has no
    mark (D-05); the derive at 00:10Z on 03-11 reads equity 1215.0 it cannot split into wallet
    and open profit, so 03-10 stores none (refused, ``upnl_unreadable``), and 03-09 has none.
    The curve ends on the 03-08 mark, 1071.0; the 144.0 up to the live 1215.0 is no step."""
    db = KeyDb()
    seed_okx_marks(db, {"2026-03-06": 1050.0, "2026-03-08": 1071.0})
    result, capture = await derive_key_ccxt(
        db, returns=series(REALIZED_THROUGH_0305), now=at_0010("2026-03-11"), equity=1215.0,
        upl=215.0, flows=[], upnl_unreadable=True,
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    unmarked = ("2026-03-07", "2026-03-09", "2026-03-10")
    for day in unmarked:
        assert (KEY, day) not in db.marks, f"{day} stored a mark"
    curve = levels(await compose_curve(db, capture))
    for day in unmarked:
        assert day not in curve, f"{day} has a derived level without a mark"
    assert curve["2026-03-06"] == pytest.approx(1050.0, rel=1e-9)
    assert curve["2026-03-08"] == pytest.approx(1071.0, abs=1e-9), "no live step on the mark day"
    assert max(curve) == "2026-03-08"
