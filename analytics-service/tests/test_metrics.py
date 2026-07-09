import logging
import math
import warnings

import numpy as np
import pandas as pd
import pytest
import quantstats as qs

from services.metrics import compute_all_metrics, _safe_float, sanitize_metrics


class TestSafeFloat:
    def test_normal_value(self):
        assert _safe_float(1.5) == 1.5

    def test_nan(self):
        assert _safe_float(float("nan")) is None

    def test_inf(self):
        assert _safe_float(float("inf")) is None

    def test_neg_inf(self):
        assert _safe_float(float("-inf")) is None

    def test_none(self):
        assert _safe_float(None) is None

    def test_string(self):
        assert _safe_float("not a number") is None

    def test_zero(self):
        assert _safe_float(0.0) == 0.0

    def test_numpy_nan(self):
        assert _safe_float(np.nan) is None

    def test_numpy_inf(self):
        assert _safe_float(np.inf) is None

    # PR #181 take-2 pr-test F17 + silent-failure-hunter F18: pin the
    # DEBUG-vs-None contract. The sweep added DEBUG logging to _safe_float
    # for both failure modes; pre-take2 these had no test coverage so a
    # /simplify pass dropping the logger.debug calls would land silently.
    # Also pin F18: None is a fast-path return BEFORE the try/except, not
    # a "coerce failed" DEBUG line — sanitize_metrics walks ~10K values
    # per analytics payload and several are legitimately None.
    def test_nan_logs_debug_with_type_marker(self, caplog):
        """NaN coercion emits DEBUG with the originating type."""
        with caplog.at_level(logging.DEBUG, logger="quantalyze.analytics.metrics"):
            assert _safe_float(float("nan")) is None
        debug_records = [
            r for r in caplog.records
            if r.levelno == logging.DEBUG
            and "_safe_float coerced to None" in r.getMessage()
            and "NaN/Inf" in r.getMessage()
        ]
        assert debug_records, (
            "_safe_float NaN path must emit a DEBUG record naming "
            "'NaN/Inf' (post audit-2026-05-07 silent-failure sweep)"
        )
        # Negative assertion (pr-test LOW #5): DEBUG, never WARNING — the
        # high call-frequency would flood Railway on legitimate-None paths
        # in sanitize_metrics if this site were ever promoted to WARNING.
        warning_records = [
            r for r in caplog.records
            if r.levelno >= logging.WARNING
            and "_safe_float" in r.getMessage()
        ]
        assert not warning_records, (
            "_safe_float NaN must NEVER emit at WARNING level — high call "
            "frequency would flood Railway in production INFO config"
        )

    def test_string_coerce_failure_logs_debug_with_type_marker(self, caplog):
        """Non-numeric input emits DEBUG naming the originating type."""
        with caplog.at_level(logging.DEBUG, logger="quantalyze.analytics.metrics"):
            assert _safe_float("not a number") is None
        debug_records = [
            r for r in caplog.records
            if r.levelno == logging.DEBUG
            and "_safe_float coerce failed" in r.getMessage()
            and "type=str" in r.getMessage()
        ]
        assert debug_records, (
            "_safe_float string-coerce path must emit a DEBUG record "
            "naming type=str (post audit-2026-05-07 silent-failure sweep)"
        )

    def test_none_returns_none_without_debug_emission(self, caplog):
        """PR #181 take-2 F18: None is a legitimate normal-path input from
        sanitize_metrics + qs.stats returns; it must return None WITHOUT
        emitting any DEBUG log (which would flood Railway in DEBUG mode).
        """
        with caplog.at_level(logging.DEBUG, logger="quantalyze.analytics.metrics"):
            assert _safe_float(None) is None
        # Critical: NO log of any level for the None input.
        any_safe_float_log = [
            r for r in caplog.records
            if "_safe_float" in r.getMessage()
        ]
        assert not any_safe_float_log, (
            "_safe_float(None) is a legitimate normal-path input — it "
            "must not emit any log (DEBUG or otherwise). Pre-take2 the "
            "TypeError branch fired DEBUG on every None, flooding the "
            "DEBUG channel from sanitize_metrics' ~10K-value walks"
        )


class TestSanitizeMetrics:
    def test_replaces_nan(self):
        data = {"sharpe": float("nan"), "cagr": 0.15}
        result = sanitize_metrics(data)
        assert result["sharpe"] is None
        assert result["cagr"] == 0.15

    def test_replaces_inf(self):
        data = {"calmar": float("inf"), "max_dd": -0.1}
        result = sanitize_metrics(data)
        assert result["calmar"] is None
        assert result["max_dd"] == -0.1

    def test_nested_dict(self):
        data = {"metrics_json": {"alpha": float("nan"), "beta": 0.5}}
        result = sanitize_metrics(data)
        assert result["metrics_json"]["alpha"] is None
        assert result["metrics_json"]["beta"] == 0.5

    def test_list_of_dicts(self):
        data = {"series": [{"date": "2023-01-01", "value": float("inf")}]}
        result = sanitize_metrics(data)
        assert result["series"][0]["value"] is None

    def test_preserves_non_numeric(self):
        data = {"name": "test", "count": 42, "tags": ["a", "b"]}
        result = sanitize_metrics(data)
        assert result == data


class TestSegmentedCumulativeMetrics:
    """DQ-03 (§6): the headline cumulative_return + CAGR are suffix-honest and
    derive from the ONE shared nav_twr boundary source (no metrics-local bridge
    or forked break-detector)."""

    def test_total_return_suffix_honest(self):
        """An interior NaN → cumulative_return is the post-break suffix product,
        NOT the dropna-bridged product. Reverting :468 to the inline dropna-prod
        flips this RED on the NUMBER."""
        idx = pd.date_range("2026-01-01", periods=6, freq="D")
        returns = pd.Series([0.10, 0.05, np.nan, 0.02, 0.01, 0.03], index=idx)
        result = compute_all_metrics(returns)
        suffix_product = (1.02 * 1.01 * 1.03) - 1.0  # after the interior break
        bridged_product = (1.10 * 1.05 * 1.02 * 1.01 * 1.03) - 1.0  # old bridge
        assert result["cumulative_return"] == pytest.approx(suffix_product, rel=1e-12)
        assert suffix_product != pytest.approx(bridged_product)

    def test_cagr_window_consistent_multi_break(self):
        """>=2 interior breaks: the CAGR annualization window is the SAME days
        the number compounds (post-last-break suffix), NOT the full dropna span.
        Deriving _cagr_index from returns.dropna().index while compounding the
        suffix flips this RED (a single-break fixture could mask a boundary
        off-by-one, so this uses two interior breaks)."""
        idx = pd.date_range("2026-01-01", periods=8, freq="D")
        returns = pd.Series(
            [0.5, np.nan, 0.1, np.nan, 0.02, 0.01, 0.03, 0.04], index=idx
        )
        result = compute_all_metrics(returns)
        tr = (1.02 * 1.01 * 1.03 * 1.04) - 1.0  # suffix product (01-05..01-08)
        assert result["cumulative_return"] == pytest.approx(tr, rel=1e-12)
        suffix_elapsed = 3  # 01-08 - 01-05 (the compounded window)
        full_elapsed = 7  # 01-08 - 01-01 (the forked, WRONG basis)
        honest_cagr = (1.0 + tr) ** (365.0 / suffix_elapsed) - 1.0
        forked_cagr = (1.0 + tr) ** (365.0 / full_elapsed) - 1.0
        assert result["cagr"] == pytest.approx(honest_cagr, rel=1e-9)
        assert honest_cagr != pytest.approx(forked_cagr)  # mutation-honest

    def test_clean_path_bit_identical(self):
        """SC-4 clean path: a no-NaN series' cumulative_return + cagr are
        identical to the old expression (the suffix IS the whole series)."""
        idx = pd.date_range("2026-01-01", periods=5, freq="D")
        returns = pd.Series([0.01, -0.02, 0.03, 0.015, 0.02], index=idx)
        result = compute_all_metrics(returns)
        expected_tr = float((1 + returns).prod() - 1)  # old expression, no NaN
        assert result["cumulative_return"] == pytest.approx(expected_tr, rel=1e-15)
        elapsed = (idx[-1] - idx[0]).days
        expected_cagr = (1.0 + expected_tr) ** (365.0 / elapsed) - 1.0
        assert result["cagr"] == pytest.approx(expected_cagr, rel=1e-12)

    def test_no_inline_bridge_and_shared_suffix_source(self):
        """§6.2 source-scan (the tests/test_nav_twr.py:427 forbidden-substitution
        pattern): no headline ``dropna()).prod()`` / ``dropna()).cumprod()``
        bridge survives in metrics.py or nav_twr.py, and metrics consumes the ONE
        shared boundary source — no metrics-local break-detector."""
        import re
        from pathlib import Path

        base = Path(__file__).resolve().parents[1] / "services"
        metrics_src = (base / "metrics.py").read_text()
        nav_twr_src = (base / "nav_twr.py").read_text()
        forbidden = re.compile(r"dropna\(\)\)\.(prod|cumprod)\(")
        for name, src in (("metrics.py", metrics_src), ("nav_twr.py", nav_twr_src)):
            offenders = [
                ln.strip()
                for ln in src.splitlines()
                if not ln.strip().startswith("#") and forbidden.search(ln)
            ]
            assert offenders == [], f"{name} headline dropna-bridge(s): {offenders}"
        # metrics derives BOTH the number and the CAGR window from the shared
        # nav_twr source (shared_suffix_single_source).
        assert "cumulative_twr_segmented(" in metrics_src
        assert "_last_interior_break_suffix(" in metrics_src
        # The forked full-window CAGR basis (returns.dropna().index) is gone —
        # a second detector reintroducing it flips this RED.
        code_lines = [
            ln for ln in metrics_src.splitlines() if not ln.strip().startswith("#")
        ]
        assert not any("dropna().index" in ln for ln in code_lines), (
            "metrics must derive _cagr_index from _last_interior_break_suffix, "
            "not the full dropna span"
        )


