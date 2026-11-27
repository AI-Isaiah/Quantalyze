/**
 * Phase 252 plan 05 - the census for the options-book withhold.
 *
 * THE PROPERTY. ROADMAP SC-3 says "every surface agrees": a strategy whose stored figures are
 * measured on an options book's cash wallet (the composite carries
 * `mtm_gated_reason: "unsmoothed_options_book"`) shows no figure on ANY surface, and no surface
 * decides that on its own. Until this file that claim was assumed. Four arms make it a failing test:
 *
 *   1. AGREEMENT. One triggered value driven through every pure seam (the headline verdict, the
 *      list shaper, the record carrier, the constituent parser) withholds, and the same value with
 *      any other reason does not.
 *   2. CROSS-LANGUAGE. The TS trigger literal equals the Python producer's string, read from
 *      `analytics-service/services/stitch_composite.py`, and exactly one of the producer's
 *      `MTM_REASON_*` values triggers. A renamed producer string, or a second reason that also
 *      triggers, fails here.
 *   3. LITERAL. No non-test file under `src/` compares the trigger literal outside a closed
 *      allowlist. The predicate in `headline-basis.ts` is the one place the string is compared.
 *   4. COMPLETENESS. Every non-test file under `src/` that reads `strategy_analytics` calls a
 *      withhold seam, or sits in `EXCLUDED` under a closed reason this file checks. A surface a
 *      plan missed, or a new one, fails by name.
 *
 * ORACLE INDEPENDENCE. The trigger literal, the cause literal, the seam call tokens, the reason set,
 * the allowlist and the map are typed here. The predicate and the pure seams are imported ONLY by
 * the agreement arm, which is the one place their behaviour is the subject. Everything the other
 * three arms decide comes from this file and from the repository text.
 *
 * HOW A FILE IS READ. Comments are stripped (`stripCommentsPreserveLines`) before any pattern runs,
 * so a docblock that quotes a seam or the literal neither satisfies nor trips an arm. String
 * contents survive, so a column named inside a string does match; that is why `status only` is
 * checked against the stripped text rather than trusted. The repository is read, never executed.
 *
 * `EXCLUDED` CLOSED REASONS. `status only`, `out of scope: admin (CONTEXT)`,
 * `out of scope: wizard (CONTEXT)`, `deferred: blend (CONTEXT)`,
 * `outside the ruling: honours neither the verdict nor D-15`, `dead: <why>` and
 * `gated upstream: <repo-relative path>`. Each one that can be checked against the file is checked
 * (see `reasonProblems`), so a reason cannot outlive the fact that justified it.
 *
 * ANTI-VACUITY. The walk is non-empty and finds named anchors; every `EXCLUDED` key names a file in
 * the reader population (a stale entry fails); an `EXCLUDED` file that a seam already covers is
 * redundant and fails; every `gated upstream:` target exists and is covered; and a planted
 * temp-directory self-test proves an uncovered reader is flagged and a comment-only mention is not.
 */
import { describe, it, expect, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { stripCommentsPreserveLines } from "@/lib/source-scan";

// The agreement arm imports queries.ts, which reaches the Supabase clients.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

import {
  HEADLINE_BASIS_FLAG,
  HEADLINE_BASIS_SMOOTHED,
  OPTIONS_CASH_WALLET_REASON,
  headlineVerdict,
  isOptionsCashWalletReason,
  isSmoothedHeadlineRow,
} from "@/lib/factsheet/headline-basis";
import { applyHeadlineBasis } from "@/lib/factsheet/composite-read-path";
import { computeOgHeadline } from "@/lib/factsheet/og-metrics";
import { shapeRowAnalytics } from "@/lib/queries";
import { EMPTY_ANALYTICS } from "@/lib/utils";
import { gateAnnualized } from "@/lib/figure-gate";
import { recordFromScalars } from "@/lib/figure-record-scalars";
import { parseConstituentRecord } from "@/app/(dashboard)/allocations/lib/constituent-figure";
import type { StrategyAnalytics } from "@/lib/types";

const REPO_ROOT = process.cwd();

/** The trigger literal and the cause literal, typed here and never read from the code under test. */
const TRIGGER_LITERAL = "unsmoothed_options_book";
const CAUSE_LITERAL = "options_cash_wallet";
const PRODUCER_FILE = "analytics-service/services/stitch_composite.py";
/**
 * Phase 252 G252-MTM-PROMOTION (plan 10): the marker a PROMOTED composite stores,
 * `data_quality_flags.headline_basis = "smoothed_mtm"`. Typed here, never read from the code under test.
 */
const MARKER_FLAG_LITERAL = "headline_basis";
const MARKER_VALUE_LITERAL = "smoothed_mtm";

// ---------------------------------------------------------------------------------------------
// Shared file helpers
// ---------------------------------------------------------------------------------------------

function isTestPath(rel: string): boolean {
  const parts = rel.split("/");
  return (
    /\.test\.[^/]+$/.test(rel) ||
    /\.spec\.[^/]+$/.test(rel) ||
    /\.d\.ts$/.test(rel) ||
    parts.includes("__tests__") ||
    parts.includes("__fixtures__")
  );
}

function walk(repoRoot: string, dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) {
      walk(repoRoot, abs, out);
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    const rel = relative(repoRoot, abs).split("\\").join("/");
    if (!isTestPath(rel)) out.push(rel);
  }
}

