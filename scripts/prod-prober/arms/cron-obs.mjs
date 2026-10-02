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
 *
 * ============================================================================
 * THE SECOND JOB THIS ARM WATCHES: `ledger_refresh_fanout` (Phase 164.6 fix)
 * ============================================================================
 * The ledger refresh fan-out is a SYNCHRONOUS SQL job — its command is a plain
 * function call, no `net.http_post`. Since the Phase 164.6 round-2 fix a tick
 * with a failed candidate COMMITS: the other candidates stay enqueued and a
 * `public.cron_runs` row (cron_name `ledger_refresh_fanout`, error
 * `candidate_enqueue_failed`) records the failure, which is also what the
 * 20-hour cooldown reads. The function raises on purpose in ONE case only:
 * that row's own write failed on a tick that enqueued nothing.
 *
 * FOUR COUNTS AND ONE CLASSIFICATION, in ONE statement (`LEDGER_FANOUT_SQL`):
 *
 *   runs          runs that STARTED in the last 3 h. Fewer than
 *                 `LEDGER_FANOUT_MIN_RUNS` is `cron-ledger-fanout-absent`: the
 *                 job is hourly, and no run means no refresh AND no failure
 *                 row, so every other count would read 0 for lack of evidence.
 *   errored       runs in the last 3 h that FINISHED (`end_time` set) with a
 *                 message that is not the success form, `1 row` or `SELECT 1`.
 *                 Counted by the SUCCESS SHAPE, never by what an error says, so
 *                 a pg_cron start failure, an error re-raised unchanged, or a
 *                 message with no CONTEXT line all count. →
 *                 `cron-ledger-fanout-failed`.
 *   named         the subset of `errored` whose message names the fan-out's own
 *                 function. A CLASSIFICATION column only: it tells the operator
 *                 whether to start from the function body or from pg_cron, and
 *                 it never decides whether a defect is raised.
 *   stuck         runs with no `end_time` that started more than 30 minutes and
 *                 less than 24 hours ago. A hung run holds the fan-out's
 *                 advisory lock, so every later tick SKIPS and finishes in the
 *                 success form — nothing else here would see it. →
 *                 `cron-ledger-fanout-stuck`.
 *   failure_rows  `candidate_enqueue_failed` rows completed in the last 21 h,
 *                 COUNTED and never read: `metadata` carries strategy ids and
 *                 is never selected. 21 h covers the 20-hour cooldown plus one
 *                 hourly tick, so one failed candidate stays visible for as
 *                 long as it is being skipped. →
 *                 `cron-ledger-fanout-candidate-failed`.
 *
 * ⛔ IT STILL NEVER READS `cron.job_run_details.status`. `return_message` is
 * used only inside `FILTER` predicates; only COUNTS leave the database, because
 * the message can carry a constraint DETAIL.
 *
 * ⚠️ ASSUMPTION THE FIRST PROD RUN MEASURES (review IN-01): that a SUCCEEDED run
 * records `1 row` (connection mode) or `SELECT 1` (background-worker mode).
 * Evidence already in the repo: PROD's succeeded fan-out runs were recorded as
 * `1 row` in the Phase 164.5.1.1 session, and the local lane showed the same
 * form. If PROD records something else, EVERY run reads as errored and this
 * step goes red on its first run — loud, never silent.
 *
 * ⚠️ WHAT IS NOT WATCHED, recorded rather than hidden:
 *   - the COMPOSITE fan-out's own runs. Its failure rows land under the same
 *     cron_name and are counted in `failure_rows`, but its schedule is dormant
 *     and this arm reads only the `ledger_refresh_fanout` job's runs;
 *   - a failed failure-row write on a tick that DID enqueue (two independent
 *     faults): the function warns and returns, the run finishes in the success
 *     form, and no row exists to count (review L1).
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
 * The ledger refresh fan-out's identity. Each constant is BOUND to its source
 * of truth by `src/__tests__/prod-prober-wiring.test.ts`, which fails on drift:
 *   - `LEDGER_FANOUT_JOB` is the `jobname` of an entry in
 *     `scripts/prod-prober/cron-manifest.json`;
 *   - that entry's `command` calls `public.${LEDGER_FANOUT_FUNCTION}()`, and
 *     `supabase/schema/functions/${LEDGER_FANOUT_FUNCTION}.sql` defines it;
 *   - both fan-out snapshots write their failure row under
 *     `LEDGER_FANOUT_FAILURE_CRON_NAME` with `LEDGER_FANOUT_FAILURE_ERROR`.
 * A typo or a renamed function would otherwise make every count read 0 on PROD
 * while the fixture-driven self-test stayed green (review WR-02).
 */
export const LEDGER_FANOUT_JOB = "ledger_refresh_fanout";
export const LEDGER_FANOUT_FUNCTION = "enqueue_ledger_refresh_for_strategies";
export const LEDGER_FANOUT_FAILURE_CRON_NAME = "ledger_refresh_fanout";
export const LEDGER_FANOUT_FAILURE_ERROR = "candidate_enqueue_failed";

