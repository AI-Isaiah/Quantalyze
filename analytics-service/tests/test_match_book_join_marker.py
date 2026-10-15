"""167.1.1.1 (BRIDGERETURNS) D-22 (founder, review WR-02): a book whose shared-days join is
too short is NAMED, and no holding is withheld to fit it.

``score_candidates`` joins the book's series on the days they ALL carry a return. Two spot
holdings that each have 40 adjacent one-day returns, on disjoint calendars, both pass the
per-holding gate and still share zero days: the portfolio-fit axis goes null and every
correlation-ceiling test is skipped. D-22 keeps both holdings named in ``holding_flags`` and
adds ONE book-level entry, ``book_join_marker``, so the cause is not silent. There is no
migration: ``match_batches`` has no free JSONB except ``holding_flags``.

Every date, mark and count below is typed by hand.
"""

from __future__ import annotations

import json
import logging
from typing import Any
from unittest.mock import MagicMock

import pandas as pd
import pytest

from routers import match as match_mod
from tests.fake_postgrest import FakeDb
from tests.test_match_holding_returns import (
    ALLOCATOR,
    BTC,
    END,
    USDT,
    _db,
    _history,
    _key,
)

ETH = "holding:binance:ETH:spot"

# 41 adjacent daily marks = 40 one-day returns, above the per-holding gate of 30 (D-20).
MARKS_41 = [100.0 + i + (3.0 if i % 2 else 0.0) for i in range(41)]


@pytest.fixture(autouse=True)
def _fixed_window(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(match_mod, "_holdings_history_window_start", lambda: "2026-01-01")


async def _persisted_flags(monkeypatch: pytest.MonkeyPatch, db: FakeDb) -> list[dict[str, Any]]:
    """Run the real context load and the real ``_score_one_allocator`` and return the
    ``holding_flags`` it inserts, after a JSON round trip (what the database receives)."""
    monkeypatch.setattr(match_mod, "get_supabase", lambda: db)
    ctx = match_mod._load_allocator_context(ALLOCATOR)

    import services.feedback_engine as feedback_engine

    monkeypatch.setattr(feedback_engine, "compute_adjusted_weights", lambda allocator_id: None)
    monkeypatch.setattr(match_mod, "_load_allocator_context", lambda allocator_id: ctx)
    monkeypatch.setattr(
        match_mod,
        "score_candidates",
        lambda **kwargs: {
            "candidates": [],
            "excluded": [],
            "excluded_total": 0,
            "mode": "personalized",
            "filter_relaxed": False,
            "effective_preferences": {},
            "effective_thresholds": {},
            "source_strategy_count": 0,
        },
    )
    inserted: list[dict[str, Any]] = []

    def _insert(payload: dict[str, Any]) -> Any:
        inserted.append(payload)
        return MagicMock(execute=lambda: MagicMock(data=[{"id": "batch-1"}]))

    supabase = MagicMock()
    supabase.table.return_value.insert = _insert
    monkeypatch.setattr(match_mod, "get_supabase", lambda: supabase)

    class _NoConversion:
        async def convert(self, series: Any, units: Any) -> tuple[Any, Any]:
            return series, {}

    universe = {"strategies_by_id": {}, "returns_by_id": {}, "_usd_converter": _NoConversion()}
    await match_mod._score_one_allocator(ALLOCATOR, universe)

    (batch,) = [p for p in inserted if "holding_flags" in p]
    flags: list[dict[str, Any]] = json.loads(json.dumps(batch["holding_flags"]))
    return flags


def _markers(flags: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [e for e in flags if e.get("kind") == "book"]


async def test_two_holdings_on_disjoint_calendars_give_the_marker_and_stay_named(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """BTC was held for 41 days ending 2026-08-01 and bought again on END (the account's newest
    day, so it is a current holding); ETH has 41 adjacent days ending on END. Each has 40
    adjacent returns, and no day is shared. Neither is withheld (both stay eligible entries),
    and the batch carries one book entry."""
    db = _db(
        _history("key-a", "binance", "BTC", MARKS_41, 10000.0, end="2026-08-01")
        + _history("key-a", "binance", "BTC", [MARKS_41[-1]], 10000.0, end=END)
        + _history("key-a", "binance", "ETH", MARKS_41, 5000.0, end=END),
    )

    with caplog.at_level(logging.WARNING, logger=match_mod.logger.name):
        flags = await _persisted_flags(monkeypatch, db)

    assert _markers(flags) == [
        {
            "kind": "book",
            "holding_ref": None,
            "book_join_too_short": True,
            "shared_days": 0,
            "min_days": 30,
            "flagged": False,
        }
    ]
    by_ref = {e["holding_ref"]: e for e in flags if e.get("kind") != "book"}
    assert set(by_ref) == {BTC, ETH}, "no holding is withheld to fit the overlap"
    assert "withheld_reason" not in by_ref[BTC] and "withheld_reason" not in by_ref[ETH]
    assert by_ref[BTC]["weight"] == pytest.approx(10000 / 15000)
    assert by_ref[ETH]["weight"] == pytest.approx(5000 / 15000)
    assert "book_join_too_short" in caplog.text and ALLOCATOR in caplog.text


async def test_an_overlapping_book_gets_no_marker(monkeypatch: pytest.MonkeyPatch) -> None:
    """Control: the same two holdings on one calendar share 40 days, so no marker."""
    db = _db(
        _history("key-a", "binance", "BTC", MARKS_41, 10000.0)
        + _history("key-a", "binance", "ETH", MARKS_41, 5000.0),
    )

    flags = await _persisted_flags(monkeypatch, db)

    assert _markers(flags) == []
    assert {e["holding_ref"] for e in flags} == {BTC, ETH}


async def test_a_book_with_no_series_gets_no_marker(monkeypatch: pytest.MonkeyPatch) -> None:
    """No series at all (here a lone withheld stablecoin): there is no join to be too short.
    The batch carries the holding's own entry and no book entry."""
    db = _db(_history("key-a", "binance", "USDT", [1.0] * 31, 5000.0), keys=[_key("key-a")])

    flags = await _persisted_flags(monkeypatch, db)

    assert [e["holding_ref"] for e in flags] == [USDT]
    assert flags[0]["withheld_reason"] == "fixed_price"
    assert _markers(flags) == []


def _series(days: int) -> pd.Series:
    index = [f"2026-09-{d:02d}" for d in range(1, days + 1)]
    return pd.Series([0.01] * days, index=index, dtype=float)


def test_the_marker_boundary_is_thirty_shared_days() -> None:
    """30 shared days are enough (the engine's min_overlap_days); 29 are not."""
    assert match_mod.book_join_marker({"a": _series(30), "b": _series(30)}, allocator_id="x") is None

    marker = match_mod.book_join_marker({"a": _series(29), "b": _series(29)}, allocator_id="x")

    assert marker is not None
    assert marker["shared_days"] == 29
    assert match_mod.book_join_marker({}, allocator_id="x") is None, "no series, no join"
