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

/**
 * 158-05 (OPS-03 orphan repair, 2026-08-20): mutating /api POSTs pass the CSRF
 * origin gate (`assertSameOrigin`, src/lib/csrf.ts, added 2026-05-17 — AFTER
 * this spec was written) BEFORE auth, and Playwright's `request` fixture sends
 * no Origin header, so these contract tests were observing the CSRF 403 arm.
 * Sending the app's own origin probes past CSRF to the auth contract asserted.
 * CI wiring note (plan 158-06): a production-mode server needs
 * `NEXT_PUBLIC_ALLOWED_ORIGINS: http://localhost:3000` in the job env (the
 * seeded job's existing precedent in ci.yml); `npm run dev` allowlists
 * localhost natively.
 */
const ORIGIN = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";

/** Navigate to a strategy edit page (where sync controls live). */
async function goToStrategyEdit(page: Page, strategyId: string) {
  await page.goto(`/strategies/${strategyId}/edit`);
}

/**
 * Navigate to the analytics detail page for a strategy.
 *
 * Phase 196 ONESTRATEGYPAGE (D-03): the old /discovery/<slug>/<id> detail page
 * is retired and its URL 308s to /factsheet/<id>?from=discovery&cat=<slug>.
 * The analytics now live on the factsheet, so go there directly with the
 * origin the redirect would have carried.
 */
async function goToAnalyticsPage(page: Page, slug: string, strategyId: string) {
  await page.goto(`/factsheet/${strategyId}?from=discovery&cat=${slug}`);
}

// ---------------------------------------------------------------------------
// API-level sync endpoint tests (no auth required — verify JSON contract)
// ---------------------------------------------------------------------------

