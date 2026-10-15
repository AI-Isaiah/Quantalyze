"""167.1.1.1 (BRIDGERETURNS) review round 1: CR-01.

Two weight notions live in the matcher and must stay apart:

* the SCORING weights (``ctx["portfolio_weights"]``): what ``match_engine`` blends the joined
  series with. They cover exactly the series the engine joins and sum to 1. A withheld spot
  holding has no series and a derivative's P&L is not a weight, so neither is in them.
* the AUM SHARE (``holding_flags[*].weight``): ``aum_contribution_usd`` over the full matcher
  AUM, withheld spot and derivative P&L included (D-01, D-16). It feeds the max-weight test.

CR-01: when the withheld dollars sat in the scoring denominator the candidate's add_weight ``a``
became ``a / (S * (1 - a) + a)`` with ``S`` the priced fraction, so a book with a stablecoin
scored a different ``sharpe_lift`` than the same book without it.

Every dollar figure below is typed by hand. The fit values are read off the real
``_compute_portfolio_fit_components`` through the spy, never recomputed here.
"""

from __future__ import annotations

import logging
from typing import Any

import pytest

from routers import match as match_mod
from services import match_engine
from tests.fake_postgrest import FakeDb
from tests.test_match_book_join_overlap import (
    ALLOCATOR,
    BOOK_DAYS,
    END,
    _FitSpy,
    _adjacent_days,
    _btc_mark,
    _candidate_returns,
    _rows,
)

BTC = "holding:binance:BTC:spot"
USDT = "holding:binance:USDT:spot"

FIT_KEYS = ("sharpe_lift", "dd_improvement", "corr_reduction", "corr_with_portfolio")


@pytest.fixture(autouse=True)
def _fixed_window(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(match_mod, "_holdings_history_window_start", lambda: "2026-01-01")


def _usdt_rows(value: float) -> list[dict[str, Any]]:
    """A stablecoin: the writer's constant 1.0 price, so it is withheld (fixed_price)."""
    return _rows("USDT", _adjacent_days(BOOK_DAYS), lambda i: 1.0, value)


def _perp_row(pnl: float) -> list[dict[str, Any]]:
    return [
        {
            "allocator_id": ALLOCATOR,
            "api_key_id": "key-a",
            "venue": "binance",
            "symbol": "ETHUSDT",
            "holding_type": "derivative",
            "side": "long",
            "value_usd": 900_000.0,
            "unrealized_pnl_usd": pnl,
            "mark_price": 2000.0,
            "asof": END,
            "updated_at": f"{END}T04:00:00+00:00",
        }
    ]


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


def _fit(ctx: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    """The real engine's fit components for one candidate. ``portfolio_aum`` is withheld on
    purpose so add_weight is the engine's fixed 0.10 in every book: the ticket-over-AUM sizing
    is a separate, unchanged mechanism that would otherwise differ between books of different
    AUM and hide whether the SCORING WEIGHTS agree, which is what these tests pin."""
    spy = _FitSpy(monkeypatch)
    match_engine.score_candidates(
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
        portfolio_aum=None,
    )
    return spy.only()


def _flags(ctx: dict[str, Any], preferences: dict[str, Any]) -> dict[str, dict[str, Any]]:
    entries = match_mod.compute_holding_flags(
        holdings_rows_eligible=ctx["_holdings_rows_eligible"],
        holdings_rows_withheld=ctx["_holdings_rows_withheld"],
        holdings_rows_derivative=ctx["_holdings_rows_derivative"],
        portfolio_returns=ctx["portfolio_returns"],
        portfolio_weights=ctx["portfolio_weights"],
        portfolio_aum=ctx["portfolio_aum"],
        allocator_preferences=preferences,
        scored_candidates_by_slot={},
    )
    return {e["holding_ref"]: e for e in entries}


def _btc_only() -> list[dict[str, Any]]:
    return _rows("BTC", _adjacent_days(BOOK_DAYS), _btc_mark, 2000.0)


# ---------------------------------------------------------------------------
# CR-01: withheld dollars are not in the scoring denominator
# ---------------------------------------------------------------------------


def test_a_withheld_stablecoin_leaves_the_fit_values_exactly_as_the_book_without_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """BTC 2,000 with a 119-return series, beside USDT 8,000 withheld (no series). The AUM is
    10,000, but the series the engine joins is BTC alone, so its fit values must equal the
    book of BTC alone. With the withheld dollars in the denominator BTC weighs 0.2 and a 10%
    ticket is modelled as 1 / 1.08 of the book (about 36%) instead of 10%."""
    alone = _context(monkeypatch, _btc_only())
    beside_usdt = _context(monkeypatch, _btc_only() + _usdt_rows(8000.0))

    assert alone["portfolio_weights"] == {BTC: pytest.approx(1.0)}
    assert beside_usdt["portfolio_weights"] == {BTC: pytest.approx(1.0)}, "no scoring weight for USDT"
    assert beside_usdt["portfolio_aum"] == pytest.approx(10000.0), "D-01: USDT stays in the AUM"

    fit_alone = _fit(alone, monkeypatch)
    fit_beside = _fit(beside_usdt, monkeypatch)

    # Non-vacuity: the lift is a real, non-zero float, so equality below can fail.
    assert isinstance(fit_alone["sharpe_lift"], float)
    assert fit_alone["sharpe_lift"] != 0.0
    for name in FIT_KEYS:
        assert fit_beside[name] == pytest.approx(fit_alone[name], abs=1e-12), name

    # D-01 / D-16 are intact: the USDT flag entry carries its AUM share of the FULL AUM.
    flags = _flags(beside_usdt, {"max_weight": 0.5})
    assert flags[USDT]["weight"] == pytest.approx(0.8)
    assert flags[USDT]["breach_reasons"] == ["max_weight"], "D-01: the max-weight test runs"
    assert flags[USDT]["flagged"] is False
    assert flags[USDT]["withheld_reason"] == "fixed_price"
    assert flags[BTC]["weight"] == pytest.approx(0.2)


def test_a_derivative_pnl_leaves_the_scoring_weights_and_the_fit_values_alone(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The derivative term moves the AUM (D-16), never the scoring weights: BTC 2,000 plus a
    perp with P&L +1,000 has an AUM of 3,000 and the fit values of BTC alone."""
    alone = _context(monkeypatch, _btc_only())
    with_perp = _context(monkeypatch, _btc_only() + _perp_row(1000.0))

    assert with_perp["portfolio_aum"] == pytest.approx(3000.0)
    assert with_perp["portfolio_weights"] == {BTC: pytest.approx(1.0)}

    fit_alone = _fit(alone, monkeypatch)
    fit_perp = _fit(with_perp, monkeypatch)
    for name in FIT_KEYS:
        assert fit_perp[name] == pytest.approx(fit_alone[name], abs=1e-12), name

    assert _flags(with_perp, {})[BTC]["weight"] == pytest.approx(2000 / 3000)


# ---------------------------------------------------------------------------
# The equal-weight fallback is named
# ---------------------------------------------------------------------------


def test_a_zero_value_scored_set_takes_the_equal_weight_fallback_by_name(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """The fallback predates this phase and stays for a scoring set whose values sum to
    nothing; it is no longer silent."""
    rows = _rows("BTC", _adjacent_days(BOOK_DAYS), _btc_mark, 0.0)
    with caplog.at_level(logging.WARNING, logger=match_mod.logger.name):
        ctx = _context(monkeypatch, rows)

    assert ctx["portfolio_weights"] == {BTC: pytest.approx(1.0)}
    assert "scoring_weights_equal_fallback" in caplog.text
