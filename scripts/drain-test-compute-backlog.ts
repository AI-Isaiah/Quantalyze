/**
 * scripts/drain-test-compute-backlog.ts
 *
 * 158-OPS-04 — guarded, re-runnable TEST-ONLY drain for the `compute_jobs`
 * backlog that accumulates on the shared TEST Supabase project.
 *
 * ============================ WHY THIS EXISTS ============================
 *
 * The TEST project runs the daily pg_cron fan-out (jobid 9) that enqueues one
 * `derive_broker_dailies` row per ELIGIBLE api_key, but TEST runs NO worker.
 * Nothing ever completes or reaps those rows, so they accumulate without bound
 * (measured 2026-08-11: 2320 rows inserted in one 05:30 UTC instant; 2325 rows
 * sitting in `running`, the oldest from 2026-08-03).
 *
 * This is a HYGIENE debt, not a test-color debt. The "exactly-10 deterministic
 * red" that the backlog used to cause was STRUCTURALLY fixed by PR #674
 * (`c726a250`, 2026-08-12) when `_claim_one` gained mandatory `p_kind_include`
 * scoping. Closing this drain on "the reds went away" would be a false claim —
 * it closes on MEASURED before/after row counts.
 *
 * ============================== HARD RULES ==============================
 *
 *   ⛔ TEST ONLY. Five interlocks below, all evaluated BEFORE the supabase-js
 *      module is even imported, let alone before any network call.
 *   ⛔ NEVER a migration. Anything merged under `supabase/migrations/**`
 *      auto-applies to PRODUCTION. This is a script, deliberately.
 *   ⛔ NEVER touch the scheduler. The pg_cron fan-out job is read-only context
 *      for this tool — it is neither unscheduled, altered, nor referenced.
 *      MODE 2 reduces the refill by narrowing the fan-out's own eligibility
 *      predicate (api_keys), never by disabling the schedule.
 *   ⛔ NEVER remove a row. WR-02 doctrine (born on PROD from the worker-04
 *      purge outage) is "terminalize, never destroy". Applying it on TEST costs
 *      nothing and preserves the audit shape, so this tool only ever UPDATEs
 *      stale rows into the terminal `failed_final` state with a provenance note
 *      in `last_error`. There is not a single row-destroying call in this file.
 *
 * ============================== THE MODES ==============================
 *
 * MODE 1 (default) — drain stale `derive_broker_dailies` fan-out artifacts.
 *   Measures counts by (kind, status), then terminalizes every row that is
 *   `kind='derive_broker_dailies'`, `status IN ('pending','running')`, AND
 *   untouched for more than 24 hours (created_at, updated_at and claimed_at
 *   ALL older than the cutoff). The age guard is what keeps a concurrently
 *   running CI job's fresh rows out of the target set.
 *
 * MODE 2 (`--flip-eligibility`) — durable refill reduction.
 *   The fan-out enqueues one row per key matching `is_active AND sync_status
 *   IS DISTINCT FROM 'revoked' AND disconnected_at IS NULL`. This mode sets
 *   `disconnected_at = now()` on accumulated e2e-artifact keys older than 7
 *   days that are NOT on a fixture-derived allowlist, so tomorrow's fan-out
 *   enqueues ~0 rows. Measure-print-confirm: it prints the proposed set and
 *   refuses to mutate unless DRAIN_CONFIRM_ELIGIBILITY=true.
 *
 * ============================== IDEMPOTENCY ==============================
 *
 * Both modes are re-runnable. A row terminalized by MODE 1 no longer matches
 * MODE 1's status filter; a key flipped by MODE 2 no longer matches MODE 2's
 * `disconnected_at IS NULL` filter. An immediate second run therefore reports
 * zero additional rows — that zero-delta IS the idempotency proof.
 *
 * ================================ USAGE ================================
 *
 *   # 1. Measure only — mutates NOTHING.
 *   DRAIN_CONFIRM_TEST=true \
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   npx tsx scripts/drain-test-compute-backlog.ts --dry-run
 *
 *   # 2. Terminalize the stale backlog.
 *   DRAIN_CONFIRM_TEST=true ... npx tsx scripts/drain-test-compute-backlog.ts
 *
 *   # 3. Eligibility measurement (still mutates nothing without the 2nd env).
 *   DRAIN_CONFIRM_TEST=true ... npx tsx scripts/drain-test-compute-backlog.ts --flip-eligibility
 *
 *   # 4. Eligibility flip (mutates api_keys.disconnected_at).
 *   DRAIN_CONFIRM_TEST=true DRAIN_CONFIRM_ELIGIBILITY=true ... --flip-eligibility
 *
 * Env var NAMES are identical to scripts/seed-demo-data.ts so local and CI
 * wiring stay uniform. Never paste a key value into a shell history file; the
 * repo is PUBLIC and `.planning/` is tracked.
 *
 * Exit codes: 0 = success, 3 = refused by an interlock, 1 = runtime failure.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Shared TEST project ref — named verbatim in `.github/workflows/ci.yml`. */
