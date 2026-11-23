---
phase: 216-csvstatus-a-malformed-csv-upload-answers-422-with-recoverabl
plan: 01
subsystem: api
tags: [fastapi, process-key, status-contract, csv, pytest, vitest]

requires:
  - phase: 215
    provides: "Per-arm status pins for the /process-key _scope_rejected gate (Option A, pin today, book the fix)"
provides:
  - "A CSV validator verdict on the /process-key synchronous gate answers 422 with recoverable false"
  - "Literal pins for the 422 arm and for the two clauses that keep 424 recoverable true"
affects: [process-key public error contract, ship CHANGELOG for Phase 216]

actuals:
  tokens: 3000
  tasks: 3
  commits: 3
plan_head_before: 3f978cbafbf3f6c50e8e4220255245c6165b1fb0
plan_head_after: 15602a851b66b1884587ee81e845533ddba161e8

tech-stack:
  added: []
  patterns:
    - "Source-discriminated rejection arm placed before the allow-list-of-permanent, default-transient pre-gate"

key-files:
  created: []
  modified:
    - analytics-service/routers/process_key.py
    - analytics-service/tests/test_process_key_scope_rejection_statuses.py
    - analytics-service/tests/test_process_key.py
    - src/lib/seam-venue-vocabulary.invariant.test.ts
    - src/lib/process-key-client.ts

key-decisions:
  - "Discriminator is body.source == csv plus a non-null code other than CSV_UPSTREAM_FAIL, never a code allow-list, because the rule family is open-ended"
  - "recoverable is stated False on the new arm because _envelope_error derives True for every CSV code"
  - "exchange PERMANENT_VALIDATION_ERROR_CODES, _run_validate_only, long_fetch.py and services/ left untouched"

patterns-established:
  - "A contract arm's pins state each clause as its own row, so each clause has a neuter that turns exactly its row RED"

requirements-completed: [216-GOAL]

coverage:
  - id: D1
    description: "CSV validator verdict (rule family, CSV_VALIDATION_FAILED, CSV_TOO_LARGE, CSV_FORMAT_UNSUPPORTED) on the synchronous gate answers 422, ok false, recoverable false, pandera_errors still forwarded, failure_case never on the wire"
    requirement: "216-GOAL"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_process_key_scope_rejection_statuses.py#test_csv_validator_verdict_answers_422_not_recoverable"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_process_key.py#test_sync_pipeline_rejection_also_forwards_the_breakdown"
        status: pass
    human_judgment: false
  - id: D2
    description: "CSV_UPSTREAM_FAIL on csv and a CSV-looking code on a non-csv source stay 424 recoverable true; permanent five and the fallback stay 403; validate-only stays 200"
    requirement: "216-GOAL"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_process_key_scope_rejection_statuses.py#test_retryable_verdicts_stay_424_recoverable"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_process_key_scope_rejection_statuses.py#test_validate_only_invalid_answers_200_ok_false"
        status: pass
    human_judgment: false
  - id: D3
    description: "Full gates: analytics pytest, CI mypy strict, full vitest suite"
    verification:
      - kind: other
        ref: "pytest tests/ (15081 passed, 1 pre-existing local-only failure); mypy strict (Success, 142 files); npm test (1 pre-existing file red, unrelated)"
        status: pass
    human_judgment: true
    rationale: "Two reds are pre-existing at the plan base and unrelated to this diff; a human should confirm they are acceptable to ship past (CI has pytest-xdist and a different float platform)"

duration: 729min wall clock (includes idle waits on background runs)
completed: 2026-11-18
status: complete
---

# Phase 216 Plan 01: CSVSTATUS Summary

**A malformed CSV upload that reaches the /process-key synchronous rejection gate now answers 422 with recoverable false, via a source-discriminated arm placed ahead of the venue-transient 424 pre-gate, with literal pins and a neuter-RED-restore control for every clause.**

## Honest scope: no live wizard surface changes at HEAD

This plan changes the `/process-key` public error contract and its pins. It does NOT change anything a wizard user sees today. No live caller reaches the CSV arm of this gate at the plan base: csv-validate sends `step: "validate"` and returns from `_run_validate_only` at 200 before the gate, and CSV finalize goes to the `finalize_csv_strategy_with_returns` RPC, not to `/process-key`. `CsvUploadStep` does not read the Python body's `recoverable`. The ROADMAP clause "the wizard stops offering Retry" has no live surface at HEAD, and nothing here claims one. TS forwards status and body verbatim and 4xx never records on the breaker, so 424 to 422 is breaker-inert and needed no TS behaviour change.

## Performance

