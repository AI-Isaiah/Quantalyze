import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

// JOB-04 / Phase 143 — migration-content gate for the dropped-enqueue
// reconciliation sweep (supabase/migrations/20260816140000_...).
//
// THE HOLE THIS GUARDS. POST /api/strategies/csv-finalize runs
// finalize_csv_strategy and persist_csv_daily_returns SYNCHRONOUSLY in the
// request and commits them, then schedules the compute_analytics_from_csv
// enqueue via after() (route.ts:813). If the serverless instance is torn down
// before that callback runs, the enqueue never happens: the strategy is left
// with persisted dailies, ZERO compute_jobs rows and NO strategy_analytics row,
// forever. The route's enqueue-error branch, its catch branch and its
// failed-analytics placeholder ALL live lexically inside the closure that never
// ran, so no in-request guard can observe its own non-execution. The only way to
// see the condition is from outside the request, by absence, on a schedule —
// which is the pg_cron body this file pins.
//
// This test asserts:
//   1. The migration file exists under its exact expected name.
//   2. The migration registers cron job `reconcile_dropped_enqueue_sweep` at the
//      `35 * * * *` cadence (whole-file, on the cron.schedule call).
//   3. The $cron$ body can be extracted at all, and the extraction is NOT
//      vacuous (it contains the INSERT INTO public.compute_jobs).
//   4. On the BODY ONLY: the five predicate conjuncts, the four excluded
//      computation_status values AS A SET, the 1-hour grace literal, the bound
//      (LIMIT 25 / AS MATERIALIZED / FOR UPDATE SKIP LOCKED / ON CONFLICT DO
//      NOTHING) and the cross-language metadata marker.
//   5. On the BODY ONLY: the negative anchors — no IN (SELECT ... LIMIT) shape,
//      neither rejected timestamp anchor column, no call to the enqueue RPC, no
//      CREATE FUNCTION and no SECURITY DEFINER.
//   6. The migration fails LOUD when pg_cron is absent, and carries a
//      self-verifying DO block that RAISEs.
//   7. No LATER migration silently re-registers the same cron jobname.
//
// ⚠️ BODY-SCOPING IS LOAD-BEARING, NOT TIDINESS. The migration's header
// legitimately DISCUSSES `computed_at` and `updated_at` at length — it is the
// Phase-106 argument for why each is the wrong grace anchor — while assertion 5
// forbids them. Those two facts coexist only because every assertion below that
// forbids something is scoped to the extracted body. A whole-file grep would be
// TRIPPED by correct prose. Grep-gate hygiene: prose must neither satisfy nor
// trip the gate.
//
// ⚠️ AND THE EXTRACTION ITSELF IS A KNOWN HAZARD. Phase 143 Plan 02 hit this
// live: an earlier draft of the migration header wrote the cron dollar-tag three
// times in comments, so the non-greedy regex below matched the PROSE pair and
// returned a span of comments containing no INSERT — under which every negative
// assertion here would have passed VACUOUSLY. That is why assertion 3 exists and
// why it must never be removed as redundant.
//
// Pure text-based — no live DB required. The behavioural oracle (executing the
// DEPLOYED body against seeded rows) is
// supabase/tests/test_reconcile_dropped_enqueue_sweep.sql, which is the only
// gate that can falsify the predicate or the bound.

const REPO_ROOT = join(__dirname, "..", "..");
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");
const FIX_TS = "20260816140000";
const FIX_FILENAME = `${FIX_TS}_reconcile_dropped_enqueue_sweep.sql`;
const FIX_PATH = join(MIGRATIONS_DIR, FIX_FILENAME);

// ORACLE INDEPENDENCE. Every literal below is declared LOCALLY and names its
// production source in a comment. None is imported from the code under test: a
// gate that reads its expectation out of the artifact it guards cannot fail.

// The cron slot. Minute 35 is deliberate — it is clear of every registered slot
// in supabase/migrations/** and off the quarter-hour grid 142's reaper occupies.
const JOB_NAME = "reconcile_dropped_enqueue_sweep";
const SCHEDULE = "35 * * * *";

// The four computation_status values the sweep EXCLUDES. Vocabulary is exactly
// five (20260602120000:46); enumerating the excluded four means a future SIXTH
// value defaults to EXCLUDED — the safe direction. A "not pending" formulation
// would default a new status to being re-enqueued.
const EXCLUDED_STATUSES = [
  "computing",
  "complete",
  "complete_with_warnings",
  "failed",
];

