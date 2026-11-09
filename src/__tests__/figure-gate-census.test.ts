/**
 * Phase 194.1 plans 01 and 13 - the every-page census for annualised figures.
 *
 * THE PROPERTY. 194 D-04 ("every page"), D-10 (the split) and D-12 (admin) say an annualised
 * figure shows only for a record that clears the short-track gate (src/lib/figure-gate.ts).
 * Until this file that rule was a document. Now it is a failing test: a file under `src/app`
 * or `src/components` that names an annualised figure must import a gate module, or sit in
 * `EXCLUDED` under a reason from a closed set. A NEW file that prints one ungated cannot ship.
 *
 * ORACLE INDEPENDENCE. The pattern, the gate-module list, the reason set and the map are
 * typed here. Nothing is imported from a page or from figure-gate, so a drift in a constant
 * fails here instead of passing against itself. `@/lib/figure-record-scalars` is NOT a gate
 * module: it builds a record and decides nothing.
 *
 * HOW A FILE IS READ. Comments are stripped (`stripCommentsPreserveLines`) before the
 * pattern and the import check run, so a docblock that quotes "Sharpe" neither matches nor
 * satisfies a gate. String contents survive, so a column label "Sharpe" does match; that is
 * why `label only` exists as a reason.
 *
 * THE MAP. `EXCLUDED` is a matched, ungated file with the reason it needs no gate. Closed set:
 * `label only`, `static copy`, `no render`, `dead: <why>`, `orphaned: <id>`,
 * `gated upstream: <repo-relative path>`, and the 196 redirect below.
 *
 * NO PENDING MAP (194.1 close, plan 13). A pending-plan map (plan 01) existed only while the site
 * plans landed, naming the plan that would gate each live site. Every site plan has run, so
 * the map and every branch that consulted it are gone, and a `gated upstream:` target must now
 * itself import a gate module.
 *
 * THE RULE FOR LIVE 194.1 SITES. A live 194.1 site is gated by its OWN import of a gate
 * module, never by a `gated upstream:` entry, and a missed gate is never excluded to make the
 * census pass. The 194.1-touched files that stay in `EXCLUDED` are `no render`: their figures
 * render in a gated site file (asserted: none of them carries a `gated upstream:` reason).
 *
 * THE 196 REDIRECT. `src/app/strategy/[id]/page.tsx` and the v2-only panels are mapped to
 * `redirected by 196 D-03 (founder 2026-11-08)`: 196 replaces them, so 194.1 does not gate
 * them. When 196's merge deletes one of these files its entry turns stale BY NAME here, and
 * the fix is deleting that entry in whichever of the two PRs merges second.
 *
 * ANTI-VACUITY. Named anchor files must be in the walked and matched population; every map
 * key must name a file the walk finds and the pattern matches (a stale entry fails); every
 * `gated upstream:` target must exist and import a gate module; and a
 * planted self-test over a temp directory proves an ungated file is flagged and a
 * comment-only mention is not.
 */
import { describe, it, expect } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { stripCommentsPreserveLines } from "@/lib/source-scan";

const REPO_ROOT = process.cwd();
const ROOTS = ["src/app", "src/components"] as const;

/** An annualised figure named in code or in a string (comment-stripped, case-insensitive). */
const FIGURE_PATTERN =
  /cagr|sharpe|sortino|calmar|volatility|annuali[sz]ed|treynor|information.ratio|tracking.error/i;

/** The modules that decide a figure's state. A file importing one of these is gated. */
const GATE_MODULES = [
  "@/lib/figure-gate",
  "@/lib/record-span-read",
  "@/components/strategy/annualized-cell",
  "./annualized-cell",
] as const;

const REDIRECTED = "redirected by 196 D-03 (founder 2026-11-08)";

/** Reasons outside `gated upstream:` (which carries a path and is checked separately). */
const PLAIN_REASONS: readonly RegExp[] = [
  /^label only$/,
  /^static copy$/,
  /^no render$/,
  /^dead: \S.*$/,
  /^orphaned: \S.*$/,
  /^redirected by 196 D-03 \(founder 2026-11-08\)$/,
];
const UPSTREAM_REASON = /^gated upstream: (\S.*)$/;

