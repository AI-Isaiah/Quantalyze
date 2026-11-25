"""A real ccxt Binance instance on recorded markets, and a fake that answers like the venue.

A helper module, never collected as tests (no ``test_`` functions). Phase 250
BINANCEFILLS plan 01. WHY it exists: a mock ``fetch_my_trades`` skips exactly the layers
where the Binance fills defects live: ccxt's ``market()`` symbol routing (a raw ``BTCUSDT``
routes to SPOT), its ``until`` handling, its IMPLICIT 7-day ``endTime`` cap on a since-only
linear request (R2-02: a cursor older than 7 days reads one window and the cursor then
stamps a stale fill) and ``parse_trades``' filtering. So this module replaces ccxt's
HTTP-method layer only. ``fapiPrivateGetUserTrades``, ``dapiPrivateGetUserTrades`` and
``privateGetMyTrades`` become the three endpoints of ``BinanceFillsVenue``, and ccxt's own
``fetch_my_trades`` runs unchanged on top. The instance's low-level ``fetch`` raises, so a
call that is none of those three fails loudly instead of reaching the network.

``BinanceFillsVenue`` models the VENUE, never ccxt's convenience. A fake that served every
row after ``startTime`` would go GREEN on today's code and is forbidden (CONTEXT [Tests]).

DOCUMENTED venue rules (RESEARCH Q1; developers.binance.com USD-M and COIN-M "Account
Trade List", and the spot ``GET /api/v3/myTrades`` section of binance-spot-api-docs
rest-api.md):
  - ``startTime`` and ``endTime`` both absent: the last 7 days (spot: the page gives a
    24 hour window rule only; the fake serves the last window).
  - "The time between ``startTime`` and ``endTime`` cannot be longer than 7 days"
    (spot: 24 hours). The fake raises ``ccxt.BadRequest``; the exception class is the
    fake's choice.
  - ``limit`` default 500, maximum 1000.
  - "Only support querying trade in the past 3 months" (futures).
UNMEASURED (the docs are silent and no signed call was possible; each is an assumption
the fake makes, switchable where it matters):
  - result order (the fake serves oldest first);
  - what the venue does with a ``startTime`` older than three months: ``out_of_reach``
    ``"raise"`` (default, deliberately strict) or ``"empty"``;
  - whether ``endTime`` is inclusive (the fake: inclusive, switch ``exclusive_end``);
  - what a ``startTime``-only request returns on COIN-M and on spot (assumption A4: one
    forward window of 7 days / 24 hours; linear never sees one from ccxt because ccxt adds
    an ``endTime`` once ``since`` is a week old);
  - the exact reach rule ("3 months": the fake uses ``reach_days`` = 89, the shortest
    three calendar months).
Later plans add switches to ``BinanceFillsVenue`` additively, default off, and never change
a default.

``suspend_per_request`` (Phase 250 plan 07): every real request is a network round trip, so it
suspends the calling task once. The default fake never suspends, and that changes the ORDER the
per-symbol tasks run in. Planning measurement (2026-11-25, Python 3.12.13, a scratch model of
this exact shape: N symbols gathered behind ``asyncio.Semaphore(5)`` that is held per request):
with a venue call that never suspends the tasks ran DEPTH-FIRST (8 and 50 symbols: the fewest
windows any symbol read was 0, the most 13); with one suspension per call they INTERLEAVED
(fewest 6, most 7). Only the ordering arm of ``tests/test_binancefills_e2e.py``
(``test_repeated_deadline_stops_advance_the_frontier_every_run``) builds the venue with the
switch on. Every other arm keeps the default and must not assume interleaving.

The markets cassette ``tests/cassettes/binance/markets.json`` holds twelve unified markets
recorded from a public ``load_markets()`` at ccxt 4.5.89 with no credentials (the file
carries its own ``recorded_at``, ``selection`` and ``source``). It holds no account data.
"""
from __future__ import annotations

import asyncio
import copy
import functools
import json
from collections.abc import Iterable, Mapping, Sequence
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import ccxt
import ccxt.async_support as ccxt_async

CASSETTE = Path(__file__).parent / "cassettes" / "binance" / "markets.json"

