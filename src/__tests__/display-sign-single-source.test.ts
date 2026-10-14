/**
 * Phase 170.6 DISPLAYPOLISH, SC-3 / D-05 — there is ONE sign and tone rule, and CI
 * fails the next private one.
 *
 * THE PROPERTY. A figure's sign glyph and its red/green tone come from the value
 * ROUNDED to the precision it prints at (D-02, D-03), and a max drawdown is never
 * green (D-04). That rule lives in `src/lib/factsheet/display-sign.ts` and nowhere
 * else (D-05). A second implementation is how `-0.00`, `+0.0%` and a green drawdown
 * got onto 45 files in the first place, so this guard scans the whole census scope
 * and fails on a private one.
 *
 * WHAT THIS GUARD CHECKS, on comment-stripped source (`stripCommentsPreserveLines`,
 * so prose that names an idiom cannot trip it and line numbers stay real):
 *
 *   R1  a "+" glyph chosen by comparing a raw value with zero in a ternary, or gated by it
 *       inline: `{v > 0 && "+"}` (R3-WR-01).
 *   R2  a positive / negative colour token chosen by comparing a raw value with zero in a
 *       ternary, gated by it inline (`cn("a", delta > 0 && "text-positive")`, `||` too), returned
 *       from an `if`, or keyed by it in a clsx object (`cn({ "text-positive": delta > 0 })`).
 *       A tone token is a `-positive` / `-negative` utility with a colour prefix (`text`, `bg`,
 *       `border`, `stroke`, `fill`, `ring`, `outline`, `shadow`, `from`, `via`, `to`, `divide`,
 *       `decoration`, `accent`, `caret`), a `var(--color-*)`, a hex or a `CHART_*` constant.
 *       A count or a collection size is not a signed figure and stays quiet (`rows.length`,
 *       `hiddenCount`, `counts.declined`, AdminTabs.tsx:219).
 *   R3  a `negative` prop or flag set from a raw comparison with zero.
 *   R4  a `metricColor` declared anywhere under `src` except `src/lib/utils.ts`.
 *   R5  (D-04) every CONSTANT negative tone, counted per file against a pinned,
 *       reasoned allowlist. A `Sparkline` `color=` is series identity, not a figure's
 *       tone, and is excluded.
 *   R6  (D-02) every `.toFixed(` call, counted per file against a pinned, reasoned
 *       allowlist, so a new bare `toFixed` on a signed value moves a count and fails.
 *   R7  (D-03) a boolean assigned from a raw comparison with zero (or an arrow-wrapped one,
 *       `const isUp = (v) => v > 0`, used as `isUp(x)`) that is then used to choose a colour
 *       token: `b ? token : ..`, `b && <El token/>`, `cn(.., b && token)`, `b || token`,
 *       `if (b) return token` and a clsx key `{ "text-positive": b }`. Counted per file against
 *       a pinned, reasoned allowlist (both entries are guards that pick a dash or a visibility,
 *       never a colour). A right side that reaches `R7_RHS_CAP` and is boolean looking is a finding.
 *   R8  (D-04) every JSX `negative` attribute with no value or `negative={true}`,
 *       counted per file against a pinned, reasoned allowlist, so a new always-red
 *       value cell fails.
 *
 * Tail reads (a ternary's arms, a `&&` operand, a `return` value) go through `readTail`: bounded
 * by bracket depth, JSX-aware, and a read that reaches `TAIL_CAP` is itself a finding (R3-SFH-3).
 *
 * R1-R4 admit no exception inside the scan scope. OUTSIDE it, the "sweep" test reads ALL of `src`
 * with R1, R2 and R7 and requires every hit to be pinned in `SWEEP_ALLOWLIST` with a reason.
 * R5, R6, R7 and R8 are counts, and a count is only
 * meaningful two-sided: a pin that is lower than the file fails (a new instance) and
 * so does a pin that is higher (an instance was removed and the table went stale).
 * Every pin carries a one-line reason written after reading its site.
 *
 * R5 "constant" is a deliberate approximation, stated so it is not mistaken for
 * more: a token occurrence is CHOSEN BY A CONDITION when its line sits in a ternary
 * (a leading `?`/`:` or an earlier ` ? ` on the line) or is the `return` of an `if`
 * or `case`. A token behind `cond && <p className="text-negative">` is constant: the
 * condition decides whether the element renders, not which tone it has. A tone map
 * keyed by category (`negative: "text-negative"`) also counts, and its pin says so.
 *
 * The population is derived from disk on every run. Every matcher is self-tested in
 * both polarities below, and the four neuter proofs in plan 170.6-12 show R2, R5, R6
 * and R7 each fail on the real tree.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { stripCommentsPreserveLines } from "@/lib/source-scan";

const REPO_ROOT = process.cwd();
const SRC = join(REPO_ROOT, "src");

/** The one file allowed to own the rule, so it is never scanned. */
const RULE_FILE = "src/lib/factsheet/display-sign.ts";
/** The one file allowed to declare `metricColor` (R4). */
const METRIC_COLOR_HOME = "src/lib/utils.ts";

/** Directories scanned recursively (non-test `.ts` / `.tsx` only). */
const SCAN_DIRS = [
  "src/app/factsheet",
  "src/app/api/og",
  "src/components/strategy-v2",
  "src/components/charts",
  "src/app/(dashboard)/allocations/components",
  "src/app/(dashboard)/allocations/widgets",
  "src/components/portfolio",
  "src/components/strategy",
] as const;

/** Single files scanned in addition to the directories. */
const SCAN_FILES = [
  "src/lib/utils.ts",
  "src/lib/bridge-outcome-label.ts",
  "src/lib/portfolio-insights.ts",
  "src/lib/dollar-validation.ts",
  "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx",
  "src/app/(marketing)/demo/page.tsx",
  "src/app/portfolio-pdf/[id]/page.tsx",
  "src/app/(dashboard)/recommendations/page.tsx",
] as const;

/**
 * Every file the phase census (170.6-01-PLAN.md tables B, C and F) names as a
 * formatter or tone site. The population must contain all of them, so a moved file
 * or a broken walk cannot pass vacuously.
 */
const CENSUS_FILES = [
  // Table B and C: the factsheet and OG surfaces
  "src/app/factsheet/[id]/v2/MetricsColumn.tsx",
  "src/app/factsheet/[id]/v2/StressWindowsPanel.tsx",
  "src/app/factsheet/[id]/v2/BatchDPanels.tsx",
  "src/app/factsheet/[id]/v2/AnalyticalPanels.tsx",
  "src/app/factsheet/[id]/v2/DistributionPanels.tsx",
  "src/app/factsheet/[id]/v2/TimeSeriesChart.tsx",
  "src/app/factsheet/[id]/v2/HistogramChart.tsx",
  "src/app/factsheet/[id]/v2/SignaturePanels.tsx",
  "src/app/factsheet/[id]/v2/CrossSignaturePanels.tsx",
  "src/app/factsheet/[id]/v2/HeatmapPanels.tsx",
  "src/app/factsheet/[id]/tearsheet/page.tsx",
  "src/app/api/og/factsheet/[id]/route.tsx",
  "src/components/strategy-v2/HeadlineMetricsPanel.tsx",
  "src/components/strategy-v2/TradeAndPositionPanel.tsx",
  "src/components/portfolio/BenchmarkComparison.tsx",
  // Table F: every other surface
  "src/components/charts/MonthlyHeatmap.tsx",
  "src/components/charts/DailyHeatmap.tsx",
  "src/components/charts/DrawdownChart.tsx",
  "src/components/charts/EquityCurve.tsx",
  "src/components/charts/ReturnQuantiles.tsx",
  "src/components/charts/YearlyReturns.tsx",
  "src/components/charts/ReturnHistogram.tsx",
  "src/components/charts/RollingAlphaBetaChart.tsx",
  "src/components/charts/RollingSortinoChart.tsx",
  "src/components/charts/RollingMetrics.tsx",
  "src/components/charts/CorrelationWithBenchmark.tsx",
  "src/components/charts/WorstDrawdowns.tsx",
  "src/app/(dashboard)/allocations/widgets/attribution/AlphaBetaDecomposition.tsx",
  "src/app/(dashboard)/allocations/components/KpiStrip.tsx",
  "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx",
  "src/app/(dashboard)/allocations/widgets/outcomes/OutcomesWidget.tsx",
  "src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx",
  "src/app/(dashboard)/allocations/widgets/risk/TailRisk.tsx",
  "src/app/(dashboard)/allocations/widgets/performance/DrawdownChart.tsx",
  "src/app/(dashboard)/allocations/widgets/risk/CorrelationMatrix.tsx",
  "src/app/(dashboard)/allocations/widgets/risk/RiskDecomposition.tsx",
  "src/app/(dashboard)/allocations/widgets/risk/VarExpectedShortfall.tsx",
  "src/lib/bridge-outcome-label.ts",
  "src/components/portfolio/AttributionBar.tsx",
  "src/components/portfolio/ReplacementCard.tsx",
  "src/components/portfolio/PortfolioOptimizer.tsx",
  "src/components/portfolio/PortfolioImpactPanel.tsx",
  "src/components/portfolio/PortfolioEquityCurve.tsx",
  "src/components/portfolio/CorrelationHeatmap.tsx",
  "src/components/portfolio/WhatWedDoCard.tsx",
  "src/components/portfolio/WinnersLosersStrip.tsx",
  "src/components/portfolio/EditorialHero.tsx",
  "src/components/portfolio/StrategyBreakdownTable.tsx",
  "src/components/strategy/StrategyTable.tsx",
  "src/components/strategy/HoldingFactsheet.tsx",
  "src/components/strategy/CompareEquityOverlay.tsx",
  "src/components/strategy/CompareCorrelationMatrix.tsx",
  "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx",
  "src/app/(marketing)/demo/page.tsx",
  "src/app/portfolio-pdf/[id]/page.tsx",
  "src/app/(dashboard)/recommendations/page.tsx",
  // The formatter module the rest delegate to
  "src/lib/utils.ts",
] as const;

/** The population floor: 193 files measured for the directories alone on 2026-10-13. */
const POPULATION_FLOOR = 150;

// ---------------------------------------------------------------------------
// Matchers
// ---------------------------------------------------------------------------

/**
 * A raw value compared with zero: `x >= 0`, `(x ?? 0) < 0`, `y.z !== 0`, and the
 * reversed `0 <= x`. `0.005` and `0.9` are NOT zero (the lookahead refuses a digit
 * or a dot after the zero), so a threshold is never a sign test. A collection size
 * (`rows.length > 0`, `set.size`, `count`) is not a signed figure either, so a
 * `hasRows ? a : b` boolean is not a sign choice. The same goes for a camelCase count
 * (`hiddenCount`, `tradeCount`) and a property of a `counts` object (`counts.declined`,
 * AdminTabs.tsx:219): a count is a non-negative number, never a signed figure (R3-WR-01).
 */
const CMP_ZERO = String.raw`[\w)\]]\s*(?<!\b(?:length|size|count)\s*)(?<!\b\w*Counts?\s*)(?<!\bcounts?\.[\w.]*\s*)(?:>=|<=|===|!==|==|!=|>|<)\s*0(?![\w.])|(?<![\w.])0\s*(?:<=|>=|===|!==|<|>)\s*[\w(][\w.]*`;

/**
 * A positive / negative colour token (R2, R5, R7). A `var(--color-x, fallback)` is ONE token.
 * R2-SFH-1 (170.6 round 2): the utility tokens are not only `text-*`. A `bg-positive` chip,
 * a `border-negative` card or a `fill-positive` bar painted from a raw sign is the same
 * defect (WR-03 was `isHedge ? "bg-positive" : "bg-accent"`), so every colour-bearing
 * utility prefix is a tone token. A `/10` opacity suffix is still the same token (`\b`).
 * R3-SFH-4 (round 3): `outline`, `shadow`, `from`, `via`, `to`, `divide`, `decoration`, `accent`
 * and `caret` are colour-bearing prefixes too. The lookbehind keeps `go-to-negative` (a word that
 * merely contains `to-negative`) from being read as the `to-` utility.
 */
