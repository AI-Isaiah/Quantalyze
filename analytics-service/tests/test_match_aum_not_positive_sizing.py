"""167.1.1.1 round 2, WR-01 under D-23: a non-positive matcher AUM sizes the ticket at the
0.5 add-weight ceiling, never at the engine's fixed 0.10 default.

THE DEFECT. Derivative losses can leave the matcher AUM at or below zero. The context then
passed ``portfolio_aum=None``, which ``score_candidates`` reads as "cold-start or unknown AUM"
and sizes the candidate at a fixed ``add_weight`` of 0.10. A book with a tiny POSITIVE AUM
(D-21) divides the ticket by that AUM and clamps at the 0.5 ceiling, so the book that lost more
money was scored as a SMALLER position, which gives it a better max-weight score and a better
total than a book that lost less. D-23 (founder): size at the ceiling, consistent with D-21,
record the fallback on the batch, and say so in the WARNING.

Each test runs the real ``_load_allocator_context``, the real ``_score_one_allocator`` and so the
real ``score_candidates``, and reads the persisted rows. The preference is a ``max_weight`` of
0.1 and a ticket of 50,000 against a book of a few thousand dollars; hand-typed throughout:

    ceiling sizing  add_weight = clamp(50000 / 100, 0.01, 0.5) = 0.5   (AUM +$100)
    default sizing  add_weight = 0.10                                  (AUM unknown)
    max-weight taper: add_weight 0.5 > 0.1 scores max(0, 1 - (0.5 - 0.1) / 0.1) = 0.0
                      add_weight 0.1 <= 0.1 scores 1.0
"""

from __future__ import annotations

import json
import logging
from typing import Any
from unittest.mock import MagicMock

import pytest

from routers import match as match_mod
from tests.fake_postgrest import FakeDb
from tests.test_match_book_join_overlap import (
    ALLOCATOR,
    BOOK_DAYS,
    _adjacent_days,
    _btc_mark,
    _candidate_returns,
    _rows,
)
from tests.test_match_scoring_weights import _perp_row

CANDIDATE = "cand-1"
PREFERENCES = {"max_weight": 0.1, "target_ticket_size_usd": 50_000}


@pytest.fixture(autouse=True)
def _fixed_window(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(match_mod, "_holdings_history_window_start", lambda: "2026-01-01")


def _book(perp_pnl: float) -> list[dict[str, Any]]:
    """BTC worth 1,000 (priced, 119 returns) plus a perp whose unrealized P&L is ``perp_pnl``:
    the matcher AUM is 1,000 + ``perp_pnl``."""
    return _rows("BTC", _adjacent_days(BOOK_DAYS), _btc_mark, 1000.0) + _perp_row(perp_pnl)


def _db(rows: list[dict[str, Any]]) -> FakeDb:
    return FakeDb(
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


def _universe() -> dict[str, Any]:
    return {
        "strategies_by_id": {
            CANDIDATE: {
                "strategy_id": CANDIDATE,
                "sharpe": 1.5,
                "track_record_days": 365,
                "max_drawdown_pct": -0.15,
                "manager_aum": 5_000_000,
                "exchange": "kraken",
                "strategy_type": "trend_following",
                "subtype": None,
            }
        },
        "returns_by_id": {CANDIDATE: _candidate_returns()},
    }


async def _score(
    monkeypatch: pytest.MonkeyPatch, perp_pnl: float, preferences: dict[str, Any]
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    """``(context, batch row, the candidate row)`` for BTC 1,000 plus a perp of ``perp_pnl``."""
    monkeypatch.setattr(match_mod, "get_supabase", lambda: _db(_book(perp_pnl)))
    ctx = match_mod._load_allocator_context(ALLOCATOR)
    ctx["preferences"] = dict(preferences)

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
        ALLOCATOR, _universe(), precomputed_ctx=ctx, precomputed_overrides=None
    )

    (batch,) = inserted["match_batches"]
    (candidate,) = [r for p in inserted["match_candidates"] for r in p if r["strategy_id"] == CANDIDATE]
    return ctx, json.loads(json.dumps(batch)), json.loads(json.dumps(candidate))


def _max_weight_score(candidate: dict[str, Any]) -> float:
    return float(candidate["score_breakdown"]["raw"]["mandate_fit_raw"]["max_weight"])


def _fallbacks(batch: dict[str, Any]) -> list[dict[str, Any]]:
    return [e for e in batch["holding_flags"] if e.get("add_weight_fallback")]


@pytest.mark.parametrize("perp_pnl", [-1500.0, -1000.0, -5000.0])
async def test_a_non_positive_aum_never_scores_better_than_a_tiny_positive_aum(
    monkeypatch: pytest.MonkeyPatch, perp_pnl: float
) -> None:
    """AUM -500, 0 and -4,000 against the same book at +$100 (D-21). Same candidate, same
    series, same preferences: only the sign of the AUM differs, so neither the max-weight
    dimension nor the total score of the non-positive book may exceed the +$100 book's."""
    _, _, tiny = await _score(monkeypatch, -900.0, PREFERENCES)  # AUM +100
    ctx, _, non_positive = await _score(monkeypatch, perp_pnl, PREFERENCES)

    assert ctx["portfolio_aum"] is None and ctx["aum_not_positive"] is True
    assert _max_weight_score(tiny) == 0.0, "the +$100 book is sized at the 0.5 ceiling"
    assert _max_weight_score(non_positive) <= _max_weight_score(tiny)
    assert non_positive["score"] <= tiny["score"]


async def test_the_fallback_is_recorded_on_the_batch_and_named_in_the_warning(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.WARNING, logger=match_mod.logger.name):
        _, batch, _ = await _score(monkeypatch, -1500.0, PREFERENCES)

    assert _fallbacks(batch) == [
        {
            "kind": "book",
            "holding_ref": None,
            "add_weight_fallback": "aum_not_positive_ceiling_0_5",
            "add_weight": 0.5,
            "flagged": False,
        }
    ]
    warning = next(r.getMessage() for r in caplog.records if "aum_not_positive" in r.getMessage())
    assert ALLOCATOR in warning
    assert "0.5" in warning and "ceiling" in warning
    assert "scoring is unaffected" not in warning


async def test_no_fallback_is_recorded_when_the_aum_is_positive(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ctx, batch, _ = await _score(monkeypatch, -900.0, PREFERENCES)

    assert ctx["aum_not_positive"] is False
    assert _fallbacks(batch) == []


async def test_no_fallback_is_recorded_with_an_explicit_zero_ticket(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An explicit zero ticket sizes at 0.10 whatever the AUM: nothing was substituted, so
    nothing is recorded, and the non-positive book scores exactly as the +$100 book."""
    prefs = {"max_weight": 0.1, "target_ticket_size_usd": 0}
    _, batch, non_positive = await _score(monkeypatch, -1500.0, prefs)
    _, _, tiny = await _score(monkeypatch, -900.0, prefs)

    assert _fallbacks(batch) == []
    assert non_positive["score"] == tiny["score"]


async def test_a_missing_ticket_is_the_engine_default_and_is_sized_at_the_ceiling(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """No ticket preference: ``merge_with_defaults`` gives the engine a 50,000 ticket, so the
    non-positive book is sized at the ceiling and records the fallback, like the +$100 book."""
    prefs = {"max_weight": 0.1}
    _, batch, non_positive = await _score(monkeypatch, -1500.0, prefs)
    _, _, tiny = await _score(monkeypatch, -900.0, prefs)

    assert len(_fallbacks(batch)) == 1
    assert _max_weight_score(non_positive) == _max_weight_score(tiny) == 0.0
