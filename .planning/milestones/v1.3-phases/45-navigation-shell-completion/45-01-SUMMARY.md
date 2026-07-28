---
phase: 45-navigation-shell-completion
plan: 01
subsystem: ui
tags: [react, nextjs, navigation, mobile, a11y, inert, skip-link, wcag, tailwind]

# Dependency graph
requires:
  - phase: 44-mobile-foundation
    provides: "useBreakpoint, e2e/helpers/reflow.ts (assertNoReflow/assertTargetSizes), Button.tsx min-h-[44px]/pointer-coarse 44px pattern, two-tier Playwright CI (unseeded + seeded MA-8)"
provides:
  - "buildPrimaryMobileNav(role-props) — the single source for the mobile bottom nav's <=5 role-aware primary set (DRY with desktop Sidebar)"
  - "BridgeIcon inline SVG (16x16 stroke-1.5) in Sidebar.tsx"
  - "Role-aware MobileNav: aria-label='Primary mobile', min-h-[44px] cells, focus-visible accent ring, aria-current='page', My-Allocation flagged badge"
  - "App-shell skip-link (.app-skip-link) targeting <main id='main-content' tabIndex={-1}> on every authed route"
  - "Background <main inert={menuOpen}> focus barrier while the drawer is open (scoped to <main>, not the wrapper)"
  - "Exported NavItem / IconComponent types from Sidebar.tsx"
affects: [45-02-tab-strip, 45-03-drawer-keyboard-e2e, 46-surface-reflow]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single-source nav derivation: one helper (buildPrimaryMobileNav) feeds the mobile bottom nav while mirroring the desktop Sidebar's role OR-logic identifiers verbatim — the two navs cannot drift"
    - "React 19 native inert boolean prop on the drawer's <main> sibling (no ref+effect), SSR-safe because menuOpen starts false"
    - "App-shell skip-link generalized from a per-route pattern into DashboardChrome as the first focusable child"

key-files:
  created:
    - "src/components/layout/MobileNav.test.tsx"
  modified:
    - "src/components/layout/Sidebar.tsx"
    - "src/components/layout/MobileNav.tsx"
    - "src/components/layout/DashboardChrome.tsx"
    - "src/components/layout/DashboardChrome.test.tsx"
    - "src/app/globals.css"

key-decisions:
  - "Bridge/Risk are tab deep-links with distinct hrefs (no /bridge route): My Allocation /allocations, Risk /allocations?tab=risk, Bridge /allocations?tab=risk#bridge"
  - "Kept the pathname-prefix active match (no useSearchParams) to avoid a Next 16 CSR-bailout without a Suspense boundary — the My Allocation/Risk/Bridge cells share an active highlight on /allocations*, a cosmetic SSR-safe tradeoff"
  - "Profile slot reserved before the <=5 cap so it survives trimming even for admin/both (both families active); Discovery is the discretionary filler trimmed first"
  - "BridgeIcon is a suspension-bridge glyph in the standard accent/muted treatment (NOT cream-tinted — the cream identity is for the Bridge surfaces themselves)"

patterns-established:
  - "buildPrimaryMobileNav single-sources icons/labels/role-logic from Sidebar.tsx; no second hardcoded TABS list (project Rule 6)"
  - "inert scoped to <main> ONLY (the drawer's sibling), never the flex-h-full wrapper that also contains the drawer (Pitfall 2)"

requirements-completed: [NAV-01, NAV-03]

# Metrics
duration: 22min
completed: 2026-06-27
---

# Phase 45 Plan 01: Navigation Shell Completion (role-aware bottom nav + drawer hardening) Summary

**Role-aware mobile bottom nav single-sourced from a new `buildPrimaryMobileNav` helper (no hardcoded TABS), plus a hardened drawer shell: background `<main inert={menuOpen}>` and an app-shell skip-link targeting `<main id="main-content" tabIndex={-1}>` on every authed route.**

## Performance

- **Duration:** ~22 min
- **Started:** 2026-06-27T15:09Z
- **Completed:** 2026-06-27T15:24Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 5 (1 created, 4 modified)

