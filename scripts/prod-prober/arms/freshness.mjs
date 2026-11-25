/**
 * FRESHNESS arm — "does a daily-derived key's newest stored return day reach
 * the newest day its own inputs say it should?" (phase 233 DERIBITTRUTH,
 * FRESH-02, with FRESH-01's third member).
 *
 * ============================================================================
 * THE RULE (CONTEXT Q3, founder ruling 2026-11-24)
 * ============================================================================
 * SCOPE: every API key with a `derive_broker_dailies` job in the last 3 days,
 * any venue, any job status. A key whose derive keeps failing is still
 * derive-scheduled and must stay in scope.
 *
 * COMPARISON: the key's newest key-mode `csv_daily_returns` day against
 * max(newest flow day, `realized_terminal_day`, `nav_mark.mark_day`) read from
 * the key's newest `key_inputs` row. The gap is whole UTC days.
 *
 * PAGE: `freshness-stale` when the gap exceeds `FRESHNESS_BOUND_DAYS`, UNLESS
 *   (1) every day after the newest return, up to but NOT including the last
 *       `FRESHNESS_BOUND_DAYS` days before the reference day (that tail is the
 *       healthy derive lag, which the bound absorbs and which needs no stated
 *       reason), is one of the derive's own stated left-out days
 *       (`key_inputs.tiny_base_days`), checked DAY BY DAY. A reason that covers
 *       only some of those days does not count (FRESH-01's third member: the
 *       diagnosed account is a 28-day gap, every day stated, and that is a
 *       named reason, not a defect), or
 *   (2) the key carries a non-empty `anchor_null_reason` (the derive said, in
 *       its own words, that it could not anchor the series).
 * No other reason exists. This arm never invents one.
 *
 * A derived key that cannot be judged never reads healthy:
 *   - a key with a `key_inputs` row, no anchor reason and NO stored return day
 *     pages as `freshness-stale` (its gap is the whole series);
 *   - a derived key with NO `key_inputs` row raises a `measure-fail`;
 *   - a run that read rows and judged none of them (judged means fresh, covered
 *     by stated days, or stale) raises a `measure-fail` naming the not-judged
 *     counts.
 *
 * ============================================================================
 * WHY IT LIVES IN THE PROBER AND NOT IN seam S5 (`ops_staleness_check`)
 * ============================================================================
 * CONTEXT Q3 decided it: the check runs outside the derive job, reads PROD
 * read-only through the pooler the other SQL arms already use, pages through
 * the existing incident path and never blocks CI. Nothing in `ci.yml` names it.
 *
 * ============================================================================
 * WHAT IT DOES NOT WATCH, recorded rather than hidden
 * ============================================================================
 *   - A derive that stops ENTIRELY freezes the inputs and the returns
 *     together, so their gap stays small. The job-failure and staleness alerts
 *     own that, not this arm.
 *   - STRATEGY-mode series. Strategy analytics store `tiny_base_days` but no
 *     flow, anchor or terminal day, so there is no comparison side
 *     (orchestrator decision O6: recorded and routed, not built).
 *   - Keys no longer derived. A revoked key with no `derive_broker_dailies`
 *     job in 3 days leaves scope by design.
 *   - The two writes behind the comparison, `key_inputs` and the returns, are
 *     not one transaction. A read between them shows inputs at most one derive
 *     newer than returns, which the bound of 2 absorbs (RESEARCH Pitfall 5).
 *
 * ============================================================================
 * PUBLIC OUTPUT
 * ============================================================================
 * ⛔ The defect table is copied verbatim into a PUBLIC GitHub issue. So this arm
 * NEVER prints a value: subjects are `<venue>#<tag>` where the tag is the first
 * 8 hex characters of an md5 of the key id, and details carry days and counts
 * only. No key id, allocator id or amount is selected by either statement.
 *
 * ⛔ NOTHING IN THIS FILE READS `process`.env — the environment arrives as the
 * injected `env` object, and the arm's two credential names are the ones
 * `cron-obs` and `cron-drift` already use.
 */

/**
 * The most whole UTC days a healthy key's newest return may trail its newest
 * flow, terminal or mark day. The nightly derive marks the previous UTC day, so
 * a healthy key trails by at most 1; 2 leaves one day of slack for the
 * non-atomic write. One line to change.
 */
export const FRESHNESS_BOUND_DAYS = 2;