# The pinned clock, the same instant as tests/test_okxtrades_walk.py.
NOW_MS = 1795176000000  # 2026-11-20T12:00:00Z
HOUR_MS = 3_600_000
DAY_MS = 86_400_000
WEEK_MS = 7 * DAY_MS

_EXPECTED_SYMBOLS = {
    "BTC/USDT",
    "ETH/BTC",
    "BTC/USDC",
    "BTC/USDT:USDT",
    "ETH/USDT:USDT",
    "BTC/USDC:USDC",
    "BTC/USD:BTC",
}


@functools.lru_cache(maxsize=1)
def _cassette_markets() -> tuple[str, ...]:
    """The recorded markets, decoded once per session. Held as JSON text so a caller can
    never mutate the shared copy."""
    doc = json.loads(CASSETTE.read_text())
    markets = doc["markets"]
    symbols = {m["symbol"] for m in markets}
    assert len(markets) == 12, f"the cassette holds {len(markets)} markets, expected 12"
    assert _EXPECTED_SYMBOLS <= symbols, f"cassette lacks {_EXPECTED_SYMBOLS - symbols}"
    assert any(
        m["type"] == "future" and m["linear"] and m["base"] == "BTC" for m in markets
    ), "cassette lacks the BTC linear dated future"
    return tuple(json.dumps(m) for m in markets)


def recorded_markets() -> list[dict[str, Any]]:
    """A fresh deep copy of the twelve recorded unified markets (ccxt order)."""
    return [json.loads(m) for m in _cassette_markets()]


def venue_fill(
    kind: str,
    venue_id: str,
    fill_id: int,
    time_ms: int,
    *,
    side: str = "BUY",
    price: str = "50000.0",
    qty: str = "0.010",
    order_id: int | None = None,
) -> dict[str, Any]:
    """One RAW venue row, shaped like the spot or futures example in ccxt's
    ``binance.py`` (string numbers, ``time`` in ms). ``venue_id`` is the venue's market id
    (``BTCUSDT``, ``BTCUSD_PERP``). ``kind`` is ``linear``, ``inverse`` or ``spot``."""
    assert kind in ("linear", "inverse", "spot"), kind
    assert side in ("BUY", "SELL"), side
    quote_qty = f"{float(price) * float(qty):.5f}"
    order = order_id if order_id is not None else fill_id + 1_000_000
    if kind == "spot":
        return {
            "symbol": venue_id,
            "id": fill_id,
            "orderId": order,
            "price": price,
            "qty": qty,
            "quoteQty": quote_qty,
            "commission": "0.00001000",
            "commissionAsset": "BNB",
            "time": time_ms,
            "isBuyer": side == "BUY",
            "isMaker": False,
            "isBestMatch": True,
        }
    return {
        "symbol": venue_id,
        "id": fill_id,
        "orderId": order,
        "side": side,
        "price": price,
        "qty": qty,
        "quoteQty": quote_qty,
        "realizedPnl": "0.00000000",
        "commission": "0.01000000",
        "commissionAsset": "USDT" if kind == "linear" else "BTC",
        "time": time_ms,
        "buyer": side == "BUY",
        "maker": False,
        "positionSide": "BOTH",
    }


