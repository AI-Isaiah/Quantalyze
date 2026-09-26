// @vitest-environment node
import { describe, it, expect, afterAll } from "vitest";
import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, execSync } from "node:child_process";

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
 *      matches), fourteen forms (nine shipped by D-21, five added and two widened by
 *      Phase 166.2 review round 1, WR-05). ID is an identifier-start operand, so a
 *      numeric operand never matches. ANN is an annualiser: periodsPerYear, ppy,
 *      sqrtN, ANNUAL, N, PERIODS_PER_YEAR or SQRT_N, optionally as a `this.` member.
 *      COVN is a covariance-like name: one holding "cov", or a sums-form "xy".
 *        SHARPE S0  ( x * ANN ) / d                            (ANN widened, WR-05)
 *        SHARPE S1  ( ... ) / ( d * Math.sqrt(   or   ( d * sqrtN | SQRT_N
 *        SHARPE S2  ( m / s ) * Math.sqrt(
 *        SHARPE S3  ID / ID * Math.sqrt(                      (D-21)
 *        SHARPE S4  Math.sqrt(N) * ID / ID                    (D-21)
 *        SHARPE S5  ( ... ) / ID * Math.sqrt(   the textbook (m - rf) / sd * √N (WR-05)
 *        SHARPE S6  ID * ANN / ID               unparenthesised              (WR-05)
 *        SHARPE S7  ID * Math.sqrt(N) / ID      the root in the numerator    (WR-05)
 *        SHARPE S8  <..ret..> / <..vol..>       annRet / annVol, by name     (WR-05)
 *        PEARSON P0 cov / Math.sqrt(
 *        PEARSON P1 Math.sqrt( ID * ID ), which also catches the two-step
 *                   denom = Math.sqrt(va * vb); ... cov / denom       (D-21)
 *        PEARSON P2 COVN / ( a * b )            numerator widened to COVN   (WR-05)
 *        PEARSON P3 COVN / ID / ID              the chained form             (WR-05)
 *        BETA       COVN / <..var..|..xx..>     covar / bVar, sxy / sxx      (WR-05)
 *      Every match must be covered by a COUNT-PINNED allowlist entry; an entry whose
 *      live count differs from its pin fails as stale. Annualised volatility and
 *      tracking error are a dispersion TIMES Math.sqrt(N), not a ratio, so the
 *      shapes do not match them by design. By design P1 flags ANY future product of
 *      two identifiers under a root; a legitimate non-Pearson one earns an allowlist
 *      entry with its reason (the allowlist is the escape, never a narrower regex).
 *      Each form has a positive fixture below yielding exactly one hit of its form.
 *
 * KNOWN UNMATCHED (D-22, re-measured after WR-05: still 0 hits each, and pinned
 * at 0 by the KNOWN_UNMATCHED fixtures so this list cannot drift from the
 * matcher). The matcher is not a whole-language guard: it catches the fourteen
 * forms above. A copy in one of these seven forms is caught only by layers 1 and
 * 2, the import rule and the retired-expression table:
 *        mean(r) / stdDev(r) * Math.sqrt(N)
 *        mean(r) * Math.sqrt(N) / stdDev(r)
 *        (mu * Math.sqrt(N)) / sd
 *        Math.sqrt(N) * (m / s)
 *        (m * 252) / s
 *        cov / (Math.sqrt(va) * Math.sqrt(vb))
 *        covariance(a,b) / variance(b)
 *
 * THE MERGE-BASE PIN runs in every vitest run, CI included (IN-01). It archives
 * the phase's diff base (BASE_SHA) from git into a temp dir and scans it with the
 * committed matcher: 26 hits, 20 in-class and 6 allowlisted. D-22 expected any
 * widening to move that pin; re-measured after WR-05 it did NOT (the new forms
 * have no copy at the base), so the pin stands at 26 by measurement, not by
 * assumption. `frontend-test` checks out full history, so the commit is
 * reachable; an unreachable commit fails loudly. QZ_166_2_06_SCAN_ROOT still
 * overrides the archive with a hand-made tree.
 *
 * Constraint on later phases (D-21): this gate constrains every later src/ edit,
 * including Phase 169's and 167.x's edits to the Tier-2 files. A new ratio copy fails
 * CI until it calls @/lib/return-stats or earns a reasoned allowlist entry.
 *
 * Comment stripping. The template's stripComments drops any line whose trimmed start
 * is "*", which would also drop a continuation line starting with a multiplication and
 * hide a split Sharpe. So this gate strips block comments by span and line comments by
 * a "//" not right after ":" (a URL), in ONE left-to-right pass that steps over
 * string, template and regex literals (IN-02; see stripComments), and keeps every
 * newline so a hit reports its true line. The retired tokens are compared with all
 * whitespace removed, and both walks carry a file-count floor. The forbidden tokens
 * below are built by concatenation so this file cannot match itself; it is also a
 * test file, which the shape scan excludes.
 */

const SRC_ROOT = join(process.cwd(), "src");
const SELF_REL = "src/lib/return-stats.single-source.test.ts";
const RETURN_STATS_REL = "src/lib/return-stats.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Keywords after which a "/" starts a regex literal, not a division. */
const REGEX_AFTER_WORD = new Set([
  "return", "typeof", "case", "in", "of", "delete", "void", "throw", "new", "else", "do", "instanceof", "yield", "await",
]);

/**
 * Blank out comments, keeping every newline so line numbers stay true.
 *
 * STRING-AWARE (IN-02, Phase 166.2 review round 1). One left-to-right pass that
 * steps OVER string literals ('...', "..."), template literals (`...`, with each
 * ${...} expression scanned as code, nested to any depth) and regex literals
 * (/.../flags, character classes included) while it looks for comment starts,
 * and copies their text through unchanged. The import rule and the whole-tree
 * retired tokens match INSIDE import-specifier strings, so strings must survive.
 * The regex-literal test is the usual one: a "/" is a regex after an operator,
 * an opening bracket, a comma, the start of input, or a keyword such as
 * `return`. The old stripper blanked everything after a "/*" or "//" inside a
 * string (a glob "src/*" hid the rest of the file up to the next "* /").
 *
 * A "//" right after ":" is still not a comment (a URL in JSX text), and a "/"
 * in a JSX closing tag "</" or a self-closing "/>" is not a regex.
 *
 * KNOWN LIMITS (recorded, not fixed): JSX TEXT is not parsed, so an apostrophe
 * in it ("Don't") reads as a string to the end of its line, and a "//" or "/*"
 * later on that line is copied as code rather than blanked. That can only ADD
 * text to the shape scan (a comment scanned as code), never hide code.
 */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  // Non-whitespace code before the cursor: the last character, and the last word.
  let prevChar = "";
  let prevWord = "";
  // One brace depth per open template-literal substitution, innermost last.
  const templateBraces: number[] = [];
  const blank = (text: string) => text.replace(/[^\n]/g, " ");

  /** Copy a template literal's text from i (just after its opening backtick or
   * a closing "}") to its end, or into a ${ substitution. */
  const readTemplate = (): void => {
    while (i < n) {
      const c = src[i];
      if (c === "\\") {
        out += src.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (c === "`") {
        out += c;
        i += 1;
        prevChar = "`";
        prevWord = "";
        return;
      }
      if (c === "$" && src[i + 1] === "{") {
        out += "${";
        i += 2;
        templateBraces.push(0);
        prevChar = "{";
        prevWord = "";
        return;
      }
      out += c;
      i += 1;
    }
  };

  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/" && src[i - 1] !== ":") {
      const j = src.indexOf("\n", i);
      const end = j === -1 ? n : j;
      out += blank(src.slice(i, end));
      i = end;
      continue;
    }
    if (c === "/" && d === "*") {
      const j = src.indexOf("*/", i + 2);
      const end = j === -1 ? n : j + 2;
      out += blank(src.slice(i, end));
      i = end;
      continue;
    }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
      prevChar = c;
      prevWord = "";
      continue;
    }
    if (c === "`") {
      out += c;
      i += 1;
      readTemplate();
      continue;
    }
    if (c === "/") {
      // Not a regex: a JSX closing tag "</" or a self-closing "/>".
      const jsxSlash = prevChar === "<" || d === ">";
      const regexAllowed =
        !jsxSlash && (prevChar === "" || /[(,=:[!&|?{};+\-*%<>~^]/.test(prevChar) || REGEX_AFTER_WORD.has(prevWord));
      if (regexAllowed) {
        let j = i + 1;
        let inClass = false;
        while (j < n && src[j] !== "\n") {
          const ch = src[j];
          if (ch === "\\") {
            j += 2;
            continue;
          }
          if (ch === "[") inClass = true;
          else if (ch === "]") inClass = false;
          else if (ch === "/" && !inClass) break;
          j += 1;
        }
        j += 1;
        while (j < n && /[a-z]/i.test(src[j])) j += 1;
        out += src.slice(i, j);
        i = j;
        prevChar = "/";
        prevWord = "";
        continue;
      }
    }
    if (c === "{" && templateBraces.length > 0) {
      templateBraces[templateBraces.length - 1] += 1;
    } else if (c === "}" && templateBraces.length > 0) {
      if (templateBraces[templateBraces.length - 1] === 0) {
        templateBraces.pop();
        out += c;
        i += 1;
        readTemplate();
        continue;
      }
      templateBraces[templateBraces.length - 1] -= 1;
    }
    out += c;
    i += 1;
    if (/\s/.test(c)) continue;
    if (/[\w$]/.test(c)) {
      prevWord = /[\w$]/.test(prevChar) ? prevWord + c : c;
    } else {
      prevWord = "";
    }
    prevChar = c;
  }
  return out;
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

type Shape =
  | "S0" | "S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7" | "S8"
  | "P0" | "P1" | "P2" | "P3" | "BETA";
type Hit = { file: string; line: number; shape: Shape; text: string };

const ID = "[A-Za-z_$][\\w.$]*";
// An annualiser: the periods-per-year count or its root, as a bare identifier,
// a `this.` member, or a SCREAMING_CASE constant (WR-05 widened this from the
// five bare names S0 and S1 first shipped with).
const ANN = "(?:this\\.)?(?:periodsPerYear|ppy|sqrtN|ANNUAL|N|PERIODS_PER_YEAR|SQRT_N)";
// A covariance-like numerator: a name holding "cov", or a sums-form "xy".
const COVN = "\\w*(?:cov|xy)\\w*";
const SHAPES: ReadonlyArray<readonly [Shape, RegExp]> = [
  ["S0", new RegExp(`\\*\\s*${ANN}\\s*\\)\\s*\\/\\s*[\\w.]+`, "g")],
  ["S1", /\)\s*\/\s*\(\s*[\w.]+\s*\*\s*(?:Math\.sqrt\(|sqrtN\b|SQRT_N\b)/g],
  ["S2", /(?<!Math\.sqrt)\(\s*[\w.]+\s*\/\s*[\w.]+\s*\)\s*\*\s*Math\.sqrt\(/g],
  ["S3", new RegExp(`(?<![\\w.$)])${ID}\\s*\\/\\s*${ID}\\s*\\*\\s*Math\\.sqrt\\(`, "g")],
  ["S4", new RegExp(`Math\\.sqrt\\([^()]*\\)\\s*\\*\\s*${ID}\\s*\\/\\s*${ID}(?![\\w.$(])`, "g")],
  // WR-05: a parenthesised numerator over an sd, times a root (the textbook
  // `(m - rf) / sd * Math.sqrt(N)`), which S3's lookbehind excludes.
  ["S5", new RegExp(`\\)\\s*\\/\\s*${ID}\\s*\\*\\s*Math\\.sqrt\\(`, "g")],
  // WR-05: an unparenthesised `m * periodsPerYear / sd`, which S0 misses (S0
  // needs a ")" straight after the annualiser).
  ["S6", new RegExp(`(?<![\\w.$)])${ID}\\s*\\*\\s*${ANN}\\s*\\/\\s*${ID}(?![\\w.$(])`, "g")],
  // WR-05: `m * Math.sqrt(N) / sd`, the root in the numerator.
  ["S7", new RegExp(`(?<![\\w.$)])${ID}\\s*\\*\\s*Math\\.sqrt\\([^()]*\\)\\s*\\/\\s*${ID}(?![\\w.$(])`, "g")],
  // WR-05: an annualised return over an annualised vol, by name.
  ["S8", /\b\w*ret(?:urn)?\w*\s*\/\s*\w*vol(?:atility)?\b/gi],
  ["P0", /\w*cov\w*\s*\/\s*Math\.sqrt\(/gi],
  ["P1", new RegExp(`Math\\.sqrt\\(\\s*${ID}\\s*\\*\\s*${ID}\\s*\\)`, "g")],
  // WR-05 widened the numerator from "cov" to COVN, so `sxy / (sx * sy)` trips.
  ["P2", new RegExp(`${COVN}\\s*\\/\\s*\\(\\s*[\\w.]+\\s*\\*\\s*[\\w.]+\\s*\\)`, "gi")],
  // WR-05: the chained Pearson `cov / sx / sy`.
  ["P3", new RegExp(`${COVN}\\s*\\/\\s*${ID}\\s*\\/\\s*${ID}`, "gi")],
  // WR-05 widened both sides: `covar / bVar` and the sums-form `sxy / sxx`.
  ["BETA", new RegExp(`${COVN}\\s*\\/\\s*\\w*(?:var|xx)\\w*`, "gi")],
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

/** Whitespace removed: a retired token matches however it is spaced (IN-02). */
const squash = (text: string): string => text.replace(/\s+/g, "");

function retiredOffenders(file: string, source: string, table = RETIRED): string[] {
  // Compared with ALL whitespace removed on both sides (IN-02): the table's
  // tokens are written as the plans grepped them ("std > 0 ?"), and a
  // re-introduced "std>0?" or a copy split across lines is the same expression.
  const code = squash(stripComments(source));
  return table
    .filter(r => r.file === file && count(code, squash(r.token)) > 0)
    .map(r => `${r.file}: ${JSON.stringify(r.token)} is back (retired by plan ${r.plan})`);
}

function wholeTreeOffenders(file: string, source: string): string[] {
  const code = squash(stripComments(source));
  return WHOLE_TREE_RETIRED.filter(t => code.includes(squash(t))).map(t => `${file}: ${t}`);
}

// Floors on the two walks (IN-02): a walk that finds nothing, or a fraction of
// the tree (a wrong root, a renamed directory), must fail on its own rather than
// pass because there was nothing to scan. Measured 2026-09-26 at this commit's
// parent: 1611 .ts/.tsx files under src/ for the whole-tree walk, 732 for the
// non-test shape walk. The floors are round numbers well under both.
const WHOLE_TREE_FILES_FLOOR = 1000;
const SHAPE_WALK_FILES_FLOOR = 500;

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
    const files = walkSource(SRC_ROOT, false);
    expect(files.length, "the whole-tree walk found too few files to mean anything").toBeGreaterThan(
      WHOLE_TREE_FILES_FLOOR,
    );
    for (const full of files) {
      const file = relOf(SRC_ROOT, full);
      if (file === SELF_REL) continue;
      offenders.push(...wholeTreeOffenders(file, readFileSync(full, "utf8")));
    }
    expect(offenders, `D-20 B1 whole-tree retirements:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("whole-tree shapes: every Sharpe / Pearson / beta shape outside return-stats is allowlisted, and no entry is stale", () => {
    expect(walkSource(SRC_ROOT, true).length, "the shape walk found too few files to mean anything").toBeGreaterThan(
      SHAPE_WALK_FILES_FLOOR,
    );
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

/** The header's KNOWN UNMATCHED forms (D-22), measured at 0 hits each. */
const KNOWN_UNMATCHED = [
  "mean(r) / stdDev(r) * Math.sqrt(N)",
  "mean(r) * Math.sqrt(N) / stdDev(r)",
  "(mu * Math.sqrt(N)) / sd",
  "Math.sqrt(N) * (m / s)",
  "(m * 252) / s",
  "cov / (Math.sqrt(va) * Math.sqrt(vb))",
  "covariance(a,b) / variance(b)",
];

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

  // WR-05 (Phase 166.2 review round 1): each spelling the review measured at 0
  // hits now yields exactly one hit of its own form.
  it.each([
    ["(m - rf) / sd * Math.sqrt(N)", "S5"],
    ["m * periodsPerYear / sd", "S6"],
    ["m * Math.sqrt(periodsPerYear) / sd", "S7"],
    ["(m * this.periodsPerYear) / sd", "S0"],
    ["(m * PERIODS_PER_YEAR) / (sd * SQRT_N)", "S1"],
    ["annRet / annVol", "S8"],
    ["sxy / (sx * sy)", "P2"],
    ["cov / sx / sy", "P3"],
    ["sxy / sxx", "BETA"],
    ["covar / bVar", "BETA"],
  ])("WR-05 spelling %s is exactly one %s hit", (expr, shape) => {
    expect(shapesOf(`const x = ${expr};`)).toEqual([shape]);
  });

  // The recorded limit, pinned so the header cannot drift from the matcher: each
  // KNOWN UNMATCHED form is still 0 hits. A widening that catches one moves it
  // out of this list and into the positive fixtures above, in the same commit.
  it.each(KNOWN_UNMATCHED)("KNOWN UNMATCHED %s is still 0 hits", (expr) => {
    expect(shapesOf(`const x = ${expr};`)).toEqual([]);
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

  // IN-02: the stripper steps over strings, templates and regex literals.
  it("a formula after a string holding '/*' or '//' is still scanned", () => {
    expect(shapesOf('const glob = "src/*";\nconst sharpe = mu / sd * Math.sqrt(periodsPerYear);')).toEqual(["S3"]);
    expect(shapesOf("const url = 'a//b'; const sharpe = mu / sd * Math.sqrt(periodsPerYear);")).toEqual(["S3"]);
  });

  it("a formula after a regex literal holding '//' is still scanned", () => {
    expect(shapesOf("const re = /https?:\\/\\//; const sharpe = mu / sd * Math.sqrt(periodsPerYear);")).toEqual(["S3"]);
  });

  it("template text after a substitution is text, a substitution is code, and a comment after a string is blanked", () => {
    // The "//" is template TEXT between two substitutions, so the formula after
    // the template on the same line must still be scanned.
    expect(shapesOf("const t = `${a} // ${b}`; const sharpe = mu / sd * Math.sqrt(periodsPerYear);")).toEqual(["S3"]);
    expect(shapesOf("const t = `x ${mu / sd * Math.sqrt(periodsPerYear)} y`;")).toEqual(["S3"]);
    expect(shapesOf('const s = "a"; // const sharpe = mu / sd * Math.sqrt(periodsPerYear);')).toEqual([]);
  });

  it("string text survives stripping, so an import specifier is still read", () => {
    const src = 'import { sharpe } from "@/lib/return-stats"; // src/* glob';
    expect(IMPORTS_RETURN_STATS.test(stripComments(src))).toBe(true);
  });

  it("a retired token matches however it is spaced (IN-02)", () => {
    const file = "src/app/(dashboard)/compare/lib/holding-compare-adapter.ts";
    expect(retiredOffenders(file, "const s = std>0?m/std:0;")).toHaveLength(1);
    expect(retiredOffenders(file, "const s = std  >\n  0 ? m / std : 0;")).toHaveLength(1);
    expect(retiredOffenders(file, "const s = std >= 0 ? m / std : 0;")).toEqual([]);
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

// The 26 hits the committed regexes find on the merge-base src/ tree, by file and
// form: 20 in-class (SHARPE 10, PEARSON 7, BETA 3) and the 6 allowlisted Sortino /
// Treynor. Re-measured after the WR-05 widening (2026-09-26): unchanged.
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
const BASE_UNALLOWLISTED = 20;
const BASE_ALLOWLISTED = 6;

// The diff base of Phase 166.2 (its merge-base with origin/main). It is on main,
// so every full-history clone reaches it after this branch merges too.
const BASE_SHA = "ea4167a3f82a03306f29dcd2a10cbdc38768117b";

/**
 * The base tree's src/ root. QZ_166_2_06_SCAN_ROOT still overrides it (a
 * hand-archived tree). Otherwise the tree is materialised IN-TEST from git, so
 * the pin runs in every vitest run, CI included (IN-01): `frontend-test` checks
 * out with `fetch-depth: 0`, so the commit is reachable there. An unreachable
 * commit (a shallow clone) FAILS the test loudly; it never skips.
 */
let baseTmp: string | null = null;
function baseSrcRoot(): string {
  const override = process.env.QZ_166_2_06_SCAN_ROOT;
  if (override) return override;
  if (baseTmp) return join(baseTmp, "src");
  try {
    execFileSync("git", ["cat-file", "-e", `${BASE_SHA}^{commit}`], { stdio: "pipe" });
  } catch {
    throw new Error(
      `merge-base pin: commit ${BASE_SHA} is not reachable (a shallow clone?). ` +
        "Fetch full history, or set QZ_166_2_06_SCAN_ROOT to an archived src/ tree.",
    );
  }
  baseTmp = mkdtempSync(join(tmpdir(), "qz-166-2-base-"));
  execSync(`git archive --format=tar ${BASE_SHA} src | tar -x -C "${baseTmp}"`, { stdio: "pipe" });
  return join(baseTmp, "src");
}
afterAll(() => {
  if (baseTmp) rmSync(baseTmp, { recursive: true, force: true });
});

describe("merge-base tree (runs in CI, IN-01)", () => {
  it(`the committed matcher reports ${BASE_EXPECTED.length} hits on the base tree: ${BASE_UNALLOWLISTED} not allowlisted, ${BASE_ALLOWLISTED} allowlisted`, () => {
    const root = baseSrcRoot();
    expect(walkSource(root, true).length, "the base-tree walk found too few files").toBeGreaterThan(
      SHAPE_WALK_FILES_FLOOR,
    );
    const hits = scanShapes(root);
    const { allowlisted, unallowlisted } = classify(hits, ALLOWLIST);
    // process.stdout.write, not console.log: vitest 4's agent reporter drops the
    // console output of a passing test, and this line is the measurement.
    for (const h of hits) process.stdout.write(`shape-scan-hit: ${fmt(h)}\n`);
    process.stdout.write(
      `shape-scan-base: hits=${hits.length} unallowlisted=${unallowlisted.length} allowlisted=${allowlisted.length}\n`,
    );
    expect(hits.map(h => `${h.file} ${h.shape}`).sort()).toEqual([...BASE_EXPECTED].sort());
    expect(unallowlisted).toHaveLength(BASE_UNALLOWLISTED);
    expect(allowlisted).toHaveLength(BASE_ALLOWLISTED);
  });
});
