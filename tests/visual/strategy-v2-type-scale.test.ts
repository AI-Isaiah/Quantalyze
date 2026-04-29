import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Phase 14a / DESIGN-02 — 4-size / 2-weight type contract enforcement.
 *
 * UI-SPEC §6 forbidden Tailwind classes inside src/components/strategy-v2/**\/*.tsx:
 *   Sizes: text-[11px], text-[13px], text-[14px], text-sm, text-xl, text-2xl
 *   Weights: font-medium, font-light, font-bold
 * Allowed:
 *   Sizes: text-xs (12px), text-base (16px), text-lg (18px), text-[32px] (page H1 only)
 *   Weights: font-normal (400), font-semibold (600)
 */

const V2_DIR = resolve(process.cwd(), "src/components/strategy-v2");
const FORBIDDEN_SIZES = [
  /\btext-\[11px\]/,
  /\btext-\[13px\]/,
  /\btext-\[14px\]/,
  /\btext-sm\b/,
  /\btext-xl\b/,
  /\btext-2xl\b/,
];
const FORBIDDEN_WEIGHTS = [
  /\bfont-medium\b/,
  /\bfont-light\b/,
  /\bfont-bold\b/,
];

/**
 * Phase 14b-07 / UI-SPEC §12.2 — extend the v2-scoped type-scale lint to
 * the 6 NEW chart files added in Phase 14b. The chart components must
 * honor the same 4-size / 2-weight contract as the strategy-v2 panels
 * since they're rendered inside the v2 layout. Listed explicitly to avoid
 * regressing legacy v1 chart components (some of which were authored
 * before the lint contract existed).
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

describe("strategy-v2 type-scale lint (DESIGN-02)", () => {
  it("zero forbidden size classes", () => {
    const files = listTsxFiles(V2_DIR);
    expect(files.length).toBeGreaterThan(0);
    const violations: { file: string; pattern: string }[] = [];
    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      for (const re of FORBIDDEN_SIZES) {
        if (re.test(content)) violations.push({ file, pattern: re.source });
      }
    }
    expect(violations).toEqual([]);
  });

  it("zero forbidden weight classes", () => {
    const files = listTsxFiles(V2_DIR);
    expect(files.length).toBeGreaterThan(0);
    const violations: { file: string; pattern: string }[] = [];
    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      for (const re of FORBIDDEN_WEIGHTS) {
        if (re.test(content)) violations.push({ file, pattern: re.source });
      }
    }
    expect(violations).toEqual([]);
  });

  it("zero forbidden size classes in Phase 14b chart files (UI-SPEC §12.2)", () => {
    expect(PHASE_14B_CHART_FILES.length).toBe(6);
    const violations: { file: string; pattern: string }[] = [];
    for (const file of PHASE_14B_CHART_FILES) {
      const content = readFileSync(file, "utf-8");
      for (const re of FORBIDDEN_SIZES) {
        if (re.test(content)) violations.push({ file, pattern: re.source });
      }
    }
    expect(violations).toEqual([]);
  });

  it("zero forbidden weight classes in Phase 14b chart files (UI-SPEC §12.2)", () => {
    expect(PHASE_14B_CHART_FILES.length).toBe(6);
    const violations: { file: string; pattern: string }[] = [];
    for (const file of PHASE_14B_CHART_FILES) {
      const content = readFileSync(file, "utf-8");
      for (const re of FORBIDDEN_WEIGHTS) {
        if (re.test(content)) violations.push({ file, pattern: re.source });
      }
    }
    expect(violations).toEqual([]);
  });
});
