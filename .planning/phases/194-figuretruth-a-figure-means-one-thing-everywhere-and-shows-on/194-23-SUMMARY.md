---
phase: 194-figuretruth-a-figure-means-one-thing-everywhere-and-shows-on
plan: 23
subsystem: analytics-producer, factsheet-engine
tags: [rolling-window, d-14, trust-05, shared-fixture, closed-form-oracle]
requires: ["194-03", "194-13"]
provides:
  - "ROLLING_1Y_WINDOW_DAYS, _rolling_calendar_stats, _finalize_rolling_calendar (metrics.py)"
  - "rolling_metrics keys volatility_1y / sharpe_1y / sortino_1y"
  - "ROLL_WINDOW_1Y_DAYS, rollingCalendarStats (rolling.ts)"
  - "analytics-service/tests/fixtures/rolling_1y_vectors.json"
affects: ["194-14", "194-15", "194-17", "194-21", "194-24", "194-09"]
tech-stack:
  added: []
  patterns: ["shared closed-form JSON fixture read by pytest and vitest", "text-read pin of a Python constant from vitest"]
key-files:
  created:
    - analytics-service/tests/fixtures/rolling_1y_vectors.json
    - analytics-service/tests/test_rolling_1y.py
    - src/lib/factsheet/rolling-calendar.test.ts
  modified:
    - analytics-service/services/metrics.py
    - analytics-service/tests/fixtures/golden_252d_expected.json
    - src/lib/factsheet/rolling.ts
key-decisions:
  - "A-194-D14-01: the browser draws the TS twin; the stored keys are the producer's canonical record (D-01) with no Phase 194 reader."
  - "A-194-D14-02: the 365-day window uses the producer's sample standard deviation (ddof 1); factsheet row windows stay on ddof 0."
  - "A-194-D14-03: stored in rolling_metrics, not new sibling kinds, so the 12-kind sibling census does not move."
status: complete
commits: 1
plan_head_before: e795d76269efcaad31e3bac7a6d713878794336a
plan_head_after: 43464526fbfe32a1e161d10897e9c1378d835c7b
actuals:
  tokens: 21000
  tasks: 3
  commits: 1
---

# Phase 194 Plan 23: the 365-calendar-day rolling window Summary

D-14's 365-calendar-day window now exists in the analytics producer (stored as `volatility_1y`, `sharpe_1y`, `sortino_1y` in `rolling_metrics`) and in the browser engine (`rollingCalendarStats`), proven equal within 1e-12 on one closed-form fixture that pytest and vitest both read.

## What was built

- `ROLLING_1Y_WINDOW_DAYS = ONE_YEAR_DAYS` and `_rolling_calendar_stats(returns, window_days, periods_per_year)` in `metrics.py`: a pandas time-based window (`rolling("365D")`, right-closed, so returns dated after t minus 365 days through t), masked to NaN until t is 365 days after the series' first date. Sample std (ddof 1); Sharpe is NaN when the std does not clear `_residue_floor`; Sortino divides the downside sum by the window's own count and is NaN with no return below MAR; a residue std reads exactly 0 for volatility (as the TS `dispersion` does).
- `_finalize_rolling_calendar` cuts the warmup rows before `_finalize_rolling`, so a record under a year stores `[]` without the "dropped 100%" WARNING and the drop-ratio WARNING speaks only of windows with no ratio.
- `compute_all_metrics` stores the three keys: Sharpe over `_rolling_basis`, volatility and Sortino over `returns`. No existing key, sibling kind or row-window helper was touched.
- `rolling.ts`: `ROLL_WINDOW_1Y_DAYS` and `rollingCalendarStats(rets, dates, windowDays, periodsPerYear)` (index-aligned with `rets`, null where no point), using `spanDays`, `dispersion` and `sharpe` with `ddof: 1`. Non-finite returns are skipped inside a window, matching pandas skipna.
- Fixture `rolling_1y_vectors.json`: five vectors (`daily-alternating-400`, `daily-constant-400`, `daily-300`, `daily-gap`, `weekday-alternating`) with derivation text beside the expected arrays.
- Golden file: three empty lists added to `rolling_metrics` (the 252-day golden spans under a year); nothing else changed.

## Closed-form generator (kept out of the repo; standard library only)

The generator is quoted here. It imports neither `metrics.py` nor `rolling.ts`. Window membership is counted with `datetime.date` arithmetic; the daily case is cross-checked against the pure closed form for n = 365.

```
n = window count; p = count of +A, q = count of -A (constant vector: all c)
mean = A (p - q) / n ; sumsq = n A^2 ; var = (sumsq - n mean^2) / (n - 1)
vol = sqrt(var) * sqrt(ppy)
sharpe = mean / sqrt(var) * sqrt(ppy)          (no point if sqrt(var) <= 1e-12 * max(1, |mean|))
sortino = mean / sqrt(q A^2 / n) * sqrt(ppy)   (no point if q == 0)
window at t = dates d with t - 365 days < d <= t ; point exists iff (t - dates[0]).days >= 365
```

Daily window starting on a +A index: p = 183, q = 182; starting on a -A index: p = 182, q = 183.

## Neuter, RED, restore (byte backups via cp -p, GREEN seen again after each)

(a) `rolling.ts` vol on `dispersion(w, 0)` (population std): vitest RED, 3 failed | 4 passed:
`AssertionError: expected 0.1910490147250102 to be close to 0.1913112646970899, received difference is 0.0002622499720796867, but expected 5e-13` (daily-alternating-400; daily-gap and weekday-alternating also RED).

