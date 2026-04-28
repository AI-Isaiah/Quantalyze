---
phase: 12-backend-metric-contracts
plan: 03
subsystem: analytics
tags: [python, quantstats, pandas, numpy, sortino, volatility, alpha, beta, log-returns, rolling-windows, tdd, pitfall-11, mar]

# Dependency graph
requires:
  - phase: 12-backend-metric-contracts
    plan: 02
    provides: "D-16 frozen TS contract (StrategyAnalyticsSeriesKind union with 12 sibling kinds — rolling_sortino_3m/6m/12m, rolling_volatility_3m/6m/12m, rolling_alpha_90d, rolling_beta_90d, log_returns_series are all members)"
provides:
  - "MAR: float = 0.0 module-level constant in metrics.py — Pitfall 11 single source of truth shared by qs.stats.sortino (default MAR=0) and the new _rolling_sortino helper"
  - "_rolling_sortino(returns, window, mar=MAR) — rolling annualized Sortino using qs.stats.sortino's exact downside RMS formula on a rolling window: roll_dstd = sqrt(neg_sq.rolling(window).sum() / window), where neg_sq[t] = x[t]^2 if x[t] < MAR else 0. At window == period this converges to qs.stats.sortino() within ε=1e-16 (parity gate)."
  - "_rolling_volatility(returns, window) — annualized rolling std * sqrt(252); mirrors qs.stats.volatility on a rolling window"
  - "_rolling_alpha(returns, benchmark, window=90) + _rolling_beta(returns, benchmark, window=90) — wrap qs.stats.rolling_greeks(window=90) and project the alpha/beta column from the returned DataFrame"
  - "_log_returns_series(returns) — np.log1p(returns) routed through _finalize_rolling for NaN/Inf scrubbing + cap_data_points size limit; same length as input (no window dropoff) per METRICS-12 contract"
  - "10 RED-then-GREEN unit tests in tests/test_metrics.py covering all 5 helpers + MAR constant + Pitfall 11 cross-check (window == 90, period == 90)"
affects:
  - "Plan 12-04 (daily_returns_grid + exposure/turnover series + 10 qstats scalars in metrics.py) — coexists; uses _finalize_rolling-style output shape established here"
  - "Plan 12-06 (MetricsResult dataclass + sibling-table loop upsert) — wires these 5 helpers into compute_all_metrics() emitting payloads keyed by StrategyAnalyticsSeriesKind"
  - "Plan 12-09 (parity tests + regen_golden) — golden_252d_expected.json must include rolling_sortino_3m/6m/12m, rolling_volatility_3m/6m/12m, rolling_alpha_90d, rolling_beta_90d, log_returns_series outputs from these helpers; the Pitfall 11 cross-check test in this plan is the in-Python parity gate, the parquet/JSON parity is the cross-runtime gate"
  - "Phase 14a/14b — UI rolling-charts on panels 4–7 (Risk vs Time + Vol vs Time + Alpha/Beta panels) read sibling-table payloads written from these helpers"

# Tech tracking
tech-stack:
  added: []  # No new libraries — quantstats, pandas, numpy already vendored
  patterns:
    - "MAR cross-runtime constant pattern (Pitfall 11): module-level scalar shared between qs.stats.sortino default and a custom rolling helper, with a parity test that asserts convergence at window == period"
    - "Rolling-helper math anchor: when a rolling helper must agree with a quantstats scalar, mirror the quantstats internal formula (e.g. RMS downside) on a rolling window — NOT pandas .rolling().std() which uses ddof=1 and subtracts the rolling mean"
    - "qs.stats.rolling_greeks DataFrame projection: returns a DataFrame with columns ['beta','alpha']; alpha/beta helpers select the column via greeks['alpha'] / greeks['beta'] and route through _finalize_rolling"

key-files:
  created: []
  modified:
    - "analytics-service/services/metrics.py — MAR constant (line 15) + 5 helpers inserted after _rolling_sharpe (lines 391-468): _rolling_sortino, _rolling_volatility, _rolling_alpha, _rolling_beta, _log_returns_series. Total +95 lines (6 lines for MAR block, 89 lines for helpers)."
    - "analytics-service/tests/test_metrics.py — 10 new test functions appended (lines 308-419) covering MAR constant, Sortino short-circuit, Sortino full-window finalized list, Pitfall 11 convergence cross-check, Volatility annualization + short-circuit, Alpha/Beta finalized list, Log returns full-length + value parity. Total +112 lines."

