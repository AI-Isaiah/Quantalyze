/**
 * test-restore-from-baseline WIRING PIN — Phase 164.8 plan 03.
 *
 * ⛔ THE DEFECT THIS FILE CATCHES. `scripts/restore-test-from-baseline.sh` proves its
 * own contract with `--self-test`: every arm counted against its own `EXPECTED_ARMS`
 * constant, each with a falsifier that was observed RED (`164.8-02-SUMMARY.md`). The
 * tally is printed by `bash scripts/restore-test-from-baseline.sh --self-test`; a
 * numeral restated here would be stale the first time an arm is added, so it is not.
 * NONE of that survives a WORKFLOW that invokes it differently. A second trigger key,
 * a commented-out `environment:`, a
 * backup step that drifts below the script step, a fork-PR `exit 0` surviving inside
 * the credential branch, or an ancestry assert that passes on a non-ancestor sha —
 * each turns a proven mechanism into a destructive act with no proof around it. The
 * script's arms cannot see any of them. This file is what does.
 *
 * ⭐ EVERY PREDICATE HERE IS WRITTEN OVER ARBITRARY TEXT AND CALIBRATED ON A MUTATED
 * COPY (the `src/__tests__/prod-prober-wiring.test.ts` idiom). A predicate only ever
 * applied to the passing input is not evidence — it can be satisfied by a function
 * that matches anything. `calibrate()` asserts the mutant genuinely differs, asserts
 * the predicate holds on the real file, and asserts it FLIPS on the mutant.
 *
 * ⭐ AND THE W5 PREMISE ASSERT IS EXECUTED, NOT GREPPED. The two steps that decide
 * whether PROD's ledger really equals the repo file set are EXTRACTED out of the YAML
 * and RUN — against a throwaway git repository, with a stub `gh` on PATH — and this
 * file asserts on their exit codes. A grep pin goes green the moment someone keeps
 * the strings and guts the logic, which is the likelier regression
 * (`src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts` is the precedent).
 */
import { afterAll, describe, expect, it } from "vitest";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = process.cwd();
const WF_PATH = ".github/workflows/test-restore-from-baseline.yml";
const CI_PATH = ".github/workflows/ci.yml";
const SCRIPT_PATH = "scripts/restore-test-from-baseline.sh";
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");
const WF = read(WF_PATH);
const CI = read(CI_PATH);
const SCRIPT = read(SCRIPT_PATH);

const RESTORE_JOB = "restore";
const GUARD_JOB = "dispatch-guard";

/**
 * The acquire / release steps, from their `- name:` line (6-space step indent) to the
 * next sibling step or comment at that indent — the SAME regex shape
 * `critical-regressions.test.ts` uses for its three-way byte-identity pin, so the two
 * files cannot disagree about what "the step" is. The release variant also stops at a
 * job header, because in `ci.yml` that step is the last one in `sql-tests`.
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

/** The lines under the top-level `on:` key, up to the next column-0 key. */
function onBlockLines(text: string): string[] {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => l === "on:");
  if (i < 0) return [];
  const out: string[] = [];
  for (let k = i + 1; k < lines.length; k += 1) {
    if (/^\S/.test(lines[k])) break;
    out.push(lines[k]);
  }
  return out;
}

/** Trigger keys only — the 2-space keys under `on:`, comments excluded. */
function triggerKeys(text: string): string[] {
  return onBlockLines(text)
    .filter((l) => /^ {2}[A-Za-z_]/.test(l))
    .map((l) => l.trim().replace(/:.*$/, ""));
}

