---
phase: 51
plan: 06
subsystem: navigation / information-architecture
tags: [nav, breadcrumb, allocator, override, NAV-01, NAV-02, T-45-01]
requires: [51-03]  # PageHeader breadcrumb prop + Breadcrumb component
provides: [recommendations-nav-entry, breadcrumb-callers]
affects: [Sidebar, PageHeader call sites]
key-files:
  modified:
    - src/components/layout/Sidebar.tsx
    - src/components/layout/Sidebar.test.tsx
    - src/app/(dashboard)/recommendations/page.tsx
    - src/app/(dashboard)/compare/page.tsx
    - src/app/(dashboard)/decks/page.tsx
decisions:
  - Recommendations promoted to a top-level allocator nav item (user OVERRIDE of the 2026-05-20 "tab/CTA-only" decision)
  - compare/page.tsx breadcrumbs moved from standalone <Breadcrumb> into the PageHeader breadcrumb prop (single render path, no double crumb)
metrics:
  duration: ~9 min
  completed: 2026-06-29
commit: a787e884
---

# Phase 51 Plan 06: Back-path fixes (Recommendations nav + breadcrumb callers) Summary

Post-fan-out fix pass on `gsd/phase-51-shell-ia`: promoted Recommendations to a
top-level allocator nav item (a user-approved override of the 2026-05-20
decision) and wired the PageHeader `breadcrumb` prop into the three deep
allocator surfaces so curated back-paths are an OBSERVABLE behavior (SC#2) and
no surface is a dead-end (SC#1).

## What shipped

### Task 1 — Recommendations in the allocator nav (USER OVERRIDE)
- `Sidebar.tsx`: added `{ label: "Recommendations", href: "/recommendations",
  icon: RecommendIcon }` to the allocator `workspaceItems.push(...)` block
  INSIDE the `showsAllocatorWorkspace` branch — so it never leaks to a
  manager. The role OR-logic derivations (`showsAllocatorWorkspace` /
  `showsManagerWorkspace`) are byte-unchanged (T-45-01 intact).
- Added a new house-style 16×16 inline `RecommendIcon` (sparkle/star), mirroring
  the existing CompareIcon/DeckIcon glyphs (stroke-1.5, currentColor, no dep).
- Updated the NAV-01 comment block: Recommendations is now a nav item per the
  51-REVIEW override; removed the false "mandate-CTA-reachable" justification.
- `Sidebar.test.tsx`: flipped the 2 tests that asserted Recommendations is NOT a
  top-level entry — the allocator test now asserts it IS present with
  href=/recommendations; the manager-view test keeps the negative assertion but
  reframed as the role-leak pin (managers must NOT see the allocator entry).
  Updated the describe-block doc comment to record the override. The T-45-01
  role-OR-logic pin stays green.

### Task 2 — Breadcrumb back-paths wired into the deep surfaces
- `recommendations/page.tsx`: `breadcrumb={[{ label: "My Allocation",
  href: "/allocations" }, { label: "Recommendations" }]}`.
- `decks/page.tsx`: `breadcrumb={[{ label: "Discovery",
  href: "/discovery/crypto-sma" }, { label: "Decks" }]}`.
- `compare/page.tsx`: all 3 render branches now pass
  `breadcrumb={[{ label: "Discovery", href: "/discovery/crypto-sma" },
  { label: "Compare" }]}` via the PageHeader prop.

## Deviations from Plan

### [Reconciliation] compare/page.tsx already rendered standalone breadcrumbs
- **Found during:** Task 2.
- **Issue:** `compare/page.tsx` already rendered a standalone `<Breadcrumb>`
  immediately before each `<PageHeader>` (3 branches). Naively adding the
  PageHeader `breadcrumb` prop would have rendered TWO breadcrumb navs.
- **Fix:** Moved each breadcrumb into the `<PageHeader breadcrumb={...}>` prop
  (the app-wide affordance per the 51-03 contract), removed the 3 standalone
  `<Breadcrumb>` renders, and dropped the now-unused `Breadcrumb` import.
  Unified the two empty-state branches (previously `Compare Strategies` /
  `Compare` leaf-only crumbs) under the same `Discovery → Compare` parent the
  directive specified. Single render path, no double crumb.
- **Files modified:** src/app/(dashboard)/compare/page.tsx
- **Commit:** a787e884

### [Out of scope] posttooluse-validate false positive
- The nextjs validator repeatedly flagged compare/page.tsx line 26 ("params is
  async — add await"). False positive: the file already awaits its async
  `searchParams` on line 26 and has no `params`/`slug` symbol. Not introduced by
  this change; left as-is.

## Verification
- `npx vitest run src/components/layout/` → 66 passed (6 files).
- `npx vitest run compare decks recommendations` → 23 passed (3 files).
- `npx tsc --noEmit` → clean.
- `npm run lint` → 0 errors (572 pre-existing warnings, none in touched files);
  both manifest guards OK.
- `npx tsx scripts/check-route-contract.ts` → exit 0 (56 routes).

## Self-Check: PASSED
- Commit a787e884 present on gsd/phase-51-shell-ia; 5 code files changed,
  0 deletions; working tree clean; no .planning/ staged.
