"""Phase 231 BYBITREADS plan 02 - tests for ``scripts/bybitreads_probe.py``.

The probe is the research-first instrument of the phase: it measures the VENUE (not the repo's
own functions) for the trade-window question (VREAD-03), the on-chain deposit question (VREAD-04)
and the exposure counts census rows C18, C19 and C27 need. It runs once on the Railway backfill
worker with a decrypted production key, so every gate here has to be able to fail. Nothing here
touches a venue or a database: the venue is a fake that answers by the venue's own rules.

Why each group matters (Rule 9):
  * section A (trade window): the legacy shape must read ONE week and the windowed shape every
    week, and that has to come from the venue model (``BybitExecutionBook``), not from the probe's
    own parameters, or the verdict is the probe agreeing with itself. A quiet window must read
    ``undecided``: "found nothing" is not a pass.
  * the verdict tables: ``trade_window_verdict`` and ``deposit_verdict`` decide what plans 04 and
    05 do. A table with a cell the tests never visit is a verdict nobody checked, so every cell
    is a parametrized row, and zero on-chain rows is ``undecided`` and never a replace verdict.
  * sections B, C and D: B drives the REAL readers over 729 days; C separates a venue refusal
    from a failure (Pitfall 6 decides whether plan 03 may refuse the whole derivative read); D
    times one real funding walk (census C27).
  * redaction: the output is pasted into a tracked file in a public repo. A planted amount and a
    planted venue message must reach no output, and the emitter must refuse any key or value
    outside the vocabulary by PATH, never by value.
  * read-only: the probe runs against a PROD key. The view and the source pin each have to be able
    to fail, or they prove nothing.
  * fingerprint: the orchestrator compares the deployed line with the reviewed one; a line that
    does not move when the record changes would pass a stale deploy.
"""
from __future__ import annotations

import asyncio
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import ccxt
import ccxt.async_support as ccxt_async
import pytest

import scripts.bybitreads_probe as bp
from scripts.bybit_upnl_probe import FIELD_ABSENT
from services.exchange import get_and_clear_last_dq_flags
from services.okx_bills_chain import CallCeilingReached
from tests._trade_pages import (
    BYBIT_TWO_YEAR_MS,
    DAY_MS,
    BybitExecutionBook,
    install_execution_list,
    trade_rows,
)

_PROBE_SRC = Path(bp.__file__).read_text(encoding="utf-8")

_RUN_AT = datetime(2026, 11, 23, 12, 0, 0, tzinfo=timezone.utc)
_NOW_MS = int(_RUN_AT.timestamp() * 1000)
_RUN_DATE = "2026-11-23"

_VENUE_MESSAGE = "venue-said-boom-secret-123"
_PLANTED_AMOUNT = 98765.4321


@pytest.fixture(autouse=True)
def _clean_dq_buffer() -> None:
    """The DQ buffer is per asyncio task; start every test with it empty."""
    get_and_clear_last_dq_flags()


def _fills(days_after_start: list[int], *, start_ms: int | None = None) -> list[dict[str, Any]]:
    """One synthetic fill per entry, ``days_after_start`` days after the start of the probe's
    trade window (now minus 22 days unless ``start_ms`` is given), each with a unique id."""
    start = (_NOW_MS - 22 * DAY_MS) if start_ms is None else start_ms
    rows: list[dict[str, Any]] = []
    for index, day in enumerate(days_after_start):
        rows.extend(trade_rows(1, start + day * DAY_MS, 1, id_prefix=f"fill{index:03d}-"))
    return rows


# ---------------------------------------------------------------------------
# Task 1: the execution book answers like the venue, and section A end to end.
# ---------------------------------------------------------------------------


async def test_tracer_section_a_legacy_shape_reads_one_week_and_windowed_reads_all() -> None:
    # Fills on days 1, 9, 16 and 21 after the start: the legacy shape (a start, cursor pages, no
    # end) can only ever see day 1; the windowed shape sees all four. The difference comes from
    # the VENUE rule the book models, not from anything the probe sends.
    client = ccxt_async.bybit({})
    book = install_execution_list(client, _fills([1, 9, 16, 21]), now_ms=_NOW_MS)
    try:
        values = await bp.measure_trade_window(client, _NOW_MS)
    finally:
        await client.close()

    assert values["trade_read_state"] == "complete"
    assert values["trade_legacy_rows"] == 1
    assert values["trade_windowed_rows"] == 4
    assert values["trade_rows_after_first_week"] == 3
    assert values["trade_cursor_continues_past_7d"] is False
    assert values["trade_informative"] is True
    assert values["trade_window_verdict"] == "truncated"
    # The first request of the legacy walk carries a start and no end: the shape under test.
    legacy_first = book.calls[0]
    assert "startTime" in legacy_first and "endTime" not in legacy_first
    # The key record built from these readings is one valid compact line, parsed back.
    record = bp._key_record("k1", _RUN_DATE, measured=True, **values)
    parsed = json.loads(bp.emit_record(record))
    assert parsed["trade_window_verdict"] == "truncated"
    assert parsed["trade_windowed_rows"] == 4


async def test_section_a_quiet_window_is_undecided_not_a_pass() -> None:
    # Every fill sits inside the first week: both shapes read them all, so the comparison shows
    # nothing about a longer start. That is "undecided", never "not truncated".
    client = ccxt_async.bybit({})
    install_execution_list(client, _fills([1, 3, 5]), now_ms=_NOW_MS)
    try:
        values = await bp.measure_trade_window(client, _NOW_MS)
    finally:
        await client.close()

    assert values["trade_legacy_rows"] == 3
    assert values["trade_windowed_rows"] == 3
    assert values["trade_rows_after_first_week"] == 0
    assert values["trade_informative"] is False
    assert values["trade_window_verdict"] == "undecided"


async def test_section_a_legacy_cursor_pages_stay_inside_the_first_week_over_a_full_page() -> None:
    # 130 fills in week one need two cursor pages. A cursor page carries no bound, and the venue
    # continues the query that issued the cursor: a book that answered "neither bound = the last
    # seven days" would lose the second page and the legacy read would look shorter than it is.
    week_one = trade_rows(130, _NOW_MS - 22 * DAY_MS + DAY_MS, 1)
    client = ccxt_async.bybit({})
    install_execution_list(client, week_one + _fills([12]), now_ms=_NOW_MS)
    try:
        values = await bp.measure_trade_window(client, _NOW_MS)
    finally:
        await client.close()

    assert values["trade_legacy_rows"] == 130
    assert values["trade_legacy_pages"] == 2
    assert values["trade_legacy_end"] == "empty_cursor"
    assert values["trade_windowed_rows"] == 131
    assert values["trade_window_verdict"] == "truncated"


