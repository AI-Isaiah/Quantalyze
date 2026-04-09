import { test, expect } from "@playwright/test";

/**
 * E2E coverage for the public `/demo/founder-view` page.
 *
 * Same CI profile as demo-public.spec.ts — placeholder Supabase env, no
 * seeded data, no auth. The AllocatorMatchQueue mounts in `forceReadOnly`
 * mode and fetches from `/api/demo/match`, which will return an empty or
 * errored payload against placeholder env. The specs assert only on the
 * layout chrome (brand banner + the PageHeader description text), not on
 * queue contents.
 */
test.describe("Public /demo/founder-view page", () => {
  test("loads with brand banner and read-only description", async ({
    page,
  }) => {
    const response = await page.goto("/demo/founder-view");
    expect(response?.status()).toBeLessThan(400);

    // Brand banner from src/app/demo/layout.tsx
    await expect(page.getByText("Quantalyze", { exact: true })).toBeVisible();

    // PageHeader description from src/app/demo/founder-view/page.tsx —
    // substring match is intentional, the full description is longer.
    await expect(
      page.getByText("Read-only preview of the match queue"),
    ).toBeVisible();
  });

  test("links back to the allocator view", async ({ page }) => {
    await page.goto("/demo/founder-view");
    const backLink = page.getByRole("link", { name: /the allocator view/i });
    await expect(backLink).toBeVisible();
    await expect(backLink).toHaveAttribute("href", "/demo");
  });

  test("no console errors on /demo/founder-view", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await page.goto("/demo/founder-view");
    await page.waitForTimeout(1000);

    // Filter Next.js hydration warnings + redirect noise, same shape as
    // smoke.spec.ts. The AllocatorMatchQueue will fail its /api/demo/match
    // fetch against placeholder env; filter that expected network noise
    // too — the spec only cares about structural errors.
    const realErrors = errors.filter(
      (e) =>
        !e.includes("Hydration") &&
        !e.includes("NEXT_REDIRECT") &&
        !e.includes("Failed to fetch") &&
        !e.includes("/api/demo/match"),
    );
    expect(realErrors).toHaveLength(0);
  });

  test("renders without horizontal overflow at 320x568", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    const response = await page.goto("/demo/founder-view");
    expect(response?.status()).toBeLessThan(400);
    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(hasOverflow).toBe(false);
  });

  test("renders without horizontal overflow at 375x667", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    const response = await page.goto("/demo/founder-view");
    expect(response?.status()).toBeLessThan(400);
    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(hasOverflow).toBe(false);
  });

  test("renders without horizontal overflow at 1280x800", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const response = await page.goto("/demo/founder-view");
    expect(response?.status()).toBeLessThan(400);
    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(hasOverflow).toBe(false);
  });
});
