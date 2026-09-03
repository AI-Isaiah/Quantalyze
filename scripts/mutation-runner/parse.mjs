/**
 * RED-UNDER-M annotation parser (VAC-01, phase 164.3 plan 05).
 *
 * ============================================================================
 * WHAT DEFECT CLASS THIS EXISTS FOR
 * ============================================================================
 * A gate arm that cannot fail is indistinguishable from a passing one by every
 * signal a reviewer reads. `supabase/tests/test_strategy_shares_rls.sql` carries
 * 30 `RED-UNDER:` comments claiming "this arm was observed as the FIRST failure
 * under this mutation" — but they are PROSE (D-14). Nothing re-runs them, so
 * the claim and the thing are never compared. This parser reads the STRUCTURED
 * twin (`RED-UNDER-M`) that `run.mjs` can actually execute.
 *
 * ============================================================================
 * TWO RULES THIS FILE ENFORCES, BOTH LEARNED BY MEASUREMENT
 * ============================================================================
 *
 * 1. LINE-START ANCHORING. A naive substring count of the marker over the
 *    corpus returns 33; the anchored count is 30. The extra three are the
 *    file's OWN HEADER documenting the annotation syntax (:46-48) — one of
 *    which even matches a plain `grep -c 'RED-UNDER:'`. A count satisfied by
 *    prose about the count is this phase's thesis committed inside this phase's
 *    own spec, so markers are recognised ONLY at comment line start.
 *
 * 2. EVERY BYTE-EDIT CARRIES A MEASURED `occurrences`. Plan 164.3-01 measured
 *    what a prose locator costs: SHAPE 1c's annotation says *change
 *    `generation BIGINT` back to `generation INTEGER` in the STEP 1 CREATE
 *    TABLE*, and that literal single-space string occurs exactly ONCE in the
 *    migration — at line 828, inside `RETURNS TABLE (generation BIGINT, nonce
 *    UUID)`, which is NOT the CREATE TABLE. Mutating it trips the migration's
 *    own verification block at line 1181 and ABORTS THE APPLY, so the gate never
 *    runs and no arm can be the first failure. The real column at line 170
 *    carries TWO spaces. A runner that silently no-ops a find/replace reports
 *    "mutation applied, arm did not redden" — a FALSE DEFECT — and one that
 *    mutates the wrong occurrence reads the resulting red as SUCCESS. Both are
 *    vacuity. So `occurrences` is REQUIRED and the runner treats a mismatch as
 *    MEASURE_FAIL, a defect kind distinct from "the arm did not redden".
 *
 * Reads via node:fs only. Never shell grep — grep is silently NUL-blind in this
 * repo (`src/lib/wizardErrors.test.ts` carries a deliberate NUL at line 1572 and
 * ugrep skips the whole file, so exit 1 reads as "clean").
 *
 * The full schema, with one corpus-drawn example per shape, is in GRAMMAR.md.
 * ⚠️ Phase 164.4 backfills ~70 more files against this schema — key names and
 * semantics are COSTLY to change after this lands.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Line-start anchors. "Line start" means: optional leading whitespace, the
 * comment dashes, optional whitespace, then the marker. Nothing else may
 * precede the marker on the line.
 *
 * `RED-UNDER:` cannot match `RED-UNDER-M:` or `RED-UNDER-SETUP:` because the
 * character after `RED-UNDER` is `-`, not `:`.
 */
const PROSE_RE = /^[ \t]*--[ \t]*RED-UNDER:/;
const STRUCTURED_RE = /^[ \t]*--[ \t]*RED-UNDER-M:[ \t]*(.*)$/;
const SETUP_RE = /^[ \t]*--[ \t]*RED-UNDER-SETUP:[ \t]*(.*)$/;

const STEP_KINDS = new Set(["edit", "insert-after", "sql"]);
const TOP_LEVEL_KEYS = new Set(["arm", "apply", "waiver", "neuter"]);
const STEP_KEYS = {
  edit: new Set(["kind", "file", "find", "replace", "occurrences", "nth"]),
  "insert-after": new Set(["kind", "file", "anchor", "text", "occurrences", "nth"]),
  sql: new Set(["kind", "stmt"]),
};

const isPlainObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;
const isPositiveInt = (v) => Number.isInteger(v) && v > 0;

/**
 * A repo-relative path that cannot escape the checkout. The runner copies these
 * into a scratch dir; an absolute path or a `..` segment would let an annotation
 * reach outside the repo.
 */
function isRepoRelativePath(p) {
  if (typeof p !== "string" || p.trim().length === 0) return false;
  if (p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p)) return false;
  return !p.split(/[\\/]/).includes("..");
}

/**
 * The literal the runner's first-failure identity check looks for.
 *
 * ⛔ WR-03. `run.mjs` proves an arm bites by requiring that the FIRST
 * `TEST FAILED (<ARM>)` in the lane's output names the intended arm. Until
 * this guard existed, `validateStep` constrained only the SHAPE of a mutation
 * — kind, path safety, occurrences, nth — and said nothing about its CONTENT.
 * The gate file is itself in the runner's corpus (four real steps already edit
 * `supabase/tests/test_strategy_shares_rls.sql`), so an annotation of the form
 *
 *   {"kind":"edit","file":"supabase/tests/<gate>.sql","find":"<any line>",
 *    "replace":"RAISE EXCEPTION 'TEST FAILED (X): x';","occurrences":1}
 *
 * produced `RED (identity ok)`, counted toward `armsExecuted` and raised the
 * biting count — for an arm that was never exercised. The mutation SATISFIES
 * THE DETECTOR instead of the arm: a vacuous check inside the vacuity
 * detector. Phase 164.4 backfills ~70 more files against this schema, so the
 * shape had to be unrepresentable rather than merely discouraged.
 *
 * MEASURED 2026-08-29: zero of the 30 annotations in the real corpus inject
 * this literal, so nothing legitimate is refused.
 */
