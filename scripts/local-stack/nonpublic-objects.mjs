#!/usr/bin/env node
/**
 * LOCAL-STACK NON-PUBLIC OBJECTS — the PROD objects that live OUTSIDE `public`, which
 * a schema-only dump of `public` cannot carry, EXTRACTED from supabase/migrations and
 * then PROVEN present on the lane. (Phase 164.4.2 DECISION G, plan 11.)
 *
 * ⚠️ WHY THIS EXISTS. Plan 08's checkpoint fixed the lane's ACLs and then ran the whole
 * SQL corpus on it: 8 of 76 files still failed. The files are correct and the lane was
 * incomplete. `supabase/schema/baseline.sql` is a dump of `public`, so it carries
 * neither the trigger on `auth.users` that creates a profile for every new user (3
 * files failed on its absence) nor a single `cron.job` row (5 files failed on theirs).
 * Plan 04's capability probe had measured that the lane HOSTS pg_cron and the auth
 * functions; nothing had measured whether it carries the OBJECTS PROD registers there.
 * Shared TEST never showed the gap, because its restore rebuilds only `public` and
 * leaves `auth` and `cron` standing.
 *
 * ⛔ DECISION G (founder, 2026-09-23) chose to REPLAY these objects from the migrations
 * that declare them. Two alternatives were rejected and are recorded so nobody reopens
 * them without new evidence: (1) WIDENING THE DUMP to carry `auth` triggers and
 * `cron.job` rows, which is another manual PROD dump per change, and `cron.job` is data,
 * not schema; (2) MOVING `sql-tests` BACK TO SHARED TEST, which reintroduces the
 * contention this phase exists to remove.
 *
 * WHAT IS FOLDED. ONLY the migrations in the currency gate's carried set (the
 * `CARRIED_SET_FILE` scripts/local-stack/run.sh hands over), in filename order. A
 * migration the D-F replay applies registers its own objects natively, exactly once,
 * when the replay runs it — so it is never folded here as well.
 *   - The auth.users trigger class: every CREATE [OR REPLACE] TRIGGER / DROP TRIGGER
 *     on `auth.users`, found in CODE positions (`maskSql` + `statements` from
 *     scripts/lint-sql-gates.mjs) and excluded from dollar-quoted bodies
 *     (`dollarBodyRanges` / `insideBody` from scripts/extract-reference-inserts.mjs).
 *   - The pg_cron class: every `cron.schedule` / `cron.unschedule` call site, found in
 *     code positions (dollar bodies ARE code to `maskSql`, so every call inside a `DO`
 *     block is found), its arguments parsed LOCALLY from the call's own `(` in the
 *     original text. A later schedule of a name supersedes the earlier one (pg_cron
 *     upserts by name); an unschedule removes it; an unschedule of a name not folded
 *     at that point is a no-op, and a name NO carried call ever schedules is named.
 *
 * ⛔ IT REFUSES BY DEFAULT. A shape this module cannot prove safe is MEASURE_FAIL (exit
 * 2), never skipped: a trigger carrying a WHEN clause, `UPDATE OF`, REFERENCING or
 * CONSTRAINT; ENABLE/DISABLE TRIGGER on an auth table; a trigger on any auth table
 * other than `users`; auth trigger DDL inside a dollar body; a cron argument that is
 * not a `'…'` or `$tag$…$tag$` literal (an identifier, `||`, a cast, `format(`, a
 * variable), an unclosed argument list, the wrong arity, a `cron.alter_job` or
 * `cron.schedule_in_database` call site, a cron call inside another call's arguments;
 * trigger DDL or a cron call visible only inside a string literal an EXECUTE could run
 * (two independent lexers — `maskSql`'s code positions and `scanSql`'s comment-
 * stripped text — disagree on the per-file count); a carried basename with no file, or
 * a malformed carried line; a cron call inside a dollar body that is not a DO block
 * (a function or procedure body is defined by its migration, never run by it).
 *
 * ⚠️ KNOWN LIMIT, stated rather than implied: a cron call in a DO block is folded
 * whether or not the branch it sits in RAN on PROD (an `IF … THEN` guard is not
 * evaluated here). Every carried call site sits in a DO block today (measured
 * 2026-09-24: 61 of 61), guarded by pg_cron's presence, which PROD has; a branch
 * PROD did not take would surface as an EXTRA job only against PROD, never here.
 *
 * USAGE
 *   node scripts/local-stack/nonpublic-objects.mjs --emit  --migrations <dir> --carried <file> --out-dir <dir>
 *   node scripts/local-stack/nonpublic-objects.mjs --check --migrations <dir> --carried <file> --catalogue <rows> --cron-owner <role>
 *   (<rows> is `psql -X -q -At -F '|' -f scripts/local-stack/nonpublic-catalogue.sql`, read
 *    through the stack SUPERUSER DSN; <role> is the loading role the jobs must belong to)
 *
 * --emit writes <out-dir>/nonpublic-auth-triggers.sql (`SET search_path TO public;` then
 * each surviving statement's ORIGINAL bytes, sliced by offset) and
 * <out-dir>/nonpublic-cron.sql (one `SELECT cron.schedule(<name>, <schedule>, <command>);`
 * per surviving job, from the literals' ORIGINAL bytes, ordered by each job's last
 * declaring call). Nothing is re-rendered. It prints one census line starting
 * `nonpublic-extract:` (counts and names, never a command).
 *
 * --check RE-DERIVES the declared set from the migrations. ⛔ It never reads the SQL
 * `--emit` wrote, so a partly applied or altered emit file cannot vouch for itself. Cron
 * jobs are compared BYTE-EXACT on name, schedule and command (sha256 prefixes printed,
 * never the text), plus `active`, `username = --cron-owner` and `database`. It prints one
 * MISSING / EXTRA / DIFFERS / DUPLICATE line per finding, then
 *   nonpublic-fidelity: auth-users-triggers=<lane>/<declared> cron-jobs=<lane>/<declared> drift=<n> verdict OK|DRIFT|MEASURE_FAIL
 * EXIT 0 = OK, 1 = DRIFT, 2 = MEASURE_FAIL (also: an empty catalogue, a missing meta
 * row, a meta row saying the reader is not a superuser — pg_cron's row-level security
 * shows a non-superuser only its own jobs — or declared jobs on a lane without pg_cron).
 *
 * ⛔ THE REPO IS PUBLIC and CI logs are world-readable. Output carries file names,
 * statement indexes, trigger names, counts and sha256 prefixes only — never statement
 * text, a DSN or a password.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { maskSql, statements } from "../lint-sql-gates.mjs";
import { dollarBodyRanges, insideBody } from "../extract-reference-inserts.mjs";
import { scanSql } from "../sql-body-normalize.mjs";

/** The SAME strict basename `replay_migrations` in run.sh requires of a carried line. */
const BASENAME_RE = /^[0-9]+_[a-z0-9_]+\.sql$/;

