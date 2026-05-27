import logging
import quantstats as qs
import pandas as pd
import numpy as np
import math
from dataclasses import dataclass, field
from typing import Any, Literal, TypedDict

from .transforms import downsample_series, cap_data_points

logger = logging.getLogger("quantalyze.analytics.metrics")


# PR #181 take-2 red-team F16: when a fundamental qs.stats shape regression
# trips multiple scalars at once (e.g., a future qs upgrade returns Series
# instead of float), all 11 inline WARNINGs at compute_all_metrics fire with
# `exc_info=True`, each emitting a full traceback. Per-strategy that's
# ~150-300 log lines; at fleet scale (~1000 strategies daily) that burns
# Railway's bytes-budgeted retention in hours, evicting unrelated history.
# Process-level dedupe: emit the full traceback (exc_info=True) on the FIRST
# (scalar_name, exc_type) tuple seen, and a single-line WARNING without
# traceback for all subsequent occurrences. The signal-bearing line is
# preserved; retention impact is bounded by O(unique scalar x exc-type)
# instead of O(call count).
_FAIL_LOUD_TRACEBACK_EMITTED: set[tuple[str, str]] = set()


def _should_emit_traceback(scalar_name: str, exc: BaseException) -> bool:
    """Process-level dedupe for fail-loud tracebacks.

    Returns True the first time we see a `(scalar_name, exc-type-name)` tuple
    in this process, False thereafter. The WARNING message (with scalar_name,
    returns_len, str(exc)) is always emitted; only the traceback attachment
    is rate-limited.
    """
    key = (scalar_name, type(exc).__name__)
    if key in _FAIL_LOUD_TRACEBACK_EMITTED:
        return False
    _FAIL_LOUD_TRACEBACK_EMITTED.add(key)
    return True


def _reset_fail_loud_traceback_dedupe_for_tests() -> None:
    """Test-only helper — clear the per-process traceback-emitted set.

    Called by test fixtures to reset state between tests so the
    'first occurrence emits traceback' contract is reliably exercised.
    """
    _FAIL_LOUD_TRACEBACK_EMITTED.clear()


# Audit 2026-05-07 H-0730: every series helper in this file returns the same
# concrete shape {date: str, value: float} but typed it as
# `list[dict[str, Any]]`, erasing the contract. TS consumers
# (HeadlineMetricsPanel / ReturnsDistributionPanel) type the same shape
# explicitly. Mirroring it here with a TypedDict means a renamed key (`val`
# instead of `value`) would surface at type-check time instead of as runtime
# NaN on the React side — the same drift class that produced the v0.17.1
# KPI-17 column saga.
class SeriesPoint(TypedDict):
    date: str
    value: float


# PR #181 take-2 type-design F8/F9: discriminator type for r_squared
# computation outcome. Pre-take2 the field was typed as plain `str`,
# which would silently accept typos like 'No Benchmark' or 'unknown'
# at any of the three assignment sites. Narrowing to a Literal pins
# the enum at type-check time and lets downstream consumers exhaust
# the alternatives with mypy/pyright's narrowing.
RSquaredStatus = Literal["no_benchmark", "ok", "error"]


class QstatsScalarsResult(TypedDict):
    """Return shape for `compute_qstats_scalars`.

    PR #181 take-2 type-design F8/F9: pre-take2 the function returned
    `dict[str, float | None | str]` — every consumer had to defensively
    isinstance-narrow `str` even though only one key (`r_squared_status`)
    carries the `str` branch. The TypedDict pins per-field types so the
    type checker catches future drift instead of relying on a comment
    block listing the 10 valid output keys.
    """

    recovery_factor: float | None
    ulcer_index: float | None
    upi: float | None
    kelly_criterion: float | None
    probabilistic_sharpe_ratio: float | None
    common_sense_ratio: float | None
    cpc_index: float | None
    serenity_index: float | None
    r_squared: float | None
    r_squared_status: RSquaredStatus
    time_in_market: float | None


# Phase 12 / Pitfall 11: minimum acceptable return for Sortino.
# Single source of truth: `qs.stats.sortino(returns)` (which uses MAR=0 by default)
# AND `_rolling_sortino` MUST share this constant. Cross-runtime parity is gated
# by the `test_rolling_sortino_converges_to_scalar_at_full_window` test, which
# asserts the rolling helper at window == period agrees with the scalar to within 0.05.
MAR: float = 0.0

# H-0728: Catastrophic-loss floor. `np.log1p(r)` is NaN for r <= -1
# (a 100%+ loss day — liquidation event, gap-down, leveraged blow-up).
# We clamp returns to (-1 + 1e-9) before log1p so the event surfaces as a
# very large negative log return rather than disappearing through
# `_finalize_rolling.dropna()`. `log1p(-1 + 1e-9) ≈ -20.72`.
_LOG_RETURN_FLOOR: float = -1.0 + 1e-9

# H-0710 / H-0713 / H-0723 dispatch table: (result_key, qs.stats attribute name).
# `r_squared` (needs benchmark) and `time_in_market` (not a qs call) are handled
# inline since their shapes differ from the single-arg pattern below.
_QSTATS_SINGLE_ARG_SCALARS: tuple[tuple[str, str], ...] = (
    ("recovery_factor", "recovery_factor"),
    ("ulcer_index", "ulcer_index"),
    ("upi", "ulcer_performance_index"),
    ("kelly_criterion", "kelly_criterion"),
    ("probabilistic_sharpe_ratio", "probabilistic_ratio"),
    ("common_sense_ratio", "common_sense_ratio"),
    ("cpc_index", "cpc_index"),
    ("serenity_index", "serenity_index"),
)


def _drop_nonfinite(series: pd.Series) -> pd.Series:
    """Single source of truth: drop NaN AND ±Inf rows. Used by every series
    helper that writes to JSONB (Postgres rejects NaN — H-0715/H-0720 class).
    """
    return series.replace([np.inf, -np.inf], np.nan).dropna()


def _format_series_points(
    series: pd.Series, decimals: int
) -> list[SeriesPoint]:
    """Vectorized {date, value} dict construction. Replaces the per-row
    `d.strftime + round(float(v), n)` comprehension hot-path.

    Uses Python's `round(float, n)` (not `Series.round`) because the two use
    different rounding strategies on binary floats — Series.round uses NumPy
    half-to-even on the IEEE representation; Python round uses float-aware
    decimal rounding. Matching the pre-helper contract keeps stored JSONB
    values byte-stable across the refactor.
    """
    if len(series) == 0:
        return []
    if not isinstance(series.index, pd.DatetimeIndex):
        raise TypeError(
            f"_format_series_points requires a DatetimeIndex; got {type(series.index).__name__}"
        )
    dates = series.index.strftime("%Y-%m-%d").tolist()
    values = [round(float(v), decimals) for v in series.tolist()]
    return [{"date": d, "value": v} for d, v in zip(dates, values, strict=True)]


def _safe_qstats_scalar(
    name: str,
    fn: Any,
    returns: pd.Series,
    returns_len: int | None,
) -> float | None:
    """Run a single-arg qs.stats scalar, returning None and logging on failure.

    Failure-soft contract (H-0710 / H-0713 / H-0723): one failing scalar must
    not take down the other nine. Logs include the scalar `name` so operators
    can spot silent regressions in Railway logs without inferring from latency.

    PR #181 take-2 red-team F16: traceback attachment is process-deduped via
    `_should_emit_traceback` so a fundamental qs upgrade tripping multiple
    scalars doesn't multiply Railway retention pressure linearly with call
    volume. First occurrence per (scalar_name, exc-type) pair emits
    exc_info=True; subsequent occurrences emit the WARNING text without
    traceback. Operators still get the full first-incident traceback.
    """
    try:
        return _safe_float(fn(returns))
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "qstats scalar %s failed (returns_len=%s): %s",
            name, returns_len, exc,
            exc_info=_should_emit_traceback(name, exc),
        )
        return None


