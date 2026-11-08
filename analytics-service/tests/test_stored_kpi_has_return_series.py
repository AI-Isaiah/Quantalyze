"""194 D-17 — a stored annualised KPI always has the return series it came from.

Founder decision D-17 (review SFH-M1): every analytics write that stores annualised
KPIs also stores the return series they were computed from, so the figure gate's
"unknown" state never arises from a missing series. A reader that finds
``cagr`` / ``sharpe`` / ``sortino`` / ``volatility`` / ``calmar`` non-null beside a
null or empty ``returns_series`` cannot work out how long the record is, and prints
the figures with no record-length caption.

The Python producers write the KPIs and the series in ONE payload: the success
writers (``analytics_runner._mark_complete`` and the composite ``headline_payload``)
spread ``MetricsResult.metrics_json`` into the upsert, and that dict carries both.
Every other ``strategy_analytics`` writer in the service stamps status, error or
flag columns only, so it neither adds KPIs nor removes a series. This file pins the
one place the pairing is made, so a later edit that drops, empties or filters the
series away from a computed KPI set goes red here, not in a viewer's factsheet.

It encodes WHY the pairing matters (a gate input), not the shape of the dict.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from services.analytics_runner import _without_gap_day_points
from services.basis_series import derive_basis_series
from services.metrics import compute_all_metrics

# The annualised KPI columns of ``strategy_analytics`` (D-17's scope).
_ANNUALISED_KPIS = ("cagr", "sharpe", "sortino", "volatility", "calmar")


def _daily(n: int, *, seed: int = 7, start: str = "2024-01-01") -> pd.Series:
    rng = np.random.default_rng(seed)
    idx = pd.date_range(start, periods=n, freq="D").as_unit("us")
    return pd.Series(rng.normal(0.0008, 0.01, n), index=idx, dtype="float64")


def _assert_kpi_implies_series(metrics_json: dict[str, object], label: str) -> None:
    populated = [k for k in _ANNUALISED_KPIS if metrics_json.get(k) is not None]
    series = metrics_json.get("returns_series")
    if populated:
        assert isinstance(series, list) and len(series) > 0, (
            f"{label}: annualised KPIs {populated} are stored but returns_series is "
            f"{series!r}; the figure gate cannot size the record (D-17)"
        )


@pytest.mark.parametrize("n_days", [30, 120, 400, 1100])
@pytest.mark.parametrize("method", ["geometric", "simple"])
def test_compute_all_metrics_pairs_kpis_with_series(n_days: int, method: str) -> None:
    result = compute_all_metrics(_daily(n_days), cumulative_method=method)
    _assert_kpi_implies_series(result.metrics_json, f"compute_all_metrics({n_days}, {method})")
    # Guard against a vacuous pass: this input must actually store KPIs.
    assert any(result.metrics_json.get(k) is not None for k in _ANNUALISED_KPIS)


def test_derive_basis_series_pairs_kpis_with_series_across_gap_days() -> None:
    """The writers persist ``metrics_json`` after ``_without_gap_day_points`` removes
    the points of guarded days. Removing those points must never empty the series."""
    returns = _daily(300)
    gap_days = frozenset(
        ts.date().isoformat() for ts in returns.index[[40, 41, 120, 200]]
    )
    returns.iloc[[40, 41, 120, 200]] = np.nan
    result = derive_basis_series(
        returns,
        None,
        periods_per_year=365,
        cumulative_method="geometric",
        day_basis="calendar",
        scalar_returns=returns,
        densify_policy="broker_nan",
    )
    persisted = _without_gap_day_points(result.metrics_json, gap_days)
    _assert_kpi_implies_series(persisted, "derive_basis_series + _without_gap_day_points")
    assert any(persisted.get(k) is not None for k in _ANNUALISED_KPIS)
    dates = {p["date"] for p in persisted["returns_series"]}
    assert not (dates & gap_days), "gap days must stay missing, not be re-added"
