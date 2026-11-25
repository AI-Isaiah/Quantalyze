---
phase: 234-nocapital-a-no-capital-key-takes-one-named-path-and-a-transi
plan: 04
subsystem: allocator-equity-derive
tags: [out-of-window-ruling, proof-01, allocator, tiny-base]
requires: [234-03]
provides:
  - read_tiny_base_days, the strict reader of key_inputs.tiny_base_days (allocator_equity_derive.py)
  - tiny_base_days keyword on replay_key_equity narrowing the out-of-window count to the founder ruling's scope
  - tiny_base_days_by_key keyword on compose_allocator_equity
  - tiny_base_days_by_key filled for counted and departed keys in run_derive_allocator_equity_job
affects: []
tech-stack:
  added: []
  patterns: [optional keyword so every existing caller is unchanged, strict key_inputs reader inside the read loop's existing try]
key-files:
  created: []
  modified:
    - analytics-service/services/allocator_equity_derive.py
    - analytics-service/services/allocator_equity_compose.py
    - analytics-service/services/job_worker.py
    - analytics-service/tests/test_allocator_equity_inception.py
decisions:
  - "DEC-04-A: strict reader (CONTEXT post-research), not RESEARCH A5's tolerant one: a malformed tiny_base_days list raises TypeError/ValueError inside the read loop's try, so the job ends FAILED permanent with an input_corrupt refusal; absent or null reads as no stated days; messages name the field and never the stored value."
status: complete
commits: 2
plan_head_before: 828b67477a3a32264ad7e2d3261e5ddad6324f5b
plan_head_after: 1c017fdca
actuals:
  tokens: 14000
  tasks: 2
  commits: 2
---

# Phase 234 Plan 04: the out-of-window ruling Summary

A flow after a key's last stored return day, on a day the key's own `key_inputs.tiny_base_days` states, is no longer counted as `out_of_window_flow`, in the legacy roll and in writer-basis mode, for counted and departed keys; a flow before the first return day, on an unlisted day, or a listed day inside the window keeps counting, and a malformed list is a named corrupt input.

## What was built

- **Task 1 (tracer, 3cba58b55):** `read_tiny_base_days` beside `read_dropped_day_pnl`; `tiny_base_days: Collection[str] | None = None` as the last keyword of `replay_key_equity`, with the count now `fd < lo or (fd > hi and fd not in stated)` minus the opening run and a docstring paragraph naming the 2026-11-24 ruling and its exact scope; `tiny_base_days_by_key` on `compose_allocator_equity` passed as `tiny_base_days=(tiny_base_days_by_key or {}).get(k)` in the one per-key replay call (a `k#holeN` segment unit has no entry, by design); in the job, `tiny_base_days_by_key` read in the counted and the departed branch of the key-inputs loop (inside the existing try) and passed by `_compose`. The writer line `_key_inputs_payload["tiny_base_days"] = _tiny_listed` is untouched. Tracer `test_job_threads_tiny_base_days_to_the_out_of_window_count` (stated and control arms).
- **Task 2 (1c017fdca):** replay arms (legacy, other day, pre-window listed day, in-window listed day, None and empty equal to the call without it, writer mode stated and not), reader arms, compose arm, job malformed-list arm (two shapes) and the departed-key arm (stated and not). The departed read was added with Task 1 since both branches sit in the same loop; its proof is arm (c) below.
- Stitch sources do not read the list (a stitched kept key's tail days belong to the kept member's own list), per CONTEXT post-research.

## Tracer RED (before the job threads the list)

Run with `job_worker.py` swapped to its HEAD (plan-03) bytes while the derive and compose changes were present (the keyword existed but nothing passed it). The stated arm failed and the control passed:

```
FAILED tests/test_allocator_equity_inception.py::test_job_threads_tiny_base_days_to_the_out_of_window_count[stated-day]
1 failed, 1 passed, 19 deselected in 19.94s
```
`cp` back, `cmp -s` exit 0, then `21 passed in 17.17s` for the whole file.

## PROOF-01 transcripts

Byte backups of the three source files are in the session scratchpad (`proof234-04/impl/`); each neuter was restored with `cp` and checked with `cmp -s` (exit 0) before the next.

**Task 1 arm: remove `tiny_base_days_by_key=` from `_compose` in `job_worker.py`.**
```
FAILED tests/test_allocator_equity_inception.py::test_job_threads_tiny_base_days_to_the_out_of_window_count[stated-day]
1 failed, 1 passed, 19 deselected in 24.22s
cmp=0
2 passed, 19 deselected in 20.10s     (GREEN after restore)
```

**Arm (a): drop the stated-day exemption (`fd < lo or fd > hi`) in `allocator_equity_derive.py`.**
```
FAILED ...::test_job_threads_tiny_base_days_to_the_out_of_window_count[stated-day]
FAILED ...::test_a_stated_tail_day_after_the_last_return_is_not_out_of_window
FAILED ...::test_the_exemption_applies_on_the_writer_basis[stated-days]
FAILED ...::test_compose_passes_a_keys_own_stated_days_to_the_replay
FAILED ...::test_a_departed_key_reads_its_own_stated_days[stated-day]
5 failed, 38 passed in 21.72s
cmp=0
```
Legacy replay, writer mode, compose, job and departed arms all go RED.

**Arm (d), widening: `(fd < lo or fd > hi) and fd not in stated` (a listed day before the first return day is exempt too).**
```
FAILED ...::test_a_listed_day_before_the_window_is_outside_the_ruling
1 failed, 42 passed in 21.19s
cmp=0
```

**Arm (e), widening: `fd < lo or (fd > hi and not stated)` (any non-empty list exempts every post-window day).**
```
FAILED ...::test_a_different_stated_day_keeps_the_post_window_flow_counted
FAILED ...::test_a_listed_day_inside_the_window_changes_nothing
2 failed, 41 passed in 16.09s
cmp=0
```
The scope-edge tests bite in both widening directions (before the window, and past the window on an unlisted day).

**Arm (b): `read_tiny_base_days` returns `frozenset()` on a malformed value instead of raising.**
```
FAILED ...::test_the_reader_refuses_a_malformed_list_without_echoing_it[not-a-list]
FAILED ...::test_the_reader_refuses_a_malformed_list_without_echoing_it[non-string-item]
FAILED ...::test_the_reader_refuses_a_malformed_list_without_echoing_it[non-canonical]
FAILED ...::test_the_reader_refuses_a_malformed_list_without_echoing_it[garbage]
FAILED ...::test_job_refuses_a_malformed_tiny_base_days_as_corrupt_input[not-a-list]
FAILED ...::test_job_refuses_a_malformed_tiny_base_days_as_corrupt_input[bad-day]
6 failed, 37 passed in 29.62s
cmp=0
```
(The impossible-day shape passes under this neuter because it only neutered the type and pattern checks; `date.fromisoformat` still raises. It is covered by the unneutered reader.)

**Arm (c): remove the departed-branch read (`tiny_base_days_by_key[api_key_id] = read_tiny_base_days(departed_payload)`) from `job_worker.py`.**
```
FAILED ...::test_a_departed_key_reads_its_own_stated_days[stated-day]
1 failed, 42 passed in 41.43s
cmp=0
43 passed in 40.53s     (GREEN after restore)
```

## Verification

- Task 1 command (three files): `214 passed, 3 warnings in 32.05s` (floor 213).
- Task 2 command (wider allocator set): `928 passed, 6 warnings in 279.73s` (floor 914).
- CI strict mypy (`mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`) after each task and after the final commit: `Success: no issues found in 143 source files`.
- Acceptance greps (comment lines excluded): `tiny_base_days` in `allocator_equity_derive.py` >= 3, `tiny_base_days_by_key` in `allocator_equity_compose.py` >= 2, `read_tiny_base_days` in `job_worker.py` >= 2, `read_tiny_base_days(departed_payload)` in `job_worker.py` = 1, `tiny_base_days` lines in the inception test = 19 (>= 10).
- Not run: `src/__tests__/tiny-base-literal-pin.test.ts` (the worktree has no `node_modules`). The writer line it pins (`_key_inputs_payload["tiny_base_days"] = _tiny_listed`) is not in any diff of this plan.
- No DegradeReason or DeriveRefusal member added, no migration, no `.planning/` (other than this SUMMARY), VERSION, CHANGELOG.md, TODOS.md or package.json change in the code commits.

## Deviations from Plan

None - plan executed as written. One ordering note: the departed-branch read landed with Task 1's commit (same loop, same edit) instead of Task 2, so the "departed arm RED on Task 1's tree" step was proven by neuter arm (c) rather than by a pre-fix run.

## Auth gates

None.

## Known Stubs

None.

## Threat Flags

None. T-234-12 (scope) is mitigated by arms (a), (d), (e); T-234-14 (error text) by the reader tests asserting the stored value is absent; T-234-13 accepted as planned.

## Notes

- `.planning/STATE.md` showed a working-tree modification in this worktree that this plan did not make (a tool hook rewrote it during the run). It was never staged or committed here.

## Self-Check: PASSED

Files exist, commits 3cba58b55 and 1c017fdca are ancestors of HEAD, all four modified files carry the named symbols.
