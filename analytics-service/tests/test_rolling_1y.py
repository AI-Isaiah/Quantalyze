"""194 plan 23 (D-14, TRUST-05): the 365-calendar-day rolling window.

``tests/fixtures/rolling_1y_vectors.json`` is read by this file AND by
``src/lib/factsheet/rolling-calendar.test.ts``. Its expected values are closed forms in
each window's counts, written beside their derivation in the fixture; nothing here
derives an expectation by calling ``metrics.py``.
"""

import json
import math
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import pytest

from services.metrics import (
    ONE_YEAR_DAYS,
    ROLLING_1Y_WINDOW_DAYS,
    _rolling_calendar_stats,
    compute_all_metrics,
)

_VECTORS: list[dict[str, Any]] = json.loads(
    (Path(__file__).parent / "fixtures" / "rolling_1y_vectors.json").read_text()
)["vectors"]
_BY_NAME = {v["name"]: v for v in _VECTORS}


def _series(vec: dict[str, Any]) -> pd.Series:
    return pd.Series(vec["returns"], index=pd.DatetimeIndex(vec["dates"]), dtype="float64")


def _expected(vec: dict[str, Any], key: str) -> np.ndarray:
    return np.array([np.nan if x is None else x for x in vec["expected"][key]], dtype="float64")


def test_window_is_one_year_of_calendar_days() -> None:
    assert ROLLING_1Y_WINDOW_DAYS == ONE_YEAR_DAYS == 365


@pytest.mark.parametrize("vec", _VECTORS, ids=lambda v: v["name"])
@pytest.mark.parametrize("key", ["vol", "sharpe", "sortino"])
def test_helper_matches_closed_form(vec: dict[str, Any], key: str) -> None:
    got = _rolling_calendar_stats(_series(vec), ROLLING_1Y_WINDOW_DAYS, vec["periods_per_year"])
    out = got[key].to_numpy()
    want = _expected(vec, key)
    assert len(out) == len(want)
    # NaN exactly where the fixture has no point, 1e-12 elsewhere.
    np.testing.assert_array_equal(np.isnan(out), np.isnan(want))
    ok = ~np.isnan(want)
    np.testing.assert_allclose(out[ok], want[ok], rtol=0, atol=1e-12)


@pytest.mark.parametrize("vec", _VECTORS, ids=lambda v: v["name"])
def test_stored_rolling_metrics_equal_closed_form_rounded_to_4dp(vec: dict[str, Any]) -> None:
    rolling = compute_all_metrics(
        _series(vec), periods_per_year=vec["periods_per_year"]
    ).metrics_json["rolling_metrics"]
    dates = vec["dates"]
    for stored_key, key in (
        ("volatility_1y", "vol"),
        ("sharpe_1y", "sharpe"),
        ("sortino_1y", "sortino"),
    ):
        expected_points = [
            {"date": d, "value": round(v, 4)}
            for d, v in zip(dates, vec["expected"][key], strict=True)
            if v is not None
        ]
        got = rolling[stored_key]
        assert [p["date"] for p in got] == [p["date"] for p in expected_points], stored_key
        for g, e in zip(got, expected_points, strict=True):
            assert g["value"] == pytest.approx(e["value"], abs=1e-4 + 1e-9), (stored_key, g["date"])


@pytest.mark.parametrize(
    ("name", "points"), [("daily-365", [364]), ("daily-364", [])], ids=["365-draws-last-day", "364-draws-none"]
)
def test_d21_boundary_365_daily_returns_fill_the_window(name: str, points: list[int]) -> None:
    """D-21: 365 daily returns cover 365 days, so the last day draws exactly one point; 364 draw none."""
    vec = _BY_NAME[name]
    got = _rolling_calendar_stats(_series(vec), ROLLING_1Y_WINDOW_DAYS, vec["periods_per_year"])
    for key in ("vol", "sharpe", "sortino"):
        assert list(np.flatnonzero(~np.isnan(got[key].to_numpy()))) == points, key
    stored = compute_all_metrics(
        _series(vec), periods_per_year=vec["periods_per_year"]
    ).metrics_json["rolling_metrics"]
    for stored_key in ("volatility_1y", "sharpe_1y", "sortino_1y"):
        assert [p["date"] for p in stored[stored_key]] == [vec["dates"][i] for i in points], stored_key


