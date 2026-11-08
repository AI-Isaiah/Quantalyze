/**
 * Phase 198 D-07 / ROUTE-06 — `/allocations?add=<strategyId>` opens the "+ Allocation"
 * flow pre-filled, in a browser. Phase 196's factsheet "Add to my allocation" links
 * to this URL, so the contract is proved at the URL, not at a component boundary.
 *
 * What this spec proves, on this spec's OWN seeded strategy:
 *   1. A valid id opens the Add allocation dialog at step 2 with the strategy
 *      named and focus on `Allocation (USD)`, and `add` is gone from the URL.
 *   2. Both steps pass axe (the slide-over's own surface).
 *   3. `Change strategy` returns to step 1 with the search box focused.
 *   4. `Close without adding` returns focus to the header `+ Allocation`, and a
 *      reload does NOT reopen the flow (the strip is what makes that true).
 *   5. A malformed id opens step 1 with the not-available notice, never an error page.
 *
 * It NEVER presses `Add allocation`: no allocation is written. A deep link only
 * opens and pre-fills (the ROUTE-06 prohibition).
 *
 * ⚠️ SHARED TEST DB. Every assertion is about THIS spec's seeded row. The browse
 * read is ordered by name and capped at 200 over a database with thousands of
 * leave-around strategies, so the fixture name starts with `0 ` to sort first, and
 * the prefix niche is garbage-collected before seeding and after the run.
 *
 * ── Seed-gate (two-place rule, FLOW-01) ─────────────────────────────────────
 * Place 1: this file is listed in the `e2e-seeded` batch in
 * `.github/workflows/ci.yml` (a spec absent there never runs anywhere, which is a
 * false green). Place 2: the HAS_SEED_ENV self-skip below.
 */
import { test, expect, type Page } from "./helpers/hydration-guard";
import { buildAxe } from "./helpers/axe";
import {
  cleanupStrategiesByNamePrefix,
  seedStrategyWithHistory,
  seedTestAllocator,
} from "./helpers/seed-test-project";

const HAS_SEED_ENV =
  !!process.env.TEST_SUPABASE_URL &&
  !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

/** The GC niche this spec owns. Starts with `0 ` so it sorts first in the browse read. */
const NAME_PREFIX = "0 198-add ";

/** Inline login, copied from composer-axe.spec.ts: no shared helper exists by design. */
async function loginViaForm(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.fill('input[name="email"], input[placeholder*="email" i]', email);
  await page.fill('input[type="password"]', password);
  await page.click('button:has-text("Sign in")');
  await page.waitForURL(/\/(discovery|strategies|allocations|dashboard)/, {
    timeout: 10_000,
  });
}

test.describe("Phase 198 — /allocations?add= deep link (ROUTE-06, D-07)", () => {
  test.skip(
    !HAS_SEED_ENV,
    "allocations-add: seed-helper env vars not wired " +
      "(set TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY) — " +
      "skipping prevents a false green on an empty or login page.",
  );

  test.afterAll(async () => {
    if (HAS_SEED_ENV) {
      await cleanupStrategiesByNamePrefix(NAME_PREFIX);
    }
  });

  test("a valid id opens step 2 pre-filled, add leaves the URL, axe is clean on both steps, and a reload does not reopen it", async ({
    page,
  }) => {
    test.skip(!HAS_SEED_ENV, "requires seed env");

    await cleanupStrategiesByNamePrefix(NAME_PREFIX);
    const fixtureName = `${NAME_PREFIX}${Math.random().toString(36).slice(2, 8)}`;
    const fixtureId = await seedStrategyWithHistory({
      days: 400,
      name: fixtureName,
      // The seed leaves the exploratory disclosure tier, which masks the raw
      // `name` on the browse wire behind the codename, so the codename is what
      // the dialog renders.
      codename: fixtureName,
    });
    const allocator = await seedTestAllocator();
    await loginViaForm(page, allocator.email, allocator.password);

    await page.goto(`/allocations?add=${fixtureId}`);

    const dialog = page.getByRole("dialog", { name: "Add allocation" });
    await expect(dialog).toBeVisible({ timeout: 15_000 });

    // Step 2, pre-filled: the eyebrow, the strategy, and focus on the amount.
    await expect(dialog.getByText("Step 2 of 2 · Amount and date")).toBeVisible({
      timeout: 15_000,
    });
    await expect(dialog.getByText(fixtureName)).toBeVisible();
    await expect(page.getByLabel("Allocation (USD)")).toBeFocused();

    // `add` left the URL as the flow opened (C8), so a reload cannot replay it.
    expect(page.url()).not.toContain("add=");

    const stepTwo = await buildAxe(page).analyze();
    expect(stepTwo.violations).toEqual([]);

    // Back to step 1, with the search box focused.
    await dialog.getByRole("button", { name: "Change strategy" }).click();
    await expect(dialog.getByText("Step 1 of 2 · Strategy")).toBeVisible();
    await expect(
      dialog.getByRole("searchbox", { name: "Search strategies" }),
    ).toBeFocused();

    const stepOne = await buildAxe(page).analyze();
    expect(stepOne.violations).toEqual([]);

    // Close: focus returns to the header trigger.
    await dialog.getByRole("button", { name: "Close without adding" }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("button", { name: /Add allocation — pick a strategy/ }),
    ).toBeFocused();

    // A reload must NOT reopen the flow.
    await page.reload();
    await expect(page.locator('h1:has-text("My allocation")')).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByRole("dialog", { name: "Add allocation" }),
    ).toHaveCount(0);
  });

  test("a malformed id opens step 1 with the not-available notice, never an error page", async ({
    page,
  }) => {
    test.skip(!HAS_SEED_ENV, "requires seed env");

    const allocator = await seedTestAllocator();
    await loginViaForm(page, allocator.email, allocator.password);

    await page.goto("/allocations?add=not-a-uuid");

    const dialog = page.getByRole("dialog", { name: "Add allocation" });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByText("Step 1 of 2 · Strategy")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("add-allocation-notice")).toContainText(
      "That strategy is not available to add.",
    );
    expect(page.url()).not.toContain("add=");
  });
});
