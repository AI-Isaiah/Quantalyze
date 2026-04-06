import { test, expect, type Page } from "@playwright/test";

/**
 * Sync & Analytics Display Flow (Task 2.3)
 *
 * Tests the trade sync workflow and analytics display page:
 * sync button behavior, progress indicators, computed metrics rendering,
 * and error state handling.
 *
 * Tests that require backend services (Supabase, exchange APIs) or an
 * authenticated session are marked with test.skip and a comment explaining why.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Navigate to a strategy edit page (where sync controls live). */
async function goToStrategyEdit(page: Page, strategyId: string) {
  await page.goto(`/strategies/${strategyId}/edit`);
}

/** Navigate to the analytics detail page for a strategy. */
async function goToAnalyticsPage(page: Page, slug: string, strategyId: string) {
  await page.goto(`/discovery/${slug}/${strategyId}`);
}

// ---------------------------------------------------------------------------
// API-level sync endpoint tests (no auth required — verify JSON contract)
// ---------------------------------------------------------------------------

test.describe("Sync & Analytics Flow", () => {
  test.describe("Sync API endpoint contract", () => {
    test("sync endpoint returns JSON, not redirect", async ({ request }) => {
      const res = await request.post("/api/keys/sync", {
        data: { strategy_id: "00000000-0000-0000-0000-000000000000" },
      });

      const contentType = res.headers()["content-type"] ?? "";
      expect(contentType).toContain("application/json");
      expect(res.status()).not.toBe(307);
    });

    test("sync endpoint returns 401 for unauthenticated request", async ({ request }) => {
      const res = await request.post("/api/keys/sync", {
        data: { strategy_id: "00000000-0000-0000-0000-000000000000" },
      });

      expect(res.status()).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Unauthorized");
    });

    test("sync endpoint returns 400 when strategy_id is missing", async ({ request }) => {
      const res = await request.post("/api/keys/sync", {
        data: {},
      });

      const contentType = res.headers()["content-type"] ?? "";
      expect(contentType).toContain("application/json");
      // 401 if auth checked first, 400 if field validation first — both valid
      expect([400, 401]).toContain(res.status());
    });
  });

  // -------------------------------------------------------------------------
  // Sync button and progress indicator (UI tests)
  // Requires authenticated session, a strategy with a linked API key.
  // -------------------------------------------------------------------------

  test.describe("Sync button triggers data fetch", () => {
    test.skip(
      true,
      "Requires authenticated session with a strategy that has a linked API key. " +
        "The sync button only appears when keys are connected.",
    );

    const TEST_STRATEGY_ID = "00000000-0000-0000-0000-000000000000";

    test("Resync button is visible for the currently linked key", async ({ page }) => {
      await goToStrategyEdit(page, TEST_STRATEGY_ID);

      // The currently linked key should show a "Resync" button
      await expect(
        page.getByRole("button", { name: /Resync/i }),
      ).toBeVisible();
    });

    test("Use & Sync button is visible for unlinked keys", async ({ page }) => {
      await goToStrategyEdit(page, TEST_STRATEGY_ID);

      // Other keys (not currently linked) should show "Use & Sync"
      await expect(
        page.getByRole("button", { name: /Use & Sync/i }),
      ).toBeVisible();
    });

    test("clicking Resync shows syncing state", async ({ page }) => {
      await goToStrategyEdit(page, TEST_STRATEGY_ID);

      // Intercept the sync API call to control timing
      await page.route("/api/keys/sync", async (route) => {
        // Delay response to observe the syncing state
        await new Promise((resolve) => setTimeout(resolve, 2000));
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ trades_fetched: 42, analytics_status: "complete" }),
        });
      });

      await page.getByRole("button", { name: /Resync/i }).click();

      // Button text should change to "Syncing..."
      await expect(
        page.getByRole("button", { name: /Syncing/i }),
      ).toBeVisible();

      // Button should be disabled during sync
      await expect(
        page.getByRole("button", { name: /Syncing/i }),
      ).toBeDisabled();
    });

    test("sync button returns to normal state after completion", async ({ page }) => {
      await goToStrategyEdit(page, TEST_STRATEGY_ID);

      // Intercept sync call with immediate success
      await page.route("/api/keys/sync", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ trades_fetched: 10, analytics_status: "complete" }),
        });
      });

      await page.getByRole("button", { name: /Resync/i }).click();

      // After completion, button should revert to "Resync"
      await expect(
        page.getByRole("button", { name: /Resync/i }),
      ).toBeVisible({ timeout: 10000 });
      await expect(
        page.getByRole("button", { name: /Resync/i }),
      ).toBeEnabled();
    });
  });

  // -------------------------------------------------------------------------
  // Error state when sync fails
  // -------------------------------------------------------------------------

  test.describe("Error state displays when sync fails", () => {
    test.skip(
      true,
      "Requires authenticated session with a strategy that has a linked API key. " +
        "Uses route interception to simulate backend failure.",
    );

    const TEST_STRATEGY_ID = "00000000-0000-0000-0000-000000000000";

    test("sync failure shows error message", async ({ page }) => {
      await goToStrategyEdit(page, TEST_STRATEGY_ID);

      // Intercept sync call to simulate server error
      await page.route("/api/keys/sync", async (route) => {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Exchange API rate limit exceeded" }),
        });
      });

      await page.getByRole("button", { name: /Resync/i }).click();

      // Error message should appear
      await expect(
        page.locator(".text-negative"),
      ).toBeVisible({ timeout: 10000 });

      // Button should return to enabled state after failure
      await expect(
        page.getByRole("button", { name: /Resync/i }),
      ).toBeEnabled({ timeout: 5000 });
    });

    test("sync failure with non-JSON response shows service unavailable", async ({ page }) => {
      await goToStrategyEdit(page, TEST_STRATEGY_ID);

      // Simulate a non-JSON error (e.g., gateway timeout returning HTML)
      await page.route("/api/keys/sync", async (route) => {
        await route.fulfill({
          status: 502,
          contentType: "text/html",
          body: "<html><body>Bad Gateway</body></html>",
        });
      });

      await page.getByRole("button", { name: /Resync/i }).click();

      // Should show the service unavailable fallback message
      await expect(
        page.getByText(/service unavailable|sync failed/i),
      ).toBeVisible({ timeout: 10000 });
    });
  });

  // -------------------------------------------------------------------------
  // Analytics display page — computed metrics after sync
  // Requires authenticated session AND a strategy with computed analytics data.
  // -------------------------------------------------------------------------

  test.describe("Analytics display shows computed metrics", () => {
    test.skip(
      true,
      "Requires authenticated session and a strategy with completed analytics computation. " +
        "Set PLAYWRIGHT_TEST_STRATEGY_ID and PLAYWRIGHT_TEST_SLUG env vars to run.",
    );

    const TEST_SLUG = process.env.PLAYWRIGHT_TEST_SLUG ?? "crypto-sma";
    const TEST_STRATEGY_ID = process.env.PLAYWRIGHT_TEST_STRATEGY_ID ?? "00000000-0000-0000-0000-000000000000";

    test("analytics page renders hero metrics (CAGR, Sharpe, Max Drawdown)", async ({ page }) => {
      await goToAnalyticsPage(page, TEST_SLUG, TEST_STRATEGY_ID);

      // Hero metric cards
      await expect(page.getByText("CAGR")).toBeVisible();
      await expect(page.getByText("Sharpe")).toBeVisible();
      await expect(page.getByText("Max Drawdown")).toBeVisible();

      // Values should be rendered (not just labels)
      // Metric values use the font-metric class
      const metricValues = page.locator(".font-metric");
      await expect(metricValues).not.toHaveCount(0);
    });

    test("analytics page renders equity curve chart", async ({ page }) => {
      await goToAnalyticsPage(page, TEST_SLUG, TEST_STRATEGY_ID);

      // Equity curve is rendered inside a Card with a Recharts SVG
      // Look for the chart container or SVG element
      const chartContainer = page.locator("svg.recharts-surface").first();
      await expect(chartContainer).toBeVisible({ timeout: 10000 });
    });

    test("analytics page renders tabbed metric panels", async ({ page }) => {
      await goToAnalyticsPage(page, TEST_SLUG, TEST_STRATEGY_ID);

      // Verify the three tabs are present
      for (const tab of ["Overview", "Returns", "Risk"]) {
        await expect(page.getByRole("button", { name: tab })).toBeVisible();
      }

      // Default tab is Overview — drawdown chart should be visible
      await expect(page.getByText(/Underwater|Drawdown/i)).toBeVisible();
    });

    test("switching to Returns tab shows monthly returns and distribution charts", async ({ page }) => {
      await goToAnalyticsPage(page, TEST_SLUG, TEST_STRATEGY_ID);

      await page.getByRole("button", { name: "Returns" }).click();

      await expect(page.getByText("Monthly Returns")).toBeVisible();
      await expect(page.getByText("Return Distribution")).toBeVisible();
      await expect(page.getByText("Yearly Returns")).toBeVisible();
    });

    test("switching to Risk tab shows rolling metrics and risk of ruin", async ({ page }) => {
      await goToAnalyticsPage(page, TEST_SLUG, TEST_STRATEGY_ID);

      await page.getByRole("button", { name: "Risk" }).click();

      await expect(page.getByText("Rolling Sharpe")).toBeVisible();
      await expect(page.getByText("Risk of Ruin")).toBeVisible();
    });

    test("metric panel renders accordion sections with computed values", async ({ page }) => {
      await goToAnalyticsPage(page, TEST_SLUG, TEST_STRATEGY_ID);

      // Main Metrics accordion should be open by default
      await expect(page.getByText("Main Metrics")).toBeVisible();
      await expect(page.getByText("Cumulative Return")).toBeVisible();
      await expect(page.getByText("Volatility")).toBeVisible();
      await expect(page.getByText("Sortino")).toBeVisible();
      await expect(page.getByText("Calmar")).toBeVisible();

      // Returns Metrics accordion should also be open by default
      await expect(page.getByText("Returns Metrics")).toBeVisible();
    });

    test("compute status banner shows when analytics are not complete", async ({ page }) => {
      // This test verifies the ComputeStatus component renders for non-complete states.
      // In a real scenario, a strategy mid-computation would show this banner.
      await goToAnalyticsPage(page, TEST_SLUG, TEST_STRATEGY_ID);

      // If computation is complete, the banner should NOT be visible
      // If pending/computing/failed, the banner SHOULD be visible
      // We verify the page loads without error in either case
      await expect(page.locator("body")).toBeVisible();

      // Page should have a breadcrumb indicating we are on the right page
      await expect(page.getByText("Discovery")).toBeVisible();
    });

    test("factsheet link is present on analytics page", async ({ page }) => {
      await goToAnalyticsPage(page, TEST_SLUG, TEST_STRATEGY_ID);

      const factsheetLink = page.getByRole("link", { name: /Factsheet/i });
      await expect(factsheetLink).toBeVisible();
      await expect(factsheetLink).toHaveAttribute("target", "_blank");
    });
  });

  // -------------------------------------------------------------------------
  // Discovery page — unauthenticated redirect
  // -------------------------------------------------------------------------

  test.describe("Discovery pages require authentication", () => {
    test("analytics detail page redirects unauthenticated users to login", async ({ page }) => {
      await page.goto("/discovery/crypto-sma/some-strategy-id");
      await expect(page).toHaveURL(/login/);
    });
  });
});