const EXCLUDED: Record<string, string> = {
  // no render: transport, types or compute; the figure renders in a gated file.
  "src/app/(dashboard)/admin/page.tsx": "no render",
  "src/app/(dashboard)/allocations/components/ScenarioComparePanel.tsx": "no render",
  "src/components/admin/AllocatorMatchQueue.tsx": "no render",
  "src/app/scenario-share/[token]/share-resolve.ts": "no render",
  "src/app/(dashboard)/allocations/lib/holdings-adapter.ts": "no render",
  "src/app/(dashboard)/allocations/lib/mandate-gates.ts": "no render",
  "src/app/(dashboard)/allocations/lib/scenario-adapter.ts": "no render",
  "src/app/(dashboard)/allocations/lib/scenario-benchmark.ts": "no render",
  "src/app/(dashboard)/allocations/lib/scenario-compare.ts": "no render",
  "src/app/(dashboard)/compare/lib/holding-compare-adapter.ts": "no render",
  "src/app/api/scenario/optimize/route.ts": "no render",
  "src/app/api/scenario/peer-rank/route.ts": "no render",
  "src/app/api/strategies/[id]/returns/route.ts": "no render",
  "src/app/api/strategies/csv-finalize/route.ts": "no render",
  "src/app/factsheet/[id]/v2/basis-context.tsx": "no render",
  "src/app/factsheet/[id]/v2/chart-configs.ts": "no render",
  // dead: nothing imports it at HEAD.
  "src/app/(dashboard)/allocations/components/HoldingDetail.tsx": "dead: no importer at HEAD",
  // label only: the word is a control label, no figure value is printed.
  "src/app/(dashboard)/allocations/components/OptimizerPanel.tsx": "label only",
  "src/app/(dashboard)/allocations/components/WeightOptimizerSection.tsx": "label only",
  "src/components/admin/PreferencesPanel.tsx": "label only",
  "src/components/strategy/CustomizeDrawer.tsx": "label only",
  // Phase 197 plan 01 (D-05): the discovery header label map; strings only, the gated cells live in StrategyTable.
  "src/components/strategy/discovery-columns.ts": "label only",
  "src/components/strategy/StrategyFilters.tsx": "label only",
  "src/components/discovery/SimulateImpactButton.tsx": "label only",
  // static copy: prose, no data.
  "src/app/(marketing)/for-quants/page.tsx": "static copy",
  "src/app/(marketing)/legal/disclaimer/page.tsx": "static copy",
  "src/app/(marketing)/security/page.tsx": "static copy",
  // orphaned: nothing renders them.
  "src/components/landing/VerificationResults.tsx": "orphaned: [192-ORPHANED-LANDING-VERIFY]",
  "src/components/landing/VerificationSection.tsx": "orphaned: [192-ORPHANED-LANDING-VERIFY]",
  // gated upstream: the only live mount is under a file that imports a gate module.
  "src/app/(dashboard)/allocations/components/KpiStrip.tsx":
    "gated upstream: src/app/(dashboard)/allocations/components/ScenarioComposer.tsx",
  "src/components/charts/RollingMetrics.tsx":
    "gated upstream: src/app/(dashboard)/allocations/components/ScenarioComposer.tsx",
  "src/components/charts/RollingSortinoChart.tsx":
    "gated upstream: src/app/(dashboard)/allocations/components/ScenarioComposer.tsx",
  "src/components/charts/RollingVolatilityChart.tsx":
    "gated upstream: src/app/(dashboard)/allocations/components/ScenarioComposer.tsx",
  "src/app/factsheet/[id]/v2/TimeSeriesChart.tsx": "gated upstream: src/app/factsheet/[id]/v2/FactsheetView.tsx",
  "src/app/factsheet/[id]/v2/rolling-window-choice.tsx": "gated upstream: src/app/factsheet/[id]/v2/FactsheetView.tsx",
  // redirected: 196 replaces these (194.1 CONTEXT, the 2026-11-08 skip of B1, B2 and the v2-only panels).
  "src/app/strategy/[id]/page.tsx": REDIRECTED,
  "src/components/strategy-v2/HeadlineMetricsPanel.tsx": REDIRECTED,
  "src/components/strategy-v2/RollingMetricsPanel.tsx": REDIRECTED,
  "src/components/strategy-v2/ExposureAndGreeksPanel.tsx": REDIRECTED,
  "src/components/strategy-v2/BenchmarkGreeksTable.tsx": REDIRECTED,
  "src/components/strategy-v2/StrategyV2Shell.tsx": REDIRECTED,
};

