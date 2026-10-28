"""The OKX opening-balance oracle (Phase 172 OKXANCHOR, plan 01).

WHY these tests exist (Rule 9): the oracle decides whether a FORCED rebuild may anchor a
curve that replaces stored history. A rebuild whose replay ends far below the account's
venue equity is refused by the 5x gate; the oracle is the independent second opinion that
can say "the missing money really was held before the window". An opinion that is derived
from the replay or from the anchor is not independent, so these tests seed the venue's own
running balance (the bills' ``bal`` / ``balChg`` and the balance row's ``cashBal``) with
constants of their own and assert the module returns THOSE, never a recomputation of them.
"""
from __future__ import annotations

import ast
import re
from collections.abc import Callable
from datetime import date, datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Any, NamedTuple
from unittest.mock import AsyncMock

import ccxt.async_support as ccxt
import httpx
import pytest

from services import equity_reconstruction as er
from services import okx_opening_balance as obal
from tests._okx_bills import (
    OkxBillsArchive,
    okx_balance_payload,
    okx_bill,
    okx_bill_chain,
    okx_detail,
)

OPENING_DAY = date(2026, 4, 6)
OPENING_MS = int(datetime(2026, 4, 6, tzinfo=timezone.utc).timestamp() * 1000)
DAY_MS = 24 * 60 * 60 * 1000

# The seeded opening of the stable account: the test's own constant, never recomputed by
# the module under test.
_USDT_OPENING = "60000"


def _exchange(archive: OkxBillsArchive, *, candles: Any = None) -> SimpleNamespace:
    """A plain namespace, NOT ``AsyncMock()``: an unset method on an ``AsyncMock`` answers
    with a ``MagicMock`` and the oracle would "work" on a mock (RESEARCH Pitfall 2)."""
    return SimpleNamespace(
        private_get_account_bills_archive=archive,
        fetch_ohlcv=AsyncMock(return_value=[] if candles is None else candles),
    )


def _reach_bill() -> dict[str, str]:
    """One USDT bill five days before the opening instant: proof the archive reaches it."""
    return okx_bill(1, OPENING_MS - 5 * DAY_MS, "USDT", "60000", "0")


def _row(details: list[dict[str, str]]) -> dict[str, Any]:
    row: dict[str, Any] = okx_balance_payload("0", details)["data"][0]
    return row


async def test_reads_the_opening_of_a_stable_account_from_its_bills() -> None:
    usdt = okx_bill_chain(
        "USDT", _USDT_OPENING, ["-40000", "-12.5"], first_id=100, first_ts=OPENING_MS + 60_000
    )
    btc = okx_bill_chain("BTC", "0", ["1"], first_id=200, first_ts=OPENING_MS + 120_000)
    exchange = _exchange(OkxBillsArchive([_reach_bill(), *usdt, *btc]))
    row = _row(
        [
            okx_detail("USDT", "19987.5"),
            okx_detail("BTC", "1"),
            okx_detail("USDC", "1500"),  # no bill since the opening: keeps its cash balance
        ]
    )

    reading = await obal.read_okx_opening(exchange, None, OPENING_DAY, row)

    assert reading.opening_usd == 61500.0  # 60000 + 1500, the test's own constants
    assert reading.unavailable_reason == "none"
    assert reading.bills_read == 3
    assert reading.blank_inst_type_bills == 0
    assert reading.newest_usdt_bal == 19987.5
    assert exchange.fetch_ohlcv.await_count == 0  # BTC opens at 0, the others are stable


async def test_the_walk_pages_backward_by_bill_id_until_a_bill_older_than_the_opening() -> None:
    """The walk ends on PROOF, never on an empty page: the first bill served from before the
    opening instant shows every bill since the opening was served. It sends no ``begin``, because a
    ``begin``-bounded query can never serve that older bill (and an oldest-first reply to it
    would hide the newest bills)."""
    chain = okx_bill_chain(
        "USDT", "1000", ["1"] * 250, first_id=100, first_ts=OPENING_MS + 60_000
    )
    archive = OkxBillsArchive([_reach_bill(), *chain])
    exchange = _exchange(archive)
    row = _row([okx_detail("USDT", "1250")])

    reading = await obal.read_okx_opening(exchange, None, OPENING_DAY, row)

    assert reading.unavailable_reason == "none"
    assert reading.opening_usd == 1000.0
    assert reading.bills_read == 250
    assert len(archive.calls) == 3  # 100, 100, then 50 rows plus the bill from before the opening
    for call in archive.calls:
        assert call["limit"] == "100"
        assert "begin" not in call and "end" not in call
        assert "instType" not in call and "ccy" not in call
    assert "after" not in archive.calls[0]
    # The archive answers newest first, so the smallest billId of a page is its last row.
    assert archive.calls[1]["after"] == str(100 + 150)
    assert archive.calls[2]["after"] == str(100 + 50)


