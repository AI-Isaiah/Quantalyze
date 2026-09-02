/**
 * `tokenizeStatements` — THE SPAN CONTRACT (phase 164.3.1, Primitive A).
 *
 * ============================================================================
 * WHO CONSUMES THIS AND WHY IT IS PINNED SEPARATELY
 * ============================================================================
 * `mutation-runner-neuter.test.ts` pins what the neuter DOES. This file pins
 * the SHAPE the tokenizer emits, because that shape is a published contract
 * with a consumer outside this file:
 *
 *   Plan 164.3.1-05 (Primitive B — source-location attribution) resolves a
 *   raise's file line from psql's verbose error output as
 *
 *       raise_file_line = DO_statement.startLine + CONTEXT_block_line − 1
 *
 *   (verified twice on PostgreSQL 16.13 in the phase research: 3+5−1=7 and
 *   2+4−1=5). That arithmetic is wrong unless a `DO $$ … $$;` block is ONE
 *   statement whose `startLine` is the DO line, and unless the numbering is
 *   1-based. So those are pinned here, not left to a reading of the code.
 *
 * Plans 09, 10 and 11 inherit the same spans transitively. Renaming the export
 * or reshaping `{ startLine, endLine, text, executableText }` is a COSTLY
 * change after Wave 2 lands; this file is what makes that cost visible.
 *
 * ============================================================================
 * THE BLOCK-COMMENT NESTING DECISION SHIPS WITH A FIXTURE (RESEARCH A4)
 * ============================================================================
 * PostgreSQL block comments NEST. The line-local regex this tokenizer replaced
 * did not handle that, and the research recorded nesting in the corpus as
 * ASSUMED-ABSENT rather than measured. A choice recorded only in a comment is
 * a choice nobody can check, so the fixture below states which behaviour
 * shipped: NESTING. If someone un-nests it, this file goes red by name.
 *
 * Reads via node:fs, never shell grep — grep is silently NUL-blind in this repo
 * (`src/lib/wizardErrors.test.ts` carries a deliberate NUL at line 1572).
 */
import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BRANCH_HEAD_KEYWORDS,
  maskNonCode,
  tokenizeStatements,
} from "../../scripts/mutation-runner/parse.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

interface Statement {
  startLine: number;
  endLine: number;
  text: string;
  executableText: string;
  head: boolean;
  terminated: boolean;
  depth: number;
  start: number;
  end: number;
}

/** `run.mjs` and `parse.mjs` are untyped; narrowing here keeps `any` from making every assertion vacuous. */
const tokenize = (text: string): Statement[] => tokenizeStatements(text) as Statement[];
const mask = (text: string): string => maskNonCode(text) as string;

const span = (s: Statement) => `${s.startLine}-${s.endLine}`;

describe("span contract: 1-based inclusive line spans", () => {
  it("a single-line statement spans exactly its own line", () => {
    const statements = tokenize(["SELECT 1;", "SELECT 2;", "SELECT 3;"].join("\n"));
    expect(statements.map(span)).toEqual(["1-1", "2-2", "3-3"]);
    // 1-BASED. An off-by-one here silently shifts every raise plan 05 resolves.
    expect(statements[0].startLine).toBe(1);
  });

  it("a multi-line single-quoted literal is ONE statement spanning every line it covers", () => {
    const statements = tokenize(
      ["PERFORM set_config('x', 'a", "b THEN", "c', false);", "SELECT 2;"].join("\n"),
    );
    expect(statements.map(span)).toEqual(["1-3", "4-4"]);
    // The interior line `b THEN` must not have been read as a branch head —
    // that is the R3 residual "multi-line literal ending in THEN".
    expect(statements.filter((s) => s.head)).toEqual([]);
  });

  it("a multi-line dollar-quoted body is ONE statement, and its interior is depth+1", () => {
    const statements = tokenize(["EXECUTE $q$", "BEGIN", "junk int;", "$q$;", "SELECT 2;"].join("\n"));
    const top = statements.filter((s) => s.depth === 0);
    expect(top.map(span)).toEqual(["1-4", "5-5"]);
    // The `BEGIN` inside the body is NOT a depth-0 head. It exists only as an
    // interior unit, which no consumer at depth 0 ever walks.
    expect(top.filter((s) => s.head)).toEqual([]);
    expect(statements.some((s) => s.depth === 1 && s.head)).toBe(true);
  });

  it("a NESTED block comment is one region — the whole thing, not up to the first close", () => {
    // RESEARCH A4's decision, made checkable. If nesting were dropped, the
    // scanner would end the comment at the inner `*/` and `still comment */`
    // would become a statement — so this assertion fails BY NAME.
    const statements = tokenize(
      ["/* outer /* inner */ still comment */", "SELECT 1;"].join("\n"),
    );
    expect(statements.map((s) => s.text)).toEqual(["SELECT 1;"]);
    expect(statements.map(span)).toEqual(["2-2"]);
  });

  it("an UNNESTED reading would have produced a second statement — the fixture can fail", () => {
    // Non-vacuity: the fixture above only proves something if the un-nested
    // reading really differs. Here is the same bytes with the outer comment
    // removed, so the trailing text IS code — proving the input is not inert.
    const statements = tokenize(["/* inner */ still_comment();", "SELECT 1;"].join("\n"));
    expect(statements.map((s) => s.text)).toEqual(["still_comment();", "SELECT 1;"]);
  });
});

