// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Phase 107 (LEV-BB) — permanent backbone tripwires.
 *
 * SC-3: the disclosure/derived-hook apparatus (useLeveragedMetrics /
 *       useModeledLeverage / LEVERAGE_CAVEAT) was deleted in plan 02 and must
 *       NEVER reappear in src/. Leverage is now a dailies transform composed into
 *       the ONE shared useBasisSeriesView hook.
 * SC-5: there is exactly ONE leverage transform (r→L·r on the active-basis
 *       dailies, then re-derive). No SECOND bespoke `compute(<series>.map(...))`
 *       leverage path may exist outside the LEV-02 scenario engine.
 *
 * These are source-scans (GUARD-04 Test-6 shape, generalized to a recursive
 * walk): they read the tree from disk and fail CI on regression. The forbidden
 * SC-3 tokens are built by string concatenation so this gate can never match
 * itself even if the self-exclusion path drifts. Both scans strip comment lines
 * so header prose describing the deleted path cannot self-invalidate the gate.
 */

const SRC_ROOT = join(process.cwd(), "src");
const SELF_REL = join("src", "app", "factsheet", "[id]", "v2", "leverage-backbone-gates.test.ts");
// LEV-02 leverage engine — legitimately levers a daily return; exempt from SC-5.
const SCENARIO_REL = join("src", "lib", "scenario.ts");

/** Recursively collect every .ts/.tsx file under src/, skipping build/test noise. */
function walkSource(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "__snapshots__") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSource(full, acc);
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      acc.push(full);
    }
  }
  return acc;
}

/** Drop comment lines so prose describing a deleted path never trips the grep. */
function stripComments(src: string): string[] {
  return src.split("\n").filter(line => {
    const t = line.trim();
    return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
  });
}

const ALL_FILES = walkSource(SRC_ROOT);

describe("Phase 107 LEV-BB backbone gates", () => {
  it("SC-3 — no disclosure/derived-hook symbols survive anywhere in src/", () => {
    // Concatenated so the gate's own source can never match the tokens.
    const FORBIDDEN = [
      "useLeveraged" + "Metrics",
      "useModeled" + "Leverage",
      "LEVERAGE" + "_CAVEAT",
    ];
    const offenders: string[] = [];
    for (const file of ALL_FILES) {
      const rel = relative(process.cwd(), file);
      if (rel.split(sep).join(sep) === SELF_REL) continue; // never scan self
      const code = stripComments(readFileSync(file, "utf8")).join("\n");
      const hit = FORBIDDEN.filter(tok => code.includes(tok));
      if (hit.length > 0) offenders.push(`${rel}: ${hit.join(", ")}`);
    }
    expect(offenders, `SC-3 regression — forbidden symbols reappeared:\n${offenders.join("\n")}`).toEqual([]);
  });

  // The retired second-leverage-path shape: a compute() fed directly by a mapped
  // (scaled) returns series. Kept as a live fixture so a regex typo can't pass
  // everything silently.
  const RETIRED_SAMPLE = "  const levered = compute(payload.strategyReturns.map(r => appliedLeverage * r), dates, 0, 365);";
  const SC5_RE = /compute\(\s*[\w$.\[\]]+\.map\(/;

  it("SC-5 liveness — the gate regex DOES match the retired bespoke leverage shape", () => {
    expect(SC5_RE.test(RETIRED_SAMPLE)).toBe(true);
  });

  it("SC-5 — no second `compute(<series>.map(...))` leverage path outside scenario.ts", () => {
    const offenders: string[] = [];
    for (const file of ALL_FILES) {
      const rel = relative(process.cwd(), file);
      const relNorm = rel.split(sep).join(sep);
      if (relNorm === SELF_REL) continue; // the fixture above lives here
      if (relNorm === SCENARIO_REL) continue; // LEV-02 leverage engine, exempt
      for (const line of stripComments(readFileSync(file, "utf8"))) {
        if (SC5_RE.test(line)) offenders.push(`${rel}: ${line.trim()}`);
      }
    }
    expect(offenders, `SC-5 regression — a second leverage compute path reappeared:\n${offenders.join("\n")}`).toEqual([]);
  });
});
