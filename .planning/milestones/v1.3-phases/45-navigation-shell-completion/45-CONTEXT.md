# Phase 45: Navigation Shell Completion - Context

**Gathered:** 2026-06-27
**Status:** Ready for planning
**Mode:** Auto-generated (smart discuss — grey areas auto-resolved from ROADMAP success criteria + codebase recon; no clients → decisions taken autonomously, all grounded in existing role-aware nav code)

<domain>
## Phase Boundary

Complete the mobile navigation shell so every later authed surface is tested inside real
mobile chrome: a role-aware bottom nav, a horizontally-scrollable multi-tab strip, a hardened
drawer focus-trap (background `inert` + app-wide skip-link), and ≥44px nav targets that pass the
Phase 44 reflow gate.

**In scope (NAV-01/02/03):**
- Role-aware bottom `MobileNav` (replace the hardcoded 3-item stub).
- Horizontally-scrollable tab strip for the multi-tab surfaces on phones (`role=tab` preserved).
- Drawer hardening: background `inert` while open + an app-shell skip-link (generalized from the
  factsheet one); a mobile-drawer keyboard e2e proving containment.
- ≥44px hamburger + bottom-nav targets; nav shell passes the Phase 44 reflow gate (320px / 400%).

**Out of scope:** per-surface page reflow (Phase 46), charts (47/48). The drawer's existing
Escape / scroll-lock / Tab focus-trap / focus-in-on-open / focus-restore-on-close already work
(audit G11.C.2 + WR-03) — this phase HARDENS (adds `inert`, skip-link), it does not rebuild them.
</domain>

<decisions>
## Implementation Decisions

### Bottom Nav (NAV-01)
- `MobileNav` becomes role-aware by deriving its items from the SAME role-aware source the desktop
  `Sidebar` uses (`buildNavSections(populatedSlugs, isAdmin, isAllocator, flaggedCount, isManager)`
  in `src/components/layout/Sidebar.tsx`) — NOT a second hardcoded list (DRY / single source of
  truth; root-cause per project Rule 6). It receives `isAllocator/isManager/isAdmin` (+
  `populatedSlugs`/`flaggedCount`) props from `DashboardChrome.tsx`, which already threads them to
  `MobileSidebarDrawer`.
- Allocator bottom-nav surfaces the primary destinations per SC#1: **My Allocation (`/allocations`),
  Bridge, Risk** (a small ≤5-item subset of the role's nav; the hamburger drawer remains the full
  nav). Manager → their primary set (portfolios / onboarding); Admin → admin primary set; role
  `"both"` lights the allocator set (mirrors Sidebar's `showsAllocatorWorkspace = isAllocator ||
  isAdmin` OR-logic, NOT the pre-fix `!isAllocator` short-circuit).
- **RESOLVED — Bridge/Risk are not routes (research Open-Q1; decided autonomously, reversible
  presentation choice):** Risk is the `/allocations?tab=risk` tab; the Bridge recommendation widget
  lives on that tab (no `/bridge` route, verified). The allocator bottom nav (≤5) is therefore:
  **My Allocation → `/allocations`**, **Risk → `/allocations?tab=risk`**, **Bridge →
  `/allocations?tab=risk#bridge`** (deep-links/anchors to the Bridge recommendations widget — the
  core "act on Bridge recommendations" value earns its own slot with a DISTINCT target from Risk),
  then **Discovery** and **Profile** to fill the 5. All three SC#1-named items appear as labeled,
  reachable entries with distinct hrefs (no two items resolving to the identical URL). A dedicated
  `buildPrimaryMobileNav` helper single-sources Sidebar's icons/labels/role OR-logic (DRY) and
  defines the Bridge/Risk tab deep-links once. Active-state match must handle the `?tab=`/`#`
  query+hash (usePathname strips them) — match on pathname + the `tab` searchParam.
- `DashboardChrome` currently renders `<MobileNav />` PROP-LESS — it must start threading the same
  `isAllocator/isManager/isAdmin/populatedSlugs/flaggedCount` it already passes to the drawer.
- Keep the existing visual style (fixed bottom, `md:hidden`, icon+label, accent active state) and
  the existing pathname-prefix active match. Reuse Sidebar's existing icons/labels where the same
  destination appears, so the two navs don't drift.

### Tab Strip (NAV-02)
- The multi-tab surfaces (Overview / Holdings / Risk / Scenario) get a horizontally-scrollable
  strip on `<sm` (`overflow-x-auto`, `flex-nowrap`, no tab dropped — every tab reachable by scroll),
  PRESERVING the JOURNEY-03 `role=tablist`/`role=tab` sibling a11y fix (never re-nest tabs inside a
  control that re-introduces the duplicate-landmark/critical-axe violation). Scroll affordance is
  CSS-first.

