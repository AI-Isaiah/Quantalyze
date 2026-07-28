# Phase 45: Navigation Shell Completion - Research

**Researched:** 2026-06-27
**Domain:** Mobile navigation shell (React 19.2.4 / Next.js 16.2.3 App Router) — role-aware bottom nav, scrollable tab strip, drawer `inert` hardening + app-wide skip-link, ≥44px targets, FLOW-01 e2e wiring
**Confidence:** HIGH — every claim anchored on read-of-source in this repo, `node_modules/@types/react`, or the verified Phase 44 RESEARCH/specs. The single MEDIUM item is the "Bridge" bottom-nav target (Bridge has no standalone route — see Open Question 1).

## Summary

Phase 45 is wiring, not invention. Every primitive it needs already ships: `buildNavSections` is the role-aware nav source-of-truth (`Sidebar.tsx:19-114`), the factsheet skip-link pattern + `.strategy-v2-skip-link` CSS already exist (`strategy/[id]/v2/page.tsx:31-57`, `globals.css:382-407`), the multi-tab strip already uses `overflow-x-auto` (the factsheet section-nav at `FactsheetView.tsx:751` is a live precedent and the JOURNEY-03 `role=tablist`/`role=tab` markup is at `AllocationsTabs.tsx:565-608`), the drawer already traps focus/scroll-locks/restores (`MobileSidebarDrawer.tsx:82-148`), and React 19.2.4 supports `inert` as a native typed boolean prop (`@types/react/index.d.ts:2854 — inert?: boolean`). The two FLOW-01 wiring sites are concrete: the UNSEEDED list at `ci.yml:1059` and the SEEDED MA-8 list at `ci.yml:1252-1262`. The new drawer-keyboard spec is AUTHED → it goes in the **seeded** MA-8 list + its own `HAS_SEED_ENV` const, and `composer-axe.spec.ts` is the live auth-pattern to mirror (NOT `strategy-v2-keyboard.spec.ts`, which is dead `test.skip(true)`).

The one genuine planning gap: **SC#1 names "Bridge" and "Risk" as allocator bottom-nav destinations, but neither is a route.** Risk is a tab (`/allocations?tab=risk`) and Bridge is a widget+drawer on the dashboard (`BridgeWidget` / `BridgeDrawer`, no `/bridge` route exists — verified). `buildNavSections` only emits `/allocations` for the allocator workspace. So MobileNav cannot "derive a ≤5 subset from buildNavSections" for Bridge/Risk because those items are not in it. The planner must decide: (a) point Bridge/Risk bottom-nav items at `/allocations?tab=risk` (Bridge lives on the Risk tab as `BridgeWidget`) — a deep-link into the tab strip — or (b) widen the derivation to a small hand-curated allocator subset that includes tab-deep-links. Recommendation (b) with the deep-links is the only honest reading of SC#1 — documented in the Architecture section.

**Primary recommendation:** Extract a single `buildPrimaryMobileNav(role-props)` helper (co-located in or next to `Sidebar.tsx`) that returns the ≤5 role-aware primary set, reusing Sidebar's existing icon components + labels. Make MobileNav consume it (DRY — Rule 6). Add `inert={menuOpen}` to the `<main>` in `DashboardChrome.tsx` (lines 67 + 108) — NOT to an ancestor of the drawer. Generalize the skip-link into `DashboardChrome` as the first focusable child targeting `<main id="main-content">`. Mirror `composer-axe.spec.ts` for the new seeded `e2e/mobile-drawer-keyboard.spec.ts`, wired into `ci.yml:1252` MA-8 list + its `HAS_SEED_ENV` const. Reuse `assertNoReflow`/`assertTargetSizes` from `e2e/helpers/reflow.ts` for the 320px nav-shell gate.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Role-aware bottom-nav item derivation | Browser / Client (`"use client"` `MobileNav`) | — | Reads `usePathname()` for active state; role props flow from server via DashboardChrome props. Pure presentational derivation from the same `buildNavSections` data path. |
| Scrollable tab strip (`overflow-x-auto`) | Browser / Client (presentational CSS) | — | CSS-first; no JS branch needed (`<sm` is a pure responsive utility). The strip is already in `AllocationsTabs.tsx` JSX. |
| Drawer `inert` background | Browser / Client | — | `inert` is a DOM attribute set on `<main>` while `menuOpen`; client state owned by DashboardChrome. |
| App-shell skip-link | Frontend Server (SSR markup) → Browser (focus) | — | The anchor + `<main id>` render server-side in DashboardChrome's tree; the focus-reveal is CSS `:focus`. Present on every authed route because DashboardChrome wraps `(dashboard)/layout.tsx`. |
| `<main>` landmark id | Frontend Server (SSR) | — | Stable `id` rendered server-side; the skip-link target. |
| Drawer-keyboard e2e (focus containment) | CI / Test harness (Playwright seeded authed) | — | Runtime DOM + keyboard simulation against a seeded authed session. |
| Reflow / target-size nav gate | CI / Test harness (Playwright) | — | Runtime DOM measurement at 320px, reusing the Phase 44 helper. |

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Bottom Nav (NAV-01):**
- `MobileNav` becomes role-aware by deriving its items from the SAME role-aware source the desktop `Sidebar` uses (`buildNavSections(populatedSlugs, isAdmin, isAllocator, flaggedCount, isManager)` in `src/components/layout/Sidebar.tsx`) — NOT a second hardcoded list (DRY / single source of truth; root-cause per project Rule 6). It receives `isAllocator/isManager/isAdmin` (+ `populatedSlugs`/`flaggedCount`) props from `DashboardChrome.tsx`, which already threads them to `MobileSidebarDrawer`.
- Allocator bottom-nav surfaces the primary destinations per SC#1: **My Allocation (`/allocations`), Bridge, Risk** (a small ≤5-item subset of the role's nav; the hamburger drawer remains the full nav). Manager → their primary set (portfolios / onboarding); Admin → admin primary set; role `"both"` lights the allocator set (mirrors Sidebar's `showsAllocatorWorkspace = isAllocator || isAdmin` OR-logic, NOT the pre-fix `!isAllocator` short-circuit).
- Keep the existing visual style (fixed bottom, `md:hidden`, icon+label, accent active state) and the existing pathname-prefix active match. Reuse Sidebar's existing icons/labels where the same destination appears, so the two navs don't drift.

**Tab Strip (NAV-02):**
- The multi-tab surfaces (Overview / Holdings / Risk / Scenario) get a horizontally-scrollable strip on `<sm` (`overflow-x-auto`, `flex-nowrap`, no tab dropped — every tab reachable by scroll), PRESERVING the JOURNEY-03 `role=tablist`/`role=tab` sibling a11y fix (never re-nest tabs inside a control that re-introduces the duplicate-landmark/critical-axe violation). Scroll affordance is CSS-first.

**Drawer Hardening + Skip-link (NAV-03):**
- Set the `inert` attribute on the main app content (the page region behind the backdrop) while the drawer is open — belt-and-suspenders over the existing manual Tab interception. Keep all existing drawer behavior.
- App-shell **skip-link**: generalize the factsheet skip-link into `DashboardChrome` — a visually-hidden-until-focused "Skip to main content" anchor as the FIRST focusable element, targeting the main content landmark (give `<main>` a stable `id`). Present on every authed route.
- New **mobile-drawer keyboard e2e**: proves Tab/Shift+Tab stay contained in the open drawer (no leak to the inert background), focus moves in on open, restores to the hamburger on close.