const INJECTS_FIRST_FAILURE_LITERAL = /TEST\s+FAILED\s*\(/i;

/**
 * Collapse SQL literal concatenation before applying the spelling rule.
 *
 * ⛔ R3-C02, measured: `'TEST FAI' || 'LED (X 1): synthetic'` contains the
 * needle in neither the file nor the parsed step, so it parsed clean
 * (`errors=0 accepted=1`) and at runtime produced exactly the bytes the
 * detector reads.
 *
 * ⚠️ THIS DOES NOT CLOSE THE CLASS AND MUST NOT BE READ AS DOING SO. It closes
 * ONE more spelling. `format('TEST FA%sED (X)', 'IL')`, `chr(84) || …` and an
 * unbounded set of others produce the same bytes and are invisible here. A rule
 * stated over an annotation's SPELLING can always be re-spelled around — that
 * is the lesson of three review rounds, not a hypothesis. The class is closed
 * at RUNTIME by source-location attribution in `run.mjs`
 * (`attributeIdentities`; the identity nonce until 2026-09-01), which reads
 * WHERE the lane's raise came from rather than what the annotation says.
 * This rule survives only because a static refusal is cheaper, fires in
 * `--parse-only` on a database-less platform, and names the mistake earlier.
 */
const collapseSqlConcat = (s) => s.replace(/'\s*\|\|\s*'/g, "").replace(/'\s*\n\s*'/g, "");

function refuseSelfSatisfying(at, field, injected) {
  if (typeof injected !== "string") return;
  const direct = INJECTS_FIRST_FAILURE_LITERAL.test(injected);
  const byConcat = INJECTS_FIRST_FAILURE_LITERAL.test(collapseSqlConcat(injected));
  if (!direct && !byConcat) return;
  throw (
    `${at}: "${field}" injects a "${IDENTITY_CARRIER}" literal ` +
    `(${direct ? "directly" : "by string concatenation"}). A mutation that WRITES the string ` +
    `the first-failure identity check looks for satisfies the DETECTOR instead of the arm — it ` +
    `would report RED (identity ok) and count as a biting arm without the arm's own logic ever ` +
    `running. Mutate the code under test, not the failure message.`
  );
}

/**
 * The other half of rule 3: a mutation must not TARGET a failure literal
 * either. Rewriting an existing raise changes what the identity check reads
 * instead of what the arm does, in the same way and for the same reason as
 * writing one.
 *
 * ⚠️ HONEST SCOPE, because it matters. This closes the spelling where the
 * needle names the literal outright. It does NOT close the general shape —
 * `{"find":"ANON 1a): ","replace":"N1 1a): "}` carries no `TEST FAILED`
 * anywhere and passes here. That shape is refused by CONTENT, at apply time,
 * by `identityRewriteDetail` in run.mjs, which compares the FAILURE BRANCHES
 * the file carries before and after. A rule stated over the annotation's
 * spelling can always be re-spelled around; the invariant over the file cannot.
 *
 * ⭐ It load-bore for the R3-C02 identity NONCE (superseded 2026-09-01): because
 * no `find` or `anchor` may name a `TEST FAILED (` literal, the runner could
 * stamp every identity in the gate copy BEFORE the mutation steps ran without
 * disturbing a needle or an occurrence count. Source-location attribution no
 * longer rewrites the gate at all, so that dependency is GONE — the rule now
 * stands on `identityRewriteDetail` alone, which is where it always belonged.
 *
 * MEASURED 2026-08-29: 0 of the 49 file steps in the real corpus target this
 * literal, so nothing legitimate is refused.
 */
function refuseRetargetingFailureLiteral(at, field, targeted) {
  if (typeof targeted !== "string") return;
  if (!INJECTS_FIRST_FAILURE_LITERAL.test(targeted)) return;
  throw (
    `${at}: "${field}" TARGETS a "${IDENTITY_CARRIER}" literal. Rewriting a failure message — in ` +
    `either direction — changes what the first-failure identity check reads instead of what the ` +
    `arm does. Mutate the code under test, not the failure identity.`
  );
}

/**
 * The pg-lane stand-in fixtures. `scripts/pg-lane/run.sh:43-50` states what
 * they do and do not prove: they carry only the columns the real migrations'
 * FKs, policies and function bodies name — they are the author's model of the
 * schema, not the schema.
 */
const PG_LANE_FIXTURE_DIR = "scripts/pg-lane/fixtures/";

/**
 * A repo-relative path reduced to the segments that survive resolution: `\` is
 * read as `/`, and empty (`//`) and `.` segments are dropped, because
 * `join(REPO_ROOT, rel)` drops them too. Used to compare a path against a
 * directory by what it OPENS rather than by how it is spelled.
 */
const normalizeRepoPath = (p) =>
  p
    .replace(/\\/g, "/")
    .split("/")
    .filter((seg) => seg !== "" && seg !== ".")
    .join("/");

/**
 * ⭐ AUTHORING RULE, phase 164.4 (threat T-164.4-01). NO TWIN MAY TARGET A
 * STAND-IN.
 *
 * A `RED-UNDER-M` proves an arm can fail by mutating the thing under test and
 * requiring the gate to redden on that arm. Mutate a stand-in instead and the
 * RED proves only that the FIXTURE AUTHOR'S GUESS can be broken — the
 * production object the arm exists to defend was never touched, and the arm is
 * counted as biting anyway. That is a vacuous pass manufactured inside the
 * vacuity detector, which is the one class this whole gate family exists to
 * refuse.
 *
 * PARSE TIME is the right seam, the same as rule 3a: a refused annotation is
 * MALFORMED, so it is never counted as a twin, the file's prose/twin parity
 * reds too, and the refusal fires in `--parse-only` on a database-less
 * platform. A runtime check would let the annotation count first.
 *
 * MEASURED at HEAD 2026-09-02:
 * `grep -a -c 'RED-UNDER-M:.*"file":"scripts/pg-lane/fixtures/' supabase/tests/*.sql`
 * -> 0 in all 71 files. The rule refuses nothing that exists, which is the
 * standing this repo requires of 3a and 3b.
 *
 * ⚠️ It keys on the TWIN'S TARGET, never on a fixture's POSITION in the
 * `RED-UNDER-SETUP` apply list. Plan 164.4-00 measured a legitimate stand-in
 * sitting BETWEEN two migrations (`04-fixture-compute-jobs-targets.sql`), so
 * "stand-ins first" is a default, not an invariant, and a position-keyed rule
 * would refuse a correct setup.
 *
 * ⛔ IT MUST NORMALISE, NOT STRING-PATCH. Measured 2026-09-02: a prefix test
 * over the raw spelling refused `scripts/pg-lane/fixtures/03-…sql` and let
 * `scripts/pg-lane/./fixtures/03-…sql` and `scripts/pg-lane//fixtures/03-…sql`
 * straight through — both resolve to the IDENTICAL stand-in once `materialize`
 * does `join(REPO_ROOT, rel)`, and `bad-file-ref` compares `step.file` to the
 * corpus by exact string, so listing the same odd spelling in
 * `RED-UNDER-SETUP` satisfies that check too. So the path is decomposed and
 * degenerate segments (empty, `.`) are DROPPED before the prefix test, rather
 * than two known spellings being patched away. `isRepoRelativePath` has
 * already refused `..`, absolute paths and drive letters, so normalisation
 * here cannot walk out of the checkout. The comparison is case-folded because
 * on a case-insensitive checkout `Scripts/PG-Lane/Fixtures/…` opens the same
 * stand-in; nothing legitimate differs from this directory by case alone.
 */
function targetsPgLaneFixture(p) {
  // Trailing "/" so the directory itself matches and a sibling whose name
  // merely STARTS with "fixtures" (e.g. `scripts/pg-lane/fixtures-extra/`)
  // does not.
  return `${normalizeRepoPath(p)}/`.toLowerCase().startsWith(PG_LANE_FIXTURE_DIR.toLowerCase());
}

/** Validate one `apply` step. Returns the normalised step, or throws a message string. */
function validateStep(step, index) {
  const at = `apply step ${index + 1}`;
  if (!isPlainObject(step)) throw `${at} must be a JSON object`;
  if (!STEP_KINDS.has(step.kind)) {
    throw `${at}: unknown step kind ${JSON.stringify(step.kind ?? null)} (expected "edit", "insert-after" or "sql")`;
  }
  for (const key of Object.keys(step)) {
    if (!STEP_KEYS[step.kind].has(key)) throw `${at}: unknown key "${key}" for kind "${step.kind}"`;
  }

  if (step.kind === "sql") {
    if (!isNonEmptyString(step.stmt)) throw `${at}: "stmt" must be a non-empty string`;
    // A `sql` step runs against the lane's database, so a RAISE in it reaches
    // the same output stream `attributeIdentities()` reads.
    refuseSelfSatisfying(at, "stmt", step.stmt);
    return { kind: "sql", stmt: step.stmt };
  }

  if (!isRepoRelativePath(step.file)) {
    throw `${at}: "file" must be a repo-relative path (no leading "/" and no ".." segment)`;
  }
  if (targetsPgLaneFixture(step.file)) {
    throw (
      `${at}: "file" targets a pg-lane stand-in fixture (${PG_LANE_FIXTURE_DIR}**) — a mutation ` +
      `to a stand-in proves the fixture author's guess, not production; target a ` +
      `supabase/migrations/** file, the gate itself, or use a sql step`
    );
  }
  // `occurrences` is the annotator's MEASUREMENT of how many times the needle
  // appears in the file today. It is required precisely because plan 01's
  // prose locator matched the wrong single occurrence.
  if (!isPositiveInt(step.occurrences)) {
    throw `${at}: "occurrences" is required and must be a positive integer — it pins the MEASURED number of matches so a drifted or mis-located needle is a MEASURE_FAIL, not a silent no-op`;
  }
  const nth = step.nth === undefined ? 1 : step.nth;
  if (!isPositiveInt(nth)) throw `${at}: "nth" must be a positive integer`;
  if (nth > step.occurrences) {
    throw `${at}: "nth" (${nth}) exceeds the measured "occurrences" (${step.occurrences})`;
  }

  if (step.kind === "edit") {
    if (!isNonEmptyString(step.find)) throw `${at}: "find" must be a non-empty string`;
    if (typeof step.replace !== "string") throw `${at}: "replace" must be a string (use "" to delete)`;
    refuseSelfSatisfying(at, "replace", step.replace);
    refuseRetargetingFailureLiteral(at, "find", step.find);
    return {
      kind: "edit",
      file: step.file,
      find: step.find,
      replace: step.replace,
      occurrences: step.occurrences,
      nth,
    };
  }

  if (!isNonEmptyString(step.anchor)) throw `${at}: "anchor" must be a non-empty string`;
  if (!isNonEmptyString(step.text)) throw `${at}: "text" must be a non-empty string`;
  refuseSelfSatisfying(at, "text", step.text);
  refuseRetargetingFailureLiteral(at, "anchor", step.anchor);
  return {
    kind: "insert-after",
    file: step.file,
    anchor: step.anchor,
    text: step.text,
    occurrences: step.occurrences,
    nth,
  };
}

/** Validate one RED-UNDER-M object. Returns the normalised annotation, or throws a message string. */
function validateAnnotation(raw) {
  if (!isPlainObject(raw)) throw "a RED-UNDER-M annotation must be a JSON object";
  for (const key of Object.keys(raw)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      throw `unknown key "${key}" (expected "arm", "apply", "waiver" or "neuter")`;
    }
  }
  if (!isNonEmptyString(raw.arm)) throw 'a RED-UNDER-M annotation requires a non-empty "arm"';

  const hasApply = raw.apply !== undefined;
  const hasWaiver = raw.waiver !== undefined;
  if (hasApply && hasWaiver) throw '"apply" and "waiver" are mutually exclusive';
  if (!hasApply && !hasWaiver) throw 'requires exactly one of "apply" or "waiver"';

  if (hasWaiver) {
    if (!isNonEmptyString(raw.waiver)) throw '"waiver" must be a non-empty reason string';
    if (raw.neuter !== undefined) {
      throw 'a waiver must not carry "neuter" — nothing is executed, so nothing can be neutered';
    }
    return { arm: raw.arm, apply: [], neuter: [], waiver: raw.waiver };
  }

  if (!Array.isArray(raw.apply) || raw.apply.length === 0) {
    throw '"apply" must be an array with at least one step';
  }
  const apply = raw.apply.map((step, i) => validateStep(step, i));

  let neuter = [];
  if (raw.neuter !== undefined) {
    if (!Array.isArray(raw.neuter) || raw.neuter.length === 0) {
      throw '"neuter" must be an array with at least one entry';
    }
    neuter = raw.neuter.map((entry, i) => {
      if (!isPlainObject(entry) || !isNonEmptyString(entry.arm)) {
        throw `neuter[${i}] requires a non-empty "arm"`;
      }
      for (const key of Object.keys(entry)) {
        if (key !== "arm") throw `neuter[${i}]: unknown key "${key}"`;
      }
      return { arm: entry.arm };
    });
  }

  return { arm: raw.arm, apply, neuter, waiver: null };
}

