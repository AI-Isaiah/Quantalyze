// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Phase 108 (SCEN-BB) — permanent backbone tripwires.
 *
 * SC-2: the bespoke "second Sharpe" blend-panels module (the retired
 *       scenario-blend-panels module + its buildBlendPanels export) was deleted
 *       in plan 02. ScenarioComposer derives blend panels from the ONE canonical
 *       backbone adapter (scenario-blend-adapter.ts) instead. The retired module
 *       must NEVER reappear — no live-code reference, no file on disk.
 * SC-3: the OUT-OF-SCOPE keep-list (portfolio-stats.ts, health-score.ts,
 *       scenario.ts, metrics-parity.test.ts) is load-bearing and must NOT be
 *       silently deleted by a later cleanup pass.
 *
 * These are source-scans (107 leverage-backbone-gates template, generalized):
 * they read the tree from disk and fail CI on regression. The forbidden tokens
 * are built by string concatenation so this gate can never match itself even if
 * the self-exclusion path drifts. The whole-tree scan strips comment lines so
 * the surviving doc-comments that legitimately name the deleted module in prose
 * (the PAYLOAD-03 convention pin at scenario-factsheet-payload.test.ts, and the
 * repointed diversification.ts / phase-30 docstrings) cannot self-invalidate the
 * gate — only a live CODE token may trip it.
 */

const SRC_ROOT = join(process.cwd(), "src");
const SELF_REL = join("src", "lib", "scenario-backbone-gates.test.ts");

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

/** Drop comment lines so prose describing the deleted module never trips the grep. */
function stripComments(src: string): string[] {
  return src.split("\n").filter(line => {
    const t = line.trim();
    return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
  });
}

const ALL_FILES = walkSource(SRC_ROOT);

// Concatenated so the gate's own source can never contiguously match the tokens.
const FORBIDDEN = [
  "scenario-blend-" + "panels",
  "buildBlend" + "Panels",
];

describe("Phase 108 SCEN-BB backbone gates", () => {
  it("SC-2 — no live reference to the retired second-Sharpe blend-panels module survives in src/", () => {
    const offenders: string[] = [];
    for (const file of ALL_FILES) {
      const rel = relative(process.cwd(), file);
      if (rel.split(sep).join(sep) === SELF_REL) continue; // never scan self
      const code = stripComments(readFileSync(file, "utf8")).join("\n");
      const hit = FORBIDDEN.filter(tok => code.includes(tok));
      if (hit.length > 0) offenders.push(`${rel}: ${hit.join(", ")}`);
    }
    expect(
      offenders,
      `SC-2 regression — the retired blend-panels module reappeared:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("SC-2 — the legacy module + its test are absent from disk", () => {
    const base = join(process.cwd(), "src", "lib", "scenario-blend-" + "panels");
    expect(existsSync(base + ".ts")).toBe(false);
    expect(existsSync(base + ".test.ts")).toBe(false);
  });

  it("SC-3 keep-gate — the out-of-scope keep-list siblings remain on disk", () => {
    const keep = [
      join("src", "lib", "portfolio-stats.ts"),
      join("src", "lib", "health-score.ts"),
      join("src", "lib", "scenario.ts"),
      join("src", "__tests__", "metrics-parity.test.ts"),
    ];
    for (const rel of keep) {
      expect(
        existsSync(join(process.cwd(), rel)),
        `SC-3 regression — out-of-scope keep-list sibling deleted: ${rel}`,
      ).toBe(true);
    }
  });

  // The retired import line, built by concat so it can't self-trip the whole-tree
  // scan and kept as a live fixture so a token typo can't pass everything vacuously.
  const RETIRED_SAMPLE =
    'import { buildBlend' + 'Panels } from "@/lib/scenario-blend-' + 'panels";';

  it("liveness — the forbidden-token matcher DOES fire on the retired import fixture", () => {
    const hit = FORBIDDEN.filter(tok => RETIRED_SAMPLE.includes(tok));
    expect(hit).toContain("scenario-blend-" + "panels");
    expect(hit).toContain("buildBlend" + "Panels");
  });
});