- **Started:** 2026-11-18T01:57:24Z
- **Completed:** 2026-11-18T14:06:33Z (wall clock includes idle waits on background pytest and vitest runs)
- **Tasks:** 3
- **Files modified:** 5 (126 insertions, 40 deletions vs the plan base)

## Accomplishments

- New arm in the `_scope_rejected` block: `body.source == "csv"`, `val.error_code is not None`, `val.error_code != "CSV_UPSTREAM_FAIL"` returns 422 with `recoverable=False` stated, the same envelope, and `source_debug_context=val.debug_context` so `pandera_errors` still forwards. It sits after the `write_capable_key_rejected` log and the best-effort draft transition, and before the PYAPIFIX-02 pre-gate. It logs `process_key.csv_validation_rejected`.
- Phase 215 CSV pin renamed to `test_csv_validator_verdict_answers_422_not_recoverable` and re-pinned at 422/false with literals, extended with `CSV_TOO_LARGE` and `CSV_FORMAT_UNSUPPORTED` (8 params, one `error_code=` site).
- New `test_retryable_verdicts_stay_424_recoverable` (rows `csv-upstream-fail`, `teaser-csv-looking-code`) pins the two discriminator clauses at 424/true.
- Module docstring rewritten for the new contract; the old follow-up paragraph is gone. Permanent-set and validate-only pins unchanged (only the validate-only comment wording became past tense).
- Breakdown test in `test_process_key.py` asserts 422 and `recoverable` false; its rows, `verification_id` and PII-marker assertions are byte-identical.
- Tests-subtree `removesSites` pin 64 to 65, measured off the vitest failure (`sites: 65`), with a dated Phase 216 note; the code list did not move.
- Stale status comments corrected in the router (PYAPI-10b block) and in the `postProcessKey` docblock (comment lines only, verified by diff filter).

## Task Commits

1. **Task 1 (tracer): end-to-end CSV verdict to 422 recoverable false** - `ba54fde9a` (feat). RED first: 9 failed (8 params plus the breakdown test), all on status/recoverable; GREEN after the arm: 130 passed. Tracer verified end-to-end before expanding.
2. **Task 2: discriminator pins, docstring, count pin, neuter control** - `c258963d7` (test)
3. **Task 3: stale comments, census, full gates** - `15602a851` (docs)

**Plan metadata:** committed separately (docs: complete plan).

## TDD Gate Compliance

Task 1 is a `type="tracer"` task and Task 2 is `tdd="true"`; the plan is `type: execute`, so the plan-level gate sequence does not apply. Task 1 ran RED (tests edited first, 9 failures seen on status) then GREEN (router arm), committed together as one `feat(216-01)` commit as the tracer contract prescribes. No separate `test(216-01)` RED commit exists for that reason. Task 2's new test passes at once because its two rows pin behaviour the Task 1 arm already provides; its biting is proven by neuters (c) and (d) below, not by a RED commit.

## Neuter-RED-restore control (SC: each pin can fail)

Backup of the router was taken to the scratchpad before the first neuter and re-copied over the file before each one. Each reading is the FULL list of RED ids.

| Neuter | Change | Result |
|---|---|---|
| (a) | new arm `status_code=422` to 424 | 9 failed: all 8 params of `test_csv_validator_verdict_answers_422_not_recoverable` (MONOTONIC_DATES, COLUMN_IN_DATAFRAME, PARSE_ERROR, CSV_VALIDATION_FAILED, DAILY_RETURN_LOWER_BOUND, COERCE_DTYPE('DATETIME64[NS]'), CSV_TOO_LARGE, CSV_FORMAT_UNSUPPORTED) plus `test_process_key.py::test_sync_pipeline_rejection_also_forwards_the_breakdown` |
| (b) | delete `recoverable=False` | 9 failed, the same nine ids as (a) (the derivation returns True) |
| (c) | delete `val.error_code != "CSV_UPSTREAM_FAIL"` clause | 1 failed: `test_retryable_verdicts_stay_424_recoverable[csv-upstream-fail]` |
| (d) | replace `body.source == "csv"` with `True` | 22 failed: the 5 `test_permanent_codes_answer_403_not_recoverable` params, `test_retryable_verdicts_stay_424_recoverable[teaser-csv-looking-code]`, and 16 tests in `test_process_key.py` (`test_process_key_validate_failure_returns_envelope`, the 3 `write_capable_key` params, `scope_rejection_survives_rpc_failure`, the 5 `venue_transient_answers_424_recoverable` params, the 5 `caller_fault_stays_403_terminal` params, `probe_failed_body_does_not_contradict_itself`) |

Final restore from the byte backup, `cmp` against the backup: identical, exit 0. A second backup/restore pair around the HEAD-router comparison in Task 3 was also `cmp` identical. No `git checkout`, `git restore` or `git stash` was used.

## Census (Task 3)