def test_record_under_a_year_stores_empty_lists() -> None:
    rolling = compute_all_metrics(
        _series(_BY_NAME["daily-300"]), periods_per_year=365
    ).metrics_json["rolling_metrics"]
    assert rolling["volatility_1y"] == []
    assert rolling["sharpe_1y"] == []
    assert rolling["sortino_1y"] == []


def test_active_basis_sharpe_rides_nonzero_days_vol_and_sortino_ride_returns() -> None:
    """Sharpe uses the nonzero-day basis `sharpe_30d` uses; vol and Sortino use `returns`.

    A zero day is inserted on every third date of a 400-day alternating series. The
    expected values are closed forms over the window's own counts, counted here from
    the dates: Sharpe over the nonzero days only, vol and Sortino over every day.
    """
    dates = pd.date_range("2024-01-01", periods=400, freq="D")
    a = 0.01
    vals = [0.0 if i % 3 == 2 else (a if i % 2 == 0 else -a) for i in range(400)]
    s = pd.Series(vals, index=dates)
    metrics = compute_all_metrics(s, periods_per_year=365, day_basis="active").metrics_json
    rolling = metrics["rolling_metrics"]

    nz = s[s != 0.0]
    last = dates[-1]
    lo = last - pd.Timedelta(days=365)

    def window(series: pd.Series) -> list[float]:
        return [float(v) for d, v in series.items() if lo < d <= last]

    # Sharpe: the nonzero-day series, its own first date (the mask uses that series' span)
    w = window(nz)
    n = len(w)
    p = sum(1 for v in w if v > 0)
    q = n - p
    mean = a * (p - q) / n
    var = (n * a * a - n * mean * mean) / (n - 1)
    want_sharpe = mean / math.sqrt(var) * math.sqrt(365)
    assert rolling["sharpe_1y"][-1]["date"] == last.strftime("%Y-%m-%d")
    assert rolling["sharpe_1y"][-1]["value"] == pytest.approx(want_sharpe, abs=1e-4)

    # Volatility and Sortino: every day of `returns` (zeros count in n, never in p or q)
    w = window(s)
    n = len(w)
    p = sum(1 for v in w if v > 0)
    q = sum(1 for v in w if v < 0)
    mean = a * (p - q) / n
    sumsq = (p + q) * a * a
    var = (sumsq - n * mean * mean) / (n - 1)
    assert rolling["volatility_1y"][-1]["value"] == pytest.approx(
        math.sqrt(var) * math.sqrt(365), abs=1e-4
    )
    want_sortino = mean / math.sqrt(q * a * a / n) * math.sqrt(365)
    assert rolling["sortino_1y"][-1]["value"] == pytest.approx(want_sortino, abs=1e-4)
    # The split is real: Sharpe on `returns` would differ from the nonzero-day one.
    assert abs(want_sharpe - mean / math.sqrt(var) * math.sqrt(365)) > 1e-3


def test_golden_input_spans_under_a_year_so_the_three_keys_are_empty_and_nothing_else_moves(
    golden_252d_input: dict[str, Any], golden_252d_expected: dict[str, Any]
) -> None:
    """The 252-day golden spans under 365 days: no full window, so the three keys are
    ``[]``. The existing row windows are compared to the committed golden file, whose
    ``sharpe_30d`` / ``sharpe_90d`` / ``sharpe_365d`` values predate this plan."""
    rolling = compute_all_metrics(
        golden_252d_input["returns"], golden_252d_input["benchmark"]
    ).metrics_json["rolling_metrics"]
    expected = golden_252d_expected["metrics_json"]["rolling_metrics"]
    for key in ("volatility_1y", "sharpe_1y", "sortino_1y"):
        assert rolling[key] == [] == expected[key], key
    for key in ("sharpe_30d", "sharpe_90d", "sharpe_365d"):
        assert rolling[key] == expected[key], key
