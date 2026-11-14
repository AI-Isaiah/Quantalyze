---
phase: 207-retryprop-every-error-page-s-try-again-button-works
plan: 01
subsystem: testing
tags: [next, error-boundary, react, vitest, jsdom]

requires:
  - phase: 196
    provides: factsheet/[id]/error.tsx, the boundary shape already calling retry
provides:
  - nine error boundaries whose Try again calls the `retry` prop Next 16.4.2 passes
  - src/__tests__/error-boundaries-retry.test.tsx, a cross-boundary proof through Next's real ErrorBoundary
affects: [any new error.tsx under src/app, Next upgrades (the test imports two Next-internal paths)]

actuals:
  tokens: 9880
  tasks: 4
  commits: 3
plan_head_before: 530f5a6474531760aca3db593a426011ecc9475e
plan_head_after: 4e49a09b8160602d9310554d8bf3f22b05aa10e1

tech-stack:
  added: []
  patterns:
    - "Mount each fs-discovered boundary inside Next's real ErrorBoundary with an AppRouterContext refresh spy, so the props come from Next and not from the test"

key-files:
  created:
    - src/__tests__/error-boundaries-retry.test.tsx
  modified:
    - src/app/error.tsx
    - src/app/global-error.tsx
    - src/app/(auth)/error.tsx
    - src/app/(dashboard)/error.tsx
    - src/app/(dashboard)/admin/error.tsx
    - src/app/(dashboard)/allocations/error.tsx
    - src/app/(dashboard)/compare/error.tsx
    - src/app/(dashboard)/strategies/error.tsx
    - src/app/(dashboard)/strategies/new/wizard/error.tsx
    - the eight colocated error.test.tsx / global-error.test.tsx files

key-decisions:
  - "D-05: real ErrorBoundary shipped; fallback not needed"
  - "D-09 (amended) governs over RESEARCH: colocated tests pass only error and retry, no reset, no spread"

patterns-established:
  - "Boundary count pinned at 10 beside an fs walk: a new boundary is covered automatically, a removed one fails the count"

requirements-completed: [SC-1, SC-2]

duration: ~10min (approximate; start time was not captured)
completed: 2026-11-14
status: complete
---

# Phase 207 Plan 01: RETRYPROP Summary

**Nine error boundaries now call the `retry` prop Next passes (it re-runs the server render), proven by one test that mounts all ten boundaries in Next's real `ErrorBoundary` and fails when one is reverted.**

## Accomplishments

- Renamed the old unstable-prefixed prop to `retry` at the destructure, the props type (`retry: () => void`) and the Try again onClick (`onClick={() => retry()}`) in nine boundaries. `factsheet/[id]/error.tsx` already used it.
- Corrected the five header docblocks that asserted the old contract (admin, allocations, compare, strategies, wizard), dropping the "Next 16.2.0" claim (D-04, D-10).
- Updated the eight colocated tests to pass only `error` and `retry`; the five click arms assert `retry` is called once. Root, global and (auth) are rename-only (amended D-09).
- Added `src/__tests__/error-boundaries-retry.test.tsx` (13 arms): count pin, one arm per discovered boundary, a `reset()` harness self-check, and a static arm.
- D-05: real ErrorBoundary shipped; fallback not needed.

## Evidence

**Base RED (new test, before any rename):**
`Tests  10 failed | 3 passed (13)` — nine boundary arms failed with `TypeError: unstable_retry is not a function` / `expected "vi.fn()" to be called 1 times, but got 0 times`, plus the static arm (`expected [ '(auth)/error.test.tsx', …(16) ] to deeply equal []`). The count, factsheet and self-check arms passed.

**Post-tracer (Task 1, admin renamed):**
`Tests  9 failed | 4 passed (13)` — failing arms exactly: `(auth)/error.tsx`, `(dashboard)/allocations/error.tsx`, `(dashboard)/compare/error.tsx`, `(dashboard)/error.tsx`, `(dashboard)/strategies/error.tsx`, `(dashboard)/strategies/new/wizard/error.tsx`, `error.tsx`, `global-error.tsx`, plus the static arm. Filtered tracer run: `Tests  4 passed | 9 skipped (13)`.

