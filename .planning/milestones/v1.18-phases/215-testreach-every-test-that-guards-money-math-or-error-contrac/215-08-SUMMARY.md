---
phase: 215-testreach-every-test-that-guards-money-math-or-error-contrac
plan: 08
subsystem: testing
tags: [pytest, vitest, process-key, status-contract, csv-validator, pandera, vocabulary-guard]
requires: ["215-03", "215-04"]
provides:
  - "tests/test_process_key_scope_rejection_statuses.py: per-arm status and recoverable pin for the /process-key _scope_rejected gate (Option A, pin only)"
  - "tests/test_csv_rule_family_oracle.py: the CSV rule family enumerated by executing the validator, compared with a hand-typed set"
  - "CSV_RULE_CODE_FAMILY sibling scan in seam-venue-vocabulary.invariant.test.ts with a disposition for every member"
affects: [analytics-service/tests, src/lib]
tech-stack:
  added: []
  patterns: ["two independent derivations of one family (executed oracle, source scan) compared with each other", "router taken from tests.test_process_key, never imported directly"]
key-files:
  created:
    - analytics-service/tests/test_process_key_scope_rejection_statuses.py
    - analytics-service/tests/test_csv_rule_family_oracle.py
  modified:
    - analytics-service/tests/test_process_key.py
    - src/lib/seam-venue-vocabulary.invariant.test.ts
key-decisions:
  - "Option A (founder 2026-11-15): every arm pinned at today's status, no behaviour changed. The CSV arm is pinned 424 with recoverable true and the module docstring names why that is wrong (a retry of the same bytes cannot succeed)."
  - "The family is a SIBLING of the derived literal population, not a member: joining it would have moved EXPECTED_EMITTED_CODES, its floor and the verdict exemption table, which describe literal error_code sites."
  - "Pandera built-ins (COLUMN_IN_DATAFRAME, NOT_NULLABLE, COERCE_DTYPE, DTYPE) are found by execution in the oracle and hand-typed in the vitest; test (4) compares the vitest family with the oracle's literal sets read by a narrow regex, so the two cannot drift apart."
  - "CSV_VALIDATION_FAILED (the adapter's empty-list fallback) is a family member with an exemption, because the Task 1 pin names it and it is a real wire code."
status: complete
completed: 2026-11-15
actuals:
  tokens: 28000
  tasks: 3
  commits: 3
plan_head_before: ff7853e7be71eafc6bd26b4ac68762a493fa8fea
plan_head_after: 7f170b109770188c28d9e37ca7db8b2394e57ce4
---

# Phase 215 Plan 08: The /process-key rejection contract and the CSV rule family are pinned Summary

Every arm of the route's `_scope_rejected` gate now has a literal status and `recoverable` pin, the loose `in (403, 424)` assertion is exactly 424, and the CSV rule family that `csv_adapter` upper-cases into `error_code` is enumerated twice (a pytest oracle that executes the validator, a vitest scan of its source) with a disposition required for every member. No production file changed.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | SC-7b tracer: per-arm status pin (Option A) | 7af3c33d4 | test_process_key_scope_rejection_statuses.py (new), test_process_key.py |
| 2 | SC-7a: Python oracle enumerating the CSV family by execution | bed09b428 | test_csv_rule_family_oracle.py (new) |
| 3 | SC-7a: the venue-vocabulary guard sees the family | 7f170b109 | seam-venue-vocabulary.invariant.test.ts |

## What was measured, and pinned

Arms, at HEAD, all literals in the test:

| Arm | Status | recoverable |
| --- | ------ | ----------- |
| `AUTH_FAILED`, `PERMISSION_DENIED`, `TRADE_SCOPE`, `WITHDRAW_SCOPE`, `MISSING_SCOPE` | 403 | false |
| no error code, `read_only` false (the `VALIDATION_UNEXPECTED` fallback) | 403 | false |
| `MONOTONIC_DATES`, `COLUMN_IN_DATAFRAME`, `PARSE_ERROR`, `CSV_VALIDATION_FAILED`, `DAILY_RETURN_LOWER_BOUND`, `COERCE_DTYPE('DATETIME64[NS]')` | 424 | true |
| validate-only step, invalid result | 200, `ok` false | n/a |

All of this matched the CONTEXT measurement, so nothing was stopped or escalated. The permanent set in `exchange.PERMANENT_VALIDATION_ERROR_CODES` is pinned equal to the five literals, so a new permanent code forces a decision in the pin file.

The CSV family measured at HEAD: 5 custom checks, 4 pandera built-ins, 7 bespoke error rules, 2 info flags (excluded from the oracle, exempted in the vitest), and the adapter's `CSV_VALIDATION_FAILED` fallback. The oracle's execution found all four built-ins plus every custom check by validating broken frames per schema. Its three derivations are: `check.error` off `SCHEMAS`, `failure_cases["check"]` from running the schemas, and an `ast` walk of `"rule"` dict literals.

## For the coordinator: the follow-up named, not booked

Per the founder decision, the follow-up is NOT booked or implemented here. Name for booking after Phase 215 merges: **a malformed CSV answers 424 with `recoverable: true`, which tells the user a retry can succeed when the same bytes fail the same rule.** The fix is its own phase. The pin's module docstring and the CSV test's inline comment both name this. When that phase changes the CSV arm, `test_csv_rule_family_answers_424_recoverable_true_today` is the test it must update on purpose. Ship deletes the D-161-01 entry and the 403-vs-422 entry from TODOS.md and names them in the CHANGELOG.

