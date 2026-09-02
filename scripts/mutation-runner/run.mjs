#!/usr/bin/env node
/**
 * RED-UNDER mutation runner (VAC-01, phase 164.3 plan 05).
 *
 * ============================================================================
 * CLI CONTRACT — ci.yml pastes this VERBATIM (plan 164.3-08).
 * ============================================================================
 *
 *   node scripts/mutation-runner/run.mjs                    # full corpus: supabase/tests/
 *   node scripts/mutation-runner/run.mjs --fixture-corpus   # the synthetic corpus
 *   node scripts/mutation-runner/run.mjs --self-test        # prove the exit-1 modes fire
 *   node scripts/mutation-runner/run.mjs --parse-only       # STATIC only — runs ZERO arms
 *   node scripts/mutation-runner/run.mjs --file <gate.sql>  # DIAGNOSTIC (never exits 0)
 *   node scripts/mutation-runner/run.mjs --arm "<ARM ID>"   # DIAGNOSTIC (never exits 0)
 *
 * Exit codes:
 *   0  full gate run, no defects, floors held, the runner's own counts agree
 *   1  at least one defect, a coverage floor regression, or an ABSURDITY — the
 *      runner's two independent arm tallies disagree (164.3.1-10, D-09)
 *   2  NARROWED DIAGNOSTIC RUN that found no defects. Deliberately NOT 0: a run
 *      that executed a subset of arms must never be mistakable for a passing
 *      gate. That mistake — a partial check reading as a full PASS — is
 *      SKIP-01's shape and is on this phase's own defect list.
 *   3  usage or environment error
 *
 * ⚠️ Local and CI invocations must be byte-identical in MODE. A wrapper that
 * changes the invocation changes the result.
 *
 * ============================================================================
 * WHAT DEFECT CLASS THIS EXISTS FOR
 * ============================================================================
 * Every one of the five vacuity mechanisms this phase catalogues was GREEN in
 * CI. A gate arm that cannot fail is indistinguishable from a passing one by
 * every signal a reviewer reads, so the only way to know an arm can fail is to
 * BREAK the thing it guards and watch it fail. This runner does that on every
 * push, for every annotated arm.
 *
 * Per arm: copy the corpus into scratch, apply the annotation's mutation TO THE
 * COPIES, run the lane, and require BOTH that the gate went red AND that the
 * FIRST `TEST FAILED (…)` names the annotated arm. Red-anywhere is not success
 * — "the file went red" is satisfied by a mutation that breaks something else
 * entirely, which would be a vacuous check inside the vacuity detector. That
 * first-failure discipline is also the only detector for mechanism 5 (an arm
 * made structurally unreachable by an earlier arm), which is not statically
 * decidable (D-16).
 *
 * ============================================================================
 * FOUR INVARIANTS, EACH BOUGHT BY A MEASURED FAILURE
 * ============================================================================
 *
 * 1. THE CHECKOUT IS NEVER MUTATED. Every mutation lands on a copy in a scratch
 *    dir. This eliminates the stale-byte-backup class and the shared-git-index
 *    race BY CONSTRUCTION rather than by discipline, and the run asserts
 *    `git status --porcelain` is clean before it exits.
 *
 * 2. "COULD NOT MEASURE" IS NEVER "MEASURED ZERO PROBLEMS". Every byte-edit
 *    carries a required, measured `occurrences`; a mismatch is the distinct
 *    defect kind `occurrence-mismatch` (MEASURE_FAIL) and the mutation is NOT
 *    applied. Plan 164.3-01 hit this on the first real arm: SHAPE 1c's prose
 *    locator `generation BIGINT` matches exactly once in the migration and it
 *    is the WRONG occurrence (line 828's `RETURNS TABLE`, not the CREATE TABLE
 *    at line 170, which carries two spaces). Mutating it aborts the apply, so
 *    the gate never runs. A runner without this assertion would have reported a
 *    FALSE `no-red` defect against a perfectly good arm — or mutated something
 *    else and read the resulting red as SUCCESS.
 *
 * 3. ALL ARMS RUN BEFORE ANYTHING IS REPORTED (OPS-08-F8). The runner never
 *    stops at the first failing arm. First-failure identity is asserted WITHIN
 *    an arm's run; aggregation happens ACROSS arms.
 *
 * 4. BOTH FAILURE MODES HARD-FAIL WITH EXIT 1 (D-09). A non-biting annotation
 *    and a coverage-floor regression are errors, not warnings. Branch
 *    protection is deliberately off in this repo, so a non-zero exit is the
 *    only signal that exists; softening it reproduces the status quo the phase
 *    exists to change.
 *
 * Reads files with node:fs, never shell grep (grep is silently NUL-blind here).
 * The annotation schema is documented in GRAMMAR.md.
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BRANCH_HEAD_KEYWORDS,
  maskNonCode,
  parseFile,
  scanCorpus,
  tokenizeStatements,
} from "./parse.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LANE = join(REPO_ROOT, "scripts", "pg-lane", "run.sh");
const DEFAULT_CORPUS = join(REPO_ROOT, "supabase", "tests");
const FIXTURE_CORPUS = join(REPO_ROOT, "scripts", "mutation-runner", "fixtures");

// ===========================================================================
// COVERAGE RATCHET (D-01, D-09)
// ===========================================================================
//
// ⚠️ THESE ARE RATCHETS PINNED AT A MEASURED VALUE, NOT ASPIRATIONS. They fail
// on REGRESSION only — never "until 71/71". A runner reporting PASS while
// covering 1.4% of the corpus is the same shape as the SKIP-that-reads-as-PASS
// on this phase's defect list, so coverage is PRINTED on every run and a drop
// below the floor is exit 1.
//
// FILES_FLOOR was MEASURED before this file existed (2026-08-29, via a
// line-start-anchored node:fs scan of supabase/tests/): 1 annotated file of 71,
// carrying 30 prose markers. A floor picked by reading the finished artifact
// always passes and would prove nothing.
//
// RE-CONFIRMED 2026-09-01 (plan 164.3.1-09, SC-6/SC-9): the same run that
// re-derived ARMS_FLOOR below printed `coverage: files 1/71` — still 1 annotated
// file of 71, still supabase/tests/test_strategy_shares_rls.sql, whose blob is
// byte-identical at the phase base and at HEAD (5ae6855f). Command, sample size
// and record are stated once in the ARMS_FLOOR block below. No value change.
//
// Phase 164.4 raises FILES_FLOOR as it backfills the other 70 files.
export const FILES_FLOOR = 1;

// ARMS_FLOOR — PINNED 2026-08-29 BY MEASUREMENT (plan 164.3-08), not chosen.
//
// It shipped at 0 in plan 05, which is a control that cannot fire, recorded as
// such (WINDOWS.md entry 27) because no honest full-corpus measurement existed:
// the real gate had zero RED-UNDER-M twins. That measurement now exists.
//
// MEASURED on the first green full-corpus run, 2026-08-29:
//   `node scripts/mutation-runner/run.mjs` -> exit 0
//   coverage: files 1/71
//   arms: 30/30/0  (executed/annotated/waived)
//   30 of 30 arms RED with first-failure identity ok; 0 waivers; 64s wall clock
//
// "Biting" is executed arms MINUS `no-red` and `wrong-first-failure` defects,
// which on that run was 30 - 0 = 30. The number was read off the RUN, never off
// this file — a floor picked by reading the finished artifact always passes.
//
// ⭐ RE-DERIVED 2026-09-01 UNDER THE SOUND PRIMITIVES (plan 164.3.1-09, SC-6).
// The 2026-08-29 pin above STAYS as lineage: it is not superseded, it is
// re-earned. Plans 164.3.1-01 and -05 replaced BOTH mechanisms that produce this
// number — line-based classification became statement tokenization, and the
// in-query identity nonce became source-location attribution — so 30 was correct
// by SCOPE but not yet by MECHANISM until measured again from scratch.
//
//   VALUE        30 — UNCHANGED. biting = 30 executed − 0 (no-red +
//                wrong-first-failure + synthesised-identity) = 30 − 0 = 30.
//   DATE         2026-09-01, at HEAD a305a71a.
//   COMMAND      `node scripts/mutation-runner/run.mjs` -> exit 0
//                  coverage: files 1/71
//                  arms: 30/30/0   (executed/annotated/waived)
//                  biting: 30
//                  per-arm lane time: mean 1.7s over 30 arm run(s)
//   SAMPLE SIZE  30 arms executed, all 30 `RED (identity ok)`, 0 moved from the
//                pre-phase per-arm baseline. Plus 104 identities / 103 backward
//                scans re-measured over the same file (99 accepted, 4 refused —
//                SERVICE-ROLE 2a-2d at :2249/:2254/:2268/:2273 — 0 refusals
//                added by the new primitives).
//   COVERAGE     1 annotated gate file of 71 in supabase/tests/, namely
//                supabase/tests/test_strategy_shares_rls.sql. Its blob is
//                BYTE-IDENTICAL at the phase base c2251b6d and at HEAD
//                (5ae6855f), so the INPUT was fixed and only the MECHANISM
//                moved — which is what makes "unchanged" a measurement here
//                rather than a coincidence of two different corpora.
//   RECORD       .planning/phases/164.3.1-sound-primitives-the-neuter-scan-and-
//                the-mutation-identity-c/164.3.1-09-REDERIVATION.md
//
// ⭐ Same integer, STRICTLY SMALLER admissible set. `identity ok` used to mean
// "the failure text carried this run's nonce" — a secret the gate's own SQL
// could read back through current_query(). It now means the raise's psql prefix
// names this lane's gate file at the failing statement's last line, AND the
// CONTEXT chain is exactly one `inline_code_block line N at RAISE` frame, AND N
// resolves through the tokenizer's spans to the arm's recorded raise line. A
// floor of 30 is therefore harder to satisfy than it was — the safe direction
// for a ratchet, and the fact plan 164.3.1-10 must carry with the integer.
//
// ⚠️ RATCHET, NOT A TARGET. It fails on REGRESSION only: an annotation that
// stops biting, or one deleted outright, drops the biting count below 30 and
// exits 1. It never demands more than the corpus declares. Phase 164.4 raises
// it as it backfills the other 70 files.
// ⛔ Converting an arm to a `waiver` LOWERS the biting count and therefore trips
// this floor. That is deliberate: waiver creep is how a non-biting arm hides
// (T-164.3-21), so widening a waiver has to be an explicit, reviewed edit here.
//
// CURRENCY, stated where the VALUE is — derivation, sample size and coverage in
// the block above; record in 164.3.1-09-REDERIVATION.md:
// RE-DERIVED 2026-09-01 under the sound primitives (plan 164.3.1-09).
// Measured biting 30 — value UNCHANGED.
export const ARMS_FLOOR = 30;

/**
 * Every defect this runner can report. EXPORTED (SP-C02) so the CI-wiring test
 * can range over it rather than restating it: a new kind added here without a
 * `--self-test` scenario, or without a place on the reviewed
 * not-covered-by-the-self-test list, fails by name in
 * src/__tests__/mutation-runner-floors.test.ts. A list restated in a test is a
 * second thing to drift; a list the implementation owns is not.
 */
export const DEFECT_KINDS = [
  "parse",
  "parity",
  "bad-file-ref",
  "occurrence-mismatch",
  "no-red",
  "wrong-first-failure",
  "neuter-missed",
  "identity-rewrite",
  "synthesised-identity",
  "baseline",
  "restore",
  "dirty-checkout",
  "floor",
  // 164.3.1-10: the runner's OWN counts disagree (see absurdityViolations).
  // A GATE defect, not a corpus finding — kept distinct from `floor` so the
  // defect table and the CI count-recheck step can tell "the corpus regressed"
  // from "the instrument is broken" by name.
  "absurdity",
];

// ---------------------------------------------------------------------------
// Byte-exact mutation primitives. Every one of them refuses to guess.
// ---------------------------------------------------------------------------

/** Non-overlapping occurrence count of a literal needle. */
export function countOccurrences(haystack, needle) {
  if (needle.length === 0) throw new Error("countOccurrences: empty needle");
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count += 1;
    from = at + needle.length;
  }
}

/** Index of the nth (1-based) non-overlapping occurrence, or -1. */
function indexOfNth(haystack, needle, nth) {
  let from = 0;
  for (let i = 0; i < nth; i += 1) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return -1;
    if (i === nth - 1) return at;
    from = at + needle.length;
  }
  return -1;
}

/**
 * Apply one `edit`/`insert-after` step to file text.
 *
 * Returns `{ ok: true, text }`, or `{ ok: false, actual }` when the measured
 * occurrence count disagrees with the annotation. The caller turns that into
 * `occurrence-mismatch`, NEVER into `no-red` — see invariant 2 in the header.
 */
export function applyFileStep(text, step) {
  const needle = step.kind === "edit" ? step.find : step.anchor;
  const actual = countOccurrences(text, needle);
  if (actual !== step.occurrences) return { ok: false, actual };

  const at = indexOfNth(text, needle, step.nth);
  // Unreachable given the count matched and nth <= occurrences (the parser
  // enforces that), but an absent measurement must never read as a pass.
  if (at === -1) return { ok: false, actual };

  if (step.kind === "edit") {
    return { ok: true, text: text.slice(0, at) + step.replace + text.slice(at + needle.length) };
  }
  const end = at + needle.length;
  return { ok: true, text: text.slice(0, end) + step.text + text.slice(end) };
}

/**
 * Replace an arm's `RAISE EXCEPTION 'TEST FAILED (<arm>)…'` with a no-op in a
 * COPY of the gate file, so a shadowing arm cannot fire first.
 *
 * `NULL;` is substituted rather than deleting the statement, so an `IF … THEN`
 * whose only statement was the RAISE keeps a non-empty body.
 *
 * ⛔ THE FAILURE BRANCH'S TRAILING `RESET ROLE;` GOES WITH IT, AND THAT IS A
 * CORRECTNESS REQUIREMENT, NOT TIDYING. MEASURED 2026-08-29 while annotating
 * the real corpus (plan 164.3-08): `N1 3a`'s mutation neuters `N1 1a`, whose
 * failure branch reads
 *
 *     IF NOT raised OR err_msg NOT LIKE '%AT MOST ONE%' THEN
 *       RESET ROLE;
 *       RAISE EXCEPTION 'TEST FAILED (N1 1a): …';
 *     END IF;
 *
 * Neutering only the RAISE left `RESET ROLE;` executing — and the branch DOES
 * execute under that mutation, which is the whole reason the arm is neutered.
 * The session dropped from `authenticated` to the (superuser) session role for
 * the ENTIRE REST OF THE FILE, and sixteen arms later `NO-DELETE 1`'s
 * `DELETE FROM strategy_shares` succeeded because a superuser needs no grant.
 * The runner reported `wrong-first-failure: NO-DELETE 1`.
 *
 * ⚠️ It was loud HERE only by luck. A leaked superuser role makes every
 * downstream GRANT arm pass for a reason unrelated to the grant — a silent
 * vacuous PASS inside the vacuity detector, and the exact defect class Phase
 * 164.4 would inherit across seventy more files.
 *
 * The reasoning that makes this the RIGHT semantics rather than a patch: those
 * statements exist solely to restore state before ABORTING the file. Once the
 * arm is neutered the file continues, so running its abort-path cleanup is
 * wrong by construction. Only an exact `RESET ROLE;` is absorbed — nothing
 * else, so a branch that does real work is never silently swallowed.
 */
/**
 * The ONLY abort-path statement the neuter absorbs along with the RAISE.
 * Exported so a test can assert the set is exactly this, and so widening it is
 * a visible, reviewed edit rather than a regex tweak inside a loop.
 */
export const ABSORBABLE_CLEANUP = /^[ \t]*RESET[ \t]+ROLE[ \t]*;[ \t]*$/i;

