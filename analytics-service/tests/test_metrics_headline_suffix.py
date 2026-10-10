"""FACTSHEETTRUTH item 2 (D-01, D-02, D-12): one headline series.

When an integrity guard leaves an INTERIOR NaN in the return series, every
headline stat of ``compute_all_metrics`` is computed on the SAME post-break
suffix, and the suffix's first day rides ``MetricsResult.headline_since``.

Oracle discipline (Rule 9): each test builds its own ``suffix_only`` series from
the position it chose for the last NaN, and never calls the module's own break
detector. A stat that still reads the full series cannot equal the suffix-only
compute, so the oracle cannot pass by re-deriving the seam.

Synthetic series only: this repo is public, never PROD data.
"""

from __future__ import annotations

import math

import numpy as np
import pandas as pd
import pytest

from services.metrics import compute_all_metrics

_START = "2025-01-01"


def _index(n: int) -> pd.DatetimeIndex:
    return pd.date_range(_START, periods=n, freq="D")


def _dispersing(n: int, seed: int) -> np.ndarray:
    """Daily returns with real dispersion and large moves (a young volatile book)."""
    rng = np.random.default_rng(seed)
    return rng.normal(0.002, 0.03, n)


def _broken_series(
    nan_positions: list[int],
    tail_len: int,
    *,
    head_len: int = 208,
    tail_zero: bool = False,
    seed: int = 11,
) -> pd.Series:
    """A head of ``head_len`` days holding interior NaNs at ``nan_positions``,
    then a ``tail_len`` tail. The LAST NaN sits at ``max(nan_positions)``; the
    suffix is everything after it (the test slices it itself)."""
    n = head_len + tail_len
    vals = _dispersing(n, seed)
    if tail_zero:
        vals[head_len:] = 0.0
    for p in nan_positions:
        vals[p] = np.nan
    return pd.Series(vals, index=_index(n), dtype="float64")


# Eight interior guard days, the last at index 207 (Quantum-Drift-shaped: the
# breaks are scattered, the final one sits just before a short tail).
_NANS = [30, 80, 81, 84, 85, 140, 175, 207]


def _inner(res, key: str):
    return res.metrics_json["metrics_json"][key]


def _same(a, b) -> bool:
    if a is None or b is None:
        return a is None and b is None
    return a == pytest.approx(b, rel=1e-12, abs=1e-15)


class TestHeadlineSince:
    """``headline_since`` is the ISO date of the suffix's first day on a
    chain-broken series, and None everywhere else. It is a FIELD, never a
    ``metrics_json`` key (that dict is spread into the upsert as columns)."""

    def test_headline_since_names_the_first_suffix_day(self):
        idx = _index(30)
        broken = pd.Series(_dispersing(30, 3), index=idx)
        broken.iloc[20] = np.nan
        res = compute_all_metrics(broken)
        # Day 20 is the last NaN, so day 21 is the first measured day.
        assert res.headline_since == idx[21].strftime("%Y-%m-%d")

        clean = pd.Series(_dispersing(30, 3), index=idx)
        assert compute_all_metrics(clean).headline_since is None

        leading = clean.copy()
        leading.iloc[0] = np.nan
        assert compute_all_metrics(leading).headline_since is None

        for r in (res, compute_all_metrics(clean), compute_all_metrics(leading)):
            assert "headline_since" not in r.metrics_json
            assert "headline_since" not in r.metrics_json["metrics_json"]


class TestRiskStatsOnTheSuffix:
    def test_risk_stats_equal_the_suffix_only_compute(self):
        """sharpe / volatility / sortino on a broken series equal the same stats
        computed on the suffix the test itself placed. Binding the seam's
        ``headline`` to the whole series turns this RED."""
        full = _broken_series(_NANS, tail_len=60)
        suffix_only = full.iloc[208:]  # the day after the last NaN (index 207)
        assert not suffix_only.isna().any()  # the test's own oracle is clean
        got = compute_all_metrics(full)
        want = compute_all_metrics(suffix_only)
        for key in ("sharpe", "volatility", "sortino"):
            assert want.metrics_json[key] is not None, f"fixture must measure {key}"
            assert _same(got.metrics_json[key], want.metrics_json[key]), key
        # Mutation-honest: the whole-series value really differs, so a seam that
        # reads the full series cannot pass by accident.
        whole = full.dropna()  # every valid day: what HEAD's risk stats read
        assert compute_all_metrics(whole).metrics_json["volatility"] != pytest.approx(
            want.metrics_json["volatility"], rel=1e-6
        )


