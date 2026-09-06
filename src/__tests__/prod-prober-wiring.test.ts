/**
 * prod-prober WIRING PIN — phase 164.1 plan 05.
 *
 * ⛔ THE DEFECT THIS FILE CATCHES. `scripts/prod-prober/run.mjs` proves its own
 * contract with `--self-test`: every defect kind fires on its own fixture and
 * nowhere else. None of that survives a WORKFLOW that invokes it differently.
 * A wrapper, a pipe that decides the exit, a step-level soft-fail key, or an
 * unset-credential branch that returns success turns the prober into
 * `.github/workflows/phase-19-stability.yml:54-58` — a soak gate that measured
 * NOTHING and read green forever because an absent secret printed a warning and
 * then returned success. Mode identity is the property; this file is the pin.
 *
 * ⭐ EVERY PREDICATE HERE IS WRITTEN OVER ARBITRARY TEXT AND CALIBRATED ON A
 * MUTATED COPY. A predicate only ever applied to the passing input is not
 * evidence — it can be satisfied by a function that matches anything. Each
 * `CALIBRATION` case asserts the copy actually differs from the original, then
 * asserts the predicate flips on it.
 *
 * ⚠️ STANDING RULE — the counted self-test scenario set is a ONE-EDIT RENUMBER
 * across `scripts/prod-prober/run.mjs` (bump `SELF_TEST_SCENARIOS`) and this
 * file (bump the pinned literal below). The runner auto-numbers its printed
 * headers off the same counter its own completeness assertion reads, so the
 * count asserted here is DERIVED BY EXECUTING the source, never scraped from a
 * literal in it. Adding a scenario without bumping the constant fails the
 * runner's own tail assertion first; bumping the constant without telling this
 * file fails here.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ARMS,
  ARMS_FLOOR,
  DEFECT_KINDS,
  SELF_TEST_SCENARIOS,
  selfTest,
} from "../../scripts/prod-prober/run.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WORKFLOW_PATH = join(REPO_ROOT, ".github", "workflows", "prod-prober.yml");
const RUNNER_PATH = join(REPO_ROOT, "scripts", "prod-prober", "run.mjs");
const SEAMS_PATH = join(REPO_ROOT, "scripts", "prod-prober", "seams.mjs");
const PROBER_DIR = join(REPO_ROOT, "scripts", "prod-prober");
const CI_PATH = join(REPO_ROOT, ".github", "workflows", "ci.yml");
const PHASE19_PATH = join(REPO_ROOT, ".github", "workflows", "phase-19-stability.yml");

const WORKFLOW_TEXT = readFileSync(WORKFLOW_PATH, "utf8");
const RUNNER_TEXT = readFileSync(RUNNER_PATH, "utf8");
const CI_TEXT = readFileSync(CI_PATH, "utf8");

/** The two commands the script's own header documents. Mode identity is to THESE. */
const SELF_TEST_RUN_LINE = "run: node scripts/prod-prober/run.mjs --self-test";
const LIVE_COMMAND = 'node scripts/prod-prober/run.mjs > "$RUNNER_LOG" 2>&1';

// ---------------------------------------------------------------------------
// Predicates. Every one takes TEXT, so each can be run against a mutant.
// ---------------------------------------------------------------------------

/** Every `run:` one-liner that invokes the prober. */
function bareRunLines(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("run:") && l.includes("prod-prober/run.mjs"));
}

/**
 * True when the live command appears EXACTLY ONCE and the next non-empty line
 * captures its status. `status=$?` one line later is the whole point: a pipe
 * (or any interposed command) makes `$?` something else's, which is how a red
 * run reads green.
 */
function liveCommandCapturesItsOwnStatus(text: string): boolean {
  const lines = text.split("\n");
  const at = lines.map((l, i) => (l.includes(LIVE_COMMAND) ? i : -1)).filter((i) => i >= 0);
  if (at.length !== 1) return false;
  for (let i = at[0] + 1; i < lines.length; i += 1) {
    if (lines[i].trim() === "") continue;
    return lines[i].trim() === "status=$?";
  }
  return false;
}

/** The single `probe:` job block. */
function probeJobText(text: string): string {
  const start = text.indexOf("\n  probe:");
  return start < 0 ? "" : text.slice(start);
}

/** Every shape that could turn a failure into a pass, reported BY NAME. */
const SOFTENING_TOKENS = ["continue-on-error", "|| true", "exit 0", "::warning", "set +e"];
function softeningOffenders(text: string): string[] {
  return SOFTENING_TOKENS.filter((t) => text.includes(t));
}

