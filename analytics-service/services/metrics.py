import logging
import quantstats as qs
import pandas as pd
import numpy as np
import math
from collections.abc import ItemsView, KeysView, ValuesView
from dataclasses import dataclass, field
from typing import Any, Literal, TypedDict

from .transforms import downsample_series, cap_data_points
from .nav_twr import cumulative_twr_segmented, _last_interior_break_suffix

logger = logging.getLogger("quantalyze.analytics.metrics")


# Phase 34 (ANNUAL-01/03): single source of truth for the annualization basis.
# Every annualization site in this module (the five periods-bearing `qs.stats`
# scalar calls — cagr/volatility/sharpe/sortino/calmar — scalar greeks alpha,
# the explicit `np.sqrt(...)` / `* ...` lines, and the rolling
# sharpe/sortino/volatility helpers) resolves the periods-per-year factor from
# this constant via `compute_all_metrics(..., periods_per_year=...)`. The ONE
# path it deliberately does NOT govern is the rolling-greeks helper
# (`_rolling_alpha_beta` and its `_rolling_alpha`/`_rolling_beta` wrappers):
# rolling alpha/beta are left UNannualized in quantstats 0.0.81 (a per-period
# regression intercept/slope series, not a periods-scaled quantity), so they
# intentionally do not thread `periods_per_year` — that is not a missed site.
# The default of 252 keeps
# every displayed/ranking metric on the unified trading-day basis (comparability
# over per-asset divergence — user decision 2026-06-24). The param exists so a
# future per-asset divergence is a one-line call-site change, never a function
# rewrite. Mirrors the existing `optimizer.py:TRADING_DAYS = 252` precedent.
DEFAULT_PERIODS_PER_YEAR = 252

# #597: annualization basis is an ASSET-CLASS property, not an ingestion detail.
# crypto trades every calendar day (√365); traditional markets (equities/FX) trade
# weekdays only (√252). Driven by strategies.asset_class ('crypto' | 'traditional',
# NOT NULL DEFAULT 'traditional', backfilled 'crypto' for api_key-sourced rows).
# ponytail: unknown/None → the conservative 252 (the DB CHECK already constrains the
# domain, so this only guards a missing-column read on an old schema).
PERIODS_PER_YEAR_CRYPTO = 365


def periods_per_year_for_asset_class(asset_class: str | None) -> int:
    """Annualization periods/year for a strategy's asset class (see #597)."""
    return PERIODS_PER_YEAR_CRYPTO if asset_class == "crypto" else DEFAULT_PERIODS_PER_YEAR

# TWR-05 (founder decision 2026-07-05): RETURN/CAGR and Calmar annualize on the
# true CALENDAR clock — 365 calendar-days per year over the real DatetimeIndex
# span — while Sharpe / volatility / Sortino / rolling_* / TE-IR stay on
# `periods_per_year` (252). Return and risk are deliberately orthogonal clocks:
# a 24/7 crypto series posts a return every calendar day, so a 252-basis
# `years = len/periods` mis-reads a ~365-row record as ~1.45 years and
# over-annualizes the return. Not 365.25 — matches the existing `365/252`
# rescale-proof constant and the PROJECT.md wording ("365 / elapsed-calendar-days").
_CALENDAR_DAYS_PER_YEAR = 365.0