/** Validate a RED-UNDER-SETUP object. Returns `{apply}`, or throws a message string. */
function validateSetup(raw) {
  if (!isPlainObject(raw)) throw "a RED-UNDER-SETUP annotation must be a JSON object";
  for (const key of Object.keys(raw)) {
    if (key !== "apply") throw `unknown key "${key}" (expected "apply")`;
  }
  if (!Array.isArray(raw.apply) || raw.apply.length === 0) {
    throw '"apply" must be an array with at least one path';
  }
  for (const p of raw.apply) {
    if (!isRepoRelativePath(p)) {
      throw `"apply" entries must be repo-relative paths (no leading "/" and no ".." segment): ${JSON.stringify(p)}`;
    }
  }
  return { apply: [...raw.apply] };
}

/**
 * Parse the RED-UNDER family out of one SQL file's text.
 *
 * Returns `{ file, setup, prose, structured, errors, parity }`. Errors are
 * COLLECTED, never thrown and never silently dropped: an annotation that fails
 * validation does not become a structured twin, so a malformed annotation
 * always breaks parity too. Skipping a bad annotation would be a control that
 * cannot fail.
 */
export function parseAnnotations(text, { file = "<unknown>" } = {}) {
  const lines = text.split("\n");
  const prose = [];
  const structured = [];
  const errors = [];
  const seenArms = new Map();
  /**
   * The single RED-UNDER-SETUP declaration, once seen. Explicitly annotated so
   * TypeScript consumers (the contract tests, and Phase 164.4's tooling) get a
   * real type instead of inferring `null` from the initialiser.
   */
  let setup = /** @type {{ apply: string[], line: number } | null} */ (null);

  lines.forEach((lineText, i) => {
    const lineNo = i + 1;
    const fail = (message) => errors.push({ line: lineNo, message: `${file}:${lineNo}: ${message}` });

    if (PROSE_RE.test(lineText)) {
      prose.push({ line: lineNo, text: lineText.trim() });
      return;
    }

    const setupMatch = lineText.match(SETUP_RE);
    if (setupMatch) {
      if (setup !== null) {
        fail(`only one RED-UNDER-SETUP line is allowed per file (first was line ${setup.line})`);
        return;
      }
      let raw;
      try {
        raw = JSON.parse(setupMatch[1]);
      } catch (e) {
        fail(`malformed JSON in RED-UNDER-SETUP: ${e.message}`);
        return;
      }
      try {
        setup = { ...validateSetup(raw), line: lineNo };
      } catch (message) {
        fail(String(message));
      }
      return;
    }

    const structuredMatch = lineText.match(STRUCTURED_RE);
    if (!structuredMatch) return;

    let raw;
    try {
      raw = JSON.parse(structuredMatch[1]);
    } catch (e) {
      fail(`malformed JSON in RED-UNDER-M: ${e.message}`);
      return;
    }
    let annotation;
    try {
      annotation = validateAnnotation(raw);
    } catch (message) {
      fail(String(message));
      return;
    }
    if (seenArms.has(annotation.arm)) {
      fail(`duplicate arm "${annotation.arm}" (first declared at line ${seenArms.get(annotation.arm)})`);
      return;
    }
    seenArms.set(annotation.arm, lineNo);
    structured.push({ ...annotation, line: lineNo, file });
  });

  return {
    file,
    setup,
    prose,
    structured,
    errors,
    parity: {
      prose: prose.length,
      structured: structured.length,
      ok: prose.length === structured.length,
    },
  };
}

