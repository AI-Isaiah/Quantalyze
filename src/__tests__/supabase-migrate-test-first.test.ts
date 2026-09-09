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
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
const DIVERGENCE_JOB = "prod-credential-divergence-verdict";
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

/**
 * The two CLI lines `apply-test` decides on. Both now TEE their output: the affirmative
 * "the push applied what the plan planned" check below is a COMPARISON, and it needs
 * both halves on disk. Written as ordinary single-quoted strings, so `${dsn}` and
 * `${RUNNER_TEMP}` are the SHELL's expansions and not TypeScript's.
 */
const DRY_RUN_CMD =
  'supabase db push --include-all --dry-run --db-url "${dsn}" | tee "${RUNNER_TEMP}/test-dry-run.txt"';
const PUSH_CMD =
  'supabase db push --include-all --db-url "${dsn}" | tee "${RUNNER_TEMP}/test-push.txt"';

/** The C-0331-twin reverted-grep condition and the echo that opens its branch. */
const REVERTED_IF =
  'if grep -Eiq \'(^|[[:space:]|])reverted([[:space:]|]|$)\' "${RUNNER_TEMP}/test-migration-list.txt"; then';
const REVERTED_ECHO =
  '            echo "::error::Reverted migrations detected after db push to TEST — see list above (C-0331 twin)"';

/**
 * Does the reverted-grep's branch still END THE JOB? A branch reduced to an `echo`
 * keeps every string a substring pin looks for and changes the ground truth into a log
 * line. Scans LIVE lines only, from the condition to its closing `fi`.
 */
function revertedBranchExits(block: string): boolean {
  const lines = liveLines(block).map((l) => l.trim());
  const start = lines.indexOf(REVERTED_IF);
  if (start < 0) return false;
  const end = lines.findIndex((l, i) => i > start && l === "fi");
  if (end < 0) return false;
  return lines.slice(start + 1, end).includes("exit 1");
}

/**
 * Replace `from` with `to` INSIDE one job's block only.
 *
 * ⚠️ A bare `text.replace(...)` rewrites the FIRST occurrence in the file, and several
 * of these lines now appear in more than one job — `needs: [plan, apply-test]` is on
 * both `apply` and the divergence verdict, and `APPLY_TEST_RESULT: ${{ ... }}` on both
 * verdicts. A mutant that lands in the wrong job leaves the pinned job untouched, and
 * `calibrate()` then reports the predicate as unable to fail. Which it did, twice.
 */
