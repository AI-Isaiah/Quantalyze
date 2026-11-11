import { describe, it, expect } from "vitest";
import {
  GLOSSARY,
  termDefinition,
  termLabel,
  type GlossaryEntry,
  type TermKey,
} from "./glossary";

/**
 * Phase 201 plan 01 (D-01, D-02, D-03): invariants of the term registry.
 *
 * Each arm encodes WHY the invariant exists, so a change to the registry that breaks
 * the reason fails here, not only a change that breaks a number:
 *   - the key set is pinned (D-02): a term added or dropped is a decision, not drift,
 *     and the coverage census (plan 201-06) enforces every key on the covered surfaces;
 *   - 200 characters and one or two sentences (U-05): the bubble is 224px wide, so
 *     longer copy runs past about seven lines and is clipped by the viewport;
 *   - discovery contexts keep the words the discovery header read before the move (UI-SPEC
 *     rule 6), but that oracle is NOT in this file: it is the hand-typed literals in
 *     `src/components/strategy/discovery-columns.tooltips.test.ts` (D-01, plan 201-23);
 *   - no retired word (D-04 to D-06): the registry must not reintroduce a word the
 *     phase retires from every other surface;
 *   - "Bridge" is retired too (F-04, F-08, U-30), with exactly one admitted mention: the
 *     `scenario` definition tells a returning user what Scenario used to be called. The
 *     census (`scripts/copy-census/policy.ts`) pins the same single exception, so a second
 *     mention here fails by name rather than passing quietly;
 *   - no two keys share a label or alias: a coverage census matching printed text must
 *     resolve each string to exactly one key.
 */

const INVENTORY_KEYS = [
  "omega", "profit_factor", "ulcer_index", "pain_index", "tail_ratio",
  "common_sense_ratio", "recovery_factor", "avg_win_loss", "kolmogorov_smirnov",
  "sharpe", "sortino", "calmar", "cagr", "max_drawdown", "dd_duration",
  "volatility", "skew", "kurtosis", "var_95", "cvar_95", "percentile",
  "bootstrap_ci", "correlation", "avg_abs_correlation", "alpha", "beta",
  "r_squared", "information_ratio", "treynor", "tracking_error", "up_capture",
  "down_capture", "twr", "returns_signature", "volatility_matched", "scenario",
  "mandate", "sharpe_lift", "corr_with_allocation", "dd_improve",
] as const satisfies readonly TermKey[];

const DISCOVERY_ONLY_KEYS = [
  "track", "return_full", "return_6m", "aum", "return_curve", "underwater",
] as const satisfies readonly TermKey[];

const entries = Object.entries(GLOSSARY) as [TermKey, GlossaryEntry][];

/** Every definition and context string, tagged for a readable failure. */
const allStrings: { where: string; text: string }[] = entries.flatMap(
  ([key, e]) => [
    { where: `${key} (generic)`, text: e.definition },
    ...Object.entries(e.contexts ?? {}).map(([ctx, text]) => ({
      where: `${key} (${ctx})`,
      text: text as string,
    })),
  ],
);

describe("glossary tracer: omega", () => {
  it("registers omega with its printed label and the theta alias", () => {
    expect(GLOSSARY.omega.label).toBe("Omega");
    expect(GLOSSARY.omega.aliases).toContain("Omega (θ=0)");
  });

  it("termDefinition returns the UI-SPEC definition, at most 200 characters", () => {
    const def = termDefinition("omega");
    expect(def).toBe(
      "Sum of daily gains divided by the absolute sum of daily losses, with 0% as the threshold (θ=0). At this threshold it equals the profit factor.",
    );
    expect(def.length).toBeLessThanOrEqual(200);
  });

  it("termLabel returns the printed label", () => {
    expect(termLabel("omega")).toBe("Omega");
  });
});

