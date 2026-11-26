---
phase: 234-nocapital-a-no-capital-key-takes-one-named-path-and-a-transi
plan: 03
subsystem: allocator-equity-derive
tags: [nocap-02, nocap-03, proof-01, allocator, fault-revert]
requires: [234-02]
provides:
  - candidate_exception, the eleventh and last token of NO_CAPITAL_REFUSAL_REASONS (allocator_equity_derive.py)
  - apply-loop revert of every no-capital candidate on any Exception (job_worker.py)
  - compose-call revert on any non-NavReconstructionError Exception while a candidate is in play (job_worker.py)
affects: [234-04]
tech-stack:
  added: []
  patterns: [loop-local counter merged on completion (try/else), revert-once to stored inputs, counts-only warning]
key-files:
  created: []
  modified:
    - analytics-service/services/allocator_equity_derive.py
    - analytics-service/services/job_worker.py
    - analytics-service/tests/test_derive_allocator_equity_job.py
decisions:
  - "DEC-03-A: the apply loop counts into a loop-local Counter that joins no_capital_refusals in a try/else, so a faulted loop is counted as one candidate_exception per candidate and its half-done D-10 / ledger counts are discarded."
  - "DEC-03-B: the apply-loop except re-raises when no_capital_stored is None (unreachable while candidates exist, fail-loud if it ever happens) instead of guarding silently."
  - "DEC-03-C: the compose arm is a SIBLING except after the NavReconstructionError arm, so an exception raised by the stored-input compose inside the first arm propagates as today and is never caught by the new arm."
  - "DEC-03-D: the warnings carry type(exc).__name__ and counts only; no logger.exception, no str(exc)."
status: complete
commits: 2
plan_head_before: a2a4cebd6417037d341f1a6b76fa927679b024ea
plan_head_after: 0baf1e61a453bef24f73a2e38d0c74ea15f4e932
actuals:
  tokens: 12000
  tasks: 2
  commits: 2
---

# Phase 234 Plan 03: NOCAP-02 a candidate's fault never costs the book its row Summary

Any `Exception` raised while a no-capital candidate is in play, from the apply loop or the compose call, now reverts every candidate once to its inputs exactly as stored, counts `candidate_exception` once per candidate, and the job carries on to the upsert; with no candidate in play, from the stored-input compose, or for a `BaseException`, the exception reaches the dispatcher exactly as before. ROADMAP SC-2 holds.

## What was built

