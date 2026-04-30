import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Lock the `accessibilityLayer={false}` contract on every recharts chart.
 *
 * Recharts 3.x defaults `accessibilityLayer={true}`, which adds
 * `tabIndex={0}` and `role="application"` to the chart's root SVG. With
 * no accessible name on a static visual chart, the SVG ends up in the
 * keyboard tab order as an "empty focus" stop — which broke
 * `e2e/strategy-v2-keyboard.spec.ts` (Tab #13 lands on the DrawdownChart
 * SVG instead of the rolling-window "3M" button).
 *
 * The data behind every chart on `/strategy/{id}/v2` is also surfaced
 * in the panel's KPI cells (Headline / Position / Volume etc.), so
 * disabling the layer keeps the tab order clean without removing data
 * access for screen readers.
 *
 * Source-level grep covers the contract for every recharts chart in
 * one place — adding a new chart that forgets the prop fails this test
 * before it can land.
 */

const CHART_DIR = join(__dirname, "..", "..", "src", "components", "charts");
const RECHARTS_TOPLEVEL_TAGS = [
  "AreaChart",
  "LineChart",
  "BarChart",
  "ComposedChart",
  "ScatterChart",
];

function readChartFiles(): { path: string; src: string }[] {
  const files = readdirSync(CHART_DIR).filter(
    (f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"),
  );
  return files.map((f) => ({
    path: join(CHART_DIR, f),
    src: readFileSync(join(CHART_DIR, f), "utf8"),
  }));
}

describe("recharts chart accessibilityLayer={false} contract", () => {
  it("every recharts top-level chart in src/components/charts/ has accessibilityLayer={false}", () => {
    const files = readChartFiles();
    const violations: string[] = [];

    for (const { path, src } of files) {
      for (const tag of RECHARTS_TOPLEVEL_TAGS) {
        // Match every opening-tag block (may span multiple lines until
        // the closing >). matchAll iterates without regex.exec.
        const tagOpenRe = new RegExp(`<${tag}\\b([^>]*)>`, "g");
        const matches = Array.from(src.matchAll(tagOpenRe));
        for (const match of matches) {
          const tagBlock = match[1];
          if (!/accessibilityLayer=\{false\}/.test(tagBlock)) {
            violations.push(
              `${path.split("/").pop()}: <${tag}> missing accessibilityLayer={false}`,
            );
          }
        }
      }
    }

    expect(
      violations,
      "Every recharts chart must opt out of the accessibility layer to keep " +
        "/strategy/{id}/v2 tab order clean (UI-SPEC §7.3, e2e/strategy-v2-keyboard.spec.ts).",
    ).toEqual([]);
  });
});