/**
 * The branch-head keywords, exported so the cross-product oracle in
 * `mutation-runner-neuter.test.ts` can GENERATE its inputs from this list
 * rather than hand-listing spellings. Adding a keyword here automatically
 * widens that test's input space.
 *
 * ⭐ ONE DEFINITION (phase 164.3.1, Primitive A). The list is the TOKENIZER's
 * own, re-exported rather than restated: a list restated in a second file is a
 * second thing to drift.
 */
export const BRANCH_HEAD_WORDS = BRANCH_HEAD_KEYWORDS;

/**
 * The masking projection of SQL source: every non-code region blanked, offsets
 * and line numbers preserved, so a keyword can only be read where PostgreSQL
 * would read one.
 *
 * ⛔ R3-C01, and the reason this is a classifier rather than another needle.
 * Rounds 1 and 2 each closed the ONE spelling the reviewer demonstrated — a
 * whole-line `--` comment — and each declared the class closed. Round 3
 * reached the identical `SET ROLE` leak with three more spellings in minutes:
 * a keyword inside a single-quoted literal (`PERFORM run_sql('BEGIN');`),
 * inside a slash-star block comment reading "we then raise the exception",
 * and inside a dollar-quoted body (`EXECUTE $q$ DECLARE junk int; $q$;`).
 * Enumerating a fourth spelling is a guaranteed fourth failure, so the rule is
 * stated over the STRUCTURE of the source instead: remove everything that is
 * not code, then ask what remains.
 *
 * ⭐ SUPERSEDED IMPLEMENTATION, phase 164.3.1 (the measured history is kept, not
 * deleted). This used to be a four-regex pipeline applied ONE LINE AT A TIME,
 * with the honest scope note that a literal, block comment or dollar-quoted
 * body SPANNING lines was masked only where both delimiters appeared. That
 * line-locality is exactly what [MUT-I01] and [R4-C01] were made of, so the
 * masking is now a projection of the STATEMENT TOKENIZER's state
 * (`maskNonCode` in parse.mjs), which carries `'…'`, `"…"`, `$tag$…$tag$`,
 * `/* *\/` (nesting) and `--` ACROSS lines. There is exactly one state machine
 * in this codebase that decides what is code, and this is a view of it.
 */
export const executableText = (source) => maskNonCode(source);

/**
 * TRUE when a STATEMENT is a branch head, not when it merely MENTIONS one.
 *
 * ⛔ SUPERSEDED PREDICATE AND ITS SUPERSEDED MEASUREMENT, phase 164.3.1 — kept
 * because the history is the argument, not decoration.
 *
 * The first version was `\b(THEN|BEGIN|ELSE|…)\b` anywhere in the LINE, which
 * every non-code embedding bypassed. The second was structural but still a LINE
 * predicate, with two UNANCHORED arms:
 *
 *     /^EXCEPTION(\s+WHEN\b.*)?$/i     ← `.*` swallows trailing STATEMENTS
 *     /\b(THEN|LOOP)$/i                ← no start anchor
 *
 * Its measurement — "MEASURED 2026-08-29 against the real gate file, all 104
 * arm identities / 103 backward scans: 0 disagreements" — was true and did not
 * save it, because the disagreements it could not have found are on lines the
 * gate file does not contain: `EXCEPTION WHEN OTHERS THEN v_raised := true;
 * END;` exists SEVEN times in test_profiles_privileged_columns_locked.sql, and
 * `SET ROLE postgres; IF NOT ok THEN` is the ROADMAP's own [R4-C01] spelling.
 * Both were accepted WHOLE, so the backward scan terminated on them and every
 * statement sharing their line stayed live — a superuser session handed to
 * every later arm, silently. A measurement over one file's shapes is not a
 * measurement over the class.
 *
 * So the question is no longer asked of a LINE at all. `tokenizeStatements`
 * decomposes a compound line into its statements and marks the branch-head
 * UNITS among them; this predicate reads that mark. The unanchored arms cannot
 * be re-opened because there are no arms — the head ends where its keyword
 * ends, and the statements that follow it on the same line are separate units
 * the scan must classify on their own.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * RE-MEASURED 2026-09-01 (phase 164.3.1 plan 01 task 3), R3-C01 discipline.
 * ═══════════════════════════════════════════════════════════════════════════
 * SAMPLE: `supabase/tests/test_strategy_shares_rls.sql`, the only annotated
 * file in the corpus (1 of 71 — see FILES_FLOOR).
 * SAMPLE SIZE: 104 `TEST FAILED (` occurrences, 104 distinct identities, 103
 * backward scans performed (the 104th identity is the header's own syntax
 * documentation and carries no raise, so no scan runs for it).
 * COVERAGE: 103 of 103 scans compared, statement predicate vs the DELETED line
 * predicate transcribed verbatim from HEAD `e0660031` as an INDEPENDENT
 * instrument.
 * RESULT: 103 agreements, 0 disagreements. Refusals: 4 under BOTH predicates,
 * the same four arms — SERVICE-ROLE 2a/2b/2c/2d, whose branches each `EXECUTE
 * 'REVOKE EXECUTE ON FUNCTION public.create_strategy_share(UUID) FROM
 * service_role'` before raising (lines 2249 / 2254 / 2268 / 2273). Each refusal
 * is LOUD and names its statement. ZERO refusals were added by this change.
 *
 * ⚠️ WHAT THIS MEASUREMENT DOES AND DOES NOT BOUND, because the previous one at
 * this spot was true and did not save the predicate: it bounds NON-REGRESSION
 * on the shapes THIS ONE FILE contains. It says nothing about shapes it does
 * not contain — and the compound line that broke the old predicate lives in a
 * DIFFERENT file (`test_profiles_privileged_columns_locked.sql`, seven times).
 * The class is closed by CONSTRUCTION above, not by this number; the number
 * only proves the construction refuses nothing the corpus already relies on.
 * Phase 164.4 raises the coverage as it backfills the other 70 files.
 */
export const isBranchHead = (statement) => statement != null && statement.head === true;

/** A `RAISE EXCEPTION`, read in the masking projection so a mention in a literal is not one. */
const RAISE_EXCEPTION_RE = /\bRAISE\s+EXCEPTION\b/i;

/**
 * The index of the previous SIBLING statement — same nesting depth, same
 * enclosing body — or -1 at the top of the block.
 *
 * `tokenizeStatements` emits pre-order, so a preceding sibling's own nested
 * statements sit between it and `idx` and are skipped; a shallower statement
 * means the walk has reached the head of the enclosing body and must stop
 * rather than wander into the block before it.
 */
function prevSiblingIndex(statements, idx, depth) {
  for (let k = idx - 1; k >= 0; k -= 1) {
    if (statements[k].depth < depth) return -1;
    if (statements[k].depth === depth) return k;
  }
  return -1;
}

/**
 * Indices of the statements that carry `needle` and enclose no nested statement
 * that also carries it — i.e. the RAISE itself, never the `DO $$ … $$;` block
 * around it. Diagnostics and neuter ranges must name the innermost unit; a
 * container would name the whole file.
 */
function innermostCarriers(statements, needle) {
  const out = [];
  for (let i = 0; i < statements.length; i += 1) {
    if (!statements[i].text.includes(needle)) continue;
    let nested = false;
    for (let j = i + 1; j < statements.length && statements[j].depth > statements[i].depth; j += 1) {
      if (statements[j].text.includes(needle)) {
        nested = true;
        break;
      }
    }
    if (!nested) out.push(i);
  }
  return out;
}

/**
 * The statement that RAISES `needle`, or null.
 *
 * Requires the carrier to match `RAISE EXCEPTION` in its MASKING PROJECTION, so
 * neither a mention inside a literal nor a commented-out (already neutered)
 * raise qualifies — a comment is not part of any statement, so it cannot be
 * one. This also narrows a real defect in the reader it replaces: that one
 * walked back over the WHOLE file for any line matching `RAISE EXCEPTION`, so a
 * bare `TEST FAILED (` literal produced a branch anchored on an unrelated raise
 * hundreds of lines earlier. A `TEST FAILED (` that is not raised is refused at
 * parse time by GRAMMAR rule 3a and at runtime by source-location attribution
 * (3c — `attributeIdentities`; the identity nonce until 2026-09-01) — the two
 * places it is decidable.
 */
function raiseStatementIndex(statements, needle) {
  for (const i of innermostCarriers(statements, needle)) {
    if (RAISE_EXCEPTION_RE.test(statements[i].executableText)) return i;
  }
  return -1;
}

/** A statement rendered on one line, for a diagnostic that must PRINT WHAT IT SAW (D-12). */
const oneLine = (statement) => statement.text.trim().replace(/\s*\n\s*/g, " ");

export function neuterArm(text, arm) {
  const lines = text.split("\n");
  const needle = `TEST FAILED (${arm})`;
  const statements = tokenizeStatements(text);

  const raiseIdx = raiseStatementIndex(statements, needle);
  if (raiseIdx === -1) {
    const carried = statements.some((s) => s.text.includes(needle));
    return {
      text,
      found: false,
      reason: carried
        ? `no RAISE EXCEPTION precedes "${needle}"`
        : `no statement contains "${needle}"`,
    };
  }
  const raiseStmt = statements[raiseIdx];

  // Absorb the abort-path cleanup that immediately precedes the RAISE. See the
  // header: leaving `RESET ROLE;` behind leaks a superuser session into every
  // later arm. The forward scan below still starts at the RAISE — starting it
  // here would terminate on `RESET ROLE;`'s own semicolon and leave the RAISE
  // live, which is a neuter that silently did nothing.
  //
  // ⭐ Absorption is now asked of a STATEMENT, so `IF NOT ok THEN RESET ROLE;
  // RAISE …;` on ONE line absorbs correctly — the old line walk started at the
  // line BEFORE the RAISE's and could not see a cleanup sharing its line.
  let startIdx = raiseIdx;
  for (;;) {
    const p = prevSiblingIndex(statements, startIdx, raiseStmt.depth);
    if (p === -1 || !ABSORBABLE_CLEANUP.test(statements[p].text)) break;
    startIdx = p;
  }
  const start = statements[startIdx].startLine - 1;

  // ── WR-07: refuse what we cannot classify, instead of leaking it ──────────
  // The absorbed set is ONE literal statement, and the header is explicit that
  // the `RESET ROLE;` leak "was loud HERE only by luck". An abort branch that
  // reads `RESET search_path;`, `SET ROLE postgres;`, `PERFORM set_config(…)`
  // or `ROLLBACK TO SAVEPOINT s;` before its RAISE produces the identical
  // class of silent state leak into every later arm, and the old code left it
  // live with no signal at all. Phase 164.4 backfills ~70 files against this
  // primitive, which is where the luck runs out.
  //
  // So: walk from the absorb point back to the head of the enclosing branch
  // and refuse anything that is not blank, not a comment, and not absorbable.
  // A refusal surfaces as a `neuter-missed` defect — loud, named, and fixable
  // by extending the absorbable set DELIBERATELY — which is strictly better
  // than a leak that makes downstream arms pass for the wrong reason.
  //
  // MEASURED 2026-08-29 against the real corpus: all 30 arms still execute and
  // bite, so this refuses nothing that exists today.
  // RE-MEASURED 2026-09-01 under the statement predicate (sample size and
  // coverage in the `isBranchHead` block above): 103 of 103 backward scans
  // agree with the deleted line predicate, 0 disagreements, the same 4 loud
  // refusals, 0 added. Full corpus run unchanged at arms 30/30/0, biting 30.
  // ⛔ ORDER IS LOAD-BEARING (R2-C01). Classify FIRST, terminate LAST, and
  // terminate only on a unit that IS a branch head (R3-C01), never on one that
  // merely MENTIONS a branch-head keyword. Round 1 fixed the loop ORDER; round
  // 2 added `--` stripping; round 3 still reached the leak through a string
  // literal, a block comment and a dollar-quoted body, because the predicate
  // was a bare word match; round 4 ([R4-C01]) reached it through a COMPOUND
  // LINE, because the predicate — structural by then — was still asked of a
  // LINE, and a line carrying a head plus two more statements answered "yes".
  //
  // ⭐ The walk is now over STATEMENTS at the RAISE's own nesting depth. That
  // closes the compound-line direction BY CONSTRUCTION rather than by a fifth
  // spelling rule: `EXCEPTION WHEN OTHERS THEN v_raised := true; END;`
  // decomposes into a head and two statements, so the statements are seen and
  // classified instead of being swallowed by the head's regex; and
  // `SET ROLE postgres; IF NOT ok THEN` decomposes so the privileged statement
  // is classified instead of hiding behind the head that follows it.
  //
  // Comments and blank regions need no special case any more: the tokenizer
  // never emits them as statements, so there is nothing to skip. That deletes
  // the line-local `IGNORABLE_LINE` predicate rather than keeping an
  // unreachable branch around it.
  //
  // THE RULE, stated once and implemented exactly: walking back from the absorb
  // point, every STATEMENT must be ignorable (the tokenizer emits none),
  // absorbable (ABSORBABLE_CLEANUP), or a branch head that terminates the walk.
  // Any other statement — INCLUDING ONE SHARING A LINE WITH THE HEAD, ON EITHER
  // SIDE OF IT — is refused, naming the statement and its line.
  //
  // Both sides matter and for the same reason. A statement AFTER the head on
  // its line is inside the branch and is reached by the walk normally. A
  // statement BEFORE the head on its line is [R4-C01]'s own spelling —
  // `SET ROLE postgres; IF NOT ok THEN` — and it is refused because the
  // branch's boundary and the LINE's boundary disagree there. Every one of the
  // four rounds of this defect was a boundary disagreement read as agreement,
  // and this rewrite is line-oriented: it comments whole lines, splices `NULL;`
  // at a line's indent, and addresses every diagnostic by line. Accepting a
  // head whose line begins with something else means trusting a coincidence.
  // Refusing is the loud direction, and the real corpus contains no such head
  // (re-measured — see the block above).
  const refuse = (stmt) => ({
    text,
    found: false,
    reason:
      `the abort branch for "${arm}" carries an unrecognised statement before its RAISE ` +
      `(line ${stmt.startLine}: ${oneLine(stmt)}). Neutering only the RAISE would leave that ` +
      `statement executing for the rest of the file — the measured RESET ROLE class, where a ` +
      `leaked superuser session made sixteen later arms pass for a reason unrelated to their ` +
      `grants. Extend ABSORBABLE_CLEANUP deliberately, or restructure the branch.`,
  });

  for (
    let k = prevSiblingIndex(statements, startIdx, raiseStmt.depth);
    k !== -1;
    k = prevSiblingIndex(statements, k, raiseStmt.depth)
  ) {
    const stmt = statements[k];
    if (stmt.executableText.trim() === "") continue;
    if (isBranchHead(stmt)) {
      const shares = prevSiblingIndex(statements, k, stmt.depth);
      if (shares !== -1 && statements[shares].endLine === stmt.startLine) {
        return refuse(statements[shares]);
      }
      break; // structurally a branch head, and it begins its own line
    }
    return refuse(stmt);
  }

  // ── [MUT-I01]: where the RAISE ENDS ──────────────────────────────────────
  //
  // ⛔ THE DELETED READER AND WHY IT WAS DELETED RATHER THAN REPAIRED. This
  // used to be a raw character walk from the RAISE's line, tracking ONE
  // character — `'`, with the `''` escape — and nothing else. An apostrophe
  // inside a `--` comment inside the RAISE's own span therefore flipped its
  // parity, and the two parities failed DIFFERENTLY:
  //
  //   ODD  — the real terminator was swallowed, no `;` was ever found, and a
  //          perfectly legal arm was refused as `neuter-missed`. Loud, false.
  //   EVEN — parity was restored by a second apostrophe AFTER the real
  //          terminator had been swallowed, so the walk ran on and ended on a
  //          LATER statement's `;`. The neuter then commented out a statement
  //          that had to survive, and reported success. SILENT.
  //
  // A repaired walk would have to know comments, which means knowing literals,
  // dollar quotes and block comments — that is the tokenizer. So the end of the
  // RAISE is simply the end of the RAISE's STATEMENT, and the duplicate walker
  // is gone. `terminated: false` (a statement running to EOF with no `;`) keeps
  // the one refusal that was always real: an unterminated statement is a
  // MEASURE failure, not a shorter statement.
  if (!raiseStmt.terminated) {
    return { text, found: false, reason: `could not find the end of the RAISE statement for "${arm}"` };
  }

  // ── The rewrite ──────────────────────────────────────────────────────────
  //
  // The span is a STATEMENT RANGE, from the first absorbed statement through
  // the RAISE's terminator. The whole-line splice below is correct only when
  // that range aligns to line boundaries — and the real corpus does not oblige:
  // `test_profiles_privileged_columns_locked.sql:97` puts a head, a
  // `RESET ROLE;`, a RAISE and an `END IF;` on ONE line. Commenting that whole
  // line deletes every statement on it, which is P5's silent over-neuter
  // reached by a different road. So a span that starts or ends mid-line is
  // rewritten AROUND: the code before it and after it on those lines is
  // re-emitted verbatim on its own line, and only the span is commented.
  const spanStart = statements[startIdx].start;
  const spanEnd = raiseStmt.end;
  const lineHead = text.lastIndexOf("\n", spanStart - 1) + 1;
  const prefix = text.slice(lineHead, spanStart);
  const tail = text.slice(spanEnd);
  const nl = tail.indexOf("\n");
  const suffix = nl === -1 ? tail : tail.slice(0, nl);
  const rest = tail.slice(suffix.length);

  // "Is there code out here?" is asked of the SAME masking projection every
  // other decision in this file uses — not of a second `^[ \t]*--` predicate.
  // A trailing `--` comment or a `/* … */` therefore goes with the neutered
  // statement, as it always has, without this line owning its own idea of what
  // a comment is. That second idea is how [VAC04-C1]'s composing blind spot is
  // built, and there is exactly one definition of code in this file.
  const startsOnOwnLine = executableText(prefix).trim() === "";
  const endsLine = executableText(suffix).trim() === "";

  if (startsOnOwnLine && endsLine) {
    const start = statements[startIdx].startLine - 1;
    const end = raiseStmt.endLine - 1;
    const indent = (lines[start].match(/^[ \t]*/) || [""])[0];
    const replacement = [
      ...lines.slice(start, end + 1).map((l) => `-- NEUTERED(${arm}) ${l}`),
      `${indent}NULL; -- neutered ${arm} by the mutation runner`,
    ];
    lines.splice(start, end - start + 1, ...replacement);
    return { text: lines.join("\n"), found: true };
  }

  const indent = (prefix.match(/^[ \t]*/) || [""])[0];
  const commented = text
    .slice(spanStart, spanEnd)
    .split("\n")
    .map((l) => `-- NEUTERED(${arm}) ${l}`)
    .join("\n");
  const rewritten =
    text.slice(0, lineHead) +
    (startsOnOwnLine ? "" : `${prefix.replace(/[ \t]+$/, "")}\n`) +
    `${commented}\n` +
    `${indent}NULL; -- neutered ${arm} by the mutation runner` +
    (endsLine ? suffix : `\n${suffix}`) +
    rest;
  return { text: rewritten, found: true };
}

