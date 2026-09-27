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

from services.metrics import compute_all_metrics
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