| File | What it states | Edited | Why |
|---|---|---|---|
| `analytics-service/routers/process_key.py` (PYAPI-10b block) | listed "a malformed CSV" among 403 faults | yes | stated this arm's status; now points at the 422 arm and the 424 pre-gate |
| `src/lib/process-key-client.ts` docblock | CSV/ordinary validation at 403; 403-vs-422 split "homeless" | yes | stated this arm's status; comment lines only (diff filter printed no non-comment line) |
| `analytics-service/docs/STATUS_CONTRACT.md` | no section 7 row for this gate; section 8 is a how-to | no | states no CSV arm status |
| `src/__tests__/contracts/REGISTRY.md` | no CSV status | no | nothing to update |
| `analytics-service/tests/test_csv_rule_family_oracle.py` | asserts no status | no | nothing to update |
| `analytics-service/routers/internal.py`, `tests/test_status_contract_exchange_internal.py` | 424 for CSV FINALIZE via another route | no | different route, not this gate |
| `src/app/api/verify-strategy/route.ts`, `route.test.ts` | validate-only 200 vs gate 403 for the teaser (exchange) flow | no | still true; not the CSV arm |
| `analytics-service/services/ingestion/long_fetch.py` | its own `_scope_rejected` | no | a different gate, untouched |
| `analytics-service/tests/test_process_key.py` lines near `_scope_rejected` comments | 403 for an ordinary `not val.valid` (non-CSV AUTH_FAILED) and the PYAPIFIX-02 history | no | non-CSV, still true |
| `wizardErrors.*` files | 422/424 only for validate-key classifier, venue and MT5 codes | no | never this gate's CSV arm |
| `seam-venue-vocabulary.invariant.test.ts` `CSV_RULE_CODE_FAMILY` | family disposition, not a status | no beyond Task 2's count note | |

The third census grep (a `recoverable`/`retry` claim next to a CSV code) returned nothing.

## Gates

- **Analytics pytest, full suite:** 15081 passed, 93 skipped, 1 failed. The one failure is `tests/test_xdist_group_is_real.py::test_shared_db_group_runs_on_one_worker_with_the_group_suffix`, PRE-EXISTING and LOCAL-ONLY: `pytest-xdist` is not installed in this machine's python (`ModuleNotFoundError: No module named 'xdist'`), so it fails identically with this diff absent. Not touched.
- **CI mypy strict** (command copied verbatim from `.github/workflows/ci.yml`): `Success: no issues found in 142 source files`.
- **Full vitest (`npm test`):** 1240 files passed, 1 failed. The failure is `src/lib/factsheet/compute.conventions.test.ts` (2 inline snapshots, last-digit float differences such as `0.036844507138639` vs `0.036844507138638946`). Pre-existing and unrelated: it fails identically with the router rewritten to the plan base copy (byte backup taken, restored, `cmp` identical), and it reads nothing this diff touched. Not edited.
- **`npx vitest run src/lib/seam-venue-vocabulary.invariant.test.ts`:** 27 passed after the pin move. No other pin moved, so no STOP condition was hit.
- **`verify-plan-anchors.mjs`:** exit 0 (18 claims checked).

## Decisions Made

None beyond the plan. The 64 to 65 pin move was the plan's own predicted delta, measured rather than assumed.

## Deviations from Plan

None - plan executed exactly as written. One note: Task 1 produced a single commit holding both RED edits and the GREEN arm, as the tracer task is specified; the RED state was observed and recorded before the arm was written.

## Issues Encountered

- A first full run of the two-file pytest was moved to the background by the harness after 180s although it normally takes under 10s. It completed normally (9 failed RED, as expected). No action needed.

## Known Stubs

None.

## Threat Flags

None. The new arm reuses `_envelope_error(..., source_debug_context=val.debug_context)`, so `failure_case` still never crosses the wire (T-216-01, pinned by the breakdown test's PII-marker assertion), and a non-csv source cannot reach the 422 arm (T-216-02, pinned by the teaser row and neuter (d)).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- The ship CHANGELOG should say plainly that no live wizard surface changes at HEAD, and name the `TODOS.md` entries this phase closes, if any.
- Not touched on purpose: VERSION, package.json, CHANGELOG.md, TODOS.md, STATE.md, ROADMAP.md, `.planning/` other than this file, TEST and PROD databases.

## Self-Check: PASSED

- Files modified exist and `git diff` against the plan base shows exactly the five planned files.
- Commits `ba54fde9a`, `c258963d7`, `15602a851` are ancestors of HEAD; `git rev-list --count` from the base is 3.

---
*Phase: 216-csvstatus-a-malformed-csv-upload-answers-422-with-recoverabl*
*Completed: 2026-11-18*
