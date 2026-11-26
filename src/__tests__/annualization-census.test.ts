/**
 * Phase 236 plan 01 (FIG-01, F-5): the census of every annualizing site in `src/`.
 *
 * WHY: "365, ddof 1 everywhere" is a promise about EVERY engine, and an engine nobody listed
 * is an engine nobody moved. The source of truth is the tree, never a hand list: the files are
 * enumerated from git, read with node:fs (never shell grep: the repo carries a NUL-bearing
 * file), comment-stripped (a "Not 365.25" comment is not a site), and every file that carries
 * a census token must be a key of CENSUS with its class, a one-line reason and its measured
 * per-token counts. A new site in a new file, or a new token in a known file, fails naming it.
 *
 * Two arms bite every `engine` file that has left NOT_YET_MIGRATED:
 *   - negative: no `365.25`, ddof-0 or bare ddof-1 literal (a literal can drift from the
 *     constant; `SD_DDOF` cannot);
 *   - positive: it references every constant in its `must_use` list in code, beyond its import.
 * NOT_YET_MIGRATED is exact: it starts as every `engine` file, later plans shrink it, a listed
 * file that already passes both arms fails (so the list cannot rot), and plan 236-09 asserts it
 * empty. The Python twin is analytics-service/tests/test_annualization_census.py.
 *
 * FINDING, recorded as a comment and not as a figure: Python `blend_periods_per_year` maps an
 * unknown leg to 252 while TS `blendPeriodsPerYear` maps it to 365 (RANK-06; pinned by
 * test_figure_gate_span.py). No Phase 236 decision covers it and it is neither a 365.25 nor a
 * ddof token. The parity vectors of plan 236-08 must therefore not use an unknown leg.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type Cls =
  | "engine"
  | "display"
  | "consumer"
  | "degeneracy"
  | "moment"
  | "composite-out"
  | "diagnostic"
  | "definition"
  | "default";

/** The counted tokens. Every one is a forbidden literal in a migrated `engine` file. */
const TOKENS = {
  t365_25: /365\.25/g,
  ddof0: /ddof:\s*0\b/g,
  // One level of nested parentheses is allowed in the argument list: `dispersion(a.slice(0, n), 0)`.
  disp0: /dispersion\((?:[^()]|\([^()]*\))*,\s*0\)/g,
  ddof1: /ddof:\s*1\b/g,
  disp1: /dispersion\((?:[^()]|\([^()]*\))*,\s*1\)/g,
  // A constant defined as the bare 365 / 252 risk clock (`LIVE_BASELINE_PERIODS_PER_YEAR = 365`).
  periodClockDef: /\b\w*PERIODS_PER_YEAR\w*\s*(?::\s*number\s*)?=\s*(?:365|252)\b/g,
  // A camelCase parameter DEFAULT of the bare clock (`periodsPerYear = 252`): the uppercase token above
  // cannot see it, so ~17 defaults sat outside the census. Each is classified by name below.
  periodsDefault: /\bperiodsPerYear\s*=\s*(?:252|365)\b/g,
} as const;
type Token = keyof typeof TOKENS;

interface Exempt {
  token: Token;
  n: number;
  cls: Cls;
  reason: string;
}
interface Entry {
  cls: Cls;
  reason: string;
  /** Measured per-token counts in comment-stripped code. Omitted token = 0. */
  counts: Partial<Record<Token, number>>;
  /** `engine` only: constants that must be referenced in code beyond the import. */
  must_use?: string[];
  /** Sites inside this file that are classified apart from the file's own class. */
  exempt?: Exempt[];
}

const DEGENERACY = "ddof-invariant: `sd === 0` flat-series check, the answer is the same at ddof 0 and 1";