async def test_section_a_a_legacy_walk_cut_by_its_page_cap_is_undecided_and_says_so(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # 250 fills in week one with a legacy cap of 2 pages: the legacy walk ends on the cap with
    # fills unread. The windowed read finds the fill after week one, but the gap between the two
    # shapes cannot say whether the cap or the seven-day rule cut the legacy read.
    monkeypatch.setattr(bp, "LEGACY_PAGE_CAP", 2)
    week_one = trade_rows(250, _NOW_MS - 22 * DAY_MS + DAY_MS, 1)
    client = ccxt_async.bybit({})
    install_execution_list(client, week_one + _fills([12]), now_ms=_NOW_MS)
    try:
        values = await bp.measure_trade_window(client, _NOW_MS)
    finally:
        await client.close()

    assert values["trade_legacy_end"] == "page_cap"
    assert values["trade_legacy_rows"] == 200
    assert values["trade_rows_after_first_week"] == 1
    assert values["trade_informative"] is False
    assert values["trade_window_verdict"] == "undecided"


async def test_section_a_a_busy_last_week_never_reads_as_the_startless_shape_missing_rows() -> None:
    # 900 fills in the last week need nine pages; the start-less walk stops at its own small cap
    # (eight pages). Its 800 rows beside the windowed 900 would read as the venue dropping rows,
    # so a start-less count that was cut by the cap is not reported.
    busy = trade_rows(900, _NOW_MS - 5 * DAY_MS, 1)
    client = ccxt_async.bybit({})
    install_execution_list(client, busy, now_ms=_NOW_MS)
    try:
        values = await bp.measure_trade_window(client, _NOW_MS)
    finally:
        await client.close()

    assert values["trade_last7d_windowed_rows"] == 900
    assert values["trade_windowed_rows"] == 900
    assert values["trade_startless_rows"] == FIELD_ABSENT


def _case_start_only() -> tuple[dict[str, str], set[str] | str]:
    return {"startTime": str(_NOW_MS - 21 * DAY_MS)}, {"day21"}


def _case_neither() -> tuple[dict[str, str], set[str] | str]:
    return {}, {"day3"}


def _case_both_inside() -> tuple[dict[str, str], set[str] | str]:
    return {
        "startTime": str(_NOW_MS - 12 * DAY_MS),
        "endTime": str(_NOW_MS - 6 * DAY_MS),
    }, {"day10"}


def _case_both_too_far() -> tuple[dict[str, str], set[str] | str]:
    return {
        "startTime": str(_NOW_MS - 20 * DAY_MS),
        "endTime": str(_NOW_MS - 1 * DAY_MS),
    }, "BadRequest"


def _case_older_than_two_years() -> tuple[dict[str, str], set[str] | str]:
    return {"startTime": str(_NOW_MS - BYBIT_TWO_YEAR_MS - DAY_MS)}, "BadRequest"


@pytest.mark.parametrize(
    "case",
    [_case_start_only, _case_neither, _case_both_inside, _case_both_too_far, _case_older_than_two_years],
    ids=["start-only", "neither-bound", "both-inside-7d", "both-over-7d", "start-over-730d"],
)
async def test_the_execution_book_answers_like_the_venue(case: Any) -> None:
    trades = [
        {**trade_rows(1, _NOW_MS - 21 * DAY_MS, 1, id_prefix="day21-")[0]},
        {**trade_rows(1, _NOW_MS - 10 * DAY_MS, 1, id_prefix="day10-")[0]},
        {**trade_rows(1, _NOW_MS - 3 * DAY_MS, 1, id_prefix="day3-")[0]},
    ]
    book = BybitExecutionBook(trades, now_ms=_NOW_MS)
    params, expected = case()

    if expected == "BadRequest":
        with pytest.raises(ccxt.BadRequest):
            await book({"category": "linear", **params})
        return
    answer = await book({"category": "linear", **params})

    ids = {row["execId"].split("-")[0] for row in answer["result"]["list"]}
    assert ids == expected
    assert answer["retCode"] == 0


async def test_the_execution_book_caps_a_page_at_100_and_defaults_to_50() -> None:
    book = BybitExecutionBook(trade_rows(130, _NOW_MS - 2 * DAY_MS, 1), now_ms=_NOW_MS)

    default = await book({"category": "linear"})
    capped = await book({"category": "linear", "limit": "500"})

    assert len(default["result"]["list"]) == 50
    assert len(capped["result"]["list"]) == 100
    assert capped["result"]["nextPageCursor"] == "c100"


@pytest.mark.parametrize(
    "legacy_after, windowed_after, legacy_end, read_ok, windowed_complete, expected",
    [
        (0, 3, "empty_cursor", True, True, "truncated"),       # windowed found rows past week one that legacy did not
        (1, 3, "empty_page", True, True, "truncated"),         # legacy reached some, windowed found more
        (0, 3, "empty_cursor", True, False, "truncated"),      # positive evidence stands even if windowed was capped
        (2, 2, "empty_cursor", True, True, "not_truncated"),   # legacy cursor reached past week one, nothing missed
        (2, 1, "empty_cursor", True, True, "not_truncated"),
        (2, 2, "empty_cursor", True, False, "undecided"),      # windowed not complete: cannot say nothing was missed
        (0, 0, "empty_cursor", True, True, "undecided"),       # a quiet window shows nothing
        (0, 3, "empty_cursor", False, True, "undecided"),      # a read failed: no verdict at all
        (2, 2, "empty_cursor", False, True, "undecided"),
        (1, 3, "page_cap", True, True, "undecided"),           # legacy cut by its page cap, not by the week rule
        (0, 3, "page_cap", True, True, "undecided"),           # cap hit inside week one: the cut is the cap
        (0, 3, "stuck", True, True, "undecided"),              # a repeated cursor is not the week rule either
        (2, 2, "page_cap", True, True, "undecided"),
    ],
)
def test_trade_window_verdict_is_total_over_its_inputs(
    legacy_after: int,
    windowed_after: int,
    legacy_end: str,
    read_ok: bool,
    windowed_complete: bool,
    expected: str,
) -> None:
    assert (
        bp.trade_window_verdict(
            legacy_after=legacy_after,
            windowed_after=windowed_after,
            legacy_end=legacy_end,
            read_ok=read_ok,
            windowed_complete=windowed_complete,
        )
        == expected
    )
    assert expected in bp.TRADE_VERDICTS


# ---------------------------------------------------------------------------
# Task 2: sections B, C and D, the summary, the run, and the safety gates.
# ---------------------------------------------------------------------------

from tests._trade_pages import UnifiedLogBook, unified_flow  # noqa: E402

_STUCK_CURSOR = "stuck-cursor"  # what a venue that repeats its cursor answers on every page


class _FakeBybit(ccxt_async.bybit):  # type: ignore[misc]
    """A real ccxt Bybit whose raw endpoints answer in the venue's shapes, each recorded.

    ``deposits`` and ``withdrawals`` are ``(id, ms, amount, coin)``; ``unified`` is a list of
    ``unified_flow`` entries. ``positions`` maps ``linear_usdt``, ``linear_usdc`` and ``inverse``
    to a list of raw rows or to an exception to raise. ``funding`` is ``rows`` (one linear
    settlement, inverse refused as the venue refuses a key without that scope),
    ``inverse_readable`` (inverse answers, empty), ``inverse_refused_late`` (inverse answers one
    row, then is refused), ``endless`` (a row and a fresh cursor forever) or ``slow`` (each call
    sleeps)."""

    def __init__(
        self,
        deposits: list[tuple[str, int, float, str]] | None = None,
        withdrawals: list[tuple[str, int, float, str]] | None = None,
        unified: list[dict[str, Any]] | None = None,
        *,
        balance_total: dict[str, float] | None = None,
        balance_error: BaseException | None = None,
        positions: dict[str, Any] | None = None,
        closed_pnl: Any = 0,
        funding: str = "rows",
        unified_error: BaseException | None = None,
        onchain_error: BaseException | None = None,
        repeat_cursor: bool = False,
    ) -> None:
        super().__init__()
        self.rateLimit = 0
        self.markets: dict[str, Any] = {}
        self._deposits = deposits or []
        self._withdrawals = withdrawals or []
        self._balance_total = balance_total if balance_total is not None else {"USDT": 10.0}
        self._balance_error = balance_error
        self._positions = positions or {}
        self._closed_pnl = closed_pnl
        self._funding = funding
        self._inverse_calls = 0
        self._unified_error = unified_error
        self._onchain_error = onchain_error
        self._repeat_cursor = repeat_cursor
        self._book = UnifiedLogBook(unified or [])
        self.deposit_requests: list[dict[str, Any]] = []
        self.withdraw_requests: list[dict[str, Any]] = []
        self.position_requests: list[dict[str, Any]] = []
        self.closed_pnl_requests: list[dict[str, Any]] = []
        self.log_requests: list[dict[str, Any]] = []
        self.privateGetV5AssetDepositQueryRecord = self._deposit_record
        self.privateGetV5AssetWithdrawQueryRecord = self._withdraw_record
        self.private_get_v5_account_transaction_log = self._log
        self.private_get_v5_position_list = self._position_list
        self.private_get_v5_position_closed_pnl = self._closed_pnl_list

    def _book_requests(self) -> list[dict[str, Any]]:
        """Every Unified transaction-log request the venue saw."""
        return self._book.calls

    async def fetch_balance(self, *_a: Any, **_k: Any) -> dict[str, Any]:
        if self._balance_error is not None:
            raise self._balance_error
        return {"total": dict(self._balance_total)}

    async def _deposit_record(self, request: dict[str, Any]) -> dict[str, Any]:
        self.deposit_requests.append(dict(request))
        if self._onchain_error is not None:
            raise self._onchain_error
        rows = [
            {"id": i, "coin": c, "amount": str(a), "status": 3, "depositFee": "", "successAt": str(ms)}
            for i, ms, a, c in self._deposits
            if request["startTime"] <= ms <= request["endTime"]
        ]
        return {"retCode": 0, "result": {"rows": rows, "nextPageCursor": ""}}

    async def _withdraw_record(self, request: dict[str, Any]) -> dict[str, Any]:
        self.withdraw_requests.append(dict(request))
        rows = [
            {"withdrawId": i, "coin": c, "amount": str(a), "status": "success", "withdrawFee": "0",
             "createTime": str(ms)}
            for i, ms, a, c in self._withdrawals
            if request["startTime"] <= ms <= request["endTime"]
        ]
        return {"retCode": 0, "result": {"rows": rows, "nextPageCursor": ""}}

    async def _log(self, params: dict[str, Any]) -> dict[str, Any]:
        if params.get("accountType") == "UNIFIED":
            if self._unified_error is not None:
                raise self._unified_error
            return await self._book(params)
        self.log_requests.append(dict(params))
        number = len(self.log_requests)
        if self._funding == "slow":
            await asyncio.sleep(1.0)
        if self._funding == "malformed":
            return {"retCode": 0, "result": None}
        if self._funding == "endless":
            row = {"id": f"f{number}", "symbol": "BTCUSDT", "funding": "-0.5", "currency": "USDT",
                   "transactionTime": str(_NOW_MS - 3 * DAY_MS)}
            return {"retCode": 0, "result": {"list": [row], "nextPageCursor": f"cur{number}"}}
        if params.get("category") == "inverse":
            self._inverse_calls += 1
            if self._funding == "inverse_readable":
                return {"retCode": 0, "result": {"list": [], "nextPageCursor": ""}}
            if self._funding == "inverse_refused_late" and self._inverse_calls == 1:
                row = {"id": "i1", "symbol": "BTCUSD", "funding": "-0.5", "currency": "BTC",
                       "transactionTime": str(_NOW_MS - 3 * DAY_MS)}
                return {"retCode": 0, "result": {"list": [row], "nextPageCursor": ""}}
            raise ccxt.BadRequest("bybit: the key has no inverse scope")
        rows: list[dict[str, Any]] = []
        if number == 1:
            rows = [{"id": "f1", "symbol": "BTCUSDT", "funding": "-0.5", "currency": "USDT",
                     "transactionTime": str(_NOW_MS - 3 * DAY_MS)}]
        return {"retCode": 0, "result": {"list": rows, "nextPageCursor": ""}}

    async def _position_list(self, params: dict[str, Any]) -> dict[str, Any]:
        self.position_requests.append(dict(params))
        if params.get("category") == "inverse":
            key = "inverse"
        else:
            key = "linear_usdc" if params.get("settleCoin") == "USDC" else "linear_usdt"
        answer = self._positions.get(key, [])
        if isinstance(answer, BaseException):
            raise answer
        if isinstance(answer, str) and answer == "malformed":
            return {"retCode": 0, "result": None}
        cursor = _STUCK_CURSOR if self._repeat_cursor else ""
        return {"retCode": 0, "result": {"list": list(answer), "nextPageCursor": cursor}}

    async def _closed_pnl_list(self, params: dict[str, Any]) -> dict[str, Any]:
        self.closed_pnl_requests.append(dict(params))
        if isinstance(self._closed_pnl, BaseException):
            raise self._closed_pnl
        if isinstance(self._closed_pnl, str) and self._closed_pnl == "malformed":
            return {"retCode": 0, "result": None}
        first = len(self.closed_pnl_requests) == 1 or self._repeat_cursor
        rows = [{"orderId": f"o{i}", "closedPnl": "1"} for i in range(self._closed_pnl if first else 0)]
        cursor = _STUCK_CURSOR if self._repeat_cursor else ""
        return {"retCode": 0, "result": {"list": rows, "nextPageCursor": cursor}}


_FLOW_T = _NOW_MS - 100 * DAY_MS


# --- Section B -------------------------------------------------------------


@pytest.mark.parametrize(
    "onchain_state, unified_state, onchain_rows, unreadable, unpaired, near_miss, expected",
    [
        ("failed", "complete", 4, 0, 0, 0, "unread"),                 # an on-chain reader failed
        ("complete", "reader_error", 4, 0, 0, 0, "unread"),           # the Unified reader refused
        ("complete", "call_ceiling", 4, 0, 0, 0, "unread"),           # a spent budget is not a read
        ("complete", "complete", 0, 0, 0, 0, "undecided"),            # nothing to distinguish the rules
        ("complete", "complete", 3, 1, 0, 0, "undecided"),            # a row the rule cannot read
        ("complete", "complete", 3, 0, 0, 0, "replace_supported"),    # every on-chain row paired
        ("complete", "complete", 3, 0, 2, 1, "undecided_near_miss"),  # unpaired, a near miss exists
        ("complete", "complete", 3, 0, 2, 0, "unpaired_present"),     # unpaired, no near miss
    ],
)
def test_section_b_deposit_verdict_follows_the_decision_table(
    onchain_state: str,
    unified_state: str,
    onchain_rows: int,
    unreadable: int,
    unpaired: int,
    near_miss: int,
    expected: str,
) -> None:
    verdict = bp.deposit_verdict(
        onchain_state=onchain_state,
        unified_state=unified_state,
        onchain_rows=onchain_rows,
        unreadable_rows=unreadable,
        unpaired_rows=unpaired,
        near_miss_rows=near_miss,
    )

    assert verdict == expected
    assert verdict in bp.DEPOSIT_VERDICTS


async def test_section_b_reads_the_real_readers_over_729_days() -> None:
    # c1 (1000) pairs with u1; c2 (250) has no Unified twin; w1 (400) pairs with u2.
    client = _FakeBybit(
        deposits=[("c1", _FLOW_T, 1000.0, "USDT"), ("c2", _FLOW_T + 5 * DAY_MS, 250.0, "USDT")],
        withdrawals=[("w1", _FLOW_T + 9 * DAY_MS, 400.0, "USDT")],
        unified=[
            unified_flow("u1", "TRANSFER_IN", _FLOW_T + 2 * DAY_MS, change="1000"),
            unified_flow("u2", "TRANSFER_OUT", _FLOW_T + 7 * DAY_MS, change="-400"),
        ],
    )
    try:
        values = await bp.measure_deposits(client, _NOW_MS)
    finally:
        await client.close()

    assert values["onchain_read_state"] == "complete"
    assert values["unified_read_state"] == "complete"
    assert values["onchain_deposits"] == 2
    assert values["onchain_withdrawals"] == 1
    assert values["unified_in"] == 1
    assert values["unified_out"] == 1
    assert values["paired_rows"] == 2
    assert values["unpaired_onchain_rows"] == 1
    # c2 is unpaired and no unused Unified credit is left to be a near miss.
    assert values["near_miss_rows"] == 0
    assert values["deposit_verdict"] == "unpaired_present"
    # The window is the 729 days the section names: the oldest start the venue saw, on the REAL
    # on-chain reader's own endpoint, is now minus 729 days exactly.
    expected_oldest = _NOW_MS - 729 * DAY_MS
    assert min(r["startTime"] for r in client.deposit_requests) == expected_oldest
    assert min(r["startTime"] for r in client.withdraw_requests) == expected_oldest
    assert min(int(r["startTime"]) for r in client._book_requests()) == expected_oldest


async def test_section_b_with_no_onchain_rows_is_undecided_even_when_every_read_succeeds() -> None:
    client = _FakeBybit(unified=[unified_flow("u1", "TRANSFER_IN", _FLOW_T, change="1000")])
    try:
        values = await bp.measure_deposits(client, _NOW_MS)
    finally:
        await client.close()

    assert values["onchain_deposits"] == 0
    assert values["unified_in"] == 1
    assert values["deposit_verdict"] == "undecided"


@pytest.mark.parametrize(
    "kwargs, onchain, unified",
    [
        ({"onchain_error": ccxt.NetworkError(_VENUE_MESSAGE)}, "failed", "complete"),
        ({"unified_error": ccxt.ExchangeError(_VENUE_MESSAGE)}, "complete", "venue_error"),
    ],
    ids=["onchain-failed", "unified-venue-error"],
)
async def test_section_b_a_failed_reader_is_a_state_and_the_verdict_is_unread(
    kwargs: dict[str, Any], onchain: str, unified: str
) -> None:
    client = _FakeBybit(deposits=[("c1", _FLOW_T, 5.0, "USDT")], **kwargs)
    try:
        values = await bp.measure_deposits(client, _NOW_MS)
    finally:
        await client.close()

    assert values["onchain_read_state"] == onchain
    assert values["unified_read_state"] == unified
    assert values["deposit_verdict"] == "unread"
    assert _VENUE_MESSAGE not in json.dumps(values)


async def test_section_b_a_spent_call_budget_reads_call_ceiling_and_unread(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(bp, "B_CEILING", 3)
    client = _FakeBybit(deposits=[("c1", _FLOW_T, 5.0, "USDT")])
    try:
        values = await bp.measure_deposits(client, _NOW_MS)
    finally:
        await client.close()

    assert values["onchain_read_state"] == "call_ceiling"
    assert values["deposit_verdict"] == "unread"
    assert len(client.deposit_requests) + len(client.withdraw_requests) == 3  # the venue never saw a 4th


# --- Section C -------------------------------------------------------------


def _position(size: str) -> dict[str, Any]:
    return {"symbol": "BTCUSDT", "size": size, "positionValue": "100", "unrealisedPnl": "1"}


async def test_section_c_counts_open_positions_per_category_and_refusals() -> None:
    client = _FakeBybit(
        balance_total={"USDT": 100.0, "USDC": 5.0, "BTC": 0.1},
        positions={
            "linear_usdt": [_position("1"), _position("2"), _position("0")],  # the flat row is not open
            "linear_usdc": ccxt.PermissionDenied(_VENUE_MESSAGE),
            "inverse": [_position("3")],
        },
        closed_pnl=4,
    )
    try:
        values = await bp.measure_exposure(client, _NOW_MS)
    finally:
        await client.close()

    assert values["positions_read_linear_usdt"] == "ok"
    assert values["positions_open_linear_usdt"] == 2
    assert values["positions_read_linear_usdc"] == "refused"
    assert values["positions_open_linear_usdc"] == FIELD_ABSENT  # not read: never 0
    assert values["positions_read_inverse"] == "ok"
    assert values["positions_open_inverse"] == 1
    assert values["stable_non_usdt_present"] is True
    assert values["nonstable_present"] is True
    assert values["inverse_closed_pnl_rows_30d"] == 4
    assert values["inverse_closed_pnl_read"] == "ok"
    # The three requests are the documented shapes, each with a limit of 200.
    sent = {(r["category"], r.get("settleCoin")) for r in client.position_requests}
    assert sent == {("linear", "USDT"), ("linear", "USDC"), ("inverse", None)}
    assert all(r["limit"] == "200" for r in client.position_requests)
    # The inverse closed-pnl read is category inverse over seven-day windows covering 30 days.
    assert all(r["category"] == "inverse" for r in client.closed_pnl_requests)
    assert len(client.closed_pnl_requests) == 5
    assert _VENUE_MESSAGE not in json.dumps(values)


async def test_section_c_a_failure_is_told_apart_from_a_refusal() -> None:
    client = _FakeBybit(
        positions={
            "linear_usdt": ccxt.NetworkError(_VENUE_MESSAGE),
            "inverse": ccxt.PermissionDenied(_VENUE_MESSAGE),
        },
        balance_error=ccxt.NetworkError(_VENUE_MESSAGE),
        closed_pnl=ccxt.NetworkError(_VENUE_MESSAGE),
    )
    try:
        values = await bp.measure_exposure(client, _NOW_MS)
    finally:
        await client.close()

    assert values["positions_read_linear_usdt"] == "failed"
    assert values["positions_read_linear_usdc"] == "ok"
    assert values["positions_open_linear_usdc"] == 0  # read in full: a measured zero
    assert values["positions_read_inverse"] == "refused"
    assert values["stable_non_usdt_present"] == FIELD_ABSENT  # the balance read failed
    assert values["nonstable_present"] == FIELD_ABSENT
    assert values["inverse_closed_pnl_rows_30d"] == FIELD_ABSENT
    assert values["inverse_closed_pnl_read"] == "failed"
    assert _VENUE_MESSAGE not in json.dumps(values)


@pytest.mark.parametrize(
    "error, state",
    [(ccxt.PermissionDenied(_VENUE_MESSAGE), "refused"), (ccxt.NetworkError(_VENUE_MESSAGE), "failed"),
     (ccxt.BadRequest(_VENUE_MESSAGE), "failed")],
    ids=["permission-denied-is-refused", "network-error-is-failed", "bad-request-is-failed"],
)
async def test_section_c_the_inverse_closed_pnl_read_has_its_own_state(error: Exception, state: str) -> None:
    # WR-02: a refused or failed closed-pnl read left only a field-absent count, so the probe could
    # exit 0 without the census C19 input. A BadRequest is a parameter error of the probe (SF-M6),
    # so it is a failure, never a venue refusal pasted into the public record.
    client = _FakeBybit(closed_pnl=error)
    try:
        values = await bp.measure_exposure(client, _NOW_MS)
    finally:
        await client.close()

    assert values["inverse_closed_pnl_read"] == state
    assert values["inverse_closed_pnl_rows_30d"] == FIELD_ABSENT
    assert _VENUE_MESSAGE not in json.dumps(values)


@pytest.mark.parametrize(
    "error, state",
    [(ccxt.PermissionDenied(_VENUE_MESSAGE), "refused"), (ccxt.BadRequest(_VENUE_MESSAGE), "failed")],
    ids=["permission-denied-is-refused", "bad-request-is-failed"],
)
async def test_section_c_only_a_permission_denied_position_read_is_a_refusal(
    error: Exception, state: str
) -> None:
    client = _FakeBybit(positions={"inverse": error})
    try:
        values = await bp.measure_exposure(client, _NOW_MS)
    finally:
        await client.close()

    assert values["positions_read_inverse"] == state
    assert values["positions_open_inverse"] == FIELD_ABSENT


async def test_section_c_a_repeated_cursor_on_a_position_read_is_a_failed_read_not_a_count() -> None:
    # R2-WR-01: page 2 repeats its cursor, so the rows so far are a lower bound. A complete read of
    # the inverse category would be "ok" with a count; it must be "failed" with the count absent.
    client = _FakeBybit(positions={"inverse": [_position("3")]}, repeat_cursor=True)
    try:
        values = await bp.measure_exposure(client, _NOW_MS)
    finally:
        await client.close()

    inverse_pages = [r for r in client.position_requests if r["category"] == "inverse"]
    assert [r.get("cursor") for r in inverse_pages] == [None, _STUCK_CURSOR]  # page 2 was read
    assert values["positions_read_inverse"] == "failed"
    assert values["positions_open_inverse"] == FIELD_ABSENT


async def test_section_c_a_repeated_cursor_on_a_closed_pnl_window_is_a_failed_read_not_a_count() -> None:
    client = _FakeBybit(closed_pnl=2, repeat_cursor=True)
    try:
        values = await bp.measure_exposure(client, _NOW_MS)
    finally:
        await client.close()

    assert [r.get("cursor") for r in client.closed_pnl_requests] == [None, _STUCK_CURSOR]
    assert values["inverse_closed_pnl_read"] == "failed"
    assert values["inverse_closed_pnl_rows_30d"] == FIELD_ABSENT


@pytest.mark.parametrize(
    "bad_row",
    [{"symbol": "BTCUSDT", "size": "soon"}, {"symbol": "BTCUSDT"}, {"symbol": "BTCUSDT", "size": None}],
    ids=["unparseable-size", "missing-size", "null-size"],
)
async def test_section_c_a_position_row_without_a_readable_size_fails_the_category(
    bad_row: dict[str, Any],
) -> None:
    # SF-M7: counted as flat, the row would leave the category "ok" with an under-count.
    client = _FakeBybit(positions={"linear_usdt": [_position("1"), bad_row]})
    try:
        values = await bp.measure_exposure(client, _NOW_MS)
    finally:
        await client.close()

    assert values["positions_read_linear_usdt"] == "failed"
    assert values["positions_open_linear_usdt"] == FIELD_ABSENT
    assert values["positions_read_linear_usdc"] == "ok"  # the other categories still read


async def test_section_c_classifies_coins_with_the_shared_stable_rule(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # A coin the shared rule does not know is non-stable until the rule says otherwise: the probe
    # carries no coin list of its own, so a change to the rule moves the probe with it.
    client = _FakeBybit(balance_total={"USDT": 10.0, "ZZUSD": 3.0})
    try:
        before = await bp.measure_exposure(client, _NOW_MS)
        import services.price_rule as price_rule

        monkeypatch.setattr(price_rule, "_STABLE_VALUE", price_rule._STABLE_VALUE | {"ZZUSD"})
        after = await bp.measure_exposure(client, _NOW_MS)
    finally:
        await client.close()

    assert (before["stable_non_usdt_present"], before["nonstable_present"]) == (False, True)
    assert (after["stable_non_usdt_present"], after["nonstable_present"]) == (True, False)


async def test_section_c_a_zero_balance_is_not_a_coin_the_key_holds() -> None:
    client = _FakeBybit(balance_total={"USDT": 10.0, "USDC": 0.0, "BTC": 0.0})
    try:
        values = await bp.measure_exposure(client, _NOW_MS)
    finally:
        await client.close()

    assert (values["stable_non_usdt_present"], values["nonstable_present"]) == (False, False)


# --- Section D -------------------------------------------------------------


async def test_section_d_times_one_funding_walk() -> None:
    client = _FakeBybit(funding="rows")
    try:
        values = await bp.measure_funding(client)
    finally:
        await client.close()

    assert values["funding_state"] == "complete"
    assert isinstance(values["funding_read_s"], float)
    # One call per window for linear (53 windows over the 365-day default), and the first inverse
    # call is the refusal that ends that category (the venue's own graceful skip).
    assert values["funding_calls"] == len(client.log_requests)
    assert values["funding_calls"] >= 53
    assert values["funding_rows_linear"] == 1
    # The venue refused inverse: its rows were not read, so they are not a measured zero (SF-M5).
    assert values["funding_rows_inverse"] == FIELD_ABSENT
    assert values["funding_inverse_skipped"] is True


async def test_section_d_inverse_is_a_count_only_when_the_whole_category_was_read() -> None:
    client = _FakeBybit(funding="inverse_readable")
    try:
        values = await bp.measure_funding(client)
    finally:
        await client.close()

    assert values["funding_state"] == "complete"
    assert values["funding_rows_inverse"] == 0  # read in full: a measured zero
    assert values["funding_inverse_skipped"] is False


async def test_section_d_an_inverse_refusal_after_the_first_page_is_still_a_skip() -> None:
    # The fetcher skips inverse on a refusal at ANY page. One inverse reply already exists, so
    # "no inverse reply" cannot tell a cut-short category from a read one; the one row read is a
    # lower bound, and the key's inverse total must not look measured.
    client = _FakeBybit(funding="inverse_refused_late")
    try:
        values = await bp.measure_funding(client)
    finally:
        await client.close()

    assert values["funding_state"] == "complete"
    assert values["funding_inverse_skipped"] is True
    assert values["funding_rows_inverse"] == FIELD_ABSENT


async def test_section_d_reads_ceiling_when_the_fetchers_page_ceiling_is_exhausted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("services.funding_fetch.MAX_PAGES", 2)
    client = _FakeBybit(funding="endless")
    try:
        values = await bp.measure_funding(client)
    finally:
        await client.close()

    assert values["funding_state"] == "ceiling"
    assert values["funding_rows_linear"] == FIELD_ABSENT  # a cut-short walk is a lower bound
    assert isinstance(values["funding_calls"], int) and values["funding_calls"] >= 2


async def test_section_d_a_spent_call_budget_reads_call_ceiling(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(bp, "D_CEILING", 3)
    client = _FakeBybit(funding="rows")
    try:
        values = await bp.measure_funding(client)
    finally:
        await client.close()

    assert values["funding_state"] == "call_ceiling"
    assert values["funding_calls"] == 3
    assert len(client.log_requests) == 3  # the venue never saw a 4th


async def test_section_d_a_deadline_is_a_timeout_reading_that_keeps_the_calls(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Census C27's production symptom is a funding read that does not finish: the timeout must be
    # recorded, with the seconds and calls taken so far, not raised.
    monkeypatch.setattr(bp, "FUNDING_DEADLINE_S", 0.05)
    client = _FakeBybit(funding="slow")
    try:
        values = await bp.measure_funding(client)
    finally:
        await client.close()

    assert values["funding_state"] == "timeout"
    assert values["funding_calls"] == 1
    assert isinstance(values["funding_read_s"], float)


async def test_section_a_a_sweep_deadline_records_incomplete_not_a_crash(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(bp, "SWEEP_DEADLINE_S", 0.05)
    client = ccxt_async.bybit({})
    book = install_execution_list(client, _fills([1]), now_ms=_NOW_MS)
    original = book.__call__

    async def _slow(params: dict[str, Any]) -> dict[str, Any]:
        await asyncio.sleep(0.2)
        return await original(params)

    client.private_get_v5_execution_list = _slow
    try:
        values = await bp.measure_trade_sweep(client, _NOW_MS)
    finally:
        await client.close()

    assert values["trade_sweep_complete"] is False
    assert isinstance(values["trade_sweep_read_s"], float)


async def test_section_a_the_sweep_counts_pages_per_window_and_a_spent_budget_is_incomplete(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = ccxt_async.bybit({})
    # 250 fills inside one window: three pages of 100 in that window, one page elsewhere.
    install_execution_list(client, trade_rows(250, _NOW_MS - 30 * DAY_MS, 1), now_ms=_NOW_MS)
    try:
        values = await bp.measure_trade_sweep(client, _NOW_MS)
        monkeypatch.setattr(bp, "A_SWEEP_CEILING", 5)
        spent = await bp.measure_trade_sweep(client, _NOW_MS)
    finally:
        await client.close()

    assert values["trade_sweep_complete"] is True
    assert values["trade_sweep_pages_max_in_window"] == 3
    assert values["trade_sweep_windows_read"] == 53
    assert spent["trade_sweep_complete"] is False
    assert spent["trade_sweep_windows_read"] < 53


# --- A malformed venue reply is never a natural end of data (WR-01) --------

_MALFORMED_REPLIES = [
    pytest.param({"retCode": 0, "result": None}, id="result-null"),
    pytest.param(None, id="reply-not-a-dict"),
    pytest.param({"retCode": 0, "result": {"list": None}}, id="list-not-a-list"),
    pytest.param({"retCode": 0, "result": {"list": ["x"], "nextPageCursor": ""}}, id="row-not-an-object"),
]
_MALFORMED_ROWS = [
    pytest.param({"execTime": "1700000000000"}, id="row-without-execId"),
    pytest.param({"execId": "e1", "execTime": "soon"}, id="row-with-unreadable-execTime"),
    pytest.param({"execId": "e1"}, id="row-without-execTime"),
]


def _answer_call_with(client: Any, book: Any, call_number: int, reply: Any) -> None:
    """The client's execution-list method answers from ``book`` except on call ``call_number``."""
    seen = {"n": 0}

    async def _answer(params: dict[str, Any]) -> Any:
        seen["n"] += 1
        if seen["n"] == call_number:
            return reply
        return await book(params)

    client.private_get_v5_execution_list = _answer


@pytest.mark.parametrize(
    "reply",
    [
        *_MALFORMED_REPLIES,
        *[
            pytest.param({"retCode": 0, "result": {"list": [p.values[0]], "nextPageCursor": ""}}, id=p.id)
            for p in _MALFORMED_ROWS
        ],
    ],
)
async def test_section_a_a_malformed_legacy_page_is_a_failed_read_not_a_complete_one(reply: Any) -> None:
    # 130 fills in week one: the legacy walk's second page is the malformed one. Read as an empty
    # page it would end the walk "naturally" and the section would report a complete read.
    week_one = trade_rows(130, _NOW_MS - 22 * DAY_MS + DAY_MS, 1)
    client = ccxt_async.bybit({})
    book = BybitExecutionBook(week_one + _fills([12]), now_ms=_NOW_MS)
    _answer_call_with(client, book, 2, reply)
    try:
        values = await bp.measure_trade_window(client, _NOW_MS)
    finally:
        await client.close()

    assert values["trade_read_state"] == "failed"
    assert values["trade_window_verdict"] == "undecided"
    assert values["trade_legacy_end"] != "empty_page"


@pytest.mark.parametrize("reply", _MALFORMED_REPLIES)
async def test_section_a_a_malformed_sweep_page_leaves_the_sweep_incomplete(reply: Any) -> None:
    client = ccxt_async.bybit({})
    book = BybitExecutionBook(_fills([1]), now_ms=_NOW_MS)
    _answer_call_with(client, book, 2, reply)
    try:
        values = await bp.measure_trade_sweep(client, _NOW_MS)
    finally:
        await client.close()

    assert values["trade_sweep_complete"] is False
    assert values["trade_sweep_windows_read"] < 53


async def test_section_c_a_malformed_reply_is_a_failed_read_and_never_a_measured_zero() -> None:
    client = _FakeBybit(
        positions={"linear_usdt": "malformed"},
        closed_pnl="malformed",
    )
    try:
        values = await bp.measure_exposure(client, _NOW_MS)
    finally:
        await client.close()

    assert values["positions_read_linear_usdt"] == "failed"
    assert values["positions_open_linear_usdt"] == FIELD_ABSENT
    assert values["positions_read_linear_usdc"] == "ok"  # the other categories still read
    assert values["inverse_closed_pnl_rows_30d"] == FIELD_ABSENT


async def test_section_d_a_malformed_reply_is_a_failed_walk() -> None:
    client = _FakeBybit(funding="malformed")
    try:
        values = await bp.measure_funding(client)
    finally:
        await client.close()

    assert values["funding_state"] == "failed"
    assert values["funding_rows_linear"] == FIELD_ABSENT


# --- The emitter, the summary, the run -------------------------------------


def test_a_default_key_record_is_valid_and_prints_one_compact_line() -> None:
    record = bp._key_record("k1", _RUN_DATE)

    line = bp.emit_record(record)

    assert json.loads(line) == record
    assert "\n" not in line
    assert record["measured"] is False
    assert record["trade_window_verdict"] == FIELD_ABSENT  # not measured is a word, never 0


def test_emit_record_refuses_an_undeclared_key_by_path_not_value() -> None:
    record = bp._key_record("k1", _RUN_DATE)
    record["extra_venue_text"] = _VENUE_MESSAGE

    with pytest.raises(ValueError) as caught:
        bp.emit_record(record)

    assert "extra_venue_text" in str(caught.value)
    assert _VENUE_MESSAGE not in str(caught.value)


@pytest.mark.parametrize(
    "key, bad",
    [
        ("deposit_verdict", _VENUE_MESSAGE),  # a raw string where a closed token is declared
        ("trade_window_verdict", "maybe"),
        ("positions_open_inverse", 1.5),  # a float where a count is declared
        ("positions_open_inverse", -1),
        ("positions_open_inverse", True),
        ("trade_informative", 1),  # an int is not a bool
        ("funding_read_s", 12.3456789),  # three significant figures only
        ("label", "k1-" + _VENUE_MESSAGE),
    ],
)
def test_emit_record_refuses_a_value_outside_the_vocabulary_by_path(key: str, bad: Any) -> None:
    record = bp._key_record("k1", _RUN_DATE)
    record[key] = bad

    with pytest.raises(ValueError) as caught:
        bp.emit_record(record)

    assert key in str(caught.value)
    assert _VENUE_MESSAGE not in str(caught.value)


def test_the_summary_validates_and_refuses_an_extra_key() -> None:
    summary = bp.summarize([], _RUN_DATE)

    assert json.loads(bp.emit_record(summary))["record"] == "summary"
    assert summary["keys"] == 0
    summary["leak"] = "x"
    with pytest.raises(ValueError, match="leak"):
        bp.emit_record(summary)


#: The readings of a key whose four sections all completed: the baseline every arm below breaks.
_COMPLETE_READINGS: dict[str, Any] = {
    "trade_read_state": "complete", "trade_sweep_complete": True, "trade_legacy_end": "empty_cursor",
    "trade_startless_rows": 0, "deposit_verdict": "undecided", "stable_non_usdt_present": False,
    "positions_read_linear_usdt": "ok", "positions_read_linear_usdc": "ok", "positions_read_inverse": "ok",
    "inverse_closed_pnl_read": "ok", "funding_state": "complete",
}


@pytest.mark.parametrize(
    "broken, expected",
    [
        ({}, 0),  # the baseline: no arm fires, so a 1 below is the arm's doing
        ({"trade_read_state": "incomplete"}, 1),  # A: the read state
        ({"trade_sweep_complete": False}, 1),  # A: the sweep
        ({"trade_legacy_end": "page_cap"}, 1),  # A: the legacy walk stopped on its page cap (SF-M4)
        ({"trade_legacy_end": "stuck"}, 1),  # A: ... or on a repeated cursor (SF-M4)
        ({"trade_startless_rows": FIELD_ABSENT}, 1),  # A: a cut-off start-less count (SF-M4)
        ({"deposit_verdict": "unread"}, 1),  # B
        ({"stable_non_usdt_present": FIELD_ABSENT}, 1),  # C: the balance read
        ({"positions_read_linear_usdt": "failed"}, 1),  # C: a position category
        ({"positions_read_inverse": "failed"}, 1),
        ({"inverse_closed_pnl_read": "failed"}, 1),  # C: the closed-pnl read (WR-02)
        ({"funding_state": "timeout"}, 1),  # D
        ({"positions_read_linear_usdc": "refused"}, 0),  # a refusal is a finding, not a failure
        ({"inverse_closed_pnl_read": "refused"}, 0),
    ],
    ids=[
        "baseline", "a-read-state", "a-sweep", "a-legacy-page-cap", "a-legacy-stuck", "a-startless-absent",
        "b-unread", "c-balance", "c-position-usdt", "c-position-inverse", "c-closed-pnl", "d-funding",
        "refused-position-is-not-a-failure", "refused-closed-pnl-is-not-a-failure",
    ],
)
def test_section_failures_visits_every_arm_of_every_section(broken: dict[str, Any], expected: int) -> None:
    # WR-04: the summary test only ever failed one section, so deleting an arm kept the suite green.
    record = bp._key_record("k1", _RUN_DATE, measured=True, **{**_COMPLETE_READINGS, **broken})

    assert bp.section_failures(record) == expected


def test_summarize_counts_verdicts_totals_and_reads_absent_unless_every_key_read_it() -> None:
    def _rec(label: str, **values: Any) -> dict[str, Any]:
        return bp._key_record(label, _RUN_DATE, measured=True, **values)

    complete = _COMPLETE_READINGS
    records = [
        _rec("k1", **complete, trade_window_verdict="truncated", trade_sweep_pages_max_in_window=7,
             trade_sweep_read_s=12.0, positions_open_inverse=2, inverse_closed_pnl_rows_30d=3,
             funding_rows_inverse=4, funding_read_s=30.0),
        _rec("k2", **{**complete, "positions_read_inverse": "refused", "funding_state": "timeout"},
             trade_window_verdict="undecided", trade_sweep_pages_max_in_window=9,
             trade_sweep_read_s=20.0, positions_open_inverse=1, inverse_closed_pnl_rows_30d=0,
             funding_read_s=600.0),
        bp._key_record("k3", _RUN_DATE, unmeasurable_reason="key_not_eligible"),
        bp._key_record("k4", _RUN_DATE, unmeasurable_reason="timeout"),
    ]

    summary = bp.summarize(records, _RUN_DATE)

    bp.emit_record(summary)
    assert (summary["keys"], summary["keys_measured"], summary["keys_unmeasurable"]) == (4, 2, 1)
    assert summary["trade_verdict_truncated"] == 1
    assert summary["trade_verdict_undecided"] == 1
    assert summary["trade_sweep_pages_max"] == 9
    assert summary["trade_sweep_read_s_max"] == 20.0
    assert summary["positions_refused_inverse"] == 1
    assert summary["positions_open_inverse_total"] == 3
    assert summary["inverse_closed_pnl_rows_30d_total"] == 3
    # k2 never read the inverse funding rows, so the total is not a count of zero for it.
    assert summary["funding_rows_inverse_total"] == FIELD_ABSENT
    assert summary["funding_read_s_max"] == 600.0
    assert summary["funding_incomplete"] == 1
    assert summary["sections_failed"] == 1


def test_summarize_reports_the_sweep_page_maximum_only_when_every_sweep_completed() -> None:
    # SF-M8: an incomplete sweep's page count is a lower bound; as the maximum it would undersize
    # plan 04's per-window page cap, so it reads field-absent while any sweep is incomplete.
    def _rec(label: str, **values: Any) -> dict[str, Any]:
        return bp._key_record(label, _RUN_DATE, measured=True, **{**_COMPLETE_READINGS, **values})

    whole = bp.summarize(
        [_rec("k1", trade_sweep_pages_max_in_window=7), _rec("k2", trade_sweep_pages_max_in_window=9)],
        _RUN_DATE,
    )
    cut = bp.summarize(
        [
            _rec("k1", trade_sweep_pages_max_in_window=7),
            _rec("k2", trade_sweep_pages_max_in_window=9, trade_sweep_complete=False),
        ],
        _RUN_DATE,
    )

    assert whole["trade_sweep_pages_max"] == 9 and whole["trade_sweep_incomplete"] == 0
    assert cut["trade_sweep_pages_max"] == FIELD_ABSENT and cut["trade_sweep_incomplete"] == 1


_KEY_ONE = "fake-key-id-one"
_USER_ONE = "fake-user-id-one"
_CIPHER = "planted-cipher-text-zzz"


class _FakeQuery:
    def __init__(self, data: list[dict[str, Any]], owner: _FakeSupabase) -> None:
        self._data = data
        self._owner = owner
        self._filters: list[Any] = []

    def select(self, *_a: Any, **_k: Any) -> _FakeQuery:
        return self

    def in_(self, column: str, values: list[Any]) -> _FakeQuery:
        self._filters.append(lambda r: r.get(column) in values)
        return self

    def order(self, column: str, **_k: Any) -> _FakeQuery:
        self._data = sorted(self._data, key=lambda r: str(r.get(column)))
        return self

    def execute(self) -> Any:
        return SimpleNamespace(data=[dict(r) for r in self._data if all(f(r) for f in self._filters)])

    def insert(self, *_a: Any, **_k: Any) -> _FakeQuery:
        self._owner.writes.append("insert")
        return self


class _FakeSupabase:
    def __init__(self, key_rows: list[dict[str, Any]]) -> None:
        self._key_rows = key_rows
        self.tables_touched: list[str] = []
        self.writes: list[str] = []

    def table(self, name: str) -> _FakeQuery:
        self.tables_touched.append(name)
        return _FakeQuery(self._key_rows, self)


def _key_row(key_id: str = _KEY_ONE, **o: Any) -> dict[str, Any]:
    row = {
        "id": key_id, "user_id": _USER_ONE, "exchange": "bybit", "is_active": True,
        "disconnected_at": None, "sync_status": "complete", "created_at": "2026-01-01T00:00:00+00:00",
        "api_key_encrypted": _CIPHER,
    }
    row.update(o)
    return row


class _Harness:
    """Everything ``run()`` reaches for, patched in one place and recorded."""

    def __init__(self, key_rows: list[dict[str, Any]], clients: list[Any]) -> None:
        self.supabase = _FakeSupabase(key_rows)
        self.clients = list(clients)
        self.decrypted: list[Any] = []
        self.closed: list[Any] = []

    def install(self, monkeypatch: pytest.MonkeyPatch) -> None:
        async def _db_execute(fn: Any) -> Any:
            return fn()

        def _decrypt(row: dict[str, Any], _kek: bytes) -> tuple[str, str, None]:
            self.decrypted.append(row.get("id"))
            return ("fake-k", "fake-s", None)

        def _make_client(_venue: str, *_a: Any) -> Any:
            return self.clients[len(self.decrypted) - 1]

        async def _aclose(exchange: Any) -> None:
            self.closed.append(exchange)

        monkeypatch.setattr(bp, "_utc_now", lambda: _RUN_AT)
        monkeypatch.setattr("services.db.get_supabase", lambda: self.supabase)
        monkeypatch.setattr("services.db.db_execute", _db_execute)
        monkeypatch.setattr("services.encryption.get_kek", lambda: b"fake-kek")
        monkeypatch.setattr("services.encryption.decrypt_credentials", _decrypt)
        monkeypatch.setattr("services.job_worker._make_exchange_client", _make_client)
        monkeypatch.setattr("services.exchange.aclose_exchange", _aclose)


def _lines(capsys: pytest.CaptureFixture[str]) -> tuple[list[dict[str, Any]], str]:
    captured = capsys.readouterr()
    return [json.loads(line) for line in captured.out.splitlines() if line.strip()], captured.err


def _full_client(**overrides: Any) -> Any:
    options: dict[str, Any] = {
        "deposits": [("c1", _FLOW_T, 1000.0, "USDT")],
        "unified": [unified_flow("u1", "TRANSFER_IN", _FLOW_T + 2 * DAY_MS, change="1000")],
        "balance_total": {"USDT": 10.0},
        "positions": {"linear_usdt": [_position("1")]},
        "closed_pnl": 2,
        **overrides,
    }
    client = _FakeBybit(**options)
    install_execution_list(client, _fills([1, 9, 16, 21]), now_ms=_NOW_MS)
    return client


async def test_run_end_to_end_prints_one_key_line_per_key_and_a_summary_that_counts_them(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    client = _full_client()
    harness = _Harness([_key_row(), _key_row("fake-key-id-two", sync_status="revoked")], [client])
    harness.install(monkeypatch)

    exit_code = await bp.run()

    records, err = _lines(capsys)
    assert [r["record"] for r in records] == ["key", "key", "summary"]
    key, skipped, summary = records
    assert key["label"] == "k1" and key["measured"] is True
    assert key["trade_window_verdict"] == "truncated"
    assert key["deposit_verdict"] == "replace_supported"  # c1 pairs with u1: every on-chain row paired
    assert key["positions_open_linear_usdt"] == 1
    assert key["funding_state"] == "complete"
    assert skipped["unmeasurable_reason"] == "key_not_eligible"
    # The printed key lines are counted by the summary: the orchestrator checks this equality.
    assert summary["keys"] == 2 and summary["keys_measured"] == 1 and summary["keys_unmeasurable"] == 0
    assert summary["trade_verdict_truncated"] == 1
    # Pinned to the value this fixture really produces: a restated `run()` expression passes
    # whatever the run did, so it could never catch a wrong exit code.
    assert exit_code == bp.EXIT_OK and summary["sections_failed"] == 0
    # Decrypted once (the revoked key never), client closed, nothing written, only the key table read.
    assert harness.decrypted == [_KEY_ONE]
    assert harness.closed == [client]
    assert harness.supabase.writes == []
    assert harness.supabase.tables_touched == ["api_keys"]
    blob = json.dumps(records) + err
    for needle in (_KEY_ONE, _USER_ONE, _CIPHER, "fake-k", "fake-s"):
        assert needle not in blob


async def test_run_a_key_that_fails_outside_the_sections_prints_its_class_only(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    harness = _Harness([_key_row()], [object()])
    harness.install(monkeypatch)

    def _boom(*_a: Any) -> Any:
        raise ccxt.AuthenticationError(_VENUE_MESSAGE)

    monkeypatch.setattr("services.encryption.decrypt_credentials", _boom)

    exit_code = await bp.run()

    records, err = _lines(capsys)
    assert exit_code == bp.EXIT_FAILED
    assert records[0]["unmeasurable_reason"] == "failure"
    assert records[0]["measured"] is False
    assert _VENUE_MESSAGE not in json.dumps(records) + err


async def test_run_a_failed_inverse_closed_pnl_read_is_a_section_failure_and_exits_1(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # WR-02: the census C19 input is the inverse closed-pnl count. A key whose read of it failed
    # was not fully measured, whatever else the key printed.
    client = _full_client(closed_pnl=ccxt.NetworkError(_VENUE_MESSAGE))
    _Harness([_key_row()], [client]).install(monkeypatch)

    exit_code = await bp.run()

    records, err = _lines(capsys)
    key, summary = records
    assert key["inverse_closed_pnl_read"] == "failed"
    assert key["inverse_closed_pnl_rows_30d"] == FIELD_ABSENT
    assert summary["sections_failed"] == 1
    assert exit_code == bp.EXIT_FAILED
    assert _VENUE_MESSAGE not in json.dumps(records) + err


@pytest.mark.parametrize(
    "key_rows",
    [[], [_key_row(sync_status="revoked")]],
    ids=["no-keys", "only-an-ineligible-key"],
)
async def test_run_that_measured_no_key_exits_1(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], key_rows: list[dict[str, Any]]
) -> None:
    # WR-03: PROD holds one Bybit key. If it is revoked before the run, "every eligible key was
    # measured" is vacuously true; an exit 0 with no measurement is a pass with no evidence.
    harness = _Harness(key_rows, [])
    harness.install(monkeypatch)

    exit_code = await bp.run()

    records, err = _lines(capsys)
    assert records[-1]["record"] == "summary" and records[-1]["keys_measured"] == 0
    assert records[-1]["keys_unmeasurable"] == 0 and records[-1]["sections_failed"] == 0
    assert exit_code == bp.EXIT_FAILED
    assert err.strip() == "refused: no eligible key was measured"
    assert harness.decrypted == []


async def test_run_a_failed_funding_section_exits_1(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # WR-04: nothing drove a failed section through run() to EXIT_FAILED, so a run that returned
    # EXIT_OK whatever the sections said would have passed every test.
    monkeypatch.setattr("services.funding_fetch.MAX_PAGES", 2)
    client = _full_client(funding="endless")
    _Harness([_key_row()], [client]).install(monkeypatch)

    exit_code = await bp.run()

    records, _err = _lines(capsys)
    key, summary = records
    assert key["funding_state"] == "ceiling"
    assert summary["sections_failed"] == 1 and summary["keys_unmeasurable"] == 0
    assert exit_code == bp.EXIT_FAILED


async def test_a_planted_amount_never_reaches_stdout(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    # (1) A run whose venue answers carry the planted amount in every place an amount lives
    # (balance, position size, deposit, funding) and whose closed-pnl read fails with the planted
    # venue message: neither reaches stdout or stderr.
    planted = str(_PLANTED_AMOUNT)
    client = _FakeBybit(
        deposits=[("c1", _FLOW_T, _PLANTED_AMOUNT, "USDT")],
        unified=[unified_flow("u1", "TRANSFER_IN", _FLOW_T + 2 * DAY_MS, change=planted)],
        balance_total={"USDT": _PLANTED_AMOUNT, "USDC": _PLANTED_AMOUNT},
        positions={"linear_usdt": [_position(planted)]},
        closed_pnl=ccxt.BadRequest(_VENUE_MESSAGE),
    )
    install_execution_list(client, _fills([1, 9]), now_ms=_NOW_MS)
    harness = _Harness([_key_row()], [client])
    harness.install(monkeypatch)

    await bp.run()

    records, err = _lines(capsys)
    blob = json.dumps(records) + err
    assert planted not in blob and "98765" not in blob
    assert _VENUE_MESSAGE not in blob

    # (2) A reading that carries the amount into a count key (the slip a future change could
    # make) is refused by the emitter and reaches no output line.
    async def _leaky(_client: Any, _now_ms: int) -> dict[str, Any]:
        return {"positions_open_inverse": _PLANTED_AMOUNT}

    leaky_client = _FakeBybit()
    install_execution_list(leaky_client, [], now_ms=_NOW_MS)
    leaky = _Harness([_key_row()], [leaky_client])
    leaky.install(monkeypatch)
    monkeypatch.setattr(bp, "measure_exposure", _leaky)

    with pytest.raises(ValueError) as caught:
        await bp.run()

    captured = capsys.readouterr()
    assert "positions_open_inverse" in str(caught.value)
    assert "98765" not in str(caught.value) + captured.out + captured.err


# --- Read-only by construction ---------------------------------------------


class _Inner:
    id = "bybit"
    rateLimit = 0

    def __init__(self) -> None:
        self.hits: list[str] = []

    async def private_get_v5_execution_list(self, params: dict[str, str]) -> dict[str, Any]:
        self.hits.append("get")
        return {"result": {"list": []}}

    async def private_post_v5_order_create(self, params: dict[str, str]) -> dict[str, Any]:
        self.hits.append("post")
        return {}

    async def create_order(self, *_a: Any) -> dict[str, Any]:
        self.hits.append("order")
        return {}

    async def withdraw(self, *_a: Any) -> dict[str, Any]:
        self.hits.append("withdraw")
        return {}

    async def transfer(self, *_a: Any) -> dict[str, Any]:
        self.hits.append("transfer")
        return {}

    async def cancel_order(self, *_a: Any) -> dict[str, Any]:
        self.hits.append("cancel")
        return {}


@pytest.mark.parametrize(
    "name",
    ["private_post_v5_order_create", "create_order", "withdraw", "transfer", "cancel_order", "edit_order"],
)
def test_the_view_refuses_write_methods(name: str) -> None:
    inner = _Inner()
    view = bp._section_view(inner, 10)

    with pytest.raises(AttributeError):
        getattr(view, name)

    assert inner.hits == []


async def test_the_view_counts_a_get_and_refuses_the_call_past_its_ceiling() -> None:
    inner = _Inner()
    view = bp._section_view(inner, 1)

    await view.private_get_v5_execution_list({})
    with pytest.raises(CallCeilingReached):
        await view.private_get_v5_execution_list({})

    assert inner.hits == ["get"]  # the venue never saw the second
    assert view.ceiling_reached is True


_WRITE_NAMES = (
    r"private_post_|create_order|cancel_order|withdraw\(|transfer\(|\.insert\(|\.upsert\(|"
    r"\.delete\(|\.rpc\(|enqueue"
)


def test_the_probe_source_names_no_write_method() -> None:
    assert re.search(_WRITE_NAMES, _PROBE_SRC) is None


def test_the_write_name_pin_can_fail() -> None:
    # The pin is only worth something if it fires on a string that does contain a write name.
    assert re.search(_WRITE_NAMES, "await exchange.private_post_trade_order(params)") is not None
    assert re.search(_WRITE_NAMES, "client.table('x').insert(row)") is not None
    assert re.search(_WRITE_NAMES, "await view.withdraw(code, amount)") is not None


def test_the_probe_carries_no_coin_list_of_its_own() -> None:
    assert "STABLECOINS" not in _PROBE_SRC
    assert "is_stable_value(" in _PROBE_SRC


# --- The fingerprint -------------------------------------------------------


def test_deploy_fingerprint_is_one_line_and_moves_with_the_vocabulary(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    line = bp.deploy_fingerprint()

    assert line.startswith("bybitreads ")
    assert "\n" not in line
    # The reviewed line itself: the orchestrator compares the worker's printed line with it, so a
    # record-vocabulary change must move this literal in the same commit.
    assert line == "bybitreads 0 1 48 24 5 3"
    parts = line.split()
    assert parts[3] == str(len(bp.KEY_RECORD_KEYS)) and parts[4] == str(len(bp.SUMMARY_RECORD_KEYS))
    assert parts[5] == str(len(bp.DEPOSIT_VERDICTS)) and parts[6] == str(len(bp.TRADE_VERDICTS))
    monkeypatch.setattr(bp, "KEY_RECORD_KEYS", (*bp.KEY_RECORD_KEYS, "a_new_key"))
    assert bp.deploy_fingerprint() != line


def test_main_prints_the_exception_type_only_on_a_run_level_failure(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    import logging

    async def _boom() -> int:
        raise RuntimeError(_VENUE_MESSAGE)

    monkeypatch.setattr(bp, "run", _boom)
    try:
        assert bp.main([]) == bp.EXIT_FAILED
    finally:
        logging.disable(logging.NOTSET)

    captured = capsys.readouterr()
    assert captured.err.strip() == "failed: RuntimeError"
    assert _VENUE_MESSAGE not in captured.out + captured.err
