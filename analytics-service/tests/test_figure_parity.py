"""194 plan 02 (D-02 / D-03, TRUST-04): the Python half of the figure parity.

``tests/fixtures/figure_parity_vectors.json`` is read by this file AND by
``src/lib/figure-parity.test.ts``. Its expected values are HAND-DERIVED by
independent invariant (known worst values, closed-form windows); nothing here
derives an expectation by calling ``metrics.py``.
"""

import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from services.metrics import (
    FIGURE_DEFS_VERSION,
    _historical_var_cvar,
    compute_all_metrics,
)

_VECTORS = json.loads(
    (Path(__file__).parent / "fixtures" / "figure_parity_vectors.json").read_text()
)


@pytest.mark.parametrize("vec", _VECTORS["var_cvar"], ids=lambda v: v["name"])
def test_historical_var_cvar_matches_hand_derived_vector(vec: dict) -> None:
    var, cvar = _historical_var_cvar(pd.Series(vec["returns"]))
    assert var == pytest.approx(vec["expected_var"], abs=1e-12)
    assert cvar == pytest.approx(vec["expected_cvar"], abs=1e-12)


def test_historical_var_cvar_empty_and_all_nan_give_none() -> None:
    assert _historical_var_cvar(pd.Series([], dtype="float64")) == (None, None)
    assert _historical_var_cvar(pd.Series([np.nan, np.nan])) == (None, None)


def _series(values: list[float], start: str = "2026-01-05") -> pd.Series:
    idx = pd.date_range(start, periods=len(values), freq="D")
    return pd.Series(values, index=idx, dtype="float64")


def test_compute_all_metrics_stores_historical_var_and_version_marker() -> None:
    rng = np.random.default_rng(194)
    r = _series(list(rng.normal(0.001, 0.01, 60)))
    mj = compute_all_metrics(r)["metrics_json"]
    assert mj["figure_defs_version"] == FIGURE_DEFS_VERSION == 2
    var, cvar = _historical_var_cvar(r)
    assert mj["var_1d_95"] == pytest.approx(var, abs=1e-12)
    assert mj["cvar"] == pytest.approx(cvar, abs=1e-12)


# ---------------------------------------------------------------------------
# D-03: calendar 3M / 6M windows (shared vectors with the TS engine)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("vec", _VECTORS["windows"], ids=lambda v: v["name"])
def test_window_returns_match_hand_derived_vector(vec: dict) -> None:
    idx = pd.DatetimeIndex(pd.to_datetime(vec["dates"]))
    r = pd.Series(vec["returns"], index=idx, dtype="float64")
    res = compute_all_metrics(
        r,
        periods_per_year=252 if vec["weekday"] else 365,
        cumulative_method=vec["method"],
    )
    for got, want in (
        (res["six_month_return"], vec["expected_6m"]),
        (res["metrics_json"]["three_month"], vec["expected_3m"]),
    ):
        if want is None:
            assert got is None, vec["name"]
        else:
            assert got == pytest.approx(want, abs=1e-12), vec["name"]


def test_window_constants_are_the_calendar_days() -> None:
    from services.metrics import SIX_MONTH_WINDOW_DAYS, THREE_MONTH_WINDOW_DAYS

    assert (SIX_MONTH_WINDOW_DAYS, THREE_MONTH_WINDOW_DAYS) == (182, 91)


# ---------------------------------------------------------------------------
# D-15: the stored observation count
# ---------------------------------------------------------------------------


def _weekday_series(n: int) -> pd.Series:
    rng = np.random.default_rng(1940)
    idx = pd.bdate_range("2026-01-05", periods=n)
    return pd.Series(rng.normal(0.0005, 0.01, n), index=idx, dtype="float64")


@pytest.mark.parametrize("n", [59, 60])
def test_record_observations_counts_a_clean_weekday_series(n: int) -> None:
    mj = compute_all_metrics(_weekday_series(n), periods_per_year=252)["metrics_json"]
    assert mj["record_observations"] == n


def test_record_observations_counts_the_headline_suffix_of_a_chain_broken_series() -> None:
    r = _weekday_series(100)
    break_index = 39  # an interior NaN: the headline starts after it
    r.iloc[break_index] = np.nan
    expected = 100 - (break_index + 1)  # 60, counted from the fixture's own break index
    mj = compute_all_metrics(r, periods_per_year=252)["metrics_json"]
    assert expected == 60
    assert mj["record_observations"] == expected
