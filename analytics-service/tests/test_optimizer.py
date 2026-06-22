"""Falsifiable pins for the weight optimizer (Phase 28, OPT-01 + OPT-02).

The risk class is overfit / false-confidence: a weight vector that looks precise
but is fit to noise, or that an allocator reads as a forecast. Exact SLSQP
solutions can shift at the 6th decimal across scipy point releases (local 1.17.1
vs CI-pinned 1.18.0 — the venv-drift trap), so we DO NOT pin golden weight values;
each test is a mathematical PROPERTY that holds regardless of the solver build:

  - determinism      — same input ⇒ byte-identical weights (OPT-02). A random
                       restart or unseeded path would FAIL.
  - long-only + full — every weight in [0,1], sum == 1 (the constraints hold).
  - min-vol sense    — a low-vol + high-vol uncorrelated pair ⇒ min-vol
                       OVERWEIGHTS the low-vol leg (the objective actually works).
  - max-sharpe sense — a high-Sharpe vs low-Sharpe pair ⇒ max-sharpe overweights
                       the high-Sharpe leg.
  - stability        — a 1-day data extension moves weights < a few % (OPT-02:
                       not chasing noise).
  - degeneracy gate  — k<2, n<floor, constant column, non-finite ⇒ weights None
                       (honest absence), NEVER a fabricated vector.
  - Ledoit-Wolf      — shrinks toward the identity (off-diagonals shrink) and
                       yields a symmetric, invertible (well-conditioned) matrix.
"""

import numpy as np
import pytest

from services.optimizer import (
    optimize_weights,
    ledoit_wolf_shrinkage,
    SAMPLE_FLOOR,
    MIN_OBS_PER_STRATEGY,
    TRADING_DAYS,
)


def _dates(n: int) -> list[str]:
    """n sequential ISO dates (rolling across 28-day months — distinct, ordered)."""
    out: list[str] = []
    month = 1
    day = 1
    year = 2024
    for _ in range(n):
        out.append(f"{year}-{month:02d}-{day:02d}")
        day += 1
        if day > 28:
            day = 1
            month += 1
            if month > 12:
                month = 1
                year += 1
    return out


def _series(dates: list[str], values: np.ndarray) -> list[tuple[str, float]]:
    return [(d, float(v)) for d, v in zip(dates, values)]


def _two_strategy_input(n: int, *, seed: int, vol_a: float, vol_b: float,
                        mean_a: float = 0.0, mean_b: float = 0.0):
    """Two uncorrelated strategies A (vol_a) and B (vol_b) over n shared days."""
    rng = np.random.default_rng(seed)
    dates = _dates(n)
    a = rng.normal(mean_a, vol_a, n)
    b = rng.normal(mean_b, vol_b, n)
    return {"A": _series(dates, a), "B": _series(dates, b)}


# =========================================================================
# Determinism + constraints
# =========================================================================

def test_determinism_byte_identical():
    inp = _two_strategy_input(150, seed=1, vol_a=0.005, vol_b=0.02)
    r1 = optimize_weights(inp, "min_vol")
    r2 = optimize_weights(inp, "min_vol")
    assert r1.ok and r2.ok
    assert r1.weights == r2.weights  # identical, not just close


def test_long_only_and_fully_invested():
    inp = _two_strategy_input(150, seed=2, vol_a=0.01, vol_b=0.015)
    r = optimize_weights(inp, "min_vol")
    assert r.ok and r.weights is not None
    assert all(0.0 <= w <= 1.0 for w in r.weights.values())
    assert r.weights["A"] + r.weights["B"] == pytest.approx(1.0, abs=1e-6)
    assert r.in_sample is True  # never a forecast


# =========================================================================
# The objectives actually mean something
# =========================================================================

def test_min_vol_overweights_the_low_vol_strategy():
    # A is 4x lower vol than B, uncorrelated, both ~zero mean. Min-variance must
    # tilt toward A (a face-value / inverted objective would tilt to B and FAIL).
    inp = _two_strategy_input(180, seed=3, vol_a=0.004, vol_b=0.016)
    r = optimize_weights(inp, "min_vol")
    assert r.ok and r.weights is not None
    assert r.weights["A"] > r.weights["B"]
    assert r.weights["A"] > 0.6  # clearly concentrated on the low-vol leg


def test_max_sharpe_all_losing_book_gates_to_no_positive_drift():
    # Both strategies reliably lost money over the window. max-Sharpe would
    # concentrate in the "least-bad" leg and present it confidently — instead we
    # gate to honest absence (M1 red-team finding). min-vol on the SAME book is
    # still fine (volatility is always defined).
    rng = np.random.default_rng(21)
    n = 180
    dates = _dates(n)
    inp = {
        "A": _series(dates, rng.normal(-0.005, 0.004, n)),
        "B": _series(dates, rng.normal(-0.004, 0.005, n)),
    }
    r = optimize_weights(inp, "max_sharpe")
    assert not r.ok and r.weights is None and r.reason == "no-positive-drift"
    # min-vol is unaffected — variance exists regardless of drift sign.
    assert optimize_weights(inp, "min_vol").ok is True


