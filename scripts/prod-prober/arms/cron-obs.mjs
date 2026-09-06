/**
 * CRON-OBS-01 arm — "did the hourly cron job's HTTP request actually get an
 * answer, and what was it?" (phase 164.1 plan 03).
 *
 * ============================================================================
 * THE MEASURED OUTAGE THIS ARM EXISTS FOR
 * ============================================================================
 * PROD `cron.job` jobid 1 (`match_engine_cron`) answered **401 EVERY HOUR FOR
 * SEVEN DAYS** behind a completely green cron history.
 *
 * ⛔ THE STANDING RULE THAT BUYS: `cron.job_run_details.status` IS NOT
 * EVIDENCE. `net.http_post` is ASYNC. The `cron.job_run_details` row records
 * that the request was ENQUEUED and reads `succeeded` whether the far end
 * answered 200, answered 401, or never answered at all. The only place the real
 * answer lives is `net._http_response`, and before this arm nothing in this
 * repository read it.
 *
 * ⛔ THIS ARM THEREFORE NEVER SELECTS `cron.job_run_details.status`, IN ANY
 * QUERY, FOR ANY PURPOSE. `run.mjs`'s SQL-read-only self-test scenario rejects
 * the token in any exported `*_SQL` constant of any arm, so the rule is
 * mechanical rather than remembered.
 *
 * ============================================================================
 * HOW THE TWO TABLES ARE JOINED, AND WHY BY TIME
 * ============================================================================
 * `net._http_response` carries no job id — it is keyed by the `net.http_post`
 * REQUEST id, which `cron.job_run_details` does not record. The only available
 * join is TEMPORAL: a run that started at T produced (at most) the response
 * rows created in `[T, T + 90s]`. 90 s is sized by the job's own
 * `timeout_milliseconds := 60000` (`supabase/migrations/
 * 20260408215026_schedule_match_cron_hourly.sql:65-79`) plus headroom for the
 * pg_net worker's dispatch tick.
 *
 * THREE BOUNDARIES, EACH CALIBRATED BY ITS OWN FIXTURE — because each of them
 * is a way this arm could be written so that it cannot fail:
 *
 *   120 s  A run YOUNGER than this is still in flight. Its missing response is
 *          not evidence of anything, so it is EXCLUDED rather than reported
 *          (fixture `recent-run-pending.json`, green). Without this the arm
 *          would fire on the top of every hour.
 *   121 s  A run that old with no response IS the defect (fixture
 *          `no-response.json`, red). The pair is what proves the 120 s rule is
 *          a boundary and not a blanket excuse.
 *   3 h    The scan window. `cron.job_run_details` is never auto-cleaned on
 *          this project, so an unbounded scan is a slow table scan that grows
 *          forever (T-164.1-15). Three hours of an HOURLY job is three chances
 *          to have seen something.
 *
 * ⚠️ AND THE WINDOW IS CLAMPED BY `pg_net.ttl`. pg_net PRUNES
 * `net._http_response` after its TTL (documented default `6 hours`). If an
 * operator lowers that below the scan window, older runs would have their
 * responses pruned out from under them and this arm would report
 * `cron-no-observation` for rows that were answered perfectly well — an alert
 * that is wrong in the same direction every time is worse than no alert. So the
 * TTL is READ every run, PRINTED every run, and the window shrinks to it when
 * it is shorter, with the shrink printed.
 *
 * ⛔ ZERO RUNS IN THE WINDOW IS A DEFECT, NOT A PASS. The job is hourly; three
 * hours with nothing is itself the failure. And a psql that could not run is a
 * `measure-fail`, never zero rows — the seam guarantees that distinction and
 * this arm relies on it.
 *
 * ⛔ NEVER PRINTS A VALUE, AND NEVER SELECTS `headers`. Response headers carry
 * the very `X-Service-Key` this project has already leaked once; the column is
 * not in the query at all, and the self-test rejects the token. `content` is
 * capped at 200 characters and printed only beside a defect (T-164.1-12).
 *
 * ⛔ NOTHING IN THIS FILE READS `process`.env — the environment arrives as the
 * injected `env` object.
 */

/** All timestamps are compared as ISO-8601 INSTANTS in UTC, never as local strings. */
const SCAN_WINDOW_SECONDS = 3 * 60 * 60;

/** A run younger than this may still be in flight; its missing response is not evidence. */
const IN_FLIGHT_GRACE_SECONDS = 120;

/** pg_net's documented default TTL, used when `current_setting` answers NULL. */
const DEFAULT_TTL_TEXT = "6 hours";
const DEFAULT_TTL_SECONDS = 6 * 60 * 60;

/**
 * Read pg_net's response TTL. `true` is the `missing_ok` argument: an unset GUC
 * answers NULL rather than raising, which is the case the arm treats as the
 * documented default.
 */