class MeasureFail extends Error {}
const measureFail = (msg) => {
  throw new MeasureFail(msg);
};

function arg(name) {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1] || process.argv[i + 1].startsWith("--")) measureFail(`missing ${name} <value>`);
  return process.argv[i + 1];
}

// ── the carried set ─────────────────────────────────────────────────────────
/** @returns {Array<{base: string, src: string}>} the carried migrations, in filename order. */
function readCarried(migrationsDir, carriedFile) {
  let text;
  try {
    text = readFileSync(carriedFile, "utf8");
  } catch (e) {
    measureFail(`could not read the carried set: ${e.code ?? e.message}`);
  }
  const bases = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l === "" && i === lines.length - 1) continue; // the trailing newline
    if (!BASENAME_RE.test(l)) measureFail(`carried set line ${i + 1} is not a strict migration basename`);
    bases.push(l);
  }
  if (new Set(bases).size !== bases.length) measureFail("the carried set names a migration twice");
  bases.sort();
  return bases.map((base) => {
    const p = join(migrationsDir, base);
    if (!existsSync(p)) measureFail(`carried migration ${base} has no file in the migrations directory`);
    return { base, src: readFileSync(p, "utf8") };
  });
}

// ── lexing, one pass per file ───────────────────────────────────────────────
function lex(base, src) {
  const masked = maskSql(src);
  if (masked.error) measureFail(`${base}: the SQL lexer refused the file (${masked.error}, line ${masked.line})`);
  const dq = dollarBodyRanges(src);
  if (dq.error) measureFail(`${base}: the dollar-body scan refused the file (${dq.error}, line ${dq.line})`);
  const spans = statements(masked.code);
  /** 1-based index of the statement span containing `off`. */
  const stmtIndex = (off) => {
    for (let k = 0; k < spans.length; k++) if (off >= spans[k].start && off <= spans[k].end) return k + 1;
    return 0;
  };
  return { code: masked.code, ranges: dq.ranges, spans, stmtIndex, stripped: scanSql(src).stripped };
}

