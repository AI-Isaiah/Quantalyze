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
 *   0  full gate run, no defects, floors held
 *   1  at least one defect, or a coverage floor regression
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
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { parseFile, scanCorpus } from "./parse.mjs";

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
// ⚠️ RATCHET, NOT A TARGET. It fails on REGRESSION only: an annotation that
// stops biting, or one deleted outright, drops the biting count below 30 and
// exits 1. It never demands more than the corpus declares. Phase 164.4 raises
// it as it backfills the other 70 files.
// ⛔ Converting an arm to a `waiver` LOWERS the biting count and therefore trips
// this floor. That is deliberate: waiver creep is how a non-biting arm hides
// (T-164.3-21), so widening a waiver has to be an explicit, reviewed edit here.
export const ARMS_FLOOR = 30;

const DEFECT_KINDS = [
  "parse",
  "parity",
  "bad-file-ref",
  "occurrence-mismatch",
  "no-red",
  "wrong-first-failure",
  "neuter-missed",
  "identity-rewrite",
  "baseline",
  "restore",
  "dirty-checkout",
  "floor",
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

/** Blank, or a whole-line `--` comment. Carries no runtime effect. */
const IGNORABLE_LINE = /^[ \t]*(--.*)?$/;

/**
 * The head of the block the RAISE sits in. Reaching one of these means every
 * line between it and the RAISE has been classified, so the scan can stop.
 *
 * ⚠️ This is a bare word match. It MUST only ever be applied to EXECUTABLE
 * text — see `stripTrailingComment` and the ordering note in the scan below.
 * Applied to a raw line it treats `-- raise the exception the harness looks
 * for` as a branch head, which ends the scan one line early and lets the
 * statement above it leak. That was a live bypass (R2-C01).
 */
const BRANCH_HEAD = /\b(THEN|BEGIN|ELSE|ELSIF|LOOP|DECLARE|EXCEPTION)\b/i;

/**
 * Drop a trailing `--` comment so BRANCH_HEAD sees only executable text.
 *
 * Deliberately naive about string literals: `RAISE NOTICE 'a--b THEN'` strips
 * to `RAISE NOTICE 'a`, which no longer matches BRANCH_HEAD and therefore
 * REFUSES rather than terminating the scan. Refusing is the safe direction —
 * a refusal is a loud, named `neuter-missed` defect, whereas a wrong
 * termination is the silent state leak this whole block exists to prevent.
 */
const stripTrailingComment = (line) => line.replace(/--.*$/, "");

export function neuterArm(text, arm) {
  const lines = text.split("\n");
  const needle = `TEST FAILED (${arm})`;
  const isComment = (l) => /^[ \t]*--/.test(l);

  let hit = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].includes(needle) && !isComment(lines[i])) {
      hit = i;
      break;
    }
  }
  if (hit === -1) return { text, found: false, reason: `no statement contains "${needle}"` };

  let raiseAt = hit;
  while (raiseAt >= 0 && !/\bRAISE\s+EXCEPTION\b/i.test(lines[raiseAt])) raiseAt -= 1;
  if (raiseAt < 0) {
    return { text, found: false, reason: `no RAISE EXCEPTION precedes "${needle}"` };
  }

  // Absorb the abort-path cleanup that immediately precedes the RAISE. See the
  // header: leaving `RESET ROLE;` behind leaks a superuser session into every
  // later arm. The forward scan below still starts at the RAISE — starting it
  // here would terminate on `RESET ROLE;`'s own semicolon and leave the RAISE
  // live, which is a neuter that silently did nothing.
  let start = raiseAt;
  while (start > 0 && ABSORBABLE_CLEANUP.test(lines[start - 1])) start -= 1;

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
  // ⛔ ORDER IS LOAD-BEARING (R2-C01). Classify FIRST, terminate LAST, and
  // terminate only on EXECUTABLE text. The previous version tested BRANCH_HEAD
  // in the loop condition — before `IGNORABLE_LINE` was consulted and with no
  // comment stripping — so a whole-line `-- … the exception …` comment, the
  // likeliest comment to sit beside a `RAISE EXCEPTION`, ended the scan before
  // the statement above it was ever examined. Measured: `SET ROLE postgres;`
  // survived the neuter and stayed live for the rest of the file, which is
  // verbatim the leak class described in the header above.
  for (let k = start - 1; k >= 0; k -= 1) {
    if (IGNORABLE_LINE.test(lines[k])) continue; // blank or whole-line comment
    if (BRANCH_HEAD.test(stripTrailingComment(lines[k]))) break; // real branch head
    return {
      text,
      found: false,
      reason:
        `the abort branch for "${arm}" carries an unrecognised statement before its RAISE ` +
        `(line ${k + 1}: ${lines[k].trim()}). Neutering only the RAISE would leave that statement ` +
        `executing for the rest of the file — the measured RESET ROLE class, where a leaked ` +
        `superuser session made sixteen later arms pass for a reason unrelated to their grants. ` +
        `Extend ABSORBABLE_CLEANUP deliberately, or restructure the branch.`,
    };
  }

  // Walk forward to the statement terminator, tracking single-quote state so a
  // ';' inside the message literal does not end the statement early. '' is the
  // SQL escape for a literal quote.
  let end = -1;
  let inQuote = false;
  outer: for (let i = raiseAt; i < lines.length; i += 1) {
    const line = lines[i];
    for (let c = 0; c < line.length; c += 1) {
      const ch = line[c];
      if (ch === "'") {
        if (inQuote && line[c + 1] === "'") {
          c += 1;
          continue;
        }
        inQuote = !inQuote;
      } else if (ch === ";" && !inQuote) {
        end = i;
        break outer;
      }
    }
  }
  if (end === -1) {
    return { text, found: false, reason: `could not find the end of the RAISE statement for "${arm}"` };
  }

  const indent = (lines[start].match(/^[ \t]*/) || [""])[0];
  const replacement = [
    ...lines.slice(start, end + 1).map((l) => `-- NEUTERED(${arm}) ${l}`),
    `${indent}NULL; -- neutered ${arm} by the mutation runner`,
  ];
  lines.splice(start, end - start + 1, ...replacement);
  return { text: lines.join("\n"), found: true };
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