const CENSUS: Record<string, Entry> = {
  "src/lib/closed-sets.ts": {
    cls: "engine",
    reason: "calendarYears: the CAGR year length (whole days over CALENDAR_DAYS_PER_YEAR); annualizationPeriods / blendPeriodsPerYear hold the 365/252 clock",
    counts: {},
    must_use: ["CALENDAR_DAYS_PER_YEAR", "PERIODS_PER_YEAR_CRYPTO", "PERIODS_PER_YEAR_TRADITIONAL"],
  },
  "src/lib/scenario.ts": {
    cls: "engine",
    reason: "Scenario projection: portfolio sd and Sharpe at SD_DDOF (year length arrives through calendarYears)",
    counts: { periodsDefault: 2 },
    must_use: ["SD_DDOF"],
    exempt: [
      { token: "periodsDefault", n: 1, cls: "default", reason: "computeScenario: parameter default for an omitted clock (252 traditional, #597); not a computed clock, engine defaults unchanged" },
      { token: "periodsDefault", n: 1, cls: "default", reason: "computeCompositeCurve: parameter default for an omitted clock (252 traditional, #597); not a computed clock, engine defaults unchanged" },
    ],
  },
  "src/lib/factsheet/compute.ts": {
    cls: "engine",
    reason: "factsheet compute(): CAGR years = whole days over CALENDAR_DAYS_PER_YEAR, basis sd and Sharpe at SD_DDOF",
    counts: { disp0: 1, periodsDefault: 1 },
    must_use: ["CALENDAR_DAYS_PER_YEAR", "SD_DDOF"],
    exempt: [
      { token: "periodsDefault", n: 1, cls: "default", reason: "compute: parameter default for an omitted clock (252 traditional, #597); not a computed clock, engine defaults unchanged" },
      {
        token: "disp0",
        n: 1,
        cls: "moment",
        reason: "dispersion(rets, 0) feeds skew and kurtosis: population moments, not an annualized figure",
      },
    ],
  },
  "src/lib/factsheet/og-metrics.ts": {
    cls: "engine",
    reason: "share-card metrics: Sharpe at SD_DDOF (the year length arrives through calendarYears)",
    counts: {},
    must_use: ["SD_DDOF"],
  },
  "src/lib/factsheet/rolling.ts": {
    cls: "engine",
    reason: "rolling vol and Sharpe: the 126/30-row windows and the 365-day window, all at SD_DDOF",
    counts: { periodsDefault: 3 },
    must_use: ["SD_DDOF"],
    exempt: [
      { token: "periodsDefault", n: 1, cls: "default", reason: "rollingVol: parameter default for an omitted clock (252 traditional, #597); not a computed clock, engine defaults unchanged" },
      { token: "periodsDefault", n: 1, cls: "default", reason: "rollingSharpe: parameter default for an omitted clock (252 traditional, #597); not a computed clock, engine defaults unchanged" },
      { token: "periodsDefault", n: 1, cls: "default", reason: "rollingSortino: parameter default for an omitted clock (252 traditional, #597); not a computed clock, engine defaults unchanged" },
    ],
  },
  "src/lib/factsheet/joint.ts": {
    cls: "engine",
    reason: "tracking error and information ratio at SD_DDOF; the two sd === 0 degeneracy checks stay",
    counts: { disp0: 2, periodsDefault: 1 },
    must_use: ["SD_DDOF"],
    exempt: [
      { token: "disp0", n: 2, cls: "degeneracy", reason: DEGENERACY },
      { token: "periodsDefault", n: 1, cls: "default", reason: "jointMetrics: parameter default for an omitted clock (252 traditional, #597); not a computed clock, engine defaults unchanged" },
    ],
  },
  "src/lib/factsheet/bootstrap.ts": {
    cls: "engine",
    reason: "bootstrap Sharpe CI band at SD_DDOF (centres on the headline Sharpe)",
    counts: { periodsDefault: 2 },
    must_use: ["SD_DDOF"],
    exempt: [
      { token: "periodsDefault", n: 1, cls: "default", reason: "bootstrapCI: parameter default for an omitted clock (252 traditional, #597); not a computed clock, engine defaults unchanged" },
      { token: "periodsDefault", n: 1, cls: "default", reason: "headlineStats: parameter default for an omitted clock (252 traditional, #597); not a computed clock, engine defaults unchanged" },
    ],
  },
  "src/app/(dashboard)/compare/lib/holding-compare-adapter.ts": {
    cls: "engine",
    reason: "compare surface vol and Sharpe at SD_DDOF, twice",
    counts: {},
    must_use: ["SD_DDOF"],
  },
  "src/lib/sample-basis-ratios.ts": {
    cls: "engine",
    reason: "sample-basis Sharpe at SD_DDOF",
    counts: { periodsDefault: 1 },
    must_use: ["SD_DDOF"],
    exempt: [
      { token: "periodsDefault", n: 1, cls: "default", reason: "sampleBasisRatios: parameter default for an omitted clock (252 traditional, #597); not a computed clock, engine defaults unchanged" },
    ],
  },
  "src/lib/portfolio-stats.ts": {
    cls: "engine",
    reason: "tracking error at SD_DDOF",
    counts: { periodsDefault: 2 },
    must_use: ["SD_DDOF"],
    exempt: [
      { token: "periodsDefault", n: 1, cls: "default", reason: "computeAlphaBeta: parameter default for an omitted clock (252 traditional, #597); not a computed clock, engine defaults unchanged" },
      { token: "periodsDefault", n: 1, cls: "default", reason: "computeTrackingError: parameter default for an omitted clock (252 traditional, #597); not a computed clock, engine defaults unchanged" },
    ],
  },
  "src/app/(dashboard)/allocations/lib/scenario-benchmark.ts": {
    cls: "engine",
    reason: "Scenario-vs-benchmark Sharpe at SD_DDOF",
    counts: { periodsDefault: 1 },
    must_use: ["SD_DDOF"],
    exempt: [
      { token: "periodsDefault", n: 1, cls: "default", reason: "computeScenarioBenchmark: parameter default for an omitted clock (252 traditional, #597); not a computed clock, engine defaults unchanged" },
    ],
  },
  "src/app/(dashboard)/allocations/lib/book-figures.ts": {
    cls: "engine",
    reason: "LIVE_BASELINE_PERIODS_PER_YEAR = PERIODS_PER_YEAR_CRYPTO: the live book's crypto risk clock",
    counts: {},
    must_use: ["PERIODS_PER_YEAR_CRYPTO"],
  },
  "src/lib/return-stats.ts": {
    cls: "definition",
    reason: "dispersion/sharpe take ddof as a parameter and fix none; pearson and beta cancel it",
    counts: { ddof0: 2, disp0: 4 },
    exempt: [
      { token: "ddof0", n: 2, cls: "definition", reason: "the `ddof: 0 | 1` parameter type, not a call" },
      {
        token: "disp0",
        n: 4,
        cls: "degeneracy",
        reason: "ddof-invariant: correlation and beta ratios cancel the ddof; the sd is only tested against 0",
      },
    ],
  },
  "src/lib/figure-conventions.ts": {
    cls: "definition",
    reason: "the F-5 constant set itself (PERIODS_PER_YEAR_CRYPTO / _TRADITIONAL definitions)",
    counts: { periodClockDef: 2 },
  },
  "src/app/(dashboard)/allocations/lib/scenario-stress.ts": {
    cls: "degeneracy",
    reason: DEGENERACY,
    counts: { disp0: 1 },
  },
  "src/app/(dashboard)/allocations/widgets/attribution/AlphaBetaDecomposition.tsx": {
    cls: "degeneracy",
    reason: DEGENERACY,
    counts: { disp0: 1 },
  },
  "src/lib/factsheet/comparator-block.ts": {
    cls: "default",
    reason: "buildComparatorBlock: parameter default for an omitted clock (252 traditional, #597); not a computed clock, engine defaults unchanged",
    counts: { periodsDefault: 1 },
  },
  "src/lib/scenario-blend-adapter.ts": {
    cls: "default",
    reason: "deriveBlendPanels: parameter default for an omitted clock (252 traditional, #597); not a computed clock, engine defaults unchanged; passes it through",
    counts: { periodsDefault: 1 },
  },
  "src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts": {
    cls: "default",
    reason: "buildScenarioFactsheetPayload: parameter default for an omitted clock (252 traditional, #597); not a computed clock, engine defaults unchanged; passes it through",
    counts: { periodsDefault: 1 },
  },
  "src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx": {
    cls: "default",
    reason: "ScenarioFactsheetChart: parameter default for an omitted clock (252 traditional, #597); not a computed clock, engine defaults unchanged; passes it through to the payload builder",
    counts: { periodsDefault: 1 },
  },
  "src/app/(dashboard)/allocations/components/ScenarioBenchmarkSection.tsx": {
    cls: "default",
    reason: "ScenarioBenchmarkSection: parameter default for an omitted clock (252 traditional, #597); not a computed clock, engine defaults unchanged; passes it through to computeScenarioBenchmark",
    counts: { periodsDefault: 1 },
  },
};

