/**
 * Phase 48 / A11Y-01 — app-wide axe WCAG-AA matrix (route × viewport).
 *
 * ONE parametrized spec that extends the WCAG-AA axe gate from the 5 focused
 * per-route specs (composer-axe / strategy-v2-axe / discovery-axe / wizard-axe /
 * admin-csv-status-axe — all LEFT IN PLACE) to ALL primary routes scanned at
 * BOTH Desktop (1280×800) and a mobile viewport (375×812, Assumption A3):
 *
 *   PUBLIC (run UNSEEDED, no skip): /, /security, /for-quants, /browse, /demo
 *   AUTHED (HAS_SEED_ENV self-skip): /allocations, /strategy/[id]/v2,
 *           /discovery/[slug], /strategies/new/wizard
 *   EMBEDDED-FACTSHEET (HAS_SEED_ENV self-skip, scoped serious+critical):
 *           /allocations?tab=scenario (the composer surface that FOLDS the real
 *           factsheet body — composer-axe GUARD-03 precedent, L208-212)
 *
 * STRICT vs SCOPED (D-Area-3, RESEARCH Assumption A2):
 *   - Standalone routes (public + the authed standalone routes ABOVE, including
 *     standalone /factsheet/[id]/v2 which strategy-v2-axe / the focused specs
 *     already prove green with ALL impacts) stay STRICT:
 *     expect(results.violations).toEqual([]).
 *   - ONLY the EMBEDDED factsheet on the composer surface uses the scoped
 *     serious+critical filter — the composer page-level <main> legitimately
 *     nests the factsheet's own complementary/region landmarks, so the
 *     page-level landmark BEST-PRACTICE rules (all "moderate") fire on that
 *     legitimate nesting. Every rule still RUNS (NO rule disabled); only
 *     serious/critical gate. This mirrors composer-axe.spec.ts:208-212 exactly.
 *
 * Anti-false-green (W-02 / Pitfall 4): every analyze() is gated behind an
 * HTTP<400 check + a visible-anchor assertion so a blank/404/login page fails
 * loud, not hollow-zero.
 *
 * CI WIRING (public-only): the public describe runs UNSEEDED and this spec is
 * wired ONLY into the ci.yml UNSEEDED Playwright list — its public route ×
 * viewport matrix is the green, hermetic deliverable. The authed + embedded
 * describes are HAS_SEED_ENV-gated and self-skip without seed env, so they are
 * DORMANT in CI by design: the seeded MA-8 invocation shares ONE test database
 * across all specs and is NOT hermetic for a broad authed seeding matrix —
 * running this spec there regressed three other behaviours (it published a
 * non-example strategy into the crypto-sma category that
 * discovery-hide-examples-default asserts is empty; its public rows re-ran
 * against the real-test-Supabase rebuild and 500'd /demo; and the polluted DB
 * produced spurious wizard axe findings the focused wizard-axe — same surface,
 * same rules — does NOT see). Authed-route a11y stays covered by the focused
 * MA-8 axe specs (discovery-axe / strategy-v2-axe / composer-axe / wizard-axe).
 * Re-enabling the authed/mobile rows needs a hermetic per-spec seeded DB (TODO),
 * NOT the shared MA-8 invocation. The describes below are retained for that.
 */
import { test, expect } from "@playwright/test";
import { buildAxe } from "./helpers/axe";
import {
  seedTestAllocator,
  seedStrategyWithHistory,
  seedBridgeCandidate,
} from "./helpers/seed-test-project";

// FLOW-01 self-skip [place 2] — armed for the AUTHED + EMBEDDED rows. When the
// seed env vars are absent those describe blocks self-skip; the public describe
// below runs unseeded (like reflow-sweep.spec.ts). Plan 04 also adds this spec
// to ci.yml's seeded MA-8 list [place 1] for the authed rows and the unseeded
// list for the public rows (FLOW-01 burned >=3x).
const HAS_SEED_ENV =
  !!process.env.TEST_SUPABASE_URL &&
  !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

async function loginViaForm(
  page: import("@playwright/test").Page,
  email: string,
  password: string,
) {
  await page.goto("/login");
  await page.fill('input[name="email"], input[placeholder*="email" i]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL(/\/(discovery|strategies|allocations|dashboard)/, {
    timeout: 10_000,
  });
}

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