// The cross-language metadata marker. analytics-service/main_worker.py reads
// these EXACT literals on claim to fire its Sentry event (Phase 143 Plan 01);
// SQL<->Python equality is pinned separately by
// analytics-service/tests/test_main_worker.py::TestReconcileSweepMarkerContract.
const MARKER_VALUE = "reconcile-sweep";
const MARKER_KEYS = ["source", "detected_at"];

// The two timestamp columns REJECTED as the grace anchor, and why each is wrong:
//   computed_at — the SQL status bridge re-stamps it on every job transition and
//     the Python entry upsert omits it, so it is wrong in BOTH directions. It is
//     the literal column Phase 106's janitor was REVERTED for.
//   updated_at  — both the CSV persist and the broker-dailies derive re-stamp it
//     on every refresh, so a grace window keyed on it would never elapse for an
//     actively-refreshed strategy.
const REJECTED_ANCHOR_COLUMNS = ["computed_at", "updated_at"];

/** The text BETWEEN the $cron$ delimiters — exactly what cron.schedule stores
 *  and pg_cron executes. See the body-scoping note in the file header. */
function cronBody(sql: string): string {
  const match = sql.match(/\$cron\$([\s\S]*?)\$cron\$/);
  expect(
    match,
    `${FIX_FILENAME} has no $cron$...$cron$ block. The sweep body must be an ` +
      `INLINE dollar-quoted literal passed to cron.schedule — no named function, ` +
      `so no SECURITY DEFINER surface and no caller-suppliable grace interval. ` +
      `If the body moved into a function, this gate and the phase's threat model ` +
      `both need revisiting.`,
  ).not.toBeNull();
  const body = match![1];
  // ANTI-VACUITY GUARD. If the extraction silently returns the wrong span (the
  // Plan-02 prose-pair incident), every negative assertion below would pass by
  // default. This is the assertion that caught it.
  expect(
    body,
    `the extracted $cron$ body does not contain the INSERT INTO ` +
      `public.compute_jobs — the extraction is broken, so every assertion ` +
      `scoped to the body proves nothing. Extracted head was: ` +
      `${JSON.stringify(body.slice(0, 200))}`,
  ).toContain("INSERT INTO public.compute_jobs");
  return body;
}