**Touch targets + reflow (SC#4):**
- Hamburger + every bottom-nav target measure ≥44px (apply the `min-h-[44px]` + `pointer-coarse` pattern from `Button.tsx`; verified by the Phase 44 target-size gate). The nav shell passes the Phase 44 reflow gate at 320px and remains usable at 400% zoom.

**Verification wiring (FLOW-01):**
- The mobile-drawer keyboard e2e is an AUTHED/dashboard spec → it belongs in the SEEDED MA-8 list AND its `HAS_SEED_ENV` guard (the twice-burned dual-wiring trap). Reuse the Phase 44 reflow / target-size helpers to assert the nav shell at 320px. Coverage ratchet held un-lowered.

**Reuse (Phase 44 primitives):**
- `useBreakpoint` for any JS viewport branch (single two-pass SSR-safe source); the Phase 44 `e2e/helpers/reflow.ts` `assertNoReflow`/`assertTargetSizes` for the nav-shell gates.

### Claude's Discretion
Exact icon choices for any new bottom-nav destination, the precise allocator item ordering, and the scrollable-strip scroll affordance styling are at Claude's discretion against DESIGN.md, provided the SC constraints above hold.

### Deferred Ideas (OUT OF SCOPE)
- Per-surface page reflow at 320px/400% across all routes → Phase 46.
- Chart touch/legibility → Phases 47/48.
- The drawer's existing Escape / scroll-lock / Tab focus-trap / focus-in-on-open / focus-restore-on-close already work (audit G11.C.2 + WR-03) — this phase HARDENS (adds `inert`, skip-link), it does NOT rebuild them.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| NAV-01 | A mobile user reaches role-appropriate primary navigation — the allocator gets `/allocations`, Bridge, and Risk from the bottom nav (today `MobileNav.TABS` is a role-blind 3-item stub). | `buildNavSections` (`Sidebar.tsx:19-114`) is the role SoT; the role OR-logic (`showsAllocatorWorkspace = isAllocator \|\| isAdmin`, `Sidebar.tsx:34-36`) to mirror; the existing hardcoded `MobileNav.TABS` (`MobileNav.tsx:7-11`) to replace; DashboardChrome already threads role props to MobileNav's sibling drawer (`DashboardChrome.tsx:80-89, 125-133`) — but MobileNav currently receives NONE (it's rendered prop-less at `:79` and `:121`). **Gap: Bridge & Risk are not routes (Open Question 1).** |
| NAV-02 | Multi-tab surfaces (Overview / Holdings / Risk / Scenario) stay reachable on a phone via a scrollable tab strip at `<sm` (preserving the JOURNEY-03 `role=tab` a11y fix). | The tablist + actions live in one flex row (`AllocationsTabs.tsx:543-657`); the `role="tablist"` wraps only the 6 `role="tab"` buttons (`:565-608`), Export/+Allocation are siblings (`:609-655`) — JOURNEY-03 fix to preserve. The factsheet section-nav at `FactsheetView.tsx:749-775` is a working `overflow-x-auto` precedent. |
| NAV-03 | The mobile drawer traps focus and the app exposes a skip-link — keyboard and screen-reader navigable (generalize the existing factsheet skip-link to the app shell; prefer the `inert` attribute over a hand-rolled trap). | Drawer trap/scroll-lock/restore already done (`MobileSidebarDrawer.tsx:82-148`); React 19 `inert` typed (`@types/react:2854`); skip-link pattern at `strategy/[id]/v2/page.tsx:31-57` + `.strategy-v2-skip-link` CSS (`globals.css:382-407`); `<main>` landmarks at `DashboardChrome.tsx:67, 108` need a stable `id`. |
</phase_requirements>

## Standard Stack

This is a **zero-new-dependency** phase. Everything needed is already installed.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `react` / `react-dom` | 19.2.4 [VERIFIED: package.json + node_modules/react-dom/package.json] | `inert` native boolean prop; `usePathname`; component model | React 19 supports `inert` as a typed DOM prop (`@types/react/index.d.ts:2854`). No polyfill, no ref+effect needed. |
| `next` | ^16.2.3 [VERIFIED: package.json] | App Router, `next/link`, `usePathname`, `useSearchParams` | Existing nav uses these (`MobileNav.tsx:3-4`). |
| `@playwright/test` | ^1.59.1 [VERIFIED: package.json + Phase 44 RESEARCH] | drawer-keyboard + nav-shell reflow/target-size e2e | Existing harness; Phase 44 added `e2e/helpers/reflow.ts`. |
| `vitest` | ^4.1.2 [VERIFIED: package.json] | unit tests for the nav-derivation helper (coverage ratchet) | Co-located `*.test.tsx` convention; `frontend-coverage` job. |
| `tailwindcss` | ^4 [VERIFIED: Phase 44 RESEARCH] | `overflow-x-auto`, `flex-nowrap`, `md:hidden`, `min-h-[44px]`, `pointer-coarse:`, `sr-only` | CSS-first config; all utilities already in use. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@/lib/utils` `cn()` | (internal) [VERIFIED: MobileNav.tsx:5] | className merge | Already imported in `MobileNav`. |
| `useBreakpoint` (Phase 44) | (internal) [VERIFIED: Phase 44 RESEARCH] | JS viewport branch IF needed | Per CONTEXT: use **only where needed**. NAV-01/02 are CSS-first (`md:hidden` / `overflow-x-auto`); `useBreakpoint` is likely NOT needed this phase (see Pitfall 1). |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `inert={menuOpen}` native React 19 prop | A `ref` + `useEffect` setting `el.inert = open` | React 19 supports `inert` directly in JSX (`@types/react:2854`), so the ref+effect is unnecessary ceremony. Native prop is the blessed path — and it's SSR-safe (renders `inert=""` attribute server-side; on close React removes it). |
| `buildPrimaryMobileNav()` extracted helper | MobileNav calls `buildNavSections()` and `.flatMap()`s a subset | `buildNavSections` returns the FULL grouped nav (sections + subGroups), and Bridge/Risk are NOT in it (they're not routes). A thin dedicated `buildPrimaryMobileNav` that reuses Sidebar's icon components + labels + role OR-logic is cleaner than post-filtering a structure that doesn't contain 2 of the 3 target items. Recommend the dedicated helper (still single-source for icons/labels/role-logic). |
| Tab-strip `overflow-x-auto` on the existing flex row | A separate mobile-only tab component | The existing row already holds tablist + 2 action buttons (`AllocationsTabs.tsx:543`). The CSS-first fix is `flex-nowrap overflow-x-auto` scoped so the strip scrolls without dropping tabs and without re-nesting `role=tab` (JOURNEY-03). A separate component risks re-introducing the a11y nesting violation. Recommend in-place CSS. |

**Installation:** None. `npm install` adds nothing this phase. [VERIFIED: all packages already in package.json.]

**Version verification:**
- `react` / `react-dom` `19.2.4` — `node_modules/react-dom/package.json` `"version": "19.2.4"` [VERIFIED].
- `inert?: boolean` — `node_modules/@types/react/index.d.ts:2852-2854` (JSDoc links MDN HTMLElement/inert) [VERIFIED].

## Package Legitimacy Audit

> No external packages are installed in this phase. Audit not required. All code reuses in-repo modules + already-installed deps.

**Packages removed due to slopcheck [SLOP] verdict:** none (no installs)
**Packages flagged as suspicious [SUS]:** none (no installs)

## Architecture Patterns

### System Architecture Diagram

```
                     PHASE 45 — NAVIGATION SHELL (mobile chrome completion)

  ROLE PROPS (from server)                 DashboardChrome.tsx ("use client" wrapper)
  isAllocator/isManager/isAdmin            ┌──────────────────────────────────────────┐
  populatedSlugs / flaggedCount            │  <a href="#main-content"> Skip to main   │ ← NEW skip-link
        │ (already threaded to drawer)     │     (first focusable; .app-skip-link CSS)│   (FIRST child)
        │                                  │                                          │
        ▼                                  │  <MobileTopBar ref={hamburgerRef} .../>  │ ← hamburger (≥44px ✓ already)
  ┌─────────────────────┐                  │                                          │
  │ buildPrimaryMobileNav│◀── reuses ──┐   │  <main id="main-content"                 │ ← NEW stable id
  │  (NEW helper)        │   Sidebar's  │   │        inert={menuOpen}>  ◀── NEW inert │   + inert while drawer open
  │  role OR-logic +     │   icons +    │   │     {children}  (the route's page)       │
  │  icons + labels      │   labels +   │   │  </main>                                 │
  │  → ≤5 primary items  │   role logic │   │                                          │
  └─────────┬───────────┘              │   │  <MobileNav ...roleProps/>  ◀── NEW props│ ← role-aware (was prop-less stub)
            │                          │   │     fixed bottom md:hidden, ≥44px targets│
            ▼                          │   │                                          │
  ┌─────────────────────┐             │   │  <MobileSidebarDrawer open={menuOpen}    │
  │ MobileNav (rewrite)  │             │   │     ...roleProps triggerRef=hamburgerRef>│ ← trap/scroll-lock/restore
  │  allocator → /alloc, │             │   │     (UNCHANGED behavior; inert is on     │   ALREADY WORKS (G11.C.2/WR-03)
  │   Bridge*, Risk*     │─────────────┘   │      <main> SIBLING, not here)            │
  │  manager  → ...      │  *deep-links     └──────────────────────────────────────────┘
  │  admin    → ...      │   to tab strip
  └─────────────────────┘   (Open Q1)

  AllocationsTabs.tsx — multi-tab surface (NAV-02, CSS-first)
  ┌────────────────────────────────────────────────────────────────────────┐
  │  <div data-allocator-tabstrip flex flex-wrap ...>   ◀── add scroll @ <sm │
  │    <h1>My Allocation</h1>                                                 │
  │    <div role="tablist"> [Overview][Holdings][Outcomes][Mandate][Risk]    │ ← JOURNEY-03: tabs are
  │       [Scenario] </div>   ◀── wrap in overflow-x-auto flex-nowrap @ <sm  │   role=tab siblings ONLY
  │    <Export/> <+Allocation/>   (siblings of tablist — keep outside)        │   (axe aria-required-children)
  │  </div>                                                                   │
  └────────────────────────────────────────────────────────────────────────┘

  VERIFICATION (FLOW-01 dual-wire)
  e2e/mobile-drawer-keyboard.spec.ts (NEW, SEEDED authed)   tests/.../buildPrimaryMobileNav.test.ts (NEW unit)
     ├─ HAS_SEED_ENV const (place 2 of 2)                      └─ role branches → coverage ratchet
     ├─ seedTestAllocator() + loginViaForm (mirror composer-axe)
     └─ ci.yml:1252 MA-8 seeded list (place 1 of 2)
  reflow.spec.ts / target-size.spec.ts — REUSE assertNoReflow / assertTargetSizes on the nav shell @ 320px
```

### Recommended Project Structure
```
src/components/layout/
├── Sidebar.tsx                 # EXISTS — buildNavSections (role SoT) + icon components.
│                               #   Option A: export a buildPrimaryMobileNav() here (co-located
│                               #   with the icons it reuses), OR
├── nav-config.ts              # NEW (Option B) — extract buildPrimaryMobileNav + shared NavItem
│                               #   type; both Sidebar & MobileNav import. (Decide at plan time;
│                               #   Option A is less churn since icons live in Sidebar.tsx.)
├── MobileNav.tsx               # REWRITE — role-aware, consumes buildPrimaryMobileNav, ≥44px targets.
├── MobileNav.test.tsx          # NEW — role branches (allocator/manager/admin/both), coverage.
├── MobileSidebarDrawer.tsx     # UNCHANGED behavior (inert goes on <main>, not here).
├── MobileTopBar.tsx            # UNCHANGED — hamburger already min-h/min-w-[44px] (:31).
└── DashboardChrome.tsx         # EDIT — add skip-link (first child), <main id>, inert={menuOpen},
                                #   thread role props to <MobileNav> (currently prop-less).

src/app/(dashboard)/allocations/
└── AllocationsTabs.tsx         # EDIT — tab-strip overflow-x-auto flex-nowrap @ <sm (JOURNEY-03 preserved).

src/app/globals.css             # EDIT — add .app-skip-link / .app-skip-link:focus (generalize
                                #   .strategy-v2-skip-link 382-407), OR reuse Tailwind sr-only +
                                #   focus:not-sr-only (Claude's discretion — see Pattern 4).

e2e/
└── mobile-drawer-keyboard.spec.ts  # NEW — SEEDED authed; mirror composer-axe auth; FLOW-01 dual-wire.

.github/workflows/ci.yml         # EDIT — add e2e/mobile-drawer-keyboard.spec.ts to MA-8 list (:1252-1262).
```
**Convention note:** Unit tests are co-located (`src/**/*.test.{ts,tsx}` is the vitest include glob per Phase 44 RESEARCH). Place `MobileNav.test.tsx` (and any `nav-config.test.ts`) next to source.

### Pattern 1: Role-aware `MobileNav` deriving from the shared nav source (NAV-01)

**What:** Replace the hardcoded `TABS` const (`MobileNav.tsx:7-11`) with a role-derived ≤5-item set, reusing Sidebar's icon components + labels + role OR-logic. DashboardChrome must START passing role props to `<MobileNav>` (today it renders `<MobileNav />` prop-less at `:79` and `:121`).

**Exact current `buildNavSections` signature & return shape (`Sidebar.tsx:19-25, 82-113`):**
```typescript
// Source: src/components/layout/Sidebar.tsx:19-25 (this repo)
function buildNavSections(
  populatedSlugs?: string[],
  isAdmin?: boolean,
  isAllocator?: boolean,
  flaggedCount?: number,
  isManager?: boolean,
): NavSection[]
// NavSection = { heading: string; items: NavItem[]; subGroups?: NavSubGroup[] }
// NavItem    = { label: string; href: string; icon: IconComponent; badge?: number }
// IconComponent = ({ className }: { className?: string }) => React.JSX.Element
```
Return order: `MY WORKSPACE` (allocator → `My Allocation /allocations` w/ `flaggedCount` badge; manager → `Strategies /strategies`, `Portfolios /portfolios`), `DISCOVERY` (allocator/admin subGroups), `ADMIN` (5 items: `/admin`, `/admin/users`, `/admin/deletion-requests`, `/admin/match`, `/admin/for-quants-leads`), `ACCOUNT` (`Profile /profile`).

**Role OR-logic to mirror (`Sidebar.tsx:34-36`):**
```typescript
const showsAllocatorWorkspace = isAllocator || isAdmin;
const showsManagerWorkspace   = isManager   || isAdmin;
const showsDiscovery          = isAllocator || isAdmin;
// role "both" lights the allocator set; NOT the pre-fix `!isAllocator` short-circuit.
```

**Icons/labels that already exist for the SC#1 allocator targets:**
- `My Allocation` → `/allocations`, icon `PortfolioIcon` (`Sidebar.tsx:64, 290-298`). **This is the only one of the three that is a real route in buildNavSections.**
- `Bridge` → **no `/bridge` route, no nav item.** Bridge is `BridgeWidget` (`allocations/components/BridgeWidget.tsx`) + `BridgeDrawer`, surfaced on the Risk tab / dashboard. No icon exists yet (Claude's discretion per CONTEXT).
- `Risk` → **no route; it's a tab** (`/allocations?tab=risk`, `AllocationsTabs.tsx:255-262, 296-298`). No standalone nav item/icon.

**Recommended helper shape (reuses Sidebar's icons; Bridge/Risk as tab deep-links — see Open Q1):**
```typescript
// Source: derived from Sidebar.tsx role-logic + icon components (this repo)
// Co-locate in Sidebar.tsx (export) or a new nav-config.ts. Single source for
// icons/labels/role-logic so the two navs never drift (CONTEXT / Rule 6).
export function buildPrimaryMobileNav(p: {
  isAllocator?: boolean; isManager?: boolean; isAdmin?: boolean; flaggedCount?: number;
}): NavItem[] {
  const items: NavItem[] = [];
  if (p.isAllocator || p.isAdmin) {            // showsAllocatorWorkspace
    items.push({ label: "My Allocation", href: "/allocations", icon: PortfolioIcon, badge: p.flaggedCount });
    items.push({ label: "Risk",   href: "/allocations?tab=risk", icon: /* discretion */ });   // tab deep-link
    items.push({ label: "Bridge", href: "/allocations?tab=risk", icon: /* discretion */ });   // BridgeWidget on Risk tab — Open Q1
  }
  if (p.isManager || p.isAdmin) {              // showsManagerWorkspace
    items.push({ label: "Strategies", href: "/strategies", icon: BarChartIcon });
    items.push({ label: "Portfolios", href: "/portfolios", icon: PieChartIcon });
  }
  items.push({ label: "Profile", href: "/profile", icon: UserIcon }); // ACCOUNT, always
  return items.slice(0, 5);                    // ≤5 per CONTEXT
}
```
**When to use:** MobileNav's render. Keep the existing active-match (`pathname === href || pathname.startsWith(href + "/")`, `MobileNav.tsx:20`). NOTE: for tab deep-links (`/allocations?tab=risk`) the pathname-prefix match alone won't distinguish tabs — `usePathname()` strips the query string. The planner must decide active-state for tab deep-links (e.g. read `useSearchParams().get("tab")`, or accept that all `/allocations*` items share active state). Flag in Open Question 1.

### Pattern 2: Scrollable tab strip preserving JOURNEY-03 (NAV-02)

**What:** Make the tablist scroll horizontally on `<sm` without dropping tabs and without re-nesting `role=tab` inside a new control.

**The JOURNEY-03 structure to preserve (`AllocationsTabs.tsx:560-608`):**
```tsx
// Source: src/app/(dashboard)/allocations/AllocationsTabs.tsx:565-608 (this repo)
<div role="tablist" aria-label="Allocation surfaces" className="flex items-center gap-1">
  {VISIBLE_TAB_KEYS.map((key) => ( <button role="tab" id={`tab-${key}`} aria-selected={...} ... /> ))}
</div>
{/* Export + "+ Allocation" are SIBLINGS of the tablist (lines 609-655) — a role="tablist"
    may contain ONLY role="tab" children (axe aria-required-children, critical). */}
```
**The overflow problem at `<sm`:** the outer row is `flex flex-wrap items-end gap-x-4 gap-y-3` (`:545`). The tablist itself is `flex items-center gap-1` (`:569`) holding 6 tabs + count badges; alongside it the Export + "+ Allocation" buttons + a `+ Allocation` accent button all live in the `ml-auto` cluster (`:565`). At `<sm` the 6 tab buttons (each `px-3 py-1.5 text-sm`, `:323-325`) plus two action buttons exceed 320–375px and either wrap (currently `flex-wrap`) or overflow.

**CSS-first fix (the precedent is the factsheet section-nav at `FactsheetView.tsx:749-775`):**
```tsx
// The factsheet ALREADY does this — mirror it:
<nav aria-label="Factsheet sections" className="... overflow-x-auto">
  <ul className="flex items-center gap-1 ...">  {/* horizontal scroll, no wrap */}
```
Apply to the tablist (NOT the whole row, to keep Export/+Allocation reachable): scope `overflow-x-auto` + `flex-nowrap` to a wrapper around the `role="tablist"` div (or the tablist itself) at `<sm`, e.g. `sm:flex-wrap max-sm:flex-nowrap max-sm:overflow-x-auto`. Keep `aria-required-children` intact: the `overflow-x-auto` wrapper is a `<div>` with NO `role`, wrapping the unchanged `role="tablist"` → no new aria-parent over the tabs. Tabs stay siblings of each other; Export/+Allocation stay siblings of the tablist. **Anti-pattern: do NOT add `role` to the scroll wrapper, and do NOT move Export/+Allocation inside it.**

### Pattern 3: Drawer background `inert` (NAV-03)

**What:** Set `inert` on the page region behind the backdrop while the drawer is open, as belt-and-suspenders over the existing manual Tab trap (`MobileSidebarDrawer.tsx:92-132`).

**React 19 supports `inert` natively (`@types/react/index.d.ts:2852-2854`):**
```typescript
// Source: node_modules/@types/react/index.d.ts:2852-2854 (this repo)
/** @see {@link https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/inert} */
inert?: boolean | undefined;
```
**Where to apply — CRITICAL scoping (CONTEXT pitfall):** the drawer (`MobileSidebarDrawer`, `fixed inset-0 z-40`, `:154`) is a SIBLING of `<main>` in DashboardChrome's tree (both children of the `flex h-full` wrapper, `:94-135`). Set `inert={menuOpen}` on the **`<main>`** element (`DashboardChrome.tsx:67` full-bleed, `:108` standard) — NOT on the `flex h-full` wrapper that contains BOTH main AND the drawer (that would disable the drawer too). The `MobileNav` bottom bar is also a sibling; decide whether it too should be inert while the drawer is open (the drawer covers it visually; making it inert is consistent, but the existing manual trap already blocks Tab leak, so `<main>` inert is the minimum that satisfies SC#3's "no leak to the page behind the backdrop").

```tsx
// Source: DashboardChrome.tsx:108 (this repo) — minimal edit
<main id="main-content" inert={menuOpen} aria-label="Dashboard content"
      className="flex-1 md:ml-[260px] overflow-y-auto pb-16 md:pb-0">
```
**SSR-safety:** `inert={false}` renders no attribute; `inert={true}` renders `inert=""`. `menuOpen` is `useState(false)` (`DashboardChrome.tsx:55`), so the server render is always `inert={false}` (drawer can't be open on first paint) → no hydration mismatch. The existing manual Tab trap stays as defence-in-depth (do NOT remove it).

**Interaction with the manual trap (Pitfall 2):** `inert` makes `<main>`'s descendants non-focusable AND removes them from the tab order, so the manual trap's `panel.contains(active)` checks (`:121, 127`) still hold — focus simply can't land outside the drawer. No conflict. The one subtlety: `inert` on `<main>` does NOT affect the drawer (sibling) or the bottom `MobileNav` (sibling) — confirm the bottom nav is either also inert or visually/functionally irrelevant while open.

### Pattern 4: App-shell skip-link generalized from the factsheet (NAV-03)

**What:** A visually-hidden-until-focused "Skip to main content" anchor as the FIRST focusable element in DashboardChrome, targeting `<main id="main-content">`. Present on every authed route (DashboardChrome wraps `(dashboard)/layout.tsx`).

**The existing factsheet skip-link to generalize (`strategy/[id]/v2/page.tsx:50-57`):**
```tsx
// Source: src/app/strategy/[id]/v2/page.tsx:50-57 (this repo)
<nav aria-label="Page sections" className="strategy-v2-skip-nav">
  {SKIP_LINKS.map((sl) => (
    <a key={sl.href} href={sl.href} className="strategy-v2-skip-link">{sl.label}</a>
  ))}
</nav>
```
**The CSS pattern (`globals.css:382-407`) — visually hidden until `:focus`:**
```css
/* Source: src/app/globals.css:382-407 (this repo) */
.strategy-v2-skip-link { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
.strategy-v2-skip-link:focus {
  position: fixed; top: 8px; left: 8px; z-index: 100; width: auto; height: auto;
  padding: 8px 12px; background: var(--color-surface); border: 1px solid var(--color-accent);
  color: var(--color-accent); font-family: var(--font-sans); font-size: 12px; font-weight: 400;
  text-decoration: none; box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  outline: 2px solid var(--color-accent); outline-offset: 1px;
}
```
**Generalization options (Claude's discretion per CONTEXT):**
- **Option A (reuse pattern):** add `.app-skip-link` / `.app-skip-link:focus` in `globals.css` (copy of the above), one `<a href="#main-content" className="app-skip-link">Skip to main content</a>` as the first child of DashboardChrome's outer `<div>` (BEFORE `MobileTopBar`/`Sidebar`/`<main>`).
- **Option B (Tailwind):** `<a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded focus:bg-surface focus:px-3 focus:py-2 focus:outline-2 focus:outline-accent">`. Tailwind v4 ships `sr-only` + `focus:not-sr-only` (used elsewhere in repo).

**Placement (load-bearing):** must be the FIRST focusable element in tab order. In DashboardChrome put it as the first child of BOTH the full-bleed `<div className="flex h-full">` (`:65`) and the standard one (`:94`), before MobileTopBar/Sidebar/main. The `<main>` must carry `id="main-content"` (add to `:67` and `:108`). On `:108` `<main>` already has `aria-label="Dashboard content"` — keep it and add `id`. `<main>` is not natively focusable for the `#main-content` jump; add `tabIndex={-1}` to `<main>` so the skip target receives focus (standard skip-link pattern; the factsheet targets `<section id>` elements which are also non-focusable — consider `tabIndex={-1}` on `<main>` for robust focus move).

### Pattern 5: ≥44px nav targets (SC#4)

**What:** Hamburger + every bottom-nav target ≥44px.
- **Hamburger:** ALREADY compliant — `MobileTopBar.tsx:31` is `min-h-[44px] min-w-[44px]`. No change needed (verify in the target-size gate).
- **Bottom-nav targets:** current `MobileNav` links are `py-2 ... flex flex-1 flex-col` (`MobileNav.tsx:26`) — `py-2` (8px) + a `h-5` icon (20px) + ~12px label ≈ under 44px. Apply the `Button.tsx` `min-h-[44px]` + `pointer-coarse` convention (referenced in CONTEXT and visible at `FactsheetView.tsx:763` `pointer-coarse:min-h-[44px]`). Add `min-h-[44px]` to each `<Link>` in MobileNav.

### Anti-Patterns to Avoid
- **A second hardcoded nav list:** the whole point of NAV-01 is DRY — reuse Sidebar's icons/labels/role-logic via the shared helper (CONTEXT / Rule 6).
- **`inert` on an ancestor of the drawer:** would disable the drawer too. Scope to `<main>` (sibling), never the `flex h-full` wrapper (`DashboardChrome.tsx:66, 95`).
- **Re-nesting `role=tab` inside a new scroll control with a `role`:** re-introduces the JOURNEY-03 critical axe violation (`aria-required-children`). The scroll wrapper must be a role-less `<div>`.
- **Moving Export / + Allocation inside the tablist:** they are siblings by design (`AllocationsTabs.tsx:560-564` comment) — keep them out.
- **Removing the manual Tab trap when adding `inert`:** keep both (defence-in-depth per CONTEXT/specifics).
- **A new seeded e2e wired to only ONE FLOW-01 site:** the twice-burned trap — wire BOTH `ci.yml:1252` MA-8 list AND the spec's `HAS_SEED_ENV` const.
- **Lowering the coverage ratchet** to absorb MobileNav's new role branches (CLAUDE.md §Test Coverage / ROADMAP cross-cutting gate).
- **Using `useBreakpoint` for the bottom-nav/tab-strip show-hide:** those are pure CSS (`md:hidden` / `overflow-x-auto`). Reserve `useBreakpoint` for genuine JS branches only (none obviously needed this phase).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Drawer focus trap / scroll-lock / restore | A new trap | The EXISTING `MobileSidebarDrawer.tsx:82-148` (G11.C.2 + WR-03) | Already audited + working; this phase only ADDS `inert` + skip-link. |
| Focus barrier behind the backdrop | A hand-rolled focus-guard / ref+effect setting `.inert` | React 19 native `inert={menuOpen}` prop on `<main>` | Typed (`@types/react:2854`), SSR-safe, blessed; ref ceremony is unnecessary. |
| Role-aware nav item list | A second `TABS` const in MobileNav | A shared `buildPrimaryMobileNav` reusing Sidebar's icons/labels/role-logic | DRY; prevents desktop/mobile nav drift (CONTEXT). |
| Skip-link visibility | New bespoke sr-only CSS | Generalize `.strategy-v2-skip-link` (`globals.css:382-407`) OR Tailwind `sr-only`/`focus:not-sr-only` | Pattern already proven on the factsheet route; consistent reveal styling. |
| Horizontal tab scroll | A custom carousel / JS scroll | `overflow-x-auto flex-nowrap` (CSS-first) — the factsheet section-nav precedent (`FactsheetView.tsx:751`) | CSS-first per CONTEXT; preserves JOURNEY-03 with no new aria-parent. |
| Reflow / 44px nav-shell measurement | A new measurement spec | `assertNoReflow` / `assertTargetSizes` from `e2e/helpers/reflow.ts` (Phase 44) | Reusable helper exists (verified exports at `:47, :119`); takes any route + visible anchor. |
| Seeded authed e2e login | A new auth helper | `seedTestAllocator()` + `loginViaForm` from `composer-axe.spec.ts:58-95` + `seed-test-project.ts:75` | Live, working seeded-authed pattern; `strategy-v2-keyboard.spec.ts` is DEAD (`test.skip(true)`). |

**Key insight:** Every piece exists. The risk is NOT "how do I build X" — it's (a) the Bridge/Risk-aren't-routes gap (Open Q1), (b) scoping `inert` to a sibling not an ancestor (Pitfall 2), (c) the new seeded e2e silently never running (FLOW-01), and (d) preserving JOURNEY-03 when adding the scroll wrapper.

## Runtime State Inventory

> Phase 45 is a client-component UI phase (nav markup + CSS + one new e2e + ci.yml edit). No rename/refactor of stored data, no migration. Included for completeness.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — no datastore touched. No DB keys/collections renamed. | None |
| Live service config | None — no external service config (n8n/Datadog/etc.) touched. | None |
| OS-registered state | None — no scheduled tasks / process registrations. | None |
| Secrets/env vars | The new seeded e2e READS existing CI seed env (`TEST_SUPABASE_URL` / `TEST_SUPABASE_SERVICE_ROLE_KEY` via `vars.E2E_TEST_DB_CONFIGURED`) — ADDS none. | None (reuse existing seed env) |
| Build artifacts | Pure source/CSS edits + one e2e + ci.yml; `.next/` rebuilds normally. No stale artifact risk. | None |

**Nothing found in any category** — verified: no migrations, no datastore keys, no service config, no OS registrations, no new secrets. The only cross-cutting touches are `ci.yml` (add 1 spec to the MA-8 seeded list) + `globals.css` (skip-link CSS, optional) + `DashboardChrome.tsx` + `MobileNav.tsx` + `AllocationsTabs.tsx` + `Sidebar.tsx` (or new `nav-config.ts`) + 1 new e2e + 1 new unit test.

## Common Pitfalls

### Pitfall 1: Bridge & Risk are not routes (the SC#1 derivation gap)
**What goes wrong:** A literal "derive a ≤5 subset from `buildNavSections`" can't produce Bridge or Risk because neither is in the structure — Risk is a tab (`/allocations?tab=risk`) and Bridge is `BridgeWidget`/`BridgeDrawer` on the Risk tab (no `/bridge` route — verified: no `src/app/(dashboard)/bridge` directory).
**Why it happens:** `buildNavSections` only emits `/allocations` for the allocator workspace (`Sidebar.tsx:59-66`). SC#1 names three destinations; only one is a nav route.
**How to avoid:** Use a dedicated `buildPrimaryMobileNav` helper (still single-source for icons/labels/role-logic) and represent Bridge/Risk as **tab deep-links** (`/allocations?tab=risk`). Decide active-state handling for query-param tabs (Open Q1). Document the deep-link decision so it's not silently treated as "the subset of buildNavSections."

### Pitfall 2: `inert` on an ancestor disables the drawer too
**What goes wrong:** Putting `inert={menuOpen}` on the `flex h-full` wrapper (`DashboardChrome.tsx:66, 95`) — which contains BOTH `<main>` AND `<MobileSidebarDrawer>` — makes the drawer itself inert, so the drawer's links/buttons become non-focusable and the user is trapped with a dead drawer.
**Why it happens:** The drawer is a sibling of `<main>` inside the same wrapper, not a child of `<main>`.
**How to avoid:** Scope `inert={menuOpen}` to the `<main>` element ONLY (`:67`, `:108`). Verify the drawer (`fixed inset-0 z-40`, `MobileSidebarDrawer.tsx:154`) and the bottom `MobileNav` are siblings, not descendants, of the inert `<main>`. Add a drawer-keyboard e2e assertion that drawer links ARE focusable while open (catches an accidental ancestor-inert regression).
**Warning signs:** Tab does nothing when the drawer is open; the drawer's first link never receives focus on open.

### Pitfall 3: FLOW-01 — the new seeded e2e never actually runs (BURNED TWICE)
**What goes wrong:** The drawer-keyboard spec self-skips (`HAS_SEED_ENV` false) OR is never added to the `ci.yml` MA-8 list → CI green, zero assertions ran.
**Why it happens:** Two-tier Playwright requires BOTH places (`ci.yml:1250-1251` literally: "Adding/removing a seed-gated spec? Update both this list and the e2e/<spec>.spec.ts HAS_SEED_ENV constant"). v1.2 JOURNEY-03 axe caught 3 real bugs ONLY after it actually executed.
**How to avoid:** (1) Add `e2e/mobile-drawer-keyboard.spec.ts \` to the MA-8 `npx playwright test \` block at `ci.yml:1252-1262` (place 1). (2) In the spec, `const HAS_SEED_ENV = !!process.env.TEST_SUPABASE_URL && !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;` + `test.skip(!HAS_SEED_ENV, ...)` (place 2). (3) PROVEN-EXECUTION: grep the CI run log for the spec name → `N passed` (not `N skipped`). Gate each assertion behind a visible-anchor (drawer `[role="dialog"]` visible) so a blank/login page fails LOUD (mirror `composer-axe.spec.ts:104-106`).
**Warning signs:** CI log shows the spec `skipped`; the spec passes with 0 expects.

### Pitfall 4: JOURNEY-03 a11y nesting regression on the scroll wrapper
**What goes wrong:** Adding a scroll container with a `role` (or moving Export/+Allocation inside the tablist) re-introduces the critical axe `aria-required-children` violation the JOURNEY-03 fix removed.
**Why it happens:** A `role="tablist"` may contain ONLY `role="tab"` children (`AllocationsTabs.tsx:560-564` comment).
**How to avoid:** The `overflow-x-auto flex-nowrap` wrapper is a role-less `<div>` around the unchanged `role="tablist"`; Export/+Allocation stay siblings of the tablist. Re-run `composer-axe.spec.ts` (the seeded JOURNEY-03 axe gate at `ci.yml:1261`) after the change — it scans `/allocations?tab=scenario` and would catch a re-nesting regression.
**Warning signs:** `composer-axe` reports `aria-required-children` (critical).

### Pitfall 5: Coverage ratchet trips on MobileNav's new role branches
**What goes wrong:** `buildPrimaryMobileNav`'s allocator/manager/admin/both branches are uncovered → `frontend-coverage` fails (lines 82 / stmts 80 / fns 74 / **branches 72**).
**Why it happens:** New role conditionals add branches; the ratchet sits just under measured actual.
**How to avoid:** A `MobileNav.test.tsx` (or `nav-config.test.ts`) exercising every role combo: allocator-only, manager-only, admin (both sets), `both` (allocator set lights), and the ≤5 slice. Never lower a threshold.

### Pitfall 6: Tab deep-link active state under `usePathname()`
**What goes wrong:** MobileNav's active match `pathname === href || pathname.startsWith(href + "/")` (`MobileNav.tsx:20`) strips the query string — `/allocations?tab=risk` and `/allocations` both resolve to pathname `/allocations`, so a Risk bottom-nav item appears active on the Overview tab (and vice-versa).
**Why it happens:** `usePathname()` returns path without search params (Next 16).
**How to avoid:** For tab deep-links, read `useSearchParams().get("tab")` for active state, OR accept all `/allocations*` items sharing active state (document the choice). Note `useSearchParams()` triggers Next 16's CSR-bailout rule — MobileNav is already `"use client"` but is rendered inside DashboardChrome (no Suspense around it). If `useSearchParams` is added, verify no static-render bailout error (AllocationsTabs wraps itself in Suspense for exactly this reason — `AllocationsTabs.tsx:236-238`). Simplest: keep pathname-only active state and accept shared `/allocations` active highlight (Claude's discretion).

## Code Examples

### The two FLOW-01 wiring sites (EXACT) — new SEEDED authed spec
```yaml
# .github/workflows/ci.yml — SEEDED MA-8 list (lines 1252-1262). The drawer-keyboard
# spec is AUTHED → it goes HERE (not the unseeded :1059 list). ADD the new spec line:
          npx playwright test \
            e2e/onboarding-funnel.spec.ts \
            e2e/discovery-axe.spec.ts \
            e2e/discovery-hide-examples-default.spec.ts \
            e2e/discovery-prefs-isolation.spec.ts \
            e2e/strategy-v2-partial-data.spec.ts \
            e2e/strategy-v2-chart-parity.spec.ts \
            e2e/strategy-v2-keyboard.spec.ts \
            e2e/strategy-v2-axe.spec.ts \
            e2e/composer-axe.spec.ts \
            e2e/mobile-drawer-keyboard.spec.ts \   # ◀── ADD (FLOW-01 place 1 of 2)
            --timeout 60000
```
```typescript
// e2e/mobile-drawer-keyboard.spec.ts — FLOW-01 place 2 of 2 (the HAS_SEED_ENV const + skip)
const HAS_SEED_ENV =
  !!process.env.TEST_SUPABASE_URL &&
  !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
test.describe("Phase 45 — mobile drawer keyboard containment (NAV-03)", () => {
  test.skip(!HAS_SEED_ENV, "drawer-keyboard: seed env not wired — skip prevents false-green (W-02).");
  // ...
});
```

### Seeded authed login pattern to mirror (from `composer-axe.spec.ts:58-95`)
```typescript
// Source: e2e/composer-axe.spec.ts:58-95 (this repo) — the LIVE pattern. seedTestAllocator()
// stamps a VERIFIED allocator (clears the universal approval gate) + investor_attestations.
import { test, expect } from "@playwright/test";
import { seedTestAllocator } from "./helpers/seed-test-project"; // :75 returns {userId,email,password}

async function loginViaForm(page, email, password) {
  await page.goto("/login");
  await page.fill('input[name="email"], input[placeholder*="email" i]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL(/\/(discovery|strategies|allocations|dashboard)/, { timeout: 10000 });
}

test("Tab/Shift+Tab stay in the open drawer; focus moves in on open, restores on close", async ({ page }) => {
  const allocator = await seedTestAllocator();
  await loginViaForm(page, allocator.email, allocator.password);
  await page.setViewportSize({ width: 375, height: 800 }); // mobile chrome
  await page.goto("/allocations");
  // Open the drawer via the hamburger (MobileTopBar:24-31, aria-controls="mobile-sidebar-drawer").
  await page.getByRole("button", { name: "Open menu" }).click();
  const drawer = page.locator('#mobile-sidebar-drawer[role="dialog"]'); // MobileSidebarDrawer:155-158
  await expect(drawer).toBeVisible({ timeout: 5_000 });               // fail-loud anchor (W-02)
  // Focus moved INTO the drawer on open (first nav link) — MobileSidebarDrawer:139-142.
  await expect(drawer.locator("a[href]").first()).toBeFocused();
  // Tab cycles within the drawer; background <main inert> can't receive focus.
  // ... assert document.activeElement stays inside #mobile-sidebar-drawer across Tab presses ...
  // Close (Escape) → focus restored to the hamburger (MobileSidebarDrawer:85-86).
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Open menu" })).toBeFocused();
});
```

### Nav-shell 320px reflow + 44px reuse (Phase 44 helper)
```typescript
// Source: e2e/helpers/reflow.ts (Phase 44) exports assertNoReflow(page, anchorSelector)
// and assertTargetSizes(page, anchorSelector, interactiveSelector). Reuse on the nav shell:
import { assertNoReflow, assertTargetSizes } from "./helpers/reflow";
await page.setViewportSize({ width: 320, height: 800 });
await page.goto("/allocations"); // seeded authed, or a route that renders MobileNav + MobileTopBar
await assertNoReflow(page, "nav.fixed.bottom-0, [aria-label='Open menu']"); // anchor on a visible nav element
// Bottom-nav targets + hamburger ≥ 44px (hamburger already min-h/w-44; bottom-nav gets min-h-[44px]):
await assertTargetSizes(page, "[aria-label='Open menu']", "nav.fixed.bottom-0 a, [aria-label='Open menu']");
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hand-rolled focus barrier / `aria-hidden` on background | Native `inert` prop (React 19) | React 19 (repo on 19.2.4) | Set `inert={menuOpen}` in JSX directly; no ref+effect. SSR-safe (renders `inert=""` / nothing). |
| Role-blind 3-item `MobileNav.TABS` stub | Role-aware derived primary set | This phase | Mobile users reach role-appropriate nav (NAV-01). |
| Tab strip `flex-wrap` (wraps awkwardly at `<sm`) | `overflow-x-auto flex-nowrap` scroll | This phase | Tabs stay on one scrollable line (NAV-02); precedent at `FactsheetView.tsx:751`. |
| Per-route bespoke skip-link (factsheet only) | App-shell skip-link in DashboardChrome | This phase | Every authed route gets it (NAV-03). |

**Deprecated/outdated:**
- `e2e/strategy-v2-keyboard.spec.ts` is **DEAD** (`test.skip(true, "TODO: rewrite...")`, `:55-60`). Do NOT mirror it for the new drawer-keyboard spec — mirror `composer-axe.spec.ts` (live, seeded, authed). Its presence in the MA-8 list (`ci.yml:1259`) is a no-op skip.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Bridge/Risk bottom-nav items should be tab deep-links (`/allocations?tab=risk`) since neither is a route; Bridge surfaces as `BridgeWidget` on the Risk tab. | Pattern 1, Pitfall 1, Open Q1 | MEDIUM — if the planner/user wants a distinct Bridge surface or a `/bridge` route, that's a larger task outside this phase's "complete the shell" scope. Recommend deep-links; escalate to discuss if a dedicated Bridge route is wanted. |
| A2 | `inert` belongs on `<main>` (sibling of the drawer), and the bottom `MobileNav` may stay non-inert (manual trap already blocks Tab leak). | Pattern 3, Pitfall 2 | LOW — if a screen-reader can still reach the bottom nav while the drawer is open and that's undesired, also set `inert` on `MobileNav`. Cheap to add; the e2e proves containment either way. |
| A3 | Tab deep-link active state can stay pathname-only (shared `/allocations` highlight) — Claude's discretion. | Pattern 1, Pitfall 6 | LOW — purely cosmetic active-highlight; `useSearchParams` is the alternative but adds CSR-bailout/Suspense considerations. |
| A4 | The drawer-keyboard spec belongs in the SEEDED MA-8 list (authed route). | FLOW-01, CONTEXT | LOW — CONTEXT explicitly states this; `/allocations` is auth+approval gated (`composer-axe.spec.ts:89-94`), so unseeded would false-green on the login page. |
| A5 | `buildPrimaryMobileNav` co-located in (or beside) `Sidebar.tsx` is the DRY shape (reuses its icon components). | Standard Stack alt, Pattern 1 | LOW — Option A (export from Sidebar.tsx) vs Option B (new nav-config.ts) is a placement nicety; both keep a single source for icons/labels/role-logic. |

## Open Questions

1. **Bridge & Risk are not routes — what do the bottom-nav items point to?**
   - What we know: `/allocations` is the only allocator nav route in `buildNavSections`. Risk = `/allocations?tab=risk` (tab). Bridge = `BridgeWidget`/`BridgeDrawer` on the Risk tab; no `/bridge` route exists.
   - What's unclear: whether SC#1's "Bridge" should deep-link to the Risk tab (where BridgeWidget lives), get its own anchor, or whether a dedicated Bridge surface is desired.
   - Recommendation: deep-link both Bridge and Risk to `/allocations?tab=risk` (or Risk → `?tab=risk`, Bridge → the same tab where the widget renders), document it, and decide active-state per Pitfall 6. Escalate to discuss-phase only if a distinct `/bridge` route is wanted (out of scope for "complete the shell").

2. **Should the bottom `MobileNav` also be `inert` while the drawer is open?**
   - What we know: the drawer (`z-40`) visually covers the bottom nav (`z-30`); the manual Tab trap already prevents focus leaking there.
   - What's unclear: whether AT/screen-reader reaching the bottom nav while the drawer is open is acceptable.
   - Recommendation: set `inert` on `<main>` (required); optionally also on `MobileNav` for consistency. The drawer-keyboard e2e asserts containment regardless.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node / npm | builds & tests | ✓ | node 20 (ci.yml) | — |
| `@playwright/test` + chromium | drawer-keyboard + nav-shell reflow/target-size e2e | ✓ | ^1.59.1 | — (CI installs chromium) |
| `vitest` + `@vitest/coverage-v8` | nav-derivation unit test + ratchet | ✓ | ^4.1.2 / ^4.1.5 | — |
| `react` `inert` typed prop | drawer background hardening | ✓ | 19.2.4 (`@types/react:2854`) | — |
| Phase 44 `e2e/helpers/reflow.ts` | nav-shell 320px / 44px gate | ✓ | (in-repo, exports `:47, :119`) | — |
| Seed env (`TEST_SUPABASE_*`) | the new SEEDED drawer-keyboard spec | ✓ (`vars.E2E_TEST_DB_CONFIGURED`) | — | Spec self-skips when absent (authored-but-skipped) — but then it must be PROVEN to run in CI (FLOW-01) |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** none — phase adds zero dependencies.

## Validation Architecture

> `workflow.nyquist_validation: true` (verified in `.planning/config.json:19`) — this section is required.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^4.1.2 (jsdom) + Playwright ^1.59.1 (chromium) |
| Config file | `vitest.config.ts`, `playwright.config.ts` |
| Quick run command | `npx vitest run src/components/layout/MobileNav.test.tsx` (+ `nav-config.test.ts` if extracted) |
| Full suite command | `npm test` + `npm run test:coverage` (ratchet) + `npx playwright test e2e/mobile-drawer-keyboard.spec.ts e2e/reflow.spec.ts e2e/target-size.spec.ts e2e/composer-axe.spec.ts` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| NAV-01 | `buildPrimaryMobileNav` returns role-correct ≤5 items (allocator/manager/admin/both) | unit | `npx vitest run src/components/layout/MobileNav.test.tsx` | ❌ Wave 0 |
| NAV-01 | MobileNav renders role-appropriate items + active state | unit (RTL) | (same file) | ❌ Wave 0 |
| NAV-02 | Tab strip scrolls at `<sm`, no tab dropped, `role=tablist`/`role=tab` preserved | e2e (axe) | `npx playwright test e2e/composer-axe.spec.ts` (existing JOURNEY-03 gate catches re-nesting) | ✅ existing — re-run |
| NAV-02 | Tabs reachable via scroll at 320px | e2e | covered by nav-shell reflow on `/allocations` (assertNoReflow tab strip) | ❌ Wave 0 (assertion in new spec) |
| NAV-03 | Tab/Shift+Tab contained; focus in on open, restore on close; background inert | e2e (seeded authed) | `npx playwright test e2e/mobile-drawer-keyboard.spec.ts` | ❌ Wave 0 |
| NAV-03 | App-shell skip-link present + targets `#main-content` on authed routes | e2e | assertion in the drawer-keyboard spec (skip-link is first focusable, focuses `<main>`) | ❌ Wave 0 |
| SC#4 | Hamburger + bottom-nav targets ≥44px | e2e | `npx playwright test e2e/target-size.spec.ts` (reuse `assertTargetSizes` scoped to nav) | ✅ helper exists — add nav scope |
| SC#4 | Nav shell passes 320px reflow | e2e | `assertNoReflow` on a route rendering the shell | ✅ helper exists — add nav assertion |
| Cross | Coverage ratchet holds (new role branches) | coverage | `npm run test:coverage` | ✅ existing `frontend-coverage` job |

### Sampling Rate
- **Per task commit:** the quick run for the touched file (`vitest run src/components/layout/MobileNav.test.tsx`).
- **Per wave merge:** `npm test` + `npx playwright test e2e/mobile-drawer-keyboard.spec.ts e2e/composer-axe.spec.ts` (a11y nesting regression check).
- **Phase gate:** full vitest + coverage green (ratchet un-lowered) + a real CI run showing `e2e/mobile-drawer-keyboard.spec.ts` `passed` (not `skipped`) — the FLOW-01 proven-execution requirement — + `composer-axe` still green (JOURNEY-03 preserved).

### Wave 0 Gaps
- [ ] `src/components/layout/MobileNav.test.tsx` — role branches (allocator/manager/admin/both) + ≤5 slice + active state
- [ ] `e2e/mobile-drawer-keyboard.spec.ts` — SEEDED authed; mirror `composer-axe.spec.ts` auth; assert containment + inert + skip-link
- [ ] `.github/workflows/ci.yml:1252-1262` — add `e2e/mobile-drawer-keyboard.spec.ts \` to MA-8 list (FLOW-01 place 1)
- [ ] (the spec's own `HAS_SEED_ENV` const — FLOW-01 place 2)
- [ ] Framework install: none — vitest + playwright + coverage all present; `e2e/helpers/reflow.ts` already exists (Phase 44)

## Security Domain

> `security_enforcement` not set `false` in config — included for completeness. This phase is presentational nav chrome + CSS + one seeded e2e + ci.yml; near-zero security surface.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (indirect) | The new e2e exercises the EXISTING auth/approval gate (`seedTestAllocator` stamps verified) — does not add auth code. |
| V3 Session Management | no | none |
| V4 Access Control | minor | The role-aware nav must not surface admin/manager destinations to allocators — covered by the unit test's role branches (a nav-leak would be a UX/info issue, not an enforcement boundary; server routes still RLS/middleware-gate). |
| V5 Input Validation | no | no new user input; nav reads role props + pathname. |
| V6 Cryptography | no | none |
| V14 Config | minor | The skip-link/`inert`/44px work is a11y config-hardening (WCAG), no secrets. |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Role-nav leak (allocator sees admin links) | Information Disclosure (cosmetic) | Mirror Sidebar's role OR-logic exactly (`showsAllocatorWorkspace`/`showsManagerWorkspace`); unit-test every role branch. Server routes remain middleware/RLS-gated regardless of nav rendering. |
| Playwright trace embeds `NEXT_PUBLIC_*` (seeded run) | Information Disclosure | Already mitigated — the seed-gated path skips report upload (`ci.yml:1288-1304` per Phase 44 RESEARCH); the new spec runs in that same gated step. |

## Sources

### Primary (HIGH confidence)
- `src/components/layout/Sidebar.tsx:19-114` — `buildNavSections` exact signature, return shape, role OR-logic (`:34-36`), icon components (`:255-324`), `/allocations` PortfolioIcon (`:64, 290`)
- `src/components/layout/MobileNav.tsx:7-38` — the hardcoded 3-item `TABS` stub to replace; active-match (`:20`); `cn()` import (`:5`)
- `src/components/layout/MobileSidebarDrawer.tsx:82-191` — existing Escape/scroll-lock/Tab-trap (`:92-132`)/focus-in-on-open (`:139-142`)/restore (`:85-86`); `#mobile-sidebar-drawer` `role="dialog"` (`:155-158`)
- `src/components/layout/DashboardChrome.tsx:55, 64-135` — `menuOpen` state (`:55`); `<main>` landmarks (`:67` full-bleed, `:108` standard, already `aria-label`); MobileNav rendered prop-less (`:79, 121`); drawer threading (`:80-89, 125-133`); the `flex h-full` wrapper that must NOT be inert (`:66, 95`)
- `src/components/layout/MobileTopBar.tsx:24-31` — hamburger already `min-h-[44px] min-w-[44px]`, `aria-controls="mobile-sidebar-drawer"`, `aria-label` toggles "Open menu"/"Close menu"
- `src/app/(dashboard)/allocations/AllocationsTabs.tsx:255-262, 543-657` — `VISIBLE_TAB_KEYS`; the JOURNEY-03 tablist (`:565-608`) with role=tab siblings + Export/+Allocation siblings (`:609-655`); the flex-wrap row (`:543-545`); CSR-bailout Suspense note (`:236-238`); `?tab=risk` (`:218, 296-298`)
- `src/app/factsheet/[id]/v2/FactsheetView.tsx:749-775` — live `overflow-x-auto` section-nav precedent + `pointer-coarse:min-h-[44px]` (`:763`)
- `src/app/strategy/[id]/v2/page.tsx:22-61` — the factsheet skip-link to generalize (`.strategy-v2-skip-link`, `#panel-*` targets)
- `src/app/globals.css:382-407` — `.strategy-v2-skip-link` / `:focus` CSS to generalize
- `node_modules/@types/react/index.d.ts:2852-2854` — `inert?: boolean` native React prop (MDN-linked)
- `node_modules/react-dom/package.json` — `"version": "19.2.4"`
- `e2e/composer-axe.spec.ts:47-119` — LIVE seeded-authed pattern (HAS_SEED_ENV `:54`, loginViaForm `:58`, seedTestAllocator `:94`, visible-anchor fail-loud `:104`)
- `e2e/helpers/seed-test-project.ts:65-159` — `seedTestAllocator()` (`:75`) returns `{userId,email,password}`, stamps verified + attestation
- `e2e/helpers/reflow.ts:47, 119` — `assertNoReflow` / `assertTargetSizes` exports (Phase 44)
- `e2e/reflow.spec.ts`, `e2e/target-size.spec.ts` — Phase 44 specs (the reuse template)
- `e2e/strategy-v2-keyboard.spec.ts:55-60` — DEAD `test.skip(true)` (do NOT mirror)
- `.github/workflows/ci.yml:1059` (UNSEEDED list — NOT for this spec), `:1252-1262` (SEEDED MA-8 list — ADD here), `:1250-1251` ("update both" instruction)
- `.planning/ROADMAP.md:167-186` (Phase 45 goal + 4 SC), `:117-160` (cross-cutting gates incl. FLOW-01 + coverage ratchet)
- `.planning/REQUIREMENTS.md:13-15` (NAV-01/02/03 text)
- `.planning/phases/44-foundation-primitives-verification-gates/44-RESEARCH.md` — Phase 44 primitives, helper exports, FLOW-01 sites, ratchet thresholds
- `.planning/config.json:19` — `nyquist_validation: true`
- Verified: NO `src/app/(dashboard)/bridge` route exists (`ls src/app/(dashboard)` → admin, allocations, compare, decks, discovery, portfolios, preferences, profile, recommendations, referral, scenarios, strategies)

### Secondary (MEDIUM confidence)
- `src/app/(dashboard)/allocations/components/BridgeWidget.tsx:1-40` — Bridge is a portfolio-level widget opening BridgeDrawer; "Bridge" as a nav destination = the Risk-tab widget surface (informs Open Q1)

### Tertiary (LOW confidence)
- None — every claim anchored on read-of-source in this repo or local type defs.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new deps; React 19.2.4 + `inert?: boolean` verified in type defs
- Architecture (nav derivation, inert, skip-link, tab strip): HIGH — exact source recipes + line numbers; the one MEDIUM is the Bridge/Risk-not-routes derivation gap (Open Q1)
- Verification (FLOW-01 wiring, seeded auth pattern): HIGH — both ci.yml sites + the live composer-axe pattern read and quoted
- Pitfalls: HIGH — each has an in-repo precedent (inert-scoping, JOURNEY-03, FLOW-01, ratchet, usePathname query-strip)

**Research date:** 2026-06-27
**Valid until:** 2026-07-27 (stable — internal codebase patterns; React 19 `inert` + Next 16 App Router stable)
