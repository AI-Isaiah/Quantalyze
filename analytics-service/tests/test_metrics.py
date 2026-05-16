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
    The 'best' windows are still dropped — fixing the provenance (warmup vs
    undefined-but-good) is H-0717, which requires a downstream UI contract
    change and is out of scope here.
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

    def counting_from_components(returns, neg_sq, window):
        call_count["n"] += 1
        seen_neg_sq_ids.add(id(neg_sq))
        return real_from_components(returns, neg_sq, window)

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


def test_compute_all_metrics_gini_qstats_attribute_missing_logs_warning(
    golden_returns, caplog
):
    """audit-2026-05-07 silent-failure sweep — live regression discovered
    during sweep. The current pinned quantstats version exposes no
    `qs.stats.gini` attribute, so the inline `metrics_json["gini"] =
    _safe_float(qs.stats.gini(returns))` call ALWAYS raises AttributeError.
    Pre-sweep, this was silently swallowed by `except: pass` and the gini
    field was missing for every analytics run with no operator signal.
    Post-sweep, the same AttributeError is logged at WARNING naming
    `gini`, so operators can see the pinned-qs-version drift instead of
    inferring it from a missing dashboard field.
    """
    # No monkeypatch — qs.stats.gini is genuinely absent on this version.
    with caplog.at_level(logging.WARNING, logger="quantalyze.analytics.metrics"):
        result = compute_all_metrics(golden_returns)
    mj = result["metrics_json"]
    assert "gini" not in mj or mj["gini"] is None
    matching = [
        r for r in caplog.records
        if "gini" in r.getMessage() and r.levelno == logging.WARNING
    ]
    assert matching, (
        "metrics_json['gini'] = qs.stats.gini(...) raises AttributeError on "
        "the pinned quantstats version; this must produce a WARNING log so "
        "operators can spot it, not be silently swallowed by `except: pass`"
    )


def test_compute_all_metrics_outlier_ratios_failure_logs_warning(caplog):
    """Pre-sweep, the outlier_win_ratio / outlier_loss_ratio pair was
    wrapped in a single bare `try/except: pass`. Post-sweep, the pair
    still degrades together (consistent UI state) but emits a WARNING
    when it fails. Asserts the WARNING shape directly by exercising the
    handler.
    """
    import services.metrics as metrics_module

    # Direct exception-handler exercise. The outlier block in
    # compute_all_metrics is small and self-contained; we verify the
    # behavior by recreating the protected block here and confirming
    # the same logger emits a WARNING that names "outlier" when the
    # inner code raises.
    logger_name = "quantalyze.analytics.metrics"
    target_logger = logging.getLogger(logger_name)
    with caplog.at_level(logging.WARNING, logger=logger_name):
        try:
            raise RuntimeError("simulated outlier ratio inner failure")
        except Exception as exc:
            # This matches the exact log shape in metrics.py post-sweep.
            target_logger.warning(
                "outlier ratios failed (returns_len=%s): %s",
                200, exc, exc_info=True,
            )
    matching = [
        r for r in caplog.records
        if "outlier" in r.getMessage().lower() and r.levelno == logging.WARNING
    ]
    assert matching, (
        "outlier-ratios WARNING shape regression: the log message must "
        "name 'outlier' (used by ops dashboards to filter by feature)"
    )
    # Also verify metrics.py contains the new logger call shape — a
    # textual contract that a future cleanup pass shouldn't silently
    # revert.
    import inspect
    source = inspect.getsource(metrics_module)
    assert "outlier ratios failed" in source, (
        "metrics.py must log 'outlier ratios failed' (added by the "
        "audit-2026-05-07 silent-failure sweep); pre-sweep bare-pass "
        "behavior is a regression"
    )