- **Task 1 (tracer, 9e4e74e63):** `candidate_exception` in `NO_CAPITAL_REFUSAL_REASONS`; the apply loop wrapped in `try` / `except Exception` / `else` with a loop-local `_nc_loop_refusals` counter. On a fault: the seven maps restored from `no_capital_stored` by `clear()` then `update()` (in place, later code holds the names), `no_capital_exit_by_key.clear()`, `candidate_exception += len(no_capital_candidates)`, one counts-only warning. The restore runs before the failing-key section. Tracer `test_no_capital_exit_a_candidate_fault_in_the_apply_loop_reverts_and_keeps_the_row` (two runs on one fake, payload equal to the same book with key-B's token read as `balance_error`).
- **Task 2 (0baf1e61a):** a sibling `except Exception` arm on the compose call (re-raise with no candidate in play, otherwise count, warn, compose once on `no_capital_stored`; its `NavReconstructionError` goes to `_compose_refused`, anything else propagates). Tests for every row of the outcome table.

## Tracer RED on the plan-02 tree (before any implementation)

```
E               KeyError: 'key-B-SECRET'
FAILED tests/test_derive_allocator_equity_job.py::test_no_capital_exit_a_candidate_fault_in_the_apply_loop_reverts_and_keeps_the_row
1 failed, 173 deselected in 13.02s
```
The `KeyError` escaped the job, as RESEARCH measured.

## Verification

- Task 1 command (three files): `198 passed, 3 warnings in 12.07s` (floor 197).
- Task 2 command (wider allocator set): `904 passed, 6 warnings in 22.97s` (floor 902).
- CI strict mypy after each task: `Success: no issues found in 143 source files`.
- Acceptance greps (comment lines excluded): `candidate_exception` in `job_worker.py` and `allocator_equity_derive.py` both at least 1; `_compose(no_capital_stored)` in `job_worker.py` = 2; `dispatch(` in the test file = 2.
- `classify_exception`, `dispatch`, `_compose_refused`, `read_writer_basis` and `tests/fixtures/derive_refusal_rows.json` are not edited.
- The DB calls between the apply loop and the compose (orphan delete, markers re-read) stay outside both handlers.

## Tests added (8, all with `no_capital` in the name)

1. `..._a_candidate_fault_in_the_apply_loop_reverts_and_keeps_the_row` (tracer; KeyError, two runs, caplog carries the class not the text)
2. `..._a_candidate_fault_in_the_compose_reverts_and_keeps_the_row` (ValueError via compose wrapper, two runs, second compose names no candidate)
3. `..._dispatch_ends_done_where_it_used_to_end_failed_unknown` (dispatch DONE; control with no candidate stays FAILED / `unknown`)
4. `..._a_fault_with_no_candidate_in_play_propagates_unchanged`
5. `..._a_cancellation_is_never_caught_in_the_apply_loop_or_the_compose` (`asyncio.CancelledError` from both sites)
6. `..._a_fault_in_the_stored_input_compose_keeps_todays_path` (ValueError on every call propagates; ValueError then `NavReconstructionError` is FAILED permanent + `compose_refused` record)
7. `..._a_compose_revert_keeps_the_counts_of_the_other_keys` (`{'candidate_exception': 1, 'funded_terminal': 1}`)
8. `..._an_apply_loop_fault_replaces_the_loops_own_counts` (key-B D-10 refusal discarded, key-C applied then reverted, key-D faults: `{'candidate_exception': 3, 'funded_terminal': 1}`)

The closed-set pin was renamed `test_no_capital_refusal_reasons_are_the_eleven_plan_01_to_03_tokens` and carries all eleven tokens.

## PROOF-01 transcripts (each arm: byte backup in the scratchpad, neuter, RED, `cp` back, `cmp -s` exit 0, GREEN)

### Task 1: apply-loop handler narrowed to `NavReconstructionError`
```
neuter: except NavReconstructionError as _nc_exc:
RED:   E               KeyError: 'key-B-SECRET'
       FAILED tests/test_derive_allocator_equity_job.py::test_no_capital_exit_a_candidate_fault_in_the_apply_loop_reverts_and_keeps_the_row
       1 failed, 173 deselected in 12.83s
restore: cp job.t1.bak -> services/job_worker.py ; cmp -s exit 0
GREEN: 1 passed, 173 deselected in 12.06s
```

### Task 1 extra arm: apply-loop `candidate_exception` count replaced by `pass`
```
RED:   E           AssertionError: assert None == {'candidate_exception': 1}
       FAILED tests/test_derive_allocator_equity_job.py::test_no_capital_exit_a_candidate_fault_in_the_apply_loop_reverts_and_keeps_the_row
       1 failed, 173 deselected in 13.91s
restore: cp job.t1.bak -> services/job_worker.py ; cmp -s exit 0
GREEN: 1 passed, 173 deselected in 14.20s
```

### Task 2 arm (a): the compose arm's handling of non-`NavReconstructionError` deleted (arm narrowed to `NavReconstructionError`, so the first arm owns it and the new one is dead)
```
RED:   E           ValueError: key-B-SECRET
       E       AssertionError: ('unknown', 'key-B-SECRET')       <- dispatch reads FAILED / unknown
       E           ValueError: first
       FAILED ...::test_no_capital_exit_a_candidate_fault_in_the_compose_reverts_and_keeps_the_row
       FAILED ...::test_no_capital_exit_dispatch_ends_done_where_it_used_to_end_failed_unknown
       FAILED ...::test_no_capital_exit_a_fault_in_the_stored_input_compose_keeps_todays_path
       FAILED ...::test_no_capital_exit_a_compose_revert_keeps_the_counts_of_the_other_keys
       4 failed, 177 deselected in 12.67s
restore: cp job.t2.bak -> services/job_worker.py ; cmp -s exit 0
GREEN: 4 passed, 177 deselected in 11.37s
```

### Task 2 arm (b): compose-revert `candidate_exception` count replaced by `pass`
```
RED:   E           AssertionError: assert None == {'candidate_exception': 1}
       E       AssertionError: assert None == {'candidate_exception': 1}
       E       AssertionError: assert {'funded_terminal': 1} == {'candidate_e..._terminal': 1}
       3 failed, 178 deselected in 12.94s
restore: cp job.t2.bak -> services/job_worker.py ; cmp -s exit 0
GREEN: 3 passed, 178 deselected in 23.16s
```

### Task 2 arm (c): apply-loop `candidate_exception` count replaced by `pass`, cardinality test
```
RED:   E       AssertionError: assert {'funded_terminal': 1} == {'candidate_e..._terminal': 1}
       FAILED ...::test_no_capital_exit_an_apply_loop_fault_replaces_the_loops_own_counts
       1 failed, 180 deselected in 11.50s
restore: cp job.t2.bak -> services/job_worker.py ; cmp -s exit 0
GREEN: 1 passed, 180 deselected in 11.95s
```
The RED shows the D-10 count of key-B is also absent: the loop-local counter is discarded, never merged.

### Task 2 arm (d), the narrowness control: the no-candidate guard (`if no_capital_stored is None or not no_capital_exit_by_key: raise`) replaced by `if False:`
```
RED:   E       AttributeError: 'NoneType' object has no attribute 'flows'
       FAILED ...::test_no_capital_exit_a_fault_with_no_candidate_in_play_propagates_unchanged
       1 failed, 1 passed, 179 deselected in 12.15s
restore: cp job.t2.bak -> services/job_worker.py ; cmp -s exit 0
```
(The dispatch control passes under this neuter because `AttributeError` is also `unknown`; the `run_derive_allocator_equity_job`-level control is what pins the exact class.)

## Deviations from Plan

**1. [Rule 3 - Blocking] Closed-set pin moved to eleven tokens in Task 1, not Task 2.** Adding `candidate_exception` to the set fails the existing pin the moment it changes, so the Task 1 verify command could not pass otherwise; the pin was renamed and updated in the Task 1 commit (same shape as plan 02's deviation 1).

**2. Test 8 is an addition beyond the plan's list.** The plan's cardinality edge for the apply loop ("replaces that loop's own counts with one candidate_exception per candidate") had no behaviour line; test 8 pins it and arm (c) proves it.

## Observations (pre-existing, not changed)

- `classify_exception` returns `error_kind` `unknown` with the exception text as the sanitized message for a bare `ValueError` (test 3's control shows `('unknown', 'key-B-SECRET')`). That is the dispatcher's own behaviour for an escaped fault and is outside this plan (the plan forbids editing `dispatch` / `classify_exception`). The new warnings do not carry the text.

## Known Stubs

None.

## Threat Flags

None. The new warnings and the stored field carry a class name, a closed token and a count; no key id, day, USD or venue id (T-234-10, T-234-11).

## Self-Check: PASSED

- Commits present: 9e4e74e63, 0baf1e61a (`git rev-list --count a2a4cebd..HEAD` = 2 before this SUMMARY commit).
- Modified files match the plan's `files_modified`; `STATE.md`, `ROADMAP.md`, VERSION, package.json, CHANGELOG.md and TODOS.md untouched; no migration.