class TestComputeAllMetrics:
    def test_golden_dataset_core_metrics(self, golden_returns):
        result = compute_all_metrics(golden_returns)

        # CAGR should be positive (we seeded with positive drift)
        assert result["cagr"] is not None
        assert isinstance(result["cagr"], float)

        # Sharpe should be finite
        assert result["sharpe"] is not None
        assert not math.isinf(result["sharpe"])

        # Sortino should be finite
        assert result["sortino"] is not None
        assert not math.isinf(result["sortino"])

        # Max drawdown should be negative
        assert result["max_drawdown"] is not None
        assert result["max_drawdown"] < 0

        # Volatility should be positive
        assert result["volatility"] is not None
        assert result["volatility"] > 0

    def test_golden_dataset_no_nan_inf(self, golden_returns):
        """No NaN or Inf values in any output field."""
        result = compute_all_metrics(golden_returns)

        def check_value(val, path=""):
            if isinstance(val, float):
                assert not math.isnan(val), f"NaN at {path}"
                assert not math.isinf(val), f"Inf at {path}"
            elif isinstance(val, dict):
                for k, v in val.items():
                    check_value(v, f"{path}.{k}")
            elif isinstance(val, list):
                for i, v in enumerate(val):
                    check_value(v, f"{path}[{i}]")

        for key, value in result.items():
            if value is not None:
                check_value(value, key)

    def test_golden_dataset_has_all_fields(self, golden_returns):
        result = compute_all_metrics(golden_returns)
        required_keys = [
            "cumulative_return", "cagr", "volatility", "sharpe", "sortino",
            "calmar", "max_drawdown", "max_drawdown_duration_days",
            "six_month_return", "sparkline_returns", "sparkline_drawdown",
            "metrics_json", "returns_series", "drawdown_series",
            "monthly_returns", "rolling_metrics", "return_quantiles",
        ]
        for key in required_keys:
            assert key in result, f"Missing key: {key}"

    def test_golden_dataset_extended_metrics(self, golden_returns):
        result = compute_all_metrics(golden_returns)
        mj = result["metrics_json"]

        # These should be computed for 500 days of data
        assert "best_day" in mj
        assert "worst_day" in mj
        assert "mtd" in mj
        assert "ytd" in mj
        assert "skewness" in mj
        assert "kurtosis" in mj
        assert "avg_win" in mj
        assert "avg_loss" in mj

    def test_golden_dataset_with_benchmark(self, golden_returns, benchmark_returns):
        result = compute_all_metrics(golden_returns, benchmark_returns)
        mj = result["metrics_json"]

        assert "alpha" in mj
        assert "beta" in mj
        assert "correlation" in mj

    def test_zero_vol_no_crash(self, zero_vol_returns):
        """Zero volatility produces Inf Sharpe — must be sanitized to None."""
        result = compute_all_metrics(zero_vol_returns)
        # Sharpe of constant positive returns is Inf, should be sanitized to None
        # (or could be a very large finite number depending on quantstats implementation)
        if result["sharpe"] is not None:
            assert not math.isinf(result["sharpe"])

    def test_minimum_returns(self, single_trade_returns):
        """2-day series should compute without crash."""
        result = compute_all_metrics(single_trade_returns)
        assert result["cumulative_return"] is not None

    def test_insufficient_data(self):
        """Less than 2 days should raise ValueError."""
        returns = pd.Series([0.01], index=pd.DatetimeIndex(["2023-01-01"]))
        with pytest.raises(ValueError, match="Insufficient"):
            compute_all_metrics(returns)

    def test_non_datetime_index_raises_typeerror(self):
        """M-0693: a non-DatetimeIndex must fail loud at the boundary, not deep
        inside a helper. Pre-fix a RangeIndex AttributeError'd inside
        `returns.index[-1].replace(day=1)` (mtd slice) or surfaced as a
        misattributed Railway WARNING."""
        returns = pd.Series([0.01, -0.02, 0.015])  # default RangeIndex
        with pytest.raises(TypeError, match="DatetimeIndex"):
            compute_all_metrics(returns)

    def test_int_dtype_returns_raises_typeerror(self):
        """M-0693: an int-dtype series must fail loud — int returns silently
        truncate in np.log1p / cumprod instead of computing real metrics."""
        dates = pd.bdate_range("2023-01-01", periods=5)
        returns = pd.Series([0, 1, 0, 1, 0], index=dates)  # int64 dtype
        assert pd.api.types.is_integer_dtype(returns)
        with pytest.raises(TypeError, match="float-dtype"):
            compute_all_metrics(returns)

    def test_descending_index_raises_valueerror(self):
        """F3 (red-team MED8): a descending DatetimeIndex passes the
        DatetimeIndex + float-dtype checks but breaks mtd/ytd window
        construction and tail(126)/tail(63), which assume the LAST rows are
        the most recent. Must fail loud (Rule 12) rather than silently
        computing windows from the wrong end."""
        dates = pd.bdate_range("2023-01-01", periods=5)[::-1]  # newest-first
        returns = pd.Series([0.01, -0.02, 0.015, 0.005, -0.01], index=dates)
        assert isinstance(returns.index, pd.DatetimeIndex)
        assert not returns.index.is_monotonic_increasing
        with pytest.raises(ValueError, match="monotonic-increasing|ascending"):
            compute_all_metrics(returns)

    def test_shuffled_index_raises_valueerror(self):
        """F3: a shuffled (non-monotonic) DatetimeIndex is equally unsafe."""
        dates = pd.bdate_range("2023-01-01", periods=6)
        shuffled = dates[[0, 3, 1, 5, 2, 4]]
        returns = pd.Series(
            [0.01, -0.02, 0.015, 0.005, -0.01, 0.02], index=shuffled
        )
        assert not returns.index.is_monotonic_increasing
        with pytest.raises(ValueError, match="monotonic-increasing|ascending"):
            compute_all_metrics(returns)

    def test_ascending_index_still_passes(self):
        """F3: the sorted/ascending case (the normal contract) must remain
        accepted — the new precondition must not reject valid input."""
        dates = pd.bdate_range("2023-01-01", periods=50)
        np.random.seed(7)
        returns = pd.Series(np.random.normal(0.001, 0.01, 50), index=dates)
        assert returns.index.is_monotonic_increasing
        result = compute_all_metrics(returns)  # must not raise
        assert result["cumulative_return"] is not None

    def test_catastrophic_loss_clamps_equity_and_drawdown(self):
        """F7 (red-team HIGH7): a return <= -1 (>=100% loss day) must NOT
        produce a negative, sign-oscillating equity curve or a drawdown below
        -100%. The log-returns chart already clamps to _LOG_RETURN_FLOOR; the
        linear equity (cumprod) and drawdown must clamp consistently.

        Pre-fix `(1 + (-1.2)).cumprod() = -0.2` then sign-flips on every
        subsequent multiply, and to_drawdown_series yields a drawdown of
        roughly -1.23 (below -100%, impossible)."""
        from services.metrics import _LOG_RETURN_FLOOR

        dates = pd.bdate_range("2023-01-01", periods=8)
        # A -1.2 (>100% loss) day in the middle of otherwise-normal returns.
        vals = [0.01, 0.02, -1.2, 0.015, 0.01, -0.005, 0.02, 0.01]
        returns = pd.Series(vals, index=dates, dtype="float64")
        result = compute_all_metrics(returns)

        # Equity (returns_series / cumulative) must stay non-negative and not
        # oscillate sign. Pre-fix it went negative at the catastrophic day.
        equity_vals = [pt["value"] for pt in result["returns_series"]]
        assert equity_vals, "equity series must not be empty"
        assert all(v >= 0 for v in equity_vals), (
            f"equity curve must stay non-negative after a >=100% loss day; "
            f"got {equity_vals}"
        )

        # Drawdown must be bounded at -1.0 (cannot lose more than 100%).
        dd_vals = [pt["value"] for pt in result["drawdown_series"]]
        assert dd_vals, "drawdown series must not be empty"
        assert min(dd_vals) >= _LOG_RETURN_FLOOR - 1e-6, (
            f"drawdown must be bounded at -1.0 (>=100% loss is total); "
            f"got min={min(dd_vals)}"
        )

    def test_normal_returns_equity_unaffected_by_clamp(self):
        """F7: the clamp is a no-op for normal data (every return > -1), so a
        strategy with no catastrophic day must produce an equity curve identical
        to the unclamped cumprod — golden/parity fixtures must not churn."""
        dates = pd.bdate_range("2023-01-01", periods=60)
        np.random.seed(13)
        vals = np.random.normal(0.001, 0.015, 60)
        # Guarantee no value <= -1.
        assert (vals > -1.0).all()
        returns = pd.Series(vals, index=dates, dtype="float64")
        result = compute_all_metrics(returns)

        expected = (1 + returns).cumprod()
        equity_vals = [pt["value"] for pt in result["returns_series"]]
        # Same length + last value matches the unclamped cumprod (within float
        # rounding the serializer applies).
        assert len(equity_vals) == len(expected)
        assert equity_vals[-1] == pytest.approx(float(expected.iloc[-1]), rel=1e-6)

    def test_all_negative_returns(self):
        """Strategy that only loses money."""
        np.random.seed(99)
        dates = pd.bdate_range("2023-01-01", periods=100)
        returns = pd.Series(np.random.normal(-0.01, 0.005, 100), index=dates)
        result = compute_all_metrics(returns)

        assert result["cumulative_return"] is not None
        assert result["cumulative_return"] < 0
        assert result["max_drawdown"] is not None
        assert result["max_drawdown"] < 0

    def test_monthly_returns_grid(self, golden_returns):
        result = compute_all_metrics(golden_returns)
        monthly = result["monthly_returns"]
        assert isinstance(monthly, dict)
        # Should have year keys
        assert len(monthly) > 0
        # Each year should have month keys
        for year, months in monthly.items():
            assert isinstance(months, dict)
            for month in months.keys():
                assert month in ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                                 "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

    def test_rolling_metrics(self, golden_returns):
        result = compute_all_metrics(golden_returns)
        rolling = result["rolling_metrics"]
        assert "sharpe_30d" in rolling
        assert "sharpe_90d" in rolling
        assert "sharpe_365d" in rolling
        # 500 days should produce 30d and 90d rolling, maybe not 365d
        assert len(rolling["sharpe_30d"]) > 0
        assert len(rolling["sharpe_90d"]) > 0

    def test_return_quantiles(self, golden_returns):
        result = compute_all_metrics(golden_returns)
        quantiles = result["return_quantiles"]
        assert "Daily" in quantiles
        # Each quantile list should have 5 values (min, q25, median, q75, max)
        assert len(quantiles["Daily"]) == 5
        # Min should be <= max
        assert quantiles["Daily"][0] <= quantiles["Daily"][4]

    def test_sparklines_downsampled(self, golden_returns):
        result = compute_all_metrics(golden_returns)
        assert len(result["sparkline_returns"]) <= 90
        assert len(result["sparkline_drawdown"]) <= 90

    def test_consecutive_streaks(self, golden_returns):
        result = compute_all_metrics(golden_returns)
        mj = result["metrics_json"]
        assert "consecutive_wins" in mj
        assert "consecutive_losses" in mj
        assert mj["consecutive_wins"] >= 1
        assert mj["consecutive_losses"] >= 1

    def test_outlier_ratios(self, golden_returns):
        result = compute_all_metrics(golden_returns)
        mj = result["metrics_json"]
        assert "outlier_win_ratio" in mj
        assert "outlier_loss_ratio" in mj
        # Ratios should be between 0 and 1
        assert 0 <= mj["outlier_win_ratio"] <= 1
        assert 0 <= mj["outlier_loss_ratio"] <= 1

    def test_rolling_correlation_with_benchmark(self, golden_returns, benchmark_returns):
        """btc_rolling_correlation_90d should be populated with 90-day rolling corr."""
        result = compute_all_metrics(golden_returns, benchmark_returns)
        corr_series = result["metrics_json"].get("btc_rolling_correlation_90d")
        assert corr_series is not None, "btc_rolling_correlation_90d missing"
        assert isinstance(corr_series, list)
        assert len(corr_series) > 0
        for entry in corr_series:
            assert "date" in entry and "value" in entry
            assert -1.0 <= entry["value"] <= 1.0
            assert not math.isnan(entry["value"])

    def test_benchmark_metrics_share_single_aligned_sample_on_calendar_mismatch(self):
        """M1 (red-team 2026-05-27): alpha/beta/correlation/info_ratio must ALL be
        computed over the SAME inner-join aligned sample when the strategy and
        benchmark calendars differ.

        Before the fix, alpha/beta came from ``qs.stats.greeks(returns,
        benchmark)`` — which internally reindexes the benchmark onto the
        strategy's FULL date range (bfill) via quantstats `_prepare_benchmark` —
        while correlation/info_ratio used the inner-join intersection only. On a
        24/7-crypto-vs-gapped-benchmark mismatch the two disagree. This test pins
        the post-fix contract: every benchmark-relative metric is over the
        intersection, and (anti-vacuity) the produced alpha/beta differ from what
        the OLD full-range path would have produced.
        """
        rng = np.random.default_rng(7)
        # Strategy trades 24/7 (every calendar day).
        s_dates = pd.date_range("2024-01-01", periods=120, freq="D")
        strat = pd.Series(rng.normal(0.001, 0.02, 120), index=s_dates, name="returns")
        # Benchmark only has business days → weekend/holiday gaps vs the strategy.
        b_dates = pd.bdate_range("2024-01-01", periods=85)
        bench = pd.Series(rng.normal(0.0005, 0.025, 85), index=b_dates, name="BTC")

        # Sanity: the calendars genuinely differ (intersection < strategy length).
        aligned = strat.align(bench, join="inner")
        ar, ab = aligned[0], aligned[1]
        assert 1 < len(ar) < len(strat), "fixture must have a real calendar gap"

        result = compute_all_metrics(strat, bench)
        mj = result["metrics_json"]

        # Oracle: every benchmark-relative metric over the SAME inner-join sample.
        exp = qs.stats.greeks(ar, ab)
        exp_alpha = _safe_float(exp.get("alpha", 0))
        exp_beta = _safe_float(exp.get("beta", 0))
        exp_corr = _safe_float(ar.corr(ab))
        excess = ar - ab
        exp_te = float(excess.std() * np.sqrt(252))
        exp_ir = _safe_float(excess.mean() * 252 / exp_te)

        assert mj["alpha"] == pytest.approx(exp_alpha, abs=1e-12)
        assert mj["beta"] == pytest.approx(exp_beta, abs=1e-12)
        assert mj["correlation"] == pytest.approx(exp_corr, abs=1e-12)
        assert mj["info_ratio"] == pytest.approx(exp_ir, abs=1e-12)

        # Anti-vacuity: the OLD path (greeks over the full bfilled range) would
        # have produced DIFFERENT alpha/beta. Prove the fix actually changed the
        # alignment, not just that the assertions are self-consistent.
        old = qs.stats.greeks(strat, bench)
        assert mj["beta"] != pytest.approx(_safe_float(old.get("beta", 0)), abs=1e-9)

    def test_drawdown_episodes(self, golden_returns):
        """drawdown_episodes should list top-5 drawdowns sorted by depth desc."""
        result = compute_all_metrics(golden_returns)
        episodes = result["metrics_json"].get("drawdown_episodes")
        assert episodes is not None
        assert isinstance(episodes, list)
        assert len(episodes) <= 5
        if len(episodes) >= 2:
            # Sorted by depth desc (most negative first); abs value strictly non-increasing
            depths = [abs(e["depth_pct"]) for e in episodes]
            for i in range(len(depths) - 1):
                assert depths[i] >= depths[i + 1]
        for e in episodes:
            assert "peak_date" in e
            assert "trough_date" in e
            assert "recovery_date" in e  # may be None
            assert "depth_pct" in e
            assert "duration_days" in e
            assert "is_current" in e
            assert e["depth_pct"] <= 0  # drawdowns are negative
            assert e["duration_days"] >= 0

    def test_rolling_correlation_absent_when_less_than_90_days(self):
        """< 90 aligned days → btc_rolling_correlation_90d must not be emitted."""
        np.random.seed(7)
        dates = pd.bdate_range("2024-01-01", periods=60)
        strat = pd.Series(np.random.normal(0.001, 0.01, 60), index=dates, name="returns")
        bench = pd.Series(np.random.normal(0.0005, 0.015, 60), index=dates, name="BTC")
        result = compute_all_metrics(strat, bench)
        assert "btc_rolling_correlation_90d" not in result["metrics_json"]

    def test_drawdown_episodes_ongoing_flag_set_when_series_ends_in_drawdown(self):
        """Series ending underwater → at least one episode has is_current=True."""
        dates = pd.bdate_range("2024-01-01", periods=60)
        # Positive drift for first half, then a big sustained drawdown to the end.
        values = np.concatenate([
            np.full(30, 0.005),
            np.full(30, -0.01),
        ])
        returns = pd.Series(values, index=dates, name="returns")
        result = compute_all_metrics(returns)
        episodes = result["metrics_json"].get("drawdown_episodes") or []
        assert len(episodes) >= 1
        ongoing = [e for e in episodes if e["is_current"]]
        assert len(ongoing) >= 1
        for e in ongoing:
            assert e["recovery_date"] is None

    def test_rolling_correlation_zero_variance_returns_empty(self):
        """Constant (zero-variance) series produce NaN rolling corr → empty list."""
        from services.metrics import _rolling_correlation
        dates = pd.bdate_range("2024-01-01", periods=150)
        a = pd.Series(0.001, index=dates, name="a")
        b = pd.Series(0.002, index=dates, name="b")
        assert _rolling_correlation(a, b, 90) == []

    def test_rolling_correlation_identical_series_all_ones(self):
        """Correlating a series with itself yields ~1.0 across every window."""
        from services.metrics import _rolling_correlation
        np.random.seed(17)
        dates = pd.bdate_range("2024-01-01", periods=150)
        a = pd.Series(np.random.normal(0, 0.01, 150), index=dates, name="a")
        result = _rolling_correlation(a, a, 90)
        assert len(result) > 0
        for entry in result:
            assert abs(entry["value"] - 1.0) < 1e-6


# ---------------------------------------------------------------------------
# Phase 12 / Plan 03 — METRICS-01..03, METRICS-12 — RED tests
# ---------------------------------------------------------------------------
# Module-level MAR constant + 5 rolling helpers (Sortino, Volatility, Alpha,
# Beta, Log returns). Mirrors `_rolling_sharpe` template at metrics.py:374.
# Pitfall 11 cross-runtime consistency: `qs.stats.sortino` and `_rolling_sortino`
# share the SAME `MAR = 0.0` source of truth.

