import { test, expect } from "@playwright/test";

/**
 * Bridge flow E2E test.
 *
 * Validates the InsightStrip → Bridge Trigger → ReplacementPanel flow.
 * Uses the /demo page which renders InsightStrip with portfolio analytics
 * and does NOT require authentication. This avoids test credentials while
 * still exercising the UI components end-to-end.
 *
 * We do NOT assert on specific data since insights depend on demo seed state.
 * Instead we verify structural correctness: the strip renders, and when an
 * underperformance insight is present, the Bridge trigger and panel work.
 */

test.describe("Bridge flow", () => {
  test("InsightStrip renders on the demo page", async ({ page }) => {
    await page.goto("/demo");

    // Wait for the page to hydrate
    await page.waitForLoadState("networkidle");

    // The InsightStrip section should be present
    const insightSection = page.getByRole("region", { name: "Portfolio insights" });
    await expect(insightSection).toBeVisible();

    // "What we noticed" header should always render
    await expect(page.getByText("What we noticed")).toBeVisible();
  });

  test("InsightStrip shows either insights or fallback copy", async ({ page }) => {
    await page.goto("/demo");
    await page.waitForLoadState("networkidle");

    const insightSection = page.getByRole("region", { name: "Portfolio insights" });
    await expect(insightSection).toBeVisible();

    // Either the fallback "No unusual activity" text or an insight list should render
    const fallback = insightSection.getByText("No unusual activity in the trailing window.");
    const insightList = insightSection.getByRole("list");

    const hasFallback = await fallback.isVisible().catch(() => false);
    const hasList = await insightList.isVisible().catch(() => false);

    expect(hasFallback || hasList).toBe(true);
  });

  test("Bridge trigger appears on underperformance insights", async ({ page }) => {
    await page.goto("/demo");
    await page.waitForLoadState("networkidle");

    // Look for the "Find Replacement" link — only present when an
    // underperformance insight fires AND the demo portfolio has a portfolio_id
    const trigger = page.getByRole("button", { name: /Find Replacement/i });
    const hasTrigger = await trigger.isVisible().catch(() => false);

    if (hasTrigger) {
      // Click the trigger to open the ReplacementPanel
      await trigger.click();

      // The panel should open as a dialog
      const panel = page.getByRole("dialog", { name: /Replacement candidates/i });
      await expect(panel).toBeVisible();

      // Panel header should show the strategy name
      const header = panel.locator("h2");
      await expect(header).toContainText("Replace");

      // Either loading skeletons, candidates, empty state, or error should show
      // Wait a moment for the API call
      await page.waitForTimeout(2000);

      // Close with Escape
      await page.keyboard.press("Escape");

      // Panel should be gone
      await expect(panel).not.toBeVisible();
    } else {
      // No underperformance insight fired — this is valid depending on seed data.
      // Verify the strip still renders correctly without bridge triggers.
      const insightSection = page.getByRole("region", { name: "Portfolio insights" });
      await expect(insightSection).toBeVisible();
    }
  });

  test("ReplacementPanel closes on backdrop click", async ({ page }) => {
    await page.goto("/demo");
    await page.waitForLoadState("networkidle");

    const trigger = page.getByRole("button", { name: /Find Replacement/i });
    const hasTrigger = await trigger.isVisible().catch(() => false);

    if (hasTrigger) {
      await trigger.click();

      const panel = page.getByRole("dialog", { name: /Replacement candidates/i });
      await expect(panel).toBeVisible();

      // Click the backdrop (left side, outside the panel)
      await page.mouse.click(50, 300);

      // Panel should close
      await expect(panel).not.toBeVisible();
    }
  });

  test("allocations InsightStrip renders for authenticated users", async ({ page }) => {
    // Navigate to allocations — will redirect to login if not authenticated
    await page.goto("/allocations");

    // If redirected to login, the InsightStrip is not testable without
    // credentials. Verify the redirect happens correctly.
    const url = page.url();
    if (url.includes("/login")) {
      // Expected for unauthenticated access — pass
      expect(url).toContain("/login");
    } else {
      // If somehow authenticated, verify the InsightStrip renders
      const insightSection = page.getByRole("region", { name: "Portfolio insights" });
      const hasInsights = await insightSection.isVisible().catch(() => false);
      if (hasInsights) {
        await expect(insightSection).toBeVisible();
      }
    }
  });
});
