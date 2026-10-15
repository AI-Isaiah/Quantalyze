"""167.1.1.1 (BRIDGERETURNS) plan 05, D-20: one thin or gappy spot series must not empty
the book's shared-days join.

D-03 admits a spot series to the matcher by PRICED DAYS (30 or more). The matcher then joins
every book series on the days they ALL carry a return (``pd.DataFrame(portfolio_returns)
.dropna()`` in ``score_candidates``). A holding with 30 priced days that are not adjacent has
zero one-day returns, and a join containing it has zero rows: the portfolio-fit axis
(sharpe_lift, corr_reduction, dd_improvement, corr_with_portfolio) goes null for every
candidate and ``compute_holding_flags`` skips every correlation-ceiling test, silently, for
the whole allocator. So D-20 requires 30 ADJACENT one-day returns for the matcher's return
join: a spot holding with fewer is withheld from the join by name
(``too_few_adjacent_returns``), and it stays in the AUM, the weights and the max-weight test
(D-01). ``/compare`` and the shared price rule do not change.

The book is PROD-shaped (RESEARCH Pitfall 1): spot only, binance. Every book is built through
the real ``_load_allocator_context``; the real ``score_candidates`` and the real
``compute_holding_flags`` then run on what it returned. Marks are hand-specified (``i`` is the
day index, 0 on the first day), never produced by the code under test:

    BTC mark_i = 100 + 0.5 * i + 4.0 * sin(0.9 * i)
    ETH mark_i =  50 + 0.3 * i + 2.5 * sin(0.9 * i + 0.4)

The two oscillate at one frequency with a 0.4 radian phase offset, so their daily returns
disperse and are positively correlated (not perfectly). The candidate's daily returns are
``0.004 * sin(0.9 * i + 1.3) + 0.0005 * ((i % 7) - 3)``.
"""

from __future__ import annotations

import math
from datetime import date, timedelta
from typing import Any

import pandas as pd
import pytest

from routers import match as match_mod
from services import match_engine
from tests.fake_postgrest import FakeDb

ALLOCATOR = "alloc-1"
END = "2026-10-11"
BOOK_DAYS = 120  # 120 adjacent priced days, so 119 one-day returns

BTC = "holding:binance:BTC:spot"
ETH = "holding:binance:ETH:spot"
SOL = "holding:binance:SOL:spot"


@pytest.fixture(autouse=True)
def _fixed_window(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(match_mod, "_holdings_history_window_start", lambda: "2026-01-01")


def _day(offset_from_end: int) -> str:
    return (date.fromisoformat(END) - timedelta(days=offset_from_end)).isoformat()


def _adjacent_days(count: int) -> list[str]:
    return [_day(count - 1 - i) for i in range(count)]


def _alternating_days(count: int) -> list[str]:
    """``count`` days ending on END with one empty calendar day between each: no two are
    adjacent, so there is not a single one-day return."""
    return [_day(2 * (count - 1 - i)) for i in range(count)]


def _btc_mark(i: int) -> float:
    return 100.0 + 0.5 * i + 4.0 * math.sin(0.9 * i)


def _eth_mark(i: int) -> float:
    return 50.0 + 0.3 * i + 2.5 * math.sin(0.9 * i + 0.4)


def _sol_mark(i: int) -> float:
    return 20.0 + 0.2 * i + 1.5 * math.sin(0.9 * i + 0.8)


def _rows(symbol: str, days: list[str], mark: Any, value: float) -> list[dict[str, Any]]:
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
        for i, day in enumerate(days)
    ]


def _book(sol_days: list[str] | None) -> list[dict[str, Any]]:
    """BTC and ETH on 120 adjacent days, plus SOL on ``sol_days`` when given."""
    rows = _rows("BTC", _adjacent_days(BOOK_DAYS), _btc_mark, 6000.0)
    rows += _rows("ETH", _adjacent_days(BOOK_DAYS), _eth_mark, 4000.0)
    if sol_days is not None:
        rows += _rows("SOL", sol_days, _sol_mark, 500.0)
    return rows


def _context(monkeypatch: pytest.MonkeyPatch, rows: list[dict[str, Any]]) -> dict[str, Any]:
    db = FakeDb(
        {
            "api_keys": [
                {
                    "id": "key-a",
                    "user_id": ALLOCATOR,
                    "exchange": "binance",
                    "venue_account_id": None,
                    "account_share_kind": None,
                    "account_shared_with_api_key_id": None,
                }
            ],
            "allocator_holdings": rows,
            "allocator_equity_derived": [],
            "portfolios": [],
            "match_decisions": [],
            "allocator_preferences": [],
        }
    )
    monkeypatch.setattr(match_mod, "get_supabase", lambda: db)
    return match_mod._load_allocator_context(ALLOCATOR)