**Post-Task 2:**
`Tests  5 failed | 8 passed (13)` — failing arms exactly the four Task 3 boundaries (allocations, compare, strategies, wizard) plus the static arm. Filtered run: `Tests  8 passed | 5 skipped (13)`. Three colocated tests: `Test Files  3 passed (3)`, `Tests  10 passed (10)`.

**Post-Task 3:** `Tests  13 passed (13)`; `grep -a -rn unstable_retry src/app` empty; nine colocated files plus the factsheet boundaries test: `Test Files  9 passed (9)`, `Tests  45 passed (45)`; `onClick={() => retry()}` in exactly 10 files; 0 files carry a `reset: () => void;` member; 0 "Next 16.2.0" lines in the five headers.

**D-08 neuter (CompareError, byte backup, targeted three-site revert):**
RED run, failing-arm lines:
```
× (dashboard)/compare/error.tsx 15ms
× no file under src/app reads unstable_retry 45ms
AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times
AssertionError: expected [ '(dashboard)/compare/error.tsx' ] to deeply equal []
TypeError: unstable_retry is not a function
Tests  2 failed | 11 passed (13)
```
Restore: `cp -p` from the backup, `cmp` exit 0 with no output, `git status --short` for the file printed nothing, then `Tests  13 passed (13)`.

gc-207-01-neuter: gate=src/__tests__/error-boundaries-retry.test.tsx boundary=(dashboard)/compare/error.tsx result=red restored=identical

**Gates line:** new test `13 passed (13)` | `npx vitest run src/app --project jsdom` `Test Files  469 passed (469)`, `Tests  8481 passed | 3 skipped (8484)` | `role-home-call-sites.test.ts` `Tests  12 passed (12)` | `npx tsc --noEmit -p .` clean, no output | `npx eslint` on the 18 touched files exit 0, no output | `! grep -a -rn unstable_retry src/app` empty.

The 3 skipped tests in the `src/app` run are pre-existing skips in files this plan did not touch; they are reported here, not investigated.

## Task Commits

1. Task 1 (tracer): `0dfbc40f1` — test(207-01): prove Try again through Next's real ErrorBoundary; admin boundary calls retry
2. Task 2: `c7f434ea3` — fix(207-01): root, global, auth and dashboard error boundaries call the retry prop Next passes
3. Task 3: `4e49a09b8` — fix(207-01): allocations, compare, strategies and wizard error boundaries call the retry prop Next passes
4. Task 4: no commit (the neuter was restored byte-identical; no source change)

## Deviations from Plan

None - plan executed exactly as written. The plan's own stated deviation (four tasks, 18 files, Tasks 2 and 3 above the 5-files signal) was followed as written.

Notes:
- `.planning/STATE.md` and `.planning/state.json` carried uncommitted "Phase 207 execution started" edits from the orchestrator when this run began; they are included in the closing docs commit with the plan-progress updates.
- `.planning/codebase/CONVENTIONS.md` and `.planning/codebase/ARCHITECTURE.md` still describe the old prop. Left alone: they sit outside src/app and outside D-04's scope (RESEARCH Pitfall 5).
- No commit message carries an attribution trailer or CI-skip token, per repo rules.
- Closing TODOS `196-ERROR-BOUNDARY-UNSTABLE-RETRY-01`, VERSION and CHANGELOG are left to the ship step.

## Known Stubs

None.

## Threat Flags

None. T-207-01 (digest-only rendering): the colocated digest, error.message and log-tag arms were left untouched and pass. T-207-02: the new test proves `router.refresh` fires once per boundary and was shown to bite (D-08).

## Self-Check: PASSED

- FOUND: src/__tests__/error-boundaries-retry.test.tsx
- FOUND commits: 0dfbc40f1, c7f434ea3, 4e49a09b8 (ancestors of HEAD)
- `cmp` of the compare boundary against its pre-neuter backup: exit 0
