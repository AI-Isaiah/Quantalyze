/**
 * `neuterArm` — the abort-path cleanup must be neutered WITH the RAISE.
 *
 * WHY THIS FILE EXISTS. MEASURED 2026-08-29 (plan 164.3-08, first full-corpus
 * run): neutering only the `RAISE EXCEPTION` left the failure branch's
 * `RESET ROLE;` executing. In `supabase/tests/test_strategy_shares_rls.sql` the
 * neutered arm's branch reads
 *
 *     IF NOT raised OR err_msg NOT LIKE '%AT MOST ONE%' THEN
 *       RESET ROLE;
 *       RAISE EXCEPTION 'TEST FAILED (N1 1a): …';
 *     END IF;
 *
 * and it DOES execute under the mutation that neuters it — that is precisely
 * why the arm needed neutering. The session therefore dropped from
 * `authenticated` to the superuser session role for the entire rest of the
 * file, and sixteen arms later `NO-DELETE 1`'s `DELETE FROM strategy_shares`
 * succeeded because a superuser needs no grant. The runner reported
 * `wrong-first-failure: NO-DELETE 1`.
 *
 * ⚠️ IT WAS LOUD ONLY BY LUCK. A leaked superuser role makes every downstream
 * GRANT arm pass for a reason unrelated to the grant — a vacuous PASS inside
 * the vacuity detector. Phase 164.4 backfills seventy more files against this
 * primitive, so the guard is pinned here rather than left to the corpus.
 *
 * ⭐ ANTI-VACUITY. These cases fail when the absorption loop in `neuterArm` is
 * removed: case 1 then finds a live `RESET ROLE;` outside the neutered range.
 * Verified by single-point neuter on 2026-08-29 — see the SUMMARY.
 */
import { describe, expect, it } from "vitest";

import { neuterArm } from "../../scripts/mutation-runner/run.mjs";

/**
 * Executable (non-comment) lines matching a pattern. `run.mjs` is untyped, so
 * the text is narrowed to `string` here rather than letting `any` propagate —
 * an `any` would make every assertion below type-check vacuously.
 */
function executableLines(text: string, pattern: RegExp): string[] {
  return text
    .split("\n")
    .filter((l: string) => !/^[ \t]*--/.test(l))
    .filter((l: string) => pattern.test(l));
}

/** The exact shape the real corpus uses for a role-scoped arm. */
const WITH_RESET = [
  "  IF NOT raised THEN",
  "    RESET ROLE;",
  "    RAISE EXCEPTION 'TEST FAILED (ARM A): it did not bite';",
  "  END IF;",
  "  SELECT 1;",
].join("\n");

/** The same arm with no cleanup — nothing extra may be swallowed. */
const WITHOUT_RESET = [
  "  IF NOT raised THEN",
  "    RAISE EXCEPTION 'TEST FAILED (ARM B): it did not bite';",
  "  END IF;",
  "  RESET ROLE;",
].join("\n");

describe("neuterArm absorbs the abort-path RESET ROLE", () => {
  it("leaves no executable RESET ROLE inside the neutered branch", () => {
    const result = neuterArm(WITH_RESET, "ARM A");
    expect(result.found).toBe(true);

    expect(
      executableLines(result.text, /RESET\s+ROLE/i),
      "the neutered branch still runs RESET ROLE, which leaks a superuser session into every later arm",
    ).toEqual([]);
  });

  it("comments the RESET ROLE out rather than deleting it, so the mutation is readable", () => {
    const result = neuterArm(WITH_RESET, "ARM A");
    expect(result.text).toContain("-- NEUTERED(ARM A)     RESET ROLE;");
    expect(result.text).toContain("-- NEUTERED(ARM A)     RAISE EXCEPTION 'TEST FAILED (ARM A)");
    // The branch keeps a non-empty body.
    expect(result.text).toContain("NULL; -- neutered ARM A by the mutation runner");
  });

  it("still neuters the RAISE itself — absorbing the cleanup must not shorten the range", () => {
    const result = neuterArm(WITH_RESET, "ARM A");
    expect(
      executableLines(result.text, /RAISE\s+EXCEPTION/i),
      "the RAISE survived — a neuter that silently did nothing is worse than none",
    ).toEqual([]);
  });

  it("swallows nothing when the branch carries no cleanup", () => {
    const result = neuterArm(WITHOUT_RESET, "ARM B");
    expect(result.found).toBe(true);
    // The trailing RESET ROLE belongs to the surrounding code, not the branch.
    expect(executableLines(result.text, /RESET\s+ROLE/i)).toEqual(["  RESET ROLE;"]);
  });

  it("reports found:false for an arm that is not there, never a silent no-op", () => {
    const result = neuterArm(WITH_RESET, "ARM MISSING");
    expect(result.found).toBe(false);
    expect(result.text).toBe(WITH_RESET);
  });
});
