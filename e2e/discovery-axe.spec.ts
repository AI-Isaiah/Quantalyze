/**
 * Phase 14b-07 / A11Y-02 — axe-core scan on /discovery/{slug}.
 *
 * Grok W-02 fix: gate this spec behind DISCOVERY_SLUG (or fall back to a
 * known seeded slug if HAS_SEED_ENV is true). Without the gate, running
 * against an unseeded test DB silently passes against a 404 / empty page,
 * giving a false-green on a route axe never actually scanned.
 *
 * To run locally: set DISCOVERY_SLUG=crypto-sma (or your seeded slug). Or:
 * set TEST_SUPABASE_URL + TEST_SUPABASE_SERVICE_ROLE_KEY (default seed,
 * uses 'crypto-sma' which is the canonical seeded discovery slug per
 * e2e/discovery-sparkline-regression.spec.ts precedent).
 *
 * The defensive sanity gate inside the test (waiting for an h1 / strategy
 * heading to be visible) is the second layer of W-02 protection: even if
 * DISCOVERY_SLUG points at a slug whose page renders an empty grid, the
 * heading check will fail loudly rather than silently pass axe on an
 * empty <main>.
 */
import { test, expect } from "@playwright/test";
import { buildAxe } from "./helpers/axe";
import { seedTestAllocator } from "./helpers/seed-test-project";

const DISCOVERY_SLUG = process.env.DISCOVERY_SLUG ?? "";
const HAS_SEED_ENV =
  !!process.env.TEST_SUPABASE_URL &&
  !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;
const SLUG = DISCOVERY_SLUG || (HAS_SEED_ENV ? "crypto-sma" : "");

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

test.describe("Phase 14b — discovery axe (A11Y-02)", () => {
  test.skip(
    !SLUG,
    "discovery axe: set DISCOVERY_SLUG (or TEST_SUPABASE_URL + " +
      "TEST_SUPABASE_SERVICE_ROLE_KEY for default seed) to run this spec. " +
      "Skipping prevents false-green on empty/404 pages (Grok W-02).",
  );

  test(`zero axe violations on /discovery/${SLUG || "<slug>"}`, async ({
    page,
  }) => {
    // /discovery/* is auth-gated by middleware AND by an accredited-investor
    // gate inside src/app/(dashboard)/discovery/layout.tsx. Without an
    // attested session the route renders the AccreditedInvestorGate (or
    // redirects to /login). PR #108 review flagged this — the spec was
    // silently scanning login-page chrome (or the gate) and reporting
    // landmark-one-main / region violations from those screens, not from
    // discovery itself. seedTestAllocator() now stamps an
    // investor_attestations row so the seeded user clears the gate.
    if (HAS_SEED_ENV) {
      const allocator = await seedTestAllocator();
      await loginViaForm(page, allocator.email, allocator.password);
    }

    await page.goto(`/discovery/${SLUG}`);
    await page.waitForLoadState("networkidle");

    // Sanity gate (Grok W-02): ensure the discovery page actually rendered
    // a strategy / category page, not a 404 / empty state. axe scanning an
    // empty <main> finds zero violations regardless — that's the
    // false-green this gate eliminates.
    const heading = page.locator("h1, h2").first();
    await expect(heading).toBeVisible({ timeout: 5_000 });

    const results = await buildAxe(page).analyze();
    expect(results.violations).toEqual([]);
  });
});