/**
 * `git status --porcelain` as a line array, or null when it could not be run.
 * Null is propagated as a MEASURE_FAIL rather than collapsing to "clean".
 */
function gitStatus() {
  const proc = spawnSync("git", ["status", "--porcelain"], { cwd: REPO_ROOT, encoding: "utf8" });
  if (proc.status !== 0 || typeof proc.stdout !== "string") return null;
  return proc.stdout.split("\n").filter((l) => l.trim().length > 0);
}

// ===========================================================================
// 164.3.1-05 — ARM IDENTITY BY SOURCE LOCATION (supersedes the R3-C02 NONCE)
// ===========================================================================
//
// ⛔ THE DEFECT THIS CLOSES, and why the mechanism it replaces could not.
//
// The runner credits an arm as BITING when the lane's output names that arm.
// Rule 3a refuses an annotation whose injected text contains the literal
// `TEST FAILED (`; SQL concatenates string literals, so the literal never has
// to appear, and substring matching could never win — `format()`, `chr()`,
// `||` and a hundred other spellings produce the same bytes at runtime.
//
// R3-C02 (2026-08-29, SUPERSEDED — kept because it is the measured history
// this design is built on) answered that by stamping a per-run random NONCE
// into every identity in the SCRATCH copy of the gate:
//
//     TEST FAILED (ANON 1a)   ->   TEST FAILED (7f3c9a1e|ANON 1a)
//
// and reading only stamped identities. An annotation could not know the nonce,
// so any `TEST FAILED (` without the stamp was, by construction, text the
// runner did not put in the gate file: `synthesised-identity`.
//
// ⛔ WHY THAT WAS NOT ENOUGH — [R4-C02], MEASURED LIVE. The nonce is a SECRET
// TRANSMITTED TO THE ATTACKER. The stamped text sits in the query text of the
// statement the gate is running, and PostgreSQL hands that text to any
// server-side code that asks for it. An `AFTER INSERT` trigger installed by a
// `sql` step needs no file read and no superuser:
//
//     CREATE FUNCTION forge() RETURNS trigger AS $f$ BEGIN
//       RAISE EXCEPTION '%', substring(current_query() from 'TEST FAILED \([^)]*\)');
//     END $f$ LANGUAGE plpgsql;
//
// MEASURED: an arm whose own raise was guarded by `IF FALSE` scored
// `RED (identity ok)` with `biting: 1`. `biting` is the quantity ARMS_FLOOR
// bounds, so that was a vacuous PASS in the headline number — the same class
// the nonce existed to close, reached THROUGH the nonce.
//
// ⭐ THE REPLACEMENT (CONTEXT D-01, locked): the identity is no longer a
// SECRET that must be kept from the SQL. It is the raise's SOURCE LOCATION,
// which the executing SQL cannot choose. Nothing is transmitted, so
// `current_query()` and `pg_stat_activity` have nothing to read.
//
// The rule is THREE-LEGGED, and all three legs are load-bearing. Measured on
// PostgreSQL 16.13 through the real `pg-lane` with `VERBOSITY=verbose`
// (2026-09-01, this checkout; RESEARCH § The Key Measurement measured the same
// shapes independently):
//
//   (a) the `psql:<file>:<line>:` prefix names the GATE SCRATCH FILE this
//       runner wrote for this lane, at the failing statement's LAST line;
//   (b) the error's CONTEXT chain is EXACTLY ONE frame, of the shape
//       `PL/pgSQL function inline_code_block line N at RAISE`, bounded by the
//       `LOCATION:` sentinel verbose emits;
//   (c) N resolves through the Primitive A tokenizer's statement spans to the
//       arm's recorded raise line:  raise_file_line = DO_start + N − 1.
//
// ⚠️ LEG (b) IS THE ONE THAT IS EASY TO OMIT AND IMPOSSIBLE TO DO WITHOUT.
// Asserting only the INNERMOST frame is forgeable. A trigger that runs
// `EXECUTE 'DO $d$' || repeat(E'\n', k) || 'BEGIN RAISE …; END $d$'` produces
// an `inline_code_block line N at RAISE` frame whose NAME AND LINE are both
// attacker-chosen, under the gate file's own `psql:` prefix — legs (a) and (c)
// both PASS. MEASURED 2026-09-01: with k = 4 the forgery landed on the genuine
// arm's exact resolved line. What the attacker cannot REMOVE is the rest of
// the chain:
//
//     CONTEXT:  PL/pgSQL function inline_code_block line 5 at RAISE   ← forged
//     SQL statement "DO $d$ … END $d$"
//     PL/pgSQL function forge_fn() line 3 at EXECUTE
//     SQL statement "INSERT INTO t VALUES (1)"
//     PL/pgSQL function inline_code_block line 3 at SQL statement
//     LOCATION:  exec_stmt_raise, pl_exec.c:3911
//
// so the chain LENGTH is the control, and `164.3.1-05-ATTRIBUTION.md` records
// it flipping to a false `RED (identity ok)` when neutered to first-frame-only.
//
// ⚠️ HONEST RESIDUAL, named rather than implied — the boundary MOVED, it did
// not disappear:
//
//   1. A hostile annotation can still make the database print ARBITRARY TEXT.
//      What it can no longer do is make that text ATTRIBUTABLE: every forged
//      raise arrives with a chain it did not choose, so it scores SYNTHESISED
//      or NO-IDENTITY rather than RED. A hostile annotation also remains
//      visibly hostile in review, which is the final control.
//      ⚠️ MEASURED 2026-09-01, and it is the reason the chain rule needed its
//      own dedicated fixture: RESEARCH's forgery recipe is refused TWICE over.
//      It spells the identity inside the EXECUTEd DO string, psql prints that
//      string back as a `SQL statement "…"` CONTEXT frame, and a FIELD-carried
//      identity is unattributable independently of chain length. Neutering the
//      chain rule therefore did NOT flip it — so a "proof" run on that recipe
//      alone would have passed while proving nothing about leg (b). The echo
//      is removable (the trigger can stash the text in a GUC and have the
//      forged DO read it back with current_setting()); the chain is not. The
//      chain-length proof in 164.3.1-05-ATTRIBUTION.md is run against the
//      ECHO-FREE variant for exactly that reason.
//   2. A LEGITIMATE arm whose raise is nested inside `EXECUTE`, a helper
//      function or a trigger is refused NO-IDENTITY — BY DESIGN, LOUDLY. All
//      104 corpus identities raise directly from a DO body (single frame), so
//      the passing control holds corpus-wide; GRAMMAR.md § 3c states this as a
//      164.4 authoring rule so it is a contract rather than a surprise.
//   3. The psql CONTEXT format is MEASURED on macOS / PostgreSQL 16.13 ONLY.
//      The `sql-mutation` CI job has never executed on its ubuntu host at all
//      (WINDOWS.md 28), so this parse rides an already-unobserved host. That
//      residual is INHERITED, not absorbed: `attributeIdentities` reports
//      `measureFail` when the output carries psql-shaped diagnostics it cannot
//      parse into blocks (a changed format, or a localized `FEHLER:`/`KONTEXT:`
//      build), and the runner turns that into a LOUD defect. An unparseable
//      format must never read as "no attributable arm", because that is
//      indistinguishable from a real defect — and never as a pass.

/** psql's per-message header: `psql:<path>:<line>: <SEVERITY>:  <rest>`. */
const PSQL_HEADER_RE =
  /^psql:(.*):(\d+): (ERROR|FATAL|PANIC|WARNING|NOTICE|INFO|LOG|DEBUG):  (.*)$/;

/** A psql diagnostic FIELD line. `LOCATION` is verbose's end-of-block sentinel. */
const PSQL_FIELD_RE = /^(CONTEXT|DETAIL|HINT|QUERY|STATEMENT|LOCATION):  (.*)$/;

/** Anything psql-prefixed at all — used only to tell "no blocks" from "no output". */
const PSQL_PREFIXED_RE = /^psql:.+:\d+: /;

/** `VERBOSITY=verbose` puts the SQLSTATE in front of the message text. */
const VERBOSE_SQLSTATE_RE = /^([0-9A-Z]{5}): ([\s\S]*)$/;

/** The ONE legal CONTEXT chain: a single direct DO-body RAISE frame. */
const SINGLE_DO_FRAME_RE = /^PL\/pgSQL function inline_code_block line (\d+) at RAISE$/;

/** Every `TEST FAILED (<id>)` occurrence, with its identity. */
const IDENTITY_RE = /TEST FAILED \(([^)]*)\)/g;
/**
 * A FRESH regex over the same grammar — the ONE definition (IN-03, 164.3.1
 * review: this file spelled it five times). `matchAll` needs a global
 * instance and `match` a non-global one; a fresh clone per call also keeps
 * the shared IDENTITY_RE's `lastIndex` out of every reader.
 */
const identityRe = (flags = "") => new RegExp(IDENTITY_RE.source, flags);

/**
 * Attribution records for every arm identity RAISED by `gateText`.
 *
 * One record per (raise statement, identity). An identity raised twice yields
 * two records and attribution accepts EITHER, because both are the runner's
 * own text — the record set is a description of the file, not a claim of
 * uniqueness.
 *
 * ⚠️ Build this from the gate copy AS THE LANE WILL RUN IT — after neuters AND
 * after every mutation `edit`, read back off disk. A mutation may legally edit
 * the gate file (the real corpus's `N1 3a` does), and psql reports the lines of
 * the bytes it actually parsed. Building from the pre-mutation text would
 * resolve against lines that no longer exist.
 *
 * `stmtEndLine`/`stmtStartLine` are the ENCLOSING TOP-LEVEL (depth 0) statement
 * — the `DO $$ … $$;` block. psql's `psql:<file>:<N>:` prefix names that
 * statement's LAST line, and PL/pgSQL's CONTEXT line is relative to its FIRST
 * (line 1 = the remainder of the `DO $$` line), which is what makes
 * `stmtStartLine + contextLine − 1 === raiseFileLine` the resolution.
 * Verified 5×: RESEARCH § The Key Measurement (2×) and this checkout's own
 * `pg-lane` measurement of gate1/gate5/gate7 (3×), 2026-09-01.
 */
export function gateAttributionRecords(gateText) {
  const statements = tokenizeStatements(gateText);
  const records = [];
  for (const idx of innermostCarriers(statements, "TEST FAILED (")) {
    const stmt = statements[idx];
    // A commented-out (already neutered) raise is not a statement at all, and a
    // bare `TEST FAILED (` literal is not a raise — the same narrowing
    // `raiseStatementIndex` applies, for the same reason.
    if (!RAISE_EXCEPTION_RE.test(stmt.executableText)) continue;
    // The enclosing top-level statement: the last depth-0 statement at or
    // before this one. `tokenizeStatements` emits pre-order, so that is the
    // `DO $$ … $$;` block this raise lives inside.
    let top = null;
    for (let j = idx; j >= 0; j -= 1) {
      if (statements[j].depth === 0) {
        top = statements[j];
        break;
      }
    }
    if (top === null) continue;
    for (const arm of armIdentitiesInOrder(stmt.text)) {
      records.push({
        arm,
        raiseFileLine: stmt.startLine,
        stmtStartLine: top.startLine,
        stmtEndLine: top.endLine,
      });
    }
  }
  return records;
}

/**
 * Parse lane output into psql message blocks.
 *
 * A block starts at a `psql:<path>:<line>: <SEVERITY>:  …` header and runs to
 * the next header. Within it, `CONTEXT:`/`LOCATION:`/… start FIELDS; any other
 * line continues whatever is currently open (the message, or the last field).
 * That matters: a CONTEXT chain frame quoting a multi-line `SQL statement "…"`
 * spans several unprefixed lines (MEASURED — the nested-EXECUTE forgery), so
 * counting newlines between `CONTEXT:` and `LOCATION:` is NOT frame counting.
 *
 * @returns {{ blocks: object[], lineOwner: (object|null)[], lines: string[] }}
 */
