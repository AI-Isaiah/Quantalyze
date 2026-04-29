import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Phase 14a / A11Y-01 — WCAG-AA chart-axis contrast.
 *
 * Asserts:
 *   (a) getContrastRatio(CHART_AXIS_TICK, "#FFFFFF") >= 4.5
 *   (b) Zero literal `fill: "#94A3B8"` and zero literal `fill: "#718096"` in
 *       any v2 panel file. (#94A3B8 is allowed as a stroke for benchmark lines —
 *       Pitfall 4. We only scope this grep to v2 panel files; reused
 *       components are out of scope.)
 *
 * The luminance helper is a 12-line hand-roll per the RESEARCH "Don't
 * Hand-Roll" recommendation — `polished` would add a dependency for one
 * test.
 */

function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const cleaned = hex.replace("#", "");
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function getContrastRatio(fg: string, bg: string): number {
  const lFg = relativeLuminance(fg);
  const lBg = relativeLuminance(bg);
  const lighter = Math.max(lFg, lBg);
  const darker = Math.min(lFg, lBg);
  return (lighter + 0.05) / (darker + 0.05);
}

const CHART_AXIS_TICK = "#64748B";
const FORBIDDEN_TEXT_FILLS = ["#94A3B8", "#718096"];
const V2_DIR = resolve(process.cwd(), "src/components/strategy-v2");

/**
 * Phase 14b-07 / UI-SPEC §12.2 — scan the 6 NEW chart files added in
 * Phase 14b for the same forbidden text-fill regression. These files are
 * NOT under src/components/strategy-v2/, so the V2_DIR walker doesn't
 * catch them. We list them explicitly rather than blanket-globbing
 * src/components/charts/** to avoid sweeping legacy v1 chart components
 * (some of which legitimately use #94A3B8 as a benchmark stroke — the
 * forbidden pattern is text-FILL on text/legend nodes, not stroke).
 */
const PHASE_14B_CHART_FILES = [
  "src/components/charts/DailyHeatmap.tsx",
  "src/components/charts/NetGrossExposureChart.tsx",
  "src/components/charts/TurnoverChart.tsx",
  "src/components/charts/RollingVolatilityChart.tsx",
  "src/components/charts/RollingSortinoChart.tsx",
  "src/components/charts/RollingAlphaBetaChart.tsx",
].map((p) => resolve(process.cwd(), p));

function listTsxFiles(dir: string): string[] {
  const out: string[] = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      const s = statSync(full);
      if (s.isDirectory()) stack.push(full);
      else if (
        s.isFile() &&
        /\.tsx?$/.test(entry) &&
        !entry.endsWith(".test.tsx") &&
        !entry.endsWith(".test.ts")
      ) {
        out.push(full);
      }
    }
  }
  return out;
}

describe("chart-axis contrast (A11Y-01)", () => {
  it("CHART_AXIS_TICK on white meets WCAG AA (>= 4.5:1)", () => {
    expect(getContrastRatio(CHART_AXIS_TICK, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
  });

  it("zero forbidden text-fill colors in v2 panel files", () => {
    const files = listTsxFiles(V2_DIR);
    expect(files.length).toBeGreaterThan(0);
    const violations: { file: string; pattern: string }[] = [];
    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      for (const forbidden of FORBIDDEN_TEXT_FILLS) {
        // Match: fill: "#94A3B8" / fill: "#718096" / fill:"..." with optional spacing
        const pattern = new RegExp(`fill\\s*:\\s*["']${forbidden}["']`, "gi");
        if (pattern.test(content)) {
          violations.push({ file, pattern: `fill: "${forbidden}"` });
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("zero forbidden text-fill colors in Phase 14b chart files (UI-SPEC §12.2)", () => {
    expect(PHASE_14B_CHART_FILES.length).toBe(6);
    const violations: { file: string; pattern: string }[] = [];
    for (const file of PHASE_14B_CHART_FILES) {
      const content = readFileSync(file, "utf-8");
      for (const forbidden of FORBIDDEN_TEXT_FILLS) {
        const pattern = new RegExp(`fill\\s*:\\s*["']${forbidden}["']`, "gi");
        if (pattern.test(content)) {
          violations.push({ file, pattern: `fill: "${forbidden}"` });
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