@dataclass
class MetricsResult:
    """Phase 12 / METRICS-11/12: split storage between strategy_analytics.metrics_json
    (light scalars + above-the-fold series) and strategy_analytics_series sibling table
    (heavy series keyed by kind). See D-01 / D-02 for split rules.

    Attributes
    ----------
    metrics_json: top-level dict spread into the strategy_analytics table upsert.
        Contains all existing qstats scalars + 10 new qstats scalars (merged into
        its inner "metrics_json" JSONB sub-dict) + above-the-fold series
        (returns_series, drawdown_series, sparklines, monthly_returns,
        rolling_metrics, return_quantiles).
    sibling_kinds: dict keyed by sibling-table `kind`. analytics_runner upserts
        each kind into strategy_analytics_series via the
        `upsert_strategy_analytics_series_batch` SECURITY DEFINER RPC (M-Grok-1
        atomic batch). 12 kinds total — 10 produced here in compute_all_metrics
        (daily_returns_grid, rolling_sortino_3m/6m/12m, rolling_volatility_3m/6m/12m,
        rolling_alpha, rolling_beta, log_returns_series); the runner adds 2 more
        (exposure_series, turnover_series) since they need position_snapshots data.

    `__getitem__` proxies to `metrics_json` for backward compat with existing
    test sites that subscripted the old bare-dict return shape (test_metrics.py,
    test_accuracy.py). New consumers should use attribute access directly.
    """

    metrics_json: dict[str, Any] = field(default_factory=dict)
    sibling_kinds: dict[str, Any] = field(default_factory=dict)

    def __getitem__(self, key: str) -> Any:
        # Backward-compat shim: old callers expected a bare dict; proxy
        # subscript access to metrics_json so legacy tests still work.
        #
        # Audit 2026-05-07 H-0727: `__getitem__` proxies to `metrics_json`
        # ONLY — sibling_kinds is invisible under subscript by design (split
        # storage per D-01/D-02). A refactor that mechanically replaces
        # `result.sibling_kinds[kind]` with `result[kind]` "looks fine" in
        # review but silently KeyErrors in production for every sibling kind.
        # We detect the most likely misuse pattern explicitly so operators
        # see a descriptive error pointing to `.sibling_kinds[...]`.
        if key not in self.metrics_json and key in self.sibling_kinds:
            raise KeyError(
                f"MetricsResult subscript does NOT proxy sibling_kinds; "
                f"use `result.sibling_kinds[{key!r}]` for split-storage kinds "
                f"(D-01/D-02). See metrics.py:MetricsResult docstring."
            )
        return self.metrics_json[key]

    def __contains__(self, key: str) -> bool:
        return key in self.metrics_json

    def get(self, key: str, default: Any = None) -> Any:
        return self.metrics_json.get(key, default)

    def items(self):
        return self.metrics_json.items()

    def keys(self):
        return self.metrics_json.keys()

    def values(self):
        return self.metrics_json.values()


def _safe_float(value: Any) -> float | None:
    """Convert to float, returning None for NaN/Inf values.

    review-cluster gate (audit-2026-05-07): emit DEBUG when coercion fails or
    produces NaN/Inf. This helper is called by every qs.stats wrapper in
    compute_all_metrics — if qs.stats returns a numpy.complex128, NaN, or
    a type that fails float() coercion (Decimal, an array-of-1, etc.), the
    scalar silently becomes None and the outer try/except never fires.
    Pre-gate, this was a doubly-silent failure mode the sweep's WARNINGs
    did NOT cover. DEBUG (not WARNING) because this helper is also called
    from sanitize_metrics for legitimate None paths and from many code
    sites where missing values are normal; promoting to WARNING would
    flood Railway with normal-path noise. An operator grepping DEBUG
    output for `_safe_float` will see the coercion trail without
    background spam.

    PR #181 take-2 silent-failure-hunter F18: short-circuit on None
    BEFORE the try/except + DEBUG log. None is a legitimate normal-path
    input from sanitize_metrics' recursive walk AND from many qs.stats
    return values (insufficient data windows). Routing None through the
    try/except produced a DEBUG line `_safe_float coerce failed
    (type=NoneType)` per call — sanitize_metrics walks a full payload of
    ~10K floats, several legitimately None, generating tens of DEBUG
    lines per analytics run. The DEBUG noise floor defeats operators who
    flip LOG_LEVEL=DEBUG to triage a real coercion issue (numpy.complex128,
    Decimal, etc.) — they drown in the legitimate-None signal. Reserve
    DEBUG for actual coercion failures.
    """
    if value is None:
        return None
    try:
        f = float(value)
        if math.isnan(f) or math.isinf(f):
            logger.debug(
                "_safe_float coerced to None (NaN/Inf detected, type=%s)",
                type(value).__name__,
            )
            return None
        return f
    except (TypeError, ValueError) as exc:
        logger.debug(
            "_safe_float coerce failed (type=%s): %s",
            type(value).__name__, exc,
        )
        return None


def sanitize_metrics(data: dict[str, Any]) -> dict[str, Any]:
    """Replace NaN/Inf with None in all numeric values before Supabase upsert."""
    result = {}
    for key, value in data.items():
        if isinstance(value, float):
            result[key] = _safe_float(value)
        elif isinstance(value, dict):
            result[key] = sanitize_metrics(value)
        elif isinstance(value, list):
            result[key] = [
                sanitize_metrics(item) if isinstance(item, dict)
                else _safe_float(item) if isinstance(item, (int, float)) and not isinstance(item, bool)
                else item
                for item in value
            ]
        else:
            result[key] = value
    return result


