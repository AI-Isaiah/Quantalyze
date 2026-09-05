-- Test: retention_compute_jobs_orphaned_running -- the orphaned-`running`
-- TERMINALIZER (JOB-05 / WR-02, Phase 144; WORKER-04 / RT-01 heritage).
--
-- Guards migration
-- 20260817120000_retention_orphaned_running_terminalize.sql: the pg_cron job
-- retention_compute_jobs_orphaned_running, its '50 * * * *' cadence, its TWO
-- arms (claimed_at past the UNCHANGED 4-hour window; claimed_at IS NULL past a
-- derived 48-hour window), the four-column terminal SET list, and the per-arm
-- LIMIT 100 bound.
--
-- It supersedes the assertions this file carried for
-- 20260719120000_retention_orphaned_running_compute_jobs.sql and its RT-01 window
-- correction 20260720120000_retention_orphaned_running_window_4h.sql. Those two
-- migrations are NOT edited and are still applied; only the DEPLOYED BODY under
-- this jobname changed, and this file follows the body.
--
-- Why this cron exists (Rule 9 -- the WHY, not just the WHAT)
-- ----------------------------------------------------------
-- The `derive-allocator-key-dailies` cron (mig 20260717233529) re-pollutes the
-- WORKERLESS test project daily with `running` compute_jobs (a workerless project
-- never advances them past claim). Those orphaned rows collide with fence-test
-- seeds via the claim RPC's partition-dedupe arms (mig 20260719073701:159-179:
-- the NOT-EXISTS guards keyed on `x.status IN ('running','done_pending_children')`),
-- reddening the `python` fence tests intermittently. The derive cron CANNOT be
-- unscheduled (`test_derive_allocator_keys_fanout.sql` assertion 6 requires it
-- registered), so the only root-cause fix is a scheduled janitor.
--
-- ⚠️ TERMINAL UPDATE, not removal -- and this REPLACES the rationale this file
-- used to carry. The superseded version argued "DELETE, never reset-to-pending:
-- only removal ends the daily re-pollution", and it deferred the tradeoff to a
-- founder decision "resolved at FLIP-01 go-live". Phase 144 IS that resolution,
-- and the premise was too narrow: a row moved to `failed_final` ends the daily
-- re-pollution just as removal did, because failed_final leaves BOTH the claim
-- RPC's partition-dedupe predicate (20260719073701:159-179) and the claimable set
-- (:204), so it can never be re-claimed. Removal also cost three things a
-- terminal row keeps:
--   * the wizard poller gets an OUTCOME to break out on -- failed_final is in
--     FINISHED_JOB_STATUSES (SyncPreviewStep.tsx:207-214) and the sync-progress
--     route projects `status` and nothing else (route.ts:284,294);
--   * the AUDIT TRAIL survives to the 90-day retention wall;
--   * Phase 142's reaper is UNBLOCKED -- its arms exclude any strategy holding a
--     job in ('pending','running','done_pending_children','failed_retry')
--     (20260803130000:118-121, :139-142), and failed_final is the only
--     terminal-failure value outside that set.
-- Reset-to-`pending` stays rejected: `pending` is claimable, so it re-opens the
-- very flake this cron exists to close.
--
-- The 4-hour window is UNCHANGED and that is deliberate (SC#2). RT-01's corrected
-- basis: a full batch of 5 claimed jobs (main_worker p_batch_size=5) shares ONE
-- claim-time `claimed_at` and dispatches SEQUENTIALLY, so job #5 on a HEALTHY
-- worker can be legitimately in flight with a claim stamp up to 5 x 30 min = 2.5 h
-- old. A 4-hour window clears that ceiling with margin, and it does NOT depend on
-- the watchdog firing (whose silent failure was the hole in the original 2h
-- rationale). Part 2 arm B carries that regression forward behaviourally.
--
-- ORACLE DISCIPLINE (the load-bearing property of this file)
-- ---------------------------------------------------------
-- Parts 2 and 3 read the REAL deployed body out of cron.job.command and
-- `EXECUTE v_command` it. They NEVER re-type the predicate. A gate that
-- re-implements the predicate passes when the DEPLOYED predicate is wrong --
-- which is exactly how every gate in phases 142/142.1 passed over a bound that
-- did not exist (D-19). Only executing the deployed body against real rows
-- falsifies it.
--
-- ANTI-GREEN-SKIP CONTRACT (read this before adding any presence gate)
-- -------------------------------------------------------------------
-- Part 1 is DELIBERATELY UNGATED and MUST FAIL when migration 20260817120000 is
-- unapplied. That is this file's TDD RED, and it is designed to arrive on the
-- PR's FIRST sql-tests run, before the migration reaches the TEST project.
-- ⛔ This file USED to open with two presence gates that `RAISE NOTICE ... RETURN`
-- and thereby no-op'd the ENTIRE file when the migration had not landed. Phase
-- 143 names that shape as the anti-pattern by path and line
-- (test_reconcile_dropped_enqueue_sweep.sql:41-44) -- and it names THIS FILE. A
-- gate that green-skips when the object under test is absent is not evidence, so
-- both gates are gone and must not come back.
--
-- Parts 2-3 skip on ONE condition only: a genuinely absent pg_cron extension
-- (local dev). A cron job that is MISSING while pg_cron is PRESENT is an
-- EXCEPTION, never a skip.
--
-- TRANSACTION FRAMING (per-part only -- do not "simplify" this)
-- ------------------------------------------------------------
-- Every part that writes opens its OWN `BEGIN;`, immediately sets
-- `SET LOCAL lock_timeout = '5s'`, and closes with `ROLLBACK;`. There is NO outer
-- whole-file transaction, and adding one would be a silent data hazard: psql's
-- nested BEGIN emits a warning and creates NO savepoint, so the FIRST inner
-- rollback would end the outer transaction and every later part would AUTOCOMMIT
-- its seeds onto the SHARED test project. (This file used to use the whole-file
-- frame; 143's per-part frame supersedes it.)
--
-- SHARED-TEST-DB ISOLATION (isolation by construction)
-- ---------------------------------------------------
-- The deployed arms are GLOBAL `ORDER BY <claim/creation time> ASC LIMIT 100`
-- scans over public.compute_jobs. Foreign rows on the shared TEST project compete
-- with these seeds for the 100-row budget, and unlike Phase 143's sweep that
-- competition is REAL and MEASURED: the 2026-08-17 census found 402 `running`
-- rows on TEST (396 claimed derive_broker_dailies + 6 NULL-claim poll_positions).
--
-- This file does NOT neutralize them, and must never be "fixed" to. The three
-- cross-tenant neutralizing UPDATEs the 142 gate once carried were DELETED in
-- Phase 142.1 (D-05 / D-18) because they wrote across every OTHER tenant's rows on
-- a shared project. Isolation here is BY CONSTRUCTION: every row this file needs
-- the janitor to terminalize is seeded a CENTURY back, which sorts ahead of any
-- plausible foreign candidate under the deployed ORDER BY, so the seeds win the
-- budget without this file touching a single row it does not own.
--
-- ⚠️ RESIDUAL, stated rather than hidden: because TEST really does hold hundreds
-- of eligible foreign rows, each `EXECUTE` inside Parts 2 and 3 will also
-- terminalize up to 100 of them and hold row locks on them until the part's
-- ROLLBACK. Nothing is committed -- the ROLLBACK discards every one of those
-- writes -- and the `sql-tests` CI job carries the repo-wide `shared-test-db`
-- concurrency group, so two gate runs cannot overlap. A REAL pg_cron tick firing
-- at :50 during a run is harmless in both directions: it holds FOR UPDATE
-- SKIP LOCKED, so it skips whatever this file has locked and takes it next tick.
--
-- Every count and every status read below is SCOPED to the part's own seeded ids
-- (`= ANY (v_seeded)`, or an identity comparison against one seeded id) -- never a
-- global count and never a global empty state. That is this project's recorded
-- lesson from the e2e-seeded shared-DB pollution fix: assert your OWN seed
-- invariant.
--
-- BACKDATE, NEVER SLEEP; AND NEVER COMPARE TWO now()s
-- --------------------------------------------------
-- There are no sleeps anywhere in this file. A 4-hour or 48-hour threshold is not
-- testable by sleeping; `claimed_at`, `created_at` and `next_attempt_at` are all
-- directly INSERT-writable on compute_jobs, so every age is seeded.
--
-- FROZEN CLOCK: each part runs inside ONE transaction, so now() is CONSTANT for
-- the whole part. Never assert by comparing two now()-derived values -- they are
-- equal by construction and such an assertion CANNOT FAIL. The B3 assertion below
-- therefore compares the post-tick `next_attempt_at` against the CENTURY-BACKDATED
-- SEED value, which is a comparison that can genuinely fail.
--
-- ⛔ WHAT THIS FILE CANNOT PROVE -- do not let a green here be read as covering it
-- -------------------------------------------------------------------------------
--   THE CRON ROLE'S RLS POSTURE. public.compute_jobs carries FORCE ROW LEVEL
--   SECURITY with a deny-all policy (20260516104201:209, 20260411144407:233-239);
--   FORCE exists specifically to close the table-owner bypass. Whether the pg_cron
--   JOB ROLE writes through it is a property of THAT ROLE, and the sql-tests job
--   connects as a different one. ✅ Phase 143 already discharged this by a REAL
--   live tick (cron.job.username = postgres, rolbypassrls = TRUE;
--   20260816140000:367-383) and 144 INHERITS that result rather than re-litigating
--   it -- but the inheritance is an inference about a role, not an observation of
--   THIS job, so Phase 144 Plan 03 re-observes one real tick before merge.
--
-- pgTAP is NOT installed in this project (CLAUDE.md), so assertions
-- RAISE EXCEPTION on failure and a clean run prints NOTICEs only. Under
-- psql -v ON_ERROR_STOP=1 a failed assertion exits non-zero. Every RAISE format
-- string is a single literal with % placeholders (no concatenation).
--
-- ⚠️ NO psql BACKSLASH META-COMMANDS ANYWHERE IN THIS FILE, and this paragraph
-- deliberately does NOT spell any of them out. The sql-tests preflight
-- (ci.yml:951-1000) greps every supabase/tests/test_*.sql for them and it scans
-- the WHOLE FILE, comments included, so naming them here would make this gate
-- refuse ITSELF. Read ci.yml for the list.
--
-- No fixed UUID literals -- every id is gen_random_uuid(), because this file runs
-- against the SHARED test project concurrently with other PRs.
--
-- ⛔ DO NOT add this cron to supabase/tests/test_retention_crons_safe.sql. That
-- file is a retention-DELETE register: its expected_jobs loop asserts every listed
-- body matches a created_at-keyed removal shape, and this two-arm terminal UPDATE
-- does not have one (arm A keys on claimed_at, and neither arm removes anything).
-- Adding it would make that register look complete while pinning nothing this
-- phase cares about, and it would red on a body that is correct.
--
-- ⚠️ THE COUNTS IN PART 1 ARE SIBLINGS of the migration's own STEP 2 self-verify
-- (20260817120000) and of the file-text gate Phase 144 Plan 02 adds under
-- src/__tests__. If a future edit legitimately changes how many times the body
-- names a token, ALL of them move in the SAME commit. A one-file scope amendment
-- leaves a gate guarding a superseded body while staying green.
--
-- Usage:
--   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_retention_orphaned_running.sql
--
-- Run order: AFTER migration 20260817120000 is applied to the project. Before
-- that, Part 1 REDs by design.
--
-- ⭐ MACHINE-EXECUTABLE TWINS (phase 164.4.1, PGCRON-LANE). Each prose
-- RED-UNDER below carries an adjacent `RED-UNDER-M` object that
-- scripts/mutation-runner executes on every push: it mutates COPIES on a
-- throwaway pg-lane cluster, requires the FIRST `TEST FAILED (…)` to name that
-- arm, and restores GREEN. Schema: scripts/mutation-runner/GRAMMAR.md.
--
-- ⛔ ORACLE SCOPE ON THE LANE -- read this before reading any twin below.
-- Parts 2 and 3 read the deployed body out of cron.job.command and EXECUTE it.
-- On the TEST project that body was written by a DEPLOYMENT, so those arms
-- detect DRIFT between this repo and that project. ON THE PG-LANE the body is
-- written by the apply list on the line below, so they CANNOT detect drift
-- there and no green run of this file's twins may be read as evidence that
-- there is none. What the lane proves is FALSIFIABILITY: that every assertion
-- has a production change under which it fires FIRST and names itself. Repo
-- vs. TEST drift is judged by VAC-08 in the sql-tests job, and repo vs. PROD by
-- VAC-04 in migration-drift-check; neither is this file's job.
-- ⚠️ FOUR migrations (re)schedule retention_compute_jobs_orphaned_running --
-- 20260719120000:95, 20260720120000:64, 20260817120000:602 and
-- 20260826140000:220 -- and cron.schedule UPSERTS BY NAME, so the row's body is
-- the LAST one applied. All four are in the list, in chronological order, so
-- the lane's cron.job.command is 20260826140000's body, which is the body TEST
-- holds. ⛔ CONSEQUENCE FOR EVERY BODY-TOKEN TWIN: the falsifier must edit
-- 20260826140000. An edit to 20260817120000's cron body is OVERWRITTEN by the
-- later cron.schedule and comes back `no-red` -- a wrong TARGET, never a reason
-- for a waiver.
--
-- ⚠️ THE APPLY LIST BELOW IS MEASURED, ENTRY BY ENTRY, BY ONE-OUT ABLATION on
-- real lanes (2026-09-05, `bash scripts/pg-lane/run.sh --workdir <scratch
-- OUTSIDE the repo> --apply <this list> --gate <this file>`; baseline exit 0,
-- all three Parts print their OK line). Seventeen of the twenty entries are
-- REQUIRED and each one's first error was read off the lane:
--   * 01/02/03-fixture -- the base schema chain (auth.users, profiles,
--     api_keys, portfolios, and api_keys' PK/label/api_key_encrypted).
--   * 20260513094906_enable_pg_cron -- FIRST among the cron migrations because
--     three of them RAISE on an absent extension. Without it the apply aborts
--     at 20260719120000:107 with `0A000: WORKER-04: pg_cron extension is NOT
--     installed` (20260817120000:558-565 and 20260826140000:206-209 raise the
--     same way, later).
--   * 20260411144407 -- compute_jobs itself; without it 20260418194206:87 dies
--     on `relation "compute_jobs" does not exist`.
--   * 15-fixture-auth-role -- 20260420073003:720, `auth.role() does not exist`.
--   * 21-fixture-api-keys-credential-columns -- 20260420073003:999, `column
--     "dek_encrypted" of relation "api_keys" does not exist`.
--   * 20-fixture-app-role-helper -- 20260420073003:711,
--     `current_user_has_app_role(text[]) does not exist`.
--   * 24-fixture-enqueue-compute-job-chain -- 20260420073003:315, `column
--     "sync_error" of relation "api_keys" does not exist`.
--   * 20260418194206 -- 20260420073003:253, `column "allocator_id" does not
--     exist`.
--   * 20260420073003 -- without it 20260614120000:92 dies on `column
--     "api_key_id" does not exist`, and it is ALSO the migration that widens
--     compute_jobs_target_xor to the 4-way form these api_key-scoped seeds
--     need (its own self-verify (d) at :786-792 pins that).
--   * 20260515114555 -- 20260516104201:976, mark_compute_job_done missing its
--     NOT EXISTS set-back arm.
--   * 20260516104201 -- 20260826140000:377, `42P13: cannot change return type
--     of existing function` on get_user_compute_jobs.
--   * 20260614120000 -- the derive_broker_dailies REGISTRY ROW. Without it the
--     gate's own seed dies at :652 on `23503 compute_jobs_kind_fkey`.
--   * 20260624120100 -- the api_key-scoped derive_broker_dailies coherence arm.
--     Without it the same seed dies at :652 on `23514
--     compute_jobs_kind_target_coherence`; the seeds are api_key-scoped because
--     that is the shape of the 396 real arm-A rows measured on TEST.
--   * 20260826120000 -- 20260826140000:622, `42883: computation_error_copy
--     (unknown) does not exist`.
--   * 20260826140000 -- without it the deployed body is 20260817120000's, which
--     carries no canary, and Part 1 reds at :428 with `TEST FAILED (1/V-1)`.
-- THREE entries are individually REMOVABLE and are here ON PURPOSE:
-- 20260719120000, 20260720120000 and 20260817120000. Because cron.schedule
-- upserts by name, dropping any one of them still leaves 20260826140000's body
-- deployed, which is why one-out calls them removable. They stay because the
-- CHAIN is what makes "the lane's oracle is the body TEST holds" a measured
-- property rather than a coincidence -- and because 20260513094906's own
-- necessity is measured against 20260719120000's raise, above.
--
-- ⚠️ THIS FILE'S PART-2/3 SKIP ARMS ARE UNREACHABLE BY CONSTRUCTION, which is
-- worth stating rather than reporting "zero skips" as if it were evidence.
-- Part 1's 1/JOB-05 arm RAISEs on the same absent-pg_cron condition and runs
-- FIRST, so a lane without the extension never reaches the `SKIP Part 2` /
-- `SKIP Part 3` branches. MEASURED 2026-09-05 with this list: the gate prints
-- ZERO NOTICE lines whose message BEGINS with SKIP, and all three Parts print
-- their OK line. ⚠️ Two coarser spellings of that count are WRONG here and both
-- were measured: over the whole lane transcript `SKIP|skipping` matches 24
-- (PostgreSQL's own `does not exist, skipping` DDL notices, which no gate
-- controls -- plan 164.4.1-02 measured 15 of them on an already-green reference
-- file), and the gate-prefixed form matches 1, because Part 1's own OK NOTICE
-- contains the words SKIP LOCKED. Only the message-begins-with-SKIP form means
-- anything, and it was calibrated against the exact line the Part 2 branch
-- would print (it matches).
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","supabase/migrations/20260513094906_enable_pg_cron.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/21-fixture-api-keys-credential-columns.sql","scripts/pg-lane/fixtures/20-fixture-app-role-helper.sql","scripts/pg-lane/fixtures/24-fixture-enqueue-compute-job-chain.sql","supabase/migrations/20260418194206_scoring_weight_overrides.sql","supabase/migrations/20260420073003_allocator_holdings.sql","supabase/migrations/20260515114555_compute_jobs_claim_token_fencing.sql","supabase/migrations/20260516104201_compute_jobs_audit_2026_05_07_residual.sql","supabase/migrations/20260614120000_derive_broker_dailies_kind.sql","supabase/migrations/20260624120100_derive_broker_dailies_api_key_coherence.sql","supabase/migrations/20260719120000_retention_orphaned_running_compute_jobs.sql","supabase/migrations/20260720120000_retention_orphaned_running_window_4h.sql","supabase/migrations/20260817120000_retention_orphaned_running_terminalize.sql","supabase/migrations/20260826120000_computation_error_curated_copy.sql","supabase/migrations/20260826140000_compute_jobs_error_kind_orphaned.sql"]}

-- ==========================================================================
-- Part 1 -- STRUCTURAL, UNGATED, ZERO SIDE EFFECTS. This is the part that must
-- redden when the migration is unapplied. No transaction: it only reads catalogs.
-- NO `RETURN` and NO skip arm appears anywhere in this block.
--
-- This part is an INDEPENDENT copy of the assertions the migration's own STEP 2
-- makes. That duplication is deliberate and is not redundancy: STEP 2 runs ONCE,
-- at apply time, and proves nothing about what is deployed today; this part runs
-- on every CI sql-tests run against whatever body pg_cron currently holds, so an
-- out-of-band unschedule or a hand-edited job row reddens HERE and nowhere else.
-- ==========================================================================
DO $$
DECLARE
  v_command  TEXT;
  v_bare     TEXT;
  v_schedule TEXT;
  v_count    INTEGER;
  v_jobs     INTEGER;
  v_running  INTEGER;
  v_terminal INTEGER;
  v_next     INTEGER;
  v_reason   INTEGER;
  v_kindcount INTEGER;
  v_win_a    INTEGER;
  v_win_b    INTEGER;
  v_mat      INTEGER;
  v_order    INTEGER;
  v_limit    INTEGER;
BEGIN
  -- Deliberately an EXCEPTION, not a skip. Part 1's whole job is to be the
  -- free-standing RED, and it also turns a missing `cron` schema into a legible
  -- message instead of a bare 42P01 from the catalog read below.
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-05): pg_cron is NOT installed on this database, so the orphaned-running terminalizer cannot be registered and every orphaned running job stays running forever. This is deliberately an EXCEPTION and not a skip: a gate that green-skips when the object under test is absent is not evidence. Run this file against the TEST project (TEST_SUPABASE_DB_URL), not a bare local database.';
  END IF;

  SELECT count(*) INTO v_count
    FROM cron.job WHERE jobname = 'retention_compute_jobs_orphaned_running';
  IF v_count = 0 THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-05): pg_cron IS installed but the retention_compute_jobs_orphaned_running job is NOT registered. Until it is, an orphaned running compute_jobs row is never terminalized: the wizard poller spins forever on it, no audit record of the lost claim is ever written, and Phase 142 reaper stays blocked from writing the user-facing analytics failure.';
  END IF;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-05): expected exactly ONE cron job named retention_compute_jobs_orphaned_running, found %. Two rows would run the janitor twice an hour and double the per-tick blast radius the LIMIT exists to cap.', v_count;
  END IF;

  SELECT command, schedule
    INTO v_command, v_schedule
    FROM cron.job WHERE jobname = 'retention_compute_jobs_orphaned_running';

  IF v_command IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-05): the retention_compute_jobs_orphaned_running job row carries a NULL command. pg_cron would fire an empty tick every hour and the run log would look healthy while every orphan stayed running forever.';
  END IF;

  -- ----- COMMENT STRIPPING, and the canary that proves it ran (V-1) ---------
  -- ⛔ EVERY assertion below this point reads v_bare, NEVER v_command. Part 1
  -- used to scan the RAW command, which made the whole part COMMENT-SATISFIABLE:
  -- MEASURED 2026-08-26, a reaper writing error_kind = 'unknown' on BOTH arms
  -- passed Part 1 unchanged as long as two comments in the body spelled the
  -- quoted kind literal. That is the precise failure this file's own header
  -- warns about for Parts 2 and 3, and Part 1 was the one place it was not
  -- applied. The two sibling gates in this range already do it — the parity
  -- gate's Part 2 (test_compute_jobs_error_kind_copy_parity.sql) and arm D of
  -- test_create_wizard_strategy_for_key.sql — and this brings Part 1 to their
  -- standard.
  --
  -- ⚠️ It cuts BOTH ways, which is why the negative checks below move too: the
  -- 'permanent' ban was equally satisfiable by a mere COMMENT, so a correct
  -- reaper whose comments explained what 'permanent' used to be would false-RED.
  -- A gate that can be turned off by a comment and a gate that can be turned on
  -- by a comment are the same defect.
  --
  -- The stripper is the sibling files' exact idiom. It is safe on this body
  -- because no string literal in it contains a double dash — the two audit
  -- literals are prose with a colon, and the windows are plain intervals.
  v_bare := regexp_replace(v_command, '--[^\n]*', '', 'g');

  -- The canary lives in a comment inside the cron body (migration
  -- 20260826140000, STEP 2) and NOWHERE in its code. Without it, "the stripper
  -- worked" and "there was nothing to strip" are the same observation, and every
  -- assertion below would silently lose its only evidence that it reads CODE.
  IF position('CANARY_162_V1_PROSE_ONLY' IN v_command) = 0 THEN
    RAISE EXCEPTION 'TEST FAILED (1/V-1): the prose-only canary CANARY_162_V1_PROSE_ONLY is absent from the RAW deployed command, so this part cannot tell "the comment stripper worked" from "there was nothing to strip" — and every count and negative check below loses its evidence that it is reading CODE rather than COMMENTARY. Restore the canary comment in the cron body (migration 20260826140000, STEP 2); do NOT delete the stripper to compensate.';
  END IF;
  IF position('CANARY_162_V1_PROSE_ONLY' IN v_bare) > 0 THEN
    RAISE EXCEPTION 'TEST FAILED (1/V-1): the comment stripper did not strip — the prose-only canary survived into the stripped body. cron.job.command carries the body verbatim INCLUDING its comments, so every token asserted below may now be COMMENTARY with the code deleted. Fix the regexp_replace above; do NOT weaken the assertions to compensate.';
  END IF;

  -- ⚠️ STRING equality on the WHOLE schedule, never an integer cast of one field.
  -- This file used to split the schedule on spaces, take field 2 and cast it to
  -- an integer to check a safe hour band. Under an hourly cadence field 2 is the
  -- literal asterisk, and casting that raises 22P02 -- a hard, opaque CI failure
  -- instead of a named assertion. The safe-hour band is meaningless for a job that
  -- runs every hour anyway. Do not reintroduce a per-field cast in any form.
  IF v_schedule IS DISTINCT FROM '50 * * * *' THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-05): the deployed cadence is % and not the expected 50 * * * *. Minute 50 is what keeps this janitor off 142 reaper quarter-hour grid, off 143 sweep at :35, and 10 minutes clear of the :00 stack; a daily cadence would also put post-threshold detection latency back at ~24h.', v_schedule;
  END IF;

  -- ----- POSITIVE anchors and occurrence COUNTS on the DEPLOYED body -----
  -- ⚠️ Every count here is calibrated to a TWO-ARM body. Phase 143's siblings were
  -- calibrated to a one-arm body and their numbers are NOT transferable.
  --
  -- 4 = arm A batch CTE + arm A UPDATE target + arm B batch CTE + arm B UPDATE
  -- target. A bare presence test could not fail: any ONE surviving reference
  -- satisfies it, so deleting a whole arm would pass unnoticed. That exact defect
  -- was MEASURED in Phase 143 on this very table name.
  v_jobs := (length(upper(v_bare)) - length(replace(upper(v_bare), 'PUBLIC.COMPUTE_JOBS', ''))) / length('PUBLIC.COMPUTE_JOBS');
  IF v_jobs <> 4 THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-05/D-08): the deployed body names public.compute_jobs % times, expected 4 (arm A batch + arm A UPDATE target + arm B batch + arm B UPDATE target). Two usually means a WHOLE ARM IS GONE -- if it is arm B, NULL-claim running rows become immortal again exactly as they were for 14 days on TEST; if it is arm A, no claimed orphan is ever terminalized. Zero means the janitor no longer touches the table at all.', v_jobs;
  END IF;

  -- 4 = two batch predicates + two compare-and-set fences, all single-spaced.
  v_running := (length(upper(v_bare)) - length(replace(upper(v_bare), 'STATUS = ''RUNNING''', ''))) / length('STATUS = ''RUNNING''');
  IF v_running <> 4 THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-05): the deployed body scopes to status = ''running'' % times, expected 4 (one predicate and one compare-and-set fence per arm). Losing a PREDICATE widens the janitor to every status -- it would terminalize done and pending rows. Losing a FENCE removes the protection against a real writer that terminalizes the row between the batch subselect and the UPDATE, so this janitor would overwrite a genuine outcome with a fabricated one.', v_running;
  END IF;

  -- 2 = one terminal status per arm.
  v_terminal := (length(upper(v_bare)) - length(replace(upper(v_bare), '''FAILED_FINAL''', ''))) / length('''FAILED_FINAL''');
  IF v_terminal <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-05): the deployed body writes ''failed_final'' % times, expected 2 (one per arm). failed_final is the ONLY terminal-failure value both outside the claimable set (so the row can never be re-claimed and the CI re-pollution flake cannot return) and outside Phase 142 reaper exclusion set (so terminalizing UNBLOCKS the user-facing analytics message). Any other value moves the row without moving the outcome.', v_terminal;
  END IF;

  -- 2 = B3, one per SET list.
  v_next := (length(upper(v_bare)) - length(replace(upper(v_bare), 'NEXT_ATTEMPT_AT', ''))) / length('NEXT_ATTEMPT_AT');
  IF v_next <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-05/B3): the deployed body writes next_attempt_at % times, expected 2 (one per SET list). retention_compute_jobs_failed deletes on COALESCE(next_attempt_at, created_at) older than 90 days (20260515210200:255-259) and the claim RPC never advances that column, so a status-only flip lets an old orphan be collected on the very NEXT 03:30 tick -- terminalized at 04:50, gone by 03:30, and the audit trail this cron exists to preserve lasts eleven hours instead of ninety days.', v_next;
  END IF;

  IF v_bare NOT ILIKE '%error_kind%' THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-05): the deployed body does not set error_kind. Both user-facing readers synthesise their copy from (status, error_kind) -- get_user_compute_jobs.user_message and computation_error_copy, which is what strategy_analytics.computation_error carries -- so a terminalized row with a NULL error_kind renders the cautious default on both instead of the accurate worker-died one.';
  END IF;

  -- ⛔ FLIPPED FROM 'permanent' TO 'orphaned' by mig 20260826140000 (Phase 162
  -- review F-3), and the COUNT replaces the old presence test. 'permanent' here
  -- was the DEFECT: these jobs are ones whose WORKER DIED holding the claim, so
  -- they are retryable by definition, but 'permanent' is the kind that means
  -- "skip retries" and both readers say so out loud -- computation_error_copy's
  -- permanent arm tells the user "retrying alone will not resolve it". It does
  -- not self-heal either: the 20260819130500 readmit sweep is csv-only, and once
  -- the bridge writes computation_status = 'failed' its NOT EXISTS conjunct
  -- blocks readmit permanently. So the user retrying is the only mechanism left,
  -- and the copy talked them out of it.
  --
  -- 2 = one per arm, NOT a presence test: a presence test is satisfied by either
  -- arm surviving, so a half-converted reaper (arm A flipped, arm B still
  -- 'permanent') would pass unnoticed -- and that is worse than no conversion,
  -- because the class still mislabelled is now invisible to anyone looking for
  -- the fix.
  v_kindcount := (length(v_bare) - length(replace(v_bare, '''orphaned''', ''))) / length('''orphaned''');
  IF v_kindcount <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (1/F-3): the deployed body classifies as ''orphaned'' % times, expected 2 (one per arm). Arm A reaps claims older than the 4h window, arm B reaps never-claimed running rows older than 48h -- BOTH are worker deaths and both are retryable. A missing conversion leaves that arm''s users reading copy that tells them retrying will not help.', v_kindcount;
  END IF;
  IF v_bare ILIKE '%''permanent''%' THEN
    RAISE EXCEPTION 'TEST FAILED (1/F-3): the deployed body still classifies a reaped orphan as ''permanent''. That is the finding F-3 closed: a job whose worker died is not a permanent failure, and labelling it one makes both user-facing surfaces state something false about retryability. If the reaper genuinely needs to write permanent again, the copy arms in computation_error_copy and get_user_compute_jobs must change in the same commit.';
  END IF;

  -- 2 = one fixed audit literal per arm.
  v_reason := (length(upper(v_bare)) - length(replace(upper(v_bare), 'ORPHANED_RUNNING_REAPED', ''))) / length('ORPHANED_RUNNING_REAPED');
  IF v_reason <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-05): the deployed body stamps the orphaned_running_reaped audit reason % times, expected 2 (one fixed literal per arm). last_error is the ONLY operator-visible record of why a row was terminalized -- it is hard-redacted from users at the RPC and zod layers -- so without it an operator cannot tell a reaped orphan from a genuine handler failure.', v_reason;
  END IF;

  -- 1 = arm A only. SC#2: the RT-01 window is UNCHANGED by Phase 144.
  v_win_a := (length(upper(v_bare)) - length(replace(upper(v_bare), 'INTERVAL ''4 HOURS''', ''))) / length('INTERVAL ''4 HOURS''');
  IF v_win_a <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-05/RT-01): the deployed body carries the 4-hour claim window % times, expected exactly 1 (arm A). Zero means the RT-01-corrected threshold is gone: a full batch of 5 jobs shares one claim stamp and dispatches sequentially at up to 30 min each, so a HEALTHY worker legitimately holds a 2.5h-old claim and a narrower window would terminalize a live in-flight job out from under it. More than one means a second arm has imported a threshold derived for a different mechanism.', v_win_a;
  END IF;

  -- 1 = arm B only, and it must NOT be a copy of arm A's number.
  v_win_b := (length(upper(v_bare)) - length(replace(upper(v_bare), 'INTERVAL ''48 HOURS''', ''))) / length('INTERVAL ''48 HOURS''');
  IF v_win_b <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-05/D-08): the deployed body carries the derived 48-hour NULL-claim window % times, expected exactly 1 (arm B). Zero means arm B is gone or has copied arm A 4-hour figure -- and 4h is a CLAIM-age bound that says nothing about a row that was never claimed. The 48h figure is the 24h enqueue cadence plus 2.5h max batch wall-clock, rounded up to the next whole cadence multiple.', v_win_b;
  END IF;

  IF v_bare ILIKE '%interval ''2 hours''%' THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-05/RT-01): the deployed body carries the OLD 2-hour window that migration 20260720120000 corrected away. Under it a healthy worker batch-tail job -- legitimately in flight with a 2.5h-old claim stamp -- is terminalized while it is still running, so its side effects land against a row that has left the in-flight set and a duplicate job can be enqueued alongside it.';
  END IF;

  IF v_bare NOT ILIKE '%claimed_at IS NULL%' THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-05/D-08): the deployed body has no claimed_at IS NULL arm. Those rows are invisible to a claimed_at threshold in BOTH directions -- the superseded body excluded them by name and NULL < x is never TRUE anyway -- so without this arm the running rows that have been stuck longest are precisely the ones nothing can ever clear. Six such rows sat untouched on TEST for up to 14 days.';
  END IF;

  -- 2 = one deterministic ordering per arm.
  v_order := (length(upper(v_bare)) - length(replace(upper(v_bare), 'ORDER BY', ''))) / length('ORDER BY');
  IF v_order <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-05): the deployed body orders its bounded batches % times, expected 2 (arm A by claimed_at ASC, arm B by created_at ASC). Without a deterministic ordering the LIMIT selects an ARBITRARY subset each tick, so the oldest orphans can be skipped indefinitely while the batch stays full -- bounded but never progressing.', v_order;
  END IF;

  -- ⚠️ SHAPE gate, NOT a bound proof. Measured in Phase 143: removing this keyword
  -- from a LOCKING CTE changes neither plan nor result, because Postgres does not
  -- inline a CTE that locks rows. It is retained because it survives a future edit
  -- that drops FOR UPDATE, at which point the CTE would become inlinable. Part 3
  -- is the bound proof; never let a green here stand in for it.
  v_mat := (length(upper(v_bare)) - length(replace(upper(v_bare), 'AS MATERIALIZED', ''))) / length('AS MATERIALIZED');
  IF v_mat <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-05/D-19): the deployed body carries % MATERIALIZED batch CTEs, expected exactly 2 (one per arm). The explicit fence is what keeps each bound safe against a future edit that drops FOR UPDATE and makes the CTE inlinable -- at which point the LIMIT would be re-applied per outer row and the per-tick blast radius would silently become unbounded. This is shape enforcement; Part 3 is the bound proof.', v_mat;
  END IF;

  IF v_bare NOT ILIKE '%FOR UPDATE SKIP LOCKED%' THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-05): the deployed body dropped FOR UPDATE SKIP LOCKED, so a batch would BLOCK on any row a live writer holds instead of skipping it and taking it next tick. Under the 5s lock_timeout that turns a contended tick into a failed tick.';
  END IF;

  -- The per-tick BOUND, WORD-BOUNDED and COUNTED.
  -- ⚠️ Word-bounding is not decoration: '... LIMIT 1000 ...' ILIKE '%LIMIT 100%'
  -- is TRUE, so a substring test passes over a 10x widening of the blast radius.
  -- That defect was MEASURED in Phase 143 against LIMIT 25 / LIMIT 2500 and fixed
  -- in all three of its gates. The trailing ([^0-9]|$) alternation is required:
  -- without the `|$` arm a body ending exactly at the limit would false-RED.
  -- The COUNT is the second half -- the pattern test alone is satisfied by ONE
  -- word-bounded match, so widening only ONE arm would slip past it.
  IF v_bare !~ 'LIMIT[[:space:]]+100([^0-9]|$)' THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-05/D-19): the deployed body carries no word-bounded LIMIT 100. Either the per-arm bound is gone entirely -- one tick would then terminalize the WHOLE orphan population in a single statement, holding row locks and firing the updated_at trigger across every row at once -- or it has been widened to LIMIT 100<digits>, which multiplies the per-tick blast radius while still containing the literal substring a naive substring gate tests for.';
  END IF;
  SELECT count(*) INTO v_limit
    FROM regexp_matches(v_bare, 'LIMIT[[:space:]]+100([^0-9]|$)', 'g');
  IF v_limit <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-05/D-19): the deployed body carries % word-bounded LIMIT 100 clauses, expected exactly 2 (one per arm). One means a single arm has been widened or unbounded while the other still satisfies the pattern test -- the per-arm cap is the whole bound, so half a bound is no bound for the arm that lost it.', v_limit;
  END IF;

  -- ----- NEGATIVE anchors on the DEPLOYED body -----
  -- ⭐ THE assertion that makes "never remove a row" mechanically checkable at the
  -- deployed body, and the textual half of what Part 2's count conservation proves
  -- behaviourally. This file's superseded version asserted the OPPOSITE (that the
  -- orphan row was gone); that assertion is what would have reddened the moment
  -- the correct migration reached TEST.
  IF v_bare ILIKE '%DELETE%' THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-05/WR-02): the deployed body contains a row-removal statement. This janitor must TERMINALIZE and never remove: a removed row gives the wizard poller no outcome to break out on, destroys the only audit record that a worker was down past its claim window, and on PROD discards a genuine in-flight one-shot job that nothing will re-enqueue.';
  END IF;
  -- ⚠️ The window between SELECT and LIMIT is '[^;]*', not '[^)]*'. MEASURED in
  -- Phase 143: no realistic predicate can be written without a closing paren before
  -- its LIMIT, so the '[^)]*' form matched nothing and the gate could not fail.
  -- '[^;]*' still bounds the match to a SINGLE statement so it cannot smear across
  -- the two arms and false-RED.
  IF v_bare ~* '\mIN\M[[:space:]]*\([[:space:]]*SELECT[^;]*LIMIT' THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-05/D-19): the deployed body binds a bounded batch through an IN (SELECT ... LIMIT ...) subquery. That is the exact un-hashable-subplan shape whose LIMIT is re-applied per outer row, so the per-tick bound silently does not exist -- the defect 20260803130000 was written to fix.';
  END IF;
  IF v_bare ILIKE '%failed_retry%' THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-05): the deployed body references failed_retry. That value is CLAIMABLE (20260719073701:204), so the orphan would be re-claimed to running on the next worker tick and the daily re-pollution flake this cron exists to kill would return; and it is INSIDE Phase 142 reaper exclusion set (20260803130000:141), so the user-facing analytics message would stay blocked forever.';
  END IF;
  IF v_bare ILIKE '%enqueue_compute_job%' THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-05): the deployed body calls the enqueue RPC. This janitor must never create work: for cron-fanned kinds the daily fan-out re-enqueues by itself once terminalization frees the in-flight slot, so a janitor INSERT races it and can collide on the in-flight unique index -- and a RAISE inside a pg_cron body aborts the WHOLE tick, losing the terminalization too. For one-shot kinds a blind re-enqueue turns a poison job that killed the worker into an infinite loop.';
  END IF;
  IF v_bare ILIKE '%claimed_by%' THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-05): the deployed body references claimed_by. That column must be PRESERVED, not written: it records which worker last held the row and is the forensic starting point for any orphan investigation. Audit M-0779 deliberately stopped mark_compute_job_failed from clearing it (20260516104201:917-928); a janitor that clears it re-opens that finding.';
  END IF;

  RAISE NOTICE 'Part 1 OK (all counts and bans measured on the COMMENT-STRIPPED body, canary-proven): retention_compute_jobs_orphaned_running registered exactly once at 50 * * * *, with 4 public.compute_jobs references, 4 running-status anchors, 2 failed_final writes, 2 next_attempt_at writes, 2 audit reasons, 1x 4-hour + 1x 48-hour window, a claimed_at IS NULL arm, 2 ORDER BY, 2 MATERIALIZED batches, 2 word-bounded LIMIT 100, SKIP LOCKED present, and no removal statement, IN-subquery LIMIT, failed_retry, enqueue RPC or claimed_by write.';