async def test_a_stablecoin_transfer_inside_the_curve_is_counted_not_hidden() -> None:
    chain = okx_bill_chain(
        "USDT", "1000", ["2500"], first_id=100, first_ts=OPENING_MS + 60_000, bill_type="1",
        inst_type="",
    )
    exchange = _exchange(OkxBillsArchive([_reach_bill(), *chain]))
    row = _row([okx_detail("USDT", "3500")])

    reading = await obal.read_okx_opening(exchange, None, OPENING_DAY, row)

    # A reading for the probe, not a gate: the opening is still measured.
    assert reading.stable_transfer_net_usd == 2500.0
    assert reading.opening_usd == 1000.0
    assert reading.unavailable_reason == "none"
    assert reading.blank_inst_type_bills == 1


class _World(NamedTuple):
    """One scenario: what the bills fake serves, what the balance row holds, what prices exist."""

    archive: Any
    details: list[dict[str, Any]]
    candles: list[list[Any]]
    ceiling: int | None = None


def _usdt_world(chain: list[dict[str, str]], cash: str, *, with_reach: bool = True) -> _World:
    rows = ([_reach_bill()] if with_reach else []) + chain
    return _World(OkxBillsArchive(rows), [okx_detail("USDT", cash)], [])


def _gap_nan_cash_bal() -> _World:
    return _World(OkxBillsArchive([_reach_bill()]), [okx_detail("USDT", "NaN")], [])


def _gap_bool_cash_bal() -> _World:
    return _World(OkxBillsArchive([_reach_bill()]), [{"ccy": "USDT", "cashBal": True}], [])


def _gap_details_not_a_list() -> _World:
    return _World(OkxBillsArchive([_reach_bill()]), "not-a-list", [])  # type: ignore[arg-type]


def _gap_page_is_a_list() -> _World:
    return _World(AsyncMock(return_value=[]), [okx_detail("USDT", "1")], [])


def _gap_data_is_a_string() -> _World:
    return _World(AsyncMock(return_value={"data": "x"}), [okx_detail("USDT", "1")], [])


def _gap_inf_bal() -> _World:
    bad = okx_bill(100, OPENING_MS + 60_000, "USDT", "inf", "1")
    return _usdt_world([bad], "1")


def _gap_nondigit_bill_id() -> _World:
    # Served by a plain mock: the strict archive fake sorts by integer billId and would
    # itself refuse a non-numeric id, which is the venue's fault to commit, not the fake's.
    bad = okx_bill(100, OPENING_MS + 60_000, "USDT", "11", "1")
    bad["billId"] = "x1"
    return _World(
        AsyncMock(return_value={"code": "0", "data": [bad]}), [okx_detail("USDT", "11")], []
    )


def _gap_stalled_cursor() -> _World:
    chain = okx_bill_chain("USDT", "0", ["1"] * 150, first_id=100, first_ts=OPENING_MS + 60_000)
    return _World(
        OkxBillsArchive([_reach_bill(), *chain], ignore_after=True), [okx_detail("USDT", "150")], []
    )


def _gap_missing_middle_bill() -> _World:
    chain = okx_bill_chain("USDT", "1000", ["1"] * 5, first_id=100, first_ts=OPENING_MS + 60_000)
    del chain[2]
    return _usdt_world(chain, "1005")


def _gap_no_bill_at_or_before_the_opening() -> _World:
    chain = okx_bill_chain("USDT", "1000", ["1"] * 3, first_id=100, first_ts=OPENING_MS + 60_000)
    return _usdt_world(chain, "1003", with_reach=False)


