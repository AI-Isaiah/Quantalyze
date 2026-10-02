"""Seeded dense fixtures for the Phase 166.4 BENCHALIGN SC4 parity tests (166.4-02).

Each case is a DENSE daily strategy against a contiguous 7-day benchmark, the
shape under which the 166.4 D-A interval pair must reduce to the daily inner
join. ``tests/test_benchalign.py`` imports ``dense_case``; so does the one-off
measurement that ran the BASE commit's ``compute_all_metrics`` on these
fixtures to record the r_squared values the pre-change engine produced
(166.4 D-06). That measurement runs on a tree where no 166.4 symbol exists,
which is why this module imports only numpy and pandas.

A test module imports fixtures from here, never from another test module.
"""

import numpy as np
import pandas as pd

DENSE_CASE_IDS = ("inside_coverage", "older_than_window", "nan_guard_days")


def _contiguous_benchmark(seed: int) -> pd.Series:
    """A 1000-day contiguous 7-day benchmark ending on a fixed date (the BTC cache-path shape)."""
    idx = pd.date_range(end="2026-06-30", periods=1000, freq="D")
    return pd.Series(np.random.default_rng(seed).normal(0.0004, 0.03, len(idx)), index=idx, name="BTC")


def _daily(start: pd.Timestamp, periods: int, seed: int) -> pd.Series:
    idx = pd.date_range(start, periods=periods, freq="D")
    return pd.Series(
        np.random.default_rng(seed).normal(0.0005, 0.02, periods), index=idx, name="returns"
    )


def dense_case(name: str) -> tuple[pd.Series, pd.Series]:
    """(strategy, benchmark) for one dense SC4 case.

    - ``inside_coverage``: 400 daily points strictly inside the benchmark's
      coverage.
    - ``older_than_window``: a daily strategy starting 30 days before the
      benchmark's first return date and ending one day after its last. It
      exercises the 166.4 D-07 base close (the day before the first return is
      a close, so the first in-window date stays paired) and the 166.4 D-05
      index-0 convention.
    - ``nan_guard_days``: ``inside_coverage`` with 3 interior NaN strategy days
      (the broker guard-day shape).
    """
    benchmark = _contiguous_benchmark(166420)
    if name in ("inside_coverage", "nan_guard_days"):
        strategy = _daily(benchmark.index[300], 400, 166421)
        if name == "nan_guard_days":
            strategy = strategy.copy()
            strategy.iloc[[41, 177, 356]] = np.nan
        return strategy, benchmark
    if name == "older_than_window":
        start = benchmark.index[0] - pd.Timedelta(days=30)
        periods = len(benchmark) + 30 + 1
        strategy = _daily(start, periods, 166422)
        return strategy, benchmark
    raise ValueError(f"unknown dense case {name!r}")
