/**
 * Phase 50 / UI-03 — axe-core scan on /admin/compute-jobs.
 *
 * Asserts zero axe violations on the admin compute-jobs page after the
 * strangler pilot migrated its `ComputeJobsTable` client component
 * (`src/components/admin/ComputeJobsTable.tsx`) off raw
 * `<button>`/`<table>`/`<select>`/`<input>` onto the Button / Table /
 * Field / Select primitives. The page is admin-gated; this spec runs only
 * when seed env vars are wired AND the seed helper sets up an admin user.
 * Like the analog `admin-csv-status-axe.spec.ts`, the admin-user seed is a
 * follow-up — the spec is authored ahead of full readiness per the
 * test.skip-when-seed-env-absent pattern. The URL-pin guard below makes the
 * spec fail LOUDLY (not false-green) if only a regular allocator is seeded
 * and `/admin/compute-jobs` redirects to `/discovery/crypto-sma`.
 *
 * Rule set is locked in `e2e/helpers/axe.ts` → buildAxe() — DO NOT
 * redeclare locally. (See helpers/axe.ts for the actual tag list; this
 * file references the factory only, so rule-set drift is impossible by
 * construction per UI-SPEC §13.5.)
 *
 * FLOW-01: this seed-gated spec is registered in BOTH (a) the
 * `.github/workflows/ci.yml` seeded MA-8 `npx playwright test` list AND
 * (b) its own self-skip const below — so when the admin seed lands it runs
 * in CI without re-tripping the FLOW-01 wiring trap.
 *
 * 50-REVIEW (red-team): it is wired into ci.yml but additionally gated on
 * `HAS_ADMIN_SEED` (currently `false`) so it SKIPS cleanly in the seeded CI
 * job rather than running permanently-RED. Without this gate the seeded `e2e`
 * job (where `HAS_SEED_ENV` is true) would NOT skip — it would seed a regular
 * allocator, hit the non-admin redirect, and fail the URL-pin deterministically
 * on every run, eroding the e2e signal. Phase 54 / VERIFY-04 (admin axe under a
 * hermetic seeded DB) flips `HAS_ADMIN_SEED` once an admin-user seed exists. The
 * migrated ComputeJobsTable's a11y is covered now by its semantic-DOM unit test.
 */
import { test, expect } from "@playwright/test";
import { buildAxe } from "./helpers/axe";
import { seedTestAllocator } from "./helpers/seed-test-project";

const HAS_SEED_ENV =
  !!process.env.TEST_SUPABASE_URL &&
  !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

// Gated OFF until Phase 54 / VERIFY-04 provides an admin-user seed.
// seedTestAllocator() mints a regular allocator, and /admin/compute-jobs
// redirects non-admins — so running this in CI today is a guaranteed RED, not
// real coverage. Flip to a real admin-seed check (e.g. seedTestAdmin) in P54.
const HAS_ADMIN_SEED = false;

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

test.describe("Phase 50 — admin compute-jobs axe (UI-03)", () => {
  test.skip(
    !HAS_SEED_ENV || !HAS_ADMIN_SEED,
    "admin compute-jobs axe: requires seed-helper env vars " +
      "(TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY) AND an admin-user " +
      "seed. seedTestAllocator() mints a regular allocator only, and " +
      "/admin/compute-jobs redirects non-admins to /discovery/crypto-sma, so " +
      "the spec is gated OFF (HAS_ADMIN_SEED=false) until Phase 54 / VERIFY-04 " +
      "lands an admin seed — skipping here rather than running permanently-RED.",
  );

  test("zero axe violations on /admin/compute-jobs", async ({ page }) => {
    if (HAS_SEED_ENV) {
      const allocator = await seedTestAllocator();
      await loginViaForm(page, allocator.email, allocator.password);
    }

    await page.goto("/admin/compute-jobs");

    // False-green guard: the wait-for-h1 expectation alone passes even when
    // /admin/compute-jobs redirects a non-admin user to /discovery/crypto-sma
    // (the discovery page also renders an <h1>). A CI environment with the
    // Supabase env vars wired but no admin-user seed would otherwise scan the
    // wrong DOM and report a false green. The URL assertion pins the expected
    // route — if the seed helper only minted a regular allocator the redirect
    // fires and this fails loudly, surfacing the admin-seed gap. Mirrors
    // admin-csv-status-axe.spec.ts.
    await expect(page).toHaveURL(/\/admin\/compute-jobs/, { timeout: 10_000 });

    // The admin compute-jobs page renders an <h1> via PageHeader and the
    // migrated ComputeJobsTable (a semantic <table> via the Table primitive).
    // Belt-and-braces with the URL assertion above (false-green guard).
    const heading = page.locator("h1");
    await expect(heading).toBeVisible({ timeout: 10_000 });

    const results = await buildAxe(page).analyze();
    expect(results.violations).toEqual([]);
  });
});
