---
phase: 190-factsheetqueued
plan: 09
subsystem: analytics-derive
tags: [data_quality_flags, last_success_snapshot, derive_broker_dailies, prestamp, D-02, SC-3, SC-6]

requires:
  - phase: 190-factsheetqueued
    provides: plan 01 verdicts A1 (write order), MARKER, SNAPSHOT (only the two terminal-success writers stamp computed_at), all HOLDS
provides:
  - LAST_SUCCESS_SNAPSHOT_KEY and the pure _last_success_snapshot helper in services/job_worker.py
  - a guarded pre-prestamp read in run_derive_broker_dailies_job, strategy-mode only
  - the key written on every strategy-mode prestamp (snapshot object, or JSON null)
affects: [190-03, 190-08]

actuals:
  tokens: 36000
  tasks: 2
  commits: 2
plan_head_before: ae62935d13ef102646cc715251a24e45d97dd759
plan_head_after: 249ca528a06ebf229d234e0bd7d4eb2d5cbe55b8

tech-stack:
  added: []
  patterns:
    - "display-aid read that logs, captures and degrades to null instead of failing the job it rides on"

key-files:
  created:
    - analytics-service/tests/test_derive_last_success_snapshot.py
  modified:
    - analytics-service/services/job_worker.py
    - analytics-service/tests/test_csv_analytics_runner.py
    - analytics-service/tests/test_job_worker.py
    - analytics-service/tests/test_nav_marks_derive_apply.py

key-decisions:
  - "No migration: the snapshot is a key nested in data_quality_flags, which the prestamp replaces wholesale and the success rebuild never copies, so it lives exactly from one derive to the next success."
  - "The key is written on every strategy-mode prestamp, null when there is no usable snapshot, so plan 03's D-04 rule can tell it from a legacy row at rest (no key)."
  - "A failed pre-read never fails the derive (ERROR for a programming error, WARNING otherwise, always captured); this deviates on purpose from the file's propagate-programming-errors rule because the snapshot is a display aid, not a computation input."

requirements-completed: [SC-3, SC-6]

completed: 2026-11-03
status: complete
---

# Phase 190 Plan 09: last_success_snapshot across the derive prestamp Summary

**A single-key broker re-run's derive prestamp now carries the last success's flags and `computed_at` as `data_quality_flags.last_success_snapshot`, so the factsheet keeps its stored numbers beside the flags that describe them through the whole re-run window, with no migration and no change to anything the compute hop reads.**

## What changed

- `LAST_SUCCESS_SNAPSHOT_KEY: Final[str] = "last_success_snapshot"` with a comment block (phase, D-02, SC-3, SC-6, shape, sole writer, why it lives inside `data_quality_flags`, never a guard-key member, who reads it, why null is written).
- `_last_success_snapshot(row) -> dict | None`: pure, `isinstance` only, never raises, returns deep copies. Marker-bearing flags with a string `computed_at` give a new `{computed_at, flags}` (nested snapshot key stripped, so it never nests); otherwise a well-formed prior snapshot is carried forward; anything else, a non-dict included, is None.
- `run_derive_broker_dailies_job`: immediately before `_prestamp_dq_flags`, one `db_read_with_retry` select of `"data_quality_flags, computed_at"`, wrapped so any exception logs (ERROR for `_READ_PROGRAMMING_ERRORS`, WARNING otherwise), is captured with `_capture_read_failure`, and leaves the local None. One unconditional `_prestamp_flags[LAST_SUCCESS_SNAPSHOT_KEY] = _last_success`. Key-mode returns before this seam (the `if is_key_mode:` exit that ends in `return DispatchResult(DONE)`), confirmed by reading it. `_prestamp_payload["data_quality_flags"]` is the same dict object, so the existing upsert writes it.
- One sentence appended to the MED-3 comment and one to the SFH-R3-04 comment. `analytics_runner.py`, the composite stitch, the failure writers and key-mode are untouched (`git diff --stat` on `analytics_runner.py` is empty).

## Tests

- New `tests/test_derive_last_success_snapshot.py` (27 tests): the helper truth table (marker-bearing, carry-forward, no nesting, 16 none-cases, no shared mutable state) and the derive-level capture (snapshot carried; null key with no row, with the snapshot the only difference between the two prestamps; legacy row gets a null key; RuntimeError logs WARNING and TypeError logs ERROR, both still upsert the prestamp and enqueue the compute hop; the select string passes `assert_select_columns`).
- Runner pin `test_success_rebuild_drops_the_last_success_snapshot` in `tests/test_csv_analytics_runner.py`.

## Gates

