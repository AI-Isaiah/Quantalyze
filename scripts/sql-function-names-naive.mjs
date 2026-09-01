#!/usr/bin/env node
/**
 * An INDEPENDENT second reading of "which functions does this SQL define"
 * (Phase 164.3, SP-C05).
 *
 * ── THE DEFECT CLASS THIS EXISTS FOR ───────────────────────────────────────
 * VAC-04 decides that a function is "absent from PROD, therefore NEW,
 * therefore a pass". `prod-body-drift-check.sh` documents that the
 * function-name index is what makes that absence "a MEASUREMENT" rather than
 * an inference. It was not one: the index (`--function-names`) and the body
 * fetcher (`--extract-fn`) were BOTH `extractFunctionDefs()` in
 * sql-body-normalize.mjs, over the SAME dump. That function `continue`s past
 * any definition it cannot parse, so a dropped definition is absent from the
 * index AND from the fetch, and the two "agree" by construction.
 *
 * MEASURED 2026-08-29, with the CI-shaped commands, on a migration containing
 *
 *     CREATE OR REPLACE FUNCTION public.sanitize_user$v2(p uuid)
 *
 * — a `$` in the identifier is enough, because `readQualifiedName` stops at it
 * and the `(` test then fails:
 *
 *     Migrations changed by this PR: 1
 *     ::notice::…this PR's migrations define no functions — nothing to compare.
 *     GATE EXIT=0
 *
 * A claim compared against itself is this phase's entire subject, so the
 * remedy is not another special case inside the same parser. It is a SECOND
 * DERIVATION that shares no code with the first, whose disagreement is
 * therefore evidence.
 *
 * ── HOW THIS READING DIFFERS, DELIBERATELY ─────────────────────────────────
 * It imports nothing from sql-body-normalize.mjs and reproduces none of it:
 *
 *   | sql-body-normalize.mjs        | this file                        |
 *   |-------------------------------|----------------------------------|
 *   | single-pass lexer + index-     | line-anchored regex over the raw |
 *   | preserving mask                | text, no lexer at all            |
 *   | character walk for the name    | one regex for the whole dotted   |
 *   |                                | identifier chain                 |
 *   | identifier charset [A-Za-z0-9_]| charset [A-Za-z0-9_$] — `$` IS   |
 *   | (drops `sanitize_user$v2`)     | a legal identifier character     |
 *   | requires a parseable `(` arg   | requires nothing after the name  |
 *   | list, else drops the def       |                                  |
 *
 * The consequence is that this reading is deliberately the more PERMISSIVE of
 * the two. That is the useful direction: the caller takes the UNION, so a name
 * either reading can see is never classified "absent from PROD". It is not a
 * better parser and must never be used as one — it extracts no bodies, counts
 * no arguments, and knows nothing about dollar quoting.
 *
 * ── WHAT IT CANNOT SEE, STATED RATHER THAN HIDDEN ──────────────────────────
 * 1. A definition that does not begin at the start of a line. `pg_dump` and
 *    `supabase db dump` always emit one that does, and so does every migration
 *    in this repo (MEASURED below). A mid-line definition is seen by the
 *    lexer-based reading instead, which is why the caller unions rather than
 *    replacing.
 * 2. Conversely, it DOES see a line-anchored `CREATE FUNCTION` inside a
 *    dollar-quoted body or a block comment, which the lexer-based reading
 *    correctly ignores. Over-inclusion is the safe direction here — it can
 *    only turn "absent (pass)" into "present, so compare it or fail closed" —
 *    but it means this reading must never be used to COUNT definitions.
 *
 * MEASURED 2026-08-29 over the whole corpus (114 files under
 * supabase/migrations/ and 118 under supabase/schema/functions/): this reading
 * and `--function-names` return the SAME name set for every file, so the union
 * refuses nothing that exists today.
 *
 * ── USAGE (CI pastes these verbatim — mode identity) ───────────────────────
 *   node scripts/sql-function-names-naive.mjs <file...>              # names
 *   node scripts/sql-function-names-naive.mjs --qualified <file...>  # schema\tname
 *   node scripts/sql-function-names-naive.mjs --self-test
 *
 * Reads with node `fs`, never `grep`: this repository contains a file with a
 * deliberate NUL byte, and grep silently reports a NUL-bearing file as clean.
 */
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `CREATE [OR REPLACE] FUNCTION <chain>` at the start of a line, followed by
 * the dotted identifier chain. `[A-Za-z0-9_$]` is the unquoted-identifier
 * charset Postgres actually accepts (`$` is legal after the first character);
 * `"..."` is the quoted form, in which any character is legal.
 */
