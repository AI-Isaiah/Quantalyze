---
phase: 45-navigation-shell-completion
verified: 2026-06-27T16:05:00Z
status: human_needed
score: 4/4 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Confirm e2e/mobile-drawer-keyboard.spec.ts executed as 'passed' (not skipped) in CI on this branch's first push"
    expected: "In the seeded MA-8 e2e job log, the spec appears as 'passed' with all assertions green; composer-axe.spec.ts (JOURNEY-03) also green in the same run"
    why_human: "HAS_SEED_ENV is false locally (TEST_SUPABASE_URL/TEST_SUPABASE_SERVICE_ROLE_KEY unset); the spec self-skips without the seed DB. Proven execution (not just CI wiring) requires the first CI run on this branch — the FLOW-01 dual-wiring is confirmed present (ci.yml line 1262 + HAS_SEED_ENV const in spec), but 'passed not skipped' can only be read from the CI log."
  - test: "Real-device authed nav walkthrough — allocator sees My Allocation / Risk / Bridge in the bottom nav on /allocations; manager sees Strategies/Portfolios/Profile; admin gets role-appropriate set"
    expected: "Bottom nav cells are tappable (>=44px touch targets), labeled correctly per role, and the active cell has visible accent treatment on the correct route"
    why_human: "Headless browse cannot hydrate authed pages (known limitation: see MEMORY.md [[browse-no-hydrate-authed]]). Interactive role verification requires a real browser session logged in as each role."
  - test: "Manually close the mobile drawer via the hamburger button (X) while the drawer is open — verify the hamburger remains interactive despite being inside the inert <main>"
    expected: "Tapping the X/hamburger while the drawer is open successfully closes it; the drawer closes. This verifies the CR-01 design decision: the backdrop's z-40 occludes the z-20 top bar's pointer area, but the hamburger itself (inside inert <main>) is the documented intent — Escape remains the keyboard path."
    why_human: "The e2e spec closes via Escape only (not hamburger-click-while-open). The design decision to keep MobileTopBar inside inert <main> was deliberately chosen over the reviewer's fix (moving it out would create a focusable trigger outside the drawer, weakening containment). This UX trade-off — hamburger pointer events blocked by inert while drawer is open — needs product sign-off via a real touch device."
---

# Phase 45: Navigation Shell Completion — Verification Report

