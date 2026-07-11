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

// Phase 88 multi-key mode (CONTEXT D4) — the wizard surface added after Phase
// 17 and never axe-scanned. These two helpers mirror
// e2e/composite-onboarding.spec.ts (91-03) VERBATIM so the two specs stay on
// ONE driving idiom (91-05 acceptance: selector consistency with 91-03). Only
// the per-key add-key route is stubbed: these axe cases stop at the multi-key
// step (never Continue), so set-members / keys/sync are never reached.
async function stubAddKeyRoute(page: import("@playwright/test").Page) {
  await page.route("**/api/strategies/composite/add-key", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      // Exact keys at MultiKeyConnectStep.tsx:385-397 (fresh uuids per call);
      // a random strategy_id is fine — these cases never reach the preview step.
      body: JSON.stringify({
        ok: true,
        strategy_id: crypto.randomUUID(),
        api_key_id: crypto.randomUUID(),
      }),
    });
  });
}

// Drive one editable key panel (index `i`) to `validated` — Deribit exchange,
// placeholder credentials, a start window and either an end window or the
// still-live (open-ended) toggle. Copied verbatim from
// composite-onboarding.spec.ts:124-142 so both specs share the selector idiom.
async function fillAndValidatePanel(
  page: import("@playwright/test").Page,
  i: number,
  opts: { start: string; end?: string; stillLive?: boolean },
) {
  await page.getByTestId(`key-${i}-exchange-deribit`).click();
  await page.getByTestId(`key-${i}-api-key`).fill("e2e-deribit-client-id");
  await page
    .getByTestId(`key-${i}-api-secret`)
    .fill("e2e-deribit-client-secret");
  await page.getByTestId(`key-${i}-window-start`).fill(opts.start);
  if (opts.stillLive) {
    await page.getByTestId(`key-${i}-still-live`).check();
  } else if (opts.end) {
    await page.getByTestId(`key-${i}-window-end`).fill(opts.end);
  }
  await page.getByTestId(`key-${i}-validate`).click();
  await expect(page.getByTestId(`key-${i}-summary`)).toBeVisible({
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

    // Mock the analytics-backed validate route. This test axe-scans the
    // Review & confirm recap (its stated intent); it is not validating real
    // analytics. The CI e2e job runs no analytics service and sets neither
    // ANALYTICS_SERVICE_URL nor INTERNAL_API_TOKEN, so the live route 503s
    // (CSV_UPSTREAM_FAIL) → CsvUploadStep never advances → the preview-continue
    // click below would hang to the 60s timeout. Fulfilling a valid envelope
    // (matching the 5-row CSV uploaded next) lets the wizard reach review so
    // the recap can be scanned. Review a11y is also pinned at the component
    // level in steps/ReviewStep.test.tsx.
    await page.route("**/api/strategies/csv-validate", async (route) => {
      const rows = [
        { date: "2026-01-05", daily_return: 0.012 },
        { date: "2026-01-06", daily_return: -0.005 },
        { date: "2026-01-07", daily_return: 0.008 },
        { date: "2026-01-08", daily_return: 0.003 },
        { date: "2026-01-09", daily_return: -0.002 },
      ];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          preview: {
            row_count: rows.length,
            date_range: [rows[0].date, rows[rows.length - 1].date],
            columns_detected: ["date", "daily_return"],
            first_rows: rows.slice(0, 3),
            last_rows: rows.slice(-2),
          },
          daily_returns_series: rows,
        }),
      });
    });

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

  // Phase 88 / CONTEXT D4 — the multi-key composite mode is the wizard surface
  // added after Phase 17 and never axe-scanned. Enter multi mode via the
  // State-A ghost affordance (MultiKeyConnectStep.tsx:522) → the key list
  // renders with two editable panels → scan the multi-key step at the full
  // buildAxe zero-violation set (same idiom as the api/csv branches above).
  test("zero axe violations on the multi-key mode", async ({ page }) => {
    if (HAS_SEED_ENV) {
      const allocator = await seedTestAllocator();
      await loginViaForm(page, allocator.email, allocator.password);
    }

    await page.goto("/strategies/new/wizard");

    // ME-02 false-green guard (mirrors the api-branch scan above).
    await expect(page).toHaveURL(/\/strategies\/new\/wizard(?!\/csv)/, {
      timeout: 10_000,
    });

    // Enter multi-key mode; the key list renders with two editable panels.
    await page.getByTestId("multi-add-key").click();
    await expect(page.getByTestId("multi-key-list")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("key-panel-0")).toBeVisible();

    const results = await buildAxe(page).analyze();
    expect(results.violations).toEqual([]);
  });

  // Phase 88 / CONTEXT D4 — the fail-loud overlap-error state. Drive two panels
  // into overlapping windows EXACTLY as e2e/composite-onboarding.spec.ts (91-03)
  // does (one driving idiom, shared selectors), then scan the visible overlap
  // envelope. This is the a11y proof for the fail-loud error surface: the
  // summary text must be programmatically associated. If axe flags a REAL
  // association gap on the Phase-88 markup, that is reported as a FINDING in the
  // plan SUMMARY — this plan does NOT patch production markup.
  test("zero axe violations on the overlap-error state", async ({ page }) => {
    if (HAS_SEED_ENV) {
      const allocator = await seedTestAllocator();
      await loginViaForm(page, allocator.email, allocator.password);
    }
    // Registered BEFORE navigation so the first per-key validate POST is caught.
    await stubAddKeyRoute(page);

    await page.goto("/strategies/new/wizard");
    await expect(page).toHaveURL(/\/strategies\/new\/wizard(?!\/csv)/, {
      timeout: 10_000,
    });

    // Enter multi mode → two editable panels (indexes 0 and 1).
    await page.getByTestId("multi-add-key").click();
    await expect(page.getByTestId("key-panel-0")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId("key-panel-1")).toBeVisible();

    // Panel 0 → validated with a fixed [2025-01-01, 2025-01-20) window (frozen).
    await fillAndValidatePanel(page, 0, {
      start: "2025-01-01",
      end: "2025-01-20",
    });

    // Panel 1 → OVERLAPPING open-ended window [2025-01-10, live), left editable.
    // Step-level validation spans validated + editing panels, so the overlap
    // fires now (mirrors composite-onboarding.spec.ts:196-208).
    await page.getByTestId("key-1-exchange-deribit").click();
    await page.getByTestId("key-1-api-key").fill("e2e-deribit-client-id-2");
    await page
      .getByTestId("key-1-api-secret")
      .fill("e2e-deribit-client-secret-2");
    await page.getByTestId("key-1-window-start").fill("2025-01-10");
    await page.getByTestId("key-1-still-live").check();

    // The overlap envelope is visible — scan this fail-loud a11y surface.
    await expect(
      page.getByTestId("multi-key-validation-summary"),
    ).toBeVisible({ timeout: 10_000 });

    const results = await buildAxe(page).analyze();
    expect(results.violations).toEqual([]);
  });
});
