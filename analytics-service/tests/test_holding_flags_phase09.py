"""Phase 09 / Task 3 TDD tests for compute_holding_flags (finding f5).

Four mandatory test cases:
- test_holding_flags_max_weight: max_weight breach detection
- test_holding_flags_correlation_ceiling: correlation_ceiling breach detection
- test_holding_flags_candidate_exists_gate: D-04 + D-06 candidate-exists gate
- test_holding_flags_warmup_gate: defense-in-depth for pseudo_ids absent from portfolio_returns

All tests are plain `def` (NOT async def) per finding f1.
"""
from __future__ import annotations

import pandas as pd
from unittest.mock import MagicMock

from routers.match import compute_holding_flags, FLAG_COMPOSITE_THRESHOLD


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

def _mk_holding(venue: str = "binance", symbol: str = "BTC", holding_type: str = "spot", value_usd: float = 50000.0) -> dict:
    return {
        "venue": venue,
        "symbol": symbol,
        "holding_type": holding_type,
        "value_usd": value_usd,
        "asof": "2026-01-31",
    }


def _mk_series(n_days: int = 40, daily_return: float = 0.01) -> pd.Series:
    """Build a deterministic daily-return series of length n_days."""
    idx = pd.date_range("2026-01-01", periods=n_days, freq="D").strftime("%Y-%m-%d").tolist()
    return pd.Series([daily_return] * n_days, index=idx)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_holding_flags_max_weight():
    """finding f5: holdings with value/aum > max_weight report 'max_weight' breach.

    BTC: 400/1000 = 0.40 > max_weight=0.25 → breach.
    ETH: 600/1000 = 0.60 > max_weight=0.25 → breach.
    No qualifying candidate (scored_candidates_by_slot={}) → flagged=False (D-06 gate).
    """
    holdings = [
        _mk_holding(symbol="BTC", value_usd=400.0),
        _mk_holding(symbol="ETH", value_usd=600.0),
    ]
    portfolio_returns = {
        "holding:binance:BTC:spot": _mk_series(),
        "holding:binance:ETH:spot": _mk_series(),
    }
    portfolio_weights = {
        "holding:binance:BTC:spot": 0.4,
        "holding:binance:ETH:spot": 0.6,
    }
    prefs = {"max_weight": 0.25, "correlation_ceiling": None}

    flags = compute_holding_flags(
        holdings_rows_eligible=holdings,
        portfolio_returns=portfolio_returns,
        portfolio_weights=portfolio_weights,
        portfolio_aum=1000.0,
        allocator_preferences=prefs,
        scored_candidates_by_slot={},
    )

    assert len(flags) == 2
    btc_flag = next(f for f in flags if f["holding_ref"] == "holding:binance:BTC:spot")
    assert "max_weight" in btc_flag["breach_reasons"]
    eth_flag = next(f for f in flags if f["holding_ref"] == "holding:binance:ETH:spot")
    assert "max_weight" in eth_flag["breach_reasons"]
    # No candidate → flagged=False even with breach (D-06 candidate-exists gate)
    assert btc_flag["flagged"] is False
    assert eth_flag["flagged"] is False