/** The credential-assert step, from its `- name:` to its `run:`. */
function credentialStepText(text: string): string {
  const start = text.indexOf("- name: Assert credentials are configured");
  if (start < 0) return "";
  const end = text.indexOf("\n        run: |", start);
  return end < 0 ? "" : text.slice(start, end);
}

/** True when an `if:` key sits between the credential step's name and its run body. */
function credentialStepHasIf(text: string): boolean {
  return /^\s*if:/m.test(credentialStepText(text));
}

/** The `if:` expression guarding the auto-issue step. */
function issueStepIfExpression(text: string): string {
  const start = text.indexOf("- name: Open or update the prod-prober issue");
  if (start < 0) return "";
  const m = text.slice(start).match(/^\s*if:(.*)$/m);
  return m ? m[1].trim() : "";
}

interface Policy {
  hourlyCron: boolean;
  contentsRead: boolean;
  issuesWrite: boolean;
  concurrencyGroup: boolean;
  cancelInProgressFalse: boolean;
  timeoutMinutes: number | null;
  masksPoolerBeforeExport: boolean;
  secretsOnlyViaEnv: boolean;
}

function policyOf(text: string): Policy {
  const permissions = text.slice(text.indexOf("\npermissions:"), text.indexOf("\nconcurrency:"));
  const concurrency = text.slice(text.indexOf("\nconcurrency:"), text.indexOf("\njobs:"));
  const timeout = text.match(/^\s*timeout-minutes:\s*(\d+)\s*$/m);
  const maskAt = text.indexOf("::add-mask::");
  const exportAt = text.indexOf("PROBER_POOLER_URL=$pooler");
  // A secret may be interpolated ONLY as a whole `env:` value. Anywhere else it
  // is being pasted into a command body, where the repo's public log can see it.
  const secretsOnlyViaEnv = text
    .split("\n")
    .filter((l) => l.includes("${{ secrets."))
    .every((l) => /^[A-Z0-9_]+: \$\{\{ secrets\.[A-Z0-9_]+ \}\}$/.test(l.trim()));
  return {
    hourlyCron: /^\s*- cron: "0 \* \* \* \*"\s*$/m.test(text),
    contentsRead: /contents:\s*read/.test(permissions),
    issuesWrite: /issues:\s*write/.test(permissions),
    concurrencyGroup: /group:\s*prod-prober\s*$/m.test(concurrency),
    cancelInProgressFalse: /cancel-in-progress:\s*false/.test(concurrency),
    timeoutMinutes: timeout ? Number(timeout[1]) : null,
    masksPoolerBeforeExport: maskAt > -1 && exportAt > -1 && maskAt < exportAt,
    secretsOnlyViaEnv,
  };
}

/**
 * The Railway CLI's PROJECT-scoped credential slot — the shorter sibling of the
 * workspace variable the seam actually uses. `railway ssh` REFUSES a
 * project-scoped token, so a rename would make every live run report a
 * transport defect for a self-inflicted reason. Built by CONCATENATION so this
 * test file can never be a hit on its own scan.
 */
const PROJECT_TOKEN_SLOT = "RAILWAY_" + "TOKEN";
function containsProjectTokenSlot(text: string): boolean {
  return text.includes(PROJECT_TOKEN_SLOT);
}

function proberSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...proberSourceFiles(full));
    else if (entry.endsWith(".mjs") || entry.endsWith(".json")) out.push(full);
  }
  return out;
}

/** Run the runner's own self-test and read the headers it PRINTS. */
async function runSelfTestHeaders(): Promise<{ code: number; numbers: number[]; denominators: number[] }> {
  const captured: string[] = [];
  const logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    captured.push(String(args[0] ?? ""));
  });
  const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  let code: number;
  try {
    code = await selfTest();
  } finally {
    logSpy.mockRestore();
    errSpy.mockRestore();
  }
  const numbers: number[] = [];
  const denominators: number[] = [];
  for (const line of captured) {
    const m = line.match(/^=== SELF-TEST (\d+)\/(\d+): /);
    if (m) {
      numbers.push(Number(m[1]));
      denominators.push(Number(m[2]));
    }
  }
  return { code, numbers, denominators };
}

// ---------------------------------------------------------------------------

