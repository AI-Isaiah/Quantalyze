#!/usr/bin/env node
/**
 * The static vacuity linter for `supabase/tests/*.sql` (Phase 164.3, VAC-03).
 *
 * ── THE DEFECT CLASS THIS EXISTS FOR ───────────────────────────────────────
 * Phase 164's review found five distinct mechanisms by which an arm of a SQL
 * gate file was GREEN in CI while proving nothing. Every one of them shipped,
 * passed review, and passed CI. The point of this script is that a SIXTH
 * instance of the statically-detectable shapes, written into a NEW gate file,
 * becomes a lint failure on the pushing developer's machine instead of a
 * red-team finding two phases later.
 *
 * ── HONEST SCOPE (phase decision D-16) ─────────────────────────────────────
 * Of the five measured mechanisms, three are statically detectable, one only
 * narrowly, and one is NOT detectable at all:
 *
 *   1  post-rejection probe inside an EXCEPTION handler   → R1, full
 *   2  pg_get_functiondef regex satisfied by a comment    → R2, full
 *   3  diagnostic arithmetic that overflows when it fires → R3, NARROW only
 *   4  partial tgtype bitmask                             → R4, full
 *   5  arm made unreachable by an earlier arm             → NO RULE. See below.
 *
 * ⛔ There is deliberately NO rule for mechanism 5. Reachability of PL/pgSQL
 * arms is not decidable from the text, so any rule written for it would be a
 * rule that cannot fire — which is precisely the defect this phase exists to
 * eliminate, committed by the phase itself. Mechanism 5's detector is the
 * mutation runner's FIRST-FAILURE IDENTITY assertion (it mutates one arm and
 * requires that the first `TEST FAILED (<ARM ID>)` names that arm; an arm made
 * unreachable by an earlier one cannot satisfy that). `DELEGATED_MECHANISMS`
 * below records this in machine-readable form and
 * `src/__tests__/lint-sql-gates.test.ts` asserts it, so the absence is a
 * checked decision rather than an oversight someone later "fixes".
 *
 * ── RULE-QUALITY GATE ──────────────────────────────────────────────────────
 * Every rule ships with a fixture PAIR under `scripts/lint-sql-gates-fixtures/`
 * — one snippet it MUST flag (`<id>.red.sql`) and one it MUST pass
 * (`<id>.green.sql`, always the repaired idiom quoted from the real gate file).
 * The vitest file runs both for every rule and pins the rule-ID set exactly. A
 * rule without a firing fixture does not merge.
 *
 * ── SCOPE BOUNDARY, stated rather than implied ─────────────────────────────
 * • TEXT ONLY. This script opens no database, reads no secret, and executes no
 *   SQL. It is hermetic: it can never flake.
 * • Reads through `node:fs`, NEVER shell grep. This repo has a MEASURED
 *   grep-blind file (`src/lib/wizardErrors.test.ts` carries a deliberate NUL at
 *   line 1572; ugrep skips the file entirely and its exit 1 reads as "clean").
 *   A vacuity linter that could be silently blinded by a NUL byte would be the
 *   joke it exists to prevent.
 * • "COULD NOT MEASURE" AND "MEASURED ZERO" ARE DIFFERENT ANSWERS. A file whose
 *   comment/string/block structure will not parse is reported as MEASURE_FAIL
 *   and exits 1. It is never counted as a clean file. An empty corpus is
 *   MEASURE_FAIL for the same reason.
 * • PRE-EXISTING VIOLATIONS. VAC-03's remit is NEW gate files; backfilling the
 *   other 70 is Phase 164.4. Findings that already exist are pinned in
 *   `ALLOWLIST` by (file, rule, EXACT COUNT) with a reason. The count is what
 *   stops the allowlist absorbing new violations (T-164.3-15): one more finding
 *   in an allowlisted file still fails, and one fewer fails too, so the ratchet
 *   only tightens.
 *
 * ── USAGE (CI pastes the first line VERBATIM — mode identity, RESEARCH §Q4) ──
 *   node scripts/lint-sql-gates.mjs                  # the real corpus + allowlist
 *   node scripts/lint-sql-gates.mjs --files a.sql b.sql   # ad-hoc, no allowlist
 *   node scripts/lint-sql-gates.mjs --self-test      # the engine's own fixtures
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CORPUS_DIR = join(REPO_ROOT, "supabase", "tests");
export const FIXTURE_DIR = "scripts/lint-sql-gates-fixtures";

// ───────────────────────────────────────────────────────────────────────────
// The rule registry. `src/__tests__/lint-sql-gates.test.ts` pins this set
// EXACTLY: adding an entry reds the suite until its fixture pair exists, and
// removing one reds it immediately.
// ───────────────────────────────────────────────────────────────────────────

export const RULES = [
  {
    id: "R1-exception-handler-probe",
    mechanism: 1,
    title: "verification probe inside an EXCEPTION handler",
    scope:
      "Flags DML (INSERT/UPDATE/DELETE) or SELECT ... INTO appearing INSIDE an " +
      "EXCEPTION WHEN handler block. PL/pgSQL gives each BEGIN...EXCEPTION block an " +
      "implicit subtransaction, so a probe placed in the handler reads the state its " +
      "own rollback just restored and confirms the rejection it was supposed to test " +
      "no matter what the database did. The probe belongs AFTER the block. Lexical " +
      "BEGIN/EXCEPTION/END nesting is sufficient for this corpus; a handler that " +
      "reads through a called function is out of reach and is the runner's job.",
  },
  {
    id: "R2-functiondef-comment-strip",
    mechanism: 2,
    title: "pg_get_functiondef matched without stripping comments",
    scope:
      "Flags a pg_get_functiondef result reaching a regex (~ ~* !~ !~*) or LIKE/ILIKE " +
      "match without passing through the comment-strip idiom " +
      "regexp_replace(..., '--[^\\n]*', '', 'g'). MEASURED: PROD's 7-param " +
      "_enqueue_compute_job_internal contains 0 occurrences of INTO STRICT in code and " +
      "1 in a comment, so a raw-text probe is satisfiable by prose that documents the " +
      "very rule it claims to check. Tracks one assignment hop (SELECT ... INTO v; " +
      "IF v !~ ...), which is the shape the corpus uses; a value laundered through a " +
      "helper function is out of reach.",
  },
  {
    id: "R3-additive-diagnostic-narrow",
    mechanism: 3,
    title: "additive arithmetic on a table-read value inside a diagnostic",
    scope:
      "NARROW BY CONSTRUCTION. Flags `<var> + <n>` where <var> was read from the " +
      "database by a SELECT ... INTO and the arithmetic sits in an assertion condition " +
      "(IF/ELSIF ... THEN) or in a RAISE argument list — the repaired idiom subtracts " +
      "instead (gen - pre IS DISTINCT FROM 1). General overflow-in-diagnostic detection " +
      "is UNDECIDABLE from the text: whether `pre + 1` overflows depends on the runtime " +
      "value, and an arm whose own arithmetic aborts reports `bigint out of range` " +
      "instead of its diagnosis. This rule catches the one shape the corpus was actually " +
      "written into and no more; the mutation runner is the primary net for mechanism 3.",
  },
  {
    id: "R4-tgtype-bitmask-completeness",
    mechanism: 4,
    title: "trigger bitmask test narrower than the claim it makes",
    scope:
      "Flags a pg_trigger.tgtype bitmask test that omits a canonical bit for an event " +
      "named in the adjacent failure message's claim clause (BEFORE|AFTER|INSTEAD OF ... " +
      "FOR EACH ROW|STATEMENT). MEASURED: a `& 16` test alone stayed green after the " +
      "trigger was narrowed to BEFORE UPDATE, because a narrowed trigger satisfies every " +
      "remaining term. Bits: ROW=1, BEFORE=2, INSERT=4, DELETE=8, UPDATE=16, TRUNCATE=32, " +
      "INSTEAD OF=64. A mask test with no adjacent claim clause states nothing to check " +
      "and is left alone rather than guessed at.",
  },
];

/**
 * Mechanisms deliberately NOT given a lint rule, and what does detect them.
 * Machine-readable so the absence is a pinned decision, not an omission.
 */
