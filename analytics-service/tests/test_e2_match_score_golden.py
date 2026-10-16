"""Phase 115 (E2) Wave-0, rewritten by 167.1.1.1 (BRIDGERETURNS) — match.py score golden.

WHAT CHANGED AND WHAT THIS PROVES NOW:
    Until 167.1.1.1 match.py built each holding's return series from the dollar value
    in the per-day breakdown of the stored equity snapshots. It now builds it from the holding's daily
    MARK PRICE (``allocator_holdings.mark_price``, through ``classify_spot_marks``). This
    golden feeds marks EQUAL to the values the old breakdown carried (``round(start * 1.01**i,
    4)``) while the holdings' ``value_usd`` stays constant on every day, so the dollar path no
    longer drives anything. The committed JSON is NOT regenerated: it is byte-identical to
    the phase base. That is the proof that the score is unchanged where the inputs are equal,
    and that the only thing the phase changed is which number a return is taken from.

    It is still a byte-stable tripwire, not a correctness proof of the derivation. The
    independent oracle for the new rule is ``test_match_holding_returns.py`` (hand-typed
    marks, a purchase at a constant mark, tenant and page-ceiling guards).

Tests:
- Test 1: _load_allocator_context per-holding series + weights + aum exact
  (assert_series_equal check_exact=True; dict/float eq). Independent re-derivation
  of the expected series from the MARKS with bare pandas.
- Test 2: score_candidates full output == committed JSON golden, string-equal, no
  tolerance (ENGINE_VERSION / WEIGHTS_VERSION embedded so a legit version bump
  regenerates via UPDATE_GOLDEN=1).
- Test 3: regeneration guard — UPDATE_GOLDEN=1 rewrites the JSON and FAILS loud so
  a regen never silently passes in CI.

All tests are plain `def` (NOT async) per finding f1: _load_allocator_context is a
synchronous plain def, called without await.
"""
from __future__ import annotations

import json
import math
import os
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import pytest

from routers.match import _load_allocator_context
from services.match_engine import ENGINE_VERSION, WEIGHTS_VERSION, score_candidates
from tests._returns_fixtures import production_series
from tests.fake_postgrest import FakeDb

GOLDEN_PATH = Path(__file__).parent / "fixtures" / "e2_match_score_golden.json"
_REGEN_MSG = "golden regenerated, rerun without UPDATE_GOLDEN=1"


# ---------------------------------------------------------------------------
# The single canonical fixture (holdings with mark history + candidates)
# ---------------------------------------------------------------------------

_N_DAYS = 41  # -> 40 daily returns per symbol (>= 30 warm-up gate)
_BTC_START = 50000.0
_ETH_START = 30000.0
_DAILY = 0.01
_FIRST_DAY = date(2026, 1, 1)
_ALLOCATOR = "alloc-golden"


def _fixture_marks() -> dict[str, list[tuple[str, float]]]:
    """41 adjacent days of mark prices per symbol, equal to the values the old breakdown
    snapshots carried on each day (geometric compounding, rounded to 4 decimals)."""
    start = {"BTC": _BTC_START, "ETH": _ETH_START}
    return {
        sym: [
            ((_FIRST_DAY + timedelta(days=i)).isoformat(), round(first * (1 + _DAILY) ** i, 4))
            for i in range(_N_DAYS)
        ]
        for sym, first in start.items()
    }


def _fixture_db() -> FakeDb:
    """One key, 41 daily rows per symbol. value_usd is the SAME on every day, so the dollar
    path carries no information and only the marks can produce a return."""
    rows = [
        {
            "allocator_id": _ALLOCATOR, "api_key_id": "key-a", "venue": "binance",
            "symbol": sym, "holding_type": "spot", "side": "flat",
            "value_usd": value, "mark_price": mark, "asof": day,
            "updated_at": f"{day}T04:00:00+00:00",
        }
        for sym, value in (("BTC", _BTC_START), ("ETH", _ETH_START))
        for day, mark in _fixture_marks()[sym]
    ]
    return FakeDb({
        "api_keys": [{"id": "key-a", "user_id": _ALLOCATOR, "exchange": "binance"}],
        "allocator_holdings": rows,
    })


