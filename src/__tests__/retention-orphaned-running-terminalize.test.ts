import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

// JOB-05 / WR-02 / Phase 144 — migration-content gate for the orphaned-`running`
// TERMINALIZER (supabase/migrations/20260817120000_...).
//
// THE HOLE THIS GUARDS. The shipped janitor (20260719120000, window-corrected by
// 20260720120000) REMOVES an orphaned `running` compute_jobs row outright. That
// costs three things: the wizard poller never breaks out (a row that VANISHES is
// the same non-answer as a row stuck at `running` — /api/strategies/[id]/
// sync-progress projects `status` and nothing else); the audit trail that a worker
// was down past its claim window is destroyed by the very mechanism that detected
// it; and Phase 142's reaper stays blocked, because its NOT EXISTS excludes any
// strategy holding a `running` row. 20260817120000 replaces that body with a
// bounded TWO-ARM terminal UPDATE to `failed_final`. This file pins the deployed
// SHAPE of that body in every CI shard, with no database.
//
// This test asserts:
//   1. The migration exists under its exact expected name and sorts strictly after
//      the repo tip it layers on.
//   2. It re-registers cron job `retention_compute_jobs_orphaned_running` at the
//      `50 * * * *` cadence, idempotently (unschedule-then-schedule).
//   3. The $cron$ body can be extracted at all, and the extraction is NOT vacuous
//      (it contains the terminal UPDATE).
//   4. On the BODY ONLY: both arms' table references and status scoping, the
//      terminal SET list, the two DISTINCT per-arm thresholds, and the per-arm
//      bound — every one as an occurrence COUNT recalibrated for a TWO-ARM body.
//   5. On the BODY ONLY: the negative anchors — no removal statement, no
//      IN (SELECT ... LIMIT) shape, no enqueue RPC, no claimed_by write, no
//      claimable failed-retry status, no INSERT.
//   6. The migration fails LOUD when pg_cron is absent and self-verifies the body
//      it actually deployed by reading it back out of cron.job.
//   7. No LATER migration silently re-registers the same cron jobname.
//
// ⚠️ EVERY COUNT BELOW IS CALIBRATED TO A **TWO-ARM** BODY. Phase 143's sibling
// gate (src/__tests__/reconcile-dropped-enqueue-sweep.test.ts) guards a ONE-ARM
// body and its numbers are NOT transferable — copying them here would assert
// exactly the arm-deletion this file exists to catch. Each count below states
// WHICH occurrence is which arm, so a future reader can tell a legitimate change
// from a regression.
//
// ⚠️ THREE SIBLINGS, ONE COMMIT. The same counts are made by the migration's own
// STEP 2 self-verify (against the DEPLOYED body, read back out of cron.job) and by
// supabase/tests/test_retention_orphaned_running.sql Part 1. If a future edit
// legitimately changes how many times the body names a token, ALL THREE move in
// the SAME commit. A one-file scope amendment leaves two gates guarding a
// superseded body while staying green.
//
// ⚠️ BODY-SCOPING IS LOAD-BEARING, NOT TIDINESS. The migration's header
// legitimately DISCUSSES, by name, every token the negatives below forbid — the
// removal keyword, the claimable terminal status, the enqueue RPC, the preserved
// worker-id column — because arguing why each is wrong is the point of the header.
// A whole-file grep would be TRIPPED by correct prose. Prose must neither satisfy
// nor trip a mechanical gate.
//
// ⚠️ AND THE EXTRACTION ITSELF IS A KNOWN HAZARD. Phase 143 Plan 02 hit this live:
// an earlier draft of that migration's header wrote the cron dollar-tag in
// comments, so the non-greedy regex matched the PROSE pair and returned a span of
// comments containing no statement — under which every negative assertion passed
// VACUOUSLY. That is why the anti-vacuity guard in cronBody() exists and why it
// must never be removed as redundant. 20260817120000's header deliberately never
// spells the opening tag out for the same reason.
//
// Pure text-based — no live DB required, so this runs in every vitest shard. The
// BEHAVIOURAL oracle (executing the DEPLOYED body against seeded rows, which is
// the only gate that can falsify the predicate or the bound) is
// supabase/tests/test_retention_orphaned_running.sql.

const REPO_ROOT = join(__dirname, "..", "..");
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");
// ⛔ REPOINTED to 20260826140000 (Phase 162 F-3), which re-registers this same
// cron jobname to classify a reaped orphan as error_kind 'orphaned' rather than
// 'permanent'. Arm 7 below is what forced this edit: a forward-only cron
// re-registration that leaves these constants behind makes every assertion in
// this file guard a body pg_cron NO LONGER RUNS, while staying green.
// 20260817120000 remains the migration that established the two-arm
// terminalizer shape; every count below is unchanged by the re-registration,
// which alters exactly one literal per arm.
const FIX_TS = "20260826140000";
const FIX_FILENAME = `${FIX_TS}_compute_jobs_error_kind_orphaned.sql`;
const FIX_PATH = join(MIGRATIONS_DIR, FIX_FILENAME);