/** The job is hourly, so a 3 h window holds 3 runs; fewer than this is a defect. */
export const LEDGER_FANOUT_MIN_RUNS = 2;

/**
 * ONE statement, ONE row, always (aggregates over zero rows still return one).
 * See the header for what each of the five integers means. COUNTS ONLY:
 * `return_message` appears only inside FILTER predicates and `metadata` is
 * never named.
 */
export const LEDGER_FANOUT_SQL = `WITH j AS (
  SELECT jobid FROM cron.job WHERE jobname = '${LEDGER_FANOUT_JOB}'
), recent AS (
  SELECT r.start_time, r.end_time, coalesce(r.return_message, '') AS msg
    FROM cron.job_run_details r
   WHERE r.jobid IN (SELECT jobid FROM j)
     AND r.start_time > now() - interval '24 hours'
), finished AS (
  SELECT msg
    FROM recent
   WHERE start_time > now() - interval '3 hours'
     AND end_time IS NOT NULL
     AND msg NOT IN ('1 row', 'SELECT 1')
)
SELECT (SELECT count(*) FROM recent WHERE start_time > now() - interval '3 hours') AS runs,
       (SELECT count(*) FROM finished) AS errored,
       (SELECT count(*) FROM finished WHERE position('${LEDGER_FANOUT_FUNCTION}' IN msg) > 0) AS named,
       (SELECT count(*) FROM recent
         WHERE end_time IS NULL AND start_time < now() - interval '30 minutes') AS stuck,
       (SELECT count(*) FROM public.cron_runs c
         WHERE c.cron_name = '${LEDGER_FANOUT_FAILURE_CRON_NAME}'
           AND c.error = '${LEDGER_FANOUT_FAILURE_ERROR}'
           AND c.completed_at > now() - interval '21 hours') AS failure_rows`;

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
  "cron-ledger-fanout-failed":
    "At least one ledger_refresh_fanout run in the last 3h finished with a message that is not the success form ('1 row' or 'SELECT 1'), so that tick rolled back whole: nothing it enqueued and no failure row survived. Read the run's return_message in cron.job_run_details with an admin session. If it begins 'enqueue_ledger_refresh_for_strategies: failure instrument write failed', every candidate failed AND public.cron_runs refused the failure row: fix that write first (grants, RLS, a constraint). Any other message is an error the fan-out did not handle, such as a missing relation, a statement or lock timeout, or a pg_cron start failure. When the defect's named count is 0 the message does not name the function, so start from pg_cron and its connection, not from the function body. Follow docs/runbooks/ledger-refresh-go-live.md.",
  "cron-ledger-fanout-stuck":
    "A ledger_refresh_fanout run started more than 30 minutes ago and has not finished. While it runs it holds the fan-out's advisory lock, so every later tick skips and is recorded in the success form. With an admin session find its backend in pg_stat_activity and read what it waits on; a human decides whether to cancel it with pg_cancel_backend, this prober never does. A run that pg_cron abandoned at a server restart also has no end time and reads here until it ages out of the 24h bound. Follow docs/runbooks/ledger-refresh-go-live.md.",
  "cron-ledger-fanout-absent":
    `Fewer than ${LEDGER_FANOUT_MIN_RUNS} ledger_refresh_fanout runs started in the last 3h, for a job the cron manifest declares hourly and active. Check that the job is present and active in cron.job (the cron-drift arm reports a missing or changed job too) and that pg_cron's launcher is alive, since a dead launcher writes no cron.job_run_details rows at all. No run means no refresh and no failure row, so every other ledger fan-out count in this run reads 0 for lack of evidence, not for health.`,
  "cron-ledger-fanout-candidate-failed":
    "At least one fan-out tick in the last 21h recorded a candidate that failed to enqueue (public.cron_runs, cron_name ledger_refresh_fanout, error candidate_enqueue_failed). Those ticks committed: the other candidates were enqueued, and each failed strategy is skipped for 20 hours by the cooldown. This prober only counts the rows. With an admin session read the newest rows' metadata for the function, the failed strategy ids and their SQLSTATEs, and fix the enqueue fault for those strategies. The count clears by itself 21h after the last failure. Follow docs/runbooks/ledger-refresh-go-live.md.",
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

/**
 * Parse the ONE row `LEDGER_FANOUT_SQL` returns. `null` when it is not exactly
 * five non-negative integers — the caller reports that as a measure-fail, never
 * as zero.
 */
