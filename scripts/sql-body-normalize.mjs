#!/usr/bin/env node
/**
 * The SINGLE shared SQL-body normalizer + comparator (Phase 164.3, D-05).
 *
 * ── THE DEFECT CLASS THIS EXISTS FOR ───────────────────────────────────────
 * A body assertion that matches on RAW text compares a claim to something that
 * is not the thing. MEASURED 2026-08-28: PROD's 7-param
 * `_enqueue_compute_job_internal` reports 0 occurrences of `INTO STRICT` in
 * code but 1 when comments are counted. A pre-flight gate written against the
 * raw text would have ABORTED a PROD deploy over a token that only exists in a
 * comment. That is mechanism 2 on this phase's own defect list.
 *
 * Formatting is the same trap from the other side: `pg_get_functiondef` and
 * `pg_dump` re-render a function's signature (lower-cased types, a `public.`
 * prefix, `$function$` instead of `$$`) while reproducing the BODY verbatim
 * from `prosrc`. Comparing whole rendered statements would therefore report
 * drift on every function forever — a gate that always fires is exactly as
 * useless as one that never can, and it gets switched off just as fast.
 *
 * So: extract the dollar-quoted body, strip comments, collapse whitespace,
 * compare THAT. One implementation, two callers —
 *   • scripts/prod-body-drift-check.sh   (VAC-04, repo snapshot vs PROD)
 *   • scripts/test-ledger-drift-check.sh (VAC-08, repo snapshot vs TEST)
 *
 * ── SCOPE BOUNDARY ─────────────────────────────────────────────────────────
 * This module does TEXT only. It opens no database, reads no secret, and
 * prints no body text in any reporting mode (`--diff-bodies` emits names,
 * argument counts, sha256 hashes and differing-line counts — nothing else).
 * That is a hard requirement, not a preference: this repository is PUBLIC and
 * a PROD body can contain a surgical patch that exists nowhere in it.
 *
 * ── KNOWN LIMITATIONS, STATED RATHER THAN HIDDEN ───────────────────────────
 * 1. The scanner is string-aware, so `--` inside a single-quoted or
 *    dollar-quoted literal is NOT stripped. Backslash escapes are honored only
 *    for `E'...'` strings (which is Postgres' own rule under
 *    standard_conforming_strings=on). A `U&'...'` string with a custom UESCAPE
 *    is not modelled; none exist in this corpus.
 * 2. A function with no dollar-quoted body (`LANGUAGE sql ... RETURN expr`,
 *    or `AS 'body'`) is reported `UNCOMPARABLE`, never `MATCH`. Callers MUST
 *    fail closed on it. Reporting a pass for something that was not compared
 *    is the precise defect this phase exists to make impossible.
 * 3. Overloads are matched by (name, body hash), not by argument list. An
 *    argument-only change with an identical body reads as MATCH + SNAPSHOT_ONLY
 *    rather than DRIFT; `nargs` is reported so the difference is visible.
 *
 * ── USAGE (CI pastes these verbatim — mode identity, see 164.3-RESEARCH §Q5) ─
 *   node scripts/sql-body-normalize.mjs --normalize [file]        # stdin if no file
 *   node scripts/sql-body-normalize.mjs --hash [file]
 *   node scripts/sql-body-normalize.mjs --function-names <file...>
 *   node scripts/sql-body-normalize.mjs --extract-fn <file> <name>
 *   node scripts/sql-body-normalize.mjs --diff-bodies <snapshot.sql> <live.sql>
 *   node scripts/sql-body-normalize.mjs --self-test
 */
import { readFileSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** True for characters that may appear in an unquoted SQL identifier. */
function isIdentChar(ch) {
  return /[A-Za-z0-9_$]/.test(ch);
}

/**
 * Single-pass lexer over SQL text.
 *
 * Returns:
 *  - `stripped`: the text with comments removed and every string literal kept
 *    verbatim. Block comments collapse to ONE space (they are token
 *    separators: `a/*c*\/b` must not become `ab`); line comments vanish and
 *    their newline is preserved so line structure survives.
 *  - `masked`: the SAME LENGTH as the input, with comment bodies and string
 *    CONTENTS replaced by spaces (newlines preserved). Delimiters are kept.
 *    Index-preserving, so a regex match on `masked` points at real code in the
 *    original — this is what makes "ignore a CREATE OR REPLACE FUNCTION that
 *    sits inside a comment" mechanical rather than hopeful.
 *  - `dollarRegions`: every top-level dollar-quoted string, with the offsets of
 *    its content. Nested dollar quotes inside a body are part of that body.
 */
export function scanSql(sql) {
  const stripped = [];
  const masked = new Array(sql.length);
  const dollarRegions = [];
  const n = sql.length;
  let i = 0;

  const maskRange = (from, to, keepDelims) => {
    for (let k = from; k < to; k++) {
      masked[k] = keepDelims ? sql[k] : sql[k] === "\n" ? "\n" : " ";
    }
  };

  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];

    // -- line comment
    if (ch === "-" && next === "-") {
      const start = i;
      while (i < n && sql[i] !== "\n") i++;
      maskRange(start, i, false);
      continue; // the newline itself is handled by the code path below
    }

    // /* block comment */ — Postgres NESTS these.
    if (ch === "/" && next === "*") {
      const start = i;
      let depth = 0;
      while (i < n) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          depth--;
          i += 2;
          if (depth === 0) break;
        } else {
          i++;
        }
      }
      maskRange(start, i, false);
      stripped.push(" ");
      continue;
    }

    // '...' string literal ('' escapes; \ escapes only for E'...')
    if (ch === "'") {
      const escaped =
        i > 0 &&
        (sql[i - 1] === "E" || sql[i - 1] === "e") &&
        !(i > 1 && isIdentChar(sql[i - 2]));
      const start = i;
      i++;
      while (i < n) {
        if (escaped && sql[i] === "\\") {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      masked[start] = "'";
      maskRange(start + 1, Math.max(start + 1, i - 1), false);
      if (i - 1 > start) masked[i - 1] = sql[i - 1];
      stripped.push(sql.slice(start, i));
      continue;
    }

    // "..." quoted identifier ("" escapes). Kept intact in BOTH outputs: it is
    // a name, not data, and callers read names out of the raw text.
    if (ch === '"') {
      const start = i;
      i++;
      while (i < n) {
        if (sql[i] === '"') {
          if (sql[i + 1] === '"') {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      maskRange(start, i, true);
      stripped.push(sql.slice(start, i));
      continue;
    }

    // $tag$ ... $tag$ dollar-quoted string. `$1` is a positional parameter,
    // not a dollar quote — the tag must be empty or start with a letter/_.
    if (ch === "$") {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const start = i;
        const contentStart = i + tag.length;
        const closeAt = sql.indexOf(tag, contentStart);
        const contentEnd = closeAt === -1 ? n : closeAt;
        const end = closeAt === -1 ? n : closeAt + tag.length;
        dollarRegions.push({ start, tag, contentStart, contentEnd, end });
        maskRange(start, contentStart, true);
        maskRange(contentStart, contentEnd, false);
        maskRange(contentEnd, end, true);
        stripped.push(sql.slice(start, end));
        i = end;
        continue;
      }
    }

    masked[i] = ch;
    stripped.push(ch);
    i++;
  }

  return {
    stripped: stripped.join(""),
    masked: masked.join(""),
    dollarRegions,
  };
}

/** Remove SQL comments, preserving string literals verbatim. */
export function stripSqlComments(sql) {
  return scanSql(sql).stripped;
}

/**
 * The canonical comparison form: comments removed, every whitespace run
 * collapsed to a single space, trimmed. Formatting-only differences vanish.
 */
export function normalizeSql(sql) {
  return stripSqlComments(sql).replace(/\s+/g, " ").trim();
}

/**
 * Line-structured normalization, used ONLY to count differing lines for the
 * `hunks` diagnostic. Never printed as text.
 */
export function normalizeSqlLines(sql) {
  return stripSqlComments(sql)
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 0);
}

/** sha256 of the normalized text. */
export function normalizedHash(sql) {
  return createHash("sha256").update(normalizeSql(sql), "utf8").digest("hex");
}

const FN_RE = /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+/gi;

/** Read a possibly-quoted, possibly-schema-qualified name; return its last part. */
function readQualifiedName(sql, from) {
  let i = from;
  let last = "";
  // The segment BEFORE the last one — i.e. the schema qualifier, when there is
  // one. `name` deliberately stays the last segment (every caller matches on
  // it), but the qualifier has to be recoverable: VAC-04 reads a PROD dump
  // taken with `--schema public`, so a `CREATE FUNCTION private.f(...)` in a
  // migration is invisible to that dump and would otherwise be classified
  // "absent in PROD — a NEW function (pass)". Losing the schema here is what
  // made that misclassification unavoidable downstream.
  let prev = "";
  for (;;) {
    while (i < sql.length && /\s/.test(sql[i])) i++;
    if (sql[i] === '"') {
      const close = sql.indexOf('"', i + 1);
      if (close === -1) return { name: last, schema: prev, end: i };
      prev = last;
      last = sql.slice(i + 1, close);
      i = close + 1;
    } else {
      const start = i;
      while (i < sql.length && /[A-Za-z0-9_]/.test(sql[i])) i++;
      if (i === start) return { name: last, schema: prev, end: i };
      prev = last;
      last = sql.slice(start, i);
    }
    if (sql[i] === ".") {
      i++;
      continue;
    }
    return { name: last, schema: prev, end: i };
  }
}

/**
 * Refuse rather than silently narrow. [VAC04-C4]
 *
 * The thrown error carries a `charsetRefusal` marker so `main()` can format a
 * diagnostic for THIS condition while any other error stays a loud crash — a
 * blanket catch would turn an internal fault into a formatted pass, which is
 * the same defect class from the other side.
 */
function charsetRefusal(sql, offset, prefix) {
  const cp = sql.codePointAt(offset);
  const detail = {
    line: sql.slice(0, offset).split("\n").length,
    prefix,
    offender: String.fromCodePoint(cp),
    codepoint: `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`,
  };
  const err = new Error(
    `identifier leaves the unquoted charset [A-Za-z0-9_$]: read '${detail.prefix}' then hit '${detail.offender}' (${detail.codepoint}) at line ${detail.line}`,
  );
  err.charsetRefusal = detail;
  return err;
}

/** Count top-level (depth-0) commas in an already-masked argument list. */
function countArgs(maskedArgs) {
  if (maskedArgs.trim() === "") return 0;
  let depth = 0;
  let commas = 0;
  for (const ch of maskedArgs) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === "," && depth === 0) commas++;
  }
  return commas + 1;
}