def _expected_symbol_series(symbol: str) -> pd.Series:
    """Independent re-derivation (bare pandas) of the per-symbol return series from the
    marks — deliberately NOT calling classify_spot_marks so the assertion has teeth."""
    marks = _fixture_marks()[symbol]
    # A DatetimeIndex, like every series production joins (CR-01, round 2); built here with
    # bare pandas, not through the converter under test.
    return pd.Series(
        [mark for _, mark in marks], index=pd.DatetimeIndex([day for day, _ in marks]), name=symbol
    ).pct_change().dropna()


def _fixture_candidates() -> tuple[list[dict], dict[str, pd.Series]]:
    """6 eligible candidates (>= RELAXATION_MIN_CANDIDATES=5 so relaxation does NOT
    fire — the full personalized scoring path runs). Candidate return series share
    the holdings' asof index so the correlation math is non-trivial + deterministic."""
    idx = [day for day, _ in _fixture_marks()["BTC"]][1:]  # 40 return days (post-pct_change)
    n = len(idx)
    candidates: list[dict] = []
    returns: dict[str, pd.Series] = {}
    # Deterministic, distinct per-candidate return paths (sine-ish, fixed).
    for k in range(6):
        sid = f"cand-{k}"
        candidates.append({
            "strategy_id": sid,
            "sharpe": 1.5 + 0.1 * k,
            "track_record_days": 400,
            "max_drawdown_pct": -0.12 - 0.01 * k,
            "manager_aum": 5_000_000 + 250_000 * k,
            "exchange": "binance",
            "strategy_type": "trend_following",
        })
        vals = [round(0.002 * math.sin((i + k) * 0.4) + 0.0005 * k, 8) for i in range(n)]
        returns[sid] = production_series(idx, vals, name=sid)
    return candidates, returns


# ---------------------------------------------------------------------------
# JSON-safe serialization for a byte-stable golden
# ---------------------------------------------------------------------------

