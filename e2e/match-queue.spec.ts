import { test, expect } from "@playwright/test";

// Match Queue E2E tests (Phase 4 Task 14 from the perfect-match plan).
//
// These tests follow the existing E2E pattern in this repo: hit the real dev
// server, log in as the test account, and gracefully degrade when the expected
// data isn't seeded yet. They verify UI structure, admin-gate behavior, and
// the main founder workflow (open queue → view candidates → send intro).
//
// Assumptions:
// - Dev server is running at http://localhost:3000
// - Migration 011 has been applied
// - The test account (matratzentester24@gmail.com) either IS the admin or a
//   regular allocator — the test adapts to either case.

const TEST_EMAIL = "matratzentester24@gmail.com";
const TEST_PASSWORD = "Test12";

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.fill(
    'input[name="email"], input[placeholder*="email" i]',
    TEST_EMAIL,
  );
  await page.fill('input[type="password"]', TEST_PASSWORD);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL(/\/(discovery|strategies)/, { timeout: 10000 });
}

test.describe("Match Queue — admin gate", () => {
  test("unauthenticated user is redirected from /admin/match", async ({
    page,
  }) => {
    await page.goto("/admin/match");
    // proxy should bounce to /login (admin routes are protected)
    await expect(page).toHaveURL(/\/(login|discovery)/, { timeout: 10000 });
  });

  test("unauthenticated user is redirected from /admin/match/[id]", async ({
    page,
  }) => {
    await page.goto("/admin/match/00000000-0000-0000-0000-000000000000");
    await expect(page).toHaveURL(/\/(login|discovery)/, { timeout: 10000 });
  });

  test("/admin/match/eval is admin-only", async ({ page }) => {
    await login(page);
    await page.goto("/admin/match/eval");
    // The contract: either you ARE admin (and the page renders) or you are
    // NOT admin (and you cannot reach the URL). The previous version of
    // this test asserted (isAdmin || urlIncludes('/discovery' OR '/login'))
    // which was always true because login lands at /discovery/crypto-sma.
    // The new assertion is XOR: exactly one of (admin sees page) and
    // (non-admin bounced) must be true, and we verify by URL not by a
    // permissive substring match.
    const isAdmin = await page
      .locator("text=Match engine eval")
      .isVisible()
      .catch(() => false);
    const url = page.url();
    if (isAdmin) {
      // Admin path: must actually be on the eval URL
      expect(url).toContain("/admin/match/eval");
    } else {
      // Non-admin path: must NOT be on the eval URL (proxy or DAL bounced)
      expect(url).not.toContain("/admin/match/eval");
    }
  });
});

test.describe("Match Queue — API admin gate", () => {
  test("GET /api/admin/match/allocators requires admin", async ({
    request,
  }) => {
    const res = await request.get("/api/admin/match/allocators");
    // 403 or 401 depending on auth state
    // Unauthenticated requests are redirected by the proxy (307); authenticated
    // non-admin requests get a 401/403 from withAdminAuth.
    expect([307, 401, 403]).toContain(res.status());
  });

  test("POST /api/admin/match/recompute requires admin", async ({
    request,
  }) => {
    const res = await request.post("/api/admin/match/recompute", {
      data: { allocator_id: "00000000-0000-0000-0000-000000000000" },
    });
    // Unauthenticated requests are redirected by the proxy (307); authenticated
    // non-admin requests get a 401/403 from withAdminAuth.
    expect([307, 401, 403]).toContain(res.status());
  });

  test("POST /api/admin/match/send-intro requires admin", async ({
    request,
  }) => {
    const res = await request.post("/api/admin/match/send-intro", {
      data: {
        allocator_id: "00000000-0000-0000-0000-000000000000",
        strategy_id: "00000000-0000-0000-0000-000000000000",
        admin_note: "test",
      },
    });
    // Unauthenticated requests are redirected by the proxy (307); authenticated
    // non-admin requests get a 401/403 from withAdminAuth.
    expect([307, 401, 403]).toContain(res.status());
  });

  test("GET /api/admin/match/kill-switch requires admin", async ({
    request,
  }) => {
    const res = await request.get("/api/admin/match/kill-switch");
    // Unauthenticated requests are redirected by the proxy (307); authenticated
    // non-admin requests get a 401/403 from withAdminAuth.
    expect([307, 401, 403]).toContain(res.status());
  });

  test("POST /api/admin/match/decisions requires admin", async ({
    request,
  }) => {
    const res = await request.post("/api/admin/match/decisions", {
      data: {
        allocator_id: "00000000-0000-0000-0000-000000000000",
        strategy_id: "00000000-0000-0000-0000-000000000000",
        decision: "thumbs_up",
      },
    });
    // Unauthenticated requests are redirected by the proxy (307); authenticated
    // non-admin requests get a 401/403 from withAdminAuth.
    expect([307, 401, 403]).toContain(res.status());
  });
});