- Targeted 15 files: 704 passed, 1 skipped, 2 failed before the fixture updates below; all green after (704 + the 2 fixed).
- Full suite exactly as CI (`pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80`, live-DB env vars unset): **13437 passed, 97 skipped, 0 failed**, coverage **94.51%** (required 80%). The 97 skips are all environment skips: live TEST/Supabase project not configured (about 64), local-stack lane not configured (4), `HAS_PY_ENV=1` parity gate (5), and others of the same kind. None is a test this plan added; they are skipped, not passed.
- mypy, the exact CI line, run from `analytics-service/`: `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` -> `Success: no issues found in 131 source files`.
- pytest ran with the main checkout's venv; `services.job_worker.__file__` was confirmed to resolve to this worktree.

## Can-fail proofs (byte backups in the scratchpad, restored with `cp`, never git checkout/restore/stash)

- **(a)** `_last_success_snapshot` made to return None unconditionally: RED, 5 failed (`test_marker_bearing_flags_are_snapshotted_with_their_computed_at`, `test_a_well_formed_snapshot_is_carried_forward_unchanged`, `test_the_snapshot_never_nests`, `test_the_snapshot_shares_no_mutable_state_with_the_read_row`, `test_prestamp_carries_the_snapshot_of_the_last_success`). Restored, `cmp` silent, rerun 27 passed.
- **(b)** `analytics_runner.py` rebuild made to copy `existing_flags["last_success_snapshot"]`: RED, `test_success_rebuild_drops_the_last_success_snapshot` failed on `assert 'last_success_snapshot' not in {...}`. Restored, `cmp` silent, rerun green.
- **(c)** the one assignment guarded on `_last_success is not None`: RED, 4 failed (`test_prestamp_carries_the_key_as_null_when_there_is_no_row`, `test_a_legacy_row_without_marker_or_snapshot_gets_a_null_key`, `test_a_failing_read_costs_only_the_snapshot_warning`, `test_a_failing_read_that_is_a_programming_error_logs_error`). Restored, `cmp` silent, rerun 27 passed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test fixture] Two whole-dict prestamp assertions gained the null key**
- **Found during:** Task 2, targeted regression run
- **Issue:** every strategy-mode prestamp now carries `last_success_snapshot`, null when the fake read returns no row, so two assertions comparing the whole `data_quality_flags` dict went red.
- **Fix:** added `"last_success_snapshot": None` to each expected dict with a comment; no assertion dropped or loosened.
- **Files modified:** `analytics-service/tests/test_job_worker.py` (`test_clean_broker_rederive_clears_stale_warn_flags`, the one the plan predicted) and `analytics-service/tests/test_nav_marks_derive_apply.py` (`test_no_marks_strategy_series_is_unchanged`, NOT in `files_modified`: a deviation from the file list).
- **Commit:** 249ca528a

Otherwise the plan executed as written.

## Design choices and rejected alternatives (for plan 08)

- No migration (RESEARCH recommends none). A sibling column would outlive the window and would need a migration that auto-applies to PROD on merge plus a deploy-window guard.
- Rejected: moving the prestamp into a staging column the compute hop reads. It changes what the compute hop reads; the API service and the backfill worker deploy independently, so a chain whose derive ran on new code and compute on old code would rebuild its flags from the previous derive's guard and marks keys, and `marks_covered_from` drives the dense reindex, so a published number could move.
- Rejected: a snapshot column written by the success writers. It needs a migration plus a backfill, or each strategy's first post-deploy re-run would still hide.
- Version skew fails closed except in one recorded case. A derive on pre-plan code writes no key: a pending or computing row in that window withholds, but a terminal-success row in that window is not caught by D-04, so until that chain's success it shows the new derive's flags beside the last success's figures. A TypeScript reader from before plan 03 ignores the key.
- Known limits carried to plan 08: the snapshot carries flags only. `metrics_json_by_basis`, the MTM, smoothed and cash_settlement series rows and `series_completeness` are still written by the derive hop; plan 05 makes the MTM and smoothed toggles read the new derive's by-basis, series and `mtm_gated_reason` together. The day basis follows the new derive's frozen conventions, which differ from the last success's only when the day-basis setting changed in that run.
- Contract recorded in the constant's comment and stated identically in plan 03: reader prefers live flags when they carry a top-level string `cumulative_method`; otherwise uses the snapshot only when its `computed_at` is the same instant as the row's.

## Known Stubs

None.

## Threat Flags

None. The snapshot is a copy of the same row's earlier flags (booleans, dates, method and unit names; T-73-02), under the same RLS and grants. T-190-18, -19, -20 are mitigated by the tests and can-fail proofs above; no package was installed (T-190-SC).

## Commits

- `cba331cf6` feat(190-09): derive prestamp carries the last success's flags as last_success_snapshot
- `249ca528a` test(190-09): whole-dict prestamp assertions gain the null last_success_snapshot key

The SUMMARY commit follows these two.

## Self-Check: PASSED

- FOUND: analytics-service/tests/test_derive_last_success_snapshot.py
- FOUND: cba331cf6, 249ca528a (ancestors of HEAD)
- `grep -c` checks: constant 1, `_prestamp_flags[LAST_SUCCESS_SNAPSHOT_KEY]` 1, `def _last_success_snapshot` 1