/** Parse one file from disk. */
export function parseFile(path) {
  return parseAnnotations(readFileSync(path, "utf8"), { file: path });
}

// ===========================================================================
// tokenizeStatements — THE SINGLE DEFINITION OF "WHAT IS CODE" (PRIMITIVE A)
// ===========================================================================
//
// ⛔ THE DEFECT CLASS THIS EXISTS FOR, and why it is a tokenizer rather than a
// fifth regex. `run.mjs` carried FOUR readers that each decided independently
// what counted as code — `executableText`'s four-regex masking pipeline,
// `isBranchHead`'s two unanchored line arms, `neuterArm`'s forward scan and
// `statementEndLine`, the last two tracking only `'`. Each carried its own
// partial definition, so the same defect class re-opened FOUR times:
//
//   [R4-C01] `EXCEPTION WHEN OTHERS THEN v_raised := true; END;` (seven real
//     lines in supabase/tests/test_profiles_privileged_columns_locked.sql) and
//     `SET ROLE postgres; IF NOT ok THEN` were both accepted WHOLE as branch
//     heads, so the backward scan broke there and an accepted neuter left the
//     line's other statements — including a superuser `SET ROLE` — executing.
//   [MUT-I01] an apostrophe inside a `--` comment inside a RAISE's span flipped
//     the forward scan's quote parity: odd parity spuriously REFUSED a legal
//     arm, and even parity silently OVER-NEUTERED the statement after it.
//
// Every one of those is a consequence of reading LINES and of tracking one
// quote character. The rule is therefore restated over STATEMENTS, with all
// five lexical states carried ACROSS lines, in ONE place that every consumer
// calls. The ROADMAP goal refuses a fifth regex pass by name.
//
// ⚠️ THE SPAN SHAPE IS A PUBLISHED CONTRACT, not an implementation detail.
// Plan 164.3.1-05 (Primitive B, source-location attribution) resolves a raise's
// file line as `DO_statement.startLine + psql_CONTEXT_line − 1`, so:
//   • `startLine`/`endLine` are 1-BASED and INCLUSIVE;
//   • a `DO $$ … $$;` block is ONE statement whose `startLine` is the DO line.
// Renaming the export or reshaping those fields ripples through plans 05, 09,
// 10 and 11. `src/__tests__/sql-statement-tokenizer.test.ts` pins it.
//
// ⚠️ BLOCK COMMENTS NEST (RESEARCH A4). PostgreSQL's `/* … */` nests, and the
// line-local regex this replaces did not handle that. The tokenizer NESTS —
// strictly more correct than the reader it replaces — and the choice ships with
// a fixture in the span-contract test file so which behaviour shipped is a
// measured fact rather than a reading of the code.
//
// ⚠️ HONEST SCOPE, stated rather than implied. This is a STATEMENT tokenizer,
// not a PL/pgSQL parser: it knows lexical state and the shape of a branch head,
// and nothing else. It does not know scoping, expressions or types. A construct
// it cannot classify becomes an ordinary statement, which the neuter scan then
// REFUSES loudly — the safe direction — rather than absorbing silently. A full
// parser was evaluated and REJECTED (CONTEXT § Primitive A): `libpg-query` is a
// native dependency in a repo with a banned-package supply-chain gate, and
// `pgsql-ast-parser` does not cover all PL/pgSQL, so it would need a fallback
// reader — reintroducing the two-readers-with-composing-blind-spots defect
// ([VAC04-C1]) this primitive exists to close.
//
// Takes TEXT only. It performs NO file I/O; any tokenizer-driven read stays
// behind `isRepoRelativePath` above.

