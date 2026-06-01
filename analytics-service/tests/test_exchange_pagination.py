"""B18 - standalone contract tests for the walk_paginated driver.

These pin the driver's loop semantics independent of any provider, so the
behaviour-preserving migration of each fetcher can rely on them. Each test
encodes WHY a semantic matters (Rule 9): the killer regression class it guards.
"""

from __future__ import annotations

import pytest

from services.exchange_pagination import (
    PageRequest,
    PageResult,
    PaginationCeilingExceeded,
    ProviderPaginationContract,
    walk_paginated,
)

_NOW_MS = 1_700_000_000_000  # fixed clock for window-math assertions


def _contract(**overrides: object) -> ProviderPaginationContract:
    base: dict[str, object] = dict(
        fetcher="test",
        page_cap=200,
        on_ceiling="flag",
        stop_on_short_page=True,
        stuck_cursor_is_stop=True,
    )
    base.update(overrides)
    return ProviderPaginationContract(**base)  # type: ignore[arg-type]


def _scripted_fetch_page(
    pages_by_inst: dict[str | None, list[PageResult[int]]],
    seen: list[PageRequest],
):
    """Return a fetch_page that replays scripted PageResults per inst_type and
    records every PageRequest it was handed."""
    counters: dict[str | None, int] = {}

    async def _fetch_page(req: PageRequest) -> PageResult[int]:
        seen.append(req)
        idx = counters.get(req.inst_type, 0)
        counters[req.inst_type] = idx + 1
        script = pages_by_inst.get(req.inst_type, [])
        if idx < len(script):
            return script[idx]
        # Past the script: an empty terminal page (natural stop).
        return PageResult(rows=[], next_cursor="", is_empty=True)

    return _fetch_page


async def test_window_walk_no_overlap_no_gap() -> None:
    """21-day span in 7-day windows -> 3 contiguous windows, next_start = prev_end+1.

    Guards the NEW-C30-01 boundary: a dropped +1 re-reads a boundary row;
    a doubled +1 leaves a 1ms gap (silent realized-PnL undercount)."""
    seen: list[PageRequest] = []
    start = _NOW_MS - 21 * 24 * 60 * 60 * 1000
    contract = _contract(
        window_max_days=7, stop_on_short_page=False, stuck_cursor_is_stop=False
    )
    await walk_paginated(
        contract,
        since_ms=start,
        now_ms=_NOW_MS,
        fetch_page=_scripted_fetch_page({}, seen),
    )
    windows = [(r.window_start, r.window_end) for r in seen]
    assert len(windows) == 3
    day7 = 7 * 24 * 60 * 60 * 1000
    assert windows[0] == (start, start + day7)
    # contiguous, no overlap, no gap
    assert windows[1][0] == windows[0][1] + 1
    assert windows[2][0] == windows[1][1] + 1
    assert windows[2][1] == _NOW_MS  # final window clamps to now


async def test_single_window_when_no_window_max_days() -> None:
    seen: list[PageRequest] = []
    contract = _contract(window_max_days=None)
    await walk_paginated(
        contract, since_ms=123, now_ms=_NOW_MS,
        fetch_page=_scripted_fetch_page({}, seen),
    )
    assert [(r.window_start, r.window_end) for r in seen] == [(123, None)]


async def test_gated_inst_type_never_fetched_and_not_missing() -> None:
    """Gated bybit-inverse: never appears in a PageRequest AND never counts as
    a missing-coverage omission. The gate is data the coverage check reads."""
    seen: list[PageRequest] = []
    contract = _contract(
        inst_types=("linear", "inverse"),
        gated_inst_types=frozenset({"linear"}),
        window_max_days=None,
    )
    result = await walk_paginated(
        contract, since_ms=1, now_ms=_NOW_MS,
        fetch_page=_scripted_fetch_page({}, seen),
    )
    assert all(r.inst_type != "inverse" for r in seen)
    assert "inverse" not in result.inst_types_missing
    assert result.inst_types_covered == {"linear"}
    assert result.inst_types_missing == set()