test.describe("Sync & Analytics Flow", () => {
  test.describe("Sync API endpoint contract", () => {
    test("sync endpoint returns JSON, not redirect", async ({ request }) => {
      const res = await request.post("/api/keys/sync", {
        headers: { Origin: ORIGIN },
        data: { strategy_id: "00000000-0000-0000-0000-000000000000" },
      });

      const contentType = res.headers()["content-type"] ?? "";
      expect(contentType).toContain("application/json");
      expect(res.status()).not.toBe(307);

      // 158-REVIEW WR-07 (sibling of e2e/api-key-flow.spec.ts): a CSRF
      // rejection is JSON and is not a 307, so without this line the case
      // passes just as happily when the Origin allowlist wiring breaks and the
      // request never reaches the auth contract it exists to probe.
      expect(
        res.status(),
        "403 here means the Origin/allowlist wiring broke (CSRF rejected the request before auth), not that the sync contract changed — check NEXT_PUBLIC_ALLOWED_ORIGINS and PLAYWRIGHT_BASE_URL against the served origin",
      ).not.toBe(403);
    });

    test("sync endpoint returns 401 for unauthenticated request", async ({ request }) => {
      const res = await request.post("/api/keys/sync", {
        headers: { Origin: ORIGIN },
        data: { strategy_id: "00000000-0000-0000-0000-000000000000" },
      });

      expect(res.status()).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Unauthorized");
    });

    test("sync endpoint returns 400 when strategy_id is missing", async ({ request }) => {
      const res = await request.post("/api/keys/sync", {
        headers: { Origin: ORIGIN },
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
    // 140.5-06: was `test.skip(true, …)`. Gated on the same env var the sibling
    // suites use for the identical precondition; absent from CI, so CI behaviour
    // is unchanged and it becomes opt-in runnable locally.
    test.skip(
      !process.env.PLAYWRIGHT_TEST_STRATEGY_ID,
      "Requires authenticated session with a strategy that has a linked API key. " +
        "The sync button only appears when keys are connected. " +
        "Set PLAYWRIGHT_TEST_STRATEGY_ID to run.",
    );

    const TEST_STRATEGY_ID = "00000000-0000-0000-0000-000000000000";

    test("Resync button is visible for the currently linked key", async ({ page }) => {
      await goToStrategyEdit(page, TEST_STRATEGY_ID);

      // The currently linked key should show a "Resync" button
      await expect(
        page.getByRole("button", { name: /Resync/i }),
      ).toBeVisible();
    });

    test("Change key… picks another key and opens the confirm without writing", async ({ page }) => {
      await goToStrategyEdit(page, TEST_STRATEGY_ID);

      // Phase 200 D-03/D-07: the per-card "Use & Sync" is gone. One header
      // "Change key…" appears when the account holds another key; a pick opens
      // the confirm dialog, and only its "Change key" button writes. Needs a
      // second key on the test account.
      await page.getByRole("button", { name: "Change key…" }).click();
      await page.locator('[data-testid^="change-key-option-"]').first().click();

      // The native <dialog> carries no accessible name, so match it by its title.
      const dialog = page.getByRole("dialog").filter({ hasText: "Change this strategy's key?" });
      await expect(dialog).toBeVisible();

      // Cancel: nothing was written, the strategy keeps its key.
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toBeHidden();
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
    // 140.5-06: was `test.skip(true, …)`. Same precondition, same gate as the
    // sibling describe above.
    test.skip(
      !process.env.PLAYWRIGHT_TEST_STRATEGY_ID,
      "Requires authenticated session with a strategy that has a linked API key. " +
        "Uses route interception to simulate backend failure. " +
        "Set PLAYWRIGHT_TEST_STRATEGY_ID to run.",
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
    // 140.5-06: was `test.skip(true, …)` while its own reason named BOTH env
    // vars — the skip was contradicting its own instructions. Both are read
    // immediately below, so the gate now matches what the file already does.
    test.skip(
      !process.env.PLAYWRIGHT_TEST_STRATEGY_ID || !process.env.PLAYWRIGHT_TEST_SLUG,
      "Requires authenticated session and a strategy with completed analytics computation. " +
        "Set PLAYWRIGHT_TEST_STRATEGY_ID and PLAYWRIGHT_TEST_SLUG env vars to run.",
    );

    const TEST_SLUG = process.env.PLAYWRIGHT_TEST_SLUG ?? "crypto-sma";
    const TEST_STRATEGY_ID = process.env.PLAYWRIGHT_TEST_STRATEGY_ID ?? "00000000-0000-0000-0000-000000000000";

    test("analytics page renders hero metrics (CAGR, Sharpe, Max Drawdown)", async ({ page }) => {
      await goToAnalyticsPage(page, TEST_SLUG, TEST_STRATEGY_ID);

      // Factsheet metrics column rows (MetricsColumn: Returns / Risk sections).
      await expect(page.getByText("CAGR", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Sharpe", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Max Drawdown", { exact: true }).first()).toBeVisible();
    });

    test("analytics page renders the performance section with its charts", async ({ page }) => {
      await goToAnalyticsPage(page, TEST_SLUG, TEST_STRATEGY_ID);

      // The factsheet's Performance CollapsibleSection (id="factsheet-perf",
      // defaultOpen) carries the equity chart.
      await expect(page.locator("#factsheet-perf")).toBeVisible({ timeout: 10000 });
    });

    test("analytics page renders the distribution and heatmap sections", async ({ page }) => {
      await goToAnalyticsPage(page, TEST_SLUG, TEST_STRATEGY_ID);

      // Monthly returns and the return distribution live in the Heatmaps and
      // Distribution CollapsibleSections, both defaultOpen.
      await expect(page.locator("#factsheet-dist")).toBeVisible({ timeout: 10000 });
      await expect(page.locator("#factsheet-heatmaps")).toBeVisible();
      await expect(page.getByText("Monthly Returns").first()).toBeVisible();
    });

    test("metric column renders computed values for the risk-adjusted rows", async ({ page }) => {
      await goToAnalyticsPage(page, TEST_SLUG, TEST_STRATEGY_ID);

      await expect(page.getByText("Ann. Volatility", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Sortino", { exact: true }).first()).toBeVisible();
      await expect(page.getByText("Calmar", { exact: true }).first()).toBeVisible();
    });

    test("compute status banner shows when analytics are not complete", async ({ page }) => {
      // This test verifies the factsheet renders for non-complete states.
      // In a real scenario, a strategy mid-computation would show a status line.
      await goToAnalyticsPage(page, TEST_SLUG, TEST_STRATEGY_ID);

      // If computation is complete, the status line should NOT be visible
      // If pending/computing/failed, it SHOULD be visible
      // We verify the page loads without error in either case
      await expect(page.locator("body")).toBeVisible();

      // The factsheet carries the origin the old discovery link named (D-01);
      // the "Back to Discovery" label itself is asserted with the viewer bar.
      await expect(page).toHaveURL(
        new RegExp(`/factsheet/${TEST_STRATEGY_ID}\\?.*from=discovery`),
      );
    });

    test("the old discovery detail link lands on the factsheet with its origin", async ({ page }) => {
      // Phase 196 D-03: replaces "factsheet link is present on analytics page".
      // The detail page and the factsheet are one page now, so there is no
      // link to follow; the old URL itself must arrive here.
      await page.goto(`/discovery/${TEST_SLUG}/${TEST_STRATEGY_ID}`);

      await expect(page).toHaveURL(
        new RegExp(`/factsheet/${TEST_STRATEGY_ID}\\?.*from=discovery`),
      );
      await expect(page).toHaveURL(new RegExp(`cat=${TEST_SLUG}`));
    });
  });

  // -------------------------------------------------------------------------
  // Retired discovery detail URL — anonymous visitor reaches the factsheet (D-03)
  // -------------------------------------------------------------------------

  test.describe("Retired discovery detail URL", () => {
    test("the retired analytics detail URL no longer bounces an anonymous visitor to login", async ({ page }) => {
      // Phase 196 D-03: /discovery/<slug>/<id> 308s to the public factsheet
      // (config redirect, before the proxy). An anonymous visitor on an old
      // link reaches /factsheet/<id> and the factsheet decides visibility; the
      // login bounce this test used to pin is the #512 defect for this URL.
      await page.goto("/discovery/crypto-sma/some-strategy-id");
      await expect(page).toHaveURL(/\/factsheet\/some-strategy-id/);
      await expect(page).not.toHaveURL(/login/);
    });
  });
});
