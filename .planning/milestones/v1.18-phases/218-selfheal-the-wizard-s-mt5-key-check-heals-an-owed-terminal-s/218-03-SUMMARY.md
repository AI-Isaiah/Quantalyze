---
phase: 218-selfheal-the-wizard-s-mt5-key-check-heals-an-owed-terminal-s
plan: 03
subsystem: wizard error vocabulary (TypeScript seam)
tags: [mt5, wizard, wire-contract, censuses, selfheal]
status: complete

requires:
  - phase: 218-01
    provides: wire code MT5_TERMINAL_NOT_READY (424, recoverable) and fixture case C9 re-pointed
provides:
  - KEY_MT5_TERMINAL_NOT_READY wizard error key, copy, verdict row and rotate-secret roster entry
  - twin tests on every surface that renders KEY_MT5_TERMINAL_BUSY
affects: [218-04]

actuals:
  tokens: 14000
  tasks: 2
  commits: 2
plan_head_before: 6c6740b000f6671f706550c334a02d8d6235bf11
plan_head_after: 87e65806d2cd031807848ec7ade82f5df7b0491f

key-files:
  modified:
    - src/lib/wizardErrors.ts
    - src/lib/wizardErrors.test.ts
    - src/lib/wizardKeyRosters.test.ts
    - src/lib/seam-venue-vocabulary.invariant.test.ts
    - src/lib/dialog-envelope.invariant.test.ts
    - tests/lib/validate-key-venue-transient-parity.test.ts
    - src/app/api/strategies/create-with-key/route.test.ts
    - src/app/api/strategies/composite/add-key/route.test.ts
    - src/app/api/keys/[id]/rotate-secret/route.test.ts
    - src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.test.tsx
    - src/components/strategy/UpdateMt5SecretDialog.test.tsx

key-decisions:
  - "KEY_MT5_TERMINAL_NOT_READY is not in OUR_DEFECT_KEY_ERROR_CODES: the Python scrub pages per cause, so no Next-side capture and no alert claim in the copy"
  - "BUSY comments narrowed with dated CORRECTED notes to the held-lease emitter; old text kept as lineage"

requirements-completed: [218-SC-3]
completed: 2026-11-19
---

# Phase 218 Plan 03: Wizard learns MT5_TERMINAL_NOT_READY Summary

**Wire code `MT5_TERMINAL_NOT_READY` (424) now reaches the wizard and the rotate-secret dialog as `KEY_MT5_TERMINAL_NOT_READY`, a card that names the real cause (terminal could not be made ready), never says busy, and offers Retry; every hand-typed census moved with dated lineage.**

## Accomplishments

- `wizardErrors.ts`: union member, copy entry (exact copy from the plan, `clear_and_retry` + `request_call`, so `recoverable: true`), `VENUE_WIRE_CODE_TO_VERDICT` row, rotate-secret `DASHBOARD_DIALOG_ROUTE_CODES` entry. Not added to `OUR_DEFECT_KEY_ERROR_CODES`. Union and copy BUSY comments carry dated `CORRECTED 2026-11-19 (Phase 218)` notes.
- Censuses moved in the same commit, each read off its own guard's failure message: frozen rosters +1 each (floors unmoved); emitted-code roster 47 -> 48 (`DERIVED_FLOOR` stays 28, 0.6 x 48 = 28.8); dialog envelope 37 -> 38; parity `DISTINCT_WIRE_CODES` 10 -> 11 (`TOTAL_CASES` stays 18).
- Five twin tests, one per surface, after each BUSY case.

## Verification

- Task 1 verify: 7 files, 633 tests passed. `npm run typecheck` clean. `npm run lint`: 0 errors (4 pre-existing warnings in unrelated files).
- Task 2 verify: 6 files, 464 tests passed.
- `src/lib/seam-venue-vocabulary.invariant.test.ts` and `tests/lib/validate-key-venue-transient-parity.test.ts` are GREEN again.
- `npx vitest run src/lib tests/lib`: 8005 passed, 2 failed in `src/lib/factsheet/compute.conventions.test.ts` (fixtures B and C, FROZEN byte-identity). Untouched by this plan; not investigated further, not caused by it (no factsheet file edited).
- `package-lock.json` unchanged after `npm ci`.

### Neuter-once RED proof

Backed up `src/lib/wizardErrors.ts` to the scratchpad, deleted the `MT5_TERMINAL_NOT_READY` verdict row. The three route twins went RED: `AssertionError: expected 500 to be 424` (create-with-key, composite add-key, rotate-secret: the code fell to the cascade, `3 failed | 319 passed`). Restored from the backup, `cmp` exit 0.

## Deviations from Plan

**1. [Rule 3 - Blocking] `src/lib/wizardErrors.test.ts` carried three more hand-typed pins that went red**
- **Found during:** Task 1 verify (file is in the verify command but not in `files_modified`).
- **Issue:** (a) two `EXPECTED_TABLE_SIZE` pins (102 -> 103, "expected 103 to be 102"), kept in lockstep; (b) the `[164.6.6.3.2 D-07]` test asserting exactly three `MT5_VALIDATION_UNCONFIGURED` raises in `routers/exchange.py` read `expected 4 to be 3`, because plan 01's `skipped_no_house_credentials` arm is a fourth raise.
- **Fix:** moved both pins with dated lineage and forbidden-fragment reasoning. For the fourth arm, the count moved 3 -> 4 and the test now also pins what substantiates "we have been alerted" there: the owed gate pays the scrub then calls `report_scrub_owed_refusal` before the raise, `_scrub_under_lease` calls `_alert_scrub_failed` on every non-scrubbed kind, and the house-credentials kind keeps its alert cause. This keeps the existing exemption honest rather than just bumping a number.
- **Commit:** d660d46fb

**2. Stale cite in the plan, recorded not fixed.** The plan says the `[164.6.6.3.2 D-07]` pin on `been alerted` does not exist in `wizardErrors.test.ts`. It does at HEAD (`FORBIDDEN` fragment `been alerted`, `FORBIDDEN_FRAGMENT_SUBSTANTIATED_FOR`, and the D-07 test). The twins assert both absences anyway. The `KEY_MT5_VALIDATION_UNCONFIGURED` comment's cite was left alone (out of scope).

## Known Stubs

None.

## Threat Flags

None.

## Self-Check: PASSED

- Commits `d660d46fb` and `87e65806d` found on `worktree-agent-aaf3eb61d2185f4b8`.
- All 11 modified files exist; `grep -c KEY_MT5_TERMINAL_NOT_READY` is >= 1 in each of the five twin files and >= 4 in `wizardErrors.ts`.