// The repo tip this migration layers on. Invariant #1 of
// .claude/agents/migration-reviewer.md: the 14-digit prefix must be strictly
// greater, or the backdated-migration guard needs an allowlist entry.
const PRIOR_TIP_TS = "20260826130000";

// ORACLE INDEPENDENCE. Every literal below is declared LOCALLY and names its
// production source in a comment. None is imported or derived from the artifact
// under test: a gate that reads its expectation out of the thing it guards cannot
// fail. (Same discipline as 143's gate at :63-65.)

// The jobname is UNCHANGED from 20260720120000:65, on purpose — keeping it keeps
// the deployed jobid on both projects and keeps
// supabase/tests/test_retention_orphaned_running.sql guarding the same job.
// Renaming would strand both: the old job would keep running the REMOVAL body.
const JOB_NAME = "retention_compute_jobs_orphaned_running";

// Minute 50 is deliberate: 5 minutes clear of 142's `*/15` reaper grid, 15 clear
// of 143's `:35` sweep, and 10 clear of `:00` (the busiest slot). See the
// migration header's occupied-slot enumeration.
const SCHEDULE = "50 * * * *";

// The terminal status. `failed_final` is the ONLY terminal-failure value that is
// simultaneously OUTSIDE the claimable set (20260719073701:204 — so the row can
// never be re-claimed, which is what ends the TEST re-pollution that removal was
// ending) and OUTSIDE Phase 142's reaper exclusion set (20260803130000:141 — so
// terminalizing UNBLOCKS the user-facing analytics message).
const TERMINAL_STATUS = "failed_final";

// The audit-reason prefix stamped into last_error. last_error is hard-redacted to
// NULL by get_user_compute_jobs (20260516104201:780) and that redaction is pinned
// by the zod contract (analytics-schemas.ts:195), so this is an OPERATOR channel
// and nothing written here reaches a user.
const AUDIT_REASON = "orphaned_running_reaped";

// The two per-arm thresholds, which are NOT interchangeable:
//   arm A — 4h on claimed_at. The RT-01-corrected window (20260720120000),
//     deliberately UNCHANGED by Phase 144 (SC#2). It clears the 5 x 30 min
//     batch-tail ceiling a HEALTHY worker can legitimately sit at.
//   arm B — 48h on created_at. DERIVED: 24h max enqueue cadence
//     (main_worker.py:1089) + 2.5h max batch wall-clock, rounded up to the next
//     whole cadence multiple. created_at is not a claim time, so 4h does not
//     transfer and is not copied.
const WINDOW_ARM_A = "interval '4 hours'";
const WINDOW_ARM_B = "interval '48 hours'";

// The pre-RT-01 window that 20260720120000 corrected away. Under it a healthy
// batch-tail job — legitimately in flight with a 2.5h-old claim stamp — is
// terminalized while it is still running.
const SUPERSEDED_WINDOW = "interval '2 hours'";

// The per-arm per-tick bound. Sized to STATEMENT COST, not to any observed
// population, and set DELIBERATELY BELOW the measured live TEST population (396
// arm-A rows, census 2026-08-17) so successive real ticks are observably bounded
// AND progressing before merge.
const PER_ARM_LIMIT = 100;

/** Occurrence count of a global regex within `haystack`. */
function count(haystack: string, re: RegExp): number {
  return [...haystack.matchAll(re)].length;
}

/** The text BETWEEN the $cron$ delimiters — exactly what cron.schedule stores and
 *  pg_cron executes. See the body-scoping note in the file header. */