/** Every non-test .ts/.tsx under `src/` of `repoRoot`, sorted, minus the generated database types. */
function walkSrc(repoRoot: string): string[] {
  const out: string[] = [];
  const abs = join(repoRoot, "src");
  if (existsSync(abs) && statSync(abs).isDirectory()) walk(repoRoot, abs, out);
  return out.filter((r) => r !== "src/lib/database.types.ts").sort();
}

function readStripped(repoRoot: string, rel: string): string {
  return stripCommentsPreserveLines(readFileSync(resolve(repoRoot, rel), "utf8"));
}

// ---------------------------------------------------------------------------------------------
// Arm 2 - the producer's strings
// ---------------------------------------------------------------------------------------------

/** Module-level `MTM_REASON_X = "value"` assignments, name to value. */
function parseProducerReasons(python: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of python.matchAll(/^(MTM_REASON_[A-Z0-9_]+)\s*=\s*"([^"\n]*)"\s*(?:#.*)?$/gm)) out[m[1]] = m[2];
  return out;
}

/** Module-level `HEADLINE_BASIS_FLAG` / `HEADLINE_BASIS_SMOOTHED` assignments, name to value. */
function parseProducerMarker(python: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of python.matchAll(/^(HEADLINE_BASIS_(?:FLAG|SMOOTHED))\s*=\s*"([^"\n]*)"\s*(?:#.*)?$/gm)) out[m[1]] = m[2];
  return out;
}

const PRODUCER_REASONS = parseProducerReasons(readFileSync(resolve(REPO_ROOT, PRODUCER_FILE), "utf8"));
const OTHER_REASONS = Object.entries(PRODUCER_REASONS)
  .filter(([name]) => name !== "MTM_REASON_OPTIONS")
  .map(([, value]) => value);

describe("options-book census - arm 2: the TS trigger equals the Python producer's string", () => {
  it("reads at least seven MTM_REASON_* assignments, and MTM_REASON_OPTIONS is the typed trigger literal", () => {
    expect(Object.keys(PRODUCER_REASONS).length).toBeGreaterThanOrEqual(7);
    expect(PRODUCER_REASONS.MTM_REASON_OPTIONS).toBe(TRIGGER_LITERAL);
    // The TS constant the predicate compares is the same string (the cross-language pin).
    expect(OPTIONS_CASH_WALLET_REASON).toBe(PRODUCER_REASONS.MTM_REASON_OPTIONS);
  });

  it("exactly one producer value triggers the predicate, and it is MTM_REASON_OPTIONS's", () => {
    const triggering = Object.entries(PRODUCER_REASONS).filter(([, value]) => isOptionsCashWalletReason(value));
    expect(triggering.map(([name]) => name)).toEqual(["MTM_REASON_OPTIONS"]);
  });

  it("anti-vacuity: the parser reads a planted producer and ignores a comment and an f-string", () => {
    const planted = [
      'MTM_REASON_A = "alpha"',
      'MTM_REASON_B = "beta"  # trailing note',
      '# MTM_REASON_C = "gamma"',
      'MTM_REASON_D = f"{x}"',
      '    MTM_REASON_E = "indented"',
    ].join("\n");
    expect(parseProducerReasons(planted)).toEqual({ MTM_REASON_A: "alpha", MTM_REASON_B: "beta" });
  });
});

describe("options-book census - arm 2b: the promoted-row marker equals the Python producer's pair", () => {
  const PRODUCER_MARKER = parseProducerMarker(readFileSync(resolve(REPO_ROOT, PRODUCER_FILE), "utf8"));

  /**
   * Rule 9: a producer that renamed the marker value would store promoted rows the reader no longer
   * recognises. They would open on the withheld cash basis with no smoothed segment, silently undoing
   * the founder's 2026-11-25 ruling. The pair must be the same string in both languages.
   */
  it("reads exactly the two producer assignments, and they equal the typed literals and the TS constants", () => {
    expect(Object.keys(PRODUCER_MARKER).sort()).toEqual(["HEADLINE_BASIS_FLAG", "HEADLINE_BASIS_SMOOTHED"]);
    expect(PRODUCER_MARKER.HEADLINE_BASIS_FLAG).toBe(MARKER_FLAG_LITERAL);
    expect(PRODUCER_MARKER.HEADLINE_BASIS_SMOOTHED).toBe(MARKER_VALUE_LITERAL);
    expect(HEADLINE_BASIS_FLAG).toBe(PRODUCER_MARKER.HEADLINE_BASIS_FLAG);
    expect(HEADLINE_BASIS_SMOOTHED).toBe(PRODUCER_MARKER.HEADLINE_BASIS_SMOOTHED);
  });

  it("neither marker constant is an MTM_REASON_* assignment, so the one-trigger invariant above is untouched", () => {
    expect(Object.keys(PRODUCER_REASONS).some((name) => name.startsWith("HEADLINE_BASIS"))).toBe(false);
    expect(Object.values(PRODUCER_REASONS)).not.toContain(MARKER_VALUE_LITERAL);
  });

  it("anti-vacuity: the parser reads a planted producer and ignores a comment, an f-string and an indented line", () => {
    const planted = [
      'HEADLINE_BASIS_FLAG = "alpha"',
      'HEADLINE_BASIS_SMOOTHED = "beta"  # trailing note',
      '# HEADLINE_BASIS_FLAG = "gamma"',
      'HEADLINE_BASIS_OTHER = "delta"',
      'HEADLINE_BASIS_FLAG_X = f"{x}"',
      '    HEADLINE_BASIS_SMOOTHED = "indented"',
    ].join("\n");
    expect(parseProducerMarker(planted)).toEqual({ HEADLINE_BASIS_FLAG: "alpha", HEADLINE_BASIS_SMOOTHED: "beta" });
  });
});

