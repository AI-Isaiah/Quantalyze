---
phase: 222-alerttruth-python-and-sql-error-copy-and-portfolio-benchmark
plan: 04
subsystem: analytics-service job worker
tags: [ERRC-03, sync_trades, status-bridge, live-lane, provenance-census]
requires: [222-01, 222-02]
provides:
  - "run_sync_trades_job returns FAILED/transient when its follow-on enqueue fails and nothing is published"
  - "a published strategy (or an unreadable publish state) gets no write and DONE, so computation_warned is never cleared"
  - "live gate through the real handler, mark RPCs and status bridge"
affects: [222 ship PR, Phase 251 SYNCSTORE]
status: complete
commits: 3
plan_head_before: dfe876f9d58cf19b5ac94e47d5ff6118c0fdddbb
plan_head_after: 87e4e26b112187846921741a5381c64bf7af68eb
actuals:
  tokens: 60000
  tasks: 3
  commits: 3
key-files:
  created:
    - analytics-service/tests/test_sync_trades_enqueue_failure_bridge_live.py
  modified:
    - analytics-service/services/job_worker.py
    - analytics-service/tests/test_job_worker.py
    - analytics-service/tests/test_failed_status_logged.py
    - analytics-service/tests/test_computation_error_provenance_census.py
    - analytics-service/tests/test_live_db_reach_roster.py
key-decisions:
  - "Publish read is a local closure _strategy_has_published_numbers, the twin of _published_numbers_exist (write scope forbids sharing it)"
  - "The five-key payload stays unstamped; census counts 9 / 1 / 1 unchanged, prose only"
requirements-completed: [ERRC-03]
---

# Phase 222 Plan 04: sync_trades enqueue-failure outcome Summary

A never-published strategy whose follow-on analytics enqueue fails now ends `failed` with the retries-exhausted sentence (reading `computing` between attempts) instead of `complete` with no analytics, and a published strategy is left exactly as it was.

PLAN_BASE: `dfe876f9d58cf19b5ac94e47d5ff6118c0fdddbb`. Nothing was pushed, no PR opened, no remote database touched.

## What was done

| Task | Commit | Result |
| ---- | ------ | ------ |
| 1 (tracer) nothing-published ends failed through the bridge | 48f1eeb5d | live module (loopback guard, `_drive`, nothing-published case), publish read + FAILED/transient, two offline tests renamed/rewritten, census driver updated |
| 2 published keeps its state; unreadable state never unpublishes | 07dc667e4 | published and read-failure branches, rewritten comment block, offline + live cases |
| 3 census prose, reach roster | 87e4e26b1 | P1 prose rewritten in three places, counts unchanged; new module classified in the reach roster |

Lane replay line (boot, `scripts/local-stack/run.sh up`): `baseline-replay: 1 migration(s) newer than the dump: 20261125212222_computation_error_copy_contact_form.sql`, then `[local-stack] replayed 20261125212222_computation_error_copy_contact_form.sql (ledger row written)`. The lane was torn down at the end (`down complete`); no sibling lane was present at boot.

## PROOF-01 records (verbatim)

### Task 1, live nothing-published case, RED on pre-fix code (handler untouched, restored state `dfe876f9d`)

```
E       AssertionError: {'computation_status': 'complete', 'computation_error': None, 'computation_warned': False, 'metrics_json': None}
E       assert 'complete' == 'failed'
```
(An earlier assertion order also showed `DispatchResult(outcome=<DispatchOutcome.DONE: 'done'>, error_message=None, error_kind=None, trade_count=1)`.) GREEN after the handler change: `2 passed` (guard self-test + the case), then `6 passed` with the Task 2 cases; no skipped.

### Task 2, behaviour cases on Task 1's code, RED

Offline (published x3 and read-raises), verbatim:
```
E       AssertionError: a published strategy must get NO strategy_analytics write from the enqueue-failure tail; got [{'strategy_id': 'strat-pub', 'computation_status': 'failed', 'computation_warned': False, 'computing_started_at': None, 'computation_error': 'Analytics enqueue failed during sync. The next scheduled sync will retry — use the contact form if this persists.'}]
E               RuntimeError: simulated read failure
4 failed, 3 passed, 128 deselected
```
Live (complete_with_warnings):
```
E       AssertionError: {'computation_status': 'complete', 'computation_error': None, 'computation_warned': False, 'metrics_json': {'marker': 'p222-published-figures', 'sharpe': 1.25}}
E       assert 'complete' == 'complete_with_warnings'
1 failed, 5 passed
```
The live `complete` and `computing-with-figures` cases pass on Task 1's code by construction (the bridge's branch (c) resolves them either way); they are regression guards for T-222-09, and the complete_with_warnings case is the one that bites. GREEN after Task 2: live `6 passed`; offline `tests/test_job_worker.py tests/test_failed_status_logged.py` `145 passed, 1 skipped` (the skip is the pre-existing `LANE_DB_URL unset` gate at test_job_worker.py:4493).

