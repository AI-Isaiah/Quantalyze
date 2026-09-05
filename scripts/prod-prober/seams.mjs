/**
 * prod-prober I/O seams (phase 164.1 plan 01).
 *
 * ============================================================================
 * WHY THIS FILE EXISTS
 * ============================================================================
 * Every byte of I/O the prober performs goes through ONE of these seams, and
 * every seam increments a counter before it delegates. That buys two things
 * the prober cannot have without it:
 *
 *   1. `--self-test` drives the REAL `runProber` verdict loop. An arm's fault
 *      is injected by swapping `fetchImpl`, not by stubbing the verdict — so
 *      the thing proven to fire is the shipping code path, not a rehearsal of
 *      it. (Ported from `scripts/mutation-runner/run.mjs:3722-3740`, whose
 *      injectable `laneRunner` exists for exactly this reason.)
 *
 *   2. A SECOND, INDEPENDENT tally of how much work actually happened. The
 *      verdict loop counts arms it believes it executed; this file counts
 *      seam calls that actually left the process. When those two disagree,
 *      the runner reports `absurdity` — the instrument is broken, and neither
 *      number above it is a measurement. A stub that never touches the tally
 *      produces executed=N / seam-invocations=0 BY CONSTRUCTION, which is what
 *      makes that floor provable rather than aspirational.
 *
 * ⛔ NOTHING IN THIS FILE READS `process`.env. Arms and seams see the
 * environment only through the `env` object `runProber` hands them, so a
 * self-test scenario can hold the whole environment in its hand. (Asserted by
 * this plan's acceptance criteria: a `process` + `.env` hit in this file is a
 * regression.)
 *
 * ⛔ NOTHING IN THIS FILE PRINTS. Response headers in particular never leave a
 * seam: the repository and its Actions logs are public. The seam returns a
 * status, a parsed body when the server said it was JSON, and the raw text;
 * what may be shown is the caller's decision (`run.mjs` caps bodies at 200
 * chars and prints them only beside a defect).
 */

import { spawnSync } from "node:child_process";

const FETCH_TIMEOUT_MS = 15000;
const SQL_TIMEOUT_MS = 60000;
/** Fallback only — `arms/mt5.mjs` owns the budget and passes it per call. */
const DEFAULT_SSH_TIMEOUT_MS = 120000;

/**
 * The module-level invocation tally. MONOTONIC — read as a DELTA across a
 * `runProber` call, exactly as the mutation runner reads `laneTally`
 * (`run.mjs:3765-3772`). `runProber` snapshots it before the arms run and
 * subtracts afterwards; it must never reset it, or the two tallies stop being
 * two independent counts of the same work.
 *
 * `byArm` is the per-arm view: the absurdity floor needs to know not just that
 * SOME seam ran, but that EVERY arm the verdict loop claims it executed made
 * at least one call of its own.
 */
export const tally = {
  fetch: 0,
  sql: 0,
  ssh: 0,
  byArm: Object.create(null),
};

/**
 * Reset the tally to zero.
 *
 * ⚠️ SELF-TEST ONLY, and even there it is a convenience rather than a
 * requirement — `runProber` reads the tally as a delta, so scenarios compose
 * without it. The CLI NEVER calls this. A reset inside a live run would erase
 * the very evidence the absurdity floor cross-checks.
 */
export function resetTallyForTests() {
  tally.fetch = 0;
  tally.sql = 0;
  tally.ssh = 0;
  tally.byArm = Object.create(null);
}

function bump(kind, arm) {
  tally[kind] += 1;
  const name = typeof arm === "string" && arm.length > 0 ? arm : "<unattributed>";
  tally.byArm[name] = (tally.byArm[name] || 0) + 1;
}

/**
 * The real HTTP seam.
 *
 * A network throw comes back as `measureFail`, NEVER as a thrown error and
 * NEVER as a status the caller could mistake for a verdict. "Could not
 * measure" and "measured no problem" do not share a code path here
 * (`scripts/prod-body-drift-check.sh:24-35`, non-negotiable 3).
 *
 * @param {string} url
 * @param {{method?: string, headers?: Record<string,string>}} [init]
 * @returns {Promise<{status: number|null, json: any, text: string, measureFail: string|null}>}
 */
