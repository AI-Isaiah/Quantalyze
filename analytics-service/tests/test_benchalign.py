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
benchmark's own closes, ``np.cov``), never from the helper under test. The
dense-parity oracles of 166.4-02 (SC4, SC5) are the one exception in kind:
they run the engine's own metric mirrors on the daily INNER-JOIN pair, built
here by date lookup and never by ``_benchmark_pair``, because the claim under
test is that the pairing reduces to that inner join bit-for-bit.

SC5 TRACE (166.4-02; RESEARCH Q2, Q8). Only user CSV series reach the engine
with a sparse calendar. The single-key broker path (the broker-sourced branch
of ``analytics_runner.run_csv_strategy_analytics``, and the mark-to-market and
smoothed bases of the job worker's broker-dailies derive) hands the engine a
dense daily index: every calendar day in [first, last], with NaN on guard days
(``densify_policy="broker_nan"``) or 0.0 on absent days (the
``derive_basis_series`` default gap-fill). The cash basis is stated PER PATH,
because the two cash derives differ. The single-key broker cash derive in
``job_worker.py`` passes ``None`` as the benchmark, so no benchmark metric
exists on that basis. ``run_stitch_composite_job``'s composite cash derive
passes ``benchmark_rets`` with ``scalar_returns=gap_fill_daily_returns(stitched_cash)``
and ``densify_policy="zero_fill"``: benchmarked, zero_fill-densified and dense
(the path the zero_fill test below exercises). ``stitch_composite`` hands every
basis a dense gap-filled index. Against a contiguous BTC series every interval
of a dense index is one day long, so the 166.4 D-A pair equals the daily inner
join and no stored alpha, beta, correlation, info_ratio, treynor,
btc_rolling_correlation_90d or rolling alpha/beta value moves. r_squared moves
(166.4 D-06), because before this phase it ran its own back-filled reindex with
index 0 zero-filled. One behaviour changes on these paths beyond r_squared:
when BTC itself has a gap (the stale-cache fallback), the day after the gap is
now unpaired instead of being paired with a two-day BTC move.
"""

from __future__ import annotations

import logging

import numpy as np
import pandas as pd
import pytest

from services.basis_series import derive_basis_series
from services.metrics import (
    DEFAULT_PERIODS_PER_YEAR,
    _annualized_vol_sharpe,
    _benchmark_pair,
    _finalize_rolling,
    _greeks_no_guess,
    _rolling_alpha_beta,
    _rolling_correlation,
    _rolling_greeks,
    _safe_float,
    compute_all_metrics,
    strategy_calendar_is_sparse,
)
from tests.test_metrics import (
    _Q166_ROLLING_WINDOW,
    _Q166_WRITTEN_TOLERANCE,
    _q166_calendar_mismatch,
    _q166_raw_pair_regression,
    _q166_windowed_regression,
)

_METRICS_LOGGER = "quantalyze.analytics.metrics"


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


# ---------------------------------------------------------------------------
# SC1 (166.4 D-A): ONE pairing feeds every benchmark-relative metric, scalar
# and rolling, and r_squared is the squared correlation of that pair.
# ---------------------------------------------------------------------------


def _fanout_warnings(caplog) -> list[str]:
    return [
        r.getMessage() for r in caplog.records if "benchmark_metrics fan-out failed" in r.getMessage()
    ]


def _one_pairing_fixture(name: str) -> tuple[pd.Series, pd.Series]:
    """(strategy, benchmark) for the three SC1 r_squared cases, each asserting its own precondition."""
    if name == "sparse_weekday":
        strategy, benchmark = _q166_calendar_mismatch()
        s = strategy.index
        assert (s[1:] - s[:-1]).max() > pd.Timedelta(days=1), "no multi-day interval"
        return strategy, benchmark
    benchmark = _dense_daily("2024-01-01", 400, 16652)
    b_steps = benchmark.index[1:] - benchmark.index[:-1]
    assert (b_steps == pd.Timedelta(days=1)).all(), "the dense benchmark must be contiguous"
    strategy = _dense_daily("2024-03-01", 200, 16653)
    assert strategy.index.isin(benchmark.index).all()
    if name == "dense_daily":
        return strategy, benchmark
    if name == "dense_daily_with_nan_days":
        strategy = strategy.copy()
        strategy.iloc[[20, 71, 150]] = np.nan
        assert int(strategy.isna().sum()) == 3
        return strategy, benchmark
    raise AssertionError(f"unknown fixture {name!r}")


@pytest.mark.parametrize(
    "fixture_name", ("sparse_weekday", "dense_daily", "dense_daily_with_nan_days")
)
def test_benchalign_one_pairing_r_squared_is_correlation_squared(fixture_name, caplog):
    """SC1 (166.4 D-A, D-06): the persisted r_squared is the square of the persisted correlation.

    Both are read off the ONE interval pair, so on sparse, dense and NaN-day
    series r_squared equals correlation squared (rel 1e-12: ``linregress``
    and pandas ``corr`` differ by about 1e-16). Before this phase r_squared
    ran its own back-filled reindex with index 0 zero-filled and the strategy's
    NaN days zero-filled, so it differed from correlation squared on all three.
    """
    strategy, benchmark = _one_pairing_fixture(fixture_name)
    caplog.set_level(logging.WARNING, logger=_METRICS_LOGGER)
    mj = compute_all_metrics(strategy, benchmark)["metrics_json"]
    assert _fanout_warnings(caplog) == []
    assert mj["r_squared_status"] == "ok", mj["r_squared_status"]
    assert mj["correlation"] is not None
    assert mj["r_squared"] == pytest.approx(mj["correlation"] ** 2, rel=1e-12, abs=0.0), (
        f"r_squared={mj['r_squared']} vs correlation squared {mj['correlation'] ** 2} on {fixture_name}"
    )


def test_benchalign_one_pairing_rolling_greeks_are_the_interval_regression():
    """SC1 (166.4 D-A): the rolling alpha and beta regress on the same interval pair as the scalars.

    Before this phase ``_rolling_alpha_beta`` built its OWN daily inner join,
    a second pairing next to the scalar fan-out's. The oracle is the in-test
    windowed OLS over (strategy, price-ratio interval benchmark), the last 90
    paired intervals ending on the strategy's last date.
    """
    strategy, benchmark = _q166_calendar_mismatch()
    s = strategy.index
    assert s.isin(benchmark.index).all() and benchmark.notna().all()
    oracle = _price_ratio_interval_oracle(s, benchmark)
    anchor = _q166_windowed_regression(strategy, oracle, _Q166_ROLLING_WINDOW)

    alpha, beta = _rolling_alpha_beta(strategy, benchmark, _Q166_ROLLING_WINDOW)
    assert beta and alpha, "rolling greeks are empty on a 160-row weekday pair"
    assert beta[-1]["date"] == s[-1].strftime("%Y-%m-%d")
    assert alpha[-1]["date"] == s[-1].strftime("%Y-%m-%d")
    exp_beta, exp_alpha = float(anchor["beta"].iloc[-1]), float(anchor["alpha"].iloc[-1])
    assert abs(beta[-1]["value"] - exp_beta) <= _Q166_WRITTEN_TOLERANCE, (
        f"rolling beta last point={beta[-1]['value']}; interval regression slope is {exp_beta}"
    )
    assert abs(alpha[-1]["value"] - exp_alpha) <= _Q166_WRITTEN_TOLERANCE, (
        f"rolling alpha last point={alpha[-1]['value']}; interval intercept is {exp_alpha}"
    )


def test_benchalign_one_pairing_rolling_correlation_is_the_interval_correlation(caplog):
    """SC1 (166.4 D-A): btc_rolling_correlation_90d's last point is the Pearson correlation over the last 90 paired intervals."""
    strategy, benchmark = _q166_calendar_mismatch()
    s = strategy.index
    assert s.isin(benchmark.index).all() and benchmark.notna().all()
    oracle = _price_ratio_interval_oracle(s, benchmark)
    w = _Q166_ROLLING_WINDOW
    expected = float(np.corrcoef(strategy.to_numpy()[-w:], oracle.to_numpy()[-w:])[0, 1])

    caplog.set_level(logging.WARNING, logger=_METRICS_LOGGER)
    mj = compute_all_metrics(strategy, benchmark)["metrics_json"]
    assert _fanout_warnings(caplog) == []
    series = mj["btc_rolling_correlation_90d"]
    assert series, "btc_rolling_correlation_90d is empty on a 160-row weekday pair"
    assert series[-1]["date"] == s[-1].strftime("%Y-%m-%d")
    assert abs(series[-1]["value"] - expected) <= _Q166_WRITTEN_TOLERANCE, (
        f"rolling correlation last point={series[-1]['value']}; interval correlation is {expected}"
    )


def test_benchalign_one_pairing_scalars_share_the_pair(caplog):
    """SC1 (166.4 D-A): alpha, beta, correlation, info_ratio and treynor all equal oracles on the ONE price-ratio pair.

    No metric may read a second pairing: each expected value is computed on
    the same (strategy, interval benchmark) pair, from the definition.
    """
    strategy, benchmark = _q166_calendar_mismatch()
    s = strategy.index
    assert s.isin(benchmark.index).all() and benchmark.notna().all()
    oracle = _price_ratio_interval_oracle(s, benchmark)
    periods = DEFAULT_PERIODS_PER_YEAR
    exp_alpha, exp_beta = _q166_raw_pair_regression(strategy, oracle, periods)
    exp_corr = float(np.corrcoef(strategy.to_numpy(), oracle.to_numpy())[0, 1])
    excess = strategy - oracle
    exp_ir = float(excess.mean() * periods / (excess.std() * np.sqrt(periods)))

    caplog.set_level(logging.WARNING, logger=_METRICS_LOGGER)
    out = compute_all_metrics(strategy, benchmark)
    mj = out["metrics_json"]
    assert _fanout_warnings(caplog) == []
    assert mj["alpha"] == pytest.approx(exp_alpha, rel=1e-9, abs=0.0)
    assert mj["beta"] == pytest.approx(exp_beta, rel=1e-9, abs=0.0)
    assert mj["correlation"] == pytest.approx(exp_corr, rel=1e-9, abs=0.0)
    assert mj["info_ratio"] == pytest.approx(exp_ir, rel=1e-9, abs=0.0)
    assert out["cagr"] is not None
    assert mj["treynor"] == pytest.approx(out["cagr"] / exp_beta, rel=1e-9, abs=0.0)


def test_benchalign_zone_mismatch_degrades_through_compute_all_metrics(caplog):
    """T-166.4-03: a pair labelled in different time zones degrades through ``compute_all_metrics``; it never raises.

    A naive daily strategy against the same dates localized to Asia/Tokyo (the
    shape of ``test_q166r2_a_pair_labelled_in_different_zones_is_refused_not_shifted``).
    The pair is refused by name inside each existing handler: the scalar
    fan-out logs its WARNING and writes none of its keys, the rolling leg logs
    its WARNING and returns no points, and r_squared is None with status
    ``error``. Before this phase the rolling leg's own inner join raised
    ``TypeError: Cannot join tz-naive with tz-aware DatetimeIndex`` outside its
    ``try``, so ``compute_all_metrics`` raised.
    """
    idx = pd.date_range("2024-01-01", periods=200, freq="D")
    r = pd.Series(np.random.default_rng(3).normal(0.001, 0.01, 200), index=idx)
    b_tokyo = pd.Series(np.random.default_rng(4).normal(0.001, 0.02, 200), index=idx).tz_localize(
        "Asia/Tokyo"
    )

    caplog.set_level(logging.WARNING, logger=_METRICS_LOGGER)
    result = compute_all_metrics(r, b_tokyo)
    messages = [rec.getMessage() for rec in caplog.records]
    assert any("benchmark_metrics fan-out failed" in m for m in messages), messages
    assert any("rolling_greeks failed" in m for m in messages), messages
    mj = result["metrics_json"]
    for key in ("alpha", "beta", "correlation", "info_ratio", "treynor", "btc_rolling_correlation_90d"):
        assert key not in mj, (key, mj.get(key))
    assert result.sibling_kinds["rolling_alpha"] == []
    assert result.sibling_kinds["rolling_beta"] == []
    assert mj["r_squared"] is None and mj["r_squared_status"] == "error"


# ---------------------------------------------------------------------------
# SC7 / 166.4 D-03: the engine's definition of a sparse calendar, which
# Phase 166.3 cites by name to widen its recompute set.
# ---------------------------------------------------------------------------


def test_benchalign_sparse_predicate_true_on_weekday_calendar():
    """SC7 (166.4 D-03): a business-day calendar is sparse (a Friday-to-Monday step is three days)."""
    strategy, _ = _q166_calendar_mismatch()
    assert strategy_calendar_is_sparse(strategy.index) is True


def test_benchalign_sparse_predicate_false_on_dense_calendar():
    """SC7 (166.4 D-03): a daily calendar is dense, with or without NaN guard days; empty and single-date indexes are not sparse.

    NaN values do not remove dates: a broker series with NaN guard days keeps
    every calendar day in its index, so against a contiguous benchmark its
    interval pair equals the daily inner join.
    """
    daily = _dense_daily("2023-01-01", 400, 16654)
    assert strategy_calendar_is_sparse(daily.index) is False
    with_nan = daily.copy()
    with_nan.iloc[[10, 200, 399]] = np.nan
    assert int(with_nan.isna().sum()) == 3
    assert strategy_calendar_is_sparse(with_nan.index) is False
    assert strategy_calendar_is_sparse(pd.DatetimeIndex([])) is False
    assert strategy_calendar_is_sparse(daily.index[:1]) is False


# ---------------------------------------------------------------------------
# SC4 / SC5 (166.4-02): on dense series against a contiguous benchmark the ONE
# interval pair IS the daily inner join, so the benchmark family is
# bit-identical to what M1's inner join produced. r_squared is the stated
# exception (166.4 D-06).
# ---------------------------------------------------------------------------

_BENCHMARK_FAMILY_SCALARS = ("alpha", "beta", "correlation", "info_ratio", "treynor")


def _assert_contiguous(benchmark: pd.Series) -> None:
    """The SC4 precondition: every consecutive benchmark step is one calendar day, no NaN."""
    steps = benchmark.index[1:] - benchmark.index[:-1]
    assert (steps == pd.Timedelta(days=1)).all(), "the benchmark must be contiguous (SC4 precondition)"
    assert benchmark.notna().all()


def _inner_join_pair(strategy: pd.Series, benchmark: pd.Series) -> tuple[pd.Series, pd.Series]:
    """M1's daily inner join, built by DATE LOOKUP (never by ``_benchmark_pair``).

    Both legs carry the strategy's own sorted index restricted to the dates the
    benchmark carries, exactly the shape the engine's pair legs carry. Strategy
    NaN is kept, as the engine keeps it.
    """
    r = strategy.sort_index()
    r_ij = r[r.index.isin(benchmark.index)]
    b_ij = pd.Series(benchmark.reindex(r_ij.index).to_numpy(), index=r_ij.index)
    return r_ij, b_ij


def _inner_join_family(
    r_ij: pd.Series, b_ij: pd.Series, periods_per_year: int, cagr: float | None
) -> dict[str, object]:
    """The benchmark family computed by the engine's own mirrors on the inner-join pair.

    Mirrors the ``compute_all_metrics`` fan-out: ``_greeks_no_guess`` for alpha
    and beta, pandas ``corr`` for correlation, ``_annualized_vol_sharpe`` of the
    excess for info_ratio, the engine's own full-series cagr over beta for
    treynor, ``_rolling_correlation`` for the 90-day correlation, and
    ``_rolling_greeks`` plus ``_finalize_rolling`` for the rolling siblings.
    """
    alpha, beta = _greeks_no_guess(r_ij, b_ij, periods_per_year)
    beta_f = _safe_float(beta)
    te, info_ratio = _annualized_vol_sharpe(r_ij - b_ij, periods_per_year)
    greeks = _rolling_greeks(r_ij, b_ij, 90)
    return {
        "alpha": _safe_float(alpha),
        "beta": beta_f,
        "correlation": _safe_float(r_ij.corr(b_ij)),
        "info_ratio": _safe_float(info_ratio) if te > 0 else None,
        "treynor": _safe_float(cagr / beta_f) if beta_f and cagr is not None else None,
        "btc_rolling_correlation_90d": _rolling_correlation(r_ij, b_ij, 90),
        "rolling_alpha": _finalize_rolling(greeks["alpha"]),
        "rolling_beta": _finalize_rolling(greeks["beta"]),
    }


def _assert_family_is_the_inner_join(
    outer: dict, sibling_kinds: dict, strategy: pd.Series, benchmark: pd.Series, periods_per_year: int
) -> None:
    """``==`` (bit-identity) on the whole benchmark family, and the pair legs ARE the inner-join legs."""
    r_ij, b_ij = _inner_join_pair(strategy, benchmark)
    expected = _inner_join_family(r_ij, b_ij, periods_per_year, outer["cagr"])
    mj = outer["metrics_json"]
    for key in _BENCHMARK_FAMILY_SCALARS:
        # Anti-vacuity: a key a swallowed fan-out exception dropped, or a None
        # on both sides, would make the equality meaningless.
        assert key in mj and expected[key] is not None, (key, mj.get(key), expected[key])
        assert mj[key] == expected[key], f"{key}: engine {mj[key]!r} != inner join {expected[key]!r}"
    for key in ("btc_rolling_correlation_90d",):
        assert expected[key], key
        assert mj[key] == expected[key], key
    for kind in ("rolling_alpha", "rolling_beta"):
        assert expected[kind], kind
        assert sibling_kinds[kind] == expected[kind], kind

    r, b = _benchmark_pair(strategy, benchmark)
    assert r.index.equals(r_ij.index) and b.index.equals(r_ij.index)
    assert np.array_equal(b.to_numpy(), b_ij.to_numpy())
    # The strategy leg carries NaN guard days on purpose; NaN never equals NaN
    # under the default, so equal_nan is what compares identical legs.
    assert np.array_equal(r.to_numpy(), r_ij.to_numpy(), equal_nan=True)

    # 166.4 D-06: r_squared is NOT asserted ==; it is the square of the pair's
    # correlation (``linregress`` and ``corr`` differ by about 1e-16).
    assert mj["r_squared_status"] == "ok", mj["r_squared_status"]
    assert mj["r_squared"] == pytest.approx(mj["correlation"] ** 2, rel=1e-12, abs=0.0)


def _contiguous_btc(seed: int) -> pd.Series:
    """A ~1000-day contiguous 7-day benchmark ending on a fixed date, the shape of the BTC cache path."""
    idx = pd.date_range(end="2026-06-30", periods=1000, freq="D")
    return pd.Series(np.random.default_rng(seed).normal(0.0004, 0.03, len(idx)), index=idx, name="BTC")


def test_benchalign_derive_basis_broker_nan_benchmark_family_is_the_inner_join(caplog):
    """SC5 / SC4 (166.4 D-A): the single-key broker path keeps a benchmark family bit-identical to the inner join.

    The strategy is built the way the broker-sourced branch of
    ``run_csv_strategy_analytics`` builds it: a series with three absent
    interior days, reindexed to ``pd.date_range(min, max, freq="D")`` so the
    absent days become NaN guard days. ``derive_basis_series`` hands its
    ``scalar_returns`` to ``compute_all_metrics`` verbatim, so the inner-join
    oracle is built on that same series.
    """
    benchmark = _contiguous_btc(166402)
    _assert_contiguous(benchmark)
    start = benchmark.index[300]
    raw_idx = pd.date_range(start, periods=400, freq="D")
    raw = pd.Series(np.random.default_rng(166403).normal(0.0005, 0.02, len(raw_idx)), index=raw_idx)
    raw = raw.drop(raw.index[[37, 150, 311]])
    strategy = raw.reindex(pd.date_range(raw.index.min(), raw.index.max(), freq="D"))
    strategy.name = "returns"
    # Preconditions: strictly inside benchmark coverage, exactly 3 NaN guard
    # days, and a dense (non-sparse) calendar.
    assert strategy.index[0] > benchmark.index[0] and strategy.index[-1] < benchmark.index[-1]
    assert int(strategy.isna().sum()) == 3
    assert strategy_calendar_is_sparse(strategy.index) is False

    caplog.set_level(logging.WARNING, logger=_METRICS_LOGGER)
    result = derive_basis_series(
        strategy,
        benchmark,
        periods_per_year=365,
        cumulative_method="geometric",
        day_basis="calendar",
        benchmark_symbol="BTC",
        scalar_returns=strategy,
        densify_policy="broker_nan",
    )
    assert _fanout_warnings(caplog) == []
    _assert_family_is_the_inner_join(result.metrics_json, result.sibling_kinds, strategy, benchmark, 365)
