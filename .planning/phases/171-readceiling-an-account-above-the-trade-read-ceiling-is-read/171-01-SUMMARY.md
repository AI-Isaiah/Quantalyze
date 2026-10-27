---
phase: 171-readceiling-an-account-above-the-trade-read-ceiling-is-read
plan: 01
subsystem: testing
tags: [probe, bybit, trade-read, d-01, sc-3, read-only]

requires:
  - phase: 167.2.1.1.2.1-tradepages
    provides: the read-only allocator history probe and its closed record schema
provides:
  - "the probe's account record names which limit stopped a cut-short read (truncated_site), the window age bucket, that window's call count and the read's elapsed seconds"
  - "a deployed-names guard: the probe refuses (exit 2, before any decrypt) against a rebuild module that lacks a name it reads"
affects: [171-02, 171-05, 171-11, 171-12]

status: complete
actuals:
  tokens: 7400
  tasks: 3
  commits: 3
plan_head_before: dc161d9a6651ae50cbba5b6b43a198ee62453692
plan_head_after: 32afaf14097331c16f52a082a5ea0b5e3591e84e

tech-stack:
  added: []
  patterns:
    - "typed site first, call-log derivation second: the probe runs against code deployed before the change that adds the typed site"
    - "a declared tuple of every rebuild name the probe reads, pinned equal to the AST by a test"

key-files:
  created: []
  modified:
    - analytics-service/scripts/allocator_history_probe.py
    - analytics-service/tests/test_allocator_history_probe.py

key-decisions:
  - "The stall is tested before the ceiling because the deployed read tests it first; a 100th call that stalls is the stall."
  - "The stall's 'added nothing new' test compares the last call against every earlier call of the read, not only its own window, because the deployed read's seen set spans the whole read."

patterns-established:
  - "Closed record vocabulary grows only with a validator, a default and a lockstep key tuple"

requirements-completed: [SC-3]

duration: ~1h (8 min of it the full suite)
completed: 2026-10-27
---

# Phase 171 Plan 01: D-01 probe change Summary

**The read-only allocator history probe now says which limit stopped a cut-short Bybit read, in which window age, after how many calls in that window and how long the read ran, derived from its own call log so it can be run against the worker code deployed before Phase 171 ships.**

## Performance

- **Tasks:** 3 of 3 (1 tracer, 2 auto/tdd)
- **Files modified:** 2 (the probe and its test file); nothing under `analytics-service/services/`
- **Probe was never run** against TEST, PROD, Railway or a venue; every test uses fakes.

## Accomplishments

- Four closed keys appended to `ACCOUNT_RECORD_KEYS`, each with a validator and a default: `truncated_site`, `last_window_age_bucket`, `last_window_calls`, `read_elapsed_s`.
- `derive_truncated_site`, `truncated_site_of` (typed `site` attribute first), `window_age_bucket`, `last_window_calls`, the `_monotonic` seam and two derived values on `_Call` (`newest_ts`, `cursor_repeated`; no cursor text is kept).
- `DEPLOYED_ER_NAMES` (11 names) and `missing_deployed_names()`; `run()` refuses with exit 2 before the first read when one is missing, printing a count only.

## Task Commits

1. **Task 1 (tracer): the record names the stop site end to end through run()** - `030742017` (feat)
2. **Task 2: every derivation case, the typed site first, the closed age buckets** - `520f2849c` (test)
3. **Task 3: the deployed-names guard, the static pins, drills K, L, M** - `32afaf140` (test)

PLAN_BASE (plan_head_before): `dc161d9a6651ae50cbba5b6b43a198ee62453692`.

## Tracer record (labels, counts and tokens only)

The tracer test's account line for a Bybit window read to the 100-call page ceiling (scratch run of the same test):

```
{"account":"a1","bybit_members":1,"comparable":false,"days_compared":0,"days_differing":0,"days_incomplete":0,"failure_class":"truncated","first_page_rows":100,"last_window_age_bucket":"365-546","last_window_calls":100,"max_rel_diff":"field-absent","member_refusal":"none","members_failed":1,"members_read":0,"okx_members":0,"okx_order_readings":0,"okx_order_violations":0,"okx_passes_ended_full":0,"other_members":0,"read_elapsed_s":0,"rebuilt_days":0,"record":"account","run_date":"2026-10-23","selection":"ok","stored_days":0,"trade_calls":100,"trades_read":10000,"transfers_older_365d":0,"truncated_site":"bybit_window_ceiling","window_days":730,"zero_contribution_members":0}
```

## Verification evidence

