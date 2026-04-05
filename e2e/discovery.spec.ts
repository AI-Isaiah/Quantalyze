import { test, expect } from "@playwright/test";

test.describe("Discovery pages (unauthenticated)", () => {
  test("discovery category page redirects unauthenticated users", async ({ page }) => {
    await page.goto("/discovery/crypto-sma");
    // Should redirect to login since discovery requires auth
    await expect(page).toHaveURL(/login/);
  });
});
