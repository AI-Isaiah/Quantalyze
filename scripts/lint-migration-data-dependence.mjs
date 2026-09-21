#!/usr/bin/env node
/**
 * Data-dependent migration refusal - Phase 164.9, [164.8-DATA-DEPENDENT-MIGRATION-ESCAPE].
 *
 * WHY THIS EXISTS, and it is a structural fault rather than a style preference.
 * The TEST restore is SCHEMA-ONLY (`supabase/schema/BASELINE.md`: 0 data
 * statements), so TEST mirrors production's CATALOGUE and never its DATA. A
 * migration written in this repository's house style - an anonymous block that
 * reads a populated table and RAISEs on an unexpected count - therefore applies
 * cleanly to production and REFUSES on TEST. And because a failed TEST apply
 * gates the production apply, that refusal WITHHOLDS A PRODUCTION DEPLOY.
 *
 * -- THE AUTHORING RULE, so a developer who hits this knows what to do --------
 * A migration's self-verification must be CATALOGUE-ONLY: read `pg_catalog` or
 * `information_schema` and assert about the SHAPE of the database. If the guard
 * genuinely has to read rows, make it TOLERANT OF AN EMPTY TABLE - warn, or
 * take the other branch - rather than raising. Both remedies are edits to the
 * migration. Neither is an edit to this linter.
 *
 * -- IT IS A MECHANISM, NOT A PRAGMA ----------------------------------------
 * There is NO opt-out marker of any kind here: no `TEST-NOT-APPLICABLE` header, no `skip-this-file` comment, no `lint-disable` directive.
 * That absence is a DECISION, not an omission. Phase 164.8 designed the escape
 * hatch, specified it with a three-arm proof, and deliberately did not build it
 * because it had zero consumers. An escape hatch is something a person must
 * remember to claim, under exactly the deploy pressure that makes people claim
 * things. A refusal that fires on the pull request cannot be forgotten and
 * cannot be claimed. Adding a marker here rebuilds the hatch this repository
 * already decided against.
 *
 * -- WHAT IS REFUSED, stated precisely --------------------------------------
 * Within a migration file, an ANONYMOUS BLOCK (`DO $tag$ ... $tag$` - the thing
 * that EXECUTES at apply time, as opposed to a `CREATE FUNCTION` body, which is
 * merely stored) whose body BOTH
 *   (a) reads from a relation in the APPLICATION schema - as opposed to a
 *       system catalogue or the information schema - AND
 *   (b) raises an exception under a condition derived from that read.
 * Either half alone is fine. It is the CONJUNCTION that makes the migration's
 * success depend on data TEST does not have. A block that reads rows to drive a
 * conditional WRITE is allowed; a block that raises on a CATALOGUE condition is
 * allowed; `RAISE NOTICE` is not an exception.
 *
 * -- THE REMEDY FOR SOMETHING ALREADY MERGED IS UNCHANGED -------------------
 * REVERT THE MERGE. Never an edit to `.github/workflows/supabase-migrate.yml`:
 * a failed TEST apply blocking the production apply is a LOCKED decision, and
 * editing the pipeline under deploy pressure to get a deploy out is precisely
 * the failure mode the backlog entry exists to prevent.
 *
 * -- HERMETIC --------------------------------------------------------------
 * Node builtins only. No database, no container, no secret, no network. That is
 * what earns it a place in `sql-gate-lint`, the job the `frontend` aggregator
 * gates with NO tolerance.
 *
 * THIS REPOSITORY IS PUBLIC and the Actions log is world-readable. Every
 * message printed here carries FILE NAMES, LINE NUMBERS, RELATION NAMES,
 * VARIABLE NAMES and COUNTS only - never statement text, never a value, never a
 * dollar-quote tag.
 *
 * -- LEXING: BORROWED, NOT RE-INVENTED --------------------------------------
 * `maskSql` (scripts/lint-sql-gates.mjs) is this repository's only
 * comment/string/dollar-quote-aware SQL lexer and blanks comments and string
 * LITERAL interiors while preserving offsets, so a sentence in a comment cannot
 * trip the refusal and a literal cannot hide one. It blanks dollar-quote
 * DELIMITERS and scans the interior as CODE, which is exactly what this gate
 * needs: the guard lives inside the body. `dollarBodyRanges`
 * (scripts/extract-reference-inserts.mjs) is the independent dollar-depth scan
 * of the ORIGINAL text that says where each body starts and ends. Writing a
 * third lexer here would be a second place the classification can drift, which
 * is the defect class the whole 164.x programme exists for (decision D-05).
 *
 * -- KNOWN LIMITATIONS, STATED RATHER THAN HIDDEN ---------------------------
 * 1. `EXECUTE <dynamic sql> INTO v` hides its relation inside a string literal,
 *    which the lexer blanks. Such a read does not taint `v`. A guard written
 *    that way evades this refusal. It is not a reason to stop masking literals
 *    - unmasking them would make a relation name inside a RAISE message trip
 *    the gate - and the same shape of gap is stated by the sibling linters.
 * 2. It says nothing about whether the rows exist on TEST right now. It says
 *    which migrations carry a guard whose answer depends on rows.
 * 3. A raise inside a `FOR ... LOOP` body with no enclosing conditional is NOT
 *    refused unless the condition mentions the loop variable. On an empty table
 *    the loop body never runs, so that shape cannot withhold an apply.
 *
 * The EXACT commands CI runs, and the exact commands a developer runs locally:
 *
 *     node scripts/lint-migration-data-dependence.mjs --self-test
 *     node scripts/lint-migration-data-dependence.mjs
 */
