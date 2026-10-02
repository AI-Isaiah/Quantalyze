---
phase: 66-carry-forward-burn-down
plan: 01
subsystem: scenario-membership
tags: [scenario, share-mint, validation, error-copy, red-team-burndown]
requires: []
provides:
  - "share-mint gate keyed purely on addedStrategies emptiness (no isBookOnlyDraft)"
  - "MAX_MEMBER_KEY_IDS = 1000 exported const wired into the memberKeyIds zod bound"
  - "saveErrorMessage shared helper mapping the over-cap 400 to honest ceiling copy"
affects:
  - src/app/api/allocator/scenario/share/route.ts
  - src/app/(dashboard)/allocations/lib/scenario-state.ts
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/app/scenario-share/[token]/share-resolve.ts
tech-stack:
  added: []
  patterns:
    - "named DoS-cap constant (scenario-state.ts MAX_* idiom)"
    - "one small pure helper reused across sites (dataSourceLabel idiom)"
key-files:
  created: []
  modified:
    - src/app/api/allocator/scenario/share/route.ts
    - src/app/api/allocator/scenario/share/route.test.ts
    - src/app/(dashboard)/allocations/lib/scenario-state.ts
    - src/app/(dashboard)/allocations/lib/scenario-state.test.ts
    - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.save.test.tsx
    - src/app/scenario-share/[token]/share-resolve.ts
decisions:
  - "CF-01: DELETE the dead isBookOnlyDraft disjunct + orphaned function (not promote)"
  - "CF-02: RAISE the memberKeyIds cap to 1000 (never silently clamp the stamp)"
  - "CF-02: honest over-cap copy naming the real ceiling, not the generic connection error"
metrics:
  duration: ~12m
  tasks: 3
  files: 7
  completed: 2026-07-04
requirements: [CF-01, CF-02]
---

# Phase 66 Plan 01: Carry-Forward Burn-Down (F-3 / F-5) Summary

Closed v1.6 red-team findings F-3 (CF-01) and F-5 (CF-02) at root: deleted the
provably-dead `isBookOnlyDraft` share-mint disjunct and its now-orphaned function,
raised the arbitrary `memberKeyIds` `.max(64)` cap to a named exported
`MAX_MEMBER_KEY_IDS = 1000`, and replaced the misleading generic connection-error
copy with an honest over-cap message (naming the real ceiling) via one shared
save-error helper reused at all four composer save sites.

## What Was Built

### Task 1 — CF-01: delete the dead `isBookOnlyDraft` disjunct (commit 9ca47a8c)
- `share/route.ts`: removed `|| isBookOnlyDraft(draft as ScenarioDraft)` from the
  book-only gate — the gate now keys purely on `nothingShareable`
  (addedStrategies emptiness). The disjunct was provably dead: addedStrategies
  empty ⇒ `nothingShareable` already true and short-circuits; addedStrategies
  non-empty ⇒ `isBookOnlyDraft` returns false.
- Removed the `isBookOnlyDraft` import; narrowed to a `type ScenarioDraft` import.
- Rewrote the overstated MEMBER-03 comment block to the honest invariant:
  book-only ⇔ zero added strategies (no claim the gate reads a shared predicate;
  keeps the accurate share-resolve.ts counterpart note).
- Deleted the orphaned `isBookOnlyDraft` function (scenario-state.ts) + its test
  block, and reworded the three prose comments in `share-resolve.ts` that named
  the now-deleted symbol.
- `route.test.ts`: repointed the `:354` source-string pin from `toContain` →
  `not.toContain("isBookOnlyDraft")`; added **T_SH17** proving a
  book-only-by-membership draft (2 memberKeyIds, zero added) still 409s via the
  surviving `nothingShareable` check alone.

### Task 2 — CF-02: raise the cap to a named const (commit d55a2c39)
- Added `export const MAX_MEMBER_KEY_IDS = 1000;` following the same-file named
  DoS-cap idiom (`MAX_DRAFT_RECORD_ENTRIES` / `MAX_DRAFT_KEY_LENGTH`), with a
  self-documenting comment.
- Replaced `.max(64)` on the `memberKeyIds` field with `.max(MAX_MEMBER_KEY_IDS)`;
  updated the `T-62-02` comment to name the new bound. The per-id
  `.max(MAX_DRAFT_KEY_LENGTH)` and route-level `MAX_DRAFT_BODY_BYTES` remain the
  real DoS guards. NO clamping introduced anywhere (fail-loud).