export function parseLedgerFanoutRow(stdout) {
  const line = String(stdout || "").split("\n").find((l) => l.length > 0);
  if (line === undefined) return null;
  const f = line.split("\t");
  if (f.length !== 5 || !f.every((x) => /^\d+$/.test(x))) return null;
  const [runs, errored, named, stuck, failureRows] = f.map((x) => Number.parseInt(x, 10));
  return { runs, errored, named, stuck, failureRows };
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

/**
 * Step (4): the ledger refresh fan-out. It has no pg_net dependency, so it runs
 * whether or not steps (1)-(3) could measure (review IN-02 / N4): a pg_net read
 * that broke must not hide a fan-out that is failing.
 */
async function judgeLedgerFanout({ seams, log, addDefect }) {
  const lf = await seams.sql("cron-obs", LEDGER_FANOUT_SQL);
  if (lf.measureFail) {
    addDefect(
      "measure-fail",
      "cron-obs",
      LEDGER_FANOUT_JOB,
      `the ledger fan-out read could not be performed at all: ${lf.measureFail}. An empty answer from ` +
        `a failed psql is NOT zero failed runs.`,
    );
    return;
  }
  const c = parseLedgerFanoutRow(lf.stdout);
  if (c === null) {
    addDefect(
      "measure-fail",
      "cron-obs",
      LEDGER_FANOUT_JOB,
      "the ledger fan-out read did not return exactly five integers, so how its runs and candidates fared is unknown.",
    );
    return;
  }
  log(
    `cron-obs: ${LEDGER_FANOUT_JOB}: ${c.runs} run(s) in the last 3h, ${c.errored} finished outside the success form ` +
      `(${c.named} naming ${LEDGER_FANOUT_FUNCTION}), ${c.stuck} stuck over 30m, ` +
      `${c.failureRows} ${LEDGER_FANOUT_FAILURE_ERROR} row(s) in the last 21h`,
  );
  if (c.runs < LEDGER_FANOUT_MIN_RUNS) {
    addDefect(
      "cron-ledger-fanout-absent",
      "cron-obs",
      LEDGER_FANOUT_JOB,
      `${c.runs} ${LEDGER_FANOUT_JOB} run(s) started in the last 3h; an hourly job must show at least ` +
        `${LEDGER_FANOUT_MIN_RUNS}. The other counts on this line read 0 for lack of runs, not for health.`,
      REMEDIES["cron-ledger-fanout-absent"],
    );
  }
  if (c.errored > 0) {
    addDefect(
      "cron-ledger-fanout-failed",
      "cron-obs",
      LEDGER_FANOUT_JOB,
      `${c.errored} of ${c.runs} ${LEDGER_FANOUT_JOB} run(s) in the last 3h finished with a message that is not ` +
        `'1 row' or 'SELECT 1'; ${c.named} of them name ${LEDGER_FANOUT_FUNCTION} ` +
        `(${c.named === 0 ? "start from pg_cron, not the function body" : "start from the function"}).`,
      REMEDIES["cron-ledger-fanout-failed"],
    );
  }
  if (c.stuck > 0) {
    addDefect(
      "cron-ledger-fanout-stuck",
      "cron-obs",
      LEDGER_FANOUT_JOB,
      `${c.stuck} ${LEDGER_FANOUT_JOB} run(s) started 30m to 24h ago and have no end time; while one runs, every ` +
        `later tick skips on the advisory lock and still reads as a success.`,
      REMEDIES["cron-ledger-fanout-stuck"],
    );
  }
  if (c.failureRows > 0) {
    addDefect(
      "cron-ledger-fanout-candidate-failed",
      "cron-obs",
      LEDGER_FANOUT_FAILURE_ERROR,
      `${c.failureRows} ${LEDGER_FANOUT_FAILURE_ERROR} row(s) in public.cron_runs completed in the last 21h ` +
        `(counted, never read). Those ticks committed; the failed candidates sit out the 20-hour cooldown.`,
      REMEDIES["cron-ledger-fanout-candidate-failed"],
    );
  }
}

/**
 * Steps (1)-(3) judge match_engine_cron through pg_net and share one early
 * exit; step (4) is called afterwards UNCONDITIONALLY, so every step's defects
 * are collected.
 */
async function judgeMatchEngine({ seams, log, addDefect }) {
  // (1) The TTL, read and PRINTED every run — it is what the window is clamped by.
  const ttlRes = await seams.sql("cron-obs", TTL_SQL);
  if (ttlRes.measureFail) {
    addDefect(
      "measure-fail",
      "cron-obs",
      "pg_net.ttl",
      `the pg_net.ttl read could not be performed at all: ${ttlRes.measureFail}. Nothing the match_engine_cron ` +
        `steps would have reported next is evidence.`,
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

async function run(ctx) {
  await judgeMatchEngine(ctx);
  // (4) ALWAYS — see judgeLedgerFanout.
  await judgeLedgerFanout(ctx);
}

export const ARM = {
  name: "cron-obs",
  requiredEnv: ["PROBER_POOLER_URL", "SUPABASE_DB_PASSWORD"],
  run,
  REMEDIES,
};
