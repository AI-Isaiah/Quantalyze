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


# ---------------------------------------------------------------------------
# Phase 76-01 Task 3 — fetch_ccxt_transfers OKX/Bybit under-pagination fix.
#
# WHY (Rule 9): fetch_ccxt_transfers requests page_limit=500 per call, but OKX
# caps transfer history at 100 rows/page and Bybit at 50 rows/page (RESEARCH
# Pitfall 3, introspected ccxt 4.5.59). The old `if len(page) < page_limit:
# break` mistook a FULL but venue-capped page for end-of-history and dropped
# every transfer past page 1 — silently truncating real capital flows
# (threat T-76-01-TRUNC). Termination must be driven by cursor-non-advance /
# empty page / window-end, NEVER by a short page relative to the requested cap.
# ---------------------------------------------------------------------------

from datetime import datetime, timezone  # noqa: E402
from unittest.mock import MagicMock  # noqa: E402

import ccxt.async_support as _ccxt  # noqa: E402

from services.ccxt_flow_fetch import fetch_ccxt_transfers  # noqa: E402

_WINDOW_START_MS = int(
    datetime(2026, 1, 1, tzinfo=timezone.utc).timestamp() * 1000
)


def _make_capped_transfer_fetcher(events: list[dict], cap: int):
    """A ccxt fetch_deposits/withdrawals double that returns AT MOST ``cap``
    rows per call regardless of the (larger) requested limit — mirroring a
    venue whose real per-page cap sits below fetch_ccxt_transfers' page_limit
    of 500. Rows are those with timestamp >= since_ms, ascending."""
    call_log: list[tuple[int, int]] = []

    async def _fetch(_symbol, since_ms, _limit, _params=None):
        call_log.append((since_ms, _limit))
        matching = [e for e in events if e["timestamp"] >= since_ms]
        matching.sort(key=lambda e: e["timestamp"])
        return matching[:cap]

    return _fetch, call_log


async def test_transfers_bybit_50_per_page_multi_page_not_truncated() -> None:
    """Bybit caps transfers at 50/page. A 170-row single-window history spread
    over 4 capped pages must return ALL 170 rows — the old len<500 break
    truncated this to 50 (page 1 only)."""
    window_start_ms = _WINDOW_START_MS
    now_ms = window_start_ms + 60 * 24 * 60 * 60 * 1000  # single 90-day window
    six_h = 6 * 60 * 60 * 1000
    events = [
        {"timestamp": window_start_ms + i * six_h, "currency": "USDT", "amount": 1.0}
        for i in range(170)
    ]
    fetcher, call_log = _make_capped_transfer_fetcher(events, cap=50)
    exchange = MagicMock()
    exchange.fetch_deposits = fetcher

    rows = await fetch_ccxt_transfers(exchange, "deposits", window_start_ms, now_ms)

    assert len(rows) == 170, (
        f"expected all 170 Bybit (50/page) transfers; got {len(rows)}. "
        f"len<500 break truncates a full 50-row page as end-of-history. "
        f"Call log: {call_log!r}"
    )


async def test_transfers_okx_100_per_page_multi_page_not_truncated() -> None:
    """OKX caps transfers at 100/page. Two FULL 100-row pages must both be
    fetched — the old len<500 break stopped after page 1 (100 rows)."""
    window_start_ms = _WINDOW_START_MS
    now_ms = window_start_ms + 60 * 24 * 60 * 60 * 1000
    four_h = 4 * 60 * 60 * 1000
    events = [
        {"timestamp": window_start_ms + i * four_h, "currency": "USDT", "amount": 1.0}
        for i in range(200)
    ]
    fetcher, call_log = _make_capped_transfer_fetcher(events, cap=100)
    exchange = MagicMock()
    exchange.fetch_withdrawals = fetcher

    rows = await fetch_ccxt_transfers(exchange, "withdrawals", window_start_ms, now_ms)

    assert len(rows) == 200, (
        f"expected both OKX (100/page) full pages; got {len(rows)}. "
        f"Call log: {call_log!r}"
    )


async def test_transfers_genuinely_short_final_page_terminates() -> None:
    """Regression guard for the OTHER direction: dropping the len<500 break
    must not cause an over-fetch / infinite loop. A Binance-style history
    that fits in a single short page still terminates on the empty follow-up
    page (cursor-advance + empty-page discipline)."""
    window_start_ms = _WINDOW_START_MS
    now_ms = window_start_ms + 30 * 24 * 60 * 60 * 1000
    day_ms = 24 * 60 * 60 * 1000
    events = [
        {"timestamp": window_start_ms + i * day_ms, "currency": "USDT", "amount": 1.0}
        for i in range(7)
    ]
    fetcher, call_log = _make_capped_transfer_fetcher(events, cap=1000)
    exchange = MagicMock()
    exchange.fetch_deposits = fetcher

    rows = await fetch_ccxt_transfers(exchange, "deposits", window_start_ms, now_ms)

    assert len(rows) == 7
    # First call returns all 7; second call (cursor past last event) is empty
    # → natural stop. No runaway paging.
    assert len(call_log) == 2, f"expected fetch → empty-terminate; got {call_log!r}"


