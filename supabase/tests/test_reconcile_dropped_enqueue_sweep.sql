-- Test: dropped-enqueue reconciliation sweep (JOB-04, Phase 143).
--
-- Guards migrations
-- 20260816140000_reconcile_dropped_enqueue_sweep.sql: the pg_cron job
-- reconcile_dropped_enqueue_sweep, its '35 * * * *' cadence, its five predicate
-- conjuncts, its 1-hour grace window, its LIMIT-25 bound and the
-- {source: reconcile-sweep, detected_at} metadata marker the analytics worker
-- reads to fire its Sentry alert.
-- 20260819130500_reconcile_sweep_readmit_terminalized_orphans.sql (B4, Phase
-- 146.1): the SAME job re-registered under the SAME name and cadence with ONE
-- conjunct changed -- the zero-jobs test now exempts a 'failed_final' row whose
-- last_error carries Phase 144's fixed orphaned_running_reaped audit literal.
-- 20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql (R3, Phase 146.2):
-- the SAME job re-registered again, same name and cadence, with ONE conjunct
-- ADDED -- a readmit ATTEMPT CEILING. B4 opened a readmission path and named
-- "an hourly retry loop with no attempt ceiling" three times as the mode it
-- must not cause, but bounded only the NULL-last_error way in; R3 bounds the
-- loop itself at 3 marker rows per strategy. The count of those rows IS the
-- attempt counter (144 terminalizes IN PLACE, the sweep INSERTs anew, so it
-- rises by exactly one per cycle) -- zero DDL. Arms C5 / C5b are its
-- behavioural pair and Part 1 carries its text pins.
-- ⚠️ The jobname is the stable identifier and is unchanged; the JOBID is NOT
-- (unschedule + schedule assigns a fresh one, 20260817120000:420-426), so every
-- assertion in this file keys on the name.
--
-- Why the sweep exists (Rule 9 -- the WHY, not just the WHAT)
-- ----------------------------------------------------------
-- POST /api/strategies/csv-finalize commits the daily-returns rows
-- SYNCHRONOUSLY and then schedules the compute_analytics_from_csv enqueue via
-- after(). If the serverless instance is torn down before that callback runs,
-- the enqueue never happens and the strategy is left with dailies, ZERO
-- compute_jobs rows and NO strategy_analytics row -- forever. Every guard in
-- that route lives LEXICALLY INSIDE the closure that never ran, so no
-- in-request check can observe its own non-execution. The condition is only
-- visible from OUTSIDE the request, BY ABSENCE, on a schedule.
--
-- Phase 142's reaper does not cover it: that reaper terminalizes rows stranded
-- at computation_status='computing', and here there is no strategy_analytics
-- row at all.
--
-- ORACLE DISCIPLINE (the load-bearing property of this file)
-- ---------------------------------------------------------
-- Parts 2-4 read the REAL deployed body out of cron.job.command and
-- `EXECUTE v_command` it. They NEVER re-type the predicate. A gate that
-- re-implements the predicate passes when the DEPLOYED predicate is wrong --
-- which is exactly how every gate in phases 142/142.1 passed over a bound that
-- did not exist (D-19). Only executing the deployed body against real rows
-- falsifies it.
--
-- ANTI-GREEN-SKIP CONTRACT (read this before adding any presence gate)
-- -------------------------------------------------------------------
-- Part 1 is DELIBERATELY UNGATED and MUST FAIL when migration 20260816140000 is
-- unapplied -- that is this file's TDD RED proof, and it is designed to arrive
-- on the PR's FIRST sql-tests run, before Plan 04 applies the migration to the
-- TEST project. It follows
-- test_strategy_analytics_stuck_computing_reaper.sql:45-60 and deliberately does
-- NOT follow test_retention_orphaned_running.sql:71-83, whose presence gates
-- `RAISE NOTICE ... RETURN` and thereby no-op the ENTIRE file when the migration
-- has not reached the project. A gate that green-skips when the object under
-- test is absent is not evidence.
--
-- Parts 2-4 skip on ONE condition only: a genuinely absent pg_cron extension
-- (local dev). A cron job that is MISSING while pg_cron is PRESENT is an
-- EXCEPTION, never a skip. Part 1 does not even skip on that -- an absent
-- pg_cron there is a loud, explanatory EXCEPTION, because the whole point of
-- Part 1 is to be the free-standing RED.
--
-- TRANSACTION FRAMING (per-part only -- do not "simplify" this)
-- ------------------------------------------------------------
-- Every part that writes opens its OWN `BEGIN;`, immediately sets
-- `SET LOCAL lock_timeout = '5s'`, and closes with `ROLLBACK;`. There is NO
-- outer whole-file transaction, and adding one would be a silent data hazard:
-- psql's nested BEGIN emits `WARNING: there is already a transaction in
-- progress` and creates NO savepoint, so the FIRST inner rollback would end the
-- outer transaction and every later part would AUTOCOMMIT its seeds onto the
-- SHARED test project. The `SET LOCAL lock_timeout` bounds the row locks the
-- EXECUTEd DEPLOYED BODY itself takes: its batch CTE is FOR UPDATE SKIP LOCKED
-- and can briefly hold locks on up to 25 foreign candidate rows inside the
-- part's transaction, until the ROLLBACK. The `sql-tests` CI job carries the
-- repo-wide `shared-test-db` concurrency group (ci.yml), so two gate runs
-- cannot overlap at all; the 5 s bound stays as the fail-loud backstop.
--
-- SHARED-TEST-DB ISOLATION (isolation by construction)
-- ---------------------------------------------------
-- The deployed command is a GLOBAL `ORDER BY <dailies MAX> ASC LIMIT 25` over
-- public.strategies. Foreign rows on the shared TEST project compete with these
-- seeds for the 25-row budget.
--
-- This file does NOT neutralize them, and must never be "fixed" to. The three
-- cross-tenant neutralizing UPDATEs that the 142 gate once carried were DELETED
-- in Phase 142.1 (D-05 / D-18) -- not narrowed, not re-targeted -- because they
-- wrote across every OTHER tenant's rows on a shared project. Isolation here is
-- BY CONSTRUCTION: every row this file needs the sweep to heal carries a
-- csv_daily_returns.created_at of `now() - interval '100 years'`, which sorts
-- ahead of any plausible foreign candidate under the deployed ORDER BY, so the
-- seeds win the budget without touching a single row they do not own.
--
-- Every count and every status read below is SCOPED to the part's own seeded
-- strategy ids (`= ANY (v_seeded)`, or an identity comparison against one seeded
-- id) -- never a global count and never a global empty state. That is this
-- project's own recorded lesson from the e2e-seeded shared-DB pollution fix:
-- assert your OWN seed invariant.
--
-- RESIDUAL ASSUMPTION, stated honestly (D-18): correctness of the heal-arm
-- assertions rests on no foreign row on the shared TEST project carrying a
-- dailies MAX older than the century-back seed epoch. The authoring census
-- (143-CENSUS.md, 2026-08-16) measured ZERO candidates on TEST and ZERO on PROD,
-- so today that assumption is free. If enough such rows ever existed to consume
-- the 25-row budget, Part 2's and Part 4's assertions would redden for a reason
-- unrelated to the sweep. That is a loud, diagnosable failure -- unlike the
-- cross-tenant writes it replaces, whose cost was silent by design.
--
-- BACKDATE, NEVER SLEEP; AND NEVER COMPARE TWO now()s
-- --------------------------------------------------
-- There are no sleeps anywhere in this file. Elapsed time is crossed by seeding
-- csv_daily_returns.created_at a CENTURY back -- which is why DX-04 chose an
-- anchor column that is directly INSERT-writable (NOT NULL DEFAULT now(),
-- 20260522111839:40).
--
-- ⚠️ CORRECTION (2026-08-17). This note used to add "no writer re-stamps it --
-- the persist and derive upserts touch updated_at". That is FALSE. BOTH worker
-- derive paths DELETE a span and RE-UPSERT it (job_worker.py:4715-4746 and
-- :6779-6805), and a re-INSERTed row takes a fresh created_at from the DEFAULT
-- now(). Nothing in THIS file depends on the false half: the seeds are written
-- by this file's own INSERTs and no worker runs against them inside these
-- transactions, so the century-back backdate holds regardless. The reason the
-- anchor is still sound in PRODUCTION is the DIRECTION of the re-stamp -- it
-- moves MAX(created_at) forward, so a re-derived strategy looks FRESHER and is
-- SKIPPED, never healed early -- which is argued in full in the migration
-- header. Corrected here too because the same false sentence appeared in both
-- files, and a claim that survives in one place gets re-derived from there.
--
-- FROZEN CLOCK: each part runs inside ONE transaction, so now() is CONSTANT for
-- the whole part. Never assert by comparing two now()-derived values -- they are
-- equal by construction and such an assertion CANNOT FAIL. Every age below is a
-- seeded sentinel offset from the part's single `v_fresh := now()`.
--
-- ⛔ WHAT THIS FILE CANNOT PROVE -- do not let a green here be read as covering it
-- -------------------------------------------------------------------------------
--   (1) THE CRON ROLE'S RLS POSTURE (T-143-02 / landmine L-2). public.compute_jobs
--       carries FORCE ROW LEVEL SECURITY with a deny-all policy
--       (20260516104201:209, 20260411144407:233-239); FORCE exists specifically
--       to close the table-owner bypass. Whether the pg_cron JOB ROLE can write
--       through it is a property of THAT ROLE. The sql-tests job connects as the
--       psql user (TEST_SUPABASE_DB_URL), which is a DIFFERENT role. No assertion
--       in this file -- or in any CI gate -- is evidence about it. The only proof
--       is ONE REAL TICK on TEST inspected in cron.job_run_details, which Plan 04
--       owns as a BLOCKING pre-merge item.
--   (2) CONCURRENT-RACE BEHAVIOUR. `ON CONFLICT DO NOTHING` and
--       `FOR UPDATE SKIP LOCKED` are the sweep's two race defenses, and both were
--       measured at READ COMMITTED in Plan 02 against a live competing enqueue
--       (143-02-SUMMARY.md). That proof needs TWO sessions. This file is a single
--       psql session, so it CANNOT express it -- see the ⚠️ note on Part 3, which
--       says plainly what Part 3 does and does not falsify rather than letting a
--       green stand in for a proof that is not here.
--
-- pgTAP is NOT installed in this project (CLAUDE.md), so assertions
-- RAISE EXCEPTION on failure and a clean run prints NOTICEs only. Every RAISE
-- format string is a single literal with % placeholders (no concatenation).
--
-- ⚠️ NO psql BACKSLASH META-COMMANDS ANYWHERE IN THIS FILE, and this paragraph
-- deliberately does NOT spell any of them out. The sql-tests preflight
-- (ci.yml:951-1000) greps every supabase/tests/test_*.sql for the shell-escape,
-- the two client-side file-IO forms and the output-redirect form, and it scans
-- the WHOLE FILE, comments included. Naming them here in prose would make this
-- gate file refuse ITSELF -- the mirror image of the prose-hygiene incident the
-- guarded migration's own header records (an earlier draft of it wrote its cron
-- dollar-tag in a comment and broke the downstream body-extraction regex). Prose
-- must neither satisfy nor trip a mechanical gate; read ci.yml for the list.
--
-- No fixed UUID literals -- every id is gen_random_uuid(), because this file
-- runs against the SHARED test project concurrently with other PRs.
--
-- ⛔ DO NOT add this cron to supabase/tests/test_retention_crons_safe.sql. That
-- file's loop asserts every listed body matches `%where%created_at%`, and while
-- this body does read created_at, that file is a retention-DELETE register and
-- this job is neither.
--
-- ⚠️ C3 -- THE TEST-PROJECT SWEEP-CRON RESIDUAL (recorded 2026-08-18, Phase
-- 146.1; tracked in TODOS.md as D-13). DOCUMENT-ONLY. Read the refusal at the
-- end before acting on any of it.
-- ---------------------------------------------------------------------------
-- (a) THIS FILE IS NOT THE SOURCE OF THE RESIDUAL. Every part that writes opens
--     its own transaction and closes with ROLLBACK, and Part 2 additionally
--     DELETEs its seed user belt-and-braces. No seed here survives its part.
--
-- (b) THE HAZARD IS A FUTURE SEED VARIANT, not today's file. A seed that is
--     dailies-bearing AND leaves a NON-TERMINAL job row behind -- i.e. one that
--     escaped a rollback -- would feed exactly one permanently-unclaimable
--     'pending' compute_jobs row into the shared TEST project. That matters
--     because of the 05:30 UTC TEST-DB job backlog: cron jobid 9
--     (derive-allocator-key-dailies) fans out one job per api_key on a project
--     that has NO draining worker, and stale 'pending' rows sort AHEAD in
--     claim_compute_jobs_with_priority -- so one leaked row does not sit
--     harmlessly, it takes precedence and deepens a backlog that already
--     reddens the `python` CI job on a daily schedule.
--
-- (c) THE PER-TICK BOUND CONTAINS IT. Migration 20260819130500 WIDENS the
--     candidate set (terminalizer-marked orphans are readmitted) but does NOT
--     touch `LIMIT 25`, which is anchored word-bounded in Part 1, in that
--     migration's STEP 2 and in the vitest sibling. A widened predicate
--     therefore cannot flood the queue; at worst it drains at 25/hour.
--
-- (d) ⚠️ A DATED CLAIM, NOT A FACT -- RE-MEASURE BEFORE RELYING ON IT. The
--     terminalizer's own header records a CENSUS OF 2026-08-17: ~396 genuinely
--     stuck arm-A 'running' rows on the TEST project
--     (20260817120000:355-356). Those rows are not marked today, because
--     nothing has terminalized them yet. If they ARE terminalized, they become
--     ~396 rows carrying the orphaned_running_reaped audit literal, and every
--     one of them whose strategy also has dailies and no analytics becomes
--     sweep-eligible under 20260819130500 -- a few hundred TEST strategies
--     healing at <=25/hour rather than never. That is bounded and it is the
--     intended behaviour, but it is a step change on a shared CI project and it
--     must not arrive as a surprise. ⛔ THIS IS WHY PLAN 146.1-08 COUNTS
--     terminalizer-marked rows ON TEST (and on PROD) IMMEDIATELY BEFORE MERGE.
--     A census quoted without its date is how a dated claim becomes an assumed
--     fact; this one is dated 2026-08-17 and is already stale by construction.
--
-- (e) ⛔ THE REFUSAL, IN WRITING. C3 is the one item in this phase that tempts a
--     cleanup migration, so the refusal is recorded rather than assumed:
--       * NEVER delete a 'pending' compute_jobs row, here or in a migration.
--         A leaked row is a diagnosable nuisance; a DELETE that races a real
--         enqueue is silent job loss, and the deferred orphaned-running purge
--         (DELETE-vs-reset) is unresolved for exactly this reason.
--       * NEVER unschedule cron jobid 9 (derive-allocator-key-dailies), or any
--         cron job other than reconcile_dropped_enqueue_sweep BY NAME.
--       * NEVER touch the process_key_unified_backbone flag row.
--     C3 is document-or-guard, lowest priority. It is documented here. It is
--     NOT a cleanup migration and must not become one.
--
-- Usage:
--   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_reconcile_dropped_enqueue_sweep.sql
--
-- Run order: AFTER migrations 20260816140000 AND 20260819130500 are applied to
-- the project. Before 20260816140000, Part 1 REDs by design (the job is not
-- registered at all). Before 20260819130500 but after 20260816140000, Part 1's
-- B4 marker anchor and Part 2's arm C4 RED -- also by design, and that is this
-- commit's TDD RED: it arrives on the PR's FIRST sql-tests run, before Plan
-- 146.1-08 applies the new migration to the TEST project.
--
-- ⭐ MACHINE-EXECUTABLE TWINS (phase 164.4.1, PGCRON-LANE). Each prose
-- RED-UNDER below carries an adjacent `RED-UNDER-M` object that
-- scripts/mutation-runner executes on every push: it mutates COPIES on a
-- throwaway pg-lane cluster, requires the FIRST `TEST FAILED (…)` to name that
-- arm, and restores GREEN. Schema: scripts/mutation-runner/GRAMMAR.md.
--
-- ⚠️ THE APPLY LIST BELOW IS SIZED BY THE THREE `SKIP Part` NOTICES AT :763,
-- :1335 AND :1450, NOT BY THIS HEADER. Parts 2, 3 and 4 each `RAISE NOTICE
-- 'SKIP Part …' … RETURN` when pg_cron is absent, so on a lane without the
-- extension THIRTY-SEVEN of this file's thirty-nine sections are un-falsifiable:
-- their twins come back `no-red` naming no cause, and a silently-ineffective
-- pg_cron preload would be invisible. (Part 1 does not skip -- its `1/JOB-04`
-- guard at :337-339 RAISEs instead, which is the newer of the two spellings
-- this corpus carries.) So the list carries 20260513094906 -- the
-- `CREATE EXTENSION pg_cron` those three skips key on -- before every
-- cron-touching migration.
--
-- MEASURED 2026-09-05 on the lane, with this list: the baseline exits 0, prints
-- ZERO gate-owned SKIP lines and all FOUR `Part … OK` notices.
--   scoped count:
--     `grep -a -cE '^psql:[^ ]*test_reconcile_dropped_enqueue_sweep\.sql:[0-9]+: NOTICE:.*SKIP Part'`
--     -> 0
-- ⛔ Do NOT read that zero off an unscoped `grep -i SKIP`, and do NOT read it
-- off the prefix-scoped-but-token-only form either. BOTH over-count here:
--   * Postgres itself emits `… does not exist, skipping` NOTICEs from the
--     `DROP … IF EXISTS` statements inside the applied migrations (17 such
--     lines on this list, MEASURED), and none of them is this file's;
--   * this file's OWN Part 1 OK notice contains the words `SKIP LOCKED` -- it
--     is one of the anchors Part 1 asserts -- so the prefix-scoped form
--     WITHOUT the `Part` token counts 1 and can never reach 0 while the gate
--     is green (MEASURED: that exact form returned 1 on a fully green run).
-- The load-bearing token is `SKIP Part`, which is the literal all three of this
-- file's skip arms use and which no anchor prose contains.
--
-- ⚠️ ORACLE SCOPE, stated honestly, and it is narrower than the guarded-
-- migrations list at the top of this file. The lane's `cron.job.command` oracle
-- is the body of the LAST writer in the apply list, 20260819150000 (the R3
-- readmit attempt ceiling). 20260816140000 registers the job and 20260819130500
-- re-registers it with the B4 exemption, but `cron.schedule` upserts by NAME,
-- so only the last one's bytes survive. MEASURED by one-out ablation on real
-- lanes 2026-09-05: dropping EITHER 20260816140000 or 20260819130500 leaves the
-- whole file GREEN (rc=0), while dropping 20260819150000 REDs Part 1 with
-- `TEST FAILED (1/JOB-04/D-02/R3)`. Both are kept in the list anyway -- they are
-- the chain a real project applies, and their own STEP 2 self-verifies run --
-- but EVERY body-oracle twin below targets 20260819150000. A twin that edited
-- an earlier migration's cron body would be overwritten and come back `no-red`.
--
-- ⚠️ WHAT THE LANE CANNOT FALSIFY HERE, MEASURED rather than assumed. Two
-- assertions in Part 1 are dominated on this lane and are NOT proven by a twin
-- of their own; each is recorded at its site:
--   * the `v_count = 0` "job not registered" arm and the `v_count <> 1` "exactly
--     one row" arm share the section `1/JOB-04` with fifteen other raises, so the
--     section is proven through a different, non-dominated raise;
--   * every `IF v_command IS NULL` guard at the head of Parts 2/3/4 is
--     unreachable while the job exists, for the same reason.
-- Section coverage is what the runner counts, and it is complete; per-RAISE
-- coverage is not claimed by this note or anywhere else.
--
-- ⚠️ `scripts/pg-lane/fixtures/30-fixture-strategies-status-default.sql` is in
-- the list for a reason that is easy to misread as cosmetic and is not.
-- 01-fixture-core.sql declares `status TEXT` bare-nullable; production declares
-- it `NOT NULL DEFAULT 'draft'` (20260405061911:63). The deployed body's FIRST
-- conjunct is `s.status <> 'archived'`, and `NULL <> 'archived'` is NULL, so
-- without the stand-in EVERY seed in Parts 2/3/4 drops out of the batch CTE and
-- the heal arms RED for a reason that has nothing to do with the predicate under
-- test. MEASURED by ablation: without it the file REDs
-- `TEST FAILED (2/arm A/JOB-04/SC#1) … got 0 compute_jobs rows`.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/30-fixture-strategies-status-default.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/12-fixture-profiles-is-admin.sql","supabase/migrations/20260513094906_enable_pg_cron.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","scripts/pg-lane/fixtures/29-fixture-compute-jobs-priority.sql","supabase/migrations/20260515114555_compute_jobs_claim_token_fencing.sql","supabase/migrations/20260522111839_csv_daily_returns.sql","supabase/migrations/20260522111858_compute_analytics_from_csv_kind.sql","supabase/migrations/20260614120000_derive_broker_dailies_kind.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260816140000_reconcile_dropped_enqueue_sweep.sql","supabase/migrations/20260819130500_reconcile_sweep_readmit_terminalized_orphans.sql","supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql"]}

-- ==========================================================================
-- Part 1 -- STRUCTURAL, UNGATED, ZERO SIDE EFFECTS. This is the part that must
-- redden when the migration is unapplied. No transaction: it only reads
-- catalogs. NO `RETURN` and NO skip arm appears anywhere in this block.
--
-- This part is an INDEPENDENT copy of the assertions the migration's own STEP 2
-- self-verify makes. That duplication is deliberate and is not redundancy:
-- STEP 2 runs ONCE, at apply time, and proves nothing about what is deployed
-- today; this part runs on every CI sql-tests run against whatever body pg_cron
-- currently holds, so an out-of-band `cron.unschedule` or a hand-edited job row
-- reddens HERE and nowhere else.
-- ==========================================================================
DO $$
DECLARE
  v_command  TEXT;
  v_schedule TEXT;
  v_count    INTEGER;
  v_mat      INTEGER;
  v_anchor   INTEGER;
  v_jobs     INTEGER;
  v_stripped TEXT;
  v_marker   INTEGER;
BEGIN
  -- Deliberately an EXCEPTION, not a skip. Part 1's whole job is to be the
  -- free-standing RED, and it is also what turns a missing `cron` schema into a
  -- legible message instead of a bare 42P01 from the catalog read below.
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-04): pg_cron is NOT installed on this database, so the dropped-enqueue reconciliation sweep cannot be registered and the JOB-04 hole is open. This is deliberately an EXCEPTION and not a skip: a gate that green-skips when the object under test is absent is not evidence. Run this file against the TEST project (TEST_SUPABASE_DB_URL), not a bare local database.';
  END IF;

  SELECT count(*) INTO v_count
    FROM cron.job WHERE jobname = 'reconcile_dropped_enqueue_sweep';
  IF v_count = 0 THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-04): pg_cron IS installed but the reconcile_dropped_enqueue_sweep job is NOT registered. Migration 20260816140000 is unapplied to this project, or the job was unscheduled out of band. Until it is registered a dropped csv-finalize after() enqueue leaves a strategy with dailies, zero compute_jobs rows and no strategy_analytics row FOREVER, and nothing in the request path can report it.';
  END IF;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-04): expected exactly ONE cron job named reconcile_dropped_enqueue_sweep, found %. Two rows would run the sweep twice per hour and double the per-tick blast radius the LIMIT exists to cap.', v_count;
  END IF;

  SELECT command, schedule
    INTO v_command, v_schedule
    FROM cron.job WHERE jobname = 'reconcile_dropped_enqueue_sweep';

  IF v_command IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-04): the reconcile_dropped_enqueue_sweep job row carries a NULL command. pg_cron would fire an empty tick every hour and the run log would look healthy while nothing is healed.';
  END IF;

  -- STRING equality, never a ::INT cast on a schedule field: four of the five
  -- fields are '*' and casting one would error.
  IF v_schedule IS DISTINCT FROM '35 * * * *' THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-04): the deployed cadence is % and not the expected 35 * * * *. Minute 35 is what keeps this sweep clear of 142 reaper quarter-hour grid and of every other registered slot, which is what keeps the pg_cron slot uncontended and the run log readable.', v_schedule;
  END IF;

  -- ----- POSITIVE anchors on the DEPLOYED body -----
  -- The three-table triangle, all schema-qualified: an unqualified name resolves
  -- through the cron session search_path and could bind to another schema.
  IF v_command NOT ILIKE '%public.strategies%' THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-04): the deployed body does not drive from a schema-qualified public.strategies. An unqualified name resolves through the cron session search_path and could bind to another schema entirely.';
  END IF;
  IF v_command NOT ILIKE '%public.csv_daily_returns%' THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-04): the deployed body does not read public.csv_daily_returns, so it has no dailies conjunct at all and would enqueue analytics for strategies that have no data to compute from.';
  END IF;
  -- The zero-jobs conjunct, pinned by OCCURRENCE COUNT -- mirroring the
  -- MAX(DG.CREATED_AT) anchor further down, and for the same reason.
  -- ⚠️ A bare `NOT ILIKE '%public.compute_jobs%'` gate stood here and COULD NOT
  -- FAIL. The table is named TWICE in the body -- once in the zero-jobs
  -- NOT EXISTS conjunct and once as the INSERT target -- so deleting the very
  -- conjunct this message names leaves the INSERT satisfying the gate all by
  -- itself. MEASURED 2026-08-17 against the deployed body with the conjunct
  -- removed: this part still printed "Part 1 OK ... five predicate conjuncts
  -- anchored". Same defect class as the marker literal a Sentry tag satisfied
  -- (143-03, f62c3866). ⚠️ If a future edit legitimately changes how many times
  -- the body names the table, this count and its two siblings (the migration's
  -- STEP 2 self-verify, src/__tests__/reconcile-dropped-enqueue-sweep.test.ts)
  -- move in the SAME commit.
  -- ⚠️ THE EXPECTED COUNT MOVED FROM 2 TO 3 (R3, Phase 146.2, migration
  -- 20260819150000). The readmit ATTEMPT CEILING is a NEW scalar subquery over
  -- the same table, so unlike B4 -- which added a condition INSIDE the existing
  -- subquery and honestly left this at 2 -- it genuinely adds a third table
  -- reference. This count and its two siblings (that migration's STEP 2 and
  -- src/__tests__/reconcile-dropped-enqueue-sweep.test.ts) moved in the SAME
  -- commit as the migration.
  v_jobs := (length(upper(v_command)) - length(replace(upper(v_command), 'PUBLIC.COMPUTE_JOBS', ''))) / length('PUBLIC.COMPUTE_JOBS');
  -- RED-UNDER: schema-unqualify the ceiling subquery's FROM in the LAST writer
  --            (20260819150000), so the deployed body names PUBLIC.COMPUTE_JOBS twice
  --            instead of three times. That is exactly the drift this counter exists to
  --            catch: an unqualified name resolves through the cron session search_path
  --            and could bind to another schema entirely, and the count -- not a bare
  --            presence gate -- is what notices, because the INSERT target alone would
  --            satisfy `NOT ILIKE '%public.compute_jobs%'` by itself.
  --            LAYERED: that migration's STEP 2 self-verify carries the SAME v_jobs <> 3
  --            check (20260819150000:552), so a single-step mutation ABORTS the apply
  --            instead of reddening this arm. MEASURED: step 1 alone -> baseline abort.
  -- RED-UNDER-M: {"arm":"1/JOB-04/D-02/R3","apply":[{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"                   FROM public.compute_jobs cjc\n","replace":"                   FROM compute_jobs cjc\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"  IF v_jobs <> 3 THEN\n","replace":"  IF FALSE THEN\n","occurrences":1}]}
  IF v_jobs <> 3 THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-04/D-02/R3): the deployed body names public.compute_jobs % times, expected 3 (the zero-jobs NOT EXISTS conjunct + the readmit-ceiling subquery + the INSERT target). Two means ONE of the two predicates is gone: without the zero-jobs conjunct every strategy holding a healthy in-flight chain -- a running derive_broker_dailies mid-chain, most of all -- is re-enqueued on the next tick; without the ceiling subquery a strategy whose input reliably kills its worker rides the reap-readmit cycle forever. One means only the INSERT target survives and it is satisfying this gate by itself. Zero means the sweep no longer writes at all.', v_jobs;
  END IF;

  -- ----- B4: the terminalizer-marker exemption (20260819130500) ---------
  -- ⚠️ ANCHORED OVER A COMMENT-STRIPPED BODY, and that is required rather than
  -- fastidious. cron.job.command preserves SQL comments verbatim, so an anchor
  -- run over the raw command false-PASSes the exact neuter it exists to catch:
  -- delete the exemption from the CODE and leave its comment behind. Same
  -- defect class as the marker literal a Sentry tag satisfied (143-03,
  -- f62c3866) and the unbounded percent-LIKE this milestone corrected on the
  -- fold's self-verify. This anchor mirrors the migration's own STEP 2, and it
  -- is the one that runs CONTINUOUSLY -- STEP 2 runs once, at apply time, and
  -- proves nothing about what pg_cron holds today. The behavioural counterpart
  -- is Part 2 arm C4.
  v_stripped := regexp_replace(v_command, '--[^\n]*', '', 'g');
  -- ⚠️ EXPECTED COUNT MOVED FROM 1 TO 2 (R3, Phase 146.2, migration
  -- 20260819150000): the B4 exemption plus the readmit ceiling, both keyed on
  -- the same fixed audit literal. Its 2-occurrence count in the TERMINALIZER is
  -- gated at 20260817120000:741, so marker drift REDs upstream before it could
  -- silently un-key either clause here.
  v_marker := (length(upper(v_stripped)) - length(replace(upper(v_stripped), 'ORPHANED_RUNNING_REAPED', ''))) / length('ORPHANED_RUNNING_REAPED');
  -- RED-UNDER: replace the ceiling subquery's marker LIKE with a bare IS NOT NULL in
  --            the last writer, so the deployed body carries the terminalizer audit
  --            literal ONCE instead of twice. A ceiling that counts every failed_final
  --            row rather than the marked ones excludes healthy strategies that merely
  --            have failure history, and the count gate is the only thing that sees it.
  --            LAYERED (three steps): 20260819150000's STEP 2 re-checks both the ceiling
  --            SHAPE (:508) and the marker count (:518), so both are re-based or the
  --            apply aborts. MEASURED: step 1 alone -> baseline abort at :508.
  -- RED-UNDER-M: {"arm":"1/JOB-04/B4/R3","apply":[{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"                    AND cjc.last_error LIKE 'orphaned_running_reaped:%'\n","replace":"                    AND cjc.last_error IS NOT NULL\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"  IF v_stripped !~* 'count\\(\\*\\)[^;]*orphaned_running_reaped[^;]*<[[:space:]]*\\m3\\M' THEN\n","replace":"  IF FALSE THEN\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"  IF v_marker <> 2 THEN\n","replace":"  IF FALSE THEN\n","occurrences":1}]}
  IF v_marker <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-04/B4/R3): the deployed body carries the terminalizer audit marker % times in EXECUTABLE code, expected exactly 2 (the B4 readmit exemption + the R3 attempt ceiling). One means one of the pair is gone. Without the exemption, a chain-mid orphan that 144 terminalized for its audit trail once again excludes its own strategy from this sweep FOREVER -- dailies present, no analytics row, recovered by nobody and with no user surface once the wizard 15-minute amber backstop has passed. Without the ceiling, those readmissions are unbounded: worker dies, row is reaped at 4h, sweep readmits, forever. Zero means both are gone. More than two means a clause was duplicated, or the marker leaked into a third clause nothing else gates.', v_marker;
  END IF;
  -- ----- R3: the readmit ATTEMPT CEILING (20260819150000) ---------------
  -- (a) The LITERAL, word-bounded. Same lesson as LIMIT 25 below: a ceiling
  -- widened to 30 or 300 CONTAINS the digit 3, so a substring gate would accept
  -- a bound nobody ratified. \m and \M also reject '<= 3', which quietly buys a
  -- fourth cycle. MEASURED 2026-08-19 on a throwaway postgres:16 against this
  -- migration's own STEP 2: the '< 30' body REDs, the '< 3' body passes.
  -- RED-UNDER: widen the readmit ceiling from `< 3` to `< 30` in the last writer. This
  --            is the exact widening the word-bounded pattern exists to refuse: '30'
  --            CONTAINS the digit 3, so the substring gate this pin replaced would have
  --            accepted a bound nobody ratified and a strategy whose input reliably kills
  --            its worker would ride the reap-readmit cycle ten times over.
  --            LAYERED: STEP 2 carries the same literal pin (:498) and the same shape pin
  --            (:508). MEASURED: step 1 alone -> baseline abort at :498.
  -- RED-UNDER-M: {"arm":"1/JOB-04/R3","apply":[{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"                    AND cjc.last_error LIKE 'orphaned_running_reaped:%'\n               ) < 3\n","replace":"                    AND cjc.last_error LIKE 'orphaned_running_reaped:%'\n               ) < 30\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"  IF v_stripped !~ '<[[:space:]]*\\m3\\M' THEN\n","replace":"  IF FALSE THEN\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"  IF v_stripped !~* 'count\\(\\*\\)[^;]*orphaned_running_reaped[^;]*<[[:space:]]*\\m3\\M' THEN\n","replace":"  IF FALSE THEN\n","occurrences":1}]}
  IF v_stripped !~ '<[[:space:]]*\m3\M' THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-04/R3): the deployed body does not carry a word-bounded readmit ceiling of < 3. Either the bound is gone -- and a strategy whose input reliably kills its worker rides the reap-readmit cycle FOREVER at one worker slot every ~5 hours, which is the unbounded retry loop arms C2/C2b/C3 and B4 own header keep naming -- or it has been widened to a value that merely STARTS with 3, or relaxed to <= 3. Part 2 arms C5 and C5b are the behavioural half of this pin.';
  END IF;
  -- (b) The SHAPE, in ORDER. The literal alone would pass a body that counts
  -- the WRONG thing -- all compute_jobs rows, say, which would exclude every
  -- healthy strategy carrying three historical jobs. The ceiling is only
  -- meaningful if it counts the attempt signal itself: the marker rows, the one
  -- thing that strictly increments once per reap-readmit cycle. '[^;]*' bounds
  -- the match to the single statement the batch CTE and its INSERT form.
  IF v_stripped !~* 'count\(\*\)[^;]*orphaned_running_reaped[^;]*<[[:space:]]*\m3\M' THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-04/R3): the deployed body does not compare a COUNT OF TERMINALIZER-MARKED ROWS against the ceiling. A bound that counts something else is not this bound: counting all compute_jobs rows would exclude healthy strategies that merely have history, and comparing a constant to nothing is a bound that cannot bind. The marker count is the attempt counter precisely because 144 terminalizes IN PLACE and this sweep INSERTs anew, so it rises by exactly one per cycle.';
  END IF;
  -- RED-UNDER: drop the IS TRUE wrapper from the B4 exemption in the last writer. The
  --            unwrapped form evaluates to NULL for a failed_final row with no error
  --            text, that row drops out of the NOT EXISTS subquery, and a GENUINE
  --            permanent failure is HEALED hourly forever. Part 2 arm C2b is the
  --            behavioural half of this pin.
  --            LAYERED: STEP 2 re-checks `%IS TRUE%` at :531.
  -- RED-UNDER-M: {"arm":"1/JOB-04/B4","apply":[{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"                              AND cj.last_error LIKE 'orphaned_running_reaped:%') IS TRUE)\n","replace":"                              AND cj.last_error LIKE 'orphaned_running_reaped:%'))\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"  IF v_stripped NOT ILIKE '%IS TRUE%' THEN\n","replace":"  IF FALSE THEN\n","occurrences":1}]}
  IF v_stripped NOT ILIKE '%IS TRUE%' THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-04/B4): the deployed body carries the terminalizer-marker exemption WITHOUT its IS TRUE wrapper. last_error is NULLABLE and NULL LIKE ''x%%'' is NULL, not FALSE, so the unwrapped form evaluates to NULL for a failed_final row with no error text, that row drops out of the NOT EXISTS subquery, and a GENUINE permanent failure is HEALED -- an hourly retry loop with no attempt ceiling, which is the arm-C2 failure mode this exemption was written not to cause. Part 2 arm C2b is the behavioural half of this pin.';
  END IF;
  IF v_command NOT ILIKE '%public.strategy_analytics%' THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-04): the deployed body does not reference public.strategy_analytics. That conjunct is the ONLY protection for healthy retention-aged strategies (retention_compute_jobs_done DELETEs done rows at 30 days), so its absence is a mass re-enqueue of the entire historical corpus on the next tick.';
  END IF;
  -- RED-UNDER: schema-unqualify the composite-exclusion subquery's FROM in the last
  --            writer. The composite exclusion is the money-surface guard: enqueueing
  --            compute_analytics_from_csv on a composite overwrites a correct composite
  --            headline with the single-key computation its own handler abandoned, and an
  --            unqualified strategy_keys can bind through the cron session search_path.
  --            LAYERED: STEP 2 re-checks `%public.strategy_keys%` at :561.
  -- RED-UNDER-M: {"arm":"1/JOB-04/DX-05","apply":[{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"                   FROM public.strategy_keys sk\n","replace":"                   FROM strategy_keys sk\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"  IF v_command NOT ILIKE '%public.strategy_keys%' THEN\n","replace":"  IF FALSE THEN\n","occurrences":1}]}
  IF v_command NOT ILIKE '%public.strategy_keys%' THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-04/DX-05): the deployed body does not exclude composites via public.strategy_keys. Enqueueing compute_analytics_from_csv on a composite overwrites a correct composite headline with the divergent single-key computation its own handler deliberately abandoned -- silent corruption of a CORRECT row on a money surface.';
  END IF;

  -- The FOUR excluded terminal/racing statuses, each quoted so 'complete' cannot
  -- be satisfied by the substring inside 'complete_with_warnings'.
  -- RED-UNDER: delete 'computing' from the terminal-analytics exclusion list in the last
  --            writer. That value is Phase 142's reaper's own row: the split by
  --            computation_status is what keeps the two mechanisms from racing the same
  --            strategy. SINGLE-STEP by MEASUREMENT: 20260819150000's STEP 2 pins only
  --            complete_with_warnings out of the four (:558), so this one needs no
  --            re-base -- unlike its D-03 sibling directly below, which also does not.
  -- RED-UNDER-M: {"arm":"1/JOB-04/D-04","apply":[{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"                    AND sa.computation_status IN ('computing', 'complete', 'complete_with_warnings', 'failed')\n","replace":"                    AND sa.computation_status IN ('complete', 'complete_with_warnings', 'failed')\n","occurrences":1}]}
  IF v_command NOT ILIKE '%''computing''%' THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-04/D-04): the deployed body no longer excludes computation_status computing. That is 142 reaper own row: the split by computation_status is what keeps the two mechanisms from racing the same strategy, and without it this sweep re-enqueues a row the reaper is mid-way through terminalizing.';
  END IF;
  -- RED-UNDER: delete 'complete' from the exclusion list in the last writer. This is THE
  --            MASS-RE-ENQUEUE INCIDENT: retention deletes done job rows at 30 days, so
  --            every healthy 31-day-old strategy already matches dailies-present-and-
  --            zero-jobs, and this conjunct is the only thing between the first tick and a
  --            re-enqueue of the entire historical corpus. The `%''complete''%` spelling is
  --            quoted on both sides precisely so 'complete_with_warnings' cannot satisfy
  --            it -- MEASURED here: with 'complete' removed and the warnings value left in
  --            place, this arm still REDs.
  -- RED-UNDER-M: {"arm":"1/JOB-04/D-03","apply":[{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"                    AND sa.computation_status IN ('computing', 'complete', 'complete_with_warnings', 'failed')\n","replace":"                    AND sa.computation_status IN ('computing', 'complete_with_warnings', 'failed')\n","occurrences":1}]}
  IF v_command NOT ILIKE '%''complete''%' THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-04/D-03): the deployed body no longer excludes computation_status complete. With retention deleting done compute_jobs rows at 30 days, EVERY healthy 31-day-old strategy matches dailies-present-and-zero-jobs, so this conjunct is the only thing standing between the first tick and a re-enqueue of the entire historical corpus -- the mass-re-enqueue incident. Measured on PROD at authoring time: 4 of the 4 zero-job strategies with dailies are excluded SOLELY by this conjunct.';
  END IF;
  IF v_command NOT ILIKE '%''complete_with_warnings''%' THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-04/D-03): the terminal-analytics exclusion list is incomplete -- complete_with_warnings is missing. Every strategy holding that terminal status would be re-enqueued and its correct headline recomputed: the mass-re-enqueue incident, partial edition.';
  END IF;
  IF v_command NOT ILIKE '%''failed''%' THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-04/D-03): the deployed body no longer excludes computation_status failed. A terminal failure belongs to nobody; re-enqueueing it turns a settled failure into an hourly retry loop with no attempt ceiling.';
  END IF;

  -- The write arm and its marker.
  IF v_command NOT ILIKE '%compute_analytics_from_csv%' THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-04): the deployed body does not enqueue the compute_analytics_from_csv kind, so nothing it inserts would ever be dispatched to the analytics handler.';
  END IF;
  -- RED-UNDER: change the metadata source literal from 'reconcile-sweep' to
  --            'reconcile_sweep' in the last writer. analytics-service/main_worker.py reads
  --            the EXACT hyphenated value on claim to fire its Sentry event, so this drift
  --            heals the strategy SILENTLY: SC#1's alert half becomes false while both
  --            halves' own unit tests stay green.
  --            LAYERED: STEP 2 re-checks `%reconcile-sweep%` at :567.
  -- RED-UNDER-M: {"arm":"1/JOB-04/D-11","apply":[{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"             jsonb_build_object('source', 'reconcile-sweep', 'detected_at', now())\n","replace":"             jsonb_build_object('source', 'reconcile_sweep', 'detected_at', now())\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"  IF v_command NOT ILIKE '%reconcile-sweep%' THEN\n","replace":"  IF FALSE THEN\n","occurrences":1}]}
  IF v_command NOT ILIKE '%reconcile-sweep%' THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-04/D-11): the deployed body does not stamp the reconcile-sweep metadata marker. analytics-service/main_worker.py reads that EXACT value on claim to fire its Sentry event, so without it a dropped enqueue is healed SILENTLY -- SC#1 alert half becomes false while both halves own unit tests stay green.';
  END IF;
  IF v_command NOT ILIKE '%detected_at%' THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-04/D-11): the deployed body does not stamp detected_at. That key is the other half of the cross-language marker contract main_worker.py reads; drift in either key kills the alert.';
  END IF;

  -- The bound and the race clauses.
  -- ⚠️ WORD-BOUNDED, never a substring. This was `NOT ILIKE '%LIMIT 25%'` until
  -- 2026-08-17. MEASURED: '... LIMIT 2500 ...' ILIKE '%LIMIT 25%' is TRUE, so a
  -- 100x widening of the per-tick blast radius passed this gate, its migration
  -- sibling and its vitest sibling all at once. The bound is the single clause
  -- this suite exists to hold, so it must be pinned by a pattern that a WIDER
  -- limit fails. ([^0-9]|$) -- the `|$` arm matters: without it a body ending
  -- exactly at 'LIMIT 25' would false-RED.
  -- RED-UNDER: widen the per-tick bound to LIMIT 250 in the last writer -- a 10x blast
  --            radius that still CONTAINS the literal substring 'LIMIT 25', which is
  --            exactly why this pin is a word-bounded regex and not `NOT ILIKE '%LIMIT
  --            25%'`. Part 4 is the behavioural bound proof; this is its text half.
  --            LAYERED: STEP 2 carries the same word-bounded pattern at :594.
  -- RED-UNDER-M: {"arm":"1/JOB-04/D-08","apply":[{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"         LIMIT 25\n         FOR UPDATE SKIP LOCKED\n","replace":"         LIMIT 250\n         FOR UPDATE SKIP LOCKED\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"  IF v_command !~ 'LIMIT[[:space:]]+25([^0-9]|$)' THEN\n","replace":"  IF FALSE THEN\n","occurrences":1}]}
  IF v_command !~ 'LIMIT[[:space:]]+25([^0-9]|$)' THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-04/D-08): the deployed body does not carry a word-bounded LIMIT 25. Either the bound is gone -- an unbounded sweep is exactly the blast radius the cap exists to hold, and a single tick could enqueue the whole candidate population at once -- or it has been widened to LIMIT 25<digits>, which multiplies that blast radius while still containing the literal substring the old substring gate tested for.';
  END IF;
  IF v_command NOT ILIKE '%FOR UPDATE SKIP LOCKED%' THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-04): the deployed body dropped FOR UPDATE SKIP LOCKED. Measured in Plan 02 at READ COMMITTED: an INSERT into compute_jobs takes an FK KEY SHARE lock on its parent strategies row, so this clause is what makes the sweep SKIP a strategy the live enqueue path is mid-insert on. Without it the sweep BLOCKS on that lock instead.';
  END IF;
  -- RED-UNDER: delete ON CONFLICT DO NOTHING from the INSERT in the last writer. Measured
  --            in Phase 143 Plan 02 at READ COMMITTED: with SKIP LOCKED removed the sweep
  --            blocks on the FK lock, meets the committed row on release, and this clause
  --            is what absorbs it; remove BOTH and the tick dies on 23505, losing the
  --            healed count and skipping every remaining candidate in the batch.
  --            LAYERED: STEP 2 re-checks the clause at :573.
  -- RED-UNDER-M: {"arm":"1/JOB-04/SC#2","apply":[{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"        FROM batch b\n      ON CONFLICT DO NOTHING;\n","replace":"        FROM batch b;\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"  IF v_command NOT ILIKE '%ON CONFLICT DO NOTHING%' THEN\n","replace":"  IF FALSE THEN\n","occurrences":1}]}
  IF v_command NOT ILIKE '%ON CONFLICT DO NOTHING%' THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-04/SC#2): the deployed body lost ON CONFLICT DO NOTHING. Measured in Plan 02: with SKIP LOCKED removed the sweep blocks on the FK lock, meets the committed row on release, and this clause is what absorbs it; remove BOTH and the tick dies on 23505, losing the healed count and skipping every remaining candidate in the batch.';
  END IF;
  -- RED-UNDER: shrink the grace window from one hour to thirty minutes in the last writer.
  --            Without a grace window wide enough to outlast the live after() enqueue this
  --            sweep exists to backstop, the sweep RACES it and inserts duplicate work on
  --            the NORMAL path -- it would fire on every healthy CSV finalize.
  --            ⚠️ THIS TWIN CARRIES THE WHOLE `1/JOB-04` SECTION, which fifteen separate
  --            RAISEs in this part share. The section's first three raises (pg_cron absent,
  --            job not registered, exactly-one-row) are NOT independently falsifiable on a
  --            lane: an unregistered job aborts 20260819150000's own STEP 2 at apply time,
  --            and an absent pg_cron aborts 20260513094906. Section coverage is what the
  --            runner counts and it is complete; per-RAISE coverage is not claimed.
  --            LAYERED: STEP 2 re-checks the grace literal at :579.
  -- RED-UNDER-M: {"arm":"1/JOB-04","apply":[{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"               ) < now() - interval '1 hour'\n","replace":"               ) < now() - interval '30 minutes'\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"  IF v_command NOT ILIKE '%interval ''1 hour''%' THEN\n","replace":"  IF FALSE THEN\n","occurrences":1}]}
  IF v_command NOT ILIKE '%interval ''1 hour''%' THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-04): the deployed body does not carry the 1-hour grace literal. Without a grace window the sweep RACES the live after() enqueue it exists to backstop and inserts duplicate work on the NORMAL path.';
  END IF;
  -- RED-UNDER: replace the archived-status exclusion with a vacuous IS NOT NULL in the
  --            last writer. Archived strategies would then consume worker slots computing
  --            analytics nobody reads. Note 'draft' is DELIBERATELY included by contrast --
  --            a drop victim may sit pre-terminal precisely because nothing advanced it.
  --            LAYERED: STEP 2 re-checks `%archived%` at :582.
  -- RED-UNDER-M: {"arm":"1/JOB-04/DX-06","apply":[{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"         WHERE s.status <> 'archived'\n","replace":"         WHERE s.status IS NOT NULL\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"  IF v_command NOT ILIKE '%archived%' THEN\n","replace":"  IF FALSE THEN\n","occurrences":1}]}
  IF v_command NOT ILIKE '%archived%' THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-04/DX-06): the deployed body lost the archived-status exclusion, so archived strategies would consume worker slots computing analytics nobody reads.';
  END IF;

  -- The grace anchor, pinned POSITIVELY (twice: the WHERE conjunct and the
  -- ORDER BY). Pinning it positively rather than negatively forbidding
  -- s.created_at is deliberate -- "created_at" is a substring of the legitimate
  -- dailies reference, so a negative token gate on it would be a collision
  -- hazard. The ORDER BY is what makes the bounded batch deterministic, so
  -- losing it is a real defect and not a style change.
  v_anchor := (length(upper(v_command)) - length(replace(upper(v_command), 'MAX(DG.CREATED_AT)', ''))) / length('MAX(DG.CREATED_AT)');
  IF v_anchor <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-04): the deployed body reads the dailies MAX grace anchor % times, expected 2 (one in the WHERE conjunct, one in the ORDER BY). Zero means the grace window or the anchor is gone; one usually means the ORDER BY was dropped, which removes the determinism the bounded batch depends on for forward progress across ticks.', v_anchor;
  END IF;

  -- ⚠️ SHAPE gate, NOT a proof of the bound. Measured 2026-08-16 (143-02): in
  -- THIS shape removing the keyword changes neither the plan nor the result,
  -- because the CTE carries a locking clause and Postgres does not inline a
  -- locking CTE. The bound is proven ONLY by Part 4, which executes the body
  -- against LIMIT+1 real rows. Never let a green here be read as a bound proof.
  v_mat := (length(upper(v_command)) - length(replace(upper(v_command), 'AS MATERIALIZED', ''))) / length('AS MATERIALIZED');
  -- RED-UNDER: drop the explicit MATERIALIZED fence from the batch CTE in the last writer.
  --            This is SHAPE enforcement and this file says so twice: Plan 02 measured that
  --            removing the keyword changes neither plan nor result TODAY, because the CTE
  --            carries a locking clause. The fence is what keeps the bound safe against a
  --            future edit that drops FOR UPDATE and makes the CTE inlinable, at which
  --            point the LIMIT would be re-applied per outer row.
  --            LAYERED: STEP 2 re-checks the MATERIALIZED count at :613.
  -- RED-UNDER-M: {"arm":"1/JOB-04/D-19","apply":[{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"      WITH batch AS MATERIALIZED (\n","replace":"      WITH batch AS (\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"  IF v_mat <> 1 THEN\n","replace":"  IF FALSE THEN\n","occurrences":1}]}
  IF v_mat <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-04/D-19): the deployed body carries % MATERIALIZED batch CTEs, expected exactly 1. The explicit fence is what keeps the bound safe against a future edit that drops FOR UPDATE and makes the CTE inlinable -- at which point the LIMIT would be re-applied per outer row and the per-tick blast radius would silently become unbounded. This is shape enforcement; Part 4 is the bound proof.', v_mat;
  END IF;

  -- ----- NEGATIVE anchors on the DEPLOYED body -----
  -- ⚠️ The SELECT..LIMIT window was '[^)]*' until 2026-08-17, forbidding a ')'
  -- in between. MEASURED: the predicate cannot be rewritten without an
  -- EXISTS (...) or some closing paren before the LIMIT, so the old pattern
  -- matched NO realistic rewrite and the gate could not fail. '[^;]*' still
  -- bounds the match to a single statement (so it cannot smear and false-RED)
  -- while allowing the parens a real IN-subquery necessarily contains.
  IF v_command ~* '\mIN\M[[:space:]]*\([[:space:]]*SELECT[^;]*LIMIT' THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-04/D-19): the deployed body binds its bounded batch through an IN (SELECT ... LIMIT ...) subquery. That is the exact un-hashable-subplan shape whose LIMIT is re-applied per outer row, so the per-tick bound silently does not exist -- the defect D-19 was opened to fix.';
  END IF;
  IF v_command ILIKE '%computed_at%' THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-04): the deployed body references computed_at. The SQL status bridge re-stamps it on every job transition and the Python entry upsert omits it, so it is wrong in BOTH directions -- and it is the literal column Phase 106 janitor was REVERTED for.';
  END IF;
  IF v_command ILIKE '%updated_at%' THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-04): the deployed body references updated_at. Both the CSV persist and the broker-dailies derive re-stamp that column on every refresh, so a grace window keyed on it would never elapse for an actively-refreshed strategy and the hole would stay open for exactly the longest-lived strategies.';
  END IF;
  IF v_command ILIKE '%enqueue_compute_job%' THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-04): the deployed body calls the enqueue RPC. Its race-loss arm RAISEs serialization_failure, and a RAISE inside a pg_cron body aborts the ENTIRE tick -- the healed count is lost, the NOTICE never runs, and every remaining candidate is skipped. A direct INSERT with ON CONFLICT DO NOTHING has no such arm.';
  END IF;

  RAISE NOTICE 'Part 1 OK: reconcile_dropped_enqueue_sweep registered exactly once at 35 * * * *, with the five predicate conjuncts anchored, the four excluded computation_status values present, the terminalizer audit marker present exactly twice in executable code (the B4 exemption carrying its IS TRUE wrapper + the R3 readmit ceiling), the ceiling word-bounded at 3 and comparing a COUNT of marked rows, 3 public.compute_jobs references, the marker keys pinned, LIMIT 25 / SKIP LOCKED / ON CONFLICT DO NOTHING present, 1 MATERIALIZED batch, 2 grace-anchor reads, and no IN-subquery LIMIT, rejected anchor column or enqueue RPC.';
END
$$;

-- ==========================================================================
-- Part 2 -- DIRECTIONAL ARMS. Oracle is the DEPLOYED cron.job.command.
-- Rolls back unconditionally.
--
--   A   dailies past grace, NO strategy_analytics row        -> MUST be healed
--   A2  dailies past grace, analytics at 'pending'           -> MUST be healed
--   B   dailies stamped now() (inside the grace window)      -> MUST be untouched
--   C1  a RUNNING derive_broker_dailies job (a DIFFERENT kind) -> MUST be untouched
--   C2  only a GENUINE failed_final job (non-marker last_error) -> MUST be untouched
--   C2b only a failed_final job with a NULL last_error        -> MUST be untouched
--   C3  only a done job                                      -> MUST be untouched
--   C4  only a TERMINALIZER-MARKED failed_final job          -> MUST BE HEALED
--   C5  THREE terminalizer-marked rows (AT the ceiling)      -> MUST be untouched
--   C5b TWO   terminalizer-marked rows (one BELOW it)        -> MUST BE HEALED
--   D1  analytics 'complete'                                 -> MUST be untouched
--   D2  analytics 'complete_with_warnings'                   -> MUST be untouched
--   D3  analytics 'failed'                                   -> MUST be untouched
--   D4  analytics 'computing'  (142 reaper row)              -> MUST be untouched
--   E   a strategy_keys member row (a COMPOSITE)             -> MUST be untouched
--   F   strategies.status = 'archived'                       -> MUST be untouched
--
-- A and B are the grace pair: they fail in OPPOSITE directions if the grace
-- conjunct is deleted or if the anchor is wrong. A2 and D4 are the split pair:
-- 'pending' belongs to this sweep, 'computing' belongs to 142 reaper.
--
-- ⭐ C2 AND C4 ARE THE DISCRIMINATING PAIR (B4, Phase 146.1, migration
-- 20260819130500). Neither arm is evidence on its own, and a future editor who
-- reds one of them must understand that the other is the reason it cannot
-- simply be relaxed:
--   * C4 ALONE would also pass under the BLANKET "no NON-TERMINAL row"
--     widening -- the fix the v1.19 roster originally proposed and which this
--     phase REFUSED. So C4 alone cannot tell the narrow fix from the blanket
--     one.
--   * C2 ALONE would also pass under NO FIX AT ALL, since the pre-146.1 body
--     excluded every strategy carrying any job row whatsoever. So C2 alone
--     cannot tell the narrow fix from the unfixed body.
-- Together they pin exactly one predicate: readmit a terminalizer-produced
-- orphan, keep excluding a settled permanent failure. ⛔ Do NOT delete, invert
-- or weaken C1, C2, C2b or C3 to make a wider predicate pass -- that is the
-- fix-the-test antipattern, and C2's message names the cost in full.
--
-- ⭐ C5 AND C5b ARE THE OTHER DISCRIMINATING PAIR (R3, Phase 146.2, migration
-- 20260819150000), and they exist for exactly the reason C2/C4 do — neither is
-- evidence alone:
--   * C5 ALONE would also pass under a body that readmits NOTHING at all,
--     including the pre-B4 body and a body whose exemption was deleted. So C5
--     alone cannot tell a CEILING from a closed door.
--   * C5b ALONE would also pass under the PRE-CEILING body, which readmits
--     every marked orphan regardless of count. So C5b alone cannot tell a
--     bounded readmit from an unbounded one.
-- Together they pin a bound that is PRESENT and NOT OVER-TIGHT: readmission
-- stops at 3 marker rows and still fires at 2.
--
-- WHY THE COUNT IS THE ATTEMPT COUNTER, restated here because the seed shape
-- only makes sense with it: 144's terminalizer UPDATEs the running row IN
-- PLACE (20260817120000:618-622, "rows survive as failed_final") and this sweep
-- INSERTs a NEW row, so one reap-readmit cycle leaves exactly one more marked
-- row behind. compute_jobs.attempts is NOT usable — the sweep's INSERT names
-- only (strategy_id, kind, metadata), so every per-job retry field returns to
-- its default on each readmission.
--
-- ⚠️ THESE SEEDS ARE NOT AN INDEPENDENT CLOCK. They assert what the DEPLOYED
-- body does at 2 and at 3 marked rows. They do NOT prove a real strategy takes
-- ~4-5 h to accumulate one; that interval is the terminalizer's 4 h claim
-- window plus this sweep's hourly cadence, and it is argued in the migration
-- header rather than measured here.
--
-- C2b is the THREE-VALUED-LOGIC arm. last_error is NULLABLE, and
-- `NULL LIKE 'x%'` is NULL, not FALSE. A marker exemption written WITHOUT an
-- explicit `IS TRUE` wrapper evaluates to NULL for a NULL-last_error row, that
-- row drops out of the NOT EXISTS subquery, and a GENUINE permanent failure
-- carrying no error text is HEALED -- the arm-C2 failure mode arriving through
-- the back door. MEASURED 2026-08-18 on a throwaway postgres:16 over a
-- miniature of the conjunct: the unwrapped form heals this seed, the wrapped
-- form does not. This arm is what keeps that wrapper from being "simplified"
-- away, and it is the same trap this phase's A1 half closes on the fold with
-- IS DISTINCT FROM.
--
-- Untouched arms assert ZERO compute_jobs rows CARRYING THE MARKER for their own
-- strategy id -- not zero job rows, because C1/C2/C2b/C3 deliberately have one.
-- That is what makes the assertion identity-scoped AND kind-of-write-scoped at
-- once. C4 is the mirror image: it has a pre-existing job row too, and asserts
-- that exactly ONE MARKED row was added alongside it.
-- ==========================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$
DECLARE
  v_user     uuid := gen_random_uuid();
  v_key      uuid;
  v_a        uuid;   -- heal: no analytics row
  v_a2       uuid;   -- heal: analytics 'pending'
  v_b        uuid;   -- skip: in grace
  v_c1       uuid;   -- skip: running derive_broker_dailies job
  v_c2       uuid;   -- skip: GENUINE failed_final job (non-marker last_error)
  v_c2b      uuid;   -- skip: failed_final job with a NULL last_error
  v_c3       uuid;   -- skip: done job
  v_c4       uuid;   -- HEAL: terminalizer-marked failed_final job (B4)
  v_c5       uuid;   -- skip: THREE marked rows -- AT the readmit ceiling (R3)
  v_c5b      uuid;   -- HEAL: TWO marked rows -- one BELOW the ceiling (R3)
  v_d1       uuid;   -- skip: analytics complete
  v_d2       uuid;   -- skip: analytics complete_with_warnings
  v_d3       uuid;   -- skip: analytics failed
  v_d4       uuid;   -- skip: analytics computing
  v_e        uuid;   -- skip: composite
  v_f        uuid;   -- skip: archived
  v_seeded   uuid[];
  v_command  TEXT;
  v_cnt      INTEGER;
  v_status   TEXT;
  v_kind     TEXT;
  v_source   TEXT;
  v_detected TEXT;
  v_fresh    TIMESTAMPTZ := now();
  v_old      TIMESTAMPTZ;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'SKIP Part 2: pg_cron is not installed here, so the deployed-body oracle is unavailable (local dev only). Part 1 already reddened on this condition.';
    RETURN;
  END IF;

  SELECT command INTO v_command
    FROM cron.job WHERE jobname = 'reconcile_dropped_enqueue_sweep';
  -- RED-UNDER: unschedule the sweep on the live database -- the production change this
  --            arm's OWN message names ("or the job was unscheduled out of band" is Part 1's
  --            wording for the same event). ⚠️ DOMINATED BY DESIGN, and that is this file's
  --            doctrine rather than a defect in the arm: Part 1 is DELIBERATELY UNGATED and
  --            its registration arm is meant to be the free-standing RED, so under a real
  --            unschedule `1/JOB-04` fires first every time. This arm exists so that Part 2
  --            cannot silently RETURN instead, and it is reachable only with Part 1's own
  --            dominators suppressed -- which is what `neuter` is for. The neuter list below
  --            is MEASURED off the lane, not reasoned: entries were added ONE AT A TIME and
  --            only after the runner reported that identity as the first failure, which is
  --            why it names 5 of the 15 raises carrying `1/JOB-04` and not all 15 (the other
  --            ten sit behind `IF v_command <op> ...` tests that are NULL, not TRUE, once the
  --            job row is gone). Same shape, same primitives, as `2/JOB-05` in
  --            test_retention_orphaned_running.sql:655.
  --
  --            ⛔ THIS TWIN WAS REFUTED AND REPLACED, 2026-09-05. Do not restore the old one.
  --            WHO: the phase's gsd-code-reviewer, finding CR-01 of 164.4.1-REVIEW.md;
  --            re-measured independently by the fixer before this edit was made.
  --            WHAT IT USED TO BE: an `{"kind":"edit"}` step against THIS GATE FILE, pointing
  --            this part's own oracle lookup at `..._sweep__no_such_job`. A gate-self
  --            mutation with no production preimage.
  --            WHAT JUSTIFIED IT: a recorded conclusion reading "So no production mutation
  --            can make this raise fire first, and the honest falsifier is the one that
  --            breaks the precondition it asserts."
  --            WHY THAT WAS WRONG: the two routes it rested on did fail exactly as recorded
  --            -- renaming the jobname in 20260819150000's cron.schedule call never reaches
  --            the gate, because that migration's own STEP 2 aborts the apply with
  --            `R3/JOB-04 verification failed: ... carries a NULL command after
  --            re-registration`; and with the WHOLE of STEP 2 short-circuited the run REDs
  --            `1/JOB-04` instead -- but the conclusion does not follow from them. Neither
  --            route tried the THIRD one, which this corpus had already been using for three
  --            plans: a live-DB `sql` step plus a `neuter` of the dominating Part 1 raises.
  --            HOW IT WAS REFUTED: real pg-lane, PostgreSQL 16 + pg_cron, the file's own
  --            RED-UNDER-SETUP apply list, 5 `1/JOB-04` raises neutered, and the one-statement
  --            post-apply below. Lane exit 3, and the FIRST and ONLY failure is this arm,
  --            raised from this DO body:
  --                psql:<scratch>/gate.sql:1366: ERROR:  P0001: TEST FAILED (2/JOB-04): the
  --                reconcile_dropped_enqueue_sweep cron job is missing while pg_cron is
  --                installed. A missing sweep is a red gate, never a skip.
  --            Under the runner the same twin scores `arm 2/JOB-04 exit 3 RED (identity ok)`.
  --            ⚠️ That anchor is RE-MEASURED at HEAD, 2026-09-05, and was `:1285` when this
  --            record was first written. It had ALREADY gone stale before it was re-read:
  --            psql reports the line where it finished reading the DO STATEMENT, not the
  --            line of the RAISE, so the number moves whenever prose is added above it --
  --            including by the WR-A and WR-C records below. Re-derive it on a lane if it
  --            is ever needed; never transcribe it, and never treat a mismatch here as a
  --            finding about the arm.
  --
  --            ⛔ The refuted prose also cited "the S-2 seed-integrity precedent in
  --            test_strategy_analytics_stuck_computing_reaper.sql (plan 164.4.1-04)" as the
  --            same class. The citation is deleted -- but NOT for the reason first recorded
  --            here, and that reason is corrected rather than quietly dropped.
  --            ⚠️ THE FIRST CORRECTION WAS ITSELF FALSE. It read: "`4a/seed`'s twin there
  --            mutates TWO MIGRATIONS -- 20260802120000 and 20260803120000 -- not the gate,
  --            so it was never a gate-self precedent at all." Its first clause is true of
  --            `4a/seed` (reaper file :962, three edit steps across those two migrations),
  --            and the conclusion does not follow from it. That file's S-2 seed-integrity
  --            controls `6/seed A/D-18` (:1226) and `6/seed B/D-18` (:1245) DO mutate the
  --            gate's own text -- both twins name the reaper gate file as their edit target
  --            -- and their prose calls that "the honest falsifier rather than a shortcut"
  --            (:1217). The gate-self precedent exists. `4a/seed` was simply the wrong arm
  --            to have cited for it. VERIFIED at HEAD before this sentence was written.
  --            ⭐ THE VALID REASON the precedent does not reach `2/JOB-04`: those two reaper
  --            arms assert that a SEED LANDED, and say so in the raise -- "This is a broken
  --            fixture, not a finding about the trigger." `2/JOB-04` asserts a PRODUCTION
  --            fact, that the sweep is registered while pg_cron is installed, and its own
  --            message calls a missing sweep "a red gate, never a skip". A precedent about
  --            seed-integrity controls cannot license a gate-self twin on a production claim.
  -- RED-UNDER-M: {"arm":"2/JOB-04","apply":[{"kind":"sql","stmt":"DELETE FROM cron.job WHERE jobname = 'reconcile_dropped_enqueue_sweep'"}],"neuter":[{"arm":"1/JOB-04"},{"arm":"1/JOB-04"},{"arm":"1/JOB-04"},{"arm":"1/JOB-04"},{"arm":"1/JOB-04"}]}
  IF v_command IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (2/JOB-04): the reconcile_dropped_enqueue_sweep cron job is missing while pg_cron is installed. A missing sweep is a red gate, never a skip.';
  END IF;

  -- The century-back epoch. This is the isolation mechanism (see the header):
  -- it makes every seed outrank any plausible foreign candidate under the
  -- deployed ORDER BY, so the seeds win the LIMIT-25 budget without this file
  -- touching a single row it does not own.
  v_old := v_fresh - interval '100 years';

  -- FK chain: strategy_analytics.strategy_id -> strategies.id -> profiles.id ->
  -- auth.users.id (test_strategy_analytics_stuck_computing_reaper.sql:336-351).
  INSERT INTO auth.users (id, email)
    VALUES (v_user, 'job04-arms-' || v_user || '@invalid.local');
  INSERT INTO public.profiles (id, display_name)
    VALUES (v_user, 'job04-arms') ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.strategies (user_id, name) VALUES (v_user, 'job04-arm-a')  RETURNING id INTO v_a;
  INSERT INTO public.strategies (user_id, name) VALUES (v_user, 'job04-arm-a2') RETURNING id INTO v_a2;
  INSERT INTO public.strategies (user_id, name) VALUES (v_user, 'job04-arm-b')  RETURNING id INTO v_b;
  INSERT INTO public.strategies (user_id, name) VALUES (v_user, 'job04-arm-c1') RETURNING id INTO v_c1;
  INSERT INTO public.strategies (user_id, name) VALUES (v_user, 'job04-arm-c2') RETURNING id INTO v_c2;
  INSERT INTO public.strategies (user_id, name) VALUES (v_user, 'job04-arm-c2b') RETURNING id INTO v_c2b;
  INSERT INTO public.strategies (user_id, name) VALUES (v_user, 'job04-arm-c3') RETURNING id INTO v_c3;
  INSERT INTO public.strategies (user_id, name) VALUES (v_user, 'job04-arm-c4') RETURNING id INTO v_c4;
  INSERT INTO public.strategies (user_id, name) VALUES (v_user, 'job04-arm-c5') RETURNING id INTO v_c5;
  INSERT INTO public.strategies (user_id, name) VALUES (v_user, 'job04-arm-c5b') RETURNING id INTO v_c5b;
  INSERT INTO public.strategies (user_id, name) VALUES (v_user, 'job04-arm-d1') RETURNING id INTO v_d1;
  INSERT INTO public.strategies (user_id, name) VALUES (v_user, 'job04-arm-d2') RETURNING id INTO v_d2;
  INSERT INTO public.strategies (user_id, name) VALUES (v_user, 'job04-arm-d3') RETURNING id INTO v_d3;
  INSERT INTO public.strategies (user_id, name) VALUES (v_user, 'job04-arm-d4') RETURNING id INTO v_d4;
  INSERT INTO public.strategies (user_id, name) VALUES (v_user, 'job04-arm-e')  RETURNING id INTO v_e;
  INSERT INTO public.strategies (user_id, name, status)
    VALUES (v_user, 'job04-arm-f', 'archived') RETURNING id INTO v_f;

  v_seeded := ARRAY[v_a, v_a2, v_b, v_c1, v_c2, v_c2b, v_c3, v_c4, v_c5, v_c5b, v_d1, v_d2, v_d3, v_d4, v_e, v_f];

  -- Dailies for every arm. Arm B is stamped FRESH (inside the grace window);
  -- every other arm is stamped a century back so it is past grace by
  -- construction. created_at is written EXPLICITLY -- that column being
  -- INSERT-writable is exactly why DX-04 chose it as the grace anchor, and it is
  -- what makes this file sleep-free.
  INSERT INTO public.csv_daily_returns (strategy_id, date, daily_return, created_at)
  VALUES
    (v_a,  DATE '2026-01-02', 0.001, v_old),
    (v_a2, DATE '2026-01-02', 0.001, v_old),
    (v_b,  DATE '2026-01-02', 0.001, v_fresh),
    (v_c1, DATE '2026-01-02', 0.001, v_old),
    (v_c2, DATE '2026-01-02', 0.001, v_old),
    (v_c2b, DATE '2026-01-02', 0.001, v_old),
    (v_c3, DATE '2026-01-02', 0.001, v_old),
    (v_c4, DATE '2026-01-02', 0.001, v_old),
    (v_c5, DATE '2026-01-02', 0.001, v_old),
    (v_c5b, DATE '2026-01-02', 0.001, v_old),
    (v_d1, DATE '2026-01-02', 0.001, v_old),
    (v_d2, DATE '2026-01-02', 0.001, v_old),
    (v_d3, DATE '2026-01-02', 0.001, v_old),
    (v_d4, DATE '2026-01-02', 0.001, v_old),
    (v_e,  DATE '2026-01-02', 0.001, v_old),
    (v_f,  DATE '2026-01-02', 0.001, v_old);

  -- Arm A2: a 'pending' analytics row must NOT protect the strategy -- absent
  -- and 'pending' both belong to this sweep (D-04 split table).
  INSERT INTO public.strategy_analytics (strategy_id, computation_status)
    VALUES (v_a2, 'pending');

  -- Arm C1: a RUNNING job of a DIFFERENT kind. This is the D-02 arm and the
  -- reason the zero-jobs conjunct must be ANY-kind: derive_broker_dailies upserts
  -- the dailies and only THEN enqueues its follow-on, both inside the still-
  -- running parent job (job_worker.py:4742 then :5201-5209), so there is a real
  -- window with dailies present, a running parent and no analytics job yet.
  INSERT INTO public.compute_jobs
    (kind, strategy_id, status, priority, attempts, next_attempt_at, claim_token, claimed_at)
  VALUES ('derive_broker_dailies', v_c1, 'running', 'normal', 1, now(), gen_random_uuid(), now());

  -- Arms C2 / C2b / C3 / C4: TERMINAL job rows. These are the retention-aged
  -- shape -- the partial unique index does NOT cover 'done' / 'failed_final',
  -- so if the zero-jobs conjunct were weakened nothing downstream would stop
  -- the re-insert. Three of the four MUST stay excluded; exactly one (C4) must
  -- be readmitted, and the ONLY thing separating them is last_error.
  --
  -- arm C2: a GENUINE permanent failure. ⚠️ The last_error text is EXPLICIT and
  -- deliberately NOT the terminalizer marker. Leaving it NULL (as this seed did
  -- before B4) would make the arm non-discriminating: it would then be covered
  -- by C2b's three-valued-logic path rather than by the marker comparison, and
  -- the neuter that swaps the marker LIKE for a bare `last_error IS NOT NULL`
  -- would false-PASS. With real non-marker text present, that neuter REDs this
  -- arm -- which is what proves the predicate discriminates on the MARKER and
  -- not merely on the presence of some text. MEASURED 2026-08-18 on a
  -- postgres:16 miniature: under the IS-NOT-NULL neuter this seed IS healed.
  INSERT INTO public.compute_jobs
    (kind, strategy_id, status, priority, attempts, next_attempt_at, last_error)
  VALUES
    ('compute_analytics_from_csv', v_c2, 'failed_final', 'normal', 3, now(),
     'binance rejected the stored credentials (401): the API key has been revoked or has expired');

  -- arm C2b: the SAME genuine permanent failure with a NULL last_error -- the
  -- three-valued-logic seed. See the pair note in this part's header for why a
  -- marker exemption without an explicit IS TRUE wrapper HEALS this row.
  -- last_error is omitted rather than written as NULL so the seed matches the
  -- real shape a handler leaves behind when it terminalizes without text.
  INSERT INTO public.compute_jobs
    (kind, strategy_id, status, priority, attempts, next_attempt_at)
  VALUES
    ('compute_analytics_from_csv', v_c2b, 'failed_final', 'normal', 3, now());

  -- arm C3: a completed job. Nothing about B4 touches this shape.
  INSERT INTO public.compute_jobs
    (kind, strategy_id, status, priority, attempts, next_attempt_at)
  VALUES
    ('compute_analytics_from_csv', v_c3, 'done',         'normal', 1, now());

  -- arm C4 (B4, migration 20260819130500): a TERMINALIZER-PRODUCED orphan. The
  -- last_error literal is copied EXACTLY from the terminalizer's arm A at
  -- 20260817120000:622 -- it is the fixed audit text that cron body stamps, and
  -- its 2-occurrence count is gated in that migration's own STEP 2, so marker
  -- drift REDs there before it could silently un-key the exemption here.
  -- This row is NOT a handler verdict: no handler ever looked at the job, the
  -- worker vanished holding the claim. Excluding it forever is what left the
  -- strategy with dailies, no analytics and nobody to recover it.
  INSERT INTO public.compute_jobs
    (kind, strategy_id, status, priority, attempts, next_attempt_at, last_error)
  VALUES
    ('compute_analytics_from_csv', v_c4, 'failed_final', 'normal', 3, now(),
     'orphaned_running_reaped: no worker completed this job within the 4h claim window');

  -- Arms C5 / C5b (R3, migration 20260819150000): the SAME shape as C4, seeded
  -- at THREE and at TWO marked rows -- i.e. AT the readmit ceiling and one
  -- BELOW it. Same fixed audit literal as C4, from the terminalizer's arm A
  -- (20260817120000:622); a variant literal here would test nothing, since the
  -- ceiling counts rows matching that exact prefix.
  --
  -- ⚠️ EVERY ONE OF THESE ROWS IS MARKED, deliberately. If any seed carried a
  -- non-marker terminal row the arm would be excluded by the B4 exemption
  -- instead of by the ceiling, and it would pass for the wrong reason -- a
  -- false green under a body with NO ceiling at all. The arm must reach the
  -- ceiling conjunct to be evidence about it.
  --
  -- ⚠️ attempts is written as 3 on every one of these rows exactly as C4 writes
  -- it, and that column is NOT what either arm measures. The counter is the
  -- ROW COUNT. Seeding attempts=3 here is deliberate: an arm that passed
  -- because a per-job attempts field happened to read 3 would prove nothing
  -- about the cross-row cycle count, and this shape makes that confusion
  -- impossible to hide -- C5b carries attempts=3 too and MUST still be healed.
  INSERT INTO public.compute_jobs
    (kind, strategy_id, status, priority, attempts, next_attempt_at, last_error)
  SELECT 'compute_analytics_from_csv', t.sid, 'failed_final', 'normal', 3, now(),
         'orphaned_running_reaped: no worker completed this job within the 4h claim window'
    FROM (VALUES (v_c5, 3), (v_c5b, 2)) AS t(sid, n)
   CROSS JOIN generate_series(1, 3) g
   WHERE g <= t.n;

  -- Arms D1-D4: the four excluded computation_status values.
  INSERT INTO public.strategy_analytics (strategy_id, computation_status)
  VALUES
    (v_d1, 'complete'),
    (v_d2, 'complete_with_warnings'),
    (v_d3, 'failed'),
    (v_d4, 'computing');

  -- Arm E: a COMPOSITE. strategy_keys carries NOT NULL owner_id / window_start /
  -- seq plus a SECURITY DEFINER owner-coherence trigger asserting
  -- owner_id = api_keys.user_id = strategies.user_id (20260710120000), so this
  -- arm needs a REAL api_keys row belonging to the same user. Minimal column set
  -- per the repo convention (test_api_key_delete_atomicity.sql:141).
  INSERT INTO public.api_keys (user_id, exchange, label, api_key_encrypted)
    VALUES (v_user, 'binance', 'job04-arm-e-key', 'not-a-real-ciphertext')
    RETURNING id INTO v_key;
  INSERT INTO public.strategy_keys (strategy_id, api_key_id, owner_id, window_start, seq)
    VALUES (v_e, v_key, v_user, DATE '2026-01-01', 0);

  -- ----- THE ORACLE: run the REAL deployed body -------------------------
  EXECUTE v_command;

  -- ----- arm A: the heal, on all four observable properties -------------
  SELECT count(*) INTO v_cnt
    FROM public.compute_jobs WHERE strategy_id = v_a;
  -- RED-UNDER: flip the grace comparison from `<` to `>` in the last writer's body, so the
  --            sweep heals only strategies whose dailies are NEWER than the grace window --
  --            the exact inversion of the population it exists for. Every text anchor in
  --            Part 1 survives it (`interval '1 hour'` is still there, so STEP 2 :579 and
  --            Part 1's grace pin both stay green), which is precisely why this arm has to
  --            EXECUTE the deployed body instead of grepping it.
  --            SINGLE-STEP by MEASUREMENT: no self-verify in the apply list reads the
  --            operator.
  -- RED-UNDER-M: {"arm":"2/arm A/JOB-04/SC#1","apply":[{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"               ) < now() - interval '1 hour'\n","replace":"               ) > now() - interval '1 hour'\n","occurrences":1}]}
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm A/JOB-04/SC#1): a strategy with dailies past the grace window, ZERO compute_jobs rows and NO strategy_analytics row got % compute_jobs rows from one tick, expected exactly 1. Zero means the sweep does not detect the dropped-enqueue population at all and the hole this phase exists to close is still open; more than one means the bounded batch is inserting duplicates.', v_cnt;
  END IF;

  SELECT status, kind, metadata->>'source', metadata->>'detected_at'
    INTO v_status, v_kind, v_source, v_detected
    FROM public.compute_jobs WHERE strategy_id = v_a;

  -- RED-UNDER: have the last writer's INSERT stamp status='running' instead of letting the
  --            column default to 'pending'. The strategy is then 'healed' into a row no
  --            worker will ever claim -- indistinguishable from the hole the sweep was
  --            meant to close, and invisible to every text anchor in Part 1 (the body still
  --            names public.compute_jobs exactly three times).
  --            SINGLE-STEP by MEASUREMENT.
  -- RED-UNDER-M: {"arm":"2/arm A/JOB-04","apply":[{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"      INSERT INTO public.compute_jobs (strategy_id, kind, metadata)\n      SELECT b.id,\n             'compute_analytics_from_csv',\n             jsonb_build_object('source', 'reconcile-sweep', 'detected_at', now())\n        FROM batch b\n","replace":"      INSERT INTO public.compute_jobs (strategy_id, kind, metadata, status)\n      SELECT b.id,\n             'compute_analytics_from_csv',\n             jsonb_build_object('source', 'reconcile-sweep', 'detected_at', now()),\n             'running'\n        FROM batch b\n","occurrences":1}]}
  IF v_status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm A/JOB-04): the healed job landed at status % and not pending, so no worker will ever claim it. A job the sweep inserts but nobody claims is indistinguishable from the hole it was meant to close.', v_status;
  END IF;
  IF v_kind IS DISTINCT FROM 'compute_analytics_from_csv' THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm A/JOB-04): the healed job carries kind % and not compute_analytics_from_csv, so it would be dispatched to the wrong handler -- or to none at all.', v_kind;
  END IF;
  -- RED-UNDER: drift the metadata source to 'reconcile-sweep-x' in the last writer. ⭐ The
  --            value still CONTAINS 'reconcile-sweep', so Part 1's presence anchor and
  --            20260819150000's STEP 2 (:567) both stay green -- the cross-language marker
  --            contract main_worker.py reads is broken and only an equality check on the
  --            written row can see it. That asymmetry is the whole reason this arm exists
  --            beside Part 1's token pin.
  --            SINGLE-STEP by MEASUREMENT.
  -- RED-UNDER-M: {"arm":"2/arm A/JOB-04/D-11/SC#1","apply":[{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"             jsonb_build_object('source', 'reconcile-sweep', 'detected_at', now())\n","replace":"             jsonb_build_object('source', 'reconcile-sweep-x', 'detected_at', now())\n","occurrences":1}]}
  IF v_source IS DISTINCT FROM 'reconcile-sweep' THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm A/JOB-04/D-11/SC#1): the healed job metadata source is % and not reconcile-sweep. analytics-service/main_worker.py reads that EXACT literal on claim to fire the Sentry alert, so this drift heals the strategy SILENTLY -- the alert half of SC#1 becomes false while both halves own unit tests stay green.', v_source;
  END IF;
  -- RED-UNDER: stamp a JSON null for detected_at in the last writer. The KEY is still
  --            present, so Part 1's `%detected_at%` anchor and STEP 2 (:570) both stay
  --            green while the Sentry event has no timestamp for when the drop was observed
  --            and an operator cannot tell a fresh drop from a month-old one.
  --            SINGLE-STEP by MEASUREMENT.
  -- RED-UNDER-M: {"arm":"2/arm A/JOB-04/D-11","apply":[{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"             jsonb_build_object('source', 'reconcile-sweep', 'detected_at', now())\n","replace":"             jsonb_build_object('source', 'reconcile-sweep', 'detected_at', NULL)\n","occurrences":1}]}
  IF v_detected IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm A/JOB-04/D-11): the healed job carries no detected_at. It is the other half of the cross-language marker contract; the Sentry event has no timestamp for when the drop was observed, so an operator cannot tell a fresh drop from a month-old one.';
  END IF;

  -- ----- arm A2: 'pending' analytics must NOT protect ------------------
  SELECT count(*) INTO v_cnt
    FROM public.compute_jobs
   WHERE strategy_id = v_a2 AND metadata->>'source' = 'reconcile-sweep';
  -- RED-UNDER: add 'pending' to the terminal-analytics exclusion list in the last writer.
  --            'pending' means nothing ever advanced the row -- which IS the dropped-enqueue
  --            signature -- so excluding it excises a large part of the population this
  --            sweep exists to heal. All four ratified values stay in the list, so every
  --            Part 1 token pin and STEP 2 :558 remain green.
  --            SINGLE-STEP by MEASUREMENT.
  -- RED-UNDER-M: {"arm":"2/arm A2/JOB-04/D-04","apply":[{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"                    AND sa.computation_status IN ('computing', 'complete', 'complete_with_warnings', 'failed')\n","replace":"                    AND sa.computation_status IN ('computing', 'complete', 'complete_with_warnings', 'failed', 'pending')\n","occurrences":1}]}
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm A2/JOB-04/D-04): a strategy whose strategy_analytics row sits at pending got % sweep-marked jobs, expected 1. pending means nothing ever advanced the row -- which is precisely the dropped-enqueue signature -- so excluding it would excise a large part of the population this sweep exists to heal.', v_cnt;
  END IF;

  -- ----- arm B: the grace window ---------------------------------------
  SELECT count(*) INTO v_cnt
    FROM public.compute_jobs
   WHERE strategy_id = v_b AND metadata->>'source' = 'reconcile-sweep';
  -- RED-UNDER: move the grace boundary from `now() - interval '1 hour'` to
  --            `now() + interval '1 hour'` in the last writer, so a strategy whose dailies
  --            landed THIS INSTANT is already past grace. The literal `interval '1 hour'`
  --            is untouched, so Part 1's anchor and STEP 2 :579 stay green; only executing
  --            the deployed body against a freshly-stamped seed sees it.
  --            SINGLE-STEP by MEASUREMENT.
  -- RED-UNDER-M: {"arm":"2/arm B/JOB-04/SC#3","apply":[{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"               ) < now() - interval '1 hour'\n","replace":"               ) < now() + interval '1 hour'\n","occurrences":1}]}
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm B/JOB-04/SC#3): a strategy whose dailies landed THIS INSTANT was healed (% sweep-marked jobs). The grace window is gone or the anchor is wrong, so the sweep now RACES the live after() enqueue it exists to backstop and inserts duplicate work on the NORMAL path -- it would fire on every healthy CSV finalize.', v_cnt;
  END IF;

  -- ----- arm C1: ANY-kind zero-jobs conjunct (D-02) ---------------------
  SELECT count(*) INTO v_cnt
    FROM public.compute_jobs
   WHERE strategy_id = v_c1 AND metadata->>'source' = 'reconcile-sweep';
  -- RED-UNDER: kind-scope the zero-jobs conjunct in the last writer. derive_broker_dailies
  --            upserts the dailies and only THEN enqueues its follow-on, both inside the
  --            still-running parent job, so kind-scoping re-enqueues a HEALTHY IN-FLIGHT
  --            CHAIN and races the chain against itself. The kind literal is already in the
  --            body (the INSERT writes it), so no Part 1 token moves.
  --            SINGLE-STEP by MEASUREMENT.
  -- RED-UNDER-M: {"arm":"2/arm C1/JOB-04/D-02/SC#3","apply":[{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"                  WHERE cj.strategy_id = s.id\n                    AND NOT ((cj.status = 'failed_final'\n","replace":"                  WHERE cj.strategy_id = s.id\n                    AND cj.kind = 'compute_analytics_from_csv'\n                    AND NOT ((cj.status = 'failed_final'\n","occurrences":1}]}
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm C1/JOB-04/D-02/SC#3): a strategy with a RUNNING derive_broker_dailies job was healed (% sweep-marked jobs). The zero-jobs conjunct has been kind-scoped. derive_broker_dailies upserts the dailies and only THEN enqueues its follow-on, both inside the still-running parent, so kind-scoping re-enqueues a HEALTHY IN-FLIGHT CHAIN and races the chain against itself.', v_cnt;
  END IF;

  -- ----- arms C2/C2b/C3: terminal job rows that MUST stay excluded ------
  -- ⚠️ C2 is one half of the B4 discriminating pair; arm C4 below is the other.
  -- Do not relax either one in isolation -- see this part's header.
  SELECT count(*) INTO v_cnt
    FROM public.compute_jobs
   WHERE strategy_id = v_c2 AND metadata->>'source' = 'reconcile-sweep';
  -- RED-UNDER: invert the exemption's marker test in the last writer (LIKE -> NOT LIKE
  --            against an unreachable prefix), so EVERY failed_final row carrying error
  --            text is readmitted rather than only the terminalizer-produced ones. A
  --            settled permanent failure then becomes an hourly retry loop. ⭐ The marker
  --            literal is still spelled twice in executable code, so Part 1's
  --            `1/JOB-04/B4/R3` counter and STEP 2 :518 both stay green -- which is exactly
  --            why C2 must be behavioural.
  --            SINGLE-STEP by MEASUREMENT.
  -- RED-UNDER-M: {"arm":"2/arm C2/JOB-04/SC#3","apply":[{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"                              AND cj.last_error LIKE 'orphaned_running_reaped:%') IS TRUE)\n","replace":"                              AND cj.last_error NOT LIKE 'orphaned_running_reaped:zzz%') IS TRUE)\n","occurrences":1}]}
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm C2/JOB-04/SC#3): a strategy whose only compute_jobs row is failed_final was healed (% sweep-marked jobs). A settled permanent failure belongs to nobody; re-enqueueing it turns it into an hourly retry loop with no attempt ceiling, and the partial unique index does not cover failed_final so nothing downstream stops it.', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt
    FROM public.compute_jobs
   WHERE strategy_id = v_c2b AND metadata->>'source' = 'reconcile-sweep';
  -- RED-UNDER: admit a NULL last_error into the exemption in the last writer, WITHOUT
  --            touching the IS TRUE wrapper. This reaches the same three-valued-logic hole
  --            the wrapper closes -- a genuine permanent failure carrying no error text is
  --            healed hourly -- while `%IS TRUE%` stays present, so Part 1's `1/JOB-04/B4`
  --            pin and STEP 2 :531 remain green. The text pin and this arm are not
  --            redundant: they catch different spellings of the same defect.
  --            SINGLE-STEP by MEASUREMENT.
  -- RED-UNDER-M: {"arm":"2/arm C2b/JOB-04/B4/SC#3","apply":[{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"                    AND NOT ((cj.status = 'failed_final'\n                              AND cj.last_error LIKE 'orphaned_running_reaped:%') IS TRUE)\n","replace":"                    AND NOT ((cj.status = 'failed_final'\n                              AND (cj.last_error IS NULL OR cj.last_error LIKE 'orphaned_running_reaped:%')) IS TRUE)\n","occurrences":1}]}
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm C2b/JOB-04/B4/SC#3): a strategy whose only compute_jobs row is a failed_final carrying a NULL last_error was healed (% sweep-marked jobs). This is the THREE-VALUED-LOGIC hole: NULL LIKE ''x%%'' is NULL, not FALSE, so a marker exemption written without an explicit IS TRUE wrapper evaluates to NULL for this row, the row drops out of the NOT EXISTS subquery, and a GENUINE permanent failure with no error text becomes an hourly retry loop with no attempt ceiling -- arm C2 failure mode arriving through the back door. Restore the IS TRUE wrapper on the exemption in the deployed body; do NOT relax this arm.', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt
    FROM public.compute_jobs
   WHERE strategy_id = v_c3 AND metadata->>'source' = 'reconcile-sweep';
  -- RED-UNDER: make the zero-jobs conjunct ignore 'done' rows in the last writer. The
  --            partial unique index does not cover 'done', so nothing downstream stops the
  --            re-insert: this is a straight duplicate enqueue of work that already
  --            completed. No token Part 1 reads changes.
  --            SINGLE-STEP by MEASUREMENT.
  -- RED-UNDER-M: {"arm":"2/arm C3/JOB-04/SC#3","apply":[{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"                  WHERE cj.strategy_id = s.id\n                    AND NOT ((cj.status = 'failed_final'\n","replace":"                  WHERE cj.strategy_id = s.id\n                    AND cj.status <> 'done'\n                    AND NOT ((cj.status = 'failed_final'\n","occurrences":1}]}
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm C3/JOB-04/SC#3): a strategy whose only compute_jobs row is done was healed (% sweep-marked jobs). The partial unique index does not cover done either, so this is a straight duplicate enqueue of work that already completed.', v_cnt;
  END IF;

  -- ----- arm C4: THE MUST-HEAL COUNTERPART (B4) -------------------------
  -- ⚠️ This is the ONLY arm in the C family that asserts a heal, and it is what
  -- makes C2 a DISCRIMINATOR rather than a restatement of the unfixed body.
  SELECT count(*) INTO v_cnt
    FROM public.compute_jobs
   WHERE strategy_id = v_c4 AND metadata->>'source' = 'reconcile-sweep';
  -- RED-UNDER: narrow the exemption's marker prefix to one the terminalizer never writes
  --            ('orphaned_running_reaped:zzz%') in the last writer, so a terminalizer-
  --            produced orphan is once again excluded FOREVER: 144 terminalizes a chain-mid
  --            orphan for the audit trail, that row trips this sweep's any-status conjunct,
  --            and the strategy is recovered by nobody. ⭐ The marker literal still appears
  --            twice in executable code, so Part 1's count pin cannot see this at all.
  --            SINGLE-STEP by MEASUREMENT.
  -- RED-UNDER-M: {"arm":"2/arm C4/JOB-04/SC#3/B4","apply":[{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"                              AND cj.last_error LIKE 'orphaned_running_reaped:%') IS TRUE)\n","replace":"                              AND cj.last_error LIKE 'orphaned_running_reaped:zzz%') IS TRUE)\n","occurrences":1}]}
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm C4/JOB-04/SC#3/B4): a strategy whose only compute_jobs row is a TERMINALIZER-PRODUCED orphan -- failed_final carrying the fixed orphaned_running_reaped audit literal Phase 144 cron body stamps -- got % sweep-marked jobs, expected exactly 1. Zero means migration 20260819130500 exemption is missing from the deployed body, or was written without its IS TRUE wrapper, and the two mechanisms do not compose: 144 terminalizes a chain-mid orphan for the AUDIT TRAIL, that row then trips this sweep ANY-status conjunct, and the strategy is recovered by NOBODY -- not the worker (the job is terminal), not the sweep (this conjunct), and not the user (no surface at all once the wizard 15-minute amber backstop has passed). A lost-worker row is not a handler verdict. More than one means the bounded batch is inserting duplicates.', v_cnt;
  END IF;

  -- ----- arm C5: THE READMIT CEILING (R3) -------------------------------
  -- ⚠️ Read C5b directly below before touching this. C5 alone would pass under
  -- a body that readmits nothing at all; only the pair is evidence.
  SELECT count(*) INTO v_cnt
    FROM public.compute_jobs
   WHERE strategy_id = v_c5 AND metadata->>'source' = 'reconcile-sweep';
  -- RED-UNDER: point the ceiling's status test at a value no row carries
  --            ('zzz_failed_final') in the last writer, so the attempt counter always reads
  --            zero and the ceiling never binds. A strategy already reaped and readmitted to
  --            exhaustion is readmitted again -- forever, at one worker slot every ~5 hours.
  --            ⭐ Both of Part 1's R3 pins survive: the word-bounded `< 3` is untouched and
  --            the shape regex still matches, so only executing the body sees it.
  --            SINGLE-STEP by MEASUREMENT (STEP 2 :528 reads `%failed_final%`, which
  --            'zzz_failed_final' contains).
  -- RED-UNDER-M: {"arm":"2/arm C5/JOB-04/R3/SC#3","apply":[{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"                    AND cjc.status = 'failed_final'\n","replace":"                    AND cjc.status = 'zzz_failed_final'\n","occurrences":1}]}
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm C5/JOB-04/R3/SC#3): a strategy already carrying THREE terminalizer-produced marker rows -- i.e. one that has already been reaped and readmitted to exhaustion -- was readmitted AGAIN (% sweep-marked jobs), expected 0. The readmit attempt ceiling is missing from the deployed body. B4 opened this readmission path and named "an hourly retry loop with no attempt ceiling" three times as the mode it must not cause, but bounded only the NULL-last_error way in; without the ceiling the cycle is: sweep readmits, a worker claims it and dies, 144 reaps the row at 4h and stamps the marker, the sweep readmits again -- forever, at one worker slot every ~5 hours, for a strategy whose input reliably kills its worker. Nothing else in the system counts those cycles: compute_jobs.attempts is per-JOB and returns to its default on every sweep INSERT. Restore the ceiling; do NOT relax this arm.', v_cnt;
  END IF;

  -- ----- arm C5b: THE POSITIVE CONTROL FOR C5 (R3) ----------------------
  -- ⚠️ WITHOUT THIS ARM, C5 COULD PASS VACUOUSLY. A ceiling of 1 -- or a body
  -- whose B4 exemption was deleted outright, or the whole pre-B4 body -- also
  -- produces zero readmissions for C5. This arm is what forces the bound to be
  -- a CEILING rather than a closed door: at two marker rows, one below the
  -- ratified 3, readmission must still fire.
  SELECT count(*) INTO v_cnt
    FROM public.compute_jobs
   WHERE strategy_id = v_c5b AND metadata->>'source' = 'reconcile-sweep';
  -- RED-UNDER: bias the ceiling by one (`) + 1 < 3`) in the last writer, tightening it to
  --            an effective 2 while leaving the ratified literal `< 3` in place. A strategy
  --            that lost its worker twice to a transient outage is then stranded with
  --            dailies, no analytics and nobody to recover it -- and stranded SILENTLY,
  --            because arm C5 stays green in that state. This is the OVER-TIGHT half of the
  --            C5/C5b pair, and no text pin in Part 1 or in STEP 2 can express it.
  --            SINGLE-STEP by MEASUREMENT.
  -- RED-UNDER-M: {"arm":"2/arm C5b/JOB-04/R3/SC#3","apply":[{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"                    AND cjc.last_error LIKE 'orphaned_running_reaped:%'\n               ) < 3\n","replace":"                    AND cjc.last_error LIKE 'orphaned_running_reaped:%'\n               ) + 1 < 3\n","occurrences":1}]}
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm C5b/JOB-04/R3/SC#3): a strategy carrying TWO terminalizer-produced marker rows -- one BELOW the ratified ceiling of 3 -- got % sweep-marked jobs, expected exactly 1. Zero means the ceiling is OVER-TIGHT (tightened below 3, or the B4 exemption was lost so no marked orphan is readmitted at all): a strategy that lost its worker twice to a transient outage is then stranded with dailies, no analytics and nobody to recover it, which is the very hole B4 exists to close -- and it would be stranded SILENTLY, because arm C5 stays green in that state. More than one means the bounded batch is inserting duplicates. C5 and C5b are a MATCHED PAIR; do not relax either alone.', v_cnt;
  END IF;

  -- ----- arm D1: THE MASS-RE-ENQUEUE TRIPWIRE (D-03) -------------------
  SELECT count(*) INTO v_cnt
    FROM public.compute_jobs
   WHERE strategy_id = v_d1 AND metadata->>'source' = 'reconcile-sweep';
  -- RED-UNDER: break the 'complete' comparison by concatenation (`'complete' || 'X'`) in
  --            the last writer. ⭐ The quoted literal is STILL PRESENT in the body, so Part
  --            1's `%''complete''%` pin and STEP 2 stay green while the conjunct no longer
  --            excludes anything -- the mass-re-enqueue incident behind a green text gate.
  --            SINGLE-STEP by MEASUREMENT.
  -- RED-UNDER-M: {"arm":"2/arm D1/JOB-04/D-03/SC#3","apply":[{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"                    AND sa.computation_status IN ('computing', 'complete', 'complete_with_warnings', 'failed')\n","replace":"                    AND sa.computation_status IN ('computing', 'complete' || 'X', 'complete_with_warnings', 'failed')\n","occurrences":1}]}
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm D1/JOB-04/D-03/SC#3): a strategy with a COMPLETE strategy_analytics row was healed (% sweep-marked jobs). This is THE MASS-RE-ENQUEUE INCIDENT. retention_compute_jobs_done DELETEs done job rows at 30 days, so every healthy 31-day-old strategy already matches dailies-present-and-zero-jobs; the terminal-analytics conjunct is the ONLY thing between the first tick and a re-enqueue of the ENTIRE HISTORICAL CORPUS, and the number grows monotonically as the corpus ages. Measured on PROD at authoring time: 4 of 4 zero-job strategies with dailies are excluded solely by this conjunct.', v_cnt;
  END IF;

  -- ----- arms D2/D3: the other terminal statuses -----------------------
  SELECT count(*) INTO v_cnt
    FROM public.compute_jobs
   WHERE strategy_id = v_d2 AND metadata->>'source' = 'reconcile-sweep';
  -- RED-UNDER: same concatenation break, applied to 'complete_with_warnings' in the last
  --            writer -- the mass-re-enqueue incident, partial edition: a correct headline
  --            recomputed for no reason on a money surface. STEP 2 :558 reads
  --            `%complete_with_warnings%` and stays green.
  --            SINGLE-STEP by MEASUREMENT.
  -- RED-UNDER-M: {"arm":"2/arm D2/JOB-04/D-03/SC#3","apply":[{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"                    AND sa.computation_status IN ('computing', 'complete', 'complete_with_warnings', 'failed')\n","replace":"                    AND sa.computation_status IN ('computing', 'complete', 'complete_with_warnings' || 'X', 'failed')\n","occurrences":1}]}
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm D2/JOB-04/D-03/SC#3): a strategy at complete_with_warnings was healed (% sweep-marked jobs) -- the mass-re-enqueue incident, partial edition. Its correct headline would be recomputed for no reason on a money surface.', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt
    FROM public.compute_jobs
   WHERE strategy_id = v_d3 AND metadata->>'source' = 'reconcile-sweep';
  -- RED-UNDER: same concatenation break, applied to 'failed' in the last writer. A terminal
  --            analytics failure belongs to nobody; re-enqueueing it hourly is an unbounded
  --            retry loop that no attempt ceiling governs (the R3 ceiling counts marker
  --            rows, not analytics failures).
  --            SINGLE-STEP by MEASUREMENT.
  -- RED-UNDER-M: {"arm":"2/arm D3/JOB-04/D-03/SC#3","apply":[{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"                    AND sa.computation_status IN ('computing', 'complete', 'complete_with_warnings', 'failed')\n","replace":"                    AND sa.computation_status IN ('computing', 'complete', 'complete_with_warnings', 'failed' || 'X')\n","occurrences":1}]}
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm D3/JOB-04/D-03/SC#3): a strategy whose analytics are terminally failed was healed (% sweep-marked jobs). A terminal failure belongs to nobody, and re-enqueueing it hourly is an unbounded retry loop that no attempt ceiling governs.', v_cnt;
  END IF;

  -- ----- arm D4: the non-racing split with 142 reaper (D-04) -----------
  SELECT count(*) INTO v_cnt
    FROM public.compute_jobs
   WHERE strategy_id = v_d4 AND metadata->>'source' = 'reconcile-sweep';
  -- RED-UNDER: same concatenation break, applied to 'computing' in the last writer. That
  --            row belongs to Phase 142's reaper, which terminalizes it after 16 hours; the
  --            split by computation_status is the only thing keeping the two mechanisms from
  --            racing the same row. Part 1's `1/JOB-04/D-04` token pin cannot see a literal
  --            that is present but no longer compared.
  --            SINGLE-STEP by MEASUREMENT.
  -- RED-UNDER-M: {"arm":"2/arm D4/JOB-04/D-04/SC#3","apply":[{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"                    AND sa.computation_status IN ('computing', 'complete', 'complete_with_warnings', 'failed')\n","replace":"                    AND sa.computation_status IN ('computing' || 'X', 'complete', 'complete_with_warnings', 'failed')\n","occurrences":1}]}
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm D4/JOB-04/D-04/SC#3): a strategy sitting at computation_status computing was healed (% sweep-marked jobs). That row belongs to Phase 142 stuck-computing reaper (20260802120000), which terminalizes it after 16 hours. The split by computation_status is the ONLY thing keeping the two mechanisms from racing the same row: absent and pending are this sweep, computing is the reaper, the three terminal values are nobody. Without it a strategy can be re-enqueued by one mechanism while the other is terminalizing it.', v_cnt;
  END IF;

  -- ----- arm E: the composite money surface (DX-05/D-09) ---------------
  SELECT count(*) INTO v_cnt
    FROM public.compute_jobs
   WHERE strategy_id = v_e AND metadata->>'source' = 'reconcile-sweep';
  -- RED-UNDER: neutralise the composite-exclusion subquery with `AND FALSE` in the last
  --            writer, leaving `public.strategy_keys` in the body so Part 1's anchor and
  --            STEP 2 :561 both stay green. Enqueueing compute_analytics_from_csv on a
  --            composite hands the composite headline to the single-key computation its own
  --            handler deliberately abandoned: silent corruption of a CORRECT row on a money
  --            surface, strictly worse than the un-healed hole this file guards.
  --            SINGLE-STEP by MEASUREMENT.
  -- RED-UNDER-M: {"arm":"2/arm E/JOB-04/DX-05/SC#3","apply":[{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"                   FROM public.strategy_keys sk\n                  WHERE sk.strategy_id = s.id\n","replace":"                   FROM public.strategy_keys sk\n                  WHERE sk.strategy_id = s.id AND FALSE\n","occurrences":1}]}
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm E/JOB-04/DX-05/SC#3): a COMPOSITE strategy -- one carrying strategy_keys member rows -- was healed (% sweep-marked jobs). Enqueueing compute_analytics_from_csv on a composite hands the composite headline to the SINGLE-KEY computation its own handler deliberately abandoned: a sqrt(252)-vs-sqrt(365) annualization divergence plus a 0.0 gap-fill that fabricates flat performance (job_worker.py:6808-6822). That is SILENT CORRUPTION OF A CORRECT ROW ON A MONEY SURFACE, strictly worse than the un-healed hole this file guards. A composite needs stitch_composite re-run, which is a different mechanism with a different predicate.', v_cnt;
  END IF;

  -- ----- arm F: archived ------------------------------------------------
  SELECT count(*) INTO v_cnt
    FROM public.compute_jobs
   WHERE strategy_id = v_f AND metadata->>'source' = 'reconcile-sweep';
  -- RED-UNDER: compare the status against 'archived_zzz' in the last writer. The substring
  --            'archived' is still in the body, so Part 1's `1/JOB-04/DX-06` pin and STEP 2
  --            :582 stay green while archived strategies once again consume worker slots
  --            computing analytics nobody reads.
  --            SINGLE-STEP by MEASUREMENT.
  -- RED-UNDER-M: {"arm":"2/arm F/JOB-04/DX-06/SC#3","apply":[{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"         WHERE s.status <> 'archived'\n","replace":"         WHERE s.status <> 'archived_zzz'\n","occurrences":1}]}
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm F/JOB-04/DX-06/SC#3): an ARCHIVED strategy was healed (% sweep-marked jobs). Archived strategies consume worker slots computing analytics nobody reads. Note that draft is DELIBERATELY included by contrast -- a drop victim may sit pre-terminal precisely because nothing advanced it.', v_cnt;
  END IF;

  -- ----- whole-block invariant -----------------------------------------
  -- Identity-scoped, never a global count. This catches an arm being healed that
  -- no individual assertion above happened to name -- e.g. a future arm added
  -- without its own check. Exactly FOUR of this block's sixteen seeds are
  -- healable (A, A2, C4 and -- since R3 -- C5b). ⚠️ This count moved from 2/12
  -- to 3/14 in the SAME commit as migration 20260819130500, and from 3/14 to
  -- 4/16 in the SAME commit as 20260819150000; a whole-block invariant left at
  -- an old number would RED for the right reason with the wrong message, and
  -- one left unscoped would stop catching the arm nobody named.
  SELECT count(*) INTO v_cnt
    FROM public.compute_jobs
   WHERE strategy_id = ANY (v_seeded) AND metadata->>'source' = 'reconcile-sweep';
  -- RED-UNDER: break the archived-strategy exclusion in the DEPLOYED sweep body -- the same
  --            one-line production edit `2/arm F/JOB-04/DX-06/SC#3` uses -- and neuter arm
  --            F's own assertion, the single raise that dominates this one under that edit.
  --            The sweep then heals the archived seed as well, so the block's total goes
  --            4 -> 5 and this invariant is what reports it.
  --
  --            ⛔ THIS TWIN WAS REFUTED AND REPLACED, 2026-09-05. Do not restore the old one.
  --            WHO: the phase's gsd-code-reviewer, finding WR-A of the fix-pass review;
  --            re-derived independently on real lanes by the fixer before this edit was made.
  --            WHAT IT USED TO BE: a `{"kind":"edit"}` step against THIS GATE FILE, seeding a
  --            SEVENTEENTH healable strategy `v_g` that no per-arm assertion names. A
  --            gate-self mutation with no production preimage.
  --            WHAT JUSTIFIED IT: a recorded conclusion reading "No production mutation can
  --            reach this raise ahead of a per-arm raise; only a new un-asserted seed can."
  --            WHY THAT WAS WRONG: its premise is TRUE and its conclusion does not follow.
  --            Every one of the sixteen seeds does have its sweep-marked count pinned exactly
  --            (four at 1, twelve at 0, and arm A additionally by a TOTAL row count), so this
  --            sum cannot diverge from 4 unless a per-arm number diverges first -- but that
  --            is a statement about ORDER, not about reachability. `neuter` is the corpus
  --            primitive for precisely that distinction: it suppresses the dominating raise
  --            so the dominated one can be measured. The old prose reasoned as though a
  --            dominator made this raise unreachable, which is the same step the CR-01 record
  --            above got wrong, on `2/JOB-04`, earlier in this same file.
  --            HOW IT WAS REFUTED: real pg-lane, PostgreSQL 16 + pg_cron, the file's own
  --            RED-UNDER-SETUP apply list, arm F's production migration edit applied to the
  --            COPY, and exactly ONE neuter -- arm F's assertion, found by running the
  --            mutation with no neuters at all and reading the arm the runner named
  --            (`WRONG-ARM(2/arm F/JOB-04/DX-06/SC#3)`), never assumed. Lane exit 3, and the
  --            FIRST and ONLY failure is this arm, raised from this DO body:
  --                psql:<scratch>/gate.sql:1362: ERROR:  P0001: TEST FAILED
  --                (2/whole-block/JOB-04): one tick produced 5 sweep-marked jobs across MY
  --                sixteen seeded strategies, expected exactly 4 (arms A, A2, C4 and C5b).
  --            Under the runner the same twin scores `arm 2/whole-block/JOB-04 exit 3 RED
  --            (identity ok)`.
  --            ⚠️ Note what this raise's OWN message claims: that any other number "means a
  --            guard fell or a heal was lost". That is a production claim, so a gate-self
  --            twin was never the honest falsifier for it. The un-asserted-seventeenth-seed
  --            scenario its comment names above is a real second route -- but it is not the
  --            only one, and it is not the one that proves this arm reacts to a PRODUCTION
  --            regression, which is what ARMS_FLOOR counts.
  -- RED-UNDER-M: {"arm":"2/whole-block/JOB-04","apply":[{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"         WHERE s.status <> 'archived'\n","replace":"         WHERE s.status <> 'archived_zzz'\n","occurrences":1}],"neuter":[{"arm":"2/arm F/JOB-04/DX-06/SC#3"}]}
  IF v_cnt <> 4 THEN
    RAISE EXCEPTION 'TEST FAILED (2/whole-block/JOB-04): one tick produced % sweep-marked jobs across MY sixteen seeded strategies, expected exactly 4 (arms A, A2, C4 and C5b). Every other arm is a documented false-positive guard, so any other number means a guard fell or a heal was lost -- and the per-arm assertions above should name which.', v_cnt;
  END IF;

  RAISE NOTICE 'Part 2 OK: the FOUR healable arms (A no-analytics, A2 pending-analytics, C4 terminalizer-marked orphan, C5b two marked rows -- one below the readmit ceiling) each got one pending compute_analytics_from_csv job carrying the reconcile-sweep marker and detected_at; the in-grace (B), running-other-kind (C1), genuine-failed_final (C2), NULL-last_error-failed_final (C2b), done (C3), at-the-ceiling (C5), terminal-analytics (D1 complete / D2 complete_with_warnings / D3 failed), computing (D4), composite (E) and archived (F) arms were all left untouched.';

  -- Teardown, belt-and-suspenders; the ROLLBACK also discards everything.
  DELETE FROM auth.users WHERE id = v_user;