/** A dollar-quote delimiter, sticky so it can be tested at an exact offset. */
const DOLLAR_TAG_RE = /\$([A-Za-z_]\w*)?\$/y;

/** Bare branch heads: a segment whose entire code content is this one word. */
const BARE_HEADS = new Set(["BEGIN", "DECLARE", "ELSE"]);

/**
 * Segment-opening keywords after which a `THEN` closes a branch head.
 *
 * Anchoring on the segment's FIRST word is what closes the unanchored
 * `/\b(THEN|LOOP)$/i` arm: `SET ROLE postgres; IF NOT ok THEN` opens with `SET`
 * for its first statement and with `IF` for the head that follows it, so the
 * two are separable and neither swallows the other.
 */
const THEN_OPENERS = new Set(["IF", "ELSIF", "ELSEIF", "WHEN", "EXCEPTION"]);

/**
 * Segment-opening keywords after which a `LOOP` closes a branch head.
 *
 * ⛔ `END` is deliberately NOT here. It was, and `END LOOP;` came out as a head
 * (`[head: true, terminated: false, "END LOOP"]`) while `END IF;` was an
 * ordinary terminated statement. Both consumers of `head` read it as "the head
 * of the enclosing branch": the neuter walk in `run.mjs` stopped on the closer
 * and ACCEPTED a neuter that left `SET ROLE postgres;` live behind a multi-line
 * loop (the measured RESET ROLE class), and `failureBranches` anchored the
 * branch on it, hiding guard negation (GRAMMAR § 3b). A closer is a statement.
 */
const LOOP_OPENERS = new Set(["FOR", "FOREACH", "WHILE", "LOOP"]);

/**
 * Every keyword that can constitute or terminate a branch-head unit.
 *
 * Re-exported by `run.mjs` as `BRANCH_HEAD_WORDS`, which the neuter test's
 * cross-product oracle GENERATES its inputs from — so a keyword added here
 * automatically widens that test, and one added without a bare-code spelling
 * fails its completeness assertion by name rather than silently dropping out.
 */
export const BRANCH_HEAD_KEYWORDS = [
  "THEN",
  "BEGIN",
  "ELSE",
  "ELSIF",
  "LOOP",
  "DECLARE",
  "EXCEPTION",
];

const isWordStart = (ch) => ch !== undefined && /[A-Za-z_]/.test(ch);
const isWordChar = (ch) => ch !== undefined && /[A-Za-z0-9_]/.test(ch);
/**
 * The NORMALIZER's identifier class (`isIdentChar` in sql-body-normalize.mjs,
 * `$` included), used here ONLY to decide whether an `E` before a quote is the
 * escape prefix or the tail of an identifier — the two readers must share
 * that one rule (WR-01), so it is spelled identically rather than reusing
 * `isWordChar` above.
 */
const isEscapePrefixBlocker = (ch) => ch !== undefined && /[A-Za-z0-9_$]/.test(ch);

/** 1-based line number lookup over precomputed line-start offsets. */
function makeLineOf(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === "\n") starts.push(i + 1);
  return (offset) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

/**
 * Skip the NESTING block comment opening at `i` (`text[i] === "/"` and
 * `text[i + 1] === "*"`, both inside `[i, to)`). Returns the index just after
 * the `*\/` that closes the outermost level, or `to` when the comment is
 * unterminated within the region. PostgreSQL semantics (RESEARCH A4); the ONE
 * copy `scanRegion` and `peekNextWord` share, so a bounds rule fixed here is
 * fixed for both readers.
 *
 * Every two-character look is bounds-checked against `to`, not against the end
 * of `text`: a region is a dollar-quoted BODY, and the byte at `to` belongs to
 * the enclosing statement, not to the comment. Those checks are the ONLY thing
 * keeping the result at or below `to` — no clamp, so the tokenizer test's
 * bounds pin goes RED the moment one is dropped (MEASURED 2026-09-02).
 */
export function skipBlockComment(text, i, to) {
  let j = i;
  let nest = 0;
  while (j < to) {
    if (text[j] === "/" && j + 1 < to && text[j + 1] === "*") {
      nest += 1;
      j += 2;
    } else if (text[j] === "*" && j + 1 < to && text[j + 1] === "/") {
      nest -= 1;
      j += 2;
      if (nest === 0) break;
    } else j += 1;
  }
  return j;
}

/** The next word after `from`, skipping whitespace and comments. Read-only. */
function peekNextWord(text, from, to) {
  let i = from;
  for (;;) {
    while (i < to && /\s/.test(text[i])) i += 1;
    if (i < to - 1 && text[i] === "-" && text[i + 1] === "-") {
      while (i < to && text[i] !== "\n") i += 1;
      continue;
    }
    if (i < to - 1 && text[i] === "/" && text[i + 1] === "*") {
      i = skipBlockComment(text, i, to);
      continue;
    }
    break;
  }
  if (!isWordStart(text[i])) return null;
  let j = i;
  while (j < to && isWordChar(text[j])) j += 1;
  return text.slice(i, j).toUpperCase();
}

/**
 * Scan `[from, to)` at `depth`, appending statements to `out` (when non-null)
 * and returning the MASKING PROJECTION of the region: same length as the
 * source, with every non-code region blanked to spaces and newlines preserved
 * so offsets and line numbers are identical to the original.
 *
 * ONE state machine. `maskNonCode` and `tokenizeStatements` are two views of
 * this single scan, never two readers — that duality is the defect this file
 * exists to remove, not a shape to reproduce.
 */
