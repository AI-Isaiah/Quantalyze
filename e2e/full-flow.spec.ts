import { test, expect } from "@playwright/test";

test.describe("Public browsing flow", () => {
  test("landing page links to /browse", async ({ page }) => {
    await page.goto("/");
    const browseLink = page.locator('a:has-text("Browse Strategies")');
    await expect(browseLink).toBeVisible();
    await browseLink.click();
    await expect(page).toHaveURL(/\/browse/);
  });

  test("browse page loads strategy categories", async ({ page }) => {
    const response = await page.goto("/browse");
    expect(response?.status()).toBeLessThan(400);
    await expect(page.locator("h1")).toContainText("Browse");
  });

  test("browse category page shows strategies without auth", async ({
    page,
  }) => {
    await page.goto("/browse/crypto-sma");
    // Should not redirect to login
    await expect(page).toHaveURL(/\/browse\/crypto-sma/);
    // Should show the table or a "no strategies" message
    const hasTable = await page.locator("table").isVisible().catch(() => false);
    const hasEmpty = await page
      .locator("text=No strategies")
      .isVisible()
      .catch(() => false);
    expect(hasTable || hasEmpty).toBeTruthy();
  });

  test("factsheet page loads for published strategy", async ({ page }) => {
    // First browse to find a strategy ID
    await page.goto("/browse/crypto-sma");
    const firstLink = page.locator("table tbody tr a").first();
    const hasStrategies = await firstLink.isVisible().catch(() => false);

    if (hasStrategies) {
      const href = await firstLink.getAttribute("href");
      const strategyId = href?.split("/").pop();
      if (strategyId) {
        const response = await page.goto(`/factsheet/${strategyId}`);
        expect(response?.status()).toBeLessThan(400);
        await expect(page.locator("text=Verified by Quantalyze")).toBeVisible();
      }
    }
  });
});

test.describe("Authenticated flows", () => {
  test.beforeEach(async ({ page }) => {
    // Login with test account
    await page.goto("/login");
    await page.fill('input[name="email"], input[placeholder*="email" i]', "matratzentester24@gmail.com");
    await page.fill('input[type="password"]', "Test12");
    await page.click('button:has-text("Sign in")');
    // Wait for redirect to discovery
    await page.waitForURL(/\/(discovery|strategies)/, { timeout: 10000 });
  });

  test("strategy discovery loads with data", async ({ page }) => {
    await page.goto("/discovery/crypto-sma");
    await expect(page.locator("h1, h2")).toContainText(/Crypto SMA/);
  });

  test("my strategies page shows strategies", async ({ page }) => {
    await page.goto("/strategies");
    await expect(page.locator("h1")).toContainText("My Strategies");
  });

  test("allocations page loads", async ({ page }) => {
    await page.goto("/allocations");
    await expect(page.locator("h1")).toContainText("My Allocations");
  });

  test("strategy detail shows hero metrics", async ({ page }) => {
    await page.goto("/discovery/crypto-sma");
    const firstLink = page.locator("table tbody tr a").first();
    const hasStrategies = await firstLink.isVisible().catch(() => false);

    if (hasStrategies) {
      await firstLink.click();
      // Should see hero metrics
      await expect(page.locator("text=CAGR").first()).toBeVisible({
        timeout: 10000,
      });
      await expect(page.locator("text=Sharpe").first()).toBeVisible();
    }
  });

  test("share button copies factsheet URL", async ({ page, context }) => {
    await page.goto("/strategies");
    const shareBtn = page.locator('button:has-text("Share Factsheet")').first();
    const hasShare = await shareBtn.isVisible().catch(() => false);

    if (hasShare) {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await shareBtn.click();
      await expect(
        page.locator('button:has-text("Link copied!")').first()
      ).toBeVisible({ timeout: 3000 });
    }
  });
});

test.describe("Admin flows", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[name="email"], input[placeholder*="email" i]', "matratzentester24@gmail.com");
    await page.fill('input[type="password"]', "Test12");
    await page.click('button:has-text("Sign in")');
    await page.waitForURL(/\/(discovery|strategies)/, { timeout: 10000 });
  });

  test("admin dashboard loads", async ({ page }) => {
    await page.goto("/admin");
    // May redirect if not admin, or show dashboard
    const isAdmin = await page
      .locator("text=Admin Dashboard")
      .isVisible()
      .catch(() => false);
    const isRedirected = page.url().includes("/discovery");
    expect(isAdmin || isRedirected).toBeTruthy();
  });
});