export const DELEGATED_MECHANISMS = [
  {
    mechanism: 5,
    decision: "D-16",
    title: "arm made structurally unreachable by an earlier arm over the same state",
    detector:
      "The mutation runner's first-failure identity assertion: mutate exactly one arm, " +
      "then require that the FIRST `TEST FAILED (<ARM ID>)` the file raises names THAT " +
      "arm. An arm shadowed by an earlier one covering the same state cannot satisfy it, " +
      "and the shadowing arm is named instead.",
    reason:
      "Reachability of PL/pgSQL arms is not statically decidable. A lint rule for this " +
      "shape could not fire, and a rule that cannot fire is the exact defect this phase " +
      "exists to eliminate — shipping one to round the count up to five would be the " +
      "phase committing its own named defect.",
  },
];

/**
 * Pre-existing findings in the 70 gate files Phase 164.4 will clean up.
 * Keyed by (file, rule) with an EXACT count — see the header's T-164.3-15 note.
 * MEASURED 2026-08-29 by running this linter over the full corpus at HEAD.
 */
export const ALLOWLIST = [
  {
    file: "supabase/tests/test_api_keys_venue_identity_uniq.sql",
    rule: "R2-functiondef-comment-strip",
    count: 6,
    reason:
      "Pre-existing: raw create_wizard_strategy / add_wizard_composite_key bodies matched " +
      "with ~ and LIKE. Deferred to Phase 164.4, which repairs the corpus with the mutation " +
      "runner as its oracle rather than by eye.",
  },
  {
    file: "supabase/tests/test_compute_analytics_kind_retired.sql",
    rule: "R2-functiondef-comment-strip",
    count: 6,
    reason:
      "Pre-existing: matches SECURITY DEFINER / search_path / invalid_parameter_value against " +
      "raw _enqueue_compute_job_internal bodies — the SAME function whose comment-vs-code " +
      "divergence D-05 measured on PROD. Deferred to 164.4.",
  },
  {
    file: "supabase/tests/test_get_verified_cohort_rank_gate.sql",
    rule: "R3-additive-diagnostic-narrow",
    count: 3,
    reason:
      "Pre-existing: `n_after <> n_before + 1` and `+ 2` on a cohort count read from the " +
      "database, in both the condition and the RAISE slot. INT-typed and small, so the " +
      "overflow risk is low — but it is the shape the repaired idiom forbids. Deferred to 164.4.",
  },
  {
    file: "supabase/tests/test_guard_wizard_draft_updates_auth_uid.sql",
    rule: "R2-functiondef-comment-strip",
    count: 4,
    reason:
      "Pre-existing: raw guard_wizard_draft_updates / create_wizard_strategy / " +
      "finalize_wizard_strategy bodies matched with LIKE. Deferred to Phase 164.4.",
  },
  {
    file: "supabase/tests/test_log_audit_event_service_ceiling.sql",
    rule: "R2-functiondef-comment-strip",
    count: 4,
    reason:
      "Pre-existing: raw log_audit_event_service / test_force_hot_to_cold_move bodies matched " +
      "without the comment strip. Deferred to Phase 164.4.",
  },
  {
    file: "supabase/tests/test_retention_crons_safe.sql",
    rule: "R2-functiondef-comment-strip",
    count: 1,
    reason:
      "Pre-existing: one raw retention_delete_guard body match. Deferred to Phase 164.4 with " +
      "the rest of the corpus rather than repaired blind here.",
  },
  {
    file: "supabase/tests/test_sanitize_user_hardening.sql",
    rule: "R2-functiondef-comment-strip",
    count: 6,
    reason:
      "Pre-existing: sanitize_user body matched with NOT LIKE for partner_tag, the " +
      "created_by IS NOT NULL predicate and the auth purge. Each pattern is satisfiable by a " +
      "`--` comment naming the rule. Deferred to Phase 164.4.",
  },
  {
    file: "supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql",
    rule: "R2-functiondef-comment-strip",
    count: 9,
    reason:
      "Pre-existing and the largest single cluster: nine raw matches against " +
      "sync_strategy_analytics_status(uuid). Deferred to Phase 164.4 — repairing nine arms " +
      "blind, without the runner to prove each still reddens, is how a repair becomes a regression.",
  },
  {
    file: "supabase/tests/test_wizard_session_idempotency.sql",
    rule: "R2-functiondef-comment-strip",
    count: 4,
    reason:
      "Pre-existing: raw create_wizard_strategy body matched four ways. Deferred to Phase 164.4.",
  },
];