### Task 3, census guard (PROOF-01)

Byte backup then `cp` back, `cmp` silent. Neuter: added `"computation_error_source": "writer"` to the enqueue-failure payload:
```
E       AssertionError: computation_error provenance is missing or malformed at:
E       AssertionError: expected exactly 9 STAMPED python computation_error writers, found 10:
FAILED tests/test_computation_error_provenance_census.py::test_python_failure_writers_stamp_provenance
FAILED tests/test_computation_error_provenance_census.py::test_provenance_census_counts
2 failed, 4 passed
```
`cmp` printed nothing after restore; census `6 passed`.

Deviation from the plan's expectation: the plan said the inert-count assertion with the rewritten message would be among the failures. In `test_provenance_census_counts` the STAMPED-count assertion precedes the inert-count assertion and stops the test first, so a re-stamp trips the stamped count (10 vs 9) and the half-stamp rule instead. The guard still bites (both fail); the inert message was not reached by this mutation, and a second mutation (extra `data_quality_flags` key) also surfaced the stamped-count failure first. Not chased further; recorded.

## Verification

- mypy strict (`.venv/bin/mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`): `Success: no issues found in 143 source files`.
- Plan verify set (census, job_worker, failed_status_logged, no_contact_support_copy, live_db_reach_roster): green after the roster fix below.
- Full CI pytest command with the lane exported (`SUPABASE_TEST_URL`, `SUPABASE_TEST_SERVICE_KEY`, `LANE_DB_URL`, `CI=true`, `-n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-fail-under=80`): `1 failed, 16729 passed, 10 skipped, 2 xpassed in 686.86s`; `Required test coverage of 80% reached. Total coverage: 94.90%`. The one failure, `tests/test_process_key_anon_ip_tier.py::test_a_per_ip_refusal_leaks_no_identity_in_body_headers_or_the_handler_log` (`AssertionError: []`, an empty log-record capture), passes alone (`20 passed`) and touches none of this plan's files; it is a log-capture flake under xdist, the class commit 8507564ef addressed. Not fixed (out of scope), flagged for the orchestrator.
- Write scope: the awk hunk check against PLAN_BASE exits 0 (every changed hunk of job_worker.py lies between `# Phase 18 root-cause fix` and `run_compute_analytics_from_csv_job`). `grep -a -c SYNCTRADES-ENQUEUE-DONE` in job_worker.py and the census file is 0; `THIS WRITE IS ERASED ONE RPC LATER` is 0; the `"computation_status": "failed"` literal count in job_worker.py did not change (the census driver passes).

## Deviations from Plan

1. **[Rule 3 - Blocking] test_live_db_reach_roster.py.** `test_every_env_gated_skip_under_tests_is_accounted_for` failed because the new module's `_need_supabase` skip site was unclassified. Added one row (`_LANE_SUPABASE_FAIL_IN_CI`) beside its siblings. File not in `files_modified`; committed in 87e4e26b1.
2. **Live test assertion order.** Row state is asserted before the outcome so the pre-fix RED names the stored truth (`complete`, NULL error), as the acceptance criteria require.
3. **Task 1 interim.** The publish read in Task 1 was unwrapped (a read raise would propagate); Task 2 added the unreadable-state handling, with its RED recorded above.
4. **Structure.** The existing `_mark_analytics_failed` block is wrapped in `if _nothing_published:` (re-indented, payload and keys unchanged) so the function keeps its single DONE return and its `trade_count` expression.

## Known limit (T-222-13, double fault)

If the follow-on enqueue AND the publish read both fail on a never-published strategy, the handler writes nothing and returns DONE, so the row is left to the status bridge and reads `complete` (today's outcome). FAILED is reserved for a strategy known to have nothing published; an unreadable state is not that. The branch is logged at ERROR naming the strategy. To be recorded in the CHANGELOG.

## Ship notes (for the ship PR, not done here)

- Delete TODOS `[SYNCTRADES-ENQUEUE-DONE]`, name it in the CHANGELOG, and fix the pointer in the 164.2 provenance-degrade TODOS entry that cites it.
- CHANGELOG: a never-published strategy whose follow-on enqueue fails now retries the sync with the queue's backoff, reads `computing` between attempts and ends `failed` with the retries-exhausted sentence; a published one is left as it was and the next cron tick retries the enqueue; record the double-fault residual.
- The handler change reaches PROD only with the analytics Railway redeploy of the merged SHA; until then PROD keeps the old DONE outcome while the new SQL copy is already live.

## Known Stubs

None.

## Threat Flags

None.

## Self-Check: PASSED

Files present (new live module, SUMMARY); commits 48f1eeb5d, 07dc667e4, 87e4e26b1 are ancestors of HEAD.
