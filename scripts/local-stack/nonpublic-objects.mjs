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
 *
 * ⛔ IT REFUSES BY DEFAULT. A shape this module cannot prove safe is MEASURE_FAIL (exit
 * 2), never skipped: a trigger carrying a WHEN clause, `UPDATE OF`, REFERENCING or
 * CONSTRAINT; ENABLE/DISABLE TRIGGER on an auth table; a trigger on any auth table
 * other than `users`; auth trigger DDL inside a dollar body; trigger DDL visible only
 * inside a string literal (two independent lexers disagree); a carried basename with no
 * file, or a malformed carried line.
 *
 * USAGE
 *   node scripts/local-stack/nonpublic-objects.mjs --emit  --migrations <dir> --carried <file> --out-dir <dir>
 *   node scripts/local-stack/nonpublic-objects.mjs --check --migrations <dir> --carried <file> --catalogue <rows>
 *   (<rows> is `psql -X -q -At -F '|' -f scripts/local-stack/nonpublic-catalogue.sql`, read
 *    through the stack SUPERUSER DSN)
 *
 * --emit writes <out-dir>/nonpublic-auth-triggers.sql: `SET search_path TO public;` and
 * then each surviving statement's ORIGINAL bytes, sliced by offset — nothing is
 * re-rendered. It prints one census line starting `nonpublic-extract:`.
 *
 * --check RE-DERIVES the declared set from the migrations. ⛔ It never reads the SQL
 * `--emit` wrote, so a partly applied or altered emit file cannot vouch for itself. It
 * prints one MISSING / EXTRA / DIFFERS line per finding, then
 *   nonpublic-fidelity: auth-users-triggers=<lane>/<declared> drift=<n> verdict OK|DRIFT|MEASURE_FAIL
 * EXIT 0 = OK, 1 = DRIFT, 2 = MEASURE_FAIL (also: an empty catalogue, a missing meta
 * row, or a meta row saying the reader is not a superuser — a non-superuser cannot see
 * every row it would need to).
 *
 * ⛔ THE REPO IS PUBLIC and CI logs are world-readable. Output carries file names,
 * statement indexes, trigger names, counts and sha256 prefixes only — never statement
 * text, a DSN or a password.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
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

function derive(migrationsDir, carriedFile) {
  const files = readCarried(migrationsDir, carriedFile);
  const lexed = new Map(files.map(({ base, src }) => [base, lex(base, src)]));
  return { files, triggers: foldAuthTriggers(files, lexed) };
}

// ── --emit ──────────────────────────────────────────────────────────────────
function emit() {
  const outDir = arg("--out-dir");
  const { files, triggers } = derive(arg("--migrations"), arg("--carried"));
  mkdirSync(outDir, { recursive: true });
  const trig = ["SET search_path TO public;", ...[...triggers.values()].map((t) => `${t.sql};`)].join("\n") + "\n";
  writeFileSync(join(outDir, "nonpublic-auth-triggers.sql"), trig);
  const names = [...triggers.values()].map((t) => `${t.name}<-${t.base}`).join(" ");
  console.log(`nonpublic-extract: carried-files=${files.length} auth-triggers=${triggers.size}${names ? ` (${names})` : ""}`);
  return 0;
}

// ── --check ─────────────────────────────────────────────────────────────────
function parseCatalogue(text) {
  const meta = new Map();
  const triggers = new Map();
  const rows = text.split("\n").filter((l) => l !== "");
  for (const raw of rows) {
    const f = raw.split("|");
    if (f[0] === "meta" && f.length === 3) {
      if (meta.has(f[1])) measureFail(`the catalogue carries meta|${f[1]} twice`);
      meta.set(f[1], f[2]);
    } else if (f[0] === "trigger" && f.length === 6 && f[1] === "users" && /^\d+$/.test(f[3])) {
      if (triggers.has(f[2])) measureFail(`the catalogue lists auth.users trigger ${f[2]} twice`);
      triggers.set(f[2], { name: f[2], tgtype: Number(f[3]), enabled: f[4], fn: f[5] });
    } else {
      measureFail(`unrecognised catalogue line ${rows.indexOf(raw) + 1} (it is not this gate's query output)`);
    }
  }
  return { rows, meta, triggers };
}

function check() {
  const catPath = arg("--catalogue");
  const { triggers: declared } = derive(arg("--migrations"), arg("--carried"));
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
  for (const k of ["superuser", "database"]) {
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

  for (const f of findings) console.log(`nonpublic-drift: ${f}`);
  const fields = [`auth-users-triggers=${cat.triggers.size}/${declared.size}`, `drift=${findings.length}`].join(" ");
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
