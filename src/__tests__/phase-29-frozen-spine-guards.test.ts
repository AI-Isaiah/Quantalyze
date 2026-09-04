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
 * ⚠️ `.planning/` is TRACKED in this repo (.gitignore:53-63 — untracked
 * planning silently breaks the parallel-executor worktrees), so it DOES land
 * in the delta. This comment used to claim the opposite. It is harmless only
 * because every caller filters on a `supabase/` or `src/` prefix first; do not
 * remove those prefix filters on the strength of the old claim.
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

// The locked scenario spine, as the guard's own header names it. These are
// matched against the migration's comment-stripped CONTENT — see below.
//
// Word boundaries are load-bearing. `\bscenarios\b` does NOT match
// `scenario_shares` (underscore is a word character), so each locked object is
// listed explicitly rather than relying on one substring to cover all four. It
// also means the unrelated `scenario_commit_idempotency` /
// `scenario_downgrade_sweep` objects do not trip the gate.
const SCENARIO_SPINE_IDENTIFIERS = [
  "scenarios",
  "scenario_shares",
  "get_shared_scenario",
  "create_scenario_share",
] as const;

const SPINE_CONTENT_RE = new RegExp(
  `\\b(?:${SCENARIO_SPINE_IDENTIFIERS.join("|")})\\b`,
  "i",
);

// 2026-08-27 — NARROWED from `/scenario|share/i` (Phase 164, plan 164-02;
// FOUNDER RULING D-05, 164-CONTEXT.md "Blocker 1"). The `share` alternative was
// REDUNDANT for the locked set — all four locked names already match
// /scenario/i — and it false-positived on `strategy_shares`, an unrelated table
// (Phase 164's per-strategy factsheet share) whose migration filename merely
// contains the substring "share".
//
// 2026-08-27, SAME DAY — REGATED ONTO CONTENT (finding M6). The narrowing above
// left a FILENAME-only test, and a filename is not the object being frozen.
// MEASURED: a migration named `..._share_link_ttl.sql` or
// `..._add_expiry_to_shares.sql` sailed straight through — and those are exactly
// the names a genuine `ALTER TABLE scenario_shares` migration would plausibly
// carry, so the gate could be walked past by an author who was not even trying.
// The guard's own header calls a rename-dodge dishonest; under a filename-only
// test EVERY name was a dodge, including honest ones. Reading the DDL closes
// both directions at once: a spine-touching migration is caught under any
// filename, and a migration that merely has "scenario" in its NAME while
// touching nothing locked no longer false-positives.
//
// ⛔ The REJECTED alternative remains rejected: renaming a migration to dodge a
// substring satisfies CI without satisfying the gate. It is now also USELESS,
// which is the better kind of prohibition.
//
// Comments are stripped before matching, for the H-1019 reason the GDPR hook
// learned the hard way — a `-- ... scenario_shares ...` line that merely
// DOCUMENTS a neighbouring object is prose, and prose is not DDL. MEASURED on
// this phase's migration (20260827120000_strategy_shares_generation_model.sql):
// zero spine hits after stripping, so the real change passes cleanly.
//
// ⚠️ Cross-phase: Phase 164.1 ("retire the frozen-spine gates that no longer
// bite") must treat this as the already-done 164 slice — see ROADMAP.md, Phase
// 164.1 "Cross-phase note from Phase 164 planning (2026-08-26)". Do NOT edit
// this guard a third time with a third rationale.

/**
 * Strip SQL comments so a documentation line cannot be read as DDL. Line
 * comments and block comments both go; block comments become a newline so line
 * structure survives.
 */
function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "\n").replace(/--[^\n]*/g, "");
}

/**
 * Does this changed migration actually TOUCH the frozen scenario spine?
 *
 * Reads the working-tree file. A path in the delta that cannot be read is a
 * DELETED migration, and deleting a migration is at least as serious as
 * editing one.
 *
 * ⚠️ THE FALLBACK USED TO CONTRADICT ITS OWN DOCBLOCK (finding L1, 2026-08-27).
 * It returned `/scenario/i.test(file)` while claiming "FAIL LOUD (Rule 12): an
 * unreadable path is never treated as clean". Those are incompatible: a deleted
 * migration that CREATED `scenario_shares` but whose filename lacks the
 * substring "scenario" returned false and was waved through silently — the
 * exact rename-dodge the header above calls dishonest, arriving through the
 * back door.
 *
 * Two honest answers were available and the weaker one is not used: the deleted
 * file's content still exists at the baseline ref, so the REAL question ("did
 * it touch the spine?") is answerable rather than guessable. Read it out of git
 * and apply the same content rule. Only if git cannot produce the blob either
 * — no content anywhere, nothing left to reason about — does this return TRUE
 * unconditionally. Suspect-by-default is what the docblock always promised;
 * a false positive costs one human glance at a deleted migration, a false
 * negative ships an unguarded spine change.
 */