import { readFileSync, readdirSync, existsSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { basename, dirname, join, relative, resolve } from "node:path";
import { maskSql } from "./lint-sql-gates.mjs";
import { dollarBodyRanges } from "./extract-reference-inserts.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
export const DEFAULT_MIGRATIONS = join(REPO_ROOT, "supabase", "migrations");
export const DEFAULT_BASELINE = join(
  REPO_ROOT,
  "scripts",
  "lint-migration-data-dependence-baseline.txt",
);
export const FIXTURE_DIR = "scripts/lint-migration-data-dependence-fixtures";

const rel = (p) => {
  const r = relative(REPO_ROOT, p);
  return r.startsWith("..") ? p : r;
};

// ---------------------------------------------------------------------------
// The rule table. One entry per REFUSAL; each ships a red and a green fixture,
// and the self-test proves both directions before any corpus is scanned.
// ---------------------------------------------------------------------------

/** @type {Array<{id:string, title:string, why:string}>} */
export const REFUSALS = [
  {
    id: "R1-variable-conditioned-raise",
    title: "a raise conditioned on a variable read from an application relation",
    why:
      "the block reads rows into a variable and then raises on a condition that mentions it. On a data-empty TEST the variable takes a different value and the guard fires, refusing an apply that would succeed on production.",
  },
  {
    id: "R2-subquery-conditioned-raise",
    title: "a raise conditioned on an inline subquery over an application relation",
    why:
      "the read sits directly in the condition that controls the raise, with no variable in between. Same dependence on rows TEST does not have; a refusal that only saw the variable spelling would be routed around by this one.",
  },
];

/**
 * PINNED REFUSAL FLOOR.
 *
 * The runner gates on `REFUSALS.length < REFUSALS_FLOOR`, so a refusal deleted
 * to clear a red reddens CI with no vitest involved. By construction a floor
 * set BELOW the table is invisible to it - that stale-low direction is caught
 * one layer up by `src/__tests__/lint-migration-data-dependence.test.ts`, the
 * two-floors-two-layers shape CLAUDE.md records for the mutation runner.
 *
 * Raise it when the table grows durably. Never lower it to clear a red.
 */
export const REFUSALS_FLOOR = 2;

/**
 * The self-test corpus. A leg names a fixture basename and what it proves. Every
 * entry in REFUSALS must be carried by at least one red leg AND at least one
 * green leg - `selfTest` asserts that rather than trusting this table's shape.
 *
 * @type {Array<{fixture:string, colour:"red"|"green", rule:string|null, expect?:string, why:string}>}
 */
export const SELF_TEST_LEGS = [
  {
    fixture: "r1-variable-conditioned-raise.red.sql",
    colour: "red",
    rule: "R1-variable-conditioned-raise",
    expect: "public.fx_ledger",
    why: "the canonical shape: SELECT ... INTO a variable from an application relation, then RAISE on that variable. The refusal must NAME the file and the relation.",
  },
  {
    fixture: "r1-variable-conditioned-raise.green.sql",
    colour: "green",
    rule: "R1-variable-conditioned-raise",
    why: "the same shape reading the CATALOGUE. This is the prescribed self-verification shape and the refusal must not fight it.",
  },
  {
    fixture: "r2-subquery-conditioned-raise.red.sql",
    colour: "red",
    rule: "R2-subquery-conditioned-raise",
    expect: "public.fx_ledger",
    why: "no variable at all - the read is an inline subquery in the controlling condition.",
  },
  {
    fixture: "r2-subquery-conditioned-raise.green.sql",
    colour: "green",
    rule: "R2-subquery-conditioned-raise",
    why: "the same inline-subquery spelling over a catalogue relation.",
  },
  {
    fixture: "r1-nested-conditional.red.sql",
    colour: "red",
    rule: "R1-variable-conditioned-raise",
    expect: "public.fx_ledger",
    why: "the raise sits in a NESTED conditional under the data-derived one. A refusal that only sees the simplest spelling is one a future author routes around by accident.",
  },
  {
    fixture: "r1-nested-conditional.green.sql",
    colour: "green",
    rule: "R1-variable-conditioned-raise",
    why: "the same nesting with a catalogue-derived outer condition - nesting is not the refused property.",
  },
  {
    fixture: "r1-assignment-taint.red.sql",
    colour: "red",
    rule: "R1-variable-conditioned-raise",
    expect: "public.fx_ledger",
    why: "the count is COPIED into a second variable with `:=` before it is tested. No read appears on the right-hand side, so a detector that looked only there treated the copy as a clearing assignment and the guard walked through.",
  },
  {
    fixture: "r1-assignment-taint.green.sql",
    colour: "green",
    rule: "R1-variable-conditioned-raise",
    why: "the CLEARING direction: an overwrite with a literal, and a copy from a catalogue-derived variable. A taint that could never be cleared would condemn most of this corpus.",
  },
  {
    fixture: "r1-do-language-clause.red.sql",
    colour: "red",
    rule: "R1-variable-conditioned-raise",
    expect: "public.fx_ledger",
    why: "`DO LANGUAGE plpgsql $tag$` - the standard's other spelling, with the clause BEFORE the body. A detector reading only the word before the dollar-quote saw `plpgsql` and never scanned the block; an unscanned block is a refusal that cannot fire.",
  },
  {
    fixture: "r1-do-language-clause.green.sql",
    colour: "green",
    rule: "R1-variable-conditioned-raise",
    why: "the same leading-clause spelling over the catalogue - recognising the clause must make the block SCANNED, not refused.",
  },
  {
    fixture: "read-without-raise.green.sql",
    colour: "green",
    rule: null,
    why: "an application read whose result drives a conditional WRITE, beside a RAISE NOTICE. The refused property is a raise conditioned on data, not a data read.",
  },
  {
    fixture: "plain-dml-no-block.green.sql",
    colour: "green",
    rule: null,
    why: "a plain idempotent seed with no anonymous block at all.",
  },
  {
    fixture: "function-body-not-a-block.green.sql",
    colour: "green",
    rule: null,
    why: "a CREATE FUNCTION body that reads data and raises. It is TEXT at apply time, so it cannot refuse an apply; the scan must tell a stored body from an anonymous block.",
  },
];

// ---------------------------------------------------------------------------
// Relation classification.
// ---------------------------------------------------------------------------

export const CATALOGUE_SCHEMAS = new Set(["pg_catalog", "information_schema", "pg_toast"]);

/**
 * True when a relation reference names a system catalogue or the information
 * schema - the relations the TEST restore reproduces, so a guard reading one
 * answers the same way on TEST as on production.
 */
export function isCatalogueRelation(name) {
  const clean = String(name).replace(/"/g, "").trim().toLowerCase();
  const parts = clean.split(".").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return true;
  const relName = parts[parts.length - 1];
  const schema = parts.length > 1 ? parts[parts.length - 2] : null;
  if (schema !== null) return CATALOGUE_SCHEMAS.has(schema);
  return relName.startsWith("pg_");
}

/** Tokens that can follow FROM/JOIN and are never a relation name. */
const NON_RELATION_WORDS = new Set([
  "lateral",
  "only",
  "select",
  "values",
  "then",
  "else",
  "end",
  "where",
  "and",
  "or",
  "not",
  "null",
  "true",
  "false",
  "case",
  "when",
  "if",
  "loop",
  "exists",
  "array",
  "row",
  "unnest",
  "rows",
  "into",
  "distinct",
]);

const RELATION_RE =
  /\b(?:FROM|JOIN)\s+(?:LATERAL\s+|ONLY\s+)*((?:[A-Za-z_][A-Za-z0-9_$]*|"[^"\n]+")(?:\s*\.\s*(?:[A-Za-z_][A-Za-z0-9_$]*|"[^"\n]+"))?)\s*(\(?)/gi;

/**
 * Every APPLICATION relation read in `text`, in source order, excluding CTE
 * names, PL/pgSQL locals, function calls and the catalogue.
 *
 * @param {string} text masked SQL
 * @param {Set<string>} locals lower-cased names that are not relations here
 * @returns {string[]}
 */
export function appRelationsIn(text, locals) {
  const found = [];
  const re = new RegExp(RELATION_RE.source, "gi");
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[2] === "(") continue; // a function call, not a relation
    const raw = m[1].replace(/\s+/g, "");
    const lower = raw.replace(/"/g, "").toLowerCase();
    if (NON_RELATION_WORDS.has(lower)) continue;
    if (locals.has(lower)) continue;
    if (isCatalogueRelation(raw)) continue;
    if (!found.includes(lower)) found.push(lower);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Block extraction: the anonymous blocks, and only those.
// ---------------------------------------------------------------------------

function lineIndexer(src) {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") starts.push(i + 1);
  return (idx) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= idx) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

/**
 * The text that may legally stand between the start of a statement and the
 * opening dollar-quote of an ANONYMOUS BLOCK.
 *
 * `DO $tag$ ... $tag$` is the common spelling and `DO $tag$ ... $tag$ LANGUAGE
 * plpgsql` puts the clause AFTER the body, so both end on the word `DO`. The
 * standard also permits the clause FIRST - `DO LANGUAGE plpgsql $tag$ ... $tag$`
 * - and a detector that only looked at the last word saw `plpgsql` there and
 * never scanned the block at all. A block that is never scanned is a refusal
 * that cannot fire, which is the one failure mode this gate must not have.
 *
 * The language name may be an identifier, a quoted identifier, or a string
 * literal; `maskSql` blanks a literal's INTERIOR and keeps its quotes, so the
 * literal arm matches an emptied pair rather than the word.
 */
export const DO_INTRODUCER_RE =
  /(?:^|[^A-Za-z0-9_$])DO(?:\s+LANGUAGE\s+(?:[A-Za-z_][A-Za-z0-9_$]*|'[^'\n]*'|"[^"\n]*"))?\s*$/i;

/**
 * The OUTERMOST dollar-quoted bodies introduced by `DO` (with or without a
 * leading `LANGUAGE` clause).
 *
 * A `CREATE FUNCTION ... AS $$ ... $$` body is deliberately excluded: it is
 * stored, not executed, at apply time.
 *
 * @returns {{blocks: Array<{start:number,end:number,line:number,body:string}>, lineOf: Function} | {error:string, line:number}}
 */
export function anonymousBlocks(src) {
  const masked = maskSql(src);
  if (masked.error) return { error: masked.error, line: masked.line };
  const dq = dollarBodyRanges(src);
  if (dq.error) return { error: dq.error, line: dq.line };
  const lineOf = lineIndexer(src);
  const tops = [];
  let last = -1;
  for (const r of dq.ranges) {
    if (r[0] >= last) {
      tops.push(r);
      last = r[1];
    }
  }
  const blocks = [];
  for (const r of tops) {
    // The whole prefix, not a fixed window: a window can begin in the MIDDLE of
    // an identifier, and a `^DO` there is a boundary the source does not have.
    if (!DO_INTRODUCER_RE.test(masked.code.slice(0, r[0]))) continue;
    blocks.push({
      start: r[0],
      end: r[1],
      line: lineOf(r[0]),
      body: masked.code.slice(r[0], r[1]),
    });
  }
  return { blocks, lineOf };
}

// ---------------------------------------------------------------------------
// The refusal itself.
// ---------------------------------------------------------------------------

/**
 * Names that appear where a relation would but are not relations: PL/pgSQL
 * declared variables, CTE names and FOR-loop record variables.
 */
export function localNames(body) {
  const locals = new Set();
  const declare = /\bDECLARE\b([\s\S]*?)\bBEGIN\b/i.exec(body);
  if (declare) {
    for (const chunk of declare[1].split(";")) {
      const m = /^[\s]*([A-Za-z_][A-Za-z0-9_]*)\s+\S/.exec(chunk);
      if (m) locals.add(m[1].toLowerCase());
    }
  }
  for (const m of body.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s+AS\s*\(/gi)) {
    locals.add(m[1].toLowerCase());
  }
  for (const m of body.matchAll(/\bFOR\s+([A-Za-z_][A-Za-z0-9_]*)\s+IN\b/gi)) {
    locals.add(m[1].toLowerCase());
  }
  return locals;
}

/**
 * EVERY assignment to a PL/pgSQL variable in the block body, in source order,
 * each carrying the offset it happens at and the application relation it read
 * (or `null` when it read the catalogue, a literal, or a function call).
 *
 * ⛔ THE UNTAINTED ASSIGNMENTS ARE THE POINT, and recording only the tainted
 * ones is the bug this shape exists to avoid. A long block reuses a scratch
 * variable: `SELECT ... INTO v_n FROM pg_class` for a catalogue assertion,
 * then `SELECT ... INTO v_n FROM public.t` two statements later for a NOTICE.
 * A flow-INSENSITIVE taint map lets the later data read reach back and condemn
 * the earlier catalogue guard - the caller resolves each condition against the
 * LAST assignment BEFORE it instead, so an overwrite CLEARS a taint exactly as
 * it clears a value.
 *
 * ⚠️ STATED LIMITATION: this is position-ordered, not control-flow-ordered.
 * Inside a `LOOP`, an assignment textually AFTER a condition does reach it on
 * the next iteration, and that edge is not modelled. It biases toward allowing,
 * never toward refusing, which is the right direction for a gate whose false
 * positive would block a legitimate deploy.
 *
 * ⛔ TAINT TRAVELS THROUGH A PLAIN ASSIGNMENT, and it must. `v_total := v_n;`
 * reads no relation of its own, so a detector that only looked at the right-hand
 * side's `FROM` clause treated it as a CLEARING assignment - and a guard that
 * copied its count into a second variable before testing it walked straight
 * through the refusal. That is ordinary PL/pgSQL, not a contrived evasion. Each
 * assignment therefore records the DECLARED LOCALS its right-hand side mentions,
 * and a propagation pass in source order inherits the relation in force for the
 * first tainted one. An assignment that mentions no tainted local still CLEARS,
 * exactly as before.
 *
 * @returns {Array<{name:string, at:number, relation:string|null, refs:Set<string>}>} sorted by `at`
 */
export function variableAssignments(body, locals) {
  const out = [];

  /** The declared locals a right-hand side mentions, excluding its own targets. */
  const refsIn = (expr, exclude) => {
    const refs = new Set();
    for (const m of expr.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
      const w = m[0].toLowerCase();
      if (locals.has(w) && !exclude.has(w)) refs.add(w);
    }
    return refs;
  };

  // `SELECT ... INTO [STRICT] v[, v2] ... FROM rel`
  let offset = 0;
  for (const chunk of body.split(";")) {
    const base = offset;
    offset += chunk.length + 1;
    const sel = /\bSELECT\b/i.exec(chunk);
    if (!sel) continue;
    const after = chunk.slice(sel.index);
    const into = /\bINTO\b\s+(?:STRICT\s+)?([A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*)/i.exec(
      after,
    );
    if (!into) continue;
    const rels = appRelationsIn(after, locals);
    const at = base + sel.index + into.index + into[0].length;
    const targets = new Set(into[1].split(",").map((n) => n.trim().toLowerCase()).filter(Boolean));
    const refs = refsIn(after, targets);
    for (const name of targets) out.push({ name, at, relation: rels[0] ?? null, refs });
  }

  // `v := <expression>` - including the ones that read nothing, because those
  // are what clear a prior taint.
  for (const m of body.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*:=([^;]*)/g)) {
    const rels = /\bSELECT\b/i.test(m[2]) ? appRelationsIn(m[2], locals) : [];
    out.push({
      name: m[1].toLowerCase(),
      at: m.index + m[0].length,
      relation: rels[0] ?? null,
      refs: refsIn(m[2], new Set()),
    });
  }

  // `FOR rec IN SELECT ... FROM rel ... LOOP`
  for (const m of body.matchAll(/\bFOR\s+([A-Za-z_][A-Za-z0-9_]*)\s+IN\b([\s\S]*?)\bLOOP\b/gi)) {
    const rels = /\bSELECT\b/i.test(m[2]) ? appRelationsIn(m[2], locals) : [];
    out.push({
      name: m[1].toLowerCase(),
      at: m.index + m[0].length,
      relation: rels[0] ?? null,
      refs: refsIn(m[2], new Set([m[1].toLowerCase()])),
    });
  }

  out.sort((a, b) => a.at - b.at);

  // THE PROPAGATION PASS. Source order, one variable's taint at a time: an
  // assignment that read no relation of its own inherits the relation in force
  // for the first tainted local its right-hand side mentions. Mentioning none
  // still clears, so an overwrite with a literal or a catalogue read remains a
  // clearing assignment.
  const inForce = new Map();
  for (const a of out) {
    if (a.relation === null) {
      for (const r of a.refs) {
        const inherited = inForce.get(r);
        if (inherited) {
          a.relation = inherited;
          break;
        }
      }
    }
    inForce.set(a.name, a.relation);
  }
  return out;
}

const RAISE_LEVELS_THAT_ARE_NOT_EXCEPTIONS = new Set([
  "NOTICE",
  "WARNING",
  "LOG",
  "INFO",
  "DEBUG",
]);

function wordsOf(text) {
  const out = [];
  const re = /[A-Za-z_][A-Za-z0-9_]*/g;
  let m;
  while ((m = re.exec(text)) !== null) out.push({ u: m[0].toUpperCase(), i: m.index });
  return out;
}

/**
 * Every exception-raising site in a block body, each carrying the conditions
 * that ENCLOSE it, innermost last.
 *
 * Only `IF`/`ELSIF`/`END IF` move the stack. `END LOOP`, `END CASE` and a bare
 * block `END` are ignored by construction, which keeps the pairing correct
 * without parsing the rest of PL/pgSQL.
 *
 * Each condition carries the offset it STARTS at, so the caller can resolve a
 * variable it mentions against the assignment in force at that point rather
 * than against every assignment anywhere in the block.
 *
 * @returns {Array<{off:number, conditions:Array<{text:string, at:number}>}>}
 */
export function raiseSites(body) {
  const ws = wordsOf(body);
  const stack = [];
  const sites = [];

  const condition = (from) => {
    if (from >= ws.length) return { text: "", at: body.length, next: ws.length - 1 };
    let caseDepth = 0;
    for (let k = from; k < ws.length; k++) {
      if (ws[k].u === "CASE") {
        caseDepth++;
        continue;
      }
      if (ws[k].u === "END" && caseDepth > 0) {
        caseDepth--;
        continue;
      }
      if (ws[k].u === "THEN" && caseDepth === 0) {
        return { text: body.slice(ws[from].i, ws[k].i), at: ws[from].i, next: k };
      }
    }
    return { text: body.slice(ws[from].i), at: ws[from].i, next: ws.length - 1 };
  };

  for (let k = 0; k < ws.length; k++) {
    const u = ws[k].u;
    if (u === "IF" && (k === 0 || ws[k - 1].u !== "END")) {
      const c = condition(k + 1);
      stack.push({ text: c.text, at: c.at });
      k = c.next;
      continue;
    }
    if (u === "ELSIF" || u === "ELSEIF") {
      if (stack.length > 0) stack.pop();
      const c = condition(k + 1);
      stack.push({ text: c.text, at: c.at });
      k = c.next;
      continue;
    }
    if (u === "END" && k + 1 < ws.length && ws[k + 1].u === "IF") {
      if (stack.length > 0) stack.pop();
      k += 1;
      continue;
    }
    if (u === "RAISE") {
      const next = k + 1 < ws.length ? ws[k + 1].u : "";
      if (RAISE_LEVELS_THAT_ARE_NOT_EXCEPTIONS.has(next)) continue;
      sites.push({ off: ws[k].i, conditions: stack.slice() });
    }
  }
  return sites;
}

/**
 * Classify one migration's source.
 *
 * @returns {{blocks:number, refusals:Array<{rule:string,line:number,relation:string,via:string,reason:string}>} | {error:string, line:number}}
 */
export function classifySource(src) {
  const scanned = anonymousBlocks(src);
  if (scanned.error) return { error: scanned.error, line: scanned.line };
  const refusals = [];
  const seen = new Set();

  for (const block of scanned.blocks) {
    const locals = localNames(block.body);
    const assigns = variableAssignments(block.body, locals);
    const names = [...new Set(assigns.map((a) => a.name))];

    for (const site of raiseSites(block.body)) {
      // Innermost condition first: the nearest data-derived condition is the
      // most informative one to report.
      for (let i = site.conditions.length - 1; i >= 0; i--) {
        const cond = site.conditions[i];
        let rule = null;
        let relation = null;
        let via = null;

        for (const name of names) {
          if (!new RegExp(`\\b${name}\\b`, "i").test(cond.text)) continue;
          // The assignment IN FORCE where the condition is evaluated - an
          // overwrite clears a taint exactly as it clears a value.
          const inForce = assigns.filter((a) => a.name === name && a.at < cond.at).pop();
          if (!inForce || !inForce.relation) continue;
          rule = "R1-variable-conditioned-raise";
          relation = inForce.relation;
          via = `variable \`${name}\``;
          break;
        }
        if (rule === null && /\bSELECT\b/i.test(cond.text)) {
          const rels = appRelationsIn(cond.text, locals);
          if (rels.length > 0) {
            rule = "R2-subquery-conditioned-raise";
            relation = rels[0];
            via = "an inline subquery in the condition";
          }
        }
        if (rule === null) continue;

        const key = `${rule}|${relation}`;
        if (seen.has(key)) break;
        seen.add(key);
        refusals.push({
          rule,
          line: scanned.lineOf(block.start + site.off),
          relation,
          via,
          reason:
            `the anonymous block opened at line ${block.line} raises an exception on a condition derived from a read of the APPLICATION relation \`${relation}\` (via ${via}). ` +
            "TEST carries production's CATALOGUE and none of its ROWS, so this guard can refuse on TEST while applying cleanly on production - and a refused TEST apply WITHHOLDS the production apply. " +
            "Make the self-verification CATALOGUE-ONLY, or make the read tolerant of an empty table. Do not relax this linter and do not widen its ledger",
        });
        break;
      }
    }
  }
  return { blocks: scanned.blocks.length, refusals };
}

// ---------------------------------------------------------------------------
// The ledger: dated, shrink-only, count-verified.
// ---------------------------------------------------------------------------

/**
 * Entries are TAB-separated: `<basename>.sql  <rule-id>  <relation>  # <destination>`.
 * Comment lines carry the lineage and the single recorded `ENTRY_COUNT`.
 *
 * @returns {{entries:Array<object>, malformed:Array<object>, recorded:number|null}}
 */
export function parseBaseline(text) {
  const entries = [];
  const malformed = [];
  let recorded = null;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const lineNo = i + 1;
    const pinned = /ENTRY_COUNT[ =:]+([0-9]+)/.exec(raw);
    if (pinned) recorded = recorded === null ? Number(pinned[1]) : recorded;
    if (/^[\t ]*(#|$)/.test(raw)) continue;
    const f = raw.split("\t");
    if (f.length !== 4) {
      malformed.push({
        lineNo,
        reason: `expected exactly 4 TAB-separated fields (<basename>.sql, <rule-id>, <relation>, "# <destination phase>"), found ${f.length}`,
      });
      continue;
    }
    const [file, rule, relation] = f;
    const destination = f[3].trim();
    if (!/^[A-Za-z0-9_.-]+\.sql$/.test(file)) {
      malformed.push({ lineNo, reason: `field 1 "${file.slice(0, 60)}" is not a <basename>.sql` });
      continue;
    }
    if (!REFUSALS.some((r) => r.id === rule)) {
      malformed.push({ lineNo, reason: `field 2 "${rule.slice(0, 60)}" is not a declared refusal id` });
      continue;
    }
    if (!/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/.test(relation)) {
      malformed.push({
        lineNo,
        reason: `field 3 "${relation.slice(0, 60)}" is not a lower-case relation name`,
      });
      continue;
    }
    if (!destination.startsWith("#") || destination.replace(/^#+/, "").trim().length === 0) {
      malformed.push({
        lineNo,
        reason:
          "field 4 carries no `# <destination phase>` - repairing an applied migration is a separate act with its own review, so every entry names where that happens",
      });
      continue;
    }
    entries.push({ lineNo, file, rule, relation, destination });
  }
  return { entries, malformed, recorded };
}

// ---------------------------------------------------------------------------
// Output. One refusal path, and a census line on every successful run.
// ---------------------------------------------------------------------------

function makeIo() {
  return { out: [], err: [] };
}

function refuse(io, { file, line, rule, reason }) {
  const where = [file, line != null ? String(line) : null].filter(Boolean).join(":");
  const what = rule ? ` [${rule}]` : "";
  io.err.push(`lint-migration-data-dependence: REFUSED ${where}${what}: ${reason}`);
}

export const CENSUS_RE =
  /^lint-migration-data-dependence: corpus [0-9]+ migration\(s\), [0-9]+ anonymous block\(s\); [0-9]+ refusal\(s\), [0-9]+ allowlisted, [0-9]+ NEW\.$/;

export const SELF_TEST_OK_RE =
  /^lint-migration-data-dependence self-test OK \([0-9]+ refusals?, red\+green each\.\)$/;

// ---------------------------------------------------------------------------
// Mode: corpus scan (default).
// ---------------------------------------------------------------------------

export function scanCorpus(io, migrationsDir, baselinePath) {
  if (!existsSync(migrationsDir)) {
    refuse(io, { file: rel(migrationsDir), reason: "migrations directory not found" });
    return 1;
  }
  const corpus = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  if (corpus.length === 0) {
    refuse(io, {
      file: rel(migrationsDir),
      reason:
        "the corpus is EMPTY. An empty corpus refuses nothing BY CONSTRUCTION, so a wrong --migrations path reads exactly like a repository with no data-dependent migration. That is the defect this gate exists to name, not a clean run",
    });
    return 1;
  }

  let baseline = { entries: [], malformed: [], recorded: null };
  if (existsSync(baselinePath)) {
    baseline = parseBaseline(readFileSync(baselinePath, "utf8"));
  } else {
    refuse(io, { file: rel(baselinePath), reason: "ledger not found" });
    return 1;
  }
  let bad = 0;
  for (const m of baseline.malformed) {
    refuse(io, { file: rel(baselinePath), line: m.lineNo, reason: m.reason });
    bad = 1;
  }
  if (baseline.recorded === null) {
    refuse(io, {
      file: rel(baselinePath),
      reason:
        "the ledger records no `ENTRY_COUNT`. A list with no recorded cardinality can be emptied without a single red, which is a control that has quietly stopped controlling",
    });
    bad = 1;
  } else if (baseline.recorded !== baseline.entries.length) {
    refuse(io, {
      file: rel(baselinePath),
      reason: `the ledger records ENTRY_COUNT = ${baseline.recorded} but carries ${baseline.entries.length} entr(ies). Move the count in the same commit as the line`,
    });
    bad = 1;
  }
  if (bad) return 1;

  const allowed = new Map();
  for (const e of baseline.entries) allowed.set(`${e.file}|${e.rule}|${e.relation}`, e);
  const hit = new Set();

  let blocks = 0;
  let refusals = 0;
  let novel = 0;
  for (const file of corpus) {
    const result = classifySource(readFileSync(join(migrationsDir, file), "utf8"));
    if (result.error) {
      refuse(io, {
        file,
        line: result.line,
        reason: `the file could not be lexed (${result.error}) - an unlexable migration is an unscanned migration, and "could not measure" is never a pass`,
      });
      bad = 1;
      continue;
    }
    blocks += result.blocks;
    for (const r of result.refusals) {
      refusals++;
      const key = `${file}|${r.rule}|${r.relation}`;
      if (allowed.has(key)) {
        hit.add(key);
        continue;
      }
      novel++;
      refuse(io, { file, line: r.line, rule: r.rule, reason: r.reason });
      bad = 1;
    }
  }

  for (const [key, e] of allowed) {
    if (hit.has(key)) continue;
    refuse(io, {
      file: rel(baselinePath),
      line: e.lineNo,
      rule: e.rule,
      reason: `this ledger entry names \`${e.relation}\` in ${e.file}, which the scan no longer refuses. THE LEDGER ONLY SHRINKS: delete the line. A ledger allowed to hold stale entries is a control that quietly stops controlling`,
    });
    bad = 1;
  }

  io.out.push(
    `lint-migration-data-dependence: corpus ${corpus.length} migration(s), ${blocks} anonymous block(s); ${refusals} refusal(s), ${baseline.entries.length} allowlisted, ${novel} NEW.`,
  );
  return bad;
}

// ---------------------------------------------------------------------------
// Mode: --self-test. Every refusal fires on its red fixture and stays silent on
// its green twin, and the empty-corpus refusal is exercised on a real scan.
// ---------------------------------------------------------------------------

function selfTest(io) {
  let bad = 0;
  const fail = (msg) => {
    io.err.push(`SELF-TEST FAIL: ${msg}`);
    bad = 1;
  };

  if (REFUSALS.length < REFUSALS_FLOOR) {
    fail(
      `REFUSALS_FLOOR regression: the table declares ${REFUSALS.length} refusal(s), below the pinned floor of ${REFUSALS_FLOOR}. A refusal was deleted - restore it. Lowering the floor retires the control the deletion just removed.`,
    );
  }

  const redRules = new Set();
  const greenRules = new Set();
  for (const leg of SELF_TEST_LEGS) {
    const path = join(REPO_ROOT, FIXTURE_DIR, leg.fixture);
    if (!existsSync(path)) {
      fail(`${leg.fixture} is missing - a leg whose fixture is absent proves nothing.`);
      continue;
    }
    const result = classifySource(readFileSync(path, "utf8"));
    if (result.error) {
      fail(`${leg.fixture} could not be lexed (${result.error}).`);
      continue;
    }
    if (leg.colour === "red") {
      redRules.add(leg.rule);
      const matching = result.refusals.filter((r) => r.rule === leg.rule);
      if (matching.length === 0) {
        fail(
          `${leg.fixture} was NOT refused under ${leg.rule} - the refusal did not fire. Refusals seen: ${
            result.refusals.map((r) => r.rule).join(", ") || "none"
          }`,
        );
        continue;
      }
      if (leg.expect && !matching.some((r) => r.relation === leg.expect)) {
        fail(
          `${leg.fixture} was refused under ${leg.rule} but names ${matching
            .map((r) => r.relation)
            .join(", ")} rather than "${leg.expect}" - a leg that fires for the WRONG reason is not evidence.`,
        );
      }
    } else {
      if (leg.rule) greenRules.add(leg.rule);
      if (result.refusals.length > 0) {
        fail(
          `${leg.fixture} was REFUSED (${result.refusals
            .map((r) => `${r.rule} on ${r.relation}`)
            .join(", ")}) - the refusal fires on a shape it must accept.`,
        );
      }
    }
  }

  for (const r of REFUSALS) {
    if (!redRules.has(r.id)) fail(`${r.id} has no red fixture - it is not proven able to fire.`);
    if (!greenRules.has(r.id))
      fail(`${r.id} has no green fixture - it is not proven to discriminate.`);
  }

  // The empty-corpus refusal, exercised rather than asserted. A scan that
  // reports "0 refusals" over a directory it never read is the failure mode
  // this leg exists to make impossible.
  const emptyIo = makeIo();
  const emptyDir = join(REPO_ROOT, FIXTURE_DIR, "no-such-corpus");
  if (scanCorpus(emptyIo, emptyDir, DEFAULT_BASELINE) === 0) {
    fail("a scan over a non-existent corpus exited 0 - an unreadable corpus is not a clean one.");
  }

  if (bad === 0) {
    io.out.push(
      `lint-migration-data-dependence self-test OK (${REFUSALS.length} refusals, red+green each.)`,
      `  legs: ${SELF_TEST_LEGS.filter((l) => l.colour === "red").length} red, ${
        SELF_TEST_LEGS.filter((l) => l.colour === "green").length
      } green; floor ${REFUSALS_FLOOR}.`,
    );
  }
  return bad;
}

// ---------------------------------------------------------------------------
// CLI.
// ---------------------------------------------------------------------------

export function runCli(argv) {
  const io = makeIo();
  let migrations = DEFAULT_MIGRATIONS;
  let baseline = DEFAULT_BASELINE;
  let self = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--migrations") migrations = argv[++i] ?? "";
    else if (a === "--baseline") baseline = argv[++i] ?? "";
    else if (a === "--self-test") self = true;
    else {
      io.err.push(
        `lint-migration-data-dependence: unknown argument "${a}". See the header for usage.`,
      );
      return { code: 1, io };
    }
  }
  if (self) return { code: selfTest(io), io };
  if (!migrations || !baseline) {
    io.err.push("lint-migration-data-dependence: --migrations and --baseline each need a value.");
    return { code: 1, io };
  }
  return { code: scanCorpus(io, migrations, baseline), io };
}

function main(argv) {
  const { code, io } = runCli(argv);
  if (io.out.length) process.stdout.write(`${io.out.join("\n")}\n`);
  if (io.err.length) process.stderr.write(`${io.err.join("\n")}\n`);
  return code;
}

// The three-way entry decision, and the reason it is three-way rather than two,
// is the one the sibling extractor's tail records from a MEASURED incident: a
// module invoked as a program that cannot recognise itself falls off the end and
// exits 0 having emitted NOTHING, and a step asserting only an exit code is
// satisfied by that. `realpathSync` on both sides closes the macOS
// /var -> /private/var spelling; exit 2 - distinct from the refusal's exit 1 -
// keeps a harness fault from ever reading as a clean corpus.
const samePath = (a, b) => {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
};
const ENTRY = process.argv[1];
if (ENTRY !== undefined) {
  const selfPath = fileURLToPath(import.meta.url);
  if (resolve(ENTRY) === resolve(selfPath) || samePath(ENTRY, selfPath)) {
    process.exitCode = main(process.argv.slice(2));
  } else if (basename(resolve(ENTRY)) === basename(selfPath)) {
    process.stderr.write(
      [
        "lint-migration-data-dependence: REFUSING TO EXIT SILENTLY. This module was invoked as a program " +
          `("${basename(selfPath)}" is the entry point's own basename) but the entry point does not resolve to this file, ` +
          "so the CLI never ran and NOTHING was scanned.",
        `  entry (process.argv[1]): ${ENTRY}`,
        `  this module:             ${selfPath}`,
        "  Exit 0 here would be a gate reporting a clean corpus it never opened.",
      ].join("\n") + "\n",
    );
    process.exit(2);
  }
}