/**
 * The scope read: ONE row of three integers. `derived` keys have a derive job
 * in the last 3 days; `with_inputs` of them have a `key_inputs` row;
 * `with_terminal` of those carry `realized_terminal_day` as a JSON string (a key
 * that is present with a null value does not count). The third count is what
 * stops a renamed writer field from reading green for every key.
 */
export const FRESHNESS_SCOPE_SQL = `WITH recent AS (
  SELECT DISTINCT j.api_key_id
    FROM public.compute_jobs j
   WHERE j.kind = 'derive_broker_dailies'
     AND j.api_key_id IS NOT NULL
     AND j.created_at > now() - interval '3 days'
)
SELECT (SELECT count(*) FROM recent) AS derived,
       (SELECT count(DISTINCT r.api_key_id) FROM recent r
          JOIN public.allocator_equity_derived d ON d.kind = 'key_inputs:' || r.api_key_id::text) AS with_inputs,
       (SELECT count(DISTINCT r.api_key_id) FROM recent r
          JOIN public.allocator_equity_derived d ON d.kind = 'key_inputs:' || r.api_key_id::text
         WHERE jsonb_typeof(d.payload->'realized_terminal_day') = 'string') AS with_terminal`;

/**
 * The per-key read: one row per derived key, newest `key_inputs` row per kind
 * (a key can sit under more than one allocator), text out and nothing cast to
 * `date` here (an unparsable day is judged in Node, never silently dropped by a
 * cast). No id leaves the database: the tag is the first 8 hex of an md5.
 *
 * Nine columns, in the order `parseFreshnessRows` reads them.
 */
export const FRESHNESS_KEYS_SQL = `WITH recent AS (
  SELECT DISTINCT j.api_key_id
    FROM public.compute_jobs j
   WHERE j.kind = 'derive_broker_dailies'
     AND j.api_key_id IS NOT NULL
     AND j.created_at > now() - interval '3 days'
), ki AS (
  SELECT DISTINCT ON (d.kind) d.kind, d.payload
    FROM public.allocator_equity_derived d
   WHERE d.kind LIKE 'key_inputs:%'
   ORDER BY d.kind, d.computed_at DESC
), nr AS (
  SELECT r.api_key_id, max(r.date) AS newest_return
    FROM public.csv_daily_returns r
   WHERE r.api_key_id IS NOT NULL
   GROUP BY r.api_key_id
)
SELECT coalesce(ki.payload->>'venue', 'unknown') AS venue,
       left(md5(rc.api_key_id::text), 8) AS tag,
       coalesce(to_char(nr.newest_return, 'YYYY-MM-DD'), '') AS newest_return,
       coalesce(ki.payload->>'anchor_null_reason', '') AS anchor_null_reason,
       coalesce((SELECT max(f->>'utc_day_iso')
                   FROM jsonb_array_elements(CASE WHEN jsonb_typeof(ki.payload->'flows') = 'array'
                                                  THEN ki.payload->'flows' ELSE '[]'::jsonb END) f), '') AS newest_flow,
       coalesce(ki.payload->>'realized_terminal_day', '') AS terminal_day,
       coalesce(ki.payload->'nav_mark'->>'mark_day', '') AS mark_day,
       (CASE WHEN jsonb_typeof(ki.payload->'tiny_base_days') = 'array'
             THEN ki.payload->'tiny_base_days' ELSE '[]'::jsonb END)::text AS tiny_days,
       (ki.kind IS NOT NULL) AS has_inputs
  FROM recent rc
  LEFT JOIN ki ON ki.kind = 'key_inputs:' || rc.api_key_id::text
  LEFT JOIN nr ON nr.api_key_id = rc.api_key_id
 ORDER BY 1, 2`;

/**
 * One sentence of OPERATOR REMEDY per defect kind this arm can raise. No id
 * appears here: the subject's tag is the way to find the key.
 */
export const REMEDIES = {
  "freshness-no-scope":
    "The freshness scope read answered zero derived keys: no api key has a derive_broker_dailies job in the last 3 days, so the arm has nothing to judge and an empty answer must never read as healthy. With an admin session through the Supabase MCP read path, run the database marker query first, then read the newest compute_jobs rows of kind derive_broker_dailies over the last 3 days and the status of the nightly derive cron. If the jobs exist and this arm still read zero, the arm's statement or the prober role's access to compute_jobs is the defect; if they do not exist, the nightly derive is not running and that is the page.",
  "freshness-stale":
    "A derived key's newest stored return day trails its newest flow, terminal or NAV-mark day by more than the bound, and no day-by-day stated reason (the derive's tiny_base_days) or anchor_null_reason explains it. With an admin session through the Supabase MCP read path, run the database marker query first, then read that key's newest csv_daily_returns day and its newest key_inputs row (flows, realized_terminal_day, nav_mark, tiny_base_days, anchor_null_reason), matching the key by the tag in the subject (the first 8 hex characters of md5 of its id). Open a debug session to find which day the derive left out and why; never backfill the series by hand.",
};

