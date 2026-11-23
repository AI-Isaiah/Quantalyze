---
phase: 215-testreach-every-test-that-guards-money-math-or-error-contrac
plan: 06
subsystem: testing
tags: [analytics-service, job-worker, classify_exception, domain-exception, pytest]
requires: ["215-02", "215-03"]
provides:
  - "services/job_failure.py: WorkerJobFailure(error_kind, message) leaf module plus CsvStrategyNotFound, CsvInsufficientHistory, CsvMalformedDenominatorConfig, CsvComputationFailed"
  - "services/job_worker.py classify_exception: WorkerJobFailure arm above the kept HTTPException arm"
  - "tests/test_job_failure.py: old-vs-new equivalence over the four sites plus four literal tuples"
affects: [analytics-service/services, analytics-service/tests]
tech-stack:
  added: []
  patterns: ["leaf domain-exception module whose message keeps the legacy numeric prefix so the persisted text stays byte-identical", "old-vs-new classifier equivalence pin beside independent literal tuples"]
key-files:
  created:
    - analytics-service/services/job_failure.py
    - analytics-service/tests/test_job_failure.py
  modified:
    - analytics-service/services/job_worker.py
    - analytics-service/services/analytics_runner.py
    - analytics-service/tests/test_raw_5xx_census.py
    - analytics-service/tests/test_csv_analytics_runner.py
    - analytics-service/tests/test_failed_status_logged.py
    - analytics-service/tests/test_analytics_runner.py
    - analytics-service/tests/test_ledger_refresh_publish_guard.py
    - analytics-service/tests/test_ledger_refresh_hop2_oracle.py
    - analytics-service/tests/test_pgrst204_recovery_fallback.py
    - analytics-service/tests/test_computation_error_provenance_fallback.py
    - analytics-service/tests/test_persist_csv_daily_returns_live.py
key-decisions:
  - "The domain exceptions carry error_kind and message only (message keeps the legacy '404: ...' prefix); no status_code or detail attribute, so the HTTP vocabulary SC-4 removes is not re-imported"
  - "classify_exception's HTTPException arm is kept unchanged for its other callers; the new arm sits immediately above it and applies the same cause-suffix rule"
  - "The runner's in-try re-raise arm now targets WorkerJobFailure, so the permanent insufficient-history failure is never re-wrapped as the retried 500"
status: complete
completed: 2026-11-15
actuals:
  tokens: 12200
  tasks: 2
  commits: 2
plan_head_before: 864c14bf839e49ed9ee7527380a7c13137cb0520
plan_head_after: 6826d54fd96ff8c871fda485cb0f8d2c0d96d240
---

# Phase 215 Plan 06: The CSV runner raises worker domain exceptions, not HTTP ones Summary

`run_csv_strategy_analytics` raises `CsvStrategyNotFound`, `CsvInsufficientHistory`, `CsvMalformedDenominatorConfig` and `CsvComputationFailed` (all `WorkerJobFailure`) instead of `fastapi.HTTPException`, and `classify_exception` maps each to the byte-identical `(ErrorKind, text)` the HTTP exception produced, so the persisted `compute_jobs` row is unchanged.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | SC-4 tracer: the domain exception, its classifier arm, the equivalence pin, the strategy-not-found site converted | 93fb6ab77 | job_failure.py, job_worker.py, analytics_runner.py, test_job_failure.py, test_csv_analytics_runner.py |
| 2 | SC-4 expansion: remaining three sites, the re-raise trap, the census, every assertion re-pointed | 6826d54fd | analytics_runner.py, test_raw_5xx_census.py and eight re-pointed test modules |

## What changed

- `services/job_failure.py` is a leaf module (imports neither `job_worker` nor `analytics_runner`). `WorkerJobFailure.message` keeps the numeric prefix on purpose; `str(exc)` returns it.
- The four persisted pairs, as pinned: `('unknown', '404: Strategy not found')`, `('permanent', '400: Insufficient CSV history')`, `('permanent', '422: Malformed returns_denominator_config (cause: ReturnsDenominatorConfigError(...))')`, `('unknown', '500: CSV analytics computation failed')`. The 422 keeps `raise ... from cfg_exc` (that is the cause suffix); the 500 is raised with no `from`, as before.
- The in-try arm that re-raised HTTP exceptions is now `except WorkerJobFailure: raise`. Left as it was, the new 400 would fall into the catch-all and persist as the retried 500.
- `analytics_runner.py` no longer imports `fastapi`. It re-exports `WorkerJobFailure`. Three stale comments naming the HTTP types were corrected.
- `test_raw_5xx_census.py`: the runner's 500 row is gone; `EXPECTED_SITE_COUNT` 12 to 11, `EXPECTED_TRIPLE_COUNT` 9 to 8 (the derived counts agree, so no different numbers were needed); docstring carries a dated note (2026-11-15).
- Re-pointed to the matching subclass, asserting `error_kind` and `message` (or `error_kind` plus the class where the original asserted only the status): `test_csv_analytics_runner`, `test_failed_status_logged`, `test_analytics_runner`, `test_ledger_refresh_publish_guard`, `test_ledger_refresh_hop2_oracle`, `test_pgrst204_recovery_fallback`, `test_computation_error_provenance_fallback`; comments only in `test_persist_csv_daily_returns_live` (its five tests need a live DB and skip locally). The 400 tests now also prove the exception is not `CsvComputationFailed`.
- Re-derived the population at HEAD: the `grep -rlaE` set intersected with `HTTPException|status_code` is the plan's list plus `test_job_worker` (kept: it exercises the retained classifier arm). No module outside the plan's list needed changes. No re-pointed module asserted route HTTP semantics.