function parsePsqlBlocks(output) {
  const lines = output.split("\n");
  const blocks = [];
  const lineOwner = new Array(lines.length).fill(null);
  let block = null;
  let part = null;

  for (let i = 0; i < lines.length; i += 1) {
    const header = PSQL_HEADER_RE.exec(lines[i]);
    if (header !== null) {
      const verbose = VERBOSE_SQLSTATE_RE.exec(header[4]);
      block = {
        path: header[1],
        line: Number(header[2]),
        severity: header[3],
        sqlstate: verbose ? verbose[1] : null,
        message: verbose ? verbose[2] : header[4],
        fields: [],
      };
      blocks.push(block);
      part = { kind: "message" };
      lineOwner[i] = { block, part };
      continue;
    }
    if (block === null) continue; // preamble / stdout before any message
    const field = PSQL_FIELD_RE.exec(lines[i]);
    if (field !== null) {
      const entry = { name: field[1], value: field[2] };
      block.fields.push(entry);
      part = { kind: "field", entry };
      lineOwner[i] = { block, part };
      continue;
    }
    // Continuation of whatever is open.
    if (part.kind === "message") block.message += `\n${lines[i]}`;
    else part.entry.value += `\n${lines[i]}`;
    lineOwner[i] = { block, part };
  }
  return { blocks, lineOwner, lines };
}

/**
 * Classify EVERY `TEST FAILED (…)` occurrence in lane `output`.
 *
 * @param {string} output   combined stderr+stdout of one lane
 * @param {{gatePath: string, records: {arm:string,raiseFileLine:number,stmtStartLine:number,stmtEndLine:number}[]}} ctx
 * @returns {{
 *   sightings: {identity:string, arm:string|null, why:string, seen:string}[],
 *   firstAttributed: string|null,
 *   unattributable: {identity:string, why:string, seen:string}[],
 *   measureFail: string|null,
 *   blocks: number,
 * }}
 *
 * ⚠️ The scan covers ALL output, not just the first ERROR. `RAISE NOTICE` can
 * carry a `TEST FAILED (…)` without aborting the lane at all (MEASURED: exit 0,
 * severity NOTICE, no CONTEXT chain), which is the property the nonce design's
 * `unstampedIdentities` had and this replacement must not lose.
 */
export function attributeIdentities(output, ctx) {
  const { blocks, lineOwner, lines } = parsePsqlBlocks(output);

  // ── MEASURE_FAIL: an output grammar we do not understand ──────────────────
  // Never a silent pass, and never "no attributable arm" — an unparseable
  // format is indistinguishable from a real defect, so it gets its own name.
  let measureFail = null;
  const psqlShaped = lines.filter((l) => PSQL_PREFIXED_RE.test(l));
  if (psqlShaped.length > 0 && blocks.length === 0) {
    measureFail =
      `the lane emitted ${psqlShaped.length} psql-prefixed diagnostic line(s) that this parser ` +
      `could not read as message blocks. The CONTEXT/severity grammar is measured on macOS / ` +
      `PostgreSQL 16.13 only (WINDOWS.md 28: the sql-mutation job has never run on its CI host), ` +
      `and a localized or changed psql build would land here. FIRST UNPARSED LINE: ` +
      `${JSON.stringify(psqlShaped[0])}`;
  }

  const sightings = [];
  for (let i = 0; i < lines.length; i += 1) {
    IDENTITY_RE.lastIndex = 0;
    let match;
    while ((match = IDENTITY_RE.exec(lines[i])) !== null) {
      const identity = match[1];
      const owner = lineOwner[i];
      const seen = oneLineOf(lines[i]);
      if (owner === null) {
        sightings.push({
          identity,
          arm: null,
          why: "outside any psql message block (raw stdout/stderr text)",
          seen,
        });
        continue;
      }
      if (owner.part.kind !== "message") {
        sightings.push({
          identity,
          arm: null,
          why: `carried by the ${owner.part.entry.name} field of a ${owner.block.severity} block, not by its message`,
          seen,
        });
        continue;
      }
      sightings.push(judgeBlock(identity, owner.block, ctx, seen));
    }
  }

  const firstAttributed = sightings.find((s) => s.arm !== null)?.arm ?? null;
  return {
    sightings,
    firstAttributed,
    unattributable: sightings.filter((s) => s.arm === null),
    measureFail,
    blocks: blocks.length,
    // Carried through so a diagnostic can state the EXPECTATION from the same
    // records the judgement used — two readers of one fact, never two facts.
    records: ctx.records,
  };
}

/**
 * Where a genuine raise of `identity` WOULD have to come from, in file:line
 * terms — the "expected" half of a diagnostic that must print what it saw AND
 * what it wanted (SC-7). Reads the same records the judgement used, so the two
 * halves cannot drift apart.
 */
function describeExpectedRaise(attribution, identity, gatePath) {
  const recs = (attribution.records ?? []).filter((r) => r.arm === identity);
  if (recs.length === 0) return `a raise of "${identity}" — but the gate file declares none`;
  return recs
    .map(
      (r) =>
        `${gatePath}:${r.raiseFileLine} (statement ${r.stmtStartLine}-${r.stmtEndLine}, so psql ` +
        `prefix :${r.stmtEndLine} and CONTEXT line ${r.raiseFileLine - r.stmtStartLine + 1})`,
    )
    .join(" or ");
}

/** Every identity the lane emitted and what became of it — the "what I saw" half. */
function describeSightings(attribution) {
  if (attribution.sightings.length === 0) return "none — the lane emitted no TEST FAILED (…) at all";
  return attribution.sightings
    .map((s) => `"${s.identity}" → ${s.arm === null ? `UNATTRIBUTABLE (${s.why})` : s.arm}`)
    .join("; ");
}

/** One line, bounded — a diagnostic must PRINT WHAT IT SAW without printing a novel. */
function oneLineOf(text) {
  const flat = text.trim().replace(/\s*\n\s*/g, " ");
  return flat.length > 200 ? `${flat.slice(0, 200)}…` : flat;
}

/** The three-legged rule, applied to one identity sighting in one block's message. */
function judgeBlock(identity, block, ctx, seen) {
  const no = (why) => ({ identity, arm: null, why, seen });

  if (block.severity !== "ERROR") {
    return no(`severity is ${block.severity}, not ERROR — a NOTICE/WARNING cannot fail an arm`);
  }
  if (block.sqlstate !== "P0001") {
    return no(
      `SQLSTATE is ${block.sqlstate === null ? "absent (is VERBOSITY=verbose set?)" : block.sqlstate}, ` +
        `not P0001 — the error is not a RAISE EXCEPTION`,
    );
  }
  // ── leg (a): the psql prefix names THIS lane's gate scratch file ──────────
  if (block.path !== ctx.gatePath) {
    return no(`raised from ${block.path}, not from this lane's gate file ${ctx.gatePath}`);
  }
  // ── leg (b): the CONTEXT chain is EXACTLY ONE direct DO-body RAISE frame ──
  const contextIdx = block.fields.findIndex((f) => f.name === "CONTEXT");
  if (contextIdx === -1) {
    return no(
      `the error carries NO CONTEXT chain (fields: ${block.fields.map((f) => f.name).join(", ") || "none"}) ` +
        `— a PL/pgSQL RAISE always has one`,
    );
  }
  if (!block.fields.slice(contextIdx + 1).some((f) => f.name === "LOCATION")) {
    return no(
      "the CONTEXT chain is not bounded by a LOCATION sentinel — its extent is unknown, so its " +
        "frame count cannot be asserted (is VERBOSITY=verbose set on this leg?)",
    );
  }
  const chain = block.fields[contextIdx].value;
  const frame = SINGLE_DO_FRAME_RE.exec(chain.trim());
  if (frame === null) {
    const chainLines = chain.trim().split("\n");
    return no(
      `the CONTEXT chain is not EXACTLY ONE "inline_code_block line N at RAISE" frame — it has ` +
        `${chainLines.length} line(s), first: ${JSON.stringify(oneLineOf(chainLines[0] ?? ""))}. ` +
        `A nested EXECUTE, a helper function or a trigger forges the INNERMOST frame; it cannot ` +
        `forge the chain's LENGTH`,
    );
  }
  // ── leg (c): the frame line resolves to a raise the RUNNER's gate declares ─
  const contextLine = Number(frame[1]);
  const candidates = ctx.records.filter((r) => r.arm === identity);
  if (candidates.length === 0) {
    return no(`the gate file this lane ran declares no RAISE for "${identity}"`);
  }
  for (const rec of candidates) {
    if (block.line !== rec.stmtEndLine) continue;
    if (rec.stmtStartLine + contextLine - 1 !== rec.raiseFileLine) continue;
    return { identity, arm: identity, why: "attributed", seen };
  }
  const shown = candidates
    .map((r) => `${ctx.gatePath}:${r.raiseFileLine} (block ${r.stmtStartLine}-${r.stmtEndLine})`)
    .join(", ");
  return no(
    `source location does not match: psql reported statement end line ${block.line} and CONTEXT ` +
      `line ${contextLine} (resolving to file line ${candidates[0].stmtStartLine + contextLine - 1}), ` +
      `but "${identity}" is raised at ${shown}`,
  );
}

/**
 * Every arm identity the first-failure check could read out of `text`, sorted.
 *
 * ⛔ R2-W04. GRAMMAR rule 3 refuses a mutation that WRITES a `TEST FAILED (`
 * literal. That is one spelling of the attack. The general shape carries no
 * such literal at all — it RE-TARGETS an existing raise so a DIFFERENT arm
 * reports under the arm-under-test's ID:
 *
 *   {"kind":"edit","file":"supabase/tests/…","find":"ANON 1a): ",
 *    "replace":"N1 1a): ","occurrences":1}
 *
 * MEASURED at HEAD: the parser accepted that verbatim, and applying it moved
 * `ANON 1a` from 1 occurrence to 0 and `N1 1a` from 1 to 2. The first-failure
 * reader (`firstFailureArm` then; `attributeIdentities` since 2026-09-01)
 * would then read `N1 1a`, the runner would report `RED (identity ok)`, and
 * `biting` would rise for an arm whose own logic never ran — the exact outcome
 * rule 3 exists to prevent, reached without the literal rule 3 looks for.
 *
 * The invariant that closes the CLASS is stated over the FILE rather than over
 * the annotation's spelling: a mutation may change what the gate DOES, never
 * who it says it is, and never the condition under which it says it.
 *
 * ⛔ R3-W01 + R3-C02. The first version of this compared a SORTED MULTISET of
 * identities, which is blind in two measured ways:
 *
 *   - SWAPS. Exchanging two arms' identities leaves the sorted multiset
 *     byte-identical, so a single `edit` spanning both raises returned `null`.
 *     Combined with a step that breaks the OTHER arm, that arm then reports
 *     under the arm-under-test's ID — the outcome the rule exists to refuse,
 *     reached THROUGH the rule.
 *   - GUARD NEGATION. `IF NOT raised THEN` -> `IF TRUE THEN` preserves every
 *     identity exactly, and MEASURED against the real gate it parsed clean,
 *     applied cleanly and returned `null` from the multiset compare — while
 *     the `WITH CHECK` the arm claims to test was never evaluated.
 *
 * So the unit of the invariant is now the FAILURE BRANCH: the exact text from
 * the head of the branch enclosing a `TEST FAILED (` raise through the end of
 * that raise's statement, in FILE ORDER. A mutation must leave that ordered
 * list byte-identical. That covers identity rewrites, identity swaps
 * (position-sensitive), guard negations (the head is part of the block), and
 * injected raises carrying the literal (a new block appears).
 *
 * ⚠️ WHAT IT DOES NOT COVER, stated rather than implied: a raise INJECTED with
 * the literal spelled indirectly (`'TEST FAI' || 'LED (X)'`) is not recognised
 * as a failure branch, so it does not appear in either list. That half of the
 * class is closed at RUNTIME by the source-location attribution above, which is
 * the only place it can be closed — see `attributeIdentities`. (Until
 * 2026-09-01 that runtime closure was the identity nonce; it was superseded
 * because the nonce transmitted its secret to the server — [R4-C02].)
 *
 * MEASURED 2026-08-29 across the real corpus — 30 annotated arms, 49 file
 * steps — 0 violations. The widened rule refuses nothing that exists today.
 *
 * ⚠️ NEUTERS ARE NOT SUBJECT TO THIS, deliberately: neutering an arm removes
 * its identity ON PURPOSE. The comparison is taken across a MUTATION step
 * only, with the post-neuter text as its "before", so a branch the neuter
 * commented out is absent from both sides.
 */
export function armIdentities(text) {
  return [...text.matchAll(identityRe("g"))].map((m) => m[1]).sort();
}

/** Identities in FILE ORDER — position-sensitive, so a swap is visible. */
export function armIdentitiesInOrder(text) {
  return [...text.matchAll(identityRe("g"))].map((m) => m[1]);
}

/**
 * Every FAILURE BRANCH in `text`, in file order: `{ id, text }` where `text` is
 * the exact source from the enclosing branch head through the end of the RAISE.
 *
 * The backward walk reuses the same STATEMENT TOKENIZER `neuterArm` uses, so
 * "what counts as a branch head" has ONE definition across this file rather
 * than two that can drift apart.
 */
/**
 * How far back a failure branch's head may sit from its RAISE.
 *
 * MEASURED 2026-08-29 on `supabase/tests/test_strategy_shares_rls.sql`: the
 * furthest any of the 104 identities sits from its enclosing branch head is
 * printed by the REAL CORPUS arm in `mutation-annotation-parser.test.ts`, and
 * the bound is pinned well above it so a normal arm never falls back.
 */
const FAILURE_BRANCH_LOOKBACK = 40;

/**
 * A block CLOSER — `END LOOP;`, `END IF;`, `END CASE;`, `END;` — and its kind,
 * or null. A closed block sitting between a raise and its guard is ONE
 * compound statement OF the branch, not the branch's head, so the walk in
 * `failureBranches` steps OVER it to the statement that opened it and keeps
 * walking.
 *
 * CR-01 (164.3.1 review), MEASURED 2026-09-02 on `IF NOT ok THEN <block>
 * RAISE …`: with the loop closer tokenized as a head the branch was anchored
 * on `END LOOP;`; with it a plain statement the anchor only moved to the loop's
 * own `FOR … LOOP` head — and a nested `IF … END IF;` or `BEGIN … END;`
 * anchored on ITS opener the same way. In every shape `IF NOT ok THEN` →
 * `IF TRUE THEN` behind the block returned null: guard negation, invisible
 * (GRAMMAR § 3b, R3-C02 secondary). Read in the masking projection, so a
 * closer inside a literal or a comment is not one.
 */
const BLOCK_CLOSER_RE = /^END(?:\s+(LOOP|IF|CASE))?\s*;$/i;
function blockCloserKind(statement) {
  const m = BLOCK_CLOSER_RE.exec(statement.executableText.trim());
  return m === null ? null : (m[1] ?? "BLOCK").toUpperCase();
}

/**
 * Does `statement` OPEN a block of `kind`? `IF`/`LOOP`/`BEGIN` openers are the
 * tokenizer's own heads; a `CASE` statement's opener is the plain statement
 * that begins with the word (its `WHEN … THEN` is swallowed by the tokenizer's
 * case-depth rule), so that one is keyed on the first word alone.
 */
function opensBlock(statement, kind) {
  const words = statement.executableText.trim().split(/\s+/);
  const first = words[0].toUpperCase();
  const last = words[words.length - 1].toUpperCase();
  switch (kind) {
    case "LOOP":
      return isBranchHead(statement) && last === "LOOP";
    case "IF":
      return isBranchHead(statement) && first === "IF" && last === "THEN";
    case "BLOCK":
      return isBranchHead(statement) && words.length === 1 && first === "BEGIN";
    case "CASE":
      return first === "CASE";
    default:
      return false;
  }
}

