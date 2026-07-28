---
phase: 21-surfacing-correlation-honest-projection
plan: 01
subsystem: ui
tags: [react, nextjs, navigation, tabs, rbac, allocator, scenario, vitest]

# Dependency graph
requires:
  - phase: (v1.0.0) scenario draft engine
    provides: shipped ScenarioComposer (own-book) + ScenarioBuilder (/scenarios example universe), both reachable only via deep-link / "+ Allocation" chip before this plan
provides:
  - Visible "Scenario" tab in the own-book dashboard tablist (click + keyboard reachable)
  - Allocator-only "Strategy Sandbox" sidebar link to /scenarios
  - BeakerIcon inline-SVG icon factory
affects:
  - 21-02 (correlation heatmap) — mounts inside the now-reachable Scenario surfaces
  - 21-03 (honest projection framing) — same surfaces
  - 22/23 (honesty scaffolding, persistence) — read from the surfaced scenario UI

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "VISIBLE_TAB_KEYS as the single source of truth for both the rendered tab strip AND keyboard arrow-nav reach (one array edit surfaces a tab end-to-end)"
    - "Role-gated nav item via push-on-boolean onto workspaceItems, gated on isAllocator ONLY (not showsAllocatorWorkspace) for allocator-exclusive surfaces"
    - "Sidebar link visibility as defense-in-depth; the server route gate at scenarios/page.tsx is the real security boundary"

key-files:
  created: []
  modified:
    - src/app/(dashboard)/allocations/AllocationsTabs.tsx
    - src/app/(dashboard)/allocations/AllocationsTabs.scenario-composer.test.tsx
    - src/components/layout/Sidebar.tsx
    - src/components/layout/Sidebar.test.tsx

key-decisions:
  - "Single array edit (add 'scenario' to VISIBLE_TAB_KEYS) surfaces the tab end-to-end — scenario was already a full TabKey with label, parse-case, ARIA panel; the render loop and keyboardKeys both derive from VISIBLE_TAB_KEYS"
  - "Strategy Sandbox link gated on isAllocator ONLY (NOT showsAllocatorWorkspace = isAllocator || isAdmin) so admin-only users see no Sandbox entry — matches the strict server route gate"
  - "Did NOT touch scenarios/page.tsx — the server gate is the security boundary; the sidebar hide is defense-in-depth"

patterns-established:
  - "Surfacing a routable-but-hidden tab: add the key to VISIBLE_TAB_KEYS (already-wired TabKey) rather than adding parallel button/keyboard plumbing"
  - "Allocator-exclusive sidebar entry: gate on isAllocator, document the server gate as the real boundary inline, and test the admin-only ABSENT case as the regression guard"

requirements-completed: [SURF-01, SURF-02, SURF-03]

# Metrics
duration: 4min
completed: 2026-06-21
---

# Phase 21 Plan 01: Surfacing the Scenario Tab + Strategy Sandbox Summary

**Made the already-shipped scenario engine reachable: a visible "Scenario" tab in the own-book dashboard tablist (click + keyboard) and an allocator-only "Strategy Sandbox" sidebar link to /scenarios, both via brownfield wiring with zero engine or route changes.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-06-21T14:48:16Z (approx, from execution start)
- **Completed:** 2026-06-21T14:52:11Z
- **Tasks:** 2
- **Files modified:** 4 (2 source, 2 test)

## Accomplishments
- **SURF-01:** Added `"scenario"` to `VISIBLE_TAB_KEYS` in AllocationsTabs.tsx. Because `scenario` was already a full `TabKey` (label, parse-case, `panel-scenario` ARIA wiring) and the render loop + `keyboardKeys` both derive from `VISIBLE_TAB_KEYS`, this one edit produced a visible tab button AND keyboard arrow-nav reach. The `?tab=scenario` deep-link and the "+ Allocation" chip continue to work unchanged.
- **SURF-02/03:** Added a `BeakerIcon` (lab-flask outline, inline-SVG factory convention) and a "Strategy Sandbox" NavItem (`/scenarios`) pushed onto `workspaceItems` directly under "My Allocation", gated on `isAllocator` ONLY. Managers, admin-only users, and no-role users see nothing.
- Extended both existing spec files with focused new describe blocks; both touched specs pass (47 tests across the two files).

## Task Commits

Each task was committed atomically:

