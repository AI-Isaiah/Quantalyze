#!/usr/bin/env node
/**
 * prod-prober — the periodic production prober (phase 164.1).
 *
 * ============================================================================
 * CLI CONTRACT — .github/workflows/prod-prober.yml pastes this VERBATIM (plan 05).
 * ============================================================================
 *
 *   node scripts/prod-prober/run.mjs                              # live run, ALL arms
 *   node scripts/prod-prober/run.mjs --self-test                  # fixtures only, NO network
 *   node scripts/prod-prober/run.mjs --arm <name>                 # narrowed DIAGNOSTIC (never exits 0)
 *   node scripts/prod-prober/run.mjs --capture-manifest --out <p> # capture the cron oracle FROM PROD
 *
 * Registered arms (FOUR, equal to ARMS_FLOOR): pyapi06, cron-obs, cron-drift, mt5.
 *
 * Exit codes:
 *   0  live run, every registered arm executed and measured, no defects, floors held
 *   1  at least one defect, a floor regression, or an ABSURDITY — the prober's
 *      two independent tallies of its own work disagree.
 *      ⚠️ The floor is now MET BY THE REGISTRY (4 arms / floor 4), so a `floor`
 *      defect no longer means "not finished yet" — it means AN ARM WAS REMOVED.
 *   2  NARROWED DIAGNOSTIC RUN that found no defects. Deliberately NOT 0: a run
 *      that executed a subset of arms must never be mistakable for a passing
 *      gate. That mistake — a partial check reading as a full PASS — is the
 *      SKIP-01 shape this phase exists to eliminate.
 *   3  usage or environment error
 *
 * ⚠️ Local and CI invocations must be byte-identical in MODE. A wrapper that
 * changes the invocation changes the result.
 *
 * ============================================================================
 * TWO RULES THAT ARE NOT NEGOTIABLE
 * ============================================================================
 *
 * D-04 — ALL REGISTERED ARMS RUN, EVERY TIME, AND THE EXIT CODE IS DECIDED
 * ONCE, AT THE END. There is no early return on the first failing arm. A
 * first-failure exit is precisely the OPS-08-F8 defect: it hides every fault
 * behind whichever one happened to be checked first, so the second outage is
 * only discovered after the first is fixed. Arms aggregate into one defect
 * table and the table decides the exit code.
 *
 * D-06 — AN ABSENT CREDENTIAL IS A HARD FAILURE NAMING THE CREDENTIAL, NEVER A
 * SKIP. `.github/workflows/phase-19-stability.yml:54-58` is the shape that is
 * forbidden here: an unset secret prints a `::warning::` and then `exit 0`, so
 * a soak gate that measured NOTHING reads green forever. In this runner an
 * absent name is a `credential-absent` defect, the arm is BLOCKED (its `run` is
 * never invoked, so it cannot report a misleading verdict either), and the run
 * exits 1. There is no code path that returns 0 with a credential absent.
 *
 * ⛔ NEVER PRINTS A VALUE. Only env NAMES, status codes, machine codes, counts
 * and — beside a defect only — the first 200 chars of a response body. Every
 * string is additionally passed through a scrubber that replaces any non-empty
 * `requiredEnv` VALUE with `<redacted>` before it reaches the log or a defect
 * row. This repository and its Actions logs are public (threat T-164.1-01).
 *
 * ============================================================================
 * WHAT DEFECT CLASS THIS EXISTS FOR
 * ============================================================================
 * Four production outages, each MEASURED, each of which ran for days while
 * every instrument anyone was looking at read green. They are not four
 * unrelated bugs; they are one shape — a signal that was never actually
 * observed, standing in for one that was.
 *
 * PYAPI-06 — the analytics service key. 2026-08-25: five consecutive 401s from
 * the analytics service with ZERO mismatch lines anywhere. `/health` is
 * unauthenticated, so it stayed green throughout and said nothing about the
 * key; a 401 never trips the 140.2 breaker either. A trailing newline on a
 * pasted secret is enough to produce it. Nothing measured the key end to end.
 *
 * CRON-OBS-01 — the async cron HTTP result. PROD `cron.job` jobid 1 answered
 * 401 EVERY HOUR FOR SEVEN DAYS behind a completely green cron history.
 * ⛔ THE STANDING RULE THIS BUYS: `cron.job_run_details.status` IS NOT
 * EVIDENCE. `net.http_post` is ASYNC — the job row records that the request
 * was ENQUEUED, and reads `succeeded` whether the far end answered 200, 401 or
 * nothing at all. The only place the real answer lives is `net._http_response`,
 * and before this prober nothing in this repository read it.
 *
 * CRON-DRIFT-01 — the inline key nobody compared. PROD's `cron.job` command
 * can be OLDER than the repo's migration, or carry an inline credential that no
 * migration ever contained, and no gate compared the two. The oracle is a
 * COMMITTED manifest of the ACHIEVABLE Vault-backed command (D-13), not
 * something derived from migrations: `20260408215026`'s GUC design returns
 * 42501 on Supabase and could never have run here, so deriving from migrations
 * would enshrine an unrunnable design as the standard PROD is judged against.
 *
 * MT5-WEDGE-OBS-01 — the modal dialog behind a healthy container. The MT5
 * terminal wedged into a -10005 IPC timeout THREE TIMES IN ONE DAY while its
 * container was healthy and its logs were quiet, because a modal login dialog
 * was blocking the IPC bridge — and that dialog survives redeploys via the
 * persistent volume. -10004 (bridge not attached) and -10005 (bridge attached,
 * terminal not answering) have opposite remedies, so reporting them as one
 * failure is not a shortcut, it is a wrong instruction to the operator.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createSeams, realFetch, realSqlRunner, realSshRunner } from "./seams.mjs";
import { ARM as PYAPI06_ARM } from "./arms/pyapi06.mjs";
// Namespace import: the mt5 scenarios assert against the COMMITTED probe
// constant and the argv builder as well as the ARM.
import * as MT5_MOD from "./arms/mt5.mjs";
// Namespace imports: the SQL-read-only self-test scenario ranges over every
// exported `*_SQL` constant of every SQL arm, which needs the whole namespace
// rather than the ARM alone.
import * as CRON_OBS_MOD from "./arms/cron-obs.mjs";
import * as CRON_DRIFT_MOD from "./arms/cron-drift.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = join(HERE, "fixtures");

/**
 * The arm modules that issue SQL. Their exported `*_SQL` constants are asserted
 * READ-ONLY by a self-test scenario — the assertion ranges over this list, so an
 * arm added without being listed here is caught by the same scenario's
 * "every SQL arm contributes at least two constants" leg rather than silently
 * escaping the check.
 */
const SQL_ARM_MODULES = [
  { name: "cron-obs", module: CRON_OBS_MOD },
  { name: "cron-drift", module: CRON_DRIFT_MOD },
];

/**
 * The committed cron oracle the `cron-drift` arm compares PROD against (D-13).
 * RE-EXPORTED from the arm that owns it, so the path is one string in one
 * place; plan 06 captures the file itself from PROD.
 */
export const MANIFEST_PATH = CRON_DRIFT_MOD.MANIFEST_PATH;

/**
 * D-08 — the pinned arm floor. FOUR: pyapi06, cron-obs, cron-drift, mt5.
 *
 * ✅ MET as of plan 04: the registry is exactly four, so a live run no longer
 * reports `floor`. From here a `floor` defect means an arm was REMOVED.
 *
 * ⚠️ This number was pinned at 4 while only ONE arm existed, on purpose: for
 * two plans a live run reported `1 registered arm(s) < floor 4` and exited 1,
 * because an incomplete prober must be LOUD. The alternative — ratcheting the
 * floor up as arms land — is a floor that can only ever agree with reality,
 * which is not a floor. Lowering this number is how an arm disappears quietly.
 */
export const ARMS_FLOOR = 4;

/** The counted `--self-test` scenario set. See the renumbering warning on `selfTest`. */
export const SELF_TEST_SCENARIOS = 60;

/**
 * Every defect this prober can report. EXPORTED so the plan-05 wiring test can
 * range over it rather than restating it — a list restated in a test is a
 * second thing to drift; a list the implementation owns is not.
 *
 * ⚠️ ALL TWENTY KINDS WERE REGISTERED UP FRONT in plan 01, including the cron
 * and mt5 kinds no arm raised yet. Plans 03 and 04 then added SCENARIOS, not
 * kinds, and the wiring test's `EXPECTED_DEFECT_KINDS` pin never had to move
 * for an arm that was always going to land. ✅ Every one of the twenty is now
 * raised by a registered arm and asserted BY NAME in `selfTest`.
 */
export const DEFECT_KINDS = [
  // harness-wide
  "credential-absent",
  "measure-fail",
  // pyapi06 (plan 01)
  "pyapi06-keyed-refused",
  "pyapi06-absent-accepted",
  "pyapi06-absent-uncoded",
  "pyapi06-wrong-key-accepted",
  "pyapi06-health-degraded",
  // cron-obs + cron-drift (plan 03)
  "cron-no-observation",
  "cron-non-2xx",
  "cron-transport-error",
  "cron-drift",
  "cron-secret-in-command",
  "manifest-invalid",
  // mt5 (plan 04)
  "mt5-no-ipc",
  "mt5-ipc-timeout",
  "mt5-ssh-transport",
  "mt5-probe-timeout",
  "mt5-terminal-error",
  // floors — findings about the INSTRUMENT, not about production
  "floor",
  "absurdity",
];

/**
 * The registered arms — FOUR, equal to `ARMS_FLOOR`. Removing one is a `floor`
 * defect on the next run, which is the point.
 */
export const ARMS = [PYAPI06_ARM, CRON_OBS_MOD.ARM, CRON_DRIFT_MOD.ARM, MT5_MOD.ARM];

/**
 * Per-NAME remedy for `credential-absent`. Names only — these strings are
 * printed into a public Actions log.
 */
const CREDENTIAL_REMEDIES = {
  ANALYTICS_BASE_URL:
    "Set the repo variable ANALYTICS_BASE_URL to the public analytics base URL (the same default .github/workflows/analytics-deploy-verify.yml carries).",
  ANALYTICS_SERVICE_KEY:
    "Set the GitHub Actions secret ANALYTICS_SERVICE_KEY from Railway's SERVICE_KEY, through a trimming pipe — Railway is the source of truth, copy Railway → GitHub, never the reverse.",
  PROBER_POOLER_URL:
    "Set PROBER_POOLER_URL to the PROD Supabase SESSION POOLER URL (port 5432, IPv4) WITHOUT a password in it — the password travels separately as PGPASSWORD. The workflow must add-mask it before any step can print it.",
  SUPABASE_DB_PASSWORD:
    "Set the existing GitHub Actions secret SUPABASE_DB_PASSWORD on the prod-prober workflow's job. It is passed to psql as PGPASSWORD in the child environment only, never inside the URL.",
  RAILWAY_API_TOKEN:
    "Set the GitHub Actions secret RAILWAY_API_TOKEN to a WORKSPACE- or ACCOUNT-scoped Railway token. ⛔ The CLI's other, shorter credential variable — the PROJECT slot — is a DIFFERENT slot and `railway ssh` refuses it, so a project-scoped token would make every run report mt5-ssh-transport for a self-inflicted reason.",
  RAILWAY_PROJECT_ID:
    "Set the repo variable RAILWAY_PROJECT_ID to the Railway project id that hosts the mt5-gateway service. It is a repo VARIABLE, not a secret, and reaches the CLI only as the -p flag.",
  RAILWAY_MT5_SERVICE:
    "Set the repo variable RAILWAY_MT5_SERVICE to the gateway service name (mt5-gateway). It is a repo VARIABLE, not a secret, and reaches the CLI only as the -s flag.",
  RAILWAY_ENVIRONMENT:
    "Set the repo variable RAILWAY_ENVIRONMENT to the Railway environment the gateway runs in (production). It is a repo VARIABLE, not a secret, and reaches the CLI only as the -e flag.",
};

const DEFAULT_CREDENTIAL_REMEDY =
  "Set this name in the prod-prober workflow's env (a secret if it is credential material, a repo variable otherwise). An absent credential is a failing run, never a skipped one.";

// ---------------------------------------------------------------------------
// Value scrubbing (threat T-164.1-01)
// ---------------------------------------------------------------------------

/**
 * Build a function that replaces every non-empty `requiredEnv` VALUE with
 * `<redacted>`.
 *
 * Longest value first, so a value that contains another does not leave a
 * fragment behind. This is the BELT; each arm's own never-print-a-value
 * discipline is the braces. Self-test scenario 12 injects sentinel values and
 * asserts no captured line and no defect detail carries them.
 */
/**
 * Env NAMES whose values are PUBLIC IDENTIFIERS, not credentials.
 *
 * All three are GitHub `vars`, never `secrets`; all three appear verbatim in
 * `.github/workflows/prod-prober.yml`; and their LIVE values are ordinary
 * words ("production", "mt5-gateway"). Redacting them protects nothing and
 * destroys the one row an operator reads when the transport is broken —
 * measured at plan 04 as `the <redacted> relay refused the <redacted> session`
 * (WINDOWS 37). The step summary and the auto-filed issue copy that log
 * verbatim (D-03), so the damage reaches the first thing a human sees.
 *
 * ⛔ A name goes on this list ONLY if its value is already public in a
 * committed file. Everything NOT listed is redacted regardless of length:
 * there is deliberately NO minimum-length exemption, because a short secret is
 * still a secret and a length floor would be fail-OPEN. WINDOWS 36 (a
 * one-character password mangling unrelated text) is therefore left standing
 * ON PURPOSE — it is the fail-SAFE cost, and trading it for a fail-open rule
 * would be a strictly worse control.
 *
 * ⚠️ `ANALYTICS_BASE_URL` is deliberately NOT here: self-test scenario 12 pins
 * it as redacted, and a base URL is worth not echoing even though it is not
 * secret. This list is the minimum that closes WINDOWS 37, nothing wider.
 */
export const NON_SECRET_ENV = ["RAILWAY_PROJECT_ID", "RAILWAY_MT5_SERVICE", "RAILWAY_ENVIRONMENT"];

function makeScrubber(arms, env) {
  const values = [];
  for (const arm of arms) {
    for (const name of arm.requiredEnv) {
      if (NON_SECRET_ENV.includes(name)) continue;
      const value = env[name];
      if (typeof value === "string" && value.length > 0) values.push(value);
    }
  }
  values.sort((a, b) => b.length - a.length);
  return (text) => {
    if (typeof text !== "string") return text;
    let out = text;
    for (const value of values) out = out.split(value).join("<redacted>");
    return out;
  };
}

// ---------------------------------------------------------------------------
// The absurdity floor: the prober's own counts must agree
// ---------------------------------------------------------------------------

/**
 * Cross-check the verdict loop's count of executed arms against the seams'
 * independent count of I/O that actually happened.
 *
 * An arm the loop believes it ran, that made NO seam call, did not measure
 * anything — and a report built on it is not a measurement. This is the one
 * floor that catches a stubbed, mocked or short-circuited run from INSIDE the
 * process, which is why the self-test can prove it fires: a seam wrapper that
 * skips the tally produces executed=1 / seam-invocations=0 by construction.
 *
 * @param {{armsExecuted: number, seamInvocations: number, armsWithSeamActivity: number}} counts
 * @returns {string[]} one sentence per violation; empty when the counts agree
 */