/**
 * Index of the sibling that opens the block `closerIdx` closes, nesting-aware,
 * or -1 when no opener sits among the siblings (malformed, or opened above the
 * enclosing body — the lane refuses such a file either way).
 */
function blockOpenerIndex(statements, closerIdx, depth, kind) {
  let nest = 0;
  for (
    let k = prevSiblingIndex(statements, closerIdx, depth);
    k !== -1;
    k = prevSiblingIndex(statements, k, depth)
  ) {
    if (blockCloserKind(statements[k]) === kind) {
      nest += 1;
      continue;
    }
    if (opensBlock(statements[k], kind)) {
      if (nest === 0) return k;
      nest -= 1;
    }
  }
  return -1;
}

export function failureBranches(text) {
  const lines = text.split("\n");
  const statements = tokenizeStatements(text);
  const out = [];
  for (const idx of innermostCarriers(statements, "TEST FAILED (")) {
    const stmt = statements[idx];
    // A commented-out (neutered) raise is not a statement at all, so it cannot
    // reach here — the tokenizer's masking, not a `^--` line test, is what
    // excludes it.
    if (!RAISE_EXCEPTION_RE.test(stmt.executableText)) continue;
    const m = stmt.text.match(identityRe());
    if (!m) continue;

    // Walk back to the NEAREST branch head. The guard is the load-bearing part
    // of the block: `IF NOT raised THEN` -> `IF TRUE THEN` preserves every
    // identity and every raise, and MEASURED against the real gate it passed
    // the old multiset compare while making the arm fire without evaluating
    // the property it claims to test (R3-C02, secondary).
    //
    // Intervening non-head statements (the corpus's `RESET ROLE;` abort-path
    // cleanup) are walked THROUGH, unlike `neuterArm`, which refuses them —
    // there the concern is what stays live after a rewrite, here it is only
    // where the block begins.
    //
    // BOUNDED so a raise with no enclosing branch cannot swallow the file. If
    // no head is found inside the bound the block is the raise statement alone,
    // which is the narrow direction; that is safe here only because
    // source-location attribution (`attributeIdentities`, GRAMMAR rule 3c —
    // not this function) is what closes the injection half of the class. The
    // identity nonce that used to close it was deleted in plan 05 (IN-01).
    let headLine = stmt.startLine;
    for (
      let k = prevSiblingIndex(statements, idx, stmt.depth);
      k !== -1 && stmt.startLine - statements[k].startLine <= FAILURE_BRANCH_LOOKBACK;
      k = prevSiblingIndex(statements, k, stmt.depth)
    ) {
      const closer = blockCloserKind(statements[k]);
      if (closer !== null) {
        // A closed block is walked OVER, never anchored on: its opener heads
        // the block, not the branch (CR-01). An unmatched closer ends the walk
        // at the raise alone — the narrow direction, same as the bound above.
        k = blockOpenerIndex(statements, k, stmt.depth, closer);
        if (k === -1) break;
        continue;
      }
      if (isBranchHead(statements[k])) {
        headLine = statements[k].startLine;
        break;
      }
    }

    // The raise's end is its STATEMENT's end. The second copy of the
    // single-quote-only forward walker that used to live here — the other half
    // of [MUT-I01] — is deleted, not wrapped.
    out.push({ id: m[1], text: lines.slice(headLine - 1, stmt.endLine).join("\n") });
  }
  return out;
}

/** `null` when the mutation preserved every failure branch; otherwise a description. */
export function identityRewriteDetail(before, after, file) {
  const b = failureBranches(before);
  const a = failureBranches(after);
  if (b.length === a.length && b.every((x, i) => x.text === a[i].text)) return null;

  const changed = [];
  for (let i = 0; i < Math.max(b.length, a.length); i += 1) {
    if (b[i]?.text === a[i]?.text) continue;
    changed.push(
      `#${i + 1} ${JSON.stringify(b[i]?.id ?? null)} -> ${JSON.stringify(a[i]?.id ?? null)}`,
    );
    if (changed.length === 4) break;
  }

  return (
    `MEASURE_FAIL: the mutation REWRITES a failure branch in ${file} ` +
    `(${b.length} branch(es) before, ${a.length} after; first differences: ${changed.join(", ")}). ` +
    `A mutation may change what the gate DOES; it may never change who the gate SAYS IT IS, nor ` +
    `the condition under which it says it. Re-pointing a raise makes the first-failure check ` +
    `attribute another arm's failure to this one; negating a guard makes the arm fire without ` +
    `evaluating the property it claims to test. Either way the arm would count as biting without ` +
    `its own logic ever running. Mutate the code under test, not the failure branch.`
  );
}

// ---------------------------------------------------------------------------
// Lane invocation
// ---------------------------------------------------------------------------

/**
 * The three legs a lane can be spawned for. `arm` is the only one the verdict
 * loop counts as executed; `baseline` and `restore` bracket a gate's arms and
 * are tallied separately so the cross-check below compares like with like.
 */
const LANE_LEGS = ["baseline", "arm", "restore"];

/**
 * 164.3.1-10 — THE LANE RUNNER'S OWN TALLY, one counter per leg.
 *
 * ⭐ INDEPENDENCE IS THE CONTROL (SP-C05). This is incremented in exactly one
 * place — inside `runLane`, beside the `spawnSync` that actually starts a
 * lane — and read by `runCorpus` only as a snapshot delta. The verdict loop's
 * `armsExecuted` is a DIFFERENT variable in a DIFFERENT function. The two can
 * agree only if the loop really drove a lane for every arm it counted; one
 * variable incremented in two places would agree with itself by construction
 * and prove nothing. A stub that replaces `runLane` wholesale, a branch that
 * skips the call, or a short-circuit that returns a canned result all leave
 * this counter behind — which is exactly the state `absurdityViolations`
 * exists to name. Monotonic on purpose: nothing resets it, so no caller can
 * zero it to make a run look consistent.
 */
const laneTally = { baseline: 0, arm: 0, restore: 0 };

