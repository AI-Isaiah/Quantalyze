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
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  IDENTITY_CARRIER,
  PG_CRON_EXTENSION,
  classifyGateIdiom,
  gateNeedsPgCron,
  parseAnnotations,
  parseFile,
  scanCorpus,
  tokenizeStatements,
} from "../../scripts/mutation-runner/parse.mjs";
import {
  FAILURE_BRANCH_LOOKBACK,
  applyFileStep,
  armIdentities,
  attributeIdentities,
  countOccurrences,
  failureBranches,
  gateAttributionRecords,
  identityRewriteDetail,
  parseOnlyCorpus,
  sectionOfIdentity,
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
    // Measured before shipping the rule: 0 of 30. RE-MEASURED 2026-09-03
    // (plan 164.4-02): 0 of 45. Pinned so the remaining 164.4 backfill cannot
    // quietly introduce the shape and then be "fixed" by relaxing the rule.
    const result = parseFile(
      join(REPO_ROOT, "supabase", "tests", "test_strategy_shares_rls.sql"),
    );
    expect(result.errors).toEqual([]);
    expect(result.structured).toHaveLength(45);
  });

  // ── 164.4 authoring rule (threat T-164.4-01): NO TWIN MAY TARGET A STAND-IN ─
  // A mutation to `scripts/pg-lane/fixtures/**` reddens the gate and would be
  // counted as biting, but what it proved is that the FIXTURE AUTHOR'S GUESS
  // can be broken — the production object the arm defends was never touched.
  // Both polarities, because a rule that refuses everything is no better than
  // one that refuses nothing.
  it("ACCEPTS a step targeting a real migration — the rule refuses a directory, not mutation", () => {
    const sql = [
      "  -- RED-UNDER: prose",
      `  -- RED-UNDER-M: {"arm":"X","apply":[{"kind":"edit","file":"supabase/migrations/20260827120000_strategy_shares_generation_model.sql","find":"generation  BIGINT","replace":"generation  INTEGER","occurrences":1}]}`,
    ].join("\n");
    const result = parseAnnotations(sql, { file: "g.sql" });
    expect(result.errors).toEqual([]);
    expect(result.structured).toHaveLength(1);
  });

  it("REFUSES a step targeting a pg-lane stand-in fixture, naming the rule and the prefix", () => {
    // ⛔ EVERY spelling below OPENS THE SAME FILE ON DISK once `materialize`
    // does `join(REPO_ROOT, step.file)` — `scripts/pg-lane/fixtures/` really
    // holds `01-fixture-core.sql` and `03-fixture-compute-jobs.sql`. The last
    // four are not hypotheses: MEASURED 2026-09-02, a prefix test over the RAW
    // spelling refused only the first two and let the rest straight through,
    // and `bad-file-ref` compares `step.file` to the corpus by exact string, so
    // listing the same odd spelling in RED-UNDER-SETUP satisfied that check
    // too. Pinned BY FIXTURE so a future rewrite of `targetsPgLaneFixture`
    // cannot silently narrow back to a string prefix. The case-folded spelling
    // matters because this repo's checkout is case-insensitive (macOS), so
    // `Scripts/PG-Lane/Fixtures/…` opens the identical stand-in.
    for (const target of [
      "scripts/pg-lane/fixtures/01-fixture-core.sql",
      "scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql",
      // The obvious spelling evasion: the same path with a `./` prefix.
      "./scripts/pg-lane/fixtures/01-fixture-core.sql",
      // A `.` segment INSIDE the path — `join` drops it.
      "scripts/pg-lane/./fixtures/03-fixture-compute-jobs.sql",
      // An empty segment from a doubled separator — `join` drops it too.
      "scripts/pg-lane//fixtures/03-fixture-compute-jobs.sql",
      // Case folding: identical file on a case-insensitive filesystem.
      "Scripts/PG-Lane/Fixtures/01-fixture-core.sql",
    ]) {
      const sql = [
        "  -- RED-UNDER: prose",
        `  -- RED-UNDER-M: {"arm":"X","apply":[{"kind":"edit","file":"${target}","find":"a","replace":"b","occurrences":1}]}`,
      ].join("\n");
      const err = soleError(parseAnnotations(sql, { file: "g.sql" }));
      expect(err, `not refused: ${target}`).toMatch(/targets a pg-lane stand-in fixture/);
      // Evidence, not verdict: the message must say what to do instead.
      expect(err).toMatch(/supabase\/migrations/);
      expect(err).toMatch(/sql step/);
    }
  });

  it("does NOT over-match: a non-fixture path under the SAME directory, and a `fixtures`-prefixed sibling, are accepted", () => {
    // A refusal that refuses everything is as useless as one that refuses
    // nothing. Widening the rule to normalise (drop `.` and empty segments,
    // case-fold) must not turn it into "anything mentioning pg-lane". Both
    // targets are legitimate: `scripts/pg-lane/run.sh` is the lane driver
    // itself (it exists on disk), and a `fixtures-extra/` sibling shares the
    // prefix `fixtures` but is a DIFFERENT directory — the trailing "/" in
    // `PG_LANE_FIXTURE_DIR` is the only thing separating them.
    for (const target of ["scripts/pg-lane/run.sh", "scripts/pg-lane/fixtures-extra/x.sql"]) {
      const sql = [
        "  -- RED-UNDER: prose",
        `  -- RED-UNDER-M: {"arm":"X","apply":[{"kind":"edit","file":"${target}","find":"a","replace":"b","occurrences":1}]}`,
      ].join("\n");
      const result = parseAnnotations(sql, { file: "g.sql" });
      expect(result.errors, `wrongly refused: ${target}`).toEqual([]);
      expect(result.structured).toHaveLength(1);
    }
  });

  it("the REAL corpus contains no twin this rule refuses either — it forbids nothing that exists", () => {
    // MEASURED 2026-09-02 before shipping the rule: 0 of 30 twins in the only
    // annotated file, and `grep -a -c 'RED-UNDER-M:.*"file":"scripts/pg-lane/
    // fixtures/' supabase/tests/*.sql` -> 0 in all 71. RE-MEASURED 2026-09-03
    // (plan 164.4-02): still 0, now of 45 twins. Pinned so the backfill cannot
    // quietly introduce the shape and then be "fixed" by relaxing it.
    const result = parseFile(
      join(REPO_ROOT, "supabase", "tests", "test_strategy_shares_rls.sql"),
    );
    expect(result.errors).toEqual([]);
    expect(
      result.structured.flatMap((a) => a.apply).filter((s) => s.kind !== "sql"),
    ).not.toContainEqual(expect.objectContaining({ file: expect.stringContaining("pg-lane") }));
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
    // violations. RE-MEASURED 2026-09-03 (plan 164.4-02, the reference file's
    // 15 un-twinned sections closed): 45 arms, 59 file steps, 0 violations.
    // RE-MEASURED 2026-09-03 (plan 164.4-04, the ledger_refresh family's 41
    // sections annotated): 86 arms, 97 file steps, 0 violations. `sql` steps
    // are skipped by this walk, so the step count rises by less than the arm
    // count: 15 of the 41 new arms are grant/ownership/DROP drift on the live
    // lane, which is not a file edit and cannot rewrite an identity by 3b.
    // RE-MEASURED 2026-09-03 (plan 164.4-07, the csv-finalize-fold /
    // funding-fees / allocator-derived-equity / user-notes batch's 26 sections):
    // 189 arms, 167 file steps, 0 violations. 24 of the 26 new arms are file
    // edits — this batch's drift is mostly IN the migration text (policy
    // predicates, guard bodies, a CHECK list), so the step count rises almost
    // in step with the arm count for the first time in the phase.
    // RE-MEASURED 2026-09-04 (plan 164.4-08, the csv-double-submit /
    // trust-signals / verified-cohort-rank / downgrade-sweep / scenarios-RLS /
    // series-completeness batch's 30 sections): 219 arms, 205 file steps, 0
    // violations. The step count rises FASTER than the arm count here (38 steps
    // for 30 arms) because several twins are layered migration edits.
    // Pinned so 164.4's remaining backfill cannot introduce the shape and then
    // be "fixed" by relaxing the rule.
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
    // ⚠️ CURRENCY 2026-09-05 (plan 164.4.1-02): 272 arms / 264 file steps,
    // MEASURED, not derived from the previous pair. The two new gates added 10
    // arms carrying 11 file steps — more steps than arms once again, and from
    // the same LAYERED class: the derive gate's arm 2 must defeat BOTH halves
    // of an api_key dedup that is enforced twice over, and the copy-parity
    // gate's 3/F-3 must stand down the migration's own H5b post-verify beside
    // the sentence it shortens. One of the 10 is a `sql` step and carries no
    // needle at all, which is why 10 arms did not add 10 of each.
    // ⚠️ CURRENCY 2026-09-05 (plan 164.4.1-03): 296 arms / 292 file steps,
    // MEASURED. The retention gate added 25 twins of which ONE is a waiver — so
    // it added 24 to `armsSeen`, which skips waivers, and 28 file steps. More
    // steps than arms again, and from three named causes: three twins are
    // LAYERED because migration 20260826140000 self-verifies the body it
    // deploys, one is layered because the status scope is enforced twice over,
    // and one twin is a `sql` step carrying no needle at all.
    // ⚠️ CURRENCY 2026-09-05 (plan 164.4.1-04): 324 arms / 331 file steps,
    // MEASURED and RUN — both integers came back off the runner and the
    // assertion, not off arithmetic on the pair above. The reaper gate added 28
    // twins, all non-waiver, carrying 39 file steps plus ONE `sql` step (the
    // `2` unschedule) that carries no needle. That is 11 more steps than arms,
    // the widest gap any batch has had, and it has three named causes: FIVE
    // twins are LAYERED against a migration that self-verifies the body it
    // deploys (20260803130000's STEP 2, four times, and 20260802120000's STEP 7
    // once); SIX mutate TWO migrations at once because the deployed cron body /
    // the bridge and the stamp trigger are INDEPENDENT defences of one
    // invariant and a single-step mutation is silently repaired by the other;
    // and `1/re-base` needs FOUR steps because a `pg_get_functiondef` anchor is
    // also satisfied by a COMMENT inside the body (deferred-items D-164.4.1-04-1).
    // Corpus-wide `sql` steps: 101 of 432 total steps.
    expect(armsSeen).toBe(324);
    expect(stepsSeen).toBe(331);
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

  it.each([
    {
      block: "a closed LOOP",
      lines: ["    FOR r IN SELECT 1 LOOP", "      NULL;", "    END LOOP;"],
    },
    {
      block: "a nested IF … END IF;",
      lines: ["    IF x THEN", "      NULL;", "    END IF;"],
    },
    {
      block: "a BEGIN … END; block",
      lines: ["    BEGIN", "      NULL;", "    END;"],
    },
  ])("R3-C02 secondary behind $block: the guard is still part of the branch, so its negation is refused", ({ lines }) => {
    // CR-01 (164.3.1 review), MEASURED 2026-09-02 pre-fix on all three shapes:
    // `failureBranches` anchored the branch on the closer (`END LOOP;`, then a
    // tokenizer head) or on the block's OWN opener (`IF x THEN`, `BEGIN`), so
    // the branch text began below the guard and `identityRewriteDetail`
    // returned null for `IF NOT ok THEN` → `IF TRUE THEN` — the R3-C02
    // secondary defect, reopened for every arm with a closed block between
    // its guard and its raise. A closed block is a statement OF the branch;
    // the walk must step over it to the head that opened it.
    const before = [
      "  IF NOT ok THEN",
      ...lines,
      "    RAISE EXCEPTION 'TEST FAILED (ARM BLOCK): x';",
      "  END IF;",
    ].join("\n");
    const after = before.replace("IF NOT ok THEN", "IF TRUE THEN");
    expect(after, "the fixture's guard was not negated — the arm proves nothing").not.toBe(before);

    // Independent oracle, as in the plain-shape arm above: the identities are
    // untouched, so nothing stated over identities alone can see this.
    expect(armIdentities(after)).toEqual(armIdentities(before));

    const branches = failureBranches(before);
    expect(branches.map((b) => b.id)).toEqual(["ARM BLOCK"]);
    expect(
      branches[0].text.split("\n")[0],
      "the branch must begin at the GUARD, not at the block's closer or opener",
    ).toBe("  IF NOT ok THEN");

    expect(identityRewriteDetail(before, after, "f.sql")).toMatch(/REWRITES a failure branch/);
  });

  it("REAL GATE FILE: failure branches are found, small, and well inside the lookback bound", () => {
    // Non-vacuity for the two arms above: if `failureBranches` returned an
    // empty list, every comparison would be trivially equal and the whole rule
    // would be a control that cannot fire.
    const branches = failureBranches(readFileSync(GATE, "utf8"));
    expect(branches.length).toBeGreaterThan(50);
    const sizes = branches.map((b) => b.text.split("\n").length);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(1);
    // The bound is the runner's OWN exported constant, PINNED here against the
    // corpus's largest measured branch — not restated as a literal that could
    // drift from the one `failureBranches` actually applies.
    expect(FAILURE_BRANCH_LOOKBACK).toBeGreaterThan(0);
    expect(
      Math.max(...sizes),
      `a failure branch grew past the ${FAILURE_BRANCH_LOOKBACK}-line lookback bound (FAILURE_BRANCH_LOOKBACK in run.mjs) — the bound must be re-measured`,
    ).toBeLessThan(FAILURE_BRANCH_LOOKBACK);
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
    //
    // ⛔ SELF-REFERENTIAL ORACLE, CLOSED (164.3.1 review, testing specialist).
    // This used to build the psql output FROM `records[0]`'s own numbers
    // (`rec.stmtEndLine`, `rec.raiseFileLine - rec.stmtStartLine + 1`), so it
    // held for ANY values the tokenizer produced — a tokenizer off by one on
    // every span would have passed it. The literals below were HAND-MEASURED
    // 2026-09-02 by reading supabase/tests/test_strategy_shares_rls.sql: the
    // file is ONE `DO $$` block opening at line 207 and closing `$$;` at line
    // 2712, and the first raise inside it, `TEST FAILED (SHAPE 1)`, sits on
    // line 380. So psql's prefix names :2712 and PL/pgSQL's CONTEXT line is
    // 380 − 207 + 1 = 174. Proven to fail with any one literal moved by 1.
    // ⚠️ RE-MEASURED 2026-09-03 (plan 164.4-02): the 15 new comment-only pairs
    // sit BELOW the SHAPE 1 raise and ABOVE the block's closer, so 380/207/174
    // are unmoved and only the end line travelled, 2599 -> 2712. The
    // calibration below is what turns a stale literal into a named failure.
    const gate = readFileSync(join(REPO_ROOT, "supabase/tests/test_strategy_shares_rls.sql"), "utf8");
    const records = gateAttributionRecords(gate);
    const MEASURED = { arm: "SHAPE 1", raiseFileLine: 380, stmtStartLine: 207, stmtEndLine: 2712 };
    expect(records[0]).toMatchObject(MEASURED);
    // Calibration on the bytes themselves, so a corpus edit that moves the
    // arm is reported HERE as a stale literal rather than as a tokenizer bug.
    const lines = gate.split("\n");
    expect(lines[MEASURED.stmtStartLine - 1]).toBe("DO $$");
    expect(lines[MEASURED.raiseFileLine - 1]).toContain("RAISE EXCEPTION 'TEST FAILED (SHAPE 1)");
    expect(lines[MEASURED.stmtEndLine - 1]).toBe("$$;");
    const output = [
      `psql:${GATE_PATH}:2712: ERROR:  P0001: TEST FAILED (SHAPE 1): real`,
      "CONTEXT:  PL/pgSQL function inline_code_block line 174 at RAISE",
      LOCATION,
      "",
    ].join("\n");
    expect(attributeIdentities(output, { gatePath: GATE_PATH, records }).firstAttributed).toBe("SHAPE 1");
  });

  // ── F1 — the MESSAGE-EMBEDDED forgery: fields the message spelled ────────
  //
  // MEASURED 2026-09-02 on PG 16 through the real lane (this checkout): a
  // trigger raising `E'TEST FAILED (X)\nCONTEXT:  …\nLOCATION:  …'` from
  // inside the gate's DO prints the forged pair BEFORE the real chain, and the
  // real chain is what the attacker cannot suppress.

  it("F1 MEASURED: a RAISE whose MESSAGE embeds a forged single-frame CONTEXT + LOCATION is UNATTRIBUTABLE, naming the duplicated field", () => {
    // Verbatim shape from the lane, gate path substituted. The forged frame is
    // AIMED: line 5 resolves to FORGERY_TARGET_GATE's real raise (2 + 5 − 1 =
    // 6), the prefix names the block's end line 8, and the forged chain IS one
    // frame — legs (a), (b) and (c) all pass on the forged pair. Pre-fix this
    // attributed to "X 1".
    const output = [
      `psql:${GATE_PATH}:8: ERROR:  P0001: TEST FAILED (X 1): forged`,
      "CONTEXT:  PL/pgSQL function inline_code_block line 5 at RAISE",
      LOCATION,
      "CONTEXT:  PL/pgSQL function forge_fn() line 1 at RAISE",
      'SQL statement "INSERT INTO t VALUES (1)"',
      "PL/pgSQL function inline_code_block line 3 at SQL statement",
      LOCATION,
      "",
    ].join("\n");
    const r = attribute(output, FORGERY_TARGET_GATE);
    expect(r.measureFail).toBeNull();
    expect(r.firstAttributed, "the message-embedded forgery must NOT attribute").toBeNull();
    expect(r.unattributable.map((u) => u.identity)).toEqual(["X 1"]);
    expect(r.unattributable[0].why).toMatch(/duplicated diagnostic field — message-embedded forgery/);
    expect(r.unattributable[0].why).toContain("CONTEXT, LOCATION, CONTEXT, LOCATION");
    // Non-vacuity: the forged pair alone WOULD attribute — it is the real
    // chain's presence, not the forged frame's shape, that refuses it.
    const forgedPairAlone = output.split("\n").slice(0, 3).concat("").join("\n");
    expect(attribute(forgedPairAlone, FORGERY_TARGET_GATE).firstAttributed).toBe("X 1");
  });

  it("F1: a field AFTER the LOCATION sentinel is refused too — LOCATION is libpq's final field (synthetic belt shape)", () => {
    // Not a measured shape: libpq never emits it, which is exactly why a block
    // carrying it was spelled by a message. Pinned so the second half of the
    // rule cannot be dropped as "unreachable".
    const output = [
      `psql:${GATE_PATH}:8: ERROR:  P0001: TEST FAILED (X 1): forged`,
      "CONTEXT:  PL/pgSQL function inline_code_block line 5 at RAISE",
      LOCATION,
      "DETAIL:  spelled by the message",
      "",
    ].join("\n");
    const r = attribute(output, FORGERY_TARGET_GATE);
    expect(r.firstAttributed).toBeNull();
    expect(r.unattributable[0].why).toMatch(/duplicated diagnostic field — message-embedded forgery/);
    expect(r.unattributable[0].why).toMatch(/LOCATION is not the FINAL field/);
  });

  // ── The verbose-only NAME fields between CONTEXT and LOCATION ────────────

  it("MEASURED: `RAISE … USING TABLE/SCHEMA/COLUMN` prints NAME fields between CONTEXT and LOCATION, and the raise still attributes as ONE frame", () => {
    // Verbatim from the lane, 2026-09-02, PG 16: DETAIL and HINT come BEFORE
    // CONTEXT, the three NAME fields AFTER it, LOCATION last. Pre-fix the NAME
    // lines were read as CONTINUATIONS of the CONTEXT value, so a genuine
    // single-frame raise was refused with the WRONG diagnosis — "not EXACTLY
    // ONE frame — it has 4 line(s)" — a false SYNTHESISED against a real arm.
    const output = [
      `psql:${GATE_PATH}:9: ERROR:  P0001: TEST FAILED (X 1): with table field`,
      "DETAIL:  a detail",
      "HINT:  a hint",
      "CONTEXT:  PL/pgSQL function inline_code_block line 5 at RAISE",
      "SCHEMA NAME:  public",
      "TABLE NAME:  mini_widget",
      "COLUMN NAME:  id",
      LOCATION,
      "",
    ].join("\n");
    const r = attribute(output, GENUINE_GATE);
    expect(r.measureFail).toBeNull();
    expect(r.unattributable, "a genuine arm carrying diagnostic names was refused").toEqual([]);
    expect(r.firstAttributed).toBe("X 1");
  });

  it("DETAIL / HINT beside the chain — and DATATYPE / CONSTRAINT names after it — do not change the frame count", () => {
    // The other two NAME fields, plus the pre-CONTEXT pair, in libpq's order.
    // One block, five extra fields, still exactly one frame and no duplicate.
    const output = [
      `psql:${GATE_PATH}:9: ERROR:  P0001: TEST FAILED (X 1): demo arm`,
      "DETAIL:  a detail",
      "HINT:  a hint",
      "CONTEXT:  PL/pgSQL function inline_code_block line 5 at RAISE",
      "DATATYPE NAME:  text",
      "CONSTRAINT NAME:  mini_widget_pkey",
      LOCATION,
      "",
    ].join("\n");
    const r = attribute(output, GENUINE_GATE);
    expect(r.firstAttributed).toBe("X 1");
    expect(r.unattributable).toEqual([]);
    // And the calibration the other way: the SAME block with a genuine second
    // frame is still refused by chain length — the NAME fields did not widen
    // what counts as one frame.
    const twoFrames = output.replace(
      "CONTEXT:  PL/pgSQL function inline_code_block line 5 at RAISE",
      "CONTEXT:  PL/pgSQL function inline_code_block line 5 at RAISE\nPL/pgSQL function outer() line 2 at EXECUTE",
    );
    expect(attribute(twoFrames, GENUINE_GATE).firstAttributed).toBeNull();
    expect(attribute(twoFrames, GENUINE_GATE).unattributable[0].why).toMatch(/EXACTLY ONE/);
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
    // MEASURED 2026-09-03 (plan 164.4-02): 59 needles across 45 arms.
    // RE-MEASURED 2026-09-03 (plan 164.4-04): 97 needles across 86 arms. The
    // needle count rises by less than the arm count because 15 of the new arms
    // are `sql` steps (grant / ownership / DROP drift on the live lane), which
    // carry no `find` or `anchor` at all — rule 3c is what bounds those.
    // RE-MEASURED 2026-09-03 (plan 164.4-05): 132 needles across 134 arms. The
    // gap WIDENS on purpose — the tenant-isolation batch is grant, policy, ACL
    // and DROP drift, so 48 new arms carried only 35 new needles and 63 of the
    // corpus's steps are now `sql`.
    // RE-MEASURED 2026-09-03 (plan 164.4-06): 143 needles across 163 arms, and
    // the gap widens again — 29 new arms carried only 11 new needles because
    // three of the four files in that batch are re-read by their own migration's
    // post-verify, so an EDIT would abort the apply and the drift has to happen
    // on the LIVE object after it. 81 of the corpus's 224 steps are now `sql`.
    // RE-MEASURED 2026-09-03 (plan 164.4-07): 167 needles across 189 arms. The
    // gap NARROWS this time — 26 new arms carried 24 new needles, because this
    // batch's mutations are mostly migration-text edits (RLS predicates, guard
    // bodies, a scope_kind CHECK list) rather than live-object drift. 87 of the
    // corpus's 254 steps are now `sql`.
    // RE-MEASURED 2026-09-04 (plan 164.4-08): 205 needles across 219 arms. 30
    // new arms carried 38 new needles — MORE needles than arms, because several
    // of this batch's twins are LAYERED migration edits (a RETURNS TABLE and
    // its SELECT list must agree, so one arm spends two file steps). 91 of the
    // corpus's 296 steps are now `sql`, among them the trust-signals
    // anon-EXECUTE revoke, which is a `sql` step by force: mig 135 STEP 2 pins
    // the grantee list exactly, so the drift has to happen on the LIVE object.
    // RE-MEASURED 2026-09-04 (plan 164.4-09): 226 needles across 239 arms. 20
    // new arms carried 21 new needles — again slightly MORE needles than arms,
    // and for the same reason: two of this batch's twins are LAYERED migration
    // edits against SELF-VERIFYING migrations, where the mutation and the
    // migration's own post-verify of it must move together or the apply aborts
    // (the resync gate's (b) needs THREE steps, because 20260726000225 checks
    // its own indexed column list AND counts the unique indexes covering
    // wizard_session_id). 98 of the corpus's 324 steps are now `sql`.
    // RE-MEASURED 2026-09-04 (plan 164.4-10): 236 needles across 247 arms. The
    // 8 new arms carried 10 new needles — MORE needles than arms again, and the
    // reason is the same class as above but reached differently: this batch's
    // extra two steps are not self-verify layers but a DOUBLE-ARBITER layer.
    // The enqueue-dedupe gate's B1 must defeat BOTH the RPC's optimistic
    // look-up and the partial unique index that independently dedupes behind
    // it, and the allocator gate's arm 1 must neuter the migration's own
    // NOT NULL post-verify beside the column change. 98 of the corpus's 334
    // steps are `sql` — the count is unchanged because this batch added no
    // live-DB grant/policy drift arm.
    // RE-MEASURED 2026-09-04 (plan 164.4-11, the FINAL batch): 253 needles
    // across 262 arms. The 15 new arms carried 17 new needles, the same
    // more-needles-than-arms shape once more, and again from TWO layered arms:
    // sync-status `0a` must strip the applied-ness id from BOTH places it
    // occurs inside ONE function COMMENT, and wizard-session `3f` must stand
    // down its own migration's post-verify (e2) beside the body edit it makes.
    // ⛔ `needles.length` is a SEPARATE pin from `stepsSeen` above and has its
    // own stale integer every batch — plan 164.4-10 recorded that trap and it
    // reproduced here. Both were RUN, not reasoned about. 98 of the corpus's
    // 351 steps are `sql`, unchanged: this batch added no live-DB grant/policy
    // drift arm either.
    // RE-MEASURED 2026-09-05 (plan 164.4.1-02, the first file move of Phase
    // 164.4.1): 264 needles across 272 arms. The 10 new arms carried 11 new
    // needles — the same more-needles-than-arms shape, from the two LAYERED
    // arms described at the `stepsSeen` pin above. ⛔ Both integers were RUN,
    // not reasoned about, and they were run SEPARATELY: this pin and
    // `stepsSeen` are different derivations and each has gone stale on its own
    // in a previous batch. 99 of the corpus's 363 steps are `sql` — one more
    // than the 98 above, the derive gate's assertion-6 cron re-schedule, which
    // IS a live-DB drift arm and the first this family has added since
    // 164.4-06.
    // RE-MEASURED 2026-09-05 (plan 164.4.1-03, the second file move): 292
    // needles across 296 non-waiver arms. ⛔ RUN, not reasoned about, and run
    // SEPARATELY from `stepsSeen` for the reason stated above. The retention
    // gate contributed 28 needles from 24 biting arms; its one `sql` step (the
    // `2/JOB-05` unschedule) carries no needle, and its waived `3/JOB-05` is
    // skipped entirely.
    // RE-MEASURED 2026-09-05 (plan 164.4.1-04, the third file move): 331
    // needles across 324 non-waiver arms — the corpus carries ZERO waivers
    // again, so this pin and `armsSeen` now range over the same set. ⛔ RUN, not
    // reasoned about, and run SEPARATELY from `stepsSeen` for the reason stated
    // above; on this batch the two happen to agree at 331 because every one of
    // the reaper gate's 39 file steps is an `edit` with a `find`, and that
    // coincidence is exactly why they must not be derived from each other. The
    // reaper gate contributed 39 needles from 28 biting arms; its one `sql`
    // step (the `2` unschedule) carries no needle. 101 of the corpus's 432
    // steps are `sql`, one more than the 100 at plan 03.
    expect(needles.length).toBe(331);
    expect(needles.filter((n) => /TEST\s+FAILED\s*\(/i.test(n))).toEqual([]);
  });
});

describe("classifyGateIdiom — the exclusion decision, over HAND-BUILT texts", () => {
  // ⛔ WHY THIS BLOCK EXISTS. `classifyGateIdiom` decides which of the 71 gate
  // files are OUT OF SCOPE for the whole 164.4 backfill. Until this block it
  // had no direct test at all: all three branches were reached only through
  // `scanCorpus` over the live corpus, where the `inert` branch yields an
  // EMPTY list — so `expect(corpus.inertFiles).toEqual([])` passed identically
  // whether that branch worked or was dead code, and the `UNREACHABLE_27` pin
  // below was itself DERIVED BY the classifier, making it a self-referential
  // oracle for the classifier's own correctness. Hand-built texts break both
  // loops: the inputs come from this file, the expected classes from the
  // documented contract, and neither is read off the corpus.

  /**
   * The runner's identity idiom: a code-level raise whose MESSAGE carries
   * `TEST FAILED (`. Deliberately shaped like the real corpus — the carrier
   * lives INSIDE the message literal, which is the whole subtlety below.
   */
  const PENDING_SQL = [
    "DO $$",
    "BEGIN",
    "  IF EXISTS (SELECT 1 FROM public.strategy_shares) THEN",
    "    RAISE EXCEPTION 'TEST FAILED (ANON 1a): anon could read the row';",
    "  END IF;",
    "END $$;",
  ].join("\n");

  /** A code-level raise that carries no identity — nothing to attribute. */
  const UNREACHABLE_SQL = [
    "DO $$",
    "BEGIN",
    "  IF EXISTS (SELECT 1 FROM public.strategy_shares) THEN",
    "    RAISE EXCEPTION 'anon could read the row';",
    "  END IF;",
    "END $$;",
  ].join("\n");

  /**
   * Raises that are TEXT, never code: one in a `--` comment, one in a nesting
   * `/* … *\/` block comment, one inside a string literal. A grep sees three
   * `RAISE EXCEPTION`s here; the masking projection sees none.
   */
  const INERT_SQL = [
    "-- RAISE EXCEPTION 'TEST FAILED (DOC 1): documented syntax, never executed';",
    "/* RAISE EXCEPTION 'TEST FAILED (DOC 2): inside a block comment'; */",
    "SELECT 'RAISE EXCEPTION ''TEST FAILED (DOC 3): inside a literal''' AS doc;",
  ].join("\n");

  it('(a) a code-level raise carrying the identity carrier is "pending"', () => {
    expect(classifyGateIdiom(PENDING_SQL)).toBe("pending");
  });

  it('(b) a code-level raise with a non-idiom message is "unreachable", not "pending"', () => {
    // The two fixtures differ ONLY in the message literal, so this pins the
    // carrier test rather than the raise test.
    expect(classifyGateIdiom(UNREACHABLE_SQL)).toBe("unreachable");
    expect(UNREACHABLE_SQL.replace("anon could read the row", `${IDENTITY_CARRIER}A): x`)).toContain(
      IDENTITY_CARRIER,
    );
    expect(
      classifyGateIdiom(UNREACHABLE_SQL.replace("anon could read the row", `${IDENTITY_CARRIER}A): x`)),
    ).toBe("pending");
  });

  it('(c) a file whose ONLY raises sit in comments and literals is "inert" — the branch is REACHABLE', () => {
    // Retires the vacuity in `expect(corpus.inertFiles).toEqual([])`: that
    // assertion now sits beside a fixture proving the branch it depends on
    // actually runs and actually returns "inert".
    expect(classifyGateIdiom(INERT_SQL)).toBe("inert");
    // Non-vacuity of the fixture itself: the bytes DO contain the raise and
    // the carrier, so "inert" is a masking decision, not an absent needle.
    expect(INERT_SQL).toMatch(/RAISE EXCEPTION/);
    expect(INERT_SQL).toContain(IDENTITY_CARRIER);
    // And the masking is what does it: no statement's executable projection
    // carries a raise, though the raw text of one does.
    const stmts = tokenizeStatements(INERT_SQL);
    expect(stmts.some((s) => /RAISE\s+EXCEPTION/i.test(s.executableText))).toBe(false);
    expect(stmts.some((s) => /RAISE\s+EXCEPTION/i.test(s.text))).toBe(true);
  });

  it("uncommenting the raise flips (c) from inert to pending — the comment is the ONLY difference", () => {
    // Calibration for (c). Without this, an `inert` verdict could come from
    // any property of the fixture; with it, the verdict is attributable to the
    // `--` that masks the raise.
    const uncommented = INERT_SQL.replace(
      "-- RAISE EXCEPTION 'TEST FAILED (DOC 1)",
      "RAISE EXCEPTION 'TEST FAILED (DOC 1)",
    );
    expect(uncommented).not.toBe(INERT_SQL);
    expect(classifyGateIdiom(uncommented)).toBe("pending");
  });

  it("⛔ the carrier is read off the RAW statement text, NOT off executableText", () => {
    // The documented second subtlety, pinned so a "consistency" refactor that
    // switches this read to `executableText` fails HERE by name instead of
    // silently reclassifying all 70 unannotated files as `unreachable` — the
    // absent-vs-correct ambiguity the classification exists to remove.
    const raises = tokenizeStatements(PENDING_SQL).filter((s) =>
      /RAISE\s+EXCEPTION/i.test(s.executableText),
    );
    expect(raises).toHaveLength(1);
    // The identity lives in the message literal, which masking BLANKS...
    expect(raises[0].executableText).not.toContain(IDENTITY_CARRIER);
    // ...and survives only in the raw text. These two lines are the difference
    // between "pending" and "unreachable" for the whole corpus.
    expect(raises[0].text).toContain(IDENTITY_CARRIER);
    expect(classifyGateIdiom(PENDING_SQL)).toBe("pending");
  });

  it("a raise INSIDE a literal cannot make a file pending — masking, not substring search", () => {
    // The complement of the rule above: reading the RAISE off raw text would
    // classify this `unreachable` (or `pending`), because the bytes are all
    // there. Only the executable projection gets it right.
    const literalOnly = [
      "DO $$",
      "BEGIN",
      "  PERFORM 1;",
      "END $$;",
      "SELECT 'RAISE EXCEPTION ''TEST FAILED (X 1): forged''' AS not_code;",
    ].join("\n");
    expect(literalOnly).toMatch(/RAISE EXCEPTION/);
    expect(literalOnly).toContain(IDENTITY_CARRIER);
    expect(classifyGateIdiom(literalOnly)).toBe("inert");
  });

  it("the four classes are exhaustive over these inputs — no fifth value leaks out", () => {
    for (const text of [PENDING_SQL, UNREACHABLE_SQL, INERT_SQL, "", "SELECT 1;"]) {
      expect(["pending", "unreachable", "inert", "lane-blocked"]).toContain(classifyGateIdiom(text));
    }
  });

  // ── 164.4-03: the `lane-blocked` class ─────────────────────────────────
  // The pg-lane has no pg_cron and the founder decided 2026-09-03 not to give
  // it any, so an idiom gate that PROBES for the extension cannot be falsified
  // there. Criterion 4 says such an arm is RECORDED with its reason, never
  // silently skipped — so the class is derived here and printed by the runner.
  const LANE_BLOCKED_PAIR = join(
    REPO_ROOT,
    "scripts",
    "mutation-runner",
    "fixtures",
    "selftest",
    "lane-blocked",
  );
  const COMMENT_ONLY_SQL = readFileSync(
    join(LANE_BLOCKED_PAIR, "lane-blocked-comment-only-gate.sql"),
    "utf8",
  );
  const LIVE_GUARD_SQL = readFileSync(join(LANE_BLOCKED_PAIR, "lane-blocked-gate.sql"), "utf8");

  it("the fixture PAIR differs ONLY in the three `--` markers on the pg_cron guard", () => {
    // Calibration for the two verdicts below. Without this the flip could come
    // from any property of two independently-authored files; with it, the
    // difference in classification is attributable to the comment markers and
    // nothing else — and the pair cannot drift apart later.
    const uncommented = COMMENT_ONLY_SQL.replace(
      "  -- IF NOT EXISTS (SELECT 1 FROM pg_extension",
      "  IF NOT EXISTS (SELECT 1 FROM pg_extension",
    )
      .replace("  --   RAISE EXCEPTION 'TEST FAILED (LANEBLOCK 1)", "    RAISE EXCEPTION 'TEST FAILED (LANEBLOCK 1)")
      .replace("  -- END IF;\n", "  END IF;\n");
    expect(uncommented, "the substitution must actually change the text").not.toBe(COMMENT_ONLY_SQL);
    expect(uncommented).toBe(LIVE_GUARD_SQL);
  });

  it("a pg_cron probe in a `--` COMMENT does not make a gate lane-blocked — the derivation reads code, not prose", () => {
    // The negative control, and the whole reason this is not a `grep pg_cron`:
    // the bytes ARE there.
    expect(COMMENT_ONLY_SQL).toContain("pg_extension");
    expect(COMMENT_ONLY_SQL).toContain("pg_cron");
    expect(gateNeedsPgCron(COMMENT_ONLY_SQL)).toBe(false);
    expect(classifyGateIdiom(COMMENT_ONLY_SQL)).toBe("pending");
  });

  it("uncommenting the same guard flips it from pending to lane-blocked", () => {
    expect(gateNeedsPgCron(LIVE_GUARD_SQL)).toBe(true);
    expect(classifyGateIdiom(LIVE_GUARD_SQL)).toBe("lane-blocked");
  });

  it("WR-01: a LIVE probe for ANOTHER extension, with pg_cron only in neighbouring prose, is NOT lane-blocked", () => {
    // The third member of the pair, and the direction the pair could not
    // reach. The two fixtures above both vary the `pg_extension` half and hold
    // the `pg_cron` half live; this one does the opposite — the CATALOG probe
    // is live code and the only `pg_cron` bytes in the file are inside `--`
    // comments.
    //
    // ⛔ Why this direction is the dangerous one: `lane-blocked` is a DEFERRAL
    // class. A file wrongly filed there leaves `pending:`, stops being counted
    // as work outstanding, and nothing will ever annotate it — the miss is
    // silent and permanent. The pre-2026-09-04 implementation read the pg_cron
    // half off RAW `.text` and returned `true` here.
    // ⚠️ The `-- pg_cron` comment sits INSIDE the `IF … THEN` head unit, not
    // above it. That placement is load-bearing: a comment on its own line
    // before the statement never enters `stmt.text` at all (the scanner sets
    // `stmtStart` at the first code character), so an outside comment could
    // not have exercised the old read. This is the shape a real gate produces
    // — a note explaining WHY the neighbouring extension is not the one being
    // probed, written where the probe is.
    const otherExtensionProbe = [
      "DO $$",
      "BEGIN",
      "  IF NOT EXISTS (",
      "    -- pg_cron is irrelevant to this assertion; scheduling is covered elsewhere.",
      "    SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto'",
      "  ) THEN",
      "    RAISE EXCEPTION 'TEST FAILED (OTHEREXT 1): pgcrypto is not installed';",
      "  END IF;",
      "END $$;",
    ].join("\n");

    // Calibration: both halves of the classifier's input really are present in
    // the bytes, AND in the SAME statement — or this arm proves nothing about
    // the asymmetry it exists to close.
    const probeStmt = tokenizeStatements(otherExtensionProbe).find((s) =>
      /\bpg_extension\b/i.test(s.executableText),
    );
    expect(probeStmt, "a statement must probe pg_extension in EXECUTABLE text").toBeDefined();
    expect(probeStmt!.text, "and pg_cron must fall inside that same statement's RAW text").toContain(
      "pg_cron",
    );
    expect(otherExtensionProbe).toContain(IDENTITY_CARRIER);

    expect(gateNeedsPgCron(otherExtensionProbe)).toBe(false);
    expect(classifyGateIdiom(otherExtensionProbe)).toBe("pending");
  });

  it("WR-01: the pg_cron half is read case-INSENSITIVELY, matching the catalog half", () => {
    // `PG_CRON_CATALOG_RE` carries `/i`; the literal read used `.includes`,
    // which does not. A gate spelling the extension `'PG_CRON'` — legal SQL,
    // `extname` is just text — was a live probe the classifier called prose.
    const shoutedProbe = [
      "DO $$",
      "BEGIN",
      "  IF NOT EXISTS (SELECT 1 FROM PG_EXTENSION WHERE extname = 'PG_CRON') THEN",
      "    RAISE EXCEPTION 'TEST FAILED (SHOUTED 1): pg_cron is not installed';",
      "  END IF;",
      "END $$;",
    ].join("\n");
    expect(shoutedProbe, "the literal must be upper-case, or this arm is a duplicate").not.toContain(
      "'pg_cron'",
    );
    expect(gateNeedsPgCron(shoutedProbe)).toBe(true);
    expect(classifyGateIdiom(shoutedProbe)).toBe("lane-blocked");
  });

  it("`unreachable` is decided BEFORE `lane-blocked` — a non-idiom file that probes pg_cron stays unreachable", () => {
    // `test_retention_crons_safe.sql` in the real corpus is exactly this shape,
    // and the ordering matters: the reason no arm of it can be judged is the
    // IDIOM, not the lane, and a file cannot be deferred out of a class it was
    // never in. Built by hand so the pin survives that file being annotated.
    const nonIdiomProbe = [
      "DO $$",
      "BEGIN",
      "  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN",
      "    RAISE EXCEPTION 'CRONSAFE-01: pg_cron is not installed here';",
      "  END IF;",
      "END $$;",
    ].join("\n");
    expect(gateNeedsPgCron(nonIdiomProbe), "the probe IS live code in this fixture").toBe(true);
    expect(nonIdiomProbe).not.toContain(IDENTITY_CARRIER);
    expect(classifyGateIdiom(nonIdiomProbe)).toBe("unreachable");
  });

  describe("WR-04: the SECOND reader is a real reader — calibrated before it is trusted", () => {
    // ⛔ An oracle nobody calibrated is not an oracle. If `naiveClassify` were
    // stuck on one verdict, or blind to comments, the corpus partition test
    // further down would pass for the wrong reason. These arms drive it to all
    // five of its outcomes over the SAME hand-built texts and fixtures the
    // tokenizer is pinned against above, so the two readers are known to be
    // reading — not merely known to agree.
    it("reaches annotated / pending / unreachable without touching parse.mjs", () => {
      expect(naiveClassify(PENDING_SQL)).toBe("pending");
      expect(naiveClassify(UNREACHABLE_SQL)).toBe("unreachable");
      expect(naiveClassify("-- RED-UNDER: something\nSELECT 1;\n")).toBe("annotated");
    });

    it("strips `--` comments, so a commented-out raise is not a raise to it either", () => {
      const commentedOut = "DO $$\nBEGIN\n  -- RAISE EXCEPTION 'TEST FAILED (X 1)';\nEND $$;";
      // ⛔ The obvious first line here — `expect(commentedOut).toContain("RAISE
      // EXCEPTION")` — was written and REMOVED 2026-09-04: it reads a const bound
      // to a literal three lines up and asserts a substring of that same literal,
      // so it cannot fail for any change to `naiveClassify`. The repo's own
      // primitive-D detector (`self-referential-oracle.test.ts`) caught it. The
      // point it was making is preserved where it belongs — in the message of the
      // assertion that CAN fail, contrasting the reader against a plain grep.
      expect(
        naiveClassify(commentedOut),
        "a grep for `RAISE EXCEPTION` WOULD match these bytes — the reader must not, because the only raise is behind a `--`",
      ).toBe("inert");
    });

    it("⛔ and it is BLIND to block comments and to literals — the divergence, pinned", () => {
      // ⭐ FOUND BY THIS CALIBRATION, 2026-09-04, not predicted by it.
      // `INERT_SQL`'s three lines are a `--` raise, a `/* … */` raise and a
      // raise spelled inside a single-quoted literal. The tokenizer sees zero
      // executable raises and says `inert`. The naive reader strips only `--`,
      // so lines 2 and 3 read to it as live code carrying the identity carrier,
      // and it says `pending`.
      //
      // This is asserted rather than repaired ON PURPOSE. Teaching the second
      // reader about block comments and cross-line literals would make it a
      // second copy of `scanRegion`, which is precisely the duality this suite
      // exists to remove — and a second copy would agree with the first for the
      // reason a photocopy agrees with its original. A weaker-but-independent
      // oracle whose weakness is NAMED is worth more than a faithful clone.
      //
      // ⚠️ The consequence is bounded and must stay bounded: it means the
      // corpus partition test below can only be trusted while the two readers
      // agree over the REAL corpus, which is measured there at zero
      // disagreements. It is not a licence to add exceptions to that test.
      expect(classifyGateIdiom(INERT_SQL)).toBe("inert");
      expect(naiveClassify(INERT_SQL)).toBe("pending");
      expect(INERT_SQL, "the divergence is driven by these two masking rules").toContain("/*");
      expect(INERT_SQL).toContain("''TEST FAILED (DOC 3)");
    });

    it("reproduces the lane-blocked fixture PAIR's flip on its own", () => {
      expect(naiveClassify(COMMENT_ONLY_SQL)).toBe("pending");
      expect(naiveClassify(LIVE_GUARD_SQL)).toBe("lane-blocked");
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════
// THE SECOND READER (review WR-04, 2026-09-04)
// ═════════════════════════════════════════════════════════════════════════
//
// A gate-file classifier that reaches `scanCorpus`'s five verdicts WITHOUT
// touching `parse.mjs`. It shares no regex, no primitive and no import with
// the code under test: the corpus partition test below compares the two set
// for set, and a control that calls the functions it is checking is not a
// control (that is exactly what the previous version of that test did).
//
// ⚠️ IT IS DELIBERATELY WEAKER, in ways worth naming because they are where a
// future disagreement will come from:
//   • `--` is stripped to end of line by a quote-parity heuristic, not by the
//     tokenizer's state machine. Block comments (`/* … */`) are not handled at
//     all, and a `'` inside a `--` comment throws the parity off for that line.
//   • the identity carrier is read out of a `grep -A`-style window running from
//     the RAISE line to the first line carrying a `;` (40 lines max), not out
//     of a tokenized statement. A raise whose message literal contains a `;`
//     before the carrier would truncate the window.
//   • dollar-quoted bodies, nested `$tag$` and cross-line literals are invisible.
//
// Those weaknesses are REAL and are pinned as assertions, not left as prose:
// over the adversarial hand-built `INERT_SQL` the two readers DISAGREE
// (`inert` vs `pending`), and that disagreement is asserted in the calibration
// block above. MEASURED 2026-09-04 over all 71 files in `supabase/tests/`:
// ZERO disagreements. So the two readers are demonstrably different machines
// that happen to agree on the corpus — which is the only shape in which their
// agreement means anything.
//
// ⚠️ It DOES share two things with `parse.mjs`, deliberately: the needles
// `IDENTITY_CARRIER` and `PG_CRON_EXTENSION`. Those are the target strings,
// not the reading of them — the disagreement this oracle hunts is in HOW a
// file is scanned, and a second spelling of the needle would only ever raise a
// false alarm about a typo. Every regex, every masking decision and every
// notion of "statement" below is its own.
const NAIVE_ANNOTATION_RE = /^[ \t]*--[ \t]*RED-UNDER(-M)?:/;
const NAIVE_RAISE_RE = /\bRAISE\s+EXCEPTION\b/i;
const NAIVE_PG_EXTENSION_RE = /\bpg_extension\b/i;

/** `line` with any `--` comment lopped off, by naive quote parity. */
function naiveCodeOf(line: string): string {
  let quotes = 0;
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] === "'") quotes += 1;
    else if (line[i] === "-" && line[i + 1] === "-" && quotes % 2 === 0) return line.slice(0, i);
  }
  return line;
}

/** `grep -A`: RAW lines from `i` to the first one carrying a `;`, capped. */
function naiveWindow(lines: string[], i: number): string {
  let acc = "";
  for (let j = i; j < lines.length && j < i + 40; j += 1) {
    acc += lines[j] + "\n";
    if (lines[j].includes(";")) break;
  }
  return acc;
}

function naiveClassify(
  text: string,
): "annotated" | "pending" | "unreachable" | "inert" | "lane-blocked" {
  const lines = text.split("\n");
  if (lines.some((l) => NAIVE_ANNOTATION_RE.test(l))) return "annotated";
  let raises = false;
  let idiom = false;
  let needsPgCron = false;
  for (let i = 0; i < lines.length; i += 1) {
    const code = naiveCodeOf(lines[i]);
    if (NAIVE_RAISE_RE.test(code)) {
      raises = true;
      if (naiveWindow(lines, i).includes(IDENTITY_CARRIER)) idiom = true;
    }
    if (
      NAIVE_PG_EXTENSION_RE.test(code) &&
      naiveWindow(lines, i).toLowerCase().includes(PG_CRON_EXTENSION)
    ) {
      needsPgCron = true;
    }
  }
  if (!raises) return "inert";
  if (!idiom) return "unreachable";
  return needsPgCron ? "lane-blocked" : "pending";
}

describe("against the real corpus (reads via node:fs, never shell grep)", () => {
  const GATE = join(REPO_ROOT, "supabase", "tests", "test_strategy_shares_rls.sql");

  it("finds exactly 45 line-start prose markers — NOT the 96 a naive substring count reports", () => {
    const result = parseFile(GATE);
    expect(result.prose).toHaveLength(45);

    // Prove the naive count is real and is what anchoring excludes: it must be
    // strictly larger over the same bytes, or this test is asserting nothing.
    const naive = readFileSync(GATE, "utf8").split("RED-UNDER").length - 1;
    expect(naive).toBeGreaterThan(45);
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

  it("scanCorpus reports 42 of 71 files annotated", () => {
    const corpus = scanCorpus(join(REPO_ROOT, "supabase", "tests"));
    // ⛔ The DENOMINATOR stays 71 — every `.sql` in the directory. Phase 164.4
    // reached ITS end state at `files 39/71` (plan 164.4-11, 2026-09-04) with
    // the other 32 PRINTED BY NAME. ⚠️ CURRENCY 2026-09-05 (plan 164.4.1-02,
    // the first file move of PGCRON-LANE): MEASURED `files 41/71`, the other 30
    // still printed by name (`unreachable:` 27 + `lane-blocked:` 3), never
    // `41/41` with the gap quietly redefined away. The two added are the
    // pg_cron-deferred test_compute_jobs_error_kind_copy_parity.sql — the
    // singleton SCOPE AMENDMENT #2's 40 was written before — and
    // test_derive_allocator_keys_fanout.sql, the smallest lane-blocked file.
    expect(corpus.filesTotal).toBe(71);
    // ⚠️ CURRENCY 2026-09-05 (plan 164.4.1-03, the SECOND file move): MEASURED
    // `files 42/71`, the other 29 still printed by name (`unreachable:` 27 +
    // `lane-blocked:` 2). The one added is
    // test_retention_orphaned_running.sql, the 25-section gate whose Parts 2
    // and 3 read the deployed cron.job.command as their oracle. The 2026-09-05
    // plan-02 paragraph above stays as the dated record of the 41-file corpus.
    // ⚠️ CURRENCY 2026-09-05 (plan 164.4.1-04, the THIRD file move): MEASURED
    // `files 43/71`, the other 28 still printed by name (`unreachable:` 27 +
    // `lane-blocked:` 1). The one added is
    // test_strategy_analytics_stuck_computing_reaper.sql, the 28-section gate
    // whose Parts 1b, 2 and 3 are withheld behind `RAISE NOTICE 'SKIP'` unless
    // pg_cron is present — so its apply list is sized to print ZERO gate-owned
    // skip lines, and that zero is what makes its twins falsifiable. The
    // plan-03 paragraph above stays as the dated record of the 42-file corpus.
    expect(corpus.filesAnnotated).toBe(43);
    expect(corpus.annotatedFiles).toEqual([
      "test_allocator_equity_derived_rls.sql",
      "test_allocator_equity_pre_terminus_flag.sql",
      "test_api_keys_exchange_not_user_writable.sql",
      "test_api_keys_insert_not_client_writable.sql",
      "test_api_keys_venue_identity_uniq.sql",
      "test_capital_ownership_allocation_guard.sql",
      "test_capital_ownership_column.sql",
      "test_compute_jobs_error_kind_copy_parity.sql",
      "test_create_wizard_strategy_for_key.sql",
      "test_csv_daily_returns_perkey_rls.sql",
      "test_csv_finalize_atomic_fold.sql",
      "test_csv_finalize_auth_guard.sql",
      "test_csv_finalize_double_submit.sql",
      "test_derive_allocator_keys_fanout.sql",
      "test_enqueue_compute_job_dedupe_non_terminal.sql",
      "test_funding_fees_rls.sql",
      "test_get_published_trust_signals.sql",
      "test_get_verified_cohort_rank_gate.sql",
      "test_guard_wizard_draft_updates_auth_uid.sql",
      "test_ledger_refresh_composite_arm.sql",
      "test_ledger_refresh_fanout.sql",
      "test_ledger_refresh_staleness.sql",
      "test_metrics_by_basis_write.sql",
      "test_profiles_privileged_columns_locked.sql",
      "test_resync_retry_single_job.sql",
      "test_retention_orphaned_running.sql",
      "test_scenario_downgrade_sweep.sql",
      "test_scenario_shares_rls.sql",
      "test_scenarios_rls.sql",
      "test_set_compute_job_progress.sql",
      "test_strategies_private_owner_isolation.sql",
      "test_strategy_analytics_series_completeness.sql",
      "test_strategy_analytics_stuck_computing_reaper.sql",
      "test_strategy_keys_publish_integrity.sql",
      "test_strategy_keys_rls.sql",
      "test_strategy_shares_rls.sql",
      "test_strategy_verifications_wizard_session_tenant_scope.sql",
      "test_sync_status_marked_refresh_protected.sql",
      "test_user_notes_dashboard_scope.sql",
      "test_weight_snapshot_seed_secdef.sql",
      "test_wizard_composite_fence.sql",
      "test_wizard_composite_members.sql",
      "test_wizard_session_idempotency.sql",
    ]);
  });

  // ── 164.4-02: the DURABLE half-annotation control ──────────────────────────
  // ⛔ NOT A COUNT. `annotated >= sections` is satisfied by a file carrying two
  // twins on half its sections, which is EXACTLY the half-annotated file this
  // pin exists to refuse — and, measured, exactly the shape the reference file
  // was in until this plan: 30 twins over 20 of its 35 sections, `annotated 30
  // >= sections 35` false but `annotated 45 >= sections 35` true either way you
  // spell it. So the assertion is SET INCLUSION: the sections its twins name
  // must CONTAIN every section its own `TEST FAILED (…)` identities name.
  //
  // ⚠️ It is the durable half of criterion 1. Each batch plan's own
  // section-coverage one-liner runs only while that plan is executing; this
  // runs on every push, so a file that later grows a 39th section and does not
  // grow a twin for it fails the build.
  //
  // Both helpers are IMPORTED from run.mjs rather than re-implemented — a
  // second copy of the suffix rule is a second thing to drift, and the rule is
  // already pinned against its own table in mutation-runner-floors.test.ts.
  it("164.4-02: every SECTION an annotated file raises for also carries a twin — set inclusion, not a count", () => {
    const corpus = scanCorpus(join(REPO_ROOT, "supabase", "tests"));
    // Non-vacuity: an empty annotated list would make the loop below assert
    // nothing at all, which is the failure mode this whole family refuses.
    expect(corpus.annotatedFiles.length).toBeGreaterThan(0);

    const missingByFile: Record<string, string[]> = {};
    let sectionsChecked = 0;

    for (const name of corpus.annotatedFiles) {
      const abs = join(REPO_ROOT, "supabase", "tests", name);
      const text = readFileSync(abs, "utf8");
      const parsed = parseAnnotations(text, { file: name });
      expect(parsed.errors, `${name}: the corpus file must parse cleanly`).toEqual([]);

      const have = new Set(parsed.structured.map((a) => sectionOfIdentity(a.arm)));
      const need = new Set(gateAttributionRecords(text).map((r) => sectionOfIdentity(r.arm)));
      sectionsChecked += need.size;

      const missing = [...need].filter((s) => !have.has(s)).sort();
      if (missing.length > 0) missingByFile[name] = missing;
    }

    // Calibration: the walk must actually have walked sections, or an empty
    // `missingByFile` proves nothing.
    expect(sectionsChecked).toBeGreaterThan(0);
    expect(
      missingByFile,
      `SECTION coverage gap. Each listed file raises TEST FAILED (…) for a section that carries NO RED-UNDER-M twin, so that section's assertions are never proven able to fail: ${JSON.stringify(missingByFile)}`,
    ).toEqual({});
  });

  // ── 164.4-01: the EXCLUDED set, pinned by name ─────────────────────────────
  // The founder's 2026-09-02 scope amendment makes 27 gate files out of scope
  // because they raise outside the runner's identity idiom, and makes NAMING
  // them a merge condition. A derivation that silently returned `[]` would make
  // the runner print `unreachable: 0 file(s)` — indistinguishable, to every
  // reader, from a corpus with nothing to exclude. That absent-vs-correct
  // ambiguity is exactly what the amendment forbids, so the list is pinned
  // EXACTLY rather than by count.
  //
  // MEASURED 2026-09-02 by `classifyGateIdiom` over `supabase/tests/` and
  // cross-checked against RESEARCH § Option (a)'s independently-built table
  // (27 files, 321 raises, 139 distinct prefixes): the two agree file for file.
  const UNREACHABLE_27 = [
    "test_anon_execute_current_user_has_app_role.sql",
    "test_api_key_delete_atomicity.sql",
    "test_claim_compute_jobs_dedupe_partition.sql",
    "test_claim_kind_filter.sql",
    "test_cleanup_orphaned_api_keys_sweep.sql",
    "test_cleanup_wizard_drafts_race.sql",
    "test_commit_scenario_batch_auth_input.sql",
    "test_commit_scenario_batch_fingerprint_precondition.sql",
    "test_commit_scenario_batch_p1956_range.sql",
    "test_commit_scenario_batch_p1957_divested.sql",
    "test_compute_analytics_kind_retired.sql",
    "test_compute_jobs_rpc_error_clear_and_fanin.sql",
    "test_cutover_strategy_metrics_keys_atomic.sql",
    "test_data_deletion_requests_fk_set_null.sql",
    "test_enqueue_internal_destrict.sql",
    "test_get_latest_portfolio_analytics_for_user.sql",
    "test_handle_new_user_role_allowlist.sql",
    "test_log_audit_event_service_ceiling.sql",
    "test_mt5_exchange_boundary.sql",
    "test_portfolio_recompute_inflight_unique.sql",
    "test_retention_crons_safe.sql",
    "test_sanitize_user_hardening.sql",
    "test_sfox_exchange_boundary.sql",
    "test_staff_role_both_backfill.sql",
    "test_sync_status_preserves_warnings.sql",
    "test_sync_status_supersede_failed_per_kind.sql",
    "test_upsert_strategy_analytics_series_batch_privilege.sql",
  ];

  it("scanCorpus names the 27 non-idiom files EXACTLY — an empty list would read as full coverage", () => {
    const corpus = scanCorpus(join(REPO_ROOT, "supabase", "tests"));
    expect(corpus.unreachableFiles).toEqual(UNREACHABLE_27);
  });

  // ── 164.4-03: the DEFERRED four, pinned as a SET ────────────────────────
  // MEASURED 2026-09-03 over `supabase/tests/` (71 files): 6 files mention
  // `pg_cron` in raw bytes; 5 probe `pg_extension` for it in executable code;
  // 4 of those 5 are idiom files and are deferred together, because CONTEXT's
  // batch rule is "each plan lands its files FULLY proven — no file left
  // half-annotated". The fifth, `test_retention_crons_safe.sql`, raises outside
  // the identity idiom and stays `unreachable`; the sixth,
  // `test_wizard_composite_fence.sql:698`, mentions pg_cron only in a `--`
  // comment and stays `pending`.
  //
  // MECHANISM PER FILE, re-measured at HEAD, because "they all RAISE" was the
  // pre-amendment record and it is false:
  //   reconcile_dropped_enqueue_sweep.sql:268 and retention_orphaned_running
  //     .sql:212 — RAISE EXCEPTION on the ABSENT extension, so their pg-lane
  //     baseline can never be GREEN and `runCorpus` judges no arm in them;
  //   strategy_analytics_stuck_computing_reaper.sql:282/326/483 and
  //     derive_allocator_keys_fanout.sql:159/169 — baseline GREEN, but whole
  //     Parts are withheld behind a pg_cron-conditional `RAISE NOTICE`, so
  //     those arms are un-falsifiable on the lane.
  //
  // ⚠️ An EXACT SET, in the runner's own printed order (sorted, single-spaced),
  // because that is what ci.yml cross-checks the claimed count against.
  // ⚠️ CURRENCY 2026-09-05 (plan 164.4.1-02). The set is now THREE. The
  // 2026-09-03 four-name list is kept here as lineage:
  //   test_derive_allocator_keys_fanout.sql, test_reconcile_dropped_enqueue_
  //   sweep.sql, test_retention_orphaned_running.sql,
  //   test_strategy_analytics_stuck_computing_reaper.sql
  // ⛔ derive_allocator_keys_fanout LEFT this set because it is now ANNOTATED —
  // its pg_cron-conditional Part runs on a lane that preloads the extension
  // (Phase 164.4.1 plan 01) and its assertion 6 is falsified rather than
  // withheld. The CLASSIFIER did not change: `gateNeedsPgCron` still returns
  // true for that text, and `classifyGateIdiom`'s order (inert → unreachable →
  // lane-blocked | pending) is unchanged; what moved is that the file now
  // carries RED-UNDER markers, so it is `annotated` before either branch is
  // reached. A future edit that empties this set by teaching the classifier to
  // ignore pg_cron would be the opposite move and must fail here.
  // ⛔ CURRENCY 2026-09-05 (plan 164.4.1-03): test_retention_orphaned_running.sql
  // LEFT this set, by ANNOTATION and not by any change to the classifier. Its
  // `1/JOB-05` arm still RAISEs on an absent pg_cron and `gateNeedsPgCron`
  // still returns true for that text; what moved is that the file now carries
  // line-start RED-UNDER markers, so `classifyGateIdiom` reaches `annotated`
  // before either of the two later branches. The prior list is kept here as
  // lineage: LANE_BLOCKED_2 was
  //   test_reconcile_dropped_enqueue_sweep.sql,
  //   test_retention_orphaned_running.sql,
  //   test_strategy_analytics_stuck_computing_reaper.sql.
  // A future edit that empties this set by teaching the classifier to ignore
  // pg_cron would be the opposite move and must fail here.
  // ⛔ CURRENCY 2026-09-05 (plan 164.4.1-04):
  // test_strategy_analytics_stuck_computing_reaper.sql LEFT this set the same
  // way the retention gate did — by ANNOTATION, not by any change to the
  // classifier. Its Part 1b still branches on `pg_extension` and
  // `gateNeedsPgCron` still returns true for that text; what moved is that the
  // file now carries line-start RED-UNDER markers, so `classifyGateIdiom`
  // reaches `annotated` first. The prior list is kept here as lineage:
  // LANE_BLOCKED_2 was
  //   test_reconcile_dropped_enqueue_sweep.sql,
  //   test_strategy_analytics_stuck_computing_reaper.sql.
  // ⛔ ONE name is left, and it is the LAST one: plan 05 of this phase takes it,
  // and only then does `lane-blocked-stale` stop firing. Emptying this set by
  // any route OTHER than annotating that file — teaching the classifier to
  // ignore pg_cron, or deleting the pin — is the opposite move and must fail
  // here.
  const LANE_BLOCKED_1 = ["test_reconcile_dropped_enqueue_sweep.sql"];

  it("scanCorpus names the 1 lane-blocked file EXACTLY — the deferral is a measured set, not a hand list", () => {
    const corpus = scanCorpus(join(REPO_ROOT, "supabase", "tests"));
    expect(corpus.laneBlockedFiles).toEqual(LANE_BLOCKED_1);
    // Non-vacuity in the other direction: it may not ALSO be sitting in
    // `pending`, which is what "the pending line no longer lists them" means.
    for (const f of LANE_BLOCKED_1) expect(corpus.pendingFiles).not.toContain(f);
    // And the negative controls stay where they were.
    expect(corpus.unreachableFiles).toContain("test_retention_crons_safe.sql");
    // ⭐ test_wizard_composite_fence.sql mentions pg_cron at :698 in a COMMENT
    // only, so it must never join the four above. Plan 164.4-09 ANNOTATED it,
    // which moved it from `pending` to `annotated` — the control follows it
    // rather than being dropped, because what it pins is the CLASSIFIER (a
    // comment-only mention is not a lane block), not the file's coverage state.
    expect(corpus.annotatedFiles).toContain("test_wizard_composite_fence.sql");
    expect(corpus.laneBlockedFiles).not.toContain("test_wizard_composite_fence.sql");
    // ⚠️ THE BLIND TRIPWIRE, FLIPPED ON PURPOSE 2026-09-05 by plan 164.4.1-02.
    // It used to read `expect(corpus.pendingFiles).toContain(
    // "test_compute_jobs_error_kind_copy_parity.sql")`, and its own comment
    // named the two exits that would flip it: "the day the classifier learns to
    // read apply lists, or the day the lane can host pg_cron". The SECOND one
    // happened (Phase 164.4.1 plan 01), and this plan annotated the file, so it
    // is now `annotated` and NOT `pending`.
    // ⛔ The FIRST exit is still open and this assertion does not close it.
    // `gateNeedsPgCron` (parse.mjs:1043) still reads only a gate's executable
    // text and is still blind to its RED-UNDER-SETUP apply list — which is why
    // this file printed under `pending:` rather than `lane-blocked:` in the
    // first place, even though its apply list needed a migration that hard-
    // RAISEs without pg_cron. The defect stops MATTERING once nothing is
    // lane-blocked; it does not stop being wrong. It is closed DELIBERATELY in
    // plan 164.4.1-06 — TODOS [REDUNDER-LANEBLOCKED-BLIND].
    expect(corpus.annotatedFiles).toContain("test_compute_jobs_error_kind_copy_parity.sql");
    expect(corpus.pendingFiles).not.toContain("test_compute_jobs_error_kind_copy_parity.sql");
  });

  // ── 164.4.1-02, D-04: the `pending:` SET pin MOVES, deliberately, as its own
  // assertion, with an AIM beside it. The `it` title below carries the marker
  // this plan's verify greps for; it is deliberately spelled ONCE in the file,
  // so a duplicate here would make that grep unable to tell one AIM from two.
  //
  // ⛔ WHAT THIS REPLACES AND WHY THE AIM IS NOT OPTIONAL. Until 2026-09-05
  // this was `expect(corpus.pendingFiles).toEqual(
  // ["test_compute_jobs_error_kind_copy_parity.sql"])` — a ONE-NAME SET that
  // existed so an attestation of completeness could not ship ahead of Phase
  // 164.4.1. That phase is entitled to move it, and CONTEXT decision 4 says
  // how: deliberately, measured, never loosened to "any set" and never deleted.
  // The measured value is now the EMPTY set.
  //
  // ⛔ An empty-set assertion standing alone is the EXACT vacuity this file has
  // already measured once: `expect(corpus.inertFiles).toEqual([])` (:1445 and
  // the assertion at :1504) passed identically whether the `inert` branch
  // worked or was dead code, because the live corpus yields an empty list
  // either way. So the empty set is asserted here ONLY beside an AIM: a copy of
  // a currently-annotated gate, with every line-start RED-UNDER stripped, is
  // dropped into a temp scope dir and MUST come back classified `pending`. That
  // proves the class is still COMPUTED before the live corpus is asserted to be
  // empty of it. A classifier that stopped producing `pending` at all fails the
  // AIM, not the empty set.
  it("pending AIM (D-04): the pending class is still COMPUTED, and the live corpus is measured EMPTY of it", () => {
    const scope = join(REPO_ROOT, "supabase", "tests");

    // (a) THE AIM. A stripped copy of a real annotated gate is idiom-shaped and
    // unannotated, so it must classify `pending`. The source is the reference
    // file, chosen because it is the smallest annotated gate that still raises
    // through the identity idiom.
    const donor = "test_metrics_by_basis_write.sql";
    const stripped = readFileSync(join(scope, donor), "utf8")
      .split("\n")
      .filter((l) => !/^[ \t]*--[ \t]*RED-UNDER/.test(l))
      .join("\n");
    // Non-vacuity of the fixture itself, in both directions: the stripping
    // actually removed markers, and what is left still carries the identity
    // carrier the classifier keys on.
    expect(stripped).not.toContain("RED-UNDER");
    expect(stripped).toContain(IDENTITY_CARRIER);

    const tmp = mkdtempSync(join(tmpdir(), "pending-aim-"));
    try {
      writeFileSync(join(tmp, "test_stripped_donor_probe.sql"), stripped, "utf8");
      const probe = scanCorpus(tmp);
      expect(probe.pendingFiles).toContain("test_stripped_donor_probe.sql");
      expect(probe.annotatedFiles).not.toContain("test_stripped_donor_probe.sql");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }

    // (b) AND ONLY THEN the live corpus. MEASURED 2026-09-05 (plan 164.4.1-02),
    // `node scripts/mutation-runner/run.mjs` printing
    // `  pending: 0 idiom file(s) without RED-UNDER — `: the one name this pin
    // used to carry is annotated, which is the retirement of [REDUNDER-PGCRON]
    // the founder chose over widening it. A file that quietly BECOMES pending —
    // a new idiom gate landing without annotations — fails here by name.
    const corpus = scanCorpus(scope);
    expect(corpus.pendingFiles).toEqual([]);
  });

  it("the FIVE classes sum to filesTotal — annotated + pending + unreachable + inert + lane-blocked", () => {
    // The partition invariant as an arithmetic statement over the SCALARS the
    // runner prints, beside the set-for-set derivation below. A class that
    // stops being computed, or a file filed into two, fails here by count.
    const corpus = scanCorpus(join(REPO_ROOT, "supabase", "tests"));
    const sum =
      corpus.annotatedFiles.length +
      corpus.pendingFiles.length +
      corpus.unreachableFiles.length +
      corpus.inertFiles.length +
      corpus.laneBlockedFiles.length;
    expect(sum).toBe(corpus.filesTotal);
    // MEASURED 2026-09-03 at this commit: 1 + 39 + 27 + 0 + 4 = 71. Stated so a
    // reader can see WHICH way a future drift went, not only that it drifted.
    // ⚠️ CURRENCY 2026-09-04 (plan 164.4-10): 32 + 8 + 27 + 0 + 4 = 71. The
    // 2026-09-03 figures above STAY as lineage — they record a run that
    // happened, and rewriting a dated measurement is the worse defect.
    // ⚠️ CURRENCY 2026-09-05 (plan 164.4.1-02), read off `--parse-only`:
    // annotated 41 + pending 0 + unreachable 27 + inert 0 + lane-blocked 3 = 71.
    // ⚠️ CURRENCY 2026-09-05 (plan 164.4.1-03), read off `--parse-only`:
    // annotated 42 + pending 0 + unreachable 27 + inert 0 + lane-blocked 2 = 71.
    // ⚠️ CURRENCY 2026-09-05 (plan 164.4.1-04), read off `--parse-only`:
    // annotated 43 + pending 0 + unreachable 27 + inert 0 + lane-blocked 1 = 71.
    expect(corpus.filesTotal).toBe(71);
    expect(corpus.laneBlockedFiles).toHaveLength(1);
    // ⛔ A LENGTH beside an EXACT SET, not instead of one: `toHaveLength(1)` is
    // satisfied by any ONE name, which is exactly how a silently-substituted
    // file would pass. The set is the assertion; the length is the arithmetic.
    expect(corpus.laneBlockedFiles).toEqual(LANE_BLOCKED_1);
  });

  it("the five classes PARTITION the corpus, checked against an INDEPENDENT derivation", () => {
    // ⛔ WHAT THIS USED TO BE, in two steps, and why each changed.
    //
    // (1) 2026-09-02. It asserted
    //   pendingFiles.length === filesTotal − filesAnnotated − unreachable − inert
    // and `new Set(all).size === filesTotal`. Both hold BY CONSTRUCTION of the
    // code under test: `scanCorpus` pushes each file into exactly one array and
    // `readdirSync` yields unique names. MEASURED, not asserted: swapping the
    // two `push` targets in `scanCorpus` (43 pending files filed as
    // `unreachable` and 27 unreachable filed as `pending`) leaves the
    // arithmetic balanced — 27 === 71 − 1 − 43 − 0 — and the set size at 71, so
    // BOTH replaced lines returned `true` under a corpus that was completely
    // misfiled. It was replaced by a set-for-set comparison.
    //
    // (2) 2026-09-04, review WR-04. That set-for-set comparison called
    // `parseAnnotations` and `classifyGateIdiom` — the SAME two functions
    // `scanCorpus` calls, in the same order, under the same predicate. It was
    // `scanCorpus`'s body retyped, and could disagree only on `readdirSync`
    // parity or if `classifyGateIdiom` grew a sixth return value. In a phase
    // whose thesis is "a control that agrees by construction proves nothing",
    // a control NAMED for independence and not having any is the defect this
    // suite exists to find.
    //
    // ⭐ So the second derivation now shares NO CODE with `parse.mjs` at all.
    // `naiveClassify` above is a line-oriented, grep-shaped reader: strip `--`
    // to end of line, match `RAISE EXCEPTION` on what is left, read the
    // carrier out of a `grep -A`-style window. It is deliberately WEAKER than
    // the tokenizer (see its own header) and reaches the same five verdicts by
    // an entirely different route.
    //
    // MEASURED 2026-09-04 over all 71 files in `supabase/tests/`: the two
    // readers agree on EVERY file — zero disagreements — which is why this is
    // asserted as exact set equality rather than "modulo a known divergence
    // list". ⚠️ A future disagreement is a FINDING about one of the two
    // readers and must be investigated at the file named; it must NOT be
    // absorbed by adding that file to an exception list, which would restore
    // exactly the agree-by-construction property this rewrite removed.
    const dir = join(REPO_ROOT, "supabase", "tests");
    const names = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const expected: Record<string, string[]> = {
      annotated: [],
      pending: [],
      unreachable: [],
      inert: [],
      "lane-blocked": [],
    };
    for (const name of names) {
      // Keyed by the naive reader's OWN verdict, so a class the two readers
      // do not share throws on the push rather than being silently dropped.
      expected[naiveClassify(readFileSync(join(dir, name), "utf8"))].push(name);
    }

    const corpus = scanCorpus(dir);
    expect(corpus.annotatedFiles).toEqual(expected.annotated);
    expect(corpus.pendingFiles).toEqual(expected.pending);
    expect(corpus.unreachableFiles).toEqual(expected.unreachable);
    expect(corpus.inertFiles).toEqual(expected.inert);
    expect(corpus.laneBlockedFiles).toEqual(expected["lane-blocked"]);
    // The scalars must agree with the same second derivation, not with the
    // arrays they were computed alongside.
    expect(corpus.filesTotal).toBe(names.length);
    expect(corpus.filesAnnotated).toBe(expected.annotated.length);

    // Covering and disjoint, measured against the DIRECTORY LISTING — the one
    // ground truth outside `scanCorpus` — rather than against `filesTotal`.
    const all = [
      ...corpus.annotatedFiles,
      ...corpus.pendingFiles,
      ...corpus.unreachableFiles,
      ...corpus.inertFiles,
      ...corpus.laneBlockedFiles,
    ];
    expect(all.length, "a file was filed twice or dropped").toBe(names.length);
    expect([...all].sort()).toEqual(names);

    // A gate carrying no executable raise at all cannot fail. Zero today; a
    // non-zero here is a finding about that gate, and the runner prints it.
    // This assertion has teeth only because the `inert` branch is proved
    // REACHABLE by the hand-built fixture in the classifyGateIdiom block above.
    expect(corpus.inertFiles).toEqual([]);
  });
});

describe("WR-02 — mode identity: `--parse-only` threads a LAYERED annotation's steps forward, as the real run does", () => {
  // `runCorpus` re-reads each target after writing a step, so step N sees
  // step N-1's output. The static mode used to count every step against the
  // PRISTINE repo file — a layered annotation (GRAMMAR Shape 3, the pattern
  // 164.4 is documented to use) was therefore a MEASURE_FAIL in `--parse-only`
  // and clean in the real run, while run.mjs's header states mode identity as
  // a contract and `--parse-only` is what CI runs where no lane exists.
  const SELFTEST_DIR = join(REPO_ROOT, "scripts", "mutation-runner", "fixtures", "selftest");
  const MIGRATION = "scripts/mutation-runner/fixtures/mini-migration.sql";
  const STEP_1_NEEDLE = "DEFAULT 'unset'";
  const STEP_2_NEEDLE = "DEFAULT 'layered-step-1'";

  it("CALIBRATION: the fixture's second needle exists ONLY in the first step's output", () => {
    // If step 2 were satisfiable against the pristine file, the arm below
    // would pass with or without threading and prove nothing.
    const pristine = readFileSync(join(REPO_ROOT, MIGRATION), "utf8");
    expect(countOccurrences(pristine, STEP_1_NEEDLE)).toBe(1);
    expect(
      countOccurrences(pristine, STEP_2_NEEDLE),
      "step 2's needle must be ABSENT from the pristine migration, or the threading arm is vacuous",
    ).toBe(0);
    // And the fixture really declares that pair, in that order, on that file.
    const gate = parseFile(join(SELFTEST_DIR, "layered-apply-gate.sql"));
    expect(gate.errors).toEqual([]);
    const ann = gate.structured.find((a: { arm: string }) => a.arm === "LAYERED 1");
    expect(ann?.apply.map((s: { file: string; find?: string }) => [s.file, s.find])).toEqual([
      [MIGRATION, STEP_1_NEEDLE],
      [MIGRATION, STEP_2_NEEDLE],
    ]);
  });

  it("the static mode reports NO defect for LAYERED 1 — the same annotation the real run applies in order", () => {
    // MEASURED 2026-09-02 pre-fix, this fixture, `parseOnlyCorpus` over selftest/:
    //   occurrence-mismatch | MEASURE_FAIL: "DEFAULT 'layered-step-1'" occurs 0x
    //   in scripts/mutation-runner/fixtures/mini-migration.sql, annotation claims 1x
    // — in the static mode ONLY.
    const result = parseOnlyCorpus({ scopeDir: SELFTEST_DIR, log: () => {} });
    const mine = result.defects.filter((d: { arm: string | null }) => d.arm === "LAYERED 1");
    expect(mine, "the static mode disagrees with the real run on a layered annotation").toEqual([]);
    // Non-vacuity: the directory WAS parsed, and the static mode is not simply
    // silent on it — the deliberately-defective sibling fixture is still
    // caught. An empty defect table is not a pass.
    expect(result.armsAnnotated).toBeGreaterThan(0);
    expect(
      result.defects.some((d: { kind: string; arm: string | null }) => d.kind === "occurrence-mismatch" && d.arm === "OCCMISS 1"),
      "occurrence-mismatch-gate.sql must still be reported — otherwise the mode found nothing at all",
    ).toBe(true);
  });
});
