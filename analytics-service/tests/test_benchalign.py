"""Phase 166.4 BENCHALIGN (D-A, D-02, D-04, D-05): every benchmark metric reads ONE interval-matched pair.

A strategy whose calendar is sparser than BTC's 7-day calendar (weekday-only,
say) holds each position from its previous date to its current date. Its Monday
return is the move from Friday's close to Monday's close, so the benchmark
return it must be regressed on is BTC's Friday-to-Monday move, compounded,
not BTC's Sunday-to-Monday daily move. Measured before this phase: on the
committed weekday fixture (``_q166_calendar_mismatch``) the persisted beta was
+0.012560995909126458, from M1's daily inner join; the regression on the
Friday-to-Monday interval pair is about -0.00742, the opposite sign.

The invariant (166.4 D-A): each strategy date t_k is paired with the benchmark
return over (t_{k-1}, t_k], and the interval is paired ONLY when the benchmark
has a close dated t_{k-1} AND a close dated t_k. Anything else is excluded from
the pair, never filled. Index 0 (no previous strategy date) is paired with the
benchmark return dated t_0 when the benchmark has one (D-05), and is unpaired
otherwise, never a fabricated 0.

Cross-citation (D-02): the TypeScript comparator of Phase 169.5 BENCHCOMPARE,
``src/lib/factsheet/align.ts``, applies the same pairing rule (its D-58
amendment). The two differ at index 0 only: 169.5 keeps index 0 = 0 (its D-54
parity convention), while this engine pairs index 0 with the benchmark return
dated t_0 (166.4 D-05).

Every oracle here is written from the definition (price ratios of the
benchmark's own closes, ``np.cov``), never from the helper under test.
"""

from __future__ import annotations

import logging

import numpy as np
import pandas as pd
import pytest

from services.metrics import _benchmark_pair, compute_all_metrics
from tests.test_metrics import _q166_calendar_mismatch, _q166_raw_pair_regression


def _price_ratio_interval_oracle(strategy_index: pd.DatetimeIndex, benchmark: pd.Series) -> pd.Series:
    """The benchmark return over (t_{k-1}, t_k] for each strategy date, from PRICE RATIOS.

    ``price = (1 + benchmark).cumprod()`` rebuilds the benchmark's own closes;
    k >= 1 is ``price[t_k] / price[t_{k-1}] - 1``; index 0 is the benchmark
    return dated t_0 (166.4 D-05). Valid only when every strategy date is a
    benchmark close, which each caller asserts first.
    """
    price = (1.0 + benchmark).cumprod()
    s = strategy_index
    values = [float(benchmark[s[0]])] + [
        float(price[s[k]] / price[s[k - 1]] - 1.0) for k in range(1, len(s))
    ]
    return pd.Series(values, index=s)


def test_benchalign_weekday_beta_is_the_friday_to_monday_regression(caplog):
    """SC3 (166.4 D-A): the weekday strategy's beta is the OLS slope on the Friday-to-Monday interval pair.

    Measured on the unchanged engine: beta +0.012560995909126458 (M1's inner
    join pairs each Monday with BTC's Sunday-to-Monday move). The interval
    regression is about -0.0074239186416205985, the opposite sign. The fixture
    starts on a Thursday, so index 0 is mid-week and the D-05 convention there
    is unambiguous.
    """
    strategy, benchmark = _q166_calendar_mismatch()
    s = strategy.index
    # Preconditions: the strategy really is sparser than the benchmark (it has
    # multi-day intervals), starts mid-week, and every strategy date is a
    # benchmark close with a finite return (so the price-ratio oracle is valid).
    assert (s[1:] - s[:-1]).max() > pd.Timedelta(days=1)
    assert s[0].dayofweek == 3
    assert s.isin(benchmark.index).all() and benchmark.notna().all()

    oracle = _price_ratio_interval_oracle(s, benchmark)
    _, expected_beta = _q166_raw_pair_regression(strategy, oracle, 252)
    assert expected_beta < 0.0, expected_beta

    caplog.set_level(logging.WARNING, logger="quantalyze.analytics.metrics")
    mj = compute_all_metrics(strategy, benchmark)["metrics_json"]
    assert mj["beta"] == pytest.approx(expected_beta, rel=1e-9, abs=0.0), (
        f"beta={mj['beta']}; OLS slope on the Friday-to-Monday interval pair is {expected_beta}"
    )
    assert np.sign(mj["beta"]) == np.sign(expected_beta)
    fanout = [r for r in caplog.records if "benchmark_metrics fan-out failed" in r.getMessage()]
    assert fanout == [], [r.getMessage() for r in fanout]


def _dense_daily(start: str, periods: int, seed: int) -> pd.Series:
    idx = pd.date_range(start, periods=periods, freq="D")
    return pd.Series(np.random.default_rng(seed).normal(0.0005, 0.02, periods), index=idx)


