"""Phase 236 plan 08 (FIG-02): the Python half of the cross-engine annualization parity.

``tests/fixtures/annualization_parity_vectors.json`` is read by this file AND by
``src/__tests__/annualization-parity.test.ts``. Its expected values are CLOSED FORMS, derived
from math in each vector's ``_comment`` and written into the JSON, never produced by an engine.

THE ORACLE IMPORTS NO PRODUCTION HELPER. The series generator, the loop recompute (mean, sample
sd, product, span) and the closed forms below use only ``math``, ``datetime`` and plain loops. The
engines are imported for the act of being measured and for nothing else.

THE SERIES. The repeating pair ``[+0.02, -0.01]`` over an even ``n``, phase 0:

* mean = 0.005 exactly (each pair sums to 0.01);
* every deviation is +-0.015, so the sum of squares is ``n * 0.015**2`` and the SAMPLE sd
  (ddof 1) is ``0.015 * sqrt(n / (n - 1))``;
* Sharpe = ``mean / sd * sqrt(P)``, P the frequency clock (crypto 365, traditional 252);
* TWR = ``(1.02 * 0.99) ** (n / 2) - 1``;
* CAGR = ``(1 + TWR) ** (365 / span) - 1``, span = whole days from the first to the last observed
  date of the SAME suffix (Q1: an emptied stretch stays in the span).

THE TOLERANCE. ``rtol = 1e-9``, ``atol = 0``, derived and never set by running an engine. Every
engine evaluates these same closed forms, so a difference between two of them is float
summation order and nothing else. The mean of ``n`` terms carries a relative error of at most
``n * eps``; with ``n <= 2000`` and ``eps = 2.2e-16`` that is at most 4.4e-13. The sample sd
divides one such sum by ``n - 1`` and square-roots it, which halves the relative error. A Sharpe
is a quotient of two quantities that each carry that bound, so at most about 1e-12. The wealth
ratio ``1 + TWR`` is a product of ``n`` factors and carries at most ``n * eps``. CAGR raises it to
``365 / span``; on these vectors the exponent is at most 365 / 299 = 1.22, so the relative error is
amplified by at most that, plus the ``(1 + T) / T`` factor of subtracting 1 (``T >= 3.3`` here,
so at most 1.31). A conservative total is 5.3e-12 for every metric. ``1e-9`` leaves more than 100x
headroom over that bound and is far below any convention move: ddof 0 instead of 1 shifts a
Sharpe by ``1 / (2 * (n - 1))`` (at n = 730, 6.9e-4), and 252 instead of 365 by a factor 1.2. A
miss outside 1e-9 is therefore a convention divergence between engines. It is reported, and the
tolerance is NEVER widened to absorb it.

THE BROKEN CHAIN. ``compute_all_metrics`` takes the post-break suffix itself (FACTSHEETTRUTH D-01),
so it is fed the WHOLE chain with the break as a NaN day. ``_compute_sharpe`` and
``sharpe_vol_status_from_backbone`` skip NaN and would pool the prefix with the suffix, so the
helper below hands them the suffix explicitly, as the production callers hand a clean series.
That is input shaping, not a divergence.

OUT OF SCOPE (F-2 and the plan): composite paths are not compared, and no vector uses an
unknown-asset-class leg (Python and TypeScript disagree on the unknown class: 252 vs 365).
"""

from __future__ import annotations

import datetime as dt
import json
import math
from pathlib import Path
from typing import Any

import pandas as pd
import pytest

from services.metrics import (
    blend_periods_per_year,
    compute_all_metrics,
    sharpe_vol_status_from_backbone,
    total_return_from_equity,
)
from services.nav_twr import cumulative_twr_segmented
from services.portfolio_optimizer import _compute_sharpe

RTOL = 1e-9
ATOL = 0.0

_FIXTURE = json.loads(
    (Path(__file__).parent / "fixtures" / "annualization_parity_vectors.json").read_text()
)
_VECTORS: list[dict[str, Any]] = _FIXTURE["vectors"]
_BY_NAME: dict[str, dict[str, Any]] = {v["name"]: v for v in _VECTORS}

# The oracle's own constants. Written out here, not read from `figure_conventions` or
# `metrics`: the point of the oracle is that it shares no code with what it checks.
_DAYS_PER_YEAR = 365


# --------------------------------------------------------------------------------------
# The oracle: series generator, loop recompute, closed forms. No production import.
# --------------------------------------------------------------------------------------


