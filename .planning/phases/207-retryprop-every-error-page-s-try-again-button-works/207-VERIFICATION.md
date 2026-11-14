---
phase: 207-retryprop-every-error-page-s-try-again-button-works
verified: 2026-11-14T01:30:00Z
status: passed
score: 8/8 must-haves verified
verified_at_sha: da59407cbd18dcfcb4c643b9d8405e70b7964274
drift_subjects:
  - src/__tests__/error-boundaries-retry.test.tsx
  - src/app/error.tsx
  - src/app/global-error.tsx
  - src/app/(auth)/error.tsx
  - src/app/(dashboard)/error.tsx
  - src/app/(dashboard)/admin/error.tsx
  - src/app/(dashboard)/allocations/error.tsx
  - src/app/(dashboard)/compare/error.tsx
  - src/app/(dashboard)/strategies/error.tsx
  - src/app/(dashboard)/strategies/new/wizard/error.tsx
behavior_unverified: 0
overrides_applied: 0
re_verification: false
---

# Phase 207: RETRYPROP Verification Report

**Phase Goal:** Every error boundary's Try again button calls the `retry` prop Next 16.4.2 actually passes (`{ error, reset, retry }`), not `unstable_retry`, which is undefined at runtime. Closes TODOS `196-ERROR-BOUNDARY-UNSTABLE-RETRY-01`.
**Verified:** 2026-11-14
**Status:** passed
**Re-verification:** No, initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC-1: no error boundary under `src/app` reads `unstable_retry` | VERIFIED | `grep -a -rn unstable_retry src/app` prints nothing (exit 1). The grep is clean across all of `src` too. The static arm of the new test enforces it for `.ts`/`.tsx` under `src/app`. The only remaining hits in the repo (outside `.planning`) are `CHANGELOG.md` and `TODOS.md`, historical ledgers that the ship step owns. |
| 2 | SC-2: one test renders every boundary through Next's own props and proves Try again calls `retry`; RED when one is reverted | VERIFIED | `src/__tests__/error-boundaries-retry.test.tsx` imports Next's real `ErrorBoundary` (`next/dist/client/components/error-boundary`) and mounts each boundary as `errorComponent` under an `AppRouterContext` with a `refresh` spy. Run result: `Tests 13 passed (13)`. I read `node_modules/next/dist/client/components/error-boundary.js`: `ErrorBoundaryHandler.render` passes `{ error, reset, retry }`, and `retry` runs `startTransition(() => { this.context?.refresh(); this.reset(); })`. So `refresh` firing once proves the click reached Next's `retry`. |
| 3 | D-01/D-02: ten boundaries each destructure `retry`, declare `retry: () => void`, and call `retry()` | VERIFIED | `grep -a -rlF 'onClick={() => retry()}' src/app` lists exactly 10 files (the nine edited plus `factsheet/[id]/error.tsx`). `git diff -U0 7a229d27f..HEAD` over the nine boundaries shows only the three identifier lines per file plus five header-comment lines. No `reset` member was added to any of the nine props types (the only `reset:` type member is the pre-existing one in `factsheet/[id]/error.tsx`). |
| 4 | D-03: nothing else changed (copy, links, logging, Sentry, digest-only rendering) | VERIFIED | The diff over the nine boundaries contains no other `+`/`-` lines. The colocated arms for digest-only, `error.message` and log tags pass unchanged (`src/app` suite below). |
| 5 | D-04/D-10: old-contract comments corrected, no other comment touched | VERIFIED | Five headers (admin, allocations, compare, strategies, wizard) were reworded, dropping "Next 16.2.0". The diff shows exactly those five comment lines changing. |
| 6 | D-05: real `ErrorBoundary` path shipped, with a harness self-check that `reset()` does not reach `refresh` | VERIFIED | The test file holds the real `ErrorBoundary` import, an `AppRouterContext.Provider` with a `vi.fn()` `refresh`, and the arm "harness self-check: a button wired to reset() does NOT reach router.refresh", which passes. |
| 7 | D-06: boundary list discovered from the filesystem, count pinned at 10, factsheet included | VERIFIED | `walk(APP_DIR, ...)` collects `error.tsx` and `global-error.tsx`, and `BOUNDARY_COUNT = 10`. My `find src` listing shows 10 boundary files and no `.js`/`.jsx`/`error.ts` boundary. The count arm and the 10 per-boundary arms pass. |
| 8 | D-08: reverting one boundary turns the test RED naming it; byte restore turns it GREEN | VERIFIED | Independently re-proved on a different boundary than the executor used. `(dashboard)/allocations/error.tsx` was backed up with `cp -p`, reverted to the old prop at its three identifier sites, and the run was RED: `× (dashboard)/allocations/error.tsx`, `× no file under src/app reads unstable_retry`, `Tests 2 failed \| 11 passed (13)`, with `TypeError: unstable_retry is not a function` and the static hit list `[ '(dashboard)/allocations/error.tsx' ]`. Restored with `cp -p`, `cmp` exit 0, `git status --short` empty. Second variant, with Try again wired to `reset()`: RED with `Tests 1 failed \| 12 passed (13)` (`expected "vi.fn()" to be called 1 times, but got 0 times`), so the per-boundary arm also catches a `reset` wiring. After the final restore the test reports `13 passed`. |