class BinanceFillsVenue:
    """The three Binance fills endpoints, answering by the venue's rules.

    ``rows`` maps ``(kind, venue_id)`` to RAW venue rows (see ``venue_fill``); ``kind`` is
    ``linear`` (``/fapi/v1/userTrades``), ``inverse`` (``/dapi/v1/userTrades``) or ``spot``
    (``/api/v3/myTrades``). ``calls`` records ``(kind, dict(request))`` for every request,
    the request exactly as ccxt sent it.

    Switches (keyword-only, defaults are the strict reading):
    - ``reach_days``: a ``startTime`` older than ``now - reach_days`` is out of reach.
    - ``out_of_reach``: ``"raise"`` (``ccxt.BadRequest``) or ``"empty"`` (``[]``).
    - ``exclusive_end``: ``endTime`` excluded from the window (default inclusive).
    - ``ignore_end_for``: venue ids that are served ``[startTime, now]`` regardless of
      ``endTime`` and the window rule (a venue that ignores ``endTime``).
    - ``effects``: a mutable dict from venue id to an exception raised on EVERY request for
      that id (set and cleared by a test between runs); Phase 250 plan 05.
    - ``suspend_per_request``: each endpoint appends the call to ``calls`` and then awaits
      ``asyncio.sleep(0)`` once before answering (or raising), the suspension every real request
      has; Phase 250 plan 07. Default off.
    """

    def __init__(
        self,
        rows: Mapping[tuple[str, str], Iterable[dict[str, Any]]] | None = None,
        *,
        now_ms: int = NOW_MS,
        reach_days: int = 89,
        out_of_reach: str = "raise",
        exclusive_end: bool = False,
        ignore_end_for: frozenset[str] = frozenset(),
        suspend_per_request: bool = False,
    ) -> None:
        assert out_of_reach in ("raise", "empty"), out_of_reach
        self._rows: dict[tuple[str, str], list[dict[str, Any]]] = {}
        for key, items in (rows or {}).items():
            assert key[0] in ("linear", "inverse", "spot"), key
            self._rows[key] = [copy.deepcopy(r) for r in items]
        self.now_ms = now_ms
        self.reach_days = reach_days
        self.out_of_reach = out_of_reach
        self.exclusive_end = exclusive_end
        self.ignore_end_for = ignore_end_for
        self.suspend_per_request = suspend_per_request
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.effects: dict[str, BaseException] = {}

    def calls_for(self, kind: str) -> list[dict[str, Any]]:
        """The requests the ``kind`` endpoint received, oldest first."""
        return [req for k, req in self.calls if k == kind]

    async def fapi(self, request: dict[str, Any]) -> list[dict[str, Any]]:
        return await self._answer("linear", request)

    async def dapi(self, request: dict[str, Any]) -> list[dict[str, Any]]:
        return await self._answer("inverse", request)

    async def spot(self, request: dict[str, Any]) -> list[dict[str, Any]]:
        return await self._answer("spot", request)

    async def _answer(self, kind: str, request: dict[str, Any]) -> list[dict[str, Any]]:
        if not self.suspend_per_request:
            return self._serve(kind, request)
        # Record first, suspend once, then answer: the call is in the log before any other
        # task can run, exactly as a request that has been sent and not yet answered.
        self.calls.append((kind, dict(request)))
        await asyncio.sleep(0)
        return self._serve(kind, request, record=False)

    def _serve(
        self, kind: str, request: dict[str, Any], *, record: bool = True
    ) -> list[dict[str, Any]]:
        if record:
            self.calls.append((kind, dict(request)))
        venue_id = request["symbol"]
        if venue_id in self.effects:
            raise self.effects[venue_id]
        window = DAY_MS if kind == "spot" else WEEK_MS
        start = request.get("startTime")
        end = request.get("endTime")
        limit = min(int(request.get("limit") or 500), 1000)

        if start is not None and start < self.now_ms - self.reach_days * DAY_MS:
            if self.out_of_reach == "raise":
                raise ccxt.BadRequest(
                    f"binance {kind}: startTime {start} is older than the reach "
                    f"of {self.reach_days} days"
                )
            return []

        if venue_id in self.ignore_end_for:
            lo = start if start is not None else self.now_ms - window
            hi = self.now_ms
            inclusive_end = True
        else:
            inclusive_end = not self.exclusive_end
            if start is None and end is None:
                lo, hi = self.now_ms - window, self.now_ms
            elif start is not None and end is not None:
                if end - start > window:
                    raise ccxt.BadRequest(
                        f"binance {kind}: the time between startTime and endTime "
                        f"cannot be longer than {window} ms (got {end - start})"
                    )
                lo, hi = start, end
            elif start is not None:
                lo, hi = start, min(start + window, self.now_ms)
            else:
                assert end is not None
                lo, hi = end - window, end

        picked = [
            r
            for r in self._rows.get((kind, venue_id), [])
            if lo <= r["time"] and (r["time"] <= hi if inclusive_end else r["time"] < hi)
        ]
        picked.sort(key=lambda r: (r["time"], int(r["id"])))
        return [copy.deepcopy(r) for r in picked[:limit]]


