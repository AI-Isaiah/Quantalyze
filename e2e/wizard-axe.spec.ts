/**
 * Phase 17 / DESIGN-05 — axe-core scan on /strategies/new/wizard.
 *
 * Asserts zero axe violations on the wizard for both `?source=` branches:
 *   - default (api branch — 4 steps: select / connect / sync / submit)
 *   - ?source=csv (csv branch — 3 steps: upload / preview / submit)
 *
 * Mirrors the test.skip-when-seed-env-absent pattern from
 * `e2e/strategy-v2-axe.spec.ts` so the spec is authored without being
 * CI-blocking until the seed env vars (TEST_SUPABASE_URL +
 * TEST_SUPABASE_SERVICE_ROLE_KEY) are wired.
 *
 * Rule set is locked in `e2e/helpers/axe.ts` → buildAxe() — DO NOT
 * redeclare locally. (See helpers/axe.ts for the actual tag list; this
 * file references the factory only, so rule-set drift is impossible by
 * construction per UI-SPEC §13.5.)
 *
 * Auth: the wizard lives behind the (dashboard) route group, so an
 * authenticated session is required. Mirrors the inline loginViaForm
 * helper from `e2e/discovery-axe.spec.ts` (no shared helper exists yet
 * in `e2e/helpers/`). When the seed env vars are absent this spec is
 * skipped entirely; when present, a fresh allocator is seeded and signed
 * in before each axe pass.
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
    timeout: 10_000,
  });
}

test.describe("Phase 17 — wizard axe (DESIGN-05)", () => {
  test.skip(
    !HAS_SEED_ENV,
    "wizard axe: seed-helper env vars not wired " +
      "(set TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY).",
  );

  test("zero axe violations on /strategies/new/wizard (api branch)", async ({
    page,
  }) => {
    if (HAS_SEED_ENV) {
      const allocator = await seedTestAllocator();
      await loginViaForm(page, allocator.email, allocator.password);
    }

    await page.goto("/strategies/new/wizard");

    // ME-02 false-green guard (mirrors admin-csv-status-axe.spec.ts:66).
    // The data-testid wait alone passes if some other authenticated route
    // also happens to render the same testid. Pinning the URL ensures the
    // axe scan runs on the Phase 17 wizard surface, not on whatever the
    // login redirect lands on.
    await expect(page).toHaveURL(/\/strategies\/new\/wizard(?!\/csv)/, {
      timeout: 10_000,
    });

    // Wait for the broker selector grid to render. The 3 active cards each
    // carry `data-testid="wizard-exchange-${id}"` per Phase 15 §6 row 8 (see
    // src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx:235).
    // Binance is the second card; if all three are mounted the first will
    // also be visible — picking one is enough to gate the scan.
    await expect(
      page.locator('[data-testid="wizard-exchange-binance"]'),
    ).toBeVisible({ timeout: 10_000 });

    const results = await buildAxe(page).analyze();
    expect(results.violations).toEqual([]);
  });

  test("zero axe violations on /strategies/new/wizard?source=csv (csv branch)", async ({
    page,
  }) => {
    if (HAS_SEED_ENV) {
      const allocator = await seedTestAllocator();
      await loginViaForm(page, allocator.email, allocator.password);
    }

    await page.goto("/strategies/new/wizard?source=csv");

    // ME-02 false-green guard (mirrors admin-csv-status-axe.spec.ts:66).
    await expect(page).toHaveURL(/\/strategies\/new\/wizard\?source=csv/, {
      timeout: 10_000,
    });

    // Wait for the CSV upload step to render. The dropzone carries
    // `data-testid="wizard-csv-dropzone"` per Phase 15 §6 row 9 (see
    // src/app/(dashboard)/strategies/new/wizard/steps/CsvUploadStep.tsx:393).
    await expect(
      page.locator('[data-testid="wizard-csv-dropzone"]'),
    ).toBeVisible({ timeout: 10_000 });

    const results = await buildAxe(page).analyze();
    expect(results.violations).toEqual([]);
  });

  // Phase 53 / APPLY-02 — the read-only Review & confirm recap is the new
  // wizard UX area; it must hold the WCAG-AA floor. The CSV branch is the
  // one branch drivable to the review step without a real exchange-key sync
  // (the API branch needs a synced verifiable key the seed helper doesn't
  // provide — it shares the same drivability limit as the api-branch scan
  // above, which only reaches the first step). We drive upload → preview →
  // profile → review, then axe-scan the recap surface. The review step's
  // a11y invariants (aria wiring, no role=alert) are additionally pinned at
  // the component level in steps/ReviewStep.test.tsx for BOTH branches.
  test("zero axe violations on the CSV-branch Review & confirm step", async ({
    page,
  }) => {
    if (HAS_SEED_ENV) {
      const allocator = await seedTestAllocator();
      await loginViaForm(page, allocator.email, allocator.password);
    }

    await page.goto("/strategies/new/wizard?source=csv");
    await expect(page).toHaveURL(/\/strategies\/new\/wizard\?source=csv/, {
      timeout: 10_000,
    });

    // Upload a minimal valid daily-returns CSV.
    await page.getByTestId("csv-strategy-name").fill("E2E Axe Review Strat");
    await page.getByTestId("wizard-csv-file-input").setInputFiles({
      name: "axe_returns.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        [
          "date,daily_return",
          "2026-01-05,0.012",
          "2026-01-06,-0.005",
          "2026-01-07,0.008",
          "2026-01-08,0.003",
          "2026-01-09,-0.002",
        ].join("\n"),
        "utf-8",
      ),
    });
    await page.getByTestId("wizard-csv-validate-submit").click();

    // Preview → Strategy profile (csv_metadata) — fill the required
    // description so the step can advance.
    await page.getByTestId("wizard-csv-preview-continue").click();
    await expect(
      page.getByRole("heading", {
        name: "Tell allocators what this strategy is",
      }),
    ).toBeVisible({ timeout: 15_000 });
    await page.getByLabel("Description").fill("Automated axe-scan description.");
    await page.getByRole("button", { name: /review and submit/i }).click();

    // The Review & confirm recap renders — scan it.
    await expect(
      page.getByRole("heading", { name: /review & confirm/i }),
    ).toBeVisible({ timeout: 15_000 });

    const results = await buildAxe(page).analyze();
    expect(results.violations).toEqual([]);
  });
});
