"""Phase 115 (E2) Wave-0 — match.py score golden: CHEAP INSURANCE, not correctness proof.

⚠️ HONEST FRAMING (read this before trusting the golden):
    match.py's input path is UNCHANGED in Phase 115. The scope gate did NOT clear
    (see 115-STITCH-02-DEFERRAL.md) — the `allocator_equity_snapshots` store, its
    `breakdown` column, and `reconstruct_symbol_returns` all stay exactly as they
    are. This golden therefore CANNOT go red from any Phase-115 edit to the new
    additive derivation path.

    So what is it FOR? It is a byte-stable tripwire against ACCIDENTAL perturbation
    of the shared code match.py depends on — e.g. if `reconstruct_symbol_returns`
    moves file, if `equity_reconstruction.py` internals shift, or if the match
    engine's scoring math is touched as a drive-by. If any of those changes the
    match output, this golden fails loud and forces an intentional regeneration.

    It is NOT evidence that the new per-key blend / $-equity derivation is correct.
    That correctness is proven by the INDEPENDENT pandas oracle in plan 115-05
    (test_e2_parity_oracle.py) — the 114-01/111-01 re-derivation pattern. Do not
    cite this golden as a derivation-correctness gate.

Tests:
- Test 1: _load_allocator_context per-holding series + weights + aum exact
  (assert_series_equal check_exact=True; dict/float eq). Independent re-derivation
  of the expected series with bare pandas (not calling reconstruct_symbol_returns).
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
from unittest.mock import MagicMock

import numpy as np
import pandas as pd
import pytest

from routers.match import _load_allocator_context
from services.match_engine import ENGINE_VERSION, WEIGHTS_VERSION, score_candidates

GOLDEN_PATH = Path(__file__).parent / "fixtures" / "e2_match_score_golden.json"
_REGEN_MSG = "golden regenerated, rerun without UPDATE_GOLDEN=1"


# ---------------------------------------------------------------------------
# Self-contained mock-supabase builder (copied from test_match_integration_phase09
# — test files stay self-contained; do not import across test modules).
# ---------------------------------------------------------------------------

def _make_multi_symbol_snapshots(
    days: int, symbols: dict[str, float], daily_return: float = 0.01,
) -> list[dict]:
    """N days of breakdown snapshots covering multiple symbols, geometric compounding."""
    base = date(2026, 1, 1)
    snapshots: list[dict] = []
    values = dict(symbols)
    for i in range(days):
        d = base + timedelta(days=i)
        bd = {sym: round(v, 4) for sym, v in values.items()}
        snapshots.append({"asof": d.isoformat(), "breakdown": bd})
        for sym in values:
            values[sym] *= (1 + daily_return)
    return snapshots


def _build_mock_supabase(
    *,
    prefs: dict | None = None,
    holdings: list[dict] | None = None,
    snapshots: list[dict] | None = None,
) -> MagicMock:
    prefs = prefs or {}
    holdings = holdings or []
    snapshots = snapshots or []

    def _chain(data):
        result = MagicMock(data=data)
        mock = MagicMock()
        mock.select.return_value = mock
        mock.eq.return_value = mock
        mock.in_.return_value = mock
        mock.order.return_value = mock
        mock.limit.return_value = mock
        mock.maybe_single.return_value = mock
        mock.execute.return_value = result
        return mock

    def _router(table_name: str):
        if table_name == "allocator_preferences":
            return _chain(prefs)
        if table_name == "allocator_holdings":
            return _chain(holdings)
        if table_name == "allocator_equity_snapshots":
            return _chain(snapshots)
        return _chain([])

    sb = MagicMock()
    sb.table.side_effect = _router
    return sb


# ---------------------------------------------------------------------------
# The single canonical fixture (holdings + snapshots + candidates)
# ---------------------------------------------------------------------------

_N_DAYS = 41  # -> 40 daily returns per symbol (>= 30 warm-up gate)
_BTC_START = 50000.0
_ETH_START = 30000.0
_DAILY = 0.01


def _fixture_snapshots() -> list[dict]:
    return _make_multi_symbol_snapshots(
        _N_DAYS, {"BTC": _BTC_START, "ETH": _ETH_START}, daily_return=_DAILY
    )


def _fixture_holdings() -> list[dict]:
    return [
        {"venue": "binance", "symbol": "BTC", "holding_type": "spot",
         "value_usd": _BTC_START, "asof": "2026-02-10"},
        {"venue": "binance", "symbol": "ETH", "holding_type": "spot",
         "value_usd": _ETH_START, "asof": "2026-02-10"},
    ]


def _expected_symbol_series(snapshots: list[dict], symbol: str) -> pd.Series:
    """Independent re-derivation (bare pandas) of the per-symbol return series —
    deliberately NOT calling reconstruct_symbol_returns so the assertion has teeth."""
    asofs = [s["asof"] for s in snapshots]
    values = [float(s["breakdown"][symbol]) for s in snapshots]
    return pd.Series(values, index=asofs, name=symbol).pct_change().dropna()


def _fixture_candidates() -> tuple[list[dict], dict[str, pd.Series]]:
    """6 eligible candidates (>= RELAXATION_MIN_CANDIDATES=5 so relaxation does NOT
    fire — the full personalized scoring path runs). Candidate return series share
    the holdings' asof index so the correlation math is non-trivial + deterministic."""
    snaps = _fixture_snapshots()
    idx = [s["asof"] for s in snaps][1:]  # 40 return days (post-pct_change)
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
        returns[sid] = pd.Series(vals, index=idx, name=sid)
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


