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
 * script REQUIRES but cannot evaluate. C5 (Phase 164.9.2) is a separately pinned
 * class: a top-level LITERAL UPDATE on a `public` table an INSERT line fills,
 * spelled `update:<n>` (replayed) or `decline:<n>` (non-literal, accounted for
 * and never replayed) in field 3. Emit order is (migration basename, byte
 * offset) across both classes; UPDATE blocks never feed `-- refdata-expect:`.
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
 * Field 3 spells the entry's CLASS as well as its pinned count (Phase 164.9.2):
 *   `<n>`          kind `insert`  — C1-C4, unchanged grammar;
 *   `update:<n>`   kind `update`  — C5, top-level literal UPDATEs replayed;
 *   `decline:<n>`  kind `decline` — C5, top-level NON-literal UPDATEs accounted
 *                                   for by name and never replayed.
 */
const COUNT_RE = /^(?:(update|decline):)?([1-9][0-9]*)$/;

/**
 * @returns {{ entries: Array<{lineNo:number,file:string,qualified:string,schema:string,table:string,count:number,consumer:string,kind:"insert"|"update"|"decline"}>, malformed: Array<{lineNo:number,reason:string}> }}
 */
export function parseAllowlist(text) {
  const entries = [];
  const malformed = [];
  // ⛔ At most ONE `update:` and ONE `decline:` line per (file, table): two lines
  // of one kind would double-pin a single measured count (plan-checker I2). One of
  // EACH is legal — a file can hold a literal and a joined UPDATE on one table.
  const c5Seen = new Map(); // `${kind}|${file}|${qualified}` -> first lineNo
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
    const cm = COUNT_RE.exec(countRaw);
    const kind = cm ? (cm[1] ?? "insert") : null;
    if (kind === "update" || kind === "decline") {
      // ⛔ C5 is `public` ONLY. The C3 `auth.users` exception is INSERT-only and
      // does not carry over: auth.users SURVIVES the DROP, so a replayed UPDATE
      // there would mutate shared TEST's live row, not a row the replay just wrote.
      if (q[1] !== "public") {
        bad(
          `field 2 "${qualified}" is on a C5 ${kind}: line, and C5 targets public only — ${qualified} survives the restore's DROP, so an UPDATE replayed there would mutate a live row on shared TEST rather than a row the replay just wrote. The auth.users exception is C3's and is INSERT-only`,
        );
        continue;
      }
    } else if (!schemaAllowed(qualified)) {
      bad(
        `field 2 "${qualified}" targets a schema outside \`public\` — the restore drops ONLY public, so rows elsewhere survive and need no replay (C3). The ONE exception is auth.users in the teaser file; it is documented in the allowlist header`,
      );
      continue;
    }
    if (!cm) {
      bad(
        `field 3 "${countRaw.slice(0, 20)}" is not a positive integer statement count (spelled <n> for an INSERT line, update:<n> or decline:<n> for a C5 line)`,
      );
      continue;
    }
    if (!consumer.startsWith("#") || consumer.replace(/^#+/, "").trim().length === 0) {
      bad(
        `field 4 carries no \`# <consumer>\` — C4 is the criterion a machine cannot check, so the entry must cite the FK, CHECK, slug lookup or app constant that reads the row`,
      );
      continue;
    }
    if (kind !== "insert") {
      const key = `${kind}|${file}|${qualified}`;
      if (c5Seen.has(key)) {
        bad(
          `duplicate C5 line: a second ${kind}: line for ${file} ${qualified} (the first is line ${c5Seen.get(key)}). One (file, table) carries at most one ${kind}: line, because two would double-pin one measured count`,
        );
        continue;
      }
      c5Seen.set(key, lineNo);
    }
    entries.push({
      lineNo,
      file,
      qualified,
      schema: q[1],
      table: q[2],
      count: Number(cm[2]),
      consumer,
      kind,
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
 * Each range carries a THIRD element: the offset of the top-level statement the
 * body opens in (just past the previous top-level `;`). `prepareFile` reads the
 * masked text between it and the body to tell a `DO` body — which the migration
 * EXECUTES — from a `CREATE FUNCTION` body, which it only defines (164.9.2
 * review WR-02 item 2 / SFH-02).
 *
 * @returns {{ ranges: Array<[number, number, number]> } | { error: string, line: number }}
 */
export function dollarBodyRanges(src) {
  const n = src.length;
  const ranges = [];
  const lineAt = (idx) => src.slice(0, idx).split("\n").length;
  let stmtStart = 0;
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
        ranges.push([i, close + tag.length, stmtStart]);
        i = close + tag.length;
        continue;
      }
    }
    if (c === ";") stmtStart = i + 1;
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
    if (ALLOWED_CALLS.has(t.toLowerCase()) && /^[\t\n\r\f\v ]*\(/.test(region.slice(m.index + t.length)))
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
  // The dollar bodies a migration EXECUTES at apply time: a body whose enclosing
  // top-level statement starts with DO (comments and strings are blanked in the
  // masked text, so a leading comment cannot hide the keyword).
  const doBodies = dq.ranges
    .filter((r) => new RegExp(`^${WS}*DO(?![A-Za-z0-9_])`, "i").test(masked.code.slice(r[2], r[0])))
    .map((r) => ({ start: r[0], end: r[1] }));
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
  return { spans, lineOf, doBodies, code: masked.code };
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

// ⛔ PostgreSQL's whitespace is [ \t\n\r\f\v], and every head regex in this file
// used `[\t\n ]` until 2026-09-25 (164.9.2 review WR-02 item 3). MEASURED at
// 838312df3: `UPDATE\r\npublic.profiles SET …` and `DELETE\r\nFROM fx_ref;`
// classified as ok 0, rejected 0, and `matchOtherDml` returned [] — a CRLF
// migration vanished from C5 AND from the DML refusal, with the census still
// reading clean. Not `\s`: that also admits Unicode spaces PostgreSQL does not.
const WS = "[\\t\\n\\r\\f\\v ]";

function headRe(schema, table) {
  const pfx =
    schema === "public"
      ? `(?:${quotedId("public")}${WS}*\\.${WS}*)?`
      : `${quotedId(schema)}${WS}*\\.${WS}*`;
  return new RegExp(
    `^INSERT${WS}+INTO${WS}+${pfx}${quotedId(table)}(?![A-Za-z0-9_])`,
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
      ? `(?:${quotedId("public")}${WS}*\\.${WS}*)?`
      : `${quotedId(schema)}${WS}*\\.${WS}*`;
  return new RegExp(
    `^WITH\\b[\\s\\S]*\\bINSERT${WS}+INTO${WS}+${pfx}${quotedId(table)}(?![A-Za-z0-9_])`,
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
  // 164.9.2 review WR-02 item 1: an `ON CONFLICT … DO UPDATE` arm is an UPDATE
  // effect on an existing row, so `--audit` refuses it even on an UNLISTED pair,
  // where the INSERT side otherwise skips a non-literal as a backfill.
  const upsertRe = new RegExp(`\\bON${WS}+CONFLICT\\b[\\s\\S]*\\bDO${WS}+UPDATE\\b`, "i");
  for (const s of prep.spans) {
    const upsert = !s.inBody && upsertRe.test(s.masked);
    if (!re.test(s.masked)) {
      if (!s.inBody && cteRe.test(s.masked)) {
        rejected.push({
          line: s.line,
          upsert,
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
      rejected.push({ line: s.line, upsert, reason: "the statement is not terminated by `;`" });
      continue;
    }
    if (s.hasTag) {
      rejected.push({
        line: s.line,
        upsert,
        reason:
          "the statement carries a dollar-quoted body — the replay section is kept body-free so the restore's redaction grep has nothing to find",
      });
      continue;
    }
    const why = literalCheck(s.masked);
    if (why) {
      rejected.push({ line: s.line, upsert, reason: why });
      continue;
    }
    // `first` is the byte offset of the statement's first token: the emit sorts
    // on (basename, first), never on allowlist-line order (Phase 164.9.2, C5).
    ok.push({ line: s.line, first: s.first, sql: src.slice(s.first, s.end + 1) });
  }
  return { ok, body, rejected };
}

// ───────────────────────────────────────────────────────────────────────────
// C5 — TOP-LEVEL LITERAL UPDATE ON A REPLAYED PUBLIC TABLE (Phase 164.9.2).
// The allowlist header carries the criterion text; this is its machine half.
// ───────────────────────────────────────────────────────────────────────────

function targetPfx(schema) {
  return schema === "public"
    ? `(?:${quotedId("public")}${WS}*\\.${WS}*)?`
    : `${quotedId(schema)}${WS}*\\.${WS}*`;
}

function splitQualified(qualified) {
  const dot = qualified.indexOf(".");
  return [qualified.slice(0, dot), qualified.slice(dot + 1)];
}

// ── C5's TOKEN ALLOWLIST (164.9.2 review round 1: CR-01, SFH-01, WR-01) ─────────
// ⛔ WHY AN ALLOWLIST, AND WHY THIS REPLACED A DENYLIST. Until 2026-09-25 this
// check was a DENYLIST: five banned words, a `$`, and a call regex
// `/([A-Za-z_][A-Za-z0-9_]*)[\t\n ]*\(/` with `now` exempt BY NAME. `maskSql`
// keeps quoted identifiers ("Quoted identifiers are CODE, not data"), so in
// `"pg_notify"('c','p')` the character before `(` is `"` and the regex never
// saw a call; in `net.now()` it saw `now(` and exempted it whatever its schema.
// MEASURED at 838312df3, each classified LITERAL (ok 1, rejected []):
//   SET x = "pg_notify"('c','p')            SET x = "net"."http_post"('u')
//   SET x = net.now()                        WHERE id IN (TABLE other_ids)
//   SET x = current_user                     (a niladic session function)
// and `--audit` then told the reviewer to ADD THE update: LINE that replays it
// inside the transaction that COMMITs on shared TEST — a pg_net request queued
// there is sent on commit and cannot be rolled back. C2's `literalCheck` on the
// INSERT side was never exposed: it walks EVERY token of the tuple against a
// permitted set. This is the same shape for an UPDATE, where column references
// are free identifiers and so cannot be enumerated. What CAN be enumerated, and
// is, is everything else a token may be:
//   * a WORD (unquoted identifier) is a column/table/alias reference UNLESS it
//     is followed by `(` (a CALL: admitted only from C5_ALLOWED_CALLS, and never
//     schema-qualified), is a niladic session function (C5_NILADIC), or is a
//     PostgreSQL RESERVED word outside C5_ADMITTED_RESERVED. A reserved word can
//     never be a bare column name, so that set is finite and complete;
//   * a QUOTED identifier is a reference, and followed by `(` is ALWAYS refused;
//   * an OPERATOR must be spelled from C5_ALLOWED_OPS (an operator resolves to a
//     function, so an unknown spelling is an unknown call);
//   * `::` must be followed by a readable type name (skipC5CastType);
//   * numbers and `( ) [ ] , . ;` are structure; ANY other character — a
//     backslash (a psql meta-command), a lone `:` (a psql variable), a
//     non-ASCII byte — is refused, because psql would act on it at replay.
//
// PostgreSQL 17 Appendix C, the key words marked "reserved" (not "reserved
// (can be function or type)"). VALUES is only "non-reserved (cannot be function
// or type)", and is added because `IN (VALUES …)` is a sub-query spelled without
// SELECT (WR-01).
const PG_RESERVED = new Set(
  (
    "ALL ANALYSE ANALYZE AND ANY ARRAY AS ASC ASYMMETRIC BOTH CASE CAST CHECK COLLATE " +
    "COLUMN CONSTRAINT CREATE CURRENT_CATALOG CURRENT_DATE CURRENT_ROLE CURRENT_TIME " +
    "CURRENT_TIMESTAMP CURRENT_USER DEFAULT DEFERRABLE DESC DISTINCT DO ELSE END EXCEPT " +
    "FALSE FETCH FOR FOREIGN FROM GRANT GROUP HAVING IN INITIALLY INTERSECT INTO LATERAL " +
    "LEADING LIMIT LOCALTIME LOCALTIMESTAMP NOT NULL OFFSET ON ONLY OR ORDER PLACING " +
    "PRIMARY REFERENCES RETURNING SELECT SESSION_USER SOME SYMMETRIC SYSTEM_USER TABLE " +
    "THEN TO TRAILING TRUE UNION UNIQUE USER USING VARIADIC WHEN WHERE WINDOW WITH VALUES"
  ).split(" "),
);
/**
 * The reserved words a literal `UPDATE [ONLY] t [[AS] a] SET … WHERE …` carries.
 * The CURRENT_DATE family is admitted for the reason now() is: it is the
 * statement's clock, not another row and not a side effect.
 */
const C5_ADMITTED_RESERVED = new Set(
  (
    "AND OR NOT IN NULL TRUE FALSE DEFAULT ONLY AS WHERE CASE WHEN THEN ELSE END ARRAY " +
    "CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP LOCALTIME LOCALTIMESTAMP"
  ).split(" "),
);
/** Joins, sub-selects and RETURNING: the pre-allowlist message, kept verbatim. */
const C5_JOIN_WORDS = new Set(["FROM", "USING", "SELECT", "RETURNING", "WITH"]);
/** `TABLE t` and `VALUES (…)` are sub-queries spelled without SELECT or FROM (WR-01). */
const C5_SUBQUERY_WORDS = new Set(["TABLE", "VALUES"]);
/**
 * SQL-standard niladic session functions: no parentheses, so they read as column
 * references, and they return the RESTORE session's value, not PROD's (WR-01).
 * Refused unquoted only — `"user"` is a column, `user` is a function.
 */
const C5_NILADIC = new Set([
  "CURRENT_USER",
  "SESSION_USER",
  "USER",
  "CURRENT_ROLE",
  "CURRENT_SCHEMA",
  "CURRENT_CATALOG",
  "SYSTEM_USER",
]);
/**
 * A WORD directly followed by `(` that is NOT a function call: IN (…) is a list,
 * AND / OR / NOT / WHEN / THEN / ELSE / WHERE (…) group an expression, SET (…)
 * is the multi-column assignment head, ANY / ALL / SOME (…) compare against an
 * array, and ROW / COALESCE / NULLIF / GREATEST / LEAST are GRAMMAR constructs,
 * not functions looked up on the search_path. `now` is the one call, and only
 * unqualified and unquoted. Every token inside the parentheses is still walked
 * by the same allowlist, so none of these can smuggle a call or a sub-query in.
 *
 * ⛔ lower() / upper() are deliberately NOT here (review WR-03 proposed them):
 * they are real functions resolved on the search_path, and the replay runs
 * under `SET LOCAL search_path = public, pg_catalog`, so a `public.lower` would
 * win. The grammar constructs above have no such lookup.
 */
const C5_ALLOWED_CALLS = new Set([
  "IN",
  "AND",
  "OR",
  "NOT",
  "WHEN",
  "THEN",
  "ELSE",
  "WHERE",
  "SET",
  "ANY",
  "ALL",
  "SOME",
  "ROW",
  "COALESCE",
  "NULLIF",
  "GREATEST",
  "LEAST",
  "NOW",
]);

/**
 * Phrases whose reserved words are not what they look like, blanked (length-
 * preserving) before the walk. `IS [NOT] DISTINCT FROM` is a comparison
 * operator, not a join; `WITH[OUT] TIME ZONE` is part of a type name, not a
 * CTE. Refusing either sent a LITERAL UPDATE to a `decline:` line (review
 * WR-03 / SFH-03) — the outcome decision D-02 forbids.
 */
const C5_BLANKED_PHRASES = [
  /\bIS[\t\n\r\f\v ]+(?:NOT[\t\n\r\f\v ]+)?DISTINCT[\t\n\r\f\v ]+FROM\b/gi,
  /\bWITH(?:OUT)?[\t\n\r\f\v ]+TIME[\t\n\r\f\v ]+ZONE\b/gi,
];
/** Built-in comparison, arithmetic, concatenation, pattern and jsonb operators. */
const C5_ALLOWED_OPS = new Set(
  "= <> != < > <= >= + - * / % || ~ ~* !~ !~* -> ->> #> #>> @> <@ ? ?| ?&".split(" "),
);
const C5_OP_CHARS = /^[+\-*/<>=~!@#%^&|`?]+/;

/** PostgreSQL's lexer rule: a multi-char operator ending in + or - sheds it unless it holds ~!@#%^&|`?. */
function c5OperatorAllowed(op) {
  let o = op;
  for (;;) {
    if (C5_ALLOWED_OPS.has(o)) return true;
    if (o.length > 1 && /[+-]$/.test(o) && !/[~!@#%^&|`?]/.test(o)) {
      o = o.slice(0, -1);
      continue;
    }
    return false;
  }
}

/** Tokenise a MASKED statement. String interiors are already blanked. */
export function c5Tokens(s) {
  const toks = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/[\t\n\r\f\v ]/.test(c)) {
      i++;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < s.length) {
        if (s[j] === '"') {
          if (s[j + 1] === '"') {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      toks.push({ k: "qid", v: s.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    const rest = s.slice(i);
    let m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (m) {
      toks.push({ k: "word", v: m[0] });
      i += m[0].length;
      continue;
    }
    m = /^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/.exec(rest);
    if (m) {
      toks.push({ k: "num", v: m[0] });
      i += m[0].length;
      continue;
    }
    if (rest.startsWith("::")) {
      toks.push({ k: "cast", v: "::" });
      i += 2;
      continue;
    }
    if ("()[],.;".includes(c)) {
      toks.push({ k: "p", v: c });
      i++;
      continue;
    }
    m = C5_OP_CHARS.exec(rest);
    if (m) {
      toks.push({ k: "op", v: m[0] });
      i += m[0].length;
      continue;
    }
    toks.push({ k: "bad", v: c });
    i++;
  }
  return toks;
}

const isP = (t, v) => t !== undefined && t.k === "p" && t.v === v;
const isName = (t) => t !== undefined && (t.k === "word" || t.k === "qid");

/**
 * `::` then a type: a (qualified) name, VARYING / PRECISION follow-words, an
 * optional numeric typmod `(n[, m])` and `[]` array suffixes. Returns the index
 * of the type's last token, or -1 when the cast is not one C5 can read.
 */
function skipC5CastType(toks, x) {
  let y = x + 1;
  if (!isName(toks[y])) return -1;
  while (isP(toks[y + 1], ".") && isName(toks[y + 2])) y += 2;
  while (toks[y + 1]?.k === "word" && /^(VARYING|PRECISION)$/i.test(toks[y + 1].v)) y++;
  if (isP(toks[y + 1], "(")) {
    let z = y + 2;
    if (toks[z]?.k !== "num") return -1;
    z++;
    if (isP(toks[z], ",")) {
      z++;
      if (toks[z]?.k !== "num") return -1;
      z++;
    }
    if (!isP(toks[z], ")")) return -1;
    y = z;
  }
  while (isP(toks[y + 1], "[")) {
    let z = y + 2;
    if (toks[z]?.k === "num") z++;
    if (!isP(toks[z], "]")) return -1;
    y = z;
  }
  return y;
}

/**
 * C5's literal check, over the MASKED statement (string interiors are already
 * blanked, so what remains is code). Column references in SET and WHERE are
 * admitted — that is the one real difference from C2's VALUES-tuple rule —
 * and every OTHER token must be on the allowlist above.
 * @returns {string|null} the refusal reason, or null when the UPDATE is literal.
 */
export function updateLiteralCheck(masked) {
  if (masked.includes("$")) {
    return "carries a `$` (a dollar-quoted body or a positional parameter) — not a literal C5 update (C5)";
  }
  let text = masked;
  for (const re of C5_BLANKED_PHRASES) text = text.replace(re, (p) => " ".repeat(p.length));
  const toks = c5Tokens(text);
  for (let x = 0; x < toks.length; x++) {
    const t = toks[x];
    const prev = toks[x - 1];
    const next = toks[x + 1];
    const callNext = isP(next, "(");
    if (t.k === "bad") {
      return `carries the character \`${t.v}\` outside a string literal — C5 admits only names, numbers, operators and ( ) [ ] , . ; there, and psql acts on a backslash or a lone colon at replay (C5)`;
    }
    if (t.k === "op") {
      if (c5OperatorAllowed(t.v)) continue;
      return `carries the operator \`${t.v}\`, which is not on C5's operator allowlist — an operator resolves to a function, so an unknown spelling is an unknown call (C5)`;
    }
    if (t.k === "cast") {
      const y = skipC5CastType(toks, x);
      if (y < 0) return "carries a `::` cast whose type C5 cannot read — not a literal C5 update (C5)";
      x = y;
      continue;
    }
    if (t.k === "qid") {
      if (callNext) {
        return `makes the quoted-identifier call \`${t.v}(\` — quoting a function name does not make it a column reference, and no quoted call is replayable (C5)`;
      }
      continue;
    }
    if (t.k !== "word") continue; // num, p
    const up = t.v.toUpperCase();
    if (isP(prev, ".")) {
      // The tail of a qualified name: a column after `alias.` may be any label,
      // a reserved word included. A call here is schema-qualified — `net.now()`
      // is whatever `net` says it is, not pg_catalog's now().
      if (callNext) {
        return `makes the schema-qualified call \`…${t.v}(\` — only an unqualified now() is replayable, and a qualified name is whatever that schema defines (C5)`;
      }
      continue;
    }
    if (C5_JOIN_WORDS.has(up)) {
      return `carries the token ${up} — a joined, sub-selected or RETURNING UPDATE is not a literal C5 update (C5)`;
    }
    if (C5_SUBQUERY_WORDS.has(up)) {
      return `carries the token ${up} — \`TABLE t\` and \`VALUES (…)\` are sub-queries spelled without SELECT or FROM, so the UPDATE's effect would depend on rows other than the ones the replay wrote (C5)`;
    }
    if (C5_NILADIC.has(up)) {
      return `reads the niladic session function ${up} — it takes no parentheses, so it reads like a column reference, but it replays the RESTORE session's value rather than the one PROD had (C5)`;
    }
    if (up === "ARRAY") {
      if (isP(next, "[")) continue;
      return "carries ARRAY without `[` — `ARRAY(…)` is a sub-query constructor, not a literal array (C5)";
    }
    if (callNext) {
      if (C5_ALLOWED_CALLS.has(up)) continue;
      return `makes the non-literal call \`${t.v}(\` — only literals, column references, IN lists and now() are replayable (C5)`;
    }
    if (PG_RESERVED.has(up) && !C5_ADMITTED_RESERVED.has(up)) {
      return `carries the reserved word ${up}, which C5's token allowlist does not admit — a reserved word is never a bare column reference, so it is syntax C5 has not been taught to read (C5)`;
    }
  }
  return null;
}

function updateHeadRe(schema, table) {
  return new RegExp(
    `^UPDATE${WS}+(?:ONLY${WS}+)?${targetPfx(schema)}${quotedId(table)}(?![A-Za-z0-9_])`,
    "i",
  );
}

/** `UPDATE [ONLY] <target> [[AS] alias] SET` — the only head shape C5 replays. */
function updateShapeRe(schema, table) {
  return new RegExp(
    `^UPDATE${WS}+(?:ONLY${WS}+)?${targetPfx(schema)}${quotedId(table)}(?:${WS}+(?:AS${WS}+)?"?[A-Za-z_][A-Za-z0-9_]*"?)?${WS}+SET(?![A-Za-z0-9_])`,
    "i",
  );
}

// A CTE-prefixed data-modifying statement (`WITH x AS (…) UPDATE t …`) does not
// start with UPDATE, so the head regex never sees it. It is refused by name,
// mirroring `cteHeadRe` on the INSERT side (RESEARCH Pitfall 7).
function cteUpdateHeadRe(schema, table) {
  return new RegExp(
    `^WITH\\b[\\s\\S]*\\bUPDATE${WS}+(?:ONLY${WS}+)?${targetPfx(schema)}${quotedId(table)}(?![A-Za-z0-9_])`,
    "i",
  );
}

/**
 * Classify one file's top-level UPDATE spans against one target table.
 * @returns {{ ok: Array, body: Array, rejected: Array }}
 *   ok       — top-level literal UPDATEs, replayable under an `update:` line
 *   body     — hits excluded by C1 (inside a dollar-quoted body)
 *   rejected — top-level hits C5 will not replay. `nonLiteral: true` marks the
 *              ones a `decline:` line may account for; every other rejection
 *              (CTE-prefixed, unterminated, off-shape) is a hard refusal.
 *   doWrites — writes to the table inside a DO body (public tables only); like
 *              a non-literal UPDATE, a `decline:` line accounts for them.
 */
export function matchUpdate(src, prep, qualified) {
  const [schema, table] = splitQualified(qualified);
  const re = updateHeadRe(schema, table);
  const shape = updateShapeRe(schema, table);
  const cteRe = cteUpdateHeadRe(schema, table);
  const ok = [];
  const body = [];
  const rejected = [];
  for (const s of prep.spans) {
    if (!re.test(s.masked)) {
      if (!s.inBody && cteRe.test(s.masked)) {
        rejected.push({
          line: s.line,
          nonLiteral: false,
          reason:
            "the statement is a CTE-prefixed UPDATE (`WITH … UPDATE`) — a CTE can read existing rows, so C5 cannot classify it; classify it by hand rather than let it be skipped in silence (C5)",
        });
      }
      continue;
    }
    if (s.inBody) {
      body.push({ line: s.line });
      continue;
    }
    if (!s.terminated) {
      rejected.push({ line: s.line, nonLiteral: false, reason: "the statement is not terminated by `;`" });
      continue;
    }
    if (!shape.test(s.masked)) {
      rejected.push({
        line: s.line,
        nonLiteral: false,
        reason: `the statement is not of the shape UPDATE [ONLY] ${qualified} [[AS] alias] SET … (C5)`,
      });
      continue;
    }
    if (s.hasTag) {
      rejected.push({
        line: s.line,
        nonLiteral: true,
        reason:
          "the statement carries a dollar-quoted body — the replay section is kept body-free so the restore's redaction grep has nothing to find (C5)",
      });
      continue;
    }
    const why = updateLiteralCheck(s.masked);
    if (why) {
      rejected.push({ line: s.line, nonLiteral: true, reason: why });
      continue;
    }
    ok.push({ line: s.line, first: s.first, sql: src.slice(s.first, s.end + 1) });
  }
  // 164.9.2 review WR-02 item 2 / SFH-02: writes inside a DO body EXECUTE when the
  // migration applies, so they are this pair's business too. PUBLIC tables only:
  // the restore drops `public` and rebuilds it, so a DO-body write there is LOST
  // by a restore; `auth.users` survives the DROP, so a write a DO body made there
  // is still on TEST afterwards and there is nothing to replay. (Measured
  // 2026-09-25: the nine DO-body writes on auth.users in the corpus are all
  // self-test fixtures deleting the uid they created.)
  const doWrites = schema === "public" ? matchDoBodyWrites(prep, qualified) : [];
  return { ok, body, rejected, doWrites };
}

/**
 * Top-level DELETE / TRUNCATE / MERGE on one target table. C5 replays UPDATE
 * only, so `--audit` refuses every hit here on a table an INSERT entry fills.
 * @returns {Array<{line:number, verb:string}>}
 */
export function matchOtherDml(prep, qualified) {
  const [schema, table] = splitQualified(qualified);
  const pfx = targetPfx(schema);
  const id = `${pfx}${quotedId(table)}(?![A-Za-z0-9_])`;
  const heads = [
    ["DELETE", new RegExp(`^DELETE${WS}+FROM${WS}+(?:ONLY${WS}+)?${id}`, "i")],
    [
      "TRUNCATE",
      new RegExp(
        `^TRUNCATE(?:${WS}+TABLE)?${WS}+(?:[^;]*?,${WS}*)?(?:ONLY${WS}+)?${id}`,
        "i",
      ),
    ],
    ["MERGE", new RegExp(`^MERGE${WS}+INTO${WS}+(?:ONLY${WS}+)?${id}`, "i")],
    // 164.9.2 review SFH-02: `COPY t FROM …` writes rows no allowlist line replays.
    ["COPY … FROM", new RegExp(`^COPY${WS}+${id}(?:${WS}*\\([^)]*\\))?${WS}+FROM(?![A-Za-z0-9_])`, "i")],
    [
      "CTE-prefixed DELETE/MERGE",
      new RegExp(
        `^WITH\\b[\\s\\S]*\\b(?:DELETE${WS}+FROM|MERGE${WS}+INTO)${WS}+(?:ONLY${WS}+)?${id}`,
        "i",
      ),
    ],
  ];
  const hits = [];
  for (const s of prep.spans) {
    if (s.inBody) continue;
    for (const [verb, re] of heads) {
      if (re.test(s.masked)) {
        hits.push({ line: s.line, verb });
        break;
      }
    }
  }
  return hits;
}

/**
 * Writes to one target table INSIDE a `DO` body (164.9.2 review WR-02 item 2 /
 * SFH-02). `matchUpdate` files every UPDATE inside a dollar body under `body`
 * and C5 never replays one — right for a `CREATE FUNCTION` body, which the
 * migration only DEFINES, and wrong for a `DO` body, which it EXECUTES. Until
 * 2026-09-25 the two were not told apart, and a `DO $ … UPDATE profiles … $`
 * backfill — this repository's house style for one — passed `--audit` as
 * "0 unaccounted". The scan is unanchored over the masked body (strings are
 * blanked, so dynamic SQL built from a string literal is NOT seen: that limit is
 * printed on the audit's `C5 scope:` line).
 * @returns {Array<{line:number, verb:string}>}
 */
export function matchDoBodyWrites(prep, qualified) {
  const [schema, table] = splitQualified(qualified);
  const id = `${targetPfx(schema)}${quotedId(table)}(?![A-Za-z0-9_])`;
  const pre = '(?<![A-Za-z0-9_$"])';
  const heads = [
    ["UPDATE", `${pre}UPDATE${WS}+(?:ONLY${WS}+)?${id}`],
    ["DELETE", `${pre}DELETE${WS}+FROM${WS}+(?:ONLY${WS}+)?${id}`],
    ["TRUNCATE", `${pre}TRUNCATE(?:${WS}+TABLE)?${WS}+(?:[^;]*?,${WS}*)?(?:ONLY${WS}+)?${id}`],
    ["MERGE", `${pre}MERGE${WS}+INTO${WS}+(?:ONLY${WS}+)?${id}`],
    [
      "INSERT … ON CONFLICT DO UPDATE",
      `${pre}INSERT${WS}+INTO${WS}+${id}[^;]*\\bON${WS}+CONFLICT\\b[^;]*\\bDO${WS}+UPDATE(?![A-Za-z0-9_])`,
    ],
    ["COPY … FROM", `${pre}COPY${WS}+${id}(?:${WS}*\\([^)]*\\))?${WS}+FROM(?![A-Za-z0-9_])`],
  ];
  const hits = [];
  for (const b of prep.doBodies) {
    const text = prep.code.slice(b.start, b.end);
    for (const [verb, src] of heads) {
      const re = new RegExp(src, "gi");
      for (let m; (m = re.exec(text)) !== null; ) hits.push({ line: prep.lineOf(b.start + m.index), verb });
    }
  }
  return hits.sort((a, b) => a.line - b.line);
}

/**
 * THE ONE C5 VERDICT, shared by emit and `--audit` so the two can never
 * disagree. `upd` / `dec` are the pair's `update:` / `decline:` entries (either
 * may be absent; in `--audit` both may be).
 * @returns {{ refusals: Array<{line:number|null, reason:string}>, replay: Array, declined: number }}
 */
export function c5Verdict(m, qualified, upd, dec) {
  const refusals = [];
  const hard = m.rejected.filter((r) => !r.nonLiteral);
  // A decline: line counts EVERY write of this (file, table) C5 will not replay:
  // top-level non-literal UPDATEs AND, since 164.9.2 review WR-02 / SFH-02, the
  // writes a DO body runs at apply time. Neither may pass unaccounted.
  const nonLit = [
    ...m.rejected.filter((r) => r.nonLiteral),
    ...(m.doWrites ?? []).map((h) => ({
      line: h.line,
      nonLiteral: true,
      doBody: true,
      reason: `a DO block runs ${h.verb} on ${qualified} when this migration applies, and C5 never replays a DO body, so a restore commits the row without that write`,
    })),
  ].sort((a, b) => a.line - b.line);
  for (const r of hard) refusals.push({ line: r.line, reason: r.reason });
  const publicOnly = qualified.startsWith("public.");

  // Literal (replayable) spans.
  if (upd) {
    if (m.ok.length !== upd.count) {
      refusals.push({
        line: m.ok[0]?.line ?? m.body[0]?.line ?? null,
        reason:
          m.ok.length === 0 && m.body.length > 0
            ? `the C5 line pins update:${upd.count} but the only UPDATE of ${qualified} in this file is inside a dollar-quoted body at line ${m.body[0].line} (C1)`
            : `the C5 line pins update:${upd.count} top-level statement(s) but ${m.ok.length} were measured. A pinned count moves ONLY when an applied migration is edited — understand the edit, do not re-pin the number`,
      });
    }
  } else {
    for (const s of m.ok) {
      refusals.push({
        line: s.line,
        reason: !publicOnly
          ? `a top-level UPDATE of ${qualified}, which an INSERT entry replays, and C5 targets public only — no allowlist line can account for it, because ${qualified} survives the restore and replaying the UPDATE would mutate a live row on shared TEST. Move the change out of the migration's top level, or take it to review`
          : dec
            ? `a literal UPDATE is replayed, not declined — this (file, table) carries a decline: line but the statement is literal. Add an update: line for it; a decline must never hide a replayable effect (C5)`
            : `NO C5 allowlist line; add an update: line for this top-level literal UPDATE of a table the replay fills, with the reason it matters (C5)`,
      });
    }
  }

  // Non-literal spans.
  if (dec) {
    if (nonLit.length !== dec.count) {
      refusals.push({
        line: nonLit[0]?.line ?? null,
        reason: `the C5 line pins decline:${dec.count} top-level statement(s) but ${nonLit.length} were measured (top-level non-literal UPDATEs plus DO-body writes). A pinned count moves ONLY when an applied migration is edited — understand the edit, do not re-pin the number`,
      });
    }
  } else {
    for (const r of nonLit) {
      refusals.push({
        line: r.line,
        reason: !publicOnly
          ? `a top-level non-literal UPDATE of ${qualified}, and C5 targets public only — no allowlist line can account for it (C5)`
          : upd
            ? r.reason
            : // ⛔ 164.9.2 review WR-03 / SFH-03: this used to say "classify by hand:
              // decline it with a reason", and a classifier over-refusal then walked a
              // replayable UPDATE straight into a decline: line. A decline is for a
              // statement that really reads other rows or calls something.
              r.doBody
              ? `NO C5 allowlist line for a DO-body write C5 will not replay — ${r.reason}. Account for it with a decline: line whose reason says why it reaches no row the replay wrote (a self-test fixture keyed by its own uid, say), or move the write to a top-level literal UPDATE (C5, D-02)`
              : `NO C5 allowlist line for a top-level UPDATE C5 will not replay — ${r.reason}. A decline: line is for a statement that genuinely reads other rows or calls a function (a join, a sub-select, a call); if this statement is literal, the classifier is wrong: fix the classifier, never decline a replayable effect (C5, D-02)`,
      });
    }
  }
  return {
    refusals,
    replay: upd && refusals.length === 0 ? m.ok : [],
    declined: dec && refusals.length === 0 ? nonLit.length : 0,
  };
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
  if (
    parsed.malformed.length === 0 &&
    parsed.entries.length > 0 &&
    !parsed.entries.some((e) => e.kind === "insert")
  ) {
    refuse(io, {
      file: rel(allowlistPath),
      reason:
        "the allowlist carries C5 lines but NO INSERT line. C5 replays UPDATEs onto rows the INSERT replay wrote, so with no INSERT line it replays nothing the restore's count floor can measure — the same defect as an empty allowlist, not a clean run",
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

/**
 * Group the C5 entries by (file, table): each pair carries at most one `update:`
 * and one `decline:` entry (parse refuses a duplicate), and the C5 verdict is a
 * property of the PAIR — a literal span is legal only beside an `update:` line,
 * a non-literal one only beside a `decline:` line.
 * @returns {Map<string, {file:string, qualified:string, upd?:object, dec?:object}>}
 */
function c5Pairs(entries) {
  const pairs = new Map();
  for (const e of entries) {
    if (e.kind === "insert") continue;
    const key = `${e.file}|${e.qualified}`;
    if (!pairs.has(key)) pairs.set(key, { file: e.file, qualified: e.qualified });
    pairs.get(key)[e.kind === "update" ? "upd" : "dec"] = e;
  }
  return pairs;
}

function loadFile(io, migrationsDir, cache, file, qualified) {
  if (!cache.has(file)) {
    const src = readFileSync(join(migrationsDir, file), "utf8");
    cache.set(file, { src, prep: prepareFile(src) });
  }
  const got = cache.get(file);
  if (got.prep.error) {
    refuse(io, {
      file,
      line: got.prep.line,
      table: qualified,
      reason: `the file could not be lexed (${got.prep.error}) — "could not measure" is never a pass`,
    });
    return null;
  }
  return got;
}

/**
 * Classify one C5 (file, table) pair for emit: the replayable UPDATE spans, or
 * null after pushing every refusal. Same `c5Verdict` as `--audit`.
 */
function classifyC5Pair(io, migrationsDir, cache, pair) {
  const got = loadFile(io, migrationsDir, cache, pair.file, pair.qualified);
  if (!got) return null;
  const m = matchUpdate(got.src, got.prep, pair.qualified);
  const v = c5Verdict(m, pair.qualified, pair.upd, pair.dec);
  for (const r of v.refusals) {
    refuse(io, { file: pair.file, line: r.line, table: pair.qualified, reason: r.reason });
  }
  return v.refusals.length > 0 ? null : v;
}

/** Classify one INSERT allowlist entry, pushing every refusal it earns. */
function classifyEntry(io, migrationsDir, cache, e) {
  const got = loadFile(io, migrationsDir, cache, e.file, e.qualified);
  if (!got) return null;
  const { src, prep } = got;
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
  const blocks = []; // {file, first, text}
  const perTable = new Map(); // ⛔ INSERT statements ONLY — see the trailer note below
  const insertEntries = entries.filter((e) => e.kind === "insert");
  let insertN = 0;
  let updateN = 0;
  const updateTables = new Set();
  let bad = 0;
  for (const e of insertEntries) {
    const ok = classifyEntry(io, migrationsDir, cache, e);
    if (!ok) {
      bad = 1;
      continue;
    }
    for (const s of ok) {
      blocks.push({ file: e.file, first: s.first, text: `${s.sql}\n-- refdata: ${e.file}:${s.line} ${e.qualified}` });
    }
    insertN += ok.length;
    perTable.set(e.qualified, (perTable.get(e.qualified) ?? 0) + ok.length);
  }
  // C5. Membership ("the table is one an INSERT entry fills") is NOT checked
  // here, only in `--audit`: the local-stack lane hands this mode a FILTERED
  // allowlist that can legitimately drop the INSERT line while keeping an older
  // UPDATE line (RESEARCH Pitfall 6). Emit checks `public.*` alone (at parse).
  const pairs = Array.from(c5Pairs(entries).values());
  for (const pair of pairs) {
    const v = classifyC5Pair(io, migrationsDir, cache, pair);
    if (!v) {
      bad = 1;
      continue;
    }
    // ⛔ UPDATE blocks carry ONLY a `-- refdata-update:` trailer and add NOTHING
    // to `perTable`. The restore's in-transaction count floor is built from the
    // `-- refdata-expect:` trailers and asserts `count(*) >= expected`; an UPDATE
    // adds no row, so counting one there makes `public.profiles` read SHORT and
    // aborts every restore (RESEARCH Pitfall 2).
    for (const s of v.replay) {
      blocks.push({
        file: pair.file,
        first: s.first,
        text: `${s.sql}\n-- refdata-update: ${pair.file}:${s.line} ${pair.qualified}`,
      });
    }
    updateN += v.replay.length;
    if (v.replay.length > 0) updateTables.add(pair.qualified);
  }
  if (bad) return 1;

  // ⛔ EMIT ORDER IS (migration basename, byte offset), NEVER ALLOWLIST-LINE
  // ORDER. Basename order is the order the migrations ran; within a file, byte
  // offset is authored order. An UPDATE emitted before the INSERT it follows in
  // migration history reaches no row, and the count gates cannot see that.
  blocks.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.first - b.first));

  io.out.push(
    "-- ─────────────────────────────────────────────────────────────────────────",
    "-- Reference-data replay. GENERATED — do not edit, do not commit.",
    "--   generator:  scripts/extract-reference-inserts.mjs",
    `--   allowlist:  ${rel(allowlistPath)}`,
    `--   migrations: ${rel(migrationsDir)}`,
    "-- Each statement below is the ORIGINAL bytes of an allowlisted migration",
    "-- statement, sliced by offset. Nothing is rewritten, re-ordered within a",
    "-- file, or made idempotent here — the idempotence is the migration's own.",
    "-- Blocks run in (migration filename, byte offset) order: INSERTs end with",
    "-- a `-- refdata:` trailer, C5 UPDATEs with a `-- refdata-update:` trailer.",
    "-- ─────────────────────────────────────────────────────────────────────────",
  );
  for (const b of blocks) io.out.push(b.text);
  const tables = Array.from(perTable.keys()).sort();
  for (const t of tables) io.out.push(`-- refdata-expect: ${t}=${perTable.get(t)}`);
  io.err.push(
    `extract-reference-inserts: emitted ${insertN} statement(s) over ${tables.length} table(s) from ${insertEntries.length} allowlist entr(ies).`,
    `extract-reference-inserts: emitted ${updateN} C5 update statement(s) over ${updateTables.size} table(s) from ${pairs.filter((p) => p.upd).length} update: line(s); ${pairs.filter((p) => p.dec).length} decline: line(s) emit nothing.`,
  );
  return 0;
}

// ───────────────────────────────────────────────────────────────────────────
// Mode: --audit. The drift direction a static allowlist cannot see by itself.
// ───────────────────────────────────────────────────────────────────────────

function modeAudit(io, allowlistPath, migrationsDir) {
  const allEntries = loadEntries(io, allowlistPath, migrationsDir);
  if (!allEntries) return 1;
  // The INSERT census below (and its `audit OK:` line) counts INSERT entries
  // ONLY, byte-stable since 164.8.1 (decision D-03). C5 is audited separately.
  const entries = allEntries.filter((e) => e.kind === "insert");

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
        // 164.9.2 review WR-02 item 1: limitation 2 skips an unlisted non-literal
        // INSERT as a backfill of NEW rows, but an `ON CONFLICT … DO UPDATE` arm
        // rewrites an EXISTING replayed row — an UPDATE effect neither the INSERT
        // class nor C5 would otherwise name. It is refused whatever its VALUES.
        for (const r of m.rejected.filter((x) => x.upsert)) {
          refuse(io, {
            file,
            line: r.line,
            table: qualified,
            reason: `a top-level INSERT … ON CONFLICT DO UPDATE on a table the replay fills, with no allowlist line — its DO UPDATE arm rewrites an existing replayed row, which no C5 line can replay; classify it by hand at review`,
          });
          bad = 1;
        }
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

  // ── C5 (Phase 164.9.2). EVERY top-level UPDATE / DELETE / TRUNCATE / MERGE on a
  // table an INSERT entry fills — and, since the 164.9.2 review round 1, every
  // COPY … FROM, unlisted upsert and DO-body write (public tables) — is ACCOUNTED FOR: a literal UPDATE by an
  // `update:` line, a non-literal one by a `decline:` line with its reason, and
  // anything else is a named refusal. The INSERT side's limitation 2 (an
  // unlisted non-literal is skipped in silence) is deliberately NOT carried over.
  // `tables` above is exactly the INSERT-filled set, `auth.users` included, so a
  // top-level UPDATE of `auth.users` is refused: parse refuses any non-public C5
  // line, so no line can account for it.
  const pairs = c5Pairs(allEntries);
  for (const pair of pairs.values()) {
    if (!tables.has(pair.qualified)) {
      for (const e of [pair.upd, pair.dec].filter(Boolean)) {
        refuse(io, {
          file: rel(allowlistPath),
          line: e.lineNo,
          table: e.qualified,
          reason: `a C5 ${e.kind}: line names ${e.qualified}, which NO INSERT entry fills. C5 replays UPDATEs onto rows the replay itself wrote; on a table the replay never fills the UPDATE reaches nothing the restore rebuilt`,
        });
      }
      bad = 1;
    }
  }
  const updCache = new Map(); // `${file}|${qualified}` -> matchUpdate() result
  const c5 = { upd: 0, updFiles: new Set(), updTables: new Set(), dec: 0, decFiles: new Set() };
  const c5PerTable = new Map(); // qualified -> {upd, dec}
  for (const file of corpus) {
    const { src, prep } = readFile(file);
    if (prep.error) continue; // already refused above
    for (const qualified of tables) {
      for (const hit of matchOtherDml(prep, qualified)) {
        refuse(io, {
          file,
          line: hit.line,
          table: qualified,
          reason: `a top-level ${hit.verb} on a table the replay fills, and C5 replays UPDATE only — no allowlist line can account for it; classify it by hand at review`,
        });
        bad = 1;
      }
      const key = `${file}|${qualified}`;
      if (!updCache.has(key)) updCache.set(key, matchUpdate(src, prep, qualified));
      const m = updCache.get(key);
      const pair = pairs.get(key);
      if (!pair && m.ok.length === 0 && m.rejected.length === 0 && m.doWrites.length === 0) continue;
      const v = c5Verdict(m, qualified, pair?.upd, pair?.dec);
      for (const r of v.refusals) {
        refuse(io, { file, line: r.line, table: qualified, reason: r.reason });
        bad = 1;
      }
      if (v.refusals.length > 0) continue;
      const row = c5PerTable.get(qualified) ?? { upd: 0, dec: 0 };
      if (v.replay.length > 0) {
        c5.upd += v.replay.length;
        c5.updFiles.add(file);
        c5.updTables.add(qualified);
        row.upd += v.replay.length;
      }
      if (v.declined > 0) {
        c5.dec += v.declined;
        c5.decFiles.add(file);
        row.dec += v.declined;
      }
      c5PerTable.set(qualified, row);
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
  const c5Sorted = Array.from(c5PerTable.keys()).sort();
  const c5Width = c5Sorted.reduce((w, t) => Math.max(w, t.length), 0);
  io.out.push(
    "  ── C5, measured per table: update statements replayed / declined ──",
    `  C5 lines:             ${allEntries.length - entries.length}`,
    // ⛔ 164.9.2 review WR-02 / SFH-02: "unaccounted" below is counted over THIS
    // scope and no wider. Printed every run so the census cannot be read as more.
    "  C5 scope:             top-level UPDATE / DELETE / TRUNCATE / MERGE / COPY … FROM / INSERT … ON CONFLICT DO UPDATE, and the same writes inside a DO body; NOT traced: a function called at top level, and dynamic SQL built from a string",
  );
  for (const t of c5Sorted) {
    const row = c5PerTable.get(t);
    io.out.push(`  ${t.padEnd(c5Width)}  ${String(row.upd).padStart(3)} / ${row.dec}`);
  }
  // The INSERT `audit OK:` line is byte-stable (D-03) and the C5 census line
  // follows it directly; both workflows parse each by its own prefix.
  io.out.push(
    `extract-reference-inserts audit OK: ${entries.length} entr(ies), ${files.size} file(s), ${tables.size} table(s), ${pinnedSum} statement(s); every pinned count re-measured, no unlisted top-level reference INSERT.`,
    `extract-reference-inserts audit C5 OK: ${c5.upd} update statement(s) over ${c5.updFiles.size} file(s) and ${c5.updTables.size} table(s) replayed; ${c5.dec} declined over ${c5.decFiles.size} file(s); 0 unaccounted.`,
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
 * 19 kinds, red+green each.`, exit 0. Raise this constant when the corpus grows
 * durably; never lower it to clear a red.
 *
 * MEASURED 2026-09-25 (Phase 164.9.2 plan 02, after the C5 kinds landed):
 * `extract-reference-inserts self-test OK: 39 kinds, red+green each.`, exit 0.
 * 19 → 39: twenty C5 kinds, one per C5 refusal reason. Before this raise the
 * layer-2 vitest was observed RED with `RATCHET STALE: … declares 39 … still 19`.
 *
 * MEASURED 2026-09-25 (Phase 164.9.2 review round 1, CR-01 / SFH-01 / WR-01, the
 * token allowlist): `extract-reference-inserts self-test OK: 49 kinds, red+green
 * each.`, exit 0. 39 → 49: ten `c5-update-*` kinds, one per refusal reason the
 * allowlist added. Before this raise the layer-2 vitest was observed RED with
 * `RATCHET STALE: … declares 49 … still 39`.
 *
 * MEASURED 2026-09-25 (review round 1, WR-02 / SFH-02, what "0 unaccounted" could
 * not see): `extract-reference-inserts self-test OK: 53 kinds, red+green each.`,
 * exit 0. 49 → 53: `c5-audit-crlf-head`, `-do-body-write`, `-unlisted-upsert`
 * and `-unlisted-copy`. The layer-2 vitest was observed RED
 * (`declares 53 … still 49`) before this raise.
 */
export const SELF_TEST_KINDS_FLOOR = 53;

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
  // ── C5 (Phase 164.9.2): every C5 refusal reason has a red leg. Emit mode first.
  {
    id: "c5-update-nonliteral",
    why: "C5: an UPDATE ... FROM reads EXISTING rows, which the restore has just dropped, so replaying it would write a value computed from nothing; an update: line over it must refuse, naming the token",
    expect: "carries the token FROM — a joined, sub-selected or RETURNING UPDATE is not a literal C5 update (C5)",
    // 164.9.2 review WR-03 / SFH-03: the green also replays both IS [NOT] DISTINCT
    // FROM idioms; their FROM is an operator, and refusing it sent a replayable
    // UPDATE to a decline: line.
    greenStdout: /UPDATE fx_ref SET label = 'v' WHERE id IN \(1\);[\s\S]*UPDATE fx_ref SET label = 'v' WHERE label IS DISTINCT FROM 'v' AND id = 1;[\s\S]*UPDATE fx_ref SET label = 'w' WHERE label IS NOT DISTINCT FROM 'v';/,
  },
  {
    id: "c5-update-function-call",
    why: "C5: a call inside a replayed UPDATE can carry a side effect (net.http_*, pg_notify) or read session state (current_setting); only now() is admitted. The green leg also pins that `AND (` is a boolean group, not a call (plan 01 deviation 1)",
    expect: "makes the non-literal call `current_setting(`",
    // 164.9.2 review WR-03 / SFH-03: the green also replays ANY/ALL/SOME, ROW,
    // COALESCE/NULLIF/GREATEST/LEAST, SET (a, b) = (...), parenthesised WHERE/THEN
    // and a `timestamp with time zone` cast — literal shapes the denylist refused.
    greenStdout: /UPDATE fx_ref SET label = 'v', seen_at = now\(\) WHERE id = 1 AND \(label = 'a' OR label = 'b'\);[\s\S]*ANY\(ARRAY\[1, 2\]\)[\s\S]*SET \(label, n\) = \('v', 1\) WHERE \(id, n\) = ROW\(1, 2\);[\s\S]*coalesce\(label, 'v'\)[\s\S]*'2026-01-01'::timestamp with time zone WHERE id = 1;/,
  },
  {
    id: "c5-update-positional-param",
    why: "C5: a `$1` outside a string is a positional parameter the replay cannot bind, so the statement is not literal. The green leg pins that a `$` INSIDE a string literal is masked and admitted",
    expect: "carries a `$` (a dollar-quoted body or a positional parameter) — not a literal C5 update (C5)",
    greenStdout: /UPDATE fx_ref SET label = 'costs \$1' WHERE id = 1;/,
  },
  {
    id: "c5-update-dollar-tag",
    why: "C5: a dollar-quoted literal in the SET would put a $-body into the replay section, where the restore's redaction grep must find none",
    expect: "carries a dollar-quoted body — the replay section is kept body-free",
    greenStdout: /UPDATE fx_ref SET label = 'plain' WHERE id = 1;/,
  },
  {
    id: "c5-update-dollar-body",
    why: "C1 for UPDATEs: an update: line whose only UPDATE sits inside a DO body must refuse, never descend into the body and replay it",
    expect: "but the only UPDATE of public.fx_ref in this file is inside a dollar-quoted body at line",
    greenStdout: /UPDATE fx_ref SET label = 'top-level' WHERE id = 1;/,
  },
  {
    id: "c5-update-auth-target",
    why: "C5 is public-only: auth.users survives the restore's DROP, so an UPDATE replayed there mutates a live shared-TEST row. The C3 auth.users exception is INSERT-only",
    expect: "is on a C5 update: line, and C5 targets public only",
    greenStdout: /-- refdata-update: 20260101000000_fx_a\.sql:\d+ public\.fx_ref/,
  },
  {
    id: "c5-cte-prefixed-update",
    why: "C5: `WITH … UPDATE` does not start with UPDATE and its CTE can read existing rows; it must be REFUSED by name rather than skipped in silence",
    expect: "the statement is a CTE-prefixed UPDATE (`WITH … UPDATE`)",
    greenStdout: /UPDATE fx_ref SET label = 'v' WHERE id = 1;/,
  },
  {
    id: "c5-update-off-shape",
    why: "C5: an UPDATE head the shape regex does not know (here the legal `UPDATE t * SET` inheritance spelling) is refused by name, never replayed on a guess. The green leg pins that ONLY and an AS alias are admitted",
    expect: "the statement is not of the shape UPDATE [ONLY] public.fx_ref [[AS] alias] SET … (C5)",
    greenStdout: /UPDATE ONLY fx_ref AS r SET label = 'v' WHERE r\.id = 1;/,
  },
  {
    id: "c5-update-unterminated",
    why: "C5: a trailing UPDATE with no `;` must never be emitted half-sliced (the INSERT side's unterminated-statement leg does not reach the UPDATE path)",
    expect: "20260101000000_fx_a.sql:3 [public.fx_ref]: the statement is not terminated by `;`",
    greenStdout: /UPDATE fx_ref SET label = 'v' WHERE id = 1;/,
  },
  {
    id: "c5-update-count-drift",
    why: "C5: pinned update:2, measured 1. ⛔ The GREEN leg is the ORDER leg: its allowlist lists the UPDATE line FIRST and the earlier file's INSERT line LAST, so only a (basename, offset) sort emits INSERT, UPDATE, then the later file's INSERT. Its greenAbsent refuses any refdata-expect for public.fx_ref other than its INSERT count of 1: an UPDATE adds no row",
    expect: "the C5 line pins update:2 top-level statement(s) but 1 were measured",
    greenStdout: /INSERT INTO fx_ref [\s\S]*UPDATE fx_ref [\s\S]*INSERT INTO fx_ref2/,
    greenAbsent: /^-- refdata-expect: public\.fx_ref=(?!1$)/m,
  },
  {
    id: "c5-duplicate-line",
    why: "C5: two update: lines for one (file, table) would double-pin one measured count. The green leg pins the legal pair: one update: and one decline: line over a file holding a literal and a joined UPDATE, where only the literal one is emitted",
    expect: "duplicate C5 line: a second update: line for",
    greenStdout: /UPDATE fx_ref SET label = 'v' WHERE id = 1;/,
    greenAbsent: /FROM fx_src/,
  },
  {
    id: "c5-no-insert-line",
    why: "C5: an allowlist of C5 lines alone replays no row the restore's count floor can measure, the same defect as an empty allowlist (plan 01 deviation 2)",
    expect: "the allowlist carries C5 lines but NO INSERT line",
    greenStdout: /-- refdata-update: 20260101000000_fx_a\.sql:\d+ public\.fx_ref/,
  },
  // ── C5's token allowlist (164.9.2 review round 1: CR-01, SFH-01, WR-01). One
  // kind per refusal reason the allowlist added; each green twin pins the
  // literal shape the same rule must still ADMIT.
  {
    id: "c5-update-quoted-call",
    why: "C5 (review CR-01): maskSql keeps quoted identifiers, so the denylist's call regex never saw `\"pg_notify\"(` and classified it literal; the audit then advised adding the update: line that would fire it inside a COMMITting transaction on shared TEST. The green leg pins that a quoted COLUMN is still a reference",
    expect: 'makes the quoted-identifier call `"pg_notify"(`',
    greenStdout: /UPDATE fx_ref SET "label" = 'v' WHERE "id" = 1;/,
  },
  {
    id: "c5-update-qualified-now",
    why: "C5 (review SFH-01): the denylist exempted `now` BY NAME, so `net.now()` — any schema's function called now — passed. The green leg pins that an unqualified now() and a qualified COLUMN are still admitted",
    expect: "makes the schema-qualified call `…now(`",
    greenStdout: /UPDATE fx_ref AS r SET seen_at = now\(\) WHERE r\.id = 1;/,
  },
  {
    id: "c5-update-psql-metachar",
    why: "C5: the restore replays through psql, which acts on a backslash (a meta-command) or a lone colon (a variable) outside a string; the token allowlist refuses any character it does not know. The green leg pins that a backslash INSIDE a string is masked and admitted",
    expect: "carries the character `\\` outside a string literal",
    greenStdout: /UPDATE fx_ref SET label = 'a\\b' WHERE id = 1;/,
  },
  {
    id: "c5-update-unknown-operator",
    why: "C5: an operator resolves to a function, so a spelling outside the built-in set is an unknown call. The green leg pins the admitted comparison, arithmetic and concatenation operators, and PostgreSQL's `=-1` split",
    expect: "carries the operator `<=>`, which is not on C5's operator allowlist",
    greenStdout: /UPDATE fx_ref SET label = label \|\| 'v', n = n \+ 1 WHERE id >= 1 AND id <> 2 AND id =-1;/,
  },
  {
    id: "c5-update-unreadable-cast",
    why: "C5: after `::` the allowlist reads a type name and a NUMERIC typmod; anything else in the parentheses is code. The green leg pins qualified, multi-word, typmod'd and array casts",
    expect: "carries a `::` cast whose type C5 cannot read",
    greenStdout: /UPDATE fx_ref SET label = 'v'::character varying\(20\), n = '1'::numeric\(10, 2\), tags = '\{\}'::text\[\], kind = 'k'::public\.fx_kind WHERE id = 1;/,
  },
  {
    id: "c5-update-table-subquery",
    why: "C5 (review WR-01): `IN (TABLE t)` is a sub-query spelled without SELECT or FROM, and `IN (` was exempt from the call ban, so the denylist read it as literal. The green leg pins a literal IN list",
    expect: "carries the token TABLE — `TABLE t` and `VALUES (…)` are sub-queries spelled without SELECT or FROM",
    greenStdout: /UPDATE fx_ref SET label = 'v' WHERE id IN \(1, 2\);/,
  },
  {
    id: "c5-update-values-subquery",
    why: "C5 (review WR-01): `IN (VALUES (…))` is the other sub-query spelled without SELECT or FROM. The green leg pins that the word inside a string, and a QUOTED column named values, are admitted",
    expect: "carries the token VALUES — `TABLE t` and `VALUES (…)` are sub-queries spelled without SELECT or FROM",
    greenStdout: /UPDATE fx_ref SET "values" = 'values' WHERE id IN \(1\);/,
  },
  {
    id: "c5-update-niladic",
    why: "C5 (review WR-01): current_user takes no parentheses, so the denylist read it as a column; it replays the RESTORE session's role, a value PROD never held. The green leg pins that a QUOTED \"user\" column and CURRENT_TIMESTAMP (the statement clock, admitted as now() is) pass",
    expect: "reads the niladic session function CURRENT_USER",
    greenStdout: /UPDATE fx_ref SET "user" = 'v', seen_at = CURRENT_TIMESTAMP WHERE id = 1;/,
  },
  {
    id: "c5-update-array-subquery",
    why: "C5: `ARRAY(…)` is a sub-query constructor; only `ARRAY[…]`, a literal array, is admitted. The green leg pins the literal form",
    expect: "carries ARRAY without `[`",
    greenStdout: /UPDATE fx_ref SET tags = ARRAY\['a', 'b'\] WHERE id = 1;/,
  },
  {
    id: "c5-update-reserved-word",
    why: "C5: a PostgreSQL reserved word is never a bare column reference, so one outside the admitted set is syntax C5 has not been taught to read, and it is refused rather than replayed on a guess. The green leg pins the admitted CASE/WHEN/THEN/ELSE/END, TRUE, NULL and DEFAULT",
    expect: "carries the reserved word COLLATE, which C5's token allowlist does not admit",
    greenStdout: /UPDATE fx_ref SET label = CASE WHEN id = 1 THEN 'a' ELSE 'b' END, flag = TRUE, note = NULL, kind = DEFAULT WHERE id = 1;/,
  },
  // ── C5 in --audit: every top-level UPDATE / DELETE on a replayed table is accounted for.
  {
    id: "c5-decline-literal",
    why: "C5 --audit: a decline: line over a LITERAL UPDATE would hide a replayable effect; a decline is for joins only",
    audit: true,
    expect: "a literal UPDATE is replayed, not declined",
    greenStdout: /audit C5 OK: 0 update statement\(s\) over 0 file\(s\) and 0 table\(s\) replayed; 1 declined over 1 file\(s\); 0 unaccounted\./,
  },
  {
    id: "c5-decline-count-drift",
    why: "C5 --audit: pinned decline:2, measured 1 — a decline count is a pin like any other",
    audit: true,
    expect: "the C5 line pins decline:2 top-level statement(s) but 1 were measured",
    greenStdout: /audit C5 OK: 0 update statement\(s\) over 0 file\(s\) and 0 table\(s\) replayed; 1 declined over 1 file\(s\); 0 unaccounted\./,
  },
  {
    id: "c5-audit-unlisted-update",
    why: "C5 --audit: a migration gains a top-level literal UPDATE on a replayed table with no C5 line — the drift a static list cannot see about itself",
    audit: true,
    expect: "NO C5 allowlist line; add an update: line",
    greenStdout: /audit C5 OK: 1 update statement\(s\) over 1 file\(s\) and 1 table\(s\) replayed; 0 declined over 0 file\(s\); 0 unaccounted\./,
  },
  {
    id: "c5-audit-unlisted-nonliteral-update",
    why: "C5 --audit: an unlisted JOINED UPDATE on a replayed table is refused, not skipped — the INSERT side's limitation 2 (an unlisted non-literal is silent) is deliberately not carried over. Since review WR-03 the refusal no longer advises a decline outright: a decline is for a statement that genuinely reads other rows",
    audit: true,
    expect: "NO C5 allowlist line for a top-level UPDATE C5 will not replay — carries the token FROM",
    greenStdout: /audit C5 OK: 0 update statement\(s\) over 0 file\(s\) and 0 table\(s\) replayed; 1 declined over 1 file\(s\); 0 unaccounted\./,
  },
  {
    id: "c5-audit-unlisted-delete",
    why: "C5 --audit: C5 replays UPDATE only, so a top-level DELETE on a table the replay fills has no line that can account for it. The green leg pins that a DELETE on a table no INSERT entry fills is outside C5",
    audit: true,
    expect: "a top-level DELETE on a table the replay fills, and C5 replays UPDATE only",
    greenStdout: /audit C5 OK: 0 update statement\(s\) over 0 file\(s\) and 0 table\(s\) replayed; 0 declined over 0 file\(s\); 0 unaccounted\./,
  },
  {
    id: "c5-audit-unfilled-table",
    why: "C5 --audit membership: an update: line on a table no INSERT entry fills reaches nothing the restore rebuilt",
    audit: true,
    expect: "which NO INSERT entry fills",
    greenStdout: /audit C5 OK: 1 update statement\(s\) over 1 file\(s\) and 1 table\(s\) replayed; 0 declined over 0 file\(s\); 0 unaccounted\./,
  },
  {
    id: "c5-audit-auth-update",
    why: "C5 --audit: a top-level literal UPDATE of auth.users (which an INSERT entry fills) has no line that can account for it, because C5 is public-only; the green leg is the named remedy, the UPDATE moved out of the top level",
    audit: true,
    expect: "a top-level UPDATE of auth.users, which an INSERT entry replays, and C5 targets public only",
    greenStdout: /audit C5 OK: 0 update statement\(s\) over 0 file\(s\) and 0 table\(s\) replayed; 0 declined over 0 file\(s\); 0 unaccounted\./,
  },
  {
    id: "c5-audit-auth-nonliteral-update",
    why: "C5 --audit: the non-literal twin of c5-audit-auth-update — a joined UPDATE of auth.users is refused by its own reason, never routed to a decline: line that parse would refuse",
    audit: true,
    expect: "a top-level non-literal UPDATE of auth.users, and C5 targets public only",
    greenStdout: /audit C5 OK: 0 update statement\(s\) over 0 file\(s\) and 0 table\(s\) replayed; 0 declined over 0 file\(s\); 0 unaccounted\./,
  },
  // ── What "0 unaccounted" could not see (164.9.2 review round 1, WR-02 / SFH-02).
  {
    id: "c5-audit-crlf-head",
    why: "C5 --audit (review WR-02 item 3): every head regex separated tokens with [\\t\\n ], so `UPDATE\\r\\nfx_ref …` in a CRLF migration matched neither C5 nor the DML refusal and the census still read clean. The green leg pins that the same CRLF UPDATE, with its line, is seen and replayed",
    audit: true,
    expect: "NO C5 allowlist line; add an update: line for this top-level literal UPDATE",
    greenStdout: /audit C5 OK: 1 update statement\(s\) over 1 file\(s\) and 1 table\(s\) replayed; 0 declined over 0 file\(s\); 0 unaccounted\./,
  },
  {
    id: "c5-audit-do-body-write",
    why: "C5 --audit (review WR-02 item 2 / SFH-02): a DO body EXECUTES when its migration applies, and C5 never replays one; its UPDATE of a replayed table used to fall into the body bucket in silence. The green leg accounts for it with decline:1 and pins that an UPDATE inside a CREATE FUNCTION body — defined, never executed — is NOT counted",
    audit: true,
    expect: "NO C5 allowlist line for a DO-body write C5 will not replay — a DO block runs UPDATE on public.fx_ref",
    greenStdout: /audit C5 OK: 0 update statement\(s\) over 0 file\(s\) and 0 table\(s\) replayed; 1 declined over 1 file\(s\); 0 unaccounted\./,
  },
  {
    id: "c5-audit-unlisted-upsert",
    why: "C5 --audit (review WR-02 item 1): an unlisted INSERT … ON CONFLICT DO UPDATE rewrites an EXISTING replayed row, and limitation 2 skipped it as a backfill. The green leg pins that the DO NOTHING twin is still skipped",
    audit: true,
    expect: "a top-level INSERT … ON CONFLICT DO UPDATE on a table the replay fills, with no allowlist line",
    greenStdout: /audit C5 OK: 0 update statement\(s\) over 0 file\(s\) and 0 table\(s\) replayed; 0 declined over 0 file\(s\); 0 unaccounted\./,
  },
  {
    id: "c5-audit-unlisted-copy",
    why: "C5 --audit (review SFH-02): COPY … FROM writes rows no allowlist line replays. The green leg pins that COPY … TO, a read, is not refused",
    audit: true,
    expect: "a top-level COPY … FROM on a table the replay fills, and C5 replays UPDATE only",
    greenStdout: /audit C5 OK: 0 update statement\(s\) over 0 file\(s\) and 0 table\(s\) replayed; 0 declined over 0 file\(s\); 0 unaccounted\./,
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
/**
 * A path fit to PRINT. This repository is public and the Actions log is
 * world-readable, and an absolute path on a developer's machine carries the
 * LOCAL USERNAME in it - so a path that escapes the repository is reduced to
 * its basename rather than printed whole. Resolving a path for OPENING and
 * rendering one for PRINTING are different jobs; this is the printing one.
 * ⛔ Copied deliberately from `scripts/lint-migration-data-dependence.mjs`,
 * where this leak was found and fixed first. It was fixed there and NOT here,
 * in the same phase, from the same idiom - a point fix on a class.
 */
const relPrintable = (p) => {
  const r = relative(REPO_ROOT, String(p));
  return !r || r.startsWith("..") ? `<outside the repository>/${basename(String(p))}` : r;
};
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
        `  entry (process.argv[1]): ${relPrintable(ENTRY)}`,
        `  this module:             ${relPrintable(self)}`,
        "  Exit 0 here would be a restore replaying an EMPTY reference-data section while every migration reads as applied.",
      ].join("\n") + "\n",
    );
    process.exit(2);
  }
}
