"""167.1.1.1 (BRIDGERETURNS) plan 04: the matcher's per-holding returns come from each
holding's daily MARK PRICE, never from the change of its dollar value.

A purchase, a sale or a transfer moves ``value_usd`` and not the price, so it must never
read as a gain or a loss in the Bridge flags. These tests build the allocator's book on the
shared PostgREST fake and run the real ``_load_allocator_context``.

Every mark, dollar figure and expected return below is typed by hand or derived with plain
arithmetic in the test, never by calling the code under test. The calendar is fixed (the
history window start is pinned), so nothing depends on today's date.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import Any
from uuid import uuid4

import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers import match as match_mod
from services import rate_limit as _rl
from services.allocator_equity_derive import HoldingsUpdatedAtError
from services.db import PaginatedSelectTruncated
from services.holding_marks import HoldingMarkContractError
from tests.fake_postgrest import FakeDb

ALLOCATOR = "alloc-1"
OTHER_ALLOCATOR = "alloc-2"
END = "2026-10-11"

BTC = "holding:binance:BTC:spot"
USDT = "holding:binance:USDT:spot"

# 31 adjacent daily marks, so 30 adjacent-day returns (the boundary the rule needs).
BTC_MARKS = [
    100.0, 102.0, 101.0, 105.0, 104.0, 108.0, 107.0, 110.0, 109.0, 112.0,
    115.0, 113.0, 116.0, 118.0, 117.0, 120.0, 119.0, 122.0, 125.0, 124.0,
    126.0, 128.0, 127.0, 130.0, 129.0, 132.0, 135.0, 133.0, 136.0, 138.0,
    140.0,
]


@pytest.fixture(autouse=True)
def _reset_limiter_buckets() -> Any:
    _rl.limiter.reset()
    yield
    _rl.limiter.reset()


@pytest.fixture(autouse=True)
def _fixed_window(monkeypatch: pytest.MonkeyPatch) -> None:
    """Pin the history window start so the fixed calendar above always lies inside it."""
    monkeypatch.setattr(match_mod, "_holdings_history_window_start", lambda: "2026-01-01")


def _days(count: int, end: str = END) -> list[str]:
    last = date.fromisoformat(end)
    return [(last - timedelta(days=count - 1 - i)).isoformat() for i in range(count)]


def _key(key_id: str, exchange: str = "binance", user: str = ALLOCATOR) -> dict[str, Any]:
    return {
        "id": key_id,
        "user_id": user,
        "exchange": exchange,
        "venue_account_id": None,
        "account_share_kind": None,
        "account_shared_with_api_key_id": None,
    }


def _history(
    key: str,
    venue: str,
    symbol: str,
    marks: list[float],
    values: float | list[float],
    *,
    allocator: str = ALLOCATOR,
    clock: str = "04:00:00",
    end: str = END,
) -> list[dict[str, Any]]:
    """One spot row per day for ``marks``, the last row on ``end``."""
    value_path = values if isinstance(values, list) else [values] * len(marks)
    assert len(value_path) == len(marks)
    return [
        {
            "allocator_id": allocator,
            "api_key_id": key,
            "venue": venue,
            "symbol": symbol,
            "holding_type": "spot",
            "side": "flat",
            "value_usd": value,
            "mark_price": mark,
            "asof": day,
            "updated_at": f"{day}T{clock}+00:00",
        }
        for day, mark, value in zip(_days(len(marks), end), marks, value_path)
    ]


def _db(rows: list[dict[str, Any]], keys: list[dict[str, Any]] | None = None) -> FakeDb:
    return FakeDb(
        {
            "api_keys": keys if keys is not None else [_key("key-a")],
            "allocator_holdings": rows,
            "allocator_equity_derived": [],
        }
    )


def _context(monkeypatch: pytest.MonkeyPatch, db: FakeDb) -> dict[str, Any]:
    monkeypatch.setattr(match_mod, "get_supabase", lambda: db)
    return match_mod._load_allocator_context(ALLOCATOR)


def _returns(marks: list[float]) -> list[float]:
    return [later / earlier - 1 for earlier, later in zip(marks, marks[1:])]


def test_a_priced_holding_carries_its_mark_returns_and_a_stablecoin_stays_in_the_book(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Tracer. BTC is priced: 31 adjacent days of marks. USDT's price is a writer constant,
    so it is withheld, and it still counts in the AUM and the weights (D-01)."""
    db = _db(
        _history("key-a", "binance", "BTC", BTC_MARKS, [10000.0] * 31)
        + _history("key-a", "binance", "USDT", [1.0] * 31, [5000.0] * 31)
    )

    ctx = _context(monkeypatch, db)

    assert list(ctx["portfolio_returns"]) == [BTC]
    series = ctx["portfolio_returns"][BTC]
    assert len(series) == 30
    assert list(series.index) == _days(31)[1:], "returns are keyed by the LATER day"
    assert series.iloc[0] == pytest.approx(0.02), "102 over 100"
    assert list(series.to_numpy()) == pytest.approx(_returns(BTC_MARKS))
    assert [s["strategy_id"] for s in ctx["portfolio_strategies"]] == [BTC]
    assert ctx["portfolio_aum"] == pytest.approx(15000.0)
    assert ctx["portfolio_weights"][BTC] == pytest.approx(10000 / 15000)
    assert ctx["portfolio_weights"][USDT] == pytest.approx(5000 / 15000)
    assert [r["symbol"] for r in ctx["_holdings_rows_eligible"]] == ["BTC"]
    assert [(r["symbol"], r["withheld_reason"]) for r in ctx["_holdings_rows_withheld"]] == [
        ("USDT", "fixed_price")
    ]