function scanRegion(text, from, to, depth, lineOf, out) {
  const mask = text.slice(from, to).split("");
  /** Blank `[a, b)` in the mask, preserving newlines. */
  const blank = (a, b) => {
    for (let k = Math.max(a, from); k < Math.min(b, to); k += 1) {
      if (text[k] !== "\n") mask[k - from] = " ";
    }
  };

  let i = from;
  let stmtStart = -1;
  let firstWord = null;
  let parenDepth = 0;
  let caseDepth = 0;
  let bodies = [];
  let awaitingExceptionThen = false;

  const resetSegment = () => {
    stmtStart = -1;
    firstWord = null;
    parenDepth = 0;
    caseDepth = 0;
    bodies = [];
    awaitingExceptionThen = false;
  };

  const emit = (end, { head = false, terminated = false } = {}) => {
    if (stmtStart === -1 || end <= stmtStart) {
      resetSegment();
      return;
    }
    if (out !== null) {
      out.push({
        startLine: lineOf(stmtStart),
        endLine: lineOf(end - 1),
        text: text.slice(stmtStart, end),
        executableText: mask.slice(stmtStart - from, end - from).join(""),
        head,
        terminated,
        depth,
        start: stmtStart,
        end,
      });
      // Pre-order: a statement is followed by the statements of any body it
      // encloses, so siblings at one depth stay in source order and a consumer
      // can walk them by index (see `run.mjs`'s backward scan).
      for (const body of bodies) scanRegion(text, body.from, body.to, depth + 1, lineOf, out);
    }
    resetSegment();
  };

  while (i < to) {
    const ch = text[i];

    // ── line comment: to end of line ────────────────────────────────────────
    if (ch === "-" && i + 1 < to && text[i + 1] === "-") {
      let j = i;
      while (j < to && text[j] !== "\n") j += 1;
      blank(i, j);
      i = j;
      continue;
    }

    // ── block comment: NESTING (PostgreSQL semantics — RESEARCH A4) ─────────
    if (ch === "/" && i + 1 < to && text[i + 1] === "*") {
      const j = skipBlockComment(text, i, to);
      blank(i, j);
      i = j;
      continue;
    }

    // ── single-quoted literal, `''` escape, carried ACROSS lines ────────────
    //
    // An `E'…'` literal ALSO honours `\x` escapes — the same rule, spelled the
    // same way, as `scanSql` in scripts/sql-body-normalize.mjs. WR-01 (164.3.1
    // review), MEASURED on `RAISE EXCEPTION E'it\'s x'; SELECT 1;`: this
    // scanner closed the literal at `\'`, the tail `s x'` opened a NEW literal
    // that ran to the next apostrophe or EOF, and the raise came out as ONE
    // unterminated statement swallowing `SELECT 1;` — while the normalizer
    // read the same bytes correctly. Two readers with different blind spots
    // over one text is the composing shape [VAC04-C1] this primitive exists
    // to remove; their agreement over the corpus is pinned in
    // sql-statement-tokenizer.test.ts.
    if (ch === "'") {
      if (stmtStart === -1) stmtStart = i;
      const escaped =
        i > 0 &&
        (text[i - 1] === "E" || text[i - 1] === "e") &&
        !(i > 1 && isEscapePrefixBlocker(text[i - 2]));
      let j = i + 1;
      let closed = false;
      while (j < to) {
        if (escaped && text[j] === "\\") {
          j = Math.min(j + 2, to);
          continue;
        }
        if (text[j] !== "'") {
          j += 1;
          continue;
        }
        if (j + 1 < to && text[j + 1] === "'") {
          j += 2;
          continue;
        }
        j += 1;
        closed = true;
        break;
      }
      // Blank the INTERIOR only: the delimiters stay so the projection still
      // reads as `'…'` and a keyword inside a literal can never be code.
      blank(i + 1, closed ? j - 1 : j);
      i = j;
      continue;
    }

    // ── double-quoted identifier: CODE, kept verbatim in the projection ─────
    if (ch === '"') {
      if (stmtStart === -1) stmtStart = i;
      let j = i + 1;
      while (j < to) {
        if (text[j] !== '"') {
          j += 1;
          continue;
        }
        if (j + 1 < to && text[j + 1] === '"') {
          j += 2;
          continue;
        }
        j += 1;
        break;
      }
      i = j;
      continue;
    }

    // ── dollar-quoted body, tag-matched, carried ACROSS lines ───────────────
    if (ch === "$") {
      DOLLAR_TAG_RE.lastIndex = i;
      const m = DOLLAR_TAG_RE.exec(text);
      if (m !== null && m.index === i) {
        const tag = m[0];
        const bodyFrom = i + tag.length;
        const closeAt = text.indexOf(tag, bodyFrom);
        const unterminated = closeAt === -1 || closeAt + tag.length > to;
        const bodyTo = unterminated ? to : closeAt;
        const after = unterminated ? to : closeAt + tag.length;
        if (stmtStart === -1) stmtStart = i;
        blank(i, after);
        if (bodyTo > bodyFrom) bodies.push({ from: bodyFrom, to: bodyTo });
        i = after;
        continue;
      }
      // A bare `$` (a `$1` parameter, or `$` inside an identifier). Not a
      // delimiter — fall through and treat it as an ordinary character.
    }

    // ── statement terminator, in normal state only ──────────────────────────
    if (ch === ";") {
      if (stmtStart !== -1) emit(i + 1, { terminated: true });
      else resetSegment();
      i += 1;
      continue;
    }

    if (ch === "(" || ch === ")") {
      if (stmtStart === -1) stmtStart = i;
      if (ch === "(") parenDepth += 1;
      else parenDepth = Math.max(0, parenDepth - 1);
      i += 1;
      continue;
    }

    // ── word ────────────────────────────────────────────────────────────────
    if (isWordStart(ch)) {
      let j = i;
      while (j < to && isWordChar(text[j])) j += 1;
      const word = text.slice(i, j).toUpperCase();
      const wordStart = i;
      if (stmtStart === -1) stmtStart = wordStart;
      if (firstWord === null) firstWord = word;

      // A `CASE … WHEN … THEN … ELSE … END` EXPRESSION is not a branch: its
      // THEN and ELSE must not be read as heads. Depth-tracked so the head
      // rules below only fire at expression depth 0.
      if (parenDepth === 0) {
        if (word === "CASE") caseDepth += 1;
        else if (word === "END" && caseDepth > 0) caseDepth -= 1;
      }

      if (parenDepth === 0 && caseDepth === 0) {
        if (awaitingExceptionThen) {
          if (word === "THEN") {
            i = j;
            emit(j, { head: true });
            continue;
          }
        } else if (BARE_HEADS.has(word) && stmtStart === wordStart) {
          i = j;
          emit(j, { head: true });
          continue;
        } else if (word === "EXCEPTION" && stmtStart === wordStart) {
          // `EXCEPTION` alone opens the handler section; `EXCEPTION WHEN … THEN`
          // is ONE head unit. Peeking is read-only and touches no scanner state.
          if (peekNextWord(text, j, to) === "WHEN") awaitingExceptionThen = true;
          else {
            i = j;
            emit(j, { head: true });
            continue;
          }
        } else if (word === "THEN" && THEN_OPENERS.has(firstWord)) {
          i = j;
          emit(j, { head: true });
          continue;
        } else if (word === "LOOP" && LOOP_OPENERS.has(firstWord)) {
          i = j;
          emit(j, { head: true });
          continue;
        }
      }

      i = j;
      continue;
    }

    if (!/\s/.test(ch) && stmtStart === -1) stmtStart = i;
    i += 1;
  }

  // A trailing segment with no terminator. `terminated: false` is what lets the
  // neuter refuse "could not find the end of the RAISE statement" instead of
  // guessing an end — an unterminated statement is a MEASURE failure, not a
  // shorter statement.
  if (stmtStart !== -1) emit(to, { terminated: false });

  return mask.join("");
}

