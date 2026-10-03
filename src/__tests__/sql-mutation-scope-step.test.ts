/**
 * The `sql-mutation` D-09 scope step, executed (Phase 164.9.6, plan 04).
 *
 * WHY THIS FILE EXISTS. One step output, `steps.scope.outputs.skip_lane`, now
 * decides whether eight lane steps run. If it read `true` on the wrong input, a
 * pull request (or any run that owes the full corpus) would exit green without
 * mutating a single arm. That is the silent-green class this whole job exists to
 * end. So this file does not read the step's text and trust it. It EXECUTES the
 * step's real `run: |` body, extracted from ci.yml, under bash, once per
 * event/ref/mode/reason/files combination. It then proves the rows can fail by
 * running two calibration copies with one condition removed.
 *
 * It also pins the GATING: every step after the scope step must carry exactly
 * the fail-safe `!= 'true'` expression. The `== 'false'` form would skip the
 * lane whenever the output is missing, which is the opposite direction. Two
 * more calibration copies (a deleted line, a flipped expression) prove the pin
 * names the step it catches.
 *
 * ⛔ Every bash spawn gets an EXPLICIT env (PATH plus the row's keys).
 * vitest in CI inherits the real GITHUB_EVENT_NAME / GITHUB_REF / GITHUB_OUTPUT,
 * and an inherited value would make a row pass on one event and fail on another.
 */
import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CI_TEXT = readFileSync(join(REPO_ROOT, ".github", "workflows", "ci.yml"), "utf8");

const SCOPE_STEP_NAME =
  "Scope - print what this run covers and why; a push to main that changed no mutation input skips the lane (D-09)";
const GATE_EXPR = "steps.scope.outputs.skip_lane != 'true'";

// ⛔ AN ABSENT ANCHOR IS A FINDING, NOT A VALUE. An unchecked indexOf -> slice
// degenerates (slice(-1) is the LAST character) and every assertion over the
// result then passes vacuously. Throw, and name the anchor.
function anchorIndex(text: string, anchor: string, from = 0): number {
  const at = text.indexOf(anchor, from);
  if (at < 0) {
    throw new Error(
      `ANCHOR MISSING: ${JSON.stringify(anchor)} is not present in the subject text. ` +
        `Fix the anchor or the subject; do not default it.`,
    );
  }
  return at;
}

/** Replace exactly one occurrence of `from`; a miss throws by name (calibration copies). */
function replaceOnce(text: string, from: string, to: string): string {
  const at = anchorIndex(text, from);
  return text.slice(0, at) + to + text.slice(at + from.length);
}

/** The `sql-mutation` job, from its key to the next job's key. */
function jobSlice(ciText: string): string {
  const start = anchorIndex(ciText, "\n  sql-mutation:");
  return ciText.slice(start, anchorIndex(ciText, "\n  plan-anchor-verify:", start));
}

/** The scope step's `run: |` body, dedented, straight out of ci.yml. */
function scopeStepBody(ciText: string = CI_TEXT): string {
  const job = jobSlice(ciText);
  const stepAt = anchorIndex(job, `- name: ${SCOPE_STEP_NAME}\n`);
  const runAt = anchorIndex(job, "\n        run: |\n", stepAt);
  const body = job.slice(runAt + "\n        run: |\n".length);
  const out: string[] = [];
  for (const line of body.split("\n")) {
    if (line.trim() !== "" && !line.startsWith("          ")) break;
    out.push(line.slice(10));
  }
  const script = out.join("\n");
  if (!script.includes('echo "skip_lane=')) {
    throw new Error("the extracted scope-step body writes no skip_lane output; the extraction is wrong");
  }
  return script;
}

interface ScopeRun {
  status: number | null;
  stdout: string;
  out: string;
  output: string;
}