def compute_all_metrics(
    returns: pd.Series,
    benchmark_returns: pd.Series | None = None,
) -> MetricsResult:  # H-0729: in-module class, no forward-ref needed.
    """Compute all analytics from a daily returns series.

    Phase 12: returns a `MetricsResult` dataclass (NOT a bare dict) split per D-01/D-02:

    - `result.metrics_json`: spread into the `strategy_analytics` table upsert.
      Carries all existing qstats scalars (top-level cumulative_return, cagr, sharpe, ...)
      + 10 new qstats scalars (merged into the inner `metrics_json` JSONB sub-dict
      via `compute_qstats_scalars`).
    - `result.sibling_kinds`: dict {kind: payload} for the 10 sibling kinds emitted
      from this function (daily_returns_grid, rolling_sortino_3m/6m/12m,
      rolling_volatility_3m/6m/12m, rolling_alpha, rolling_beta, log_returns_series).
      analytics_runner appends 2 more (exposure_series, turnover_series) before the
      atomic batch upsert via `upsert_strategy_analytics_series_batch` RPC.

    Backward-compat: `MetricsResult.__getitem__` proxies to `.metrics_json` so
    legacy `result["sharpe"]` access still works for tests that have not yet
    been migrated to attribute access.
    """
    if len(returns) < 2:
        raise ValueError("Insufficient trade history. At least 2 trading days required.")

    # Audit 2026-05-07 M-0693: fail-loud input-shape precondition (Rule 12).
    # The body below assumes a DatetimeIndex (returns.index[-1].replace(day=1),
    # .year, d.strftime in _daily_returns_grid_from_series / _format_series_points)
    # and a float dtype (np.log1p in _log_returns_series, the resample/quantile
    # paths). A plain RangeIndex or an int-dtype series previously failed DEEP
    # inside a helper (TypeError swallowed by a per-scalar try/except, or silent
    # truncation in np.log1p) — producing wrong output or a misattributed
    # Railway log instead of a clear contract violation at the boundary. Check
    # both at the top so the caller sees exactly which precondition was broken.
    if not isinstance(returns.index, pd.DatetimeIndex):
        raise TypeError(
            "compute_all_metrics requires a DatetimeIndex on `returns`; got "
            f"{type(returns.index).__name__}. The metrics pipeline indexes by "
            "calendar date (mtd/ytd slices, monthly resample, per-date series)."
        )
    if not pd.api.types.is_float_dtype(returns):
        raise TypeError(
            "compute_all_metrics requires a float-dtype `returns` series; got "
            f"dtype={returns.dtype}. Integer/object dtypes silently truncate in "
            "np.log1p and the cumprod equity path — convert with "
            "`returns.astype('float64')` at the ingestion boundary."
        )
    # F3 (red-team MED8): the body assumes the index is ASCENDING by date.
    # mtd/ytd window construction reads `returns.index[-1]` as "most recent",
    # and `tail(126)`/`tail(63)` (six_month/three_month) assume the LAST rows
    # are the most recent. A descending or shuffled DatetimeIndex would pass the
    # DatetimeIndex + float-dtype checks above yet silently produce wrong
    # windows (e.g. mtd computed from the OLDEST month, three_month from the
    # FIRST 63 days). Fail loud (Rule 12) so the caller fixes ordering at the
    # ingestion boundary rather than shipping a mislabeled factsheet.
    if not returns.index.is_monotonic_increasing:
        raise ValueError(
            "compute_all_metrics requires an ascending (monotonic-increasing) "
            "DatetimeIndex on `returns`; the index is not sorted oldest-to-newest. "
            "mtd/ytd slices and tail(126)/tail(63) windows assume the last rows "
            "are the most recent — sort with `returns.sort_index()` at the "
            "ingestion boundary."
        )

    # Red-team F3: NaN in `returns` propagates through `cumprod` so one upstream
    # gap day silently truncates the equity curve at the gap (post-NaN rows
    # drop out at serialization). For chart-feeding paths, treat NaN as a
    # 0-return day so equity carries forward. The unmodified `returns` is still
    # used for statistics (qs.stats.* handle NaN per their own contracts).
    nan_in_returns = int(returns.isna().sum())
    if nan_in_returns > 0:
        logger.warning(
            "compute_all_metrics: %d NaN day(s) in returns (returns_len=%d); "
            "chart paths use fillna(0), statistics keep NaN handling",
            nan_in_returns, len(returns),
        )
    # Red-team F6: an r <= -1 day produces non-positive equity after cumprod
    # (oscillating sign on subsequent multiplications). Surface upstream-data
    # corruption so operators can fix it at ingestion rather than chasing a
    # nonsensical equity chart.
    catastrophic_count = int((returns <= -1.0).sum())
    if catastrophic_count > 0:
        logger.warning(
            "compute_all_metrics: %d return(s) <= -1.0 (>=100%% loss day) in returns "
            "(returns_len=%d). Equity curve may show sign flips — check upstream CSV.",
            catastrophic_count, len(returns),
        )
    # F7 (red-team HIGH7): clamp the chart series' lower bound to _LOG_RETURN_FLOOR
    # (= -1 + 1e-9) BEFORE the cumprod equity and to_drawdown_series. The log-
    # returns chart already clamps in `_log_returns_series`, but the linear equity
    # `(1+returns_for_chart).cumprod()` and `to_drawdown_series` only WARN above —
    # an r <= -1 day produced a non-positive multiplier, giving a negative,
    # sign-oscillating equity curve and a drawdown below -100%. Clamping here makes
    # all three series (equity, drawdown, log-returns) treat a >=100%-loss day
    # consistently: equity stays non-negative and drawdown is bounded at -1.0.
    # No-op for normal data (every value > -1), so golden/parity fixtures are
    # unaffected.
    returns_for_chart = returns.fillna(0).clip(lower=_LOG_RETURN_FLOOR)

    # Core metrics (safe_float handles NaN/Inf from quantstats)
    # NEW-C02-05: cumulative_return scalar uses raw returns (NaN-dropped, same
    # as cagr/sharpe/sortino) so all headline KPIs share one NaN policy.
    # returns_for_chart (fillna(0)) is chart-only — it bridges gap days to keep
    # the equity curve continuous; the ranking scalar must not use it.
    cumulative = (1 + returns_for_chart).cumprod()
    total_return = _safe_float((1 + returns.dropna()).prod() - 1)
    cagr = _safe_float(qs.stats.cagr(returns))
    volatility = _safe_float(qs.stats.volatility(returns))
    sharpe = _safe_float(qs.stats.sharpe(returns))
    # Audit 2026-05-07 H-0725: pass `rf=MAR` explicitly so the scalar sortino
    # and `_rolling_sortino` share the SAME minimum acceptable return constant.
    # Relying on qs.stats.sortino's implicit `rf=0` default silently diverges
    # the moment MAR is ever tuned away from 0.
    sortino = _safe_float(qs.stats.sortino(returns, rf=MAR))
    calmar = _safe_float(qs.stats.calmar(returns))
    max_dd = _safe_float(qs.stats.max_drawdown(returns))

    # Drawdown series — chart continuity per F3 (same fillna(0) rationale).
    dd_series = qs.stats.to_drawdown_series(returns_for_chart)
    dd_duration = _max_dd_duration(dd_series)

    # Monthly returns (computed once, reused for grid + best/worst + VaR)
    # NEW-C02-04: filter empty calendar buckets (fabricated 0.0 from sparse
    # trade calendars). resample inserts one row per calendar period; empty
    # groups produce product() == 1 - 1 == 0.0, a phantom break-even month.
    # CR-I3 (review 2026-05-26): also guard all-NaN windows — (1+NaN).prod()
    # returns 1.0 in pandas (NaN treated as multiplicative identity), producing
    # a phantom 0.0 month for periods that consist entirely of NaN-gap days.
    # Use x.notna().any() so only months with at least one real return are kept.
    monthly_rets = (
        returns.resample("ME")
        .apply(lambda x: (1 + x).prod() - 1 if x.notna().any() else float("nan"))
        .dropna()
    )
    monthly = _monthly_returns_grid_from_series(monthly_rets)

    # Rolling metrics
    rolling = {
        "sharpe_30d": _rolling_sharpe(returns, 30),
        "sharpe_90d": _rolling_sharpe(returns, 90),
        "sharpe_365d": _rolling_sharpe(returns, 365),
    }

    # Return quantiles — pass pre-computed monthly_rets to avoid double resample (NEW-C02-11)
    quantiles = _return_quantiles(returns, monthly_rets=monthly_rets)

    # Equity curve + drawdown as time series.
    # H-0715 defense-in-depth: scrub NaN/Inf at the helper boundary, not just at
    # the sanitize_metrics tail — JSONB rejects NaN and one upstream gap day
    # propagates through `(1+returns).cumprod()` to every subsequent row.
    _cumulative_clean = _drop_nonfinite(cumulative)
    returns_series = [
        {"date": d.strftime("%Y-%m-%d"), "value": float(v)}
        for d, v in _cumulative_clean.items()
    ]
    _dd_clean = _drop_nonfinite(dd_series)
    drawdown_series = [
        {"date": d.strftime("%Y-%m-%d"), "value": float(v)}
        for d, v in _dd_clean.items()
    ]

    # Sparklines (downsampled)
    sparkline_returns = downsample_series(returns_series, 90)
    sparkline_drawdown = downsample_series(drawdown_series, 90)

    # Cap data points
    returns_series = cap_data_points(returns_series)
    drawdown_series = cap_data_points(drawdown_series)

    # Six month return
    six_month = _safe_float(returns.tail(126).add(1).prod() - 1) if len(returns) >= 126 else None

    # Extended metrics
    metrics_json: dict[str, Any] = {}
    # audit-2026-05-07 silent-failure sweep: each scalar try below previously
    # swallowed exceptions with bare `except: pass`. That collapsed three
    # operationally distinct states ("scalar computed", "scalar absent because
    # insufficient data", "qs raised — operator should know") into the single
    # "field missing" surface, with no Railway log to triage. Mirror the
    # H-0710 / H-0713 / H-0723 pattern already used by `_safe_qstats_scalar`
    # (above) and the post-G11.E.1 sites for drawdown/benchmark fan-outs:
    # log with scalar name + returns_len context so operators can spot
    # silent regressions instead of inferring from latency. Math is still
    # failure-soft (single qs failure must not take down compute_all_metrics);
    # only the observability changes.
    # PR #181 take-2 red-team F6: surface BOTH the raw input length and the
    # post-NaN-drop length qs.stats actually consumes. quantstats internally
    # filters NaN via `_utils._prepare_returns` before computing scalars; the
    # raw `len(returns)` value in WARNING templates misdirects operators who
    # try to reproduce the failure manually with the same length.
    returns_len_for_log = len(returns)
    returns_nonnan_len_for_log = int(returns.notna().sum())
    # fail-soft: optional scalar — single qs failure must not abort compute.
    # PR #181 take-2 red-team F2: prior call passed `cutoff=0.05`; the
    # pinned quantstats==0.0.81 signature uses `confidence=0.95` (NOT
    # `cutoff`). Pre-take2 every analytics run raised TypeError here and
    # var_1d_95 was missing from every factsheet; the sweep WARNINGs then
    # made the permanent failure a Railway noise floor that erodes the
    # signal value of the new fail-loud emissions.
    try:
        metrics_json["var_1d_95"] = _safe_float(
            qs.stats.value_at_risk(returns, confidence=0.95)
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "qstats scalar var_1d_95 failed (returns_len=%s, nonnan_len=%s): %s",
            returns_len_for_log, returns_nonnan_len_for_log, exc,
            exc_info=_should_emit_traceback("var_1d_95", exc),
        )
    # fail-soft: optional scalar.
    try:
        metrics_json["cvar"] = _safe_float(qs.stats.cvar(returns))
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "qstats scalar cvar failed (returns_len=%s, nonnan_len=%s): %s",
            returns_len_for_log, returns_nonnan_len_for_log, exc,
            exc_info=_should_emit_traceback("cvar", exc),
        )

    metrics_json["mtd"] = _safe_float(returns[returns.index >= pd.Timestamp(returns.index[-1].replace(day=1))].add(1).prod() - 1)
    metrics_json["ytd"] = _safe_float(returns[returns.index >= pd.Timestamp(f"{returns.index[-1].year}-01-01")].add(1).prod() - 1)
    metrics_json["best_day"] = _safe_float(returns.max())
    metrics_json["worst_day"] = _safe_float(returns.min())
    metrics_json["three_month"] = _safe_float(returns.tail(63).add(1).prod() - 1) if len(returns) >= 63 else None

    if len(monthly_rets) > 0:
        metrics_json["best_month"] = _safe_float(monthly_rets.max())
        metrics_json["worst_month"] = _safe_float(monthly_rets.min())

    # Additional risk metrics
    # fail-soft: optional scalar — monthly_rets percentile may raise on empty.
    try:
        if len(monthly_rets) > 0:
            metrics_json["var_1m_99"] = _safe_float(np.percentile(monthly_rets, 1))
    except Exception as exc:  # noqa: BLE001
        # review-cluster gate (audit-2026-05-07): log prefix is 'np.percentile'
        # not 'qstats scalar' — the underlying call is numpy, not qs.stats.
        # An operator grepping for the qs.stats source would dead-end on a
        # 'qstats scalar var_1m_99' line; accurate attribution lets them find
        # the right call site immediately.
        logger.warning(
            "np.percentile scalar var_1m_99 failed (returns_len=%s, nonnan_len=%s, monthly_len=%s): %s",
            returns_len_for_log, returns_nonnan_len_for_log, len(monthly_rets), exc,
            exc_info=_should_emit_traceback("var_1m_99", exc),
        )
    # PR #181 take-2 red-team F1: `qs.stats.gini` does not exist on the
    # pinned quantstats==0.0.81 (verified live: `hasattr(qs.stats, 'gini')
    # == False`). The sweep's WARNING wrapped this site but left the dead
    # call in place, producing one permanent Railway WARNING per analytics
    # run that operators cannot resolve. The gini metric has been missing
    # from every factsheet since the call was introduced; pre-sweep
    # bare-pass swallowed the AttributeError. Removing the dead call drops
    # the noise floor; if/when gini is needed it should be re-introduced
    # as either (a) a manual numpy/pandas implementation, or (b) after a
    # quantstats version bump that re-exposes the attribute.
    # fail-soft: optional scalar.
    try:
        metrics_json["omega"] = _safe_float(qs.stats.omega(returns))
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "qstats scalar omega failed (returns_len=%s, nonnan_len=%s): %s",
            returns_len_for_log, returns_nonnan_len_for_log, exc,
            exc_info=_should_emit_traceback("omega", exc),
        )
    # fail-soft: optional scalar.
    try:
        metrics_json["gain_pain"] = _safe_float(qs.stats.gain_to_pain_ratio(returns))
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "qstats scalar gain_pain failed (returns_len=%s, nonnan_len=%s): %s",
            returns_len_for_log, returns_nonnan_len_for_log, exc,
            exc_info=_should_emit_traceback("gain_pain", exc),
        )
    # fail-soft: optional scalar.
    try:
        metrics_json["tail_ratio"] = _safe_float(qs.stats.tail_ratio(returns))
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "qstats scalar tail_ratio failed (returns_len=%s, nonnan_len=%s): %s",
            returns_len_for_log, returns_nonnan_len_for_log, exc,
            exc_info=_should_emit_traceback("tail_ratio", exc),
        )

    # Distribution metrics
    # fail-soft: optional scalar (pandas Series.skew, not qs.stats).
    try:
        metrics_json["skewness"] = _safe_float(returns.skew())
    except Exception as exc:  # noqa: BLE001
        # review-cluster gate (audit-2026-05-07): log prefix is 'pandas'
        # not 'qstats scalar' — Series.skew is the call, not qs.stats.
        logger.warning(
            "pandas scalar skewness failed (returns_len=%s, nonnan_len=%s): %s",
            returns_len_for_log, returns_nonnan_len_for_log, exc,
            exc_info=_should_emit_traceback("skewness", exc),
        )
    # fail-soft: optional scalar (pandas Series.kurtosis, not qs.stats).
    try:
        metrics_json["kurtosis"] = _safe_float(returns.kurtosis())
    except Exception as exc:  # noqa: BLE001
        # review-cluster gate (audit-2026-05-07): log prefix is 'pandas'
        # not 'qstats scalar' — Series.kurtosis is the call, not qs.stats.
        logger.warning(
            "pandas scalar kurtosis failed (returns_len=%s, nonnan_len=%s): %s",
            returns_len_for_log, returns_nonnan_len_for_log, exc,
            exc_info=_should_emit_traceback("kurtosis", exc),
        )
    # fail-soft: optional scalar.
    try:
        metrics_json["smart_sharpe"] = _safe_float(qs.stats.smart_sharpe(returns))
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "qstats scalar smart_sharpe failed (returns_len=%s, nonnan_len=%s): %s",
            returns_len_for_log, returns_nonnan_len_for_log, exc,
            exc_info=_should_emit_traceback("smart_sharpe", exc),
        )
    # fail-soft: optional scalar.
    try:
        metrics_json["smart_sortino"] = _safe_float(qs.stats.smart_sortino(returns))
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "qstats scalar smart_sortino failed (returns_len=%s, nonnan_len=%s): %s",
            returns_len_for_log, returns_nonnan_len_for_log, exc,
            exc_info=_should_emit_traceback("smart_sortino", exc),
        )

    # Win/Loss metrics
    wins = returns[returns > 0]
    losses = returns[returns < 0]
    if len(wins) > 0:
        metrics_json["avg_win"] = _safe_float(wins.mean())
    if len(losses) > 0:
        metrics_json["avg_loss"] = _safe_float(losses.mean())
    if len(losses) > 0 and len(wins) > 0:
        metrics_json["win_loss_ratio"] = _safe_float(len(wins) / len(losses))
        avg_loss_abs = abs(float(losses.mean()))
        if avg_loss_abs > 0:
            metrics_json["payoff_ratio"] = _safe_float(wins.mean() / avg_loss_abs)
    # fail-soft: optional scalar.
    try:
        metrics_json["profit_factor"] = _safe_float(qs.stats.profit_factor(returns))
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "qstats scalar profit_factor failed (returns_len=%s, nonnan_len=%s): %s",
            returns_len_for_log, returns_nonnan_len_for_log, exc,
            exc_info=_should_emit_traceback("profit_factor", exc),
        )

    # Risk of Ruin (Cox-Miller approximation)
    if len(wins) > 0 and len(losses) > 0:
        total_trades = len(wins) + len(losses)
        wr = len(wins) / total_trades
        avg_loss_abs_rr = abs(float(losses.mean()))
        pr = float(wins.mean()) / avg_loss_abs_rr if avg_loss_abs_rr > 0 else 0.0
        avg_size = float(returns.abs().mean())
        if avg_size > 0:
            metrics_json["risk_of_ruin"] = compute_risk_of_ruin(wr, pr, avg_size)

    # Consecutive streaks
    # NEW-C02-03: `is_loss` uses strict `< 0` (mirrors `losses = returns[returns < 0]`
    # at the wins/losses split above). The prior `~is_positive` absorbed flat (0.0)
    # and NaN-gap days as losses, asymmetric with `consecutive_wins` (strict > 0).
    is_positive = (returns > 0).astype(int)
    is_negative = (returns < 0).astype(int)
    streaks = is_positive.groupby((is_positive != is_positive.shift()).cumsum())
    win_streaks = streaks.sum()
    loss_streaks = is_negative.groupby(
        (is_negative != is_negative.shift()).cumsum()
    ).sum()
    metrics_json["consecutive_wins"] = int(win_streaks.max()) if len(win_streaks) > 0 else 0
    metrics_json["consecutive_losses"] = int(loss_streaks.max()) if len(loss_streaks) > 0 else 0

    # Top drawdown episodes (peak -> trough -> recovery with depth + duration).
    # Note: qs.stats.drawdown_details expects the drawdown series (underwater curve),
    # not the returns series. Its output has columns ['start', 'valley', 'end',
    # 'days', 'max drawdown', ...] where `max drawdown` is a NEGATIVE percentage
    # (e.g. -12.5 means -12.5%) and start/valley/end are date strings (dtype=object).
    # Ongoing drawdowns are encoded as `end == last date` with dd_series.iloc[-1] < 0
    # (quantstats does NOT use NaN for ongoing episodes).
    try:
        details = qs.stats.drawdown_details(dd_series)
        if details is not None and len(details) > 0:
            # quantstats reports `max drawdown` as a NEGATIVE percentage;
            # sort by absolute value to get deepest-first.
            top = (
                details.assign(_abs_dd=details["max drawdown"].abs())
                .sort_values("_abs_dd", ascending=False)
                .head(5)
            )
            # Compare via datetime.date to be tz-agnostic. `returns.index` may be
            # tz-aware while quantstats-parsed `end` is tz-naive (or vice versa);
            # subtracting mixed Timestamps raises and gets swallowed by the outer
            # except, silently dropping the whole field. .date() sidesteps that.
            last_date_date = pd.Timestamp(returns.index[-1]).date()
            still_underwater = bool(float(dd_series.iloc[-1]) < 0)
            episodes: list[dict[str, Any]] = []
            for _, row in top.iterrows():
                start_date = pd.Timestamp(row["start"]).date()
                valley_date = pd.Timestamp(row["valley"]).date()
                end_date = pd.Timestamp(row["end"]).date()
                # Ongoing if this episode's end matches the last returns date and
                # the underwater curve is still below zero at that last date.
                is_current = still_underwater and end_date >= last_date_date
                recovery_date = None if is_current else end_date.strftime("%Y-%m-%d")
                # Duration: peak -> recovery (or peak -> last returns date if ongoing)
                effective_end = last_date_date if is_current else end_date
                duration_days = int((effective_end - start_date).days)
                episodes.append({
                    "peak_date": start_date.strftime("%Y-%m-%d"),
                    "trough_date": valley_date.strftime("%Y-%m-%d"),
                    "recovery_date": recovery_date,
                    "depth_pct": _safe_float(row["max drawdown"] / 100.0),
                    "duration_days": duration_days,
                    "is_current": bool(is_current),
                })
            metrics_json["drawdown_episodes"] = episodes
    except Exception as exc:  # noqa: BLE001
        # audit-2026-05-07 G11.E.1: replaced bare `except: pass` with structured
        # logging so a regression surfaces in Railway logs instead of silently
        # falling back to lower-fidelity client-side segmentation.
        # PR #181 take-2 type-design F10: dropped the `drawdown_episodes_error`
        # JSONB key — no frontend or downstream Python consumer reads it
        # (verified via repo-wide grep). The WARNING log already serves
        # operator triage; a write-only JSONB key is dead schema and a
        # fictional contract that misleads future maintainers.
        logger.warning(
            "drawdown_episodes computation failed (returns_len=%s): %s",
            len(returns) if returns is not None else None,
            exc,
            exc_info=True,
        )

    # Outlier ratios
    # fail-soft: optional pair — both ratios share one try so they degrade
    # together (consistent UI state).
    try:
        mean_ret = float(returns.mean())
        std_ret = float(returns.std())
        if std_ret > 0:
            outlier_threshold = 2 * std_ret
            metrics_json["outlier_win_ratio"] = _safe_float((returns > mean_ret + outlier_threshold).mean())
            metrics_json["outlier_loss_ratio"] = _safe_float((returns < mean_ret - outlier_threshold).mean())
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "outlier ratios failed (returns_len=%s, nonnan_len=%s): %s",
            returns_len_for_log, returns_nonnan_len_for_log, exc,
            exc_info=_should_emit_traceback("outlier_ratios", exc),
        )

    # Benchmark metrics (single greeks() call for alpha + beta)
    if benchmark_returns is not None and len(benchmark_returns) > 0:
        try:
            greeks = qs.stats.greeks(returns, benchmark_returns)
            metrics_json["alpha"] = _safe_float(greeks.get("alpha", 0))
            metrics_json["beta"] = _safe_float(greeks.get("beta", 0))
            aligned = returns.align(benchmark_returns, join="inner")
            if len(aligned[0]) > 1:
                metrics_json["correlation"] = _safe_float(aligned[0].corr(aligned[1]))
                excess = aligned[0] - aligned[1]
                te = float(excess.std() * np.sqrt(252))
                if te > 0:
                    metrics_json["info_ratio"] = _safe_float(excess.mean() * 252 / te)
                beta = metrics_json.get("beta", 0)
                if beta and beta != 0 and cagr is not None:
                    metrics_json["treynor"] = _safe_float(cagr / beta)
            if len(aligned[0]) >= 90:
                metrics_json["btc_rolling_correlation_90d"] = _rolling_correlation(aligned[0], aligned[1], 90)
        except Exception as exc:  # noqa: BLE001
            # audit-2026-05-07 G11.E.2: this `try` historically wrapped the entire
            # benchmark-metrics fan-out (greeks/alpha/beta/correlation/info_ratio/
            # treynor/btc_rolling_correlation_90d). One failure silently dropped ALL
            # of them. Log the exception with context so a regression in any of
            # those helpers surfaces in Railway logs instead of making the Risk
            # tab render "Insufficient data" forever.
            # PR #181 take-2 type-design F10: dropped the
            # `benchmark_metrics_error` JSONB key — no consumer reads it
            # (verified via repo-wide grep). WARNING log is the operator
            # signal.
            logger.warning(
                "benchmark_metrics fan-out failed (returns_len=%s, benchmark_len=%s): %s",
                len(returns) if returns is not None else None,
                len(benchmark_returns) if benchmark_returns is not None else None,
                exc,
                exc_info=True,
            )

        # Store benchmark cumulative returns series aligned to strategy dates
        try:
            strat_start = returns.index.min()
            strat_end = returns.index.max()
            bm_slice = benchmark_returns[(benchmark_returns.index >= strat_start) & (benchmark_returns.index <= strat_end)]
            if len(bm_slice) > 0:
                # F3: fillna(0) so a single missing benchmark day doesn't
                # truncate the entire benchmark curve via NaN propagation.
                bm_cumulative = (1 + bm_slice.fillna(0)).cumprod()
                # H-0715/H-0720 defense-in-depth: scrub NaN/Inf + cap payload.
                # Defensive scrub remains in case bm_slice contained ±Inf.
                metrics_json["benchmark_returns"] = cap_data_points(
                    _format_series_points(_drop_nonfinite(bm_cumulative), 6)
                )
        except Exception as exc:  # noqa: BLE001
            # audit-2026-05-07 G11.E.3: silently dropping benchmark_returns also
            # kills the client-side correlation fallback in
            # CorrelationWithBenchmark.tsx. Log so the regression surfaces in
            # Railway instead of producing the indistinguishable "no benchmark
            # assigned" empty state silently.
            # PR #181 take-2 type-design F10: dropped the
            # `benchmark_returns_error` JSONB key — no consumer reads it
            # (verified via repo-wide grep). WARNING log is the operator
            # signal.
            logger.warning(
                "benchmark_returns serialization failed (returns_len=%s, benchmark_len=%s): %s",
                len(returns) if returns is not None else None,
                len(benchmark_returns) if benchmark_returns is not None else None,
                exc,
                exc_info=True,
            )

    # METRICS-11: 10 new qstats scalars merged into the inner metrics_json
    # JSONB sub-dict (D-01 storage split — these are scalars, they live in
    # the metrics_json JSONB column on strategy_analytics, NOT new top-level
    # columns). Wired here in Phase 12 Plan 06; the helper itself shipped in
    # Plan 12-04. compute_qstats_scalars uses try/except per scalar so a
    # single qs failure can't take down the whole metrics computation.
    qstats_scalars = compute_qstats_scalars(returns, benchmark_returns)
    metrics_json.update(qstats_scalars)

    # All individual metrics already passed through _safe_float().
    # sanitize_metrics() is a final guardrail for nested structures (metrics_json, rolling, quantiles).
    sanitized = sanitize_metrics({
        "cumulative_return": total_return,
        "cagr": cagr,
        "volatility": volatility,
        "sharpe": sharpe,
        "sortino": sortino,
        "calmar": calmar,
        "max_drawdown": max_dd,
        "max_drawdown_duration_days": dd_duration,
        "six_month_return": six_month,
        "sparkline_returns": sparkline_returns,
        "sparkline_drawdown": sparkline_drawdown,
        "metrics_json": metrics_json,
        "returns_series": returns_series,
        "drawdown_series": drawdown_series,
        "monthly_returns": monthly,
        "rolling_metrics": rolling,
        "return_quantiles": quantiles,
    })

    # METRICS-04, METRICS-05, METRICS-06, METRICS-12: sibling-kind payloads.
    # 10 kinds emitted here (the 2 missing — exposure_series, turnover_series —
    # are added by analytics_runner since they require position_snapshots data).
    # Heavy-series storage per D-02 — these go to strategy_analytics_series via
    # the atomic batch RPC (M-Grok-1) at the runner level, NOT into metrics_json.
    has_benchmark = benchmark_returns is not None and len(benchmark_returns) > 0
    # H-0711: compute rolling alpha + beta from ONE rolling_greeks pass.
    if has_benchmark:
        rolling_alpha_series, rolling_beta_series = _rolling_alpha_beta(
            returns, benchmark_returns, 90
        )
    else:
        rolling_alpha_series, rolling_beta_series = [], []
    # H-0721: hoist the window-independent neg_sq derivation ONCE so the three
    # _rolling_sortino windows (63/126/252) share it instead of re-materializing
    # the boolean-mask + squaring on every call.
    sortino_neg_sq = (returns.where(returns < MAR, 0.0)) ** 2
    sibling_kinds: dict[str, Any] = {
        "daily_returns_grid": _daily_returns_grid_from_series(returns),
        "rolling_sortino_3m": _rolling_sortino_from_components(returns, sortino_neg_sq, 63),
        "rolling_sortino_6m": _rolling_sortino_from_components(returns, sortino_neg_sq, 126),
        "rolling_sortino_12m": _rolling_sortino_from_components(returns, sortino_neg_sq, 252),
        "rolling_volatility_3m": _rolling_volatility(returns, 63),
        "rolling_volatility_6m": _rolling_volatility(returns, 126),
        "rolling_volatility_12m": _rolling_volatility(returns, 252),
        "rolling_alpha": rolling_alpha_series,
        "rolling_beta": rolling_beta_series,
        "log_returns_series": _log_returns_series(returns),
    }

    return MetricsResult(metrics_json=sanitized, sibling_kinds=sibling_kinds)