def test_benchalign_d04_benchmark_sparser_monday_is_unpaired():
    """166.4 D-04 (ratified by the founder 2026-09-27): the both-endpoints rule applies when the BENCHMARK is the sparser leg.

    A daily strategy against a business-day benchmark: a Monday's interval is
    (Sunday, Monday], and the benchmark has no close dated Sunday, so every
    Monday leaves the pair. Pairing it with the benchmark's Friday-to-Monday
    move would set a one-day strategy move against a three-day benchmark move,
    the mirror image of the defect D-A fixes. The strategy starts on a
    Wednesday so index 0 (paired by D-05) is not a Monday.
    """
    strategy = _dense_daily("2024-01-03", 120, 16641)
    b_idx = pd.bdate_range("2024-01-01", periods=85)
    benchmark = pd.Series(np.random.default_rng(16642).normal(0.0004, 0.03, len(b_idx)), index=b_idx)
    assert strategy.index[0].dayofweek == 2

    r, b = _benchmark_pair(strategy, benchmark)
    assert r.index.equals(b.index)
    overlap = strategy.index[strategy.index.isin(benchmark.index)]
    unpaired = overlap[~overlap.isin(r.index)]
    mondays = overlap[overlap.dayofweek == 0]
    assert len(mondays) > 0
    assert unpaired.equals(mondays), (list(unpaired), list(mondays))
    # Every paired date is a Tuesday-to-Friday one-day interval, taken verbatim.
    assert set(r.index.dayofweek) <= {1, 2, 3, 4}
    assert (b.to_numpy() == benchmark.loc[b.index].to_numpy()).all()


def test_benchalign_d05_index_zero_pairs_with_the_t0_return():
    """166.4 D-05 (ratified by the founder 2026-09-27): a strategy whose t_0 is a benchmark close pairs index 0 with the return dated t_0, bit-for-bit."""
    benchmark = _dense_daily("2024-01-01", 200, 16643)
    strategy = _dense_daily("2024-02-10", 60, 16644)
    t0 = strategy.index[0]
    assert t0 in benchmark.index and np.isfinite(benchmark[t0])

    r, b = _benchmark_pair(strategy, benchmark)
    assert r.index[0] == t0 and b.index[0] == t0
    assert b.iloc[0] == benchmark[t0]
    assert len(r) == len(strategy)


def test_benchalign_d05_index_zero_unpaired_without_a_t0_close():
    """166.4 D-05 (ratified by the founder 2026-09-27): with no benchmark return dated t_0, index 0 is unpaired, never a fabricated 0.

    The strategy starts five days before the benchmark, so t_0 is neither a
    benchmark date nor the D-07 base close (the day before the first return).
    """
    benchmark = _dense_daily("2024-01-10", 120, 16645)
    strategy = _dense_daily("2024-01-05", 60, 16646)
    t0 = strategy.index[0]
    base_close = benchmark.index[0] - pd.Timedelta(days=1)
    assert t0 not in benchmark.index and t0 != base_close

    r, b = _benchmark_pair(strategy, benchmark)
    assert t0 not in r.index and t0 not in b.index
    # Nothing before the benchmark's first return is paired, and no 0.0 was
    # written for a date the benchmark does not cover.
    assert b.index.min() >= benchmark.index[0]
    assert (b.to_numpy() == benchmark.loc[b.index].to_numpy()).all()


def test_benchalign_d07_base_close_keeps_the_first_in_window_pair():
    """166.4 D-07 (2026-09-27, ratified by the founder 2026-09-27): the day before the benchmark's first return is a close.

    A dense daily strategy whose t_0 is exactly one day before the benchmark's
    first stored return: t_0 has no benchmark return dated t_0, so it is
    unpaired (D-05), and t_1 pairs with the benchmark return dated t_1 bit-for-bit
    because t_0 counts as the base close. Without that convention t_1 would be
    unpaired too, and a dense strategy older than the BTC window would lose its
    first in-window pair.
    """
    benchmark = _dense_daily("2024-03-01", 120, 16647)
    strategy = _dense_daily("2024-02-29", 60, 16648)
    t0, t1 = strategy.index[0], strategy.index[1]
    assert t0 == benchmark.index[0] - pd.Timedelta(days=1)
    assert t1 == benchmark.index[0]

    r, b = _benchmark_pair(strategy, benchmark)
    assert t0 not in r.index
    assert r.index[0] == t1
    assert b.iloc[0] == benchmark[t1]


def test_benchalign_pair_sorts_the_strategy_and_refuses_duplicate_dates():
    """166.4 D-A: the pair sorts an unsorted strategy and refuses a duplicated date on either leg.

    ``np.searchsorted`` reads a sorted index, and not every production entry
    point sorts. A duplicated date would define one interval twice; choosing
    between the two values would be a guess, so the pair is refused loudly.
    """
    benchmark = _dense_daily("2024-01-01", 200, 16649)
    idx = pd.bdate_range("2024-02-01", periods=80)
    strategy = pd.Series(np.random.default_rng(16650).normal(0.0005, 0.01, len(idx)), index=idx)
    shuffled = strategy.iloc[np.random.default_rng(16651).permutation(len(strategy))]
    assert not shuffled.index.is_monotonic_increasing

    r_sorted, b_sorted = _benchmark_pair(strategy, benchmark)
    r_shuf, b_shuf = _benchmark_pair(shuffled, benchmark)
    pd.testing.assert_series_equal(r_shuf, r_sorted, check_freq=False)
    pd.testing.assert_series_equal(b_shuf, b_sorted, check_freq=False)

    dup_strategy = pd.concat([strategy, strategy.iloc[[5]]])
    with pytest.raises(ValueError, match="166.4 D-A"):
        _benchmark_pair(dup_strategy, benchmark)
    dup_benchmark = pd.concat([benchmark, benchmark.iloc[[7]]])
    with pytest.raises(ValueError, match="166.4 D-A"):
        _benchmark_pair(strategy, dup_benchmark)
