import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

/**
 * E2E coverage for Phase 15 / CSV-01..CSV-03 — the CSV branch of the
 * strategy onboarding wizard at /strategies/new/wizard?source=csv.
 *
 * Strategy-manager role only. Per memory feedback_e2e_all_user_groups.md,
 * we cover the role that actually owns the path; allocator/admin/public/
 * demo have no CSV upload surface in Phase 15.
 *
 * SCOPE OF THIS E2E:
 * - Wizard happy path: type strategy name → upload → preview → submit → factsheet
 * - TrustTierLabel renders the locked Phase 15 v0 string (CSV-03 visual gate)
 * - The user-typed strategy name lands on strategies.name and renders on the
 *   factsheet H1
 *
 * OUT OF SCOPE FOR PHASE 15 (deferred to Phase 18 / FIX-03 per cross-AI
 * revision 2026-04-30):
 * - metrics_snapshot parity between CSV and API paths
 * - fingerprint parity between CSV and API paths
 * - strategy_verifications.metrics_snapshot column population shape
 * Phase 18 / FIX-03 success gate verifies these; Phase 15 ships the wizard
 * + trust-tier wiring only.
 *
 * Cross-AI revision 2026-04-30: the test user id is resolved by SELECTing
 * auth.users.id WHERE email = '<demo email>' at test runtime. The prior
 * iteration depended on a TEST_MANAGER_USER_ID env-var which was a
 * foot-gun (CI could deploy without it set, leading to silent cleanup
 * failure). The env-var dependency is fully removed in this spec.
 *
 * Phase 15 WARNING fix from iteration 1: a test.afterAll block deletes
 * any csv-source strategies the test created so the shared test project
 * does not accumulate rows over time.
 */

const DEMO_EMAIL = "matratzentester24@gmail.com";
const DEMO_PASSWORD = "Test12";

// Cross-AI revision 2026-04-30: resolved at test runtime via auth.users
// SELECT-by-email. NOT read from process.env. Module-scope variable so
// beforeAll caches it and afterAll reuses it.
let resolvedTestManagerUserId: string | null = null;

async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.fill(
    'input[name="email"], input[placeholder*="email" i]',
    DEMO_EMAIL,
  );
  await page.fill('input[type="password"]', DEMO_PASSWORD);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL(/\/(discovery|strategies|allocations)/, {
    timeout: 10_000,
  });
}

function buildValidCsvBytes(): Buffer {
  // Cross-AI revision 2026-04-30: weekday/weekend mix is fine — crypto
  // trades 24/7 and `trading_window` rule was dropped in Phase 15.
  const lines = [
    "date,daily_return",
    "2026-01-05,0.012",
    "2026-01-06,-0.005",
    "2026-01-07,0.008",
    "2026-01-08,0.003",
    "2026-01-09,-0.002",
  ];
  return Buffer.from(lines.join("\n"), "utf-8");
}

