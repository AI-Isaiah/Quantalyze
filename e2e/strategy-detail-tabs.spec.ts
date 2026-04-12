import { test, expect } from "@playwright/test";

/**
 * E2E coverage for the Sprint 4 five-tab layout on the strategy detail page.
 *
 * The PerformanceReport component renders five tabs:
 *   Overview | Returns | Risk | Volume & Exposure | Positions
 *
 * These tests navigate to a real strategy via the discovery table, then
 * verify tab presence, click-through stability, empty states for the two
 * new tabs, and regression on the three original tabs.
 */

const TABS = ["Overview", "Returns", "Risk", "Volume & Exposure", "Positions"] as const;

test.describe("Strategy Detail Tabs", () => {
  test.beforeEach(async ({ page }) => {
    // Login with test account
    await page.goto("/login");
    await page.fill(
      'input[name="email"], input[placeholder*="email" i]',
      "matratzentester24@gmail.com",
    );
    await page.fill('input[type="password"]', "Test12");
    await page.click('button:has-text("Sign in")');
    await page.waitForURL(/\/(discovery|strategies)/, { timeout: 10000 });

    // Navigate to discovery and click into the first strategy
    await page.goto("/discovery/crypto-sma");
    const firstLink = page.locator("table tbody tr a").first();
    await expect(firstLink).toBeVisible({ timeout: 10000 });
    await firstLink.click();

    // Wait for the detail page to render hero metrics
    await expect(page.locator("text=CAGR").first()).toBeVisible({
      timeout: 10000,
    });
  });

  test("renders all 5 tab buttons", async ({ page }) => {
    for (const label of TABS) {
      await expect(
        page.locator(`button:has-text("${label}")`).first(),
      ).toBeVisible();
    }
  });

  test("clicking each tab renders without error", async ({ page }) => {
    for (const label of TABS) {
      await page.locator(`button:has-text("${label}")`).first().click();

      // After clicking, the tab button should be active (accent color)
      await expect(
        page.locator(`button:has-text("${label}")`).first(),
      ).toHaveClass(/text-accent/);

      // Page should not show an unhandled error overlay
      const errorOverlay = page.locator("#nextjs__container_errors_label");
      await expect(errorOverlay).toHaveCount(0);
    }
  });

  test("Volume & Exposure tab shows content or empty state", async ({
    page,
  }) => {
    await page.locator('button:has-text("Volume & Exposure")').first().click();

    // Either the tab renders trade data (Buy / Sell Volume heading) or
    // the empty state placeholder. Both are valid for seeded data.
    const hasData = page.locator("text=Buy / Sell Volume");
    const hasEmpty = page.locator("text=No trade data yet");

    await expect(hasData.or(hasEmpty).first()).toBeVisible({ timeout: 5000 });
  });

  test("Positions tab shows content or empty state", async ({ page }) => {
    await page.locator('button:has-text("Positions")').first().click();

    // Either positions table content or the empty state.
    const hasData = page.locator("text=Position Counts");
    const hasEmpty = page.locator("text=No positions reconstructed yet");

    await expect(hasData.or(hasEmpty).first()).toBeVisible({ timeout: 5000 });
  });

  test("Overview tab still shows drawdown chart area", async ({ page }) => {
    // Overview is the default tab, but click it explicitly for clarity
    await page.locator('button:has-text("Overview")').first().click();

    await expect(page.locator("text=Underwater / Drawdown")).toBeVisible();
    await expect(page.locator("text=Worst Drawdowns")).toBeVisible();
  });

  test("Returns tab still shows monthly heatmap area", async ({ page }) => {
    await page.locator('button:has-text("Returns")').first().click();

    await expect(page.locator("text=Monthly Returns")).toBeVisible();
    await expect(page.locator("text=Return Quantiles")).toBeVisible();
    await expect(page.locator("text=Yearly Returns")).toBeVisible();
  });

  test("Risk tab still shows correlation area", async ({ page }) => {
    await page.locator('button:has-text("Risk")').first().click();

    await expect(page.locator("text=Correlation with BTC")).toBeVisible();
    await expect(page.locator("text=Rolling Sharpe")).toBeVisible();
    await expect(page.locator("text=Risk of Ruin")).toBeVisible();
  });
});