// ───────────────────────────────────────────────────────────────────────────
// Lexing. Comments and string LITERALS are blanked to spaces (offsets and line
// numbers survive); dollar-quote DELIMITERS are blanked but their interior is
// scanned as code, because in this corpus `$$ ... $$` is the DO block body.
// ───────────────────────────────────────────────────────────────────────────

const DOLLAR_TAG = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/;

/**
 * @returns {{ code: string } | { error: string, line: number }}
 */
function maskSql(src) {
  const out = src.split("");
  const n = src.length;
  const blank = (a, b) => {
    for (let k = a; k < b && k < n; k++) if (out[k] !== "\n") out[k] = " ";
  };
  const lineAt = (idx) => src.slice(0, idx).split("\n").length;

  let i = 0;
  while (i < n) {
    const c = src[i];

    if (c === "-" && src[i + 1] === "-") {
      let j = src.indexOf("\n", i);
      if (j === -1) j = n;
      blank(i, j);
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
      blank(i, j);
      i = j;
      continue;
    }

    if (c === "$") {
      const m = DOLLAR_TAG.exec(src.slice(i, i + 80));
      if (m) {
        blank(i, i + m[0].length);
        i += m[0].length;
        continue;
      }
    }

    if (c === "'") {
      // E'...' honours backslash escapes; a plain '...' does not (Postgres'
      // rule under standard_conforming_strings=on, which is the default).
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
      blank(i, j);
      i = j;
      continue;
    }

    if (c === '"') {
      // Quoted identifiers are CODE, not data — skipped over, never blanked.
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

    i++;
  }
  return { code: out.join("") };
}

/** Word / punctuation tokens of the masked code, with source offsets. */
function tokenize(code) {
  const re = /[A-Za-z_][A-Za-z0-9_]*|;/g;
  const toks = [];
  let m;
  while ((m = re.exec(code)) !== null) {
    toks.push({ text: m[0], upper: m[0].toUpperCase(), index: m.index });
  }
  return toks;
}

const IF_STATEMENT_PREDECESSORS = new Set([";", "THEN", "ELSE", "BEGIN", "LOOP", "DECLARE"]);

/**
 * Lexical PL/pgSQL block structure.
 * @returns {{ handlers: Array<{start:number,end:number}> } | { error: string, line: number }}
 */
function blockStructure(code, lineOf) {
  const toks = tokenize(code);
  const stack = [];
  const handlers = [];

  for (let t = 0; t < toks.length; t++) {
    const tok = toks[t];
    const next = toks[t + 1];
    const prev = toks[t - 1];

    switch (tok.upper) {
      case "BEGIN":
        // `BEGIN;` / `BEGIN TRANSACTION` opens a TRANSACTION, not a PL/pgSQL
        // block, and is never closed by an `END`. Every gate file in this
        // corpus opens with one (MEASURED: 57 of 71 files parsed as unbalanced
        // before this arm existed), so treating it as a block would report
        // MEASURE_FAIL on almost the whole corpus.
        if (next && [";", "TRANSACTION", "WORK", "ISOLATION"].includes(next.upper)) break;
        stack.push({ kind: "block", exceptionAt: null });
        break;
      case "CASE":
        stack.push({ kind: "case", exceptionAt: null });
        break;
      case "LOOP":
        stack.push({ kind: "loop", exceptionAt: null });
        break;
      case "IF":
        // `IF` also appears in `DROP ... IF EXISTS` / `CREATE ... IF NOT EXISTS`,
        // which open no block. Only a statement-position IF does.
        if (!prev || IF_STATEMENT_PREDECESSORS.has(prev.upper)) {
          stack.push({ kind: "if", exceptionAt: null });
        }
        break;
      case "EXCEPTION": {
        // `RAISE EXCEPTION 'msg'` is not a handler section; `EXCEPTION WHEN` is.
        if (!next || next.upper !== "WHEN") break;
        const top = stack[stack.length - 1];
        if (!top || top.kind !== "block") {
          return {
            error: "EXCEPTION WHEN outside a BEGIN block",
            line: lineOf(tok.index),
          };
        }
        top.exceptionAt = tok.index;
        break;
      }
      case "END": {
        const modifier = next && ["IF", "LOOP", "CASE"].includes(next.upper) ? next.upper : null;
        if (stack.length === 0) {
          return { error: "END with no open block", line: lineOf(tok.index) };
        }
        const frame = stack.pop();
        if (modifier) {
          t++; // consume the modifier token
          if (frame.kind !== modifier.toLowerCase()) {
            return {
              error: `END ${modifier} closed a ${frame.kind} block`,
              line: lineOf(tok.index),
            };
          }
        }
        if (frame.kind === "block" && frame.exceptionAt !== null) {
          handlers.push({ start: frame.exceptionAt, end: tok.index });
        }
        break;
      }
      default:
        break;
    }
  }

  if (stack.length > 0) {
    return {
      error: `${stack.length} unclosed block(s) at end of file (${stack.map((f) => f.kind).join(", ")})`,
      line: lineOf(code.length - 1),
    };
  }
  return { handlers };
}

/** Statement spans of the masked code, split on top-level `;`. */
function statements(code) {
  const out = [];
  let start = 0;
  for (let i = 0; i < code.length; i++) {
    if (code[i] === ";") {
      out.push({ start, end: i, text: code.slice(start, i) });
      start = i + 1;
    }
  }
  if (start < code.length) out.push({ start, end: code.length, text: code.slice(start) });
  return out.filter((s) => s.text.trim().length > 0);
}

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

// ───────────────────────────────────────────────────────────────────────────
// Rules
// ───────────────────────────────────────────────────────────────────────────

const DML_PROBES = [
  { re: /\bINSERT\s+INTO\b/i, what: "INSERT" },
  { re: /\bUPDATE\s+[A-Za-z_"][\w".]*\s+SET\b/i, what: "UPDATE" },
  { re: /\bDELETE\s+FROM\b/i, what: "DELETE" },
  { re: /\bSELECT\b[\s\S]*?\bINTO\b/i, what: "SELECT ... INTO" },
];

function ruleR1(ctx, push) {
  for (const handler of ctx.handlers) {
    for (const stmt of ctx.statements) {
      // Statements are CLIPPED to the handler span: the first statement of a
      // handler starts at the `;` that ended the guarded body, i.e. BEFORE the
      // `EXCEPTION` keyword, so plain containment would miss every handler's
      // opening statement — which is the one most likely to hold the probe.
      const lo = Math.max(stmt.start, handler.start);
      const hi = Math.min(stmt.end, handler.end);
      if (hi <= lo) continue;
      const text = ctx.code.slice(lo, hi);
      for (const probe of DML_PROBES) {
        const m = probe.re.exec(text);
        if (!m) continue;
        push(
          "R1-exception-handler-probe",
          lo + m.index,
          `${probe.what} inside an EXCEPTION handler: the implicit subtransaction has already ` +
            `rolled the block back, so this reads the state it is supposed to be verifying was ` +
            `never reached. Move the probe AFTER the END of the block.`,
        );
        break;
      }
    }
  }
}

/** Fresh instance per use — a shared /g regex carries `lastIndex` between callers. */
const matchOpRe = () => /([A-Za-z_][\w]*)\s*(!~\*|!~|~\*|~|NOT\s+I?LIKE|I?LIKE)(?![\w])/gi;

/** Is this pg_get_functiondef call wrapped in a comment-stripping regexp_replace? */
function isCommentStripped(src, code, at) {
  let k = at - 1;
  while (k >= 0 && /\s/.test(code[k])) k--;
  if (k < 0 || code[k] !== "(") return false;
  let j = k - 1;
  while (j >= 0 && /\s/.test(code[j])) j--;
  const head = code.slice(Math.max(0, j - 14), j + 1);
  if (!/regexp_replace$/i.test(head)) return false;
  // The wrapper must strip COMMENTS specifically — a regexp_replace that
  // normalises whitespace is not this idiom. Read the ORIGINAL text of the
  // call so the (masked) pattern literal is visible.
  const open = code.indexOf("(", j);
  let depth = 0;
  let end = open;
  for (let p = open; p < code.length; p++) {
    if (code[p] === "(") depth++;
    else if (code[p] === ")") {
      depth--;
      if (depth === 0) {
        end = p;
        break;
      }
    }
  }
  return /'--/.test(src.slice(open, end + 1));
}

function ruleR2(ctx, push) {
  const rawVars = new Map();
  const strippedVars = new Set();
  const inlineRaw = [];

  const re = /pg_get_functiondef\s*\(/gi;
  let m;
  while ((m = re.exec(ctx.code)) !== null) {
    const at = m.index;
    const stripped = isCommentStripped(ctx.src, ctx.code, at);
    const stmt = ctx.statements.find((s) => at >= s.start && at < s.end) ?? null;
    if (!stmt) continue;
    const after = stmt.text.slice(at - stmt.start);
    const into = /\bINTO\b\s+(?:STRICT\s+)?([A-Za-z_][\w]*)/i.exec(after);
    const assign = /^\s*([A-Za-z_][\w]*)\s*:=/.exec(stmt.text);
    const target = into?.[1] ?? assign?.[1] ?? null;
    if (target) {
      if (stripped) strippedVars.add(target.toLowerCase());
      else rawVars.set(target.toLowerCase(), at);
    }
    if (!stripped) inlineRaw.push({ at, stmt });
  }

  // (A) the raw result feeds a match operator in the very same statement.
  for (const { at, stmt } of inlineRaw) {
    if (!matchOpRe().test(stmt.text)) continue;
    push(
      "R2-functiondef-comment-strip",
      at,
      "pg_get_functiondef result is matched with a regex/LIKE without the comment-strip " +
        "idiom regexp_replace(..., '--[^\\n]*', '', 'g'). The probe is satisfiable by a `--` " +
        "comment inside the body that merely DESCRIBES the rule.",
    );
  }

  // (B) the raw result was stored in a variable that a later arm matches on.
  const opRe = matchOpRe();
  let mm;
  while ((mm = opRe.exec(ctx.code)) !== null) {
    const name = mm[1].toLowerCase();
    if (!rawVars.has(name) || strippedVars.has(name)) continue;
    push(
      "R2-functiondef-comment-strip",
      mm.index,
      `\`${mm[1]}\` holds a RAW pg_get_functiondef body (assigned at line ` +
        `${ctx.lineOf(rawVars.get(name))}) and is matched here without stripping comments. ` +
        "A `--` comment in the body can satisfy the pattern on its own.",
    );
  }
}

function ruleR3(ctx, push) {
  const tableReadVars = new Set();
  for (const stmt of ctx.statements) {
    if (!/\bFROM\b/i.test(stmt.text)) continue;
    const m = /\bSELECT\b[\s\S]*?\bINTO\b\s+(?:STRICT\s+)?([A-Za-z_][\w]*(?:\s*,\s*[A-Za-z_][\w]*)*)/i.exec(
      stmt.text,
    );
    if (!m) continue;
    for (const v of m[1].split(",")) tableReadVars.add(v.trim().toLowerCase());
  }
  if (tableReadVars.size === 0) return;

  const regions = [];
  // Assertion conditions: IF/ELSIF ... THEN
  const condRe = /\b(?:ELSIF|IF)\b/gi;
  let c;
  while ((c = condRe.exec(ctx.code)) !== null) {
    const then = /\bTHEN\b/i.exec(ctx.code.slice(c.index));
    if (!then) continue;
    regions.push({ start: c.index, end: c.index + then.index });
  }
  // Diagnostic argument lists: RAISE ... ;
  for (const stmt of ctx.statements) {
    const r = /\bRAISE\b/i.exec(stmt.text);
    if (r) regions.push({ start: stmt.start + r.index, end: stmt.end });
  }

  const seen = new Set();
  for (const region of regions) {
    const text = ctx.code.slice(region.start, region.end);
    const addRe = /([A-Za-z_][\w]*)\s*\+\s*([A-Za-z_][\w]*|\d+)/g;
    let a;
    while ((a = addRe.exec(text)) !== null) {
      const name = a[1].toLowerCase();
      if (!tableReadVars.has(name)) continue;
      const at = region.start + a.index;
      if (seen.has(at)) continue;
      seen.add(at);
      push(
        "R3-additive-diagnostic-narrow",
        at,
        `\`${a[1]} + ${a[2]}\` computes a diagnostic from a value read out of the database. ` +
          "An arm whose own arithmetic overflows in exactly the state it diagnoses raises " +
          "`bigint out of range` instead of its message — a test that cannot speak. Subtract " +
          "instead: `(after - before) IS DISTINCT FROM 1`.",
      );
    }
  }
}

const TGTYPE_BITS = [
  { bit: 1, event: "ROW", re: /\bFOR EACH ROW\b/ },
  { bit: 2, event: "BEFORE", re: /\bBEFORE\b/ },
  { bit: 2, event: "AFTER", re: /\bAFTER\b/ },
  { bit: 4, event: "INSERT", re: /\bINSERT\b/ },
  { bit: 8, event: "DELETE", re: /\bDELETE\b/ },
  { bit: 16, event: "UPDATE", re: /\bUPDATE\b/ },
  { bit: 32, event: "TRUNCATE", re: /\bTRUNCATE\b/ },
  { bit: 64, event: "INSTEAD OF", re: /\bINSTEAD OF\b/ },
];

/** The claim clause of a failure message, e.g. "BEFORE INSERT OR UPDATE FOR EACH ROW". */
function claimClause(message) {
  const m = /\b(?:BEFORE|AFTER|INSTEAD OF)\b[^.]*?\bFOR EACH (?:ROW|STATEMENT)\b/.exec(message);
  return m ? m[0] : null;
}

function ruleR4(ctx, push) {
  for (let s = 0; s < ctx.statements.length; s++) {
    const stmt = ctx.statements[s];
    if (!/\btgtype\s*&/i.test(stmt.text)) continue;

    const tested = new Set();
    const bitRe = /\btgtype\s*&\s*(\d+)/gi;
    let b;
    while ((b = bitRe.exec(stmt.text)) !== null) tested.add(Number(b[1]));

    // The adjacent failure message is the claim this mask is measured against.
    let message = null;
    for (let k = s + 1; k < ctx.statements.length; k++) {
      const nxt = ctx.statements[k];
      if (nxt.start - stmt.end > 3000) break;
      if (!/\bRAISE\b/i.test(nxt.text)) continue;
      const raw = ctx.src.slice(nxt.start, nxt.end);
      const lit = /'((?:[^']|'')*)'/.exec(raw);
      if (lit) message = lit[1];
      break;
    }
    if (!message) continue;
    const clause = claimClause(message);
    if (!clause) continue;

    const required = new Set();
    for (const spec of TGTYPE_BITS) if (spec.re.test(clause)) required.add(spec.bit);
    const missing = [...required].filter((bit) => !tested.has(bit));
    if (missing.length === 0) continue;

    const names = missing
      .map((bit) => TGTYPE_BITS.filter((x) => x.bit === bit).map((x) => x.event).join("/"))
      .join(", ");
    push(
      "R4-tgtype-bitmask-completeness",
      stmt.start + /\btgtype\s*&/i.exec(stmt.text).index,
      `tgtype mask tests bit(s) {${[...tested].sort((x, y) => x - y).join(", ")}} but the ` +
        `adjacent message claims "${clause}", which needs {${[...required].sort((x, y) => x - y).join(", ")}}. ` +
        `Missing: ${names}. A narrowed trigger satisfies every remaining term, so this arm ` +
        "stays green after exactly the change it exists to catch.",
    );
  }
}

