import { test, expect } from "@playwright/test";

/**
 * Audit 2026-05-07 C-0309: credentials are read from env vars at test
 * time, never committed to the repo. Local devs source from the macOS
 * Keychain via `security find-generic-password -s quantalyze-test -a
 * <role>@quantalyze.test -w`; CI injects them through the existing
 * E2E_TEST_EMAIL / E2E_TEST_PASSWORD pipeline. When the env is not
 * present the authenticated/admin describes skip rather than
 * authenticating with stale committed credentials.
 */
const E2E_EMAIL = process.env.E2E_TEST_EMAIL;
const E2E_PASSWORD = process.env.E2E_TEST_PASSWORD;
const HAS_E2E_CREDS = !!E2E_EMAIL && !!E2E_PASSWORD;

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
    test.skip(
      !HAS_E2E_CREDS,
      "set E2E_TEST_EMAIL and E2E_TEST_PASSWORD before running this spec " +
        "(local: source from macOS Keychain `security find-generic-password " +
        "-s quantalyze-test -a <role>@quantalyze.test -w`; CI: injected via " +
        "GitHub Actions secrets)",
    );

    // Login with test account — credentials sourced from env, never
    // hardcoded in the repo (audit 2026-05-07 C-0309).
    await page.goto("/login");
    await page.fill(
      'input[name="email"], input[placeholder*="email" i]',
      E2E_EMAIL!,
    );
    await page.fill('input[type="password"]', E2E_PASSWORD!);
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
    test.skip(
      !HAS_E2E_CREDS,
      "set E2E_TEST_EMAIL and E2E_TEST_PASSWORD before running this spec " +
        "(local: source from macOS Keychain `security find-generic-password " +
        "-s quantalyze-test -a <role>@quantalyze.test -w`; CI: injected via " +
        "GitHub Actions secrets)",
    );

    // Login with test account — credentials sourced from env, never
    // hardcoded in the repo (audit 2026-05-07 C-0309).
    await page.goto("/login");
    await page.fill(
      'input[name="email"], input[placeholder*="email" i]',
      E2E_EMAIL!,
    );
    await page.fill('input[type="password"]', E2E_PASSWORD!);
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
