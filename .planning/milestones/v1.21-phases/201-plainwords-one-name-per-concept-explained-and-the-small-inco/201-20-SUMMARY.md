---
phase: 201-plainwords-one-name-per-concept-explained-and-the-small-inco
plan: 20
subsystem: admin-copy
tags: [copy, plainwords, admin, dates, census]
requires: [201-25, 201-26]
provides:
  - admin mandate family (Save mandate, Mandate saved., Edit mandate)
  - admin fit labels (Allocation fit, Mandate fit)
  - admin dates through formatDay / formatDayTime in nowrap cells
  - ledger plan-20 empty
affects: [e2e/layout-narrow.spec.ts (plan 201-11 owns the locator)]
key-files:
  modified:
    - src/components/admin/PreferencesPanel.tsx
    - src/components/admin/CandidateDetail.tsx
    - src/components/admin/AllocatorMatchQueue.tsx
    - src/components/admin/ComputeJobsTable.tsx
    - src/components/admin/AdminTabs.tsx
    - src/components/admin/ForQuantsLeadsTable.tsx
    - src/components/admin/MatchEvalDashboard.tsx
    - src/components/admin/SendIntroPanel.tsx
    - src/components/admin/match/ModeBadge.tsx
    - src/app/(dashboard)/admin/compute-jobs/page.tsx
    - src/app/(dashboard)/admin/csv-status/page.tsx
    - src/app/(dashboard)/admin/deletion-requests/page.tsx
    - src/app/(dashboard)/admin/users/[id]/page.tsx
    - e2e/match-queue.spec.ts
    - scripts/copy-census/ledgers/plan-20.ts
    - colocated tests for each of the above
decisions: []
status: complete
commits: 3
plan_head_before: 8724de1ab708bff9ef2d452ffeb07ac6c4a2d03b
plan_head_after: 74fe40676d4d743a5b4dff7ccda5c1a653f66235
actuals:
  tasks: 3
  commits: 3
---

# Phase 201 Plan 20: Admin copy Summary

Admin now uses the allocator's words (mandate, allocation fit, unnamed allocation) and one date format (`formatDay` / `formatDayTime`) in nowrap cells; ledger plan-20 is `pending: {}` and the census is green.

## What was done (resumed run)

The interrupted executor had already committed all three tasks; this run inspected each commit against the plan, found no uncommitted work, re-ran every automated check and the neuter, and wrote this SUMMARY.

| Task | Commit | Content |
|------|--------|---------|
| 1 (tracer) | 6074ed52a | PreferencesPanel: `Save mandate`, `Mandate saved.`, `Mandate saved. Recompute the match queue now with the new mandate?`, `Failed to save mandate`, header `Mandate`, mobile note; its date through `formatDay`; e2e match-queue spec clicks `Save mandate` |
| 2 | 8ea4fb532 | CandidateDetail `Allocation fit` (+ not-computed lines) and `Mandate fit`; AllocatorMatchQueue `Edit mandate`; ComputeJobsTable and compute-jobs page `Unnamed allocation`; SendIntroPanel, MatchEvalDashboard, ModeBadge rows; tests updated first |
| 3 | 74fe40676 | AdminTabs, ForQuantsLeadsTable, MatchEvalDashboard, csv-status, deletion-requests, users/[id], AllocatorMatchQueue dates through `formatDay`/`formatDayTime`, `whitespace-nowrap` on date cells; ledger plan-20 `pending: {}` |

Additional files the runner assigned to plan-20 (row exclusive): `src/components/admin/match/ModeBadge.tsx` (+ test), `src/components/admin/SendIntroPanel.tsx` (+ test), `src/components/admin/MatchEvalDashboard.tsx` (+ test), `src/components/admin/AdminTabs.tsx` (+ test), `src/components/admin/ForQuantsLeadsTable.tsx` (+ test), and page tests under `src/app/(dashboard)/admin/`.

## Verification (real output)

- `node scripts/verify-plan-anchors.mjs <plan>`: `OK: 1 plan file(s), no stale claims.` exit 0
- `npx tsx scripts/copy-census/run.ts --ledger plan-20`: exit 0, no remaining hits
- `npx vitest run src/components/admin/ "src/app/(dashboard)/admin/" src/__tests__/copy-census.test.ts src/__tests__/figure-gate-census.test.ts`: Test Files 29 passed (29), Tests 283 passed (283)
- `npx eslint` on all 14 touched source files and the e2e spec: exit 0
- `npx tsc --noEmit` (what `npm run typecheck` runs): exit 0
- Acceptance greps: `Save preferences` in e2e/match-queue.spec.ts 0; `Preferences saved` in PreferencesPanel.tsx 0; `Portfolio fit` in CandidateDetail.tsx 0; `Unnamed portfolio` in ComputeJobsTable.tsx 0 and compute-jobs/page.tsx 0
- Playwright not run locally (per standing rule).

gc-201-20-gates: vitest=green eslint=clean tsc=clean

## Neuter

Gate: `src/components/admin/PreferencesPanel.test.tsx`. Backed up with `cp -p`, restored the submit label to `Save preferences`, RED with 3 failures naming the cause (`Unable to find an accessible element with the role "button" and name "Save mandate"`; the saved-message and failed-save arms also red). Restored with `cp -p`, `cmp` exit 0, GREEN (11 passed).

gc-201-20-neuter: gate=PreferencesPanel.test.tsx result=red restored=identical

## layout-narrow locator confirmation

This plan writes `Edit mandate` in `AllocatorMatchQueue.tsx` (grep confirmed). At this branch's base, `e2e/layout-narrow.spec.ts` line 356 still reads `Edit preferences`: plan 201-11 owns that locator update and has not landed in this base. The string it must write is exactly `Edit mandate`, which matches. Not edited here (not this plan's file).

## T-201-26

Only visible labels changed (`Allocation fit`, `Mandate fit`); the data fields `portfolio_fit` and `preference_fit` are untouched and the CandidateDetail test asserts each label shows its own field's value.

## Deviations from Plan

None - plan executed as written. No exceptions added (`pinnedExceptionCount` stays 0). The F-04 Bridge retirement and F-12 egress changes were not applied (plans 201-28..201-34 own them).

## reported-not-edited

None. No phase-200 files were touched.

## Known Stubs

None.

## Threat Flags

None.

## Self-Check: PASSED

Commits 6074ed52a, 8ea4fb532, 74fe40676 are ancestors of HEAD; ledger plan-20 file present with `pending: {}`.