def _gap_no_candle_for_the_opening_day() -> _World:
    chain = okx_bill_chain("BTC", "0.5", ["0.1"], first_id=100, first_ts=OPENING_MS + 60_000)
    stale = [[OPENING_MS - DAY_MS, 0, 0, 0, 40000.0, 0]]  # a candle, but not the opening day's
    return _World(OkxBillsArchive([_reach_bill(), *chain]), [okx_detail("BTC", "0.6")], stale)


def _gap_walk_needs_more_pages_than_the_ceiling() -> _World:
    chain = okx_bill_chain("USDT", "1000", ["1"] * 250, first_id=100, first_ts=OPENING_MS + 60_000)
    return _World(
        OkxBillsArchive([_reach_bill(), *chain]), [okx_detail("USDT", "1250")], [], ceiling=2
    )


def _gap_newest_bill_is_not_todays_cash_balance() -> _World:
    # The shape of the one live reading (a4): one page of bills whose newest USDT balance is
    # 93.2% of today's cashBal. A walk that missed the newest bills reads an older balance.
    chain = okx_bill_chain("USDT", "900", ["32"], first_id=100, first_ts=OPENING_MS + 60_000)
    return _usdt_world(chain, "1000")


def _gap_second_page_comes_back_empty() -> _World:
    chain = okx_bill_chain("USDT", "1000", ["1"] * 250, first_id=100, first_ts=OPENING_MS + 60_000)
    return _World(
        OkxBillsArchive([_reach_bill(), *chain], empty_after_cursor=True),
        [okx_detail("USDT", "1250")],
        [],
    )


def _gap_no_bill_since_the_opening() -> _World:
    # An opening day is the first replayed row's day, so the account was active on or after it:
    # an archive with nothing since the opening is not proof that nothing changed.
    return _World(OkxBillsArchive([_reach_bill()]), [okx_detail("USDT", "1")], [])


def _gap_archive_served_oldest_first() -> _World:
    chain = okx_bill_chain("USDT", "1000", ["1"] * 250, first_id=100, first_ts=OPENING_MS + 60_000)
    return _World(
        OkxBillsArchive([_reach_bill(), *chain], oldest_first=True),
        [okx_detail("USDT", "1250")],
        [],
    )


_GAP_CASES = [
    pytest.param("malformed_balance", _gap_nan_cash_bal, id="malformed_balance-nan_cash_bal"),
    pytest.param("malformed_balance", _gap_bool_cash_bal, id="malformed_balance-bool_cash_bal"),
    pytest.param(
        "malformed_balance", _gap_details_not_a_list, id="malformed_balance-details_not_a_list"
    ),
    pytest.param("malformed_bills", _gap_page_is_a_list, id="malformed_bills-page_is_a_list"),
    pytest.param(
        "malformed_bills", _gap_data_is_a_string, id="malformed_bills-data_is_a_string"
    ),
    pytest.param("malformed_bills", _gap_inf_bal, id="malformed_bills-inf_bal"),
    pytest.param(
        "malformed_bills", _gap_nondigit_bill_id, id="malformed_bills-nondigit_bill_id"
    ),
    pytest.param("malformed_bills", _gap_stalled_cursor, id="malformed_bills-stalled_cursor"),
    pytest.param("chain_break", _gap_missing_middle_bill, id="chain_break-missing_middle_bill"),
    pytest.param(
        "reach_unproven",
        _gap_no_bill_at_or_before_the_opening,
        id="reach_unproven-no_bill_at_or_before_the_opening",
    ),
    pytest.param(
        "chain_break",
        _gap_newest_bill_is_not_todays_cash_balance,
        id="chain_break-newest_bill_is_not_todays_cash_balance",
    ),
    pytest.param(
        "chain_break",
        _gap_archive_served_oldest_first,
        id="chain_break-archive_served_oldest_first",
    ),
    pytest.param(
        "reach_unproven",
        _gap_second_page_comes_back_empty,
        id="reach_unproven-second_page_comes_back_empty",
    ),
    pytest.param(
        "reach_unproven",
        _gap_no_bill_since_the_opening,
        id="reach_unproven-no_bill_since_the_opening",
    ),
    pytest.param(
        "unpriced_ccy",
        _gap_no_candle_for_the_opening_day,
        id="unpriced_ccy-no_candle_for_the_opening_day",
    ),
    pytest.param(
        "page_ceiling",
        _gap_walk_needs_more_pages_than_the_ceiling,
        id="page_ceiling-walk_needs_more_pages_than_the_ceiling",
    ),
]


