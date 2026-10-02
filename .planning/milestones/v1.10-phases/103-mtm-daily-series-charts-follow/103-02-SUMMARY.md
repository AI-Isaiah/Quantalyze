---
phase: 103-mtm-daily-series-charts-follow
plan: 02
subsystem: analytics
tags: [python, mtm, dailies-canonical, basis-series, job-worker, single-key, composite, anti-divergence, heal, SC-4]

# Dependency graph
requires:
  - phase: 103-01
    provides: services/basis_series.py::derive_basis_series + persist_basis_series (the shared dailies-canonical derive/heal the two seams now call)
provides:
  - single-key broker derive (run_derive_broker_dailies_job) routes the mark_to_market second pass through derive_basis_series + persist_basis_series (series row + scalar cache from ONE result)
  - composite stitch (run_stitch_composite_job) routes the stitched-MTM basis through the SAME shared helper — the bespoke _metrics_result_for(clipped_mtm) compute is GONE (grep gate = 0)
  - heal-on-every-terminal-shape: degrade / gated / not-attempted MTM derives delete any stale mtm_daily_returns row (Pitfall 5), mirroring the authoritative metrics_json_by_basis NULL write
affects: [103-03/103-04 (frontend per-basis bundle + charts read the persisted mtm_daily_returns rows), 104-106 (backbone adopts the helper for cash)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Both MTM derive sites call the ONE shared route: scalars are a cache of the SAME BasisSeriesResult the series row persists — anti-divergence true by construction"
    - "Persist/heal matrix mirrors the authoritative metrics_json_by_basis write: success -> row; degrade/gated/not-attempted -> delete stale row"
    - "Sync persist_basis_series wrapped in db_execute, fail-loud on the prestamp idiom (cash writes land first/independent)"

key-files:
  created:
    - .planning/phases/103-mtm-daily-series-charts-follow/103-02-SUMMARY.md
  modified:
    - analytics-service/services/job_worker.py
    - analytics-service/tests/test_mtm_single_key.py
    - analytics-service/tests/test_stitch_composite_job.py

key-decisions:
  - "Single-key: the compute now lives INSIDE derive_basis_series, which binds compute_all_metrics via from-import — the two existing compute-patch tests were retargeted to services.basis_series.compute_all_metrics (patching services.metrics would miss the helper's bound name)"
  - "Composite: _metrics_result_for stays cash-only (SC-4); MTM stitch stays INSIDE the existing try so CompositeOverlapError/ValueError permanent arms are untouched; persist lands in the persist phase AFTER csv + headline writes so a failed stitch never half-persists"
  - "Heal is UNCONDITIONAL (mirrors the by-basis SQL NULL): every non-success single-key derive and every gated/degraded composite deletes the stale series row"

requirements-completed: [MTM-04]

# Metrics
duration: ~75min
completed: 2026-07-12
---

# Phase 103 Plan 02: Wire both MTM derive sites to the shared basis_series route Summary

**Both MTM derive sites — single-key (`job_worker.py` `run_derive_broker_dailies_job`) and composite (`run_stitch_composite_job`) — now produce their `mark_to_market` scalars AND persist the `mtm_daily_returns` series row from the ONE shared `derive_basis_series` / `persist_basis_series` call (Plan 103-01), retiring the throwaway `_metrics_result_for(clipped_mtm)` compute (grep gate = 0), with a heal-on-every-terminal-shape matrix and byte-identical cash paths (SC-4).**

## Performance
- **Duration:** ~75 min
- **Tasks:** 3 (single-key seam, composite seam, full-suite + cash byte-identity sweep)
- **Files modified:** 3 (job_worker.py + 2 worker test files)
- **Commits:** 2 feat commits (Task 3 is a verification sweep — no code change needed, coverage already ≥80)

## Accomplishments
- **Single-key seam** (`run_derive_broker_dailies_job`): replaced the inline `compute_all_metrics(mtm_returns, ...)` with `derive_basis_series(...)`; `mtm_metrics_json` is now `dict(_mtm_basis_result.metrics_json)` from the SAME result. Added `persist_basis_series(...)` alongside the authoritative `metrics_json_by_basis` prestamp, wrapped in `db_execute`, with the SAME success matrix (success → row; degrade / compute-reject / not-attempted → `result=None` heal).
- **Composite seam** (`run_stitch_composite_job`): replaced `mtm_metrics_json = dict(_metrics_result_for(clipped_mtm).metrics_json)` with explicit `stitched_mtm = stitch_clipped_series(clipped_mtm)` → `derive_basis_series(stitched_mtm, benchmark_rets, periods_per_year=..., cumulative_method=..., day_basis=...)`. `_metrics_result_for` stays **cash-only** (commented). Persist lands in the persist phase (after csv + headline writes); gated/degrade heals the stale row.
- **Grep gate holds:** `_metrics_result_for(clipped_mtm)` → **0 hits**; `_metrics_result_for(clipped_cash)` → 1 (cash untouched).
- **Tests (both files):** wiring (helper called once with the right series + conventions; persist gets the EXACT same `BasisSeriesResult`), neuter-falsifiable ValueError-degrade + heal, not-attempted heal, gated heal, byte-for-byte scalar parity vs the untouched cash compute over identical inputs, inter-member `gap_span` mask, and CompositeOverlapError/ValueError permanent-fail parity.

## Heal Matrix (T-103-03 mitigation)
| Derive shape | metrics_json_by_basis | mtm_daily_returns row |
|---|---|---|
| Success (attempted + finite) | `{mark_to_market: {...}}` | UPSERT from the same result |
| Degrade / compute-reject / gated / not-attempted | SQL NULL | DELETE (heal) |

The series row can never outlive an authoritative-NULL scalar write.

## SC-4 Cash Byte-Identity (Task 3 keystone)
- **Nine cash goldens / cash-pin suites UNMODIFIED** — diff surface since the Wave-1 base (`d77d8f6f`) is EXACTLY `job_worker.py` + the two worker test files; no golden/fixture/.csv/.json touched. `test_golden_parity.py` + `test_metrics_minigolden.py` + `test_mt5_golden_fixtures.py` = **32 passed** unmodified.
- **`git diff d77d8f6f..HEAD -- analytics-service/services/job_worker.py | grep -c "^-.*csv_daily_returns"` = 0** — no cash-bridge deletions.
- The documented MTM scalar shift (canonicalizing scalars as `compute(gap_fill(_drop_nonfinite(...)))`) is MTM-ONLY — cash never routes through the helper this phase.

## Task Commits
1. **Task 1 (single-key):** `de7711a2` feat(103-02): single-key MTM seam derives + persists via shared basis_series
2. **Task 2 (composite):** `8809154a` feat(103-02): composite MTM seam routes through shared basis_series, heals
3. **Task 3 (sweep):** no commit — verification-only; coverage already ≥80, no targeted tests needed.

## Neuter-Confirmations (performed, not merely claimed)
- **Single-key persist neuter** (comment out `await db_execute(_persist_mtm_series)`) → the 3 heal/wiring tests RED. Restored → green.
- **Single-key derive-wiring neuter** (bypass the helper with an inline `compute_all_metrics`) → the wiring + `mtm_compute_valueerror_degrades` + `mtm_periods_uses_crypto_clock` tests RED. Restored → green.
- **Composite persist neuter** → the 3 composite persist tests RED. Restored → green.
- **Composite derive-wiring neuter** (revert to `_metrics_result_for(clipped_mtm)`) → the wiring test RED **and** the grep gate goes to 1. Restored → grep gate 0, green.

## Test Results
- `tests/test_mtm_single_key.py`: **25 passed** (22 existing + 3 new).
- `tests/test_stitch_composite_job.py`: **63 passed** (57 existing + 6 new).
- Full suite (`tests --ignore=tests/e2e`, SERIAL `-p no:xdist`): **3665 passed, 93 skipped, 1 failed**. Coverage **92.46%** (gate ≥80 reached). mypy `services/job_worker.py` clean.
- The **1 failure is pre-existing and out-of-scope** — `test_audit.py::TestAuditTaxonomySyncWithTypeScript::test_action_literal_matches_ts_union` (D-103-01: cross-runtime audit-taxonomy TS/Python drift; touches no plan file; Wave 1 already logged it). **Zero regressions introduced.**

## Deviations from Plan
None. Plan executed as written (Rules 1–3 not triggered). The two existing compute-patch test retargets (to `services.basis_series.compute_all_metrics`) are a direct consequence of the wiring change the plan mandates, not a deviation.

## ⭐ Ship-Time Backfill Reminder (documented ship gate — NOT part of this plan)
Existing options strategies (e.g. **Zavara**) have **NO `mtm_daily_returns` series row** until a post-deploy **re-derive backfill** runs — `enqueue_compute_job(strategy_id, 'derive_broker_dailies')` (single-key) / `'stitch_composite'` (composite) on Railway. Plans 103-03/04 charts will show empty MTM coverage for those strategies until the backfill lands. This backfill remains the documented ship gate. Watch for the Wave-1-flagged MTM scalar delta on books with interior guard NaN (dailies-canonical `NaN → absent → 0.0` semantics).

## Self-Check: PASSED
- Files verified on disk: `services/job_worker.py`, `tests/test_mtm_single_key.py`, `tests/test_stitch_composite_job.py`, `103-02-SUMMARY.md` — all present.
- Commits verified in git log: `de7711a2`, `8809154a` — both present on `gsd/v1.10-portfolio-intelligence-options-mtm`.
- Grep gate `_metrics_result_for(clipped_mtm)` = 0; cash `_metrics_result_for(clipped_cash)` = 1.
- `.planning/` artifacts correctly gitignored/local — never staged.

---
*Phase: 103-mtm-daily-series-charts-follow*
*Completed: 2026-07-12*