def test_a_purchase_at_a_constant_mark_is_not_a_return(monkeypatch: pytest.MonkeyPatch) -> None:
    """D-07. The mark never moves; the dollar value doubles on day 10 and falls on day 20
    (an allocator buying, then selling some). Every return is exactly 0.0. A dollar-ratio
    read sees +100% and -25%, so this test goes RED on it."""
    values = [100.0] * 10 + [200.0] * 10 + [150.0] * 11
    db = _db(_history("key-a", "binance", "BTC", [100.0] * 31, values))

    ctx = _context(monkeypatch, db)

    series = ctx["portfolio_returns"][BTC]
    assert len(series) == 30
    assert list(series.to_numpy()) == [0.0] * 30
    assert ctx["portfolio_aum"] == pytest.approx(150.0)


def test_two_venues_holding_one_symbol_get_two_series_each_from_its_own_marks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-08. binance BTC and okx BTC are two pseudo-strategies; neither borrows the other's
    prices (the old breakdown was keyed by bare symbol)."""
    okx_marks = [50.0 + 0.5 * i for i in range(31)]
    db = _db(
        _history("key-a", "binance", "BTC", BTC_MARKS, 3000.0)
        + _history("key-b", "okx", "BTC", okx_marks, 1000.0),
        keys=[_key("key-a"), _key("key-b", exchange="okx")],
    )

    ctx = _context(monkeypatch, db)

    okx = "holding:okx:BTC:spot"
    assert sorted(ctx["portfolio_returns"]) == sorted([BTC, okx])
    assert list(ctx["portfolio_returns"][BTC].to_numpy()) == pytest.approx(_returns(BTC_MARKS))
    assert list(ctx["portfolio_returns"][okx].to_numpy()) == pytest.approx(_returns(okx_marks))
    assert ctx["portfolio_aum"] == pytest.approx(4000.0)


def test_another_tenants_rows_on_the_same_symbol_never_reach_the_series(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """T-167.1.1.1-05. The history read runs as the service role, which bypasses RLS, so the
    allocator_id filter is the tenant boundary. The other tenant's BTC marks are far
    from this allocator's and are written LATER the same day, so a leak would win every day's
    pick and move every return."""
    mine = _history("key-a", "binance", "BTC", BTC_MARKS, 10000.0)
    theirs = _history(
        "key-z", "binance", "BTC", [900.0 + 7.0 * i for i in range(31)], 99.0,
        allocator=OTHER_ALLOCATOR, clock="23:00:00",
    )
    db = _db(mine + theirs, keys=[_key("key-a"), _key("key-z", user=OTHER_ALLOCATOR)])

    ctx = _context(monkeypatch, db)

    assert list(ctx["portfolio_returns"][BTC].to_numpy()) == pytest.approx(_returns(BTC_MARKS))
    reads = [r for r in db.read_log if r.table == "allocator_holdings"]
    assert reads, "the holdings were read"
    assert all(("allocator_id", ALLOCATOR) in r.eq for r in reads), (
        "every holdings read, every page, carries the tenant filter"
    )
    assert any(col == "asof" for r in reads for col, _ in r.gte), "the history read is windowed"


def test_a_history_that_fills_the_page_ceiling_raises_instead_of_returning_a_partial_series(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-05. 2,001 history rows against a 2-page ceiling of 1,000: the third row of the
    overflow would be missing from a partial series, so the read raises."""
    monkeypatch.setattr(match_mod, "_HOLDINGS_HISTORY_MAX_PAGES", 2)
    monkeypatch.setattr(match_mod, "_holdings_history_window_start", lambda: "1900-01-01")
    rows = _history("key-a", "binance", "BTC", [100.0] * 2001, 1.0)

    with pytest.raises(match_mod.HoldingsReadTruncated) as caught:
        _context(monkeypatch, _db(rows))

    assert isinstance(caught.value.__cause__, PaginatedSelectTruncated)