@pytest.mark.parametrize(("token", "build"), _GAP_CASES)
async def test_each_structural_gap_is_unavailable_by_name(
    monkeypatch: pytest.MonkeyPatch, token: str, build: Callable[[], _World]
) -> None:
    """A garbled venue number, a missing bill, an archive that does not reach back, a coin with
    no price and an unbounded walk each stand for a REAL way OKX can fail to prove an opening.
    Each must answer with its own token and no number: a guessed or zeroed opening would let a
    forced rebuild anchor a curve on a figure nobody measured."""
    world = build()
    if world.ceiling is not None:
        monkeypatch.setattr(obal, "BILLS_ARCHIVE_PAGE_CEILING", world.ceiling)
    exchange = SimpleNamespace(
        private_get_account_bills_archive=world.archive,
        fetch_ohlcv=AsyncMock(return_value=world.candles),
    )
    row: dict[str, Any] = {"totalEq": "0", "details": world.details}

    reading = await obal.read_okx_opening(exchange, None, OPENING_DAY, row)

    assert reading.opening_usd is None
    assert reading.unavailable_reason == token
    assert token in obal.OPENING_UNAVAILABLE_REASONS


async def test_a_begin_bounded_query_served_oldest_first_does_not_hide_the_newest_bills() -> None:
    """If a ``begin``-bounded query were served oldest first, ``after=<page minimum>`` would find
    nothing and a walk would stop on the OLDEST page: USDT opens correctly, but USDC (whose only
    bill is newer) would be taken as unchanged at its cash balance and the opening would read 1050
    instead of 1000. The oracle must not depend on the reply order of a query it can avoid."""
    usdt = okx_bill_chain("USDT", "1000", ["1"] * 130, first_id=100, first_ts=OPENING_MS + 60_000)
    usdc = okx_bill_chain("USDC", "0", ["50"], first_id=400, first_ts=OPENING_MS + 10 * DAY_MS)
    archive = OkxBillsArchive([_reach_bill(), *usdt, *usdc], oldest_first_with_begin=True)
    row = _row([okx_detail("USDT", "1130"), okx_detail("USDC", "50")])

    reading = await obal.read_okx_opening(_exchange(archive), None, OPENING_DAY, row)

    assert reading.unavailable_reason == "none"
    assert reading.opening_usd == 1000.0  # 1000 USDT + 0 USDC, the test's own constants


async def test_bills_whose_newest_balance_is_not_todays_cash_are_not_a_measurement() -> None:
    """The live a4 reading, replayed: bills_read=100 and a newest USDT balance that is a fraction of
    cashBal (0.932 there). It used to come back as a measured opening. The walk here is complete,
    so the bills' own running balance does not reach today's cash: either bills are missing at the
    newest end or `bal` is not the cash balance. Either way no opening is claimed, and the bills
    read are still reported so the probe can show how far the walk got."""
    chain = okx_bill_chain("USDT", "900", ["1"] * 100, first_id=100, first_ts=OPENING_MS + 60_000)
    row = _row([okx_detail("USDT", "1073")])  # the newest bal is 1000, 0.932 of today's cash

    reading = await obal.read_okx_opening(
        _exchange(OkxBillsArchive([_reach_bill(), *chain])), None, OPENING_DAY, row
    )

    assert reading.opening_usd is None
    assert reading.unavailable_reason == "chain_break"
    assert reading.bills_read == 100


def test_every_unavailable_token_has_a_gap_case() -> None:
    """The closed set and the parametrized cases must not drift apart: a token nobody can
    reach is dead vocabulary, a case for a token outside the set is an unnamed failure."""
    assert {p.values[0] for p in _GAP_CASES} == obal.OPENING_UNAVAILABLE_REASONS