const count = (text, re) => (text.match(re) ?? []).length;

// ── the auth.users trigger class ────────────────────────────────────────────
const TRIGGER_HEAD = /\b(CREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER|DROP\s+TRIGGER|ALTER\s+TABLE)\b/gi;
// Trigger DDL that names an auth table. Counted in BOTH lexers' output: `maskSql`
// blanks string literals, `scanSql`'s `stripped` keeps them, so a disagreement means
// trigger DDL sits inside a string an EXECUTE could run.
const AUTH_TRIGGER_DDL =
  /\b(?:CREATE\s+(?:OR\s+REPLACE\s+)?(?:CONSTRAINT\s+)?TRIGGER|DROP\s+TRIGGER)\b[^;]*?\bON\s+(?:ONLY\s+)?"?auth"?\s*\.|\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?"?auth"?\s*\.[^;]*?\bTRIGGER\b/gi;
const IDENT = String.raw`(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_]*)`;
const EVENT = String.raw`(?:INSERT|DELETE|UPDATE|TRUNCATE)`;
// The ONE accepted CREATE shape. ⛔ No WHEN, no `UPDATE OF`, no REFERENCING, no
// CONSTRAINT: anything the regex does not describe is MEASURE_FAIL, never folded.
const CREATE_SHAPE = new RegExp(
  String.raw`^CREATE\s+(OR\s+REPLACE\s+)?TRIGGER\s+(${IDENT})\s+(BEFORE|AFTER)\s+(${EVENT}(?:\s+OR\s+${EVENT})*)\s+ON\s+(?:"auth"|auth)\s*\.\s*(?:"users"|users)\s+FOR\s+EACH\s+(ROW|STATEMENT)\s+EXECUTE\s+(?:FUNCTION|PROCEDURE)\s+(${IDENT}(?:\s*\.\s*${IDENT})?)\s*\(\s*\)\s*$`,
  "i",
);
const DROP_SHAPE = new RegExp(
  String.raw`^DROP\s+TRIGGER\s+(IF\s+EXISTS\s+)?(${IDENT})\s+ON\s+(?:"auth"|auth)\s*\.\s*(?:"users"|users)(?:\s+(?:CASCADE|RESTRICT))?\s*$`,
  "i",
);
const AUTH_TABLE_OF = /\bON\s+(?:ONLY\s+)?"?auth"?\s*\.\s*"?([A-Za-z_][A-Za-z0-9_]*)"?/i;
const ALTER_AUTH_TABLE = /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?"?auth"?\s*\.\s*"?([A-Za-z_][A-Za-z0-9_]*)"?/i;

/** An identifier as the catalogue spells it: a quoted one verbatim, an unquoted one folded. */
const ident = (s) => (s.startsWith('"') ? s.slice(1, -1) : s.toLowerCase());

/** tgtype bits, decoded completely: ROW 1, BEFORE 2, INSERT 4, DELETE 8, UPDATE 16, TRUNCATE 32, INSTEAD 64. */
const TG = { ROW: 1, BEFORE: 2, INSERT: 4, DELETE: 8, UPDATE: 16, TRUNCATE: 32, INSTEAD: 64 };
function tgtypeOf(timing, events, level) {
  let t = 0;
  if (level === "ROW") t |= TG.ROW;
  if (timing === "BEFORE") t |= TG.BEFORE;
  for (const e of events) t |= TG[e];
  return t;
}