const TEST_PROJECT_REF = "qmnijlgmdhviwzwfyzlc";
/** PRODUCTION project ref — an explicit deny even though (4) already excludes it. */
const PROD_PROJECT_REF = "khslejtfbuezsmvmtsdn";

/** A row is "stale" only if NOTHING has touched it for this long. */
const STALE_JOB_AGE_HOURS = 24;
/** A key is a drainable artifact only if it predates this. */
const STALE_KEY_AGE_DAYS = 7;

const PAGE_SIZE = 1000;
/** Cap so a filter bug can never spin forever against the shared project. */
const MAX_PAGES = 500;

/**
 * The shape `selectAllPages` needs from a PostgREST builder. Declared
 * structurally rather than importing supabase-js's builder generics: a
 * `string`-typed select defeats the select-literal typing and would force an
 * unsound cast on the result (the same reasoning the `ELIGIBLE_SYNC_STATUS_OR`
 * comment below gives for writing its filter out at both call sites).
 */
type RangeQuery<T> = {
  range: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>;
};

/**
 * 158-REVIEW WR-05 — read EVERY row, or refuse.
 *
 * PostgREST applies a server-side max-rows (1000 on Supabase by default) and
 * truncates **silently**: a plain `.select()` over a larger table returns the
 * first page with no error and no indication that anything is missing. MODE 1
 * already paged deliberately at `PAGE_SIZE`; MODE 2's two reads did not, and
 * both of them are load-bearing in the dangerous direction:
 *
 *   - `liveAllowlistIds()` builds the SAFETY allowlist. A truncated allowlist
 *     omits keys that back durable demo strategies, and those keys then become
 *     ELIGIBLE to be flipped `disconnected_at = now()`. A protective guard that
 *     silently fails OPEN is worse than no guard, and the TEST project — the
 *     polluted, high-row-count environment this script exists for — is exactly
 *     where truncation bites.
 *   - `flipEligibility()`'s eligible population feeds both `proposed` and the
 *     BEFORE number in OPS-04's close criterion, so a truncated read makes the
 *     evidence wrong as well as the action.
 *
 * Hitting MAX_PAGES REFUSES rather than returning what it has: acting on a
 * knowingly partial set is the failure this function exists to prevent.
 * `.order()` on a unique column is the caller's responsibility — range paging
 * without a stable sort can repeat or skip rows across pages.
 */
async function selectAllPages<T>(
  label: string,
  build: () => RangeQuery<T>,
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE_SIZE;
    const { data, error } = await build().range(from, from + PAGE_SIZE - 1);
    if (error) die(`${label}: ${error.message}`);
    const rows = data ?? [];
    out.push(...rows);
    // A short page is the only reliable end-of-set signal here.
    if (rows.length < PAGE_SIZE) return out;
  }
  die(
    `${label}: hit MAX_PAGES (${MAX_PAGES}) at ${PAGE_SIZE} rows/page — refusing ` +
      "to act on a truncated set. Investigate the filter before re-running.",
  );
}