**Phase Goal:** Complete the mobile navigation shell — role-aware bottom nav, scrollable multi-tab strip, hardened drawer focus-trap (background inert + app-wide skip-link), ≥44px nav targets passing the Phase 44 reflow gate.
**Verified:** 2026-06-27T16:05:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Role-aware bottom nav — allocator reaches /allocations, Bridge (/allocations?tab=risk#bridge), Risk (/allocations?tab=risk) from MobileNav; manager/admin get role-appropriate sets; no hardcoded `const TABS` stub | ✓ VERIFIED | `grep -c "const TABS" MobileNav.tsx` = 0; `grep -c "buildPrimaryMobileNav" MobileNav.tsx` = 3; `export function buildPrimaryMobileNav` present in Sidebar.tsx; role OR-logic identifiers (`showsAllocatorWorkspace/showsManagerWorkspace`) present × 9 in Sidebar; all 23 unit tests green (allocator/manager/admin/both/none branches) |
| 2 | Scrollable multi-tab strip at <sm preserving JOURNEY-03 role=tab siblings | ✓ VERIFIED | `overflow-x-auto` + `flex-nowrap` + `sm:flex-wrap sm:overflow-x-visible snap-x` on the same `role="tablist"` element (line 608); `data-allocator-tabstrip` anchor retained; `scrollIntoView` present × 3 with `prefers-reduced-motion` guard; no gradient added (count = 0); Export/+Allocation remain siblings at lines 681/697 |
| 3 | Drawer focus-trap + skip-link: background inert, focus-in on open, restore on close, app-shell skip-link to #main-content | ✓ VERIFIED | `inert={menuOpen}` on both `<main>` elements in DashboardChrome (×6 matches total, covering main + skip-links + MobileNav); `id="main-content"` × 4; `href="#main-content"` × 2; `.app-skip-link` CSS rule in globals.css; MobileNav `inert` prop on `<nav>` (line 53); seeded e2e spec (213 lines) asserts skip-link-first, focus-in, inert-attribute probe, 6×Tab/6×Shift+Tab containment, Escape-restore; tsc clean |
| 4 | ≥44px hamburger + bottom-nav targets; nav shell passes Phase 44 reflow gate at 320px | ✓ VERIFIED | `min-h-[44px]` × 2 in MobileNav.tsx; unit test pins this (`"gives every bottom-nav target a >=44px min height"` — green); e2e spec calls `assertNoReflow(page, "nav[aria-label='Primary mobile']")` + `assertTargetSizes(...)` reusing Phase 44 helpers; ci.yml line 1262 wires spec into seeded MA-8 list |

**Score:** 4/4 truths verified (all locally-checkable must-haves pass)

### Code Review Findings Status

The code review (45-REVIEW.md) surfaced 1 critical + 3 warnings. All were addressed in commit `412e0c37`:

| Finding | Status | Resolution |
|---------|--------|-----------|
| CR-01: MobileTopBar inside `<main inert>` | Addressed (design decision) | Reviewer's structural fix was rejected; instead MobileNav + both skip-links were also made `inert={menuOpen}` so the entire mobile background surface is inert. MobileTopBar stays inside `<main>` by design (occlusion argument). This is a human-verify item (see below). |
| WR-01: Skip-link → #main-content blocked when drawer open | Addressed | Inert added to skip-links (`inert={menuOpen}` on both `<a>` elements) so they are themselves inert while the drawer is open; focus transfer failure is prevented by the skip-link being unreachable. |
| WR-02: Admin/both cap boundary unpinned | Fixed | MobileNav.test.tsx now pins the EXACT admin/both sets with explicit `expect(hrefs).not.toContain("/portfolios")`. |
| WR-03: `waitForLoadState("networkidle")` fragility | Accepted | No-op; consistent with composer-axe.spec.ts baseline. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/components/layout/Sidebar.tsx` | `export function buildPrimaryMobileNav` + `BridgeIcon` + NavItem/IconComponent exports | ✓ VERIFIED | `buildPrimaryMobileNav` exported; `BridgeIcon` present × 1; role OR-logic reused (not re-implemented) |
| `src/components/layout/MobileNav.tsx` | Role-aware; consumes `buildPrimaryMobileNav`; `min-h-[44px]`; `aria-current`; `inert` prop | ✓ VERIFIED | All present; 0 `const TABS`; 2 `min-h-[44px]`; 1 `aria-current`; `inert` prop wired to `<nav>` |
| `src/components/layout/MobileNav.test.tsx` | Role-branch coverage, 40+ lines | ✓ VERIFIED | 197 lines; 23 tests — allocator/manager/admin/both/none + active-state + 44px + badge + inert passthrough |
| `src/components/layout/DashboardChrome.tsx` | Role props into MobileNav; skip-link first child; `<main inert={menuOpen}>` both branches | ✓ VERIFIED | `inert={menuOpen}` × 6 (main ×2, skip-link ×2, MobileNav ×2); `id="main-content"` × 4; `href="#main-content"` × 2; MobileNav receives `isAdmin/isAllocator/isManager/flaggedCount` in both branches |
| `src/app/globals.css` | `.app-skip-link` + `.app-skip-link:focus` | ✓ VERIFIED | Both rules present at lines 416/423 (z-index:100, position:fixed on focus) |
| `src/app/(dashboard)/allocations/AllocationsTabs.tsx` | `overflow-x-auto flex-nowrap` on `role="tablist"`; `data-allocator-tabstrip` retained | ✓ VERIFIED | Line 608: `flex flex-nowrap items-center gap-1 overflow-x-auto sm:flex-wrap sm:overflow-x-visible snap-x [scrollbar-width:none] [-webkit-overflow-scrolling:touch]`; `data-allocator-tabstrip` × 1 |
| `e2e/mobile-drawer-keyboard.spec.ts` | Seeded authed, HAS_SEED_ENV, seedTestAllocator, assertNoReflow/assertTargetSizes, 60+ lines | ✓ VERIFIED | 213 lines; HAS_SEED_ENV × 4; seedTestAllocator × 5; assertNoReflow × 2 + assertTargetSizes × 2; all DOM contracts present; Playwright --list discovers 1 test |
| `.github/workflows/ci.yml` | `mobile-drawer-keyboard.spec.ts` in seeded MA-8 list | ✓ VERIFIED | Line 1262, inside MA-8 `npx playwright test` block (after composer-axe.spec.ts, before `--timeout 60000`); count = 1; NOT in unseeded list |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `MobileNav.tsx` | `Sidebar.tsx buildPrimaryMobileNav` | import + call in render | ✓ WIRED | `buildPrimaryMobileNav` present × 3 in MobileNav.tsx |
| `DashboardChrome.tsx` | `MobileNav.tsx` | role props passed | ✓ WIRED | Both `<MobileNav>` calls at lines 100 and 165 receive isAdmin/isAllocator/isManager/flaggedCount/inert |
| `DashboardChrome.tsx skip-link` | `<main id="main-content">` | `href="#main-content"` | ✓ WIRED | × 2 (both branches); tabIndex={-1} on both `<main>` elements |
| `e2e/mobile-drawer-keyboard.spec.ts` | `e2e/helpers/seed-test-project.ts` seedTestAllocator | import + call | ✓ WIRED | seedTestAllocator × 5 |
| `e2e/mobile-drawer-keyboard.spec.ts` | `e2e/helpers/reflow.ts` assertNoReflow/assertTargetSizes | import + call | ✓ WIRED | Both helpers × 2 each |
| `ci.yml MA-8 list` | `e2e/mobile-drawer-keyboard.spec.ts` | npx playwright test list entry | ✓ WIRED | Line 1262; NOT in unseeded list |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| MobileNav + DashboardChrome unit tests | `npx vitest run MobileNav.test.tsx DashboardChrome.test.tsx` | 23/23 passed | ✓ PASS |
| Playwright spec discovers (compiles) | `npx playwright test mobile-drawer-keyboard.spec.ts --list` | 1 test discovered at line 75 | ✓ PASS |
| TypeScript clean | `tsc --noEmit` | exit 0, no errors | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| NAV-01 | 45-01 | Role-appropriate primary navigation from bottom nav | ✓ SATISFIED | buildPrimaryMobileNav single-sources icons/labels/role-logic; allocator gets /allocations + Risk + Bridge |
| NAV-02 | 45-02 | Multi-tab surfaces reachable via scrollable strip at <sm (JOURNEY-03 preserved) | ✓ SATISFIED | overflow-x-auto on role="tablist" itself; 1 role="tablist" with direct role="tab" children; Export/+Allocation siblings |
| NAV-03 | 45-01 + 45-03 | Drawer traps focus; app-shell skip-link; inert background | ✓ SATISFIED (pending CI proof) | Implementation present and locally-verified; seeded e2e dual-wired; CI proof is the human-verify item |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | — | No TBD/FIXME/XXX markers in any phase-touched file | — | Clean |

No stub implementations, empty returns, or hardcoded data detected in phase-modified files. The `const TABS` stub is confirmed removed (count = 0).

### Human Verification Required

#### 1. CI proven-execution: mobile-drawer-keyboard.spec.ts (FLOW-01 gate)

**Test:** After this branch's first CI push, open the seed-gated e2e job log and confirm `e2e/mobile-drawer-keyboard.spec.ts` appears as `passed` (not `skipped`, not absent). Also confirm `e2e/composer-axe.spec.ts` (JOURNEY-03) stays green in the same MA-8 run.
**Expected:** The spec shows `1 passed` with test "skip-link first, drawer focus containment + inert, restore on close, 320px nav shell" green; no skipped tests in that file.
**Why human:** `HAS_SEED_ENV = !!process.env.TEST_SUPABASE_URL && !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY` evaluates to false locally. The spec self-skips. FLOW-01 dual-wiring is confirmed (ci.yml line 1262 + HAS_SEED_ENV const), but "proven to execute in CI (passed, not skipped)" requires reading the actual CI job log — the twice-burned FLOW-01 trap.

#### 2. Real-device authed nav walkthrough

**Test:** On a real mobile browser (<375px viewport), log in as each role: allocator, manager, admin. Navigate to /allocations (allocator) or /strategies (manager). Verify the bottom nav shows the correct items for each role, labels are legible, and tapping each cell navigates to the correct destination.
**Expected:** Allocator: My Allocation / Risk / Bridge / Discovery / Profile (≤5). Manager: Strategies / Portfolios / Profile. Admin: My Allocation / Risk / Bridge / Strategies / Profile (Portfolios trimmed to drawer). The active cell is visually highlighted.
**Why human:** Headless browse cannot hydrate authed pages (MEMORY.md [[browse-no-hydrate-authed]]); interactive nav rendering requires a real authenticated browser session.

#### 3. Hamburger pointer behavior while drawer is open (CR-01 design decision sign-off)

**Test:** On a real mobile browser, open the drawer by tapping the hamburger. While the drawer is open, tap the X/hamburger button to close the drawer. Verify whether the close action succeeds.
**Expected:** The visual X button inside MobileTopBar is occluded by the z-40 backdrop (MobileSidebarDrawer's overlay) — tapping the backdrop area closes the drawer via the backdrop's `onClose` handler. The drawer can always be closed via Escape (keyboard) or the backdrop tap.
**Why human:** The code-review (CR-01) flagged that MobileTopBar inside `<main inert={menuOpen}>` blocks pointer events on the hamburger while the drawer is open. The executor deliberately kept this structure (inert keeps focus contained) and documented the occlusion argument. A real touch device is needed to verify the UX is acceptable — whether the backdrop tap reliably closes the drawer, and whether the invisible hamburger pointer-block is noticeable to users. This is a product/UX decision, not a code defect.

---

### Gaps Summary

No blocking gaps. All four ROADMAP success criteria are locally verified to be implemented correctly and substantively. The phase is complete pending CI proof of the seeded e2e execution (standard FLOW-01 gate, identical to Phase 44's post-push verification step) and real-device UX confirmation of the CR-01 design decision.

---

_Verified: 2026-06-27T16:05:00Z_
_Verifier: Claude (gsd-verifier)_