/**
 * Extract every `CREATE [OR REPLACE] FUNCTION` in `sql`.
 *
 * Each entry: { name, nargs, bodyKind: "dollar" | "none", body, hash, text }.
 * `text` is the raw statement (used only by --extract-fn, whose output is
 * redirected to a workspace file and never echoed).
 */
export function extractFunctionDefs(sql) {
  const { masked, dollarRegions } = scanSql(sql);
  const defs = [];
  FN_RE.lastIndex = 0;
  const starts = [];
  for (let m = FN_RE.exec(masked); m !== null; m = FN_RE.exec(masked)) {
    starts.push({ stmtStart: m.index, afterKeyword: m.index + m[0].length });
  }

  for (let s = 0; s < starts.length; s++) {
    const { stmtStart, afterKeyword } = starts[s];
    const nextStart =
      s + 1 < starts.length ? starts[s + 1].stmtStart : sql.length;
    // R2-I05: one call, one destructuring. This parsed the same input twice to
    // pick different fields off it.
    const { end: afterName, name, schema } = readQualifiedName(sql, afterKeyword);

    let j = afterName;
    while (j < sql.length && /\s/.test(masked[j])) j++;

    // ⛔ REFUSE RATHER THAN DROP. `readQualifiedName`'s ident loop is
    // `/[A-Za-z0-9_]/`, so it stops at the first byte outside that set and the
    // `(` test below then DROPS the whole definition — silently, exit 0.
    // MEASURED 2026-09-01: `public.fúnc_é(p uuid)` printed nothing at all,
    // while the naive member printed the truncated `f`. Either way VAC-04 loses
    // the real subject: the name is absent from the index, so the function is
    // classified "absent from PROD, therefore NEW, therefore a pass".
    //
    // The tell is the FOLLOWER byte in MASKED text (masked, so a block comment
    // butted against the name — `foo/*c*/(…)` — is a space here and stays
    // legal). A name that really ended is followed by EOF, whitespace, or `(`.
    //
    // ⭐ `$` IS EXEMPT, and that exemption is load-bearing in three ways:
    //   1. `$` is inside Postgres' unquoted-identifier charset, so hitting one
    //      is NOT a charset violation — it is this reader stopping early.
    //   2. That early stop is SP-C05's measured limitation and the entire
    //      reason sql-function-names-naive.mjs exists: it reads
    //      `sanitize_user$v2`, this member cannot, and the caller unions them.
    //   3. The drop-not-refuse behavior is machine-pinned by
    //      drift-check-scripts.test.ts's "the two readings genuinely DISAGREE"
    //      arm. Refusing `$` would break the union's design — and its e2e gate
    //      arms — while claiming to harden it.
    // So a `$` follower falls through to the DROP below, exactly as before.
    const follower = masked[j];
    if (
      follower !== undefined &&
      !/\s/.test(follower) &&
      follower !== "(" &&
      follower !== "$"
    ) {
      throw charsetRefusal(sql, j, schema ? `${schema}.${name}` : name);
    }

    if (masked[j] !== "(") continue; // not a function definition we can parse
    let depth = 0;
    let close = -1;
    for (let k = j; k < sql.length; k++) {
      if (masked[k] === "(") depth++;
      else if (masked[k] === ")") {
        depth--;
        if (depth === 0) {
          close = k;
          break;
        }
      }
    }
    if (close === -1) continue;
    const nargs = countArgs(masked.slice(j + 1, close));

    const region = dollarRegions.find(
      (r) => r.start > close && r.start < nextStart,
    );
    const searchFrom = region ? region.end : close + 1;
    const semi = masked.indexOf(";", searchFrom);
    const stmtEnd =
      semi !== -1 && semi < nextStart
        ? semi + 1
        : Math.min(region ? region.end : nextStart, nextStart);

    const bodyKind = region ? "dollar" : "none";
    const body = region
      ? sql.slice(region.contentStart, region.contentEnd)
      : "";
    defs.push({
      name,
      /** "" when the definition is unqualified. See readQualifiedName. */
      schema,
      nargs,
      bodyKind,
      body,
      hash: bodyKind === "dollar" ? normalizedHash(body) : null,
      text: sql.slice(stmtStart, stmtEnd),
    });
  }
  return defs;
}

