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

167.1.1.1 round 3 (CR-01 and SFH-R3-01 under D-23 as amended, D-24, D-25). The book entry names
the sizing the ENGINE USED, decided from ``result["mode"]`` and ``result["candidates"]`` after
``score_candidates`` returns, never from the context alone:

    personalized, candidates, AUM <= 0, ticket > 0   aum_not_positive_ceiling_0_5            0.5   (D-23)
    screening,    candidates, AUM <= 0               aum_not_positive_screening_default_0_10  0.1   (D-25)
    personalized, candidates, AUM unknown, ticket>0  aum_unknown_default_0_10                0.1   (D-24)
    anything with no candidate                       no entry (no candidate was sized)

``_sized_score`` is the independent oracle: the max-weight dimension a persisted ``add_weight``
must reproduce, so a recorded sizing that the score did not use is a failing assertion.
"""

from __future__ import annotations

import json
import logging
import math
from typing import Any
from unittest.mock import MagicMock

import pytest

from routers import match as match_mod
from services.match_engine import score_candidates
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
BOOK_STRATEGY = "strat-book"
PREFERENCES = {"max_weight": 0.1, "target_ticket_size_usd": 50_000}
MAX_WEIGHT_CAP = 0.1  # PREFERENCES["max_weight"], hand-typed


@pytest.fixture(autouse=True)
def _fixed_window(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(match_mod, "_holdings_history_window_start", lambda: "2026-01-01")


def _book(perp_pnl: float) -> list[dict[str, Any]]:
    """BTC worth 1,000 (priced, 119 returns) plus a perp whose unrealized P&L is ``perp_pnl``:
    the matcher AUM is 1,000 + ``perp_pnl``."""
    return _rows("BTC", _adjacent_days(BOOK_DAYS), _btc_mark, 1000.0) + _perp_row(perp_pnl)


def _db(
    rows: list[dict[str, Any]], *, book_allocated_amount: float | None | str = "no-strategy"
) -> FakeDb:
    """``rows`` as the allocator's holdings. ``book_allocated_amount`` adds one book STRATEGY
    with that ``allocated_amount`` (``None`` is an unknown amount); the default adds none."""
    tables: dict[str, list[dict[str, Any]]] = {
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
        "portfolio_strategies": [],
        "strategy_analytics": [],
        "match_decisions": [],
        "allocator_preferences": [],
    }
    if book_allocated_amount != "no-strategy":
        tables["portfolios"] = [{"id": "port-1", "user_id": ALLOCATOR}]
        tables["portfolio_strategies"] = [
            {
                "strategy_id": BOOK_STRATEGY,
                "current_weight": 0.5,
                "portfolio_id": "port-1",
                "allocated_amount": book_allocated_amount,
            }
        ]
        tables["strategy_analytics"] = [
            {
                "strategy_id": BOOK_STRATEGY,
                "returns_series": None,
                "daily_returns": [
                    {"date": day, "value": 0.004 * math.sin(0.9 * i + 0.2)}
                    for i, day in enumerate(_adjacent_days(BOOK_DAYS + 1)[1:])
                ],
                "data_quality_flags": {},
            }
        ]
    return FakeDb(tables)


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


async def _run(
    monkeypatch: pytest.MonkeyPatch,
    db: FakeDb,
    preferences: dict[str, Any],
    universe: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]]]:
    """``(context, batch row, the persisted candidate rows)`` through the real loader, the real
    ``_score_one_allocator`` and so the real ``score_candidates``."""
    monkeypatch.setattr(match_mod, "get_supabase", lambda: db)
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
        ALLOCATOR,
        _universe() if universe is None else universe,
        precomputed_ctx=ctx,
        precomputed_overrides=None,
    )

    (batch,) = inserted["match_batches"]
    candidates = [
        r
        for p in inserted.get("match_candidates", [])
        for r in p
        if r["strategy_id"] == CANDIDATE
    ]
    return ctx, json.loads(json.dumps(batch)), json.loads(json.dumps(candidates))


async def _score(
    monkeypatch: pytest.MonkeyPatch, perp_pnl: float, preferences: dict[str, Any]
) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
    """``(context, batch row, the candidate row)`` for BTC 1,000 plus a perp of ``perp_pnl``."""
    ctx, batch, candidates = await _run(monkeypatch, _db(_book(perp_pnl)), preferences)
    (candidate,) = candidates
    return ctx, batch, candidate


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
    warning = next(r.getMessage() for r in caplog.records if "add_weight_fallback" in r.getMessage())
    assert ALLOCATOR in warning
    assert "aum_not_positive_ceiling_0_5" in warning and "0.5" in warning and "ceiling" in warning
    assert "scoring is unaffected" not in warning
    # The context-time AUM warning no longer asserts a sizing: that is only known after scoring.
    context_warning = next(
        r.getMessage() for r in caplog.records if "match: aum_not_positive" in r.getMessage()
    )
    assert "ceiling" not in context_warning


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


# ---------------------------------------------------------------------------------------------
# Round 3: the record follows what the engine did (CR-01, SFH-R3-01), D-25, D-24.
# ---------------------------------------------------------------------------------------------

THIN_DAYS = 10  # 10 adjacent marked days: BTC is withheld (too few adjacent returns)

D23_ENTRY: dict[str, Any] = {
    "kind": "book",
    "holding_ref": None,
    "add_weight_fallback": "aum_not_positive_ceiling_0_5",
    "add_weight": 0.5,
    "flagged": False,
}
D25_ENTRY: dict[str, Any] = {
    "kind": "book",
    "holding_ref": None,
    "add_weight_fallback": "aum_not_positive_screening_default_0_10",
    "add_weight": 0.1,
    "flagged": False,
}
D24_ENTRY: dict[str, Any] = {
    "kind": "book",
    "holding_ref": None,
    "add_weight_fallback": "aum_unknown_default_0_10",
    "add_weight": 0.1,
    "flagged": False,
}


def _sized_score(add_weight: float) -> float:
    """The max-weight dimension an ``add_weight`` scores at ``max_weight`` 0.1, independently of
    the engine: 1.0 up to the cap, then a linear taper to 0.0 over one more cap."""
    return max(0.0, 1.0 - max(0.0, add_weight - MAX_WEIGHT_CAP) / MAX_WEIGHT_CAP)


def _screening_book() -> list[dict[str, Any]]:
    """BTC 1,000 on only 10 adjacent days (withheld, so no priced spot holding and no strategy)
    plus a perp at -1,500: the matcher AUM is -500 and the engine runs in SCREENING mode."""
    return _rows("BTC", _adjacent_days(THIN_DAYS), _btc_mark, 1000.0) + _perp_row(-1500.0)


def _no_candidate_universe() -> dict[str, Any]:
    return {"strategies_by_id": {}, "returns_by_id": {}}


async def test_a_screening_book_with_a_non_positive_aum_records_no_ceiling_entry(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """CR-01 / SFH-R3-01. The engine ignores the AUM in screening mode and sizes at 0.10. The
    batch must not say 0.5, and the log must not either; the persisted score (max-weight 1.0 =
    add_weight 0.10) and the persisted record agree."""
    with caplog.at_level(logging.WARNING, logger=match_mod.logger.name):
        ctx, batch, candidates = await _run(monkeypatch, _db(_screening_book()), PREFERENCES)
    (candidate,) = candidates

    assert ctx["portfolio_strategies"] == [] and ctx["aum_not_positive"] is True
    assert batch["mode"] == "screening"
    assert not [e for e in batch["holding_flags"] if e.get("add_weight_fallback") == "aum_not_positive_ceiling_0_5"]
    assert not [r for r in caplog.records if "aum_not_positive_ceiling_0_5" in r.getMessage()]
    (entry,) = _fallbacks(batch)
    assert _max_weight_score(candidate) == _sized_score(entry["add_weight"]) == 1.0


async def test_a_personalized_book_with_no_candidate_records_no_entry(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """SFH-R3-01, the early return: the engine ran personalized but returned no candidate, so
    nothing was sized at 0.5. No entry, no add_weight_fallback WARNING."""
    with caplog.at_level(logging.WARNING, logger=match_mod.logger.name):
        ctx, batch, candidates = await _run(
            monkeypatch, _db(_book(-1500.0)), PREFERENCES, _no_candidate_universe()
        )

    assert ctx["aum_not_positive"] is True and batch["mode"] == "personalized"
    assert candidates == [] and batch["candidate_count"] == 0
    assert _fallbacks(batch) == []
    assert not [r for r in caplog.records if "add_weight_fallback" in r.getMessage()]


async def test_the_persisted_add_weight_is_the_sizing_the_score_used_in_personalized_mode(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, batch, candidate = await _score(monkeypatch, -1500.0, PREFERENCES)

    (entry,) = _fallbacks(batch)
    assert entry == D23_ENTRY
    assert _max_weight_score(candidate) == _sized_score(entry["add_weight"]) == 0.0


async def test_d25_a_screening_book_with_a_non_positive_aum_names_the_default_sizing(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """D-25. The book keeps the 0.10 sizing every screening book gets; the batch names it with
    the exact shape, and a named WARNING says it was the screening default."""
    with caplog.at_level(logging.WARNING, logger=match_mod.logger.name):
        _, batch, candidates = await _run(monkeypatch, _db(_screening_book()), PREFERENCES)

    assert batch["mode"] == "screening"
    assert _fallbacks(batch) == [D25_ENTRY]
    assert _max_weight_score(candidates[0]) == _sized_score(D25_ENTRY["add_weight"])
    warning = next(r.getMessage() for r in caplog.records if "add_weight_fallback" in r.getMessage())
    assert "aum_not_positive_screening_default_0_10" in warning and ALLOCATOR in warning
    assert "screening" in warning and "ceiling" not in warning


async def test_d25_does_not_depend_on_the_ticket_and_needs_a_candidate(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Screening sizing is 0.10 whatever the ticket, so a zero ticket still names it. With no
    candidate, no candidate was sized, so nothing is named."""
    _, zero_ticket, _ = await _run(
        monkeypatch, _db(_screening_book()), {"max_weight": 0.1, "target_ticket_size_usd": 0}
    )
    assert _fallbacks(zero_ticket) == [D25_ENTRY]

    _, empty, _ = await _run(
        monkeypatch, _db(_screening_book()), PREFERENCES, _no_candidate_universe()
    )
    assert empty["mode"] == "screening" and _fallbacks(empty) == []


