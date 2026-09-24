import logging
import quantstats as qs
import pandas as pd
import numpy as np
import math
from collections.abc import Callable, ItemsView, KeysView, ValuesView
from dataclasses import dataclass, field
from typing import Any, Literal, TypedDict

from scipy.stats import linregress, norm

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

# H-0710 / H-0713 / H-0723 dispatch keys for `_QSTATS_SINGLE_ARG_SCALARS`, which
# is defined BELOW the Phase 166 mirror functions it points at (it holds module
# callables now, so it must follow their definitions).
# `r_squared` (needs benchmark) and `time_in_market` (not a qs call) are handled
# inline since their shapes differ from the single-arg pattern.
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


def _drop_nonfinite(series: pd.Series) -> pd.Series:
    """Single source of truth: drop NaN AND ±Inf rows. Used by every series
    helper that writes to JSONB (Postgres rejects NaN — H-0715/H-0720 class).
    """
    return series.replace([np.inf, -np.inf], np.nan).dropna()


def _every_mirror_ratio_is_defined(returns: pd.Series) -> bool:
    """True when ``returns`` has the shape on which all eight dispatched mirrors are defined.

    SFH LOW-4: each mirror's D-09 undefined arm needs a missing ingredient, and
    this predicate requires every one of them on ``P(r)`` (the fillna(0) series
    the mirrors read):

    - a losing day: a drawdown exists (``recovery_factor``, ``upi``,
      ``serenity_index``), ``avg_loss`` exists (``kelly_criterion``,
      ``cpc_index``) and ``profit_factor`` is finite (``common_sense_ratio``);
    - a winning day: the payoff ratio is non-zero (``kelly_criterion``);
    - a negative 5% quantile: ``tail_ratio``'s denominator is non-zero
      (``common_sense_ratio``);
    - at least 4 real observations: skew and kurtosis exist (PSR), and every
      ``n - 1`` denominator is positive.

    Measured 2026-09-24: all eight mirrors were finite on every one of 11,843
    random series (six shapes, n = 4..399, with NaN gaps) that satisfy it. So a
    non-finite mirror on such a series is a defect, and
    ``_safe_qstats_scalar`` logs it as one.
    """
    p = _prepared_returns_no_guess(returns)
    return bool(
        returns.count() >= 4
        and (p < 0).any()
        and (p > 0).any()
        and p.quantile(0.05) < 0
    )


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
    fn: Callable[[pd.Series], float],
    returns: pd.Series,
    returns_len: int | None,
    must_be_defined: bool = False,
) -> float | None:
    """Run one single-arg scalar mirror, returning None and logging on failure.

    Two named WARNINGs, never confused with each other or with a silent None:
    ``... failed`` when the mirror RAISES, and ``... the mirror is suspect``
    when it returns non-finite although ``must_be_defined`` says the input
    defines every mirror (SFH LOW-4). A non-finite result on any other input
    is a legitimately undefined ratio (D-09) and maps to None without a log.

    Since Phase 166 every ``fn`` is a module mirror from
    ``_QSTATS_SINGLE_ARG_SCALARS`` (quantstats 0.0.81 minus the price guess),
    not a ``qs.stats`` function. Its only remaining quantstats calls are the
    kwarg-proven leaves.

    Failure-soft contract (H-0710 / H-0713 / H-0723): one failing scalar must
    not take down the others. Logs include the scalar `name` so operators
    can spot silent regressions in Railway logs without inferring from latency.

    PR #181 take-2 red-team F16: traceback attachment is process-deduped via
    `_should_emit_traceback`, so one defect shared by several mirrors (for
    example a pandas or quantstats-leaf upgrade that changes a return shape)
    does not multiply Railway retention pressure linearly with call volume.
    First occurrence per (scalar_name, exc-type) pair emits exc_info=True;
    subsequent occurrences emit the WARNING text without traceback. Operators
    still get the full first-incident traceback.
    """
    try:
        raw = fn(returns)
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "qstats scalar %s failed (returns_len=%s): %s",
            name, returns_len, exc,
            exc_info=_should_emit_traceback(name, exc),
        )
        return None
    value = _safe_float(raw)
    if value is None and must_be_defined:
        # SFH LOW-4: D-09 maps a legitimately undefined ratio to None silently.
        # A mirror that goes non-finite on a series where every mirror is
        # defined (``_every_mirror_ratio_is_defined``) is a BROKEN mirror, not
        # an undefined ratio, and it must not look the same in the logs.
        logger.warning(
            "qstats scalar %s returned non-finite %r on a series that defines it "
            "(returns_len=%s): not a D-09 undefined ratio, the mirror is suspect",
            name, raw, returns_len,
        )
    return value


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
    # purpose: `analytics_runner.run_csv_strategy_analytics` spreads `metrics_json`
    # into the strategy_analytics UPSERT as top-level columns, and job_worker
    # copies `metrics_json` wholesale into metrics_json_by_basis (grep
    # `metrics_json_by_basis` there).
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


# ---------------------------------------------------------------------------
# RANK-05 / Phase 166 primitives — the money-math that Phase 159 hand-copied
# inline, extracted ONCE (TODOS 0f `[159-SIMPLIFY-DEFER]`, Phase 166 D-04).
# Each reproduces the operation order of the site it came from EXACTLY (D-08:
# no convention change), so the extraction is byte-neutral against the golden
# parity file. They return RAW floats (NaN/inf allowed); every caller keeps its
# own `_safe_float` wrapper and its own status / "undefined" handling.
# ---------------------------------------------------------------------------


def _max_drawdown_from_wealth(wealth: pd.Series) -> float:
    """Max drawdown of a WEALTH curve — quantstats 0.0.81 ``max_drawdown`` minus the price guess.

    Caller: ``compute_all_metrics`` geometric-path ``max_dd`` (wealth built from
    ``returns.fillna(0)``, UNCLIPPED). Plan 166-03's ``_recovery_factor`` reuses it.

    RANK-05 (Phase 159) — WHY INLINE, NOT quantstats. ``max_drawdown`` and
    ``to_drawdown_series`` route through ``_utils._prepare_prices``, the mirror
    image of the ``_prepare_returns`` price guess documented at the headline
    sharpe/sortino site in ``compute_all_metrics``::

        elif data.min() < 0 or data.max() < 1:
            data = to_prices(data, base)

    A series is converted returns->prices ONLY when it has a negative day or
    stays under 1. An all-non-negative daily-RETURNS series with one >100% day
    fails BOTH tests and is therefore consumed AS a price path. Measured pre-fix
    on the 60-day ALL-WINNING fixture: max_drawdown = -0.9973 — a 99.7% drawdown
    reported for a series that never lost a single day. Neither function carries
    a ``prepare_returns=`` kwarg in the pinned 0.0.81 (in-env signature sweep,
    2026-08-21), so inline pandas is the only closure (D-04 / the P114 pattern).

    MATH PARITY — quantstats 0.0.81 ``max_drawdown`` / ``to_drawdown_series``
    minus the guess. ``_prepare_prices(r, base=1.0)`` calls ``to_prices``, which
    is ``base + base * compsum(r)`` == ``(1 + r).cumprod()``; both functions then
    prepend a phantom inception point at the baseline and take
    ``price / expanding-max - 1``. Prepending is equivalent to flooring the
    running peak at the baseline — the phantom's own ratio is exactly 1.0 and
    every other ratio is <= 1, so it can never be the minimum — hence
    ``cummax().clip(lower=1.0)``.

    ONE DELIBERATE DIVERGENCE, recorded: quantstats' ``_get_baseline_value``
    GUESSES the inception capital from the first price (>1000 -> 1e5,
    >10 -> 100.0, else 1.0). That ladder exists for series that arrive as real
    prices. The wealth curve is BUILT by the caller with base 1.0, so inception
    capital is known exactly and the ladder can only misfire — it would fabricate
    a ~-100% drawdown for an account whose first day gained more than +900%.
    Baseline is pinned at 1.0. Benign parity is untouched: the ladder returns 1.0
    for every first price <= 10.

    OPERATION ORDER (load-bearing): ``min`` of the ratio, THEN ``- 1.0``, with NO
    inf/-0.0 replace — a zero drawdown stays ``+0.0`` (RESEARCH Pitfall 6).
    Takes a WEALTH curve, not returns: the caller owns the NaN convention and
    any clip, and the two ``compute_all_metrics`` callers deliberately build
    different wealth curves.
    """
    return float((wealth / wealth.cummax().clip(lower=1.0)).min()) - 1.0


def _drawdown_series_from_wealth(wealth: pd.Series) -> pd.Series:
    """Drawdown (underwater) SERIES of a WEALTH curve — quantstats 0.0.81 ``to_drawdown_series`` minus the price guess.

    Caller: ``compute_all_metrics`` geometric-path ``dd_series`` (wealth is the
    chart ``cumulative``, derived from ``returns_for_chart`` floored at
    ``_LOG_RETURN_FLOOR``). Plan 166-03's ulcer / UPI / serenity mirrors reuse it.

    Same WHY-INLINE, MATH PARITY and baseline-pinned-at-1.0 rationale as
    ``_max_drawdown_from_wealth``. The trailing ``replace`` mirrors quantstats'
    own inf/-0 cleanup and is part of this primitive's operation order (it is
    deliberately ABSENT from ``_max_drawdown_from_wealth``).
    """
    return (wealth / wealth.cummax().clip(lower=1.0) - 1.0).replace(
        [np.inf, -np.inf, -0.0], 0.0
    )


#: A standard deviation at or below this fraction of ``|mean|`` is float residue,
#: not dispersion. The residue pandas/numpy leave on a constant series is about
#: ``1e-16 * |mean|`` (measured: 4.35e-19 for a constant 0.001), so 1e-12 clears
#: it by four orders of magnitude. It only reclassifies a series whose
#: per-period mean/std exceeds 1e12, which no real return series reaches.
_DISPERSION_RESIDUE_REL = 1e-12


