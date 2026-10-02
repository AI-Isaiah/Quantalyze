---
phase: 51-shell-information-architecture-restructure
plan: 03
subsystem: ui
tags: [react, nextjs, navigation, accessibility, aria-current, breadcrumb, sidebar, focus-visible]

# Dependency graph
requires:
  - phase: 51-01
    provides: RED a11y contract tests (Sidebar/Breadcrumb/PageHeader aria-current + focus-visible + PageHeader breadcrumb-prop) and the T-45-01 role-OR-logic GREEN pin
  - phase: 51-02
    provides: route-contract guard (must stay GREEN — these nav links target pre-classified existing private routes)
provides:
  - "Genuine allocator nav orphans surfaced: /compare + /decks in MY WORKSPACE, /referral in ACCOUNT; /recommendations parent+breadcrumb reachable (soft-orphan)"
  - "Desktop sidebar active item exposes aria-current=page + keyboard-only focus-visible:ring-2 ring-accent"
  - "Breadcrumb leaf exposes aria-current=page; linked crumbs get focus-visible accent ring; BreadcrumbItem exported"
  - "PageHeader optional breadcrumb prop renders <Breadcrumb> above the <h1> (single-sourced app-wide back-path)"
affects: [51-04, 51-05, shell-information-architecture, nav-completeness, breadcrumb-back-path]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Nav orphans added INSIDE existing role-gated sections (never altering the role OR-logic derivations) — info-disclosure-safe completeness"
    - "aria-current=page + focus-visible:ring-2 ring-accent as the unified keyboard/AT contract across desktop nav + breadcrumb (mirrors MobileNav)"
    - "PageHeader single-sources a curated breadcrumb back-path additively (optional prop, omit = identical-to-today)"

key-files:
  created: []
  modified:
    - src/components/layout/Sidebar.tsx
    - src/components/layout/Breadcrumb.tsx
    - src/components/layout/PageHeader.tsx

key-decisions:
  - "Compare + Decks placed inside the showsAllocatorWorkspace branch (allocator-only, never leaked to managers); Referral in role-neutral ACCOUNT (allocator/manager-owned, no leak)"
  - "Recommendations left OUT of top-level nav — mandate-CTA-reachable soft-orphan, satisfied by parent + breadcrumb back-path per UI-SPEC §completeness"
  - "Used focus-visible:ring (not outline) on the desktop rail/breadcrumb per UI-SPEC §Item state contract; MobileNav keeps its outline form (LOCKED v1.3)"
  - "Three new house-style 16x16 stroke-1.5 inline SVG glyphs (CompareIcon/DeckIcon/GiftIcon) — no icon dependency added"

patterns-established:
  - "Pattern 1: role-gated nav completeness — orphan entries go inside the existing role branch, the || derivations stay byte-unchanged (T-45-01 preserved)"
  - "Pattern 2: curated-items breadcrumb (no segment auto-derivation) keeps raw UUID/token segments out of crumbs on [id]/[token] routes"

requirements-completed: [NAV-01, NAV-02]

# Metrics
duration: 5min
completed: 2026-06-29
---

# Phase 51 Plan 03: Shell IA — Nav Completeness + Breadcrumb Back-Path Summary

**Surfaced the 4 genuine allocator nav orphans into role-scoped nav, added aria-current=page + keyboard-only focus-visible accent rings to the desktop sidebar and breadcrumb, and gave PageHeader an optional curated breadcrumb prop that single-sources the app-wide back-path — all additive, with the T-45-01 role-leak pin preserved.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-06-29T06:24:01Z
- **Completed:** 2026-06-29T06:28:59Z
- **Tasks:** 2 (both `tdd="true"` — implementation against the pre-existing 51-01 RED tests)
- **Files modified:** 3

## Accomplishments
- "Where am I / how do I get back" is now answerable: every genuine orphan allocator surface (/compare, /decks, /referral) has a labeled role-gated nav entry, and /recommendations stays reachable via its parent + a breadcrumb back-path (no dead end).
- The 3 UI-SPEC a11y gaps are closed: the desktop nav active item and the breadcrumb leaf both expose `aria-current="page"`, and the sidebar `<Link>` + breadcrumb links carry a keyboard-only `focus-visible:ring-2 ring-accent` (mirroring MobileNav).
- PageHeader now single-sources a curated breadcrumb back-path via an optional `breadcrumb?: BreadcrumbItem[]` prop, rendered above the `<h1>`; omitting it is byte-identical to today.
- All five 51-01 RED a11y/breadcrumb-prop tests are GREEN; the T-45-01 role-OR-logic pin, the 51-02 route-contract guard, and the phase-32 frozen-spine guard all stay GREEN.

## Task Commits

Each task was committed atomically:

1. **Task 1: Sidebar — nav completeness + aria-current + focus-visible (role OR-logic preserved)** - `bb41308e` (feat)
2. **Task 2: Breadcrumb a11y + PageHeader breadcrumb prop (single-sourced back-path)** - `2f0b3423` (feat)