def test_holding_flags_correlation_ceiling():
    """finding f5: highly-correlated holdings trigger correlation_ceiling breach.

    Three symbols share the same base returns signal with tiny additive offsets
    (avoids NaN from zero-stddev with identical constant series), producing
    correlation > 0.99 which exceeds the 0.8 ceiling.
    """
    import numpy as np

    rng = np.random.default_rng(42)
    n = 40
    # Shared trend signal: normally distributed returns
    base = rng.standard_normal(n) * 0.02
    # Each symbol = base + tiny noise (corr ≈ 0.99 with the weighted portfolio)
    noise_scale = 0.0001
    btc_vals = base + rng.standard_normal(n) * noise_scale
    eth_vals = base + rng.standard_normal(n) * noise_scale
    sol_vals = base + rng.standard_normal(n) * noise_scale

    idx = pd.date_range("2026-01-01", periods=n, freq="D").strftime("%Y-%m-%d").tolist()
    holdings = [
        _mk_holding(symbol="BTC", value_usd=500.0),
        _mk_holding(symbol="ETH", value_usd=300.0),
        _mk_holding(symbol="SOL", value_usd=200.0),
    ]
    portfolio_returns = {
        "holding:binance:BTC:spot": pd.Series(btc_vals.tolist(), index=idx),
        "holding:binance:ETH:spot": pd.Series(eth_vals.tolist(), index=idx),
        "holding:binance:SOL:spot": pd.Series(sol_vals.tolist(), index=idx),
    }
    portfolio_weights = {
        "holding:binance:BTC:spot": 0.5,
        "holding:binance:ETH:spot": 0.3,
        "holding:binance:SOL:spot": 0.2,
    }
    prefs = {"max_weight": 1.0, "correlation_ceiling": 0.8}

    flags = compute_holding_flags(
        holdings_rows_eligible=holdings,
        portfolio_returns=portfolio_returns,
        portfolio_weights=portfolio_weights,
        portfolio_aum=1000.0,
        allocator_preferences=prefs,
        scored_candidates_by_slot={},
    )

    assert len(flags) == 3
    for f in flags:
        assert "correlation_ceiling" in f["breach_reasons"], (
            f"Expected correlation_ceiling breach for {f['holding_ref']}, "
            f"got breach_reasons={f['breach_reasons']}"
        )


def test_holding_flags_candidate_exists_gate():
    """D-04 + D-06 + finding f5: breach + no-candidate-above-50 → flagged=False.

    BTC breaches max_weight (600/600 = 1.0 > 0.25), but the only candidate
    scores 30 (below FLAG_COMPOSITE_THRESHOLD=50) → flagged=False.
    """
    holdings = [_mk_holding(symbol="BTC", value_usd=600.0)]
    portfolio_returns = {"holding:binance:BTC:spot": _mk_series()}
    portfolio_weights = {"holding:binance:BTC:spot": 1.0}
    prefs = {"max_weight": 0.25, "correlation_ceiling": None}

    weak_candidate = MagicMock()
    weak_candidate.strategy_id = "uuid-weak-candidate"
    weak_candidate.final_score = 30.0

    scored = {"holding:binance:BTC:spot": [weak_candidate]}

    flags = compute_holding_flags(
        holdings_rows_eligible=holdings,
        portfolio_returns=portfolio_returns,
        portfolio_weights=portfolio_weights,
        portfolio_aum=600.0,
        allocator_preferences=prefs,
        scored_candidates_by_slot=scored,
    )

    assert len(flags) == 1
    assert "max_weight" in flags[0]["breach_reasons"]
    # Candidate score 30 < FLAG_COMPOSITE_THRESHOLD 50 → gate blocks flagged
    assert flags[0]["top_candidate_composite"] is None or flags[0]["top_candidate_composite"] < FLAG_COMPOSITE_THRESHOLD
    assert flags[0]["flagged"] is False


def test_holding_flags_warmup_gate():
    """finding f5 defense-in-depth: holding whose pseudo_id is absent from portfolio_returns
    is silently skipped by compute_holding_flags (warm-up exclusion already happened upstream
    in _load_holding_portfolio_context, but this guard prevents crashes on edge cases).
    """
    holdings = [
        _mk_holding(symbol="BTC", value_usd=500.0),
        _mk_holding(symbol="WARMUP_TOKEN", value_usd=500.0),  # pseudo_id NOT in portfolio_returns
    ]
    # Only BTC is in portfolio_returns — WARMUP_TOKEN was excluded upstream
    portfolio_returns = {"holding:binance:BTC:spot": _mk_series()}
    portfolio_weights = {"holding:binance:BTC:spot": 1.0}
    prefs = {"max_weight": 1.0, "correlation_ceiling": None}

    flags = compute_holding_flags(
        holdings_rows_eligible=holdings,
        portfolio_returns=portfolio_returns,
        portfolio_weights=portfolio_weights,
        portfolio_aum=1000.0,
        allocator_preferences=prefs,
        scored_candidates_by_slot={},
    )

    # Only BTC emits an entry; WARMUP_TOKEN is silently dropped
    assert len(flags) == 1
    assert flags[0]["holding_ref"] == "holding:binance:BTC:spot"
