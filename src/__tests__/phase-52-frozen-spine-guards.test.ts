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
 * because they are off-globbed from `no-raw-font-px`; so nine file paths after
 * the scenario.ts + compute.ts reviewed-edit carve-outs) must NOT be touched
 * during a restyle. They are frozen because:
 *
 *   - `src/lib/scenario.ts` — the 252-day-annualization projection engine.
 *     v1.5 coverage-window re-baseline (ADR-001): REMOVED from FROZEN_ISLANDS
 *     below because v1.5 Phase 55 deliberately edits the engine ONCE (the
 *     coverage-window blend). The phase-{29,30,31,32} git-delta guards now pin
 *     that reviewed edit; the 252-annualization math itself stays LOCKED
 *     (scenario.test.ts's pins + the from-scratch numpy gate in 55-03 prove it).
 *   - `src/lib/factsheet/compute.ts` — the client-side factsheet compute that
 *     gives the scenario blend parity BY CONSTRUCTION (BODY-02).
 *     v1.8 asset-class annualization (#597): REMOVED from FROZEN_ISLANDS below,
 *     same category as the scenario.ts carve-out — a deliberate, reviewed math
 *     edit (a single additive `periodsPerYear = 252` param so crypto annualizes
 *     vol/Sharpe/Sortino on √365), NOT a restyle reshape. Scope is the
 *     SINGLE-STRATEGY factsheet ONLY: it is now asset-class-aware (crypto √365 /
 *     traditional √252, the latter byte-identical). The scenario/blend PREVIEW
 *     surface (scenario-factsheet-payload.ts) DELIBERATELY stays on the 252
 *     default pending the blend follow-up PR (blend rule: 365 when ANY
 *     constituent is crypto), so a crypto strategy's real factsheet (√365) and
 *     its scenario preview (√252) diverge until that lands. compute.*.test.ts
 *     pins the reviewed compute behavior.
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
 * The frozen client islands as SIX file paths after the scenario.ts + #597
 * compute.ts + Phase-90 TimeSeriesChart.tsx + Phase-103 HistogramChart.tsx/
 * MasterBrush.tsx reviewed-edit carve-outs (the chart-interactivity island =
 * EquityChart + TouchTooltip + useTapPin). Every one is verified to exist on
 * disk at planning time. A diff to ANY of them during a v1.4 restyle is an
 * exit-gate violation — the visual layer is free, the locked spine is not.
 */
const FROZEN_ISLANDS: string[] = [
  // v1.5 coverage-window re-baseline (ADR-001): `src/lib/scenario.ts` was
  // REMOVED from this frozen-island set because v1.5 Phase 55 deliberately
  // edits the projection engine ONCE (the coverage-window blend). The
  // phase-{29,30,31,32} git-delta guards now PIN that reviewed edit; freezing
  // it here too would double-fail on the same intended change.
  //
  // v1.8 asset-class annualization (#597): `src/lib/factsheet/compute.ts` was
  // likewise REMOVED. The freeze exists to stop a v1.4 VISUAL restyle from
  // re-shaping the math spine — NOT to block a deliberate, reviewed math edit.
  // #597 threads a single additive `periodsPerYear = 252` param through the
  // client factsheet compute so a crypto SINGLE-STRATEGY factsheet annualizes
  // vol/Sharpe/Sortino on √365 (traditional stays √252, byte-identical). The
  // scenario/blend PREVIEW surface deliberately stays on the 252 default
  // (blend-basis follow-up PR pending), so it does NOT track this edit. Same
  // category as the scenario.ts carve-out above; compute.ts's own
  // compute.*.test.ts suites pin the reviewed behavior (default-252 identity +
  // explicit 365 cases).
  //
  // v1.9 Phase 90 (FS-01/FS-02): `src/app/factsheet/[id]/v2/TimeSeriesChart.tsx`
  // is likewise REMOVED from the array below (8 islands remain frozen). Same
  // category as the scenario.ts / #597 compute.ts carve-outs — a deliberate,
  // reviewed ADDITIVE edit, NOT a v1.4 VISUAL restyle reshape. Phase 90 adds an
  // optional `segmentMarkers` SVG overlay <g> (per-key boundary seams + gap
  // markers) that MIRRORS the already-frozen-but-load-bearing in-file
  // warmupBand/ddHighlights overlay idioms, gated by an optional
  // ChartConfig.segmentMarkers flag set only on the key:"cumulative" config.
  // Single-key payloads OMIT the marker fields, so their render stays
  // byte-identical (no flag, no overlay). The reviewed behavior is pinned by its
  // OWN suites: TimeSeriesChart.markers.test.tsx (marker geometry/copy + the
  // flag-off / fields-absent zero-marker parity — the replacement behavior
  // pin), GUARD-02 (FactsheetBody.scenario-mode.test.tsx, byte-identity), and
  // FactsheetView.kpistrip.test.tsx (the composite basis relabel). The other two
  // factsheet SVGs (HistogramChart/MasterBrush) STAY FROZEN below.
  // The remaining islands below STAY FROZEN — no RSC-ification / reshape
  // of useBreakpoint, the MC worker, the chart-interactivity island
  // (EquityChart/TouchTooltip/useTapPin), or the 3 SVGs.
  //
  // v1.10 Phase 103 (MTM-follow, F2.3): `factsheet-context.tsx` is REMOVED from the
  // frozen set. The freeze premise was that the FactsheetProvider is a byte-inert
  // scenario-mode host — but the phase-103 red team found its xRange clamp/fullRange
  // is sized to the CASH axis length (`payload.dates.length`), so under a
  // mark_to_market axis LONGER than cash the recent MTM days are PERMANENTLY
  // unreachable (the brush clamp clips every index past the cash length, and the
  // frozen-spine diff-zero guard MASKED it). Widening ONLY the `setXRange` UPPER
  // clamp to the longer of cash / MTM-bundle axis is a deliberate, reviewed ADDITIVE
  // edit (same category as the scenario.ts / #597 compute.ts / Phase-90
  // TimeSeriesChart.tsx / F1 HistogramChart+MasterBrush carve-outs above): it is a
  // NO-OP under cash (a cash consumer never emits an index beyond the cash length,
  // so the widened bound is never exercised; `fullRange` stays cash-sized), and it
  // is pinned by MasterBrush.basis.test.tsx (the cash byte-identity + MTM-reachable
  // neuter witnesses).
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
  //
  // v1.10 Phase 103 (MTM-follow, F1/F2): `HistogramChart.tsx` and
  // `MasterBrush.tsx` are REMOVED from the frozen set. The freeze premise was
  // that these SVGs are data-inert restyle targets — but the phase-103 red team
  // found they read `usePayload()` DIRECTLY (never the basis view), so under
  // mark_to_market they rendered the CASH distribution / CASH sparkline+axis,
  // violating the SC-4 invariant that nothing displays cash under an MTM label
  // (the frozen-spine diff-zero guard MASKED this — the freeze was actively
  // wrong). Routing them through `useBasisSeriesView` is a deliberate, reviewed
  // ADDITIVE edit (same category as the scenario.ts / #597 compute.ts /
  // Phase-90 TimeSeriesChart.tsx carve-outs above): under cash the view returns
  // the payload by reference so the render stays byte-identical, and the fix is
  // pinned by HistogramChart.basis.test.tsx / MasterBrush.basis.test.tsx.
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
  // file (a single combined assertion would only say "one of nine changed").
  for (const island of FROZEN_ISLANDS) {
    it(`exit gate (frozen client island): ${island} is zero-diff vs the phase baseline`, () => {
      expect(
        CHANGED,
        `Phase 52 exit gate VIOLATED — ${island} changed; it is a FROZEN ` +
          "client island (BP-01 / SCENARIO-05 / BODY-02). v1.4 lifts " +
          "desktop byte-identity for the VISUAL layer only — the locked " +
          "math/interaction spine (the FactsheetProvider, useBreakpoint, the " +
          "MC worker, and the EquityChart/TouchTooltip/useTapPin chart-" +
          "interactivity island; the projection engine + factsheet compute are " +
          "reviewed-edit carve-outs, pinned by their own math gates) " +
          "must NOT be RSC-ified, re-shaped, or 'improved' during a restyle. " +
          `Revert ${island} to the baseline.`,
      ).not.toContain(island);
    });
  }
});