const TARGET_KIND = "derive_broker_dailies";
const TARGET_STATUSES = ["pending", "running"] as const;

/**
 * The terminal state. NOT `'failed'` — the `compute_jobs.status` CHECK
 * (migration 20260411144407:113-120) admits only pending / running / done /
 * done_pending_children / failed_retry / failed_final, and `failed_retry` is
 * NOT terminal (the row would be re-claimed). `failed_final` is the state the
 * 90-day retention sweep already purges, so terminalized rows self-clean.
 */
const TERMINAL_STATUS = "failed_final";
/** `error_kind` CHECK admits transient | permanent | unknown. */
const TERMINAL_ERROR_KIND = "permanent";
const DRAIN_NOTE =
  "[158-OPS-04 drain] terminalized as a stale TEST fan-out artifact " +
  "(>24h in pending/running; TEST runs no worker). WR-02 doctrine: " +
  "terminalize, never destroy.";

/** Mirrors the status CHECK, so the measurement table can never miss a bucket. */
const ALL_STATUSES = [
  "pending",
  "running",
  "done",
  "done_pending_children",
  "failed_retry",
  "failed_final",
] as const;

// ---------------------------------------------------------------------------
// Interlock
// ---------------------------------------------------------------------------

function refuse(message: string): never {
  console.error(`[drain] REFUSED: ${message}`);
  process.exit(3);
}

function die(message: string): never {
  console.error(`[drain] FAILED: ${message}`);
  process.exit(1);
}

/**
 * Five independent guards, each with its own message so a refusal names the
 * exact reason. ALL of them run before supabase-js is imported — a misrouted
 * URL cannot reach the network even by accident.
 */
