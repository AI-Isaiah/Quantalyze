import { test, expect } from "@playwright/test";
import {
  seedTestAllocator,
  cleanupStrategiesByNamePrefix,
  type SeededAllocator,
} from "./helpers/seed-test-project";

/**
 * E2E coverage for Phase 15 / CSV-01..CSV-03 — the CSV branch of the
 * strategy onboarding wizard at /strategies/new/wizard?source=csv.
 *
 * Strategy-manager role only. Per memory feedback_e2e_all_user_groups.md,
 * we cover the role that actually owns the path; allocator/admin/public/
 * demo have no CSV upload surface in Phase 15.
 *
 * SCOPE OF THIS E2E:
 * - Wizard happy path: type strategy name → upload → preview → submit →
 *   the just-submitted strategy renders in the owner's list
 * - The user-typed strategy name lands on strategies.name and renders on the
 *   post-submit list (CSV-03)
 *
 * OUT OF SCOPE FOR PHASE 15 (deferred to Phase 18 / FIX-03 per cross-AI
 * revision 2026-04-30):
 * - metrics_snapshot parity between CSV and API paths
 * - fingerprint parity between CSV and API paths
 * - strategy_verifications.metrics_snapshot column population shape
 *
 * ── 158-05 seeded-spec conversion (OPS-03 orphan repair, 2026-08-20) ────────
 * This spec previously logged in as a HARDCODED demo user that does not
 * exist in the TEST Supabase project — every case failed at login, and the
 * credentials sat in a PUBLIC repo. Converted to the canonical seeded-spec
 * contract
 * (e2e/wizard-resume.spec.ts pattern):
 *   - HAS_SEED_ENV self-skip (TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY)
 *   - seedTestAllocator({ role: "both" }) mints a throwaway user per worker
 *     ("both" clears the manager-gated /strategies/new/wizard route AND the
 *     universal approval gate — see the seed helper's role docs)
 *   - NAME_PREFIX niche + cleanupStrategiesByNamePrefix in afterAll (replaces
 *     the old listUsers-based user-id cleanup, whose pagination 500s on the
 *     TEST project past ~page 4)
 * Fail-closed env contract (commit f4e257df) is PRESERVED: all admin access
 * now routes through the seed helpers' getAdmin(), which accepts only
 * TEST-named env and runs assertNotProductionSupabaseUrl +
 * assertSupabaseServiceRoleKey before any client is built. Ambient
 * NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are never read.
 *
 * BATCH: SEEDED (plan 158-06 wires it into the e2e-seeded list; the MA-8
 * joining rule's second half is the HAS_SEED_ENV gate below).
 */

const HAS_SEED_ENV =
  !!process.env.TEST_SUPABASE_URL &&
  !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

/**
 * 158-05 measured finding (2026-08-20): the wizard's "Validate and continue"
 * step POSTs /api/strategies/csv-validate, which FORWARDS to the Python
 * analytics service (ANALYTICS_SERVICE_URL + INTERNAL_API_TOKEN seam). No CI
 * job boots that service (`grep ANALYTICS_SERVICE_URL .github/workflows` →
 * nothing) and the default local env has no listener either — the wizard
 * renders the honest "We could not reach our own service" seam alert and the
 * flow can never reach Preview. The two cases that need server-side
 * validation therefore self-skip VISIBLY unless the runner declares a
 * reachable service by exporting ANALYTICS_SERVICE_URL into the Playwright
 * process env (the same env-as-provisioning-proxy pattern as
 * PLAYWRIGHT_TEST_STRATEGY_ID in api-key-flow.spec.ts). The two client-side
 * cases below (submit-disabled, oversize-file) run everywhere.
 */
const HAS_ANALYTICS_SERVICE = !!process.env.ANALYTICS_SERVICE_URL;
const ANALYTICS_SKIP_REASON =
  "Requires a reachable analytics service for the csv-validate seam " +
  "(ANALYTICS_SERVICE_URL + INTERNAL_API_TOKEN); none is provisioned in CI " +
  "or the default local env — 158/OPS-03 disposition. Export " +
  "ANALYTICS_SERVICE_URL into the Playwright env (with a live service) to run.";

/** The GC niche this spec owns on the shared test DB. */
const NAME_PREFIX = "e2e-csvflow-";

// One seeded owner per worker process (beforeAll runs per worker under
// fullyParallel). Module scope so login() and every test share it.
let allocator: SeededAllocator | null = null;

