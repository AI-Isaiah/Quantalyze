/**
 * Phase 33-03 / JOURNEY-03 — axe-core WCAG-AA scan on the unified composer at
 * /allocations?tab=scenario, INCLUDING the Phase-30 graph cards
 * (Returns-distribution + Rolling-metrics).
 *
 * Reuses the EXISTING harness verbatim: buildAxe(page) from ./helpers/axe is
 * already configured `withTags(["wcag2a","wcag2aa","best-practice"])`. NO new
 * dependency, NO jest-axe, NO second harness.
 *
 * Authored-but-skipped pattern matches discovery-axe.spec.ts /
 * strategy-v2-axe.spec.ts: test.skip when TEST_SUPABASE_URL /
 * TEST_SUPABASE_SERVICE_ROLE_KEY are absent so the spec is authored but not
 * CI-blocking until the seed env vars are wired. Skipping is the W-02
 * false-green guard — it prevents axe from silently passing against an empty
 * <main> / login chrome on an unseeded DB.
 *
 * Defense-in-depth against false-green (load-bearing): even with seed env
 * present, the test refuses to scan until (a) the composer body heading is
 * visible (NOT a 404 / login chrome) AND (b) BOTH Phase-30 graph cards are
 * visible. axe scanning an empty <main> finds zero violations regardless;
 * these gates fail loudly rather than report a hollow pass.
 *
 * Extend, don't duplicate: the standalone charts already have coverage in
 * strategy-v2-axe.spec.ts. This spec scans the COMPOSER surface as a whole
 * (the cards as the composer hosts them), it does not re-assert the
 * standalone-chart panels.
 *
 * To run locally: set TEST_SUPABASE_URL + TEST_SUPABASE_SERVICE_ROLE_KEY
 * (the seedTestAllocator service-role credentials for the test project), then
 * `npx playwright test e2e/composer-axe.spec.ts`.
 */
import { test, expect } from "@playwright/test";
import { buildAxe } from "./helpers/axe";
import { seedTestAllocator } from "./helpers/seed-test-project";

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
    timeout: 10000,
  });
}

test.describe("Phase 33 — composer axe (JOURNEY-03)", () => {
  test.skip(
    !HAS_SEED_ENV,
    "composer axe: seed-helper env vars not wired " +
      "(set TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY) — " +
      "Skipping prevents false-green on empty/404/login pages (W-02). " +
      "The live WCAG-AA scan runs in CI / /qa once seed env is present.",
  );

  test("zero WCAG-AA violations on /allocations?tab=scenario incl. Phase-30 cards", async ({
    page,
  }) => {
    // /allocations is auth-gated by middleware AND by the universal approval
    // gate (src/lib/approval.ts) — an un-verified profile redirects to
    // /pending-approval. seedTestAllocator() stamps a VERIFIED allocator
    // profile + an investor_attestations row, exactly the session the
    // composer route needs to render.
    const allocator = await seedTestAllocator();
    await loginViaForm(page, allocator.email, allocator.password);

    await page.goto("/allocations?tab=scenario");
    await page.waitForLoadState("networkidle");

    // Sanity gate (W-02): the composer composition body must have rendered —
    // its <h2>Portfolio</h2> sits alongside the PROJECTED pill + entry-mode
    // radiogroup. A 404 / empty <main> / login chrome would NOT show it, so
    // this fails loudly rather than letting axe report a hollow zero on an
    // empty page.
    await expect(
      page.locator("h2", { hasText: "Portfolio" }).first(),
    ).toBeVisible({ timeout: 5_000 });

    // Ensure BOTH Phase-30 graph cards mounted before scanning — adapt the
    // strategy-v2-axe scroll-each-card-ready idiom. axe false-greens on an
    // empty <main>; gating on the cards keeps the scan honest about the
    // surface JOURNEY-03 actually covers.
    await page
      .locator('[data-panel="blend-returns-distribution"]')
      .scrollIntoViewIfNeeded();
    await expect(
      page.locator('[data-panel="blend-returns-distribution"]'),
    ).toBeVisible({ timeout: 10_000 });

    await page.locator('[data-panel="blend-rolling"]').scrollIntoViewIfNeeded();
    await expect(page.locator('[data-panel="blend-rolling"]')).toBeVisible({
      timeout: 10_000,
    });

    const results = await buildAxe(page).analyze();
    expect(results.violations).toEqual([]);
  });
});