function preflight(): { url: string; serviceKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // (1) Both credentials present.
  if (!url || !serviceKey) {
    refuse(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. " +
        "Source them from your TEST env file; never inline a key value.",
    );
  }

  // (2) Production-flavored URL (same regex as seed-demo-data.ts).
  if (/\b(prod|production)\b/i.test(url)) {
    refuse(`production-flavored target URL: ${url}`);
  }

  // (3) Explicit PROD project-ref deny.
  if (url.includes(PROD_PROJECT_REF)) {
    refuse(
      `target URL carries the PRODUCTION project ref (${PROD_PROJECT_REF}). ` +
        "This tool mutates queue state in bulk and is TEST-only.",
    );
  }

  // (4) Positive allow-list: the URL must BE the TEST project. A deny-list
  //     alone would happily run against some third, unknown project.
  if (!url.includes(TEST_PROJECT_REF)) {
    refuse(
      `target URL is not the shared TEST project (expected ref ${TEST_PROJECT_REF}): ${url}`,
    );
  }

  // (5) Explicit operator opt-in.
  if (process.env.DRAIN_CONFIRM_TEST !== "true") {
    refuse(
      "DRAIN_CONFIRM_TEST=true is required. Set it to confirm you intend to " +
        `mutate queue state on ${TEST_PROJECT_REF}.`,
    );
  }

  return { url, serviceKey };
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

type CountRow = { kind: string; status: string; count: number };

async function listKinds(sb: SupabaseClient): Promise<string[]> {
  const { data, error } = await sb.from("compute_job_kinds").select("name");
  if (error) die(`reading compute_job_kinds: ${error.message}`);
  const kinds = (data ?? []).map((r: { name: string }) => r.name);
  if (kinds.length === 0) die("compute_job_kinds is empty — refusing to measure blind.");
  return kinds.sort();
}

/**
 * Exact counts by (kind, status). PostgREST has no GROUP BY, so this issues one
 * HEAD count per cell — exact, and it never pulls a row body over the wire.
 */
async function measure(sb: SupabaseClient, kinds: string[]): Promise<CountRow[]> {
  const rows: CountRow[] = [];
  for (const kind of kinds) {
    for (const status of ALL_STATUSES) {
      const { count, error } = await sb
        .from("compute_jobs")
        .select("id", { count: "exact", head: true })
        .eq("kind", kind)
        .eq("status", status);
      if (error) die(`counting ${kind}/${status}: ${error.message}`);
      if ((count ?? 0) > 0) rows.push({ kind, status, count: count ?? 0 });
    }
  }
  return rows;
}

function printCounts(label: string, rows: CountRow[]): void {
  console.log(`\n[drain] ===== ${label} — compute_jobs by (kind, status) =====`);
  if (rows.length === 0) {
    console.log("  (no rows)");
    return;
  }
  console.log("  | kind | status | count |");
  console.log("  |------|--------|-------|");
  for (const r of rows) console.log(`  | ${r.kind} | ${r.status} | ${r.count} |`);
  console.log(`  TOTAL: ${rows.reduce((a, r) => a + r.count, 0)}`);
}

// ---------------------------------------------------------------------------
// MODE 1 — terminalize the stale fan-out backlog
// ---------------------------------------------------------------------------

function staleJobCutoff(): string {
  return new Date(Date.now() - STALE_JOB_AGE_HOURS * 3_600_000).toISOString();
}

/**
 * The target set. A row qualifies only when created_at AND updated_at AND
 * claimed_at are all older than the cutoff (claimed_at may be NULL — the
 * permanently-unreapable shape this phase also fixes at its source in
 * `analytics-service/tests/test_compute_jobs_fencing.py`).
 *
 * `updated_at` is trigger-maintained (`compute_jobs_set_updated_at_trigger`,
 * migration 20260411144407:265-269), so it is the honest "last touched" anchor:
 * a row a live CI run is working on cannot satisfy it.
 */
async function countStaleJobs(sb: SupabaseClient, cutoff: string): Promise<number> {
  const { count, error } = await sb
    .from("compute_jobs")
    .select("id", { count: "exact", head: true })
    .eq("kind", TARGET_KIND)
    .in("status", [...TARGET_STATUSES])
    .lt("created_at", cutoff)
    .lt("updated_at", cutoff)
    .or(`claimed_at.is.null,claimed_at.lt.${cutoff}`);
  if (error) die(`counting stale ${TARGET_KIND} rows: ${error.message}`);
  return count ?? 0;
}

async function terminalizeStaleJobs(sb: SupabaseClient, cutoff: string): Promise<number> {
  let terminalized = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await sb
      .from("compute_jobs")
      .select("id")
      .eq("kind", TARGET_KIND)
      .in("status", [...TARGET_STATUSES])
      .lt("created_at", cutoff)
      .lt("updated_at", cutoff)
      .or(`claimed_at.is.null,claimed_at.lt.${cutoff}`)
      .order("id", { ascending: true })
      .limit(PAGE_SIZE);
    if (error) die(`selecting stale rows: ${error.message}`);

    const ids = (data ?? []).map((r: { id: string }) => r.id);
    if (ids.length === 0) return terminalized;

    // UPDATE only. A terminalized row leaves the filter above, which is what
    // makes the next page advance and the whole tool idempotent.
    const { error: upErr } = await sb
      .from("compute_jobs")
      .update({
        status: TERMINAL_STATUS,
        error_kind: TERMINAL_ERROR_KIND,
        last_error: DRAIN_NOTE,
      })
      .in("id", ids);
    if (upErr) die(`terminalizing a page of ${ids.length} rows: ${upErr.message}`);

    terminalized += ids.length;
    console.log(`[drain] terminalized page ${page + 1}: ${ids.length} rows (running total ${terminalized})`);
  }

  die(
    `hit MAX_PAGES (${MAX_PAGES}) without draining the target set — refusing to ` +
      "loop further. Investigate the filter before re-running.",
  );
}

// ---------------------------------------------------------------------------
// MODE 2 — narrow the fan-out's eligibility predicate
// ---------------------------------------------------------------------------