test.describe("Match Queue — admin UI (graceful degradation)", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("admin opens match queue, non-admin gets bounced to discovery", async ({
    page,
  }) => {
    // Branches by URL after navigation, NOT by a permissive disjunction.
    // Old version asserted (hasQueue || isRedirected) where one or the
    // other is always true after login — vacuous. New version distinguishes
    // the two paths and asserts something concrete in each.
    await page.goto("/admin/match");
    const url = page.url();

    if (url.endsWith("/admin/match")) {
      // Admin path: page must render with a real anchor that does NOT
      // exist in the error or empty state — the filter chip row.
      await expect(
        page.locator('button:has-text("Needs attention")'),
      ).toBeVisible();
    } else {
      // Non-admin path: must land on the discovery page exactly, not just
      // somewhere containing the substring "/discovery".
      expect(url).toContain("/discovery/crypto-sma");
      expect(url).not.toContain("/admin/match");
    }
  });

  test("match queue index renders filter chips, search, and engine pill (admin only)", async ({
    page,
  }) => {
    // The previous version gated on `text=Match queue` (the page header,
    // which renders even in error mode after migration 011 fix in 3aadcd5).
    // That meant: if the test user IS admin AND migration 011 isn't applied,
    // hasQueue=true triggers the inner assertions, but the filter chips
    // aren't in the DOM, and the test times out. Two failure modes hidden
    // in one assertion.
    //
    // The fix: gate on a more specific anchor (the Needs attention chip
    // itself) and ALSO assert that the migration-error card is NOT visible.
    // This makes the test loud about the actual deployment state instead
    // of silently passing or silently failing.
    await page.goto("/admin/match");
    const url = page.url();
    if (!url.endsWith("/admin/match")) {
      // Non-admin: this test is admin-only, skip the body. The other tests
      // in this describe cover the non-admin redirect path.
      return;
    }

    // Loud failure if the migration isn't applied — the page would show
    // the error card from MatchQueueIndex.tsx instead of the filter chips.
    await expect(
      page.locator("text=/Match engine schema not found/"),
    ).not.toBeVisible();

    // All four filter chips
    await expect(
      page.locator('button:has-text("Needs attention")'),
    ).toBeVisible();
    await expect(
      page.locator('button:has-text("New candidates")'),
    ).toBeVisible();
    await expect(page.locator('button:has-text("All")')).toBeVisible();
    // Search input
    await expect(
      page.locator('input[placeholder*="Search allocators"]'),
    ).toBeVisible();
    // Engine status pill (ON or OFF)
    await expect(page.locator("text=/Engine:/")).toBeVisible();
  });

  test("eval dashboard renders 4 KPIs if visible", async ({ page }) => {
    await page.goto("/admin/match/eval");
    const hasDashboard = await page
      .locator("text=Match engine eval")
      .isVisible()
      .catch(() => false);

    if (hasDashboard) {
      // Four KPI labels
      await expect(page.locator("text=Intros shipped")).toBeVisible();
      await expect(page.locator("text=Hit rate top-3")).toBeVisible();
      await expect(page.locator("text=Hit rate top-10")).toBeVisible();
      await expect(page.locator("text=Graduation gate")).toBeVisible();
      // Window selector
      await expect(page.locator('button:has-text("7d")')).toBeVisible();
      await expect(page.locator('button:has-text("28d")')).toBeVisible();
      await expect(page.locator('button:has-text("90d")')).toBeVisible();
    }
  });
});

test.describe("Preferences page", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("preferences page loads for logged-in user", async ({ page }) => {
    const response = await page.goto("/preferences");
    expect(response?.status()).toBeLessThan(400);
    // Should show form fields
    await expect(
      page.locator("text=Mandate (one sentence)"),
    ).toBeVisible();
    await expect(
      page.locator("text=Typical ticket size"),
    ).toBeVisible();
    await expect(page.locator("text=Excluded exchanges")).toBeVisible();
  });

  test("preferences form submit shows feedback (saved or error)", async ({
    page,
  }) => {
    await page.goto("/preferences");

    // Clear and fill the mandate field
    const mandate = page.locator("textarea").first();
    await mandate.fill("E2E test mandate — diversified crypto SMA");

    // Fill ticket size
    const ticket = page.locator('input[type="number"]').first();
    await ticket.fill("50000");

    // Save
    await page.click('button:has-text("Save preferences")');

    // Wait for one of the two explicit feedback states. If neither appears
    // within 5 seconds, the form is broken and the test FAILS.
    const savedLocator = page.locator("text=/Saved at/");
    const errorLocator = page.locator(".text-negative");
    await Promise.race([
      savedLocator.waitFor({ state: "visible", timeout: 5000 }),
      errorLocator.waitFor({ state: "visible", timeout: 5000 }),
    ]);

    // Assert one of the two is visible (not a tautology — waitFor threw if neither)
    const sawSaved = await savedLocator.isVisible().catch(() => false);
    const sawError = await errorLocator.isVisible().catch(() => false);
    expect(sawSaved || sawError).toBe(true);
  });
});