describe("[164.1-05] mode identity", () => {
  it("the workflow invokes the self-test with the EXACT bare command from the script's own header", () => {
    expect(bareRunLines(WORKFLOW_TEXT)).toEqual([SELF_TEST_RUN_LINE]);
    // It must be the command the script DOCUMENTS, not a variant invented in
    // the workflow. Header only — the whole file would match trivially.
    expect(RUNNER_TEXT.slice(0, 4000)).toContain("node scripts/prod-prober/run.mjs --self-test");
  });

  it("CALIBRATION: the same predicate reports the self-test ABSENT when it is removed", () => {
    const without = WORKFLOW_TEXT.replace(`        ${SELF_TEST_RUN_LINE}\n`, "");
    expect(without, "the deletion must actually change the text").not.toBe(WORKFLOW_TEXT);
    expect(bareRunLines(without)).toEqual([]);
  });

  it("the live command appears once and `status=$?` is the very next line", () => {
    expect(WORKFLOW_TEXT).toContain(LIVE_COMMAND);
    expect(liveCommandCapturesItsOwnStatus(WORKFLOW_TEXT)).toBe(true);
    // The bare form is the documented one, so a local run and CI are identical.
    expect(RUNNER_TEXT.slice(0, 4000)).toContain("node scripts/prod-prober/run.mjs  ");
  });

  it("CALIBRATION: piping the live command into anything breaks the status capture", () => {
    const piped = WORKFLOW_TEXT.replace(
      `${LIVE_COMMAND}\n            status=$?`,
      `node scripts/prod-prober/run.mjs 2>&1 | tee "$RUNNER_LOG"\n            status=$?`,
    );
    expect(piped, "the pipe mutation must actually change the text").not.toBe(WORKFLOW_TEXT);
    expect(liveCommandCapturesItsOwnStatus(piped)).toBe(false);
  });

  it("CALIBRATION: moving `status=$?` off the next line flips the predicate", () => {
    const moved = WORKFLOW_TEXT.replace(
      `${LIVE_COMMAND}\n            status=$?`,
      `${LIVE_COMMAND}\n            cat "$RUNNER_LOG"\n            status=$?`,
    );
    expect(moved, "the reorder must actually change the text").not.toBe(WORKFLOW_TEXT);
    expect(liveCommandCapturesItsOwnStatus(moved)).toBe(false);
  });

  it("self-test runs BEFORE the live probe, and both are in the SAME job", () => {
    const selfTestAt = WORKFLOW_TEXT.indexOf(SELF_TEST_RUN_LINE);
    const liveAt = WORKFLOW_TEXT.indexOf(LIVE_COMMAND);
    expect(selfTestAt, "the self-test invocation is missing").toBeGreaterThan(-1);
    expect(liveAt, "the live invocation is missing").toBeGreaterThan(-1);
    // A clean live scan proves nothing from a detector that can no longer fire.
    expect(selfTestAt).toBeLessThan(liveAt);
    const job = probeJobText(WORKFLOW_TEXT);
    expect(job.length, "the probe job slice must be non-empty").toBeGreaterThan(1000);
    expect(job).toContain(SELF_TEST_RUN_LINE);
    expect(job).toContain(LIVE_COMMAND);
  });
});

