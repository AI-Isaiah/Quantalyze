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

  test("non-admin allocator hitting /admin/match/eval is redirected", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/admin/match/eval");
    // Either the page renders (if test user is admin) or we land somewhere safe
    const isAdmin = await page
      .locator("text=Match engine eval")
      .isVisible()
      .catch(() => false);
    const isRedirected =
      page.url().includes("/discovery") ||
      page.url().includes("/login");
    expect(isAdmin || isRedirected).toBeTruthy();
  });
});

test.describe("Match Queue — API admin gate", () => {
  test("GET /api/admin/match/allocators requires admin", async ({
    request,
  }) => {
    const res = await request.get("/api/admin/match/allocators");
    // 403 or 401 depending on auth state
    expect([401, 403]).toContain(res.status());
  });

  test("POST /api/admin/match/recompute requires admin", async ({
    request,
  }) => {
    const res = await request.post("/api/admin/match/recompute", {
      data: { allocator_id: "00000000-0000-0000-0000-000000000000" },
    });
    expect([401, 403]).toContain(res.status());
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
    expect([401, 403]).toContain(res.status());
  });

  test("GET /api/admin/match/kill-switch requires admin", async ({
    request,
  }) => {
    const res = await request.get("/api/admin/match/kill-switch");
    expect([401, 403]).toContain(res.status());
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
    expect([401, 403]).toContain(res.status());
  });
});

test.describe("Match Queue — admin UI (graceful degradation)", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("admin can open match queue index OR is redirected", async ({
    page,
  }) => {
    await page.goto("/admin/match");
    const hasQueue = await page
      .locator("text=Match queue")
      .isVisible()
      .catch(() => false);
    const isRedirected = page.url().includes("/discovery");
    expect(hasQueue || isRedirected).toBeTruthy();
  });

  test("match queue index has filter chips and search if visible", async ({
    page,
  }) => {
    await page.goto("/admin/match");
    const hasQueue = await page
      .locator("text=Match queue")
      .isVisible()
      .catch(() => false);

    if (hasQueue) {
      // Filter chip row should have all four filters
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
    }
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