END
$$;

-- ==========================================================================
-- Part 2 -- DIRECTIONAL ARMS. Oracle is the DEPLOYED cron.job.command.
-- Rolls back unconditionally.
--
--   A   claimed 5h ago (past the 4h window)          -> MUST be terminalized
--   B   claimed 3h ago (RT-01 batch tail)            -> MUST be untouched
--   C   claimed now                                  -> MUST be untouched
--   D   status done, aged                            -> MUST be untouched
--   E   claimed_at NULL, created 100 years ago       -> MUST be terminalized
--   F   claimed_at NULL, created 12h ago             -> MUST be untouched
--   +   COUNT CONSERVATION over all six seeded ids   -> MUST still be 6
--       (asserted FIRST, immediately after the tick -- see the note at that
--        assertion for the measured reason the ordering is load-bearing)
--
-- A and B are the threshold pair: they fail in OPPOSITE directions if the 4-hour
-- window moves. E and F are the same pair for arm B. D proves the status scope.
-- The count-conservation assertion is what makes "never remove a row"
-- BEHAVIOURALLY checkable rather than merely textual (Part 1's removal-keyword
-- negative is the textual half; a body could remove rows without the keyword this
-- file greps for, and this assertion would still catch it).
--
-- Every seed is api_key-scoped with kind derive_broker_dailies, which is the shape
-- of the 396 real arm-A rows measured on TEST. Distinct api_keys per running row
-- are REQUIRED: compute_jobs_one_inflight_per_kind_api_key is UNIQUE on
-- (api_key_id, kind) while status is in flight.
-- ==========================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$
DECLARE
  v_command TEXT;
  v_user    UUID := gen_random_uuid();
  key_a UUID; key_b UUID; key_c UUID; key_d UUID; key_e UUID; key_f UUID;
  id_a  UUID; id_b  UUID; id_c  UUID; id_d  UUID; id_e  UUID; id_f  UUID;
  v_seeded  UUID[];
  v_fresh   TIMESTAMPTZ := now();
  v_ancient TIMESTAMPTZ;
  v_status  TEXT;
  v_kind    TEXT;
  v_err     TEXT;
  v_next    TIMESTAMPTZ;
  v_claimed TIMESTAMPTZ;
  v_cnt     INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'SKIP Part 2: pg_cron is not installed here, so the deployed-body oracle is unavailable (local dev only). Part 1 already reddened on this condition.';
    RETURN;
  END IF;

  SELECT command INTO v_command
    FROM cron.job WHERE jobname = 'retention_compute_jobs_orphaned_running';
  IF v_command IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (2/JOB-05): the retention_compute_jobs_orphaned_running cron job is missing while pg_cron is installed. A missing janitor is a red gate, never a skip.';
  END IF;

  -- The century-back epoch: the isolation mechanism (see the file header). It
  -- makes the positive seeds outrank every foreign candidate under the deployed
  -- ORDER BY, so they win the 100-row budget without this file touching a row it
  -- does not own. It is ALSO the seed for next_attempt_at, which is what lets the
  -- B3 assertion below genuinely fail (never compare two now()s).
  v_ancient := v_fresh - interval '100 years';

  INSERT INTO auth.users (id, email)
    VALUES (v_user, 'job05-arms-' || v_user || '@invalid.local');
  INSERT INTO public.profiles (id, display_name)
    VALUES (v_user, 'job05-arms') ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.api_keys (user_id, exchange, label, api_key_encrypted)
    VALUES (v_user, 'binance', 'job05-arm-a', 'not-a-real-ciphertext') RETURNING id INTO key_a;
  INSERT INTO public.api_keys (user_id, exchange, label, api_key_encrypted)
    VALUES (v_user, 'binance', 'job05-arm-b', 'not-a-real-ciphertext') RETURNING id INTO key_b;
  INSERT INTO public.api_keys (user_id, exchange, label, api_key_encrypted)
    VALUES (v_user, 'binance', 'job05-arm-c', 'not-a-real-ciphertext') RETURNING id INTO key_c;
  INSERT INTO public.api_keys (user_id, exchange, label, api_key_encrypted)
    VALUES (v_user, 'binance', 'job05-arm-d', 'not-a-real-ciphertext') RETURNING id INTO key_d;
  INSERT INTO public.api_keys (user_id, exchange, label, api_key_encrypted)
    VALUES (v_user, 'binance', 'job05-arm-e', 'not-a-real-ciphertext') RETURNING id INTO key_e;
  INSERT INTO public.api_keys (user_id, exchange, label, api_key_encrypted)
    VALUES (v_user, 'binance', 'job05-arm-f', 'not-a-real-ciphertext') RETURNING id INTO key_f;

  -- (A) arm-A POSITIVE. claimed_at is backdated a CENTURY, not five hours: five
  -- hours is past the window but would lose the 100-row budget to the hundreds of
  -- genuinely-stuck foreign rows on the shared TEST project. next_attempt_at is
  -- seeded a century back TOO, which is the whole point of the B3 assertion.
  -- claimed_by / claim_token / attempts are seeded so their PRESERVATION is
  -- observable after the tick.
  INSERT INTO public.compute_jobs (api_key_id, kind, status, claimed_at, claim_token, claimed_by, attempts, next_attempt_at)
    VALUES (key_a, 'derive_broker_dailies', 'running', v_ancient, gen_random_uuid(), 'job05-seed-worker', 1, v_ancient)
    RETURNING id INTO id_a;
  -- (B) RT-01 batch tail: claimed 3h ago, INSIDE the 4h window.
  INSERT INTO public.compute_jobs (api_key_id, kind, status, claimed_at, claim_token, claimed_by, attempts, next_attempt_at)
    VALUES (key_b, 'derive_broker_dailies', 'running', v_fresh - interval '3 hours', gen_random_uuid(), 'job05-seed-worker', 1, v_ancient)
    RETURNING id INTO id_b;
  -- (C) claimed this instant.
  INSERT INTO public.compute_jobs (api_key_id, kind, status, claimed_at, claim_token, claimed_by, attempts, next_attempt_at)
    VALUES (key_c, 'derive_broker_dailies', 'running', v_fresh, gen_random_uuid(), 'job05-seed-worker', 1, v_ancient)
    RETURNING id INTO id_c;
  -- (D) aged NON-running row: the status scope.
  INSERT INTO public.compute_jobs (api_key_id, kind, status, created_at, claimed_at, claim_token, next_attempt_at)
    VALUES (key_d, 'derive_broker_dailies', 'done', v_ancient, v_ancient, gen_random_uuid(), v_ancient)
    RETURNING id INTO id_d;
  -- (E) arm-B POSITIVE: the invariant-violating shape. claimed_at NULL with a
  -- NON-NULL claim_token, which is exactly how the 6 measured TEST rows look.
  INSERT INTO public.compute_jobs (api_key_id, kind, status, created_at, claimed_at, claim_token, attempts, next_attempt_at)
    VALUES (key_e, 'derive_broker_dailies', 'running', v_ancient, NULL, gen_random_uuid(), 1, v_ancient)
    RETURNING id INTO id_e;
  -- (F) arm-B NEGATIVE: same shape, only 12h old -- well inside the 48h window.
  INSERT INTO public.compute_jobs (api_key_id, kind, status, created_at, claimed_at, claim_token, attempts, next_attempt_at)
    VALUES (key_f, 'derive_broker_dailies', 'running', v_fresh - interval '12 hours', NULL, gen_random_uuid(), 1, v_ancient)
    RETURNING id INTO id_f;

  v_seeded := ARRAY[id_a, id_b, id_c, id_d, id_e, id_f];

  -- ----- THE ORACLE: run the REAL deployed body -------------------------
  EXECUTE v_command;

  -- ----- COUNT CONSERVATION: the behavioural half of "never remove" ------
  -- ⚠️ ORDERING IS LOAD-BEARING, and this is a MEASURED correction, not a style
  -- choice. This assertion originally sat at the END of the part, after every
  -- per-arm read -- and in that position it COULD NOT FAIL. The 144-01 neuter
  -- matrix deployed the superseded removal body and observed that the arm-A read
  -- below fired first every time, so the one assertion that makes D-01 checkable
  -- was never reached. Any body that removes a seeded row trips a per-arm read
  -- before it trips a count taken at the bottom. It runs FIRST now, so the
  -- headline invariant is the first thing observed, and every per-arm read below
  -- can rely on its row existing. Do not move it back.
  SELECT count(*) INTO v_cnt FROM public.compute_jobs WHERE id = ANY (v_seeded);
  IF v_cnt <> 6 THEN
    RAISE EXCEPTION 'TEST FAILED (2/conservation/JOB-05/WR-02/SC#1): % of my 6 seeded rows survive the tick, expected all 6. The janitor REMOVED rows. That is the shipped behaviour Phase 144 exists to replace: a removed row leaves the wizard poller with no outcome to break out on, destroys the audit record that a worker was down past its claim window, and on PROD discards a genuine in-flight one-shot job that nothing will re-enqueue. This is checked BEHAVIOURALLY rather than only by grepping the body for a removal keyword -- a rewritten removal that avoids that keyword would still be caught here.', v_cnt;
  END IF;

  -- ----- (A) arm-A positive, on its five observable properties -----------
  -- The row is known to exist (conservation above), so a NULL read below means a
  -- column was cleared, never that the row vanished.
  SELECT status, error_kind, last_error, next_attempt_at, claimed_at
    INTO v_status, v_kind, v_err, v_next, v_claimed
    FROM public.compute_jobs WHERE id = id_a;

  IF v_status IS DISTINCT FROM 'failed_final' THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm A/JOB-05/SC#1): an orphan claimed past the 4-hour window sits at status % after one tick, expected failed_final. At running the poller never breaks out (isJobInFlight is true for every status outside FINISHED_JOB_STATUSES) and Phase 142 reaper stays blocked from writing the user-facing analytics failure, because failed_final is the only terminal-failure value outside its exclusion set.', v_status;
  END IF;
  IF v_next <= v_ancient THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm A/JOB-05/B3): the terminalized row next_attempt_at is still at its century-backdated seed value (%), so the janitor did not advance it. retention_compute_jobs_failed deletes failed rows on COALESCE(next_attempt_at, created_at) older than 90 days, so this row is eligible for removal on the very NEXT 03:30 tick -- the audit trail this cron promises would last hours instead of ninety days.', v_next;
  END IF;
  -- ⛔ 'orphaned', not 'permanent' (mig 20260826140000, Phase 162 review F-3).
  -- This is the END-TO-END half of the Part 1 body assertion: Part 1 proves the
  -- deployed TEXT says orphaned, this proves a real tick actually WROTE it, so a
  -- CHECK that silently rejected the value -- which would abort the whole pg_cron
  -- block and leave the row running -- cannot pass both.
  IF v_kind IS DISTINCT FROM 'orphaned' THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm A/F-3): the terminalized row error_kind is % and not orphaned. Both user-facing readers derive their copy from (status, error_kind): at ''permanent'' the user is told retrying will not resolve it, and at anything unmodelled they get the cautious default. This row''s worker DIED holding the claim -- the job never reached a verdict -- so it is retryable, and retrying is the only mechanism that computes it (the 20260819130500 readmit sweep is csv-only and is blocked once computation_status reads failed).', v_kind;
  END IF;
  IF v_err IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm A/JOB-05): the terminalized row carries no last_error. That column is the ONLY operator-visible record of WHY the row was terminalized (it is hard-redacted from users at the RPC and zod layers), so without it an operator cannot tell a reaped orphan from a genuine handler failure.';
  END IF;
  IF v_claimed IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm A/JOB-05): the terminalized row claimed_at was CLEARED. It is the forensic timestamp of the claim that leaked and the very value the arm-A predicate matched on; clearing it also moves the row into arm B scope, where a future tick would re-terminalize it under the wrong reason.';
  END IF;

  -- ----- (B) RT-01: the 3h batch tail is UNTOUCHED (SC#2) ----------------
  SELECT status INTO v_status FROM public.compute_jobs WHERE id = id_b;
  IF v_status IS DISTINCT FROM 'running' THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm B/JOB-05/RT-01/SC#2): a running row claimed only 3 hours ago is at status % after one tick, expected still running. The window has been narrowed below the RT-01 basis: a full batch of 5 claimed jobs shares ONE claim stamp and dispatches sequentially at up to 30 min each, so a HEALTHY worker legitimately holds a 2.5h-old claim. Terminalizing it marks a LIVE job permanently failed, its side effects then land against a row that has left the in-flight set, and a duplicate job can be enqueued alongside it -- the exact double-compute the claim fence exists to prevent.', v_status;
  END IF;

  -- ----- (C) freshly claimed row is UNTOUCHED ---------------------------
  -- ⚠️ HONESTY: this arm is DOMINATED by arm B and was NOT independently
  -- reddened by the 144-01 neuter matrix. For any monotone age threshold, a body
  -- that takes a 0-second-old claim also takes the 3-hour-old one, so arm B fires
  -- first every time; and a body that took C but not B would have to be
  -- age-INVERTED, which fails arm A before it reaches here. It is kept as an
  -- explicit boundary marker of what the threshold means, not as independent
  -- evidence. Do not count it twice when reasoning about coverage.
  SELECT status INTO v_status FROM public.compute_jobs WHERE id = id_c;
  IF v_status IS DISTINCT FROM 'running' THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm C/JOB-05): a row claimed THIS INSTANT is at status % after one tick, expected still running. There is no threshold left at all -- the janitor would terminalize every job the worker claims, on every tick.', v_status;
  END IF;

  -- ----- (D) aged NON-running row is UNTOUCHED --------------------------
  SELECT status INTO v_status FROM public.compute_jobs WHERE id = id_d;
  IF v_status IS DISTINCT FROM 'done' THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm D/JOB-05): an aged DONE row is at status % after one tick, expected still done. The status scope is broken, so the janitor rewrites completed work as permanently failed -- and because it also stamps next_attempt_at, it resets those rows retention clocks at the same time.', v_status;
  END IF;

  -- ----- (E) arm-B positive: the invariant-violating shape ---------------
  SELECT status, error_kind, last_error, next_attempt_at
    INTO v_status, v_kind, v_err, v_next
    FROM public.compute_jobs WHERE id = id_e;
  IF v_status IS DISTINCT FROM 'failed_final' THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm E/JOB-05/D-08): a running row with claimed_at NULL, created a century ago, is at status % after one tick, expected failed_final. Arm B is gone or broken. That row shape is IMMORTAL without it: the superseded body excluded NULL claims by name, and NULL < x is never TRUE anyway, so nothing else in the system can ever clear it -- six such rows sat on TEST for up to 14 days.', v_status;
  END IF;
  IF v_next <= v_ancient THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm E/JOB-05/B3): the arm-B terminalized row next_attempt_at is still at its century-backdated seed value (%). Same consequence as arm A: retention_compute_jobs_failed collects it on the next nightly tick and the audit trail is voided.', v_next;
  END IF;
  IF v_kind IS DISTINCT FROM 'orphaned' OR v_err IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm E/F-3): the arm-B terminalized row carries error_kind % and last_error %, expected orphaned and a non-null fixed audit literal. The two arms must terminalize IDENTICALLY apart from the reason text; a divergence here means one arm writes a row the operator channel or the user-facing copy synthesis cannot read. ⚠️ If this arm says permanent while arm A says orphaned, the conversion is HALF DONE -- never-claimed orphans are still being told that retrying will not help.', v_kind, v_err;
  END IF;

  -- ----- (F) arm-B negative: 12h is inside the 48h window ----------------
  SELECT status INTO v_status FROM public.compute_jobs WHERE id = id_f;
  IF v_status IS DISTINCT FROM 'running' THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm F/JOB-05/D-08): a NULL-claim running row only 12 hours old is at status % after one tick, expected still running. Arm B threshold has collapsed below its derivation (24h enqueue cadence + 2.5h max batch wall-clock, rounded up to 48h), so a row that the next daily fan-out has not even had a chance to supersede is already being called orphaned.', v_status;
  END IF;

  -- Whole-block invariant, identity-scoped: exactly TWO of the six move.
  -- ⚠️ HONESTY: this is a CATCH-ALL for an arm added later without its own
  -- assertion, and the 144-01 neuter matrix could not redden it -- every seed in
  -- this block already has a named check that fires first. It is the same
  -- register as 143's whole-block count and carries the same caveat: it adds
  -- future-proofing, not present coverage.
  SELECT count(*) INTO v_cnt
    FROM public.compute_jobs
   WHERE id = ANY (v_seeded) AND status = 'failed_final';
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (2/whole-block/JOB-05): one tick terminalized % of my six seeded rows, expected exactly 2 (arms A and E). Every other seed is a documented false-positive guard, so any other number means a guard fell or a terminalization was lost -- and the per-arm assertions above should name which.', v_cnt;
  END IF;

  RAISE NOTICE 'Part 2 OK: the 4h-past claimed orphan and the 48h-past NULL-claim orphan were both terminalized to failed_final with next_attempt_at advanced, error_kind orphaned, a fixed last_error and claimed_at preserved; the 3h batch-tail, the freshly-claimed row, the aged done row and the 12h NULL-claim row were all left running/done; and all 6 seeded rows survived the tick.';

  -- Teardown, belt-and-suspenders; the ROLLBACK also discards everything.
  DELETE FROM auth.users WHERE id = v_user;
