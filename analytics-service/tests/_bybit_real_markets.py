"""Real ccxt Bybit markets, offline, and a position-list book that answers like Bybit.

A helper module, never collected as tests (no ``test_`` functions). Phase 231
BYBITREADS plan 03 (VREAD-02): the holdings poll reads three position categories
(linear USDT, linear USDC, inverse). A mock that returns the same list for every
call hides the defects that matter (a garbled USDC symbol, coin-denominated inverse
numbers, a page cut at 20), so these two pieces model the venue instead:

- ``real_bybit_with_markets()`` is a real ``ccxt.async_support.bybit`` instance whose
  markets are built from the ``instruments-info`` replies recorded in
  ``tests/cassettes/bybit/happy.yaml`` (``category=linear``: 652 symbols including
  ``BTCPERP`` settled in USDC; ``category=inverse``: 26 symbols including ``BTCUSD``
  settled in BTC). ccxt's own ``fetch_positions`` and ``parse_position`` then run
  unchanged, with no network and no credentials. The instance's low-level ``fetch``
  raises, so a test that reaches for the network fails loudly.
- ``BybitPositionBook`` answers ``GET /v5/position/list`` by Bybit's documented rule:
  ``category`` is required; ``linear`` needs ``settleCoin`` (or a ``symbol``) or the
  venue answers a bad request; rows are filtered by category and settle coin; ``limit``
  defaults to 20 and must lie in [1, 200]; a page is followed with ``nextPageCursor``; a
  category named in ``refuse`` is a permission error. The cassette holds no
  position-list reply, so the ROWS are Bybit-documented v5 shapes with the arithmetic
  typed beside every expected number in the tests, never invented from the parser's
  own field names.

The category and settle coin of a row come from the recorded instrument it names, as
they do at the venue, so a row for an unknown symbol is a fixture error, not a guess.
"""
from __future__ import annotations

import copy
import functools
import json
from collections.abc import Iterable
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock

import ccxt
import ccxt.async_support as ccxt_async
import yaml

CASSETTE = Path(__file__).parent / "cassettes" / "bybit" / "happy.yaml"

# Bybit's documented page bounds for the position list: default 20, at most 200.
DEFAULT_PAGE = 20
MAX_PAGE = 200


@functools.lru_cache(maxsize=1)
def _instruments_by_category() -> dict[str, dict[str, Any]]:
    """The recorded ``instruments-info`` replies, decoded once per session (the
    cassette is 2.5 MB). Only the full status replies are kept: the
    ``status=PreLaunch`` replies are answered empty by the market builder."""
    doc = yaml.load(CASSETTE.read_text(), Loader=yaml.CSafeLoader)
    out: dict[str, dict[str, Any]] = {}
    for interaction in doc["interactions"]:
        uri = interaction["request"]["uri"]
        if "/v5/market/instruments-info" not in uri or "status=PreLaunch" in uri:
            continue
        for category in ("linear", "inverse"):
            if f"category={category}" in uri:
                out[category] = json.loads(interaction["response"]["body"]["string"])
    assert set(out) == {"linear", "inverse"}, f"cassette lacks instruments-info: {set(out)}"
    return out


def instrument(symbol: str) -> tuple[str, dict[str, Any]]:
    """``(category, recorded instrument)`` for a Bybit symbol id such as ``BTCPERP``."""
    for category, reply in _instruments_by_category().items():
        for item in reply["result"]["list"]:
            if item["symbol"] == symbol:
                return category, item
    raise AssertionError(f"symbol {symbol!r} is not in the recorded instruments-info replies")


def linear_symbols(settle: str, count: int, *, perpetual: bool = True) -> list[str]:
    """``count`` distinct recorded Trading linear symbols settled in ``settle``."""
    items = _instruments_by_category()["linear"]["result"]["list"]
    names = [
        i["symbol"]
        for i in items
        if i["settleCoin"] == settle
        and i["status"] == "Trading"
        and (i["contractType"] == "LinearPerpetual") == perpetual
    ]
    assert len(names) >= count, f"the cassette lists only {len(names)} such symbols"
    return names[:count]


_MARKETS: list[dict[str, Any]] | None = None


