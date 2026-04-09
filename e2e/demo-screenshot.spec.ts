import { test, expect } from "@playwright/test";

/**
 * Screenshot regression coverage for `/demo`.
 *
 * Captures the public demo at three viewports and compares against a
 * committed baseline. Under placeholder CI env the page renders its
 * "Demo data is loading" empty state — baselines are taken in that same
 * env, so the comparison is against a deterministic placeholder render,
 * NOT the seeded production render. If the demo layout chrome changes
 * intentionally, refresh the baselines locally.
 *
 * --- Baseline refresh protocol ---
 * 1. Pull the branch and run the exact CI env:
 *      NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co \
 *      NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder \
 *      SUPABASE_SERVICE_ROLE_KEY=placeholder_service_role \
 *      ADMIN_EMAIL=test@example.com \
 *      PLATFORM_NAME=Quantalyze \
 *      PLATFORM_EMAIL=test@quantalyze.com \
 *      npm run build && npm run start &
 * 2. Regenerate the snapshots:
 *      npx playwright test e2e/demo-screenshot.spec.ts --update-snapshots
 * 3. Inspect the diff in `e2e/demo-screenshot.spec.ts-snapshots/` — make
 *    sure every delta is intentional.
 * 4. Commit the updated `*.png` files alongside the UI change that caused
 *    the regression.
 *
 * The first CI run generates baselines automatically at
 * `e2e/demo-screenshot.spec.ts-snapshots/` via Playwright's default path.
 */
test.describe("Screenshot regression: /demo", () => {
  // The demo page is a server component so there's no hydration flash to
  // wait on, but the banner + persona switcher paint within a frame —
  // `networkidle` lets any client-side mount settle before capturing.
  const screenshots = [
    { width: 375, height: 667, label: "mobile", file: "demo-375.png" },
    { width: 768, height: 1024, label: "tablet", file: "demo-768.png" },
    { width: 1280, height: 800, label: "desktop", file: "demo-1280.png" },
  ];
  for (const { width, height, label, file } of screenshots) {
    test(`matches baseline at ${width}x${height} (${label})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/demo");
      await page.waitForLoadState("networkidle");
      await expect(page).toHaveScreenshot(file, {
        fullPage: true,
        maxDiffPixelRatio: 0.02,
      });
    });
  }
});