async def test_d24_an_unknown_aum_keeps_the_default_sizing_and_names_it(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """D-24. A strategies-only book whose every ``allocated_amount`` is missing has an unknown
    AUM. The engine's 0.10 default stands (scores do not change: the engine is handed the AUM
    ``None`` it always was, not a substitute), and the batch names the fallback."""
    seen_aum: list[Any] = []
    real_score = score_candidates

    def _spy(**kwargs: Any) -> Any:
        seen_aum.append(kwargs["portfolio_aum"])
        return real_score(**kwargs)

    monkeypatch.setattr("routers.match.score_candidates", _spy)
    with caplog.at_level(logging.WARNING, logger=match_mod.logger.name):
        ctx, batch, (candidate,) = await _run(
            monkeypatch, _db([], book_allocated_amount=None), PREFERENCES
        )

    assert ctx["portfolio_aum"] is None and ctx["aum_not_positive"] is False
    assert batch["mode"] == "personalized"
    assert _fallbacks(batch) == [D24_ENTRY]
    assert _max_weight_score(candidate) == _sized_score(D24_ENTRY["add_weight"]) == 1.0
    warning = next(r.getMessage() for r in caplog.records if "add_weight_fallback" in r.getMessage())
    assert "aum_unknown_default_0_10" in warning and ALLOCATOR in warning
    assert seen_aum == [None], "the scoring call is unchanged: no AUM substituted for D-24"


async def test_d24_records_nothing_when_nothing_was_defaulted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A known AUM, an explicit zero ticket (0.10 whatever the AUM), no candidate, and a book
    with no portfolio at all (screening, nothing to size against) each record no D-24 entry."""
    _, known, _ = await _run(monkeypatch, _db([], book_allocated_amount=10_000.0), PREFERENCES)
    assert known["mode"] == "personalized" and _fallbacks(known) == []

    _, zero_ticket, _ = await _run(
        monkeypatch,
        _db([], book_allocated_amount=None),
        {"max_weight": 0.1, "target_ticket_size_usd": 0},
    )
    assert _fallbacks(zero_ticket) == []

    _, empty, _ = await _run(
        monkeypatch, _db([], book_allocated_amount=None), PREFERENCES, _no_candidate_universe()
    )
    assert empty["mode"] == "personalized" and _fallbacks(empty) == []

    _, no_book, _ = await _run(monkeypatch, _db([]), PREFERENCES)
    assert no_book["mode"] == "screening" and _fallbacks(no_book) == []