def _jsonify(obj: Any) -> Any:
    """Recursively coerce numpy scalars -> python, non-finite -> None, so the
    golden is valid JSON and stable across runs."""
    if isinstance(obj, dict):
        return {str(k): _jsonify(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_jsonify(v) for v in obj]
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        obj = float(obj)
    if isinstance(obj, float):
        if not math.isfinite(obj):
            return None
        # Round to 10 sig-figs of decimals so cross-platform float64 formatting
        # noise cannot flip the byte-compare while real score changes still trip it.
        return round(obj, 10)
    if isinstance(obj, (np.bool_,)):
        return bool(obj)
    return obj


def _dumps(obj: Any) -> str:
    return json.dumps(_jsonify(obj), sort_keys=True, indent=2)


def _compute_score_result(monkeypatch: pytest.MonkeyPatch) -> dict:
    sb = _fixture_db()
    monkeypatch.setattr("routers.match.get_supabase", lambda: sb)
    # The fixture calendar is fixed in 2026-01/02; pin the history window to include it.
    monkeypatch.setattr("routers.match._holdings_history_window_start", lambda: "2025-12-31")
    ctx = _load_allocator_context(_ALLOCATOR)

    candidates, cand_returns = _fixture_candidates()
    return score_candidates(
        allocator_id=_ALLOCATOR,
        preferences=None,
        portfolio_strategies=ctx["portfolio_strategies"],
        portfolio_returns=ctx["portfolio_returns"],
        portfolio_weights=ctx["portfolio_weights"],
        candidate_strategies=candidates,
        candidate_returns=cand_returns,
        portfolio_aum=ctx["portfolio_aum"],
    )


def _load_or_regen_golden(path: Path, actual_str: str) -> str:
    """Return the committed golden string, OR (UPDATE_GOLDEN=1) rewrite it and
    RAISE so a regen never silently passes CI (Rule 12: fail loud)."""
    if os.environ.get("UPDATE_GOLDEN") == "1":
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(actual_str + "\n")
        raise RuntimeError(f"{_REGEN_MSG} ({path})")
    return path.read_text().rstrip("\n")


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_load_allocator_context_series_and_weights_exact(monkeypatch):
    """Test 1: per-holding series (exact), weights, aum, warm-up survivor count."""
    sb = _fixture_db()
    monkeypatch.setattr("routers.match.get_supabase", lambda: sb)
    monkeypatch.setattr("routers.match._holdings_history_window_start", lambda: "2025-12-31")

    ctx = _load_allocator_context(_ALLOCATOR)  # sync — no await

    # Two holdings are priced (41 daily marks -> 40 adjacent returns each).
    pseudo_ids = {ps["strategy_id"] for ps in ctx["portfolio_strategies"]}
    assert pseudo_ids == {"holding:binance:BTC:spot", "holding:binance:ETH:spot"}

    # Weights: value_usd / total (50000/80000, 30000/80000) — exact float arithmetic.
    assert ctx["portfolio_weights"]["holding:binance:BTC:spot"] == pytest.approx(0.625, abs=0.0)
    assert ctx["portfolio_weights"]["holding:binance:ETH:spot"] == pytest.approx(0.375, abs=0.0)
    assert abs(sum(ctx["portfolio_weights"].values()) - 1.0) < 1e-12
    assert ctx["portfolio_aum"] == pytest.approx(80000.0)

    # Series byte-stable vs an INDEPENDENT bare-pandas re-derivation (teeth).
    for sym, pid in (("BTC", "holding:binance:BTC:spot"), ("ETH", "holding:binance:ETH:spot")):
        expected = _expected_symbol_series(sym)
        expected.name = pid
        got = ctx["portfolio_returns"][pid].copy()
        got.name = pid
        pd.testing.assert_series_equal(got, expected, check_exact=True)
        assert len(got) == _N_DAYS - 1 == 40


def test_score_candidates_matches_committed_golden(monkeypatch):
    """Test 2: full score_candidates output == committed JSON golden, exact string."""
    result = _compute_score_result(monkeypatch)

    # Version pins live IN the compared payload — a legit bump forces UPDATE_GOLDEN.
    assert result["engine_version"] == ENGINE_VERSION
    assert result["weights_version"] == WEIGHTS_VERSION
    assert result["mode"] == "personalized"
    assert result["filter_relaxed"] is False  # 6 eligible >= relaxation floor

    actual_str = _dumps(result)
    golden_str = _load_or_regen_golden(GOLDEN_PATH, actual_str)
    assert actual_str == golden_str, (
        "score_candidates output diverged from the committed golden. If this is an "
        "INTENTIONAL change (version bump / deliberate scoring edit), regenerate with "
        "UPDATE_GOLDEN=1. If NOT, a shared-code edit accidentally perturbed match.py — "
        "investigate before regenerating."
    )


def test_update_golden_regen_guard_fails_loud(monkeypatch, tmp_path):
    """Test 3: UPDATE_GOLDEN=1 writes the file AND raises so a regen never silently
    passes in CI. Uses a tmp path so the real golden is never clobbered here."""
    monkeypatch.setenv("UPDATE_GOLDEN", "1")
    tmp_golden = tmp_path / "golden.json"
    with pytest.raises(RuntimeError, match="golden regenerated"):
        _load_or_regen_golden(tmp_golden, '{"x": 1}')
    # The file WAS written despite the raise (so a deliberate regen persists).
    assert tmp_golden.exists()
    assert json.loads(tmp_golden.read_text()) == {"x": 1}