const RULE_FNS = {
  "R1-exception-handler-probe": ruleR1,
  "R2-functiondef-comment-strip": ruleR2,
  "R3-additive-diagnostic-narrow": ruleR3,
  "R4-tgtype-bitmask-completeness": ruleR4,
};

// ───────────────────────────────────────────────────────────────────────────
// Driver
// ───────────────────────────────────────────────────────────────────────────

function relPath(absPath) {
  return relative(REPO_ROOT, absPath).split("\\").join("/");
}

/**
 * Lint one file.
 * @returns {{file:string, findings:Array, measureFail:null|{file:string,reason:string}}}
 */
export function lintFile(absPath) {
  const file = relPath(absPath);
  if (!existsSync(absPath)) {
    return {
      file,
      findings: [],
      measureFail: { file, reason: "file does not exist" },
    };
  }
  // node:fs, never shell grep — a NUL byte must not be able to blind this.
  const src = readFileSync(absPath, "utf8");
  const lineOf = lineIndexer(src);

  const masked = maskSql(src);
  if (masked.error) {
    return {
      file,
      findings: [],
      measureFail: { file, reason: `${masked.error} (line ${masked.line})` },
    };
  }
  const structure = blockStructure(masked.code, lineOf);
  if (structure.error) {
    return {
      file,
      findings: [],
      measureFail: { file, reason: `${structure.error} (line ${structure.line})` },
    };
  }

  const ctx = {
    src,
    code: masked.code,
    lineOf,
    handlers: structure.handlers,
    statements: statements(masked.code),
  };
  const findings = [];
  const emitted = new Set();
  const push = (rule, at, message) => {
    // One finding per (rule, line, message): `a !~ 'x' AND a !~ 'y'` on one line
    // is ONE defect stated twice, and duplicate rows would make the allowlist's
    // exact counts depend on how an author wrapped their conditions.
    const line = lineOf(at);
    const key = `${rule}::${line}::${message}`;
    if (emitted.has(key)) return;
    emitted.add(key);
    findings.push({ rule, file, line, message });
  };
  for (const rule of RULES) RULE_FNS[rule.id](ctx, push);
  findings.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
  return { file, findings, measureFail: null };
}

