"""167.1.1.1 round 2, CR-01: the holdings book must JOIN the candidate universe in production.

THE DEFECT THIS PINS. ``_load_holding_portfolio_context`` indexed each holding's return series
by plain "YYYY-MM-DD" strings, while every strategy and candidate series reaches the engine
through ``records_to_series`` as a tz-naive ``DatetimeIndex``. A string never equals a
``Timestamp``, so the engine's date joins found no shared day: the portfolio-fit axis
(sharpe_lift, dd_improvement, corr_reduction, corr_with_portfolio, 40% of the personalized
score) was null for every book that holds a holding, and a mixed book also skipped every
correlation-ceiling test and persisted a D-22 marker blaming an overlap that was fine.

Every earlier test of the fit axis built its candidate with a string index of its own, which
joined cleanly with the string-indexed holdings of the same test. So none could see this.
These tests run the REAL ``_load_candidate_universe`` over ``strategy_analytics`` rows shaped
like production's (a ``daily_returns`` list of ``{date, value}`` records), the real
``_load_allocator_context`` and the real ``_score_one_allocator`` / ``score_candidates``, and
read the persisted ``match_candidates`` and ``match_batches`` rows.
"""

from __future__ import annotations

import json
import math
from datetime import date, timedelta
from typing import Any
from unittest.mock import MagicMock

import pandas as pd
import pytest

from routers import match as match_mod
from tests.fake_postgrest import FakeDb
from tests.test_match_holding_returns import ALLOCATOR, END, _key

BOOK_DAYS = 120  # 120 adjacent marked days -> 119 one-day returns
CANDIDATE = "cand-1"
BOOK_STRATEGY = "strat-book"
BTC = "holding:binance:BTC:spot"