END
$$;
ROLLBACK;

-- ==========================================================================
-- Part 3 -- THE BOUND (D-19), executed. LIMIT + 1 candidates, oracle run TWICE.
-- Rolls back unconditionally.
--
-- ⭐ This is the ONLY part of this file that can falsify the per-tick bound.
-- Part 1's AS MATERIALIZED counter is SHAPE enforcement and nothing more: Phase
-- 143 MEASURED that removing the keyword from a locking CTE changes neither the
-- EXPLAIN output nor the result, because Postgres does not inline a CTE that locks
-- rows. Every gate in phases 142/142.1 passed over a bound that did not exist
-- precisely because it grepped for a token. Only executing the deployed body
-- against LIMIT+1 real rows falsifies it.
--
-- The 101 seeds are staggered a century back, so under the deployed
-- `ORDER BY claimed_at ASC LIMIT 100` the 100 OLDEST seeds are exactly the ones a
-- correct tick must take and v_youngest (the i=1 seed, least old) is exactly the
-- one it must leave. Asserting WHICH rows must move is strictly stronger than
-- counting HOW MANY moved.
--   tick 1 -> my 100 oldest seeds are ALL terminal AND v_youngest is NOT
--   tick 2 -> v_youngest is terminal and all 101 are (bounded AND progressing)
--
-- 101 DISTINCT api_keys are required, not a convenience:
-- compute_jobs_one_inflight_per_kind_api_key is UNIQUE on (api_key_id, kind) while
-- the row is in flight, so 101 running derive_broker_dailies rows cannot share one
-- key. A seeding shortcut here fails on the index, not in an assertion.
-- ==========================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$
DECLARE
  v_command  TEXT;
  v_user     UUID := gen_random_uuid();
  v_key      UUID;
  v_job      UUID;
  v_seeded   UUID[] := ARRAY[]::UUID[];
  v_youngest UUID;
  v_fresh    TIMESTAMPTZ := now();
  v_ancient  TIMESTAMPTZ;
  v_cnt      INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'SKIP Part 3: pg_cron is not installed here, so the deployed-body oracle is unavailable (local dev only).';
    RETURN;
  END IF;

  SELECT command INTO v_command
    FROM cron.job WHERE jobname = 'retention_compute_jobs_orphaned_running';
  IF v_command IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (3/JOB-05): the retention_compute_jobs_orphaned_running cron job is missing while pg_cron is installed.';
  END IF;

  v_ancient := v_fresh - interval '100 years';

  INSERT INTO auth.users (id, email)
    VALUES (v_user, 'job05-bound-' || v_user || '@invalid.local');
  INSERT INTO public.profiles (id, display_name)
    VALUES (v_user, 'job05-bound') ON CONFLICT (id) DO NOTHING;

  -- i = 101 is the OLDEST claim, i = 1 the youngest.
  FOR i IN 1..101 LOOP
    INSERT INTO public.api_keys (user_id, exchange, label, api_key_encrypted)
      VALUES (v_user, 'binance', 'job05-bound-' || i::text, 'not-a-real-ciphertext')
      RETURNING id INTO v_key;
    INSERT INTO public.compute_jobs (api_key_id, kind, status, claimed_at, claim_token, claimed_by, next_attempt_at)
      VALUES (v_key, 'derive_broker_dailies', 'running',
              v_ancient - (i * interval '1 minute'),
              gen_random_uuid(), 'job05-seed-worker', v_ancient)
      RETURNING id INTO v_job;
    v_seeded := array_append(v_seeded, v_job);
  END LOOP;

  v_youngest := v_seeded[1];

  -- ----- tick 1: BOUNDED -------------------------------------------------
  EXECUTE v_command;

  SELECT count(*) INTO v_cnt
    FROM public.compute_jobs
   WHERE id = ANY (v_seeded)
     AND id <> v_youngest
     AND status = 'failed_final';
  IF v_cnt <> 100 THEN
    RAISE EXCEPTION 'TEST FAILED (3/JOB-05/D-19): after ONE tick only % of MY 100 oldest seeded orphans were terminalized, expected all 100. Either the janitor is not draining its batch, or a foreign row with a claim stamp older than the century-back seed epoch crowded a seed out of the 100-row budget (see the RESIDUAL note in this file header).', v_cnt;
  END IF;

  SELECT count(*) INTO v_cnt
    FROM public.compute_jobs
   WHERE id = v_youngest AND status = 'running';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (3/JOB-05/D-19): my YOUNGEST seeded orphan -- the 101st, sitting outside a 100-row budget -- was terminalized on tick 1. The per-tick LIMIT is gone, so one tick can rewrite the ENTIRE orphan population in a single statement: on TEST that is hundreds of rows at once, each firing the updated_at trigger and each holding a row lock for the duration. This is the D-19 signature, and NO amount of grepping for AS MATERIALIZED can detect it -- only this execution can.';
  END IF;

  -- ----- tick 2: PROGRESSING --------------------------------------------
  -- The previous tick moved 100 of my seeds out of `running`, so they leave the
  -- predicate and v_youngest is the oldest remaining candidate this block owns.
  -- No neutralizing UPDATE is needed and none may be added.
  EXECUTE v_command;

  SELECT count(*) INTO v_cnt
    FROM public.compute_jobs WHERE id = v_youngest AND status = 'failed_final';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (3/JOB-05/D-19): my youngest seeded orphan is still not terminal after a SECOND tick. The janitor is bounded but NOT progressing, so a backlog would never drain: the oldest orphans are cleared while the rest starve, and on TEST the 396-row population would sit there indefinitely.';
  END IF;

  SELECT count(*) INTO v_cnt
    FROM public.compute_jobs WHERE id = ANY (v_seeded) AND status = 'failed_final';
  IF v_cnt <> 101 THEN
    RAISE EXCEPTION 'TEST FAILED (3/JOB-05/D-19): after two ticks % of my 101 seeded orphans are terminal, expected all 101.', v_cnt;
  END IF;

  -- Conservation again, over the bound population: two ticks, zero rows removed.
  SELECT count(*) INTO v_cnt FROM public.compute_jobs WHERE id = ANY (v_seeded);
  IF v_cnt <> 101 THEN
    RAISE EXCEPTION 'TEST FAILED (3/conservation/JOB-05/WR-02): % of my 101 seeded rows survive two ticks, expected all 101. The janitor removed rows.', v_cnt;
  END IF;

  RAISE NOTICE 'Part 3 OK: the per-tick bound holds -- my 100 oldest seeded orphans were terminalized on tick 1 with my youngest left running, my youngest moved on tick 2 (bounded AND progressing), and all 101 rows survived both ticks.';

  DELETE FROM auth.users WHERE id = v_user;
END
$$;
ROLLBACK;