/** The `mode` input's declared shape, read out of the `on:` block. */
function modeInput(text: string): {
  type: string | null;
  options: string[];
  default: string | null;
} {
  const lines = onBlockLines(text);
  const i = lines.findIndex((l) => l === "      mode:");
  const spec = { type: null as string | null, options: [] as string[], default: null as string | null };
  if (i < 0) return spec;
  let inOptions = false;
  for (let k = i + 1; k < lines.length; k += 1) {
    if (/^ {6}\S/.test(lines[k])) break; // the next input key
    const t = lines[k].trim();
    if (t === "options:") {
      inOptions = true;
      continue;
    }
    if (inOptions && t.startsWith("- ")) {
      spec.options.push(t.slice(2));
      continue;
    }
    inOptions = false;
    if (t.startsWith("type:")) spec.type = t.slice("type:".length).trim();
    if (t.startsWith("default:")) spec.default = t.slice("default:".length).trim();
  }
  return spec;
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
 * equality — so `... --self-test` never satisfies a pin on the bare command.
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

/** A step's text from its `- name:` line up to (not including) its `run:` line. */
function stepHead(text: string, name: string): string {
  const start = text.indexOf(`- name: ${name}`);
  if (start < 0) return "";
  const rest = text.slice(start);
  const m = rest.match(/\n\s*run:/);
  return m ? rest.slice(0, m.index) : "";
}

/** A step's full body, name line through the end of its `run:` block. */
function stepBody(text: string, name: string): string {
  const re = new RegExp(
    `^ {6}- name: ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n[\\s\\S]*?(?=\\n {6}[-#]|\\n {2}\\S)`,
    "m",
  );
  // The sentinel gives the LAST step in the file a terminator, so a pin on the final
  // step is not silently vacuous (measured: without it, stepBody() returned "" for the
  // upload step and every key assertion below would have had nothing to look at).
  const m = `${text}\n  __end_of_file__:\n`.match(re);
  return m ? m[0] : "";
}

/**
 * The `-e '…'` expressions of the redaction step's sed program, in order.
 *
 * Sliced between `if sed -i -E` and the `; then` that closes the command, so an
 * unrelated `-e '…'` elsewhere in the step cannot pad the list. Returns [] when the
 * anchors are gone, and its one consumer asserts a non-empty exact length — an empty
 * program would make "the DSN was scrubbed" vacuously reportable.
 */
function redactExpressions(text: string): string[] {
  const body = text.slice(text.indexOf("- name: Redact connection metadata"));
  const a = body.indexOf("if sed -i -E");
  if (a < 0) return [];
  const b = body.indexOf("; then", a);
  if (b < 0) return [];
  return [...body.slice(a, b).matchAll(/-e '([^']*)'/g)].map((m) => m[1]);
}

/** Every shape that could turn a failure into a pass, reported BY NAME. */
const SOFTENING_TOKENS = ["continue-on-error", "|| true", "exit 0", "::warning", "set +e"];

/**
 * The `restore:` job with the two ci.yml-copied mutex steps sliced out.
 *
 * ⚠️ THE ACQUIRE STEP IS EXCLUDED TOO, not just the release step, and that is FORCED
 * rather than convenient: this workflow is required to carry a BYTE-IDENTICAL copy of
 * ci.yml's acquire suffix, and that suffix legitimately contains `exit 0` (the
 * successful acquire), `|| true` (the bounded census) and `::warning` (the retried
 * session fault). Scanning it would make the two requirements contradict. Nothing
 * hides in the excluded region: the byte-identity pin below governs the suffix
 * exactly, and a separate pin asserts our own prefix carries no zero-status exit —
 * which is strictly stronger than a token scan over the same bytes.
 */
function scannableRestoreBlock(text: string): string {
  return jobBlock(text, RESTORE_JOB).replace(ACQUIRE_RE, "").replace(RELEASE_RE, "");
}

function softeningOffenders(text: string): string[] {
  const live = liveLines(scannableRestoreBlock(text)).join("\n");
  return SOFTENING_TOKENS.filter((t) => live.includes(t));
}

/** The file's header — everything before the `on:` key. */
function headerBlock(text: string): string {
  const i = text.indexOf("\non:\n");
  return i < 0 ? "" : text.slice(0, i);
}

/** ci.yml's step names, read from ci.yml rather than restated here. */
const CI_LINES = CI.split("\n");
const CRON_STEP_NAME = (CI_LINES[1271] ?? "").replace(/^\s*- name:\s*/, "").trim();
const PROBE_STEP_NAME = (CI_LINES[1376] ?? "").replace(/^\s*- name:\s*/, "").trim();

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
      `${WF_PATH} has no step named "${stepName}". The PROD-ledger premise assert is what ` +
        `stops the ledger seed writing 266 rows claiming a parity PROD does not have. If it ` +
        `was renamed, update the constant here; if it was deleted, say so out loud.`,
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

describe("164.8-03 — test-restore-from-baseline.yml is wired as the plan requires", () => {
  describe("triggers and inputs: the destructive path cannot be reached by accident", () => {
    it("the on: block declares workflow_dispatch and NOTHING else", () => {
      expect(triggerKeys(WF)).toEqual(["workflow_dispatch"]);
      for (const trigger of ["push", "schedule", "pull_request", "pull_request_target"]) {
        calibrate(
          `on: only workflow_dispatch (twin: ${trigger})`,
          (s) => s.replace("\non:\n", `\non:\n  ${trigger}:\n    branches: [main]\n`),
          (s) => triggerKeys(s).length === 1 && triggerKeys(s)[0] === "workflow_dispatch",
        );
      }
    });

    it("the mode input is a choice of exactly preflight|restore, defaulting to preflight", () => {
      const spec = modeInput(WF);
      expect(spec.type).toBe("choice");
      expect(spec.options).toEqual(["preflight", "restore"]);
      expect(spec.default).toBe("preflight");
      calibrate(
        "mode defaults to preflight",
        (s) => s.replace("        default: preflight\n", "        default: restore\n"),
        (s) => modeInput(s).default === "preflight",
      );
      calibrate(
        "mode is a typed choice",
        (s) => s.replace("        type: choice\n", "        type: string\n"),
        (s) => modeInput(s).type === "choice",
      );
    });

    it("the guard job's if: is the exact negation of the restore job's", () => {
      const guard = jobBlock(WF, GUARD_JOB);
      const restore = jobBlock(WF, RESTORE_JOB);
      expect(liveLineCount(guard, "if: github.ref != 'refs/heads/main'")).toBe(1);
      expect(liveLineCount(restore, "if: github.ref == 'refs/heads/main'")).toBe(1);
      calibrate(
        "guard if: is the negation of the restore if:",
        (s) => s.replace("if: github.ref != 'refs/heads/main'", "if: github.ref != 'refs/heads/develop'"),
        (s) =>
          liveLineCount(jobBlock(s, GUARD_JOB), "if: github.ref != 'refs/heads/main'") === 1 &&
          liveLineCount(jobBlock(s, RESTORE_JOB), "if: github.ref == 'refs/heads/main'") === 1,
      );
    });

    it("the guard job FAILS rather than passing quietly", () => {
      const guard = jobBlock(WF, GUARD_JOB);
      expect(
        liveLines(guard).some((l) => l.trim() === "exit 1"),
        "the dispatch-guard no longer exits 1 — a restore dispatched off main would leave a GREEN check, teaching the operator that it ran",
      ).toBe(true);
      expect(liveLines(guard).some((l) => l.trim() === "exit 0")).toBe(false);
    });
  });

  describe("the restore job is bound, bounded, and credential-hard", () => {
    it("environment: Test is a LIVE line inside the restore job, exactly once", () => {
      calibrate(
        "environment: Test",
        (s) => s.replace("    environment: Test\n", "    # environment: Test\n"),
        (s) => liveLineCount(jobBlock(s, RESTORE_JOB), "environment: Test") === 1,
      );
    });

    it("timeout-minutes: 90 is a LIVE line inside the restore job", () => {
      calibrate(
        "timeout-minutes: 90 (the runbook's TTL leg — the holder sleeps 6000s = 100min)",
        (s) => s.replace("    timeout-minutes: 90\n", "    timeout-minutes: 900\n"),
        (s) => liveLineCount(jobBlock(s, RESTORE_JOB), "timeout-minutes: 90") === 1,
      );
    });

    it("the credential assert carries NO if:, and names the variable in an ::error::", () => {
      const head = stepHead(WF, "Assert TEST credential is configured");
      expect(head, "the credential-assert step is gone").not.toBe("");
      expect(
        /^\s*if:/m.test(head),
        "an `if:` appeared between the credential step's name and its run body — that is supabase-migrate.yml's OLDER tolerant shape, which reports success having restored nothing",
      ).toBe(false);
      const body = stepBody(WF, "Assert TEST credential is configured");
      expect(body).toContain("::error::secrets.TEST_SUPABASE_DB_URL is not configured.");
      expect(body).toContain("exit 1");
      calibrate(
        "credential step has no if:",
        (s) =>
          s.replace(
            "      - name: Assert TEST credential is configured\n",
            "      - name: Assert TEST credential is configured\n        if: vars.CONFIGURED == 'true'\n",
          ),
        (s) => !/^\s*if:/m.test(stepHead(s, "Assert TEST credential is configured")),
      );
    });
  });

  describe("ordering: nothing destructive runs before its precondition", () => {
    const ACQUIRE = "Acquire shared-test-db mutex";
    const BACKUP = "Back up TEST before any write (schema + ledger; NOT data)";
    const RUN = "Run the restore script";
    const VERIFY = "Post-verify with the Supabase CLI — ledger SHAPE";
    const PREMISE = "Assert PROD's ledger equals the repo file set";

    function ordered(text: string): boolean {
      const b = jobBlock(text, RESTORE_JOB);
      const i = (n: string) => stepIndex(b, n);
      return (
        i(PREMISE) > -1 &&
        i(ACQUIRE) > -1 &&
        i(BACKUP) > -1 &&
        i(RUN) > -1 &&
        i(VERIFY) > -1 &&
        i(PREMISE) < i(ACQUIRE) &&
        i(ACQUIRE) < i(BACKUP) &&
        i(BACKUP) < i(RUN) &&
        i(RUN) < i(VERIFY)
      );
    }

    it("premise < mutex < backup < script < post-verify", () => {
      calibrate(
        "backup precedes the script (a backup taken after DROP SCHEMA is not a backup)",
        (s) =>
          s
            .replace(`- name: ${BACKUP}`, "- name: __SWAP__")
            .replace(`- name: ${RUN}`, `- name: ${BACKUP}`)
            .replace("- name: __SWAP__", `- name: ${RUN}`),
        ordered,
      );
      calibrate(
        "the PROD-ledger premise is asserted BEFORE the lock is taken",
        (s) =>
          s
            .replace(`- name: ${PREMISE}`, "- name: __SWAP__")
            .replace(`- name: ${ACQUIRE}`, `- name: ${PREMISE}`)
            .replace("- name: __SWAP__", `- name: ${ACQUIRE}`),
        ordered,
      );
    });

    it("the four verbatim commands are LIVE run lines, self-test before corpus", () => {
      const b = jobBlock(WF, RESTORE_JOB);
      const cmds = {
        staleSelf: "node scripts/check-baseline-staleness.mjs --self-test",
        stale: "node scripts/check-baseline-staleness.mjs",
        scriptSelf: "bash scripts/restore-test-from-baseline.sh --self-test",
        scriptRun: 'bash scripts/restore-test-from-baseline.sh --run --mode "$MODE"',
      };
      for (const [key, cmd] of Object.entries(cmds)) {
        expect(
          liveCommandIndex(b, cmd),
          `${key}: \`${cmd}\` is not a LIVE run line in the restore job — a commented-out command is not a command`,
        ).toBeGreaterThan(-1);
      }
      expect(
        liveCommandIndex(b, cmds.staleSelf),
        "the co-edit gate's --self-test must run BEFORE its corpus step (the sql-gate-lint idiom: a gate whose red path was not observed in THIS run is not evidence about this run)",
      ).toBeLessThan(liveCommandIndex(b, cmds.stale));
      expect(
        liveCommandIndex(b, cmds.scriptSelf),
        "the restore script's --self-test must run BEFORE its --run",
      ).toBeLessThan(liveCommandIndex(b, cmds.scriptRun));
      calibrate(
        "the restore script's --run is EXECUTED, not mentioned",
        (s) => s.replace(`          ${cmds.scriptRun}`, `          # ${cmds.scriptRun}`),
        (t) => liveCommandIndex(jobBlock(t, RESTORE_JOB), cmds.scriptRun) > -1,
      );
      calibrate(
        "self-test before corpus for the co-edit gate",
        (s) =>
          s
            .replace(`run: ${cmds.staleSelf}`, "run: __SWAP__")
            .replace(`run: ${cmds.stale}`, `run: ${cmds.staleSelf}`)
            .replace("run: __SWAP__", `run: ${cmds.stale}`),
        (t) => {
          const b2 = jobBlock(t, RESTORE_JOB);
          return liveCommandIndex(b2, cmds.staleSelf) < liveCommandIndex(b2, cmds.stale);
        },
      );
    });

    it("W9 — no pg_cron provisioning step; the server-binaries probe precedes the self-test", () => {
      expect(
        CRON_STEP_NAME,
        "ci.yml line 1272 is no longer the pg_cron provisioning step's `- name:` line — this pin reads it from ci.yml on purpose, so re-anchor it rather than restating the name here",
      ).toContain("pg_cron");
      expect(
        PROBE_STEP_NAME,
        "ci.yml line 1377 is no longer the PostgreSQL server-binaries probe's `- name:` line",
      ).toContain("PostgreSQL server binaries");
      calibrate(
        "the pg_cron provisioning step is NOT copied (Plan 01's fixtures create no cron job)",
        (s) =>
          s.replace(
            "      - name: Restore script self-test\n",
            `      - name: ${CRON_STEP_NAME}\n        run: echo provisioned\n      - name: Restore script self-test\n`,
          ),
        (t) => !t.includes(CRON_STEP_NAME),
      );
      const b = jobBlock(WF, RESTORE_JOB);
      expect(stepIndex(b, PROBE_STEP_NAME)).toBeGreaterThan(-1);
      expect(
        stepIndex(b, PROBE_STEP_NAME),
        "the server-binaries probe must run BEFORE the restore script's --self-test — the self-test boots a throwaway cluster and needs SERVER binaries, not just the client",
      ).toBeLessThan(stepIndex(b, "Restore script self-test"));
    });
  });

  describe("the backup: reversible for schema and ledger, and honest that data is not", () => {
    const BACKUP = "Back up TEST before any write (schema + ledger; NOT data)";
    const UPLOAD = "Upload the pre-restore backup (schema + ledger; NOT data)";

    it("the backup step's own NAME says what the artifact does not hold", () => {
      calibrate(
        "the backup step name says `NOT data`",
        (s) => s.replace(`- name: ${BACKUP}`, "- name: Back up TEST before any write"),
        (t) => {
          const b = jobBlock(t, RESTORE_JOB);
          const i = b.split("\n").findIndex((l) => /^\s*- name: Back up TEST/.test(l));
          return i > -1 && b.split("\n")[i].includes("NOT data");
        },
      );
    });

    it("the upload survives an aborted run and refuses to upload nothing", () => {
      const body = stepBody(WF, UPLOAD);
      expect(body, "the backup upload step is gone").not.toBe("");
      for (const key of ["if: always()", "retention-days: 90", "if-no-files-found: error"]) {
        expect(
          liveLines(body).some((l) => l.trim() === key),
          `the backup upload step no longer carries \`${key}\``,
        ).toBe(true);
      }
      calibrate(
        "the backup artifact is retained for 90 days",
        (s) => s.replace("          retention-days: 90\n", "          retention-days: 7\n"),
        (t) => liveLines(stepBody(t, UPLOAD)).some((l) => l.trim() === "retention-days: 90"),
      );
      calibrate(
        "an empty backup directory is an ERROR, never a quiet upload of nothing",
        (s) =>
          s.replace(
            "          if-no-files-found: error\n",
            "          if-no-files-found: warn\n",
          ),
        (t) =>
          liveLines(stepBody(t, UPLOAD)).some((l) => l.trim() === "if-no-files-found: error"),
      );
      calibrate(
        "the upload runs even when the script aborted",
        (s) =>
          s.replace(
            `      - name: ${UPLOAD}\n        if: always()\n`,
            `      - name: ${UPLOAD}\n`,
          ),
        (t) => liveLines(stepBody(t, UPLOAD)).some((l) => l.trim() === "if: always()"),
      );
    });

    it("the reversibility story is stated in the W6 words, in the header AND the log", () => {
      const header = headerBlock(WF);
      expect(header).toContain("SCHEMA AND LEDGER ARE REVERSIBLE");
      expect(header).toContain("DATA IS NOT");
      expect(
        stepBody(WF, BACKUP),
        "the backup step no longer PRINTS the reversibility story — the header is read by developers, the log by whoever is looking at the run that just destroyed the data",
      ).toContain("DATA IS NOT");
    });
  });

  describe("the redaction is fail-closed: nothing unredacted reaches a PUBLIC artifact", () => {
    const REDACT = "Redact connection metadata from the backup directory (public artifact)";
    const UPLOAD = "Upload the pre-restore backup (schema + ledger; NOT data)";

    it("the redaction step exists, runs on every outcome, and runs BEFORE the upload", () => {
      // ⛔ WHY THE ORDER IS THE WHOLE CONTROL. Both steps are `if: always()`. In a
      // job, `always()` steps run in FILE ORDER — so the only thing that makes the
      // redaction a precondition of the upload rather than a bystander is that it is
      // written above it. Drift the upload above the redaction and every assertion
      // about scrubbing stays true while the unredacted channels ship anyway.
      const b = jobBlock(WF, RESTORE_JOB);
      expect(stepIndex(b, REDACT), "the redaction step is gone").toBeGreaterThan(-1);
      expect(stepIndex(b, UPLOAD), "the upload step is gone").toBeGreaterThan(-1);
      expect(
        liveLines(stepBody(WF, REDACT)).some((l) => l.trim() === "if: always()"),
        "the redaction step no longer carries `if: always()` — on an ABORTED run it would not run at all, and the aborted run is exactly the one whose channels hold a psql connect failure naming the TEST pooler host",
      ).toBe(true);
      calibrate(
        "the redaction step precedes the upload step",
        (s) =>
          s
            .replace(`- name: ${REDACT}`, "- name: __SWAP__")
            .replace(`- name: ${UPLOAD}`, `- name: ${REDACT}`)
            .replace("- name: __SWAP__", `- name: ${UPLOAD}`),
        (t) => {
          const jb = jobBlock(t, RESTORE_JOB);
          const r = stepIndex(jb, REDACT);
          const u = stepIndex(jb, UPLOAD);
          return r > -1 && u > -1 && r < u;
        },
      );
      calibrate(
        "the redaction runs on an aborted run too",
        (s) => s.replace(`      - name: ${REDACT}\n        if: always()\n`, `      - name: ${REDACT}\n`),
        (t) => liveLines(stepBody(t, REDACT)).some((l) => l.trim() === "if: always()"),
      );
    });

    it("the scrubbed channel set is exactly .err/.log/.out — never the .sql/.csv the reversal replays", () => {
      // ⭐ THE SCOPE IS AS LOAD-BEARING AS THE SCRUB. A substitution inside
      // `schema.sql` or `ledger.csv` would corrupt the very bytes the reversal recipe
      // replays, so those two are deliberately left byte-exact; the price is that the
      // glob must never widen. Both the destroy loop (`withhold_channels`) and the
      // redact loop are pinned, because a widened destroy loop is a reversal recipe
      // deleted on the way to the artifact.
      const body = stepBody(WF, REDACT);
      expect(body, "the redaction step body could not be extracted").not.toBe("");
      const globLines = liveLines(body).filter((l) => l.includes('"${outdir}"/*.'));
      expect(
        globLines.length,
        "the redaction step no longer has exactly two channel-glob loops (withhold_channels and the redact loop)",
      ).toBe(2);
      for (const l of globLines) {
        expect(l).toContain('"${outdir}"/*.err');
        expect(l).toContain('"${outdir}"/*.log');
        expect(l).toContain('"${outdir}"/*.out');
        expect(
          /\*\.(sql|csv)/.test(l),
          `a channel loop widened to .sql or .csv — those are the reversal recipe and must stay byte-exact: ${l.trim()}`,
        ).toBe(false);
      }
      calibrate(
        "the channel-glob pin bites on a widening to .sql",
        (s) =>
          s.replace(
            'for f in "${outdir}"/*.err "${outdir}"/*.log "${outdir}"/*.out; do',
            'for f in "${outdir}"/*.err "${outdir}"/*.log "${outdir}"/*.out "${outdir}"/*.sql; do',
          ),
        (t) =>
          liveLines(stepBody(t, REDACT))
            .filter((l) => l.includes('"${outdir}"/*.'))
            .every((l) => !/\*\.(sql|csv)/.test(l)),
      );
    });

    it("the step's OWN sed program scrubs a DSN — EXECUTED against a fixture log", () => {
      // ⭐ EXECUTED, NOT GREPPED. The expressions are lifted OUT of the YAML and run,
      // so a step that keeps the strings and guts the program is a RED here. Run as
      // `sed -E` (no `-i`): the step's `sed -i -E` form is GNU-only — BSD sed reads
      // the `-E` as `-i`'s backup-extension argument and never enables extended
      // regexes — and this suite must measure the same thing on a developer's macOS
      // as on the ubuntu runner. The workflow itself only ever runs on ubuntu.
      const exprs = redactExpressions(WF);
      expect(
        exprs.length,
        "the redaction step's sed program no longer carries its five expressions (DSN credentials, host=, user=, `server at \"…\"`, `for user \"…\"`)",
      ).toBe(5);

      const scrub = (program: string[], input: string): string => {
        const dir = mkdtempSync(join(tmpdir(), "redact-"));
        const f = join(dir, "psql.err");
        writeFileSync(f, input);
        const r = spawnSync("sed", ["-E", ...program.flatMap((e) => ["-e", e]), f], {
          encoding: "utf8",
        });
        rmSync(dir, { recursive: true, force: true });
        if (r.status !== 0) throw new Error(`sed failed: ${r.stderr}`);
        return r.stdout ?? "";
      };

      const FIXTURE =
        'psql: error: connection to server at "db.exampleprojref.supabase.co" (10.11.12.13), port 5432 failed: FATAL: password authentication failed for user "postgres.exampleprojref"\n' +
        "DSN=postgresql://postgres.exampleprojref:EXAMPLE-NOT-A-REAL-PASSWORD@db.exampleprojref.supabase.co:5432/postgres\n" +
        "host=db.exampleprojref.supabase.co user=postgres.exampleprojref\n";

      const out = scrub(exprs, FIXTURE);
      for (const secret of ["EXAMPLE-NOT-A-REAL-PASSWORD", "postgres.exampleprojref"]) {
        expect(
          out.includes(secret),
          `the redaction left \`${secret}\` in the channel. This artifact is world-readable on a PUBLIC repo; the DB user and the password are exactly what must not survive.\n${out}`,
        ).toBe(false);
      }
      expect(
        out.includes('server at "db.exampleprojref.supabase.co"'),
        "the redaction left psql's `server at \"<host>\" (<ip>)` shape intact — the TEST pooler host and its IP are disclosed",
      ).toBe(false);
      expect(out).toContain("***");

      // CALIBRATION — drop the DSN expression and the credential SURVIVES. Without
      // this twin, `out.includes(secret) === false` could be reported by a fixture
      // that never carried the secret in the first place.
      const withoutDsn = exprs.filter((e) => !e.includes("postgres(ql)?://"));
      expect(
        withoutDsn.length,
        "CALIBRATION: no expression matched the DSN shape, so the twin removes nothing",
      ).toBe(exprs.length - 1);
      expect(
        scrub(withoutDsn, FIXTURE).includes("EXAMPLE-NOT-A-REAL-PASSWORD"),
        "CALIBRATION: the password survived neither program — the fixture does not exercise the DSN expression, so the pin above proves nothing",
      ).toBe(true);
    });

    it("a FAILED substitution DESTROYS the channels and exits 1 — EXECUTED, forced to fail", () => {
      // ⛔ THE CONTROL THIS FILE EXISTS FOR. Both this step and the upload are
      // `if: always()`, so a redaction that merely FAILED would make the run red while
      // the unredacted channels shipped anyway — a control whose failure still
      // publishes the thing it exists to withhold is not a control. The step's answer
      // is to DESTROY the .err/.log/.out channels on any failure. That is executed
      // here, with the substitution forced to fail (`false` in place of `sed`) so the
      // failure is deterministic on every platform rather than depending on which
      // sed the developer has.
      const script = extractRunScript(WF, REDACT);
      expect(
        script.includes("if sed -i -E \\"),
        "the redaction step's substitution is no longer the `if sed -i -E \\` form this twin forces to fail — re-anchor the mutation rather than deleting the twin",
      ).toBe(true);
      const forced = script.replace("if sed -i -E \\", "if false -i -E \\");

      const runnerTemp = mkdtempSync(join(tmpdir(), "redact-run-"));
      const outdir = join(runnerTemp, "test-backup");
      mkdirSync(outdir);
      const channels = ["psql.err", "dump.log", "transaction.out"];
      const keepers = ["schema.sql", "ledger.csv"];
      for (const f of [...channels, ...keepers]) {
        writeFileSync(join(outdir, f), "host=db.exampleprojref.supabase.co\n");
      }
      const scriptFile = join(runnerTemp, "redact.sh");
      writeFileSync(scriptFile, forced);
      const r = spawnSync("bash", [scriptFile], {
        encoding: "utf8",
        env: { ...process.env, RUNNER_TEMP: runnerTemp },
      });
      const surviving = readdirSync(outdir).sort();
      rmSync(runnerTemp, { recursive: true, force: true });

      expect(
        r.status,
        `a failed substitution did not fail the step (exit ${r.status}). The upload is \`if: always()\`; a green redaction step is the only thing that makes the artifact safe to publish.\n${r.stdout}${r.stderr}`,
      ).toBe(1);
      for (const c of channels) {
        expect(
          surviving.includes(c),
          `\`${c}\` SURVIVED a failed redaction and would be uploaded unredacted to a world-readable artifact`,
        ).toBe(false);
      }
      expect(
        surviving,
        "the fail-closed path destroyed the reversal recipe too — schema.sql and ledger.csv carry no connection metadata and are what makes the act reversible",
      ).toEqual(keepers.slice().sort());
      expect(`${r.stdout}${r.stderr}`).toContain("::error::");
      expect(`${r.stdout}${r.stderr}`).toContain("WITHHELD");
    });
  });

  describe("B4 — the workflow's marker gate is coupled to the script's constants", () => {
    it("both hard-coded regexes still equal the script's RESTORE_*_MARKER_RE defaults", () => {
      // ⛔ THE FAILURE DIRECTION. The workflow hard-codes COPIES of two script
      // defaults, and this step is the EARLIER and CHEAPER of the two gates: it
      // refuses before `supabase db dump` reads anything. Tighten the script's
      // defaults without tightening these copies and the cheap gate silently becomes
      // the WEAKER one — it admits a database the script would refuse, after the
      // backup has already read it and written it into a PUBLIC artifact. Nothing but
      // this pin couples them.
      //
      // ⭐ READ BY SYMBOL, never by line number: the script's constants move.
      const defaultOf = (name: string): string => {
        const m = SCRIPT.match(
          new RegExp(`^${name}="\\$\\{${name}:-(.*)\\}"$`, "m"),
        );
        expect(
          m,
          `${SCRIPT_PATH} no longer declares \`${name}\` as a \`\${${name}:-<default>}\` assignment on one line. This pin reads it by SYMBOL on purpose — re-anchor it rather than restating the regex here.`,
        ).not.toBeNull();
        return (m as RegExpMatchArray)[1];
      };
      const expectRe = defaultOf("RESTORE_EXPECT_MARKER_RE");
      const refuseRe = defaultOf("RESTORE_REFUSE_MARKER_RE");

      const marker = stepBody(WF, "Which database am I on");
      expect(marker, "the `Which database am I on` step is gone").not.toBe("");
      const greps = liveLines(marker)
        .map((l) => l.match(/grep -Eiq '([^']*)'/))
        .filter((m): m is RegExpMatchArray => m !== null)
        .map((m) => m[1]);
      expect(
        greps,
        "the marker step's two `grep -Eiq '…'` tests are no longer exactly the script's expect-then-refuse defaults, in that order. Whichever side was tightened, tighten the other: this step runs BEFORE the backup, so a workflow regex looser than the script's admits a database the script would refuse.",
      ).toEqual([expectRe, refuseRe]);

      // CALIBRATION — tighten the SCRIPT's default only, exactly the one-sided edit
      // this pin exists to catch, and the pin must flip.
      const tightened = SCRIPT.replace(
        "RESTORE_REFUSE_MARKER_RE:-prod",
        "RESTORE_REFUSE_MARKER_RE:-prod|production",
      );
      expect(tightened, "CALIBRATION: the mutation changed nothing").not.toBe(SCRIPT);
      const mutatedRefuse = (tightened.match(
        /^RESTORE_REFUSE_MARKER_RE="\$\{RESTORE_REFUSE_MARKER_RE:-(.*)\}"$/m,
      ) as RegExpMatchArray)[1];
      expect(
        greps[1] === mutatedRefuse,
        "CALIBRATION: the workflow's copy matched the TIGHTENED script default too, so the pin cannot see a one-sided tightening",
      ).toBe(false);
    });
  });

  describe("no softening: a failure here can never read as a pass", () => {
    it("no softening token survives in the restore job (mutex steps excluded, see the comment)", () => {
      expect(
        softeningOffenders(WF),
        "a softening token appeared in the restore job outside the two ci.yml-copied mutex steps",
      ).toEqual([]);
      calibrate(
        "the softening scan bites",
        (s) =>
          s.replace(
            "      - name: Run the restore script\n",
            "      - name: Run the restore script\n        continue-on-error: true\n",
          ),
        (t) => softeningOffenders(t).length === 0,
      );
      calibrate(
        "the softening scan bites on a bare `exit 0` too",
        (s) =>
          s.replace(
            '          bash scripts/restore-test-from-baseline.sh --run --mode "$MODE"\n',
            '          bash scripts/restore-test-from-baseline.sh --run --mode "$MODE" || exit 0\n',
          ),
        (t) => softeningOffenders(t).length === 0,
      );
    });
  });

  describe("cross-file: the mutex protocol is ci.yml's, byte for byte", () => {
    it("the acquire suffix is byte-identical to ci.yml's, and our prefix fails loud", () => {
      const ciStep = CI.match(ACQUIRE_RE)?.[0] ?? "";
      const wfStep = WF.match(ACQUIRE_RE)?.[0] ?? "";
      expect(ciStep, "ci.yml's Acquire step could not be extracted").not.toBe("");
      expect(wfStep, `${WF_PATH}'s Acquire step could not be extracted`).not.toBe("");
      const suffix = (s: string): string => s.slice(s.indexOf(SUFFIX_ANCHOR));
      expect(
        suffix(wfStep),
        "the copied mutex protocol has DRIFTED from ci.yml's. Every invariant in that step (session-mode DSN, libpq keepalives, statement_timeout=0, client_connection_check_interval, the 3600s cap, the two-cause error) was reasoned about once and is applied everywhere; a one-site drift means this destructive workflow runs a DIFFERENT protocol than the three CI jobs it shares the lock with. Re-sync the copy — do not edit it here.",
      ).toBe(suffix(ciStep));

      const prefix = wfStep.slice(0, wfStep.indexOf(SUFFIX_ANCHOR));
      expect(
        prefix.includes("exit 0"),
        "the fork-PR early exit SURVIVED in the credential branch. ci.yml's copy may exit 0 there because a fork PR legitimately has no secret; this workflow has no pull_request trigger, so an absent credential is a FAULT — and exiting 0 would hand a DESTRUCTIVE job an unlocked shared database.",
      ).toBe(false);
      expect(
        prefix.includes("exit 1"),
        "the credential branch of the acquire step no longer exits 1",
      ).toBe(true);

      calibrate(
        "the byte-identity pin bites on a one-token drift",
        (s) => s.replace("SELECT pg_advisory_lock(61616158);", "SELECT pg_advisory_lock(61616159);"),
        (t) => {
          const w = t.match(ACQUIRE_RE)?.[0] ?? "";
          return w !== "" && suffix(w) === suffix(ciStep);
        },
      );
      calibrate(
        "the fork-PR exit-0 pin bites",
        (s) =>
          s.replace(
            '            echo "::error::TEST_SUPABASE_DB_URL is empty at the mutex acquire.',
            '            exit 0\n            echo "::error::TEST_SUPABASE_DB_URL is empty at the mutex acquire.',
          ),
        (t) => {
          const w = t.match(ACQUIRE_RE)?.[0] ?? "";
          return !w.slice(0, w.indexOf(SUFFIX_ANCHOR)).includes("exit 0");
        },
      );
    });

    it("the release step is byte-identical to ci.yml's, if: always() included", () => {
      const ciStep = CI.match(RELEASE_RE)?.[0] ?? "";
      const wfStep = WF.match(RELEASE_RE)?.[0] ?? "";
      expect(ciStep).not.toBe("");
      expect(
        wfStep,
        "the release step drifted from ci.yml's. It is the one step here allowed to end zero-status; that licence is ci.yml's reasoning, and it only transfers while the copy is exact.",
      ).toBe(ciStep);
      calibrate(
        "the release byte-identity pin bites",
        (s) => s.replace("      - name: Release shared-test-db mutex (best effort)\n        if: always()\n", "      - name: Release shared-test-db mutex (best effort)\n"),
        (t) => (t.match(RELEASE_RE)?.[0] ?? "") === ciStep,
      );
    });
  });

  describe("the header carries the dispatch recipe an operator actually needs", () => {
    it("both dispatch commands are in the header, and the guard prints the preflight one", () => {
      const header = headerBlock(WF);
      const preflight =
        "gh workflow run test-restore-from-baseline.yml --ref main -f mode=preflight";
      const restore =
        "gh workflow run test-restore-from-baseline.yml --ref main -f mode=restore -f confirm=";
      expect(header, "the header lost the preflight dispatch recipe").toContain(preflight);
      expect(header, "the header lost the restore dispatch recipe").toContain(restore);
      expect(
        jobBlock(WF, GUARD_JOB),
        "the dispatch-guard no longer prints the correct dispatch — that message is the one thing an operator reads at the moment they mis-dispatched",
      ).toContain(preflight);
      expect(
        header,
        "the header no longer says that a workflow_dispatch workflow is only dispatchable from the DEFAULT branch — Plan 04's first checkpoint is 'merge this PR', and without this sentence the first dispatch fails with a confusing 'could not find any workflows named'",
      ).toContain("DEFAULT branch");
      expect(
        header,
        "the header no longer states the publication-row hazard and its founder-run remedy (W3)",
      ).toContain("ALTER PUBLICATION supabase_realtime DROP TABLE public.");
    });
  });
});

// ---------------------------------------------------------------------------
// W5 — EXECUTED, not grepped.
// ---------------------------------------------------------------------------
describe("164.8-03 W5 — the PROD-ledger premise assert is EXECUTED under stubs", () => {
  const READER = "Read PROD's newest migration apply";
  const ASSERTER = "Assert PROD's ledger equals the repo file set";

  const workdir = mkdtempSync(join(tmpdir(), "w5-"));
  const bindir = join(workdir, "bin");
  mkdirSync(bindir);

  // A `gh` that returns whatever reading the scenario asks for. Every property under
  // test is shell/jq logic; no GitHub API is involved in the decision the steps make.
  writeFileSync(
    join(bindir, "gh"),
    `#!/bin/bash
if [ "$1" = "run" ] && [ "$2" = "list" ]; then
  if [ "\${STUB_EMPTY:-0}" = "1" ]; then echo "[]"; exit 0; fi
  printf '[{"status":"%s","conclusion":"%s","headSha":"%s"}]\\n' \\
    "\${STUB_STATUS}" "\${STUB_CONCLUSION}" "\${STUB_SHA}"
  exit 0
fi
echo "stub gh: unexpected invocation: $*" >&2
exit 64
`,
  );
  chmodSync(join(bindir, "gh"), 0o755);

  const readerPath = join(workdir, "reader.sh");
  const asserterPath = join(workdir, "asserter.sh");
  writeFileSync(readerPath, extractRunScript(WF, READER));
  writeFileSync(asserterPath, extractRunScript(WF, ASSERTER));

  // A throwaway repository: A is an ancestor of HEAD; C (on a side branch) is not.
  const repo = mkdtempSync(join(tmpdir(), "w5-repo-"));
  const git = (args: string[]): string => {
    const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
    return (r.stdout ?? "").trim();
  };
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "w5@example.invalid"]);
  git(["config", "user.name", "w5"]);
  writeFileSync(join(repo, "a.txt"), "a\n");
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "a"]);
  const ANCESTOR_SHA = git(["rev-parse", "HEAD"]);
  git(["checkout", "-q", "-b", "side"]);
  writeFileSync(join(repo, "c.txt"), "c\n");
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "c"]);
  const SIDE_SHA = git(["rev-parse", "HEAD"]);
  git(["checkout", "-q", "main"]);
  writeFileSync(join(repo, "b.txt"), "b\n");
  git(["add", "-A"]);
  git(["commit", "-q", "-m", "b"]);

  afterAll(() => {
    rmSync(workdir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  let seq = 0;
  function runReader(stub: Record<string, string>): {
    code: number | null;
    out: string;
    outputs: Record<string, string>;
  } {
    seq += 1;
    const outFile = join(workdir, `gh-output-${seq}.txt`);
    writeFileSync(outFile, "");
    const r = spawnSync("bash", [readerPath], {
      cwd: repo,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bindir}:${process.env.PATH ?? ""}`,
        GH_TOKEN: "stub-token",
        GITHUB_OUTPUT: outFile,
        ...stub,
      },
    });
    const outputs: Record<string, string> = {};
    for (const line of readFileSync(outFile, "utf8").split("\n")) {
      const eq = line.indexOf("=");
      if (eq > 0) outputs[line.slice(0, eq)] = line.slice(eq + 1);
    }
    return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}`, outputs };
  }

  function runAsserter(outputs: Record<string, string>): { code: number | null; out: string } {
    const r = spawnSync("bash", [asserterPath], {
      cwd: repo,
      encoding: "utf8",
      env: {
        ...process.env,
        APPLY_STATUS: outputs.status ?? "",
        APPLY_CONCLUSION: outputs.conclusion ?? "",
        APPLY_HEAD_SHA: outputs.head_sha ?? "",
      },
    });
    return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  }

  it("(success, completed, an ANCESTOR sha) → both steps exit 0", () => {
    const reader = runReader({
      STUB_STATUS: "completed",
      STUB_CONCLUSION: "success",
      STUB_SHA: ANCESTOR_SHA,
    });
    expect(reader.code, `reader failed: ${reader.out}`).toBe(0);
    expect(reader.outputs).toEqual({
      status: "completed",
      conclusion: "success",
      head_sha: ANCESTOR_SHA,
    });
    const asserted = runAsserter(reader.outputs);
    expect(asserted.code, `asserter failed on the GREEN reading: ${asserted.out}`).toBe(0);
    expect(asserted.out).toContain("PROD-ledger premise holds");
  });

  it("(FAILURE, completed, an ancestor sha) → exit 1 naming `conclusion`", () => {
    const reader = runReader({
      STUB_STATUS: "completed",
      STUB_CONCLUSION: "failure",
      STUB_SHA: ANCESTOR_SHA,
    });
    expect(reader.code).toBe(0);
    const asserted = runAsserter(reader.outputs);
    expect(
      asserted.code,
      "a FAILED PROD apply did not stop the restore — the ledger seed would write one row per repo file claiming a parity PROD does not have",
    ).toBe(1);
    expect(asserted.out).toContain("conclusion");
    expect(asserted.out).toContain("::error::");
  });

  it("(success, completed, a NON-ancestor sha) → exit 1 naming `ancestor`", () => {
    const reader = runReader({
      STUB_STATUS: "completed",
      STUB_CONCLUSION: "success",
      STUB_SHA: SIDE_SHA,
    });
    expect(reader.code).toBe(0);
    const asserted = runAsserter(reader.outputs);
    expect(
      asserted.code,
      "a green PROD apply at a sha this checkout does NOT descend from was accepted — the premise is about THIS tree, not about any green run",
    ).toBe(1);
    expect(asserted.out).toContain("ancestor");
  });

  it("(status still in progress) → exit 1 naming `status`", () => {
    const asserted = runAsserter({
      status: "in_progress",
      conclusion: "",
      head_sha: ANCESTOR_SHA,
    });
    expect(asserted.code).toBe(1);
    expect(asserted.out).toContain("status");
  });

  it("a reading with ZERO runs is exit 1 at the READER, before any judgement", () => {
    const reader = runReader({ STUB_EMPTY: "1", STUB_STATUS: "", STUB_CONCLUSION: "", STUB_SHA: "" });
    expect(
      reader.code,
      "gh returning no supabase-migrate.yml runs on main was tolerated — that reading means PROD has never applied a migration through that workflow, i.e. there is NO evidence for the parity the seed claims",
    ).toBe(1);
    expect(reader.out).toContain("expected exactly 1");
  });

  it("the premise steps are the ones the workflow actually runs (extraction is not a mock)", () => {
    expect(extractRunScript(WF, ASSERTER)).toContain("git merge-base --is-ancestor");
    expect(extractRunScript(WF, READER)).toContain(
      "gh run list --workflow supabase-migrate.yml --branch main -L 1",
    );
  });
});

// ---------------------------------------------------------------------------
// The post-verify's ErrMissingLocal diagnosis, and the ORDER that makes it
// reachable.
//
// ⛔ WHY THIS EXISTS. Until 2026-09-08 the third assertion in this step was
// `grep -q 'Reverted'`. That capitalised token occurs ZERO times in the pinned
// 2.98.2 binary (measured by installing it and running `strings -a <bin> |
// grep -cF Reverted`) and zero times in 2.84.2. It could never match: it failed
// OPEN and was not evidence about anything. The wording the CLI actually emits
// comes from `internal/migration/up.suggestRevertHistory`.
//
// ⛔ AND WHY ORDER IS THE LOAD-BEARING HALF. ErrMissingLocal exits NON-ZERO, so a
// generic `rc` check placed first consumes it and reports the wrong cause — "the
// CLI could not read the ledger" for what is really a remote row with no local
// file. Swapping the two branches back would leave every string below present
// and every specific diagnosis unreachable, which is why the pin is on the
// ORDER and is proved by EXECUTION, not by substring presence alone.
// ---------------------------------------------------------------------------
describe("post-verify — the ErrMissingLocal diagnosis is reachable", () => {
  const STEP = "Post-verify with the Supabase CLI — ledger SHAPE";
  const SENTENCE = "Remote migration versions not found in local migrations directory.";

  it("the CLI's own ErrMissingLocal sentence is tested BEFORE the generic rc branch", () => {
    const body = extractRunScript(WF, STEP);
    const at = body.indexOf(`grep -aqF '${SENTENCE}'`);
    expect(
      at,
      `the post-verify no longer tests for the CLI's ErrMissingLocal sentence. Do not reinstate a \`Reverted\` grep in its place: that token does not exist in the pinned binary.`,
    ).toBeGreaterThan(-1);
    expect(
      at,
      "the ErrMissingLocal test no longer precedes the generic `rc` branch, so the specific diagnosis is unreachable — a non-zero exit is consumed by the general message first",
    ).toBeLessThan(body.indexOf('if [ "${rc}" -ne 0 ]'));

    // The dead token must not come back — checked on the step's LIVE lines only.
    // Scanning the whole file would match the comment above the step that RECORDS
    // why the grep was removed, which is the note a future reader most needs.
    const live = body
      .split("\n")
      .filter((l) => !l.trim().startsWith("#"))
      .join("\n");
    expect(
      /grep [^\n]*'Reverted'/.test(live),
      "a `grep 'Reverted'` was reinstated. Measured 2026-09-08: zero occurrences of that capitalised token in the pinned 2.98.2 binary, so the test cannot fail and is not evidence.",
    ).toBe(false);
  });

  it("EXECUTED — a missing-local dry run reports the specific cause, not the generic one", () => {
    const body = extractRunScript(WF, STEP);
    const runWithStub = (stdout: string, rc: number): string => {
      const dir = mkdtempSync(join(tmpdir(), "postverify-"));
      const bin = join(dir, "bin");
      const runnerTemp = join(dir, "tmp");
      for (const d of [bin, runnerTemp]) mkdirSync(d, { recursive: true });
      writeFileSync(join(bin, "supabase"), `#!/bin/bash\ncat <<'EOF'\n${stdout}\nEOF\nexit ${rc}\n`);
      chmodSync(join(bin, "supabase"), 0o755);
      const script = join(dir, "step.sh");
      writeFileSync(script, body);
      const r = spawnSync("bash", [script], {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          RUNNER_TEMP: runnerTemp,
          TEST_DB_SESSION_URL: "postgresql://EXAMPLE_USER:EXAMPLE_PASSWORD@example.invalid:5432/postgres",
        },
      });
      rmSync(dir, { recursive: true, force: true });
      return `${r.stdout ?? ""}${r.stderr ?? ""}`;
    };

    const out = runWithStub(`${SENTENCE}\nTry supabase migration repair --status reverted`, 1);
    expect(
      out.includes("remote migration versions with no local file"),
      `a missing-local dry run did not produce the specific diagnosis. If it produced the generic "could not read the ledger" instead, the two branches have been reordered.\n${out}`,
    ).toBe(true);
    expect(
      out.includes("The CLI could not read the ledger"),
      "the generic rc message fired for a missing-local run — it consumed the specific case, which is exactly the ordering defect this pin exists to catch",
    ).toBe(false);

    // CALIBRATION — a genuine connection failure must still reach the generic
    // branch, so the pin above is measuring ORDER and not just string presence.
    const generic = runWithStub("Connection refused", 1);
    expect(generic.includes("The CLI could not read the ledger")).toBe(true);
    expect(generic.includes("remote migration versions with no local file")).toBe(false);
  });
});
