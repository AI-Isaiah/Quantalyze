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
import {
  BARE_URL_RE,
  CANONICAL_UUID_RE,
  CRON_JOB_SEPARATORS,
  CRON_JOB_COLUMNS,
  CRON_JOB_SQL,
  FUNCTIONS_DIR,
  HEADERS_LITERAL_MAX,
  HYGIENE_RULE_IDS,
  TOKEN_MIN,
  compareManifest,
  hygieneVerdict,
  hygieneWithholds,
  hygieneViolations,
  isBareUrl,
  parseCronJobRows,
  splitHygiene,
  UNRECORDED_VERDICT,
} from "../../scripts/prod-prober/arms/cron-drift.mjs";

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
// ⛔ ANCHOR DISCIPLINE (Phase 164.8.2 / WR-07). READ THIS BEFORE WRITING A SLICE.
//
// `String.indexOf` returns -1 on a miss, and JavaScript's `slice` reads a
// negative index FROM THE END: `s.slice(-1)` is the LAST CHARACTER and
// `s.slice(0, -1)` is nearly the WHOLE string. So a narrowing slice whose anchor
// has been RENAMED does not fail — it degenerates into a subject that a
// `toContain` / `not.toContain` / `toBe("")`-shaped assertion sails straight
// over. MEASURED on this very branch: a byte-identity pin over an entire mutex
// protocol was found comparing `"\n"` to `"\n"` and PASSING.
//
// ⛔ AN ABSENT ANCHOR IS A FINDING, NOT A VALUE. Never `?? ''`, never `|| 0`,
// never `Math.max(0, i)`, and never the `start < 0 ? "" : …` shape these very
// helpers used to carry — an empty subject is exactly what makes the assertion
// vacuous. Throw, and NAME the anchor that went missing.
//
// ⚠️ These helpers are restated per-file rather than imported, for the same
// self-containment reason `SOFTENING_TOKENS` is (CONTEXT Area 3, LOCKED for
// Phase 164.8.2): no shared helper module that only wiring tests import.
// ---------------------------------------------------------------------------

/** `text.indexOf(anchor)`, but a miss THROWS by name instead of returning -1. */
function anchorIndex(text: string, anchor: string, from = 0): number {
  const at = text.indexOf(anchor, from);
  if (at < 0) {
    throw new Error(
      `ANCHOR MISSING: ${JSON.stringify(anchor)} is not present in the subject text. ` +
        `The narrowing slice that wanted it would have degenerated (slice(-1) is the LAST ` +
        `CHARACTER, slice(0, -1) is nearly the WHOLE string) and every assertion over the ` +
        `result would have passed vacuously. Fix the anchor or the subject — do not default it.`,
    );
  }
  return at;
}

/** The region from `startAnchor` up to `endAnchor`; either miss throws by name. */
function sliceBetweenAnchors(text: string, startAnchor: string, endAnchor: string): string {
  const start = anchorIndex(text, startAnchor);
  return text.slice(start, anchorIndex(text, endAnchor, start));
}

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
  return text.slice(anchorIndex(text, "\n  probe:"));
}

/**
 * Every shape that could turn a failure into a pass, reported BY NAME.
 *
 * ⭐ THIS FILE IS THE ORIGIN OF THE IDIOM, and it was the LAST of the three to widen.
 * The five-token list started here (Phase 164.1) and was copied out to
 * `src/__tests__/supabase-migrate-test-first.test.ts` and to
 * `src/__tests__/test-restore-workflow-wiring.test.ts`. Phase 164.8 widened the
 * migrate copy to nine; Phase 164.8.2 widened the restore copy and, on measuring the
 * class rather than the review's file list, found this third copy still on five.
 * "One of three hardened" is the same defect as "one half of a twin pair hardened".
 *
 * ⚠️ THE LAST FOUR ARE HERE BECAUSE the first five were not a class, they were five
 * spellings of a class:
 *   - `|| :`            a drop-in for the banned `|| true`, and shorter to type.
 *   - `2>/dev/null`     swallows the stderr that is the evidence a command failed.
 *   - `set +o pipefail` re-enables the "a piped command's exit status is discarded"
 *                       bug — the exact bug the comment above the self-test step in
 *                       `prod-prober.yml` says the file-then-`cat` shape exists to
 *                       avoid.
 *   - `|| exit 0`       an explicit "and if that failed, succeed anyway".
 *
 * ⛔ Widening this list cost NOTHING to triage, and that was MEASURED, not assumed:
 * `prod-prober.yml` carries 0 occurrences of all four (`grep -cF`, 2026-09-09), so
 * unlike the restore workflow this file needs no exact-set allowlist. Regenerate that
 * reading before trusting it.
 *
 * ⛔ THREE COPIES, KEPT LEVEL BY HAND, ON PURPOSE — restated rather than imported for
 * the self-containment reason these wiring tests are built on (Phase 164.8 Plan 05
 * Task 2; CONTEXT Area 3, LOCKED for Phase 164.8.2). No shared helper module that only
 * wiring tests import. The length pin below is what makes the duplication survivable.
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
function softeningOffenders(text: string): string[] {
  return SOFTENING_TOKENS.filter((t) => text.includes(t));
}

/** The credential-assert step, from its `- name:` to its `run:`. */
function credentialStepText(text: string): string {
  return sliceBetweenAnchors(
    text,
    "- name: Assert credentials are configured",
    "\n        run: |",
  );
}

/** True when an `if:` key sits between the credential step's name and its run body. */
function credentialStepHasIf(text: string): boolean {
  return /^\s*if:/m.test(credentialStepText(text));
}