def _build_chain(vec: dict[str, Any]) -> list[tuple[dt.date, float | None]]:
    """Every dated row of the vector in order. ``None`` is the NaN day of an interior break."""
    cur = dt.date.fromisoformat(vec["start"])
    weekdays_only = vec["calendar"] == "weekdays"
    if weekdays_only:
        assert cur.weekday() < 5, "a weekday vector must start on a weekday"
    rows: list[tuple[dt.date, float | None]] = []

    def emit(value: float | None) -> None:
        nonlocal cur
        rows.append((cur, value))
        cur += dt.timedelta(days=1)
        while weekdays_only and cur.weekday() >= 5:
            cur += dt.timedelta(days=1)

    pre = vec.get("pre_break")
    if pre is not None:
        for i in range(pre["n"]):
            emit(pre["pattern"][i % 2])
        emit(None)  # the break: a present date carrying no return
    gap = vec.get("gap")
    for i in range(vec["n"]):
        if gap is not None and i == gap["after_obs"]:
            cur += dt.timedelta(days=gap["days"])  # an emptied stretch: NO row, never a NaN
        emit(vec["pattern"][i % 2])
    return rows


def _suffix(rows: list[tuple[dt.date, float | None]]) -> list[tuple[dt.date, float]]:
    """The maximal run of non-NaN rows ending at the last row (plain loop, no helper)."""
    out: list[tuple[dt.date, float]] = []
    for day, value in reversed(rows):
        if value is None:
            break
        out.append((day, value))
    out.reverse()
    return out


def _loop_oracle(suffix: list[tuple[dt.date, float]], periods: int) -> dict[str, float]:
    """mean, sample sd, Sharpe, TWR, CAGR recomputed from the generated series by plain loops."""
    values = [v for _, v in suffix]
    n = len(values)
    mean = sum(values) / n
    ss = sum((v - mean) ** 2 for v in values)
    sd = math.sqrt(ss / (n - 1))
    wealth = 1.0
    for v in values:
        wealth *= 1.0 + v
    span = (suffix[-1][0] - suffix[0][0]).days
    twr = wealth - 1.0
    return {
        "mean": mean,
        "sd": sd,
        "sharpe": mean / sd * math.sqrt(periods),
        "twr": twr,
        "cagr": (1.0 + twr) ** (_DAYS_PER_YEAR / span) - 1.0,
        "n": float(n),
        "span_days": float(span),
    }