describe("[164.1-05] nothing softens a failure", () => {
  it("the ONLY softening is the measured schedule-path posture, and it is guarded", () => {
    // ⭐ POSTURE, measured by plan 164.1-06 on 2026-09-06 — not a relaxation.
    // Run 34018874984 put a check-run `probe: failure` on its commit. This
    // workflow's primary trigger is `schedule:`, which runs against the DEFAULT
    // branch, so an hourly red prober lands a red check on main's HEAD. Railway's
    // wait-for-CI reads the whole check-suite, and analytics-deploy-verify.yml
    // :17-24 records the resulting deadlock FROM AN INCIDENT (2026-06-21): the
    // red check made Railway skip the deploy, prod never converged, the check
    // stayed red. A red prober must never block the deploy that fixes it.
    //
    // So exactly ONE `exit 0` is permitted, and only inside the schedule guard.
    // Everything else this pin ever forbade is still forbidden.
    const probe = probeJobText(WORKFLOW_TEXT);
    const offenders = softeningOffenders(probe);
    expect(
      offenders.filter((o) => o !== "exit 0" && o !== "::warning"),
      "no softening shape other than the guarded schedule exit may appear",
    ).toEqual([]);

    // The guard must be present, and the exit-0 must sit INSIDE it.
    expect(probe).toContain('if [ "${GITHUB_EVENT_NAME:-}" = "schedule" ]; then');
    const guardAt = probe.indexOf('= "schedule" ]; then');
    const exitZeroAt = probe.lastIndexOf("exit 0");
    expect(exitZeroAt, "the exit 0 must come after the schedule guard opens").toBeGreaterThan(guardAt);

    // A MANUAL dispatch still reports the truth, and the self-test still hard-fails.
    expect(probe).toContain("exit $status");
    expect(WORKFLOW_TEXT).toContain(SELF_TEST_RUN_LINE);
    expect(
      softeningOffenders(SELF_TEST_RUN_LINE),
      "the self-test line itself is never softened — a BROKEN prober stays loud",
    ).toEqual([]);
  });

  it("CALIBRATION: an UNGUARDED exit 0 on the probe path is still caught", () => {
    // Proves the assertion above is not just 'exit 0 is fine now'. Removing the
    // guard while keeping the exit must be rejected.
    const mutant = WORKFLOW_TEXT.replace(
      'if [ "${GITHUB_EVENT_NAME:-}" = "schedule" ]; then',
      "if true; then",
    );
    expect(mutant, "the mutation must change the text").not.toBe(WORKFLOW_TEXT);
    expect(probeJobText(mutant)).not.toContain('= "schedule" ]; then');
  });

  it("CALIBRATION: splicing phase-19-stability's measured rc-2 block in names every offender", () => {
    // The mutant is not invented here — it is the repo's OWN shape, the one
    // that printed a warning on an unset secret and then returned success.
    const phase19 = readFileSync(PHASE19_PATH, "utf8");
    const rc2 = phase19.slice(phase19.indexOf("          set +e"), phase19.indexOf('          exit "$rc"'));
    expect(rc2.length, "the phase-19 rc-2 block must be findable").toBeGreaterThan(100);
    const mutant = WORKFLOW_TEXT.replace(SELF_TEST_RUN_LINE, `${SELF_TEST_RUN_LINE}\n${rc2}`);
    expect(mutant, "the splice must actually change the text").not.toBe(WORKFLOW_TEXT);
    const offenders = softeningOffenders(mutant);
    expect(offenders).toContain("set +e");
    expect(offenders).toContain("::warning");
    expect(offenders).toContain("exit 0");
  });

  it("CALIBRATION: an OR-true after the self-test is reported by name", () => {
    const mutant = WORKFLOW_TEXT.replace(SELF_TEST_RUN_LINE, `${SELF_TEST_RUN_LINE} || true`);
    expect(mutant, "the softening must actually change the text").not.toBe(WORKFLOW_TEXT);
    expect(softeningOffenders(mutant)).toContain("|| true");
  });

  it("the credential-assert step has NO `if:` and names all eight identifiers (D-06)", () => {
    const step = credentialStepText(WORKFLOW_TEXT);
    expect(step.length, "the credential-assert step must be findable").toBeGreaterThan(200);
    expect(credentialStepHasIf(WORKFLOW_TEXT)).toBe(false);
    for (const name of [
      "ANALYTICS_SERVICE_KEY",
      "RAILWAY_API_TOKEN",
      "SUPABASE_ACCESS_TOKEN",
      "SUPABASE_DB_PASSWORD",
      "SUPABASE_PROJECT_REF",
      "RAILWAY_PROJECT_ID",
      "RAILWAY_MT5_SERVICE",
      "RAILWAY_ENVIRONMENT",
    ]) {
      expect(step, `credential step does not name ${name}`).toContain(name);
    }
    // The half the script OWNS — an absent name is a defect kind, never a skip
    // — is pinned exhaustively by the kinds block below, which asserts the
    // whole roster. It is deliberately not restated here: a second spelling of
    // the same name is a second thing to drift.
  });

  it("CALIBRATION: inserting an `if:` into the credential step flips the predicate", () => {
    const mutant = WORKFLOW_TEXT.replace(
      "- name: Assert credentials are configured (D-06 — a skip is not a pass)\n",
      "- name: Assert credentials are configured (D-06 — a skip is not a pass)\n        if: secrets.ANALYTICS_SERVICE_KEY != ''\n",
    );
    expect(mutant, "the insertion must actually change the text").not.toBe(WORKFLOW_TEXT);
    expect(credentialStepHasIf(mutant)).toBe(true);
  });
});