/**
 * Files RESEARCH section 1 names that carry no census token. Each is checked: it exists and carries
 * no token. If one gains a token it must move to CENSUS.
 */
// The retired blend-panels module the L2214 list names is a STALE NAME: no such file exists, and
// scenario-backbone-gates.test.ts guards that it stays gone (its name is deliberately not written
// here, that gate scans `src/` for it). The live blend files are the two below.
const REVIEWED_NO_TOKEN: Record<string, { cls: Cls; reason: string }> = {
  "src/lib/health-score.ts": { cls: "consumer", reason: "scores a stored Sharpe; annualizes nothing" },
  "src/app/factsheet/[id]/v2/BatchDPanels.tsx": {
    cls: "display",
    reason: "basisDays = 252 : 365 is the display basis of a gate sentence, not a computation",
  },
  "src/lib/factsheet/record-length.ts": {
    cls: "display",
    reason: "formatRecordLength prints years that compute() derived; it owns no year length",
  },
  "src/lib/figure-gate.ts": {
    cls: "definition",
    reason: "ONE_YEAR_DAYS = 365 and coveredDays (+1 inclusive) are a GATE unit, not the CAGR span; kept distinct",
  },
};

/** Every `engine` file started here: none referenced the constants. Plan 02 moved closed-sets, scenario and book-figures out; plans 10 and 05 moved the rest, so the list ends EMPTY (236-05). A new engine file is added to CENSUS and migrated in the same change, never parked here. */
const NOT_YET_MIGRATED: string[] = [];

