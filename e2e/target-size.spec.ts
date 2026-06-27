import { test, expect } from "@playwright/test";
import { assertTargetSizes } from "./helpers/reflow";
import { seedStrategyWithHistory } from "./helpers/seed-test-project";

/**
 * Phase 44-04 / A11Y-02 — Target-size gate (WCAG 2.5.8) at 320px CSS width.
 *
 * SCOPE (documented, intentional — NOT a silent false-green):
 *   This gate measures ONLY the legal-footer navigation links on /security
 *   (`footer nav[aria-label="Legal"] a` — the LegalFooter "Security / Privacy
 *   / Terms / Risk Disclaimer" links). Those links are built to the
 *   `min-h-[44px]` convention (src/components/legal/LegalFooter.tsx) and are
 *   honestly >= 44x44 px, so the gate is a REAL >= 44px assertion that is
 *   green today.
 *
 * WHY NOT page-level on /security:
 *   /security has many intentionally sub-44px interactive targets at this
 *   phase — the header text links (`py-2` Quantalyze back-link, "For Quants
 *   ->"), inline editorial prose links, the section/sub-section anchor links,
 *   and even the PDF CTA (`h-10` = 40px). A PAGE-LEVEL 44px gate on /security
 *   would NOT be honestly green. The 44px bar is NOT lowered to force green;
 *   instead the selector is scoped to a region that already meets the bar.
 *
 * DEFERRAL (phases 46/48):
 *   App-wide page-level target-size enforcement — bringing the header links,
 *   editorial links, anchor links, and the PDF CTA up to 44px and widening
 *   this gate to the whole page / more routes — is the job of phase 46
 *   (TABLE-01 / responsive rollout) and phase 48 (final a11y verification).
 *   Phase 44's job is to make the gate EXIST, RUN, and be honestly green on a
 *   documented clean scope (SC#1), proving the assertTargetSizes helper works
 *   so phases 45-48 reuse it app-wide.
 *
 * UNSEEDED spec — runs against the placeholder-env build on a public route,
 * NO `HAS_SEED_ENV` self-skip. Wired into the UNSEEDED Playwright list in
 * .github/workflows/ci.yml (FLOW-01 place 1); the absence of an env self-skip
 * is place 2. The H1 anchor + the measured>0 guard in assertTargetSizes mean
 * a blank/404/unhydrated page fails LOUD rather than passing against nothing.
 */

test.describe("target-size gate (WCAG 2.5.8) — /security legal footer", () => {
  test("legal-footer nav links measure >= 44px at 320px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    const res = await page.goto("/security");
    if (res) {
      const status = res.status();
      if (status >= 400) {
        throw new Error(
          `/security returned HTTP ${status} — cannot run target-size gate`,
        );
      }
    }
    // Anchor on the visible H1 (fail loud on blank/404), then measure the
    // scoped legal-footer nav links — the documented honestly-green region.
    await assertTargetSizes(page, "main h1", 'footer nav[aria-label="Legal"] a');
  });
});

/**
 * Phase 47-05 / CHART-01a — chart tap-reveal hit-rect target-size at 320px.
 *
 * Asserts the tap-reveal SVG charts' coarse-pointer interaction layer measures
 * >= 44px (WCAG 2.5.5 / 2.5.8) at 320px on the SEEDED `/factsheet/[id]/v2`
 * route (the route where the in-scope hand-rolled SVG panels mount via
 * FactsheetView — verified mount-point, vs the unseeded /security case above).
 *
 * COARSE-POINTER EMULATION (load-bearing): the Phase-47-03 tap-reveal hit
 * targets are `hidden pointer-coarse:block` SVG <rect>s (StreakDistribution)
 * and a `pointer-coarse:min-h-[44px]` wrapper div (DailyReturnsHeatmap) — they
 * are `display:none` / un-floored on a pointer-FINE context (so the desktop
 * hover path stays byte-identical). Playwright's default Desktop Chrome is
 * pointer:fine, which would render the coarse layer non-measurable (0x0 →
 * skipped → the false-green guard would fire). `test.use({ hasTouch:true,
 * isMobile:true })` makes Chromium report `pointer: coarse`, activating the
 * tap-target layer so this gate measures the REAL touch hit-rect. This is the
 * faithful assertion of the >=44px touch contract Plan 03 built.
 *
 * The DailyReturnsHeatmap calendar wrapper is the primary coarse target: it is
 * ALWAYS rendered (not display:none), carries `role="img"` +
 * `aria-label="Daily-return calendar…"`, and is floored to `min-h-[44px]` on
 * coarse — a single, stable, non-fragile element. MIN_TARGET_PX=44 in
 * e2e/helpers/reflow.ts is NOT lowered; if a target were sub-44 the FIX is
 * Plan 03's hit-rect, never a weakened gate.
 *
 * SEEDED — runs in the ci.yml MA-8 seeded list (FLOW-01 place 1, Task 3) with
 * a `HAS_SEED_ENV` self-skip (place 2). The existing /security case above
 * stays in the UNSEEDED list. Fails loud on HTTP >= 400 / a non-rendered
 * panel before measuring (Pitfall 5).
 */