function touchesScenarioSpine(file: string): boolean {
  try {
    return SPINE_CONTENT_RE.test(
      stripSqlComments(readFileSync(path.resolve(CWD, file), "utf8")),
    );
  } catch {
    // Not in the working tree — deleted. Recover the content from the baseline.
  }
  try {
    return SPINE_CONTENT_RE.test(
      stripSqlComments(git(["show", `${BASE}:${file}`])),
    );
  } catch {
    // No readable content in the working tree OR at the baseline. Nothing can
    // be established, so the path is SUSPECT, never clean.
    return true;
  }
}

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

  describe("touchesScenarioSpine: an unreadable path is SUSPECT, never clean", () => {
    // Finding L1 (2026-08-27). The deleted-file fallback returned
    // `/scenario/i.test(file)` under a docblock promising "an unreadable path
    // is never treated as clean" — so a deleted migration that had CREATED
    // `scenario_shares` under a filename without the substring "scenario" was
    // waved straight through. The gate reads DDL precisely so a filename cannot
    // decide the verdict; the fallback handed the decision back to the filename.

    it("reads spine content out of the working tree when the file is present", () => {
      // Limb 1, and the non-vacuity anchor: if this stops returning true the
      // two cases below prove nothing, because everything would read as
      // suspect for the wrong reason.
      expect(
        touchesScenarioSpine(
          "supabase/migrations/20260622120000_scenario_shares_and_read_rpc.sql",
        ),
        "the real scenario_shares migration is no longer detected as spine-" +
          "touching — SPINE_CONTENT_RE or the file has moved",
      ).toBe(true);
      expect(
        touchesScenarioSpine(
          "supabase/migrations/20260827120000_strategy_shares_generation_model.sql",
        ),
        "Phase 164's strategy_shares migration false-positived — it touches no " +
          "locked object and the word-boundary narrowing exists to keep it out",
      ).toBe(false);
    });

    it("a path readable NOWHERE is treated as suspect, whatever its filename", () => {
      // Limb 3, and the L1 pin. This filename deliberately does NOT contain
      // "scenario": under the old fallback it returned FALSE and the deletion
      // shipped silently. A verdict that cannot be established must not be
      // established as clean.
      expect(
        touchesScenarioSpine(
          "supabase/migrations/20990101000000_no_such_file_anywhere.sql",
        ),
        "an unreadable path was reported as NOT touching the spine. Nothing " +
          "can be read at the working tree or the baseline, so nothing is " +
          "known — and the docblock promises suspect-by-default (Rule 12).",
      ).toBe(true);
    });

    it("the baseline-recovery limb it falls back to can actually read a deleted file's content", () => {
      // Limb 2. It cannot be triggered through touchesScenarioSpine() today
      // (this branch deletes no migration — `git diff --diff-filter=D` is
      // empty), so what is pinned is the mechanism the limb depends on: that a
      // migration's content is recoverable from BASE and yields the same
      // verdict as reading it from disk. If `git show <base>:<path>` ever stops
      // working, limb 2 silently degrades into limb 3 and every deletion reads
      // as suspect — noisy rather than unsafe, but worth knowing.
      const recovered = git([
        "show",
        `${BASE}:supabase/migrations/20260622120000_scenario_shares_and_read_rpc.sql`,
      ]);
      expect(recovered.length).toBeGreaterThan(0);
      expect(SPINE_CONTENT_RE.test(stripSqlComments(recovered))).toBe(true);
    });
  });

  it("exit gate (no-schema-change): no new scenario-spine migration shipped this phase", () => {
    const offendingMigrations = CHANGED.filter(
      (f) => f.startsWith("supabase/migrations/") && touchesScenarioSpine(f),
    );
    expect(
      offendingMigrations,
      "Phase 29 exit gate VIOLATED — a new/changed migration whose " +
        "comment-stripped DDL references the frozen scenario spine (" +
        SCENARIO_SPINE_IDENTIFIERS.join(" / ") +
        ") landed in the phase delta. v1.2 requires ZERO `scenarios` schema " +
        "change; a 'named portfolio' is a `scenarios` row, not new DDL. Remove " +
        "the migration (ROADMAP Phase 29 Exit Gates, 29-RESEARCH Pitfall 3). " +
        "⛔ Renaming the file does NOT clear this gate — it reads the SQL, not " +
        "the filename. Offending files: " +
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
  // `test_scenarios_rls.sql` pin stays intact but is TIGHTENED — see below.
  //
  // v0.77 Phase 164.4 (REDUNDER-BACKFILL) re-baseline, founder-decided
  // 2026-09-04: this pin used to assert that the FILENAME never appears in the
  // phase delta. That is a proxy for the thing Phase 29 actually wanted — the
  // file's EXECUTABLE content frozen — and the proxy is both too coarse and
  // too weak. Too coarse: Phase 164.4 adds whole-line `RED-UNDER` comments to
  // every gate file so a mutation runner can prove each arm can actually fail,
  // and a comment cannot loosen an RLS predicate. Too weak: a filename check
  // says only WHERE nothing may change, never WHAT.
  //
  // So the pin now compares the file's NON-COMMENT lines against the baseline
  // and requires them byte-identical. A loosened `scenarios` RLS predicate
  // still fails this gate exactly as it did before; only whole-line comments
  // may move. This is the same filter the phase's own audit runs each wave
  // (added non-comment lines across `supabase/tests/` must be 0).
  //
  // ⚠️ The filter drops a line only when its FIRST non-whitespace characters
  // are `--`, and keeps every other line WHOLE. It never strips mid-line, so a
  // `--` inside a string literal (`RAISE EXCEPTION 'a -- b'`) is untouched and
  // cannot be used to smuggle an executable change past the comparison.
  it("exit gate (scenarios RLS untouched): test_scenarios_rls.sql is byte-unchanged in every NON-COMMENT line", () => {
    // Trailing whitespace is normalised on BOTH sides before splitting: the
    // `git()` helper trims its output, while `readFileSync` keeps the file's
    // final newline, so an un-normalised compare reports a phantom one-line
    // difference on every invocation. Symmetric, so it hides no real edit.
    const executableLines = (sql: string): string[] =>
      sql
        .replace(/\s+$/, "")
        .split("\n")
        .filter((line) => !/^\s*--/.test(line));

    const baseline = git(["show", `${BASE}:${RLS_SQL_SCENARIOS}`]);
    const current = readFileSync(path.resolve(CWD, RLS_SQL_SCENARIOS), "utf8");

    expect(
      executableLines(current),
      `Phase 29 exit gate VIOLATED — ${RLS_SQL_SCENARIOS} changed in a ` +
        "NON-COMMENT line. That file is the SOLE honesty proof the " +
        "`scenarios` RLS predicate was not loosened (it FAILS SILENTLY " +
        "otherwise). Comment-only annotation is allowed; executable SQL is " +
        "frozen.",
    ).toEqual(executableLines(baseline));
  });

  it("exit gate (share SECDEF not loosened): the shares leak-scan's negative over-return guard is still present and unweakened", () => {
    // Additive extension is allowed (v1.5 PERSIST-02 window round-trip); a
    // LOOSENING of the negative over-return guard is not.
    //
    // Review CR-02: the pinned substring occurs in THREE places in the SQL file
    // — the header comment, the operative `IF payload_text ~ '...' THEN` guard,
    // and the RAISE EXCEPTION message. A bare-alternation `.toContain` is
    // satisfied by the comment alone, so weakening or deleting the guard line
    // stayed GREEN (a vacuous pin). Pin the OPERATIVE guard line verbatim —
    // comments and messages cannot satisfy it — and belt-and-braces the
    // occurrence count so deleting ANY of the three (comment, guard, message)
    // is a reviewed act.
    const sharesSql = readFileSync(
      path.resolve(CWD, RLS_SQL_SHARES),
      "utf8",
    );
    expect(
      sharesSql,
      `Phase 29/59 exit gate VIOLATED — the ${RLS_SQL_SHARES} negative ` +
        "over-return guard (the operative `IF payload_text ~ " +
        "'api_key|allocated_amount|account_balance|value_usd' THEN` line) " +
        "is missing or weakened. That guard is the SOLE content-level proof the " +
        "`get_shared_scenario` SECURITY DEFINER read path was not loosened into " +
        "a live-book over-return leak. It must stay intact; PERSIST-02 may only " +
        "ADD assertions around it.",
    ).toContain(
      "IF payload_text ~ 'api_key|allocated_amount|account_balance|value_usd' THEN",
    );
    const alternationOccurrences = (
      sharesSql.match(
        /api_key\|allocated_amount\|account_balance\|value_usd/g,
      ) ?? []
    ).length;
    expect(
      alternationOccurrences,
      `Phase 29/59 exit gate VIOLATED — the forbidden-field alternation ` +
        `appears ${alternationOccurrences}x in ${RLS_SQL_SHARES} (expected >= 3: ` +
        "header comment, operative IF guard, RAISE EXCEPTION message). An " +
        "occurrence was removed — deleting any of them must be a reviewed act.",
    ).toBeGreaterThanOrEqual(3);
  });
});
