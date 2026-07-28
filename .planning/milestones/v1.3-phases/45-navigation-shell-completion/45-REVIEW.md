---
phase: 45-navigation-shell-completion
reviewed: 2026-06-27T00:00:00Z
depth: deep
files_reviewed: 8
files_reviewed_list:
  - src/components/layout/Sidebar.tsx
  - src/components/layout/MobileNav.tsx
  - src/components/layout/MobileNav.test.tsx
  - src/components/layout/DashboardChrome.tsx
  - src/components/layout/DashboardChrome.test.tsx
  - src/app/globals.css
  - src/app/(dashboard)/allocations/AllocationsTabs.tsx
  - e2e/mobile-drawer-keyboard.spec.ts
  - .github/workflows/ci.yml
findings:
  critical: 1
  warning: 3
  info: 2
  total: 6
status: issues_found
---

# Phase 45: Code Review Report

**Reviewed:** 2026-06-27
**Depth:** deep
**Files Reviewed:** 9
**Status:** issues_found

## Summary

Phase 45 delivers a well-structured mobile navigation shell: `buildPrimaryMobileNav` is correctly DRY-sourced from `Sidebar.tsx`, mirrors the `showsAllocatorWorkspace = isAllocator || isAdmin` OR-logic faithfully, and the manager role-leak from the old stub is properly closed. The tab strip NAV-02 preserves JOURNEY-03 by applying `overflow-x-auto flex-nowrap` directly to the `role="tablist"` element (no new aria-parent over the tabs; Export/+Allocation remain siblings). The skip-link CSS is a clean copy of `.strategy-v2-skip-link`. The FLOW-01 dual-wiring is correct — `HAS_SEED_ENV` const + `test.skip` in the spec AND `e2e/mobile-drawer-keyboard.spec.ts` in the ci.yml MA-8 list; env var names (`TEST_SUPABASE_URL` / `TEST_SUPABASE_SERVICE_ROLE_KEY`) match what CI injects at lines 1273/1275.

One critical structural bug survived the executor's testing: in **both** `DashboardChrome` layout branches the `<MobileTopBar>` (which holds the hamburger button) is nested **inside** `<main inert={menuOpen}>`. When the drawer opens, the hamburger becomes non-interactive — pointer events are disabled by the `inert` attribute — so users cannot click the hamburger to close the drawer. The Escape key and the backdrop "Close menu" button remain functional, but the primary visible close affordance (the hamburger toggling to an X icon) is dead. The e2e spec does not catch this because it closes the drawer exclusively via `Escape` (section e), never exercising hamburger-click-to-close while the drawer is open.

The remaining findings are warnings and informational items that do not block correctness but reduce robustness or leave coverage gaps.

---

## Critical Issues

### CR-01: `MobileTopBar` (hamburger) is inside `<main inert={menuOpen}>` — drawer open renders hamburger non-interactive

**File:** `src/components/layout/DashboardChrome.tsx:83` (full-bleed branch), `src/components/layout/DashboardChrome.tsx:143` (standard branch)

**Issue:** In both layout branches, `<MobileTopBar>` — which contains the hamburger button — is rendered as a child of `<main inert={menuOpen}>`. When `menuOpen` is `true` (drawer open), the `inert` attribute propagates to all descendants, making the hamburger button non-focusable and non-clickable (pointer events blocked by the browser). The user cannot click the hamburger to close the drawer; only `Escape` and the backdrop `<button aria-label="Close menu">` inside `MobileSidebarDrawer` remain as close mechanisms.

The factsheet comment on both `<main>` elements says "Scoped to `<main>` (the drawer's SIBLING)" — this is true of `MobileSidebarDrawer`, but `MobileTopBar` is **not** a sibling; it is a child of `<main>` in both branches. The `inert` attribute was intended to block the page content behind the backdrop; it inadvertently also blocks the top bar chrome.

The e2e spec (`e2e/mobile-drawer-keyboard.spec.ts:121, 191`) opens the drawer via `hamburger.click()` (before `inert` is set) and closes via `page.keyboard.press("Escape")` — it never tests `hamburger.click()` while the drawer is open, so this regression is not caught by the new test.

**Fix:** Extract `MobileTopBar` out of `<main>` so it is a sibling of `<main>`, the drawer, and `MobileNav` — matching the documented intent. Apply the same structure in both branches:

```tsx
// DashboardChrome.tsx — standard branch (same change needed for full-bleed at ~line 66-111)
return (
  <div className="flex h-full flex-col">  {/* or keep `flex h-full` with MobileTopBar before main */}
    <a href="#main-content" className="app-skip-link">
      Skip to main content
    </a>
    {/* MobileTopBar is now a SIBLING of <main>, not a child */}
    <MobileTopBar
      ref={hamburgerRef}
      onMenuClick={() => setMenuOpen(true)}
      menuOpen={menuOpen}
    />
    <div className="hidden md:block">
      <Sidebar ... />
    </div>
    <main
      id="main-content"
      tabIndex={-1}
      inert={menuOpen}
      aria-label="Dashboard content"
      className="flex-1 md:ml-[260px] overflow-y-auto pb-16 md:pb-0"
    >
      {/* page content only — no MobileTopBar here */}
      <div className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">
        {children}
        <Disclaimer variant="footer" />
      </div>
      <LegalFooter />
    </main>
    <MobileNav ... />
    <MobileSidebarDrawer ... />
  </div>
);
```

Also add an e2e assertion to prove the hamburger is clickable while the drawer is open:

```typescript
// After drawer opens (section b), before Escape:
await hamburger.click();  // Should close the drawer
await expect(drawer).toBeHidden({ timeout: 5_000 });
// Re-open for the rest of the test
await hamburger.click();
await expect(drawer).toBeVisible({ timeout: 5_000 });
```

**Note on full-bleed branch:** The full-bleed branch (`isFullBleed` path, lines 64–111) has the identical structure — `MobileTopBar` is at `DashboardChrome.tsx:83` inside `<main inert={menuOpen} ...>` at line 77. The fix must be applied to both branches.

---

## Warnings

### WR-01: Skip-link → `#main-content` focus target is itself inert when the drawer is open

**File:** `src/components/layout/DashboardChrome.tsx:69,118`

**Issue:** The app-shell skip-link targets `<main id="main-content" tabIndex={-1}>`. When the drawer is open, `<main>` carries the `inert` attribute. Per the HTML spec, calling `focus()` on an inert element (or navigating to it via an anchor jump) is a browser no-op — the focus transfer silently fails. A keyboard user who focuses the skip-link and presses Enter while the drawer is open receives no feedback and focus does not move to the main content landmark.

This is a secondary consequence of CR-01: once `MobileTopBar` is moved outside `<main>`, the skip-link-while-drawer-open scenario becomes an academic edge case (users would not be navigating with the skip-link while a drawer is open). However if the drawer-open state is addressed separately from the skip-link target, this remains a WCAG 2.4.3 (Focus Order) risk worth documenting.

**Fix:** If the drawer is open when the skip-link is activated, close the drawer first. Alternatively, after applying the CR-01 fix (MobileTopBar outside `<main>`), add a note in a code comment at both skip-link usages: "Note: this anchor has no effect while menuOpen=true (main is inert); the drawer's Escape/backdrop close mechanism takes precedence."

No code change is strictly required if CR-01 is fixed, but the e2e spec should add a negative assertion: "pressing Enter on skip-link while drawer is closed moves focus to #main-content."

---

### WR-02: Admin role's `/portfolios` is silently dropped by the ≤5 cap — no test asserts its absence or the cap boundary for admin

**File:** `src/components/layout/MobileNav.test.tsx:80-92`

**Issue:** For `isAdmin: true`, `buildPrimaryMobileNav` produces `[/allocations, /allocations?tab=risk, /allocations?tab=risk#bridge, /strategies, /profile]` — `/portfolios` is truncated by the 4-item budget (`CAP - 1 = 4`). The admin unit test at line 87 checks that `/strategies` is present but does not verify whether `/portfolios` is present or absent. This means:

1. A future refactor that reorders the `primary` array (e.g., moving Portfolios before Strategies) would silently shift which item gets dropped — no test catches the change.
2. The current behaviour (admin sees Strategies but not Portfolios in their bottom nav) is not documented by any test assertion.

The test at `MobileNav.test.tsx:94-102` for role "both" (`isAllocator && isManager`) has the same gap — `/portfolios` is also dropped there, but no assertion covers it.