/**
 * Lint a set of files, optionally applying the pre-existing-violation allowlist.
 */
export function lintPaths(paths, options = {}) {
  const { applyAllowlist = false, allowlistOverride = null } = options;
  const allowlist = allowlistOverride ?? ALLOWLIST;
  const measureFails = [];
  const findings = [];
  const allowlistErrors = [];

  if (paths.length === 0) {
    // ⛔ "could not measure" must never share a code path with "measured zero".
    measureFails.push({
      file: "(corpus)",
      reason:
        "MEASURE_FAIL: zero files to lint. An empty corpus proves nothing about the gate " +
        "files; most likely the glob drifted. This is not a pass.",
    });
    return { ok: false, findings, measureFails, allowlistErrors, filesScanned: 0 };
  }

  const perFileRule = new Map();
  for (const p of paths) {
    const res = lintFile(resolve(p));
    if (res.measureFail) {
      measureFails.push(res.measureFail);
      continue;
    }
    for (const f of res.findings) {
      const key = `${f.file}::${f.rule}`;
      if (!perFileRule.has(key)) perFileRule.set(key, []);
      perFileRule.get(key).push(f);
    }
  }

  if (!applyAllowlist) {
    for (const list of perFileRule.values()) findings.push(...list);
  } else {
    const byKey = new Map(allowlist.map((e) => [`${e.file}::${e.rule}`, e]));
    for (const [key, list] of perFileRule) {
      const entry = byKey.get(key);
      if (!entry) {
        findings.push(...list);
        continue;
      }
      if (list.length !== entry.count) {
        allowlistErrors.push(
          `${key}: ${list.length} finding(s) but the allowlist pins exactly ${entry.count}. ` +
            (list.length > entry.count
              ? "A NEW violation was added to an already-allowlisted file — fix it, do not raise the count."
              : "The allowlist is STALE — lower the count to lock in the repair (this ratchet only tightens)."),
        );
        findings.push(...list);
      }
    }
    const scanned = new Set(paths.map((p) => relPath(resolve(p))));
    for (const entry of allowlist) {
      if (!scanned.has(entry.file)) {
        allowlistErrors.push(
          `${entry.file}::${entry.rule}: allowlisted file was not scanned — the entry is dead ` +
            "(the file moved or was deleted). Remove it rather than leaving a rule quietly disarmed.",
        );
        continue;
      }
      if (!perFileRule.has(`${entry.file}::${entry.rule}`)) {
        allowlistErrors.push(
          `${entry.file}::${entry.rule}: allowlisted but produces NO findings — the repair ` +
            "already landed. Delete the entry so the rule bites this file again.",
        );
      }
    }
  }

  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  const ok = findings.length === 0 && measureFails.length === 0 && allowlistErrors.length === 0;
  return { ok, findings, measureFails, allowlistErrors, filesScanned: paths.length };
}