// ---- the tree ---------------------------------------------------------------------------------

const ROOT = process.cwd();

/** Drop `//` and block comments, keep strings and template literals intact, keep newlines. */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && d === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") out += "\n";
        i++;
      }
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      out += c;
      i++;
      while (i < n && src[i] !== c) {
        if (src[i] === "\\") {
          out += src[i] + (src[i + 1] ?? "");
          i += 2;
          continue;
        }
        out += src[i];
        i++;
      }
      out += c;
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function sourceFiles(): string[] {
  const listed = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "src"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\n")
    .filter(Boolean);
  return listed.filter(
    (f) => /\.tsx?$/.test(f) && !/\.d\.ts$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.includes("__tests__/"),
  );
}

function strippedCode(file: string): string {
  return stripComments(readFileSync(resolve(ROOT, file), "utf8"));
}

function countTokens(code: string): Partial<Record<Token, number>> {
  const out: Partial<Record<Token, number>> = {};
  for (const [name, re] of Object.entries(TOKENS) as [Token, RegExp][]) {
    const n = (code.match(re) ?? []).length;
    if (n > 0) out[name] = n;
  }
  return out;
}

/** Drop import statements so a constant that is only imported is not "used". */
function withoutImports(code: string): string {
  return code.replace(/\bimport\s[^;]*?\bfrom\s*["'][^"']+["'];?/g, "").replace(/\bimport\s*["'][^"']+["'];?/g, "");
}

const fmt = (c: Partial<Record<Token, number>>) => JSON.stringify(c);

interface Verdict {
  negative: string[];
  positive: string[];
}

