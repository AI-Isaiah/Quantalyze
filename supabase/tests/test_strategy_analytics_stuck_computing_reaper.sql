-- Test: strategy_analytics stuck-'computing' reaper + the bridge's stamp
-- semantics (JOB-01 / JOB-02 / JOB-03, Phase 142).
--
-- Guards migration
-- 20260802120000_strategy_analytics_stuck_computing_reaper.sql: the
-- computing_started_at DDL, the transition-CONDITIONAL stamp in
-- sync_strategy_analytics_status branch (a), the branch (b)/(c) exit clears, and
-- the recurring pg_cron job reap_strategy_analytics_stuck_computing.
--
-- Part 2 arm D and the trigger-sentinel part at the END of this file
-- additionally guard the Phase 142.1 delta migration
-- 20260803120000_strategy_analytics_stamp_trigger_null_stamp_clock_start.sql:
-- the table-level stamp trigger (D-17/D-01) and the non-destructive clock-start
-- companion cron arm (D-11). BOTH migrations must be applied before this file is
-- run, or those parts redden -- deliberately, per the ANTI-GREEN-SKIP CONTRACT
-- below. That part is named descriptively here rather than by its number,
-- because its acceptance gate is an `awk` range anchored on that number and a
-- header mention would silently widen the range over the whole file.
--
-- Why the reaper exists (Rule 9 -- the WHY, not just the WHAT)
-- -----------------------------------------------------------
-- A strategy_analytics row can be stranded at computation_status='computing'
-- forever: the compute_jobs watchdog resets stalled JOBS and the daily
-- orphaned-running purge (20260720120000) DELETEs orphaned job rows, but
-- neither writes strategy_analytics, and the status bridge's branch (d) returns
-- early when the strategy has no compute_jobs rows at all. After that purge the
-- strategy holds 'computing' with ZERO compute_jobs rows -- exactly the stranded
-- condition, and today a permanent one. The value lands on the PAGE-REFRESH /
-- RETURN-LATER path and the factsheet surface; it is NOT a live-wizard rescue
-- (SyncPreviewStep already self-escalates at 15 minutes). The '*/15 * * * *'
-- cadence is POST-THRESHOLD DETECTION LATENCY, not a bound on spinner time.
--
-- ORACLE DISCIPLINE (the load-bearing property of this file)
-- ---------------------------------------------------------
-- The behavioral parts read the REAL deployed body out of cron.job.command and
-- `EXECUTE v_command` it. They NEVER re-type the predicate. A gate that
-- re-implements the predicate passes when the DEPLOYED predicate is wrong.
-- Likewise the stamp parts drive the REAL worker RPCs mark_compute_job_done /
-- mark_compute_job_failed, never sync_strategy_analytics_status directly: an
-- earlier convention seeded jobs already-'done' and called the bridge directly,
-- which is a vacuum -- it never reproduces the worker running->done flip plus the
-- in-RPC bridge call, and stays green while production launders. The only place
-- the function body is named directly is pg_get_functiondef, a text read.
--
-- ANTI-GREEN-SKIP CONTRACT (read this before adding any presence gate)
-- -------------------------------------------------------------------
-- Part 1 is DELIBERATELY UNGATED and MUST FAIL when migration 20260802120000 is
-- unapplied -- that is this file's TDD RED proof. It follows
-- test_sync_status_supersede_failed_per_kind.sql, whose Part 1 reddens against
-- the pre-migration body. It deliberately does NOT follow
-- test_retention_orphaned_running.sql lines 71-83, whose two presence gates
-- `RAISE NOTICE ... RETURN` and thereby no-op the ENTIRE file when the migration
-- has not reached this project. A gate that green-skips when the object under
-- test is absent is not evidence.
--
-- The ONLY permitted skip anywhere in this file is a genuinely absent pg_cron
-- extension (local dev), and even then Part 1's column-shape and functiondef
-- assertions STILL RUN -- only the cron-registration and cron-body assertions
-- are skipped. A cron job that is MISSING while pg_cron is PRESENT is an
-- EXCEPTION, never a skip.
--
-- TRANSACTION FRAMING (per-part only -- do not "simplify" this)
-- ------------------------------------------------------------
-- Every part that writes opens its OWN `BEGIN;`, immediately sets
-- `SET LOCAL lock_timeout = '5s'`, and closes with `ROLLBACK;`. There is NO
-- outer whole-file transaction, and adding one would be a silent data hazard:
-- psql's nested BEGIN emits `WARNING: there is already a transaction in
-- progress` and creates NO savepoint, so the FIRST inner rollback would end the
-- outer transaction and every later part would AUTOCOMMIT its seeds onto the
-- SHARED test project. Both analogs are per-part only
-- (test_retention_orphaned_running.sql:54/191;
-- test_sync_status_supersede_failed_per_kind.sql:98/149, 162/203, 214/268).
-- The `SET LOCAL lock_timeout` bounds the row locks the EXECUTEd DEPLOYED BODY
-- itself takes: its reap statement is FOR UPDATE SKIP LOCKED and can briefly
-- hold locks on up to 25 foreign candidate rows inside the part's transaction,
-- until the ROLLBACK. SKIP LOCKED means this gate never BLOCKS on another
-- tenant's row locks, and the `sql-tests` CI job now carries the repo-wide
-- `shared-test-db` concurrency group (ci.yml), so two gate runs cannot overlap
-- at all. The 5 s bound stays as the fail-loud backstop for anything else that
-- contends.
--
-- SHARED-TEST-DB ISOLATION (isolation by construction)
-- ---------------------------------------------------
-- The deployed command is a GLOBAL `ORDER BY computing_started_at ASC LIMIT 25`
-- over the whole table, and the migration's one-shot backfill stamps every
-- pre-existing 'computing' row from computed_at. Those FOREIGN rows compete with
-- these seeds for the 25-row budget.
--
-- This file does NOT neutralize them. It used to: three
-- `UPDATE public.strategy_analytics SET computing_started_at = NULL
--  WHERE computation_status = 'computing' AND strategy_id <> ALL (v_seeded)`
-- statements wrote across every OTHER tenant's rows on the shared project.
-- Those three statements are DELETED (Phase 142.1, D-05 / D-18) -- not narrowed,
-- not re-targeted. Isolation is now BY CONSTRUCTION: every row this file needs
-- the reaper to reap is seeded at `now() - interval '100 years'`, which sorts
-- ahead of any plausible foreign row under the deployed ORDER BY, so the seeds
-- win the budget without touching a single row they do not own. Every count and
-- every status read below is SCOPED to this block's own seeded strategy_id set
-- (`= ANY (v_seeded)`, or an identity comparison against one seeded id) -- never
-- a global count and never a global empty state. That is this project's own
-- recorded lesson from the e2e-seeded shared-DB pollution fix: assert your OWN
-- seed invariant.
--
-- RESIDUAL ASSUMPTION, stated honestly (D-18): correctness of the reap-arm
-- assertions now rests on no foreign row on the shared TEST project carrying a
-- computing_started_at older than the seed epoch (a century back). If enough
-- such rows ever existed to consume the 25-row budget, the arm-A and LIMIT
-- assertions would redden for a reason unrelated to the reaper. That is a loud,
-- diagnosable failure -- unlike the cross-tenant writes it replaces, whose cost
-- (mutating other PRs' rows mid-run) was silent by design.
--
-- FROZEN-CLOCK TRAP (why the SC-2b arm uses a sentinel)
-- ----------------------------------------------------
-- Each part runs inside a single transaction, so `now()` is CONSTANT for the
-- whole part. The naive SC-2b design -- "call the bridge twice and compare the
-- two stamps" -- therefore CANNOT FAIL: under an unconditional stamp both calls
-- write the same frozen now() and the stamps compare equal. Part 4 instead
-- pre-sets a SENTINEL stamp (now() - interval '3 hours') BETWEEN the two real
-- RPC calls and asserts the stamp still equals that sentinel afterwards. The
-- conditional form KEEPS it; the unconditional form overwrites it with the
-- frozen now(), which differs from the sentinel by three hours -> RED. All ages
-- are clock-offset arithmetic; there are no sleeps anywhere in this file.
--
-- DO NOT add this cron to supabase/tests/test_retention_crons_safe.sql. That
-- file's loop asserts every listed body matches `%where%created_at%`, which is
-- the exact OPPOSITE of this reaper's design -- it deliberately never references
-- created_at or computed_at.
--
-- pgTAP is NOT installed in this project (CLAUDE.md), so assertions
-- RAISE EXCEPTION on failure and a clean run prints NOTICEs only. Every RAISE
-- format string is a single literal with % placeholders (no concatenation). No
-- psql meta-commands. No fixed UUID literals -- every id is gen_random_uuid(),
-- because this file runs against the SHARED test project concurrently with
-- other PRs.
--
-- Usage:
--   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql
--
-- Run order: AFTER migrations 20260802120000 AND 20260803120000 are applied to
-- the project.
--
-- ⭐ MACHINE-EXECUTABLE TWINS (phase 164.4.1, PGCRON-LANE). Each prose
-- RED-UNDER below carries an adjacent `RED-UNDER-M` object that
-- scripts/mutation-runner executes on every push: it mutates COPIES on a
-- throwaway pg-lane cluster, requires the FIRST `TEST FAILED (…)` to name that
-- arm, and restores GREEN. Schema: scripts/mutation-runner/GRAMMAR.md.
--
-- ⚠️ THE APPLY LIST BELOW IS SIZED BY THE THREE `SKIP` NOTICES, NOT BY THE
-- HEADER. This file baselines GREEN with or without pg_cron -- lines 282, 326
-- and 483 withhold Part 1b and the whole of Parts 2 and 3 behind
-- `RAISE NOTICE 'SKIP …'` rather than an exception (the older of the two
-- spellings this corpus carries; converting it would be a behaviour change to a
-- gate and is out of this phase's scope). A section behind a still-firing SKIP
-- is UN-FALSIFIABLE: its twin comes back `no-red` naming no cause, and a
-- silently-ineffective pg_cron preload would be invisible. So the list must
-- carry 20260513094906 (the CREATE EXTENSION the three skips key on) before the
-- first cron-touching migration. MEASURED 2026-09-05 on the lane: with this
-- list the baseline exits 0 in 1 s and prints ZERO gate-owned SKIP lines --
-- `grep -a -c -iE '^psql:[^ ]*test_strategy_analytics_stuck_computing_reaper\.sql:[0-9]+: NOTICE:.*SKIP'`
-- -> 0 -- and all SEVEN `Part … OK` notices (1a, 1b, 2, 3, 4, 5, 6) print.
-- ⛔ Do NOT read that zero off an unscoped `grep -i SKIP`: Postgres itself emits
-- `… does not exist, skipping` NOTICEs from the `DROP … IF EXISTS` statements in
-- five of the applied migrations (12 such lines on this list, MEASURED), and
-- none of them is this file's.
--
-- ⚠️ ORACLE SCOPE, stated honestly. The lane's `cron.job.command` oracle is the
-- body of the LAST writer in the list, 20260803130000 (the MATERIALIZED-CTE
-- delta) -- 20260802120000 registers the job and 20260803120000 re-registers it
-- with the clock-start arm, and `cron.schedule` upserts by NAME, so only the
-- last one's bytes survive. That is the same body TEST holds, and it is why
-- every Parts 2/3 twin below targets 20260803130000: an edit to either earlier
-- migration's cron body is overwritten and comes back `no-red`.
--
-- ⚠️ WHAT THE LANE CANNOT FALSIFY HERE, MEASURED rather than assumed. The lane's
-- `strategy_analytics` is the stand-in built by
-- scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql:42-47, and that fixture
-- already declares `computing_started_at TIMESTAMPTZ`. So STEP 1 of
-- 20260802120000 applies as a no-op -- the lane prints
-- `column "computing_started_at" of relation "strategy_analytics" already
-- exists, skipping` -- and the FOUR column-shape raises at the head of Part 1a
-- cannot be reddened by mutating that migration. The fixture is NOT edited to
-- fix this (GRAMMAR rule 4 refuses twins on stand-ins, and
-- test_sync_status_marked_refresh_protected.sql reads the same column off the
-- same fixture without applying 20260802120000). `1/JOB-01` is instead twinned
-- through its BRIDGE-BODY half, which reads the real deployed function; the
-- section is proven, the DDL half is not, and this note is the record of which.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/27-fixture-strategy-analytics-computation-error.sql","supabase/migrations/20260513094906_enable_pg_cron.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","scripts/pg-lane/fixtures/29-fixture-compute-jobs-priority.sql","supabase/migrations/20260412094454_sync_strategy_analytics_status.sql","supabase/migrations/20260505115047_mark_compute_job_atomic_status_bridge.sql","supabase/migrations/20260510175507_process_key_long_compute_job_kinds_repair.sql","supabase/migrations/20260515114555_compute_jobs_claim_token_fencing.sql","supabase/migrations/20260516104201_compute_jobs_audit_2026_05_07_residual.sql","supabase/migrations/20260522111858_compute_analytics_from_csv_kind.sql","supabase/migrations/20260528183100_mark_compute_job_strict_claim_token.sql","supabase/migrations/20260529180000_fix_mark_compute_job_failed_error_kind_column.sql","supabase/migrations/20260614120000_derive_broker_dailies_kind.sql","supabase/migrations/20260707120000_sync_status_preserve_warnings.sql","supabase/migrations/20260708120000_sync_status_failed_final_bounce.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710130000_stitch_composite_kind.sql","supabase/migrations/20260710150000_sync_status_supersede_failed_per_kind.sql","supabase/migrations/20260802120000_strategy_analytics_stuck_computing_reaper.sql","supabase/migrations/20260803120000_strategy_analytics_stamp_trigger_null_stamp_clock_start.sql","supabase/migrations/20260803130000_reaper_limit_bound_materialized_cte.sql"]}

-- ==========================================================================
-- Part 1 -- STRUCTURAL, UNGATED, ZERO SIDE EFFECTS. This is the part that must
-- redden when the migration is unapplied. No transaction: it only reads
-- catalogs. NO `RETURN` appears anywhere in this block -- the pg_cron condition
-- is an IF/ELSE so the column and functiondef assertions run unconditionally.
-- ==========================================================================
DO $$
DECLARE
  v_atttypid   OID;
  v_attnotnull BOOLEAN;
  v_atthasdef  BOOLEAN;
  v_fn         TEXT;
  v_command    TEXT;
  v_schedule   TEXT;
BEGIN
  -- ----- JOB-01: column shape ------------------------------------------
  SELECT a.atttypid, a.attnotnull, a.atthasdef
    INTO v_atttypid, v_attnotnull, v_atthasdef
    FROM pg_attribute a
   WHERE a.attrelid = 'public.strategy_analytics'::regclass
     AND a.attname = 'computing_started_at'
     AND NOT a.attisdropped;

  IF v_atttypid IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-01): strategy_analytics.computing_started_at does not exist. Migration 20260802120000 is NOT applied to this project. This assertion is deliberately ungated: an unapplied migration must be a RED gate, never a green skip.';
  END IF;
  IF v_atttypid <> 'timestamptz'::regtype THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-01): computing_started_at is not timestamptz (atttypid=%)', v_atttypid;
  END IF;
  IF v_attnotnull THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-01): computing_started_at is NOT NULL -- a 23502 timebomb against every existing writer that upserts strategy_analytics without the column. It must be nullable, because NULL is the encoding of "not currently computing".';
  END IF;
  IF v_atthasdef THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-01): computing_started_at carries a DEFAULT; rows that are not computing at all would get stamped.';
  END IF;

  -- ----- JOB-01: the bridge body ---------------------------------------
  v_fn := pg_get_functiondef('sync_strategy_analytics_status(uuid)'::regprocedure);

  IF v_fn !~* 'computing_started_at\s*=\s*CASE' THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-01): branch (a) does not maintain computing_started_at with a conditional CASE. The bridge is PERFORMed in-RPC on EVERY job transition, so the stamp must be conditional on the RESOLVED status.';
  END IF;
  IF v_fn !~* 'computation_status\s+IS\s+DISTINCT\s+FROM\s+''computing''' THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-01): branch (a) stamp does not test the PRIOR status with IS DISTINCT FROM -- the transition-in arm is missing, so the stamp is not keyed on a real transition.';
  END IF;
  -- NEGATIVE anchor -- the C-3 trap. An unconditional stamp resets on every hop
  -- of a multi-hop chain, so the reaper never fires, while a naive
  -- "the writer sets the stamp" gate stays green. This is the Phase 106 janitor
  -- bug re-implemented in a new column. The conditional form never emits this
  -- byte sequence.
  IF v_fn ~* 'computing_started_at\s*=\s*now\(\)' THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-01): branch (a) stamps computing_started_at UNCONDITIONALLY. Every bridge call on a multi-hop chain would push the stamp forward and the reaper could never fire.';
  END IF;
  -- Retained 20260710150000 anchors: the re-base must not silently revert
  -- F-3/PUB-02 or the SI-02 marker reads. A bad re-base reddens HERE too.
  -- RED-UNDER: revert F-3/PUB-02 in the 20260802120000 re-base -- delete the
  --            `AND d.kind = f.kind` conjunct from BOTH supersession subqueries
  --            in branch (b), which is exactly the cross-kind-blind shape that
  --            killed held PR 229d80fa: a later `done` of a DIFFERENT kind would
  --            then mask a real permanent failure.
  --            ⚠️ LAYERED (GRAMMAR Shape 3). The migration SELF-VERIFIES the same
  --            anchor in its STEP 7, so the two-step deletion alone aborts the
  --            apply with `JOB-01 re-base failed: branch (b) lost the per-kind
  --            supersession scope` and this file never runs. The third step
  --            re-bases that check to `IF FALSE THEN`, which is what a careless
  --            real revert would also have to do -- and is the same spelling the
  --            layered twin at test_resync_retry_single_job.sql:234 uses.
  --            The conjunct occurs TWICE (the count subquery and the
  --            latest-error subquery), so it takes two edits; leaving either
  --            behind keeps the regex satisfied and this arm no-red.
  --            ⛔ AND A FOURTH STEP, which is a FINDING about this anchor rather
  --            than bookkeeping. MEASURED on the lane 2026-09-05: with both
  --            conjuncts deleted and STEP 7 re-based, the gate still went GREEN
  --            (`no-red`). pg_get_functiondef returns the function's SOURCE,
  --            COMMENTS INCLUDED, and 20260802120000:353 carries the line
  --            `-- PER-KIND (d.kind = f.kind): a later done of a DIFFERENT kind
  --            …` INSIDE the body -- so the regex kept matching a comment about
  --            the conjunct after the conjunct itself was gone. Every `v_fn ~*`
  --            anchor in Part 1a shares that blind spot. The fourth step
  --            rewrites that comment, which is what a real revert would do to
  --            it; the residual weakness is booked in this phase's
  --            deferred-items.md rather than fixed here, because changing an
  --            assertion is out of this plan's scope.
  -- RED-UNDER-M: {"arm":"1/re-base","apply":[{"kind":"edit","file":"supabase/migrations/20260802120000_strategy_analytics_stuck_computing_reaper.sql","find":"          AND d.kind = f.kind\n","replace":"","occurrences":2},{"kind":"edit","file":"supabase/migrations/20260802120000_strategy_analytics_stuck_computing_reaper.sql","find":"          AND d.kind = f.kind\n","replace":"","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260802120000_strategy_analytics_stuck_computing_reaper.sql","find":"  -- PER-KIND (d.kind = f.kind): a later done of a DIFFERENT kind can NEVER mask a","replace":"  -- PER-KIND scoping was REMOVED here (cross-kind supersession restored).","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260802120000_strategy_analytics_stuck_computing_reaper.sql","find":"IF v_fn !~* 'd\\.kind\\s*=\\s*f\\.kind' THEN","replace":"IF FALSE THEN","occurrences":1}]}
  IF v_fn !~* 'd\.kind\s*=\s*f\.kind' THEN
    RAISE EXCEPTION 'TEST FAILED (1/re-base): branch (b) lost the per-(strategy,kind) supersession scope (F-3/PUB-02 reverted by the 20260802120000 re-base).';
  END IF;
  IF v_fn !~* 'd\.created_at\s*>\s*f\.created_at' THEN
    RAISE EXCEPTION 'TEST FAILED (1/re-base): branch (b) lost the immutable created_at supersession key (F-3/PUB-02 reverted).';
  END IF;
  IF v_fn !~* 'OR\s+strategy_analytics\.computation_warned' THEN
    RAISE EXCEPTION 'TEST FAILED (1/re-base): branches (a)/(c) lost the runner-owned computation_warned marker read (the SI-02 failed_final-bounce launder re-opens).';
  END IF;
  IF v_fn !~* 'SECURITY DEFINER' THEN
    RAISE EXCEPTION 'TEST FAILED (1/re-base): sync_strategy_analytics_status lost SECURITY DEFINER.';
  END IF;
  IF v_fn !~* 'search_path' THEN
    RAISE EXCEPTION 'TEST FAILED (1/re-base): sync_strategy_analytics_status lost its pinned search_path.';
  END IF;
  -- Branch (b)/(c) exit clears. Part 4 proves branch (c) behaviorally and Part 5
  -- proves branch (b) behaviorally; these anchors are the cheap structural twin.
  -- RED-UNDER: delete the exit clear from BOTH branches of the re-based bridge in
  --            migration 20260802120000 -- spell branch (b)'s and branch (c)'s
  --            `computing_started_at = NULL` as `= CAST(NULL AS timestamptz)`.
  --            The VALUE written is identical, so nothing behavioural moves and
  --            Parts 4c and 5 stay green; what changes is that the deployed
  --            functiondef no longer carries the byte sequence this anchor and
  --            the migration's own STEP 7 read. That is the point: this arm is
  --            the cheap STRUCTURAL twin of two behavioural exits, and a
  --            structural anchor is falsified by the text going away.
  --            ⚠️ TWO steps, and the ORDER is load-bearing: branch (b)'s line is
  --            indented 11 spaces and branch (c)'s 9, so the 9-space needle is a
  --            SUBSTRING of the 11-space line and matches twice until (b) is
  --            rewritten first. Both must go -- the anchor is a regex over the
  --            WHOLE functiondef, so one surviving occurrence keeps it green.
  --            ⚠️ This section's other seven raises are NOT the falsifier here.
  --            Four are the column-shape reads, which the lane cannot falsify at
  --            all (the stand-in fixture already declares the column -- see the
  --            header note), and three are mirrored byte-for-byte by STEP 7 of
  --            the same migration, which would ABORT THE APPLY before this file
  --            ran. The exit-clear anchor is the one STEP 7 does not duplicate.
  -- RED-UNDER-M: {"arm":"1/JOB-01","apply":[{"kind":"edit","file":"supabase/migrations/20260802120000_strategy_analytics_stuck_computing_reaper.sql","find":"           computing_started_at = NULL,","replace":"           computing_started_at = CAST(NULL AS timestamptz),","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260802120000_strategy_analytics_stuck_computing_reaper.sql","find":"         computing_started_at = NULL,","replace":"         computing_started_at = CAST(NULL AS timestamptz),","occurrences":1}]}
  IF v_fn !~* 'computing_started_at\s*=\s*NULL' THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-01): no branch clears computing_started_at to NULL on exit; a stale stamp on a terminal row could re-trigger the reaper.';
  END IF;

  RAISE NOTICE 'Part 1a OK: computing_started_at is timestamptz, nullable, no default; bridge stamps conditionally (no unconditional form), clears on exit, and keeps the F-3/PUB-02 + SI-02 + SECDEF anchors.';

  -- ----- JOB-02/JOB-03: the DEPLOYED cron job ---------------------------
  -- The ONLY permitted skip in this file. Note it is an IF/ELSE, not a RETURN:
  -- everything above already ran unconditionally.
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN

    SELECT command, schedule
      INTO v_command, v_schedule
      FROM cron.job
     WHERE jobname = 'reap_strategy_analytics_stuck_computing';

    -- pg_cron present + job absent is an EXCEPTION, never a skip.
    IF v_command IS NULL THEN
      RAISE EXCEPTION 'TEST FAILED (1/JOB-02): pg_cron IS installed but the reap_strategy_analytics_stuck_computing job is NOT registered. Migration 20260802120000 is unapplied or the job was unscheduled. A missing reaper is a red gate, not a skip.';
    END IF;

    -- STRING equality, never a ::INT cast on a schedule field: the hour field
    -- here is '*' and casting it would error (the hour-band idiom from
    -- test_retention_orphaned_running.sql does not transfer to a */15 cadence).
    -- RED-UNDER: change the cadence in the LAST writer of this job,
    --            20260803130000, from `*/15 * * * *` to `*/30 * * * *`. The
    --            threshold is 16 hours and the cadence is POST-THRESHOLD
    --            DETECTION LATENCY (see this file's header), so halving the tick
    --            rate doubles the worst-case spinner tail beyond the advertised
    --            bound while every body anchor below still passes.
    --            ⚠️ The edit targets 20260803130000 and not 20260802120000:
    --            cron.schedule upserts by NAME, so only the last writer's
    --            schedule survives and an edit to either earlier migration comes
    --            back no-red. That migration's own STEP 2 self-verify checks the
    --            body but never the cadence, so no layering is needed.
    --            The needle carries its four-space indent and trailing comma
    --            precisely to miss the prose mention of the same cadence in the
    --            migration's header at :83.
    -- RED-UNDER-M: {"arm":"1/JOB-02","apply":[{"kind":"edit","file":"supabase/migrations/20260803130000_reaper_limit_bound_materialized_cte.sql","find":"    '*/15 * * * *',","replace":"    '*/30 * * * *',","occurrences":1}]}
    IF v_schedule IS DISTINCT FROM '*/15 * * * *' THEN
      RAISE EXCEPTION 'TEST FAILED (1/JOB-02): reaper cadence is not the expected */15 * * * * (got %)', v_schedule;
    END IF;

    -- Positive anchors on the DEPLOYED body.
    IF v_command NOT ILIKE '%public.strategy_analytics%' THEN
      RAISE EXCEPTION 'TEST FAILED (1/JOB-02): reaper body is not schema-qualified to public.strategy_analytics. command was: %', v_command;
    END IF;
    IF v_command NOT ILIKE '%computing_started_at%' THEN
      RAISE EXCEPTION 'TEST FAILED (1/JOB-02): reaper body does not key on computing_started_at. command was: %', v_command;
    END IF;
    -- RED-UNDER: delete the `computation_warned = FALSE` column from the reap
    --            arm's four-column SET in 20260803130000. A reap that terminalizes
    --            to 'failed' but leaves the runner-owned warning marker standing is
    --            laundered by the status bridge's branch (c) into
    --            complete_with_warnings on its next call -- a FALSE SUCCESS on a
    --            money surface, strictly worse than the permanent spinner the
    --            reaper replaces.
    --            ⚠️ LAYERED: 20260803130000 self-verifies this exact token in its
    --            own STEP 2 (`D-19/SI-02 verification failed`), so the deletion
    --            aborts the apply unless that check is re-based in the same twin.
    --            ⛔ This is the STRUCTURAL half. The BEHAVIOURAL half is
    --            2/arm A/SI-02 below, which keeps the token and writes TRUE --
    --            deliberately a different mutation, because deleting the token
    --            makes THIS anchor the first failure and the behavioural arm
    --            unreachable.
    -- RED-UNDER-M: {"arm":"1/JOB-02/SI-02","apply":[{"kind":"edit","file":"supabase/migrations/20260803130000_reaper_limit_bound_materialized_cte.sql","find":"           computation_warned   = FALSE,\n","replace":"","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260803130000_reaper_limit_bound_materialized_cte.sql","find":"IF v_command NOT ILIKE '%computation_warned%' THEN","replace":"IF FALSE THEN","occurrences":1}]}
    IF v_command NOT ILIKE '%computation_warned%' THEN
      RAISE EXCEPTION 'TEST FAILED (1/JOB-02/SI-02): reaper body does not clear computation_warned, so the status bridge would launder the reap into complete_with_warnings -- a FALSE SUCCESS on a money surface, strictly worse than the spinner it replaces. command was: %', v_command;
    END IF;
    IF v_command NOT ILIKE '%done_pending_children%' THEN
      RAISE EXCEPTION 'TEST FAILED (1/JOB-02): reaper body does not carry the full non-terminal compute_jobs status list, so the active-job safety conjunct is wrong. command was: %', v_command;
    END IF;
    IF v_command NOT ILIKE '%skip locked%' THEN
      RAISE EXCEPTION 'TEST FAILED (1/JOB-02): reaper body is not bounded with FOR UPDATE SKIP LOCKED; it could block a live writer holding the row. command was: %', v_command;
    END IF;
    IF v_command NOT ILIKE '%limit%' THEN
      RAISE EXCEPTION 'TEST FAILED (1/JOB-02): reaper body has no LIMIT; an unbounded reaping UPDATE can hold locks across the table during a backlog. command was: %', v_command;
    END IF;
    -- The threshold is pinned here as a LITERAL EXPECTATION typed into the test,
    -- not read from the implementation. SQL<->Python equality is a separate gate
    -- (test_main_worker.py::TestReaperThresholdDriftGate).
    -- RED-UNDER: drift the staleness threshold in the deployed body from
    --            `interval '16 hours'` to `interval '12 hours'`. The threshold is
    --            pinned here as a LITERAL EXPECTATION typed into the test rather
    --            than read from the implementation, so a drift away from the
    --            canonical Python value
    --            (services/job_worker.py STRATEGY_ANALYTICS_REAP_THRESHOLD) is
    --            visible on this side even when both sides move together.
    --            ⚠️ LAYERED for the same reason as 1/JOB-02/SI-02: STEP 2 of
    --            20260803130000 carries the identical literal check
    --            (`D-11/JOB-03 verification failed` in 20260803120000 checks the
    --            body that migration registered, which is superseded here, so only
    --            the LAST writer's own check needs re-basing).
    -- RED-UNDER-M: {"arm":"1/JOB-03","apply":[{"kind":"edit","file":"supabase/migrations/20260803130000_reaper_limit_bound_materialized_cte.sql","find":"AND s.computing_started_at < now() - interval '16 hours'","replace":"AND s.computing_started_at < now() - interval '12 hours'","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260803130000_reaper_limit_bound_materialized_cte.sql","find":"IF v_command NOT ILIKE '%interval ''16 hours''%' THEN","replace":"IF FALSE THEN","occurrences":1}]}
    IF v_command NOT ILIKE '%interval ''16 hours''%' THEN
      RAISE EXCEPTION 'TEST FAILED (1/JOB-03): reaper body does not carry the 16-hour staleness threshold. command was: %', v_command;
    END IF;

    -- NEGATIVE anchors: the two wrong keys and the wrong mechanism's window.
    IF v_command ILIKE '%computed_at%' THEN
      RAISE EXCEPTION 'TEST FAILED (1/JOB-02): reaper body references computed_at, which the status bridge re-stamps on EVERY job transition -- the row would never be reaped (the Phase 106 janitor bug). command was: %', v_command;
    END IF;
    IF v_command ILIKE '%updated_at%' THEN
      RAISE EXCEPTION 'TEST FAILED (1/JOB-02): reaper body references updated_at, a column strategy_analytics does not have (the deleted one-off script raised 42703 on exactly this). command was: %', v_command;
    END IF;
    IF v_command ILIKE '%interval ''4 hours''%' THEN
      RAISE EXCEPTION 'TEST FAILED (1/JOB-03): reaper body carries the compute_jobs orphaned-running 4-hour window. That is a different mechanism on a different table; a strategy_analytics row is computing for a WHOLE multi-hop chain, a strictly larger quantity. command was: %', v_command;
    END IF;

    RAISE NOTICE 'Part 1b OK: reap_strategy_analytics_stuck_computing registered at */15 * * * * with a bounded, computing_started_at-keyed, four-column body carrying the 16-hour threshold.';
  ELSE
    RAISE NOTICE 'SKIP (Part 1b + Parts 2-3 only): pg_cron extension is not installed here (local dev). Part 1a already enforced the column shape and the bridge body unconditionally, and Parts 4-5 still run.';
  END IF;
END
$$;

-- ==========================================================================
-- Part 2 -- REAP BEHAVIOR, the four directional arms. Oracle is the DEPLOYED
-- cron.job.command. Rolls back unconditionally.
--   arm A  stranded, warned=TRUE, FRESH computed_at   -> MUST be reaped (all 4 cols)
--   arm B  fresh stamp, OLD computed_at               -> MUST survive
--   arm C  old stamp but ONE active compute_jobs row  -> MUST survive
--   arm D  NULL stamp, no active jobs                 -> MUST have its CLOCK STARTED
--          (still computing, stamp no longer NULL)
-- Arms A and B together are the SC#2 pair: they fail in OPPOSITE directions if
-- the predicate keys on computed_at instead of computing_started_at.
--
-- ⚠️ ARM D WAS INVERTED in Phase 142.1 (D-11 / correction C-6). It used to assert
-- the NULL-stamp row was left UNMUTATED, because the deployed body was a single
-- reap statement that deliberately skipped NULL stamps. The deployed body is now
-- TWO statements -- a non-destructive clock-start arm FIRST, then the unchanged
-- reap -- so the correct expectation is the opposite: the row keeps its
-- 'computing' status (the arm never terminalizes) AND acquires a stamp, after
-- which the ordinary threshold applies to it like any other row. This arm IS
-- SC-11's gate: delete the clock-start arm from the migration and the stamp
-- stays NULL and this part reddens.
-- ==========================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$
DECLARE
  v_user     uuid := gen_random_uuid();
  v_a        uuid;   -- stranded          -> MUST reap
  v_b        uuid;   -- fresh stamp       -> MUST survive
  v_c        uuid;   -- active job        -> MUST survive
  v_d        uuid;   -- NULL stamp        -> MUST get its clock STARTED
  v_seeded   uuid[];
  v_command  TEXT;
  v_status   TEXT;
  v_warned   BOOLEAN;
  v_error    TEXT;
  v_stamp    TIMESTAMPTZ;
  v_fresh    TIMESTAMPTZ := now();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'SKIP Part 2: pg_cron not installed here; the deployed-body oracle is unavailable (local dev only).';
    RETURN;
  END IF;

  SELECT command INTO v_command
    FROM cron.job WHERE jobname = 'reap_strategy_analytics_stuck_computing';
  -- RED-UNDER: unschedule the job on the live lane database while leaving the
  --            pg_cron EXTENSION installed -- the state this arm exists to name
  --            (`the job was unscheduled`), reached through the lane's
  --            --post-apply hook because no migration edit produces it.
  --            ⚠️ TWO neuters, and the count is MEASURED rather than reasoned.
  --            Part 1b's registration guard sees the same NULL and would be the
  --            first failure, so it is suppressed -- but suppressing only the
  --            `v_command IS NULL` raise is not enough: the very next check is
  --            `v_schedule IS DISTINCT FROM '*/15 * * * *'`, and a NULL schedule
  --            IS DISTINCT FROM any literal, so that copy of 1/JOB-02 fires too.
  --            The seven ILIKE checks after it do NOT need neutering: `NULL NOT
  --            ILIKE '…'` is NULL, and `IF NULL THEN` does not take the branch.
  -- RED-UNDER-M: {"arm":"2","apply":[{"kind":"sql","stmt":"SELECT cron.unschedule('reap_strategy_analytics_stuck_computing')"}],"neuter":[{"arm":"1/JOB-02"},{"arm":"1/JOB-02"}]}
  IF v_command IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (2): reap_strategy_analytics_stuck_computing cron job is missing while pg_cron is installed.';
  END IF;

  -- FK chain: strategy_analytics.strategy_id -> strategies.id -> profiles.id ->
  -- auth.users.id (test_sync_status_supersede_failed_per_kind.sql:108-117).
  INSERT INTO auth.users (id, email)
    VALUES (v_user, 'sa-reaper-arms-' || v_user || '@invalid.local');
  INSERT INTO public.profiles (id, display_name)
    VALUES (v_user, 'sa-reaper-arms') ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.strategies (user_id, name)
    VALUES (v_user, 'sa-reaper-arm-a') RETURNING id INTO v_a;
  INSERT INTO public.strategies (user_id, name)
    VALUES (v_user, 'sa-reaper-arm-b') RETURNING id INTO v_b;
  INSERT INTO public.strategies (user_id, name)
    VALUES (v_user, 'sa-reaper-arm-c') RETURNING id INTO v_c;
  INSERT INTO public.strategies (user_id, name)
    VALUES (v_user, 'sa-reaper-arm-d') RETURNING id INTO v_d;
  v_seeded := ARRAY[v_a, v_b, v_c, v_d];

  -- arm A: stranded A CENTURY (isolation by construction -- see the header: this
  -- epoch is what makes the seed outrank any plausible foreign row for the
  -- deployed `ORDER BY computing_started_at ASC LIMIT 25` budget, replacing the
  -- deleted cross-tenant neutralizing UPDATE). warned marker SET (this is what
  -- makes the SI-02 launder block observable), computed_at FRESH (SC#2
  -- direction 1).
  INSERT INTO public.strategy_analytics
    (strategy_id, computation_status, computation_warned, computing_started_at, computed_at)
  VALUES (v_a, 'computing', TRUE, v_fresh - interval '100 years', v_fresh);

  -- arm B: stamp FRESH, computed_at 100 days OLD (SC#2 direction 2).
  INSERT INTO public.strategy_analytics
    (strategy_id, computation_status, computation_warned, computing_started_at, computed_at)
  VALUES (v_b, 'computing', FALSE, v_fresh, v_fresh - interval '100 days');

  -- arm C: stranded stamp, but a live in-flight chain -- the NOT EXISTS
  -- conjunct is THE safety carrier, the interval is only a debounce.
  INSERT INTO public.strategy_analytics
    (strategy_id, computation_status, computation_warned, computing_started_at, computed_at)
  VALUES (v_c, 'computing', FALSE, v_fresh - interval '100 days', v_fresh);
  INSERT INTO public.compute_jobs
    (kind, strategy_id, status, priority, attempts, next_attempt_at, claim_token, claimed_at)
  VALUES ('compute_analytics_from_csv', v_c, 'running', 'normal', 1, now(), gen_random_uuid(), now());

  -- arm D: NULL stamp with no active job -- the D-11 population. Terminalizing
  -- it would convert a writer bug into user-visible data loss, so the deployed
  -- body does the non-destructive thing instead: it STARTS the clock, and the
  -- ordinary 16-hour threshold takes it from there. Seeded by INSERT, which is
  -- what makes it reachable at all: the stamp trigger (migration 20260803120000)
  -- fires on UPDATE only, precisely so this file can establish state at INSERT
  -- (D-18 part 2).
  --
  -- DETERMINISM, stated honestly (the migration carries the mirror of this note
  -- beside the arm): the clock-start arm is bounded LIMIT 25 and cannot be
  -- ordered (every candidate's stamp is NULL, so there is nothing to sort on).
  -- This assertion therefore rests on the header's RESIDUAL ASSUMPTION plus
  -- fewer than 25 FOREIGN rows sitting at ('computing', NULL, no active job) on
  -- the shared TEST project when this runs. Changing the arm's target predicate
  -- and this argument are a SAME-COMMIT pair, in both directions.
  INSERT INTO public.strategy_analytics
    (strategy_id, computation_status, computation_warned, computing_started_at, computed_at)
  VALUES (v_d, 'computing', FALSE, NULL, v_fresh - interval '100 days');

  -- ----- THE ORACLE: run the REAL deployed body -------------------------
  -- No cross-tenant neutralization happens here. Arm A's century-old stamp wins
  -- the LIMIT-25 budget by construction (header, "isolation by construction").
  EXECUTE v_command;

  -- arm A: all FOUR columns of the reap outcome.
  SELECT computation_status, computation_warned, computation_error, computing_started_at
    INTO v_status, v_warned, v_error, v_stamp
    FROM public.strategy_analytics WHERE strategy_id = v_a;

  -- RED-UNDER: narrow the reap UPDATE's own WHERE in 20260803130000 from
  --            `sa.computation_status = 'computing'` to a status no row holds, so
  --            the bounded batch is still selected and locked but nothing is
  --            terminalized. The stranded spinner becomes permanent -- which is
  --            the whole harm this file exists to detect -- while every TEXTUAL
  --            anchor in Part 1b still passes, because the body still names
  --            public.strategy_analytics, computing_started_at,
  --            computation_warned, done_pending_children, SKIP LOCKED, LIMIT and
  --            the 16-hour interval. A source scan cannot see rows; only
  --            EXECUTEing the deployed body against real ones falsifies this.
  --            The needle carries its trailing semicolon, which is what
  --            distinguishes the reap UPDATE's final predicate from the
  --            clock-start UPDATE's identical-looking one.
  -- RED-UNDER-M: {"arm":"2/arm A/JOB-02","apply":[{"kind":"edit","file":"supabase/migrations/20260803130000_reaper_limit_bound_materialized_cte.sql","find":"AND sa.computation_status = 'computing';","replace":"AND sa.computation_status = 'reaper-disabled';","occurrences":1}]}
  IF v_status IS DISTINCT FROM 'failed' THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm A/JOB-02): a stranded computing row with no active compute_jobs was not terminalized to failed (got %). The spinner is permanent.', v_status;
  END IF;
  -- RED-UNDER: write `computation_warned = TRUE` instead of FALSE in the reap
  --            arm's SET. The token stays, so Part 1b's structural SI-02 anchor
  --            and the migration's own STEP 2 check both still pass -- and that
  --            is exactly why this behavioural arm has to exist separately from
  --            1/JOB-02/SI-02: a reap that SETS the marker instead of clearing it
  --            satisfies every grep for the word and still hands the status
  --            bridge a reap it will launder into complete_with_warnings.
  -- RED-UNDER-M: {"arm":"2/arm A/SI-02","apply":[{"kind":"edit","file":"supabase/migrations/20260803130000_reaper_limit_bound_materialized_cte.sql","find":"           computation_warned   = FALSE,","replace":"           computation_warned   = TRUE,","occurrences":1}]}
  IF v_warned IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm A/SI-02): the reap did not clear computation_warned (got %). The status bridge will launder this failure into complete_with_warnings on its next call -- a FALSE SUCCESS on a money surface.', v_warned;
  END IF;
  IF v_error IS DISTINCT FROM 'Analytics was interrupted before it could finish and did not recover. Retry the sync.' THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm A/JOB-02): computation_error is not the shipped reaper message (got %). It renders to the USER — the portfolio-side and strategy-side surfaces read this column directly — so it must not re-attribute fault or claim how much work completed. (It no longer renders as a Details line under GATE_ANALYTICS_FAILED: Phase 162 / UI-SPEC C-2 removed that appendix from the wizard envelope. The copy requirement is unchanged; only the surface named here was stale.)', v_error;
  END IF;
  -- RED-UNDER: make the reaper disobey its own clear-on-exit rule -- write
  --            `computing_started_at = now()` instead of NULL in the reap SET, so
  --            a row it just terminalized keeps a live reaper key.
  --            ⚠️ LAYERED across TWO migrations, and the second step is the
  --            interesting one: the stamp TRIGGER from 20260803120000 is bound
  --            BEFORE UPDATE and its arm (d) clears the key unconditionally on
  --            every exit from computing, so the cron-body edit ALONE is
  --            invisible -- the trigger repairs it and this arm stays green. Arm
  --            (d) is therefore neutralised in the same twin. That pair is the
  --            finding: the deployed body and the table trigger are two
  --            independent defences of one invariant, and only breaking both
  --            makes the invariant observable here.
  -- RED-UNDER-M: {"arm":"2/arm A/JOB-01","apply":[{"kind":"edit","file":"supabase/migrations/20260803130000_reaper_limit_bound_materialized_cte.sql","find":"           computing_started_at = NULL","replace":"           computing_started_at = now()","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260803120000_strategy_analytics_stamp_trigger_null_stamp_clock_start.sql","find":"    NEW.computing_started_at := NULL;","replace":"    NULL;","occurrences":1}]}
  IF v_stamp IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm A/JOB-01): the reap left computing_started_at set (got %). The reaper is itself an exit transition and must obey the clear-on-exit rule, or a stale stamp can re-trigger it.', v_stamp;
  END IF;

  -- arm B: SC#2 direction 2 -- an OLD computed_at must NOT drag a healthy row in.
  SELECT computation_status INTO v_status
    FROM public.strategy_analytics WHERE strategy_id = v_b;
  -- RED-UNDER: widen the reap arm's staleness predicate to
  --            `(s.computing_started_at < now() - interval '16 hours' OR TRUE)`,
  --            the shape any predicate that stops keying on the stamp collapses
  --            to. Arm A is still reaped, so every assertion above stays green;
  --            arm B -- a HEALTHY row whose stamp is fresh -- is taken as well,
  --            and a live computation is terminalized under the user.
  --            ⚠️ The 16-hour literal is deliberately KEPT rather than replaced.
  --            Removing it would fire 1/JOB-03 and the migration's STEP 2 first,
  --            and this arm would never be reached: SC#2 direction 2 is about the
  --            predicate's KEY, not about its threshold value.
  -- RED-UNDER-M: {"arm":"2/arm B/SC#2","apply":[{"kind":"edit","file":"supabase/migrations/20260803130000_reaper_limit_bound_materialized_cte.sql","find":"         AND s.computing_started_at < now() - interval '16 hours'","replace":"         AND (s.computing_started_at < now() - interval '16 hours' OR TRUE)","occurrences":1}]}
  IF v_status IS DISTINCT FROM 'computing' THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm B/SC#2): a row with a FRESH computing_started_at but a 100-day-old computed_at was reaped (got %). The predicate is keyed on computed_at, which the Python entry upsert omits, so it holds the PRIOR run value -- every fresh computation would be reaped instantly.', v_status;
  END IF;

  -- arm C: the safety conjunct.
  SELECT computation_status INTO v_status
    FROM public.strategy_analytics WHERE strategy_id = v_c;
  -- RED-UNDER: drop `'running'` from the non-terminal status list in the REAP
  --            arm's NOT EXISTS conjunct (nth 2 -- the clock-start arm carries a
  --            byte-identical list and is left alone, which is what keeps arm D
  --            and Part 3 unmoved). The safety conjunct then stops seeing the one
  --            status a live in-flight chain actually holds, and a healthy
  --            computation with a claimed job is reaped.
  --            ⚠️ `done_pending_children` survives the edit on purpose: Part 1b's
  --            list anchor and STEP 2 both grep for that token alone, so a status
  --            list that has quietly lost 'running' passes every structural check
  --            in the corpus. This arm is the only thing that sees it.
  -- RED-UNDER-M: {"arm":"2/arm C/JOB-02","apply":[{"kind":"edit","file":"supabase/migrations/20260803130000_reaper_limit_bound_materialized_cte.sql","find":"                  AND cj.status IN ('pending', 'running', 'done_pending_children', 'failed_retry')","replace":"                  AND cj.status IN ('pending', 'done_pending_children', 'failed_retry')","occurrences":2,"nth":2}]}
  IF v_status IS DISTINCT FROM 'computing' THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm C/JOB-02): a row with an ACTIVE compute_jobs row was reaped (got %). A healthy in-flight chain always has a non-terminal job row; reaping it fails a live computation.', v_status;
  END IF;

  -- arm D: the clock-start rule. NON-DESTRUCTIVE is half the property, so BOTH
  -- assertions are load-bearing: the status must NOT move (the arm terminalizes
  -- nothing) AND the stamp must now be set (the arm actually ran).
  SELECT computation_status, computing_started_at INTO v_status, v_stamp
    FROM public.strategy_analytics WHERE strategy_id = v_d;
  -- RED-UNDER: back-date what the clock-start arm writes -- `SET
  --            computing_started_at = now() - interval '100 years'` instead of
  --            now(). The arm still runs, still stamps, and still passes every
  --            anchor; but the row it just clocked is instantly older than the
  --            16-hour threshold, so the reap arm -- which runs SECOND in the same
  --            tick, by design -- terminalizes it on the spot. A NULL stamp is a
  --            WRITER bug, not a stranded job, and this converts that bug into
  --            user-visible data loss in one tick.
  --            ⚠️ Deleting the arm instead would redden 2/arm D/D-11 (the stamp
  --            stays NULL) rather than this one: the two halves of the
  --            non-destructive property need two different mutations, which is
  --            why both assertions are load-bearing.
  -- RED-UNDER-M: {"arm":"2/arm D/JOB-02","apply":[{"kind":"edit","file":"supabase/migrations/20260803130000_reaper_limit_bound_materialized_cte.sql","find":"       SET computing_started_at = now()","replace":"       SET computing_started_at = now() - interval '100 years'","occurrences":1}]}
  IF v_status IS DISTINCT FROM 'computing' THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm D/JOB-02): a computing row with a NULL computing_started_at was reaped (got %). A NULL stamp is a WRITER bug, not a stranded job; the clock-start arm must START its clock, never terminalize it -- that would convert a bug into user-visible data loss.', v_status;
  END IF;
  -- RED-UNDER: invert the clock-start UPDATE's own final predicate in
  --            20260803130000 -- `AND sa.computing_started_at IS NOT NULL` -- so
  --            the arm matches no unclocked row and the (computing, NULL stamp, no
  --            active job) population is never clocked at all.
  --            ⚠️ The CTE's `AND s.computing_started_at IS NULL` is left intact, so
  --            the migration's own STEP 2 anchor (`the clock-start arm was lost in
  --            the rewrite`) still finds its token and the apply completes. That
  --            is the point: an arm can be present in the deployed text and
  --            reach zero rows, and no static check in this corpus can tell the
  --            difference -- a source scan cannot see rows.
  -- RED-UNDER-M: {"arm":"2/arm D/D-11","apply":[{"kind":"edit","file":"supabase/migrations/20260803130000_reaper_limit_bound_materialized_cte.sql","find":"       AND sa.computing_started_at IS NULL;","replace":"       AND sa.computing_started_at IS NOT NULL;","occurrences":1}]}
  IF v_stamp IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm D/D-11): the clock-start arm did not start the clock on a (computing, NULL stamp, no active job) row -- the stamp is still NULL. Such a row is invisible to the reap arm forever, and no STATIC gate can ever see it (a source scan cannot see rows). Either the clock-start arm is missing from the deployed body, or 25+ foreign rows in the same condition consumed its budget (see this arm''s DETERMINISM note above).';
  END IF;

  RAISE NOTICE 'Part 2 OK: stranded row reaped on all four columns; fresh-stamp/old-computed_at survived; active-job row survived; NULL-stamp row had its clock started without being terminalized.';

  -- Teardown, belt-and-suspenders; the ROLLBACK also discards everything.
  DELETE FROM auth.users WHERE id = v_user;
END
$$;
ROLLBACK;

-- ==========================================================================
-- Part 3 -- arm E, the LIMIT bound. 26 stranded rows, oracle run TWICE.
-- The assertions are IDENTITY-SCOPED, not shape-scoped (D-18): the 26 seeds are
-- staggered a century back, so under the deployed `ORDER BY
-- computing_started_at ASC LIMIT 25` the 25 OLDEST seeds are exactly the ones a
-- correct tick must take, and v_youngest (the i=1 seed, least old) is exactly
-- the one it must leave. So:
--   tick 1  -> my 25 oldest seeds are ALL 'failed' (fewer => not draining, or a
--              foreign row crowded a seed out of the budget) AND v_youngest is
--              still 'computing' (if the LIMIT were gone it would have gone too)
--   tick 2  -> v_youngest is 'failed' and all 26 seeds are terminal (progressing)
-- This replaces the old "exactly 25 of 26" global-shape count. Naming WHICH rows
-- must move is strictly stronger than counting HOW MANY moved, and it is the
-- project's recorded e2e-seeded lesson: assert your OWN seed invariant.
-- Rolls back unconditionally.
-- ==========================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$
DECLARE
  v_user     uuid := gen_random_uuid();
  v_strat    uuid;
  v_seeded   uuid[] := ARRAY[]::uuid[];
  v_youngest uuid;   -- the i=1 seed: LEAST old, so the one tick 1 must NOT take
  v_command  TEXT;
  v_cnt      INTEGER;
  v_status   TEXT;
  v_fresh    TIMESTAMPTZ := now();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'SKIP Part 3: pg_cron not installed here; the deployed-body oracle is unavailable (local dev only).';
    RETURN;
  END IF;

  SELECT command INTO v_command
    FROM cron.job WHERE jobname = 'reap_strategy_analytics_stuck_computing';
  -- ⛔ NOT AN ARM, AND DELIBERATELY NOT ONE. This guard carries no
  --    `TEST FAILED (` identity, so the runner does not count it as a section
  --    (scripts/mutation-runner/parse.mjs IDENTITY_CARRIER). That is the honest
  --    classification, not a way to dodge a twin -- and it follows the precedent
  --    the SAME question set in test_retention_orphaned_running.sql's `3/JOB-05`
  --    (phase 164.4.1, commit fcbc0159): reclassify, never waive.
  --
  --    MEASURED on the lane 2026-09-05, twice, rather than argued. This raise is
  --    the THIRD copy of one registration guard -- Part 1b's, then Part 2's,
  --    then this -- and each copy is dominated by the one before it. For it to
  --    fail FIRST, Parts 1 and 2 must both pass (so cron.job.command was
  --    non-NULL when Part 2 read it) while Part 3 reads NULL, and nothing can
  --    change cron.job between those two reads: everything Part 2 does happens
  --    inside the transaction it rolls back. Both escape routes were driven on
  --    real lanes and both failed:
  --      * unschedule post-apply and neuter the dominators (two copies of
  --        1/JOB-02 -- the second is needed because a NULL schedule IS DISTINCT
  --        FROM the cadence literal -- plus Part 2's `2`): Part 2 then reaches
  --        its oracle call and the lane exits 3 on
  --        `22004: query string argument of EXECUTE is null`
  --        (CONTEXT: inline_code_block line 103 at EXECUTE), a raw driver error
  --        that names no arm and scores NO-IDENTITY.
  --      * a cron body that unschedules ITSELF: Parts 1a, 1b and 2 all print OK,
  --        but the unschedule is transactional, Part 3 reads the row back, and
  --        its SECOND tick dies on
  --        `XX000: could not find valid entry for job
  --        'reap_strategy_analytics_stuck_computing'` -- again naming no arm.
  --
  --    A raise that cannot be made to fire is not a falsifiable assertion about
  --    production, and the founder rule is that a test which CANNOT FAIL is
  --    worse than none. So it stops CLAIMING to be one. It is KEPT, rather than
  --    deleted, for the one thing it still does: if a future refactor ever makes
  --    this reachable it fails with a named invariant instead of a raw 22004 out
  --    of the EXECUTE below. The registration ASSERTION lives in Part 1b's
  --    1/JOB-02 and in Part 2's `2`, and BOTH of those bite.
  --
  --    ⚠️ Do NOT restore the identity spelling for `3`. Doing so re-adds an
  --    unfalsifiable section, and the only way to make the corpus green again
  --    would be a waiver -- which is exactly what WAIVED_CEILING 0 refuses
  --    (164.4.1-CONTEXT D-03).
  IF v_command IS NULL THEN
    RAISE EXCEPTION 'INVARIANT (Part 3 precondition): the reap_strategy_analytics_stuck_computing cron job is missing while pg_cron is installed, but Part 1b and Part 2 both passed. That is supposed to be unreachable -- see the note above. The registration assertions are Part 1b (1/JOB-02) and Part 2 (2).';
  END IF;

  INSERT INTO auth.users (id, email)
    VALUES (v_user, 'sa-reaper-limit-' || v_user || '@invalid.local');
  INSERT INTO public.profiles (id, display_name)
    VALUES (v_user, 'sa-reaper-limit') ON CONFLICT (id) DO NOTHING;

  -- LIMIT + 1 stranded rows, staggered so the ordering is deterministic, and
  -- seeded A CENTURY back so all 26 outrank any plausible foreign candidate row
  -- for the deployed LIMIT-25 budget (isolation by construction -- see the
  -- header; this is what replaces the deleted cross-tenant neutralizing UPDATEs).
  -- i=26 is the OLDEST seed, i=1 the youngest.
  FOR i IN 1..26 LOOP
    INSERT INTO public.strategies (user_id, name)
      VALUES (v_user, 'sa-reaper-limit-' || i::text) RETURNING id INTO v_strat;
    v_seeded := array_append(v_seeded, v_strat);
    INSERT INTO public.strategy_analytics
      (strategy_id, computation_status, computation_warned, computing_started_at, computed_at)
    VALUES (v_strat, 'computing', FALSE,
            v_fresh - interval '100 years' - (i * interval '1 minute'), v_fresh);
  END LOOP;

  -- The i=1 seed: LEAST old of the 26, so it is the single row a correctly
  -- bounded tick must leave behind. Asserting on THIS id -- not on a count --
  -- is what makes the bound falsifiable without reading foreign rows.
  v_youngest := v_seeded[1];

  -- ----- tick 1: BOUNDED -------------------------------------------------
  EXECUTE v_command;

  SELECT count(*) INTO v_cnt
    FROM public.strategy_analytics
   WHERE strategy_id = ANY (v_seeded)
     AND strategy_id <> v_youngest
     AND computation_status = 'failed';
  -- RED-UNDER: raise the REAP arm's bound from `LIMIT 25` to `LIMIT 26` (the
  --            needle takes the ORDER BY line with it, which is what picks the
  --            reap arm out of the two byte-identical `LIMIT 25` lines and the
  --            two more in the migration's own header prose). Tick 1 then takes
  --            all 26 seeds: the first assertion still counts 25 of my 25 oldest
  --            and passes, and the second one -- my YOUNGEST seed, the row a
  --            correctly bounded tick must leave behind -- reddens.
  --            ⚠️ This is the D-19 defect's own shape re-introduced by a different
  --            route. Every gate in phases 142 and 142.1 greps for the PRESENCE of
  --            LIMIT and passed while the bound did not exist; naming WHICH row
  --            must survive, rather than counting how many moved, is what makes
  --            the bound falsifiable at all.
  -- RED-UNDER-M: {"arm":"3/arm E/JOB-02","apply":[{"kind":"edit","file":"supabase/migrations/20260803130000_reaper_limit_bound_materialized_cte.sql","find":"       ORDER BY s.computing_started_at ASC\n       LIMIT 25","replace":"       ORDER BY s.computing_started_at ASC\n       LIMIT 26","occurrences":1}]}
  IF v_cnt <> 25 THEN
    RAISE EXCEPTION 'TEST FAILED (3/arm E/JOB-02): after one tick only % of MY 25 oldest seeded stranded rows are failed, expected all 25. Either the run is not draining, or a foreign row older than the century-old seed epoch crowded a seed out of the LIMIT-25 budget (see the header RESIDUAL ASSUMPTION).', v_cnt;
  END IF;

  SELECT computation_status INTO v_status
    FROM public.strategy_analytics WHERE strategy_id = v_youngest;
  IF v_status IS DISTINCT FROM 'computing' THEN
    RAISE EXCEPTION 'TEST FAILED (3/arm E/JOB-02): my YOUNGEST seeded stranded row (the 26th, outside a 25-row budget) was reaped on tick 1 (got %). The LIMIT bound is gone, so a backlog could hold locks across the table for an unbounded window.', v_status;
  END IF;

  -- ----- tick 2: PROGRESSING --------------------------------------------
  -- No neutralizing UPDATE here either: the previous tick terminalized 25 of the
  -- seeds, so v_youngest is now the oldest remaining candidate this block owns.
  EXECUTE v_command;

  SELECT computation_status INTO v_status
    FROM public.strategy_analytics WHERE strategy_id = v_youngest;
  IF v_status IS DISTINCT FROM 'failed' THEN
    RAISE EXCEPTION 'TEST FAILED (3/arm E/JOB-02): my youngest seeded stranded row is still % after a SECOND tick, expected failed. The reaper is bounded but not progressing, so a backlog would never drain.', v_status;
  END IF;

  SELECT count(*) INTO v_cnt
    FROM public.strategy_analytics
   WHERE strategy_id = ANY (v_seeded) AND computation_status = 'failed';
  IF v_cnt <> 26 THEN
    RAISE EXCEPTION 'TEST FAILED (3/arm E/JOB-02): after a second tick % of my 26 seeded stranded rows are terminal, expected all 26.', v_cnt;
  END IF;

  RAISE NOTICE 'Part 3 OK: LIMIT bound holds -- my 25 oldest seeds reaped on tick 1 with my youngest left computing, and my youngest reaped on tick 2 (bounded AND progressing).';

  DELETE FROM auth.users WHERE id = v_user;
END
$$;
ROLLBACK;

-- ==========================================================================
-- Part 4 -- JOB-01 stamp transition + branch (c) exit clear, driven through the
-- REAL mark_compute_job_done RPC (never the bridge directly). Three claimed
-- jobs of THREE DISTINCT kinds, because
-- compute_jobs_one_inflight_per_kind_strategy is a partial unique on
-- (strategy_id, kind) over the in-flight statuses. Rolls back unconditionally.
--   4a  first job done, siblings in flight -> row stays computing, stamp KEPT
--   4b  SC-2b: second job done -> the seeded sentinel is still there
--   4c  last job done -> branch (c) terminal -> stamp CLEARED
-- No pg_cron gate here: this part needs only the migration's column and the
-- re-based bridge, so it must redden (not skip) on an unapplied migration.
--
-- ⚠️ RETROFITTED in Phase 142.1 (D-18 part 2). The sentinel is now seeded in the
-- part's INSERT, and the mid-test UPDATE that used to install it between 4a and
-- 4b is DELETED. Reason: the stamp trigger (migration 20260803120000) fires
-- BEFORE UPDATE and coerces the stamp on an already-computing row, so an UPDATE
-- could no longer install a sentinel at all -- it would be reverted before it
-- landed, and this part would have gone green over a value it never wrote. The
-- rule the retrofit encodes is general: this file establishes state at INSERT,
-- where the trigger by design does not fire, and NEVER by UPDATE-ing a computing
-- row.
--
-- ⛔ WHAT 4a AND 4b DO AND DO NOT PROVE -- read before "strengthening" either.
--
--   * 4a's `IF v_stamp IS NULL` is an S-2 SEED-INTEGRITY CONTROL, not a proof.
--     The row is SEEDED at computing with the sentinel, so after the retrofit
--     that check cannot fail on any behaviour of the code under test; it exists
--     to catch a broken seed. What 4a demonstrates is the mid-chain property: a
--     bridge hop on an already-computing row keeps it computing and PRESERVES
--     the pre-existing stamp.
--   * The behavioural proof that a transition INTO computing STAMPS has LEFT
--     Part 4. It now lives in Part 1's structural anchors (`= CASE` and
--     `IS DISTINCT FROM 'computing'` against the deployed functiondef), in
--     migration 20260802120000's own STEP 7 anchors, and behaviourally in
--     trigger arm (b) at Part 6 (plan 142.1-08). ⛔ Do NOT "restore" it by
--     re-seeding this part at 'pending' -- that re-breaks the sentinel, which is
--     the exact defect the retrofit fixed.
--   * 4b is DOUBLE-MUTATION defence-in-depth, NOT a single-mutation observable.
--     Two independent mechanisms now preserve the sentinel: trigger arm (a)
--     coerces an advancing write back to the old stamp, AND the bridge's own
--     Arm 3 keeps it. Breaking either ALONE leaves 4b green; only breaking BOTH
--     reddens it. SC-2b's single-mutation observable is Part 6/6a (plan
--     142.1-08), and a bridge that stamps unconditionally is caught by Part 1's
--     negative anchor and by the migration's STEP 7 anchor. 4b adds depth, not
--     coverage -- do not credit it as the SC-2b proof in any evidence ledger.
-- ==========================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$
DECLARE
  v_user     uuid := gen_random_uuid();
  v_strat    uuid;
  v_j1       uuid := gen_random_uuid();
  v_j2       uuid := gen_random_uuid();
  v_j3       uuid := gen_random_uuid();
  v_t1       uuid := gen_random_uuid();
  v_t2       uuid := gen_random_uuid();
  v_t3       uuid := gen_random_uuid();
  v_status   TEXT;
  v_stamp    TIMESTAMPTZ;
  v_sentinel TIMESTAMPTZ;
BEGIN
  INSERT INTO auth.users (id, email)
    VALUES (v_user, 'sa-reaper-stamp-' || v_user || '@invalid.local');
  INSERT INTO public.profiles (id, display_name)
    VALUES (v_user, 'sa-reaper-stamp') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.strategies (user_id, name)
    VALUES (v_user, 'sa-reaper-stamp-strat') RETURNING id INTO v_strat;

  -- Mid-chain state, established at INSERT (D-18 part 2): already computing,
  -- with the SC-2b sentinel three hours back as its start time. This is the only
  -- point at which this part may set the stamp -- the trigger does not fire on
  -- INSERT, so the sentinel lands verbatim, whereas an UPDATE would be coerced.
  v_sentinel := now() - interval '3 hours';

  INSERT INTO public.strategy_analytics
    (strategy_id, computation_status, computation_warned, computing_started_at)
  VALUES (v_strat, 'computing', FALSE, v_sentinel);

  INSERT INTO public.compute_jobs
    (id, kind, strategy_id, status, priority, attempts, next_attempt_at, claim_token, claimed_at)
  VALUES
    (v_j1, 'sync_trades',                v_strat, 'running', 'normal', 1, now(), v_t1, now()),
    (v_j2, 'derive_broker_dailies',      v_strat, 'running', 'normal', 1, now(), v_t2, now()),
    (v_j3, 'compute_analytics_from_csv', v_strat, 'running', 'normal', 1, now(), v_t3, now());

  -- ----- 4a: a mid-chain bridge hop keeps computing AND keeps the stamp -----
  PERFORM public.mark_compute_job_done(v_j1, v_t1);

  SELECT computation_status, computing_started_at INTO v_status, v_stamp
    FROM public.strategy_analytics WHERE strategy_id = v_strat;
  IF v_status IS DISTINCT FROM 'computing' THEN
    RAISE EXCEPTION 'TEST FAILED (4a): with two sibling jobs still in flight the bridge did not resolve computing (got %).', v_status;
  END IF;
  -- S-2 SEED-INTEGRITY CONTROL, not a behavioural proof (see the Part 4 header):
  -- the row was seeded WITH a stamp, so this can only fail if the seed itself is
  -- broken -- which would make every assertion below vacuous.
  -- RED-UNDER: make the mid-chain bridge hop DESTROY the stamp -- change branch
  --            (a)'s CASE Arm 3 from `ELSE strategy_analytics.computing_started_at`
  --            to `ELSE NULL` -- and neutralise the two trigger arms that would
  --            otherwise repair it. THREE steps, and each was needed:
  --              * the bridge edit alone is invisible because trigger arm (a)
  --                restores OLD.computing_started_at on an already-clocked
  --                computing row;
  --              * with arm (a) gone the write arrives unclocked and trigger arm
  --                (b) stamps now() instead, so the stamp is non-NULL again.
  --            Only with both arms silent does the row reach this read with no
  --            stamp. ⛔ This arm is an S-2 SEED-INTEGRITY CONTROL, and the
  --            mutation is chosen to match what it CLAIMS: it does not report a
  --            finding about the bridge, it reports that 4b below would be
  --            comparing against nothing. The three-deep defence this twin has to
  --            strip is itself the measurement -- it is why the Part 4 header
  --            calls 4b defence-in-depth rather than a single-mutation observable.
  -- RED-UNDER-M: {"arm":"4a/seed","apply":[{"kind":"edit","file":"supabase/migrations/20260802120000_strategy_analytics_stuck_computing_reaper.sql","find":"             ELSE strategy_analytics.computing_started_at","replace":"             ELSE NULL","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260803120000_strategy_analytics_stamp_trigger_null_stamp_clock_start.sql","find":"      NEW.computing_started_at := OLD.computing_started_at;","replace":"      NULL;","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260803120000_strategy_analytics_stamp_trigger_null_stamp_clock_start.sql","find":"      NEW.computing_started_at := now();","replace":"      NULL;","occurrences":1}]}
  IF v_stamp IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (4a/seed): the seeded computing_started_at is gone before the SC-2b arm even runs, so 4b would compare against nothing. This is a broken fixture, not a finding about the bridge.';
  END IF;

  -- ----- 4b: SC-2b, the frozen-clock-proof form -------------------------
  -- now() is CONSTANT inside this transaction, so "call twice and compare the
  -- two stamps" CANNOT FAIL -- an unconditional stamp writes the same frozen
  -- now() both times. The sentinel three hours back (seeded above, at INSERT) is
  -- what makes the difference visible: a writer that advances the stamp
  -- overwrites it with the frozen now(), which differs from the sentinel by
  -- three hours. ⚠️ Two mechanisms now defend that value, so this arm is
  -- defence-in-depth rather than a single-mutation observable -- see the ⛔ note
  -- in the Part 4 header before citing it as evidence for anything.
  PERFORM public.mark_compute_job_done(v_j2, v_t2);

  SELECT computation_status, computing_started_at INTO v_status, v_stamp
    FROM public.strategy_analytics WHERE strategy_id = v_strat;
  IF v_status IS DISTINCT FROM 'computing' THEN
    RAISE EXCEPTION 'TEST FAILED (4b): the row left computing while a sibling job was still in flight (got %); the SC-2b arm would be vacuous.', v_status;
  END IF;
  -- RED-UNDER: re-implement the Phase 106 janitor bug in this column -- change
  --            branch (a)'s CASE Arm 3 to `ELSE now()`, so a second bridge call on
  --            an ALREADY-computing row advances the clock, and neutralise trigger
  --            arm (a), the second mechanism that preserves it.
  --            ⚠️ BOTH steps are required and that is the arm's own documented
  --            weakness made executable: the Part 4 header states that two
  --            independent mechanisms defend this value and that breaking either
  --            ALONE leaves this arm green. This twin is the measurement behind
  --            that sentence.
  --            ⚠️ `ELSE now()` does NOT trip the negative anchor at Part 1a or the
  --            migration's own STEP 7: both read `computing_started_at\s*=\s*now\(\)`,
  --            and inside a CASE the column name and the call are not adjacent.
  --            MEASURED, not assumed -- the apply completes and Part 1a passes.
  -- RED-UNDER-M: {"arm":"4b/SC-2b/JOB-01","apply":[{"kind":"edit","file":"supabase/migrations/20260802120000_strategy_analytics_stuck_computing_reaper.sql","find":"             ELSE strategy_analytics.computing_started_at","replace":"             ELSE now()","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260803120000_strategy_analytics_stamp_trigger_null_stamp_clock_start.sql","find":"      NEW.computing_started_at := OLD.computing_started_at;","replace":"      NULL;","occurrences":1}]}
  IF v_stamp IS DISTINCT FROM v_sentinel THEN
    RAISE EXCEPTION 'TEST FAILED (4b/SC-2b/JOB-01): a second bridge call on an ALREADY-computing row ADVANCED computing_started_at (expected the sentinel %, got %). The bridge is PERFORMed in-RPC on every job transition, so every hop of a multi-hop chain would push the stamp forward and the reaper could never fire -- the Phase 106 janitor bug re-implemented in a new column, and a naive writer-sets-the-stamp gate stays green through it.', v_sentinel, v_stamp;
  END IF;

  -- ----- 4c: branch (c) exit clears -------------------------------------
  PERFORM public.mark_compute_job_done(v_j3, v_t3);

  SELECT computation_status, computing_started_at INTO v_status, v_stamp
    FROM public.strategy_analytics WHERE strategy_id = v_strat;
  -- RED-UNDER: change branch (c)'s fall-through resolution in the 20260802120000
  --            re-base from `ELSE 'complete'` to `ELSE 'complete_with_warnings'`,
  --            so an all-done chain with NO warning marker still resolves to the
  --            warned sub-state. That is the launder direction the SI-02 work
  --            exists to keep closed, in reverse: a clean run reported as one that
  --            had problems.
  --            ⚠️ The SECTION here is `4`: the runner's suffix rule folds the
  --            bare identities 4a / 4b / 4c into one section, so ONE twin covers
  --            all three, and it is 4c's status check that fires -- 4a and 4b
  --            both pass first, untouched, which is what proves the mutation
  --            reaches this far. The twin's `arm` is nonetheless spelled `4c`,
  --            not `4`, and that is MEASURED: `arm` is matched against the
  --            literal inside `TEST FAILED (…)`, and no raise in this file is
  --            named `4`. Spelled `4`, the run reports `WRONG-ARM(4c)` (observed
  --            2026-09-05). Section folding applies to the DENOMINATOR the
  --            runner counts, never to the identity it reads.
  -- RED-UNDER-M: {"arm":"4c","apply":[{"kind":"edit","file":"supabase/migrations/20260802120000_strategy_analytics_stuck_computing_reaper.sql","find":"           ELSE 'complete'","replace":"           ELSE 'complete_with_warnings'","occurrences":1}]}
  IF v_status IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'TEST FAILED (4c): all jobs done did not resolve to complete (got %).', v_status;
  END IF;
  -- RED-UNDER: leave a live reaper key on a TERMINAL row -- write
  --            `computing_started_at = clock_timestamp()` in branch (c)'s exit
  --            (nth 2; nth 1 is branch (b)'s 11-space line, which Part 5 owns) --
  --            and neutralise trigger arm (d), which clears the key on every exit
  --            and would otherwise repair the branch silently.
  --            ⚠️ `clock_timestamp()` rather than `now()` deliberately: `= now()`
  --            is the byte sequence Part 1a's negative anchor and STEP 7 both
  --            refuse, so it would fire 1/JOB-01 first and never reach Part 4.
  --            Branch (b) keeps its own `= NULL`, so 1/JOB-01's positive anchor
  --            still finds a match and stays green.
  -- RED-UNDER-M: {"arm":"4c/JOB-01","apply":[{"kind":"edit","file":"supabase/migrations/20260802120000_strategy_analytics_stuck_computing_reaper.sql","find":"         computing_started_at = NULL,","replace":"         computing_started_at = clock_timestamp(),","occurrences":2,"nth":2},{"kind":"edit","file":"supabase/migrations/20260803120000_strategy_analytics_stamp_trigger_null_stamp_clock_start.sql","find":"    NEW.computing_started_at := NULL;","replace":"    NULL;","occurrences":1}]}
  IF v_stamp IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (4c/JOB-01): branch (c) left computing_started_at set on a TERMINAL row (got %). A stale stamp on a terminal row is exactly what the reaper could later re-fire on.', v_stamp;
  END IF;

  RAISE NOTICE 'Part 4 OK: transition into computing stamps; a second bridge call on an already-computing row keeps the sentinel (SC-2b); branch (c) clears the stamp on terminal resolution.';

  DELETE FROM auth.users WHERE id = v_user;
END
$$;
ROLLBACK;

-- ==========================================================================
-- Part 5 -- branch (b) exit clear, driven through the REAL
-- mark_compute_job_failed RPC with p_error_kind='permanent' (which forces
-- failed_final regardless of attempts). Branch (b) is the OTHER SQL exit
-- transition; Part 1's `computing_started_at = NULL` anchor is only its
-- structural twin, so this proves it behaviorally. Rolls back unconditionally.
-- ==========================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$
DECLARE
  v_user   uuid := gen_random_uuid();
  v_strat  uuid;
  v_job    uuid := gen_random_uuid();
  v_token  uuid := gen_random_uuid();
  v_status TEXT;
  v_stamp  TIMESTAMPTZ;
BEGIN
  INSERT INTO auth.users (id, email)
    VALUES (v_user, 'sa-reaper-failclear-' || v_user || '@invalid.local');
  INSERT INTO public.profiles (id, display_name)
    VALUES (v_user, 'sa-reaper-failclear') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.strategies (user_id, name)
    VALUES (v_user, 'sa-reaper-failclear-strat') RETURNING id INTO v_strat;

  -- Mid-run: computing, with a live stamp.
  INSERT INTO public.strategy_analytics
    (strategy_id, computation_status, computation_warned, computing_started_at)
  VALUES (v_strat, 'computing', FALSE, now() - interval '1 hour');

  INSERT INTO public.compute_jobs
    (id, kind, strategy_id, status, priority, attempts, next_attempt_at, claim_token, claimed_at)
  VALUES (v_job, 'compute_analytics_from_csv', v_strat, 'running', 'normal', 1, now(), v_token, now());

  PERFORM public.mark_compute_job_failed(v_job, 'permanent derive failure', 'permanent', v_token);

  SELECT computation_status, computing_started_at INTO v_status, v_stamp
    FROM public.strategy_analytics WHERE strategy_id = v_strat;
  -- RED-UNDER: make branch (b) resolve a NON-SUPERSEDED failed_final to
  --            'complete' -- replace `SET computation_status =
  --            EXCLUDED.computation_status` with the literal in the 20260802120000
  --            re-base. A permanent failure then renders as a clean success on
  --            every surface that reads computation_status, which is the
  --            false-success class this file's SI-02 arms exist to refuse, reached
  --            through the OTHER exit branch.
  --            ⚠️ Branch (b) is the only one of the three that writes EXCLUDED
  --            rather than a CASE, so the needle is unique and Parts 2, 3 and 4
  --            (which never take branch (b)) all stay green.
  -- RED-UNDER-M: {"arm":"5","apply":[{"kind":"edit","file":"supabase/migrations/20260802120000_strategy_analytics_stuck_computing_reaper.sql","find":"       SET computation_status = EXCLUDED.computation_status,","replace":"       SET computation_status = 'complete',","occurrences":1}]}
  IF v_status IS DISTINCT FROM 'failed' THEN
    RAISE EXCEPTION 'TEST FAILED (5): a non-superseded failed_final did not resolve the strategy to failed (got %).', v_status;
  END IF;
  -- RED-UNDER: the branch-(b) mirror of 4c/JOB-01 -- write
  --            `computing_started_at = clock_timestamp()` in branch (b)'s exit
  --            (nth 1, the 11-space line) and neutralise trigger arm (d). A
  --            terminal 'failed' row then keeps the key the reaper fires on, so
  --            the next tick can re-terminalize a row it already terminalized.
  --            ⚠️ Branch (c) keeps its `= NULL`, which is what leaves Part 4c green
  --            and Part 1a's positive anchor satisfied -- the two exit branches
  --            are twinned separately on purpose, because a single anchor over the
  --            whole functiondef cannot tell which one lost the clear.
  -- RED-UNDER-M: {"arm":"5/JOB-01","apply":[{"kind":"edit","file":"supabase/migrations/20260802120000_strategy_analytics_stuck_computing_reaper.sql","find":"           computing_started_at = NULL,","replace":"           computing_started_at = clock_timestamp(),","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260803120000_strategy_analytics_stamp_trigger_null_stamp_clock_start.sql","find":"    NEW.computing_started_at := NULL;","replace":"    NULL;","occurrences":1}]}
  IF v_stamp IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (5/JOB-01): branch (b) left computing_started_at set on a TERMINAL failed row (got %). Every exit from computing must clear the stamp, or the reaper can re-fire on a row it already terminalized.', v_stamp;
  END IF;

  RAISE NOTICE 'Part 5 OK: branch (b) terminal failure clears computing_started_at.';

  DELETE FROM auth.users WHERE id = v_user;
END
$$;
ROLLBACK;

-- ==========================================================================
-- Part 6 -- G1, the STAMP TRIGGER sentinel. Oracle for migration
-- 20260803120000_strategy_analytics_stamp_trigger_null_stamp_clock_start.sql:
-- function strategy_analytics_stamp_computing_started, trigger
-- strategy_analytics_stamp_computing_started_trigger. Rolls back
-- unconditionally.
--
-- WHY THIS PART EXISTS (Rule 9 -- the WHY, not just the WHAT)
-- ----------------------------------------------------------
-- That trigger COERCES SILENTLY and never raises. Raising would kill the live
-- analytics_runner _mark_computing call, burn its three retries and strand the
-- strategy, so silence is the deliberate, bounded cost of moving the stamp
-- invariant off every individual writer and onto the TABLE (D-17). It is
-- accepted ONLY because this part makes the coercion observable: without Part 6
-- the trigger predicate would be UNFALSIFIABLE -- a gate that cannot fail, which
-- is the exact class Phase 142.1 exists to kill. Each arm reddens under the
-- deletion of exactly ONE trigger arm:
--   6a  a Python-writer-shaped write cannot ADVANCE a seeded sentinel  (arm (a))
--   6b  a write that leaves a computing row unclocked gets it clocked  (arm (b))
--   6c  a terminal transition CLEARS the clock the writer supplied     (arm (d))
--
-- UNGATED, like Part 4 and for the same reason. This part needs only the trigger
-- -- no pg_cron, no bridge RPC -- so an unapplied 20260803120000 must be a RED
-- here, never a skip. There is deliberately NO early-exit arm anywhere in this
-- block: Parts 2 and 3, which depend on the deployed cron body, are the only
-- legitimate skips in this file (see the ANTI-GREEN-SKIP CONTRACT in the header).
--
-- STATE IS ESTABLISHED AT INSERT, NEVER BY UPDATE-ING A COMPUTING ROW -- the
-- same D-18 part 2 discipline Part 4 was retrofitted to (see its header). The
-- trigger is bound BEFORE UPDATE only, so both seeds below land verbatim; an
-- UPDATE could install neither of them. In particular 6b's (computing, no clock)
-- state is seeded DIRECTLY. The transition-out-then-back-in dance an earlier
-- draft carried is SUPERSEDED and must not be restored: it existed only to reach
-- a state that the superseded insert-firing trigger sketch made unreachable.
--
-- FROZEN CLOCK (see the FROZEN-CLOCK TRAP note in the file header). now() is
-- CONSTANT for the whole transaction, so "write now() and compare the result to
-- now()" CANNOT FAIL. The three-hour-old sentinel is the entire falsifiability
-- of 6a. The offset literal is written TWICE on purpose -- once in row A's seed
-- and once in v_sentinel -- so the S-2 seed-integrity control compares two
-- INDEPENDENTLY WRITTEN expressions rather than a value against itself; they are
-- exactly equal only because now() is frozen, and a divergence reddens loudly.
--
-- ⛔ This part drives the trigger with DIRECT writes. It must never route through
-- mark_compute_job_done / the status bridge -- Part 4 already owns that oracle,
-- and a bridge-driven Part 6 would prove the two mechanisms together rather than
-- the trigger alone, which is precisely the double-mutation weakness the Part 4
-- header warns about.
-- ==========================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$
DECLARE
  v_user     uuid := gen_random_uuid();
  v_strat_a  uuid;   -- seeded (computing, sentinel) -> 6a never-advance, 6c exit-clear
  v_strat_b  uuid;   -- seeded (computing, no clock) -> 6b clock-start closure
  v_status   TEXT;
  v_stamp    TIMESTAMPTZ;
  v_sentinel TIMESTAMPTZ := now() - interval '3 hours';
BEGIN
  -- FK chain: strategy_analytics.strategy_id -> strategies.id -> profiles.id ->
  -- auth.users.id, as in Parts 2/3/4/5.
  INSERT INTO auth.users (id, email)
    VALUES (v_user, 'sa-stamp-trigger-' || v_user || '@invalid.local');
  INSERT INTO public.profiles (id, display_name)
    VALUES (v_user, 'sa-stamp-trigger') ON CONFLICT (id) DO NOTHING;

  -- TWO strategies: strategy_analytics is one row per strategy, and 6a's row must
  -- KEEP its sentinel for the whole part while 6b's must start with no clock at
  -- all. One row cannot hold both states.
  INSERT INTO public.strategies (user_id, name)
    VALUES (v_user, 'sa-stamp-trigger-a') RETURNING id INTO v_strat_a;
  INSERT INTO public.strategies (user_id, name)
    VALUES (v_user, 'sa-stamp-trigger-b') RETURNING id INTO v_strat_b;

  -- Row A: already computing, clocked three hours back. Seeded at INSERT, where
  -- the trigger by design does not fire, so the sentinel lands verbatim.
  INSERT INTO public.strategy_analytics
    (strategy_id, computation_status, computation_warned, computing_started_at)
  VALUES (v_strat_a, 'computing', FALSE, now() - interval '3 hours');

  -- Row B: computing with NO clock -- the state the UPDATE-path half of D-11 is
  -- about. Seeded DIRECTLY at INSERT (D-18 part 2); no dance, no setup UPDATE.
  INSERT INTO public.strategy_analytics
    (strategy_id, computation_status, computation_warned, computing_started_at)
  VALUES (v_strat_b, 'computing', FALSE, NULL);

  -- ----- S-2 seed-integrity controls, BEFORE any driver ---------------------
  -- A broken seed must not green this part vacuously. These run first precisely
  -- because every assertion below is a comparison against the seeded state.
  SELECT computation_status, computing_started_at INTO v_status, v_stamp
    FROM public.strategy_analytics WHERE strategy_id = v_strat_a;
  -- RED-UNDER: break the seed this control guards -- move row A's INSERT stamp
  --            from `now() - interval '3 hours'` to `now() - interval '4 hours'`,
  --            so it no longer equals v_sentinel.
  --            ⛔ The mutation targets the GATE, not a migration, and that is the
  --            honest falsifier rather than a shortcut: this arm makes no claim
  --            about production. It exists because the FROZEN-CLOCK note above
  --            writes the three-hour offset TWICE -- once in this seed and once in
  --            v_sentinel -- specifically so the control compares two
  --            INDEPENDENTLY WRITTEN expressions instead of a value against
  --            itself. A divergence between those two literals is precisely the
  --            broken fixture the raise names, and 6a and 6c below would be
  --            vacuous under it. Gate-file steps are grammar-legal (rule 3b still
  --            forbids touching any failure branch, and this needle is a seed).
  -- RED-UNDER-M: {"arm":"6/seed A/D-18","apply":[{"kind":"edit","file":"supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql","find":"computing_started_at)\n  VALUES (v_strat_a, 'computing', FALSE, now() - interval '3 hours');","replace":"computing_started_at)\n  VALUES (v_strat_a, 'computing', FALSE, now() - interval '4 hours');","occurrences":1}]}
  IF v_status IS DISTINCT FROM 'computing' OR v_stamp IS DISTINCT FROM v_sentinel THEN
    RAISE EXCEPTION 'TEST FAILED (6/seed A/D-18): row A did not land at computing with the three-hour-old sentinel (got status %, stamp %, expected sentinel %). The trigger fires on UPDATE only, so this INSERT must land verbatim; if it did not, 6a and 6c below would be vacuous. This is a broken fixture, not a finding about the trigger.', v_status, v_stamp, v_sentinel;
  END IF;

  SELECT computation_status, computing_started_at INTO v_status, v_stamp
    FROM public.strategy_analytics WHERE strategy_id = v_strat_b;
  -- RED-UNDER: seed row B WITH a clock -- `now()` instead of NULL -- so the
  --            (computing, no clock) state 6b needs is never established.
  --            ⛔ A gate-file step for the same reason as 6/seed A/D-18: the raise
  --            claims the state was not reachable at INSERT, and the only thing
  --            that can make that true is an INSERT that supplies a stamp. The
  --            production reading of the same failure -- a trigger that fired on
  --            the insert path after all -- is NOT reachable as a mutation here:
  --            widening the trigger to INSERT makes PL/pgSQL raise `record "old"
  --            is not assigned yet` on its first OLD read, a raw driver error that
  --            names no arm, and STEP 3 of 20260803120000 aborts the apply on the
  --            tgtype before that. The seed edit is what remains, and it is what
  --            the arm actually asserts.
  -- RED-UNDER-M: {"arm":"6/seed B/D-18","apply":[{"kind":"edit","file":"supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql","find":"computing_started_at)\n  VALUES (v_strat_b, 'computing', FALSE, NULL);","replace":"computing_started_at)\n  VALUES (v_strat_b, 'computing', FALSE, now());","occurrences":1}]}
  IF v_status IS DISTINCT FROM 'computing' OR v_stamp IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (6/seed B/D-18): row B did not land at computing with no clock (got status %, stamp %). That state must be reachable at INSERT -- it is the whole reason the trigger is bound to UPDATE only -- or 6b below proves nothing.', v_status, v_stamp;
  END IF;

  -- ----- 6a: NEVER ADVANCE (trigger arm (a); D-01; ledger row SC-17/01) -----
  -- Shaped like the Python writer's upsert conflict path: it names the status the
  -- row is already at AND supplies its own clock. Arm (a) discards the supplied
  -- value and restores the original start time. Falsifiability lives entirely in
  -- the three-hour offset -- against a row seeded at the frozen now(), a driver
  -- writing that same frozen now() could never be caught.
  UPDATE public.strategy_analytics
     SET computation_status = 'computing',
         computing_started_at = now()
   WHERE strategy_id = v_strat_a;

  SELECT computation_status, computing_started_at INTO v_status, v_stamp
    FROM public.strategy_analytics WHERE strategy_id = v_strat_a;
  -- RED-UNDER: have 6a's driver name a status other than computing -- `SET
  --            computation_status = 'failed'` in the row-A UPDATE above.
  --            ⛔ A gate-file step, and again the arm's own claim is what forces
  --            it: this raise is not about the trigger, it is about whether the
  --            DRIVER established the precondition the never-advance assertion
  --            needs. A driver that names a terminal status is exactly that
  --            failure. The production route -- a trigger arm that writes
  --            NEW.computation_status -- was rejected on measurement, not taste:
  --            it is arm (a), so it fires on Part 4's mid-chain bridge hop first
  --            and reddens section 4 instead, and clearing the way needs a
  --            cascade of neuters through 4a, 4b and 4b/SC-2b that would make
  --            this arm's verdict depend on five suppressions.
  -- RED-UNDER-M: {"arm":"6a/G1","apply":[{"kind":"edit","file":"supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql","find":"     SET computation_status = 'computing',\n         computing_started_at = now()\n   WHERE strategy_id = v_strat_a;","replace":"     SET computation_status = 'failed',\n         computing_started_at = now()\n   WHERE strategy_id = v_strat_a;","occurrences":1}]}
  IF v_status IS DISTINCT FROM 'computing' THEN
    RAISE EXCEPTION 'TEST FAILED (6a/G1): row A left computing under a driver that named computing (got %); the never-advance assertion below would be vacuous.', v_status;
  END IF;
  -- RED-UNDER: delete trigger arm (a) -- replace `NEW.computing_started_at :=
  --            OLD.computing_started_at;` in 20260803120000 with a no-op. The
  --            Python-writer-shaped UPDATE then advances the clock on a row that
  --            was already computing and already clocked, so the clock measures
  --            the last hop instead of the whole chain, the reaper's 16-hour
  --            threshold is pushed forward on every hop, and the worst-case
  --            stranded spinner runs about 1.75x the advertised bound.
  --            ⚠️ This is a SINGLE-step twin where 4b's is two, and the asymmetry
  --            is the point: Part 4b is defended by the bridge's Arm 3 as well, so
  --            deleting arm (a) alone leaves 4b green and lets this arm be the
  --            first failure. MEASURED, and it is what makes 6a the
  --            single-mutation observable the Part 4 header says 4b is not.
  -- RED-UNDER-M: {"arm":"6a/G1/D-01/SC-17-01","apply":[{"kind":"edit","file":"supabase/migrations/20260803120000_strategy_analytics_stamp_trigger_null_stamp_clock_start.sql","find":"      NEW.computing_started_at := OLD.computing_started_at;","replace":"      NULL;","occurrences":1}]}
  IF v_stamp IS DISTINCT FROM v_sentinel THEN
    RAISE EXCEPTION 'TEST FAILED (6a/G1/D-01/SC-17-01): a direct write ADVANCED computing_started_at on a row that was ALREADY computing and ALREADY clocked (expected the sentinel %, got %). The clock must measure the WHOLE job chain, not its last hop: otherwise every hop pushes it forward, the reaper can never fire, and the worst-case stranded spinner runs about 1.75x the advertised bound. No per-writer rule can hold this -- it binds a writer only if it lives on the table.', v_sentinel, v_stamp;
  END IF;

  -- ----- 6b: CLOCK-START CLOSURE (trigger arm (b); the UPDATE-path half of D-11)
  -- The driver supplies no clock key and the row carries no clock, so it enters
  -- the trigger unclocked. Arm (b) is what stops a computing row from sitting
  -- unclocked after a write: such a row is invisible to the reap arm forever, and
  -- no STATIC gate can ever see it, because a source scan cannot see rows.
  -- ⚠️ This closes the UPDATE path ONLY. Rows that ALREADY sit unclocked, or that
  -- arrive on the insert path the trigger does not see, are the companion cron
  -- arm's job (Part 2 arm D). The trigger subsumes NONE of D-11 (correction C-1)
  -- -- do not let this arm's green be read as covering that population.
  UPDATE public.strategy_analytics
     SET computation_status = 'computing'
   WHERE strategy_id = v_strat_b;

  SELECT computation_status, computing_started_at INTO v_status, v_stamp
    FROM public.strategy_analytics WHERE strategy_id = v_strat_b;
  -- RED-UNDER: the row-B mirror of 6a/G1 -- have 6b's driver name 'failed'
  --            instead of 'computing', so the clock-start assertion below would be
  --            asserting about a row that is not computing at all. Gate-file step,
  --            same reasoning as 6a/G1; 6a's own arms are untouched and pass
  --            first, which is what proves this mutation is scoped to row B.
  -- RED-UNDER-M: {"arm":"6b/G1","apply":[{"kind":"edit","file":"supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql","find":"     SET computation_status = 'computing'\n   WHERE strategy_id = v_strat_b;","replace":"     SET computation_status = 'failed'\n   WHERE strategy_id = v_strat_b;","occurrences":1}]}
  IF v_status IS DISTINCT FROM 'computing' THEN
    RAISE EXCEPTION 'TEST FAILED (6b/G1): row B left computing under a driver that named computing (got %); the clock-start assertion below would be vacuous.', v_status;
  END IF;
  -- RED-UNDER: delete trigger arm (b) -- replace `NEW.computing_started_at :=
  --            now();` with a no-op -- so an UPDATE that leaves a computing row
  --            unclocked is allowed to. Such a row is invisible to the reap arm
  --            forever AND to every static gate, because a source scan cannot see
  --            rows: its spinner is permanent and silent.
  --            ⚠️ Arm (b) is genuinely unreached by everything before Part 6 --
  --            Part 2's clock-start UPDATE and Part 4's bridge hop both arrive
  --            with a non-NULL NEW stamp -- so this single step reddens here and
  --            nowhere earlier. MEASURED.
  -- RED-UNDER-M: {"arm":"6b/G1/D-11","apply":[{"kind":"edit","file":"supabase/migrations/20260803120000_strategy_analytics_stamp_trigger_null_stamp_clock_start.sql","find":"      NEW.computing_started_at := now();","replace":"      NULL;","occurrences":1}]}
  IF v_stamp IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (6b/G1/D-11): a write left a computing row with NO computing_started_at and the trigger did not start its clock. That row is invisible to the reap arm forever AND to every static gate, so its spinner is permanent and silent -- the exact population this phase exists to make detectable.';
  END IF;
  IF v_stamp < now() THEN
    RAISE EXCEPTION 'TEST FAILED (6b/G1/D-11): the trigger started the clock in the PAST (got %, transaction now() is %). A back-dated start time is WORSE than none: the staleness threshold can already be exceeded the instant the clock starts, so the next reaper tick terminalizes a healthy in-flight chain.', v_stamp, now();
  END IF;

  -- ----- 6c: EXIT CLEAR (trigger arm (d)) -----------------------------------
  -- The driver deliberately does the wrong thing: it supplies a non-NULL clock on
  -- a TERMINAL transition. Arm (d) clears unconditionally, so no writer can leave
  -- a stale start time on a terminal row -- which is exactly what the reaper
  -- could later re-fire on. Row A is reused: it is still carrying its sentinel,
  -- which makes the clear visible against a real prior value.
  UPDATE public.strategy_analytics
     SET computation_status = 'failed',
         computing_started_at = now() - interval '1 hour'
   WHERE strategy_id = v_strat_a;

  SELECT computation_status, computing_started_at INTO v_status, v_stamp
    FROM public.strategy_analytics WHERE strategy_id = v_strat_a;
  -- RED-UNDER: have 6c's driver stay at 'computing' instead of making the
  --            terminal transition, so the exit-clear assertion below would never
  --            see an exit. Gate-file step, same class as 6a/G1 and 6b/G1: the
  --            raise is about whether the driver landed, not about the trigger.
  --            ⚠️ Under this mutation row A is still carrying its sentinel from 6a,
  --            and trigger arm (a) restores it -- so the arm reddens on the STATUS
  --            it names rather than incidentally on the stamp.
  -- RED-UNDER-M: {"arm":"6c/G1","apply":[{"kind":"edit","file":"supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql","find":"     SET computation_status = 'failed',\n         computing_started_at = now() - interval '1 hour'\n   WHERE strategy_id = v_strat_a;","replace":"     SET computation_status = 'computing',\n         computing_started_at = now() - interval '1 hour'\n   WHERE strategy_id = v_strat_a;","occurrences":1}]}
  IF v_status IS DISTINCT FROM 'failed' THEN
    RAISE EXCEPTION 'TEST FAILED (6c/G1): the terminal driver did not land on row A (got %); the exit-clear assertion below would be vacuous.', v_status;
  END IF;
  -- RED-UNDER: delete trigger arm (d) -- replace `NEW.computing_started_at :=
  --            NULL;` with a no-op -- so the stale clock 6c's driver deliberately
  --            supplies on the way out SURVIVES on a terminal row. That is the
  --            one case no per-writer rule can cover, and it is exactly what the
  --            reaper could later re-fire on.
  --            ⚠️ A single step reaches this arm even though 2/arm A/JOB-01, 4c and
  --            5 all also depend on arm (d): each of those three has its OWN
  --            explicit `computing_started_at = NULL` in the cron body or the
  --            bridge, so with arm (d) silent they still write NULL and stay
  --            green. 6c is the only place where the WRITER supplies a non-NULL
  --            clock and nothing else clears it. MEASURED.
  -- RED-UNDER-M: {"arm":"6c/G1/JOB-01","apply":[{"kind":"edit","file":"supabase/migrations/20260803120000_strategy_analytics_stamp_trigger_null_stamp_clock_start.sql","find":"    NEW.computing_started_at := NULL;","replace":"    NULL;","occurrences":1}]}
  IF v_stamp IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (6c/G1/JOB-01): a row LEAVING computing kept the computing_started_at its writer supplied (got %). Every exit must clear the reaper key at the table, or the reaper re-fires on a row it already terminalized -- and a writer that supplies a stale clock on the way out is the one case no per-writer rule can cover.', v_stamp;
  END IF;

  RAISE NOTICE 'Part 6 OK: the stamp trigger never advances the clock on an already-clocked computing row (6a), starts the clock when a write leaves a computing row unclocked (6b), and clears it on exit even when the writer supplies one (6c).';

  DELETE FROM auth.users WHERE id = v_user;
END
$$;
ROLLBACK;
