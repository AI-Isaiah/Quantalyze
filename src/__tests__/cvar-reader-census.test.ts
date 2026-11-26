/**
 * Phase 236 FIG-03 (F-6, CONTEXT Q2 "Total record only", founder 2026-11-25): the CVaR READER census.
 *
 * CVaR is nulled below CVAR_MIN_OBS = 60 observations at every reader that holds a TOTAL record, and
 * at none that shows a zoomed window. This census classifies every non-test source file that reads or
 * produces CVaR (comment-stripped), exact-set in BOTH directions, so a new reader cannot ship
 * unclassified:
 *
 *   total-record (floored)  must name the behaviour test(s) that pin its floor (`pinnedBy`), and must
 *                           reference CVAR_MIN_OBS in code (an import alone is not a use).
 *   window (always shows)   must NOT reference it: compute() cannot tell a total record from a window.
 *   definition              must NOT reference it: historicalVarCvar and its wrappers carry no floor.
 *   pass-through / display  carry or print a figure someone else already floored; no constant needed.
 *
 * WHAT THIS CENSUS DOES NOT PROVE (review WR-03): the `CVAR_MIN_OBS` check is a STRING check. It passes
 * when the constant appears anywhere in a file, so it cannot see a whole-record figure the file emits
 * WITHOUT the floor (that is exactly how CR-01 shipped: build-payload referenced the constant while its
 * mark-to-market and smoothed bundles carried none). A per-file behavioural check cannot be written
 * generically, so the proof that each total-record figure set is floored is the behaviour tests the
 * `pinnedBy` entries name, and the census only asserts those files exist and name the constant.
 *
 * A reader the map does not name fails naming its file. A map entry no file matches any more fails
 * naming the entry. Measured at plan 236-07; the plan's draft map was adjusted by measurement:
 * `src/lib/glossary.ts` (the `cvar_95` term key) matches the reader pattern and is a display file.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type Cls = "total-record" | "window" | "definition" | "pass-through" | "display";

const CENSUS: Record<string, { cls: Cls; reason: string; pinnedBy?: string[] }> = {
  "src/lib/factsheet/build-payload.ts": {
    cls: "total-record",
    reason: "buildFactsheetPayload floors cvar95 where `overlaid` is built, and deriveSeriesBundle floors the whole-record bundles (mark-to-market, smoothed, the leverage what-if) on `totalRecordSeries`; the strategy and allocator-portfolio payloads both build here",
    pinnedBy: ["src/lib/factsheet/cvar-floor.test.ts", "src/app/factsheet/[id]/v2/basis-context.cvar-floor.test.tsx"],
  },
  "src/app/(dashboard)/allocations/widgets/risk/VarExpectedShortfall.tsx": {
    cls: "total-record",
    reason: "the book's ES95 is the dash below CVAR_MIN_OBS on the book's total return record; VaR still shows",
    pinnedBy: ["src/app/(dashboard)/allocations/widgets/risk/VarExpectedShortfall.boundary.test.tsx"],
  },
  "src/app/(dashboard)/allocations/lib/scenario-stress.ts": {
    cls: "total-record",
    reason: "computeVarPath: the Scenario blend's CVaR is null below CVAR_MIN_OBS on the blend's whole common series (A6)",
    pinnedBy: ["src/app/(dashboard)/allocations/lib/scenario-stress.test.ts"],
  },
  "src/lib/factsheet/compute.ts": {
    cls: "window",
    reason: "compute() runs on a whole record AND on every zoomed window, so it carries no floor; the total-record caller floors",
  },
  "src/lib/return-stats.ts": {
    cls: "definition",
    reason: "historicalVarCvar: the CVaR definition, no floor (the var_cvar fixture section pins it)",
  },
  "src/lib/portfolio-stats.ts": {
    cls: "definition",
    reason: "computeExpectedShortfall: a thin wrapper over historicalVarCvar, no floor",
  },
  "src/lib/factsheet/basis-metrics.ts": {
    cls: "pass-through",
    reason: "overlayStoredFigureDefs carries the stored cvar95 (stored null stays NaN); the floor is applied after it in build-payload",
  },
  "src/lib/factsheet/fetch-and-build-payload.ts": {
    cls: "pass-through",
    reason: "reads the stored metrics_json cvar into StoredFigureDefs and hands it to build-payload",
  },
  "src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts": {
    cls: "total-record",
    reason: "buildScenarioFactsheetPayload floors cvar95 on the blend's whole common series below CVAR_MIN_OBS (A6); emptyComputeSummary() carries NaN, and a zoomed window re-derives through windowView and always shows it",
    pinnedBy: ["src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.test.ts"],
  },
  "src/lib/factsheet/types.ts": {
    cls: "pass-through",
    reason: "the cvar95 field's type",
  },
  "src/app/factsheet/[id]/v2/MetricsColumn.tsx": {
    cls: "display",
    reason: "prints m.cvar95 through pctSigned: NaN is the dash; it decides nothing",
  },
  "src/app/(dashboard)/allocations/components/StressVarSection.tsx": {
    cls: "display",
    reason: "prints result.cvar from computeVarPath, which already floored it; the section shows its own sample-floor empty state first",
  },
  "src/lib/glossary.ts": {
    cls: "display",
    reason: "the cvar_95 term key and its definition text",
  },
};

/**
 * The reader pattern: any of these in comment-stripped code makes a file a CVaR reader. `\bcvar\b`
 * catches a bare `.cvar` reader (a stored `metrics_json.cvar` or a `computeVarPath` result), which the
 * first pattern set could not see (review WR-03).
 */
