---
phase: 110-contrib-private-by-default-contribution
plan: 05
subsystem: layout-nav-composer
tags: [nav-action, contribution-overlay, browse-cta, role-scoped, client-action]
status: complete
requires:
  - "ContributionWizardOverlay { isOpen, onClose, onSuccess } — plan 110-03"
  - "owner-inclusive Browse (withPublishedOrOwner) so a fresh private row appears on refetch — plan 110-02"
  - "contribution finalize terminates status='private' — plan 110-04"
provides:
  - "An allocator (role allocator or both) sees an 'Add a Strategy' client-action nav entry in the allocator workspace block that opens the contribution overlay — NO href, NO navigation, on desktop + mobile drawer + mobile bottom bar"
  - "A manager-only or admin-without-allocator account never sees the entry (all three surfaces)"
  - "DashboardChrome hosts the ContributionWizardOverlay once (both layout branches); onSuccess closes + router.refresh()"
  - "The Browse drawer surfaces a 'Can't find it? Add your own' CTA (when onAddOwn is wired) that opens the same overlay; onSuccess reopens Browse so the refetched private row is selectable"
affects:
  - "ScenarioComposer — the Browse drawer's dead-end becomes a contribution entry (empty-state + main composer mounts)"
  - "the nav system — NavItem is now a discriminated union (link | client-action)"
tech-stack:
  added: []
  patterns:
    - "NavItem discriminated union: NavLinkItem { href } | NavActionItem { action } — href items untouched, action items dispatch onNavAction and render <button>"
    - "chrome-level overlay host: DashboardChrome owns contributeOpen and mounts the trigger-agnostic ContributionWizardOverlay so both nav + Browse CTA reuse one overlay"
    - "onAddOwn → close Browse + open overlay; overlay onSuccess → close overlay + reopen Browse (once-per-open refetch surfaces the new private row)"
key-files:
  created: []
  modified:
    - src/components/layout/Sidebar.tsx
    - src/components/layout/MobileNav.tsx
    - src/components/layout/MobileSidebarDrawer.tsx
    - src/components/layout/DashboardChrome.tsx
    - src/components/layout/Sidebar.test.tsx
    - src/components/layout/MobileNav.test.tsx
    - src/components/layout/DashboardChrome.test.tsx
    - src/app/(dashboard)/allocations/components/StrategyBrowseDrawer.tsx
    - src/app/(dashboard)/allocations/components/StrategyBrowseDrawer.test.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
decisions:
  - "The 'Add a Strategy' entry is a CLIENT ACTION (NavActionItem, no href) per the locked CONTEXT decision — NavItem became a discriminated union so href items are byte-untouched while the action item dispatches onNavAction and renders a <button>"
  - "On the mobile bottom bar the action is the LEADING discretionary filler (ahead of Discovery) so a pure allocator's single filler slot surfaces it; the SC#1 primary trio still leads. For a crowded role='both' account the <=5 cap trims it from the bottom bar — it stays reachable via the hamburger drawer (buildNavSections). Discovery overflows to the drawer for pure allocators."
  - "DashboardChrome hosts the overlay in BOTH layout branches (standard + full-bleed); onSuccess router.refresh() so server-rendered surfaces reflect the new private strategy"
  - "The Browse CTA is a restrained text button under a hairline (DESIGN.md — never a second accent-fill competing with the row Add buttons), rendered beneath all result/empty/error states so it reads as the escape hatch"
  - "ScenarioComposer wires onAddOwn + the overlay at BOTH StrategyBrowseDrawer mounts (empty-state early return + main composer) — they share browseOpen/contributeOpen, so the chain works from either entry"
requirements: [CONTRIB-01, CONTRIB-05]
metrics:
  tasks_completed: 2
  tasks_total: 2
  files_created: 0
  files_modified: 11
  commits: 4
  duration_min: 22
  completed: 2026-07-16
---

# Phase 110 Plan 05: Allocator "Add a Strategy" nav action + Browse "Add your own" CTA Summary

**Wired the two user-facing launch surfaces for the private-by-default contribution overlay: the allocator-scoped "Add a Strategy" client-action nav entry (CONTRIB-01) — present on desktop, the mobile drawer, and the mobile bottom bar, but never for a manager/admin-without-allocator — hosted once at the DashboardChrome level; and the Browse drawer's "Can't find it? Add your own" CTA (CONTRIB-05) that opens the same overlay and, on a successful contribution, reopens Browse so the freshly-contributed private row (owner-visible via 110-02) is selectable.** Zero navigation in any trigger path — the wizard route lives under the Phase-109 manager-guarded `/strategies` subtree, so both entry points are client actions, never hrefs.