### Drawer Hardening + Skip-link (NAV-03)
- Set the `inert` attribute on `<main>` (the drawer's SIBLING in `DashboardChrome`) while the drawer
  is open — NOT the `flex h-full` wrapper that also contains the drawer (that documented pitfall
  would inert the drawer too). React 19.2.4 types `inert?: boolean` natively (`inert={menuOpen}`, no
  ref+effect; SSR-safe since `menuOpen` starts false). Belt-and-suspenders over the existing manual
  Tab interception; keep all existing drawer behavior.
- App-shell **skip-link**: generalize the factsheet skip-link into `DashboardChrome` — a
  visually-hidden-until-focused "Skip to main content" anchor as the FIRST focusable element,
  targeting the main content landmark (give `<main>` a stable `id`). Present on every authed route.
- New **mobile-drawer keyboard e2e**: proves Tab/Shift+Tab stay contained in the open drawer (no
  leak to the inert background), focus moves in on open, restores to the hamburger on close.

### Touch targets + reflow (SC#4)
- Hamburger + every bottom-nav target measure ≥44px (apply the `min-h-[44px]` + `pointer-coarse`
  pattern from `Button.tsx`; verified by the Phase 44 target-size gate). The nav shell passes the
  Phase 44 reflow gate at 320px and remains usable at 400% zoom.

### Verification wiring (FLOW-01)
- The mobile-drawer keyboard e2e is an AUTHED/dashboard spec → it belongs in the SEEDED MA-8 list
  AND its `HAS_SEED_ENV` guard (the twice-burned dual-wiring trap). Reuse the Phase 44 reflow /
  target-size helpers to assert the nav shell at 320px. Coverage ratchet held un-lowered.

### Reuse (Phase 44 primitives)
- `useBreakpoint` for any JS viewport branch (single two-pass SSR-safe source); the Phase 44
  `e2e/helpers/reflow.ts` `assertNoReflow`/`assertTargetSizes` for the nav-shell gates.

### Claude's Discretion
Exact icon choices for any new bottom-nav destination, the precise allocator item ordering, and the
scrollable-strip scroll affordance styling are at Claude's discretion against DESIGN.md, provided
the SC constraints above hold.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/components/layout/Sidebar.tsx` — `buildNavSections(populatedSlugs, isAdmin, isAllocator,
  flaggedCount, isManager)` is the role-aware nav SoT MobileNav must derive from. `showsAllocatorWorkspace
  = isAllocator || isAdmin` etc. is the role OR-logic to mirror.
- `src/components/layout/MobileNav.tsx` — the current hardcoded 3-item stub (Discovery/Strategies/
  Profile); the file to make role-aware.
- `src/components/layout/MobileSidebarDrawer.tsx` — already has Escape, body-scroll-lock, Tab
  focus-trap (G11.C.2), focus-in-on-open, focus-restore-to-`triggerRef`-on-close (WR-03). Add
  `inert` on the background here (or in DashboardChrome) while `open`.
- `src/components/layout/DashboardChrome.tsx` — renders `MobileNav` + the drawer; the chrome that
  threads role props and where the app-shell skip-link + `<main id>` live.
- Phase 44: `useBreakpoint`, `e2e/helpers/reflow.ts` (`assertNoReflow`/`assertTargetSizes`),
  `Button.tsx` `min-h-[44px]`/`pointer-coarse` 44px pattern.
- Factsheet skip-link (in `MobileSidebarDrawer.tsx` / factsheet) — the pattern to generalize.

### Established Patterns
- Two-tier Playwright CI: unseeded list (`ci.yml:~1059`) + seed-gated MA-8 list (`~1252`, gated on
  `vars.E2E_TEST_DB_CONFIGURED`). Authed drawer spec → MA-8 + its own `HAS_SEED_ENV` guard.
- JOURNEY-03 a11y lesson: `role=tab`/`role=tablist` must be siblings (no duplicate `<main>`, no
  control nesting that re-introduces a critical-axe violation).
- Coverage ratchet (vitest.config.ts): lines 82 / stmts 80 / fns 74 / branches 72.

### Integration Points
- `MobileNav.tsx` (role-aware items), `DashboardChrome.tsx` (props threading + skip-link + main id),
  `MobileSidebarDrawer.tsx` (background `inert`), the multi-tab surface component(s), `e2e/` +
  `ci.yml` (drawer-keyboard spec dual-wiring).
</code_context>

<specifics>
## Specific Ideas

Mirror the v1.2 JOURNEY-03 lesson again: the new drawer-keyboard e2e only earns trust once it
actually RUNS in CI (must be wired into BOTH the seed guard AND ci.yml). Prefer the standard `inert`
attribute over a hand-rolled focus barrier — the manual Tab trap stays as defence-in-depth.
</specifics>

<deferred>
## Deferred Ideas

- Per-surface page reflow at 320px/400% across all routes → Phase 46.
- Chart touch/legibility → Phases 47/48.
</deferred>