async def test_graceful_skip_surfaces_missing_and_abandons_windows() -> None:
    """Runtime-skipped inverse (no gate): linear rows still returned, inverse
    surfaces as missing, and its remaining windows are abandoned (one attempt)."""
    seen: list[PageRequest] = []
    contract = _contract(
        inst_types=("linear", "inverse"),
        gated_inst_types=frozenset(),  # no gate - inverse is expected
        window_max_days=7,
        stop_on_short_page=False,
        stuck_cursor_is_stop=False,
    )
    pages = {
        "linear": [PageResult(rows=[1, 2], next_cursor="", is_empty=False)] * 10,
        "inverse": [PageResult(rows=[], skip_inst_type=True)],
    }
    result = await walk_paginated(
        contract, since_ms=_NOW_MS - 21 * 24 * 60 * 60 * 1000, now_ms=_NOW_MS,
        fetch_page=_scripted_fetch_page(pages, seen),
    )
    assert 1 in result.rows and 2 in result.rows
    assert result.inst_types_missing == {"inverse"}
    assert "inverse" not in result.inst_types_covered
    # inverse attempted exactly once - remaining windows abandoned
    assert sum(1 for r in seen if r.inst_type == "inverse") == 1


async def test_ceiling_raise_when_page_cap_exhausted_on_live_page() -> None:
    """on_ceiling=raise + a never-ending full/live page -> raises the contract's
    exception (funding fail-loud)."""
    seen: list[PageRequest] = []
    contract = _contract(
        page_cap=5, on_ceiling="raise",
        stop_on_short_page=False, stuck_cursor_is_stop=False,
        window_max_days=None,
    )

    async def _always_more(req: PageRequest) -> PageResult[int]:
        seen.append(req)
        return PageResult(rows=[1], next_cursor=f"c{len(seen)}", is_full_page=True)

    with pytest.raises(PaginationCeilingExceeded):
        await walk_paginated(contract, since_ms=1, now_ms=_NOW_MS, fetch_page=_always_more)
    assert len(seen) == 5  # exactly page_cap attempts


async def test_ceiling_label_appears_in_message() -> None:
    """ceiling_label is interpolated into the ceiling message so funding can
    keep its operator-facing "MAX_PAGES" wording (the contract test in
    test_funding_fetch pins that string)."""
    contract = _contract(
        page_cap=2, on_ceiling="raise", ceiling_label="MAX_PAGES",
        stop_on_short_page=False, stuck_cursor_is_stop=False,
        window_max_days=None,
    )

    async def _always_more(req: PageRequest) -> PageResult[int]:
        return PageResult(rows=[1], next_cursor="live", is_full_page=True)

    with pytest.raises(PaginationCeilingExceeded, match="MAX_PAGES=2"):
        await walk_paginated(contract, since_ms=1, now_ms=_NOW_MS, fetch_page=_always_more)


async def test_ceiling_flag_when_page_cap_exhausted() -> None:
    """on_ceiling=flag -> no raise, truncated_inst_types records the cap hit."""
    contract = _contract(
        page_cap=3, on_ceiling="flag",
        stop_on_short_page=False, stuck_cursor_is_stop=False,
        inst_types=("SWAP",), window_max_days=None,
    )

    async def _always_more(req: PageRequest) -> PageResult[int]:
        return PageResult(rows=[1], next_cursor="live", is_full_page=True)

    result = await walk_paginated(contract, since_ms=1, now_ms=_NOW_MS, fetch_page=_always_more)
    assert result.truncated is True
    assert result.truncated_inst_types == {"SWAP"}


