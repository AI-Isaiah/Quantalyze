"""Phase 188 TINYBASE plan 05 - the derive names its tiny-base days and hands their P&L to the
book on every venue (188 D-02, SC-2, SC-5, the plan 02 contract extended by plan 04).

What this pins, and why each arm can fail
-----------------------------------------
Plan 02 (realized era) and plan 04 (quiet days) leave a tiny-base day NaN in the combiner's
series and describe it in the combiner's meta: ``tiny_base_days`` (ascending ISO days) and
``tiny_base_day_pnl`` ({ISO day: P&L}, 0.0 on a quiet day, in-process only). Plan 01 hands the
MARKED tiny days to the book through ``key_inputs.dropped_day_pnl``. This plan wires the rest:

* the helpers ``tiny_base_day_list`` and ``realized_tiny_base_pnl`` (pure);
* key mode: ``key_inputs.tiny_base_days`` (the realized days before the key's first mark plus
  the marked days) and, on EVERY venue, the realized tiny days' P&L in ``dropped_day_pnl`` for
  each day the list does not already hold. On OKX, Bybit, Binance and sFOX ``_day_pnl_usd`` is
  None, so before this plan a realized tiny day reached the book as a coverage gap read at
  r = 0 (T-188-10). On Deribit and MT5 the measured tiny days are already emitted from the
  writer's own P&L and are never emitted twice, while a QUIET tiny day (no deal, no P&L entry,
  plan 04, D-08) has no P&L entry there and is emitted here with 0.0;
* strategy mode: the pre-stamp carries ``tiny_base_days`` and the bool ``tiny_base_guard``,
  and never ``tiny_base_day_pnl`` (an amount, T-73-02, T-188-08).

Harness: ``derive_key_ccxt`` and ``derive_ccxt_strategy`` of the shared NAVMTM modules fix the
combiner's meta to a constant without the tiny-base keys and have no ``meta`` parameter, and the
plan forbids editing a shared harness, so ``_derive_okx_key`` and ``_derive_okx_strategy`` below
are PRIVATE COPIES of them that take the ``(returns, meta)`` pair the real combiner produced.
Everything else is imported, not copied. ``_mt5_quiet_deals`` copies the deal shape of
``tests.test_allocator_equity_dropped_day_pnl._mt5_deals`` without its one-trading-deal-a-day
assertion, which exists precisely so that file builds no quiet day.

Every expected amount is typed beside the sum it comes from (a hand-integer account), never
computed by the code under test. 0.05 and 30 do not appear: the days are named from the books.
"""
from __future__ import annotations

from contextlib import ExitStack
from datetime import date, datetime, timedelta, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pandas as pd
import pytest

from services.external_flows import ExternalFlow
from services.job_worker import DispatchOutcome, run_derive_broker_dailies_job
from tests.test_allocator_equity_dropped_day_pnl import (
    _iso,
    _key_inputs_payload,
    tiny_base_after_withdrawal_book,
)
from tests.test_derive_broker_dailies_dualmode import _build_ctx
from tests.test_nav_marks_compose_roundtrip import (
    KEY,
    KEY_MT5,
    USER,
    KeyDb,
    compose_curve,
    derive_mt5_key,
    levels,
    route_key_csv,
)
from tests.test_nav_marks_derive_apply import (
    REALIZED_THROUGH_0305,
    StrategyDb,
    at_0010,
    prestamp,
    route_csv,
    seed_mark,
    series,
)
from tests.test_nav_marks_writer import route_marks
from tests.test_tiny_base_quiet_days import _ccxt_quiet, _entries
from tests.test_tiny_base_venues import TINY_DAYS, TINY_PNL, _ccxt, _key_c_book

_VERDICT = "fill_derived_unproven"
STRATEGY = "strat-1"


# --------------------------------------------------------------------------------------
# The helpers
# --------------------------------------------------------------------------------------


def test_the_day_list_is_the_realized_days_before_the_first_mark_united_with_the_marked_days() -> None:
    from services.tiny_base import tiny_base_day_list

    assert tiny_base_day_list(None, None) == []
    assert tiny_base_day_list([], "2026-03-06") == []
    # strictly before marks_since: the day ON it is the marked era's, and so is every later one
    assert tiny_base_day_list(
        ["2026-03-04", "2026-03-06", "2026-03-10"], "2026-03-06"
    ) == ["2026-03-04"]
    # no marks at all: every realized day, ascending, unique
    assert tiny_base_day_list(["2026-03-07", "2026-03-05", "2026-03-05"], None) == [
        "2026-03-05", "2026-03-07",
    ]
    # the union with the marked days, ascending, a day in both lists once
    assert tiny_base_day_list(
        ["2026-03-04"], "2026-03-06", ("2026-03-09", "2026-03-07", "2026-03-07")
    ) == ["2026-03-04", "2026-03-07", "2026-03-09"]
    assert tiny_base_day_list(None, "2026-03-06", ["2026-03-08"]) == ["2026-03-08"]


