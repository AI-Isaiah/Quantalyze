-- Test: dropped-enqueue reconciliation sweep (JOB-04, Phase 143).
--
-- Guards migration
-- 20260816140000_reconcile_dropped_enqueue_sweep.sql: the pg_cron job
-- reconcile_dropped_enqueue_sweep, its '35 * * * *' cadence, its five predicate
-- conjuncts, its 1-hour grace window, its LIMIT-25 bound and the
-- {source: reconcile-sweep, detected_at} metadata marker the analytics worker
-- reads to fire its Sentry alert.
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
-- 20260522111839:40; no writer re-stamps it -- the persist and derive upserts
-- touch updated_at).
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
-- Usage:
--   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_reconcile_dropped_enqueue_sweep.sql
--
-- Run order: AFTER migration 20260816140000 is applied to the project. Before
-- that, Part 1 REDs by design.

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
  v_jobs := (length(upper(v_command)) - length(replace(upper(v_command), 'PUBLIC.COMPUTE_JOBS', ''))) / length('PUBLIC.COMPUTE_JOBS');
  IF v_jobs <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-04/D-02): the deployed body names public.compute_jobs % times, expected 2 (the zero-jobs NOT EXISTS conjunct + the INSERT target). One means the zero-jobs conjunct is GONE and the INSERT target alone is satisfying this gate, so every strategy holding a healthy in-flight chain -- a running derive_broker_dailies mid-chain, most of all -- would be re-enqueued on the next tick. Zero means the sweep no longer writes at all.', v_jobs;
  END IF;
  IF v_command NOT ILIKE '%public.strategy_analytics%' THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-04): the deployed body does not reference public.strategy_analytics. That conjunct is the ONLY protection for healthy retention-aged strategies (retention_compute_jobs_done DELETEs done rows at 30 days), so its absence is a mass re-enqueue of the entire historical corpus on the next tick.';
  END IF;
  IF v_command NOT ILIKE '%public.strategy_keys%' THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-04/DX-05): the deployed body does not exclude composites via public.strategy_keys. Enqueueing compute_analytics_from_csv on a composite overwrites a correct composite headline with the divergent single-key computation its own handler deliberately abandoned -- silent corruption of a CORRECT row on a money surface.';
  END IF;

  -- The FOUR excluded terminal/racing statuses, each quoted so 'complete' cannot
  -- be satisfied by the substring inside 'complete_with_warnings'.
  IF v_command NOT ILIKE '%''computing''%' THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-04/D-04): the deployed body no longer excludes computation_status computing. That is 142 reaper own row: the split by computation_status is what keeps the two mechanisms from racing the same strategy, and without it this sweep re-enqueues a row the reaper is mid-way through terminalizing.';
  END IF;
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
  IF v_command !~ 'LIMIT[[:space:]]+25([^0-9]|$)' THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-04/D-08): the deployed body does not carry a word-bounded LIMIT 25. Either the bound is gone -- an unbounded sweep is exactly the blast radius the cap exists to hold, and a single tick could enqueue the whole candidate population at once -- or it has been widened to LIMIT 25<digits>, which multiplies that blast radius while still containing the literal substring the old substring gate tested for.';
  END IF;
  IF v_command NOT ILIKE '%FOR UPDATE SKIP LOCKED%' THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-04): the deployed body dropped FOR UPDATE SKIP LOCKED. Measured in Plan 02 at READ COMMITTED: an INSERT into compute_jobs takes an FK KEY SHARE lock on its parent strategies row, so this clause is what makes the sweep SKIP a strategy the live enqueue path is mid-insert on. Without it the sweep BLOCKS on that lock instead.';
  END IF;
  IF v_command NOT ILIKE '%ON CONFLICT DO NOTHING%' THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-04/SC#2): the deployed body lost ON CONFLICT DO NOTHING. Measured in Plan 02: with SKIP LOCKED removed the sweep blocks on the FK lock, meets the committed row on release, and this clause is what absorbs it; remove BOTH and the tick dies on 23505, losing the healed count and skipping every remaining candidate in the batch.';
  END IF;
  IF v_command NOT ILIKE '%interval ''1 hour''%' THEN
    RAISE EXCEPTION 'TEST FAILED (1/JOB-04): the deployed body does not carry the 1-hour grace literal. Without a grace window the sweep RACES the live after() enqueue it exists to backstop and inserts duplicate work on the NORMAL path.';
  END IF;
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

  RAISE NOTICE 'Part 1 OK: reconcile_dropped_enqueue_sweep registered exactly once at 35 * * * *, with the five predicate conjuncts anchored, the four excluded statuses present, the marker keys pinned, LIMIT 25 / SKIP LOCKED / ON CONFLICT DO NOTHING present, 1 MATERIALIZED batch, 2 grace-anchor reads, and no IN-subquery LIMIT, rejected anchor column or enqueue RPC.';
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
--   C2  only a failed_final job                              -> MUST be untouched
--   C3  only a done job                                      -> MUST be untouched
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
-- Untouched arms assert ZERO compute_jobs rows CARRYING THE MARKER for their own
-- strategy id -- not zero job rows, because C1/C2/C3 deliberately have one. That
-- is what makes the assertion identity-scoped AND kind-of-write-scoped at once.
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
  v_c2       uuid;   -- skip: failed_final job
  v_c3       uuid;   -- skip: done job
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
  INSERT INTO public.strategies (user_id, name) VALUES (v_user, 'job04-arm-c3') RETURNING id INTO v_c3;
  INSERT INTO public.strategies (user_id, name) VALUES (v_user, 'job04-arm-d1') RETURNING id INTO v_d1;
  INSERT INTO public.strategies (user_id, name) VALUES (v_user, 'job04-arm-d2') RETURNING id INTO v_d2;
  INSERT INTO public.strategies (user_id, name) VALUES (v_user, 'job04-arm-d3') RETURNING id INTO v_d3;
  INSERT INTO public.strategies (user_id, name) VALUES (v_user, 'job04-arm-d4') RETURNING id INTO v_d4;
  INSERT INTO public.strategies (user_id, name) VALUES (v_user, 'job04-arm-e')  RETURNING id INTO v_e;
  INSERT INTO public.strategies (user_id, name, status)
    VALUES (v_user, 'job04-arm-f', 'archived') RETURNING id INTO v_f;

  v_seeded := ARRAY[v_a, v_a2, v_b, v_c1, v_c2, v_c3, v_d1, v_d2, v_d3, v_d4, v_e, v_f];

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
    (v_c3, DATE '2026-01-02', 0.001, v_old),
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

  -- Arms C2/C3: TERMINAL job rows. These are the retention-aged shape -- the
  -- partial unique index does NOT cover 'done' / 'failed_final', so if the
  -- zero-jobs conjunct were weakened nothing downstream would stop the re-insert.
  INSERT INTO public.compute_jobs
    (kind, strategy_id, status, priority, attempts, next_attempt_at)
  VALUES
    ('compute_analytics_from_csv', v_c2, 'failed_final', 'normal', 3, now()),
    ('compute_analytics_from_csv', v_c3, 'done',         'normal', 1, now());

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
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm A/JOB-04/SC#1): a strategy with dailies past the grace window, ZERO compute_jobs rows and NO strategy_analytics row got % compute_jobs rows from one tick, expected exactly 1. Zero means the sweep does not detect the dropped-enqueue population at all and the hole this phase exists to close is still open; more than one means the bounded batch is inserting duplicates.', v_cnt;
  END IF;

  SELECT status, kind, metadata->>'source', metadata->>'detected_at'
    INTO v_status, v_kind, v_source, v_detected
    FROM public.compute_jobs WHERE strategy_id = v_a;

  IF v_status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm A/JOB-04): the healed job landed at status % and not pending, so no worker will ever claim it. A job the sweep inserts but nobody claims is indistinguishable from the hole it was meant to close.', v_status;
  END IF;
  IF v_kind IS DISTINCT FROM 'compute_analytics_from_csv' THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm A/JOB-04): the healed job carries kind % and not compute_analytics_from_csv, so it would be dispatched to the wrong handler -- or to none at all.', v_kind;
  END IF;
  IF v_source IS DISTINCT FROM 'reconcile-sweep' THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm A/JOB-04/D-11/SC#1): the healed job metadata source is % and not reconcile-sweep. analytics-service/main_worker.py reads that EXACT literal on claim to fire the Sentry alert, so this drift heals the strategy SILENTLY -- the alert half of SC#1 becomes false while both halves own unit tests stay green.', v_source;
  END IF;
  IF v_detected IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm A/JOB-04/D-11): the healed job carries no detected_at. It is the other half of the cross-language marker contract; the Sentry event has no timestamp for when the drop was observed, so an operator cannot tell a fresh drop from a month-old one.';
  END IF;

  -- ----- arm A2: 'pending' analytics must NOT protect ------------------
  SELECT count(*) INTO v_cnt
    FROM public.compute_jobs
   WHERE strategy_id = v_a2 AND metadata->>'source' = 'reconcile-sweep';
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm A2/JOB-04/D-04): a strategy whose strategy_analytics row sits at pending got % sweep-marked jobs, expected 1. pending means nothing ever advanced the row -- which is precisely the dropped-enqueue signature -- so excluding it would excise a large part of the population this sweep exists to heal.', v_cnt;
  END IF;

  -- ----- arm B: the grace window ---------------------------------------
  SELECT count(*) INTO v_cnt
    FROM public.compute_jobs
   WHERE strategy_id = v_b AND metadata->>'source' = 'reconcile-sweep';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm B/JOB-04/SC#3): a strategy whose dailies landed THIS INSTANT was healed (% sweep-marked jobs). The grace window is gone or the anchor is wrong, so the sweep now RACES the live after() enqueue it exists to backstop and inserts duplicate work on the NORMAL path -- it would fire on every healthy CSV finalize.', v_cnt;
  END IF;

  -- ----- arm C1: ANY-kind zero-jobs conjunct (D-02) ---------------------
  SELECT count(*) INTO v_cnt
    FROM public.compute_jobs
   WHERE strategy_id = v_c1 AND metadata->>'source' = 'reconcile-sweep';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm C1/JOB-04/D-02/SC#3): a strategy with a RUNNING derive_broker_dailies job was healed (% sweep-marked jobs). The zero-jobs conjunct has been kind-scoped. derive_broker_dailies upserts the dailies and only THEN enqueues its follow-on, both inside the still-running parent, so kind-scoping re-enqueues a HEALTHY IN-FLIGHT CHAIN and races the chain against itself.', v_cnt;
  END IF;

  -- ----- arms C2/C3: terminal job rows ---------------------------------
  SELECT count(*) INTO v_cnt
    FROM public.compute_jobs
   WHERE strategy_id = v_c2 AND metadata->>'source' = 'reconcile-sweep';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm C2/JOB-04/SC#3): a strategy whose only compute_jobs row is failed_final was healed (% sweep-marked jobs). A settled permanent failure belongs to nobody; re-enqueueing it turns it into an hourly retry loop with no attempt ceiling, and the partial unique index does not cover failed_final so nothing downstream stops it.', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt
    FROM public.compute_jobs
   WHERE strategy_id = v_c3 AND metadata->>'source' = 'reconcile-sweep';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm C3/JOB-04/SC#3): a strategy whose only compute_jobs row is done was healed (% sweep-marked jobs). The partial unique index does not cover done either, so this is a straight duplicate enqueue of work that already completed.', v_cnt;
  END IF;

  -- ----- arm D1: THE MASS-RE-ENQUEUE TRIPWIRE (D-03) -------------------
  SELECT count(*) INTO v_cnt
    FROM public.compute_jobs
   WHERE strategy_id = v_d1 AND metadata->>'source' = 'reconcile-sweep';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm D1/JOB-04/D-03/SC#3): a strategy with a COMPLETE strategy_analytics row was healed (% sweep-marked jobs). This is THE MASS-RE-ENQUEUE INCIDENT. retention_compute_jobs_done DELETEs done job rows at 30 days, so every healthy 31-day-old strategy already matches dailies-present-and-zero-jobs; the terminal-analytics conjunct is the ONLY thing between the first tick and a re-enqueue of the ENTIRE HISTORICAL CORPUS, and the number grows monotonically as the corpus ages. Measured on PROD at authoring time: 4 of 4 zero-job strategies with dailies are excluded solely by this conjunct.', v_cnt;
  END IF;

  -- ----- arms D2/D3: the other terminal statuses -----------------------
  SELECT count(*) INTO v_cnt
    FROM public.compute_jobs
   WHERE strategy_id = v_d2 AND metadata->>'source' = 'reconcile-sweep';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm D2/JOB-04/D-03/SC#3): a strategy at complete_with_warnings was healed (% sweep-marked jobs) -- the mass-re-enqueue incident, partial edition. Its correct headline would be recomputed for no reason on a money surface.', v_cnt;
  END IF;
  SELECT count(*) INTO v_cnt
    FROM public.compute_jobs
   WHERE strategy_id = v_d3 AND metadata->>'source' = 'reconcile-sweep';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm D3/JOB-04/D-03/SC#3): a strategy whose analytics are terminally failed was healed (% sweep-marked jobs). A terminal failure belongs to nobody, and re-enqueueing it hourly is an unbounded retry loop that no attempt ceiling governs.', v_cnt;
  END IF;

  -- ----- arm D4: the non-racing split with 142 reaper (D-04) -----------
  SELECT count(*) INTO v_cnt
    FROM public.compute_jobs
   WHERE strategy_id = v_d4 AND metadata->>'source' = 'reconcile-sweep';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm D4/JOB-04/D-04/SC#3): a strategy sitting at computation_status computing was healed (% sweep-marked jobs). That row belongs to Phase 142 stuck-computing reaper (20260802120000), which terminalizes it after 16 hours. The split by computation_status is the ONLY thing keeping the two mechanisms from racing the same row: absent and pending are this sweep, computing is the reaper, the three terminal values are nobody. Without it a strategy can be re-enqueued by one mechanism while the other is terminalizing it.', v_cnt;
  END IF;

  -- ----- arm E: the composite money surface (DX-05/D-09) ---------------
  SELECT count(*) INTO v_cnt
    FROM public.compute_jobs
   WHERE strategy_id = v_e AND metadata->>'source' = 'reconcile-sweep';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm E/JOB-04/DX-05/SC#3): a COMPOSITE strategy -- one carrying strategy_keys member rows -- was healed (% sweep-marked jobs). Enqueueing compute_analytics_from_csv on a composite hands the composite headline to the SINGLE-KEY computation its own handler deliberately abandoned: a sqrt(252)-vs-sqrt(365) annualization divergence plus a 0.0 gap-fill that fabricates flat performance (job_worker.py:6808-6822). That is SILENT CORRUPTION OF A CORRECT ROW ON A MONEY SURFACE, strictly worse than the un-healed hole this file guards. A composite needs stitch_composite re-run, which is a different mechanism with a different predicate.', v_cnt;
  END IF;

  -- ----- arm F: archived ------------------------------------------------
  SELECT count(*) INTO v_cnt
    FROM public.compute_jobs
   WHERE strategy_id = v_f AND metadata->>'source' = 'reconcile-sweep';
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (2/arm F/JOB-04/DX-06/SC#3): an ARCHIVED strategy was healed (% sweep-marked jobs). Archived strategies consume worker slots computing analytics nobody reads. Note that draft is DELIBERATELY included by contrast -- a drop victim may sit pre-terminal precisely because nothing advanced it.', v_cnt;
  END IF;

  -- ----- whole-block invariant -----------------------------------------
  -- Identity-scoped, never a global count. This catches an arm being healed that
  -- no individual assertion above happened to name -- e.g. a future arm added
  -- without its own check. Exactly TWO of this block's twelve seeds are healable.
  SELECT count(*) INTO v_cnt
    FROM public.compute_jobs
   WHERE strategy_id = ANY (v_seeded) AND metadata->>'source' = 'reconcile-sweep';
  IF v_cnt <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (2/whole-block/JOB-04): one tick produced % sweep-marked jobs across MY twelve seeded strategies, expected exactly 2 (arms A and A2). Every other arm is a documented false-positive guard, so any other number means a guard fell or a heal was lost -- and the per-arm assertions above should name which.', v_cnt;
  END IF;

  RAISE NOTICE 'Part 2 OK: the two orphan arms were healed with a pending compute_analytics_from_csv job carrying the reconcile-sweep marker and detected_at; the in-grace, any-job (running/failed_final/done), terminal-analytics (complete/complete_with_warnings/failed), computing, composite and archived arms were all left untouched.';

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
--   * the zero-jobs conjunct  -> Part 2 arms C1/C2/C3 (kind-scope it and C1 REDs)
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
  IF v_command IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (3/JOB-04): the reconcile_dropped_enqueue_sweep cron job is missing while pg_cron is installed.';
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
  IF v_command IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (4/JOB-04): the reconcile_dropped_enqueue_sweep cron job is missing while pg_cron is installed.';
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