describe("span contract: a DO block is ONE statement starting on its DO line", () => {
  const SOURCE = [
    "BEGIN;", //                                   1
    "", //                                         2
    "DO $$", //                                    3
    "DECLARE", //                                  4
    "  v int;", //                                 5
    "BEGIN", //                                    6
    "  RAISE EXCEPTION 'TEST FAILED (X 1): x';", // 7
    "END $$;", //                                  8
    "", //                                         9
    "ROLLBACK;", //                               10
  ].join("\n");

  it("the DO statement starts at the DO line and ends at its terminator", () => {
    const doStmt = tokenize(SOURCE).find((s) => s.depth === 0 && s.text.startsWith("DO $$"));
    expect(doStmt, "no depth-0 DO statement was emitted at all").toBeDefined();
    expect(span(doStmt as Statement)).toBe("3-8");
  });

  it("plan 05's resolution formula lands on the raise's real line", () => {
    // psql reports `CONTEXT: PL/pgSQL function inline_code_block line N at
    // RAISE`, where line 1 is the remainder of the `DO $$` line. For this
    // source psql reports N=5, and 3 + 5 − 1 = 7 — the RAISE's actual line.
    // Asserting the arithmetic here is what makes the span a contract rather
    // than a coincidence plan 05 would discover in CI on ubuntu.
    const statements = tokenize(SOURCE);
    const doStmt = statements.find((s) => s.depth === 0 && s.text.startsWith("DO $$")) as Statement;
    const CONTEXT_BLOCK_LINE = 5;
    expect(doStmt.startLine + CONTEXT_BLOCK_LINE - 1).toBe(7);

    // Emission is PRE-ORDER, so the enclosing DO block is listed before the
    // statements of its body and it CONTAINS the raise's text too. A consumer
    // that takes the first match gets the whole block; the raise is the
    // INNERMOST carrier. `run.mjs`'s `innermostCarriers` exists for exactly
    // this, and pinning the ordering here is what makes that a contract rather
    // than an accident of the walk.
    const carriers = statements.filter((s) => s.text.includes("TEST FAILED (X 1)"));
    expect(carriers.map((s) => s.depth)).toEqual([0, 1]);
    const raise = carriers[carriers.length - 1];
    expect(raise.startLine).toBe(7);
    expect(raise.endLine).toBe(7);
  });
});

describe("span contract: a compound line yields multiple statements sharing that line", () => {
  it("decomposes the real corpus's EXCEPTION-compound line into head + two statements", () => {
    // The REAL bytes, read from the REAL file. A retyped copy would drift.
    const compound = readFileSync(
      join(REPO_ROOT, "supabase", "tests", "test_profiles_privileged_columns_locked.sql"),
      "utf8",
    )
      .split("\n")
      .filter((l) => /^\s*EXCEPTION\s+WHEN\s+OTHERS\s+THEN\s+\S.*;\s*END\s*;\s*$/.test(l));
    expect(compound.length).toBeGreaterThanOrEqual(7);

    const statements = tokenize(compound[0]);
    expect(statements.map((s) => [s.head, s.text])).toEqual([
      [true, "EXCEPTION WHEN OTHERS THEN"],
      [false, "v_raised := true;"],
      [false, "END;"],
    ]);
    // All three share one line — which is the whole point.
    expect(statements.map(span)).toEqual(["1-1", "1-1", "1-1"]);
  });

  it("decomposes the [R4-C01] compound HEAD shape so the privileged statement is separable", () => {
    const statements = tokenize("SET ROLE postgres; IF NOT ok THEN");
    expect(statements.map((s) => [s.head, s.text])).toEqual([
      [false, "SET ROLE postgres;"],
      [true, "IF NOT ok THEN"],
    ]);
  });
});

