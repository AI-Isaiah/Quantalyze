#!/usr/bin/env node
/**
 * Which SQL gate files did this pull request change? — Phase 164.4.2 plan 07 (DECISION D).
 *
 * The derivation half of the `sql-mutation` subset rule. On a `pull_request` the
 * mutation runner may run only the gate files whose content changed against the
 * PR's merge base; on every other event the FULL corpus is owed. This script
 * answers "which gate files, or FULL", and `run.mjs --subset-from` consumes it.
 * ⛔ CORRECTED 2026-10-03 (Phase 164.9.6): "on every other event the FULL corpus
 * is owed" stopped being true for ONE event; the sentence is kept as lineage.
 *
 * ── 2026-10-03 (Phase 164.9.6, D-01/D-02) — A PUSH TO MAIN IS JUDGED TOO ────
 * A `push` to `refs/heads/main` is now judged by its PUSHED RANGE,
 * `github.event.before..HEAD`, read through the SHARED push-range lister
 * (`pushRangeFiles` / `firstParentCommits` in `classify-changed-paths.mjs`),
 * the same lister the docs classifier's push path calls. Any doubt is FULL with
 * the reason printed: a ref other than main, a before-SHA that is absent,
 * malformed or all zeros, a forced push, a before-SHA missing from the clone or
 * not an ancestor of HEAD, a git error, a range that is not exactly ONE
 * first-parent GitHub PR merge commit, and an empty range. `workflow_dispatch`,
 * `schedule` and an unset event stay FULL (D-02). ⛔ The push path NEVER exits
 * non-zero: a red `changed-paths` would skip every dependent job and red `main`,
 * so every git, read or parse error there becomes FULL with its reason instead.
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
import { appendFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { changedFilesAgainstBase, firstParentCommits, isPrMergeCommit, pushRangeFiles, scratchRepo } from "./classify-changed-paths.mjs";

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
 * under any of these forces FULL. Trailing separators inside the directory
 * literals, so a sibling sharing the prefix (`scripts/pg-lane-notes/`) does not
 * match.
 *
 * The three single-file entries (review 164.4.2 WR-02) are machinery that lives
 * OUTSIDE those directories: this module (`run.mjs` imports `GATE_FILE_RE` from
 * it, and `judge` decides the subset), `classify-changed-paths.mjs` (the one diff
 * both callers share), and `ci.yml` (the `sql-mutation` job's pg_cron
 * provisioning, meta-command preflight and assert step). A PR editing any of
 * them is judged by the FULL corpus, never by the machinery it is changing.
 */
export const MACHINERY_PREFIXES = [
  "scripts/mutation-runner/",
  "scripts/pg-lane/",
  "supabase/migrations/",
  "scripts/sql-gate-subset.mjs",
  "scripts/classify-changed-paths.mjs",
  ".github/workflows/ci.yml",
];

/**
 * PURE: the verdict. No I/O — `presentFiles` (the changed gate paths that exist
 * in the checkout) is computed by `main()` with `existsSync`, so the
 * deleted-or-moved row is table-driven like every other row.
 *
 * On a `push` the inputs are `ref` (GITHUB_REF), `pushRange` (the shared
 * lister's `{ok, sha, files}` or `{ok: false, reason}`) and `commits` (the
 * range's first-parent `[hash, email, subject]` triples, or the Error the read
 * threw); `changedFiles` is unused there. See `judgePush`.
 *
 * @param {{event: string|undefined, changedFiles?: string[], presentFiles: Set<string>|string[], ref?: string,
 *   pushRange?: {ok: boolean, sha?: string, files?: string[], reason?: string}, commits?: string[][]|Error|null}} input
 * @returns {{mode: "full"|"subset", files: string[], reason: string}}
 */
