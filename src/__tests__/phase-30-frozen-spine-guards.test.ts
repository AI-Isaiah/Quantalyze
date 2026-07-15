/**
 * Phase 30 (Factsheet Graphs on the Blend) — frozen-engine exit-gate guard.
 *
 * Phase 30 adds three factsheet-grade graph surfaces to the BLENDED portfolio
 * by assembling EXISTING leaf charts over a pure-TS blend-panel adapter. The
 * projection engine is NOT touched.
 * The defining exit gate (ROADMAP Phase 30 Exit Gates; 30-RESEARCH §User
 * Constraints "Frozen engine"; 30-02-PLAN SCENARIO-05) is:
 *
 *   src/lib/scenario.ts AND src/lib/scenario.test.ts have ZERO diff vs the
 *   phase baseline — the frozen 252-day-annualization engine and its
 *   convention pins. Every blend series the new adapter derives MIRRORS the
 *   engine's math; the engine itself is read-only this phase.
 *
 * This gate FAILS SILENTLY (ship GREEN) unless a diff-inspecting test catches
 * it — a one-line tweak to `scenario.ts` would silently re-base the 252-day
 * annualization the whole product (KPI strip, factsheet, this phase's blend
 * graphs) relies on. That silent-failure surface is the reason this guard
 * exists.
 *
 * HOW IT WORKS
 * ------------
 * The guard reads the REAL git delta for the phase: every file added or
 * changed between the phase baseline (the merge-base with origin/main) and
 * HEAD, PLUS untracked-but-not-ignored files. It is a pure git/file inspection
 * — no network, no Supabase round-trip — and runs in well under 2s. The frozen
 * paths are tracked files, so an edit shows up in `git diff`; a (forbidden) new
 * engine file would show up in `git ls-files --others`.
 *
 * Phase 30 ships ZERO migrations (no DB, no schema — REQUIREMENTS.md "no schema
 * change"; 30-RESEARCH §Runtime State Inventory). There is therefore no
 * migration assertion here — but if a stray `*scenario*`/`*share*` migration
 * were ever to land in the delta, the still-present phase-29 frozen-spine guard
 * (`phase-29-frozen-spine-guards.test.ts`) surfaces it; this guard stays
 * narrowly scoped to the frozen ENGINE that is Phase 30's own invariant.
 *
 * NON-VACUITY
 * -----------
 * The delta is computed from `git diff`/`git ls-files`, never a hardcoded list.
 * Verified during authoring: appending a no-op line to `src/lib/scenario.ts`
 * makes the engine assertion FAIL (the file lands in the changed set), then
 * reverting restores green. Same for `src/lib/scenario.test.ts`.
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
 * The phase branch point on origin/main at planning time (30-02-PLAN.md
 * <interfaces>: HEAD at planning was 03d0699c). Used ONLY as a fallback when
 * `git merge-base origin/main HEAD` cannot be computed (e.g. a shallow CI clone
 * with no origin/main ref). If even this sha is unreachable, the guard fails
 * loud rather than skipping.
 */
const FALLBACK_BASE_SHA = "03d0699c";

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
    "Phase 30 frozen-spine guard could not resolve a baseline ref: neither " +
      "`git merge-base origin/main HEAD` nor the fallback base sha " +
      `\`${FALLBACK_BASE_SHA}\` is reachable. The guard refuses to pass ` +
      "without a real diff base (CLAUDE.md Rule 12 — fail loud, never " +
      "silently skip an exit gate). Fetch origin/main (`git fetch origin " +
      "main`) or run against a non-shallow clone, then re-run.",
  );
}

const BASE = resolveBaselineRef();

describe("Phase 30 frozen-spine exit-gate guards", () => {
  it("resolves a real phase baseline ref (fails loud if it cannot — Rule 12)", () => {
    // `resolveBaselineRef()` already threw at module load if unresolvable, so
    // reaching here proves a base was found. Pin the invariant explicitly so a
    // future refactor that swallows the error is caught.
    expect(BASE, "phase baseline ref must resolve to a non-empty sha").toBeTruthy();
    expect(typeof BASE).toBe("string");
  });

  // v1.5 coverage-window re-baseline (ADR-001): Phase 30's frozen-spine target
  // was scenario.ts + scenario.test.ts (the SCENARIO-05 zero-diff engine). v1.5
  // Phase 55 deliberately edits that engine ONCE (the coverage-window blend), so
  // the freeze is RETIRED here as a reviewed act — NOT inverted to a `.toContain`
  // delta pin, which would go red on every future phase branch once this merges
  // and the merge-base advances past the edit (scenario.ts naturally leaves each
  // later delta). scenario.ts is now protected by scenario.test.ts's own pins +
  // the BLEND-07 numpy gate; this guard retains its baseline-ref resolution check
  // (Rule 12) as its remaining exit-gate value.
});