## Status: COMPLETE (all 2 tasks)

| Task | Name | Status | Test commit | Feat commit |
| ---- | ---- | ------ | ----------- | ----------- |
| 1 | Allocator "Add a Strategy" nav action + DashboardChrome overlay host | done | `c6456b21` | `4b3f9831` |
| 2 | Browse "Add your own" CTA + ScenarioComposer wiring | done | `691a5fee` | `f9c0999f` |

## What was built

### Task 1 — nav action + chrome overlay host

- **`NavItem` is now a discriminated union** (`Sidebar.tsx`): `NavLinkItem { href; action?: never }` (every pre-110 item, byte-untouched) `| NavActionItem { action: NavAction; href?: never }`. `NavAction` is a string-literal union (`"add-strategy"`) so a new action is a compile-time addition. Render key changed to `item.href ?? item.action`.
- **`buildNavSections`** pushes `{ label: "Add a Strategy", icon: PlusIcon, action: "add-strategy" }` INSIDE the `showsAllocatorWorkspace` branch (after the existing allocator items) — never in the manager branch (T-110-16 role-leak).
- **`buildPrimaryMobileNav`** pushes the same action as the LEADING discretionary filler (ahead of Discovery), so a pure allocator's single filler slot under the ≤5 cap surfaces it while the SC#1 trio still leads. For role='both' the cap trims it from the bottom bar (reachable via the drawer, which renders `buildNavSections`).
- **Render**: `NavItemLink` (Sidebar) and `MobileNav` branch on `item.action` → render a `<button type="button" onClick={() => onNavAction?.(item.action)}>` styled to match sibling nav items (Sidebar: same hover/focus-ring; MobileNav: same 44px WCAG floor + accent focus outline). href items render `<Link>` unchanged. A `PlusIcon` was added in the file's inline-SVG house style.
- **Threading**: a new optional `onNavAction?: (action: NavAction) => void` prop flows DashboardChrome → Sidebar, MobileNav, and MobileSidebarDrawer (→ its inner Sidebar).
- **`DashboardChrome`**: added `useRouter`, `const [contributeOpen, setContributeOpen] = useState(false)`, an `openContribute` handler passed to all three nav surfaces, and a single `<ContributionWizardOverlay isOpen={contributeOpen} onClose={…} onSuccess={() => { setContributeOpen(false); router.refresh(); }} />` mounted in BOTH the standard and full-bleed layout branches (the overlay imports from `@/app/(dashboard)/allocations/components/…` — precedent: the existing `AllocationContext` app-import at chrome level).
- **Tests**: Sidebar (button-not-link, fires `onNavAction('add-strategy')`, absent for manager-only + bare-admin, present for role='both', href items unbroken); MobileNav/`buildPrimaryMobileNav` (href-less action filler surfaces for a pure allocator with trio leading, absent for manager/admin, action cell renders a `<button>` firing `onNavAction`); DashboardChrome (overlay closed by default, opened by the desktop nav action, closed on wizard onClose, closed + `router.refresh()` on wizard onSuccess). The existing MobileNav "every item carries a string href" invariant was updated to the union shape (link → string href; action → string `action`, no href).

### Task 2 — Browse CTA + composer wiring

- **`StrategyBrowseDrawer`** gained an optional `onAddOwn?: () => void`. When provided, the drawer renders a "Can't find it? Add your own" `<button type="button">` beneath the results/empty/no-results/error block (all live in the same container), separated by a hairline — a restrained text button (DESIGN.md), never a competing accent-fill. Absent prop → no CTA (optional-prop safety).
- **`ScenarioComposer`** added `const [contributeOpen, setContributeOpen] = useState(false)` as a sibling to `browseOpen`, imported `ContributionWizardOverlay`, and at BOTH `StrategyBrowseDrawer` mounts (the zero-portfolio empty-state early return AND the main composer body) passed `onAddOwn={() => { setBrowseOpen(false); setContributeOpen(true); }}` and mounted `<ContributionWizardOverlay isOpen={contributeOpen} onClose={…} onSuccess={() => { setContributeOpen(false); setBrowseOpen(true); }} />`. Surgical: one state hook + one prop + one overlay mount per branch, no refactor of the god file.
- **The onSuccess → reopen-Browse chain is the CONTRIB-05 payoff**: Browse refetches on open (once-per-open contract), so the just-contributed private row — now owner-visible via `withPublishedOrOwner` (110-02) — is immediately selectable.
- **Tests**: StrategyBrowseDrawer (CTA present with `onAddOwn` and fires once; absent without; present in the no-strategies empty state); ScenarioComposer (`T_C_CONTRIB`: from the empty-state, open Browse → `onAddOwn` closes Browse + opens the overlay → overlay `onSuccess` closes the overlay + reopens Browse, all via captured mock props).