from services.metrics import (
    MAR,
    MetricsResult,
    _rolling_sortino,
    _rolling_volatility,
    _rolling_alpha,
    _rolling_alpha_beta,
    _rolling_beta,
    _log_returns_series,
)


def test_mar_constant_is_zero():
    """Pitfall 11: MAR = 0.0 module-level constant for cross-runtime Sortino consistency."""
    assert MAR == 0.0
    assert isinstance(MAR, float)


def test_metrics_result_subscript_rejects_sibling_kind_keys():
    """Audit 2026-05-07 H-0727: `result[<sibling_kind>]` must raise a KeyError
    that names the correct accessor (`result.sibling_kinds[...]`). The plain
    proxy used to silently KeyError, which made a `result.sibling_kinds[k]`
    → `result[k]` refactor look correct in review while breaking every sibling
    kind in production.
    """
    result = MetricsResult(
        metrics_json={"sharpe": 1.2},
        sibling_kinds={"rolling_sortino_3m": [{"date": "2024-01-01", "value": 1.0}]},
    )
    # metrics_json access still works.
    assert result["sharpe"] == 1.2
    # Sibling-kind subscript raises a descriptive KeyError naming .sibling_kinds.
    with pytest.raises(KeyError, match=r"sibling_kinds"):
        _ = result["rolling_sortino_3m"]
    # Direct attribute access remains the correct path.
    assert result.sibling_kinds["rolling_sortino_3m"][0]["value"] == 1.0


def test_metrics_result_dict_shim_methods():
    """M-0686: MetricsResult exposes 5 dict-like proxy methods
    (__contains__, get, items, keys, values) as a backward-compat shim for
    legacy callers that treated the bare-dict return shape. None were
    exercised — only test_metrics_parity uses .metrics_json / .sibling_kinds
    directly. A regression (e.g. `get` raising instead of returning the
    default, or a proxy method reaching into sibling_kinds) would break
    legacy callers silently because they aren't run in CI. All 5 proxy
    to metrics_json ONLY — sibling_kinds is invisible by design (D-01/D-02).
    """
    result = MetricsResult(
        metrics_json={"sharpe": 1.2, "sortino": 0.9},
        sibling_kinds={"rolling_alpha": [{"date": "2024-01-01", "value": 0.1}]},
    )
    # __contains__ — only metrics_json keys, NOT sibling_kinds.
    assert "sharpe" in result
    assert "missing" not in result
    assert "rolling_alpha" not in result, (
        "__contains__ must proxy metrics_json only; sibling_kinds is "
        "invisible under `in` per the split-storage contract."
    )
    # get — present key, and default for an absent key (must NOT raise).
    assert result.get("sharpe") == 1.2
    assert result.get("nope") is None
    assert result.get("nope", 42) == 42
    # keys / values / items proxy metrics_json exactly.
    assert set(result.keys()) == {"sharpe", "sortino"}
    assert set(result.values()) == {1.2, 0.9}
    assert dict(result.items()) == {"sharpe": 1.2, "sortino": 0.9}


def test_compute_all_metrics_no_benchmark_rolling_alpha_beta_are_empty_lists(
    golden_returns,
):
    """M-0687: the `_rolling_alpha(...) if has_benchmark else []` conditional
    (and beta) is a Phase-12 contract — WITHOUT a benchmark the rolling_alpha
    / rolling_beta sibling kinds must be EMPTY LISTS, not absent and not
    None. A regression to None or a missing key would crash the downstream
    batch-RPC consumers that iterate every sibling kind. No prior test calls
    compute_all_metrics with benchmark_returns=None and asserts this.
    """
    result = compute_all_metrics(golden_returns, benchmark_returns=None)
    # Keys present...
    assert "rolling_alpha" in result.sibling_kinds
    assert "rolling_beta" in result.sibling_kinds
    # ...and they are EMPTY LISTS (the False branch), not None / missing.
    assert result.sibling_kinds["rolling_alpha"] == []
    assert result.sibling_kinds["rolling_beta"] == []


def test_scalar_sortino_passes_mar_as_rf(golden_returns, monkeypatch):
    """Audit 2026-05-07 H-0725: compute_all_metrics must pass `rf=MAR` to
    `qs.stats.sortino` explicitly. If the call relies on qs's default `rf=0`,
    any future tune of MAR away from 0 silently diverges the scalar sortino
    from `_rolling_sortino` (which IS MAR-floored).
    """
    import services.metrics as metrics_module

    captured: dict[str, object] = {}
    real_sortino = metrics_module.qs.stats.sortino

    def spy_sortino(series, rf=None, **kwargs):
        captured["rf"] = rf
        return real_sortino(series, rf=rf, **kwargs) if rf is not None else real_sortino(series, **kwargs)

    monkeypatch.setattr(metrics_module.qs.stats, "sortino", spy_sortino)
    compute_all_metrics(golden_returns)
    assert "rf" in captured, "compute_all_metrics did not call qs.stats.sortino"
    # MAR is currently 0.0 — the contract is that the rf kwarg is forwarded explicitly
    # (not omitted), so future MAR tunes flow through automatically.
    assert captured["rf"] == MAR, (
        f"qs.stats.sortino must be called with rf=MAR ({MAR}); got rf={captured['rf']}"
    )


def test_rolling_sortino_short_circuit_on_insufficient_data(empty_returns):
    """METRICS-01: short returns when len(returns) < window — mirrors _rolling_sharpe."""
    assert _rolling_sortino(empty_returns, 63) == []


def test_rolling_sortino_full_window(golden_returns):
    """METRICS-01: full window produces finalized list."""
    assert len(golden_returns) == 500  # conftest fixture is 500 days
    result = _rolling_sortino(golden_returns, 63)
    assert isinstance(result, list)
    assert len(result) > 0
    for point in result:
        assert "date" in point
        assert "value" in point


def test_rolling_sortino_converges_to_scalar_at_full_window():
    """Pitfall 11 cross-check: window == period must converge to qs.stats.sortino().

    Per RESEARCH.md §11 mitigation (PITFALLS.md:142-146):
    > "Pytest cross-check: assert abs(metrics["sortino"] - rolling_sortino_3m[-1])
    > < 0.05 on a 90-day fixture (last rolling window converges to scalar over the
    > full period when window == period)."

    Cross-check requires the rolling helper to use the SAME math as qs.stats.sortino:
    downside RMS = sqrt(sum(x^2 where x<MAR else 0) / N), NOT pandas .std() over a
    zero-floored series. Both formulas annualize via sqrt(252).
    """
    np.random.seed(11)
    dates = pd.bdate_range("2024-01-01", periods=90)
    returns = pd.Series(np.random.normal(0.0005, 0.015, 90), index=dates, name="returns")

    scalar = qs.stats.sortino(returns)
    rolling_90 = _rolling_sortino(returns, 90)
    assert len(rolling_90) >= 1
    assert abs(rolling_90[-1]["value"] - scalar) < 0.05


def test_rolling_sortino_all_positive_window_no_inf_no_warning():
    """Audit 2026-05-07 H-0712 / H-0716: an all-positive returns window has
    zero observations below MAR=0 → downside std = 0 → naive `roll_mean /
    roll_dstd` produces ±Inf and a divide-by-zero RuntimeWarning. The fix
    uses np.where to set those windows to NaN explicitly so:
      (a) no RuntimeWarning is emitted to noisy logs / poison parity gates
      (b) the result list contains no ±Inf rows
    The 'best' windows are still dropped from the plotted value series (an
    +∞ Sortino cannot be plotted on a finite ratio axis). H-0722 makes that
    drop ATTRIBUTABLE via a WARNING (see
    test_rolling_sortino_undefined_but_good_window_is_not_silently_dropped);
    surfacing per-date provenance into the STORED payload remains H-0717
    (DEFERRED-CROSSRUNTIME — Python+RPC+TS contract change).
    """
    dates = pd.bdate_range("2024-01-01", periods=120)
    # All returns strictly > 0 — every window has zero downside.
    returns = pd.Series(np.full(120, 0.005), index=dates, name="returns")
    with warnings.catch_warnings():
        warnings.simplefilter("error", RuntimeWarning)
        # Must NOT raise — the divide-by-zero is handled explicitly via np.where.
        result = _rolling_sortino(returns, 63)
    # And the result must not contain any Inf entries.
    for point in result:
        assert not math.isinf(point["value"])


def test_rolling_sortino_undefined_but_good_window_is_not_silently_dropped(caplog):
    """Audit 2026-05-07 H-0722: a warmed window with ZERO downside and a
    POSITIVE mean return is Sortino → +∞ — the strategy's BULL signal, NOT
    missing data. It cannot be plotted on a finite ratio axis, so it is
    legitimately absent from the {date, value} series; but pre-fix that
    absence was SILENT and indistinguishable from the leading window-warmup
    rows. A chart punctured exactly at the strategy's best months would read
    as "data unavailable" with zero operator signal.

    WHY this matters (not just behavior): the published rolling-Sortino chart
    inverts the strategy's quality narrative — gaps at the peaks, solid line
    during mediocrity. The fix must make the omission ATTRIBUTABLE so an
    operator can tell "upside-undefined" from "data loss". We assert the
    helper emits a WARNING naming the undefined-but-good window count. This
    test FAILS on the old code (np.where → NaN → silent dropna, no log).

    Per-date provenance in the STORED payload remains DEFERRED-CROSSRUNTIME
    (H-0717) — it needs a coordinated Python+RPC+TS contract change.
    """
    dates = pd.bdate_range("2024-01-01", periods=120)
    # Strictly positive returns: every warmed window has zero downside AND a
    # positive mean → the undefined-but-good (+∞) case.
    returns = pd.Series(np.full(120, 0.005), index=dates, name="returns")
    with caplog.at_level(logging.WARNING, logger="quantalyze.analytics.metrics"):
        result = _rolling_sortino(returns, 63)

    # The +∞ windows are (correctly) absent from the plotted value series:
    # none survive as Inf, and for an all-positive series every warmed window
    # is undefined-but-good so the series is empty.
    for point in result:
        assert not math.isinf(point["value"])

    bull_records = [
        r for r in caplog.records
        if "undefined-but-good" in r.getMessage()
        and r.levelno == logging.WARNING
    ]
    assert bull_records, (
        "a zero-downside positive-mean (undefined-but-good, +Inf Sortino) "
        "window must emit an attributable WARNING — its omission from the "
        "chart is the BULL signal, not silent data loss (H-0722)"
    )
    # The message must name the window so operators can locate which sibling
    # kind (rolling_sortino_3m=63 / 6m=126 / 12m=252) is punctured.
    assert any("window=63" in r.getMessage() for r in bull_records)


def test_rolling_sortino_flat_window_is_not_flagged_as_undefined_but_good(caplog):
    """Audit 2026-05-07 H-0722 (negative case): an all-zero / flat window has
    zero downside too, but its mean is NOT positive — the ratio is a genuine
    0/0, undefined with NO upside meaning. It must NOT be counted as an
    'undefined-but-good' bull window. This pins the discriminator (roll_mean > 0)
    so the H-0722 signal does not misfire on flat/dead strategies, which would
    re-create log poison on the very strategies that have no signal at all.
    """
    dates = pd.bdate_range("2024-01-01", periods=120)
    returns = pd.Series(np.zeros(120), index=dates, name="returns")
    with caplog.at_level(logging.WARNING, logger="quantalyze.analytics.metrics"):
        _rolling_sortino(returns, 63)
    bull_records = [
        r for r in caplog.records if "undefined-but-good" in r.getMessage()
    ]
    assert not bull_records, (
        "a flat (all-zero, 0/0) window is genuinely undefined with no upside "
        "meaning and must NOT be flagged as undefined-but-good (H-0722)"
    )


def test_rolling_sortino_all_zero_window_no_inf():
    """Audit 2026-05-07 H-0712: an all-zero returns window also produces
    downside std = 0 (no observations < MAR=0 because none are strictly less
    than 0). The numerator `roll_mean` is also 0 so the naive division is 0/0
    → NaN, not Inf. Either way, no Inf/NaN survives in the output.
    """
    dates = pd.bdate_range("2024-01-01", periods=120)
    returns = pd.Series(np.zeros(120), index=dates, name="returns")
    with warnings.catch_warnings():
        warnings.simplefilter("error", RuntimeWarning)
        result = _rolling_sortino(returns, 63)
    for point in result:
        assert not math.isinf(point["value"])
        assert not math.isnan(point["value"])


def test_rolling_volatility_annualized(golden_returns):
    """METRICS-02: annualized = std * sqrt(252)."""
    result = _rolling_volatility(golden_returns, 63)
    assert isinstance(result, list)
    assert len(result) > 0
    # Independent computation
    expected = (golden_returns.rolling(63).std() * np.sqrt(252)).dropna().iloc[-1]
    # _finalize_rolling rounds to 4 decimals
    assert abs(result[-1]["value"] - round(float(expected), 4)) < 1e-4


def test_rolling_volatility_short_circuit(empty_returns):
    """METRICS-02: short returns when insufficient data."""
    assert _rolling_volatility(empty_returns, 63) == []


def test_rolling_alpha_returns_finalized_list(golden_returns, benchmark_returns):
    """METRICS-03: rolling alpha vs BTC benchmark returns finalized list."""
    result = _rolling_alpha(golden_returns, benchmark_returns, 90)
    assert isinstance(result, list)
    assert len(result) > 0
    for point in result:
        assert "date" in point
        assert "value" in point


def test_rolling_beta_returns_finalized_list(golden_returns, benchmark_returns):
    """METRICS-03: rolling beta vs BTC benchmark returns finalized list."""
    result = _rolling_beta(golden_returns, benchmark_returns, 90)
    assert isinstance(result, list)
    assert len(result) > 0


