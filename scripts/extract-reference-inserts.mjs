#!/usr/bin/env node
/**
 * Reference-data extractor for the TEST restore — Phase 164.8.1.
 *
 * ⚠️ WHY THIS EXISTS, measured 2026-09-09. `scripts/restore-test-from-baseline.sh`
 * drops `public`, reloads a SCHEMA-ONLY dump (`supabase/schema/baseline.sql`
 * carries 562 GRANT/REVOKE and ZERO INSERT/COPY), and then SEEDS the migration
 * ledger from the repo file list. So after a restore every migration reads as
 * applied while every row it INSERTed is gone — ledger presence is not effect
 * presence, and for DML-bearing migrations it is FALSE BY CONSTRUCTION. This
 * script turns `scripts/restore-test-refdata-allowlist.txt` into the SQL the
 * restore replays inside the same transaction as the schema load.
 *
 * ── IT REFUSES BY DEFAULT ──────────────────────────────────────────────────
 * ⛔ A SILENT PARTIAL EXTRACTION IS THE WORST OUTCOME AVAILABLE. It would replay
 * a truncated statement into shared TEST, which carries other people's CI. So
 * every shape this script cannot prove safe exits 1 through ONE `refuse()` path
 * that NAMES the file, the line, the table and the reason. There is no "best
 * effort" mode and no `--force`. "Could not classify" and "classified as not
 * reference data" never share a code path.
 *
 * ── HOW A STATEMENT IS CLASSIFIED (C1-C4 live in the allowlist header) ──────
 * C1 TOP-LEVEL, C2 LITERALS ONLY, C3 target in `public` (with the ONE named
 * `auth.users` exception), C4 a consumer reads the row — C4 is human judgement
 * and is carried as the entry's trailing `# <consumer>` comment, which this
 * script REQUIRES but cannot evaluate.
 *
 * Lexing reuses `maskSql` + `statements` from `scripts/lint-sql-gates.mjs` (the
 * repo's only comment/string/dollar-quote-aware SQL lexer). Emitted SQL is the
 * ORIGINAL bytes sliced by offset — nothing is rewritten, re-indented, or made
 * idempotent here. The idempotence is the migration's own `ON CONFLICT`.
 *
 * ── KNOWN LIMITATIONS, STATED RATHER THAN HIDDEN ───────────────────────────
 * 1. `--audit` sees ONLY the tables the allowlist already names. It closes "a
 *    new `*_kind.sql` migration merged with no allowlist line". It CANNOT see a
 *    brand-new reference TABLE (a future `foo_kinds`) — that stays a human call
 *    against C1-C4 at review time. Same shape of gap `lint-sql-gates.mjs`
 *    states about arm reachability.
 * 2. For a table/file pair the allowlist does NOT name, a top-level
 *    `INSERT … SELECT` is SKIPPED, not flagged — by C2 it is a backfill of
 *    existing data. For a pair the allowlist DOES name, the same shape is a
 *    REFUSAL, because the entry asserts every top-level INSERT into that table
 *    in that file is reference data.
 * 3. ⛔ RESEARCH's assumption A4 ("`maskSql` does not split DO bodies at inner
 *    `;`") was MEASURED FALSE on 2026-09-09 and this script does not rely on
 *    it. `maskSql` blanks dollar-quote DELIMITERS and scans the interior as
 *    code, so `statements()` splits a `DO` body at every inner `;` and a body
 *    INSERT that is not the body's first statement surfaces as its own
 *    top-level-looking span. `dollarBodyRanges()` below is A4's stated fallback:
 *    an independent dollar-depth scan of the ORIGINAL text that excludes those
 *    spans. The `c1-dollar-body` self-test kind is its falsifier, and the line it
 *    falsifies is the SCAN, not the guard. MEASURED 2026-09-09 on a scratch copy
 *    (review finding WR-04): neutering `dollarBodyRanges()` to `{ranges: []}` makes
 *    the red fixture EMIT its body INSERT and exit 0, while removing ONLY
 *    `insideBody()` still exits 1 — via the independent `hasTag` refusal, with a
 *    different message the leg's `expect` string tells apart. `hasTag` provably
 *    subsumes `insideBody` (for any span inside a body, `r[0] <= first <= end <
 *    r[1]`, so the overlap test always holds), so `insideBody()` adds no exclusion
 *    power; it is kept for the better diagnosis, and the header used to claim it
 *    was the falsified line.
 * 4. It says nothing about whether the rows are on TEST right now. It says
 *    which statements the restore replays.
 *
 * ⛔ THIS REPOSITORY IS PUBLIC and the restore workflow's Actions log is
 * world-readable. Every message this script prints carries FILE NAMES, LINE
 * NUMBERS, TABLE NAMES, COUNTS and REASONS only — never statement text, never a
 * value, and never a `$`-tag (the restore's own redaction grep scans captured
 * output for one).
 *
 * The EXACT commands CI runs, and the exact commands a developer runs locally:
 *
 *     node scripts/extract-reference-inserts.mjs --self-test
 *     node scripts/extract-reference-inserts.mjs --audit
 *     node scripts/extract-reference-inserts.mjs            # emit to stdout
 */