/** Multiset line difference — a magnitude, never content. */
function hunkCount(a, b) {
  const left = normalizeSqlLines(a);
  const right = normalizeSqlLines(b);
  const pool = new Map();
  for (const l of right) pool.set(l, (pool.get(l) ?? 0) + 1);
  let onlyLeft = 0;
  for (const l of left) {
    const c = pool.get(l) ?? 0;
    if (c > 0) pool.set(l, c - 1);
    else onlyLeft++;
  }
  let onlyRight = 0;
  for (const c of pool.values()) onlyRight += c;
  return onlyLeft + onlyRight;
}

/**
 * Compare the committed snapshot (left) against a live definition dump (right).
 *
 * Statuses:
 *  - MATCH            live body equals a committed body after normalization
 *  - DRIFT            live body matches nothing committed → the gate's target
 *  - SNAPSHOT_MISSING live has a function the snapshot has no body for (stale
 *                     snapshot — fail loud, the snapshot workflow should have
 *                     caught it)
 *  - SNAPSHOT_ONLY    committed body with no live counterpart (advisory: an
 *                     overload not deployed yet, or one dropped upstream)
 *  - UNCOMPARABLE     a body could not be extracted on one side → callers fail
 *                     closed; this is NEVER a pass
 */
export function diffFunctionBodies(snapshotSql, candidateSql) {
  const snapDefs = extractFunctionDefs(snapshotSql);
  const candDefs = extractFunctionDefs(candidateSql);
  const used = new Set();
  const rows = [];

  for (const cand of candDefs) {
    if (cand.bodyKind !== "dollar") {
      rows.push({
        status: "UNCOMPARABLE",
        name: cand.name,
        nargs: cand.nargs,
        side: "live",
      });
      continue;
    }
    const snaps = snapDefs.filter((d) => d.name === cand.name);
    if (snaps.length === 0) {
      rows.push({
        status: "SNAPSHOT_MISSING",
        name: cand.name,
        nargs: cand.nargs,
        candidateHash: cand.hash,
      });
      continue;
    }
    const comparable = snaps.filter((d) => d.bodyKind === "dollar");
    if (comparable.length === 0) {
      rows.push({
        status: "UNCOMPARABLE",
        name: cand.name,
        nargs: cand.nargs,
        side: "snapshot",
      });
      continue;
    }
    const exact = comparable.find((d) => d.hash === cand.hash && !used.has(d));
    if (exact) {
      used.add(exact);
      rows.push({
        status: "MATCH",
        name: cand.name,
        nargs: cand.nargs,
        snapshotHash: exact.hash,
        candidateHash: cand.hash,
        hunks: 0,
      });
      continue;
    }
    let best = null;
    let bestHunks = Infinity;
    for (const d of comparable) {
      if (used.has(d)) continue;
      const h = hunkCount(d.body, cand.body);
      if (h < bestHunks) {
        best = d;
        bestHunks = h;
      }
    }
    if (!best) {
      best = comparable[0];
      bestHunks = hunkCount(best.body, cand.body);
    }
    used.add(best);
    rows.push({
      status: "DRIFT",
      name: cand.name,
      nargs: cand.nargs,
      snapshotHash: best.hash,
      candidateHash: cand.hash,
      hunks: bestHunks,
    });
  }

  for (const d of snapDefs) {
    if (used.has(d)) continue;
    if (candDefs.some((c) => c.name === d.name) || candDefs.length === 0) {
      rows.push({
        status: "SNAPSHOT_ONLY",
        name: d.name,
        nargs: d.nargs,
        snapshotHash: d.hash,
      });
    }
  }
  return rows;
}

