/**
 * Phase 170 T0 — seeded geometry proof for criterion 2.
 *
 * Written contract-first against 170-UI-SPEC.md. Rows that describe the
 * FIXED UI are RED at HEAD and turn GREEN only when their fix plan lands.
 * Do not weaken an assertion to make this file green today.
 *
 * FLOW-01 place 2: HAS_SEED_ENV + test.skip. Place 1 is the e2e-seeded
 * list entry in .github/workflows/ci.yml. A local run without the seed
 * env skips; it must never pass against a login page (W-02).
 *
 * Shared TEST: every seed uses this spec's own per-worker prefix and
 * cleanup deletes only that prefix. Never assert a global count.
 */
import { test, expect, type Page } from "@playwright/test";
import { assertNoReflow } from "./helpers/reflow";
import {
  assertChildrenInside,
  assertInsideViewport,
  assertNotCovered,
} from "./helpers/geometry";
import {
  cleanupStrategiesByNamePrefix,
  seedStrategyWithHistory,
  seedTestAllocator,
} from "./helpers/seed-test-project";

const HAS_SEED_ENV =
  !!process.env.TEST_SUPABASE_URL &&
  !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

// Per worker, so one worker's afterAll cannot delete another's rows
// (my-strategies.spec.ts TEST_PARALLEL_INDEX precedent).
const NAME_PREFIX = `0 Layout Narrow Fixture ${process.env.TEST_PARALLEL_INDEX ?? 0}`;

// Founder decision 2026-09-27. Identical to the authed reflow sweep.
const VIEWPORTS: { id: string; width: number; height: number }[] = [
  { id: "V390", width: 390, height: 844 },
  { id: "V640", width: 640, height: 400 },
  { id: "V960", width: 960, height: 540 },
];

const FOOTER = '[role="region"][aria-label="Scenario draft summary and actions"]';
const COMMIT = '[data-testid="scenario-footer-commit"]';
const NAV = 'nav[aria-label="Primary mobile"]';
const ALLOC_ANCHOR = 'h1:has-text("My Allocation")';

async function loginViaForm(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.fill('input[name="email"], input[placeholder*="email" i]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL(/\/(discovery|strategies|allocations|dashboard)/, {
    timeout: 10_000,
  });
}

/**
 * Drive the composer into composed mode the way composer-axe does: unique
 * "0 …" fixture (sorts inside the 200-row browse cap), search by codename,
 * add by id, close the drawer, gate on the Portfolio heading.
 */
async function openComposedScenario(page: Page): Promise<void> {
  await cleanupStrategiesByNamePrefix(NAME_PREFIX);
  const fixtureName = `${NAME_PREFIX} ${Math.random().toString(36).slice(2, 8)}`;
  const fixtureId = await seedStrategyWithHistory({
    days: 400,
    name: fixtureName,
    codename: fixtureName,
    withDailyReturns: true,
  });
  const allocator = await seedTestAllocator();
  await loginViaForm(page, allocator.email, allocator.password);

  await page.goto("/allocations?tab=scenario");
  await page.waitForLoadState("networkidle");
  await expect(page.locator("h2", { hasText: "Start a portfolio" })).toBeVisible({
    timeout: 10_000,
  });

  await page.click('button:has-text("Browse strategies")');
  await expect(
    page.locator('[role="dialog"][aria-label="Browse strategies"]'),
  ).toBeVisible({ timeout: 5_000 });
  await page.fill('input[placeholder="Search by name or codename"]', fixtureName);
  const fixtureAdd = page.locator(`[data-testid="browse-add-${fixtureId}"]`);
  await expect(fixtureAdd).toBeVisible({ timeout: 10_000 });
  await fixtureAdd.click();
  await page.click('[aria-label="Close drawer"]');
  await page.waitForLoadState("networkidle");
  await expect(page.locator("h2", { hasText: "Portfolio" }).first()).toBeVisible({
    timeout: 10_000,
  });
}

test.describe("composed scenario — N-FOOT", () => {
  test.skip(
    !HAS_SEED_ENV,
    "layout-narrow: seed-helper env vars not wired " +
      "(set TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY) — " +
      "Skipping prevents false-green on empty/404/login pages (W-02). " +
      "The live geometry proof runs in CI e2e-seeded once seed env is present.",
  );

  test.afterAll(async () => {
    if (HAS_SEED_ENV) {
      await cleanupStrategiesByNamePrefix(NAME_PREFIX);
    }
  });

  // Task 1 tracer: one viewport, end to end through both FLOW-01 places.
  // Later tasks loop the rest of VIEWPORTS onto this same contract.
  test("V390: footer children inside the footer, clear of the nav, Commit inside and uncovered", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const vp = VIEWPORTS[0];
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await openComposedScenario(page);

    // Route-specific anchor (W-02). A login page has no "My Allocation" h1.
    await assertNoReflow(page, ALLOC_ANCHOR);

    const footer = page.locator(FOOTER);
    await expect(footer, "scenario footer region missing").toBeVisible({
      timeout: 10_000,
    });
    await assertChildrenInside(page, footer, "N-FOOT children");

    // Below md the footer sits above the bottom nav. V390 is below md.
    const footerBox = await footer.boundingBox();
    const navBox = await page.locator(NAV).boundingBox();
    expect(footerBox, "footer has no layout box").not.toBeNull();
    expect(navBox, "Primary mobile nav has no layout box at V390").not.toBeNull();
    expect(
      footerBox!.y + footerBox!.height,
      `footer bottom ${footerBox!.y + footerBox!.height} is below nav top ${navBox!.y}`,
    ).toBeLessThanOrEqual(navBox!.y + 1);

    const commit = page.locator(COMMIT);
    await expect(commit).toBeVisible();
    const commitBox = await commit.boundingBox();
    expect(commitBox, "Commit scenario has no layout box").not.toBeNull();
    expect(
      commitBox!.height,
      `Commit scenario height ${commitBox!.height} is under 44px`,
    ).toBeGreaterThanOrEqual(44);
    await assertInsideViewport(page, commit, "Commit scenario");
    await assertNotCovered(page, commit, "Commit scenario");
  });
});