/** First `TEST FAILED (<ARM>)` in lane output, in emission order. */
export function firstFailureArm(output) {
  const match = output.match(/TEST FAILED \(([^)]*)\)/);
  return match ? match[1] : null;
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
 * `ANON 1a` from 1 occurrence to 0 and `N1 1a` from 1 to 2. `firstFailureArm`
 * would then read `N1 1a`, the runner would report `RED (identity ok)`, and
 * `biting` would rise for an arm whose own logic never ran — the exact outcome
 * rule 3 exists to prevent, reached without the literal rule 3 looks for.
 *
 * The invariant that closes the CLASS is stated over the OUTPUT rather than
 * over the annotation's spelling: a mutation may change what the gate DOES,
 * never who it says it is. So the multiset of readable identities must survive
 * the mutation unchanged.
 *
 * MEASURED 2026-08-29 across the real corpus — 30 annotated arms, 49 file
 * steps — 0 violations. The widened rule refuses nothing that exists today.
 *
 * ⚠️ NEUTERS ARE NOT SUBJECT TO THIS, deliberately: neutering an arm removes
 * its identity ON PURPOSE. The comparison is taken across a MUTATION step
 * only, with the post-neuter text as its "before", so an identity the neuter
 * removed is absent from both sides.
 */
export function armIdentities(text) {
  return [...text.matchAll(/TEST FAILED \(([^)]*)\)/g)].map((m) => m[1]).sort();
}

/** `null` when the mutation preserved every identity; otherwise a description. */
export function identityRewriteDetail(before, after, file) {
  const b = armIdentities(before);
  const a = armIdentities(after);
  if (b.join(" ") === a.join(" ")) return null;

  const count = (list, id) => list.filter((x) => x === id).length;
  const moved = [...new Set([...b, ...a])]
    .filter((id) => count(b, id) !== count(a, id))
    .map((id) => `${JSON.stringify(id)} ${count(b, id)}->${count(a, id)}`)
    .sort();

  return (
    `MEASURE_FAIL: the mutation REWRITES the arm identities in ${file} (${moved.join(", ")}). ` +
    `A mutation may change what the gate DOES; it may never change who the gate SAYS IT IS. ` +
    `Re-pointing a raise makes the first-failure check attribute another arm's failure to this ` +
    `one, so the arm would count as biting without its own logic ever running. Mutate the code ` +
    `under test, not the failure identity.`
  );
}

// ---------------------------------------------------------------------------
// Lane invocation
// ---------------------------------------------------------------------------