/**
 * Fold every auth.users trigger over the carried files.
 * @returns {Map<string, {name, tgtype, fn, base, sql}>}
 */
function foldAuthTriggers(files, lexed) {
  const fold = new Map();
  for (const { base, src } of files) {
    const L = lexed.get(base);
    const inCode = count(L.code, AUTH_TRIGGER_DDL);
    const inText = count(L.stripped, AUTH_TRIGGER_DDL);
    if (inCode !== inText) {
      measureFail(
        `${base}: auth trigger DDL counts disagree between the two lexers (code positions ${inCode}, comment-stripped text ${inText}) — a trigger statement sits inside a string literal an EXECUTE could run`,
      );
    }
    TRIGGER_HEAD.lastIndex = 0;
    let m;
    while ((m = TRIGGER_HEAD.exec(L.code)) !== null) {
      let end = L.code.indexOf(";", m.index);
      if (end < 0) end = L.code.length;
      const stmt = L.code.slice(m.index, end).replace(/\s+/g, " ").trim();
      const at = `${base} statement ${L.stmtIndex(m.index)}`;
      const isAlter = /^ALTER/i.test(m[1]);
      const table = isAlter ? ALTER_AUTH_TABLE.exec(stmt)?.[1] : AUTH_TABLE_OF.exec(stmt)?.[1];
      if (!table) continue; // not an auth table
      if (isAlter) {
        if (/\b(ENABLE|DISABLE)\b[^;]*\bTRIGGER\b/i.test(stmt)) measureFail(`${at}: ENABLE/DISABLE TRIGGER on an auth table is not modelled`);
        continue; // ALTER TABLE auth.* without trigger DDL is not this class
      }
      if (insideBody(L.ranges, m.index)) measureFail(`${at}: auth trigger DDL inside a dollar-quoted body is not modelled`);
      const head = L.code.slice(L.spans[L.stmtIndex(m.index) - 1]?.start ?? m.index, m.index);
      if (head.trim() !== "") measureFail(`${at}: auth trigger DDL that does not open its statement is not modelled`);
      if (table.toLowerCase() !== "users") measureFail(`${at}: a trigger on an auth table other than users is not modelled`);
      if (/^DROP/i.test(m[1])) {
        const d = DROP_SHAPE.exec(stmt);
        if (!d) measureFail(`${at}: a DROP TRIGGER shape this module does not parse`);
        const name = ident(d[2]);
        if (fold.has(name)) fold.delete(name);
        else if (!d[1]) measureFail(`${at}: DROP TRIGGER ${name} of a trigger no earlier carried migration created`);
        continue;
      }
      const c = CREATE_SHAPE.exec(stmt);
      if (!c) measureFail(`${at}: a CREATE TRIGGER shape this module does not parse (WHEN, UPDATE OF, REFERENCING and CONSTRAINT are refused)`);
      const name = ident(c[2]);
      if (fold.has(name) && !c[1]) measureFail(`${at}: CREATE TRIGGER ${name} of a name an earlier carried migration already created`);
      const events = c[4].toUpperCase().split(/\s+OR\s+/);
      const fnParts = c[6].split(/\s*\.\s*/).map(ident);
      fold.set(name, {
        name,
        tgtype: tgtypeOf(c[3].toUpperCase(), events, c[5].toUpperCase()),
        fn: `${fnParts.length === 2 ? fnParts.join(".") : `public.${fnParts[0]}`}()`,
        base,
        sql: src.slice(m.index, end),
      });
    }
  }
  return fold;
}

