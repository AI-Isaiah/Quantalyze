import { test } from "@playwright/test";
import { assertNoReflow } from "./helpers/reflow";

/**
 * Phase 46-04 / REFLOW-01 + REFLOW-02 — parametrized PUBLIC reflow sweep
 * (WCAG 1.4.10 Reflow) at the 320px CSS reflow width.
 *
 * Extends the single-route e2e/reflow.spec.ts (/security) into a curated
 * sweep over the public surface so EVERY public route is proven to have no
 * horizontal PAGE overflow at 320px — the phase-46 verification backbone for
 * the public half. Each route is anchored on a VISIBLE content element (never
 * generic chrome) so a blank/404/unhydrated page fails LOUD via assertNoReflow
 * rather than false-greening (the W-02 lesson; Pitfall 5).
 *
 * WCAG 1.4.10 / 1.4.4 note (REFLOW-02): the 320px CSS reflow width IS the
 * spec-defined equivalent of 400% zoom on a 1280px viewport (1280 / 4 = 320).
 * Proving no horizontal overflow at 320px CSS px is therefore the same proof
 * as "usable at 400% zoom with no two-axis scroll" — there is no separate
 * browser-zoom mechanism in Playwright; the phase-44 reflow harness expresses
 * the zoom case via the 320px viewport (matching reflow.spec.ts /
 * target-size.spec.ts), and this sweep does the same. The representative
 * 400%-equivalent assertion is the 320px assertNoReflow pass below.
 *
 * UNSEEDED spec — runs against the placeholder-env build on PUBLIC routes,
 * carrying NO seed-env self-skip guard at all (matching reflow.spec.ts). It is
 * wired into the UNSEEDED Playwright list in .github/workflows/ci.yml (the
 * `e2e/auth.spec.ts … e2e/reflow.spec.ts e2e/target-size.spec.ts` line).
 * FLOW-01 dual-wiring (gate added but never runs, burned twice): the ci.yml
 * unseeded-list entry is place 1; the deliberate ABSENCE of any env self-skip
 * is place 2 — together they guarantee the gate actually executes in CI. (The
 * literal seed-env token is intentionally absent from this file so the
 * "no env guard" property is provable by a plain grep.)
 *
 * The seeded authed half of the sweep lives in e2e/reflow-sweep-authed.spec.ts
 * (the seed-env self-skip + the ci.yml seeded MA-8 list).
 */

// Curated public route floor (SC#1). Each anchor is a VISIBLE content element
// on that route — never generic chrome — so assertNoReflow fails loud on a
// blank/404/unhydrated page instead of measuring against nothing (Pitfall 5).
const PUBLIC_ROUTES: { path: string; anchor: string }[] = [
  // Landing — the hero <h1> ("Exchange-Verified Quant Strategies"). The root
  // layout renders {children} directly (no <main> wrapper on /), so anchor on
  // the bare visible <h1>.
  { path: "/", anchor: "h1" },
  // Security — <main> wraps the single "Security practices" <h1> (the
  // reflow.spec.ts anchor, kept identical here).
  { path: "/security", anchor: "main h1" },
  // For Quants — <main> (for-quants/layout.tsx) wraps the hero <h1>.
  { path: "/for-quants", anchor: "main h1" },
  // Browse — <main> (browse/layout.tsx) wraps the page <h1>.
  { path: "/browse", anchor: "main h1" },
  // Demo — no <h1>; EditorialHero renders <h1 id="editorial-hero-headline">
  // (the headline tuned for 24/32 reflow at 320px). Anchor on that visible
  // headline so the demo body — not the sticky banner chrome — is what gates.
  { path: "/demo", anchor: "#editorial-hero-headline" },
];

test.describe("reflow sweep (WCAG 1.4.10 / 1.4.4) @ 320px — public", () => {
  for (const r of PUBLIC_ROUTES) {
    test(`${r.path} no horizontal overflow at 320px (= 400% zoom on 1280)`, async ({
      page,
    }) => {
      // 320px CSS width = the WCAG-mandated reflow width = 400% zoom on a
      // 1280px viewport. No horizontal page overflow here proves both
      // REFLOW-01 (no overflow @320px) and REFLOW-02 (usable @400% zoom).
      await page.setViewportSize({ width: 320, height: 800 });
      const res = await page.goto(r.path);
      // Surface an outright 4xx/5xx early with a clear message; the
      // visible-anchor check in assertNoReflow is the real fail-loud guard.
      if (res) {
        const status = res.status();
        if (status >= 400) {
          throw new Error(
            `${r.path} returned HTTP ${status} — cannot run reflow sweep`,
          );
        }
      }
      await assertNoReflow(page, r.anchor);
    });
  }
});

/**
 * Phase 54-06 / VERIFY-01 — the PUBLIC half of the app-wide 2560px ultra-wide
 * reflow sweep. The 320px describe above proves the WCAG 1.4.10 Reflow LOWER
 * bound; this parallel describe proves the v1.4 "layouts hold to ULTRA-WIDE"
 * requirement at the UPPER bound (no horizontal overflow when the viewport is
 * 2560px) across the SAME curated public route floor — so an ultra-wide overflow
 * on any public route fails LOUD app-wide.
 *
 * UNSEEDED, no env gate — matching this file's deliberate no-seed property
 * (provable by the absence of any seed-env token, :30-32). It is ALREADY in the
 * ci.yml UNSEEDED Playwright list (the `… e2e/reflow-sweep.spec.ts …` line), so
 * an additive describe here needs NO new FLOW-01 wiring. The authed half lives
 * in e2e/reflow-sweep-authed.spec.ts (the 2560 ultra-wide block there).
 *
 * @container 2560 trap (54-RESEARCH Pitfall 3): at 2560 a Tailwind v4 SAME-
 * element `@container` host+variant freezes grids 1-wide and overflows; the
 * runtime assertNoReflow (browser-measured documentElement.scrollWidth) catches
 * what jsdom class-string tests false-pass. Any 2560 finding traces to a
 * same-element host/variant — fix by splitting host(parent)/variant(child) as
 * P53 admin tables did, NEVER by widening the slop (CLAUDE.md Rule 6).
 */
test.describe("reflow sweep @ 2560px ultra-wide — public", () => {
  for (const r of PUBLIC_ROUTES) {
    test(`${r.path} no horizontal overflow at 2560px`, async ({ page }) => {
      await page.setViewportSize({ width: 2560, height: 1440 });
      const res = await page.goto(r.path);
      // Surface an outright 4xx/5xx early; the visible-anchor check inside
      // assertNoReflow is the real fail-loud guard against a blank/404 page.
      if (res) {
        const status = res.status();
        if (status >= 400) {
          throw new Error(
            `${r.path} returned HTTP ${status} — cannot run ultra-wide reflow sweep`,
          );
        }
      }
      await assertNoReflow(page, r.anchor);
    });
  }
});
