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

function refuseSelfSatisfying(at, field, injected) {
  if (typeof injected !== "string") return;
  if (!INJECTS_FIRST_FAILURE_LITERAL.test(injected)) return;
  throw (
    `${at}: "${field}" injects a "TEST FAILED (" literal. A mutation that WRITES the string ` +
    `the first-failure identity check looks for satisfies the DETECTOR instead of the arm — it ` +
    `would report RED (identity ok) and count as a biting arm without the arm's own logic ever ` +
    `running. Mutate the code under test, not the failure message.`
  );
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
    // the same output stream firstFailureArm() reads.
    refuseSelfSatisfying(at, "stmt", step.stmt);
    return { kind: "sql", stmt: step.stmt };
  }

  if (!isRepoRelativePath(step.file)) {
    throw `${at}: "file" must be a repo-relative path (no leading "/" and no ".." segment)`;
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
 * MEASURED 2026-08-29: no file in `supabase/tests/` is structured-only, so
 * `filesAnnotated` is unchanged at 1 of 71 and the FILES_FLOOR does not move.
 */
export function scanCorpus(dir) {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const annotatedFiles = [];
  const results = [];
  for (const name of files) {
    const result = parseAnnotations(readFileSync(join(dir, name), "utf8"), {
      file: join(dir, name),
    });
    results.push({ name, result });
    if (result.prose.length > 0 || result.structured.length > 0) annotatedFiles.push(name);
  }
  return {
    dir,
    filesTotal: files.length,
    filesAnnotated: annotatedFiles.length,
    annotatedFiles,
    results,
  };
}
