---
phase: 12-backend-metric-contracts
plan: 04
subsystem: analytics
tags: [python, quantstats, pandas, metrics, exposure, turnover, qstats-scalars, daily-returns-grid, sibling-table, tdd]

# Dependency graph
requires:
  - phase: 12-02
    provides: "Migration 087 (strategy_analytics_series sibling table) + frozen TS contract for sibling kinds (D-01: 12 kinds including daily_returns_grid, exposure_series, turnover_series)"
  - phase: 12-03
    provides: "MAR module constant + 5 rolling helpers (_rolling_sortino, _rolling_volatility, _rolling_alpha, _rolling_beta, _log_returns_series); existing try/except qstats pattern at metrics.py:97-138"
provides:
  - "_daily_returns_grid_from_series: flat per-day list helper for sibling-table kind 'daily_returns_grid' (METRICS-04, D-03)"
  - "compute_qstats_scalars: 10 new qstats one-liners with try/except fail-soft (METRICS-11)"
  - "compute_exposure_metrics now persists per-date exposure_series alongside aggregates (METRICS-05)"
  - "compute_turnover_series with explicit Pitfall #19 docstring + zero-NAV short-circuit (METRICS-06)"
affects: [12-06 (orchestrator wiring), 12-09 (sibling-table 12-kind parity test), 14a (eager panels), 14b (lazy panels — Trade Mix + Exposure)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Heavy series flat per-date shape [{date, value}] — matches every sibling-table kind (D-03)"
    - "qstats scalars wrapped in per-call try/except — single qs failure doesn't tank whole metrics computation (mirrors metrics.py:97-138)"
    - "Refactor-and-emit: compute_exposure_metrics keeps existing aggregate keys AND adds exposure_series in same loop iteration"
    - "Threat T-12-04-02 mitigation pattern: explicit `if nav <= 0` short-circuit in turnover series prevents ZeroDivisionError"

key-files:
  created:
    - ".planning/phases/12-backend-metric-contracts/deferred-items.md (logged pre-existing test_drain_100_jobs failure)"
  modified:
    - "analytics-service/services/metrics.py (+96 lines: _daily_returns_grid_from_series, compute_qstats_scalars)"
    - "analytics-service/services/position_reconstruction.py (+65 lines / -1: compute_exposure_metrics refactor + compute_turnover_series)"
    - "analytics-service/tests/test_metrics.py (+66 lines: 5 RED-then-GREEN tests)"
    - "analytics-service/tests/test_position_reconstruction.py (+147 lines: 6 RED-then-GREEN tests)"

key-decisions:
  - "Adapted RED test fixtures to use established mock-based pattern (Rule 3 — plan referenced supabase_test_client + fixture_strategy_with_positions which don't exist in conftest); preserves test intent while matching existing test_position_reconstruction_edges.py conventions"
  - "All qstats scalars routed through _safe_float (consistent NaN/Inf scrubbing) instead of raw float() per the plan sketch — picks up sanitization for free (Rule 2: missing critical safety)"
  - "Added test_qstats_scalars guards both `len(benchmark) > 0` and `is not None` for r_squared (defensive on empty Series, not just None)"
  - "Added empty-input test for _daily_returns_grid_from_series to lock graceful behavior (matches plan's behavior contract, augments stated test coverage)"
  - "Added zero-NAV and multi-symbol tests for compute_turnover_series to lock T-12-04-02 mitigation and the abs-sum-across-symbols semantics"

patterns-established:
  - "Sibling-table kind shape = flat list [{date, value}] for every series kind — daily_returns_grid follows the same shape as exposure_series and turnover_series, simplifying Phase 14b client-side reshaping"
  - "Per-call try/except scales to 10 distinct qstats functions without nested fallthrough — readable, fail-soft, preserves all keys"
  - "compute_exposure_metrics teaches the refactor pattern for METRICS-* helpers: emit new key in same loop, preserve every existing key, no new return type"

requirements-completed: [METRICS-04, METRICS-05, METRICS-06, METRICS-11]

# Metrics
duration: 6min
completed: 2026-04-28
---

# Phase 12 Plan 04: Daily Grid + Exposure Series + Turnover Series + 10 qstats Scalars Summary

**Daily returns grid (D-03 flat list) + 10 qstats scalars (Recovery Factor through Time-in-Market) added to metrics.py; compute_exposure_metrics refactored to also emit exposure_series; new compute_turnover_series with explicit Pitfall #19 docstring**

## Performance

- **Duration:** 6 min (327 seconds)
- **Started:** 2026-04-28T12:57:05Z
- **Completed:** 2026-04-28T13:02:32Z
- **Tasks:** 2 (TDD: 4 commits — 2 RED + 2 GREEN)
- **Files modified:** 4 (2 services, 2 tests)

## Accomplishments

- METRICS-04 lands: `_daily_returns_grid_from_series` mirrors `_monthly_returns_grid_from_series` template at metrics.py:351 with the per-date flat shape mandated by D-03 (sibling-table storage decision); rounds to 6 decimals matching the monthly grid template.
- METRICS-11 lands: `compute_qstats_scalars` adds all 10 missing scalars (recovery_factor, ulcer_index, upi, kelly_criterion, probabilistic_sharpe_ratio, common_sense_ratio, cpc_index, serenity_index, r_squared, time_in_market) — each in its own try/except with `_safe_float` for NaN/Inf scrubbing; r_squared guards on `benchmark is not None and len(benchmark) > 0`.
- METRICS-05 lands: `compute_exposure_metrics` refactored to also emit `exposure_series: [{date, gross, net}]` alongside the existing 6 aggregate keys; per-date arrays at lines 461-487 now persist instead of being aggregated and discarded; no caller breakage in `analytics_runner.py`.
- METRICS-06 lands: `compute_turnover_series` shipped with explicit Pitfall #19 docstring contract (`turnover = sum_over_symbols(abs(delta * price)) / nav`); T-12-04-02 mitigation via `if nav <= 0: turnover = 0.0` short-circuit; multi-symbol abs-sum.
- 11 new tests pass (RED-then-GREEN); 88 tests pass across position_reconstruction + metrics + analytics_runner suites; full analytics-service suite 570 pass / 1 pre-existing failure (out of scope, logged to deferred-items.md).

## Task Commits

Each task was committed atomically (TDD RED-then-GREEN):

1. **Task 1 RED: failing tests for daily grid + qstats scalars** — `f0c23c0` (test)
2. **Task 1 GREEN: implement daily_returns_grid + 10 qstats scalars** — `a9c7727` (feat)
3. **Task 2 RED: failing tests for exposure_series + turnover_series** — `692c16e` (test)
4. **Task 2 GREEN: persist exposure_series + add compute_turnover_series** — `8ffbb1e` (feat)

## Files Created/Modified

- `analytics-service/services/metrics.py` — `+96 lines`: added `_daily_returns_grid_from_series` (flat per-day list mirroring monthly grid template; rounds to 6 decimals; empty-input → []) and `compute_qstats_scalars` (10 try/except scalars routed through `_safe_float`; `r_squared` returns None when benchmark missing).
- `analytics-service/services/position_reconstruction.py` — `+65 / -1`: refactored `compute_exposure_metrics` to also emit `exposure_series: [{date, gross, net}]` (per-date arrays previously discarded); added `compute_turnover_series` (Pitfall #19 docstring contract; T-12-04-02 zero-NAV short-circuit; multi-symbol abs-sum across union of position symbols).
- `analytics-service/tests/test_metrics.py` — `+66 lines`: 5 new tests covering grid full-length, 6-decimal rounding, empty input, complete 10-key set, missing-benchmark graceful handling.
- `analytics-service/tests/test_position_reconstruction.py` — `+147 lines`: 6 new tests covering exposure_series presence + per-date values + empty input, turnover contract (Δ=1, P=100, NAV=10000 → 0.01), zero-NAV short-circuit, multi-symbol abs-sum (Δ_BTC×P_BTC + Δ_ETH×P_ETH = 350 / 10000 = 0.035).
- `.planning/phases/12-backend-metric-contracts/deferred-items.md` — `+9 lines` (gitignored): logged pre-existing `test_drain_100_jobs` failure.

## Decisions Made

- **Test-fixture adaptation (Rule 3 deviation, see below)**: Plan's RED tests for METRICS-05 referenced `supabase_test_client` and `fixture_strategy_with_positions` fixtures that do not exist in `analytics-service/tests/conftest.py`. Instead of inventing new fixtures, I adapted the tests to the established mock-based pattern from `test_position_reconstruction_edges.py` (`_make_snapshots_mock` + `_run_sync` patcher). Preserves test intent; matches conventions; no new infra burden.
- **`_safe_float` for qstats scalars (Rule 2 — additive safety)**: Plan sketch used raw `float(...)` casts. Switched to `_safe_float` so NaN/Inf are auto-scrubbed to `None` (consistent with the rest of metrics.py). The test `assert val is None or isinstance(val, (int, float))` still passes because `None` is allowed; `numpy.float64` is a `float` subclass, so type assertion holds.
- **`r_squared` empty-benchmark guard**: added `len(benchmark) > 0` alongside `is not None` check. Defends against an empty pd.Series being passed (would otherwise hit qs.stats.r_squared and raise inside the try, masking the cause).
- **Extra coverage tests**: added `test_daily_returns_grid_empty_input`, `test_turnover_series_zero_nav_short_circuit`, `test_turnover_series_multi_symbol`, `test_exposure_metrics_empty_when_no_snapshots` beyond the plan's stated tests. These lock the threat-model mitigations (T-12-04-02) and documented graceful behaviors.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Adapted RED test fixtures to existing mock pattern**

- **Found during:** Task 2 RED (`test_exposure_metrics_includes_series`)
- **Issue:** Plan's RED test referenced fixtures `supabase_test_client` and `fixture_strategy_with_positions` that do not exist in `analytics-service/tests/conftest.py`. Adding new fixtures was out of scope for Plan 12-04 (they would be DB-integration fixtures, but the rest of the file mocks supabase via MagicMock).
- **Fix:** Used `_make_exposure_snapshots_mock` (mirrors `_make_snapshots_mock` in `test_position_reconstruction_edges.py`) plus the existing `_run_sync` `db_execute` patcher. Tests assert per-date exposure values (Day 1: gross=800, net=200; Day 2: gross=1000, net=200) instead of just structural shape — stronger than the plan's RED tests.
- **Files modified:** `analytics-service/tests/test_position_reconstruction.py`
- **Verification:** All 6 new tests pass GREEN; full position_reconstruction + edges + funding suites pass with no regressions (88 tests pass across position_reconstruction + metrics + analytics_runner).
- **Committed in:** `692c16e` (Task 2 RED)

**2. [Rule 2 - Missing Critical] Routed qstats scalars through `_safe_float`**

- **Found during:** Task 1 GREEN (writing `compute_qstats_scalars`)
- **Issue:** Plan sketch used raw `float(qs.stats.recovery_factor(returns))` casts. quantstats can return `nan` / `inf` for degenerate inputs (constant returns, no losses, etc.). The rest of metrics.py routes every quantity through `_safe_float`, so the new scalars MUST also do this for consistency — otherwise the JSONB upsert path could store NaN values that break JSON serialization downstream.
- **Fix:** Wrapped each `qs.stats.{name}(...)` call in `_safe_float(...)`. This matches the existing pattern at metrics.py:97-163.
- **Files modified:** `analytics-service/services/metrics.py`
- **Verification:** All 5 qstats tests pass; `assert val is None or isinstance(val, (int, float))` holds (None for NaN/Inf, float for valid numbers).
- **Committed in:** `a9c7727` (Task 1 GREEN)

**3. [Rule 2 - Missing Critical] Added `len(benchmark) > 0` guard for r_squared**

- **Found during:** Task 1 GREEN
- **Issue:** Plan sketch only guarded `if benchmark is not None`. An empty pd.Series passes `is not None` but would still raise inside `qs.stats.r_squared`, masking the cause.
- **Fix:** Added `and len(benchmark) > 0` to the guard.
- **Files modified:** `analytics-service/services/metrics.py`
- **Verification:** `test_qstats_scalars_handle_missing_benchmark` passes with `r_squared = None` when benchmark is `None`.
- **Committed in:** `a9c7727` (Task 1 GREEN)

---

**Total deviations:** 3 auto-fixed (1 blocking test-infra, 2 missing critical safety)
**Impact on plan:** All deviations strengthen the implementation. No scope creep — every fix lands inside the same files the plan listed.

## Issues Encountered

- **Pre-existing test failure (out of scope):** `tests/test_worker_load.py::TestWorkerLoadDrain::test_drain_100_jobs` fails on `feature/v0.17-sprint-12` BEFORE Plan 12-04's edits. Verified via `git stash`. Likely related to Plan 12-07's priority-aware claim refactor changing the dispatch shape that the mock expects. Logged to `.planning/phases/12-backend-metric-contracts/deferred-items.md` for triage in Plan 12-09 or v0.17.1. Per the SCOPE BOUNDARY rule, did not attempt to fix.

## Verification

```bash
$ cd analytics-service && python3 -m pytest tests/test_metrics.py -k "daily_returns_grid or qstats_scalars" -x
5 passed in 1.08s

$ cd analytics-service && python3 -m pytest tests/test_position_reconstruction.py -k "exposure_metrics_includes_series or turnover_series or exposure_metrics_empty_when_no_snapshots" -x
6 passed in 0.48s

$ cd analytics-service && python3 -m pytest tests/test_metrics.py tests/test_position_reconstruction.py tests/test_position_reconstruction_edges.py tests/test_position_reconstruction_funding.py tests/test_analytics_runner.py
88 passed in 1.92s

$ cd analytics-service && python3 -m pytest tests/
570 passed, 5 skipped, 1 failed (pre-existing test_drain_100_jobs — unrelated, logged in deferred-items.md)
```

## Acceptance Criteria

| Plan AC | Status |
|---------|--------|
| `grep -q "def _daily_returns_grid_from_series" analytics-service/services/metrics.py` | OK |
| `grep -q "def compute_qstats_scalars" analytics-service/services/metrics.py` | OK |
| All 10 qstats keys present in metrics.py | OK (recovery_factor, ulcer_index, upi, kelly_criterion, probabilistic_sharpe_ratio, common_sense_ratio, cpc_index, serenity_index, r_squared, time_in_market) |
| `grep -q "exposure_series" analytics-service/services/position_reconstruction.py` | OK |
| `grep -q "def compute_turnover_series" analytics-service/services/position_reconstruction.py` | OK |
| `grep -q "Pitfall #19" analytics-service/services/position_reconstruction.py` | OK |
| `grep -q "abs(delta \* price)" analytics-service/services/position_reconstruction.py` | OK |
| Existing `compute_exposure_metrics` callers in `analytics_runner.py` still work | OK (test_analytics_runner.py 13/13 pass) |
| All new unit tests pass | OK (11/11 — 5 metrics, 6 position_reconstruction) |

## TDD Gate Compliance

Plan-level type: `tdd`. Both tasks followed RED → GREEN cycle:

- **Task 1**: `f0c23c0` (RED test commit) → `a9c7727` (GREEN feat commit). RED confirmed via `ImportError`.
- **Task 2**: `692c16e` (RED test commit) → `8ffbb1e` (GREEN feat commit). RED confirmed via `ImportError`.

REFACTOR phase not needed — the GREEN implementations are minimal and idiomatic (mirror existing patterns at metrics.py:351 and position_reconstruction.py:435).

## Threat Surface Scan

Threat-model items in the plan all have on-code mitigations:

- **T-12-04-01 (qstats scalar drift)** — mitigated: each scalar in try/except; pinned `quantstats==0.0.81`. Parity gate (Plan 12-09) will assert ε on the JSON contract.
- **T-12-04-02 (zero/negative NAV)** — mitigated: explicit `if nav <= 0` short-circuit at `compute_turnover_series` line 530, with regression test `test_turnover_series_zero_nav_short_circuit` locking the behavior.
- **T-12-04-03 (per-date exposure exposure)** — accepted: `exposure_series` adds zoom level only; entity boundary unchanged; `strategy_analytics_series` RLS gates the row.

No new threat flags introduced.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 12-05 (trade aggregations) can proceed.
- Plan 12-06 (orchestrator wiring) now has all 4 helpers needed: `_daily_returns_grid_from_series`, `compute_qstats_scalars`, `compute_exposure_metrics` (refactored to emit exposure_series), `compute_turnover_series`. The orchestrator will call these in `compute_all_metrics` (sibling kinds path) and route the heavy ones to the sibling table per D-01.
- Plan 12-09 (sibling-table 12-kind parity test) is unblocked — `daily_returns_grid`, `exposure_series`, `turnover_series` are now ALL produced; combined with the 5 rolling helpers from 12-03 and `_log_returns_series` (also from 12-03), 9 of 12 sibling kinds are now produced. The remaining 3 are the 3M/6M/12M variants of `_rolling_volatility` and the 3 `_rolling_sortino` variants — all driven by the existing 12-03 helpers via window-arg variation in 12-06's orchestrator wiring.

## Self-Check: PASSED

Verified post-write:

```bash
$ [ -f "analytics-service/services/metrics.py" ] && grep -q "_daily_returns_grid_from_series\|compute_qstats_scalars" analytics-service/services/metrics.py && echo OK
OK

$ [ -f "analytics-service/services/position_reconstruction.py" ] && grep -q "exposure_series\|compute_turnover_series\|Pitfall #19" analytics-service/services/position_reconstruction.py && echo OK
OK

$ git log --oneline -5 | grep -E "^(f0c23c0|a9c7727|692c16e|8ffbb1e)"
8ffbb1e feat(12-04): persist exposure_series + add compute_turnover_series (GREEN)
692c16e test(12-04): add failing tests for exposure series + turnover series (RED)
a9c7727 feat(12-04): implement daily_returns_grid + 10 qstats scalars (GREEN)
f0c23c0 test(12-04): add failing tests for daily grid + qstats scalars (RED)
```

All commits exist; all acceptance criteria pass; no out-of-scope work performed.

---
*Phase: 12-backend-metric-contracts*
*Completed: 2026-04-28*
