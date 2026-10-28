"""The OKX bills-chain diagnostic (Phase 179 OKXBILLSCHAIN, plan 01).

WHY these tests exist (Rule 9): the oracle's token ``chain_break`` hides which arm fired and
stops at the first failing currency, so the founder cannot choose a fix from it. The
diagnostic re-folds the bills the oracle already walked and reads the balance once more. It
runs on a LIVE account, so it has three duties these tests must be able to fail on:

  * it is GET-only and bounded: a write endpoint, an order or a trade fetch must be
    unreachable through it, and a retry inside the 429 backoff must still be counted;
  * it cannot change the verdict: the oracle's reading carries the walked bills on the arms
    that walked and none on the arms that did not, and nothing else about it moves;
  * its close-race count tells a cash balance that MOVED during the walk apart from a close
    that is broken for good, because the founder's fix differs between the two.

Exchanges here are ``SimpleNamespace`` objects with explicit methods, never a bare
``AsyncMock``: an unset method on an ``AsyncMock`` answers with a ``MagicMock`` and the code
under test would "work" on a mock. Every amount is the test's own constant.
"""
from __future__ import annotations

import ast
import re
from datetime import date, datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import ccxt.async_support as ccxt
import pytest

from services import exchange as exchange_mod
from services import okx_bills_chain as chain
from services import okx_opening_balance as obal
from tests._okx_bills import (
    OkxBalanceSequence,
    OkxBillsArchive,
    okx_balance_payload,
    okx_bill,
    okx_bill_chain,
    okx_bills_updated_in_order,
    okx_detail,
    okx_subtypes_payload,
)

OPENING_DAY = date(2026, 4, 6)
OPENING_MS = int(datetime(2026, 4, 6, tzinfo=timezone.utc).timestamp() * 1000)
DAY_MS = 24 * 60 * 60 * 1000
#: The instant the synthetic walk began, for the 7-day comparison (after the walked bills' stamps)
#: and for the sweep (between the walked bill's stamp and the "arrived later" bill's).
WALK_START_MS = OPENING_MS + 1_000_000
SWEEP_WALK_START_MS = OPENING_MS + 1_500


def _row(details: list[dict[str, str]]) -> dict[str, Any]:
    row: dict[str, Any] = okx_balance_payload("0", details)["data"][0]
    return row


def _cash(**by_ccy: str) -> dict[str, Any]:
    from decimal import Decimal

    return {ccy: Decimal(text) for ccy, text in by_ccy.items()}


def _reach_bill() -> dict[str, str]:
    """One USDT bill five days before the opening instant: proof the archive reaches it."""
    return okx_bill(1, OPENING_MS - 5 * DAY_MS, "USDT", "1000", "0")


# ---------------------------------------------------------------------------
# BudgetedExchange: GET-only, counted, bounded.
# ---------------------------------------------------------------------------


class _Inner:
    """An exchange that offers a read AND every write-shaped name, so a refusal can only come
    from the budget and never from the name being absent. It counts what reached it."""

    def __init__(self) -> None:
        self.reached: list[str] = []

    async def private_get_account_balance(self, params: dict[str, str] | None = None) -> dict[str, Any]:
        self.reached.append("private_get_account_balance")
        return {"code": "0", "data": []}

    async def private_post_trade_order(self, params: dict[str, str]) -> None:
        self.reached.append("private_post_trade_order")

    async def create_order(self, *args: Any) -> None:
        self.reached.append("create_order")

    async def fetch_my_trades(self, *args: Any) -> None:
        self.reached.append("fetch_my_trades")

    async def withdraw(self, *args: Any) -> None:
        self.reached.append("withdraw")


@pytest.mark.parametrize("name", ["private_post_trade_order", "create_order", "fetch_my_trades", "withdraw"])
def test_the_budget_resolves_get_methods_only(name: str) -> None:
    """The diagnostic runs on a live key. Whatever else changes, no name outside the GET prefix
    may reach the venue through it, and an unknown name is an AttributeError that names it."""
    inner = _Inner()
    budget = chain.BudgetedExchange(inner, 10)

    assert budget.calls == 0
    with pytest.raises(AttributeError, match=name):
        getattr(budget, name)
    assert inner.reached == []


async def test_every_call_is_counted_and_forwarded() -> None:
    inner = _Inner()
    budget = chain.BudgetedExchange(inner, 10)

    for _ in range(3):
        assert await budget.private_get_account_balance({"limit": "1"}) == {"code": "0", "data": []}

    assert budget.calls == 3
    assert inner.reached == ["private_get_account_balance"] * 3


async def test_the_call_over_the_ceiling_is_refused_before_the_venue_sees_it() -> None:
    """A budget that counted AFTER the call would let the venue see one call too many."""
    inner = _Inner()
    budget = chain.BudgetedExchange(inner, 2)

    await budget.private_get_account_balance()
    await budget.private_get_account_balance()
    with pytest.raises(chain.CallCeilingReached):
        await budget.private_get_account_balance()

    assert budget.calls == 2
    assert len(inner.reached) == 2  # the third was never awaited


class _Scripted429:
    """Raises RateLimitExceeded ``fail_times``, then answers (the backoff test's venue)."""

    def __init__(self, fail_times: int) -> None:
        self.fail_times = fail_times
        self.calls = 0

    async def private_get_account_bills(self, params: dict[str, str]) -> dict[str, Any]:
        self.calls += 1
        if self.calls <= self.fail_times:
            raise ccxt.RateLimitExceeded('okx {"msg":"Too Many Requests","code":"50011"}')
        return {"code": "0", "data": []}


async def _no_sleep(_delay: float) -> None:
    return None


async def test_a_retry_inside_the_429_backoff_is_counted(monkeypatch: pytest.MonkeyPatch) -> None:
    """The budget wraps the METHOD the backoff helper retries, so each retry spends budget. A
    budget that counted helper calls would let a 429 storm exceed the ceiling unseen."""
    monkeypatch.setattr(exchange_mod.asyncio, "sleep", _no_sleep)
    monkeypatch.setattr(exchange_mod.random, "uniform", lambda _a, _b: 0.0)
    venue = _Scripted429(fail_times=2)
    budget = chain.BudgetedExchange(venue, 10)

    reply = await exchange_mod._okx_bills_fetch_with_backoff(
        budget, "private_get_account_bills", {}, label="chain", page=0
    )

    assert reply == {"code": "0", "data": []}
    assert budget.calls == 3  # two 429s and the answer
    assert venue.calls == 3