// ---------------------------------------------------------------------------------------------
// Arm 1 - every pure seam agrees
// ---------------------------------------------------------------------------------------------

describe("options-book census - arm 1: one triggered value through every pure seam", () => {
  const dqf = (reason: unknown) => ({ twr_chain_broken: true, headline_since: "2026-09-01", mtm_gated_reason: reason });
  const GATE = { applicable: true } as const;

  const listRow = (reason: unknown): StrategyAnalytics =>
    ({
      ...EMPTY_ANALYTICS,
      id: "an-1",
      strategy_id: "s-1",
      computed_at: "2026-11-20T10:00:00+00:00",
      computation_status: "complete",
      cumulative_return: 0.42,
      cagr: 0.31,
      sharpe: 1.8,
      series_start: "2025-01-01",
      series_end: "2026-11-19",
      record_observations: 322,
      cumulative_method: "geometric",
      mtm_gated_reason: reason,
    }) as StrategyAnalytics;

  /** A two-year crypto record, long enough that only the withhold can stop a figure. */
  const scalars = (reason: unknown) => ({
    series_start: "2024-01-01",
    series_end: "2026-01-01",
    record_observations: 700,
    mtm_gated_reason: reason,
  });

  const body = (withheldBy: unknown) => ({
    figure_span_days: 700,
    figure_observations: 700,
    figure_crypto: true,
    figure_withheld_by: withheldBy,
  });

  it("the triggered value withholds through the verdict, the list shaper, the record carrier and the constituent parser", () => {
    const trigger = PRODUCER_REASONS.MTM_REASON_OPTIONS;
    expect(headlineVerdict(dqf(trigger), GATE)).toEqual({ kind: "withheld", cause: CAUSE_LITERAL });

    const shaped = shapeRowAnalytics(listRow(trigger), "s-1");
    expect(shaped.headline_withheld_cause).toBe(CAUSE_LITERAL);
    expect(shaped.cagr).toBeNull();

    const record = recordFromScalars(scalars(trigger), "crypto");
    expect(record.withheldBy).toBe(CAUSE_LITERAL);
    expect(gateAnnualized(record)).toBe("withheld");

    expect(gateAnnualized(parseConstituentRecord(body(CAUSE_LITERAL)))).toBe("withheld");
  });

  it.each(OTHER_REASONS)("the same value carrying the producer reason %j does not withhold through any seam", (reason) => {
    expect(headlineVerdict(dqf(reason), GATE)).toEqual({ kind: "dated", since: "2026-09-01" });

    const shaped = shapeRowAnalytics(listRow(reason), "s-1");
    expect(shaped).not.toHaveProperty("headline_withheld_cause");
    expect(shaped.cagr).toBe(0.31);

    const record = recordFromScalars(scalars(reason), "crypto");
    expect(record).not.toHaveProperty("withheldBy");
    expect(gateAnnualized(record)).toBe("full");

    // The constituent parser keys on the CAUSE literal only: neither another producer reason nor
    // the raw trigger string marks a record.
    expect(gateAnnualized(parseConstituentRecord(body(reason)))).toBe("full");
  });

  it("the raw trigger string is not the cause literal: the constituent parser ignores it", () => {
    expect(gateAnnualized(parseConstituentRecord(body(TRIGGER_LITERAL)))).toBe("full");
  });

  it.each([["a case variant", "Unsmoothed_Options_Book"], ["a padded string", " unsmoothed_options_book"], ["null", null], ["a boolean", true]])(
    "an untrusted flag value (%s) withholds through no seam",
    (_label, reason) => {
      expect(headlineVerdict(dqf(reason), GATE).kind).toBe("dated");
      expect(shapeRowAnalytics(listRow(reason), "s-1")).not.toHaveProperty("headline_withheld_cause");
      expect(gateAnnualized(recordFromScalars(scalars(reason), "crypto"))).toBe("full");
    },
  );
});

// ---------------------------------------------------------------------------------------------
// Arm 1b - a PROMOTED row shows the stored (smoothed) figures on every seam
// ---------------------------------------------------------------------------------------------

