"""Phase 105.1-01 — ADVISORY hand-oracle golden for the teaser derive scalars.

This is an ADVISORY shift-detector (D2), NOT a byte-identity gate. It pins the
four return-based teaser scalars produced by
``routers.process_key._derive_return_scalars`` against FIRST-PRINCIPLES paper
values (the pattern of tests/test_metrics_minigolden.py: paper math, never the
shared helper's own output). Its load-bearing content is the √365 annualization
factor (#597) plus drift detection on cumulative_return / max_drawdown.

REGEN CONTRACT: on an INTENDED convention change (like D2 itself — the √252→√365
shift), recompute the paper oracle IN THE SAME PR with a citation. An UNEXPLAINED
mismatch here is a backbone regression (the Phase-101 second-derivation divergence
class the unification exists to kill) — investigate, do NOT loosen the tolerance.

Oracle conventions (verified once against the real derive output, 2026-07-14):
  - cumulative_return = ∏(1 + rᵢ) − 1                       (geometric)
  - max_drawdown      = min running (value/peak − 1) over the cumprod walk
  - sharpe            = mean(r) / std(r, ddof=1) × √periods, rf = 0
    (quantstats qs.stats.sharpe convention, metrics.py:707; on day_basis
    "calendar" stat_returns IS the input series byte-for-byte, metrics.py:703-705)
  - ytd == cumulative_return because the fixture lives entirely within ONE
    calendar year (metrics.py:846 slices index ≥ Jan-1-of-last-year).

Fixture index is tz-NAIVE datetime64[us] — the CANONICAL production series shape
(D3): trades_to_daily_returns groups on `.dt.date`, dropping tz, so the persisted
returns are tz-naive [us]. (A tz-aware index breaks metrics.py:846's naive-Timestamp
ytd comparison — production avoids it for exactly this reason.)
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest

from routers.process_key import _derive_return_scalars

# Eight consecutive calendar days in ONE year → gap_fill is identity (no gaps →
# clean paper math) and ytd == cumulative_return. Non-zero volatility with
# wins/losses so max_drawdown is non-trivial and √365 ≠ √252.
_GOLDEN_RETURNS = [0.012, -0.008, 0.021, 0.015, -0.011, 0.019, -0.005, 0.024]
_GOLDEN_INDEX = pd.date_range(
    "2024-02-05", periods=len(_GOLDEN_RETURNS), freq="D"
).as_unit("us")


def _paper_oracle(returns: list[float], periods_per_year: int) -> dict[str, float]:
    """First-principles paper computation of the four scalars (no qs, no derive)."""
    arr = np.array(returns, dtype=float)
    cumulative_return = float(np.prod(1.0 + arr) - 1.0)

    peak = 1.0
    value = 1.0
    max_drawdown = 0.0
    for r in returns:
        value *= 1.0 + r
        peak = max(peak, value)
        max_drawdown = min(max_drawdown, value / peak - 1.0)

    mean = arr.mean()
    std = arr.std(ddof=1)  # sample std — qs.stats.sharpe uses ddof=1
    sharpe = mean / std * math.sqrt(periods_per_year)  # rf = 0
    return {
        "twr": cumulative_return,
        "ytd": cumulative_return,  # single-year fixture
        "max_drawdown": max_drawdown,
        "sharpe": sharpe,
    }


def test_teaser_derive_golden_crypto_365():
    """Pin the four crypto-teaser scalars to the √365 paper oracle."""
    series = pd.Series(_GOLDEN_RETURNS, index=_GOLDEN_INDEX)
    four, _curve = _derive_return_scalars(series, "crypto")

    oracle = _paper_oracle(_GOLDEN_RETURNS, 365)
    assert four["twr"] == pytest.approx(oracle["twr"], rel=1e-9)
    assert four["ytd"] == pytest.approx(oracle["ytd"], rel=1e-9)
    assert four["max_drawdown"] == pytest.approx(oracle["max_drawdown"], rel=1e-9)
    # Sharpe reconciles to the qs convention (mean/std(ddof=1)×√365, rf=0);
    # rel=1e-6 is the tightest defensible band, NOT to be loosened (C2).
    assert four["sharpe"] == pytest.approx(oracle["sharpe"], rel=1e-6)


def test_teaser_derive_golden_365_not_252():
    """D2 pin: the crypto scalar is the √365 sharpe and would NOT match √252."""
    series = pd.Series(_GOLDEN_RETURNS, index=_GOLDEN_INDEX)
    four, _curve = _derive_return_scalars(series, "crypto")

    sharpe_252 = _paper_oracle(_GOLDEN_RETURNS, 252)["sharpe"]
    # √365/√252 ≈ 1.204 — a ~20% gap, far outside the 1e-6 band.
    assert four["sharpe"] != pytest.approx(sharpe_252, rel=1e-6)
    # And it explicitly carries the √365 factor over the √252 oracle.
    assert four["sharpe"] == pytest.approx(
        sharpe_252 * math.sqrt(365) / math.sqrt(252), rel=1e-9
    )