# ---------------------------------------------------------------------------
# Task 2: every headline-class stat reads the suffix, with the code's own minimums
# ---------------------------------------------------------------------------

# (stat, where compute_all_metrics writes it). The six scalar-column stats sit on
# `metrics_json`; mtd / ytd / three_month sit one level down, in its nested dict.
_OUTER = (
    "cumulative_return",
    "cagr",
    "volatility",
    "sharpe",
    "sortino",
    "calmar",
    "max_drawdown",
    "max_drawdown_duration_days",
    "six_month_return",
)
_NESTED = ("mtd", "ytd", "three_month")
_ALL_STATS = _OUTER + _NESTED


def _stat(res, key: str):
    return res.metrics_json[key] if key in _OUTER else _inner(res, key)


class TestEveryHeadlineStatOnTheSuffix:
    @pytest.mark.parametrize("tail_len", [60, 140], ids=["tail60", "tail140"])
    @pytest.mark.parametrize("stat", _ALL_STATS)
    def test_every_headline_stat_equals_the_suffix_only_compute(self, stat, tail_len):
        """The oracle (Rule 9): for each headline stat, the full broken series
        equals the series the TEST sliced after its own last NaN (index 207).
        tail60 leaves the suffix under the 63 / 126-day window minimums (the window
        stats must then read None, exactly as the suffix-only compute does); tail140
        clears both, so the window stats compare two finite numbers."""
        full = _broken_series(_NANS, tail_len=tail_len)
        suffix_only = full.iloc[208:]
        assert not suffix_only.isna().any()
        got = _stat(compute_all_metrics(full), stat)
        want = _stat(compute_all_metrics(suffix_only), stat)
        assert _same(got, want), f"{stat}: full={got!r} suffix-only={want!r}"

    def test_the_window_stats_are_measured_in_the_long_fixture(self):
        """Fixture honesty: in tail140 the oracle compares two finite window
        returns, so a stat that always returned None could not pass for free."""
        want = compute_all_metrics(_broken_series(_NANS, tail_len=140).iloc[208:])
        assert want.metrics_json["six_month_return"] is not None
        assert _inner(want, "three_month") is not None
        assert want.metrics_json["max_drawdown"] < 0.0

    def test_flat_twelve_day_suffix(self):
        """D-12 (the Quantum Drift shape): a long dispersing record, an interior
        break, then 12 exact-zero days. The suffix measures nothing it cannot:
        dispersion stats and windows are None, the flat stats are a true 0.0."""
        full = _broken_series(_NANS, tail_len=12, tail_zero=True)
        res = compute_all_metrics(full)
        mj = res.metrics_json
        assert res.headline_since == full.index[208].strftime("%Y-%m-%d")
        for key in ("sharpe", "sortino", "calmar", "six_month_return"):
            assert mj[key] is None, key
        assert _inner(res, "three_month") is None
        assert mj["volatility"] == 0.0
        assert mj["cumulative_return"] == 0.0
        assert mj["cagr"] == 0.0
        assert mj["max_drawdown"] == 0.0
        # Mutation-honest: the HEAD-style whole-record Sharpe of the SAME fixture is
        # a finite number, so this cannot pass on a fixture that never had one.
        whole = compute_all_metrics(full.dropna())
        assert whole.metrics_json["sharpe"] is not None
        assert math.isfinite(whole.metrics_json["sharpe"])

    @pytest.mark.parametrize("last_day", [0.01, -0.02], ids=["up", "down"])
    def test_one_day_suffix(self, last_day):
        """D-02: a break on the penultimate day leaves ONE measured day. The
        cumulative return stays finite (the composite read gate needs it), and
        every stat that needs two days or dispersion is None, never 0. A losing
        last day is included because one number's downside RMS is not a Sortino."""
        idx = _index(40)
        vals = _dispersing(40, 5)
        vals[38] = np.nan
        vals[39] = last_day
        res = compute_all_metrics(pd.Series(vals, index=idx))
        mj = res.metrics_json
        assert res.headline_since == idx[39].strftime("%Y-%m-%d")
        assert mj["cumulative_return"] == pytest.approx(last_day, rel=1e-12)
        for key in (
            "cagr", "calmar", "sharpe", "sortino", "volatility",
            "max_drawdown", "max_drawdown_duration_days",
        ):
            assert mj[key] is None, key
        assert _inner(res, "three_month") is None

    def test_interior_and_trailing_nan(self):
        """An interior break AND trailing NaN days: the headline anchors on the
        suffix's LAST VALID day, not on the series' last row. Here the trailing NaN
        days cross into the next month, so a headline anchored on the last row reads
        a bogus all-NaN 'month to date' of 0.0."""
        idx = _index(70)  # day 55 is 2025-02-25; days 56..69 run into March
        vals = _dispersing(70, 9)
        vals[20] = np.nan
        vals[56:] = np.nan
        full = pd.Series(vals, index=idx)
        suffix_only = full.iloc[21:56]
        assert not suffix_only.isna().any()
        assert idx[55].month == 2 and idx[69].month == 3  # the fixture's whole point
        got = compute_all_metrics(full)
        want = compute_all_metrics(suffix_only)
        assert got.headline_since == idx[21].strftime("%Y-%m-%d")
        for key in ("mtd", "ytd"):
            assert _inner(want, key) is not None
            assert _same(_inner(got, key), _inner(want, key)), key
        for key in _OUTER:
            assert _same(got.metrics_json[key], want.metrics_json[key]), key

    def test_chart_series_keep_the_whole_record(self):
        """Pitfall 1: the headline suffix must never shorten the chart objects. On a
        broken series the equity and drawdown curves keep every day, and every
        non-empty sibling kind reaches back BEFORE the suffix's first day (a series
        rebound to the 60-day suffix could not hold a row dated before it). Sibling
        kinds legitimately skip NaN days, so the oracle is the date reach, not a
        length equal to a zero-filled twin."""
        full = _broken_series(_NANS, tail_len=60)
        got = compute_all_metrics(full)
        since = got.headline_since
        assert since == full.index[208].strftime("%Y-%m-%d")
        for curve in ("returns_series", "drawdown_series"):
            rows = got.metrics_json[curve]
            assert len(rows) == len(full), curve
            assert rows[0]["date"] == full.index[0].strftime("%Y-%m-%d"), curve
        # The rolling kinds are empty here (a NaN sits in every window), so the two
        # per-day kinds are the ones that must be present: the loop below cannot
        # pass on an all-empty dict.
        for kind in ("daily_returns_grid", "log_returns_series"):
            assert got.sibling_kinds[kind], kind
        for kind, rows in got.sibling_kinds.items():
            if rows:
                assert rows[0]["date"] < since, f"{kind} starts inside the suffix"


class TestIdentityOnUnbrokenSeries:
    def test_identity_on_clean_and_leading_nan_series(self):
        """RESEARCH 1.2: with no INTERIOR NaN the suffix is the whole valid series,
        so there is no headline note. Byte identity of ``metrics_json`` itself is
        pinned by the golden, minigolden and parity suites, which carry HEAD's
        values; this pins the flag side of the same rule."""
        idx = _index(120)
        base = pd.Series(_dispersing(120, 21), index=idx)
        leading = base.copy()
        leading.iloc[:3] = np.nan
        trailing = base.copy()
        trailing.iloc[-3:] = np.nan
        for name, series in (("clean", base), ("leading", leading), ("trailing", trailing)):
            res = compute_all_metrics(series)
            assert res.headline_since is None, name
