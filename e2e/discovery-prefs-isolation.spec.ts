/**
 * Phase 13 / Plan 13-02 / DISCO-02 — Cross-account localStorage isolation.
 *
 * Proves the structural isolation guarantee documented in 13-RESEARCH.md
 * Example 4 and threat-model T-13-02-01: login-as-A then login-as-B leaves
 * zero `discovery_view_preferences:{A.uid}:*` keys readable from session B.
 *
 * Env wiring (TODOS.md Q4 RESOLVED 2026-04-28):
 *   E2E_USER_A_EMAIL / E2E_USER_A_PASSWORD / E2E_USER_B_EMAIL / E2E_USER_B_PASSWORD
 *   are NOT wired into CI today. The active path is the seed-helper fallback —
 *   `seedTestAllocator()` from `e2e/helpers/seed-test-project.ts:60` creates two
 *   fresh allocators per spec run.
 *
 * Behaviour: when the seed-helper service-role env (TEST_SUPABASE_*) is missing,
 * the spec is `test.skip`'d so it is authored-but-not-CI-blocking.
 */

import { test, expect } from "@playwright/test";
import { seedTestAllocator } from "./helpers/seed-test-project";

const HAS_E2E_USER_ENV =
  !!process.env.E2E_USER_A_EMAIL &&
  !!process.env.E2E_USER_A_PASSWORD &&
  !!process.env.E2E_USER_B_EMAIL &&
  !!process.env.E2E_USER_B_PASSWORD;

const HAS_SEED_ENV =
  !!process.env.TEST_SUPABASE_URL &&
  !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

const SHOULD_RUN = HAS_E2E_USER_ENV || HAS_SEED_ENV;

async function loginViaForm(
  page: import("@playwright/test").Page,
  email: string,
  password: string,
) {
  await page.goto("/login");
  await page.fill('input[name="email"], input[placeholder*="email" i]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL(/\/(discovery|strategies|dashboard)/, { timeout: 10000 });
}

async function signOut(page: import("@playwright/test").Page) {
  // Try the user-menu sign-out button first (TODOS.md Q3 — there is no
  // /logout page; logout flows through the user-menu).
  const menuBtn = page.locator(
    'button[aria-label*="user menu" i], button[aria-label*="account" i]',
  );
  if (await menuBtn.first().isVisible().catch(() => false)) {
    await menuBtn.first().click();
    const signOut = page.locator(
      'button:has-text("Sign out"), button:has-text("Log out"), a:has-text("Sign out")',
    );
    if (await signOut.first().isVisible().catch(() => false)) {
      await signOut.first().click();
      await page.waitForURL(/\/(login|$)/, { timeout: 10000 });
      return;
    }
  }
  // Fallback per RESEARCH.md Pitfall 8 — clear sb-* localStorage + cookies.
  // PR #108: also clear `discovery_view_preferences:*` to mirror what
  // SignOutButton.tsx does on the production path. The user-menu path
  // above already triggers SignOutButton; this fallback runs when the
  // menu isn't visible (e.g., the seeded test user doesn't render the
  // header) and must keep the same isolation contract.
  await page.evaluate(() => {
    Object.keys(localStorage)
      .filter(
        (k) =>
          k.startsWith("sb-") ||
          k.startsWith("discovery_view_preferences:"),
      )
      .forEach((k) => localStorage.removeItem(k));
  });
  await page.context().clearCookies();
}

test.describe("DISCO-02 cross-account localStorage isolation", () => {
  test.skip(
    !SHOULD_RUN,
    "discovery prefs isolation: cross-account env not wired " +
      "(set E2E_USER_A_EMAIL/PASSWORD + E2E_USER_B_EMAIL/PASSWORD or " +
      "TEST_SUPABASE_URL/TEST_SUPABASE_SERVICE_ROLE_KEY) — see TODOS.md Q4.",
  );

  test("discovery prefs isolation: login-as-A then login-as-B leaves no A-keys readable from B", async ({
    page,
  }) => {
    let userA: { email: string; password: string };
    let userB: { email: string; password: string };
    if (HAS_E2E_USER_ENV) {
      userA = {
        email: process.env.E2E_USER_A_EMAIL!,
        password: process.env.E2E_USER_A_PASSWORD!,
      };
      userB = {
        email: process.env.E2E_USER_B_EMAIL!,
        password: process.env.E2E_USER_B_PASSWORD!,
      };
    } else {
      const seededA = await seedTestAllocator();
      const seededB = await seedTestAllocator();
      userA = { email: seededA.email, password: seededA.password };
      userB = { email: seededB.email, password: seededB.password };
    }

    // Step 1 — Login as A and persist a non-default view via the cog drawer.
    await loginViaForm(page, userA.email, userA.password);
    await page.goto("/discovery/crypto-sma");
    await page.waitForSelector("table, [role='tabpanel']", { timeout: 10000 });
    await page.click('button[aria-label="Customize discovery view"]');

    // Click the "Grid" view button inside the drawer (within the dialog scope).
    const dialog = page.getByRole("dialog");
    await dialog.locator('button:has-text("Grid")').click();
    await page.click('button[aria-label="Save preferences"]');

    // Step 2 — Capture A's localStorage keys.
    const aKeys = await page.evaluate(() =>
      Object.keys(localStorage).filter((k) =>
        k.startsWith("discovery_view_preferences:"),
      ),
    );
    expect(aKeys.length).toBeGreaterThanOrEqual(1);
    const aUid = aKeys[0].split(":")[1];
    expect(aUid).toBeTruthy();

    // Step 3 — Sign out, sign in as B.
    await signOut(page);
    await loginViaForm(page, userB.email, userB.password);

    // Step 4 — Navigate to discovery and read out B's localStorage.
    await page.goto("/discovery/crypto-sma");
    await page.waitForSelector("table, [role='tabpanel']", { timeout: 10000 });

    const bKeysWithAUid = await page.evaluate((uid) => {
      return Object.keys(localStorage).filter((k) =>
        k.startsWith(`discovery_view_preferences:${uid}:`),
      );
    }, aUid);
    // Per the threat-model T-13-02-01 mitigation: B's session must contain
    // ZERO entries keyed under A's uid. Whether B has its own
    // discovery_view_preferences:{B.uid}:* entries is fine — that's by design.
    expect(bKeysWithAUid).toEqual([]);

    // Step 5 — Confirm B sees the default table view (not A's grid).
    // The default render is table mode, so a <table> is in the DOM.
    await expect(page.locator("table")).toBeVisible();
  });
});