const HAS_SEED_ENV =
  !!process.env.TEST_SUPABASE_URL &&
  !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

test.describe("target-size gate (WCAG 2.5.5/2.5.8) — chart tap-rects @ 320px (seeded)", () => {
  // Emulate a coarse pointer so the `pointer-coarse:` tap-target layer is
  // present + measurable. Without this the hit-rects are display:none on the
  // default fine-pointer context.
  test.use({ hasTouch: true, isMobile: true });

  test.skip(
    !HAS_SEED_ENV,
    "chart tap-rect target-size: seed-helper env vars not wired " +
      "(set TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY) — " +
      "skipping prevents a false-green against an empty/404 factsheet page " +
      "(W-02). Runs in the seeded MA-8 CI job once the env is present.",
  );

  let strategyId: string;

  test.beforeAll(async () => {
    strategyId = await seedStrategyWithHistory({
      days: 252,
      name: "Phase 47 tap-rect target-size",
    });
  });

  test("DailyReturnsHeatmap tap surface measures >= 44px at 320px (coarse)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    const res = await page.goto(`/factsheet/${strategyId}/v2`);
    if (res && res.status() >= 400) {
      throw new Error(
        `/factsheet/${strategyId}/v2 returned HTTP ${res.status()} — ` +
          "cannot run chart tap-rect target-size gate",
      );
    }
    // The calendar wrapper is the coarse tap surface (role=img +
    // pointer-coarse:min-h-[44px]). Scroll it into view, then measure it.
    const heatmap = page
      .locator("#factsheet-main")
      .getByRole("img", { name: /Daily-return calendar/i })
      .first();
    await heatmap.scrollIntoViewIfNeeded();
    // Anchor on the heatmap itself (fail loud if the panel never rendered),
    // then measure the SAME coarse tap surface — a scoped >=44px assertion.
    await assertTargetSizes(
      page,
      '#factsheet-main [aria-label^="Daily-return calendar"]',
      '#factsheet-main [aria-label^="Daily-return calendar"]',
    );
  });

  test("StreakDistribution tap bars measure >= 44px at 320px (coarse)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    const res = await page.goto(`/factsheet/${strategyId}/v2`);
    if (res && res.status() >= 400) {
      throw new Error(
        `/factsheet/${strategyId}/v2 returned HTTP ${res.status()} — ` +
          "cannot run chart tap-rect target-size gate",
      );
    }
    // The Phase-47-03 per-bar coarse hit-<rect>s live inside the
    // StreakDistribution role=img svg; on a coarse pointer they are
    // display:block. Anchor on the panel (visible), then assert at least one
    // coarse tap-rect is present + >=44px. The widened column (>=68 viewBox
    // units at the ~288/440 scale = ~44 CSS px) is what this proves.
    const streak = page
      .locator("#factsheet-main")
      .getByRole("img", { name: /streak-length distribution/i })
      .first();
    await streak.scrollIntoViewIfNeeded();
    await expect(
      streak,
      "StreakDistribution panel not visible — blank/sub-banner page would false-green",
    ).toBeVisible({ timeout: 15_000 });
    // Measure the coarse tap-<rect>s. They are display:block only under
    // pointer:coarse (emulated above); the assertTargetSizes false-green guard
    // (>=1 measured) fails loud if the coarse layer never activated.
    await assertTargetSizes(
      page,
      '#factsheet-main [aria-label*="streak-length distribution"]',
      '#factsheet-main [aria-label*="streak-length distribution"] rect.pointer-coarse\\:block',
    );
  });
});