/** TSV row: status, name, nargs, snapshotHash, candidateHash, hunks. */
export function formatDiffRow(r) {
  return [
    r.status,
    r.name,
    r.nargs,
    r.snapshotHash ?? "-",
    r.candidateHash ?? "-",
    r.hunks ?? "-",
  ].join("\t");
}

// ── CLI ────────────────────────────────────────────────────────────────────

function readInput(file) {
  return file ? readFileSync(file, "utf8") : readFileSync(0, "utf8");
}

/**
 * Format a [VAC04-C4] charset refusal and return the CLI exit code.
 *
 * ⛔ Identifier-and-position facts ONLY — never the source line, never any
 * slice of a function body. This module's index mode runs over a PROD dump
 * inside a PUBLIC CI log; echoing context here would defeat the "prints no
 * body text in any reporting mode" contract in this file's header.
 *
 * Anything without the marker RETHROWS: an internal fault must stay a loud
 * crash rather than becoming a tidy exit code.
 */
function reportCharsetRefusal(err, file) {
  if (!err?.charsetRefusal) throw err;
  const r = err.charsetRefusal;
  console.error(
    `::error::sql-body-normalize: ${file}:${r.line}: identifier leaves the unquoted charset [A-Za-z0-9_$] — read '${r.prefix}' then hit '${r.offender}' (${r.codepoint}). ` +
      "Refusing rather than dropping: a dropped definition is absent from the function-name index, so VAC-04 classifies it 'absent from PROD, therefore NEW, therefore a pass'. " +
      'Quote the identifier ("...") if that character is intended.',
  );
  return 1; // 2 stays reserved for usage errors.
}