/**
 * G252-MTM-PROMOTION (plan 10). A promoted composite stores the smoothed figures at top level, the
 * marker `headline_basis`, and no `mtm_gated_reason`. The list shaper, the figure record, the
 * constituent parser, the headline verdict and the OG card are all UNEDITED by plan 10: they read the
 * stored top-level figures and the reason alias, so on a promoted row they must show the figures. Only
 * the factsheet's CASH by-basis object, which `applyHeadlineBasis` is handed, is withheld. This arm
 * makes "every surface agrees" falsifiable instead of assumed.
 *
 * The fail-safe rows pin the other direction: the reason beats the marker, and an untrusted marker is
 * not a promoted row.
 */
describe("options-book census - arm 1b: one promoted row through every seam", () => {
  const GATE = { applicable: true } as const;
  const PROMOTED_FLAGS = { composite: true, [MARKER_FLAG_LITERAL]: MARKER_VALUE_LITERAL } as Record<string, unknown>;
  // Both bases stored: the cash object is the cash-wallet artefact, the top-level scalars are the smoothed ones.
  const CASH_ARTEFACT = {
    cumulative_return: 16361.727,
    volatility: 0.31,
    max_drawdown: -0.4,
    cagr: 5143012681330.363,
    sharpe: 3.4,
    sortino: 4.1,
    calmar: 102.0,
  };
  const SMOOTHED_FIGURES = { cumulative_return: 0.4213, cagr: 0.62, sharpe: 1.9, max_drawdown: -0.11 };

  const listRow = (reason: unknown): StrategyAnalytics =>
    ({
      ...EMPTY_ANALYTICS,
      id: "an-1",
      strategy_id: "s-1",
      computed_at: "2026-11-27T10:00:00+00:00",
      computation_status: "complete",
      ...SMOOTHED_FIGURES,
      series_start: "2025-01-01",
      series_end: "2026-11-26",
      record_observations: 330,
      cumulative_method: "geometric",
      mtm_gated_reason: reason,
    }) as StrategyAnalytics;

  const scalars = (reason: unknown) => ({
    series_start: "2024-01-01",
    series_end: "2026-01-01",
    record_observations: 700,
    mtm_gated_reason: reason,
  });

  const body = (withheldBy: unknown) => ({
    figure_span_days: 700,
    figure_observations: 700,
    figure_crypto: true,
    figure_withheld_by: withheldBy,
  });

  // A short returns series: the card prints the STORED figures, so these rows only have to exist.
  const OG_ROWS = Array.from({ length: 40 }, (_, i) => ({
    date: new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10),
    value: 0.001 + Math.sin(i / 5) * 0.003,
  }));
  const persisted = (flags: Record<string, unknown>) => ({
    computation_status: "complete",
    computed_at: "2026-11-27T10:00:00+00:00",
    data_quality_flags: flags,
    metrics_json_by_basis: { cash_settlement: CASH_ARTEFACT, smoothed_mtm: SMOOTHED_FIGURES },
    sharpe: SMOOTHED_FIGURES.sharpe,
    cagr: SMOOTHED_FIGURES.cagr,
    max_drawdown: SMOOTHED_FIGURES.max_drawdown,
  });

  // One case per seam, so a neuter that reaches a seam fails THAT seam by name.
  it("the predicate reads the promoted row as promoted, and the verdict is clean (not withheld)", () => {
    expect(isSmoothedHeadlineRow(PROMOTED_FLAGS)).toBe(true);
    expect(headlineVerdict(PROMOTED_FLAGS, GATE)).toEqual({ kind: "clean" });
  });

  it("the list shaper shows the stored figures and carries no headline_withheld_cause", () => {
    const shaped = shapeRowAnalytics(listRow(null), "s-1");
    expect(shaped).not.toHaveProperty("headline_withheld_cause");
    expect(shaped.cagr).toBe(SMOOTHED_FIGURES.cagr);
    expect(shaped.cumulative_return).toBe(SMOOTHED_FIGURES.cumulative_return);
  });

  it("the figure record carries no withheldBy and gateAnnualized reads full", () => {
    const record = recordFromScalars(scalars(null), "crypto");
    expect(record).not.toHaveProperty("withheldBy");
    expect(gateAnnualized(record)).toBe("full");
  });

  it("the constituent parser, with no figure_withheld_by, reads full", () => {
    expect(gateAnnualized(parseConstituentRecord(body(undefined)))).toBe("full");
  });

  it("the card prints the stored figures", () => {
    const card = computeOgHeadline(OG_ROWS, "crypto", persisted(PROMOTED_FLAGS));
    expect(card.sharpe).toBe(SMOOTHED_FIGURES.sharpe);
    expect(card.cagr).toBe(SMOOTHED_FIGURES.cagr);
    expect(card.maxDd).toBe(SMOOTHED_FIGURES.max_drawdown);
  });

  it("and only the factsheet's stored CASH object is withheld, under the options cause, with no chain or coverage flag", () => {
    const out = applyHeadlineBasis(CASH_ARTEFACT, PROMOTED_FLAGS, { composite: true });
    expect(out.redacted).toBe(true);
    for (const value of Object.values(out.headline)) expect(value).toBeNull();
    expect(out.quality).toEqual({ headlineWithheld: true, headlineWithheldCause: CAUSE_LITERAL });
    // The stored object the caller holds is untouched: the withhold is a copy.
    expect(CASH_ARTEFACT.cumulative_return).toBe(16361.727);
  });

  it("fail-safe: the marker AND the reason withhold through every seam, and the row is not a promoted row", () => {
    const both = { ...PROMOTED_FLAGS, mtm_gated_reason: TRIGGER_LITERAL };
    expect(isSmoothedHeadlineRow(both)).toBe(false);
    expect(headlineVerdict(both, GATE)).toEqual({ kind: "withheld", cause: CAUSE_LITERAL });

    const shaped = shapeRowAnalytics(listRow(TRIGGER_LITERAL), "s-1");
    expect(shaped.headline_withheld_cause).toBe(CAUSE_LITERAL);
    expect(shaped.cagr).toBeNull();

    const record = recordFromScalars(scalars(TRIGGER_LITERAL), "crypto");
    expect(record.withheldBy).toBe(CAUSE_LITERAL);
    expect(gateAnnualized(record)).toBe("withheld");

    expect(gateAnnualized(parseConstituentRecord(body(CAUSE_LITERAL)))).toBe("withheld");

    const card = computeOgHeadline(OG_ROWS, "crypto", persisted(both));
    expect([card.sharpe, card.cagr, card.maxDd].every((v) => Number.isNaN(v))).toBe(true);

    // The cash object is withheld the same way a wave-1 row withholds it, and carries no promoted shape.
    const out = applyHeadlineBasis(CASH_ARTEFACT, both, { composite: true });
    expect(out.redacted).toBe(true);
    expect(out.quality).toMatchObject({ headlineWithheld: true, headlineWithheldCause: CAUSE_LITERAL });
  });

  it.each([
    ["a case variant", "SMOOTHED_MTM"],
    ["a padded string", " smoothed_mtm"],
    ["a boolean", true],
    ["an array", ["smoothed_mtm"]],
    ["null", null],
  ])("an untrusted marker value (%s) is not a promoted row: nothing is withheld on any seam", (_label, value) => {
    const flags = { composite: true, [MARKER_FLAG_LITERAL]: value } as Record<string, unknown>;
    expect(isSmoothedHeadlineRow(flags)).toBe(false);
    expect(headlineVerdict(flags, GATE)).toEqual({ kind: "clean" });
    const out = applyHeadlineBasis(CASH_ARTEFACT, flags, { composite: true });
    expect(out.redacted).toBe(false);
    expect(out.headline).toBe(CASH_ARTEFACT);
  });

  it("a non-object flags blob is not a promoted row", () => {
    for (const blob of [null, undefined, "smoothed_mtm", 7, [MARKER_VALUE_LITERAL]]) {
      expect(isSmoothedHeadlineRow(blob)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Arm 3 - the literal is compared in one place
// ---------------------------------------------------------------------------------------------

/** Files that may contain the trigger literal in code (comment-stripped), each with why. */
const LITERAL_ALLOWLIST: Record<string, string> = {
  "src/lib/factsheet/headline-basis.ts": "the owner: OPTIONS_CASH_WALLET_REASON and its strict predicate",
  "src/app/factsheet/[id]/v2/FactsheetView.tsx": "the basis toggle stays offered when the gate names the reason",
  "src/app/factsheet/[id]/v2/basis-context.tsx": "the toggle copy switch names the reason it explains",
  "src/lib/factsheet/types.ts": "the mtmGate reason union",
};

function literalHits(repoRoot: string): string[] {
  return walkSrc(repoRoot).filter((rel) => readStripped(repoRoot, rel).includes(TRIGGER_LITERAL));
}

function literalProblems(hits: readonly string[], allowlist: Record<string, string>): string[] {
  const problems: string[] = [];
  for (const rel of hits) {
    if (!(rel in allowlist)) problems.push(`literal: ${rel} contains "${TRIGGER_LITERAL}" in code and is not in the allowlist`);
  }
  for (const rel of Object.keys(allowlist)) {
    if (!hits.includes(rel)) problems.push(`stale: allowlisted ${rel} no longer contains the literal in code`);
  }
  return problems;
}

describe("options-book census - arm 3: the trigger literal is compared nowhere else", () => {
  it("the literal appears in code only in the closed allowlist, and every allowlisted file still has it", () => {
    const problems = literalProblems(literalHits(REPO_ROOT), LITERAL_ALLOWLIST);
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("anti-vacuity: the owner file is walked and holds the literal", () => {
    expect(walkSrc(REPO_ROOT)).toContain("src/lib/factsheet/headline-basis.ts");
    expect(literalHits(REPO_ROOT)).toContain("src/lib/factsheet/headline-basis.ts");
  });

  it("self-test: a planted comparison is flagged and a comment-only mention is not", () => {
    withPlanted(
      {
        "src/lib/rogue.ts": `export const isBook = (r: string) => r === "${TRIGGER_LITERAL}";\n`,
        "src/lib/quiet.ts": `// the reason ${TRIGGER_LITERAL} is judged elsewhere\n/* ${TRIGGER_LITERAL} */\nexport const x = 1;\n`,
        "src/lib/factsheet/headline-basis.ts": `export const R = "${TRIGGER_LITERAL}";\n`,
      },
      (dir) => {
        const hits = literalHits(dir);
        expect(hits).toEqual(["src/lib/factsheet/headline-basis.ts", "src/lib/rogue.ts"]);
        const problems = literalProblems(hits, { "src/lib/factsheet/headline-basis.ts": "owner", "src/lib/gone.ts": "stale" }).join("\n");
        expect(problems).toContain("literal: src/lib/rogue.ts");
        expect(problems).toContain("stale: allowlisted src/lib/gone.ts");
        expect(problems).not.toContain("src/lib/quiet.ts");
      },
    );
  });
});

// ---------------------------------------------------------------------------------------------
// Arm 4 - every strategy_analytics reader calls a seam or carries a checked reason
// ---------------------------------------------------------------------------------------------

/** A read: a `.from("strategy_analytics")` call, or a `strategy_analytics (` / `strategy_analytics(` embed in a string. */
const READ_PATTERN = /\.from\(\s*["']strategy_analytics["']\s*\)|strategy_analytics\s*\(/;

/** The withhold seams. A file calls one of these (not merely imports it), or pairs the record carrier with the reason. */
const SEAM_CALLS = [
  "isOptionsCashWalletReason",
  "isOptionsCashWalletBook",
  "headlineVerdict",
  "applyHeadlineBasis",
  "computeOgHeadline",
  "shapeRowAnalytics",
] as const;
const SEAM_CALL_PATTERN = new RegExp(`\\b(?:${SEAM_CALLS.join("|")})\\s*\\(`);

function isCovered(stripped: string): boolean {
  if (SEAM_CALL_PATTERN.test(stripped)) return true;
  return /\brecordFromScalars\s*\(/.test(stripped) && stripped.includes("mtm_gated_reason");
}

/** A figure a withhold would have to hold back. */
const FIGURE_COLUMNS = [
  "cumulative_return",
  "cagr",
  "sharpe",
  "sortino",
  "volatility",
  "max_drawdown",
  "returns_series",
  "daily_returns",
  "metrics_json",
] as const;
const FIGURE_PATTERN = new RegExp(FIGURE_COLUMNS.join("|"));

/** The modules through which a surface honours the figure rules; a file importing none honours neither the verdict nor D-15. */
const RULING_MODULES = [
  "@/lib/figure-gate",
  "@/lib/record-span-read",
  "@/components/strategy/annualized-cell",
  "@/lib/factsheet/headline-basis",
] as const;

const PLAIN_REASONS: readonly RegExp[] = [
  /^status only$/,
  /^out of scope: admin \(CONTEXT\)$/,
  /^out of scope: wizard \(CONTEXT\)$/,
  /^deferred: blend \(CONTEXT\)$/,
  /^outside the ruling: honours neither the verdict nor D-15$/,
  /^dead: \S.*$/,
];
const UPSTREAM_REASON = /^gated upstream: (\S.*)$/;

const COMPOSITE_READ_PATH = "src/lib/factsheet/composite-read-path.ts";

const EXCLUDED: Record<string, string> = {
  // gated upstream: the factsheet payload is shaped by the composite read path, which calls the verdict.
  "src/app/factsheet/[id]/v2/page.tsx": `gated upstream: ${COMPOSITE_READ_PATH}`,
  "src/lib/factsheet/fetch-and-build-payload.ts": `gated upstream: ${COMPOSITE_READ_PATH}`,
  // Both PDF routes render the factsheet page through puppeteer.
  "src/app/api/factsheet/[id]/pdf/route.ts": `gated upstream: ${COMPOSITE_READ_PATH}`,
  "src/app/api/factsheet/[id]/tearsheet.pdf/route.ts": `gated upstream: ${COMPOSITE_READ_PATH}`,
  // out of scope: admin (CONTEXT Decided at planning: admin approve and the admin lists).
  "src/app/(dashboard)/admin/page.tsx": "out of scope: admin (CONTEXT)",
  "src/app/(dashboard)/admin/compute-jobs/page.tsx": "out of scope: admin (CONTEXT)",
  "src/app/api/admin/strategy-review/route.ts": "out of scope: admin (CONTEXT)",
  "src/lib/admin/match.ts": "out of scope: admin (CONTEXT)",
  "src/lib/intro/snapshot.ts": "out of scope: admin (CONTEXT)", // read by admin intros only
  // out of scope: wizard (CONTEXT Decided at planning: the wizard preview).
  "src/app/api/strategies/csv-finalize/route.ts": "out of scope: wizard (CONTEXT)",
  // status only: these read the compute status or a timestamp and print no figure.
  "src/app/api/keys/sync/route.ts": "status only",
  "src/app/api/strategies/finalize-wizard/route.ts": "status only",
  "src/lib/finalize-rerun.ts": "status only",
  "src/hooks/useStrategySyncPoller.ts": "status only",
  "src/components/strategy/ApiKeyManager.tsx": "status only",
  "src/lib/founder-lp/readiness.ts": "status only",
  // deferred: blend (CONTEXT defers blend-level handling; this page gates only the blend record).
  "src/app/scenario-share/[token]/page.tsx": "deferred: blend (CONTEXT)",
  // outside the ruling: neither the verdict nor D-15 is honoured by this route.
  "src/app/api/bridge/outcome/[id]/curves/route.ts": "outside the ruling: honours neither the verdict nor D-15",
  // dead: nothing imports it at HEAD (checked below).
  "src/lib/record-span-read.ts": "dead: readRecordSpan has no production caller",
};

/** Named files the walk must cover, so a walk that drifts past the code it exists for fails. */
const ANCHORS = [
  "src/lib/queries.ts",
  "src/app/(dashboard)/compare/page.tsx",
  "src/app/api/og/factsheet/[id]/route.tsx",
  "src/app/(dashboard)/strategies/page.tsx",
] as const;

interface ReaderPopulation {
  walked: string[];
  readers: string[];
  covered: Set<string>;
  /** Comment-stripped text of every walked file, for the reason checks. */
  text: Map<string, string>;
}

function analyzeReaders(repoRoot: string): ReaderPopulation {
  const walked = walkSrc(repoRoot);
  const text = new Map<string, string>();
  const readers: string[] = [];
  const covered = new Set<string>();
  for (const rel of walked) {
    const stripped = readStripped(repoRoot, rel);
    text.set(rel, stripped);
    if (isCovered(stripped)) covered.add(rel);
    if (READ_PATTERN.test(stripped)) readers.push(rel);
  }
  return { walked, readers, covered, text };
}

function importsAny(stripped: string, modules: readonly string[]): boolean {
  const re = /(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g;
  for (const m of stripped.matchAll(re)) if (modules.includes(m[1])) return true;
  return false;
}

/** Problems with one EXCLUDED entry's reason, checked against the file the reason is about. */
function reasonProblems(rel: string, reason: string, pop: ReaderPopulation): string[] {
  const stripped = pop.text.get(rel) ?? "";
  const up = UPSTREAM_REASON.exec(reason);
  if (up) {
    const target = up[1];
    if (!pop.walked.includes(target)) return [`upstream: ${rel} is gated upstream by ${target}, which does not exist in the walk`];
    if (!pop.covered.has(target)) return [`upstream: ${rel} is gated upstream by ${target}, which calls no withhold seam`];
    return [];
  }
  if (!PLAIN_REASONS.some((re) => re.test(reason))) return [`reason: ${rel} has "${reason}", which is outside the closed reason set`];
  if (reason === "status only" && FIGURE_PATTERN.test(stripped)) {
    return [`status only: ${rel} names a figure column (${FIGURE_PATTERN.exec(stripped)?.[0]}), so it is not status only`];
  }
  if (reason.startsWith("outside the ruling") && importsAny(stripped, RULING_MODULES)) {
    return [`outside the ruling: ${rel} imports a module that honours the ruling`];
  }
  if (reason.startsWith("dead:")) {
    const spec = `@/${rel.replace(/^src\//, "").replace(/\.tsx?$/, "")}`;
    const importer = pop.walked.find((other) => other !== rel && importsAny(pop.text.get(other) ?? "", [spec]));
    if (importer) return [`dead: ${rel} is imported by ${importer}`];
  }
  return [];
}

/** Every problem with how the reader population is covered by `excluded`. Empty means the census holds. */
function readerProblems(pop: ReaderPopulation, excluded: Record<string, string>): string[] {
  const problems: string[] = [];
  const readers = new Set(pop.readers);
  for (const rel of pop.readers) {
    if (pop.covered.has(rel) || rel in excluded) continue;
    problems.push(`uncovered: ${rel} reads strategy_analytics but calls no withhold seam and is not in EXCLUDED`);
  }
  for (const [rel, reason] of Object.entries(excluded)) {
    if (!pop.walked.includes(rel)) problems.push(`stale: EXCLUDED key ${rel} names a file the walk does not find`);
    else if (!readers.has(rel)) problems.push(`stale: EXCLUDED key ${rel} names a file that does not read strategy_analytics`);
    else if (pop.covered.has(rel)) problems.push(`redundant: EXCLUDED key ${rel} already calls a withhold seam`);
    problems.push(...reasonProblems(rel, reason, pop));
  }
  return problems;
}

describe("options-book census - arm 4: every strategy_analytics reader is covered or excluded with a checked reason", () => {
  const pop = analyzeReaders(REPO_ROOT);

  it("every reader calls a withhold seam, or sits in EXCLUDED under a reason the file still satisfies", () => {
    const problems = readerProblems(pop, EXCLUDED);
    expect(problems, problems.join("\n")).toEqual([]);
    // Printed so a reader (and the SUMMARY) sees the measured split without it being restated in code.
    console.info(
      `options-cash-wallet census: walked=${pop.walked.length} readers=${pop.readers.length} covered=${pop.readers.filter((r) => pop.covered.has(r)).length} excluded=${Object.keys(EXCLUDED).length}`,
    );
  });

  it("anti-vacuity: the walk is non-empty and every anchor is a covered reader", () => {
    expect(pop.walked.length).toBeGreaterThan(0);
    const missing = ANCHORS.filter((a) => !pop.readers.includes(a) || !pop.covered.has(a));
    expect(missing, "the census walked past an anchor it must cover").toEqual([]);
  });

  describe("self-test: the walker can fire (planted files in a temp directory)", () => {
    const NO_EXCLUSIONS: Record<string, string> = {};

    it("flags a planted uncovered reader and does not flag a covered one, a comment-only mention or a non-reader", () => {
      withPlanted(
        {
          "src/app/uncovered.tsx": 'export const q = (s) => s.from("strategy_analytics").select("cagr");\n',
          "src/app/embed.tsx": 'export const q = "*, strategy_analytics (cagr)";\n',
          "src/app/covered.tsx":
            'import { shapeRowAnalytics } from "@/lib/queries";\nexport const q = (s) => s.from("strategy_analytics") && shapeRowAnalytics(null, "x");\n',
          "src/app/scalars.tsx":
            'export const q = (s) => s.from("strategy_analytics") && recordFromScalars({ mtm_gated_reason: 1 }, "crypto");\n',
          "src/app/commented.tsx": '// s.from("strategy_analytics")\n/* strategy_analytics (cagr) */\nexport const x = 1;\n',
          "src/app/import-only.tsx":
            'import { headlineVerdict } from "@/lib/factsheet/headline-basis";\nexport const q = (s) => s.from("strategy_analytics");\n',
          "src/lib/database.types.ts": 'export type T = { strategy_analytics (x: 1) };\n',
          "src/app/other.test.tsx": 'it("x", () => { from("strategy_analytics"); });\n',
        },
        (dir) => {
          const planted = analyzeReaders(dir);
          expect(planted.readers).toEqual([
            "src/app/covered.tsx",
            "src/app/embed.tsx",
            "src/app/import-only.tsx",
            "src/app/scalars.tsx",
            "src/app/uncovered.tsx",
          ]);
          const problems = readerProblems(planted, NO_EXCLUSIONS).join("\n");
          expect(problems).toContain("uncovered: src/app/uncovered.tsx");
          expect(problems).toContain("uncovered: src/app/embed.tsx");
          // An import with no call does not cover a file.
          expect(problems).toContain("uncovered: src/app/import-only.tsx");
          expect(problems).not.toContain("src/app/covered.tsx");
          expect(problems).not.toContain("src/app/scalars.tsx");
          expect(problems).not.toContain("src/app/commented.tsx");
        },
      );
    });

    it("checks each reason against the file: stale, redundant, bad reason, figure-naming status only, importing outside-the-ruling, imported dead, bad upstream", () => {
      withPlanted(
        {
          "src/a.ts": 'export const q = (s) => s.from("strategy_analytics");\n',
          "src/b.ts": 'export const q = (s) => s.from("strategy_analytics").select("sharpe");\n',
          "src/c.ts": 'import { x } from "@/lib/figure-gate";\nexport const q = (s) => s.from("strategy_analytics");\n',
          "src/d.ts": 'export const q = (s) => s.from("strategy_analytics");\n',
          "src/importer.ts": 'import { d } from "@/d";\nexport const y = d;\n',
          "src/e.ts": 'export const q = (s) => s.from("strategy_analytics");\n',
          "src/f.ts": 'export const q = (s) => s.from("strategy_analytics") && headlineVerdict(1, 2);\n',
          "src/g.ts": "export const x = 1;\n",
          "src/up-target.ts": "export const x = 1;\n",
        },
        (dir) => {
          const planted = analyzeReaders(dir);
          const problems = readerProblems(planted, {
            "src/missing.ts": "status only",
            "src/a.ts": "because I said so",
            "src/b.ts": "status only",
            "src/c.ts": "outside the ruling: honours neither the verdict nor D-15",
            "src/d.ts": "dead: nothing calls it",
            "src/e.ts": "gated upstream: src/up-target.ts",
            "src/f.ts": "status only",
            "src/g.ts": "status only",
          }).join("\n");
          expect(problems).toContain("stale: EXCLUDED key src/missing.ts names a file the walk does not find");
          expect(problems).toContain('reason: src/a.ts has "because I said so"');
          expect(problems).toContain("status only: src/b.ts names a figure column (sharpe)");
          expect(problems).toContain("outside the ruling: src/c.ts imports a module that honours the ruling");
          expect(problems).toContain("dead: src/d.ts is imported by src/importer.ts");
          expect(problems).toContain("upstream: src/e.ts is gated upstream by src/up-target.ts, which calls no withhold seam");
          expect(problems).toContain("redundant: EXCLUDED key src/f.ts already calls a withhold seam");
          expect(problems).toContain("stale: EXCLUDED key src/g.ts names a file that does not read strategy_analytics");
        },
      );
    });

    it("accepts a gated-upstream pointer at a covered file", () => {
      withPlanted(
        {
          "src/child.ts": 'export const q = (s) => s.from("strategy_analytics");\n',
          "src/parent.ts": "export const v = (d) => headlineVerdict(d, { applicable: true });\n",
        },
        (dir) => {
          const planted = analyzeReaders(dir);
          expect(readerProblems(planted, { "src/child.ts": "gated upstream: src/parent.ts" })).toEqual([]);
        },
      );
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Planted temp-directory helper (self-tests only)
// ---------------------------------------------------------------------------------------------

function withPlanted(files: Record<string, string>, run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "options-census-selftest-"));
  try {
    for (const [rel, body] of Object.entries(files)) {
      const abs = join(dir, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, body);
    }
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