def _dispersion_is_residue(sd: float, mean: float) -> bool:
    """True when ``sd`` is zero or only the float residue of a constant series.

    Phase 166 review (SFH HIGH-1): an exact ``== 0`` test misses a constant
    series whose ``std()`` comes back as ``~1e-19`` instead of ``0.0``, and the
    ratio over it is then a fabricated ``~1e16``. Callers treat True as "no
    dispersion", so a ratio over it is undefined (None), never a number. A NaN
    ``sd`` returns False: each caller handles NaN on its own path.
    """
    return bool(sd <= _DISPERSION_RESIDUE_REL * abs(mean))


def _annualized_vol_sharpe(r: pd.Series, periods_per_year: int) -> tuple[float, float]:
    """Annualized ``(vol, sharpe)`` — quantstats 0.0.81 ``volatility`` / ``sharpe`` minus the price guess.

    ``vol = r.std() * sqrt(periods_per_year)`` (pandas ddof=1, skipna) and
    ``sharpe = (r.mean() * periods_per_year) / vol`` — the P114 form (annualized
    mean over annualized vol), algebraically identical to quantstats'
    ``mean / std * sqrt(periods)`` and bit-identical to every spelling it replaces
    (RESEARCH Pattern 1). With ``periods_per_year=1`` it yields ``mean / std``
    exactly — the per-period Sharpe base ``_probabilistic_sharpe_ratio`` consumes.

    Callers: ``compute_all_metrics`` headline ``sharpe`` (operand
    ``stat_returns``) and ``info_ratio`` (operand ``excess``, guarded by its own
    ``te > 0``), and ``sharpe_vol_status_from_backbone`` (operand ``returns``;
    its ``insufficient_history`` / ``nan_vol`` / ``zero_volatility`` / ``ok``
    status ladder stays OUTSIDE this primitive).

    NO-DIVIDE BRANCH: when ``vol`` is NaN this returns ``(nan, nan)``, and when
    the dispersion is zero or float residue (``_dispersion_is_residue``) it
    returns ``(0.0, nan)``, in both cases WITHOUT performing the division. The
    backbone checked vol BEFORE dividing, so its zero/NaN-vol path never emitted
    a numpy divide RuntimeWarning; now that it calls this primitive ahead of its
    status ladder, dividing here would add one. An inf ``vol`` still divides
    (``x / inf`` raises no warning), exactly as every prior spelling did.

    FLOAT-RESIDUE GUARD (Phase 166 review, SFH HIGH-1, 2026-09-24): pandas
    ``std()`` of a CONSTANT series is not always 0.0. For 120 business days of
    ``0.001`` it is ``4.35e-19``, and the quotient persisted a headline Sharpe of
    ``3.645e+16`` (measured), ranked at the top of every Sharpe percentile, and
    the backbone reported that number with status ``ok``. The old guard caught
    only an EXACT zero. A constant series has no dispersion, so its Sharpe is
    undefined: ``nan -> None`` (the "no invented data" rule: an absent panel,
    never a synthesized number), and its vol is reported as the true ``0.0`` so
    the backbone's ``zero_volatility`` status and ``info_ratio``'s ``te > 0``
    guard see it. On a series with real dispersion the values are bit-identical
    to before.

    Returns RAW floats (NaN allowed); callers keep their own ``_safe_float``.
    """
    sd = r.std()
    vol = float(sd * math.sqrt(periods_per_year))
    if math.isnan(vol):
        return vol, float("nan")
    if _dispersion_is_residue(sd, r.mean()):
        return 0.0, float("nan")
    return vol, float((r.mean() * periods_per_year) / vol)


def _downside_rms(x: pd.Series) -> float:
    """Downside RMS — the ``downside`` leg of quantstats 0.0.81 ``sortino``, on the skipna count.

    quantstats: ``sqrt((r[r < 0] ** 2).sum() / len(r))`` after ``_prepare_returns``'
    ``fillna(0)``. Here the denominator is ``int(x.count())``, the number of REAL
    observations (identical to ``len`` on every NaN-free series) — the skipna NaN
    CONVENTION recorded at the headline sharpe/sortino site. Returns NaN when the
    count is 0. The "downside == 0 means Sortino is undefined" handling stays at
    each call site.

    Callers: ``compute_all_metrics`` headline ``sortino`` (operand
    ``_sortino_excess``) and ``smart_sortino`` (operand ``_smart_r``, already
    ``dropna()``-ed, so count == len). A pure dedup: no Phase 166 mirror consumes it.
    """
    n = int(x.count())
    if n == 0:
        return float("nan")
    return math.sqrt(float((x[x < 0.0] ** 2).sum()) / n)


def _cvar_of_tail(series: pd.Series, threshold: float) -> float:
    """Mean of the tail below ``threshold`` — quantstats 0.0.81 ``conditional_value_at_risk``'s Series branch.

    quantstats: ``c_var = returns[returns < var].values.mean()``, falling back to
    ``var`` when no observation lies below it; reproduced verbatim, minus the
    empty-slice RuntimeWarning ``.values.mean()`` emits. The caller supplies the
    threshold (a kwarg-closed ``value_at_risk``) and keeps the ``None``-threshold
    branch. Named ``_cvar_of_tail`` so it cannot collide with a ``_cvar_tail``
    local.

    Callers: ``compute_all_metrics`` ``cvar`` (operand ``returns``). Plan 166-03's
    serenity mirror reuses it on a drawdown series.
    """
    tail = series[series < threshold]
    return float(tail.mean()) if len(tail) > 0 else float(threshold)


# ---------------------------------------------------------------------------
# Phase 166 — quantstats 0.0.81 mirrors, MINUS the price guess
# ---------------------------------------------------------------------------
# The eight single-arg scalars `compute_qstats_scalars` dispatches persist to
# `strategy_analytics.metrics_json` (WINDOWS.md entry 9). Phase 166 research Q2
# wrapped quantstats' `_prepare_returns` / `_prepare_prices` in a spy and called
# each scalar on the RANK-05 trigger: the `prepare_returns=` keyword closes NONE
# of them, because each one reaches a preparer transitively (or has no keyword
# at all). So each is an inline mirror (D-03 outcome), built on the plan-01
# primitives above (D-04), reproducing the 0.0.81 expression order so benign
# series stay bit-identical to live quantstats (D-08).
#
# NaN CONVENTION (recorded divergence, Rule 7): these mirrors use ``P(r)`` =
# ``_prepared_returns_no_guess`` — quantstats' own cleanup, fillna(0) — and keep
# quantstats' raw-vs-prepared choice per sub-term. That deliberately DIFFERS
# from Phase 159's skipna choice at the headline sites (see the NaN CONVENTION
# note at the headline sharpe/sortino site in ``compute_all_metrics``). The
# reason: with fillna(0) ONLY trigger-shaped series (all-non-negative with a
# >100% day) change value, so the D-11 census predicate describes the whole
# affected population. A skipna switch would also move every NaN-bearing
# series, which that predicate does not describe.
#
# Every mirror returns a RAW float (NaN/inf allowed). `_safe_qstats_scalar` ->
# `_safe_float` maps NaN and ±inf to None; the D-09 Nones (a ratio over a
# drawdown that does not exist) arise from that mapping and are never
# special-cased here.


def _prepared_returns_no_guess(r: pd.Series) -> pd.Series:
    """``P(r)``: quantstats 0.0.81 ``_utils._prepare_returns`` (rf=0 path) MINUS the price guess.

    0.0.81 body, in order: ``data.copy()``; ``elif data.min() >= 0 and
    data.max() > 1: data = data.pct_change()`` (THE GUESS, dropped here);
    ``replace([inf, -inf], NaN)``; ``fillna(0).replace([inf, -inf], NaN)``; then a
    tz normalisation of the index that no scalar reads. Reused by plans 166-04
    to 166-06.
    """
    return (
        r.copy()
        .replace([np.inf, -np.inf], np.nan)
        .fillna(0)
        .replace([np.inf, -np.inf], np.nan)
    )


def _drawdown_series_no_guess(r: pd.Series) -> pd.Series:
    """``DD(r)``: quantstats 0.0.81 ``to_drawdown_series`` MINUS the price guess.

    ``to_prices`` fills NaN with 0 before compounding, so the wealth curve is
    ``(1 + r.fillna(0)).cumprod()``. Phase 166 research measured max abs diff
    0.0 against ``qs.stats.to_drawdown_series`` on five benign fixtures.
    """
    return _drawdown_series_from_wealth((1.0 + r.fillna(0)).cumprod())


def _recovery_factor(r: pd.Series) -> float:
    """quantstats 0.0.81 ``recovery_factor`` (rf=0, Series input) minus the price guess.

    WHY INLINE: research Q2's spy saw ``recovery_factor(r, prepare_returns=False)``
    still reach ``_prepare_prices`` through ``max_drawdown``, which has no
    keyword. On the RANK-05 trigger it returned 1.9733 with the keyword and
    2.0737 without it. Both are wrong: the series never lost a day. The
    "kwarg-closable" reading in WINDOWS.md entry 9 and the 159-05 Residual table
    is REFUTED for this scalar.

    MATH PARITY (0.0.81 body)::

        returns = _prepare_returns(returns)
        total_returns = returns.sum() - rf
        max_dd = max_drawdown(returns)
        if max_dd == 0: return nan
        return abs(total_returns) / abs(max_dd)

    ``max_drawdown`` of a returns series is the drawdown of
    ``to_prices(r, base=1)`` = ``(1 + r).cumprod()``, i.e.
    ``_max_drawdown_from_wealth``.

    RECORDED, NOT CHANGED (D-08): the numerator is an ARITHMETIC sum of daily
    returns, while ``upi``'s numerator is the COMPOUNDED return (``comp``). That
    is a quantstats inconsistency. Changing it would move benign values, which
    this phase forbids, so it is reproduced as is.

    RECORDED, NOT CHANGED (D-08; SFH LOW-3, 2026-09-24): ``abs(total)`` drops
    the sign, so a NET-LOSING strategy shows a POSITIVE recovery factor (a
    -30% total over a -40% drawdown reads 0.75, the same as a +30% one). That is
    a second quantstats inconsistency and it reaches the UI. It is reproduced
    for the same reason, and recorded in 166-CONTEXT.md.

    D-09: an all-winning series has ``max_dd == 0`` -> NaN -> None.
    """
    p = _prepared_returns_no_guess(r)
    total = p.sum()
    max_dd = _max_drawdown_from_wealth((1.0 + p).cumprod())
    if max_dd == 0:
        return float("nan")
    return float(abs(total) / abs(max_dd))


