---
phase: 215-testreach-every-test-that-guards-money-math-or-error-contrac
plan: 07
subsystem: testing
tags: [wizard, rosters, invariant-tests, vitest, error-contract]

requires:
  - phase: 164.2
    provides: "RATE_LIMITED twin rows and the 409 describe the own-code pins build on"
  - phase: 153.7
    provides: "the W-153.7-1 classifier-reachable guard this plan re-points to live exports"
provides:
  - "src/lib/wizardKeyRosters.ts: both key-step rosters derived per route, two separate Sets"
  - "frozen member-for-member no-behaviour-change pin for both rosters"
  - "own-code tuples and the cascade tuple pinned both directions to their scans"
affects: [215 ship (delete ROSTER-DERIVE-01 from TODOS.md), any future classifier verdict or route code]

actuals:
  tokens: 7000
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "A derived roster is read by guards from the live export; source scans stay for hand-declared rosters only"
    - "A hand-typed tuple is the contract and a source scan is its oracle, both directions, with a hand-typed vacuity floor"

key-files:
  created:
    - src/lib/wizardKeyRosters.ts
    - src/lib/wizardKeyRosters.test.ts
  modified:
    - src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx
    - src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx
    - src/lib/wizardErrors.invariant.test.ts
    - src/lib/wizardErrors.roster-render.test.tsx
    - src/lib/seam-wire-vocabulary.invariant.test.ts
    - src/lib/seam-ratelimit-posture.invariant.test.ts

key-decisions:
  - "The classifier cascade's literal returns stay literal in classifyKeyValidationError. KEY_CLASSIFIER_CASCADE_CODES is typed once and pinned EQUAL, both directions, to the scanned cascade. It is not computed. Only the verdict-table codes and the per-route own codes are derived."
  - "Own-code tuples hold the route's full emitted set (400 scan, 409 scan, RATE_LIMITED, the three permission refusals), so they overlap the classifier-returned codes; the roster is a Set union and the overlap is harmless."
  - "The W-153.7-2 owner test (read TODOS.md, required both steps to cite the closed id) is replaced by a pin on the invariant: neither step declares a local roster, each imports it from wizardKeyRosters."

requirements-completed: [SC-5, SC-8, SC-9]

plan_head_before: c8442b815fad95a758aff94f3e84eef4f3d5d3b5
plan_head_after: 837d883c2335465781f7c7dcf998b082291171a3
status: complete
---

# Phase 215 Plan 07: Per-route derived key-step rosters Summary

Both key-step rosters now come from named sources in `src/lib/wizardKeyRosters.ts` instead of two hand-typed `new Set([...])` literals, and a frozen member-for-member pin proves they equal what the steps shipped at 08451cfcc.

## What shipped

- `wizardKeyRosters.ts` exports `KEY_CLASSIFIER_CASCADE_CODES`, `CLASSIFIER_RETURNED_CODES`, `CREATE_WITH_KEY_OWN_CODES`, `ADD_KEY_OWN_CODES`, `KNOWN_CREATE_WITH_KEY_CODES` (38 members) and `KNOWN_ADD_KEY_CODES` (33 members). The two sets are separate objects with different members (`KEY_ORPHANED` create only, `COMPOSITE_MT5_UNSUPPORTED` add only).
- `CLASSIFIER_RETURNED_CODES` is computed at module load from the live `VENUE_WIRE_CODE_TO_VERDICT` values plus the cascade tuple, minus every code the exported `recogniseSeamErrorCode` translates (so `SEAM_MISCONFIGURED` drops out). The map is not imported and `wizardErrors.ts` is not edited.
- Both step files import their roster; the translate-first then membership logic is byte-identical. About 520 lines of hand-typed roster rows and docblock moved out; the steps keep a short pointer comment dated 2026-11-15.
- Guards re-pointed in the same commit: `wizardErrors.invariant.test.ts` (a `rosterOf` helper takes the two names from the live exports, every floor kept), `wizardErrors.roster-render.test.tsx` (floors 28 and 23 kept), `seam-wire-vocabulary.invariant.test.ts` and `seam-ratelimit-posture.invariant.test.ts` (live rosters appended to the scan result; pinned sorted name lists and `parsed as EMPTY` checks unchanged).
- New pins in `wizardErrors.invariant.test.ts`: each own-code tuple equals its route's contract both directions; `KEY_CLASSIFIER_CASCADE_CODES` equals the scanned cascade both directions; neither step declares a local roster and each imports the derived one.

## The cascade decision, stated exactly

