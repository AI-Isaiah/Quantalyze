/**
 * RED-UNDER-M annotation parser — behaviour gate (VAC-01, phase 164.3 plan 05).
 *
 * WHY THIS FILE EXISTS. The 30 existing `RED-UNDER` annotations in
 * `supabase/tests/test_strategy_shares_rls.sql` are PROSE (D-14). A machine
 * cannot execute "change `generation BIGINT` back to `generation INTEGER` in
 * the STEP 1 CREATE TABLE" — plan 164.3-01 MEASURED what happens when you try:
 * that literal string occurs exactly once in the migration and it is NOT the
 * CREATE TABLE column, it is `RETURNS TABLE (generation BIGINT, nonce UUID)` at
 * line 828. Mutating it aborts the apply, so the gate never runs and no arm can
 * be the first failure. The real column at line 170 carries TWO spaces.
 *
 * Two consequences are encoded as tests here:
 *   1. A structured annotation MUST carry executable bytes AND a measured
 *      `occurrences` count. A find/replace that matches a different number of
 *      times than the annotator measured is a MEASURE_FAIL, never a silent
 *      no-op and never "the arm did not redden".
 *   2. Markers are recognised ONLY at comment line start. A naive substring
 *      count of the marker returns 33 on the corpus because the file's own
 *      HEADER documents the syntax three times. A count satisfied by prose is
 *      this phase's thesis committed by this phase's own spec.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseAnnotations,
  parseFile,
  scanCorpus,
} from "../../scripts/mutation-runner/parse.mjs";
import {
  applyFileStep,
  armIdentities,
  failureBranches,
  firstFailureArm,
  identityRewriteDetail,
  makeIdentityNonce,
  stampedIdentity,
  stampIdentities,
  unstampedIdentities,
} from "../../scripts/mutation-runner/run.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Convenience: the sole error message, or a readable dump when there is not exactly one. */
function soleError(result: ReturnType<typeof parseAnnotations>): string {
  if (result.errors.length !== 1) {
    throw new Error(
      `expected exactly 1 parse error, got ${result.errors.length}: ${JSON.stringify(result.errors)}`,
    );
  }
  return result.errors[0].message;
}

describe("line-start anchoring (the 30-vs-33 correction)", () => {
  it("counts a prose marker at comment line start, with leading whitespace", () => {
    const sql = [
      "DO $$ BEGIN",
      "  -- RED-UNDER: change `generation BIGINT` back to `generation INTEGER` in the",
      "  --            STEP 1 CREATE TABLE.",
      '  -- RED-UNDER-M: {"arm":"SHAPE 1c","apply":[{"kind":"edit","file":"m.sql","find":"a","replace":"b","occurrences":1}]}',
      "END $$;",
    ].join("\n");

    const result = parseAnnotations(sql, { file: "g.sql" });

    expect(result.errors).toEqual([]);
    expect(result.prose).toHaveLength(1);
    expect(result.prose[0].line).toBe(2);
    expect(result.structured).toHaveLength(1);
    expect(result.parity.ok).toBe(true);
  });

  it("counts ZERO for the corpus header shape — the marker mentioned mid-line inside a doc comment", () => {
    // Reproduced from supabase/tests/test_strategy_shares_rls.sql:46-48. The
    // third line even matches a plain `grep -c 'RED-UNDER:'`, which is exactly
    // how the recorded count became 33.
    const sql = [
      "-- ⭐ PER-ARM RED-UNDER (standing requirement, founder-adopted 2026-08-27).",
      "-- Every arm added by the nonce change carries an adjacent",
      "-- `-- RED-UNDER: <the exact mutation that reddens THIS arm>` comment, and each",
      "-- of those mutations was performed individually on the throwaway cluster.",
    ].join("\n");

    const result = parseAnnotations(sql, { file: "g.sql" });

    expect(result.prose).toHaveLength(0);
    expect(result.structured).toHaveLength(0);
    expect(result.errors).toEqual([]);
  });

  it("does not mistake a structured twin or a setup line for a prose marker", () => {
    const sql = [
      '-- RED-UNDER-SETUP: {"apply":["a.sql"]}',
      '-- RED-UNDER-M: {"arm":"A","waiver":"no first-failure mutation exists"}',
    ].join("\n");

    const result = parseAnnotations(sql, { file: "g.sql" });

    expect(result.prose).toHaveLength(0);
    expect(result.structured).toHaveLength(1);
    expect(result.setup).toEqual({ apply: ["a.sql"], line: 1 });
  });

  it("ignores a marker that is not in a comment at all", () => {
    const sql = "SELECT 'RED-UNDER: not a comment' AS s;";
    expect(parseAnnotations(sql, { file: "g.sql" }).prose).toHaveLength(0);
  });
});

