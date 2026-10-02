/**
 * The BARE-CODE spelling of every branch-head keyword the tokenizer publishes,
 * and the block CLOSERS that must NOT be heads — ONE table, read by both
 * branch-head oracles (IN-04, 164.3.1 review):
 *
 *   * `sql-statement-tokenizer.test.ts` pins that each spelling tokenizes to a
 *     single head unit, and that each closer is a plain terminated statement;
 *   * `mutation-runner-neuter.test.ts` generates its cross-product from the
 *     same table, so an embedding of each keyword can never end the scan.
 *
 * Keyed by `BRANCH_HEAD_KEYWORDS` (scripts/mutation-runner/parse.mjs): each
 * test asserts `Object.keys(BRANCH_HEAD_BARE_CODE)` equals that export, so a
 * keyword added to the implementation without a spelling here fails BY NAME
 * in both files rather than dropping out of either. Restating the table in
 * two files is how the closers went unpinned through 103/103 re-measurements
 * (CR-01): a closer is a statement, and both oracles now say so from one place.
 */
export const BRANCH_HEAD_BARE_CODE: Readonly<Record<string, string>> = {
  THEN: "IF NOT raised THEN",
  BEGIN: "BEGIN",
  ELSE: "ELSE",
  ELSIF: "ELSIF raised THEN",
  LOOP: "FOR r IN SELECT 1 LOOP",
  DECLARE: "DECLARE",
  EXCEPTION: "EXCEPTION WHEN others THEN",
};

/** Block closers — one per closer kind the runner's block matcher recognises. Statements, never heads. */
export const BLOCK_CLOSERS: readonly string[] = ["END LOOP;", "END IF;", "END CASE;", "END;"];