describe("JOB-04 dropped-enqueue reconciliation sweep migration content gate", () => {
  it("the migration file exists under its exact expected name", () => {
    const sql = readFileSync(FIX_PATH, "utf8");
    expect(sql.length).toBeGreaterThan(0);
  });

  it("registers the cron job under the expected name and cadence", () => {
    const sql = readFileSync(FIX_PATH, "utf8");
    expect(
      sql,
      `the migration does not call cron.schedule('${JOB_NAME}', ...). Without ` +
        `the registration nothing runs on a schedule and the JOB-04 hole stays ` +
        `open behind a green apply.`,
    ).toMatch(new RegExp(`cron\\.schedule\\s*\\(\\s*'${JOB_NAME}'`));
    expect(
      sql,
      `the migration does not schedule '${JOB_NAME}' at '${SCHEDULE}'. Minute 35 ` +
        `is what keeps this sweep clear of the 142 reaper's quarter-hour grid and ` +
        `of every other registered pg_cron slot.`,
    ).toContain(`'${SCHEDULE}'`);
    // Idempotent re-apply: cron.schedule upserts by name, but the repo pattern
    // (20260802120000:447-450) unschedules first and the self-verify asserts
    // exactly one row survives.
    expect(sql).toMatch(new RegExp(`cron\\.unschedule\\s*\\(\\s*'${JOB_NAME}'`));
  });

  it("the $cron$ body is extractable and the extraction is not vacuous", () => {
    const body = cronBody(readFileSync(FIX_PATH, "utf8"));
    expect(body.length).toBeGreaterThan(200);
  });

  it("the body carries all five predicate conjuncts, schema-qualified", () => {
    const body = cronBody(readFileSync(FIX_PATH, "utf8"));

    // Schema-qualified everywhere: an unqualified name resolves through the cron
    // session's search_path and could bind to another schema.
    expect(
      body,
      "the body does not drive from a schema-qualified public.strategies",
    ).toContain("public.strategies");
    expect(
      body,
      "the body does not read public.csv_daily_returns, so it has no dailies " +
        "conjunct and would enqueue analytics for strategies with no data",
    ).toContain("public.csv_daily_returns");
    // ⚠️ COUNT, not toContain — mirroring the max(dg.created_at) anchor count
    // below, and for the same reason. public.compute_jobs is named TWICE in the
    // body: once in the zero-jobs NOT EXISTS conjunct and once as the INSERT
    // target. A bare `toContain("public.compute_jobs")` stood here and COULD
    // NOT FAIL — deleting the very conjunct its message named left the INSERT
    // target satisfying it all by itself. MEASURED 2026-08-17: with the
    // conjunct removed from the body this file still reported 11 passed. Same
    // defect class as the marker literal a Sentry tag satisfied (143-03,
    // f62c3866). ⚠️ If a future edit legitimately changes how many times the
    // body names the table, this count and its two SQL siblings (the
    // migration's STEP 2 self-verify and
    // supabase/tests/test_reconcile_dropped_enqueue_sweep.sql Part 1) move in
    // the SAME commit.
    const jobRefs = [...body.matchAll(/public\.compute_jobs/gi)].length;
    expect(
      jobRefs,
      `the body names public.compute_jobs ${jobRefs} time(s), expected 2 (the ` +
        `zero-jobs NOT EXISTS conjunct + the INSERT target). One means the ` +
        `zero-jobs conjunct is GONE and the INSERT target alone is satisfying ` +
        `this gate — the sweep would re-enqueue every strategy holding a ` +
        `healthy in-flight chain, a running derive_broker_dailies mid-chain ` +
        `most of all. Zero means the sweep no longer writes at all.`,
    ).toBe(2);
    expect(
      body,
      "the body does not reference public.strategy_analytics. That conjunct is " +
        "the ONLY protection for healthy retention-aged strategies (done job " +
        "rows are deleted at 30 days), so losing it is a mass re-enqueue of the " +
        "entire historical corpus on the next tick.",
    ).toContain("public.strategy_analytics");
    expect(
      body,
      "the body does not exclude composites via public.strategy_keys. " +
        "Enqueueing compute_analytics_from_csv on a composite overwrites a " +
        "correct headline with the single-key math its own handler abandoned — " +
        "silent corruption of a CORRECT row on a money surface.",
    ).toContain("public.strategy_keys");

    // The status gate: 'archived' out, 'draft' deliberately IN.
    expect(body).toContain("'archived'");
  });

  it("the body excludes EXACTLY the four terminal/racing computation_status values", () => {
    const body = cronBody(readFileSync(FIX_PATH, "utf8"));
    const statusMatch = body.match(/computation_status\s+IN\s*\(([^)]*)\)/i);
    expect(
      statusMatch,
      "the body has no `computation_status IN (...)` exclusion list at all. " +
        "Absent that conjunct the sweep re-enqueues every strategy whose job " +
        "rows aged past the 30-day retention window — the mass-re-enqueue " +
        "incident.",
    ).not.toBeNull();

    const found = [...statusMatch![1].matchAll(/'([^']+)'/g)]
      .map((m) => m[1])
      .sort();
    // AS A SET, not a substring sweep: this catches a REMOVED status (e.g.
    // dropping 'complete' — the mass-re-enqueue tripwire, or dropping
    // 'computing' — which would race 142's reaper on the same row) AND an ADDED
    // one (e.g. adding 'pending', which would excise the largest slice of the
    // population this sweep exists to heal).
    expect(
      found,
      `the terminal-analytics exclusion list is ${JSON.stringify(found)}, ` +
        `expected exactly ${JSON.stringify([...EXCLUDED_STATUSES].sort())}. ` +
        `Removing 'complete' is the mass-re-enqueue incident; removing ` +
        `'computing' races Phase 142's reaper on the same row; ADDING 'pending' ` +
        `excises the dropped-enqueue population itself.`,
    ).toEqual([...EXCLUDED_STATUSES].sort());
  });

  it("the body carries the 1-hour grace window and its deterministic ordering anchor", () => {
    const body = cronBody(readFileSync(FIX_PATH, "utf8"));
    expect(
      body,
      "the body does not carry the 1-hour grace literal. Without a grace window " +
        "the sweep RACES the live after() enqueue it exists to backstop and " +
        "inserts duplicate work on the NORMAL path.",
    ).toContain("interval '1 hour'");

    // The anchor is read TWICE: once in the WHERE conjunct, once in the ORDER BY
    // that makes the bounded batch deterministic (oldest-orphaned first) and
    // therefore forward-progressing across ticks.
    const anchorReads = [...body.matchAll(/max\(dg\.created_at\)/gi)].length;
    expect(
      anchorReads,
      "the body reads the dailies MAX grace anchor " +
        `${anchorReads} time(s), expected 2 (WHERE conjunct + ORDER BY). Zero ` +
        "means the grace window or the anchor is gone; one usually means the " +
        "ORDER BY was dropped, which removes the determinism the bounded batch " +
        "depends on for forward progress.",
    ).toBe(2);
  });

  it("the body is bounded and race-guarded", () => {
    const body = cronBody(readFileSync(FIX_PATH, "utf8"));

    // ⚠️ WORD-BOUNDED regex, never `.toContain("LIMIT 25")`. That substring
    // assertion stood here until 2026-08-17 and MEASURED green against a body
    // carrying `LIMIT 2500`, because "LIMIT 2500".includes("LIMIT 25") is true.
    // A 100x widening of the per-tick blast radius therefore passed this gate,
    // the pgTAP gate and the migration's own self-verify simultaneously. The
    // negative lookahead is the whole point: it is what a WIDER limit fails.
    expect(
      body,
      "the body lost its word-bounded LIMIT 25. Either the bound is gone — a " +
        "single tick could enqueue the whole candidate population at once — or " +
        "it was widened to LIMIT 25<digits>, which multiplies the per-tick " +
        "blast radius while still containing the literal 'LIMIT 25' substring " +
        "the old gate tested for.",
    ).toMatch(/LIMIT\s+25(?![0-9])/);

    // ⚠️ SHAPE enforcement, NOT a bound proof. Phase 143 Plan 02 MEASURED that
    // removing this keyword from THIS body changes neither the EXPLAIN output
    // nor the result, because the CTE carries a locking clause and Postgres does
    // not inline a locking CTE. The keyword is kept because explicit beats
    // implicit and because it survives a future edit that drops FOR UPDATE — at
    // which point the CTE WOULD become inlinable. The bound itself is proven
    // ONLY by executing the deployed body against LIMIT+1 real rows, in
    // supabase/tests/test_reconcile_dropped_enqueue_sweep.sql Part 4. Never let
    // a green here be read as a bound proof: that is exactly how every gate in
    // phases 142/142.1 passed over a bound that did not exist (D-19).
    const materialized = [...body.matchAll(/AS\s+MATERIALIZED/gi)].length;
    expect(
      materialized,
      `the body carries ${materialized} MATERIALIZED batch CTE(s), expected ` +
        `exactly 1 (this migration has ONE arm).`,
    ).toBe(1);

    expect(
      body,
      "the body dropped FOR UPDATE SKIP LOCKED. Measured at READ COMMITTED in " +
        "Plan 02: an INSERT into compute_jobs key-share-locks its parent " +
        "strategies row, so this clause is what makes the sweep SKIP a strategy " +
        "the live enqueue path is mid-insert on. Without it the sweep BLOCKS.",
    ).toContain("FOR UPDATE SKIP LOCKED");

    expect(
      body,
      "the body lost ON CONFLICT DO NOTHING. Measured in Plan 02: with SKIP " +
        "LOCKED removed the sweep blocks on the FK lock, meets the committed row " +
        "on release, and this clause absorbs it; remove BOTH and the tick dies " +
        "on 23505, losing the healed count and skipping the rest of the batch.",
    ).toContain("ON CONFLICT DO NOTHING");
  });

  it("the body stamps the cross-language reconcile-sweep marker", () => {
    const body = cronBody(readFileSync(FIX_PATH, "utf8"));
    expect(
      body,
      "the body does not build its metadata with jsonb_build_object",
    ).toContain("jsonb_build_object");
    for (const key of MARKER_KEYS) {
      expect(
        body,
        `the body does not stamp the '${key}' metadata key. Both keys plus the ` +
          `marker value are a CROSS-LANGUAGE CONTRACT with ` +
          `analytics-service/main_worker.py, which reads them on claim to fire ` +
          `the Sentry alert: drift in either half kills the alert silently while ` +
          `both halves' own tests stay green.`,
      ).toContain(`'${key}'`);
    }
    expect(
      body,
      `the body does not stamp the '${MARKER_VALUE}' marker value, so a dropped ` +
        `enqueue would be healed SILENTLY and SC#1's alert half is false.`,
    ).toContain(`'${MARKER_VALUE}'`);
    expect(
      body,
      "the body does not enqueue the compute_analytics_from_csv kind, so " +
        "nothing it inserts would reach the analytics handler.",
    ).toContain("'compute_analytics_from_csv'");
  });

  it("the body carries none of the rejected shapes", () => {
    const body = cronBody(readFileSync(FIX_PATH, "utf8"));

    // D-19: the un-hashable-subplan shape whose LIMIT is re-applied per outer
    // row, so the per-tick bound silently does not exist.
    // ⚠️ The SELECT..LIMIT window was `[^)]*` until 2026-08-17, which forbids a
    // ')' between them. MEASURED: a realistic rewrite of this predicate cannot
    // avoid an EXISTS (...) before the LIMIT, so the old pattern matched
    // NOTHING and this assertion could not fail. `[^;]*` still bounds the match
    // to one statement — so it cannot smear across the body and false-RED —
    // while allowing the parens a real IN-subquery necessarily contains. \b
    // keeps "IN" a whole word so it cannot match the tail of an identifier.
    expect(
      body,
      "the body binds its bounded batch through an IN (SELECT ... LIMIT ...) " +
        "subquery — the exact shape whose LIMIT is re-applied per outer row.",
    ).not.toMatch(/\bIN\s*\(\s*SELECT[^;]*LIMIT/i);

    for (const col of REJECTED_ANCHOR_COLUMNS) {
      expect(
        body,
        `the body references ${col}, a REJECTED grace anchor (see the ` +
          `migration header for how each is wrong — ${col === "computed_at" ? "this is the literal column Phase 106's janitor was REVERTED for" : "every refresh re-stamps it, so the window would never elapse for the longest-lived strategies"}).`,
      ).not.toContain(col);
    }

    expect(
      body,
      "the body calls the enqueue RPC. Its race-loss arm RAISEs " +
        "serialization_failure, and a RAISE inside a pg_cron body aborts the " +
        "ENTIRE tick — the healed count is lost, the NOTICE never runs, and " +
        "every remaining candidate is skipped.",
    ).not.toContain("enqueue_compute_job");

    // No new callable SQL surface: the sweep is an INLINE body, so there is no
    // EXECUTE grant to revoke and no caller-suppliable grace interval. A
    // caller-supplied INTERVAL on a cross-tenant SECDEF job is the 20260516170100
    // incident class — the parameter IS the attack surface.
    expect(body).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i);
    expect(body).not.toMatch(/SECURITY\s+DEFINER/i);
  });

  it("the migration fails loud on absent pg_cron and self-verifies the deployed body", () => {
    const sql = readFileSync(FIX_PATH, "utf8");
    expect(
      sql,
      "the migration does not check for the pg_cron extension at all",
    ).toContain("pg_extension");
    expect(
      sql,
      "the migration does not RAISE with feature_not_supported when pg_cron is " +
        "absent. The older silent-skip convention (20260717233529:288) would let " +
        "this migration report success while scheduling nothing, leaving the " +
        "hole open behind a green apply. Project Rule 12 is fail loud.",
    ).toContain("feature_not_supported");

    expect(sql).toMatch(/DO\s+\$\$/);
    expect(
      sql,
      "the migration has no self-verifying RAISE EXCEPTION block. STEP 2 must " +
        "read the body back out of cron.job and assert its anchors, so a " +
        "mis-scheduled apply fails loudly instead of reporting success.",
    ).toMatch(/RAISE\s+EXCEPTION/i);
    expect(
      sql,
      "the self-verify does not read the deployed body out of cron.job. A " +
        "self-verify that re-types the predicate passes when the DEPLOYED " +
        "predicate is wrong.",
    ).toMatch(/FROM\s+cron\.job/i);
  });

  it("no LATER migration silently re-registers the same cron jobname", () => {
    // P-7 (RESEARCH): the gate constants and the migration filename must move
    // together in ONE commit. A forward-only re-registration that leaves this
    // pointer behind makes every assertion above guard a body pg_cron no longer
    // runs, while staying green — structurally the same defect D-19 itself
    // fixed one layer down.
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => /^\d{14}_.*\.sql$/.test(f))
      .filter((f) => f.split("_")[0] > FIX_TS)
      .sort();
    for (const f of files) {
      const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
      expect(
        sql,
        `later migration ${f} re-registers cron job '${JOB_NAME}'. Every ` +
          `forward-only cron re-registration MUST move this test's FIX_TS / ` +
          `FIX_FILENAME constants, and analytics-service/tests/test_main_worker.py's ` +
          `_SWEEP_MIGRATION_NAME, in the SAME commit as the migration — ` +
          `otherwise both gates go on guarding a body pg_cron no longer runs ` +
          `and stay green while doing it.`,
      ).not.toMatch(new RegExp(`cron\\.schedule\\s*\\(\\s*'${JOB_NAME}'`));
    }
  });
});
