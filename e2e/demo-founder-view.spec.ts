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
    // Capture BOTH the text and the source URL of every console error.
    // Chrome's browser-level resource errors (e.g. 500 on a fetch) emit
    // the line `Failed to load resource: the server responded with a
    // status of 500 (...)`, and the offending URL is on
    // `msg.location().url`, NOT in `msg.text()`. Filtering only on text
    // made the `/api/demo/match` exclusion a no-op for exactly the case
    // it needed to catch — the /api/demo/match route returns 500 under
    // placeholder Supabase env.
    const errors: Array<{ text: string; url: string }> = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errors.push({ text: msg.text(), url: msg.location().url });
      }
    });

    await page.goto("/demo/founder-view");
    await page.waitForTimeout(1000);

    // Filter Next.js hydration warnings + redirect noise, same shape as
    // smoke.spec.ts. The AllocatorMatchQueue will fail its /api/demo/match
    // fetch against placeholder env; match that on the source URL.
    const realErrors = errors.filter(
      ({ text, url }) =>
        !text.includes("Hydration") &&
        !text.includes("NEXT_REDIRECT") &&
        !text.includes("Failed to fetch") &&
        !url.includes("/api/demo/match") &&
        !text.includes("/api/demo/match"),
    );
    if (realErrors.length > 0) {
      // Surface the full context in CI logs when this fires so the next
      // debugger doesn't have to repro locally.
      console.log("Unexpected console errors:", JSON.stringify(realErrors, null, 2));
    }
    expect(realErrors).toHaveLength(0);
  });

  const viewports = [
    { width: 320, height: 568 },
    { width: 375, height: 667 },
    { width: 1280, height: 800 },
  ];
  for (const { width, height } of viewports) {
    test(`renders without horizontal overflow at ${width}x${height}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      const response = await page.goto("/demo/founder-view");
      expect(response?.status()).toBeLessThan(400);
      const hasOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      );
      expect(hasOverflow).toBe(false);
    });
  }
});
