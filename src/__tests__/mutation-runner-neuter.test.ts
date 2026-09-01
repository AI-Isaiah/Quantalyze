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

import { ABSORBABLE_CLEANUP, BRANCH_HEAD_WORDS, neuterArm } from "../../scripts/mutation-runner/run.mjs";

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

  // ══════════════════════════════════════════════════════════════════════════
  // R3-C01 — THE ORACLE QUANTIFIES OVER THE CLASS, IT DOES NOT ENUMERATE IT
  // ══════════════════════════════════════════════════════════════════════════
  //
  // ⛔ THIS BLOCK REPLACES A TEST THAT LOOKED LIKE AN ORACLE AND WAS NOT. Its
  // predecessor was titled "INDEPENDENT ORACLE: no accepted neuter may leave a
  // SET ROLE live" and was quantified over FIVE HAND-PICKED `--` comments. Two
  // review rounds in a row closed the ONE embedding the reviewer had
  // demonstrated and then declared the class closed; round 3 reached the same
  // `SET ROLE` leak in minutes with three embeddings nobody had listed — a
  // keyword in a single-quoted literal, in a block comment, and in a
  // dollar-quoted body. A test that enumerates five instances is not an oracle
  // over a class.
  //
  // So the inputs are GENERATED as a cross-product:
  //
  //     BRANCH_HEAD_WORDS  (imported from run.mjs — the implementation's own
  //                         keyword list, so adding a keyword there widens
  //                         this test automatically)
  //   x EMBEDDINGS         (every syntactic context a keyword can sit in and
  //                         NOT be a branch head)
  //
  // and the assertion is the leak class stated directly over the OUTPUT: no
  // accepted neuter may leave a session-role change executing. Both directions
  // are asserted — a genuine BARE-CODE branch head must still terminate the
  // scan — so the fix cannot be "passed" by never terminating, which would
  // refuse every arm in the real corpus.
  //
  // ⭐ THE LINE-LOCAL CONSTRAINT IS LIFTED (phase 164.3.1). This block used to
  // say: "the embeddings are LINE-LOCAL. A literal, block comment or
  // dollar-quoted body whose delimiters straddle a newline is not generated
  // here, because `executableText` is a line classifier and would leave a
  // fragment — which refuses (the loud direction), not leaks. A multi-line
  // masking pass is a real remaining gap and is named in the fix report."
  //
  // That gap is closed: the classifier is a STATEMENT TOKENIZER carrying every
  // lexical state ACROSS lines, so the multi-line embeddings are now
  // generated too (MULTILINE_EMBEDDINGS below) and asserted against the same
  // leak class. The stated scope was true when written and is kept here rather
  // than deleted, because the record of what a control did NOT cover is what
  // makes the next reader check instead of assume.

  /**
   * Every syntactic context in which a branch-head keyword is NOT a branch
   * head. Each returns a single SQL line carrying `word` in that context.
   */
  const EMBEDDINGS: Record<string, (word: string) => string> = {
    "line comment": (w) => `-- now raise the ${w.toLowerCase()} the harness looks for`,
    "line comment, no space": (w) => `--${w} abort`,
    "block comment": (w) => `/* now raise the ${w.toLowerCase()} the harness looks for */`,
    "single-quoted literal": (w) => `PERFORM run_sql('${w}');`,
    "literal mid-sentence": (w) => `PERFORM set_config('x', 'a ${w} b', false);`,
    "dollar-quoted, tagged": (w) => `EXECUTE $q$ ${w} junk int; $q$;`,
    "dollar-quoted, bare": (w) => `EXECUTE $$ ${w} junk int; $$;`,
  };

  /**
   * The same class, with the non-code region STRADDLING NEWLINES — the three
   * R3 residual shapes plus the general form. Each returns a MULTI-LINE
   * fragment whose interior carries `word` where PostgreSQL reads no code.
   *
   * The old line-local reader saw the interior lines raw: a body line reading
   * exactly `BEGIN`, or one ending in `THEN`, was read as a branch head and
   * TERMINATED the scan — the leak; and the closing `$q$;` / `*\/` fragment
   * was read as an unclassifiable statement — the spurious refusal. Both
   * directions are the same defect, and both are generated here.
   */
  const MULTILINE_EMBEDDINGS: Record<string, (word: string) => string> = {
    "multi-line block comment": (w) => `/* explanatory\n${w}\n*/`,
    "multi-line single-quoted literal": (w) => `PERFORM set_config('x', 'a\n${w}\nb', false);`,
    "multi-line dollar-quoted body, tagged": (w) => `EXECUTE $q$\n${w}\n$q$;`,
    "multi-line dollar-quoted body, bare": (w) => `EXECUTE $$\n${w}\n$$;`,
    "R3 residual: dollar body whose interior line is a declaration": (w) =>
      `EXECUTE $q$\n${w} junk int;\n$q$;`,
  };

  /**
   * The BARE-CODE spelling of each keyword: the line that genuinely IS a
   * branch head, and on which the scan MUST terminate. Keyed by the same list
   * the implementation exports, so a keyword added there without a bare-code
   * spelling here fails the completeness assertion below rather than silently
   * dropping out of the cross-product.
   */
  const BARE_CODE: Record<string, string> = {
    THEN: "IF NOT raised THEN",
    BEGIN: "BEGIN",
    ELSE: "ELSE",
    ELSIF: "ELSIF raised THEN",
    LOOP: "FOR r IN SELECT 1 LOOP",
    DECLARE: "DECLARE",
    EXCEPTION: "EXCEPTION WHEN others THEN",
  };

  it("the cross-product is generated from the implementation's own keyword list", () => {
    // Non-vacuity guard. If BRANCH_HEAD_WORDS were empty, or a keyword had no
    // bare-code spelling, every generated arm below would silently vanish and
    // the file would still report green.
    expect(BRANCH_HEAD_WORDS.length).toBeGreaterThan(0);
    expect(Object.keys(BARE_CODE).sort()).toEqual([...BRANCH_HEAD_WORDS].sort());
    expect(Object.keys(EMBEDDINGS).length).toBeGreaterThan(0);
    expect(Object.keys(MULTILINE_EMBEDDINGS).length).toBeGreaterThan(0);
  });

  for (const word of BRANCH_HEAD_WORDS) {
    for (const [embedding, render] of Object.entries(EMBEDDINGS)) {
      it(`ORACLE: "${word}" in a ${embedding} must not end the scan`, () => {
        const line = render(word);
        const text = [
          "  IF NOT raised THEN",
          "    SET ROLE postgres;",
          `    ${line}`,
          "    RAISE EXCEPTION 'TEST FAILED (ARM E): it did not bite';",
          "  END IF;",
          "  SELECT 1;",
        ].join("\n");

        const result = neuterArm(text, "ARM E");

        // The leak class, stated over the OUTPUT rather than over the scan's
        // own rules: an accepted neuter that leaves a session-role change live
        // is the measured RESET ROLE defect, whatever terminated the scan.
        const leaked = result.found && executableLines(result.text, /SET\s+ROLE/i).length > 0;
        expect(
          leaked,
          `neuterArm ACCEPTED the neuter and left "SET ROLE postgres;" executing. The only thing ` +
            `between it and the RAISE was ${JSON.stringify(line)} — a ${embedding}, which is not ` +
            `executable code and must never terminate the backward scan.`,
        ).toBe(false);

        // And it must refuse LOUDLY, naming the statement it could not
        // classify — a silent `found: false` with a vague reason is how the
        // next reader mis-diagnoses this. WHICH statement gets named depends on
        // the embedding: a comment is skipped and the refusal names
        // `SET ROLE postgres;`, while an executable line carrying the keyword
        // inside a literal or a dollar-quoted body is itself the unclassifiable
        // statement. Both are refusals and neither leaks, so the assertion is
        // over the SHAPE of the refusal, not over which line it names.
        expect(result.found).toBe(false);
        expect(result.reason).toContain("unrecognised statement before its RAISE");
        expect(
          result.reason?.includes("SET ROLE postgres;") || result.reason?.includes(line),
          `the refusal must NAME the statement it could not classify, so a reader can fix it. ` +
            `Got: ${JSON.stringify(result.reason)}`,
        ).toBe(true);
      });
    }

    for (const [embedding, render] of Object.entries(MULTILINE_EMBEDDINGS)) {
      it(`ORACLE (multi-line): "${word}" in a ${embedding} must not end the scan`, () => {
        const text = [
          "  IF NOT raised THEN",
          "    SET ROLE postgres;",
          render(word),
          "    RAISE EXCEPTION 'TEST FAILED (ARM ML): it did not bite';",
          "  END IF;",
          "  SELECT 1;",
        ].join("\n");

        const result = neuterArm(text, "ARM ML");

        const leaked = result.found && executableLines(result.text, /SET\s+ROLE/i).length > 0;
        expect(
          leaked,
          `neuterArm ACCEPTED the neuter and left "SET ROLE postgres;" executing. Between it and ` +
            `the RAISE was a ${embedding} whose INTERIOR reads ${JSON.stringify(word)} — text ` +
            `PostgreSQL never reads as code. A classifier that carries quote and comment state ` +
            `across lines cannot see a branch head there.`,
        ).toBe(false);

        expect(result.found).toBe(false);
        expect(result.reason).toContain("unrecognised statement before its RAISE");
      });
    }

    it(`ORACLE (other direction): bare-code "${BARE_CODE[word]}" MUST end the scan`, () => {
      // Without this half the fix could be "passed" by never terminating at
      // all, which refuses every arm in the real corpus while reporting green
      // on every leak case above.
      const text = [
        `  ${BARE_CODE[word]}`,
        "    RAISE EXCEPTION 'TEST FAILED (ARM G): it did not bite';",
        "  END IF;",
      ].join("\n");
      expect(
        neuterArm(text, "ARM G").found,
        `${JSON.stringify(BARE_CODE[word])} is structurally a branch head and must terminate the ` +
          `backward scan. A predicate that never terminates refuses the whole corpus.`,
      ).toBe(true);
    });
  }

  it("a REAL branch head still ends the scan even with a trailing comment after it", () => {
    const text = [
      "  IF NOT raised THEN -- the arm under test",
      "    RAISE EXCEPTION 'TEST FAILED (ARM G): it did not bite';",
      "  END IF;",
    ].join("\n");
    expect(neuterArm(text, "ARM G").found).toBe(true);
  });

  it("a legitimate block comment above a RAISE is not a spurious refusal", () => {
    // The primitive was wrong in BOTH directions (R3-C01): a block comment
    // carrying no keyword was refused as an "unrecognised statement", so an
    // ordinary comment produced a `neuter-missed` defect.
    const text = [
      "  IF NOT raised THEN",
      "    /* explanatory */",
      "    RAISE EXCEPTION 'TEST FAILED (ARM H): it did not bite';",
      "  END IF;",
    ].join("\n");
    expect(neuterArm(text, "ARM H").found).toBe(true);
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

// ══════════════════════════════════════════════════════════════════════════
// PRIMITIVE A — A COMPOUND LINE IS NOT A BRANCH HEAD (phase 164.3.1, [R4-C01])
// ══════════════════════════════════════════════════════════════════════════
//
// ⛔ THE DEFECT, MEASURED AT HEAD `fa2291d2` AND RE-MEASURED THIS SESSION.
// `isBranchHead` was a LINE predicate with two UNANCHORED arms:
//
//     /^EXCEPTION(\s+WHEN\b.*)?$/i     ← the `.*` swallows trailing STATEMENTS
//     /\b(THEN|LOOP)$/i                ← no start anchor
//
// so `EXCEPTION WHEN OTHERS THEN v_raised := true; END;` — a line that exists
// SEVEN TIMES in `supabase/tests/test_profiles_privileged_columns_locked.sql`
// — was accepted whole as a "branch head". The backward scan broke there, the
// neuter was ACCEPTED, and every statement sharing that line stayed live. The
// same hole accepts `SET ROLE postgres; IF NOT ok THEN`, which hands a
// superuser session to every later arm — the measured RESET ROLE class, but
// silent, because the scan believed it had reached the head of the branch.
//
// The fix is not a fifth regex (the ROADMAP goal refuses one by name): the line
// is TOKENIZED INTO STATEMENTS and `isBranchHead` is asked of a STATEMENT, so a
// compound line decomposes and its trailing statements become visible.
//
// ⭐ ANTI-VACUITY, and the RED direction is real: under the OLD line predicate
// this block fails, stating that the compound line was swallowed as a head and
// its trailing statements left executing. Recorded verbatim in the SUMMARY.
describe("Primitive A: a compound line decomposes — its trailing statements are never swallowed", () => {
  const PRIVESC_GATE = join(
    REPO_ROOT,
    "supabase",
    "tests",
    "test_profiles_privileged_columns_locked.sql",
  );

  /**
   * The REAL bytes, extracted from the REAL file at runtime. A copy of the
   * shape inside the test would drift away from the corpus silently (SP-L02):
   * the whole point is that these lines EXIST, so they are read, not retyped.
   *
   * Line numbers are deliberately NOT pinned — the count is, so a corpus edit
   * that removes the shape fails here loudly instead of quietly emptying the
   * cross-product.
   */
  const COMPOUND_RE = /^\s*EXCEPTION\s+WHEN\s+OTHERS\s+THEN\s+\S.*;\s*END\s*;\s*$/;
  const compoundLines = readFileSync(PRIVESC_GATE, "utf8")
    .split("\n")
    .map((text, i) => ({ line: i + 1, text }))
    .filter((l) => COMPOUND_RE.test(l.text));

  it("the calibration input still exists in the real corpus (>= 7 compound lines)", () => {
    // Non-vacuity guard. If the file were reshaped, every drive below would
    // silently vanish and this file would still report green.
    expect(
      compoundLines.length,
      `test_profiles_privileged_columns_locked.sql no longer carries the compound ` +
        `"EXCEPTION WHEN OTHERS THEN <stmt>; END;" shape this primitive is calibrated on. ` +
        `Re-measure before changing the classifier.`,
    ).toBeGreaterThanOrEqual(7);
  });

  it("TRACER: the first real compound line above a RAISE is REFUSED, not accepted as a head", () => {
    const compound = compoundLines[0];
    const text = [
      "  IF NOT raised THEN",
      compound.text,
      "    RAISE EXCEPTION 'TEST FAILED (ARM P1): it did not bite';",
      "  END IF;",
      "  SELECT 1;",
    ].join("\n");

    const result = neuterArm(text, "ARM P1");

    // The leak class, stated over the OUTPUT (R3-C01's format): an accepted
    // neuter that leaves the compound line's trailing statements executing is
    // the defect, whatever the scan believed terminated it.
    const swallowed =
      result.found && executableLines(result.text, /v_raised\s*:=\s*true;/i).length > 0;
    expect(
      swallowed,
      `neuterArm ACCEPTED the neuter and left the compound line's trailing statements ` +
        `executing. The only thing between the branch head and the RAISE was ` +
        `${JSON.stringify(compound.text.trim())} — a line carrying an EXCEPTION head AND two ` +
        `further statements. Accepting it whole as a "branch head" is [R4-C01]: the same hole ` +
        `accepts "SET ROLE postgres; IF NOT ok THEN" and hands a superuser session to every ` +
        `later arm.`,
    ).toBe(false);

    // And it must refuse LOUDLY, naming the statement it could not classify and
    // the line it sits on — a vague `found: false` is how the next reader
    // mis-diagnoses this.
    expect(result.found).toBe(false);
    expect(result.reason).toContain("unrecognised statement before its RAISE");
    expect(
      result.reason,
      `the refusal must NAME the trailing statement decomposed out of the compound line. ` +
        `Got: ${JSON.stringify(result.reason)}`,
    ).toContain("END;");
    expect(result.text, "a refusal must not mutate the text").toBe(text);
  });

  it("GENERALISED: every one of the real compound lines is refused, not just the tracer's", () => {
    // The tracer proved ONE line end-to-end. A primitive proved on one instance
    // is an example, so the drive is quantified over every instance the file
    // actually carries.
    for (const compound of compoundLines) {
      const text = [
        "  IF NOT raised THEN",
        compound.text,
        `    RAISE EXCEPTION 'TEST FAILED (ARM P1-${compound.line}): it did not bite';`,
        "  END IF;",
        "  SELECT 1;",
      ].join("\n");

      const result = neuterArm(text, `ARM P1-${compound.line}`);
      const swallowed =
        result.found && executableLines(result.text, /v_raised\s*:=\s*true;/i).length > 0;
      expect(
        swallowed,
        `line ${compound.line} of test_profiles_privileged_columns_locked.sql was swallowed whole ` +
          `as a branch head: ${JSON.stringify(compound.text.trim())}`,
      ).toBe(false);
      expect(result.found, `line ${compound.line}: reason ${JSON.stringify(result.reason)}`).toBe(
        false,
      );
      expect(result.reason).toContain("unrecognised statement before its RAISE");
    }
  });

  it("P3: `SET ROLE postgres; IF NOT ok THEN` can no longer produce an accepted neuter", () => {
    // The ROADMAP's own spelling of the defect, and RESEARCH premise P3's
    // measured synthetic. The compound HEAD shape: the head is real, but a
    // privileged statement shares its line BEFORE it, so a scan that terminates
    // on the LINE believes it reached the head of the branch and accepts a
    // neuter whose output still runs `SET ROLE postgres;`.
    const text = [
      "  IF NOT raised THEN",
      "    SET ROLE postgres; IF NOT ok THEN",
      "    RAISE EXCEPTION 'TEST FAILED (ARM P3): it did not bite';",
      "  END IF;",
      "  SELECT 1;",
    ].join("\n");

    const result = neuterArm(text, "ARM P3");

    const leaked = result.found && executableLines(result.text, /SET\s+ROLE\s+postgres/i).length > 0;
    expect(
      leaked,
      `neuterArm ACCEPTED the neuter and left "SET ROLE postgres;" executing — a superuser ` +
        `session handed to every later arm, with no signal. This is [R4-C01] verbatim.`,
    ).toBe(false);

    expect(result.found).toBe(false);
    expect(result.reason).toContain("unrecognised statement before its RAISE");
    expect(result.reason).toContain("SET ROLE postgres;");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// [MUT-I01] — THE FORWARD SCAN, BOTH DIRECTIONS (phase 164.3.1)
// ══════════════════════════════════════════════════════════════════════════
//
// ⛔ THE DEFECT, MEASURED AT HEAD. `neuterArm`'s forward walk and
// `statementEndLine` each tracked ONE character — `'` — with no notion of a
// comment. An apostrophe inside a `--` comment inside a RAISE's span therefore
// flipped the scan's quote parity, and the two parities fail DIFFERENTLY:
//
//   ODD  (P4) — the real terminator is swallowed and none is found: the arm is
//               refused with "could not find the end of the RAISE statement".
//               LOUD, and a false defect against a perfectly legal arm.
//   EVEN (P5) — parity is restored by a second apostrophe, the real terminator
//               is still swallowed, and the scan ends on a LATER statement's
//               semicolon. The neuter then comments out a statement that must
//               survive. SILENT, and it rewrites the arm's semantics.
//
// ⭐ A FIX THAT CLOSES ONLY P4 IS A FAIL. The loud direction is the one a
// reviewer demonstrates; the silent one is the one that ships. Both are pinned,
// and both were observed RED before the routing — verbatim text in the SUMMARY.
describe("[MUT-I01]: comment state inside a RAISE's span, both parities", () => {
  it("P4 (odd parity, LOUD): an apostrophe in a `--` comment is not a spurious neuter-missed", () => {
    // RESEARCH premise P4's measured shape.
    const text = [
      "  IF NOT raised THEN",
      "    RAISE EXCEPTION 'TEST FAILED (ARM P4): it did not bite',",
      "      -- don't worry",
      "      some_var;",
      "  END IF;",
      "  SELECT 1;",
    ].join("\n");

    const result = neuterArm(text, "ARM P4");

    expect(
      result.found,
      `neuterArm REFUSED a legal arm: ${JSON.stringify(result.reason)}. The only thing between ` +
        `the RAISE and its terminator was a "--" comment containing an apostrophe, which is not ` +
        `a quote — a reader that tracks "'" alone cannot tell the difference, and reports a ` +
        `neuter-missed defect against an arm that is fine.`,
    ).toBe(true);

    // The FULL statement, through its true terminator, is what gets neutered —
    // not a prefix of it.
    expect(executableLines(result.text, /RAISE\s+EXCEPTION/i)).toEqual([]);
    expect(executableLines(result.text, /some_var;/)).toEqual([]);
    expect(result.text).toContain("NULL; -- neutered ARM P4 by the mutation runner");
  });

  it("P5 (even parity, SILENT): the statement after the RAISE's terminator must SURVIVE", () => {
    // RESEARCH premise P5's measured shape: a second apostrophe restores parity
    // AFTER the real terminator has been swallowed, so the scan runs on and
    // ends on the NEXT statement's semicolon.
    const text = [
      "  IF NOT raised THEN",
      "    RAISE EXCEPTION 'TEST FAILED (ARM P5): it did not bite',",
      "      -- don't worry",
      "      some_var;",
      "    -- it isn't optional",
      "    PERFORM must_survive();",
      "  END IF;",
    ].join("\n");

    const result = neuterArm(text, "ARM P5");
    expect(result.found, `reason: ${JSON.stringify(result.reason)}`).toBe(true);

    expect(
      executableLines(result.text, /PERFORM\s+must_survive\(\);/),
      `the neuter swallowed "PERFORM must_survive();" — a statement OUTSIDE the RAISE, commented ` +
        `out with no signal whatsoever. This is the SILENT half of [MUT-I01]: the neuter reported ` +
        `success while rewriting what the arm does. A fix that closes only the loud P4 direction ` +
        `leaves this live.`,
    ).toEqual(["    PERFORM must_survive();"]);

    // And it still did its job.
    expect(executableLines(result.text, /RAISE\s+EXCEPTION/i)).toEqual([]);
  });

  it("R3 residual: a multi-line block comment above a RAISE now CLASSIFIES instead of refusing", () => {
    // The line-local reader saw the closing `*/` as an unclassifiable statement
    // and refused a legal arm; it saw the interior line `BEGIN` as a branch
    // head. Neither is code. Both directions are gone at once, because the
    // comment is no longer a sequence of lines — it is one lexical region.
    for (const interior of ["BEGIN", "DECLARE junk int;", "IF NOT ok THEN"]) {
      const text = [
        "  IF NOT raised THEN",
        "    /* explanatory",
        interior,
        "    */",
        "    RAISE EXCEPTION 'TEST FAILED (ARM R3): it did not bite';",
        "  END IF;",
      ].join("\n");

      const result = neuterArm(text, "ARM R3");
      expect(
        result.found,
        `a multi-line comment whose interior reads ${JSON.stringify(interior)} produced a ` +
          `refusal: ${JSON.stringify(result.reason)}. A comment carries no runtime effect on any ` +
          `of its lines.`,
      ).toBe(true);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// SUB-LINE NEUTER SPANS — the rewrite must produce valid PL/pgSQL
// ══════════════════════════════════════════════════════════════════════════
//
// ⛔ The whole-line splice is only correct when the neuter's span aligns to
// line boundaries. The real corpus does not oblige:
// `test_profiles_privileged_columns_locked.sql:97` carries a head, a
// `RESET ROLE;`, a RAISE and an `END IF;` on ONE line. Commenting the whole
// line deletes every statement on it — including ones that must survive — and
// reports success. That is P5's defect reached by a different road.
describe("a neuter span that starts or ends mid-line rewrites only the span", () => {
  it("keeps the statements sharing the RAISE's line live", () => {
    const text = [
      "  IF v_raised THEN RAISE EXCEPTION 'TEST FAILED (ARM SUB): x'; ELSE PERFORM must_survive(); END IF;",
      "  SELECT 1;",
    ].join("\n");

    const result = neuterArm(text, "ARM SUB");
    expect(result.found, `reason: ${JSON.stringify(result.reason)}`).toBe(true);

    expect(
      executableLines(result.text, /PERFORM\s+must_survive\(\);/).length,
      `the whole-line splice commented out the ELSE arm that shares the RAISE's line. The neuter ` +
        `range is a STATEMENT, not a line, and everything outside it must survive verbatim.`,
    ).toBe(1);

    // The head and the block terminator survive, so the block is still balanced.
    expect(executableLines(result.text, /IF v_raised THEN/).length).toBe(1);
    expect(executableLines(result.text, /END IF;/).length).toBe(1);
    // The RAISE is gone and the branch keeps a non-empty body.
    expect(executableLines(result.text, /RAISE\s+EXCEPTION/i)).toEqual([]);
    expect(result.text).toContain("NULL; -- neutered ARM SUB by the mutation runner");
  });

  it("absorbs a RESET ROLE that shares the RAISE's line — the corpus :97 shape", () => {
    const text = [
      "  IF NOT v_raised THEN RESET ROLE; RAISE EXCEPTION 'TEST FAILED (ARM 97): x'; END IF;",
      "  PERFORM after();",
    ].join("\n");

    const result = neuterArm(text, "ARM 97");
    expect(result.found, `reason: ${JSON.stringify(result.reason)}`).toBe(true);
    expect(
      executableLines(result.text, /RESET\s+ROLE/i),
      "the abort-path RESET ROLE stayed live because it shared the RAISE's line — the leak the " +
        "absorption exists to prevent, reached through a line boundary",
    ).toEqual([]);
    expect(executableLines(result.text, /PERFORM\s+after\(\);/).length).toBe(1);
  });
});