def test_rolling_alpha_beta_single_rolling_greeks_call(
    golden_returns, benchmark_returns, monkeypatch
):
    """Audit 2026-05-07 H-0711: rolling alpha + beta must share ONE
    qs.stats.rolling_greeks pass. Previously _rolling_alpha and _rolling_beta
    each called rolling_greeks independently, doubling the rolling-OLS work.
    """
    import services.metrics as metrics_module

    call_count = {"n": 0}
    real_rg = metrics_module.qs.stats.rolling_greeks

    def counting_rolling_greeks(*args, **kwargs):
        call_count["n"] += 1
        return real_rg(*args, **kwargs)

    monkeypatch.setattr(
        metrics_module.qs.stats, "rolling_greeks", counting_rolling_greeks
    )
    result = compute_all_metrics(golden_returns, benchmark_returns)
    # The siblings should still be populated...
    assert len(result.sibling_kinds["rolling_alpha"]) > 0
    assert len(result.sibling_kinds["rolling_beta"]) > 0
    # ...from EXACTLY ONE rolling_greeks pass.
    assert call_count["n"] == 1, (
        f"rolling_greeks should be called once per analytics run; got {call_count['n']}"
    )


def test_rolling_alpha_beta_aligns_misaligned_series():
    """Audit 2026-05-07 H-0726.1: rolling alpha/beta must inner-join the
    returns and benchmark indexes BEFORE calling qs.stats.rolling_greeks.
    Previously raw un-aligned series were passed, letting qs internally NaN-pad
    across mismatched trading calendars and producing skewed greeks.
    """
    np.random.seed(31)
    dates_strat = pd.bdate_range("2024-01-01", periods=200)
    # Benchmark covers a partially-overlapping window — only ~150 days in
    # common. With alignment, that's enough for window=90 rolling greeks.
    # Without alignment qs sees 200 strat rows vs 200 bench rows with mismatched
    # indexes and produces garbage (or raises) depending on version.
    dates_bench = pd.bdate_range("2024-02-15", periods=200)
    strat = pd.Series(np.random.normal(0.001, 0.01, 200), index=dates_strat, name="returns")
    bench = pd.Series(np.random.normal(0.0005, 0.012, 200), index=dates_bench, name="BTC")

    alpha, beta = _rolling_alpha_beta(strat, bench, 90)
    # The helper aligned and produced output (the un-aligned implementation
    # either raised or produced NaN-only output that finalize_rolling dropped).
    assert isinstance(alpha, list)
    assert isinstance(beta, list)
    assert len(alpha) > 0
    assert len(beta) > 0


def test_rolling_alpha_beta_short_benchmark_returns_empty():
    """Audit 2026-05-07 H-0726.2: a benchmark with fewer than `window` aligned
    observations must return ([], []). The old guard only checked
    `len(returns) < window`, letting a short benchmark slip through and either
    raise or produce malformed greeks that hit the silent 'alpha not in greeks'
    fallback.
    """
    np.random.seed(41)
    dates_strat = pd.bdate_range("2024-01-01", periods=200)
    # 50-day benchmark — less than window=90 after alignment.
    dates_bench = pd.bdate_range("2024-01-01", periods=50)
    strat = pd.Series(np.random.normal(0.001, 0.01, 200), index=dates_strat, name="returns")
    bench = pd.Series(np.random.normal(0.0005, 0.012, 50), index=dates_bench, name="BTC")

    alpha, beta = _rolling_alpha_beta(strat, bench, 90)
    assert alpha == []
    assert beta == []


def test_rolling_alpha_beta_logs_warning_on_qs_failure(
    golden_returns, benchmark_returns, monkeypatch, caplog
):
    """Audit 2026-05-07 H-0726.3: when qs.stats.rolling_greeks raises (e.g.
    qs version drift, missing columns), the helper must emit a WARNING and
    return ([], []) — NOT swallow it silently as before.
    """
    import services.metrics as metrics_module

    def boom_rolling_greeks(_returns, _benchmark, _window):
        raise RuntimeError("simulated qs.stats.rolling_greeks failure")

    monkeypatch.setattr(
        metrics_module.qs.stats, "rolling_greeks", boom_rolling_greeks
    )

    with caplog.at_level(logging.WARNING, logger="quantalyze.analytics.metrics"):
        alpha, beta = _rolling_alpha_beta(golden_returns, benchmark_returns, 90)
    assert alpha == []
    assert beta == []
    matching = [r for r in caplog.records if "rolling_greeks" in r.getMessage()]
    assert matching, "rolling_greeks failure must emit WARNING with helper name"


def test_rolling_alpha_beta_missing_columns_returns_empty_and_logs(
    golden_returns, benchmark_returns, monkeypatch, caplog
):
    """M-0682: when qs.stats.rolling_greeks SUCCEEDS but the returned
    DataFrame is missing the expected 'alpha'/'beta' columns (a qs version
    that renames them), the helper must return ([], []) AND emit a WARNING.
    This is a DISTINCT branch from the qs-raises path — the call returns
    cleanly, but the columns aren't there. Previously the silent
    empty-return masked qs column drift.
    """
    import services.metrics as metrics_module

    def greeks_without_alpha_beta(returns, _benchmark, _window):
        # A DataFrame with the right index but the wrong column name.
        return pd.DataFrame({"gamma": [1.0] * len(returns)}, index=returns.index)

    monkeypatch.setattr(
        metrics_module.qs.stats, "rolling_greeks", greeks_without_alpha_beta
    )

    with caplog.at_level(logging.WARNING, logger="quantalyze.analytics.metrics"):
        alpha, beta = _rolling_alpha_beta(golden_returns, benchmark_returns, 90)
    assert alpha == []
    assert beta == []
    matching = [
        r for r in caplog.records
        if "missing expected alpha/beta columns" in r.getMessage()
    ]
    assert matching, (
        "missing alpha/beta columns must emit a WARNING so a qs column "
        "rename is operator-visible, not silently swallowed."
    )


def test_rolling_alpha_beta_none_benchmark_returns_empty():
    """M-0683: the `if returns is None or benchmark is None: return [], []`
    guard lumps two independent None conditions. The happy-path tests never
    call the helper with benchmark=None directly (compute_all_metrics
    short-circuits at a higher `if has_benchmark` level), so the None
    branch inside the helper is reachable-but-unverified. Pin both halves.
    """
    np.random.seed(73)
    strat = pd.Series(
        np.random.normal(0.001, 0.01, 200),
        index=pd.bdate_range("2024-01-01", periods=200),
        name="returns",
    )
    # benchmark None
    assert _rolling_alpha_beta(strat, None, 90) == ([], [])
    # returns None (the other half of the same guard)
    assert _rolling_alpha_beta(None, strat, 90) == ([], [])
    # The public wrappers must propagate the empty result.
    assert _rolling_alpha(strat, None, 90) == []
    assert _rolling_beta(strat, None, 90) == []


def test_rolling_sortino_single_neg_sq_in_compute_all_metrics(
    golden_returns, monkeypatch
):
    """Audit 2026-05-07 H-0721: compute_all_metrics must materialize the
    window-independent neg_sq series exactly ONCE across the three rolling
    Sortino windows (63 / 126 / 252). The shared component is now passed to
    `_rolling_sortino_from_components`.
    """
    import services.metrics as metrics_module

    call_count = {"n": 0}
    real_from_components = metrics_module._rolling_sortino_from_components
    seen_neg_sq_ids: set[int] = set()

    def counting_from_components(returns, neg_sq, window, **kwargs):
        # Phase 34: forward **kwargs so the new `periods_per_year` keyword
        # threaded by compute_all_metrics reaches the real helper unchanged.
        call_count["n"] += 1
        seen_neg_sq_ids.add(id(neg_sq))
        return real_from_components(returns, neg_sq, window, **kwargs)

    monkeypatch.setattr(
        metrics_module, "_rolling_sortino_from_components", counting_from_components
    )
    compute_all_metrics(golden_returns)
    # Three windows → three calls, but the SAME neg_sq object is reused.
    assert call_count["n"] == 3
    assert len(seen_neg_sq_ids) == 1, (
        "neg_sq must be materialized ONCE and reused across all three sortino windows"
    )


def test_log_returns_series_full_length(golden_returns):
    """METRICS-12: log_returns has same length as input (no window dropoff)."""
    result = _log_returns_series(golden_returns)
    assert isinstance(result, list)
    assert len(result) == len(golden_returns)


def test_log_returns_series_values(golden_returns):
    """METRICS-12: values match cumulative `np.log1p(returns).cumsum()`.

    Audit 2026-05-07 H-0719: the EquityCurve "Log Returns" toggle renders
    this series on a log axis where the meaningful shape is cumulative log
    equity, NOT per-period log returns. The previous contract (per-period)
    rendered as noise hovering around 0.
    """
    expected = np.log1p(golden_returns).cumsum()
    result = _log_returns_series(golden_returns)
    # _finalize_rolling rounds to 4 decimals
    for point, exp in zip(result, expected):
        assert abs(point["value"] - round(float(exp), 4)) < 1e-4


def test_log_returns_series_monotonic_when_returns_positive():
    """Audit 2026-05-07 H-0719: cumulative log equity must be MONOTONIC
    NON-DECREASING when every input return is non-negative. The old per-period
    contract failed this — values oscillated around zero even on a strictly
    upward-trending strategy.
    """
    dates = pd.bdate_range("2024-01-01", periods=100)
    returns = pd.Series(np.full(100, 0.001), index=dates, name="returns")
    result = _log_returns_series(returns)
    values = [p["value"] for p in result]
    for i in range(len(values) - 1):
        assert values[i + 1] >= values[i] - 1e-9, (
            f"cumulative log equity must be monotonic for positive returns; "
            f"got {values[i]} → {values[i+1]} at index {i}"
        )


def test_log_returns_series_preserves_catastrophic_loss():
    """Audit 2026-05-07 H-0728: a return of -1 or worse (100%+ loss — a
    liquidation event) previously hit `np.log1p(-1.05)` → NaN, which
    `_finalize_rolling.dropna()` silently removed. The SINGLE most important
    risk event for the strategy would vanish from the chart. We now clamp to
    -1+1e-9 before log1p so the event surfaces as a large negative log
    return (~-20.72), not a dropped row.
    """
    dates = pd.bdate_range("2024-01-01", periods=10)
    values = np.array([0.01, 0.02, 0.01, -1.0, 0.005, -0.5, 0.003, 0.0, 0.004, 0.001])
    returns = pd.Series(values, index=dates, name="returns")
    result = _log_returns_series(returns)
    # Catastrophic event preserved (no row dropped).
    assert len(result) == 10
    # The cumulative log equity at the catastrophic day must be very large
    # negative — the strategy is essentially wiped out.
    cat_idx = 3  # 4th day in the values array (zero-indexed)
    assert result[cat_idx]["value"] < -19.0, (
        "catastrophic-loss day must surface as a very negative cumulative "
        f"log equity; got {result[cat_idx]['value']}"
    )


def test_log_returns_series_empty_input(empty_returns):
    """M-0685: `_log_returns_series` short-circuits on len(returns) == 0 and
    returns []. `_daily_returns_grid_from_series` has the symmetric
    `test_daily_returns_grid_empty_input` test but the log helper lacked
    one — a trivial-but-real coverage gap on a public sibling-kind producer.
    """
    assert _log_returns_series(empty_returns) == []


# ---------------------------------------------------------------------------
# Phase 12 / Plan 04 — METRICS-04, METRICS-11 — RED tests
# ---------------------------------------------------------------------------
# Daily returns grid (flat per-day list, sibling-table kind 'daily_returns_grid')
# + 10 new qstats scalars (Recovery Factor through Time-in-Market) computed via
# qs.stats.{name}(returns) one-liners with try/except fail-soft to None.
# Mirrors `_monthly_returns_grid_from_series` template at metrics.py:351 (D-03)
# and the existing try/except pattern at metrics.py:97-138.

from services.metrics import (
    _daily_returns_grid_from_series,
    _QSTATS_SINGLE_ARG_SCALARS,
    compute_qstats_scalars,
)


def test_daily_returns_grid_full_length(golden_returns):
    """METRICS-04: flat per-day list with date+value (D-03 storage shape)."""
    grid = _daily_returns_grid_from_series(golden_returns)
    assert isinstance(grid, list)
    assert len(grid) == len(golden_returns)
    for point in grid:
        assert "date" in point and "value" in point
        # Date format YYYY-MM-DD
        assert len(point["date"]) == 10 and point["date"][4] == "-"


def test_daily_returns_grid_round_to_6_decimals(golden_returns):
    """METRICS-04: values rounded to 6 decimals (matches monthly grid template)."""
    grid = _daily_returns_grid_from_series(golden_returns)
    for point in grid:
        assert isinstance(point["value"], float)
        # Within 6-decimal precision
        assert abs(point["value"] - round(point["value"], 6)) < 1e-9


def test_daily_returns_grid_empty_input(empty_returns):
    """METRICS-04: empty input returns empty list (graceful)."""
    assert _daily_returns_grid_from_series(empty_returns) == []


def test_daily_returns_grid_scrubs_nan_and_inf():
    """Audit 2026-05-07 H-0715: a single NaN or Inf row must NOT appear in the
    emitted list. Postgres JSONB rejects NaN, so an unscrubbed NaN would knock
    out the entire atomic sibling-kind batch upsert for the strategy.
    """
    dates = pd.bdate_range("2024-01-01", periods=10)
    values = np.array([0.01, 0.02, np.nan, -0.01, np.inf, 0.005, -np.inf, 0.003, 0.0, 0.004])
    returns = pd.Series(values, index=dates, name="returns")
    grid = _daily_returns_grid_from_series(returns)
    # Only the 7 clean rows survive (3 dropped: NaN, +Inf, -Inf).
    assert len(grid) == 7
    for point in grid:
        v = point["value"]
        assert not math.isnan(v) and not math.isinf(v)


def test_daily_returns_grid_caps_payload_size():
    """Audit 2026-05-07 H-0720: a 10-year backtest must not bypass the
    cap_data_points budget that every other series helper enforces. The cap
    is 5000 points; we exercise a 7000-point series to prove the cap kicks in.
    """
    dates = pd.bdate_range("2010-01-01", periods=7000)
    returns = pd.Series(np.full(7000, 0.001), index=dates, name="returns")
    grid = _daily_returns_grid_from_series(returns)
    # cap_data_points caps at 5000 (default) keeping the most recent.
    assert len(grid) == 5000


