import { expect, test } from "@playwright/test";
import { assertNoReflow } from "./helpers/reflow";

/**
 * Phase 44-04 / A11Y-02 — Reflow gate (WCAG 1.4.10) at the 390px floor.
 *
 * Asserts the public `/security` route does not overflow horizontally
 * (`scrollWidth - clientWidth <= 1px`) at 390px, anchored on the visible
 * "Security practices" H1 so a blank/404 / unhydrated page fails LOUD
 * instead of false-greening (see assertNoReflow).
 *
 * Founder decision 2026-09-27: 390px (iPhone 12) is the narrowest supported
 * width; 320px and 400% zoom are deliberately not required. The corrected
 * helper measures `#main-content`, so a 320px run would demand 320-only
 * fixes nobody asked for.
 *
 * UNSEEDED spec — runs against the placeholder-env build on a public route,
 * with NO `HAS_SEED_ENV` / `test.skip(!process.env.TEST_SUPABASE_*)` guard.
 * It is wired into the UNSEEDED Playwright list in .github/workflows/ci.yml
 * (the `auth.spec.ts e2e/smoke.spec.ts ...` line), modeled on
 * demo-public.spec.ts. FLOW-01 (gate added but never runs, burned twice):
 * the ci.yml list entry is place 1; the absence of any env self-skip is
 * place 2 — together they guarantee the gate actually executes in CI.
 *
 * Reusable beyond /security: assertNoReflow takes any route + visible anchor,
 * so phases 45-48 reuse it app-wide.
 */

test.describe("reflow gate (WCAG 1.4.10) @ 390px", () => {
  test("/security does not overflow horizontally at 390px", async ({
    page,
  }) => {
    // Founder decision 2026-09-27: 390px floor, not 320px.
    await page.setViewportSize({ width: 390, height: 800 });
    const res = await page.goto("/security");
    // Sanity: the route resolved (the visible-anchor check in assertNoReflow
    // is the real fail-loud guard, this just surfaces an outright 5xx early).
    if (res) {
      // status() is null only for about:blank-style navigations; on a real
      // goto it is the HTTP status. A 4xx/5xx here means the anchor check
      // below will fail loud anyway, but assert early for a clearer message.
      const status = res.status();
      if (status >= 400) {
        throw new Error(`/security returned HTTP ${status} — cannot run reflow gate`);
      }
    }
    // Anchor on the visible level-1 "Security practices" heading. <main> wraps
    // the single <h1> (src/app/security/page.tsx), so `main h1` resolves it
    // unambiguously; the helper asserts it visible before measuring.
    await assertNoReflow(page, "main h1");
  });
});

/**
 * Phase 170 T0 — server-free self-test of assertNoReflow. Inline HTML only
 * (page.setContent, no navigation, no seed) so the gate's two directions are
 * proven in Chromium without a server: a wide flex child inside a fake
 * #main-content must throw even when documentElement does not overflow, and
 * content clipped inside a bounded overflow-x auto region must not.
 */
const FIXTURE_SHELL = `<!DOCTYPE html>
<html style="height:100%">
  <head><meta charset="utf-8"></head>
  <body style="height:100%;margin:0">
    <div class="shell" style="display:flex;height:100%">
      <main id="main-content" style="flex:1 1 0%;overflow-y:auto;min-width:0">
        <h1 id="fixture-anchor">Fixture</h1>
        PLACEHOLDER
      </main>
    </div>
  </body>
</html>`;

const WIDE_ROW =
  '<div style="display:flex;flex-wrap:nowrap"><div style="flex:0 0 800px;width:800px;height:40px">wide</div></div>';

test.describe("assertNoReflow helper self-test (Phase 170 T0)", () => {
  test.describe.configure({ timeout: 30_000 });

  test("red fixture: wide flex child inside #main-content rejects with main= and an offender", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.setContent(FIXTURE_SHELL.replace("PLACEHOLDER", WIDE_ROW));
    await expect(assertNoReflow(page, "#fixture-anchor")).rejects.toThrow(
      /main=\d+[\s\S]*offender=\S+/,
    );
  });

  test("green fixture: 800px content inside a bounded overflow-x auto region resolves", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    // A contained scroller is not a page overflow. The 800px row sticks out
    // of a max-width:100% overflow-x:auto box, and that box's right edge
    // stays inside main, so neither scroller overflows and the helper
    // resolves. The row is clipped, not a page offender.
    const contained =
      '<div style="max-width:100%;overflow-x:auto">' + WIDE_ROW + "</div>";
    await page.setContent(FIXTURE_SHELL.replace("PLACEHOLDER", contained));
    await assertNoReflow(page, "#fixture-anchor");
  });

  test("document fixture: body-level 800px element with no #main-content rejects with doc=", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.setContent(`<!DOCTYPE html>
<html>
  <head><meta charset="utf-8"></head>
  <body style="margin:0">
    <h1 id="fixture-anchor">Fixture</h1>
    <div style="width:800px;height:40px">wide</div>
  </body>
</html>`);
    await expect(assertNoReflow(page, "#fixture-anchor")).rejects.toThrow(
      /doc=/,
    );
  });
});
