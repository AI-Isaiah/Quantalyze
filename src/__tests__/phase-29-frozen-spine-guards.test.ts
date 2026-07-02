/**
 * Phase 29 (Unified Composer Spine) — frozen-spine exit-gate guard.
 *
 * v1.2 Allocator Cohesion is a unification / wiring / routing milestone with
 * ZERO `scenarios` schema change and a FROZEN projection engine. Three exit
 * gates protect that invariant, and all three FAIL SILENTLY (ship GREEN)
 * unless a content/diff-inspecting test catches them — they are the
 * milestone's defining risk (see ROADMAP Phase 29 Exit Gates, 29-RESEARCH
 * Pitfall 3, PROJECT.md "silent-failure risk profile"):
 *
 *   1. NO new migration under `supabase/migrations/` touching
 *      `scenarios` / `scenario_shares` / `get_shared_scenario` /
 *      `create_scenario_share` ships in this phase. A "named portfolio" is a
 *      `scenarios` row — it needs no DDL. Any new `*scenario*`/`*share*`
 *      migration is the red flag.
 *   2. `src/lib/scenario.ts` has ZERO diff vs the phase baseline — the
 *      frozen engine (SCENARIO-05; the 252-day annualization pins in
 *      `scenario.test.ts`). The example-add path flows through the unchanged
 *      adapter; the engine is never edited.
 *   3. The RLS sql honesty tests (`supabase/tests/test_scenarios_rls.sql`,
 *      `supabase/tests/test_scenario_shares_rls.sql`) stay byte-unchanged —
 *      they are the SOLE proof the `scenarios`/`scenario_shares` RLS + the
 *      `get_shared_scenario` SECURITY DEFINER read path were not loosened.
 *
 * HOW IT WORKS
 * ------------
 * The guard reads the REAL git delta for the phase: every file added or
 * changed between the phase baseline (the merge-base with origin/main) and
 * HEAD, PLUS untracked-but-not-ignored files (a stray new migration may be
 * uncommitted). It is a pure git/file inspection — no network, no Supabase
 * round-trip — and runs in well under 2s.
 *
 * NON-VACUITY
 * -----------
 * The delta is computed from `git diff`/`git ls-files`, never a hardcoded
 * list. Verified once during authoring: `touch
 * supabase/migrations/29_test_scenario_dummy.sql` makes assertion (a) FAIL
 * (the file lands in the added set and matches /scenario/i), then `rm`
 * restores green. A future scenarios migration, a scenario.ts edit, or an
 * RLS-sql edit each trip the corresponding assertion.
 *
 * FAIL-LOUD (project CLAUDE.md Rule 12)
 * -------------------------------------
 * If the baseline ref cannot be resolved AT ALL (no origin/main merge-base
 * AND no fallback base sha reachable), the guard THROWS with an actionable
 * message — it never silently passes / skips. A guard that can't see the
 * delta is worse than no guard, so it must go red, not green.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const CWD = process.cwd();

/**
 * The phase branch point on origin/main at planning time (29-05-PLAN.md
 * <interfaces>). Used ONLY as a fallback when `git merge-base origin/main
 * HEAD` cannot be computed (e.g. a shallow CI clone with no origin/main ref).
 * If even this sha is unreachable, the guard fails loud rather than skipping.
 */
const FALLBACK_BASE_SHA = "a759022c";