function corpusFiles() {
  if (!existsSync(CORPUS_DIR)) return [];
  return readdirSync(CORPUS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => join(CORPUS_DIR, f));
}

function report(result) {
  for (const mf of result.measureFails) {
    console.error(`::error file=${mf.file}::MEASURE_FAIL — ${mf.reason}`);
  }
  for (const f of result.findings) {
    console.error(`::error file=${f.file},line=${f.line}::[${f.rule}] ${f.message}`);
  }
  for (const e of result.allowlistErrors) {
    console.error(`::error::[allowlist] ${e}`);
  }
  console.log(
    `lint-sql-gates: scanned ${result.filesScanned} file(s); ` +
      `${result.findings.length} finding(s), ${result.measureFails.length} measure-fail(s), ` +
      `${result.allowlistErrors.length} allowlist error(s).`,
  );
  if (!result.ok) {
    console.error(
      "::error::lint-sql-gates FAILED. Each rule above names a shape that was MEASURED to " +
        "produce a gate arm that could not fail. See scripts/lint-sql-gates.mjs for the " +
        "repaired idiom of each, and scripts/lint-sql-gates-fixtures/ for a worked pair.",
    );
  }
  return result.ok ? 0 : 1;
}

/** Round-trips every rule through its own fixture pair. */
function selfTest() {
  let bad = 0;
  for (const rule of RULES) {
    for (const arm of ["red", "green"]) {
      const p = join(REPO_ROOT, FIXTURE_DIR, `${rule.id}.${arm}.sql`);
      if (!existsSync(p)) {
        console.error(`SELF-TEST FAIL: ${rule.id} has no ${arm} fixture at ${relPath(p)}`);
        bad = 1;
        continue;
      }
      const res = lintFile(p);
      if (res.measureFail) {
        console.error(`SELF-TEST FAIL: ${rule.id} ${arm} fixture: ${res.measureFail.reason}`);
        bad = 1;
        continue;
      }
      const fired = new Set(res.findings.map((f) => f.rule));
      if (arm === "red" && !fired.has(rule.id)) {
        console.error(
          `SELF-TEST FAIL: ${rule.id} did not fire on its own red fixture — the rule cannot fail.`,
        );
        bad = 1;
      }
      if (arm === "red" && fired.size !== 1) {
        console.error(
          `SELF-TEST FAIL: ${rule.id} red fixture also fired ${[...fired].join(", ")} — it must isolate one defect.`,
        );
        bad = 1;
      }
      if (arm === "green" && fired.size !== 0) {
        console.error(
          `SELF-TEST FAIL: ${rule.id} fired ${[...fired].join(", ")} on its green fixture.`,
        );
        bad = 1;
      }
    }
  }
  if (RULES.some((r) => r.mechanism === 5)) {
    console.error("SELF-TEST FAIL: a mechanism-5 rule exists. D-16 forbids it — it cannot fire.");
    bad = 1;
  }
  if (bad === 0) console.log(`lint-sql-gates self-test OK: ${RULES.length} rules, red+green each.`);
  return bad;
}

function main(argv) {
  if (argv[0] === "--self-test") return selfTest();
  if (argv[0] === "--files") {
    return report(lintPaths(argv.slice(1), { applyAllowlist: false }));
  }
  if (argv.length > 0) {
    console.error(`lint-sql-gates: unknown argument "${argv[0]}". See the header for usage.`);
    return 1;
  }
  return report(lintPaths(corpusFiles(), { applyAllowlist: true }));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)));
}
