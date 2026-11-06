---
phase: 185-deribitflowtime-a-deribit-day-s-return-is-measured-against-t
plan: 04
subsystem: analytics-derive
tags: [deribit, allocator, key_inputs, caveat-flag, literal-pin, tdd]
status: complete

requires:
  - phase: 185-deribitflowtime
    provides: "plan 185-01 verdict B: the cash basis mis-books option premium and payout days"
provides:
  - "key_inputs field options_cash_basis: true (present-only bool) written by the key-mode Deribit derive when the ledger has option activity on the cash basis"
  - "OPTIONS_CASH_BASIS_FLAG and the strict reader isOptionsCashBasis in src/lib/options-cash-basis-flag.ts"
  - "a cross-language literal pin for the stored key"
  - "the F3 founder answer (D-09), read by plans 185-05 and 185-08"
affects: [185-05, 185-08]

plan_head_before: df9847e9fdf77a781f9c94203dfedc7c51eaffe8
plan_head_after: 69ff1bc738e90bbf1e4b2126f99e47920c67abe0
actuals:
  tokens: 9000
  tasks: 3
  commits: 5

tech-stack:
  added: []
  patterns:
    - "present-only bool in the key_inputs payload, written with an `is True` check and read with `=== true`"
    - "one independent literal pinned against a Python writer and a TS constant by reading both files raw"

key-files:
  created:
    - src/lib/options-cash-basis-flag.ts
    - src/__tests__/options-cash-basis-literal-pin.test.ts
    - analytics-service/tests/test_options_cash_basis_caveat.py
  modified:
    - analytics-service/services/job_worker.py

key-decisions:
  - "F3 / D-09 (founder 2026-11-01): amber note in the existing paragraph (placement a), raised by option activity on the cash basis with no return threshold (trigger a), self-clearing per key once PR-2 lands (removal a)."
  - "The caveat is a new flag with its own true sentence, not flow_timing_day_level_large (RESEARCH Q8)."

requirements-completed: [SC-3, SC-5]

duration: 25min
completed: 2026-11-01
---

# Phase 185 Plan 04: Interim options caveat flag (writer half) Summary

An allocator key whose Deribit options are measured at cash value now stores `options_cash_basis: true` in its `key_inputs` row, raised only by a strict `has_option_activity is True`, with the key literal pinned across Python and TypeScript.

## Founder answer (F3, recorded as D-09 in 185-CONTEXT.md)

f3-answer: placement=a trigger=a removal=a sentence="Some days on a Deribit account were measured against its cash balance, which leaves out open option positions, so their returns can be extreme."

## Accomplishments

- Task 1 (tracer): the key-mode Deribit derive sets a local `_options_cash_basis_caveat` right after the cash `combine_native_ledger` call, inside the existing `if is_key_mode and denominator_config is None:` block, so both epilogue exits (under-two-days short-circuit and the normal exit) see it. `_run_key_mode_compose_epilogue` writes `_key_inputs_payload["options_cash_basis"] = True` beside the NAVMTM `marks_since` block, present only when true.
- `src/lib/options-cash-basis-flag.ts` exports `OPTIONS_CASH_BASIS_FLAG = "options_cash_basis"` and `isOptionsCashBasis(value: unknown)` returning `value === true`. `src/__tests__/options-cash-basis-literal-pin.test.ts` reads `job_worker.py` and the module raw and compares both keys to one independent literal.
- Task 2 (checkpoint:decision): F3 answered by the founder and recorded by the orchestrator (line above, D-09).
- Task 3: trigger a means no production code change. A strictness test (`test_the_caveat_is_raised_only_by_a_strict_true`, parametrized over True, 1 and "true") pins the `is True` check.

## Task Commits

| Task | Commit | Message |
|---|---|---|
| 1 RED | 40a3c71b4 | test(185-04): RED - an options book on the cash basis carries no caveat |
| 1 GREEN | 075a0c5b1 | feat(185-04): an allocator key on cash-basis options carries a caveat flag |
| 2 | faec8c709 | docs(185-04): record founder answer F3 (D-09) (orchestrator) |
| 3 | 69ff1bc73 | test(185-04): RED - the caveat's strictness and the F3 trigger |

