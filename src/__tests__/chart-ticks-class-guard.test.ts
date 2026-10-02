/**
 * Phase 169.1.1 HYDRATIONTICKS, SC-1 — the engine-dependent power of ten
 * cannot come back into chart tick code.
 *
 * THE PROPERTY: chart ticks are rendered on the server (Node) and hydrated in
 * the browser (Chromium). The native power and base-10 logarithm functions are
 * implementation-approximated, and Node 22 and Chromium were measured to differ
 * by one ulp on the power of ten for several exponents. One ulp in a tick step
 * is enough to print "-0.0%" on one side and "+0.0%" on the other, and React
 * then throws the server tree away (React #418). Six tick sites carried the
 * idiom; all six now take their power of ten from `pow10` in
 * `@/lib/chart-ticks`, which parses a decimal literal and is identical in
 * every engine.
 *
 * WHAT THIS GUARD CHECKS
 *   1. No non-test `.ts`/`.tsx` file under `src/` contains a native base-10
 *      power call or a `10 **` exponent in CODE. Comments are stripped first
 *      (`stripCommentsPreserveLines`), so prose that names the idiom does not
 *      trip it, and line numbers stay real.
 *   2. `src/lib/chart-ticks.ts` itself calls no transcendental Math function.
 *   3. The four nice-tick builder bodies call no base-10 logarithm.
 *      `makeYTicks`'s log-scale decade lines are deliberately NOT checked: they
 *      are outside the locked class (RESEARCH Open Question 1).
 *   4. Each of the five rewired component files imports from the helper.
 *
 * The population in (1) is derived from disk on every run, so a file added
 * tomorrow is covered without editing this guard. Every matcher is self-tested
 * in both polarities below, so the guard can fail.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { stripCommentsPreserveLines } from "@/lib/source-scan";

const REPO_ROOT = process.cwd();
const SRC = join(REPO_ROOT, "src");

/** A native base-10 power call: `Math.pow(10, …)`. */
const NATIVE_POW10_RE = /Math\.pow\(\s*10\s*,/;
/** A `10 ** e` exponent (not `1.10 ** e`, not `x10 ** e`). */
const EXP_POW10_RE = /(^|[^.\w])10\s*\*\*/;
/** Transcendental Math calls and the exponent operator, banned in the helper. */
const HELPER_BANNED_RE = /Math\.pow\b|Math\.log10\b|Math\.log\(|Math\.exp\b|\*\*/;

const HELPER = "src/lib/chart-ticks.ts";

/** The five component files that must route their power of ten through the helper. */
const REWIRED_FILES = [
  "src/app/factsheet/[id]/v2/TimeSeriesChart.tsx",
  "src/app/factsheet/[id]/v2/SignaturePanels.tsx",
  "src/app/factsheet/[id]/v2/CrossSignaturePanels.tsx",
  "src/app/factsheet/[id]/v2/AnalyticalPanels.tsx",
  "src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx",
] as const;

/** Nice-tick builders whose bodies must not call log10 (file, function name). */
const BUILDER_REGIONS: ReadonlyArray<readonly [string, string]> = [
  ["src/app/factsheet/[id]/v2/TimeSeriesChart.tsx", "niceLinearTicks"],
  ["src/app/factsheet/[id]/v2/SignaturePanels.tsx", "niceTicks"],
  ["src/app/factsheet/[id]/v2/CrossSignaturePanels.tsx", "niceTicks"],
  ["src/app/factsheet/[id]/v2/AnalyticalPanels.tsx", "niceCountTicks"],
];

interface Hit {
  file: string;
  line: number;
  text: string;
}

/** Report every line of COMMENT-STRIPPED `source` matching the power-of-ten idiom. */
function findPow10Idiom(source: string, file: string): Hit[] {
  const code = stripCommentsPreserveLines(source, "ts");
  const hits: Hit[] = [];
  code.split("\n").forEach((text, i) => {
    if (NATIVE_POW10_RE.test(text) || EXP_POW10_RE.test(text)) {
      hits.push({ file, line: i + 1, text: text.trim() });
    }
  });
  return hits;
}

/**
 * The body of `function <name>(`: from its declaration line up to and
 * including the next line that starts with `}`. Returns null when absent.
 */
function functionRegion(source: string, name: string): string | null {
  const lines = source.split("\n");
  const start = lines.findIndex((l) => new RegExp(`\\bfunction ${name}\\(`).test(l));
  if (start === -1) return null;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].startsWith("}")) return lines.slice(start, i + 1).join("\n");
  }
  return null;
}

function isTestPath(rel: string): boolean {
  return /\.test\.[^/]+$/.test(rel) || rel.split("/").includes("__tests__");
}

function listScannedFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      listScannedFiles(abs, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    const rel = relative(REPO_ROOT, abs).split("\\").join("/");
    if (!isTestPath(rel)) out.push(rel);
  }
  return out;
}

const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");

describe("chart-ticks class guard — self-tests (the matchers can fail)", () => {
  it("reports a native base-10 power call in code", () => {
    const hits = findPow10Idiom("const m = Math.pow(10, -4);\n", "sample.ts");
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(1);
  });

  it("reports a `10 **` exponent in code", () => {
    const hits = findPow10Idiom("const a = 1;\nconst m = 10 ** e;\n", "sample.ts");
    expect(hits.map((h) => h.line)).toEqual([2]);
  });

  it("does NOT report the idiom inside a line comment or a block comment", () => {
    const src = [
      "// const m = Math.pow(10, -4);",
      "/* const m = 10 ** e; */",
      "/**",
      " * Math.pow(10, p) used to be here.",
      " */",
      "const ok = pow10(-4);",
    ].join("\n");
    expect(findPow10Idiom(src, "sample.ts")).toEqual([]);
  });

  it("does NOT report a power of a number that merely ends in 10", () => {
    expect(findPow10Idiom("const a = 1.10 ** 2; const b = x10 ** 2;\n", "sample.ts")).toEqual([]);
  });

  it("the helper matcher reports each banned call", () => {
    for (const sample of ["Math.pow(2, 3)", "Math.log10(x)", "Math.log(x)", "Math.exp(x)", "2 ** 3"]) {
      expect(HELPER_BANNED_RE.test(sample), sample).toBe(true);
    }
    expect(HELPER_BANNED_RE.test("Math.ceil(x) + Math.abs(y)")).toBe(false);
  });

  it("the region extractor finds a sample function body and stops at its closing brace", () => {
    const src = [
      "function other() {}",
      "function niceTicks(lo: number) {",
      "  const m = Math.log10(lo);",
      "  return m;",
      "}",
      "const after = Math.log10(2);",
    ].join("\n");
    const region = functionRegion(src, "niceTicks");
    expect(region).not.toBeNull();
    expect(region).toContain("Math.log10(lo)");
    expect(region).not.toContain("after");
    expect(functionRegion(src, "missing")).toBeNull();
  });
});

describe("chart-ticks class guard — the power-of-ten idiom is gone from src/", () => {
  const files = listScannedFiles(SRC);

  it("scans a real population (an empty scan would pass vacuously)", () => {
    expect(files.length).toBeGreaterThan(100);
    for (const f of [...REWIRED_FILES, HELPER]) expect(files).toContain(f);
    expect(files.some(isTestPath)).toBe(false);
  });

  it("no non-test source file computes a power of ten natively", () => {
    const hits = files.flatMap((f) => findPow10Idiom(read(f), f));
    const report = hits.map((h) => `  ${h.file}:${h.line}  ${h.text}`).join("\n");
    expect(
      hits,
      `The engine-dependent power of ten came back:\n${report}\n` +
        `Node and Chromium disagree by one ulp on it, which flips tick labels between ` +
        `server and browser (React #418). Use pow10 from "@/lib/chart-ticks" instead.`,
    ).toEqual([]);
  });

  it("the helper itself calls no transcendental Math function", () => {
    const code = stripCommentsPreserveLines(read(HELPER), "ts");
    const bad = code
      .split("\n")
      .map((text, i) => ({ line: i + 1, text: text.trim() }))
      .filter((l) => HELPER_BANNED_RE.test(l.text));
    expect(
      bad,
      `${HELPER} must stay engine-independent: only + - * /, Math.ceil and Math.abs. ` +
        `Found:\n${bad.map((b) => `  :${b.line}  ${b.text}`).join("\n")}`,
    ).toEqual([]);
  });

  it.each(BUILDER_REGIONS)("%s %s calls no base-10 logarithm", (file, name) => {
    const region = functionRegion(stripCommentsPreserveLines(read(file), "ts"), name);
    expect(region, `function ${name}( not found in ${file}; update this guard if it was renamed`).not.toBeNull();
    expect(
      region,
      `${file} ${name} calls the native base-10 logarithm again. Take the exponent from ` +
        `decimalExponent in "@/lib/chart-ticks" instead.`,
    ).not.toMatch(/Math\.log10\b/);
  });

  it.each(REWIRED_FILES)("%s imports from @/lib/chart-ticks", (file) => {
    expect(
      read(file),
      `${file} no longer imports the shared tick helper; its power of ten must come from pow10`,
    ).toMatch(/from "@\/lib\/chart-ticks"/);
  });
});
