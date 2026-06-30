/**
 * Phase 52 (Per-Surface Application — Allocator Journey) — frozen-island
 * exit-gate guard.
 *
 * v1.4 LIFTS the desktop-byte-identity invariant for the VISUAL layer — the
 * restyle is free to fix scaling / clipping / hierarchy on the allocator
 * surfaces. But a hard floor remains LOCKED: the frozen client islands
 * (CONTEXT collapses the chart-interactivity trio EquityChart + TouchTooltip +
 * useTapPin into one "chart interactivity" island; Phase 54 BP-03 adds the 3
 * factsheet SVG charts — TimeSeriesChart/HistogramChart/MasterBrush — frozen
 * because they are off-globbed from `no-raw-font-px`; so eleven file paths) must
 * NOT be touched during a restyle. They are frozen because:
 *
 *   - `src/lib/scenario.ts` — the 252-day-annualization projection engine
 *     (SCENARIO-05 zero-diff). A one-line tweak silently re-bases the math the
 *     whole product (KPI strip, factsheet, scenario blend) relies on.
 *   - `src/lib/factsheet/compute.ts` — the client-side factsheet compute that
 *     gives the scenario blend parity BY CONSTRUCTION (BODY-02). A drift here
 *     silently de-syncs the real factsheet from the scenario one.
 *   - `src/app/factsheet/[id]/v2/factsheet-context.tsx` — the FactsheetProvider
 *     the scenario mode mounts under `persist={false}`; RSC-ifying or
 *     re-shaping it would break the byte-identical scenarioMode flag.
 *   - `src/hooks/useBreakpoint.ts` — the SSR-safe breakpoint hook every mobile
 *     branch gates behind (T-45-01). A restyle must not re-derive breakpoints.
 *   - `src/app/(dashboard)/allocations/lib/montecarlo.worker.ts` — the first
 *     Web Worker; its message contract is load-bearing for the MC bands.
 *   - the chart-interactivity island (`EquityChart.tsx` + `TouchTooltip.tsx` +
 *     `useTapPin.ts`) — the 2277-LOC touch path + the shared tap-pin hook,
 *     byte-identical since v1.3 (the desktop render must not regress).
 *
 * This gate FAILS SILENTLY (ship GREEN) unless a diff-inspecting test catches
 * it — a structural edit (e.g. RSC-ifying a frozen client island during a
 * restyle, or "improving" the worker message shape) would pass every visual
 * gate while quietly breaking the locked math/interaction spine. The existing
 * svg-golden + scenario.test.ts gates catch a MATH or RENDER drift; this guard
 * is the belt-and-suspenders STRUCTURAL gate (RESEARCH Open-Q2) that catches an
 * edit even when the goldens happen not to diff.
 *
 * HOW IT WORKS
 * ------------
 * The guard reads the REAL git delta for the phase: every file added or changed
 * between the phase baseline (the merge-base with origin/main) and HEAD, PLUS
 * untracked-but-not-ignored files. It is a pure git/file inspection — no
 * network, no Supabase round-trip — and runs in well under 2s. The frozen paths
 * are tracked files, so an edit shows up in `git diff`; a (forbidden) brand-new
 * sibling would show up in `git ls-files --others`.
 *
 * NON-VACUITY
 * -----------
 * The delta is computed from `git diff`/`git ls-files`, never a hardcoded list.
 * Verified during authoring (mirrors the phase-29/30 sibling guards): appending
 * a no-op line to any island path makes that island's assertion FAIL (the file
 * lands in the changed set), then reverting restores green.
 *
 * FAIL-LOUD (project CLAUDE.md Rule 12)
 * -------------------------------------
 * If the baseline ref cannot be resolved AT ALL (no origin/main merge-base AND
 * no fallback base sha reachable), the guard THROWS with an actionable message
 * — it never silently passes / skips. A guard that can't see the delta is worse
 * than no guard, so it must go red, not green.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";

const CWD = process.cwd();

/**
 * The phase branch point on origin/main at planning time (52-01-PLAN.md
 * <interfaces>: HEAD at planning was cd2fcb4c). Used ONLY as a fallback when
 * `git merge-base origin/main HEAD` cannot be computed (e.g. a shallow CI clone
 * with no origin/main ref). If even this sha is unreachable, the guard fails
 * loud rather than skipping.
 */
const FALLBACK_BASE_SHA = "cd2fcb4c";

/**
 * Run git with an argument array (no shell — execFileSync, not execSync), so no
 * value is ever interpolated into a shell string. Trimmed; throws on non-zero
 * exit.
 */
