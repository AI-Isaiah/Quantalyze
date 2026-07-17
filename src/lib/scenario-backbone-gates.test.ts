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

/**
 * Strip comments so ONLY live code references to a forbidden token can trip the
 * gate. Three passes per line:
 *   1. whole-line comments (trimmed start is //, *, or /*) → dropped (handles
 *      block-comment interiors and multi-line JSDoc);
 *   2. inline block spans `/* … *\/` on a code line → removed;
 *   3. trailing `// …` line comments → removed.
 * Without (2)/(3) an innocent END-OF-LINE mention (e.g.
 * `import X from "./y"; // replaces scenario-blend-panels`) would FALSE-POSITIVE
 * and trip SC-2 in CI. The on-disk existsSync absence checks remain the
 * authoritative guard; this is CI-annoyance hardening only.
 */
function stripComments(src: string): string[] {
  const out: string[] = [];
  for (const line of src.split("\n")) {
    const t = line.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue;
    // Remove inline block spans, then any trailing line comment.
    let code = line.replace(/\/\*.*?\*\//g, "");
    const slash = code.indexOf("//");
    if (slash !== -1) code = code.slice(0, slash);
    if (code.trim().length > 0) out.push(code);
  }
  return out;
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

  it("stripComments hardening — a comment-only mention does NOT trip, a live code ref DOES", () => {
    const tok = "scenario-blend-" + "panels";
    // Trailing line comment + inline block span mentioning the token → stripped,
    // so the token is absent from the scanned code (no false-positive CI trip).
    const trailing = `import X from "./y"; // replaces ${tok}`;
    const inlineBlock = `const z = 1; /* legacy ${tok} note */`;
    expect(stripComments(trailing).join("\n").includes(tok)).toBe(false);
    expect(stripComments(inlineBlock).join("\n").includes(tok)).toBe(false);
    // A genuine code reference still survives the strip → the gate still fires.
    const realCode = `import { a } from "@/lib/${tok}";`;
    expect(stripComments(realCode).join("\n").includes(tok)).toBe(true);
  });
});

/**
 * Phase 111 (CONSTIT-04) — permanent WHOLE-REPO Data-Sources orphan gate.
 *
 * The v1.10 SC-3 lesson: a grep gate that scans src/ ONLY lets a deleted
 * feature's identifiers linger in e2e/ (and tests/, scripts/) undetected. Plan
 * 111-03 deleted the separate "Data sources" composer section and reshaped it
 * into the unified badged CompositionList; this gate walks src/ + e2e/ + tests/
 * + scripts/ (every source tree in the repo) so a removed identifier can never
 * silently reappear ANYWHERE, and runs in CI on every push.
 *
 * Banned = ONLY identifiers 111-03 actually REMOVED (each verified 0 hits
 * repo-wide before this gate landed):
 *   - the `scenario-data-sources` testid prefix   (renamed → scenario-constituent-*)
 *   - the `data-data-source-id` per-key row selector (→ data-scope-ref)
 *   - `includeByApiKeyId`   (deleted composer useState)
 *   - `handleDataSourceToggle` (deleted per-key toggle handler)
 *
 * DELIBERATELY NOT banned — these are RETAINED live identifiers in the NEW
 * unified list and a broad `dataSource` substring would false-positive on them:
 *   - `showDataSources` / `allDataSourcesExcluded` — load-bearing render-gating
 *     locals in ScenarioComposer.tsx that drive per-key row rendering + the
 *     honest all-excluded empty card (111-03 kept them by design);
 *   - the `dataSourceLabel` helper family (RESEARCH removal map retains it).
 * Banning those would both fail this gate on the post-reshape tree AND
 * misrepresent the removal map — so the ban list is the four removed tokens only.
 *
 * Self-invalidation-proof: the banned tokens are built by string concatenation
 * (this file's source never contiguously contains them) AND this file is
 * excluded from the walk. A companion neutered-gate assertion proves the matcher
 * DOES fire on a synthetic banned-token string (test-the-wiring: prove it fails
 * when neutered), and an over-broadening guard pins that the retained live
 * identifiers can never be swept into the ban list.
 */

const REPO_SCAN_ROOTS = ["src", "e2e", "tests", "scripts"];

const ORPHAN_SCAN_FILES = REPO_SCAN_ROOTS.flatMap((r) => {
  const root = join(process.cwd(), r);
  return existsSync(root) ? walkSource(root) : [];
});

// Concatenated so this gate's own source can never contiguously match its bans.
const DATA_SOURCES_ORPHANS = [
  "scenario-data-" + "sources",
  "data-data-" + "source-id",
  "includeBy" + "ApiKeyId",
  "handleDataSource" + "Toggle",
];

describe("CONSTIT-04 — Data-Sources orphan scan (whole-repo)", () => {
  it("no removed Data-Sources identifier survives in src/, e2e/, tests/, or scripts/", () => {
    const offenders: string[] = [];
    for (const file of ORPHAN_SCAN_FILES) {
      const rel = relative(process.cwd(), file);
      if (rel.split(sep).join(sep) === SELF_REL) continue; // never scan self
      const code = stripComments(readFileSync(file, "utf8")).join("\n");
      const hit = DATA_SOURCES_ORPHANS.filter((tok) => code.includes(tok));
      if (hit.length > 0) offenders.push(`${rel}: ${hit.join(", ")}`);
    }
    expect(
      offenders,
      `CONSTIT-04 regression — a removed Data-Sources identifier reappeared as live code:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("walks e2e/, tests/, and scripts/ — not just src/ (the v1.10 SC-3 whole-repo lesson)", () => {
    const scannedRoots = new Set(
      ORPHAN_SCAN_FILES.map((f) => relative(process.cwd(), f).split(sep)[0]),
    );
    // src/ is always in scope; each non-src tree that exists must be walked, or a
    // deleted identifier could linger there undetected (exactly the SC-3 miss).
    expect(scannedRoots.has("src")).toBe(true);
    for (const root of ["e2e", "tests", "scripts"]) {
      if (existsSync(join(process.cwd(), root))) {
        expect(scannedRoots.has(root), `orphan gate must walk ${root}/`).toBe(true);
      }
    }
  });

  it("neutered-gate detection — the matcher DOES fire on a synthetic banned-token string", () => {
    // Prove the gate is not vacuous: were any banned identifier reintroduced as
    // live code, the comment-stripped includes() scan would catch it. Assert
    // every banned token is detected in a synthetic in-memory source line.
    for (const tok of DATA_SOURCES_ORPHANS) {
      const synthetic = `const x = screen.getByTestId("${tok}");`;
      expect(
        stripComments(synthetic).join("\n").includes(tok),
        `neutered-gate proof failed — the matcher would NOT catch a live ${tok}`,
      ).toBe(true);
    }
  });

  it("over-broadening guard — retained live identifiers are never swept into the ban list", () => {
    // showDataSources / allDataSourcesExcluded / dataSourceLabel are load-bearing
    // in the NEW unified list; a future over-broad ban (e.g. a `dataSource`
    // substring) must never trip them. Assert no banned token matches them.
    const retained = [
      "show" + "DataSources",
      "allDataSources" + "Excluded",
      "dataSource" + "Label",
    ];
    for (const keep of retained) {
      const collides = DATA_SOURCES_ORPHANS.some(
        (tok) => keep.includes(tok) || tok.includes(keep),
      );
      expect(collides, `over-broad ban would trip retained identifier: ${keep}`).toBe(false);
    }
  });
});
