---
phase: 176-legacyretire-the-legacy-allocator-equity-curve-is-retired-an
plan: 08
subsystem: analytics-worker
tags: [PR-2, D-02, D-04, job_worker, dispatch, legacy-retire, tdd]
status: complete

requires:
  - phase: 176-legacyretire
    provides: "plan 07: PR 1 merged and live, every reader on the derived curve"
provides:
  - "run_retired_allocator_equity_job: the no-op DONE handler both legacy job kinds route to"
  - "a behaviour pin: a queued reconstruct or refresh job finishes DONE through the real dispatch with no database call"
affects: [176-09, 176-11 (deletes the old crawl and refresh code this plan stops reaching)]

key-files:
  created:
    - analytics-service/tests/test_legacy_allocator_jobs_retired.py
  modified:
    - analytics-service/services/job_worker.py
    - analytics-service/tests/test_job_worker.py
    - analytics-service/tests/test_history_reconstruct_cap_event.py

key-decisions:
  - "D-04 Shape R: stub handler returning DONE, not an absent handler (which is the Unknown job kind permanent failure)"

actuals:
  tokens: 2700
  tasks: 2
  commits: 3
plan_head_before: 5cd8284b3281a6ef34af3822d4d0adfdc145cb9b
plan_head_after: d7022b8fa2a2bd53dddb1c23f537c29c416c3c2c
---

# Phase 176 Plan 08: both legacy allocator job kinds finish as no-ops Summary

`dispatch` now routes `reconstruct_allocator_history` and `refresh_allocator_equity_daily` to one stub,
`run_retired_allocator_equity_job`, which reads nothing, writes nothing, logs one INFO line naming the kind and the
compute_job id, and returns DONE. After PR 2 deploys, no worker code path writes `allocator_equity_snapshots` or
calls either replace RPC, and an already-queued job of either kind ends cleanly instead of crawling a venue or
failing as an unknown kind.

## What changed

- `services/job_worker.py`: new `run_retired_allocator_equity_job` above `dispatch`; the two `elif` arms now set
  `handler = run_retired_allocator_equity_job`; both lazy imports of `services.equity_reconstruction` handlers are
  gone from `dispatch`. `TIMEOUT_PER_KIND`, `main_worker.py` and the cap hook are untouched.
- `tests/test_legacy_allocator_jobs_retired.py` (new): three tests. Both kinds finish DONE through the real
  `dispatch` with `get_supabase` patched to raise (never called); the stub logs exactly one INFO record naming the
  kind and the job id and not the allocator id.
- `tests/test_job_worker.py`: the two routing tests patch `services.job_worker.run_retired_allocator_equity_job`.
- `tests/test_history_reconstruct_cap_event.py`: both patch sites point at the stub, so the cap hook's outcomes are
  still driven per test (the cap tests all pass unchanged in meaning).

## Verification

- Anchors: `verify-plan-anchors.mjs` on the plan: 6 claims checked, OK.
- RED on the base: the new file with the stub absent gave `3 failed`: the two dispatch tests FAILED because the real
  handlers ran (`run_reconstruct_allocator_history_job: api_key_id missing`, `run_refresh_allocator_equity_daily_job:
  api_key_id missing`, both FAILED permanent) and the stub test FAILED with `AttributeError: module
  'services.job_worker' has no attribute 'run_retired_allocator_equity_job'`.
- Affected files after the change: `141 passed, 1 skipped` (new file, test_job_worker, test_history_reconstruct_cap_event).
- Neuter drill (Task 2): the reconstruct arm's body changed to `handler = None` gave
  `FAILED tests/test_legacy_allocator_jobs_retired.py::test_reconstruct_job_finishes_done_without_touching_the_database`
  with `error_message="Unknown job kind: 'reconstruct_allocator_history'"`, `1 failed, 2 passed`. Restored from a byte
  backup: `cmp` exit 0.
- Full analytics suite from `analytics-service/` (`env -u SUPABASE_URL -u SUPABASE_SERVICE_KEY .venv/bin/python -m
  pytest -q -p no:cacheprovider`): `14019 passed, 102 skipped, 1104 warnings in 355.14s (0:05:55)`, exit 0. The
  skips are the live-database tests that skip locally by design.
- CI mypy line, verbatim, from `analytics-service/`: `Success: no issues found in 131 source files`, exit 0.
- No ruff configuration or CI step exists for analytics-service, so none was run.
- `grep -an 'from services.equity_reconstruction import run_' services/job_worker.py` prints nothing (was two lines).
- No change under `supabase/`, `src/` or `main_worker.py`; STATE.md and ROADMAP.md untouched.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] The stub log test was green alone and red in the full suite**
- **Found during:** Task 2 (full suite run)
- **Issue:** `caplog.at_level(logging.DEBUG)` sets the root logger only. In a full run an earlier test leaves the
  `quantalyze.analytics.job_worker` logger above INFO, so `logger.info` produced no record (`AssertionError: []`).
  The culprit test was not isolated; the logger level is process state.
- **Fix:** `caplog.at_level(logging.INFO, logger=jw.logger.name)`, the form the neighbouring job_worker log tests
  already use. Full suite re-run green (numbers above).
- **Files modified:** `analytics-service/tests/test_legacy_allocator_jobs_retired.py`
- **Commit:** d7022b8fa

### Process notes

- The plan lists one commit for Task 1; the TDD reference asks for a RED commit before GREEN, so Task 1 is two
  commits (`test(176-08)` RED, `feat(176-08)` GREEN). The `analytics-service/.venv` in this worktree is a symlink to
  the main checkout's venv, as the plan prescribes; it is git-ignored.
- One docstring in `test_history_reconstruct_cap_event.py` was reworded to name the stub, since the sentence it
  replaced described the old handler.

## Commits

- 9939383b7 test(176-08): a queued reconstruct or refresh job must finish DONE without a database call (D-04, RED)
- 4ae399688 feat(176-08): both legacy allocator job kinds finish as no-ops (D-04)
- d7022b8fa fix(176-08): pin the module logger level in the stub log test

## CHANGELOG inputs

- Changed: both legacy allocator job kinds (`reconstruct_allocator_history`, `refresh_allocator_equity_daily`) now
  finish as no-ops. A job already queued at deploy time ends DONE without reading or writing anything, so the worker
  no longer writes `allocator_equity_snapshots` or calls either replace RPC.
- Notes: the kinds stay registered in `compute_job_kinds` because `compute_jobs.kind` references them; an absent
  handler would turn every queued row into an `Unknown job kind` permanent failure and alert noise. The old crawl and
  refresh code is deleted by plan 11.

## Known Stubs

`run_retired_allocator_equity_job` is an intentional stub (D-04); plan 11 removes the code it replaces. It does not
block the plan's goal.

## Threat Flags

None. No new endpoint, auth path or schema change. T-176-20, T-176-21 and T-176-22 are mitigated as planned.

## Self-Check: PASSED

- FOUND: analytics-service/tests/test_legacy_allocator_jobs_retired.py
- FOUND: commits 9939383b7, 4ae399688, d7022b8fa in `git log`