def _closed_form(n: int, periods: int, span: int) -> dict[str, float]:
    sd = 0.015 * math.sqrt(n / (n - 1))
    twr = (1.02 * 0.99) ** (n // 2) - 1.0
    return {
        "mean": 0.005,
        "sd": sd,
        "sharpe": 0.005 / sd * math.sqrt(periods),
        "twr": twr,
        "cagr": (1.0 + twr) ** (_DAYS_PER_YEAR / span) - 1.0,
        "n": float(n),
        "span_days": float(span),
    }


def _close(got: float | None, want: float) -> bool:
    return got is not None and abs(got - want) <= RTOL * abs(want) + ATOL


def _assert_close(engine: str, metric: str, vec: str, got: float | None, want: float) -> None:
    assert _close(got, want), (
        f"CONVENTION DIVERGENCE: engine={engine} metric={metric} vector={vec}: "
        f"got {got!r}, the closed-form oracle says {want!r} "
        f"(rtol={RTOL}, atol={ATOL}; the tolerance is never widened)"
    )


# --------------------------------------------------------------------------------------
# The input shapers the engines are fed.
# --------------------------------------------------------------------------------------


def _series_from(rows: list[tuple[dt.date, float | None]]) -> pd.Series:
    """The whole chain as the stored engine sees it: float64, DatetimeIndex, NaN at a break."""
    return pd.Series(
        [math.nan if v is None else v for _, v in rows],
        index=pd.DatetimeIndex([pd.Timestamp(d) for d, _ in rows]),
        dtype="float64",
    )


def _suffix_series(vec: dict[str, Any]) -> pd.Series:
    """The clean post-break suffix, for the helpers that skip NaN instead of cutting at it."""
    suffix = _suffix(_build_chain(vec))
    return pd.Series(
        [v for _, v in suffix],
        index=pd.DatetimeIndex([pd.Timestamp(d) for d, _ in suffix]),
        dtype="float64",
    )


def _periods_for(vec: dict[str, Any]) -> int:
    """The frequency clock the engine is handed, through the production mapping by class."""
    return blend_periods_per_year([vec["asset_class"]])


# --------------------------------------------------------------------------------------
# Arms. One test per engine x metric, parametrized by vector (crypto first).
# --------------------------------------------------------------------------------------

_NAMES = [v["name"] for v in _VECTORS]


@pytest.mark.parametrize("name", _NAMES)
def test_fixture_is_the_closed_form(name: str) -> None:
    """The JSON equals the closed forms AND a loop recompute from the generated series.

    A fixture whose numbers drifted from its own derivation would make every engine arm below
    measure a wrong oracle, so this arm gates the rest."""
    vec = _BY_NAME[name]
    exp = vec["expected"]
    suffix = _suffix(_build_chain(vec))
    assert len(suffix) == vec["n"], f"{name}: the suffix has {len(suffix)} rows, the vector says {vec['n']}"
    assert suffix[0][0].isoformat() == exp.get("suffix_first_date", suffix[0][0].isoformat())
    assert (suffix[-1][0] - suffix[0][0]).days == exp["span_days"]
    closed = _closed_form(vec["n"], vec["periods_per_year"], exp["span_days"])
    loop = _loop_oracle(suffix, vec["periods_per_year"])
    for metric in ("mean", "sd", "sharpe", "twr", "cagr"):
        _assert_close("fixture-vs-closed-form", metric, name, exp[metric], closed[metric])
        _assert_close("fixture-vs-loop-recompute", metric, name, exp[metric], loop[metric])


@pytest.mark.parametrize("name", _NAMES)
def test_the_clock_mapping_matches_the_vector(name: str) -> None:
    """crypto -> 365, traditional -> 252 through `blend_periods_per_year`, never an unknown class."""
    vec = _BY_NAME[name]
    assert vec["asset_class"] in ("crypto", "traditional"), "an unknown-class leg is out of scope"
    assert _periods_for(vec) == vec["periods_per_year"]


@pytest.mark.parametrize("name", _NAMES)
def test_compute_all_metrics_sharpe(name: str) -> None:
    vec = _BY_NAME[name]
    rows = _build_chain(vec)
    got = compute_all_metrics(_series_from(rows), periods_per_year=_periods_for(vec))["sharpe"]
    _assert_close("compute_all_metrics", "sharpe", name, got, vec["expected"]["sharpe"])


@pytest.mark.parametrize("name", _NAMES)
def test_compute_all_metrics_cagr(name: str) -> None:
    vec = _BY_NAME[name]
    rows = _build_chain(vec)
    got = compute_all_metrics(_series_from(rows), periods_per_year=_periods_for(vec))["cagr"]
    _assert_close("compute_all_metrics", "cagr", name, got, vec["expected"]["cagr"])


@pytest.mark.parametrize("name", _NAMES)
def test_compute_all_metrics_twr(name: str) -> None:
    vec = _BY_NAME[name]
    rows = _build_chain(vec)
    got = compute_all_metrics(_series_from(rows), periods_per_year=_periods_for(vec))[
        "cumulative_return"
    ]
    _assert_close("compute_all_metrics", "twr(cumulative_return)", name, got, vec["expected"]["twr"])


@pytest.mark.parametrize("name", _NAMES)
def test_compute_sharpe_the_match_path(name: str) -> None:
    vec = _BY_NAME[name]
    got = _compute_sharpe(_suffix_series(vec), periods_per_year=_periods_for(vec))
    _assert_close("portfolio_optimizer._compute_sharpe", "sharpe", name, got, vec["expected"]["sharpe"])


@pytest.mark.parametrize("name", _NAMES)
def test_sharpe_vol_status_from_backbone_the_portfolio_analytics_path(name: str) -> None:
    vec = _BY_NAME[name]
    _vol, sharpe, status = sharpe_vol_status_from_backbone(
        _suffix_series(vec), _periods_for(vec)
    )
    assert status == "ok", f"{name}: backbone status {status!r}"
    _assert_close(
        "sharpe_vol_status_from_backbone", "sharpe", name, sharpe, vec["expected"]["sharpe"]
    )


@pytest.mark.parametrize("name", _NAMES)
def test_cumulative_twr_segmented_twr(name: str) -> None:
    """The segmented chain-link takes the suffix itself: it is handed the WHOLE chain."""
    vec = _BY_NAME[name]
    value, _flags = cumulative_twr_segmented(_series_from(_build_chain(vec)))
    _assert_close("cumulative_twr_segmented", "twr", name, value, vec["expected"]["twr"])


@pytest.mark.parametrize("name", _NAMES)
def test_total_return_from_equity_twr(name: str) -> None:
    """An equity series needs its base point: the endpoint ratio deliberately excludes day 0.

    The base is a 1.0 on the day before the first observation, so the ratio is the TWR over
    exactly the suffix's returns."""
    vec = _BY_NAME[name]
    suffix = _suffix(_build_chain(vec))
    equity = [1.0]
    for _, value in suffix:
        equity.append(equity[-1] * (1.0 + value))
    index = [pd.Timestamp(suffix[0][0] - dt.timedelta(days=1))] + [pd.Timestamp(d) for d, _ in suffix]
    got = total_return_from_equity(pd.Series(equity, index=pd.DatetimeIndex(index), dtype="float64"))
    _assert_close("total_return_from_equity", "twr", name, got, vec["expected"]["twr"])


def test_the_broken_chain_vector_really_breaks() -> None:
    """The stored engine cut at the break: its Sharpe is the suffix's, not the pooled series'."""
    vec = _BY_NAME["broken_chain_suffix"]
    rows = _build_chain(vec)
    assert sum(1 for _, v in rows if v is None) == 1
    pooled = _loop_oracle([(d, v) for d, v in rows if v is not None], vec["periods_per_year"])
    assert not _close(pooled["sharpe"], vec["expected"]["sharpe"]), (
        "the prefix pattern must move the pooled Sharpe, or the vector proves nothing about the cut"
    )