def _candidate_returns() -> pd.Series:
    days = _adjacent_days(BOOK_DAYS + 1)[1:]  # 120 returns, ending on END
    return pd.Series(
        [0.004 * math.sin(0.9 * i + 1.3) + 0.0005 * ((i % 7) - 3) for i in range(len(days))],
        index=days,
        dtype=float,
        name="cand-1",
    )


class _FitSpy:
    """Records what ``_compute_portfolio_fit_components`` returned for the candidate, so the
    four fit values (one of which, corr_reduction, is not in the persisted breakdown) are
    read from the real engine call and not recomputed in the test."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.components: list[dict[str, Any]] = []
        real = match_engine._compute_portfolio_fit_components

        def spy(*args: Any, **kwargs: Any) -> dict[str, Any]:
            result = real(*args, **kwargs)
            self.components.append(result)
            return result

        monkeypatch.setattr(match_engine, "_compute_portfolio_fit_components", spy)

    def only(self) -> dict[str, Any]:
        assert len(self.components) == 1, "one candidate, one personalized fit call"
        return self.components[0]


def _score(
    ctx: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> tuple[dict[str, Any], dict[str, Any]]:
    spy = _FitSpy(monkeypatch)
    result = match_engine.score_candidates(
        allocator_id=ALLOCATOR,
        preferences={},
        portfolio_strategies=ctx["portfolio_strategies"],
        portfolio_returns=ctx["portfolio_returns"],
        portfolio_weights=ctx["portfolio_weights"],
        candidate_strategies=[
            {
                "strategy_id": "cand-1",
                "sharpe": 1.5,
                "track_record_days": 365,
                "max_drawdown_pct": -0.15,
                "manager_aum": 5_000_000,
                "exchange": "kraken",
                "strategy_type": "trend_following",
                "subtype": None,
            }
        ],
        candidate_returns={"cand-1": _candidate_returns()},
        thumbs_down_ids=ctx["thumbs_down_ids"],
        portfolio_aum=ctx["portfolio_aum"],
    )
    return result, spy.only()


def _flags(ctx: dict[str, Any], preferences: dict[str, Any]) -> dict[str, dict[str, Any]]:
    entries = match_mod.compute_holding_flags(
        holdings_rows_eligible=ctx["_holdings_rows_eligible"],
        holdings_rows_withheld=ctx["_holdings_rows_withheld"],
        portfolio_returns=ctx["portfolio_returns"],
        portfolio_weights=ctx["portfolio_weights"],
        portfolio_aum=ctx["portfolio_aum"],
        allocator_preferences=preferences,
        scored_candidates_by_slot={},
    )
    return {e["holding_ref"]: e for e in entries}


def _shared_days(ctx: dict[str, Any]) -> int:
    return len(pd.DataFrame(ctx["portfolio_returns"]).dropna())


def _assert_the_fit_axis_computes(fit: dict[str, Any], result: dict[str, Any]) -> None:
    for name in ("sharpe_lift", "corr_reduction", "dd_improvement", "corr_with_portfolio"):
        assert isinstance(fit[name], float), f"{name} must be a float, got {fit[name]!r}"
    raw = result["candidates"][0]["score_breakdown"]["raw"]
    assert isinstance(raw["sharpe_lift"], float)
    assert isinstance(raw["corr_with_portfolio"], float)


def _assert_nothing_is_zero_filled(ctx: dict[str, Any]) -> None:
    for pid, series in ctx["portfolio_returns"].items():
        assert 0.0 not in list(series.to_numpy()), f"{pid} carries a zero-filled day"


def test_control_long_history_only(monkeypatch: pytest.MonkeyPatch) -> None:
    """The control: BTC and ETH only. The common window is 119 days (at least 30), so the
    fit axis computes, and a correlation ceiling of -1.0 is breached by BTC (every
    correlation above it) and recorded."""
    ctx = _context(monkeypatch, _book(None))

    assert _shared_days(ctx) == 119
    result, fit = _score(ctx, monkeypatch)
    _assert_the_fit_axis_computes(fit, result)
    flags = _flags(ctx, {"correlation_ceiling": -1.0})
    assert "correlation_ceiling" in flags[BTC]["breach_reasons"]
    _assert_nothing_is_zero_filled(ctx)


def test_gappy_priced_days_is_withheld_and_does_not_empty_the_join(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The D-20 neuter target. SOL has 30 priced days on alternating calendar days (a 59-day
    span, no two adjacent): it passes the price rule (30 priced days) and has zero one-day
    returns. It is withheld from the join as ``too_few_adjacent_returns``, stays in the
    AUM and the weights (D-01), and the join keeps its 119 days, so every fit value
    still computes and the correlation ceiling still bites."""
    ctx = _context(monkeypatch, _book(_alternating_days(30)))

    reasons = {r["symbol"]: r["withheld_reason"] for r in ctx["_holdings_rows_withheld"]}
    assert reasons == {"SOL": "too_few_adjacent_returns"}
    assert SOL not in ctx["portfolio_returns"]
    assert SOL not in [s["strategy_id"] for s in ctx["portfolio_strategies"]]
    assert sorted(ctx["portfolio_returns"]) == [BTC, ETH]
    assert ctx["portfolio_aum"] == pytest.approx(10500.0), "D-01: SOL's 500 stays in the AUM"
    # CR-01: SOL has no series, so it has no SCORING weight; the weights cover the joined
    # series and sum to 1. Its AUM share (500 / 10500) is what the flags carry (below).
    assert SOL not in ctx["portfolio_weights"]
    assert sum(ctx["portfolio_weights"].values()) == pytest.approx(1.0)
    assert _shared_days(ctx) == 119, "the join is not emptied"

    result, fit = _score(ctx, monkeypatch)
    _assert_the_fit_axis_computes(fit, result)

    ceiling = _flags(ctx, {"correlation_ceiling": -1.0})
    assert "correlation_ceiling" in ceiling[BTC]["breach_reasons"]

    weight = _flags(ctx, {"max_weight": 0.01})
    for ref in (BTC, ETH, SOL):
        assert "max_weight" in weight[ref]["breach_reasons"], ref
    assert weight[SOL]["weight"] == pytest.approx(500 / 10500), "D-01: the AUM share"
    assert weight[SOL]["flagged"] is False
    assert weight[SOL]["withheld_reason"] == "too_few_adjacent_returns"
    assert weight[SOL]["top_candidate_strategy_id"] is None
    _assert_nothing_is_zero_filled(ctx)


