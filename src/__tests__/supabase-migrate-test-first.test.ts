/**
 * supabase-migrate TEST-FIRST WIRING PIN — Phase 164.8 plan 05.
 *
 * ⛔ THE DEFECT THIS FILE CATCHES. `supabase-migrate.yml` is the ONLY automatic
 * applier of DDL to PROD, and Phase 164.8 puts the shared TEST database in front of
 * it: `apply-test` applies the merged migrations to TEST first, and PROD's `apply`
 * runs only if that succeeded. Every part of that arrangement is one line away from
 * being nothing at all — `apply.needs` losing `apply-test`, `apply.if` losing the
 * result clause, `apply-test` GAINING a `needs: plan` (which would make the TEST
 * apply wait on a human-approved Production job), `apply-test.if` losing its ref
 * clause (so any branch could write to a database other people's CI uses), or the
 * verdict script exiting 0 on a skip (so a TEST apply that never ran reads as fine).
 * None of those change a test that only asserts the file parses.
 *
 * ⭐ EVERY PREDICATE HERE IS WRITTEN OVER ARBITRARY TEXT AND CALIBRATED ON A MUTATED
 * COPY. `calibrate()` asserts the mutant genuinely differs, asserts the predicate
 * holds on the real file, and asserts it FLIPS on the mutant. A predicate only ever
 * applied to the passing input is not evidence — it can be satisfied by a function
 * that matches anything.
 *
 * ⭐ AND THE TWO DECIDING SCRIPTS ARE EXECUTED, NOT GREPPED. The verdict job's script
 * is EXTRACTED out of the YAML and RUN three times, with `APPLY_TEST_RESULT` set to
 * each of `success` / `skipped` / `failure`, asserting exit status and the causes it
 * names; the ref guard's script is RUN with an off-main `GITHUB_REF`. A grep pin goes
 * green the moment someone keeps the strings and guts the logic, which is the likelier
 * regression (`src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts` is the
 * precedent, and `src/__tests__/test-restore-workflow-wiring.test.ts` the sibling).
 *
 * ⚠️ THE HELPERS BELOW ARE COPIED from `src/__tests__/test-restore-workflow-wiring.test.ts`
 * rather than imported. The repo's workflow-wiring tests are deliberately
 * self-contained files: a shared helper module that only wiring tests import buys
 * nothing and couples two pins that must be able to fail independently.
 */
import { describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = process.cwd();
const WF_PATH = ".github/workflows/supabase-migrate.yml";
const CI_PATH = ".github/workflows/ci.yml";
const RESTORE_PATH = ".github/workflows/test-restore-from-baseline.yml";
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");
const WF = read(WF_PATH);
const CI = read(CI_PATH);
const RESTORE = read(RESTORE_PATH);

const GUARD_JOB = "dispatch-ref-guard";
const TEST_JOB = "apply-test";
const VERDICT_JOB = "apply-test-verdict";
const APPLY_JOB = "apply";

/**
 * The acquire / release steps, from their `- name:` line (6-space step indent) to the
 * next sibling step or comment at that indent — the SAME regex shape
 * `critical-regressions.test.ts` and `test-restore-workflow-wiring.test.ts` use, so
 * the three files cannot disagree about what "the step" is.
 */
const ACQUIRE_RE = /^ {6}- name: Acquire shared-test-db mutex\n[\s\S]*?(?=\n {6}[-#])/m;
const RELEASE_RE =
  /^ {6}- name: Release shared-test-db mutex \(best effort\)\n[\s\S]*?(?=\n {6}[-#]|\n {2}\S)/m;
/** The line the byte-identical suffix begins at. Everything before it is ours. */
const SUFFIX_ANCHOR = "          if ! command -v psql";

// ---------------------------------------------------------------------------
// Predicates. Every one takes TEXT, so each can be run against a mutant.
// ---------------------------------------------------------------------------

/** A job's block, header line included, up to the next 2-space job key. */
function jobBlock(text: string, job: string): string {
  const head = `\n  ${job}:\n`;
  const start = text.indexOf(head);
  if (start < 0) return "";
  const after = text.slice(start + head.length);
  const next = after.match(/\n {2}[A-Za-z_][\w-]*:\n/);
  return head + (next ? after.slice(0, next.index) : after);
}

/** Non-comment lines of a block. A commented-out fence is not a fence. */
function liveLines(block: string): string[] {
  return block.split("\n").filter((l) => !/^\s*#/.test(l));
}

/** How many LIVE lines of the block are exactly this (trimmed) text. */
function liveLineCount(block: string, exact: string): number {
  return liveLines(block).filter((l) => l.trim() === exact).length;
}

/**
 * The line index of a command that must be EXECUTED, not merely mentioned. Matches a
 * flow-scalar `run: <cmd>` and a `<cmd>` line inside a block scalar, by EXACT trimmed
 * equality — so a longer command line never satisfies a pin on a shorter one.
 */
function liveCommandIndex(block: string, cmd: string): number {
  const lines = block.split("\n");
  return lines.findIndex(
    (l) => !/^\s*#/.test(l) && (l.trim() === cmd || l.trim() === `run: ${cmd}`),
  );
}

/** The line index of a step's `- name:` line within the block. */
function stepIndex(block: string, name: string): number {
  return block.split("\n").findIndex((l) => l.trim() === `- name: ${name}`);
}

/** The line index of the first LIVE line whose trimmed text contains `needle`. */
function liveIndexContaining(block: string, needle: string): number {
  const lines = block.split("\n");
  return lines.findIndex((l) => !/^\s*#/.test(l) && l.includes(needle));
}

/** A step's text from its `- name:` line up to (not including) its `run:` line. */
function stepHead(text: string, name: string): string {
  const start = text.indexOf(`- name: ${name}`);
  if (start < 0) return "";
  const rest = text.slice(start);
  const m = rest.match(/\n\s*run:/);
  return m ? rest.slice(0, m.index) : "";
}

/**
 * Every shape that could turn a failure into a pass, reported BY NAME. The same list
 * `test-restore-workflow-wiring.test.ts` scans with, restated rather than imported for
 * the self-containment reason in this file's header.
 */
const SOFTENING_TOKENS = ["continue-on-error", "|| true", "exit 0", "::warning", "set +e"];

/**
 * The `apply-test:` job with the two ci.yml-copied mutex steps sliced out.
 *
 * ⚠️ THE ACQUIRE STEP IS EXCLUDED TOO, not just the release step, and that is FORCED
 * rather than convenient: this job is required to carry a BYTE-IDENTICAL copy of
 * ci.yml's acquire suffix, and that suffix legitimately contains `exit 0` (the
 * successful acquire), `|| true` (the bounded census) and `::warning` (the retried
 * session fault). Scanning it would make the two requirements contradict. Nothing
 * hides in the excluded region: the byte-identity pin below governs the suffix
 * exactly, and a separate assertion pins that OUR prefix carries no zero-status exit.
 */
function scannableTestJob(text: string): string {
  return jobBlock(text, TEST_JOB).replace(ACQUIRE_RE, "").replace(RELEASE_RE, "");
}

function softeningOffenders(text: string): string[] {
  const live = liveLines(scannableTestJob(text)).join("\n");
  return SOFTENING_TOKENS.filter((t) => live.includes(t));
}

// ---------------------------------------------------------------------------
// Calibration harness.
// ---------------------------------------------------------------------------
function calibrate(
  label: string,
  mutate: (s: string) => string,
  predicate: (s: string) => boolean,
  text: string = WF,
): void {
  const mutant = mutate(text);
  expect(
    mutant,
    `CALIBRATION ${label}: the mutation produced an identical string, so the twin proves nothing`,
  ).not.toBe(text);
  expect(predicate(text), `${label}: the predicate is FALSE on the real file`).toBe(true);
  expect(
    predicate(mutant),
    `CALIBRATION ${label}: the predicate did NOT flip on the mutant — it cannot fail, so it is not evidence`,
  ).toBe(false);
}

// ---------------------------------------------------------------------------
// Extraction of a step's shell script, for the steps this file EXECUTES.
// ---------------------------------------------------------------------------
function extractRunScript(yml: string, stepName: string): string {
  const lines = yml.split("\n");
  const start = lines.findIndex((l) => l.trim() === `- name: ${stepName}`);
  if (start === -1) {
    throw new Error(
      `${WF_PATH} has no step named "${stepName}". This file EXECUTES that step's script ` +
        `rather than grepping it, so a rename makes extraction throw instead of silently ` +
        `passing over nothing. If it was renamed, update the constant here; if it was ` +
        `deleted, say so out loud.`,
    );
  }
  const runIdx = lines.findIndex((l, i) => i > start && l.trim() === "run: |");
  if (runIdx === -1) throw new Error(`step "${stepName}" has no "run: |" body`);
  const indent = lines[runIdx].length - lines[runIdx].trimStart().length;
  const body: string[] = [];
  for (const line of lines.slice(runIdx + 1)) {
    if (line.trim() === "") {
      body.push("");
      continue;
    }
    if (line.length - line.trimStart().length <= indent) break;
    body.push(line.slice(indent + 2));
  }
  return `${body.join("\n")}\n`;
}

/** Run a shell script with an injected env, in a throwaway cwd. */
function runScript(
  script: string,
  env: Record<string, string>,
): { status: number; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "sm-test-first-"));
  try {
    const path = join(dir, "step.sh");
    writeFileSync(path, script);
    chmodSync(path, 0o755);
    const r = spawnSync("bash", [path], {
      cwd: dir,
      encoding: "utf8",
      // `...process.env` first, then the injection — the sibling wiring test's idiom.
      // The injected keys always win, and `GITHUB_REF` / `APPLY_TEST_RESULT` are not
      // set in a local vitest run, so the scenarios are decided by the injection alone.
      env: { ...process.env, ...env },
    });
    return { status: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const VERDICT_STEP = "Judge the TEST apply";
const GUARD_STEP = "Explain why nothing ran, and fail";

describe("164.8-05 — supabase-migrate.yml applies TEST first and gates PROD on it", () => {
  describe("apply-test: the job that puts a real Postgres in front of production", () => {
    it("declares environment: Test exactly once, as a LIVE line", () => {
      expect(liveLineCount(jobBlock(WF, TEST_JOB), "environment: Test")).toBe(1);
      calibrate(
        "apply-test declares environment: Test",
        (s) => s.replace("    environment: Test\n", "    # environment: Test\n"),
        (s) => liveLineCount(jobBlock(s, TEST_JOB), "environment: Test") === 1,
      );
    });

    it("has NO needs: line — it must not wait on the human-gated Production plan job", () => {
      const live = liveLines(jobBlock(WF, TEST_JOB));
      const needs = live.filter((l) => /^ {4}needs:/.test(l));
      expect(
        needs,
        "apply-test GAINED a needs: line. `plan` is bound to the Production environment, " +
          "which carries required_reviewers since 2026-09-08, so a needs: plan here would " +
          "make the TEST apply wait for a human approval of a PROD job — inverting the whole " +
          "point of the phase, which is that the reviewer sees apply-test GREEN before " +
          "approving PROD.",
      ).toEqual([]);
      calibrate(
        "apply-test carries no needs:",
        (s) => s.replace("  apply-test:\n    if:", "  apply-test:\n    needs: plan\n    if:"),
        (s) => liveLines(jobBlock(s, TEST_JOB)).filter((l) => /^ {4}needs:/.test(l)).length === 0,
      );
    });

    it("declares timeout-minutes: 90 as a LIVE line (runbook section 2: sleep 6000s > TTL)", () => {
      expect(liveLineCount(jobBlock(WF, TEST_JOB), "timeout-minutes: 90")).toBe(1);
      calibrate(
        "apply-test timeout-minutes: 90",
        (s) =>
          s.replace(
            "    environment: Test\n    timeout-minutes: 90\n",
            "    environment: Test\n    timeout-minutes: 120\n",
          ),
        (s) => liveLineCount(jobBlock(s, TEST_JOB), "timeout-minutes: 90") === 1,
      );
    });
  });

  describe("B3 — no ref but main may reach shared TEST through this workflow", () => {
    const TEST_IF = "if: github.event_name != 'workflow_dispatch' || github.ref == 'refs/heads/main'";
    const GUARD_IF = "if: github.event_name == 'workflow_dispatch' && github.ref != 'refs/heads/main'";

    it("apply-test carries the ref-guard if:, line-exact", () => {
      expect(liveLineCount(jobBlock(WF, TEST_JOB), TEST_IF)).toBe(1);
      calibrate(
        "apply-test if: keeps the || ref clause",
        (s) => s.replace(TEST_IF, "if: github.event_name != 'workflow_dispatch'"),
        (s) => liveLineCount(jobBlock(s, TEST_JOB), TEST_IF) === 1,
      );
      calibrate(
        "apply-test if: is present at all",
        (s) => s.replace(`    ${TEST_IF}\n`, ""),
        (s) => liveLineCount(jobBlock(s, TEST_JOB), TEST_IF) === 1,
      );
    });

    it("dispatch-ref-guard carries the exact inverse if:, line-exact", () => {
      expect(liveLineCount(jobBlock(WF, GUARD_JOB), GUARD_IF)).toBe(1);
      calibrate(
        "dispatch-ref-guard if: is line-exact",
        (s) => s.replace(GUARD_IF, "if: github.ref != 'refs/heads/main'"),
        (s) => liveLineCount(jobBlock(s, GUARD_JOB), GUARD_IF) === 1,
      );
    });

    it("the two if: lines are each other's negation on BOTH predicates", () => {
      // Asserted as four literals rather than by re-parsing the expression: the
      // property that matters is that no event can run both jobs and no dispatch can
      // run neither, and that is exactly "the operators are inverted on both terms".
      expect(GUARD_IF).toContain("github.event_name == 'workflow_dispatch'");
      expect(TEST_IF).toContain("github.event_name != 'workflow_dispatch'");
      expect(GUARD_IF).toContain("github.ref != 'refs/heads/main'");
      expect(TEST_IF).toContain("github.ref == 'refs/heads/main'");
      expect(GUARD_IF).toContain(" && ");
      expect(TEST_IF).toContain(" || ");
    });

    it("EXECUTED: the guard script exits 1 off main, naming the ref and the right dispatch", () => {
      const script = extractRunScript(WF, GUARD_STEP);
      const r = runScript(script, { GITHUB_REF: "refs/heads/feature-x" });
      expect(
        r.status,
        `the ref guard exited ${r.status} on an off-main ref; it must exit 1. A green guard ` +
          `teaches the operator that a dispatch which applied NOTHING to TEST worked.\n${r.out}`,
      ).toBe(1);
      expect(r.out, "the guard did not name the offending ref").toContain("refs/heads/feature-x");
      expect(r.out, "the guard did not print the correct dispatch").toContain(
        "gh workflow run supabase-migrate.yml --ref main",
      );
      expect(r.out, "the guard's refusal is not an ::error:: annotation").toContain("::error::");
      // Calibration: the same script with its exit removed must stop failing, so the
      // assertion above is measuring the exit status and not the mere presence of text.
      const defanged = script.replace(/\nexit 1(?=\s*$)/, "\n:");
      expect(defanged, "CALIBRATION: the trailing `exit 1` was not found to remove").not.toBe(
        script,
      );
      expect(
        runScript(defanged, { GITHUB_REF: "refs/heads/feature-x" }).status,
        "CALIBRATION: the guard still exited non-zero without its `exit 1` — the pin is not " +
          "measuring the exit status",
      ).toBe(0);
    });
  });

  describe("apply-test: fail-loud credential, no softening, and the CLI commands in order", () => {
    it("the credential assert has NO if:, exits 1, and names TEST_SUPABASE_DB_URL", () => {
      const head = stepHead(jobBlock(WF, TEST_JOB), "Assert TEST credential is configured");
      expect(head, "the credential assert step is gone").not.toBe("");
      expect(
        /\n\s*if:/.test(head),
        "the credential assert GAINED an if:. It must run on EVERY event: the PROD apply is " +
          "gated on this job's result, so a green TEST apply that applied nothing because the " +
          "secret was absent would let PROD proceed on the strength of a stage nothing crossed.",
      ).toBe(false);
      const body = jobBlock(WF, TEST_JOB);
      const start = body.indexOf("- name: Assert TEST credential is configured");
      const step = body.slice(start, body.indexOf("- name:", start + 10));
      expect(step).toContain("exit 1");
      expect(step).toContain("::error::");
      expect(step).toContain("TEST_SUPABASE_DB_URL");
      calibrate(
        "the credential assert carries no if:",
        (s) =>
          s.replace(
            "      - name: Assert TEST credential is configured\n",
            "      - name: Assert TEST credential is configured\n        if: github.event_name == 'push'\n",
          ),
        (s) =>
          !/\n\s*if:/.test(
            stepHead(jobBlock(s, TEST_JOB), "Assert TEST credential is configured"),
          ),
      );
    });

    it("carries none of the softening tokens outside the two ci.yml-copied mutex steps", () => {
      expect(
        softeningOffenders(WF),
        "apply-test gained a softening token. This job is the ONLY thing standing between a " +
          "merge and a PROD apply; a tolerated failure here is a PROD apply on the strength of " +
          "a stage that reported success having proven nothing.",
      ).toEqual([]);
      for (const token of SOFTENING_TOKENS) {
        calibrate(
          `softening scan bites on ${token}`,
          (s) =>
            s.replace(
              '          supabase db push --include-all --db-url "${dsn}"\n',
              `          supabase db push --include-all --db-url "\${dsn}"  # ${token}\n`.replace(
                "  # ",
                "\n          : ",
              ),
            ),
          (t) => softeningOffenders(t).length === 0,
        );
      }
    });

    it("the three CLI commands are LIVE run: lines, in order, after the marker and the mutex", () => {
      const block = jobBlock(WF, TEST_JOB);
      const dry = liveCommandIndex(block, 'supabase db push --include-all --dry-run --db-url "${dsn}"');
      const push = liveCommandIndex(block, 'supabase db push --include-all --db-url "${dsn}"');
      const list = liveCommandIndex(
        block,
        'supabase migration list --db-url "${dsn}" | tee "${RUNNER_TEMP}/test-migration-list.txt"',
      );
      const marker = liveIndexContaining(block, "shobj_description");
      const acquire = stepIndex(block, "Acquire shared-test-db mutex");

      for (const [label, idx] of [
        ["the TEST dry-run", dry],
        ["the TEST push", push],
        ["the post-apply migration list", list],
        ["the database identity marker query", marker],
        ["the mutex acquire step", acquire],
      ] as const) {
        expect(idx, `${label} is not a LIVE line in apply-test`).toBeGreaterThanOrEqual(0);
      }
      expect(acquire, "the mutex is acquired AFTER the marker check — the marker query would then run unserialized").toBeLessThan(marker);
      expect(marker, "the dry-run runs BEFORE the database identity check — it would read a database this job has not identified").toBeLessThan(dry);
      expect(dry, "the push runs BEFORE its own dry-run, so the logged plan is not what the apply ran").toBeLessThan(push);
      expect(push, "the C-0331 migration list runs BEFORE the push it is supposed to verify").toBeLessThan(list);

      calibrate(
        "the marker-before-dry-run ordering pin bites",
        (s) =>
          s.replace(
            '          supabase db push --include-all --dry-run --db-url "${dsn}"\n',
            "",
          ),
        (t) =>
          liveCommandIndex(
            jobBlock(t, TEST_JOB),
            'supabase db push --include-all --dry-run --db-url "${dsn}"',
          ) > liveIndexContaining(jobBlock(t, TEST_JOB), "shobj_description"),
      );
      calibrate(
        "the reverted-grep survives",
        (s) =>
          s.replace(
            `          if grep -Eiq '(^|[[:space:]|])reverted([[:space:]|]|$)' "\${RUNNER_TEMP}/test-migration-list.txt"; then\n`,
            `          if false; then\n`,
          ),
        (t) => jobBlock(t, TEST_JOB).includes("])reverted(["),
      );
    });
  });

  describe("the PROD apply is gated on the TEST apply, on BOTH the failure and the skip path", () => {
    it("apply needs [plan, apply-test] and requires apply-test success", () => {
      const block = jobBlock(WF, APPLY_JOB);
      expect(liveLineCount(block, "needs: [plan, apply-test]")).toBe(1);
      const ifLine = liveLines(block).find((l) => /^ {4}if:/.test(l))?.trim() ?? "";
      expect(
        ifLine,
        "apply's if: no longer requires apply-test to have SUCCEEDED. `needs:` alone blocks " +
          "on FAILURE but NOT on a SKIP, and a skipped apply-test is exactly the state a " +
          "wrong-ref dispatch or an edited if: produces.",
      ).toContain("needs.apply-test.result == 'success'");
      expect(
        ifLine,
        "apply's if: lost the pre-existing plan.outputs.configured clause",
      ).toContain("needs.plan.outputs.configured == 'true'");

      calibrate(
        "apply.needs includes apply-test",
        (s) => s.replace("    needs: [plan, apply-test]\n", "    needs: plan\n"),
        (t) => liveLineCount(jobBlock(t, APPLY_JOB), "needs: [plan, apply-test]") === 1,
      );
      calibrate(
        "apply.if requires apply-test success",
        (s) =>
          s.replace(
            "    if: needs.plan.outputs.configured == 'true' && needs.apply-test.result == 'success'\n",
            "    if: needs.plan.outputs.configured == 'true'\n",
          ),
        (t) =>
          (liveLines(jobBlock(t, APPLY_JOB))
            .find((l) => /^ {4}if:/.test(l))
            ?.includes("needs.apply-test.result == 'success'") ??
            false),
      );
    });

    it("apply-test-verdict is if: always() and needs exactly apply-test", () => {
      const block = jobBlock(WF, VERDICT_JOB);
      expect(liveLineCount(block, "if: always()")).toBe(1);
      expect(liveLineCount(block, "needs: [apply-test]")).toBe(1);
      calibrate(
        "the verdict job is if: always()",
        (s) =>
          s.replace(
            "  apply-test-verdict:\n    needs: [apply-test]\n    if: always()\n",
            "  apply-test-verdict:\n    needs: [apply-test]\n",
          ),
        (t) => liveLineCount(jobBlock(t, VERDICT_JOB), "if: always()") === 1,
      );
    });

    it("EXECUTED: the verdict script exits 0 / 1 / 1 on success / skipped / failure", () => {
      const script = extractRunScript(WF, VERDICT_STEP);

      const ok = runScript(script, { APPLY_TEST_RESULT: "success" });
      expect(
        ok.status,
        `the verdict exited ${ok.status} on a SUCCEEDED apply-test; it must be 0.\n${ok.out}`,
      ).toBe(0);
      expect(ok.out).toContain("apply-test=success");

      const skipped = runScript(script, { APPLY_TEST_RESULT: "skipped" });
      expect(
        skipped.status,
        `the verdict exited ${skipped.status} on a SKIPPED apply-test; it must be 1. A skip ` +
          `means NOTHING crossed TEST, and the PROD apply is blocked — that must be a RED check ` +
          `with a cause, not a grey job.\n${skipped.out}`,
      ).toBe(1);
      for (const n of ["(1)", "(2)", "(3)"]) {
        expect(skipped.out, `the skipped verdict does not name cause ${n}`).toContain(n);
      }
      expect(
        skipped.out.slice(skipped.out.indexOf("(1)"), skipped.out.indexOf("(2)")),
        "cause (1) of a SKIP must name main — an off-main dispatch is the cheapest and " +
          "likeliest cause, and the guard job has already printed the remedy",
      ).toContain("main");

      const failed = runScript(script, { APPLY_TEST_RESULT: "failure" });
      expect(
        failed.status,
        `the verdict exited ${failed.status} on a FAILED apply-test; it must be 1.\n${failed.out}`,
      ).toBe(1);
      for (const n of ["(1)", "(2)", "(3)"]) {
        expect(failed.out, `the failure verdict does not name cause ${n}`).toContain(n);
      }
      expect(
        failed.out.slice(failed.out.indexOf("(3)")),
        "cause (3) of a FAILURE must name [164.8-DATA-DEPENDENT-MIGRATION-ESCAPE] — the open " +
          "case whose interim remedy is to revert the merge, NEVER to edit this workflow",
      ).toContain("164.8-DATA-DEPENDENT-MIGRATION-ESCAPE");

      // Calibration: a verdict whose skip branch exits zero-status must stop passing.
      const defanged = script.replace(
        /(\s+echo "::error:: {2}\(3\) the workflow run was cancelled[^\n]*\n)(\s+)exit 1\n/,
        "$1$2:\n",
      );
      expect(
        defanged,
        "CALIBRATION: the skipped branch's `exit 1` was not found to neuter",
      ).not.toBe(script);
      expect(
        runScript(defanged, { APPLY_TEST_RESULT: "skipped" }).status,
        "CALIBRATION: the verdict still exited non-zero on a skip with its `exit 1` removed — " +
          "the pin is not measuring the exit status",
      ).toBe(0);
    });
  });

  describe("cross-file: the mutex protocol is ci.yml's, byte for byte, in all THREE workflows", () => {
    const suffix = (s: string): string => s.slice(s.indexOf(SUFFIX_ANCHOR));

    it("the acquire suffix is identical across ci.yml, the restore workflow and this one", () => {
      const ciStep = CI.match(ACQUIRE_RE)?.[0] ?? "";
      const restoreStep = RESTORE.match(ACQUIRE_RE)?.[0] ?? "";
      const wfStep = WF.match(ACQUIRE_RE)?.[0] ?? "";
      expect(ciStep, "ci.yml's Acquire step could not be extracted").not.toBe("");
      expect(restoreStep, `${RESTORE_PATH}'s Acquire step could not be extracted`).not.toBe("");
      expect(wfStep, `${WF_PATH}'s Acquire step could not be extracted`).not.toBe("");

      const msg =
        "the copied mutex protocol has DRIFTED from ci.yml's. Every invariant in that step " +
        "(session-mode DSN, libpq keepalives, statement_timeout=0, " +
        "client_connection_check_interval, the 3600s cap, the two-cause error) was reasoned " +
        "about once and is applied everywhere; a one-site drift means this workflow contends " +
        "for the SAME advisory key under a DIFFERENT protocol than the jobs it shares it with. " +
        "Re-sync the copy — do not edit it here.";
      expect(suffix(restoreStep), msg).toBe(suffix(ciStep));
      expect(suffix(wfStep), msg).toBe(suffix(ciStep));

      const prefix = wfStep.slice(0, wfStep.indexOf(SUFFIX_ANCHOR));
      expect(
        prefix.includes("exit 0"),
        "the fork-PR early exit SURVIVED in the credential branch. ci.yml's copy may exit 0 " +
          "there because a fork PR legitimately has no secret; this workflow has no " +
          "pull_request trigger, so an absent credential is a FAULT — and exiting 0 would hand " +
          "the PROD gate a green from a job that locked nothing and applied nothing.",
      ).toBe(false);
      expect(
        prefix.includes("exit 1"),
        "the credential branch of the acquire step no longer exits 1",
      ).toBe(true);

      calibrate(
        "the acquire byte-identity pin bites on a one-token drift",
        (s) =>
          s.replace("SELECT pg_advisory_lock(61616158);", "SELECT pg_advisory_lock(61616159);"),
        (t) => {
          const w = t.match(ACQUIRE_RE)?.[0] ?? "";
          return w !== "" && suffix(w) === suffix(ciStep);
        },
      );
    });

    it("the release step is byte-identical to ci.yml's, if: always() included", () => {
      const ciStep = CI.match(RELEASE_RE)?.[0] ?? "";
      const wfStep = WF.match(RELEASE_RE)?.[0] ?? "";
      expect(ciStep).not.toBe("");
      expect(
        wfStep,
        "the release step drifted from ci.yml's. It is the one step in apply-test allowed to " +
          "end zero-status; that licence is ci.yml's reasoning, and it only transfers while " +
          "the copy is exact.",
      ).toBe(ciStep);
      expect(RESTORE.match(RELEASE_RE)?.[0] ?? "", "the restore workflow's release drifted").toBe(
        ciStep,
      );
      calibrate(
        "the release byte-identity pin bites",
        (s) =>
          s.replace(
            "      - name: Release shared-test-db mutex (best effort)\n        if: always()\n",
            "      - name: Release shared-test-db mutex (best effort)\n",
          ),
        (t) => (t.match(RELEASE_RE)?.[0] ?? "") === ciStep,
      );
    });
  });

  describe("the PROD apply step was not touched by this phase", () => {
    /**
     * The literal body of `Push migrations to production` as it stood at HEAD before
     * Phase 164.8 plan 05 (supabase-migrate.yml lines 241-251 of that revision). This
     * plan changed the `apply` job's `needs:`/`if:` lines and NOTHING ELSE; pinning the
     * push step's bytes is what proves it. A change here is not necessarily wrong — but
     * it must be a deliberate edit to THIS constant, not a side effect of editing the
     * job around it.
     */
    const PROD_PUSH_BODY = [
      "        run: |",
      "          set -euo pipefail",
      '          supabase link --project-ref "$SUPABASE_PROJECT_REF"',
      "          supabase db push --include-all",
      '          echo "::group::Post-apply migration list verification (C-0331)"',
      "          supabase migration list --linked | tee /tmp/migration-list.txt",
      "          if grep -Eiq '(^|[[:space:]|])reverted([[:space:]|]|$)' /tmp/migration-list.txt; then",
      '            echo "::error::Reverted migrations detected after db push — see list above (C-0331)"',
      "            exit 1",
      "          fi",
      '          echo "::endgroup::"',
    ].join("\n");

    it("the Push migrations to production body is byte-identical to its pre-164.8-05 form", () => {
      expect(
        WF.includes(PROD_PUSH_BODY),
        "the PROD `Push migrations to production` step body CHANGED. Phase 164.8 plan 05 put " +
          "a TEST apply in FRONT of this step and changed the apply job's needs:/if: lines " +
          "only. The one automatic applier of DDL to production is not something to edit as a " +
          "side effect.",
      ).toBe(true);
      calibrate(
        "the PROD push body pin bites",
        (s) => s.replace("          supabase db push --include-all\n", "          supabase db push\n"),
        (t) => t.includes(PROD_PUSH_BODY),
      );
    });
  });
});