function judge(file: string, entry: Entry, measured: Partial<Record<Token, number>>, code: string): Verdict {
  const negative: string[] = [];
  for (const token of Object.keys(TOKENS) as Token[]) {
    const exempt = (entry.exempt ?? []).filter((e) => e.token === token).reduce((s, e) => s + e.n, 0);
    const left = (measured[token] ?? 0) - exempt;
    if (left > 0) negative.push(`${token} x${left}`);
  }
  const body = withoutImports(code);
  const positive = (entry.must_use ?? []).filter((name) => !new RegExp(`\\b${name}\\b`).test(body));
  return { negative, positive };
}

const files = sourceFiles();
const measuredByFile = new Map<string, Partial<Record<Token, number>>>();
const codeByFile = new Map<string, string>();
for (const f of files) {
  const code = strippedCode(f);
  const m = countTokens(code);
  if (Object.keys(m).length > 0) {
    measuredByFile.set(f, m);
    codeByFile.set(f, code);
  }
}

describe("annualization census (TS): the set of sites, exact in both directions", () => {
  it("every file carrying a census token is classified (a new site fails naming its file)", () => {
    const unclassified = [...measuredByFile.keys()]
      .filter((f) => !(f in CENSUS) && !(f in REVIEWED_NO_TOKEN))
      .map((f) => `${f} ${fmt(measuredByFile.get(f)!)}`);
    expect(unclassified, `unclassified annualizing site(s): add each to CENSUS with a class and a reason`).toEqual([]);
  });

  it("a file reviewed as token-free still exists and has not gained a token", () => {
    const bad: string[] = [];
    for (const f of Object.keys(REVIEWED_NO_TOKEN)) {
      if (!existsSync(resolve(ROOT, f))) bad.push(`${f} is gone: drop it from REVIEWED_NO_TOKEN`);
      if (measuredByFile.has(f)) bad.push(`${f} now carries ${fmt(measuredByFile.get(f)!)}: move it to CENSUS`);
    }
    expect(bad).toEqual([]);
  });

  it("every classified file exists and still carries its counted tokens (a vanished site fails as stale)", () => {
    const stale: string[] = [];
    for (const [f, e] of Object.entries(CENSUS)) {
      if (!existsSync(resolve(ROOT, f))) {
        stale.push(`${f} no longer exists`);
        continue;
      }
      const measured = measuredByFile.get(f) ?? {};
      const migratedEngine = e.cls === "engine" && !NOT_YET_MIGRATED.includes(f);
      if (Object.keys(measured).length === 0 && !migratedEngine) {
        stale.push(`${f} (${e.cls}) carries no census token any more: remove it from CENSUS`);
      }
    }
    expect(stale).toEqual([]);
  });

  it("per-file token counts equal the recorded counts (a new site in a known file fails naming file and token)", () => {
    const off: string[] = [];
    for (const [f, e] of Object.entries(CENSUS)) {
      const measured = measuredByFile.get(f) ?? {};
      for (const token of Object.keys(TOKENS) as Token[]) {
        const want = e.counts[token] ?? 0;
        const got = measured[token] ?? 0;
        if (want !== got) off.push(`${f}: token ${token} recorded ${want}, measured ${got}`);
      }
    }
    expect(off).toEqual([]);
  });

  it("the census entries are well formed", () => {
    const bad: string[] = [];
    for (const [f, e] of Object.entries(CENSUS)) {
      if (!e.reason.trim()) bad.push(`${f}: empty reason`);
      if (e.cls === "engine" && !e.must_use) bad.push(`${f}: an engine entry needs a must_use list`);
      if (e.cls !== "engine" && e.must_use) bad.push(`${f}: only an engine carries must_use`);
      for (const x of e.exempt ?? []) {
        const total = (e.exempt ?? []).filter((y) => y.token === x.token).reduce((s, y) => s + y.n, 0);
        if (total > (e.counts[x.token] ?? 0)) bad.push(`${f}: exempt ${x.token} exceeds the counted sites`);
        if (!x.reason.trim()) bad.push(`${f}: an exempt site has no reason`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe("annualization census (TS): the two arms over every engine file", () => {
  const engines = Object.entries(CENSUS).filter(([, e]) => e.cls === "engine");

  it("NOT_YET_MIGRATED names only engine files, each once", () => {
    const names = new Set(engines.map(([f]) => f));
    expect(NOT_YET_MIGRATED.filter((f) => !names.has(f))).toEqual([]);
    expect(new Set(NOT_YET_MIGRATED).size).toBe(NOT_YET_MIGRATED.length);
  });

  it("negative arm: a migrated engine has no 365.25, ddof-0 or bare ddof-1 literal", () => {
    const fail: string[] = [];
    for (const [f, e] of engines) {
      if (NOT_YET_MIGRATED.includes(f)) continue;
      const v = judge(f, e, measuredByFile.get(f) ?? {}, codeByFile.get(f) ?? "");
      if (v.negative.length) fail.push(`${f}: literal ${v.negative.join(", ")}`);
    }
    expect(fail).toEqual([]);
  });

  it("positive arm: a migrated engine references every constant of its must_use list", () => {
    const fail: string[] = [];
    for (const [f, e] of engines) {
      if (NOT_YET_MIGRATED.includes(f)) continue;
      const v = judge(f, e, measuredByFile.get(f) ?? {}, codeByFile.get(f) ?? strippedCode(f));
      if (v.positive.length) fail.push(`${f}: never uses ${v.positive.join(", ")}`);
    }
    expect(fail).toEqual([]);
  });

  // Phase 236 plan 09 (FIG-01): the migration list is proven EMPTY and the engine set is pinned by
  // name, independent of CENSUS, so deleting an engine entry (to dodge both arms) fails by file.
  const RESEARCH_ENGINES = [
    "src/lib/closed-sets.ts",
    "src/lib/scenario.ts",
    "src/lib/factsheet/compute.ts",
    "src/lib/factsheet/og-metrics.ts",
    "src/lib/factsheet/rolling.ts",
    "src/lib/factsheet/joint.ts",
    "src/lib/factsheet/bootstrap.ts",
    "src/app/(dashboard)/compare/lib/holding-compare-adapter.ts",
    "src/lib/sample-basis-ratios.ts",
    "src/lib/portfolio-stats.ts",
    "src/app/(dashboard)/allocations/lib/scenario-benchmark.ts",
    "src/app/(dashboard)/allocations/lib/book-figures.ts",
  ];

  it("FIG-01: NOT_YET_MIGRATED is empty and every RESEARCH section 1 engine file is an engine passing both arms", () => {
    expect(NOT_YET_MIGRATED, "an engine parked in NOT_YET_MIGRATED is an unmigrated annualizer").toEqual([]);
    const notEngine = RESEARCH_ENGINES.filter((f) => CENSUS[f]?.cls !== "engine");
    expect(notEngine, "named engine files the census does not classify as engine").toEqual([]);
    expect(
      engines.map(([f]) => f).filter((f) => !RESEARCH_ENGINES.includes(f)),
      "an engine the census knows that this pin does not: add it here with its plan",
    ).toEqual([]);
    const failing: string[] = [];
    for (const f of RESEARCH_ENGINES) {
      const v = judge(f, CENSUS[f], measuredByFile.get(f) ?? {}, codeByFile.get(f) ?? strippedCode(f));
      if (v.negative.length || v.positive.length) {
        failing.push(`${f}: literal [${v.negative.join(", ")}] missing [${v.positive.join(", ")}]`);
      }
    }
    expect(failing).toEqual([]);
  });

  it("NOT_YET_MIGRATED is exact: a listed file that already passes both arms must be removed", () => {
    const passing: string[] = [];
    for (const f of NOT_YET_MIGRATED) {
      const e = CENSUS[f];
      const v = judge(f, e, measuredByFile.get(f) ?? {}, codeByFile.get(f) ?? strippedCode(f));
      if (v.negative.length === 0 && v.positive.length === 0) passing.push(f);
    }
    expect(passing, "already migrated: remove from NOT_YET_MIGRATED").toEqual([]);
  });
});