**Score:** 8/8 truths verified (0 present, behavior-unverified). Truths 2, 6 and 8 are behavior-dependent and are backed by a passing behavioral test that was shown to go RED.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/__tests__/error-boundaries-retry.test.tsx` | cross-boundary proof, 13 arms | VERIFIED | 111 lines, substantive. It contains the real `ErrorBoundary` import, `AppRouterContext`, `BOUNDARY_COUNT = 10` and the join-built `OLD`, and no literal old prop name. |
| `src/app/(dashboard)/admin/error.tsx` | `onClick={() => retry()}` | VERIFIED | Matches. |
| `src/app/global-error.tsx` | raw button calls `retry()` | VERIFIED | Matches. Its arm passes through Next's `ErrorBoundary`. |
| `src/app/(dashboard)/compare/error.tsx` | `onClick={() => retry()}` | VERIFIED | Matches. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| test file | `next/dist/client/components/error-boundary` | import and mount as `errorComponent` | WIRED | Line 27-30 import, `mountThroughNext` uses it. |
| test file | `next/dist/shared/lib/app-router-context.shared-runtime` | `AppRouterContext.Provider` with `refresh` spy | WIRED | Present, and the spy counts calls (RED/GREEN cycle proves it). |
| each boundary | Next's `ErrorBoundaryHandler.retry` | `onClick={() => retry()}` | WIRED | 10/10 files, behaviorally proven by the 10 arms. |

### Data-Flow Trace (Level 4)

Not applicable. The boundaries render no dynamic data from a store. The only runtime value is the prop Next injects, and that is the thing the test traces end to end.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Try again reaches Next's `retry` for all 10 boundaries | `npx vitest run src/__tests__/error-boundaries-retry.test.tsx --project jsdom` | 13 passed | PASS |
| Test bites on old prop | neuter `allocations/error.tsx`, rerun | 2 failed, names the boundary | PASS |
| Test bites on `reset()` wiring | neuter `allocations/error.tsx` to `reset`, rerun | 1 failed | PASS |
| Typecheck | `npx tsc --noEmit -p .` | exit 0, no output | PASS |
| `src/app` suite | `npx vitest run src/app --project jsdom` | `Test Files 469 passed (469)`, `Tests 8481 passed \| 3 skipped (8484)` | PASS |
| allowlist test over the boundary paths | `npx vitest run src/__tests__/role-home-call-sites.test.ts` | 12 passed | PASS |

### Probe Execution

Step 7c: SKIPPED. The phase declares no probes.

### Requirements Coverage

ROADMAP lists "Requirements: TBD" and no IDs are mapped to this phase in REQUIREMENTS.md. The plan claims SC-1 and SC-2 as traceability keys, and both are satisfied above. No orphaned requirements.

### Anti-Patterns Found

None. No `TBD`/`FIXME`/`XXX`/`TODO` markers were introduced in the touched files. The `=> {}` in the new test is the intentional `console.error` silencer in `beforeEach`. No stubs.

### Human Verification Required

None. The behavior (Next's `retry` triggers `router.refresh()`) is exercised through Next's own `ErrorBoundary` in jsdom, with props that come from Next. A real-browser pass would add confidence on rendering only, and D-03 keeps the rendering byte-identical.

### Notes (not gaps)

- The orchestrator reported two `src/lib/factsheet/compute.conventions.test.ts` failures in a full local run, caused by Node v25 vs CI's Node 22. That file is outside this phase, and the `src/app` suite is fully green. Treated as environmental, as instructed.
- `.planning/codebase/CONVENTIONS.md` and `ARCHITECTURE.md` still describe the old prop. This is out of scope per D-04 and RESEARCH Pitfall 5, and the SUMMARY records it.
- Closing TODOS `196-ERROR-BOUNDARY-UNSTABLE-RETRY-01`, VERSION and CHANGELOG are the ship step's job. They are not a phase must-have.
- Round-1 review: 0 MEDIUM+, 2 LOW and 1 INFO, accepted per repo rule. They do not touch the goal.
- Worktree is clean after verification (`git status --short` empty).

### Gaps Summary

No gaps. All ten boundaries call the `retry` prop Next passes, no `unstable_retry` remains under `src/app`, and the new cross-boundary test goes RED when a boundary is reverted, either to the old prop or to `reset()`.

---

_Verified: 2026-11-14_
_Verifier: Claude (gsd-verifier)_