function git(args: string[]): string {
  return execFileSync("git", args, {
    cwd: CWD,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** Does `ref` resolve to a commit in this repo? */
function refExists(ref: string): boolean {
  try {
    git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the phase baseline ref. Prefer the merge-base with origin/main
 * (correct in CI and locally); fall back to the documented branch-point sha if
 * origin/main is absent; FAIL LOUD if neither resolves (Rule 12 — never a
 * silent skip).
 */
function resolveBaselineRef(): string {
  if (refExists("origin/main")) {
    try {
      const base = git(["merge-base", "origin/main", "HEAD"]);
      if (base) return base;
    } catch {
      // fall through to the constant fallback
    }
  }
  if (refExists(FALLBACK_BASE_SHA)) {
    return FALLBACK_BASE_SHA;
  }
  throw new Error(
    "Phase 52 frozen-spine guard could not resolve a baseline ref: neither " +
      "`git merge-base origin/main HEAD` nor the fallback base sha " +
      `\`${FALLBACK_BASE_SHA}\` is reachable. The guard refuses to pass ` +
      "without a real diff base (CLAUDE.md Rule 12 — fail loud, never " +
      "silently skip an exit gate). Fetch origin/main (`git fetch origin " +
      "main`) or run against a non-shallow clone, then re-run.",
  );
}

/**
 * Build the set of files added or changed in this phase vs `base`:
 *   - `git diff --name-only <base> HEAD` — committed adds/changes
 *   - `git ls-files --others --exclude-standard` — untracked, not-ignored files
 * `.planning/` is gitignored, so it never pollutes the set.
 */
function changedFiles(base: string): string[] {
  const committed = git(["diff", "--name-only", base, "HEAD"])
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);
  const untracked = git(["ls-files", "--others", "--exclude-standard"])
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean);
  return [...new Set([...committed, ...untracked])];
}

const BASE = resolveBaselineRef();
const CHANGED = changedFiles(BASE);

/**
 * The SEVEN frozen client islands as EIGHT file paths (the chart-interactivity
 * island = EquityChart + TouchTooltip + useTapPin). Every one is verified to
 * exist on disk at planning time. A diff to ANY of them during a v1.4 restyle
 * is an exit-gate violation — the visual layer is free, the locked spine is not.
 */
const FROZEN_ISLANDS: string[] = [
  "src/lib/scenario.ts",
  "src/lib/factsheet/compute.ts",
  "src/app/factsheet/[id]/v2/factsheet-context.tsx",
  "src/hooks/useBreakpoint.ts",
  "src/app/(dashboard)/allocations/lib/montecarlo.worker.ts",
  "src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx",
  "src/components/charts/TouchTooltip.tsx",
  "src/hooks/useTapPin.ts",
  // Phase 54 (BP-03): the 3 factsheet chart-internal SVGs are off-globbed from
  // `no-raw-font-px` (they keep raw px pending the deferred VERIFY-04 tolerance-
  // golden re-baseline). The off-glob removes lint protection, so freeze them
  // here — otherwise a future raw-px / render edit to them is caught by NO gate
  // (lint off + goldens deferred). Zero-diff vs the baseline today.
  "src/app/factsheet/[id]/v2/TimeSeriesChart.tsx",
  "src/app/factsheet/[id]/v2/HistogramChart.tsx",
  "src/app/factsheet/[id]/v2/MasterBrush.tsx",
];

describe("Phase 52 frozen-spine exit-gate guards", () => {
  it("resolves a real phase baseline ref (fails loud if it cannot — Rule 12)", () => {
    // `resolveBaselineRef()` already threw at module load if unresolvable, so
    // reaching here proves a base was found. Pin the invariant explicitly so a
    // future refactor that swallows the error is caught.
    expect(BASE, "phase baseline ref must resolve to a non-empty sha").toBeTruthy();
    expect(typeof BASE).toBe("string");
  });

  // One assertion per frozen island so a CI failure names the EXACT offending
  // file (a single combined assertion would only say "one of eleven changed").
  for (const island of FROZEN_ISLANDS) {
    it(`exit gate (frozen client island): ${island} is zero-diff vs the phase baseline`, () => {
      expect(
        CHANGED,
        `Phase 52 exit gate VIOLATED — ${island} changed; it is a FROZEN ` +
          "client island (BP-01 / SCENARIO-05 / BODY-02). v1.4 lifts " +
          "desktop byte-identity for the VISUAL layer only — the locked " +
          "math/interaction spine (the projection engine, the factsheet " +
          "compute, the FactsheetProvider, useBreakpoint, the MC worker, and " +
          "the EquityChart/TouchTooltip/useTapPin chart-interactivity island) " +
          "must NOT be RSC-ified, re-shaped, or 'improved' during a restyle. " +
          `Revert ${island} to the baseline.`,
      ).not.toContain(island);
    });
  }
});