export async function realFetch(url, init = {}) {
  try {
    const res = await fetch(url, {
      method: init.method || "GET",
      headers: init.headers || {},
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const text = await res.text();
    let json = null;
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("json")) {
      try {
        json = JSON.parse(text);
      } catch {
        // A server that labelled a non-JSON body as JSON is a finding for the
        // caller, not a crash here. `json` stays null and `text` carries it.
        json = null;
      }
    }
    return { status: res.status, json, text, measureFail: null };
  } catch (err) {
    // AbortError (the 15s timeout), DNS failure, TLS failure, ECONNREFUSED.
    // The message can contain the URL, which can contain a credential-bearing
    // host; `runProber`'s scrubber runs over every string before it is logged.
    const name = err && err.name ? err.name : "Error";
    const message = err && err.message ? err.message : String(err);
    return { status: null, json: null, text: "", measureFail: `${name}: ${message}` };
  }
}

/**
 * The real SQL seam (phase 164.1 plan 03, D-19).
 *
 * Spawns `psql` against the PROD **session pooler** URL. Three properties are
 * load-bearing and none of them is stylistic:
 *
 *   1. THE PASSWORD IS NEVER IN THE URL. It travels as `PGPASSWORD` in the
 *      CHILD's environment only, which keeps it out of `ps`, out of any error
 *      message that echoes argv, and out of the URL string the caller might
 *      later print. The child env is built from scratch (`PATH`, `PGPASSWORD`,
 *      `PGCONNECT_TIMEOUT`) rather than inherited, so nothing else in the
 *      runner's environment is handed to psql either.
 *   2. THE URL IS NEVER LOGGED. It is an argv element and nothing else. The one
 *      place psql's own output could leak it — stderr — is redacted here
 *      (`<pooler-url>`) and truncated to its FIRST LINE before it can reach a
 *      caller. This repository and its Actions logs are public (T-164.1-11).
 *   3. `-X` skips `~/.psqlrc`, so a developer's local psql configuration cannot
 *      change what the prober measures. `-v ON_ERROR_STOP=1` makes a mid-script
 *      error a non-zero exit rather than a partial answer.
 *
 * ⛔ AN EMPTY STDOUT WITH STATUS 0 IS A LEGITIMATE ZERO-ROW ANSWER, AND THIS
 * SEAM DOES NOT INTERPRET IT. Whether "no rows" means "nothing is wrong" or
 * "the thing that should exist does not" is a question only the ARM can answer
 * — for `cron-obs` zero runs in the window is a DEFECT, for a hypothetical
 * other arm it might be fine. What this seam guarantees is the distinction the
 * arm needs to answer it at all: a psql that could not run, timed out, or
 * exited non-zero comes back as `measureFail`, never as an empty answer.
 * ("Could not measure" and "measured no problem" do not share a code path —
 * `scripts/prod-body-drift-check.sh:24-35`, non-negotiable 3.)
 *
 * @param {Record<string,string|undefined>} env  needs `PROBER_POOLER_URL`,
 *        `SUPABASE_DB_PASSWORD` and `PATH`. Read ONCE, at factory time.
 * @returns {(query: string, opts?: {fieldSep?: string, recordSep?: string|null}) => object}
 *
 * `opts.fieldSep` / `opts.recordSep` exist because one query in this prober
 * returns MULTI-LINE text (`cron.job.command`), which the default tab/newline
 * separators cannot round-trip. `arms/cron-drift.mjs` passes the ASCII unit and
 * record separators for that query and documents why at the call site.
 */
export function realSqlRunner(env) {
  const url = env.PROBER_POOLER_URL;
  const password = env.SUPABASE_DB_PASSWORD;
  const path = env.PATH;

  /** psql's stderr is the ONE channel that can echo the DSN. One line, redacted. */
  const redact = (text) => {
    const firstLine = String(text || "").split("\n")[0].trim();
    if (!url) return firstLine;
    return firstLine.split(url).join("<pooler-url>");
  };

  return (query, opts = {}) => {
    const fieldSep = typeof opts.fieldSep === "string" ? opts.fieldSep : "\t";
    const recordSep = typeof opts.recordSep === "string" ? opts.recordSep : null;

    const argv = [url, "-v", "ON_ERROR_STOP=1", "-At", "-F", fieldSep];
    if (recordSep !== null) argv.push("-R", recordSep);
    argv.push("-X", "-c", query);

    const child = spawnSync("psql", argv, {
      timeout: SQL_TIMEOUT_MS,
      encoding: "utf8",
      env: { PATH: path, PGPASSWORD: password, PGCONNECT_TIMEOUT: "15" },
    });

    const base = { status: null, stdout: "", stderr: "", timedOut: false, measureFail: null };

    if (child.error && child.error.code === "ENOENT") {
      return { ...base, measureFail: "psql not found on PATH" };
    }
    if (child.signal || (child.error && child.error.code === "ETIMEDOUT")) {
      return { ...base, timedOut: true, measureFail: `psql timed out after ${SQL_TIMEOUT_MS / 1000}s` };
    }
    if (child.error) {
      return { ...base, measureFail: `psql could not be spawned: ${redact(child.error.message)}` };
    }
    if (child.status !== 0) {
      return {
        ...base,
        status: child.status,
        stdout: child.stdout || "",
        stderr: redact(child.stderr),
        measureFail: `psql exited ${child.status}: ${redact(child.stderr)}`,
      };
    }
    return {
      status: 0,
      stdout: child.stdout || "",
      stderr: child.stderr || "",
      timedOut: false,
      measureFail: null,
    };
  };
}

/**
 * The real `railway ssh` seam (phase 164.1 plan 04, D-19).
 *
 * Spawns the Railway CLI to execute ONE command inside the `mt5-gateway`
 * container. Five properties are load-bearing:
 *
 *   1. THE TOKEN TRAVELS AS `RAILWAY_API_TOKEN` IN THE CHILD ENV ONLY. That is
 *      the CLI's WORKSPACE/ACCOUNT credential slot. ⛔ Do NOT rename it to the
 *      CLI's other, shorter credential variable — the PROJECT slot. They are
 *      NOT aliases: `railway ssh` REFUSES a project-scoped token (RESEARCH F4;
 *      the CLI's own docs say SSH key management is unsupported with it), so a
 *      renamed variable would make every live run report `mt5-ssh-transport`
 *      for a self-inflicted reason. The project slot's NAME must not appear
 *      anywhere under `scripts/prod-prober/` — not in code, not in a comment,
 *      not in a fixture — so this file says "the project slot" in prose and
 *      an acceptance grep (and the plan-05 wiring test) pins the absence.
 *   2. THE CHILD ENV IS BUILT FROM SCRATCH — `PATH`, `HOME` (the CLI reads its
 *      own config dir from it), `RAILWAY_API_TOKEN` and `CI=1`. Nothing else in
 *      the runner's environment is handed to the CLI.
 *   3. `input: ""` CLOSES STDIN. Piped input runs without a PTY, so the CLI
 *      cannot prompt and cannot allocate a terminal (docs.railway.com/cli/ssh).
 *      A prober that can block on a prompt is a prober that hangs a workflow.
 *   4. ssh's OWN EXIT STATUS AND STDOUT ARE CAPTURED SEPARATELY, and a non-zero
 *      exit is NOT a `measureFail`. `scripts/mt5-diag.sh:45-46` pipes into
 *      `grep '^PROBE '` and lets the PIPE decide the exit — which throws away
 *      the CLI's own status and conflates "the transport failed" with "the
 *      probe answered something unexpected". Here both readings survive to the
 *      arm, and `classifyProbe` decides. Only ENOENT, a spawn error and the
 *      TIMEOUT are `measureFail` — states in which nothing was measured at all.
 *   5. STDERR IS REDACTED AND TRUNCATED TO ITS FIRST LINE. The CLI echoes its
 *      own token in some Unauthorized messages; this repository and its Actions
 *      logs are public (T-164.1-18/19).
 *
 * @param {Record<string,string|undefined>} env  needs `RAILWAY_API_TOKEN`, `PATH`,
 *        and `HOME`. Read ONCE, at factory time.
 * @returns {(argv: string[], opts?: {timeoutMs?: number}) => object}
 */
export function realSshRunner(env) {
  const token = env.RAILWAY_API_TOKEN;

  /** The CLI's stderr is the ONE channel that can echo the token. One line, redacted. */
  const redact = (text) => {
    const firstLine = String(text || "").split("\n")[0].trim();
    if (!token) return firstLine;
    return firstLine.split(token).join("<redacted>");
  };

  // Built once, and only from names that exist — an `undefined` value in a
  // spawn env object becomes the literal string "undefined" in the child.
  const childEnv = {};
  for (const [name, value] of Object.entries({
    PATH: env.PATH,
    HOME: env.HOME,
    RAILWAY_API_TOKEN: token,
    CI: "1",
  })) {
    if (typeof value === "string") childEnv[name] = value;
  }

  return (argv, opts = {}) => {
    const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : DEFAULT_SSH_TIMEOUT_MS;

    const child = spawnSync("railway", argv, {
      encoding: "utf8",
      input: "",
      timeout: timeoutMs,
      env: childEnv,
    });

    const base = { status: null, stdout: "", stderr: "", timedOut: false, measureFail: null };

    if (child.error && child.error.code === "ENOENT") {
      return { ...base, measureFail: "railway CLI not found on PATH" };
    }
    if (child.signal || (child.error && child.error.code === "ETIMEDOUT")) {
      return { ...base, timedOut: true, measureFail: `railway ssh exceeded ${timeoutMs} ms` };
    }
    if (child.error) {
      return { ...base, measureFail: `railway ssh could not be spawned: ${redact(child.error.message)}` };
    }
    // ⛔ NOT a measureFail on a non-zero status. See property 4 above: a CLI
    // that exited non-zero may still have printed the PROBE line, and one that
    // exited 0 without a PROBE line is a finding the ARM must classify.
    return {
      status: child.status,
      stdout: child.stdout || "",
      stderr: redact(child.stderr),
      timedOut: false,
      measureFail: null,
    };
  };
}

/**
 * Build the seam bundle handed to every arm.
 *
 * Seam result shapes are a FIXED CONTRACT — plans 03 (cron-obs, cron-drift)
 * and 04 (mt5) are written against them and the plan-05 wiring test pins them:
 *
 *   fetch → { status: number|null, json: any, text: string, measureFail: string|null }
 *   sql   → { status: number|null, stdout: string, stderr: string, timedOut: boolean, measureFail: string|null }
 *   ssh   → same shape as sql
 *
 * @param {object} [opts]
 * @param {(url: string, init?: object) => Promise<object>} [opts.fetchImpl]
 *        INJECTABLE. `--self-test` passes a fixture-backed implementation; the
 *        CLI never does.
 * @param {((query: string, opts?: object) => object)|null} [opts.sqlRunner]
 *        wired by plan 03 — the CLI builds it from the real environment (see
 *        `liveSeams` in run.mjs), the self-test passes a fixture-backed
 *        renderer. Spelled without the literal accessor on purpose: this file
 *        must stay at ZERO hits for it, and a downstream grep cannot tell a
 *        docblock from a read.
 * @param {((argv: string[], opts: object) => object)|null} [opts.sshRunner]
 *        wired by plan 04 — the CLI builds it from the real environment
 *        (`liveSeams` in run.mjs), the self-test passes a fixture-backed runner
 *        that answers with a committed `railway ssh` stdout transcript.
 * @param {() => Date} [opts.clock] INJECTABLE clock (plan 03's cron arm needs a stable "now")
 */
export function createSeams({
  fetchImpl = realFetch,
  sqlRunner = null,
  sshRunner = null,
  clock = () => new Date(),
} = {}) {
  return {
    /** @returns {Promise<{status: number|null, json: any, text: string, measureFail: string|null}>} */
    async fetch(arm, url, init) {
      bump("fetch", arm);
      return fetchImpl(url, init);
    },

    /**
     * @param {string} arm
     * @param {string} query
     * @param {{fieldSep?: string, recordSep?: string|null}} [opts] per-query psql
     *        separators — see `realSqlRunner`. Passed through untouched so a
     *        fixture runner can render its answer with the SAME separators the
     *        real seam would use, which is what makes the fixture prove the
     *        arm's PARSER and not just its judgement.
     * @returns {Promise<{status: number|null, stdout: string, stderr: string, timedOut: boolean, measureFail: string|null}>}
     */
    async sql(arm, query, opts) {
      // The wiring check runs BEFORE the tally: an unwired seam was never
      // delegated to, so counting it would inflate the very number the
      // absurdity floor cross-checks against. This throw is a programming
      // error (an arm registered before its runner), not a production finding
      // — `runProber` catches it and reports `measure-fail` on that arm.
      if (!sqlRunner) throw new Error("seam sql not wired");
      bump("sql", arm);
      return sqlRunner(query, opts || {});
    },

    /** @returns {Promise<{status: number|null, stdout: string, stderr: string, timedOut: boolean, measureFail: string|null}>} */
    async ssh(arm, argv, opts) {
      if (!sshRunner) throw new Error("seam ssh not wired");
      bump("ssh", arm);
      return sshRunner(argv, opts || {});
    },

    now() {
      return clock();
    },

    tally,
  };
}
