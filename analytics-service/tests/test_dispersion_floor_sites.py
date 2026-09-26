"""Phase 166.1: every ratio-over-standard-deviation VARIANCE site reads Phase 166's floor.

A series that does not vary (a stablecoin-lending yield, a paused strategy) has a
standard deviation of about 1e-16 when it is derived from a compounding NAV,
never exactly 0. A site that tests ``== 0`` then divides by that residue and
shows a fabricated number (a Sharpe of 1.28e13, a CSV error printing a Sharpe of
2.3e15, a 48.6% / 51.4% split of a zero risk).

Invariant under test (D-07): a compounding-NAV constant yield produces EXACTLY the
output an exactly constant series of the same length produces at that site. No
dispersion means no ratio. That is economics, not the implementation: nothing
below asserts a value the code under test computed. A cent-rounded NAV (real
quantisation dispersion, sd about 4e-9) is the control on the other side of the
floor, so widening the floor goes red.

Each site's tests were written first, observed RED against the unedited site,
and every site was then neuter-drilled (the drill table is in 166.1-01-SUMMARY).
"""

import math

import pandas as pd
import pytest

from services.portfolio_optimizer import _compute_sharpe
from tests.dispersion_fixtures import CONSTANT_YIELDS, apy, nav_constant_yield

_YIELD_PARAMS = pytest.mark.parametrize(
    "daily_yield", list(CONSTANT_YIELDS.values()), ids=list(CONSTANT_YIELDS)
)


def _exact_constant_like(r: pd.Series) -> pd.Series:
    """An exactly constant (all-zero) series of the same length and index: the
    D-07 reference input, whose std is exactly 0.0."""
    return pd.Series(0.0, index=r.index, name=r.name)


def _cent_rounded_1pct_apy() -> pd.Series:
    """Real dispersion: a 1% APY NAV rounded to cents (sd about 4e-9)."""
    return nav_constant_yield(apy(0.01), cents=True)


# ---------------------------------------------------------------------------
# S1: portfolio_optimizer._compute_sharpe
# ---------------------------------------------------------------------------


@_YIELD_PARAMS
def test_s1_compute_sharpe_constant_yield_is_undefined(daily_yield):
    """A constant yield has no dispersion, so its Sharpe does not exist. Today's
    ``== 0`` guard lets the ~1e-16 residue through and returns ~1e13."""
    r = nav_constant_yield(daily_yield)
    assert _compute_sharpe(r) is None


@_YIELD_PARAMS
def test_s1_compute_sharpe_constant_yield_matches_exact_constant(daily_yield):
    """D-07: the constant yield answers exactly what an exactly constant series
    of the same length answers."""
    r = nav_constant_yield(daily_yield)
    control = _exact_constant_like(r)
    assert _compute_sharpe(control) is None
    assert _compute_sharpe(r) == _compute_sharpe(control)


def test_s1_compute_sharpe_real_quantisation_dispersion_is_finite():
    """The other side of the floor: cent-rounding noise is real dispersion, so a
    Sharpe exists. A floor widened past it would hide real data."""
    out = _compute_sharpe(_cent_rounded_1pct_apy())
    assert out is not None and math.isfinite(out)


def test_s1_compute_sharpe_one_row_is_none():
    """One row has a NaN std: no Sharpe, the same as before the floor moved."""
    r = pd.Series([0.01], index=pd.date_range("2024-01-01", periods=1, freq="D"))
    assert _compute_sharpe(r) is None
