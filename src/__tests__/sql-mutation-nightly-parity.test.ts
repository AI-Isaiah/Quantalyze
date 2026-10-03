/**
 * The nightly full-corpus mutation run cannot drift from `sql-mutation`
 * (Phase 164.9.6, plan 05; decisions D-05 / D-07).
 *
 * WHY THIS FILE EXISTS. Since Phase 164.9.6 a push to `main` mutates a derived
 * subset of the SQL gate corpus, or nothing. The floors in
 * scripts/mutation-floors.mjs are compared against a real biting count only by a
 * FULL run, and the scheduled FULL run lives in its own workflow,
 * `.github/workflows/sql-mutation-nightly.yml`. Its steps are COPIES of ci.yml's
 * `sql-mutation` steps, not a shared reusable workflow, because other vitest
 * files slice and execute ci.yml's job text. A copy can drift: edit the assert
 * step in ci.yml and forget the nightly, and the nightly keeps enforcing last
 * month's rules while reading as the floor's enforcer. That is the failure this
 * pin exists to catch (T-164.9.6-20).
 *
 * So every copied `run:` block must be BYTE-EQUAL to the same-named step in
 * ci.yml, every ci.yml lane step must exist in the nightly, and the nightly may
 * add only the steps this file allow-lists. The mutate step is the one
 * deliberate difference: it carries only the FULL tail of ci.yml's mutate block
 * (no subset branch, no `--subset-from`), because the nightly always runs the
 * whole corpus.
 *
 * Every predicate below is a function over ARBITRARY workflow text, and the
 * calibration copies run through the SAME function, so a predicate that cannot
 * fail is caught by its own calibration.
 *
 * Text-only on purpose: no child process, no environment read.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CI_TEXT = readFileSync(join(REPO_ROOT, ".github", "workflows", "ci.yml"), "utf8");
const NIGHTLY_FILE = "sql-mutation-nightly.yml";
const NIGHTLY_TEXT = readFileSync(join(REPO_ROOT, ".github", "workflows", NIGHTLY_FILE), "utf8");

const CI_JOB = "sql-mutation";
const NIGHTLY_JOB = "sql-mutation-full";

/** The D-09 scope step: ci.yml only. The nightly has no derivation to scope by. */
const SCOPE_STEP_NAME =
  "Scope - print what this run covers and why; a push to main that changed no mutation input skips the lane (D-09)";
const MUTATE_STEP_NAME = "Mutate every annotated RED-UNDER arm and require it to bite";
const ASSERT_STEP_NAME = "Assert the run PRINTED its coverage and cleared both floors";
const DBLINK_STEP_NAME = "Probe - dblink contrib is present for the lane's PostgreSQL (Phase 164.5.2)";
const FULL_TAIL_FIRST_LINE = 'node scripts/mutation-runner/run.mjs > "$RUNNER_LOG" 2>&1';

/**
 * The nightly's own steps, which have no ci.yml counterpart. Exactly this set:
 * an unlisted extra step is red, and a listed step that went missing is red.
 */
const ALWAYS_STEPS = ["Print the nightly wall time", "Capture the reading", "Upload the reading"];
const NIGHTLY_ONLY_STEPS = ["Record the nightly start time", ...ALWAYS_STEPS];

const REPORT_JOB = "report";
const REPORT_IF = "always() && needs.sql-mutation-full.result != 'success'";
const DEDUP_LABEL = "nightly-canary-failure:sql-mutation";

const CHECKOUT = "actions/checkout@";
const SETUP_NODE = "actions/setup-node@";

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

/** Replace exactly the first occurrence of `from` at or after `start`; a miss throws by name. */
function replaceOnce(text: string, from: string, to: string, start = 0): string {
  const at = anchorIndex(text, from, start);
  return text.slice(0, at) + to + text.slice(at + from.length);
}

/** A job's text, from its two-space key to the next two-space key (or the end of the file). */
function jobSlice(text: string, key: string): string {
  const start = anchorIndex(text, `\n  ${key}:\n`);
  const next = /\n {2}[A-Za-z0-9_-]+:\n/g;
  next.lastIndex = start + 1;
  const m = next.exec(text);
  return text.slice(start, m ? m.index : text.length);
}

interface Step {
  /** `name:` value, or `uses:<action>@` for an unnamed action step. */
  key: string;
  name: string | null;
  uses: string | null;
  ifExpr: string | null;
  timeout: string | null;
  /** The `run:` text: a single-line value, or the `run: |` block dedented by ten spaces. */
  run: string | null;
  text: string;
}

