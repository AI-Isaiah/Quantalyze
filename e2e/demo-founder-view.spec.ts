import { test, expect } from "@playwright/test";
import {
  filterUnexpectedConsoleErrors,
  type CapturedConsoleError,
} from "../src/lib/playwright-console-filter";

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
    // Capture BOTH text AND source URL for every console error. Chrome's
    // browser-level resource errors (e.g. a 500 on a fetch) emit a generic
    // text "Failed to load resource: the server responded with a status
    // of 500 (...)" with the offending URL on `msg.location().url`, NOT
    // in the text. The filter predicate lives in
    // `src/lib/playwright-console-filter.ts` with unit tests in the same
    // directory that pin down the regression (commit 0089cee).
    const errors: CapturedConsoleError[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        errors.push({ text: msg.text(), url: msg.location().url });
      }
    });

    await page.goto("/demo/founder-view");
    await page.waitForTimeout(1000);

    const realErrors = filterUnexpectedConsoleErrors(errors, {
      ignoreTextIncludes: ["Hydration", "NEXT_REDIRECT", "Failed to fetch"],
      ignoreTextOrUrlIncludes: ["/api/demo/match"],
    });
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