import { readFileSync, readdirSync, existsSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { basename, dirname, join, relative, resolve } from "node:path";
import { maskSql, statements } from "./lint-sql-gates.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
export const DEFAULT_ALLOWLIST = join(REPO_ROOT, "scripts", "restore-test-refdata-allowlist.txt");
export const DEFAULT_MIGRATIONS = join(REPO_ROOT, "supabase", "migrations");
export const FIXTURE_DIR = "scripts/extract-reference-inserts-fixtures";

const rel = (p) => {
  const r = relative(REPO_ROOT, p);
  return r.startsWith("..") ? p : r;
};

// ───────────────────────────────────────────────────────────────────────────
// The allowlist parser. Four TAB-separated fields; anything else is a NAMED
// malformed line, never a skipped one. The trailing `# <consumer>` is C4's
// carrier and is REQUIRED: an entry with no consumer is a per-table allowlist
// wearing a per-statement costume (decision L-02).
// ───────────────────────────────────────────────────────────────────────────

/** Filenames are interpolated into paths and (by the bash side) into SQL. */
const BASENAME_RE = /^[A-Za-z0-9_.-]+\.sql$/;
const QUALIFIED_RE = /^([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)$/;

/** C3: `public.*`, plus the ONE named exception the allowlist header documents. */
export function schemaAllowed(qualified) {
  return qualified.startsWith("public.") || qualified === "auth.users";
}

/**
 * @returns {{ entries: Array<{lineNo:number,file:string,qualified:string,schema:string,table:string,count:number,consumer:string}>, malformed: Array<{lineNo:number,reason:string}> }}
 */
export function parseAllowlist(text) {
  const entries = [];
  const malformed = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const lineNo = i + 1;
    if (/^[\t ]*(#|$)/.test(raw)) continue;
    const f = raw.split("\t");
    const bad = (reason) => malformed.push({ lineNo, reason });
    if (f.length !== 4) {
      bad(
        `expected exactly 4 TAB-separated fields (<basename>.sql, <schema.table>, <count>, "# <consumer>"), found ${f.length}`,
      );
      continue;
    }
    const [file, qualified, countRaw] = f;
    const consumer = f[3].trim();
    if (!BASENAME_RE.test(file)) {
      bad(`field 1 "${file.slice(0, 60)}" is not a <basename>.sql of [A-Za-z0-9_.-]`);
      continue;
    }
    const q = QUALIFIED_RE.exec(qualified);
    if (!q) {
      bad(`field 2 "${qualified.slice(0, 60)}" is not a lower-case <schema>.<table>`);
      continue;
    }
    if (!schemaAllowed(qualified)) {
      bad(
        `field 2 "${qualified}" targets a schema outside \`public\` — the restore drops ONLY public, so rows elsewhere survive and need no replay (C3). The ONE exception is auth.users in the teaser file; it is documented in the allowlist header`,
      );
      continue;
    }
    if (!/^[1-9][0-9]*$/.test(countRaw)) {
      bad(`field 3 "${countRaw.slice(0, 20)}" is not a positive integer statement count`);
      continue;
    }
    if (!consumer.startsWith("#") || consumer.replace(/^#+/, "").trim().length === 0) {
      bad(
        `field 4 carries no \`# <consumer>\` — C4 is the criterion a machine cannot check, so the entry must cite the FK, CHECK, slug lookup or app constant that reads the row`,
      );
      continue;
    }
    entries.push({
      lineNo,
      file,
      qualified,
      schema: q[1],
      table: q[2],
      count: Number(countRaw),
      consumer,
    });
  }
  return { entries, malformed };
}

// ───────────────────────────────────────────────────────────────────────────
// Lexing helpers. `maskSql` preserves offsets, so a masked span maps back onto
// the ORIGINAL bytes 1:1 — that is what lets this script emit source bytes
// rather than a re-rendered statement.
// ───────────────────────────────────────────────────────────────────────────

const DOLLAR_TAG = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/;

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
 * Half-open `[start, end)` ranges of every dollar-quoted body in the ORIGINAL
 * text, delimiters included, skipping comments and string literals so a `$$`
 * inside one is not mistaken for a body.
 *
 * ⛔ THIS IS NOT DECORATION. `maskSql` blanks the delimiters and lexes the body
 * as code, so `statements()` splits `DO $$ … ; … $$;` at the inner `;`. Without
 * this scan a fixture INSERT sitting second in a `DO` body — an encrypted
 * `api_keys` blob, say — reads as a top-level statement and would be replayed
 * into shared TEST. RESEARCH A4 assumed otherwise; A4 is false (header, note 3).
 *
 * @returns {{ ranges: Array<[number, number]> } | { error: string, line: number }}
 */
export function dollarBodyRanges(src) {
  const n = src.length;
  const ranges = [];
  const lineAt = (idx) => src.slice(0, idx).split("\n").length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === "-" && src[i + 1] === "-") {
      let j = src.indexOf("\n", i);
      if (j === -1) j = n;
      i = j;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      let depth = 1;
      let j = i + 2;
      while (j < n && depth > 0) {
        if (src[j] === "/" && src[j + 1] === "*") {
          depth++;
          j += 2;
        } else if (src[j] === "*" && src[j + 1] === "/") {
          depth--;
          j += 2;
        } else j++;
      }
      if (depth > 0) return { error: "unterminated /* block comment", line: lineAt(i) };
      i = j;
      continue;
    }
    if (c === "'") {
      // Same rule as maskSql: E'...' honours backslash escapes, plain '...' does not.
      const escaped = /[Ee]/.test(src[i - 1] ?? "") && !/[A-Za-z0-9_$]/.test(src[i - 2] ?? "");
      let j = i + 1;
      let closed = false;
      while (j < n) {
        if (escaped && src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src[j] === "'") {
          if (src[j + 1] === "'") {
            j += 2;
            continue;
          }
          j++;
          closed = true;
          break;
        }
        j++;
      }
      if (!closed) return { error: "unterminated ' string literal", line: lineAt(i) };
      i = j;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let closed = false;
      while (j < n) {
        if (src[j] === '"') {
          if (src[j + 1] === '"') {
            j += 2;
            continue;
          }
          j++;
          closed = true;
          break;
        }
        j++;
      }
      if (!closed) return { error: 'unterminated " quoted identifier', line: lineAt(i) };
      i = j;
      continue;
    }
    if (c === "$") {
      const m = DOLLAR_TAG.exec(src.slice(i, i + 80));
      if (m) {
        const tag = m[0];
        const close = src.indexOf(tag, i + tag.length);
        // ⛔ The tag itself is never printed: the restore's redaction grep scans
        // captured output for a `$`-tag, so echoing one would trip it.
        if (close === -1) return { error: "unterminated dollar-quoted body", line: lineAt(i) };
        ranges.push([i, close + tag.length]);
        i = close + tag.length;
        continue;
      }
    }
    i++;
  }
  return { ranges };
}

/** True when `off` falls inside any dollar-quoted body. */
export function insideBody(ranges, off) {
  for (const r of ranges) if (off >= r[0] && off < r[1]) return true;
  return false;
}

const ALLOWED_BARE = new Set(["NULL", "TRUE", "FALSE", "DEFAULT"]);
const ALLOWED_CALLS = new Set(["now", "gen_random_uuid"]);

/**
 * C2 over the MASKED text of one statement (string interiors are already
 * blanked, so what remains in the tuple is code).
 * @returns {string|null} the refusal reason, or null when the span is literal.
 */
export function literalCheck(maskedStatement) {
  if (/\b(SELECT|FROM)\b/i.test(maskedStatement)) {
    return "carries a SELECT/FROM token — an INSERT ... SELECT is a backfill of existing data, not a literal VALUES (C2)";
  }
  const v = /\bVALUES\b/i.exec(maskedStatement);
  if (!v) return "carries no VALUES keyword — not a literal VALUES (C2)";
  // ⛔ C2 IS ENFORCED OVER THE VALUES TUPLE ONLY, so the ON CONFLICT ACTION HAS TO
  // BE CHECKED SEPARATELY — the slice below deliberately throws it away. Against a
  // table the DROP just emptied a `DO UPDATE` arm is a no-op (nothing conflicts),
  // but `auth.users` is this phase's one C3 exception precisely because its row
  // SURVIVES the restore: a `DO UPDATE` there would MUTATE a pre-existing row on
  // shared TEST inside a transaction that then commits. Measured 2026-09-09: all 22
  // ON CONFLICT clauses in the emitted corpus are DO NOTHING, so this was latent
  // (review finding WR-05). The allowlist's C4 idiom is idempotent seeds; anything
  // else is a human's call.
  const conflict = /\bON\s+CONFLICT\b([\s\S]*)$/i.exec(maskedStatement);
  if (conflict && !/\bDO\s+NOTHING\b/i.test(conflict[1])) {
    return "the ON CONFLICT action is not DO NOTHING — a DO UPDATE arm MUTATES a pre-existing row, and `auth.users` (the one C3 exception) SURVIVES the restore, so on shared TEST that row is somebody else's (C2)";
  }
  let region = maskedStatement.slice(v.index + v[0].length);
  const stop = /\bON\s+CONFLICT\b|\bRETURNING\b/i.exec(region);
  if (stop) region = region.slice(0, stop.index);
  const re = /::|[A-Za-z_][A-Za-z0-9_]*/g;
  let m;
  let afterCast = false;
  while ((m = re.exec(region)) !== null) {
    if (m[0] === "::") {
      afterCast = true;
      continue;
    }
    if (afterCast) {
      afterCast = false;
      continue;
    }
    const t = m[0];
    if (ALLOWED_BARE.has(t.toUpperCase())) continue;
    if (ALLOWED_CALLS.has(t.toLowerCase()) && /^[\t\n ]*\(/.test(region.slice(m.index + t.length)))
      continue;
    return `the VALUES tuple carries the non-literal token \`${t}\` — only literals, ::casts, NULL/TRUE/FALSE/DEFAULT, now() and gen_random_uuid() are replayable (C2)`;
  }
  return null;
}

/**
 * One lex pass per file, shared by every table the allowlist names in it.
 * @returns {{ spans: Array<object>, lineOf: Function } | { error: string, line: number }}
 */
export function prepareFile(src) {
  const masked = maskSql(src);
  if (masked.error) return { error: masked.error, line: masked.line };
  const dq = dollarBodyRanges(src);
  if (dq.error) return { error: dq.error, line: dq.line };
  const lineOf = lineIndexer(src);
  const spans = [];
  for (const s of statements(masked.code)) {
    const off = s.text.search(/\S/);
    if (off < 0) continue;
    const first = s.start + off;
    spans.push({
      first,
      end: s.end,
      line: lineOf(first),
      masked: masked.code.slice(first, s.end),
      terminated: s.end < masked.code.length && masked.code[s.end] === ";",
      inBody: insideBody(dq.ranges, first),
      hasTag: dq.ranges.some((r) => r[0] < s.end + 1 && r[1] > first),
    });
  }
  return { spans, lineOf };
}

// `"?id"?` — the QUOTED spelling has to match too. `maskSql` deliberately does not
// blank quoted identifiers ("Quoted identifiers are CODE, not data"), so the masked
// text still carries the `"`, and an unquoted-only head regex simply does not match
// `INSERT INTO "public"."compute_job_kinds" …`. That is the spelling
// `supabase/schema/baseline.sql` is written in from end to end — the house style one
// directory over. A non-match here is SILENT (`modeAudit` `continue`s on a file with
// neither an ok nor a rejected hit), so this blind spot would have looked exactly
// like a clean audit. Measured 2026-09-09: zero migrations use it today, which is
// why this was latent and not live (review finding WR-06).
//
// `(?![A-Za-z0-9_])` rather than `\b`: `\b` after a `"` is a word boundary against
// the quote itself, so `fx_ref"` would match a table named `fx_ref_old` spelled
// `"fx_ref_old"`. The negative lookahead is anchored on the character class the
// identifier is actually made of.
function quotedId(id) {
  return `"?${id}"?`;
}

function headRe(schema, table) {
  const pfx =
    schema === "public"
      ? `(?:${quotedId("public")}[\\t\\n ]*\\.[\\t\\n ]*)?`
      : `${quotedId(schema)}[\\t\\n ]*\\.[\\t\\n ]*`;
  return new RegExp(
    `^INSERT[\\t\\n ]+INTO[\\t\\n ]+${pfx}${quotedId(table)}(?![A-Za-z0-9_])`,
    "i",
  );
}

// A CTE-prefixed INSERT (`WITH x AS (…) INSERT INTO t …`) does not start with
// INSERT, so `headRe` never matches it and the statement is SKIPPED IN SILENCE —
// the one behaviour `--audit` exists to prevent. It is refused by name instead:
// whether such a statement is replayable reference data is a judgement this script
// is not equipped to make (the CTE can read existing rows, which is C2's whole
// concern), so it must reach a human rather than a `continue`.
function cteHeadRe(schema, table) {
  const pfx =
    schema === "public"
      ? `(?:${quotedId("public")}[\\t\\n ]*\\.[\\t\\n ]*)?`
      : `${quotedId(schema)}[\\t\\n ]*\\.[\\t\\n ]*`;
  return new RegExp(
    `^WITH\\b[\\s\\S]*\\bINSERT[\\t\\n ]+INTO[\\t\\n ]+${pfx}${quotedId(table)}(?![A-Za-z0-9_])`,
    "i",
  );
}

/**
 * Classify one file's spans against one target table.
 * @returns {{ ok: Array, body: Array, rejected: Array }}
 *   ok       — top-level literal statements, safe to replay
 *   body     — hits excluded by C1 (inside a dollar-quoted body)
 *   rejected — top-level hits this script REFUSES to classify as reference data
 */
export function matchTable(src, prep, qualified) {
  const dot = qualified.indexOf(".");
  const re = headRe(qualified.slice(0, dot), qualified.slice(dot + 1));
  const cteRe = cteHeadRe(qualified.slice(0, dot), qualified.slice(dot + 1));
  const ok = [];
  const body = [];
  const rejected = [];
  for (const s of prep.spans) {
    if (!re.test(s.masked)) {
      if (!s.inBody && cteRe.test(s.masked)) {
        rejected.push({
          line: s.line,
          reason:
            "the statement is a CTE-prefixed INSERT (`WITH … INSERT INTO`) — a CTE can read existing rows, so whether this is literal reference data is not a judgement this extractor can make; classify it by hand rather than let it be skipped in silence (WR-06)",
        });
      }
      continue;
    }
    if (s.inBody) {
      body.push({ line: s.line });
      continue;
    }
    if (!s.terminated) {
      rejected.push({ line: s.line, reason: "the statement is not terminated by `;`" });
      continue;
    }
    if (s.hasTag) {
      rejected.push({
        line: s.line,
        reason:
          "the statement carries a dollar-quoted body — the replay section is kept body-free so the restore's redaction grep has nothing to find",
      });
      continue;
    }
    const why = literalCheck(s.masked);
    if (why) {
      rejected.push({ line: s.line, reason: why });
      continue;
    }
    ok.push({ line: s.line, sql: src.slice(s.first, s.end + 1) });
  }
  return { ok, body, rejected };
}

// ───────────────────────────────────────────────────────────────────────────
// The ONE refusal path.
// ───────────────────────────────────────────────────────────────────────────

function makeIo() {
  return { out: [], err: [] };
}

function refuse(io, { file, line, table, reason }) {
  const where = [file, line != null ? String(line) : null].filter(Boolean).join(":");
  const what = table ? ` [${table}]` : "";
  io.err.push(`extract-reference-inserts: REFUSED ${where}${what}: ${reason}`);
}

// ───────────────────────────────────────────────────────────────────────────
// Loading: the allowlist, then the migration corpus it names.
// ───────────────────────────────────────────────────────────────────────────

function loadEntries(io, allowlistPath, migrationsDir) {
  if (!existsSync(allowlistPath)) {
    refuse(io, { file: rel(allowlistPath), reason: "allowlist not found" });
    return null;
  }
  if (!existsSync(migrationsDir)) {
    refuse(io, { file: rel(migrationsDir), reason: "migrations directory not found" });
    return null;
  }
  const parsed = parseAllowlist(readFileSync(allowlistPath, "utf8"));
  for (const m of parsed.malformed) {
    refuse(io, { file: rel(allowlistPath), line: m.lineNo, reason: m.reason });
  }
  if (parsed.entries.length === 0 && parsed.malformed.length === 0) {
    refuse(io, {
      file: rel(allowlistPath),
      reason:
        "the allowlist is EMPTY. An empty allowlist replays nothing and would let the restore commit a schema whose ledger claims every seed migration applied — that is the defect this gate exists to name, not a clean run",
    });
    return null;
  }
  for (const e of parsed.entries) {
    if (!existsSync(join(migrationsDir, e.file))) {
      refuse(io, {
        file: rel(allowlistPath),
        line: e.lineNo,
        table: e.qualified,
        reason: `names "${e.file}", which is not a migration under ${rel(migrationsDir)}`,
      });
    }
  }
  return parsed.malformed.length > 0 || io.err.length > 0 ? null : parsed.entries;
}

/** Classify one allowlist entry, pushing every refusal it earns. */
function classifyEntry(io, migrationsDir, cache, e) {
  const path = join(migrationsDir, e.file);
  if (!cache.has(e.file)) {
    const src = readFileSync(path, "utf8");
    cache.set(e.file, { src, prep: prepareFile(src) });
  }
  const { src, prep } = cache.get(e.file);
  if (prep.error) {
    refuse(io, {
      file: e.file,
      line: prep.line,
      table: e.qualified,
      reason: `the file could not be lexed (${prep.error}) — "could not measure" is never a pass`,
    });
    return null;
  }
  const m = matchTable(src, prep, e.qualified);
  for (const r of m.rejected) {
    refuse(io, { file: e.file, line: r.line, table: e.qualified, reason: r.reason });
  }
  if (m.rejected.length > 0) return null;
  if (m.ok.length === 0) {
    refuse(io, {
      file: e.file,
      table: e.qualified,
      reason:
        m.body.length > 0
          ? `the only INSERT INTO ${e.qualified} in this file is inside a dollar-quoted body at line ${m.body[0].line} (C1). Reference seeds are authored at TOP LEVEL with ON CONFLICT DO NOTHING; the remedy is to move the statement, never to teach this script to descend into bodies`
          : `no top-level literal INSERT INTO ${e.qualified} found, but the allowlist pins ${e.count}`,
    });
    return null;
  }
  if (m.ok.length !== e.count) {
    refuse(io, {
      file: e.file,
      line: m.ok[0].line,
      table: e.qualified,
      reason: `the allowlist pins ${e.count} top-level statement(s) but ${m.ok.length} were measured. A pinned count moves ONLY when an applied migration is edited — understand the edit, do not re-pin the number`,
    });
    return null;
  }
  return m.ok;
}

// ───────────────────────────────────────────────────────────────────────────
// Mode: emit (default).
// ───────────────────────────────────────────────────────────────────────────

function modeEmit(io, allowlistPath, migrationsDir) {
  const entries = loadEntries(io, allowlistPath, migrationsDir);
  if (!entries) return 1;
  const cache = new Map();
  const blocks = [];
  const perTable = new Map();
  let bad = 0;
  for (const e of entries) {
    const ok = classifyEntry(io, migrationsDir, cache, e);
    if (!ok) {
      bad = 1;
      continue;
    }
    for (const s of ok) {
      blocks.push(`${s.sql}\n-- refdata: ${e.file}:${s.line} ${e.qualified}`);
    }
    perTable.set(e.qualified, (perTable.get(e.qualified) ?? 0) + ok.length);
  }
  if (bad) return 1;

  io.out.push(
    "-- ─────────────────────────────────────────────────────────────────────────",
    "-- Reference-data replay. GENERATED — do not edit, do not commit.",
    "--   generator:  scripts/extract-reference-inserts.mjs",
    `--   allowlist:  ${rel(allowlistPath)}`,
    `--   migrations: ${rel(migrationsDir)}`,
    "-- Each statement below is the ORIGINAL bytes of an allowlisted migration",
    "-- statement, sliced by offset. Nothing is rewritten, re-ordered within a",
    "-- file, or made idempotent here — the idempotence is the migration's own.",
    "-- ─────────────────────────────────────────────────────────────────────────",
  );
  for (const b of blocks) io.out.push(b);
  const tables = Array.from(perTable.keys()).sort();
  for (const t of tables) io.out.push(`-- refdata-expect: ${t}=${perTable.get(t)}`);
  io.err.push(
    `extract-reference-inserts: emitted ${blocks.length} statement(s) over ${tables.length} table(s) from ${entries.length} allowlist entr(ies).`,
  );
  return 0;
}

// ───────────────────────────────────────────────────────────────────────────
// Mode: --audit. The drift direction a static allowlist cannot see by itself.
// ───────────────────────────────────────────────────────────────────────────

function modeAudit(io, allowlistPath, migrationsDir) {
  const entries = loadEntries(io, allowlistPath, migrationsDir);
  if (!entries) return 1;

  // ⛔ `|` AND NOT A RAW NUL. This key was built with a literal U+0000 separator,
  // which src/__tests__/drift-check-scripts.test.ts refuses in any scanned script:
  // an invisible byte cannot be seen in review and it trips secret/injection
  // scanners — and `grep` treats the whole file as binary, so a search for any line
  // here reads as "no match" (MEASURED 2026-09-09, the gate was red on this file).
  // `|` is safe as a separator because neither component can contain it: field 1 is
  // `[A-Za-z0-9_.-]+\.sql` (BASENAME_RE) and field 2 is `[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*`
  // (QUALIFIED_RE), both charset-refused at parse time.
  const listed = new Map(); // `${file}|${qualified}` -> entry
  const tables = new Set();
  const files = new Set();
  let pinnedSum = 0;
  for (const e of entries) {
    listed.set(`${e.file}|${e.qualified}`, e);
    tables.add(e.qualified);
    files.add(e.file);
    pinnedSum += e.count;
  }

  const corpus = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const perTableStatements = new Map();
  const perTableFiles = new Map();
  let bad = 0;
  let scanned = 0;

  // ⛔ [164.8.1 review, finding 3] ONE CLASSIFICATION PATH, not two. The
  // "every listed pair was reached" loop below used to re-read and re-lex files
  // this loop had already read and classified in the same run. It was cheap
  // (`--audit` measured 0.173 s), but cost is not the objection: two derivations
  // of the same verdict are two places the classification can drift, which is
  // the defect class the whole 164.x programme exists for. `prepareFile` and
  // `matchTable` are pure functions of the file bytes, so memoising them is
  // behaviour-identical by construction — re-measured against the pre-change
  // census, byte-for-byte, 2026-09-09.
  const fileCache = new Map(); // file -> {src, prep}
  const matchCache = new Map(); // `${file}|${qualified}` -> matchTable() result
  const readFile = (file) => {
    if (!fileCache.has(file)) {
      const src = readFileSync(join(migrationsDir, file), "utf8");
      fileCache.set(file, { src, prep: prepareFile(src) });
    }
    return fileCache.get(file);
  };
  const matchOf = (file, qualified) => {
    const key = `${file}|${qualified}`;
    if (!matchCache.has(key)) {
      const { src, prep } = readFile(file);
      matchCache.set(key, matchTable(src, prep, qualified));
    }
    return matchCache.get(key);
  };

  for (const file of corpus) {
    const { prep } = readFile(file);
    scanned++;
    if (prep.error) {
      refuse(io, {
        file,
        line: prep.line,
        reason: `the file could not be lexed (${prep.error}) — an unlexable migration is an unaudited migration, and "could not measure" is never a pass`,
      });
      bad = 1;
      continue;
    }
    for (const qualified of tables) {
      const m = matchOf(file, qualified);
      if (m.ok.length === 0 && m.rejected.length === 0) continue;
      const e = listed.get(`${file}|${qualified}`);
      if (!e) {
        if (m.ok.length === 0) continue; // limitation 2: an unlisted non-literal is a backfill
        refuse(io, {
          file,
          line: m.ok[0].line,
          table: qualified,
          reason: `${m.ok.length} top-level literal INSERT statement(s) into an ALLOWLISTED table, but this (file, table) pair has NO allowlist line. Clear this by ADDING the line with its consumer — never by relaxing the classifier`,
        });
        bad = 1;
        continue;
      }
      for (const r of m.rejected) {
        refuse(io, { file, line: r.line, table: qualified, reason: r.reason });
        bad = 1;
      }
      if (m.rejected.length > 0) continue;
      if (m.ok.length !== e.count) {
        refuse(io, {
          file,
          line: m.ok[0].line,
          table: qualified,
          reason: `the allowlist pins ${e.count} top-level statement(s) at ${rel(allowlistPath)}:${e.lineNo} but ${m.ok.length} were measured — an applied migration was edited`,
        });
        bad = 1;
        continue;
      }
      perTableStatements.set(qualified, (perTableStatements.get(qualified) ?? 0) + m.ok.length);
      perTableFiles.set(qualified, (perTableFiles.get(qualified) ?? 0) + 1);
    }
  }

  // Every listed pair must have been reached (a pair whose table never appears
  // is a zero-span refusal, not a silently absent row in the census).
  for (const e of entries) {
    const { prep } = readFile(e.file);
    if (prep.error) continue; // already refused above
    const m = matchOf(e.file, e.qualified);
    if (m.ok.length === 0) {
      refuse(io, {
        file: e.file,
        table: e.qualified,
        reason:
          m.body.length > 0
            ? `the only INSERT INTO ${e.qualified} in this file is inside a dollar-quoted body at line ${m.body[0].line} (C1)`
            : `no top-level literal INSERT INTO ${e.qualified} found, but the allowlist pins ${e.count}`,
      });
      bad = 1;
    }
  }
  if (bad) return 1;

  const sorted = Array.from(perTableStatements.keys()).sort();
  const width = sorted.reduce((w, t) => Math.max(w, t.length), 0);
  io.out.push(
    "extract-reference-inserts --audit",
    `  allowlist:            ${rel(allowlistPath)}`,
    `  migrations:           ${rel(migrationsDir)}`,
    `  migrations scanned:   ${scanned}`,
    "  ── the census, so the allowlist masthead can be compared without arithmetic ──",
    `  entries:              ${entries.length}`,
    `  files named:          ${files.size}`,
    `  tables named:         ${tables.size}`,
    `  pinned statements:    ${pinnedSum}`,
    "  ── measured per table: statements / files ──",
  );
  for (const t of sorted) {
    io.out.push(
      `  ${t.padEnd(width)}  ${String(perTableStatements.get(t)).padStart(3)} / ${perTableFiles.get(t)}`,
    );
  }
  io.out.push(
    `extract-reference-inserts audit OK: ${entries.length} entr(ies), ${files.size} file(s), ${tables.size} table(s), ${pinnedSum} statement(s); every pinned count re-measured, no unlisted top-level reference INSERT.`,
  );
  return 0;
}

// ───────────────────────────────────────────────────────────────────────────
// Mode: --self-test. Every refusal kind fires on its RED fixture corpus and
// stays silent on its GREEN twin. A leg that fires for the WRONG reason is a
// failure, not a pass — the `expect` string is what distinguishes them.
// ───────────────────────────────────────────────────────────────────────────

/**
 * ⛔ THE SELF-TEST CORPUS IS RATCHETED, in the TWO LAYERS this repo already uses
 * for `scripts/mutation-runner/run.mjs` (see CLAUDE.md, "Two floors, two
 * layers"). Until 2026-09-09 `SELF_TEST_KINDS.length` was PRINTED and compared
 * to NOTHING: deleting the `c1-dollar-body` kind — the leg that falsifies
 * RESEARCH A4, i.e. the one proving `maskSql` splits DO bodies at inner `;` and
 * that `dollarBodyRanges()` is the correct independent scan — still printed
 * `self-test OK: 15 kinds` and exited 0, green in both workflows. A corpus that
 * can shrink to nothing without a single red is not a control.
 *
 *   layer 1 (HERE): `selfTest()` refuses when the corpus is BELOW this floor,
 *     so a deletion reddens CI with no vitest involved. By construction a floor
 *     set below the corpus is invisible to it —
 *   layer 2: `src/__tests__/extract-reference-inserts-selftest-floor.test.ts`
 *     catches exactly that stale-LOW direction (`RATCHET STALE: …`) and pins
 *     the load-bearing kind IDs by name, so a delete-one-add-one nets zero on
 *     the count and still reddens.
 *
 * MEASURED 2026-09-09 on a clean tree: `extract-reference-inserts self-test OK:
 * 16 kinds, red+green each.`, exit 0. Raise this constant when the corpus grows
 * durably; never lower it to clear a red.
 */
export const SELF_TEST_KINDS_FLOOR = 19;

/**
 * @type {Array<{id:string, why:string, audit?:boolean, expect:string, greenStdout?:RegExp, greenAbsent?:RegExp}>}
 */
export const SELF_TEST_KINDS = [
  {
    id: "c1-dollar-body",
    why: "an allowlisted (file, table) whose only INSERT sits inside a DO body (C1). ⛔ This is RESEARCH A4's falsifier: remove insideBody() and this leg goes GREEN while a fixture INSERT becomes replayable.",
    expect: "inside a dollar-quoted body",
  },
  {
    id: "c2-on-conflict-do-update",
    why: "an ON CONFLICT arm that is not DO NOTHING MUTATES a pre-existing row, and `auth.users` survives the restore (C2, WR-05)",
    expect: "the ON CONFLICT action is not DO NOTHING",
  },
  {
    id: "quoted-identifier-head",
    why: "the baseline.sql quoted spelling `INSERT INTO \"public\".\"t\"` must be CLASSIFIED, not silently skipped; the red leg pins that the head regex still discriminates by table (WR-06)",
    expect: "no top-level literal INSERT INTO public.fx_ref found, but the allowlist pins 1",
    greenStdout: /INSERT INTO "public"\."fx_ref"/,
  },
  {
    id: "cte-prefixed-insert",
    why: "`WITH … INSERT INTO t` does not start with INSERT, so it evades the head regex; it must be REFUSED by name rather than skipped in silence (WR-06)",
    expect: "CTE-prefixed INSERT",
  },
  {
    id: "c2-insert-select",
    why: "INSERT ... SELECT is a backfill of existing data (C2)",
    expect: "carries a SELECT/FROM token",
  },
  {
    id: "c2-nonliteral-tuple",
    why: "a bare identifier in the VALUES tuple is not a literal (C2)",
    expect: "non-literal token",
    greenStdout: /gen_random_uuid\(\)/,
  },
  {
    id: "count-mismatch-high",
    why: "pinned 2, measured 1 — both numbers printed",
    expect: "pins 2 top-level statement(s) but 1 were measured",
  },
  {
    id: "count-mismatch-low",
    why: "pinned 1, measured 2 — the ratchet bites in BOTH directions",
    expect: "pins 1 top-level statement(s) but 2 were measured",
  },
  {
    id: "zero-span",
    why: "an allowlisted (file, table) with no qualifying statement at all",
    expect: "no top-level literal INSERT INTO",
  },
  {
    id: "dollar-tag-in-span",
    why: "an emitted span carrying a $-tag would put a body into the replay section",
    expect: "carries a dollar-quoted body",
  },
  {
    id: "unterminated-statement",
    why: "a trailing INSERT with no `;` must never be emitted half-sliced",
    expect: "not terminated by",
  },
  {
    id: "malformed-line",
    why: "a malformed allowlist line is NAMED, never skipped",
    expect: "TAB-separated fields",
  },
  {
    id: "no-consumer",
    why: "C4 has no machine check, so the entry must cite its consumer",
    expect: "carries no `# <consumer>`",
  },
  {
    id: "unknown-migration",
    why: "an allowlist line naming a file that is not in the corpus",
    expect: "is not a migration under",
  },
  {
    id: "bad-schema",
    why: "C3 — a target outside `public` (the auth.users exception is named, not open)",
    expect: "targets a schema outside",
  },
  {
    id: "unterminated-quote",
    why: "a file maskSql cannot lex is UNAUDITED, not clean",
    expect: "could not be lexed",
  },
  {
    id: "txn-control",
    why: "Pitfall 7 — a file managing its own BEGIN/COMMIT contributes ONLY its INSERT span. RED pins 3 (what a wholesale take would find); GREEN pins 1 and its stdout carries no transaction control.",
    expect: "pins 3 top-level statement(s) but 1 were measured",
    greenStdout: /INSERT INTO fx_ref/,
    greenAbsent: /^(BEGIN|COMMIT);/m,
  },
  {
    id: "audit-unlisted",
    why: "--audit: a migration gains a top-level reference INSERT with no allowlist line",
    audit: true,
    expect: "NO allowlist line",
  },
  {
    id: "audit-count-drift",
    why: "--audit: a pinned count stops matching the file it pins",
    audit: true,
    expect: "were measured — an applied migration was edited",
  },
];

function runLeg(kind, colour) {
  const dir = join(REPO_ROOT, FIXTURE_DIR, `${kind.id}.${colour}`);
  const argv = [
    fileURLToPath(import.meta.url),
    "--allowlist",
    join(dir, "allowlist.txt"),
    "--migrations",
    join(dir, "migrations"),
  ];
  if (kind.audit) argv.push("--audit");
  const r = spawnSync(process.execPath, argv, { encoding: "utf8" });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function selfTest(io) {
  let bad = 0;
  const fail = (msg) => {
    io.err.push(`SELF-TEST FAIL: ${msg}`);
    bad = 1;
  };
  if (SELF_TEST_KINDS.length < SELF_TEST_KINDS_FLOOR) {
    fail(
      `SELF_TEST_KINDS_FLOOR regression: the corpus declares ${SELF_TEST_KINDS.length} kind(s), below the pinned floor of ${SELF_TEST_KINDS_FLOOR}. A refusal kind was deleted — restore it, or lower the floor DELIBERATELY in review with the reason. Clearing this by lowering the floor retires the control the deletion just removed.`,
    );
  }
  for (const kind of SELF_TEST_KINDS) {
    const red = runLeg(kind, "red");
    if (red.code !== 1) {
      fail(`${kind.id}.red exited ${red.code}, expected 1 — the refusal did not fire.`);
    } else if (!red.stderr.includes(kind.expect)) {
      fail(
        `${kind.id}.red exited 1 but its message does not carry "${kind.expect}" — a leg that fires for the WRONG reason is not evidence. Got: ${red.stderr.trim().split("\n")[0]}`,
      );
    }
    const green = runLeg(kind, "green");
    if (green.code !== 0) {
      fail(
        `${kind.id}.green exited ${green.code}, expected 0 — the refusal fires on a corpus it must accept. Got: ${green.stderr.trim().split("\n")[0]}`,
      );
      continue;
    }
    if (kind.greenStdout && !kind.greenStdout.test(green.stdout)) {
      fail(`${kind.id}.green stdout does not match ${kind.greenStdout} — the green leg proved nothing.`);
    }
    if (kind.greenAbsent && kind.greenAbsent.test(green.stdout)) {
      fail(`${kind.id}.green stdout matches ${kind.greenAbsent}, which it must NOT.`);
    }
  }
  if (bad === 0) {
    io.out.push(
      `extract-reference-inserts self-test OK: ${SELF_TEST_KINDS.length} kinds, red+green each.`,
    );
  }
  return bad;
}

// ───────────────────────────────────────────────────────────────────────────
// CLI.
// ───────────────────────────────────────────────────────────────────────────

export function runCli(argv) {
  const io = makeIo();
  let allowlist = DEFAULT_ALLOWLIST;
  let migrations = DEFAULT_MIGRATIONS;
  let audit = false;
  let self = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--allowlist") allowlist = argv[++i] ?? "";
    else if (a === "--migrations") migrations = argv[++i] ?? "";
    else if (a === "--audit") audit = true;
    else if (a === "--self-test") self = true;
    else {
      io.err.push(
        `extract-reference-inserts: unknown argument "${a}". See the header for usage.`,
      );
      return { code: 1, io };
    }
  }
  if (self && audit) {
    io.err.push("extract-reference-inserts: --self-test and --audit are separate modes.");
    return { code: 1, io };
  }
  if (self) return { code: selfTest(io), io };
  if (!allowlist || !migrations) {
    io.err.push("extract-reference-inserts: --allowlist and --migrations each need a value.");
    return { code: 1, io };
  }
  const code = audit ? modeAudit(io, allowlist, migrations) : modeEmit(io, allowlist, migrations);
  return { code, io };
}

function main(argv) {
  const { code, io } = runCli(argv);
  if (io.out.length) process.stdout.write(`${io.out.join("\n")}\n`);
  if (io.err.length) process.stderr.write(`${io.err.join("\n")}\n`);
  return code;
}

// ⛔ [164.8.1-02, Rule 1] THE MAIN GUARD COMPARES REAL PATHS, NOT SPELLINGS.
// MEASURED 2026-09-09: `import.meta.url` is the module's REALPATH, while
// `process.argv[1]` is whatever the caller typed. On macOS `mktemp -d` hands back
// `/var/folders/…` and `/var` is a symlink to `/private/var`, so a string compare
// of the two was FALSE for every copy of this script under a temp dir — and this
// file then exited 0 having emitted NOTHING. Green, having done nothing, from a
// tool whose whole job is to produce the SQL a restore replays. `realpathSync` on
// both sides is the fix; the `try` keeps a deleted or unreadable argv[1] from
// turning a comparison into a crash at module load.
const samePath = (a, b) => {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
};
// ⛔ [164.8.1 review, finding 2] AND A GUARD THAT MATCHES NOTHING IS LOUD.
// The realpath fix above closed the symlink SPELLING, but not the failure MODE:
// any `argv[1]` that names this file and still fails both comparisons falls off
// the end of the module and the process exits 0 having emitted NOTHING — and
// the two CI steps that run this script asserted only its exit code, so a
// silent no-op satisfied both. So the entry decision is now three-way, not two.
//
// HOW AN IMPORT IS TOLD FROM A PROGRAM, and how it was MEASURED (2026-09-09,
// node v25 and node 22 on this checkout):
//   * `process.argv[1]` ABSENT ⇒ node was handed no script to run, so this
//     module was reached through `--eval` / `--import` / the REPL / a loader —
//     it CANNOT be the entry point. Silent, no exit. MEASURED: `node -e
//     "process.argv"` prints a one-element argv, and ci.yml already relies on
//     this exact property to read constants out of a sibling script with
//     `node -e` ("`node -e` leaves `process.argv[1]` undefined, so importing the
//     module does not trip its CLI entry point").
//   * `argv[1]` present and NOT naming this file (vitest's binary, another
//     script) ⇒ a normal import. Silent, no exit — this is how
//     src/__tests__/ imports `SELF_TEST_KINDS`.
//   * `argv[1]` present and its BASENAME is ours while neither path comparison
//     matches ⇒ we were invoked as a program and could not recognise ourselves.
//     That is the incident above, and there is no third reading of it. Diagnose
//     to stderr and exit 2 — a code distinct from the `refuse()` exit 1, so a
//     harness fault is never read as a classification refusal.
const ENTRY = process.argv[1];
if (ENTRY !== undefined) {
  const self = fileURLToPath(import.meta.url);
  if (resolve(ENTRY) === resolve(self) || samePath(ENTRY, self)) {
    // `process.exitCode`, not `process.exit()`: writes to a PIPE are asynchronous
    // in node, and exiting on the next tick can drop buffered bytes. The paths that
    // matter most redirect to files (synchronous) — but the two bare
    // `run: node scripts/extract-reference-inserts.mjs --self-test|--audit` steps
    // write into the Actions log pipe, and `exit 1 with no reason printed` is
    // precisely the "could not measure is never a pass" mode this file is built
    // around (review finding WR-10). Setting the code lets the event loop drain.
    process.exitCode = main(process.argv.slice(2));
  } else if (basename(resolve(ENTRY)) === basename(self)) {
    process.stderr.write(
      [
        "extract-reference-inserts: REFUSING TO EXIT SILENTLY. This module was invoked as a program " +
          `("${basename(self)}" is the entry point's own basename) but the entry point does not resolve to this file, ` +
          "so the CLI never ran and NOTHING was emitted.",
        `  entry (process.argv[1]): ${ENTRY}`,
        `  this module:             ${self}`,
        "  Exit 0 here would be a restore replaying an EMPTY reference-data section while every migration reads as applied.",
      ].join("\n") + "\n",
    );
    process.exit(2);
  }
}
