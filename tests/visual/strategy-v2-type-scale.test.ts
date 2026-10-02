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

/**
 * Phase 170 C1-F1 / C1-F3 (2026-09-27, landed 2026-09-30 by plan 170-12) — the
 * factsheet's two stacked strips must not read as the same strip.
 *
 * ⛔ WHY THIS EXISTS. `SectionNav` (the document's table of contents) and
 * `ControlBar` (its actions) were two rows of identical `text-micro font-mono
 * uppercase tracking-wider` pills. The contents strip keeps the mono data
 * voice; the action buttons move to the DM Sans interactive voice DESIGN.md
 * requires for buttons (`text-caption`, sentence case). A later edit that
 * pastes the old mono pill class back onto any factsheet button re-creates the
 * look-alike pair, and the first arm goes red.
 *
 * ⚠️ There were NO pins for these controls before this block (measured at
 * d37163993: this file linted only `src/components/strategy-v2/**` and six
 * chart files). They are added here rather than "updated".
 *
 * Source lint, same style as the blocks above: jsdom does no layout, and the
 * contract is a class-string contract.
 */
const FACTSHEET_VIEW = resolve(
  process.cwd(),
  "src/app/factsheet/[id]/v2/FactsheetView.tsx",
);
/** The pre-170 ControlBar pill voice, as one run of classes. */
const MONO_PILL = "text-micro font-mono uppercase tracking-wider rounded-sm";

describe("factsheet ControlBar voice vs SectionNav (Phase 170 C1-F1, C1-F3)", () => {
  const src = readFileSync(FACTSHEET_VIEW, "utf-8");

  it("no factsheet action button carries the mono pill voice", () => {
    expect(src.split(MONO_PILL).length - 1).toBe(0);
  });

  it("the action buttons carry the DM Sans caption voice with their secondary border", () => {
    // Display summary, Reset view, Reset 1x, ShareLinkButton, both
    // ShareRevokeControl arms (Revoke link / Revoke; Keep link has no border),
    // Compare strategies.
    const bordered = "px-2.5 py-1 text-caption rounded-sm border bg-surface-subtle";
    expect(src.split(bordered).length - 1).toBeGreaterThanOrEqual(7);
  });

  it("SectionNav keeps the mono eyebrow voice", () => {
    expect(src).toContain(
      'className="flex items-center gap-1 px-1 text-micro font-mono uppercase tracking-[0.18em]"',
    );
  });

  it("the LEVERAGE input label stays a mono data label", () => {
    expect(src).toContain(
      'className="text-micro font-mono uppercase tracking-wider text-text-muted"',
    );
  });

  it("the owner-pending share controls sit inside the notice, not hung below it", () => {
    expect(src).not.toContain("-mt-4");
    expect(src).toContain('className="mt-3 flex flex-wrap items-center gap-2"');
  });
});