/**
 * The durable demo keys, read out of their OWN fixture rather than copied.
 *
 * `scripts/seed-full-app-demo.ts` seeds two FIXED api_key UUIDs (`API_KEY_IDS`)
 * that outlive any single CI run and back the demo allocator's book. They must
 * never be flipped ineligible. This parses them from the fixture source so the
 * allowlist cannot drift away from the seeder; a parse failure REFUSES rather
 * than silently producing an empty allowlist.
 *
 * The e2e badge/wizard fixtures (`e2e/helpers/seed-test-project.ts`:
 * `seedWizardDraft`, `seedAllocatorBook`, the sfox/mt5 badge seeds) mint a
 * FRESH key per run with a `uniqueSuffix()` label and clean up by prefix, so
 * they are covered by the 7-day age cutoff rather than by an id list — there is
 * no stable identifier for them to enumerate.
 */
function fixtureAllowlistIds(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const fixture = resolve(here, "seed-full-app-demo.ts");

  let source: string;
  try {
    source = readFileSync(fixture, "utf-8");
  } catch (err) {
    refuse(
      `cannot read the demo-seed fixture at ${fixture} (${String(err)}). ` +
        "The MODE 2 allowlist is derived from it; refusing to flip eligibility blind.",
    );
  }

  const block = source.match(/const API_KEY_IDS\s*=\s*\[([\s\S]*?)\]/);
  if (!block || !block[1]) {
    refuse(
      `could not locate the API_KEY_IDS block in ${fixture}. The fixture shape ` +
        "changed — update this parser before flipping eligibility.",
    );
  }

  const ids = block[1].match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? [];
  if (ids.length === 0) {
    refuse(`API_KEY_IDS in ${fixture} yielded no UUIDs — refusing an empty allowlist.`);
  }
  return ids.map((id) => id.toLowerCase());
}

/**
 * Second allowlist arm, derived from LIVE state: any key a durable strategy
 * fixture points at (demo `is_example` rows and anything `published`, i.e.
 * visible on the public browse page) stays eligible.
 */
async function liveAllowlistIds(sb: SupabaseClient): Promise<string[]> {
  const ids = new Set<string>();
  for (const [column, value] of [
    ["is_example", true],
    ["status", "published"],
  ] as const) {
    // WR-05: paged. Truncating THIS read drops keys from the safety allowlist,
    // which makes them eligible to be flipped ineligible — the guard failing
    // open. `.order("id")` gives the range paging a stable sort.
    const rows = await selectAllPages<{ api_key_id: string | null }>(
      `deriving the live allowlist (${column})`,
      () =>
        sb
          .from("strategies")
          .select("api_key_id")
          .eq(column, value)
          .not("api_key_id", "is", null)
          .order("id", { ascending: true }),
    );

    // 158-REVIEW WR-05 (iter 3): the SAME exact-count cross-check `flipEligibility`
    // already applies to its eligible population — and this read needs it MORE.
    //
    // `selectAllPages` terminates on `rows.length < PAGE_SIZE`, and PAGE_SIZE is
    // 1000 — exactly PostgREST's default `max-rows` on Supabase. That makes the
    // end-of-set signal INDISTINGUISHABLE from the truncation cap: if the TEST
    // project's `max-rows` is ever set below 1000, the first `.range(0, 999)`
    // returns a short page, the loop returns happy, and the guard silently fails
    // OPEN again — omitting the `api_key_id`s that back `is_example` / `published`
    // demo strategies, which then become eligible to be flipped
    // `disconnected_at = now()`. This is the SAFETY read: `flipEligibility`'s
    // population being wrong makes the evidence wrong, but this one being wrong
    // destroys durable demo fixtures. Refuse rather than act on a set that may be
    // short.
    const { count, error: countErr } = await sb
      .from("strategies")
      .select("id", { count: "exact", head: true })
      .eq(column, value)
      .not("api_key_id", "is", null);
    if (countErr) die(`counting the live allowlist (${column}): ${countErr.message}`);
    if (count !== null && count !== rows.length) {
      die(
        `live allowlist (${column}): paged read returned ${rows.length} rows but the ` +
          `exact count is ${count}. The safety allowlist may be TRUNCATED, which would ` +
          "make protected demo keys eligible for the flip. Refusing to proceed — " +
          "re-run when the project is quiet, and check PostgREST's max-rows against " +
          `PAGE_SIZE (${PAGE_SIZE}).`,
      );
    }

    for (const row of rows) {
      if (row.api_key_id) ids.add(row.api_key_id.toLowerCase());
    }
  }
  return [...ids];
}