## Verification

- Task 2 verify set (11 modules, run per module): `test_job_failure` 11, `test_raw_5xx_census` 19, `test_csv_analytics_runner` 76, `test_failed_status_logged` 11, `test_analytics_runner` 111, `test_ledger_refresh_publish_guard` 38, `test_ledger_refresh_hop2_oracle` 10, `test_pgrst204_recovery_fallback` 3, `test_computation_error_provenance_fallback` 14, `test_job_worker` 127 passed + 1 skipped (a skip that is in the baseline too), `test_persist_csv_daily_returns_live` 5 skipped (live-DB module, no TEST DSN locally; comments-only change). `test_job_worker_csv_kind` 7 passed.
- mypy strict (CI invocation): `Success: no issues found in 141 source files`.
- vitest (8 TS pins reading runner/worker source): 8 files, 568 tests passed.
- Full serial suite from `analytics-service/`: 14934 passed, 92 skipped, 4 failed. The same 4 fail on the baseline commit `864c14bf8` run in a throwaway worktree (14923 passed, 92 skipped, 4 failed; the difference is the 11 new tests): `test_process_key.py::test_process_key_route_registers_both_limits`, `test_process_key.py::test_anon_bucket_exhausts_at_30_without_touching_a_tenant`, `test_process_key_200_discriminator.py::test_pyapi_10b_csv_finalize_tombstone_and_422_arm`, `test_xdist_group_is_real.py::test_shared_db_group_runs_on_one_worker_with_the_group_suffix`. Three are shared in-process limiter state and ordering in a serial run (each of the two `test_process_key` ones passes when `test_process_key.py` runs alone: 114 passed), one is the known xdist usage error. None touches the runner. No new failure.
- SC-8: `git diff origin/main -- supabase/migrations` prints nothing.
- Acceptance greps: `raise CsvStrategyNotFound()` = 1; `status_code|.detail` in `job_failure.py` = 0; `isinstance(exc, HTTPException)` in `job_worker.py` = 1; comment-stripped `raise HTTPException|except HTTPException:|from fastapi import HTTPException` in `analytics_runner.py` = 0; `"run_csv_strategy_analytics", 500` in the census = 0.
- `grep -naE HTTPException services/job_worker.py main_worker.py sentry_init.py` finds no other `except` arm or Sentry filter on the type (the `isinstance` arm, the import, `_format_http_detail` and comments only), so no extra mirror arm was needed.

## RED proofs (SC-9)

Every proof backed up the file bytes to the scratchpad, neutered, ran, saw RED, restored with `cp` and checked with `cmp` (all restores reported identical).

1. Cause suffix dropped from the new `classify_exception` arm (`services/job_worker.py`): `tests/test_job_failure.py` 2 failed, 9 passed: `test_domain_exception_classifies_like_the_http_exception_it_replaced[422-malformed-config-with-cause]` and `test_malformed_config_is_permanent_and_carries_the_cause_suffix`.
2. `CsvInsufficientHistory` kind changed from permanent to unknown (`services/job_failure.py`): 2 failed, 9 passed: the `[400-insufficient-history]` equivalence case and `test_insufficient_history_stays_permanent_with_legacy_text`.
3. Old re-raise arm restored in `services/analytics_runner.py` (`except HTTPException: raise`, with the import put back), so the new 400 falls into the catch-all: 12 failed across the re-pointed modules, all insufficient-history paths now surfacing `CsvComputationFailed`: `test_csv_analytics_insufficient_history`, `test_cumulative_method_failure_write_gains_no_stamp`, `test_every_failed_stamp_stores_the_error_and_logs_it[runner.insufficient_history[0]]`, `test_csv_insufficient_history_arm_omits_series_completeness`, four in `TestCR03RunnerGuard`, three in `TestTwoHopRefreshOverAPublishedRow`, and `test_pgrst204_marker_miss_records_the_failure_at_a_non_p10_writer`.

## Surfaced, not changed (orchestrator resolution 5)

Worker-path HTTP raisers outside the four runner sites, left as they are:

- `routers/portfolio.py::_compute_portfolio_analytics` (reached by `run_compute_portfolio_job` and the cron recompute): `HTTPException` 409 (computing-row fence, about line 694), 400 "No strategies found in portfolio" (745), 413 (757), 400 "No returns data available" (871), 400 "Insufficient return history" (899). The cron path reads `status_code` on them (409 in-flight, 400 skipped), so they carry real HTTP semantics for that caller.
- `routers/match.py`: the plan named "the match helpers". Measured at this HEAD, the three helpers the worker imports (`_load_allocator_context`, `_load_candidate_universe`, `_score_one_allocator`) raise no `HTTPException`. The only three in the module (lines about 2542, 2571, 2670) are inside the `recompute` route handler. Nothing to convert on the worker path.

## Deviations from Plan

None - plan executed exactly as written. Notes: (a) the plan's cause-suffix rule is applied uniformly to every `WorkerJobFailure`, whereas the old HTTP arm sent a 500 through the generic `str(exc)` fallthrough (no suffix even with a chained cause); the runner raises the 500 with no cause, so the persisted text is identical and test (c) pins the no-suffix case. (b) Once, an ad hoc run of three FastAPI-heavy modules together (`test_process_key_200_discriminator`, `test_xdist_group_is_real`, `test_process_key`) produced 21 rate-limit-state failures; that is the combination the project rules forbid, not a result, and it was not used as evidence.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path, file access or schema change.

## Self-Check: PASSED

- FOUND: analytics-service/services/job_failure.py, analytics-service/tests/test_job_failure.py
- FOUND commits: 93fb6ab77, 6826d54fd (both ancestors of HEAD)