describe("the three corpus mutation shapes", () => {
  it("SHAPE 1 — a migration-file edit with byte-exact find/replace and a measured occurrence count", () => {
    // The prose is verbatim from test_strategy_shares_rls.sql:408-409. The
    // structured twin carries the bytes plan 01 measured (TWO spaces), not the
    // prose locator's single-space string.
    const sql = [
      "  -- RED-UNDER: change `generation BIGINT` back to `generation INTEGER` in the",
      "  --            STEP 1 CREATE TABLE.",
      '  -- RED-UNDER-M: {"arm":"SHAPE 1c","apply":[{"kind":"edit","file":"supabase/migrations/20260827120000_strategy_shares_generation_model.sql","find":"generation  BIGINT","replace":"generation  INTEGER","occurrences":1,"nth":1}]}',
    ].join("\n");

    const { structured, errors } = parseAnnotations(sql, { file: "g.sql" });

    expect(errors).toEqual([]);
    expect(structured[0].arm).toBe("SHAPE 1c");
    expect(structured[0].waiver).toBeNull();
    expect(structured[0].apply).toEqual([
      {
        kind: "edit",
        file: "supabase/migrations/20260827120000_strategy_shares_generation_model.sql",
        find: "generation  BIGINT",
        replace: "generation  INTEGER",
        occurrences: 1,
        nth: 1,
      },
    ]);
  });

  it("SHAPE 1b — an insertion, expressed as insert-after with a byte-exact anchor", () => {
    // Prose verbatim from :369-370 — "add a `token_hash TEXT` column to the
    // STEP 1 CREATE TABLE", an insertion the prose gives no exact point for.
    const sql = [
      "  -- RED-UNDER: add a `token_hash TEXT` column to the STEP 1 CREATE TABLE in",
      "  --            migration 20260827120000.",
      '  -- RED-UNDER-M: {"arm":"SHAPE 2","apply":[{"kind":"insert-after","file":"m.sql","anchor":"  generation  BIGINT      NOT NULL DEFAULT 1 CHECK (generation >= 1),","text":"\\n  token_hash  TEXT,","occurrences":1}]}',
    ].join("\n");

    const { structured, errors } = parseAnnotations(sql, { file: "g.sql" });

    expect(errors).toEqual([]);
    expect(structured[0].apply[0].kind).toBe("insert-after");
    expect(structured[0].apply[0].anchor).toContain("generation  BIGINT");
    expect(structured[0].apply[0].nth).toBe(1); // defaulted
  });

  it("SHAPE 2 — a live-DB GRANT statement with a prerequisite neuter of ANOTHER arm", () => {
    // Prose verbatim from :1533-1537: SHAPE 3b's exact-set pin fires first on
    // ANY grant drift, so NONCE 1b was observed red with SHAPE 3b neutered.
    const sql = [
      "  -- RED-UNDER: `GRANT UPDATE (nonce) ON strategy_shares TO authenticated` on",
      "  --            the live database. ⚠️ SHAPE 3b's exact-set pin fires first on",
      "  --            ANY grant drift, so this arm was observed red with SHAPE 3b",
      "  --            neutered.",
      '  -- RED-UNDER-M: {"arm":"NONCE 1b","apply":[{"kind":"sql","stmt":"GRANT UPDATE (nonce) ON strategy_shares TO authenticated"}],"neuter":[{"arm":"SHAPE 3b"}]}',
    ].join("\n");

    const { structured, errors } = parseAnnotations(sql, { file: "g.sql" });

    expect(errors).toEqual([]);
    expect(structured[0].apply).toEqual([
      { kind: "sql", stmt: "GRANT UPDATE (nonce) ON strategy_shares TO authenticated" },
    ]);
    expect(structured[0].neuter).toEqual([{ arm: "SHAPE 3b" }]);
  });

  it("SHAPE 3 — a LAYERED compound mutation is a multi-step apply array", () => {
    // Prose verbatim from :661-665: the migration arm tests the same bit and
    // ABORTS THE APPLY, so its term must be removed in the SAME mutation.
    const sql = [
      "  -- RED-UNDER: change the CREATE TRIGGER in migration 20260827120000 STEP 1b to",
      "  --            `BEFORE UPDATE ON strategy_shares`.",
      "  -- ⚠️ LAYERED: migration arm (v) tests the same bit and ABORTS THE APPLY, so",
      "  --    its `AND (t.tgtype & 4) = 4` term must be removed in the same mutation.",
      '  -- RED-UNDER-M: {"arm":"SHAPE 5","apply":[{"kind":"edit","file":"m.sql","find":"BEFORE INSERT OR UPDATE ON strategy_shares","replace":"BEFORE UPDATE ON strategy_shares","occurrences":1},{"kind":"edit","file":"m.sql","find":" AND (t.tgtype & 4) = 4","replace":"","occurrences":1}]}',
    ].join("\n");

    const { structured, errors } = parseAnnotations(sql, { file: "g.sql" });

    expect(errors).toEqual([]);
    expect(structured[0].apply).toHaveLength(2);
    expect(structured[0].apply[1].replace).toBe("");
  });

  it("a waiver is a counted twin carrying a reason, and never has an apply", () => {
    const sql = [
      "  -- RED-UNDER: none — a deleted `nonce` aborts the apply, so this arm can",
      "  --            never be the FIRST failure.",
      '  -- RED-UNDER-M: {"arm":"SHAPE 1","waiver":"a deleted nonce column aborts the apply; no first-failure mutation exists"}',
    ].join("\n");

    const { structured, errors } = parseAnnotations(sql, { file: "g.sql" });

    expect(errors).toEqual([]);
    expect(structured[0].waiver).toMatch(/aborts the apply/);
    expect(structured[0].apply).toEqual([]);
  });
});

describe("parity gate", () => {
  it("a prose annotation without a structured twin is a named parity defect", () => {
    const sql = [
      "  -- RED-UNDER: mutation A.",
      '  -- RED-UNDER-M: {"arm":"A","waiver":"r"}',
      "  -- RED-UNDER: mutation B, with no twin.",
    ].join("\n");

    const result = parseAnnotations(sql, { file: "g.sql" });

    expect(result.parity).toMatchObject({ prose: 2, structured: 1, ok: false });
  });

  it("a waiver counts as a twin, so a waived arm satisfies parity", () => {
    const sql = [
      "  -- RED-UNDER: no mutation exists.",
      '  -- RED-UNDER-M: {"arm":"A","waiver":"none exists"}',
    ].join("\n");

    expect(parseAnnotations(sql, { file: "g.sql" }).parity.ok).toBe(true);
  });

  it("reports parity failure in the other direction too — a twin with no prose claim", () => {
    const sql = '  -- RED-UNDER-M: {"arm":"A","waiver":"none exists"}';
    expect(parseAnnotations(sql, { file: "g.sql" }).parity).toMatchObject({
      prose: 0,
      structured: 1,
      ok: false,
    });
  });
});