@pytest.mark.parametrize("bad", ["2026-3-5", "20260305", "2026-02-30", "", 20260305, None])
def test_the_day_list_refuses_a_day_that_is_not_a_canonical_iso_day(bad: Any) -> None:
    from services.tiny_base import tiny_base_day_list

    with pytest.raises(ValueError) as realized:
        tiny_base_day_list(["2026-03-04", bad], "2026-03-06")
    with pytest.raises(ValueError) as marked:
        tiny_base_day_list(["2026-03-04"], "2026-03-06", [bad])
    # static text: the offending value is never echoed
    for exc in (realized, marked):
        assert not any(ch.isdigit() for ch in str(exc.value)), str(exc.value)


def test_the_realized_pnl_keeps_the_days_before_the_first_mark() -> None:
    from services.tiny_base import realized_tiny_base_pnl

    assert realized_tiny_base_pnl(None, None) == {}
    assert realized_tiny_base_pnl({}, "2026-03-06") == {}
    pnl = {"2026-03-04": 12.5, "2026-03-06": 7.0, "2026-03-10": -3.0}
    assert realized_tiny_base_pnl(pnl, "2026-03-06") == {"2026-03-04": 12.5}
    assert realized_tiny_base_pnl(pnl, None) == pnl
    # a copy: the combiner's meta is never aliased into the payload
    assert realized_tiny_base_pnl(pnl, None) is not pnl


@pytest.mark.parametrize("amount", [float("nan"), float("inf"), -float("inf")])
def test_the_realized_pnl_refuses_a_non_finite_amount_without_echoing_it(amount: float) -> None:
    from services.tiny_base import realized_tiny_base_pnl

    with pytest.raises(ValueError) as caught:
        realized_tiny_base_pnl({"2026-03-04": amount}, None)
    text = str(caught.value).lower()
    assert "nan" not in text and "inf" not in text and "2026" not in text


# --------------------------------------------------------------------------------------
# Private harness copies: the real combiner's (returns, meta) pair through a real derive
# --------------------------------------------------------------------------------------