async def test_the_ceiling_stops_a_retry_storm(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(exchange_mod.asyncio, "sleep", _no_sleep)
    monkeypatch.setattr(exchange_mod.random, "uniform", lambda _a, _b: 0.0)
    venue = _Scripted429(fail_times=99)
    budget = chain.BudgetedExchange(venue, 2)

    with pytest.raises(chain.CallCeilingReached):
        await exchange_mod._okx_bills_fetch_with_backoff(
            budget, "private_get_account_bills", {}, label="chain", page=0
        )

    assert venue.calls == 2  # the budget, not the helper's own four attempts, ended it


def test_the_ceiling_is_the_documented_bound() -> None:
    assert chain.CHAIN_CALL_CEILING == 120


def test_the_diagnostic_module_is_get_only_and_writes_nothing() -> None:
    """Static pin on the module SOURCE (the oracle's own pin, for this module): no database
    write or table call, no database helper, no POST/PUT/DELETE implicit method, no order,
    withdrawal or transfer call, none of the writers the probe's pins also forbid."""
    source = Path(chain.__file__).read_text(encoding="utf-8")
    for write in (".insert(", ".update(", ".upsert(", ".delete(", ".rpc(", ".table("):
        assert write not in source, write
    assert not re.search(r"\bprivate_(post|put|delete)_", source)
    assert not re.search(r"\b(create_order|cancel_order|withdraw|transfer)\(", source)
    tree = ast.parse(source)
    names = {n.id for n in ast.walk(tree) if isinstance(n, ast.Name)} | {
        n.attr for n in ast.walk(tree) if isinstance(n, ast.Attribute)
    }
    for forbidden in (
        "_cache_coingecko_prices",
        "_stamp_429",
        "bills_history_archive",
        "db_execute",
        "supabase",
    ):
        assert forbidden not in names, forbidden
    assert "private_get_" in source


# ---------------------------------------------------------------------------
# walked: the bills the oracle handed over, and only on the arms that walked.
# ---------------------------------------------------------------------------


def _exchange(archive: OkxBillsArchive) -> SimpleNamespace:
    return SimpleNamespace(private_get_account_bills_archive=archive)


def test_a_reading_built_without_walked_has_none() -> None:
    reading = obal.OkxOpeningReading(None, "chain_break", 0, 0, 0.0, None)
    assert reading.walked == ()


async def test_a_chain_break_carries_the_bills_it_walked() -> None:
    """The diagnostic has nothing to fold unless the oracle hands the bills over. A break
    after the walk (chain_break) must carry them; the three parse keys ride along."""
    usdt = okx_bill_chain("USDT", "1000", ["1", "1", "1"], first_id=100, first_ts=OPENING_MS + 60_000)
    usdt[1] = okx_bill(101, OPENING_MS + 120_000, "USDT", "1900", "1", sub_type="173", mgn_mode="cross")
    reading = await obal.read_okx_opening(
        _exchange(OkxBillsArchive([_reach_bill(), *usdt])), None, OPENING_DAY, _row([okx_detail("USDT", "1003")])
    )

    assert reading.unavailable_reason == "chain_break"
    assert [b["billId"] for b in reading.walked] == ["102", "101", "100"]  # walk order, newest first
    broken = next(b for b in reading.walked if b["billId"] == "101")
    assert (broken["subType"], broken["mgnMode"], broken["posBalChg"]) == ("173", "cross", "")


async def test_a_measured_reading_carries_its_walked_bills_too() -> None:
    usdt = okx_bill_chain("USDT", "1000", ["1", "1"], first_id=100, first_ts=OPENING_MS + 60_000)
    reading = await obal.read_okx_opening(
        _exchange(OkxBillsArchive([_reach_bill(), *usdt])), None, OPENING_DAY, _row([okx_detail("USDT", "1002")])
    )

    assert reading.unavailable_reason == "none" and reading.opening_usd == 1000.0
    assert len(reading.walked) == 2


async def test_a_walk_that_never_finished_carries_no_bills() -> None:
    """reach_unproven is raised INSIDE the walk (no bill from before the opening was served), so
    there is no walked list to hand over and the diagnostic must see ``()``."""
    usdt = okx_bill_chain("USDT", "1000", ["1"], first_id=100, first_ts=OPENING_MS + 60_000)
    reading = await obal.read_okx_opening(
        _exchange(OkxBillsArchive(usdt)), None, OPENING_DAY, _row([okx_detail("USDT", "1001")])
    )

    assert reading.unavailable_reason == "reach_unproven"
    assert reading.walked == ()


# ---------------------------------------------------------------------------
# The close race (mutation N3): a close that fails only against the pre-walk cash.
# ---------------------------------------------------------------------------


def _btc_report(newest: str = "1") -> chain.ChainReport:
    bills = [okx_bill(5, OPENING_MS + 1, "BTC", newest, "1")]
    return chain.analyse_chain(bills, _cash(BTC="0.9"))


def test_a_close_that_only_fails_against_the_pre_walk_cash_counts_in_matches_after() -> None:
    """BTC's newest bill says 1; the cash read BEFORE the walk said 0.9 and the read AFTER it
    says 1. The close is not broken for good: the balance moved while the walk was paging."""
    report = _btc_report()
    assert report.close_broken == frozenset({"BTC"})

    race = chain.close_race(report, _cash(BTC="0.9"), _cash(BTC="1"))

    assert race.matches_after == 1
    assert race.cash_moved == 1


def test_a_close_that_fails_against_both_reads_is_not_a_race() -> None:
    race = chain.close_race(_btc_report(), _cash(BTC="0.9"), _cash(BTC="0.9"))

    assert race.matches_after == 0
    assert race.cash_moved == 0


def test_a_currency_absent_from_a_balance_row_reads_zero() -> None:
    """The oracle reads a currency absent from the cash map as 0; so does the race count. OKB
    newest bal 0 holds against an absent row, and moving from absent to 5 is a moved balance."""
    bills = [okx_bill(5, OPENING_MS + 1, "OKB", "0", "0")]
    report = chain.analyse_chain(bills, {})
    assert report.close_broken == frozenset()

    race = chain.close_race(report, {}, _cash(OKB="5"))

    assert race.cash_moved == 1
    assert race.matches_after == 0


def test_the_race_counts_only_the_walked_currencies() -> None:
    """A currency the walk never saw cannot have had a close broken, however its cash moved."""
    race = chain.close_race(_btc_report(), _cash(BTC="0.9", ETH="3"), _cash(BTC="0.9", ETH="4"))

    assert race.cash_moved == 0


async def test_the_post_walk_read_returns_cash_by_currency() -> None:
    seq = OkxBalanceSequence([okx_balance_payload("0", [okx_detail("BTC", "1")])])

    assert await chain.read_cash_after(SimpleNamespace(private_get_account_balance=seq)) == _cash(BTC="1")


@pytest.mark.parametrize(
    "reply", [None, {"code": "0", "data": []}, {"code": "0", "data": [{"totalEq": "1", "details": "no"}]}]
)
async def test_a_malformed_post_walk_balance_is_unavailable(reply: Any) -> None:
    async def _balance(params: Any = None) -> Any:
        return reply

    with pytest.raises(obal.OpeningUnavailable) as exc:
        await chain.read_cash_after(SimpleNamespace(private_get_account_balance=_balance))

    assert exc.value.reason == "malformed_balance"


async def test_a_venue_error_on_the_post_walk_read_propagates() -> None:
    async def _balance(params: Any = None) -> Any:
        raise ccxt.NetworkError("down")

    with pytest.raises(ccxt.NetworkError):
        await chain.read_cash_after(SimpleNamespace(private_get_account_balance=_balance))


# ---------------------------------------------------------------------------
# The venue-reply fakes the whole phase relies on behave as documented.
# ---------------------------------------------------------------------------


def test_the_new_bill_keys_are_present_only_when_given() -> None:
    plain = okx_bill(1, 2, "USDT", "3", "4")
    assert set(plain) == {"billId", "ts", "ccy", "bal", "balChg", "type", "instType"}

    full = okx_bill(1, 2, "USDT", "3", "4", sub_type="173", mgn_mode="isolated", pos_bal_chg="0.5")
    assert (full["subType"], full["mgnMode"], full["posBalChg"]) == ("173", "isolated", "0.5")


def test_the_balance_update_time_is_present_only_when_given() -> None:
    assert "uTime" not in okx_detail("USDT", "1")
    assert okx_detail("USDT", "1", u_time="1700000000000")["uTime"] == "1700000000000"


def test_the_update_order_helper_holds_its_chain_in_list_order() -> None:
    """Ids and stamps are explicit and may disagree with the update order; the chain holds in
    the LIST order, so a tie or an inversion is something a test chooses, not an accident."""
    bills = okx_bills_updated_in_order(
        "USDT", "100", ["5", "-2", "7"], ids=[30, 10, 20], stamps=[5, 5, 5]
    )

    assert [b["bal"] for b in bills] == ["105", "103", "110"]
    assert [b["billId"] for b in bills] == ["30", "10", "20"]
    assert {b["ts"] for b in bills} == {"5"}


async def test_the_archive_filters_by_type_and_inst_type_and_hides_a_type() -> None:
    rows = [
        okx_bill(1, 1, "USDT", "1", "1", bill_type="2", inst_type="SPOT"),
        okx_bill(2, 2, "USDT", "2", "1", bill_type="8", inst_type="SWAP"),
        okx_bill(3, 3, "USDT", "3", "1", bill_type="8", inst_type="SPOT"),
    ]
    archive = OkxBillsArchive(rows, hide_type=frozenset({"8"}))

    unfiltered = await archive({})
    by_type = await archive({"type": "8"})
    by_inst = await archive({"instType": "SPOT"})
    both = await archive({"type": "8", "instType": "SPOT"})

    assert [r["billId"] for r in unfiltered["data"]] == ["1"]  # type 8 is hidden from a bare query
    assert [r["billId"] for r in by_type["data"]] == ["3", "2"]  # and served to a query naming it
    assert [r["billId"] for r in by_inst["data"]] == ["1"]  # a hidden type stays hidden here too
    assert [r["billId"] for r in both["data"]] == ["3"]


async def test_the_archive_without_new_switches_behaves_as_before() -> None:
    rows = [okx_bill(1, 1, "USDT", "1", "1", bill_type="8"), okx_bill(2, 2, "USDT", "2", "1")]

    assert [r["billId"] for r in (await OkxBillsArchive(rows)({}))["data"]] == ["2", "1"]


async def test_the_balance_sequence_answers_in_order_and_repeats_the_last() -> None:
    seq = OkxBalanceSequence(["first", "second"])

    assert [await seq(), await seq(), await seq()] == ["first", "second", "second"]
    assert seq.calls == 3


def test_the_subtypes_payload_has_both_shapes_the_job_parser_accepts() -> None:
    from services.okx_archive_job import _parse_live_subtypes

    types = {"2": ["1", "2"], "8": ["173"]}
    nested = okx_subtypes_payload(types)
    flat = okx_subtypes_payload(types, flat=True)

    expected = {"1": "2", "2": "2", "173": "8"}
    assert _parse_live_subtypes(nested) == expected
    assert _parse_live_subtypes(flat) == expected
    assert nested["data"][0]["subTypeDetails"][0] == {"subType": "1", "subTypeDesc": "synthetic subtype 1"}
    assert okx_subtypes_payload({}) == {"code": "0", "data": []}
    assert _parse_live_subtypes(okx_subtypes_payload({})) is None


# ---------------------------------------------------------------------------
# The arm over EVERY currency (mutations N1, N2): a world per shape.
# ---------------------------------------------------------------------------

import dataclasses  # noqa: E402 - grouped with the section that uses them
from collections.abc import Callable  # noqa: E402
from decimal import Decimal  # noqa: E402
from typing import NamedTuple  # noqa: E402

import scripts.okx_chain_record as rec  # noqa: E402


class _World(NamedTuple):
    bills: list[dict[str, str]]
    cash: dict[str, Decimal]


def _chain(ccy: str, opening: str, changes: list[str], first_id: int) -> list[dict[str, str]]:
    return okx_bill_chain(ccy, opening, changes, first_id=first_id, first_ts=OPENING_MS + 60_000)


def _with_interior_break(bills: list[dict[str, str]]) -> list[dict[str, str]]:
    """The second bill claims a change of 5 on a balance that moved by 1: one interior break."""
    bills[1] = {**bills[1], "balChg": "5"}
    return bills


def _interior_only() -> _World:
    return _World(_with_interior_break(_chain("USDT", "1000", ["1", "1", "1"], 100)), _cash(USDT="1003"))


def _close_only() -> _World:
    return _World(_chain("BTC", "0", ["1", "1"], 200), _cash(BTC="1.5"))


def _both_on_two_currencies() -> _World:
    # USDT breaks first in walk order and stops the oracle there; BTC's close is never seen by it.
    return _World(
        [*_with_interior_break(_chain("USDT", "1000", ["1", "1", "1"], 100)), *_chain("BTC", "0", ["1", "1"], 200)],
        _cash(USDT="1003", BTC="1.5"),
    )


def _none() -> _World:
    return _World(_chain("USDT", "1000", ["1", "1"], 100), _cash(USDT="1002"))


def _first_clean_later_broken() -> _World:
    return _World(
        [*_chain("USDT", "1000", ["1", "1"], 100), *_with_interior_break(_chain("BTC", "0", ["1", "1", "1"], 200))],
        _cash(USDT="1002", BTC="3"),
    )


def _two_currencies_two_arms() -> _World:
    return _World(
        [*_chain("ETH", "0", ["1", "1"], 100), *_with_interior_break(_chain("BTC", "0", ["1", "1", "1"], 200))],
        _cash(ETH="9", BTC="3"),
    )


def _absent_from_cash() -> _World:
    # Today's balance row lists no USDT at all: the oracle reads that as 0, so a newest bal of
    # 1002 is a close break.
    return _World(_chain("USDT", "1000", ["1", "1"], 100), {})


# (arm, checked, interior_broken, close_broken, links, breaks, worst)
_ARM_WORLDS = [
    pytest.param(_interior_only, ("interior", 1, 1, 0, 2, 1, "USDT"), id="interior-only"),
    pytest.param(_close_only, ("close", 1, 0, 1, 1, 0, "BTC"), id="close-only"),
    pytest.param(_both_on_two_currencies, ("both", 2, 1, 1, 3, 1, "USDT"), id="both-on-two-currencies"),
    pytest.param(_none, ("none", 1, 0, 0, 1, 0, None), id="none"),
    pytest.param(
        _first_clean_later_broken, ("interior", 2, 1, 0, 3, 1, "BTC"), id="first-in-walk-order-clean-later-broken"
    ),
    pytest.param(_two_currencies_two_arms, ("both", 2, 1, 1, 3, 1, "BTC"), id="two-currencies-two-arms"),
    pytest.param(_absent_from_cash, ("close", 1, 0, 1, 1, 0, "USDT"), id="currency-absent-from-the-cash-map"),
]


@pytest.mark.parametrize(("build", "expected"), _ARM_WORLDS)
def test_the_arm_and_counts_are_read_over_every_currency(
    build: Callable[[], _World], expected: tuple[Any, ...]
) -> None:
    """The oracle raises at the first failing currency, so it can never say 'both' or count a
    later currency. The diagnostic must, on worlds whose answers are the test's own."""
    world = build()
    report = chain.analyse_chain(world.bills, world.cash)

    arm, checked, interior_broken, close_broken, links, breaks, worst = expected
    assert rec.chain_values(report)["chain_arm"] == arm
    assert (report.ccys_checked, report.ccys_interior_broken, report.ccys_close_broken) == (
        checked,
        interior_broken,
        close_broken,
    )
    assert (report.interior_links, report.interior_breaks) == (links, breaks)
    assert report.worst_ccy == worst


def test_the_worst_currency_is_the_most_broken_then_a_close_break_then_the_symbol() -> None:
    def _breaking(ccy: str, first_id: int) -> list[dict[str, str]]:
        return _with_interior_break(_chain(ccy, "0", ["1", "1", "1"], first_id))

    # Equal interior breaks, no close break anywhere: the alphabetically first symbol.
    equal = chain.analyse_chain([*_breaking("ETH", 100), *_breaking("BTC", 200)], _cash(ETH="3", BTC="3"))
    assert equal.worst_ccy == "BTC"
    # Equal interior breaks, but ETH's close also breaks: the close break outranks the symbol.
    close_too = chain.analyse_chain([*_breaking("ETH", 100), *_breaking("BTC", 200)], _cash(ETH="9", BTC="3"))
    assert close_too.worst_ccy == "ETH"
    # More interior breaks beat a close break.
    more = chain.analyse_chain(
        [*_chain("ETH", "0", ["1", "1"], 100), *_breaking("BTC", 200)], _cash(ETH="9", BTC="3")
    )
    assert more.worst_ccy == "BTC"


def test_bills_are_ordered_by_numeric_bill_id_not_by_text() -> None:
    """The oracle sorts on ``int(billId)``; ids 9 and 10 sort the other way as text, which
    would read a healthy chain as broken."""
    bills = [
        okx_bill(9, OPENING_MS + 1, "USDT", "101", "1"),
        okx_bill(10, OPENING_MS + 2, "USDT", "103", "2"),
    ]

    report = chain.analyse_chain(bills, _cash(USDT="103"))

    assert report.interior_breaks == 0
    assert report.newest_bal["USDT"] == Decimal("103")
    assert report.newest_ts["USDT"] == OPENING_MS + 2


# ---------------------------------------------------------------------------
# What broke: the kinds on both sides, the margin mode, the position-level change.
# ---------------------------------------------------------------------------


def _kinds_world() -> _World:
    t = OPENING_MS + 60_000
    return _World(
        [
            okx_bill(1, t, "USDT", "100", "0", bill_type="2", sub_type="1", inst_type="SPOT"),
            okx_bill(2, t + 1, "USDT", "105", "3", bill_type="8", sub_type="173", inst_type="SWAP",
                     mgn_mode="cross", pos_bal_chg="0"),
            okx_bill(3, t + 2, "USDT", "110", "3", bill_type="8", sub_type="173", inst_type="SWAP",
                     mgn_mode="cross", pos_bal_chg="0.5"),
            okx_bill(4, t + 3, "USDT", "115", "3", bill_type="8", sub_type="173", inst_type="SWAP",
                     mgn_mode="isolated"),
            okx_bill(5, t + 4, "USDT", "120", "3", bill_type="2", sub_type="1", inst_type="SPOT",
                     pos_bal_chg="not-a-number"),
        ],
        _cash(USDT="120"),
    )


def test_the_kinds_modes_and_position_level_of_every_break_are_counted() -> None:
    world = _kinds_world()

    report = chain.analyse_chain(world.bills, world.cash)

    assert report.interior_breaks == 4
    assert dict(report.break_kinds) == {("8", "173", "SWAP"): 3, ("2", "1", "SPOT"): 1}
    # The bill before each break: the anchor bill once, then the previous SWAP bill three times.
    assert dict(report.break_prev_kinds) == {("2", "1", "SPOT"): 1, ("8", "173", "SWAP"): 3}
    assert dict(report.break_mgn_modes) == {"cross": 2, "isolated": 1, "": 1}
    assert report.break_pos_level == 1  # "0" is zero and the text is not a number: neither counts


def test_a_chain_without_a_break_names_no_kind() -> None:
    world = _none()

    report = chain.analyse_chain(world.bills, world.cash)

    assert dict(report.break_kinds) == {} and dict(report.break_prev_kinds) == {}
    assert dict(report.break_mgn_modes) == {} and report.break_pos_level == 0


# ---------------------------------------------------------------------------
# Residual size and shape. The relative values are exact Decimals the test derived by hand.
# ---------------------------------------------------------------------------


def test_the_largest_relative_residuals_are_exact() -> None:
    """Interior: balance 1000 before, a change of 50, balance 1000 after: residual -50 over a
    scale of 1000 is 0.05. A second break of 5 over 1000 is smaller, so the maximum is 0.05.
    Close: newest 1000 against cash 900 is 100 over 1000, which is 0.1."""
    t = OPENING_MS + 60_000
    bills = [
        okx_bill(1, t, "USDT", "1000", "0"),
        okx_bill(2, t + 1, "USDT", "1000", "50"),
        okx_bill(3, t + 2, "USDT", "1000", "5"),
    ]

    report = chain.analyse_chain(bills, _cash(USDT="900"))

    assert report.max_residual_rel == Decimal("0.05")
    assert report.max_close_residual_rel == Decimal("0.1")


def test_a_chain_without_a_break_has_no_residual() -> None:
    world = _none()

    report = chain.analyse_chain(world.bills, world.cash)

    assert report.max_residual_rel is None and report.max_close_residual_rel is None


# ---------------------------------------------------------------------------
# The residual's signature: one world per shape, built so the answer is known.
# ---------------------------------------------------------------------------


def _sig_bal_unchanged() -> _World:
    # The second bill claims +5 but the balance did not move: residual -5 on a bal that is unchanged.
    t = OPENING_MS + 60_000
    return _World(
        [
            okx_bill(1, t, "USDT", "100", "0"),
            okx_bill(2, t + 1, "USDT", "100", "5"),
            okx_bill(3, t + 2, "USDT", "105", "5"),
        ],
        _cash(USDT="105"),
    )


def _sig_double_count() -> _World:
    # The second bill's +5 was applied twice: the balance moved by 10, residual +5 equals the change.
    t = OPENING_MS + 60_000
    return _World(
        [okx_bill(1, t, "USDT", "100", "0"), okx_bill(2, t + 1, "USDT", "110", "5")], _cash(USDT="110")
    )


def _sig_interior_swap() -> _World:
    # Update order X(+1) A(+10) B(+20) Y(+3); the venue's ids put B before A. Links in id order
    # are B-after-X (+10), A-after-B (-30) and Y-after-A (+20): three consecutive breaks summing
    # to zero, a local reordering in which no money is missing.
    bills = okx_bills_updated_in_order(
        "USDT", "100", ["1", "10", "20", "3"], ids=[1, 3, 2, 4], stamps=[1, 2, 3, 4]
    )
    return _World(bills, _cash(USDT="134"))


def _sig_deleted_middle_bill() -> _World:
    # Distinct changes 1..5; the +3 bill is missing, so the link after it is short by exactly 3,
    # which is neither the bill's own change (4) nor an unchanged balance.
    bills = _chain("USDT", "100", ["1", "2", "3", "4", "5"], 10)
    del bills[2]
    return _World(bills, _cash(USDT="115"))


_SIG_WORLDS = [
    pytest.param(_sig_bal_unchanged, (1, 0, 0, 0), id="bal-unchanged"),
    pytest.param(_sig_double_count, (0, 1, 0, 0), id="double-count"),
    pytest.param(_sig_interior_swap, (0, 0, 3, 0), id="interior-swap-is-three-breaks"),
    pytest.param(_sig_deleted_middle_bill, (0, 0, 0, 1), id="deleted-middle-bill"),
]


@pytest.mark.parametrize(("build", "expected"), _SIG_WORLDS)
def test_each_break_has_one_signature(build: Callable[[], _World], expected: tuple[int, int, int, int]) -> None:
    world = build()

    report = chain.analyse_chain(world.bills, world.cash)

    assert (
        report.sig_bal_unchanged,
        report.sig_double_count,
        report.sig_reorder,
        report.sig_other,
    ) == expected


@pytest.mark.parametrize(
    "build",
    [
        *(p.values[0] for p in _SIG_WORLDS),
        *(p.values[0] for p in _ARM_WORLDS),
        _kinds_world,
    ],
)
def test_the_signature_counts_always_sum_to_the_interior_breaks(build: Callable[[], _World]) -> None:
    """A break with no signature, or two, would make the four counts a quiet lie."""
    world = build()

    report = chain.analyse_chain(world.bills, world.cash)

    assert (
        report.sig_bal_unchanged + report.sig_double_count + report.sig_reorder + report.sig_other
        == report.interior_breaks
    )


def test_two_adjacent_breaks_that_do_not_sum_to_zero_are_not_a_reorder() -> None:
    """Reordering is 'no money missing': a run whose residuals do not cancel lost or added some."""
    t = OPENING_MS + 60_000
    bills = [
        okx_bill(1, t, "USDT", "100", "0"),
        okx_bill(2, t + 1, "USDT", "112", "3"),
        okx_bill(3, t + 2, "USDT", "121", "5"),
    ]

    # Residuals are 9 (112 against 103) and 4 (121 against 117): they do not cancel, and neither
    # equals its bill's own change (3, 5) or leaves the balance unchanged.
    report = chain.analyse_chain(bills, _cash(USDT="121"))

    assert report.interior_breaks == 2
    assert report.sig_reorder == 0 and report.sig_other == 2


def test_the_report_is_frozen_and_complete() -> None:
    report = chain.analyse_chain([], {})

    assert report.ccys_checked == 0 and report.worst_ccy is None
    with pytest.raises(dataclasses.FrozenInstanceError):
        report.ccys_checked = 1  # type: ignore[misc]


# ---------------------------------------------------------------------------
# Plan 179-02 Task 1. Ordering, ties and topology: is the break an ordering artefact (ties,
# inversions, a re-sort that closes, a trail with nothing missing) or a gap (the multiset says
# bills are missing), and when did the breaks happen relative to the newest bill? Every world
# is built so its answer is the test's own.
# ---------------------------------------------------------------------------

_T0 = OPENING_MS + 60_000


def _tie_world() -> _World:
    # Update order X(+1) A(+10) B(+20) Y(+3). The venue gives B the smaller id, and A and B share
    # one stamp, so neither (ts, billId) nor billId order can tell which came first; (ts, -billId)
    # puts A first and closes the chain.
    bills = okx_bills_updated_in_order(
        "USDT", "100", ["1", "10", "20", "3"], ids=[1, 3, 2, 4], stamps=[_T0, _T0 + 5_000, _T0 + 5_000, _T0 + 6_000]
    )
    return _World(bills, _cash(USDT="134"))


def _inversion_world() -> _World:
    # Update order follows ts: X, C, D. The venue's ids put D (stamped later) BEFORE C, so in
    # billId order the later bill carries the strictly older stamp: one inversion.
    bills = okx_bills_updated_in_order(
        "USDT", "100", ["1", "10", "20"], ids=[1, 4, 3], stamps=[_T0, _T0 + 5_000, _T0 + 6_000]
    )
    return _World(bills, _cash(USDT="131"))


def test_a_tie_shows_same_stamp_links_and_closes_only_under_the_descending_id_order() -> None:
    world = _tie_world()

    report = chain.analyse_chain(world.bills, world.cash)

    assert report.billid_ts_inversions == 0
    assert (report.same_ts_links, report.same_ts_breaks) == (1, 1)
    assert report.ccys_interior_broken == 1
    assert report.closes_by_ts_id == 0  # (ts, billId) keeps B before A: still broken
    assert report.closes_by_ts_id_desc == 1  # (ts, -billId) puts A before B: the chain closes
    assert report.trail_ccys == 1 and report.gap_estimate == 0
    assert report.sig_reorder == 3


def test_an_inversion_is_counted_and_closes_when_re_sorted_by_stamp() -> None:
    world = _inversion_world()

    report = chain.analyse_chain(world.bills, world.cash)

    assert report.billid_ts_inversions == 1
    assert (report.same_ts_links, report.same_ts_breaks) == (0, 0)
    assert report.ccys_interior_broken == 1
    assert report.closes_by_ts_id == 1
    assert report.trail_ccys == 1 and report.gap_estimate == 0


def test_a_deleted_middle_bill_is_a_gap_while_a_clean_currency_still_has_a_trail() -> None:
    """Distinct changes 1..5 with the +3 bill missing: the multiset of 'balance before' and
    'balance after' has two unmatched on each side, so no order can chain the bills, and one
    bill is missing. A second, clean currency still counts in the trail."""
    broken = _sig_deleted_middle_bill()
    clean = _chain("BTC", "0", ["1", "2"], 200)

    report = chain.analyse_chain([*broken.bills, *clean], {**broken.cash, **_cash(BTC="3")})

    assert report.gap_estimate == 1
    assert report.trail_ccys == 1  # BTC only; USDT has no order-independent chain
    assert report.closes_by_ts_id == 0 and report.closes_by_ts_id_desc == 0


def test_a_clean_world_reads_zero_or_none_for_every_ordering_and_age_key() -> None:
    world = _none()

    report = chain.analyse_chain(world.bills, world.cash)

    assert (report.billid_ts_inversions, report.same_ts_links, report.same_ts_breaks) == (0, 0, 0)
    assert (report.closes_by_ts_id, report.closes_by_ts_id_desc, report.gap_estimate) == (0, 0, 0)
    assert report.trail_ccys == report.ccys_checked == 1  # an unbroken chain has a trail
    assert report.breaks_in_recent_7d == 0
    assert report.first_break_age_ms is None and report.last_break_age_ms is None


def test_break_ages_are_measured_from_the_newest_walked_bill() -> None:
    """Breaks 40 days, 3 days and 30 minutes before the newest bill (a clean one): the oldest
    break is the first, the newest the last, and two of the three are within seven days."""
    ref = _T0 + 50 * DAY_MS
    bills = [
        okx_bill(1, ref - 41 * DAY_MS, "USDT", "100", "0"),
        okx_bill(2, ref - 40 * DAY_MS, "USDT", "110", "5"),  # break (105 expected)
        okx_bill(3, ref - 3 * DAY_MS, "USDT", "120", "5"),  # break (115)
        okx_bill(4, ref - 30 * 60_000, "USDT", "130", "5"),  # break (125)
        okx_bill(5, ref, "USDT", "131", "1"),  # holds
    ]

    report = chain.analyse_chain(bills, _cash(USDT="131"))

    assert report.interior_breaks == 3
    assert report.first_break_age_ms == 40 * DAY_MS
    assert report.last_break_age_ms == 30 * 60_000
    assert report.breaks_in_recent_7d == 2


def test_the_reference_is_the_newest_bill_of_any_currency() -> None:
    """A currency whose own newest bill is old is aged against ANOTHER currency's newer bill."""
    bills = [
        okx_bill(1, _T0, "USDT", "100", "0"),
        okx_bill(2, _T0 + 1_000, "USDT", "110", "5"),  # break, 1000 ms before BTC's bill
        okx_bill(3, _T0 + 2_000, "BTC", "1", "1"),
    ]

    report = chain.analyse_chain(bills, _cash(USDT="110", BTC="1"))

    assert report.first_break_age_ms == report.last_break_age_ms == 1_000


# ---------------------------------------------------------------------------
# Plan 179-02 Task 2. The walk re-read: a second walk (transient or structural), the balance's
# own clock, and in-window bills below the walk's stop point. Mutation N9 lives on the record
# module; these tests pin the services-side pieces.
# ---------------------------------------------------------------------------

_HOLDS = okx_balance_payload("0", [okx_detail("USDT", "1002")])


def _repeat_venue(archive: OkxBillsArchive, balance: Any = _HOLDS) -> SimpleNamespace:
    return SimpleNamespace(
        private_get_account_balance=OkxBalanceSequence([balance]), private_get_account_bills_archive=archive
    )


def _holding_archive() -> OkxBillsArchive:
    usdt = okx_bill_chain("USDT", "1000", ["1", "1"], first_id=100, first_ts=OPENING_MS + 60_000)
    return OkxBillsArchive([_reach_bill(), *usdt])


def _breaking_archive() -> OkxBillsArchive:
    usdt = okx_bill_chain("USDT", "1000", ["1", "1"], first_id=100, first_ts=OPENING_MS + 60_000)
    usdt[1] = {**usdt[1], "balChg": "5"}
    return OkxBillsArchive([_reach_bill(), *usdt])


async def test_the_repeat_verdict_is_none_on_a_chain_that_holds() -> None:
    assert await chain.repeat_chain_verdict(_repeat_venue(_holding_archive()), OPENING_MS) == "none"


async def test_the_repeat_verdict_is_chain_break_on_the_same_broken_archive() -> None:
    assert await chain.repeat_chain_verdict(_repeat_venue(_breaking_archive()), OPENING_MS) == "chain_break"


@pytest.mark.parametrize(
    "balance", [None, {"code": "0", "data": []}, {"code": "0", "data": [{"totalEq": "1", "details": "no"}]}]
)
async def test_the_repeat_verdict_is_malformed_balance_on_a_malformed_row(balance: Any) -> None:
    venue = _repeat_venue(_holding_archive(), balance)

    assert await chain.repeat_chain_verdict(venue, OPENING_MS) == "malformed_balance"
    assert venue.private_get_account_bills_archive.calls == []  # the walk never started


async def test_the_repeat_verdict_is_reach_unproven_on_an_empty_first_page() -> None:
    assert await chain.repeat_chain_verdict(_repeat_venue(OkxBillsArchive([])), OPENING_MS) == "reach_unproven"


async def test_the_repeat_verdict_does_not_price() -> None:
    """A non-stable currency with no price anywhere must not turn a chain that holds into
    unpriced_ccy: the repeat answers only the chain question, and needs no database."""
    btc = okx_bill_chain("BTC", "0", ["1"], first_id=100, first_ts=OPENING_MS + 60_000)
    venue = _repeat_venue(OkxBillsArchive([_reach_bill(), *btc]), okx_balance_payload("0", [okx_detail("BTC", "1")]))

    assert await chain.repeat_chain_verdict(venue, OPENING_MS) == "none"


async def test_a_venue_error_on_the_second_walk_propagates() -> None:
    archive = _holding_archive()
    archive.effect = ccxt.AuthenticationError("okx 4321.5 signature=abc123")

    with pytest.raises(ccxt.AuthenticationError):
        await chain.repeat_chain_verdict(_repeat_venue(archive), OPENING_MS)


async def test_the_ceiling_propagates_out_of_the_second_walk() -> None:
    budget = chain.BudgetedExchange(_repeat_venue(_holding_archive()), 1)  # the balance read spends it

    with pytest.raises(chain.CallCeilingReached):
        await chain.repeat_chain_verdict(budget, OPENING_MS)


def test_the_opening_instant_is_midnight_utc_in_milliseconds() -> None:
    assert chain.opening_ms(OPENING_DAY) == OPENING_MS


def test_balance_clocks_are_read_only_from_all_digit_strings() -> None:
    row = _row(
        [
            okx_detail("USDT", "1", u_time="1700000000000"),
            okx_detail("BTC", "1"),  # no uTime
            okx_detail("ETH", "1", u_time=""),
            okx_detail("OKB", "1", u_time="12a"),
            okx_detail("DAI", "1", u_time="-5"),
            {**okx_detail("SOL", "1"), "uTime": 1700000000000},  # a number, not a string
            {**okx_detail("XRP", "1"), "ccy": ""},  # no currency
        ]
    )
    row["details"].append("not a dict")

    assert chain.balance_utimes(row) == {"USDT": 1_700_000_000_000}
    assert chain.balance_utimes({"details": "no"}) == {}


def test_the_balance_clock_race_counts_both_directions() -> None:
    """USDT's newest bill is later than the balance's own clock (the balance row is stale), BTC's
    clock is later than its newest bill (the balance moved with no later bill), ETH ties."""
    t = OPENING_MS + 60_000
    bills = [
        okx_bill(1, t, "USDT", "1", "1"),
        okx_bill(2, t + 5_000, "BTC", "1", "1"),
        okx_bill(3, t + 9_000, "ETH", "1", "1"),
    ]
    report = chain.analyse_chain(bills, _cash(USDT="1", BTC="1", ETH="1"))

    assert chain.utime_race(report, {"USDT": t - 1, "BTC": t + 5_001, "ETH": t + 9_000}) == (1, 1)


def test_the_balance_clock_race_is_none_without_a_clock_for_any_walked_currency() -> None:
    report = chain.analyse_chain([okx_bill(1, OPENING_MS + 1, "USDT", "1", "1")], _cash(USDT="1"))

    assert chain.utime_race(report, {}) is None
    assert chain.utime_race(report, {"BTC": 5}) is None  # a clock for a currency the walk never saw


def _walked(first_id: int = 100) -> list[dict[str, str]]:
    return okx_bill_chain("USDT", "1000", ["1", "1"], first_id=first_id, first_ts=OPENING_MS + 60_000)


async def test_in_window_bills_below_the_stop_point_are_counted_with_their_currencies() -> None:
    """Two in-window BTC bills and one ETH bill sit below the walk's smallest billId; the reach
    bill is older than the window and is not one of them."""
    below = [
        okx_bill(40, OPENING_MS + 1_000, "BTC", "1", "1"),
        okx_bill(41, OPENING_MS + 2_000, "BTC", "2", "1"),
        okx_bill(42, OPENING_MS + 3_000, "ETH", "1", "1"),
    ]
    archive = OkxBillsArchive([_reach_bill(), *below, *_walked()])

    got = await chain.read_below_stop(_exchange(archive), OPENING_MS, _walked())

    assert got == chain.BelowStop(count=3, ccys=2, complete=True)
    assert archive.calls == [{"limit": "100", "begin": str(OPENING_MS), "after": "100"}]


async def test_a_full_below_stop_page_is_reported_incomplete() -> None:
    below = [okx_bill(i, OPENING_MS + i, "BTC", "1", "1") for i in range(1, 101)]
    archive = OkxBillsArchive([*below, *_walked(first_id=200)])

    got = await chain.read_below_stop(_exchange(archive), OPENING_MS, _walked(first_id=200))

    assert got.count == 100 and got.ccys == 1 and got.complete is False  # one page is a presence check


async def test_nothing_below_the_stop_point_is_a_complete_zero() -> None:
    archive = OkxBillsArchive([_reach_bill(), *_walked()])

    assert await chain.read_below_stop(_exchange(archive), OPENING_MS, _walked()) == chain.BelowStop(0, 0, True)


async def test_the_below_stop_read_uses_the_backoff_helper(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(exchange_mod.asyncio, "sleep", _no_sleep)
    monkeypatch.setattr(exchange_mod.random, "uniform", lambda _a, _b: 0.0)
    calls: list[int] = []

    async def _once_429(params: dict[str, str]) -> dict[str, Any]:
        calls.append(1)
        if len(calls) == 1:
            raise ccxt.RateLimitExceeded('okx {"msg":"Too Many Requests","code":"50011"}')
        return {"code": "0", "data": []}

    got = await chain.read_below_stop(
        SimpleNamespace(private_get_account_bills_archive=_once_429), OPENING_MS, _walked()
    )

    assert got.count == 0 and len(calls) == 2  # the 429 was retried, not raised


# ---------------------------------------------------------------------------
# Plan 179-02 Task 3. The 7-day store (/account/bills) and the hidden kinds (the type and
# instType presence sweep). Mutation N6 targets the backoff test of the 7-day reader.
# ---------------------------------------------------------------------------


def _store(count: int, *, first_id: int = 1) -> list[dict[str, str]]:
    """``count`` USDT bills with rising ids and stamps inside the window."""
    return [okx_bill(first_id + i, OPENING_MS + 1_000 + i, "USDT", "1", "1") for i in range(count)]


def _recent_venue(store: OkxBillsArchive) -> SimpleNamespace:
    return SimpleNamespace(private_get_account_bills=store)


async def test_the_seven_day_store_is_paged_newest_first_until_a_short_page() -> None:
    store = OkxBillsArchive(_store(150))

    got = await chain.read_recent_bills(_recent_venue(store))

    assert (len(got.rows), got.complete, got.ceiling_hit) == (150, True, False)
    assert store.calls == [{"limit": "100"}, {"limit": "100", "after": "51"}]  # the cursor is the page minimum


async def test_a_stalled_seven_day_cursor_ends_the_read_incomplete() -> None:
    store = OkxBillsArchive(_store(150), ignore_after=True)  # serves the same page again

    got = await chain.read_recent_bills(_recent_venue(store))

    assert (len(got.rows), got.complete, got.ceiling_hit) == (100, False, False)  # the repeat is not kept


async def test_the_seven_day_page_ceiling_ends_the_read_incomplete() -> None:
    store = OkxBillsArchive(_store(chain.RECENT_PAGE_CEILING * 100 + 50))

    got = await chain.read_recent_bills(_recent_venue(store))

    assert (len(got.rows), got.complete, got.ceiling_hit) == (chain.RECENT_PAGE_CEILING * 100, False, False)
    assert len(store.calls) == chain.RECENT_PAGE_CEILING


async def test_the_call_ceiling_mid_paging_keeps_the_rows_read_and_says_so() -> None:
    store = OkxBillsArchive(_store(150))
    budget = chain.BudgetedExchange(_recent_venue(store), 1)

    got = await chain.read_recent_bills(budget)

    assert (len(got.rows), got.complete, got.ceiling_hit) == (100, False, True)


async def test_the_seven_day_read_uses_the_backoff_helper(monkeypatch: pytest.MonkeyPatch) -> None:
    """Mutation N6 target: a reader that awaited the venue method directly would raise on the
    first 429 instead of retrying it."""
    monkeypatch.setattr(exchange_mod.asyncio, "sleep", _no_sleep)
    monkeypatch.setattr(exchange_mod.random, "uniform", lambda _a, _b: 0.0)
    venue = _Scripted429(fail_times=1)

    got = await chain.read_recent_bills(venue)

    assert (got.rows, got.complete, got.ceiling_hit) == ((), True, False)
    assert venue.calls == 2  # the 429 and the answer


def _recent_of(rows: list[dict[str, str]]) -> tuple[dict[str, str], ...]:
    return tuple(rows)


def _walk_of_three() -> list[dict[str, str]]:
    return okx_bill_chain("USDT", "1000", ["1", "1", "1"], first_id=100, first_ts=OPENING_MS + 60_000)


def test_a_seven_day_bill_missing_from_the_walk_inside_its_range_is_a_real_absence() -> None:
    walked = _walk_of_three()
    older_than_window = okx_bill(60, OPENING_MS - 1, "USDT", "1", "1")  # below the window: no absence
    missing = okx_bill(50, OPENING_MS + 1_000, "BTC", "1", "1", bill_type="8", sub_type="173", inst_type="SWAP")

    got = chain.recent_overlap(walked, _recent_of([*walked, missing, older_than_window]), OPENING_MS, WALK_START_MS)

    assert (got.both, got.only_bills, got.after_walk, got.only_archive, got.field_mismatch) == (3, 1, 0, 0, 0)
    assert dict(got.only_bills_kinds) == {("8", "173", "SWAP"): 1}


def test_a_seven_day_bill_above_the_walks_largest_id_is_after_the_walk() -> None:
    walked = _walk_of_three()
    newer = okx_bill(900, OPENING_MS + 5_000_000, "USDT", "1", "1")

    got = chain.recent_overlap(walked, _recent_of([*walked, newer]), OPENING_MS, WALK_START_MS)

    assert (got.both, got.only_bills, got.after_walk) == (3, 0, 1)
    assert got.behind_ms == 0  # a bill stamped after the walk began is not the archive lagging


def test_a_seven_day_bill_above_the_walks_largest_id_but_stamped_before_the_walk_is_a_real_absence() -> None:
    """Review WR-01: the archive should have served it (it existed before the walk began), so it is
    not filed as "arrived after the walk" and the comparison cannot read as no absence."""
    walked = _walk_of_three()  # newest stamp OPENING_MS + 180_000
    newer_id_older_than_the_walk = okx_bill(900, OPENING_MS + 500_000, "USDT", "1", "1", bill_type="34")

    got = chain.recent_overlap(
        walked, _recent_of([*walked, newer_id_older_than_the_walk]), OPENING_MS, WALK_START_MS
    )

    assert (got.only_bills, got.after_walk) == (1, 0)
    assert dict(got.only_bills_kinds) == {("34", "", "SPOT"): 1}


def test_the_lag_is_measured_over_bills_stamped_before_the_walk_began() -> None:
    """Review WR-02: one 7-day bill pre-dates the walk's start and is not in the walk (the archive
    lags it by 120 s); another is stamped after the walk began. Only the first is lag."""
    walked = _walk_of_three()  # newest stamp OPENING_MS + 180_000
    lagged = okx_bill(900, OPENING_MS + 300_000, "USDT", "1", "1")
    created_during_the_run = okx_bill(901, OPENING_MS + 5_000_000, "USDT", "1", "1")

    got = chain.recent_overlap(
        walked, _recent_of([*walked, lagged, created_during_the_run]), OPENING_MS, WALK_START_MS
    )

    assert got.behind_ms == 300_000 - 180_000


def test_a_walked_bill_the_seven_day_store_lacks_is_only_in_the_archive() -> None:
    """The 7-day store lacks the middle bill, which is stamped after the store's oldest bill. The
    store's own oldest bill is excluded from the comparison (a boundary is not an absence)."""
    walked = _walk_of_three()

    got = chain.recent_overlap(walked, _recent_of([walked[0], walked[2]]), OPENING_MS, WALK_START_MS)

    assert (got.both, got.only_archive) == (2, 1)


def test_a_same_id_field_difference_is_a_mismatch_but_a_same_number_is_not() -> None:
    walked = _walk_of_three()
    changed = {**walked[1], "bal": "1999"}
    same_number = {**walked[2], "bal": walked[2]["bal"] + ".0", "balChg": walked[2]["balChg"] + ".0"}

    got = chain.recent_overlap(walked, _recent_of([walked[0], changed, same_number]), OPENING_MS, WALK_START_MS)

    assert got.field_mismatch == 1  # Decimal equality: 1003.0 is 1003
    assert got.both == 3


def test_ccy_and_stamp_differences_are_mismatches_too() -> None:
    walked = _walk_of_three()

    other_ccy = chain.recent_overlap(walked, _recent_of([{**walked[0], "ccy": "BTC"}]), OPENING_MS, WALK_START_MS)
    other_ts = chain.recent_overlap(walked, _recent_of([{**walked[0], "ts": "5"}]), OPENING_MS, WALK_START_MS)

    assert other_ccy.field_mismatch == 1 and other_ts.field_mismatch == 1


def test_an_empty_seven_day_store_measures_no_lag() -> None:
    got = chain.recent_overlap(_walk_of_three(), (), OPENING_MS, WALK_START_MS)

    assert got.behind_ms is None
    assert (got.both, got.only_bills, got.after_walk, got.only_archive) == (0, 0, 0, 0)


async def _types_of(reply: Any) -> tuple[str, ...]:
    async def _subtypes(params: dict[str, str]) -> Any:
        return reply

    return await chain.read_bill_types(SimpleNamespace(private_get_account_subtypes=_subtypes))


async def test_bill_types_are_read_from_the_nested_and_the_flat_shape_in_numeric_order() -> None:
    types = {"8": ["173"], "13": ["1"], "2": ["1", "2"]}

    assert await _types_of(okx_subtypes_payload(types)) == ("2", "8", "13")  # numeric, not text, order
    assert await _types_of(okx_subtypes_payload(types, flat=True)) == ("2", "8", "13")  # and deduplicated


@pytest.mark.parametrize(
    "reply",
    [
        None,
        "no",
        {"code": "0", "data": "no"},
        {"code": "0", "data": []},
        {"code": "0", "data": ["x", 5, {"type": "abc", "subTypeDetails": []}, {"type": "99999", "subType": "1"}]},
        {"code": "0", "data": [{"type": "2"}]},  # a type with neither a nested list nor a flat subType
    ],
)
async def test_an_unrecognisable_subtypes_reply_is_zero_types_a_count_and_not_a_pass(reply: Any) -> None:
    assert await _types_of(reply) == ()


def _sweep_world(
    rows: list[dict[str, str]], *, hide: frozenset[str] = frozenset()
) -> tuple[SimpleNamespace, OkxBillsArchive]:
    archive = OkxBillsArchive(rows, hide_type=hide)
    return _exchange(archive), archive


async def test_a_type_the_unfiltered_walk_never_served_is_hidden_and_named() -> None:
    walked = [okx_bill(100, OPENING_MS + 1_000, "USDT", "1", "1"), okx_bill(102, OPENING_MS + 3_000, "USDT", "2", "1")]
    hidden = okx_bill(101, OPENING_MS + 2_000, "USDT", "3", "1", bill_type="34", inst_type="SPOT")
    venue, archive = _sweep_world([*walked, hidden], hide=frozenset({"34"}))

    got = await chain.sweep_hidden(venue, OPENING_MS, walked, ("2", "34"), SWEEP_WALK_START_MS)

    assert (got.types_probed, got.types_hidden) == (2, 1)
    assert (got.inst_types_probed, got.inst_types_hidden) == (len(chain.SWEEP_INST_TYPES), 0)
    assert dict(got.hidden_kinds) == {("34", "", "SPOT"): 1}
    assert (got.partial, got.complete, got.ceiling_hit) == (0, True, False)
    assert len(archive.calls) == 1 + 2 + len(chain.SWEEP_INST_TYPES)
    assert archive.calls[0] == {"limit": "100"}  # the unfiltered newest page, read first
    assert all(c["begin"] == str(OPENING_MS) and c["limit"] == "100" for c in archive.calls[1:])  # ONE page each


async def test_an_inst_type_hidden_bill_counts_once_by_bill_id_across_filters() -> None:
    walked = [okx_bill(102, OPENING_MS + 3_000, "USDT", "1", "1")]
    missing = okx_bill(101, OPENING_MS + 2_000, "USDT", "2", "1", bill_type="8", sub_type="173", inst_type="SWAP")
    venue, _ = _sweep_world([*walked, missing])

    got = await chain.sweep_hidden(venue, OPENING_MS, walked, ("8",), SWEEP_WALK_START_MS)

    assert (got.types_hidden, got.inst_types_hidden) == (1, 1)  # both filters served it...
    assert dict(got.hidden_kinds) == {("8", "173", "SWAP"): 1}  # ...and the kind is tallied once


async def test_a_bill_above_the_walks_largest_id_or_before_the_window_is_not_hidden() -> None:
    walked = [okx_bill(100, OPENING_MS + 1_000, "USDT", "1", "1")]
    newer = okx_bill(200, OPENING_MS + 2_000, "USDT", "2", "1")  # arrived after the walk
    older = okx_bill(50, OPENING_MS - 1, "USDT", "3", "1")  # before the window
    venue, _ = _sweep_world([*walked, newer, older])

    got = await chain.sweep_hidden(venue, OPENING_MS, walked, ("2",), SWEEP_WALK_START_MS)

    assert (got.types_hidden, got.inst_types_hidden) == (0, 0)
    assert dict(got.hidden_kinds) == {}


async def test_a_full_sweep_page_counts_as_partial() -> None:
    walked = [okx_bill(1000, OPENING_MS + 500, "USDT", "1", "1")]
    flood = [okx_bill(i, OPENING_MS + 1_000 + i, "USDT", "1", "1") for i in range(1, 101)]
    venue, _ = _sweep_world([*walked, *flood])

    got = await chain.sweep_hidden(venue, OPENING_MS, walked, ("2",), SWEEP_WALK_START_MS)

    assert got.partial == 2  # the type probe and the SPOT probe each returned a full page
    assert (got.types_hidden, got.inst_types_hidden) == (1, 1)
    # The page holds 100 rows and the walked bill (the largest id) takes one slot, so 99 are hidden.
    assert dict(got.hidden_kinds) == {("2", "", "SPOT"): 99}


async def test_a_hidden_bill_above_the_walks_largest_id_but_stamped_before_the_walk_is_hidden() -> None:
    """Review WR-01: a close-only break's hidden bills sit above every served bill. A billId
    cannot tell them from bills created after the walk; the walk's start can."""
    walked = [okx_bill(100, OPENING_MS + 1_000, "USDT", "1", "1")]
    hidden = okx_bill(200, OPENING_MS + 1_200, "USDT", "2", "1", bill_type="34")  # before the walk began
    later = okx_bill(300, OPENING_MS + 2_000, "USDT", "3", "1", bill_type="34")  # after it began
    venue, _ = _sweep_world([*walked, hidden, later], hide=frozenset({"34"}))

    got = await chain.sweep_hidden(venue, OPENING_MS, walked, ("34",), SWEEP_WALK_START_MS)

    assert got.types_hidden == 1
    assert dict(got.hidden_kinds) == {("34", "", "SPOT"): 1}  # the one stamped before, not the later one


async def test_an_above_walk_bill_the_archive_now_serves_unfiltered_is_lag_not_a_hidden_type() -> None:
    """Review WR-05: the sweep runs well after the walk, so a bill stamped just before the walk that
    the archive had not ingested yet is now in the archive. A filtered query serves it, but so does
    the unfiltered newest page, so it is not hidden by its type and must not count as a hidden kind."""
    walked = [okx_bill(100, OPENING_MS + 1_000, "USDT", "1", "1")]
    lagged = okx_bill(200, OPENING_MS + 1_200, "USDT", "2", "1", bill_type="34")  # before the walk began
    venue, _ = _sweep_world([*walked, lagged])  # no type is hidden: the unfiltered archive serves it

    got = await chain.sweep_hidden(venue, OPENING_MS, walked, ("34",), SWEEP_WALK_START_MS)

    assert (got.types_hidden, got.inst_types_hidden) == (0, 0)
    assert dict(got.hidden_kinds) == {}
    assert got.complete is True


async def test_a_full_unfiltered_page_that_stops_above_the_walk_leaves_the_sweep_incomplete() -> None:
    """Review round 3 WR-01: 100 bills created during the run fill the newest page, so a bill stamped
    before the walk and ingested late falls off it. The page could not rule lag out, so the sweep
    must not report itself complete while it counts that bill as a hidden type."""
    walked = [okx_bill(100, OPENING_MS + 1_000, "USDT", "1", "1")]
    lagged = okx_bill(200, OPENING_MS + 1_200, "USDT", "2", "1", bill_type="34")  # before the walk began
    during = [okx_bill(300 + i, OPENING_MS + 2_000 + i, "USDT", "3", "1") for i in range(100)]
    venue, _ = _sweep_world([*walked, lagged, *during])

    got = await chain.sweep_hidden(venue, OPENING_MS, walked, ("34",), SWEEP_WALK_START_MS)

    assert (got.complete, got.refused) == (False, 1)


async def test_without_the_unfiltered_page_an_above_walk_bill_still_counts_and_the_sweep_is_incomplete() -> None:
    """Review WR-05: if the unfiltered page cannot be read, lag cannot be ruled out. The hidden bill
    is still counted (a hidden type is not lost to the failed read), and the sweep says it is cut."""
    walked = [okx_bill(100, OPENING_MS + 1_000, "USDT", "1", "1")]
    hidden = okx_bill(200, OPENING_MS + 1_200, "USDT", "2", "1", bill_type="34")
    archive = OkxBillsArchive([*walked, hidden], hide_type=frozenset({"34"}))
    refusing = _Refusing(archive, ccxt.BadRequest("refused"), lambda p: "begin" not in p)

    got = await chain.sweep_hidden(_exchange(refusing), OPENING_MS, walked, ("34",), SWEEP_WALK_START_MS)

    assert got.types_hidden == 1
    assert (got.complete, got.refused) == (False, 1)


async def test_the_call_ceiling_stops_the_sweep_incomplete() -> None:
    walked = [okx_bill(100, OPENING_MS + 1_000, "USDT", "1", "1")]
    venue, _ = _sweep_world(walked)
    budget = chain.BudgetedExchange(venue, 4)

    got = await chain.sweep_hidden(budget, OPENING_MS, walked, ("2", "8"), SWEEP_WALK_START_MS)

    # the unfiltered page, two types, then SPOT, then refused
    assert (got.types_probed, got.inst_types_probed) == (2, 1)
    assert (got.complete, got.ceiling_hit) == (False, True)


async def test_a_sweep_that_probed_no_type_is_not_complete() -> None:
    """An unrecognised /account/subtypes reply gives zero types. The instType probes still run,
    but nothing searched for a hidden TYPE, so "no hidden type" is not measured: the sweep must
    not call itself complete (review CR-01, SFH-179-03)."""
    walked = [okx_bill(100, OPENING_MS + 1_000, "USDT", "1", "1")]
    venue, _ = _sweep_world(walked)

    got = await chain.sweep_hidden(venue, OPENING_MS, walked, (), SWEEP_WALK_START_MS)

    assert (got.types_probed, got.inst_types_probed) == (0, len(chain.SWEEP_INST_TYPES))
    assert (got.complete, got.ceiling_hit) == (False, False)


class _Refusing:
    """An archive that raises ``error`` on the calls ``when`` selects and answers the rest."""

    def __init__(self, inner: OkxBillsArchive, error: BaseException, when: Callable[[dict[str, str]], bool]) -> None:
        self.inner, self.error, self.when = inner, error, when

    async def __call__(self, params: dict[str, str]) -> Any:
        if self.when(params):
            raise self.error
        return await self.inner(params)


async def test_a_filter_the_venue_refuses_keeps_the_probes_already_measured() -> None:
    """Review WR-03, SFH-179-02: one refused filter used to throw away every probe already
    measured. Now the other filters answer, the hidden type found stays, and the sweep says it
    is not complete."""
    walked = [okx_bill(100, OPENING_MS + 1_000, "USDT", "1", "1"), okx_bill(102, OPENING_MS + 3_000, "USDT", "2", "1")]
    hidden = okx_bill(101, OPENING_MS + 2_000, "USDT", "3", "1", bill_type="34", inst_type="SPOT")
    archive = OkxBillsArchive([*walked, hidden], hide_type=frozenset({"34"}))
    refuse_type_8_and_events = _Refusing(
        archive,
        ccxt.BadRequest("filter refused"),
        lambda p: p.get("type") == "8" or p.get("instType") == "EVENTS",
    )

    got = await chain.sweep_hidden(_exchange(refuse_type_8_and_events), OPENING_MS, walked, ("2", "8", "34"), SWEEP_WALK_START_MS)

    assert (got.types_probed, got.types_hidden) == (2, 1)  # type 8 was refused, 2 and 34 answered
    assert (got.inst_types_probed, got.inst_types_hidden) == (len(chain.SWEEP_INST_TYPES) - 1, 0)
    assert dict(got.hidden_kinds) == {("34", "", "SPOT"): 1}
    assert (got.complete, got.ceiling_hit) == (False, False)
    assert got.refused == 2


class _Garbling:
    """An archive that answers ``reply`` instead of the real page on the calls ``when`` selects."""

    def __init__(self, inner: OkxBillsArchive, reply: Any, when: Callable[[dict[str, str]], bool]) -> None:
        self.inner, self.reply, self.when = inner, reply, when

    async def __call__(self, params: dict[str, str]) -> Any:
        if self.when(params):
            return self.reply
        return await self.inner(params)


async def test_a_malformed_page_in_the_sweep_keeps_the_probes_already_measured() -> None:
    """Review WR-02, SFH-R2-05: a filtered page the parser refuses is the likeliest odd row, and it
    used to throw away every type probe already measured (the D-02 evidence). It is now a filter
    that did not answer: the other probes stay, the sweep says it is not complete."""
    walked = [okx_bill(100, OPENING_MS + 1_000, "USDT", "1", "1"), okx_bill(102, OPENING_MS + 3_000, "USDT", "2", "1")]
    hidden = okx_bill(101, OPENING_MS + 2_000, "USDT", "3", "1", bill_type="34", inst_type="SPOT")
    archive = OkxBillsArchive([*walked, hidden], hide_type=frozenset({"34"}))
    garbled = _Garbling(archive, {"data": "not a list"}, lambda p: p.get("type") == "8")

    got = await chain.sweep_hidden(_exchange(garbled), OPENING_MS, walked, ("2", "8", "34"), SWEEP_WALK_START_MS)

    assert (got.types_probed, got.types_hidden) == (2, 1)  # type 8 was garbled, 2 and 34 answered
    assert (got.inst_types_probed, got.inst_types_hidden) == (len(chain.SWEEP_INST_TYPES), 0)
    assert dict(got.hidden_kinds) == {("34", "", "SPOT"): 1}
    assert (got.complete, got.ceiling_hit) == (False, False)
    assert got.refused == 1


@pytest.mark.parametrize("error", [ccxt.AuthenticationError("denied"), ccxt.NetworkError("down")])
async def test_an_authentication_or_network_fault_in_the_sweep_still_propagates(error: Exception) -> None:
    walked = [okx_bill(100, OPENING_MS + 1_000, "USDT", "1", "1")]
    refusing = _Refusing(OkxBillsArchive(walked), error, lambda p: p.get("type") == "8")

    with pytest.raises(type(error)):
        await chain.sweep_hidden(_exchange(refusing), OPENING_MS, walked, ("2", "8"), SWEEP_WALK_START_MS)


async def test_a_page_the_venue_refuses_keeps_the_seven_day_rows_already_read() -> None:
    """Review WR-03, SFH-179-02: the second page is refused after 100 rows were read."""
    refusing = _Refusing(OkxBillsArchive(_store(150)), ccxt.BadRequest("page refused"), lambda p: "after" in p)

    got = await chain.read_recent_bills(_recent_venue(refusing))  # type: ignore[arg-type]

    assert (len(got.rows), got.complete, got.ceiling_hit) == (100, False, False)


async def test_a_malformed_seven_day_page_keeps_the_rows_already_read() -> None:
    """Review WR-02, SFH-R2-05: the second page is one the parser refuses, after 100 rows were read."""
    garbled = _Garbling(OkxBillsArchive(_store(150)), {"data": "not a list"}, lambda p: "after" in p)

    got = await chain.read_recent_bills(_recent_venue(garbled))  # type: ignore[arg-type]

    assert (len(got.rows), got.complete, got.ceiling_hit) == (100, False, False)
    assert got.refused == 1


async def test_an_authentication_fault_in_the_seven_day_read_still_propagates() -> None:
    refusing = _Refusing(OkxBillsArchive(_store(150)), ccxt.AuthenticationError("denied"), lambda p: "after" in p)

    with pytest.raises(ccxt.AuthenticationError):
        await chain.read_recent_bills(_recent_venue(refusing))  # type: ignore[arg-type]


async def test_the_repeat_verdict_is_reach_unproven_when_the_walk_keeps_no_bill() -> None:
    """The archive reaches a bill older than the opening at once, so the walk ends with nothing
    since the opening: the oracle's own empty-walk refusal, replayed."""
    venue = _repeat_venue(OkxBillsArchive([_reach_bill()]))

    assert await chain.repeat_chain_verdict(venue, OPENING_MS) == "reach_unproven"
