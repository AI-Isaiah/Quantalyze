/**
 * Phase 45-03 / NAV-03 — SEEDED authed mobile-drawer keyboard containment +
 * app-shell skip-link + background-inert + 320px nav-shell reflow/target-size
 * proof.
 *
 * Mirrors the LIVE seeded-auth pattern of e2e/composer-axe.spec.ts
 * (seedTestAllocator + loginViaForm + HAS_SEED_ENV self-skip + fail-loud
 * visible anchors). It deliberately does NOT mirror the dead
 * `test.skip(true)` keyboard spec (a no-op in the MA-8 list).
 *
 * WHY seeded + authed: the mobile nav shell (MobileTopBar hamburger, the
 * MobileSidebarDrawer, the background `<main inert>`, the bottom MobileNav)
 * only renders inside DashboardChrome, i.e. behind the auth + universal
 * approval gate. seedTestAllocator() stamps a VERIFIED allocator profile +
 * an investor_attestations row so /allocations renders the real chrome
 * instead of redirecting to /login or /pending-approval.
 *
 * WHAT it proves (Plan 45-01 implementation half + SC#3/SC#4):
 *   (a) the app-shell skip-link (`a.app-skip-link[href="#main-content"]`,
 *       "Skip to main content") is the FIRST focusable element and Enter
 *       jumps focus to `<main id="main-content">`;
 *   (b) opening the drawer (tap hamburger "Open menu") moves focus INTO the
 *       drawer (first `#mobile-sidebar-drawer a[href]`);
 *   (c) at least one drawer link is focusable while open — catches an
 *       accidental ancestor-`inert` regression (RESEARCH Pitfall 2);
 *   (d) Tab / Shift+Tab stay CONTAINED inside `#mobile-sidebar-drawer`
 *       (Element.contains) and the background `<main id="main-content">`
 *       carries the `inert` attribute so focus can never land behind the
 *       backdrop (WCAG 2.1.2 No Keyboard Trap + 2.4.3 Focus Order);
 *   (e) Escape closes the drawer and restores focus to the hamburger;
 *   (f) at 320px the nav shell does not reflow horizontally and the bottom
 *       nav + hamburger targets measure >=44px, reusing the Phase 44
 *       assertNoReflow / assertTargetSizes helpers.
 *
 * FLOW-01 dual-wiring (the twice-burned trap): this spec is wired in BOTH
 * required places — (1) the `HAS_SEED_ENV` const + `test.skip` below, and
 * (2) the ci.yml seeded MA-8 `npx playwright test` list. "Proven to execute
 * in CI (passed, not skipped)" is the explicit post-push must_have.
 *
 * Each assertion is gated behind a fail-loud visible anchor so a 404 / login
 * / unseeded chrome fails LOUD rather than false-greening (the W-02 lesson).
 */
import { test, expect } from "@playwright/test";
import { seedTestAllocator } from "./helpers/seed-test-project";
import { assertNoReflow, assertTargetSizes } from "./helpers/reflow";

// FLOW-01 place 2 of 2 — the spec's own seed-env self-skip guard.
const HAS_SEED_ENV =
  !!process.env.TEST_SUPABASE_URL &&
  !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

async function loginViaForm(
  page: import("@playwright/test").Page,
  email: string,
  password: string,
) {
  await page.goto("/login");
  await page.fill('input[name="email"], input[placeholder*="email" i]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL(/\/(discovery|strategies|allocations|dashboard)/, {
    timeout: 10000,
  });
}