function cronBody(sql: string): string {
  const match = sql.match(/\$cron\$([\s\S]*?)\$cron\$/);
  expect(
    match,
    `${FIX_FILENAME} has no $cron$...$cron$ block. The terminalizer body must be ` +
      `an INLINE dollar-quoted literal passed to cron.schedule — no named ` +
      `function, so no SECURITY DEFINER surface and no caller-suppliable ` +
      `interval (a caller-supplied INTERVAL on a cross-tenant job is the ` +
      `20260516170100 incident class: any caller passes one second and the ` +
      `mechanism fires on every tenant's healthy rows). If the body moved into a ` +
      `function, this gate and the phase's threat model both need revisiting.`,
  ).not.toBeNull();
  const body = match![1];
  // ⭐ ANTI-VACUITY GUARD. If the extraction silently returns the wrong span — the
  // Phase 143 Plan 02 prose-pair incident, where a dollar tag written twice in
  // COMMENTS matched first and the "body" was a span of prose containing no
  // statement — then every negative assertion below passes BY DEFAULT and every
  // count assertion reads 0. This is the assertion that caught it there, and it
  // must never be removed as redundant.
  expect(
    body,
    `the extracted $cron$ body does not contain the terminal ` +
      `UPDATE public.compute_jobs — the extraction is broken (almost certainly a ` +
      `dollar tag written in a COMMENT earlier in the file, which the non-greedy ` +
      `regex matches FIRST), so every assertion scoped to the body proves ` +
      `nothing. Extracted head was: ${JSON.stringify(body.slice(0, 200))}`,
  ).toContain("UPDATE public.compute_jobs");
  return body;
}

