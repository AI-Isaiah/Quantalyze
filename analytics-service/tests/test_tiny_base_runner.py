"""Phase 188 TINYBASE plan 05 - ``run_csv_strategy_analytics`` reads a marked-era tiny-base day as a
flagged gap, not a covered day (188 D-02, D-04, SC-2, RESEARCH Pitfall 3).

What this pins, and why each arm can fail
-----------------------------------------
The derive pre-stamps ``tiny_base_days`` (this plan, Task 1) and the runner rebuilds
``data_quality_flags`` wholesale, so it has to carry the list and read it:

* Marked era (D-04, "split by era", skip and keep the history). From ``marks_covered_from`` the
  stored rows are used as stored, and every absent day is a COVERED day (inside the next mark's
  single return). A tiny-base day is absent too, but it is not inside a return: ``apply_marks``
  left it out because its base is a sliver. The runner subtracts it from ``_covered_days``, so it
  becomes a gap span of the published cash series (flagged) and is not counted as covered. It
  stays out of the scalar input (no row, no 0.0 fill) and breaks no chain: ``headline_since`` and
  ``twr_chain_broken`` stay absent. Before this plan the day was silently a covered day: the RED
  contrast is the same rows without the list, whose ``covered_day_count`` is one higher.
* Realized era (D-04, "break"). A day before ``marks_covered_from`` is reinstated as NaN like
  every guard day, the headline restarts after it, and ``tiny_base_guard`` is published. That is
  today's behaviour and is pinned so the era split cannot drift.
* No marks at all: the list is carried into the published flags.
* The list is validated like ``mark_gap_days`` (T-188-09): a malformed list is dropped with ONE
  warning that names the key and the reason and never the value, and nothing is subtracted.
* The published flags never carry ``tiny_base_day_pnl`` (T-188-08), even if a pre-stamp wrongly
  held it: the runner has no code that copies it.

Every value is synthetic. The expected cumulative return and volatility are recomputed here from
the stored rows with the standard library, never from the code under test.
"""
from __future__ import annotations

import logging
import math
import statistics

import pytest

from tests.test_nav_marks_runner import _PRE_RETURNS, _PRESTAMP, _rows, _run

#: The marked-era day that is left out: 03-07 is the middle mark, and the 03-09 mark's return
#: covers 03-08 beside it.
_TINY = "2026-03-07"
_STAMP = {**_PRESTAMP, "tiny_base_days": [_TINY]}


def _present_returns(rows: list[dict]) -> list[float]:
    return [float(r["daily_return"]) for r in rows]


@pytest.mark.asyncio
async def test_a_marked_era_tiny_day_is_a_flagged_gap_and_breaks_no_chain() -> None:
    """Stored rows: 14 realized days, then marks 03-06 (+0.012) and 03-09 (+0.020); 03-07 has no
    row (tiny base) and 03-08 has none (covered by the 03-09 mark). The published series lists
    03-07 as a gap span and counts ONE covered day (03-08); the headline does not restart."""
    rows = _rows(drop=(_TINY,))
    payload, series = await _run(rows, dict(_STAMP))
    dq = payload["data_quality_flags"]

    assert series["gap_spans"] == [{"start": _TINY, "end": _TINY}]
    assert series["conventions"]["covered_day_count"] == 1
    assert "headline_since" not in dq, f"a tiny-base day read as a chain break: {dq!r}"
    assert "twr_chain_broken" not in dq
    assert dq["tiny_base_days"] == [_TINY]
    assert dq["mark_gap_days"] == ["2026-03-08"]
    assert payload["computation_status"] == "complete"
    assert payload["computation_warned"] is False

    # Out of the scalar input: only the present rows are observed, none chained across the gap.
    present = _present_returns(rows)
    assert len(present) == len(_PRE_RETURNS) + 2
    assert payload["cumulative_return"] == pytest.approx(
        math.prod(1.0 + r for r in present) - 1.0, abs=1e-9
    )
    assert payload["volatility"] == pytest.approx(
        statistics.stdev(present) * math.sqrt(365), rel=1e-6
    )


