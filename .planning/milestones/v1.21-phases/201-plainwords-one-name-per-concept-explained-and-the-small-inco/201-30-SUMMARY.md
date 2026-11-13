---
phase: 201-plainwords-one-name-per-concept-explained-and-the-small-inco
plan: 30
subsystem: copy
tags: [plainwords, scenario-tab, retired-word, f-04, u-26]
requires: ["201-11", "201-14"]
provides:
  - "composer flagged-holdings card, add-more card, commit drawer and outcomes panel in the plain words of U-26, with no retired word rendered"
affects: [201-33]
key-files:
  modified:
    - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
    - src/app/(dashboard)/allocations/components/ScenarioCommitDrawer.tsx
    - src/app/(dashboard)/allocations/components/ScenarioCommitDrawer.test.tsx
    - src/app/(dashboard)/allocations/widgets/outcomes/OutcomesWidget.tsx
    - src/app/(dashboard)/allocations/widgets/outcomes/outcomes.test.tsx
decisions:
  - "Plan 201-14 had already set the outcomes heading to `Replacement outcomes`; kept, only the sub-line and empty state moved"
  - "Comments that name the feature as a concept (not quoting copy) and the identifiers BridgeDrawer, addStrategyBridge stay"
metrics:
  tasks: 2
  completed: 2026-11-11
status: complete
actuals:
  tasks: 2
  commits: 2
plan_head_before: 7a8543ac6feeaab34480b10f874f3c1008c45985
plan_head_after: a458eb369c7d7a011e0de34f71593701c485db54
---

# Phase 201 Plan 30: Scenario tab copy in plain words Summary

The Scenario tab's flagged-holdings card now reads `{n} holding{s} outside your mandate` with a `Review replacements` button that still opens the replacement drawer. The commit drawer says what is recorded and tracked daily, and the outcomes panel reads as the allocator's replacement outcomes. The retired word no longer renders in any of the three components, and tests fail if it returns.

## Tasks

| Task | Commit | What |
|------|--------|------|
| 1 (tracer) | d0df7d243 | Card title, button `Review replacements`, add-more sentence `...beyond the suggested replacements.`; the Term with the retired key and its now-unused import removed; T_C8/T_C9 re-pinned, plural arm (T_C8b), add-more arm (T_C8c) and a rendered no-retired-word arm (text, aria-label, title, `[data-term="bridge"]`) added |
| 2 | a458eb369 | Drawer sub-line, removed note, added note and submit confirmation per UI-SPEC; outcomes sub-line and empty state; T_D3 re-pinned, T_D3b (notes), T_D3c (no retired word), confirmation arms for 1 and 2 diffs (pins count, plural, daily tracking and the can't-be-undone clause, T-201-39), outcomes empty-state, sub-line and no-retired-word arms |

## Verification

- Task 1 verify: `verify-plan-anchors.mjs` on the plan: `OK: 1 plan file(s), no stale claims` (4 claims). `vitest ScenarioComposer.test.tsx copy-census.test.ts`: 2 files, 498 tests passed.
- Task 2 verify: `vitest ScenarioCommitDrawer.test.tsx widgets/outcomes/ ScenarioComposer.test.tsx copy-census.test.ts figure-gate-census.test.ts`: 7 files, 596 tests passed. `npx eslint` on the three components: exit 0. `npm run typecheck`: exit 0.
- Acceptance greps: `Review replacements` 1, `beyond the suggested replacements` 1, `Open Bridge` 0 (ScenarioComposer.tsx); `each is saved as an outcome` 1, `rejected outcome` 1 (ScenarioCommitDrawer.tsx); `reallocations made on a replacement suggestion` 1, `Your replacement outcomes` 1 (OutcomesWidget.tsx).
- Re-run of the context-block grep over the three component files prints only comment lines (ScenarioComposer.tsx: the UNIFY-04 add-seam comment, the SCEN-02 `isOwn` comment, the UNIFY-04 candidate comment). They name the feature as a concept in code comments, not user copy, and are left (surgical). No `k="bridge"` Term remains in the three files.
- `src/__tests__/copy-census.test.ts` green with no change under `scripts/copy-census/`. No ledger edited.

gc-201-30-neuter: gate=ScenarioComposer.test.tsx T_C8 result=red restored=identical
  - Neutered: button label `Review replacements` put back to `Open Bridge` in ScenarioComposer.tsx (byte backup via cp -p). RED: `× T_C8 flaggedHoldings.length>0 → card reads '1 holding outside your mandate' and 'Review replacements' opens the drawer` (the old-label-absent assertion and the `Review replacements` role query both bite). Restored with cp -p, `cmp` exit 0, `-t T_C8`: 3 passed.

gc-201-30-neuter: gate=ScenarioCommitDrawer.test.tsx T_D3 result=red restored=identical
  - Neutered: sub-line put back to `{n} decisions to record · routed through the Bridge outcome graph`. RED: `× T_D3: Header copy + subtitle render with diff count` (`Unable to find an element with the text: 3 decisions to record · each is saved as an outcome`) and `× T_D3c: the drawer renders no retired word ...`. Restored with cp -p, `cmp` exit 0, `-t T_D3`: 3 passed.

gc-201-30-gates: vitest=green eslint=clean tsc=clean

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Four stale `book` pins in ScenarioComposer.test.tsx left by plan 201-11**
- **Found during:** Task 1 verify (whole-file run)
- **Issue:** Plan 201-11 changed the composer's shipped copy from `whole book` / `Your book's history` to `whole allocation` / `Your allocation's history` but left four test pins on the old words (the ENGINE-03 note, the per-source fallback line 199-15, and the two 167.1.2 D-02 rebuilding arms through `OWN_BOOK_AWAITING_COPY`). Measured against HEAD with my edits reverted (byte backups, `cmp` restored): the same 4 failed, so they predate this plan. The plan's verify runs the whole file, so it could not exit 0 without them.
- **Fix:** the four literals moved to the shipped copy (source untouched, comment at the old `whole book` line left).
- **Files modified:** `ScenarioComposer.test.tsx`
- **Commit:** d0df7d243

**2. [Rule 1 - Cleanup of own mess] Unused `Term` import removed from ScenarioComposer.tsx**
- The only use was the retired-key wrapper the plan told me to remove; leaving the import would fail ESLint.
- **Commit:** d0df7d243

**3. Header comment updates (ScenarioComposer.tsx lines 19, 23; ScenarioComposer.test.tsx header and the `(Removed T_C16)` note; OutcomesWidget.tsx line 845)** quoted the old copy and now quote the new copy.

Plan 201-14 had already set the outcomes heading to `Replacement outcomes` and its test; kept as the plan allowed.

## cross-plan-pins:

None that pin a changed literal in a test (`grep -a -rn -F` over `src e2e tests` for every old literal: only the files above matched). Two COMMENTS outside this plan's files still quote the old button label and read stale now, for plan 201-24 or 201-33 to touch (no behaviour depends on them):
- `src/components/layout/Sidebar.tsx` line 257 (`the "Open Bridge" card`)
- `src/components/layout/MobileNav.test.tsx` line 21 (`composer's "Open Bridge" card`)

## reported-not-edited:

None. The four phase-200 files carry no retired word (re-grepped, empty).

## Known Stubs

None.

## Threat Flags

None. Copy only; no write path, endpoint or schema change. T-201-39 mitigated: the confirmation keeps the outcome count and the "can't be undone" clause and is pinned for one and two diffs.

## Self-Check: PASSED

- d0df7d243 and a458eb369 are ancestors of HEAD; the three components and three tests exist and are committed.
