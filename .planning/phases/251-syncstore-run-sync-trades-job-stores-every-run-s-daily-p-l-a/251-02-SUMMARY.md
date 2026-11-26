---
phase: 251-syncstore-run-sync-trades-job-stores-every-run-s-daily-p-l-a
plan: 02
subsystem: analytics-service
tags: [sync_trades, enqueue-failure, job_worker, status-bridge, pytest, proof-01]

requires:
  - phase: 251-01
    provides: "the flag-block truth and the owned-key replacement this plan pins at the real upsert"
  - phase: 222
    provides: "the enqueue-failure tail (publish read, conditional failed write, R2-WR-01 re-read) this plan splits"
provides:
  - "a re-read that raises after a zero-row failed-row write returns DONE and writes nothing"
  - "a failed-row write that raises keeps FAILED / transient, with no re-read"
  - "log lines that name which call failed; the wizard-may-hang line is gone"
  - "three CI-only live arms: the SC-5 re-read pin, A1 (the upsert replaces jsonb) and Q2 (the refused first-sync row)"
affects: [v1.22 TRUTH ship notes, CHANGELOG at ship]

requirements-completed: [PROOF-01]

plan_head_before: a388221e0777bd154cd2f661293ed090a6e869a6
plan_head_after: 8a1dd14dcd511ac4d105f54086792d23c654772c

actuals:
  tokens: 7700
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "write and re-read in separate try scopes so each outcome and log line names the failed call"
    - "mocked twin patches db_read_with_retry by function name, never a select side-effect list"

key-files:
  created: []
  modified:
    - analytics-service/services/job_worker.py
    - analytics-service/tests/test_sync_trades_store_truth.py
    - analytics-service/tests/test_sync_trades_enqueue_failure_bridge_live.py

key-decisions:
  - "Followed the plan. Placed the SC-5 arm helper so each arm asserts its own outcome first and the 'no hang sentence' check last, so the pre-fix RED names the real defect (FAILED instead of DONE) and not the log text."
  - "The scripted publish read raises a BaseException-derived _UnscriptedPublishRead on an extra read, because the handler's except Exception arms would otherwise absorb an AssertionError and read as a quiet outcome."

duration: ~45min
completed: 2026-11-26
status: complete
---

# Phase 251 Plan 02: SYNCSTORE re-read outcome and live pins Summary

**The enqueue-failure tail of `run_sync_trades_job` now keeps its conditional failed-row write and its publish re-read in separate `try` scopes: a re-read that raises returns DONE and writes nothing, a write that raises stays FAILED, and each log line names the call that failed. Three live arms pin the outcome and plan 01's flag behaviour at the real PostgREST upsert in CI.**

## Accomplishments

- SC-5 outcome (`[222-SYNCTRADES-REREAD-FAILED]`): after a follow-on enqueue failure, when the conditional failed-row write matches zero rows and the re-read then raises, the handler returns DONE and writes nothing. Its ERROR line says the re-read raised after a zero-row write and that nothing was written. This matches the same tail's first publish-read arm (T-222-13).
- A failed-row write that raises keeps FAILED / `transient`, makes no re-read, and logs a line containing `the conditional failed-row write raised`.
- Unchanged and still pinned: zero rows plus a re-read that finds a published row returns DONE with the R2-WR-01 sentence (verbatim); zero rows plus a re-read that finds nothing returns FAILED / `transient` with the constant operator sentence. `_mark_analytics_failed` and its five-key payload are byte-unchanged, and `test_no_contact_support_copy` stays green with no edit.
- The old log line claiming the wizard may still hang is gone from `run_sync_trades_job` (function-scoped count 1 to 0).
- The mocked twin (5 arms) lives in `tests/test_sync_trades_store_truth.py` with a harness that scripts the update chain, a failing enqueue and a name-keyed `db_read_with_retry` patch.
- The live harness gained `reread_raises` and `daily_flags`, and three arms (SC-5 pin, A1, Q2).

## Task Commits

1. **Task 1 (tracer):** `286a76303` fix(251-02): a failed re-read after a zero-row failed write returns DONE; the write and the re-read have separate try scopes
2. **Task 2:** `8a1dd14dc` test(251-02): live arms pin the re-read outcome, the jsonb-replacing flag upsert and the refused first-sync row