test.describe("Phase 45 — mobile drawer keyboard containment (NAV-03)", () => {
  test.skip(
    !HAS_SEED_ENV,
    "drawer-keyboard: seed-helper env vars not wired " +
      "(set TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY) — " +
      "Skipping prevents false-green on empty/404/login pages (W-02). " +
      "The live keyboard/inert proof runs in CI / /qa once seed env is present.",
  );

  test("skip-link first, drawer focus containment + inert, restore on close, 320px nav shell", async ({
    page,
  }) => {
    // /allocations is auth-gated by middleware AND the universal approval
    // gate (src/lib/approval.ts) — an un-verified profile redirects to
    // /pending-approval. seedTestAllocator() stamps a VERIFIED allocator
    // profile + an investor_attestations row, exactly the session the
    // dashboard chrome (skip-link + drawer + bottom nav) needs to render.
    const allocator = await seedTestAllocator();
    await loginViaForm(page, allocator.email, allocator.password);

    // Mobile chrome: <md so MobileTopBar / MobileNav / the drawer mount.
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/allocations");
    await page.waitForLoadState("networkidle");

    // Fail-loud anchor (W-02): the mobile hamburger is unique to the rendered
    // DashboardChrome — a 404 / login chrome would not show it, so a hollow
    // page fails here rather than false-greening through the assertions below.
    const hamburger = page.getByRole("button", { name: "Open menu" });
    await expect(hamburger).toBeVisible({ timeout: 10_000 });

    // --- (a) SKIP-LINK is the FIRST focusable element + jumps to #main-content ---
    // Start from a neutral, deterministic focus origin so the first Tab lands
    // on the document's first tab stop. The app-shell skip-link is the first
    // focusable child of DashboardChrome (z-100, before MobileTopBar/main).
    await page.evaluate(() => {
      (document.activeElement as HTMLElement | null)?.blur?.();
      document.body.focus();
    });
    await page.keyboard.press("Tab");
    const skipLink = page.locator('a.app-skip-link[href="#main-content"]');
    await expect(skipLink, "skip-link is the first focusable element").toBeFocused();
    await expect(skipLink).toHaveText("Skip to main content");

    // Activating the skip-link moves focus to the <main id="main-content">
    // landmark (tabIndex=-1 makes it a programmatic focus target).
    await page.keyboard.press("Enter");
    await expect
      .poll(
        () => page.evaluate(() => document.activeElement?.id ?? null),
        { timeout: 5_000, message: "Enter on skip-link moves focus to #main-content" },
      )
      .toBe("main-content");

    // --- (b) OPEN: focus moves INTO the drawer ---
    await hamburger.click();
    const drawer = page.locator('#mobile-sidebar-drawer[role="dialog"]');
    // Fail-loud anchor (W-02): the dialog must be visible before any focus
    // assertion, so a drawer that failed to open fails loud here.
    await expect(drawer).toBeVisible({ timeout: 5_000 });
    const firstDrawerLink = drawer.locator("a[href]").first();
    await expect(
      firstDrawerLink,
      "opening the drawer moves focus to its first link",
    ).toBeFocused();

    // --- (c) DRAWER LINKS FOCUSABLE while open (ancestor-inert regression guard) ---
    // An accidental `inert` on the drawer (or a shared ancestor) would make
    // these non-focusable. Prove at least one is both visible and focusable.
    await expect(firstDrawerLink).toBeVisible();
    await firstDrawerLink.focus();
    await expect(firstDrawerLink).toBeFocused();
    expect(
      await drawer.locator("a[href]").count(),
      "drawer exposes focusable links while open",
    ).toBeGreaterThan(0);

    // --- (d) BACKGROUND <main> carries `inert` while the drawer is open ---
    // The inert attribute is the focus barrier that keeps Tab from leaking
    // behind the backdrop (NAV-03; Plan 45-01 set inert={menuOpen} on <main>).
    expect(
      await page.evaluate(() =>
        document.getElementById("main-content")?.hasAttribute("inert") ?? false,
      ),
      "<main id=main-content> is inert while the drawer is open",
    ).toBe(true);

    // --- (d) CONTAINMENT: Tab keeps focus inside the drawer (never in #main-content) ---
    const focusInsideDrawer = () =>
      page.evaluate(() => {
        const dlg = document.getElementById("mobile-sidebar-drawer");
        const main = document.getElementById("main-content");
        const active = document.activeElement;
        return {
          inDrawer: !!dlg && !!active && dlg.contains(active),
          inMain: !!main && !!active && main.contains(active),
        };
      });

    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Tab");
      const f = await focusInsideDrawer();
      expect(
        f.inDrawer,
        `Tab #${i + 1}: focus stays inside #mobile-sidebar-drawer`,
      ).toBe(true);
      expect(
        f.inMain,
        `Tab #${i + 1}: focus never lands inside the inert #main-content`,
      ).toBe(false);
    }
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press("Shift+Tab");
      const f = await focusInsideDrawer();
      expect(
        f.inDrawer,
        `Shift+Tab #${i + 1}: focus stays inside #mobile-sidebar-drawer`,
      ).toBe(true);
      expect(
        f.inMain,
        `Shift+Tab #${i + 1}: focus never lands inside the inert #main-content`,
      ).toBe(false);
    }

    // --- (e) ESCAPE closes the drawer + restores focus to the hamburger ---
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden({ timeout: 5_000 });
    await expect(
      hamburger,
      "closing the drawer restores focus to the hamburger",
    ).toBeFocused();

    // --- (f) NAV SHELL at 320px: no reflow + >=44px targets (SC#4) ---
    // Reuse the Phase 44 helpers (e2e/helpers/reflow.ts). Both fail loud if
    // their anchor is not visible (blank/404/unhydrated guard).
    await page.setViewportSize({ width: 320, height: 800 });
    await assertNoReflow(page, "nav[aria-label='Primary mobile']");
    // Bottom-nav cells (min-h-[44px] from Plan 45-01) + the hamburger (already
    // 44px) must all measure >=44px. The interactive selector measures the
    // bottom-nav links AND the hamburger; the anchor is the always-present
    // hamburger so an empty page cannot pass with zero elements measured.
    await assertTargetSizes(
      page,
      "[aria-label='Open menu']",
      "nav[aria-label='Primary mobile'] a, [aria-label='Open menu']",
    );
  });
});