describe("malformed annotations fail loud, naming the line", () => {
  const cases: Array<[string, string, RegExp]> = [
    [
      "malformed JSON",
      '  -- RED-UNDER-M: {"arm":"A", "apply":[}',
      /malformed JSON/i,
    ],
    [
      "not an object",
      '  -- RED-UNDER-M: ["arm"]',
      /must be a JSON object/i,
    ],
    [
      "missing arm",
      '  -- RED-UNDER-M: {"waiver":"r"}',
      /"arm"/,
    ],
    [
      "empty arm",
      '  -- RED-UNDER-M: {"arm":"   ","waiver":"r"}',
      /"arm"/,
    ],
    [
      "unknown top-level key",
      '  -- RED-UNDER-M: {"arm":"A","waiver":"r","expect":"red"}',
      /unknown key.*expect/i,
    ],
    [
      "apply and waiver together",
      '  -- RED-UNDER-M: {"arm":"A","waiver":"r","apply":[{"kind":"sql","stmt":"SELECT 1"}]}',
      /mutually exclusive/i,
    ],
    [
      "neither apply nor waiver",
      '  -- RED-UNDER-M: {"arm":"A"}',
      /exactly one of/i,
    ],
    [
      "empty apply array",
      '  -- RED-UNDER-M: {"arm":"A","apply":[]}',
      /at least one step/i,
    ],
    [
      "unknown step kind",
      '  -- RED-UNDER-M: {"arm":"A","apply":[{"kind":"patch","file":"m.sql"}]}',
      /unknown step kind.*patch/i,
    ],
    [
      "unknown step key",
      '  -- RED-UNDER-M: {"arm":"A","apply":[{"kind":"sql","stmt":"SELECT 1","file":"m.sql"}]}',
      /unknown key.*file/i,
    ],
    [
      "edit missing occurrences — the measurement that plan 01 proved mandatory",
      '  -- RED-UNDER-M: {"arm":"A","apply":[{"kind":"edit","file":"m.sql","find":"a","replace":"b"}]}',
      /"occurrences"/,
    ],
    [
      "occurrences must be a positive integer",
      '  -- RED-UNDER-M: {"arm":"A","apply":[{"kind":"edit","file":"m.sql","find":"a","replace":"b","occurrences":0}]}',
      /"occurrences"/,
    ],
    [
      "nth beyond the measured occurrence count",
      '  -- RED-UNDER-M: {"arm":"A","apply":[{"kind":"edit","file":"m.sql","find":"a","replace":"b","occurrences":1,"nth":2}]}',
      /"nth".*exceeds/i,
    ],
    [
      "edit with an empty find",
      '  -- RED-UNDER-M: {"arm":"A","apply":[{"kind":"edit","file":"m.sql","find":"","replace":"b","occurrences":1}]}',
      /"find"/,
    ],
    [
      "sql step with an empty stmt",
      '  -- RED-UNDER-M: {"arm":"A","apply":[{"kind":"sql","stmt":""}]}',
      /"stmt"/,
    ],
    [
      "waiver with a neuter",
      '  -- RED-UNDER-M: {"arm":"A","waiver":"r","neuter":[{"arm":"B"}]}',
      /waiver.*neuter/i,
    ],
    [
      "neuter entry missing arm",
      '  -- RED-UNDER-M: {"arm":"A","apply":[{"kind":"sql","stmt":"SELECT 1"}],"neuter":[{}]}',
      /neuter.*"arm"/i,
    ],
  ];

  it.each(cases)("%s", (_name, line, pattern) => {
    const result = parseAnnotations(line, { file: "g.sql" });
    const message = soleError(result);
    expect(message).toMatch(pattern);
    expect(message).toMatch(/g\.sql:1/);
  });

  it("never silently skips a bad annotation — it is not counted as a valid twin", () => {
    const sql = [
      "  -- RED-UNDER: mutation A.",
      '  -- RED-UNDER-M: {"arm":"A", broken}',
    ].join("\n");

    const result = parseAnnotations(sql, { file: "g.sql" });

    expect(result.errors).toHaveLength(1);
    expect(result.structured).toHaveLength(0);
    expect(result.parity.ok).toBe(false);
  });

  it("rejects a duplicate arm id within one file", () => {
    const sql = [
      '  -- RED-UNDER-M: {"arm":"A","waiver":"r"}',
      '  -- RED-UNDER-M: {"arm":"A","waiver":"r2"}',
    ].join("\n");

    expect(soleError(parseAnnotations(sql, { file: "g.sql" }))).toMatch(/duplicate arm/i);
  });
});

describe("RED-UNDER-SETUP — the in-file apply list", () => {
  it("parses the apply list", () => {
    const sql = '-- RED-UNDER-SETUP: {"apply":["a/b.sql","c/d.sql"]}';
    const result = parseAnnotations(sql, { file: "g.sql" });
    expect(result.errors).toEqual([]);
    expect(result.setup?.apply).toEqual(["a/b.sql", "c/d.sql"]);
  });

  it("rejects a second setup line", () => {
    const sql = [
      '-- RED-UNDER-SETUP: {"apply":["a.sql"]}',
      '-- RED-UNDER-SETUP: {"apply":["b.sql"]}',
    ].join("\n");
    expect(soleError(parseAnnotations(sql, { file: "g.sql" }))).toMatch(/one RED-UNDER-SETUP/i);
  });

  it("rejects an absolute or escaping path — the runner only copies files inside the repo", () => {
    const sql = '-- RED-UNDER-SETUP: {"apply":["../../etc/passwd"]}';
    expect(soleError(parseAnnotations(sql, { file: "g.sql" }))).toMatch(/repo-relative/i);
  });

  it("rejects an empty apply list", () => {
    const sql = '-- RED-UNDER-SETUP: {"apply":[]}';
    expect(soleError(parseAnnotations(sql, { file: "g.sql" }))).toMatch(/at least one/i);
  });
});