`commits: 5` in the frontmatter is `git rev-list --count df9847e9f..69ff1bc73`. Two of the five are orchestrator-authored (the F3 record and `d7fd596d8`, the phase-start state commit); three are this executor's task commits. No per-plan ledger file existed in the git dir for this continuation, so the base is the Task 1 `PLAN_BASE` scratch value.

## RED evidence

- Task 1: `/tmp/deribitflowtime-04/red1.log` held the failing runs of both the Python tests and the literal pin before the write existed (both modules failed).
- Task 3: `/tmp/deribitflowtime-04/red2.log` shows the strictness test PASSING (5 passed). That is by design and not a RED in the usual sense: under trigger a the strictness test is a pin on Task 1's existing `is True`, and its ability to fail is proven by the neuter drill below, not by a failing first run. The commit message says so.

## Neuter drill (strictness, T-185-12)

Byte backup of `analytics-service/services/job_worker.py` to `/tmp/deribitflowtime-04/job_worker.py.bak`. The setter `_options_cash_basis_caveat = _completeness.has_option_activity is True` was loosened to `bool(_completeness.has_option_activity)`. Result (`neuter1.log`):

```
FAILED tests/test_options_cash_basis_caveat.py::test_the_caveat_is_raised_only_by_a_strict_true[int-one]
FAILED tests/test_options_cash_basis_caveat.py::test_the_caveat_is_raised_only_by_a_strict_true[string-true]
2 failed, 3 passed
```

Restored with `cp` and `cmp` printed no difference (working tree clean after). The first attempt used BSD `sed -i` with a mangled argument, errored before changing anything, and was restored and `cmp`'d too.

## Verification results

- `python3 -m pytest tests/test_options_cash_basis_caveat.py tests/test_mtm_single_key.py tests/test_job_worker_deribit.py`: 65 passed.
- `python3 -m pytest tests/test_allocator_equity_writer_basis.py tests/test_allocator_equity_dropped_day_pnl.py tests/test_nav_marks_compose_roundtrip.py`: 187 passed.
- CI mypy line, verbatim, from `analytics-service/`: `Success: no issues found in 131 source files`.
- `npm run typecheck`: clean. `npm run lint`: ran clean through the planning-hygiene, ROADMAP-structure and canonical-domain checks (last lines OK).
- `npx vitest run src/__tests__/options-cash-basis-literal-pin.test.ts src/__tests__/nav-marks-start-literal-pin.test.ts`: 2 files, 13 tests passed.
- Strategy-mode gates untouched: `git diff df9847e9f HEAD -- analytics-service/services/job_worker.py | grep -c '^-.*not is_key_mode'` prints 0. Trigger a: `grep -ac '> 0.5' job_worker.py` is 0 at both `PLAN_BASE` and HEAD (unchanged, as required).
- Task 2 verify re-run after writing this SUMMARY: see the exit code appended at the end of this file.

## Deviations from Plan

None - plan executed as written. No pre-existing test pinned the exact key set of a Deribit option-activity `key_inputs` payload, so no existing test needed the new key and no ccxt key-set pin was edited.

## PR-1 ship notes

- An allocator key with Deribit options measured at cash value now carries a caveat flag in its stored derive inputs.
- The flag is a bool, present only when true, never a count, amount, instrument or date.
- The flag leaves on its own once PR-2 lands (plan 185-08 narrows the trigger to "ended on the cash basis").
- Nothing user-visible changes until plan 185-05 reads the flag; this plan is the writer half.

## Known Stubs

None.

## Threat Flags

None. The new surface is one bool in an existing owner-RLS row (T-185-13).

## Task 2 verify re-run

Task 2 automated verify, re-run after this SUMMARY was written: exit code 0 (exactly one well-formed f3-answer line, one F3 D-line in 185-CONTEXT.md, trigger a so no ROADMAP correction note is required, no heading between the Phase 185 heading and its Plans list).

## Self-Check: PASSED

Found: src/lib/options-cash-basis-flag.ts, src/__tests__/options-cash-basis-literal-pin.test.ts, analytics-service/tests/test_options_cash_basis_caveat.py. Commits 40a3c71b4, 075a0c5b1, faec8c709, 69ff1bc73 are ancestors of HEAD.