async def real_binance(
    venue: BinanceFillsVenue,
    *,
    now_ms: int = NOW_MS,
    markets_loaded: bool = True,
    market_order: Sequence[str] | None = None,
) -> Any:
    """A real ``ccxt.async_support.binance`` on the recorded markets whose three fills
    endpoints are the venue's. ``await`` it; ``await ex.close()`` after use.

    By default ``load_markets()`` is awaited once here (no network: the markets are already
    set). Measured in ccxt 4.5.89 ``async_support/base/exchange.py``: the first
    ``load_markets()`` on an instance wraps its loader in a new Task and awaits it, a
    hidden suspension that would let another symbol's task run between a deadline check
    and its request. After the pre-warm the request path suspends only where the venue
    fake says so.

    Additive switches (Phase 250 plan 05, defaults keep every earlier arm unchanged):
    - ``markets_loaded=False``: the instance is returned as ``create_exchange`` returns it, with
      ``markets`` None, so the REAL ``load_markets()`` runs lazily. Its ``fetch_markets`` is
      replaced by a coroutine returning the recorded list and ``fetch_currencies`` by one
      returning an empty dict (the real one needs credentials), so it still never touches the
      network and no suspension is added beyond ccxt's own.
    - ``market_order`` (with ``markets_loaded=True``): unified symbols (``BTC/USDT:USDT``) that
      come FIRST, in the order given, in the iteration order of ``ex.markets``; the rest follow in
      the order ccxt left them. ccxt's own ``set_markets`` key-sorts ``markets`` by symbol, so a
      spot market (``BTC/USDT``) always precedes the swap sharing its stripped name
      (``BTC/USDT:USDT``) and a last-write-wins map is right by iteration order alone; this
      switch re-indexes ``ex.markets`` AFTER ``set_markets`` to put the spot market last, the
      order the precedence rule must survive.
    """
    ex = ccxt_async.binance({"enableRateLimit": False})
    markets = recorded_markets()
    ex.milliseconds = lambda: now_ms
    ex.fetch = AsyncMock(side_effect=AssertionError("a test reached the network through ccxt"))
    ex.fapiPrivateGetUserTrades = AsyncMock(side_effect=venue.fapi)
    ex.dapiPrivateGetUserTrades = AsyncMock(side_effect=venue.dapi)
    ex.privateGetMyTrades = AsyncMock(side_effect=venue.spot)
    if markets_loaded:
        ex.set_markets(markets)
        await ex.load_markets()
        if market_order:
            assert set(market_order) <= set(ex.markets), set(market_order) - set(ex.markets)
            first = list(market_order)
            ordered = first + [sym for sym in ex.markets if sym not in first]
            ex.markets = {sym: ex.markets[sym] for sym in ordered}
    else:
        ex.fetch_markets = AsyncMock(return_value=markets)
        ex.fetch_currencies = AsyncMock(return_value={})
    return ex


def symbols_supabase(
    trade_symbols: Iterable[str], position_symbols: Iterable[str] = ()
) -> MagicMock:
    """A client whose ``trades`` and ``position_snapshots`` select chains drain through
    ``paginated_select`` and answer ``{"symbol": ...}`` rows. The ``range(start, end)``
    window is honoured, so a second drain answers the same rows."""

    def _chain(rows: list[dict[str, Any]]) -> MagicMock:
        def _range(start: int, end: int) -> MagicMock:
            sliced = MagicMock()
            sliced.execute.return_value = MagicMock(data=rows[start : end + 1])
            return sliced

        order = MagicMock()
        order.range.side_effect = _range
        order.order.return_value = order
        return order

    trade_rows = [{"symbol": s} for s in trade_symbols]
    position_rows = [{"symbol": s} for s in position_symbols]

    def _table(name: str) -> MagicMock:
        table = MagicMock()
        select = MagicMock()
        if name == "trades":
            eq1 = MagicMock()
            eq2 = MagicMock()
            eq2.order.return_value = _chain(trade_rows)
            eq1.eq.return_value = eq2
            select.eq.return_value = eq1
        else:
            eq1 = MagicMock()
            eq1.order.return_value = _chain(position_rows)
            select.eq.return_value = eq1
        table.select.return_value = select
        return table

    supabase = MagicMock()
    supabase.table.side_effect = _table
    return supabase