def compute_risk_of_ruin(
    win_rate: float,
    payoff_ratio: float,
    avg_trade_size: float,
) -> list[dict[str, float | None]]:
    """Cox-Miller analytical approximation for probability of reaching various loss levels.

    The decaying-ruin branch requires p >= q (win rate at or above 0.5) AND
    r > 0 so that the formula is valid.  When p > 0.5, q/p is in (0, 1) and
    (q/p)^exponent decays toward 0.  At p == 0.5 exactly, q/p == 1.0 and the
    result is 1.0 (certain ruin) for every loss level — mathematically correct
    and handled safely by the [0, 1] clamp.  The original guard `p*r > q`
    (positive edge) is INSUFFICIENT: a 40%-win / 3:1-payoff strategy satisfies
    1.2 > 0.6 yet q/p = 1.5 → exponentiation explodes to values far above 1.0.

    NEW-C02-01: gate the decaying branch on `p >= q` (i.e. p >= 0.5) AND
    r > 0; result is also clamped to [0, 1] as a defence-in-depth safeguard.

    CR-C1 (specialist review 2026-05-26): For strategies with p < 0.5 AND a
    genuine positive Kelly edge (p*r > q — e.g. 45%-win / 10:1-payoff, common
    in trend-following), returning 1.0 (certain ruin) would be factually wrong
    and misleading. Instead we return None so the UI can render "N/A — formula
    requires win rate > 50%". Strategies with p < 0.5 AND no Kelly edge
    (p*r <= q) do face near-certain ruin and get 1.0.

    red-team C1 (2026-05-26): p == 0.5 with r > 0 previously fell through to
    the None branch because the guard was strict `p > q`.  Fixed to `p >= q`.
    red-team H1 (2026-05-26): p > 0.5 with r == 0 previously entered the decay
    branch and returned low-ruin (~0.017) despite zero payoff meaning certain
    ruin.  Fixed by adding `and r > 0` to the decay-branch guard.
    """
    p = win_rate
    q = 1.0 - p
    r = payoff_ratio
    loss_levels = [0.10, 0.20, 0.30, 0.50, 1.00]

    results: list[dict[str, float | None]] = []
    for level in loss_levels:
        if p <= 0 or avg_trade_size <= 0:
            prob: float | None = _safe_float(1.0)
        elif p >= q and r > 0:
            # q/p is in (0, 1] when p >= 0.5 (strict decay when p > 0.5; at
            # p == 0.5 exactly, q/p == 1.0 so (1.0)^N == 1.0 → certain ruin,
            # which is the correct answer and passes through the clamp safely).
            # Guard r > 0: if payoff_ratio == 0 every "win" contributes nothing
            # so the formula is invalid regardless of p — fall through to
            # certain-ruin or None branches below.
            exponent = min(level / max(avg_trade_size, 0.001), 500)
            raw = (q / p) ** exponent
            prob = _safe_float(min(max(raw, 0.0), 1.0))
        elif p * r > q:
            # Positive Kelly edge but p <= 0.5: Cox-Miller formula is not valid
            # here (q/p >= 1 → exponentiation explodes). Return None so the UI
            # shows "N/A — formula requires win rate > 50%" rather than a
            # misleading "100% ruin" for trend-following profiles.
            prob = None
        else:
            # No positive edge (p*r <= q): genuine ruin territory.
            prob = _safe_float(1.0)
        results.append({
            "loss_pct": _safe_float(level * 100),
            "probability": prob,
        })
    return results