key-decisions:
  - "[Rule 1 / Rule 3 deviation] _rolling_sortino implementation uses qs.stats.sortino's exact RMS downside formula — neg_sq.rolling(window).sum() / window then sqrt — NOT pandas .rolling().std() on a zero-floored series as the plan's <action> code sketch suggested. The plan's sketch would have failed Pitfall 11's convergence test by ~0.17 (verified empirically) because pandas .rolling().std() uses ddof=1 and subtracts the rolling mean while qs.stats.sortino divides by N and treats the negative-returns RMS as mean-zero. Since Pitfall 11's whole purpose is cross-runtime math agreement, mirroring the QS internal math is the contract; mirroring _rolling_sharpe's pandas idiom is only a shape/file convention."
  - "[Rule 1 / Rule 3 deviation] Pitfall 11 cross-check test (Test 4) anchors to RESEARCH.md §11 verbatim mitigation ('90-day fixture, window == period') instead of the plan's golden_returns × window=252 setup. golden_returns is a 500-day series with an injected drawdown at days 200-250; full-period qs.stats.sortino is negative while rolling_sortino at window=252 captures only the post-drawdown tail, which is positive. They diverge by ~2.56 on the conftest fixture — never within the 0.05 tolerance the plan asserted. Verified the corrected test passes with diff < 1e-16 at window == period == 90."
  - "qs.stats.rolling_greeks DataFrame column-presence guard: the helper checks `if 'alpha' not in greeks` (or 'beta') and returns [] rather than raising, matching the existing _rolling_sharpe / _rolling_correlation defensive style. Confirmed via runtime probe that qs.stats.rolling_greeks returns columns ['beta', 'alpha'] (in that order) on the conftest golden_returns × benchmark_returns fixtures."
  - "_log_returns_series uses np.log1p (numerically stable for small returns) and routes through _finalize_rolling so NaN/Inf scrubbing + cap_data_points size limits apply. Output length == input length (no window dropoff) per METRICS-12 contract. Constructs a pd.Series wrapper with the original DatetimeIndex so _finalize_rolling can format the date column."

patterns-established:
  - "Rolling helper triplet: every new rolling helper added in Phase 12 follows the (a) `if len(returns) < window: return []` short-circuit, (b) vectorized rolling math, (c) `_finalize_rolling` terminus pattern. Future qstats-rolling additions (Plan 12-04) will mirror this."
  - "Parity-gate test placement: cross-runtime convergence tests sit in tests/test_metrics.py alongside the helper, anchored to a fixture where window == period so the rolling and scalar formulas operate on identical data. This is the in-Python half of the cross-runtime parity contract; the parquet/JSON half lands in Plan 12-09."
  - "Float rounding tolerance in tests: _finalize_rolling rounds to 4 decimals, so test assertions against an independently-computed expected value either round the expected to 4 decimals before comparison (1e-4 tolerance) or use a 1e-4 absolute tolerance. The 1e-9 tolerance the plan's code sketch used would have failed by precision rounding, not math drift."

requirements-completed: [METRICS-01, METRICS-02, METRICS-03, METRICS-12]

# Metrics
duration: 11m
completed: 2026-04-28
---

# Phase 12 Plan 03: Rolling Sortino/Vol/Greeks + Log Returns Helpers Summary

**Added MAR=0.0 module constant and 5 rolling-series helpers to analytics-service/services/metrics.py — _rolling_sortino (RMS downside formula matching qs.stats.sortino exactly, parity-tested at window==period), _rolling_volatility (std × sqrt(252)), _rolling_alpha + _rolling_beta (qs.stats.rolling_greeks(window=90) DataFrame projection), and _log_returns_series (np.log1p) — all routed through _finalize_rolling for NaN/Inf scrubbing + cap_data_points consistency.**

## Performance

- **Duration:** 11 min
- **Started:** 2026-04-28T12:17:42Z
- **Completed:** 2026-04-28T12:28:42Z
- **Tasks:** 2 (RED + GREEN)
- **Files modified:** 2

## Accomplishments

- MAR module-level constant (Pitfall 11 single source of truth) shared between `qs.stats.sortino` (default MAR=0) and the new `_rolling_sortino` helper
- 5 rolling-series helpers: Sortino, Volatility, Alpha, Beta, Log returns — all mirroring `_rolling_sharpe`'s shape (window guard + vectorized rolling + `_finalize_rolling` terminus)
- Math gate: `_rolling_sortino` at window == period agrees with `qs.stats.sortino` to within ε=1e-16 (verified on a 90-day fixture); the asserted tolerance is 0.05 with massive headroom
- 10 new RED-then-GREEN unit tests covering all 5 helpers + MAR constant + Pitfall 11 cross-check, all passing
- Full `tests/test_metrics.py` regression: 45/45 pass, 0 new warnings (the 13 RuntimeWarnings in `test_minimum_returns` predate this plan)
- Helpers NOT yet wired into `compute_all_metrics()` — that wiring lands in Plan 12-06 per the plan's `<done>` directive