export const TTL_SQL = `SELECT current_setting('pg_net.ttl', true) AS ttl`;

/**
 * ONE statement. Reads `cron.job` (to know the job exists at all),
 * `cron.job_run_details` (WHEN runs happened — never their `status`) and
 * `net._http_response` (WHAT the far end actually answered).
 *
 * The `probe` CTE is what makes "the job is not scheduled" distinguishable from
 * "the job is scheduled and has not run": it guarantees EXACTLY ONE row even
 * when `runs` is empty, carrying the job count. Without it a zero-row answer
 * would conflate the two, and they have completely different remedies.
 *
 * `content` is flattened and capped at 200 chars IN SQL, so an unbounded body
 * never crosses the process boundary and a newline in a body cannot desync the
 * tab-separated parser.
 */
export const CRON_OBS_SQL = `WITH j AS (
  SELECT jobid FROM cron.job WHERE jobname = 'match_engine_cron'
), runs AS (
  SELECT r.runid, r.start_time
    FROM cron.job_run_details r
   WHERE r.jobid IN (SELECT jobid FROM j)
     AND r.start_time > now() - interval '3 hours'
), probe AS (
  SELECT (SELECT count(*) FROM j) AS job_count
)
SELECT p.job_count,
       r.runid,
       to_char(r.start_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS start_time_utc,
       h.id,
       h.status_code,
       h.timed_out,
       regexp_replace(coalesce(h.error_msg, ''), '\\s+', ' ', 'g') AS error_msg_flat,
       to_char(h.created AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_utc,
       regexp_replace(left(coalesce(h.content, ''), 200), '\\s+', ' ', 'g') AS content_head
  FROM probe p
  LEFT JOIN runs r ON true
  LEFT JOIN net._http_response h
    ON h.created BETWEEN r.start_time AND r.start_time + interval '90 seconds'
 ORDER BY r.start_time DESC NULLS LAST, h.id ASC NULLS LAST`;

/**
 * One sentence of OPERATOR REMEDY per defect kind this arm can raise.
 *
 * ⛔ `SELECT net.worker_restart()` is named here as the documented operator
 * remedy A HUMAN RUNS. This prober never executes it — every statement it
 * issues is a SELECT against a catalog or a log table (T-164.1-13).
 */
export const REMEDIES = {
  "cron-no-observation":
    "The hourly job produced no HTTP response row at all. Check that match_engine_cron is present and active in cron.job (the cron-drift arm reports this too), then that pg_net's background worker is alive — the documented operator remedy is SELECT net.worker_restart(), run by a human, never by this prober. A request that was enqueued and never answered is indistinguishable from a green cron history, which is exactly the seven-day 401 this arm exists for.",
  "cron-non-2xx":
    "The cron job's HTTP request was answered with a non-2xx status. A 401 means the key in the job's command no longer matches Railway's SERVICE_KEY: re-point the Vault secret analytics_service_key (the job reads it through vault.decrypted_secrets) and confirm the NEXT net._http_response row for this job is 2xx. Do not trust cron.job_run_details — it reads succeeded either way.",
  "cron-transport-error":
    "The cron job's HTTP request timed out or failed in transport: the analytics service did not answer within the job's own 60 s timeout_milliseconds budget. Read the Railway analytics-service logs for that tick and check GET /health; a transport failure is an upstream outage, not a credential fault, and has a different remedy from a 401.",
};

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse psql `-At -F <tab>` output into row objects.
 *
 * psql prints NULL as the EMPTY STRING in unaligned tuples-only mode, so an
 * empty field is "no value", which is precisely what the LEFT JOIN produces for
 * a run with no response. That is a meaningful reading here, not a parse
 * failure, and it is the reading `cron-no-observation` is built on.
 */
export function parseCronObsRows(stdout) {
  const out = [];
  for (const line of String(stdout || "").split("\n")) {
    if (line.length === 0) continue;
    const f = line.split("\t");
    if (f.length < 9) continue;
    out.push({
      jobCount: Number.parseInt(f[0], 10),
      runid: f[1],
      startTime: f[2],
      id: f[3],
      statusCode: f[4] === "" ? null : Number.parseInt(f[4], 10),
      timedOut: f[5] === "t",
      errorMsg: f[6],
      created: f[7],
      contentHead: f[8],
    });
  }
  return out;
}

/**
 * Parse a Postgres interval as psql renders it, to seconds.
 *
 * Handles the three shapes `current_setting('pg_net.ttl')` can produce on a
 * Supabase instance: `N hours` / `N minutes` / `N seconds` / `N days`, the
 * `HH:MM:SS` form, and the combined `1 day 06:00:00`. Returns `null` when
 * nothing could be parsed, which the caller reports rather than silently
 * treating as zero — a TTL that reads as zero would shrink the window to
 * nothing and make every run report a defect.
 */
