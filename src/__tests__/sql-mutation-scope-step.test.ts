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
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    const res = spawnSync("bash", [script], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", GITHUB_OUTPUT: outFile, ...env },
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