_Note: both tasks were `tdd="true"`; the RED tests were authored in 51-01, so each task was a single GREEN-phase implementation commit (no new test commit needed)._

## Files Created/Modified
- `src/components/layout/Sidebar.tsx` - Added /compare + /decks inside the allocator workspace branch and /referral in ACCOUNT; added `aria-current` + `focus-visible:ring-2 ring-accent` to NavItemLink; 3 new house-style inline SVG glyphs. Role OR-logic byte-unchanged.
- `src/components/layout/Breadcrumb.tsx` - `aria-current="page"` on the leaf span; `focus-visible` accent ring on linked crumbs; exported `BreadcrumbItem`.
- `src/components/layout/PageHeader.tsx` - Optional `breadcrumb?: BreadcrumbItem[]` prop rendering `<Breadcrumb>` above the `<h1>` (additive; omit = identical-to-today). H1 / `text-[32px]` unchanged.

## Decisions Made
- **Orphan placement:** Compare + Decks are allocator-only dashboard surfaces, so they live inside the `showsAllocatorWorkspace` branch (a manager never sees them). Referral is allocator/manager-owned and reads as an account affordance, so it goes in the role-neutral ACCOUNT section (Profile's section) — placing it there cannot regress the role-leak pin because ACCOUNT is not gated by the allocator/manager OR-logic.
- **Recommendations stays parent+breadcrumb reachable:** Per the RESEARCH soft-orphan classification (mandate-CTA-reachable child of the profile mandate tab) and UI-SPEC §completeness, it is NOT given a top-level nav item — its back-path is the breadcrumb, satisfying NAV-01 without a redundant top-level entry.
- **Focus affordance form:** Used `focus-visible:ring-2 ring-accent` on the desktop rail and breadcrumb (UI-SPEC §Item state contract specifies the ring form for these), while MobileNav keeps its existing `focus-visible:outline-accent` form (LOCKED v1.3 shell — left structurally unchanged).
- **No icon dependency:** Added three new 16×16 stroke-1.5 `currentColor` inline SVG glyphs matching the file's existing house style, keeping the nav a single self-contained file.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Reworded a Sidebar comment that tripped the FLOW-03 phase-32 frozen-spine guard**
- **Found during:** Task 1 (Sidebar)
- **Issue:** The phase-32 frozen-spine guard (`src/__tests__/phase-32-frozen-spine-guards.test.ts`) asserts `Sidebar.tsx` source must not `toContain("/scenarios")` — a blunt substring match guarding against a resurrected Strategy-Sandbox nav item. My explanatory comment listing the redirect-stub routes contained the literal `/scenarios` (and `/preferences`) slug substrings, turning that GREEN guard RED. The comment was documentation, not a nav item, but the guard is a substring check that must be respected.
- **Fix:** Reworded the comment to reference "the legacy scenarios and preferences slugs" in prose (no literal slash-prefixed slug), preserving the explanation while keeping the guard GREEN. Added a note in the comment that it intentionally avoids the literal slug for this reason.
- **Files modified:** src/components/layout/Sidebar.tsx
- **Verification:** `grep -c "/scenarios\|/preferences" src/components/layout/Sidebar.tsx` → 0; `npx vitest run src/__tests__/phase-32-frozen-spine-guards.test.ts` → 8 passed.
- **Committed in:** `bb41308e` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** The fix was a comment reword only — zero behavior change, zero scope creep. No code logic was altered.

## Issues Encountered
None beyond the deviation above. The pre-existing `no-raw-font-px` lint warnings on Sidebar (lines 282/306/358 — section-heading/badge `text-[10px]`) and PageHeader (line 26 — the `text-[32px]` H1 the plan explicitly froze) are out of scope per the SCOPE BOUNDARY: they predate this plan, are warnings (0 errors), and the plan mandates no type churn this phase.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The shell now answers "where am I / how do I get back" on every dashboard surface: role-scoped nav completeness + the single-sourced PageHeader breadcrumb back-path are the reusable mechanisms for 51-04/51-05.
- Note for follow-on plans: PageHeader call sites can now opt into a curated breadcrumb by passing `breadcrumb={[...]}` — this plan delivered the mechanism + a11y, not the per-page retrofit (surfaces already passing a standalone `<Breadcrumb>` continue to work unchanged).
- Manual post-merge walkthrough (allocator/manager/admin nav reachability + visible current location + back-path) remains the one un-automatable verification, per the plan's §verification.

## Self-Check: PASSED

- FOUND: src/components/layout/Sidebar.tsx
- FOUND: src/components/layout/Breadcrumb.tsx
- FOUND: src/components/layout/PageHeader.tsx
- FOUND: .planning/phases/51-shell-information-architecture-restructure/51-03-SUMMARY.md
- FOUND commit: bb41308e (Task 1 — Sidebar)
- FOUND commit: 2f0b3423 (Task 2 — Breadcrumb + PageHeader)

---
*Phase: 51-shell-information-architecture-restructure*
*Completed: 2026-06-29*
