#!/usr/bin/env node
/**
 * Which SQL gate files did this pull request change? — Phase 164.4.2 plan 07 (DECISION D).
 *
 * The derivation half of the `sql-mutation` subset rule. On a `pull_request` the
 * mutation runner may run only the gate files whose content changed against the
 * PR's merge base; on every other event the FULL corpus is owed. This script
 * answers "which gate files, or FULL", and `run.mjs --subset-from` consumes it.
 *
 * ── ONE DIFF, TWO CALLERS ───────────────────────────────────────────────────
 * The merge-base diff is IMPORTED from `scripts/classify-changed-paths.mjs`
 * (`changedFilesAgainstBase`) and never re-spawned here. Two diffs that agree
 * today are two diffs that can disagree tomorrow — one gaining `--no-renames`,
 * the other not — and a moved gate file would then read as "not changed" to
 * exactly one of them.
 *
 * ── THE VACUITY FENCE (CONTEXT.md, AREA D) ──────────────────────────────────
 * Every answer that is not a positively-identified, fully-present set of gate
 * files is FULL, with a named reason. In particular:
 *   - an UNREADABLE diff base is a MEASURE_FAIL and a non-zero exit — never an
 *     empty change set (the diff function THROWS; it cannot return `[]` for it);
 *   - an EMPTY change set, or one with no gate file in it, is FULL — never
 *     "nothing to do";
 *   - a changed gate path ABSENT from the checkout (deleted by the PR, or the
 *     source side of a move, which `--no-renames` lists as a delete) is FULL —
 *     never a subset that silently omits it, never a subset naming a file the
 *     runner cannot find;
 *   - a changed path under `supabase/tests/` that fails the strict name pattern
 *     is FULL, naming it — never silently dropped;
 *   - a change to the MUTATION MACHINERY itself (the runner, the pg-lane and its
 *     fixtures, or a migration a gate's RED-UNDER-SETUP may apply) is FULL: those
 *     inputs feed EVERY gate's verdict, so narrowing to the changed gate files
 *     would leave every other gate's arms unexercised against the new machinery.
 *
 * ⭐ `GATE_FILE_RE` IS A SECURITY CONTROL, not tidiness (T-164.4.2-20). On a fork
 * PR the author chooses filenames, and plan 09 hands this list to a shell step.
 * The name class admits no shell metacharacter, no space and no `/` beyond the
 * anchored directory BY CONSTRUCTION, so nothing that reaches the runner can
 * carry one; anything else forces the FULL corpus. `run.mjs` imports the SAME
 * constant for its own refusal, so the two cannot drift.
 *
 * Usage:
 *   node scripts/sql-gate-subset.mjs --self-test   # prove every verdict fires
 *   node scripts/sql-gate-subset.mjs               # the derivation (CI, or locally)
 */
import { appendFileSync, existsSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { changedFilesAgainstBase } from "./classify-changed-paths.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The one directory gate files live in, with its trailing separator inside the literal. */
export const GATE_DIR_PREFIX = "supabase/tests/";

/**
 * ⛔ A STRICT ALLOW-LIST, anchored at both ends. Lower-case letters, digits and
 * underscore only — every gate file in the corpus matches it (measured
 * 2026-09-23: all 76 names under `supabase/tests/`), and nothing that could be
 * a shell metacharacter can.
 */
export const GATE_FILE_RE = /^supabase\/tests\/test_[a-z0-9_]+\.sql$/;

/**
 * Inputs that feed EVERY gate's mutation verdict, not one gate's. A changed path
 * under any of these forces FULL. Trailing separators inside the literals, so a
 * sibling sharing the prefix (`scripts/pg-lane-notes/`) does not match.
 */
export const MACHINERY_PREFIXES = ["scripts/mutation-runner/", "scripts/pg-lane/", "supabase/migrations/"];

/**
 * PURE: the verdict. No I/O — `presentFiles` (the changed gate paths that exist
 * in the checkout) is computed by `main()` with `existsSync`, so the
 * deleted-or-moved row is table-driven like every other row.
 *
 * @param {{event: string|undefined, changedFiles: string[], presentFiles: Set<string>|string[]}} input
 * @returns {{mode: "full"|"subset", files: string[], reason: string}}
 */
export function judge({ event, changedFiles, presentFiles }) {
  const full = (reason) => ({ mode: "full", files: [], reason });
  if (event !== "pull_request") {
    return full(`event is '${event ?? "(unset)"}', not pull_request — the full corpus is owed`);
  }
  // Order-stable and duplicate-free, whatever order the diff printed.
  const changed = [...new Set(changedFiles)].sort();
  const present = new Set(presentFiles);

  const machinery = changed.filter((p) => MACHINERY_PREFIXES.some((m) => p.startsWith(m)));
  if (machinery.length > 0) {
    return full(`the mutation machinery or a lane input changed: ${machinery.join(" ")}`);
  }
  const underGateDir = changed.filter((p) => p.startsWith(GATE_DIR_PREFIX));
  const nonConforming = underGateDir.filter((p) => !GATE_FILE_RE.test(p));
  if (nonConforming.length > 0) {
    return full(`changed path(s) under ${GATE_DIR_PREFIX} fail the strict gate-file pattern: ${nonConforming.join(" ")}`);
  }
  if (underGateDir.length === 0) {
    return full(`0 of ${changed.length} changed file(s) are gate files`);
  }
  const absent = underGateDir.filter((p) => !present.has(p));
  if (absent.length > 0) {
    return full(`changed gate file(s) absent from the checkout (deleted or moved): ${absent.join(" ")}`);
  }
  return {
    mode: "subset",
    files: underGateDir,
    reason: `${underGateDir.length} of ${changed.length} changed file(s) are gate files`,
  };
}

/**
 * One always-on human line; the two `$GITHUB_OUTPUT` values only when the
 * variable is present — `classify-changed-paths.mjs`'s `emit()` shape.
 */
function emit(verdict) {
  const list = verdict.files.join(" ");
  console.log(
    `sql_gate_mode=${verdict.mode} — ${verdict.reason}${verdict.mode === "subset" ? `: ${list}` : ""}`,
  );
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `sql_gate_mode=${verdict.mode}\nsql_gate_files=${list}\n`);
  }
}