describe("WR-03 / GRAMMAR rule 3 — a mutation may not INJECT the detector's own string", () => {
  // The runner proves an arm bites by requiring the FIRST `TEST FAILED (<ARM>)`
  // in the lane's output to name the intended arm. `validateStep` constrained
  // only SHAPE, and the gate file is itself in the corpus, so a mutation could
  // WRITE that literal into the gate and report `RED (identity ok)` for an arm
  // whose logic never ran — a vacuous check inside the vacuity detector.
  const GATE_REL = "supabase/tests/test_strategy_shares_rls.sql";

  it("rejects an `edit` whose replacement writes a TEST FAILED ( literal", () => {
    const sql = [
      "  -- RED-UNDER: prose",
      `  -- RED-UNDER-M: {"arm":"X","apply":[{"kind":"edit","file":"${GATE_REL}","find":"anything","replace":"RAISE EXCEPTION 'TEST FAILED (X): forged';","occurrences":1}]}`,
    ].join("\n");
    expect(soleError(parseAnnotations(sql, { file: "g.sql" }))).toMatch(
      /injects a "TEST FAILED \(" literal/,
    );
  });

  it("rejects an `insert-after` whose inserted text writes the literal", () => {
    const sql = [
      "  -- RED-UNDER: prose",
      `  -- RED-UNDER-M: {"arm":"X","apply":[{"kind":"insert-after","file":"${GATE_REL}","anchor":"a","text":"\\n  RAISE EXCEPTION 'TEST FAILED (X)';","occurrences":1}]}`,
    ].join("\n");
    expect(soleError(parseAnnotations(sql, { file: "g.sql" }))).toMatch(
      /injects a "TEST FAILED \(" literal/,
    );
  });

  it("rejects a `sql` step that raises the literal on the lane's database", () => {
    const sql = [
      "  -- RED-UNDER: prose",
      `  -- RED-UNDER-M: {"arm":"X","apply":[{"kind":"sql","stmt":"DO $$ BEGIN RAISE EXCEPTION 'TEST FAILED (X)'; END $$;"}]}`,
    ].join("\n");
    expect(soleError(parseAnnotations(sql, { file: "g.sql" }))).toMatch(
      /injects a "TEST FAILED \(" literal/,
    );
  });

  it("matches case-insensitively and across whitespace — the obvious evasions", () => {
    for (const injected of [
      "raise exception 'test failed (X)';",
      "RAISE EXCEPTION 'TEST  FAILED  (X)';",
      "RAISE EXCEPTION 'TEST\tFAILED(X)';",
      "RAISE EXCEPTION 'TEST\nFAILED (X)';",
    ]) {
      const sql = [
        "  -- RED-UNDER: prose",
        `  -- RED-UNDER-M: {"arm":"X","apply":[{"kind":"edit","file":"${GATE_REL}","find":"a","replace":${JSON.stringify(injected)},"occurrences":1}]}`,
      ].join("\n");
      expect(
        soleError(parseAnnotations(sql, { file: "g.sql" })),
        `not refused: ${injected}`,
      ).toMatch(/injects a "TEST FAILED \(" literal/);
    }
  });

  it("R3-C02: a literal SPLIT across a `||` concatenation is refused too", () => {
    // MEASURED at HEAD: `'TEST FAI' || 'LED (X 1): synthetic'` parsed clean
    // (`errors=0 accepted=1`) for BOTH a `sql` step and an `edit`, and at
    // runtime produced exactly the bytes the detector reads.
    for (const [kind, step] of [
      [
        "sql",
        `{"kind":"sql","stmt":"DO $$ BEGIN RAISE EXCEPTION '%', 'TEST FAI' || 'LED (X 1): synthetic'; END $$"}`,
      ],
      [
        "edit",
        `{"kind":"edit","file":"${GATE_REL}","find":"a","replace":"RAISE EXCEPTION '%', 'TEST FAI' || 'LED (X 1): x';","occurrences":1}`,
      ],
    ] as const) {
      const sql = [
        "  -- RED-UNDER: prose",
        `  -- RED-UNDER-M: {"arm":"X 1","apply":[${step}]}`,
      ].join("\n");
      expect(soleError(parseAnnotations(sql, { file: "g.sql" })), `not refused: ${kind}`).toMatch(
        /injects a "TEST FAILED \(" literal \(by string concatenation\)/,
      );
    }
  });

  it("HONEST SCOPE: a spelling the rule CANNOT see, recorded rather than implied", () => {
    // ⛔ This arm asserts the rule's LIMIT. `format('TEST FA%sED (…)', 'IL')`
    // produces the same runtime bytes and contains the needle in neither its
    // direct nor its concatenated form. It parses CLEAN, deliberately — the
    // class is closed by rule 3c (the run-time identity nonce), not here.
    //
    // If this ever starts failing, 3a has been widened and the claim in
    // GRAMMAR.md that "3a is not the closure" must be re-examined, not the
    // test relaxed.
    const sql = [
      "  -- RED-UNDER: prose",
      `  -- RED-UNDER-M: {"arm":"X 1","apply":[{"kind":"sql","stmt":"DO $x$ BEGIN RAISE EXCEPTION '%', format('TEST FA%sED (X 1): x', 'IL'); END $x$"}]}`,
    ].join("\n");
    const result = parseAnnotations(sql, { file: "g.sql" });
    expect(
      result.errors,
      "3a now catches format() — GRAMMAR.md's honest-scope note is stale and must be updated",
    ).toEqual([]);
    expect(result.structured).toHaveLength(1);
  });

  it("does NOT refuse an ordinary mutation — the rule is narrow, not a blanket ban on editing the gate", () => {
    const sql = [
      "  -- RED-UNDER: prose",
      `  -- RED-UNDER-M: {"arm":"X","apply":[{"kind":"edit","file":"${GATE_REL}","find":"generation  BIGINT","replace":"generation  INTEGER","occurrences":1}]}`,
    ].join("\n");
    const result = parseAnnotations(sql, { file: "g.sql" });
    expect(result.errors).toEqual([]);
    expect(result.structured).toHaveLength(1);
  });

  it("the REAL corpus contains no annotation this rule refuses", () => {
    // Measured before shipping the rule: 0 of 30. Pinned so a future backfill
    // (164.4, ~70 files) cannot quietly introduce the shape and then be
    // "fixed" by relaxing the rule.
    const result = parseFile(
      join(REPO_ROOT, "supabase", "tests", "test_strategy_shares_rls.sql"),
    );
    expect(result.errors).toEqual([]);
    expect(result.structured).toHaveLength(30);
  });
});

