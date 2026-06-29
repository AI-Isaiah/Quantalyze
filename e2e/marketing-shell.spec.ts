import { test, expect } from "@playwright/test";

/**
 * Phase 51-04 / NAV-04 — `(marketing)` route-group anon canary.
 *
 * The (marketing) Next route group (parens → ZERO URL change) wraps the public
 * marketing/info routes — landing (`/`), `/legal/*`, `/for-quants`, `/security`,
 * `/demo` — in ONE shared server-rendered shell. This canary proves the folder
 * move did NOT regress the public boundary or the single-landmark discipline.
 *
 * For each marketing route, as an ANONYMOUS visitor (no auth), it asserts:
 *   1. status < 400 — the route is anon-reachable, NOT a 307→login (the #512
 *      regression: a public route absent from proxy.ts PUBLIC_ROUTES silently
 *      bounces an anon recipient to /login). The route-contract guard proves
 *      the lockstep at build time; this proves it at runtime.
 *   2. it still resolves at its REQUESTED URL — the route group is folder-only,
 *      so every URL is byte-unchanged (no redirect away to a new path).
 *   3. exactly ONE `<main>` landmark and exactly ONE level-1 heading, both
 *      visible — the shared layout owns chrome only (no second <main>/<h1>),
 *      so each page keeps a single main + single h1 (the duplicate-landmark
 *      axe class JOURNEY-03 caught on /allocations).
 *
 * UNSEEDED / PUBLIC spec — runs against the placeholder-env build, carries NO
 * seed-env self-skip guard at all (mirrors reflow-sweep.spec.ts). FLOW-01
 * dual-wiring (a gate added but never run — burned >=3x): the ci.yml UNSEEDED
 * Playwright-list entry is the single wiring point (place 1); the deliberate
 * ABSENCE of any seed-env / auth dependency (place 2) means there is no second
 * gated list it could be silently dropped from. The seed-env token is
 * intentionally absent from this file so the "no env guard / public" property
 * is provable by a plain grep.
 */

// Curated marketing route floor — every route now under src/app/(marketing)/.
// `/browse` is intentionally EXCLUDED (it is the separate un-gated SEO mirror
// of discovery, kept OUT of the (marketing) group per CONTEXT). Each entry's
// URL must come back byte-unchanged after the folder move.
const MARKETING_ROUTES: { path: string; label: string }[] = [
  { path: "/", label: "landing" },
  { path: "/security", label: "security" },
  { path: "/for-quants", label: "for-quants" },
  { path: "/legal/privacy", label: "legal/privacy" },
  { path: "/legal/terms", label: "legal/terms" },
  { path: "/legal/disclaimer", label: "legal/disclaimer" },
  { path: "/demo", label: "demo" },
  { path: "/demo/founder-view", label: "demo/founder-view" },
];

test.describe("(marketing) route group — anon canary (NAV-04)", () => {
  for (const r of MARKETING_ROUTES) {
    test(`${r.label} (${r.path}) resolves anon at its URL as a single-landmark public page`, async ({
      page,
    }) => {
      const res = await page.goto(r.path);

      // (1) anon-reachable, NOT a 307→login. A redirect to /login would land
      // here with a 2xx on the login page, so we ALSO assert the URL below —
      // the two together pin "public, no auth bounce" (the #512 assertion).
      expect(res, `${r.path} produced no response`).not.toBeNull();
      expect(
        res!.status(),
        `${r.path} returned HTTP ${res!.status()} — expected <400 (public, no 307→login)`,
      ).toBeLessThan(400);

      // (2) still resolves at the REQUESTED URL — the (marketing) group is
      // folder-only, so the move must not redirect any route to a new path,
      // and a public route must not bounce an anon visitor to /login.
      await expect(page).toHaveURL(new RegExp(`${escapeRegExp(r.path)}/?$`));

      // (3) exactly one <main> landmark, visible — the shared layout adds no
      // <main> of its own, so each page owns a single <main>.
      const mains = page.getByRole("main");
      await expect(mains).toHaveCount(1);
      await expect(mains.first()).toBeVisible();

      // (3) exactly one level-1 heading, visible — no duplicate <h1>
      // (the JOURNEY-03 single-landmark discipline).
      const h1s = page.getByRole("heading", { level: 1 });
      await expect(h1s).toHaveCount(1);
      await expect(h1s.first()).toBeVisible();
    });
  }
});

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