def _compute_score_result() -> dict:
    snaps = _fixture_snapshots()
    holdings = _fixture_holdings()
    sb = _build_mock_supabase(holdings=holdings, snapshots=snaps)
    # Patch the module-level get_supabase used by _load_allocator_context.
    import routers.match as match_mod
    orig = match_mod.get_supabase
    match_mod.get_supabase = lambda: sb  # type: ignore[assignment]
    try:
        ctx = _load_allocator_context("alloc-golden")
    finally:
        match_mod.get_supabase = orig  # type: ignore[assignment]

    candidates, cand_returns = _fixture_candidates()
    return score_candidates(
        allocator_id="alloc-golden",
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
    snaps = _fixture_snapshots()
    holdings = _fixture_holdings()
    sb = _build_mock_supabase(holdings=holdings, snapshots=snaps)
    monkeypatch.setattr("routers.match.get_supabase", lambda: sb)

    ctx = _load_allocator_context("alloc-golden")  # sync — no await

    # Two holdings survive the 30d warm-up gate (41 snapshots -> 40 returns each).
    pseudo_ids = {ps["strategy_id"] for ps in ctx["portfolio_strategies"]}
    assert pseudo_ids == {"holding:binance:BTC:spot", "holding:binance:ETH:spot"}

    # Weights: value_usd / total (50000/80000, 30000/80000) — exact float arithmetic.
    assert ctx["portfolio_weights"]["holding:binance:BTC:spot"] == pytest.approx(0.625, abs=0.0)
    assert ctx["portfolio_weights"]["holding:binance:ETH:spot"] == pytest.approx(0.375, abs=0.0)
    assert abs(sum(ctx["portfolio_weights"].values()) - 1.0) < 1e-12
    assert ctx["portfolio_aum"] == pytest.approx(80000.0)

    # Series byte-stable vs an INDEPENDENT bare-pandas re-derivation (teeth).
    for sym, pid in (("BTC", "holding:binance:BTC:spot"), ("ETH", "holding:binance:ETH:spot")):
        expected = _expected_symbol_series(snaps, sym)
        expected.name = pid
        got = ctx["portfolio_returns"][pid].copy()
        got.name = pid
        pd.testing.assert_series_equal(got, expected, check_exact=True)
        assert len(got) == _N_DAYS - 1 == 40


def test_score_candidates_matches_committed_golden():
    """Test 2: full score_candidates output == committed JSON golden, exact string."""
    result = _compute_score_result()

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