def _max_dd_duration(dd_series: pd.Series) -> int:
    """Calculate max drawdown duration in days."""
    in_dd = dd_series < 0
    groups = (~in_dd).cumsum()
    if not in_dd.any():
        return 0
    durations = in_dd.groupby(groups).sum()
    return int(durations.max())


def _monthly_returns_grid_from_series(monthly: pd.Series) -> dict[str, dict[str, float]]:
    """Year x Month grid from pre-computed monthly returns."""
    months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    grid: dict[str, dict[str, float]] = {}
    for date, val in monthly.items():
        year = str(date.year)
        month = months[date.month - 1]
        if year not in grid:
            grid[year] = {}
        grid[year][month] = round(float(val), 6)
    return grid


def _daily_returns_grid_from_series(returns: pd.Series) -> list[SeriesPoint]:
    """Flat per-day return list. Sibling-table kind = 'daily_returns_grid'.

    Output shape: [{date: 'YYYY-MM-DD', value: float}, …].
    Heat-map renderer (Phase 14b) reshapes into 12-month × N-year grid client-side.
    Matches the per-date shape of every other series kind (exposure_series,
    turnover_series, rolling_*).

    Mirrors `_monthly_returns_grid_from_series` template above (D-03 storage
    decision: flat list serializes smaller and matches per-date shape of every
    other series kind per RESEARCH.md §5b).

    Audit 2026-05-07 H-0715: previously this helper iterated `returns.items()`
    with NO NaN/Inf filter — every other series helper routes through
    `_finalize_rolling` which scrubs NaN. A single NaN value (gap day, upstream
    backfill, attacker-crafted CSV import) would become `round(float(nan), 6)
    == nan` in the comprehension; Postgres JSONB then rejects NaN, failing
    the atomic batch upsert and knocking out ALL 12 sibling kinds for the
    strategy. We now drop NaN/Inf rows here.

    Audit 2026-05-07 H-0720: previously the output bypassed `cap_data_points`
    that every other series helper uses (a 10-year backtest could emit ~2,520
    raw rows). Routing through the same chokepoint as `_finalize_rolling` keeps
    payload sizes bounded.
    """
    if len(returns) == 0:
        return []
    # H-0715: scrub NaN/Inf before serialization — Postgres JSONB rejects NaN.
    # H-0720: enforce payload cap (shared chokepoint with _finalize_rolling).
    return cap_data_points(_format_series_points(_drop_nonfinite(returns), 6))


