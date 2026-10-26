"""Venue-faithful trade fakes for the allocator history rebuild's trade read.

A helper module, never collected as tests (no ``test_`` functions). Phase
167.2.1.1.2.1 TRADEPAGES: the rebuild's trade loop used to stop on a page shorter
than its request, which is wrong on every venue whose page cap sits below the
request. These fakes answer the way the venue does, so a loop that mis-stops
reads fewer trades than the book holds and a test sees it.

Venue rules mirrored (vendor docs and ccxt 4.5.88, see the phase RESEARCH Q2):

- bybit: ``GET /v5/execution/list``. A request carrying only a start answers
  start to start plus 7 days; with both, end minus start must be at most 7 days.
  Rows come newest first, at most 100 per page, paged with a cursor; ccxt then
  re-sorts the page ascending, so ``nextPageCursor`` lands in the ``info`` of the
  NEWEST row of the page.
- okx: ``GET /api/v5/trade/fills-history``, one instrument type per request, the
  newest 100 fills of ``[begin, end]``, ``limit`` ignored when a start is set. Whether
  ``end`` is inclusive is not documented, so both readings are available
  (``end_exclusive``) and the walk must be right under either.
  Bybit also rejects a request whose start is older than two years (retCode 10001,
  which ccxt raises as ``BadRequest``); ``VenueTradeBook(two_year_limit_now=...)``
  mirrors that, measured against a caller-supplied clock.
- any other venue: the rows at or after ``since``, ascending.
"""
from __future__ import annotations

import copy
import inspect
from collections.abc import Callable
from typing import Any
from unittest.mock import AsyncMock

import ccxt.async_support as ccxt

DAY_MS = 24 * 60 * 60 * 1000
BYBIT_WINDOW_MS = 7 * DAY_MS
BYBIT_PAGE_CAP = 100
BYBIT_TWO_YEAR_MS = 730 * DAY_MS
OKX_PAGE_CAP = 100
OTHER_PAGE_CAP = 1000


def trade_rows(
    count: int,
    first_ms: int,
    step_ms: int,
    *,
    symbol: str = "BTC/USDT",
    inst_type: str | None = None,
    id_prefix: str = "t",
) -> list[dict[str, Any]]:
    """``count`` ccxt-shaped buy trades from ``first_ms`` every ``step_ms``.

    Each carries a unique synthetic ``id`` and an ``info`` dict (with ``instType``
    when given), as real ccxt okx and bybit trades do.
    """
    rows: list[dict[str, Any]] = []
    for i in range(count):
        info: dict[str, Any] = {}
        if inst_type is not None:
            info["instType"] = inst_type
        rows.append(
            {
                "id": f"{id_prefix}{i:05d}",
                "timestamp": first_ms + i * step_ms,
                "symbol": symbol,
                "side": "buy",
                "price": 50000.0,
                "amount": 0.001,
                "cost": 50.0,
                "fee": {"cost": 0.0, "currency": "USDT"},
                "info": info,
            }
        )
    return rows


def _order_key(trade: dict[str, Any]) -> tuple[int, str]:
    return (int(trade["timestamp"]), str(trade["id"]))


def _okx_pass_of(trade: dict[str, Any]) -> str:
    """The instrument type an OKX trade is served under: its ``info.instType``,
    else swap for a symbol with a ``:`` settle suffix, else spot."""
    inst = (trade.get("info") or {}).get("instType")
    if inst:
        return str(inst).lower()
    return "swap" if ":" in str(trade.get("symbol") or "") else "spot"


def _within_okx_end(timestamp: int, end: int, exclusive: bool) -> bool:
    return timestamp < end if exclusive else timestamp <= end


def okx_select(
    trades: list[dict[str, Any]],
    *,
    inst_type: str,
    begin: int,
    end: int | None,
    end_exclusive: bool,
    size: int,
) -> list[dict[str, Any]]:
    """OKX's fills-history rule: the NEWEST ``size`` fills of one instrument type in
    ``[begin, end]`` (``end`` inclusive, or exclusive when ``end_exclusive``), newest first."""
    inside = sorted(
        (
            t
            for t in trades
            if _okx_pass_of(t) == inst_type.lower()
            and int(t["timestamp"]) >= begin
            and (end is None or _within_okx_end(int(t["timestamp"]), int(end), end_exclusive))
        ),
        key=_order_key,
        reverse=True,
    )
    return inside[:size]


