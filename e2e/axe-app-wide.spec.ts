/**
 * Phase 48 / A11Y-01 — app-wide axe WCAG-AA matrix (route × viewport).
 *
 * Wave 0 SCAFFOLD — plan 04 fills the authed rows + the serious+critical
 * embedded-factsheet filter + the FLOW-01 dual-wiring (this spec into BOTH the
 * ci.yml seeded MA-8 list for authed routes AND the unseeded list for public
 * routes, alongside the HAS_SEED_ENV self-skip below). Until plan 04, this file
 * carries ONE public-route placeholder test that runs unseeded, plus the
 * HAS_SEED_ENV const + route/viewport scaffolding the authed matrix will use.
 *
 * Goal (plan 04): extend the WCAG-AA axe gate from today's 5 focused per-route
 * specs to ALL primary routes (public: /, /security, /for-quants, /browse,
 * /demo; authed: /allocations, strategy-v2, discovery, composer, wizard,
 * factsheet), each scanned at BOTH Desktop (1280×800) and a mobile viewport
 * (375×812, Assumption A3). Standalone routes stay STRICT
 * (`expect(results.violations).toEqual([])`); the embedded factsheet on the
 * composer surface uses the composer-axe GUARD-03 serious+critical filter, NEVER
 * a rule disable.
 *
 * Anti-false-green (W-02 / Pitfall 4): every analyze() is gated behind a visible
 * anchor + an HTTP<400 check so a blank/404/login page fails loud, not hollow-zero.
 */
import { test, expect } from "@playwright/test";
import { buildAxe } from "./helpers/axe";

// FLOW-01 self-skip [place 2] — armed for the AUTHED rows plan 04 adds. When
// the seed env vars are absent the seeded authed describe blocks self-skip
// (the public placeholder below runs unseeded, like reflow-sweep.spec.ts).
// Plan 04 must ALSO add this spec to ci.yml's seeded MA-8 list [place 1] for
// the authed rows and the unseeded list for the public rows, or the gate never
// runs (FLOW-01 burned >=3x).
const HAS_SEED_ENV =
  !!process.env.TEST_SUPABASE_URL &&
  !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

// Public primary routes — each anchored on a VISIBLE content element (never
// generic chrome) so axe fails loud on a blank/404/unhydrated page. Mirrors the
// reflow-sweep.spec.ts public route floor.
const PUBLIC_ROUTES: { path: string; anchor: string }[] = [
  { path: "/", anchor: "h1" },
  { path: "/security", anchor: "main h1" },
  { path: "/for-quants", anchor: "main h1" },
  { path: "/browse", anchor: "main h1" },
  { path: "/demo", anchor: "#editorial-hero-headline" },
];

// Both viewports — every axe check runs at Desktop AND a mobile viewport (375px
// per Assumption A3). Plan 04 drives the full route × viewport matrix.
const VIEWPORTS = [
  { w: 1280, h: 800, name: "Desktop" },
  { w: 375, h: 812, name: "mobile" },
];

test.describe("axe app-wide (A11Y-01) — public scaffold", () => {
  // Wave 0 placeholder: ONE public route proves the harness + anti-false-green
  // gate wiring. Plan 04 expands this into the full PUBLIC_ROUTES × VIEWPORTS
  // loop and adds the seeded authed describe(s) (gated by HAS_SEED_ENV).
  const r = PUBLIC_ROUTES[0];
  const vp = VIEWPORTS[0];

  test(`zero WCAG-AA violations on ${r.path} @ ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    const res = await page.goto(r.path);
    if (res && res.status() >= 400) {
      throw new Error(`${r.path} returned HTTP ${res.status()} — cannot run axe`);
    }
    await expect(page.locator(r.anchor)).toBeVisible({ timeout: 5_000 });
    const results = await buildAxe(page).analyze();
    expect(results.violations).toEqual([]);
  });
});