## RED proofs (SC-9)

All with byte backups in the scratchpad, `cmp` clean after restore, never `git checkout`/`restore`/`stash`.

1. **Route pin** (`routers/process_key.py`): swapped the 424 arm's `not in` for `in`. Result: `11 failed, 3 passed`; failures were all five permanent-code cases and all six CSV cases. Restored from backup, `cmp` clean, `git status` shows the file unchanged, pin back to `14 passed`.
2. **Oracle** (`services/csv_validator.py`): added a dict literal with rule `brand_new_rule_215` beside the `empty` rule. Result: 2 failed (`test_the_bespoke_rule_literals_are_the_seven_errors_plus_the_two_info_flags` and `test_the_executed_family_equals_the_hand_typed_family`), the message naming `BRAND_NEW_RULE_215`. Restored, `cmp` clean, `6 passed`.
3. **Vitest, new rule**: the same `brand_new_rule_215` edit. Result: `2 failed | 25 passed`; test (1) failed with `[ 'BRAND_NEW_RULE_215' ]` and test (4) failed showing it in the diff. Restored, `cmp` clean.
4. **Vitest, deleted exemption**: removed the `PARSE_ERROR` exemption entry from the vitest file. Result: `1 failed | 26 passed`; test (1) failed with `[ 'PARSE_ERROR' ]`. Restored from the byte backup, `cmp` clean, `27 passed`.

## Verification

- `tests/test_process_key_scope_rejection_statuses.py` 14 passed alone; `tests/test_csv_rule_family_oracle.py` 6 passed alone; `tests/test_process_key.py` 114 passed.
- All three in one pytest invocation (the plan-05 limiter-identity lesson): `134 passed, 15 warnings`. The new route test takes `process_key_router` from `tests.test_process_key`, never from a direct import.
- `npx vitest run src/lib/seam-venue-vocabulary.invariant.test.ts`: 27 passed (22 existing plus the 5 new family tests).
- `ruff check` on both new Python files clean; `npx eslint` on the vitest file clean; `npx tsc --noEmit` clean; `mypy --strict services` 0 issues in 124 files (tests/ stays untyped by design, as ci.yml states).
- `git diff --stat ff7853e7b HEAD -- analytics-service/routers analytics-service/services src/lib/wizardErrors.ts supabase/migrations` prints nothing: no production file, no `wizardErrors.ts`, no migration changed by this plan (SC-8). `git diff --stat origin/main` over the same paths lists only files changed by earlier plans of this phase.
- Full suite serial from `analytics-service/`: `1 failed, 14957 passed, 92 skipped`. The one failure is the known local `tests/test_xdist_group_is_real.py::test_shared_db_group_runs_on_one_worker_with_the_group_suffix` (pytest-xdist is not installed locally). Plan 215-04 left 14919 passed, so the +38 are this plan's 20 new tests plus tests from plans 05 to 07. `npm run lint`: 0 errors (4 pre-existing warnings in unrelated files), planning-hygiene rules OK. `npx tsc --noEmit` clean. `npm test` (the full vitest run) was not executed by this plan; only the one touched vitest file was run.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Tests-subtree count pin moved 60 to 64**
- **Found during:** Task 3, first vitest run
- **Issue:** The existing `SCAN_EXCLUSIONS` entry for the `tests` subtree pins `removesSites: 60` and `removesCodes`. The Task 1 route pin, a new file under `tests/`, carries four `error_code=` sites and one new literal code (`MONOTONIC_DATES`), so the pin went red (64 sites, one extra code). The plan lists this file as modified but did not name the pin.
- **Fix:** bumped to 64, added `MONOTONIC_DATES` to `removesCodes`, with a dated comment in the established style arguing that nothing was excluded and the subtree grew. `MONOTONIC_DATES` is a real `csv_adapter` wire code and a member of the new family, where its disposition lives.
- **Files modified:** `src/lib/seam-venue-vocabulary.invariant.test.ts`
- **Commit:** 7f170b109

**2. [Rule 2 - Missing critical] `CSV_VALIDATION_FAILED` added to the family**
- **Issue:** The plan's family list names the validator's rules; the adapter's empty-list fallback `CSV_VALIDATION_FAILED` is also a real wire code (and is in the Task 1 pin).
- **Fix:** included in both the oracle (`ADAPTER_FALLBACK`) and the vitest, with an exemption saying it is resolved by the code table, plus a test that the adapter still emits it and still calls `first_rule.upper()`.

No other deviations. No auth gates. No stubs introduced. No threat flags: the plan adds tests only.

## Known limits, recorded rather than fixed

- The vitest family cannot see pandera built-ins by itself; they are hand-typed there and held equal to the oracle's literal sets by test (4). The oracle's broken frames must be extended if a new schema format is added; it fails loud (an equality on `SCHEMAS` keys) rather than silently skipping.
- `row.get("check", "unknown")` in the validator has a defensive default that would produce `UNKNOWN`; pandera always supplies the column, so it is not a family member.
- Test (4) reads the oracle's frozenset literals with a narrow regex; if the oracle restructures those four names, test (4) fails with "not found" rather than passing.

## Self-Check: PASSED

- FOUND: analytics-service/tests/test_process_key_scope_rejection_statuses.py
- FOUND: analytics-service/tests/test_csv_rule_family_oracle.py
- FOUND: commits 7af3c33d4, bed09b428, 7f170b109 (ancestors of HEAD)
- Production files byte-identical after each RED proof (`cmp` against the byte backups).