const DEF_RE =
  /^[ \t]*CREATE[ \t]+(?:OR[ \t]+REPLACE[ \t]+)?FUNCTION[ \t]+((?:"[^"]*"|[A-Za-z0-9_$]+)(?:[ \t]*\.[ \t]*(?:"[^"]*"|[A-Za-z0-9_$]+))*)/i;

/**
 * The segments of a dotted identifier chain.
 *
 * ⚠️ NOT `chain.split(".")`. A quoted segment may CONTAIN dots, and the naive
 * split turned `public."../../pwned"` into six pieces ending in `/pwned"` —
 * found by the SP-I07 traversal fixture, which is the whole reason that fixture
 * asserts what this reader returns before asserting what the gate does with it.
 */
const SEGMENT_RE = /"(?:[^"]|"")*"|[A-Za-z0-9_$]+/g;

/** Strip one layer of double quotes from an identifier segment. */
function unquote(segment) {
  return segment.startsWith('"') && segment.endsWith('"') && segment.length >= 2
    ? segment.slice(1, -1).replace(/""/g, '"')
    : segment;
}

/**
 * Every function definition this reading can see in `sql`.
 * Returns `{ schema, name }`; `schema` is "" when the definition is
 * unqualified, matching sql-body-normalize.mjs's convention so the two name
 * sets are directly comparable.
 */
export function naiveFunctionDefs(sql) {
  const out = [];
  for (const line of sql.split("\n")) {
    const m = DEF_RE.exec(line);
    if (m === null) continue;
    const segments = (m[1].match(SEGMENT_RE) ?? [])
      .map((s) => unquote(s))
      .filter((s) => s !== "");
    if (segments.length === 0) continue;
    out.push({
      schema: segments.length >= 2 ? segments[segments.length - 2] : "",
      name: segments[segments.length - 1],
    });
  }
  return out;
}