- Tests: 65-accepted (fails-without-fix vs `.max(64)`, **proven** — see below),
  1000-accepted boundary, 1001-rejected with `too_big` on the memberKeyIds path.
  All build arrays from the const, never a hard-coded literal.

### Task 3 — CF-02 error surface: honest over-cap copy (commit e2cf06aa)
- Added a module-level `saveErrorMessage(status, issues)` helper (mirrors the
  `dataSourceLabel` one-small-pure-helper idiom): a 400 whose zod issues carry a
  `too_big` entry on the `memberKeyIds` path → honest copy naming the ceiling
  (interpolated from `MAX_MEMBER_KEY_IDS`); every other failure → the generic
  string. Added a defensive `readSaveIssues(res)` (parse in try/catch, generic
  fallback on non-JSON) and a `SAVE_ERROR_GENERIC` constant.
- Wired the helper at both `!res.ok` sites (POST `postNewScenario` + PUT
  `putUpdateScenario`); the two `catch` paths keep the generic connection copy
  (honest for a genuine network failure). The four inline duplicate strings are
  gone — only the const's single generic literal remains.
- Tests: **T_SAVE9b** over-cap 400 → honest ceiling copy, no "Check your
  connection" (fails-without-fix, **proven**); **T_SAVE9c** non-memberKeyIds 400
  → generic copy (no scope creep); T_SAVE9 unchanged.

## Verification

- `npx vitest run` (all three touched test files): **109 passed**.
- Neuter-checks **proven** by temporary revert (per the user standing rule):
  - Task 2: 65-accepted test FAILS against `.max(64)`.
  - Task 3: T_SAVE9b FAILS against the pre-change generic-copy `!res.ok` branch.
  - Task 1 is a dead-code deletion (behavior provably unchanged, T-66-04); T_SH17
    pins that book-only drafts stay blocked by the surviving `nothingShareable`
    check — it fails if that block is removed.
- `npx tsc --noEmit` clean; `npx eslint` on the changed source files clean.
- No `memberKeyIds` clamp/slice introduced anywhere (grep confirmed).

### Acceptance greps
- `grep -c "isBookOnlyDraft" share/route.ts` → 0
- `grep -rn "isBookOnlyDraft(" src (non-test)` → nothing
- `grep -c "export function isBookOnlyDraft" scenario-state.ts` → 0
- `grep -c "export const MAX_MEMBER_KEY_IDS = 1000" scenario-state.ts` → 1
- `grep -c "memberKeyIds:.*\.max(64)" scenario-state.ts` → 0 (lastEditedAt `.max(64)` untouched)
- `grep -c "Couldn't save this portfolio. Check your connection" ScenarioComposer.tsx` → 1 (the const only)

## Deviations from Plan

### Sanctioned deviation — CLAUDE.md dead-code AskUserQuestion gate

**[Rule 2/sanctioned] Deleted the orphaned `isBookOnlyDraft` function without an AskUserQuestion prompt**
- **Found during:** Task 1. After deleting the share-mint disjunct, `isBookOnlyDraft`
  (scenario-state.ts) lost its only non-test caller (re-grep confirmed A5: route.ts
  was the sole call site; share-resolve.ts references were prose comments).
- **CLAUDE.md rule normally invoked:** the dead-code deletion gate requires an
  AskUserQuestion before removing dead/unused code.
- **Sanction (why the gate was bypassed):** the plan's Task 1 `<action>` explicitly
  sanctions the same-pass deletion under research **Open Question 4 (RESOLVED —
  delete in the same pass)** and the **66-CONTEXT Claude's-discretion charter**. The
  CF-01 locked decision (D: DELETE not promote) covers the disjunct; the orphaned
  function's same-pass removal is covered by the research resolution + discretion
  charter. This deviation is recorded here per the CLAUDE.md deviation-documentation
  policy.
- **Files:** scenario-state.ts (function + export removed), scenario-state.test.ts
  (isBookOnlyDraft test block + import removed), share-resolve.ts (prose comments
  reworded).
- **Commit:** 9ca47a8c.

No other deviations — the three fixes were implemented as written.

## Known Stubs

None. All three fixes wire real behavior; no placeholder/empty-value stubs introduced.

## Threat Flags

None. No new network endpoints, auth paths, file-access patterns, or trust-boundary
schema changes were introduced. T-66-01 (cap raise) and T-66-04 (disjunct deletion)
are both `mitigate (this plan)` in the plan's threat register and are honored:
the per-id length bound + byte cap remain the real DoS guards, and T_SH17 pins that
the gate's effective behavior is unchanged.

## Self-Check: PASSED

Files verified present and commits verified in git log (see self-check block below).