/**
 * The 194.1-touched files that stay in `EXCLUDED`: their figures render in a gated
 * site file, so they are `no render`, never `gated upstream:` (a live site is gated by its own
 * import, not by a pointer).
 */
const TOUCHED_BUT_EXCLUDED = [
  "src/app/(dashboard)/admin/page.tsx",
  "src/app/(dashboard)/allocations/components/ScenarioComparePanel.tsx",
  "src/components/admin/AllocatorMatchQueue.tsx",
  "src/app/(dashboard)/allocations/lib/scenario-compare.ts",
  "src/app/(dashboard)/compare/lib/holding-compare-adapter.ts",
  "src/app/api/strategies/[id]/returns/route.ts",
] as const;

/** Anchors: each must be in the walked AND matched population. */
const ANCHORS = [
  "src/app/browse/[slug]/[strategyId]/page.tsx",
  "src/components/strategy/StrategyTable.tsx",
  "src/components/strategy/HoldingFactsheet.tsx",
  "src/app/api/og/factsheet/[id]/route.tsx",
] as const;

/** Anchors that must also be gated (proves the gate-import detector fires on real files). */
const GATED_ANCHORS = [
  "src/app/browse/[slug]/[strategyId]/page.tsx",
  "src/components/strategy/StrategyTable.tsx",
] as const;

