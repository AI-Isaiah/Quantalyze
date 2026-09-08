/**
 * test-restore-from-baseline WIRING PIN — Phase 164.8 plan 03.
 *
 * ⛔ THE DEFECT THIS FILE CATCHES. `scripts/restore-test-from-baseline.sh` proves its
 * own contract with `--self-test`: eighteen counted arms, each with a falsifier that
 * was observed RED (`164.8-02-SUMMARY.md`). NONE of that survives a WORKFLOW that
 * invokes it differently. A second trigger key, a commented-out `environment:`, a
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
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = process.cwd();
const WF_PATH = ".github/workflows/test-restore-from-baseline.yml";
const CI_PATH = ".github/workflows/ci.yml";
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");
const WF = read(WF_PATH);
const CI = read(CI_PATH);

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