async def test_transfers_not_supported_returns_partial_not_raise() -> None:
    """WR-04 discipline preserved through the pagination fix: ccxt.NotSupported
    (feature detection) still short-circuits to whatever was collected, while
    any OTHER exception must bubble (asserted elsewhere via the handler path)."""
    async def _raises_not_supported(_symbol, _since, _limit, _params=None):
        raise _ccxt.NotSupported("venue cannot enumerate transfers")

    exchange = MagicMock()
    exchange.fetch_deposits = _raises_not_supported

    rows = await fetch_ccxt_transfers(exchange, "deposits", 0, 1_000)
    assert rows == []


async def test_transfers_boundary_flow_not_double_counted() -> None:
    """LOW-1: a transfer whose timestamp lands EXACTLY on a 90-day window boundary
    is fetchable in BOTH adjacent windows (the next window's inclusive `since` ==
    the prior window's end, and a venue page can spill rows a few ms past the
    window end). Dedup by transfer `id` must count it exactly once — a
    double-counted deposit/withdrawal would corrupt the flow-aware TWR base.
    MUTATION: removing the id-dedup double-counts the boundary flow → RED."""
    window_ms = 90 * 24 * 60 * 60 * 1000
    ws = _WINDOW_START_MS
    day = 24 * 60 * 60 * 1000
    now_ms = ws + window_ms + 2 * day  # spans two 90-day windows

    events = [
        {"id": "e0", "timestamp": ws, "currency": "USDT", "amount": 1.0},
        {"id": "eB", "timestamp": ws + window_ms, "currency": "USDT", "amount": 1.0},
        {"id": "e2", "timestamp": ws + window_ms + day, "currency": "USDT",
         "amount": 1.0},
    ]

    async def _fetch(_symbol, since_ms, _limit, _params=None):
        # Unbounded venue page (models a call that returns rows spilling past the
        # requested 90-day window end, as a real 90d-capped endpoint can when
        # `since` is mid-window).
        matching = [e for e in events if e["timestamp"] >= since_ms]
        matching.sort(key=lambda e: e["timestamp"])
        return matching

    exchange = MagicMock()
    exchange.fetch_deposits = _fetch

    rows = await fetch_ccxt_transfers(exchange, "deposits", ws, now_ms)

    ids = [r["id"] for r in rows]
    assert ids.count("eB") == 1, (
        f"boundary flow eB double-counted across adjacent windows: {ids}"
    )
    # Every transfer appears exactly once — no over-fetch, none lost.
    assert sorted(ids) == ["e0", "e2", "eB"], f"expected each flow once; got {ids}"


async def test_transfers_page_ceiling_logs_warning_not_silent_truncation(
    caplog,
) -> None:
    """NIT-1 (specialist-silentfailure): if a single 90-day window genuinely
    exceeds the ~50k-row (1000-page) safety ceiling, the inner loop falls
    through to the next window — a SILENT truncation of transfer history, the
    exact direction this module otherwise guards hard. A cursor-advancing,
    never-empty, never-window-end fetcher forces the ceiling; the run must emit a
    LOUD warning (never a silent drop) and still return the collected rows.

    Mutation-honest: removing the for/else warning branch leaves caplog empty →
    RED. No raw amount appears in the log (account-size leak discipline).
    """
    import logging

    window_start_ms = _WINDOW_START_MS
    now_ms = window_start_ms + 89 * 24 * 60 * 60 * 1000  # ONE 90-day window
    step = 1000  # ms the cursor advances per page (well within the window)

    async def _never_terminating(_symbol, since_ms, _limit, _params=None):
        # Always a non-empty page whose max timestamp ADVANCES the cursor and
        # never reaches window_end → no natural break → the ceiling triggers.
        return [{"id": f"r{since_ms}", "timestamp": since_ms + step,
                 "currency": "USDT", "amount": 1.0}]

    exchange = MagicMock()
    exchange.rateLimit = None  # _rate_limit_sleep no-ops → fast
    exchange.fetch_deposits = _never_terminating

    with caplog.at_level(logging.WARNING, logger="quantalyze.analytics.ccxt_flow_fetch"):
        rows = await fetch_ccxt_transfers(exchange, "deposits", window_start_ms, now_ms)

    ceiling_warnings = [
        r for r in caplog.records if "ceiling" in r.getMessage()
    ]
    assert ceiling_warnings, (
        "hitting the 1000-page ceiling must log a LOUD warning, never silently "
        "truncate transfer history"
    )
    # The collected rows (partial) are still returned — never raised, never []'d.
    assert len(rows) == 1000, f"expected the ceiling's worth of rows; got {len(rows)}"
    # Account-size leak discipline: no raw USD amount in the warning message.
    assert "1.0" not in ceiling_warnings[0].getMessage()