1. **Task 1: Add visible Scenario tab to the dashboard tablist (SURF-01)** — `3540cd9a` (feat)
2. **Task 2: Add allocator-only Strategy Sandbox sidebar link + BeakerIcon (SURF-02/03)** — `617848e0` (feat)

_Note: `.planning/` is gitignored — the docs/state commit is a no-op for git but the files are written to disk for GSD tooling._

## Files Created/Modified
- `src/app/(dashboard)/allocations/AllocationsTabs.tsx` — Added `"scenario"` to `VISIBLE_TAB_KEYS`; updated the stale keyboard-nav comment + component docstring that claimed Scenario was hidden/excluded from arrow-nav.
- `src/app/(dashboard)/allocations/AllocationsTabs.scenario-composer.test.tsx` — New `describe("... Scenario visible tab (SURF-01)")` block: visible tab button + ARIA, click routes to `?tab=scenario`, ArrowRight-from-Risk and End-key keyboard reach, and `?tab=scenario` deep-link still resolves (aria-selected + composer body).
- `src/components/layout/Sidebar.tsx` — Added `BeakerIcon`; pushed "Strategy Sandbox" NavItem under "My Allocation" gated on `if (isAllocator)`; inline comment documenting defense-in-depth and the server boundary.
- `src/components/layout/Sidebar.test.tsx` — New `describe("... Strategy Sandbox link RBAC gate (SURF-02/03)")` block: allocator sees it (href `/scenarios`, positioned after My Allocation); manager-only, admin-only, dual-role admin+allocator (SEES it), and no-role-flags cases.

## Decisions Made
- **One array edit suffices for SURF-01** — `scenario` was already a fully-wired `TabKey`; surfacing it via `VISIBLE_TAB_KEYS` (the source of truth for both render loop and keyboard nav) was the minimal, convention-matching change. No new style constants, no parse/ARIA changes.
- **`isAllocator`-only gate for the Sandbox link** — not `showsAllocatorWorkspace` (which includes admins). The admin-only ABSENT test is the explicit regression guard against re-gating on the broader boolean.
- **Server gate untouched** — `scenarios/page.tsx` (role IN ('allocator','both') else redirect) remains the security boundary; the sidebar visibility is defense-in-depth only (T-21-01 mitigation in the threat register).

## Deviations from Plan

None - plan executed exactly as written. Both tasks were single-edit-plus-test wiring with no bugs, no missing critical functionality, no blocking issues, and no architectural changes encountered. (RULE 7 conflict surfaced in 21-UI-SPEC re: the heatmap palette is out of scope for this plan — it belongs to a later plan.)

## Issues Encountered
None. The PostToolUse nextjs validator flagged 9 "missing 'use client'" suggestions on the test file — false positives (Vitest spec, not a client component; the existing file uses the same patterns). The next-cache-components/react-best-practices skill injections were not applicable: both edits are client-side (a constant array + an inline SVG + a nav-item push), with no route/cache/data-fetching code.

## Verification

- `npx vitest run "src/app/(dashboard)/allocations/AllocationsTabs.scenario-composer.test.tsx"` → 17 passed (12 existing + 5 new). GREEN.
- `npx vitest run "src/components/layout/Sidebar.test.tsx"` → 30 passed (24 existing + 6 new). GREEN.
- Both specs together → 47 passed. GREEN.
- `npx tsc --noEmit` → no errors in either touched source file.
- Confirmed no file deletions in either commit; `scenarios/page.tsx` not touched in any branch commit.

## Known Stubs
None — no hardcoded empty values, placeholder copy, or unwired data sources introduced. Both edits surface existing, fully-functional components.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- The own-book Scenario tab and the example-universe Strategy Sandbox are now both reachable. This unblocks 21-02 (correlation heatmap mount) and 21-03 (PROJECTED honesty framing), which add UI inside these now-visible surfaces.
- No blockers.

## Self-Check: PASSED

- FOUND: `.planning/phases/21-surfacing-correlation-honest-projection/21-01-SUMMARY.md`
- FOUND commit: `3540cd9a` (Task 1)
- FOUND commit: `617848e0` (Task 2)
- FOUND source: `"scenario"` in `VISIBLE_TAB_KEYS` (AllocationsTabs.tsx)
- FOUND source: `Strategy Sandbox` NavItem under `if (isAllocator)` (Sidebar.tsx)

---
*Phase: 21-surfacing-correlation-honest-projection*
*Completed: 2026-06-21*