def test_qstats_scalars_complete_set(golden_returns, benchmark_returns):
    """METRICS-11: all 10 new scalars present (None if computation fails).

    Audit 2026-05-07 H-0718: also exposes `r_squared_status` companion field
    so operators can disambiguate 'no benchmark' / 'ok' / 'error'.
    """
    result = compute_qstats_scalars(golden_returns, benchmark_returns)
    expected_keys = {
        "recovery_factor", "ulcer_index", "upi", "kelly_criterion",
        "probabilistic_sharpe_ratio", "common_sense_ratio", "cpc_index",
        "serenity_index", "r_squared", "time_in_market",
        "r_squared_status",
    }
    assert set(result.keys()) == expected_keys
    for key, val in result.items():
        if key == "r_squared_status":
            assert val in {"no_benchmark", "ok", "error"}
        else:
            assert val is None or isinstance(val, (int, float))

    # H-0781: a POSITIVE-output floor. The any-None-or-number loop above passes
    # even if `compute_qstats_scalars` returns {k: None for k in keys} — which is
    # exactly what the per-KPI `try/except Exception: pass` silent-swallow would
    # produce if quantstats drifts (API rename, numpy/pandas major bump) and
    # every KPI raises. That regression (flagged in S15b) would slip the
    # membership-only assertion. On a healthy 500-day golden series WITH a
    # benchmark, ALL 10 numeric scalars are computable (verified) — assert a
    # >=8 floor so an all-None swallow regression fails loud here.
    numeric = {k: v for k, v in result.items() if k != "r_squared_status"}
    assert len(numeric) == 10
    non_none = sum(1 for v in numeric.values() if v is not None)
    assert non_none >= 8, (
        "METRICS-11 positive-output floor: expected >=8 of 10 qstats scalars to "
        f"compute on the golden fixture, got {non_none}. A drop toward 0 means "
        "the per-KPI try/except is silently swallowing a quantstats regression "
        "(see S15b silent-failure finding #1)."
    )
    # And the benchmark-dependent r_squared specifically must compute (it is the
    # canary for benchmark-path swallows that the no-benchmark sibling test below
    # cannot see).
    assert result["r_squared"] is not None
    assert result["r_squared_status"] == "ok"


def test_qstats_scalars_handle_missing_benchmark(golden_returns):
    """METRICS-11: r_squared returns None when benchmark missing (graceful).

    Audit 2026-05-07 H-0718: `r_squared_status` must be 'no_benchmark' (not 'error')
    when the caller did not pass a benchmark series.
    """
    result = compute_qstats_scalars(golden_returns, None)
    assert result["r_squared"] is None
    assert result["r_squared_status"] == "no_benchmark"
    # Non-benchmark scalars still computed (tolerate qs failures via try/except)
    expected_keys = {
        "recovery_factor", "ulcer_index", "upi", "kelly_criterion",
        "probabilistic_sharpe_ratio", "common_sense_ratio", "cpc_index",
        "serenity_index", "r_squared", "time_in_market",
        "r_squared_status",
    }
    assert set(result.keys()) == expected_keys
    # H-0781: positive-output floor for the no-benchmark path. r_squared is
    # intentionally None (no benchmark), so the OTHER 9 numeric scalars must
    # still compute on the golden series. Without this, an all-swallow
    # regression returning every benchmark-independent KPI as None passes the
    # membership-only check. (Verified: 9/10 compute here.)
    numeric_non_bench = {
        k: v for k, v in result.items()
        if k not in {"r_squared", "r_squared_status"}
    }
    assert len(numeric_non_bench) == 9
    non_none = sum(1 for v in numeric_non_bench.values() if v is not None)
    assert non_none >= 8, (
        "METRICS-11 positive-output floor (no benchmark): expected >=8 of the 9 "
        f"benchmark-independent qstats scalars to compute, got {non_none}. A "
        "drop toward 0 means the per-KPI try/except is silently swallowing a "
        "quantstats regression."
    )


def test_qstats_scalars_logs_warning_on_qs_failure(golden_returns, caplog, monkeypatch):
    """Audit 2026-05-07 H-0710 / H-0713 / H-0723: a qs.stats.* failure must emit
    `logger.warning` with the scalar name + returns length so operators can detect
    silent regressions. Failure-soft contract (other 9 scalars unaffected) is
    preserved.
    """
    import services.metrics as metrics_module

    def boom_recovery_factor(_returns):
        raise RuntimeError("simulated qs.stats.recovery_factor failure")

    monkeypatch.setattr(
        metrics_module.qs.stats, "recovery_factor", boom_recovery_factor
    )

    with caplog.at_level(logging.WARNING, logger="quantalyze.analytics.metrics"):
        result = compute_qstats_scalars(golden_returns, None)

    # The failing scalar is None as before, the other 9 are still computed.
    assert result["recovery_factor"] is None
    # And the failure produced a WARNING log naming the scalar.
    failing_records = [
        r for r in caplog.records
        if "recovery_factor" in r.getMessage() and r.levelno == logging.WARNING
    ]
    assert failing_records, (
        "compute_qstats_scalars must log WARNING with scalar name on failure"
    )


def test_qstats_scalars_r_squared_status_error_on_qs_failure(
    golden_returns, benchmark_returns, monkeypatch
):
    """Audit 2026-05-07 H-0718: when a benchmark IS present but qs.stats.r_squared
    raises, the companion `r_squared_status` field must be 'error' (not 'no_benchmark'
    and not 'ok'). This is the disambiguation that lets operators see the failure
    state without trawling logs.
    """
    import services.metrics as metrics_module

    def boom_r_squared(_returns, _benchmark):
        raise RuntimeError("simulated qs.stats.r_squared failure")

    monkeypatch.setattr(metrics_module.qs.stats, "r_squared", boom_r_squared)

    result = compute_qstats_scalars(golden_returns, benchmark_returns)
    assert result["r_squared"] is None
    assert result["r_squared_status"] == "error"


def test_qstats_scalars_r_squared_status_error_when_qs_returns_nan(
    golden_returns, benchmark_returns, monkeypatch
):
    """Red-team F7: qs.stats.r_squared may RETURN NaN/Inf (not raise) — e.g.
    zero-variance benchmark, degenerate covariance. `_safe_float` collapses
    that to None, but the previous code unconditionally set status='ok'.
    Status must be 'error' whenever the final r_squared value is None.
    """
    import services.metrics as metrics_module

    def nan_r_squared(_returns, _benchmark):
        return float("nan")

    monkeypatch.setattr(metrics_module.qs.stats, "r_squared", nan_r_squared)

    result = compute_qstats_scalars(golden_returns, benchmark_returns)
    assert result["r_squared"] is None
    assert result["r_squared_status"] == "error"


def test_qstats_scalars_time_in_market_is_unbiased_fraction():
    """Audit 2026-05-07 H-0724: `time_in_market` must be the true fraction
    `(returns != 0).sum() / len(returns)`, NOT `qs.stats.exposure` which
    ceil-rounds UP to the nearest 1% (a strategy with 1 active day in 252
    would otherwise display as 1.0% instead of ~0.4%).
    """
    dates = pd.bdate_range("2024-01-01", periods=252)
    # 1 non-zero return day in 252: true exposure ≈ 0.00397, qs.stats.exposure → 0.01
    values = np.zeros(252)
    values[100] = 0.05
    returns = pd.Series(values, index=dates, name="returns")
    result = compute_qstats_scalars(returns, None)
    expected = 1.0 / 252.0
    assert result["time_in_market"] is not None
    # Must be the true fraction (< 0.005), NOT the ceil-rounded 0.01 from qs.
    assert abs(result["time_in_market"] - expected) < 1e-9
    assert result["time_in_market"] < 0.005


def test_qstats_scalars_time_in_market_excludes_nan_rows():
    """Specialist red-team: pandas evaluates `NaN != 0` as True, so the naive
    `(returns != 0).sum() / len` counts upstream-CSV gap days as 'in market',
    inflating the fraction. Mirrors qs.stats.exposure's NaN-exclusion predicate.
    """
    dates = pd.bdate_range("2024-01-01", periods=10)
    # 2 active days, 3 zero days, 5 NaN gap days → true exposure = 2/10.
    values = np.array([0.01, 0.0, np.nan, np.nan, 0.02, 0.0, np.nan, np.nan, np.nan, 0.0])
    returns = pd.Series(values, index=dates, name="returns")
    result = compute_qstats_scalars(returns, None)
    assert result["time_in_market"] == pytest.approx(0.2, abs=1e-9)


def test_qstats_scalars_r_squared_status_ok_when_benchmark_present(
    golden_returns, benchmark_returns
):
    """Specialist test-gap: the 'ok' status was never explicitly pinned. A
    regression that hard-coded 'no_benchmark' would have passed the membership
    check in test_qstats_scalars_complete_set.
    """
    result = compute_qstats_scalars(golden_returns, benchmark_returns)
    assert result["r_squared_status"] == "ok"
    assert result["r_squared"] is not None


def test_rolling_alpha_beta_zero_overlap_returns_empty():
    """Specialist test-gap (H-0726.1 follow-up): when the inner-join produces
    an EMPTY aligned index (completely disjoint date ranges), the helper must
    short-circuit to ([], []) instead of letting qs.stats.rolling_greeks see
    a zero-length input.
    """
    np.random.seed(53)
    strat = pd.Series(
        np.random.normal(0.001, 0.01, 100),
        index=pd.bdate_range("2023-01-01", periods=100),
        name="returns",
    )
    bench = pd.Series(
        np.random.normal(0.0005, 0.012, 100),
        index=pd.bdate_range("2024-06-01", periods=100),
        name="BTC",
    )
    alpha, beta = _rolling_alpha_beta(strat, bench, 90)
    assert alpha == []
    assert beta == []


@pytest.mark.parametrize("result_key,qs_attr", _QSTATS_SINGLE_ARG_SCALARS)
def test_qstats_scalars_dispatch_table_per_entry(
    golden_returns, caplog, monkeypatch, result_key, qs_attr
):
    """Specialist test-gap: the dispatch table (`_QSTATS_SINGLE_ARG_SCALARS`)
    is the single source of truth for 8 (key, qs.stats attr) pairs after the
    simplify refactor. A typo would silently produce None in production for
    one scalar. Parametrize the failure path across every entry so a regression
    fails the matching attribute's row, not a generic "scalar None" assertion.
    """
    import services.metrics as metrics_module

    def boom(_returns):
        raise RuntimeError(f"simulated qs.stats.{qs_attr} failure")

    monkeypatch.setattr(metrics_module.qs.stats, qs_attr, boom)
    with caplog.at_level(logging.WARNING, logger="quantalyze.analytics.metrics"):
        result = compute_qstats_scalars(golden_returns, None)
    assert result[result_key] is None
    matching = [r for r in caplog.records if result_key in r.getMessage()]
    assert matching, f"failure for qs.stats.{qs_attr} must log WARNING naming {result_key!r}"


# audit-2026-05-07 silent-failure sweep: regression tests for the
# bare-pass scalar swallows in compute_all_metrics that the H-0710
# conversion missed. Pre-sweep, each of these scalars used `except: pass`
# which left ZERO operator signal in Railway logs when qs.stats raised.
# After the sweep, the failure-soft contract is preserved (other scalars
# still computed) AND the failing scalar emits a WARNING naming itself.
@pytest.mark.parametrize(
    "scalar_key,qs_attr",
    [
        ("var_1d_95", "value_at_risk"),
        ("cvar", "cvar"),
        ("omega", "omega"),
        ("gain_pain", "gain_to_pain_ratio"),
        ("tail_ratio", "tail_ratio"),
        ("smart_sharpe", "smart_sharpe"),
        ("smart_sortino", "smart_sortino"),
        ("profit_factor", "profit_factor"),
    ],
)
def test_compute_all_metrics_inline_qstats_scalar_failures_log_warning(
    golden_returns, caplog, monkeypatch, scalar_key, qs_attr
):
    """Pre-sweep, these inline `try/except: pass` blocks in compute_all_metrics
    swallowed every qs.stats failure silently — the field went missing with no
    log, no DQF flag, nothing for an operator to triage. Post-sweep, the field
    is still failure-soft (other scalars unaffected) but the failure emits a
    WARNING naming the scalar + returns_len, mirroring the H-0710 /
    H-0713 / H-0723 pattern already used by `_safe_qstats_scalar`.
    """
    import services.metrics as metrics_module

    def boom(*args, **kwargs):
        raise RuntimeError(f"simulated qs.stats.{qs_attr} failure")

    monkeypatch.setattr(metrics_module.qs.stats, qs_attr, boom)
    with caplog.at_level(logging.WARNING, logger="quantalyze.analytics.metrics"):
        result = compute_all_metrics(golden_returns)
    # Failure-soft contract: the failing scalar is absent (or None), but
    # compute_all_metrics still returned a result.
    mj = result["metrics_json"]
    assert scalar_key not in mj or mj[scalar_key] is None, (
        f"scalar {scalar_key!r} should be absent/None when qs.stats.{qs_attr} raises"
    )
    # Fail-loud-on-observability: a WARNING must name the failing scalar.
    matching = [
        r for r in caplog.records
        if scalar_key in r.getMessage() and r.levelno == logging.WARNING
    ]
    assert matching, (
        f"compute_all_metrics must log WARNING naming {scalar_key!r} when "
        f"qs.stats.{qs_attr} raises, not silently swallow it"
    )


def test_compute_all_metrics_does_not_call_qstats_gini(
    golden_returns, caplog
):
    """PR #181 take-2 red-team F1: the `qs.stats.gini` call was removed
    because the pinned quantstats==0.0.81 has no `gini` attribute and
    the sweep's WARNING wrapper produced one permanent Railway log line
    per analytics run with no resolution path. The dead call is gone;
    `gini` is absent from metrics_json AND no WARNING fires that mentions
    `gini`. If gini is re-introduced (manual implementation or qs
    upgrade), this test should be replaced with a positive coverage
    assertion (`mj['gini'] is not None`).
    """
    with caplog.at_level(logging.WARNING, logger="quantalyze.analytics.metrics"):
        result = compute_all_metrics(golden_returns)
    mj = result["metrics_json"]
    assert "gini" not in mj, (
        "PR #181 take-2 removed the dead qs.stats.gini call; the key must "
        "no longer be present in metrics_json"
    )
    gini_warnings = [
        r for r in caplog.records
        if "gini" in r.getMessage() and r.levelno == logging.WARNING
    ]
    assert not gini_warnings, (
        "PR #181 take-2 dropped the gini call site; no WARNING mentioning "
        "'gini' should fire anymore (silencing the permanent noise floor)"
    )


