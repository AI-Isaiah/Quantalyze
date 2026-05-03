/**
 * Phase 17 / DESIGN-05 — axe-core scan on /admin/csv-status.
 *
 * Asserts zero axe violations on the admin CSV-status page (Phase 15
 * plan 15-07 single-table render at
 * `src/app/(dashboard)/admin/csv-status/page.tsx`). Page is admin-gated;
 * the spec runs only when seed env vars are wired AND the seed helper
 * sets up an admin user. Phase 17 leaves the admin-user seed gap as a
 * follow-up — the spec is authored ahead of full readiness per the
 * test.skip-when-seed-env-absent pattern from
 * `e2e/strategy-v2-axe.spec.ts`.
 *
 * Rule set is locked in `e2e/helpers/axe.ts` → buildAxe() — DO NOT
 * redeclare locally. (See helpers/axe.ts for the actual tag list; this
 * file references the factory only, so rule-set drift is impossible by
 * construction per UI-SPEC §13.5.)
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
  await page.waitForURL(/\/(discovery|strategies|allocations|dashboard|admin)/, {
    timeout: 10_000,
  });
}

test.describe("Phase 17 — admin CSV-status axe (DESIGN-05)", () => {
  test.skip(
    !HAS_SEED_ENV,
    "admin csv-status axe: seed-helper env vars not wired " +
      "(set TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY); " +
      "additionally requires admin-user seed (Phase 17 follow-up — the " +
      "current seedTestAllocator() seeds a regular allocator only, and " +
      "/admin/csv-status redirects non-admin users to /discovery/crypto-sma).",
  );

  test("zero axe violations on /admin/csv-status", async ({ page }) => {
    if (HAS_SEED_ENV) {
      const allocator = await seedTestAllocator();
      await loginViaForm(page, allocator.email, allocator.password);
    }

    await page.goto("/admin/csv-status");

    // ME-02 (Phase 17 review): the wait-for-h1 expectation alone passes
    // even when /admin/csv-status redirects non-admin users to
    // /discovery/crypto-sma (the discovery page also renders an <h1>).
    // That meant a CI environment with the Supabase env vars wired but
    // no admin-user seed would scan the wrong DOM and report a false
    // green. The URL assertion below pins the expected route — if the
    // seed helper only minted a regular allocator the redirect fires
    // and this fails loudly, surfacing the admin-seed gap.
    await expect(page).toHaveURL(/\/admin\/csv-status/, { timeout: 10_000 });

    // The admin csv-status page renders an <h1> via PageHeader (see
    // src/components/layout/PageHeader.tsx:15) and a <table> (page.tsx:79).
    // Belt-and-braces with the URL assertion above (Grok W-02 false-green
    // guard, mirrors discovery-axe.spec.ts:71-77).
    const heading = page.locator("h1");
    await expect(heading).toBeVisible({ timeout: 10_000 });

    const results = await buildAxe(page).analyze();
    expect(results.violations).toEqual([]);
  });
});