def test_max_sharpe_overweights_the_high_sharpe_strategy():
    # A: positive drift, low vol (high Sharpe). B: ~zero drift, high vol (low Sharpe).
    inp = _two_strategy_input(180, seed=4, vol_a=0.006, vol_b=0.02, mean_a=0.001, mean_b=0.0)
    r = optimize_weights(inp, "max_sharpe")
    assert r.ok and r.weights is not None
    assert r.weights["A"] > r.weights["B"]


# =========================================================================
# Stability — a 1-day extension barely moves the weights (OPT-02)
# =========================================================================

def test_one_day_extension_moves_weights_only_slightly():
    rng = np.random.default_rng(5)
    n = 200
    dates = _dates(n + 1)
    a = rng.normal(0.0002, 0.008, n + 1)
    b = rng.normal(0.0001, 0.013, n + 1)
    base = {"A": _series(dates[:n], a[:n]), "B": _series(dates[:n], b[:n])}
    extended = {"A": _series(dates, a), "B": _series(dates, b)}
    r0 = optimize_weights(base, "min_vol")
    r1 = optimize_weights(extended, "min_vol")
    assert r0.ok and r1.ok and r0.weights and r1.weights
    l1 = sum(abs(r1.weights[k] - r0.weights[k]) for k in r0.weights)
    assert l1 < 0.10  # < a few % per leg — not chasing one new day of noise


# =========================================================================
# Degeneracy gate — honest absence, never a fabricated vector (OPT-02)
# =========================================================================

def test_gate_few_strategies():
    inp = _two_strategy_input(150, seed=6, vol_a=0.01, vol_b=0.01)
    r = optimize_weights({"A": inp["A"]}, "min_vol")  # only 1 strategy
    assert not r.ok and r.weights is None and r.reason == "few-strategies"


def test_gate_below_sample_floor():
    inp = _two_strategy_input(SAMPLE_FLOOR - 1, seed=7, vol_a=0.01, vol_b=0.01)
    r = optimize_weights(inp, "min_vol")
    assert not r.ok and r.weights is None and r.reason == "below-sample-gate"


def test_gate_obs_per_strategy_with_many_strategies():
    # 70 days clears SAMPLE_FLOOR(60) but with 8 strategies needs 80 (10*8) ⇒ gated.
    rng = np.random.default_rng(8)
    n = 70
    dates = _dates(n)
    inp = {f"S{i}": _series(dates, rng.normal(0, 0.01, n)) for i in range(8)}
    r = optimize_weights(inp, "min_vol")
    assert not r.ok and r.weights is None and r.reason == "below-sample-gate"
    assert r.n == n and r.k == 8


def test_gate_constant_series():
    dates = _dates(120)
    inp = {
        "A": _series(dates, np.full(120, 0.001)),  # constant ⇒ zero variance
        "B": _series(dates, np.random.default_rng(9).normal(0, 0.01, 120)),
    }
    r = optimize_weights(inp, "min_vol")
    assert not r.ok and r.weights is None and r.reason == "constant-series"


def test_gate_non_finite():
    inp = _two_strategy_input(120, seed=10, vol_a=0.01, vol_b=0.01)
    bad = list(inp["A"])
    bad[50] = (bad[50][0], float("nan"))
    inp["A"] = bad
    r = optimize_weights(inp, "min_vol")
    assert not r.ok and r.weights is None and r.reason == "non-finite"


def test_intersection_alignment_not_union():
    # B is offset by 30 days; only the overlap counts as n (never zero-filled).
    rng = np.random.default_rng(11)
    full = _dates(200)
    a = {"A": _series(full, rng.normal(0, 0.01, 200))}
    b_dates = full[30:]  # B starts 30 days later
    a["B"] = _series(b_dates, rng.normal(0, 0.01, len(b_dates)))
    r = optimize_weights(a, "min_vol")
    assert r.n == 170  # 200 - 30 overlap, NOT 200


# =========================================================================
# Ledoit-Wolf shrinkage properties
# =========================================================================

def test_ledoit_wolf_shrinks_toward_identity_and_is_invertible():
    rng = np.random.default_rng(12)
    # Strongly correlated pair so the sample off-diagonal is large.
    base = rng.normal(0, 0.01, 200)
    noise = rng.normal(0, 0.002, 200)
    returns = np.column_stack([base, base + noise])  # ~0.98 correlated

    sample = np.cov(returns, rowvar=False, bias=True)  # population (÷T)
    shrunk = ledoit_wolf_shrinkage(returns)

    # Symmetric.
    assert np.allclose(shrunk, shrunk.T)
    # The off-diagonal is pulled toward 0 (the identity target has none).
    assert abs(shrunk[0, 1]) < abs(sample[0, 1])
    # Well-conditioned ⇒ invertible (the whole reason to shrink).
    cond = np.linalg.cond(shrunk)
    assert np.isfinite(cond)
    np.linalg.inv(shrunk)  # must not raise


def test_ledoit_wolf_annualization_constant_is_252():
    # Guard the product-wide convention the parity test also pins.
    assert TRADING_DAYS == 252
    assert MIN_OBS_PER_STRATEGY == 10