export function judge({ event, changedFiles, presentFiles, ref, pushRange, commits }) {
  const full = (reason) => ({ mode: "full", files: [], reason });
  if (event === "push") return judgePush({ ref, pushRange, commits, presentFiles });
  if (event !== "pull_request") {
    return full(`event is '${event ?? "(unset)"}', neither pull_request nor push — the full corpus is owed`);
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
 * PURE: the push-to-main verdict (Phase 164.9.6, D-01). Every shape this cannot
 * positively identify as ONE GitHub PR squash on `main` is FULL with a named
 * reason; the gate-file rules after that are the pull_request arm's own.
 */
function judgePush({ ref, pushRange, commits, presentFiles }) {
  const full = (reason) => ({ mode: "full", files: [], reason });
  if (ref !== "refs/heads/main") {
    return full(`push to '${ref ?? "(unset)"}', not refs/heads/main — the full corpus is owed`);
  }
  if (!pushRange || pushRange.ok !== true) {
    return full(`push range undeterminable (${pushRange?.reason ?? "no range was read"})`);
  }
  if (commits instanceof Error) {
    return full(`the pushed range's commit log could not be read (${commits.message})`);
  }
  if (!Array.isArray(commits) || commits.length !== 1) {
    const n = Array.isArray(commits) ? commits.length : 0;
    return full(`the pushed range holds ${n} first-parent commit(s), not exactly one PR squash`);
  }
  const [hash, email, subject] = commits[0];
  const head12 = String(hash).slice(0, 12);
  if (!isPrMergeCommit(email, subject)) {
    return full(`commit ${head12} in the pushed range is not a GitHub PR merge`);
  }
  const changed = [...new Set(pushRange.files ?? [])].sort();
  if (changed.length === 0) return full("push range undeterminable (the range changed no files)");
  const where = `${String(pushRange.sha).slice(0, 12)}..HEAD (PR merge ${head12})`;
  const present = new Set(presentFiles);

  const machinery = changed.filter((p) => MACHINERY_PREFIXES.some((m) => p.startsWith(m)));
  if (machinery.length > 0) {
    return full(`the mutation machinery or a lane input changed in ${where}: ${machinery.join(" ")}`);
  }
  const underGateDir = changed.filter((p) => p.startsWith(GATE_DIR_PREFIX));
  const nonConforming = underGateDir.filter((p) => !GATE_FILE_RE.test(p));
  if (nonConforming.length > 0) {
    return full(`changed path(s) under ${GATE_DIR_PREFIX} fail the strict gate-file pattern: ${nonConforming.join(" ")}`);
  }
  if (underGateDir.length === 0) {
    return full(`0 of ${changed.length} changed file(s) in ${where} are gate files`);
  }
  const absent = underGateDir.filter((p) => !present.has(p));
  if (absent.length > 0) {
    return full(`changed gate file(s) absent from the checkout (deleted or moved): ${absent.join(" ")}`);
  }
  return {
    mode: "subset",
    files: underGateDir,
    reason: `${underGateDir.length} of ${changed.length} changed file(s) in ${where} are gate files`,
  };
}

/** The cap `oneLineReason` truncates to, before its suffix. */
export const REASON_MAX_CHARS = 1000;

/**
 * PURE: a reason made safe for ONE `$GITHUB_OUTPUT` line (T-164.9.6-01). A fork
 * PR chooses filenames and a filename can carry a newline, and a raw newline in
 * `$GITHUB_OUTPUT` starts a NEW key, so every character outside printable ASCII
 * (0x20-0x7E) becomes `?`. The two typographic characters this module's own
 * reasons use are spelled in ASCII first, so the line stays readable. Capped at
 * `REASON_MAX_CHARS`, with an ASCII suffix when cut.
 */
export function oneLineReason(text) {
  const ascii = String(text ?? "")
    .replace(/\u2014/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[^\x20-\x7e]/g, "?");
  return ascii.length > REASON_MAX_CHARS ? `${ascii.slice(0, REASON_MAX_CHARS)} ...(truncated)` : ascii;
}

/**
 * One always-on human line; the three `$GITHUB_OUTPUT` values only when the
 * variable is present — `classify-changed-paths.mjs`'s `emit()` shape. The
 * third, `sql_gate_reason` (Phase 164.9.6), carries the reason into
 * `sql-mutation` for its `scope-reason:` line, sanitised by `oneLineReason`.
 */
function emit(verdict) {
  const list = verdict.files.join(" ");
  console.log(
    `sql_gate_mode=${verdict.mode} — ${verdict.reason}${verdict.mode === "subset" ? `: ${list}` : ""}`,
  );
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `sql_gate_mode=${verdict.mode}\nsql_gate_files=${list}\nsql_gate_reason=${oneLineReason(verdict.reason)}\n`,
    );
  }
}

// ---------------------------------------------------------------------------
// --self-test
// ---------------------------------------------------------------------------