## Accomplishments
- **NAV-01:** `MobileNav` is now role-aware. An allocator's bottom nav surfaces **My Allocation (`/allocations`), Risk (`/allocations?tab=risk`), Bridge (`/allocations?tab=risk#bridge`)** with distinct hrefs, then Discovery + Profile (<=5). Manager → Strategies/Portfolios/Profile. Admin/"both" → both families + Profile. Items derive from the new `buildPrimaryMobileNav` in `Sidebar.tsx`, mirroring the SAME `showsAllocatorWorkspace = isAllocator || isAdmin` OR-logic — no second hardcoded list (DRY).
- **NAV-03 (implementation half):** background `<main inert={menuOpen}>` blocks focus from leaking behind the open drawer (scoped to `<main>` only, never the `flex h-full` wrapper); the existing manual Tab trap is retained as defence-in-depth. An app-shell `.app-skip-link` ("Skip to main content") is the first focusable element in both DashboardChrome branches, jumping focus to `<main id="main-content" tabIndex={-1}>`.
- **SC#4:** every bottom-nav cell carries `min-h-[44px]` (WCAG 2.5.8) plus a `focus-visible` accent ring and `aria-current="page"` on the active item.
- **Coverage:** new role branches are covered by `MobileNav.test.tsx` — touched files measure MobileNav 100% stmts / 92.3% branch and Sidebar 100% stmts / 97.82% branch, comfortably above the branches-72 ratchet.

## Task Commits

Each task was committed atomically (TDD: RED test was written first, then GREEN):

1. **Task 1: buildPrimaryMobileNav helper + BridgeIcon** - `1f5eb4fe` (feat)
2. **Task 2: role-aware MobileNav + inert <main> + app-shell skip-link** - `facc0e44` (feat) — includes the MobileNav.test.tsx that was authored RED before the helper existed

## Files Created/Modified
- `src/components/layout/Sidebar.tsx` - Added exported `buildPrimaryMobileNav(role-props)` (single-sources icons/labels/role OR-logic), new `BridgeIcon`, exported `NavItem`/`IconComponent` types
- `src/components/layout/MobileNav.tsx` - Rewritten role-aware; consumes `buildPrimaryMobileNav`; `aria-label="Primary mobile"`, `min-h-[44px]`, focus ring, `aria-current`, flagged badge; deleted the hardcoded `TABS` + local stub icons
- `src/components/layout/DashboardChrome.tsx` - Threads role props into BOTH `<MobileNav>` renders; adds skip-link first child + `<main id="main-content" tabIndex={-1} inert={menuOpen}>` in both branches
- `src/components/layout/MobileNav.test.tsx` - NEW; role-branch coverage (allocator/manager/admin/both/none) + active matcher + 44px + badge
- `src/components/layout/DashboardChrome.test.tsx` - Scoped one assertion to the desktop `<nav aria-label="Primary">` (MobileNav now also renders "My Allocation")
- `src/app/globals.css` - Added `.app-skip-link` / `.app-skip-link:focus` (generalized from `.strategy-v2-skip-link`, which is kept intact)

## DOM selectors shipped (for Plan 45-03 e2e assertions)
- Bottom nav: `<nav aria-label="Primary mobile" class="fixed bottom-0 left-0 right-0 z-30 ... md:hidden">`
- Bottom-nav allocator hrefs (distinct): `/allocations`, `/allocations?tab=risk`, `/allocations?tab=risk#bridge`
- Each bottom-nav cell: a `<Link>` (role `link`) with `min-h-[44px]`, `focus-visible:outline-accent`, and `aria-current="page"` on the active item
- Flagged badge: element with `aria-label="{n} flagged holding(s)"` inside the My Allocation cell when `flaggedCount > 0`
- Skip-link: `<a href="#main-content" class="app-skip-link">Skip to main content</a>` — first focusable child of DashboardChrome (z-index 100 clears drawer z-40 / bottom-nav z-30)
- Skip-link target: `<main id="main-content" tabIndex={-1} inert={...}>` (standard branch also keeps `aria-label="Dashboard content"`)
- Drawer (unchanged, for containment assertions): `#mobile-sidebar-drawer[role="dialog"][aria-modal="true"]`, hamburger `getByRole("button", { name: "Open menu" })`

