/**
 * Phase 14b-07 / A11Y-03 — keyboard-nav focus-order spec.
 *
 * Asserts the documented focus order from UI-SPEC §7.3:
 *   1-7.  Skip-links (7 links targeting #panel-{key} ids)
 *   8.    (Panel 1 Overview — read-only, skipped)
 *   9-13. Panel 2 segmented control (4 buttons + BTC checkbox)
 *   14.   (Panel 3 Drawdown — read-only)
 *   15.   (Panel 4 Returns distribution — read-only)
 *   16-18. Panel 5 window toggle (3M / 6M / 12M)
 *   19.   (Panel 6 Trades & positions — read-only)
 *   20.   (Panel 7 Exposure & greeks — read-only)
 *
 * Grok W-02 fix: explicitly call section.scrollIntoViewIfNeeded() BEFORE
 * each panel-section keyboard assertion. Lazy panels (4-7) only mount when
 * their <section> intersects the viewport. Without the scroll, the test
 * would silently skip the lazy panels' interactive children (Panel 5's
 * window toggle in particular).
 *
 * Authored-but-skipped pattern matches the partial-data spec.
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

test.describe("Phase 14b — strategy v2 keyboard nav (A11Y-03)", () => {
  test.skip(
    !HAS_SEED_ENV,
    "strategy-v2 keyboard: seed-helper env vars not wired " +
      "(set TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY).",
  );

  test("tab order matches UI-SPEC §7.3", async ({ page }) => {
    const strategyId = await seedStrategyWithHistory({ days: 365 });

    await page.goto(`/strategy/${strategyId}/v2?strategy_v2=on`);

    // Grok W-02 fix: scroll each panel into view BEFORE asserting tab
    // order. Lazy panels (4-7) only mount when their <section> intersects
    // the viewport. Without scrollIntoViewIfNeeded the test would silently
    // skip the lazy panels' interactive children (Panel 5's window toggle
    // in particular).
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

    // Scroll back to the top so the first Tab focuses skip-link 1.
    await page.evaluate(() => window.scrollTo({ top: 0 }));

    const expected: { label: string; panel: string | null }[] = [
      // 7 skip-links (UI-SPEC §10.5)
      { label: "Skip to Overview", panel: null },
      { label: "Skip to Headline metrics", panel: null },
      { label: "Skip to Drawdown", panel: null },
      { label: "Skip to Returns distribution", panel: null },
      { label: "Skip to Rolling metrics", panel: null },
      { label: "Skip to Trades & positions", panel: null },
      { label: "Skip to Exposure & greeks", panel: null },
      // Panel 2 segmented control: 4 buttons + 1 checkbox
      { label: "Cumulative", panel: "headline-equity" },
      { label: "Underwater", panel: "headline-equity" },
      { label: "Rolling Sharpe", panel: "headline-equity" },
      { label: "Log returns", panel: "headline-equity" },
      { label: "BTC benchmark", panel: "headline-equity" },
      // Panel 5 window toggle: 3 buttons (UI-SPEC §10.2)
      { label: "3M", panel: "rolling" },
      { label: "6M", panel: "rolling" },
      { label: "12M", panel: "rolling" },
    ];

    for (const { label, panel } of expected) {
      // Grok W-02: re-scroll the panel into view immediately before pressing
      // Tab. Sequential scrolling earlier in this test is not sufficient
      // because Panel 5's lazy mount can shift layout enough to push later
      // panels out of viewport again.
      if (panel) {
        await page
          .locator(`section[data-panel="${panel}"]`)
          .scrollIntoViewIfNeeded();
      }
      await page.keyboard.press("Tab");
      const focused = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el) return "";
        const text = el.textContent?.trim() ?? "";
        const ariaLabel = el.getAttribute("aria-label") ?? "";
        // Some focusable elements (e.g. checkbox <input>) have no
        // textContent; fall back to the surrounding <label> text via
        // labels[0] when present.
        const labelText =
          (el as HTMLInputElement).labels?.[0]?.textContent?.trim() ?? "";
        return [text, ariaLabel, labelText].filter(Boolean).join(" | ");
      });
      // Tolerate leading/trailing whitespace and ensure label is contained.
      expect(
        focused.includes(label),
        `Expected focused element to contain "${label}", got "${focused}"`,
      ).toBe(true);
    }
  });
});