// ── the pg_cron class ────────────────────────────────────────────────────────
// Call sites are found in CODE positions. `maskSql` scans dollar bodies as code, which
// is why every call inside a `DO` block is found. `schedule_in_database` is listed
// before `schedule` only for readability: the `\s*\(` already keeps them apart.
const CRON_CALL = /\bcron\s*\.\s*(schedule_in_database|schedule|unschedule|alter_job)\s*\(/gi;
const DOLLAR_TAG = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/;
const ARITY = { schedule: 3, unschedule: 1 };
/** The masked text immediately before a DO block's opening dollar tag. */
const DO_OPENER = /\bDO(?:\s+LANGUAGE\s+[A-Za-z_][A-Za-z0-9_]*)?\s*$/i;

/** Skip whitespace, `--` line comments and nested block comments from `i`. */
function skipBlank(src, i) {
  for (;;) {
    while (i < src.length && /\s/.test(src[i])) i++;
    if (src.startsWith("--", i)) {
      const nl = src.indexOf("\n", i);
      i = nl < 0 ? src.length : nl + 1;
      continue;
    }
    if (src.startsWith("/*", i)) {
      let depth = 1;
      let j = i + 2;
      while (j < src.length && depth > 0) {
        if (src.startsWith("/*", j)) {
          depth++;
          j += 2;
        } else if (src.startsWith("*/", j)) {
          depth--;
          j += 2;
        } else j++;
      }
      i = j;
      continue;
    }
    return i;
  }
}

/**
 * The arguments of one cron call, parsed LOCALLY from its own `(` in the ORIGINAL
 * text. ⛔ Only a plain `'…'` literal or a `$tag$…$tag$` literal is accepted, with
 * whitespace and comments between them; anything else — an identifier, `||`, a cast,
 * a function call, a variable, an unclosed list — is MEASURE_FAIL. Parsing from the
 * call's own parenthesis is what recovers the command of
 * 20260515113637_resend_message_correlation.sql, whose `$$` command sits inside a
 * `DO $$` body (PostgreSQL rejects that file as authored; PROD carries the job with
 * exactly the inner command).
 * @returns {{ args: Array<{value: string, raw: string}>, end: number }}
 */
function parseCronArgs(src, open, at) {
  const args = [];
  let i = skipBlank(src, open + 1);
  if (src[i] === ")") return { args, end: i + 1 };
  for (;;) {
    const start = i;
    let value;
    if (src[i] === "'") {
      let j = i + 1;
      for (;;) {
        const q = src.indexOf("'", j);
        if (q < 0) measureFail(`${at}: an unterminated '…' argument`);
        if (src[q + 1] === "'") {
          j = q + 2;
          continue;
        }
        i = q + 1;
        break;
      }
      value = src.slice(start + 1, i - 1).replace(/''/g, "'");
    } else if (src[i] === "$" && DOLLAR_TAG.test(src.slice(i, i + 80))) {
      const tag = DOLLAR_TAG.exec(src.slice(i, i + 80))[0];
      const close = src.indexOf(tag, i + tag.length);
      if (close < 0) measureFail(`${at}: an unterminated dollar-quoted argument`);
      value = src.slice(i + tag.length, close);
      i = close + tag.length;
    } else if (i >= src.length) {
      measureFail(`${at}: an unclosed argument list`);
    } else {
      measureFail(`${at}: argument ${args.length + 1} is not a '…' or $tag$ literal (an identifier, expression, variable or call is not modelled)`);
    }
    args.push({ value, raw: src.slice(start, i) });
    i = skipBlank(src, i);
    if (src[i] === ",") {
      i = skipBlank(src, i + 1);
      continue;
    }
    if (src[i] === ")") return { args, end: i + 1 };
    if (i >= src.length) measureFail(`${at}: an unclosed argument list`);
    measureFail(`${at}: argument ${args.length} is followed by something other than ',' or ')' (a concatenation, cast or expression is not modelled)`);
  }
}

/**
 * Fold every cron.schedule / cron.unschedule over the carried files, in filename
 * order: a later schedule of a name supersedes the earlier one (pg_cron's
 * `cron.schedule` upserts by name), an unschedule removes it, and an unschedule of a
 * name not folded at that point is a no-op the census names.
 */
function foldCron(files, lexed) {
  const jobs = new Map(); // insertion order = order of each job's LAST declaring call
  const noops = [];
  const everScheduled = new Set();
  let scheduleCalls = 0;
  let unscheduleCalls = 0;
  for (const { base, src } of files) {
    const L = lexed.get(base);
    const inCode = count(L.code, CRON_CALL);
    const inText = count(L.stripped, CRON_CALL);
    if (inCode !== inText) {
      measureFail(
        `${base}: cron call-site counts disagree between the two lexers (code positions ${inCode}, comment-stripped text ${inText}) — a cron call sits inside a string literal an EXECUTE could run`,
      );
    }
    const calls = [];
    CRON_CALL.lastIndex = 0;
    let m;
    while ((m = CRON_CALL.exec(L.code)) !== null) {
      const fn = m[1].toLowerCase();
      const at = `${base} statement ${L.stmtIndex(m.index)}`;
      if (!(fn in ARITY)) measureFail(`${at}: a cron.${fn} call site is not modelled`);
      // Review 164.4.2 WR-06: a call inside a dollar body RAN at migration time
      // only when that body is a DO block. Any other body (a CREATE FUNCTION /
      // PROCEDURE) is DEFINED by the migration, never run by it, so folding its
      // call would register a job PROD never had — and --check rebuilds its
      // expectation from this same fold, so it could not see the error.
      const body = L.ranges.find((r) => m.index >= r[0] && m.index < r[1]);
      if (body && !DO_OPENER.test(L.code.slice(0, body[0]))) {
        measureFail(`${at}: a cron.${fn} call inside a dollar body that is not a DO block (a function body is defined, not run, by the migration) is not modelled`);
      }
      const open = m.index + m[0].length - 1;
      const { args, end } = parseCronArgs(src, open, at);
      if (args.length !== ARITY[fn]) measureFail(`${at}: cron.${fn} with ${args.length} argument(s); exactly ${ARITY[fn]} literal(s) are modelled`);
      calls.push({ fn, at, start: m.index, open, end, args });
    }
    for (const c of calls) {
      if (calls.some((o) => o !== c && c.start > o.open && c.start < o.end)) {
        measureFail(`${c.at}: a cron call inside another cron call's arguments is not modelled`);
      }
    }
    for (const c of calls) {
      const name = c.args[0].value;
      if (c.fn === "schedule") {
        scheduleCalls++;
        everScheduled.add(name);
        jobs.delete(name);
        jobs.set(name, {
          name,
          schedule: c.args[1].value,
          command: c.args[2].value,
          base,
          sql: `SELECT cron.schedule(${c.args.map((a) => a.raw).join(", ")});`,
        });
      } else {
        unscheduleCalls++;
        if (jobs.has(name)) jobs.delete(name);
        else noops.push(name);
      }
    }
  }
  return { jobs, noops, everScheduled, scheduleCalls, unscheduleCalls };
}

function derive(migrationsDir, carriedFile) {
  const files = readCarried(migrationsDir, carriedFile);
  const lexed = new Map(files.map(({ base, src }) => [base, lex(base, src)]));
  return { files, triggers: foldAuthTriggers(files, lexed), cron: foldCron(files, lexed) };
}

const sha12 = (s) => createHash("sha256").update(s, "utf8").digest("hex").slice(0, 12);

// ── --emit ──────────────────────────────────────────────────────────────────
function emit() {
  const outDir = arg("--out-dir");
  const { files, triggers, cron } = derive(arg("--migrations"), arg("--carried"));
  mkdirSync(outDir, { recursive: true });
  const trig = ["SET search_path TO public;", ...[...triggers.values()].map((t) => `${t.sql};`)].join("\n") + "\n";
  writeFileSync(join(outDir, "nonpublic-auth-triggers.sql"), trig);
  // One registration per surviving job, from the literals' ORIGINAL bytes, ordered by
  // each job's last declaring call (file, then offset).
  writeFileSync(join(outDir, "nonpublic-cron.sql"), [...cron.jobs.values()].map((j) => `${j.sql}\n`).join(""));
  const list = (xs) => (xs.length ? ` (${xs.join(" ")})` : "");
  const trigNames = [...triggers.values()].map((t) => `${t.name}<-${t.base}`);
  // A no-op unschedule is usually the house unschedule-if-exists guard ahead of a
  // job's FIRST schedule, so the count alone is printed for those. A name that NO
  // carried call ever schedules is named: it is the one a reader should look at.
  const neverScheduled = [...new Set(cron.noops)].filter((n) => !cron.everScheduled.has(n));
  console.log(
    `nonpublic-extract: carried-files=${files.length} auth-triggers=${triggers.size}${list(trigNames)}` +
      ` schedule-calls=${cron.scheduleCalls} unschedule-calls=${cron.unscheduleCalls}` +
      ` cron-jobs=${cron.jobs.size}${list([...cron.jobs.keys()])}` +
      ` no-op-unschedules=${cron.noops.length} never-scheduled=${neverScheduled.length}${list(neverScheduled)}`,
  );
  return 0;
}

// ── --check ─────────────────────────────────────────────────────────────────
function parseCatalogue(text) {
  const meta = new Map();
  const triggers = new Map();
  const cron = [];
  const rows = text.split("\n").filter((l) => l !== "");
  for (const raw of rows) {
    const f = raw.split("|");
    if (f[0] === "meta" && f.length === 3) {
      if (meta.has(f[1])) measureFail(`the catalogue carries meta|${f[1]} twice`);
      meta.set(f[1], f[2]);
    } else if (f[0] === "trigger" && f.length === 6 && f[1] === "users" && /^\d+$/.test(f[3])) {
      if (triggers.has(f[2])) measureFail(`the catalogue lists auth.users trigger ${f[2]} twice`);
      triggers.set(f[2], { name: f[2], tgtype: Number(f[3]), enabled: f[4], fn: f[5] });
    } else if (f[0] === "cron" && f.length === 7 && [f[1], f[2], f[6]].every(isHex) && /^[tf]$/.test(f[3])) {
      // Free-text fields are hex-encoded by the catalogue SQL: commands carry newlines and `|`.
      cron.push({ name: unhex(f[1]), schedule: unhex(f[2]), active: f[3], username: f[4], database: f[5], command: unhex(f[6]) });
    } else {
      measureFail(`unrecognised catalogue line ${rows.indexOf(raw) + 1} (it is not this gate's query output)`);
    }
  }
  return { rows, meta, triggers, cron };
}

const isHex = (s) => /^(?:[0-9a-f]{2})*$/.test(s);
const unhex = (s) => Buffer.from(s, "hex").toString("utf8");

function check() {
  const catPath = arg("--catalogue");
  // The role cron jobs must be registered as: the loading role, whose DSN run.sh reads.
  const cronOwner = arg("--cron-owner");
  const { triggers: declared, cron } = derive(arg("--migrations"), arg("--carried"));
  let text;
  try {
    text = readFileSync(catPath, "utf8");
  } catch (e) {
    measureFail(`could not read the catalogue: ${e.code ?? e.message}`);
  }
  const cat = parseCatalogue(text);

  // (A) PRESENCE. An empty catalogue, or one without its meta rows, is not this
  // gate's query output — and "read nothing" must never compare as "nothing there".
  if (cat.rows.length === 0) measureFail("the catalogue is EMPTY — an unread lane is not a faithful one");
  for (const k of ["superuser", "database", "pg_cron"]) {
    if (!cat.meta.has(k)) measureFail(`the catalogue carries no meta|${k} row — it is not this gate's query output`);
  }
  // (B) THE READER. pg_cron's row-level security on cron.job shows a non-superuser
  // only its own jobs, so a catalogue read by one could not see every row.
  const su = cat.meta.get("superuser");
  if (su !== undefined && !/^[tf]$/.test(su)) measureFail("meta|superuser is neither t nor f");
  if (su === "f") measureFail("the catalogue was read by a NON-superuser, which cannot see every row it must compare");

  const findings = [];
  for (const d of declared.values()) {
    const got = cat.triggers.get(d.name);
    if (!got) {
      findings.push(`MISSING  auth.users trigger ${d.name} (declared by ${d.base}; absent on the lane)`);
      continue;
    }
    if (got.tgtype !== d.tgtype) findings.push(`DIFFERS  auth.users trigger ${d.name}: tgtype lane=${got.tgtype} declared=${d.tgtype}`);
    if (got.enabled !== "O") findings.push(`DIFFERS  auth.users trigger ${d.name}: tgenabled lane=${got.enabled} declared=O`);
    if (got.fn !== d.fn) findings.push(`DIFFERS  auth.users trigger ${d.name}: function lane=${got.fn} declared=${d.fn}`);
  }
  for (const got of cat.triggers.values()) {
    if (!declared.has(got.name)) findings.push(`EXTRA    auth.users trigger ${got.name} (on the lane, declared by no carried migration)`);
  }

  // ── cron.job, BYTE-EXACT (test_retention_crons_safe.sql reads the command
  // verbatim, so a normalised comparison would pass a lane that file fails on).
  const pgCron = cat.meta.get("pg_cron");
  if (pgCron !== undefined && !/^[01]$/.test(pgCron)) measureFail("meta|pg_cron is neither 0 nor 1");
  if (pgCron === "0" && cron.jobs.size > 0) {
    measureFail(`the carried migrations declare ${cron.jobs.size} cron job(s) and the lane has no pg_cron extension to hold them`);
  }
  const laneJobs = new Map();
  for (const row of cat.cron) {
    if (laneJobs.has(row.name)) laneJobs.get(row.name).push(row);
    else laneJobs.set(row.name, [row]);
  }
  for (const [name, rows] of laneJobs) {
    if (rows.length > 1) findings.push(`DUPLICATE cron job ${name}: ${rows.length} rows on the lane (a double registration)`);
  }
  for (const d of cron.jobs.values()) {
    const got = laneJobs.get(d.name)?.[0];
    if (!got) {
      findings.push(`MISSING  cron job ${d.name} (declared last by ${d.base}; absent on the lane)`);
      continue;
    }
    if (got.schedule !== d.schedule) findings.push(`DIFFERS  cron job ${d.name}: schedule lane=${got.schedule} declared=${d.schedule}`);
    if (got.command !== d.command) {
      findings.push(`DIFFERS  cron job ${d.name}: command lane sha256=${sha12(got.command)}… declared sha256=${sha12(d.command)}…`);
    }
    if (got.active !== "t") findings.push(`DIFFERS  cron job ${d.name}: active lane=${got.active} declared=t`);
    if (got.username !== cronOwner) findings.push(`DIFFERS  cron job ${d.name}: username lane=${got.username} declared=${cronOwner} (the loading role)`);
    if (got.database !== cat.meta.get("database")) {
      findings.push(`DIFFERS  cron job ${d.name}: database lane=${got.database} declared=${cat.meta.get("database")}`);
    }
  }
  for (const name of laneJobs.keys()) {
    if (!cron.jobs.has(name)) findings.push(`EXTRA    cron job ${name} (on the lane, declared by no carried migration)`);
  }

  for (const f of findings) console.log(`nonpublic-drift: ${f}`);
  const fields = [
    `auth-users-triggers=${cat.triggers.size}/${declared.size}`,
    `cron-jobs=${cat.cron.length}/${cron.jobs.size}`,
    `drift=${findings.length}`,
  ].join(" ");
  if (findings.length > 0) {
    console.error(
      `::error::nonpublic-fidelity DRIFT: ${findings.length} difference(s) between the lane's non-public objects and the set the carried migrations declare. Corpus files that read them would measure a lane that is not PROD's.`,
    );
    console.log(`nonpublic-fidelity: ${fields} verdict DRIFT`);
    return 1;
  }
  console.log(`nonpublic-fidelity: ${fields} verdict OK`);
  return 0;
}

function main() {
  const mode = process.argv[2];
  try {
    if (mode === "--emit") return emit();
    if (mode === "--check") return check();
    measureFail("the first argument must be --emit or --check");
  } catch (e) {
    if (!(e instanceof MeasureFail)) throw e;
    const tag = mode === "--emit" ? "nonpublic-extract" : "nonpublic-fidelity";
    console.error(`::error::${tag} MEASURE_FAIL: ${e.message}`);
    console.log(`${tag}: drift=unknown verdict MEASURE_FAIL`);
    return 2;
  }
  return 2;
}

// `exitCode`, not `exit()`: a pipe write on macOS is asynchronous, and exiting on the
// next tick can drop the verdict line a caller reads.
process.exitCode = main();