def _ulcer_index(r: pd.Series) -> float:
    """quantstats 0.0.81 ``ulcer_index`` minus the price guess.

    WHY INLINE: ``ulcer_index`` has no ``prepare_returns=`` keyword, and research
    Q2's spy saw it reach ``_prepare_prices`` through ``to_drawdown_series``.

    MATH PARITY (0.0.81 body)::

        dd = to_drawdown_series(returns)
        return np.sqrt(np.divide((dd**2).sum(), returns.shape[0] - 1))

    The denominator is the RAW row count minus 1, NaN rows included, exactly as
    quantstats does it. ``np.divide`` / ``np.sqrt`` are kept so a length-1 series
    gives NaN (as before) rather than raising.

    D-09: no losing day -> ``dd`` is all 0 -> exactly 0.0.
    """
    dd = _drawdown_series_no_guess(r)
    return float(np.sqrt(np.divide((dd**2).sum(), r.shape[0] - 1)))


def _ulcer_performance_index(r: pd.Series) -> float:
    """quantstats 0.0.81 ``ulcer_performance_index`` (rf=0, Series input) minus the price guess.

    WHY INLINE: no ``prepare_returns=`` keyword; it inherits ``ulcer_index``'s
    transitive ``_prepare_prices`` call (research Q2).

    MATH PARITY (0.0.81 body)::

        ulcer = ulcer_index(returns)
        if ulcer == 0: return nan
        return (comp(returns) - rf) / ulcer

    with ``comp(r) = r.add(1).prod() - 1`` on the RAW series (a skipna product,
    equal to fillna(0) for this purpose).

    D-09: ulcer 0 -> NaN -> None.
    """
    u = _ulcer_index(r)
    if u == 0:
        return float("nan")
    return float((r.add(1).prod() - 1) / u)


def _serenity_index(r: pd.Series) -> float:
    """quantstats 0.0.81 ``serenity_index`` (rf=0, Series input) minus the price guess.

    WHY INLINE: no ``prepare_returns=`` keyword; research Q2's spy saw two
    ``_prepare_prices`` calls through ``to_drawdown_series``. Its ``cvar`` of the
    drawdown series also prepares, but it cannot guess there (a drawdown series
    is <= 0).

    MATH PARITY (0.0.81 body, Series branch)::

        dd = to_drawdown_series(returns)
        std_returns = returns.std()
        if std_returns == 0: return nan
        pitfall = -cvar(dd) / std_returns
        denominator = ulcer_index(returns) * pitfall
        if denominator == 0: return nan
        return (returns.sum() - rf) / denominator

    ``returns.std()`` and ``returns.sum()`` are on the RAW series (skipna).
    ``cvar(dd)`` is ``_cvar_of_tail(dd, value_at_risk(dd))``: the mean of the
    drawdowns below the 95% VaR, falling back to the VaR. ``value_at_risk`` is
    the kwarg-proven leaf (research Q2), called with ``prepare_returns=False``.
    The drawdown series carries no NaN, so skipping its fillna(0) changes
    nothing.

    D-09: no losing day -> ulcer 0 and VaR of an all-zero series NaN -> NaN -> None.

    ``std_returns == 0`` is tested through ``_dispersion_is_residue`` (Phase 166
    review, SFH HIGH-1 class): a constant LOSING series has a residue ``std()``
    (4.3e-19 for 250 days of -0.002, measured), the pitfall over it is ~1e16,
    and 0.0.81's exact test let a fabricated ``-2.2e-18`` through. Reached by an
    all-zero series (exact 0) and by any constant series (residue).

    The ``denominator == 0`` arm is kept for 0.0.81 parity and has NO natural
    input: ulcer is 0 only when every drawdown is 0, and then the VaR of the
    all-zero drawdown series is NaN, so the denominator is NaN, not 0; and
    whenever a drawdown exists the CVaR is strictly negative, so the pitfall is
    not 0. ``test_q166r_serenity_undefined_arms_are_none_not_zero`` reaches it
    by forcing ulcer to 0.
    """
    dd = _drawdown_series_no_guess(r)
    sd = r.std()
    if _dispersion_is_residue(sd, r.mean()):
        return float("nan")
    var = qs.stats.value_at_risk(dd, confidence=0.95, prepare_returns=False)
    pitfall = -_cvar_of_tail(dd, var) / sd
    den = _ulcer_index(r) * pitfall
    if den == 0:
        return float("nan")
    return float(r.sum() / den)


def _payoff_ratio_no_guess(p: pd.Series) -> float:
    """quantstats 0.0.81 ``payoff_ratio`` (Series input) on an ALREADY-prepared ``p``.

    WHY NOT CALL IT: 0.0.81 ``payoff_ratio(returns, prepare_returns=False)`` calls
    ``avg_loss(returns)`` and ``avg_win(returns)`` WITHOUT forwarding the keyword,
    so both leaves prepare again and the price guess fires (research Q2 spy,
    finding F-5). ``win_loss_ratio`` is an alias of it and has the same hole.
    This composes the two kwarg-proven leaves directly instead.

    MATH PARITY (0.0.81 body, Series branch)::

        avg_loss_val = avg_loss(returns)
        avg_win_val = avg_win(returns)
        if avg_loss_val == 0: return nan
        return avg_win_val / abs(avg_loss_val)

    ``avg_loss`` is the mean of the negative days. An empty set gives NaN,
    which propagates.

    UNREACHABLE ARM, KEPT ON PURPOSE (SFH INFO-1): ``avg_loss_val == 0`` cannot
    happen, because a mean of strictly negative values is negative, or NaN when
    there are none. Drill N14 (the arm returning 0.0) therefore survives the
    suite, and that is expected. The arm is kept because it is a line of the
    0.0.81 body this mirror reproduces (D-08 parity), and it is the right answer
    should a future ``avg_loss`` ever return 0: an undefined payoff, not a
    division by zero.

    Callers: ``_kelly_criterion`` and ``_cpc_index``.
    """
    avg_loss_val = qs.stats.avg_loss(p, prepare_returns=False)
    avg_win_val = qs.stats.avg_win(p, prepare_returns=False)
    if avg_loss_val == 0:
        return float("nan")
    return float(avg_win_val / abs(avg_loss_val))


def _kelly_criterion(r: pd.Series) -> float:
    """quantstats 0.0.81 ``kelly_criterion`` (Series input) minus the price guess.

    WHY INLINE: research Q2's spy saw ``kelly_criterion(r, prepare_returns=False)``
    still reach ``_prepare_returns`` through ``payoff_ratio`` and ``win_rate``.
    The "kwarg-closable" reading in WINDOWS.md entry 9 and the 159-05 Residual
    table is REFUTED for this scalar. On the non-monotone trigger live
    quantstats returned 0.3890395480225989 for a series with no losing day.

    MATH PARITY (0.0.81 body, Series branch)::

        returns = _prepare_returns(returns)
        win_loss_ratio = payoff_ratio(returns)
        win_prob = win_rate(returns)
        lose_prob = 1 - win_prob
        if win_loss_ratio == 0 or isna(win_loss_ratio): return nan
        return ((win_loss_ratio * win_prob) - lose_prob) / win_loss_ratio

    ``win_rate`` is the kwarg-proven leaf, called with ``prepare_returns=False``
    on ``P(r)``. The payoff is ``_payoff_ratio_no_guess``.

    NaN CONVENTION: ``P(r)`` (fillna(0)), as for every Phase 166 mirror.

    D-09: no losing day -> average loss undefined -> payoff NaN -> NaN -> None.
    """
    p = _prepared_returns_no_guess(r)
    wl = _payoff_ratio_no_guess(p)
    wp = qs.stats.win_rate(p, prepare_returns=False)
    lose_prob = 1 - wp
    if wl == 0 or pd.isna(wl):
        return float("nan")
    return float(((wl * wp) - lose_prob) / wl)