## Deviations from Plan

### Documented adjustments (no Rule 1–4 auto-fixes required)

**1. [Design tension resolution] Mobile bottom-bar cap ordering**
- The plan said add the action "as a discretionary FILLER so the SC#1 trio keeps priority under the ≤5 cap." Because a pure allocator has exactly one filler slot (primary trio = 3, budget = 4), a filler placed AFTER Discovery would be trimmed and never appear in the mobile builder output — violating the acceptance "appears in the output of BOTH builders when isAllocator." Resolution: the action is the LEADING filler (ahead of Discovery), so it survives the slot for a pure allocator; Discovery overflows to the hamburger drawer (still in `buildNavSections`). For role='both' (4 primaries) the action is legitimately trimmed from the bottom bar and remains reachable via the drawer. The existing `MobileNav.test.tsx` role='both' exact-set assertion is unchanged (the action was already destined to trim there); only the pure-allocator "every item has a string href" loop was updated to the union shape.

**2. [Test-model update, not a behavior change] MobileNav href-invariant**
- Adding an href-less action item to `buildPrimaryMobileNav` output made the pre-existing loop assertion `expect(typeof item.href).toBe("string")` for every item stale. Updated it to branch on the union: link items carry a string `href`; the action item carries a string `action` and no href. This is a legitimate evolution of the NavItem contract, not a workaround.

## Threat model coverage

- **T-110-16** (Info Disclosure — "Add a Strategy" leaking outside the allocator block): the entry lives ONLY inside `showsAllocatorWorkspace` in both builders. Pinned by manager-only + bare-admin absence tests on the desktop render (Sidebar) and both builder outputs (MobileNav). Covered.
- **T-110-17** (UX-loss — trigger navigating to a 109-guarded route): the action item has no href by construction (NavActionItem forbids `href`); render sites emit `<button>`, never `<Link>`. Grep gate: `grep -c href` on "Add a Strategy" in Sidebar.tsx = 0; no `/strategies` route string introduced by the diff. Covered.
- **T-110-18** (Spoofing — client opening the overlay without the allocator role): accepted per plan — the overlay is cosmetic; RLS + finalize routes (plans 01/02/04) are the real boundary.

## Threat Flags

None — this plan adds no network endpoint, auth path, or trust-boundary schema change. Both launch surfaces are client-side affordances that toggle an existing overlay's `isOpen`; the finalize/RLS boundary is untouched.

## Verification

- `npx vitest run src/components/layout --no-file-parallelism` → **95 passed** (6 files).
- `npx vitest run StrategyBrowseDrawer.test.tsx ScenarioComposer.test.tsx --no-file-parallelism` → **195 passed** (2 files).
- Grep gates: `grep "Add a Strategy" Sidebar.tsx | grep -c href` → **0**; `grep -c onAddOwn ScenarioComposer.tsx` → **3** (≥1); no `/strategies` navigation introduced in the diff.
- `npx tsc --noEmit` → **clean**.
- `npm run lint` → **0 errors** (1 pre-existing `EquityChart.tsx` exhaustive-deps warning, unrelated/out of scope); admin-route + route-contract manifests OK.

## Self-Check: PASSED

- `.planning/phases/110-contrib-private-by-default-contribution/110-05-SUMMARY.md` — FOUND
- Commit `c6456b21` (Task 1 test) — FOUND
- Commit `4b3f9831` (Task 1 feat) — FOUND
- Commit `691a5fee` (Task 2 test) — FOUND
- Commit `f9c0999f` (Task 2 feat) — FOUND
- Branch `gsd/v1.11-scenario-composer-v2` — unchanged
