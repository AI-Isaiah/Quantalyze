import { test, expect } from "@playwright/test";

/**
 * Screenshot regression coverage for `/demo`.
 *
 * Captures the public demo at three viewports and compares against a
 * committed baseline. Under placeholder CI env the page renders its
 * "Demo data is loading" empty state — baselines are taken in that same
 * env, so the comparison is against a deterministic placeholder render,
 * NOT the seeded production render.
 *
 * --- Current state ---
 * This spec is NOT in the CI command list (.github/workflows/ci.yml).
 * Reason: chromium-linux baseline PNGs must be generated inside the
 * Playwright Linux Docker image before CI can compare against them,
 * otherwise Playwright fails every test with "snapshot doesn't exist".
 *
 * --- Baseline generation (one-time bootstrap) ---
 * Run the Playwright Linux image over the repo to produce baselines
 * that match CI's chromium-linux profile, then commit the PNGs:
 *
 *   docker run --rm \
 *     -v "$(pwd):/work" -v /work/node_modules -v /work/.next \
 *     -w /work mcr.microsoft.com/playwright:v1.59.1-jammy bash -c '
 *       export NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co
 *       export NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder
 *       export SUPABASE_SERVICE_ROLE_KEY=placeholder_service_role
 *       export ADMIN_EMAIL=test@example.com
 *       export PLATFORM_NAME=Quantalyze
 *       export PLATFORM_EMAIL=test@quantalyze.com
 *       npm ci && npm run build
 *       npm run start > /tmp/server.log 2>&1 &
 *       for i in $(seq 1 60); do
 *         curl -sf http://localhost:3000 >/dev/null && break; sleep 1
 *       done
 *       npx playwright test e2e/demo-screenshot.spec.ts --update-snapshots
 *     '
 *
 * Then commit `e2e/demo-screenshot.spec.ts-snapshots/demo-*-chromium-linux.png`
 * and re-enable the spec in ci.yml.
 *
 * --- Baseline refresh after intentional UI changes ---
 * Same command, same commit flow. Inspect the diff in
 * `e2e/demo-screenshot.spec.ts-snapshots/` before committing — make
 * sure every delta is intentional.
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