def compute_qstats_scalars(
    returns: pd.Series,
    benchmark: pd.Series | None,
) -> QstatsScalarsResult:
    """METRICS-11: Compute the 10 new qstats scalars.

    Audit 2026-05-07 H-0710 / H-0713 / H-0723:
        Each scalar is still wrapped in try/except so a single qs failure
        doesn't take down the whole metrics computation, but each `except`
        now emits `logger.warning(..., exc_info=True)` with the scalar name
        + returns length context. This converts "10 scalars silently degrade
        to None" into a triggerable operator signal (Railway log). Also closes
        the timing-oracle side channel insofar as the per-scalar throw is now
        attributable in logs rather than only inferrable from latency.

    Audit 2026-05-07 H-0718:
        `r_squared` previously collapsed three states ('no benchmark',
        'benchmark present but qs raised', 'benchmark present + qs returned
        NaN/Inf') into the single None sentinel. We now emit a companion
        `r_squared_status` key with one of 'no_benchmark' | 'ok' | 'error'
        so operators can disambiguate the failure mode without reading logs.

    Audit 2026-05-07 H-0724:
        `time_in_market` previously used `qs.stats.exposure(returns)`, whose
        internal `_ceil(ex * 100) / 100` rounds UP to the nearest percent
        (e.g., 1 active day in 252 displays as 1% instead of 0.4%). We now
        compute the unbiased fraction directly: `(returns != 0).sum() / len(returns)`.

    All keys are always present in the output dict; the value is None when
    the underlying computation fails or input is missing.

    Output keys (D-01 sibling-table contract):
        recovery_factor, ulcer_index, upi (ulcer_performance_index),
        kelly_criterion, probabilistic_sharpe_ratio (qs.stats.probabilistic_ratio),
        common_sense_ratio, cpc_index, serenity_index, r_squared (vs benchmark),
        time_in_market (fraction in [0, 1], not ceil-rounded percent),
        r_squared_status (companion: 'no_benchmark' | 'ok' | 'error').
    """
    result: QstatsScalarsResult = {
        "recovery_factor": None,
        "ulcer_index": None,
        "upi": None,
        "kelly_criterion": None,
        "probabilistic_sharpe_ratio": None,
        "common_sense_ratio": None,
        "cpc_index": None,
        "serenity_index": None,
        "r_squared": None,
        "r_squared_status": "no_benchmark",
        "time_in_market": None,
    }
    returns_len = len(returns) if returns is not None else None

    for result_key, qs_attr in _QSTATS_SINGLE_ARG_SCALARS:
        result[result_key] = _safe_qstats_scalar(
            result_key, getattr(qs.stats, qs_attr), returns, returns_len
        )

    # H-0718: distinguish 'no benchmark' (default), 'ok', and 'error' for r_squared.
    # Red-team F7: collapse NaN/Inf into 'error' (not 'ok') — qs may return a
    # finite-looking number that `_safe_float` then strips to None; status must
    # not promise 'ok' when r_squared is actually None.
    if benchmark is not None and len(benchmark) > 0:
        try:
            r_squared_val = _safe_float(qs.stats.r_squared(returns, benchmark))
            result["r_squared"] = r_squared_val
            result["r_squared_status"] = "ok" if r_squared_val is not None else "error"
        except Exception as exc:  # noqa: BLE001
            result["r_squared_status"] = "error"
            logger.warning(
                "qstats scalar r_squared failed (returns_len=%s, benchmark_len=%s): %s",
                returns_len, len(benchmark), exc, exc_info=True,
            )
    # H-0724: unbiased time-in-market fraction (qs.stats.exposure ceil-rounds UP).
    # NaN-aware: `returns != 0` evaluates `NaN != 0 → True` in pandas, which
    # would inflate the fraction whenever upstream CSV gaps inject NaN. Mirror
    # qs.stats.exposure's `(~isnan(r)) & (r != 0)` predicate exactly.
    try:
        if returns_len:
            result["time_in_market"] = _safe_float(
                (returns.notna() & (returns != 0)).sum() / returns_len
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "qstats scalar time_in_market failed (returns_len=%s): %s",
            returns_len, exc, exc_info=True,
        )

    return result