## Task Commits

Each task was committed atomically (TDD gate sequence: RED → GREEN):

1. **Task 1: RED — failing tests for MAR + 5 rolling helpers** — `db7d64b` (test)
2. **Task 2: GREEN — implement MAR + 5 helpers** — `42e7408` (feat)

**Plan metadata commit:** added below alongside SUMMARY.md + STATE.md + ROADMAP.md updates.

## Files Created/Modified

- `analytics-service/services/metrics.py` — Added `MAR: float = 0.0` constant near top of file (line 15) with Pitfall 11 docstring; inserted `_rolling_sortino`, `_rolling_volatility`, `_rolling_alpha`, `_rolling_beta`, `_log_returns_series` between `_rolling_sharpe` (line 382) and `_rolling_correlation` (line 470). Each helper mirrors `_rolling_sharpe`'s shape (window guard, `_finalize_rolling` terminus); `_rolling_sortino` additionally mirrors `qs.stats.sortino`'s downside RMS math (NOT pandas `.rolling().std()`). +95 lines.
- `analytics-service/tests/test_metrics.py` — 10 new test functions appended after `TestComputeAllMetrics`. Covers: `MAR == 0.0`, `_rolling_sortino` short-circuit on empty, full-window finalized list shape, Pitfall 11 convergence at window==period==90 (anchored to RESEARCH.md §11 verbatim, NOT golden_returns × window=252 which would fail by design), `_rolling_volatility` annualization, `_rolling_volatility` short-circuit, `_rolling_alpha` + `_rolling_beta` finalized-list shape, `_log_returns_series` full-length + value parity. +112 lines.

## Decisions Made

- **`_rolling_sortino` math anchor: QS internal formula, not pandas `.rolling().std()`.** Pitfall 11's whole purpose is cross-runtime math agreement; the rolling helper must produce numerically identical output to `qs.stats.sortino` at window == period. `qs.stats.sortino` uses `sqrt(sum(x^2 where x<MAR else 0) / N)` — RMS divided by N, no mean-subtraction. Pandas `.rolling().std()` uses ddof=1 (divides by N-1) and subtracts the rolling mean. The two formulas diverge by ~0.17 even at window == period (verified empirically on a 90-day fixture). The plan's `<action>` code sketch and RESEARCH.md §5a both showed `.rolling().std()` for pedagogical brevity; the contract demands the QS math. Decision documented in the helper's docstring with a NOTE block explaining why `_rolling_sharpe`'s pandas idiom isn't reused for Sortino.

- **Pitfall 11 cross-check fixture: 90-day window == period, NOT 500-day golden_returns × window=252.** The plan's Test 4 used `golden_returns` (500 days, fixture has injected drawdown at days 200-250) with `window=252`; this captures only the post-drawdown tail, while `qs.stats.sortino` operates on the full 500-day series. They diverge by ~2.56 on the conftest fixture — never within 0.05 tolerance. RESEARCH.md §11 verbatim mitigation states *"90-day fixture, window == period"*; the test now constructs that fixture inline (numpy seed 11) so the rolling and scalar formulas operate on identical data. Confirmed convergence: diff = 1.11e-16.

- **`qs.stats.rolling_greeks` returns DataFrame with columns `["beta", "alpha"]`** (verified at runtime). The alpha/beta helpers project the column via `greeks["alpha"]` / `greeks["beta"]` and gate on column-presence (`if "alpha" not in greeks: return []`) matching `_rolling_sharpe`'s defensive style. Window default 90 trading days per UC#6 BTC-only scope.

- **`_log_returns_series` routes through `_finalize_rolling`** (not a bespoke formatter) so NaN/Inf scrubbing + `cap_data_points` size limit apply consistently with the other series helpers. Constructs `pd.Series(np.log1p(returns), index=returns.index)` so `_finalize_rolling` can format the date column. Output length equals input length per METRICS-12 contract (no window dropoff).