def _okx_patches(
    ctx: MagicMock, *, returns: pd.Series, meta: dict[str, Any], now: datetime,
    equity: float, upl: float, flows: list[ExternalFlow], apply_nothing: bool,
) -> list[Any]:
    def _dated_flows(*_args: Any, instants: Any = None, **_kw: Any) -> Any:
        return list(flows)

    return [
        patch("services.job_worker.fetch_all_trades", new=AsyncMock(return_value=[])),
        patch("services.job_worker.aclose_exchange", new=AsyncMock()),
        patch(
            "services.exchange.fetch_account_equity_and_upnl_usd",
            new=AsyncMock(return_value=(equity, False, upl, False)),
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
        patch("services.nav_twr.flow_coverage_terminus_day", new=MagicMock(return_value=None)),
        *([patch("services.job_worker.read_key_marks", new=MagicMock(return_value=[]))]
          if apply_nothing else []),
    ]


async def _derive_okx_key(
    db: KeyDb, *, returns: pd.Series, meta: dict[str, Any], now: datetime, equity: float,
    upl: float = 0.0, flows: list[ExternalFlow] | None = None, apply_nothing: bool = False,
) -> tuple[Any, dict[str, Any]]:
    """PRIVATE COPY of ``derive_key_ccxt`` taking the combiner's meta (see the module docstring)."""
    ctx, capture = _build_ctx(
        key_row={"id": KEY, "exchange": "okx", "user_id": USER}, strategy_row=None
    )
    route_key_csv(route_marks(ctx, db), db)
    patches = [
        patch("services.job_worker._allocator_key_preflight", new=AsyncMock(return_value=ctx)),
        *_okx_patches(
            ctx, returns=returns, meta=meta, now=now, equity=equity, upl=upl,
            flows=flows or [], apply_nothing=apply_nothing,
        ),
    ]
    with ExitStack() as stack:
        for p in patches:
            stack.enter_context(p)
        result = await run_derive_broker_dailies_job(
            {"id": "j", "kind": "derive_broker_dailies", "api_key_id": KEY}
        )
    return result, capture


async def _derive_okx_strategy(
    db: StrategyDb, *, returns: pd.Series, meta: dict[str, Any], now: datetime, equity: float,
    upl: float = 0.0, flows: list[ExternalFlow] | None = None, apply_nothing: bool = False,
) -> tuple[Any, dict[str, Any]]:
    """PRIVATE COPY of ``derive_ccxt_strategy`` taking the combiner's meta and the builder's flows."""
    ctx, capture = _build_ctx(
        key_row={"id": KEY, "exchange": "okx", "user_id": USER},
        strategy_row={"id": STRATEGY, "user_id": USER},
    )
    route_csv(route_marks(ctx, db), db)
    patches = [
        patch("services.job_worker._exchange_preflight", new=AsyncMock(return_value=ctx)),
        *_okx_patches(
            ctx, returns=returns, meta=meta, now=now, equity=equity, upl=upl,
            flows=flows or [], apply_nothing=apply_nothing,
        ),
    ]
    with ExitStack() as stack:
        for p in patches:
            stack.enter_context(p)
        result = await run_derive_broker_dailies_job(
            {"id": "j", "kind": "derive_broker_dailies", "strategy_id": STRATEGY}
        )
    return result, capture


def _rows(ki: dict[str, Any]) -> dict[str, float]:
    return {r["utc_day_iso"]: r["pnl_usd"] for r in ki.get("dropped_day_pnl", [])}


# --------------------------------------------------------------------------------------
# OKX key mode, realized era: the REAL combiner over key C's realized shape
# --------------------------------------------------------------------------------------


async def _derive_key_c_realized() -> tuple[KeyDb, dict[str, Any]]:
    book = _key_c_book()
    returns, meta = _ccxt(book)
    assert meta["tiny_base_days"] == TINY_DAYS  # plan 02's contract, as the real combiner gives it
    db = KeyDb()
    # The funding flow on the series' first day (2026-02-01) is left out of the key's stored flows:
    # that day has no return, so its flow sits outside the compose's window and the compose names
    # it ``out_of_window_flow`` and distrusts the curve for a reason that is not this plan's.
    result, capture = await _derive_okx_key(
        db, returns=returns, meta=meta, now=at_0010("2026-03-09"), equity=book.anchor,
        flows=[f for f in book.flows if f.utc_day_iso != _iso(0)], apply_nothing=True,
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    return db, capture


@pytest.mark.asyncio
async def test_okx_realized_tiny_days_are_named_and_their_pnl_reaches_the_book() -> None:
    """T-188-10. Key C's realized shape through the real ``combine_realized_and_funding``: the
    withdrawal leaves 400 and the next three days (P&L +188, -310, -29: the closing level minus
    the starting level, 588-400, 278-588, 249-278) open on 400, 588 and 278. OKX stores no day
    P&L (``_day_pnl_usd`` is None), so before this plan ``key_inputs`` held neither the days nor
    their amounts. Nothing else of the realized era is held: the funding day on 2026-02-01 and
    every ordinary day stay as they were."""
    _db, capture = await _derive_key_c_realized()
    ki = _key_inputs_payload(capture, KEY)

    assert ki["tiny_base_days"] == TINY_DAYS
    pnl = _rows(ki)
    assert sorted(pnl) == TINY_DAYS
    for day, amount in TINY_PNL.items():
        assert pnl[day] == pytest.approx(amount, abs=1e-6), day
    assert [r["utc_day_iso"] for r in ki["dropped_day_pnl"]] == TINY_DAYS  # ascending, once each


@pytest.mark.asyncio
async def test_okx_realized_tiny_days_leave_a_sole_key_book_with_exact_levels() -> None:
    """The book's side of T-188-10. With the tiny days' P&L stored, the compose steps the level
    through them: the sole-key book has NO return row on those days (no invented r = 0) and every
    level equals the exact-arithmetic book's closing NAV (typed from the integer ledger). Without
    the stored P&L the compose rolls back through the three days at r = 0, and every level before
    the withdrawal is off by the amounts it skipped. (The compose still raises the benign
    ``missing_return_inside_coverage`` carry flag for the three days: that is its design for a day
    the writer left out, not a defect, so the arm does not assert it absent.)"""
    db, capture = await _derive_key_c_realized()
    book = _key_c_book()
    payload = await compose_curve(db, capture)
    held = {row["date"] for row in payload["returns"]}
    for day in TINY_DAYS:
        assert day not in held, f"the book invented a return on {day}"
    curve = levels(payload)
    for i in range(1, len(book.nav)):  # day 0 is the funding day: no prior level to compare
        assert curve[_iso(i)] == pytest.approx(float(book.nav[i]), rel=1e-9), _iso(i)
    assert payload["degrade_reasons"] == []
    assert payload["is_trustworthy"] is True


@pytest.mark.asyncio
async def test_okx_without_a_tiny_day_writes_the_payload_it_always_did() -> None:
    """SC-4: a plain OKX key with no tiny day has neither new key and no ``dropped_day_pnl``."""
    db = KeyDb()
    returns = series(REALIZED_THROUGH_0305)
    result, capture = await _derive_okx_key(
        db, returns=returns, meta={"used_heuristic_capital": False,
                                   "series_completeness": _VERDICT},
        now=at_0010("2026-03-08"), equity=1000.0, apply_nothing=True,
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    ki = _key_inputs_payload(capture, KEY)
    assert "tiny_base_days" not in ki
    assert "dropped_day_pnl" not in ki


@pytest.mark.asyncio
async def test_okx_a_named_tiny_day_the_series_does_not_drop_refuses_the_derive() -> None:
    """Round 1 (SFH-4). The combiner names 2026-03-04 as a tiny day with a P&L, but the series it
    returned holds a finite return there, so the book would never receive that day's P&L and would
    read the day at r = 0 beside the P&L. A log line is not enough: the derive refuses, like the
    duplicate-day check beside it.

    Round 2 (SFH-1). The refusal is a PERMANENT failure (scrubbed message), not an escaping
    ``NavReconstructionError`` that the dispatcher would classify ``unknown`` and retry forever."""
    db = KeyDb()
    meta = {
        "used_heuristic_capital": False, "series_completeness": _VERDICT,
        "tiny_base_guard": True,
        "tiny_base_days": ["2026-03-04"],
        "tiny_base_day_pnl": {"2026-03-04": 12.5},
    }
    result, _capture = await _derive_okx_key(
        db, returns=series(REALIZED_THROUGH_0305), meta=meta,
        now=at_0010("2026-03-08"), equity=1000.0, apply_nothing=True,
    )
    assert result.outcome == DispatchOutcome.FAILED
    assert result.error_kind == "permanent"
    assert "a tiny-base day is not a dropped day" in result.error_message
    assert "12.5" not in result.error_message


# --------------------------------------------------------------------------------------
# OKX key mode with marks: the realized days before the first mark plus the marked days
# --------------------------------------------------------------------------------------

# Plan 01's tracer account: a near-total withdrawal on the first mark day, then marked moves.
_MARKS = {"2026-03-06": 400.0, "2026-03-07": 588.0, "2026-03-08": 278.0, "2026-03-09": 249.0}
_MARKED_TINY = ["2026-03-07", "2026-03-08", "2026-03-09"]
_MARKED_PNL = {"2026-03-07": 188.0, "2026-03-08": -310.0, "2026-03-09": -29.0}
_WITHDRAWAL = [ExternalFlow(utc_day_iso="2026-03-06", usd_signed=-99600.0)]


@pytest.mark.asyncio
async def test_okx_with_marks_lists_the_realized_day_before_the_first_mark_and_the_marked_days() -> None:
    """Injected into the combiner's meta: a realized tiny day BEFORE the first mark (2026-03-04,
    P&L 12.5) and one on or after the last (2026-03-10, P&L 7.0). The list is the day before
    ``marks_since`` (2026-03-06) plus the three marked days of plan 01, ascending. The day after
    the marks is the marked era's business: it is not listed and holds no ``dropped_day_pnl``
    row, so its amount is never stored from the realized era."""
    db = KeyDb()
    for day, nav in _MARKS.items():
        seed_mark(db, day, nav, key=KEY, open_pnl=0.0, venue="okx")
    realized = dict(REALIZED_THROUGH_0305)
    returns = series(realized)
    returns[pd.Timestamp("2026-03-04")] = float("nan")
    meta = {
        "used_heuristic_capital": False, "series_completeness": _VERDICT,
        "tiny_base_guard": True,
        "tiny_base_days": ["2026-03-04", "2026-03-10"],
        "tiny_base_day_pnl": {"2026-03-04": 12.5, "2026-03-10": 7.0},
    }
    result, capture = await _derive_okx_key(
        db, returns=returns, meta=meta, now=at_0010("2026-03-10"), equity=249.0,
        flows=_WITHDRAWAL,
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    ki = _key_inputs_payload(capture, KEY)

    assert ki["marks_since"] == "2026-03-06"
    assert ki["tiny_base_days"] == ["2026-03-04", *_MARKED_TINY]
    pnl = _rows(ki)
    assert sorted(pnl) == ["2026-03-04", *_MARKED_TINY]
    assert pnl["2026-03-04"] == pytest.approx(12.5, abs=1e-9)
    for day, amount in _MARKED_PNL.items():
        assert pnl[day] == pytest.approx(amount, abs=1e-9), day
    assert "2026-03-10" not in pnl


# --------------------------------------------------------------------------------------
# MT5 key mode (a writer venue: ``_day_pnl_usd`` is set)
# --------------------------------------------------------------------------------------


def _mt5_book_deals(book: Any) -> list[dict[str, Any]]:
    """Deal shape of ``_mt5_deals`` without its trading-deal-every-day assertion: a day with no
    P&L carries only its flow deal (the book's day 30 is the withdrawal with P&L 0)."""
    from tests.test_allocator_equity_dropped_day_pnl import _epoch

    deals: list[dict[str, Any]] = []
    for i, (p, f) in enumerate(zip(book.pnl, book.flow)):
        if f != 0:
            deals.append({"type": 2, "profit": float(f), "swap": 0.0, "commission": 0.0,
                          "fee": 0.0, "time": _epoch(i)})
        if p != 0:
            deals.append({"type": 1, "entry": 1, "profit": float(p), "swap": 0.0,
                          "commission": 0.0, "fee": 0.0, "time": _epoch(i)})
    return deals


@pytest.mark.asyncio
async def test_mt5_measured_tiny_days_are_held_once_not_twice(monkeypatch: pytest.MonkeyPatch) -> None:
    """MT5 emits a measured tiny day from its own day P&L in the existing block. The new hand-off
    must skip it: ``dropped_day_pnl`` repeats no day (the compose refuses a repeat as corrupt) and
    holds each dropped day of the exact-arithmetic book once, with the book's own amount. The
    book's tiny days are 31..33 (start NAVs 400, 588, 278 against a ~100000 peak)."""
    book = tiny_base_after_withdrawal_book()
    assert book.dropped_idx == [0, 31, 32, 33]
    account = {"equity": book.anchor, "balance": book.anchor, "currency": "USD", "login": 123456}
    db = KeyDb()
    result, capture = await derive_mt5_key(
        monkeypatch, db, account=account, deals=_mt5_book_deals(book), apply_nothing=True
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    ki = _key_inputs_payload(capture, KEY_MT5)

    days = [r["utc_day_iso"] for r in ki["dropped_day_pnl"]]
    assert len(days) == len(set(days)), days
    assert _rows(ki) == pytest.approx(book.dropped_pnl)
    assert ki["tiny_base_days"] == [_iso(i) for i in (31, 32, 33)]


@pytest.mark.asyncio
async def test_a_btc_mt5_tiny_day_with_no_close_never_stores_a_btc_amount_as_dollars(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Round 1 (MEDIUM-3). The key C shape in a BTC-unit MT5 account: every ledger amount is the
    USD book's times 1e-6 BTC, at a constant close of 60000.0 USD, so the measured tiny days 31 and
    32 hold (188 and -310 BTC-millionths) x 60000.0 / 1e6 = 11.28 and -18.6 dollars. Day 33's close is
    not stored yet, so its dollar P&L does not exist; the combiner's own P&L for it is -29e-6 BTC and
    must never reach ``dropped_day_pnl`` as a dollar amount."""
    book = tiny_base_after_withdrawal_book()
    scaled = [
        {**d, "profit": d["profit"] * 1e-6} for d in _mt5_book_deals(book)
    ]
    account = {"equity": book.anchor * 1e-6, "balance": book.anchor * 1e-6, "currency": "BTC",
               "login": 123456}
    closes = pd.Series(
        60_000.0, index=pd.date_range("2025-06-01", _iso(32), freq="D"), dtype="float64"
    )
    db = KeyDb()
    result, capture = await derive_mt5_key(
        monkeypatch, db, account=account, deals=scaled, closes=closes, apply_nothing=True
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    ki = _key_inputs_payload(capture, KEY_MT5)
    pnl = _rows(ki)
    assert pnl[_iso(31)] == pytest.approx(11.28, abs=1e-6)
    assert pnl[_iso(32)] == pytest.approx(-18.6, abs=1e-6)
    assert _iso(33) not in pnl, "a BTC amount was stored as dollars"
    assert all(abs(v) > 1e-3 for v in pnl.values()), pnl


def _mt5_quiet_deals(withdrawn: int) -> tuple[list[dict[str, Any]], int]:
    """Plan 04's quiet-day deal ledger, copied: flow deals and a trading deal ONLY on the days
    that have an entry, so 2026-02-02..02-04 carry no deal at all."""
    pnl_entries, flow_entries, terminal = _entries(withdrawn)

    def epoch(d: date) -> int:
        return int(datetime(d.year, d.month, d.day, 12, tzinfo=timezone.utc).timestamp())

    deals = [
        {"type": 2, "profit": float(f), "swap": 0.0, "commission": 0.0, "fee": 0.0,
         "time": epoch(d)}
        for d, f in flow_entries
    ] + [
        {"type": 1, "entry": 1, "profit": float(p), "swap": 0.0, "commission": 0.0, "fee": 0.0,
         "time": epoch(d)}
        for d, p in pnl_entries
    ]
    return deals, terminal


_QUIET = ["2026-02-02", "2026-02-03", "2026-02-04"]


def _quiet_levels(withdrawn: int) -> dict[str, float]:
    """The integer ledger's closing level per day, built independently of any code under test:
    99950 funded and +100 on 01-01, +/-100 alternately to 01-30, +50 on 01-31, the withdrawal on
    02-01, nothing on 02-02..02-04, +4 on 02-05."""
    pnl_entries, flow_entries, _terminal = _entries(withdrawn)
    pnl = {d: p for d, p in pnl_entries}
    flow = {d: f for d, f in flow_entries}
    out: dict[str, float] = {}
    level = 0
    day = date(2026, 1, 1)
    while day <= date(2026, 2, 5):
        level += pnl.get(day, 0) + flow.get(day, 0)
        out[day.isoformat()] = float(level)
        day += timedelta(days=1)
    return out


@pytest.mark.asyncio
async def test_mt5_quiet_tiny_days_get_one_zero_row_each(monkeypatch: pytest.MonkeyPatch) -> None:
    """D-08 on a writer venue. 02-02..02-04 carry no deal, so the writer's day P&L holds no entry
    for them and ``dropped_day_pnl_payload`` leaves them out; the compose would then read them as
    flat. Each gets ONE 0.0 row (nothing happened). The measured tiny day 02-05 (+4 on the carried
    400: 404 - 400) keeps the single row the existing block wrote, never a second. A sole-key book
    has no return on any of the four and its levels stay exact."""
    deals, terminal = _mt5_quiet_deals(99600)
    account = {"equity": float(terminal), "balance": float(terminal), "currency": "USD",
               "login": 123456}
    db = KeyDb()
    result, capture = await derive_mt5_key(
        monkeypatch, db, account=account, deals=deals, apply_nothing=True
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    ki = _key_inputs_payload(capture, KEY_MT5)

    days = [r["utc_day_iso"] for r in ki["dropped_day_pnl"]]
    assert len(days) == len(set(days)), days
    pnl = _rows(ki)
    assert [pnl[d] for d in _QUIET] == [0.0, 0.0, 0.0]
    assert pnl["2026-02-05"] == pytest.approx(4.0, abs=1e-9)
    assert ki["tiny_base_days"] == [*_QUIET, "2026-02-05"]

    payload = await compose_curve(db, capture, key=KEY_MT5, venue="mt5")
    held = {row["date"] for row in payload["returns"]}
    for day in [*_QUIET, "2026-02-05"]:
        assert day not in held, f"the book invented a return on {day}"
    curve = levels(payload)
    for day, level in _quiet_levels(99600).items():
        if day == "2026-01-01":  # the funding day: no prior level
            continue
        assert curve[day] == pytest.approx(level, rel=1e-9), day


@pytest.mark.asyncio
async def test_okx_quiet_tiny_days_get_a_zero_row_beside_the_measured_pnl() -> None:
    """The same account on OKX (plan 04's ccxt quiet-day shape, the real combiner): the three
    quiet days hold 0.0 and the measured tiny day 02-05 holds its +4, and the list names all four."""
    returns, meta = _ccxt_quiet(99600)
    _pnl_entries, flow_entries, terminal = _entries(99600)
    db = KeyDb()
    result, capture = await _derive_okx_key(
        db, returns=returns, meta=meta, now=at_0010("2026-02-07"), equity=float(terminal),
        flows=[ExternalFlow(utc_day_iso=d.isoformat(), usd_signed=float(f))
               for d, f in flow_entries],
        apply_nothing=True,
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    ki = _key_inputs_payload(capture, KEY)

    pnl = _rows(ki)
    assert [pnl[d] for d in _QUIET] == [0.0, 0.0, 0.0]
    assert pnl["2026-02-05"] == pytest.approx(4.0, abs=1e-9)
    assert sorted(pnl) == [*_QUIET, "2026-02-05"]
    assert ki["tiny_base_days"] == [*_QUIET, "2026-02-05"]


# --------------------------------------------------------------------------------------
# Strategy mode: the pre-stamp
# --------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_strategy_prestamp_names_the_tiny_days_and_never_their_amounts() -> None:
    """D-02 and T-188-08. The pre-stamp carries the ISO days and the guard bool; the amount
    (``tiny_base_day_pnl``) stays in-process, even though the combiner's meta holds it."""
    db = StrategyDb()
    returns = series(REALIZED_THROUGH_0305)
    returns[pd.Timestamp("2026-03-04")] = float("nan")
    meta = {
        "used_heuristic_capital": False, "series_completeness": _VERDICT,
        "tiny_base_guard": True,
        "tiny_base_days": ["2026-03-04"],
        "tiny_base_day_pnl": {"2026-03-04": 12.5},
    }
    result, capture = await _derive_okx_strategy(
        db, returns=returns, meta=meta, now=at_0010("2026-03-08"), equity=1000.0,
        apply_nothing=True,
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    flags = prestamp(capture)

    assert flags["tiny_base_days"] == ["2026-03-04"]
    assert flags["tiny_base_guard"] is True
    assert "tiny_base_day_pnl" not in flags
    assert "12.5" not in repr(flags)


@pytest.mark.asyncio
async def test_strategy_prestamp_unions_the_marked_days_and_cuts_the_realized_ones_at_the_marks() -> None:
    db = StrategyDb()
    for day, nav in _MARKS.items():
        seed_mark(db, day, nav, key=KEY, open_pnl=0.0, venue="okx")
    returns = series(REALIZED_THROUGH_0305)
    returns[pd.Timestamp("2026-03-04")] = float("nan")
    meta = {
        "used_heuristic_capital": False, "series_completeness": _VERDICT,
        "tiny_base_guard": True,
        "tiny_base_days": ["2026-03-04", "2026-03-10"],
        "tiny_base_day_pnl": {"2026-03-04": 12.5, "2026-03-10": 7.0},
    }
    result, capture = await _derive_okx_strategy(
        db, returns=returns, meta=meta, now=at_0010("2026-03-10"), equity=249.0, flows=_WITHDRAWAL,
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    flags = prestamp(capture)

    assert flags["marks_since"] == "2026-03-06"
    assert flags["tiny_base_days"] == ["2026-03-04", *_MARKED_TINY]
    assert "tiny_base_day_pnl" not in flags


@pytest.mark.asyncio
async def test_strategy_prestamp_with_marked_tiny_days_only_carries_the_list() -> None:
    """No realized tiny day at all: the marked days alone are the list, and the realized-era guard
    bool is not invented (the combiner raised none)."""
    db = StrategyDb()
    for day, nav in _MARKS.items():
        seed_mark(db, day, nav, key=KEY, open_pnl=0.0, venue="okx")
    result, capture = await _derive_okx_strategy(
        db, returns=series(REALIZED_THROUGH_0305),
        meta={"used_heuristic_capital": False, "series_completeness": _VERDICT},
        now=at_0010("2026-03-10"), equity=249.0, flows=_WITHDRAWAL,
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    flags = prestamp(capture)
    assert flags["tiny_base_days"] == _MARKED_TINY
    assert "tiny_base_guard" not in flags


@pytest.mark.asyncio
async def test_strategy_prestamp_judges_the_guard_and_the_break_on_the_published_series() -> None:
    """Round 1 (HIGH-2, SFH-2). The combiner's only tiny day is 03-10, after the first mark
    (03-06), and it raised ``tiny_base_guard`` and ``twr_chain_broken`` for the realized history. The
    realized rows from the first mark on are replaced by the marks, whose tiny days break no chain,
    so the published series (03-01 .. 03-05 realized, then the marks) has no NaN and no realized
    tiny day: neither flag may be stamped, and the list names only the marked days."""
    db = StrategyDb()
    for day, nav in _MARKS.items():
        seed_mark(db, day, nav, key=KEY, open_pnl=0.0, venue="okx")
    meta = {
        "used_heuristic_capital": False, "series_completeness": _VERDICT,
        "tiny_base_guard": True, "twr_chain_broken": True,
        "tiny_base_days": ["2026-03-10"],
        "tiny_base_day_pnl": {"2026-03-10": 7.0},
    }
    result, capture = await _derive_okx_strategy(
        db, returns=series(REALIZED_THROUGH_0305), meta=meta,
        now=at_0010("2026-03-10"), equity=249.0, flows=_WITHDRAWAL,
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    flags = prestamp(capture)
    assert flags["marks_since"] == "2026-03-06"
    assert flags["tiny_base_days"] == _MARKED_TINY
    assert "tiny_base_guard" not in flags
    assert "twr_chain_broken" not in flags


@pytest.mark.asyncio
async def test_strategy_prestamp_keeps_a_break_the_published_series_still_has() -> None:
    """The cut is not a blanket drop: a realized tiny day BEFORE the first mark is a NaN in the
    published series, flanked by valid days, so both flags stay."""
    db = StrategyDb()
    for day, nav in _MARKS.items():
        seed_mark(db, day, nav, key=KEY, open_pnl=0.0, venue="okx")
    returns = series(REALIZED_THROUGH_0305)
    returns[pd.Timestamp("2026-03-03")] = float("nan")
    meta = {
        "used_heuristic_capital": False, "series_completeness": _VERDICT,
        "tiny_base_guard": True, "twr_chain_broken": True,
        "tiny_base_days": ["2026-03-03"],
        "tiny_base_day_pnl": {"2026-03-03": 12.5},
    }
    result, capture = await _derive_okx_strategy(
        db, returns=returns, meta=meta, now=at_0010("2026-03-10"), equity=249.0, flows=_WITHDRAWAL,
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    flags = prestamp(capture)
    assert flags["tiny_base_guard"] is True
    assert flags["twr_chain_broken"] is True


@pytest.mark.asyncio
async def test_strategy_prestamp_without_a_tiny_day_carries_neither_key() -> None:
    db = StrategyDb()
    result, capture = await _derive_okx_strategy(
        db, returns=series(REALIZED_THROUGH_0305),
        meta={"used_heuristic_capital": False, "series_completeness": _VERDICT},
        now=at_0010("2026-03-08"), equity=1000.0, apply_nothing=True,
    )
    assert result.outcome == DispatchOutcome.DONE, result.error_message
    flags = prestamp(capture)
    assert "tiny_base_days" not in flags
    assert "tiny_base_guard" not in flags
    # Phase 190 plan 09: every strategy-mode prestamp also carries `last_success_snapshot`
    # (null here: the fake returns no row to snapshot). It is not a tiny-base key.
    assert flags == {"csv_source": True, "last_success_snapshot": None}



@pytest.mark.asyncio
async def test_strategy_prestamp_names_a_tiny_day_in_a_closed_mandates_tail_and_keeps_the_guard() -> None:
    """Round 2 (R2-02). A closed mandate (mandate_end 03-08, derive run on 03-10) keeps the
    allocated rows after the last in-window mark (03-07) verbatim, NaN included (W2). 03-08 is a
    tiny-base day the combiner left out: a NaN in the PUBLISHED series, but on or after
    ``marks_since`` (03-06). The guard and the named day must follow the published NaN, not the
    ``marks_since`` cut, so the row neither reads ``complete`` with an unnamed hole nor loses its
    near-zero-balance reason. 03-10 is a meta tiny day the published series does not hold as a NaN
    (the window ended on 03-08), so it stays out."""
    from tests.test_nav_marks_allocated import (
        ALLOCATED, MARKS, config, derive_allocated, seeded,
    )

    allocated = {**ALLOCATED, "2026-03-08": float("nan")}
    meta = {
        "used_heuristic_capital": False, "series_completeness": "ledger_complete",
        "tiny_base_guard": True,
        "tiny_base_days": ["2026-03-08", "2026-03-10"],
        "tiny_base_day_pnl": {"2026-03-08": 3.0, "2026-03-10": 1.0},
    }
    run = await derive_allocated(
        seeded({**MARKS, "2026-03-09": 1920.0}), cfg=config(mandate_end="2026-03-08"),
        now_day="2026-03-10", allocated=allocated,
        extra_patches=[
            patch(
                "services.broker_dailies.combine_native_ledger",
                new=MagicMock(return_value=(series(allocated), dict(meta))),
            )
        ],
    )
    assert run.result.outcome == DispatchOutcome.DONE, run.result.error_message
    flags = prestamp(run.capture)
    assert flags["marks_since"] == "2026-03-06"
    assert "2026-03-08" not in run.rows, "the tail day is a hole in the stored series"
    assert flags["tiny_base_days"] == ["2026-03-08"]
    assert flags["tiny_base_guard"] is True