def _finalize_rolling(series: pd.Series) -> list[SeriesPoint]:
    """Drop NaN/±inf, format as {date, value} rounded to 4 decimals, cap size.

    Audit 2026-05-07 G11.E.17: when a significant fraction of points are
    dropped (NaN/Inf — usually persistent zero-variance windows for
    rolling sharpe/correlation), allocators see a chart with silent
    gaps and no indication that half the windows had undefined output.
    Now we log a WARNING when the drop ratio exceeds 10%, including the
    dropped count + total — operators can spot strategies whose
    rolling charts are mostly noise. The output shape is unchanged
    (list[{date, value}]); the per-series dropped count is intentionally
    not surfaced in metrics_json here because the caller already
    has multiple finalize_rolling sites and threading a tuple through
    each would balloon the diff. The frontend warning gate is left as
    a follow-up: this fix surfaces the signal in server logs.

    Audit 2026-05-07 H-0717: this helper conflates THREE semantically
    distinct reasons a date is absent from the output — (1) window warmup
    (the leading `window-1` rows are always NaN — expected), (2) a real
    qs/pandas computation failure mid-series, and (3) a mathematically
    undefined-but-good window (e.g. zero-downside Sortino → +∞, the bull
    signal; see H-0722). The aggregate >10% WARNING above plus the
    per-window WARNING that `_rolling_sortino_from_components` now emits give
    operators a server-side signal, but the STORED output still cannot tell
    these apart per-date. Emitting that provenance into the payload
    (a `reason` key on each SeriesPoint, or a parallel sidecar series/kind)
    is DEFERRED-CROSSRUNTIME: every sibling-kind payload flows verbatim
    through `analytics_runner` → `upsert_strategy_analytics_series_batch`
    (p_kinds) into `strategy_analytics_series` JSONB and is read back by the
    TS chart consumers (RollingSortinoChart.tsx, RollingMetricsPanel.tsx,
    HeadlineMetricsPanel.tsx), whose point type is pinned to `{date, value}`
    (SeriesPoint mirrors it — H-0730). Adding a field is a coordinated
    Python+RPC+TS change, out of scope for this single-file fix.
    """
    total = len(series)
    cleaned = _drop_nonfinite(series)
    dropped = total - len(cleaned)
    # 10% threshold — below that, the legitimate window-warmup phase of
    # any rolling indicator dominates and we'd spam the log on every
    # healthy strategy.
    if total > 0 and dropped / total > 0.10:
        logger.warning(
            "rolling-series finalize: dropped %d/%d (%.1f%%) NaN/Inf points",
            dropped,
            total,
            100.0 * dropped / total,
        )
    return cap_data_points(_format_series_points(cleaned, 4))


def _rolling_sharpe(returns: pd.Series, window: int) -> list[SeriesPoint]:
    """Compute rolling annualized Sharpe using vectorized pandas rolling.

    NEW-C02-02: mirror the zero-variance guard from `_rolling_sortino_from_components`.
    When roll_std == 0 (flat / all-identical window) the unguarded division
    emits a RuntimeWarning and produces ±Inf, which _finalize_rolling scrubs
    to NaN — silently dropping the point. Using np.where avoids the warning
    and makes the intent explicit.
    """
    if len(returns) < window:
        return []
    roll_mean = returns.rolling(window).mean()
    roll_std = returns.rolling(window).std()
    ratio = np.where(roll_std > 0, roll_mean / roll_std, np.nan)
    ratio_series = pd.Series(ratio, index=returns.index)
    return _finalize_rolling(ratio_series * np.sqrt(252))


def _rolling_sortino_from_components(
    returns: pd.Series, neg_sq: pd.Series, window: int
) -> list[SeriesPoint]:
    """Window-parameterized inner for `_rolling_sortino`.

    Audit 2026-05-07 H-0721: `_rolling_sortino` was being called 3x (windows
    63/126/252) on the same returns series. The `neg_sq = (returns.where(...))**2`
    derivation depends only on (returns, MAR) — NOT on window — and was being
    rebuilt from scratch on every call. Splitting this inner lets the caller
    materialize `neg_sq` once and pass it into all three window passes.

    Audit 2026-05-07 H-0712 / H-0716: when a rolling window contains zero
    returns below MAR (an all-winning window — the strategy's BEST state),
    `neg_sq.rolling(window).sum() == 0`, `roll_dstd == 0`, and
    `roll_mean / roll_dstd` → ±Inf. Python emits a divide-by-zero RuntimeWarning
    that nobody catches; `_finalize_rolling` then scrubs Inf → NaN → dropna(),
    silently removing the windows where the strategy performed BEST. We now
    do the divide-by-zero check EXPLICITLY via `np.where(roll_dstd > 0, ...,
    np.nan)` so (a) no RuntimeWarning is emitted on healthy strategies and
    (b) the intent (undefined-but-good is treated as 'point absent') is visible
    in the code.

    Audit 2026-05-07 H-0722: the explicit np.where above stops the
    RuntimeWarning but the no-downside window is STILL mapped to NaN and then
    dropped by `_finalize_rolling` — and, critically, that drop was SILENT and
    indistinguishable from the leading window-warmup rows. A no-downside window
    with POSITIVE mean return is not "missing data": it is a mathematically
    defined edge (Sortino → +∞, the BULL signal) that simply cannot be plotted
    on a finite ratio axis. We now separate it from the genuine 0/0 (flat/
    all-zero) case and emit an attributable WARNING counting these "undefined-
    but-good" windows, so a rolling-Sortino chart that is punctured exactly at
    the strategy's best months is no longer a silent omission — an operator can
    see in the logs that the gaps are upside-undefined, not data loss.

    The undefined-but-good predicate excludes warmup rows explicitly:
    `roll_dstd.notna()` is False for the first `window-1` rows (the rolling
    sum is NaN there), so only fully-warmed windows are counted.

    What is NOT fixed here (DEFERRED-CROSSRUNTIME): emitting the warmup /
    undefined-good / error provenance into the STORED per-date output so the
    chart can render "undefined — strategy too good" vs "no data yet". That
    requires a JSON contract change — either a `reason` key inside each
    SeriesPoint or a new sibling kind — both of which flow verbatim through
    `analytics_runner.upsert_strategy_analytics_series_batch` (p_kinds) into
    `strategy_analytics_series` JSONB and are read back by the TS chart
    consumers (RollingSortinoChart.tsx et al.). See H-0717.

    Mirrors qs.stats.sortino math (downside RMS / N, NOT pandas std / N-1) per
    the contract documented in `_rolling_sortino`.
    """
    if len(returns) < window:
        return []
    roll_dstd = (neg_sq.rolling(window).sum() / window) ** 0.5
    roll_mean = returns.rolling(window).mean()
    # H-0712 / H-0716: explicit divide-by-zero guard. roll_dstd is a pandas
    # Series; the boolean comparison produces a Series mask we feed into
    # np.where. NaN-where-undefined preserves the index so _finalize_rolling
    # can attach the original dates to the surviving points.
    ratio = np.where(roll_dstd > 0, roll_mean / roll_dstd, np.nan)
    ratio_series = pd.Series(ratio, index=returns.index)

    # H-0722: count the "undefined-but-good" windows BEFORE they are dropped by
    # _finalize_rolling so the omission is observable. A warmed window
    # (roll_dstd.notna()) with zero downside (roll_dstd == 0) and positive mean
    # is +∞ Sortino — the bull signal. Distinguished from the flat 0/0 case
    # (roll_mean <= 0), which is genuinely undefined with no upside meaning.
    warmed = roll_dstd.notna()
    no_downside = warmed & (roll_dstd == 0)
    undefined_but_good = int((no_downside & (roll_mean > 0)).sum())
    if undefined_but_good > 0:
        logger.warning(
            "rolling_sortino window=%d: %d undefined-but-good window(s) "
            "(zero downside + positive mean → +Inf Sortino) omitted from the "
            "value series; chart gaps here are the BULL signal, not data loss "
            "(H-0722; per-date provenance deferred — see H-0717)",
            window,
            undefined_but_good,
        )

    return _finalize_rolling(ratio_series * np.sqrt(252))