- **Test float-rounding tolerance: 1e-4, not 1e-9.** `_finalize_rolling` rounds values to 4 decimals; the plan's `<action>` test snippets used 1e-9 which would fail by precision-rounding alone, not math drift. Tests now compare to `round(float(expected), 4)` with 1e-4 tolerance, isolating math-drift failures from formatting noise.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] _rolling_sortino math formula switched from `pandas .rolling().std()` to QS-mirror RMS**
- **Found during:** Task 2 (GREEN implementation)
- **Issue:** The plan's `<action>` Sortino sketch (and RESEARCH.md §5a's "How to mirror for Sortino" snippet) used `returns.where(returns < mar, 0.0).rolling(window).std()` for the downside divisor. This formula uses `ddof=1` (divides by N-1) and subtracts the rolling mean, while `qs.stats.sortino` uses `sqrt(sum(x^2 where x<MAR else 0) / N)` — divides by N, no mean-subtraction. They diverge by ~0.17 even at window == period == 90 (empirically verified). Pitfall 11's entire purpose is cross-runtime math agreement; using a different downside formula in the rolling helper than in the scalar makes the parity test impossible to pass.
- **Fix:** Implemented `_rolling_sortino` using QS's exact internal formula:
  ```
  neg_sq = (returns.where(returns < mar, 0.0)) ** 2
  roll_dstd = (neg_sq.rolling(window).sum() / window) ** 0.5
  roll_mean = returns.rolling(window).mean()
  return _finalize_rolling((roll_mean / roll_dstd) * np.sqrt(252))
  ```
  Documented the WHY in the helper's docstring with a NOTE block explaining why the pandas `.rolling().std()` idiom is NOT reused for Sortino despite `_rolling_sharpe` using it.
- **Files modified:** analytics-service/services/metrics.py
- **Verification:** Pitfall 11 convergence test passes with diff = 1.11e-16 (asserted tolerance is 0.05 — massive headroom).
- **Committed in:** 42e7408 (Task 2 GREEN commit)

