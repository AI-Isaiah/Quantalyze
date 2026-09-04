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
 *   6  a pg-lane STAND-IN SHADOWS the object under test   → R5/R6/R7, see below
 *
 * ── MECHANISM 6 (Phase 164.4, review finding WR-03) ────────────────────────
 * A gate's `RED-UNDER-SETUP` apply list builds the lane by applying pg-lane
 * FIXTURES and real MIGRATIONS in order. Every stand-in in that list uses
 * `CREATE TABLE IF NOT EXISTS`, so an EARLIER, NARROWER stand-in silently wins
 * and every later create of the same object is a no-op. The arms then run
 * against the stand-in rather than against the object the gate names.
 *
 * This is not hypothetical; it is the only mechanism in this file with TWO
 * MEASURED instances, both found BY HAND during Phase 164.4 and both documented
 * in the header of the fixture that repairs them:
 *
 *   • `scripts/pg-lane/fixtures/16-fixture-user-notes-baseline.sql:5-18` —
 *     `02-fixture-sanitize-tables.sql:30`'s one-column `user_notes (user_id
 *     UUID)` made 20260412094453's `CREATE TABLE IF NOT EXISTS user_notes` a
 *     no-op, so the scope_kind CHECK, the four owner policies and RLS itself
 *     were absent from a table that nonetheless EXISTED. → R5.
 *   • `scripts/pg-lane/fixtures/10-fixture-strategies-rls-baseline.sql:7-16` —
 *     `01-fixture-core.sql:58`'s `CREATE POLICY strategies_read ON strategies
 *     ... TO authenticated` collided with 20260405061912's role-unrestricted
 *     policy of the SAME NAME, leaving `anon` covered by no policy at all and
 *     the `RLS 4: anon sees 0 rows` arm unfalsifiable. → R7.
 *
 * ⛔ WHY A LINT RULE AND NOT THE MUTATION RUNNER. The runner catches only HALF
 * of this class. It catches the half where a mutation CANNOT redden (`no-red`).
 * It cannot catch the half where an arm reddens for a reason unrelated to what
 * the twin mutated, because first-failure discipline checks the ARM IDENTITY
 * and never the CAUSE — which is exactly what fixture 10 measured (GUARD 6 and
 * GUARD 7 catching a 42501 that came from a missing GRANT rather than from the
 * trigger they name). Both instances above were found by a human reading
 * fixtures, with no gate of any kind standing behind them.
 *
 * ⚠️ WHAT MECHANISM 6's RULES DO NOT COVER, stated rather than implied. They
 * detect SHADOWING BY NAME — the same table or the same policy created twice in
 * one apply list. They do NOT detect a stand-in that is merely WEAKER than
 * production under a different name, and they do NOT detect the second half of
 * fixture 10's finding (the missing GRANTs that let 42501 come from the grant
 * layer). Privilege sufficiency is a property of the running cluster, not of
 * the text; that half stays a human review obligation and is recorded here so
 * the gap is a stated boundary rather than an assumed cover.
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
  {
    id: "R5-fixture-shadows-migration-table",
    mechanism: 6,
    title: "a pg-lane fixture's stand-in table shadows the migration under test",
    scope:
      "Walks the gate's RED-UNDER-SETUP apply list in order. Flags a table created by a " +
      "scripts/pg-lane/fixtures/** entry that a LATER supabase/migrations/** entry in the same " +
      "list also creates with IF NOT EXISTS — the migration's create is then a silent no-op and " +
      "the arms run against the stand-in. The escape is the fixture-16 idiom: an entry between " +
      "the two carrying DROP TABLE IF EXISTS for that table. NAME-IDENTITY ONLY: a stand-in that " +
      "is weaker than production under a DIFFERENT name is not this rule's shape and is not " +
      "detectable from the text. A create whose column list will not parse (CREATE TABLE ... AS " +
      "SELECT, LIKE) contributes no columns and so can only ever under-report.",
  },
  {
    id: "R6-fixture-shadows-fixture-table",
    mechanism: 6,
    title: "an earlier fixture's narrower stand-in shadows a later fixture's table",
    scope:
      "The same walk, for two scripts/pg-lane/fixtures/** entries in one apply list: an earlier " +
      "entry creates the table, so the later entry's CREATE TABLE IF NOT EXISTS no-ops and its " +
      "extra columns never exist — a CALL against them aborts on a raw 42703 naming no arm, or " +
      "worse, satisfies the arm vacuously. The escape is the fixture-20 idiom: the later entry " +
      "re-adds each column the earlier one lacks with ADD COLUMN IF NOT EXISTS (an intervening " +
      "DROP TABLE IF EXISTS also clears it). Columns the earlier create already provides need no " +
      "re-add, which is why 20-fixture-app-role-helper.sql does not re-add user_id.",
  },
  {
    id: "R7-fixture-shadows-policy",
    mechanism: 6,
    title: "a pg-lane fixture's stand-in POLICY collides with the one under test",
    scope:
      "The same walk, for RLS policies: a CREATE POLICY <p> ON <t> in a fixture entry that a " +
      "LATER entry creates again by the same name on the same table. CREATE POLICY has no IF " +
      "NOT EXISTS, so the later statement raises 42710 and — under a psql run that is not " +
      "ON_ERROR_STOP for that step — is SKIPPED, leaving the narrower stand-in in force. The " +
      "escape is the fixture-10 idiom: DROP POLICY IF EXISTS <p> ON <t> between the two. It does " +
      "NOT check that the surviving policy is narrower (that is a semantic property of the USING " +
      "clause), only that two definitions of one name collide.",
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

// ───────────────────────────────────────────────────────────────────────────
// Mechanism 6 — RED-UNDER-SETUP apply-list shadowing (R5 / R6 / R7)
// ───────────────────────────────────────────────────────────────────────────

const FIXTURE_PREFIX = "scripts/pg-lane/fixtures/";
const MIGRATION_PREFIX = "supabase/migrations/";
const isFixtureEntry = (p) => p.startsWith(FIXTURE_PREFIX);
const isMigrationEntry = (p) => p.startsWith(MIGRATION_PREFIX);

/**
 * `"public"."User_Notes"` → `user_notes`. Schema-qualified names are stripped
 * to bare only for the `public` schema, which is the one the lane builds; a
 * name in another schema stays qualified so `auth.users` and `public.users`
 * are never conflated.
 */
function normRelation(raw) {
  const bare = raw.replace(/"/g, "").toLowerCase();
  return bare.startsWith("public.") ? bare.slice("public.".length) : bare;
}

/** The matching `)` for the `(` at `open`, or -1. */
function matchParen(code, open) {
  let depth = 0;
  for (let p = open; p < code.length; p++) {
    if (code[p] === "(") depth++;
    else if (code[p] === ")") {
      depth--;
      if (depth === 0) return p;
    }
  }
  return -1;
}

const TABLE_CONSTRAINT_HEADS = new Set([
  "primary",
  "unique",
  "check",
  "constraint",
  "foreign",
  "exclude",
  "like",
]);

/** Column names declared by a parsed `CREATE TABLE (...)` body. */
function columnNames(inner) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of inner) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  const cols = [];
  for (const part of parts) {
    const m = /^\s*([A-Za-z_"][\w"]*)/.exec(part);
    if (!m) continue;
    const name = m[1].replace(/"/g, "").toLowerCase();
    if (TABLE_CONSTRAINT_HEADS.has(name)) continue;
    cols.push(name);
  }
  return cols;
}

const CREATE_TABLE_RE =
  /\bCREATE\s+(?:UNLOGGED\s+|TEMP(?:ORARY)?\s+)?TABLE\s+(IF\s+NOT\s+EXISTS\s+)?([A-Za-z_"][\w".]*)/gi;
const DROP_TABLE_RE = /\bDROP\s+TABLE\s+IF\s+EXISTS\s+([A-Za-z_"][\w".]*)/gi;
const ALTER_TABLE_RE = /\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?([A-Za-z_"][\w".]*)([\s\S]*?);/gi;
const ADD_COLUMN_RE = /\bADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+([A-Za-z_"][\w"]*)/gi;
const CREATE_POLICY_RE = /\bCREATE\s+POLICY\s+([A-Za-z_"][\w"]*)\s+ON\s+([A-Za-z_"][\w".]*)/gi;
const DROP_POLICY_RE =
  /\bDROP\s+POLICY\s+IF\s+EXISTS\s+([A-Za-z_"][\w"]*)\s+ON\s+([A-Za-z_"][\w".]*)/gi;

/**
 * What one apply-list entry does to the lane's schema, read from its MASKED
 * text. Masking is not an optimisation here, it is the whole correctness
 * argument: `16-fixture-user-notes-baseline.sql:6` and
 * `20-fixture-app-role-helper.sql:41` both QUOTE the very
 * `CREATE TABLE IF NOT EXISTS ...` statement they exist to neutralise, inside a
 * `--` comment. An unmasked scan would read those prose citations as schema and
 * report the repaired files as broken — the same comment-vs-code confusion R2
 * exists for, committed by the rule that polices it.
 *
 * @returns {{creates:Map, drops:Map, adds:Map, policies:Map, policyDrops:Map} | {error:string}}
 */
function analyzeApplyTarget(absPath) {
  if (!existsSync(absPath)) return { error: "file does not exist" };
  const masked = maskSql(readFileSync(absPath, "utf8"));
  if (masked.error) return { error: `${masked.error} (line ${masked.line})` };
  const code = masked.code;

  const creates = new Map(); // table -> { ifNotExists, cols, at }
  const re = new RegExp(CREATE_TABLE_RE.source, "gi");
  let m;
  while ((m = re.exec(code)) !== null) {
    const table = normRelation(m[2]);
    const tail = m.index + m[0].length;
    const open = code.indexOf("(", tail);
    let cols = [];
    // Only a `(` that follows the name with nothing between it is the column
    // list; `CREATE TABLE x AS SELECT ...` and `... PARTITION OF` are not.
    if (open !== -1 && code.slice(tail, open).trim() === "") {
      const close = matchParen(code, open);
      if (close !== -1) cols = columnNames(code.slice(open + 1, close));
    }
    // FIRST create wins: it is the one that decides the shape of the object.
    if (!creates.has(table)) creates.set(table, { ifNotExists: Boolean(m[1]), cols, at: m.index });
  }

  const drops = new Map(); // table -> first offset
  const dre = new RegExp(DROP_TABLE_RE.source, "gi");
  while ((m = dre.exec(code)) !== null) {
    const table = normRelation(m[1]);
    if (!drops.has(table)) drops.set(table, m.index);
  }

  const adds = new Map(); // table -> Set(column)
  const are = new RegExp(ALTER_TABLE_RE.source, "gi");
  while ((m = are.exec(code)) !== null) {
    const table = normRelation(m[1]);
    const set = adds.get(table) ?? new Set();
    const cre = new RegExp(ADD_COLUMN_RE.source, "gi");
    let c;
    while ((c = cre.exec(m[2])) !== null) set.add(c[1].replace(/"/g, "").toLowerCase());
    adds.set(table, set);
  }

  const policies = new Map(); // "<policy> ON <table>" -> first offset
  const pre = new RegExp(CREATE_POLICY_RE.source, "gi");
  while ((m = pre.exec(code)) !== null) {
    const key = `${m[1].replace(/"/g, "").toLowerCase()} ON ${normRelation(m[2])}`;
    if (!policies.has(key)) policies.set(key, m.index);
  }

  const policyDrops = new Map();
  const dpre = new RegExp(DROP_POLICY_RE.source, "gi");
  while ((m = dpre.exec(code)) !== null) {
    const key = `${m[1].replace(/"/g, "").toLowerCase()} ON ${normRelation(m[2])}`;
    if (!policyDrops.has(key)) policyDrops.set(key, m.index);
  }

  return { creates, drops, adds, policies, policyDrops };
}

/** Analyses are pure functions of file bytes; one process never sees two versions. */
const applyTargetCache = new Map();
function applyTarget(rel) {
  if (!applyTargetCache.has(rel)) applyTargetCache.set(rel, analyzeApplyTarget(join(REPO_ROOT, rel)));
  return applyTargetCache.get(rel);
}

const RED_UNDER_SETUP_RE = /^--\s*RED-UNDER-SETUP:\s*(\{.*\})\s*$/;

/**
 * Read a gate file's RED-UNDER-SETUP apply list.
 * @returns {null | {list:string[], at:number} | {error:string}}
 */
export function parseApplyList(src) {
  const at = src.indexOf("-- RED-UNDER-SETUP:");
  if (at === -1) return null;
  const eol = src.indexOf("\n", at);
  const line = src.slice(at, eol === -1 ? src.length : eol);
  const m = RED_UNDER_SETUP_RE.exec(line.trim());
  if (!m) {
    return { error: "RED-UNDER-SETUP annotation is not `-- RED-UNDER-SETUP: {json}` on one line" };
  }
  let parsed;
  try {
    parsed = JSON.parse(m[1]);
  } catch (err) {
    return { error: `RED-UNDER-SETUP JSON does not parse: ${err.message}` };
  }
  if (!Array.isArray(parsed.apply) || parsed.apply.some((p) => typeof p !== "string")) {
    return { error: "RED-UNDER-SETUP has no `apply` array of strings" };
  }
  return { list: parsed.apply, at };
}

/**
 * Is the shadowed create rescued by a DROP between the two entries?
 * A drop in an entry strictly between them always counts; a drop inside the
 * shadowed entry itself counts only if it precedes that entry's own create.
 */
function droppedBetween(ctx, i, j, dropAt, createAtInJ) {
  if (!ctx.mech6Escapes) return false;
  for (let k = i + 1; k <= j; k++) {
    const target = ctx.applyTargets[k];
    const off = dropAt(target);
    if (off === undefined) continue;
    if (k < j) return true;
    if (createAtInJ !== null && off < createAtInJ) return true;
  }
  return false;
}

/** Every (earlier-creates, later-recreates) pair in the apply list, for one object kind. */
function* shadowPairs(ctx, objectsOf) {
  for (let i = 0; i < ctx.applyList.length; i++) {
    if (!isFixtureEntry(ctx.applyList[i])) continue;
    for (const [key, first] of objectsOf(ctx.applyTargets[i])) {
      for (let j = i + 1; j < ctx.applyList.length; j++) {
        const again = objectsOf(ctx.applyTargets[j]).get(key);
        if (again === undefined) continue;
        yield { i, j, key, first, again };
      }
    }
  }
}

function ruleR5(ctx, push) {
  if (!ctx.applyList) return;
  for (const { i, j, key, again } of shadowPairs(ctx, (t) => t.creates)) {
    if (!isMigrationEntry(ctx.applyList[j])) continue;
    if (!again.ifNotExists) continue; // a hard duplicate ERRORS — loud, not silent
    if (droppedBetween(ctx, i, j, (t) => t.drops.get(key), again.at)) continue;
    push(
      "R5-fixture-shadows-migration-table",
      ctx.applyAt,
      `apply list: \`${ctx.applyList[i]}\` creates \`${key}\`, and the later ` +
        `\`${ctx.applyList[j]}\` creates it again with IF NOT EXISTS — so the MIGRATION's create ` +
        "is a silent no-op and every arm naming that table runs against the STAND-IN. Nothing " +
        "the migration attaches to it (CHECKs, policies, RLS itself) exists, while the table " +
        "does. Add the fixture-16 idiom — `DROP TABLE IF EXISTS " +
        `${key}\` in a fixture between the two — so the real migration defines the object the ` +
        "arms assert on.",
    );
  }
}

function ruleR6(ctx, push) {
  if (!ctx.applyList) return;
  for (const { i, j, key, first, again } of shadowPairs(ctx, (t) => t.creates)) {
    if (!isFixtureEntry(ctx.applyList[j])) continue;
    if (!again.ifNotExists) continue;
    if (droppedBetween(ctx, i, j, (t) => t.drops.get(key), again.at)) continue;
    const extra = again.cols.filter((c) => !first.cols.includes(c));
    if (extra.length === 0) continue; // the later create asks for nothing new
    const readded = ctx.mech6Escapes ? ctx.applyTargets[j].adds.get(key) ?? new Set() : new Set();
    const missing = extra.filter((c) => !readded.has(c));
    if (missing.length === 0) continue; // the fixture-20 idiom, satisfied
    push(
      "R6-fixture-shadows-fixture-table",
      ctx.applyAt,
      `apply list: \`${ctx.applyList[i]}\` creates \`${key}\` first, so ` +
        `\`${ctx.applyList[j]}\`'s CREATE TABLE IF NOT EXISTS no-ops and the column(s) ` +
        `{${missing.join(", ")}} never exist. An arm that reads them aborts on a raw 42703 ` +
        "naming no arm, and one that only writes them may pass vacuously. Make the later " +
        "fixture ORDER-ROBUST with the fixture-20 idiom — re-add each column with " +
        "`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` — or drop the stand-in between the two.",
    );
  }
}

function ruleR7(ctx, push) {
  if (!ctx.applyList) return;
  for (const { i, j, key, again } of shadowPairs(ctx, (t) => t.policies)) {
    if (droppedBetween(ctx, i, j, (t) => t.policyDrops.get(key), again)) continue;
    push(
      "R7-fixture-shadows-policy",
      ctx.applyAt,
      `apply list: \`${ctx.applyList[i]}\` and the later \`${ctx.applyList[j]}\` both ` +
        `CREATE POLICY \`${key}\`. CREATE POLICY has no IF NOT EXISTS, so the second raises ` +
        "42710 and is skipped rather than replacing the first — the FIXTURE's narrower " +
        "stand-in stays in force and the arms measure it instead of the definition under " +
        `test. Add the fixture-10 idiom: \`DROP POLICY IF EXISTS ${key}\` between the two.`,
    );
  }
}

const RULE_FNS = {
  "R1-exception-handler-probe": ruleR1,
  "R2-functiondef-comment-strip": ruleR2,
  "R3-additive-diagnostic-narrow": ruleR3,
  "R4-tgtype-bitmask-completeness": ruleR4,
  "R5-fixture-shadows-migration-table": ruleR5,
  "R6-fixture-shadows-fixture-table": ruleR6,
  "R7-fixture-shadows-policy": ruleR7,
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
export function lintFile(absPath, options = {}) {
  const file = relPath(absPath);
  if (!existsSync(absPath)) {
    return {
      file,
      findings: [],
      measureFail: { file, reason: "file does not exist" },
    };
  }
  // node:fs, never shell grep — a NUL byte must not be able to blind this.
  return lintSource(readFileSync(absPath, "utf8"), file, options);
}

/**
 * Lint gate-file TEXT. `lintFile` is this plus reading the bytes; the split
 * exists so the mechanism-6 rules can be exercised against a COUNTERFACTUAL
 * apply list — the same real fixtures in a different order, or with one entry
 * removed — without writing a file for each. The apply-list ENTRIES are still
 * read from disk: the counterfactual is the list, never the schema.
 *
 * `options.mech6Escapes = false` disables the two documented escapes (an
 * intervening DROP, and the later fixture's ADD COLUMN IF NOT EXISTS re-adds).
 * ⛔ IT IS AN ANTI-VACUITY LEVER, not a mode: with the escapes off, the REAL
 * corpus must go RED, and that is the only thing separating "these rules are
 * clean because the fixtures repair the defect" from "these rules are clean
 * because they cannot fire". `src/__tests__/lint-sql-gates.test.ts` pins a
 * measured per-rule floor on it. Same purpose, and same precedent, as
 * `lintPaths`' `allowlistOverride`.
 *
 * @returns {{file:string, findings:Array, measureFail:null|{file:string,reason:string}}}
 */
export function lintSource(src, file, options = {}) {
  const { mech6Escapes = true } = options;
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

  // ── Mechanism 6 context: the RED-UNDER-SETUP apply list, resolved.
  // ⛔ "COULD NOT MEASURE" ≠ "MEASURED ZERO", the rule this file is built on:
  // an annotation that will not parse, or that names a file this checkout does
  // not have, is MEASURE_FAIL. Silently skipping it would disarm R5/R6/R7 for
  // that gate while the run still printed a clean line for it.
  const applyParse = parseApplyList(src);
  if (applyParse && applyParse.error) {
    return { file, findings: [], measureFail: { file, reason: applyParse.error } };
  }
  const applyList = applyParse ? applyParse.list : null;
  const applyTargets = [];
  if (applyList) {
    for (const rel of applyList) {
      const target = applyTarget(rel);
      if (target.error) {
        return {
          file,
          findings: [],
          measureFail: {
            file,
            reason: `RED-UNDER-SETUP apply entry "${rel}": ${target.error}`,
          },
        };
      }
      applyTargets.push(target);
    }
  }

  const ctx = {
    src,
    code: masked.code,
    lineOf,
    handlers: structure.handlers,
    statements: statements(masked.code),
    applyList,
    applyTargets,
    applyAt: applyParse ? applyParse.at : 0,
    mech6Escapes,
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