async function login(page: import("@playwright/test").Page) {
  if (!allocator) throw new Error("[csv-upload-flow] login before seed");
  await page.goto("/login");
  await page.fill(
    'input[name="email"], input[placeholder*="email" i]',
    allocator.email,
  );
  await page.fill('input[type="password"]', allocator.password);
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
  test.skip(
    !HAS_SEED_ENV,
    "csv upload flow: seed-helper env vars not wired " +
      "(set TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY).",
  );

  test.beforeAll(async () => {
    if (!HAS_SEED_ENV) return;
    // "both" owns the manager wizard route AND the allocator surfaces the
    // post-submit redirect lands on; statuses are stamped verified by the
    // helper so the universal approval gate never intercepts.
    allocator = await seedTestAllocator({ role: "both" });
  });

  test.afterAll(async () => {
    if (HAS_SEED_ENV) {
      await cleanupStrategiesByNamePrefix(NAME_PREFIX);
    }
  });

  test("happy path: type name → upload → preview → submit → owner list renders user-typed name", async ({
    page,
  }) => {
    test.skip(!HAS_ANALYTICS_SERVICE, ANALYTICS_SKIP_REASON);
    await login(page);
    await page.goto("/strategies/new/wizard?source=csv");

    // 1. Upload step renders.
    await expect(
      page.getByRole("heading", { name: "Upload your track record" }),
    ).toBeVisible();
    await expect(
      page.getByText(/Name your strategy, pick a format/),
    ).toBeVisible();

    // 2. Cross-AI revision 2026-04-30: type the strategy name. Prefixed so
    //    afterAll's cleanup-by-prefix collects the row (own-seed niche).
    const typedName = `${NAME_PREFIX}${Date.now()}`;
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

    // 9. Strategy-profile (csv_metadata) step renders. A description AND a
    //    category are required to advance (the MetadataStep Submit gate) —
    //    the earlier "a description is required" comment named only half the
    //    gate, which is why the wait below was missing.
    await expect(
      page.getByRole("heading", { name: "Describe this strategy" }),
    ).toBeVisible({ timeout: 15_000 });
    await page
      .getByLabel("Description")
      .fill("E2E CSV strategy — automated test description.");

    // ⛔ Same unstated precondition as `wizard-axe.spec.ts` — see the long note
    // there. `category` is required (MetadataStep.tsx:724) and nothing here
    // selects one; it works only because the step auto-selects `data[0].id`
    // once the `discovery_categories` fetch resolves (:640). Clicking inside
    // that window is refused at :815 and the wizard never advances.
    // Both call sites are fixed together: a wait added to one spec while the
    // other keeps racing is the same one-path-only fix this repo keeps paying
    // for.
    await expect(page.getByLabel("Category")).not.toHaveValue("", {
      timeout: 15_000,
    });

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

    // 13. Redirect to the user's strategies list. The wizard lands on
    //     /strategies (plural) because pending_review strategies are hidden
    //     by /strategy/[id]'s status='published' filter — the old
    //     /strategy/{id} target was a 404 for every wizard submission.
    await page.waitForURL(/\/strategies\?wizard_submitted=1/, {
      timeout: 15_000,
    });

    // 14. CSV-03 verification: the just-submitted strategy appears in the
    //     owner's list under the user-typed name (own-seed assertion — the
    //     name was minted by THIS test).
    //
    //     158-05: the old final assertion here — `expect(h1).toContainText(
    //     typedName)` — was rot from the era when submit landed on
    //     /strategy/{id}: on /strategies the h1 is the list PAGE heading
    //     (DEF-149-B), never a strategy name, so it could not pass. The
    //     "lands on strategies.name" claim is carried by the typed name
    //     rendering in the list row below.
    await expect(page.getByText(typedName).first()).toBeVisible();
  });

  test("validation failure: non-monotonic dates render the validation envelope", async ({
    page,
  }) => {
    test.skip(!HAS_ANALYTICS_SERVICE, ANALYTICS_SKIP_REASON);
    await login(page);
    await page.goto("/strategies/new/wizard?source=csv");

    // Strategy name + bad CSV. (No row is ever created — the prefix keeps
    // naming discipline uniform anyway.)
    await page.getByTestId("csv-strategy-name").fill(`${NAME_PREFIX}bad-dates`);

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

    await page.getByTestId("csv-strategy-name").fill(`${NAME_PREFIX}big-file`);

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
});
