/**
 * Phase 33-03 / JOURNEY-03 — axe-core WCAG-AA scan of the unified composer at
 * /allocations?tab=scenario, covering BOTH the blank-slate front door (the
 * JOURNEY-02 focus-ring CTAs) AND the composed surface INCLUDING the Phase-30
 * graph cards (Returns-distribution + Rolling-metrics).
 *
 * Reuses the EXISTING harness verbatim: buildAxe(page) from ./helpers/axe is
 * already configured `withTags(["wcag2a","wcag2aa","best-practice"])`. NO new
 * dependency, NO jest-axe, NO second harness.
 *
 * WHY two scans + an add-step (the load-bearing correctness fix):
 *   A freshly-seeded allocator has no book and no draft, so the composer renders
 *   its blank-slate branch (`isEmptyState`, ScenarioComposer.tsx:1583) — the
 *   "Start a portfolio" front door, NOT the composed surface. The Phase-30 graph
 *   cards (`blend-returns-distribution` / `blend-rolling`, lines 2076/2126) live
 *   ONLY in the composed branch (after the isEmptyState early-return). So to
 *   honour JOURNEY-03 ("the unified composer + new graphs pass a11y checks") the
 *   spec must DRIVE the composer into composed mode: seed a published strategy,
 *   open the Browse drawer, add it, close the drawer. Only then do the graphs
 *   exist to scan. Scanning the blank-slate alone would silently skip the graphs.
 *
 * Authored-but-skipped pattern matches discovery-axe.spec.ts /
 * strategy-v2-axe.spec.ts: test.skip when TEST_SUPABASE_URL /
 * TEST_SUPABASE_SERVICE_ROLE_KEY are absent so the spec is authored but not
 * CI-blocking until the seed env vars are wired. Skipping is a false-green guard
 * — it prevents axe from silently passing against an empty <main> / login chrome
 * on an unseeded DB.
 *
 * Defense-in-depth against false-green (load-bearing): each analyze() is gated
 * behind a visible-anchor assertion that fails LOUDLY (not a hollow zero) if the
 * intended surface did not render — the "Start a portfolio" heading for the
 * blank slate, and the <h2>Portfolio</h2> + BOTH graph cards for the composed
 * surface.
 */
import { test, expect } from "@playwright/test";
import { buildAxe } from "./helpers/axe";
import {
  seedTestAllocator,
  seedStrategyWithHistory,
} from "./helpers/seed-test-project";

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

  test("zero WCAG-AA violations on /allocations?tab=scenario (blank-slate + composed incl. Phase-30 cards)", async ({
    page,
  }) => {
    // Seed a PUBLISHED strategy with enough history (>warm-up + rolling window)
    // so the Browse drawer has a row to add and the resulting single-strategy
    // blend computes real (non-degenerate) Phase-30 graphs.
    await seedStrategyWithHistory({ days: 400, name: "Composer Axe Fixture" });

    // /allocations is auth-gated by middleware AND by the universal approval
    // gate (src/lib/approval.ts) — an un-verified profile redirects to
    // /pending-approval. seedTestAllocator() stamps a VERIFIED allocator
    // profile + an investor_attestations row, exactly the session the
    // composer route needs to render.
    const allocator = await seedTestAllocator();
    await loginViaForm(page, allocator.email, allocator.password);

    await page.goto("/allocations?tab=scenario");
    await page.waitForLoadState("networkidle");

    // --- Scan 1: blank-slate front door (JOURNEY-02 focus-ring CTAs) ---
    // Sanity gate (W-02): a no-book/no-draft session renders the blank-slate
    // branch. Its "Start a portfolio" heading must be visible — a 404 / empty
    // <main> / login chrome would NOT show it, so axe can't report a hollow zero.
    await expect(
      page.locator("h2", { hasText: "Start a portfolio" }),
    ).toBeVisible({ timeout: 5_000 });

    const blankSlate = await buildAxe(page).analyze();
    expect(blankSlate.violations).toEqual([]);

    // --- Drive into composed mode so the Phase-30 graphs exist to scan ---
    await page.click('button:has-text("Browse strategies")');
    await expect(
      page.locator('[role="dialog"][aria-label="Browse strategies"]'),
    ).toBeVisible({ timeout: 5_000 });
    // Wait for the lazy-loaded catalog, then add the first available strategy.
    const firstAdd = page.locator('[data-testid^="browse-add-"]').first();
    await expect(firstAdd).toBeVisible({ timeout: 10_000 });
    await firstAdd.click();
    // handleAdd() does NOT close the drawer (it tracks a dim effect), so close
    // it explicitly to expose the composed surface behind it.
    await page.click('[aria-label="Close drawer"]');
    await page.waitForLoadState("networkidle");

    // --- Scan 2: composed surface incl. Phase-30 graph cards (JOURNEY-03) ---
    // Sanity gate (W-02): the composed branch renders <h2>Portfolio</h2>
    // alongside the PROJECTED pill — proof isEmptyState flipped false.
    await expect(
      page.locator("h2", { hasText: "Portfolio" }).first(),
    ).toBeVisible({ timeout: 10_000 });

    // BOTH Phase-30 graph cards must be mounted before scanning — adapt the
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

    const composed = await buildAxe(page).analyze();
    expect(composed.violations).toEqual([]);
  });
});