/**
 * The fan-out's own eligibility predicate, mirrored verbatim from
 * `supabase/migrations/20260717233529_allocator_equity_derived_surface.sql:263`:
 * `is_active AND sync_status IS DISTINCT FROM 'revoked' AND disconnected_at IS NULL`.
 *
 * PostgREST spells `IS DISTINCT FROM 'revoked'` as the NULL-inclusive OR below.
 * Written out at both call sites rather than behind a helper: a helper taking a
 * `string` select defeats supabase-js's select-literal typing and forces an
 * unsound cast on the result.
 */
const ELIGIBLE_SYNC_STATUS_OR = "sync_status.is.null,sync_status.neq.revoked";

async function flipEligibility(sb: SupabaseClient, confirmed: boolean): Promise<void> {
  const keyCutoff = new Date(Date.now() - STALE_KEY_AGE_DAYS * 86_400_000).toISOString();

  // WR-05: paged, so `proposed` is computed over the WHOLE eligible population
  // rather than PostgREST's first 1000 rows. `.order("id")` gives the range
  // paging a stable sort.
  const eligible = await selectAllPages<{
    id: string;
    user_id: string;
    created_at: string;
  }>("measuring eligible api_keys", () =>
    sb
      .from("api_keys")
      .select("id,user_id,created_at")
      .eq("is_active", true)
      .is("disconnected_at", null)
      .or(ELIGIBLE_SYNC_STATUS_OR)
      .order("id", { ascending: true }),
  );

  // WR-05: the BEFORE number is an EXACT count taken the same way as the AFTER
  // count below, so the closing line compares like with like. It used to print
  // a (possibly truncated) `eligible.length` against an exact count, which made
  // "eligible BEFORE: 1000 → AFTER: 1400" a printable outcome — and OPS-04's
  // whole close criterion is those before/after numbers.
  const { count: before, error: beforeErr } = await sb
    .from("api_keys")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true)
    .is("disconnected_at", null)
    .or(ELIGIBLE_SYNC_STATUS_OR);
  if (beforeErr) die(`counting eligible api_keys: ${beforeErr.message}`);

  // Fail loud if the paged read and the exact count disagree: that means either
  // paging lost rows or the table changed underneath us, and either way the
  // proposal below was computed against a population that no longer holds.
  if (before !== null && before !== eligible.length) {
    die(
      `eligible api_keys: paged read returned ${eligible.length} rows but the exact ` +
        `count is ${before}. Refusing to propose a flip against an inconsistent ` +
        "population — re-run when the project is quiet.",
    );
  }

  const owners = new Set(eligible.map((k) => k.user_id));
  const timestamps = eligible.map((k) => k.created_at).sort();
  console.log(`\n[drain] ===== MODE 2 — fan-out eligibility population =====`);
  console.log(`  eligible keys              : ${eligible.length}`);
  console.log(`  distinct owners            : ${owners.size}`);
  console.log(`  oldest created_at          : ${timestamps[0] ?? "n/a"}`);
  console.log(`  newest created_at          : ${timestamps[timestamps.length - 1] ?? "n/a"}`);
  console.log(`  (owner ids are aggregated, never printed — the repo is public)`);

  const allowlist = new Set<string>([
    ...fixtureAllowlistIds(),
    ...(await liveAllowlistIds(sb)),
  ]);
  const proposed = eligible.filter(
    (k) => k.created_at < keyCutoff && !allowlist.has(k.id.toLowerCase()),
  );

  console.log(`  allowlisted (fixture+live) : ${allowlist.size}`);
  console.log(`  age cutoff (${STALE_KEY_AGE_DAYS}d)          : ${keyCutoff}`);
  console.log(`  PROPOSED to flip ineligible: ${proposed.length}`);

  if (!confirmed) {
    console.log(
      "\n[drain] MODE 2 measurement only — DRAIN_CONFIRM_ELIGIBILITY=true was not set, " +
        "nothing was mutated.",
    );
    return;
  }

  const now = new Date().toISOString();
  let flipped = 0;
  for (let i = 0; i < proposed.length; i += PAGE_SIZE) {
    const chunk = proposed.slice(i, i + PAGE_SIZE).map((k) => k.id);
    const { error: upErr } = await sb
      .from("api_keys")
      .update({ disconnected_at: now })
      .in("id", chunk);
    if (upErr) die(`flipping a page of ${chunk.length} keys: ${upErr.message}`);
    flipped += chunk.length;
    console.log(`[drain] flipped ${chunk.length} keys ineligible (running total ${flipped})`);
  }

  const { count: after, error: afterErr } = await sb
    .from("api_keys")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true)
    .is("disconnected_at", null)
    .or(ELIGIBLE_SYNC_STATUS_OR);
  if (afterErr) die(`re-measuring eligible api_keys: ${afterErr.message}`);
  // WR-05: both sides are now exact `head: true` counts over the identical
  // filter, so this line is a like-for-like measurement rather than a
  // possibly-truncated array length against an exact count.
  console.log(`  eligible BEFORE: ${before ?? 0} → AFTER: ${after ?? 0} (flipped ${flipped})`);
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const doFlip = args.includes("--flip-eligibility");
  const unknown = args.filter((a) => a !== "--dry-run" && a !== "--flip-eligibility");
  if (unknown.length > 0) {
    refuse(`unrecognized argument(s): ${unknown.join(" ")}. Supported: --dry-run, --flip-eligibility`);
  }

  // ⛔ Interlock FIRST — before the client module is imported, so a misrouted
  // target cannot produce a single packet.
  const { url, serviceKey } = preflight();
  console.log(
    `[drain] target ${TEST_PROJECT_REF} (TEST) — mode: ${dryRun ? "DRY RUN (no mutations)" : "LIVE"}` +
      `${doFlip ? " + eligibility" : ""}`,
  );

  const { createClient } = await import("@supabase/supabase-js");
  const sb: SupabaseClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const kinds = await listKinds(sb);
  const before = await measure(sb, kinds);
  printCounts("BEFORE", before);

  const cutoff = staleJobCutoff();
  const staleCount = await countStaleJobs(sb, cutoff);
  console.log(
    `\n[drain] stale target set: kind=${TARGET_KIND}, status IN (${TARGET_STATUSES.join(", ")}), ` +
      `untouched since ${cutoff} → ${staleCount} rows`,
  );

  if (dryRun) {
    console.log(`[drain] DRY RUN — would terminalize ${staleCount} rows to '${TERMINAL_STATUS}'. Nothing mutated.`);
  } else {
    const terminalized = await terminalizeStaleJobs(sb, cutoff);
    console.log(`[drain] terminalized ${terminalized} rows to '${TERMINAL_STATUS}'.`);
    const after = await measure(sb, kinds);
    printCounts("AFTER", after);
    const residual = await countStaleJobs(sb, cutoff);
    console.log(`[drain] residual stale rows (must be 0): ${residual}`);
  }

  if (doFlip) {
    if (dryRun) {
      console.log("\n[drain] --dry-run suppresses the MODE 2 mutation; measuring only.");
    }
    await flipEligibility(sb, !dryRun && process.env.DRAIN_CONFIRM_ELIGIBILITY === "true");
  }

  console.log("\n[drain] done.");
}

main().catch((err) => {
  console.error("[drain] FAILED:", err);
  process.exit(1);
});