def _probabilistic_sharpe_ratio(r: pd.Series) -> float:
    """Probabilistic Sharpe Ratio PSR(0): quantstats 0.0.81 ``probabilistic_ratio`` minus the price guess, with D-16's kurtosis fix.

    WHY INLINE: ``probabilistic_ratio`` has no ``prepare_returns=`` keyword, and
    research Q2's spy saw it reach ``_prepare_returns`` through ``sharpe``. On the
    canonical all-winning trigger live quantstats returned 0.1531252134903383, a
    below-even probability for a series that never lost a day.

    0.0.81 BODY (base "sharpe", rf=0, not annualized)::

        base = sharpe(series, periods=periods, annualize=False)  # P(r).mean() / P(r).std(ddof=1)
        skew_no = skew(series, prepare_returns=False)            # raw r.skew()
        kurtosis_no = kurtosis(series, prepare_returns=False)    # raw r.kurtosis(), EXCESS
        n = len(series)                                          # raw row count
        sigma_sr = np.sqrt((1 + (0.5 * base**2) - (skew_no * base)
                            + (((kurtosis_no - 3) / 4) * base**2)) / (n - 1))
        return norm.cdf((base - rf) / sigma_sr)

    D-16 CORRECTION (research §Q5 F-2, founder-approved 2026-09-24). The
    variance term above expects the NON-excess fourth moment gamma4 (3 for a
    normal distribution): with it, ``1 + 0.5*SR**2 - g3*SR + ((gamma4 - 3)/4)*SR**2``
    is exactly the published ``1 - g3*SR + ((gamma4 - 1)/4)*SR**2`` (Bailey &
    Lopez de Prado, https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf).
    pandas' ``kurtosis()`` is EXCESS kurtosis, so 0.0.81 subtracts 3 twice and its
    variance is short by ``0.75*SR**2/(n-1)``. That is small on typical series,
    but on a steadily winning series the term goes negative and live PSR is
    None. This mirror changes exactly ONE input: it feeds ``r.kurtosis() + 3``.
    The expression is otherwise the 0.0.81 one, in its order.

    D-10 DISCLOSURE: this moves the persisted value on every series. The golden
    ``metrics_json.metrics_json.probabilistic_sharpe_ratio`` moved with it, and
    the before/after rows are in the plan 166-04 SUMMARY. The correctness anchor
    is ``test_q166_psr_matches_the_published_formula``, which computes the
    published formula from sample moments with scipy. It is NOT live quantstats,
    which carries the defect, so PSR has no live-quantstats parity row.

    The base comes from the plan 166-01 primitive ``_annualized_vol_sharpe`` with
    ``periods_per_year=1``, which is ``mean / std`` bit-identically (D-04: no
    third hand-copy of the Sharpe arithmetic). ``periods`` (default 252) only
    de-annualizes a non-zero rf, so it has no effect here (research Q5).
    ``np.sqrt`` is kept, so a negative inner term gives NaN -> None rather than
    an exception.

    NaN CONVENTION: the base is on ``P(r)`` (fillna(0)). Skew, kurtosis and n
    are on the RAW series, exactly as 0.0.81 computes them.
    """
    n = len(r)
    if n < 2:
        # Review IN-01: `base` is a Python float, so `(...) / (n - 1)` with n = 1
        # raised ZeroDivisionError and `_safe_qstats_scalar` logged a false
        # "scalar failed" WARNING. 0.0.81's numpy division gave NaN silently.
        # One observation defines no Sharpe, so this is undefined -> None.
        return float("nan")
    base = _annualized_vol_sharpe(_prepared_returns_no_guess(r), 1)[1]
    skew_no = r.skew()
    gamma4 = r.kurtosis() + 3  # D-16: non-excess fourth moment
    sigma_sr = np.sqrt(
        (1 + (0.5 * base**2) - (skew_no * base) + (((gamma4 - 3) / 4) * base**2))
        / (n - 1)
    )
    return float(norm.cdf(base / sigma_sr))


def _common_sense_ratio(r: pd.Series) -> float:
    """quantstats 0.0.81 ``common_sense_ratio`` minus the price guess.

    WHY INLINE: research Q2's spy saw ``common_sense_ratio(r, prepare_returns=False)``
    still reach ``_prepare_returns`` through ``profit_factor`` and ``tail_ratio``.
    The "kwarg-closable" reading in WINDOWS.md entry 9 and the 159-05 Residual
    table is REFUTED for this scalar. On the canonical trigger live quantstats
    returned 0.0 for a series with no losing day.

    MATH PARITY (0.0.81 body)::

        returns = _prepare_returns(returns)
        return profit_factor(returns) * tail_ratio(returns)

    Both leaves are kwarg-proven, and they are the same calls
    ``compute_all_metrics`` already makes for its own ``profit_factor`` and
    ``tail_ratio``, so neither gets a second implementation.

    NaN CONVENTION: ``P(r)`` (fillna(0)).

    D-09: no losing day -> ``profit_factor`` is +inf -> inf (or NaN) -> None.
    """
    p = _prepared_returns_no_guess(r)
    return float(
        qs.stats.profit_factor(p, prepare_returns=False)
        * qs.stats.tail_ratio(p, prepare_returns=False)
    )


def _cpc_index(r: pd.Series) -> float:
    """quantstats 0.0.81 ``cpc_index`` minus the price guess.

    WHY INLINE: research Q2's spy saw ``cpc_index(r, prepare_returns=False)``
    still reach ``_prepare_returns`` through ``profit_factor``, ``win_rate`` and
    ``win_loss_ratio``. The "kwarg-closable" reading in WINDOWS.md entry 9 and
    the 159-05 Residual table is REFUTED for this scalar. On the non-monotone
    trigger live quantstats returned 11.695887516415286 for a series with no
    losing day.

    MATH PARITY (0.0.81 body)::

        returns = _prepare_returns(returns)
        return profit_factor(returns) * win_rate(returns) * win_loss_ratio(returns)

    ``win_loss_ratio`` is ``payoff_ratio``, composed here by
    ``_payoff_ratio_no_guess``. The other two leaves are kwarg-proven.

    NaN CONVENTION: ``P(r)`` (fillna(0)).

    D-09: no losing day -> payoff NaN -> NaN -> None.
    """
    p = _prepared_returns_no_guess(r)
    return float(
        qs.stats.profit_factor(p, prepare_returns=False)
        * qs.stats.win_rate(p, prepare_returns=False)
        * _payoff_ratio_no_guess(p)
    )


# ---------------------------------------------------------------------------
# Phase 166 plan 05: the SCALAR benchmark leg.
#
# quantstats 0.0.81 ``r_squared`` and ``greeks`` both run the benchmark through
# ``_utils._prepare_benchmark``, which ends in ``_prepare_returns`` and never
# receives the caller's ``prepare_returns=`` keyword. So no keyword closes the
# price guess on the benchmark leg (research Q2). Both are inline here, built on
# ``_align_benchmark_like_qs``. Plan 166-06 reuses that primitive for the
# rolling leg.
# ---------------------------------------------------------------------------


def _tz_naive_like_qs(s: pd.Series) -> pd.Series:
    """The tz normalisation step of quantstats 0.0.81 ``_prepare_benchmark`` and ``_prepare_returns``, verbatim.

    0.0.81::

        if hasattr(benchmark.index, 'tz') and benchmark.index.tz is not None:
            benchmark = benchmark.tz_convert('UTC').tz_localize(None)
    """
    if hasattr(s.index, "tz") and s.index.tz is not None:
        s = s.tz_convert("UTC").tz_localize(None)
    return s


def _align_benchmark_like_qs(benchmark: pd.Series, period: pd.Index) -> pd.Series:
    """quantstats 0.0.81 ``_utils._prepare_benchmark(benchmark, period, prepare_returns=True)`` MINUS the price guess.

    0.0.81 BODY (Series benchmark, DatetimeIndex period, rf=0)::

        if set(period) != set(benchmark.index):
            benchmark_prices = to_prices(benchmark, base=1)
            new_index = date_range(start=period[0], end=period[-1], freq="D")
            benchmark = (benchmark_prices.reindex(new_index, method="bfill")
                         .reindex(period).pct_change(fill_method=None).fillna(0))
            benchmark = benchmark[benchmark.index.isin(period)]
        <tz normalisation>
        return _prepare_returns(benchmark.dropna(), rf=rf)

    ``to_prices(x, base=1)`` is ``1 + 1 * compsum(x.fillna(0).replace(±inf, NaN))``
    and ``compsum(x)`` is ``x.add(1).cumprod() - 1``. The final
    ``_prepare_returns`` becomes ``_prepared_returns_no_guess``: that is the
    only change, and it is the guess.

    THE REINDEX BRANCH IS KEPT ON PURPOSE (Pitfall 3). ``compute_qstats_scalars``
    receives the UNALIGNED strategy series and the ~1000-day BTC benchmark, so
    the set equality is false for every benchmarked strategy and this branch
    runs for all of them. Aligning on an inner join instead would move
    ``r_squared`` for everyone. That would be a convention change, not a
    closure.

    WHY NOT CALL THE PRIVATE SYMBOL: ``_prepare_benchmark(..., prepare_returns=False)``
    would also skip the guess, but it would put a private quantstats symbol into
    production money math and into the D-14 gate's allowlist, and it would break
    silently on any quantstats refactor (research "Alternatives Considered").
    These lines of pandas are the whole of it.
    """
    # Phase 166 review (SFH LOW-1 / IN-02): the benchmark is tz-normalised
    # FIRST, exactly like the strategy leg every caller normalises before it
    # builds ``period``. 0.0.81 normalises after the set test, which only works
    # because it never normalises the strategy leg; with a naive ``period`` and a
    # tz-aware benchmark the set test is always unequal and the reindex raised
    # ``TypeError: Cannot compare dtypes datetime64[us, UTC] and datetime64[us]``
    # (measured on a UTC pair). A naive benchmark is untouched, so every
    # existing value is bit-identical.
    benchmark = _tz_naive_like_qs(benchmark)
    if set(period) != set(benchmark.index):
        cleaned = benchmark.copy().fillna(0).replace([np.inf, -np.inf], float("NaN"))
        benchmark_prices = 1 + 1 * (cleaned.add(1).cumprod(axis=0) - 1)
        new_index = pd.date_range(start=period[0], end=period[-1], freq="D")
        benchmark = (
            benchmark_prices.reindex(new_index, method="bfill")
            .reindex(period)
            .pct_change(fill_method=None)
            .fillna(0)
        )
        benchmark = benchmark[benchmark.index.isin(period)]
    return _prepared_returns_no_guess(benchmark.dropna())


def _r_squared(returns: pd.Series, benchmark: pd.Series) -> float:
    """quantstats 0.0.81 ``r_squared`` minus the price guess, on BOTH legs.

    WHY INLINE: ``r_squared(r, b, prepare_returns=False)`` closes the strategy
    leg only. The benchmark goes through ``_prepare_benchmark`` twice, and each
    pass ends in ``_prepare_returns`` with the guess (research Q2). On the
    benchmark trigger (an all-non-negative benchmark with a +150% day) live
    quantstats returned 0.006670639650444322. The squared correlation of the
    raw pair is 0.0037210240094842067.

    MATH PARITY (0.0.81 body)::

        returns = _prepare_returns(returns)
        benchmark = _prepare_benchmark(benchmark, returns.index)
        _, _, r_val, _, _ = linregress(returns, _prepare_benchmark(benchmark, returns.index))
        return r_val ** 2

    The benchmark is prepared TWICE, against the unaligned series, exactly as
    0.0.81 does, so benign benchmarked strategies stay bit-identical. ``linregress``
    is the function quantstats imports. ``np.corrcoef`` is algebraically equal
    but not bit-identical to the golden, so it is not used.

    NaN CONVENTION: ``P(r)`` (fillna(0)), plus the tz step of 0.0.81
    ``_prepare_returns``, because the prepared strategy index is the period the
    benchmark is aligned to.
    """
    p = _tz_naive_like_qs(_prepared_returns_no_guess(returns))
    b = _align_benchmark_like_qs(benchmark, p.index)
    _, _, r_val, _, _ = linregress(p, _align_benchmark_like_qs(b, p.index))
    return float(r_val**2)