## Decisions Made
- **Bridge/Risk as tab deep-links with distinct hrefs** (per locked CONTEXT decision): there is no `/bridge` route; Bridge anchors the BridgeWidget on the Risk tab via `#bridge`.
- **Pathname-only active match** (RESEARCH A3/Pitfall 6): deliberately did NOT add `useSearchParams()` — it forces a Next 16 CSR-bailout requiring a Suspense boundary DashboardChrome doesn't provide. Consequence is a shared `/allocations*` active highlight across the three allocator cells (cosmetic, SSR-safe).
- **Profile slot reserved before the cap** so it never gets trimmed for admin/"both"; Discovery is the discretionary filler trimmed first when the cap binds.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Standard-branch drawer was missing `isManager`**
- **Found during:** Task 2 (threading role props in DashboardChrome)
- **Issue:** The standard-layout `<MobileSidebarDrawer>` (line ~125) was rendered WITHOUT `isManager`, while the full-bleed branch passed it. A role `"both"` or `manager` user on a standard route therefore never got the manager workspace (Strategies/Portfolios) in the drawer — the same class of pre-fix `!isAllocator`/missing-manager-flag bug the Sidebar role OR-logic was hardened against.
- **Fix:** Added `isManager={isManager}` to the standard-branch `<MobileSidebarDrawer>`, matching the full-bleed branch.
- **Files modified:** src/components/layout/DashboardChrome.tsx
- **Verification:** tsc clean; existing MobileSidebarDrawer/DashboardChrome tests stay green (56 layout tests pass).
- **Committed in:** facc0e44 (Task 2 commit)

**2. [Rule 1 - Bug] DashboardChrome test assertion was ambiguous after the behavior change**
- **Found during:** Task 2 (running the existing layout suite)
- **Issue:** `getByText("My Allocation")` in `DashboardChrome.test.tsx` threw on multiple matches because the now role-aware MobileNav also renders "My Allocation" (the prop-less stub did not). The test's INTENT ("desktop sidebar subtree mounted") was unchanged.
- **Fix:** Scoped the assertion to the desktop Sidebar's `<nav aria-label="Primary">` via `within(...)`, distinguishing it from MobileNav's `<nav aria-label="Primary mobile">`. Intent preserved.
- **Files modified:** src/components/layout/DashboardChrome.test.tsx
- **Verification:** All 56 layout tests pass; full suite 6808 passed / 0 failed.
- **Committed in:** facc0e44 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 Rule 1 bugs)
**Impact on plan:** Both fixes were necessary for correctness — one a latent role-leak in the drawer surfaced while wiring the same props into MobileNav, one a test that became ambiguous due to the intended new behavior. No scope creep.

## Issues Encountered
None beyond the two auto-fixed items above. RED tests failed as expected before the helper/rewrite; GREEN after.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- **45-02 (tab strip):** unaffected — that plan edits `AllocationsTabs.tsx`; the bottom-nav/skip-link shell is independent.
- **45-03 (drawer-keyboard e2e):** all selectors it must assert are shipped and listed above. The `inert` containment + skip-link focus move are implemented; the seeded Playwright proof (dual-wired into ci.yml MA-8 + its `HAS_SEED_ENV` guard) is Plan 03's deliverable.
- No blockers.

## Self-Check: PASSED
- All 5 source files + the SUMMARY exist on disk.
- Both task commits (`1f5eb4fe`, `facc0e44`) exist in git history.
- `.planning/` is gitignored (local-only per the sequential-execution contract) — SUMMARY/STATE/ROADMAP are NOT version-controlled; only the `src/**` + `globals.css` code commits land.

---
*Phase: 45-navigation-shell-completion*
*Completed: 2026-06-27*
