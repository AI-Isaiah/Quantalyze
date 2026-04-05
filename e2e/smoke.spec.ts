import { test, expect } from "@playwright/test";

test.describe("Smoke tests", () => {
  test("homepage loads", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBeLessThan(400);
  });

  test("login page loads", async ({ page }) => {
    const response = await page.goto("/login");
    expect(response?.status()).toBeLessThan(400);
    await expect(page.locator("form")).toBeVisible();
  });

  test("signup page loads", async ({ page }) => {
    const response = await page.goto("/signup");
    expect(response?.status()).toBeLessThan(400);
    await expect(page.locator("form")).toBeVisible();
  });

  test("no console errors on public pages", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await page.goto("/login");
    await page.waitForTimeout(1000);

    // Filter out expected Next.js hydration warnings
    const realErrors = errors.filter(
      (e) => !e.includes("Hydration") && !e.includes("NEXT_REDIRECT"),
    );
    expect(realErrors).toHaveLength(0);
  });
});