`commits: 2` is measured from the persisted plan ledger (`git rev-list --count a388221e0..HEAD`).

## Pre-fix RED (Task 1, run against the plan-01 code with the new tests)

Command: `cd analytics-service && python3 -m pytest tests/test_sync_trades_store_truth.py -q -p no:cacheprovider -k reread`

```
E       AssertionError: assert <DispatchOutc...LED: 'failed'> == <DispatchOutcome.DONE: 'done'>
E         - done
E         + failed
E       assert 'may still hang' not in 'async def r...s),\n    )\n'
FAILED tests/test_sync_trades_store_truth.py::TestRereadAfterZeroRowWrite::test_reread_raising_after_zero_row_write_returns_done
FAILED tests/test_sync_trades_store_truth.py::TestRereadAfterZeroRowWrite::test_write_raising_before_reread_stays_failed
FAILED tests/test_sync_trades_store_truth.py::TestRereadAfterZeroRowWrite::test_reread_old_hang_sentence_is_gone
3 failed, 2 passed, 32 deselected in 10.12s
```

Reasons are the intended ones. `test_reread_raising_after_zero_row_write_returns_done`: FAILED instead of DONE. `test_write_raising_before_reread_stays_failed`: no log line containing `the conditional failed-row write raised` (the only ERROR line was the old shared-arm hang sentence). `test_reread_old_hang_sentence_is_gone`: `'may still hang'` is in the handler source. The two controls (`test_reread_finding_a_published_row_returns_done`, `test_reread_finding_nothing_stays_failed`) passed on the old code, as expected.

## PROOF-01

Each neuter was applied to a byte copy kept in the scratchpad, run with `-k` on the named arm, restored with `cp`, then `cmp` (exit 0) and `git diff --quiet -- analytics-service/services/job_worker.py` (exit 0), then the whole file re-run. Commands take the form `cd analytics-service && python3 -m pytest tests/test_sync_trades_store_truth.py -q -p no:cacheprovider -k "<arm>"`. The GREEN line is the full file (37 arms).

| Neuter | Edit in words | `-k` arm | RED line (named arm) | cmp / git diff --quiet | GREEN |
|---|---|---|---|---|---|
| N5 | in the re-read's `except reread_exc` arm, delete `_nothing_published = False` (the pre-fix outcome) | `test_reread_raising_after_zero_row_write_returns_done` | `FAILED tests/test_sync_trades_store_truth.py::TestRereadAfterZeroRowWrite::test_reread_raising_after_zero_row_write_returns_done` (`1 failed, 36 deselected`) | `cmp exit: 0` / `git diff --quiet exit: 0` | `37 passed in 12.43s` |
| N7 | in the write's `except write_exc` arm, add `_nothing_published = False` | `test_write_raising_before_reread_stays_failed` | `FAILED tests/test_sync_trades_store_truth.py::TestRereadAfterZeroRowWrite::test_write_raising_before_reread_stays_failed` (`1 failed, 36 deselected`) | `cmp exit: 0` / `git diff --quiet exit: 0` | `37 passed in 12.55s` |
| N20 | in the re-read's truthy branch (the R2-WR-01 arm), delete `_nothing_published = False` | `test_reread_finding_a_published_row_returns_done` | `FAILED tests/test_sync_trades_store_truth.py::TestRereadAfterZeroRowWrite::test_reread_finding_a_published_row_returns_done` (`1 failed, 36 deselected`) | `cmp exit: 0` / `git diff --quiet exit: 0` | `37 passed in 12.46s` |

N5 is also the pre-fix outcome, so its RED is the same defect shown on the unmodified plan-01 code above.

## Live arms: CI-only

- The three live arms (`test_reread_failure_after_a_zero_row_write_keeps_the_published_row`, `test_a_clean_sync_removes_a_stored_refusal_key_and_keeps_the_rest`, `test_a_refused_first_sync_creates_a_row_carrying_only_the_refusal_key`) were NOT executed locally. The load limit forbids Docker, and there is no local Supabase stack.
- The SC-5 RED is the mocked twin's from Task 1. None of the three live arms was shown RED locally.
- The module `pytest.fail`s rather than skips when the lane env is unset and `CI == "true"`, so CI's `python` job is the first and binding execution of all three.
- Local run of the live file: `python3 -m py_compile` clean, then `python3 -m pytest tests/test_sync_trades_enqueue_failure_bridge_live.py -q -p no:cacheprovider -rs`:

