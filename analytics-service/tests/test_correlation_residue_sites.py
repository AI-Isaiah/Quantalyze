"""Phase 166.1 plan 03 (D-02, D-07): correlation sites C1-C8 over a residue leg.

A Pearson correlation divides by both legs' standard deviation. pandas does not
treat a residue standard deviation (a compounding NAV constant yield leaves
about 1e-16) as zero, so it returns a noise correlation instead of NaN. Measured
before this plan: the portfolio correlation matrix gave a constant-yield leg
0.05 against noise and 1.0 on its own diagonal, and two strategies with the SAME
constant yield ``corrwith`` each other at 1.0, above the 0.95 match threshold,
so they were reported as the same strategy.

The invariant for every site (D-07): a leg with a compounding-NAV constant
yield produces EXACTLY what an all-zero leg of the same length produces at that
site today. Both are computed in the test, never hard-coded, so the statement is
about economics (no dispersion means no correlation), not about the code. A
cent-rounded NAV is the control on the other side of the floor: it has real
quantisation dispersion and must keep a finite correlation, so widening the
floor goes red.

Every test that feeds a constant yield first asserts its precondition
``0 < std <= residue_floor(mean)``, so it cannot silently run an exact-zero
branch instead of the residue branch.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest

from services.dispersion import (
    dispersing_corrwith,
    dispersion_is_real,
    pairwise_correlation_or_none,
    residue_floor,
)
from services.portfolio_risk import compute_correlation_matrix
from tests.dispersion_fixtures import CONSTANT_YIELDS, apy, nav_constant_yield

_YIELD_IDS = list(CONSTANT_YIELDS)


def _residue_leg(yield_id: str, **kwargs: float) -> pd.Series:
    """A NAV constant-yield leg whose std is residue, not an exact zero."""
    leg = nav_constant_yield(CONSTANT_YIELDS[yield_id], **kwargs)
    sd, mean = float(leg.std()), float(leg.mean())
    assert 0.0 < sd <= residue_floor(mean), (
        f"fixture precondition: {yield_id} must be residue, not exact zero (sd={sd})"
    )
    return leg


def _noise(index: pd.Index, seed: int, scale: float = 0.01) -> pd.Series:
    rng = np.random.default_rng(seed)
    return pd.Series(rng.normal(0.0005, scale, len(index)), index=index)


def _zeros_like(leg: pd.Series) -> pd.Series:
    return pd.Series(0.0, index=leg.index, name=leg.name)


# ---------------------------------------------------------------------------
# The two helpers in services/dispersion.py
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("yield_id", _YIELD_IDS)
def test_pairwise_helper_constant_leg_is_none(yield_id: str) -> None:
    const = _residue_leg(yield_id)
    noise = _noise(const.index, seed=1)
    assert pairwise_correlation_or_none(const, noise) is None
    assert pairwise_correlation_or_none(noise, const) is None
    assert pairwise_correlation_or_none(const, _residue_leg(yield_id, start=5_000.0)) is None


def test_pairwise_helper_two_correlated_noisy_legs_are_finite() -> None:
    idx = nav_constant_yield(1e-4).index
    a = _noise(idx, seed=1)
    b = 0.8 * a + _noise(idx, seed=2, scale=0.004)
    r = pairwise_correlation_or_none(a, b)
    assert r is not None and math.isfinite(r) and r > 0.5


def test_pairwise_helper_cent_rounded_nav_keeps_a_correlation() -> None:
    """T-166.1-18: a cent-rounded 1% APY NAV has real quantisation dispersion.
    A floor widened past it would call it constant and report no correlation."""
    leg = nav_constant_yield(apy(0.01), cents=True)
    assert dispersion_is_real(float(leg.std()), float(leg.mean())), "control must disperse"
    r = pairwise_correlation_or_none(leg, _noise(leg.index, seed=3))
    assert r is not None and math.isfinite(r)


def test_pairwise_helper_uses_only_the_overlapping_rows() -> None:
    """The dispersion test judges the rows the correlation uses: a leg that is a
    constant yield on the overlap is None even though it moves outside it (a
    test over the whole leg would call it dispersing and return the residue
    correlation)."""
    const = _residue_leg("daily_1e-4")
    idx = const.index
    moving = _noise(idx, seed=4)
    flat_on_overlap = moving.copy()
    flat_on_overlap.iloc[100:] = const.iloc[100:]
    other = _noise(idx[100:], seed=5)
    assert pairwise_correlation_or_none(flat_on_overlap, other) is None
    assert pairwise_correlation_or_none(moving, other) is not None


@pytest.mark.parametrize("yield_id", _YIELD_IDS)
def test_dispersing_corrwith_drops_a_residue_column_and_keeps_a_noisy_one(yield_id: str) -> None:
    const = _residue_leg(yield_id)
    target = _noise(const.index, seed=6)
    near = target + _noise(const.index, seed=7, scale=0.001)
    out = dispersing_corrwith(pd.DataFrame({"const": const, "near": near}), target)
    assert list(out.index) == ["near"]
    assert math.isfinite(float(out["near"])) and float(out["near"]) > 0.95


@pytest.mark.parametrize("yield_id", _YIELD_IDS)
def test_dispersing_corrwith_is_empty_when_the_target_is_residue(yield_id: str) -> None:
    target = _residue_leg(yield_id)
    frame = pd.DataFrame({
        "noisy": _noise(target.index, seed=8),
        "same_yield": _residue_leg(yield_id, start=5_000.0),
    })
    out = dispersing_corrwith(frame, target)
    assert out.empty and out.dtype == float


# ---------------------------------------------------------------------------
# C1 - portfolio_risk.compute_correlation_matrix
# ---------------------------------------------------------------------------


def _c1_legs(const: pd.Series) -> dict[str, pd.Series]:
    n = _noise(const.index, seed=11)
    m = 0.5 * n + _noise(const.index, seed=12)
    return {"k": const, "n": n, "m": m}


def test_c1_all_zero_leg_reads_none_on_its_row_column_and_diagonal() -> None:
    """The D-07 reference, measured on today's code: pandas gives an all-zero
    column NaN on its row, column and diagonal, and ``_safe_float`` maps each to
    None. This is the only shape the fix may emit for a residue leg."""
    zero = pd.Series(0.0, index=nav_constant_yield(1e-4).index)
    out = compute_correlation_matrix(_c1_legs(zero))
    assert all(out["k"][c] is None for c in ("k", "n", "m"))
    assert out["n"]["k"] is None and out["m"]["k"] is None


@pytest.mark.parametrize("yield_id", _YIELD_IDS)
def test_c1_constant_yield_leg_equals_the_all_zero_leg(yield_id: str) -> None:
    const = _residue_leg(yield_id)
    with_const = compute_correlation_matrix(_c1_legs(const))
    with_zero = compute_correlation_matrix(_c1_legs(_zeros_like(const)))
    assert with_const == with_zero
    assert with_const["k"]["k"] is None
    assert all(with_const["k"][c] is None and with_const[c]["k"] is None for c in ("n", "m"))
    nm = with_const["n"]["m"]
    assert nm is not None and math.isfinite(nm)
