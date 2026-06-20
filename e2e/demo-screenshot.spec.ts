import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";

/**
 * C-0300 sentinel — a fast filesystem guard that the chromium-linux
 * baseline PNGs are committed. The baselines have landed and this whole
 * spec now runs unconditionally in CI (tech-debt #25 dropped the old
 * `--grep "C-0300 sentinel"` gate and added the spec to the e2e job's
 * unconditional command list). The sentinel is retained as a cheap,
 * page-fixture-free guard: if a baseline PNG is ever deleted it fails in
 * ~ms with a clear message, before the slower screenshot comparisons run.
 *
 * Recovery if a baseline is missing: regenerate via the Docker command in
 * the file comment below, then commit the PNGs under
 * `e2e/demo-screenshot.spec.ts-snapshots/`.
 */
test("C-0300 sentinel: chromium-linux baselines committed", () => {
  const snapshotDir = path.join(
    __dirname,
    "demo-screenshot.spec.ts-snapshots",
  );
  // Names must mirror the `file:` field of each entry in the
  // `screenshots` array below. Playwright suffixes the platform
  // (chromium-linux) to the file name on disk.
  const required = [
    "demo-375-chromium-linux.png",
    "demo-768-chromium-linux.png",
    "demo-1280-chromium-linux.png",
  ];
  const missing = required.filter(
    (name) => !fs.existsSync(path.join(snapshotDir, name)),
  );
  expect(
    missing,
    `Missing baseline PNG(s) under ${snapshotDir}: ${missing.join(", ")}. ` +
      `Regenerate via the Docker command in this file's header comment, ` +
      `then commit the PNGs.`,
  ).toEqual([]);
});

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
 * ACTIVE: this spec runs unconditionally in the e2e job's Playwright
 * command (.github/workflows/ci.yml) as of tech-debt #25. The
 * chromium-linux baselines are committed under
 * `e2e/demo-screenshot.spec.ts-snapshots/`.
 *
 * --- Baseline generation / refresh ---
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
 * Then commit `e2e/demo-screenshot.spec.ts-snapshots/demo-*-chromium-linux.png`.
 * Inspect the diff before committing — make sure every delta is
 * intentional. If the GitHub `ubuntu-latest` runner image diverges from
 * the jammy baseline image enough to fail on font antialiasing, the
 * cleanest fix is to regenerate the baselines from the failing CI run's
 * uploaded actual-PNG artifacts (i.e. on the runner image itself).
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
        // Full-page tolerance matches the repo's full-page precedent
        // (strategy-v2-chart-parity.spec.ts uses 0.05 for its full-page
        // shot, 0.02 for per-panel). The baselines were generated in the
        // playwright jammy Docker image; ±5% absorbs cross-distro font
        // antialiasing vs the ubuntu-latest runner while still catching
        // real regressions (a layout/color/content break far exceeds 5%).
        maxDiffPixelRatio: 0.05,
      });
    });
  }
});
