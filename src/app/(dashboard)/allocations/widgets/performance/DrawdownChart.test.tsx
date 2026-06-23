import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Phase 30 / 30-03 / GRAPH-01 — chart-stack token-contract assertions.
 *
 * These are SOURCE-READ assertions (no render needed): they pin that the
 * drawdown chart reads its axis-tick / gridline / axis-line / tooltip /
 * negative-fill styling from `@/components/charts/chart-tokens.ts` rather
 * than inline literal hexes, so a future palette change (e.g. the
 * WCAG-audited shift Phase 33 anticipates) lands in ONE place instead of
 * drifting on this leaf.
 *
 * Non-vacuity (CLAUDE.md Rule 9 — tests verify intent): reintroducing an
 * inline `#DC2626` / `#64748B` / `#E2E8F0` chart hex, dropping the
 * chart-tokens import, or putting a literal `fontSize: 11` back on a chart
 * axis tick makes the relevant `it` FAIL. The EquityChart assert fails if
 * its accent stroke is hardcoded away from the `--color-chart-strategy`
 * CSS var.
 */

const DRAWDOWN_PATH = resolve(
  process.cwd(),
  "src/app/(dashboard)/allocations/widgets/performance/DrawdownChart.tsx",
);
const EQUITY_PATH = resolve(
  process.cwd(),
  "src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx",
);

// Strip `//` line comments and `/* … */` block comments so a hex mentioned
// in a doc comment never produces a false positive — the assertions below
// are about the executable source, not the prose.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
    .replace(/^\s*\/\/.*$/gm, "") // whole-line line comments
    .replace(/\/\/.*$/gm, ""); // trailing line comments
}

describe("DrawdownChart — GRAPH-01 chart-stack token contract (30-03)", () => {
  it("GRAPH-01 chart-stack tokens — drawdown reads chart-tokens, not inline hexes", () => {
    const src = stripComments(readFileSync(DRAWDOWN_PATH, "utf-8"));

    // (a) imports the chart-stack token contract.
    expect(src).toMatch(/from\s+["']@\/components\/charts\/chart-tokens["']/);

    // (b) no inline chart styling hex remains in executable source. The
    //     factsheet chart-stack literals (#DC2626 negative-fill, #64748B
    //     axis tick, #E2E8F0 axis line / tooltip border) must now resolve
    //     through chart-tokens — re-adding any one of them fails here.
    expect(src).not.toMatch(/#DC2626/);
    expect(src).not.toMatch(/#64748B/);
    expect(src).not.toMatch(/#E2E8F0/);

    // (c) no inline `fontSize: 11` axis-tick literal — the canonical tick
    //     size is CHART_TICK_STYLE.fontSize (12). Scoped to the Recharts
    //     `tick={{ … fontSize … }}` shape (mirrors the analog
    //     RollingVolatilityChart.test.tsx Test 8), so the unrelated
    //     visibility-toggle button chrome (out of GRAPH-01 scope) is not
    //     swept in. Re-introducing an inline axis tick={{ fontSize: 11 }}
    //     fails this assert.
    expect(src).not.toMatch(/tick=\{\{[^}]*fontSize/);

    // Positive control — the swapped-in tokens ARE present (proves the
    // negative asserts above aren't passing because the chart was gutted).
    expect(src).toMatch(/tick=\{CHART_TICK_STYLE\}/);
    expect(src).toMatch(/axisLine=\{\{\s*stroke:\s*CHART_BORDER\s*\}\}/);
    expect(src).toMatch(/contentStyle=\{CHART_TOOLTIP_STYLE\}/);
    expect(src).toMatch(/stopColor=\{CHART_NEGATIVE\}/);
  });

  it("GRAPH-01 — equity chart already chart-stack compliant (verification-only)", () => {
    const src = stripComments(readFileSync(EQUITY_PATH, "utf-8"));

    // EquityChart is a hand-rolled SVG (not Recharts) so CSS vars resolve;
    // its primary portfolio stroke reads var(--color-chart-strategy) (the
    // CHART_ACCENT #1B6B5A identity). This pins GRAPH-01's verification-only
    // resolution for the equity chart: a future regression that hardcodes
    // the accent stroke away from the CSS var fails here.
    expect(src).toMatch(/stroke="var\(--color-chart-strategy\)"/);
  });
});
