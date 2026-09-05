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
 *   node scripts/prod-prober/run.mjs --capture-manifest --out <p> # reserved for plan 03
 *
 * Exit codes:
 *   0  live run, every registered arm executed and measured, no defects, floors held
 *   1  at least one defect, a floor regression, or an ABSURDITY — the prober's
 *      two independent tallies of its own work disagree
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

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createSeams, realFetch } from "./seams.mjs";
import { ARM as PYAPI06_ARM } from "./arms/pyapi06.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = join(HERE, "fixtures");

/**
 * The committed cron oracle plan 03's `cron-drift` arm compares PROD against
 * (D-13). Declared here so the path is one string in one place; plan 06
 * captures the file itself from PROD.
 */
export const MANIFEST_PATH = join(HERE, "cron-manifest.json");

/**
 * D-08 — the pinned arm floor. FOUR: pyapi06, cron-obs, cron-drift, mt5.
 *
 * ⚠️ THIS IS 4 WHILE ONLY ONE ARM IS REGISTERED, ON PURPOSE. A live run today
 * reports `floor` (`1 registered arm(s) < floor 4`) and exits 1. That is the
 * tripwire working, not a bug: an incomplete prober must be LOUD until plans 03
 * and 04 register the other three arms. The alternative — ratcheting the floor
 * up as arms land — is a floor that can only ever agree with reality, which is
 * not a floor. Lowering this number is how an arm disappears quietly.
 */
export const ARMS_FLOOR = 4;

/** The counted `--self-test` scenario set. See the renumbering warning on `selfTest`. */
export const SELF_TEST_SCENARIOS = 13;

/**
 * Every defect this prober can report. EXPORTED so the plan-05 wiring test can
 * range over it rather than restating it — a list restated in a test is a
 * second thing to drift; a list the implementation owns is not.
 *
 * ⚠️ ALL TWENTY KINDS ARE REGISTERED NOW, including the cron and mt5 kinds no
 * arm raises yet. Plans 03 and 04 then add SCENARIOS, not kinds, and the
 * wiring test's `EXPECTED_DEFECT_KINDS` pin never has to move for an arm that
 * was always going to land.
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

/** The registered arms. Plans 03 and 04 append; nothing else changes. */
export const ARMS = [PYAPI06_ARM];

/**
 * Per-NAME remedy for `credential-absent`. Names only — these strings are
 * printed into a public Actions log.
 */