@pytest.mark.parametrize(
    "reply",
    [[], {"data": []}, {"data": "x"}, {"data": ["x"]}],
    ids=["list_reply", "empty_data", "string_data", "non_dict_first_element"],
)
async def test_a_malformed_balance_reply_reads_as_no_row(reply: Any) -> None:
    """The balance row feeds the oracle's cash balances; a reply that is not a row must read as
    NO row (the caller then reports the opening unavailable), never as an empty account."""
    exchange = SimpleNamespace(private_get_account_balance=AsyncMock(return_value=reply))

    assert await obal.read_okx_balance_row(exchange) is None


async def test_a_well_formed_balance_reply_reads_as_its_row() -> None:
    payload = okx_balance_payload("123", [okx_detail("USDT", "1")])
    exchange = SimpleNamespace(private_get_account_balance=AsyncMock(return_value=payload))

    row = await obal.read_okx_balance_row(exchange)

    assert row is not None and row["totalEq"] == "123"


async def test_a_held_coin_is_priced_at_the_opening_days_close() -> None:
    """A non-stable balance must be worth what it was worth on the opening day. Two candles are
    served, the day before closing at 40000 and the opening day at 50000, so a price taken from
    the previous day (RESEARCH Pitfall 4) would show up as 20000 instead of 25000."""
    chain = okx_bill_chain("BTC", "0.5", ["0.1"], first_id=100, first_ts=OPENING_MS + 60_000)
    candles = [
        [OPENING_MS - DAY_MS, 0, 0, 0, 40000.0, 0],
        [OPENING_MS, 0, 0, 0, 50000.0, 0],
    ]
    exchange = _exchange(OkxBillsArchive([_reach_bill(), *chain]), candles=candles)

    reading = await obal.read_okx_opening(
        exchange, None, OPENING_DAY, _row([okx_detail("BTC", "0.6")])
    )

    assert reading.unavailable_reason == "none"
    assert reading.opening_usd == 25000.0


class _PriceCache:
    """A ``token_price_history`` stand-in: any filter chain, one ``execute``. ``upsert`` raises,
    because the oracle must never write the price cache."""

    def __init__(self, rows: list[dict[str, Any]] | None = None, exc: Exception | None = None) -> None:
        self.rows = rows or []
        self.exc = exc

    def table(self, name: str) -> "_PriceCache":
        assert name == "token_price_history"
        return self

    def select(self, *_a: Any) -> "_PriceCache":
        return self

    def eq(self, *_a: Any) -> "_PriceCache":
        return self

    def gte(self, *_a: Any) -> "_PriceCache":
        return self

    def lte(self, *_a: Any) -> "_PriceCache":
        return self

    def upsert(self, *_a: Any, **_k: Any) -> Any:
        raise AssertionError("cache write")

    def execute(self) -> Any:
        if self.exc is not None:
            raise self.exc
        return SimpleNamespace(data=self.rows)


def _unlisted_coin_exchange() -> SimpleNamespace:
    """XYZ opens at 100 (bills 100 -> 105) and the venue lists no XYZ/USDT market."""
    chain = okx_bill_chain("XYZ", "100", ["5"], first_id=100, first_ts=OPENING_MS + 60_000)
    exchange = _exchange(OkxBillsArchive([_reach_bill(), *chain]))
    exchange.fetch_ohlcv = AsyncMock(side_effect=ccxt.BadSymbol("not listed"))
    return exchange


def _coingecko(monkeypatch: pytest.MonkeyPatch, handler: Callable[[httpx.Request], httpx.Response]) -> list[httpx.Request]:
    """Route every ``httpx.AsyncClient`` through ``handler`` (real httpx status semantics) and
    return the list of requests it saw. The throttle sleep is zeroed so the test stays fast."""
    seen: list[httpx.Request] = []

    def _record(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)

    real = httpx.AsyncClient
    monkeypatch.setattr(
        httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(_record), **kw)
    )
    monkeypatch.setattr(er, "COINGECKO_MIN_SLEEP_SECS", 0)
    return seen


def _gecko_prices(*pairs: tuple[int, float]) -> Callable[[httpx.Request], httpx.Response]:
    return lambda _r: httpx.Response(200, json={"prices": [[ts, px] for ts, px in pairs]})


