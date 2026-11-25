---
phase: 234-nocapital-a-no-capital-key-takes-one-named-path-and-a-transi
plan: 01
subsystem: allocator-equity-derive
tags: [nocap-03, nocap-04, proof-01, allocator, payload-counts]
requires: []
provides:
  - NO_CAPITAL_REFUSAL_REASONS closed set and no_capital_refusal_field validator (allocator_equity_derive.py)
  - payload["inputs"]["no_capital_exit_refused"] counts field (compose + job merge)
  - refusal_payload / _persist_refusal no_capital_exit_refused keyword
  - NOCAP-04 forced fallback for a candidate missing its segment terminals
affects: [234-02, 234-03, 234-04]
tech-stack:
  added: []
  patterns: [counts-only benign payload field, closed token set, single validator]
key-files:
  created: []
  modified:
    - analytics-service/services/allocator_equity_derive.py
    - analytics-service/services/allocator_equity_compose.py
    - analytics-service/services/job_worker.py
    - analytics-service/tests/test_allocator_equity_no_capital_exit.py
    - analytics-service/tests/test_derive_allocator_equity_job.py
decisions:
  - "Field lives in payload inputs (a {token: count} dict), not flags: flags is a sorted list of string tokens and cannot hold a per-route count."
  - "COMPOSE_INCOMPLETE, _compose_refused, _permanent_corrupt_input and the pre-selection refusals do not carry the field (reasons in the plan table)."
status: complete
commits: 3
plan_head_before: 67cd882d71c4f7fb417788b2e465829fcf2862b8
plan_head_after: c36fceadd6f2b4d62efa54fb336d1479b4eb6a38
actuals:
  tokens: 14000
  tasks: 3
  commits: 3
---

# Phase 234 Plan 01: NOCAP-03 counts field and NOCAP-04 residue fix Summary

Every route a no-capital key takes to `dropped_key` is now counted by closed token in one benign field, `payload["inputs"]["no_capital_exit_refused"]`, and a candidate whose interior hole lacks its stored segment terminals falls back with no `key_inputs_mismatch` residue.

## What was built

- **Task 1 (tracer, 067e08b47):** `NO_CAPITAL_REFUSAL_REASONS` (seven tokens) and `no_capital_refusal_field` in `allocator_equity_derive.py`; `refusal_payload(..., no_capital_exit_refused=None)` (default call byte-identical). The compose counts `replay_refused` per owner key; the job merges the compose field with its own counter after the compose and forwards the merged counts to `_persist_refusal` on both calls of the empty-curve branch. Proven end to end: a stored row carries `{"replay_refused": 1}`, and a sole-key book's `compose_empty_blocked` refusal record carries the same.
- **Task 2 (750c8aa29):** selection counts `funded_terminal` and `no_stored_terminal`, the D-10 refusal counts `consumes_more_than_dust` (replaces the bare integer), the whole-compose revert counts `compose_reverted` once per candidate in play, the compose counts `blocking_reason`, and its warning reads the counter. A clean exit and every read-failure token store no field. One book with three keys on three routes stores exactly one count per route.
- **Task 3 (c36fceadd):** `no_capital_exit`, `fell_back` and the counter moved above the interior-hole segment loop. A candidate with missing segment terminals appends to `fell_back`, counts `segment_terminals_missing`, adds no `key_inputs_mismatch` and no warning; a non-candidate keeps today's behaviour byte for byte.

## Verification (all run in this worktree)

- `python3 -m pytest tests/test_derive_allocator_equity_job.py tests/test_allocator_equity_no_capital_exit.py tests/test_derive_refusal_rows.py`: 185 passed (floor 185).
- Task 3 wider allocator set: 887 passed (floor 887).
- CI strict mypy: `Success: no issues found in 143 source files` (run after each task).
- `tests/fixtures/derive_refusal_rows.json` untouched; `test_derive_refusal_rows.py` green unchanged. No file under `.planning/` (other than this SUMMARY), VERSION, CHANGELOG.md, TODOS.md or package.json changed by the code commits. No migration.
- `node scripts/verify-plan-anchors.mjs <plan>`: `OK: 1 plan file(s), no stale claims.`

## PROOF-01 transcripts (each arm: byte backup in the scratchpad, neuter, RED, `cp` back, `cmp -s` exit 0, GREEN)

### Task 1, arm (a): compose `replay_refused` increment deleted
```
RED:   E  AssertionError: assert None == {'replay_refused': 1}
       FAILED tests/test_derive_allocator_equity_job.py::test_no_capital_exit_refused_counts_a_replay_refusal_in_the_row_and_on_the_refusal_record
       1 failed, 159 deselected in 9.99s    (selection: -k refused_counts_a_replay_refusal)
restore: cp compose.t1.bak -> services/allocator_equity_compose.py ; cmp -s exit 0
GREEN: 1 passed, 159 deselected in 9.83s
```