async def test_cursor_authoritative_does_not_stop_on_short_page() -> None:
    """THE killer regression (red-team): a cursor-authoritative walk
    (stop_on_short_page=False) must keep going past a SHORT page that still has
    a live cursor. Two 1-row short pages + live cursor -> both fetched."""
    seen: list[PageRequest] = []
    contract = _contract(
        stop_on_short_page=False, stuck_cursor_is_stop=False, window_max_days=None,
    )
    pages = {
        None: [
            PageResult(rows=[1], next_cursor="page2", is_full_page=False),
            PageResult(rows=[2], next_cursor="", is_full_page=False),
        ]
    }
    result = await walk_paginated(
        contract, since_ms=1, now_ms=_NOW_MS,
        fetch_page=_scripted_fetch_page(pages, seen),
    )
    assert result.rows == [1, 2]


async def test_short_page_authoritative_stops_on_short_page() -> None:
    """A short-page-authoritative walk (stop_on_short_page=True) stops on the
    first non-full page even with a live cursor."""
    seen: list[PageRequest] = []
    contract = _contract(
        stop_on_short_page=True, stuck_cursor_is_stop=False, window_max_days=None,
    )
    pages = {
        None: [
            PageResult(rows=[1], next_cursor="page2", is_full_page=False),
            PageResult(rows=[2], next_cursor="", is_full_page=False),
        ]
    }
    result = await walk_paginated(
        contract, since_ms=1, now_ms=_NOW_MS,
        fetch_page=_scripted_fetch_page(pages, seen),
    )
    assert result.rows == [1]  # stopped after the first short page


async def test_stuck_cursor_is_stop_vs_ceiling() -> None:
    """stuck_cursor_is_stop=True -> a repeated cursor is a natural stop (no flag).
    stuck_cursor_is_stop=False -> the same repeat exhausts to the ceiling."""
    async def _echo_cursor(req: PageRequest) -> PageResult[int]:
        return PageResult(rows=[1], next_cursor="same", is_full_page=True)

    stop_contract = _contract(
        page_cap=10, on_ceiling="flag",
        stop_on_short_page=False, stuck_cursor_is_stop=True, window_max_days=None,
    )
    r1 = await walk_paginated(stop_contract, since_ms=1, now_ms=_NOW_MS, fetch_page=_echo_cursor)
    assert r1.truncated is False  # stuck cursor = natural stop, not a ceiling

    nostop_contract = _contract(
        page_cap=10, on_ceiling="flag",
        stop_on_short_page=False, stuck_cursor_is_stop=False,
        inst_types=("X",), window_max_days=None,
    )
    r2 = await walk_paginated(nostop_contract, since_ms=1, now_ms=_NOW_MS, fetch_page=_echo_cursor)
    assert r2.truncated is True  # no stuck guard -> exhausts to ceiling


async def test_empty_page_is_natural_stop() -> None:
    seen: list[PageRequest] = []
    contract = _contract(stop_on_short_page=False, stuck_cursor_is_stop=False, window_max_days=None)
    pages = {None: [PageResult(rows=[], next_cursor="live", is_empty=True)]}
    result = await walk_paginated(
        contract, since_ms=1, now_ms=_NOW_MS,
        fetch_page=_scripted_fetch_page(pages, seen),
    )
    assert result.rows == []
    assert len(seen) == 1  # stopped on the empty page despite a live cursor


async def test_all_dropped_page_is_not_empty_and_advances() -> None:
    """A page whose items all failed normalisation (rows == []) is NOT is_empty
    - it must advance the cursor, not stop (guards funding's dropped-row path)."""
    seen: list[PageRequest] = []
    contract = _contract(stop_on_short_page=False, stuck_cursor_is_stop=False, window_max_days=None)
    pages = {
        None: [
            PageResult(rows=[], next_cursor="page2", is_full_page=True, is_empty=False),
            PageResult(rows=[9], next_cursor="", is_empty=False),
        ]
    }
    result = await walk_paginated(
        contract, since_ms=1, now_ms=_NOW_MS,
        fetch_page=_scripted_fetch_page(pages, seen),
    )
    assert result.rows == [9]
    assert len(seen) == 2  # did NOT stop on the all-dropped page
