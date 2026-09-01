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
  attributeIdentities,
  failureBranches,
  gateAttributionRecords,
  identityRewriteDetail,
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
// 164.3.1-05 — arm identity by SOURCE LOCATION (supersedes the R3-C02 nonce)
// ══════════════════════════════════════════════════════════════════════════
describe("GRAMMAR rule 3c — an identity is READ only where the RUNNER's gate raised it", () => {
  // ⛔ WHY SOURCE LOCATION AND NOT A NONCE. The nonce (R3-C02, 2026-08-29)
  // stamped a per-run secret into the gate's identities and read only stamped
  // ones. [R4-C02] MEASURED that dead: the stamp travels in the QUERY TEXT of
  // the statement the gate is running, and PostgreSQL hands query text to
  // server-side code. An `AFTER INSERT` trigger installed by a `sql` step read
  // it back with `current_query()` and re-raised it, and an arm guarded by
  // `IF FALSE` scored `RED (identity ok)` with `biting: 1`.
  //
  // The identity is now WHERE the raise came from, which the executing SQL
  // cannot choose. Three legs, ALL required:
  //   (a) the `psql:` prefix names this lane's gate scratch file;
  //   (b) the CONTEXT chain is EXACTLY ONE `inline_code_block line N at RAISE`;
  //   (c) stmtStartLine + N − 1 === the arm's recorded raise line.
  //
  // ⚠️ EVERY OUTPUT SHAPE BELOW WAS MEASURED, not composed. They are the
  // verbatim bytes `scripts/pg-lane/run.sh` emitted from a throwaway
  // PostgreSQL 16.13 cluster on 2026-09-01 (the same six drives recorded in
  // `164.3.1-05-ATTRIBUTION.md`), with only the absolute scratch path
  // substituted. A pin written from the shape the parser expects would test
  // the parser against itself.

  /** The gate path psql echoes — the runner passes an absolute scratch path. */
  const GATE_PATH = "/tmp/mut-slot-7/src/supabase/tests/gate.sql";
  const OTHER_PATH = "/tmp/mut-slot-7/post-apply.sql";
  const LOCATION = "LOCATION:  exec_stmt_raise, pl_exec.c:3911";

  /**
   * The genuine gate: `DO` on line 3, the RAISE on line 7, `END $$;` on line 9.
   * Real SQL text, tokenized by the real `gateAttributionRecords`, so the
   * record arithmetic is under test rather than hand-supplied.
   */
  const GENUINE_GATE = [
    "-- case 1: genuine single-frame DO raise",
    "-- (DO on line 3, RAISE on line 7, END on line 9)",
    "DO $$",
    "BEGIN",
    "  RAISE NOTICE 'about to raise';",
    "  IF TRUE THEN",
    "    RAISE EXCEPTION 'TEST FAILED (X 1): demo arm';",
    "  END IF;",
    "END $$;",
    "",
  ].join("\n");

  /** Two DO blocks; the raise is in the SECOND (line 9, block 6-10). */
  const TWO_BLOCK_GATE = [
    "-- case 4: multi-statement gate, raise in the SECOND DO block",
    "DO $$",
    "BEGIN",
    "  RAISE NOTICE 'first block ok';",
    "END $$;",
    "DO $$",
    "BEGIN",
    "  RAISE NOTICE 'second block starting';",
    "  RAISE EXCEPTION 'TEST FAILED (Y 2): from second block';",
    "END $$;",
    "",
  ].join("\n");

  /** The forgery's target: `DO` line 2, RAISE line 6, `END $$;` line 8. */
  const FORGERY_TARGET_GATE = [
    "-- case 5/6: the arm the forgery aims at; its own guard is IF FALSE",
    "DO $$",
    "BEGIN",
    "  INSERT INTO t VALUES (1);",
    "  IF FALSE THEN",
    "    RAISE EXCEPTION 'TEST FAILED (X 1): the arm under test fired.';",
    "  END IF;",
    "END $$;",
    "",
  ].join("\n");

  const attribute = (output: string, gateText: string, gatePath = GATE_PATH) =>
    attributeIdentities(output, { gatePath, records: gateAttributionRecords(gateText) });

  // ── The record arithmetic itself (the plan-01 span contract, consumed) ────

  it("gateAttributionRecords resolves a DO-body raise to its enclosing block's span", () => {
    expect(gateAttributionRecords(GENUINE_GATE)).toEqual([
      { arm: "X 1", raiseFileLine: 7, stmtStartLine: 3, stmtEndLine: 9 },
    ]);
    expect(gateAttributionRecords(TWO_BLOCK_GATE)).toEqual([
      { arm: "Y 2", raiseFileLine: 9, stmtStartLine: 6, stmtEndLine: 10 },
    ]);
  });

  it("a `TEST FAILED (` that is not RAISED yields no record — a comment is not a statement", () => {
    // The mini-gate fixture carries the literal inside a `--` documentation
    // comment. A record for it would let a forged raise attribute to a line
    // nothing executes.
    const gate = [
      "-- RAISE EXCEPTION 'TEST FAILED (<ARM ID>): explanation'",
      "DO $$",
      "BEGIN",
      "  RAISE EXCEPTION 'TEST FAILED (REAL 1): x';",
      "END $$;",
      "",
    ].join("\n");
    expect(gateAttributionRecords(gate).map((r) => r.arm)).toEqual(["REAL 1"]);
  });

  // ── The five measured PG 16.13 output shapes ─────────────────────────────

  it("MEASURED shape 1 — a genuine single-frame DO raise is ATTRIBUTED", () => {
    const output = [
      `psql:${GATE_PATH}:9: NOTICE:  00000: about to raise`,
      LOCATION,
      `psql:${GATE_PATH}:9: ERROR:  P0001: TEST FAILED (X 1): demo arm`,
      "CONTEXT:  PL/pgSQL function inline_code_block line 5 at RAISE",
      LOCATION,
      "",
    ].join("\n");
    const r = attribute(output, GENUINE_GATE);
    expect(r.measureFail).toBeNull();
    expect(r.firstAttributed).toBe("X 1");
    expect(r.unattributable).toEqual([]);
  });

  it("MEASURED shape 2 — a trigger raise (named-function frame) is UNATTRIBUTABLE", () => {
    // The R4-C02 path: an AFTER INSERT trigger installed by a `sql` step,
    // raising the arm's exact message text. The nonce scored this RED.
    const output = [
      `psql:${GATE_PATH}:2: ERROR:  P0001: TEST FAILED (X 1): demo arm`,
      "CONTEXT:  PL/pgSQL function forge_fn() line 3 at RAISE",
      LOCATION,
      "",
    ].join("\n");
    const r = attribute(output, GENUINE_GATE);
    expect(r.firstAttributed).toBeNull();
    expect(r.unattributable.map((u) => u.identity)).toEqual(["X 1"]);
    expect(r.unattributable[0].why).toMatch(/forge_fn\(\)/);
  });

  it("MEASURED shape 3 — a trigger fired from INSIDE a DO (multi-frame) is UNATTRIBUTABLE", () => {
    const output = [
      `psql:${GATE_PATH}:5: ERROR:  P0001: TEST FAILED (X 1): demo arm`,
      "CONTEXT:  PL/pgSQL function forge_fn() line 3 at RAISE",
      'SQL statement "INSERT INTO t VALUES (1)"',
      "PL/pgSQL function inline_code_block line 3 at SQL statement",
      LOCATION,
      "",
    ].join("\n");
    const r = attribute(output, GENUINE_GATE);
    expect(r.firstAttributed).toBeNull();
    // `inline_code_block` DOES appear in the chain here — but deeper, and only
    // `at SQL statement`. Matching the string anywhere in the chain would
    // accept this.
    expect(r.unattributable[0].why).toMatch(/EXACTLY ONE/);
  });

  it("MEASURED shape 4 — a raise in the SECOND DO block attributes via DO_start + N − 1", () => {
    const output = [
      `psql:${GATE_PATH}:5: NOTICE:  00000: first block ok`,
      LOCATION,
      "DO",
      `psql:${GATE_PATH}:10: NOTICE:  00000: second block starting`,
      LOCATION,
      `psql:${GATE_PATH}:10: ERROR:  P0001: TEST FAILED (Y 2): from second block`,
      "CONTEXT:  PL/pgSQL function inline_code_block line 4 at RAISE",
      LOCATION,
      "",
    ].join("\n");
    const r = attribute(output, TWO_BLOCK_GATE);
    expect(r.firstAttributed).toBe("Y 2");
    // Non-vacuity: the arithmetic is what carried it. 6 + 4 − 1 = 9, and 9 is
    // the raise's real file line — a parser that ignored N would also "pass".
    expect(gateAttributionRecords(TWO_BLOCK_GATE)[0]).toMatchObject({
      stmtStartLine: 6,
      raiseFileLine: 9,
    });
  });

  it("MEASURED shape 5 — the nested-EXECUTE DO FORGERY is REFUSED, and ONLY the chain rule refuses it", () => {
    // ⭐ THE SINGLE MOST IMPORTANT PIN IN THIS FILE. A trigger running
    // `EXECUTE 'DO $d$' || repeat(E'\n', 4) || 'BEGIN RAISE …; END $d$'`
    // produces an `inline_code_block … at RAISE` innermost frame whose NAME
    // AND LINE are attacker-chosen, under the gate file's own prefix.
    // MEASURED 2026-09-01: with 4 padding newlines it landed on the genuine
    // arm's EXACT resolved line.
    const output = [
      `psql:${GATE_PATH}:8: ERROR:  P0001: TEST FAILED (X 1): forged with padded line`,
      "CONTEXT:  PL/pgSQL function inline_code_block line 5 at RAISE",
      'SQL statement "DO $d$',
      "",
      "",
      "",
      `BEGIN RAISE EXCEPTION 'TEST FAILED (X 1): forged with padded line'; END $d$"`,
      "PL/pgSQL function forge_fn() line 3 at EXECUTE",
      'SQL statement "INSERT INTO t VALUES (1)"',
      "PL/pgSQL function inline_code_block line 3 at SQL statement",
      LOCATION,
      "",
    ].join("\n");
    const r = attribute(output, FORGERY_TARGET_GATE);

    expect(r.firstAttributed, "the forgery must NOT be attributable to the arm").toBeNull();
    expect(r.unattributable[0].why).toMatch(/EXACTLY ONE/);

    // ⛔ NON-VACUITY — the reason this pin exists at all. Legs (a) and (c) BOTH
    // PASS for this forgery: the prefix names the gate file at the right
    // statement end line, and the forged CONTEXT line resolves to the genuine
    // arm's real raise line. If either of those did not hold, the refusal
    // above would prove nothing about the CHAIN rule. Assert it directly.
    const rec = gateAttributionRecords(FORGERY_TARGET_GATE)[0];
    expect(rec, "leg (a): the forgery's psql prefix line IS the block's end line").toMatchObject({
      stmtEndLine: 8,
    });
    expect(
      rec.stmtStartLine + 5 - 1,
      "leg (c): the forged CONTEXT line 5 resolves to the genuine arm's raise line",
    ).toBe(rec.raiseFileLine);

    // And the control: the SAME gate, the SAME arm, raised genuinely, IS read.
    const genuine = [
      `psql:${GATE_PATH}:8: ERROR:  P0001: TEST FAILED (X 1): the arm under test fired.`,
      "CONTEXT:  PL/pgSQL function inline_code_block line 5 at RAISE",
      LOCATION,
      "",
    ].join("\n");
    expect(
      attribute(genuine, FORGERY_TARGET_GATE).firstAttributed,
      "an attribution that refuses everything would also refuse the forgery",
    ).toBe("X 1");
  });

  // ── The three shapes that are not a CONTEXT chain problem ────────────────

  it("MEASURED — `TEST FAILED (…)` carried by a RAISE NOTICE is UNATTRIBUTABLE (the lane exited 0)", () => {
    // The strongest property of the nonce design was that it scanned ALL
    // output, not the first ERROR. A NOTICE forges the identity WITHOUT
    // aborting the lane, so a first-ERROR-only reader sees nothing at all.
    const output = [
      `psql:${GATE_PATH}:8: NOTICE:  00000: TEST FAILED (X 1): carried by a NOTICE`,
      LOCATION,
      "DO",
      "",
    ].join("\n");
    const r = attribute(output, FORGERY_TARGET_GATE);
    expect(r.firstAttributed).toBeNull();
    expect(r.unattributable.map((u) => u.identity)).toEqual(["X 1"]);
    expect(r.unattributable[0].why).toMatch(/severity is NOTICE/);
  });

  it("a perfect single-frame raise from a NON-GATE file is UNATTRIBUTABLE (leg (a))", () => {
    // The `sql` steps run from `post-apply.sql`. Everything else about this
    // block is indistinguishable from shape 1.
    const output = [
      `psql:${OTHER_PATH}:9: ERROR:  P0001: TEST FAILED (X 1): demo arm`,
      "CONTEXT:  PL/pgSQL function inline_code_block line 5 at RAISE",
      LOCATION,
      "",
    ].join("\n");
    const r = attribute(output, GENUINE_GATE);
    expect(r.firstAttributed).toBeNull();
    expect(r.unattributable[0].why).toMatch(/post-apply\.sql/);
  });

  it("a single frame resolving to the WRONG line is UNATTRIBUTABLE (leg (c))", () => {
    // Same file, same shape, CONTEXT line 4 instead of 5 → file line 6, and
    // the arm is raised at 7.
    const output = [
      `psql:${GATE_PATH}:9: ERROR:  P0001: TEST FAILED (X 1): demo arm`,
      "CONTEXT:  PL/pgSQL function inline_code_block line 4 at RAISE",
      LOCATION,
      "",
    ].join("\n");
    const r = attribute(output, GENUINE_GATE);
    expect(r.firstAttributed).toBeNull();
    expect(r.unattributable[0].why).toMatch(/source location does not match/);
    // SC-7: the diagnostic must say what it saw AND what it wanted.
    expect(r.unattributable[0].why).toContain("CONTEXT line 4");
    expect(r.unattributable[0].why).toContain(`${GATE_PATH}:7`);
  });

  it("an identity the gate does not raise at all is UNATTRIBUTABLE, naming that", () => {
    const output = [
      `psql:${GATE_PATH}:9: ERROR:  P0001: TEST FAILED (GHOST 9): never declared`,
      "CONTEXT:  PL/pgSQL function inline_code_block line 5 at RAISE",
      LOCATION,
      "",
    ].join("\n");
    const r = attribute(output, GENUINE_GATE);
    expect(r.firstAttributed).toBeNull();
    expect(r.unattributable[0].why).toMatch(/declares no RAISE for "GHOST 9"/);
  });

  it("VERBOSITY=verbose is required, and its absence is refused rather than assumed", () => {
    // The default-verbosity shape: no `P0001:` token, no `LOCATION:` sentinel.
    // Without the sentinel the chain's extent is unknown, so its frame count
    // is not assertable — that must refuse, never silently accept.
    const output = [
      `psql:${GATE_PATH}:9: ERROR:  TEST FAILED (X 1): demo arm`,
      "CONTEXT:  PL/pgSQL function inline_code_block line 5 at RAISE",
      "",
    ].join("\n");
    const r = attribute(output, GENUINE_GATE);
    expect(r.firstAttributed).toBeNull();
    expect(r.unattributable[0].why).toMatch(/VERBOSITY=verbose/);
  });

  // ── The output-grammar residual: loud, never silent ──────────────────────

  it("MEASURE_FAIL: psql-shaped output the parser cannot read is a LOUD failure, not 'no arm'", () => {
    // ⚠️ WINDOWS.md 28: the `sql-mutation` job has never executed on its ubuntu
    // CI host. If that host's psql speaks a different (or localized) grammar,
    // "no attributable arm" would read exactly like a real defect and a green
    // lane would read like a pass. It gets its own name instead.
    const localized = [
      `psql:${GATE_PATH}:9: FEHLER:  P0001: TEST FAILED (X 1): demo arm`,
      "KONTEXT:  PL/pgSQL-Funktion inline_code_block Zeile 5 bei RAISE",
      "",
    ].join("\n");
    const r = attribute(localized, GENUINE_GATE);
    expect(r.measureFail, "an unparseable psql grammar must not read as a clean 'no identity'").not.toBeNull();
    expect(r.measureFail).toContain("FEHLER");
    expect(r.blocks).toBe(0);

    // The other direction — a parseable output must NOT raise MEASURE_FAIL, or
    // the control would fire on every real run and mean nothing.
    const fine = [
      `psql:${GATE_PATH}:9: ERROR:  P0001: TEST FAILED (X 1): demo arm`,
      "CONTEXT:  PL/pgSQL function inline_code_block line 5 at RAISE",
      LOCATION,
      "",
    ].join("\n");
    expect(attribute(fine, GENUINE_GATE).measureFail).toBeNull();
  });

  it("empty or non-psql output is NOT a MEASURE_FAIL — the control must be specific", () => {
    expect(attribute("", GENUINE_GATE).measureFail).toBeNull();
    expect(attribute("cluster on 127.0.0.1:5433 never became ready\n", GENUINE_GATE).measureFail).toBeNull();
  });

  // ── The nonce channel is GONE, not deprecated-but-live ───────────────────

  it("no nonce helper is exported any more — the forgeable channel is REMOVED", async () => {
    // Checked on the module's EXPORT SURFACE, not on comment text: a helper
    // that still exists is a path an attacker reaches through current_query().
    const mod: Record<string, unknown> = await import("../../scripts/mutation-runner/run.mjs");
    for (const gone of [
      "makeIdentityNonce",
      "stampIdentities",
      "stampedIdentity",
      "firstFailureArm",
      "unstampedIdentities",
    ]) {
      expect(mod[gone], `${gone} must no longer exist`).toBeUndefined();
    }
    expect(typeof mod.attributeIdentities).toBe("function");
    expect(typeof mod.gateAttributionRecords).toBe("function");
  });

  // ── Against the real corpus: the passing control, corpus-wide ────────────

  it("REAL CORPUS: every identity resolves to a single-frame DO-body raise", () => {
    // A3 (RESEARCH): all 104 corpus identities raise directly from a DO body,
    // which is what makes the single-frame rule safe to enforce. If that ever
    // stops being true this arm says so before the runner does.
    const gate = readFileSync(join(REPO_ROOT, "supabase/tests/test_strategy_shares_rls.sql"), "utf8");
    const records = gateAttributionRecords(gate);
    expect(records.length).toBeGreaterThan(50);
    for (const r of records) {
      expect(r.stmtStartLine, `${r.arm}: raise before its enclosing block`).toBeLessThan(r.raiseFileLine);
      expect(r.raiseFileLine, `${r.arm}: raise after its enclosing block`).toBeLessThan(r.stmtEndLine);
    }
    // Non-vacuity: the count matches the identities the file actually carries,
    // minus the ones that are not raised (documentation comments).
    expect(records.length).toBeLessThanOrEqual(armIdentities(gate).length);
  });

  it("REAL CORPUS: a genuine arm's measured output shape attributes against the real gate", () => {
    // The wiring, not the helper: the real gate's real bytes, the real
    // tokenizer, and the psql shape the lane really emits for that arm.
    const gate = readFileSync(join(REPO_ROOT, "supabase/tests/test_strategy_shares_rls.sql"), "utf8");
    const records = gateAttributionRecords(gate);
    const rec = records[0];
    const contextLine = rec.raiseFileLine - rec.stmtStartLine + 1;
    const output = [
      `psql:${GATE_PATH}:${rec.stmtEndLine}: ERROR:  P0001: TEST FAILED (${rec.arm}): real`,
      `CONTEXT:  PL/pgSQL function inline_code_block line ${contextLine} at RAISE`,
      LOCATION,
      "",
    ].join("\n");
    expect(attributeIdentities(output, { gatePath: GATE_PATH, records }).firstAttributed).toBe(rec.arm);
  });

  it("no `find` or `anchor` in the REAL corpus names the literal — rule 3b's needle half", () => {
    // This pinned the nonce's stamping safety until 2026-09-01. The stamp is
    // gone, so that dependency is gone with it — but the rule itself is not:
    // `identityRewriteDetail` compares failure branches across a step, and a
    // needle naming the literal is how an annotation re-points one.
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
