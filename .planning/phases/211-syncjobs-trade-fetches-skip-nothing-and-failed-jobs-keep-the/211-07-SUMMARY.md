---
phase: 211-syncjobs-trade-fetches-skip-nothing-and-failed-jobs-keep-the
plan: 07
subsystem: testing
tags: [enqueue-dedup, refresh-marker, parity, d11, comments]

requires:
  - phase: 211
    provides: "plan 03: helper _record_enqueue_dedup and its generated snapshot"
provides:
  - "parity pins of the helper's one marker list and its one retraction call, in Python and TypeScript"
  - "dated comment updates: SQL records and retracts, Python and TS retractions are backstops"
affects: [ship TODOS entries D11-8 and D11-9]

status: complete
actuals:
  tokens: 6500
  tasks: 2
  commits: 2
plan_head_before: f96348cd40eb47957ee1f72224b37428e2530fd7
plan_head_after: d71ea0418

key-files:
  created: []
  modified:
    - analytics-service/tests/test_compute_job_metadata_merge_parity.py
    - src/lib/ledger-refresh-marker.test.ts
    - analytics-service/services/ingestion/long_fetch.py
    - analytics-service/services/job_worker.py
    - src/lib/ledger-refresh-marker.ts
    - analytics-service/tests/test_ledger_refresh_reuse_collision.py

key-decisions:
  - "Helper snapshot holds exactly ONE marker list (measured 2026-11-14), pinned at 1 in both runtimes; the parse regexes were not touched"

requirements-completed: [SC-2, SC-4]

duration: 60min
completed: 2026-11-14
---

# Phase 211 Plan 07: Marker-set parity of the dedup helper and the D-02 comments Summary

**The new SQL helper's marker list and its single call to `retract_ledger_refresh_marker` are pinned to the Python and TypeScript constants (an SQL-only edit turns both runtimes RED), and every comment that called the dedup gap open now says SQL records and retracts while the Python and TS retractions are backstops.**

## Accomplishments

- Python: `_DEDUP_SQL` and three tests (`test_dedup_helper_marker_list_equals_the_python_marker_set`, `test_a_marker_added_to_the_dedup_helper_alone_fails_the_comparison`, `test_dedup_helper_retracts_through_the_one_retraction_function`). 8 tests before, 11 after.
- TypeScript: `describe("[Phase 211 D11] parity with the _record_enqueue_dedup snapshot")`, three cases. 30 before, 33 after.
- Comments (no code changed): `long_fetch.py` (docstring D-02 paragraph and the tail note, 2 `Phase 211 D11` hits), `job_worker.py` (REUSE-01 block, 1 hit, comment-only diff proven by the plan's filter printing 0), `ledger-refresh-marker.ts` (JSDoc, `finalize-wizard` named as the residual), `test_ledger_refresh_reuse_collision.py` (module docstring, `_Queue` docstring and the dedup-return comment: the double keeps the pre-D11 discard on purpose). Every hunk of the three non-`job_worker` files was read: docstring or comment text only. No neuter for comment-only edits.

## Task Commits

1. Task 1 (tracer, parity tests) - `5149200a5`
2. Task 2 (comments) - `d71ea0418`

## Neuter evidence (SC-4), byte backup of the snapshot, `cp` restore, `cmp` clean both times, GREEN after (11 passed Python, 33 passed TS)

- **N1** (add `'ledger-refresh-mt5'` to the helper's list in the snapshot): Python RED `test_dedup_helper_marker_list_equals_the_python_marker_set` and `test_a_marker_added_to_the_dedup_helper_alone_fails_the_comparison` (2 failed, 9 passed); TS RED `the helper's one marker list equals the TS set` and `a marker added to the helper alone turns the helper parity case RED` (2 failed, 31 passed). The second case also reds because the exact text it replaces is gone, which is the intended guard.
- **N2** (rename the call to `retract_ledger_refresh_marker_v2(`): Python RED `test_dedup_helper_retracts_through_the_one_retraction_function` (1 failed, 10 passed); TS RED `the helper retracts through the one retraction function, once, outside comments` (1 failed, 32 passed).

## Verification readings

- `node scripts/verify-plan-anchors.mjs` on this plan: `OK: 1 plan file(s), no stale claims.` before any edit.
- Full CI pytest: `Required test coverage of 80% reached. Total coverage: 94.65%`; `14873 passed, 101 skipped`.
- mypy strict (CI command): `Success: no issues found in 139 source files`.
- `npx vitest run src/lib/ledger-refresh-marker.test.ts` 33 passed; `npm run typecheck` clean; `npm run lint` 0 errors (4 pre-existing warnings in files this plan did not touch).
- Acceptance greps: `D-02, unchanged and NOT that race` 0, `D-02, UNCHANGED` 0, `exactly as in SQL` 0; `Phase 211 D11` counts long_fetch 2, ledger-refresh-marker.ts 2, collision test 3, job_worker 1 (baseline 0); `finalize-wizard` in the TS helper 0 -> 1.

## For the ship step (verbatim, TODOS entries)

**(a) D11-9 residual.** The finalize-wizard `stitch_composite` enqueue (the TypeScript backstop exists) and the csv-finalize `compute_analytics_from_csv` enqueue (no backstop) send no `correlation_id`, so SQL does not retract for them. The finalize-wizard `stitch_composite` enqueue sends only `source`; the csv-finalize enqueue is not covered by any retraction.

**(b) D11-8 report for the founder.** Two Vercel cron routes send `correlation_id` on kinds the helper does not cover, so they cannot retract: `src/app/api/cron/reconcile-strategies/route.ts` (`reconcile_strategy`) and `src/app/api/cron/sync-funding/route.ts` (`sync_funding`). Neither kind is in the helper's kind list (`derive_broker_dailies`, `compute_analytics_from_csv`, `stitch_composite`), so "no background retraction" is structural.

## Deviations from Plan

None - plan executed exactly as written. (The plan's verify used `python3 -m pytest` and bare `pytest`/`mypy`; the analytics venv's `python -m` was used, same commands otherwise.)

## Known Stubs

None.

## Threat Flags

None.

## Self-Check: PASSED

Both commits exist on the branch (`5149200a5`, `d71ea0418`); all six modified files present; snapshot restored byte-identical.
