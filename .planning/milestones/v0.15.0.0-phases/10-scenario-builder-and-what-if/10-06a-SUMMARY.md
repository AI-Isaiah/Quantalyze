---
phase: 10-scenario-builder-and-what-if
plan: 06a
subsystem: ui
tags: [react, react-19, hooks, localstorage, scenario-builder, allocator-dashboard, vitest]

# Dependency graph
requires:
  - phase: 10-scenario-builder-and-what-if
    provides: "Plan 01 — pure scenario-state.ts module (defaultDraftFromHoldings, toggle/add/remove/setWeight pure transforms, scenarioStorageKey(allocatorId), load/save/clearScenarioDraft helpers, schema_version + fingerprint invariants)"
  - phase: 09.1-allocator-dashboard-ui-refresh-implement-designer-provided-a
    provides: "useDashboardConfig hook idiom (vi.stubGlobal('localStorage', mock) test pattern under vitest 4.1.2; SSR-safe load/persist try-catch envelopes)"
provides:
  - "useScenarioState React hook — per-allocator scoped localStorage hydration + persistence + auth-change re-hydration + diffCount memo (M8 no double-count)"
  - "ScenarioFooter sticky-bar component — diff count chip + delta summary + Reset/Commit CTAs"
  - "M1 stale-NEW-allocator fingerprint mismatch path — auth-change to allocator B with B's stale stored draft surfaces fingerprintMismatch=true"
  - "M8 diffCount semantics — toggle-off renormalization side-effects do NOT count; only user-explicit toggle/add/weight-override changes do"
affects:
  - "10-06b (Scenario composer + AllocationsTabs branch — assembles useScenarioState + ScenarioFooter into the full Scenario tab body under the allocations.ui_v2 cohort flag)"
  - "10-07 (Scenario commit drawer + commit API route — the composer's Commit CTA in ScenarioFooter routes to the commit drawer)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "React 19 'set state during render to derive new state from prop change' idiom — avoids react-hooks/set-state-in-effect lint rule for auth-change re-hydration"
    - "Per-allocator scoped localStorage key (`allocations.scenario_v0_15.{allocatorId}`) — eliminates cross-tenant collision at the persistence layer (N1 defense-in-depth)"
    - "Soft-typed `userWeightOverrides` accessor on ScenarioDraft — forward-compatible diffCount semantics so Plan 06b's direct weight inputs can extend Plan 01 without breaking this hook"

key-files:
  created:
    - "src/app/(dashboard)/allocations/hooks/useScenarioState.ts"
    - "src/app/(dashboard)/allocations/hooks/useScenarioState.test.tsx"
    - "src/app/(dashboard)/allocations/components/ScenarioFooter.tsx"
    - "src/app/(dashboard)/allocations/components/ScenarioFooter.test.tsx"
  modified: []

key-decisions:
  - "Auth-change re-hydration uses React 19's set-state-during-render idiom (https://react.dev/learn/you-might-not-need-an-effect §'Adjusting some state when a prop changes') — the linter flagged the in-effect setState pattern, and this is the canonical fix that avoids cascading renders"
  - "Hook delegates the storage-key shape to Plan 01's scenarioStorageKey(allocatorId) helper — never hand-rolls `allocations.scenario_v0_15.${id}` directly, so the key shape stays in one place"
  - "Two refs/state slots track allocator transitions: `prevAllocatorId` (state) for the render-time hydration check; `lastClearedAllocatorId` (ref) for the side-effect-time clear-OLD-key. Splitting the two responsibilities is what unblocked the React-19 lint rules without losing the T_USE11 contract"
  - "diffCount weight branch reads from `(draft as { userWeightOverrides? }).userWeightOverrides ?? {}` — when Plan 01 hasn't yet shipped that field, the hook conservatively counts ZERO weight changes, which is the correct M8 behavior for this slice (toggle-off renormalization is NOT user-explicit). Plan 06b can extend Plan 01 to populate the field when direct weight inputs go live"

patterns-established:
  - "TDD cadence: test-only RED commit followed by impl GREEN commit (per project precedent)"
  - "vi.stubGlobal('localStorage', mock) Map-backed mock at module scope (Phase 08 Plan 02 + useDashboardConfig.test.ts) — reliable jsdom localStorage idiom under vitest 4.1.2"
  - "Two-test split for cross-tenant safety: T_USE12 (no-collision) + T_USE12_auth_change_stale_new_allocator (M1 stale-NEW path) — keeps the original cross-review M1 grep and the cross-tenant invariant both load-bearing"

requirements-completed: [SCENARIO-01, SCENARIO-02, SCENARIO-08, SCENARIO-09]

# Metrics
duration: 18min
completed: 2026-04-26
---

# Phase 10 Plan 06a: Scenario state hook + sticky footer Summary

**useScenarioState React hook (per-allocator scoped localStorage + auth-change re-hydration + M8 diffCount memo) plus ScenarioFooter sticky bar (diff chip + delta summary + Reset/Commit) — both ready for Plan 06b composer assembly.**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-04-26T10:14Z
- **Completed:** 2026-04-26T10:32Z
- **Tasks:** 1 (TDD: RED then GREEN)
- **Files created:** 4