@pytest.mark.asyncio
async def test_without_the_list_the_same_rows_count_the_day_as_covered() -> None:
    """The RED contrast (today's behaviour): the same stored rows with no ``tiny_base_days`` read
    03-07 as a covered day - no gap span, two covered days - and publish no list."""
    payload, series = await _run(_rows(drop=(_TINY,)), dict(_PRESTAMP))

    assert series["gap_spans"] == []
    assert series["conventions"]["covered_day_count"] == 2
    assert "tiny_base_days" not in payload["data_quality_flags"]


@pytest.mark.asyncio
async def test_a_realized_era_tiny_day_breaks_the_chain_like_every_guard_day() -> None:
    """D-04, realized era: 03-03 (before ``marks_covered_from``) is absent and named. The load
    boundary reinstates it as NaN, the headline restarts the next day, the derive's guard bool is
    published (and warns, it is a NAV_TWR_GUARD_KEYS member), and the list is carried."""
    flags = {
        **_PRESTAMP, "twr_chain_broken": True, "tiny_base_guard": True,
        "tiny_base_days": ["2026-03-03"],
    }
    payload, series = await _run(_rows(drop=("2026-03-03",)), flags)
    dq = payload["data_quality_flags"]

    assert dq["headline_since"] == "2026-03-04"
    assert dq["twr_chain_broken"] is True
    assert dq["tiny_base_guard"] is True
    assert dq["tiny_base_days"] == ["2026-03-03"]
    assert payload["computation_status"] == "complete_with_warnings"
    assert series["gap_spans"] == [{"start": "2026-03-03", "end": "2026-03-03"}]
    # the marked-era covered day (03-08) is unaffected: still exactly one covered day
    assert series["conventions"]["covered_day_count"] == 1


@pytest.mark.asyncio
async def test_a_series_without_marks_still_carries_the_list() -> None:
    """A realized-only strategy: no marks boundary, the dense load reinstates the day as NaN, and
    the list the derive stamped survives the runner's wholesale rebuild."""
    rows = [r for r in _rows(drop=("2026-03-03",)) if r["date"] <= "2026-03-05"]
    flags = {
        "csv_source": True, "tiny_base_guard": True, "twr_chain_broken": True,
        "tiny_base_days": ["2026-03-03"],
    }
    payload, _series = await _run(rows, flags)
    dq = payload["data_quality_flags"]

    assert dq["tiny_base_days"] == ["2026-03-03"]
    assert dq["tiny_base_guard"] is True
    assert "marks_since" not in dq


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "bad",
    ["2026-03-07", ["2026-02-30"], ["2026-03-07", 5], ["20260307"], [None]],
    ids=["not-a-list", "impossible-date", "non-string", "compact-date", "null-element"],
)
async def test_a_malformed_list_is_dropped_with_one_warning_and_subtracts_nothing(
    bad: object, caplog: pytest.LogCaptureFixture
) -> None:
    """T-188-09. A bad list moves no covered day and reaches no public row: the rows read exactly
    as with no list (two covered days, no gap span), and one warning names the key and the reason
    and quotes no value."""
    with caplog.at_level(logging.WARNING, logger="quantalyze.analytics.runner"):
        payload, series = await _run(_rows(drop=(_TINY,)), {**_PRESTAMP, "tiny_base_days": bad})

    assert "tiny_base_days" not in payload["data_quality_flags"]
    assert series["conventions"]["covered_day_count"] == 2
    assert series["gap_spans"] == []
    warned = [r.getMessage() for r in caplog.records if "not carried" in r.getMessage()]
    assert sum("tiny_base_days" in m for m in warned) == 1, warned
    for value in ("2026-03-07", "2026-02-30", "20260307"):
        assert not any(value in m for m in warned), f"a warning quoted {value!r}: {warned!r}"


@pytest.mark.asyncio
async def test_the_published_flags_never_carry_an_amount() -> None:
    """T-188-08. A pre-stamp that (wrongly) holds ``tiny_base_day_pnl`` does not reach the
    published flags: the runner copies only the validated day lists and the guard bool."""
    flags = {**_STAMP, "tiny_base_day_pnl": {_TINY: 188.0}}
    payload, series = await _run(_rows(drop=(_TINY,)), flags)

    assert "tiny_base_day_pnl" not in payload["data_quality_flags"]
    assert "188.0" not in repr(payload["data_quality_flags"])
    assert "188.0" not in repr(series["conventions"])