def test_a_history_exactly_filling_the_ceiling_is_still_read_whole(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(match_mod, "_HOLDINGS_HISTORY_MAX_PAGES", 2)
    monkeypatch.setattr(match_mod, "_holdings_history_window_start", lambda: "1900-01-01")
    rows = _history("key-a", "binance", "BTC", [100.0] * 2000, 1.0)

    ctx = _context(monkeypatch, _db(rows))

    assert len(ctx["portfolio_returns"][BTC]) == 1999


def test_withheld_spot_holdings_stay_in_the_aum_and_weights_and_leave_the_returns(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-01, one holding per withheld reason. Nothing is zero-filled: a withheld holding has
    no series at all."""
    sol_marks = [20.0 + i for i in range(29)]  # 29 priced days: one short
    rows = (
        _history("key-a", "binance", "BTC", BTC_MARKS, 6000.0)
        + _history("key-a", "binance", "USDT", [1.0] * 31, 1000.0)
        + _history("key-a", "binance", "SOL", sol_marks, 500.0)
        + _history("key-a", "binance", "AVAX", [0.0] * 31, 400.0)
        + _history("key-m", "mt5", "EURUSD", [1.1] * 31, 2100.0)
    )
    db = _db(rows, keys=[_key("key-a"), _key("key-m", exchange="mt5")])

    ctx = _context(monkeypatch, db)

    assert list(ctx["portfolio_returns"]) == [BTC]
    assert [s["strategy_id"] for s in ctx["portfolio_strategies"]] == [BTC]
    assert ctx["portfolio_aum"] == pytest.approx(10000.0)
    expected_weights = {
        BTC: 0.6,
        USDT: 0.1,
        "holding:binance:SOL:spot": 0.05,
        "holding:binance:AVAX:spot": 0.04,
        "holding:mt5:EURUSD:spot": 0.21,
    }
    assert ctx["portfolio_weights"] == pytest.approx(expected_weights)
    assert sum(ctx["portfolio_weights"].values()) == pytest.approx(1.0)
    reasons = {r["symbol"]: r["withheld_reason"] for r in ctx["_holdings_rows_withheld"]}
    assert reasons == {
        "USDT": "fixed_price",
        "SOL": "too_few_priced_days",
        "AVAX": "no_price",
        "EURUSD": "account_balance",
    }
    assert [r["symbol"] for r in ctx["_holdings_rows_eligible"]] == ["BTC"]


def test_the_withheld_log_line_carries_counts_per_reason_and_no_holding_detail(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """T-167.1.1.1-08. Reasons and counts, not a symbol, a dollar figure or a key id."""
    rows = _history("key-a", "binance", "BTC", BTC_MARKS, 6000.0) + _history(
        "key-a", "binance", "USDT", [1.0] * 31, 1234.5
    )
    with caplog.at_level(logging.INFO, logger="quantalyze.analytics"):
        _context(monkeypatch, _db(rows))

    lines = [r.getMessage() for r in caplog.records if "withheld from the return signal" in r.getMessage()]
    assert len(lines) == 1
    assert "fixed_price=1" in lines[0]
    assert "USDT" not in lines[0] and "1234" not in lines[0] and "key-a" not in lines[0]


def test_contract_a_string_mark_raises_instead_of_becoming_a_gap(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A mark is ``numeric NOT NULL``; a string means the read broke its contract. It must
    surface, not be skipped as a missing day (which would silently shorten a series)."""
    rows = _history("key-a", "binance", "BTC", BTC_MARKS, 10000.0)
    rows[5] = {**rows[5], "mark_price": "100"}

    with pytest.raises(HoldingMarkContractError):
        _context(monkeypatch, _db(rows))


def test_contract_an_unparseable_updated_at_in_the_history_raises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The newest day is valid, so the account rule passes; the bad instant sits on an older
    day that only the history read sees."""
    rows = _history("key-a", "binance", "BTC", BTC_MARKS, 10000.0)
    rows[5] = {**rows[5], "updated_at": "not-a-time"}

    with pytest.raises(HoldingsUpdatedAtError):
        _context(monkeypatch, _db(rows))


@pytest.fixture()
def match_client() -> TestClient:
    app = FastAPI()
    app.include_router(match_mod.router)
    return TestClient(app)


def test_contract_error_is_a_logged_500_with_a_correlation_id_through_the_endpoint(
    monkeypatch: pytest.MonkeyPatch,
    match_client: TestClient,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """The same string-mark book, posted to the real recompute route with the real scorer:
    500 SCORING_FAILED, a correlation id in the body, the same id in the log, and none of the
    exception text in the response."""
    allocator = str(uuid4())
    rows = [
        {**row, "allocator_id": allocator}
        for row in _history("key-a", "binance", "BTC", BTC_MARKS, 10000.0)
    ]
    rows[5] = {**rows[5], "mark_price": "100"}
    db = _db(rows, keys=[_key("key-a", user=allocator)])

    monkeypatch.setattr(match_mod, "get_supabase", lambda: db)
    monkeypatch.setattr(match_mod, "_is_allocator_profile", lambda *_: True)

    async def _enabled(*_a: Any, **_k: Any) -> str:
        return match_mod.KILL_SWITCH_ENABLED

    async def _no_skip(_allocator_id: str, _force: bool) -> bool:
        return False

    monkeypatch.setattr(match_mod, "_engine_is_enabled", _enabled)
    monkeypatch.setattr(match_mod, "_should_skip_allocator", _no_skip)
    monkeypatch.setattr(
        match_mod,
        "_load_candidate_universe",
        lambda *_: {"strategies_by_id": {"s1": {}}, "returns_by_id": {}},
    )

    with caplog.at_level(logging.ERROR, logger="quantalyze.analytics"):
        resp = match_client.post(
            "/api/match/recompute", json={"allocator_id": allocator, "force": False}
        )

    assert resp.status_code == 500
    envelope = resp.json()["detail"]
    assert envelope["code"] == "SCORING_FAILED"
    correlation_id = envelope["correlation_id"]
    assert correlation_id
    logged = [r.getMessage() for r in caplog.records]
    assert any(correlation_id in line and "read contract" in line for line in logged)
    assert "read contract" not in resp.text


def test_a_priced_series_is_a_float_series_named_by_its_pseudo_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ctx = _context(
        monkeypatch, _db(_history("key-a", "binance", "BTC", BTC_MARKS, 10000.0))
    )

    series = ctx["portfolio_returns"][BTC]
    assert isinstance(series, pd.Series)
    assert series.dtype == float
    assert series.name == BTC