def bybit_select(
    trades: list[dict[str, Any]],
    *,
    start: int,
    end: int | None,
    cursor: str | None,
    size: int,
) -> tuple[list[dict[str, Any]], str | None]:
    """Bybit's execution-list rule: the rows in ``[start, end]`` (a missing end means
    start plus 7 days; a range over 7 days is a ``BadRequest``), newest first, ``size``
    rows from the cursor's offset. Returns the page and the next cursor, None when no
    row remains."""
    end = start + BYBIT_WINDOW_MS if end is None else int(end)
    if end - start > BYBIT_WINDOW_MS:
        raise ccxt.BadRequest("bybit: endTime - startTime must be at most 7 days")
    inside = sorted(
        (t for t in trades if start <= int(t["timestamp"]) <= end),
        key=_order_key,
        reverse=True,
    )
    offset = int(str(cursor)[1:]) if cursor else 0
    chunk = inside[offset : offset + size]
    return chunk, (f"c{offset + size}" if offset + size < len(inside) else None)


class VenueTradeBook:
    """An async callable ``(symbol, since, limit, params)`` over an in-memory trade
    list, for ``AsyncMock(side_effect=...)``.

    ``exchange.id`` is read AT CALL TIME, so a test that sets the id after building
    the exchange still gets that venue's rules. ``page_cap`` overrides the venue's
    cap. ``end_exclusive`` makes OKX's ``until`` an exclusive bound (inclusive by
    default). ``two_year_limit_now`` (a zero-argument callable returning the current UTC
    instant in ms; off by default) makes a Bybit request whose start is older than that
    instant minus 730 days raise ``ccxt.BadRequest``, as Bybit's retCode 10001 does; the
    request is not recorded on ``.calls`` (the venue answered with an error, no rows).
    Every call is recorded on ``.calls`` as ``{"since", "limit", "params",
    "rows"}`` (``params`` is a copy; ``rows`` is how many rows were returned).
    """

    def __init__(
        self,
        exchange: Any,
        trades: list[dict[str, Any]],
        *,
        page_cap: int | None = None,
        end_exclusive: bool = False,
        two_year_limit_now: Callable[[], float] | None = None,
    ) -> None:
        # AsyncMock only awaits an async side effect it can recognise as one, and an
        # instance with an async ``__call__`` is not recognised without the mark.
        inspect.markcoroutinefunction(self)
        self._exchange = exchange
        self._page_cap = page_cap
        self._end_exclusive = end_exclusive
        self._two_year_limit_now = two_year_limit_now
        self.trades: list[dict[str, Any]] = []
        for index, trade in enumerate(trades):
            owned = copy.deepcopy(trade)
            if owned.get("id") is None:
                owned["id"] = f"book{index:05d}"
            if not isinstance(owned.get("info"), dict):
                owned["info"] = {}
            self.trades.append(owned)
        self.calls: list[dict[str, Any]] = []

    async def __call__(
        self,
        symbol: Any = None,
        since: int | None = None,
        limit: int | None = None,
        params: dict[str, Any] | None = None,
    ) -> list[dict[str, Any]]:
        params = dict(params or {})
        venue = str(getattr(self._exchange, "id", "")).lower()
        if venue == "bybit":
            page = self._bybit(since, limit, params)
        elif venue == "okx":
            page = self._okx(since, params)
        else:
            page = self._other(since, limit)
        self.calls.append(
            {"since": since, "limit": limit, "params": copy.deepcopy(params), "rows": len(page)}
        )
        return page

    def _cap(self, venue_cap: int, limit: int | None) -> int:
        cap = self._page_cap if self._page_cap is not None else venue_cap
        return min(int(limit), cap) if limit else cap

    def _bybit(
        self, since: int | None, limit: int | None, params: dict[str, Any]
    ) -> list[dict[str, Any]]:
        if (
            self._two_year_limit_now is not None
            and since is not None
            and int(since) < self._two_year_limit_now() - BYBIT_TWO_YEAR_MS
        ):
            raise ccxt.BadRequest("bybit retCode 10001: fixture start older than two years")
        chunk, next_cursor = bybit_select(
            self.trades,
            start=int(since) if since is not None else 0,
            end=params.get("until"),
            cursor=params.get("cursor"),
            size=self._cap(BYBIT_PAGE_CAP, limit),
        )
        page = sorted((copy.deepcopy(t) for t in chunk), key=_order_key)
        if page and next_cursor:
            page[-1]["info"]["nextPageCursor"] = next_cursor
        return page

    def _okx(self, since: int | None, params: dict[str, Any]) -> list[dict[str, Any]]:
        cap = self._page_cap if self._page_cap is not None else OKX_PAGE_CAP
        chunk = okx_select(
            self.trades,
            inst_type=str(params.get("type") or "spot"),
            begin=int(since) if since is not None else 0,
            end=params.get("until"),
            end_exclusive=self._end_exclusive,
            size=cap,
        )
        return sorted((copy.deepcopy(t) for t in chunk), key=_order_key)

    def _other(self, since: int | None, limit: int | None) -> list[dict[str, Any]]:
        begin = int(since) if since is not None else 0
        inside = sorted(
            (t for t in self.trades if int(t["timestamp"]) >= begin), key=_order_key
        )
        return [copy.deepcopy(t) for t in inside[: self._cap(OTHER_PAGE_CAP, limit)]]