/** Split a job's `steps:` into steps at the six-space `- `, and read each step's keys. */
function parseSteps(job: string): Step[] {
  const lines = job.split("\n");
  const starts: number[] = [];
  lines.forEach((l, i) => {
    if (l.startsWith("      - ")) starts.push(i);
  });
  return starts.map((s, n) => {
    const end = n + 1 < starts.length ? starts[n + 1] : lines.length;
    const own = lines.slice(s, end);
    const field = (re: RegExp): string | null => {
      for (const l of own) {
        const m = re.exec(l);
        if (m) return m[1].trim();
      }
      return null;
    };
    const name = field(/^ {6}- name: (.*)$/) ?? field(/^ {8}name: (.*)$/);
    const uses = field(/^ {6}- uses: (\S+)/) ?? field(/^ {8}uses: (\S+)/);
    let run: string | null = null;
    const runAt = own.findIndex((l) => /^ {8}run:/.test(l));
    if (runAt >= 0) {
      if (own[runAt] === "        run: |") {
        const body: string[] = [];
        for (let i = runAt + 1; i < own.length; i++) {
          const l = own[i];
          if (l.trim() !== "" && !l.startsWith("          ")) break;
          body.push(l.slice(10));
        }
        while (body.length && body[body.length - 1].trim() === "") body.pop();
        run = body.join("\n");
      } else {
        run = own[runAt].replace(/^ {8}run: /, "");
      }
    }
    const usesKey = uses ? `uses:${uses.slice(0, uses.indexOf("@") + 1)}` : null;
    return {
      key: name ?? usesKey ?? `unparsed step ${n}`,
      name,
      uses,
      ifExpr: field(/^ {8}if: (.*)$/),
      timeout: field(/^ {8}timeout-minutes: (\d+)/),
      run,
      text: own.join("\n"),
    };
  });
}

function stepByKey(steps: Step[], key: string): Step | undefined {
  return steps.find((s) => s.key === key);
}

/** The FULL tail of ci.yml's mutate block: from the bare runner invocation to the end. */
function fullTail(mutateRun: string): string {
  return mutateRun.slice(anchorIndex(mutateRun, FULL_TAIL_FIRST_LINE));
}

/**
 * Every parity defect between ci.yml's `sql-mutation` job and the nightly's
 * `sql-mutation-full` job, each naming the step. Empty means in step.
 */
function parityViolations(ciText: string, nightlyText: string): string[] {
  const out: string[] = [];
  const ci = parseSteps(jobSlice(ciText, CI_JOB));
  const nightly = parseSteps(jobSlice(nightlyText, NIGHTLY_JOB));
  const ciNamed = ci.filter((s) => s.name !== null && s.name !== SCOPE_STEP_NAME);
  if (ciNamed.length < 8) out.push(`ci.yml ${CI_JOB}: only ${ciNamed.length} named steps parsed; the parser is wrong`);

  for (const c of ciNamed) {
    const n = stepByKey(nightly, c.key);
    if (!n) {
      out.push(`step "${c.key}": present in ci.yml ${CI_JOB}, MISSING from the nightly`);
      continue;
    }
    if (c.run === null) {
      out.push(`step "${c.key}": ci.yml carries no run:, so there is nothing to pin`);
      continue;
    }
    if (c.key === MUTATE_STEP_NAME) {
      const want = `set -uo pipefail\n${fullTail(c.run)}`;
      if (n.run !== want) out.push(`step "${c.key}": run: is not "set -uo pipefail" plus ci.yml's FULL tail, byte for byte`);
      if ((n.run ?? "").includes("--subset-from")) out.push(`step "${c.key}": the nightly mutate block carries --subset-from; it must run FULL only`);
    } else if (n.run !== c.run) {
      out.push(`step "${c.key}": run: differs from ci.yml ${CI_JOB}'s step of the same name`);
    }
  }

  for (const action of [CHECKOUT, SETUP_NODE]) {
    const c = stepByKey(ci, `uses:${action}`);
    const n = stepByKey(nightly, `uses:${action}`);
    if (!c) out.push(`ci.yml ${CI_JOB} has no ${action} step; the parser is wrong`);
    else if (!n) out.push(`the nightly has no ${action} step`);
    else if (n.uses !== c.uses) out.push(`${action} pin differs: ci.yml ${c.uses}, nightly ${n.uses}`);
  }
  const checkout = stepByKey(nightly, `uses:${CHECKOUT}`);
  if (checkout && !/^ {10}persist-credentials: false$/m.test(checkout.text)) {
    out.push(`the nightly's ${CHECKOUT} step does not set persist-credentials: false`);
  }

  const ciKeys = new Set(ci.map((s) => s.key));
  for (const n of nightly) {
    if (ciKeys.has(n.key)) continue;
    if (!NIGHTLY_ONLY_STEPS.includes(n.key)) out.push(`step "${n.key}": in the nightly, not in ci.yml, and not allow-listed`);
  }
  for (const extra of NIGHTLY_ONLY_STEPS) {
    if (!stepByKey(nightly, extra)) out.push(`allow-listed nightly step "${extra}" is missing`);
  }
  return out;
}