test.describe("/strategies/new/wizard?source=csv (Phase 15 / CSV-01..CSV-03)", () => {
  // Cross-AI revision 2026-04-30: resolve the test user id from auth.users
  // BEFORE any tests run. If creds are missing, leave it null and the
  // afterAll cleanup will warn but not fail.
  test.beforeAll(async () => {
    const url =
      process.env.SUPABASE_TEST_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey =
      process.env.SUPABASE_TEST_SERVICE_ROLE_KEY ??
      process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      console.warn(
        "[csv-upload-flow] beforeAll: SUPABASE_TEST_URL / NEXT_PUBLIC_SUPABASE_URL or SUPABASE_TEST_SERVICE_ROLE_KEY / SUPABASE_SERVICE_ROLE_KEY missing; user-id resolution skipped (cleanup will warn).",
      );
      return;
    }
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false },
    });
    // auth.admin.listUsers paginates. The test demo user is in page 1
    // because the test project has <100 users; if a future project
    // grows past page 1 we'll need to filter server-side.
    const { data, error } = await admin.auth.admin.listUsers();
    if (error || !data?.users) {
      console.warn(
        "[csv-upload-flow] beforeAll: auth.admin.listUsers failed:",
        error?.message ?? "no users returned",
      );
      return;
    }
    const match = data.users.find((u) => u.email === DEMO_EMAIL);
    if (!match) {
      console.warn(
        `[csv-upload-flow] beforeAll: no auth.users row for email ${DEMO_EMAIL}; cleanup will warn.`,
      );
      return;
    }
    resolvedTestManagerUserId = match.id;
    console.log(
      `[csv-upload-flow] beforeAll: resolved TEST_MANAGER_USER_ID=${match.id} from auth.users for ${DEMO_EMAIL}.`,
    );
  });

  test("happy path: type name → upload → preview → submit → factsheet renders TrustTierLabel + user-typed name", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/strategies/new/wizard?source=csv");

    // 1. Upload step renders.
    await expect(
      page.getByRole("heading", { name: "Upload your track record" }),
    ).toBeVisible();
    await expect(
      page.getByText(/Name your strategy, pick a format/),
    ).toBeVisible();

    // 2. Cross-AI revision 2026-04-30: type the strategy name.
    const typedName = `E2E CSV Test — ${new Date().toISOString().slice(0, 19)}`;
    await page.getByTestId("csv-strategy-name").fill(typedName);

    // 3. Default format = daily_returns; verify segmented control.
    await expect(
      page.getByTestId("wizard-csv-fmt-daily_returns"),
    ).toHaveAttribute("aria-pressed", "true");

    // 4. Upload the valid CSV via the file input.
    const fileInput = page.getByTestId("wizard-csv-file-input");
    await fileInput.setInputFiles({
      name: "test_returns.csv",
      mimeType: "text/csv",
      buffer: buildValidCsvBytes(),
    });

    // 5. Click "Validate and continue".
    await page.getByTestId("wizard-csv-validate-submit").click();

    // 6. Preview screen renders.
    await expect(
      page.getByRole("heading", { name: "Preview your data" }),
    ).toBeVisible({ timeout: 15_000 });

    // 7. Metadata correct: 5 rows, columns 'date, daily_return', typed name.
    await expect(page.getByText("5 rows")).toBeVisible();
    await expect(page.getByText("date, daily_return")).toBeVisible();
    await expect(page.getByText("2026-01-05 → 2026-01-09")).toBeVisible();
    await expect(page.getByText(typedName).first()).toBeVisible();

    // 8. Click "Submit strategy" on Preview to advance to the Strategy
    //    profile (csv_metadata) step (QA ISSUE-010 inserted this between
    //    Preview and Submit).
    await page.getByTestId("wizard-csv-preview-continue").click();

    // 9. Strategy-profile (csv_metadata) step renders. A description is
    //    required to advance (the MetadataStep Submit gate).
    await expect(
      page.getByRole("heading", { name: "Tell allocators what this strategy is" }),
    ).toBeVisible({ timeout: 15_000 });
    await page
      .getByLabel("Description")
      .fill("E2E CSV strategy — automated test description.");
    await page.getByRole("button", { name: /review and submit/i }).click();

    // 10. Phase 53 / APPLY-02 — read-only Review & confirm recap renders
    //     before Submit on the CSV branch. It recaps the entered values and
    //     carries no role=alert. Continue advances to the Submit step.
    await expect(
      page.getByRole("heading", { name: /review & confirm/i }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(typedName).first()).toBeVisible();
    await page.getByTestId("wizard-review-continue").click();

    // 11. Submit screen renders.
    await expect(
      page.getByRole("heading", { name: "Review and submit" }),
    ).toBeVisible();
    await expect(page.getByText(typedName).first()).toBeVisible();

    // 12. Click the final "Submit strategy".
    await page.getByTestId("wizard-csv-submit-cta").click();

    // 11. Redirect to the user's strategies list. The wizard now lands
    //     on /strategies (plural) because pending_review strategies are
    //     hidden by /strategy/[id]'s status='published' filter — the old
    //     /strategy/{id} target was a 404 for every wizard submission.
    //     The list shows the just-submitted strategy with its pending badge.
    await page.waitForURL(/\/strategies\?wizard_submitted=1/, {
      timeout: 15_000,
    });

    // 12. CSV-03 verification: the just-submitted strategy appears in the
    //     "My Strategies" list under the user-typed name.
    await expect(page.getByText(typedName).first()).toBeVisible();

    // 13. Cross-AI revision 2026-04-30: the user-typed strategy name lands
    //     on the factsheet (strategies.name was set to the typed value).
    await expect(page.locator("h1")).toContainText(typedName);
  });

  test("validation failure: non-monotonic dates render the validation envelope", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/strategies/new/wizard?source=csv");

    // Strategy name + bad CSV.
    await page.getByTestId("csv-strategy-name").fill("E2E Bad Dates");

    const bad = Buffer.from(
      [
        "date,daily_return",
        "2026-01-05,0.01",
        "2026-01-06,0.01",
        "2026-01-07,0.01",
        "2026-01-04,0.01", // backwards!
        "2026-01-09,0.01",
      ].join("\n"),
      "utf-8",
    );

    await page.getByTestId("wizard-csv-file-input").setInputFiles({
      name: "bad.csv",
      mimeType: "text/csv",
      buffer: bad,
    });
    await page.getByTestId("wizard-csv-validate-submit").click();

    await expect(page.getByTestId("wizard-csv-error")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/failed validation/)).toBeVisible();

    await expect(
      page.getByRole("heading", { name: "Preview your data" }),
    ).not.toBeVisible();
  });

  test("strategy name required: empty input blocks submit", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/strategies/new/wizard?source=csv");

    // Cross-AI revision 2026-04-30: don't fill the strategy-name input.
    // Upload a valid file via the hidden input.
    await page.getByTestId("wizard-csv-file-input").setInputFiles({
      name: "valid.csv",
      mimeType: "text/csv",
      buffer: buildValidCsvBytes(),
    });

    // Submit CTA must be disabled when name is empty (per CsvUploadStep
    // submitDisabled logic — `trimmedName.length === 0`).
    const submitCta = page.getByTestId("wizard-csv-validate-submit");
    await expect(submitCta).toBeDisabled();
  });

  test("file too large: 11 MB CSV → CSV_FILE_TOO_LARGE envelope", async ({
    page,
  }) => {
    await login(page);
    await page.goto("/strategies/new/wizard?source=csv");

    await page.getByTestId("csv-strategy-name").fill("E2E Big File");

    const big = Buffer.alloc(11 * 1024 * 1024, "0");
    await page.getByTestId("wizard-csv-file-input").setInputFiles({
      name: "huge.csv",
      mimeType: "text/csv",
      buffer: big,
    });

    // CsvUploadStep's handleFileSelect rejects oversize files at
    // selection time (NOT at submit), surfacing the envelope before
    // the user can click "Validate and continue". The envelope's
    // human_message contains "Maximum file size is 10 MB".
    await expect(page.getByTestId("wizard-csv-error")).toBeVisible({
      timeout: 5_000,
    });
    await expect(
      page.getByText(/Maximum file size is 10 MB/),
    ).toBeVisible();
  });

  // Cross-AI revision 2026-04-30: clean up rows the happy-path test created
  // in the shared test Supabase project. Use the test-runtime-resolved
  // user id (from beforeAll's auth.users SELECT) — NOT from process.env.
  test.afterAll(async () => {
    const url =
      process.env.SUPABASE_TEST_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey =
      process.env.SUPABASE_TEST_SERVICE_ROLE_KEY ??
      process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      console.warn(
        "[csv-upload-flow] afterAll: SUPABASE_TEST_URL / NEXT_PUBLIC_SUPABASE_URL or SUPABASE_TEST_SERVICE_ROLE_KEY / SUPABASE_SERVICE_ROLE_KEY missing; cleanup skipped.",
      );
      return;
    }
    if (!resolvedTestManagerUserId) {
      console.warn(
        "[csv-upload-flow] afterAll: resolvedTestManagerUserId is null (beforeAll lookup failed); cleanup skipped to avoid deleting unrelated rows.",
      );
      return;
    }
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false },
    });
    // Narrow filter: only csv-source pending_review strategies for the
    // resolved test user. Cascade clears strategy_verifications via FK.
    const { error, count } = await admin
      .from("strategies")
      .delete({ count: "exact" })
      .eq("user_id", resolvedTestManagerUserId)
      .eq("source", "csv")
      .eq("status", "pending_review");
    if (error) {
      console.error(
        "[csv-upload-flow] cleanup error:",
        error.code,
        error.message,
      );
    } else {
      console.log(
        `[csv-upload-flow] cleanup deleted ${count ?? 0} csv-source pending_review strategies for user ${resolvedTestManagerUserId}.`,
      );
    }
  });
});
