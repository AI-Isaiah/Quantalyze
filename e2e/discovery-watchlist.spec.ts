/**
 * Phase 13 / Plan 13-01 / DISCO-01 — Watchlist e2e contract.
 *
 * Proves the cross-stack guarantee: an allocator can star a strategy, reload
 * the page, and see it persisted in `user_favorites` (migration 024) via the
 * new PUT /api/watchlist/[strategyId] route. This is the only test in this
 * spec — it covers the DISCO-01 acceptance criterion verbatim.
 *
 * Login fixture mirrors e2e/full-flow.spec.ts:53-60 — the same allocator
 * test account that other discovery e2es use. Cleanup at end keeps the
 * spec idempotent across reruns (CI reuses the same DB).
 *
 * NOTE: Wave 0 RED — sources for /api/watchlist + StarToggle do not yet
 * exist; this spec will fail until Plan 13-01 Task 2 lands.
 */

import { test, expect } from "@playwright/test";

test.describe("DISCO-01 watchlist", () => {
  test("watchlist toggle persists across reload", async ({ page }) => {
    // 1. Login (matches e2e/full-flow.spec.ts:53-60 allocator fixture).
    await page.goto("/login");
    await page.fill(
      'input[name="email"], input[placeholder*="email" i]',
      "matratzentester24@gmail.com",
    );
    await page.fill('input[type="password"]', "Test12");
    await page.click('button:has-text("Sign in")');
    await page.waitForURL(/\/(discovery|strategies)/, { timeout: 10000 });

    // 2. Navigate to /discovery/crypto-sma and wait for the table to render.
    await page.goto("/discovery/crypto-sma");
    await page.waitForSelector("table tbody tr", { timeout: 10000 });

    // 3. Pre-clean: if the first row is already starred (from a prior run),
    // unstar it first so we always begin from a known state.
    const firstRow = page.locator("table tbody tr").first();
    const preStarred = firstRow.locator('button[aria-label*="from watchlist"]');
    if (await preStarred.isVisible().catch(() => false)) {
      await preStarred.click();
      await page.waitForResponse(
        (r) => r.url().includes("/api/watchlist/") && r.status() === 200,
      );
    }

    // 4. Click the FIRST row's star (unstarred → starred) and wait for the
    // PUT to land successfully.
    const starButton = firstRow.locator('button[aria-label*="to watchlist"]').first();
    await expect(starButton).toBeVisible();
    const starredResponse = page.waitForResponse(
      (r) => r.url().includes("/api/watchlist/") && r.status() === 200,
    );
    await starButton.click();
    await starredResponse;

    // 5. Reload and confirm the star is still filled (server-persisted).
    await page.reload();
    await page.waitForSelector("table tbody tr", { timeout: 10000 });
    const firstRowAfterReload = page.locator("table tbody tr").first();
    await expect(
      firstRowAfterReload.locator('button[aria-label*="from watchlist"]'),
    ).toBeVisible();

    // 6. The My Watchlist tab badge must read "1".
    const watchTab = page.getByRole("tab", { name: /My Watchlist/ });
    await expect(watchTab).toContainText("1");

    // 7. Clicking My Watchlist filters to exactly 1 row.
    await watchTab.click();
    await expect(page.locator("table tbody tr")).toHaveCount(1);

    // 8. Cleanup — unstar so subsequent runs start from zero.
    const cleanupButton = page
      .locator("table tbody tr")
      .first()
      .locator('button[aria-label*="from watchlist"]');
    if (await cleanupButton.isVisible().catch(() => false)) {
      const cleanupResponse = page.waitForResponse(
        (r) => r.url().includes("/api/watchlist/") && r.status() === 200,
      );
      await cleanupButton.click();
      await cleanupResponse;
    }
  });
});
