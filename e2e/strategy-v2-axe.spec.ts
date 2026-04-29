/**
 * Phase 14b-07 / A11Y-02 — axe-core scan on /strategy/{id}/v2.
 *
 * Asserts zero axe violations on the full 7-panel route AFTER every panel
 * has reached `data-panel-status="ready"`. Lazy panels (4-7) only mount
 * when their <section> intersects the viewport, so we explicitly scroll
 * each panel into view before scanning.
 *
 * Authored-but-skipped pattern matches Phase 14a partial-data spec:
 * test.skip when TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY are
 * absent so the spec is authored but not CI-blocking until the seed env
 * vars are wired.
 */
import { test, expect } from "@playwright/test";
import { buildAxe } from "./helpers/axe";
import { seedStrategyWithHistory } from "./helpers/seed-test-project";

const HAS_SEED_ENV =
  !!process.env.TEST_SUPABASE_URL &&
  !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

const PANEL_KEYS = [
  "overview",
  "headline-equity",
  "drawdown",
  "returns-distribution",
  "rolling",
  "trades",
  "exposure",
] as const;

test.describe("Phase 14b — strategy v2 axe (A11Y-02)", () => {
  test.skip(
    !HAS_SEED_ENV,
    "strategy-v2 axe: seed-helper env vars not wired " +
      "(set TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY) — Phase 14a fallback pattern.",
  );

  test("zero axe violations on /strategy/{id}/v2 with all 7 panels ready", async ({
    page,
  }) => {
    const strategyId = await seedStrategyWithHistory({ days: 365 });

    await page.goto(`/strategy/${strategyId}/v2?strategy_v2=on`);

    // Wait for each panel to reach data-panel-status="ready". Eager panels
    // (1, 2, 3) don't carry the attribute (they render immediately); the
    // lazy panels (4, 5, 6, 7) do. Scrolling into view triggers the
    // IntersectionObserver and unblocks the transition.
    for (const key of PANEL_KEYS) {
      const section = page.locator(`section[data-panel="${key}"]`);
      await section.scrollIntoViewIfNeeded();
      // For lazy panels the data-panel-status attribute exists; we wait
      // until it reads "ready". For eager panels (overview, headline-equity,
      // drawdown) the attribute is absent — toBeVisible() is enough.
      await expect(section).toBeVisible({ timeout: 10_000 });
      const hasStatus = await section.evaluate((el) =>
        el.hasAttribute("data-panel-status"),
      );
      if (hasStatus) {
        await expect(
          page.locator(
            `section[data-panel="${key}"][data-panel-status="ready"]`,
          ),
        ).toBeVisible({ timeout: 10_000 });
      }
    }

    const results = await buildAxe(page).analyze();
    expect(results.violations).toEqual([]);
  });
});