describe("glossary registry invariants", () => {
  it("holds exactly 46 keys: the 40 inventory keys plus the 6 discovery-only keys (D-02)", () => {
    expect(Object.keys(GLOSSARY)).toHaveLength(46);
    expect(Object.keys(GLOSSARY).sort()).toEqual(
      [...INVENTORY_KEYS, ...DISCOVERY_ONLY_KEYS].sort(),
    );
  });

  it("every definition and context is at most 200 characters (U-05, the 224px bubble)", () => {
    const tooLong = allStrings.filter((s) => s.text.length > 200);
    expect(tooLong.map((s) => `${s.where}: ${s.text.length}`)).toEqual([]);
  });

  it("every definition and context is one or two sentences, with no exclamation mark, sentence case", () => {
    const bad: string[] = [];
    for (const { where, text } of allStrings) {
      // A sentence-final period is a period followed by whitespace or the end, so
      // "0.05" and "1.00," do not count.
      const sentences = text.match(/\.(?=\s|$)/g)?.length ?? 0;
      if (sentences < 1 || sentences > 2) bad.push(`${where}: ${sentences} sentences`);
      if (text.includes("!")) bad.push(`${where}: exclamation mark`);
      const first = text[0];
      if (first !== first.toUpperCase() || first === first.toLowerCase()) {
        bad.push(`${where}: first character not an upper-case letter`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("no two keys share a label or an alias (case-sensitive)", () => {
    const seen = new Map<string, TermKey>();
    const clashes: string[] = [];
    for (const [key, e] of entries) {
      for (const printed of [e.label, ...(e.aliases ?? [])]) {
        const prior = seen.get(printed);
        if (prior !== undefined && prior !== key) {
          clashes.push(`"${printed}": ${prior} and ${key}`);
        }
        seen.set(printed, key);
      }
    }
    expect(clashes).toEqual([]);
  });

  it("no definition or context carries a retired word (D-04 to D-06)", () => {
    const retired = /\b(portfolio|book|favorites|starred|preference)\b/i;
    const hits = allStrings.filter((s) => retired.test(s.text));
    expect(hits.map((s) => s.where)).toEqual([]);
  });

  it("\"Bridge\" appears exactly once across every label, alias, definition and context: the scenario definition (F-04, U-30)", () => {
    const printed: { where: string; text: string }[] = [
      ...entries.flatMap(([key, e]) => [
        { where: `${key} (label)`, text: e.label },
        ...(e.aliases ?? []).map((alias) => ({ where: `${key} (alias)`, text: alias })),
      ]),
      ...allStrings,
    ];
    const hits = printed
      .map(({ where, text }) => ({ where, count: text.match(/\bBridge\b/g)?.length ?? 0 }))
      .filter((h) => h.count > 0);
    expect(hits).toEqual([{ where: "scenario (generic)", count: 1 }]);
  });

  it("the registry has no bridge key: Scenario replaced it (F-04)", () => {
    expect("bridge" in GLOSSARY).toBe(false);
  });

  it("scenario is labelled Scenario with no alias, and names its former name once (F-04, F-08)", () => {
    expect(GLOSSARY.scenario.label).toBe("Scenario");
    expect((GLOSSARY.scenario as GlossaryEntry).aliases).toBeUndefined();
    expect(termDefinition("scenario")).toBe(
      "Scenario models changes to your allocation before you make them and shows ranked replacements for holdings outside your mandate. It was formerly called Bridge.",
    );
  });

  it("mandate's definition names Scenario as a reader (F-04)", () => {
    expect(termDefinition("mandate")).toBe(
      "The criteria you set for what you hold: preferred strategy types, excluded exchanges, the largest weight one strategy may take and the worst drawdown you accept. Recommendations and Scenario read it.",
    );
  });

  it("omega and profit factor do not contradict: omega's definition names the profit factor (UI-SPEC rule 4)", () => {
    expect(termDefinition("omega")).toMatch(/profit factor/i);
  });

  it("max_drawdown has the 12-month context for the My allocation KPI strip", () => {
    expect(termDefinition("max_drawdown", "last12m")).toBe(
      "The largest fall from a peak to a later low in the last 12 months, in percent.",
    );
  });

  it("a context a key does not carry falls back to the generic definition", () => {
    expect(termDefinition("omega", "discovery")).toBe(termDefinition("omega"));
  });
});

// The discovery-context parity arm that stood here compared `termDefinition(..., "discovery")`
// with `DISCOVERY_COLUMNS[*].tooltip`. Once the columns began reading the registry that was a
// value asserted against itself, and it could not fail when a registry word changed. The oracle
// is `src/components/strategy/discovery-columns.tooltips.test.ts`, whose expected strings are
// typed by hand (D-01), including the full-record basis clause (D-01, plan 201-23).