// ---------------------------------------------------------------------------
// --self-test
// ---------------------------------------------------------------------------

/** Declared up front; a self-test that shrinks and still says PASSED is the defect. */
export const EXPECTED_ASSERTIONS = 19;

const PR = "pull_request";
const G1 = "supabase/tests/test_alpha_gate.sql";
const G2 = "supabase/tests/test_beta_gate.sql";

const CASES = [
  {
    claim: "a non-pull_request event asks for the FULL corpus, naming the event",
    run: (ok) => {
      const v = judge({ event: "push", changedFiles: [G1], presentFiles: [G1] });
      let pass = ok(v.mode === "full" && v.files.length === 0, "a push is FULL even with a gate file in the list");
      pass = ok(/'push'/.test(v.reason), `the reason names the event (got ${JSON.stringify(v.reason)})`) && pass;
      const u = judge({ event: undefined, changedFiles: [G1], presentFiles: [G1] });
      return ok(u.mode === "full" && /\(unset\)/.test(u.reason), "an UNSET event is FULL, never a PR by default") && pass;
    },
  },
  {
    claim: "an UNREADABLE diff base is a MEASURE_FAIL thrown by the shared diff — never an empty change set",
    run: (ok) => {
      let threw = null;
      let returned;
      try {
        returned = changedFilesAgainstBase({ baseRefName: "gsd-self-test-no-such-base-ref" });
      } catch (e) {
        threw = e;
      }
      let pass = ok(threw !== null, `the diff THREW (got a return value ${JSON.stringify(returned)})`);
      pass = ok(threw !== null && /^MEASURE_FAIL: /.test(threw.message), "and the error is a named MEASURE_FAIL") && pass;
      return pass;
    },
  },
  {
    claim: "no changed path is a gate file -> FULL, with the reason and both counts",
    run: (ok) => {
      const v = judge({ event: PR, changedFiles: ["src/a.ts", "README.md"], presentFiles: [] });
      let pass = ok(v.mode === "full", "a code-only diff is FULL");
      pass = ok(/^0 of 2 changed file\(s\) are gate files$/.test(v.reason), `both counts printed (got ${JSON.stringify(v.reason)})`) && pass;
      const e = judge({ event: PR, changedFiles: [], presentFiles: [] });
      return ok(e.mode === "full" && /^0 of 0 /.test(e.reason), "the EMPTY change set is FULL — never 'nothing to do'") && pass;
    },
  },
  {
    claim: "k gate files changed -> SUBSET naming exactly those k",
    run: (ok) => {
      const v = judge({ event: PR, changedFiles: [G2, "src/a.ts", G1], presentFiles: [G1, G2] });
      let pass = ok(v.mode === "subset", `mode is subset (got ${v.mode}: ${v.reason})`);
      return ok(JSON.stringify(v.files) === JSON.stringify([G1, G2]), `exactly the two gate files (got ${JSON.stringify(v.files)})`) && pass;
    },
  },
  {
    claim: "a gate-looking path failing the strict pattern -> FULL naming it, never silently dropped",
    run: (ok) => {
      const bad = "supabase/tests/test_x;rm -rf ~.sql";
      const v = judge({ event: PR, changedFiles: [G1, bad], presentFiles: [G1, bad] });
      let pass = ok(v.mode === "full", "a shell-metacharacter name forces FULL");
      pass = ok(v.reason.includes(bad), "and the reason names it") && pass;
      const helper = "supabase/tests/README.md";
      const h = judge({ event: PR, changedFiles: [G1, helper], presentFiles: [G1, helper] });
      return ok(h.mode === "full" && h.reason.includes(helper), "a non-gate file under supabase/tests/ forces FULL, named") && pass;
    },
  },
  {
    claim: "a changed gate path ABSENT from the checkout (deleted or moved) -> FULL naming it",
    run: (ok) => {
      const v = judge({ event: PR, changedFiles: [G1, G2], presentFiles: [G1] });
      let pass = ok(v.mode === "full", `a deleted/moved gate file forces FULL (got ${v.mode}: ${JSON.stringify(v.files)})`);
      return ok(/deleted or moved/.test(v.reason) && v.reason.includes(G2), `the reason names it as deleted-or-moved (got ${JSON.stringify(v.reason)})`) && pass;
    },
  },
  {
    claim: "a change to the mutation machinery or a lane input -> FULL naming it",
    run: (ok) => {
      const v = judge({ event: PR, changedFiles: [G1, "scripts/mutation-runner/run.mjs"], presentFiles: [G1] });
      let pass = ok(v.mode === "full" && v.reason.includes("scripts/mutation-runner/run.mjs"), "the runner itself forces FULL");
      const m = judge({ event: PR, changedFiles: [G1, "supabase/migrations/20260923000000_x.sql"], presentFiles: [G1] });
      return ok(m.mode === "full", "a migration a gate may apply forces FULL") && pass;
    },
  },
  {
    claim: "the emitted list is order-stable and duplicate-free",
    run: (ok) => {
      const a = judge({ event: PR, changedFiles: [G2, G1, G2], presentFiles: [G1, G2] });
      const b = judge({ event: PR, changedFiles: [G1, G2], presentFiles: [G1, G2] });
      let pass = ok(JSON.stringify(a.files) === JSON.stringify([G1, G2]), `duplicates collapsed, sorted (got ${JSON.stringify(a.files)})`);
      return ok(JSON.stringify(a) === JSON.stringify(b), "two orders of the same set give the same verdict") && pass;
    },
  },
];