export function absurdityViolations({ armsExecuted, seamInvocations, armsWithSeamActivity }) {
  const gate = "MEASURE_FAIL — this is the GATE failing, not production:";
  const tail = `(executed=${armsExecuted} seam-invocations=${seamInvocations} arms-with-seam-activity=${armsWithSeamActivity})`;
  const isCount = (n) => Number.isInteger(n) && n >= 0;

  // An absent or malformed measurement must never read as a consistent one.
  if (![armsExecuted, seamInvocations, armsWithSeamActivity].every(isCount)) {
    return [
      `${gate} the three counts cannot be cross-checked because at least one is not a non-negative ` +
        `integer ${tail}. An unmeasurable count is not a count of zero.`,
    ];
  }

  const out = [];
  if (armsExecuted > armsWithSeamActivity) {
    out.push(
      `${gate} the verdict loop counted ${armsExecuted} executed arm(s) but only ` +
        `${armsWithSeamActivity} arm(s) recorded a single seam invocation of their own ${tail}. ` +
        `${armsExecuted - armsWithSeamActivity} arm(s) were CLAIMED without performing any I/O — ` +
        `neither the arms line nor the defect table above is a measurement on this run.`,
    );
  }
  if (armsWithSeamActivity > armsExecuted) {
    out.push(
      `${gate} ${armsWithSeamActivity} arm(s) performed I/O but the verdict loop counted only ` +
        `${armsExecuted} executed arm(s) ${tail}. Work happened that no verdict describes.`,
    );
  }
  if (armsExecuted > seamInvocations) {
    out.push(
      `${gate} the verdict loop counted ${armsExecuted} executed arm(s) against ${seamInvocations} ` +
        `total seam invocation(s) ${tail}. An arm cannot execute without touching a seam.`,
    );
  }
  if (armsExecuted === 0 && seamInvocations > 0) {
    out.push(
      `${gate} ${seamInvocations} seam invocation(s) happened while the verdict loop counted zero ` +
        `executed arms ${tail}. The I/O is UNACCOUNTED for.`,
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// The verdict loop
// ---------------------------------------------------------------------------

/**
 * Run every registered arm, aggregate, decide the exit code ONCE.
 *
 * ⛔ Reads NOTHING directly. Every byte of environment arrives as `env`; every
 * byte of I/O goes through `seams`. That is what lets `--self-test` drive THIS
 * function — the shipping verdict loop — rather than a rehearsal of it.
 *
 * @param {object} opts
 * @param {Array<{name:string, requiredEnv:string[], run:Function, REMEDIES:object}>} [opts.arms]
 * @param {Record<string,string|undefined>} [opts.env]
 * @param {object} opts.seams               from `createSeams`
 * @param {number} [opts.armsFloor]         ⚠️ every self-test scenario states its OWN, so the
 *                                          MECHANISM is measured rather than today's constant
 * @param {string|null} [opts.onlyArm]      narrowed diagnostic; floors are NOT enforced
 * @param {string} [opts.manifestPath]      passed through to arms (plan 03's cron-drift oracle)
 * @param {(s:string)=>void} [opts.log]     the ONLY output channel; the self-test captures it
 */
export async function runProber({
  arms = ARMS,
  env = {},
  seams,
  armsFloor = ARMS_FLOOR,
  onlyArm = null,
  manifestPath = MANIFEST_PATH,
  log = (s) => console.log(s),
} = {}) {
  const narrowed = Boolean(onlyArm);
  const scrub = makeScrubber(arms, env);
  const out = (line) => log(scrub(String(line)));

  const defects = [];
  const addDefect = (kind, arm, subject, detail, remedy = null) => {
    if (!DEFECT_KINDS.includes(kind)) throw new Error(`unknown defect kind ${kind}`);
    defects.push({
      kind,
      arm: arm || null,
      subject: subject || null,
      detail: scrub(String(detail)),
      remedy: remedy ? scrub(String(remedy)) : null,
    });
  };

  const selected = narrowed ? arms.filter((a) => a.name === onlyArm) : arms;
  if (narrowed && selected.length === 0) {
    addDefect(
      "measure-fail",
      onlyArm,
      null,
      `--arm names no registered arm; registered arms are: ${arms.map((a) => a.name).join(", ")}`,
    );
  }

  // -------------------------------------------------------------------------
  // (1) Credential gate (D-06). Names only, and an absent name BLOCKS the arm.
  // -------------------------------------------------------------------------
  const blocked = new Set();
  for (const arm of selected) {
    for (const name of arm.requiredEnv) {
      const value = env[name];
      const present = typeof value === "string" && value.length > 0;
      out(`credential: ${name} ${present ? "present" : "ABSENT"}`);
      if (!present) {
        blocked.add(arm.name);
        addDefect(
          "credential-absent",
          arm.name,
          name,
          `${name} is not set — this arm cannot measure, and a run that cannot measure is a failing run`,
          CREDENTIAL_REMEDIES[name] || DEFAULT_CREDENTIAL_REMEDY,
        );
      }
    }
  }

  // -------------------------------------------------------------------------
  // (2) Snapshot the seam tally. Read as a DELTA — never reset: this function
  //     does not own that counter, and must not, or the two tallies stop being
  //     two independent counts.
  // -------------------------------------------------------------------------
  const before = {
    fetch: seams.tally.fetch,
    sql: seams.tally.sql,
    ssh: seams.tally.ssh,
    byArm: { ...seams.tally.byArm },
  };

  // -------------------------------------------------------------------------
  // (3) Run every non-blocked arm. A throw is a `measure-fail` on that arm —
  //     never a silent pass, and never a reason to stop the other arms (D-04).
  // -------------------------------------------------------------------------
  let armsExecuted = 0;
  for (const arm of selected) {
    if (blocked.has(arm.name)) continue;
    armsExecuted += 1;
    try {
      await arm.run({ env, seams, log: out, addDefect, manifestPath });
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      addDefect(
        "measure-fail",
        arm.name,
        null,
        `${arm.name} threw: ${message}. The arm did not complete, so nothing it did or did not report is evidence.`,
      );
    }
  }

  const delta = {
    fetch: seams.tally.fetch - before.fetch,
    sql: seams.tally.sql - before.sql,
    ssh: seams.tally.ssh - before.ssh,
  };
  const seamInvocations = delta.fetch + delta.sql + delta.ssh;
  const tallyByArm = {};
  for (const arm of selected) {
    tallyByArm[arm.name] = (seams.tally.byArm[arm.name] || 0) - (before.byArm[arm.name] || 0);
  }
  const armsWithSeamActivity = selected.filter(
    (a) => !blocked.has(a.name) && (tallyByArm[a.name] || 0) >= 1,
  ).length;

  // -------------------------------------------------------------------------
  // (4) Floors — NOT enforced in a narrowed run, which never exits 0 anyway.
  // -------------------------------------------------------------------------
  if (narrowed) {
    out("");
    out("⚠️ NARROWED DIAGNOSTIC RUN (--arm): arm floors NOT enforced.");
    out("   This mode never exits 0, so it can never be mistaken for a passing gate.");
  } else if (arms.length < armsFloor) {
    addDefect(
      "floor",
      null,
      null,
      `ARMS_FLOOR regression: ${arms.length} registered arm(s) < floor ${armsFloor}. An arm that ` +
        `disappears must fail the run, not shrink the corpus quietly.`,
      "Register the missing arm(s) under scripts/prod-prober/arms/ and append them to ARMS. Lowering ARMS_FLOOR is a reviewed edit, never a fix.",
    );
  }

  // -------------------------------------------------------------------------
  // (5) Absurdity — applied in EVERY mode, narrowed included.
  // -------------------------------------------------------------------------
  for (const violation of absurdityViolations({ armsExecuted, seamInvocations, armsWithSeamActivity })) {
    addDefect("absurdity", null, null, violation);
  }

  // -------------------------------------------------------------------------
  // (6) + (7) The report. One shape, printed whether or not anything is wrong.
  // -------------------------------------------------------------------------
  out("");
  out(`arms: ${armsExecuted}/${arms.length}/${blocked.size}   (executed/registered/credential-blocked)`);
  out(`seam-invocations: ${seamInvocations}   (fetch ${delta.fetch} / sql ${delta.sql} / ssh ${delta.ssh})`);
  out("");
  if (defects.length === 0) {
    out(
      narrowed
        ? "No defects in the narrowed scope."
        : "✅ No defects. Every registered arm ran and measured.",
    );
  } else {
    out(`❌ ${defects.length} defect(s):`);
    out("");
    out("  KIND                        ARM         SUBJECT");
    out("  --------------------------  ----------  --------------------------");
    for (const d of defects) {
      out(`  ${(d.kind + "                          ").slice(0, 26)}  ${((d.arm || "-") + "          ").slice(0, 10)}  ${d.subject || "-"}`);
      out(`      ${d.detail}`);
      if (d.remedy) out(`      remedy: ${d.remedy}`);
    }
  }

  return {
    armsRegistered: arms.length,
    armsExecuted,
    armsBlocked: blocked.size,
    seamInvocations,
    seamInvocationsByKind: delta,
    tallyByArm,
    narrowed,
    defects,
    exitCode: defects.length > 0 ? 1 : narrowed ? 2 : 0,
  };
}

// ---------------------------------------------------------------------------
// --self-test: prove every defect kind fires on its own fixture, and nowhere
// else, THROUGH the real `runProber` above.
//
// ⚠️ The `k/N` scenario headers are a COUNTED set. Before adding or removing a
// scenario, bump `SELF_TEST_SCENARIOS` in the SAME edit — a stale count makes
// this self-test lie about its own coverage. The count is asserted against the
// number of headers actually printed, and the headers are auto-numbered off
// that same counter, so the two can never disagree silently.
// ---------------------------------------------------------------------------

function expect(condition, message) {
  if (!condition) {
    console.error(`SELF-TEST FAIL: ${message}`);
    return false;
  }
  console.log(`  ok — ${message}`);
  return true;
}

/**
 * "no defect of these kinds" — the ONE spelling every ABSENCE assertion in
 * `selfTest()` uses.
 *
 * ⛔ NEVER spell an absence as a negated `defects.some(...)` with an inline
 * `kind === "<k>"`. The coverage extractor the plan-05 wiring test runs scans
 * `selfTest()`'s SOURCE — comments included — for `kind === "<k>"` and treats
 * every match as a kind the self-test EXERCISES. An absence proves only that a
 * kind did NOT appear, so crediting it would be a vacuity inside the
 * anti-vacuity harness: the kind would keep reading as covered after its one
 * POSITIVE assertion was renamed or deleted. Going through the kind LIST keeps
 * the extractor honest by construction rather than by each author remembering.
 */
function noDefectOfKind(defects, kinds, where = () => true) {
  const hit = defects.some((x) => kinds.includes(x.kind) && where(x));
  return hit === false;
}

/** Every pyapi06 kind — the absence list scenarios 8 and 11 assert against. */
const PYAPI06_KINDS = DEFECT_KINDS.filter((k) => k.startsWith("pyapi06-"));

/**
 * Every kind that is a VERDICT ABOUT PRODUCTION, as opposed to a finding about
 * the instrument (`credential-absent`, `measure-fail`, `floor`, `absurdity`).
 * The credential scenario asserts a BLOCKED arm produces none of these: a
 * blocked arm must not merely be quiet, it must be incapable of a verdict.
 */
const VERDICT_KINDS = DEFECT_KINDS.filter(
  (k) => !["credential-absent", "measure-fail", "floor", "absurdity"].includes(k),
);

/**
 * The whole environment a self-test scenario holds in its hand. Every value is
 * OBVIOUSLY synthetic and points at `.invalid`, the reserved TLD that can never
 * resolve — nothing here is a credential, and the scrubber scenario proves none
 * of these VALUES reaches a log line or a defect row.
 */
const SELFTEST_ENV = {
  ANALYTICS_BASE_URL: "https://analytics.selftest.invalid",
  ANALYTICS_SERVICE_KEY: "selftest-fixture-key-not-a-credential",
  PROBER_POOLER_URL: "postgresql://prober@pooler.selftest.invalid:5432/postgres",
  SUPABASE_DB_PASSWORD: "selftest-fixture-password-not-a-credential",
  RAILWAY_API_TOKEN: "selftest-fixture-railway-token-not-a-credential",
  // ⚠️ The three Railway identifiers are OBVIOUSLY synthetic AND deliberately
  // unlike the real ones, because `makeScrubber` replaces every requiredEnv
  // VALUE wherever it appears: a self-test environment naming itself
  // "production" would redact that word out of every line the scenarios read.
  RAILWAY_PROJECT_ID: "00000000-0000-4000-8000-000000000000",
  RAILWAY_MT5_SERVICE: "mt5-gateway-selftest",
  RAILWAY_ENVIRONMENT: "selftest-environment",
};

/** The hand-set `COMMENT ON DATABASE` marker the fixture SQL seam answers with. */
const FIXTURE_DB_MARKER = "quantalyze-fixture-db";

/**
 * The cron-drift FIXTURE manifest, used by every multi-arm scenario.
 *
 * ⛔ NOT `MANIFEST_PATH`. The real oracle at `scripts/prod-prober/cron-manifest.json`
 * is captured from PROD in plan 06 and does not exist yet; pointing the
 * self-test at it would make the harness depend on a file the repository is
 * deliberately without, and would make a real capture silently change what the
 * self-test measures.
 */
const SELFTEST_MANIFEST_PATH = join(FIXTURE_ROOT, "cron-drift", "manifest.json");

/**
 * Load a fixture. A MISSING fixture is a SELF-TEST FAIL, never a skip
 * (`scripts/lint-sql-gates.mjs:1307-1343` — the same rule, for the same
 * reason: a harness that quietly skips its own inputs measures nothing).
 */
function loadFixture(dir, name) {
  const path = join(FIXTURE_ROOT, dir, name);
  if (!existsSync(path)) {
    return {
      ok: false,
      reason: `${dir} fixture ${name} is MISSING at scripts/prod-prober/fixtures/${dir}/${name} — a missing fixture is a FAIL, never a skip`,
    };
  }
  try {
    return { ok: true, data: JSON.parse(readFileSync(path, "utf8")) };
  } catch (err) {
    return { ok: false, reason: `${dir} fixture ${name} is not parseable JSON: ${err.message}` };
  }
}

/**
 * A fetch implementation backed by a fixture. It resolves the LABEL from the
 * request the arm actually made — URL and headers — so the fixture also proves
 * the arm sent the three distinct requests it claims to send.
 */
function fixtureFetch(data, env) {
  return async (url, init) => {
    const headers = (init && init.headers) || {};
    const sent = headers["X-Service-Key"];
    let label;
    if (String(url).includes("/health")) label = "health";
    else if (sent === undefined) label = "absent";
    else if (sent === env.ANALYTICS_SERVICE_KEY) label = "keyed";
    else label = "wrong";
    const entry = data[label];
    if (!entry) {
      return {
        status: null,
        json: null,
        text: "",
        measureFail: `self-test: fixture carries no "${label}" entry`,
      };
    }
    return {
      status: entry.status === undefined ? null : entry.status,
      json: entry.json === undefined ? null : entry.json,
      text: JSON.stringify(entry.json === undefined ? null : entry.json),
      measureFail: entry.measureFail || null,
    };
  };
}

/**
 * Load a fixture that is RAW TEXT rather than JSON.
 *
 * The mt5 fixtures are `railway ssh` stdout transcripts — a connection banner
 * followed by the `PROBE {...}` line — because that is exactly what the seam
 * hands the arm. Storing them as JSON would pre-parse the very thing the arm's
 * line-scanner exists to do, and the banner is what proves the scanner does not
 * assume line 1. Same MISSING-is-a-FAIL rule as `loadFixture`.
 */
function loadFixtureText(dir, name) {
  const path = join(FIXTURE_ROOT, dir, name);
  if (!existsSync(path)) {
    return {
      ok: false,
      reason: `${dir} fixture ${name} is MISSING at scripts/prod-prober/fixtures/${dir}/${name} — a missing fixture is a FAIL, never a skip`,
    };
  }
  return { ok: true, data: readFileSync(path, "utf8") };
}

/** Deep-enough clone for fixture merging (fixtures are plain JSON). */
const clone = (o) => JSON.parse(JSON.stringify(o));

/**
 * An ssh runner backed by a committed `railway ssh` stdout transcript.
 *
 * ⚠️ The seam-level states — a non-zero CLI exit, and the prober's OWN timeout
 * — are OVERRIDES rather than fixtures on disk, because neither is a thing the
 * CLI printed: `status` and `timedOut` are properties of the SPAWN. Keeping
 * them here rather than inventing a fixture file for each is what stops a
 * "fixture" from being a fiction about what a transcript can contain.
 *
 * `capture`, when given, records the argv the arm actually built — which is how
 * the no-interpolation scenario proves what was SENT equals what is COMMITTED.
 */
function fixtureSsh({ stdout = "", status = 0, stderr = "", timedOut = false, measureFail = null, capture = null } = {}) {
  return async (argv) => {
    if (capture) capture.push(argv);
    return { status, stdout, stderr, timedOut, measureFail };
  };
}

/** A psql-shaped OK answer. */
const sqlOk = (stdout) => ({ status: 0, stdout, stderr: "", timedOut: false, measureFail: null });

/**
 * A SQL runner backed by fixtures.
 *
 * ⚠️ IT RENDERS THE ANSWER THE WAY `psql` WOULD, with the SAME separators the
 * calling arm asked the real seam for — NULL as the empty string, one record per
 * separator. That is deliberate: it makes the fixture exercise the arm's PARSER
 * as well as its judgement, so a parser that silently desyncs on an empty field
 * or a multi-line command fails the self-test rather than being discovered in
 * production.
 *
 * The query is resolved by the TABLE it reads, not by a caller-supplied label,
 * so a scenario cannot accidentally answer the wrong question.
 *
 * @param {object} data
 * @param {{jobCount:number, rows:Array<Array<string>>}} [data.cronObs]
 * @param {string} [data.ttl]                 answer for TTL_SQL ("" = NULL/unset)
 * @param {Array<object>} [data.cronJobRows]  answer for CRON_JOB_SQL
 * @param {string|null} [data.marker]         answer for DB_MARKER_SQL
 */
function fixtureSql(data) {
  return (query, opts = {}) => {
    const fieldSep = typeof opts.fieldSep === "string" ? opts.fieldSep : "\t";
    const recordSep = typeof opts.recordSep === "string" ? opts.recordSep : "\n";
    const q = String(query);

    if (q.includes("pg_net.ttl")) {
      return sqlOk(`${data.ttl === undefined ? "6 hours" : data.ttl}\n`);
    }

    if (q.includes("shobj_description")) {
      const marker = data.marker === undefined ? FIXTURE_DB_MARKER : data.marker;
      return sqlOk(marker === null ? "\n" : `${marker}\n`);
    }

    if (q.includes("net._http_response")) {
      const spec = data.cronObs || { jobCount: 0, rows: [] };
      const lines = [];
      if (!spec.rows || spec.rows.length === 0) {
        // The `probe` CTE guarantees ONE row even with no runs, carrying the
        // job count — that is what makes "not scheduled" distinguishable from
        // "scheduled and silent".
        lines.push([String(spec.jobCount), "", "", "", "", "", "", "", ""].join(fieldSep));
      } else {
        for (const row of spec.rows) lines.push([String(spec.jobCount), ...row].join(fieldSep));
      }
      return sqlOk(`${lines.join("\n")}\n`);
    }

    if (q.includes("cron.job")) {
      const rows = data.cronJobRows || [];
      const rendered = rows.map((r) =>
        [
          String(r.jobid),
          r.jobname,
          r.schedule,
          r.active === true || r.active === "t" ? "t" : "f",
          r.database,
          r.username,
          r.command,
        ].join(fieldSep),
      );
      // psql prints the record separator AFTER every record, last one included.
      return sqlOk(rendered.length === 0 ? "" : `${rendered.join(recordSep)}${recordSep}`);
    }

    return {
      status: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      measureFail: `self-test: fixtureSql has no answer for this query`,
    };
  };
}

/**
 * THE PER-ARM ISOLATION TABLE. Plans 03 and 04 EXTEND this array; they do not
 * re-invent the loop below it.
 *
 * Each entry declares one green fixture (which must produce zero defects) and
 * one red fixture per defect kind the arm can raise (each of which must produce
 * EXACTLY ONE defect, of exactly that kind, on exactly that arm, carrying that
 * arm's remedy). A fixture named here and missing from disk is a SELF-TEST
 * FAIL, never a skip — the same rule, for the same reason, as
 * `scripts/lint-sql-gates.mjs:1307-1343`.
 *
 * ⚠️ `greenSeamCalls` is the arm's own request count, asserted on the green
 * run. It is what would catch an arm that quietly stopped issuing one of its
 * requests while still reporting no defects.
 *
 * ⚠️ `kinds` is the SET of defect kinds this entry's red fixtures must cover,
 * asserted as a SET rather than a count — one kind may need two red fixtures
 * (cron-obs raises `cron-no-observation` from two different causes) and one
 * fixture never covers two kinds. It is declared PER ENTRY because defect kinds
 * are NOT arm-name-prefixed outside pyapi06: `cron-no-observation` belongs to
 * `cron-obs`, and no prefix rule can know that. When omitted it defaults to the
 * `<arm>-` prefix filter, which is what pyapi06 uses.
 *
 * ⚠️ `makeSeams` is per entry because the arms do not share a transport: pyapi06
 * is four HTTP GETs, the cron arms are psql, mt5 is one `railway ssh`. Each
 * entry builds the seam bundle its own fixture drives, so the loop below stays
 * transport-agnostic.
 *
 * ⚠️ `load` is per entry for the same reason one layer down: the mt5 fixtures
 * are RAW TEXT transcripts, not JSON. It defaults to `loadFixture`.
 */
const ARM_FIXTURE_TABLE = [
  {
    arm: PYAPI06_ARM,
    fixtureDir: "pyapi06",
    green: "ok.json",
    greenSeamCalls: 4,
    makeSeams: (data) => createSeams({ fetchImpl: fixtureFetch(data, SELFTEST_ENV) }),
    red: {
      "keyed-401.json": "pyapi06-keyed-refused",
      "absent-200.json": "pyapi06-absent-accepted",
      "absent-401-uncoded.json": "pyapi06-absent-uncoded",
      "wrong-key-200.json": "pyapi06-wrong-key-accepted",
      "health-degraded.json": "pyapi06-health-degraded",
    },
  },
  {
    arm: CRON_OBS_MOD.ARM,
    fixtureDir: "cron-obs",
    green: "ok.json",
    // TTL_SQL + CRON_OBS_SQL. The TTL read is not optional decoration: it is
    // what clamps the scan window, so an arm that stopped issuing it would
    // silently stop honouring pg_net's pruning.
    greenSeamCalls: 2,
    kinds: ["cron-no-observation", "cron-non-2xx", "cron-transport-error"],
    makeSeams: (data) =>
      createSeams({
        sqlRunner: fixtureSql({ cronObs: data, ttl: data.ttl }),
        clock: () => new Date(data.now),
      }),
    red: {
      "401.json": "cron-non-2xx",
      // TWO fixtures, ONE kind, two DIFFERENT causes: a run whose response row
      // is absent, and a window with no run at all. Both are "nothing was
      // observed", and both must fire — the second is the one a `count(*) > 0`
      // style check would miss entirely.
      "no-response.json": "cron-no-observation",
      "no-runs.json": "cron-no-observation",
      "timed-out.json": "cron-transport-error",
    },
  },
  {
    arm: CRON_DRIFT_MOD.ARM,
    fixtureDir: "cron-drift",
    green: "prod-ok.json",
    // DB_MARKER_SQL + CRON_JOB_SQL. The marker read is not decoration: it is
    // the ONLY thing that establishes which database this reading came from,
    // since current_database() is `postgres` on every Supabase project.
    greenSeamCalls: 2,
    kinds: ["cron-drift"],
    manifestPath: SELFTEST_MANIFEST_PATH,
    makeSeams: (data) => createSeams({ sqlRunner: fixtureSql({ cronJobRows: data }) }),
    red: {
      // MANY fixtures, ONE kind, each with a DIFFERENT cause. `cron-drift` is
      // not one kind per fixture: every one of them has the same two readings
      // and the same remedy pair, and splitting them would multiply the defect
      // vocabulary without changing what an operator does. What must NOT
      // collapse is the DETAIL, so the extra/missing pair is asserted to name
      // its job below.
      //
      // ⛔ No count is written here on purpose (SR-07). This map is appended to
      // by design — the `-changed` rows below arrived a phase after the rest —
      // and a hand-typed numeral in a comment beside a growing literal is a
      // fact that rots on the very next line added.
      "prod-extra-job.json": "cron-drift",
      "prod-missing-job.json": "cron-drift",
      "prod-schedule-moved.json": "cron-drift",
      "prod-active-flipped.json": "cron-drift",
      "prod-zero-rows.json": "cron-drift",
      "prod-duplicate-jobname.json": "cron-drift",
      // CR-01: the ROLE a job executes as and the DATABASE it runs in. One
      // fixture each, so the neuter that darkens one comparison reddens
      // exactly one scenario.
      "prod-username-changed.json": "cron-drift",
      "prod-database-changed.json": "cron-drift",
    },
  },
  {
    arm: MT5_MOD.ARM,
    fixtureDir: "mt5",
    green: "ok.txt",
    // ONE railway ssh spawn. The whole probe is a single round-trip by design:
    // every extra call into the container is another thing that can wedge the
    // terminal this arm exists to observe.
    greenSeamCalls: 1,
    // ⚠️ FOUR kinds, not five. `mt5-probe-timeout` is deliberately NOT in this
    // table: it is a property of the SPAWN (the prober's own 120 s budget
    // elapsed), so there is no stdout a transcript could contain that would
    // produce it. It gets its own scenario below, with its own by-name
    // assertion and an explicit absence check against the terminal's -10005 —
    // which is the boundary MT5-WEDGE-OBS-01 turns on.
    kinds: ["mt5-no-ipc", "mt5-ipc-timeout", "mt5-ssh-transport", "mt5-terminal-error"],
    load: loadFixtureText,
    makeSeams: (text) => createSeams({ sshRunner: fixtureSsh({ stdout: text }) }),
    red: {
      "10004.txt": "mt5-no-ipc",
      "10005.txt": "mt5-ipc-timeout",
      "no-probe-line.txt": "mt5-ssh-transport",
      // TWO fixtures, ONE kind, two different causes on the same side of the
      // bridge: initialize() failing with a NON-IPC code, and initialize()
      // succeeding while terminal_info() returns null. Both mean "the bridge
      // answered and the terminal is the problem", so both carry the same
      // remedy — and neither may be reported as an IPC state.
      "init-false-other.txt": "mt5-terminal-error",
      "terminal-info-null.txt": "mt5-terminal-error",
    },
  },
];

/** The kinds an entry's red fixtures must cover. See the table's docblock. */
function entryKinds(entry) {
  return entry.kinds || DEFECT_KINDS.filter((k) => k.startsWith(`${entry.arm.name}-`));
}

/**
 * Seams that answer EVERY registered arm's green fixture at once.
 *
 * Needed by the credential scenario, which must run the WHOLE registry with one
 * name removed and then assert that the OTHER arms still executed and still
 * measured. Without a multi-arm seam bundle that scenario could only ever prove
 * "the blocked arm was blocked", never "and nothing else was".
 *
 * @returns {{ok: true, seams: object}|{ok: false, reason: string}}
 */
function allGreenSeams() {
  const pyapi06 = loadFixture("pyapi06", "ok.json");
  if (!pyapi06.ok) return pyapi06;
  const cronObs = loadFixture("cron-obs", "ok.json");
  if (!cronObs.ok) return cronObs;

  const cronJob = loadFixture("cron-drift", "prod-ok.json");
  if (!cronJob.ok) return cronJob;

  const mt5 = loadFixtureText("mt5", "ok.txt");
  if (!mt5.ok) return mt5;

  const sqlData = { cronObs: cronObs.data, ttl: cronObs.data.ttl, cronJobRows: cronJob.data };
  return {
    ok: true,
    seams: createSeams({
      fetchImpl: fixtureFetch(pyapi06.data, SELFTEST_ENV),
      sqlRunner: fixtureSql(sqlData),
      sshRunner: fixtureSsh({ stdout: mt5.data }),
      clock: () => new Date(cronObs.data.now),
    }),
  };
}

export async function selfTest() {
  /**
   * A BY-NAME assertion for every kind the table above can expect, spelled with a
   * literal `kind === "<k>"`.
   *
   * Two jobs, and the second is why the map is MANDATORY rather than decorative:
   *
   *  1. The plan-05 coverage extractor reads `selfTest()`'s SOURCE for
   *     `kind === "<k>"` and reports any `DEFECT_KINDS` entry it cannot find
   *     there as UNCOVERED. The table loop asserts through a variable
   *     (`d.kind === expected`), which the extractor cannot see, so a
   *     table-driven harness would silently read as covering nothing.
   *  2. The literal here is spelled INDEPENDENTLY of the table's mapping. The
   *     loop asserts both, so a typo in one and not the other fails loudly
   *     instead of quietly asserting on a kind that can never be reported.
   *
   * ⛔ The loop FAILS when a red fixture names a kind with no entry here. Adding
   * a fixture without its by-name assertion is therefore impossible, rather than
   * merely discouraged.
   */
  const KIND_ASSERTIONS = {
    "pyapi06-keyed-refused": (d) => d.kind === "pyapi06-keyed-refused",
    "pyapi06-absent-accepted": (d) => d.kind === "pyapi06-absent-accepted",
    "pyapi06-absent-uncoded": (d) => d.kind === "pyapi06-absent-uncoded",
    "pyapi06-wrong-key-accepted": (d) => d.kind === "pyapi06-wrong-key-accepted",
    "pyapi06-health-degraded": (d) => d.kind === "pyapi06-health-degraded",
    "cron-no-observation": (d) => d.kind === "cron-no-observation",
    "cron-non-2xx": (d) => d.kind === "cron-non-2xx",
    "cron-transport-error": (d) => d.kind === "cron-transport-error",
    "cron-drift": (d) => d.kind === "cron-drift",
    "cron-secret-in-command": (d) => d.kind === "cron-secret-in-command",
    "manifest-invalid": (d) => d.kind === "manifest-invalid",
    "mt5-no-ipc": (d) => d.kind === "mt5-no-ipc",
    "mt5-ipc-timeout": (d) => d.kind === "mt5-ipc-timeout",
    "mt5-ssh-transport": (d) => d.kind === "mt5-ssh-transport",
    "mt5-terminal-error": (d) => d.kind === "mt5-terminal-error",
    // ⚠️ Not reachable from the fixture table (see the mt5 entry's `kinds`
    // note) — its scenario applies this entry by hand, for the same reason the
    // table-driven ones do: the plan-05 coverage extractor reads THIS source
    // for literal `kind === "<k>"` comparisons and can see nothing else.
    "mt5-probe-timeout": (d) => d.kind === "mt5-probe-timeout",
  };

  const captured = [];
  const quiet = (line) => captured.push(line);
  let pass = true;
  let printed = 0;
  // Headers are AUTO-NUMBERED off the same counter the completeness assertion
  // reads, so the printed `k/N` can never disagree with the number of
  // scenarios that actually ran. Adding a scenario without bumping
  // SELF_TEST_SCENARIOS fails the run at the tail of this function; that
  // assertion is the control, the number in the header is the display.
  const scenario = (title) => {
    printed += 1;
    console.log("");
    console.log(`=== SELF-TEST ${printed}/${SELF_TEST_SCENARIOS}: ${title} ===`);
  };

  const green = loadFixture("pyapi06", "ok.json");

  // -------------------------------------------------------------------------
  // Scenarios 1-6 — THE PER-ARM ISOLATION LOOP over ARM_FIXTURE_TABLE.
  //
  // Green fixture: zero defects, the arm's FULL request count, the ✅ line, and
  // a REMEDIES sanity check. Then one red fixture per kind: EXACTLY ONE defect,
  // of that kind (asserted twice — once against the table, once by name through
  // KIND_ASSERTIONS, which are spelled independently), on that arm, carrying
  // that arm's remedy, and NOTHING of any other kind.
  //
  // Plans 03 and 04 add a table ENTRY and its KIND_ASSERTIONS; this loop does
  // not change.
  // -------------------------------------------------------------------------
  for (const entry of ARM_FIXTURE_TABLE) {
    const arm = entry.arm;
    const armKinds = entryKinds(entry);

    // JSON by default; the mt5 entry declares the raw-text loader.
    const load = entry.load || loadFixture;

    scenario(`${arm.name} GREEN fixture (${entry.green}) — the control`);
    const g = load(entry.fixtureDir, entry.green);
    if (!g.ok) {
      pass = expect(false, g.reason) && pass;
    } else {
      const lines = [];
      const seams = entry.makeSeams(g.data);
      const r = await runProber({
        arms: [arm],
        env: { ...SELFTEST_ENV },
        seams,
        armsFloor: 1,
        manifestPath: entry.manifestPath,
        log: (s) => lines.push(s),
      });
      // Over EVERY key of the arm's REMEDIES, not just the kinds this entry's
      // red fixtures cover — a kind whose remedy is missing or duplicated is a
      // defect whether or not this table happens to exercise it.
      const remedyKinds = Object.keys(arm.REMEDIES || {});
      const remedies = remedyKinds.map((k) => arm.REMEDIES[k]);
      pass =
        expect(r.exitCode === 0, `${entry.green} exits 0 (got ${r.exitCode}; defects ${JSON.stringify(r.defects)})`) &&
        expect(r.defects.length === 0, `${entry.green} produces ZERO defects (got ${r.defects.length})`) &&
        expect(r.armsExecuted === 1, `the green run executed ${arm.name} (armsExecuted ${r.armsExecuted})`) &&
        expect(r.armsBlocked === 0, `nothing was credential-blocked (armsBlocked ${r.armsBlocked})`) &&
        expect(
          r.seamInvocations === entry.greenSeamCalls,
          `the arm issued all ${entry.greenSeamCalls} of its requests (got ${r.seamInvocations}) — an arm that quietly stopped issuing one would still report no defects`,
        ) &&
        expect(
          r.tallyByArm[arm.name] === entry.greenSeamCalls,
          `and all ${entry.greenSeamCalls} are attributed to ${arm.name} (got ${r.tallyByArm[arm.name]})`,
        ) &&
        expect(
          lines.includes("✅ No defects. Every registered arm ran and measured."),
          "the green run prints the ✅ no-defects line",
        ) &&
        expect(
          (() => {
            // SET equality, not counts: one kind may legitimately need two red
            // fixtures (two different causes), but a kind with NO red fixture,
            // or a red fixture naming a kind the entry does not declare, is the
            // defect this asserts against.
            const declared = [...new Set(armKinds)].sort();
            const covered = [...new Set(Object.values(entry.red))].sort();
            return JSON.stringify(declared) === JSON.stringify(covered);
          })(),
          `every kind this entry declares has a red fixture and every red fixture names a declared kind (declared [${armKinds.join(", ")}] vs covered [${[...new Set(Object.values(entry.red))].join(", ")}])`,
        ) &&
        expect(
          remedyKinds.every((k) => DEFECT_KINDS.includes(k)),
          `every key of ${arm.name}.REMEDIES is a registered DEFECT_KIND (${remedyKinds.join(", ")})`,
        ) &&
        expect(
          remedies.length > 0 && remedies.every((s) => typeof s === "string" && s.length >= 40),
          `every ${arm.name} kind carries a REMEDIES entry of at least 40 chars — a defect row that says what broke but not what to do is an alert nobody acts on`,
        ) &&
        expect(
          new Set(remedies).size === remedies.length,
          `no two ${arm.name} remedies are the same string — two kinds with one remedy is two kinds pretending to be one`,
        ) &&
        pass;
      console.log(`  [recorded] ${lines.find((l) => l.startsWith("arms: "))}`);
      console.log(`  [recorded] ${lines.find((l) => l.startsWith("seam-invocations: "))}`);
    }

    for (const [fixture, expectedKind] of Object.entries(entry.red)) {
      scenario(`${expectedKind} fires on ${fixture}, and NOTHING else does`);
      const byName = KIND_ASSERTIONS[expectedKind];
      if (!byName) {
        pass =
          expect(
            false,
            `no by-name assertion is registered in KIND_ASSERTIONS for ${expectedKind} — the plan-05 coverage extractor reads literal kind comparisons out of this function's source and would report it UNCOVERED`,
          ) && pass;
        continue;
      }
      const fx = load(entry.fixtureDir, fixture);
      if (!fx.ok) {
        pass = expect(false, fx.reason) && pass;
        continue;
      }
      const seams = entry.makeSeams(fx.data);
      const r = await runProber({
        arms: [arm],
        env: { ...SELFTEST_ENV },
        seams,
        armsFloor: 1,
        manifestPath: entry.manifestPath,
        log: quiet,
      });
      const d = r.defects[0] || {};
      pass =
        expect(r.exitCode === 1, `${fixture} exits 1 (got ${r.exitCode})`) &&
        expect(
          r.defects.length === 1,
          `${fixture} ISOLATES exactly one defect (got ${r.defects.length}: ${r.defects.map((x) => x.kind).join(", ")})`,
        ) &&
        expect(d.kind === expectedKind, `the defect kind is ${expectedKind} (got ${d.kind})`) &&
        expect(
          byName(d),
          `the independently spelled KIND_ASSERTIONS entry for ${expectedKind} agrees — a typo in one spelling and not the other fails here`,
        ) &&
        expect(d.arm === arm.name, `the defect is attributed to ${arm.name} (got ${d.arm})`) &&
        expect(
          typeof d.remedy === "string" && d.remedy.length > 0 && d.remedy === arm.REMEDIES[expectedKind],
          `the defect carries ${arm.name}.REMEDIES[${JSON.stringify(expectedKind)}]`,
        ) &&
        expect(
          noDefectOfKind(r.defects, DEFECT_KINDS.filter((k) => k !== expectedKind)),
          `ABSENCE calibration: nothing of the other ${DEFECT_KINDS.length - 1} kinds fired — spelled through the kind LIST so the extractor cannot credit it as coverage`,
        ) &&
        pass;
    }
  }

  // -------------------------------------------------------------------------
  scenario("TWO faults in ONE run both reach the table (D-04; OPS-08-F8 not reproduced)");
  // -------------------------------------------------------------------------
  {
    const a = loadFixture("pyapi06", "absent-200.json");
    const h = loadFixture("pyapi06", "health-degraded.json");
    if (!a.ok || !h.ok) {
      pass = expect(false, (a.ok ? h.reason : a.reason)) && pass;
    } else {
      const merged = clone(a.data);
      merged.health = clone(h.data.health);
      const seams = createSeams({ fetchImpl: fixtureFetch(merged, SELFTEST_ENV) });
      const r = await runProber({
        arms: [PYAPI06_ARM],
        env: { ...SELFTEST_ENV },
        seams,
        armsFloor: 1,
        log: quiet,
      });
      pass =
        expect(r.exitCode === 1, `the two-fault run exits 1 (got ${r.exitCode})`) &&
        expect(r.defects.length === 2, `BOTH faults are reported, not just the first (got ${r.defects.length}: ${r.defects.map((x) => x.kind).join(", ")})`) &&
        expect(r.defects.some((x) => x.kind === "pyapi06-absent-accepted"), "the FIRST fault is in the table") &&
        expect(r.defects.some((x) => x.kind === "pyapi06-health-degraded"), "the SECOND fault is in the table — the run did not stop at the first") &&
        expect(r.seamInvocationsByKind.fetch === 4, `all four requests were still issued after the first fault (got ${r.seamInvocationsByKind.fetch})`) &&
        pass;
    }
  }

  // -------------------------------------------------------------------------
  scenario("credential-absent fires PER NAME across EVERY arm, blocks only its own arm(s), never a skip (D-06)");
  // -------------------------------------------------------------------------
  {
    // ⚠️ A LOOP EXTENSION, not new counted headers: one scenario that ranges
    // over every registered arm's every required NAME. It runs the WHOLE
    // registry each time, so it asserts both halves of D-06 — the arm that
    // needs the missing name is blocked and produces no verdict, AND every
    // other arm still ran and still measured. A credential gate that quietly
    // blocked the whole run would pass the first half and fail here.
    const allNames = [...new Set(ARMS.flatMap((a) => a.requiredEnv))].sort();
    for (const name of allNames) {
      const built = allGreenSeams();
      if (!built.ok) {
        pass = expect(false, built.reason) && pass;
        break;
      }
      const env = { ...SELFTEST_ENV };
      delete env[name];
      const usingName = ARMS.filter((a) => a.requiredEnv.includes(name));
      const lines = [];
      const r = await runProber({
        arms: ARMS,
        env,
        seams: built.seams,
        armsFloor: 1,
        manifestPath: SELFTEST_MANIFEST_PATH,
        log: (s) => lines.push(s),
      });
      const creds = r.defects.filter((x) => x.kind === "credential-absent");
      const blockedNames = usingName.map((a) => a.name);
      pass =
        expect(r.exitCode === 1, `an absent ${name} exits 1, never 0 (got ${r.exitCode})`) &&
        expect(
          creds.length === usingName.length,
          `an absent ${name} raises one credential-absent defect per arm that needs it (${usingName.length} expected, got ${creds.length})`,
        ) &&
        expect(
          creds.every((c) => c.subject === name),
          `every credential-absent defect names ${name} as its subject`,
        ) &&
        expect(
          creds.every((c) => String(c.detail).includes(name)),
          `every detail names ${name}`,
        ) &&
        expect(lines.includes(`credential: ${name} ABSENT`), `the log carries "credential: ${name} ABSENT"`) &&
        expect(
          r.armsBlocked === usingName.length,
          `exactly the ${usingName.length} arm(s) needing ${name} are BLOCKED [${blockedNames.join(", ")}] (armsBlocked ${r.armsBlocked})`,
        ) &&
        expect(
          r.armsExecuted === ARMS.length - usingName.length,
          `the OTHER ${ARMS.length - usingName.length} arm(s) still executed — one absent name does not silence the whole run (armsExecuted ${r.armsExecuted})`,
        ) &&
        expect(
          blockedNames.every((n) => (r.tallyByArm[n] || 0) === 0),
          `a blocked arm performs no I/O of its own (per-arm tally ${JSON.stringify(r.tallyByArm)})`,
        ) &&
        expect(
          r.seamInvocations >= ARMS.length - usingName.length,
          `and the arms that did run actually measured (seam-invocations ${r.seamInvocations})`,
        ) &&
        expect(
          noDefectOfKind(r.defects, VERDICT_KINDS),
          `no arm reported a verdict about production on this run (absent ${name}) — a blocked arm must be incapable of one, and the green fixtures give the others nothing to report`,
        ) &&
        pass;
    }
  }

  // -------------------------------------------------------------------------
  scenario("the ARMS_FLOOR mechanism fires at the SHIPPING default (D-08)");
  // -------------------------------------------------------------------------
  {
    if (!green.ok) {
      pass = expect(false, green.reason) && pass;
    } else {
      const seams = createSeams({ fetchImpl: fixtureFetch(green.data, SELFTEST_ENV) });
      // ⚠️ The ONE scenario that deliberately inherits the default armsFloor —
      // it is the mechanism under test here.
      const r = await runProber({
        arms: [PYAPI06_ARM],
        env: { ...SELFTEST_ENV },
        seams,
        log: quiet,
      });
      const floors = r.defects.filter((x) => x.kind === "floor");
      pass =
        expect(r.exitCode === 1, `a corpus below ARMS_FLOOR exits 1 (got ${r.exitCode})`) &&
        expect(floors.length === 1, `exactly one floor defect (got ${floors.length})`) &&
        expect(
          String((floors[0] || {}).detail).includes(`1 registered arm(s) < floor ${ARMS_FLOOR}`),
          `the floor defect names the counts: "1 registered arm(s) < floor ${ARMS_FLOOR}"`,
        ) &&
        pass;
    }
  }

  // -------------------------------------------------------------------------
  scenario("absurdity fires when the verdict loop and the seam tally disagree");
  // -------------------------------------------------------------------------
  {
    if (!green.ok) {
      pass = expect(false, green.reason) && pass;
    } else {
      const inner = fixtureFetch(green.data, SELFTEST_ENV);
      const seams = createSeams({ fetchImpl: inner });
      // A seam wrapper that answers correctly but NEVER increments the tally —
      // the stubbed-run shape, reached from inside the process.
      seams.fetch = async (_arm, url, init) => inner(url, init);
      const r = await runProber({
        arms: [PYAPI06_ARM],
        env: { ...SELFTEST_ENV },
        seams,
        armsFloor: 1,
        log: quiet,
      });
      const absurd = r.defects.filter((x) => x.kind === "absurdity");
      pass =
        expect(r.exitCode === 1, `a severed tally exits 1 even though every fixture answer was GREEN (got ${r.exitCode})`) &&
        expect(absurd.length >= 1, `at least one absurdity defect (got ${absurd.length})`) &&
        expect(
          absurd.every((x) => String(x.detail).includes("MEASURE_FAIL")),
          "every absurdity detail is marked MEASURE_FAIL — the GATE failing, not production",
        ) &&
        expect(r.armsExecuted === 1, `the verdict loop still claimed 1 executed arm (got ${r.armsExecuted})`) &&
        expect(r.seamInvocations === 0, `against a ZERO seam tally (got ${r.seamInvocations})`) &&
        pass;
    }
  }

  // -------------------------------------------------------------------------
  scenario("measure-fail is DISTINCT from a verdict — a dead transport is not a green key");
  // -------------------------------------------------------------------------
  {
    if (!green.ok) {
      pass = expect(false, green.reason) && pass;
    } else {
      const data = clone(green.data);
      data.keyed = { status: null, json: null, measureFail: "ECONNREFUSED" };
      const seams = createSeams({ fetchImpl: fixtureFetch(data, SELFTEST_ENV) });
      const r = await runProber({
        arms: [PYAPI06_ARM],
        env: { ...SELFTEST_ENV },
        seams,
        armsFloor: 1,
        log: quiet,
      });
      const mf = r.defects.filter((x) => x.kind === "measure-fail");
      pass =
        expect(r.exitCode === 1, `an unreachable transport exits 1 (got ${r.exitCode})`) &&
        expect(mf.length === 1, `exactly one measure-fail defect (got ${mf.length})`) &&
        expect((mf[0] || {}).arm === "pyapi06", `the measure-fail is attributed to pyapi06 (got ${(mf[0] || {}).arm})`) &&
        expect(
          noDefectOfKind(r.defects, PYAPI06_KINDS),
          "a request that never completed produces NO pyapi06 verdict — could-not-measure is not measured-a-problem, and it is not measured-no-problem either",
        ) &&
        pass;
    }
  }

  // -------------------------------------------------------------------------
  scenario("cron-obs BOUNDARY: a 60s-old run with no response yet is GREEN (recent-run-pending.json)");
  // -------------------------------------------------------------------------
  {
    // The other half of the 120 s in-flight rule. `no-response.json` (121 s
    // old, RED, in the table above) and this fixture (60 s old, GREEN) are a
    // PAIR: together they prove 120 s is a boundary rather than a blanket
    // excuse. Either one alone would be satisfied by an arm that always fires
    // or an arm that never does.
    const fx = loadFixture("cron-obs", "recent-run-pending.json");
    if (!fx.ok) {
      pass = expect(false, fx.reason) && pass;
    } else {
      const lines = [];
      const seams = createSeams({
        sqlRunner: fixtureSql({ cronObs: fx.data, ttl: fx.data.ttl }),
        clock: () => new Date(fx.data.now),
      });
      const r = await runProber({
        arms: [CRON_OBS_MOD.ARM],
        env: { ...SELFTEST_ENV },
        seams,
        armsFloor: 1,
        log: (s) => lines.push(s),
      });
      pass =
        expect(r.exitCode === 0, `a run inside the 120s in-flight grace exits 0 (got ${r.exitCode}; defects ${JSON.stringify(r.defects)})`) &&
        expect(
          noDefectOfKind(r.defects, ["cron-no-observation", "cron-non-2xx", "cron-transport-error"]),
          "an in-flight run raises NO cron verdict — its missing response is not evidence yet",
        ) &&
        expect(
          lines.some((l) => l.includes("excluded — younger than the 120s in-flight grace")),
          "and the run SAYS it excluded it, rather than silently dropping a row",
        ) &&
        pass;
    }
  }

  // -------------------------------------------------------------------------
  scenario("a psql failure is a measure-fail on the SQL arm, never a cron verdict");
  // -------------------------------------------------------------------------
  {
    // The CRON-OBS-01 anti-vacuity risk named in RESEARCH Finding 7: "the query
    // must error (not return 0) if the table is unreadable — check psql's exit
    // status, never parse an empty stdout as zero". A `permission denied` and a
    // healthy hour of 200s must not share a code path.
    const seams = createSeams({
      sqlRunner: () => ({
        status: 1,
        stdout: "",
        stderr: "permission denied for schema net",
        timedOut: false,
        measureFail: "psql exited 1: permission denied for schema net",
      }),
      clock: () => new Date("2026-09-05T12:00:00Z"),
    });
    const r = await runProber({
      arms: [CRON_OBS_MOD.ARM],
      env: { ...SELFTEST_ENV },
      seams,
      armsFloor: 1,
      log: quiet,
    });
    const mf = r.defects.filter((x) => x.kind === "measure-fail");
    pass =
      expect(r.exitCode === 1, `a failing psql exits 1, never 0 (got ${r.exitCode})`) &&
      expect(mf.length === 1, `exactly one measure-fail defect (got ${mf.length}: ${r.defects.map((x) => x.kind).join(", ")})`) &&
      expect((mf[0] || {}).arm === "cron-obs", `attributed to cron-obs (got ${(mf[0] || {}).arm})`) &&
      expect(
        noDefectOfKind(r.defects, ["cron-no-observation", "cron-non-2xx", "cron-transport-error"]),
        "and NO cron verdict of any kind — an empty stdout from a failed psql is not zero problems",
      ) &&
      pass;
  }

  // -------------------------------------------------------------------------
  scenario("the scan window SHRINKS to pg_net.ttl, so a PRUNED response is not reported as missing");
  // -------------------------------------------------------------------------
  {
    const g = loadFixture("cron-obs", "ok.json");
    if (!g.ok) {
      pass = expect(false, g.reason) && pass;
    } else {
      // ok.json's runs are at 11:30 / 10:30 / 09:30 against now = 12:00. Add a
      // run at 09:45 whose response row is GONE. With the default 6h TTL the
      // 3h window covers it and it would be a defect; with a 2h TTL pg_net has
      // PRUNED that response, so its absence says nothing about production and
      // the window must shrink rather than blame it.
      const data = clone(g.data);
      data.rows.push(["901000", "2026-09-05T09:45:00Z", "", "", "", "", "", ""]);
      data.ttl = "2 hours";
      const lines = [];
      const seams = createSeams({
        sqlRunner: fixtureSql({ cronObs: data, ttl: data.ttl }),
        clock: () => new Date(data.now),
      });
      const r = await runProber({
        arms: [CRON_OBS_MOD.ARM],
        env: { ...SELFTEST_ENV },
        seams,
        armsFloor: 1,
        log: (s) => lines.push(s),
      });

      // The control: the SAME fixture with the default TTL must be RED, or the
      // green above would be proving nothing.
      const wide = clone(data);
      wide.ttl = "6 hours";
      const seamsWide = createSeams({
        sqlRunner: fixtureSql({ cronObs: wide, ttl: wide.ttl }),
        clock: () => new Date(wide.now),
      });
      const rWide = await runProber({
        arms: [CRON_OBS_MOD.ARM],
        env: { ...SELFTEST_ENV },
        seams: seamsWide,
        armsFloor: 1,
        log: quiet,
      });

      pass =
        expect(r.exitCode === 0, `with pg_net.ttl = 2 hours the pruned run is out of window and the run exits 0 (got ${r.exitCode}; defects ${JSON.stringify(r.defects)})`) &&
        expect(
          lines.some((l) => l.includes("cron-obs: window shrunk to 2h because pg_net.ttl is shorter than 3h")),
          "the SHRINK is printed — a window that silently moved would be an unexplained change in what the alert means",
        ) &&
        expect(
          lines.some((l) => l.startsWith("cron-obs: pg_net.ttl = 2 hours (7200 s)")),
          "and the TTL itself is printed every run",
        ) &&
        expect(
          rWide.defects.filter((x) => x.kind === "cron-no-observation").length === 1,
          `CONTROL: the SAME fixture with the default 6h TTL is RED (got ${rWide.defects.map((x) => x.kind).join(", ") || "no defects"}) — without this the green above could be an arm that never fires`,
        ) &&
        pass;
    }
  }

  // -------------------------------------------------------------------------
  scenario("every exported *_SQL constant of every arm is a single read-only SELECT (T-164.1-13)");
  // -------------------------------------------------------------------------
  {
    // ⛔ The mechanical form of the standing rule. A write token, the `headers`
    // column, or `job_run_details.status` reaching ANY arm's query text fails
    // here rather than in production.
    const WRITE_TOKENS = /\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE|COPY)\b/i;
    const problems = [];
    let constantCount = 0;
    for (const { name, module } of SQL_ARM_MODULES) {
      const constants = Object.entries(module).filter(([k, v]) => k.endsWith("_SQL") && typeof v === "string");
      if (constants.length < 2) {
        problems.push(`${name} exports ${constants.length} *_SQL constant(s); every SQL arm must export at least 2`);
      }
      for (const [key, sql] of constants) {
        constantCount += 1;
        if (!/^\s*(SELECT|WITH)\b/i.test(sql)) problems.push(`${name}.${key} does not begin with SELECT or WITH`);
        if (WRITE_TOKENS.test(sql)) problems.push(`${name}.${key} carries a WRITE token`);
        if (/\bheaders\b/.test(sql)) problems.push(`${name}.${key} selects the headers column — response headers carry the very key this project already leaked once`);
        if (/job_run_details\.status\b/.test(sql)) problems.push(`${name}.${key} reads job_run_details.status, which records ENQUEUEING and is not evidence of anything`);
        if (sql.includes(";")) problems.push(`${name}.${key} contains a statement separator — every constant must be exactly ONE statement`);
      }
    }
    pass =
      expect(SQL_ARM_MODULES.length >= 1, `at least one SQL arm is registered (got ${SQL_ARM_MODULES.length})`) &&
      expect(constantCount >= SQL_ARM_MODULES.length * 2, `every SQL arm contributed its constants (${constantCount} across ${SQL_ARM_MODULES.length} arm(s))`) &&
      expect(problems.length === 0, `every *_SQL constant is one read-only statement (${problems.join("; ") || "no problems"})`) &&
      pass;
  }

  // -------------------------------------------------------------------------
  // The cron-drift scenarios the ARM_FIXTURE_TABLE cannot express: they need a
  // DIFFERENT manifest, an absent manifest, or no verdict loop at all.
  // -------------------------------------------------------------------------
  //
  // ⚠️ `marker` is the FOURTH argument and defaults to `undefined`, which
  // `fixtureSql` answers with `FIXTURE_DB_MARKER` — the same marker every
  // committed cron-drift manifest fixture records. Passing a DIFFERENT string
  // is how the "this reading came from another database" state is driven, with
  // no new seam and no production-code hook that exists only for the test.
  const driftRun = async (prodRows, manifestPath, log, marker) => {
    const seams = createSeams({ sqlRunner: fixtureSql({ cronJobRows: prodRows, marker }) });
    return runProber({
      arms: [CRON_DRIFT_MOD.ARM],
      env: { ...SELFTEST_ENV },
      seams,
      armsFloor: 1,
      manifestPath,
      log,
    });
  };
  const driftFixturePath = (name) => join(FIXTURE_ROOT, "cron-drift", name);

  // -------------------------------------------------------------------------
  scenario("cron-secret-in-command fires on an inline key whose sha MATCHES the manifest");
  // -------------------------------------------------------------------------
  {
    // ⛔ THE POINT OF THE WHOLE ORACLE DESIGN. The manifest and PROD agree byte
    // for byte here — sha equality is ASSERTED below, so this scenario cannot
    // be satisfied by a difference — and it is STILL a defect, because the
    // configuration they agree on is not achievable. An oracle that only asked
    // "does PROD match what we captured?" would have blessed the inline key
    // that sat in jobid 1 for months.
    const prod = loadFixture("cron-drift", "prod-inline-key.json");
    const man = loadFixture("cron-drift", "manifest-inline-key.json");
    if (!prod.ok || !man.ok) {
      pass = expect(false, prod.ok ? man.reason : prod.reason) && pass;
    } else {
      const prodRow = prod.data.find((r) => r.jobname === "match_engine_cron");
      const manRow = man.data.jobs.find((j) => j.jobname === "match_engine_cron");
      const prodSha = CRON_DRIFT_MOD.sha256Hex(CRON_DRIFT_MOD.normalizeCommand(prodRow.command));
      const r = await driftRun(prod.data, driftFixturePath("manifest-inline-key.json"), quiet);
      const secrets = r.defects.filter((x) => x.kind === "cron-secret-in-command");
      pass =
        expect(
          prodSha === manRow.command_sha256,
          `PRECONDITION: the two sides' shas are EQUAL (${prodSha.slice(0, 12)} vs ${String(manRow.command_sha256).slice(0, 12)}) — without this the assertion below could be satisfied by mere inequality`,
        ) &&
        expect(r.exitCode === 1, `an inline key exits 1 even with matching shas (got ${r.exitCode})`) &&
        expect(
          secrets.length === 2,
          `BOTH sides are flagged — the PROD row and the committed manifest row (got ${secrets.length}: ${secrets.map((x) => x.subject).join(", ")})`,
        ) &&
        expect(
          secrets.some((x) => x.subject === "prod:match_engine_cron"),
          "the PROD side is named",
        ) &&
        expect(
          secrets.some((x) => x.subject === "manifest:match_engine_cron"),
          "and so is the committed manifest — a manifest captured from a dirty state is itself a finding",
        ) &&
        expect(
          secrets.every((x) => String(x.detail).includes("[x-service-key-literal]")),
          "the rule id is named in the detail",
        ) &&
        expect(
          secrets.every((x) => String(x.detail).includes("FAKE-inline-key") === false),
          "and the OFFENDING TEXT is never quoted — a hygiene report that printed what it found would be the leak it exists to prevent",
        ) &&
        expect(
          noDefectOfKind(r.defects, ["cron-drift"]),
          "and NO cron-drift is reported, because the two sides genuinely agree",
        ) &&
        pass;
    }
  }

  // -------------------------------------------------------------------------
  scenario("row ORDER, CRLF line endings and re-indentation are NOT drift (ws-collapse-v1)");
  // -------------------------------------------------------------------------
  {
    const prod = loadFixture("cron-drift", "prod-ok-shuffled-crlf.json");
    if (!prod.ok) {
      pass = expect(false, prod.reason) && pass;
    } else {
      const lines = [];
      const r = await driftRun(prod.data, driftFixturePath("manifest.json"), (x) => lines.push(x));
      pass =
        expect(r.exitCode === 0, `reversed rows with CRLF and doubled spaces exit 0 (got ${r.exitCode}; defects ${JSON.stringify(r.defects)})`) &&
        expect(
          noDefectOfKind(r.defects, ["cron-drift", "cron-secret-in-command", "manifest-invalid"]),
          "nothing at all is reported — the comparison is a jobname MAP lookup, so PROD row order is irrelevant by construction",
        ) &&
        expect(
          lines.some((l) => l.includes("3 PROD job(s) vs 3 manifest job(s), 0 differing")),
          "and the run still SAYS what it compared, rather than being silently green",
        ) &&
        pass;
    }
  }

  // -------------------------------------------------------------------------
  scenario("an ABSENT manifest is manifest-invalid, never 'no drift' (the SKIP-01 shape)");
  // -------------------------------------------------------------------------
  {
    const prod = loadFixture("cron-drift", "prod-ok.json");
    if (!prod.ok) {
      pass = expect(false, prod.reason) && pass;
    } else {
      const missing = driftFixturePath("manifest-THIS-FILE-DOES-NOT-EXIST.json");
      const r = await driftRun(prod.data, missing, quiet);
      const invalid = r.defects.filter((x) => x.kind === "manifest-invalid");
      pass =
        expect(r.exitCode === 1, `an absent oracle exits 1, never 0 (got ${r.exitCode})`) &&
        expect(invalid.length === 1, `exactly one manifest-invalid defect (got ${invalid.length})`) &&
        expect(
          typeof (invalid[0] || {}).remedy === "string" && (invalid[0] || {}).remedy === CRON_DRIFT_MOD.REMEDIES["manifest-invalid"],
          "carrying the manifest-invalid remedy",
        ) &&
        expect(
          noDefectOfKind(r.defects, ["cron-drift", "cron-secret-in-command"]),
          "and NO drift or hygiene verdict — with no oracle nothing was COMPARED, and a comparison that did not happen is not a comparison that passed. The PROD hygiene scan still ran (section 0, above every return); THESE rows are simply clean, which the three HOIST scenarios below prove by running the same path with DIRTY ones",
        ) &&
        pass;
    }
  }

  // -------------------------------------------------------------------------
  scenario("HOIST: the PROD credential scan fires with the oracle ABSENT");
  // -------------------------------------------------------------------------
  {
    // ⛔ THE DEFECT THAT REVERTED A WHOLE REPAIR. `84b21cb5` put oracle
    // validation ABOVE the PROD-side hygiene loop, so hand-editing the
    // committed manifest — the one thing this arm's own adversary can do —
    // turned the live credential scan OFF for all fourteen jobs. These three
    // scenarios drive the SAME dirty PROD rows through three different broken
    // oracle states and require the credential finding in every one.
    const prod = loadFixture("cron-drift", "prod-inline-key.json");
    if (!prod.ok) {
      pass = expect(false, prod.reason) && pass;
    } else {
      const missing = driftFixturePath("manifest-HOIST-NO-SUCH-FILE.json");
      const r = await driftRun(prod.data, missing, quiet);
      const invalid = r.defects.filter((x) => x.kind === "manifest-invalid");
      pass =
        expect(r.exitCode === 1, `an absent oracle over dirty rows exits 1 (got ${r.exitCode})`) &&
        expect(invalid.length === 1, `exactly one manifest-invalid (got ${invalid.length})`) &&
        expect(
          String((invalid[0] || {}).detail).includes("manifest-HOIST-NO-SUCH-FILE.json"),
          "naming the path it looked for",
        ) &&
        expect(
          r.defects.some((d) => d.kind === "cron-secret-in-command" && d.subject === "prod:match_engine_cron"),
          "AND the PROD credential is STILL reported — an unreadable oracle is not an off switch for the live scan",
        ) &&
        pass;
    }
  }

  // -------------------------------------------------------------------------
  scenario("HOIST: the PROD credential scan fires with the oracle STALE (schema_version bumped)");
  // -------------------------------------------------------------------------
  {
    const prod = loadFixture("cron-drift", "prod-inline-key.json");
    if (!prod.ok) {
      pass = expect(false, prod.reason) && pass;
    } else {
      const r = await driftRun(prod.data, driftFixturePath("manifest-schema-bumped.json"), quiet);
      const invalid = r.defects.filter((x) => x.kind === "manifest-invalid");
      pass =
        expect(r.exitCode === 1, `a schema-bumped oracle over dirty rows exits 1 (got ${r.exitCode})`) &&
        expect(invalid.length === 1, `exactly one manifest-invalid (got ${invalid.length})`) &&
        expect(
          String((invalid[0] || {}).detail).includes("schema_version"),
          "saying the schema is the reason no comparison happened",
        ) &&
        expect(
          r.defects.some((d) => d.kind === "cron-secret-in-command" && d.subject === "prod:match_engine_cron"),
          "AND the PROD credential is STILL reported — a stale oracle is not an off switch either",
        ) &&
        pass;
    }
  }

  // -------------------------------------------------------------------------
  scenario("HOIST: the PROD credential scan fires with the live marker MISMATCHED");
  // -------------------------------------------------------------------------
  {
    // Three things at once, and the third is the point: (a) a manifest captured
    // from one database compared against a reading from another is a
    // measure-fail, (b) it produces NO drift verdict, because a diff between two
    // databases is not drift, and (c) the credential in the rows actually read
    // is reported anyway.
    const prod = loadFixture("cron-drift", "prod-inline-key.json");
    const man = loadFixture("cron-drift", "manifest-inline-key.json");
    if (!prod.ok || !man.ok) {
      pass = expect(false, prod.ok ? man.reason : prod.reason) && pass;
    } else {
      const otherMarker = "quantalyze-fixture-OTHER";
      const r = await driftRun(prod.data, driftFixturePath("manifest-inline-key.json"), quiet, otherMarker);
      const mf = r.defects.filter((x) => x.kind === "measure-fail" && x.subject === "database marker");
      pass =
        expect(
          man.data.database_marker !== otherMarker,
          `PRECONDITION: the two markers genuinely differ (${man.data.database_marker} vs ${otherMarker})`,
        ) &&
        expect(r.exitCode === 1, `a marker mismatch exits 1, never 0 (got ${r.exitCode})`) &&
        expect(mf.length === 1, `exactly one measure-fail on the database marker (got ${mf.length})`) &&
        expect(
          String((mf[0] || {}).detail).includes(man.data.database_marker) &&
            String((mf[0] || {}).detail).includes(otherMarker),
          "naming BOTH markers — they are names a human chose, and the reader cannot tell which side is the surprise without both",
        ) &&
        expect(
          noDefectOfKind(r.defects, ["cron-drift"]),
          "and NO drift verdict at all — a diff between two DIFFERENT databases is not drift, it is a comparison that was never valid",
        ) &&
        expect(
          r.defects.some((d) => d.kind === "cron-secret-in-command" && d.subject === "prod:match_engine_cron"),
          "AND the PROD credential is STILL reported — the rows were really read, whatever database they came from",
        ) &&
        pass;
    }
  }

  // -------------------------------------------------------------------------
  scenario("MARKER MANDATORY: compareManifest called without a liveMarker is a measure-fail, never a pass");
  // -------------------------------------------------------------------------
  {
    // A DIRECT call, deliberately: `run()` guards the marker itself, so this is
    // the only way to prove the FUNCTION refuses rather than the caller. Both
    // inputs are the CLEAN ones — the pair that produces zero defects with a
    // marker — so the single defect below can only come from the missing marker.
    const prod = loadFixture("cron-drift", "prod-ok.json");
    const man = loadFixture("cron-drift", "manifest.json");
    if (!prod.ok || !man.ok) {
      pass = expect(false, prod.ok ? man.reason : prod.reason) && pass;
    } else {
      const r = CRON_DRIFT_MOD.compareManifest(man.data, prod.data, {});
      const control = CRON_DRIFT_MOD.compareManifest(man.data, prod.data, { liveMarker: man.data.database_marker });
      pass =
        expect(
          r.defects.length === 1,
          `exactly one defect with no marker in hand (got ${r.defects.map((x) => x.kind).join(", ") || "none"})`,
        ) &&
        expect(
          (r.defects[0] || {}).kind === "measure-fail" && (r.defects[0] || {}).subject === "database marker",
          `and it is a measure-fail on the database marker (got ${(r.defects[0] || {}).kind} / ${(r.defects[0] || {}).subject})`,
        ) &&
        // ⛔ THE LEG THAT MAKES THIS CONTROL SEPARABLE. Without it, deleting the
        // mandatory-marker guard leaves this scenario GREEN: an empty marker
        // would fall through to the marker COMPARISON and be reported as a
        // mismatch — same kind, same subject, same count, and a sentence that
        // is not true. "Provenance was never established" and "these are two
        // different databases" are different findings, and the neuter matrix
        // can only attribute a RED to one control if they read differently.
        expect(
          String((r.defects[0] || {}).detail).includes("never established"),
          `and it says the marker was never ESTABLISHED, not that two databases disagree (got: ${String((r.defects[0] || {}).detail).slice(0, 70)}…)`,
        ) &&
        expect(
          control.defects.length === 0,
          `CONTROL: the SAME two inputs WITH the marker produce zero defects (got ${control.defects.map((x) => x.kind).join(", ") || "none"}) — so the defect above is the missing marker and nothing else`,
        ) &&
        pass;
    }
  }

  // -------------------------------------------------------------------------
  scenario("a drift defect RECORDS both readings and both shas (D-15 — which side moved)");
  // -------------------------------------------------------------------------
  {
    const prod = loadFixture("cron-drift", "prod-schedule-moved.json");
    const man = loadFixture("cron-drift", "manifest.json");
    if (!prod.ok || !man.ok) {
      pass = expect(false, prod.ok ? man.reason : prod.reason) && pass;
    } else {
      const r = await driftRun(prod.data, driftFixturePath("manifest.json"), quiet);
      const d = r.defects.find((x) => x.kind === "cron-drift") || {};
      const detail = String(d.detail || "");
      pass =
        expect(r.defects.length === 1 && d.kind === "cron-drift", `exactly one cron-drift (got ${r.defects.map((x) => x.kind).join(", ")})`) &&
        expect(detail.includes(`manifest captured ${man.data.captured_at}`), "the detail carries the manifest's captured_at — cron.job has no updated_at, so this is the only ordering evidence that exists") &&
        expect(detail.includes(`(marker ${man.data.database_marker})`), "and the database marker the capture came from") &&
        expect(detail.includes("PROD now sha "), "and PROD's current sha beside the manifest's") &&
        expect(detail.includes("changed: schedule"), "and WHICH field moved") &&
        expect(detail.includes("(schedule 0 * * * * → 5 * * * *)"), "spelled out both ways round") &&
        expect(
          detail.includes("reading 1: PROD moved after the capture"),
          "READING 1 verbatim — the report never guesses which side moved",
        ) &&
        expect(
          detail.includes("reading 2: the manifest was updated ahead of PROD"),
          "READING 2 verbatim, with its own remedy",
        ) &&
        pass;
    }
  }

  // -------------------------------------------------------------------------
  scenario("hygiene RED: all ten rules fire on their own fixture row, and the id sets match exactly");
  // -------------------------------------------------------------------------
  {
    const red = loadFixture("cron-drift", "hygiene-red.json");
    if (!red.ok) {
      pass = expect(false, red.reason) && pass;
    } else {
      const missed = [];
      const overlapping = [];
      for (const row of red.data) {
        const v = CRON_DRIFT_MOD.hygieneViolations(row.jobname, row.command);
        const ids = v.map((x) => x.slice(1, x.indexOf("]")));
        if (!ids.includes(row.rule)) missed.push(row.rule);
        if (ids.length !== 1) overlapping.push(`${row.rule}->[${ids.join(",")}]`);
        if (v.some((x) => x.includes(row.command))) missed.push(`${row.rule} (QUOTED THE COMMAND)`);
      }
      const fixtureIds = [...new Set(red.data.map((x) => x.rule))].sort();
      const armIds = [...CRON_DRIFT_MOD.HYGIENE_RULE_IDS].sort();
      pass =
        expect(missed.length === 0, `every red row fires the rule it names (${missed.join(", ") || "all ten fired"})`) &&
        expect(
          overlapping.length === 0,
          `and fires ONLY that rule — red-fixture ISOLATION, the lint-sql-gates idiom (${overlapping.join(" ") || "each row isolates one rule"})`,
        ) &&
        expect(red.data.length === 10, `the fixture has exactly ten rows (got ${red.data.length})`) &&
        expect(
          JSON.stringify(fixtureIds) === JSON.stringify(armIds),
          `the fixture's rule ids are EXACTLY the arm's HYGIENE_RULE_IDS — a rule added without a red row, or a red row whose rule was deleted, fails here (fixture [${fixtureIds.join(", ")}] vs arm [${armIds.join(", ")}])`,
        ) &&
        pass;
    }
  }

  // -------------------------------------------------------------------------
  scenario("hygiene GREEN: every ACHIEVABLE Vault-backed shape produces ZERO violations");
  // -------------------------------------------------------------------------
  {
    // The false-positive calibration, and it is not a formality: a rule that
    // fires on the configuration we want people to adopt is worse than no rule,
    // because it teaches the reader to ignore the whole class. The
    // `'Bearer ' || <expr>` control below is the one that forced the header
    // rules to test the LITERAL'S LENGTH rather than merely its presence.
    const green = loadFixture("cron-drift", "hygiene-green.json");
    if (!green.ok) {
      pass = expect(false, green.reason) && pass;
    } else {
      const flagged = green.data
        .map((g) => ({ jobname: g.jobname, v: CRON_DRIFT_MOD.hygieneViolations(g.jobname, g.command) }))
        .filter((x) => x.v.length > 0);
      pass =
        expect(green.data.length >= 5, `at least five green controls (got ${green.data.length})`) &&
        expect(
          green.data.some((g) => g.jobname === "match_engine_cron" && g.command.includes("vault.decrypted_secrets")),
          "including the Vault-backed match_engine_cron body itself — the exact shape jobid 1 was re-scheduled onto on 2026-09-01",
        ) &&
        expect(
          green.data.some((g) => g.command.includes("'Bearer ' ||")),
          "and the 'Bearer ' || <expr> concatenation, which a presence-only Authorization rule would have flagged",
        ) &&
        expect(
          flagged.length === 0,
          `no achievable shape is flagged (${flagged.map((x) => `${x.jobname}: ${x.v.join(" ")}`).join(" | ") || "all clean"})`,
        ) &&
        pass;
    }
  }

  // -------------------------------------------------------------------------
  scenario("a sha-only manifest row still detects drift, and its text is never printed");
  // -------------------------------------------------------------------------
  {
    const ok = loadFixture("cron-drift", "prod-ok.json");
    const moved = loadFixture("cron-drift", "prod-schedule-moved.json");
    if (!ok.ok || !moved.ok) {
      pass = expect(false, ok.ok ? moved.reason : ok.reason) && pass;
    } else {
      const shaOnly = driftFixturePath("manifest-sha-only.json");
      const rGreen = await driftRun(ok.data, shaOnly, quiet);

      const lines = [];
      const rRed = await driftRun(moved.data, shaOnly, (x) => lines.push(x));
      const d = rRed.defects.find((x) => x.kind === "cron-drift") || {};

      // CONTROL: the SAME comparison with a FULL manifest row DOES print the
      // diff. Without it, "no diff line" would also be satisfied by an arm that
      // never diffs anything.
      const changedCommand = clone(ok.data).map((r) =>
        r.jobname === "match_engine_cron"
          ? { ...r, command: r.command.replace("/api/match/cron-recompute", "/api/match/cron-recompute-v2") }
          : r,
      );
      const controlLines = [];
      const rControl = await driftRun(changedCommand, driftFixturePath("manifest.json"), (x) => controlLines.push(x));

      const isDiffLine = (l) => /^[+-] /.test(l);
      pass =
        expect(rGreen.exitCode === 0, `a sha-only row that MATCHES exits 0 (got ${rGreen.exitCode}; defects ${JSON.stringify(rGreen.defects)})`) &&
        expect(rRed.defects.length === 1 && d.kind === "cron-drift", `a sha-only row that DIFFERS reports exactly one cron-drift (got ${rRed.defects.map((x) => x.kind).join(", ")})`) &&
        expect(
          String(d.detail).includes("command text withheld: manifest row is sha-only"),
          "and SAYS why no text is shown",
        ) &&
        expect(
          String(d.detail).includes("fixture: reviewer withheld the jobid-1 body"),
          "naming the reviewer's own withheld_reason",
        ) &&
        expect(lines.every((l) => isDiffLine(l) === false), `no diff line was printed for the withheld row (${lines.filter(isDiffLine).join(" | ") || "none"})`) &&
        expect(
          rControl.defects.filter((x) => x.kind === "cron-drift").length === 1,
          `CONTROL: a FULL manifest row with a changed command is drift (got ${rControl.defects.map((x) => x.kind).join(", ")})`,
        ) &&
        expect(
          controlLines.filter(isDiffLine).length === 2,
          `CONTROL: and it DOES print the two-line unified diff (got ${controlLines.filter(isDiffLine).length}) — so "no diff line" above is a real absence, not an arm that never diffs`,
        ) &&
        pass;
    }
  }

  // -------------------------------------------------------------------------
  scenario("captureManifest REFUSES a configuration that fails hygiene, and writes nothing");
  // -------------------------------------------------------------------------
  {
    const prod = loadFixture("cron-drift", "prod-inline-key.json");
    if (!prod.ok) {
      pass = expect(false, prod.reason) && pass;
    } else {
      const dir = mkdtempSync(join(tmpdir(), "prod-prober-capture-"));
      const outPath = join(dir, "cron-manifest.json");
      const lines = [];
      try {
        const code = await captureManifest({
          seams: createSeams({ sqlRunner: fixtureSql({ cronJobRows: prod.data }), clock: () => new Date("2026-09-05T12:00:00Z") }),
          outPath,
          log: (x) => lines.push(x),
        });
        pass =
          expect(code === 1, `the capture returns 1 (got ${code})`) &&
          expect(existsSync(outPath) === false, "and the out path DOES NOT EXIST afterwards — the oracle can never be captured into a non-achievable state") &&
          expect(lines.some((l) => l.startsWith("REFUSED:")), "the refusal is explicit") &&
          expect(lines.some((l) => l.includes("match_engine_cron: [x-service-key-literal]")), "naming the job and the rule ids") &&
          expect(lines.every((l) => l.includes("FAKE-inline-key") === false), "and never the offending text") &&
          pass;
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  }

  // -------------------------------------------------------------------------
  scenario("a MALFORMED cron.job record is a measure-fail naming the count, never a continue (WR-05)");
  // -------------------------------------------------------------------------
  {
    // ⛔ The fixture carries ONE literal 0x1E — the arm's own record separator —
    // inside jobid 1's body literal, so psql's answer splits into a 7-field head
    // and a 1-field tail: three readable rows and one unreadable record. The
    // parser used to `continue` past the tail, which removed a PROD row from
    // every judgement this arm makes while the run still read green.
    const prod = loadFixture("cron-drift", "prod-malformed-record.json");
    if (!prod.ok) {
      pass = expect(false, prod.reason) && pass;
    } else {
      const r = await driftRun(prod.data, driftFixturePath("manifest.json"), quiet);
      const mf = r.defects.filter((x) => x.kind === "measure-fail");
      const detail = String((mf[0] || {}).detail || "");
      pass =
        expect(r.exitCode === 1, `an unreadable record exits 1, never 0 (got ${r.exitCode})`) &&
        expect(mf.length === 1, `exactly one measure-fail (got ${mf.length})`) &&
        expect(String((mf[0] || {}).subject) === "cron.job", `on subject cron.job (got ${(mf[0] || {}).subject})`) &&
        expect(
          detail.includes("1 of 4 record(s)"),
          `NAMING THE COUNT — three rows were read and a fourth record was not (detail: ${detail.slice(0, 80)}…)`,
        ) &&
        expect(
          detail.includes("{}") === false,
          "and the record TEXT is never quoted — an unreadable record is exactly the place a credential could be hiding",
        ) &&
        pass;
      // ⚠️ The drift side is deliberately NOT asserted: the truncated head
      // legitimately no longer matches its sha, and that IS drift by every
      // definition this arm has.
    }
  }

  // -------------------------------------------------------------------------
  scenario("captureManifest REFUSES a MALFORMED cron.job record (exit 3), and writes nothing");
  // -------------------------------------------------------------------------
  {
    // The capture path is the SECOND caller of the parser, and it needs its own
    // refusal: an oracle captured from a reading with a hole in it records the
    // hole as the standard. Exit 3, not 1 — hygiene never ran, so this refusal
    // must stay distinguishable from a hygiene refusal by exit code alone.
    const prod = loadFixture("cron-drift", "prod-malformed-record.json");
    if (!prod.ok) {
      pass = expect(false, prod.reason) && pass;
    } else {
      const dir = mkdtempSync(join(tmpdir(), "prod-prober-capture-"));
      const outPath = join(dir, "cron-manifest.json");
      const lines = [];
      try {
        const code = await captureManifest({
          seams: createSeams({ sqlRunner: fixtureSql({ cronJobRows: prod.data }), clock: () => new Date("2026-09-05T12:00:00Z") }),
          outPath,
          log: (x) => lines.push(x),
        });
        pass =
          expect(code === 3, `an unreadable record returns 3, not the hygiene refusal's 1 (got ${code})`) &&
          expect(existsSync(outPath) === false, "and the out path DOES NOT EXIST afterwards — a reading with a hole in it can never become the oracle") &&
          expect(
            lines.some((l) => l.startsWith("REFUSED:") && l.includes("1 ") && l.includes("record")),
            `the refusal is explicit and names how many records it could not read (${lines.join(" | ") || "no lines"})`,
          ) &&
          expect(lines.every((l) => l.includes("{}") === false), "and never echoes the record text") &&
          pass;
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  }

  // -------------------------------------------------------------------------
  scenario("captureManifest writes a schema-1 manifest whose shas match the committed fixture");
  // -------------------------------------------------------------------------
  {
    const prod = loadFixture("cron-drift", "prod-ok.json");
    const man = loadFixture("cron-drift", "manifest.json");
    if (!prod.ok || !man.ok) {
      pass = expect(false, prod.ok ? man.reason : prod.reason) && pass;
    } else {
      const dir = mkdtempSync(join(tmpdir(), "prod-prober-capture-"));
      const outPath = join(dir, "cron-manifest.json");
      const lines = [];
      try {
        const code = await captureManifest({
          seams: createSeams({ sqlRunner: fixtureSql({ cronJobRows: prod.data }), clock: () => new Date("2026-09-05T12:00:00Z") }),
          outPath,
          log: (x) => lines.push(x),
        });
        const written = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : null;
        // Sorted PAIRS, not objects: the capture sorts by jobname and the
        // committed fixture does not, so comparing key ORDER would fail on a
        // difference that is not a difference.
        const shaPairs = (jobs) => JSON.stringify(jobs.map((j) => [j.jobname, j.command_sha256]).sort());
        const wantShas = shaPairs(man.data.jobs);
        const gotShas = written ? shaPairs(written.jobs) : "[]";
        pass =
          expect(code === 0, `a clean configuration captures with 0 (got ${code}; log ${lines.join(" | ")})`) &&
          expect(written !== null, "the file was written") &&
          expect((written || {}).schema_version === 1 && (written || {}).normalization === "ws-collapse-v1", `schema 1 / ws-collapse-v1 (got ${(written || {}).schema_version} / ${(written || {}).normalization})`) &&
          expect((written || {}).database_marker === FIXTURE_DB_MARKER, `the database marker is recorded (got ${(written || {}).database_marker})`) &&
          expect((written || {}).captured_at === "2026-09-05T12:00:00.000Z", `captured_at comes from the INJECTED clock (got ${(written || {}).captured_at})`) &&
          expect(((written || {}).jobs || []).length === 3, `three jobs (got ${((written || {}).jobs || []).length})`) &&
          expect(
            gotShas === wantShas,
            `and every sha equals the committed fixture's — the capture and the comparison compute the SAME hash, or the oracle could never match itself (got ${gotShas})`,
          ) &&
          expect(
            ((written || {}).jobs || []).map((j) => j.jobname).join(",") === "audit_log_cold_purge,match_engine_cron,retention_compute_jobs_done",
            "sorted by jobname, so two captures of the same state are byte-identical",
          ) &&
          pass;
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  }

  // -------------------------------------------------------------------------
  scenario("captureManifest REFUSES when the database has no COMMENT ON DATABASE marker");
  // -------------------------------------------------------------------------
  {
    // ⛔ CLAUDE.md's standing rule made mechanical. `current_database()` is
    // `postgres` on PROD and on TEST, so a capture from an unlabelled database
    // is a file that cannot say where it came from.
    const prod = loadFixture("cron-drift", "prod-ok.json");
    if (!prod.ok) {
      pass = expect(false, prod.reason) && pass;
    } else {
      const dir = mkdtempSync(join(tmpdir(), "prod-prober-capture-"));
      const outPath = join(dir, "cron-manifest.json");
      const lines = [];
      try {
        const code = await captureManifest({
          seams: createSeams({
            sqlRunner: fixtureSql({ cronJobRows: prod.data, marker: null }),
            clock: () => new Date("2026-09-05T12:00:00Z"),
          }),
          outPath,
          log: (x) => lines.push(x),
        });
        pass =
          expect(code === 3, `a NULL marker returns 3 (got ${code})`) &&
          expect(existsSync(outPath) === false, "and nothing is written") &&
          expect(lines.some((l) => l.includes("COMMENT ON DATABASE")), "the refusal names the marker") &&
          pass;
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  }

  // -------------------------------------------------------------------------
  scenario("no env VALUE reaches the log or a defect row (threat T-164.1-01)");
  // -------------------------------------------------------------------------
  {
    const fx = loadFixture("pyapi06", "keyed-401.json");
    if (!fx.ok) {
      pass = expect(false, fx.reason) && pass;
    } else {
      const SENTINEL_KEY = "SENTINEL-KEY-9f3a";
      const SENTINEL_URL = "https://sentinel.invalid";
      const env = { ANALYTICS_BASE_URL: SENTINEL_URL, ANALYTICS_SERVICE_KEY: SENTINEL_KEY };
      const lines = [];
      const seams = createSeams({ fetchImpl: fixtureFetch(fx.data, env) });
      const r = await runProber({
        arms: [PYAPI06_ARM],
        env,
        seams,
        armsFloor: 1,
        log: (s) => lines.push(s),
      });
      const d = r.defects[0] || {};
      pass =
        expect(r.exitCode === 1, `the sentinel run is a DEFECT run, so detail lines are actually printed (got ${r.exitCode})`) &&
        expect(d.kind === "pyapi06-keyed-refused", `and it is the expected defect (got ${d.kind})`) &&
        expect(lines.length > 0, `the run printed something to scan (${lines.length} line(s))`) &&
        expect(
          lines.every((l) => l.includes(SENTINEL_KEY) === false),
          "no captured log line contains the sentinel KEY value",
        ) &&
        expect(
          lines.every((l) => l.includes(SENTINEL_URL) === false),
          "no captured log line contains the sentinel BASE URL value",
        ) &&
        expect(
          String(d.detail).includes(SENTINEL_KEY) === false && String(d.remedy).includes(SENTINEL_KEY) === false,
          "neither the defect detail nor its remedy contains the sentinel KEY value",
        ) &&
        expect(
          lines.some((l) => l === "credential: ANALYTICS_SERVICE_KEY present"),
          "the credential line reports the NAME as present — names are printed, values are not",
        ) &&
        pass;
    }
  }

  // -------------------------------------------------------------------------
  scenario("a railway ssh that exits 255 with no PROBE line is mt5-ssh-transport, and the exit status is REPORTED not obeyed");
  // -------------------------------------------------------------------------
  {
    const fx = loadFixtureText("mt5", "no-probe-line.txt");
    if (!fx.ok) {
      pass = expect(false, fx.reason) && pass;
    } else {
      const seams = createSeams({
        sshRunner: fixtureSsh({
          stdout: fx.data,
          status: 255,
          stderr: "kex_exchange_identification: connection closed by remote host",
        }),
      });
      const r = await runProber({
        arms: [MT5_MOD.ARM],
        env: { ...SELFTEST_ENV },
        seams,
        armsFloor: 1,
        log: quiet,
      });
      const d = r.defects[0] || {};
      pass =
        expect(r.exitCode === 1, `a 255 with no PROBE line exits 1 (got ${r.exitCode})`) &&
        expect(r.defects.length === 1, `it ISOLATES one defect (got ${r.defects.length}: ${r.defects.map((x) => x.kind).join(", ")})`) &&
        expect(d.kind === "mt5-ssh-transport", `the kind is mt5-ssh-transport (got ${d.kind})`) &&
        expect(
          String(d.detail).includes("railway ssh exit 255"),
          `the detail REPORTS the CLI's own exit status (${JSON.stringify(d.detail)}) — mt5-diag.sh:45-46 pipes into grep and throws that status away`,
        ) &&
        expect(
          String(d.detail).includes("connection closed by remote host"),
          "and carries the first redacted stderr line, which is the only part of stderr that may be printed",
        ) &&
        expect(
          !String(d.detail).includes("python3: command not found"),
          "and does NOT echo raw ssh stdout — only the PROBE line and one stderr line may leave this arm",
        ) &&
        expect(
          noDefectOfKind(r.defects, ["mt5-no-ipc", "mt5-ipc-timeout", "mt5-probe-timeout", "mt5-terminal-error"]),
          "a transport failure is NOT reported as any statement about the terminal — nothing was measured about MT5 at all",
        ) &&
        pass;

      // ⛔ THE POSITIVE CONTROL FOR THE SAME PROPERTY, and the more dangerous
      // direction. `scripts/mt5-diag.sh:45-46` pipes ssh into `grep '^PROBE '`,
      // so the PIPE decides the exit and the CLI's own status is lost. Here the
      // two readings are independent — which must mean a CLI that exited
      // NON-ZERO while the terminal DID answer -10004 is still reported as
      // -10004, with its redeploy remedy, rather than downgraded to
      // "transport" and its check-your-token remedy. Without this leg the
      // scenario above would also pass an arm that treated any non-zero exit
      // as transport and never looked at stdout at all.
      const answered = loadFixtureText("mt5", "10004.txt");
      if (!answered.ok) {
        pass = expect(false, answered.reason) && pass;
      } else {
        const r2 = await runProber({
          arms: [MT5_MOD.ARM],
          env: { ...SELFTEST_ENV },
          seams: createSeams({
            sshRunner: fixtureSsh({ stdout: answered.data, status: 255, stderr: "connection closed" }),
          }),
          armsFloor: 1,
          log: quiet,
        });
        const d2 = r2.defects[0] || {};
        pass =
          expect(r2.defects.length === 1, `the non-zero-exit-WITH-a-PROBE-line run ISOLATES one defect (got ${r2.defects.length})`) &&
          expect(
            d2.kind === "mt5-no-ipc",
            `and it is the TERMINAL's verdict (${d2.kind}), not the transport's — the CLI exited 255 and the PROBE line was still read`,
          ) &&
          expect(
            d2.remedy === MT5_MOD.REMEDIES["mt5-no-ipc"],
            "so the operator gets the REDEPLOY remedy, not the check-your-token one a status-driven arm would have printed",
          ) &&
          pass;
      }
    }
  }

  // -------------------------------------------------------------------------
  scenario("THE BOUNDARY: the PROBER's own timeout is mt5-probe-timeout and is NEVER read as the terminal's -10005");
  // -------------------------------------------------------------------------
  {
    // ⛔ The one confusion this arm exists to prevent, in its most tempting
    // form: both states are "a timeout", and collapsing them would tell an
    // operator to go clear a modal dialog on a terminal that was never reached.
    const seams = createSeams({
      sshRunner: fixtureSsh({
        stdout: "",
        status: null,
        timedOut: true,
        measureFail: `railway ssh exceeded ${MT5_MOD.SSH_TIMEOUT_MS} ms`,
      }),
    });
    const r = await runProber({
      arms: [MT5_MOD.ARM],
      env: { ...SELFTEST_ENV },
      seams,
      armsFloor: 1,
      log: quiet,
    });
    const d = r.defects[0] || {};
    const byName = KIND_ASSERTIONS["mt5-probe-timeout"];
    pass =
      expect(r.exitCode === 1, `a timed-out spawn exits 1 (got ${r.exitCode})`) &&
      expect(r.defects.length === 1, `it ISOLATES one defect (got ${r.defects.length}: ${r.defects.map((x) => x.kind).join(", ")})`) &&
      expect(d.kind === "mt5-probe-timeout", `the kind is mt5-probe-timeout (got ${d.kind})`) &&
      expect(byName(d), "the independently spelled KIND_ASSERTIONS entry for mt5-probe-timeout agrees") &&
      expect(d.arm === "mt5", `the defect is attributed to mt5 (got ${d.arm})`) &&
      expect(
        d.remedy === MT5_MOD.REMEDIES["mt5-probe-timeout"],
        "it carries the mt5-probe-timeout remedy, which says this is OUR instrument's budget",
      ) &&
      expect(
        String(d.detail).includes("-10005") && String(d.detail).includes("NOT"),
        `the detail says in words that this is NOT the terminal's -10005 (${JSON.stringify(d.detail)})`,
      ) &&
      expect(
        noDefectOfKind(r.defects, ["mt5-ipc-timeout", "mt5-no-ipc", "mt5-ssh-transport"]),
        "and NONE of the three states that would send an operator to the gateway fired — the prober blamed itself, correctly",
      ) &&
      expect(
        MT5_MOD.REMEDIES["mt5-probe-timeout"] !== MT5_MOD.REMEDIES["mt5-ipc-timeout"],
        "the two 'timeout' remedies are different strings",
      ) &&
      pass;
  }

  // -------------------------------------------------------------------------
  scenario("the COMMITTED probe reaches the container byte-for-byte, and the two IPC remedies are different (D-16, D-17)");
  // -------------------------------------------------------------------------
  {
    // Two claims, both machine-checked rather than argued:
    //   (a) T-164.1-16/17 — what was SENT decodes to exactly what is COMMITTED,
    //       and what is committed calls nothing but the three read-only methods.
    //   (b) success criterion 3 — the -10004 and -10005 DEFECT ROWS carry
    //       different remedy text. Not the table; the rows an operator reads.
    const py = MT5_MOD.MT5_PROBE_PY;
    const FORBIDDEN = [
      "login",
      "order_send",
      "order_check",
      "shutdown",
      "account_info",
      "history_deals",
      "positions_get",
      "symbol_select",
    ];
    const capture = [];
    const g = loadFixtureText("mt5", "ok.txt");
    if (!g.ok) {
      pass = expect(false, g.reason) && pass;
    } else {
      const r = await runProber({
        arms: [MT5_MOD.ARM],
        env: { ...SELFTEST_ENV },
        seams: createSeams({ sshRunner: fixtureSsh({ stdout: g.data, capture }) }),
        armsFloor: 1,
        log: quiet,
      });
      const argv = capture[0] || [];
      // The payload now lives INSIDE the single word after `--` (see
      // buildProbeArgv), so read it from there rather than from a separate
      // `-c` element, which no longer exists.
      const dashC = argv[argv.indexOf("--") + 1] || "";
      const b64 = (dashC.match(/b64decode\('([^']*)'\)/) || [])[1] || "";
      const sent = b64 ? Buffer.from(b64, "base64").toString("utf8") : "";

      // The two IPC rows, produced by the SHIPPING path on their own fixtures.
      const rowFor = async (fixture) => {
        const fx = loadFixtureText("mt5", fixture);
        if (!fx.ok) return null;
        const rr = await runProber({
          arms: [MT5_MOD.ARM],
          env: { ...SELFTEST_ENV },
          seams: createSeams({ sshRunner: fixtureSsh({ stdout: fx.data }) }),
          armsFloor: 1,
          log: quiet,
        });
        return rr.defects[0] || null;
      };
      const row4 = await rowFor("10004.txt");
      const row5 = await rowFor("10005.txt");

      pass =
        expect(r.exitCode === 0, `the probe ran green against ok.txt (got ${r.exitCode})`) &&
        expect(capture.length === 1, `exactly ONE railway ssh spawn (got ${capture.length}) — every extra call into the container is another chance to wedge the terminal`) &&
        expect(
          argv[0] === "ssh" && String(argv[argv.indexOf("--") + 1]).startsWith("python3 "),
          `the argv is a single ssh exec of python3 (${JSON.stringify(argv.slice(0, 9))})`,
        ) &&
        // ⛔ THE ARM'S ONLY DEFENCE AGAINST A COMMAND THAT NEVER RUNS.
        // Railway CLI 4.36.1 JOINS every word after `--` with spaces and hands
        // the result to `sh -c` inside the container. The fixture seam never
        // joins argv, so a broken split is INVISIBLE to every other scenario
        // here — this arm shipped once as three words (`python3`, `-c`, the
        // one-liner) and would have made every hourly run report
        // `mt5-ssh-transport` with a remedy blaming the operator's token.
        // `sh -n` parses without executing, so this is safe and offline.
        expect(
          (() => {
            const joined = argv.slice(argv.indexOf("--") + 1).join(" ");
            const r = spawnSync("sh", ["-n", "-c", joined], { encoding: "utf8" });
            return r.status === 0;
          })(),
          "and the words after `--`, JOINED THE WAY THE CLI JOINS THEM, are a syntactically valid shell command — three bare words die on the `(` before python starts",
        ) &&
        // The positive control: the broken shape MUST fail the same check, or
        // the assertion above is passing for a reason unrelated to the split.
        expect(
          (() => {
            const b64 = Buffer.from(MT5_MOD.MT5_PROBE_PY, "utf8").toString("base64");
            const broken = ["python3", "-c", "import base64;exec(base64.b64decode('" + b64 + "'))"].join(" ");
            return spawnSync("sh", ["-n", "-c", broken], { encoding: "utf8" }).status !== 0;
          })(),
          "CALIBRATION: the three-word shape this arm used to emit is REJECTED by the same check",
        ) &&
        expect(
          argv[argv.indexOf("-p") + 1] === SELFTEST_ENV.RAILWAY_PROJECT_ID &&
            argv[argv.indexOf("-e") + 1] === SELFTEST_ENV.RAILWAY_ENVIRONMENT &&
            argv[argv.indexOf("-s") + 1] === SELFTEST_ENV.RAILWAY_MT5_SERVICE,
          "the ONLY variables that reach the CLI are the -p / -e / -s flags, which it consumes itself and never passes into the container",
        ) &&
        expect(
          sent === py,
          "and the base64 payload decodes to MT5_PROBE_PY BYTE-FOR-BYTE — no run-time interpolation reached the container (T-164.1-16)",
        ) &&
        expect(
          argv.every((a) => !String(a).includes(SELFTEST_ENV.RAILWAY_API_TOKEN)),
          "the token is in NO argv element — it travels only in the child env (T-164.1-18)",
        ) &&
        expect(
          FORBIDDEN.every((t) => !py.includes(t)) && !py.includes("${"),
          `the committed body contains none of [${FORBIDDEN.join(", ")}] and no interpolation marker — the mt5-diag.sh rule, machine-checked (T-164.1-17)`,
        ) &&
        expect(
          py.includes("initialize()") && py.includes("last_error()") && py.includes("terminal_info()"),
          "and it DOES call all three read-only methods — a body that stopped calling terminal_info() would measure nothing while still passing the forbidden-call check",
        ) &&
        expect(
          py.includes(`host="${MT5_MOD.RPYC_HOST}"`) && py.includes(`port=${MT5_MOD.RPYC_PORT}`),
          `the rpyc coordinates are LITERALS in the constant and agree with the exported RPYC_HOST/RPYC_PORT (${MT5_MOD.RPYC_HOST}:${MT5_MOD.RPYC_PORT})`,
        ) &&
        expect(
          row4 !== null && row5 !== null && row4.kind === "mt5-no-ipc" && row5.kind === "mt5-ipc-timeout",
          `the two IPC fixtures produce the two IPC kinds (${row4 && row4.kind} / ${row5 && row5.kind})`,
        ) &&
        expect(
          row4.remedy !== row5.remedy && row4.remedy.length >= 40 && row5.remedy.length >= 40,
          "⛔ SUCCESS CRITERION 3: the -10004 and -10005 DEFECT ROWS carry DIFFERENT remedy text, each substantial",
        ) &&
        expect(
          row4.remedy.includes("redeploy") && row5.remedy.includes("VNC") && row5.remedy.includes("does NOT fix"),
          "and they say OPPOSITE things: -10004 says redeploy, -10005 says the VNC console because a redeploy does NOT fix it (the Wine prefix is on the persistent volume)",
        ) &&
        expect(
          row4.subject === "-10004" && row5.subject === "-10005",
          `each row names its own code as the subject (${row4.subject} / ${row5.subject})`,
        ) &&
        pass;
    }
  }

  // -------------------------------------------------------------------------
  scenario("FULL GREEN: all FOUR registered arms run at the SHIPPING floor and the run exits 0 (D-08 met)");
  // -------------------------------------------------------------------------
  {
    const built = allGreenSeams();
    if (!built.ok) {
      pass = expect(false, built.reason) && pass;
    } else {
      const lines = [];
      // ⚠️ NO `armsFloor` override — this scenario inherits the SHIPPING
      // default, because "the floor is met" is the claim under test.
      const r = await runProber({
        arms: ARMS,
        env: { ...SELFTEST_ENV },
        seams: built.seams,
        manifestPath: SELFTEST_MANIFEST_PATH,
        log: (s) => lines.push(s),
      });
      const slots = ARMS.reduce((n, a) => n + a.requiredEnv.length, 0);
      const names = [...new Set(ARMS.flatMap((a) => a.requiredEnv))];
      pass =
        expect(ARMS.length === ARMS_FLOOR, `the registry equals the pinned floor (${ARMS.length} arms, floor ${ARMS_FLOOR})`) &&
        expect(
          slots === 10 && names.length === 8,
          `the four arms declare ${slots} credential SLOTS across ${names.length} distinct NAMES — the live no-credential run's ten credential-absent rows are these slots, not eight names double-counted`,
        ) &&
        expect(
          names.every((n) => typeof SELFTEST_ENV[n] === "string" && SELFTEST_ENV[n].length > 0),
          `every one of the ${names.length} names is set in this scenario's environment [${names.sort().join(", ")}]`,
        ) &&
        expect(r.exitCode === 0, `the all-green four-arm run exits 0 (got ${r.exitCode}; defects ${JSON.stringify(r.defects)})`) &&
        expect(r.defects.length === 0, `ZERO defects (got ${r.defects.length})`) &&
        expect(r.armsExecuted === 4, `all four arms executed (got ${r.armsExecuted})`) &&
        expect(r.armsBlocked === 0, `nothing was credential-blocked (got ${r.armsBlocked})`) &&
        expect(
          lines.some((l) => l.startsWith("arms: 4/4/0")),
          `the log prints "arms: 4/4/0" (got ${JSON.stringify(lines.find((l) => l.startsWith("arms: ")))})`,
        ) &&
        expect(
          ARMS.every((a) => (r.tallyByArm[a.name] || 0) >= 1),
          `every arm made at least one seam call of its own — an arm can be "executed" and measure nothing (per-arm tally ${JSON.stringify(r.tallyByArm)})`,
        ) &&
        expect(
          noDefectOfKind(r.defects, ["floor", "absurdity"]),
          "no floor and no absurdity at the shipping default — the instrument agrees with itself and the registry is complete",
        ) &&
        pass;
      console.log(`  [recorded] ${lines.find((l) => l.startsWith("arms: "))}`);
      console.log(`  [recorded] ${lines.find((l) => l.startsWith("seam-invocations: "))}`);
    }
  }

  // -------------------------------------------------------------------------
  scenario("CROSS-ARM: a pyapi06 fault and an mt5 fault in ONE run both reach the table, and all four arms still ran (D-04)");
  // -------------------------------------------------------------------------
  {
    // The D-04 scenario above proves aggregation WITHIN one arm. This proves it
    // ACROSS arms and ACROSS transports — an HTTP fault and an ssh fault in the
    // same run, with the two SQL arms green. A first-failure exit (OPS-08-F8)
    // would report whichever came first and hide the other outage until the
    // first was fixed.
    const py = loadFixture("pyapi06", "absent-200.json");
    const cronObs = loadFixture("cron-obs", "ok.json");
    const cronJob = loadFixture("cron-drift", "prod-ok.json");
    const mt5 = loadFixtureText("mt5", "10005.txt");
    const bad = [py, cronObs, cronJob, mt5].find((x) => !x.ok);
    if (bad) {
      pass = expect(false, bad.reason) && pass;
    } else {
      const lines = [];
      const seams = createSeams({
        fetchImpl: fixtureFetch(py.data, SELFTEST_ENV),
        sqlRunner: fixtureSql({ cronObs: cronObs.data, ttl: cronObs.data.ttl, cronJobRows: cronJob.data }),
        sshRunner: fixtureSsh({ stdout: mt5.data }),
        clock: () => new Date(cronObs.data.now),
      });
      const r = await runProber({
        arms: ARMS,
        env: { ...SELFTEST_ENV },
        seams,
        manifestPath: SELFTEST_MANIFEST_PATH,
        log: (s) => lines.push(s),
      });
      const kinds = r.defects.map((x) => x.kind).sort();
      pass =
        expect(r.exitCode === 1, `the cross-arm two-fault run exits 1 (got ${r.exitCode})`) &&
        expect(r.defects.length === 2, `EXACTLY the two injected faults are reported (got ${r.defects.length}: ${kinds.join(", ")})`) &&
        expect(
          r.defects.some((x) => x.kind === "pyapi06-absent-accepted" && x.arm === "pyapi06"),
          "the HTTP fault is in the table",
        ) &&
        expect(
          r.defects.some((x) => x.kind === "mt5-ipc-timeout" && x.arm === "mt5"),
          "the ssh fault is in the table too — the run did not stop at the first, and it did not stop at the first TRANSPORT either",
        ) &&
        expect(r.armsExecuted === 4, `all four arms still ran (got ${r.armsExecuted})`) &&
        expect(
          lines.some((l) => l.startsWith("arms: 4/4/0")),
          `the log still prints "arms: 4/4/0" under two faults (got ${JSON.stringify(lines.find((l) => l.startsWith("arms: ")))})`,
        ) &&
        expect(
          new Set(r.defects.map((x) => x.remedy)).size === 2,
          "and the two rows carry two DIFFERENT remedies — two outages, two instructions",
        ) &&
        pass;
    }
  }

  // -------------------------------------------------------------------------
  scenario("a narrowed --arm run exits 2 even when it is GREEN");
  // -------------------------------------------------------------------------
  {
    if (!green.ok) {
      pass = expect(false, green.reason) && pass;
    } else {
      const saved = {
        ANALYTICS_BASE_URL: process.env.ANALYTICS_BASE_URL,
        ANALYTICS_SERVICE_KEY: process.env.ANALYTICS_SERVICE_KEY,
      };
      setSeamsFactoryForTests(() => createSeams({ fetchImpl: fixtureFetch(green.data, SELFTEST_ENV) }));
      try {
        process.env.ANALYTICS_BASE_URL = SELFTEST_ENV.ANALYTICS_BASE_URL;
        process.env.ANALYTICS_SERVICE_KEY = SELFTEST_ENV.ANALYTICS_SERVICE_KEY;
        const code = await main(["--arm", "pyapi06"]);
        pass =
          expect(code === 2, `a GREEN narrowed run returns 2, never 0 (got ${code})`) &&
          pass;
      } finally {
        setSeamsFactoryForTests(null);
        for (const [k, v] of Object.entries(saved)) {
          if (v === undefined) delete process.env[k];
          else process.env[k] = v;
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  scenario("a PUBLIC IDENTIFIER survives the log while a SHORT secret is still redacted (WINDOWS 37)");
  // -------------------------------------------------------------------------
  {
    const fx = loadFixtureText("mt5", "no-probe-line.txt");
    if (!fx.ok) {
      pass = expect(false, fx.reason) && pass;
    } else {
      // The REAL production values, not the deliberately-unlike ones the rest
      // of the self-test uses — the point is that the live shape now reads.
      // The token is SHORT on purpose: it proves the fix is an allowlist and
      // not a length floor, which would have been fail-open.
      const SHORT_SECRET = "hunter2";
      const env = {
        ...SELFTEST_ENV,
        RAILWAY_MT5_SERVICE: "mt5-gateway",
        RAILWAY_ENVIRONMENT: "production",
        RAILWAY_API_TOKEN: SHORT_SECRET,
      };
      const seams = createSeams({
        sshRunner: fixtureSsh({
          stdout: fx.data,
          status: 255,
          stderr: `the mt5-gateway relay refused the production session (token ${SHORT_SECRET})`,
        }),
      });
      const r = await runProber({ arms: [MT5_MOD.ARM], env, seams, armsFloor: 1, log: quiet });
      const d = r.defects[0] || {};
      const detail = String(d.detail);
      pass =
        expect(d.kind === "mt5-ssh-transport", `the transport defect still fires (got ${d.kind})`) &&
        expect(
          detail.includes("mt5-gateway"),
          `the SERVICE NAME survives, so the row is readable (${JSON.stringify(detail)})`,
        ) &&
        expect(
          detail.includes("production"),
          "the ENVIRONMENT name survives too — both are public identifiers, in the workflow file",
        ) &&
        expect(
          detail.includes(SHORT_SECRET) === false,
          "and the SHORT secret is STILL redacted — the allowlist is by NAME, never by length",
        ) &&
        expect(
          NON_SECRET_ENV.includes("RAILWAY_API_TOKEN") === false,
          "the token's name is not on the allowlist, which is why it was redacted",
        ) &&
        pass;
    }
  }

  // -------------------------------------------------------------------------
  scenario("two responses in ONE run's window is measure-fail, not a verdict (review WR-01)");
  // -------------------------------------------------------------------------
  {
    const fx = loadFixture("cron-obs", "ambiguous-window.json");
    if (!fx.ok) {
      pass = expect(false, fx.reason) && pass;
    } else {
      const seams = createSeams({
        sqlRunner: fixtureSql({ cronObs: fx.data, ttl: fx.data.ttl }),
        // The fixture's runs are dated; without pinning the clock they fall
        // outside the scan window and the arm judges nothing.
        clock: () => new Date(fx.data.now),
      });
      const r = await runProber({
        arms: [CRON_OBS_MOD.ARM],
        env: { ...SELFTEST_ENV },
        seams,
        armsFloor: 1,
        log: quiet,
      });
      const mf = r.defects.filter((d) => d.kind === "measure-fail");
      pass =
        expect(mf.length === 1, `the ambiguous run yields exactly ONE measure-fail (got ${mf.length})`) &&
        expect(
          String(mf[0].subject).includes("901003"),
          `and it names the ambiguous run (${mf[0].subject})`,
        ) &&
        // THE LOAD-BEARING LEG: the 500 in that window must NOT be reported as
        // match_engine_cron's answer, and the 200 must NOT buy it a pass. Before
        // the fence, the loop judged each row independently.
        expect(
          noDefectOfKind(r.defects, ["cron-non-2xx", "cron-no-observation", "cron-transport-error"]),
          "and NO verdict is issued about that run — neither the foreign 500 nor the 200 is attributed to it",
        ) &&
        pass;
    }
  }

  console.log("");
  pass =
    expect(
      printed === SELF_TEST_SCENARIOS,
      `the counted scenario set is complete: ${printed} header(s) printed, SELF_TEST_SCENARIOS is ${SELF_TEST_SCENARIOS}`,
    ) && pass;

  console.log("");
  if (pass) {
    console.log(
      `=== SELF-TEST PASSED: ${SELF_TEST_SCENARIOS}/${SELF_TEST_SCENARIOS} scenarios, every arm's kinds fired on their own fixtures and nowhere else ===`,
    );
    return 0;
  }
  console.error("=== SELF-TEST FAILED ===");
  return 1;
}

// ---------------------------------------------------------------------------
// --capture-manifest: produce the cron oracle FROM PROD, read-only
// ---------------------------------------------------------------------------

/**
 * Capture `cron.job` into a manifest file.
 *
 * ⛔ FOUR REFUSALS, and each of them writes NOTHING:
 *
 *   3 — no `--out` path. The destination is REQUIRED and is never defaulted to
 *       `MANIFEST_PATH`, so a capture is always a reviewed file MOVE rather
 *       than a script silently rewriting the oracle it is judged against.
 *   3 — the database has no `COMMENT ON DATABASE` marker, or the read failed.
 *       An unlabelled database is one whose identity was never established;
 *       `current_database()` is `postgres` on every Supabase project.
 *   3 — a `cron.job` record the parser could not read. An oracle captured from
 *       a reading with a hole in it would record the hole as the standard, and
 *       the missing row would then be judged against nothing forever. This is
 *       a 3 rather than a 1 on purpose: hygiene never ran, so the two refusals
 *       must stay distinguishable by exit code alone.
 *   1 — ANY row fails ANY of the ten hygiene rules. This is what makes the
 *       manifest an oracle of the ACHIEVABLE configuration rather than a
 *       photograph of whatever PROD has: it CANNOT be captured into a state
 *       that carries a credential. The refusal prints the jobname and the rule
 *       ids, never the offending text.
 *
 * The command TEXT is written on success precisely because every row passed
 * those ten rules. A reviewer may still withhold any row to sha-only afterwards
 * — see the withhold procedure at the top of `arms/cron-drift.mjs`.
 *
 * @returns {Promise<number>} the CLI exit code (0 captured / 1 refused on hygiene / 3 refused on usage, an unidentified database, or an unreadable cron.job record)
 */
export async function captureManifest({ seams, outPath, log = (s) => console.log(s) }) {
  if (!outPath) {
    log("ERROR: --capture-manifest requires --out <path>. The destination is never defaulted to the committed oracle — a capture is a reviewed file move.");
    return 3;
  }

  const markerRes = await seams.sql("cron-drift", CRON_DRIFT_MOD.DB_MARKER_SQL);
  if (markerRes.measureFail) {
    log(`ERROR: the database marker could not be read: ${markerRes.measureFail}. Nothing was written.`);
    return 3;
  }
  const marker = String(markerRes.stdout || "").trim();
  if (marker.length === 0) {
    log("ERROR: the database has no COMMENT ON DATABASE marker, so which database this capture came from cannot be established. Re-set the marker before capturing. Nothing was written.");
    return 3;
  }

  const res = await seams.sql("cron-drift", CRON_DRIFT_MOD.CRON_JOB_SQL, CRON_DRIFT_MOD.CRON_JOB_SEPARATORS);
  if (res.measureFail) {
    log(`ERROR: cron.job could not be read: ${res.measureFail}. Nothing was written.`);
    return 3;
  }
  const { rows, malformed } = CRON_DRIFT_MOD.parseCronJobRows(res.stdout);
  if (malformed.length > 0) {
    // ⛔ BEFORE the hygiene loop, and deliberately: a record that could not be
    // parsed was never handed to the ten rules, so a capture that proceeded
    // would be certifying text nobody read. The counts are printed; the record
    // text never is.
    log(
      `REFUSED: ${malformed.length} cron.job record(s) could not be parsed (field counts: ${malformed.map((m) => m.fields).join(", ")}; seven are required), so this reading has a hole in it and cannot become the oracle. Nothing was written.`,
    );
    log("Read the affected command by hand — a record separator (0x1E) inside a cron.job command splits it in two — then capture again.");
    return 3;
  }

  const dirty = [];
  for (const r of rows) {
    const v = CRON_DRIFT_MOD.hygieneViolations(r.jobname, r.command);
    if (v.length > 0) dirty.push({ jobname: r.jobname, rules: v.map((x) => x.slice(0, x.indexOf("]") + 1)) });
  }
  if (dirty.length > 0) {
    log(`REFUSED: ${dirty.length} cron.job row(s) fail secret hygiene, so this configuration cannot become the oracle. Nothing was written.`);
    for (const d of dirty) log(`  ${d.jobname}: ${d.rules.join(" ")}`);
    log("Rotate the exposed secret, re-schedule that job onto a vault.decrypted_secrets body, then capture again.");
    return 1;
  }

  const capturedAt = seams.now().toISOString();
  const jobs = rows
    .map((r) => ({
      jobid: Number.parseInt(r.jobid, 10),
      jobname: r.jobname,
      schedule: r.schedule,
      active: r.active,
      database: r.database,
      username: r.username,
      command_sha256: CRON_DRIFT_MOD.sha256Hex(CRON_DRIFT_MOD.normalizeCommand(r.command)),
      command: CRON_DRIFT_MOD.normalizeCommand(r.command),
    }))
    .sort((a, b) => (a.jobname < b.jobname ? -1 : a.jobname > b.jobname ? 1 : 0));

  writeFileSync(
    outPath,
    `${JSON.stringify(
      {
        schema_version: CRON_DRIFT_MOD.MANIFEST_SCHEMA_VERSION,
        normalization: CRON_DRIFT_MOD.NORMALIZATION,
        captured_at: capturedAt,
        database_marker: marker,
        jobs,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  log(`captured ${jobs.length} job(s) from database "${marker}" at ${capturedAt}`);
  for (const j of jobs) {
    log(`  ${j.jobname} ${j.schedule} active=${j.active} sha ${j.command_sha256.slice(0, 12)}`);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/**
 * The seams factory `main` uses. Overridable ONLY by `--self-test` scenario 13,
 * which needs `main`'s own argument parsing and exit-code mapping under test
 * without touching the network. The CLI never calls the setter.
 */
const liveSeams = () =>
  createSeams({
    fetchImpl: realFetch,
    // `process.env` is read HERE, at factory-call time, and nowhere else in this
    // file's arm/seam layer — so a self-test scenario can still hold the whole
    // environment in its hand.
    sqlRunner: realSqlRunner(process.env),
    sshRunner: realSshRunner(process.env),
  });

let seamsFactory = liveSeams;

export function setSeamsFactoryForTests(factory) {
  seamsFactory = factory || liveSeams;
}

export async function main(argv) {
  let onlyArm = null;
  let wantCapture = false;
  let outPath = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--self-test") return selfTest();
    else if (arg === "--arm") {
      onlyArm = argv[++i];
      if (!onlyArm) {
        console.error("ERROR: --arm needs an arm name");
        return 3;
      }
    } else if (arg === "--capture-manifest") {
      wantCapture = true;
    } else if (arg === "--out") {
      outPath = argv[++i];
      if (!outPath) {
        console.error("ERROR: --out needs a path");
        return 3;
      }
    } else {
      console.error(`ERROR: unknown argument ${JSON.stringify(arg)}`);
      console.error(
        "Usage: node scripts/prod-prober/run.mjs [--self-test] [--arm <name>] [--capture-manifest --out <path>]",
      );
      return 3;
    }
  }

  if (wantCapture) {
    // ⛔ Refuses without --out, and never defaults to MANIFEST_PATH: the
    // capture writes an ARTIFACT a human reviews and moves into place.
    return captureManifest({ seams: seamsFactory(), outPath, log: (s) => console.log(s) });
  }

  console.log(
    onlyArm
      ? `prod-prober: NARROWED DIAGNOSTIC run of arm ${onlyArm}`
      : `prod-prober: live run, ${ARMS.length} registered arm(s)`,
  );
  const result = await runProber({ seams: seamsFactory(), env: process.env, onlyArm });
  return result.exitCode;
}

if (process.argv[1] && process.argv[1].endsWith("run.mjs")) {
  let code = 3;
  try {
    code = await main(process.argv.slice(2));
  } catch (err) {
    console.error(`ERROR: prod-prober crashed before it could report: ${err && err.message}`);
  }
  process.exit(code);
}
