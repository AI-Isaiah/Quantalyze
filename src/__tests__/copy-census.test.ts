// @vitest-environment node
/**
 * Phase 201 plan 25, made permanent by plan 201-23 (D-08, D-03, D-11, D-19, D-21) - the copy
 * census over `src/`.
 *
 * THE PROPERTY. Phase 201 retires words (rule A), says every registered term through `Term`
 * (rule B) and prints every date through one helper (rule C). A hit of any rule is a failing test
 * unless it is a reasoned row of `EXCEPTIONS` in `scripts/copy-census/policy.ts`. There is no
 * pending mechanism and no per-plan ledger: the ledgers that let sixteen surface plans run in
 * parallel were folded into `EXCEPTIONS` by plan 201-23 and deleted.
 *
 * WHAT KEEPS THE EXCEPTION LIST HONEST (T-201-30). Each row consumes exactly one live hit with the
 * same rule, file and text, so one row cannot cover two occurrences. A row that matches no live
 * hit is STALE and fails. Every reason must belong to the closed set in `policy.ts` and be longer
 * than 20 characters. The list is count-pinned and typed again below, in both directions, so a
 * row added or dropped in `policy.ts` alone fails here and the change is a reviewed decision.
 *
 * ORACLE INDEPENDENCE. The scanner (`scripts/copy-census/scan.ts`) imports nothing from the app
 * and rule A's words are typed in `policy.ts`, so a rename in the code cannot make the census
 * pass against itself. Rule B alone reads `GLOSSARY`, by design (the registry is the one source
 * of what a registered term is called). This file only counts what `scanTree` returns and
 * compares it with the exception list.
 *
 * HOW A FILE IS READ. `scanTree` parses every non-test `.ts` and `.tsx` file under `src/` into
 * a TypeScript AST and reads JSX text, user-visible attributes, prose strings and template
 * parts; comments are never nodes, so a docblock that quotes a retired word is not a hit. One
 * hit per node per rule. What each rule matches, and what it skips, is the header of `scan.ts`.
 *
 * ANTI-VACUITY. A census that reads "no hits" because the scanner matches nothing must not pass.
 * `judge` is exercised on planted hits (an unregistered hit, a stale exception, an exception that
 * consumes one hit and no more), and each failure message names the file and the rule. Named
 * anchor files must be in the walked population and inside every rule's scope, the walk must
 * cover a floor of files, and a planted tree proves each rule fires through `scanTree` and the
 * judge. There is no floor on live hits: the census asserts zero, so a floor would turn it red
 * for finishing the job. At zero, the planted trees are the proof the scanner can fire.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { listScannedFiles, scanSource, scanTree, type CensusHit, type CensusRule } from "../../scripts/copy-census/scan";
import { EXCEPTIONS, EXCLUDED_FILES, POLICY, isValidReason, type ExceptionRow } from "../../scripts/copy-census/policy";

const REPO_ROOT = process.cwd();
const RULES: readonly CensusRule[] = ["A", "B", "C"];

/** The merged exception count the census pins: the 4 policy rows, the 31 folded from the ledgers, and 1 rule C row from plan 201-40. */
const PINNED_EXCEPTION_COUNT = 36;

const norm = (s: string): string => s.replace(/\s+/g, " ").trim();

/**
 * The census verdict: every problem, as a sentence that names the file and the rule. An exception
 * row consumes exactly one hit (a multiset), so one row cannot cover two occurrences. Whatever
 * hit is left over is unregistered; whatever row matched nothing is stale.
 */
function judge(hits: readonly CensusHit[], exceptions: readonly ExceptionRow[]): string[] {
  const problems: string[] = [];
  const left = [...hits];
  for (const row of exceptions) {
    const i = left.findIndex((h) => h.rule === row.rule && h.file === row.file && norm(h.text) === norm(row.literal));
    if (i < 0) problems.push(`stale: exception rule ${row.rule} ${row.file} "${row.literal}" matches no live hit`);
    else left.splice(i, 1);
  }
  for (const h of left) {
    problems.push(`unregistered: ${h.file}:${h.line} rule ${h.rule}: "${norm(h.text)}" is not a reasoned exception in policy EXCEPTIONS`);
  }
  return problems;
}