## Accomplishments

- `useScenarioState` React hook wraps Plan 01's pure module with the React state lifecycle (hydration, persistence, auth-change re-hydration, mutator wrappers, diffCount memo).
- Per-allocator scoped storage key via Plan 01's `scenarioStorageKey(allocatorId)` helper — N1 defense-in-depth eliminates cross-tenant collision at the persistence layer (T_USE12 proves it; two allocators in the same browser do NOT collide).
- M1 stale-NEW-allocator path verified: when allocator B's stored draft has a fingerprint that does not match B's current holdings, auth-change to B surfaces `fingerprintMismatch === true` so the composer banner forces the choice (T_USE12_auth_change_stale_new_allocator).
- M8 — single toggle-off correctly produces `diffCount === 1` (not N). Toggle-off renormalization writes the entire weights map but those side-effect changes do NOT count toward the diff; only user-explicit toggle/add/weight-override changes do (T_USE13).
- Auth-change side effect clears the OLD allocator's scoped key on transition (NOT the new one — the new allocator may have a draft they want to resume). T-10-02 mitigation, redundant with N1's per-allocator key but defended in depth.
- `ScenarioFooter` sticky bar implements the D-12 + UI-SPEC §Sticky footer contract: position-sticky height-56 surface; diff count chip; dot-separated mono delta summary; ghost Reset (hover-destructive); accent Commit (disabled when zero diffs); `role="region" aria-label="Scenario draft summary and actions"` landmark.
- 23/23 plan-scoped tests GREEN; full vitest suite 1973 passed (1950 baseline + 23 new); zero regressions; `npx tsc --noEmit` clean; `npm run lint` clean on all four files.

## Task Commits

1. **Task 1 RED — failing tests for useScenarioState + ScenarioFooter** — `d68ef66` (test)
2. **Task 1 GREEN — useScenarioState hook + ScenarioFooter component** — `fcde4f4` (feat)

## Files Created/Modified

- `src/app/(dashboard)/allocations/hooks/useScenarioState.ts` — React hook wrapping Plan 01's pure scenario-state.ts with localStorage hydration + per-allocator scoped key + auth-change re-hydration + diffCount memo.
- `src/app/(dashboard)/allocations/hooks/useScenarioState.test.tsx` — 14 hook tests (T_USE1..T_USE13 + the T_USE12 cross-tenant split).
- `src/app/(dashboard)/allocations/components/ScenarioFooter.tsx` — sticky bottom-bar primitive with diff count chip + delta summary + Reset + Commit CTAs.
- `src/app/(dashboard)/allocations/components/ScenarioFooter.test.tsx` — 9 footer tests (T_F1..T_F9).

## Hook Signature

```typescript
useScenarioState({ holdingsSummary, allocatorId }) =>
  {
    draft: ScenarioDraft;
    fingerprintMismatch: boolean;
    diffCount: number;
    toggleHolding: (scopeRef: string) => void;
    addStrategyBrowse: (s: AddedStrategy) => void;
    addStrategyBridge: (holdingScopeRef: string, s: AddedStrategy) => void;
    removeAddedStrategy: (id: string) => void;
    setWeightOverride: (scopeRef: string, weight: number) => void;
    reset: () => void;
    dismissFingerprintMismatchBanner: () => void;
  }
```

## Footer Prop Signature

```typescript
ScenarioFooter({
  diffCount: number;
  deltaSummary: ScenarioFooterDeltaItem[];   // { label, value, tier: "positive" | "negative" | "muted" }
  onResetRequested: () => void;
  onCommitRequested: () => void;
})
```

## Test Counts per File

| File | Tests | Pass |
|---|---|---|
| `useScenarioState.test.tsx` | 14 | 14 |
| `ScenarioFooter.test.tsx` | 9 | 9 |
| **Total** | **23** | **23** |

## Confirmation: storage-key shape stays in Plan 01

The hook NEVER hand-rolls the storage key. Every load / save / clear call delegates to Plan 01's exported helpers — `loadScenarioDraft(allocatorId)`, `saveScenarioDraft(allocatorId, draft)`, `clearScenarioDraft(allocatorId)` — which internally call `scenarioStorageKey(allocatorId)`. This keeps the `allocations.scenario_v0_15.{allocatorId}` key shape in exactly one source-of-truth file.

## Decisions Made

