import { test, expect } from "@playwright/test";

/**
 * Audit 2026-05-07 C-0309: credentials are read from env vars at test
 * time, never committed to the repo. Local devs source from the macOS
 * Keychain via `security find-generic-password -s quantalyze-test -a
 * <role>@quantalyze.test -w`. When the env is not present the
 * authenticated/admin describes skip rather than authenticating with
 * stale committed credentials.
 *
 * 158-05 correction (2026-08-20): the original comment claimed "CI injects
 * them through the existing E2E_TEST_EMAIL / E2E_TEST_PASSWORD pipeline" —
 * no such pipeline ever existed in .github/workflows. See the
 * skipped-by-design decision on the describes below.
 */
const E2E_EMAIL = process.env.E2E_TEST_EMAIL;
const E2E_PASSWORD = process.env.E2E_TEST_PASSWORD;
const HAS_E2E_CREDS = !!E2E_EMAIL && !!E2E_PASSWORD;

test.describe("Public browsing flow", () => {
  test("landing page links to /browse", async ({ page }) => {
    await page.goto("/");
    const browseLink = page.locator('a:has-text("Browse Strategies")');
    await expect(browseLink).toBeVisible();
    await browseLink.click();
    await expect(page).toHaveURL(/\/browse/);
  });

  test("browse page loads strategy categories", async ({ page }) => {
    const response = await page.goto("/browse");
    expect(response?.status()).toBeLessThan(400);
    await expect(page.locator("h1")).toContainText("Browse");
  });

  test("browse category page shows strategies without auth", async ({
    page,
  }) => {
    await page.goto("/browse/crypto-sma");
    // Should not redirect to login
    await expect(page).toHaveURL(/\/browse\/crypto-sma/);
    // Should show the table or a "no strategies" message
    const hasTable = await page.locator("table").isVisible().catch(() => false);
    const hasEmpty = await page
      .locator("text=No strategies")
      .isVisible()
      .catch(() => false);
    expect(hasTable || hasEmpty).toBeTruthy();
  });

  test("factsheet page loads for published strategy", async ({ page }) => {
    // First browse to find a strategy ID
    await page.goto("/browse/crypto-sma");
    const firstLink = page.locator("table tbody tr a").first();
    const hasStrategies = await firstLink.isVisible().catch(() => false);

    if (hasStrategies) {
      const href = await firstLink.getAttribute("href");
      const strategyId = href?.split("/").pop();
      // Captured BEFORE navigating — this locator is on the browse page and
      // goes stale the moment we leave it.
      const rowName = (await firstLink.textContent())?.trim();
      if (strategyId) {
        const response = await page.goto(`/factsheet/${strategyId}`);
        expect(response?.status()).toBeLessThan(400);
        // 158-05 (OPS-03 orphan repair, 2026-08-20): this test previously
        // asserted `text=Verified by Quantalyze`, which only renders once a
        // strategy's analytics are COMPLETE. The first row of the shared,
        // polluted test DB is whatever sorts first — often a still-computing
        // seed — so that assertion was a global-DB-state bet (the PR #654
        // lesson: assert what THIS test itself established). What this test
        // establishes is only "the id I clicked resolves to a factsheet
        // page", so assert the factsheet shell that renders in BOTH the
        // computing and complete states: the "Institutional Factsheet"
        // masthead and a non-empty strategy h1.
        await expect(
          page.locator("text=Institutional Factsheet").first(),
        ).toBeVisible();

        // 158-REVIEW WR-12: the masthead check above is fine; the h1 check was
        // not. `not.toBeEmpty()` passes for ANY non-empty text node — a
        // skeleton placeholder, an em-dash, a generic page title — so it could
        // not fail for a realistic regression of "the factsheet resolved the
        // strategy I clicked", which is the only thing this test establishes.
        //
        // Assert that identity instead. It is falsifiable and still free of the
        // global-DB-state bet the old `Verified by Quantalyze` assertion made:
        // the browse row's link TEXT is the strategy name verbatim
        // (StrategyTable renders `{s.name}` as the anchor body) and the
        // factsheet masthead h1 renders `payload.strategyName`, so the two are
        // directly comparable for whichever row happened to sort first.
        expect(
          rowName,
          "the browse row link had no text, so the factsheet's identity cannot be asserted — if StrategyTable stopped rendering the strategy name as its anchor body, fix this test's capture rather than dropping the assertion",
        ).toBeTruthy();
        await expect(
          page.locator("h1").first(),
          `factsheet h1 does not name the strategy this test navigated to ("${rowName}") — the id resolved to a page, but not to THAT strategy`,
        ).toContainText(rowName!);
      }
    }
  });
});