export function parseIntervalSeconds(text) {
  const raw = String(text || "").trim();
  if (raw.length === 0) return null;
  let seconds = 0;
  let matched = false;

  const unitSeconds = { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800 };
  const unitRe = /(\d+(?:\.\d+)?)\s*(second|minute|hour|day|week)s?/gi;
  for (const m of raw.matchAll(unitRe)) {
    seconds += Number.parseFloat(m[1]) * unitSeconds[m[2].toLowerCase()];
    matched = true;
  }

  const clock = raw.match(/(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (clock) {
    seconds +=
      Number.parseInt(clock[1], 10) * 3600 +
      Number.parseInt(clock[2], 10) * 60 +
      Number.parseFloat(clock[3]);
    matched = true;
  }

  return matched ? seconds : null;
}

/** `10800` → `3h`, `7200` → `2h`, `900` → `15m`. For log lines only. */
function humanSeconds(seconds) {
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

// ---------------------------------------------------------------------------
// Judgement — PURE, so fixtures can drive it end to end
// ---------------------------------------------------------------------------

/**
 * @param {Array<object>} rows      from `parseCronObsRows`
 * @param {Date} now                from `seams.now()` — INJECTED, so fixtures are deterministic
 * @param {number|null} ttlSeconds  from `parseIntervalSeconds(TTL_SQL answer)`
 * @param {(s:string)=>void} [log]
 * @returns {Array<{kind: string, subject: string|null, detail: string}>}
 */
export function judgeCronObs(rows, now, ttlSeconds, log = () => {}) {
  const defects = [];
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();

  const effectiveTtl = typeof ttlSeconds === "number" && ttlSeconds > 0 ? ttlSeconds : DEFAULT_TTL_SECONDS;
  const windowSeconds = Math.min(SCAN_WINDOW_SECONDS, effectiveTtl);
  if (windowSeconds < SCAN_WINDOW_SECONDS) {
    log(
      `cron-obs: window shrunk to ${humanSeconds(windowSeconds)} because pg_net.ttl is shorter than 3h — ` +
        `responses older than the TTL have been PRUNED, so a missing response there is not evidence`,
    );
  } else {
    log(`cron-obs: window = ${humanSeconds(windowSeconds)} (pg_net.ttl ${humanSeconds(effectiveTtl)})`);
  }

  const windowStartMs = nowMs - windowSeconds * 1000;
  const cutoffMs = nowMs - IN_FLIGHT_GRACE_SECONDS * 1000;

  const jobCount = rows.length > 0 && Number.isInteger(rows[0].jobCount) ? rows[0].jobCount : 0;

  if (jobCount === 0) {
    defects.push({
      kind: "cron-no-observation",
      subject: "match_engine_cron",
      detail:
        "match_engine_cron is not scheduled in cron.job at all — there is no hourly job to observe. " +
        "(The cron-drift arm reports the same absence from the other direction.)",
    });
    return defects;
  }

  /** A row is a real run row only when it carries a runid. */
  const runRows = rows.filter((r) => r.runid !== "");
  const eligible = runRows.filter((r) => {
    const t = Date.parse(r.startTime);
    if (Number.isNaN(t)) return false;
    return t > windowStartMs && t <= cutoffMs;
  });

  const pendingCount = runRows.length - eligible.length;
  if (pendingCount > 0) {
    log(
      `cron-obs: ${pendingCount} run(s) excluded — younger than the ${IN_FLIGHT_GRACE_SECONDS}s in-flight grace, ` +
        `or older than the ${humanSeconds(windowSeconds)} window`,
    );
  }

  const distinctRuns = new Set(eligible.map((r) => r.runid));
  if (distinctRuns.size === 0) {
    defects.push({
      kind: "cron-no-observation",
      subject: "match_engine_cron",
      detail:
        `no match_engine_cron run in the last ${humanSeconds(windowSeconds)} that is old enough to judge ` +
        `(${runRows.length} row(s) seen, ${pendingCount} excluded as in-flight or out of window). ` +
        `The job is HOURLY — that many hours with nothing is itself the failure.`,
    });
    return defects;
  }

  // ⛔ ATTRIBUTION FENCE (review WR-01). The join above is TIME-ONLY —
  // `h.created BETWEEN r.start_time AND r.start_time + 90s` — because
  // net._http_response carries no cron jobid. So ANY pg_net response created
  // in that window attaches to this run, including one issued by a different
  // caller. With two rows for one run, a foreign 200 sitting beside our own
  // MISSING response would be judged green and the real failure would never be
  // reported. A verdict must be bounded by what was actually measured, so an
  // ambiguous window is a MEASURE-FAIL, never a pass and never a defect verdict.
  const byRun = new Map();
  for (const r of eligible) {
    if (r.id === "") continue;
    byRun.set(r.runid, (byRun.get(r.runid) || 0) + 1);
  }
  const ambiguous = new Set([...byRun.entries()].filter(([, n]) => n > 1).map(([id]) => id));
  for (const runid of ambiguous) {
    defects.push({
      kind: "measure-fail",
      subject: `runid ${runid}`,
      detail:
        `run ${runid} has ${byRun.get(runid)} net._http_response rows inside its [start, start+90s] ` +
        `window. The join is time-only (net._http_response has no jobid), so this arm CANNOT tell ` +
        `which response is match_engine_cron's. It refuses to issue a verdict rather than pick one — ` +
        `a green row here could be another caller's while our own request went unanswered.`,
    });
  }

  for (const r of eligible) {
    if (ambiguous.has(r.runid)) continue;
    if (r.id === "") {
      defects.push({
        kind: "cron-no-observation",
        subject: `runid ${r.runid}`,
        detail:
          `run ${r.runid} started at ${r.startTime} and has NO net._http_response row in its ` +
          `[start, start+90s] window. cron.job_run_details would read "succeeded" for this run regardless — ` +
          `that column records ENQUEUEING, not an answer.`,
      });
      continue;
    }
    if (r.timedOut || (r.errorMsg && r.errorMsg.length > 0)) {
      defects.push({
        kind: "cron-transport-error",
        subject: `response ${r.id}`,
        detail:
          `run ${r.runid} at ${r.startTime} → response id ${r.id} created ${r.created} reports ` +
          `timed_out=${r.timedOut ? "t" : "f"}${r.errorMsg ? ` error_msg: ${r.errorMsg}` : ""}. ` +
          `The request left the database and the far end did not answer it within the job's own budget.`,
      });
      continue;
    }
    if (!(typeof r.statusCode === "number" && r.statusCode >= 200 && r.statusCode <= 299)) {
      defects.push({
        kind: "cron-non-2xx",
        subject: `response ${r.id}`,
        detail:
          `run ${r.runid} at ${r.startTime} → response id ${r.id} answered ${r.statusCode} at ${r.created}. ` +
          `Body (first 200 chars): ${r.contentHead || "<empty body>"}`,
      });
      continue;
    }
    log(`cron-obs: run ${r.runid} at ${r.startTime} → ${r.statusCode} (id ${r.id})`);
  }

  return defects;
}

// ---------------------------------------------------------------------------
// The arm
// ---------------------------------------------------------------------------

async function run({ seams, log, addDefect }) {
  // (1) The TTL, read and PRINTED every run — it is what the window is clamped by.
  const ttlRes = await seams.sql("cron-obs", TTL_SQL);
  if (ttlRes.measureFail) {
    addDefect(
      "measure-fail",
      "cron-obs",
      "pg_net.ttl",
      `the pg_net.ttl read could not be performed at all: ${ttlRes.measureFail}. Nothing this arm ` +
        `would have reported next is evidence.`,
    );
    return;
  }
  const ttlText = String(ttlRes.stdout || "").trim();
  let ttlSeconds = parseIntervalSeconds(ttlText);
  if (ttlText.length === 0) {
    log(`cron-obs: pg_net.ttl = NULL (unset) — using the documented default ${DEFAULT_TTL_TEXT} (${DEFAULT_TTL_SECONDS} s)`);
    ttlSeconds = DEFAULT_TTL_SECONDS;
  } else if (ttlSeconds === null) {
    log(
      `cron-obs: pg_net.ttl = ${ttlText} (UNPARSABLE as an interval — using the documented default ` +
        `${DEFAULT_TTL_TEXT} (${DEFAULT_TTL_SECONDS} s); the window is therefore NOT clamped by it)`,
    );
    ttlSeconds = DEFAULT_TTL_SECONDS;
  } else {
    log(`cron-obs: pg_net.ttl = ${ttlText} (${ttlSeconds} s)`);
  }

  // (2) The join.
  const res = await seams.sql("cron-obs", CRON_OBS_SQL);
  if (res.measureFail) {
    addDefect(
      "measure-fail",
      "cron-obs",
      "net._http_response",
      `the cron observation query could not be performed at all: ${res.measureFail}. An empty answer from ` +
        `a failed psql is NOT zero problems.`,
    );
    return;
  }

  // (3) Judge in Node, where fixtures can drive it.
  const rows = parseCronObsRows(res.stdout);
  for (const d of judgeCronObs(rows, seams.now(), ttlSeconds, log)) {
    addDefect(d.kind, "cron-obs", d.subject, d.detail, REMEDIES[d.kind]);
  }
}

export const ARM = {
  name: "cron-obs",
  requiredEnv: ["PROBER_POOLER_URL", "SUPABASE_DB_PASSWORD"],
  run,
  REMEDIES,
};