/**
 * Read `file` and extract its definitions for a reporting mode. Returns
 * `{ defs }` on success, or `{ exit }` carrying `reportCharsetRefusal`'s exit
 * code when the charset refusal fired — and, through that function, RETHROWS
 * anything without the marker. The three index/fetch modes below share this
 * shell so the marker-checked rethrow is spelled once.
 */
function defsOrExit(file) {
  try {
    return { defs: extractFunctionDefs(readFileSync(file, "utf8")) };
  } catch (err) {
    return { exit: reportCharsetRefusal(err, file) };
  }
}

function selfTest() {
  const checks = [];
  const assert = (cond, msg) => checks.push({ cond: Boolean(cond), msg });

  const body = "BEGIN\n  -- note: INTO STRICT was here\n  RETURN 1;\nEND";
  assert(
    body.includes("INTO STRICT"),
    "fixture must contain the token before stripping",
  );
  assert(
    !normalizeSql(body).includes("INTO STRICT"),
    "D-05: a comment-only token must not survive normalization",
  );
  assert(
    normalizeSql("SELECT /* a */ 1;") === normalizeSql("SELECT\n\n1;"),
    "block comments and whitespace must normalize away",
  );
  assert(
    normalizeSql("SELECT 'a -- b';").includes("-- b"),
    "a `--` inside a string literal must survive",
  );
  assert(
    normalizeSql("SELECT 1;") !== normalizeSql("SELECT 2;"),
    "differing CODE must NOT normalize equal",
  );
  const snap =
    "CREATE OR REPLACE FUNCTION public.f(a INT) RETURNS INT LANGUAGE plpgsql AS $$ BEGIN RETURN 1; END $$;";
  const live =
    "CREATE OR REPLACE FUNCTION public.f(a integer) RETURNS integer LANGUAGE plpgsql AS $function$ BEGIN RETURN 2; END $function$";
  assert(
    diffFunctionBodies(snap, snap).every((r) => r.status === "MATCH"),
    "identical input must be MATCH",
  );
  assert(
    diffFunctionBodies(snap, live).some((r) => r.status === "DRIFT"),
    "a changed body must be DRIFT (this comparator can fail)",
  );
  assert(
    extractFunctionDefs("-- CREATE OR REPLACE FUNCTION g()").length === 0,
    "a commented mention is not a def",
  );
  // ⛔ [VAC04-C4] regression pin. This input produced NO definition at all and
  // exit 0, so VAC-04 read "absent from PROD — a NEW function — pass".
  let refusedNonAscii = false;
  try {
    extractFunctionDefs(
      "CREATE OR REPLACE FUNCTION public.fúnc_é(p uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN END; $$;",
    );
  } catch (err) {
    refusedNonAscii = Boolean(err?.charsetRefusal);
  }
  assert(
    refusedNonAscii,
    "an UNQUOTED identifier leaving [A-Za-z0-9_$] must be REFUSED, not dropped — a dropped definition is absent from the name index, so the gate cannot tell 'new function' from 'could not read it' ([VAC04-C4])",
  );

  const failed = checks.filter((c) => !c.cond);
  for (const f of failed) console.error(`SELF-TEST FAIL: ${f.msg}`);
  if (failed.length > 0) return 1;
  console.log(`sql-body-normalize self-test OK (${checks.length} checks)`);
  return 0;
}