def test_compute_all_metrics_var_1d_95_uses_correct_kwarg(
    golden_returns, caplog
):
    """PR #181 take-2 red-team F2: pre-take2, the var_1d_95 call passed
    `cutoff=0.05` but `qs.stats.value_at_risk`'s signature uses
    `confidence=0.95`. Every analytics run raised TypeError; the
    sweep's WARNING then made var_1d_95 a permanent Railway noise
    floor. Post-take2 the call uses `confidence=0.95` and var_1d_95
    is populated successfully — confirms the fix is wired and no
    'cutoff' WARNING fires on the live qs version.
    """
    with caplog.at_level(logging.WARNING, logger="quantalyze.analytics.metrics"):
        result = compute_all_metrics(golden_returns)
    mj = result["metrics_json"]
    # Positive coverage: var_1d_95 is populated (a finite negative
    # number for healthy returns since it's the lower-tail VaR).
    assert mj.get("var_1d_95") is not None, (
        "PR #181 take-2 expects var_1d_95 to be populated on the live "
        "quantstats version after the cutoff->confidence kwarg fix"
    )
    # Negative assertion: no var_1d_95 WARNING should fire about kwargs.
    bad_warnings = [
        r for r in caplog.records
        if "var_1d_95" in r.getMessage()
        and r.levelno == logging.WARNING
        and ("cutoff" in r.getMessage() or "unexpected keyword" in r.getMessage())
    ]
    assert not bad_warnings, (
        "PR #181 take-2 fixed the cutoff/confidence kwarg drift; no "
        "WARNING about unexpected keyword 'cutoff' should fire anymore"
    )


def test_compute_all_metrics_outlier_ratios_failure_logs_warning(
    golden_returns, caplog, monkeypatch
):
    """Pre-sweep, the outlier_win_ratio / outlier_loss_ratio pair was
    wrapped in a single bare `try/except: pass`. Post-sweep, the pair
    still degrades together (consistent UI state) but emits a WARNING
    when it fails.

    Review-cluster gate (audit-2026-05-07): the previous test recreated
    the exception handler inline AND grepped `inspect.getsource()` for
    the literal string — that was a tautology: a /simplify revert to
    bare-pass with the comment string left intact would have passed.
    This version REAL-TRIGGERS the protected block: monkeypatches
    `pd.Series.std` (called exactly once in compute_all_metrics — inside
    the outlier block, at line 563 of services/metrics.py) to raise,
    then calls compute_all_metrics. The WARNING must fire from the real
    code path, not from a re-emit in the test body.
    """
    # The outlier block is the FIRST site in compute_all_metrics that
    # calls `(returns > X).mean()` on a BOOLEAN Series (lines 566-567).
    # Every earlier `.mean()` call is on numeric Series. Patch
    # `pd.Series.mean` to raise ONLY when self.dtype is bool — a precise
    # unique trigger that doesn't cascade through qs.stats internals.
    orig_mean = pd.Series.mean

    def _mean_raises_on_bool_series(self, *args, **kwargs):
        # numpy dtype comparison is safer via str() — the .dtype object
        # of a boolean pandas Series is numpy.dtype('bool'), distinct
        # from the Python `bool` type.
        if str(getattr(self, "dtype", "")) == "bool":
            raise RuntimeError("simulated outlier ratios boolean-Series.mean failure")
        return orig_mean(self, *args, **kwargs)

    monkeypatch.setattr(pd.Series, "mean", _mean_raises_on_bool_series)

    with caplog.at_level(logging.WARNING, logger="quantalyze.analytics.metrics"):
        result = compute_all_metrics(golden_returns)
    # Failure-soft: outlier ratios may be absent, but the function still
    # produced a result.
    mj = result["metrics_json"]
    assert "outlier_win_ratio" not in mj or mj["outlier_win_ratio"] is None
    assert "outlier_loss_ratio" not in mj or mj["outlier_loss_ratio"] is None
    # The real code path must have emitted the WARNING. Tightened from
    # the prior loose 'outlier' substring filter to require the exact
    # log message prefix this sweep introduced — pins the contract.
    matching = [
        r for r in caplog.records
        if "outlier ratios failed" in r.getMessage()
        and r.levelno == logging.WARNING
    ]
    assert matching, (
        "compute_all_metrics must log WARNING 'outlier ratios failed' when "
        "the inner block raises (post audit-2026-05-07 silent-failure sweep); "
        "the prior bare-pass swallow is a regression"
    )
    # Pin structured-logging contract: exc_info must propagate the traceback.
    assert any(r.exc_info is not None for r in matching), (
        "outlier-ratios WARNING must use exc_info=True so operators get "
        "the traceback in Railway logs, not just the message"
    )


# ---------------------------------------------------------------------------
# Review-cluster gate (audit-2026-05-07): regression tests for the 3 sweep
# sites that the original parametrized test did NOT cover (var_1m_99 uses
# np.percentile, skewness uses Series.skew, kurtosis uses Series.kurtosis —
# all non-qs.stats so they can't be parametrized through the qs.stats
# monkeypatch path). A /simplify pass that drops these 3 WARNINGs would
# have shipped silently pre-gate.
# ---------------------------------------------------------------------------


def test_compute_all_metrics_var_1m_99_np_percentile_failure_logs_warning(
    golden_returns, caplog, monkeypatch
):
    """var_1m_99 uses `np.percentile(monthly_rets, 1)`, not qs.stats. The
    sweep added a WARNING for that site; this test pins the contract.

    PR #181 take-2 fix: pre-take2 the monkeypatch replaced np.percentile
    globally with a boom() function. On Python 3.12 + older pandas, the
    pandas Series.quantile internals route through np.percentile, so the
    boom() trips _return_quantiles BEFORE the var_1m_99 try block is
    reached. On Python 3.14 + newer pandas, Series.quantile uses a
    different code path and the boom() only fires inside var_1m_99 as
    intended. To make the test cross-runtime-stable, narrow the
    boom-trigger to the EXACT call signature var_1m_99 uses:
    `np.percentile(monthly_rets, 1)` — single positional arg pair, no
    axis, no method kwarg.
    """
    import services.metrics as metrics_module

    orig_percentile = metrics_module.np.percentile

    def boom_on_var_1m_99_only(*args, **kwargs):
        # var_1m_99's call shape is np.percentile(monthly_rets, 1) — a
        # 1D Series-derived array as positional arg 0, the SCALAR int
        # 1 as positional arg 1, no axis/method kwargs. Pandas
        # internals call np.percentile with an ARRAY q positional and
        # axis=/method= kwargs. Trip only on the var_1m_99 shape
        # (axis/method absent + arg[1] is an int-typed scalar) so the
        # pandas-internal calls pass through to real numpy.
        if (
            len(args) == 2
            and "axis" not in kwargs
            and "method" not in kwargs
            and isinstance(args[1], int)
            and args[1] == 1
        ):
            raise RuntimeError("simulated np.percentile failure")
        return orig_percentile(*args, **kwargs)

    monkeypatch.setattr(metrics_module.np, "percentile", boom_on_var_1m_99_only)
    with caplog.at_level(logging.WARNING, logger="quantalyze.analytics.metrics"):
        result = compute_all_metrics(golden_returns)
    mj = result["metrics_json"]
    assert "var_1m_99" not in mj or mj["var_1m_99"] is None
    matching = [
        r for r in caplog.records
        if "var_1m_99" in r.getMessage() and r.levelno == logging.WARNING
    ]
    assert matching, (
        "compute_all_metrics must log WARNING naming 'var_1m_99' when "
        "np.percentile raises (post audit-2026-05-07 silent-failure sweep); "
        "pre-sweep bare-pass swallow is a regression"
    )


def test_compute_all_metrics_skewness_pandas_failure_logs_warning(
    golden_returns, caplog, monkeypatch
):
    """skewness uses `returns.skew()`, a pandas Series method. The sweep
    added a WARNING for that site; this test pins the contract.
    """
    def boom(self, *args, **kwargs):
        raise RuntimeError("simulated Series.skew failure")

    monkeypatch.setattr(pd.Series, "skew", boom)
    with caplog.at_level(logging.WARNING, logger="quantalyze.analytics.metrics"):
        result = compute_all_metrics(golden_returns)
    mj = result["metrics_json"]
    assert "skewness" not in mj or mj["skewness"] is None
    matching = [
        r for r in caplog.records
        if "skewness" in r.getMessage() and r.levelno == logging.WARNING
    ]
    assert matching, (
        "compute_all_metrics must log WARNING naming 'skewness' when "
        "Series.skew raises (post audit-2026-05-07 silent-failure sweep)"
    )


def test_compute_all_metrics_kurtosis_pandas_failure_logs_warning(
    golden_returns, caplog, monkeypatch
):
    """kurtosis uses `returns.kurtosis()`, a pandas Series method. The sweep
    added a WARNING for that site; this test pins the contract.
    """
    def boom(self, *args, **kwargs):
        raise RuntimeError("simulated Series.kurtosis failure")

    monkeypatch.setattr(pd.Series, "kurtosis", boom)
    with caplog.at_level(logging.WARNING, logger="quantalyze.analytics.metrics"):
        result = compute_all_metrics(golden_returns)
    mj = result["metrics_json"]
    assert "kurtosis" not in mj or mj["kurtosis"] is None
    matching = [
        r for r in caplog.records
        if "kurtosis" in r.getMessage() and r.levelno == logging.WARNING
    ]
    assert matching, (
        "compute_all_metrics must log WARNING naming 'kurtosis' when "
        "Series.kurtosis raises (post audit-2026-05-07 silent-failure sweep)"
    )


# ---------------------------------------------------------------------------
# Review-cluster gate (audit-2026-05-07): pin the structured-logging
# contract (exc_info=True) for the parametrized qs.stats scalars. A
# /simplify pass that drops `exc_info=True` as 'unused' would lose the
# operator-triage trail in Railway. This test adds the missing assertion.
# ---------------------------------------------------------------------------


def test_compute_all_metrics_qstats_scalar_warnings_carry_exc_info(
    golden_returns, caplog, monkeypatch
):
    """The 11 sweep WARNINGs use `exc_info=True` to attach the traceback.
    The original parametrized test asserted message + level only — a
    regression that drops exc_info=True would pass. This test pins it for
    one representative scalar; the assertion structure mirrors what
    operators rely on in Railway log aggregation.
    """
    import services.metrics as metrics_module

    def boom(*args, **kwargs):
        raise RuntimeError("simulated qs.stats.value_at_risk failure")

    monkeypatch.setattr(metrics_module.qs.stats, "value_at_risk", boom)
    with caplog.at_level(logging.WARNING, logger="quantalyze.analytics.metrics"):
        compute_all_metrics(golden_returns)
    matching = [
        r for r in caplog.records
        if "var_1d_95" in r.getMessage() and r.levelno == logging.WARNING
    ]
    assert matching, "expected a WARNING naming var_1d_95 for sanity"
    assert any(r.exc_info is not None for r in matching), (
        "qstats scalar WARNINGs must use exc_info=True so operators get "
        "the traceback (post audit-2026-05-07 silent-failure sweep)"
    )


# ---------------------------------------------------------------------------
# NEW-C02-01: compute_risk_of_ruin probability must be in [0, 1]
# ---------------------------------------------------------------------------

from services.metrics import compute_risk_of_ruin  # noqa: E402


def test_risk_of_ruin_low_winrate_high_payoff_clamped():
    """NEW-C02-01 / CR-C1: 40%-win / 3:1-payoff (positive Kelly edge, p < 0.5).

    Old code gated on p*r>q (1.2>0.6 = True) but computed (q/p)^exp =
    (0.6/0.4)^exp = 1.5^exp which explodes to values far above 1.0.

    CR-C1 (specialist review 2026-05-26) refines the p <= 0.5 branch: for a
    strategy with positive Kelly edge (p*r > q), the Cox-Miller formula is not
    valid (q/p >= 1). Instead of silently returning 1.0 (misleading: trend-
    following strategies with 40%-win / 3:1-payoff are NOT certain-ruin), we
    return None so the UI can render "N/A — formula requires win rate > 50%".
    """
    result = compute_risk_of_ruin(win_rate=0.40, payoff_ratio=3.0, avg_trade_size=0.01)
    for entry in result:
        prob = entry["probability"]
        # CR-C1: positive-edge sub-50%-win → None (N/A), not 1.0 (misleading) or >1.0
        assert prob is None, (
            f"risk_of_ruin probability should be None for positive-edge sub-50%-win "
            f"strategy (CR-C1 regression — got {prob!r}; old code returned >1.0 or "
            "1.0 without checking Kelly edge)"
        )


def test_risk_of_ruin_high_winrate_decays():
    """NEW-C02-01: 60%-win / 1.5:1-payoff (p > 0.5) should produce DECAYING
    probabilities (deeper loss = lower probability of ruin) and all in [0,1]."""
    result = compute_risk_of_ruin(win_rate=0.60, payoff_ratio=1.5, avg_trade_size=0.01)
    probs = [e["probability"] for e in result]
    assert all(p is not None for p in probs)
    assert all(0.0 <= p <= 1.0 for p in probs), f"probabilities not in [0,1]: {probs}"
    # Deeper loss level → same or lower probability (monotone decay)
    for i in range(len(probs) - 1):
        assert probs[i] >= probs[i + 1], (
            f"risk_of_ruin should be non-increasing with loss depth; "
            f"probs[{i}]={probs[i]} > probs[{i+1}]={probs[i+1]}"
        )


def test_risk_of_ruin_zero_winrate_returns_one():
    """Boundary: p=0 → always ruin."""
    result = compute_risk_of_ruin(win_rate=0.0, payoff_ratio=2.0, avg_trade_size=0.01)
    for entry in result:
        assert entry["probability"] == 1.0


def test_risk_of_ruin_low_winrate_no_edge_returns_one():
    """CR-C1: 40%-win / 0.5:1-payoff — no positive Kelly edge (p*r=0.2 < q=0.6).
    Genuine ruin territory — should return 1.0, not None."""
    result = compute_risk_of_ruin(win_rate=0.40, payoff_ratio=0.5, avg_trade_size=0.01)
    for entry in result:
        prob = entry["probability"]
        assert prob == 1.0, (
            f"risk_of_ruin must return 1.0 for no-edge sub-50%-win strategy "
            f"(CR-C1 regression — got {prob!r})"
        )


