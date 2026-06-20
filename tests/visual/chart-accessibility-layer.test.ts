import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Lock the `accessibilityLayer={false}` contract on every recharts chart
 * IN THE WHOLE CODEBASE — not just `src/components/charts/`.
 *
 * Recharts 3.x defaults `accessibilityLayer={true}`, which adds
 * `tabIndex={0}` and `role="application"` to the chart's root SVG. With
 * no accessible name on a static visual chart, the SVG ends up in the
 * keyboard tab order as an "empty focus" stop — which broke
 * `e2e/strategy-v2-keyboard.spec.ts` (Tab #13 lands on the DrawdownChart
 * SVG instead of the rolling-window "3M" button). The fix has to apply
 * to every recharts chart on every route — strategy, allocations
 * dashboard widgets, portfolio surfaces. The earlier scope of
 * `src/components/charts/` only closed the bug on the strategy-v2 page;
 * 17+ allocations widgets and several portfolio charts kept the default.
 *
 * Source-level grep covers the contract for every recharts chart in
 * one place — adding a new chart that forgets the prop fails this test
 * before it can land.
 */

const REPO_ROOT = join(__dirname, "..", "..");
const SRC_DIR = join(REPO_ROOT, "src");
const RECHARTS_TOPLEVEL_TAGS = [
  "AreaChart",
  "LineChart",
  "BarChart",
  "ComposedChart",
  "ScatterChart",
  "PieChart",
  "RadarChart",
  "RadialBarChart",
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      out.push(...walk(full));
    } else if (entry.endsWith(".tsx") && !entry.endsWith(".test.tsx")) {
      out.push(full);
    }
  }
  return out;
}

function readChartFiles(): { path: string; src: string }[] {
  return walk(SRC_DIR)
    .map((path) => ({ path, src: readFileSync(path, "utf8") }))
    // Only files that actually import from recharts can render a recharts chart
    .filter(({ src }) => /from\s+["']recharts["']/.test(src));
}

describe("recharts accessibilityLayer={false} contract (whole codebase)", () => {
  it("every recharts top-level chart carries accessibilityLayer={false}", () => {
    const files = readChartFiles();
    const violations: string[] = [];

    for (const { path, src } of files) {
      for (const tag of RECHARTS_TOPLEVEL_TAGS) {
        const tagOpenRe = new RegExp(`<${tag}\\b([^>]*)>`, "g");
        const matches = Array.from(src.matchAll(tagOpenRe));
        for (const match of matches) {
          const tagBlock = match[1];
          if (!/accessibilityLayer=\{false\}/.test(tagBlock)) {
            const rel = path.replace(REPO_ROOT + "/", "");
            violations.push(
              `${rel}: <${tag}> missing accessibilityLayer={false}`,
            );
          }
        }
      }
    }

    expect(
      violations,
      "Every recharts chart must opt out of the accessibility layer to keep " +
        "tab order clean across all routes (UI-SPEC §7.3, " +
        "e2e/strategy-v2-keyboard.spec.ts).",
    ).toEqual([]);
  });

  it("scans the expected recharts files (smoke check on coverage breadth)", () => {
    const files = readChartFiles();
    // Post-B7b-2 (pruned the orphaned widget-grid renderers): the dead
    // allocations chart widgets were deleted, so the surviving recharts files
    // are ~21 (12 src/components/charts + the surviving allocations widgets +
    // 3 portfolio + 1 strategy + 4 strategy-v2). Floor kept just below the live
    // count purely as a glob/path-regression guard (catches readChartFiles
    // silently matching 0 files).
    // tech-debt #13 (dead-code removal): deleted 2 zero-importer recharts
    // charts (src/components/charts/MonthlyReturnsBar.tsx, RiskOfRuin.tsx;
    // never rendered, so no live accessibility surface), dropping the live
    // count to 19 — floor lowered to 18 to stay just below it.
    expect(files.length).toBeGreaterThanOrEqual(18);
  });
});