/**
 * Every SQL statement in `text`, in pre-order.
 *
 * @param {string} text
 * @returns {Array<{
 *   startLine: number, endLine: number, text: string, executableText: string,
 *   head: boolean, terminated: boolean, depth: number, start: number, end: number
 * }>}
 *
 * `startLine`/`endLine` are 1-based and INCLUSIVE (the plan-05 contract above).
 * `head` marks a branch-head unit — a bare `BEGIN`/`DECLARE`/`ELSE`, an
 * `EXCEPTION [WHEN … THEN]` clause, or a segment opening with `IF`/`ELSIF`/
 * `WHEN`/`FOR`/`FOREACH`/`WHILE`/`LOOP` and closing on `THEN`/`LOOP` (`END`
 * is a closer, never an opener — see `LOOP_OPENERS`). Head units
 * carry no semicolon, which is exactly why a compound line decomposes: the head
 * ends where the keyword ends and the statements sharing its line follow it.
 * `depth` is dollar-quote nesting: a `DO $$ … $$;` block is ONE depth-0
 * statement, and the PL/pgSQL statements inside its body are depth 1, emitted
 * immediately after it so siblings at any depth remain in source order.
 */
export function tokenizeStatements(text) {
  const out = [];
  scanRegion(text, 0, text.length, 0, makeLineOf(text), out);
  return out;
}

/**
 * The masking projection alone: `text` with every non-code region blanked to
 * spaces, newlines and offsets preserved. Same scan as `tokenizeStatements` —
 * one definition of what is code, two views of it.
 */
export function maskNonCode(text) {
  return scanRegion(text, 0, text.length, 0, makeLineOf(text), null);
}

/**
 * A `RAISE EXCEPTION`, read in a statement's MASKING PROJECTION so a mention
 * inside a literal — or a commented-out (already neutered) raise — is not one.
 *
 * ⭐ ONE DEFINITION, 2026-09-02. This lived in `run.mjs` only, and `scanCorpus`
 * below now needs the same notion of "does this file contain executable raise
 * code". A second spelling of the same regex in a second file is exactly how
 * two readers of "is this a raise" drift apart, so it moved HERE — the module
 * that already owns the one definition of what is code — and `run.mjs` imports
 * it. It is not duplicated anywhere.
 */
export const RAISE_EXCEPTION_RE = /\bRAISE\s+EXCEPTION\b/i;

/**
 * The literal every arm identity is carried in. Spelled ONCE, beside the raise
 * regex it is always read with. Every reader imports it — this module's own
 * refusal messages and `run.mjs` alike — and nothing re-spells or re-derives
 * it, for the same reason `RAISE_EXCEPTION_RE` moved here: two spellings of
 * one literal is how two readers of "is this an arm identity" drift apart.
 */
export const IDENTITY_CARRIER = "TEST FAILED (";

/**
 * The catalog a gate reads to ask whether pg_cron is installed, and the
 * extension name it asks about. Spelled ONCE, beside the raise regex and the
 * identity carrier they are always read with, for the same reason those moved
 * here: two spellings of one literal is how two readers of "does this gate
 * need pg_cron" drift apart.
 */
export const PG_CRON_CATALOG_RE = /\bpg_extension\b/i;
export const PG_CRON_EXTENSION = "pg_cron";

/**
 * Does this gate's EXECUTABLE text probe `pg_extension` for pg_cron?
 *
 * ⛔ 2026-09-03 (164.4-03). The pg-lane (`scripts/pg-lane/run.sh`) boots a bare
 * throwaway cluster with no pg_cron, and the founder decided on 2026-09-03 NOT
 * to install it there. A gate that probes for the extension therefore either
 * RAISEs on the lane (its baseline can never be GREEN, and `runCorpus` judges
 * no arm in a red-baseline file) or green-skips whole Parts behind a
 * pg_cron-conditional `RAISE NOTICE`, leaving those arms un-falsifiable. Both
 * shapes are recorded, per criterion 4, rather than silently absorbed into
 * `pending`.
 *
 * ⛔ THE TWO HALVES ARE READ FROM DIFFERENT VIEWS, exactly as
 * `classifyGateIdiom` reads its own two halves and for the same measured
 * reason. `pg_extension` is a CATALOG REFERENCE — code — so it is read off
 * `executableText`, which blanks comments: a commented-out probe is not a
 * probe. `'pg_cron'` is a STRING LITERAL, and the masking projection blanks
 * literals, so it is read off that same statement's RAW `.text` — the identity
 * carrier's rule, applied to the other literal this file needs.
 *
 * MEASURED 2026-09-03 over `supabase/tests/` (71 files): 6 files mention
 * `pg_cron` in raw bytes, 5 probe the catalog for it in executable code, and 4
 * of those 5 are idiom files. `test_wizard_composite_fence.sql:698` mentions
 * pg_cron only inside a `--` comment and is NOT a probe — the negative control
 * that proves this reads code, not prose.
 */
export function gateNeedsPgCron(text) {
  for (const stmt of tokenizeStatements(text)) {
    if (!PG_CRON_CATALOG_RE.test(stmt.executableText)) continue;
    if (stmt.text.includes(PG_CRON_EXTENSION)) return true;
  }
  return false;
}