def _r_squared_pair_varies(returns: pd.Series, benchmark: pd.Series) -> bool:
    """True when the pair ``_r_squared`` regresses has >= 3 rows and dispersion on both legs.

    Built with the same preparation ``_r_squared`` uses, so it describes the
    exact pair ``linregress`` sees. On such a pair R^2 is defined; SFH INFO-2
    uses it to tell a broken mirror from a legitimately undefined R^2 (a leg
    that never moves).
    """
    p = _tz_naive_like_qs(_prepared_returns_no_guess(returns))
    b = _align_benchmark_like_qs(_align_benchmark_like_qs(benchmark, p.index), p.index)
    return bool(
        len(p) >= 3
        and len(b) == len(p)
        and not _dispersion_is_residue(p.std(), p.mean())
        and not _dispersion_is_residue(b.std(), b.mean())
    )


def _greeks_no_guess(
    aligned_returns: pd.Series, aligned_benchmark: pd.Series, periods: int
) -> tuple[float | None, float | None]:
    """(alpha, beta): quantstats 0.0.81 ``greeks`` minus the price guess, over pairwise-complete rows (D-05, D-15).

    WHY INLINE: ``greeks(r, b, prepare_returns=False)`` closes the strategy leg
    only. It runs the benchmark through ``_prepare_benchmark`` ->
    ``_prepare_returns`` unconditionally, so an all-non-negative benchmark with
    a >100% day is re-read as prices (research Q2). On the benchmark trigger
    live quantstats returned beta -0.015400848308443902; the OLS slope of the
    raw pair is 0.007651507459018336.

    MATH PARITY (0.0.81 body; production passed ``prepare_returns=False``)::

        benchmark = _prepare_benchmark(benchmark, returns.index)
        matrix = np.cov(returns, benchmark)
        beta = nan if matrix[1, 1] == 0 else matrix[0, 1] / matrix[1, 1]
        alpha = returns.mean() - beta * benchmark.mean()
        alpha = alpha * periods
        return Series({"beta": beta, "alpha": alpha}).fillna(0)

    The benchmark leg is ``_align_benchmark_like_qs``. The expression order is
    kept, so NaN-free input is bit-identical to live 0.0.81.

    D-15 DISCLOSURE (F-3): the trailing ``.fillna(0)`` is NOT reproduced. Since
    Phase 159 the strategy leg arrives raw, so a single NaN day made ``np.cov``
    NaN and the fillna persisted a confident ``alpha = 0.0, beta = 0.0``,
    rendered as 0.000 in the Benchmark greeks table, with treynor silently
    dropped. Here both legs are restricted to the rows where both are present
    (the convention the sibling ``aligned_returns.corr(aligned_benchmark)``
    already uses), and beta is undefined -> ``(None, None)`` when fewer than 2
    complete rows remain or the benchmark variance is 0 (D-09: undefined is
    None, never 0.0). On NaN-free input the restriction removes nothing.

    F-1, RECORDED AND NOT CHANGED (D-08): alpha is an arithmetic return
    annualized on the FREQUENCY clock (``periods``), not the calendar clock.
    ``test_periods_param_rescales_365`` pins that it rescales exactly x365/252.

    Both legs are tz-normalised (the strategy here, the benchmark inside
    ``_align_benchmark_like_qs``), so the pairwise join lines them up by date.
    0.0.81 needs no such step because ``np.cov`` pairs its inputs by position.
    """
    r = _tz_naive_like_qs(aligned_returns)
    b = _align_benchmark_like_qs(aligned_benchmark, r.index)
    pair = pd.concat([r, b], axis=1, join="inner").dropna()
    if len(pair) < 2:
        return None, None
    r, b = pair.iloc[:, 0], pair.iloc[:, 1]
    matrix = np.cov(r, b)
    # 0.0.81 tests `matrix[1, 1] == 0`. A constant benchmark's variance is often
    # float residue instead (1.9e-37 for 120 days of 0.001, measured), and the
    # slope over it was a fabricated beta (-1.92 on a 250-day constant pair).
    # Same class as SFH HIGH-1, same guard: no dispersion -> beta undefined.
    if _dispersion_is_residue(math.sqrt(matrix[1, 1]), b.mean()):
        return None, None
    beta = matrix[0, 1] / matrix[1, 1]
    alpha = r.mean() - beta * b.mean()
    alpha = alpha * periods
    return float(alpha), float(beta)


