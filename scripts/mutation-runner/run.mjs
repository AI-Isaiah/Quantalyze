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

// ⚠️ ARMS_FLOOR IS DELIBERATELY 0 AND THEREFORE CANNOT FIRE YET. It is a named
// constant, not an omission. The real corpus has no RED-UNDER-M twins yet —
// plan 164.3-08 writes them — so the first honest full-corpus measurement does
// not exist at the time this ships. Inventing a number here would be the
// fabricated-baseline defect: a floor that was never compared to anything.
// PLAN 164.3-08 MUST PIN THIS from its first full-corpus run.
export const ARMS_FLOOR = 0;

const DEFECT_KINDS = [
  "parse",
  "parity",
  "bad-file-ref",
  "occurrence-mismatch",
  "no-red",
  "wrong-first-failure",
  "neuter-missed",
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
 */
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

  let start = hit;
  while (start >= 0 && !/\bRAISE\s+EXCEPTION\b/i.test(lines[start])) start -= 1;
  if (start < 0) {
    return { text, found: false, reason: `no RAISE EXCEPTION precedes "${needle}"` };
  }

  // Walk forward to the statement terminator, tracking single-quote state so a
  // ';' inside the message literal does not end the statement early. '' is the
  // SQL escape for a literal quote.
  let end = -1;
  let inQuote = false;
  outer: for (let i = start; i < lines.length; i += 1) {
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
    const biting = armsExecuted - defects.filter((d) => ["no-red", "wrong-first-failure"].includes(d.kind)).length;
    if (biting < armsFloor) {
      addDefect("floor", null, scopeDir, `ARMS_FLOOR regression: ${biting} biting arm(s) < floor ${armsFloor}`);
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

  console.log("=== SELF-TEST 1/5: a non-biting annotation must exit 1 with `no-red` ===");
  const a = runCorpus({ scopeDir: SELFTEST_DIR, onlyFile: "nonbiting-gate.sql", log: quiet });
  pass =
    expect(a.exitCode === 1, `exit code is 1 (got ${a.exitCode})`) &&
    expect(
      a.defects.some((d) => d.kind === "no-red" && d.arm === "NONBITE 1"),
      'the defect table names NONBITE 1 with kind "no-red"',
    ) &&
    pass;

  console.log("=== SELF-TEST 2/5: a FILES_FLOOR regression must exit 1 with `floor` ===");
  const b = runCorpus({ scopeDir: FIXTURE_CORPUS, filesFloor: 99, log: quiet });
  pass =
    expect(b.exitCode === 1, `exit code is 1 (got ${b.exitCode})`) &&
    expect(
      b.defects.some((d) => d.kind === "floor" && /FILES_FLOOR regression/.test(d.detail)),
      "the defect table names a FILES_FLOOR regression",
    ) &&
    pass;

  console.log("=== SELF-TEST 3/5: reddening the WRONG arm must exit 1 with `wrong-first-failure` ===");
  const c = runCorpus({ scopeDir: SELFTEST_DIR, onlyFile: "wrong-identity-gate.sql", log: quiet });
  pass =
    expect(c.exitCode === 1, `exit code is 1 (got ${c.exitCode})`) &&
    expect(
      c.defects.some(
        (d) => d.kind === "wrong-first-failure" && d.arm === "WRONGID 2b" && d.detail.includes("WRONGID PIN"),
      ),
      'the defect names WRONGID 2b and reports "WRONGID PIN" as the actual first failure',
    ) &&
    pass;

  console.log("=== SELF-TEST 4/5: a wrong `occurrences` must exit 1 with MEASURE_FAIL, NOT `no-red` ===");
  const d = runCorpus({ scopeDir: SELFTEST_DIR, onlyFile: "occurrence-mismatch-gate.sql", log: quiet });
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

  console.log("=== SELF-TEST 5/5: the green fixture corpus must exit 0 ===");
  const e = runCorpus({ scopeDir: FIXTURE_CORPUS, log: quiet });
  pass =
    expect(e.exitCode === 0, `exit code is 0 (got ${e.exitCode}; defects: ${JSON.stringify(e.defects)})`) &&
    expect(e.armsExecuted === 2, `2 arms executed (got ${e.armsExecuted})`) &&
    expect(e.armsWaived === 1, `1 arm waived (got ${e.armsWaived})`) &&
    pass;

  console.log("");
  if (pass) {
    console.log("=== SELF-TEST PASSED: both exit-1 modes and the wrong-identity + MEASURE_FAIL modes all fire ===");
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

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--self-test") return selfTest();
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
      console.error("Usage: node scripts/mutation-runner/run.mjs [--fixture-corpus] [--file <gate.sql>] [--arm <ID>] [--self-test]");
      return 3;
    }
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