describe("branch-head units", () => {
  it("every keyword the implementation publishes produces a head in its bare-code spelling", () => {
    // The list is exported so the neuter test's cross-product can generate from
    // it. That only means anything if each entry really produces a head, so the
    // list is checked against the tokenizer rather than against a second list.
    const BARE: Record<string, string> = {
      THEN: "IF NOT raised THEN",
      BEGIN: "BEGIN",
      ELSE: "ELSE",
      ELSIF: "ELSIF raised THEN",
      LOOP: "FOR r IN SELECT 1 LOOP",
      DECLARE: "DECLARE",
      EXCEPTION: "EXCEPTION WHEN others THEN",
    };
    expect((BRANCH_HEAD_KEYWORDS as string[]).length).toBeGreaterThan(0);
    expect(Object.keys(BARE).sort()).toEqual([...(BRANCH_HEAD_KEYWORDS as string[])].sort());
    for (const [keyword, source] of Object.entries(BARE)) {
      const statements = tokenize(source);
      expect(statements.length, `${keyword}: ${source}`).toBe(1);
      expect(statements[0].head, `${keyword}: ${source} is not a head unit`).toBe(true);
    }
  });

  it("a block CLOSER is not a head — END LOOP; tokenizes exactly like END IF;, END CASE; and END;", () => {
    // CR-01 (164.3.1 review). `END` sat in the tokenizer's LOOP_OPENERS, so
    // `END LOOP;` came out `[head: true, terminated: false, "END LOOP"]` while
    // `END IF;` was an ordinary terminated statement. Two consumers read `head`
    // as "the head of the enclosing branch": the neuter walk stopped on the
    // closer and accepted a neuter with `SET ROLE postgres;` left live behind a
    // multi-line loop, and `failureBranches` anchored the branch on it and lost
    // the guard. The opener spellings above never asserted the closers.
    for (const closer of ["END LOOP;", "END IF;", "END CASE;", "END;"]) {
      const statements = tokenize(closer);
      expect(
        statements.map((s) => [s.head, s.terminated, s.text]),
        `${closer} must be one terminated, non-head statement`,
      ).toEqual([[false, true, closer]]);
    }
  });

  it("a CASE expression's THEN and ELSE are not heads", () => {
    // Otherwise `v := CASE WHEN a THEN 1 ELSE 2 END;` would split into four
    // units and the backward scan would terminate inside an expression.
    const statements = tokenize("v := CASE WHEN a THEN 1 ELSE 2 END;");
    expect(statements.map((s) => [s.head, s.text])).toEqual([
      [false, "v := CASE WHEN a THEN 1 ELSE 2 END;"],
    ]);
  });

  it("an unterminated statement is marked, never silently shortened", () => {
    const statements = tokenize("RAISE EXCEPTION 'TEST FAILED (X 1): x'");
    expect(statements.length).toBe(1);
    expect(statements[0].terminated).toBe(false);
    expect(tokenize("SELECT 1;")[0].terminated).toBe(true);
  });
});

describe("the masking projection preserves offsets", () => {
  it("blanks every non-code region and keeps length and line count identical", () => {
    const source = [
      "SELECT 'a THEN b', \"quoted THEN\"; -- trailing THEN",
      "/* block",
      "THEN",
      "*/",
      "EXECUTE $q$ THEN $q$;",
    ].join("\n");
    const masked = mask(source);

    expect(masked.length, "offsets must be identical or every span is wrong").toBe(source.length);
    expect(masked.split("\n").length).toBe(source.split("\n").length);

    // A keyword survives ONLY where PostgreSQL would read one. The quoted
    // IDENTIFIER is code and is deliberately kept.
    expect(masked).toContain('"quoted THEN"');
    expect(masked.replace(/"quoted THEN"/, "").includes("THEN")).toBe(false);
  });
});