async def real_bybit_with_markets() -> Any:
    """A real ccxt Bybit instance with offline markets. ``await`` it; close it after use.

    ``publicGetV5MarketInstrumentsInfo`` is replaced for the build only, so
    ``fetch_future_markets`` runs ccxt's own market parser on the recorded replies.
    """
    global _MARKETS
    by_cat = _instruments_by_category()
    if _MARKETS is None:
        builder = ccxt_async.bybit({})

        async def fake_public(params: dict[str, Any]) -> dict[str, Any]:
            if params.get("status") == "PreLaunch":
                return {"result": {"list": [], "category": params["category"]}}
            return by_cat[params["category"]]

        builder.publicGetV5MarketInstrumentsInfo = fake_public
        markets: list[dict[str, Any]] = []
        try:
            for category in ("linear", "inverse"):
                markets += await builder.fetch_future_markets({"category": category})
        finally:
            await builder.close()
        _MARKETS = markets
    ex = ccxt_async.bybit({})
    ex.set_markets(copy.deepcopy(_MARKETS))
    ex.fetch = AsyncMock(side_effect=AssertionError("a test reached the network through ccxt"))
    return ex


class BybitPositionBook:
    """``GET /v5/position/list`` answered by the venue's documented rule.

    ``rows`` are raw v5 position dicts. ``calls`` records every request, with the
    entry point that sent it (``"ccxt"`` for ``privateGetV5PositionList``, what ccxt's
    ``fetch_positions`` calls; ``"raw"`` for ``private_get_v5_position_list``, what the
    raw fallback calls) and a copy of the params as sent.
    """

    def __init__(self, rows: Iterable[dict[str, Any]], *, refuse: frozenset[str] = frozenset()) -> None:
        self._rows: list[tuple[str, str, dict[str, Any]]] = []
        for row in rows:
            category, item = instrument(row["symbol"])
            self._rows.append((category, item["settleCoin"], copy.deepcopy(row)))
        self._refuse = refuse
        self.calls: list[dict[str, Any]] = []

    def calls_for(self, entry: str, **match: Any) -> list[dict[str, Any]]:
        """The recorded params of every ``entry`` request whose params include ``match``."""
        return [
            c["params"]
            for c in self.calls
            if c["entry"] == entry and all(c["params"].get(k) == v for k, v in match.items())
        ]

    def _answer(self, entry: str, params: dict[str, Any]) -> dict[str, Any]:
        self.calls.append({"entry": entry, "params": copy.deepcopy(params)})
        category = params.get("category")
        if category not in ("linear", "inverse", "option", "spot"):
            raise ccxt.BadRequest("bybit {\"retCode\":10001,\"retMsg\":\"category is required\"}")
        if category in self._refuse:
            raise ccxt.PermissionDenied("bybit {\"retCode\":10005,\"retMsg\":\"Permission denied\"}")
        if category == "linear" and not (params.get("settleCoin") or params.get("symbol") or params.get("baseCoin")):
            raise ccxt.BadRequest("bybit {\"retCode\":10001,\"retMsg\":\"symbol or settleCoin or baseCoin required\"}")
        limit = int(params["limit"]) if params.get("limit") not in (None, "") else DEFAULT_PAGE
        if not 1 <= limit <= MAX_PAGE:
            raise ccxt.BadRequest("bybit {\"retCode\":10001,\"retMsg\":\"limit is out of range\"}")
        matching = [
            row
            for row_category, settle, row in self._rows
            if row_category == category
            and (category != "linear" or not params.get("settleCoin") or settle == params["settleCoin"])
            and (not params.get("symbol") or row["symbol"] == params["symbol"])
        ]
        cursor = params.get("cursor") or ""
        offset = int(cursor[1:]) if cursor.startswith("c") else 0
        page = matching[offset : offset + limit]
        more = offset + len(page) < len(matching)
        return {
            "retCode": 0,
            "retMsg": "OK",
            "result": {
                "category": category,
                "list": copy.deepcopy(page),
                "nextPageCursor": f"c{offset + len(page)}" if more else "",
            },
            "time": 1700000002000,
        }

    async def ccxt_entry(self, params: dict[str, Any]) -> dict[str, Any]:
        return self._answer("ccxt", params)

    async def raw_entry(self, params: dict[str, Any]) -> dict[str, Any]:
        return self._answer("raw", params)


def install_position_book(
    exchange: Any, rows: Iterable[dict[str, Any]], *, refuse: frozenset[str] = frozenset()
) -> BybitPositionBook:
    """Wire a book into BOTH names a read can use: ``privateGetV5PositionList`` (ccxt's
    ``fetch_positions``) and ``private_get_v5_position_list`` (the raw fallback)."""
    book = BybitPositionBook(rows, refuse=refuse)
    exchange.privateGetV5PositionList = AsyncMock(side_effect=book.ccxt_entry)
    exchange.private_get_v5_position_list = AsyncMock(side_effect=book.raw_entry)
    return book