def test_risk_of_ruin_50pct_winrate_positive_payoff_returns_one():
    """red-team C1 (2026-05-26): p == 0.5 exactly with positive payoff ratio
    (r=2.0) — a 50%-win / 2:1-payoff strategy.

    Old code: strict `p > q` guard → False at boundary → fell through to
    `p*r > q` (1.0 > 0.5 → True) → returned None instead of 1.0.

    Cox-Miller formula at p=0.5: (q/p)^N = (0.5/0.5)^N = 1.0^N = 1.0.
    Certain ruin is the mathematically correct answer; the clamp handles it.
    Fixed: `p >= q and r > 0` admits the boundary.
    """
    result = compute_risk_of_ruin(win_rate=0.5, payoff_ratio=2.0, avg_trade_size=0.01)
    for entry in result:
        prob = entry["probability"]
        assert prob == 1.0, (
            f"risk_of_ruin must return 1.0 for p=0.5 / r=2.0 (red-team C1 "
            f"regression — old code returned None; got {prob!r})"
        )


def test_risk_of_ruin_high_winrate_zero_payoff_returns_one():
    """red-team H1 (2026-05-26): p=0.6 with r=0 (zero payoff ratio).

    Old code: strict `p > q` guard → True → entered decay branch →
    returned ~0.017 (low-ruin). But r=0 means every "win" contributes
    nothing; the strategy bleeds losses to certain ruin.

    Fixed: `p >= q and r > 0` — zero payoff fails the r>0 guard, falls
    through to `p*r > q` (0.6*0=0 is not > 0.4) → else → 1.0.
    """
    result = compute_risk_of_ruin(win_rate=0.6, payoff_ratio=0.0, avg_trade_size=0.01)
    for entry in result:
        prob = entry["probability"]
        assert prob == 1.0, (
            f"risk_of_ruin must return 1.0 for p=0.6 / r=0 (red-team H1 "
            f"regression — old code returned ~0.017; got {prob!r})"
        )


# ---------------------------------------------------------------------------
# NEW-C02-02: _rolling_sharpe zero-variance guard
# ---------------------------------------------------------------------------

from services.metrics import _rolling_sharpe  # noqa: E402


def test_rolling_sharpe_flat_window_no_inf_no_warning():
    """NEW-C02-02: an all-identical returns window (std==0) must not emit Inf
    or a RuntimeWarning.  Old code had no np.where guard (unlike _rolling_sortino).
    """
    dates = pd.bdate_range("2024-01-01", periods=60)
    # First 30 days normal, next 30 flat (std=0 → roll_std=0 → old code: ±Inf)
    values = list(np.random.normal(0.001, 0.01, 30)) + [0.001] * 30
    returns = pd.Series(values, index=dates)

    with warnings.catch_warnings():
        warnings.simplefilter("error", RuntimeWarning)
        # Must not raise a RuntimeWarning for divide-by-zero
        result = _rolling_sharpe(returns, window=30)

    for point in result:
        v = point["value"]
        assert math.isfinite(v), (
            f"_rolling_sharpe emitted non-finite value {v} on flat window "
            "(NEW-C02-02 regression — missing np.where guard)"
        )


# ---------------------------------------------------------------------------
# NEW-C02-03: consecutive_losses must not count flat/NaN days
# ---------------------------------------------------------------------------


def test_consecutive_losses_excludes_flat_and_nan_days():
    """NEW-C02-03: returns=[0,0,0,0] must NOT produce consecutive_losses=4."""
    dates = pd.bdate_range("2024-01-01", periods=4)
    flat_returns = pd.Series([0.0, 0.0, 0.0, 0.0], index=dates)
    result = compute_all_metrics(flat_returns)
    mj = result["metrics_json"]
    assert mj["consecutive_losses"] == 0, (
        f"consecutive_losses={mj['consecutive_losses']} for all-zero returns; "
        "expected 0 (NEW-C02-03 regression — flat days counted as losses)"
    )
    assert mj["consecutive_wins"] == 0


def test_consecutive_losses_only_negative_days_count():
    """NEW-C02-03: [+0.01, -0.02, 0.0, -0.01] → consecutive_losses=1 (no run ≥2)."""
    dates = pd.bdate_range("2024-01-01", periods=4)
    returns = pd.Series([0.01, -0.02, 0.0, -0.01], index=dates)
    result = compute_all_metrics(returns)
    mj = result["metrics_json"]
    # The zero day (index 2) must NOT extend the loss streak started at index 1
    assert mj["consecutive_losses"] == 1, (
        f"consecutive_losses={mj['consecutive_losses']}; expected 1 — "
        "zero return day must break the loss streak (NEW-C02-03)"
    )


# ---------------------------------------------------------------------------
# NEW-C02-04: monthly resample must not fabricate phantom 0.0 for empty periods
# ---------------------------------------------------------------------------


def test_monthly_rets_no_phantom_zeros_on_sparse_calendar():
    """NEW-C02-04: a returns series with a two-month gap must not produce a
    phantom 0.0 month for the missing period.
    """
    # Jan + Mar data only — no Feb trades
    dates = (
        pd.bdate_range("2024-01-15", periods=5).tolist()
        + pd.bdate_range("2024-03-15", periods=5).tolist()
    )
    values = [0.005] * 10
    returns = pd.Series(values, index=pd.DatetimeIndex(dates))

    # Directly import the helper under test
    import services.metrics as metrics_module
    monthly_rets = (
        returns.resample("ME")
        .apply(lambda x: (1 + x).prod() - 1 if len(x) > 0 else float("nan"))
        .dropna()
    )
    # With the fix there must be no Feb entry (only Jan + Mar)
    assert len(monthly_rets) == 2, (
        f"Expected 2 months (Jan+Mar), got {len(monthly_rets)} — "
        "phantom 0.0 Feb month fabricated (NEW-C02-04 regression)"
    )
    for v in monthly_rets.values:
        assert v != 0.0, "Phantom 0.0 found in monthly_rets (NEW-C02-04)"


# ---------------------------------------------------------------------------
# NEW-C02-05: cumulative_return scalar uses raw returns (not fillna(0))
# ---------------------------------------------------------------------------


def test_cumulative_return_is_suffix_honest_not_fillna_or_bridge():
    """NEW-C02-05 + DQ-03 (§6.2 behavior change): a gap day is NEVER treated as
    0% (not fillna(0)). Under DQ-03 an INTERIOR gap is also no longer silently
    BRIDGED — cumulative_return compounds ONLY the maximal contiguous suffix
    after the last break. This consciously supersedes the old
    ``(1+returns.dropna()).prod()`` expectation (which bridged the interior gap):
    the honest number now equals the post-break suffix product and differs from
    BOTH the fillna(0) and the dropna-bridge products.
    """
    dates = pd.bdate_range("2024-01-01", periods=50)
    np.random.seed(42)
    values = list(np.random.normal(0.001, 0.01, 50))
    # Interior gap day (index 10) flanked by valid returns on both sides.
    values[10] = float("nan")
    returns = pd.Series(values, index=dates)

    result = compute_all_metrics(returns)
    reported = result["cumulative_return"]

    # DQ-03: only the suffix AFTER the interior break (days 11..49) compounds.
    expected_suffix = float((1 + returns.iloc[11:]).prod() - 1)
    bridged = float((1 + returns.dropna()).prod() - 1)  # the old bridged product
    fillna0 = float((1 + returns.fillna(0)).prod() - 1)  # gap-as-0% product
    assert abs(reported - expected_suffix) < 1e-12, (
        f"cumulative_return={reported} must equal the post-break suffix product "
        f"{expected_suffix} (DQ-03 §6.2), never bridging the interior gap"
    )
    assert expected_suffix != pytest.approx(bridged)  # no longer bridges
    assert expected_suffix != pytest.approx(fillna0)  # gap not treated as 0%


# ---------------------------------------------------------------------------
# NEW-C02-11: _return_quantiles monthly resample not computed twice
# ---------------------------------------------------------------------------

from services.metrics import _return_quantiles  # noqa: E402


def test_return_quantiles_accepts_precomputed_monthly(golden_returns):
    """NEW-C02-11: when monthly_rets is passed, _return_quantiles must use it
    rather than recomputing the expensive resample.  Verify the output is
    identical whether the caller passes monthly_rets or leaves it None.
    """
    import services.metrics as metrics_module

    # red-team H2 (2026-05-26): use the SAME guard as production
    # (compute_all_metrics line ~398: x.notna().any()) so the test cannot
    # silently pass phantom months through when the precomputed path is used.
    # The old len(x) > 0 guard included all-NaN calendar buckets as 0.0,
    # which is exactly the phantom-month bug that x.notna().any() was added
    # to prevent.
    monthly_rets = (
        golden_returns.resample("ME")
        .apply(lambda x: (1 + x).prod() - 1 if x.notna().any() else float("nan"))
        .dropna()
    )
    result_with = _return_quantiles(golden_returns, monthly_rets=monthly_rets)
    result_without = _return_quantiles(golden_returns, monthly_rets=None)

    assert result_with.get("Monthly") == result_without.get("Monthly"), (
        "Monthly quantiles differ when monthly_rets passed vs computed internally "
        "(NEW-C02-11 regression)"
    )


# ---------------------------------------------------------------------------
# CR-I1 (code-review): flat day between two losses must break the streak
# (test coverage gap identified by specialist review 2026-05-26)
# ---------------------------------------------------------------------------


def test_consecutive_losses_flat_day_breaks_streak():
    """CR-I1: [-0.02, 0.0, -0.01] → consecutive_losses=1, not 2.

    A zero-return day (is_negative=0) creates a group boundary in the
    is_negative cumsum grouper, so the two single-day loss runs are
    separate groups with max=1. Locks in the flat-day-breaks-streak
    semantics.
    """
    dates = pd.bdate_range("2024-01-01", periods=3)
    returns = pd.Series([-0.02, 0.0, -0.01], index=dates)
    result = compute_all_metrics(returns)
    mj = result["metrics_json"]
    assert mj["consecutive_losses"] == 1, (
        f"consecutive_losses={mj['consecutive_losses']}; expected 1 — "
        "flat day between two loss days must break the streak (CR-I1)"
    )


# ---------------------------------------------------------------------------
# SF-M3 (silent-failure): NaN gap day between losses — documents intended
# behavior (gap day breaks streak, consistent with win-streak behaviour)
# ---------------------------------------------------------------------------


def test_consecutive_losses_nan_gap_breaks_streak():
    """SF-M3: [-0.01, NaN, -0.01, -0.01] → documents streak behavior.

    NaN maps to 0 in is_negative, so a NaN gap day creates a group boundary
    (same as a flat day). The run [-0.01, NaN, -0.01, -0.01] becomes two
    groups: {0: 1-day loss} and {2-3: 2-day loss} → consecutive_losses=2.
    This is intentional: NaN gaps break streaks (consistent with win-streak
    treatment). The old code counted NaN as a loss (consecutive_losses=4).
    """
    dates = pd.bdate_range("2024-01-01", periods=4)
    returns = pd.Series([-0.01, float("nan"), -0.01, -0.01], index=dates)
    result = compute_all_metrics(returns)
    mj = result["metrics_json"]
    # Group 1 = day 0 (sum=1); gap NaN makes day 1 a new group; group 2+3 (sum=2)
    assert mj["consecutive_losses"] == 2, (
        f"consecutive_losses={mj['consecutive_losses']}; expected 2 — "
        "NaN gap day breaks streak into max-2-day run (SF-M3; old code returned 4)"
    )


# ---------------------------------------------------------------------------
# CR-I3 (code-review): all-NaN monthly window must NOT produce phantom 0.0
# ---------------------------------------------------------------------------


def test_monthly_rets_all_nan_window_not_phantom_zero():
    """CR-I3: a month where every value is NaN (gap days, no real trades)
    must be dropped from monthly_rets, not appear as phantom 0.0.

    (1+NaN).prod() returns 1.0 in pandas — prod() treats NaN as 1 in its
    accumulation. The len(x) > 0 guard (NEW-C02-04) is insufficient because
    len includes NaN-indexed rows. The x.notna().any() guard drops these.
    """
    import services.metrics as metrics_module
    # Jan has real returns; Feb is entirely NaN (gap month); Mar has real returns
    jan_dates = pd.bdate_range("2024-01-15", periods=3)
    mar_dates = pd.bdate_range("2024-03-15", periods=3)
    # NaN entries for Feb — using a DatetimeIndex with NaN-valued series
    feb_dates = pd.bdate_range("2024-02-12", periods=2)
    all_dates = jan_dates.tolist() + feb_dates.tolist() + mar_dates.tolist()
    values = [0.005, 0.005, 0.005, float("nan"), float("nan"), 0.005, 0.005, 0.005]
    returns = pd.Series(values, index=pd.DatetimeIndex(all_dates))

    monthly_rets = (
        returns.resample("ME")
        .apply(lambda x: (1 + x).prod() - 1 if x.notna().any() else float("nan"))
        .dropna()
    )
    # Only Jan and Mar should survive; Feb (all-NaN) must be dropped
    assert len(monthly_rets) == 2, (
        f"Expected 2 real months (Jan+Mar), got {len(monthly_rets)} — "
        "all-NaN month produced phantom entry (CR-I3 regression)"
    )


