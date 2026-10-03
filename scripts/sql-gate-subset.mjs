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
 *     ⚠️ (2026-10-03, Phase 164.9.6) "a migration a gate's RED-UNDER-SETUP may
 *     apply" is FULL on a PULL REQUEST only. On a push to main the gates whose
 *     setup list applies a changed migration are SELECTED instead (D-03, see
 *     `migrationLoaders`), and the setup list is EXACT for what the lane
 *     observes: the lane applies only a gate's setup list plus the gate file
 *     (research correction to D-03). On a push, `ci.yml` is machinery only when
 *     its `changed-paths` or `sql-mutation` job section changed, and the floors
 *     file is not machinery (D-10, see `PUSH_MACHINERY_PREFIXES`).
 *
 * ── THE D-09 EXCEPTION (founder override, 2026-10-03) ───────────────────────
 * On a push to `refs/heads/main` ONLY, a single-PR-squash range that changes no
 * gate file, no migration and no push machinery derives the NAMED verdict
 * `sql_gate_mode=none` ("no mutation input changed: …", with the changed-file
 * count). It is a recorded, scoped exception to the fence's "an empty change
 * set is FULL": pull requests keep the fence unchanged, and the nightly full run
 * is the backstop. A range that changes a migration no gate loads is NOT
 * covered by it and stays FULL.
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
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { changedFilesAgainstBase, firstParentCommits, isPrMergeCommit, pushRangeFiles, scratchRepo } from "./classify-changed-paths.mjs";
import { parseAnnotations } from "./mutation-runner/parse.mjs";

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
  "scripts/mutation-floors.mjs",
];

/** Where migrations live; a changed path under it selects its loaders on a push (D-03). */
export const MIGRATIONS_DIR_PREFIX = "supabase/migrations/";
/** The workflow whose two mutation job sections are compared on a push (D-10). */
export const CI_WORKFLOW = ".github/workflows/ci.yml";
/** The `ci.yml` jobs whose section change makes `ci.yml` machinery on a push (D-10). */
export const CI_MUTATION_JOBS = ["changed-paths", "sql-mutation"];
/** The floors data file (D-10), machinery on a pull request only. */
export const FLOORS_FILE = "scripts/mutation-floors.mjs";

/**
 * Inputs of a `sql-mutation` lane step OTHER than the corpus (review 164.9.6
 * WR-01): the "Dead-holder drill" step runs `scripts/pg-lane/mutex-dead-holder-lane.sh`,
 * which executes `scripts/mutex-dead-holder-verdict.sh` and the release-step body
 * it extracts from `supabase-migrate.yml`. Both lie outside every machinery
 * directory, so a push changing only one of them read as `none`, skipped the
 * lane, and with it the drill on `main`. On a push they are machinery (FULL).
 * Not added to `MACHINERY_PREFIXES`: a pull request never skips the lane, so the
 * drill already runs there, and the PR arm stays unchanged.
 */
export const LANE_STEP_INPUTS = ["scripts/mutex-dead-holder-verdict.sh", ".github/workflows/supabase-migrate.yml"];

/**
 * The machinery list on a PUSH to main (Phase 164.9.6, D-10), DERIVED from
 * `MACHINERY_PREFIXES` rather than hand-copied, so the two cannot drift. Three
 * entries are filtered out, each judged differently on a push:
 *   - `supabase/migrations/`: a changed migration selects the gates whose
 *     RED-UNDER-SETUP applies it (D-03), instead of forcing FULL;
 *   - `.github/workflows/ci.yml`: machinery only when its `changed-paths` or
 *     `sql-mutation` job section changed (`ciMutationSectionsChanged`);
 *   - `scripts/mutation-floors.mjs`: raising a floor is not a machinery change
 *     on a push (D-10); FULL runs (the nightly, any fallback) enforce floors.
 * ⭐ WHY THE FLOORS FILE STAYS IN `MACHINERY_PREFIXES` (planner interpretation,
 * recorded in CONTEXT.md, no D-number): pull-request behaviour is out of this
 * phase's scope, and today a PR that raises a floor edits `run.mjs` and runs
 * FULL, which proves the raised floor bites BEFORE merge. Keeping the floors
 * file PR machinery preserves exactly that once the floors move out of
 * `run.mjs`.
 * ⭐ (review 164.9.6 WR-01) `LANE_STEP_INPUTS` are then APPENDED: push-only
 * machinery, see that constant.
 */