/**
 * Run git with an argument array (no shell — execFileSync, not execSync), so
 * no value is ever interpolated into a shell string. Trimmed; throws on
 * non-zero exit.
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
 * (correct in CI and locally); fall back to the documented branch-point sha
 * if origin/main is absent; FAIL LOUD if neither resolves (Rule 12 — never
 * a silent skip).
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
    "Phase 29 frozen-spine guard could not resolve a baseline ref: neither " +
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
 *   - `git ls-files --others --exclude-standard` — untracked, not-ignored
 *     files (a new migration / RLS-sql edit may still be uncommitted; src &
 *     supabase files are tracked but a brand-new one shows up here first).
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

// Forbidden-set pattern for new scenarios/share migrations. The locked set is
// scenarios / scenario_shares / get_shared_scenario / create_scenario_share;
// every one matches /scenario|share/i, so that single pattern is the gate.
const FORBIDDEN_MIGRATION_RE = /scenario|share/i;

const RLS_SQL_SCENARIOS = "supabase/tests/test_scenarios_rls.sql";
const RLS_SQL_SHARES = "supabase/tests/test_scenario_shares_rls.sql";

describe("Phase 29 frozen-spine exit-gate guards", () => {
  it("resolves a real phase baseline ref (fails loud if it cannot — Rule 12)", () => {
    // `resolveBaselineRef()` already threw at module load if unresolvable, so
    // reaching here proves a base was found. Pin the invariant explicitly so
    // a future refactor that swallows the error is caught.
    expect(BASE, "phase baseline ref must resolve to a non-empty sha").toBeTruthy();
    expect(typeof BASE).toBe("string");
  });

  it("exit gate (no-schema-change): no new scenarios/share migration shipped this phase", () => {
    const offendingMigrations = CHANGED.filter(
      (f) =>
        f.startsWith("supabase/migrations/") &&
        FORBIDDEN_MIGRATION_RE.test(f),
    );
    expect(
      offendingMigrations,
      "Phase 29 exit gate VIOLATED — a new/changed migration touching " +
        "scenarios / scenario_shares / get_shared_scenario / " +
        "create_scenario_share landed in the phase delta. v1.2 requires " +
        "ZERO `scenarios` schema change; a 'named portfolio' is a `scenarios` " +
        "row, not new DDL. Remove the migration (ROADMAP Phase 29 Exit Gates, " +
        "29-RESEARCH Pitfall 3). Offending files: " +
        offendingMigrations.join(", "),
    ).toEqual([]);
  });

  // v1.5 coverage-window re-baseline (ADR-001): the frozen-engine assertion
  // (scenario.ts SCENARIO-05 zero-diff) was RETIRED here as a reviewed act —
  // v1.5 Phase 55 deliberately edits the projection engine ONCE (the
  // coverage-window blend). It is NOT inverted to a `.toContain` delta pin:
  // that goes red on every future phase branch once this merges and the
  // merge-base advances past the edit (scenario.ts naturally leaves each later
  // delta). scenario.ts is now protected by scenario.test.ts's own pins + the
  // BLEND-07 numpy gate.
  //
  // v1.5 Phase 59 (PERSIST-02) re-baseline: the `test_scenario_shares_rls.sql`
  // BYTE-UNCHANGED pin is likewise RETIRED as a reviewed act. Phase 59 persists
  // the coverage window inside the shared `draft` JSONB and must ADDITIVELY
  // extend this leak-scan (seed a windowed draft + a POSITIVE round-trip
  // assertion). The real protective value of the gate — proof the SECDEF read
  // path was NOT LOOSENED into an over-return leak — is preserved by pinning
  // the file's NEGATIVE content-by-field over-return guard regex as
  // still-present-and-unweakened, rather than the whole file's bytes. The
  // `test_scenarios_rls.sql` byte-unchanged pin (a file this phase does NOT
  // touch) stays intact.
  it("exit gate (scenarios RLS untouched): test_scenarios_rls.sql is byte-unchanged", () => {
    expect(
      CHANGED,
      `Phase 29 exit gate VIOLATED — ${RLS_SQL_SCENARIOS} changed in the ` +
        "phase delta. That file is the SOLE honesty proof the `scenarios` " +
        "RLS predicate was not loosened (it FAILS SILENTLY otherwise). It " +
        "must stay byte-unchanged this phase.",
    ).not.toContain(RLS_SQL_SCENARIOS);
  });

  it("exit gate (share SECDEF not loosened): the shares leak-scan's negative over-return guard is still present and unweakened", () => {
    // Additive extension is allowed (v1.5 PERSIST-02 window round-trip); a
    // LOOSENING of the negative over-return guard is not. Pin the exact
    // forbidden-field regex the leak-scan uses so any weakening (dropping a
    // field from the alternation, deleting the guard) goes red here even though
    // the file is no longer byte-frozen.
    const sharesSql = readFileSync(
      path.resolve(CWD, RLS_SQL_SHARES),
      "utf8",
    );
    expect(
      sharesSql,
      `Phase 29/59 exit gate VIOLATED — the ${RLS_SQL_SHARES} negative ` +
        "over-return guard (api_key|allocated_amount|account_balance|value_usd) " +
        "is missing or weakened. That guard is the SOLE content-level proof the " +
        "`get_shared_scenario` SECURITY DEFINER read path was not loosened into " +
        "a live-book over-return leak. It must stay intact; PERSIST-02 may only " +
        "ADD assertions around it.",
    ).toContain("api_key|allocated_amount|account_balance|value_usd");
  });
});