- Followed plan as specified for the hook + footer contracts.
- Auth-change re-hydration migrated from "in-effect setState" (PLAN.md draft body) to "set state during render" (React 19 canonical idiom) after `react-hooks/set-state-in-effect` lint flagged the in-effect pattern. Same observable behavior; passes lint cleanly. Documented inline with link to https://react.dev/learn/you-might-not-need-an-effect.
- T_USE12 split into a dedicated cross-tenant-isolation test plus the M1 `T_USE12_auth_change_stale_new_allocator` test, so the original "two allocators do NOT collide" invariant and the M1 stale-NEW-allocator path are both load-bearing in the regression suite (and the count lands at the plan's "23+ tests" target cleanly).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Auth-change re-hydration moved out of useEffect to comply with React 19 lint rules**
- **Found during:** Task 1 GREEN (eslint pass after first GREEN)
- **Issue:** PLAN.md's draft hook body called `setDraft(...)` and `setFingerprintMismatch(...)` inside the `useEffect` that detected the allocatorId change. Project eslint config enforces React 19's `react-hooks/set-state-in-effect` rule, which rejects this pattern (causes cascading renders) and points at https://react.dev/learn/you-might-not-need-an-effect. Initial naive ref-based render-time check then violated `react-hooks/refs` (cannot read `.current` during render).
- **Fix:** Replaced the ref-based prev-allocator tracker with a `useState(allocatorId)` slot (`prevAllocatorId`). During render, if `prevAllocatorId !== allocatorId`, re-hydrate state via `setDraft` / `setFingerprintMismatch` and bump `setPrevAllocatorId(allocatorId)` — React 19 discards the in-progress render and re-runs with the updated state in a single commit. The localStorage clear side effect (T-10-02 mitigation) lives in a separate `useEffect` keyed on `allocatorId`, with a `lastClearedAllocatorId` ref so the clear runs exactly once per transition.
- **Files modified:** `src/app/(dashboard)/allocations/hooks/useScenarioState.ts`
- **Verification:** All 23 tests GREEN (incl. T_USE11 auth-change clears OLD scoped key); `npx eslint --quiet` on the four plan files exits 0; `npx tsc --noEmit` exits 0.
- **Committed in:** `fcde4f4` (Task 1 GREEN commit).

**2. [Rule 1 — Spec] T_USE12 test split into two**
- **Found during:** Task 1 RED self-check (test count was 22; plan stated "at least 23 passing tests")
- **Issue:** PLAN.md combines the cross-tenant-no-collision invariant and the M1 stale-NEW-allocator path into a single T_USE12 case. Splitting is more honest — they assert distinct invariants — and lands the count at exactly 23 per the plan's "13 hook + 9 footer + 1 carry-over" arithmetic.
- **Fix:** Created `T_USE12 — two allocators in same browser do NOT collide` (cross-tenant isolation) plus `T_USE12_auth_change_stale_new_allocator (M1)` (stale-NEW path). Both invariants kept; both grep targets satisfied.
- **Files modified:** `src/app/(dashboard)/allocations/hooks/useScenarioState.test.tsx`
- **Verification:** 14 hook tests + 9 footer tests = 23 GREEN; M1 grep `T_USE12_auth_change_stale_new_allocator|stale_new_allocator|allocator B.*fingerprintMismatch` returns 1.
- **Committed in:** `fcde4f4` (Task 1 GREEN commit).

---

**Total deviations:** 2 auto-fixed (1 lint-driven correctness fix on the React 19 pattern; 1 spec-precision split of an over-loaded test case).
**Impact on plan:** Both auto-fixes preserve the plan's contract verbatim — same observable behavior on the hook, same M1 + cross-tenant invariants on the tests. No scope creep.

## Issues Encountered

None beyond the auto-fixes above.

## User Setup Required

None — pure client-side React; no environment variables, no external services, no migrations.

## Next Phase Readiness

- Plan 06b (Scenario composer + AllocationsTabs branch) can now consume `useScenarioState` and `ScenarioFooter` to assemble the full Scenario tab body under the `allocations.ui_v2` cohort flag. Hook signature + footer prop signature both documented above.
- The `userWeightOverrides` field on `ScenarioDraft` is read-soft-typed in this hook's diffCount memo. If Plan 06b ships direct weight inputs (D-17 option a — `voluntary_modify`), Plan 01 should be extended to populate the field in `setWeightOverride` so the diffCount weight branch counts user-explicit overrides — at which point this hook's memo lights up the `(c)` branch automatically without code changes.

## Self-Check: PASSED

- File `src/app/(dashboard)/allocations/hooks/useScenarioState.ts` — FOUND
- File `src/app/(dashboard)/allocations/hooks/useScenarioState.test.tsx` — FOUND
- File `src/app/(dashboard)/allocations/components/ScenarioFooter.tsx` — FOUND
- File `src/app/(dashboard)/allocations/components/ScenarioFooter.test.tsx` — FOUND
- Commit `d68ef66` (RED — test commit) — FOUND in `git log`
- Commit `fcde4f4` (GREEN — feat commit) — FOUND in `git log`
- `git log --oneline -3 | grep -c '10-06a'` returns 2 — PASS
- `npm test -- useScenarioState ScenarioFooter` → 23 passed | 0 failed — PASS
- `npx tsc --noEmit` exits 0 — PASS
- `npx eslint --quiet` on the 4 plan files exits 0 — PASS
- Full vitest suite: 1973 passed | 0 failed | 127 skipped — no regressions

---
*Phase: 10-scenario-builder-and-what-if*
*Plan: 06a*
*Completed: 2026-04-26*