// ---------------------------------------------------------------------------
// Day arithmetic — integer UTC days, no library
// ---------------------------------------------------------------------------

const MS_PER_DAY = 86_400_000;

/**
 * A strict `YYYY-MM-DD` that round-trips through `Date.UTC` (so `2026-02-30` is
 * rejected, not rolled into March), as an integer day number. `null` otherwise.
 */
function dayNumber(text) {
  if (typeof text !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const y = Number.parseInt(text.slice(0, 4), 10);
  const m = Number.parseInt(text.slice(5, 7), 10);
  const d = Number.parseInt(text.slice(8, 10), 10);
  const ms = Date.UTC(y, m - 1, d);
  if (new Date(ms).toISOString().slice(0, 10) !== text) return null;
  return ms / MS_PER_DAY;
}

/** The inverse of `dayNumber`. */
function dayText(n) {
  return new Date(n * MS_PER_DAY).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse the ONE row `FRESHNESS_SCOPE_SQL` returns. `null` when it is not
 * exactly three non-negative integers — the caller reports that as a
 * measure-fail, never as zero.
 */
export function parseFreshnessScope(stdout) {
  const line = String(stdout || "").split("\n").find((l) => l.length > 0);
  if (line === undefined) return null;
  const f = line.split("\t");
  if (f.length !== 3 || !f.every((x) => /^\d+$/.test(x))) return null;
  const [derived, withInputs, withTerminal] = f.map((x) => Number.parseInt(x, 10));
  return { derived, withInputs, withTerminal };
}

/** The nine columns of `FRESHNESS_KEYS_SQL`, in order. Used for error text only. */
const KEY_COLUMNS = [
  "venue",
  "tag",
  "newest_return",
  "anchor_null_reason",
  "newest_flow",
  "terminal_day",
  "mark_day",
  "tiny_days",
  "has_inputs",
];

/**
 * Parse psql `-At -F <tab>` output of `FRESHNESS_KEYS_SQL`.
 *
 * Returns `{ rows }`, or `{ error }` where `error` is STATIC text naming the
 * record ordinal and the column. It never echoes a value: the text can reach a
 * public issue, and an unparsable value is exactly the one nobody vetted.
 * NULL arrives as the empty string, which for the day columns means "no day".
 */
export function parseFreshnessRows(stdout) {
  const rows = [];
  let ordinal = 0;
  for (const line of String(stdout || "").split("\n")) {
    if (line.length === 0) continue;
    ordinal += 1;
    const f = line.split("\t");
    if (f.length !== KEY_COLUMNS.length) {
      return { error: `record ${ordinal} does not have ${KEY_COLUMNS.length} fields` };
    }
    const [venue, tag, newestReturn, anchorNullReason, newestFlow, terminalDay, markDay, tinyText, hasInputsText] = f;
    if (!/^[a-z0-9_]{1,32}$/.test(venue)) return { error: `record ${ordinal} field venue is not a lower-case token` };
    if (!/^[0-9a-f]{8}$/.test(tag)) return { error: `record ${ordinal} field tag is not 8 lower-case hex characters` };
    const days = { newest_return: newestReturn, newest_flow: newestFlow, terminal_day: terminalDay, mark_day: markDay };
    for (const [name, value] of Object.entries(days)) {
      if (value !== "" && dayNumber(value) === null) {
        return { error: `record ${ordinal} field ${name} is not a strict ISO day` };
      }
    }
    if (anchorNullReason !== "" && !/^[a-z0-9_]{1,64}$/.test(anchorNullReason)) {
      return { error: `record ${ordinal} field anchor_null_reason is not a lower-case token` };
    }
    let tinyDays;
    try {
      tinyDays = JSON.parse(tinyText);
    } catch {
      return { error: `record ${ordinal} field tiny_days is not JSON` };
    }
    if (!Array.isArray(tinyDays) || !tinyDays.every((d) => dayNumber(d) !== null)) {
      return { error: `record ${ordinal} field tiny_days is not an array of strict ISO days` };
    }
    if (hasInputsText !== "t" && hasInputsText !== "f") {
      return { error: `record ${ordinal} field has_inputs is not t or f` };
    }
    rows.push({
      venue,
      tag,
      newestReturn,
      anchorNullReason,
      newestFlow,
      terminalDay,
      markDay,
      tinyDays,
      hasInputs: hasInputsText === "t",
    });
  }
  return { rows };
}

// ---------------------------------------------------------------------------
// Judgement — PURE, so fixtures can drive it end to end
// ---------------------------------------------------------------------------

/**
 * The stored days are compared with each other and the wall clock is never
 * read, so a held-back fixture IS the fake-clock test.
 *
 * @param {Array<object>} rows  from `parseFreshnessRows`
 * @param {(s:string)=>void} [log]
 * @param {object} [tally]      filled with per-state counts when passed
 * @returns {Array<{kind: string, subject: string, detail: string}>}
 */
export function judgeFreshness(rows, log = () => {}, tally = {}) {
  const count = (k) => {
    tally[k] = (tally[k] || 0) + 1;
  };
  const defects = [];
  for (const r of rows) {
    const subject = `${r.venue}#${r.tag}`;
    if (!r.hasInputs) {
      log(`freshness: ${subject} has no key_inputs row (not judged)`);
      count("noInputs");
      defects.push({
        kind: "measure-fail",
        subject,
        detail:
          "a derived key has no key_inputs row, so it cannot be judged and must not read healthy. Read the derive " +
          "job for this key before trusting a green run.",
      });
      continue;
    }
    if (r.anchorNullReason !== "") {
      // Reason (2): the derive said it could not anchor the series.
      count("coveredAnchor");
      continue;
    }
    const newest = dayNumber(r.newestReturn);
    if (newest === null) {
      log(`freshness: ${subject} has no stored return day`);
      count("noReturns");
      count("stale");
      defects.push({
        kind: "freshness-stale",
        subject,
        detail:
          "the key has a key_inputs row, no anchor reason and no stored return day at all: its gap is the whole " +
          "series, and no stated left-out day covers a series that does not exist.",
      });
      continue;
    }
    const candidates = [
      ["newest flow day", dayNumber(r.newestFlow)],
      ["terminal day", dayNumber(r.terminalDay)],
      ["NAV-mark day", dayNumber(r.markDay)],
    ].filter(([, n]) => n !== null);
    if (candidates.length === 0) {
      log(`freshness: ${subject} has no flow, terminal or mark day to compare (not judged)`);
      count("noReference");
      continue;
    }
    const ref = Math.max(...candidates.map(([, n]) => n));
    const setBy = candidates.filter(([, n]) => n === ref).map(([name]) => name).join(" and ");
    const gap = ref - newest;
    if (gap <= FRESHNESS_BOUND_DAYS) {
      count("fresh");
      continue;
    }
    // Reason (1), DAY BY DAY: every day after the newest return must be one the
    // derive stated it left out, EXCEPT the last FRESHNESS_BOUND_DAYS days up to
    // the reference day, which the bound already absorbs as the healthy lag.
    const stated = new Set(r.tinyDays);
    const uncovered = [];
    for (let n = newest + 1; n <= ref - FRESHNESS_BOUND_DAYS; n += 1) {
      if (!stated.has(dayText(n))) uncovered.push(dayText(n));
    }
    if (uncovered.length === 0) {
      count("coveredStated");
      continue;
    }
    count("stale");
    defects.push({
      kind: "freshness-stale",
      subject,
      detail:
        `newest stored return ${r.newestReturn}, reference day ${dayText(ref)} (set by ${setBy}): gap ${gap} day(s), ` +
        `bound ${FRESHNESS_BOUND_DAYS}; ${uncovered.length} of the ${gap - FRESHNESS_BOUND_DAYS} gap day(s) before the last ` +
        `${FRESHNESS_BOUND_DAYS} are not stated left-out days ` +
        `(first ${uncovered[0]}, last ${uncovered[uncovered.length - 1]}) and the key carries no anchor reason.`,
    });
  }
  return defects;
}

// ---------------------------------------------------------------------------
// The arm
// ---------------------------------------------------------------------------

async function run({ seams, log, addDefect }) {
  const scopeRes = await seams.sql("freshness", FRESHNESS_SCOPE_SQL);
  if (scopeRes.measureFail) {
    addDefect(
      "measure-fail",
      "freshness",
      "freshness scope",
      `the freshness scope read could not be performed at all: ${scopeRes.measureFail}. An empty answer from ` +
        `a failed psql is NOT zero derived keys.`,
    );
    return;
  }
  const scope = parseFreshnessScope(scopeRes.stdout);
  if (scope === null) {
    addDefect(
      "measure-fail",
      "freshness",
      "freshness scope",
      "the freshness scope read did not return exactly three integers, so which keys are derived is unknown.",
    );
    return;
  }
  // The line plan 233-06 reads off a prober run as the evidence that the
  // prober's role can read the derived tables. Printed before anything else
  // is checked, so a later failure cannot hide it.
  log(`freshness: scope derived=${scope.derived} with_inputs=${scope.withInputs} with_terminal=${scope.withTerminal}`);

  if (scope.derived === 0) {
    addDefect(
      "freshness-no-scope",
      "freshness",
      "compute_jobs",
      "the scope read found no derive_broker_dailies job in the last 3 days, so no key was judged. An empty " +
        "scope is a defect, never a pass.",
      REMEDIES["freshness-no-scope"],
    );
    return;
  }
  if (scope.withTerminal === 0) {
    addDefect(
      "measure-fail",
      "freshness",
      "key_inputs",
      `${scope.derived} derived key(s) exist but none carries realized_terminal_day, so a renamed or dropped ` +
        "writer field would read every key as not judged. Read the writer before trusting a green run.",
    );
    return;
  }

  const keysRes = await seams.sql("freshness", FRESHNESS_KEYS_SQL);
  if (keysRes.measureFail) {
    addDefect(
      "measure-fail",
      "freshness",
      "freshness keys",
      `the freshness per-key read could not be performed at all: ${keysRes.measureFail}. An empty answer from ` +
        `a failed psql is NOT zero stale keys.`,
    );
    return;
  }
  const parsed = parseFreshnessRows(keysRes.stdout);
  if (parsed.error !== undefined) {
    addDefect(
      "measure-fail",
      "freshness",
      "freshness keys",
      `the freshness per-key read could not be parsed (${parsed.error}), so whether any key is stale is unknown.`,
    );
    return;
  }

  // The database's own count against the rows parsed: a truncated read must
  // not read as fewer keys to worry about. The rows judged are still reported;
  // the ones never seen are the point.
  if (parsed.rows.length !== scope.derived) {
    addDefect(
      "measure-fail",
      "freshness",
      "freshness keys",
      `the scope read counted ${scope.derived} derived key(s) but the per-key read returned ${parsed.rows.length} ` +
        "row(s); the rows returned are judged below, and the keys never seen are the point.",
    );
  }

  const tally = {};
  for (const d of judgeFreshness(parsed.rows, log, tally)) {
    addDefect(d.kind, "freshness", d.subject, d.detail, REMEDIES[d.kind]);
  }
  const t = (k) => tally[k] || 0;
  const venues = new Map();
  for (const r of parsed.rows) venues.set(r.venue, (venues.get(r.venue) || 0) + 1);
  const venueText = [...venues.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([v, n]) => `${v}=${n}`)
    .join(" ");
  log(
    `freshness: judged=${t("fresh") + t("coveredStated") + t("stale")} fresh=${t("fresh")} ` +
      `covered_stated=${t("coveredStated")} covered_anchor=${t("coveredAnchor")} no_inputs=${t("noInputs")} ` +
      `no_returns=${t("noReturns")} no_reference=${t("noReference")} stale=${t("stale")} venues ${venueText}`,
  );
  if (parsed.rows.length > 0 && t("fresh") + t("coveredStated") + t("stale") === 0) {
    addDefect(
      "measure-fail",
      "freshness",
      "freshness keys",
      `${parsed.rows.length} key row(s) were read and none was judged (fresh 0, covered_stated 0, stale 0); ` +
        `not judged: covered_anchor=${t("coveredAnchor")} no_inputs=${t("noInputs")} no_returns=${t("noReturns")} ` +
        `no_reference=${t("noReference")}. A run that judged nothing must not read healthy.`,
    );
  }
}

export const ARM = {
  name: "freshness",
  requiredEnv: ["PROBER_POOLER_URL", "SUPABASE_DB_PASSWORD"],
  run,
  REMEDIES,
};