@pytest.fixture(autouse=True)
def _fixed_window(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(match_mod, "_holdings_history_window_start", lambda: "2026-01-01")


def _days(count: int) -> list[str]:
    last = date.fromisoformat(END)
    return [(last - timedelta(days=count - 1 - i)).isoformat() for i in range(count)]


def _holding_rows(symbol: str, value: float, mark: Any) -> list[dict[str, Any]]:
    return [
        {
            "allocator_id": ALLOCATOR,
            "api_key_id": "key-a",
            "venue": "binance",
            "symbol": symbol,
            "holding_type": "spot",
            "side": "flat",
            "value_usd": value,
            "mark_price": mark(i),
            "asof": day,
            "updated_at": f"{day}T04:00:00+00:00",
        }
        for i, day in enumerate(_days(BOOK_DAYS))
    ]


def _btc_mark(i: int) -> float:
    return 100.0 + 0.5 * i + 4.0 * math.sin(0.9 * i)


def _eth_mark(i: int) -> float:
    return 50.0 + 0.3 * i + 2.5 * math.sin(0.9 * i + 0.4)


def _production_daily_returns(phase: float) -> list[dict[str, Any]]:
    """``strategy_analytics.daily_returns`` as the analytics worker stores it: ISO day records
    (the strategy and candidate path of the matcher reads exactly this column)."""
    return [
        {"date": day, "value": 0.004 * math.sin(0.9 * i + phase) + 0.0005 * ((i % 7) - 3)}
        for i, day in enumerate(_days(BOOK_DAYS)[1:])
    ]


def _analytics_row(strategy_id: str, phase: float) -> dict[str, Any]:
    return {
        "strategy_id": strategy_id,
        "returns_series": None,
        "daily_returns": _production_daily_returns(phase),
        "sharpe": 1.5,
        "max_drawdown": -0.15,
        "data_quality_flags": {},
    }


def _db(*, with_book_strategy: bool) -> FakeDb:
    tables: dict[str, list[dict[str, Any]]] = {
        "api_keys": [_key("key-a")],
        "allocator_holdings": (
            _holding_rows("BTC", 6000.0, _btc_mark) + _holding_rows("ETH", 4000.0, _eth_mark)
        ),
        "allocator_equity_derived": [],
        "match_decisions": [],
        "allocator_preferences": [],
        # The candidate universe: one published strategy, with production-shaped analytics.
        "strategies": [
            {
                "id": CANDIDATE,
                "name": "Candidate",
                "codename": "C",
                "strategy_types": ["trend_following"],
                "subtypes": [],
                "supported_exchanges": ["kraken"],
                "status": "published",
                "aum": 5_000_000,
                "max_capacity": None,
                "user_id": "manager-1",
                "start_date": "2024-01-01",
                "is_example": False,
            }
        ],
        "strategy_analytics": [_analytics_row(CANDIDATE, 1.3)],
        "portfolios": [],
        "portfolio_strategies": [],
    }
    if with_book_strategy:
        # A strategy allocation beside the holdings: its series is a DatetimeIndex too.
        tables["portfolios"] = [{"id": "port-1", "user_id": ALLOCATOR}]
        tables["portfolio_strategies"] = [
            {
                "strategy_id": BOOK_STRATEGY,
                "current_weight": 0.5,
                "portfolio_id": "port-1",
                "allocated_amount": 10000.0,
            }
        ]
        tables["strategy_analytics"].append(_analytics_row(BOOK_STRATEGY, 0.2))
    return FakeDb(tables)


async def _score_through_the_real_path(
    monkeypatch: pytest.MonkeyPatch, db: FakeDb
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Run the real universe load, the real context load and the real ``_score_one_allocator``
    (the real ``score_candidates`` inside). Returns ``(batch row, the one candidate row)`` as
    they are inserted, after a JSON round trip (what the database receives)."""
    monkeypatch.setattr(match_mod, "get_supabase", lambda: db)
    universe = match_mod._load_candidate_universe()
    ctx = match_mod._load_allocator_context(ALLOCATOR)

    inserted: dict[str, list[Any]] = {}

    def _table(name: str) -> Any:
        table = MagicMock()

        def _insert(payload: Any) -> Any:
            inserted.setdefault(name, []).append(payload)
            return MagicMock(execute=lambda: MagicMock(data=[{"id": "batch-1"}]))

        table.insert = _insert
        return table

    sink = MagicMock()
    sink.table.side_effect = _table
    monkeypatch.setattr(match_mod, "get_supabase", lambda: sink)

    await match_mod._score_one_allocator(
        ALLOCATOR, universe, precomputed_ctx=ctx, precomputed_overrides=None
    )

    (batch,) = inserted["match_batches"]
    candidate_rows = [r for payload in inserted["match_candidates"] for r in payload]
    (candidate,) = [r for r in candidate_rows if r["strategy_id"] == CANDIDATE]
    return json.loads(json.dumps(batch)), json.loads(json.dumps(candidate))


def _assert_the_fit_axis_computed(candidate: dict[str, Any]) -> None:
    raw = candidate["score_breakdown"]["raw"]
    for name in ("sharpe_lift", "dd_improvement", "corr_with_portfolio"):
        assert isinstance(raw[name], float), (
            f"{name} must be a float (the book joined the candidate), got {raw[name]!r}"
        )


def _book_markers(batch: dict[str, Any]) -> list[dict[str, Any]]:
    return [e for e in batch["holding_flags"] if e.get("kind") == "book"]


async def test_a_holdings_only_book_joins_the_candidate_universe(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A book of two holdings (BTC, ETH) and one published candidate, every date overlapping.
    The fit axis computes, and there is no D-22 marker."""
    batch, candidate = await _score_through_the_real_path(monkeypatch, _db(with_book_strategy=False))

    _assert_the_fit_axis_computed(candidate)
    assert _book_markers(batch) == []
    assert {e["holding_ref"] for e in batch["holding_flags"]} == {
        BTC,
        "holding:binance:ETH:spot",
    }


async def test_a_mixed_strategies_and_holdings_book_joins_the_candidate_universe(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A strategy allocation (DatetimeIndex) beside the two holdings. Before the fix the
    ``.dropna()`` join of the book was EMPTY (a string day never equals a Timestamp), so the
    fit axis was null and the D-22 marker named ``shared_days: 0``."""
    batch, candidate = await _score_through_the_real_path(monkeypatch, _db(with_book_strategy=True))

    _assert_the_fit_axis_computed(candidate)
    assert _book_markers(batch) == [], "the calendars overlap fully, so no marker"


def test_the_holding_series_carries_the_index_type_the_universe_carries(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The two sides of the join, read from the real loaders: same index class, tz-awareness
    and dtype family."""
    db = _db(with_book_strategy=False)
    monkeypatch.setattr(match_mod, "get_supabase", lambda: db)
    universe = match_mod._load_candidate_universe()
    ctx = match_mod._load_allocator_context(ALLOCATOR)

    candidate_index = universe["returns_by_id"][CANDIDATE].index
    holding_index = ctx["portfolio_returns"][BTC].index

    assert type(holding_index) is type(candidate_index) is pd.DatetimeIndex
    assert holding_index.tz is None and candidate_index.tz is None
    assert holding_index.dtype == candidate_index.dtype
    assert len(holding_index.intersection(candidate_index)) == BOOK_DAYS - 1


class _MixedIndexConverter:
    """A converter that hands the book back with one series on a string index."""

    async def convert(self, series: Any, units: Any) -> tuple[Any, Any]:
        poisoned = dict(series)
        key = next(iter(poisoned))
        broken = poisoned[key].copy()
        broken.index = [d.strftime("%Y-%m-%d") for d in broken.index]
        poisoned[key] = broken
        return poisoned, []


async def test_a_string_indexed_series_fails_loud_before_scoring(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A series that is not DatetimeIndex-indexed must never reach the join silently."""
    db = _db(with_book_strategy=True)
    monkeypatch.setattr(match_mod, "get_supabase", lambda: db)
    universe = match_mod._load_candidate_universe()
    universe["_usd_converter"] = _MixedIndexConverter()
    ctx = match_mod._load_allocator_context(ALLOCATOR)

    with pytest.raises(match_mod.SeriesIndexError) as excinfo:
        await match_mod._score_one_allocator(
            ALLOCATOR, universe, precomputed_ctx=ctx, precomputed_overrides=None
        )

    assert "DatetimeIndex" in str(excinfo.value) and ALLOCATOR in str(excinfo.value)


def test_a_tz_aware_series_beside_tz_naive_ones_fails_loud() -> None:
    naive = pd.Series([0.01, 0.02], index=pd.DatetimeIndex(["2026-01-01", "2026-01-02"]))
    aware = naive.copy()
    aware.index = aware.index.tz_localize("UTC")

    with pytest.raises(match_mod.SeriesIndexError, match="tz-naive"):
        match_mod.assert_uniform_datetime_index(
            {"book": {"a": naive}, "candidate": {"b": aware}}, allocator_id="x"
        )
    # One uniform kind, naive or aware, is fine; an empty series has nothing to join.
    match_mod.assert_uniform_datetime_index(
        {"book": {"a": naive, "e": pd.Series(dtype=float)}, "candidate": {"c": naive}},
        allocator_id="x",
    )
    match_mod.assert_uniform_datetime_index({"book": {"b": aware}}, allocator_id="x")


def test_the_book_join_marker_refuses_a_mixed_index_rather_than_report_zero_shared_days() -> None:
    naive = pd.Series([0.01] * 40, index=pd.date_range("2026-01-01", periods=40, freq="D"))
    stringly = pd.Series([0.01] * 40, index=[f"2026-01-{d:02d}" for d in range(1, 32)] + [
        f"2026-02-{d:02d}" for d in range(1, 10)
    ])

    with pytest.raises(match_mod.SeriesIndexError):
        match_mod.book_join_marker({"a": naive, "b": stringly}, allocator_id="x")