- RED first, Task 1: `FAILED tests/test_allocator_history_probe.py::test_a_truncated_bybit_read_names_the_window_ceiling_from_the_call_log` with `KeyError: 'truncated_site'` (1 failed, 86 passed).
- Task 2 and 3 RED: the tracer already contained the implementation the later tests exercise, so those tests were green on the Task 1 probe (they are pins on behaviour Task 1 built). To still see them able to fail they were run against the PLAN_BASE probe (byte backup, `git show` of the base, restore, `cmp` exit 0): Task 2 tests 24 failed, 40 passed (`red-task2.log`); Task 3 tests `test_every_rebuild_name_the_probe_reads_is_declared` and `test_a_rebuild_module_missing_a_declared_name_refuses_before_any_decrypt` FAILED, the static store pin passed on the base (it is a pin; drills below show the other two rules can fail).
- Probe test count: `def test_` 38 at PLAN_BASE, 53 after (parametrized cases add more).
- Drills (backup `probe.fixed`, neuter, see FAILED, `cp` back, `cmp` exit 0 each time):
  - **K** (ceiling check moved above the stall check): `FAILED ...::test_a_stall_on_the_hundredth_call_is_the_stall_not_the_ceiling`, 1 failed 66 passed, cmp 0.
  - **L** (`truncated_site_of` ignores the exception's `site`): `FAILED ...::test_a_typed_site_on_the_exception_wins_over_the_call_log`, 1 failed 66 passed, cmp 0.
  - **M** (the `missing_deployed_names()` call removed from `run()`): `FAILED ...::test_a_rebuild_module_missing_a_declared_name_refuses_before_any_decrypt`, 1 failed 66 passed, cmp 0.
- Deployed-names check against `origin/main:analytics-service/services/equity_reconstruction.py` (AST of module-level defs, classes and assignments): `deployed-names: 11 declared, 0 missing`.
- Full analytics suite from `analytics-service/`: `12953 passed, 96 skipped` (the skips are pre-existing; none are in the probe test files).
- CI mypy line verbatim: `Success: no issues found in 123 source files`. Probe mypy: `Success: no issues found in 1 source file`.
- `git diff PLAN_BASE HEAD -- analytics-service/services` empty.

## Deviations from Plan

### Auto-fixed Issues

None. Two judgement calls, neither a change of behaviour the plan fixes:

1. **Stall test spans the whole read, not only the last window.** `derive_truncated_site` decides "the last full page added no new fill" against every earlier call, because the deployed `_fetch_bybit_trades` keeps one `seen` set for the whole read. Windows of one Bybit read are disjoint in time, so this equals the plan's per-window rule on real data and is exact against the deployed code.
2. **Cursor comparison is local.** `_page_cursor` re-implements the three-line `nextPageCursor` read instead of calling `er._next_page_cursor`, so it adds no `er.` name to `DEPLOYED_ER_NAMES` (11 names, not 12).

### Environment notes

- Scratch files lived in the session scratchpad directory instead of `/tmp/readceiling-01` (the plan's verify blocks name that path; the same commands were run against the scratchpad path). The venv was linked after a byte-identical `requirements.txt` check (`analytics-service/.venv` is git-ignored).
- The tracer's summary-record assertion compares against `hp.SUMMARY_RECORD_KEYS`.

## Known Stubs

None.

## Threat Flags

None. The new record keys are closed tokens and counts validated by the one emitter (T-171-01, tests assert fixture ids and cursors never reach stdout or stderr); the probe's source names neither a writer nor the resumable store nor its tables (T-171-02, static pins); the deployed-names guard and drill M cover T-171-03.

## What the orchestrator must know

- The probe file is ready to ship to the worker for the plan 05 reading. Against the deployed (pre-171) code it derives `truncated_site` from the call log: `bybit_window_ceiling`, `bybit_stalled_page`, `bybit_stalled_one_ms`, or `unknown`. A typed `site` from plan 02 wins when present; plan 10 should pin its typed set against `_TRUNCATED_SITES` (the nine typed tokens are already in the tuple).
- `last_window_age_bucket` is taken from the last recorded call's `since` and the run day; an exception raised before any call was recorded gives `none`.
- `read_elapsed_s` is the sum of whole seconds over every member the probe attempted (a failed member's time to its failure included).

## Self-Check: PASSED

- `analytics-service/scripts/allocator_history_probe.py` and `analytics-service/tests/test_allocator_history_probe.py` exist and are committed.
- Commits `030742017`, `520f2849c`, `32afaf140` are ancestors of HEAD on `wt/171-p01`.