async def test_badsymbol_falls_back_to_coingecko_and_writes_no_cache(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A coin the venue does not list is priced from the price cache read, then CoinGecko. The
    cache WRITE must stay unreachable: the oracle is read-only, so the writer raises if called."""
    exchange = _unlisted_coin_exchange()
    seen = _coingecko(monkeypatch, _gecko_prices((OPENING_MS, 2.0)))
    monkeypatch.setattr(er, "_cache_coingecko_prices", AsyncMock(side_effect=AssertionError("cache write")))

    reading = await obal.read_okx_opening(
        exchange, _PriceCache(), OPENING_DAY, _row([okx_detail("XYZ", "105")])
    )

    assert reading.opening_usd == 200.0  # 100 XYZ at 2.0
    assert len(seen) == 1


async def test_a_cached_price_is_used_before_coingecko(monkeypatch: pytest.MonkeyPatch) -> None:
    exchange = _unlisted_coin_exchange()
    seen = _coingecko(monkeypatch, _gecko_prices((OPENING_MS, 9.0)))
    cache = _PriceCache([{"asof": OPENING_DAY.isoformat(), "price_usd": 3.0}])

    reading = await obal.read_okx_opening(
        exchange, cache, OPENING_DAY, _row([okx_detail("XYZ", "105")])
    )

    assert reading.opening_usd == 300.0  # 100 XYZ at the cached 3.0, not CoinGecko's 9.0
    assert seen == []


async def test_a_price_cache_read_failure_propagates_and_is_never_unpriced(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """PD-I: a transient database fault must reach the crawl's retry classification. Read as an
    empty cache it falls through to CoinGecko and, when that has no price, ends as
    ``unpriced_ccy``, a PERMANENT ``anchor_skipped_implausible`` refusal nobody re-crawls."""
    exchange = _unlisted_coin_exchange()
    _coingecko(monkeypatch, _gecko_prices())  # would answer "no price" if it were asked
    cache = _PriceCache(exc=RuntimeError("postgrest down"))

    with pytest.raises(RuntimeError, match="postgrest down"):
        await obal.read_okx_opening(exchange, cache, OPENING_DAY, _row([okx_detail("XYZ", "105")]))


@pytest.mark.parametrize("status", [429, 500, 503])
async def test_a_coingecko_error_status_propagates_and_is_never_unpriced(
    monkeypatch: pytest.MonkeyPatch, status: int
) -> None:
    """The free tier answers 429 under load. A non-2xx read as "no price" would turn that into the
    permanent refusal PD-I forbids retrying; it must raise instead."""
    exchange = _unlisted_coin_exchange()
    _coingecko(monkeypatch, lambda _r: httpx.Response(status))

    with pytest.raises(httpx.HTTPStatusError):
        await obal.read_okx_opening(
            exchange, _PriceCache(), OPENING_DAY, _row([okx_detail("XYZ", "105")])
        )


@pytest.mark.parametrize(
    "handler",
    [
        pytest.param(_gecko_prices(), id="200_no_prices"),
        pytest.param(_gecko_prices((OPENING_MS - DAY_MS, 7.0)), id="200_other_day_only"),
        pytest.param(lambda _r: httpx.Response(404), id="404_coin_not_found"),
    ],
)
async def test_a_source_that_answered_with_no_price_for_the_day_is_unpriced(
    monkeypatch: pytest.MonkeyPatch, handler: Callable[[httpx.Request], httpx.Response]
) -> None:
    """``unpriced_ccy`` stays for the one honest case: every source answered and none has a price
    for the opening day. That is a structural gap, not a fault to retry."""
    exchange = _unlisted_coin_exchange()
    _coingecko(monkeypatch, handler)

    reading = await obal.read_okx_opening(
        exchange, _PriceCache(), OPENING_DAY, _row([okx_detail("XYZ", "105")])
    )

    assert reading.opening_usd is None
    assert reading.unavailable_reason == "unpriced_ccy"


@pytest.mark.parametrize("exc", [ccxt.RateLimitExceeded, ccxt.AuthenticationError])
async def test_a_venue_error_propagates_and_is_never_unavailable(
    monkeypatch: pytest.MonkeyPatch, exc: type[Exception]
) -> None:
    """A transient fault converted to "unavailable" would become a permanent refusal that PD-I
    (no automatic re-crawl) forbids retrying. A 429 that survives the existing backoff, or an
    authentication error, must reach the crawl's own classification as the same exception."""
    from services import exchange as exchange_module

    monkeypatch.setattr(exchange_module, "OKX_BILLS_BACKOFF_BASE_S", 0.0)
    monkeypatch.setattr(exchange_module.random, "uniform", lambda _a, _b: 0.0)
    archive = OkxBillsArchive([_reach_bill()])
    archive.effect = exc("venue said no")
    exchange = _exchange(archive)

    with pytest.raises(exc):
        await obal.read_okx_opening(exchange, None, OPENING_DAY, _row([okx_detail("USDT", "1")]))


async def test_the_balance_read_re_raises_a_network_error() -> None:
    exchange = SimpleNamespace(
        private_get_account_balance=AsyncMock(side_effect=ccxt.NetworkError("down"))
    )

    with pytest.raises(ccxt.NetworkError):
        await obal.read_okx_balance_row(exchange)


def test_the_oracle_module_is_get_only_and_writes_nothing() -> None:
    """Static pin on the module SOURCE. The oracle's verdict will gate a write to stored history,
    so it must be impossible for the oracle itself to write: no database write, no price-cache
    writer, no rate-limit stamp, no POST/PUT/DELETE implicit method, no order, withdrawal or
    transfer call."""
    source = Path(obal.__file__).read_text(encoding="utf-8")
    for write in (".insert(", ".update(", ".upsert(", ".delete(", ".rpc("):
        assert write not in source, write
    assert not re.search(r"\bprivate_(post|put|delete)_", source)
    assert not re.search(r"\b(create_order|cancel_order|withdraw|transfer)\(", source)
    names = {n.id for n in ast.walk(ast.parse(source)) if isinstance(n, ast.Name)} | {
        n.attr for n in ast.walk(ast.parse(source)) if isinstance(n, ast.Attribute)
    }
    for forbidden in ("_cache_coingecko_prices", "_stamp_429", "bills_history_archive"):
        assert forbidden not in names, forbidden
    assert "private_get_account_bills_archive" in source
    assert "private_get_account_balance(" in source


def test_opening_agrees_is_inclusive_at_the_usd_floor() -> None:
    """A small account: the anchor implies an opening of 8.0 (10.0 less a replay that ended at
    2.0). The USD floor dominates here because every allowed relative tolerance times 10 is
    below 1, so an opening of 7.0 (a difference of exactly the floor) agrees and 6.99 does not.
    An exclusive comparison would refuse the boundary; a floor that grew would accept 6.99."""
    assert obal.opening_agrees(10.0, 2.0, 7.0) is True
    assert obal.opening_agrees(10.0, 2.0, 6.99) is False


@pytest.mark.parametrize("sign", [-1.0, 1.0], ids=["below", "above"])
def test_opening_agrees_scales_with_the_anchor(sign: float) -> None:
    """A large account: the allowance is the relative tolerance times the anchor, in either
    direction (the bills can show more or less money than the anchor implies). 0.999 of it
    agrees and 1.001 of it does not, so the tolerance follows the account instead of staying a
    flat dollar amount."""
    anchor, replay_final = 100000.0, 10000.0
    implied = anchor - replay_final
    allowance = obal.OPENING_TOLERANCE_REL * anchor
    assert obal.opening_agrees(anchor, replay_final, implied + sign * 0.999 * allowance) is True
    assert obal.opening_agrees(anchor, replay_final, implied + sign * 1.001 * allowance) is False


def test_the_tolerance_is_the_measured_value() -> None:
    """The founder's recorded decision D-08 (179-05-SUMMARY.md `tolerance-founder-decision: Tighten
    to 2%`, `tolerance-rel-after: 0.02`) on a4's measured residual -0.0136 of the anchor on a
    complete walk. It replaced Phase 172 plan 03's 5%. Changing it is a decision to record there
    first, not an edit to make here."""
    assert obal.OPENING_TOLERANCE_REL == 0.02
    assert obal.OPENING_TOLERANCE_USD == 1.0