export const PUSH_MACHINERY_PREFIXES = [
  ...MACHINERY_PREFIXES.filter((p) => p !== MIGRATIONS_DIR_PREFIX && p !== CI_WORKFLOW && p !== FLOORS_FILE),
  ...LANE_STEP_INPUTS,
];

/**
 * PURE: which of `CI_MUTATION_JOBS` differ between two `ci.yml` texts (D-10).
 * A job's section runs from its two-space job key line under `jobs:` to the
 * next two-space key line, the next column-0 key, or the end of the text.
 * ⛔ FAIL SAFE: a job absent from EITHER text counts as changed. Top-level keys
 * (`env:`, `concurrency:`) are not compared, by D-10's literal scope
 * (T-164.9.6-06, accepted; the nightly full run is the backstop).
 *
 * @returns {string[]} the changed job names, in `CI_MUTATION_JOBS` order
 */
export function ciMutationSectionsChanged(beforeText, afterText) {
  return CI_MUTATION_JOBS.filter((job) => {
    const a = jobSection(String(beforeText ?? ""), job);
    const b = jobSection(String(afterText ?? ""), job);
    return a === null || b === null || a !== b;
  });
}

/** One job's section text, or null when the job (or `jobs:`) is absent. */
function jobSection(text, job) {
  const lines = text.split("\n");
  const jobsAt = lines.findIndex((l) => /^jobs:\s*(#.*)?$/.test(l));
  if (jobsAt < 0) return null;
  // `job` is one of the CI_MUTATION_JOBS constants: letters and `-` only, no regex metacharacter.
  const key = new RegExp(`^  ${job}:\\s*(#.*)?$`);
  const start = lines.findIndex((l, i) => i > jobsAt && key.test(l));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^  [^\s#][^:]*:/.test(lines[i]) || /^[^\s#][^:]*:/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

/**
 * Which gates load each migration (Phase 164.9.6, D-03): every `supabase/tests/`
 * gate's RED-UNDER-SETUP `apply` list, read by the RUNNER'S OWN parser
 * (`parseAnnotations`), never a second regex. The lane applies only a gate's
 * setup list plus the gate file, so this map is EXACT for what the mutation
 * lane can observe (research correction to D-03).
 * ⛔ THROWS, naming the file, when any gate's annotations report a parse error:
 * a setup list that cannot be read cannot be trusted to name its loaders, and
 * the caller turns the throw into FULL.
 *
 * @param {string} root — the checkout to read
 * @returns {Map<string, string[]>} migration path -> sorted gate paths
 */
export function migrationLoaders(root) {
  const loaders = new Map();
  for (const name of readdirSync(join(root, GATE_DIR_PREFIX)).sort()) {
    const rel = `${GATE_DIR_PREFIX}${name}`;
    if (!GATE_FILE_RE.test(rel)) continue;
    const parsed = parseAnnotations(readFileSync(join(root, rel), "utf8"), { file: rel });
    if (parsed.errors.length > 0) {
      throw new Error(`${rel}: its RED-UNDER annotations do not parse (${parsed.errors[0].message})`);
    }
    for (const applied of parsed.setup?.apply ?? []) {
      if (!applied.startsWith(MIGRATIONS_DIR_PREFIX)) continue;
      if (!loaders.has(applied)) loaders.set(applied, []);
      loaders.get(applied).push(rel);
    }
  }
  return loaders;
}

/**
 * PURE: the verdict. No I/O — `presentFiles` (the changed gate paths that exist
 * in the checkout) is computed by `main()` with `existsSync`, so the
 * deleted-or-moved row is table-driven like every other row.
 *
 * On a `push` the inputs are `ref` (GITHUB_REF), `pushRange` (the shared
 * lister's `{ok, sha, files}` or `{ok: false, reason}`) and `commits` (the
 * range's first-parent `[hash, email, subject]` triples, or the Error the read
 * threw), plus `ciChangedSections` / `ciCompareError` (the D-10 section compare,
 * when `ci.yml` changed) and `loaders` / `loaderError` (the D-03 map, when a
 * migration changed); `changedFiles` is unused there. See `judgePush`.
 *
 * @param {{event: string|undefined, changedFiles?: string[], presentFiles: Set<string>|string[], ref?: string,
 *   pushRange?: {ok: boolean, sha?: string, files?: string[], reason?: string}, commits?: string[][]|Error|null,
 *   ciChangedSections?: string[], ciCompareError?: string, loaders?: Map<string, string[]>, loaderError?: string}} input
 * @returns {{mode: "full"|"subset"|"none", files: string[], reason: string}}
 */
export function judge({ event, changedFiles, presentFiles, ref, pushRange, commits, ciChangedSections, ciCompareError, loaders, loaderError }) {
  const full = (reason) => ({ mode: "full", files: [], reason });
  if (event === "push") {
    return judgePush({ ref, pushRange, commits, presentFiles, ciChangedSections, ciCompareError, loaders, loaderError });
  }
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
function judgePush({ ref, pushRange, commits, presentFiles, ciChangedSections, ciCompareError, loaders, loaderError }) {
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

  // D-10: the push machinery list, plus ci.yml only when a mutation job section
  // moved. A ci.yml change with NO compare result is machinery: never assumed harmless.
  const machinery = changed.filter((p) => PUSH_MACHINERY_PREFIXES.some((m) => p.startsWith(m)));
  if (changed.includes(CI_WORKFLOW)) {
    if (ciCompareError) machinery.push(`${CI_WORKFLOW} (job section compare failed: ${ciCompareError})`);
    else if (!Array.isArray(ciChangedSections)) machinery.push(`${CI_WORKFLOW} (job sections were not compared)`);
    else if (ciChangedSections.length > 0) machinery.push(`${CI_WORKFLOW} (job section(s) changed: ${ciChangedSections.join(" ")})`);
  }
  if (machinery.length > 0) {
    return full(`the mutation machinery or a lane input changed in ${where}: ${machinery.join(" ")}`);
  }
  const underGateDir = changed.filter((p) => p.startsWith(GATE_DIR_PREFIX));
  const nonConforming = underGateDir.filter((p) => !GATE_FILE_RE.test(p));
  if (nonConforming.length > 0) {
    return full(`changed path(s) under ${GATE_DIR_PREFIX} fail the strict gate-file pattern: ${nonConforming.join(" ")}`);
  }
  const absent = underGateDir.filter((p) => !present.has(p));
  if (absent.length > 0) {
    return full(`changed gate file(s) absent from the checkout (deleted or moved): ${absent.join(" ")}`);
  }
  const migrations = changed.filter((p) => p.startsWith(MIGRATIONS_DIR_PREFIX));
  if (underGateDir.length === 0 && migrations.length === 0) {
    // D-09 (founder override, push-on-main ONLY): a NAMED verdict, never an
    // empty scope read as a pass. Reached only after the ref, single-PR-squash
    // and machinery checks above.
    return {
      mode: "none",
      files: [],
      reason:
        `no mutation input changed: 0 gate file(s), 0 migration(s), 0 machinery path(s) among ` +
        `${changed.length} changed file(s) in ${where}; FULL coverage is the nightly run's`,
    };
  }
  if (loaderError) {
    return full(`a gate's RED-UNDER-SETUP list could not be read (${loaderError})`);
  }
  if (migrations.length > 0 && !(loaders instanceof Map)) {
    return full("a migration changed but the gate loader map was not read");
  }
  const loading = [...new Set(migrations.flatMap((m) => loaders.get(m) ?? []))];
  const selected = [...new Set([...underGateDir, ...loading])].sort();
  const unsafe = selected.filter((p) => !GATE_FILE_RE.test(p));
  if (unsafe.length > 0) {
    return full(`selected gate path(s) fail the strict gate-file pattern: ${unsafe.join(" ")}`);
  }
  if (selected.length === 0) {
    return full(
      `changed migration(s) loaded by no gate's RED-UNDER-SETUP: ${migrations.join(" ")}; D-09 covers only a ` +
        "range with no migration, so the vacuity fence owes the full corpus",
    );
  }
  const migNote = migrations.length > 0 ? `, ${loading.length} gate(s) loading changed migration(s) ${migrations.join(" ")}` : "";
  return {
    mode: "subset",
    files: selected,
    reason: `${underGateDir.length} of ${changed.length} changed file(s) in ${where} are gate files${migNote}`,
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
export const EXPECTED_ASSERTIONS = 73;

const PR = "pull_request";
const G1 = "supabase/tests/test_alpha_gate.sql";
const G2 = "supabase/tests/test_beta_gate.sql";

const MAIN = "refs/heads/main";
const BEFORE = "b".repeat(40);
/** A first-parent commit shaped like a GitHub squash merge. */
const PR_MERGE = ["a".repeat(40), "noreply@github.com", "feat: x (#1)"];
const range = (files) => ({ ok: true, sha: BEFORE, files });
const G3 = "supabase/tests/test_gamma_gate.sql";
const M = "supabase/migrations/20260101000000_self_test.sql";
const FLOORS = "scripts/mutation-floors.mjs";
const CI = ".github/workflows/ci.yml";

/**
 * A gate fixture `parseAnnotations` accepts with ZERO errors: a setup line
 * applying `migration`, one prose arm and its structured twin (the shape the
 * real corpus uses, minimised).
 */
const fixtureGate = (migration) =>
  [
    `-- RED-UNDER-SETUP: {"apply":["${migration}"]}`,
    "-- RED-UNDER: drop the second statement from the migration.",
    `-- RED-UNDER-M: {"arm":"1","apply":[{"kind":"edit","file":"${migration}","find":"SELECT 1;","replace":"SELECT 0;","occurrences":1}]}`,
    "SELECT 1;",
    "",
  ].join("\n");

/** A ci.yml with the two compared jobs plus `sql-tests`, which alone carries `variant`. */
const ciFixture = (variant) =>
  `name: CI\njobs:\n  changed-paths:\n    runs-on: ubuntu-latest\n  sql-mutation:\n    runs-on: ubuntu-latest\n  sql-tests:\n    runs-on: ubuntu-${variant}\n`;

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
    claim: "a push to main FALLS BACK to FULL, named, on every shape it cannot identify as one PR squash on main",
    run: (ok) => {
      const at = (over) => judge({ event: "push", ref: MAIN, pushRange: range([G1]), commits: [PR_MERGE], presentFiles: [G1], ...over });
      const rows = [
        [{ ref: "refs/heads/feature" }, /refs\/heads\/feature/, "a ref other than main"],
        [{ ref: undefined }, /\(unset\)/, "an unset ref"],
        [{ pushRange: { ok: false, reason: "a forced push" } }, /push range undeterminable \(a forced push\)/, "an undeterminable range"],
        [{ commits: new Error("fatal: bad revision") }, /commit log could not be read \(fatal: bad revision\)/, "a commit-log read error"],
        [{ commits: [PR_MERGE, PR_MERGE] }, /2 first-parent commit\(s\), not exactly one/, "a two-commit range"],
        [{ commits: [] }, /0 first-parent commit\(s\)/, "a range with no first-parent commit"],
        [{ commits: [["c".repeat(40), "dev@invalid", "fix: direct"]] }, /not a GitHub PR merge/, "a direct push, not a PR merge"],
        [{ pushRange: range([]) }, /changed no files/, "an empty range"],
      ];
      let pass = true;
      for (const [over, want, label] of rows) {
        const v = at(over);
        pass = ok(v.mode === "full" && v.files.length === 0 && want.test(v.reason), `${label} is FULL, named (got ${v.mode}: ${JSON.stringify(v.reason)})`) && pass;
      }
      return pass;
    },
  },
  {
    claim: "D-10: on a push the runner, the pg-lane and the two subset scripts stay machinery -> FULL naming them",
    run: (ok) => {
      let pass = true;
      for (const f of ["scripts/mutation-runner/run.mjs", "scripts/pg-lane/x", "scripts/sql-gate-subset.mjs", "scripts/classify-changed-paths.mjs"]) {
        const v = judge({ event: "push", ref: MAIN, pushRange: range([G1, f]), commits: [PR_MERGE], presentFiles: [G1] });
        pass = ok(v.mode === "full" && v.reason.includes(f), `${f} forces FULL on a push, named (got ${v.mode}: ${JSON.stringify(v.reason)})`) && pass;
      }
      return pass;
    },
  },
  {
    claim: "WR-01: a push changing ONLY a dead-holder drill input is FULL naming it, never none (the drill would be skipped)",
    run: (ok) => {
      let pass = true;
      for (const f of ["scripts/mutex-dead-holder-verdict.sh", ".github/workflows/supabase-migrate.yml"]) {
        const v = judge({ event: "push", ref: MAIN, pushRange: range([f]), commits: [PR_MERGE], presentFiles: [] });
        pass = ok(v.mode === "full" && v.reason.includes(f), `a push changing only ${f} is FULL, named (got ${v.mode}: ${JSON.stringify(v.reason)})`) && pass;
      }
      return pass;
    },
  },
  {
    claim: "D-10: the floors file is NOT machinery on a push, and STAYS machinery on a pull request",
    run: (ok) => {
      const v = judge({ event: "push", ref: MAIN, pushRange: range([G1, FLOORS]), commits: [PR_MERGE], presentFiles: [G1] });
      let pass = ok(v.mode === "subset" && JSON.stringify(v.files) === JSON.stringify([G1]), `a push raising a floor plus G1 is SUBSET [G1] (got ${v.mode}: ${JSON.stringify(v.files)} ${v.reason})`);
      const p = judge({ event: PR, changedFiles: [G1, FLOORS], presentFiles: [G1] });
      return ok(p.mode === "full" && p.reason.includes(FLOORS), `a PR raising a floor stays FULL, named (got ${p.mode}: ${JSON.stringify(p.reason)})`) && pass;
    },
  },
  {
    claim: "D-10: on a push ci.yml is machinery ONLY when its changed-paths or sql-mutation section changed, or the compare failed",
    run: (ok) => {
      const at = (over) => judge({ event: "push", ref: MAIN, pushRange: range([G1, CI]), commits: [PR_MERGE], presentFiles: [G1], ...over });
      const other = at({ ciChangedSections: [] });
      let pass = ok(other.mode === "subset" && JSON.stringify(other.files) === JSON.stringify([G1]), `only another job moved -> SUBSET [G1] (got ${other.mode}: ${other.reason})`);
      const sec = at({ ciChangedSections: ["sql-mutation"] });
      pass = ok(sec.mode === "full" && sec.reason.includes(CI) && sec.reason.includes("sql-mutation"), `the sql-mutation section moved -> FULL naming ci.yml and the section (got ${JSON.stringify(sec.reason)})`) && pass;
      const err = at({ ciCompareError: "fatal: path not in tree" });
      pass = ok(err.mode === "full" && err.reason.includes("fatal: path not in tree"), `a failed section compare -> FULL naming the error (got ${JSON.stringify(err.reason)})`) && pass;
      const none = at({});
      return ok(none.mode === "full" && none.reason.includes(CI), `a ci.yml change with NO compare result -> FULL, never assumed harmless (got ${JSON.stringify(none.reason)})`) && pass;
    },
  },
  {
    claim: "ciMutationSectionsChanged slices the two jobs and fails safe on a missing one",
    run: (ok) => {
      const yml = (cp, sm, st) => `name: CI\non:\n  push:\njobs:\n  changed-paths:\n    runs-on: ${cp}\n  sql-mutation:\n    runs-on: ${sm}\n  sql-tests:\n    runs-on: ${st}\n`;
      const a = yml("u", "u", "u");
      let pass = ok(JSON.stringify(ciMutationSectionsChanged(a, yml("u", "u", "CHANGED"))) === "[]", "a change inside sql-tests only -> []");
      pass = ok(JSON.stringify(ciMutationSectionsChanged(a, yml("CHANGED", "u", "u"))) === JSON.stringify(["changed-paths"]), "a change inside changed-paths -> [changed-paths]") && pass;
      const missing = a.replace("  sql-mutation:\n    runs-on: u\n", "");
      return ok(JSON.stringify(ciMutationSectionsChanged(a, missing)) === JSON.stringify(["sql-mutation"]), `sql-mutation absent on one side -> [sql-mutation] (got ${JSON.stringify(ciMutationSectionsChanged(a, missing))})`) && pass;
    },
  },
  {
    claim: "D-03: a push changing a migration selects the changed gates PLUS every gate whose setup loads it",
    run: (ok) => {
      const at = (files, over) => judge({ event: "push", ref: MAIN, pushRange: range(files), commits: [PR_MERGE], presentFiles: files.filter((f) => GATE_FILE_RE.test(f)), ...over });
      const v = at([M, G1], { loaders: new Map([[M, [G3, G2]]]) });
      let pass = ok(v.mode === "subset" && JSON.stringify(v.files) === JSON.stringify([G1, G2, G3]), `subset [G1, G2, G3], sorted and unique (got ${v.mode}: ${JSON.stringify(v.files)} ${v.reason})`);
      const lone = at([M], { loaders: new Map() });
      pass = ok(lone.mode === "full" && /loaded by no gate/.test(lone.reason) && lone.reason.includes(M), `a migration no gate loads, no gate changed -> FULL (got ${JSON.stringify(lone.reason)})`) && pass;
      const bad = at([M, G1], { loaderError: "supabase/tests/test_x.sql: malformed JSON" });
      return ok(bad.mode === "full" && bad.reason.includes("malformed JSON"), `an unreadable setup list -> FULL naming it (got ${JSON.stringify(bad.reason)})`) && pass;
    },
  },
  {
    claim: "D-09: a push to main changing no gate, no migration and no machinery is the NAMED verdict none; a PR keeps the fence",
    run: (ok) => {
      const v = judge({ event: "push", ref: MAIN, pushRange: range(["README.md", "src/a.ts"]), commits: [PR_MERGE], presentFiles: [] });
      let pass = ok(v.mode === "none" && v.files.length === 0, `mode none with no files (got ${v.mode}: ${JSON.stringify(v.files)})`);
      pass = ok(v.reason.startsWith("no mutation input changed:") && v.reason.includes("2 changed file(s)"), `the reason is named and carries the count (got ${JSON.stringify(v.reason)})`) && pass;
      const p = judge({ event: PR, changedFiles: ["README.md", "src/a.ts"], presentFiles: [] });
      return ok(p.mode === "full", `the same files on a pull_request stay FULL (got ${p.mode})`) && pass;
    },
  },
  {
    claim: "migrationLoaders reads the REAL corpus through parseAnnotations, and REFUSES a malformed setup list",
    run: (ok) => {
      const real = migrationLoaders(REPO_ROOT);
      let pass = ok(real instanceof Map && real.size > 0, `a non-empty loader map over the real corpus (got ${real.size})`);
      const values = [...real.values()].flat();
      pass = ok(values.length > 0 && values.every((g) => GATE_FILE_RE.test(g)), "every loader passes GATE_FILE_RE") && pass;
      pass = ok([...real.keys()].every((k) => k.startsWith("supabase/migrations/")), "every key is under supabase/migrations/") && pass;
      const dir = mkdtempSync(join(tmpdir(), "gsd-sql-gate-loaders-"));
      try {
        mkdirSync(join(dir, "supabase/tests"), { recursive: true });
        writeFileSync(join(dir, G1), "-- RED-UNDER-SETUP: {not json}\n");
        let threw = null;
        try {
          migrationLoaders(dir);
        } catch (e) {
          threw = e;
        }
        return ok(threw !== null && String(threw.message).includes(G1), `a malformed setup list THROWS naming the file (got ${threw ? threw.message : "no throw"})`) && pass;
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    claim: "END TO END (164.5.2.1-shaped): migration + new gate + floors + an unrelated ci.yml job -> subset [G1, G2]",
    run: (ok) => {
      const repo = scratchRepo("subset-migration");
      try {
        const gate2 = fixtureGate(M);
        let pass = ok(parseAnnotations(gate2, { file: G2 }).errors.length === 0, "the fixture gate parses with ZERO errors (else a FULL here would point at the wrong cause)");
        const base = repo.commit({ [G2]: gate2, [M]: "SELECT 1;\n", [FLOORS]: "export const FILES_FLOOR = 1;\n", [CI]: ciFixture("a") });
        repo.commit({ [M]: "SELECT 1;\nSELECT 2;\n", [G1]: "-- new gate\n", [FLOORS]: "export const FILES_FLOOR = 2;\n", [CI]: ciFixture("b") });
        const r = runMainOnPush(repo.dir, { PUSH_BEFORE_SHA: base });
        pass = ok(r.code === 0, `exit 0 (got ${r.code}: ${r.out})`) && pass;
        return ok(r.outputs.sql_gate_mode === "subset" && r.outputs.sql_gate_files === `${G1} ${G2}`, `subset of G1 and G2 (got ${JSON.stringify(r.outputs)})`) && pass;
      } finally {
        repo.cleanup();
      }
    },
  },
  {
    claim: "END TO END: a PR-squash push changing only CHANGELOG.md writes none, exit 0 (D-09)",
    run: (ok) => {
      const repo = scratchRepo("subset-none");
      try {
        const base = repo.commit({ [G1]: "-- base\n", "CHANGELOG.md": "a\n" });
        repo.commit({ "CHANGELOG.md": "b\n" });
        const r = runMainOnPush(repo.dir, { PUSH_BEFORE_SHA: base });
        let pass = ok(r.code === 0, `exit 0 (got ${r.code}: ${r.out})`);
        return ok(r.outputs.sql_gate_mode === "none" && r.outputs.sql_gate_files === "" && /^no mutation input changed:/.test(r.outputs.sql_gate_reason ?? ""), `none with an empty list and the named reason (got ${JSON.stringify(r.outputs)})`) && pass;
      } finally {
        repo.cleanup();
      }
    },
  },
  {
    claim: "END TO END: a range of TWO first-parent commits writes full, exit 0",
    run: (ok) => {
      const repo = scratchRepo("subset-two");
      try {
        const base = repo.commit({ [G1]: "-- base\n" });
        repo.commit({ [G1]: "-- one\n" });
        repo.commit({ [G1]: "-- two\n" });
        const r = runMainOnPush(repo.dir, { PUSH_BEFORE_SHA: base });
        let pass = ok(r.code === 0, `exit 0 (got ${r.code}: ${r.out})`);
        return ok(r.outputs.sql_gate_mode === "full" && /2 first-parent commit\(s\)/.test(r.outputs.sql_gate_reason ?? ""), `full, naming the two commits (got ${JSON.stringify(r.outputs)})`) && pass;
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
    let ciChangedSections;
    let ciCompareError;
    if (files.includes(CI_WORKFLOW)) {
      try {
        ciChangedSections = ciMutationSectionsChanged(gitShow(`${pushRange.sha}:${CI_WORKFLOW}`, cwd), gitShow(`HEAD:${CI_WORKFLOW}`, cwd));
      } catch (e) {
        ciCompareError = firstLineOf(e);
      }
    }
    let loaders;
    let loaderError;
    if (files.some((p) => p.startsWith(MIGRATIONS_DIR_PREFIX))) {
      try {
        loaders = migrationLoaders(cwd);
      } catch (e) {
        loaderError = firstLineOf(e);
      }
    }
    return judge({ event: "push", ref, pushRange, commits, presentFiles, ciChangedSections, ciCompareError, loaders, loaderError });
  } catch (e) {
    return { mode: "full", files: [], reason: `the push derivation failed (${firstLineOf(e)}) — the full corpus is owed` };
  }
}

/** `git show <rev:path>`, stderr PIPED so a `fatal:` line travels inside the reason. */
function gitShow(spec, cwd) {
  return execFileSync("git", ["show", spec], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
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
