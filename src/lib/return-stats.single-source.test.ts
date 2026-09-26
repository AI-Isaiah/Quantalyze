// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Phase 166.2 (COMPUTEONCE): the permanent compute-once gate for dispersion ratios.
 *
 * D-17, the founder's direction, verbatim: "Why don't you calculate Sharpe once and
 * the 20 places all read it from there?" Every TypeScript Sharpe, Pearson and beta
 * over daily returns is computed ONCE, in src/lib/return-stats.ts, and every site
 * calls it. A rule that lives only in a plan is not a gate, so this file is the
 * gate, on the Phase 108 "second Sharpe" template (scenario-backbone-gates.test.ts).
 * D-20 B1 widened it from an import rule plus five expressions to three layers,
 * because a retired copy returning under a different spelling, or a new Sharpe in a
 * new file, passed the narrow version:
 *
 *   1. THE IMPORT RULE. Each of the 16 Tier-2 site files exists and has a live
 *      import from @/lib/return-stats. T14 (og-metrics.ts computeOgHeadline) is in
 *      the list for its COMPUTED arm (D-19); its persisted-value read belongs to
 *      Phase 169 plan 04. T18 (factsheet/comparator-block.ts, the vol-match scale)
 *      is NOT in the list: it is fixed at its source, because compute's snapped
 *      ann_vol is 0 on residue, so the existing ann_vol > 0 guard is already right;
 *      the file computes no ratio and Phase 169 owns its edits.
 *   2. THE RETIRED-EXPRESSION TABLE. Every literal an acceptance criterion of plans
 *      166.2-01 to 166.2-05 greps to zero, one { file, token, plan } row each, each
 *      measured present at the merge-base before the phase. No plan SUMMARY records
 *      a KEPT exception (166.2-04 deleted compute.ts's private pstdev outright), so
 *      every measured row is in the table. Plus the whole-tree retirements: no live
 *      import of the deleted correlation module, no live rolling-correlation or
 *      rolling-metric token, and the deleted module absent from disk.
 *   3. THE WHOLE-TREE SHAPE MATCHER. Over every .ts / .tsx under src/ except tests,
 *      __tests__/, fixtures/, __snapshots__/ and return-stats.ts itself, applied to
 *      the comment-stripped WHOLE text (so an expression split across lines still
 *      matches), nine shipped forms. ID is an identifier-start operand, so a
 *      numeric operand never matches:
 *        SHARPE S0  ( x * periodsPerYear | ppy | sqrtN | ANNUAL | N ) / d
 *        SHARPE S1  ( ... ) / ( d * Math.sqrt(   or   ( d * sqrtN
 *        SHARPE S2  ( m / s ) * Math.sqrt(
 *        SHARPE S3  ID / ID * Math.sqrt(                      (D-21)
 *        SHARPE S4  Math.sqrt(N) * ID / ID                    (D-21)
 *        PEARSON P0 cov / Math.sqrt(
 *        PEARSON P1 Math.sqrt( ID * ID ), which also catches the two-step
 *                   denom = Math.sqrt(va * vb); ... cov / denom       (D-21)
 *        PEARSON P2 cov / ( a * b )
 *        BETA       cov / var
 *      Every match must be covered by a COUNT-PINNED allowlist entry; an entry whose
 *      live count differs from its pin fails as stale. Annualised volatility and
 *      tracking error are a dispersion TIMES Math.sqrt(N), not a ratio, so the
 *      shapes do not match them by design. By design P1 flags ANY future product of
 *      two identifiers under a root; a legitimate non-Pearson one earns an allowlist
 *      entry with its reason (the allowlist is the escape, never a narrower regex).
 *
 * KNOWN UNMATCHED (D-22; measured, 0 hits each with the shipped regexes). The matcher
 * is not a whole-language guard. A copy in one of these seven forms is caught only
 * by layers 1 and 2, the import rule and the retired-expression table:
 *        mean(r) / stdDev(r) * Math.sqrt(N)
 *        mean(r) * Math.sqrt(N) / stdDev(r)
 *        (mu * Math.sqrt(N)) / sd
 *        Math.sqrt(N) * (m / s)
 *        (m * 252) / s
 *        cov / (Math.sqrt(va) * Math.sqrt(vb))
 *        covariance(a,b) / variance(b)
 * The regexes were NOT widened in D-22: any widening moves the measured 26-hit pin
 * of the merge-base tree (20 in-class, 6 allowlisted) and needs a fresh measurement.
 *
 * Constraint on later phases (D-21): this gate constrains every later src/ edit,
 * including Phase 169's and 167.x's edits to the Tier-2 files. A new ratio copy fails
 * CI until it calls @/lib/return-stats or earns a reasoned allowlist entry.
 *
 * Comment stripping. The template's stripComments drops any line whose trimmed start
 * is "*", which would also drop a continuation line starting with a multiplication and
 * hide a split Sharpe. So this gate strips block comments by span and line comments by
 * a "//" not preceded by ":" (a URL), in ONE left-to-right pass, and keeps every
 * newline so a hit reports its true line. The forbidden tokens below are built by
 * concatenation so this file cannot match itself; it is also a test file, which the
 * shape scan excludes.
 */

const SRC_ROOT = join(process.cwd(), "src");
const SELF_REL = "src/lib/return-stats.single-source.test.ts";
const RETURN_STATS_REL = "src/lib/return-stats.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Blank out comments, keeping every newline so line numbers stay true. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\/|(?<!:)\/\/[^\n]*/g, m => m.replace(/[^\n]/g, " "));
}

const count = (text: string, token: string): number => text.split(token).length - 1;

/** Every .ts / .tsx under dir, as posix paths relative to dir's parent ("src/..."). */
function walkSource(dir: string, skipTestFiles: boolean, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "__snapshots__") continue;
    if (skipTestFiles && (entry.name === "__tests__" || entry.name === "fixtures")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSource(full, skipTestFiles, acc);
    } else if (/\.tsx?$/.test(entry.name)) {
      if (skipTestFiles && /\.test\.tsx?$/.test(entry.name)) continue;
      acc.push(full);
    }
  }
  return acc;
}

const relOf = (root: string, full: string): string =>
  ["src", ...relative(root, full).split(sep)].join("/");

// ---------------------------------------------------------------------------
// Layer 3: the whole-tree shape matcher
// ---------------------------------------------------------------------------

type Shape = "S0" | "S1" | "S2" | "S3" | "S4" | "P0" | "P1" | "P2" | "BETA";
type Hit = { file: string; line: number; shape: Shape; text: string };

const ID = "[A-Za-z_$][\\w.$]*";
const SHAPES: ReadonlyArray<readonly [Shape, RegExp]> = [
  ["S0", /\*\s*(?:periodsPerYear|ppy|sqrtN|ANNUAL|N)\s*\)\s*\/\s*[\w.]+/g],
  ["S1", /\)\s*\/\s*\(\s*[\w.]+\s*\*\s*(?:Math\.sqrt\(|sqrtN\b)/g],
  ["S2", /(?<!Math\.sqrt)\(\s*[\w.]+\s*\/\s*[\w.]+\s*\)\s*\*\s*Math\.sqrt\(/g],
  ["S3", new RegExp(`(?<![\\w.$)])${ID}\\s*\\/\\s*${ID}\\s*\\*\\s*Math\\.sqrt\\(`, "g")],
  ["S4", new RegExp(`Math\\.sqrt\\([^()]*\\)\\s*\\*\\s*${ID}\\s*\\/\\s*${ID}(?![\\w.$(])`, "g")],
  ["P0", /\w*cov\w*\s*\/\s*Math\.sqrt\(/gi],
  ["P1", new RegExp(`Math\\.sqrt\\(\\s*${ID}\\s*\\*\\s*${ID}\\s*\\)`, "g")],
  ["P2", /\w*cov\w*\s*\/\s*\(\s*[\w.]+\s*\*\s*[\w.]+\s*\)/gi],
  ["BETA", /\w*cov\w*\s*\/\s*var\w*/gi],
];

/** Every shape hit in one file's text (comments stripped here). */
function matchShapes(file: string, source: string): Hit[] {
  const code = stripComments(source);
  const hits: Hit[] = [];
  for (const [shape, re] of SHAPES) {
    for (const m of code.matchAll(re)) {
      hits.push({
        file,
        line: code.slice(0, m.index).split("\n").length,
        shape,
        text: m[0].replace(/\s+/g, " "),
      });
    }
  }
  return hits;
}

/** The whole-tree scan over a src/ root: the live gate and the merge-base block share it. */
function scanShapes(root: string): Hit[] {
  const hits: Hit[] = [];
  for (const full of walkSource(root, true)) {
    const file = relOf(root, full);
    if (file === RETURN_STATS_REL) continue;
    hits.push(...matchShapes(file, readFileSync(full, "utf8")));
  }
  return hits;
}

type AllowEntry = {
  file: string;
  shape: Shape;
  denominator: string;
  reason: string;
  count: number;
};

// Each entry is an annualised excess return over something that is NOT the
// return series' own dispersion, so it is not a Sharpe and return-stats does not
// own it. Pinned by count: one more copy, or one fewer, fails as stale.
const ALLOWLIST: readonly AllowEntry[] = [
  // Sortino: divides by the DOWNSIDE deviation, not the sd (RESEARCH A5).
  { file: "src/lib/factsheet/compute.ts", shape: "S0", denominator: "ddDev", reason: "Sortino, downside deviation", count: 1 },
  // Sortino: the bootstrap's resampled downside deviation.
  { file: "src/lib/factsheet/bootstrap.ts", shape: "S0", denominator: "downDev", reason: "Sortino, downside deviation", count: 1 },
  // Sortino: rollingSortino's windowed downside deviation.
  { file: "src/lib/factsheet/rolling.ts", shape: "S0", denominator: "dd", reason: "rollingSortino, downside deviation", count: 1 },
  // Sortino: the sample-basis downside volatility.
  { file: "src/lib/sample-basis-ratios.ts", shape: "S0", denominator: "downsideVol", reason: "Sortino, downside deviation", count: 1 },
  // Sortino: the scenario's downside volatility.
  { file: "src/lib/scenario.ts", shape: "S0", denominator: "downsideVol", reason: "Sortino, downside deviation", count: 1 },
  // Treynor: divides by beta, a regression slope, not a dispersion.
  { file: "src/lib/factsheet/joint.ts", shape: "S0", denominator: "beta", reason: "Treynor, divides by beta", count: 1 },
];

const covers = (e: AllowEntry, h: Hit): boolean =>
  e.file === h.file && e.shape === h.shape && h.text.replace(/\s+/g, "").endsWith("/" + e.denominator);

function classify(hits: readonly Hit[], allowlist: readonly AllowEntry[]) {
  const allowlisted = hits.filter(h => allowlist.some(e => covers(e, h)));
  const unallowlisted = hits.filter(h => !allowlist.some(e => covers(e, h)));
  const stale = allowlist
    .map(e => ({ entry: e, live: hits.filter(h => covers(e, h)).length }))
    .filter(s => s.live !== s.entry.count)
    .map(s => `${s.entry.file} ${s.entry.shape} / ${s.entry.denominator}: pinned ${s.entry.count}, live ${s.live}`);
  return { allowlisted, unallowlisted, stale };
}

const fmt = (h: Hit): string => `${h.file}:${h.line} ${h.shape} ${JSON.stringify(h.text)}`;

// ---------------------------------------------------------------------------
// Layer 1: the import rule
// ---------------------------------------------------------------------------

const TIER2_SITES = [
  "src/app/(dashboard)/compare/lib/holding-compare-adapter.ts",
  "src/lib/sample-basis-ratios.ts",
  "src/lib/scenario.ts",
  "src/lib/diversification.ts",
  "src/components/strategy/CompareCorrelationMatrix.tsx",
  "src/app/(dashboard)/allocations/widgets/risk/CorrelationMatrix.tsx",
  "src/lib/portfolio-stats.ts",
  "src/app/(dashboard)/allocations/lib/scenario-benchmark.ts",
  "src/app/(dashboard)/allocations/lib/scenario-stress.ts",
  "src/lib/factsheet/compute.ts",
  "src/lib/factsheet/bootstrap.ts",
  "src/lib/factsheet/joint.ts",
  "src/lib/factsheet/rolling.ts",
  "src/lib/factsheet/build-payload.ts",
  "src/lib/factsheet/allocator.ts",
  "src/lib/factsheet/og-metrics.ts", // T14's computed arm (D-19)
];

const IMPORTS_RETURN_STATS = /\bfrom\s*["']@\/lib\/return-stats["']/;

// ---------------------------------------------------------------------------
// Layer 2: the retired-expression table (D-20 B1)
// ---------------------------------------------------------------------------

const ALLOC = "src/app/(dashboard)/allocations/";
const FS = "src/lib/factsheet/";

// Every token is split by concatenation so this file never holds it contiguously.
const RETIRED: ReadonlyArray<{ file: string; token: string; plan: string }> = [
  { plan: "166.2-01", file: "src/app/(dashboard)/compare/lib/holding-compare-adapter.ts", token: "std > " + "0 ?" },
  { plan: "166.2-01", file: "src/lib/sample-basis-ratios.ts", token: "volatility > " + "0 ?" },
  { plan: "166.2-01", file: "src/lib/scenario.ts", token: "volatility > " + "0 ?" },
  { plan: "166.2-01", file: "src/lib/scenario.ts", token: "statA.std > 0 && " + "statB.std > 0" },
  { plan: "166.2-02", file: ALLOC + "widgets/risk/CorrelationMatrix.tsx", token: "function " + "pearson" },
  { plan: "166.2-03", file: "src/lib/portfolio-stats.ts", token: "computeRolling" + "Metric" },
  { plan: "166.2-03", file: "src/lib/portfolio-stats.ts", token: "varB > 0 ? " + "cov / varB" },
  { plan: "166.2-03", file: "src/lib/portfolio-stats.ts", token: "totalVariance > " + "0 ?" },
  { plan: "166.2-03", file: ALLOC + "lib/scenario-benchmark.ts", token: "1e-12 * " + "(Math.abs" },
  { plan: "166.2-03", file: ALLOC + "lib/scenario-benchmark.ts", token: "sampCov / " + "(stdP * stdB)" },
  { plan: "166.2-03", file: ALLOC + "lib/scenario-benchmark.ts", token: "(excessMean * " + "periodsPerYear) / te" },
  { plan: "166.2-03", file: ALLOC + "lib/scenario-stress.ts", token: "1e-12 * " + "(Math.abs" },
  { plan: "166.2-04", file: FS + "og-metrics.ts", token: "s > 0 ? " + "(m * periodsPerYear)" },
  { plan: "166.2-04", file: FS + "compute.ts", token: "const sharpe = " + "s > 0 ?" },
  { plan: "166.2-04", file: FS + "compute.ts", token: "function " + "pstdev" },
  { plan: "166.2-04", file: FS + "bootstrap.ts", token: "const sharpe = " + "s > 0 ?" },
  { plan: "166.2-05", file: FS + "joint.ts", token: "function " + "pstdev" },
  { plan: "166.2-05", file: FS + "joint.ts", token: "function " + "mean" },
  { plan: "166.2-05", file: FS + "joint.ts", token: "varB > 0 ? " + "cov / varB" },
  { plan: "166.2-05", file: FS + "joint.ts", token: "s > 0 && " + "sb > 0" },
  { plan: "166.2-05", file: FS + "joint.ts", token: "trackingError > " + "0 ?" },
  { plan: "166.2-05", file: FS + "rolling.ts", token: "function " + "pstdev" },
  { plan: "166.2-05", file: FS + "rolling.ts", token: "function " + "mean" },
  { plan: "166.2-05", file: FS + "rolling.ts", token: "varB !== 0 ? " + "cov / varB" },
  { plan: "166.2-05", file: FS + "rolling.ts", token: "s > 0 ? (m * periodsPerYear) " + "/ (s * sqrtN)" },
  { plan: "166.2-05", file: FS + "build-payload.ts", token: "denom > 0 ? " + "cov / denom : NaN" },
  { plan: "166.2-05", file: FS + "build-payload.ts", token: "Math.sqrt(" + "va * vb)" },
  { plan: "166.2-05", file: FS + "allocator.ts", token: "s > 0 && " + "mmS > 0 ?" },
];

/** Tokens retired from the WHOLE tree, in live code of any file (this one excluded). */
const WHOLE_TREE_RETIRED = [
  "correlation-" + "math",
  "rolling" + "Correlation",
  "computeRolling" + "Metric",
];

function retiredOffenders(file: string, source: string, table = RETIRED): string[] {
  const code = stripComments(source);
  return table
    .filter(r => r.file === file && count(code, r.token) > 0)
    .map(r => `${r.file}: ${JSON.stringify(r.token)} is back (retired by plan ${r.plan})`);
}

function wholeTreeOffenders(file: string, source: string): string[] {
  const code = stripComments(source);
  return WHOLE_TREE_RETIRED.filter(t => code.includes(t)).map(t => `${file}: ${t}`);
}

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), "utf8");

// ---------------------------------------------------------------------------
// The live gate
// ---------------------------------------------------------------------------

describe("Phase 166.2 compute-once gate (D-17)", () => {
  it("import rule: each of the 16 Tier-2 site files exists and imports @/lib/return-stats in live code", () => {
    const offenders: string[] = [];
    for (const rel of TIER2_SITES) {
      if (!existsSync(join(process.cwd(), rel))) {
        offenders.push(`${rel}: missing (a renamed site must be re-listed, not dropped)`);
        continue;
      }
      if (!IMPORTS_RETURN_STATS.test(stripComments(read(rel)))) {
        offenders.push(`${rel}: no live import from @/lib/return-stats`);
      }
    }
    expect(offenders, `D-17 import rule:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("retired table: no retired expression of plans 166.2-01 to 166.2-05 is back in its file", () => {
    expect(RETIRED).toHaveLength(28);
    const offenders: string[] = [];
    for (const rel of new Set(RETIRED.map(r => r.file))) {
      if (!existsSync(join(process.cwd(), rel))) {
        offenders.push(`${rel}: missing (the retired rows would pass vacuously)`);
        continue;
      }
      offenders.push(...retiredOffenders(rel, read(rel)));
    }
    expect(offenders, `D-20 B1 retired table:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("whole-tree retirements: the deleted correlation module and its tokens stay gone", () => {
    expect(existsSync(join(SRC_ROOT, "lib", "correlation-" + "math.ts"))).toBe(false);
    const offenders: string[] = [];
    for (const full of walkSource(SRC_ROOT, false)) {
      const file = relOf(SRC_ROOT, full);
      if (file === SELF_REL) continue;
      offenders.push(...wholeTreeOffenders(file, readFileSync(full, "utf8")));
    }
    expect(offenders, `D-20 B1 whole-tree retirements:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("whole-tree shapes: every Sharpe / Pearson / beta shape outside return-stats is allowlisted, and no entry is stale", () => {
    const { unallowlisted, stale } = classify(scanShapes(SRC_ROOT), ALLOWLIST);
    expect(
      unallowlisted.map(fmt),
      "D-17 a dispersion ratio outside @/lib/return-stats (call the shared module, or add a reasoned, count-pinned allowlist entry):\n" +
        unallowlisted.map(fmt).join("\n"),
    ).toEqual([]);
    expect(stale, `stale allowlist entries:\n${stale.join("\n")}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Liveness, through the SAME matcher functions
// ---------------------------------------------------------------------------

const shapesOf = (src: string, file = "src/lib/new-feature.ts"): Shape[] =>
  matchShapes(file, src).map(h => h.shape).sort();

describe("Phase 166.2 compute-once gate: liveness (D-20 B1, D-21 B1, D-22)", () => {
  it("a Sharpe in a NEW file is one unallowlisted S1 hit", () => {
    const src = "const sharpe = sd > 0 ? (mu * periodsPerYear) / (sd * Math.sqrt(periodsPerYear)) : 0;";
    const { unallowlisted } = classify(matchShapes("src/lib/new-feature.ts", src), ALLOWLIST);
    expect(unallowlisted.map(h => h.shape)).toEqual(["S1"]);
  });

  it("the one-step Pearson yields exactly P0 and P1 (D-22)", () => {
    expect(shapesOf("const corr = cov / Math.sqrt(varA * varB);")).toEqual(["P0", "P1"]);
  });

  it("each shipped form has a positive fixture yielding exactly one hit of its form", () => {
    expect(shapesOf("const ratio = (mu * periodsPerYear) / sd;")).toEqual(["S0"]);
    expect(shapesOf("const sharpe = (mu / sd) * Math.sqrt(periodsPerYear);")).toEqual(["S2"]);
    expect(shapesOf("const sharpe = mu / sd * Math.sqrt(periodsPerYear);")).toEqual(["S3"]);
    expect(shapesOf("const sharpe = Math.sqrt(periodsPerYear) * mu / sd;")).toEqual(["S4"]);
    expect(shapesOf("const corr = cov / (sa * sb);")).toEqual(["P2"]);
    expect(shapesOf("const denom = Math.sqrt(va * vb);\nreturn denom > 0 ? cov / denom : NaN;")).toEqual(["P1"]);
    expect(shapesOf("const b = cov / varX;")).toEqual(["BETA"]);
  });

  it("a Sharpe split across lines, with a continuation line starting with '*', still trips", () => {
    const src = "const sharpe = (m\n  * periodsPerYear)\n  / (s * Math.sqrt(periodsPerYear));";
    expect(shapesOf(src)).toEqual(["S1"]);
    // S1 starts at the ")" closing the numerator, on the second line.
    expect(matchShapes("src/lib/new-feature.ts", src)[0].line).toBe(2);
  });

  it("annualised vol, tracking error, a numeric-operand root, a scaled vol and a comment-only Sharpe do not trip", () => {
    expect(shapesOf("const annVol = sd * Math.sqrt(periodsPerYear);")).toEqual([]);
    expect(shapesOf("const te = stdDev(diff, true) * Math.sqrt(periodsPerYear);")).toEqual([]);
    expect(shapesOf("const c = 1 / Math.sqrt(9 * d);")).toEqual([]);
    expect(shapesOf("const x = Math.sqrt(periodsPerYear) * sd / 100;")).toEqual([]);
    expect(shapesOf("// const sharpe = (mu * periodsPerYear) / (sd * Math.sqrt(periodsPerYear));")).toEqual([]);
    expect(shapesOf("/* const sharpe = (mu / sd) * Math.sqrt(periodsPerYear); */ const y = 1;")).toEqual([]);
  });

  it("an allowlist entry pinned to 1 over a text with no match is reported stale", () => {
    const entry: AllowEntry = { file: "src/lib/new-feature.ts", shape: "S0", denominator: "dd", reason: "fixture", count: 1 };
    const { stale } = classify(matchShapes("src/lib/new-feature.ts", "const y = 1;"), [entry]);
    expect(stale).toHaveLength(1);
  });

  it("a live correlation-module import and a private pstdev trip the retired matchers; a comment-only mention does not", () => {
    const file = FS + "compute.ts";
    const live =
      'import { pearson } from "@/lib/correlation-' + 'math";\nfunction ' + "pstdev(xs: number[]) { return 0; }";
    expect(wholeTreeOffenders(file, live)).toHaveLength(1);
    expect(retiredOffenders(file, live)).toHaveLength(1);
    const commented =
      '// import { pearson } from "@/lib/correlation-' + 'math";\n/* function ' + "pstdev(xs) */ const y = 1;";
    expect(wholeTreeOffenders(file, commented)).toEqual([]);
    expect(retiredOffenders(file, commented)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The merge-base measurement through the committed matcher (D-22)
// ---------------------------------------------------------------------------

// The 26 hits the shipped regexes find on the merge-base src/ tree, by file and form:
// 20 in-class (SHARPE 10, PEARSON 7, BETA 3) and the 6 allowlisted Sortino / Treynor.
const BASE_EXPECTED = [
  "src/app/(dashboard)/allocations/lib/scenario-benchmark.ts S0",
  "src/app/(dashboard)/allocations/lib/scenario-benchmark.ts P2",
  "src/app/(dashboard)/allocations/widgets/risk/CorrelationMatrix.tsx P1",
  "src/app/(dashboard)/compare/lib/holding-compare-adapter.ts S2",
  "src/lib/correlation-" + "math.ts P1",
  "src/lib/factsheet/allocator.ts P2",
  "src/lib/factsheet/bootstrap.ts S0",
  "src/lib/factsheet/bootstrap.ts S1",
  "src/lib/factsheet/build-payload.ts P1",
  "src/lib/factsheet/compute.ts S0",
  "src/lib/factsheet/compute.ts S1",
  "src/lib/factsheet/joint.ts S0",
  "src/lib/factsheet/joint.ts S0",
  "src/lib/factsheet/joint.ts P2",
  "src/lib/factsheet/joint.ts BETA",
  "src/lib/factsheet/og-metrics.ts S1",
  "src/lib/factsheet/rolling.ts S0",
  "src/lib/factsheet/rolling.ts S1",
  "src/lib/factsheet/rolling.ts BETA",
  "src/lib/portfolio-stats.ts S0",
  "src/lib/portfolio-stats.ts BETA",
  "src/lib/sample-basis-ratios.ts S0",
  "src/lib/sample-basis-ratios.ts S0",
  "src/lib/scenario.ts S0",
  "src/lib/scenario.ts S0",
  "src/lib/scenario.ts P2",
];

const SCAN_ROOT = process.env.QZ_166_2_06_SCAN_ROOT;

describe.runIf(SCAN_ROOT)("merge-base tree", () => {
  it("the committed matcher reports 26 hits: 20 not allowlisted, 6 allowlisted", () => {
    const hits = scanShapes(SCAN_ROOT as string);
    const { allowlisted, unallowlisted } = classify(hits, ALLOWLIST);
    // process.stdout.write, not console.log: vitest 4's agent reporter drops the
    // console output of a passing test, and this line is the measurement.
    for (const h of hits) process.stdout.write(`shape-scan-hit: ${fmt(h)}\n`);
    expect(hits.map(h => `${h.file} ${h.shape}`).sort()).toEqual([...BASE_EXPECTED].sort());
    expect(hits).toHaveLength(26);
    expect(unallowlisted).toHaveLength(20);
    expect(allowlisted).toHaveLength(6);
    process.stdout.write(
      `shape-scan-base: hits=${hits.length} unallowlisted=${unallowlisted.length} allowlisted=${allowlisted.length}\n`,
    );
  });
});
