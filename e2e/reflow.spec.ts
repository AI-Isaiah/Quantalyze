import { test } from "@playwright/test";
import { assertNoReflow } from "./helpers/reflow";

/**
 * Phase 44-04 / A11Y-02 — Reflow gate (WCAG 1.4.10) at 320px CSS width.
 *
 * Asserts the public `/security` route does not overflow horizontally
 * (`scrollWidth - clientWidth <= 1px`) at the WCAG-mandated 320px reflow
 * width, anchored on the visible "Security practices" H1 so a blank/404 /
 * unhydrated page fails LOUD instead of false-greening (see assertNoReflow).
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

test.describe("reflow gate (WCAG 1.4.10) @ 320px", () => {
  test("/security does not overflow horizontally at 320px", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
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