/** Reason problems. Pure over the exception and excluded-file lists. */
function judgeStructure(
  exceptions: readonly ExceptionRow[],
  excluded: readonly { reason: string }[] = EXCLUDED_FILES,
): string[] {
  const problems: string[] = [];
  for (const row of exceptions) {
    if (!isValidReason(row.reason)) {
      problems.push(`reason: exception for ${row.file} "${row.literal}" has a reason outside the closed set or 20 characters or shorter: "${row.reason}"`);
    }
  }
  for (const e of excluded) {
    if (!isValidReason(e.reason)) problems.push(`reason: an EXCLUDED_FILES row has a reason outside the closed set: "${e.reason}"`);
  }
  return problems;
}

const hit = (rule: CensusRule, file: string, text = "x"): CensusHit => ({ rule, id: "id", file, line: 1, kind: "k", text });
const exception = (rule: CensusRule, file: string, literal: string): ExceptionRow => ({
  rule,
  file,
  literal,
  reason: "plain English, not the mandate concept: planted for the judge self-test",
});

describe("copy census (201 plan 23): the live tree against the exception list", () => {
  let hits: CensusHit[] = [];
  let walked: string[] = [];

  beforeAll(() => {
    // One walk for the whole file: parsing every source under src/ is the slow step.
    walked = listScannedFiles(REPO_ROOT);
    hits = scanTree(REPO_ROOT, POLICY);
  }, 120_000);

  it("finds no hit that is not a reasoned exception, and no exception without a live hit", () => {
    const count = (r: CensusRule) => hits.filter((h) => h.rule === r).length;
    console.info(
      `copy-census: walked=${walked.length} A=${count("A")} B=${count("B")} C=${count("C")} exceptions=${EXCEPTIONS.length}`,
    );
    expect(judge(hits, EXCEPTIONS)).toEqual([]);
  });

  describe("self-test: the judge can fail (planted hits)", () => {
    it("is quiet when every hit is a reasoned exception", () => {
      const hs = [hit("A", "src/a.tsx", "PORTFOLIO"), hit("B", "src/a.tsx", "Sharpe")];
      expect(judge(hs, [exception("A", "src/a.tsx", "PORTFOLIO"), exception("B", "src/a.tsx", "Sharpe")])).toEqual([]);
    });

    it("flags a hit that is not an exception, naming the file and the rule", () => {
      expect(judge([hit("A", "src/new.tsx", "Saved portfolios")], [])).toEqual([
        'unregistered: src/new.tsx:1 rule A: "Saved portfolios" is not a reasoned exception in policy EXCEPTIONS',
      ]);
    });

    it("lets an exception consume exactly one hit, and no more", () => {
      const row = exception("A", "src/a.tsx", "— No preference —");
      const two = [hit("A", "src/a.tsx", "— No preference —"), hit("A", "src/a.tsx", "— No preference —")];
      expect(judge(two, [row, row])).toEqual([]);
      expect(judge(two, [row])).toEqual([
        'unregistered: src/a.tsx:1 rule A: "— No preference —" is not a reasoned exception in policy EXCEPTIONS',
      ]);
    });

    it("flags an exception that matches no live hit as stale", () => {
      const row = exception("A", "src/a.tsx", "— No preference —");
      expect(judge([], [row])).toEqual([`stale: exception rule A src/a.tsx "— No preference —" matches no live hit`]);
    });

    it("matches an exception by rule, file and text together", () => {
      const row = exception("A", "src/a.tsx", "PORTFOLIO");
      expect(judge([hit("B", "src/a.tsx", "PORTFOLIO")], [row])).toHaveLength(2);
      expect(judge([hit("A", "src/b.tsx", "PORTFOLIO")], [row])).toHaveLength(2);
      expect(judge([hit("A", "src/a.tsx", "PORTFOLIOS")], [row])).toHaveLength(2);
    });
  });

  describe("the exception list and the excluded files, structure", () => {
    it("gives every exception and excluded file a reason from the closed set", () => {
      expect(judgeStructure(EXCEPTIONS)).toEqual([]);
    });

    // The policy lists are typed again here, so a row added or dropped in policy.ts alone fails.
    const TYPED_EXCEPTIONS: readonly Pick<ExceptionRow, "rule" | "file" | "literal">[] = [
      // Plan 201-06 and 201-33 policy rows. The glossary row is F-04, F-08: the one place the
      // retired word Bridge may appear, so a returning user can match the two names.
      { rule: "A", file: "src/components/strategy/RequestIntroButton.tsx", literal: "— No preference —" },
      { rule: "A", file: "src/components/strategy/RequestIntroButton.tsx", literal: "— No preference —" },
      { rule: "A", file: "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx", literal: "PORTFOLIO" },
      { rule: "A", file: "src/lib/glossary.ts", literal: "Scenario models changes to your allocation before you make them and shows ranked replacements for holdings outside your mandate. It was formerly called Bridge." },
      { rule: "B", file: "src/app/factsheet/[id]/v2/FactsheetView.tsx", literal: "Returns Signatures" },
      { rule: "B", file: "src/components/portfolio/ReplacementCard.tsx", literal: "Sharpe" },
      { rule: "B", file: "src/components/portfolio/ReplacementCard.tsx", literal: "MaxDD" },
      { rule: "B", file: "src/app/(dashboard)/allocations/widgets/risk/CorrelationMatrix.tsx", literal: "Correlation matrix" },
      { rule: "B", file: "src/app/(dashboard)/allocations/lib/mandate-gates.ts", literal: "Max DD floor" },
      { rule: "B", file: "src/components/strategy/CustomizeDrawer.tsx", literal: "Sharpe" },
      { rule: "B", file: "src/components/strategy/CustomizeDrawer.tsx", literal: "CAGR" },
      { rule: "B", file: "src/components/strategy/CustomizeDrawer.tsx", literal: "Max Drawdown" },
      { rule: "B", file: "src/components/strategy/CustomizeDrawer.tsx", literal: "Volatility" },
      { rule: "B", file: "src/components/strategy/CustomizeDrawer.tsx", literal: "AUM" },
      { rule: "B", file: "src/components/strategy/StrategyFilters.tsx", literal: "CAGR" },
      { rule: "B", file: "src/components/strategy/StrategyFilters.tsx", literal: "Sharpe" },
      { rule: "B", file: "src/components/strategy/StrategyFilters.tsx", literal: "Max DD" },
      { rule: "B", file: "src/components/strategy/StrategyFilters.tsx", literal: "Volatility" },
      { rule: "B", file: "src/components/strategy/StrategyGrid.tsx", literal: "AUM" },
      { rule: "B", file: "src/components/strategy/StrategyTable.tsx", literal: "AUM" },
      { rule: "B", file: "src/components/strategy/StrategyTable.tsx", literal: "CAGR" },
      { rule: "B", file: "src/components/strategy/StrategyTable.tsx", literal: "Max DD" },
      { rule: "B", file: "src/components/strategy/StrategyTable.tsx", literal: "Volatility" },
      { rule: "B", file: "src/components/strategy/StrategyTable.tsx", literal: "Sharpe" },
      { rule: "B", file: "src/components/strategy/StrategyTable.tsx", literal: "Calmar" },
      { rule: "B", file: "src/components/mandate/MandateSaveStatus.tsx", literal: "Mandate saved" },
      { rule: "A", file: "src/lib/wizardErrors.ts", literal: "TypeScript for a missing Supabase session (portfolio-optimizer," },
      { rule: "A", file: "src/lib/wizardErrors.ts", literal: "from `_compute_portfolio_analytics` in portfolio.py when the analytics" },
      { rule: "A", file: "src/lib/wizardErrors.ts", literal: "Detail: 'Portfolio analytics computation failed', 500, the outer catch of" },
      { rule: "A", file: "src/lib/wizardErrors.ts", literal: "Detail: 'Portfolio impact simulation failed', 500, from" },
      { rule: "A", file: "src/lib/wizardErrors.ts", literal: "That surface is the portfolio impact panel, which has no key, no draft" },
      { rule: "A", file: "src/lib/notes/ownership.ts", literal: "portfolio not owned" },
      { rule: "A", file: "src/lib/portfolio-exposure.ts", literal: "portfolio-exposure: api_keys identity read reached the row cap (" },
      { rule: "A", file: "src/lib/queries.ts", literal: "getAllocatorAggregates portfolios failed:" },
      { rule: "B", file: "src/app/(dashboard)/allocations/components/ScenarioCompareTable.tsx", literal: "Scenario comparison" },
      // Plan 201-40: the raw date field review R3-01 excluded (an unmounted component). The two MasterBrush rows are gone (GC-03): that readout now prints through formatDay.
      { rule: "C", file: "src/components/strategy/StrategyHeader.tsx", literal: "{strategy.start_date}" },
    ];
    const TYPED_EXCLUDED: readonly { rule: CensusRule; file: string }[] = [
      { rule: "A", file: "src/lib/seam-retry-registry.ts" },
      { rule: "A", file: "src/lib/routing/route-contract-manifest.ts" },
      { rule: "A", file: "src/lib/resilient-fetch.ts" },
    ];

    it("pins the exception count at the merged total", () => {
      expect(EXCEPTIONS).toHaveLength(PINNED_EXCEPTION_COUNT);
      expect(TYPED_EXCEPTIONS).toHaveLength(PINNED_EXCEPTION_COUNT);
    });

    it("pins the EXCEPTIONS list at its typed rows, in both directions", () => {
      const key = (r: Pick<ExceptionRow, "rule" | "file" | "literal">) => `${r.rule}|${r.file}|${r.literal}`;
      expect(EXCEPTIONS.map(key).sort()).toEqual(TYPED_EXCEPTIONS.map(key).sort());
      for (const typed of TYPED_EXCEPTIONS) expect(EXCEPTIONS.map(key)).toContain(key(typed));
    });

    // T-201-45: the former-name reason shape is founder-scoped to F-04, so it must not become a
    // general escape hatch for a retired word. Exactly one row in EXCEPTIONS (the ledgers are gone).
    it("lets exactly one row use the former-name reason shape, and it is the glossary row (F-04)", () => {
      const rows = EXCEPTIONS.filter((r) => r.reason.startsWith("former name (F-04): "));
      expect(rows.map((r) => `${r.rule}|${r.file}`)).toEqual(["A|src/lib/glossary.ts"]);
    });

    it("pins the EXCLUDED_FILES list at its typed rows, in both directions", () => {
      expect(EXCLUDED_FILES).toHaveLength(TYPED_EXCLUDED.length);
      const key = (r: { rule: CensusRule; file: string }) => `${r.rule}|${r.file}`;
      expect(EXCLUDED_FILES.map(key).sort()).toEqual(TYPED_EXCLUDED.map(key).sort());
      for (const typed of TYPED_EXCLUDED) expect(EXCLUDED_FILES.map(key)).toContain(key(typed));
    });

    it("keeps every excluded file needed: it exists and the rule it is excluded from still reports a hit there", () => {
      for (const row of EXCLUDED_FILES) {
        const source = readFileSync(join(REPO_ROOT, row.file), "utf8");
        const everything = { ...POLICY, applies: (rule: CensusRule) => rule === row.rule };
        const found = scanSource(row.file, source, everything).filter((h) => h.rule === row.rule);
        expect(found.length, `${row.file} is excluded from rule ${row.rule} but has no hit: delete the row`).toBeGreaterThan(0);
        expect(POLICY.applies(row.rule, row.file)).toBe(false);
      }
    });
  });

  describe("anti-vacuity: the scanner is reading the tree", () => {
    // Wave-3 measurement: walked=750. The floor is half, so a walker that silently drops a
    // directory fails, and a normal week of file moves does not.
    const WALKED_FLOOR = 375;
    const ANCHORS = [
      "src/components/layout/Sidebar.tsx",
      "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx",
      "src/app/(dashboard)/allocations/components/GlancePanel.tsx",
      "src/app/factsheet/[id]/v2/MetricsColumn.tsx",
    ] as const;

    it("walks at least the floor of source files", () => {
      expect(walked.length).toBeGreaterThanOrEqual(WALKED_FLOOR);
    });

    it("walks every anchor file, and every rule covers it", () => {
      const missing = ANCHORS.filter((a) => !walked.includes(a));
      expect(missing, `anchors the walker does not find: ${missing.join(", ")}`).toEqual([]);
      for (const anchor of ANCHORS) {
        for (const rule of RULES) {
          expect(POLICY.applies(rule, anchor), `rule ${rule} must cover ${anchor}`).toBe(true);
        }
      }
    });
  });

  describe("self-test: structure rules can fail (planted rows)", () => {
    const row = (reason: string): ExceptionRow => ({ rule: "A", file: "src/lib/degrade-warnings.ts", literal: "x", reason });
    const GOOD = "plain English, not the mandate concept: planted for the structure self-test";

    it("is quiet for a reason from the closed set", () => {
      expect(judgeStructure([row(GOOD)], [])).toEqual([]);
    });

    it("flags a reason outside the closed set, and one that is 20 characters or shorter", () => {
      const freeText = judgeStructure([row("it is fine, honest, trust me")], []);
      expect(freeText).toHaveLength(1);
      expect(freeText[0]).toMatch(/^reason: exception for src\/lib\/degrade-warnings\.ts/);
      expect(judgeStructure([row("verb use: x")], [])).toHaveLength(1);
    });

    it("flags a bad reason on an excluded-file row", () => {
      expect(judgeStructure([], [{ reason: "because" }])).toHaveLength(1);
    });
  });

  describe("self-test: each rule fires through scanTree and the judge (planted tree)", () => {
    function withPlanted(files: Record<string, string>, run: (dir: string) => void): void {
      const dir = mkdtempSync(join(tmpdir(), "copy-census-judge-"));
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

    const PLANTED = {
      A: { file: "src/components/layout/PlantedA.tsx", body: "export const C = () => <h2>Saved portfolios</h2>;\n" },
      B: { file: "src/components/layout/PlantedB.tsx", body: "export const C = () => <span>Sharpe</span>;\n" },
      C: { file: "src/components/layout/PlantedC.tsx", body: "export const f = (d: Date) => d.toLocaleDateString();\n" },
    } satisfies Record<CensusRule, { file: string; body: string }>;

    for (const rule of RULES) {
      it(`rule ${rule}: a planted offender is a live hit, unregistered until an exception names it`, () => {
        const { file, body } = PLANTED[rule];
        withPlanted({ [file]: body }, (dir) => {
          const found = scanTree(dir, POLICY).filter((h) => h.rule === rule);
          expect(found).toHaveLength(1);
          const problems = judge(found, []);
          expect(problems).toHaveLength(1);
          expect(problems[0]).toContain(`unregistered: ${file}`);
          expect(problems[0]).toContain(`rule ${rule}`);
          expect(judge(found, [exception(rule, file, found[0].text)])).toEqual([]);
        });
      });
    }

    it("a registered term wrapped in Term is not a hit, so rule B can also stay quiet", () => {
      withPlanted(
        { "src/components/layout/Wrapped.tsx": 'export const C = () => <Term k="sharpe"><span>Sharpe</span></Term>;\n' },
        (dir) => {
          expect(scanTree(dir, POLICY).filter((h) => h.rule === "B")).toEqual([]);
        },
      );
    });
  });
});