describe("R2-W04 / GRAMMAR rule 3b — a mutation may not REWRITE an arm identity", () => {
  // ⛔ Rule 3a is a rule about how the annotation is SPELLED, and a rule about
  // spelling can be re-spelled around. The general attack carries no
  // `TEST FAILED` text anywhere: it re-points an EXISTING raise so a different
  // arm reports under the arm-under-test's ID. Measured at HEAD against the
  // real gate file, `{"find":"ANON 1a): ","replace":"N1 1a): "}` parsed CLEAN
  // and moved `ANON 1a` from 1 occurrence to 0 and `N1 1a` from 1 to 2 —
  // `RED (identity ok)`, biting +1, for an arm that never ran.
  //
  // So the invariant is stated over the FILE, where it cannot be re-spelled.
  const GATE_REL = "supabase/tests/test_strategy_shares_rls.sql";
  const GATE = join(REPO_ROOT, GATE_REL);

  const retarget = (victim: string, into: string, occurrences: number) => ({
    kind: "edit" as const,
    file: GATE_REL,
    find: `${victim}): `,
    replace: `${into}): `,
    occurrences,
    nth: 1,
  });

  it("the parse-time SPELLING rule does not catch it — which is why 3b exists", () => {
    // Recorded, not lamented. If this ever starts failing, 3b's justification
    // has changed and the comment above must change with it.
    const sql = [
      "  -- RED-UNDER: prose",
      `  -- RED-UNDER-M: {"arm":"N1 1a","apply":[{"kind":"edit","file":"${GATE_REL}","find":"ANON 1a): ","replace":"N1 1a): ","occurrences":1}]}`,
    ].join("\n");
    const result = parseAnnotations(sql, { file: "g.sql" });
    expect(result.errors).toEqual([]);
    expect(result.structured).toHaveLength(1);
  });

  it("REAL GATE FILE: re-pointing another arm's raise is refused by CONTENT", () => {
    const gate = readFileSync(GATE, "utf8");
    const identities = armIdentities(gate);
    const victim = identities.find((id) => id !== "N1 1a");
    expect(victim, "the gate carries no second arm to re-point — update this test").toBeDefined();

    const occurrences = gate.split(`${victim}): `).length - 1;
    const applied = applyFileStep(gate, retarget(victim as string, "N1 1a", occurrences));
    expect(applied.ok, "the fixture's needle no longer matches — re-measure it").toBe(true);

    const detail = identityRewriteDetail(applied.text!, gate, GATE_REL);
    expect(detail, "the failure branches were unchanged — the fixture is not the attack").not
      .toBeNull();
    expect(identityRewriteDetail(gate, applied.text!, GATE_REL)).toMatch(
      /REWRITES a failure branch/,
    );
  });

  it("does NOT fire on an ordinary mutation, nor on one that leaves identities alone", () => {
    // A subtractive rule that fires on everything is as useless as one that
    // fires on nothing.
    const before = "RAISE EXCEPTION 'TEST FAILED (A): x';\nSELECT 1;";
    const after = "RAISE EXCEPTION 'TEST FAILED (A): x';\nSELECT 2;";
    expect(identityRewriteDetail(before, after, "f.sql")).toBeNull();
  });

  it("REAL CORPUS: no annotation that exists today rewrites an identity", () => {
    // Measured before shipping the invariant: 30 arms, 49 file steps, 0
    // violations. Pinned so 164.4's ~70-file backfill cannot introduce the
    // shape and then be "fixed" by relaxing the rule.
    const scan = scanCorpus(join(REPO_ROOT, "supabase", "tests"));
    const buffers = new Map<string, string>();
    let armsSeen = 0;
    let stepsSeen = 0;
    const violations: string[] = [];

    for (const { result } of scan.results) {
      for (const ann of result.structured) {
        if (ann.waiver) continue;
        armsSeen += 1;
        buffers.clear();
        for (const step of ann.apply) {
          if (step.kind === "sql") continue;
          stepsSeen += 1;
          const abs = join(REPO_ROOT, step.file);
          if (!buffers.has(step.file)) buffers.set(step.file, readFileSync(abs, "utf8"));
          const text = buffers.get(step.file) as string;
          const applied = applyFileStep(text, step);
          if (!applied.ok) {
            violations.push(`${ann.arm}: ${step.file} occurrence-mismatch (${applied.actual})`);
            continue;
          }
          const detail = identityRewriteDetail(text, applied.text as string, step.file);
          if (detail !== null) violations.push(`${ann.arm}: ${detail}`);
          buffers.set(step.file, applied.text as string);
        }
      }
    }

    expect(violations).toEqual([]);
    // Non-vacuity: the walk must actually have walked something.
    expect(armsSeen).toBe(30);
    expect(stepsSeen).toBe(49);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // R3-W01 + R3-C02 (secondary) — the two blind spots of the multiset compare
  // ══════════════════════════════════════════════════════════════════════════

  it("R3-W01: an identity SWAP is multiset-preserving and must still be refused", () => {
    // Sorting then joining discards POSITION. Exchanging two arms' identities
    // leaves the sorted multiset byte-identical, so a single `edit` spanning
    // both raises used to return null — the outcome 3b exists to refuse,
    // reached THROUGH 3b.
    const before = [
      "  IF NOT a THEN",
      "    RAISE EXCEPTION 'TEST FAILED (ARM ONE): a';",
      "  END IF;",
      "  IF NOT b THEN",
      "    RAISE EXCEPTION 'TEST FAILED (ARM TWO): b';",
      "  END IF;",
    ].join("\n");
    const after = before
      .replace("TEST FAILED (ARM ONE)", "TEST FAILED (@@)")
      .replace("TEST FAILED (ARM TWO)", "TEST FAILED (ARM ONE)")
      .replace("TEST FAILED (@@)", "TEST FAILED (ARM TWO)");

    // The oracle, stated independently of the implementation: the swap is
    // invisible to a SORTED multiset by construction. That is the property
    // that made it reachable, so it is asserted rather than assumed.
    expect(
      armIdentities(before).join(" | "),
      "the fixture is not a swap — the sorted multisets differ, so it would have been caught anyway",
    ).toBe(armIdentities(after).join(" | "));

    expect(identityRewriteDetail(before, after, "f.sql")).toMatch(/REWRITES a failure branch/);
  });

  it("R3-C02 secondary: negating an arm's own GUARD preserves every identity and must still be refused", () => {
    // MEASURED against the real gate at HEAD: `IF NOT raised THEN` ->
    // `IF TRUE THEN` parsed clean, applied cleanly, changed no identity at all,
    // and made the arm fire without ever evaluating the property it claims to
    // test. 3b's unit is the FAILURE BRANCH precisely so the guard is inside it.
    const gate = readFileSync(GATE, "utf8");
    const step = {
      kind: "edit" as const,
      file: GATE_REL,
      find: "IF NOT raised THEN\n    RESET ROLE;\n    RAISE EXCEPTION '",
      replace: "IF TRUE THEN\n    RESET ROLE;\n    RAISE EXCEPTION '",
      occurrences: gate.split("IF NOT raised THEN\n    RESET ROLE;\n    RAISE EXCEPTION '").length - 1,
      nth: 1,
    };
    expect(
      step.occurrences,
      "the real gate no longer carries this branch shape — re-measure the fixture",
    ).toBeGreaterThan(0);

    const applied = applyFileStep(gate, step);
    expect(applied.ok).toBe(true);

    // Independent oracle: identities are UNCHANGED, so anything stated over
    // identities alone cannot see this. That is the finding, asserted.
    expect(armIdentities(applied.text as string)).toEqual(armIdentities(gate));

    expect(identityRewriteDetail(gate, applied.text as string, GATE_REL)).toMatch(
      /REWRITES a failure branch/,
    );
  });

  it("REAL GATE FILE: failure branches are found, small, and well inside the lookback bound", () => {
    // Non-vacuity for the two arms above: if `failureBranches` returned an
    // empty list, every comparison would be trivially equal and the whole rule
    // would be a control that cannot fire.
    const branches = failureBranches(readFileSync(GATE, "utf8"));
    expect(branches.length).toBeGreaterThan(50);
    const sizes = branches.map((b) => b.text.split("\n").length);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(1);
    expect(
      Math.max(...sizes),
      "a failure branch grew past the 40-line lookback bound — the bound must be re-measured",
    ).toBeLessThan(40);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// R3-C02 — the identity NONCE: the arbiter that cannot be re-spelled
// ══════════════════════════════════════════════════════════════════════════
describe("GRAMMAR rule 3c — only an identity the RUNNER stamped may be read", () => {
  // ⛔ WHY A NONCE AND NOT A LONGER REGEX. Three review rounds answered a
  // spelling with a rule and were answered by a new spelling within minutes.
  // The nonce does not read the annotation's text at all: it reads what the
  // database printed, and asks whether the runner put it there.
  //
  // The inputs below are GENERATED over the class of spellings, not listed —
  // the same discipline the neuter oracle now uses. Every one of them produces
  // the identical bytes at runtime; none of them is a substring rule's problem.

  const ARM = "SYNTH 1";

  // ══════════════════════════════════════════════════════════════════════════
  // ⛔ SP-C01 — WHAT WAS HERE BEFORE, AND WHY IT WAS WORSE THAN NOTHING.
  //
  // This block used to loop a five-row `SPELLINGS` table and call itself an
  // ORACLE over the class of injections. The loop body built its lane output
  // from `ARM` alone, so `injected` NEVER REACHED THE SYSTEM UNDER TEST and all
  // five arms were byte-identical. PROVEN by neuter: replacing every SPELLINGS
  // value with `NEUTERED-GARBAGE-N` left all 63 tests green. It was the exact
  // "enumerates instances while claiming the class" defect the comment one
  // describe block up says it replaced.
  //
  // The repair is not a bigger table. It is noticing that 3a and 3c range over
  // TWO DIFFERENT AXES, and the old table was on the wrong one for 3c:
  //
  //   * a SPELLING is an input to the PARSER. Whether 3a can see it is
  //     spelling-dependent and decidable here, so the spelling table now goes
  //     through `parseAnnotations` and is asserted as an EXACT classification.
  //   * 3c never reads the annotation at all. Its input is the LANE'S OUTPUT,
  //     so that is what its table generates: prefixes, positions, mixtures of
  //     stamped and unstamped identities, and the near-misses a substring rule
  //     would fumble.
  //
  // ⚠️ HONEST RESIDUAL, stated rather than implied: NO arm in this file can
  // carry a spelling all the way to a lane output, because that requires
  // PostgreSQL to evaluate `format()` / `chr()` / `||`. The end-to-end proof
  // for one such spelling is the runner's own SELF-TEST 8/8, whose fixture is
  // deliberately spelled with `format()` so it can only pass on 3c — and which
  // CI now actually runs (SP-C02). This file proves the two halves; that step
  // proves they meet.
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Ways to make PostgreSQL print `TEST FAILED (SYNTH 1)`.
   * `refusedBy3a` is the MEASURED classification, and it is asserted as an
   * exact map below — widening 3a without updating it is a failure, which is
   * what keeps GRAMMAR.md's "3a is not the closure" claim from going stale.
   */
  const SPELLINGS: { name: string; stmtBody: string; refusedBy3a: boolean }[] = [
    { name: "direct literal", stmtBody: `'TEST FAILED (${ARM}): x'`, refusedBy3a: true },
    { name: "concatenated", stmtBody: `'TEST FAI' || 'LED (${ARM}): x'`, refusedBy3a: true },
    { name: "concatenated at the paren", stmtBody: `'TEST FAILED (' || '${ARM}): x'`, refusedBy3a: true },
    { name: "format() interpolation", stmtBody: `format('TEST FA%sED (${ARM}): x', 'IL')`, refusedBy3a: false },
    { name: "chr() assembled", stmtBody: `chr(84) || 'EST FAILED (${ARM}): x'`, refusedBy3a: false },
  ];

  /** The annotation a spelling produces, built the way a real one is. */
  const SETUP_FILE = "supabase/tests/test_strategy_shares_rls.sql";
  const annotationFor = (stmtBody: string) =>
    [
      `-- RED-UNDER-SETUP: {"apply":["${SETUP_FILE}"]}`,
      `  -- RED-UNDER: prose`,
      `  -- RED-UNDER-M: {"arm":"${ARM}","apply":[{"kind":"sql","stmt":${JSON.stringify(
        `DO $$ BEGIN RAISE EXCEPTION '%', ${stmtBody}; END $$`,
      )}}]}`,
    ].join("\n");

  it("the spelling table is non-empty, names ONE arm throughout, and covers BOTH sides of 3a", () => {
    // What the old arm at this position claimed in its title and did not do.
    expect(SPELLINGS.length).toBeGreaterThan(3);
    for (const s of SPELLINGS) {
      expect(s.stmtBody, `${s.name} is empty`).not.toBe("");
      expect(s.stmtBody, `${s.name} does not name ${ARM}`).toContain(ARM);
    }
    // A table that is all-refused or all-invisible would make one of the two
    // arms below vacuous.
    expect(SPELLINGS.some((s) => s.refusedBy3a)).toBe(true);
    expect(SPELLINGS.some((s) => !s.refusedBy3a)).toBe(true);
  });

  it.each(SPELLINGS)(
    "3a's verdict on the $name spelling is the MEASURED one — the spelling reaches the real parser",
    ({ name, stmtBody, refusedBy3a }) => {
      // ⭐ THIS is what makes `stmtBody` load-bearing: it goes into the parser,
      // and the parser's answer is what is asserted. Garbage here changes the
      // verdict and reds the arm.
      const result = parseAnnotations(annotationFor(stmtBody), { file: "g.sql" });
      if (refusedBy3a) {
        expect(result.structured, `${name} was ACCEPTED but is listed as refused`).toHaveLength(0);
        expect(soleError(result)).toMatch(/injects a "TEST FAILED \(" literal/);
      } else {
        // Deliberately invisible to 3a. If this flips, 3a has been widened and
        // GRAMMAR.md's honest-scope note is stale — that is the finding, not
        // this arm.
        expect(
          result.errors,
          `3a now sees the ${name} spelling; GRAMMAR.md's "3a is not the closure" note must be re-examined`,
        ).toHaveLength(0);
        expect(result.structured).toHaveLength(1);
      }
    },
  );

  /**
   * 3c's real input space: what the LANE printed. Generated over the shapes a
   * psql log actually produces, because that — not the annotation's spelling —
   * is what `unstampedIdentities` and `firstFailureArm` read.
   */
  const laneOutputShapes = (identity: string) => [
    { name: "bare line", text: `${identity}: x\n` },
    { name: "psql ERROR prefix", text: `psql:gate.sql:12: ERROR:  ${identity}: x\n` },
    { name: "preceded by unrelated NOTICE lines", text: `NOTICE:  step 1 ok\nNOTICE:  step 2 ok\nERROR:  ${identity}: x\n` },
    { name: "mid-line, after other text", text: `ERROR:  something then ${identity}: x\n` },
    { name: "trailing CONTEXT lines", text: `ERROR:  ${identity}: x\nCONTEXT:  PL/pgSQL function inline_code_block\n` },
    { name: "repeated twice", text: `ERROR:  ${identity}: x\nERROR:  ${identity}: y\n` },
    { name: "no trailing newline", text: `ERROR:  ${identity}: x` },
  ];

  it("the lane-output generator is non-empty and every shape really contains the identity", () => {
    const shapes = laneOutputShapes(`TEST FAILED (${ARM})`);
    expect(shapes.length).toBeGreaterThan(5);
    for (const s of shapes) expect(s.text, s.name).toContain(`TEST FAILED (${ARM})`);
  });

  it.each(laneOutputShapes(`TEST FAILED (${ARM})`))(
    "ORACLE: an UNSTAMPED identity in the $name shape is reported SYNTHESISED and is not readable as a first failure",
    ({ text }) => {
      const nonce = makeIdentityNonce();
      const unstamped = unstampedIdentities(text, nonce);
      expect(
        unstamped.length,
        "the detector saw NO unstamped identity in a shape that contains one",
      ).toBeGreaterThan(0);
      expect(
        [...new Set(unstamped)],
        "the runner stamped no such identity, so it must be reported as SYNTHESISED",
      ).toEqual([ARM]);
      expect(
        firstFailureArm(text, nonce),
        "an unstamped identity must not be readable as a first failure",
      ).toBeNull();
    },
  );

  it.each(laneOutputShapes("__STAMP__"))(
    "the OTHER direction: a STAMPED identity in the $name shape IS read, and reports no synthesis",
    ({ text }) => {
      // A detector that refused everything would pass every arm above while
      // rejecting the entire real corpus.
      const nonce = makeIdentityNonce();
      const real = text.replace(/__STAMP__/g, stampedIdentity(nonce, ARM));
      expect(real, "the stamp substitution must have happened").not.toContain("__STAMP__");
      expect(firstFailureArm(real, nonce)).toBe(ARM);
      expect(unstampedIdentities(real, nonce)).toEqual([]);
    },
  );

  it("a MIXTURE reports both halves: the stamped arm is the first failure, the unstamped one is synthesised", () => {
    // Neither table above can see this, and it is the shape a real attack
    // produces — an injected raise landing beside the gate's own.
    const nonce = makeIdentityNonce();
    const out =
      `ERROR:  ${stampedIdentity(nonce, "ANON 1a")}: real\n` +
      `ERROR:  TEST FAILED (${ARM}): forged\n`;
    expect(firstFailureArm(out, nonce)).toBe("ANON 1a");
    expect(unstampedIdentities(out, nonce)).toEqual([ARM]);
  });

  it("a STAMPED identity is read, and reads back as the arm the gate declares", () => {
    // The other direction. Without this the nonce could be "passed" by never
    // recognising anything, which would refuse the entire corpus.
    const nonce = makeIdentityNonce();
    const gate = stampIdentities("RAISE EXCEPTION 'TEST FAILED (ANON 1a): x';", nonce);
    expect(gate).toContain(stampedIdentity(nonce, "ANON 1a"));

    const laneOutput = `ERROR:  ${stampedIdentity(nonce, "ANON 1a")}: x\n`;
    expect(firstFailureArm(laneOutput, nonce)).toBe("ANON 1a");
    expect(unstampedIdentities(laneOutput, nonce)).toEqual([]);
  });

  it("the nonce is fresh per call — a fixed stamp would be forgeable by an annotation", () => {
    const seen = new Set(Array.from({ length: 50 }, () => makeIdentityNonce()));
    expect(seen.size).toBe(50);
  });

  it("stamping the REAL gate stamps every identity and leaves no unstamped one behind", () => {
    const gate = readFileSync(join(REPO_ROOT, "supabase/tests/test_strategy_shares_rls.sql"), "utf8");
    const nonce = makeIdentityNonce();
    const stamped = stampIdentities(gate, nonce);
    expect(unstampedIdentities(stamped, nonce)).toEqual([]);
    // Non-vacuity: it stamped a real number of identities, not zero.
    expect(armIdentities(gate).length).toBeGreaterThan(50);
    expect(armIdentities(stamped).length).toBe(armIdentities(gate).length);
  });

  it("no `find` or `anchor` in the REAL corpus names the literal, which is what makes stamping safe", () => {
    // Stamping runs BEFORE the mutation steps, so a needle containing
    // `TEST FAILED (` would stop matching and the arm would report an
    // occurrence-mismatch instead of running. Rule 3a's needle half forbids
    // exactly that — this arm pins the dependency rather than leaving it
    // implicit between two files.
    const scan = scanCorpus(join(REPO_ROOT, "supabase", "tests"));
    const needles: string[] = [];
    for (const { result } of scan.results) {
      for (const ann of result.structured) {
        for (const step of ann.apply ?? []) {
          if (step.kind === "edit") needles.push(step.find);
          if (step.kind === "insert-after") needles.push(step.anchor);
        }
      }
    }
    expect(needles.length).toBe(49);
    expect(needles.filter((n) => /TEST\s+FAILED\s*\(/i.test(n))).toEqual([]);
  });
});

describe("against the real corpus (reads via node:fs, never shell grep)", () => {
  const GATE = join(REPO_ROOT, "supabase", "tests", "test_strategy_shares_rls.sql");

  it("finds exactly 30 line-start prose markers — NOT the 33 a naive substring count reports", () => {
    const result = parseFile(GATE);
    expect(result.prose).toHaveLength(30);

    // Prove the 33 is real and is what anchoring excludes: the naive count over
    // the same bytes must be strictly larger, or this test is asserting nothing.
    const naive = readFileSync(GATE, "utf8").split("RED-UNDER").length - 1;
    expect(naive).toBeGreaterThan(30);
  });

  it("IN-01: scanCorpus counts a STRUCTURED-ONLY file as annotated, so the runner's own parity gate reaches it", () => {
    // `runCorpus` and `parseOnlyCorpus` iterate `annotatedFiles` and nothing
    // else. While that list required a PROSE marker, a file with five
    // `RED-UNDER-M` twins and no prose was never parsed, never
    // parity-checked, its arms never executed, and no defect was raised — the
    // runner reported clean having not looked at it. Asserted through a real
    // temp directory rather than by reading the source, so the property is the
    // subject and not the implementation.
    const dir = mkdtempSync(join(tmpdir(), "scan-corpus-"));
    try {
      writeFileSync(
        join(dir, "structured_only.sql"),
        [
          "  -- RED-UNDER-SETUP: {\"apply\":[\"supabase/migrations/x.sql\"]}",
          '  -- RED-UNDER-M: {"arm":"A","apply":[{"kind":"sql","stmt":"SELECT 1"}]}',
        ].join("\n"),
      );
      writeFileSync(join(dir, "plain.sql"), "SELECT 1;\n");

      const corpus = scanCorpus(dir);

      expect(corpus.filesTotal).toBe(2);
      expect(corpus.annotatedFiles).toEqual(["structured_only.sql"]);
      // And once it IS in the list, the parity gate sees it and fails it.
      const scanned = corpus.results.find((r) => r.name === "structured_only.sql");
      expect(scanned?.result.parity).toMatchObject({ prose: 0, structured: 1, ok: false });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("scanCorpus reports 1 of 71 files annotated", () => {
    const corpus = scanCorpus(join(REPO_ROOT, "supabase", "tests"));
    expect(corpus.filesTotal).toBe(71);
    expect(corpus.filesAnnotated).toBe(1);
    expect(corpus.annotatedFiles).toEqual(["test_strategy_shares_rls.sql"]);
  });
});