# H-0710 / H-0713 / H-0723 dispatch table: (result_key, callable). Each callable
# takes the raw returns series and returns a raw float; `compute_qstats_scalars`
# runs each one through `_safe_qstats_scalar` (failure-soft, WARNING naming the
# key). Phase 166 replaced the old (result_key, qs.stats attribute name) shape,
# so there is no longer a `getattr` dispatch over the quantstats namespace.
#
# Every entry is a Phase 166 module mirror (0.0.81 minus the price guess). No
# entry references a quantstats function object. The only quantstats calls left
# inside the mirrors are leaves research Q2 proved honour `prepare_returns=False`
# (avg_win, avg_loss, win_rate, profit_factor, tail_ratio, value_at_risk), each
# called with that keyword on an already-prepared series.
#
# Typing the key as the literal union of QstatsScalarsResult's float|None fields
# lets the `result[result_key] = ...` loop write into the TypedDict (which
# requires literal keys) AND fails type-check if a dispatch-table key is ever
# typo'd or drifts from the result shape — no cast, no ignore.
_QSTATS_SINGLE_ARG_SCALARS: tuple[
    tuple[_QstatsScalarKey, Callable[[pd.Series], float]], ...
] = (
    ("recovery_factor", _recovery_factor),
    ("ulcer_index", _ulcer_index),
    ("upi", _ulcer_performance_index),
    ("kelly_criterion", _kelly_criterion),
    ("probabilistic_sharpe_ratio", _probabilistic_sharpe_ratio),
    ("common_sense_ratio", _common_sense_ratio),
    ("cpc_index", _cpc_index),
    ("serenity_index", _serenity_index),
)


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
        # RANK-05 (Phase 159) — WHY INLINE, NOT quantstats: see the docstring of
        # `_max_drawdown_from_wealth` (price guess, math parity, baseline pinned at
        # 1.0). NaN CONVENTION at this site: fillna(0), UNCHANGED and deliberate. A
        # gap day must carry the equity curve FORWARD — a cumulative product cannot
        # skip a NaN without truncating every later point — which is the same
        # rationale `returns_for_chart` documents at F3 above. This is exactly what
        # `_prepare_prices` did, so no fixture can move on this account.
        _wealth = (1.0 + returns.fillna(0)).cumprod()
        max_dd = _safe_float(_max_drawdown_from_wealth(_wealth))
        # Drawdown series — chart continuity per F3 (same fillna(0) rationale);
        # `returns_for_chart` is already NaN-free and floored above -100%. See
        # `_drawdown_series_from_wealth`. Reuses the `cumulative` wealth curve bound
        # above (same operand, same block); the two wealth curves are NOT unified.
        dd_series = _drawdown_series_from_wealth(cumulative)

    # Headline annualized RISK on the day-basis series (Fix A): `stat_returns` IS
    # `returns` on the calendar basis (byte-identical), or the nonzero-day series on
    # the active basis. `periods_per_year` sets the annualization clock (crypto 365).
    # RANK-05 (Phase 159) — KWARG ARM, the first of the sites closed this way.
    # `volatility` DOES carry `prepare_returns=` in the pinned quantstats 0.0.81
    # (in-env `inspect.signature` sweep, 2026-08-21), and passing False was
    # MEASURED to fully neutralize the price guess here — not merely assumed from
    # the signature. Passing it removes three `_prepare_returns` behaviours:
    #   (1) the price-detection guess — the entire point (see the block below);
    #   (2) `fillna(0)` — a NaN gap day is no longer counted as a real 0.00%
    #       return. This is the SAME skipna convention the headline sharpe/sortino
    #       math below adopts, so the two stay coherent; NaN-free series (every
    #       golden/parity fixture) are byte-unaffected;
    #   (3) the inf->NaN->0 fill — a non-finite input now degrades to None through
    #       `_safe_float` instead of being silently zero-substituted into a
    #       finite-looking number. Fail-soft beats fabricated (Rule 12).
    # Every kwarg site below shares this rationale and cites it rather than
    # repeating it. Each is pinned by a live-quantstats benign-parity test.
    volatility = _safe_float(qs.stats.volatility(stat_returns, periods=periods_per_year, prepare_returns=False))
    # RANK-05 (Phase 159) — WHY INLINE, NOT quantstats. The pinned quantstats
    # 0.0.81 routes every stat through `_utils._prepare_returns`, which carries a
    # PRICE-detection heuristic the platform never asked for:
    #
    #     elif data.min() >= 0 and data.max() > 1:
    #         data = data.pct_change(fill_method=None)
    #
    # An all-non-negative daily-RETURNS series whose max > 1 — a young
    # ALL-WINNING account with one >100% day — is assumed to be a PRICE path and
    # silently differenced, which FLIPS the sign of Sharpe and Sortino. Measured
    # on a 60-day all-winning fixture (opening +150% day, decaying positive
    # gains): pre-fix sharpe = -4.3469, sortino = -4.2254 for a series that never
    # lost a day. These two scalars are RANKED, publicly-served KPIs, so that is a
    # money-math lie reaching anonymous readers.
    #
    # `sharpe` and `sortino` carry NO `prepare_returns=` kwarg in 0.0.81 (verified
    # by an in-env `inspect.signature` sweep, 2026-08-21), so the kwarg closure
    # used at the sites below CANNOT reach them. The only closure is inline pandas
    # — the same mechanism that already closed this class on the portfolio /
    # verify_strategy path in `sharpe_vol_status_from_backbone` (see its "WHY
    # INLINE" docblock below).
    #
    # MATH PARITY — reproduces quantstats 0.0.81 exactly, MINUS the price guess
    # (quantstats/stats.py, `sharpe` and `sortino`):
    #     sharpe:  divisor = returns.std(ddof=1)
    #              res = returns.mean() / divisor; return res * sqrt(periods)
    #     sortino: downside = sqrt((r[r < 0] ** 2).sum() / len(r))
    #              res = returns.mean() / downside; return res * sqrt(periods)
    # Both after `_prepare_returns(returns, rf, periods)`, whose only OTHER
    # effects are the inf->NaN->0 fill (see the NaN note) and, when rf > 0, the
    # de-annualized excess-return subtraction reproduced verbatim below. The
    # Sharpe expression is written in the P114 form (annualized mean over
    # annualized vol); it is algebraically identical to quantstats' mean/std*sqrt
    # and is pinned against LIVE quantstats on benign series by
    # `test_rank05_benign_*` in tests/test_metrics.py.
    #
    # NaN CONVENTION (deliberate, recorded): pandas' default skipna — an interior
    # NaN day is DROPPED from the statistic, exactly as the P114 path does.
    # `_prepare_returns` instead did `fillna(0)`, counting a gap day as a real
    # 0.00% return (diluting mean and std, and inflating Sortino's denominator N).
    # "No observation" is not "a flat day"; skipna is the honest reading and keeps
    # this site coherent with the already-closed path. NaN-free series — every
    # golden/parity fixture — are unaffected.
    # See `_annualized_vol_sharpe` (pandas default ddof=1 == quantstats' std(ddof=1)).
    sharpe = _safe_float(_annualized_vol_sharpe(stat_returns, periods_per_year)[1])
    # Audit 2026-05-07 H-0725: MAR is threaded EXPLICITLY so the scalar sortino
    # and `_rolling_sortino` share the SAME minimum acceptable return constant.
    # quantstats applied it as `_prepare_returns(returns, rf=MAR, nperiods=periods)`,
    # which (only when rf > 0) de-annualizes rf via `(1+rf)**(1/nperiods) - 1` and
    # subtracts it (`_utils.to_excess_returns`). That subtraction is reproduced
    # verbatim here and is an EXACT no-op at the current MAR = 0.0 (x - 0.0 == x),
    # so today's values are byte-identical while a future MAR tune still flows
    # through automatically. Pinned by
    # `test_scalar_sortino_threads_mar_as_the_downside_floor`.
    _mar_per_period = (1.0 + MAR) ** (1.0 / periods_per_year) - 1.0
    _sortino_excess = stat_returns - _mar_per_period
    # quantstats divides by `len(returns)` on its fillna(0) series; under the
    # skipna convention above the honest denominator is the count of REAL
    # observations (identical on every NaN-free series). See `_downside_rms`.
    _downside = _downside_rms(_sortino_excess)
    # downside == 0 (no day below MAR) leaves Sortino mathematically UNDEFINED;
    # quantstats returns NaN there, which `_safe_float` maps to None. Same result,
    # reached explicitly instead of via a divide-by-zero warning.
    sortino = (
        _safe_float(
            (_sortino_excess.mean() * periods_per_year)
            / (_downside * math.sqrt(periods_per_year))
        )
        if _downside > 0.0
        else None
    )
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
    # RANK-05 kwarg arm — see the `volatility` site for the shared rationale.
    # Kept on ONE source line so the region gate can see the kwarg.
    _var_95: float | None = None
    _var_95_exc: Exception | None = None
    try:
        _var_95 = _safe_float(qs.stats.value_at_risk(returns, confidence=0.95, prepare_returns=False))
        metrics_json["var_1d_95"] = _var_95
    except Exception as exc:  # noqa: BLE001
        _var_95_exc = exc
        logger.warning(
            "qstats scalar var_1d_95 failed (returns_len=%s, nonnan_len=%s): %s",
            returns_len_for_log, returns_nonnan_len_for_log, exc,
            exc_info=_should_emit_traceback("var_1d_95", exc),
        )
    # RANK-05 — MEASURED DIVERGENCE from the research matrix, recorded here
    # because the signature lies. `cvar` DOES advertise `prepare_returns=`, but
    # 0.0.81's `conditional_value_at_risk` does NOT forward it to the VaR
    # threshold it computes internally:
    #
    #     var = value_at_risk(returns, sigma, confidence)   # <- kwarg dropped
    #     c_var = returns[returns < var].values.mean()
    #
    # So `cvar(r, prepare_returns=False)` derives the threshold from the
    # PRICE-GUESSED series while selecting the tail from the raw one — a mixed
    # basis that is worse than either. Measured on the 60-day all-winning fixture:
    # `cvar(r, prepare_returns=False)` returned -0.24153, exactly the guessed-VaR
    # value, versus the honest -0.28406. The kwarg is therefore NOT a closure for
    # this site; the two-line wrapper is inlined instead, keeping the underlying
    # `value_at_risk` primitive (which DOES honour the kwarg) as the threshold
    # source. quantstats' Series branch falls back to the VaR value when no
    # observation lies below the threshold; reproduced verbatim, minus the
    # empty-slice RuntimeWarning its `.values.mean()` emits.
    # fail-soft: optional scalar.
    try:
        # Threshold reuses the SINGLE VaR evaluation above — "same threshold
        # source" is now true by construction, not by two calls agreeing. A VaR
        # failure is re-raised here so cvar keeps its OWN fail-loud warning
        # (fail-soft for the result, loud for the operator — same as before).
        if _var_95_exc is not None:
            raise _var_95_exc
        _cvar_threshold = _var_95
        if _cvar_threshold is None:
            metrics_json["cvar"] = None
        else:
            metrics_json["cvar"] = _safe_float(_cvar_of_tail(returns, _cvar_threshold))
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
    # RANK-05 inline arm — `omega` carries no `prepare_returns=` kwarg in 0.0.81,
    # so it is mirrored inline. quantstats 0.0.81 `omega`, with this call site's
    # arguments (rf=0.0, required_return=0.0, periods=252):
    #     return_threshold = (1 + 0.0) ** (1 / 252) - 1   # == 0.0 exactly
    #     numer = returns_less_thresh[returns_less_thresh > 0].sum()
    #     denom = -1.0 * returns_less_thresh[returns_less_thresh < 0].sum()
    #     return numer / denom if denom > 0 else NaN
    # With a zero threshold the deviation series IS the return series, so this
    # reduces to total gains over total losses. NaN convention: IDENTICAL either
    # way — `fillna(0)` maps a gap day to 0.0, which satisfies neither `> 0` nor
    # `< 0`, exactly as a skipped NaN does. No fixture can move here.
    # fail-soft: optional scalar.
    try:
        _omega_gain = float(returns[returns > 0.0].sum())
        _omega_pain = -float(returns[returns < 0.0].sum())
        metrics_json["omega"] = (
            _safe_float(_omega_gain / _omega_pain) if _omega_pain > 0.0 else None
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "qstats scalar omega failed (returns_len=%s, nonnan_len=%s): %s",
            returns_len_for_log, returns_nonnan_len_for_log, exc,
            exc_info=_should_emit_traceback("omega", exc),
        )
    # RANK-05 inline arm — `gain_to_pain_ratio` carries no `prepare_returns=`
    # kwarg in 0.0.81. Mirrored from its source (rf=0, resolution="D"):
    #     returns = _prepare_returns(returns, rf).resample("D").sum()
    #     downside = abs(returns[returns < 0].sum())
    #     return returns.sum() / downside   (NaN when downside == 0)
    # The daily resample is reproduced because it is load-bearing for an index
    # with more than one row per calendar day; on a one-row-per-day index it only
    # inserts 0.0 rows for absent calendar days, which change neither sum. NaN
    # convention: IDENTICAL either way — `resample().sum()` skips NaN, and
    # quantstats' `fillna(0)` contributes 0.0 to the same sums.
    # fail-soft: optional scalar.
    try:
        _gp = returns.resample("D").sum()
        _gp_pain = abs(float(_gp[_gp < 0.0].sum()))
        metrics_json["gain_pain"] = (
            _safe_float(float(_gp.sum()) / _gp_pain) if _gp_pain > 0.0 else None
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "qstats scalar gain_pain failed (returns_len=%s, nonnan_len=%s): %s",
            returns_len_for_log, returns_nonnan_len_for_log, exc,
            exc_info=_should_emit_traceback("gain_pain", exc),
        )
    # RANK-05 kwarg arm — see the `volatility` site for the shared rationale.
    # fail-soft: optional scalar.
    try:
        metrics_json["tail_ratio"] = _safe_float(qs.stats.tail_ratio(returns, prepare_returns=False))
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
    # RANK-05 inline arm — `smart_sharpe` / `smart_sortino` are thin wrappers over
    # `sharpe` / `sortino` with `smart=True`, and inherit their total lack of a
    # `prepare_returns=` kwarg in 0.0.81. Mirrored from source:
    #     autocorr_penalty(r): num = len(r)
    #         coef = abs(corrcoef(r[:-1], r[1:])[0, 1])
    #         x = arange(1, num); corr = ((num - x) / num) * (coef ** x)
    #         return sqrt(1 + 2 * corr.sum())
    #     smart_sharpe  = mean / (std(ddof=1) * penalty)      * sqrt(periods)
    #     smart_sortino = mean / (downsideRMS  * penalty)     * sqrt(periods)
    # PRESERVED EXACTLY (pre-existing, deliberately NOT touched here): both call
    # sites use quantstats' DEFAULT `periods=252` rather than `periods_per_year`,
    # and `smart_sortino` uses rf=0 rather than MAR. Changing either would be an
    # unrelated behaviour change riding a security fix — recorded as a finding
    # instead.
    # NaN convention: the autocorrelation penalty needs a dense array (`corrcoef`
    # propagates NaN), so the penalty and the moments are taken on `dropna()` —
    # the skipna reading used by the headline sharpe/sortino, in place of
    # quantstats' `fillna(0)`. Identical on every NaN-free series.
    # The shared legs are bound BEFORE either try so a failure inside the
    # smart_sharpe block cannot cascade into smart_sortino as a NameError — the
    # two scalars degrade independently, which is what the failure-soft contract
    # promises. A NaN penalty propagates to a non-positive divisor and therefore
    # to a present-but-None key, exactly as quantstats' NaN did.
    _smart_r = returns.dropna()
    _smart_n = len(_smart_r)
    _smart_penalty = float("nan")
    # fail-soft: optional scalar.
    try:
        if _smart_n >= 2:
            _smart_arr = _smart_r.to_numpy()
            _smart_coef = abs(
                float(np.corrcoef(_smart_arr[:-1], _smart_arr[1:])[0, 1])
            )
            _smart_x = np.arange(1, _smart_n)
            _smart_penalty = float(
                np.sqrt(
                    1.0
                    + 2.0
                    * float((((_smart_n - _smart_x) / _smart_n) * (_smart_coef**_smart_x)).sum())
                )
            )
        _smart_sharpe_divisor = float(_smart_r.std()) * _smart_penalty
        metrics_json["smart_sharpe"] = (
            _safe_float((float(_smart_r.mean()) / _smart_sharpe_divisor) * math.sqrt(252))
            if _smart_sharpe_divisor > 0.0
            else None
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "qstats scalar smart_sharpe failed (returns_len=%s, nonnan_len=%s): %s",
            returns_len_for_log, returns_nonnan_len_for_log, exc,
            exc_info=_should_emit_traceback("smart_sharpe", exc),
        )
    # RANK-05 inline arm — see the `smart_sharpe` site above for the full source
    # mirror. Reuses the SAME `_smart_r` / `_smart_penalty` so the pair stays on
    # one convention. quantstats' downside leg is an RMS over len(returns), NOT a
    # pandas std — `sqrt((r[r < 0] ** 2).sum() / len(r))` — mirrored verbatim,
    # with the skipna count as the denominator per the note above.
    # fail-soft: optional scalar.
    try:
        _smart_sortino_downside = _downside_rms(_smart_r) * _smart_penalty
        metrics_json["smart_sortino"] = (
            _safe_float((float(_smart_r.mean()) / _smart_sortino_downside) * math.sqrt(252))
            if _smart_sortino_downside > 0.0
            else None
        )
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
    # RANK-05 kwarg arm — see the `volatility` site for the shared rationale.
    # fail-soft: optional scalar.
    try:
        metrics_json["profit_factor"] = _safe_float(qs.stats.profit_factor(returns, prepare_returns=False))
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
    #
    # RANK-05 — the ONE quantstats call in this function deliberately left without
    # `prepare_returns=False`, because it is provably outside the defect class:
    # `drawdown_details` takes the ALREADY-COMPUTED underwater curve, not a return
    # or price series, and neither it nor the `remove_outliers` helper it calls
    # touches `_prepare_returns` or `_prepare_prices` in 0.0.81. That is not a
    # claim on trust — `test_rank05_drawdown_details_is_heuristic_free` scans the
    # installed source and goes RED if a future quantstats ever routes it through
    # either preparer. The region gate for this function excludes this call BY
    # NAME for the same reason.
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

    # Benchmark metrics (alpha + beta from ONE `_greeks_no_guess` call)
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
                # Phase 166 (D-05, D-15): alpha/beta are the inline mirror
                # `_greeks_no_guess`, on this same M1 pair. It closes the
                # benchmark leg that `greeks(..., prepare_returns=False)` left
                # open (the RANK-05 residual), and it drops 0.0.81's trailing
                # `.fillna(0)`: an undefined beta is None, never a fabricated
                # 0.0. The treynor guard below already skips a None beta.
                alpha, beta_val = _greeks_no_guess(aligned_returns, aligned_benchmark, periods_per_year)
                metrics_json["alpha"] = _safe_float(alpha)
                metrics_json["beta"] = _safe_float(beta_val)
                metrics_json["correlation"] = _safe_float(aligned_returns.corr(aligned_benchmark))
                excess = aligned_returns - aligned_benchmark
                # Tracking error and information ratio ARE annualized vol/Sharpe
                # of the excess series — see `_annualized_vol_sharpe`.
                te, _info_ratio = _annualized_vol_sharpe(excess, periods_per_year)
                if te > 0:
                    metrics_json["info_ratio"] = _safe_float(_info_ratio)
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
    # H-0711: compute rolling alpha + beta from ONE _rolling_greeks pass.
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

    The single-calendar-day guard mirrors the legacy breakpoint logic: the
    deleted forward-TWR scalar normalised the index and built
    ``breakpoints=sorted({start}|cf_dates|{end})``; with no cash flows a series
    whose observations all fall on ONE calendar day collapses to a single
    breakpoint, yields no sub-period, and returned None. Duplicate-date JSONB is a
    documented reachable shape (``_records_to_series`` does not dedupe), so this
    returns None there rather than a spurious endpoint ratio.

    INPUT CONTRACT: ``equity`` should be a float64 Series on a sorted, datetime-
    like index (all four call sites satisfy this). The index is normalised via
    ``pd.to_datetime(...).normalize()`` for the single-day check exactly as the
    deleted helper did; a non-datetime-like index is the CALLER's bug and is not
    silently coerced beyond that legacy-parity normalisation.
    """
    if equity is None or len(equity) < 2:
        return None
    # Legacy TWR-scalar parity: all observations on a single distinct calendar
    # day -> no formable sub-period -> None (checked BEFORE the begin_val=0 guard
    # so a single-day zero-first series does not emit a spurious M-0698 warning,
    # matching the legacy loop that never ran).
    if pd.to_datetime(equity.index).normalize().nunique() == 1:
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
    """Annualised (vol, sharpe, status) — byte-identical to the deleted Sharpe/vol helper.

    Backbone-module home for the Sharpe/vol scalars at the two production call
    sites (portfolio-level Sharpe/vol, verify_strategy Sharpe/vol). The ``status``
    feeds the vol_status/sharpe_status data-quality channel (routers/portfolio.py).

    INPUT CONTRACT: ``returns`` must be a float64 Series on a sorted
    ``DatetimeIndex`` (both production call sites satisfy this). vol/mean are read
    with pandas' default skipna — a non-float dtype or unsorted index is the
    CALLER's bug; this helper does NOT coerce (a silent ``astype``/``sort`` would
    mask a future caller regression rather than fail loud).

    WHY INLINE, NOT ``compute_all_metrics``: the vol/sharpe scalars are computed
    DIRECTLY from the returns with the legacy pandas math (``std(ddof=1)·√ppy``,
    ``mean·ppy``, ``mean/vol``). The unified pipeline routes through quantstats
    ``_prepare_returns``, which carries a PRICE-detection heuristic the deleted
    helper never had: an all-non-negative series whose ``max > 1`` is assumed to
    be a PRICE path and silently ``pct_change``-d, which FLIPS the sign of Sharpe
    on a young all-winning account with one >100% day (reachable via
    verify_strategy). Computing the scalars inline reproduces the deleted helper
    EXACTLY and sidesteps that corruption. (TWR keeps its own backbone helper,
    ``total_return_from_equity``; only the Sharpe/vol scalars needed inline math.)

    The tuple is 3-wide: ``mean_ret`` is dropped from the legacy 4-tuple because
    BOTH production call sites discard it (surgical-change rule). Status is one of
    the REACHABLE legacy codes with the SAME boundaries as the deleted helper:
    ``"ok"``, ``"insufficient_history"``, ``"zero_volatility"``, ``"nan_vol"``;
    ``status != "ok"`` always implies ``sharpe is None``:

      * ``len(returns) <= 1`` -> ``(None, None, "insufficient_history")``.
      * NaN vol (``std`` is NaN: all-NaN or single non-NaN observation, since
        pandas skipna ``std`` needs >= 2 finite values) -> ``(None, None,
        "nan_vol")`` gracefully, WITHOUT raising (the legacy anti-500 baseline).
      * ``vol == 0.0`` (flat returns, including a constant series whose
        ``std()`` is float residue rather than exactly 0; see
        ``_dispersion_is_residue``) -> ``(0.0, None, "zero_volatility")``.
      * else -> ``(vol, sharpe, "ok")``.

    Interior-NaN days (a guard-NaN flanked by valid returns, the shape
    reconstruct_nav_and_twr emits on a dust/negative/flow-dominated interior day,
    reachable via verify_strategy) are DROPPED by pandas skipna exactly as the
    deleted helper did — vol/mean are over the valid days only.

    DEAD BRANCHES (documented, NOT reproduced): the legacy ``"nan_mean"`` /
    ``"nan_sharpe"`` statuses are UNREACHABLE under pandas skipna — once vol is
    finite and nonzero, the same >= 2 non-NaN observations yield a finite mean
    and a finite mean/vol, so neither status can occur.
    """
    if len(returns) <= 1:
        return None, None, "insufficient_history"
    # Legacy pandas skipna math, computed INLINE — deliberately NOT read from
    # compute_all_metrics. The unified pipeline routes through quantstats
    # _prepare_returns, whose price-detection heuristic silently pct_change()s an
    # all-non-negative series with max>1 (a young all-winning account with one
    # >100% day, reachable via verify_strategy), flipping the Sharpe sign. pandas
    # std()/mean() default to skipna, so interior-NaN days are dropped from the
    # statistic exactly as the deleted helper did; an all-NaN or single-obs series
    # yields NaN std -> "nan_vol" gracefully (no raise, matching the legacy
    # anti-500 baseline).
    # `_annualized_vol_sharpe` does not divide on a zero/NaN vol, so this path
    # emits no divide RuntimeWarning (the status ladder below stays here).
    _raw_vol, _raw_sharpe = _annualized_vol_sharpe(returns, periods_per_year)
    vol = _safe_float(_raw_vol)
    if vol is None:
        return None, None, "nan_vol"
    if vol == 0.0:
        return 0.0, None, "zero_volatility"
    sharpe = _safe_float(_raw_sharpe)
    if sharpe is None:
        # UNREACHABLE under skipna once vol is finite/nonzero (>= 2 non-NaN obs
        # force a finite mean/vol); folded into nan_vol as a defensive backstop.
        return vol, None, "nan_vol"
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

    Phase 166: the eight single-arg scalars come from
    ``_QSTATS_SINGLE_ARG_SCALARS`` (key -> callable). ``recovery_factor``,
    ``ulcer_index``, ``upi`` and ``serenity_index`` are inline mirrors of
    quantstats 0.0.81 minus its price guess (``_recovery_factor``,
    ``_ulcer_index``, ``_ulcer_performance_index``, ``_serenity_index``), and so
    are ``kelly_criterion``, ``probabilistic_sharpe_ratio``,
    ``common_sense_ratio`` and ``cpc_index`` (``_kelly_criterion``,
    ``_probabilistic_sharpe_ratio``, ``_common_sense_ratio``, ``_cpc_index``).
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

    try:
        must_be_defined = _every_mirror_ratio_is_defined(returns)
    except Exception:  # noqa: BLE001 - the mirrors below log their own failure
        must_be_defined = False
    for result_key, fn in _QSTATS_SINGLE_ARG_SCALARS:
        result[result_key] = _safe_qstats_scalar(
            result_key, fn, returns, returns_len, must_be_defined
        )

    # H-0718: distinguish 'no benchmark' (default), 'ok', and 'error' for r_squared.
    # Red-team F7: collapse NaN/Inf into 'error' (not 'ok') — qs may return a
    # finite-looking number that `_safe_float` then strips to None; status must
    # not promise 'ok' when r_squared is actually None.
    if benchmark is not None and len(benchmark) > 0:
        try:
            r_squared_raw = _r_squared(returns, benchmark)
            r_squared_val = _safe_float(r_squared_raw)
            result["r_squared"] = r_squared_val
            result["r_squared_status"] = "ok" if r_squared_val is not None else "error"
            if r_squared_val is None and _r_squared_pair_varies(returns, benchmark):
                # SFH INFO-2: `error` used to be set here with no log line. A
                # leg that never moves defines no R^2 (legitimately undefined,
                # no log); both legs moving and still no R^2 is a defect.
                logger.warning(
                    "qstats scalar r_squared returned non-finite %r on a pair "
                    "where both legs vary (returns_len=%s, benchmark_len=%s): "
                    "r_squared_status=error, the mirror is suspect",
                    r_squared_raw, returns_len, len(benchmark),
                )
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


def _rolling_greeks(
    returns: pd.Series, benchmark: pd.Series, window: int
) -> pd.DataFrame:
    """Rolling (alpha, beta): quantstats 0.0.81 ``rolling_greeks`` minus the price guess on BOTH legs, with a windowed alpha (D-06, D-17).

    WHY INLINE: 0.0.81 ``rolling_greeks`` runs the benchmark through
    ``_prepare_benchmark`` -> ``_prepare_returns`` unconditionally, whatever
    ``prepare_returns=`` says, so no keyword closes the benchmark leg (research
    Q2). The strategy leg took no keyword at the old call site at all. On the
    benchmark trigger (an all-non-negative benchmark with a +150% day) live
    quantstats' last rolling beta was -0.08887237598396791; the rolling
    cov/var of the raw pair over the same 90 rows is -0.7554623350323423.

    MATH PARITY (0.0.81 body, ``periods`` is the rolling window)::

        returns = _prepare_returns(returns)
        df = DataFrame({"returns": returns,
                        "benchmark": _prepare_benchmark(benchmark, returns.index)})
        df = df.fillna(0)
        corr = df.rolling(periods).corr().unstack()["returns"]["benchmark"]
        std = df.rolling(periods).std()
        beta = corr * std["returns"] / std["benchmark"].replace(0, nan)
        alpha = df["returns"].mean() - beta * df["benchmark"].mean()
        return DataFrame(index=returns.index, data={"beta": beta, "alpha": alpha})

    ``_prepare_returns`` becomes ``_prepared_returns_no_guess`` plus its tz
    step (``_tz_naive_like_qs``), and ``_prepare_benchmark`` becomes
    ``_align_benchmark_like_qs``. Beta keeps 0.0.81's expression order, so a
    benign pair's rolling beta is bit-identical to live quantstats.

    NaN CONVENTION, A DELIBERATE DIVERGENCE FROM D-15 (SFH LOW-2, recorded
    2026-09-24): the joined frame keeps 0.0.81's ``df.fillna(0)``, so a gap day
    enters every window that covers it as a 0.0 return on the missing leg. The
    SCALAR greeks (``_greeks_no_guess``) drop that day instead
    (pairwise-complete, D-15). The two series on one page therefore read gap
    days differently. The rolling convention is kept for D-08 parity: changing
    it would move every NaN-bearing rolling beta, which this phase does not
    disclose. Recorded in 166-CONTEXT.md; the behaviour is unchanged.

    D-17 (founder-approved 2026-09-24, disclosed under D-10): ALPHA IS THE
    WINDOWED INTERCEPT ``mean_w(r) - beta_t * mean_w(b)`` over the same window
    as beta. 0.0.81 used FULL-SAMPLE means (research F-4), which made the
    rendered ``rolling_alpha`` a linear transform of rolling beta rather than a
    rolling alpha. Rolling beta is unchanged.

    NOTE (Phase 34): quantstats 0.0.81 ``rolling_greeks(returns, benchmark,
    periods=252)`` uses ``periods`` as the ROLLING WINDOW length (its source
    says "Calculate rolling alpha (not annualized for rolling version)"), so
    there is no annualization factor to thread. Rolling alpha stays
    UNANNUALIZED (a per-period intercept) and rolling beta is a unitless ratio;
    ``periods_per_year`` deliberately does not apply here. Only the SCALAR
    greeks alpha is annualized.
    """
    prepared = _tz_naive_like_qs(_prepared_returns_no_guess(returns))
    df = pd.DataFrame(
        data={
            "returns": prepared,
            "benchmark": _align_benchmark_like_qs(benchmark, prepared.index),
        }
    ).fillna(0)
    rolling = df.rolling(int(window))
    corr = rolling.corr().unstack()["returns"]["benchmark"]
    std = rolling.std()
    beta = corr * std["returns"] / std["benchmark"].replace(0, np.nan)
    means = rolling.mean()
    alpha = means["returns"] - beta * means["benchmark"]
    return pd.DataFrame(index=prepared.index, data={"beta": beta, "alpha": alpha})


def _rolling_alpha_beta(
    returns: pd.Series, benchmark: pd.Series, window: int = 90
) -> tuple[list[SeriesPoint], list[SeriesPoint]]:
    """Rolling (alpha, beta) projections from ONE ``_rolling_greeks`` pass.

    Audit 2026-05-07 H-0711: previously `_rolling_alpha` and `_rolling_beta`
    each independently ran the rolling greeks (then `qs.stats.rolling_greeks`)
    — doubling the rolling OLS regression work on every analytics run. The
    expensive part is the regression; alpha and beta come out of the SAME pass
    on the same DataFrame. This helper computes greeks once and returns both
    projections.

    Audit 2026-05-07 H-0726: scalar greeks computation upstream aligns returns
    and benchmark via `returns.align(benchmark, join='inner')`; the rolling
    pair was passing raw un-aligned series, letting the rolling math NaN-pad or
    shift across mismatched trading calendars. We (1) align the two series
    before the rolling pass, (2) validate that BOTH the strategy AND the
    benchmark have at least `window` aligned observations (the old guard only
    checked `len(returns) < window`, allowing a too-short benchmark to slip
    through), and (3) log a WARNING and return ``([], [])`` when the rolling
    pass fails, instead of propagating.

    Phase 166 (D-06): the rolling pass is the inline ``_rolling_greeks``, closed
    on both legs. The old "missing alpha/beta columns" branch guarded a
    quantstats column rename; the frame is now built here, so that branch could
    no longer run and was removed together with its test.
    """
    if returns is None or benchmark is None:
        return [], []
    aligned_returns, aligned_benchmark = returns.align(benchmark, join="inner")
    aligned_n = len(aligned_returns)
    if aligned_n < window:
        return [], []
    try:
        greeks = _rolling_greeks(aligned_returns, aligned_benchmark, window)
    except Exception as exc:  # noqa: BLE001
        # H-0726.3: surface rolling_greeks failures explicitly instead of
        # letting them propagate to the caller's `except Exception`.
        logger.warning(
            "rolling_greeks failed (aligned_n=%s, window=%s): %s",
            aligned_n, window, exc, exc_info=True,
        )
        return [], []
    return _finalize_rolling(greeks["alpha"]), _finalize_rolling(greeks["beta"])


def _rolling_alpha(returns: pd.Series, benchmark: pd.Series, window: int = 90) -> list[SeriesPoint]:
    """Rolling alpha vs benchmark via the inline ``_rolling_greeks`` (windowed intercept, D-17).

    Thin wrapper around `_rolling_alpha_beta` retained for backward compat with
    tests that import the public helper directly. Production code paths
    (`compute_all_metrics`) call `_rolling_alpha_beta` once so the underlying
    OLS regression runs ONCE per analytics run, not twice (H-0711).

    Window default 90d trading per UC#6 BTC-only scope.

    No `periods_per_year` here: rolling alpha is unannualized, as in quantstats
    0.0.81 (see `_rolling_greeks`).
    """
    alpha, _ = _rolling_alpha_beta(returns, benchmark, window)
    return alpha


def _rolling_beta(returns: pd.Series, benchmark: pd.Series, window: int = 90) -> list[SeriesPoint]:
    """Rolling beta vs benchmark via the inline ``_rolling_greeks``.

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