The cascade codes are "typed once and pinned both directions" against the scanned cascade. They are not computed. Only the Map-derived codes and the per-route own codes are derived.

## Frozen members that are neither classifier-returned nor scanner-emitted

None are left unexplained. `KEY_NOT_READ_ONLY` (both rosters) is route-emitted but invisible to the 400 scanner: both routes pick it, `KEY_HAS_WITHDRAW_PERMS` and `KEY_HAS_TRADING_PERMS` with a ternary, so the code is computed and has no `code:` literal beside `error:`. The three are typed in each own tuple, and the invariant test checks each appears as a string literal in the route source. Every classifier-returned code is in BOTH frozen rosters, so no per-route exclusion tuple was needed.

## Verification

- `npx vitest run` on the eight plan files (`wizardKeyRosters.test.ts`, the four re-pointed guards, `seam-transport-attribution.invariant.test.ts`, `ConnectKeyStep.test.tsx`, `MultiKeyConnectStep.test.tsx`): 8 files, 437 tests passed.
- Also run, green: `add-key/route.test.ts`, `ConnectKeyStep.preselect-refusal-class.test.tsx`, `no-email-in-copy`, `key-storage-census`, `seam-budgets.invariant`, `seam-citations.invariant`, `critical-regressions` (7 files, 477 tests).
- `npm run typecheck` clean; `npm run lint` 0 errors (4 pre-existing warnings, none in touched files); eslint clean on all eight touched source and test files.
- `git diff --stat origin/main -- supabase/migrations src/app/api` prints nothing (SC-8; the two route files are not edited).
- Acceptance counts: local `const KNOWN_(CREATE_WITH_KEY|ADD_KEY)_CODES` declarations in the steps: 0 (was 2). `grep -rla ROSTER-DERIVE-01 src`: 0 (was 3). `TODOS.md` mentions in `wizardErrors.invariant.test.ts`: 6 (was 7 at 08451cfcc; the owner test no longer reads the file, the other six are prose).

## RED proofs (SC-9), all restored from byte backups and `cmp`-verified

1. Task 1, delete `KEY_ORPHANED` from `CREATE_WITH_KEY_OWN_CODES`: `wizardKeyRosters.test.ts` went RED on the frozen equality (missing `KEY_ORPHANED`) and on the not-merged pin. Restored, `cmp` identical.
2. Task 1, make `KNOWN_ADD_KEY_CODES` the same object as the create set: RED on the add frozen equality, on "are different objects", and on "not equal as sets". Restored, `cmp` identical.
3. Task 2, add `KEY_ORPHANED` to `ADD_KEY_OWN_CODES` (add-key does not emit it): `wizardErrors.invariant.test.ts` RED on `composite/add-key: the tuple is the route's contract`, naming `inTupleButNotEmitted: ["KEY_ORPHANED"]`. Restored, `cmp` identical.
4. Task 2, make the live `KNOWN_ADD_KEY_CODES` lookup in `seam-wire-vocabulary.invariant.test.ts` an empty set: RED on `KNOWN_ADD_KEY_CODES parsed as EMPTY` (plus the overlap-visibility pin). Restored, `cmp` identical.

## Deviations from Plan

1. **[Rule 2 - Missing critical functionality] Own tuples include the three permission refusals.** The plan described the own tuple as the 400 scan plus the 409 set plus `RATE_LIMITED`. The frozen pin needs `KEY_NOT_READ_ONLY`, which neither the scanner nor the classifier covers, and both routes emit all three permission codes through a computed ternary. They are typed in both tuples and oracled by a literal-presence check in the route source. Without this the frozen pin would have forced an unexplained member. Commit 35c6dacb2 (tuples) and 837d883c2 (test).
2. **Step pointer notes are `//` line comments, not JSDoc.** A JSDoc block left standing before another JSDoc would be a dangling doc comment. No behaviour change.
3. **`npm ci` ran although `node_modules` already existed in the worktree.** No package changed; the lockfile is untouched.

No other deviations. No auth gates. No stubs introduced. No new network, auth or file-access surface, so no threat flags.

## Follow-up owed by the ship step (not done here, per the plan)

Delete the `ROSTER-DERIVE-01` entry from `TODOS.md` and name it in the CHANGELOG entry (CLAUDE.md "TODOS.md holds open work only"). `.planning/WINDOWS.md` was not touched.

## Self-Check: PASSED

- FOUND: src/lib/wizardKeyRosters.ts, src/lib/wizardKeyRosters.test.ts
- FOUND commits: 35c6dacb2, 837d883c2 (both ancestors of HEAD)