// Three viewports — every axe check runs at Desktop, a mobile viewport (375px
// per Assumption A3), AND the 2560px ultra-wide upper bound (Phase 54 /
// VERIFY-01). This is the route × viewport matrix. The three for-loops below
// (public, authed, embedded) iterate this const, so adding the ultrawide row
// fans EVERY scan out to 2560 automatically — no per-loop edit needed. Only the
// PUBLIC describe runs unseeded in CI, so this widens the public matrix to 2560
// today; the authed + embedded 2560 rows stay HAS_SEED_ENV-gated and activate
// with VERIFY-02 in Plan 54-08 (un-skipping those describes into the seeded
// MA-8 job is that plan's work, NOT this matrix widening).
const VIEWPORTS = [
  { w: 1280, h: 800, name: "Desktop" },
  { w: 375, h: 812, name: "mobile" },
  { w: 2560, h: 1440, name: "ultrawide" },
] as const;

// --- PUBLIC matrix (UNSEEDED — runs in both CI jobs; cheap overlap intended) ---
test.describe("axe app-wide (A11Y-01) — public routes", () => {
  for (const r of PUBLIC_ROUTES) {
    for (const vp of VIEWPORTS) {
      test(`zero WCAG-AA violations on ${r.path} @ ${vp.name}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: vp.w, height: vp.h });
        const res = await page.goto(r.path);
        if (res && res.status() >= 400) {
          throw new Error(
            `${r.path} returned HTTP ${res.status()} — cannot run axe`,
          );
        }
        // Anti-false-green: a 404/empty <main> would NOT show this anchor, so a
        // hollow zero is impossible — the scan only runs on a real page.
        await expect(page.locator(r.anchor)).toBeVisible({ timeout: 5_000 });
        const results = await buildAxe(page).analyze();
        // Standalone public route → STRICT (all impacts).
        expect(results.violations).toEqual([]);
      });
    }
  }
});

// --- AUTHED standalone matrix (SEEDED — STRICT, all impacts) ---
test.describe("axe app-wide (A11Y-01) — authed standalone routes", () => {
  test.skip(
    !HAS_SEED_ENV,
    "axe app-wide (authed): seed-helper env vars not wired " +
      "(set TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY) — " +
      "Skipping prevents false-green on empty/404/login pages (W-02). " +
      "Runs in the seeded MA-8 CI job once the env is present.",
  );

  for (const vp of VIEWPORTS) {
    test(`zero WCAG-AA violations on /allocations @ ${vp.name}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      const allocator = await seedTestAllocator();
      await loginViaForm(page, allocator.email, allocator.password);

      const res = await page.goto("/allocations");
      if (res && res.status() >= 400) {
        throw new Error(`/allocations returned HTTP ${res.status()}`);
      }
      // A no-book seed renders the EmptyState ("connect an exchange") branch —
      // a real, scannable authed surface (NOT a 404/login). Anchor on its
      // visible heading so a redirect-to-login fails loud instead of hollow.
      await expect(page.locator("main h1, h1, h2").first()).toBeVisible({
        timeout: 10_000,
      });
      const results = await buildAxe(page).analyze();
      expect(results.violations).toEqual([]);
    });

    test(`zero WCAG-AA violations on /strategy/[id]/v2 @ ${vp.name}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      const strategyId = await seedStrategyWithHistory({
        days: 365,
        name: "axe-app-wide strategy-v2",
      });
      const allocator = await seedTestAllocator();
      await loginViaForm(page, allocator.email, allocator.password);

      const res = await page.goto(`/strategy/${strategyId}/v2?strategy_v2=on`);
      if (res && res.status() >= 400) {
        throw new Error(
          `/strategy/${strategyId}/v2 returned HTTP ${res.status()}`,
        );
      }
      // The eager headline-equity panel proves the v2 route rendered (not a
      // 404/login). Mirrors strategy-v2-axe's per-panel readiness gate.
      await expect(
        page.locator('section[data-panel="headline-equity"]'),
      ).toBeVisible({ timeout: 15_000 });
      const results = await buildAxe(page).analyze();
      expect(results.violations).toEqual([]);
    });

    test(`zero WCAG-AA violations on /discovery/[slug] @ ${vp.name}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      // Seed a published strategy in the canonical crypto-sma category so the
      // discovery page renders a real grid (not empty-state); mirrors
      // discovery-axe's seeded path.
      await seedBridgeCandidate({ categorySlug: "crypto-sma" });
      const allocator = await seedTestAllocator();
      await loginViaForm(page, allocator.email, allocator.password);

      const res = await page.goto("/discovery/crypto-sma");
      if (res && res.status() >= 400) {
        throw new Error(`/discovery/crypto-sma returned HTTP ${res.status()}`);
      }
      await expect(page.locator("h1, h2").first()).toBeVisible({
        timeout: 10_000,
      });
      const results = await buildAxe(page).analyze();
      expect(results.violations).toEqual([]);
    });

    test(`zero WCAG-AA violations on /strategies/new/wizard @ ${vp.name}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      const allocator = await seedTestAllocator();
      await loginViaForm(page, allocator.email, allocator.password);

      const res = await page.goto("/strategies/new/wizard");
      if (res && res.status() >= 400) {
        throw new Error(`/strategies/new/wizard returned HTTP ${res.status()}`);
      }
      // ME-02 false-green guard (mirrors wizard-axe.spec.ts:69): pin the URL so
      // the scan runs on the wizard, not whatever the login redirect lands on.
      await expect(page).toHaveURL(/\/strategies\/new\/wizard(?!\/csv)/, {
        timeout: 10_000,
      });
      await expect(
        page.locator('[data-testid="wizard-exchange-binance"]'),
      ).toBeVisible({ timeout: 10_000 });
      const results = await buildAxe(page).analyze();
      expect(results.violations).toEqual([]);
    });
  }
});

// --- EMBEDDED factsheet (composer) matrix (SEEDED — scoped serious+critical) ---
// The composer at /allocations?tab=scenario FOLDS the real factsheet body onto
// its page-level <main>; the factsheet's own complementary/region landmarks
// legitimately nest there, firing the page-level landmark BEST-PRACTICE rules
// (all "moderate"). Per D-Area-3 / Assumption A2 + the composer-axe GUARD-03
// precedent (composer-axe.spec.ts:208-212), the EMBEDDED surface gates on
// serious+critical ONLY (every rule still RUNS, NO rule disabled). Standalone
// /factsheet/[id]/v2 stays STRICT — it is already proven green with ALL impacts
// by the focused specs and is intentionally NOT re-scanned here.
test.describe("axe app-wide (A11Y-01) — embedded factsheet (composer, serious+critical)", () => {
  test.skip(
    !HAS_SEED_ENV,
    "axe app-wide (embedded factsheet): seed-helper env vars not wired " +
      "(set TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY) — " +
      "Skipping prevents false-green on empty/404/login pages (W-02). " +
      "Runs in the seeded MA-8 CI job once the env is present.",
  );

  for (const vp of VIEWPORTS) {
    test(`zero serious+critical WCAG-AA on /allocations?tab=scenario (composed) @ ${vp.name}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      // A published strategy with enough history so the Browse drawer has a row
      // to add and the composed surface folds the real factsheet body.
      await seedStrategyWithHistory({
        days: 400,
        name: "axe-app-wide composer fixture",
      });
      const allocator = await seedTestAllocator();
      await loginViaForm(page, allocator.email, allocator.password);

      const res = await page.goto("/allocations?tab=scenario");
      if (res && res.status() >= 400) {
        throw new Error(`/allocations?tab=scenario returned HTTP ${res.status()}`);
      }
      await page.waitForLoadState("networkidle");

      // Drive the composer into composed mode (mirrors composer-axe.spec.ts):
      // a no-book/no-draft session renders the blank-slate front door; the real
      // factsheet body only folds in once a strategy is added.
      await expect(
        page.locator("h2", { hasText: "Start a portfolio" }),
      ).toBeVisible({ timeout: 5_000 });
      await page.click('button:has-text("Browse strategies")');
      await expect(
        page.locator('[role="dialog"][aria-label="Browse strategies"]'),
      ).toBeVisible({ timeout: 5_000 });
      const firstAdd = page.locator('[data-testid^="browse-add-"]').first();
      await expect(firstAdd).toBeVisible({ timeout: 10_000 });
      await firstAdd.click();
      await page.click('[aria-label="Close drawer"]');
      await page.waitForLoadState("networkidle");

      // Anti-false-green: gate on the composed <h2>Portfolio</h2> AND the folded
      // real factsheet body (#factsheet-main) so a body that failed to mount
      // fails loud rather than hollow-zeroing.
      await expect(
        page.locator("h2", { hasText: "Portfolio" }).first(),
      ).toBeVisible({ timeout: 10_000 });
      await page.locator('[id="factsheet-main"]').scrollIntoViewIfNeeded();
      await expect(page.locator('[id="factsheet-main"]')).toBeVisible({
        timeout: 10_000,
      });

      // EMBEDDED surface → scoped serious+critical filter (every rule RUNS; NO
      // rule disabled). Standalone routes above stay STRICT.
      const results = await buildAxe(page).analyze();
      const blocking = results.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      );
      expect(blocking).toEqual([]);
    });
  }
});