function main(argv) {
  const mode = argv[0] ?? "--normalize";
  switch (mode) {
    case "--normalize":
      process.stdout.write(normalizeSql(readInput(argv[1])) + "\n");
      return 0;
    case "--hash":
      process.stdout.write(normalizedHash(readInput(argv[1])) + "\n");
      return 0;
    case "--function-names": {
      const files = argv.slice(1);
      if (files.length === 0) {
        console.error("::error::--function-names requires at least one file");
        return 2;
      }
      const names = new Set();
      for (const f of files) {
        const r = defsOrExit(f);
        if (r.exit !== undefined) return r.exit;
        for (const d of r.defs) names.add(d.name);
      }
      for (const nm of [...names].sort()) process.stdout.write(nm + "\n");
      return 0;
    }
    case "--function-qualified-names": {
      // Same scan as --function-names, but emits `schema<TAB>name` so a caller
      // can tell WHICH schema a definition targets. VAC-04 needs it: its PROD
      // dump is `--schema public`, and a definition in another schema is
      // absent from that dump for a reason that has nothing to do with the
      // function being new.
      const files = argv.slice(1);
      if (files.length === 0) {
        console.error("::error::--function-qualified-names requires at least one file");
        return 2;
      }
      const seen = new Set();
      for (const f of files) {
        const r = defsOrExit(f);
        if (r.exit !== undefined) return r.exit;
        for (const d of r.defs) seen.add(`${d.schema}\t${d.name}`);
      }
      for (const row of [...seen].sort()) process.stdout.write(row + "\n");
      return 0;
    }
    case "--extract-fn": {
      const [, file, name] = argv;
      if (!file || !name) {
        console.error("::error::--extract-fn requires <file> <function-name>");
        return 2;
      }
      const r = defsOrExit(file);
      if (r.exit !== undefined) return r.exit;
      for (const d of r.defs.filter((d) => d.name === name))
        process.stdout.write(d.text.trimEnd() + "\n");
      return 0;
    }
    case "--diff-bodies": {
      const [, snapFile, liveFile] = argv;
      if (!snapFile || !liveFile) {
        console.error(
          "::error::--diff-bodies requires <snapshot.sql> <live.sql>",
        );
        return 2;
      }
      const snapSql = readFileSync(snapFile, "utf8");
      const liveSql = readFileSync(liveFile, "utf8");
      let rows;
      try {
        rows = diffFunctionBodies(snapSql, liveSql);
      } catch (err) {
        if (!err?.charsetRefusal) throw err;
        // Attribute the refusal to a FILE — "one of these two" is not a
        // diagnostic. Re-parsing the snapshot alone says which side threw.
        let which = liveFile;
        try {
          extractFunctionDefs(snapSql);
        } catch {
          which = snapFile;
        }
        return reportCharsetRefusal(err, which);
      }
      for (const r of rows) process.stdout.write(formatDiffRow(r) + "\n");
      // Always 0: this mode REPORTS. The calling gate decides the verdict, so
      // that the acknowledgment-pragma policy lives in exactly one place.
      return 0;
    }
    case "--self-test":
      return selfTest();
    default:
      console.error(
        `::error::unknown mode '${mode}'. See the header of ${import.meta.url} for usage.`,
      );
      return 2;
  }
}

// Run only when invoked directly, NOT when imported — drift-check-scripts.test.ts
// and sql-body-normalize.test.ts import this module's exports, and importing
// must not trigger main's exit. Hence the `!process.argv[1]` guard.
//
// ⛔ Compare REALPATHS. The previous form compared `import.meta.url` to a raw
// `file://` + argv[1] concatenation, and MEASURED 2026-09-01 that was false on
// TWO ordinary invocation shapes: a symlinked path (import.meta.url is
// realpath-resolved, argv[1] is not) and a path containing a space
// (import.meta.url percent-encodes it, the concatenation does not). In both,
// main() never ran, stdout was empty, and the process exited 0 — VAC-04 reading
// NOTHING while reporting success. [VAC04-C2]
//
// This function is DUPLICATED verbatim in scripts/sql-function-names-naive.mjs
// rather than shared. That is deliberate: these two readers are VAC-04's two
// supposedly independent derivations, and the defect above was ONE mechanism
// failing BOTH. A shared guard module would rebuild exactly that coupling.
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
