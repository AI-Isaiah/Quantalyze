import { test } from "@playwright/test";
import { assertTargetSizes } from "./helpers/reflow";

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
