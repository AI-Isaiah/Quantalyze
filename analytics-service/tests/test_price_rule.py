"""Phase 167.2.1.1.1.1 (MARKSOURCE) plan 01, SC-1: one stated price rule, one test per path.

The rule is the docstring of ``services/price_rule.py`` (D-02, N = 7 from D-04). This module
pins every path it governs. Every oracle below is a hand-typed number sitting beside the
arithmetic it comes from, never a value read back from the code under test:

* a deposited quantity times a typed close;
* an age counted on the calendar by hand (``03-01`` to ``03-04`` is age 3).

Paths (RESEARCH "The path inventory"): 1 history spot, 2 history perp, 3 CoinGecko fallback,
4 ccxt flow valuer, 6 derivative rows, 7 Deribit inverse, 9 anchor, 10 marks, 11 holding marks,
12 native balance.
"""

from __future__ import annotations

import math
from datetime import date, datetime, timedelta, timezone
from typing import Any

import pytest

from services.price_rule import (
    close_on_or_before,
    is_stable_value,
    usable_price,
)


def _ms(iso: str, hours: float = 0.0) -> int:
    """Epoch milliseconds of ``iso`` 00:00 UTC plus ``hours``."""
    d = date.fromisoformat(iso)
    base = datetime(d.year, d.month, d.day, tzinfo=timezone.utc)
    return int((base + timedelta(hours=hours)).timestamp() * 1000)


# ---------------------------------------------------------------------------
# Coupling, helpers (Task 1)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "value, expected",
    [
        (100.0, 100.0),
        (3, 3.0),
        (0.0, None),
        (-5.0, None),
        (float("nan"), None),
        (float("inf"), None),
        (None, None),
        (True, None),  # bool is an int subclass: a stored True is not a price
        ("100", None),  # a numeric string is NOT usable
    ],
)
def test_usable_price_is_finite_positive_and_not_a_bool(value: object, expected: float | None) -> None:
    assert usable_price(value) == expected


def test_is_stable_value_covers_stablecoins_and_the_split_suffixes() -> None:
    for asset in ("USDT", "usdc", "USDE", "pyusd", "USDB"):
        assert is_stable_value(asset) is True
    for asset in ("BTC", "ETH", "PYUSDETH", ""):
        assert is_stable_value(asset) is False


def test_close_on_or_before_returns_close_and_age_or_none() -> None:
    days = ["2026-03-01", "2026-03-03"]
    closes = [100.0, 120.0]
    assert close_on_or_before(days, closes, "2026-03-03") == (120.0, 0)
    assert close_on_or_before(days, closes, "2026-03-02") == (100.0, 1)
    assert close_on_or_before(days, closes, "2026-03-10") == (120.0, 7)
    assert close_on_or_before(days, closes, "2026-03-11") is None  # age 8
    assert close_on_or_before(days, closes, "2026-02-28") is None  # nothing on or before
    assert close_on_or_before([], [], "2026-03-01") is None
    # max_gap_days is honoured (N = 0 is the BRIDGERETURNS shape: exact day only)
    assert close_on_or_before(days, closes, "2026-03-02", max_gap_days=0) is None
    assert not math.isnan(close_on_or_before(days, closes, "2026-03-03", max_gap_days=0)[0])  # type: ignore[index]


# ---------------------------------------------------------------------------
# Rows 3-4 - the CoinGecko fallback reads closes, not opens (Task 2)
# ---------------------------------------------------------------------------


class _CoingeckoResponse:
    def __init__(self, body: dict[str, Any]) -> None:
        self._body = body
        self.status_code = 200

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict[str, Any]:
        return self._body


def _coingecko_client(body: dict[str, Any]) -> type:
    """An ``httpx.AsyncClient`` stand-in that answers ``market_chart/range`` with ``body``."""

    class _Client:
        def __init__(self, *_a: Any, **_k: Any) -> None:
            return None

        async def __aenter__(self) -> "_Client":
            return self

        async def __aexit__(self, *_a: Any) -> None:
            return None

        async def get(self, _url: str, params: dict[str, Any] | None = None) -> _CoingeckoResponse:
            return _CoingeckoResponse(body)

    return _Client