function isTestPath(rel: string): boolean {
  const parts = rel.split("/");
  return (
    /\.test\.[^/]+$/.test(rel) ||
    /\.spec\.[^/]+$/.test(rel) ||
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

function readStripped(repoRoot: string, rel: string): string {
  return stripCommentsPreserveLines(readFileSync(resolve(repoRoot, rel), "utf8"));
}

/** Does the (comment-stripped) text import one of the gate modules, by exact specifier? */
function importsGateModule(stripped: string): boolean {
  const re = /(?:\bfrom|\bimport)\s*\(?\s*["']([^"']+)["']/g;
  for (const m of stripped.matchAll(re)) {
    if ((GATE_MODULES as readonly string[]).includes(m[1])) return true;
  }
  return false;
}

interface Population {
  walked: string[];
  matched: string[];
  gated: Set<string>;
}

/** Walk `roots` under `repoRoot`; the matched files name a figure; the gated ones import a gate. */
function analyze(
  repoRoot: string,
  roots: readonly string[],
  isGated: (stripped: string) => boolean = importsGateModule,
): Population {
  const walked: string[] = [];
  for (const root of roots) {
    const abs = join(repoRoot, root);
    if (existsSync(abs) && statSync(abs).isDirectory()) walk(repoRoot, abs, walked);
  }
  walked.sort();
  const matched: string[] = [];
  const gated = new Set<string>();
  for (const rel of walked) {
    const text = readStripped(repoRoot, rel);
    if (!FIGURE_PATTERN.test(text)) continue;
    matched.push(rel);
    if (isGated(text)) gated.add(rel);
  }
  return { walked, matched, gated };
}

interface Maps {
  excluded: Record<string, string>;
}

/** Every problem with how `pop` is covered by `maps`. Empty means the census is satisfied. */
function judge(pop: Population, maps: Maps): string[] {
  const problems: string[] = [];
  const walked = new Set(pop.walked);
  const matched = new Set(pop.matched);
  const { excluded } = maps;

  for (const rel of pop.matched) {
    if (pop.gated.has(rel) || rel in excluded) continue;
    problems.push(
      `ungated: ${rel} names an annualised figure but imports no gate module and is not in EXCLUDED`,
    );
  }

  for (const key of Object.keys(excluded)) {
    if (!walked.has(key)) problems.push(`stale: EXCLUDED key ${key} names a file the walk does not find`);
    else if (!matched.has(key)) problems.push(`stale: EXCLUDED key ${key} names a file the pattern does not match`);
  }

  for (const [key, reason] of Object.entries(excluded)) {
    const up = UPSTREAM_REASON.exec(reason);
    if (up) {
      const target = up[1];
      if (!walked.has(target)) problems.push(`upstream: ${key} is gated upstream by ${target}, which does not exist in the walk`);
      else if (!pop.gated.has(target)) {
        problems.push(`upstream: ${key} is gated upstream by ${target}, which does not import a gate module`);
      }
    } else if (!PLAIN_REASONS.some((re) => re.test(reason))) {
      problems.push(`reason: ${key} has "${reason}", which is outside the closed reason set`);
    }
  }
  return problems;
}

describe("figure gate census (194.1 plans 01 and 13)", () => {
  const pop = analyze(REPO_ROOT, ROOTS);

  it("every file that names an annualised figure imports a gate module or is excluded with a closed-set reason", () => {
    const problems = judge(pop, { excluded: EXCLUDED });
    expect(problems, problems.join("\n")).toEqual([]);
    // Printed so a reader (and the SUMMARY) sees the measured split without it being restated in code.
    const ungated = pop.matched.length - pop.gated.size;
    console.info(
      `figure-gate-census: walked=${pop.walked.length} matched=${pop.matched.length} gated=${pop.gated.size} ungated=${ungated} excluded=${Object.keys(EXCLUDED).length}`,
    );
  });

  it("anti-vacuity: the walk is non-empty and every anchor is walked and matched", () => {
    expect(pop.walked.length).toBeGreaterThan(0);
    const missing = ANCHORS.filter((a) => !pop.walked.includes(a) || !pop.matched.includes(a));
    expect(missing, "the census walked or matched past an anchor it must cover").toEqual([]);
  });

  it("anti-vacuity: the gated anchors really import a gate module", () => {
    const notGated = GATED_ANCHORS.filter((a) => !pop.gated.has(a));
    expect(notGated, "the gate-import detector missed a file that imports a gate").toEqual([]);
  });

  it("the six 196-redirected files are EXCLUDED with exactly the redirect reason", () => {
    const six = [
      "src/app/strategy/[id]/page.tsx",
      "src/components/strategy-v2/HeadlineMetricsPanel.tsx",
      "src/components/strategy-v2/RollingMetricsPanel.tsx",
      "src/components/strategy-v2/ExposureAndGreeksPanel.tsx",
      "src/components/strategy-v2/BenchmarkGreeksTable.tsx",
      "src/components/strategy-v2/StrategyV2Shell.tsx",
    ];
    for (const f of six) {
      expect(EXCLUDED[f], f).toBe("redirected by 196 D-03 (founder 2026-11-08)");
    }
    expect(Object.values(EXCLUDED).filter((r) => r === REDIRECTED)).toHaveLength(six.length);
  });

  it("no live 194.1 site is satisfied by a gated-upstream entry", () => {
    for (const f of TOUCHED_BUT_EXCLUDED) {
      expect(EXCLUDED[f], `${f} is a 194.1-touched file and must stay in EXCLUDED`).toBeDefined();
      expect(EXCLUDED[f], `${f} must be "no render", never a gated-upstream pointer`).toBe("no render");
    }
  });

  describe("self-test: the matcher can fire (planted files in a temp directory)", () => {
    function withPlanted(files: Record<string, string>, run: (dir: string) => void): void {
      const dir = mkdtempSync(join(tmpdir(), "figure-census-selftest-"));
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
    const NO_MAPS: Maps = { excluded: {} };

    it("flags a planted file that prints a figure with no gate import", () => {
      withPlanted(
        { "src/app/ungated.tsx": 'export const C = ({ a }: { a: { cagr: number } }) => <b>{formatPercent(a.cagr)}</b>;\n' },
        (dir) => {
          const planted = analyze(dir, ROOTS);
          expect(planted.matched).toEqual(["src/app/ungated.tsx"]);
          expect(judge(planted, NO_MAPS).join("\n")).toContain("ungated: src/app/ungated.tsx");
        },
      );
    });

    it("does not match a file that mentions Sharpe only inside comments", () => {
      withPlanted(
        { "src/components/commented.tsx": "/* Sharpe ratio is computed upstream */\n// CAGR too\nexport const x = 1;\n" },
        (dir) => {
          const planted = analyze(dir, ROOTS);
          expect(planted.walked).toEqual(["src/components/commented.tsx"]);
          expect(planted.matched).toEqual([]);
          expect(judge(planted, NO_MAPS)).toEqual([]);
        },
      );
    });

    it("counts a planted file importing a gate module as gated, and a comment-only import as not", () => {
      withPlanted(
        {
          "src/app/gated.tsx": 'import { gateAnnualized } from "@/lib/figure-gate";\nexport const s = "Sharpe";\n',
          "src/app/fake-gate.tsx": '// import { gateAnnualized } from "@/lib/figure-gate";\nexport const s = "Sharpe";\n',
          "src/app/scalars-only.tsx": 'import { recordFromScalars } from "@/lib/figure-record-scalars";\nexport const s = "Sharpe";\n',
        },
        (dir) => {
          const planted = analyze(dir, ROOTS);
          expect([...planted.gated]).toEqual(["src/app/gated.tsx"]);
          const problems = judge(planted, NO_MAPS).join("\n");
          expect(problems).toContain("ungated: src/app/fake-gate.tsx");
          expect(problems).toContain("ungated: src/app/scalars-only.tsx");
          expect(problems).not.toContain("src/app/gated.tsx");
        },
      );
    });

    it("flags a stale exclusion, an exclusion the pattern misses, a bad reason and a bad upstream", () => {
      withPlanted(
        {
          "src/app/a.tsx": 'export const s = "Sharpe";\n',
          "src/app/b.tsx": "export const x = 1;\n",
          "src/app/gated.tsx": 'import { gateAnnualized } from "@/lib/figure-gate";\nexport const s = "Sharpe";\n',
        },
        (dir) => {
          const planted = analyze(dir, ROOTS);
          const problems = judge(planted, {
            excluded: {
              "src/app/missing.tsx": "label only",
              "src/app/b.tsx": "label only",
              "src/app/a.tsx": "because I said so",
              "src/app/gated.tsx": "gated upstream: src/app/nowhere.tsx",
            },
          }).join("\n");
          expect(problems).toContain("stale: EXCLUDED key src/app/missing.tsx");
          expect(problems).toContain("stale: EXCLUDED key src/app/b.tsx names a file the pattern does not match");
          expect(problems).toContain('reason: src/app/a.tsx has "because I said so"');
          expect(problems).toContain("upstream: src/app/gated.tsx is gated upstream by src/app/nowhere.tsx");
        },
      );
    });

    it("rejects a gated-upstream pointer at a file that does not import a gate, and accepts one that does", () => {
      withPlanted(
        {
          "src/app/child.tsx": 'export const s = "Sharpe";\n',
          "src/app/parent.tsx": 'export const s = "Sharpe";\n',
        },
        (dir) => {
          const planted = analyze(dir, ROOTS);
          const problems = judge(planted, {
            excluded: { "src/app/child.tsx": "gated upstream: src/app/parent.tsx" },
          }).join("\n");
          expect(problems).toContain(
            "upstream: src/app/child.tsx is gated upstream by src/app/parent.tsx, which does not import a gate module",
          );
          expect(problems).toContain("ungated: src/app/parent.tsx");
        },
      );
      // No pending escape: a gated parent satisfies the pointer, nothing else does.
      withPlanted(
        {
          "src/app/child.tsx": 'export const s = "Sharpe";\n',
          "src/app/parent.tsx": 'import { gateAnnualized } from "@/lib/figure-gate";\nexport const s = "Sharpe";\n',
        },
        (dir) => {
          const planted = analyze(dir, ROOTS);
          expect(judge(planted, { excluded: { "src/app/child.tsx": "gated upstream: src/app/parent.tsx" } })).toEqual([]);
        },
      );
    });
  });
});