def test_thirty_adjacent_priced_days_is_withheld(monkeypatch: pytest.MonkeyPatch) -> None:
    """30 ADJACENT priced days are 29 one-day returns, under 30: withheld by name (D-20), in
    the AUM and the weights, absent from the returns, and the join keeps its 119 days."""
    ctx = _context(monkeypatch, _book(_adjacent_days(30)))

    assert {r["symbol"]: r["withheld_reason"] for r in ctx["_holdings_rows_withheld"]} == {
        "SOL": "too_few_adjacent_returns"
    }
    assert SOL not in ctx["portfolio_returns"]
    assert ctx["portfolio_aum"] == pytest.approx(10500.0)
    assert SOL not in ctx["portfolio_weights"], "CR-01: no series, no scoring weight"
    assert _flags(ctx, {})[SOL]["weight"] == pytest.approx(500 / 10500), "D-01: AUM share"
    assert _shared_days(ctx) == 119

    result, fit = _score(ctx, monkeypatch)
    _assert_the_fit_axis_computes(fit, result)
    _assert_nothing_is_zero_filled(ctx)


def test_thirty_one_adjacent_priced_days_is_eligible(monkeypatch: pytest.MonkeyPatch) -> None:
    """The boundary: 31 adjacent priced days are exactly 30 returns, so SOL is eligible, is in
    the returns with those 30 returns, and has no withheld entry."""
    ctx = _context(monkeypatch, _book(_adjacent_days(31)))

    assert ctx["_holdings_rows_withheld"] == []
    assert SOL in ctx["portfolio_returns"]
    assert len(ctx["portfolio_returns"][SOL]) == 30
    assert [r["symbol"] for r in ctx["_holdings_rows_eligible"]] == ["BTC", "ETH", "SOL"]
    assert _shared_days(ctx) == 30, "the join is as long as the shortest eligible series"
    _assert_nothing_is_zero_filled(ctx)


def test_twenty_nine_priced_days_keeps_too_few_priced_days(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Precedence: with 29 priced days the price rule withholds first, so the reason is
    ``too_few_priced_days`` and never ``too_few_adjacent_returns`` (D-20 applies only to a
    holding the price rule admitted)."""
    ctx = _context(monkeypatch, _book(_adjacent_days(29)))

    assert {r["symbol"]: r["withheld_reason"] for r in ctx["_holdings_rows_withheld"]} == {
        "SOL": "too_few_priced_days"
    }
    assert SOL not in ctx["portfolio_returns"]
    assert ctx["portfolio_aum"] == pytest.approx(10500.0)
    assert _shared_days(ctx) == 119


def test_the_thin_holding_no_longer_silences_the_correlation_flags_it_used_to(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The consequence, against the control: BTC's correlation-ceiling breach is the same
    with and without the gappy holding in the book."""
    ctx_control = _context(monkeypatch, _book(None))
    control = _flags(ctx_control, {"correlation_ceiling": -1.0})
    gappy_ctx = _context(monkeypatch, _book(_alternating_days(30)))
    gappy = _flags(gappy_ctx, {"correlation_ceiling": -1.0})

    assert control[BTC]["breach_reasons"] == ["correlation_ceiling"]
    assert gappy[BTC]["breach_reasons"] == control[BTC]["breach_reasons"]
    assert gappy[ETH]["breach_reasons"] == control[ETH]["breach_reasons"]
    assert gappy[SOL]["breach_reasons"] == [], "no correlation test runs for a withheld holding"
    assert ctx_control["portfolio_aum"] == pytest.approx(10000.0)