/** Timeout defects: the nightly's own 45/40, and ci.yml's untouched 20. */
function timeoutViolations(ciText: string, nightlyText: string): string[] {
  const out: string[] = [];
  const ciJob = jobSlice(ciText, CI_JOB);
  const nJob = jobSlice(nightlyText, NIGHTLY_JOB);
  if (!/^ {4}timeout-minutes: 20$/m.test(ciJob)) out.push(`ci.yml ${CI_JOB} job timeout-minutes is not 20 (a declared CEILING, never raised)`);
  if (!/^ {4}timeout-minutes: 45$/m.test(nJob)) out.push(`nightly ${NIGHTLY_JOB} job timeout-minutes is not 45`);
  const mutate = stepByKey(parseSteps(nJob), MUTATE_STEP_NAME);
  if (!mutate) out.push(`nightly has no "${MUTATE_STEP_NAME}" step`);
  else if (mutate.timeout !== "40") out.push(`nightly mutate step timeout-minutes is ${mutate.timeout ?? "absent"}, not 40`);
  return out;
}

/** The top-level `on:` keys of a workflow, read at two-space indent. */
function triggerKeys(text: string): string[] {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => l === "on:");
  if (at < 0) throw new Error("ANCHOR MISSING: no block-form top-level `on:` line");
  const keys: string[] = [];
  for (let i = at + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() !== "" && !l.startsWith(" ")) break;
    const m = /^ {2}([A-Za-z_]+):/.exec(l);
    if (m) keys.push(m[1]);
  }
  return keys;
}