@pytest.mark.asyncio
async def test_price_rule_coingecko_close_semantics(monkeypatch: pytest.MonkeyPatch) -> None:
    """CoinGecko stamps a point at 00:00 UTC with the price AT THAT INSTANT, so the first point
    stamped on D+1 is the close of D (the rule ``services.benchmark._fetch_from_coingecko``
    applies, measured 2026-10-09: same-date pairing off by up to 2.6 percent, shifted about
    0.05 percent). Hand-typed: stamps 03-01 / 03-02 / 03-03 carry 100 / 110 / 120."""
    from services import equity_reconstruction as er

    monkeypatch.setattr(er, "COINGECKO_MIN_SLEEP_SECS", 0)
    start = int(_ms("2026-03-01") // 1000)
    end = int(_ms("2026-03-02") // 1000) + 86400

    # Daily points.
    monkeypatch.setattr(er.httpx, "AsyncClient", _coingecko_client({"prices": [
        [_ms("2026-03-01"), 100.0], [_ms("2026-03-02"), 110.0], [_ms("2026-03-03"), 120.0],
    ]}))
    out = await er._fetch_coingecko_daily_closes("BTC", start, end)
    # close(03-01) = the 03-02 stamp, close(03-02) = the 03-03 stamp. The 03-01 stamp is the
    # close of 02-28, a day nobody asked for. 03-03's own close is not published yet.
    assert out == [("2026-03-01", 110.0), ("2026-03-02", 120.0)]

    # Hourly points: the FIRST point stamped on 03-02 is the close of 03-01; later ones are ignored.
    monkeypatch.setattr(er.httpx, "AsyncClient", _coingecko_client({"prices": [
        [_ms("2026-03-01"), 100.0],
        [_ms("2026-03-01", 12), 105.0],
        [_ms("2026-03-02", 4 / 60), 111.0],
        [_ms("2026-03-02", 9), 130.0],
    ]}))
    out = await er._fetch_coingecko_daily_closes("BTC", start, end)
    assert out == [("2026-03-01", 111.0)]

    # Review SF-M7: the endpoint's final point is a live intraday price (here 03-03 14:00 is the
    # only point stamped 03-03). It is not the 03-02 close, and it is not cached as one; the
    # same repo already drops it in ``services.benchmark._fetch_from_coingecko``.
    monkeypatch.setattr(er.httpx, "AsyncClient", _coingecko_client({"prices": [
        [_ms("2026-03-01"), 100.0], [_ms("2026-03-02"), 110.0], [_ms("2026-03-03", 14), 130.0],
    ]}))
    out = await er._fetch_coingecko_daily_closes("BTC", start, end)
    assert out == [("2026-03-01", 110.0)]

    # A close that is zero, negative, NaN or infinite is a gap, never a price. The first point
    # of D+1 is THE close of D: if it is unusable the day is a gap, and a later hourly point of
    # the same date does not stand in for it.
    monkeypatch.setattr(er.httpx, "AsyncClient", _coingecko_client({"prices": [
        [_ms("2026-03-02"), 0.0],            # close(03-01): zero
        [_ms("2026-03-02", 3), 99.0],        # later hourly point: NOT the close
        [_ms("2026-03-03"), -5.0],           # close(03-02): negative
        [_ms("2026-03-04"), float("nan")],   # close(03-03): not finite
        [_ms("2026-03-05"), float("inf")],   # close(03-04): not finite
        [_ms("2026-03-06"), 150.0],          # close(03-05): usable
    ]}))
    out = await er._fetch_coingecko_daily_closes("BTC", start, _ms("2026-03-06") // 1000)
    assert out == [("2026-03-05", 150.0)]


class _RecordingTable:
    def __init__(self, owner: "_RecordingSupabase") -> None:
        self._owner = owner
        self._filters: list[tuple[str, Any]] = []

    def upsert(self, rows: list[dict[str, Any]], **kwargs: Any) -> "_RecordingTable":
        self._owner.upserts.append({"rows": rows, **kwargs})
        return self

    def select(self, *_a: Any, **_k: Any) -> "_RecordingTable":
        return self

    def eq(self, col: str, val: Any) -> "_RecordingTable":
        self._filters.append((col, val))
        return self

    def gte(self, *_a: Any, **_k: Any) -> "_RecordingTable":
        return self

    def lte(self, *_a: Any, **_k: Any) -> "_RecordingTable":
        return self

    def execute(self) -> Any:
        class _Res:
            data: list[dict[str, Any]] = []

        res = _Res()
        res.data = [
            r for r in self._owner.stored
            if all(r.get(col) == val for col, val in self._filters)
        ]
        return res


class _RecordingSupabase:
    def __init__(self, stored: list[dict[str, Any]] | None = None) -> None:
        self.stored = stored or []
        self.upserts: list[dict[str, Any]] = []

    def table(self, _name: str) -> _RecordingTable:
        return _RecordingTable(self)


@pytest.mark.asyncio
async def test_price_rule_coingecko_cache_not_stale() -> None:
    """Pitfall 2: with ``ignore_duplicates=True`` the corrected close-labelled prices would be
    inserted DO NOTHING while the old open-labelled rows for the same (symbol, asof) survived.
    The cache writes the close tag with an UPDATING upsert and reads only that tag."""
    from services.equity_reconstruction import _cache_coingecko_prices, _read_cached_prices

    supabase = _RecordingSupabase(stored=[
        {"symbol": "PEPE", "asof": "2026-06-01", "price_usd": 0.0003, "source": "coingecko"},
        {"symbol": "PEPE", "asof": "2026-06-02", "price_usd": 0.0009, "source": "coingecko_close"},
    ])
    await _cache_coingecko_prices(supabase, "PEPE", [("2026-06-01", 0.0009)])
    assert len(supabase.upserts) == 1
    upsert = supabase.upserts[0]
    assert {row["source"] for row in upsert["rows"]} == {"coingecko_close"}
    assert upsert["on_conflict"] == "symbol,asof"
    # An updating upsert: the do-nothing-on-conflict option is absent or false.
    assert not upsert.get("ignore_duplicates", False)

    # The old open-labelled row for 06-01 is never read; the close-labelled one for 06-02 is.
    cached = await _read_cached_prices(supabase, "PEPE", "2026-06-01", "2026-06-02")
    assert cached == {"2026-06-02": 0.0009}


@pytest.mark.asyncio
async def test_price_rule_flow_price_index_uses_the_close(monkeypatch: pytest.MonkeyPatch) -> None:
    """Row 4: the ccxt flow valuer inherits the corrected close through
    ``_resolve_ccxt_flow_price_index``. A PEPE deposit on 06-01, the primary venue does not
    list it, the cache is empty, and the raw CoinGecko body has the 06-01 00:00 stamp at
    0.0003 and the 06-02 00:00 stamp at 0.0009: 06-01 is valued at its close, 0.0009."""
    import ccxt.async_support as ccxt

    from services import equity_reconstruction as er
    from services.job_worker import _resolve_ccxt_flow_price_index

    class _NoPepe:
        rateLimit = 0

        async def fetch_ohlcv(self, *_a: Any, **_k: Any) -> list[list[Any]]:
            raise ccxt.BadSymbol("not listed")

    monkeypatch.setattr(er, "COINGECKO_MIN_SLEEP_SECS", 0)
    monkeypatch.setattr(er.httpx, "AsyncClient", _coingecko_client({"prices": [
        [_ms("2026-06-01"), 0.0003], [_ms("2026-06-02"), 0.0009],
    ]}))
    index = await _resolve_ccxt_flow_price_index(
        _NoPepe(), "binance", _RecordingSupabase(),
        [{"currency": "PEPE", "timestamp": _ms("2026-06-01", 12)}],
    )
    assert index == {("2026-06-01", "PEPE"): 0.0009}


# ---------------------------------------------------------------------------
# Row 9 - the live anchor names an unpriced asset instead of counting it at $0 (Task 3)
# ---------------------------------------------------------------------------


class _TickerExchange:
    """Answers every ``fetch_ticker`` with the payload under test; counts the calls."""

    def __init__(self, payload: Any) -> None:
        self._payload = payload
        self.calls: list[str] = []

    async def fetch_ticker(self, symbol: str) -> Any:
        self.calls.append(symbol)
        return self._payload


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "payload",
    [
        {"last": None},
        {"last": 0},
        {"last": -3.0},
        {"last": float("nan")},
        {"last": float("inf")},
        {"last": True},
        {"last": "40000"},
        {},
        None,
        "not-a-dict",
    ],
    ids=["none", "zero", "negative", "nan", "inf", "bool", "string", "empty", "null", "non-dict"],
)
async def test_anchor_last_none_is_partial(payload: Any) -> None:
    """D-02 reverses NEW-C01-02's 'a genuine zero' premise: a ticker that ANSWERS without a
    usable last is a hole, not a measured $0. 2.0 BTC would have been worth 80000 at 40000;
    leaving it at $0 undercounted the wallet and let the anchor ship."""
    from services.equity_reconstruction import _price_wallet_totals

    total, partial = await _price_wallet_totals(
        _TickerExchange(payload), {"BTC": 2.0, "USDT": 1000.0},
    )
    assert total == 1000.0  # only the USDT; the BTC is a named gap, not a zero
    assert "BTC" in partial


@pytest.mark.asyncio
async def test_anchor_usable_last_prices_the_asset() -> None:
    from services.equity_reconstruction import _price_wallet_totals

    total, partial = await _price_wallet_totals(
        _TickerExchange({"last": 40000.0}), {"BTC": 2.0, "USDT": 1000.0},
    )
    # 2.0 x 40000.0 = 80000.0, plus 1000.0 of USDT.
    assert total == 81000.0
    assert set(partial) == set()


@pytest.mark.asyncio
async def test_anchor_stable_value_assets_are_one() -> None:
    """USDE / PYUSD are stable-value (not in STABLECOINS by design): 1.0 per unit, no ticker."""
    from services.equity_reconstruction import _price_wallet_totals

    exchange = _TickerExchange({"last": None})
    total, partial = await _price_wallet_totals(exchange, {"USDE": 50.0, "PYUSD": 25.0})
    assert total == 75.0
    assert set(partial) == set()
    assert exchange.calls == []


@pytest.mark.asyncio
async def test_anchor_a_raised_ticker_is_still_partial() -> None:
    """The pre-existing behaviour the new gap joins: a RAISED ticker read is named too."""
    from services.equity_reconstruction import _price_wallet_totals

    class _Raises:
        async def fetch_ticker(self, _symbol: str) -> Any:
            raise RuntimeError("venue down")

    total, partial = await _price_wallet_totals(_Raises(), {"BTC": 2.0, "USDT": 1000.0})
    assert total == 1000.0
    assert "BTC" in partial


@pytest.mark.asyncio
async def test_price_rule_bybit_uta_mark_refuses_an_unpriced_coin() -> None:
    """The Bybit mark read prices our own wallet through the same rule: a coin whose ticker
    answers without a usable last refuses ``wallet_unpriced`` rather than counting at $0
    (which, against the venue's 1600.4 wallet, used to surface as a misleading mismatch)."""
    from services.equity_reconstruction import _read_bybit_uta_mark

    class _Uta:
        async def fetch_balance(self) -> dict[str, Any]:
            return {
                "total": {"USDT": 1000.0, "BTC": 0.01},
                "info": {"retCode": 0, "result": {"list": [{
                    "totalWalletBalance": "1600.4",
                    "totalEquity": "1700.4",
                    "coin": [
                        {"coin": "USDT", "walletBalance": "1000", "borrowAmount": "0"},
                        {"coin": "BTC", "walletBalance": "0.01", "borrowAmount": "0"},
                    ],
                }]}},
            }

        async def privateGetV5AccountInfo(self) -> dict[str, Any]:  # noqa: N802 (ccxt's name)
            return {"result": {"unifiedMarginStatus": 5, "marginMode": "REGULAR_MARGIN"}}

        async def fetch_ticker(self, _symbol: str) -> dict[str, Any]:
            return {"last": None}

    assert await _read_bybit_uta_mark(_Uta()) == "wallet_unpriced"


# ---------------------------------------------------------------------------
# Rows 6, 7, 10, 11, 12 - paths that already conform: one pin each (Task 3)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_price_rule_derivative_keeps_venue_mark(monkeypatch: pytest.MonkeyPatch) -> None:
    """Row 6: a derivative row keeps the venue's mark and the venue-reported open profit; an
    unreported profit stays None (167.1.1.2 D-05), never 0."""
    from services import allocator_positions as ap

    async def _positions(_name: str, _exchange: Any) -> list[dict[str, Any]]:
        return [
            {"symbol": "BTCUSDT", "side": "long", "size_base": 2.0, "size_usd": 100000.0,
             "entry_price": 49000.0, "mark_price": 50123.5, "unrealized_pnl": 12.34},
            {"symbol": "ETHUSDT", "side": "short", "size_base": 3.0, "size_usd": 9000.0,
             "entry_price": 3100.0, "mark_price": 3000.25, "unrealized_pnl": None},
        ]

    monkeypatch.setattr(ap, "fetch_positions", _positions)
    rows = await ap._fetch_derivative_rows("bybit", object())
    assert rows[0]["mark_price"] == 50123.5
    assert rows[0]["unrealized_pnl_usd"] == 12.34
    assert rows[1]["mark_price"] == 3000.25
    assert rows[1]["unrealized_pnl_usd"] is None


def _deribit(name: str, kind: str, index: float, mark: float) -> dict[str, Any]:
    return {"info": {
        "direction": "buy", "size": 1000.0, "size_currency": 0.02, "kind": kind,
        "instrument_name": name, "index_price": index, "mark_price": mark,
        "average_price": 49000.0, "floating_profit_loss": 0.001,
    }}


def test_price_rule_deribit_inverse_keeps_the_index() -> None:
    """Row 7: a coin-settled position converts its coin P&L at ``index_price``; with no index a
    non-option falls back to the mark; an option with no index raises (its mark is a premium in
    the coin, not a coin-to-USD rate)."""
    from services.positions import _normalize_deribit_position

    # 0.001 BTC of profit x 50000.0 index = 50.0 USD.
    with_index = _normalize_deribit_position(_deribit("BTC-PERPETUAL", "future", 50000.0, 50100.0))
    assert with_index is not None
    assert with_index["unrealized_pnl"] == pytest.approx(50.0)
    # No index: 0.001 x 50100.0 mark = 50.1 USD.
    no_index = _normalize_deribit_position(_deribit("BTC-PERPETUAL", "future", 0.0, 50100.0))
    assert no_index is not None
    assert no_index["unrealized_pnl"] == pytest.approx(50.1)
    with pytest.raises(ValueError):
        _normalize_deribit_position(_deribit("BTC-30JAN26-100000-C", "option", 0.0, 0.05))


def test_price_rule_marks_conform() -> None:
    """Row 10: a mark is labelled the UTC day that just closed (NAVMTM D-03/D-11). Row 12: a
    native balance is priced at the exact-day close of that day, never an older one (D-07)."""
    import pandas as pd

    from services.nav_marks import mark_day_for
    from services.native_to_usd import price_live_balance

    now = datetime(2026, 3, 11, 0, 10, tzinfo=timezone.utc)
    assert mark_day_for(now) == date(2026, 3, 10)

    older = pd.Series([60000.0, 61000.0], index=pd.DatetimeIndex(["2026-03-08", "2026-03-09"]))
    assert price_live_balance(0.5, "BTC", older, now) is None  # 03-10 close absent: no stand-in
    exact = pd.Series(
        [60000.0, 61000.0, 62000.0],
        index=pd.DatetimeIndex(["2026-03-08", "2026-03-09", "2026-03-10"]),
    )
    # 0.5 BTC x the 03-10 close of 62000.0 = 31000.0
    priced = price_live_balance(0.5, "BTC", exact, now)
    assert priced is not None and priced[0] == 31000.0


def test_price_rule_holding_marks_gap() -> None:
    """Row 11: BRIDGERETURNS (N = 0): a mark at or below 0 is a gap, skipped, never zero-filled."""
    from services.holding_marks import DailyMark, daily_mark_prices

    def _row(day: str, mark: float) -> dict[str, Any]:
        return {"asof": day, "mark_price": mark, "api_key_id": "k1", "updated_at": f"{day}T00:30:00Z"}

    out = daily_mark_prices([_row("2026-03-01", 100.0), _row("2026-03-02", 0.0), _row("2026-03-03", 110.0)])
    assert out == [DailyMark("2026-03-01", 100.0), DailyMark("2026-03-03", 110.0)]


# ---------------------------------------------------------------------------
# Plan 12 (D-06, RESEARCH F2): the dust floor and the unsizable choice, written once
# ---------------------------------------------------------------------------


def test_dust_floor_share_is_the_recorded_decision() -> None:
    """D-06 (founder 2026-10-27, AskUserQuestion "0.1%, unsizable left out"): the floor is
    0.001 of the account's USD level and an unsizable gap is LEFT OUT, not held. Both typed
    from plan 10's SUMMARY (`dust-floor-share: 0.001`, `unsizable: left-out`); the PROD
    census behind them found no unpriced balance at all, so the floor is precautionary."""
    from services import price_rule

    assert price_rule.DUST_FLOOR_SHARE == 0.001
    assert price_rule.UNSIZABLE_GAP_HOLDS is False


def test_gap_disposition_boundaries() -> None:
    """D-N13. Level 10000.0 x floor 0.001 = 10.00 is the boundary: 9.99 is strictly below it
    (dust, left out) and 10.00 is AT it (hold). A level at or below 0 cannot be a share of
    anything, so it holds; an estimate that could not be made is unsizable. With the floor
    drilled to 0.01 the boundary is 100.00 and the 10.00 assertion goes RED."""
    from services.price_rule import gap_disposition

    assert gap_disposition(9.99, 10000.0) == "dust"
    assert gap_disposition(10.00, 10000.0) == "hold"
    assert gap_disposition(50.0, 0.0) == "hold"
    assert gap_disposition(50.0, -5.0) == "hold"
    assert gap_disposition(None, 10000.0) == "unsizable"


def test_gap_holds_the_day(monkeypatch: pytest.MonkeyPatch) -> None:
    """F2: a sizable gap holds, a dust gap does not, and an unsizable gap follows the ONE
    recorded flag, read at call time so a test (or a later founder decision) can flip it."""
    from services import price_rule

    assert price_rule.gap_holds_the_day("hold") is True
    assert price_rule.gap_holds_the_day("dust") is False
    assert price_rule.gap_holds_the_day("unsizable") is price_rule.UNSIZABLE_GAP_HOLDS
    assert price_rule.gap_holds_the_day("unsizable") is False
    monkeypatch.setattr(price_rule, "UNSIZABLE_GAP_HOLDS", True)
    assert price_rule.gap_holds_the_day("unsizable") is True
