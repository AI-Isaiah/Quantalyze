/**
 * Phase 13 / Plan 13-04 / DISCO-04 — sparkline single-accent regression gate.
 *
 * DESIGN.md DIFF-05 locks the rule: a sparkline trace is rendered with a
 * SINGLE color across all points. The color is driven by the FINAL value
 * of `sparkline_returns` (positive → accent, negative → negative-red,
 * zero/empty → benchmark-grey). This spec is the structural defense
 * against the historical regression where the sparkline was split per-point
 * by sign — producing a green-then-red trace that contradicts the
 * single-accent rule.
 *
 * Login fixture mirrors e2e/discovery-watchlist.spec.ts and
 * e2e/full-flow.spec.ts allocator account.
 *
 * RATIONALE for the drawdown assertion (third test): all 8 seed
 * STRATEGY_PROFILES have positive annualizedReturn, so the returns
 * sparkline never naturally renders the negative branch on seed data.
 * The drawdown sparkline ALWAYS renders negative by definition. Asserting
 * that drawdown SVGs use the negative color proves the negative-color
 * render path is functional in the live page even when seed data trends
 * positive. The component-level tests in StrategyTable.test.tsx +
 * sparkline-color.test.ts cover the returns-sparkline negative-fixture
 * branch via synthetic data.
 */

import { test, expect } from "@playwright/test";

test.describe("Discovery sparkline single-accent rule (DESIGN.md DIFF-05)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.fill(
      'input[name="email"], input[placeholder*="email" i]',
      "matratzentester24@gmail.com",
    );
    await page.fill('input[type="password"]', "Test12");
    await page.click('button:has-text("Sign in")');
    await page.waitForURL(/\/(discovery|strategies)/, { timeout: 10000 });
    await page.goto("/discovery/crypto-sma");
    await page.waitForSelector("table tbody tr", { timeout: 10000 });
  });

  test("no sparkline SVG on /discovery/crypto-sma mixes positive (#15803D) and negative (#DC2626) strokes", async ({
    page,
  }) => {
    const distinctPerSvg = await page.evaluate(() => {
      const svgs = Array.from(
        document.querySelectorAll(
          "table svg, [data-testid='strategy-grid'] svg",
        ),
      ) as SVGElement[];
      return svgs.map((svg) => {
        const strokes = new Set(
          Array.from(svg.querySelectorAll("path[stroke]"))
            .map((p) => (p as SVGPathElement).getAttribute("stroke") || "")
            .filter((s) => s && s !== "none")
            .map((s) => s.toLowerCase()),
        );
        return [...strokes];
      });
    });

    expect(distinctPerSvg.length).toBeGreaterThan(0);

    for (const strokes of distinctPerSvg) {
      // Forbidden: any single SVG mixing the positive-text color (#15803D
      // post-2026-04-30, #16A34A pre-shift) and negative (#DC2626) on the
      // same trace. The accent #1B6B5A is the canonical positive stroke;
      // the positive-text color would only appear on sparklines if someone
      // reintroduced split-color. Either being on the same path as #DC2626
      // is a failure. Both old + new green hex are matched so this guard
      // survives in-flight migrations.
      const hasGreen = strokes.some((s) =>
        /#15803d|#16a34a|var\(--color-positive\)/i.test(s),
      );
      const hasRed = strokes.some((s) =>
        /#dc2626|var\(--color-negative\)/i.test(s),
      );
      expect(hasGreen && hasRed).toBe(false);
    }
  });

  test("each sparkline SVG owns at most one stroke color (single-trace rule)", async ({
    page,
  }) => {
    const distinctPerSvg = await page.evaluate(() => {
      const svgs = Array.from(
        document.querySelectorAll(
          "table svg, [data-testid='strategy-grid'] svg",
        ),
      ) as SVGElement[];
      return svgs.map((svg) => {
        const strokes = new Set(
          Array.from(svg.querySelectorAll("path[stroke]"))
            .map((p) => (p as SVGPathElement).getAttribute("stroke") || "")
            .filter((s) => s && s !== "none"),
        );
        return strokes.size;
      });
    });

    for (const size of distinctPerSvg) {
      // Each sparkline is one stroked path → at most one stroke color.
      // The endpoint circle uses fill (not stroke). Drawdown SVGs may
      // have a fill path AND a stroke path — but the stroke set still
      // collapses to one color.
      expect(size).toBeLessThanOrEqual(1);
    }
  });

  test("drawdown sparkline path uses the negative color (#DC2626 / var(--color-negative)) — proves the negative-color render path is exercised on live data", async ({
    page,
  }) => {
    // The drawdown sparkline is the LAST sparkline cell per row in the
    // table (Sparkline at StrategyTable.tsx:464 with color="var(--color-negative)").
    // Locate it via td order: drawdown is the second-to-last <td> per row,
    // which means the LAST <svg> per row.
    const drawdownStrokes = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("table tbody tr"));
      return rows
        .map((row) => {
          const svgs = row.querySelectorAll("svg");
          const lastSvg = svgs[svgs.length - 1] as SVGElement | undefined;
          if (!lastSvg) return null;
          const path = lastSvg.querySelector(
            "path[stroke]",
          ) as SVGPathElement | null;
          return path?.getAttribute("stroke") ?? null;
        })
        .filter((s): s is string => s !== null);
    });

    expect(drawdownStrokes.length).toBeGreaterThan(0);
    for (const stroke of drawdownStrokes) {
      // Accept either the literal #DC2626 hex OR the CSS-var form
      // var(--color-negative). The Sparkline component passes `color`
      // straight through to the SVG stroke attribute, so the CSS-var
      // form is what the live DOM shows.
      expect(/(^#dc2626$)|(^var\(--color-negative\)$)/i.test(stroke.trim())).toBe(
        true,
      );
    }
  });
});
