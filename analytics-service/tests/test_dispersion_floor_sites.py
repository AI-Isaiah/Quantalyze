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
import re

import numpy as np
import pandas as pd
import pytest

from services.allocated_capital import _annualised_sharpe
from services.csv_validator import validate_csv
from services.dispersion import residue_floor
from services.equity_reconstruction import EquityCurveBuilder
from services.optimizer import optimize_weights
from services.portfolio_optimizer import _compute_sharpe, find_improvement_candidates
from services.portfolio_risk import compute_risk_decomposition
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


# ---------------------------------------------------------------------------
# S2: portfolio_optimizer.find_improvement_candidates, the M-0701 exclusion
# ---------------------------------------------------------------------------


def _noisy(index: pd.Index, seed: int, mu: float = 0.001, sd: float = 0.02) -> pd.Series:
    rng = np.random.default_rng(seed)
    return pd.Series(rng.normal(mu, sd, len(index)), index=index)


def _s2_portfolio(index: pd.Index) -> dict[str, pd.Series]:
    return {"s1": _noisy(index, 1661), "s2": _noisy(index, 1662)}


@_YIELD_PARAMS
def test_s2_constant_yield_candidate_is_dropped_noisy_candidate_kept(daily_yield):
    """M-0701 drops a candidate whose own returns do not vary: its correlation
    and diversification signal are undefined. A constant yield is such a
    candidate, whether its std is exactly 0 or the ~1e-16 residue of a
    compounding NAV. Today the residue passes the ``== 0.0`` test and the
    candidate is scored on a residue correlation."""
    const = nav_constant_yield(daily_yield)
    index = const.index
    candidates = {"const": const, "noisy": _noisy(index, 1663)}
    ids = [c["strategy_id"] for c in find_improvement_candidates(
        _s2_portfolio(index), candidates, {"s1": 0.5, "s2": 0.5}
    )]
    assert "noisy" in ids
    assert "const" not in ids


def test_s2_exact_constant_candidate_is_dropped():
    """D-07 reference: an exactly constant candidate (std exactly 0.0) is
    dropped, which is what the constant-yield candidate above must match."""
    index = nav_constant_yield(1e-4).index
    candidates = {"const": pd.Series(0.0, index=index), "noisy": _noisy(index, 1663)}
    ids = [c["strategy_id"] for c in find_improvement_candidates(
        _s2_portfolio(index), candidates, {"s1": 0.5, "s2": 0.5}
    )]
    assert ids == ["noisy"]


# ---------------------------------------------------------------------------
# S3: csv_validator._check_sharpe_sentinel (D-04: keep the verdict, drop the number)
# ---------------------------------------------------------------------------


def _returns_csv(values: pd.Series) -> bytes:
    df = pd.DataFrame({
        "date": pd.date_range("2024-01-02", periods=len(values), freq="D").strftime("%Y-%m-%d"),
        "daily_return": list(values),
    })
    return df.to_csv(index=False).encode("utf-8")


def _sentinel_errors(result: dict) -> list[dict]:
    return [e for e in result["errors"] if e["rule"] == "daily_sharpe_sentinel"]


def _assert_residue(values: pd.Series) -> None:
    """Fixture precondition: the series is residue, not exact zero and not real
    dispersion, or the test would silently exercise another branch."""
    sd = float(values.std(ddof=1))
    assert 0.0 < sd <= residue_floor(float(values.mean())), sd


def _assert_names_no_fabricated_number(message: str) -> None:
    assert not re.search(r"\d{7,}", message), message
    assert "e+" not in message.lower(), message


def test_s3_repeated_positive_return_rejected_without_a_fabricated_number():
    """120 days of a repeated 0.001 is residue (std ~4e-19). A constant positive
    return has an unbounded Sharpe, so the upload stays REJECTED (D-04), but the
    message used to print 'Daily Sharpe 2296215230173376.50'."""
    values = pd.Series([0.001] * 120)
    _assert_residue(values)
    errors = _sentinel_errors(validate_csv(_returns_csv(values), "daily_returns"))
    assert len(errors) == 1
    _assert_names_no_fabricated_number(errors[0]["message"])


@_YIELD_PARAMS
def test_s3_nav_constant_yield_rejected_without_a_fabricated_number(daily_yield):
    values = nav_constant_yield(daily_yield)
    _assert_residue(values)
    errors = _sentinel_errors(validate_csv(_returns_csv(values), "daily_returns"))
    assert len(errors) == 1
    _assert_names_no_fabricated_number(errors[0]["message"])


def test_s3_all_zero_returns_pass():
    """A constant return at the risk-free rate (0) has no excess, so no Sharpe
    to be unrealistic about: accepted today and still accepted."""
    values = pd.Series([0.0] * 120)
    assert _sentinel_errors(validate_csv(_returns_csv(values), "daily_returns")) == []