/** Run `body` under bash with ONLY PATH and `env`, and a temp GITHUB_OUTPUT. */
function runScope(env: Record<string, string>, body: string = scopeStepBody()): ScopeRun {
  const dir = mkdtempSync(join(tmpdir(), "scope-step-"));
  try {
    const script = join(dir, "scope.sh");
    const outFile = join(dir, "github-output");
    writeFileSync(script, body);
    writeFileSync(outFile, "");
    const childEnv: Record<string, string> = { PATH: process.env.PATH ?? "", GITHUB_OUTPUT: outFile, ...env };
    const res = spawnSync("bash", [script], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: childEnv as NodeJS.ProcessEnv,
    });
    const stdout = res.stdout ?? "";
    return {
      status: res.status,
      stdout,
      out: `${stdout}${res.stderr ?? ""}`,
      output: readFileSync(outFile, "utf8"),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const REASON =
  "no mutation input changed: 0 gate file(s), 0 migration(s), 0 machinery path(s) among 3 changed file(s)";
const PUSH_MAIN = { GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/main" };
const NONE_OK = { SQL_GATE_MODE: "none", SQL_GATE_REASON: REASON, SQL_GATE_FILES: "" };

describe("sql-mutation scope step: the real run body, executed (D-09)", () => {
  it("none on a push to main with a reason and no files skips the lane and prints both lines", () => {
    const r = runScope({ ...PUSH_MAIN, ...NONE_OK });
    expect(r.status, r.out).toBe(0);
    expect(r.stdout).toContain("scope: NONE 0 gate files — no mutation input changed\n");
    expect(r.stdout).toContain(`scope-reason: ${REASON}\n`);
    expect(r.output, "the one verified path must write skip_lane=true").toBe("skip_lane=true\n");
    // D-12: the reason is printed BEFORE the lane is skipped, on the same run.
    expect(r.stdout.indexOf("scope: NONE")).toBeLessThan(r.stdout.indexOf("scope-reason:"));
  });

  it.each([
    ["a pull_request", { GITHUB_EVENT_NAME: "pull_request", GITHUB_REF: "refs/pull/1/merge" }, "pull_request"],
    ["a feature-branch push", { GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/feature-x" }, "push"],
    ["a dispatch on main", { GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main" }, "workflow_dispatch"],
  ])("none on %s is refused: the lane boots and a warning names the event", (_label, ev, event) => {
    const r = runScope({ ...ev, ...NONE_OK });
    expect(r.status, r.out).toBe(0);
    expect(r.output).toBe("skip_lane=false\n");
    expect(r.stdout).toContain(`::warning::changed-paths said sql_gate_mode=none on a '${event}' event (${ev.GITHUB_REF}).`);
    expect(r.stdout).toContain("D-09 honours it only on a push to refs/heads/main");
    expect(r.stdout).not.toContain("scope: NONE");
  });

  it.each([
    ["an empty reason", ""],
    ["a whitespace-only reason", "  \t "],
  ])("none on a push to main with %s is a MEASURE_FAIL, never a skip", (_label, reason) => {
    const r = runScope({ ...PUSH_MAIN, ...NONE_OK, SQL_GATE_REASON: reason });
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain("MEASURE_FAIL");
    expect(r.out).toContain("BLANK sql_gate_reason");
    expect(r.output).not.toContain("skip_lane=true");
    expect(r.stdout).not.toContain("scope: NONE");
  });

  it("none on a push to main that names gate files is a MEASURE_FAIL, never a skip", () => {
    const r = runScope({ ...PUSH_MAIN, ...NONE_OK, SQL_GATE_FILES: "supabase/tests/test_alpha_gate.sql" });
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain("MEASURE_FAIL");
    expect(r.out).toContain("sql_gate_files is NOT empty (supabase/tests/test_alpha_gate.sql)");
    expect(r.output).not.toContain("skip_lane=true");
  });

  it.each([
    ["subset", { SQL_GATE_MODE: "subset", SQL_GATE_FILES: "supabase/tests/test_alpha_gate.sql", SQL_GATE_REASON: "1 of 2" }],
    ["full", { SQL_GATE_MODE: "full", SQL_GATE_FILES: "", SQL_GATE_REASON: "machinery changed" }],
    ["an unset mode", {}],
    ["a garbled mode", { SQL_GATE_MODE: "None", SQL_GATE_REASON: REASON, SQL_GATE_FILES: "" }],
  ])("%s on a push to main boots the lane, with no scope: NONE line and no warning", (label, row) => {
    const r = runScope({ ...PUSH_MAIN, ...row });
    expect(r.status, r.out).toBe(0);
    expect(r.output).toBe("skip_lane=false\n");
    expect(r.stdout).not.toContain("scope: NONE");
    expect(r.stdout).not.toContain("::warning::");
    const mode = (row as Record<string, string>).SQL_GATE_MODE ?? "";
    expect(r.stdout, label).toContain(`scope verdict from changed-paths: sql_gate_mode=${mode}; the lane boots.`);
  });

  it("CALIBRATION A: with the event test removed, the pull_request row skips the lane (so the row reads the event check)", () => {
    const body = replaceOnce(scopeStepBody(), '[ "$event" = "push" ] && ', "");
    const r = runScope({ GITHUB_EVENT_NAME: "pull_request", GITHUB_REF: "refs/heads/main", ...NONE_OK }, body);
    expect(r.output).toBe("skip_lane=true\n");
    // Control: the real body refuses the same input.
    const real = runScope({ GITHUB_EVENT_NAME: "pull_request", GITHUB_REF: "refs/heads/main", ...NONE_OK });
    expect(real.output).toBe("skip_lane=false\n");
  });

  it("CALIBRATION B: with the ref test removed, the feature-branch push skips the lane (so the row reads the ref check)", () => {
    const body = replaceOnce(scopeStepBody(), ' && [ "$ref" = "refs/heads/main" ]', "");
    const r = runScope({ GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/feature-x", ...NONE_OK }, body);
    expect(r.output).toBe("skip_lane=true\n");
    const real = runScope({ GITHUB_EVENT_NAME: "push", GITHUB_REF: "refs/heads/feature-x", ...NONE_OK });
    expect(real.output).toBe("skip_lane=false\n");
  });
});

// ---------------------------------------------------------------------------
// The gating pin
// ---------------------------------------------------------------------------

interface Step {
  name: string;
  ifLines: string[];
}

/** Steps of the sql-mutation job at the six-space `- ` indent, with their eight-space `if:` lines. */
function jobSteps(ciText: string): Step[] {
  const job = jobSlice(ciText);
  const stepsAt = anchorIndex(job, "\n    steps:\n");
  const chunks = job.slice(stepsAt).split("\n      - ").slice(1);
  return chunks.map((chunk) => {
    const first = chunk.split("\n")[0];
    const name = first.startsWith("name: ") ? first.slice("name: ".length) : first;
    const ifLines = ("        " + chunk).split("\n").filter((l) => /^ {8}if:/.test(l));
    return { name, ifLines };
  });
}

/** Every gating violation in `ciText`, each naming its step. Empty means the gating is intact. */
function gatingViolations(ciText: string): string[] {
  const steps = jobSteps(ciText);
  const scopeAt = steps.findIndex((s) => s.name === SCOPE_STEP_NAME);
  if (scopeAt < 0) return [`the scope step "${SCOPE_STEP_NAME}" is missing from the sql-mutation job`];
  const v: string[] = [];
  steps.forEach((s, i) => {
    if (i <= scopeAt) {
      if (s.ifLines.length > 0) v.push(`step "${s.name}" (at or before the scope step) carries an if: ${s.ifLines.join(" | ")}`);
      return;
    }
    if (s.ifLines.length !== 1 || s.ifLines[0] !== `        if: ${GATE_EXPR}`) {
      v.push(
        `step "${s.name}" (after the scope step) must carry exactly one \`if: ${GATE_EXPR}\`, has: ${
          s.ifLines.length ? s.ifLines.join(" | ") : "none"
        }`,
      );
    }
  });
  return v;
}

describe("sql-mutation step gating: fail-safe, uniform, and nothing before the scope step", () => {
  it("the scope step is the first step after checkout and setup-node, and every later step carries the fail-safe expression", () => {
    const steps = jobSteps(CI_TEXT);
    const scopeAt = steps.findIndex((s) => s.name === SCOPE_STEP_NAME);
    expect(scopeAt, "the scope step is missing or renamed").toBe(2);
    expect(steps[0].name).toContain("actions/checkout@");
    expect(steps[1].name).toContain("actions/setup-node@");
    expect(gatingViolations(CI_TEXT)).toEqual([]);
    // MEASURED 2026-10-03: eight lane steps follow the scope step (pg_cron,
    // dblink, binaries, dead-holder drill, preflight, self-test, mutate, assert).
    // A ninth step added without the condition is caught by gatingViolations.
    expect(steps.length - scopeAt - 1).toBe(8);
    expect(steps[steps.length - 1].name).toBe("Assert the run PRINTED its coverage and cleared both floors");
  });

  it("the job keeps its one job-level if: and its 20-minute timeout", () => {
    const job = jobSlice(CI_TEXT);
    expect(job.match(/^ {4}if:/gm)?.length ?? 0).toBe(1);
    expect(job).toMatch(/^ {4}timeout-minutes: 20$/m);
  });

  it("CALIBRATION C: deleting the condition from one later step is named by the pin", () => {
    const target = "      - name: Runner self-test - every defect kind still fires\n";
    const mutated = replaceOnce(CI_TEXT, `${target}        if: ${GATE_EXPR}\n`, target);
    const v = gatingViolations(mutated);
    expect(v).toHaveLength(1);
    expect(v[0]).toContain('step "Runner self-test - every defect kind still fires"');
    expect(v[0]).toContain("has: none");
  });

  it("CALIBRATION D: flipping one later step to the == 'false' form is named by the pin", () => {
    const target = "      - name: Mutate every annotated RED-UNDER arm and require it to bite\n";
    const mutated = replaceOnce(
      CI_TEXT,
      `${target}        if: ${GATE_EXPR}\n`,
      `${target}        if: steps.scope.outputs.skip_lane == 'false'\n`,
    );
    const v = gatingViolations(mutated);
    expect(v).toHaveLength(1);
    expect(v[0]).toContain('step "Mutate every annotated RED-UNDER arm and require it to bite"');
    expect(v[0]).toContain("skip_lane == 'false'");
  });
});

// ---------------------------------------------------------------------------
// End to end on real history: the derivation's ACTUAL output drives the step
// ---------------------------------------------------------------------------
//
// The two halves CI composes, composed the same way: `scripts/sql-gate-subset.mjs`
// (the NEW script, copied over the OLD tree in a detached scratch worktree, as
// CI would run it on that push) writes its three outputs, and those three values
// are fed into the real scope-step body with the same event and ref.
//
// `98f04db16` is the phase trigger: a planning-only squash push that ran the full
// corpus and crossed the 20-minute ceiling. `fd4d86cdf` changed one gate file.
// ⛔ A missing sha FAILS, naming the object, and never skips. CI's
// `frontend-test` job checks out with full history (`fetch-depth: 0`, measured
// 2026-10-03), so both objects resolve there as they do locally.
// MEASURED 2026-10-03: `scripts/mutation-runner/parse.mjs`, which the derivation
// imports, is byte-identical between both shas and HEAD, so copying the two
// scripts is enough.

const WT_PREFIX = "scope-e2e-";
// realpath: on macOS tmpdir() is a symlinked /var path while `git worktree list`
// prints the resolved /private/var path, so an unresolved prefix never matches
// and a leftover check built on it would pass without checking anything.
const TMP_REAL = realpathSync(tmpdir());

function git(args: string[], cwd: string = REPO_ROOT): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function worktreesUnderPrefix(): string[] {
  return git(["worktree", "list", "--porcelain"])
    .split("\n")
    .filter((l) => l.startsWith(`worktree ${join(TMP_REAL, WT_PREFIX)}`));
}

/** A copy of the vitest env with every event, ref, output and gate key removed. */
function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (/^(GITHUB_|SQL_GATE_|PUSH_)/.test(k)) continue;
    env[k] = v;
  }
  return env;
}

function parseOutputs(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) out[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return out;
}

/** Derive the push verdict for `sha` with the checkout's scripts, then run the scope step on it. */
function deriveThenScope(sha: string) {
  const present = spawnSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: REPO_ROOT });
  if (present.status !== 0) {
    throw new Error(
      `MISSING OBJECT: commit ${sha} is not in this clone (a shallow checkout?). The end-to-end ` +
        `proof needs full history; this is a failure, never a skip.`,
    );
  }
  const before = git(["rev-parse", `${sha}^1`]);
  const dir = mkdtempSync(join(TMP_REAL, WT_PREFIX));
  const wt = join(dir, "wt");
  try {
    git(["worktree", "add", "--detach", wt, sha]);
    // Calibration for the leftover check below: the prefix filter SEES a live worktree.
    expect(worktreesUnderPrefix(), "the leftover filter cannot see a live scratch worktree").toContain(`worktree ${wt}`);
    for (const f of ["sql-gate-subset.mjs", "classify-changed-paths.mjs"]) {
      copyFileSync(join(REPO_ROOT, "scripts", f), join(wt, "scripts", f));
    }
    const outFile = join(dir, "github-output");
    writeFileSync(outFile, "");
    const deriveEnv: Record<string, string> = {
      ...cleanEnv(),
      ...PUSH_MAIN,
      PUSH_BEFORE_SHA: before,
      PUSH_FORCED: "false",
      GITHUB_OUTPUT: outFile,
    };
    const derived = spawnSync("node", ["scripts/sql-gate-subset.mjs"], {
      cwd: wt,
      encoding: "utf8",
      env: deriveEnv as NodeJS.ProcessEnv,
    });
    expect(derived.status, `${derived.stdout}${derived.stderr}`).toBe(0);
    const outputs = parseOutputs(readFileSync(outFile, "utf8"));
    for (const key of ["sql_gate_mode", "sql_gate_files", "sql_gate_reason"]) {
      expect(Object.keys(outputs), `the derivation wrote no ${key}`).toContain(key);
    }
    const scope = runScope({
      ...PUSH_MAIN,
      SQL_GATE_MODE: outputs.sql_gate_mode,
      SQL_GATE_FILES: outputs.sql_gate_files,
      SQL_GATE_REASON: outputs.sql_gate_reason,
    });
    return { outputs, scope };
  } finally {
    spawnSync("git", ["worktree", "remove", "--force", wt], { cwd: REPO_ROOT });
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("end to end on real history: derivation output -> scope step", { timeout: 60_000 }, () => {
  it("98f04db16 (the phase trigger, planning-only, 3 changed files) derives none and skips the lane with both lines printed", () => {
    const { outputs, scope } = deriveThenScope("98f04db16");
    expect(outputs.sql_gate_mode).toBe("none");
    expect(outputs.sql_gate_files).toBe("");
    expect(scope.status, scope.out).toBe(0);
    expect(scope.output).toBe("skip_lane=true\n");
    expect(scope.stdout).toContain("scope: NONE 0 gate files — no mutation input changed\n");
    const reasonLine = scope.stdout.split("\n").find((l) => l.startsWith("scope-reason: "));
    expect(reasonLine, "no scope-reason line was printed").toBeDefined();
    expect(reasonLine).toMatch(/^scope-reason: no mutation input changed:/);
    // The measured size of that range: three planning-only files.
    expect(reasonLine).toContain("among 3 changed file(s)");
  });

  it("fd4d86cdf (one gate file changed) derives a subset and boots the lane", () => {
    const { outputs, scope } = deriveThenScope("fd4d86cdf");
    expect(outputs.sql_gate_mode).toBe("subset");
    expect(outputs.sql_gate_files).toBe("supabase/tests/test_reconcile_dropped_enqueue_sweep.sql");
    expect(scope.status, scope.out).toBe(0);
    expect(scope.output).toBe("skip_lane=false\n");
    expect(scope.stdout).not.toContain("scope: NONE");
    expect(scope.stdout).toContain("scope verdict from changed-paths: sql_gate_mode=subset; the lane boots.");
  });

  it("no scratch worktree of this test is left behind", () => {
    expect(worktreesUnderPrefix()).toEqual([]);
  });
});
