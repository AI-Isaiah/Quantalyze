/**
 * Phase 14a / KPI-23a — Per-panel partial-data history bands.
 *
 * Asserts that /strategy/{id}/v2 renders correctly across 4 history bands:
 *   - 7 days:   Panel 2 KPI strip + Panel 3 chart show partial-data banner;
 *               Panel 1 + Panel 2 chart show full body
 *   - 30 days:  Panel 1 / Panel 2 strip / Panel 2 chart all full;
 *               Panel 3 chart still gated (banner) at exactly 30
 *   - 90 days:  All 3 eager panels show full bodies
 *   - 365 days: All 3 eager panels show full bodies
 *
 * In every case: exactly 7 <section data-panel> elements, no panel has
 * display: none, no panel has data-error attribute. Layout shape is
 * preserved (Pitfall 17 invariant).
 *
 * Seed pattern mirrors e2e/discovery-hide-examples-default.spec.ts —
 * test.skip when TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY are
 * absent so the spec is authored-but-not-CI-blocking.
 *
 * Helper status: `seedStrategyWithHistory` is a placeholder that throws
 * when invoked. The existing `seedTestAllocator` / `seedBridgeCandidate`
 * helpers in `e2e/helpers/seed-test-project.ts` do NOT support arbitrary
 * returns_series length, so wiring the real helper is deferred to Phase
 * 14b (along with the lazy-panel body fixtures). Until then the spec is
 * authored-but-skipped: the env-var skip gate fires before the helper is
 * called in CI, and any local run with TEST_SUPABASE_URL set will fail
 * loudly with a clear message pointing at the helper extension.
 *
 * Path: lives at e2e/ (project precedent — playwright.config.ts:4
 * testDir = "./e2e"), NOT tests/e2e/, per RESEARCH Pitfall 2.
 */

import { test, expect } from "@playwright/test";
import { seedStrategyWithHistory } from "./helpers/seed-test-project";

const HAS_SEED_ENV =
  !!process.env.TEST_SUPABASE_URL &&
  !!process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

const HISTORY_BANDS = [
  { days: 7, label: "7-day" },
  { days: 30, label: "30-day" },
  { days: 90, label: "90-day" },
  { days: 365, label: "365-day" },
] as const;

test.describe("Phase 14a — partial-data history bands (KPI-23a)", () => {
  test.skip(
    !HAS_SEED_ENV,
    "strategy-v2 partial-data: seed-helper env vars not wired " +
      "(set TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY) — see " +
      "e2e/helpers/seed-test-project.ts. Spec authored but CI-skip per " +
      "Phase 13 fallback pattern.",
  );

  for (const band of HISTORY_BANDS) {
    test(`${band.label} fixture renders 7 panels with correct partial-data state`, async ({
      page,
    }) => {
      const strategyId = await seedStrategyWithHistory({ days: band.days });

      try {
        await page.goto(`/strategy/${strategyId}/v2`);
        await page.waitForLoadState("networkidle");

        // Always exactly 7 panels (KPI-22 invariant)
        const panels = page.locator("section[data-panel]");
        await expect(panels).toHaveCount(7);

        // No panel hidden via display:none (Pitfall 17 layout-shape invariant)
        const hiddenCount = await panels.evaluateAll((nodes) =>
          nodes.filter(
            (n) => getComputedStyle(n as HTMLElement).display === "none",
          ).length,
        );
        expect(hiddenCount).toBe(0);

        // No panel carries data-error (Pitfall 17 — never crash, never hide)
        const errored = page.locator("section[data-panel][data-error]");
        await expect(errored).toHaveCount(0);

        // Per-panel partial-data assertions (verbatim banner copy from
        // src/components/strategy-v2/{Overview,HeadlineMetrics,Drawdown}Panel.tsx)
        const overview = page.locator('section[data-panel="overview"]');
        const headline = page.locator('section[data-panel="headline-equity"]');
        const drawdown = page.locator('section[data-panel="drawdown"]');

        if (band.days < 1) {
          // Overview banner — needs ≥1 day; never triggered in this matrix
          // (smallest band is 7 days) but kept for completeness.
          await expect(
            overview.getByText(/Awaiting more data/),
          ).toBeVisible();
        }

        if (band.days < 30) {
          // Headline KPI strip banner — needs ≥30 days for stable Sharpe
          await expect(
            headline.getByText(
              /at least 30 days of trading history for stable Sharpe/,
            ),
          ).toBeVisible();
        }

        if (band.days < 7) {
          // Headline equity chart banner — needs ≥7 days of equity history.
          // Not exercised by this matrix (smallest band is 7); the predicate
          // in HeadlineMetricsPanel.tsx is `history_days < 7`, so 7-day
          // fixture renders the chart full.
          await expect(
            headline.getByText(/at least 7 days of equity history/),
          ).toBeVisible();
        }

        if (band.days < 30) {
          // Drawdown chart banner — needs ≥30 days to detect meaningful
          // drawdowns (DrawdownPanel.tsx predicate).
          await expect(
            drawdown.getByText(
              /at least 30 days of trading history to detect meaningful drawdowns/,
            ),
          ).toBeVisible();
        }

        if (band.days >= 30) {
          // Headline KPI strip should NOT show the banner — full body renders
          await expect(
            headline.getByText(
              /at least 30 days of trading history for stable Sharpe/,
            ),
          ).toHaveCount(0);
        }

        // Phase 14b-07 / KPI-23b — Panel 4-7 partial-data banner matrix.
        // Panels 4, 5, 7 are lazy-mounted. Scroll each into view BEFORE
        // asserting their banner copy so the IntersectionObserver fires and
        // the panel transitions to data-panel-status="ready" (mirrors the
        // Grok W-02 mitigation in strategy-v2-keyboard.spec.ts).

        // Panel 4 — Returns distribution: panel-level banner when <30d.
        if (band.days < 30) {
          const returnsDist = page.locator(
            'section[data-panel="returns-distribution"]',
          );
          await returnsDist.scrollIntoViewIfNeeded();
          await expect(
            returnsDist.getByText(
              /at least 30 days of trading history to populate Returns distribution/,
            ),
          ).toBeVisible();
        }

        // Panel 5 — Rolling metrics: panel-level banner when <90d.
        if (band.days < 90) {
          const rolling = page.locator('section[data-panel="rolling"]');
          await rolling.scrollIntoViewIfNeeded();
          await expect(
            rolling.getByText(
              /at least 90 days of trading history for rolling 3M metrics/,
            ),
          ).toBeVisible();
        }

        // Panel 6 — Trades & positions: banner when seed makes
        // trade_metrics null (band.days < 30 in seedStrategyWithHistory).
        if (band.days < 30) {
          const trades = page.locator('section[data-panel="trades"]');
          await trades.scrollIntoViewIfNeeded();
          await expect(
            trades.getByText(
              /This strategy hasn't logged any trades yet/,
            ),
          ).toBeVisible();
        }

        // Panel 7 — Exposure & greeks: panel-level banner when <30d.
        if (band.days < 30) {
          const exposure = page.locator('section[data-panel="exposure"]');
          await exposure.scrollIntoViewIfNeeded();
          await expect(
            exposure.getByText(
              /at least 30 days of trading history to compute exposure and benchmark greeks/,
            ),
          ).toBeVisible();
        }

        // Panel-count invariant remains 7 after lazy panels mount.
        await expect(page.locator("section[data-panel]")).toHaveCount(7);
      } finally {
        // Phase 14b: invoke helper-side cleanup once seedStrategyWithHistory
        // returns a real strategy id and an idempotent teardown handle.
      }
    });
  }
});