**2. [Rule 1 - Bug] Pitfall 11 cross-check test fixture switched from `golden_returns × window=252` to inline 90-day fixture × window=90**
- **Found during:** Task 1 (RED test authoring) — pre-flight math sanity check
- **Issue:** The plan's `<action>` Test 4 used `golden_returns` (500 days, conftest fixture with injected drawdown at days 200-250) with `window=252`, comparing the last rolling-window value to `qs.stats.sortino(golden_returns)`. The 500-day scalar covers the drawdown; the last 252-day window covers only the post-drawdown tail. They diverge by ~2.56 (empirically verified). Never within 0.05 tolerance on this fixture. The test would fail even with mathematically perfect helpers.
- **Fix:** Constructed an inline 90-day fixture (numpy seed 11) where `window == period == 90` so the rolling and scalar formulas operate on identical data. Per RESEARCH.md §11 verbatim mitigation: *"Pytest cross-check: assert abs(metrics["sortino"] - rolling_sortino_3m[-1]) < 0.05 on a 90-day fixture (last rolling window converges to scalar over the full period when window == period)."*  Also bumped the assertion `assert len(golden_returns) == 252` (also wrong in plan — conftest's golden_returns is 500 days) to `== 500` in `test_rolling_sortino_full_window`.
- **Files modified:** analytics-service/tests/test_metrics.py
- **Verification:** Convergence test passes with diff = 1.11e-16.
- **Committed in:** db7d64b (Task 1 RED commit)

**3. [Rule 1 - Bug] Test float-rounding tolerance bumped from 1e-9 to 1e-4 to match `_finalize_rolling`'s 4-decimal rounding**
- **Found during:** Task 1 (RED test authoring)
- **Issue:** The plan's `<action>` test snippets for `test_rolling_volatility_annualized` and `test_log_returns_series_values` used a 1e-9 absolute tolerance. `_finalize_rolling` rounds output values to 4 decimals via `round(float(v), 4)` (line 366), so any direct comparison to an unrounded `np.log1p` or `.std()` value will diverge by up to ~5e-5 — far above 1e-9. Tests would fail by precision-rounding alone, not by math drift.
- **Fix:** Compared to `round(float(expected), 4)` with 1e-4 tolerance, isolating math-drift failures from formatting noise.
- **Files modified:** analytics-service/tests/test_metrics.py
- **Verification:** Tests pass cleanly.
- **Committed in:** db7d64b (Task 1 RED commit)

---

**Total deviations:** 3 auto-fixed (2 math bugs in plan code sketches, 1 test-tolerance bug)
**Impact on plan:** All 3 fixes were correctness-preserving — the plan's intent (Pitfall 11 cross-runtime parity, finalized rounded output) is honored verbatim; only the implementation details were corrected to make that intent achievable. No scope creep — plan still ships exactly the 5 helpers + MAR constant + 10 tests as scoped, just with formulas that actually pass the contract. Recommend gsd-plan-checker flag the RESEARCH.md §5a Sortino snippet for an erratum (the snippet uses `pandas .rolling().std()` but Pitfall 11 requires the QS RMS formula — these are inconsistent) so future plans don't propagate the same bug.

## Issues Encountered

None during planned work — both TDD gates (RED → GREEN) hit cleanly on first run after the deviation fixes were applied. 13 pre-existing RuntimeWarnings in `tests/test_metrics.py::test_minimum_returns` (2-day fixture causes division-by-zero in numpy.cov inside quantstats) — these predate this plan and are out of scope per the executor's scope-boundary rule.

## TDD Gate Compliance

- **RED gate:** `db7d64b test(12-03): add failing tests ...` — failed at import with `ImportError: cannot import name 'MAR' from 'services.metrics'` (verified)
- **GREEN gate:** `42e7408 feat(12-03): implement MAR + rolling Sortino/Vol/Greeks + log returns (GREEN)` — all 10 tests pass, full test_metrics.py 45/45 pass
- **REFACTOR gate:** Skipped — code is already minimal and mirrors the existing `_rolling_sharpe` template; no cleanup needed.

## User Setup Required

None — purely internal Python helpers in analytics-service. No env vars, no DB migrations, no external services. Helpers are NOT yet called by `compute_all_metrics()` (that wiring lands in Plan 12-06), so deploying this plan to production is a no-op behavior change.

## Next Phase Readiness

- Plan 12-04 (Wave 4 — daily_returns_grid + exposure/turnover series + 10 qstats scalars) can proceed; the rolling-helper triplet pattern (`if len < window: return []` → vectorized rolling → `_finalize_rolling`) is now established for the new scalars + series to mirror.
- Plan 12-06 (Wave 6 — wire helpers into `compute_all_metrics()` + sibling-table loop upsert) can call all 5 helpers as scoped: `_rolling_sortino(returns, 63)`, `(returns, 126)`, `(returns, 252)`, `_rolling_volatility(returns, 63)`, etc., emitting payloads keyed by the D-16 frozen `StrategyAnalyticsSeriesKind` union.
- Plan 12-09 (Wave 9 — parity tests) golden_252d_expected.json regeneration must include the outputs of these 5 helpers; the in-Python Pitfall 11 convergence test in this plan is the math gate, the parquet/JSON byte-stable parity is the cross-runtime gate.

## Self-Check

Verified before SUMMARY.md was written.

```
$ grep -n "^MAR\|def _rolling_sortino\|def _rolling_volatility\|def _rolling_alpha\|def _rolling_beta\|def _log_returns_series\|Pitfall 11\|rolling_greeks" analytics-service/services/metrics.py
10:# Phase 12 / Pitfall 11: minimum acceptable return for Sortino.
15:MAR: float = 0.0
391:def _rolling_sortino(returns: pd.Series, window: int, mar: float = MAR) -> list[dict[str, Any]]:
394:    Pitfall 11 single source of truth ...
423:def _rolling_volatility(returns: pd.Series, window: int) -> list[dict[str, Any]]:
434:def _rolling_alpha(returns: pd.Series, benchmark: pd.Series, window: int = 90) -> list[dict[str, Any]]:
443:    greeks = qs.stats.rolling_greeks(returns, benchmark, window)
449:def _rolling_beta(returns: pd.Series, benchmark: pd.Series, window: int = 90) -> list[dict[str, Any]]:
453:    greeks = qs.stats.rolling_greeks(returns, benchmark, window)
459:def _log_returns_series(returns: pd.Series) -> list[dict[str, Any]]:
```
All 8 acceptance grep markers present.

```
$ git log --oneline -3 | head
42e7408 feat(12-03): implement MAR + rolling Sortino/Vol/Greeks + log returns (GREEN)
db7d64b test(12-03): add failing tests for MAR + rolling Sortino/Vol/Greeks + log returns (RED)
dab9fd9 docs(12-02): complete migrations 086 + 087 + frozen TS contracts plan
```
Both task commits exist (RED then GREEN, in order).

```
$ pytest tests/test_metrics.py -k "rolling_sortino or rolling_volatility or rolling_alpha or rolling_beta or log_returns_series or mar_constant" -x
10 passed
```

## Self-Check: PASSED

---
*Phase: 12-backend-metric-contracts*
*Completed: 2026-04-28*