**Fix:** Add explicit assertions to the admin and "both" tests:

```typescript
it("admin: includes BOTH allocator and manager families plus Profile, <=5", () => {
  const items = buildPrimaryMobileNav({ isAdmin: true });
  const hrefs = items.map((i) => i.href);
  expect(items.length).toBeLessThanOrEqual(5);
  expect(hrefs).toContain("/allocations");
  expect(hrefs).toContain("/strategies");
  expect(hrefs).toContain("/profile");
  // /portfolios is trimmed by the <=5 cap (budget=4; allocator trio + Strategies fills it).
  // Pin this explicitly so a reorder doesn't silently change which item is dropped.
  expect(hrefs).not.toContain("/portfolios");
  expect(new Set(hrefs).size).toBe(hrefs.length);
});
```

---

### WR-03: `waitForLoadState("networkidle")` on `/allocations` — matches a route with a 30s background poll

**File:** `e2e/mobile-drawer-keyboard.spec.ts:89`

**Issue:** `/allocations` runs a `setInterval` at 30 000ms (`PERFORMANCE_POLL_INTERVAL_MS`) that calls `router.refresh()` while the Overview tab is active and the document is visible. `waitForLoadState("networkidle")` requires 500ms of no network activity. On slower CI runners, if the initial page load triggers SSR revalidation requests that take >500ms each in quick succession, `networkidle` may not settle for several seconds. This pattern is already used in `composer-axe.spec.ts:98` on the same route, so it is unlikely to be newly flaky here. However it is worth noting as a known fragility inherited from that established pattern, not introduced by this phase.

**Fix:** No change required in this phase. The pattern is consistent with the established `composer-axe` baseline. If this spec flakes in CI, replace with `page.waitForSelector('[aria-label="Open menu"]', { state: 'visible' })` as a more specific readiness signal:

```typescript
// Replace:
await page.waitForLoadState("networkidle");
// With:
await page.getByRole("button", { name: "Open menu" }).waitFor({ state: "visible", timeout: 10_000 });
```

---

## Info

### IN-01: `BridgeIcon` is private (unexported) but `buildPrimaryMobileNav` references it — future move to a separate file would require re-exporting

**File:** `src/components/layout/Sidebar.tsx:401-414`

**Issue:** `BridgeIcon` is declared as a module-private `function` (no `export`), used only in `buildPrimaryMobileNav` in the same file. This is correct for Option A (co-location). However the `NavItem` type exposes `icon: IconComponent` as part of the public API exported from this file. If `buildPrimaryMobileNav` is ever moved to a separate `nav-config.ts` (the RESEARCH Option B), `BridgeIcon` would need to move or be exported. Not a current defect, but worth noting for the eventual god-file split.

**Fix:** No action required now. If splitting to `nav-config.ts` later, export `BridgeIcon` from `Sidebar.tsx` or move it to the shared config file.

---

### IN-02: Active-state for Risk/Bridge bottom-nav items is always inactive — `aria-current="page"` never fires on those cells on `/allocations?tab=risk`

**File:** `src/components/layout/MobileNav.tsx:48`

**Issue:** The active-state rule `pathname === item.href || pathname.startsWith(item.href + "/")` uses `usePathname()` which strips the query string. On `/allocations?tab=risk`, `pathname` is `"/allocations"`. The Risk item's `href` is `"/allocations?tab=risk"` — the test `pathname === "/allocations?tab=risk"` is false, and `pathname.startsWith("/allocations?tab=risk/")` is also false. So the Risk and Bridge items never receive `text-accent` or `aria-current="page"` regardless of which tab is active.

Only "My Allocation" gets the active highlight on all `/allocations*` pathnames. This is the documented discretion (45-RESEARCH Pitfall 6 / A3), correctly noted in the `MobileNav.tsx` header comment, and the trade-off (avoiding `useSearchParams()` CSR-bailout) is justified. It is flagged here for completeness so the product team can re-evaluate if user testing reveals confusion.

**Fix:** Acceptable as-is per A3. If future product feedback demands per-tab active indication, add `useSearchParams()` and wrap `<MobileNav>` in a `<Suspense>` boundary in `DashboardChrome.tsx` to satisfy Next.js 16's CSR-bailout requirement.

---

_Reviewed: 2026-06-27_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