describe("JOB-05 orphaned-running terminalizer migration content gate", () => {
  it("the migration file exists under its exact expected name and layers on the repo tip", () => {
    const sql = readFileSync(FIX_PATH, "utf8");
    expect(sql.length).toBeGreaterThan(0);

    // Invariant #1: 14-digit prefix, snake_case name.
    expect(
      FIX_FILENAME,
      `${FIX_FILENAME} is not a 14-digit-prefixed snake_case migration name.`,
    ).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);

    // Invariant #2's backdated-migration guard: strictly greater than the tip this
    // file layers on. A backdated prefix would need an allowlist entry, and on a
    // project where supabase/migrations/** auto-applies to PROD it would also mean
    // the file might never apply at all.
    expect(
      FIX_TS > PRIOR_TIP_TS,
      `the migration prefix ${FIX_TS} is not strictly greater than the repo tip ` +
        `${PRIOR_TIP_TS} it layers on, so the backdated-migration guard would ` +
        `reject it without an allowlist entry.`,
    ).toBe(true);

    // It layers on 20260719120000/20260720120000 rather than editing them: an
    // applied migration is never touched (invariant #11).
    const applied = readdirSync(MIGRATIONS_DIR).filter(
      (f) => f.startsWith("20260719120000") || f.startsWith("20260720120000"),
    );
    expect(
      applied.length,
      "the two shipped orphaned-running janitor migrations are missing from the " +
        "tree — this migration is a NEW file layered on top of them, never a " +
        "replacement for them.",
    ).toBe(2);
  });

  it("re-registers the cron job under the unchanged name and the expected cadence", () => {
    const sql = readFileSync(FIX_PATH, "utf8");

    // ⚠️ The schedule literal is asserted ADJACENT to the cron.schedule call, not
    // counted whole-file: it also appears twice inside STEP 2's self-verify (the
    // string comparison and its failure message), so a whole-file count would be
    // 3 and would move for reasons that have nothing to do with the deployed
    // cadence.
    const registration = new RegExp(
      `cron\\.schedule\\s*\\(\\s*'${JOB_NAME}'\\s*,\\s*'${SCHEDULE.replace(/\*/g, "\\*")}'`,
    );
    expect(
      count(sql, new RegExp(registration.source, "g")),
      `the migration does not call cron.schedule('${JOB_NAME}', '${SCHEDULE}', ...) ` +
        `exactly once. Without the registration nothing runs on a schedule and ` +
        `the REMOVAL body of 20260720120000 stays deployed behind a green apply. ` +
        `Minute 50 is what keeps this janitor off 142's quarter-hour reaper grid, ` +
        `off 143's sweep at :35, and 10 minutes clear of the :00 stack.`,
    ).toBe(1);

    // Idempotent re-apply: cron.schedule upserts by name, but the repo pattern
    // (20260720120000:58-60, 20260802120000:447-450, 20260816140000:603-605)
    // unschedules first and STEP 2 asserts exactly one row survives.
    expect(
      sql,
      `the migration does not unschedule '${JOB_NAME}' before re-registering it.`,
    ).toMatch(new RegExp(`cron\\.unschedule\\s*\\(\\s*'${JOB_NAME}'`));

    // ⭐ THE JOBNAME IS UNCHANGED, ON PURPOSE. Renaming would strand both the
    // deployed jobid and supabase/tests/test_retention_orphaned_running.sql: the
    // OLD job would keep running the removal body under its old name while the
    // gate followed the new one.
    expect(
      sql,
      "the migration no longer names the shipped jobname. Renaming it strands " +
        "the deployed jobid on both projects AND the shipped SQL gate, and " +
        "leaves the REMOVAL body running under the old name.",
    ).toContain(`'${JOB_NAME}'`);
  });

  it("the $cron$ body is extractable and the extraction is not vacuous", () => {
    const body = cronBody(readFileSync(FIX_PATH, "utf8"));
    expect(body.length).toBeGreaterThan(200);
  });

  it("the body carries BOTH arms — table references and status scoping, counted", () => {
    const body = cronBody(readFileSync(FIX_PATH, "utf8"));

    // 4 = arm A batch CTE + arm A UPDATE target + arm B batch CTE + arm B UPDATE
    // target. ⚠️ COUNT, never toContain: a bare presence test CANNOT FAIL here,
    // because any ONE surviving reference satisfies it — deleting an entire arm
    // would pass unnoticed. That defect class was MEASURED twice in Phase 143
    // (the compute_jobs conjunct at :183-192, and a marker literal a Sentry tag
    // satisfied) and once in Phase 144 Plan 01's own SQL gate.
    const jobRefs = count(body, /public\.compute_jobs/gi);
    expect(
      jobRefs,
      `the body names public.compute_jobs ${jobRefs} time(s), expected 4 (arm A ` +
        `batch CTE + arm A UPDATE target + arm B batch CTE + arm B UPDATE ` +
        `target). TWO usually means a WHOLE ARM IS GONE — if it is arm B, ` +
        `NULL-claim running rows become immortal again exactly as they were for ` +
        `14 days on TEST; if it is arm A, no claimed orphan is ever terminalized ` +
        `and the wizard poller spins forever. Zero means the janitor no longer ` +
        `touches the table at all.`,
    ).toBe(4);

    // Schema-qualified everywhere: an unqualified name resolves through the cron
    // session's search_path and could bind to another schema.
    expect(
      count(body, /\bcompute_jobs\b/gi),
      "the body references compute_jobs without the public. schema qualifier " +
        "somewhere. pg_cron runs with its own search_path, so an unqualified " +
        "name is a resolution hazard on a table this janitor WRITES.",
    ).toBe(jobRefs);

    // 4 = two batch predicates + two compare-and-set fences.
    // ⚠️ SINGLE SPACES, deliberately: the shipped SQL gate anchors on this exact
    // spelling and TEST/PROD body md5s already differ today purely because of
    // whitespace drift.
    const runningScopes = count(body, /status = 'running'/g);
    expect(
      runningScopes,
      `the body scopes to status = 'running' ${runningScopes} time(s), expected 4 ` +
        `(one batch predicate and one compare-and-set fence per arm). Losing a ` +
        `PREDICATE widens the janitor to every status — it would terminalize ` +
        `done and pending rows. Losing a FENCE removes the protection against a ` +
        `real writer that terminalizes the row between the batch subselect and ` +
        `the UPDATE, so this janitor would overwrite a genuine outcome with a ` +
        `fabricated one.`,
    ).toBe(4);
  });

  it("the body terminalizes to failed_final and restarts the 90-day retention clock", () => {
    const body = cronBody(readFileSync(FIX_PATH, "utf8"));

    // 2 = one terminal status per arm.
    const terminal = count(body, new RegExp(`'${TERMINAL_STATUS}'`, "g"));
    expect(
      terminal,
      `the body writes '${TERMINAL_STATUS}' ${terminal} time(s), expected 2 (one ` +
        `per arm). It is the ONLY terminal-failure value both outside the ` +
        `claimable set (so the row can never be re-claimed, which is what ends ` +
        `the TEST re-pollution) and outside Phase 142's reaper exclusion set (so ` +
        `terminalizing UNBLOCKS the user-facing analytics message). Any other ` +
        `value moves the row without moving the outcome.`,
    ).toBe(2);

    // ⭐ 2 = B3, one per SET list. THIS is the assertion that keeps the audit
    // trail from being 89 days shorter than the phase promises.
    // retention_compute_jobs_failed (jobid 8) deletes on
    // COALESCE(next_attempt_at, created_at) < now() - interval '90 days'
    // (20260515210200:255-259) and the claim RPC never advances that column, so
    // an orphan's next_attempt_at is frozen near its ENQUEUE time. A status-only
    // flip makes a >90-day-old orphan eligible for removal on the VERY NEXT 03:30
    // tick: terminalized at 04:50, gone by 03:30 the following morning.
    const retentionClock = count(body, /next_attempt_at\s*=\s*now\(\)/gi);
    expect(
      retentionClock,
      `the body sets next_attempt_at = now() ${retentionClock} time(s), expected ` +
        `2 (one per SET list). retention_compute_jobs_failed deletes on ` +
        `COALESCE(next_attempt_at, created_at) past 90 days and the claim RPC ` +
        `never advances that column, so a status-only flip lets an old orphan be ` +
        `collected on the next 03:30 tick — the audit trail this phase exists to ` +
        `preserve would last eleven hours instead of ninety days. Note the ` +
        `asymmetry that makes this easy to miss: retention_compute_jobs_done ` +
        `(jobid 4) DOES key on created_at (20260515113853:195-199).`,
    ).toBe(2);

    // TWO surfaces synthesise user-facing copy from (status, error_kind):
    // get_user_compute_jobs.user_message (20260516104201:784-797) and
    // computation_error_copy (20260826120000), which is what the status bridge
    // writes into strategy_analytics.computation_error. ⚠️ There is NO
    // user_message COLUMN to write — it is a computed member of that RPC's
    // RETURNS TABLE, and a migration written against such a column would fail
    // to apply.
    expect(
      body,
      "the body does not set error_kind, so a terminalized row renders the " +
        "cautious default on both surfaces that read the pair rather than the " +
        "accurate worker-died one.",
    ).toContain("error_kind");

    // ⛔ 'orphaned', NOT 'permanent' (mig 20260826140000, Phase 162 F-3).
    // 'permanent' means "skip retries, go directly to failed_final" — but these
    // jobs are ones whose WORKER DIED holding the claim, so they are retryable
    // by definition, and both copy surfaces told those users that retrying
    // would not help. It does not self-heal: the 20260819130500 readmit sweep
    // is csv-only and is additionally blocked once computation_status reads
    // 'failed', so the user retrying is the only remaining mechanism.
    //
    // A COUNT, not a presence test: a presence test is satisfied by either arm
    // surviving, so a half-converted body (arm A flipped, arm B still
    // 'permanent') would pass unnoticed.
    const orphanKind = count(body, /'orphaned'/g);
    expect(
      orphanKind,
      `the body classifies the failure as 'orphaned' ${orphanKind} time(s), ` +
        `expected 2 (one per arm). Arm A reaps claims past the 4h window, arm ` +
        `B reaps never-claimed running rows past 48h — both are worker deaths ` +
        `and both are retryable.`,
    ).toBe(2);
    expect(
      body,
      "the body still classifies a reaped orphan as 'permanent', which is the " +
        "F-3 defect: a job whose worker died is not a permanent failure, and " +
        "labelling it one makes both user-facing surfaces state something " +
        "false about retryability.",
    ).not.toContain("'permanent'");

    // 2 = one FIXED audit literal per arm. Fixed literals only: no identifier, no
    // row data, no upstream error text, no re-attribution of fault.
    const reasons = count(body, new RegExp(AUDIT_REASON, "g"));
    expect(
      reasons,
      `the body stamps the ${AUDIT_REASON} audit reason ${reasons} time(s), ` +
        `expected 2 (one fixed literal per arm). last_error is the ONLY ` +
        `operator-visible record of WHY a row was terminalized — it is ` +
        `hard-redacted from users at the RPC and zod layers — so without it an ` +
        `operator cannot tell a reaped orphan from a genuine handler failure.`,
    ).toBe(2);
  });

  it("the body carries TWO DISTINCT per-arm thresholds, neither borrowed from the other", () => {
    const body = cronBody(readFileSync(FIX_PATH, "utf8"));

    // 1 = arm A only. SC#2: the RT-01 window is UNCHANGED by this migration.
    const winA = count(body, new RegExp(WINDOW_ARM_A.replace(/'/g, "'"), "g"));
    expect(
      winA,
      `the body carries ${WINDOW_ARM_A} ${winA} time(s), expected exactly 1 (arm ` +
        `A). Zero means the RT-01-corrected threshold is gone: main_worker claims ` +
        `a BATCH of 5 and stamps claimed_at at CLAIM time for the whole batch, ` +
        `dispatch is SEQUENTIAL and the longest per-kind timeout is 30 minutes, ` +
        `so a HEALTHY worker legitimately holds a 2.5h-old claim and a narrower ` +
        `window would terminalize a live in-flight job out from under it. MORE ` +
        `than one means a second arm has imported a threshold derived for a ` +
        `different mechanism.`,
    ).toBe(1);

    // 1 = arm B only, and it must NOT equal arm A's number.
    const winB = count(body, new RegExp(WINDOW_ARM_B.replace(/'/g, "'"), "g"));
    expect(
      winB,
      `the body carries ${WINDOW_ARM_B} ${winB} time(s), expected exactly 1 (arm ` +
        `B). Zero means arm B is gone, or has COPIED arm A's 4h figure — and 4h ` +
        `is a CLAIM-age bound that says nothing about a row that was never ` +
        `claimed. The 48h figure is the 24h enqueue cadence plus the 2.5h max ` +
        `batch wall-clock, rounded up to the next whole cadence multiple.`,
    ).toBe(1);

    // The two arms key on DIFFERENT columns, which is the whole reason they need
    // different thresholds. Arm A's rows have a claim to age; arm B's do not.
    expect(
      body,
      "the body has no claimed_at IS NOT NULL arm-A predicate.",
    ).toContain("claimed_at IS NOT NULL");
    expect(
      body,
      "the body has no claimed_at IS NULL arm. Those rows are invisible to a " +
        "claimed_at threshold in BOTH directions — the shipped body excluded " +
        "them BY NAME (20260720120000:70) and NULL < x is never TRUE anyway — so " +
        "without this arm the running rows that have been stuck longest are " +
        "precisely the ones nothing can ever clear. Six such rows sat up to 14 " +
        "days on TEST, structurally invisible to the janitor built to clear them.",
    ).toContain("claimed_at IS NULL");
    expect(
      body,
      "the body keys arm B on something other than created_at. claimed_at is " +
        "NULL by construction there; updated_at is re-stamped by " +
        "compute_jobs_set_updated_at_trigger on EVERY write (the Phase 106 shape " +
        "reproduced on this very table); next_attempt_at is the column this " +
        "migration REPURPOSES as the retention clock, so keying the detector on " +
        "it would be self-referential.",
    ).toContain("created_at <");

    // RT-01 negative: the superseded window must be nowhere in the BODY.
    expect(
      body,
      `the body carries ${SUPERSEDED_WINDOW}, the OLD window that 20260720120000 ` +
        `corrected away. Under it a healthy batch-tail job — legitimately in ` +
        `flight with a 2.5h-old claim stamp — is terminalized while it is still ` +
        `running, so its side effects land against a row that has left the ` +
        `in-flight set and a duplicate job can be enqueued alongside it.`,
    ).not.toContain(SUPERSEDED_WINDOW);
  });

  it("the body is bounded PER ARM, deterministically ordered, and race-guarded", () => {
    const body = cronBody(readFileSync(FIX_PATH, "utf8"));

    // ⭐⭐ THE BOUND. TWO independent failure modes, and it takes BOTH halves of
    // this assertion to catch them:
    //
    //  (a) WORD-BOUNDING, never `.toContain("LIMIT 100")`. MEASURED in Phase 143
    //      against LIMIT 25 / LIMIT 2500: "LIMIT 2500".includes("LIMIT 25") is
    //      TRUE, so a 100x widening of the per-tick blast radius passed that
    //      gate, the pgTAP gate and the migration's own self-verify
    //      simultaneously. The negative lookahead is what a WIDER limit fails.
    //  (b) THE COUNT. MEASURED in Phase 144 Plan 01's neuter matrix: the
    //      word-bounded PATTERN test alone is satisfied by ONE match, so widening
    //      only ARM B to LIMIT 1000 left the assertion GREEN — arm A's surviving
    //      LIMIT 100 satisfied it all by itself. On a two-arm body the per-arm
    //      cap IS the whole bound, so half a bound is no bound for the arm that
    //      lost it. That is why this asserts the count is exactly 2, one per arm.
    const boundedLimits = count(
      body,
      new RegExp(`LIMIT\\s+${PER_ARM_LIMIT}(?![0-9])`, "g"),
    );
    expect(
      boundedLimits,
      `the body carries ${boundedLimits} word-bounded LIMIT ${PER_ARM_LIMIT} ` +
        `clause(s), expected exactly 2 (one per arm). ONE means a single arm has ` +
        `been widened to LIMIT ${PER_ARM_LIMIT}<digits> or unbounded while the ` +
        `other still satisfies a bare pattern test — the per-arm cap is the whole ` +
        `bound. ZERO means the bound is gone entirely: one tick would terminalize ` +
        `the WHOLE orphan population in a single statement, holding row locks and ` +
        `firing the updated_at trigger across every row at once.`,
    ).toBe(2);

    // ...and no OTHER limit hides in the body. If these two counts ever diverge,
    // some arm carries a LIMIT that is not the audited per-arm bound.
    const allLimits = count(body, /LIMIT\s+\d+/gi);
    expect(
      allLimits,
      `the body carries ${allLimits} numeric LIMIT clause(s) but only ` +
        `${boundedLimits} of them are the audited LIMIT ${PER_ARM_LIMIT}. Every ` +
        `bounded batch in this body must carry the SAME audited cap; a divergent ` +
        `limit is an un-reviewed per-tick blast radius.`,
    ).toBe(boundedLimits);

    // 2 = one deterministic ordering per arm (arm A by claimed_at ASC, arm B by
    // created_at ASC). Without it the LIMIT selects an ARBITRARY subset each
    // tick, so the oldest orphans can be skipped indefinitely while the batch
    // stays full — bounded but never progressing. That is a real defect, not a
    // style change.
    const orderings = count(body, /ORDER BY/gi);
    expect(
      orderings,
      `the body orders its bounded batches ${orderings} time(s), expected 2 (arm ` +
        `A by claimed_at ASC, arm B by created_at ASC). Without a deterministic ` +
        `ordering the LIMIT selects an arbitrary subset each tick, so the oldest ` +
        `orphans can be skipped indefinitely while the batch stays full — ` +
        `bounded but never progressing.`,
    ).toBe(2);

    // ⚠️ SHAPE enforcement, NEVER a bound proof. MEASURED in Phase 143
    // (20260816140000:657-669): removing this keyword from a LOCKING CTE changes
    // neither the plan nor the result, because Postgres does not inline a CTE
    // that locks rows. It is kept because explicit beats implicit and because it
    // survives a future edit that drops FOR UPDATE — at which point the CTE WOULD
    // become inlinable and the LIMIT would be re-applied per outer row. The bound
    // is proven ONLY by executing the deployed body against LIMIT+1 real rows
    // (144-01 offline, 144-03 live). Never read a green here as a bound proof:
    // that is exactly how every gate in phases 142/142.1 passed over a bound that
    // did not exist (D-19).
    const materialized = count(body, /AS\s+MATERIALIZED/gi);
    expect(
      materialized,
      `the body carries ${materialized} MATERIALIZED batch CTE(s), expected ` +
        `exactly 2 (one per arm — this migration has TWO arms, unlike Phase ` +
        `143's one-arm sweep whose sibling gate asserts 1).`,
    ).toBe(2);

    // 2 = one per arm. Both arms must skip rather than block: under the 5s
    // lock_timeout a contended tick that BLOCKS is a FAILED tick.
    const skipLocked = count(body, /FOR UPDATE SKIP LOCKED/gi);
    expect(
      skipLocked,
      `the body carries FOR UPDATE SKIP LOCKED ${skipLocked} time(s), expected 2 ` +
        `(one per arm). An arm that dropped it would BLOCK on any row a live ` +
        `writer holds instead of skipping it and taking it next tick, and under ` +
        `the 5s lock_timeout that turns a contended tick into a failed tick.`,
    ).toBe(2);
  });

  it("the body carries none of the rejected shapes", () => {
    const body = cronBody(readFileSync(FIX_PATH, "utf8"));

    // ⭐ D-01 / WR-02: THE assertion that makes "never remove a row" mechanically
    // checkable. Everything else in this phase is prose and intent; this is the
    // line that fails if the removal body is ever re-deployed under this jobname.
    // ⚠️ BODY-SCOPED on purpose — the header argues about removal at length.
    expect(
      body,
      "the body contains a row-removal statement. This janitor must TERMINALIZE " +
        "and never remove: a removed row gives the wizard poller no outcome to " +
        "break out on, destroys the only audit record that a worker was down " +
        "past its claim window, and on PROD discards a genuine in-flight " +
        "one-shot job that nothing will re-enqueue. That is the SHIPPED " +
        "behaviour this migration exists to replace.",
    ).not.toMatch(/\bDELETE\b/i);

    // D-19: the un-hashable-subplan shape whose LIMIT is re-applied per outer
    // row, so the per-tick bound silently does not exist.
    // ⚠️ The SELECT..LIMIT window is `[^;]*`, NOT `[^)]*`. MEASURED in Phase 143:
    // no realistic predicate can be written without a closing paren before its
    // LIMIT, so the `[^)]*` form matched NOTHING and the assertion could not
    // fail. `[^;]*` still bounds the match to a SINGLE statement, so it cannot
    // smear across the two arms and false-RED. \b keeps "IN" a whole word so it
    // cannot match the tail of an identifier.
    expect(
      body,
      "the body binds a bounded batch through an IN (SELECT ... LIMIT ...) " +
        "subquery — the exact shape whose LIMIT is re-applied per outer row, so " +
        "the per-tick bound silently does not exist. Use the MATERIALIZED batch " +
        "CTE form instead.",
    ).not.toMatch(/\bIN\s*\(\s*SELECT[^;]*LIMIT/i);

    // The wrong terminal: `failed_retry` is CLAIMABLE (20260719073701:204), so
    // the orphan would simply be re-claimed to running on the next worker tick,
    // AND it is INSIDE Phase 142's reaper exclusion set (20260803130000:141), so
    // the user-facing analytics message would stay blocked forever. It is the one
    // terminal-LOOKING value that terminalizes nothing.
    expect(
      body,
      "the body references failed_retry — the one terminal-looking value that " +
        "terminalizes nothing: it is claimable (so the orphan is re-claimed to " +
        "running on the next worker tick) AND inside 142's exclusion set (so the " +
        "user-facing analytics message stays blocked forever).",
    ).not.toContain("failed_retry");

    // No re-enqueue. For cron-fanned kinds the daily fan-out re-enqueues by
    // itself once terminalization frees the in-flight slot, so a janitor INSERT
    // races it and can collide on the in-flight unique index — and a RAISE inside
    // a pg_cron block aborts the WHOLE tick, losing the terminalization too. For
    // one-shot kinds a blind re-enqueue turns a poison job that killed the worker
    // into an infinite loop across restarts.
    expect(
      body,
      "the body calls the enqueue RPC. This janitor must never create work.",
    ).not.toContain("enqueue_compute_job");

    // This janitor only ever UPDATEs. supabase/migrations/** auto-applies to
    // PROD: a janitor that INSERTs can create production work with no human in
    // the loop; one that only updates a status is bounded by construction.
    expect(
      body,
      "the body INSERTs. supabase/migrations/** auto-applies to PROD, so a " +
        "janitor that can create rows creates production work with no human in " +
        "the loop.",
    ).not.toMatch(/INSERT\s+INTO/i);

    // claimed_by is PRESERVED, never written: it records which worker last held
    // the row and is the forensic starting point for any orphan investigation.
    // Audit M-0779 deliberately stopped mark_compute_job_failed from clearing it
    // (20260516104201:917-928); a janitor that clears it re-opens that finding.
    expect(
      body,
      "the body references claimed_by. That column must be PRESERVED, not " +
        "written — audit M-0779 deliberately stopped mark_compute_job_failed " +
        "from clearing it, and a janitor that clears it re-opens that finding.",
    ).not.toContain("claimed_by");

    // No new callable SQL surface: the body is INLINE, so there is no EXECUTE
    // grant to revoke and no caller-suppliable interval. The parameter IS the
    // attack surface (the 20260516170100 incident class).
    expect(body).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i);
    expect(body).not.toMatch(/SECURITY\s+DEFINER/i);
  });

  it("the migration fails loud on absent pg_cron and self-verifies the DEPLOYED body", () => {
    const sql = readFileSync(FIX_PATH, "utf8");

    expect(
      sql,
      "the migration does not check for the pg_cron extension at all",
    ).toContain("pg_extension");
    expect(
      sql,
      "the migration does not RAISE with feature_not_supported when pg_cron is " +
        "absent. The older silent-skip convention (20260717233529:288) would let " +
        "this migration report success while scheduling nothing — leaving the " +
        "REMOVAL body of 20260720120000 deployed behind a green apply. Project " +
        "Rule 12 is fail loud.",
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
        "predicate is wrong — and on this migration the deployed body is the " +
        "ONLY thing pg_cron actually runs.",
    ).toMatch(/FROM\s+cron\.job/i);

    // ⚠️ STRING equality on the schedule, never a ::INT cast on a schedule field.
    // Four of the five fields are '*' under an hourly cadence, and casting one
    // raises 22P02 — an opaque hard error instead of a named assertion. That
    // exact break is why the shipped SQL gate's hour-band check had to be
    // replaced in the same commit as this migration (RESEARCH §8, Break 2).
    expect(
      sql,
      "the migration's self-verify casts a cron schedule field to INT. Under an " +
        "hourly cadence four of the five fields are '*' and '*'::INT raises " +
        "22P02 — an opaque hard failure instead of a named assertion.",
    ).not.toMatch(/split_part\s*\([^)]*schedule[^)]*\)\s*::\s*INT/i);
  });

  it("no LATER migration silently re-registers the same cron jobname", () => {
    // P-7: the gate constants and the migration filename must move together in
    // ONE commit. A forward-only re-registration that leaves this pointer behind
    // makes every assertion above guard a body pg_cron NO LONGER RUNS, while
    // staying green — structurally the same defect D-19 itself fixed one layer
    // down. This jobname has already been re-registered twice (20260719120000 →
    // 20260720120000 → this file), so a third time is not hypothetical.
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
          `FIX_FILENAME constants — and the sibling counts in the migration's ` +
          `own STEP 2 and in supabase/tests/test_retention_orphaned_running.sql ` +
          `— in the SAME commit as the migration. Otherwise all three gates go ` +
          `on guarding a body pg_cron no longer runs, and stay green while ` +
          `doing it.`,
      ).not.toMatch(new RegExp(`cron\\.schedule\\s*\\(\\s*'${JOB_NAME}'`));
    }
  });
});