/** Declared up front; a self-test that shrinks and still says PASSED is the defect. */
export const EXPECTED_ASSERTIONS = 33;

const PR = "pull_request";
const G1 = "supabase/tests/test_alpha_gate.sql";
const G2 = "supabase/tests/test_beta_gate.sql";

const MAIN = "refs/heads/main";
const BEFORE = "b".repeat(40);
/** A first-parent commit shaped like a GitHub squash merge. */
const PR_MERGE = ["a".repeat(40), "noreply@github.com", "feat: x (#1)"];
const range = (files) => ({ ok: true, sha: BEFORE, files });

/**
 * Run THIS script's `main()` end to end as CI does, in `cwd`, on a push to
 * main. Every input is set explicitly so a parent CI environment (a
 * pull_request's values) cannot leak into the child. Returns the exit code and
 * every `key=value` it appended to GITHUB_OUTPUT.
 */
function runMainOnPush(cwd, env) {
  const dir = mkdtempSync(join(tmpdir(), "gsd-sql-gate-subset-out-"));
  const outFile = join(dir, "github-output");
  writeFileSync(outFile, "");
  try {
    const res = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: "push",
        GITHUB_REF: MAIN,
        GITHUB_OUTPUT: outFile,
        PUSH_BEFORE_SHA: "",
        PUSH_FORCED: "false",
        ...env,
      },
    });
    const outputs = {};
    for (const line of readFileSync(outFile, "utf8").split("\n")) {
      const at = line.indexOf("=");
      if (at > 0) outputs[line.slice(0, at)] = line.slice(at + 1);
    }
    return { code: res.status, outputs, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const CASES = [
  {
    claim: "an event that is neither pull_request nor push asks for the FULL corpus, naming the event (D-02)",
    run: (ok) => {
      let pass = true;
      for (const event of ["workflow_dispatch", "schedule"]) {
        const v = judge({ event, changedFiles: [G1], presentFiles: [G1] });
        pass = ok(v.mode === "full" && v.files.length === 0 && v.reason.includes(`'${event}'`), `${event} is FULL even with a gate file, named (got ${v.mode}: ${JSON.stringify(v.reason)})`) && pass;
      }
      const u = judge({ event: undefined, changedFiles: [G1], presentFiles: [G1] });
      return ok(u.mode === "full" && /\(unset\)/.test(u.reason), "an UNSET event is FULL, never a PR by default") && pass;
    },
  },
  {
    claim: "a push to main that is ONE PR squash changing one gate file -> SUBSET naming it and the range",
    run: (ok) => {
      const v = judge({ event: "push", ref: MAIN, pushRange: range([G1, "README.md"]), commits: [PR_MERGE], presentFiles: [G1] });
      let pass = ok(v.mode === "subset" && JSON.stringify(v.files) === JSON.stringify([G1]), `subset of exactly G1 (got ${v.mode}: ${JSON.stringify(v.files)} ${v.reason})`);
      pass = ok(v.reason.includes(PR_MERGE[0].slice(0, 12)) && v.reason.includes(BEFORE.slice(0, 12)), `the reason names the PR merge and the before-SHA (got ${JSON.stringify(v.reason)})`) && pass;
      return ok(v.reason.startsWith("1 of 2 changed file(s)"), `the reason carries k of n (got ${JSON.stringify(v.reason)})`) && pass;
    },
  },
  {
    claim: "oneLineReason keeps a reason to ONE printable-ASCII line, capped (T-164.9.6-01)",
    run: (ok) => {
      const r = oneLineReason("a\nsql_gate_mode=subset\0b");
      let pass = ok(r === "a?sql_gate_mode=subset?b", `a newline and a NUL both become '?' (got ${JSON.stringify(r)})`);
      const long = oneLineReason("x".repeat(2000));
      pass = ok(long.length <= REASON_MAX_CHARS + " ...(truncated)".length && long.endsWith("...(truncated)"), `a 2000-char reason is capped (got length ${long.length})`) && pass;
      return ok(/^[\x20-\x7e]*$/.test(oneLineReason("a \u2014 b \u2026 c \u00e9")), "every output character is printable ASCII") && pass;
    },
  },
  {
    claim: "END TO END: a real scratch-repo PR-squash push changing one gate file writes subset + a reason to GITHUB_OUTPUT, exit 0",
    run: (ok) => {
      const repo = scratchRepo("subset-push");
      try {
        const base = repo.commit({ [G1]: "-- base\n", "README.md": "x\n" });
        repo.commit({ [G1]: "-- changed\n" });
        const r = runMainOnPush(repo.dir, { PUSH_BEFORE_SHA: base, PUSH_FORCED: "false" });
        let pass = ok(r.code === 0, `exit 0 (got ${r.code}: ${r.out})`);
        pass = ok(r.outputs.sql_gate_mode === "subset" && r.outputs.sql_gate_files === G1, `subset of G1 written (got ${JSON.stringify(r.outputs)})`) && pass;
        return ok(Boolean(r.outputs.sql_gate_reason), `a non-empty sql_gate_reason written (got ${JSON.stringify(r.outputs.sql_gate_reason)})`) && pass;
      } finally {
        repo.cleanup();
      }
    },
  },
  {
    claim: "END TO END: the same scratch-repo push marked forced writes full, quoting the forced push, exit 0",
    run: (ok) => {
      const repo = scratchRepo("subset-forced");
      try {
        const base = repo.commit({ [G1]: "-- base\n" });
        repo.commit({ [G1]: "-- changed\n" });
        const r = runMainOnPush(repo.dir, { PUSH_BEFORE_SHA: base, PUSH_FORCED: "true" });
        let pass = ok(r.code === 0, `exit 0 (got ${r.code}: ${r.out})`);
        return ok(r.outputs.sql_gate_mode === "full" && /a forced push/.test(r.outputs.sql_gate_reason ?? ""), `full, quoting the forced push (got ${JSON.stringify(r.outputs)})`) && pass;
      } finally {
        repo.cleanup();
      }
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
    claim: "a change to the code that DECIDES the subset, or to the job that runs it -> FULL naming it",
    run: (ok) => {
      // Review 164.4.2 WR-02 (+ the silent-failure-hunter widening). run.mjs
      // imports GATE_FILE_RE from this module, both callers share one diff in
      // classify-changed-paths.mjs, and ci.yml holds the sql-mutation job's
      // pg_cron provisioning, meta-command preflight and assert step. Each
      // feeds every gate's verdict, so a PR touching one plus one gate file
      // must not be judged by the machinery it is changing.
      let pass = true;
      for (const f of ["scripts/sql-gate-subset.mjs", "scripts/classify-changed-paths.mjs", ".github/workflows/ci.yml"]) {
        const v = judge({ event: PR, changedFiles: [G1, f], presentFiles: [G1] });
        pass = ok(v.mode === "full" && v.reason.includes(f), `${f} forces FULL, named (got ${v.mode}: ${JSON.stringify(v.reason)})`) && pass;
      }
      return pass;
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

/**
 * The push-to-main derivation's I/O half (Phase 164.9.6). Reads the repository
 * at `cwd` (CI: the checkout; the self-test: a scratch repo). ⛔ NEVER THROWS:
 * any error becomes a FULL verdict carrying its reason.
 */
function derivePush(env, cwd) {
  try {
    const ref = env.GITHUB_REF;
    if (ref !== "refs/heads/main") return judge({ event: "push", ref, presentFiles: [] });
    const pushRange = pushRangeFiles({ before: env.PUSH_BEFORE_SHA, forced: env.PUSH_FORCED, cwd });
    let commits = null;
    if (pushRange.ok) {
      try {
        commits = firstParentCommits(pushRange.sha, cwd);
      } catch (e) {
        commits = new Error(firstLineOf(e));
      }
    }
    const files = pushRange.ok ? pushRange.files : [];
    const presentFiles = files.filter((p) => GATE_FILE_RE.test(p) && existsSync(join(cwd, p)));
    return judge({ event: "push", ref, pushRange, commits, presentFiles });
  } catch (e) {
    return { mode: "full", files: [], reason: `the push derivation failed (${firstLineOf(e)}) — the full corpus is owed` };
  }
}

/** The first line of a failed child's stderr, or the error message. */
function firstLineOf(e) {
  return (String(e?.stderr ?? "").trim().split("\n")[0] || String(e?.message ?? e)).trim();
}

function main() {
  if (process.argv.includes("--self-test")) return selfTest();
  const event = process.env.GITHUB_EVENT_NAME;
  if (event === "push") {
    emit(derivePush(process.env, process.cwd()));
    return 0;
  }
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