function selfTest() {
  const checks = [];
  const assert = (cond, msg) => checks.push({ cond: Boolean(cond), msg });
  const names = (sql) => naiveFunctionDefs(sql).map((d) => d.name);

  // ⭐ The measured SP-C05 input. This is the whole reason the file exists, so
  // it is the first thing the file proves about itself.
  assert(
    names("CREATE OR REPLACE FUNCTION public.sanitize_user$v2(p uuid)\n").join() ===
      "sanitize_user$v2",
    "the `$` identifier that sql-body-normalize.mjs drops must be SEEN here — this reading exists to disagree with that one",
  );
  assert(
    names("CREATE FUNCTION f()\n").join() === "f",
    "the bare CREATE FUNCTION form must be seen",
  );
  assert(
    names('CREATE OR REPLACE FUNCTION public."weird name"(a int)\n').join() ===
      "weird name",
    "a double-quoted identifier must be unquoted to its literal name",
  );
  assert(
    naiveFunctionDefs("CREATE FUNCTION private.g()\n")[0].schema === "private",
    "an explicit schema qualifier must be recoverable",
  );
  // ⛔ Regression pin. `chain.split(".")` returned `/pwned"` here, because a
  // QUOTED segment may contain dots. That matters beyond tidiness: the name is
  // used as a filesystem path component downstream (SP-I07), so a reader that
  // mangles it hands the refusal a different string from the one the other
  // reader sees, and the two stop agreeing about what the migration defines.
  assert(
    names('CREATE OR REPLACE FUNCTION public."../../pwned"(a int)\n').join() ===
      "../../pwned",
    "a quoted segment containing dots must survive as ONE segment",
  );
  assert(
    naiveFunctionDefs('CREATE FUNCTION public."../../pwned"(a int)\n')[0]
      .schema === "public",
    "…and its schema qualifier must still be read correctly",
  );
  assert(
    naiveFunctionDefs("CREATE FUNCTION g()\n")[0].schema === "",
    "an unqualified definition reports an EMPTY schema, matching the normalizer's convention",
  );
  assert(
    names("  create or replace function public.h()\n").join() === "h",
    "the keywords are case-insensitive and may be indented",
  );
  assert(
    names("SELECT 1;\nCREATE FUNCTION a();\nCREATE FUNCTION b();\n").join() ===
      "a,b",
    "every definition in a multi-definition file must be returned, in file order",
  );
  // The stated blind spot, pinned so it cannot silently become something else.
  assert(
    names("DO $$ BEGIN END $$; CREATE FUNCTION mid()\n").length === 0,
    "LIMITATION 1: a definition that does not START a line is invisible to this reading (the lexer-based one sees it; the caller unions)",
  );
  assert(
    names("-- CREATE OR REPLACE FUNCTION commented()\n").length === 0,
    "a `--` comment does not start with CREATE, so a commented mention is not a definition",
  );
  // This reading CAN fail: a file with no definitions must return nothing.
  assert(
    names("SELECT 1;\nUPDATE t SET a = 1;\n").length === 0,
    "a file with no function definitions must return NO names (this reading can return empty)",
  );

  const failed = checks.filter((c) => !c.cond);
  for (const f of failed) console.error(`SELF-TEST FAIL: ${f.msg}`);
  if (failed.length > 0) return 1;
  console.log(
    `sql-function-names-naive self-test OK (${checks.length} checks)`,
  );
  return 0;
}

function main(argv) {
  if (argv[0] === "--self-test") return selfTest();
  const qualified = argv[0] === "--qualified";
  const files = qualified ? argv.slice(1) : argv;
  if (files.length === 0) {
    console.error(
      "::error::sql-function-names-naive: at least one file is required. A run with no input would print nothing, and a caller reading that as 'no functions' is the hole this file exists to close.",
    );
    return 2;
  }
  const rows = new Set();
  for (const f of files)
    for (const d of naiveFunctionDefs(readFileSync(f, "utf8")))
      rows.add(qualified ? `${d.schema}\t${d.name}` : d.name);
  for (const row of [...rows].sort()) process.stdout.write(row + "\n");
  return 0;
}

// Run only when invoked directly, NOT when imported — drift-check-scripts.test.ts
// imports `naiveFunctionDefs` from this module for the corpus-parity arm, and
// importing must not trigger main's exit. Hence the `!process.argv[1]` guard.
//
// ⛔ Compare REALPATHS. The previous form compared `import.meta.url` to a raw
// `file://` + argv[1] concatenation, and MEASURED 2026-09-01 that was false on
// TWO ordinary invocation shapes: a symlinked path (import.meta.url is
// realpath-resolved, argv[1] is not) and a path containing a space
// (import.meta.url percent-encodes it, the concatenation does not). In both,
// main() never ran, stdout was empty, and the process exited 0 — VAC-04 reading
// NOTHING while reporting success. [VAC04-C2]
//
// This function is DUPLICATED verbatim in scripts/sql-body-normalize.mjs rather
// than shared. That is deliberate: these two readers are VAC-04's two supposedly
// independent derivations, and the defect above was one mechanism failing BOTH.
// A shared guard module would rebuild that coupling — and would also break this
// file's machine-pinned "node: builtins only" import contract.
//
// The catch falls back toward RUNNING the gate, never toward skipping it: an
// unresolvable argv path must not be a silent pass.
function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  }
}

if (invokedDirectly()) {
  process.exit(main(process.argv.slice(2)));
}