(b) `metrics.py` mask admitting t one day early (`window_days - 1`): pytest RED, first-point case named, e.g. `FAILED tests/test_rolling_1y.py::test_helper_matches_closed_form[vol-daily-alternating-400]` (also the sharpe, sortino, gap and weekday cases and the daily-constant-400 vol case).

(c) `rolling.ts` window keeping returns dated exactly t minus 365 days (`> windowDays` instead of `>=`): vitest RED, 3 failed | 4 passed:
`AssertionError: expected +0 to be close to -0.05227083734893167, received difference is 0.05227083734893167, but expected 5e-13` (daily-alternating-400; daily-gap and weekday-alternating also RED).

(d) Task 2, `sharpe_1y` computed on `returns` instead of `_rolling_basis`: active-basis case RED:
`E       assert -0.0641 == -0.07846001417576971 ± 1.0e-04` (`FAILED tests/test_rolling_1y.py::test_active_basis_sharpe_rides_nonzero_days_vol_and_sortino_ride_returns`).

All four restored from byte backups; `test_rolling_1y.py` 24 passed and `rolling-calendar.test.ts` 7 passed afterwards.

## Verification

- `pytest tests/test_rolling_1y.py tests/test_metrics.py tests/test_metrics_parity.py`: 333 passed.
- Full `pytest` from `analytics-service/`: `1 failed, 14445 passed, 101 skipped`; the one failure is the known pre-existing `test_xdist_group_is_real.py::test_shared_db_group_runs_on_one_worker_with_the_group_suffix` (pytest-xdist not installed). The 101 skips are the suite's existing skips, none added here.
- mypy strict (CI command): `Success: no issues found in 132 source files`.
- `vitest run src/lib/factsheet src/lib/figure-gate.d11.test.ts`: 1465 passed, 2 failed, both the known pre-existing `compute.conventions.test.ts` inline-snapshot failures (fixtures B and C).
- `npm run typecheck`: clean. `eslint` on the two touched TS files: clean. `npm run lint`: 0 errors; 2 pre-existing unused-var warnings in `MetricsColumn.tsx` and `composite-read-path.ts`, not touched here.
- No existing rolling output moved: `sharpe_30d`, `sharpe_90d`, `sharpe_365d` equal the golden file's values (asserted in `test_golden_input_spans_under_a_year_...`), and `test_metrics_parity_full` passes with the three new empty keys in the golden.

## A-194-D14 assumptions

- A-194-D14-01 (consumer, stated not hidden): Phase 194's rolling charts (factsheet charts and rail, Scenario) are computed in the browser from the stored daily returns, so they draw the TS twin (plans 14, 15, 17, 21, 24). The stored keys are the producer's canonical record; plan 09's recompute writes them on PROD, and `/strategy/[id]/v2` can read them with no migration (`rolling_metrics` is already selected and typed `Record<string, ...>`). Reading stored series into the factsheet at full history was considered and not planned.
- A-194-D14-02: sample standard deviation (ddof 1), because the producer is canonical (D-01). **Residual for `[194-ENGINE-CONSTANTS]` (plan 09's fallback or the phase close carries it):** the factsheet's row windows (`rollingVol`, `rollingSharpe`) stay on the population standard deviation (ddof 0), the 365-day window is on ddof 1. Not silently changed.
- A-194-D14-03: stored in `rolling_metrics`, not new sibling kinds, so `SIBLING_KINDS`, Python's sibling count and the lazy-metrics RPC map do not move. The row grows by three capped series (`cap_data_points` via `_finalize_rolling`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Tasks 1, 2 and 3 landed in one commit**
- **Found during:** Task 1 commit
- **Issue:** the tracer's pytest reads the stored `rolling_metrics` keys, and the golden-file test needs the three empty golden keys, so the `compute_all_metrics` wiring and the golden edit could not be split from the tracer without leaving a red tree at the Task 1 commit.
- **Fix:** one commit carries the fixture, both helpers, both readers, the wiring and the golden keys.
- **Files modified:** all plan files.

**2. [Rule 2 - Correctness] Warmup cut before finalizing; residue std zeroed for volatility**
- `_finalize_rolling_calendar` cuts the NaN warmup rows so the `_finalize_rolling` drop-ratio WARNING is not emitted for every record under a year (plan said "each through `_finalize_rolling`"; it still is, over the post-warmup rows).
- The helper reads a residue std as exactly 0 for volatility, matching the TS `dispersion`, so the constant vector is 0 in both languages rather than about 1e-9 from pandas' online variance.

**3. [Plan wording] `test_metrics.py` was not edited**
- No test there pins the exact `rolling_metrics` key set, and the zero-dispersion loop (`mj["rolling_metrics"].items()`) passed unchanged with `sharpe_1y` empty. The plan's contingent edit did not apply.

**4. [Plan wording] Golden diff**
- The golden diff adds exactly the three empty keys (`volatility_1y`, `sharpe_1y`, `sortino_1y`).

## Known Stubs

None.

## Threat Flags

None. The only new stored surface is the three derived series the plan's threat model already covers (T-194-44 mitigated by the shared fixture and four RED proofs; T-194-45 mitigated by `_finalize_rolling` and `cap_data_points`).

## Known pre-existing failures observed

- `src/lib/factsheet/compute.conventions.test.ts` fixtures B and C (2 failures), unchanged by this plan.

## Self-Check: PASSED

- FOUND: analytics-service/tests/fixtures/rolling_1y_vectors.json, analytics-service/tests/test_rolling_1y.py, src/lib/factsheet/rolling-calendar.test.ts
- FOUND: commit 43464526f (feat(194-23)) is an ancestor of HEAD; `git rev-list --count` from the recorded base is 1