const TONE_PREFIX = String.raw`text|bg|border|stroke|fill|ring|outline|shadow|from|via|to|divide|decoration|accent|caret`;
const NEG_TOKEN = String.raw`var\(--color-negative\b[^)]*\)|(?<![\w-])(?:${TONE_PREFIX})-negative\b|#DC2626|\bCHART_NEGATIVE\b`;
const POS_TOKEN = String.raw`var\(--color-positive\b[^)]*\)|(?<![\w-])(?:${TONE_PREFIX})-positive\b|#15803D|\bCHART_POSITIVE\b`;
const TONE_TOKEN_RE = new RegExp(`${NEG_TOKEN}|${POS_TOKEN}`, "i");
const NEG_TOKEN_RE_G = new RegExp(NEG_TOKEN, "gi");

/** A conditional `?` (not `?.`, not `??`) closing a comparison, with optional `)` before it. */
const TERNARY_AFTER_CMP_RE = new RegExp(`(?:${CMP_ZERO})[\\s)]*\\?(?![.?])`, "g");

/**
 * A raw zero comparison followed by `&&` or `||`: the INLINE form of the same choice
 * (`cn("a", delta > 0 && "text-positive")`, `{v > 0 && "+"}`), with no named boolean in between
 * (R3-WR-01, 170.6 round 3). The tail after the operator is read exactly like a ternary's.
 */
const AND_AFTER_CMP_RE = new RegExp(`(?:${CMP_ZERO})[\\s)]*(?:&&|\\|\\|)`, "g");

/**
 * A clsx / cn object entry whose KEY is a tone token: `{ "text-positive": up }`. The key must
 * follow `{` or `,`, so the `"token" :` of a ternary arm is not read as a key. Group 2 is the key.
 */