```
SKIPPED [10] tests/test_sync_trades_enqueue_failure_bridge_live.py:114: local-stack lane not configured (local dev)
1 passed, 10 skipped in 10.16s
```

The verifier is asked to confirm the three test names as passed in the `python` job's log for the ship PR's head SHA.

## Phase gate (local, at head `8a1dd14dc`)

- Drivers plus census (`tests/test_sync_trades_store_truth.py tests/test_sync_trades_resume_seed.py tests/test_okxtrades_cursor.py tests/test_mt5_sync_path.py tests/test_failed_status_logged.py tests/test_ana_recon_audit.py tests/test_no_contact_support_copy.py tests/test_daily_pnl_read_verdict.py tests/test_okxtrades_ccy.py tests/test_computation_error_provenance_census.py tests/test_computing_started_at_stamp.py`): `1124 passed, 2 warnings in 21.32s` (the plan's floor is 1124, met exactly).
- Handler subset (`tests/test_job_worker.py -k "TestSyncTrades or TestAdvanceSyncCursorFence or TestRedTeamSyncTrades or enqueue_failure or sync_trades"`): `28 passed, 110 deselected in 10.72s` (baseline 28).
- Task 1 handler subset (`-k "TestSyncTradesEnqueueFailurePublishState or TestDeriveBrokerDailies or enqueue_failure"`): `43 passed, 95 deselected` (run before the one-line log-literal reflow; the reflow does not change behaviour, and the 28-arm handler subset above ran after it).
- MT5 pin (`tests/test_mt5_handover.py -k sync_job_passes`): `1 passed, 39 deselected in 10.08s` (baseline 1).
- mypy strict on `services/job_worker.py`: `Success: no issues found in 1 source file`.
- `node scripts/verify-plan-anchors.mjs` on both 251 PLAN files: `claims: 26 checked` / `OK: 2 plan file(s), no stale claims.`
- Acceptance counts inside `run_sync_trades_job` (by `inspect.getsource`): `may still hang` 0, `except Exception as reread_exc` 1, `except Exception as write_exc` 1, `except Exception as mark_exc` 0, `was published between the publish read and the write` 1, `Analytics enqueue failed during sync. ` 1.
- `git diff --name-only dd1879fd8..HEAD -- analytics-service` lists exactly the three planned files. Live file counts: `def test_` 11, `reread_raises` 4, `data_quality_flags` 9.

## Deviations from Plan

None. The plan was executed as written. Notes that are not deviations:

- The `no hang sentence` assertion is a small helper each arm calls last (not inline at the top), so a pre-fix failure names the outcome defect first. The plan only requires that each arm asserts it.
- The R2-WR-01 log sentence was re-indented in place but its merged string and its single-line anchor phrase are unchanged (count 1, pinned by `test_reread_finding_a_published_row_returns_done`).
- N7 was applied by inserting the line at the end of the `except write_exc` block (before the `else:`), a one-line byte-exact edit.

## Issues Encountered

None. `ruff` is not installed in this checkout, so no formatter run beyond mypy strict.

## Known Stubs

None.

## Threat Flags

None. The two new `logger.exception` lines carry the database exception text only (T-251-12, accepted), and contain no banned support phrase.

## Ship notes (for the orchestrator)

- Delete the TODOS entry `[222-SYNCTRADES-REREAD-FAILED]` in the ship PR and name it in the CHANGELOG.
- CHANGELOG `### Fixed`: a failed re-read after a zero-row failed write returns DONE (consistent with the publish-read arm, T-222-13), and the log names the failed call. The write that raises still returns FAILED.
- Carry plan 01's ship notes into the same entry (see `251-01-SUMMARY.md`, "Ship notes").
- Known limit, recorded and not fixed: the T-222-13 residual (enqueue and re-read both failing on a never-published strategy leaves the row to the status bridge).

## Self-Check: PASSED

- `analytics-service/services/job_worker.py`, `analytics-service/tests/test_sync_trades_store_truth.py` and `analytics-service/tests/test_sync_trades_enqueue_failure_bridge_live.py` exist and carry the changes above.
- Commits `286a76303` and `8a1dd14dc` are ancestors of HEAD.
- No uncommitted change under `analytics-service/` after the last neuter restore.