function selfTest() {
  let pass = true;
  let asserted = 0;
  const ok = (cond, msg) => {
    asserted += 1;
    console.log(`  ${cond ? "ok  " : "FAIL"} — ${msg}`);
    return cond;
  };
  if (CASES.length === 0) {
    console.error("=== SELF-TEST FAILED: the fixture table is EMPTY — this self-test would prove nothing ===");
    return 1;
  }
  CASES.forEach((c, i) => {
    console.log(`=== SELF-TEST ${i + 1}/${CASES.length}: ${c.claim}`);
    pass = c.run(ok) && pass;
  });
  console.log("");
  if (asserted !== EXPECTED_ASSERTIONS) {
    console.error(
      `=== SELF-TEST FAILED: ${asserted} assertion(s) ran, EXPECTED_ASSERTIONS declares ${EXPECTED_ASSERTIONS}. ` +
        "An arm was deleted, skipped, or added without updating EXPECTED_ASSERTIONS. ===",
    );
    return 1;
  }
  if (!pass) {
    console.error("=== SELF-TEST FAILED ===");
    return 1;
  }
  console.log(`=== SELF-TEST PASSED: ${CASES.length}/${CASES.length} rows, ${asserted}/${EXPECTED_ASSERTIONS} assertions ===`);
  return 0;
}

function main() {
  if (process.argv.includes("--self-test")) return selfTest();
  const event = process.env.GITHUB_EVENT_NAME;
  if (event !== "pull_request") {
    emit(judge({ event, changedFiles: [], presentFiles: [] }));
    return 0;
  }
  let changedFiles;
  try {
    changedFiles = changedFilesAgainstBase();
  } catch (e) {
    // ⛔ A derivation that cannot read cannot narrow anything.
    console.error(e.message);
    return 1;
  }
  const presentFiles = changedFiles.filter((p) => GATE_FILE_RE.test(p) && existsSync(join(REPO_ROOT, p)));
  emit(judge({ event, changedFiles, presentFiles }));
  return 0;
}

/** Realpath-safe main-module guard, as `classify-changed-paths.mjs` carries it. */
function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  }
}

if (invokedDirectly()) {
  process.exit(main());
}
