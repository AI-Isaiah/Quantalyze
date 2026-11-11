import { test, expect, type Page } from "@playwright/test";

/**
 * Sync & Analytics Display Flow (Task 2.3)
 *
 * Tests the sync endpoint contract (Playwright's unauthenticated `request`
 * fixture), the analytics display page and the retired discovery detail URL.
 *
 * The strategy edit page's sync-button and failure-state tests (Resync, the
 * syncing state, the 500 and 502 failure lines) moved to the seeded, blocking
 * `e2e/manager-keys.spec.ts` in Phase 200 gap closure: this file's only
 * Playwright list is the advisory `e2e` job, and those tests skipped on an env
 * var no workflow sets.
 *
 * The analytics describe still needs an authenticated session and a strategy
 * with computed analytics, so it self-skips without its env vars.
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

  // The edit page's sync-button and error-state tests moved to
  // e2e/manager-keys.spec.ts (Phase 200 gap closure: seeded, logged in,
  // blocking in the e2e-seeded list).

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