/**
 * Which of four idiom classes an UNANNOTATED gate file falls in — the data
 * behind the runner's `unreachable:` and `lane-blocked:` prints (phase 164.4
 * criterion 1 as amended: the exclusion is NAMED on every run, because a
 * silent exclusion fails that criterion exactly as a missing annotation does).
 *
 *   "pending"      code-level `RAISE EXCEPTION` carrying `TEST FAILED (` —
 *                  the runner's identity idiom. Annotatable; not yet annotated.
 *   "lane-blocked" an idiom file whose executable text probes `pg_extension`
 *                  for pg_cron, which the pg-lane cannot host (see
 *                  `gateNeedsPgCron`). Annotatable in principle; not
 *                  falsifiable on today's lane, so DEFERRED with its reason
 *                  printed — SCOPE AMENDMENT #2, founder 2026-09-03, TODOS
 *                  [REDUNDER-PGCRON].
 *   "unreachable"  code-level `RAISE EXCEPTION`, none of them carrying the
 *                  identity idiom. `attributeIdentities` has nothing to
 *                  attribute, so no arm of this file can be judged today.
 *   "inert"        no code-level `RAISE EXCEPTION` at all. MEASURED 2026-09-02:
 *                  zero such files in `supabase/tests/`. If one ever appears it
 *                  is a FINDING — a gate that cannot fail — and it is printed.
 *
 * ⚠️ ORDER MATTERS and is asserted by the parser's own vitest file: `unreachable`
 * is decided BEFORE `lane-blocked`. `test_retention_crons_safe.sql` probes
 * pg_cron AND raises outside the identity idiom; it stays `unreachable`,
 * because the reason no arm of it can be judged is the idiom, not the lane, and
 * a file cannot be deferred out of a class it was never in.
 *
 * ⛔ Both halves are read the way the runner reads them, not by grep. The raise
 * test runs against `executableText` (so a raise inside a comment or a literal
 * is not one); the carrier test runs against that same statement's RAW text,
 * because the identity lives INSIDE the raise's message literal and the masking
 * projection blanks literals. MEASURED 2026-09-02: reading the carrier off
 * `executableText` classifies all 70 unannotated files `unreachable` — the
 * absent-vs-correct ambiguity this classification exists to remove.
 */
export function classifyGateIdiom(text) {
  let raises = false;
  let idiom = false;
  for (const stmt of tokenizeStatements(text)) {
    if (!RAISE_EXCEPTION_RE.test(stmt.executableText)) continue;
    raises = true;
    if (stmt.text.includes(IDENTITY_CARRIER)) {
      idiom = true;
      break;
    }
  }
  if (!raises) return "inert";
  if (!idiom) return "unreachable";
  return gateNeedsPgCron(text) ? "lane-blocked" : "pending";
}

/**
 * Scan a directory of `.sql` gate files for the coverage numerator/denominator
 * (D-01). "Annotated" means at least one LINE-START marker of EITHER kind — a
 * prose `RED-UNDER:` or a structured `RED-UNDER-M:` twin. Both use the same
 * line-start anchor the parity gate uses, so coverage still cannot be inflated
 * by a file that merely documents the syntax.
 *
 * ⛔ IN-01: this used to require `prose.length > 0`, and `runCorpus` /
 * `parseOnlyCorpus` iterate ONLY this list. A file carrying five
 * `RED-UNDER-M` twins and zero prose markers was therefore never parsed, never
 * parity-checked, its arms never executed, and it counted toward neither the
 * numerator nor a defect — the runner reported clean having not looked at it.
 * The per-file parity gate cannot catch that: it only runs for files already
 * in this list. The hole was covered only from OUTSIDE the gate, by a vitest
 * file that walks every file itself, so a developer running
 * `node scripts/mutation-runner/run.mjs` locally saw green regardless.
 *
 * With `||`, a structured-only file enters the list and the runner's own
 * parity check fires on it (`prose 0 !== structured 5`).
 *
 * MEASURED 2026-08-29: no file in `supabase/tests/` is structured-only, so this
 * `||` moved `filesAnnotated` by ZERO — it refuses nothing the corpus already
 * relies on. The count itself moves as Phase 164.4's batches land; the exact
 * pin lives in the parser test (`scanCorpus reports N of 71 files annotated`),
 * and the live floor is FILES_FLOOR in run.mjs. No integer is restated here.
 *
 * ⭐ 2026-09-02, phase 164.4: the UNANNOTATED remainder is classified too, by
 * `classifyGateIdiom` above, and returned as sorted basename lists. The
 * denominator stays every `.sql` in the directory (`filesTotal`) — the end
 * state of the backfill is `files 40/71` with the other 31 PRINTED BY NAME,
 * never `files 40/40` with the gap quietly redefined away.
 *
 * ⭐ 2026-09-03, plan 164.4-03: a FIFTH partition class, `laneBlockedFiles`.
 * The partition is `annotated + pending + unreachable + inert + lane-blocked
 * = filesTotal`, and the parser's vitest file asserts that sum rather than any
 * one member, so a class that stops being computed cannot hide inside another.
 * RE-MEASURED 2026-09-03 at this commit over `supabase/tests/`: 1 annotated +
 * 39 pending + 27 unreachable + 0 inert + 4 lane-blocked = 71.
 */
export function scanCorpus(dir) {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const annotatedFiles = [];
  const unreachableFiles = [];
  const pendingFiles = [];
  const inertFiles = [];
  const laneBlockedFiles = [];
  const results = [];
  for (const name of files) {
    const text = readFileSync(join(dir, name), "utf8");
    const result = parseAnnotations(text, { file: join(dir, name) });
    results.push({ name, result });
    if (result.prose.length > 0 || result.structured.length > 0) {
      annotatedFiles.push(name);
      continue;
    }
    const klass = classifyGateIdiom(text);
    if (klass === "pending") pendingFiles.push(name);
    else if (klass === "lane-blocked") laneBlockedFiles.push(name);
    else if (klass === "unreachable") unreachableFiles.push(name);
    else inertFiles.push(name);
  }
  return {
    dir,
    filesTotal: files.length,
    filesAnnotated: annotatedFiles.length,
    annotatedFiles,
    unreachableFiles,
    pendingFiles,
    inertFiles,
    laneBlockedFiles,
    results,
  };
}