function runLane({ workdir, applyAbs, postApplyAbs, gateAbs }) {
  const args = [LANE, "--workdir", workdir, "--apply", ...applyAbs];
  if (postApplyAbs) args.push("--post-apply", postApplyAbs);
  args.push("--gate", gateAbs);
  const started = Date.now();
  const proc = spawnSync("bash", args, { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
  // stderr first: psql streams RAISE output there, and ON_ERROR_STOP=1 aborts
  // at the first failing statement, so emission order is failure order.
  const output = `${proc.stderr || ""}\n${proc.stdout || ""}`;
  return { status: proc.status, output, seconds: (Date.now() - started) / 1000 };
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
      });
      log(`  baseline  ${gateRel} — exit ${baseline.status} (${baseline.seconds.toFixed(1)}s)`);
      if (baseline.status !== 0) {
        addDefect(
          "baseline",
          null,
          gateRel,
          `pristine corpus did not go GREEN (exit ${baseline.status}); first failure: ${firstFailureArm(baseline.output) ?? "none"}`,
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

        const run = runLane({
          workdir: join(armSlot, "lane"),
          applyAbs: parsed.setup.apply.map((r) => armMap.get(r)),
          postApplyAbs,
          gateAbs: armMap.get(gateRel),
        });
        armsExecuted += 1;
        timings.push(run.seconds);

        const first = firstFailureArm(run.output);
        let verdict;
        if (run.status === 0) {
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
            `gate exited ${run.status} but emitted no "TEST FAILED (…)" line — the failure is not attributable to any arm`,
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
  const bitingArms =
    armsExecuted - defects.filter((d) => ["no-red", "wrong-first-failure"].includes(d.kind)).length;
  log(`biting: ${bitingArms}   (executed arms that reddened their OWN arm first — the quantity ARMS_FLOOR bounds)`);
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
    defects,
    exitCode: defects.length > 0 ? 1 : narrowed ? 2 : 0,
  };
}

// ---------------------------------------------------------------------------
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
    for (const ann of parsed.structured) {
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
        const before = readFileSync(target, "utf8");
        const actual = countOccurrences(before, needle);
        if (actual !== step.occurrences) {
          addDefect(
            "occurrence-mismatch",
            ann.arm,
            gateRel,
            `MEASURE_FAIL: ${JSON.stringify(needle)} occurs ${actual}x in ${step.file}, annotation claims ${step.occurrences}x`,
          );
          continue;
        }
        // R2-W04: identity rewriting is decidable WITHOUT a lane, so refuse it
        // here too. `--parse-only` is what CI runs on platforms with no
        // database, and an annotation that re-points a raise must not have to
        // wait for a lane to be caught.
        const applied = applyFileStep(before, step);
        if (applied.ok) {
          const rewrite = identityRewriteDetail(before, applied.text, step.file);
          if (rewrite !== null) addDefect("identity-rewrite", ann.arm, gateRel, rewrite);
        }
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
// --self-test: prove BOTH exit-1 modes actually fire (D-09), machine-checked.
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
  console.log("=== SELF-TEST 1/7: a non-biting annotation must exit 1 with `no-red` ===");
  const a = runCorpus({ scopeDir: SELFTEST_DIR, onlyFile: "nonbiting-gate.sql", armsFloor: 0, log: quiet });
  pass =
    expect(a.exitCode === 1, `exit code is 1 (got ${a.exitCode})`) &&
    expect(
      a.defects.some((d) => d.kind === "no-red" && d.arm === "NONBITE 1"),
      'the defect table names NONBITE 1 with kind "no-red"',
    ) &&
    pass;

  console.log("=== SELF-TEST 2/7: a FILES_FLOOR regression must exit 1 with `floor` ===");
  const b = runCorpus({ scopeDir: FIXTURE_CORPUS, filesFloor: 99, armsFloor: 0, log: quiet });
  pass =
    expect(b.exitCode === 1, `exit code is 1 (got ${b.exitCode})`) &&
    expect(
      b.defects.some((d) => d.kind === "floor" && /FILES_FLOOR regression/.test(d.detail)),
      "the defect table names a FILES_FLOOR regression",
    ) &&
    pass;

  console.log("=== SELF-TEST 3/7: reddening the WRONG arm must exit 1 with `wrong-first-failure` ===");
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

  console.log("=== SELF-TEST 4/7: a wrong `occurrences` must exit 1 with MEASURE_FAIL, NOT `no-red` ===");
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
  console.log("=== SELF-TEST 5/7: an ARMS_FLOOR regression must exit 1 with `floor` ===");
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

  console.log("=== SELF-TEST 6/7: the green fixture corpus must exit 0 ===");
  const e = runCorpus({ scopeDir: FIXTURE_CORPUS, armsFloor: 2, log: quiet });
  pass =
    expect(e.exitCode === 0, `exit code is 0 (got ${e.exitCode}; defects: ${JSON.stringify(e.defects)})`) &&
    expect(e.armsExecuted === 2, `2 arms executed (got ${e.armsExecuted})`) &&
    expect(e.armsWaived === 1, `1 arm waived (got ${e.armsWaived})`) &&
    pass;

  // ⭐ R2-W04. GRAMMAR rule 3 refused ONE spelling — a mutation that WRITES a
  // first-failure literal. The general shape writes no such literal: it
  // re-points an EXISTING raise so another arm reports under the arm-under-
  // test's ID, and it parsed clean against the real gate file at HEAD. The
  // fixture's annotation deliberately carries no failure literal in either its
  // needle or its replacement, so this check can only pass on the CONTENT
  // invariant (`identityRewriteDetail`) and not on the spelling rule.
  console.log("=== SELF-TEST 7/7: rewriting an arm IDENTITY must exit 1 with `identity-rewrite` ===");
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
  if (pass) {
    console.log("=== SELF-TEST PASSED: both floor modes, the wrong-identity mode and MEASURE_FAIL all fire ===");
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
      scopeDir = join(REPO_ROOT, dirname(relative(REPO_ROOT, join(process.cwd(), onlyFile))));
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