END
$$;
ROLLBACK;

-- ==========================================================================
-- Part 3 -- SEQUENTIAL RE-RUN (SC#2 idempotency half). Rolls back
-- unconditionally.
--
-- ⚠️⚠️ READ THIS BEFORE CITING PART 3 AS EVIDENCE FOR ANYTHING.
--
-- What this part proves: running the DEPLOYED body twice in one session leaves
-- exactly ONE job row for the healed strategy, and it is the SAME row (same id),
-- not a delete-and-reinsert. That is a real, user-visible property -- a second
-- tick must never double-enqueue -- and it is worth a gate.
--
-- What this part does NOT prove, stated plainly rather than left for a reader to
-- assume: it is NOT a proof of `ON CONFLICT DO NOTHING`. Phase 143 Plan 02
-- MEASURED that (143-02-SUMMARY.md, "MEASURED CORRECTION 1"): tick 1's INSERT
-- gives the strategy a compute_jobs row, which immediately removes it from the
-- body's own zero-jobs conjunct, so tick 2's batch is EMPTY and the INSERT is
-- never reached. With ON CONFLICT DO NOTHING deleted from the deployed body, a
-- second sequential tick STILL raises nothing. A gate that claims to prove the
-- conflict clause by executing the body twice in one session CANNOT FAIL.
--
-- So this part is a DOUBLE-MUTATION observable, in the same register as
-- test_strategy_analytics_stuck_computing_reaper.sql Part 4b:
--   * remove ON CONFLICT DO NOTHING alone      -> still GREEN (tick 2 is empty)
--   * remove the zero-jobs conjunct alone      -> still GREEN (ON CONFLICT absorbs)
--   * remove BOTH                              -> RED on 23505 unique_violation
-- Only the third reddens it. That is depth, not coverage.
--
-- The SINGLE-MUTATION proofs live elsewhere and this part must never be credited
-- with them:
--   * the zero-jobs conjunct  -> Part 2 arms C1/C2/C2b/C3/C4 (kind-scope it and
--     C1 REDs; delete B4's marker exemption and C4 REDs; widen it to a blanket
--     status list and C2 + C3 BOTH RED)
--   * ON CONFLICT / SKIP LOCKED under a real race -> the three-case READ COMMITTED
--     two-session experiment recorded in 143-02-SUMMARY.md. It needs TWO sessions
--     and therefore CANNOT be expressed in this single-session psql file. ⛔ That
--     means the race clauses have NO CI gate. Do not paper over it: the honest
--     statement is that they are pinned by Part 1's text anchors (which catch
--     deletion but not behaviour) plus a recorded offline measurement.
-- ==========================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$
DECLARE
  v_user    uuid := gen_random_uuid();
  v_strat   uuid;
  v_command TEXT;
  v_cnt     INTEGER;
  v_job1    uuid;
  v_job2    uuid;
  v_fresh   TIMESTAMPTZ := now();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'SKIP Part 3: pg_cron is not installed here, so the deployed-body oracle is unavailable (local dev only).';
    RETURN;
  END IF;

  SELECT command INTO v_command
    FROM cron.job WHERE jobname = 'reconcile_dropped_enqueue_sweep';
  -- ⛔ NOT AN ARM, AND DELIBERATELY NOT ONE. This guard carries no
  --    `TEST FAILED (` identity, so the runner does not count it as a section
  --    (parse.mjs:993 IDENTITY_CARRIER, and the classification comment at
  --    parse.mjs:1057). That is the honest classification, not a way to dodge
  --    a twin.
  --
  --    ⛔ RECLASSIFIED 2026-09-05, after review finding CR-02 of
  --    164.4.1-REVIEW.md. It USED TO carry `TEST FAILED (3/JOB-04)` plus a
  --    twin that mutated THIS GATE FILE'S own oracle lookup, and so counted
  --    +1 toward `biting` and toward `ARMS_FLOOR`. It is the THIRD copy of one
  --    registration guard (Part 1's `1/JOB-04`, then `2/JOB-04`, then this) and
  --    each copy is dominated by the one before it. For it to fail FIRST, Parts
  --    1 and 2 must both pass -- meaning cron.job.command was non-NULL when
  --    Part 2 read it -- while Part 3 reads NULL. Nothing can change cron.job
  --    between those two reads: everything Part 2 does is inside the
  --    transaction rolled back at the `ROLLBACK;` closing Part 2.
  --
  --    MEASURED by the fixer on a real pg-lane, 2026-09-05, before this edit --
  --    the reviewer's finding was re-derived, not taken on trust. Both escape
  --    routes were driven and both failed:
  --      * 5 `1/JOB-04` raises AND `2/JOB-04` neutered, with the same
  --        `DELETE FROM cron.job WHERE jobname = 'reconcile_dropped_enqueue_sweep'`
  --        post-apply that `2/JOB-04` now uses: Part 2 reaches its oracle call
  --        and the lane exits 3 on
  --            psql:<scratch>/gate.sql:1286: ERROR:  22004: query string argument of EXECUTE is null
  --        naming no arm. This guard is never reached.
  --      * a deployed body that unschedules ITSELF (a `PERFORM
  --        cron.unschedule('reconcile_dropped_enqueue_sweep');` spliced into
  --        20260819150000's command string, in a scratch copy -- the repo's
  --        migrations were not touched): Parts 1 and 2 stay green, this guard
  --        reads the row BACK because Part 2's unschedule was rolled back with
  --        the rest of Part 2, and the lane dies further down at
  --            psql:<scratch>/gate.sql:1413: ERROR:  XX000: could not find valid entry for job 'reconcile_dropped_enqueue_sweep'
  --        -- again not this guard.
  --    ⚠️ The two `gate.sql:NNNN` numbers just above are NOT re-measured and are
  --    known STALE: psql reports the line where it finished reading the DO
  --    statement, so they move whenever prose is added above them (the WR-A/WR-B/
  --    WR-C records of 2026-09-05 added ~50 lines). The ERROR CODES and the
  --    conclusion -- 22004 and XX000, neither naming an arm -- are what the record
  --    rests on and both were measured. Re-drive the two routes if a line number
  --    is ever needed; do not transcribe these.
  --
  --    A raise that cannot be made to fire is not a falsifiable assertion about
  --    production, and the founder rule is that a test which CANNOT FAIL is
  --    worse than none. So it stops CLAIMING to be one. It is kept, rather than
  --    deleted, for the one thing it still does: if a future refactor ever
  --    makes this reachable it fails with a named invariant instead of a raw
  --    22004 out of the EXECUTE below. The registration ASSERTION lives in
  --    Part 1 and in `2/JOB-04`, both of which bite.
  --
  --    ⚠️ Do NOT restore the identity spelling for 3/JOB-04, and do NOT give it
  --    back a gate-self twin. Either move re-adds an unfalsifiable section, and
  --    the only way to make the corpus green again would be a waiver -- which
  --    is exactly what WAIVED_CEILING 0 refuses (164.4.1-CONTEXT D-03). This is
  --    the same treatment `3/JOB-05` (test_retention_orphaned_running.sql:1011,
  --    commit fcbc0159) and the reaper's Part 3 guard
  --    (test_strategy_analytics_stuck_computing_reaper.sql:765, commit 95197d28)
  --    already carry; CR-02's point was that this file resolved the identical
  --    shape the opposite way.
  IF v_command IS NULL THEN
    RAISE EXCEPTION 'INVARIANT (Part 3 precondition): the reconcile_dropped_enqueue_sweep cron job is missing while pg_cron is installed, but Part 1 and Part 2 both passed. That is supposed to be unreachable -- see the note above. The registration assertions are Part 1 (1/JOB-04) and Part 2 (2/JOB-04).';
  END IF;

  INSERT INTO auth.users (id, email)
    VALUES (v_user, 'job04-idem-' || v_user || '@invalid.local');
  INSERT INTO public.profiles (id, display_name)
    VALUES (v_user, 'job04-idem') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.strategies (user_id, name)
    VALUES (v_user, 'job04-idem-strat') RETURNING id INTO v_strat;

  INSERT INTO public.csv_daily_returns (strategy_id, date, daily_return, created_at)
    VALUES (v_strat, DATE '2026-01-02', 0.001, v_fresh - interval '100 years');

  -- ----- tick 1 --------------------------------------------------------
  EXECUTE v_command;

  SELECT count(*) INTO v_cnt
    FROM public.compute_jobs
   WHERE strategy_id = v_strat AND metadata->>'source' = 'reconcile-sweep';
  -- RED-UNDER: flip the grace-window comparison in the DEPLOYED sweep body from `<` to `>`
  --            -- the same one-line production edit `2/arm A/JOB-04/SC#1` uses -- so this
  --            part's century-back anchor stops qualifying and tick 1 heals nothing.
  --
  --            ⛔ THIS TWIN WAS REFUTED AND REPLACED, 2026-09-05. Do not restore the old one.
  --            WHO: the phase's gsd-code-reviewer, finding WR-B of the fix-pass review;
  --            re-derived independently on real lanes by the fixer before this edit was made.
  --            WHAT IT USED TO BE: a `{"kind":"edit"}` step against THIS GATE FILE, stamping
  --            this part's seed INSIDE the grace window instead of a century back. A
  --            gate-self mutation with no production preimage.
  --            WHAT JUSTIFIED IT: a recorded conclusion reading "it makes no claim about
  --            production, so no production mutation can falsify it. Any production change
  --            that stopped the heal REDs Part 2 arm A first (`2/arm A/JOB-04/SC#1`)."
  --            WHY THAT WAS WRONG: two errors, one of order and one of self-description.
  --            (1) Arm A does RED first -- and so do NINE further Part 2 raises -- but
  --            "another arm fires first" is DOMINATION, not unreachability, and `neuter`
  --            exists to lift exactly that. (2) "SEED-INTEGRITY CONTROL" is only half true.
  --            The raise's precondition -- that one tick of the deployed sweep heals one
  --            seeded orphan -- is a PRODUCTION fact, not a fixture fact, and it stops
  --            holding when the sweep's grace window breaks. A broken seed is one way to
  --            reach this raise; a broken sweep is another, and it is the one ARMS_FLOOR
  --            counts.
  --            HOW IT WAS REFUTED: real pg-lane, PostgreSQL 16 + pg_cron, the file's own
  --            RED-UNDER-SETUP apply list, arm A's production migration edit applied to the
  --            COPY, and TEN dominating raises neutered. ⭐ The ten were DISCOVERED ONE AT A
  --            TIME, never assumed: install the annotation, run the arm, read the arm the
  --            runner names in `WRONG-ARM(...)`, append that one, repeat. Eleven rounds; the
  --            eleventh is green. `2/arm A/JOB-04` appears TWICE in the list because that arm
  --            raises twice and each `neuter` entry suppresses one raise. Lane exit 3, and
  --            the FIRST and ONLY failure is this arm, raised from this DO body:
  --                psql:<scratch>/gate.sql:1589: ERROR:  P0001: TEST FAILED (3/tick
  --                1/JOB-04): the first tick produced 0 sweep-marked jobs for my seeded
  --                orphan, expected exactly 1.
  --            Under the runner the same twin scores `arm 3/tick 1/JOB-04 exit 3 RED
  --            (identity ok)`.
  --            ⚠️ The seed-integrity READING of this raise survives and is still true -- if
  --            tick 1 did not heal, the re-run assertion below is vacuous. What changed is
  --            the falsifier: the twin now breaks the sweep rather than the fixture, so a
  --            production regression is what this arm is proven to react to.
  -- RED-UNDER-M: {"arm":"3/tick 1/JOB-04","apply":[{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"               ) < now() - interval '1 hour'\n","replace":"               ) > now() - interval '1 hour'\n","occurrences":1}],"neuter":[{"arm":"2/arm A/JOB-04/SC#1"},{"arm":"2/arm A/JOB-04"},{"arm":"2/arm A/JOB-04"},{"arm":"2/arm A/JOB-04/D-11/SC#1"},{"arm":"2/arm A/JOB-04/D-11"},{"arm":"2/arm A2/JOB-04/D-04"},{"arm":"2/arm B/JOB-04/SC#3"},{"arm":"2/arm C4/JOB-04/SC#3/B4"},{"arm":"2/arm C5b/JOB-04/R3/SC#3"},{"arm":"2/whole-block/JOB-04"}]}
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (3/tick 1/JOB-04): the first tick produced % sweep-marked jobs for my seeded orphan, expected exactly 1. This is a seed-integrity control: if tick 1 did not heal, the re-run assertion below would be vacuous and this part would prove nothing about idempotency.', v_cnt;
  END IF;

  SELECT id INTO v_job1
    FROM public.compute_jobs
   WHERE strategy_id = v_strat AND metadata->>'source' = 'reconcile-sweep';

  -- ----- tick 2 --------------------------------------------------------
  EXECUTE v_command;

  SELECT count(*) INTO v_cnt
    FROM public.compute_jobs WHERE strategy_id = v_strat;
  -- RED-UNDER: prepend a DELETE of every pending sweep-marked job to the deployed body in
  --            the last writer, turning the second tick into a delete-and-reinsert. The
  --            COUNT stays at one, so this arm's first raise cannot see it -- only the
  --            ROW-IDENTITY comparison does, which is exactly why that comparison exists:
  --            a delete-and-reinsert resets attempts, claim_token and created_at, so a job
  --            a worker is mid-claim on is silently pulled out from under it.
  --            ⚠️ The DELETE names compute_jobs UNQUALIFIED on purpose, so the body still
  --            spells PUBLIC.COMPUTE_JOBS exactly three times and Part 1's `D-02/R3` counter
  --            and STEP 2 :552 both stay green.
  --            SINGLE-STEP by MEASUREMENT.
  -- RED-UNDER-M: {"arm":"3/tick 2/JOB-04/SC#2","apply":[{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"    BEGIN\n      WITH batch AS MATERIALIZED (\n","replace":"    BEGIN\n      DELETE FROM compute_jobs cjd\n       WHERE cjd.metadata->>'source' = 'reconcile-sweep'\n         AND cjd.status = 'pending';\n      WITH batch AS MATERIALIZED (\n","occurrences":1}]}
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (3/tick 2/JOB-04/SC#2): after a SECOND tick my seeded strategy holds % compute_jobs rows, expected still exactly 1. A sweep that re-enqueues on every tick turns one dropped enqueue into 24 duplicate analytics jobs a day, each recomputing the same headline and each competing for the same worker slots.', v_cnt;
  END IF;

  SELECT id INTO v_job2
    FROM public.compute_jobs WHERE strategy_id = v_strat;
  IF v_job2 IS DISTINCT FROM v_job1 THEN
    RAISE EXCEPTION 'TEST FAILED (3/tick 2/JOB-04/SC#2): the second tick REPLACED the healed job row (id % became %). The count alone would not have caught this: a delete-and-reinsert keeps the count at one while resetting attempts, claim_token and created_at, so a job a worker is mid-claim on would be silently pulled out from under it.', v_job1, v_job2;
  END IF;

  RAISE NOTICE 'Part 3 OK: a second sequential tick left the healed job untouched -- same row, still exactly one. See this part header for what that does and does NOT prove about ON CONFLICT DO NOTHING.';

  DELETE FROM auth.users WHERE id = v_user;
END
$$;
ROLLBACK;

-- ==========================================================================
-- Part 4 -- THE BOUND (SC#2 bound half, D-08). LIMIT + 1 candidates, oracle run
-- TWICE. Rolls back unconditionally.
--
-- ⭐ This is the ONLY part of this file that can falsify the per-tick bound.
-- Part 1's `AS MATERIALIZED` counter is SHAPE enforcement and nothing more:
-- Plan 02 MEASURED that removing the keyword from this body changes neither the
-- EXPLAIN output nor the result, because the CTE carries a locking clause and
-- Postgres does not inline a locking CTE. Every gate in phases 142/142.1 passed
-- over a bound that did not exist precisely because it grepped for a token. Only
-- executing the deployed body against LIMIT+1 real rows falsifies it.
--
-- The 26 seeds are staggered a century back, so under the deployed
-- `ORDER BY <dailies MAX> ASC LIMIT 25` the 25 OLDEST seeds are exactly the ones
-- a correct tick must take, and v_youngest (the i=1 seed, least old) is exactly
-- the one it must leave. Asserting WHICH rows must move is strictly stronger than
-- counting HOW MANY moved, and it is the project's recorded e2e-seeded lesson:
-- assert your OWN seed invariant.
--   tick 1 -> my 25 oldest seeds are ALL healed AND v_youngest is NOT
--   tick 2 -> v_youngest is healed and all 26 are (bounded AND progressing)
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
  v_fresh    TIMESTAMPTZ := now();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'SKIP Part 4: pg_cron is not installed here, so the deployed-body oracle is unavailable (local dev only).';
    RETURN;
  END IF;

  SELECT command INTO v_command
    FROM cron.job WHERE jobname = 'reconcile_dropped_enqueue_sweep';
  -- ⛔ NOT AN ARM, AND DELIBERATELY NOT ONE -- the FOURTH copy of the same
  --    registration guard, one link further down the chain than Part 3's.
  --    RECLASSIFIED 2026-09-05 with it, after review finding CR-02 of
  --    164.4.1-REVIEW.md; it too used to carry a `TEST FAILED (4/JOB-04)`
  --    identity and a twin that mutated THIS GATE FILE'S own oracle lookup.
  --
  --    The domination is strictly stronger here than at Part 3: for this guard
  --    to fail FIRST, Parts 1, 2 AND 3 must all have passed. The measurement
  --    recorded on the Part 3 guard above therefore covers this one a fortiori
  --    -- with the Part 1 and Part 2 raises neutered and the job row deleted,
  --    the lane dies inside PART 2 on `22004: query string argument of EXECUTE
  --    is null`, so Part 4 is never entered at all. Read that note for the two
  --    escape routes and their measured outcomes.
  --
  --    Kept, not deleted, for the same single reason: a future refactor that
  --    somehow made this reachable gets a named invariant instead of a raw
  --    22004 out of the EXECUTE below. The registration ASSERTION lives in
  --    Part 1 (`1/JOB-04`) and Part 2 (`2/JOB-04`), both of which bite.
  --
  --    ⚠️ Do NOT restore the identity spelling for 4/JOB-04, and do NOT give it
  --    back a gate-self twin. See the Part 3 note.
  IF v_command IS NULL THEN
    RAISE EXCEPTION 'INVARIANT (Part 4 precondition): the reconcile_dropped_enqueue_sweep cron job is missing while pg_cron is installed, but Parts 1, 2 and 3 all passed. That is supposed to be unreachable -- see the note above. The registration assertions are Part 1 (1/JOB-04) and Part 2 (2/JOB-04).';
  END IF;

  INSERT INTO auth.users (id, email)
    VALUES (v_user, 'job04-bound-' || v_user || '@invalid.local');
  INSERT INTO public.profiles (id, display_name)
    VALUES (v_user, 'job04-bound') ON CONFLICT (id) DO NOTHING;

  -- LIMIT + 1 orphans, staggered so the deployed ordering is deterministic, and
  -- seeded A CENTURY back so all 26 outrank any plausible foreign candidate for
  -- the LIMIT-25 budget (isolation by construction -- see the file header).
  -- i=26 is the OLDEST seed, i=1 the youngest.
  FOR i IN 1..26 LOOP
    INSERT INTO public.strategies (user_id, name)
      VALUES (v_user, 'job04-bound-' || i::text) RETURNING id INTO v_strat;
    v_seeded := array_append(v_seeded, v_strat);
    INSERT INTO public.csv_daily_returns (strategy_id, date, daily_return, created_at)
      VALUES (v_strat, DATE '2026-01-02', 0.001,
              v_fresh - interval '100 years' - (i * interval '1 minute'));
  END LOOP;

  v_youngest := v_seeded[1];

  -- ----- tick 1: BOUNDED -------------------------------------------------
  EXECUTE v_command;

  SELECT count(*) INTO v_cnt
    FROM public.compute_jobs
   WHERE strategy_id = ANY (v_seeded)
     AND strategy_id <> v_youngest
     AND metadata->>'source' = 'reconcile-sweep';
  -- RED-UNDER: widen the effective bound to 35 by ARITHMETIC (`LIMIT 25 + 10`) in the last
  --            writer. ⭐ This is the one mutation the whole D-08 family is built around:
  --            the word-bounded regex in Part 1 and in STEP 2 :594 both still match, the
  --            MATERIALIZED counter is untouched, and NO amount of grepping detects it --
  --            only executing the deployed body against LIMIT+1 real rows does. On a corpus
  --            whose candidate count grows as done job rows age past the 30-day retention
  --            window, an unbounded tick is an unbounded write burst against compute_jobs.
  --            SINGLE-STEP by MEASUREMENT.
  -- RED-UNDER-M: {"arm":"4/JOB-04/D-08","apply":[{"kind":"edit","file":"supabase/migrations/20260819150000_reconcile_sweep_readmit_attempt_ceiling.sql","find":"         LIMIT 25\n         FOR UPDATE SKIP LOCKED\n","replace":"         LIMIT 25 + 10\n         FOR UPDATE SKIP LOCKED\n","occurrences":1}]}
  IF v_cnt <> 25 THEN
    RAISE EXCEPTION 'TEST FAILED (4/JOB-04/D-08): after ONE tick only % of MY 25 oldest seeded orphans were healed, expected all 25. Either the sweep is not draining its batch, or a foreign row older than the century-back seed epoch crowded a seed out of the LIMIT-25 budget (see the RESIDUAL ASSUMPTION in this file header).', v_cnt;
  END IF;

  SELECT count(*) INTO v_cnt
    FROM public.compute_jobs
   WHERE strategy_id = v_youngest AND metadata->>'source' = 'reconcile-sweep';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (4/JOB-04/D-08): my YOUNGEST seeded orphan -- the 26th, sitting outside a 25-row budget -- was healed on tick 1 (% sweep-marked jobs). The per-tick LIMIT is gone, so a backlog can be enqueued in a single tick: on a corpus whose candidate count grows as done job rows age past the 30-day retention window, that is an unbounded write burst against compute_jobs and an unbounded flood into the worker queue. This is the D-19 signature, and NO amount of grepping for AS MATERIALIZED can detect it -- only this execution can.', v_cnt;
  END IF;

  -- ----- tick 2: PROGRESSING --------------------------------------------
  -- The previous tick gave 25 of the seeds a job row, so they now fail the
  -- zero-jobs conjunct and v_youngest is the oldest remaining candidate this
  -- block owns. No neutralizing UPDATE is needed and none may be added.
  EXECUTE v_command;

  SELECT count(*) INTO v_cnt
    FROM public.compute_jobs
   WHERE strategy_id = v_youngest AND metadata->>'source' = 'reconcile-sweep';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (4/JOB-04/D-08): my youngest seeded orphan still has % sweep-marked jobs after a SECOND tick, expected 1. The sweep is bounded but NOT progressing, so a backlog would never drain and the oldest orphans would be healed while the newest starve forever.', v_cnt;
  END IF;

  SELECT count(*) INTO v_cnt
    FROM public.compute_jobs
   WHERE strategy_id = ANY (v_seeded) AND metadata->>'source' = 'reconcile-sweep';
  IF v_cnt <> 26 THEN
    RAISE EXCEPTION 'TEST FAILED (4/JOB-04/D-08): after two ticks % of my 26 seeded orphans are healed, expected all 26.', v_cnt;
  END IF;

  RAISE NOTICE 'Part 4 OK: the per-tick bound holds -- my 25 oldest seeded orphans healed on tick 1 with my youngest left alone, and my youngest healed on tick 2 (bounded AND progressing).';

  DELETE FROM auth.users WHERE id = v_user;
END
$$;
ROLLBACK;