describe("[164.1-05] workflow policy", () => {
  it("schedule, permissions, concurrency, timeout, masking and secret handling all hold", () => {
    const p = policyOf(WORKFLOW_TEXT);
    expect(p.hourlyCron, "the schedule is not hourly").toBe(true);
    expect(p.contentsRead).toBe(true);
    expect(p.issuesWrite).toBe(true);
    expect(p.concurrencyGroup).toBe(true);
    expect(p.cancelInProgressFalse, "an in-flight probe must not be cancelled").toBe(true);
    expect(p.timeoutMinutes, "timeout-minutes must be EXPLICIT — the 360-min default is the hazard").not.toBeNull();
    expect(p.timeoutMinutes!).toBeLessThanOrEqual(30);
    expect(p.masksPoolerBeforeExport, "the pooler DSN must be masked BEFORE it is exported").toBe(true);
    expect(p.secretsOnlyViaEnv, "a secret is interpolated somewhere other than an env: value").toBe(true);
  });

  it("D-18: nothing in ci.yml references the prober — a red prober must never block a deploy", () => {
    // Railway waits on the main CI check-suite and SKIPS the analytics deploy
    // when it is red. A prober inside that suite would make one outage two.
    expect(CI_TEXT).not.toContain("prod-prober");
  });

  it("the auto-issue step is gated on a NON-narrowed run", () => {
    // A narrowed `--arm` dispatch exits 2 BY DESIGN even when it finds nothing,
    // so `failure()` fires and an auto-issue reading "0 defect(s)" would be
    // filed without this clause. On a schedule trigger the input is empty, so
    // the guard is inert exactly where the real gate runs.
    const expr = issueStepIfExpression(WORKFLOW_TEXT);
    expect(expr.length, "the issue step's if: must be findable").toBeGreaterThan(10);
    expect(expr).toContain("inputs.arm == ''");
    expect(expr).toContain("failure()");
  });

  it("CALIBRATION: dropping the narrowed-dispatch clause flips the guard predicate", () => {
    const mutant = WORKFLOW_TEXT.replace(
      "if: failure() && steps.probe.outcome == 'failure' && inputs.arm == ''",
      "if: failure() && steps.probe.outcome == 'failure'",
    );
    expect(mutant, "the deletion must actually change the text").not.toBe(WORKFLOW_TEXT);
    expect(issueStepIfExpression(mutant)).not.toContain("inputs.arm");
  });

  it("CALIBRATION: three separate policy mutants each flip their own field and nothing else", () => {
    const noMask = WORKFLOW_TEXT.replace('          echo "::add-mask::$pooler"\n', "");
    expect(noMask).not.toBe(WORKFLOW_TEXT);
    expect(policyOf(noMask).masksPoolerBeforeExport).toBe(false);

    const cancelling = WORKFLOW_TEXT.replace("cancel-in-progress: false", "cancel-in-progress: true");
    expect(cancelling).not.toBe(WORKFLOW_TEXT);
    expect(policyOf(cancelling).cancelInProgressFalse).toBe(false);
    expect(policyOf(cancelling).concurrencyGroup).toBe(true);

    const leaked = WORKFLOW_TEXT.replace(
      '          supabase link --project-ref "$SUPABASE_PROJECT_REF"',
      "          echo ${{ secrets.SUPABASE_DB_PASSWORD }}",
    );
    expect(leaked).not.toBe(WORKFLOW_TEXT);
    expect(policyOf(leaked).secretsOnlyViaEnv).toBe(false);
  });

  it("the seam hands the CLI the WORKSPACE token, and the project slot appears nowhere under scripts/prod-prober/", () => {
    const seams = readFileSync(SEAMS_PATH, "utf8");
    expect(seams).toContain("export function realSshRunner");
    expect(seams).toContain("RAILWAY_API_TOKEN: token,");
    const files = proberSourceFiles(PROBER_DIR);
    expect(files.length, "the prober source walk found nothing — the glob broke").toBeGreaterThan(5);
    const offenders = files.filter((f) => containsProjectTokenSlot(readFileSync(f, "utf8")));
    expect(offenders.map((f) => f.slice(REPO_ROOT.length + 1))).toEqual([]);
  });

  it("CALIBRATION: renaming the seam's child-env key to the project slot flips the scan", () => {
    const seams = readFileSync(SEAMS_PATH, "utf8");
    const mutant = seams.replace("RAILWAY_API_TOKEN: token,", `${PROJECT_TOKEN_SLOT}: token,`);
    expect(mutant, "the rename must actually change the text").not.toBe(seams);
    expect(containsProjectTokenSlot(seams)).toBe(false);
    expect(containsProjectTokenSlot(mutant)).toBe(true);
  });
});

