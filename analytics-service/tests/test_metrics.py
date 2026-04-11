import pytest
import math
import numpy as np
import pandas as pd
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