/** The `if:` expression guarding the auto-issue step. */
function issueStepIfExpression(text: string): string {
  const start = anchorIndex(text, "- name: Open or update the prod-prober issue");
  const m = text.slice(start).match(/^\s*if:(.*)$/m);
  if (!m) {
    throw new Error(
      "ANCHOR MISSING: the auto-issue step carries no `if:` key at all. Returning \"\" here " +
        "would make every `not.toContain` over the expression pass vacuously — an UNGATED " +
        "auto-issue step is the very defect this predicate exists to report.",
    );
  }
  return m[1].trim();
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
  // ⛔ WR-07, and this pair was the WORST case in the class: rename either key
  // and `slice(-1, …)` / `slice(…, -1)` hands back a last character or nearly the
  // whole file, and every regex below then reports a policy that was never read.
  const permissions = sliceBetweenAnchors(text, "\npermissions:", "\nconcurrency:");
  const concurrency = sliceBetweenAnchors(text, "\nconcurrency:", "\njobs:");
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
    const rc2 = sliceBetweenAnchors(phase19, "          set +e", '          exit "$rc"');
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

  // ── The four tokens Phase 164.8.2 (WR-06) added, one calibration each. ──────
  // A widened list that is never shown to bite is a list that reads harder and is
  // not, which is the precise defect class this phase closes. Each mutant is
  // inserted INSIDE the scanned `probe:` region and each asserts the mutation
  // actually changed the text first — a replace whose anchor has moved leaves the
  // string identical, and an unreported identical string reads as a passing arm.

  it("CALIBRATION (164.8.2/WR-06): an `|| :` after the self-test is reported by name", () => {
    const mutant = WORKFLOW_TEXT.replace(SELF_TEST_RUN_LINE, `${SELF_TEST_RUN_LINE} || :`);
    expect(mutant, "the softening must actually change the text").not.toBe(WORKFLOW_TEXT);
    expect(softeningOffenders(probeJobText(mutant))).toContain("|| :");
  });

  it("CALIBRATION (164.8.2/WR-06): a `2>/dev/null` on the self-test is reported by name", () => {
    // The self-test's whole job is to prove the detector can still fire. Swallow its
    // stderr and a BROKEN prober reports nothing while the step still exits 0 on the
    // happy path — the same shape that makes `2>/dev/null` the worst of the nine on
    // the restore workflow's database-identity step.
    const mutant = WORKFLOW_TEXT.replace(SELF_TEST_RUN_LINE, `${SELF_TEST_RUN_LINE} 2>/dev/null`);
    expect(mutant, "the softening must actually change the text").not.toBe(WORKFLOW_TEXT);
    expect(softeningOffenders(probeJobText(mutant))).toContain("2>/dev/null");
  });

  it("CALIBRATION (164.8.2/WR-06): a `set +o pipefail` inside a probe step is reported by name", () => {
    // Anchored on the Railway-CLI step's own `set -euo pipefail`, which is inside the
    // `probe:` job and is the shape a real re-enabling edit would take.
    const anchor = '          set -euo pipefail\n          asset="railway';
    expect(
      WORKFLOW_TEXT.split(anchor).length - 1,
      "the Railway-CLI step's `set -euo pipefail` anchor moved; the mutation below would be a no-op",
    ).toBe(1);
    const mutant = WORKFLOW_TEXT.replace(
      anchor,
      '          set -euo pipefail\n          set +o pipefail\n          asset="railway',
    );
    expect(mutant, "the softening must actually change the text").not.toBe(WORKFLOW_TEXT);
    expect(softeningOffenders(probeJobText(mutant))).toContain("set +o pipefail");
  });

  it("CALIBRATION (164.8.2/WR-06): an `|| exit 0` after the self-test is reported by name", () => {
    const mutant = WORKFLOW_TEXT.replace(SELF_TEST_RUN_LINE, `${SELF_TEST_RUN_LINE} || exit 0`);
    expect(mutant, "the softening must actually change the text").not.toBe(WORKFLOW_TEXT);
    expect(softeningOffenders(probeJobText(mutant))).toContain("|| exit 0");
    // ⚠️ And it is NOT absorbed by the measured schedule-path posture. That exemption
    // is for the ONE guarded `exit 0` inside the schedule branch; an `|| exit 0` on
    // the self-test line is a different site and must survive the same filter the
    // posture arm above applies.
    expect(
      softeningOffenders(probeJobText(mutant)).filter((o) => o !== "exit 0" && o !== "::warning"),
    ).toContain("|| exit 0");
  });

  it("the token list is NINE, and its two hand-kept siblings must move with it", () => {
    expect(
      SOFTENING_TOKENS,
      "SOFTENING_TOKENS moved off nine. This list is one of THREE hand-kept copies — the others are in `src/__tests__/supabase-migrate-test-first.test.ts` and `src/__tests__/test-restore-workflow-wiring.test.ts`, and they are duplicated deliberately (CONTEXT Area 3, LOCKED: no shared helper module that only wiring tests import). Widen or narrow ALL THREE in the same commit, or the class Phase 164.8.2 closed re-opens as 'one of three hardened'.",
    ).toHaveLength(9);
    expect(new Set(SOFTENING_TOKENS).size, "a token is listed twice").toBe(SOFTENING_TOKENS.length);
  });

  it("the four tokens added in 164.8.2 are still ABSENT from prod-prober.yml, so no allowlist is owed", () => {
    // The premise of the "widening this list is free" amendment (CONTEXT Area 3),
    // made executable rather than left as a dated sentence. If a legitimate site ever
    // appears here, this arm reds and the answer is an exact-set allowlist with a
    // per-site justification — the `test-restore-workflow-wiring.test.ts` shape — not
    // dropping the token from the list.
    for (const token of ["|| :", "2>/dev/null", "set +o pipefail", "|| exit 0"]) {
      expect(
        WORKFLOW_TEXT.split(token).length - 1,
        `prod-prober.yml gained a \`${token}\` site. This file has NO allowlist because the count was measured at 0 on 2026-09-09; a new site needs a justified exact-set count, not a narrower token list.`,
      ).toBe(0);
    }
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

  it("CALIBRATION (164.8.2/WR-07): renaming a slice anchor FAILS BY NAME instead of degenerating", () => {
    // ⛔ The arm above reads `permissions:` and `concurrency:` out of a SLICE
    // bounded by two `indexOf` results. Before WR-07 a rename of either key made
    // `slice` take a negative index — `slice(-1, …)` is the LAST CHARACTER,
    // `slice(…, -1)` is nearly the WHOLE file — and every regex over the result
    // reported a policy nobody had read. This is the whole class in one arm.
    const mutant = WORKFLOW_TEXT.replace("\npermissions:", "\nperms:");
    expect(mutant, "the rename must actually change the text").not.toBe(WORKFLOW_TEXT);
    expect(
      mutant.includes("\npermissions:"),
      "the mutation must actually REMOVE the anchor — a mutant that still carries it proves nothing",
    ).toBe(false);
    expect(() => policyOf(mutant)).toThrow(/ANCHOR MISSING: "\\npermissions:"/);
    // Control: the real subject still has the anchor, so the check is a check
    // and not a blanket refusal.
    expect(() => policyOf(WORKFLOW_TEXT)).not.toThrow();

    // The same discipline on the single-anchor helpers this file's predicates use.
    const noProbe = WORKFLOW_TEXT.replace("\n  probe:", "\n  prb:");
    expect(noProbe.includes("\n  probe:"), "the probe-job mutation must remove the anchor").toBe(false);
    expect(() => probeJobText(noProbe)).toThrow(/ANCHOR MISSING: "\\n {2}probe:"/);
    expect(() => probeJobText(WORKFLOW_TEXT)).not.toThrow();

    const noCredStep = WORKFLOW_TEXT.replace(
      "- name: Assert credentials are configured",
      "- name: Check credentials are configured",
    );
    expect(
      noCredStep.includes("- name: Assert credentials are configured"),
      "the credential-step mutation must remove the anchor",
    ).toBe(false);
    expect(() => credentialStepText(noCredStep)).toThrow(/ANCHOR MISSING/);
    expect(() => credentialStepText(WORKFLOW_TEXT)).not.toThrow();
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
    const selfTestBody = RUNNER_TEXT.slice(anchorIndex(RUNNER_TEXT, "export async function selfTest()"));
    expect(selfTestBody.length, "selfTest() must be findable in the source").toBeGreaterThan(1000);
    const exercised = new Set([...selfTestBody.matchAll(/kind === "([a-z0-9-]+)"/g)].map((m) => m[1]));
    expect(exercised.size, "the self-test must assert on at least one kind").toBeGreaterThan(0);
    // A typo here would silently assert on a kind that can never be reported.
    for (const k of exercised) expect(DEFECT_KINDS).toContain(k);
    const uncovered = DEFECT_KINDS.filter((k: string) => !exercised.has(k)).sort();
    expect(uncovered).toEqual([]);
  });

  it("CALIBRATION: a kind with no by-name assertion is reported UNCOVERED", () => {
    const selfTestBody = RUNNER_TEXT.slice(anchorIndex(RUNNER_TEXT, "export async function selfTest()"));
    const mutant = selfTestBody.split('kind === "mt5-probe-timeout"').join('kind === "mt5-probe-elapsed"');
    expect(mutant, "the rename must actually change the text").not.toBe(selfTestBody);
    const exercised = new Set([...mutant.matchAll(/kind === "([a-z0-9-]+)"/g)].map((m) => m[1]));
    expect(DEFECT_KINDS.filter((k: string) => !exercised.has(k))).toEqual(["mt5-probe-timeout"]);
  });

  // -------------------------------------------------------------------------
  // parseCronJobRows — the WR-05 defect, asserted directly on the function.
  //
  // ⛔ A ROW THE PARSER COULD NOT READ IS NOT A ROW THAT IS NOT THERE. A record
  // with fewer than seven fields used to be `continue`d away, so a cron.job
  // command carrying the arm's own record separator removed itself from every
  // judgement — the credential scan included — while the run still read green.
  // Both callers (the arm's run() and captureManifest) now refuse on the count.
  // -------------------------------------------------------------------------
  // ⚠️ EVERY RECORD CARRIES THE TRAILING `total` COLUMN, because `CRON_JOB_SQL`
  // does: `count(*) OVER () AS total` is the out-of-band row count, and it is
  // LAST on purpose (CR-R1-03) so the head fragment of a payload-0x1E split
  // loses it and is therefore SHORT, rather than a full-width record carrying a
  // silently truncated command.
  const cronRecord = (fields: string[], total = 2) =>
    [...fields, String(total)].join(CRON_JOB_SEPARATORS.fieldSep);
  const GOOD_RECORD = cronRecord(["1", "a_job", "* * * * *", "t", "postgres", "postgres", "SELECT 1"]);
  const SHORT_RECORD = cronRecord(["2", "b_job", "*/5 * * * *", "t", "postgres"]);
  const renderRecords = (records: string[]) =>
    // psql prints the record separator AFTER every record, last one included —
    // which is why the parser's EMPTY-record skip is correct and must stay.
    records.map((r) => `${r}${CRON_JOB_SEPARATORS.recordSep}`).join("");

  it("a record NARROWER than CRON_JOB_COLUMNS is COUNTED, never dropped (WR-05)", () => {
    const stdout = renderRecords([GOOD_RECORD, SHORT_RECORD]);
    const { rows, malformed } = parseCronJobRows(stdout);
    expect(rows.length, "the readable record still parses — one bad record does not blind the arm to the others").toBe(1);
    expect(rows[0].jobname).toBe("a_job");
    expect(malformed.length, "and the unreadable one is REPORTED rather than skipped").toBe(1);
    expect(malformed[0].fields, "by its field count, so the reader can tell where the record split").toBe(
      CRON_JOB_COLUMNS.length - 2,
    );
    expect(
      JSON.stringify(malformed),
      "and NEVER by its text — an unreadable record is exactly where a credential could be hiding",
    ).not.toContain("b_job");
  });

  it("CALIBRATION: padding that same record to full width makes it a ROW and empties the malformed list", () => {
    const original = renderRecords([GOOD_RECORD, SHORT_RECORD]);
    const padded = renderRecords([
      GOOD_RECORD,
      cronRecord(["2", "b_job", "*/5 * * * *", "t", "postgres", "postgres", "SELECT 2"]),
    ]);
    expect(padded, "the mutated stdout must actually differ, or this calibration is vacuous").not.toBe(original);
    const { rows, malformed } = parseCronJobRows(padded);
    expect(rows.length).toBe(2);
    expect(malformed).toEqual([]);
    // The predicate FLIPS on the mutated copy: the same function reports one
    // malformed record on the original and none here, so "malformed is empty"
    // is a real reading rather than something the parser always says.
    expect(parseCronJobRows(original).malformed.length).toBe(1);
  });

  it("CR-02: a record WIDER than CRON_JOB_COLUMNS is COUNTED too, never a silently TRUNCATED command", () => {
    // ⛔ THE EXACT MIRROR OF WR-05 ABOVE, AND IT IS THE WORSE DIRECTION. The
    // guard was `f.length < 7`, so an over-wide record parsed: `command` became
    // `f[6]` — the text up to the stray separator — and the remainder was
    // discarded while `malformed` stayed EMPTY, i.e. while the parser claimed
    // it had read the row. The width is the column count of `CRON_JOB_SQL`,
    // DERIVED from `CRON_JOB_COLUMNS`; anything else is a record this parser
    // did not read.
    //
    // ⚠️ THIS GUARD ALONE NEVER CLOSED THE CLASS — see the 0x1E tests below.
    // It answers a FIELD separator in the payload; a RECORD separator produced
    // fragments it could not see, which is CR-R1-03.
    const head = "SELECT net.http_post(url := 'https://x.invalid/a'";
    const tail = ", headers := jsonb_build_object('X-Service-Key', 'FAKE-inline-key-0123456789abcdef'))";
    const WIDE_RECORD = cronRecord([
      "2",
      "b_job",
      "*/5 * * * *",
      "t",
      "postgres",
      "postgres",
      `${head}${CRON_JOB_SEPARATORS.fieldSep}${tail}`,
    ]);
    const { rows, malformed } = parseCronJobRows(renderRecords([GOOD_RECORD, WIDE_RECORD]));
    expect(rows.length, "the readable record still parses — one bad record does not blind the arm to the others").toBe(1);
    expect(rows[0].jobname).toBe("a_job");
    expect(malformed.length, "and the over-wide one is REPORTED rather than truncated into a row").toBe(1);
    expect(malformed[0].fields, "by its field count, so the reader can tell how far the record over-ran").toBe(
      CRON_JOB_COLUMNS.length + 1,
    );
    expect(
      JSON.stringify(malformed),
      "and NEVER by its text — this record is a worked example of a credential hiding past the separator",
    ).not.toContain("X-Service-Key");
    // CALIBRATION: the head ALONE is clean and the whole command is not, so the
    // truncation the old guard performed was a SILENT PASS on a row carrying an
    // inline service key — not a downgrade to a weaker finding.
    expect(hygieneViolations("b_job", head)).toEqual([]);
    expect(hygieneViolations("b_job", `${head}${tail}`).length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // CR-R1-03 — A DELIMITER-BASED PARSER CANNOT SELF-VALIDATE A DELIMITER IN ITS
  // PAYLOAD. `!== 7` closed the SPELLING it was handed (a FIELD separator in a
  // command) and left the CLASS open: a RECORD separator splits one row into two
  // FRAGMENTS, and the head fragment used to carry exactly the required seven
  // fields, so the width guard could never fire on it — by construction.
  // MEASURED at the parent commit, BOTH surviving spellings reported
  // `malformed: []`, i.e. the parser claiming it had read every row.
  //
  // The answer is an OUT-OF-BAND count (`count(*) OVER () AS total`), placed
  // LAST so the head fragment loses it and the width guard bites as well. The
  // three tests below exercise the two guards SEPARATELY, so neither can stand
  // in for the other under a neuter.
  // -------------------------------------------------------------------------
  const KEY_IN_TAIL = ", headers := jsonb_build_object('X-Service-Key', 'FAKE-inline-key-0123456789abcdef'))";
  const CLEAN_HEAD = "SELECT net.http_post(url := 'https://x.invalid/a'";

  it("CR-R1-03: a 0x1E inside a command whose tail is WHITESPACE — both fragments are refused (the width guard)", () => {
    const split = cronRecord(
      ["2", "b_job", "*/5 * * * *", "t", "postgres", "postgres", `${CLEAN_HEAD}${KEY_IN_TAIL}${CRON_JOB_SEPARATORS.recordSep}   `],
      2,
    );
    const { rows, malformed, total, countMismatch } = parseCronJobRows(renderRecords([GOOD_RECORD, split]));
    // The head is SHORT because `total` is the last column and the split took
    // it with the tail — that is the whole reason for the column's position.
    expect(malformed.map((m) => m.fields), "the head lost its trailing count field, the tail is a stub").toEqual([
      CRON_JOB_COLUMNS.length - 1,
      2,
    ]);
    expect(rows.map((r) => r.jobname), "only the intact record survives as a row").toEqual(["a_job"]);
    expect(total).toBe(2);
    expect(countMismatch, "and the out-of-band count disagrees too — two independent readings, both loud").toContain(
      "but this reading yielded",
    );
  });

  it("CR-R1-03: a 0x1E whose tail is a FABRICATED well-formed record — a phantom job and a truncated real one", () => {
    // ⛔ THE ONE THAT HIDES A CREDENTIAL. The tail carries enough field
    // separators to look like a row of its own, so the real job's command is
    // truncated to the clean head while the credential is attributed to a job
    // that DOES NOT EXIST. Under `!== 7` this reported `malformed: []`.
    const FS = CRON_JOB_SEPARATORS.fieldSep;
    const fabricated = `9${FS}z_job${FS}* * * * *${FS}t${FS}postgres${FS}postgres${FS}${KEY_IN_TAIL}`;
    const split = cronRecord(
      ["3", "c_job", "*/5 * * * *", "t", "postgres", "postgres", `${CLEAN_HEAD}${CRON_JOB_SEPARATORS.recordSep}${fabricated}`],
      2,
    );
    const { rows, malformed, countMismatch } = parseCronJobRows(renderRecords([GOOD_RECORD, split]));
    expect(malformed.map((m) => m.fields), "the head is short by exactly the count column").toEqual([
      CRON_JOB_COLUMNS.length - 1,
    ]);
    // The phantom is still PRESENT in `rows` — the parser cannot know it is a
    // fragment. That is precisely why the refusal must come from the count.
    expect(rows.map((r) => r.jobname)).toEqual(["a_job", "z_job"]);
    expect(countMismatch, "2 rows in the database, 3 records in the reading — the only statement that catches it").toContain(
      "reported 2 cron.job row(s) but this reading yielded 3 record(s)",
    );
    // CALIBRATION: the real command DOES carry a credential and the truncated
    // head does NOT, so a reading that accepted the fragments would be a silent
    // PASS on an inline service key and not merely a weaker finding.
    expect(hygieneViolations("c_job", CLEAN_HEAD)).toEqual([]);
    expect(hygieneViolations("c_job", `${CLEAN_HEAD}${KEY_IN_TAIL}`).length).toBeGreaterThan(0);
  });

  it("CR-R1-03: a stdout TRUNCATED at a record boundary is caught by the COUNT ALONE — every surviving record is well-formed", () => {
    // ⭐ THE CASE THAT ISOLATES GUARD (B). Whole records are gone; nothing is a
    // fragment; `malformed` is EMPTY and every width is exactly right. The
    // field-count guard is structurally incapable of seeing this, which is what
    // makes the out-of-band count a second guard rather than a belt on a belt.
    const { rows, malformed, total, countMismatch } = parseCronJobRows(
      renderRecords([cronRecord(["1", "a_job", "* * * * *", "t", "postgres", "postgres", "SELECT 1"], 3)]),
    );
    expect(malformed, "nothing is malformed — the width guard has nothing to say here").toEqual([]);
    expect(rows.length).toBe(1);
    expect(total).toBe(3);
    expect(countMismatch).toContain("reported 3 cron.job row(s) but this reading yielded 1 record(s)");
    // CALIBRATION: the same reading with the count AGREEING is silent, so
    // "countMismatch is set" is a reading rather than a constant.
    expect(
      parseCronJobRows(renderRecords([cronRecord(["1", "a_job", "* * * * *", "t", "postgres", "postgres", "SELECT 1"], 1)]))
        .countMismatch,
    ).toBeNull();
  });

  it("CR-R1-03: CRON_JOB_SQL asks for the out-of-band count, and CRON_JOB_COLUMNS is the single source of the required width", () => {
    // ⛔ THE QUERY AND THE PARSER MUST NOT DRIFT. A width the parser requires
    // and a column list the query does not send is a reading that refuses
    // everything; the reverse is a reading that refuses nothing.
    expect(CRON_JOB_SQL).toContain("count(*) OVER () AS total");
    expect(CRON_JOB_COLUMNS[CRON_JOB_COLUMNS.length - 1], "the count is LAST — see CR-R1-03 in the arm").toBe("total");
    for (const col of CRON_JOB_COLUMNS.slice(0, -1)) expect(CRON_JOB_SQL).toContain(col);
    // The parser requires exactly this width — asserted by construction rather
    // than by a literal, so criterion 9 holds.
    const full = cronRecord(["1", "a_job", "* * * * *", "t", "postgres", "postgres", "SELECT 1"], 1);
    expect(full.split(CRON_JOB_SEPARATORS.fieldSep).length).toBe(CRON_JOB_COLUMNS.length);
    expect(parseCronJobRows(renderRecords([full])).malformed).toEqual([]);
  });

  it("IN-R1-03: the main-module guard compares REAL PATHS, not a filename suffix", () => {
    // ⛔ THE MIRROR OF THE `[VAC04-C2]` LESSON ITS SIBLING DOCUMENTS. That guard
    // no-ops on a symlinked or space-bearing path and silently turns the CLI
    // into a library; `argv[1].endsWith("run.mjs")` over-fires instead — ANY
    // process whose argv[1] merely ENDS WITH `run.mjs`, including a future
    // `scripts/<other>/run.mjs` that imports this module, would execute this
    // CLI and call `process.exit`. Introduced in 42868a9b, not by this pass.
    const runnerText = readFileSync(RUNNER_PATH, "utf8");
    expect(runnerText, "the suffix test must be GONE, not merely joined by a better one").not.toContain(
      'process.argv[1].endsWith("run.mjs")',
    );
    expect(runnerText).toContain("function invokedDirectly()");
    expect(runnerText).toContain("if (invokedDirectly()) {");
    // ⭐ IT IS THE SAME IDIOM AS THE SIBLING GATE, BYTE FOR BYTE at the line
    // that does the work — one repository, one answer to "was I run directly".
    const gucText = readFileSync(join(REPO_ROOT, "scripts", "lint-app-guc.mjs"), "utf8");
    const CORE = "return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));";
    expect(gucText, "PRECONDITION: the sibling really carries the idiom this one adopted").toContain(CORE);
    expect(runnerText).toContain(CORE);
    // CALIBRATION: the predicate finds what it forbids, so the `not` above is a
    // reading rather than a regex that matches nothing.
    expect(`${runnerText}\nif (process.argv[1].endsWith("run.mjs")) {}`).toContain(
      'process.argv[1].endsWith("run.mjs")',
    );
  });

  it("IN-R1-03: an UNPARSABLE jobid is refused by captureManifest, never serialised as null", () => {
    // ⛔ `JSON.stringify(NaN)` IS `null`. `Number.parseInt("", 10)` is NaN, so a
    // row whose jobid could not be read would have been written into the oracle
    // as `"jobid": null` — and the next reader takes that null as the captured
    // truth. jobid is deliberately NOT compared by compareManifest, but it IS
    // printed beside every drift line so an operator can run `WHERE jobid = …`,
    // which is exactly the use a null defeats.
    expect(JSON.stringify({ jobid: Number.parseInt("", 10) }), "the mechanism, stated as a measurement").toBe(
      '{"jobid":null}',
    );
    const runnerText = readFileSync(RUNNER_PATH, "utf8");
    expect(runnerText).toContain("carry a jobid that is not an integer");
    expect(runnerText, "the guard must run BEFORE the map that would serialise it").toContain(
      "const badJobids = rows.filter(",
    );
    // The serialiser no longer reads the raw field directly.
    expect(runnerText).not.toContain("jobid: Number.parseInt(r.jobid, 10)");
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

  it("every hygiene-bypass row names rule ids that EXIST, and a misspelled id is caught", () => {
    // The bypass fixture's `expect_any_of` is what the self-test scenario
    // measures each row against. An id that no longer exists — renamed rule,
    // typo — would make that assertion unsatisfiable in the silent direction,
    // so the id set is checked against the arm's own list here.
    const rows: Array<{ jobname: string; expect_any_of: string[] }> = JSON.parse(
      readFileSync(join(PROBER_DIR, "fixtures", "cron-drift", "hygiene-bypass.json"), "utf8"),
    );
    expect(rows.length).toBeGreaterThan(0);
    const unknown = (rs: Array<{ expect_any_of: string[] }>) =>
      rs.flatMap((r) => (r.expect_any_of || []).filter((id) => !HYGIENE_RULE_IDS.includes(id)));
    for (const r of rows) expect(r.expect_any_of?.length, r.jobname).toBeGreaterThan(0);
    expect(unknown(rows)).toEqual([]);

    // CALIBRATION: the check above must be able to fail. Misspell one id on a
    // COPY and assert the same predicate reports it.
    const mutated = JSON.parse(JSON.stringify(rows));
    mutated[0].expect_any_of[0] = `${mutated[0].expect_any_of[0]}-typo`;
    expect(JSON.stringify(mutated)).not.toBe(JSON.stringify(rows));
    expect(unknown(mutated).length).toBeGreaterThan(0);
  });

  it("a header NAME inside a comment is not an anchor, and removing the comment marker makes it one", () => {
    // ⛔ D7's trap, calibrated in both directions. The header name is itself a
    // string literal, so it is BLANK in `scanSql`'s mask and cannot be matched
    // there; it is matched on the raw text and then CONFIRMED at the same index
    // on the mask. Without that confirmation, a name sitting in a `--` comment
    // — or inside a bigger literal — would anchor the rule and a long literal
    // somewhere else entirely would be reported as a header credential.
    //
    // ⚠️ THE FIXTURE SHAPE IS LOAD-BEARING AND WAS CHOSEN BY MEASUREMENT. An
    // anchor sitting in a comment with NO real code after it is already clean
    // for a second reason — the value walk runs on the mask, where the comment
    // is blank — so such a fixture passes even with this control removed and
    // proves nothing. Here the comment ENDS at the newline and real code with a
    // long literal follows, which is the case only the mask CONFIRMATION
    // catches. PROBED: with `masked[m.index] !== "'"` neutered, the first
    // command below fires `x-service-key-literal`.
    const commented = "SELECT id FROM t -- 'X-Service-Key',\n WHERE k = 'FAKE-key-0123456789ab'";
    // The SAME text with only the comment marker removed, so the anchor is code.
    const uncommented = commented.replace(" -- ", "    ");
    expect(uncommented).not.toBe(commented);

    const ids = (cmd: string) =>
      hygieneViolations("fixture_anchor_job", cmd).map((v: string) => v.slice(1, anchorIndex(v, "]")));
    expect(ids(commented)).not.toContain("x-service-key-literal");
    expect(ids(uncommented)).toContain("x-service-key-literal");
  });

  it("a command that is NOT A STRING is REFUSED, never judged clean — the second spelling of CR-R1-02's class", () => {
    // ⛔ THE SAME INVARIANT AS CR-R1-02, ONE LAYER DOWN. `hygieneViolations`
    // opened with `String(command ?? "")`, so `undefined`, `null` and a number
    // all became the EMPTY command — which trips no rule and therefore returned
    // `[]`, byte-identical to the answer for "judged, and clean". MEASURED
    // 2026-09-11 before the fix: all four of the calls below returned `[]`.
    //
    // The manifest side had its own totality check (a row whose `command` is
    // not a string is a WITHHELD row and is skipped deliberately). The PROD
    // side — the one read live out of a database — had nothing.
    //
    // ⭐ IT MUST THROW rather than return a violation id: that is how every
    // other refusal in this function is spelled, and both callers already route
    // a throw to a per-row `measure-fail` rather than to a credential finding.
    for (const bad of [undefined, null, 12345, { toString: () => "SELECT 1" }] as unknown[]) {
      expect(() => hygieneViolations("a_job", bad as string), `command ${String(bad)} must be refused`).toThrow(
        /not a string/,
      );
    }
    // CALIBRATION: a real string on the same call path is judged rather than
    // refused, so "it throws" is a reading about the TYPE and not something
    // this function now always does.
    expect(hygieneViolations("a_job", "SELECT 1")).toEqual([]);
  });

  it("an ABSENT jobname is an ADDITIVE refusal, never a substitutive one — every other rule still runs and still reports (CR-R2-01)", () => {
    // ⛔ THE THIRD TIME THIS PHASE SHIPPED A GUARD THAT CLOSED ITS OWN
    // REPRODUCTION AND LEFT THE CLASS OPEN. Round 1 made an absent jobname
    // THROW, beside the non-string-command throw above. A throw here is
    // REPLACEMENT: `compareManifest` routes it to a per-row `measure-fail` and
    // `continue`s, so NO credential rule ran for that row.
    //
    // ⛔ AND IT NEEDED NO ADVERSARY. `cron.job.jobname` is NULLable; pg_cron's
    // TWO-ARGUMENT `cron.schedule(schedule, command)` leaves it NULL; `psql
    // -At` renders NULL as the empty string. It was also a one-step off-switch
    // (`cron.unschedule` then the two-arg `cron.schedule`).
    //
    // ⛔ THE SCOPE ARGUMENT DID NOT SUPPORT THE BLAST RADIUS: the jobname
    // scopes exactly ONE rule (`vault-absent`, gated on
    // `name === "match_engine_cron"`), and the refusal disabled every rule in
    // `HYGIENE_RULE_IDS`. THE ASYMMETRY WITH THE TEST ABOVE IS THE POINT — a
    // non-string COMMAND cannot be scanned at all; a nameless row can be
    // scanned completely except for the one rule keyed on the name.
    const ids = (jobname: unknown, cmd: string) =>
      hygieneViolations(jobname as string, cmd).map((v: string) => v.slice(1, anchorIndex(v, "]")));
    // 39 characters, digit-bearing, split into short operands so no
    // credential-shaped token is typed whole into a PUBLIC repo.
    const KEY = `FAKE-0123456789${"-0123456789"}${"-0123456789ab"}`;
    const leaky = `SELECT net.http_post(url := 'https://x.invalid/a', headers := jsonb_build_object('X-Service-Key', '${KEY}'));`;

    // CONTROL — the same command under a jobname. This is the reading the
    // unnamed spellings must not fall short of.
    expect(ids("named_job", leaky)).toEqual(["x-service-key-literal", "long-literal-in-headers"]);

    // ⭐ EVERY SPELLING OF "NO JOBNAME" REPORTS THE CREDENTIAL, plus the
    // refusal. Before the fix each of these THREW and the credential was never
    // named at all.
    for (const absent of ["", "   ", null, undefined, 12345] as unknown[]) {
      expect(ids(absent, leaky), `jobname ${String(absent)} must still name the credential`).toEqual([
        "jobname-absent",
        "x-service-key-literal",
        "long-literal-in-headers",
      ]);
    }

    // CALIBRATION THE OTHER WAY: the refusal is not a blanket finding — a clean
    // command under an absent jobname reports the refusal ALONE, which is what
    // keeps `hygiene-red.json`'s `jobname-absent` row one-rule isolated.
    expect(ids("", "SELECT 1")).toEqual(["jobname-absent"]);
    // …and a NAMED row never carries it, so the id cannot become noise.
    expect(ids("a_job", "SELECT 1")).toEqual([]);

    // ⛔ IT IS A REFUSAL, NOT A CREDENTIAL RULE: it must route to
    // `measure-fail`, never to a rotation remedy. `splitHygiene` is the single
    // place that partition is made.
    const { credential, unjudgeable } = splitHygiene(hygieneViolations("", leaky));
    expect(unjudgeable.map((v: string) => v.slice(1, anchorIndex(v, "]")))).toEqual(["jobname-absent"]);
    expect(credential.map((v: string) => v.slice(1, anchorIndex(v, "]")))).toEqual([
      "x-service-key-literal",
      "long-literal-in-headers",
    ]);
  });

  it("TOKEN_MIN equals HEADERS_LITERAL_MAX — ONE of the two conditions the Q2 region partition needs; the other is that the header measurement actually COUNTED the literal, asserted separately below", () => {
    // ⛔ THE INVARIANT, NOT THE VALUE. `long-token-anywhere` deliberately
    // EXCLUDES header regions so it cannot collide with
    // `long-literal-in-headers` on a red row. That exclusion needs
    // `TOKEN_MIN >= HEADERS_LITERAL_MAX`: a whitespace-delimited token of
    // `TOKEN_MIN` characters lives inside a literal of at least that length,
    // which is an argument of at least `HEADERS_LITERAL_MAX` DERIVED length,
    // which is precisely what `long-literal-in-headers` fires on. Raise
    // `HEADERS_LITERAL_MAX` to 40 in some later phase and a 32-39 character
    // digit-bearing token inside a header region is caught by NOBODY, silently.
    // The `header_region_only` bypass row measures today's values; THIS pins the
    // relation.
    //
    // Equality rather than `>=`: `>=` is what the partition needs, equality is
    // what the DERIVATION in cron-drift.mjs says
    // (`export const TOKEN_MIN = HEADERS_LITERAL_MAX;`), and a divergence in
    // either direction is a decision somebody must make on purpose.
    expect(TOKEN_MIN).toBe(HEADERS_LITERAL_MAX);

    // ⭐ AND IT IS ONE SOURCE OF TRUTH BY SOURCE LINE, not merely two literals
    // that happen to agree at runtime. A second `32` would satisfy the
    // assertion above and re-open the drift it exists to close.
    const armText = readFileSync(join(PROBER_DIR, "arms", "cron-drift.mjs"), "utf8");
    expect(armText).toContain("export const TOKEN_MIN = HEADERS_LITERAL_MAX;");
    expect(armText).toContain("export const HEADERS_LITERAL_MAX = 32;");
    // CALIBRATION: the same predicate reports the literal spelling, so
    // "the derivation is present" is a reading and not a tautology.
    const mutated = armText.replace(
      "export const TOKEN_MIN = HEADERS_LITERAL_MAX;",
      "export const TOKEN_MIN = 32;",
    );
    expect(mutated).not.toBe(armText);
    expect(mutated).not.toContain("export const TOKEN_MIN = HEADERS_LITERAL_MAX;");
  });

  it("CR-R1-01: the header-region exclusion is conditional on the literal having been COUNTED, not on it merely being LOCATED in a region", () => {
    // ⛔ THE SECOND CONDITION THE PARTITION NEEDS, AND THE ONE THE TITLE ABOVE
    // USED TO OVERSTATE AWAY. `TOKEN_MIN >= HEADERS_LITERAL_MAX` is necessary
    // and NOT sufficient: `derivedLiteralLength` deliberately refuses to enter
    // `(SELECT …)` and skips whole any `(` whose callee is not in `BUILDERS`,
    // so a literal behind either derives 0 — the three anchored header rules
    // measure 0 < HEADER_LITERAL_MIN, `long-literal-in-headers` does not fire,
    // and `long-token-anywhere` had been switched off for that whole region.
    //
    // ⛔ AND THE SHAPE IS ORDINARY CODE. MEASURED 2026-09-11 before the fix,
    // every row below except the two CONTROLs returned `[]` from every rule in
    // `HYGIENE_RULE_IDS`, and captureManifest then WROTE the key into the
    // oracle committed to a public repository.
    const KEY = `FAKE-${"abcdef0123"}${"456789abcd"}${"ef0123456789"}`;
    expect(KEY.length, "the fixture key must be over TOKEN_MIN or this test proves nothing").toBeGreaterThan(TOKEN_MIN);
    const ids = (cmd: string) => hygieneViolations("a_job", cmd).map((x) => x.slice(1, anchorIndex(x, "]")));
    const header = (value: string) =>
      `SELECT net.http_post(url := 'https://x.invalid/a', headers := jsonb_build_object('Content-Type','application/json','X-Service-Key', ${value}));`;

    // Every wrapper `derivedLiteralLength` refuses to descend into.
    for (const wrapped of [`coalesce(nullif(v_key,''), '${KEY}')`, `nullif('${KEY}', '')`, `(SELECT '${KEY}')`, `util_wrap('${KEY}')`]) {
      expect(ids(header(wrapped)), `an uncounted literal under an anchored header name must be NAMED by a rule: ${wrapped}`).toContain(
        "long-token-anywhere",
      );
    }

    // CONTROL 1 — a literal the header walk DID count keeps belonging to
    // `long-literal-in-headers` ALONE. Without this the "fix" would be a
    // collision that breaks every red row's one-rule isolation.
    expect(ids(header(`'${KEY}'`))).toContain("long-literal-in-headers");
    expect(ids(header(`'${KEY}'`)), "a COUNTED header literal must NOT also fire the token rule — that is the Q2 partition").not.toContain(
      "long-token-anywhere",
    );
    // CONTROL 2 — the same wrapper outside any header region always fired, so
    // the rows above are a reading about the REGION and not about coalesce().
    expect(ids(`SELECT net.http_post(url := 'https://x.invalid/a', body := coalesce(nullif(v_key,''), '${KEY}')::jsonb);`)).toContain(
      "long-token-anywhere",
    );
  });

  it("BARE_URL_RE exempts a bare URL and NOTHING that carries a token or credentials", () => {
    // ⛔ THE EXEMPTION IS THE RULE'S ONLY WAY TO BE WRONG IN THE QUIET
    // DIRECTION. `long-token-anywhere` skips bare URLs because the committed
    // corpus carries one 79-character analytics URL and firing on it every hour
    // would train the reader to ignore the whole class. Widen the pattern by one
    // character class and `…?token=<key>` — a real way a key reaches a cron
    // command — becomes exempt too.
    const RAILWAY =
      "https://quantalyze-analytics-production.up.railway.app/api/match/cron-recompute-0123456789";
    expect(BARE_URL_RE.test(RAILWAY)).toBe(true);
    expect(BARE_URL_RE.test("https://x.invalid/a?token=1")).toBe(false);
    expect(BARE_URL_RE.test("https://u:p1@x.invalid/")).toBe(false);
    expect(BARE_URL_RE.test("https://x.invalid:8443/a/b")).toBe(true);

    // CALIBRATION: a mutant that allows `?` flips the query-string case while
    // leaving the bare URL exempt — so the `false` above is this pattern's
    // reading rather than something every URL regex would say.
    const loosened = new RegExp(BARE_URL_RE.source.replace("._~/-", "._~/?=-"));
    expect(loosened.source).not.toBe(BARE_URL_RE.source);
    expect(loosened.test("https://x.invalid/a?token=1")).toBe(true);
    expect(loosened.test(RAILWAY)).toBe(true);
  });

  it("CR-04: the exemption is `isBareUrl`, not `BARE_URL_RE` — a credential in a PATH SEGMENT is not a bare URL", () => {
    // ⛔ THE DOCSTRING REASONED ABOUT `?`, `#` AND `user:pw@` AND NEVER ABOUT
    // THE PATH — which is the commonest webhook-token shape there is. Every
    // character of a `FAKE-0123…` credential is inside `BARE_URL_RE`'s own path
    // charset, so `https://hook.invalid/t/<token>` MATCHED and was exempted,
    // while the query-string spelling of the same credential fired. Both
    // directions were reproduced before the fix.
    const TOKEN = `FAKE${"-0123456789"}${"-0123456789"}${"-0123456789ab"}`;
    const PATH_FORM = `https://hook.invalid/t/${TOKEN}`;
    // The shape test still says "this looks like a URL" — which is precisely
    // why it could not be the exemption on its own.
    expect(BARE_URL_RE.test(PATH_FORM), "the raw shape test is still fooled, and always was").toBe(true);
    expect(isBareUrl(PATH_FORM), "the EXEMPTION is not").toBe(false);

    // The one URL the exemption exists for stays exempt, or the false-positive
    // budget on the committed corpus goes from zero to one.
    const RAILWAY = "https://quantalyze-analytics-production.up.railway.app/api/match/cron-recompute";
    expect(isBareUrl(RAILWAY)).toBe(true);
    expect(isBareUrl("https://x.invalid:8443/a/b")).toBe(true);
    expect(isBareUrl("https://x.invalid/a?token=1"), "and everything BARE_URL_RE already rejected stays rejected").toBe(
      false,
    );

    // ⛔ THE SEGMENT THRESHOLD IS `TOKEN_MIN`, DERIVED. Calibrated in both
    // directions ON THE BOUNDARY so the number is measured, not asserted: one
    // character under is exempt, exactly at it is not.
    const digitSeg = (n: number) => `https://hook.invalid/${"a1".repeat(Math.ceil(n / 2)).slice(0, n)}`;
    expect(isBareUrl(digitSeg(TOKEN_MIN - 1)), `a ${TOKEN_MIN - 1}-character segment is still a path`).toBe(true);
    expect(isBareUrl(digitSeg(TOKEN_MIN)), `a ${TOKEN_MIN}-character segment is a credential`).toBe(false);
    // …and the DIGIT half of the rule's own test applies to a segment too: a
    // purely alphabetic segment of any length stays exempt, exactly as a purely
    // alphabetic token does (the A2 residual, unchanged).
    expect(isBareUrl(`https://hook.invalid/${"a".repeat(TOKEN_MIN + 8)}`)).toBe(true);

    // ⛔ WR-R1-02 — THE UUID SEGMENT, CALIBRATED IN BOTH DIRECTIONS. A UUID is
    // 36 characters and contains digits, so before this narrowing EVERY
    // resource-scoped REST path failed the exemption and fired a rule whose
    // remedy is "treat the named secret as EXPOSED and rotate it first". The
    // exemption is the CANONICAL 8-4-4-4-12 layout and nothing looser, so it
    // cannot absorb an opaque key of the same length.
    const UUID = "123e4567-e89b-12d3-a456-426614174000";
    expect(UUID.length, "the two sides of this calibration must be the SAME LENGTH or it proves nothing").toBe(36);
    expect(isBareUrl(`https://x.invalid/api/strategies/${UUID}`), "an ordinary resource-scoped REST path is NOT a credential").toBe(
      true,
    );
    const OPAQUE = `FAKE-${"a1".repeat(16)}`.slice(0, 36);
    expect(OPAQUE.length).toBe(36);
    expect(CANONICAL_UUID_RE.test(OPAQUE), "the control segment must NOT be a UUID or the calibration is vacuous").toBe(false);
    expect(isBareUrl(`https://x.invalid/api/strategies/${OPAQUE}`), "a same-length OPAQUE segment still fires").toBe(false);
    // And the layout is load-bearing, not the charset: shifting one hyphen by a
    // single character breaks the exemption.
    expect(isBareUrl(`https://x.invalid/api/strategies/${UUID.replace("-e89b-", "e89b--")}`)).toBe(false);

    // End to end through the rule, both spellings of the same credential.
    const ids = (cmd: string) => hygieneViolations("j", cmd).map((x) => x.slice(1, anchorIndex(x, "]")));
    expect(ids(`DO $$ BEGIN PERFORM net.http_post(url := '${PATH_FORM}'); END $$`)).toContain("long-token-anywhere");
    expect(ids(`DO $$ BEGIN PERFORM net.http_post(url := 'https://hook.invalid/a?token=${TOKEN}'); END $$`)).toContain(
      "long-token-anywhere",
    );
  });

  it("WR-R2-01: a credential in a HOST LABEL is not a bare URL either — CR-04's question, asked of the AUTHORITY", () => {
    // ⛔ CR-04 CLOSED THE PATH HALF AND THE AUTHORITY HALF WAS LEFT OPEN, WHILE
    // TWO DOCSTRINGS ASSERTED IT WAS CLOSED — one of them literally "the
    // exemption can never be the reason a credential goes unreported". A host
    // label matches `[A-Za-z0-9.-]+` in full, so every character of an opaque
    // key is inside `BARE_URL_RE`'s own authority charset: byte-for-byte the
    // CR-04 defect moved LEFT of the first `/`.
    //
    // MEASURED on the parent commit: `isBareUrl('https://<39-char key>.invalid/a')`
    // was `true` and the command reported `[]` from every rule, while the same
    // key in a path segment and the same key bare both fired.
    const TOKEN = `FAKE${"-0123456789"}${"-0123456789"}${"-0123456789ab"}`;
    const HOST_FORM = `https://${TOKEN}.invalid/a`;
    expect(BARE_URL_RE.test(HOST_FORM), "the raw shape test is fooled here too, and always was").toBe(true);
    expect(isBareUrl(HOST_FORM), "the EXEMPTION is not").toBe(false);

    // Both directions, ON THE BOUNDARY, so the threshold is measured rather
    // than asserted — and it is the SAME `TOKEN_MIN` the path half uses.
    const digitLabel = (n: number) => `https://${"a1".repeat(Math.ceil(n / 2)).slice(0, n)}.invalid/a`;
    expect(isBareUrl(digitLabel(TOKEN_MIN - 1)), `a ${TOKEN_MIN - 1}-character host label is still a host`).toBe(true);
    expect(isBareUrl(digitLabel(TOKEN_MIN)), `a ${TOKEN_MIN}-character host label is a credential`).toBe(false);
    // The digit half applies to a label too (the A2 residual, unchanged).
    expect(isBareUrl(`https://${"a".repeat(TOKEN_MIN + 8)}.invalid/a`)).toBe(true);

    // ⛔ THE COMMITTED URL'S LONGEST LABEL IS 31 — ONE UNDER `TOKEN_MIN`. The
    // margin is measured here rather than trusted, because the FP budget on the
    // committed corpus depends on it and `TOKEN_MIN` (3) already names this
    // one-character fragility as the rule's stated hazard.
    const RAILWAY = "https://quantalyze-analytics-production.up.railway.app/api/match/cron-recompute";
    const labels = RAILWAY.replace(/^https?:\/\//, "").split("/")[0].split(".");
    expect(Math.max(...labels.map((l) => l.length))).toBe(TOKEN_MIN - 1);
    expect(isBareUrl(RAILWAY), "so the one URL the exemption exists for stays exempt").toBe(true);

    // A PORT is not a token: `app:8443` is judged as the label `app`.
    expect(isBareUrl("https://x.invalid:8443/a/b")).toBe(true);

    // End to end through the rule — and the two CONTROLs that make the reading
    // attributable: the same key bare, and the same key in a path segment.
    const ids = (cmd: string) => hygieneViolations("j", cmd).map((x) => x.slice(1, anchorIndex(x, "]")));
    expect(ids(`PERFORM net.http_post(url := '${HOST_FORM}');`)).toEqual(["long-token-anywhere"]);
    expect(ids(`PERFORM foo('${TOKEN}');`)).toEqual(["long-token-anywhere"]);
    expect(ids(`PERFORM net.http_post(url := 'https://x.invalid/t/${TOKEN}');`)).toEqual(["long-token-anywhere"]);
  });

  it("WR-R2-07: an ordinary URL in PROSE does not fire a rotation remedy, and the same URL carrying a key still does", () => {
    // ⛔ A ZERO-FP-BUDGET LEAK WITH A "ROTATE THE EXPOSED SECRET" REMEDY.
    // `BARE_URL_RE` is anchored `^…$` and the exemption was applied to the whole
    // whitespace-delimited token, so any adjacent character outside the path
    // charset `[A-Za-z0-9._~/-]` destroyed it. `.` is in that charset; `,` `)`
    // `;` `'` are not. MEASURED on the parent commit, prose carrying no
    // credential anywhere, hourly against real PROD commands.
    const ids = (cmd: string) => hygieneViolations("j", cmd).map((x) => x.slice(1, anchorIndex(x, "]")));
    const URL_ = "https://api.example.com/v1/ingest";
    expect(URL_.length).toBeGreaterThanOrEqual(TOKEN_MIN);
    expect(/\d/.test(URL_), "the URL must carry a digit or this calibration is vacuous").toBe(true);

    expect(ids(`DO $b$ BEGIN RAISE NOTICE 'see ${URL_}, then retry'; END $b$`)).toEqual([]);
    expect(ids(`SELECT 'endpoint (${URL_})';`)).toEqual([]);
    expect(ids(`SELECT 'see ${URL_}; retry';`)).toEqual([]);
    // CONTROL — the same URL with nothing glued to it was already clean, so the
    // three readings above measure the TRIM and not the URL.
    expect(ids(`SELECT 'endpoint ${URL_}';`)).toEqual([]);

    // ⛔ THE OTHER DIRECTION, AND IT IS THE ONE THAT MATTERS: trimming is for
    // the EXEMPTION only. The length test still reads the real token, and a URL
    // whose PATH SEGMENT is a credential still fires with punctuation attached.
    const TOKEN = `FAKE${"-0123456789"}${"-0123456789"}${"-0123456789ab"}`;
    expect(ids(`PERFORM net.http_post(url := 'https://hook.invalid/t/${TOKEN},');`)).toEqual(["long-token-anywhere"]);
    expect(ids(`SELECT 'key (${TOKEN})';`)).toEqual(["long-token-anywhere"]);
    expect(ids(`SELECT 'see https://${TOKEN}.invalid/a, then retry';`)).toEqual(["long-token-anywhere"]);
  });

  it("WR-R2-05: the dollar-depth refusal is additive AT EVERY OFFSET — reordering two statements cannot silence a credential", () => {
    // ⛔ WR-R1-03 MADE THE REFUSAL ADDITIVE AT THE CALL SITE AND LEFT IT
    // SUBSTITUTIVE INSIDE THE RECURSION. `codeSpans` threw from within its own
    // walk, so the PARENT's remaining `dollarRegions` loop and its entire
    // single-quoted-body walk were abandoned — everything not yet pushed was
    // lost, not merely the too-deeply-nested body.
    //
    // MEASURED on the parent commit:
    //   SIBLING then DEEP -> ["command-unjudgeable","x-service-key-literal","long-literal-in-headers"]
    //   DEEP then SIBLING -> ["command-unjudgeable"]                 <-- credential NOT named
    // and `command-unjudgeable` is in UNJUDGEABLE_RULE_IDS, so the row routed
    // to `measure-fail` with no rotation remedy. Order-dependence in a refusal
    // is the substitutive bug wearing a different hat.
    const ids = (cmd: string) => hygieneViolations("j", cmd).map((x) => x.slice(1, anchorIndex(x, "]")));
    const KEY = `FAKE-0123456789${"-0123456789"}${"-0123456789ab"}`;
    // Six nested DO bodies, carrying NO credential — it is the depth alone that
    // makes the lexer give up.
    const DEEP = "DO $t5$ DO $t4$ DO $t3$ DO $t2$ DO $t1$ DO $t0$ PERFORM noop(); $t0$ $t1$ $t2$ $t3$ $t4$ $t5$";
    // An ordinary depth-1 DO body carrying the inline key. Nothing exotic.
    const SIB = `DO $y$ BEGIN PERFORM net.http_post(url := 'https://x.invalid/a', headers := jsonb_build_object('X-Service-Key', '${KEY}')); END $y$`;

    const EXPECTED = ["command-unjudgeable", "x-service-key-literal", "long-literal-in-headers"];
    // CONTROLs first, so the two readings below are attributable.
    expect(ids(`${SIB};`), "the sibling alone names the credential").toEqual([
      "x-service-key-literal",
      "long-literal-in-headers",
    ]);
    expect(ids(`${DEEP};`), "the deep block alone is the refusal and nothing else").toEqual(["command-unjudgeable"]);

    // ⭐ THE INVARIANT: the SAME two statements, either order, the SAME verdict.
    expect(ids(`${SIB}; ${DEEP};`)).toEqual(EXPECTED);
    expect(ids(`${DEEP}; ${SIB};`)).toEqual(EXPECTED);

    // ⚠️ THE RESIDUAL, AT ITS REAL WIDTH AND MEASURED RATHER THAN ARGUED: a
    // credential INSIDE the too-deep body is still unreported. Those spans were
    // never read and `command-unjudgeable` is the honest verdict about them.
    // FIX-R1 recorded this residual with the key in the OUTER command, which is
    // `spans[0]` and could never have been lost — so it measured the wrong
    // thing. This assertion pins the residual where it actually lives, so a
    // future narrowing of MAX_DOLLAR_DEPTH's blast radius has a red surface.
    const DEEPKEY = `DO $t5$ DO $t4$ DO $t3$ DO $t2$ DO $t1$ DO $t0$ PERFORM foo('${KEY}'); $t0$ $t1$ $t2$ $t3$ $t4$ $t5$`;
    expect(ids(`${DEEPKEY};`)).toEqual(["command-unjudgeable"]);
  });

  it("WR-R2-02: a jobname NOBODY recorded a verdict for is UNJUDGED, never judged-and-clean", () => {
    // ⛔ THE CONTROL THAT COULD NOT FAIL. `164.8.5-FIX-R1-SUMMARY.md` presented
    // `?? UNRECORDED` as the durable half of CR-R1-02's closure — "a future
    // third producer that forgets to record cannot re-open this hole". Nothing
    // could observe it: MEASURED 2026-09-11, neutering it back to
    // `?? { judged: true, violations: [], reason: null }` (the exact pre-fix
    // coercion) left the self-test at 73/73 and vitest at 118/118.
    //
    // It is unreachable from TODAY'S two producers by construction — the PROD
    // loop records for every row before any `continue`, and the only manifest
    // rows skipped are `typeof row.command !== "string"`, which is byte-for-byte
    // the `withheld` predicate whose branch is taken first.
    //
    // ⭐ THE FIX IS A SURFACE, NOT A DELETION. Deleting the default would make
    // the consumer crash on `undefined.judged` — a defence traded for a latent
    // TypeError. What was wrong was presenting an unfalsifiable line as
    // coverage, so the helper is exported and its CONTRACT is pinned here.
    expect(hygieneVerdict(new Map(), "a_job")).toEqual({
      judged: false,
      violations: [],
      reason: "no hygiene verdict was recorded for this row at all",
    });
    expect(hygieneVerdict(new Map(), "a_job").judged, "absence is NOT a pass").toBe(false);
    // …and it is the shared frozen sentinel, so a consumer cannot mutate the
    // default into a pass for every later reader.
    expect(hygieneVerdict(new Map(), "a_job")).toBe(UNRECORDED_VERDICT);
    expect(Object.isFrozen(UNRECORDED_VERDICT)).toBe(true);

    // CALIBRATION: a RECORDED verdict is returned unchanged, so "unjudged" is a
    // reading about absence rather than something this helper always says.
    const clean = { judged: true, violations: [], reason: null };
    const dirty = { judged: true, violations: ["[x-service-key-literal] …"], reason: null };
    const refused = { judged: false, violations: [], reason: "the functions snapshot is absent" };
    const map = new Map<string, typeof clean>([
      ["clean_job", clean],
      ["dirty_job", dirty],
      ["refused_job", refused],
    ]);
    expect(hygieneVerdict(map, "clean_job")).toBe(clean);
    expect(hygieneVerdict(map, "dirty_job")).toBe(dirty);
    expect(hygieneVerdict(map, "refused_job")).toBe(refused);
    // The three are pairwise distinguishable, which is the whole point of
    // recording a VERDICT rather than a bare array.
    expect(hygieneVerdict(map, "clean_job").judged).toBe(true);
    expect(hygieneVerdict(map, "refused_job").judged).toBe(false);
    expect(hygieneVerdict(map, "clean_job").violations).toHaveLength(0);
    expect(hygieneVerdict(map, "dirty_job").violations).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // PROVENANCE TEXT READ AS A CREDENTIAL — found by the parallel hunt, not by
  // the review, and IMMINENT rather than theoretical.
  //
  // WR-R1-01 gave `long-token-anywhere` a second producer — comment bodies —
  // and comments are where PROVENANCE lives. MEASURED 2026-09-11, every one of
  // these fired a rule whose remedy is "treat the named secret as EXPOSED and
  // rotate it first", on text carrying no credential at all: a migration
  // filename, a git sha, a phase-directory name, a bare UUID, a GitHub commit
  // URL.
  //
  // ⚠️ `retention_compute_jobs_orphaned_running` lexes to a pure comment and is
  // clean today only because its one long token, `CANARY_162_V1_PROSE_ONLY`, is
  // 24 characters — EIGHT under TOKEN_MIN. That row has a pending PROD
  // re-capture; one migration filename in the re-captured text makes
  // `captureManifest` exit 1 under "Rotate the exposed secret" and write
  // nothing.
  //
  // ⛔ TWO EXEMPTIONS, TWO `it()`s, because they are TWO EDITS. A single test
  // covering both would credit one RED to two controls — the shape WR-R2-03 was
  // filed for.
  // -------------------------------------------------------------------------
  const PROV_MIGRATION = "20260907130000_ledger_refresh_switch_to_system_flags.sql";
  const PROV_UUID = "123e4567-e89b-12d3-a456-426614174000";
  const PROV_KEY = `FAKE-0123456789${"-0123456789"}${"-0123456789ab"}`;
  const provIds = (cmd: string) => hygieneViolations("j", cmd).map((x) => x.slice(1, anchorIndex(x, "]")));

  it("PROVENANCE 1/2: a CANONICAL UUID is not a credential, in a comment or in a literal", () => {
    // ⛔ `isBareUrl` has exempted a UUID since WR-R1-02 — but ONLY as a
    // `/`-delimited PATH SEGMENT, so `-- strategy 123e4567-…` fired while
    // `https://x/api/strategies/123e4567-…` did not. Same shape, same argument
    // (fixed length, fixed 8-4-4-4-12 layout, cannot absorb an opaque key), two
    // answers. Hoisted so the three producers give ONE answer.
    expect(PROV_UUID.length).toBe(36);
    expect(provIds(`-- strategy ${PROV_UUID}\nSELECT 1;`)).toEqual([]);
    expect(provIds(`SELECT 'strategy ${PROV_UUID}';`)).toEqual([]);
    expect(isBareUrl(`https://x.invalid/api/strategies/${PROV_UUID}`), "…and the URL walk agrees, as it already did").toBe(true);

    // ⛔ CANONICAL AND NOTHING LOOSER, calibrated at the SAME LENGTH so it
    // cannot absorb an opaque key.
    const OPAQUE = `FAKE-${"a1".repeat(16)}`.slice(0, 36);
    expect(OPAQUE.length).toBe(36);
    expect(CANONICAL_UUID_RE.test(OPAQUE), "the control must NOT be a UUID or this proves nothing").toBe(false);
    expect(provIds(`-- strategy ${OPAQUE}\nSELECT 1;`)).toEqual(["long-token-anywhere"]);
    expect(provIds(`-- strategy ${PROV_UUID.replace("-e89b-", "e89b--")}\nSELECT 1;`), "one shifted hyphen breaks it").toEqual([
      "long-token-anywhere",
    ]);
    // CONTROL: an ordinary opaque key in the same two positions is still named.
    expect(provIds(`-- k = ${PROV_KEY}\nSELECT 1;`)).toEqual(["long-token-anywhere"]);
    expect(provIds(`SELECT '${PROV_KEY}';`)).toEqual(["long-token-anywhere"]);
  });

  it("PROVENANCE 2/2: a migration FILENAME is not a credential — in a COMMENT ONLY, and only in this repo's exact shape", () => {
    expect(PROV_MIGRATION.length).toBeGreaterThanOrEqual(TOKEN_MIN);
    expect(provIds(`-- added by ${PROV_MIGRATION}\nSELECT 1;`)).toEqual([]);
    expect(provIds(`/* added by ${PROV_MIGRATION} */ SELECT 1;`)).toEqual([]);

    // ⛔ NOT EXEMPT IN A LITERAL. A filename inside a string literal is an
    // argument to something, and this rule's subject is values.
    expect(provIds(`SELECT 'see ${PROV_MIGRATION}';`)).toEqual(["long-token-anywhere"]);

    // ⛔ BOTH HALVES OF THE SHAPE ARE LOAD-BEARING, EACH BROKEN ALONE. Without
    // them, "any token ending in a source extension" would be a one-step
    // off-switch: append `.sql` to a key inside a comment and the rule goes
    // quiet — precisely the class WR-R1-01 closed.
    expect(provIds(`-- ${PROV_KEY}.sql\nSELECT 1;`), "a key with .sql glued on is NOT a migration filename").toEqual([
      "long-token-anywhere",
    ]);
    expect(provIds("-- 20260907130000_ledger_refresh_switch_to_system_flags.txt\nSELECT 1;"), "wrong suffix").toEqual([
      "long-token-anywhere",
    ]);
    expect(provIds("-- 2026090713000_ledger_refresh_switch_to_system_flags.sql\nSELECT 1;"), "13-digit prefix").toEqual([
      "long-token-anywhere",
    ]);
    expect(provIds(`-- ${PROV_MIGRATION.toUpperCase()}\nSELECT 1;`), "uppercase body").toEqual(["long-token-anywhere"]);

    // ⚠️ MEASURED AND LEFT OPEN, pinned so a future reader finds the DECISION
    // rather than re-discovering the behaviour: a bare 40-character git sha, a
    // phase-directory name and a GitHub commit URL still fire. A hex-only token
    // IS a credential family this arm names by name ("hex digests"), so
    // exempting one would blind the rule to a shape it exists for.
    expect(provIds("-- see commit 88581b8bc66415bfa86b7d5a019741b1cbd0ff49\nSELECT 1;")).toEqual(["long-token-anywhere"]);
    expect(provIds("-- 164.8.5-proberparse-the-prod-prober-hygiene-rules-stop-being-dodgeab\nSELECT 1;")).toEqual([
      "long-token-anywhere",
    ]);
    expect(
      provIds("-- https://github.com/AI-Isaiah/quantalyze/commit/88581b8bc66415bfa86b7d5a019741b1cbd0ff49\nSELECT 1;"),
    ).toEqual(["long-token-anywhere"]);
  });

  it("IN-R2-03: `parseCronJobRows` addresses every field through CRON_JOB_COLUMNS — no hand-typed ordinals survive", () => {
    // ⛔ A REFACTOR WITH NO OBSERVABLE BEHAVIOUR TODAY, SO THE CONTROL IS A PIN
    // AND A PROOF, NOT A RED FIXTURE — the same idiom the F5 deletion uses
    // below. Under the CURRENT column order, name-addressed and ordinal
    // extraction return identical rows by construction, so any behavioural
    // assertion here would be a control that cannot fail.
    //
    // THE DEFECT IT CLOSES: the WIDTH guard was derived
    // (`f.length !== CRON_JOB_COLUMNS.length`) while the EXTRACTION was seven
    // hand-typed ordinals plus `f[7]` for `total`. Reordering the file's own
    // stated "one source of the field count" would have mis-assigned every
    // field while the guard stayed green, and a NINTH column would have turned
    // the `total` read — and therefore the whole CR-R1-03 count guard — into a
    // no-op.
    const armText = readFileSync(join(PROBER_DIR, "arms", "cron-drift.mjs"), "utf8");
    const fn = armText.slice(anchorIndex(armText, "export function parseCronJobRows"));
    const body = fn
      .slice(0, fn.indexOf("\n}\n") + 2)
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    const ORDINALS = /\bf\[\d+\]/g;
    expect(body.match(ORDINALS), "no hand-typed field ordinal survives in the parser body").toBeNull();
    expect(body, "and the field count guard is still the derived one").toContain("f.length !== CRON_JOB_COLUMNS.length");
    expect(body, "…addressed by NAME").toContain("CRON_JOB_COLUMNS.indexOf(column)");
    // CALIBRATION: the same predicate FINDS an ordinal when one is spliced in,
    // so "none survive" is a reading rather than something this assertion
    // always says.
    expect(body.replace("at(\"jobid\")", "f[0]").match(ORDINALS), "the predicate really can fire").not.toBeNull();

    // And the behaviour is pinned end to end: every column's value arrives
    // under its own name. The record is BUILT from CRON_JOB_COLUMNS, so a
    // reordering changes both sides together and this stays true — which is
    // exactly the property the refactor buys.
    const { fieldSep, recordSep } = CRON_JOB_SEPARATORS;
    const values = CRON_JOB_COLUMNS.map((c) => (c === "active" ? "t" : c === "total" ? "1" : `v_${c}`));
    const { rows, malformed, total } = parseCronJobRows(values.join(fieldSep) + recordSep);
    expect(malformed).toEqual([]);
    expect(total).toBe(1);
    expect(rows[0]).toEqual({
      jobid: "v_jobid",
      jobname: "v_jobname",
      schedule: "v_schedule",
      active: true,
      database: "v_database",
      username: "v_username",
      command: "v_command",
    });
  });

  it("F5: the UNREACHABLE `vaultSpan` exemption is gone and cannot come back", () => {
    // ⛔ A DELETION OF PROVABLY-DEAD CODE HAS NO BEHAVIOUR TO NEUTER, so the
    // honest control is a PROOF plus a pin, not a red fixture.
    //
    // THE PROOF. The deleted line was `if (vaultSpan && BARE_URL_RE.test(token))
    // continue;`, sitting one line BELOW the unconditional
    // `if (BARE_URL_RE.test(token)) continue;`. Its condition implies the
    // earlier one, so every token that could reach it had already been
    // `continue`d — and `vaultSpan` had no other reader. It was dressed as a
    // security exemption, which cost every subsequent reader the re-derivation,
    // and an edit to the test ABOVE would have silently changed its meaning
    // with no test moving.
    const armText = readFileSync(join(PROBER_DIR, "arms", "cron-drift.mjs"), "utf8");
    // ⚠️ COMMENT LINES ARE STRIPPED FIRST, and that is load-bearing rather than
    // convenient: the arm QUOTES the deleted line in the comment that explains
    // why it is gone, so a raw `not.toContain` would fail on the documentation
    // of the fix. The pin is about CODE.
    const body = armText
      .slice(anchorIndex(armText, "export function hygieneViolations"))
      .split("\n")
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
      .join("\n");
    // ⚠️ THE ANCHOR IS `if (isBareUrl(` AND NOT THE WHOLE LINE. WR-R2-07 gave
    // the exemption an argument (`token.replace(TRIM_PUNCT, "")`), and pinning
    // the argument here would make this proof-of-a-deletion red every time the
    // exemption's INPUT is narrowed — which is a change this file wants, not
    // one it should fight. What must stay is the UNCONDITIONAL call.
    const EXEMPTION_ANCHOR = "if (isBareUrl(";
    expect(body, "the dead exemption's identifier is gone from the rule body").not.toContain("vaultSpan =");
    expect(body, "and the unconditional bare-URL exemption — the whole of what it duplicated — is still there").toContain(
      EXEMPTION_ANCHOR,
    );
    // CALIBRATION: the same predicate FINDS the line when it is spliced back
    // in, so "it is gone" is a reading rather than something this assertion
    // always says.
    const restored = body.replace(
      EXEMPTION_ANCHOR,
      `const vaultSpan = VAULT_READ_RE.test(span.masked);\n        ${EXEMPTION_ANCHOR}`,
    );
    expect(restored).not.toBe(body);
    expect(restored).toContain("vaultSpan =");
  });

  it("no hand-typed hygiene rule COUNT survives in the prober (criterion 9)", () => {
    // ⛔ THE COUNT MOVED ONCE ALREADY AND THE PROSE DID NOT. `run.mjs` used to
    // compare the red fixture's row count against a literal `10` that equalled
    // the rule count only by a one-row-per-rule coincidence, and two docblocks
    // said "the ten hygiene rules" in words. A number restated in prose is a
    // claim nothing can check; `HYGIENE_RULE_IDS` is the one source.
    const runnerText = readFileSync(RUNNER_PATH, "utf8");
    const armText = readFileSync(join(PROBER_DIR, "arms", "cron-drift.mjs"), "utf8");
    const SPELLED = /\b(?:ten|eleven|twelve|nine|10|11|12)\s+(?:hygiene\s+)?rules?\b/i;
    expect(runnerText).not.toMatch(SPELLED);
    expect(armText).not.toMatch(SPELLED);
    // ⚠️ ANCHORED TO THE ASSERTION FORM, not to the bare expression. What
    // criterion 9 forbids is a hand-typed count that JUDGES something; the
    // dated lineage comment recording the old `red.data.length === 10` is
    // history and must stay readable.
    const HAND_TYPED = /expect\(\s*red\.data\.length\s*===\s*\d+/;
    expect(runnerText).not.toMatch(HAND_TYPED);
    // CALIBRATION: both predicates find what they forbid, so the two `not`s
    // above are readings rather than regexes that match nothing.
    expect(`${runnerText}\n * ANY of the ten hygiene rules`).toMatch(SPELLED);
    expect(`${runnerText}\n expect(red.data.length === 11, \"x\")`).toMatch(HAND_TYPED);
  });

  it("FUNCTIONS_DIR resolves to a real directory that carries match_engine_cron_tick.sql", () => {
    // ⛔ THE RENAME TRAP. `vault-absent` fails CLOSED: a callable it cannot
    // resolve is not a Vault reader. That is right for an unknown FUNCTION and
    // catastrophic for a moved DIRECTORY — rename `supabase/schema/functions/`
    // and the flagship job starts firing `cron-secret-in-command` on correct
    // production configuration every hour. The arm throws on an absent
    // directory (self-test scenario "a MISSING functions snapshot is a
    // measure-fail"), and this pin is the other half: it names the exact file
    // the 164.5.1 collision scenario depends on, so a rename reds HERE, in a
    // test whose message says what moved.
    expect(statSync(FUNCTIONS_DIR).isDirectory()).toBe(true);
    const tick = join(FUNCTIONS_DIR, "match_engine_cron_tick.sql");
    expect(statSync(tick).isFile()).toBe(true);
    // And it is the snapshot's OWN text, not something that merely exists: the
    // executing Vault read is the fact the collision scenario turns on.
    expect(readFileSync(tick, "utf8")).toMatch(/FROM\s+vault\.decrypted_secrets/i);

    // CALIBRATION: the same predicate reports a MISSING sibling, so "the file is
    // there" is a reading rather than something this assertion always says.
    expect(() => statSync(join(FUNCTIONS_DIR, "match_engine_cron_tick_MOVED.sql"))).toThrow();
  });

  // ⛔ THE TITLE INTERPOLATES AND THE ASSERTION PINS (164.8.5-REVIEW-R1 IN-02).
  // The title used to hand-type `71` twice, so bumping `SELF_TEST_SCENARIOS`
  // for a new scenario left a test NAME asserting a number the body no longer
  // checked — a green test lying about what it measures, which is the one
  // failure mode a title can have. `expect(SELF_TEST_SCENARIOS).toBe(…)` below
  // stays a literal ON PURPOSE: it is D5's deliberate-edit pin, and it is now
  // the ONLY hand-typed copy of the count outside `run.mjs`.
  it(`SELF_TEST_SCENARIOS is ${SELF_TEST_SCENARIOS}, and the runner PRINTS exactly ${SELF_TEST_SCENARIOS} headers numbered 1..${SELF_TEST_SCENARIOS}`, async () => {
    // ⭐ SOURCE-DERIVED, not scraped. The headers are auto-numbered at RUNTIME
    // off the same counter the runner's completeness assertion reads, so there
    // is no literal `k/50` in the source to count. Executing the self-test is
    // the only honest way to derive the number — and it is fixtures-only, no
    // network, under a tenth of a second.
    expect(SELF_TEST_SCENARIOS).toBe(75);
    const { code, numbers, denominators } = await runSelfTestHeaders();
    expect(code, "the self-test must pass for its header count to mean anything").toBe(0);
    expect(numbers.length).toBe(SELF_TEST_SCENARIOS);
    expect(numbers).toEqual(Array.from({ length: SELF_TEST_SCENARIOS }, (_, i) => i + 1));
    expect(new Set(denominators)).toEqual(new Set([SELF_TEST_SCENARIOS]));
  });
});

// ---------------------------------------------------------------------------
// compareManifest TOTALITY — the CR-04 defect, asserted directly on the
// function rather than through a fixture run.
//
// ⛔ AN ABSENT MANIFEST FIELD IS AN AGREEMENT, NOT A QUESTION. `Boolean(undefined)`
// is `false`, so a manifest row that merely LOST its `active` key agreed with a
// DEACTIVATED production job and reported no drift; `String(undefined ?? "").trim()`
// is `""`, which compares equal to an absent PROD value the same way.
//
// ⭐ FOUR SEPARATE `it()`s ON PURPOSE. `schedule`, `username` and `database`
// share ONE loop in the implementation (SR-09) but they are THREE controls, and
// the neuter matrix darkens each alone with the other two left live. A single
// test covering all three would credit one RED to three controls — the exact
// shape that let the reverted repair report five vacuous controls as proved.
// ---------------------------------------------------------------------------
describe("[164.8.5-02] compareManifest totality (CR-04)", () => {
  const DRIFT_FIXTURES = join(PROBER_DIR, "fixtures", "cron-drift");
  const MANIFEST = JSON.parse(readFileSync(join(DRIFT_FIXTURES, "manifest.json"), "utf8"));
  const PROD_OK = JSON.parse(readFileSync(join(DRIFT_FIXTURES, "prod-ok.json"), "utf8"));
  const SUBJECT_JOB = "match_engine_cron";

  /**
   * Deep-copy the oracle and delete ONE key from the subject row.
   *
   * ⛔ THROWS when the key was not there to begin with. A `delete` of a missing
   * key is a silent no-op, and a mutant identical to its original makes every
   * assertion below vacuous.
   */
  const withoutField = (field: string) => {
    const copy = JSON.parse(JSON.stringify(MANIFEST));
    const row = copy.jobs.find((j: { jobname: string }) => j.jobname === SUBJECT_JOB);
    if (!row || !(field in row)) throw new Error(`fixture drift: ${SUBJECT_JOB} has no ${field} to delete`);
    delete row[field];
    if (JSON.stringify(copy) === JSON.stringify(MANIFEST)) throw new Error(`the ${field} mutant is identical to the original`);
    return copy;
  };

  const invalidsFor = (manifest: unknown) =>
    compareManifest(manifest, PROD_OK, { liveMarker: MANIFEST.database_marker }).defects.filter(
      (d: { kind: string }) => d.kind === "manifest-invalid",
    );

  const assertNamesJobAndField = (field: string) => {
    const invalids = invalidsFor(withoutField(field));
    expect(invalids.length, `a row missing ${field} must be manifest-invalid, not a silent agreement`).toBe(1);
    expect(invalids[0].detail, "naming the job, so a reviewer knows which row to re-capture").toContain(SUBJECT_JOB);
    expect(invalids[0].detail, "and naming the FIELD, so the sentence is actionable").toContain(field);
  };

  it("CR-04 totality: a manifest row missing `active` is manifest-invalid", () => {
    assertNamesJobAndField("active");
  });

  it("CR-04 totality: a manifest row missing `schedule` is manifest-invalid", () => {
    assertNamesJobAndField("schedule");
  });

  it("CR-04 totality: a manifest row missing `username` is manifest-invalid", () => {
    assertNamesJobAndField("username");
  });

  it("CR-04 totality: a manifest row missing `database` is manifest-invalid", () => {
    assertNamesJobAndField("database");
  });

  // -------------------------------------------------------------------------
  // WR-R2-03 — THE WITHHOLDING PREDICATE'S TWO ARMS, EACH WITH ITS OWN RED
  // SURFACE.
  //
  // ⛔ `manifestDirty` and `prodDirty` used to be TWO SPELLINGS of one
  // predicate, and `164.8.5-FIX-R1-SUMMARY.md` recorded the pair as ONE
  // neuter-proved control. It could only ever have proven one. MEASURED
  // 2026-09-11, each `!…judged ||` arm dropped ALONE:
  //     (B) prod side only     -> SELF-TEST PASSED: 73/73   (GREEN)
  //     (C) manifest side only -> SELF-TEST PASSED: 73/73   (GREEN) + vitest GREEN
  //     (B+C) both             -> SELF-TEST FAILED
  // because the only scenario reaching them drove an absent `functionsDir`,
  // which is SHARED, so BOTH verdicts were `judged: false` and the two terms
  // were redundant. A future editor "simplifying" either line shipped the
  // CR-R1-02 regression with a fully green suite.
  //
  // ⭐ The implementation is now ONE `hygieneWithholds` called twice, so there
  // is one control; its two ARMS are what need separate surfaces, and these two
  // tests are them. ⚠️ THEY DRIVE `compareManifest` DIRECTLY rather than through
  // the runner ON PURPOSE: the runner's fixture path renders every field to psql
  // TEXT, so a non-string command — the only asymmetric refusal this module has
  // — cannot survive it. A scenario written there would have measured nothing.
  // -------------------------------------------------------------------------
  const LEAKY = `SELECT net.http_post(url := 'https://x.invalid/a', headers := jsonb_build_object('X-Service-Key', 'FAKE-key-${"0123456789ab"}'), body := '{}'::jsonb)`;

  /** The cron-drift defect for `SUBJECT_JOB` when its PROD command is replaced. */
  const driftDetailWithProdCommand = (command: unknown) => {
    const rows = JSON.parse(JSON.stringify(PROD_OK));
    const row = rows.find((r: { jobname: string }) => r.jobname === SUBJECT_JOB);
    if (!row) throw new Error(`fixture drift: prod-ok.json has no ${SUBJECT_JOB}`);
    row.command = command;
    const r = compareManifest(MANIFEST, rows, { liveMarker: MANIFEST.database_marker });
    const drifts = r.defects.filter((d: { kind: string; subject: string }) => d.kind === "cron-drift" && d.subject === SUBJECT_JOB);
    expect(drifts.length, "PRECONDITION: the row must DRIFT or the withholding branch is never reached").toBe(1);
    return { detail: String(drifts[0].detail), all: r.defects as { kind: string; subject: string }[], lines: r.lines as string[] };
  };

  it("WR-R2-03 arm 1 — ONE side UNJUDGED withholds the text (`!judged`, with the other side judged and clean)", () => {
    // The lever is an ASYMMETRIC refusal: the PROD command is not a STRING,
    // which `hygieneViolations` refuses; the manifest row for the same jobname
    // is an ordinary judged-and-clean string. Exactly one side is unjudged, so
    // the `!judged` arm is the ONLY reason the text can be withheld.
    const { detail, all, lines } = driftDetailWithProdCommand(12345);
    expect(
      all.some((d) => d.kind === "measure-fail" && d.subject === `prod:${SUBJECT_JOB}`),
      "PRECONDITION: the PROD side really is unjudged",
    ).toBe(true);
    expect(
      all.some((d) => d.kind === "measure-fail" && d.subject === `manifest:${SUBJECT_JOB}`),
      "PRECONDITION: and the MANIFEST side is NOT — otherwise the two arms are redundant again",
    ).toBe(false);
    expect(detail).toContain("command text withheld");
    expect(detail, "the line says WHICH side and WHY — 'fails hygiene' and 'could not be judged' send an operator to two different places").toContain(
      "PROD could not be judged",
    );
    expect(detail).not.toContain("manifest fails hygiene");
    expect(
      lines.some((l) => l.startsWith(`--- manifest ${SUBJECT_JOB}`)),
      "and NO unified diff — this arm is the only thing between an unjudged row and a PUBLIC Actions log",
    ).toBe(false);
  });

  it("WR-R2-03 arm 2 — ONE side JUDGED-AND-DIRTY withholds the text (`violations.length`, with NEITHER side unjudged)", () => {
    // The other arm, with its own surface, so neither can mask the other. The
    // PROD row is JUDGED — nothing refuses it — and merely fails a rule.
    expect(hygieneViolations(SUBJECT_JOB, LEAKY).length, "PRECONDITION: the replacement command is judged AND dirty").toBeGreaterThan(0);
    const { detail, all, lines } = driftDetailWithProdCommand(LEAKY);
    expect(
      all.some((d) => d.kind === "measure-fail" && d.subject.endsWith(SUBJECT_JOB)),
      "PRECONDITION: NEITHER side is unjudged, so the `!judged` arm cannot be the reason below",
    ).toBe(false);
    expect(detail).toContain("command text withheld");
    expect(detail).toContain("PROD fails hygiene");
    expect(detail).not.toContain("could not be judged");
    expect(lines.some((l) => l.startsWith(`--- manifest ${SUBJECT_JOB}`))).toBe(false);
  });

  it("WR-R2-03 CALIBRATION — both sides JUDGED and CLEAN prints the diff, so the two arms above are readings and not constants", () => {
    // ⛔ WITHOUT THIS THE TWO TESTS ABOVE COULD BOTH PASS ON A FUNCTION THAT
    // ALWAYS WITHHOLDS. Here the PROD command differs from the manifest's and
    // trips nothing, and the unified diff IS printed.
    const CLEAN = "SELECT public.match_engine_cron_tick(); -- re-scheduled";
    expect(hygieneViolations(SUBJECT_JOB, CLEAN, { functionsDir: FUNCTIONS_DIR })).toEqual([]);
    const { detail, lines } = driftDetailWithProdCommand(CLEAN);
    expect(detail).not.toContain("command text withheld");
    expect(lines.some((l) => l.startsWith(`--- manifest ${SUBJECT_JOB}`))).toBe(true);
  });

  it("WR-R2-03: `hygieneWithholds` is ONE predicate, and each ARM is separately falsifiable", () => {
    // The unit-level statement of the same thing: each arm alone withholds, and
    // the clean verdict does not.
    expect(hygieneWithholds({ judged: false, violations: [] }), "unjudged alone withholds").toBe(true);
    expect(hygieneWithholds({ judged: true, violations: ["[x-service-key-literal] …"] }), "dirty alone withholds").toBe(true);
    expect(hygieneWithholds({ judged: true, violations: [] }), "judged and clean does NOT").toBe(false);
    expect(hygieneWithholds(UNRECORDED_VERDICT), "and the unrecorded sentinel withholds through the first arm").toBe(true);
  });

  it("CALIBRATION: the UNTOUCHED oracle over the same rows yields ZERO manifest-invalid, and every mutant really differs", () => {
    // The predicate FLIPS: the same function reports one manifest-invalid on
    // each mutated copy above and none here, so "manifest-invalid fired" is a
    // real reading rather than something this pair of inputs always produces.
    expect(invalidsFor(MANIFEST), "the committed fixture pair must be CLEAN or the four tests above prove nothing").toEqual([]);
    for (const field of ["active", "schedule", "username", "database"]) {
      expect(JSON.stringify(withoutField(field)), `the ${field} mutant must differ from the original`).not.toBe(
        JSON.stringify(MANIFEST),
      );
    }
  });
});