/** Job-shape and content defects of the nightly that are not step parity. */
function shapeViolations(nightlyText: string): string[] {
  const out: string[] = [];
  const keys = triggerKeys(nightlyText).sort();
  if (keys.join(",") !== "schedule,workflow_dispatch") out.push(`on: holds [${keys.join(", ")}], not exactly schedule + workflow_dispatch`);
  if (!nightlyText.includes('    - cron: "0 3 * * *"')) out.push('the schedule is not cron "0 3 * * *"');
  if (nightlyText.includes("61616158")) out.push("the nightly names the shared-TEST advisory key");
  if (nightlyText.includes("secrets.")) out.push("the nightly references a secret");
  const job = jobSlice(nightlyText, NIGHTLY_JOB);
  if (/^ {4}needs:/m.test(job)) out.push(`${NIGHTLY_JOB} has a job-level needs:`);
  if (/^ {4}if:/m.test(job)) out.push(`${NIGHTLY_JOB} has a job-level if:`);
  // Expression and env-key level only: the copied assert body names
  // `needs.changed-paths.outputs.sql_gate_files` inside an error message.
  if (/\$\{\{\s*needs\./.test(job) || /^ {10}SQL_GATE_(MODE|FILES):/m.test(job)) {
    out.push(`${NIGHTLY_JOB} reads a changed-paths derivation; the nightly has none`);
  }
  const steps = parseSteps(job);
  for (const s of steps) {
    if (NIGHTLY_ONLY_STEPS.includes(s.key)) continue;
    if (s.ifExpr !== null) out.push(`copied step "${s.key}" carries if: ${s.ifExpr}; the nightly runs every lane step`);
  }
  const mutate = stepByKey(steps, MUTATE_STEP_NAME);
  if (
    !mutate ||
    !mutate.text.includes(
      '          SQL_GATE_REASON: "nightly full corpus (${{ github.event_name }} event, sql-mutation-nightly.yml)',
    )
  ) {
    out.push("the mutate step does not set SQL_GATE_REASON naming the nightly and its event (D-12)");
  }
  return out;
}

/**
 * D-06 / D-11 reporter defects: the `report` job's trigger and scope, the
 * single write permission, the dedupe label, the Railway sentence, and the
 * `always()` steps that feed it.
 */
function reportViolations(nightlyText: string): string[] {
  const out: string[] = [];
  const report = jobSlice(nightlyText, REPORT_JOB);
  const job = jobSlice(nightlyText, NIGHTLY_JOB);
  if (!/^ {4}needs: \[sql-mutation-full\]$/m.test(report)) out.push("report: needs: is not [sql-mutation-full]");
  const ifLine = /^ {4}if: (.*)$/m.exec(report);
  if (!ifLine || ifLine[1] !== REPORT_IF) out.push(`report: if: is ${ifLine ? ifLine[1] : "absent"}, not ${REPORT_IF}`);
  if (!/^ {4}permissions:\n {6}contents: read\n {6}issues: write\n/m.test(report)) {
    out.push("report: job-level permissions: is not exactly contents: read + issues: write");
  }
  const writes = nightlyText.match(/issues: write/g) ?? [];
  if (writes.length !== 1 || !report.includes("issues: write")) {
    out.push(`issues: write appears ${writes.length} time(s); it must appear once, in the report job only`);
  }
  if (/^ {4}permissions:/m.test(job)) out.push(`${NIGHTLY_JOB} carries a job-level permissions: block`);
  if (!report.includes(`const dedupLabel = "${DEDUP_LABEL}";`)) out.push("report: the dedupe label literal is missing");
  if (!report.includes("block a later Railway redeploy")) out.push("report: the D-11 Railway sentence is missing");
  if (/actions\/checkout@/.test(report)) out.push("report: checks out repo code; it must run only github-script over the reading");
  const steps = parseSteps(job);
  for (const name of ALWAYS_STEPS) {
    const s = stepByKey(steps, name);
    if (!s) out.push(`step "${name}" is missing`);
    else if (s.ifExpr !== "always()") out.push(`step "${name}" carries if: ${s.ifExpr ?? "none"}, not always()`);
  }
  const start = stepByKey(steps, "Record the nightly start time");
  if (start && start.ifExpr !== null) out.push(`step "Record the nightly start time" carries if: ${start.ifExpr}`);
  return out;
}

/** Remove one whole step (from its `- name:` line to the next step) by name. */
function deleteStep(text: string, name: string): string {
  const at = anchorIndex(text, `      - name: ${name}\n`);
  const next = text.indexOf("\n      - ", at + 1);
  return text.slice(0, at) + (next < 0 ? "" : text.slice(next + 1));
}

describe("sql-mutation-nightly.yml: copied steps stay byte-equal to ci.yml sql-mutation (D-05/D-07)", () => {
  it("the parser reads both jobs: every ci.yml lane step plus checkout and setup-node", () => {
    const ci = parseSteps(jobSlice(CI_TEXT, CI_JOB));
    const nightly = parseSteps(jobSlice(NIGHTLY_TEXT, NIGHTLY_JOB));
    expect(ci.map((s) => s.key)).toContain(SCOPE_STEP_NAME);
    expect(ci.map((s) => s.key)).toContain(ASSERT_STEP_NAME);
    expect(nightly.map((s) => s.key)).not.toContain(SCOPE_STEP_NAME);
    // Every copied block is non-trivial, so "equal" is not "both empty".
    for (const s of nightly) {
      if (s.name && s.uses === null) expect(s.run, s.key).toBeTruthy();
    }
    expect(stepByKey(nightly, ASSERT_STEP_NAME)?.run).toContain("scope-reason:");
  });

  it("is in step on the real files", () => {
    expect(parityViolations(CI_TEXT, NIGHTLY_TEXT)).toEqual([]);
  });

  it("timeouts: nightly job 45, its mutate step 40; ci.yml sql-mutation keeps 20", () => {
    expect(timeoutViolations(CI_TEXT, NIGHTLY_TEXT)).toEqual([]);
  });

  it("triggers, absence of the shared-TEST key and of secrets, and no derivation reads", () => {
    expect(shapeViolations(NIGHTLY_TEXT)).toEqual([]);
  });

  it("reporter: always() steps, the report job's if/needs/permissions, one write scope, label and D-11 sentence", () => {
    expect(reportViolations(NIGHTLY_TEXT)).toEqual([]);
  });

  describe("calibration: each copy through the SAME predicate goes red and names the step", () => {
    it("the report if: changed to failure(), and issues: write lent to the mutation job", () => {
      const failureOnly = replaceOnce(NIGHTLY_TEXT, `    if: ${REPORT_IF}\n`, "    if: failure()\n");
      expect(reportViolations(failureOnly)).toEqual([`report: if: is failure(), not ${REPORT_IF}`]);
      const lent = replaceOnce(
        NIGHTLY_TEXT,
        "    timeout-minutes: 45\n",
        "    timeout-minutes: 45\n    permissions:\n      contents: read\n      issues: write\n",
      );
      expect(reportViolations(lent)).toEqual([
        "issues: write appears 2 time(s); it must appear once, in the report job only",
        `${NIGHTLY_JOB} carries a job-level permissions: block`,
      ]);
      const captureAt = anchorIndex(NIGHTLY_TEXT, "      - name: Capture the reading\n");
      const ungated = replaceOnce(NIGHTLY_TEXT, "        if: always()\n", "        if: success()\n", captureAt);
      expect(reportViolations(ungated)).toEqual(['step "Capture the reading" carries if: success(), not always()']);
    });

    it("one character changed inside the copied assert block", () => {
      const assertAt = anchorIndex(NIGHTLY_TEXT, `      - name: ${ASSERT_STEP_NAME}\n`);
      const bad = replaceOnce(NIGHTLY_TEXT, "is missing or empty.", "is missing or emptY.", assertAt);
      const v = parityViolations(CI_TEXT, bad);
      expect(v).toEqual([`step "${ASSERT_STEP_NAME}": run: differs from ci.yml ${CI_JOB}'s step of the same name`]);
    });

    it("the dblink probe step deleted", () => {
      const v = parityViolations(CI_TEXT, deleteStep(NIGHTLY_TEXT, DBLINK_STEP_NAME));
      expect(v).toEqual([`step "${DBLINK_STEP_NAME}": present in ci.yml ${CI_JOB}, MISSING from the nightly`]);
    });

    it("the mutate block gains --subset-from", () => {
      const mutateAt = anchorIndex(NIGHTLY_TEXT, `      - name: ${MUTATE_STEP_NAME}\n`);
      const bad = replaceOnce(
        NIGHTLY_TEXT,
        `          ${FULL_TAIL_FIRST_LINE}`,
        '          node scripts/mutation-runner/run.mjs --subset-from "$RUNNER_TEMP/list.txt" > "$RUNNER_LOG" 2>&1',
        mutateAt,
      );
      const v = parityViolations(CI_TEXT, bad);
      expect(v).toContain(`step "${MUTATE_STEP_NAME}": the nightly mutate block carries --subset-from; it must run FULL only`);
    });

    it("an unlisted extra step, and a ci.yml timeout raised to 30", () => {
      const extra = replaceOnce(
        NIGHTLY_TEXT,
        "      - name: Record the nightly start time\n",
        "      - name: Sneaky extra\n        run: echo hi\n      - name: Record the nightly start time\n",
      );
      expect(parityViolations(CI_TEXT, extra)).toEqual([
        'step "Sneaky extra": in the nightly, not in ci.yml, and not allow-listed',
      ]);
      const ciAt = anchorIndex(CI_TEXT, `\n  ${CI_JOB}:\n`);
      const raised = replaceOnce(CI_TEXT, "\n    timeout-minutes: 20\n", "\n    timeout-minutes: 30\n", ciAt);
      expect(timeoutViolations(raised, NIGHTLY_TEXT)).toEqual([
        `ci.yml ${CI_JOB} job timeout-minutes is not 20 (a declared CEILING, never raised)`,
      ]);
    });

    it("a push trigger, a secret reference, and an if: on a copied lane step", () => {
      const pushed = replaceOnce(NIGHTLY_TEXT, "\n  workflow_dispatch:\n", "\n  workflow_dispatch:\n  push:\n");
      expect(shapeViolations(pushed)).toEqual(["on: holds [push, schedule, workflow_dispatch], not exactly schedule + workflow_dispatch"]);
      const secret = replaceOnce(
        NIGHTLY_TEXT,
        "          RUNNER_LOG: ${{ runner.temp }}/mutation-runner.log\n",
        "          RUNNER_LOG: ${{ runner.temp }}/mutation-runner.log\n          X: ${{ secrets.X }}\n",
      );
      expect(shapeViolations(secret)).toEqual(["the nightly references a secret"]);
      const derived = replaceOnce(
        NIGHTLY_TEXT,
        "          RUNNER_LOG: ${{ runner.temp }}/mutation-runner.log\n",
        "          RUNNER_LOG: ${{ runner.temp }}/mutation-runner.log\n          SQL_GATE_MODE: subset\n",
      );
      expect(shapeViolations(derived)).toEqual([`${NIGHTLY_JOB} reads a changed-paths derivation; the nightly has none`]);
      const gated = replaceOnce(
        NIGHTLY_TEXT,
        `      - name: ${DBLINK_STEP_NAME}\n`,
        `      - name: ${DBLINK_STEP_NAME}\n        if: github.event_name == 'schedule'\n`,
      );
      expect(shapeViolations(gated)).toEqual([
        `copied step "${DBLINK_STEP_NAME}" carries if: github.event_name == 'schedule'; the nightly runs every lane step`,
      ]);
    });
  });
});