/**
 * SKIPPED BY DESIGN — recorded decision, phase 158 / OPS-03 (2026-08-20).
 *
 * E2E_TEST_EMAIL / E2E_TEST_PASSWORD exist NOWHERE in .github/workflows —
 * the "CI: injected via GitHub Actions secrets" claim below was never true
 * at HEAD, and 158-05 deliberately does NOT provision them: the in-repo
 * pattern for authenticated e2e is the seedTestAllocator helper
 * (e2e/helpers/seed-test-project.ts), which mints a throwaway user per run
 * instead of depending on a long-lived shared credential. This describe
 * (and "Admin flows" below) therefore self-skips VISIBLY everywhere; the
 * anon "Public browsing flow" above is this spec's executable coverage.
 * Authenticated coverage of the same surfaces lives in the seeded specs
 * (wizard-resume, my-strategies, csv-upload-flow, …).
 */
test.describe("Authenticated flows", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      !HAS_E2E_CREDS,
      "skipped-by-design (158/OPS-03, 2026-08-20): E2E_TEST_EMAIL / " +
        "E2E_TEST_PASSWORD are not provisioned in CI and never will be for " +
        "this spec — authed e2e coverage uses the seedTestAllocator pattern " +
        "instead. Set both env vars locally only for a manual run.",
    );

    // Login with test account — credentials sourced from env, never
    // hardcoded in the repo (audit 2026-05-07 C-0309).
    await page.goto("/login");
    await page.fill(
      'input[name="email"], input[placeholder*="email" i]',
      E2E_EMAIL!,
    );
    await page.fill('input[type="password"]', E2E_PASSWORD!);
    await page.click('button:has-text("Sign in")');
    // Wait for redirect to discovery
    await page.waitForURL(/\/(discovery|strategies)/, { timeout: 10000 });
  });

  test("strategy discovery loads with data", async ({ page }) => {
    await page.goto("/discovery/crypto-sma");
    await expect(page.locator("h1, h2")).toContainText(/Crypto SMA/);
  });

  test("my strategies page shows strategies", async ({ page }) => {
    await page.goto("/strategies");
    await expect(page.locator("h1")).toContainText("My Strategies");
  });

  test("allocations page loads", async ({ page }) => {
    await page.goto("/allocations");
    await expect(page.locator("h1")).toContainText("My Allocations");
  });

  test("strategy detail shows hero metrics", async ({ page }) => {
    await page.goto("/discovery/crypto-sma");
    const firstLink = page.locator("table tbody tr a").first();
    const hasStrategies = await firstLink.isVisible().catch(() => false);

    if (hasStrategies) {
      await firstLink.click();
      // Should see hero metrics
      await expect(page.locator("text=CAGR").first()).toBeVisible({
        timeout: 10000,
      });
      await expect(page.locator("text=Sharpe").first()).toBeVisible();
    }
  });

  test("share button copies factsheet URL", async ({ page, context }) => {
    await page.goto("/strategies");
    const shareBtn = page.locator('button:has-text("Share Factsheet")').first();
    const hasShare = await shareBtn.isVisible().catch(() => false);

    if (hasShare) {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await shareBtn.click();
      await expect(
        page.locator('button:has-text("Link copied!")').first()
      ).toBeVisible({ timeout: 3000 });
    }
  });
});

// SKIPPED BY DESIGN — same recorded decision as "Authenticated flows" above
// (phase 158 / OPS-03, 2026-08-20): no E2E_TEST_* secrets exist in CI and
// none are provisioned; admin-authed coverage uses seedTestAllocator with
// `isAdmin: true` (see e2e/sfox-badge.spec.ts) when a spec needs it.
test.describe("Admin flows", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      !HAS_E2E_CREDS,
      "skipped-by-design (158/OPS-03, 2026-08-20): E2E_TEST_EMAIL / " +
        "E2E_TEST_PASSWORD are not provisioned in CI and never will be for " +
        "this spec — admin-authed e2e coverage uses seedTestAllocator({ " +
        "isAdmin: true }) instead. Set both env vars locally only for a " +
        "manual run.",
    );

    // Login with test account — credentials sourced from env, never
    // hardcoded in the repo (audit 2026-05-07 C-0309).
    await page.goto("/login");
    await page.fill(
      'input[name="email"], input[placeholder*="email" i]',
      E2E_EMAIL!,
    );
    await page.fill('input[type="password"]', E2E_PASSWORD!);
    await page.click('button:has-text("Sign in")');
    await page.waitForURL(/\/(discovery|strategies)/, { timeout: 10000 });
  });

  test("admin dashboard loads", async ({ page }) => {
    await page.goto("/admin");
    // May redirect if not admin, or show dashboard
    const isAdmin = await page
      .locator("text=Admin Dashboard")
      .isVisible()
      .catch(() => false);
    const isRedirected = page.url().includes("/discovery");
    expect(isAdmin || isRedirected).toBeTruthy();
  });
});
