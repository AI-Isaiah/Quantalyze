"""194.1 plan 12 (B5): the match engine's "Sharpe X" reason follows the card's record verdict.

`/recommendations` and the admin match queue print the engine's reasons beside the card's
figures. Plan 07 dashes a Sharpe whose TOTAL record is under D-15's minimum, so a reason line
reading "Strong risk-adjusted return (Sharpe 2.5)" under it would print the figure the card
withholds. The resolution (194.1-CONTEXT.md, `2026-11-08 - planning resolutions`, item
Match-reason prose) leaves the sentence out when the record is withheld.

The loader reads the four stored record scalar aliases (`RECORD_SCALAR_ALIASES`), builds the
record with `figure_record_from_scalars`, and writes it on the candidate dict as
`sharpe_record`. `_generate_reasons` judges it with `record_clears`. These tests go loader to
reason, so a select that loses an alias, a loader that stops copying the record, or an engine
that stops reading it each turns a case RED.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any

import pytest

from routers import match as match_mod
from services.match_engine import _generate_reasons
from services.metrics import RECORD_SCALAR_ALIASES
from tests.fake_postgrest import FakeDb, FakeQuery


def _split_select(select: str) -> list[str]:
    """Split a PostgREST select list on top-level commas (an embed's own commas stay inside)."""
    parts: list[str] = []
    depth = 0
    cur = ""
    for ch in select:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            parts.append(cur.strip())
            cur = ""
        else:
            cur += ch
    if cur.strip():
        parts.append(cur.strip())
    return parts


class _CapturingQuery(FakeQuery):
    """A FakeQuery that records every select string it was given, per table."""

    def __init__(self, db: "_CapturingDb", name: str) -> None:
        super().__init__(db, name)
        self._capture = db

    def select(self, *args: Any, **kwargs: Any) -> "_CapturingQuery":
        if args:
            self._capture.selects.setdefault(self._name, []).append(args[0])
        return self


class _CapturingDb(FakeDb):
    def __init__(self, tables: dict[str, list[dict[str, Any]]]) -> None:
        super().__init__(tables)
        self.selects: dict[str, list[str]] = {}

    def table(self, name: str) -> FakeQuery:
        return _CapturingQuery(self, name)


def _strategy(sid: str, asset_class: str) -> dict[str, Any]:
    return {
        "id": sid,
        "name": f"Strategy {sid}",
        "codename": None,
        "strategy_types": ["systematic"],
        "subtypes": [],
        "supported_exchanges": ["binance"],
        "status": "published",
        "aum": 0,
        "max_capacity": 0,
        "user_id": "manager-1",
        "start_date": "2024-01-01",
        "is_example": False,
        "asset_class": asset_class,
    }


def _analytics(
    sid: str,
    *,
    series_start: str | None,
    series_end: str | None,
    observations: Any,
    headline_since: str | None = None,
    sharpe: float | None = 2.5,
) -> dict[str, Any]:
    """An analytics row as PostgREST returns it AFTER the alias projection."""
    return {
        "strategy_id": sid,
        "sharpe": sharpe,
        "max_drawdown": -0.2,
        "series_start": series_start,
        "series_end": series_end,
        "headline_since": headline_since,
        "record_observations": observations,
    }


def _load(
    monkeypatch: pytest.MonkeyPatch,
    strategies: list[dict[str, Any]],
    analytics: list[dict[str, Any]],
) -> tuple[dict[str, dict[str, Any]], _CapturingDb]:
    db = _CapturingDb({"strategies": strategies, "strategy_analytics": analytics})
    monkeypatch.setattr(match_mod, "get_supabase", lambda: db)
    universe = match_mod._load_candidate_universe()
    return universe["strategies_by_id"], db


def _reasons_of(cand: dict[str, Any]) -> list[str]:
    return _generate_reasons(cand, {}, {"raw": {}}, "screening")


def _span(first: str, last: str) -> int:
    """Covered days, both ends counted (194 D-20), computed from the fixture's own dates."""
    return (date.fromisoformat(last) - date.fromisoformat(first)).days + 1


def _day_after(first: str, covered_days: int) -> str:
    """The last day of a record covering `covered_days` days from `first`."""
    return (date.fromisoformat(first) + timedelta(days=covered_days - 1)).isoformat()


def _sharpe_lines(reasons: list[str]) -> list[str]:
    return [r for r in reasons if "Sharpe" in r]


# ---------------------------------------------------------------------------
# Loader: the select
# ---------------------------------------------------------------------------


def test_analytics_select_names_every_alias_and_no_whole_metrics_json(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, db = _load(monkeypatch, [_strategy("s1", "crypto")], [])
    selects = db.selects["strategy_analytics"]
    assert selects, "the analytics select must have fired"
    entries = _split_select(selects[0])
    for alias in _split_select(RECORD_SCALAR_ALIASES):
        assert alias in entries, f"alias {alias!r} missing from the analytics select"
    # The columns it named before are all still read.
    for column in (
        "strategy_id", "returns_series", "daily_returns", "sharpe", "max_drawdown",
        "data_quality_flags",
    ):
        assert column in entries
    # T-194.1-31: only the one key path of metrics_json, never the whole column.
    assert "metrics_json" not in entries


# ---------------------------------------------------------------------------
# Loader to reason
# ---------------------------------------------------------------------------


def test_forty_day_crypto_record_is_withheld_and_its_reason_omitted(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    first = "2026-01-01"
    last = _day_after(first, 40)
    assert _span(first, last) == 40
    by_id, _ = _load(
        monkeypatch,
        [_strategy("s1", "crypto")],
        [_analytics("s1", series_start=first, series_end=last, observations=40)],
    )
    cand = by_id["s1"]
    assert cand["sharpe_record"] == {"span_days": 40, "observations": 40, "crypto": True}
    assert cand["sharpe"] == 2.5  # the stored figure is untouched
    assert not _sharpe_lines(_reasons_of(cand))
    assert not [r for r in _reasons_of(cand) if "Sharpe 2.5" in r]


def test_record_past_one_year_keeps_the_sentence_word_for_word(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    first = "2026-01-01"
    last = "2027-01-05"
    assert _span(first, last) > 365
    by_id, _ = _load(
        monkeypatch,
        [_strategy("s1", "crypto")],
        [_analytics("s1", series_start=first, series_end=last, observations=370)],
    )
    cand = by_id["s1"]
    assert cand["sharpe_record"]["span_days"] == _span(first, last)
    assert "Strong risk-adjusted return (Sharpe 2.5)" in _reasons_of(cand)


# ---------------------------------------------------------------------------
# Task 2: non-crypto, unknown, unreadable, legacy and no-analytics shapes
# ---------------------------------------------------------------------------


def test_traditional_59_observations_over_120_days_is_withheld(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    first = "2026-01-01"
    last = _day_after(first, 120)
    by_id, _ = _load(
        monkeypatch,
        [_strategy("s1", "traditional")],
        [_analytics("s1", series_start=first, series_end=last, observations=59)],
    )
    cand = by_id["s1"]
    assert cand["sharpe_record"] == {"span_days": 120, "observations": 59, "crypto": False}
    assert not _sharpe_lines(_reasons_of(cand))


def test_traditional_62_observations_over_89_days_is_kept_and_crypto_would_not_be(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    first = "2026-01-01"
    last = _day_after(first, 89)
    row = _analytics("s1", series_start=first, series_end=last, observations=62)
    by_id, _ = _load(monkeypatch, [_strategy("s1", "traditional")], [row])
    cand = by_id["s1"]
    assert cand["sharpe_record"] == {"span_days": 89, "observations": 62, "crypto": False}
    assert "Strong risk-adjusted return (Sharpe 2.5)" in _reasons_of(cand)

    # The same row read as crypto is under the crypto minimum, so it is withheld: the class
    # decides the rule, not the count alone.
    by_id_crypto, _ = _load(monkeypatch, [_strategy("s1", "crypto")], [row])
    assert not _sharpe_lines(_reasons_of(by_id_crypto["s1"]))


def test_cleared_record_under_one_year_keeps_todays_exact_text_with_no_qualifier(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    first = "2026-01-01"
    last = _day_after(first, 200)
    by_id, _ = _load(
        monkeypatch,
        [_strategy("s1", "crypto")],
        [_analytics("s1", series_start=first, series_end=last, observations=200)],
    )
    reasons = _reasons_of(by_id["s1"])
    assert "Strong risk-adjusted return (Sharpe 2.5)" in reasons
    assert [r for r in reasons if "Sharpe" in r] == ["Strong risk-adjusted return (Sharpe 2.5)"]


def test_absent_series_bounds_is_unknown_and_keeps_the_sentence(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    by_id, _ = _load(
        monkeypatch,
        [_strategy("s1", "crypto")],
        [_analytics("s1", series_start="2026-01-01", series_end=None, observations=None)],
    )
    cand = by_id["s1"]
    assert cand["sharpe_record"] == {"span_days": None, "observations": None, "crypto": True}
    # 194 D-17: an unknown record is not reinterpreted as withheld.
    assert "Strong risk-adjusted return (Sharpe 2.5)" in _reasons_of(cand)


def test_unreadable_series_start_is_flagged_and_withheld(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    by_id, _ = _load(
        monkeypatch,
        [_strategy("s1", "crypto")],
        [_analytics("s1", series_start="2026-13-01", series_end="2027-06-01", observations=500)],
    )
    cand = by_id["s1"]
    # The span reads None (so record_clears is None); only the flag withholds it.
    assert cand["sharpe_record"]["span_days"] is None
    assert cand["sharpe_record"]["unreadable"] is True
    assert not _sharpe_lines(_reasons_of(cand))


def test_hand_built_candidate_without_a_record_keeps_the_sentence() -> None:
    cand: dict[str, Any] = {"strategy_id": "s1", "sharpe": 2.5, "track_record_days": 0}
    assert "sharpe_record" not in cand
    assert "Strong risk-adjusted return (Sharpe 2.5)" in _reasons_of(cand)


def test_non_dict_record_is_not_withheld() -> None:
    cand: dict[str, Any] = {"strategy_id": "s1", "sharpe": 2.5, "sharpe_record": "garbage"}
    assert "Strong risk-adjusted return (Sharpe 2.5)" in _reasons_of(cand)


def test_strategy_with_no_analytics_row_gets_an_all_absent_record_and_no_sentence(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    by_id, _ = _load(monkeypatch, [_strategy("s1", "crypto")], [])
    cand = by_id["s1"]
    assert cand["sharpe"] is None
    assert cand["sharpe_record"] == {"span_days": None, "observations": None, "crypto": True}
    assert not _sharpe_lines(_reasons_of(cand))


def test_withheld_record_changes_no_reason_but_the_sharpe_sentence(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The gate drops one sentence and nothing else: the other reasons are identical."""
    first = "2026-01-01"
    short_by_id, _ = _load(
        monkeypatch,
        [_strategy("s1", "crypto")],
        [_analytics("s1", series_start=first, series_end=_day_after(first, 40), observations=40)],
    )
    legacy = {k: v for k, v in short_by_id["s1"].items() if k != "sharpe_record"}
    with_record = [r for r in _reasons_of(short_by_id["s1"])]
    without_record = [r for r in _reasons_of(legacy)]
    assert [r for r in without_record if r not in with_record] == [
        "Strong risk-adjusted return (Sharpe 2.5)"
    ]
    assert [r for r in with_record if r not in without_record] == []
