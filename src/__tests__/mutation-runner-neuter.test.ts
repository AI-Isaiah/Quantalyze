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

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ABSORBABLE_CLEANUP, neuterArm } from "../../scripts/mutation-runner/run.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

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

describe("WR-07 — an abort-path statement it cannot classify is REFUSED, not leaked", () => {
  // The absorbed set is one literal statement, and the header above says the
  // RESET ROLE leak "was loud only by luck". Any other cleanup in an abort
  // branch — RESET search_path, SET ROLE postgres, PERFORM set_config(…),
  // ROLLBACK TO SAVEPOINT, a REVOKE — produces the identical silent leak into
  // every later arm, and the loop absorbed none of them and said nothing.
  //
  // Refusing turns that leak into a NAMED `neuter-missed` defect. Louder is
  // the whole point: a leak makes downstream arms pass for the wrong reason,
  // which is a vacuous PASS inside the vacuity detector.

  const LEAKY = (cleanup: string) =>
    [
      "  IF NOT raised THEN",
      `    ${cleanup}`,
      "    RAISE EXCEPTION 'TEST FAILED (ARM C): it did not bite';",
      "  END IF;",
      "  SELECT 1;",
    ].join("\n");

  const UNCLASSIFIABLE = [
    "RESET search_path;",
    "SET ROLE postgres;",
    "PERFORM set_config('request.jwt.claims', NULL, true);",
    "ROLLBACK TO SAVEPOINT s;",
    "EXECUTE 'REVOKE EXECUTE ON FUNCTION public.f(UUID) FROM service_role';",
  ];

  for (const cleanup of UNCLASSIFIABLE) {
    it(`refuses "${cleanup}" instead of leaving it live`, () => {
      const result = neuterArm(LEAKY(cleanup), "ARM C");
      expect(
        result.found,
        `neuterArm accepted an abort branch carrying "${cleanup}". Neutering only the RAISE leaves ` +
          `it executing for the rest of the file.`,
      ).toBe(false);
      expect(result.reason).toContain("unrecognised statement before its RAISE");
      expect(result.reason).toContain(cleanup);
      // Refusal must not mutate the text — a half-applied neuter is worse than
      // either outcome.
      expect(result.text).toBe(LEAKY(cleanup));
    });
  }

  it("still accepts the one shape it is allowed to absorb, and only that one", () => {
    // Pinned so widening the absorbed set is a visible edit to an exported
    // constant, reviewed on its own terms, rather than a regex tweak.
    expect(ABSORBABLE_CLEANUP.source).toBe("^[ \\t]*RESET[ \\t]+ROLE[ \\t]*;[ \\t]*$");
    expect(neuterArm(WITH_RESET, "ARM A").found).toBe(true);
  });

  it("blank lines and whole-line comments before the RAISE are not statements", () => {
    const text = [
      "  IF NOT raised THEN",
      "    -- an explanatory comment",
      "",
      "    RAISE EXCEPTION 'TEST FAILED (ARM D): it did not bite';",
      "  END IF;",
    ].join("\n");
    expect(neuterArm(text, "ARM D").found).toBe(true);
  });

  it("REAL CORPUS: it refuses the four SERVICE-ROLE arms whose branches REVOKE before raising, and nothing else", () => {
    // Measured, not asserted in the abstract. SERVICE-ROLE 2a-2d each drop two
    // `EXECUTE 'REVOKE EXECUTE ON FUNCTION … FROM service_role'` statements
    // before their RAISE. Neutering only the RAISE would revoke the grant that
    // arms 2b/2c/2d themselves depend on, so every one of them would then fail
    // with "permission denied" instead of for its real reason — the RESET ROLE
    // class exactly. None of these arms is currently a neuter target, which is
    // why the corpus still runs 30/30.
    const gate = readFileSync(
      join(REPO_ROOT, "supabase", "tests", "test_strategy_shares_rls.sql"),
      "utf8",
    );
    const armIds = [...new Set([...gate.matchAll(/TEST FAILED \(([^)]*)\)/g)].map((m) => m[1]))];
    expect(armIds.length).toBeGreaterThan(50);

    const refused = armIds.filter((arm) => {
      const r = neuterArm(gate, arm);
      return !r.found && /unrecognised statement before its RAISE/.test(r.reason ?? "");
    });
    expect(refused.sort()).toEqual([
      "SERVICE-ROLE 2a",
      "SERVICE-ROLE 2b",
      "SERVICE-ROLE 2c",
      "SERVICE-ROLE 2d",
    ]);
  });

  it("REAL CORPUS: every arm the annotations actually ASK to neuter is still classifiable", () => {
    // The refusal above must not have broken the corpus. This asserts the
    // property the full runner proves at 30/30, without needing PostgreSQL.
    const gate = readFileSync(
      join(REPO_ROOT, "supabase", "tests", "test_strategy_shares_rls.sql"),
      "utf8",
    );
    const twin = /^[ \t]*--[ \t]*RED-UNDER-M:[ \t]*(\{.*\})[ \t]*$/;
    const targets = new Set<string>();
    for (const line of gate.split("\n")) {
      const m = twin.exec(line);
      if (m === null) continue;
      const parsed = JSON.parse(m[1]) as { neuter?: Array<{ arm: string }> };
      for (const n of parsed.neuter ?? []) targets.add(n.arm);
    }
    expect(targets.size).toBeGreaterThan(0);
    for (const arm of targets) {
      const r = neuterArm(gate, arm);
      expect(r.found, `neuterArm refused "${arm}", which an annotation asks it to neuter: ${r.reason}`).toBe(
        true,
      );
    }
  });
});