function runLane({ workdir, applyAbs, postApplyAbs, gateAbs, leg }) {
  // Refuse to guess which leg this is: an untagged lane would be an
  // unaccounted invocation, and the cross-check treats that as absurd.
  if (!LANE_LEGS.includes(leg)) throw new Error(`runLane: unknown leg ${JSON.stringify(leg)}`);
  const args = [LANE, "--workdir", workdir, "--apply", ...applyAbs];
  if (postApplyAbs) args.push("--post-apply", postApplyAbs);
  args.push("--gate", gateAbs);
  const started = Date.now();
  const proc = spawnSync("bash", args, { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
  // Counted at the spawn, after it returned: a lane is an invocation only if
  // the process was actually started, never because this function was entered.
  laneTally[leg] += 1;
  // stderr first: psql streams RAISE output there, and ON_ERROR_STOP=1 aborts
  // at the first failing statement, so emission order is failure order.
  const output = `${proc.stderr || ""}\n${proc.stdout || ""}`;
  return { status: proc.status, output, seconds: (Date.now() - started) / 1000 };
}

// ===========================================================================
// 164.3.1-10 — THE RUNNER'S ABSURDITY FLOOR (D-09 runner half; SC-7/SC-8/SC-9)
// ===========================================================================
//
// ⛔ THE DEFECT THIS CLOSES. Until this plan `armsExecuted` was ONE tally,
// incremented in the verdict loop, and nothing compared it to what actually
// ran. A runner whose lane path was stubbed, skipped or short-circuited would
// still print `arms: 30/30/0` and `biting: 30`, clear both floors and exit 0.
// That is the `--parse-only` shape — a run that executed nothing reading as a
// full PASS — reached INSIDE the process, where the CI count-recheck step's
// executed-is-zero guard cannot see it because the number it reads is the
// one that lied. And it is VAC-08's 253-of-262 in mirror image: a gate
// holding every number needed to know its own verdict was absurd, and never
// comparing them.
//
// THE RULE — two INDEPENDENT tallies and one arithmetic invariant, all three
// printed on every run and re-asserted by the sql-mutation job's count-recheck
// step (which parses the printed `lane-invocations:` line and MEASURE_FAILs
// on its absence, so a runner that stops printing it fails CI):
//
//   armsExecuted     the verdict loop's count           (`armsExecuted += 1`)
//   laneInvocations  arm-leg lanes the LANE RUNNER itself counted at the
//                    spawn                              (`laneTally.arm`)
//   biting           executed minus the non-biting defect kinds
//
//   (1) armsExecuted === laneInvocations — EXACT, in both directions. Fewer
//       lanes than arms: arms were CLAIMED that never ran. More lanes than
//       arms: lanes ran that no verdict accounts for.
//   (2) biting <= armsExecuted — the impossible count. Trivially true of this
//       program (biting is executed minus a subset), asserted anyway because
//       the CI step reads these numbers out of a text file it did not
//       produce, and "these two cannot disagree" is worth stating about the
//       FILE (ci.yml's R2-I01 note; this is its in-process twin).
//
// ─── MEASURED (SC-9) — quoted from plan 164.3.1-09's committed record, ─────
// ─── never re-measured from memory ─────────────────────────────────────────
//   RECORD        .planning/phases/164.3.1-sound-primitives-the-neuter-scan-
//                 and-the-mutation-identity-c/164.3.1-09-REDERIVATION.md
//   DATE / HEAD   2026-09-01, HEAD a305a71a, under the statement tokenizer
//                 (plan 01) and source-location attribution (plan 05)
//   COMMAND       `node scripts/mutation-runner/run.mjs` -> exit 0
//                   coverage: files 1/71
//                   arms: 30/30/0   (executed/annotated/waived)
//                   biting: 30
//   SILENT SHAPE  executed 30 / lane arm-invocations 30 / biting 30
//                 -> 0 violations (the legitimate corpus; re-observed on the
//                 real corpus with the new line printed — 164.3.1-10-SUMMARY)
//   SAMPLE SIZE   30 arms executed, all 30 `RED (identity ok)`, 0 moved from
//                 the pre-phase per-arm baseline; 1 baseline + 1 restore leg
//   COVERAGE      1 annotated gate file of 71 in supabase/tests/
//                 (test_strategy_shares_rls.sql, blob 5ae6855f, byte-identical
//                 at the phase base and at HEAD)
//   FIRES SHAPE   the severed tally: executed 30 / invocations 0 / biting 30
//                 -> 1 violation, exit 1, all three numbers printed. Observed
//                 on the REAL runner under a byte-backed neuter of the
//                 `laneTally[leg] += 1` line, restore sha-verified
//                 (164.3.1-10-SUMMARY.md) — the WIRING fires, not only the
//                 helper (RESEARCH Pitfall 6).
//   SEPARATION    there is no threshold to tune. The legitimate shape sits at
//                 equality (30 = 30); the absurd shape sits at 30 vs 0. The
//                 "wide separation" D-10 asks of a floor is here the full
//                 width of the count, because the rule is exact rather than
//                 a ratio — a single missing lane (30 vs 29) also fires.
//
// ⚠️ WHAT THIS DOES NOT COVER, stated rather than implied: the tally counts
// SPAWNS. A lane that was started but did nothing useful (a `run.sh` that
// exited early, a cluster that never booted) is counted as an invocation;
// that half is covered by the baseline/restore GREEN legs and by
// source-location attribution, which refuse to credit an arm whose output
// carries no attributable raise. This floor bounds "did the loop drive a lane
// per arm", nothing more — and it says so.
//
// Template: scripts/test-ledger-drift-check.sh's ABSURDITY FLOOR (VAC-08) —
// diagnostic first, then the refusal, and the sentence that this is the GATE
// failing, not the thing it measures.

/**
 * PURE. Returns one evidence string per violated invariant, or [] when the
 * three counts are mutually consistent. Every string carries all three
 * numbers in a machine-readable tail and says it is the gate failing — a bare
 * conclusion is the repudiation shape SC-7 refuses.
 *
 * @param {{armsExecuted: number, laneInvocations: number, biting: number}} counts
 * @returns {string[]}
 */
export function absurdityViolations({ armsExecuted, laneInvocations, biting }) {
  const tail = `(executed=${armsExecuted} lane-invocations=${laneInvocations} biting=${biting})`;
  const gate = "MEASURE_FAIL — this is the GATE failing, not the corpus:";
  const isCount = (n) => Number.isInteger(n) && n >= 0;
  // An absent or malformed measurement must never read as a consistent one.
  if (![armsExecuted, laneInvocations, biting].every(isCount)) {
    return [
      `${gate} the three counts cannot be cross-checked because at least one is not a ` +
        `non-negative integer ${tail}. An unmeasurable count is not a count of zero.`,
    ];
  }
  const out = [];
  if (armsExecuted > laneInvocations) {
    out.push(
      `${gate} the verdict loop counted ${armsExecuted} executed arm(s) but the lane runner ` +
        `spawned only ${laneInvocations} arm lane(s) ${tail}. ${armsExecuted - laneInvocations} ` +
        `arm(s) were CLAIMED without a lane ever running — the parse-only shape, reached inside ` +
        `the process. Neither \`arms:\` nor \`biting:\` above is a measurement on this run.`,
    );
  } else if (laneInvocations > armsExecuted) {
    out.push(
      `${gate} the lane runner spawned ${laneInvocations} arm lane(s) but the verdict loop counted ` +
        `only ${armsExecuted} executed arm(s) ${tail}. ${laneInvocations - armsExecuted} lane(s) ` +
        `are UNACCOUNTED for — they ran and no verdict describes what they found.`,
    );
  }
  if (biting > armsExecuted) {
    out.push(
      `${gate} biting (${biting}) exceeds executed (${armsExecuted}) ${tail}. Biting is executed ` +
        `minus a subset of the defects, so this count is impossible for one run of this program; ` +
        `either the counts were assembled from two runs or the arithmetic was tampered with.`,
    );
  }
  return out;
}

/**
 * Copy the corpus into a scratch slot, PRESERVING repo-relative structure so an
 * annotation's `file` maps to its copy by path alone.
 */
function materialize(slotDir, relPaths) {
  const map = new Map();
  for (const rel of relPaths) {
    const src = join(REPO_ROOT, rel);
    if (!existsSync(src)) throw new Error(`corpus file not found: ${rel}`);
    const dst = join(slotDir, "src", rel);
    mkdirSync(dirname(dst), { recursive: true });
    copyFileSync(src, dst);
    map.set(rel, dst);
  }
  return map;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {string} opts.scopeDir         directory whose *.sql files form the corpus
 * @param {string|null} opts.onlyFile    repo-relative gate path to narrow to
 * @param {string|null} opts.onlyArm     arm ID to narrow to
 * @param {number} opts.filesFloor       ratchet; overridable ONLY by --self-test
 * @param {number} opts.armsFloor
 * @param {(s:string)=>void} opts.log
 */
export function runCorpus({
  scopeDir,
  onlyFile = null,
  onlyArm = null,
  filesFloor = FILES_FLOOR,
  armsFloor = ARMS_FLOOR,
  log = (s) => console.log(s),
}) {
  const narrowed = Boolean(onlyFile || onlyArm);
  const corpus = scanCorpus(scopeDir);
  const defects = [];
  const addDefect = (kind, arm, file, detail) => {
    if (!DEFECT_KINDS.includes(kind)) throw new Error(`unknown defect kind ${kind}`);
    defects.push({ kind, arm, file, detail });
  };

  let armsAnnotated = 0;
  let armsWaived = 0;
  let armsExecuted = 0;
  const waivers = [];
  const timings = [];

  // 164.3.1-10: the lane runner's tally is read as a DELTA across this run —
  // snapshot now, subtract at the summary. Never reset: this function does not
  // write that counter, and must not, or the two tallies stop being two.
  const laneTallyBefore = { ...laneTally };

  let targets = corpus.annotatedFiles;
  if (onlyFile) {
    const name = onlyFile.split("/").pop();
    targets = targets.filter((f) => f === name);
    if (targets.length === 0) {
      addDefect("parse", null, onlyFile, "--file names a gate with no line-start RED-UNDER markers");
    }
  }

  // Snapshot the working tree BEFORE any lane run. The invariant is "this run
  // did not touch the checkout", NOT "the developer has no uncommitted work" —
  // conflating those would make the guard fire on every in-progress edit, and a
  // guard that always fires gets disabled, which is how controls die.
  const treeBefore = gitStatus();

  const scratchRoot = mkdtempSync(join(tmpdir(), "mutation-runner-"));
  try {
    let slot = 0;
    const nextSlot = () => {
      const dir = join(scratchRoot, `slot-${slot++}`);
      mkdirSync(dir, { recursive: true });
      return dir;
    };

    for (const name of targets) {
      const gateAbsRepo = join(scopeDir, name);
      const gateRel = relative(REPO_ROOT, gateAbsRepo);
      const parsed = parseFile(gateAbsRepo);

      for (const err of parsed.errors) addDefect("parse", null, gateRel, err.message);
      if (!parsed.parity.ok) {
        addDefect(
          "parity",
          null,
          gateRel,
          `${parsed.parity.prose} prose RED-UNDER marker(s) vs ${parsed.parity.structured} RED-UNDER-M twin(s)`,
        );
      }
      if (!parsed.setup) {
        addDefect("parse", null, gateRel, "no RED-UNDER-SETUP line — the runner refuses to guess a corpus");
        continue;
      }

      const corpusRels = [...parsed.setup.apply, gateRel];

      // Static check: an annotation may only edit files this gate declares.
      let annotations = parsed.structured;
      const badRef = new Set();
      for (const ann of annotations) {
        for (const step of ann.apply) {
          if (step.kind === "sql") continue;
          if (!corpusRels.includes(step.file)) {
            addDefect(
              "bad-file-ref",
              ann.arm,
              gateRel,
              `step targets ${step.file}, which is not in this gate's RED-UNDER-SETUP apply list`,
            );
            badRef.add(ann.arm);
          }
        }
      }

      armsAnnotated += annotations.length;
      for (const ann of annotations) {
        if (ann.waiver) {
          armsWaived += 1;
          waivers.push({ arm: ann.arm, file: gateRel, reason: ann.waiver });
        }
      }

      // -------------------------------------------------------------------
      // Baseline: pristine copies must go GREEN before any mutation. A broken
      // corpus fails fast, so a red caused by the corpus is never miscredited
      // to a mutation.
      // -------------------------------------------------------------------
      const baseSlot = nextSlot();
      const baseMap = materialize(baseSlot, corpusRels);
      const baseline = runLane({
        workdir: join(baseSlot, "lane"),
        applyAbs: parsed.setup.apply.map((r) => baseMap.get(r)),
        postApplyAbs: null,
        gateAbs: baseMap.get(gateRel),
        leg: "baseline",
      });
      log(`  baseline  ${gateRel} — exit ${baseline.status} (${baseline.seconds.toFixed(1)}s)`);
      if (baseline.status !== 0) {
        addDefect(
          "baseline",
          null,
          gateRel,
          // ⚠️ This one reader is a PLAIN-TEXT needle on purpose, and it is the
          // only one left in the file. It reads no ARM IDENTITY DECISION: the
          // baseline leg runs the pristine gate with no mutation at all, so
          // there is no adversary and nothing to attribute — the string is
          // pure diagnostic, telling a human which raise fired in a corpus
          // that was supposed to be green. Nothing downstream consumes it.
          `pristine corpus did not go GREEN (exit ${baseline.status}); first failure: ${
            baseline.output.match(identityRe())?.[1] ?? "none"
          }`,
        );
        continue; // arms cannot be judged against a red baseline
      }

      // -------------------------------------------------------------------
      // Per arm.
      // -------------------------------------------------------------------
      for (const ann of annotations) {
        if (ann.waiver) continue;
        if (badRef.has(ann.arm)) continue;
        if (onlyArm && ann.arm !== onlyArm) continue;

        const armSlot = nextSlot();
        const armMap = materialize(armSlot, corpusRels);

        // Neuters first, on the GATE copy.
        let gateText = readFileSync(armMap.get(gateRel), "utf8");
        let neuterFailed = false;
        for (const entry of ann.neuter) {
          const result = neuterArm(gateText, entry.arm);
          if (!result.found) {
            addDefect("neuter-missed", ann.arm, gateRel, `could not neuter "${entry.arm}": ${result.reason}`);
            neuterFailed = true;
            break;
          }
          gateText = result.text;
        }
        if (neuterFailed) continue;

        // ⛔ 164.3.1-05: the gate text is written back VERBATIM. The R3-C02
        // nonce stamp that used to happen here is DELETED, not disabled — it
        // transmitted the runner's secret to the server inside the query text,
        // where `current_query()` handed it straight to an attacker's trigger
        // ([R4-C02], measured live). Nothing is transmitted now; the identity
        // is the raise's SOURCE LOCATION, read back off the lane's output.
        writeFileSync(armMap.get(gateRel), gateText);

        // Mutation steps, in order, on the copies.
        const sqlStatements = [];
        let measureFailed = false;
        for (const step of ann.apply) {
          if (step.kind === "sql") {
            sqlStatements.push(step.stmt);
            continue;
          }
          const target = armMap.get(step.file);
          const before = readFileSync(target, "utf8");
          const applied = applyFileStep(before, step);
          if (!applied.ok) {
            const needle = step.kind === "edit" ? step.find : step.anchor;
            addDefect(
              "occurrence-mismatch",
              ann.arm,
              gateRel,
              `MEASURE_FAIL: ${JSON.stringify(needle)} occurs ${applied.actual}x in ${step.file}, annotation claims ${step.occurrences}x — mutation NOT applied, so this arm was NOT tested`,
            );
            measureFailed = true;
            break;
          }
          const rewrite = identityRewriteDetail(before, applied.text, step.file);
          if (rewrite !== null) {
            addDefect("identity-rewrite", ann.arm, gateRel, rewrite);
            measureFailed = true;
            break;
          }
          writeFileSync(target, applied.text);
        }
        if (measureFailed) continue;

        let postApplyAbs = null;
        if (sqlStatements.length > 0) {
          postApplyAbs = join(armSlot, "post-apply.sql");
          writeFileSync(postApplyAbs, `${sqlStatements.map((s) => `${s};`).join("\n")}\n`);
        }

        const gateAbs = armMap.get(gateRel);
        const run = runLane({
          workdir: join(armSlot, "lane"),
          applyAbs: parsed.setup.apply.map((r) => armMap.get(r)),
          postApplyAbs,
          gateAbs,
          leg: "arm",
        });
        // The verdict loop's OWN count. Its twin is `laneTally.arm`, kept
        // inside runLane; the summary cross-checks the two (164.3.1-10).
        armsExecuted += 1;
        timings.push(run.seconds);

        // ── 164.3.1-05: attribute by SOURCE LOCATION ────────────────────────
        // Records come from the gate copy AS THE LANE RAN IT — read back off
        // disk AFTER the mutation steps, because a mutation may legally edit
        // the gate file and psql reports the lines of the bytes it parsed.
        const attribution = attributeIdentities(run.output, {
          gatePath: gateAbs,
          records: gateAttributionRecords(readFileSync(gateAbs, "utf8")),
        });
        const first = attribution.firstAttributed;
        const synthesised = attribution.unattributable;
        let verdict;
        if (attribution.measureFail !== null) {
          // The output grammar itself was unreadable. This must NEVER collapse
          // into "no attributable arm" — that reads identically to a real
          // defect and would let an unobserved host pass or fail for reasons
          // nobody can diagnose from the log.
          verdict = "MEASURE-FAIL(output-grammar)";
          addDefect(
            "synthesised-identity",
            ann.arm,
            gateRel,
            `MEASURE_FAIL: ${attribution.measureFail}. This arm was NOT judged — the runner could ` +
              `not read the lane's output, so neither RED nor GREEN is a measurement here.`,
          );
        } else if (synthesised.length > 0) {
          // ── An identity the runner cannot ATTRIBUTE was SYNTHESISED ───────
          // Checked FIRST, before red/no-red, and over ALL output rather than
          // the first ERROR — a `RAISE NOTICE` can carry the identity without
          // aborting the lane at all (MEASURED: exit 0, severity NOTICE). This
          // is the arbiter that cannot be re-spelled around, because it does
          // not read the annotation's text: it reads WHERE the raise came from.
          verdict = `SYNTHESISED(${synthesised[0].identity})`;
          addDefect(
            "synthesised-identity",
            ann.arm,
            gateRel,
            `MEASURE_FAIL: the lane emitted TEST FAILED (${synthesised[0].identity}), which this ` +
              `runner's gate file did not raise. WHY IT IS NOT ATTRIBUTABLE: ${synthesised[0].why}. ` +
              `WHAT WAS SEEN: ${synthesised[0].seen}. EXPECTED, for a genuine arm: an ERROR/P0001 ` +
              `block under ${gateAbs} whose CONTEXT chain is exactly one ` +
              `"PL/pgSQL function inline_code_block line N at RAISE" frame resolving to ` +
              `${describeExpectedRaise(attribution, synthesised[0].identity, gateAbs)}. The mutation ` +
              `satisfied the DETECTOR instead of the arm. This arm is NOT counted as biting. ` +
              `Mutate the code under test, never the failure output.` +
              (synthesised.length > 1 ? ` (+${synthesised.length - 1} further unattributable sighting(s))` : ""),
          );
        } else if (run.status === 0) {
          verdict = "NO-RED";
          addDefect(
            "no-red",
            ann.arm,
            gateRel,
            "the mutation applied (occurrence count verified) but the gate still passed — this arm cannot fail",
          );
        } else if (first === null) {
          verdict = "NO-IDENTITY";
          addDefect(
            "wrong-first-failure",
            ann.arm,
            gateRel,
            `gate exited ${run.status} but no "TEST FAILED (…)" in its output was ATTRIBUTABLE to a ` +
              `raise in ${gateAbs} — the failure is not attributable to any arm. EXPECTED: an ` +
              `ERROR/P0001 block under that path whose CONTEXT chain is exactly one ` +
              `"PL/pgSQL function inline_code_block line N at RAISE" frame resolving to ` +
              `${describeExpectedRaise(attribution, ann.arm, gateAbs)}. ` +
              `SIGHTINGS: ${describeSightings(attribution)}`,
          );
        } else if (first !== ann.arm) {
          verdict = `WRONG-ARM(${first})`;
          addDefect(
            "wrong-first-failure",
            ann.arm,
            gateRel,
            `first failure was "${first}", not "${ann.arm}" — red-anywhere is not success`,
          );
        } else {
          verdict = "RED (identity ok)";
        }

        // A neuter that silently missed leaves the shadowing arm live, which
        // would make the identity check fail for the wrong reason.
        //
        // ⚠️ This reads the PLAIN identity text ANYWHERE in the output, not an
        // attributed sighting, and that direction is deliberate. Under the
        // nonce this was `stampedIdentity(...)`, which a forgery could evade;
        // now the only thing a forgery can do here is make CI FAIL for an arm
        // that was neutered — the loud direction. A neuter that truly took
        // effect leaves the raise commented out, so the gate cannot emit it.
        for (const entry of ann.neuter) {
          if (run.output.includes(`TEST FAILED (${entry.arm})`)) {
            addDefect(
              "neuter-missed",
              ann.arm,
              gateRel,
              `neutered arm "${entry.arm}" still appeared in the output`,
            );
          }
        }

        log(
          `  arm ${ann.arm.padEnd(24)} exit ${String(run.status).padStart(3)}  ${verdict}  (${run.seconds.toFixed(1)}s)`,
        );
      }

      // -------------------------------------------------------------------
      // Restore leg (D-02): pristine copies GREEN again after the arm runs.
      // Mutations only ever touched copies, so this proves the corpus is
      // unchanged rather than merely asserting it.
      // -------------------------------------------------------------------
      const restoreSlot = nextSlot();
      const restoreMap = materialize(restoreSlot, corpusRels);
      const restore = runLane({
        workdir: join(restoreSlot, "lane"),
        applyAbs: parsed.setup.apply.map((r) => restoreMap.get(r)),
        postApplyAbs: null,
        gateAbs: restoreMap.get(gateRel),
        leg: "restore",
      });
      log(`  restore   ${gateRel} — exit ${restore.status} (${restore.seconds.toFixed(1)}s)`);
      if (restore.status !== 0) {
        addDefect("restore", null, gateRel, `pristine corpus did not go GREEN after the arm runs (exit ${restore.status})`);
      }
    }
  } finally {
    rmSync(scratchRoot, { recursive: true, force: true });
  }

  // -----------------------------------------------------------------------
  // The checkout must be untouched (T-164.3-13).
  // -----------------------------------------------------------------------
  const treeAfter = gitStatus();
  if (treeBefore === null || treeAfter === null) {
    // An absent measurement must never read as a pass.
    addDefect("dirty-checkout", null, null, "MEASURE_FAIL: could not run `git status --porcelain` to prove the checkout was untouched");
  } else {
    const before = new Set(treeBefore);
    const after = new Set(treeAfter);
    const changed = [
      ...treeAfter.filter((l) => !before.has(l)).map((l) => `+ ${l}`),
      ...treeBefore.filter((l) => !after.has(l)).map((l) => `- ${l}`),
    ];
    if (changed.length > 0) {
      addDefect(
        "dirty-checkout",
        null,
        null,
        `the run changed the working tree — mutations must only ever touch scratch copies:\n    ${changed.join("\n    ")}`,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Coverage + ratchet (D-01, D-09)
  // -----------------------------------------------------------------------
  log("");
  log(`coverage: files ${corpus.filesAnnotated}/${corpus.filesTotal}`);
  log(`arms: ${armsExecuted}/${armsAnnotated}/${armsWaived}   (executed/annotated/waived)`);
  // IN-05: the number ARMS_FLOOR is actually compared against, printed under
  // its own name.
  //
  // The floor here compares `biting` — executed arms MINUS those that failed
  // to redden or reddened on the wrong arm. The CI assertion parsed `arms:
  // E/A/W` and compared raw E, then reported an "ARMS_FLOOR regression" using
  // a quantity the constant was never measured against. On a run with any
  // non-biting arm the two disagree. That is not a hole — the runner exits 1
  // on such a run first — but two meanings under one name is how a floor
  // decays into a number nobody compares. So CI now reads THIS line.
  // ⛔ R3-C02: `synthesised-identity` MUST subtract here. It is raised for an
  // arm that DID execute a lane, so without this term the arm would still be
  // counted as biting — which is the whole defect: a vacuous PASS inflating
  // the one number ARMS_FLOOR bounds.
  const bitingArms =
    armsExecuted -
    defects.filter((d) => ["no-red", "wrong-first-failure", "synthesised-identity"].includes(d.kind))
      .length;
  log(`biting: ${bitingArms}   (executed arms that reddened their OWN arm first — the quantity ARMS_FLOOR bounds)`);
  // 164.3.1-10: the lane runner's OWN count of arm lanes, printed beside the
  // verdict loop's `arms:` so the two can be compared — here, and again by the
  // CI count-recheck step, which parses this line and MEASURE_FAILs on its
  // absence. The non-arm legs are printed as evidence, not compared.
  const laneLegs = {
    baseline: laneTally.baseline - laneTallyBefore.baseline,
    arm: laneTally.arm - laneTallyBefore.arm,
    restore: laneTally.restore - laneTallyBefore.restore,
  };
  const laneInvocations = laneLegs.arm;
  log(
    `lane-invocations: ${laneInvocations}   (arm lanes actually spawned — tallied inside runLane, ` +
      `independent of the ${armsExecuted} the verdict loop counted; plus ${laneLegs.baseline} ` +
      `baseline / ${laneLegs.restore} restore leg(s))`,
  );
  for (const w of waivers) log(`  waived: ${w.arm} — ${w.reason}`);
  if (timings.length > 0) {
    const total = timings.reduce((a, b) => a + b, 0);
    log(`per-arm lane time: mean ${(total / timings.length).toFixed(1)}s over ${timings.length} arm run(s)`);
  }

  if (narrowed) {
    log("");
    log("⚠️ NARROWED DIAGNOSTIC RUN (--file/--arm): coverage floors NOT enforced.");
    log("   This mode never exits 0, so it can never be mistaken for a passing gate.");
  } else {
    if (corpus.filesAnnotated < filesFloor) {
      addDefect(
        "floor",
        null,
        scopeDir,
        `FILES_FLOOR regression: ${corpus.filesAnnotated} annotated file(s) < floor ${filesFloor}`,
      );
    }
    if (bitingArms < armsFloor) {
      addDefect("floor", null, scopeDir, `ARMS_FLOOR regression: ${bitingArms} biting arm(s) < floor ${armsFloor}`);
    }
  }

  // -----------------------------------------------------------------------
  // Absurdity floor (164.3.1-10, D-09): the runner's own counts must agree.
  // Applied in EVERY mode, narrowed included — a diagnostic run that miscounts
  // is no more trustworthy than a full one. See absurdityViolations.
  // -----------------------------------------------------------------------
  for (const violation of absurdityViolations({ armsExecuted, laneInvocations, biting: bitingArms })) {
    addDefect("absurdity", null, null, violation);
  }

  // -----------------------------------------------------------------------
  // Aggregate report (OPS-08-F8): every arm ran; nothing exited early.
  // -----------------------------------------------------------------------
  log("");
  if (defects.length === 0) {
    log(narrowed ? "No defects in the narrowed scope." : "✅ No defects. Every annotated arm bit its own arm first.");
  } else {
    log(`❌ ${defects.length} defect(s):`);
    log("");
    log("  KIND                  ARM                       FILE");
    log("  --------------------  ------------------------  ----");
    for (const d of defects) {
      log(`  ${d.kind.padEnd(20)}  ${(d.arm ?? "-").padEnd(24)}  ${d.file ?? "-"}`);
      log(`      ${d.detail}`);
    }
  }

  return {
    scopeDir,
    narrowed,
    filesTotal: corpus.filesTotal,
    filesAnnotated: corpus.filesAnnotated,
    armsAnnotated,
    armsExecuted,
    armsWaived,
    // Exposed so the self-test can assert the number ARMS_FLOOR is compared
    // against, rather than re-deriving it from the defect list and agreeing
    // with the implementation by construction.
    bitingArms,
    // 164.3.1-10: the lane runner's arm-leg count this run was cross-checked
    // against, exposed for the same reason; the other legs beside it.
    laneInvocations,
    laneLegs,
    defects,
    exitCode: defects.length > 0 ? 1 : narrowed ? 2 : 0,
  };
}

// ---------------------------------------------------------------------------
/**
 * The directory a `--file <gate>` run is scoped to. IN-02 (164.3.1 review):
 * an ABSOLUTE gate path used to be joined onto cwd (`<cwd>/<abs>`), so the
 * scope pointed nowhere and the run reported "--file names a gate with no
 * line-start RED-UNDER markers" — loud (exit 1), but for the wrong reason.
 */
export function scopeDirForFile(onlyFile, cwd = process.cwd()) {
  const abs = isAbsolute(onlyFile) ? onlyFile : join(cwd, onlyFile);
  return join(REPO_ROOT, dirname(relative(REPO_ROOT, abs)));
}

// --parse-only: the STATIC half of the gate. No cluster, no mutation.
// ---------------------------------------------------------------------------
//
// Added by plan 164.3-08 because annotating 30 real arms needs a sub-second
// answer to "is every prose marker twinned, and does every needle still match
// the bytes it claims?". Booting a cluster per arm to learn that a JSON object
// is malformed is a 65-second answer to a 50-millisecond question.
//
// ⛔ THIS MODE IS NOT THE GATE AND MUST NEVER BE WIRED INTO CI AS ONE. It runs
// ZERO arms, so it cannot observe a non-biting annotation — the defect the
// whole phase exists to detect. It exits 0 on a clean parse (unlike
// --file/--arm, which exit 2) because it checks the WHOLE corpus rather than a
// subset, and its own contract is a static one it fully discharges. The
// mechanism that stops it being mistaken for the gate is not this comment: the
// CI job asserts the printed `arms:` line shows an EXECUTED count at or above
// ARMS_FLOOR, and this mode always prints 0 executed. Swap the invocation and
// that assertion fails.
//
// It DOES measure `occurrences` against the real bytes. That is a static
// measurement, not a mutation, and it is what catches the plan-01 prose-locator
// hazard (a needle that drifted, or was never there) without a cluster.
export function parseOnlyCorpus({ scopeDir, log = (s) => console.log(s) }) {
  const corpus = scanCorpus(scopeDir);
  const defects = [];
  const addDefect = (kind, arm, file, detail) => {
    if (!DEFECT_KINDS.includes(kind)) throw new Error(`unknown defect kind ${kind}`);
    defects.push({ kind, arm, file, detail });
  };

  let armsAnnotated = 0;
  let armsWaived = 0;
  const waivers = [];

  for (const name of corpus.annotatedFiles) {
    const gateAbsRepo = join(scopeDir, name);
    const gateRel = relative(REPO_ROOT, gateAbsRepo);
    const parsed = parseFile(gateAbsRepo);

    for (const err of parsed.errors) addDefect("parse", null, gateRel, err.message);
    if (!parsed.parity.ok) {
      addDefect(
        "parity",
        null,
        gateRel,
        `${parsed.parity.prose} prose RED-UNDER marker(s) vs ${parsed.parity.structured} RED-UNDER-M twin(s)`,
      );
    }
    log(
      `  ${gateRel}: ${parsed.parity.prose} prose / ${parsed.parity.structured} twin(s) / ` +
        `${parsed.structured.filter((a) => a.waiver).length} waiver(s)`,
    );

    armsAnnotated += parsed.structured.length;
    for (const ann of parsed.structured) {
      if (ann.waiver) {
        armsWaived += 1;
        waivers.push({ arm: ann.arm, file: gateRel, reason: ann.waiver });
      }
    }

    if (!parsed.setup) {
      addDefect("parse", null, gateRel, "no RED-UNDER-SETUP line — the runner refuses to guess a corpus");
      continue;
    }
    for (const rel of parsed.setup.apply) {
      if (!existsSync(join(REPO_ROOT, rel))) {
        addDefect("bad-file-ref", null, gateRel, `RED-UNDER-SETUP names a file that does not exist: ${rel}`);
      }
    }

    const corpusRels = [...parsed.setup.apply, gateRel];
    // WR-02 (164.3.1 review): MODE IDENTITY. `runCorpus` re-reads each target
    // after writing a step, so step N sees step N-1's output. This mode used
    // to count every step against the PRISTINE repo file, so a LAYERED
    // annotation (GRAMMAR Shape 3) whose second needle exists only after the
    // first was a MEASURE_FAIL here and clean in the real run. The text is
    // threaded forward per file, per annotation, exactly as the real run and
    // the REAL CORPUS arm in mutation-annotation-parser.test.ts do — and, as
    // there, the first step that cannot be applied ends the annotation.
    const buffers = new Map();
    for (const ann of parsed.structured) {
      buffers.clear();
      for (const step of ann.apply) {
        if (step.kind === "sql") continue;
        if (!corpusRels.includes(step.file)) {
          addDefect(
            "bad-file-ref",
            ann.arm,
            gateRel,
            `step targets ${step.file}, which is not in this gate's RED-UNDER-SETUP apply list`,
          );
          continue;
        }
        const target = join(REPO_ROOT, step.file);
        if (!existsSync(target)) {
          addDefect("bad-file-ref", ann.arm, gateRel, `step targets a file that does not exist: ${step.file}`);
          continue;
        }
        const needle = step.kind === "edit" ? step.find : step.anchor;
        if (!buffers.has(step.file)) buffers.set(step.file, readFileSync(target, "utf8"));
        const before = buffers.get(step.file);
        const actual = countOccurrences(before, needle);
        if (actual !== step.occurrences) {
          addDefect(
            "occurrence-mismatch",
            ann.arm,
            gateRel,
            `MEASURE_FAIL: ${JSON.stringify(needle)} occurs ${actual}x in ${step.file}, annotation claims ${step.occurrences}x`,
          );
          break;
        }
        // R2-W04: identity rewriting is decidable WITHOUT a lane, so refuse it
        // here too. `--parse-only` is what CI runs on platforms with no
        // database, and an annotation that re-points a raise must not have to
        // wait for a lane to be caught.
        const applied = applyFileStep(before, step);
        if (!applied.ok) break;
        const rewrite = identityRewriteDetail(before, applied.text, step.file);
        if (rewrite !== null) {
          addDefect("identity-rewrite", ann.arm, gateRel, rewrite);
          break;
        }
        buffers.set(step.file, applied.text);
      }
    }
  }

  log("");
  log(`coverage: files ${corpus.filesAnnotated}/${corpus.filesTotal}`);
  log(`arms: 0/${armsAnnotated}/${armsWaived}   (executed/annotated/waived)`);
  for (const w of waivers) log(`  waived: ${w.arm} — ${w.reason}`);
  log("");
  log("⚠️ STATIC PARSE ONLY — ZERO arms executed. This is NOT the gate: it cannot");
  log("   observe a non-biting annotation. Run `node scripts/mutation-runner/run.mjs`.");
  log("");

  if (defects.length === 0) {
    log("✅ No static defects. Every prose marker has a twin and every needle still matches.");
  } else {
    log(`❌ ${defects.length} static defect(s):`);
    log("");
    for (const d of defects) {
      log(`  ${d.kind.padEnd(20)}  ${(d.arm ?? "-").padEnd(24)}  ${d.file ?? "-"}`);
      log(`      ${d.detail}`);
    }
  }

  return {
    scopeDir,
    filesTotal: corpus.filesTotal,
    filesAnnotated: corpus.filesAnnotated,
    armsAnnotated,
    armsWaived,
    defects,
    exitCode: defects.length > 0 ? 1 : 0,
  };
}

// ---------------------------------------------------------------------------
// --self-test: prove BOTH exit-1 modes actually fire (D-09), machine-checked;
// and, since 164.3.1-11, drive the REGRESSION CORPUS — every measured instance
// of the phase-164.3.1 primitives as a permanent lane-driven arm (SC-1).
//
// ⚠️ The `N/M` scenario headers are a COUNTED set. Before adding or removing a
// scenario, grep for the current denominator across run.mjs, src/__tests__
// (with -a) and .github/workflows and renumber every spelling in one edit — a
// stale count makes this self-test lie about its own coverage.
// ---------------------------------------------------------------------------

const SELFTEST_DIR = join(FIXTURE_CORPUS, "selftest");

function expect(condition, message) {
  if (!condition) {
    console.error(`SELF-TEST FAIL: ${message}`);
    return false;
  }
  console.log(`  ok — ${message}`);
  return true;
}

function selfTest() {
  const quiet = () => {};
  let pass = true;

  // ⚠️ EVERY SCENARIO PASSES AN EXPLICIT `armsFloor`, and that is required for
  // the checks to measure what they name. The synthetic corpora carry 2 arms;
  // the REAL ARMS_FLOOR is 30 (measured 2026-08-29). Inheriting the default
  // would add a spurious `floor` defect to every scenario below and break check
  // 6 outright, so each states the floor appropriate to ITS corpus. Check 5 is
  // where an ARMS_FLOOR regression is proven to fire — the mode that could not
  // be proven at all while the floor was 0.
  console.log("=== SELF-TEST 1/12: a non-biting annotation must exit 1 with `no-red` ===");
  const a = runCorpus({ scopeDir: SELFTEST_DIR, onlyFile: "nonbiting-gate.sql", armsFloor: 0, log: quiet });
  pass =
    expect(a.exitCode === 1, `exit code is 1 (got ${a.exitCode})`) &&
    expect(
      a.defects.some((d) => d.kind === "no-red" && d.arm === "NONBITE 1"),
      'the defect table names NONBITE 1 with kind "no-red"',
    ) &&
    pass;

  console.log("=== SELF-TEST 2/12: a FILES_FLOOR regression must exit 1 with `floor` ===");
  const b = runCorpus({ scopeDir: FIXTURE_CORPUS, filesFloor: 99, armsFloor: 0, log: quiet });
  pass =
    expect(b.exitCode === 1, `exit code is 1 (got ${b.exitCode})`) &&
    expect(
      b.defects.some((d) => d.kind === "floor" && /FILES_FLOOR regression/.test(d.detail)),
      "the defect table names a FILES_FLOOR regression",
    ) &&
    pass;

  console.log("=== SELF-TEST 3/12: reddening the WRONG arm must exit 1 with `wrong-first-failure` ===");
  const c = runCorpus({ scopeDir: SELFTEST_DIR, onlyFile: "wrong-identity-gate.sql", armsFloor: 0, log: quiet });
  pass =
    expect(c.exitCode === 1, `exit code is 1 (got ${c.exitCode})`) &&
    expect(
      c.defects.some(
        (d) => d.kind === "wrong-first-failure" && d.arm === "WRONGID 2b" && d.detail.includes("WRONGID PIN"),
      ),
      'the defect names WRONGID 2b and reports "WRONGID PIN" as the actual first failure',
    ) &&
    pass;

  console.log("=== SELF-TEST 4/12: a wrong `occurrences` must exit 1 with MEASURE_FAIL, NOT `no-red` ===");
  const d = runCorpus({ scopeDir: SELFTEST_DIR, onlyFile: "occurrence-mismatch-gate.sql", armsFloor: 0, log: quiet });
  pass =
    expect(d.exitCode === 1, `exit code is 1 (got ${d.exitCode})`) &&
    expect(
      d.defects.some((x) => x.kind === "occurrence-mismatch" && x.arm === "OCCMISS 1"),
      'the defect table names OCCMISS 1 with kind "occurrence-mismatch"',
    ) &&
    expect(
      !d.defects.some((x) => x.kind === "no-red"),
      'no "no-red" defect is reported — an unmeasurable mutation is not a non-biting arm',
    ) &&
    pass;

  // ⭐ THE MODE PLAN 05 COULD NOT PROVE. While ARMS_FLOOR was 0 no regression
  // could be constructed, so `--self-test` shipped exercising only the
  // FILES_FLOOR half of D-09's floor mode. Now that the floor is a measured 30
  // this check exists, and it is what stops the pinned floor from decaying back
  // into a constant nobody compares to anything.
  console.log("=== SELF-TEST 5/12: an ARMS_FLOOR regression must exit 1 with `floor` ===");
  const f = runCorpus({ scopeDir: FIXTURE_CORPUS, armsFloor: 99, log: quiet });
  pass =
    expect(f.exitCode === 1, `exit code is 1 (got ${f.exitCode})`) &&
    expect(
      f.defects.some((x) => x.kind === "floor" && /ARMS_FLOOR regression/.test(x.detail)),
      "the defect table names an ARMS_FLOOR regression",
    ) &&
    expect(
      !f.defects.some((x) => x.kind === "floor" && /FILES_FLOOR/.test(x.detail)),
      "no FILES_FLOOR defect — the two floors are reported distinguishably",
    ) &&
    pass;

  console.log("=== SELF-TEST 6/12: the green fixture corpus must exit 0 ===");
  const e = runCorpus({ scopeDir: FIXTURE_CORPUS, armsFloor: 2, log: quiet });
  pass =
    expect(e.exitCode === 0, `exit code is 0 (got ${e.exitCode}; defects: ${JSON.stringify(e.defects)})`) &&
    expect(e.armsExecuted === 2, `2 arms executed (got ${e.armsExecuted})`) &&
    // 164.3.1-10: the lane runner's OWN tally counted through REAL lanes, and
    // it agrees with the verdict loop — the absurdity floor's SILENT direction
    // proven on the wiring, not on the pure function alone.
    expect(
      e.laneInvocations === 2,
      `the lane runner itself counted 2 arm lanes (got ${e.laneInvocations}) — the cross-check's second, independent tally`,
    ) &&
    expect(e.armsWaived === 1, `1 arm waived (got ${e.armsWaived})`) &&
    pass;

  // ⭐ R2-W04. GRAMMAR rule 3 refused ONE spelling — a mutation that WRITES a
  // first-failure literal. The general shape writes no such literal: it
  // re-points an EXISTING raise so another arm reports under the arm-under-
  // test's ID, and it parsed clean against the real gate file at HEAD. The
  // fixture's annotation deliberately carries no failure literal in either its
  // needle or its replacement, so this check can only pass on the CONTENT
  // invariant (`identityRewriteDetail`) and not on the spelling rule.
  console.log("=== SELF-TEST 7/12: rewriting an arm IDENTITY must exit 1 with `identity-rewrite` ===");
  const g = runCorpus({ scopeDir: SELFTEST_DIR, onlyFile: "identity-rewrite-gate.sql", armsFloor: 0, log: quiet });
  pass =
    expect(g.exitCode === 1, `exit code is 1 (got ${g.exitCode})`) &&
    expect(
      g.defects.some((x) => x.kind === "identity-rewrite" && x.arm === "IDREWRITE 1"),
      'the defect table names IDREWRITE 1 with kind "identity-rewrite"',
    ) &&
    expect(
      g.armsExecuted === 0,
      `the arm never reached a lane (executed ${g.armsExecuted}) — a rewritten identity is refused BEFORE it can be counted as biting`,
    ) &&
    expect(
      !g.defects.some((x) => x.kind === "no-red" || x.kind === "wrong-first-failure"),
      'no "no-red" or "wrong-first-failure" defect — a refused mutation is not a non-biting arm',
    ) &&
    pass;

  console.log("");
  console.log("=== SELF-TEST 8/12: SYNTHESISING an identity must exit 1 with `synthesised-identity` ===");
  const h = runCorpus({
    scopeDir: SELFTEST_DIR,
    onlyFile: "synthesised-identity-gate.sql",
    armsFloor: 0,
    log: quiet,
  });
  pass =
    expect(h.exitCode === 1, `exit code is 1 (got ${h.exitCode})`) &&
    expect(
      h.defects.some((x) => x.kind === "synthesised-identity" && x.arm === "SYNTH 1"),
      'the defect table names SYNTH 1 with kind "synthesised-identity"',
    ) &&
    expect(
      h.armsExecuted === 1,
      `the arm DID reach a lane (executed ${h.armsExecuted}) — this mode is caught at RUNTIME, not at parse time, which is the whole point`,
    ) &&
    expect(
      h.bitingArms === 0,
      `the arm is NOT counted as biting (biting ${h.bitingArms}) — a synthesised identity must not inflate the quantity ARMS_FLOOR bounds`,
    ) &&
    pass;

  // ⭐ 164.3.1-11 — THE REGRESSION CORPUS, PRIMITIVE A (SC-1). Every measured
  // instance of "an accepted neuter leaves privileged state live" is a
  // PERMANENT arm here, driven through REAL lanes on every PR. Each scenario
  // was proven able to RED by neutering ITS fix in this file and observing the
  // failure (164.3.1-11-CORPUS-PROOFS.md) — a corpus entry that cannot fail is
  // itself a Primitive-D instance, so the proof is part of the entry.
  console.log("");
  console.log(
    "=== SELF-TEST 9/12: [R4-C01] the P3 compound HEAD must be REFUSED as `neuter-missed` naming `SET ROLE postgres;`, beside an ACCEPTED P1-shape neuter ===",
  );
  // armsFloor 1 states the corpus's own number: exactly ONE arm can bite — the
  // control BEHIND P1 — because the refused arm never lanes. ⚠️ It is INERT
  // here: a narrowed (onlyFile) run enforces NO floor (see `narrowed` above),
  // so the control's survival is asserted DIRECTLY on bitingArms below, never
  // through the floor.
  const i = runCorpus({ scopeDir: SELFTEST_DIR, onlyFile: "compound-head-gate.sql", armsFloor: 1, log: quiet });
  const compoundRefusal = i.defects.find((x) => x.kind === "neuter-missed" && x.arm === "BEHIND HEAD");
  pass =
    expect(i.exitCode === 1, `exit code is 1 (got ${i.exitCode})`) &&
    expect(
      compoundRefusal !== undefined && compoundRefusal.detail.includes('could not neuter "COMPOUND HEAD"'),
      'the defect table names BEHIND HEAD with kind "neuter-missed", refusing its neuter of COMPOUND HEAD',
    ) &&
    expect(
      compoundRefusal !== undefined &&
        compoundRefusal.detail.includes("unrecognised statement before its RAISE") &&
        compoundRefusal.detail.includes("SET ROLE postgres;"),
      "the refusal NAMES `SET ROLE postgres;` as the statement sharing the head's line — [R4-C01]'s own spelling, classified instead of swallowed",
    ) &&
    expect(
      i.armsExecuted === 1 && i.laneInvocations === 1,
      `only the control reached a lane (executed ${i.armsExecuted}, lanes ${i.laneInvocations}) — a refused neuter never runs, so a live SET ROLE postgres; can never reach a lane`,
    ) &&
    expect(
      i.bitingArms === 1 && !i.defects.some((x) => x.arm === "BEHIND P1"),
      `the PASSING CONTROL scored RED (identity ok) (biting ${i.bitingArms}): the P1 EXCEPTION-compound line decomposed and its neuter was ACCEPTED — the classifier is not refusing every compound line`,
    ) &&
    expect(
      i.defects.length === 1,
      `exactly one defect (got ${i.defects.length}: ${JSON.stringify(i.defects.map((x) => [x.kind, x.arm]))}) — no no-red, no wrong-first-failure, no floor: a refused neuter is not a lane result`,
    ) &&
    pass;

  console.log("");
  console.log(
    "=== SELF-TEST 10/12: [MUT-I01] an apostrophe in a `--` comment inside a RAISE must neither refuse the neuter (P4) nor over-neuter the statement after it (P5) ===",
  );
  // armsFloor 2 states the corpus's own number: both annotated arms must bite.
  // ⚠️ INERT in a narrowed run (no floor is enforced) — the count is asserted
  // DIRECTLY on bitingArms below.
  //
  // A defect-free NARROWED run exits 2, never 0 (run.mjs header: a subset run
  // must never be mistakable for a passing gate). 2 with an empty defect table
  // is therefore the GREEN shape for this scenario; 0 here would mean the
  // narrowed guard itself had been lost.
  const j = runCorpus({ scopeDir: SELFTEST_DIR, onlyFile: "comment-parity-gate.sql", armsFloor: 2, log: quiet });
  pass =
    expect(
      j.exitCode === 2 && j.defects.length === 0,
      `narrowed run is GREEN: exit code 2 with an empty defect table (got ${j.exitCode}; defects: ${JSON.stringify(j.defects)})`,
    ) &&
    expect(
      !j.defects.some((x) => x.kind === "neuter-missed"),
      "P4 (odd parity, LOUD): no `neuter-missed` — the apostrophe inside `-- don't worry` did not produce a spurious \"could not find the end of the RAISE statement\"",
    ) &&
    expect(
      !j.defects.some((x) => x.kind === "wrong-first-failure" && x.detail.includes("SURVIVOR LOST")),
      "P5 (even parity, SILENT): no `wrong-first-failure` naming SURVIVOR LOST — the statement after the RAISE's terminator SURVIVED the neuter and recorded that it ran",
    ) &&
    expect(
      j.armsExecuted === 2 && j.bitingArms === 2 && j.laneInvocations === 2,
      `both arms laned and bit (executed ${j.armsExecuted}, biting ${j.bitingArms}, lanes ${j.laneInvocations}) — BEHIND ODD and BEHIND EVEN each scored RED (identity ok) behind a correctly neutered P4/P5 arm`,
    ) &&
    pass;

  // ⭐ 164.3.1-11 — THE REGRESSION CORPUS, PRIMITIVE B (SC-1 + SC-3). Every
  // measured instance of "an arm counts toward biting without executing" is a
  // PERMANENT arm here, each with its PASSING CONTROL in the SAME run (CONTEXT
  // D-02: an attribution that refuses everything also passes a forgery test,
  // so a genuine arm must score RED (identity ok) beside the refusals). The
  // two entries fail under DIFFERENT neuters of `judgeBlock`: the
  // current_query() trigger is refused by its FIRST frame (`forge_fn()`), the
  // echo-free nested-EXECUTE forgery ONLY by the chain's LENGTH — which is
  // what makes them two entries and not one (164.3.1-11-CORPUS-PROOFS.md).
  // Both fixtures are promoted VERBATIM from 164.3.1-05-ATTRIBUTION.md § 3.
  console.log("");
  console.log(
    "=== SELF-TEST 11/12: [R4-C02] a current_query() trigger re-raising the identity must be SYNTHESISED, with the genuine arm RED (identity ok) beside it ===",
  );
  // armsFloor 1 states the corpus's own number: only the genuine control can
  // bite. INERT in a narrowed run — the control is asserted on bitingArms.
  const k = runCorpus({ scopeDir: SELFTEST_DIR, onlyFile: "current-query-forge-gate.sql", armsFloor: 1, log: quiet });
  const cqForge = k.defects.find((x) => x.kind === "synthesised-identity" && x.arm === "FORGE 1");
  pass =
    expect(k.exitCode === 1, `exit code is 1 (got ${k.exitCode})`) &&
    expect(
      cqForge !== undefined,
      'the defect table names FORGE 1 with kind "synthesised-identity" — the R4-C02 trigger that scored RED (identity ok) with biting 1 under the nonce is REFUSED under source-location attribution',
    ) &&
    expect(
      cqForge !== undefined && cqForge.detail.includes("not EXACTLY ONE") && cqForge.detail.includes("forge_fn()"),
      "the refusal names the chain rule and the trigger frame `forge_fn()` — leg (b) refused it by its FIRST frame, before chain length was even needed",
    ) &&
    expect(
      k.armsExecuted === 2 && k.bitingArms === 1 && !k.defects.some((x) => x.arm === "CTRL 1"),
      `the PASSING CONTROL scored RED (identity ok) in the SAME run (executed ${k.armsExecuted}, biting ${k.bitingArms}) — the attribution is not refusing everything`,
    ) &&
    expect(
      k.defects.length === 1,
      `exactly one defect (got ${k.defects.length}: ${JSON.stringify(k.defects.map((x) => [x.kind, x.arm]))})`,
    ) &&
    pass;

  console.log("");
  console.log(
    "=== SELF-TEST 12/12: the nested-EXECUTE DO forgery AIMED at the genuine raise line must be SYNTHESISED by chain LENGTH alone, with the genuine arm RED (identity ok) beside it ===",
  );
  // armsFloor 1: as in 11/12 — stated, inert here, asserted on bitingArms.
  const l = runCorpus({ scopeDir: SELFTEST_DIR, onlyFile: "nested-execute-forge-gate.sql", armsFloor: 1, log: quiet });
  const forge2 = l.defects.find((x) => x.kind === "synthesised-identity" && x.arm === "FORGE 2");
  const forge3 = l.defects.find((x) => x.kind === "synthesised-identity" && x.arm === "FORGE 3");
  pass =
    expect(l.exitCode === 1, `exit code is 1 (got ${l.exitCode})`) &&
    expect(
      forge2 !== undefined && forge3 !== undefined,
      'the defect table names BOTH FORGE 2 and FORGE 3 with kind "synthesised-identity"',
    ) &&
    expect(
      forge3 !== undefined &&
        forge3.detail.includes("not EXACTLY ONE") &&
        forge3.detail.includes("inline_code_block line 5 at RAISE"),
      "FORGE 3 was AIMED — its forged first frame reads `inline_code_block line 5 at RAISE`, the genuine arm's own resolved line (legs (a) and (c) PASS) — and the chain's LENGTH refused it",
    ) &&
    expect(
      forge3 !== undefined && !forge3.detail.includes("further unattributable sighting"),
      "FORGE 3 is ECHO-FREE (a single sighting): the chain rule stands ALONE, so a neuter proof on it cannot be rescued by a second control",
    ) &&
    expect(
      forge2 !== undefined && forge2.detail.includes("further unattributable sighting"),
      "FORGE 2 is DOUBLE-GUARDED (its echoed `SQL statement` frame is a second, field-carried sighting) — the measured reason FORGE 3 exists (164.3.1-05-ATTRIBUTION.md § 5)",
    ) &&
    expect(
      l.armsExecuted === 3 && l.bitingArms === 1 && !l.defects.some((x) => x.arm === "CTRL 1"),
      `the PASSING CONTROL scored RED (identity ok) in the SAME run (executed ${l.armsExecuted}, biting ${l.bitingArms})`,
    ) &&
    expect(
      l.defects.length === 2,
      `exactly two defects (got ${l.defects.length}: ${JSON.stringify(l.defects.map((x) => [x.kind, x.arm]))})`,
    ) &&
    pass;

  console.log("");
  if (pass) {
    console.log(
      "=== SELF-TEST PASSED: both floor modes, the wrong-identity mode and MEASURE_FAIL all fire, and the 164.3.1-11 regression corpus holds ===",
    );
    return 0;
  }
  console.error("=== SELF-TEST FAILED ===");
  return 1;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(argv) {
  let scopeDir = DEFAULT_CORPUS;
  let onlyFile = null;
  let onlyArm = null;
  let parseOnly = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--self-test") return selfTest();
    else if (arg === "--parse-only") parseOnly = true;
    else if (arg === "--fixture-corpus") scopeDir = FIXTURE_CORPUS;
    else if (arg === "--file") {
      onlyFile = argv[++i];
      if (!onlyFile) {
        console.error("ERROR: --file needs a gate path");
        return 3;
      }
      scopeDir = scopeDirForFile(onlyFile);
    } else if (arg === "--arm") {
      onlyArm = argv[++i];
      if (!onlyArm) {
        console.error("ERROR: --arm needs an arm ID");
        return 3;
      }
    } else {
      console.error(`ERROR: unknown argument ${JSON.stringify(arg)}`);
      console.error(
        "Usage: node scripts/mutation-runner/run.mjs [--fixture-corpus] [--file <gate.sql>] [--arm <ID>] [--parse-only] [--self-test]",
      );
      return 3;
    }
  }

  if (parseOnly) {
    if (onlyFile || onlyArm) {
      console.error("ERROR: --parse-only is a whole-corpus static check and does not combine with --file/--arm");
      return 3;
    }
    console.log(`mutation-runner: STATIC PARSE, scope ${relative(REPO_ROOT, scopeDir) || "."}`);
    return parseOnlyCorpus({ scopeDir }).exitCode;
  }

  if (!existsSync(LANE)) {
    console.error(`ERROR: the pg-lane is missing at ${LANE}`);
    return 3;
  }

  console.log(`mutation-runner: scope ${relative(REPO_ROOT, scopeDir) || "."}`);
  return runCorpus({ scopeDir, onlyFile, onlyArm }).exitCode;
}

if (process.argv[1] && process.argv[1].endsWith("run.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
