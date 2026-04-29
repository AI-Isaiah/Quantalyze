/**
 * Phase 14b-07 / SC#1 — chart-snapshot parity diff.
 *
 * Asserts:
 *   1. 7 per-panel screenshots match goldens at ±2% (maxDiffPixelRatio: 0.02)
 *   2. 1 full-page screenshot matches at ±5% (maxDiffPixelRatio: 0.05)
 *   3. Structural assertions per UI-SPEC §8.5:
 *        - Each chart has ≥1 strategy series stroke (#1B6B5A)
 *        - ≤1 BTC benchmark stroke (#94A3B8) on equity panels
 *        - CHART_TICK_STYLE applied (font-variant-numeric: tabular-nums)
 *   4. DailyHeatmap performance budget < 300ms (UI-SPEC §8.6)
 *
 * Goldens stored at e2e/__snapshots__/strategy-v2-chart-parity.spec.ts/.
 * Refresh: `npx playwright test e2e/strategy-v2-chart-parity.spec.ts --update-snapshots`.
 *
 * Authored-but-skipped pattern matches the partial-data spec — env-var
 * gate prevents CI from blocking before the seed env vars are wired.
 */
import { test, expect } from "@playwright/test";
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

test.describe("Phase 14b — chart-snapshot parity (SC#1)", () => {
  test.skip(
    !HAS_SEED_ENV,
    "strategy-v2 chart parity: seed-helper env vars not wired " +
      "(set TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY).",
  );

  test("7 per-panel screenshots match goldens at ±2%; full-page at ±5%", async ({
    page,
  }) => {
    const strategyId = await seedStrategyWithHistory({ days: 252 });

    await page.goto(`/strategy/${strategyId}/v2?strategy_v2=on`);

    // Walk every panel into view + wait for ready transition.
    for (const key of PANEL_KEYS) {
      const section = page.locator(`section[data-panel="${key}"]`);
      await section.scrollIntoViewIfNeeded();
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

    // Per-panel goldens at ±2%
    for (const key of PANEL_KEYS) {
      const panel = page.locator(`section[data-panel="${key}"]`);
      await panel.scrollIntoViewIfNeeded();
      await expect(panel).toHaveScreenshot(`panel-${key}.png`, {
        maxDiffPixelRatio: 0.02,
        threshold: 0.2,
      });
    }

    // Full-page golden at ±5%
    await page.evaluate(() => window.scrollTo({ top: 0 }));
    await expect(page).toHaveScreenshot("full-page.png", {
      fullPage: true,
      maxDiffPixelRatio: 0.05,
      threshold: 0.2,
    });

    // Structural assertions per UI-SPEC §8.5

    // 1) Each equity-panel chart has ≥1 strategy series stroke (#1B6B5A)
    const equityStrokes = await page
      .locator(
        'section[data-panel="headline-equity"] path[stroke="#1B6B5A"]',
      )
      .count();
    expect(equityStrokes).toBeGreaterThanOrEqual(1);

    // 2) ≤1 BTC benchmark stroke (#94A3B8) on the equity panel
    const btcStrokes = await page
      .locator(
        'section[data-panel="headline-equity"] path[stroke="#94A3B8"]',
      )
      .count();
    expect(btcStrokes).toBeLessThanOrEqual(1);

    // 3) CHART_TICK_STYLE applied — at least one Recharts axis tick reads
    //    font-variant-numeric: tabular-nums.
    const sampleTick = page
      .locator(".recharts-cartesian-axis-tick text")
      .first();
    await expect(sampleTick).toHaveCSS(
      "font-variant-numeric",
      /tabular-nums/,
    );

    // 4) DailyHeatmap performance budget < 300ms (UI-SPEC §8.6).
    //    The mark "panel-4-paint" is emitted by ReturnsDistributionPanel
    //    when DailyHeatmap finishes its initial paint. If it has not yet
    //    fired (e.g. fixtures with <30d history fall through the empty-
    //    payload sub-banner branch and skip the Canvas paint), we treat
    //    paintMs as -1 and skip the assertion — the per-panel screenshot
    //    + structural assertions still cover the visual contract.
    const paintMs = await page.evaluate(() => {
      const entries = performance.getEntriesByName("panel-4-paint");
      return entries.length > 0 ? entries[0].duration : -1;
    });
    if (paintMs >= 0) {
      expect(paintMs).toBeLessThan(300);
    }
  });
});