const READER = /cvar95|computeExpectedShortfall|historicalVarCvar|cvar_95|expected_shortfall|\bcvar\b/;

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

/** Drop import statements so a constant that is only imported is not "used". */
function withoutImports(code: string): string {
  return code.replace(/\bimport\s[^;]*?\bfrom\s*["'][^"']+["'];?/g, "").replace(/\bimport\s*["'][^"']+["'];?/g, "");
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

const strippedCode = (file: string): string => stripComments(readFileSync(resolve(ROOT, file), "utf8"));

const readers = sourceFiles().filter((f) => READER.test(strippedCode(f)));

describe("CVaR reader census (236 FIG-03, T-236-14, T-236-15)", () => {
  it("every CVaR reader is classified: a new unclassified reader fails naming its file", () => {
    const unclassified = readers.filter((f) => !(f in CENSUS));
    expect(
      unclassified,
      `CVaR reader(s) the census does not name: ${unclassified.join(", ")}. Classify each as total-record (and floor it at CVAR_MIN_OBS), window, definition, pass-through or display.`,
    ).toEqual([]);
  });

  it("no census entry is stale: every named file still reads CVaR (the exact set holds in both directions)", () => {
    const found = new Set(readers);
    const stale = Object.keys(CENSUS).filter((f) => !found.has(f));
    expect(stale, `census entr(ies) no file matches any more: ${stale.join(", ")}`).toEqual([]);
  });

  it("every total-record reader references CVAR_MIN_OBS in code (a string check: necessary, not sufficient)", () => {
    const missing = Object.entries(CENSUS)
      .filter(([, e]) => e.cls === "total-record")
      .map(([f]) => f)
      .filter((f) => !/\bCVAR_MIN_OBS\b/.test(withoutImports(strippedCode(f))));
    expect(missing, `total-record reader(s) with no CVAR_MIN_OBS floor: ${missing.join(", ")}`).toEqual([]);
  });

  it("every total-record reader names the behaviour test(s) that pin its floor, and each exists and uses CVAR_MIN_OBS", () => {
    const problems: string[] = [];
    for (const [file, e] of Object.entries(CENSUS)) {
      if (e.cls !== "total-record") continue;
      if (!e.pinnedBy || e.pinnedBy.length === 0) {
        problems.push(`${file}: no pinnedBy behaviour test`);
        continue;
      }
      for (const t of e.pinnedBy) {
        let src = "";
        try {
          src = readFileSync(resolve(ROOT, t), "utf8");
        } catch {
          problems.push(`${file}: pinnedBy ${t} does not exist`);
          continue;
        }
        if (!/\bCVAR_MIN_OBS\b/.test(src)) problems.push(`${file}: pinnedBy ${t} never references CVAR_MIN_OBS`);
      }
    }
    expect(problems, `total-record reader(s) whose floor no behaviour test pins:\n${problems.join("\n")}`).toEqual([]);
  });

  it("no window or definition reader references CVAR_MIN_OBS (a zoomed window always shows CVaR)", () => {
    const floored = Object.entries(CENSUS)
      .filter(([, e]) => e.cls === "window" || e.cls === "definition")
      .map(([f]) => f)
      .filter((f) => /\bCVAR_MIN_OBS\b/.test(strippedCode(f)));
    expect(floored, `window/definition file(s) that carry the total-record floor: ${floored.join(", ")}`).toEqual([]);
  });
});