# HARD-04 (#67, phase decision 2026-07-11): an annualization window under
# ~MIN_ANNUALIZATION_DAYS calendar days is FLAGGED as insufficient (the
# `insufficient_window` DQ flag) rather than silently over-annualized. A
# days-old / flow-dominated live track annualizes CAGR with exponent
# 365 / elapsed_days, which EXPLODES for a tiny elapsed span (e.g. a 3-day
# suffix left after an upstream chain-break annualizes a +3% move to +3,960%).
# The flag is a DQ ANNOTATION ONLY — the CAGR value it annotates is NEVER
# altered (HARD-04 hard rule, value-invariant). Conservative founder-tunable
# default (tune like FLOW_DOM_RATIO / PNL_DOM_RATIO): 90 days ≈ one quarter,
# below which annualizing a short live window is not statistically meaningful.
MIN_ANNUALIZATION_DAYS = 90


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
_QstatsScalarKey = Literal[
    "recovery_factor",
    "ulcer_index",
    "upi",
    "kelly_criterion",
    "probabilistic_sharpe_ratio",
    "common_sense_ratio",
    "cpc_index",
    "serenity_index",
]
# Typing the key as the literal union of QstatsScalarsResult's float|None fields
# lets the `result[result_key] = ...` loop below write into the TypedDict
# (which requires literal keys) AND fails type-check if a dispatch-table key is
# ever typo'd or drifts from the result shape — no cast, no ignore.
_QSTATS_SINGLE_ARG_SCALARS: tuple[tuple[_QstatsScalarKey, str], ...] = (
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
    # HARD-04 (#67): DQ annotation lifted by BOTH callers into
    # strategy_analytics.data_quality_flags (job_worker composite merged_flags +
    # analytics_runner single-key). It rides a FIELD, NOT a metrics_json key, on
    # purpose: analytics_runner.py:1925/:2373 spread `metrics_json` into the
    # strategy_analytics UPSERT as top-level columns, and job_worker.py
    # :3386/:3506/:3595 copy `metrics_json` wholesale into metrics_json_by_basis.
    # A new metrics_json key would therefore become an UNKNOWN upsert column
    # (PostgREST failure) and mutate every full-dict golden. Annotation-only: the
    # CAGR value it flags is byte-identical with or without this field set.
    insufficient_window: bool = False

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

    def items(self) -> ItemsView[str, Any]:
        return self.metrics_json.items()

    def keys(self) -> KeysView[str]:
        return self.metrics_json.keys()

    def values(self) -> ValuesView[Any]:
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
    result: dict[str, Any] = {}
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
    periods_per_year: int = DEFAULT_PERIODS_PER_YEAR,
    cumulative_method: str = "geometric",
    day_basis: str = "calendar",
) -> MetricsResult:  # H-0729: in-module class, no forward-ref needed.
    """Compute all analytics from a daily returns series.

    Fix A (v1.8) — three metrics CONVENTIONS, each defaulting to the pre-existing
    platform behaviour so every non-overriding caller is BYTE-IDENTICAL:

      * ``periods_per_year`` — the annualization clock (crypto → 365, non-crypto →
        252). Threads every existing annualization site (unchanged mechanism).
      * ``cumulative_method`` — ``"geometric"`` (default, compounding cumprod: the
        headline ``cumulative_return`` compounds the segmented suffix, equity =
        ``Π(1+r)``, drawdown off the geometric underwater curve) vs ``"simple"``
        (arithmetic Σ of daily %, the capital-RESET convention an allocated-capital
        mandate reports on: ``cumulative_return = Σr``, equity = ``1 + Σr``, drawdown
        off the running-SUM series, CAGR/Calmar arithmetic-annualized). The whole
        cumulative/annualized/drawdown triple moves COHERENTLY.
      * ``day_basis`` — ``"calendar"`` (default) vs ``"active"`` (nonzero-P&L days
        only) for the HEADLINE annualized risk (volatility / Sharpe / Sortino). On
        the "active" basis the ROLLING Sharpe (30/90/365d) ALSO rides the nonzero-day
        series (Finding 2) so a full-window rolling value converges to the headline
        instead of being diluted by 0.0 days; wins/losses/best-worst-day stay
        zero-day-invariant (a 0.0 day is neither a win nor a loss, and never the
        max/min). NOTE: under ``cumulative_method="simple"`` the day_basis ALSO shifts
        CAGR (and hence Calmar): the arithmetic annualization is ``mean(stat_returns)
        × periods_per_year``, so the "active" basis annualizes on the nonzero-day mean
        while "calendar" annualizes on the zero-diluted mean. (Under geometric, CAGR
        is a calendar-span compound independent of day_basis.) On "calendar" the
        active series IS the full series so everything is byte-identical. Config-driven
        (Zavara → simple + active + 365) via ``run_csv_strategy_analytics``; absent ⇒
        geometric + calendar (byte-identical).

      Fix A / Finding 2 (single convention): the period panels (monthly grid,
      MTD/YTD, 3M/6M) follow ``cumulative_method`` — arithmetic Σr per bucket on
      "simple", geometric compound otherwise — so a "simple" factsheet's monthly
      cells SUM to the arithmetic ``cumulative_return`` headline instead of mixing
      conventions. best_month/worst_month/var_1m_99 derive from the monthly grid and
      inherit the convention. All byte-identical on the default geometric path.

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

    # Fix A: fail loud on an unknown convention rather than silently defaulting —
    # a mislabeled factsheet convention is a money bug (Rule 12).
    if cumulative_method not in ("geometric", "simple"):
        raise ValueError(
            f"compute_all_metrics: cumulative_method {cumulative_method!r} is not "
            "one of ('geometric', 'simple')"
        )
    if day_basis not in ("calendar", "active"):
        raise ValueError(
            f"compute_all_metrics: day_basis {day_basis!r} is not one of "
            "('calendar', 'active')"
        )
    # The HEADLINE annualized-risk series (volatility / Sharpe / Sortino). On the
    # "active" basis it is the nonzero-P&L days only (a 0.0-return no-activity day
    # would otherwise dilute mean & std); on "calendar" it IS the full series, so
    # every existing caller is byte-identical. NaN gap days are dropped for the
    # active view (they are neither activity nor a real 0).
    stat_returns = (
        returns[returns.notna() & (returns != 0.0)]
        if day_basis == "active"
        else returns
    )

    # Fix A / Finding 2 — SINGLE-CONVENTION bucket accumulator for the period
    # panels (monthly grid, MTD/YTD, 3M/6M). On the "simple" (arithmetic) method a
    # bucket return is Σr (the capital-reset convention the headline
    # cumulative_return uses); on "geometric" it is the compounding Π(1+r)−1
    # EXACTLY as before (byte-identical for every default caller). Mixing an
    # arithmetic headline with geometric panels would make the monthly cells not sum
    # to the headline — the bug this closes.
    def _bucket_return(s: "pd.Series") -> Any:
        if cumulative_method == "simple":
            return s.sum()
        return s.add(1).prod() - 1

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
    # NEW-C02-05 / DQ-03 (§6.2): the headline cumulative_return NO LONGER bridges
    # across an INTERIOR chain break. It compounds ONLY the maximal contiguous
    # suffix after the last break via nav_twr.cumulative_twr_segmented (the ONE
    # boundary source; suffix-honest, bit-identical Pi(1+r)-1 on the clean path).
    # returns_for_chart (fillna(0)) stays chart-only — it bridges gap days to
    # keep the equity curve continuous; the ranking scalar must not use it.
    if cumulative_method == "simple":
        # Fix A — SIMPLE / capital-reset convention (allocated-capital mandate):
        # the whole cumulative/annualized/drawdown triple rides the arithmetic
        # running-SUM series, NOT a geometric compound, so they stay internally
        # coherent (a geometric drawdown on an arithmetic cumulative would be a
        # mixed-basis fabrication). Capital is re-scheduled across the mandate, so
        # daily % are summed (Σr), never chain-linked.
        _cumsum = returns_for_chart.cumsum()
        # Equity-like chart curve: 1 + Σr (starts at ~1, same shape the frontend
        # equity chart expects), continuity via returns_for_chart (fillna(0)).
        cumulative = 1.0 + _cumsum
        # Headline cumulative_return = Σ of the ACTUAL daily returns (unclamped —
        # the chart clamp is chart-only). Finding 3: the geometric branch honours
        # interior NaN chain-breaks via cumulative_twr_segmented; the simple sum has
        # no such machinery, so a bare `fillna(0).sum()` would SILENTLY bridge across
        # a real gap (summing two disjoint segments as one track). The allocated path
        # gap-fills dense with 0.0 (never NaN) by construction, so a NaN here is a
        # contract violation upstream — FAIL LOUD rather than ship a silently-bridged
        # cumulative (Rule 12).
        _n_nan_simple = int(returns.isna().sum())
        if _n_nan_simple > 0:
            raise ValueError(
                "compute_all_metrics: cumulative_method='simple' received a series "
                f"with {_n_nan_simple} interior NaN day(s); the arithmetic Σr cannot "
                "honour a chain-break and would silently bridge disjoint segments. "
                "The allocated-capital path must gap-fill dense with 0.0 before this "
                "call — refusing to ship a bridged cumulative."
            )
        total_return = _safe_float(float(returns.sum()))
        # Arithmetic annualized return = mean daily × periods_per_year — the SAME
        # clock Sharpe annualizes on (so CAGR and Sharpe agree), on the day-basis
        # series (an active mandate annualizes over its trading days). NOTE: not a
        # validated headline for zavara (only cumulative/maxDD/Sharpe are); this is
        # the coherent arithmetic companion, never a geometric compound of a simple
        # series.
        _cagr_basis = stat_returns
        cagr = (
            _safe_float(float(_cagr_basis.mean()) * periods_per_year)
            if len(_cagr_basis) >= 1
            else _safe_float(float("nan"))
        )
        # HARD-04 (#67): DQ annotation ONLY — the `cagr` value above is untouched.
        # The simple path is NaN-free by its fail-loud contract (the interior-NaN
        # guard above), so the FULL returns index IS the annualization window (no
        # interior break to trim). Flag when that calendar span is under the
        # founder-tunable MIN_ANNUALIZATION_DAYS (strict `<`; a degenerate <2-day
        # window is trivially insufficient).
        if len(returns.index) < 2:
            insufficient_window = True
        else:
            _simple_elapsed_days = max((returns.index[-1] - returns.index[0]).days, 1)
            insufficient_window = _simple_elapsed_days < MIN_ANNUALIZATION_DAYS
        # Max drawdown on the running-SUM (cumulative-fraction) series: the deepest
        # (cum − running_peak). Non-positive fraction; 0.0 for a monotone series.
        # F4: run on the UNCLIPPED cumsum (returns.cumsum()), the SAME series
        # `total_return` sums — not `returns_for_chart` (clipped at −100%+ε). The
        # simple path is NaN-free by the guard above, so this equals the chart cumsum
        # for all reachable data; the clip only diverges on an (unreachable) ≤−100%
        # single day. Keeps the drawdown consistent with the unclipped headline.
        # F2: seed the running high-water at 0.0 (the from-INCEPTION baseline —
        # starting capital is cumulative 0%), so a negative day-1 shows as underwater
        # instead of being hidden by a peak seeded at day-1's own (negative) cum. This
        # also makes the shipped maxDD == the harness `stitched_arithmetic_maxdd_pct`
        # comparator (which also seeds at 0.0) == the allocated_capital meta.
        _dd_cumsum = returns.cumsum()
        _running_peak = _dd_cumsum.cummax().clip(lower=0.0)
        _underwater = _dd_cumsum - _running_peak
        max_dd = (
            _safe_float(float(_underwater.min()))
            if len(_underwater) > 0
            else _safe_float(float("nan"))
        )
        # Drawdown time-series (underwater curve) for dd_duration + drawdown_details,
        # on the same from-inception running-sum basis.
        dd_series = _underwater
    else:
        # GEOMETRIC (default) — BYTE-IDENTICAL to pre-Fix-A.
        cumulative = (1 + returns_for_chart).cumprod()
        total_return = _safe_float(cumulative_twr_segmented(returns)[0])
        # TWR-05 (founder decision 2026-07-05): CAGR annualizes on the CALENDAR
        # clock — years = true elapsed-calendar-days / 365 from the DatetimeIndex
        # span — NOT on `periods_per_year` (252). A 24/7 crypto series posts a
        # return every calendar day, so quantstats' `years = len(returns)/periods`
        # at 252 mis-reads a ~365-row record as ~1.45 years and OVER-annualizes the
        # return; a sparse CSV/MT5 series (rows < calendar-days) has the mirror bug.
        # The date-span basis is frequency-proof for BOTH dense crypto and sparse
        # CSV/MT5. `max(elapsed, 1)` guards a single-day/degenerate window against a
        # divide-by-zero. NOTE: the ONLY upstream floor is `len(returns) < 2`; a
        # genuine 2-day window (elapsed_days==1) still annualizes with exponent 365,
        # which explodes CAGR for a days-old account and is NOT yet flagged. That
        # short-window over-annualization is a pre-existing class (the old len/252
        # basis had the same shape) tracked for a DQ short-window flag behind the
        # Phase 78 parity gate — deliberately not point-fixed here because a
        # CAGR-status change is factsheet-wide blast radius (roadmap Pitfall #12).
        # This reuses `total_return` (== the segmented suffix compound) so the
        # geometric base is exactly the value the module already computed.
        # DQ-03 (§6.2): the annualization window is the SAME days total_return
        # compounds — the post-last-break suffix from the ONE shared
        # nav_twr._last_interior_break_suffix source (NOT the full dropna span), so
        # a broken-chain account annualizes over its trustworthy segment, never a
        # mixed-basis fabrication. Clean series: the suffix IS the whole series, so
        # this is byte-identical to the old `returns.dropna().index`.
        _cagr_index = _last_interior_break_suffix(returns).index
        if total_return is None or len(_cagr_index) < 2:
            cagr = _safe_float(float("nan"))
        else:
            _elapsed_days = max((_cagr_index[-1] - _cagr_index[0]).days, 1)
            cagr = _safe_float(
                (1.0 + total_return) ** (_CALENDAR_DAYS_PER_YEAR / _elapsed_days) - 1.0
            )
        # HARD-04 (#67): DQ annotation ONLY — the `cagr` expression above is NOT
        # touched. Flag when the RETAINED-suffix calendar span (the SAME days
        # total_return compounds — reusing the already-computed _elapsed_days) is
        # under MIN_ANNUALIZATION_DAYS, or when the window is trivially degenerate
        # (<2 days / no total_return). A flow-heavy / P&L-dominated window already
        # breaks the chain upstream (flow_dominated_guard / pnl_dominated_guard),
        # which SHORTENS this retained _cagr_index suffix — so the elapsed-days
        # rule fires on the trustworthy window and no separate flow trigger is
        # needed at this site (research §d + resolved decision 2).
        if total_return is None or len(_cagr_index) < 2:
            insufficient_window = True
        else:
            insufficient_window = _elapsed_days < MIN_ANNUALIZATION_DAYS
        max_dd = _safe_float(qs.stats.max_drawdown(returns))
        # Drawdown series — chart continuity per F3 (same fillna(0) rationale).
        dd_series = qs.stats.to_drawdown_series(returns_for_chart)

    # Headline annualized RISK on the day-basis series (Fix A): `stat_returns` IS
    # `returns` on the calendar basis (byte-identical), or the nonzero-day series on
    # the active basis. `periods_per_year` sets the annualization clock (crypto 365).
    volatility = _safe_float(qs.stats.volatility(stat_returns, periods=periods_per_year))
    sharpe = _safe_float(qs.stats.sharpe(stat_returns, periods=periods_per_year))
    # Audit 2026-05-07 H-0725: pass `rf=MAR` explicitly so the scalar sortino
    # and `_rolling_sortino` share the SAME minimum acceptable return constant.
    # Relying on qs.stats.sortino's implicit `rf=0` default silently diverges
    # the moment MAR is ever tuned away from 0.
    sortino = _safe_float(qs.stats.sortino(stat_returns, rf=MAR, periods=periods_per_year))
    # TWR-05: calmar = CAGR / |max_drawdown|, computed DIRECTLY so it shares the
    # CAGR basis above (geometric calendar-CAGR, or the simple arithmetic annualized).
    # quantstats' calmar helper is NO LONGER called: it recomputes its own CAGR leg
    # internally via `cagr(returns, periods=periods)` (a len/periods years exponent),
    # which would DIVERGE and leave the two headline numbers disagreeing (calmar !=
    # cagr / |maxdd|). NaN when max_dd is 0/None (a flat series) so it never /0.
    calmar = (
        _safe_float(cagr / abs(max_dd))
        if (cagr is not None and max_dd is not None and max_dd != 0.0)
        else _safe_float(float("nan"))
    )

    dd_duration = _max_dd_duration(dd_series)

    # Monthly returns (computed once, reused for grid + best/worst + VaR)
    # NEW-C02-04: filter empty calendar buckets (fabricated 0.0 from sparse
    # trade calendars). resample inserts one row per calendar period; empty
    # groups produce product() == 1 - 1 == 0.0, a phantom break-even month.
    # CR-I3 (review 2026-05-26): also guard all-NaN windows — (1+NaN).prod()
    # returns 1.0 in pandas (NaN treated as multiplicative identity), producing
    # a phantom 0.0 month for periods that consist entirely of NaN-gap days.
    # Use x.notna().any() so only months with at least one real return are kept.
    # Fix A / Finding 2: the monthly bucket is arithmetic Σr on the "simple" method
    # (so the grid SUMS to the arithmetic cumulative_return headline) and geometric
    # Π(1+r)−1 otherwise (byte-identical). The empty / all-NaN bucket guard
    # (x.notna().any()) is preserved on BOTH branches. best_month/worst_month/
    # var_1m_99 derive from monthly_rets so they inherit the single convention.
    if cumulative_method == "simple":
        monthly_rets = (
            returns.resample("ME")
            .apply(lambda x: x.sum() if x.notna().any() else float("nan"))
            .dropna()
        )
    else:
        monthly_rets = (
            returns.resample("ME")
            .apply(lambda x: (1 + x).prod() - 1 if x.notna().any() else float("nan"))
            .dropna()
        )
    monthly = _monthly_returns_grid_from_series(monthly_rets)

    # Rolling metrics. Fix A / Finding 2: on the "active" day-basis the rolling
    # Sharpe rides the SAME nonzero-day series (`stat_returns`) the HEADLINE Sharpe
    # uses — so a full-window rolling value converges to the headline instead of
    # being diluted by 0.0 no-activity days. On "calendar" `stat_returns IS returns`
    # so this is byte-identical. `periods_per_year` is already the headline clock.
    _rolling_basis = stat_returns if day_basis == "active" else returns
    rolling = {
        "sharpe_30d": _rolling_sharpe(_rolling_basis, 30, periods_per_year=periods_per_year),
        "sharpe_90d": _rolling_sharpe(_rolling_basis, 90, periods_per_year=periods_per_year),
        "sharpe_365d": _rolling_sharpe(_rolling_basis, 365, periods_per_year=periods_per_year),
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

    # Six month return (single-convention: arithmetic Σr on "simple", geometric
    # compound otherwise — byte-identical on the default geometric path).
    six_month = _safe_float(_bucket_return(returns.tail(126))) if len(returns) >= 126 else None

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

    # MTD / YTD / 3M single-convention (arithmetic Σr on "simple", geometric
    # compound otherwise — byte-identical on the default geometric path).
    metrics_json["mtd"] = _safe_float(_bucket_return(returns[returns.index >= pd.Timestamp(returns.index[-1].replace(day=1))]))
    metrics_json["ytd"] = _safe_float(_bucket_return(returns[returns.index >= pd.Timestamp(f"{returns.index[-1].year}-01-01")]))
    metrics_json["best_day"] = _safe_float(returns.max())
    metrics_json["worst_day"] = _safe_float(returns.min())
    metrics_json["three_month"] = _safe_float(_bucket_return(returns.tail(63))) if len(returns) >= 63 else None

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
            # M1 (red-team 2026-05-27): align ONCE on the inner-join
            # intersection and feed the SAME (returns, benchmark) pair into
            # EVERY benchmark-relative metric (alpha/beta via greeks,
            # correlation, info_ratio, treynor) so they are mutually
            # consistent — all computed over the exact same dates.
            #
            # Previously alpha/beta came from `qs.stats.greeks(returns,
            # benchmark_returns)`, which internally calls quantstats'
            # `_prepare_benchmark(benchmark, returns.index)` — reindexing the
            # benchmark onto the strategy's FULL date range with bfill. The
            # other metrics used `returns.align(benchmark, join="inner")` (the
            # intersection only). On a calendar mismatch (24/7 crypto strategy
            # vs a benchmark with weekend/holiday gaps) alpha/beta were over
            # the gap-filled full range while correlation/info_ratio were over
            # the shorter intersection — internally inconsistent, and IR's
            # tracking error was on a silently-truncated sample. Feeding the
            # single inner-join pair to greeks() too removes that skew. When
            # the calendars already match (e.g. the golden fixture) the
            # intersection equals the full range, so the stored values are
            # unchanged.
            aligned = returns.align(benchmark_returns, join="inner")
            aligned_returns, aligned_benchmark = aligned[0], aligned[1]
            if len(aligned_returns) > 1:
                greeks = qs.stats.greeks(
                    aligned_returns, aligned_benchmark, periods=periods_per_year
                )
                metrics_json["alpha"] = _safe_float(greeks.get("alpha", 0))
                metrics_json["beta"] = _safe_float(greeks.get("beta", 0))
                metrics_json["correlation"] = _safe_float(aligned_returns.corr(aligned_benchmark))
                excess = aligned_returns - aligned_benchmark
                te = float(excess.std() * np.sqrt(periods_per_year))
                if te > 0:
                    metrics_json["info_ratio"] = _safe_float(excess.mean() * periods_per_year / te)
                beta = metrics_json.get("beta", 0)
                if beta and beta != 0 and cagr is not None:
                    metrics_json["treynor"] = _safe_float(cagr / beta)
            if len(aligned_returns) >= 90:
                metrics_json["btc_rolling_correlation_90d"] = _rolling_correlation(aligned_returns, aligned_benchmark, 90)
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
        "rolling_sortino_3m": _rolling_sortino_from_components(
            returns, sortino_neg_sq, 63, periods_per_year=periods_per_year
        ),
        "rolling_sortino_6m": _rolling_sortino_from_components(
            returns, sortino_neg_sq, 126, periods_per_year=periods_per_year
        ),
        "rolling_sortino_12m": _rolling_sortino_from_components(
            returns, sortino_neg_sq, 252, periods_per_year=periods_per_year
        ),
        "rolling_volatility_3m": _rolling_volatility(returns, 63, periods_per_year=periods_per_year),
        "rolling_volatility_6m": _rolling_volatility(returns, 126, periods_per_year=periods_per_year),
        "rolling_volatility_12m": _rolling_volatility(returns, 252, periods_per_year=periods_per_year),
        "rolling_alpha": rolling_alpha_series,
        "rolling_beta": rolling_beta_series,
        "log_returns_series": _log_returns_series(returns),
    }

    return MetricsResult(
        metrics_json=sanitized,
        sibling_kinds=sibling_kinds,
        insufficient_window=insufficient_window,
    )


def total_return_from_equity(equity: pd.Series | None) -> float | None:
    """Endpoint-ratio total return of an equity series (backbone module home).

    Returns ``eq.iloc[-1] / eq.iloc[0] - 1`` (a decimal, e.g. 0.10 for +10%), or
    None when there is no formable ratio (``equity`` is None / fewer than 2
    observations / a zero first value). This is the backbone-blessed replacement
    for the deleted portfolio_metrics TWR scalar at its four ``events=[]`` call
    sites in routers/portfolio.py (per-strategy equity, portfolio cumprod,
    benchmark cumprod, verify_strategy cumprod).

    On a ``(1+r).cumprod()`` series whose first value is ``(1 + r_0)`` this
    endpoint ratio intentionally PRESERVES the legacy day-0-exclusion semantics
    (the byte-identical mandate of Phase 114 / BACKBONE-01): the forward TWR
    scalar excludes day-0's return. Do NOT swap in ``compute_all_metrics``'s
    ``cumulative_return`` (which is ``Π(1+r)-1`` over ALL days INCLUDING day 0);
    that differs from the deleted TWR scalar by exactly the ``(1 + r_0)`` factor
    and the 114-01 golden-parity oracle ASSERTS that divergence — reading
    cumulative_return would shift displayed numbers.

    The zero-first-value guard mirrors the legacy M-0698 ``begin_val=0``
    (portfolio-passed-through-zero) short-circuit: no ratio is formable, so we
    log a warning of the same shape and return None.
    """
    if equity is None or len(equity) < 2:
        return None
    first = float(equity.iloc[0])
    if first == 0.0:
        # M-0698 shape: a zero begin-value means the series passed through 0 (a
        # blow-up/recover event); no ratio is formable, so the forward TWR scalar
        # is undefined for this series.
        logger.warning(
            "total_return_from_equity: begin_val=0 (series at zero); "
            "no formable endpoint ratio — returning None",
        )
        return None
    return _safe_float(float(equity.iloc[-1]) / first - 1.0)


def sharpe_vol_status_from_backbone(
    returns: pd.Series,
    periods_per_year: int = DEFAULT_PERIODS_PER_YEAR,
) -> tuple[float | None, float | None, str]:
    """Annualised (vol, sharpe, status) read from the unified backbone.

    Backbone-derived replacement for the deleted legacy Sharpe/vol helper at
    its production call sites (portfolio-level Sharpe/vol, verify_strategy
    Sharpe/vol). Reads ``volatility`` and ``sharpe`` directly out of
    ``compute_all_metrics`` output. The ``status`` feeds the vol_status/
    sharpe_status data-quality channel (routers/portfolio.py L1089-1090).

    The tuple is 3-wide: ``mean_ret`` is dropped from the legacy 4-tuple because
    BOTH production call sites discard it (surgical-change rule). Status is one
    of the REACHABLE legacy codes: ``"ok"``, ``"insufficient_history"``,
    ``"zero_volatility"``, ``"nan_vol"``. ``status != "ok"`` always implies
    ``sharpe is None``.

    TWO pre-backbone guards short-circuit BEFORE the pipeline call. They mirror
    the legacy short-circuits AND structurally keep a degenerate series out of
    the full pipeline (monthly resample / mtd-ytd slices / cumprod / qs.stats.*).
    ``compute_all_metrics`` guards ONLY ``len < 2`` (metrics.py:457, which
    raises ValueError) — it is UNPROVEN to degrade gracefully on an all-NaN
    ``len >= 2`` series, so feeding one in would risk a production 500 where the
    legacy path returned a graceful data-quality status. The guards prevent that:

      * ``len(returns) <= 1`` -> ``(None, None, "insufficient_history")`` WITHOUT
        calling the backbone (matches the legacy short-circuit; also dodges the
        :457 raise).
      * ``pd.isna(returns.std())`` -> ``(None, None, "nan_vol")`` WITHOUT calling
        the backbone. Legacy ``nan_vol`` IS exactly "vol is NaN": ``std(ddof=1)``
        (skipna — the same call the legacy helper used) over an all-NaN series OR
        a single non-NaN observation is NaN, and ``_safe_float(NaN) -> None``.
        Detecting it via pandas ``std`` faithfully reproduces the legacy nan_vol
        OUTPUT and never lets an all-NaN series reach the pipeline. This guard
        changes nothing on the normal path (a real series has finite std) and
        does NOT intercept the flat-series case (``std == 0.0`` is finite, not
        NaN -> falls through to the zero_volatility branch below).

    INTERIOR-NaN skipna parity: past the guards a series may still carry
    interior NaN days with a finite std (a guard-NaN flanked by valid returns,
    the shape reconstruct_nav_and_twr emits on a dust/negative/flow-dominated
    interior day, reachable from verify_strategy). The legacy helper used pandas'
    default skipna, so those days were DROPPED from vol/mean; the pipeline's
    _prepare_returns fillna(0)s them instead, folding them in as 0.0-return days
    and DILUTING the statistic. So the series is ``dropna()``-ed before the
    pipeline call — restoring the skipna basis so vol/Sharpe match the legacy
    numbers on the normal path, not just on the clean-input path. (The
    portfolio-level call site is already NaN-free upstream, so this is a no-op
    there; only the verify_strategy path needed the parity.)

    Then the backbone is called ONCE and:
      * ``vol is None`` -> ``(None, None, "nan_vol")`` (defensive belt-and-braces;
        the std guard should already have caught every NaN-vol case);
      * ``vol == 0.0`` -> ``(0.0, None, "zero_volatility")``;
      * else -> ``(vol, sharpe, "ok")`` (sharpe is finite whenever vol is finite
        and nonzero on real data).

    DEAD BRANCHES (documented, NOT reproduced): the legacy ``"nan_mean"`` /
    ``"nan_sharpe"`` statuses are UNREACHABLE under pandas skipna — once vol is
    finite and nonzero, the same >= 2 non-NaN observations yield a finite mean
    and a finite mean/vol, so neither status can occur. They are deliberately not
    synthesized here.
    """
    if len(returns) <= 1:
        return None, None, "insufficient_history"
    if pd.isna(returns.std()):
        return None, None, "nan_vol"
    # Legacy skipna parity: the deleted helper computed vol/mean with pandas'
    # default skipna, so interior-NaN days (a guard-NaN flanked by valid returns,
    # as reconstruct_nav_and_twr emits at a dust/negative/flow-dominated interior
    # day and verify_strategy can feed here) were DROPPED from the statistic. The
    # pipeline's _prepare_returns fillna(0)s NaN days instead, folding them in as
    # 0.0-return days and diluting vol/Sharpe. Drop them BEFORE the pipeline to
    # restore the skipna basis. Safe: the two guards above (len<=1, NaN std) mean
    # a finite std here implies >= 2 finite observations survive dropna(), so
    # compute_all_metrics cannot hit its len<2 raise.
    clean = returns.dropna()
    m = compute_all_metrics(clean, periods_per_year=periods_per_year)
    vol = m["volatility"]
    sharpe = m["sharpe"]
    if vol is None:
        return None, None, "nan_vol"
    if vol == 0.0:
        return 0.0, None, "zero_volatility"
    return vol, sharpe, "ok"


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


def _rolling_sharpe(
    returns: pd.Series,
    window: int,
    periods_per_year: int = DEFAULT_PERIODS_PER_YEAR,
) -> list[SeriesPoint]:
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
    return _finalize_rolling(ratio_series * np.sqrt(periods_per_year))


def _rolling_sortino_from_components(
    returns: pd.Series,
    neg_sq: pd.Series,
    window: int,
    periods_per_year: int = DEFAULT_PERIODS_PER_YEAR,
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

    return _finalize_rolling(ratio_series * np.sqrt(periods_per_year))


def _rolling_sortino(
    returns: pd.Series,
    window: int,
    mar: float = MAR,
    periods_per_year: int = DEFAULT_PERIODS_PER_YEAR,
) -> list[SeriesPoint]:
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
    return _rolling_sortino_from_components(
        returns, neg_sq, window, periods_per_year=periods_per_year
    )


def _rolling_volatility(
    returns: pd.Series,
    window: int,
    periods_per_year: int = DEFAULT_PERIODS_PER_YEAR,
) -> list[SeriesPoint]:
    """Annualized rolling volatility = std * sqrt(periods_per_year).

    Mirrors `qs.stats.volatility` (which is `returns.std() * sqrt(periods)`) on a
    rolling window. Mirrors _rolling_sharpe at metrics.py for shape.
    """
    if len(returns) < window:
        return []
    return _finalize_rolling(returns.rolling(window).std() * np.sqrt(periods_per_year))


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
        # NOTE (Phase 34): quantstats 0.0.81 `rolling_greeks(returns, benchmark,
        # periods=252)` uses `periods` as the ROLLING WINDOW length (the source
        # comments "Calculate rolling alpha (not annualized for rolling version)"
        # — there is NO annualization factor here to thread). `window` (90) is
        # passed as that window arg. So `periods_per_year` deliberately does NOT
        # apply to the rolling alpha/beta path: rolling alpha is unannualized,
        # rolling beta is a unitless ratio. This corrects the RESEARCH claim that
        # rolling_greeks annualizes alpha (that is only true for the SCALAR
        # `greeks()` at site #5).
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

    No `periods_per_year` here: rolling alpha is unannualized in quantstats
    0.0.81 (see `_rolling_alpha_beta`).
    """
    alpha, _ = _rolling_alpha_beta(returns, benchmark, window)
    return alpha


def _rolling_beta(returns: pd.Series, benchmark: pd.Series, window: int = 90) -> list[SeriesPoint]:
    """Rolling beta vs benchmark via qs.stats.rolling_greeks.

    Thin wrapper around `_rolling_alpha_beta` retained for backward compat.
    See `_rolling_alpha` docstring for rationale. Beta is a unitless ratio, so
    no `periods_per_year` applies.
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