const CREDENTIAL_REMEDIES = {
  ANALYTICS_BASE_URL:
    "Set the repo variable ANALYTICS_BASE_URL to the public analytics base URL (the same default .github/workflows/analytics-deploy-verify.yml carries).",
  ANALYTICS_SERVICE_KEY:
    "Set the GitHub Actions secret ANALYTICS_SERVICE_KEY from Railway's SERVICE_KEY, through a trimming pipe — Railway is the source of truth, copy Railway → GitHub, never the reverse.",
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
function makeScrubber(arms, env) {
  const values = [];
  for (const arm of arms) {
    for (const name of arm.requiredEnv) {
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
// ⚠️ The `k/13` scenario headers are a COUNTED set. Before adding or removing a
// scenario, renumber every `k/13` spelling AND `SELF_TEST_SCENARIOS` in ONE
// edit — a stale count makes this self-test lie about its own coverage. The
// count is asserted against the number of headers actually printed.
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

const SELFTEST_ENV = {
  ANALYTICS_BASE_URL: "https://analytics.selftest.invalid",
  ANALYTICS_SERVICE_KEY: "selftest-fixture-key-not-a-credential",
};

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

/** Deep-enough clone for fixture merging (fixtures are plain JSON). */
const clone = (o) => JSON.parse(JSON.stringify(o));

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
 */
const ARM_FIXTURE_TABLE = [
  {
    arm: PYAPI06_ARM,
    fixtureDir: "pyapi06",
    green: "ok.json",
    greenSeamCalls: 4,
    red: {
      "keyed-401.json": "pyapi06-keyed-refused",
      "absent-200.json": "pyapi06-absent-accepted",
      "absent-401-uncoded.json": "pyapi06-absent-uncoded",
      "wrong-key-200.json": "pyapi06-wrong-key-accepted",
      "health-degraded.json": "pyapi06-health-degraded",
    },
  },
];

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
  };

  const captured = [];
  const quiet = (line) => captured.push(line);
  let pass = true;
  let printed = 0;
  // Headers are AUTO-NUMBERED off the same counter the completeness assertion
  // reads, so the printed `k/13` can never disagree with the number of
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
    const armKinds = DEFECT_KINDS.filter((k) => k.startsWith(`${arm.name}-`));

    scenario(`${arm.name} GREEN fixture (${entry.green}) — the control`);
    const g = loadFixture(entry.fixtureDir, entry.green);
    if (!g.ok) {
      pass = expect(false, g.reason) && pass;
    } else {
      const lines = [];
      const seams = createSeams({ fetchImpl: fixtureFetch(g.data, SELFTEST_ENV) });
      const r = await runProber({
        arms: [arm],
        env: { ...SELFTEST_ENV },
        seams,
        armsFloor: 1,
        log: (s) => lines.push(s),
      });
      const remedies = armKinds.map((k) => (arm.REMEDIES || {})[k]);
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
          armKinds.length === Object.keys(entry.red).length,
          `every ${arm.name}- kind in DEFECT_KINDS has a red fixture (${armKinds.length} kind(s) vs ${Object.keys(entry.red).length} fixture(s))`,
        ) &&
        expect(
          remedies.every((s) => typeof s === "string" && s.length >= 40),
          `every ${arm.name}- kind carries a REMEDIES entry of at least 40 chars — a defect row that says what broke but not what to do is an alert nobody acts on`,
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
      const fx = loadFixture(entry.fixtureDir, fixture);
      if (!fx.ok) {
        pass = expect(false, fx.reason) && pass;
        continue;
      }
      const seams = createSeams({ fetchImpl: fixtureFetch(fx.data, SELFTEST_ENV) });
      const r = await runProber({
        arms: [arm],
        env: { ...SELFTEST_ENV },
        seams,
        armsFloor: 1,
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
  scenario("credential-absent fires PER NAME, blocks the arm, and is never a skip (D-06)");
  // -------------------------------------------------------------------------
  {
    if (!green.ok) {
      pass = expect(false, green.reason) && pass;
    } else {
      for (const name of PYAPI06_ARM.requiredEnv) {
        const env = { ...SELFTEST_ENV };
        delete env[name];
        const lines = [];
        const seams = createSeams({ fetchImpl: fixtureFetch(green.data, SELFTEST_ENV) });
        const r = await runProber({
          arms: [PYAPI06_ARM],
          env,
          seams,
          armsFloor: 1,
          log: (s) => lines.push(s),
        });
        const creds = r.defects.filter((x) => x.kind === "credential-absent");
        pass =
          expect(r.exitCode === 1, `an absent ${name} exits 1, never 0 (got ${r.exitCode})`) &&
          expect(creds.length === 1, `an absent ${name} raises exactly one credential-absent defect (got ${creds.length})`) &&
          expect((creds[0] || {}).subject === name, `the defect names ${name} as its subject (got ${(creds[0] || {}).subject})`) &&
          expect(String((creds[0] || {}).detail).includes(name), `the detail names ${name}`) &&
          expect(lines.includes(`credential: ${name} ABSENT`), `the log carries "credential: ${name} ABSENT"`) &&
          expect(r.armsBlocked === 1, `the arm is BLOCKED, not run (armsBlocked ${r.armsBlocked})`) &&
          expect(r.armsExecuted === 0, `the blocked arm did not execute (armsExecuted ${r.armsExecuted})`) &&
          expect(r.seamInvocations === 0, `a blocked arm performs no I/O (seam-invocations ${r.seamInvocations})`) &&
          expect(
            noDefectOfKind(r.defects, PYAPI06_KINDS),
            `a blocked arm reports no pyapi06 verdict of any kind (absent ${name})`,
          ) &&
          pass;
      }
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

  console.log("");
  pass =
    expect(
      printed === SELF_TEST_SCENARIOS,
      `the counted scenario set is complete: ${printed} header(s) printed, SELF_TEST_SCENARIOS is ${SELF_TEST_SCENARIOS}`,
    ) && pass;

  console.log("");
  if (pass) {
    console.log(
      `=== SELF-TEST PASSED: ${SELF_TEST_SCENARIOS}/${SELF_TEST_SCENARIOS} scenarios, every pyapi06 kind fired on its own fixture and nowhere else ===`,
    );
    return 0;
  }
  console.error("=== SELF-TEST FAILED ===");
  return 1;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/**
 * The seams factory `main` uses. Overridable ONLY by `--self-test` scenario 13,
 * which needs `main`'s own argument parsing and exit-code mapping under test
 * without touching the network. The CLI never calls the setter.
 */
let seamsFactory = () => createSeams({ fetchImpl: realFetch });

export function setSeamsFactoryForTests(factory) {
  seamsFactory = factory || (() => createSeams({ fetchImpl: realFetch }));
}

export async function main(argv) {
  let onlyArm = null;
  let captureManifest = false;

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
      captureManifest = true;
    } else if (arg === "--out") {
      i += 1;
    } else {
      console.error(`ERROR: unknown argument ${JSON.stringify(arg)}`);
      console.error(
        "Usage: node scripts/prod-prober/run.mjs [--self-test] [--arm <name>] [--capture-manifest --out <path>]",
      );
      return 3;
    }
  }

  if (captureManifest) {
    console.error(
      "ERROR: --capture-manifest is reserved for phase 164.1 plan 03 (the cron-drift oracle) and is not implemented yet.",
    );
    return 3;
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