# --- Phase 73 (TWR-05): Calmar derives from the calendar-CAGR, not qs.stats.calmar
def test_calmar_uses_calendar_cagr():
    """TWR-05: Calmar == calendar-CAGR / |max_drawdown|, computed directly.

    Proves two things on a dense 365-calendar-day series (where the calendar
    clock 365/elapsed diverges from the len/252 clock): (1) the emitted Calmar
    equals the emitted CAGR divided by |max_drawdown| to fp tolerance, so the
    two headline numbers share ONE basis; and (2) it does NOT equal
    ``qs.stats.calmar(returns, periods=252)`` — proving the quantstats helper
    (which recomputes its CAGR leg at len/252) is no longer the source.
    """
    idx = pd.date_range("2024-01-01", periods=365, freq="D")
    rng = np.random.default_rng(7)
    r = pd.Series(rng.normal(0.0004, 0.012, size=365), index=idx, name="returns")

    mj = compute_all_metrics(r).metrics_json
    cagr = mj["cagr"]
    calmar = mj["calmar"]
    max_dd = mj["max_drawdown"]

    # Guard: the proof is only meaningful when there IS a drawdown and a CAGR.
    assert max_dd is not None and max_dd < 0, "fixture must have a real drawdown"
    assert cagr is not None, "fixture must have a computable CAGR"

    # 1) Calmar shares the calendar-CAGR basis: calmar == cagr / |max_dd|.
    assert calmar == pytest.approx(cagr / abs(max_dd), rel=1e-9), (
        "Calmar is not CAGR / |max_drawdown| — the two headline numbers have "
        "diverged from a shared basis"
    )

    # 2) It is NOT quantstats calmar at 252 (whose CAGR leg is len/252). On this
    #    dense 365-row series the two clocks differ, so a surviving qs.stats.calmar
    #    call would produce a materially different number.
    qs_calmar_252 = float(qs.stats.calmar(r, periods=252))
    assert calmar != pytest.approx(qs_calmar_252, rel=1e-6), (
        "Calmar matched qs.stats.calmar(returns, periods=252) — the quantstats "
        "helper is still the source instead of the calendar-CAGR"
    )


class TestFixAConventions:
    """Fix A (v1.8): the three metrics conventions threaded into compute_all_metrics
    (periods_per_year / cumulative_method / day_basis). The geometric+calendar+252
    defaults MUST stay byte-identical; only the simple/active/365 branches change."""

    @staticmethod
    def _series(vals: list[float], start: str = "2025-01-01") -> pd.Series:
        idx = pd.date_range(start, periods=len(vals), freq="D")
        return pd.Series(vals, index=idx, dtype=float)

    def test_defaults_byte_identical_to_explicit_geometric_calendar_252(self) -> None:
        """The new params default to the pre-Fix-A behaviour — an explicit
        geometric/calendar/252 call is the SAME object as the bare default call."""
        r = self._series([0.01, -0.005, 0.02, -0.01, 0.015] * 12)
        bare = compute_all_metrics(r).metrics_json
        explicit = compute_all_metrics(
            r, periods_per_year=252, cumulative_method="geometric",
            day_basis="calendar",
        ).metrics_json
        for k in ("cumulative_return", "cagr", "sharpe", "sortino", "volatility",
                  "max_drawdown", "calmar"):
            assert bare[k] == pytest.approx(explicit[k]), k

    def test_periods_per_year_365_rescales_sharpe_by_sqrt_ratio(self) -> None:
        """Crypto √365: Sharpe/vol scale by √(365/252) vs the 252 default (return
        metrics — cumulative/CAGR — are invariant to the risk clock)."""
        r = self._series([0.01, -0.005] * 40)
        m252 = compute_all_metrics(r, periods_per_year=252).metrics_json
        m365 = compute_all_metrics(r, periods_per_year=365).metrics_json
        assert m365["sharpe"] / m252["sharpe"] == pytest.approx(
            math.sqrt(365.0 / 252.0), rel=1e-9
        )
        assert m365["volatility"] / m252["volatility"] == pytest.approx(
            math.sqrt(365.0 / 252.0), rel=1e-9
        )
        assert m365["cumulative_return"] == pytest.approx(m252["cumulative_return"])

    def test_simple_cumulative_is_arithmetic_sum_and_maxdd_on_running_sum(self) -> None:
        """cumulative_method='simple': cumulative_return = Σr (NOT the geometric
        compound) and max_drawdown rides the running-SUM series."""
        r = self._series([0.10, -0.05, 0.20])
        simple = compute_all_metrics(r, cumulative_method="simple").metrics_json
        geom = compute_all_metrics(r, cumulative_method="geometric").metrics_json
        # Σ = 0.10 - 0.05 + 0.20 = 0.25 (arithmetic).
        assert simple["cumulative_return"] == pytest.approx(0.25)
        # Geometric compound = 1.1·0.95·1.2 − 1 = 0.254 — DISTINCT.
        assert geom["cumulative_return"] == pytest.approx(1.1 * 0.95 * 1.2 - 1.0)
        assert simple["cumulative_return"] != pytest.approx(geom["cumulative_return"])
        # Running-sum underwater: cumsum [.10,.05,.25], peak [.10,.10,.25] →
        # drawdown [0,-.05,0] → maxDD -0.05.
        assert simple["max_drawdown"] == pytest.approx(-0.05)

    def test_active_day_basis_drops_zero_days_from_risk_stats(self) -> None:
        """day_basis='active': volatility/Sharpe/Sortino are computed on the nonzero
        days only (a 0.0 no-activity day would dilute mean & std)."""
        r = self._series([0.01, 0.0, 0.02, 0.0, 0.015, 0.0, 0.008, 0.0])
        active = r[r != 0.0]
        m_cal = compute_all_metrics(
            r, day_basis="calendar", periods_per_year=365
        ).metrics_json
        m_act = compute_all_metrics(
            r, day_basis="active", periods_per_year=365
        ).metrics_json
        # Active Sharpe is wired to the nonzero-day series (qs formula parity).
        assert m_act["sharpe"] == pytest.approx(
            float(qs.stats.sharpe(active, periods=365))
        )
        # And it genuinely differs from the calendar (zero-diluted) Sharpe.
        assert m_act["sharpe"] != pytest.approx(m_cal["sharpe"], rel=1e-6)

    def test_invalid_conventions_fail_loud(self) -> None:
        r = self._series([0.01, -0.005, 0.02])
        with pytest.raises(ValueError, match="cumulative_method"):
            compute_all_metrics(r, cumulative_method="bogus")
        with pytest.raises(ValueError, match="day_basis"):
            compute_all_metrics(r, day_basis="bogus")

    # ---- Finding 2: single-convention period panels ----------------------

    def test_simple_monthly_grid_sums_to_cumulative_return(self) -> None:
        """Finding 2: on the simple/active convention the monthly grid cells SUM to
        the arithmetic cumulative_return headline (they are Σr per bucket, not a
        geometric compound). Pre-fix the grid stayed geometric → mixed-convention."""
        # ~2.5 months of dense daily returns spanning month boundaries.
        vals = ([0.01, -0.006, 0.008, 0.012, -0.004] * 15)
        idx = pd.date_range("2025-01-01", periods=len(vals), freq="D")
        r = pd.Series(vals, index=idx, dtype=float)
        res = compute_all_metrics(
            r, periods_per_year=365, cumulative_method="simple", day_basis="active"
        )
        m = res.metrics_json
        # Sum every monthly grid cell across all year/month buckets.
        grid = res.metrics_json["monthly_returns"]  # {year: {month: pct}}
        grid_sum = sum(v for months in grid.values() for v in months.values())
        assert grid_sum == pytest.approx(m["cumulative_return"], abs=1e-9)
        # And the headline itself is the arithmetic Σr (sanity anchor).
        assert m["cumulative_return"] == pytest.approx(float(r.sum()), abs=1e-9)

    def test_active_rolling_sharpe_full_window_converges_to_headline(self) -> None:
        """Finding 2: on the active basis the rolling Sharpe rides the nonzero-day
        series, so a full-window (window == #active days) rolling value converges to
        the headline Sharpe. Pre-fix it rode the zero-diluted dense series and
        diverged. Companion: the calendar basis stays zero-diluted (differs)."""
        # 30 nonzero days followed by 30 zero (no-activity) days → 60 dense days.
        vals = [0.01, -0.006, 0.013, -0.004, 0.009, -0.011] * 5 + [0.0] * 30
        idx = pd.date_range("2025-01-01", periods=len(vals), freq="D")
        r = pd.Series(vals, index=idx, dtype=float)
        res_act = compute_all_metrics(
            r, periods_per_year=365, cumulative_method="simple", day_basis="active"
        )
        m_act = res_act.metrics_json
        # The 30d rolling on the active basis has exactly 30 nonzero points → its
        # single full-window value is the whole-active-series Sharpe == headline.
        roll30 = res_act.metrics_json["rolling_metrics"]["sharpe_30d"]
        assert len(roll30) == 1
        # The rolling series is stored rounded to 4 decimals, so compare at that
        # precision — the point is convergence, not bit-identity to the headline.
        assert roll30[-1]["value"] == pytest.approx(m_act["sharpe"], abs=1e-3)
        # Calendar basis: the 30d rolling includes the 0.0 tail → many diluted
        # points, none equal to the (different) calendar headline.
        res_cal = compute_all_metrics(
            r, periods_per_year=365, cumulative_method="simple", day_basis="calendar"
        )
        assert len(res_cal.metrics_json["rolling_metrics"]["sharpe_30d"]) > 1

    def test_all_panels_byte_identical_geometric_calendar_252(self) -> None:
        """Finding 2 byte-identity: the FULL metrics_json + monthly grid + rolling
        series are IDENTICAL between the bare default call and an explicit
        geometric/calendar/252 call — the single-convention gating must not perturb
        ANY panel on the default path."""
        vals = ([0.012, -0.007, 0.02, -0.011, 0.014, 0.003] * 30)
        idx = pd.date_range("2024-01-01", periods=len(vals), freq="D")
        r = pd.Series(vals, index=idx, dtype=float)
        bare = compute_all_metrics(r)
        explicit = compute_all_metrics(
            r, periods_per_year=252, cumulative_method="geometric",
            day_basis="calendar",
        )
        # The ENTIRE outer dict (top-level scalars + nested metrics_json sub-dict
        # holding mtd/ytd/3m/best_month/var_1m_99 + monthly_returns + rolling_metrics
        # + all series) must be byte-equal on the default geometric/calendar path.
        assert bare.metrics_json == explicit.metrics_json

    def test_simple_active_combo_cagr_calmar_hand_computed(self) -> None:
        """T3: the LIVE Zavara combo (simple + active + 365) — never covered by the
        separate simple/calendar + geometric/active tests. Hand-assert that
        cumulative==Σr, CAGR==mean(nonzero)*365 (arithmetic annualization on the
        ACTIVE basis), maxDD rides the running-sum, and calmar==cagr/|maxDD|."""
        vals = [0.02, 0.0, -0.01, 0.0, 0.03, 0.0]  # zeros interspersed
        r = self._series(vals)
        m = compute_all_metrics(
            r, periods_per_year=365, cumulative_method="simple", day_basis="active",
        ).metrics_json
        # cumulative = arithmetic Σr.
        assert m["cumulative_return"] == pytest.approx(0.04)
        # CAGR = mean of the NONZERO (active) days × 365.
        active_mean = (0.02 - 0.01 + 0.03) / 3.0
        assert m["cagr"] == pytest.approx(active_mean * 365.0)
        # maxDD on running-sum: cumsum [.02,.02,.01,.01,.04,.04], peak .02 then .04 →
        # drawdown min = -0.01.
        assert m["max_drawdown"] == pytest.approx(-0.01)
        # calmar = cagr / |maxDD|, sharing the arithmetic-CAGR basis.
        assert m["calmar"] == pytest.approx((active_mean * 365.0) / 0.01)

    def test_f2_simple_maxdd_seeds_peak_at_inception_zero(self) -> None:
        """F2: the simple-branch maxDD seeds the running high-water at 0.0 (the
        from-INCEPTION baseline), so a deepest-at-day-1 track shows underwater, not
        0.0. [-0.02, +0.01, +0.03] → cumsum [-.02,-.01,.02], peak-0 → underwater
        [-.02,-.01,0] → maxDD = -0.02.

        Mutation-honest: the pre-F2 peak-first seed (`cumsum.cummax()` without the
        `.clip(lower=0.0)`) makes the peak track day-1's own -0.02, giving underwater
        [0,0,0] → maxDD 0.0 → this reddens. The GEOMETRIC branch is INTENTIONALLY
        unchanged (quantstats path) — pinned separately by the byte-identity test."""
        r = self._series([-0.02, 0.01, 0.03])
        simple = compute_all_metrics(
            r, periods_per_year=365, cumulative_method="simple", day_basis="active",
        ).metrics_json
        assert simple["max_drawdown"] == pytest.approx(-0.02)
        # The GEOMETRIC branch is INTENTIONALLY unchanged. It ALREADY reports the
        # from-inception drawdown (quantstats seeds equity at 1.0 = the peak-0
        # equivalent), so on this fixture it too is -0.02 — the F2 fix makes the
        # simple branch AGREE with the geometric branch's already-correct baseline
        # (not diverge from it). Its computation path is untouched (byte-identity
        # test pins that).
        geom = compute_all_metrics(r, cumulative_method="geometric").metrics_json
        assert geom["max_drawdown"] == pytest.approx(-0.02)

    def test_simple_path_interior_nan_fails_loud(self) -> None:
        """Finding 3: the simple arithmetic cumulative has no chain-break machinery,
        so an interior NaN would silently bridge disjoint segments. Fail loud
        instead (the allocated path must gap-fill dense with 0.0 first)."""
        vals = [0.01, -0.005, float("nan"), 0.02, 0.01]
        idx = pd.date_range("2025-03-01", periods=len(vals), freq="D")
        r = pd.Series(vals, index=idx, dtype=float)
        with pytest.raises(ValueError, match="interior NaN"):
            compute_all_metrics(r, cumulative_method="simple")
        # The geometric path tolerates it (honours the break via segmentation).
        compute_all_metrics(r, cumulative_method="geometric")  # no raise


class TestPeriodsPerYearForAssetClass:
    """#597: annualization basis resolves off strategies.asset_class."""

    def test_crypto_is_365(self) -> None:
        from services.metrics import periods_per_year_for_asset_class
        assert periods_per_year_for_asset_class("crypto") == 365

    def test_traditional_is_252(self) -> None:
        from services.metrics import periods_per_year_for_asset_class
        assert periods_per_year_for_asset_class("traditional") == 252

    def test_none_and_unknown_fall_back_to_252(self) -> None:
        # Conservative default — the DB CHECK constrains the domain, so this only
        # guards a None read (e.g. an old schema without the column).
        from services.metrics import periods_per_year_for_asset_class
        assert periods_per_year_for_asset_class(None) == 252
        assert periods_per_year_for_asset_class("equities") == 252