def _rolling_sortino(returns: pd.Series, window: int, mar: float = MAR) -> list[SeriesPoint]:
    """Compute rolling annualized Sortino using downside RMS (MAR-floored).

    Pitfall 11 single source of truth: this MUST mirror `qs.stats.sortino`'s
    downside formula so the cross-runtime parity test holds at window == period.
    qs.stats.sortino uses:
        downside = sqrt(sum(x^2 for x in returns if x < MAR) / len(returns))
        sortino = mean(returns) / downside * sqrt(252)
    Re-implementing this on a rolling window:
        neg_sq[t]   = x[t]^2 if x[t] < MAR else 0
        roll_dstd   = sqrt(neg_sq.rolling(window).sum() / window)
        roll_mean   = returns.rolling(window).mean()
        sortino[t]  = roll_mean[t] / roll_dstd[t] * sqrt(252)

    NOTE: pandas `.rolling().std()` (which `_rolling_sharpe` uses for Sharpe)
    is NOT used here — it subtracts the rolling mean and divides by (N-1), which
    diverges from qs.stats.sortino's RMS formula. Mirroring the QS math is the
    cross-runtime contract; mirroring the _rolling_sharpe SHAPE (window guard,
    _finalize_rolling) is the file convention. Both are honored.

    Mirrors _rolling_sharpe at metrics.py for shape; mirrors qs.stats.sortino
    for math.
    """
    if len(returns) < window:
        return []
    neg_sq = (returns.where(returns < mar, 0.0)) ** 2
    # _finalize_rolling scrubs NaN/Inf so the consumer never sees them.
    return _rolling_sortino_from_components(returns, neg_sq, window)


def _rolling_volatility(returns: pd.Series, window: int) -> list[SeriesPoint]:
    """Annualized rolling volatility = std * sqrt(252).

    Mirrors `qs.stats.volatility` (which is `returns.std() * sqrt(252)`) on a
    rolling window. Mirrors _rolling_sharpe at metrics.py for shape.
    """
    if len(returns) < window:
        return []
    return _finalize_rolling(returns.rolling(window).std() * np.sqrt(252))


def _rolling_alpha_beta(
    returns: pd.Series, benchmark: pd.Series, window: int = 90
) -> tuple[list[SeriesPoint], list[SeriesPoint]]:
    """Rolling (alpha, beta) projections from ONE `qs.stats.rolling_greeks` call.

    Audit 2026-05-07 H-0711: previously `_rolling_alpha` and `_rolling_beta`
    each independently called `qs.stats.rolling_greeks(returns, benchmark, window)`
    — doubling the rolling OLS regression work on every analytics run. The
    expensive part is the regression; alpha and beta come out of the SAME pass
    on the same DataFrame. This helper computes greeks once and returns both
    projections.

    Audit 2026-05-07 H-0726: scalar greeks computation upstream aligns returns
    and benchmark via `returns.align(benchmark, join='inner')` before calling
    qs; the rolling pair was passing raw un-aligned series, letting qs internally
    NaN-pad or shift across mismatched trading calendars. We now (1) align the
    two series before calling rolling_greeks, (2) validate that BOTH the
    strategy AND the benchmark have at least `window` aligned observations
    (the old guard only checked `len(returns) < window`, allowing a too-short
    benchmark to slip through), and (3) log a WARNING when the qs DataFrame
    is missing the expected alpha/beta columns instead of silently returning
    empty lists — that path masked qs version drift.
    """
    if returns is None or benchmark is None:
        return [], []
    aligned_returns, aligned_benchmark = returns.align(benchmark, join="inner")
    aligned_n = len(aligned_returns)
    if aligned_n < window:
        return [], []
    try:
        greeks = qs.stats.rolling_greeks(aligned_returns, aligned_benchmark, window)
    except Exception as exc:  # noqa: BLE001
        # H-0726.3: surface qs-side rolling_greeks failures explicitly instead
        # of letting them propagate to the caller's `except Exception` (or worse,
        # to an uncaught path on a new qs version).
        logger.warning(
            "rolling_greeks failed (aligned_n=%s, window=%s): %s",
            aligned_n, window, exc, exc_info=True,
        )
        return [], []
    columns = set(getattr(greeks, "columns", []))
    if "alpha" not in columns or "beta" not in columns:
        # H-0726.3: silent fallback on missing columns previously masked qs
        # version drift (column rename). Log it so a future qs bump that drops
        # one of the columns produces an operator-visible signal.
        logger.warning(
            "rolling_greeks missing expected alpha/beta columns (got %s)",
            sorted(columns),
        )
        return [], []
    return _finalize_rolling(greeks["alpha"]), _finalize_rolling(greeks["beta"])


def _rolling_alpha(returns: pd.Series, benchmark: pd.Series, window: int = 90) -> list[SeriesPoint]:
    """Rolling alpha vs benchmark via qs.stats.rolling_greeks.

    Thin wrapper around `_rolling_alpha_beta` retained for backward compat with
    tests that import the public helper directly. Production code paths
    (`compute_all_metrics`) call `_rolling_alpha_beta` once so the underlying
    OLS regression runs ONCE per analytics run, not twice (H-0711).

    Window default 90d trading per UC#6 BTC-only scope.
    """
    alpha, _ = _rolling_alpha_beta(returns, benchmark, window)
    return alpha


def _rolling_beta(returns: pd.Series, benchmark: pd.Series, window: int = 90) -> list[SeriesPoint]:
    """Rolling beta vs benchmark via qs.stats.rolling_greeks.

    Thin wrapper around `_rolling_alpha_beta` retained for backward compat.
    See `_rolling_alpha` docstring for rationale.
    """
    _, beta = _rolling_alpha_beta(returns, benchmark, window)
    return beta


def _log_returns_series(returns: pd.Series) -> list[SeriesPoint]:
    """Cumulative log-equity series = `np.log1p(returns).cumsum()`.

    Audit 2026-05-07 H-0719: this helper previously returned per-period
    `np.log1p(returns)` — values oscillating around zero (e.g. 0.005, -0.012,
    0.003). The TS consumer (HeadlineMetricsPanel.tsx) feeds the output
    directly into an EquityCurve renderer; for a 'Log Returns' toggle on an
    equity curve the meaningful payload is the CUMULATIVE log equity
    (`np.log((1+returns).cumprod())`, equivalently `np.log1p(returns).cumsum()`),
    which trends monotonically with the equity curve on a log axis. The
    per-period series rendered as noise hovering around zero. We now emit
    cumulative log equity so the toggle is semantically meaningful.

    Audit 2026-05-07 H-0728: `np.log1p(r)` is NaN for r <= -1 (a 100%+ loss
    day — liquidation event). `_finalize_rolling.dropna()` would silently
    remove the SINGLE most important day from the time series. We clamp
    returns to `_LOG_RETURN_FLOOR = -1 + 1e-9` before log1p so the
    catastrophic event surfaces as a very large negative log return
    (`log1p(-1+1e-9) ≈ -20.72`) instead of vanishing. Same length as input
    (no window dropoff). Routed through _finalize_rolling for NaN/Inf scrubbing
    (any non-finite returns survive the clamp via dropna) + cap_data_points
    consistency with the other series helpers.
    """
    if len(returns) == 0:
        return []
    # H-0728: clamp to keep r <= -1 within log1p's domain. Anything > -1 is
    # unchanged so this is a no-op for non-catastrophic strategies.
    clamped = returns.clip(lower=_LOG_RETURN_FLOOR)
    log_rets = np.log1p(clamped)
    # H-0719: cumulative log equity, not per-period log returns.
    cumulative = log_rets.cumsum()
    return _finalize_rolling(pd.Series(cumulative, index=returns.index))


def _rolling_correlation(a: pd.Series, b: pd.Series, window: int) -> list[SeriesPoint]:
    """Vectorized rolling Pearson correlation between two aligned series."""
    if len(a) < window:
        return []
    return _finalize_rolling(a.rolling(window).corr(b))


def _return_quantiles(
    returns: pd.Series,
    monthly_rets: pd.Series | None = None,
) -> dict[str, list[float]]:
    """Box plot data for different time periods.

    NEW-C02-11: accept pre-computed `monthly_rets` (already filtered for empty
    buckets by the caller) to avoid recomputing the expensive monthly resample.
    When None (legacy / direct callers), falls back to computing locally.

    NEW-C02-04: weekly resample also filters empty calendar buckets with
    `if len(x) > 0` to avoid phantom 0.0 periods on sparse trade calendars.
    """
    result: dict[str, list[float]] = {}

    # Daily
    q = returns.quantile([0, 0.25, 0.5, 0.75, 1]).tolist()
    result["Daily"] = [float(v) for v in q]

    # Weekly — filter empty and all-NaN calendar buckets (NEW-C02-04, CR-I3)
    # CR-I3: guard all-NaN windows the same as monthly (x.notna().any()).
    weekly = (
        returns.resample("W")
        .apply(lambda x: (1 + x).prod() - 1 if x.notna().any() else float("nan"))
        .dropna()
    )
    if len(weekly) >= 4:
        q = weekly.quantile([0, 0.25, 0.5, 0.75, 1]).tolist()
        result["Weekly"] = [float(v) for v in q]

    # Monthly — reuse caller's pre-computed series when available (NEW-C02-11).
    # The fallback path applies the same empty/all-NaN bucket filter as the
    # caller-side computation (CR-I3 guard via x.notna().any()).
    if monthly_rets is None:
        monthly_rets = (
            returns.resample("ME")
            .apply(lambda x: (1 + x).prod() - 1 if x.notna().any() else float("nan"))
            .dropna()
        )
    if len(monthly_rets) >= 3:
        q = monthly_rets.quantile([0, 0.25, 0.5, 0.75, 1]).tolist()
        result["Monthly"] = [float(v) for v in q]

    return result