### Task 1, arm (b): `no_capital_exit_refused=` pass-through removed from the `COMPOSE_EMPTY_BLOCKED` `_persist_refusal` call
```
RED:   E  KeyError: 'no_capital_exit_refused'
       FAILED tests/test_derive_allocator_equity_job.py::test_no_capital_exit_refused_counts_a_replay_refusal_in_the_row_and_on_the_refusal_record
       1 failed, 159 deselected in 10.12s
restore: cp job.t1.bak -> services/job_worker.py ; cmp -s exit 0
GREEN: 181 passed, 3 warnings in 11.52s
```

### Task 2, arm 1: selection `funded_terminal` count replaced by `pass`
```
RED:   E  AssertionError: assert None == {'funded_terminal': 1}
       FAILED tests/test_derive_allocator_equity_job.py::test_no_capital_exit_a_dust_token_over_a_funded_terminal_stays_dropped
       1 failed, 163 deselected in 10.08s
restore: cp job.t2.bak -> services/job_worker.py ; cmp -s exit 0
GREEN: 1 passed, 163 deselected in 9.94s
```

### Task 2, arm 2: selection `no_stored_terminal` count replaced by `pass`
```
RED:   E  AssertionError: assert None == {'no_stored_terminal': 1}
       FAILED tests/test_derive_allocator_equity_job.py::test_no_capital_exit_no_stored_terminal_stays_dropped
       1 failed, 163 deselected in 10.07s
restore: cp job.t2.bak -> services/job_worker.py ; cmp -s exit 0
GREEN: 1 passed, 163 deselected in 9.92s
```

### Task 2, arm 3: D-10 `consumes_more_than_dust` count deleted
```
RED:   E  AssertionError: assert None == {'consumes_more_than_dust': 1}
       FAILED tests/test_derive_allocator_equity_job.py::test_no_capital_exit_anything_dated_after_the_terminal_day_stays_dropped
       1 failed, 163 deselected in 10.16s
restore: cp job.t2.bak -> services/job_worker.py ; cmp -s exit 0
GREEN: 1 passed, 163 deselected in 9.91s
```

### Task 2, arm 4: revert `compose_reverted` count deleted
```
RED:   E  AssertionError: assert None == {'compose_reverted': 1}
       FAILED tests/test_derive_allocator_equity_job.py::test_no_capital_exit_compose_refusal_reverts_the_candidates_and_keeps_the_row
       1 failed, 163 deselected in 10.13s
restore: cp job.t2.bak -> services/job_worker.py ; cmp -s exit 0
GREEN: 1 passed, 163 deselected in 9.90s
```

### Task 2, arm 5: compose `blocking_reason` count deleted
```
RED:   E  KeyError: 'no_capital_exit_refused'
       FAILED tests/test_allocator_equity_no_capital_exit.py::test_no_capital_exit_a_blocking_candidate_falls_back_to_dropped_key
       1 failed, 8 deselected in 10.06s
restore: cp compose.t2.bak -> services/allocator_equity_compose.py ; cmp -s exit 0
GREEN: 185 passed, 3 warnings in 11.34s
```

### Task 3 (NOCAP-04): candidate branch of the missing-terminals block deleted (unconditional `key_inputs_mismatch` restored)
Also RED on the unfixed tree before implementing (the residue was measured, not assumed).
```
RED:   E  AssertionError: assert 'key_inputs_mismatch' not in ['classified_rotation', 'key_inputs_mismatch', 'window_truncated']
       E  AssertionError: assert 'key_inputs_mismatch' not in ['dropped_key', 'key_inputs_mismatch', 'no_anchor']
       FAILED tests/test_allocator_equity_no_capital_exit.py::test_hole_candidate_without_its_segment_terminals_falls_back_with_no_residue[clean-last-segment]
       FAILED tests/test_allocator_equity_no_capital_exit.py::test_hole_candidate_without_its_segment_terminals_falls_back_with_no_residue[blocking-last-segment]
       2 failed, 10 passed in 10.66s
restore: cp compose.t3.bak -> services/allocator_equity_compose.py ; cmp -s exit 0
GREEN: 887 passed, 6 warnings in 22.34s   (wider allocator suite)
```
Note: the RED output names `key_inputs_mismatch` in both shapes; the `no_capital_key_exited` assertion sits after it in the test and is reached only once the first passes.

## Deviations from Plan

None - plan executed as written. Two small notes:
- The unused `fell_back_refused` local was removed from the compose once the counter replaced it (Rule 3, dead variable caused by this plan's change).
- `_nc_assemble(with_a=...)` is implemented with `list * bool` multiplication to keep every existing caller unchanged; behaviour is as specified.

## Known Stubs

None.

## Threat Flags

None. The only new persisted surface is the counts field, validated by `no_capital_refusal_field` (closed tokens, integers); logs carry counts and closed classes only (the existing log test asserts no key id, day or amount and still passes).

## Self-Check: PASSED

- Commits present: 067e08b47, 750c8aa29, c36fceadd (`git rev-list --count 67cd882d..HEAD` = 3 before this SUMMARY commit).
- Modified files exist and match the plan's `files_modified`.