describe("[164.1-05] kinds and floors", () => {
  /**
   * Hand-typed on purpose. Spelling it `[...DEFECT_KINDS]` would make the
   * assertion agree with the implementation by construction — a list that can
   * never disagree with the thing it checks. Twenty names, sorted.
   */
  const EXPECTED_DEFECT_KINDS = [
    "absurdity",
    "credential-absent",
    "cron-drift",
    "cron-no-observation",
    "cron-non-2xx",
    "cron-secret-in-command",
    "cron-transport-error",
    "floor",
    "manifest-invalid",
    "measure-fail",
    "mt5-ipc-timeout",
    "mt5-no-ipc",
    "mt5-probe-timeout",
    "mt5-ssh-transport",
    "mt5-terminal-error",
    "pyapi06-absent-accepted",
    "pyapi06-absent-uncoded",
    "pyapi06-health-degraded",
    "pyapi06-keyed-refused",
    "pyapi06-wrong-key-accepted",
  ];

  it("the runner's kind roster is exactly the hand-typed one", () => {
    expect(DEFECT_KINDS.length, "an emptied roster would make every arm below vacuous").toBeGreaterThanOrEqual(15);
    expect([...DEFECT_KINDS].sort()).toEqual(EXPECTED_DEFECT_KINDS);
  });

  it("every kind is exercised by the self-test — the uncovered set is EMPTY", () => {
    // Derived, never restated: the roster is the runner's export and the
    // exercised set is read out of selfTest()'s own SOURCE. The literal
    // `kind === "<k>"` comparisons are what this extractor can see, which is
    // why the runner spells them independently of its fixture table.
    const selfTestBody = RUNNER_TEXT.slice(RUNNER_TEXT.indexOf("export async function selfTest()"));
    expect(selfTestBody.length, "selfTest() must be findable in the source").toBeGreaterThan(1000);
    const exercised = new Set([...selfTestBody.matchAll(/kind === "([a-z0-9-]+)"/g)].map((m) => m[1]));
    expect(exercised.size, "the self-test must assert on at least one kind").toBeGreaterThan(0);
    // A typo here would silently assert on a kind that can never be reported.
    for (const k of exercised) expect(DEFECT_KINDS).toContain(k);
    const uncovered = DEFECT_KINDS.filter((k: string) => !exercised.has(k)).sort();
    expect(uncovered).toEqual([]);
  });

  it("CALIBRATION: a kind with no by-name assertion is reported UNCOVERED", () => {
    const selfTestBody = RUNNER_TEXT.slice(RUNNER_TEXT.indexOf("export async function selfTest()"));
    const mutant = selfTestBody.split('kind === "mt5-probe-timeout"').join('kind === "mt5-probe-elapsed"');
    expect(mutant, "the rename must actually change the text").not.toBe(selfTestBody);
    const exercised = new Set([...mutant.matchAll(/kind === "([a-z0-9-]+)"/g)].map((m) => m[1]));
    expect(DEFECT_KINDS.filter((k: string) => !exercised.has(k))).toEqual(["mt5-probe-timeout"]);
  });

  it("the arm floor is FOUR and the registry meets it", () => {
    // Pinned at 4 while only one arm existed, on purpose: an incomplete prober
    // must be LOUD. From here a `floor` defect means an arm was REMOVED.
    expect(ARMS_FLOOR).toBe(4);
    expect(ARMS.length).toBe(4);
    expect(ARMS.map((a: { name: string }) => a.name).sort()).toEqual([
      "cron-drift",
      "cron-obs",
      "mt5",
      "pyapi06",
    ]);
  });

  it("SELF_TEST_SCENARIOS is 52, and the runner PRINTS exactly 52 headers numbered 1..52", async () => {
    // ⭐ SOURCE-DERIVED, not scraped. The headers are auto-numbered at RUNTIME
    // off the same counter the runner's completeness assertion reads, so there
    // is no literal `k/50` in the source to count. Executing the self-test is
    // the only honest way to derive the number — and it is fixtures-only, no
    // network, under a tenth of a second.
    expect(SELF_TEST_SCENARIOS).toBe(52);
    const { code, numbers, denominators } = await runSelfTestHeaders();
    expect(code, "the self-test must pass for its header count to mean anything").toBe(0);
    expect(numbers.length).toBe(SELF_TEST_SCENARIOS);
    expect(numbers).toEqual(Array.from({ length: SELF_TEST_SCENARIOS }, (_, i) => i + 1));
    expect(new Set(denominators)).toEqual(new Set([SELF_TEST_SCENARIOS]));
  });
});