def _raw_bybit_execution(trade: dict[str, Any]) -> dict[str, Any]:
    """One row of Bybit's raw ``/v5/execution/list`` answer, the shape ccxt's own
    ``parse_trade`` turns into a trade."""
    return {
        "symbol": str(trade["symbol"]).split(":")[0].replace("/", ""),
        "side": "Buy" if trade.get("side") != "sell" else "Sell",
        "execId": str(trade["id"]),
        "execPrice": str(trade.get("price", 50000.0)),
        "execQty": str(trade.get("amount", 0.001)),
        "execValue": str(trade.get("cost", 50.0)),
        "execFee": "0",
        "execType": "Trade",
        "execTime": str(int(trade["timestamp"])),
    }


def _raw_okx_fill(trade: dict[str, Any]) -> dict[str, Any]:
    """One row of OKX's raw ``/api/v5/trade/fills-history`` answer, the shape ccxt's own
    ``parse_trade`` turns into a trade."""
    inst_type = _okx_pass_of(trade).upper()
    base_quote = str(trade["symbol"]).split(":")[0].replace("/", "-")
    inst_id = base_quote if inst_type == "SPOT" else f"{base_quote}-{inst_type}"
    return {
        "instType": inst_type,
        "instId": inst_id,
        "tradeId": str(trade["id"]),
        "billId": f"bill-{trade['id']}",
        "side": "buy" if trade.get("side") != "sell" else "sell",
        "fillPx": str(trade.get("price", 50000.0)),
        "fillSz": str(trade.get("amount", 0.001)),
        "fee": "0",
        "feeCcy": "USDT",
        "execType": "T",
        "ts": str(int(trade["timestamp"])),
    }


def real_ccxt_client(
    venue: str,
    trades: list[dict[str, Any]],
    *,
    page_cap: int | None = None,
    end_exclusive: bool = False,
) -> Any:
    """A credential-free REAL ``ccxt.async_support`` client whose raw private endpoint
    is stubbed (no network), so ccxt's own request building and trade parsing run.

    bybit: ``since`` to ``startTime``, ``params["until"]`` to ``endTime``, ``cursor``
    passed through; the stub applies Bybit's rules to the RAW request dict
    (``startTime``, ``endTime``, ``limit``, ``cursor``).

    okx: ``since`` to ``begin``, ``params["until"]`` to ``end``, ``params["type"]`` to
    ``instType``; the stub applies OKX's rules to the RAW request (``begin``, ``end``,
    ``instType``): the newest 100 fills of that type in ``[begin, end]``, ``end``
    inclusive unless ``end_exclusive``, ``limit`` ignored.

    Every raw request is recorded on ``.raw_requests``. The caller closes the client
    (``await client.close()``).
    """
    if venue not in ("bybit", "okx"):
        raise ValueError(f"no real ccxt stub for venue {venue!r}")
    book = [copy.deepcopy(t) for t in trades]
    for index, trade in enumerate(book):
        if trade.get("id") is None:
            trade["id"] = f"book{index:05d}"
    client = ccxt.bybit({}) if venue == "bybit" else ccxt.okx({})
    client.markets = {}
    client.load_markets = AsyncMock(return_value={})
    client.rateLimit = 0
    client.raw_requests = []

    async def _execution_list(request: dict[str, Any]) -> dict[str, Any]:
        client.raw_requests.append(dict(request))
        cap = page_cap if page_cap is not None else BYBIT_PAGE_CAP
        chunk, next_cursor = bybit_select(
            book,
            start=int(request["startTime"]) if "startTime" in request else 0,
            end=request.get("endTime"),
            cursor=request.get("cursor"),
            size=min(int(request.get("limit", 50)), cap),
        )
        return {
            "retCode": 0,
            "result": {
                "category": "linear",
                "nextPageCursor": next_cursor or "",
                "list": [_raw_bybit_execution(t) for t in chunk],
            },
        }

    async def _fills_history(request: dict[str, Any]) -> dict[str, Any]:
        client.raw_requests.append(dict(request))
        cap = page_cap if page_cap is not None else OKX_PAGE_CAP
        chunk = okx_select(
            book,
            inst_type=str(request.get("instType") or "SPOT"),
            begin=int(request["begin"]) if "begin" in request else 0,
            end=int(request["end"]) if "end" in request else None,
            end_exclusive=end_exclusive,
            size=cap,
        )
        return {"code": "0", "msg": "", "data": [_raw_okx_fill(t) for t in chunk]}

    if venue == "bybit":
        client.privateGetV5ExecutionList = _execution_list
    else:
        client.privateGetTradeFillsHistory = _fills_history
    return client