const TONE_KEY_RE = /(?<=[{,]\s*)(["'`])([^"'`\n]{1,120})\1\s*:\s*/g;

export interface Finding {
  file: string;
  line: number;
  rule: string;
  text: string;
}

/** Comment-stripped source, memoised: the eight rules each strip the same ~200 files. */
const STRIPPED = new Map<string, string>();
function strip(source: string): string {
  let code = STRIPPED.get(source);
  if (code === undefined) {
    code = stripCommentsPreserveLines(source, "ts");
    STRIPPED.set(source, code);
  }
  return code;
}

/** 1-based line of `index`, by binary search over a per-source table of line starts. */
const LINE_STARTS = new Map<string, number[]>();
function lineOf(code: string, index: number): number {
  let starts = LINE_STARTS.get(code);
  if (!starts) {
    starts = [0];
    for (let i = 0; i < code.length; i++) if (code.charCodeAt(i) === 10) starts.push(i + 1);
    LINE_STARTS.set(code, starts);
  }
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

/** The text of the line holding `index`, without its newline. */
function lineBounds(code: string, index: number): { start: number; end: number } {
  const start = code.lastIndexOf("\n", index - 1) + 1;
  const newline = code.indexOf("\n", index);
  return { start, end: newline === -1 ? code.length : newline };
}

function lineText(code: string, index: number): string {
  const { start, end } = lineBounds(code, index);
  return code.slice(start, end).trim();
}

/**
 * Safety bound on one tail read (a ternary's arms, a `&&` operand, a `return` value). A read that
 * reaches it is a FINDING, never a silent truncation. It is a bound and not a tuning knob: the
 * census test asserts the longest tail in the scan scope sits under half of it. Measured
 * 2026-10-14 over ALL of src with the JSX-aware reader: 1811 characters (AllocatorExchangeManager,
 * outside the scan scope) and 1197 in scope (BlendHeader.tsx, a whole JSX panel as one arm).
 * The old silent 400-character cut sat BELOW five real, non-sign ternaries.
 */
export const TAIL_CAP = 4000;

export interface Tail {
  text: string;
  /** True when the read stopped at the cap instead of at the end of the expression. */
  capped: boolean;
}

/** Index just past the string or template literal that opens at `i` (`limit` when it never closes). */
function skipString(code: string, i: number, limit: number): number {
  const quote = code[i];
  for (let j = i + 1; j < limit; j++) {
    if (code[j] === "\\") j++;
    else if (code[j] === quote) return j + 1;
  }
  return limit;
}

/** Index just past the `}` that closes the `{` at `i` (`limit` when it never closes). */
function skipBraces(code: string, i: number, limit: number): number {
  let depth = 0;
  for (let j = i; j < limit; j++) {
    const c = code[j];
    if (c === '"' || c === "'" || c === "`") j = skipString(code, j, limit) - 1;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return j + 1;
  }
  return limit;
}

/**
 * Read one JSX tag that opens at `i` (`<`). `end` is the index past its `>`. Attribute strings and
 * `{...}` attribute expressions are skipped whole, so a `>` inside `onClick={() => x}` does not end it.
 */
function readTag(code: string, i: number, limit: number): { kind: "open" | "close" | "self"; end: number } {
  if (code[i + 1] === "/") {
    const close = code.indexOf(">", i);
    return { kind: "close", end: close === -1 || close >= limit ? limit : close + 1 };
  }
  for (let j = i + 1; j < limit; j++) {
    const c = code[j];
    if (c === '"' || c === "'" || c === "`") j = skipString(code, j, limit) - 1;
    else if (c === "{") j = skipBraces(code, j, limit) - 1;
    else if (c === ">") return { kind: code[j - 1] === "/" ? "self" : "open", end: j + 1 };
  }
  return { kind: "open", end: limit };
}

/**
 * Read an expression's tail from `from`: a ternary's arms after its `?`, the operand after a `&&`,
 * the value after a `return`. The read ENDS at a `;` or `,` at bracket depth 0, or at a closing
 * bracket that has no opener inside the tail.
 *
 * The depth is structural (R3-SFH-3, 170.6 round 3). Quotes and template strings are skipped, and
 * JSX is understood: inside an element's children the text is opaque, so a comma in `<p>Up, up</p>`
 * does not end the read and an apostrophe in `<p>Don't</p>` does not open a quote that swallows
 * the else arm. Only `{` (an expression) and `<` (a tag) mean anything there. A `<` is a tag only
 * when the last significant character cannot end an operand, so `a < b` stays a comparison.
 *
 * A read that reaches `cap` characters returns `capped: true`. Callers REPORT that as a finding: a
 * truncated read looks the same as a clean one, and the tone token may sit just past the cut.
 */
export function readTail(code: string, from: number, cap = TAIL_CAP): Tail {
  const limit = Math.min(code.length, from + cap);
  const stack: string[] = []; // "(" "[" "{" for JS brackets, "T" for an open JSX element's children
  let prev = "?"; // the last significant JS character
  let i = from;
  while (i < limit) {
    const c = code[i];
    if (stack[stack.length - 1] === "T") {
      if (c === "{") {
        stack.push("{");
        i++;
      } else if (c === "<") {
        const tag = readTag(code, i, limit);
        if (tag.kind === "close") stack.pop();
        else if (tag.kind === "open") stack.push("T");
        i = tag.end;
        prev = ">";
      } else {
        i++;
      }
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(code, i, limit);
      prev = "a";
      continue;
    }
    if (c === "<" && /[A-Za-z>]/.test(code[i + 1] ?? "") && !/[\w)\]$]/.test(prev)) {
      const tag = readTag(code, i, limit);
      if (tag.kind === "open") stack.push("T");
      i = tag.end;
      prev = ">";
      continue;
    }
    if (c === "(" || c === "[" || c === "{") {
      stack.push(c);
    } else if (c === ")" || c === "]" || c === "}") {
      if (stack.length === 0) return { text: code.slice(from, i), capped: false };
      stack.pop();
    } else if (stack.length === 0 && (c === ";" || c === ",")) {
      return { text: code.slice(from, i), capped: false };
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return { text: code.slice(from, limit), capped: limit < code.length && limit - from >= cap };
}

/** The annotation a capped read carries in a finding's text. */
const CAPPED_NOTE = "   // the read reached its cap and was not read whole";

/** R1: a ternary on a raw zero comparison whose branch starts with a "+" glyph. */
export function findR1(source: string, file: string): Finding[] {
  const code = strip(source);
  const out: Finding[] = [];
  for (const re of [TERNARY_AFTER_CMP_RE, AND_AFTER_CMP_RE]) {
    for (const m of code.matchAll(re)) {
      const tail = readTail(code, (m.index ?? 0) + m[0].length);
      const glyph = /^\s*["'`]\+/.test(tail.text) || (re === TERNARY_AFTER_CMP_RE && /:\s*["'`]\+/.test(tail.text));
      if (glyph || tail.capped) {
        out.push({ file, line: lineOf(code, m.index ?? 0), rule: "R1", text: lineText(code, m.index ?? 0) + (tail.capped ? CAPPED_NOTE : "") });
      }
    }
  }
  return out;
}

/** `if (x > 0) return "text-positive"`: the statement form of the same raw-sign colour choice. */
const IF_RETURN_AFTER_CMP_RE = new RegExp(`(?:${CMP_ZERO})\\s*\\)\\s*\\{?\\s*return\\s+`, "g");

/**
 * R2: a ternary (or an `if (...) return`) on a raw zero comparison that chooses a
 * positive / negative colour token. A tail read that reaches its cap is a finding too.
 */
export function findR2(source: string, file: string): Finding[] {
  const code = strip(source);
  const out: Finding[] = [];
  for (const re of [TERNARY_AFTER_CMP_RE, AND_AFTER_CMP_RE, IF_RETURN_AFTER_CMP_RE]) {
    for (const m of code.matchAll(re)) {
      const tail = readTail(code, (m.index ?? 0) + m[0].length);
      if (tail.capped || TONE_TOKEN_RE.test(tail.text)) {
        out.push({ file, line: lineOf(code, m.index ?? 0), rule: "R2", text: lineText(code, m.index ?? 0) + (tail.capped ? CAPPED_NOTE : "") });
      }
    }
  }
  // `cn({ "text-positive": delta > 0 })`: the key is a tone token, the value a raw zero comparison.
  const cmp = new RegExp(CMP_ZERO);
  for (const m of code.matchAll(TONE_KEY_RE)) {
    if (!TONE_TOKEN_RE.test(m[2])) continue;
    const value = readTail(code, (m.index ?? 0) + m[0].length);
    if (value.capped || cmp.test(value.text)) {
      out.push({ file, line: lineOf(code, m.index ?? 0), rule: "R2", text: lineText(code, m.index ?? 0) + (value.capped ? CAPPED_NOTE : "") });
    }
  }
  return out;
}

/** The length of the longest tail `findR1` / `findR2` read in `source` that did NOT reach the cap (0 when none). */
export function maxTailRead(source: string): number {
  const code = strip(source);
  let longest = 0;
  for (const re of [TERNARY_AFTER_CMP_RE, AND_AFTER_CMP_RE, IF_RETURN_AFTER_CMP_RE]) {
    for (const m of code.matchAll(re)) {
      const tail = readTail(code, (m.index ?? 0) + m[0].length);
      if (!tail.capped) longest = Math.max(longest, tail.text.length);
    }
  }
  return longest;
}

/** R3: `negative={x < 0}`, `negative: x < 0`, `const negative = x < 0`. */
const R3_RE = new RegExp(String.raw`\b(?:is)?[nN]egative\s*(?:=(?!=)|:)\s*\{?[^;{}]{0,120}?(?:${CMP_ZERO})`, "g");
export function findR3(source: string, file: string): Finding[] {
  const code = strip(source);
  const out: Finding[] = [];
  for (const m of code.matchAll(R3_RE)) {
    out.push({ file, line: lineOf(code, m.index ?? 0), rule: "R3", text: lineText(code, m.index ?? 0) });
  }
  return out;
}

/** R4: a `metricColor` declaration. The caller exempts the one allowed home. */
const R4_RE = /\b(?:function\s+metricColor\b|(?:const|let|var)\s+metricColor\b)/g;
export function findR4(source: string, file: string): Finding[] {
  const code = strip(source);
  const out: Finding[] = [];
  for (const m of code.matchAll(R4_RE)) {
    out.push({ file, line: lineOf(code, m.index ?? 0), rule: "R4", text: lineText(code, m.index ?? 0) });
  }
  return out;
}

/** True when the negative token at `p` is chosen by a condition (see the file docblock). */
function isConditionalTone(code: string, p: number): boolean {
  const { start, end } = lineBounds(code, p);
  const before = code.slice(start, p);
  const fullLine = code.slice(start, end);
  if (/^\s*[?:]\s/.test(fullLine)) return true; // a ternary continuation line
  if (/\s\?\s/.test(before)) return true; // an earlier ternary on the same line
  if (/\bcase\b/.test(before)) return true;
  if (/\breturn\b/.test(before)) {
    if (/\bif\s*\(/.test(before)) return true;
    // `return TOKEN` on its own line under an `if (...) {` / `else` / `case`.
    const prev = code.slice(0, Math.max(0, start - 1)).split("\n").reverse().find((l) => l.trim() !== "") ?? "";
    if (/^\s*(?:\}\s*)?(?:else\s+if\s*\(|if\s*\(|else\b|case\b|default\b)/.test(prev)) return true;
  }
  return false;
}

/** True when the token at `p` is the `color=` attribute of a `<Sparkline` element (series identity). */
function isSparklineColor(code: string, p: number): boolean {
  const open = code.lastIndexOf("<Sparkline", p);
  if (open === -1) return false;
  if (code.slice(open, p).includes("/>")) return false;
  const start = code.lastIndexOf("\n", p - 1) + 1;
  return /\bcolor\s*=\s*\{?\s*["'`]?\s*$/.test(code.slice(start, p));
}

/** `code` with every `import ... from "..."` statement blanked (newlines kept), so an imported NAME is not a tone. */
function blankImports(code: string): string {
  return code.replace(/\bimport\s+(?:type\s+)?[^;'"`]*?\bfrom\s*["'][^"']+["'];?/g, (m) => m.replace(/[^\n]/g, " "));
}

/** R5: the lines of every CONSTANT negative tone. */
export function findR5(source: string): number[] {
  const code = blankImports(strip(source));
  const lines: number[] = [];
  for (const m of code.matchAll(NEG_TOKEN_RE_G)) {
    const p = m.index ?? 0;
    if (isSparklineColor(code, p)) continue;
    if (isConditionalTone(code, p)) continue;
    lines.push(lineOf(code, p));
  }
  return lines;
}

/** R6: the lines of every `.toFixed(` call. */
export function findR6(source: string): number[] {
  const code = strip(source);
  const lines: number[] = [];
  for (const m of code.matchAll(/\.toFixed\(/g)) lines.push(lineOf(code, m.index ?? 0));
  return lines;
}

/**
 * R7: `const up = x >= 0;` and then a colour token chosen by that boolean, in any of three
 * shapes (R2-SFH-1, 170.6 round 2):
 *   `up ? <token> : ...`            a ternary (WR-03 was `isHedge ? "bg-positive" : "bg-accent"`)
 *   `up && <El className=<token>/>` an element that renders only on the raw sign
 *   `cn(base, up && <token>)`       a class gated on the raw sign
 *
 * The assignment is read to its terminating `;` (or unmatched closer) at bracket depth 0 with
 * no 160-character window, so a multi-line comparison is read whole. `R7_RHS_CAP` is a safety
 * bound and not a tuning knob: the census test asserts the longest comparison RHS in the real
 * tree sits well under it, and a scan that reaches the cap is reported as a finding, never
 * silently truncated. A `.map(v => v > 0 ...)` is not a boolean, so an arrow still disqualifies.
 */
const R7_DECL_RE = /\b(?:const|let|var)\s+(\w+)\s*(?::\s*boolean\s*)?=(?!=)/g;
/** Safety bound on one assignment's right side. Measured max over the scan scope is asserted in the census test. */
export const R7_RHS_CAP = 4000;

/** An arrow function that opens a right side: `(v) => ...`, `(v: number): boolean => ...`, `v => ...`. */
const ARROW_HEAD_RE = /^\s*(?:async\s+)?(?:\((?!\s*\()[^)]*\)|[A-Za-z_$][\w$]*)\s*(?::\s*[^=]+?)?=>/;

/** True when `text` holds a JSX element start (`<div`, `<>`), which no boolean does. A generic or a comparison is preceded by an operand character. */
function hasJsx(text: string): boolean {
  return /(?<![\w)\]$])<[A-Za-z>]/.test(text);
}

/**
 * True when `text` reads as a BOOLEAN: a comparison or a `&&` / `||` at bracket depth 0, no
 * ternary at depth 0 (a ternary yields one of its arms, so its value is not a boolean) and no
 * JSX anywhere (a boolean never holds an element; `ready && (<div>..</div>)` is an element).
 * A callback body, an object literal or a call's arguments sit at depth 1 or more, so
 * `useMemo(() => x > 0)` is not boolean looking and `a === b && c > 0` is. A `<` or `>` counts as
 * a comparison only with whitespace on both sides, so a generic (`useRef<HTMLDivElement>(null)`)
 * and an arrow's `=>` are not comparisons.
 */
function hasTopLevelBooleanOp(text: string): boolean {
  if (hasJsx(text)) return false;
  let depth = 0;
  let op = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(text, i, text.length) - 1;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (depth === 0) {
      const two = text.slice(i, i + 2);
      if (c === "?" && two !== "?." && two !== "??" && text[i - 1] !== "?") return false; // a ternary
      if (two === "&&" || two === "||" || two === "==" || two === "!=" || two === ">=" || two === "<=") op = true;
      else if ((c === "<" || c === ">") && /\s/.test(text[i - 1] ?? "") && /\s/.test(text[i + 1] ?? "")) op = true;
    }
  }
  return op;
}

/**
 * Each boolean-from-zero-comparison assignment: name, RHS text and where it starts. `wrapped` marks
 * an arrow-wrapped boolean (`const isUp = (v) => v > 0`), used as a CALL: `isUp(x) ? token : ..`
 * (R3-SFH-4). Any other arrow (`.map(r => r > 0)`) is not a boolean and is skipped.
 *
 * A right side that reaches `R7_RHS_CAP` and is boolean-looking at depth 0 is reported BEFORE the
 * comparison and arrow filters: a zero comparison that sits past the cap, or an arrow inside the
 * first R7_RHS_CAP characters, must not turn an unread right side into a silent pass.
 */
function r7Assignments(
  code: string,
): { name: string; rhs: string; index: number; capped: boolean; wrapped: boolean }[] {
  const cmp = new RegExp(CMP_ZERO);
  const out: { name: string; rhs: string; index: number; capped: boolean; wrapped: boolean }[] = [];
  for (const a of code.matchAll(R7_DECL_RE)) {
    const from = (a.index ?? 0) + a[0].length;
    const { text: rhs, capped } = readTail(code, from, R7_RHS_CAP);
    const wrapped = ARROW_HEAD_RE.test(rhs);
    if (wrapped && capped) continue; // a cap-length arrow is a handler, not a one-line boolean helper
    if (capped && hasTopLevelBooleanOp(rhs)) {
      out.push({ name: a[1], rhs, index: a.index ?? 0, capped, wrapped });
      continue;
    }
    if (!rhs.includes("0") || (rhs.includes("=>") && !wrapped) || !cmp.test(rhs) || hasJsx(rhs)) continue;
    out.push({ name: a[1], rhs, index: a.index ?? 0, capped, wrapped });
  }
  return out;
}

/** The length of the longest comparison RHS `findR7` read in `source` (0 when none). */
export function maxR7Rhs(source: string): number {
  return r7Assignments(strip(source)).reduce((m, a) => Math.max(m, a.rhs.length), 0);
}

/** Index just past the `)` that closes the `(` at `i` (-1 when it never closes). */
function skipParens(code: string, i: number): number {
  let depth = 0;
  for (let j = i; j < code.length; j++) {
    const c = code[j];
    if (c === '"' || c === "'" || c === "`") j = skipString(code, j, code.length) - 1;
    else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return j + 1;
  }
  return -1;
}

/**
 * Where a tone could be chosen by the boolean `name`: the start of the tail after
 *   `name ? ..`, `name && ..` and `name || ..`   (with `!` and, for a wrapped boolean, a call),
 *   `if (name) return ..` / `if (!name) { return ..`,
 * and, for a clsx / cn object, the value of a tone-token KEY: `{ "text-positive": name }`.
 */
function r7UseTails(code: string, name: string, wrapped: boolean): { index: number; from: number }[] {
  const out: { index: number; from: number }[] = [];
  const ref = wrapped ? String.raw`${name}\s*\(` : String.raw`${name}\b(?!\s*\()`;
  const useRe = new RegExp(String.raw`(?<![\w.])!?\s*${ref}`, "g");
  for (const u of code.matchAll(useRe)) {
    const start = u.index ?? 0;
    const after = wrapped ? skipParens(code, start + u[0].length - 1) : start + u[0].length;
    if (after === -1) continue;
    const op = /^\s*(?:\?(?![.?])|&&|\|\|)/.exec(code.slice(after, after + 40));
    if (op) {
      out.push({ index: start, from: after + op[0].length });
      continue;
    }
    const ret = /^\s*\)\s*\{?\s*return\s+/.exec(code.slice(after, after + 80));
    if (ret && /\bif\s*\(\s*$/.test(code.slice(Math.max(0, start - 20), start))) {
      out.push({ index: start, from: after + ret[0].length });
    }
  }
  for (const k of code.matchAll(TONE_KEY_RE)) {
    if (!TONE_TOKEN_RE.test(k[2])) continue;
    const valueFrom = (k.index ?? 0) + k[0].length;
    const value = readTail(code, valueFrom);
    const head = new RegExp(String.raw`^\s*!?\s*${name}\b${wrapped ? String.raw`\s*\(` : String.raw`(?!\s*\()`}`).test(value.text);
    // The key IS the tone, so the "tail" for the token test is the key itself.
    if (head) out.push({ index: k.index ?? 0, from: -1 });
  }
  return out;
}

export function findR7(source: string, file: string): Finding[] {
  const code = strip(source);
  const out: Finding[] = [];
  // A boolean can only route a colour in a file that names one.
  if (!TONE_TOKEN_RE.test(code)) return out;
  const seen = new Set<number>();
  for (const a of r7Assignments(code)) {
    if (a.capped) {
      out.push({ file, line: lineOf(code, a.index), rule: "R7", text: `${lineText(code, a.index)}   // right side reached R7_RHS_CAP and was not read whole` });
      continue;
    }
    for (const use of r7UseTails(code, a.name, a.wrapped)) {
      const tail = use.from === -1 ? { text: "", capped: false } : readTail(code, use.from);
      const line = lineOf(code, use.index);
      if ((use.from === -1 || tail.capped || TONE_TOKEN_RE.test(tail.text)) && !seen.has(line)) {
        seen.add(line);
        out.push({
          file,
          line,
          rule: "R7",
          text: `${lineText(code, use.index)}   // ${a.name} assigned from a raw zero comparison at line ${lineOf(code, a.index)}${tail.capped ? CAPPED_NOTE : ""}`,
        });
      }
    }
  }
  return out;
}

/**
 * R8: a JSX `negative` attribute with no value, or `negative={true}`. The lookahead
 * demands the attribute end the way a JSX attribute does (`/>`, `>` or another
 * attribute), which a destructured `{ negative }`, a `negative ? …` read, a
 * `negative?: boolean` type and a `negative={x}` expression all fail.
 */
const R8_RE = /(?<=\s)negative(?:\s*=\s*\{\s*true\s*\})?(?=\s*(?:\/>|>|[A-Za-z_][\w-]*\s*=))/g;
export function findR8(source: string): number[] {
  const code = strip(source);
  const lines: number[] = [];
  for (const m of code.matchAll(R8_RE)) lines.push(lineOf(code, m.index ?? 0));
  return lines;
}

// ---------------------------------------------------------------------------
// The allowlist: file -> rule -> pinned count + one-line reason
// ---------------------------------------------------------------------------

export type CountRule = "R1" | "R2" | "R5" | "R6" | "R7" | "R8";
export interface AllowEntry {
  /** The exact number of occurrences the rule finds in the file. */
  count: number;
  /** Why every one of them is safe, written after reading the sites. */
  reason: string;
}
export type Allowlist = Readonly<Record<string, Readonly<Partial<Record<CountRule, AllowEntry>>>>>;

export const ALLOWLIST: Allowlist = {
  "src/app/(dashboard)/allocations/components/AlertBanner.tsx": {
    R5: {
      count: 2,
      reason: "The Acknowledge button's danger-styled text and the banner's own `border-negative` top rule on a role=alert critical-alert message (alert chrome, read at line 114); neither prints or tones a figure.",
    },
  },
  "src/app/(dashboard)/allocations/components/AllocateDialog.tsx": {
    R5: {
      count: 2,
      reason: "The remove-holding action (REMOVE_ACTION) is destructive-action styling on a button, and the amount input's `aria-[invalid=true]:border-negative` is a form-validity border (it fires on aria-invalid, never on a value's sign); neither is a figure's tone.",
    },
  },
  "src/app/(dashboard)/allocations/components/AllocatedForm.tsx": {
    R5: {
      count: 1,
      reason: "Form validation message (`{error}`), a sentence, not a figure.",
    },
  },
  "src/app/(dashboard)/allocations/components/BridgeDrawer.tsx": {
    R5: {
      count: 1,
      reason: "The role=alert line for a failed bridge action (`state.error`), an error sentence.",
    },
  },
  "src/app/(dashboard)/allocations/components/MandateQuickSetCard.tsx": {
    R5: {
      count: 1,
      reason: "The role=alert line for a failed mandate quick-set save, an error sentence.",
    },
  },
  "src/app/(dashboard)/allocations/components/MonteCarloBandChart.tsx": {
    R6: {
      count: 6,
      reason: "SVG path or geometry coordinate (x, y or a width), a position on the canvas and never a printed figure.",
    },
  },
  "src/app/(dashboard)/allocations/components/OutcomeForm.tsx": {
    R5: {
      count: 1,
      reason: "Form error message (`{error}`), a sentence, not a figure.",
    },
  },
  "src/app/(dashboard)/allocations/components/RejectedForm.tsx": {
    R5: {
      count: 1,
      reason: "Form error message (`{error}`), a sentence, not a figure.",
    },
  },
  "src/app/(dashboard)/allocations/components/SavedScenariosList.tsx": {
    R5: {
      count: 6,
      reason: "Error and destructive-action styles: the load-error banner (its text and its `border-negative/40`, read at line 468), rename error, the Delete button, the copy-failed alert, a role=alert line; none prints a figure.",
    },
  },
  "src/app/(dashboard)/allocations/components/ScenarioCommitDrawer.tsx": {
    R5: {
      count: 8,
      reason: "The commit-failure banner (text, `border-negative` and the `focus:ring-negative/50` focus ring), the 'Holdings removed' notice box (`border-negative/30 bg-negative/5` around a count and a sentence, lines 890-897) and three per-step 'Couldn't record' role=alert lines; alert chrome, no figure's sign.",
    },
    R6: {
      count: 1,
      reason: "A holding's NEW WEIGHT as a percent of the book (`new_weight ?? 0`): a weight is non-negative.",
    },
  },
  "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx": {
    R5: {
      count: 12,
      reason: "Error and destructive-action styling only, each read: the name-error line; the save-error and commit-error banners (text plus `border-negative`, lines 5211 and 6453); hover-to-danger text and `hover:border-negative` on Reset (5396) and Remove-from-scenario (8054); the Discard-draft button fill (`bg-negative` and `hover:bg-negative/90`, 8410). None is chosen by, or prints, a figure's sign.",
    },
    R6: {
      count: 8,
      reason: "Eight non-negative domains, each read: diversification ratio and effective number of bets (both at least 1), the contribution bar width (Math.abs), the unreachable-leverage ceiling and the leverage factor, and two weight inputs in [0, 1]. The signed percent contribution to risk goes through formatPcrPercent.",
    },
  },
  "src/app/(dashboard)/allocations/components/ScenarioFooter.tsx": {
    R5: {
      count: 2,
      reason: "The Reset button's hover-to-danger text colour and `hover:border-negative`, an action affordance, not a figure.",
    },
  },
  "src/app/(dashboard)/allocations/components/StrategyBrowseDrawer.tsx": {
    R5: {
      count: 2,
      reason: "The mandate-fit tier map's `red` entry (a 'Weak mandate fit' category keyed by tier, not by a sign) and a role=alert load error.",
    },
  },
  "src/app/(dashboard)/allocations/components/WidgetState.tsx": {
    R5: {
      count: 2,
      reason: "The shared widget error state's card (`border-negative/30 bg-negative/5`, role=alert) around `error.message` and a Retry button; an error container, no figure.",
    },
  },
  "src/app/(dashboard)/allocations/widgets/allocation/AllocationOverTime.tsx": {
    R6: {
      count: 2,
      reason: "Allocation shares in [0, 1] (axis tick and tooltip): a share of the book is non-negative.",
    },
  },
  "src/app/(dashboard)/allocations/widgets/attribution/AlphaBetaDecomposition.tsx": {
    R5: {
      count: 1,
      reason: "ALPHA_TONE_CLASS's `negative` entry: the map is indexed by signTone's result, so the red is reachable only through the rounded sign.",
    },
  },
  "src/app/(dashboard)/allocations/widgets/intelligence/RegimeDetector.tsx": {
    R5: {
      count: 1,
      reason: "The Bear Market regime label colour: a regime category (census table E), not a number's sign.",
    },
  },
  "src/app/(dashboard)/allocations/widgets/outcomes/OutcomesWidget.tsx": {
    R6: {
      count: 1,
      reason: "`percent_allocated`, the percent of the portfolio an allocation took: non-negative.",
    },
  },
  "src/app/(dashboard)/allocations/widgets/performance/DrawdownChart.tsx": {
    R5: {
      count: 2,
      reason: "The two gradient stops of the drawdown area: the series IS a drawdown curve (series identity, census table E), no printed figure.",
    },
  },
  "src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx": {
    R6: {
      count: 10,
      reason: "Two `Number(x.toFixed(6))` roundings of a value-to-base ratio (data, not text), four SVG path coordinates and four coordinates of the area path, and the +/- range annotation, which is half of a non-negative range printed after an explicit '±'.",
    },
  },
  "src/app/(dashboard)/allocations/widgets/positions/ExposureByClass.tsx": {
    R6: {
      count: 3,
      reason: "Spot and derivative shares of gross exposure (gross over gross, non-negative).",
    },
  },
  "src/app/(dashboard)/allocations/widgets/risk/TailRisk.tsx": {
    R5: {
      count: 3,
      reason: "The 'Extreme losses (below -2%)' panel's category red on the P1 figure, the event-count chip and the histogram bars; the panel renders only with at least 3 such events and P1 prints through formatUnsignedPercent, so a rounded zero is unsigned.",
    },
  },
  "src/app/(dashboard)/allocations/widgets/risk/VarExpectedShortfall.tsx": {
    R5: {
      count: 2,
      reason: "ZONE_COLORS.red and the red third of the risk-zone bar: risk-zone category colours (plan-check W-B); the three VaR / CVaR figures take figureColor, i.e. the rounded sign.",
    },
  },
  "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx": {
    R5: {
      count: 1,
      reason: "The 'sync is taking much longer than expected' notice, a status sentence, not a figure.",
    },
  },
  "src/app/(marketing)/demo/page.tsx": {
    R6: {
      count: 2,
      reason: "Demo holding weight in percent and the demo recommendation's integer score: both non-negative demo fixtures.",
    },
  },
  "src/app/factsheet/[id]/trade-fetch-lines.tsx": {
    R5: {
      count: 1,
      reason: "The 'Stale: last trades fetched N days ago' line: a freshness state, no figure sign.",
    },
  },
  "src/app/factsheet/[id]/v2/AnalyticalPanels.tsx": {
    R5: {
      count: 1,
      reason: "The Losses streak histogram's colour: a win/loss category (census table E), not a value's sign.",
    },
  },
  "src/app/factsheet/[id]/v2/BatchDPanels.tsx": {
    R6: {
      count: 3,
      reason: "The Kolmogorov-Smirnov D and p-value (both in [0, 1]) and the target portfolio volatility (non-negative).",
    },
  },
  "src/app/factsheet/[id]/v2/CrossSignaturePanels.tsx": {
    R6: {
      count: 2,
      reason: "SVG path or geometry coordinate (x, y or a width), a position on the canvas and never a printed figure.",
    },
  },
  "src/app/factsheet/[id]/v2/DistributionPanels.tsx": {
    R6: {
      count: 1,
      reason: "The EoY chart's absolute scale label `±{maxAbs}`, a magnitude printed after an explicit '±'.",
    },
  },
  "src/app/factsheet/[id]/v2/FactsheetView.tsx": {
    R5: {
      count: 3,
      reason: "The Revoke-link confirm and trigger buttons and their role=alert failure line: destructive-action and error styling, no figure.",
    },
    R6: {
      count: 4,
      reason: "usdCompact: an unsigned USD amount (AUM or volume), which census table E leaves outside the sign rule.",
    },
  },
  "src/app/factsheet/[id]/v2/HeatmapPanels.tsx": {
    R5: {
      count: 1,
      reason: "tintFor's default palette `negative` target colour: a heatmap cell FILL, which D-06 leaves unchanged (it encodes magnitude).",
    },
    R6: {
      count: 2,
      reason: "The heatmap caption's colour-scale clamp `±{maxAbs}%`, a magnitude printed after an explicit '±'.",
    },
  },
  "src/app/factsheet/[id]/v2/MandatePanels.tsx": {
    R6: {
      count: 1,
      reason: "A leverage multiple trimmed to 2 dp (`Number(l.toFixed(2))`), non-negative.",
    },
  },
  "src/app/factsheet/[id]/v2/MasterBrush.tsx": {
    R6: {
      count: 2,
      reason: "SVG path or geometry coordinate (x, y or a width), a position on the canvas and never a printed figure.",
    },
  },
  "src/app/factsheet/[id]/v2/MetricsColumn.tsx": {
    R6: {
      count: 1,
      reason: "The win-to-loss ratio `win / Math.abs(loss)`, non-negative by construction.",
    },
  },
  "src/app/factsheet/[id]/v2/SignaturePanels.tsx": {
    R6: {
      count: 6,
      reason: "SVG path or geometry coordinate (x, y or a width), a position on the canvas and never a printed figure.",
    },
  },
  "src/app/factsheet/[id]/v2/TimeSeriesChart.tsx": {
    R5: {
      count: 1,
      reason: "The worst-drawdown highlight band's shading rect behind the line: a category band; the pit label's text takes drawdownTone.",
    },
    R6: {
      count: 5,
      reason: "Five SVG path and baseline coordinates; the chart's printed figures all go through formatFixedSigned.",
    },
  },
  "src/app/factsheet/[id]/v2/format.ts": {
    R6: {
      count: 8,
      reason: "usdCompact and formatUsd: unsigned USD amounts (census table E). The signed figures in this module go through formatFixedSigned.",
    },
  },
  "src/app/factsheet/[id]/v2/page.tsx": {
    R5: {
      count: 1,
      reason: "STATE_LINE_TONE_CLASS.red: the owner state line's tone class keyed by the copy row's tone (a permanent failure), not a figure.",
    },
  },
  "src/app/factsheet/[id]/v2/palette.ts": {
    R5: {
      count: 1,
      reason: "The theme palette's `negative` entry: the definition of the colour, not a use of it.",
    },
  },
  "src/components/charts/RollingVolatilityChart.tsx": {
    R6: {
      count: 2,
      reason: "Rolling volatility (tick and tooltip): volatility is non-negative.",
    },
  },
  "src/components/charts/TurnoverChart.tsx": {
    R6: {
      count: 2,
      reason: "Turnover (tick and tooltip): turnover is non-negative.",
    },
  },
  "src/components/charts/WorstDrawdowns.tsx": {
    R5: {
      count: 1,
      reason: "CELL_DEPTH: `MIN_DEPTH_PCT` 0.005 keeps every printed depth at or beyond 0.50%, so this red is a real drawdown (D-04).",
    },
  },
  "src/components/charts/chart-tokens.ts": {
    R5: {
      count: 2,
      reason: "The CHART_NEGATIVE token and its hex value: the definition site of the colour.",
    },
  },
  "src/components/portfolio/AlertsList.tsx": {
    R5: {
      count: 1,
      reason: "Alerts load/acknowledge error line, a sentence.",
    },
  },
  "src/components/portfolio/AllocationEventForm.tsx": {
    R5: {
      count: 1,
      reason: "Form error line, a sentence.",
    },
  },
  "src/components/portfolio/CompositionDonut.tsx": {
    R6: {
      count: 1,
      reason: "A portfolio weight in the donut tooltip: non-negative.",
    },
  },
  "src/components/portfolio/CorrelationHeatmap.tsx": {
    R6: {
      count: 1,
      reason: "The average ABSOLUTE correlation `Avg |ρ|`: non-negative by definition.",
    },
  },
  "src/components/portfolio/CreatePortfolioForm.tsx": {
    R5: {
      count: 1,
      reason: "Form error line, a sentence.",
    },
  },
  "src/components/portfolio/DocumentUpload.tsx": {
    R5: {
      count: 1,
      reason: "Upload error line, a sentence.",
    },
  },
  "src/components/portfolio/EditorialHero.tsx": {
    R8: {
      count: 2,
      reason: "Both cells are drawdowns; `negative` marks 'this cell is a drawdown' and metricValueClass paints it red only when drawdownTone is negative at the printed 2 dp, so the flag can neither redden a rounded zero nor make a drawdown green.",
    },
  },
  "src/components/portfolio/InsightStrip.tsx": {
    R5: {
      count: 1,
      reason: "SEVERITY_DOT's `high` entry (`bg-negative`): an insight-severity dot keyed by Severity ('high' | 'medium' | 'low'), not by any figure's sign.",
    },
  },
  "src/components/portfolio/MigrationWizard.tsx": {
    R5: {
      count: 1,
      reason: "Wizard error line, a sentence.",
    },
  },
  "src/components/portfolio/PortfolioImpactPanel.tsx": {
    R5: {
      count: 8,
      reason: "The impact panel's error state: the box (`border-negative/20 bg-negative/5`), the message, its retry-after line and the Retry button (text, `border-negative/30`, `hover:bg-negative/10` and, read at line 402, the `focus-visible:outline-negative` focus outline of that same button); no figure. The delta chips beside it tone through signTone (line 588 is the conditional branch of that call).",
    },
    R7: {
      count: 1,
      reason: "`isRateLimited` (`typeof retryAfter === \"number\" && Number.isFinite(retryAfter) && retryAfter > 0`) is a seconds-to-wait availability guard on a 429 Retry-After value: it shows or hides the retry-after sentence and disables the button. The red is the error panel's own tone, set regardless of the guard, and `retryAfter` is a duration, never a signed figure.",
    },
    R6: {
      count: 6,
      reason: "Four SVG path coordinates and the aria text for a delta's MAGNITUDE (`Math.abs(value)`), where the word improved / regressed carries the direction and a rounded zero returns 'unchanged' before this line.",
    },
  },
  "src/components/portfolio/PortfolioOptimizer.tsx": {
    R5: {
      count: 3,
      reason: "The 'Optimizer failed' error box (`border-negative/30 bg-negative/5`) and its heading; no figure.",
    },
  },
  "src/components/portfolio/RemoveStrategyButton.tsx": {
    R5: {
      count: 2,
      reason: "The Remove button's hover-to-danger text and its removal error line; no figure.",
    },
  },
  "src/components/portfolio/ReplacementCard.tsx": {
    R5: {
      count: 1,
      reason: "The role=alert line for a failed intro request, a sentence.",
    },
  },
  "src/components/portfolio/ReplacementPanel.tsx": {
    R5: {
      count: 3,
      reason: "The replacement panel's error box (`border-negative/20 bg-negative/5`) and its error line, a sentence.",
    },
  },
  "src/components/portfolio/RiskAttribution.tsx": {
    R7: {
      count: 1,
      reason: "`assessable` (`share !== null && weight !== null && share >= 0`) is a VALIDITY guard that picks between a dash and a verdict. It never picks a colour from a sign: the verdict's red or green comes from `overweight` (`share > weight * 1.3`), and a negative share is excluded from assessment on purpose (169 WR-R2-02).",
    },
  },
  "src/components/strategy-v2/TradeAndPositionPanel.tsx": {
    R6: {
      count: 3,
      reason: "Compact USD for gross volume, mean trade size and turnover (non-negative amounts), and the average trade duration in days (non-negative).",
    },
  },
  "src/components/strategy/ApiKeyForm.tsx": {
    R5: {
      count: 1,
      reason: "Form error line, a sentence.",
    },
  },
  "src/components/strategy/ApiKeyManager.tsx": {
    R5: {
      count: 2,
      reason: "The 'Couldn't load your API keys' notice and the key-action error line; sentences, no figure.",
    },
  },
  "src/components/strategy/CapitalOwnershipRadioGroup.tsx": {
    R5: {
      count: 1,
      reason: "The radio group's field error message, a sentence.",
    },
  },
  "src/components/strategy/PendingIntros.tsx": {
    R5: {
      count: 1,
      reason: "The intro-list error line, a sentence.",
    },
  },
  "src/components/strategy/RenameStrategyDialog.tsx": {
    R5: {
      count: 1,
      reason: "The name input's `aria-[invalid=true]:border-negative`, a form-validity border that fires on aria-invalid and never on a value's sign.",
    },
  },
  "src/components/strategy/RequestIntroButton.tsx": {
    R5: {
      count: 1,
      reason: "The intro-request error line, a sentence.",
    },
  },
  "src/components/strategy/ShareableLink.tsx": {
    R5: {
      count: 2,
      reason: "The warning icon beside 'Copy failed' and 'Couldn't create the link'; error icons, no figure.",
    },
  },
  "src/components/strategy/StrategyForm.tsx": {
    R5: {
      count: 2,
      reason: "The form error and API error lines, sentences.",
    },
  },
  "src/components/strategy/SyncBadge.tsx": {
    R5: {
      count: 1,
      reason: "The word 'stale' in the trade-freshness sentence: a freshness state, no figure sign.",
    },
  },
  "src/components/strategy/SyncProgress.tsx": {
    R5: {
      count: 2,
      reason: "The `error` entry of the sync-state style map ('Sync failed', text and `bg-negative/10`): a state, not a figure.",
    },
  },
  "src/lib/dollar-validation.ts": {
    R6: {
      count: 1,
      reason: "formatUsd's whole-dollar rounding (`Number(n.toFixed(0)) + 0`): it chooses no sign glyph and no tone, Intl prints the native minus, and the `+ 0` turns a rounded -0 into 0. The signed P&L path (signAtCents / formatUsdSigned) delegates to roundForDisplay (WR-02).",
    },
  },
  "src/lib/portfolio-insights.ts": {
    R6: {
      count: 1,
      reason: "formatPct2 prints `Math.abs(trailDistance)`, a non-negative magnitude that can carry no sign. The signed correlation sentence goes through formatFixedSigned (WR-01).",
    },
  },
  "src/lib/utils.ts": {
    R5: {
      count: 7,
      reason: "STRATEGY_PALETTE's red series swatch (series identity) and the alert-severity maps SEVERITY_STYLES (text and `bg-negative/10`, for critical and high) / SEVERITY_HEX: severity categories keyed by AlertSeverity, not a sign.",
    },
    R6: {
      count: 8,
      reason: "formatCurrency's own tier branches: each runs on the magnitude of its tier (`-value` on the negative ones), the glyph is chosen once per branch, and the sub-$1K negative branch drops the sign at a printed zero through isPrintedZero.",
    },
  },
};

/** Two-sided pin check: a count that rises OR falls without its pin moving is a problem. */
export function pinProblems(rule: CountRule, actual: ReadonlyMap<string, number>, allow: Allowlist): string[] {
  const problems: string[] = [];
  const files = new Set<string>([...actual.keys()]);
  for (const [file, rules] of Object.entries(allow)) if (rules[rule]) files.add(file);
  for (const file of [...files].sort()) {
    const found = actual.get(file) ?? 0;
    const pin = allow[file]?.[rule]?.count;
    if (pin === undefined) {
      if (found > 0) problems.push(`${file}  ${rule}: ${found} found, NO pin (add an entry with a reason, or convert the site to display-sign)`);
    } else if (found !== pin) {
      problems.push(`${file}  ${rule}: ${found} found, pinned ${pin} (${found > pin ? "a new instance" : "an instance is gone"}: move the pin and re-read the sites)`);
    }
  }
  return problems;
}

/**
 * R3-WR-01 (170.6 round 3): the whole of `src`, outside the scan scope, swept with the three
 * rules that read a raw sign. R1, R2 and R7 admit no exception INSIDE the scan scope; OUTSIDE it
 * a hit is allowed only when it is not a sign and is pinned here, per file, with a reason written
 * after reading the site. A new hit anywhere under `src` fails until it is converted through
 * display-sign or pinned. (The entries are SWEEP pins: a file listed here must NOT be in the scope.)
 */
export const SWEEP_ALLOWLIST: Allowlist = {
  "src/components/landing/VerificationProgress.tsx": {
    R2: {
      count: 1,
      reason: "`status === \"failed\" && i === 0 && \"bg-negative\"` (line 82): `i` is the step INDEX of the first circle in the verification progress row, an index is never a signed figure, and the red is the failed-state chrome of that one circle; the `&&` chain is chosen by a status word and a position.",
    },
  },
};

// ---------------------------------------------------------------------------
// Population
// ---------------------------------------------------------------------------

function isTestPath(rel: string): boolean {
  return /\.test\.[^/]+$/.test(rel) || rel.split("/").includes("__tests__");
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      walk(abs, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    const rel = relative(REPO_ROOT, abs).split("\\").join("/");
    if (!isTestPath(rel)) out.push(rel);
  }
}

function listPopulation(): string[] {
  const out: string[] = [];
  for (const d of SCAN_DIRS) walk(join(REPO_ROOT, d), out);
  for (const f of SCAN_FILES) if (existsSync(join(REPO_ROOT, f))) out.push(f);
  return [...new Set(out)].filter((f) => f !== RULE_FILE).sort();
}

function listAllSrc(): string[] {
  const out: string[] = [];
  walk(SRC, out);
  return out.sort();
}

const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf8");

const fmt = (f: Finding) => `  ${f.file}:${f.line}  ${f.rule}  ${f.text}`;

// ---------------------------------------------------------------------------
// Self-tests: every matcher can fail, and can pass
// ---------------------------------------------------------------------------

describe("display-sign single-source guard — self-tests (every rule fires and every rule stays quiet)", () => {
  it("R1 reports a raw-sign '+' ternary, in either branch, and passes the display-sign call", () => {
    for (const red of [
      'const s = v >= 0 ? "+" : "";',
      "const s = v > 0 ? '+' : '';",
      'const s = v < 0 ? "" : "+";',
      "const s = `${v >= 0 ? \"+\" : \"\"}${v.toFixed(1)}`;",
      'const s = (v ?? 0) >= 0\n  ? "+"\n  : "";',
      'const s = 0 <= v ? "+" : "";',
    ]) {
      expect(findR1(red, "x.ts"), red).toHaveLength(1);
    }
    for (const green of [
      'const s = formatFixedSigned(v, { dp: 1, plus: true });',
      'const s = v >= 0 ? "up" : "down";',
      'const s = v >= 0.5 ? "+" : "";',
      "// const s = v >= 0 ? \"+\" : \"\";",
    ]) {
      expect(findR1(green, "x.ts"), green).toHaveLength(0);
    }
  });

  it("R2 reports a raw-sign colour ternary across whitespace and newlines, and passes a tone call", () => {
    for (const red of [
      'const c = v >= 0 ? "var(--color-positive)" : "var(--color-negative)";',
      'const c = v < 0 ? "text-negative" : "text-text-primary";',
      'const c = v > 0 ? CHART_POSITIVE : CHART_NEGATIVE;',
      'const c = v >= 0 ? "#15803D" : "#DC2626";',
      'const c = v >= 0\n  ?\n    "text-positive"\n  : "text-negative";',
      'const c = (v ?? 0) >= 0 ? "text-positive" : "text-negative";',
      'const c = v === 0 ? "text-text-muted" : "text-negative";',
      'const c = 0 <= v ? "text-positive" : "text-text-primary";',
      "const c = `x ${v >= 0 ? \"text-positive\" : \"text-negative\"}`;",
      // R2-SFH-1: the colour-bearing utility prefixes are tone tokens too.
      'const c = up >= 0 ? "bg-positive/10 text-accent" : "bg-negative/10 text-accent";',
      'const c = v < 0 ? "border-negative" : "border-border";',
      'const c = v > 0 ? "fill-positive" : "fill-muted";',
      'const c = v >= 0 ? "stroke-positive" : "stroke-negative";',
      'const c = v >= 0 ? "ring-positive/40" : "ring-border";',
      'if (raw > 0) return "bg-positive";',
      'if (raw > 0) return "text-positive";',
      'if ((raw ?? 0) < 0) {\n  return CHART_NEGATIVE;\n}',
    ]) {
      expect(findR2(red, "x.ts"), red).toHaveLength(1);
    }
    for (const green of [
      'const c = signTone(v, 2, 100) === "negative" ? "text-negative" : "text-text-primary";',
      'const c = tone === "positive" ? CHART_POSITIVE : CHART_NEGATIVE;',
      'const c = v >= 0.5 ? "text-positive" : "text-text-primary";',
      'const c = v > 0 ? "bold" : "normal"; const d = "text-negative";',
      '// const c = v >= 0 ? "text-positive" : "text-negative";',
      'const c = v ?? 0 ? "text-positive" : "text-negative";',
      'const c = rows.length > 0 ? "text-positive" : "text-negative";',
      'if (tone === "negative") return "text-negative";',
      'if (v > 0) return "bold";',
      'if (v > 0.5) return "text-positive";',
      // R2-SFH-1: a threshold, a collection size and a non-tone utility stay quiet for the new prefixes.
      'const c = v >= 0.5 ? "bg-positive" : "bg-surface";',
      'const c = rows.length > 0 ? "border-negative" : "border-border";',
      'const c = v >= 0 ? "bg-accent" : "bg-surface";',
      'const c = tone === "negative" ? "border-negative" : "border-border";',
    ]) {
      expect(findR2(green, "x.ts"), green).toHaveLength(0);
    }
  });

  // R3-SFH-3 (170.6 round 3): the tail reader bounds an arm by bracket depth, JSX-aware, and a
  // read that reaches its cap is a reported finding, never a silent truncation.
  it("R3-SFH-3: a long else arm is reported, and a comma or apostrophe in JSX text does not end the read early", () => {
    const long = "a".repeat(TAIL_CAP + 50);
    for (const red of [
      // A tone token in an else arm that sits past the cap: reported (the read did not reach it whole).
      `const c = v > 0 ? (<div>${long}</div>) : "text-negative";`,
      // A long arm with NO token at all is still a reported finding: the scan could not see the end.
      `const c = v > 0 ? (<div>${long}</div>) : null;`,
      // A comma in JSX text in the first arm no longer ends the tail before the else arm.
      'const el = v > 0 ? <p>Up, up</p> : <p className="text-negative">down</p>;',
      // An apostrophe in JSX text is text, not a quote: the else arm is still read.
      "const el = v > 0 ? <p>Don't</p> : <p className=\"text-negative\">down</p>;",
      // A comma inside a string literal and a JSX text comma together.
      'const el = v > 0 ? <p title="a, b">Hi, there</p> : <p className="bg-negative/10">x</p>;',
    ]) {
      expect(findR2(red, "x.tsx"), red.slice(0, 80)).toHaveLength(1);
    }
    // R1 reads the same tail: a "+" glyph in the else arm behind JSX text with a comma.
    expect(findR1('const s = v > 0 ? <b>Hi, there</b> : "+";', "x.tsx")).toHaveLength(1);
    expect(findR1(`const s = v > 0 ? (<b>${long}</b>) : "up";`, "x.tsx"), "a capped R1 read is reported").toHaveLength(1);
    for (const green of [
      // A long arm that ends inside the cap, with no tone token, stays quiet.
      `const c = v > 0 ? (<div>${"a".repeat(TAIL_CAP / 2)}</div>) : null;`,
      // The bracket depth still ends the read at an argument comma: the second argument is not an arm.
      'const c = cn(v > 0 ? "bold" : "normal", other && "text-negative");',
      // An apostrophe in JSX text is not a quote that swallows the `;` and drags the NEXT statement's
      // token into the read (on the old reader this was a false positive).
      "const el = v > 0 ? <p>Don't</p> : <p>x</p>; const b = \"text-negative\";",
      // JSX text with a comma and no tone token anywhere.
      'const el = v > 0 ? <p>Up, up</p> : <p>Don\'t</p>;',
    ]) {
      expect(findR2(green, "x.tsx"), green.slice(0, 80)).toHaveLength(0);
    }
  });

  it("readTail ends an expression by bracket depth, understands JSX text, and flags a read that hit its cap", () => {
    const end = (src: string, cap?: number) => readTail(src, 0, cap);
    // Natural ends: a `;` or `,` at depth 0, and a closer with no opener inside the tail.
    expect(end('"a" : "b"; rest')).toEqual({ text: '"a" : "b"', capped: false });
    expect(end('"a" : "b", rest')).toEqual({ text: '"a" : "b"', capped: false });
    expect(end('"a" : "b") rest')).toEqual({ text: '"a" : "b"', capped: false });
    expect(end('"a" : "b"}')).toEqual({ text: '"a" : "b"', capped: false });
    // A comma inside brackets, a string literal or a template literal is not an end.
    expect(end('f(a, b) : "x, y"; z').text).toBe('f(a, b) : "x, y"');
    expect(end("`a, ${b}` : c; z").text).toBe("`a, ${b}` : c");
    // JSX text: a comma and an apostrophe are text; the element's own close then the `;` ends it.
    expect(end("<p>Up, up</p> : <p>Don't, ever</p>; z").text).toBe("<p>Up, up</p> : <p>Don't, ever</p>");
    // A `>` inside an attribute expression does not end the tag, and `{...}` children are JS again.
    expect(end('<b onClick={() => go(1, 2)}>a, {x ? "p" : "q"} b</b>; z').text).toBe('<b onClick={() => go(1, 2)}>a, {x ? "p" : "q"} b</b>');
    // A self-closing tag leaves no open element behind.
    expect(end('<i className="a" />, rest').text).toBe('<i className="a" />');
    // A comparison `<` is not a tag.
    expect(end("a < b ? 1 : 2, rest").text).toBe("a < b ? 1 : 2");
    // The cap: a read that runs out of budget says so, and a read that ends in time does not.
    expect(end(`${"x".repeat(30)}; z`, 10)).toEqual({ text: "x".repeat(10), capped: true });
    expect(end("short; z", 10)).toEqual({ text: "short", capped: false });
    expect(end("no end here", 100), "end of file is a natural end, not a cap").toEqual({ text: "no end here", capped: false });
  });

  // R3-WR-01 + R3-SFH-4 (170.6 round 3): the same defect in the shapes rounds 1 and 2 did not read.
  it("R3-WR-01: an inline raw comparison gated by && or || paints a tone or a '+' glyph, and R1/R2 see it", () => {
    for (const red of [
      'const c = cn("a", delta > 0 && "text-positive");',
      'return <i className={cn("a", delta < 0 && "bg-negative/10")} />;',
      '{delta > 0 && <span className="bg-positive/10">up</span>}',
      'const c = (v ?? 0) > 0 && "text-positive";',
      'const c = delta > 0 &&\n  "text-positive";',
      'const c = cn("a", delta > 0 || "text-negative");',
      'const c = 0 < delta && "text-positive";',
      'const c = (delta > 0) && "text-positive";',
      'const c = cn("a", delta > 0 && delta < 9 && "border-positive");',
      // clsx object keys: the key is a tone token and its value is a raw comparison.
      'const c = cn({ "text-positive": delta > 0 });',
      "const c = cn(\"a\", { 'text-negative': delta < 0 });",
      'const c = clsx({\n  "bg-negative/10": delta < 0,\n});',
      // the token prefixes outline / shadow / from / via / to / divide / decoration / accent / caret
      'const c = v > 0 ? "outline-positive" : "outline-negative";',
      'const c = v > 0 ? "shadow-negative" : "shadow-sm";',
      'const c = v > 0 ? "from-positive" : "from-surface";',
      'const c = v > 0 ? "via-positive" : "via-surface";',
      'const c = v > 0 ? "to-positive" : "to-surface";',
      'const c = v > 0 ? "divide-negative" : "divide-border";',
      'const c = v > 0 ? "decoration-positive" : "decoration-border";',
      'const c = v > 0 ? "accent-positive" : "accent-border";',
      'const c = v > 0 ? "caret-negative" : "caret-border";',
      'const c = cn("a", v > 0 && "hover:shadow-positive/20");',
    ]) {
      expect(findR2(red, "x.tsx"), red).toHaveLength(1);
    }
    for (const red of [
      '{v > 0 && "+"}{fmt(v)}',
      "const s = (v > 0 && '+') + fmt(v);",
      "const s = v >= 0 && `+`;",
      'const s = (v ?? 0) > 0 &&\n  "+";',
      'const s = `${v > 0 && "+"}${fmt(v)}`;',
    ]) {
      expect(findR1(red, "x.tsx"), red).toHaveLength(1);
    }
    for (const green of [
      // collection sizes and counts (the AdminTabs.tsx:219 shape is a COUNT, a non-negative number)
      'const c = rows.length > 0 && "text-negative";',
      '{rows.length > 0 && <p className="text-negative">{rows.length} rows</p>}',
      '{counts.declined > 0 && <span className="text-negative font-medium">{counts.declined} declined</span>}',
      '{hiddenCount > 0 && <span className="text-negative">{hiddenCount} hidden</span>}',
      '{items.size > 0 && <p className="bg-negative/5">x</p>}',
      // a threshold, an equality with a word, a tone-derived boolean and a non-tone class
      'const c = v >= 0.5 && "text-positive";',
      'const c = tone === "positive" && "text-positive";',
      'const c = signTone(v, 2, 100) === "negative" && "text-negative";',
      'const c = cn("a", delta > 0 && "font-semibold");',
      'const c = cn({ "text-positive": tone === "positive", "text-negative": tone === "negative" });',
      'const c = cn({ "text-negative": rows.length > 0 });',
      'const c = cn({ "text-negative": counts.declined > 0 });',
      'const c = cn({ "font-bold": delta > 0 });',
      // a ternary arm that merely PRINTS the key is not an object key
      'const c = ok ? "text-positive" : delta > 0;',
      // a comment naming the idiom
      '// const c = cn(delta > 0 && "text-positive");',
      '{v > 0 && "up"}',
    ]) {
      expect(findR2(green, "x.tsx"), green).toHaveLength(0);
      expect(findR1(green, "x.tsx"), green).toHaveLength(0);
    }
  });

  it("R3-SFH-4: R7 follows a raw-sign boolean into ||, if-return, clsx object keys and an arrow-wrapped boolean", () => {
    for (const red of [
      'const up = delta > 0;\nconst c = cn("a", { "text-positive": up });',
      'const up = delta > 0;\nconst c = cn({ "text-negative": !up });',
      "const down = delta < 0;\nconst c = clsx({ 'bg-negative/10': down, 'bg-positive/10': !down });",
      'const up = delta > 0;\nconst c = up || "text-negative";',
      'const up = delta > 0;\nconst c = cn("a", !up || "text-negative");',
      'const up = delta > 0;\nfunction tone() {\n  if (up) return "text-positive";\n  return "text-text-muted";\n}',
      'const up = delta > 0;\nfunction tone() {\n  if (!up) {\n    return "text-negative";\n  }\n  return "";\n}',
      'const isUp = (v: number) => v > 0;\nconst c = isUp(x) ? "text-positive" : "text-negative";',
      'const isUp = (v) => v > 0;\nconst c = cn("a", isUp(fmt(x)) && "text-positive");',
      'const isUp = v => v >= 0;\nconst c = isUp(x) || "text-negative";',
      'const isUp = (v: number): boolean => v > 0;\nif (isUp(x)) return "text-positive";',
      'const isUp = (v: number) => v > 0;\nconst c = cn({ "text-positive": isUp(x) });',
    ]) {
      expect(findR7(red, "x.ts"), red).toHaveLength(1);
    }
    // A right side that outgrows R7_RHS_CAP is reported BEFORE the comparison and arrow filters:
    // here the zero comparison sits past the cap, and here an arrow sits inside the cap.
    const padLong = "someVeryLongIdentifier === anotherVeryLongIdentifier && ".repeat(80);
    expect(padLong.length).toBeGreaterThan(R7_RHS_CAP);
    for (const red of [
      `const up = ${padLong}delta > 0;\nconst c = "text-positive";`,
      `const up = items.every((i) => i.ok) && ${padLong}delta > 0;\nconst c = "text-positive";`,
    ]) {
      const hits = findR7(red, "x.ts");
      expect(hits, red.slice(0, 60)).toHaveLength(1);
      expect(hits[0].text).toContain("R7_RHS_CAP");
    }
    for (const green of [
      // tone-derived booleans stay quiet in every new use shape
      'const up = signTone(delta, 2, 100) === "positive";\nconst c = cn({ "text-positive": up });',
      'const up = signTone(delta, 2, 100) === "positive";\nif (up) return "text-positive";',
      'const up = signTone(delta, 2, 100) === "positive";\nconst c = up || "text-negative";',
      'const isUp = (v: number) => signTone(v, 2, 100) === "positive";\nconst c = isUp(x) ? "text-positive" : "text-negative";',
      // counts and lengths, in every new use shape
      'const hasRows = rows.length > 0;\nconst c = cn({ "text-negative": hasRows });',
      'const hasRows = rows.length > 0;\nif (hasRows) return "text-negative";',
      'const hasRows = rows.length > 0;\nconst c = hasRows || "text-negative";',
      'const hasRows = (a: Row[]) => a.length > 0;\nconst c = hasRows(x) ? "text-negative" : "text-positive";',
      'const hasDeclined = counts.declined > 0;\nconst c = cn({ "text-negative": hasDeclined });',
      // a raw-sign boolean that never routes a tone
      'const up = delta > 0;\nconst c = cn({ "font-bold": up });',
      'const up = delta > 0;\nif (up) return "up";\nconst c = "text-negative";',
      'const isUp = (v: number) => v > 0;\nconst label = isUp(x) ? "up" : "down";\nconst c = "text-negative";',
      // a map callback is not an arrow-wrapped boolean helper
      'const bull = regimes.map((r) => r > 0);\nconst c = cn({ "text-positive": bull });',
      // a capped right side that is not boolean-looking (a long callback body) is not a boolean
      `const rows = useMemo(() => {\n  const out = [];\n  const pad = "${"x".repeat(R7_RHS_CAP)}";\n  return out;\n}, [a]);\nconst c = "text-negative";`,
    ]) {
      expect(findR7(green, "x.ts"), green.slice(0, 80)).toHaveLength(0);
    }
  });

  it("R3 reports a negative flag set from a raw zero comparison, and passes a tone call", () => {
    for (const red of [
      "<Metric negative={(x ?? 0) < 0} />",
      "<Metric negative={x < 0} />",
      "const negative = value < 0;",
      "const o = { negative: value < 0 };",
      "<Metric negative={\n  (x ?? 0) < 0\n} />",
      "const isNegative = value < 0;",
    ]) {
      expect(findR3(red, "x.tsx"), red).toHaveLength(1);
    }
    for (const green of [
      '<Metric negative={drawdownTone(x, 2, 100) === "negative"} />',
      "const negative = signTone(v, 2) === 'negative';",
      "<Metric negative={x < 0.5} />",
      "const m = { negative: false };",
      "// <Metric negative={x < 0} />",
    ]) {
      expect(findR3(green, "x.tsx"), green).toHaveLength(0);
    }
  });

  it("R4 reports a metricColor declaration, and passes a call or an import", () => {
    for (const red of [
      "function metricColor(v: number) { return v; }",
      "export function metricColor(v: number) { return v; }",
      "const metricColor = (v: number) => v;",
      "let metricColor;",
    ]) {
      expect(findR4(red, "x.ts"), red).toHaveLength(1);
    }
    for (const green of [
      'import { metricColor } from "@/lib/utils";',
      'const c = metricColor(v, "percent");',
      "// function metricColor(v) {}",
      "function metricColorFor(v: number) { return v; }",
    ]) {
      expect(findR4(green, "x.ts"), green).toHaveLength(0);
    }
  });

  it("R5 counts a constant negative tone, and ignores a conditional, a Sparkline color and a comment", () => {
    for (const red of [
      '<p className="text-sm text-negative">{error}</p>',
      '<p style={{ color: "var(--color-negative)" }}>x</p>',
      '<rect fill="#DC2626" />',
      "<rect fill={CHART_NEGATIVE} />",
      "const CELL = `base text-right text-negative`;",
      '{error && <p className="text-negative">{error}</p>}',
      'const c = { negative: "text-negative", positive: "text-positive" };',
      '<i style={{ background: "var(--color-negative, #DC2626)" }} />',
    ]) {
      expect(findR5(red), red).toHaveLength(1);
    }
    for (const green of [
      'const c = tone === "negative" ? "text-negative" : "text-text-primary";',
      'const c = a ? "x" : "text-negative";',
      'const c = tone === "positive"\n  ? "text-positive"\n  : tone === "negative"\n    ? "text-negative"\n    : "text-text-primary";',
      'const c = tone === "positive"\n  ? "text-positive"\n  : "text-negative";',
      'if (tone === "negative") return "text-negative";',
      'if (tone === "negative") {\n  return "text-negative";\n}',
      'switch (t) {\n  case "neg": return "text-negative";\n}',
      '<Sparkline data={d} color="var(--color-negative)" />',
      '<Sparkline\n  data={d}\n  color="var(--color-negative)"\n/>',
      '// <p className="text-negative">',
      "const t = CHART_NEGATIVE_100;",
      // R2-SFH-1: a conditional bg / border / fill token is a choice, not a constant.
      'const c = tone === "negative" ? "bg-negative/10" : "bg-surface";',
      'const c = a ? "x" : "border-negative";',
      'const c = positive ? "bg-positive" : "bg-accent";',
      'import { CHART_NEGATIVE, CHART_POSITIVE } from "./chart-tokens";',
      'import {\n  CHART_NEGATIVE,\n  CHART_TEXT_MUTED,\n} from "@/components/charts/chart-tokens";',
    ]) {
      expect(findR5(green), green).toHaveLength(0);
    }
    expect(findR5('<Sparkline data={d} color="x" />\n<p className="text-negative">e</p>'), "a Sparkline does not hide the next line").toEqual([2]);
    // R2-SFH-1: every colour-bearing utility prefix counts as a negative tone, one hit per token.
    for (const [red, n] of [
      ['<div className="bg-negative/10 border-negative" />', 2],
      ['<div className="rounded border border-negative/30 p-3" />', 1],
      ['<rect className="fill-negative" />', 1],
      ['<path className="stroke-negative" />', 1],
      ['<input className="focus:ring-negative/50" />', 1],
      ['{error && <div className="bg-negative/5 px-3">{error}</div>}', 1],
      ['const c = { high: "bg-negative" };', 1],
    ] as const) {
      expect(findR5(red), red).toHaveLength(n);
    }
    expect(findR5('<div className="bg-positive/10 border-positive text-positive" />'), "a positive token is not a negative tone").toHaveLength(0);
  });

  it("R6 counts every toFixed call, and ignores a comment", () => {
    expect(findR6("const a = v.toFixed(2); const b = (w * 100).toFixed(1);")).toHaveLength(2);
    expect(findR6("const a = v.toFixed(2);\nconst b = w.toFixed(0);")).toEqual([1, 2]);
    expect(findR6("// v.toFixed(2)\n/* w.toFixed(1) */\nconst a = formatFixedSigned(v, { dp: 2 });")).toEqual([]);
    expect(findR6("const a = Number(v).toPrecision(2);")).toEqual([]);
  });

  it("R7 reports a boolean from a raw zero comparison that picks a colour, and passes a tone-derived one", () => {
    for (const red of [
      'const positive = v >= 0;\nconst c = positive ? "text-positive" : "text-negative";',
      'const up = (v ?? 0) > 0;\nreturn up ? CHART_POSITIVE : CHART_NEGATIVE;',
      'const bull = r < 0;\nconst c = !bull ? "var(--color-positive)" : "var(--color-negative)";',
      'let favorable: boolean = delta >= 0;\nconst c = favorable ? "#15803D" : "#DC2626";',
      // WR-04: a raw-sign boolean choosing between PARENTHESIZED red and green elements.
      'const up = delta >= 0;\nreturn <td>{up ? (<span className="text-positive">{txt}</span>) : (<span className="text-negative">{txt}</span>)}</td>;',
      // R2-SFH-1: the ORIGINAL WR-03 shape. A hedge chosen by a raw sign, painted with a bg-* token.
      'const isHedge = pcr < 0;\nconst bar = (\n  <div className={isHedge ? "bg-positive" : "bg-accent"} />\n);',
      // R2-SFH-1: the same boolean gating an element that carries the tone, and a class gated inside cn().
      'const isHedge = pcr < 0;\nreturn <div>{isHedge && <span className="bg-positive/10 px-1">hedge</span>}</div>;',
      'const up = delta >= 0;\nreturn <td className={cn("px-2", up && "text-positive", !up && "text-negative")} />;',
      'const down = delta < 0;\nreturn <i className={cn("a", down && "border-negative")} />;',
      // R2-SFH-1: a comparison longer than the old 160-character window, split over lines, is read whole.
      'const up =\n  someFarTooLongIdentifierForTheFirstOperand.nested.value.reading > 1 ||\n  anotherDeliberatelyLongIdentifierForTheSecondOperand.nested.value.reading > 2 ||\n  yetAnotherLongIdentifierForTheThirdOperand.nested.value.reading >= 0;\nconst c = up ? "stroke-positive" : "stroke-muted";',
      // WR-04: the validity-guard shape is the same text, which is why RiskAttribution is a pinned entry and not a matcher exception.
      'const ok = share >= 0;\nreturn ok ? (<span className="text-muted">x</span>) : (<span className={`a ${over ? "text-negative" : "text-positive"}`}>y</span>);',
    ]) {
      expect(findR7(red, "x.ts"), red).toHaveLength(1);
    }
    for (const green of [
      'const favorable = signTone(delta, 2, 100) === "positive";\nconst c = favorable ? "text-positive" : "text-negative";',
      'const positive = v >= 0;\nconst label = positive ? "up" : "down";',
      'const positive = v >= 0.5;\nconst c = positive ? "text-positive" : "text-negative";',
      'const seg = { bull: true };\nconst c = seg.bull ? "var(--color-positive)" : "var(--color-negative)";',
      'const bull = regimes.map((r) => r > 0);\nconst c = bull ? "text-positive" : "text-negative";',
      'const hasRows = rows.length > 0;\nconst c = hasRows ? "var(--color-chart-benchmark)" : CHART_NEGATIVE;',
      // R2-SFH-1: a collection size, a threshold and a non-tone gate stay quiet for the new forms.
      'const hasRows = rows.length > 0;\nreturn hasRows && <p className="bg-negative/5">x</p>;',
      'const isHedge = pcr < 0;\nreturn isHedge && <span className="px-1">hedge</span>;',
      'const isHedge = signTone(pcr, 1, 100) === "negative";\nreturn isHedge && <span className="bg-positive/10">hedge</span>;',
      'const big = v >= 0.5;\nreturn <i className={cn("a", big && "border-negative")} />;',
      'const isHedge = pcr < 0;\nconst c = isHedge ? "bg-accent" : "bg-surface";',
    ]) {
      expect(findR7(green, "x.ts"), green).toHaveLength(0);
    }
  });

  it("R8 counts a constant JSX negative attribute, and ignores a computed one, a read and a type", () => {
    for (const red of [
      '<MetricCell label="Max DD" value={x} negative />',
      '<MetricCell label="Max DD" value={x} negative={true} />',
      '<MetricCell\n  label="Max DD"\n  negative\n  value={x}\n/>',
      '<Metric label="x" negative>kids</Metric>',
    ]) {
      expect(findR8(red), red).toHaveLength(1);
    }
    for (const green of [
      '<MetricCell negative={drawdownTone(x, 2, 100) === "negative"} />',
      "<MetricCell negative={isDown} />",
      "<MetricCell negative={false} />",
      "function Metric({ label, negative = false }: { label: string; negative?: boolean }) {}",
      'const c = negative ? "text-negative" : "text-text-primary";',
      "function Metric({ negative }: Props) {}",
      "const o = { negative: true };",
      '// <MetricCell negative />',
    ]) {
      expect(findR8(green), green).toHaveLength(0);
    }
  });

  it("the pin check is two-sided: a rise, a fall and an unpinned file each fail; an exact pin passes", () => {
    const allow: Allowlist = { "a.ts": { R6: { count: 2, reason: "x" } }, "c.ts": { R6: { count: 1, reason: "y" } } };
    expect(pinProblems("R6", new Map([["a.ts", 2], ["c.ts", 1]]), allow)).toEqual([]);
    expect(pinProblems("R6", new Map([["a.ts", 3], ["c.ts", 1]]), allow).join("\n")).toMatch(/a\.ts.*3 found, pinned 2.*new instance/);
    expect(pinProblems("R6", new Map([["a.ts", 1], ["c.ts", 1]]), allow).join("\n")).toMatch(/a\.ts.*1 found, pinned 2.*gone/);
    expect(pinProblems("R6", new Map([["a.ts", 2], ["c.ts", 1], ["b.ts", 1]]), allow).join("\n")).toMatch(/b\.ts.*NO pin/);
    expect(pinProblems("R6", new Map([["a.ts", 2]]), allow).join("\n")).toMatch(/c\.ts.*0 found, pinned 1/);
    expect(pinProblems("R5", new Map(), allow)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The real tree
// ---------------------------------------------------------------------------

describe("display-sign single-source guard — the census scope", () => {
  const population = listPopulation();

  it("scans a real population, and every census file is in it (an empty scan would pass vacuously)", () => {
    expect(population.length, `scanned ${population.length} files`).toBeGreaterThanOrEqual(POPULATION_FLOOR);
    expect(population.some(isTestPath)).toBe(false);
    expect(population).not.toContain(RULE_FILE);
    const missing = CENSUS_FILES.filter((f) => !population.includes(f));
    expect(missing, `census files missing from the scan:\n${missing.join("\n")}`).toEqual([]);
  });

  it("the tail reader's cap sits far above the longest tail in the scan scope (R3-SFH-3)", () => {
    // A read that reaches TAIL_CAP is a finding, so the cap must leave real headroom: a ternary
    // whose arm is a whole JSX panel is read whole, and a future one nearing the cap is noticed here.
    const longest = Math.max(0, ...population.map((f) => maxTailRead(read(f))));
    expect(longest, "a tail nears TAIL_CAP: raise the cap and re-measure").toBeLessThan(TAIL_CAP / 2);
    expect(longest, "the longest tail read is a real panel, so a zero means the reader is not reading").toBeGreaterThan(500);
  });

  it("R1: no raw-sign '+' prefix", () => {
    const hits = population.flatMap((f) => findR1(read(f), f));
    expect(hits, `A '+' glyph is chosen by a raw sign. Use formatFixedSigned / formatSignedPercent:\n${hits.map(fmt).join("\n")}`).toEqual([]);
  });

  it("R2: no raw-sign colour ternary", () => {
    const hits = population.flatMap((f) => findR2(read(f), f));
    expect(hits, `A colour is chosen by a raw sign. Use signTone / drawdownTone / percentTone:\n${hits.map(fmt).join("\n")}`).toEqual([]);
  });

  it("R3: no raw-sign negative flag", () => {
    const hits = population.flatMap((f) => findR3(read(f), f));
    expect(hits, `A negative flag is set from a raw sign. Use drawdownTone(...) === "negative":\n${hits.map(fmt).join("\n")}`).toEqual([]);
  });

  it("R4: metricColor is declared in src/lib/utils.ts and nowhere else under src", () => {
    const all = listAllSrc();
    expect(all.length).toBeGreaterThan(POPULATION_FLOOR);
    const hits = all.filter((f) => f !== METRIC_COLOR_HOME).flatMap((f) => findR4(read(f), f));
    expect(hits, `A second metricColor:\n${hits.map(fmt).join("\n")}`).toEqual([]);
    expect(findR4(read(METRIC_COLOR_HOME), METRIC_COLOR_HOME), "the one home still declares it").toHaveLength(1);
  });

  const countsFor = (find: (s: string) => number[]) => {
    const m = new Map<string, number>();
    for (const f of population) {
      const n = find(read(f)).length;
      if (n > 0) m.set(f, n);
    }
    return m;
  };

  it("R5: every constant negative tone is pinned with a reason (D-04)", () => {
    const problems = pinProblems("R5", countsFor(findR5), ALLOWLIST);
    expect(problems, `Constant negative tones moved:\n${problems.join("\n")}`).toEqual([]);
  });

  it("R7: every boolean from a raw zero comparison that routes a tone is pinned with a reason (D-03)", { timeout: 30_000 }, () => {
    const counts = new Map<string, number>();
    for (const f of population) {
      const n = findR7(read(f), f).length;
      if (n > 0) counts.set(f, n);
    }
    // The 160-character window is gone (R2-SFH-1). The safety cap must sit far above the longest
    // comparison RHS actually present, so a truncated read can never hide a boolean. Measured
    // 2026-10-14 over all of src, with the JSX-aware reader: 1734 (AllocationsTabs.tsx, outside the
    // scan scope) and 1413 in scope (ScenarioComposer.tsx), against R7_RHS_CAP = 4000. (The pre-round-3 reader ended a read at a
    // comma in JSX text and measured 385; the cap moved from 1200 when the reader became honest.)
    const longest = Math.max(0, ...population.map((f) => maxR7Rhs(read(f))));
    expect(longest, "an R7 right side nears R7_RHS_CAP: raise the cap and re-measure").toBeLessThan(R7_RHS_CAP / 2);
    const problems = pinProblems("R7", counts, ALLOWLIST);
    expect(problems, `A boolean from a raw sign routes a colour. Derive it from signTone / drawdownTone, or pin a validity guard with a reason:\n${problems.join("\n")}`).toEqual([]);
  });

  it("R6: every toFixed call is pinned with a reason (D-02)", () => {
    const problems = pinProblems("R6", countsFor(findR6), ALLOWLIST);
    expect(problems, `toFixed calls moved:\n${problems.join("\n")}`).toEqual([]);
  });

  it("R8: every constant JSX negative attribute is pinned with a reason (D-04)", () => {
    const problems = pinProblems("R8", countsFor(findR8), ALLOWLIST);
    expect(problems, `Constant negative attributes moved:\n${problems.join("\n")}`).toEqual([]);
  });

  it("sweep: R1, R2 and R7 over ALL of src outside the scan scope; every hit is pinned with a reason", { timeout: 30_000 }, () => {
    const outside = listAllSrc().filter((f) => !population.includes(f) && f !== RULE_FILE);
    expect(outside.length, "the sweep must read the files the scan scope does not").toBeGreaterThan(200);
    const counts: Record<"R1" | "R2" | "R7", Map<string, number>> = { R1: new Map(), R2: new Map(), R7: new Map() };
    for (const f of outside) {
      const source = read(f);
      for (const [rule, find] of [["R1", findR1], ["R2", findR2], ["R7", findR7]] as const) {
        const n = find(source, f).length;
        if (n > 0) counts[rule].set(f, n);
      }
    }
    const problems = (["R1", "R2", "R7"] as const).flatMap((rule) => pinProblems(rule, counts[rule], SWEEP_ALLOWLIST));
    expect(problems, `A raw-sign shape outside the scan scope. Convert it through display-sign, or pin a non-sign with a reason in SWEEP_ALLOWLIST:\n${problems.join("\n")}`).toEqual([]);
  });
});

describe("display-sign single-source guard — the allowlist is well-formed", () => {
  const population = listPopulation();

  it("every sweep pin names a real file OUTSIDE the scan scope, a positive count and a real reason", () => {
    const all = listAllSrc();
    for (const [file, rules] of Object.entries(SWEEP_ALLOWLIST)) {
      expect(all, `${file} does not exist under src`).toContain(file);
      expect(population, `${file} is in the scan scope: its hits are not pinnable, convert them`).not.toContain(file);
      for (const [rule, entry] of Object.entries(rules)) {
        expect(entry.count, `${file} ${rule}: a pin of 0 is no pin; delete the entry`).toBeGreaterThan(0);
        expect(entry.reason.trim().length, `${file} ${rule}: the reason is too short to be one`).toBeGreaterThanOrEqual(20);
      }
    }
  });

  it("every entry names a scanned file, a positive pin and a real reason", () => {
    for (const [file, rules] of Object.entries(ALLOWLIST)) {
      expect(population, `${file} is not in the scanned population`).toContain(file);
      for (const [rule, entry] of Object.entries(rules)) {
        expect(entry.count, `${file} ${rule}: a pin of 0 is no pin; delete the entry`).toBeGreaterThan(0);
        expect(entry.reason.trim().length, `${file} ${rule}: the reason is too short to be one`).toBeGreaterThanOrEqual(20);
      }
    }
  });
});