def test_s3_constant_negative_yield_passes():
    """A residue series below the risk-free rate gets no sentinel error."""
    values = nav_constant_yield(-1e-4)
    _assert_residue(values)
    assert _sentinel_errors(validate_csv(_returns_csv(values), "daily_returns")) == []


def test_s3_real_quantisation_dispersion_still_reports_a_finite_sharpe():
    """Cent-rounded 1% APY: real dispersion takes today's branch unchanged, so the
    error still names the Sharpe, and that number is finite."""
    values = _cent_rounded_1pct_apy()
    errors = _sentinel_errors(validate_csv(_returns_csv(values), "daily_returns"))
    assert len(errors) == 1
    m = re.search(r"Daily Sharpe (\S+) exceeds", errors[0]["message"])
    assert m is not None, errors[0]["message"]
    assert math.isfinite(float(m.group(1)))
    _assert_names_no_fabricated_number(errors[0]["message"])


# ---------------------------------------------------------------------------
# S4: allocated_capital._annualised_sharpe
# ---------------------------------------------------------------------------


@_YIELD_PARAMS
def test_s4_annualised_sharpe_constant_yield_is_nan(daily_yield):
    r = nav_constant_yield(daily_yield)
    assert math.isnan(_annualised_sharpe(_exact_constant_like(r)))
    assert math.isnan(_annualised_sharpe(r))


def test_s4_annualised_sharpe_real_quantisation_dispersion_is_finite():
    assert math.isfinite(_annualised_sharpe(_cent_rounded_1pct_apy()))


# ---------------------------------------------------------------------------
# S5: EquityCurveBuilder.compute_sharpe
# ---------------------------------------------------------------------------


def _builder_over(daily_return: pd.Series) -> EquityCurveBuilder:
    """A builder whose reconstructed curve is ``daily_return`` (no open PnL);
    ``compute_sharpe`` reads nothing else."""
    df = pd.DataFrame({"daily_return": daily_return.to_numpy(), "unrealized_pnl": 0.0})
    builder = EquityCurveBuilder.__new__(EquityCurveBuilder)
    builder.to_equity_curve_daily = lambda: df  # type: ignore[method-assign]
    return builder


@_YIELD_PARAMS
def test_s5_equity_curve_sharpe_constant_yield_is_none(daily_yield):
    r = nav_constant_yield(daily_yield)
    assert _builder_over(_exact_constant_like(r)).compute_sharpe() is None
    assert _builder_over(r).compute_sharpe() is None


def test_s5_equity_curve_sharpe_real_quantisation_dispersion_is_finite():
    out = _builder_over(_cent_rounded_1pct_apy()).compute_sharpe()
    assert out is not None and math.isfinite(out)


# ---------------------------------------------------------------------------
# S6: optimizer.optimize_weights constant-column gate. A PIN, not a red test:
# the old absolute ``<= 1e-12`` equals the shared floor for any |mean| <= 1, so
# this cannot go red against the old guard (D-06, RESEARCH Pitfall 1).
# ---------------------------------------------------------------------------


def _as_pairs(s: pd.Series) -> list[tuple[str, float]]:
    return [(d.strftime("%Y-%m-%d"), float(v)) for d, v in s.items()]


@_YIELD_PARAMS
def test_s6_optimizer_constant_yield_column_is_constant_series(daily_yield):
    const = nav_constant_yield(daily_yield)
    series = {"const": _as_pairs(const), "noisy": _as_pairs(_noisy(const.index, 1664))}
    out = optimize_weights(series)
    assert out.ok is False
    assert out.reason == "constant-series"
    assert out.weights is None


# ---------------------------------------------------------------------------
# S7: portfolio_risk.compute_risk_decomposition (D-05)
# ---------------------------------------------------------------------------


@_YIELD_PARAMS
def test_s7_risk_decomposition_of_constant_yields_splits_no_risk(daily_yield):
    """Two strategies that do not move carry no risk, so there is no share of it
    to apportion. Today the ~1e-32 residue covariance splits it 48.6% / 51.4%."""
    a = nav_constant_yield(daily_yield)
    b = nav_constant_yield(daily_yield / 2)
    cov = pd.DataFrame({"a": a, "b": b}).cov().to_numpy()
    out = compute_risk_decomposition([0.5, 0.5], cov)
    assert [row["marginal_risk_pct"] for row in out] == [0, 0]
    assert [row["component_var"] for row in out] == [0, 0]


def test_s7_risk_decomposition_of_real_risk_still_splits():
    """The other side: a real covariance still gets a split that sums to 100%."""
    index = nav_constant_yield(1e-4).index
    cov = pd.DataFrame({"a": _noisy(index, 1665), "b": _noisy(index, 1666)}).cov().to_numpy()
    out = compute_risk_decomposition([0.5, 0.5], cov)
    assert sum(row["marginal_risk_pct"] for row in out) == pytest.approx(100.0)