function mutateInJob(text: string, job: string, from: string, to: string): string {
  const block = jobBlock(text, job);
  if (block === "" || !block.includes(from)) return text;
  const mutated = block.replace(from, to);
  return text.replace(block, () => mutated);
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
 * Every shape that could turn a failure into a pass, reported BY NAME. A superset of
 * the list `test-restore-workflow-wiring.test.ts` scans with, restated rather than
 * imported for the self-containment reason in this file's header.
 *
 * ⚠️ THE LAST FOUR WERE ADDED because the first five were not a class, they were five
 * spellings of a class, and the ones missing were the ones that fit this workflow:
 *   - `|| :`            a drop-in for the banned `|| true`, and shorter to type.
 *   - `2>/dev/null`     the exact shape that would swallow the marker step's psql
 *                       stderr — the step whose stderr IS the evidence that the
 *                       database could not be identified.
 *   - `set +o pipefail` re-enables the "a piped CLI's exit status is discarded" bug
 *                       that `set -euo pipefail` exists here to prevent; every apply
 *                       in this job now runs through a `| tee`.
 *   - `|| exit 0`       an explicit "and if that failed, succeed anyway".
 */
const SOFTENING_TOKENS = [
  "continue-on-error",
  "|| true",
  "exit 0",
  "::warning",
  "set +e",
  "|| :",
  "2>/dev/null",
  "set +o pipefail",
  "|| exit 0",
];

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

/**
 * ⚠️ THE CORPUS IS ALL FOUR JOBS PHASE 164.8 ADDED, not `apply-test` alone.
 * `continue-on-error: true` at JOB level turns that job's conclusion into `success`,
 * and the two jobs it would be most damaging on were both outside the old corpus:
 * `apply-test-verdict`, whose ENTIRE PURPOSE is to be red, and
 * `prod-credential-divergence-verdict`, likewise. A softened verdict is worse than no
 * verdict — it reports GREEN on exactly the state it was built to name.
 *
 * The acquire/release exclusions stay scoped to `apply-test`, because it is the only
 * job that carries the byte-identical ci.yml copies whose legitimate `exit 0` /
 * `|| true` / `::warning` the exclusion exists for.
 */
const SCANNED_JOBS = [GUARD_JOB, TEST_JOB, VERDICT_JOB, DIVERGENCE_JOB] as const;

function scannableJob(text: string, job: string): string {
  return job === TEST_JOB ? scannableTestJob(text) : jobBlock(text, job);
}

function softeningOffenders(text: string): string[] {
  const offenders: string[] = [];
  for (const job of SCANNED_JOBS) {
    const block = scannableJob(text, job);
    if (block === "") {
      // An absent job scans clean, which is how a corpus quietly becomes empty.
      offenders.push(`${job}: JOB IS MISSING (renamed or deleted — the scan over it proved nothing)`);
      continue;
    }
    const live = liveLines(block).join("\n");
    for (const token of SOFTENING_TOKENS) {
      if (live.includes(token)) offenders.push(`${job}: ${token}`);
    }
  }
  return offenders;
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

/**
 * Run a shell script with an injected env, in a throwaway cwd.
 *
 * `opts.stubs` writes executables into a directory PREPENDED to PATH, so a step that
 * shells out to `psql` or `supabase` can be EXECUTED here rather than grepped. It also
 * carries a stub for `timeout`: that is GNU coreutils and is absent on macOS, and
 * without it every marker scenario would fail on a developer's laptop for a reason
 * that has nothing to do with the property under test while passing on ubuntu CI.
 *
 * `opts.unset` DELETES keys from the inherited environment — the only way to test an
 * "the secret is not configured at all" branch, which is different from "" and is the
 * state a fresh clone is actually in.
 *
 * `opts.files` writes fixture files before the run. A relative key lands in the
 * throwaway dir (which is also `RUNNER_TEMP` for these runs); an absolute key is
 * written as given, for the PROD step's hard-coded `/tmp/...` paths.
 */
function runScript(
  script: string,
  env: Record<string, string>,
  opts: {
    stubs?: Record<string, string>;
    unset?: readonly string[];
    files?: Record<string, string>;
  } = {},
): { status: number; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "sm-test-first-"));
  try {
    const binDir = join(dir, "bin");
    mkdirSync(binDir);
    for (const [name, body] of Object.entries(opts.stubs ?? {})) {
      const stub = join(binDir, name);
      writeFileSync(stub, body);
      chmodSync(stub, 0o755);
    }
    for (const [name, body] of Object.entries(opts.files ?? {})) {
      writeFileSync(name.startsWith("/") ? name : join(dir, name), body);
    }
    const path = join(dir, "step.sh");
    writeFileSync(path, script);
    chmodSync(path, 0o755);
    // `...process.env` first, then the injection — the sibling wiring test's idiom.
    // The injected keys always win, and `GITHUB_REF` / `APPLY_TEST_RESULT` are not
    // set in a local vitest run, so the scenarios are decided by the injection alone.
    const merged: Record<string, string | undefined> = { ...process.env, ...env };
    for (const key of opts.unset ?? []) delete merged[key];
    merged.PATH = `${binDir}:${process.env.PATH ?? ""}`;
    // The throwaway dir IS `RUNNER_TEMP` for these runs, so a relative `opts.files`
    // key and a `${RUNNER_TEMP}/...` path in the step resolve to the same file. Set
    // last: it is infrastructure, not a scenario knob.
    merged.RUNNER_TEMP = dir;
    const r = spawnSync("bash", [path], {
      cwd: dir,
      encoding: "utf8",
      env: merged as NodeJS.ProcessEnv,
    });
    return { status: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** `timeout <n> cmd...` → `cmd...`. See the note on `runScript`. */
const TIMEOUT_STUB = '#!/usr/bin/env bash\nshift\nexec "$@"\n';

const VERDICT_STEP = "Judge the TEST apply";
const GUARD_STEP = "Explain why nothing ran, and fail";
const CRED_STEP = "Assert TEST credential is configured";
const DERIVE_STEP = "Derive the session-mode TEST DSN (once, for every step below)";
const MARKER_STEP = "Which database am I on";
const TEST_PUSH_STEP = "Push migrations to TEST";
const PROD_PUSH_STEP = "Push migrations to production";
const DIVERGENCE_STEP = "Refuse an all-green run that left TEST ahead of PROD";
const TEST_SECRET = "TEST_SUPABASE_DB_URL";

/**
 * ⚠️ Each EXECUTED test spawns a dozen or so short-lived `bash` processes (a scenario
 * plus its calibration mutants), and vitest's 5 s default is measured against a box
 * that may be running the whole suite in parallel shards. Raised for the executing
 * tests ONLY: the text-predicate tests stay on the default, so a genuine hang there
 * still surfaces fast.
 */
const EXEC_TEST_TIMEOUT_MS = 60_000;

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

    /**
     * The job's own `if:` line, READ OUT OF THE YAML. Empty string when the job has
     * none — which fails every assertion below rather than passing vacuously.
     */
    function jobIf(text: string, job: string): string {
      return (
        liveLines(jobBlock(text, job))
          .find((l) => /^ {4}if:/.test(l))
          ?.trim() ?? ""
      );
    }

    it("the two if: lines are each other's negation on BOTH predicates", () => {
      // ⚠️ THIS BLOCK USED TO ASSERT OVER `GUARD_IF` / `TEST_IF` — the two string
      // constants declared 25 lines above. Six assertions, none of which read
      // `supabase-migrate.yml`, so the whole `it` was true for ANY content of that
      // file, including a deleted job. It was kept rather than deleted (the two `it`s
      // above do bind the constants line-exactly, so deletion would lose nothing but
      // the STATEMENT) and rewritten to read the file: the property here is not "these
      // two constants are inverses", it is "no event can run BOTH jobs and no dispatch
      // can run NEITHER", and that is a property of the workflow.
      const guardIf = jobIf(WF, GUARD_JOB);
      const testIf = jobIf(WF, TEST_JOB);
      expect(guardIf, `${GUARD_JOB} has no if: line in ${WF_PATH}`).not.toBe("");
      expect(testIf, `${TEST_JOB} has no if: line in ${WF_PATH}`).not.toBe("");

      // The extracted text must still BE the pinned constants; otherwise the four
      // inversion checks below could be satisfied by an expression nobody vetted.
      expect(guardIf).toBe(GUARD_IF);
      expect(testIf).toBe(TEST_IF);

      // Asserted as six literals over the EXTRACTED lines rather than by re-parsing
      // the expression: "the operators are inverted on both terms, and the connective
      // with them" is exactly the property, and it is checkable without an evaluator.
      expect(guardIf).toContain("github.event_name == 'workflow_dispatch'");
      expect(testIf).toContain("github.event_name != 'workflow_dispatch'");
      expect(guardIf).toContain("github.ref != 'refs/heads/main'");
      expect(testIf).toContain("github.ref == 'refs/heads/main'");
      expect(guardIf).toContain(" && ");
      expect(testIf).toContain(" || ");

      // And it is now calibrated, which the constant-only version could not be.
      calibrate(
        "the inversion check reads apply-test's if: out of the file",
        (s) => s.replace(`    ${TEST_IF}\n`, "    if: github.ref == 'refs/heads/main'\n"),
        (s) => jobIf(s, TEST_JOB).includes("github.event_name != 'workflow_dispatch'"),
      );
      calibrate(
        "the inversion check reads dispatch-ref-guard's if: out of the file",
        (s) => s.replace(`    ${GUARD_IF}\n`, "    if: github.event_name == 'workflow_dispatch'\n"),
        (s) => jobIf(s, GUARD_JOB).includes("github.ref != 'refs/heads/main'"),
      );
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
    }, EXEC_TEST_TIMEOUT_MS);
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

    /**
     * ⛔ THIS REPLACED THREE `.toContain()` PINS — `"exit 1"`, `"::error::"` and
     * `"TEST_SUPABASE_DB_URL"` — over the step's text. Replace
     * `if [ -z "${TEST_SUPABASE_DB_URL:-}" ]; then` with `if false; then` and all three
     * still passed: every string survives, and the branch is dead. This file's own
     * header says a grep pin "goes green the moment someone keeps the strings and guts
     * the logic"; the step has no external dependency at all, so grepping it was never
     * justified. It is EXECUTED here, once per state the secret can be in.
     */
    it("EXECUTED: the credential assert exits 1 when TEST_SUPABASE_DB_URL is unset or empty", () => {
      const script = extractRunScript(WF, CRED_STEP);

      const unset = runScript(script, {}, { unset: [TEST_SECRET] });
      expect(
        unset.status,
        `the credential assert exited ${unset.status} with ${TEST_SECRET} UNSET; it must ` +
          `exit 1. The PROD apply is gated on this job's result, so a green TEST apply that ` +
          `applied nothing because the credential was absent lets PROD proceed on the ` +
          `strength of a stage nothing crossed.\n${unset.out}`,
      ).toBe(1);
      expect(unset.out, "the refusal is not an ::error:: annotation").toContain("::error::");
      expect(unset.out, "the refusal does not name the missing secret").toContain(TEST_SECRET);

      const empty = runScript(script, { [TEST_SECRET]: "" });
      expect(
        empty.status,
        `the credential assert exited ${empty.status} with ${TEST_SECRET} set to the EMPTY ` +
          `STRING; it must exit 1. GitHub hands an unconfigured secret to a step as "", not ` +
          `as an absent variable, so this — not the unset case — is the shape CI produces.` +
          `\n${empty.out}`,
      ).toBe(1);
      expect(empty.out).toContain("::error::");

      const secret = "postgres://user@db.example.invalid:5432/postgres";
      const configured = runScript(script, { [TEST_SECRET]: secret });
      expect(
        configured.status,
        `the credential assert exited ${configured.status} with the credential PRESENT; it ` +
          `must exit 0, or the job can never run.\n${configured.out}`,
      ).toBe(0);
      expect(
        configured.out,
        "the credential assert PRINTED THE SECRET. This log is public.",
      ).not.toContain(secret);

      // Calibration: gut the condition, keep every string. The three `.toContain()`
      // pins this test replaced all survived exactly this mutation.
      const gutted = script.replace(`if [ -z "\${${TEST_SECRET}:-}" ]; then`, "if false; then");
      expect(
        gutted,
        "CALIBRATION: the credential assert's `if [ -z ... ]` condition was not found to gut",
      ).not.toBe(script);
      expect(
        runScript(gutted, {}, { unset: [TEST_SECRET] }).status,
        "CALIBRATION: the assert still exited non-zero with its condition replaced by " +
          "`if false` — the pin is not measuring the branch, only the strings inside it",
      ).toBe(0);
    }, EXEC_TEST_TIMEOUT_MS);

    /**
     * ⛔ THE CHECK THIS PINS REPLACED A DEAD ONE. The step used to end with
     * `if [ -z "${dsn}" ]` — unreachable by construction: `dsn` is assigned verbatim
     * from the secret, the step above hard-exits when that is empty, and the `case`
     * rewrite cannot empty a non-empty string. It READ as validation of the derived
     * DSN while asserting a property already proven, and the case that CAN occur — a
     * secret that is not a postgres URL, or one still on the transaction-mode port —
     * passed straight through. Each scenario below reaches a branch that the old check
     * could not.
     */
    it("EXECUTED: the DSN derivation rewrites to session mode and refuses a malformed secret", () => {
      const script = extractRunScript(WF, DERIVE_STEP);
      const derive = (
        url: string,
      ): { status: number; out: string; exported: string } => {
        const envFile = join(mkdtempSync(join(tmpdir(), "sm-ghenv-")), "github_env");
        writeFileSync(envFile, "");
        const r = runScript(script, { [TEST_SECRET]: url, GITHUB_ENV: envFile });
        const exported = readFileSync(envFile, "utf8");
        rmSync(envFile, { force: true });
        return { ...r, exported };
      };

      const pooler = derive("postgres://u@aws-0-eu.pooler.example.invalid:6543/postgres");
      expect(
        pooler.status,
        `the derivation refused the documented secret shape (pooler DSN on :6543/): ` +
          `exited ${pooler.status}.\n${pooler.out}`,
      ).toBe(0);
      expect(
        pooler.exported,
        "the derived DSN was not rewritten to the SESSION-mode port. A session advisory " +
          "lock does not survive between statements on the 6543 transaction-mode pooler, so " +
          "the whole job would run UNSERIALIZED against a shared database with a green mutex " +
          "step.",
      ).toContain(":5432/");
      expect(pooler.exported).toContain("TEST_DB_SESSION_URL=");
      expect(pooler.exported, "the transaction-mode port survived the rewrite").not.toContain(
        ":6543",
      );
      // ⚠️ The ONLY line allowed to carry the DSN is `::add-mask::` — that command IS
      // how the value gets registered for redaction, and Actions strips it from the
      // log. Any OTHER line carrying it is a leak, and this repo is public.
      const leaks = pooler.out
        .split("\n")
        .filter((l) => l.includes("pooler.example.invalid") && !l.startsWith("::add-mask::"));
      expect(
        leaks,
        "the derivation printed the DSN on a line other than ::add-mask::, so it reaches the " +
          "public Actions log unredacted",
      ).toEqual([]);

      // Already session-mode: unchanged, still accepted.
      expect(derive("postgres://u@db.example.invalid:5432/postgres").status).toBe(0);
      expect(derive("postgresql://u@db.example.invalid:5432/postgres").status).toBe(0);

      for (const [label, url, needle] of [
        ["not a postgres URL at all", "db.example.invalid:5432/postgres", "postgres://"],
        ["a bare hostname", "not-a-dsn", "postgres://"],
        ["still transaction-mode (no path to rewrite)", "postgres://u@h.invalid:6543", "6543"],
        ["no explicit port, so session mode is unproven", "postgres://u@h.invalid/postgres", "5432"],
      ] as const) {
        const r = derive(url);
        expect(
          r.status,
          `the derivation ACCEPTED ${label}. Every psql and every CLI call downstream would ` +
            `then connect to something other than the session-mode TEST endpoint, and the ` +
            `mutex, the marker check and the apply would all report on it.\n${r.out}`,
        ).toBe(1);
        expect(r.out, `the refusal of ${label} does not name the cause`).toContain(needle);
        expect(r.out).toContain("::error::");
      }
    }, EXEC_TEST_TIMEOUT_MS);

    it("carries none of the softening tokens, in ANY of the four jobs the phase added", () => {
      expect(
        softeningOffenders(WF),
        "a job gained a softening token. `apply-test` is the ONLY thing standing between a " +
          "merge and a PROD apply; a tolerated failure there is a PROD apply on the strength " +
          "of a stage that reported success having proven nothing. The two verdict jobs are " +
          "worse still: their entire purpose is to be RED, so a softened one reports GREEN on " +
          "exactly the state it was built to name.",
      ).toEqual([]);
      for (const token of SOFTENING_TOKENS) {
        calibrate(
          `softening scan bites on ${token} inside apply-test's own steps`,
          (s) =>
            s.replace(
              `          supabase db push --include-all --db-url "\${dsn}" | tee "\${RUNNER_TEMP}/test-push.txt"\n`,
              `          supabase db push --include-all --db-url "\${dsn}" | tee "\${RUNNER_TEMP}/test-push.txt"\n          : ${token}\n`,
            ),
          (t) => softeningOffenders(t).length === 0,
        );
      }
      // ⛔ THE CORPUS, NOT JUST THE TOKENS. The scan used to run over `apply-test`
      // ALONE, so any of the other three jobs could have gained a job-level
      // `continue-on-error: true` — which turns that job's conclusion into `success` —
      // with nothing noticing. Calibrated per job, because a scan that silently covers
      // three of four is indistinguishable from one that covers all four.
      for (const job of SCANNED_JOBS) {
        calibrate(
          `the softening scan actually covers the ${job} job`,
          (s) => s.replace(`\n  ${job}:\n`, `\n  ${job}:\n    continue-on-error: true\n`),
          (t) => softeningOffenders(t).length === 0,
        );
        calibrate(
          `the softening scan fails loud when the ${job} job is renamed away`,
          (s) => s.replace(`\n  ${job}:\n`, `\n  ${job}-renamed:\n`),
          (t) => softeningOffenders(t).length === 0,
        );
      }
    });

    it("the three CLI commands are LIVE run: lines, in order, after the marker and the mutex", () => {
      const block = jobBlock(WF, TEST_JOB);
      const dry = liveCommandIndex(block, DRY_RUN_CMD);
      const push = liveCommandIndex(block, PUSH_CMD);
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
        (s) => s.replace(`          ${DRY_RUN_CMD}\n`, ""),
        (t) =>
          liveCommandIndex(jobBlock(t, TEST_JOB), DRY_RUN_CMD) >
          liveIndexContaining(jobBlock(t, TEST_JOB), "shobj_description"),
      );
      // ⛔ THE PREDICATE HERE USED TO BE `block.includes("])reverted([")` — a bare
      // substring test over the WHOLE job block, COMMENTS INCLUDED, and the only
      // predicate in this file that did not go through `liveLines()`. Commenting the
      // `if grep -Eiq` line out satisfied it, and nothing anywhere pinned that the
      // branch still carried its `exit 1`, so it could have been reduced to an `echo`.
      // Both holes are closed: LIVE-line exact match on the condition, and the branch
      // body must exit non-zero.
      expect(liveLineCount(block, REVERTED_IF), "the C-0331-twin reverted-grep is gone or was commented out").toBe(1);
      expect(
        revertedBranchExits(block),
        "the reverted branch no longer exits 1. `supabase db push` can return exit 0 while a " +
          "migration body was silently skipped, which is the whole reason the post-apply " +
          "`migration list` is the authoritative ground truth — an echo without an exit turns " +
          "that ground truth into a log line and lets the PROD apply proceed.",
      ).toBe(true);
      calibrate(
        "the reverted-grep pin bites when the condition is commented out",
        (s) => s.replace(`          ${REVERTED_IF}\n`, `          # ${REVERTED_IF}\n          if false; then\n`),
        (t) => liveLineCount(jobBlock(t, TEST_JOB), REVERTED_IF) === 1,
      );
      calibrate(
        "the reverted-grep pin bites when its branch loses `exit 1`",
        (s) =>
          s.replace(
            `${REVERTED_ECHO}\n            exit 1\n`,
            `${REVERTED_ECHO}\n`,
          ),
        (t) => revertedBranchExits(jobBlock(t, TEST_JOB)),
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
        (s) => mutateInJob(s, APPLY_JOB, "    needs: [plan, apply-test]\n", "    needs: plan\n"),
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

    /**
     * ⛔ THE ONE LINE THAT CONNECTS THE VERDICT TO REALITY. Everything else this file
     * asserts about `apply-test-verdict` is asserted by EXECUTING its script with
     * `APPLY_TEST_RESULT` injected BY THE TEST — which proves the `case` statement and
     * proves nothing at all about where that variable comes from in CI. Replace this
     * line with a literal `success`, or point it at another job, and the verdict
     * reports GREEN on a failed or skipped TEST apply while every other assertion in
     * this file stays green.
     *
     * ⚠️ `needs.apply-test.outcome` IS NOT AN ACCEPTABLE SUBSTITUTE, and the pin is
     * line-exact for that reason. `outcome` is a STEP-context field; the `needs`
     * context exposes a job's conclusion as `result` and nothing else, so
     * `${{ needs.apply-test.outcome }}` expands to the EMPTY STRING. The empty string
     * falls into the case's `*)` arm, so the near-miss does not read green — it reddens
     * EVERY run including successful ones, and the first fix anyone reaches for under
     * that noise is to relax the `*)` arm. Both directions end at a verdict that no
     * longer measures the TEST apply.
     */
    it("the verdict's APPLY_TEST_RESULT is wired to needs.apply-test.result, line-exact", () => {
      const wiring = "APPLY_TEST_RESULT: ${{ needs.apply-test.result }}";
      expect(
        liveLineCount(jobBlock(WF, VERDICT_JOB), wiring),
        "apply-test-verdict's APPLY_TEST_RESULT is no longer bound to needs.apply-test.result — " +
          "the verdict is then judging something other than the TEST apply.",
      ).toBe(1);
      calibrate(
        "the verdict's result wiring cannot be replaced by a literal",
        (s) =>
          mutateInJob(s, VERDICT_JOB, `          ${wiring}\n`, "          APPLY_TEST_RESULT: success\n"),
        (t) => liveLineCount(jobBlock(t, VERDICT_JOB), wiring) === 1,
      );
      calibrate(
        "the verdict's result wiring cannot be pointed at another job",
        (s) =>
          mutateInJob(
            s,
            VERDICT_JOB,
            `          ${wiring}\n`,
            "          APPLY_TEST_RESULT: ${{ needs.plan.result }}\n",
          ),
        (t) => liveLineCount(jobBlock(t, VERDICT_JOB), wiring) === 1,
      );
      calibrate(
        "the verdict's result wiring cannot be swapped for .outcome",
        (s) =>
          mutateInJob(
            s,
            VERDICT_JOB,
            `          ${wiring}\n`,
            "          APPLY_TEST_RESULT: ${{ needs.apply-test.outcome }}\n",
          ),
        (t) => liveLineCount(jobBlock(t, VERDICT_JOB), wiring) === 1,
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
    }, EXEC_TEST_TIMEOUT_MS);
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

  describe("the PROD apply step's C-0331 tail was not touched by this phase", () => {
    /**
     * ⚠️ THIS CONSTANT SHRANK, AND DELIBERATELY. It used to hold the WHOLE body of
     * `Push migrations to production` as it stood before Phase 164.8 plan 05, on the
     * claim that the plan changed the `apply` job's `needs:`/`if:` lines and nothing
     * else. That claim no longer holds: the review of plan 05 found that the ONLY
     * post-push check on either environment was `grep -Eiq reverted` — a NEGATIVE
     * check, which returns 1 and reads as CLEAN when it matches nothing, so a push
     * that applied ZERO migrations was indistinguishable from one that applied the
     * merge. An affirmative check was added to BOTH applies, so the PROD body changed
     * on purpose.
     *
     * What is pinned here is the part that must NOT drift: the C-0331 tail. The new
     * affirmative block is not pinned by bytes at all — it is EXECUTED below, which is
     * strictly stronger, and a byte pin over a block that is under active review would
     * only teach the next reader to re-paste it.
     */
    const PROD_C0331_TAIL = [
      '          echo "::group::Post-apply migration list verification (C-0331)"',
      "          supabase migration list --linked | tee /tmp/migration-list.txt",
      "          if grep -Eiq '(^|[[:space:]|])reverted([[:space:]|]|$)' /tmp/migration-list.txt; then",
      '            echo "::error::Reverted migrations detected after db push — see list above (C-0331)"',
      "            exit 1",
      "          fi",
      '          echo "::endgroup::"',
    ].join("\n");

    it("the C-0331 reverted-grep tail is byte-identical to its pre-164.8-05 form", () => {
      expect(
        WF.includes(PROD_C0331_TAIL),
        "the PROD `Push migrations to production` C-0331 tail CHANGED. The one automatic " +
          "applier of DDL to production is not something to edit as a side effect of editing " +
          "the job around it.",
      ).toBe(true);
      calibrate(
        "the PROD C-0331 tail pin bites",
        (s) =>
          s.replace(
            "          supabase migration list --linked | tee /tmp/migration-list.txt\n",
            "          supabase migration list --linked\n",
          ),
        (t) => t.includes(PROD_C0331_TAIL),
      );
    });

    it("the PROD apply still links, dry-runs and pushes with --include-all, in order", () => {
      const block = jobBlock(WF, APPLY_JOB);
      const link = liveCommandIndex(block, 'supabase link --project-ref "$SUPABASE_PROJECT_REF"');
      const dry = liveCommandIndex(block, "supabase db push --include-all --dry-run | tee /tmp/prod-dry-run.txt");
      const push = liveCommandIndex(block, "supabase db push --include-all | tee /tmp/prod-push.txt");
      const list = liveCommandIndex(block, "supabase migration list --linked | tee /tmp/migration-list.txt");
      for (const [label, idx] of [
        ["the supabase link", link],
        ["the PROD dry-run", dry],
        ["the PROD push", push],
        ["the C-0331 migration list", list],
      ] as const) {
        expect(idx, `${label} is not a LIVE line in the apply job`).toBeGreaterThanOrEqual(0);
      }
      expect(link, "the PROD dry-run runs BEFORE `supabase link`").toBeLessThan(dry);
      expect(
        dry,
        "the PROD push runs BEFORE its own dry-run, so the set it is compared against was " +
          "captured after the fact and the comparison proves nothing",
      ).toBeLessThan(push);
      expect(push, "the C-0331 migration list runs BEFORE the push it verifies").toBeLessThan(list);
      calibrate(
        "the PROD dry-run-before-push pin bites",
        (s) =>
          s.replace(
            "          supabase db push --include-all --dry-run | tee /tmp/prod-dry-run.txt\n",
            "",
          ),
        (t) =>
          liveCommandIndex(
            jobBlock(t, APPLY_JOB),
            "supabase db push --include-all --dry-run | tee /tmp/prod-dry-run.txt",
          ) >= 0,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // The database-identity marker: EXECUTED against a stubbed psql.
  // ---------------------------------------------------------------------------
  describe("`Which database am I on` — the only thing between this job and the wrong database", () => {
    /**
     * ⛔ WHAT THIS REPLACED. The suite touched this step twice, both times via
     * `liveIndexContaining(block, "shobj_description")` — which only asserts the SQL
     * substring appears somewhere before the dry-run. Delete the NULL-marker branch,
     * the not-a-whole-word-TEST branch and the names-PRODUCTION branch, leave the
     * SELECT plus an unconditional `echo which_database: OK`, and EVERY assertion in
     * both test files still passed. The file's own comment calls this step "the only
     * thing standing between this job and a write to the wrong database".
     *
     * ⚖️ WHY (b) EXECUTION AND NOT ONLY (a) BYTE-IDENTITY. Byte-identity against
     * `test-restore-from-baseline.yml` proves the two copies AGREE; it does not prove
     * either one refuses anything, and both could be gutted in one commit by the
     * person re-syncing them. Executing the branches is the stronger evidence, so it
     * is the primary pin. The byte pin is kept ALONGSIDE it, cheaply, because the
     * step's own comment claims it is "Copied VERBATIM" — an unpinned claim in a file
     * whose comments ARE the safety argument.
     *
     * ⛔ THE MARKER FIXTURES BELOW ARE INVENTED. This repository is PUBLIC, and the
     * real `COMMENT ON DATABASE` text on either project is deliberately never written
     * down here. What is under test is the SHAPE the branches key on — a whole-word
     * `test`, a `prod` substring, NULL, unreadable — not any real marker's wording.
     */
    const MARKER_OK = "fixture marker: a shared test database (invented, not a real marker)";
    const MARKER_PROD = "fixture marker: test-shaped and production-shaped at once (invented)";
    const MARKER_NOT_WHOLE_WORD = "fixture marker: latest database, no standalone word (invented)";

    const PSQL_STUB = [
      "#!/usr/bin/env bash",
      'case "${MARKER_STUB_MODE:-text}" in',
      "  unreadable)",
      `    echo 'connection to server at "pooler.example.invalid" (203.0.113.7), port 5432 failed' >&2`,
      "    exit 2",
      "    ;;",
      "  null)",
      "    ;;",
      "  *)",
      `    printf '%s\\n' "\${MARKER_STUB_TEXT:-}"`,
      "    ;;",
      "esac",
      "",
    ].join("\n");

    const runMarker = (
      script: string,
      mode: string,
      text = "",
    ): { status: number; out: string } =>
      runScript(
        script,
        {
          TEST_DB_SESSION_URL: "postgres://u@pooler.example.invalid:5432/postgres",
          MARKER_STUB_MODE: mode,
          MARKER_STUB_TEXT: text,
        },
        { stubs: { psql: PSQL_STUB, timeout: TIMEOUT_STUB } },
      );

    it("EXECUTED: it refuses an unreadable, NULL, non-TEST or PROD-named marker, and only then passes", () => {
      const script = extractRunScript(WF, MARKER_STEP);

      const unreadable = runMarker(script, "unreadable");
      expect(
        unreadable.status,
        `the marker step exited ${unreadable.status} when psql FAILED; it must exit 1 — it ` +
          `cannot identify the database and everything after it writes to one.\n${unreadable.out}`,
      ).toBe(1);
      expect(unreadable.out).toContain("could not be read");
      expect(
        unreadable.out,
        "psql's connect failure named the host and its IP verbatim. The three redactions in " +
          "this branch (userinfo, the server-at clause, the for-user clause) exist because " +
          "this log is public.",
      ).not.toContain("pooler.example.invalid");

      const nullMarker = runMarker(script, "null");
      expect(
        nullMarker.status,
        `the marker step exited ${nullMarker.status} on a NULL marker; it must exit 1. A NULL ` +
          `marker means the COMMENT ON DATABASE was LOST — it does NOT mean this is TEST.` +
          `\n${nullMarker.out}`,
      ).toBe(1);
      expect(nullMarker.out).toContain("NULL");

      const notWholeWord = runMarker(script, "text", MARKER_NOT_WHOLE_WORD);
      expect(
        notWholeWord.status,
        `the marker step exited ${notWholeWord.status} on a marker that only CONTAINS the ` +
          `letters "test" ("latest"); it must exit 1, or "production-latest" would pass as ` +
          `TEST.\n${notWholeWord.out}`,
      ).toBe(1);
      expect(notWholeWord.out).toContain("whole word");

      const prodMarker = runMarker(script, "text", MARKER_PROD);
      expect(
        prodMarker.status,
        `the marker step exited ${prodMarker.status} on a marker naming PRODUCTION; it must ` +
          `exit 1, loudly.\n${prodMarker.out}`,
      ).toBe(1);
      expect(prodMarker.out).toContain("PRODUCTION");

      const ok = runMarker(script, "text", MARKER_OK);
      expect(
        ok.status,
        `the marker step exited ${ok.status} on a marker naming TEST and not PROD; it must ` +
          `exit 0, or the job can never run.\n${ok.out}`,
      ).toBe(0);
      expect(ok.out).toContain("which_database: OK");

      // ⛔ The marker TEXT is never printed, not even when it is the reason to refuse.
      for (const [label, r, text] of [
        ["the non-TEST refusal", notWholeWord, MARKER_NOT_WHOLE_WORD],
        ["the PRODUCTION refusal", prodMarker, MARKER_PROD],
        ["the success path", ok, MARKER_OK],
      ] as const) {
        expect(r.out, `${label} PRINTED the marker text. This log is public.`).not.toContain(text);
      }

      // ⛔ CALIBRATION — THE REVIEWER'S EXACT MUTANT. Neuter all three refusal
      // branches, leaving the SELECT plus an unconditional `echo which_database: OK`.
      // Every assertion in both test files passed against that mutant before this
      // block existed; here EVERY fixture must go green, which is what makes the
      // assertions above evidence rather than decoration.
      const NULL_IF = 'if [ -z "${marker}" ]; then';
      const WHOLE_WORD_IF =
        "if ! printf '%s' \"${marker}\" | grep -Eiq '(^|[^[:alnum:]_])test([^[:alnum:]_]|$)'; then";
      const PROD_IF = "if printf '%s' \"${marker}\" | grep -Eiq 'prod'; then";
      let gutted = script;
      for (const branch of [NULL_IF, WHOLE_WORD_IF, PROD_IF]) {
        expect(
          gutted,
          `CALIBRATION: the branch \`${branch}\` was not found in the extracted script`,
        ).toContain(branch);
        gutted = gutted.replace(branch, "if false; then");
      }
      for (const [label, mode, text] of [
        ["a NULL marker", "null", ""],
        ["a marker that does not name TEST as a whole word", "text", MARKER_NOT_WHOLE_WORD],
        ["a marker naming PRODUCTION", "text", MARKER_PROD],
      ] as const) {
        expect(
          runMarker(gutted, mode, text).status,
          `CALIBRATION: with all three refusal branches replaced by \`if false\`, the step STILL ` +
            `refused ${label}. The assertions above are then measuring something other than ` +
            `those branches.`,
        ).toBe(0);
      }
      // And each branch on its own, so a single deletion cannot hide behind a sibling.
      expect(
        runMarker(script.replace(PROD_IF, "if false; then"), "text", MARKER_PROD).status,
        "CALIBRATION: the PRODUCTION-marker refusal is not produced by its own branch",
      ).toBe(0);
      expect(
        runMarker(script.replace(WHOLE_WORD_IF, "if false; then"), "text", MARKER_NOT_WHOLE_WORD)
          .status,
        "CALIBRATION: the not-a-whole-word refusal is not produced by its own branch",
      ).toBe(0);
      const noNull = runMarker(script.replace(NULL_IF, "if false; then"), "null");
      expect(
        noNull.out,
        "CALIBRATION: the NULL diagnosis survived the deletion of the NULL branch — the " +
          "message is coming from somewhere else",
      ).not.toContain("NULL");
    }, EXEC_TEST_TIMEOUT_MS);

    it("the step is byte-identical to test-restore-from-baseline.yml's copy, as its comment claims", () => {
      const here = extractRunScript(WF, MARKER_STEP).trimEnd();
      const there = extractRunScript(RESTORE, MARKER_STEP).trimEnd();
      expect(here, `${WF_PATH} has no ${MARKER_STEP} script`).not.toBe("");
      expect(
        here,
        "the `Which database am I on` step DRIFTED from test-restore-from-baseline.yml's. " +
          "This step's own comment says it is copied VERBATIM including its two hard-coded " +
          "marker regexes, and `test-restore-workflow-wiring.test.ts` pins THOSE regexes to " +
          "the restore script's defaults — a chain that only reaches this workflow while the " +
          "copy is exact. Re-sync it; do not tighten one side alone.",
      ).toBe(there);
      calibrate(
        "the marker byte-identity pin bites on a one-token drift",
        (s) => s.replace("grep -Eiq 'prod'", "grep -Eiq 'prodx'"),
        (t) => extractRunScript(t, MARKER_STEP).trimEnd() === there,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // The affirmative applied-set check, on BOTH environments. EXECUTED.
  // ---------------------------------------------------------------------------
  describe("the applies assert that something was APPLIED, not merely that nothing reverted", () => {
    /**
     * ⛔ THE DEFECT. `grep -Eiq reverted` is a NEGATIVE check: a pattern that matches
     * nothing returns 1 and reads as CLEAN. So a `db push` that applied ZERO
     * migrations was indistinguishable from one that applied the merge — and on the
     * TEST side it still green-lit the PROD apply. That is not hypothetical here:
     * Phase 164.8-04 seeded TEST's ledger with 266 CLI-shaped rows whose `statements`
     * column is a provenance sentence and never a claim the SQL executed on TEST, and
     * `db push --include-all` SKIPS any version already in `schema_migrations`. The
     * phase's central claim is "TEST is the stage every migration crosses before
     * PROD"; before this check, nothing measured the crossing.
     */
    const SUPABASE_STUB = [
      "#!/usr/bin/env bash",
      'if [ "$1" = "link" ]; then echo "Finished supabase link."; exit 0; fi',
      'if [ "$1" = "migration" ]; then',
      '  echo "        Local      | Remote     | Time (UTC)"',
      "  exit 0",
      "fi",
      "dry=0",
      'for a in "$@"; do if [ "$a" = "--dry-run" ]; then dry=1; fi; done',
      "if [ \"${dry}\" = \"1\" ]; then",
      '  for v in ${STUB_PLAN_VERSIONS:-}; do echo " • ${v}_stub.sql"; done',
      '  echo "Finished supabase db push."',
      "  exit 0",
      "fi",
      '  for v in ${STUB_PUSH_VERSIONS:-}; do echo "Applying migration ${v}_stub.sql..."; done',
      'echo "Finished supabase db push."',
      "",
    ].join("\n");

    const V1 = "20260101000000";
    const V2 = "20260102000000";

    it("EXECUTED (TEST): the push must apply exactly what its dry-run planned, and not nothing", () => {
      const script = extractRunScript(WF, TEST_PUSH_STEP);
      const run = (
        plan: string[],
        pushed: string[],
        isPush: boolean,
      ): { status: number; out: string } =>
        runScript(
          script,
          {
            TEST_DB_SESSION_URL: "postgres://u@pooler.example.invalid:5432/postgres",
            IS_PUSH: isPush ? "true" : "false",
            STUB_PUSH_VERSIONS: pushed.join(" "),
          },
          {
            stubs: { supabase: SUPABASE_STUB },
            files: {
              "test-dry-run.txt": plan.map((v) => ` • ${v}_stub.sql\n`).join(""),
            },
          },
        );

      const applied = run([V1, V2], [V1, V2], true);
      expect(
        applied.status,
        `the TEST push step exited ${applied.status} when the push applied exactly the two ` +
          `versions the dry-run planned; it must exit 0.\n${applied.out}`,
      ).toBe(0);

      const short = run([V1, V2], [V1], true);
      expect(
        short.status,
        `the TEST push step exited ${short.status} when the push applied ONE of the TWO ` +
          `versions its own dry-run planned; it must exit 1.\n${short.out}`,
      ).toBe(1);
      expect(short.out).toContain("did NOT apply the set its own dry-run planned");
      expect(short.out, "the mismatch does not name the version that went missing").toContain(V2);

      const nothingOnPush = run([], [], true);
      expect(
        nothingOnPush.status,
        `⛔ THE CENTRAL DEFECT. The TEST push step exited ${nothingOnPush.status} when the ` +
          `push applied ZERO migrations on a push-to-main run. This is exactly the ` +
          `ledger-shadow state Phase 164.8-04's 266 seeded rows can produce, and it used to ` +
          `pass — the reverted-grep matched nothing and read as clean, and the PROD apply was ` +
          `green-lit by a stage nothing crossed.\n${nothingOnPush.out}`,
      ).toBe(1);
      expect(nothingOnPush.out).toContain("ZERO migrations");
      expect(
        nothingOnPush.out,
        "the zero-applied refusal does not name the ledger cause an operator has to look at",
      ).toContain("schema_migrations");

      const nothingOnDispatch = run([], [], false);
      expect(
        nothingOnDispatch.status,
        `the TEST push step exited ${nothingOnDispatch.status} when the push applied nothing ` +
          `on a workflow_dispatch. That is the documented escape hatch for a genuinely ` +
          `no-op change and must stay open, or the only remedy for a false red is to edit ` +
          `this workflow.\n${nothingOnDispatch.out}`,
      ).toBe(0);
      expect(nothingOnDispatch.out).toContain("tolerated");

      // Calibration: delete the zero-applied guard. The suite must then stop failing
      // on the empty push — which is the state the whole check exists for.
      const defanged = script.replace(
        /if \[ "\$\{IS_PUSH\}" = "true" \] && \[ "\$\{applied_n\}" -eq 0 \]; then\n[\s\S]*?\nfi\n/,
        "",
      );
      expect(defanged, "CALIBRATION: the zero-applied guard was not found to remove").not.toBe(
        script,
      );
      const defangedRun = runScript(
        defanged,
        {
          TEST_DB_SESSION_URL: "postgres://u@pooler.example.invalid:5432/postgres",
          IS_PUSH: "true",
          STUB_PUSH_VERSIONS: "",
        },
        { stubs: { supabase: SUPABASE_STUB }, files: { "test-dry-run.txt": "" } },
      );
      expect(
        defangedRun.status,
        "CALIBRATION: the step still exited non-zero on an empty push with its zero-applied " +
          "guard deleted — this test is not measuring the guard",
      ).toBe(0);
    }, EXEC_TEST_TIMEOUT_MS);

    it("EXECUTED (PROD): the same affirmative check guards the production apply", () => {
      const script = extractRunScript(WF, PROD_PUSH_STEP);
      // ⚠️ The PROD step's paths are hard-coded `/tmp/...` (pre-existing, alongside the
      // long-standing /tmp/migration-list.txt), so these runs write there rather than
      // into the throwaway dir. Each scenario overwrites both files before it reads
      // them, so ordering between scenarios cannot leak.
      const run = (
        plan: string[],
        pushed: string[],
        isPush: boolean,
      ): { status: number; out: string } =>
        runScript(
          script,
          {
            SUPABASE_PROJECT_REF: "stub-project-ref",
            IS_PUSH: isPush ? "true" : "false",
            STUB_PLAN_VERSIONS: plan.join(" "),
            STUB_PUSH_VERSIONS: pushed.join(" "),
          },
          { stubs: { supabase: SUPABASE_STUB } },
        );

      const applied = run([V1], [V1], true);
      expect(
        applied.status,
        `the PROD push step exited ${applied.status} on a push that applied what it planned; ` +
          `it must exit 0.\n${applied.out}`,
      ).toBe(0);

      const short = run([V1, V2], [V1], true);
      expect(
        short.status,
        `the PROD push step exited ${short.status} when the push applied ONE of the TWO ` +
          `versions its own dry-run planned; it must exit 1.\n${short.out}`,
      ).toBe(1);
      expect(short.out).toContain("did NOT apply the set its own dry-run planned");

      const nothingOnPush = run([], [], true);
      expect(
        nothingOnPush.status,
        `the PROD push step exited ${nothingOnPush.status} when the push applied ZERO ` +
          `migrations on a push-to-main run. A green PROD apply that applied nothing is the ` +
          `PGRST204 schema/code divergence this workflow already fails loud on for absent ` +
          `secrets, one step later in the chain.\n${nothingOnPush.out}`,
      ).toBe(1);
      expect(nothingOnPush.out).toContain("ZERO migrations");

      expect(
        run([], [], false).status,
        "the PROD push step refused a no-op workflow_dispatch; the escape hatch must stay open",
      ).toBe(0);
    }, EXEC_TEST_TIMEOUT_MS);
  });

  // ---------------------------------------------------------------------------
  // The all-green divergence: TEST applied, PROD skipped for want of credentials.
  // ---------------------------------------------------------------------------
  describe("an all-green run that leaves TEST ahead of PROD is a named red", () => {
    /**
     * THE DIVERGENCE. On a `workflow_dispatch` against main with the PROD credentials
     * absent: `plan` is GREEN (Phase 142.1 D-02/R1 deliberately tolerates the
     * unconfigured state on a dispatch), `apply-test` is GREEN and really did APPLY to
     * the shared TEST database, the verdict is GREEN because apply-test succeeded, and
     * `apply` silently SKIPS. Every check green or grey, and shared TEST — which other
     * people's CI runs against — now carries schema PROD does not.
     */
    it("the divergence job needs BOTH plan and apply-test, and is if: always()", () => {
      const block = jobBlock(WF, DIVERGENCE_JOB);
      expect(block, `${DIVERGENCE_JOB} is gone`).not.toBe("");
      expect(liveLineCount(block, "needs: [plan, apply-test]")).toBe(1);
      expect(liveLineCount(block, "if: always()")).toBe(1);
      for (const wiring of [
        "APPLY_TEST_RESULT: ${{ needs.apply-test.result }}",
        "PLAN_RESULT: ${{ needs.plan.result }}",
        "PLAN_CONFIGURED: ${{ needs.plan.outputs.configured }}",
      ]) {
        expect(
          liveLineCount(block, wiring),
          `${DIVERGENCE_JOB} lost its \`${wiring}\` wiring — it then judges something other ` +
            `than the two jobs whose disagreement it exists to name`,
        ).toBe(1);
        calibrate(
          `the divergence job's \`${wiring}\` wiring is line-exact`,
          (s) =>
            mutateInJob(
              s,
              DIVERGENCE_JOB,
              `          ${wiring}\n`,
              `          ${wiring.split(":")[0]}: success\n`,
            ),
          (t) => liveLineCount(jobBlock(t, DIVERGENCE_JOB), wiring) === 1,
        );
      }
      calibrate(
        "the divergence job is if: always()",
        (s) =>
          s.replace(
            `  ${DIVERGENCE_JOB}:\n    needs: [plan, apply-test]\n    if: always()\n`,
            `  ${DIVERGENCE_JOB}:\n    needs: [plan, apply-test]\n`,
          ),
        (t) => liveLineCount(jobBlock(t, DIVERGENCE_JOB), "if: always()") === 1,
      );
    });

    it("EXECUTED: it reddens ONLY the TEST-applied / PROD-unconfigured combination", () => {
      const script = extractRunScript(WF, DIVERGENCE_STEP);
      const run = (
        applyTest: string,
        plan: string,
        configured: string,
      ): { status: number; out: string } =>
        runScript(script, {
          APPLY_TEST_RESULT: applyTest,
          PLAN_RESULT: plan,
          PLAN_CONFIGURED: configured,
        });

      const diverged = run("success", "success", "false");
      expect(
        diverged.status,
        `the divergence job exited ${diverged.status} on the exact all-green divergence: ` +
          `apply-test SUCCEEDED (so TEST was written to) while the PROD apply was skipped for ` +
          `want of credentials. It must exit 1 — that asymmetry is the one state in this ` +
          `workflow with no other red anywhere.\n${diverged.out}`,
      ).toBe(1);
      expect(diverged.out).toContain("AHEAD OF PRODUCTION");
      expect(
        diverged.out,
        "the refusal does not name the three values whose absence produced it",
      ).toContain("SUPABASE_ACCESS_TOKEN");

      for (const [label, applyTest, plan, configured] of [
        ["PROD credentials present", "success", "success", "true"],
        ["the TEST apply failed (the verdict job owns that)", "failure", "success", "false"],
        ["the TEST apply was skipped (the verdict job owns that)", "skipped", "success", "false"],
        ["the plan job itself is already red", "success", "failure", ""],
      ] as const) {
        const r = run(applyTest, plan, configured);
        expect(
          r.status,
          `the divergence job exited ${r.status} when ${label}. It must be SILENT there — a ` +
            `second red on a state another job already names is noise, and noise is what gets ` +
            `a fail-loud check softened.\n${r.out}`,
        ).toBe(0);
      }

      // Calibration: make the configured branch unconditional and the red disappears.
      const defanged = script.replace(
        'elif [ "${PLAN_CONFIGURED}" = "true" ]; then',
        "elif true; then",
      );
      expect(defanged, "CALIBRATION: the configured branch was not found to gut").not.toBe(script);
      expect(
        run("success", "success", "false").status,
        "sanity: the un-mutated script reddens the divergence",
      ).toBe(1);
      expect(
        runScript(defanged, {
          APPLY_TEST_RESULT: "success",
          PLAN_RESULT: "success",
          PLAN_CONFIGURED: "false",
        }).status,
        "CALIBRATION: the divergence still reddened with its condition replaced by `true` — " +
          "this test is not measuring the branch",
      ).toBe(0);
    }, EXEC_TEST_TIMEOUT_MS);
  });
});
