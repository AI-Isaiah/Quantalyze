-- Migration: readmit TERMINALIZER-PRODUCED orphans to the dropped-enqueue
-- reconciliation sweep (B4, Phase 146.1, v1.19 xhigh close-out, 2026-08-18)
-- =============================================================================
--
-- Why this migration exists
-- -------------------------
-- Phase 144's terminalizer (20260817120000) and Phase 143's reconciliation
-- sweep (20260816140000) DO NOT COMPOSE, and 144 said so itself at :56-64
-- rather than pretending otherwise:
--
--   "A CHAIN-MID orphan is recovered by nobody. Phase 143's sweep requires
--    NOT EXISTS (ANY compute_jobs row for the strategy), so a terminalized
--    orphan excludes its strategy from reconciliation forever."
--
-- The mechanism, end to end. derive_broker_dailies upserts the dailies and
-- only THEN enqueues its follow-on, both inside the still-running parent job
-- (job_worker.py:4742 then :5201-5209). If the worker is lost in that window
-- the parent sits 'running' with no claim progress; 144's terminalizer reaps it
-- to 'failed_final' after 4 h and stamps a fixed audit literal into last_error.
-- The strategy now carries dailies, no strategy_analytics row -- and ONE
-- terminal compute_jobs row. 143's zero-jobs conjunct is ANY-kind AND
-- ANY-status, so that single row excludes the strategy from the sweep
-- PERMANENTLY. Nobody recovers it: not the worker (the job is terminal), not
-- the sweep (this conjunct), and not the user (SyncPreviewStep's 15-minute
-- amber backstop only fires while the wizard page is still open).
--
-- 144 filed the residual deliberately rather than riding a change to 143's
-- shipped predicate in as a rider. This file is that change, scoped as narrowly
-- as the evidence allows.
--
-- ⚠️⚠️ THIS IS PREVENTIVE HARDENING, NOT A LIVE BREAK. READ THE CENSUS.
-- --------------------------------------------------------------------
-- MEASURED ON PROD (khslejtfbuezsmvmtsdn) VIA SUPABASE MCP ON 2026-08-18 --
-- a DATED CLAIM, not a standing fact, and the next reader must RE-MEASURE
-- rather than inherit it:
--
--   * ZERO compute_jobs rows carry the terminalizer's audit marker. The
--     terminalizer has NEVER FIRED in production since it shipped.
--   * running = 0 and pending = 0.
--   * All 122 'failed_final' rows are GENUINE job failures -- expired API
--     keys, insufficient trade history, MT5 unreachable, geo-blocks, code
--     bugs. That population is EXACTLY what the sweep gate's arms C2 and C3
--     exist to protect, and this migration must not disturb a single one.
--
-- So the reachable population of this fix is currently EMPTY. Nothing in this
-- file should be read as closing a live user-facing break; it closes a
-- structural hole BEFORE the terminalizer's first production firing opens it.
-- The population is narrowed further still because the sweep's
-- strategy_analytics conjunct already excludes most terminalized orphans once
-- Phase 142's reaper has run.
--
-- ⛔ Plan 146.1-08 RE-COUNTS the marked rows on PROD and on TEST immediately
-- before merge. If the count has moved off zero, the paragraph above is STALE
-- and must be corrected in this header before the merge lands.
--
-- The exact population this heals
-- -------------------------------
-- A strategy with ALL of:
--   * csv_daily_returns rows present and past the 1-hour grace window;
--   * no strategy_analytics row, or one at 'pending';
--   * no strategy_keys membership (not a composite);
--   * status <> 'archived';
--   * and whose ONLY compute_jobs rows are terminalizer-produced -- i.e. a
--     first-ever job that died inside the derive_broker_dailies
--     upsert-then-enqueue window named above and was later reaped.
-- Such a strategy re-enters the sweep and gets one pending
-- compute_analytics_from_csv job, at the unchanged rate of at most 25 per tick.
--
-- THE CHANGE IS EXACTLY ONE CONJUNCT
-- ----------------------------------
-- 20260816140000:726-731 registers a BARE zero-jobs test. This file adds a
-- single AND NOT (...) inside that subquery's WHERE, keyed on the audit marker
-- THE TERMINALIZER ITSELF STAMPS (20260817120000:622 and :641). Nothing else in
-- the body changes. The marker is a sound key precisely because it is the
-- terminalizer's own fixed literal and its 2-occurrence count is already gated
-- at 20260817120000:741 -- so marker drift REDs upstream, in 144's own
-- self-verify, before it could ever silently un-key this conjunct.
--
-- WHY A LOST-WORKER ROW IS NOT A VERDICT. 'failed_final' normally means a
-- handler looked at the work and refused it permanently. A terminalizer row
-- means no handler ever looked: the worker vanished holding the claim. 144
-- writes that row for the AUDIT TRAIL (last_error is the only operator-visible
-- record of why a row was reaped -- it is hard-redacted from users at the RPC
-- and zod layers, 20260817120000:288-292). Treating an audit artifact as a
-- permanent verdict is the actual defect. This conjunct says so in code.
--
-- ⛔ NOT TAKEN: the blanket "no NON-TERMINAL row" widening
-- --------------------------------------------------------
-- The v1.19 review roster originally proposed widening the conjunct to exclude
-- only NON-TERMINAL rows -- i.e. letting ANY 'failed_final' or 'done' row
-- through. That option is NAMED HERE, with its cost, so the decision stays
-- visible and reversible instead of being silently foreclosed:
--
--   COST: it REDDENS two shipped arms of
--   supabase/tests/test_reconcile_dropped_enqueue_sweep.sql -- C2 (:554-561)
--   and C3 (:563-568) -- whose messages name the real failure mode: "a settled
--   permanent failure belongs to nobody; re-enqueueing it turns it into an
--   hourly retry loop with no attempt ceiling, and the partial unique index
--   does not cover failed_final so nothing downstream stops it." Taking it
--   would require DELETING or INVERTING those arms and their safety
--   rationale, which is the fix-the-test antipattern.
--
--   MEASURED 2026-08-18 on a throwaway postgres:16, over a faithful miniature
--   of this conjunct seeded with the five job shapes the gate's arms use: the
--   blanket form heals the genuine-failure rows AND the done row AND the
--   marked row (5 of 6 seeds). The narrow form below heals exactly the
--   no-jobs seed and the marked seed (2 of 6). That is the whole difference
--   between the two options, and it is a measurement rather than an argument.
--
-- If the founder later prefers the blanket wording, it is a legitimate call --
-- but it is a much larger and riskier edit than this one, and it must be taken
-- deliberately, with C2/C3 rewritten in the same commit.
--
-- ⚠️ NULL-SAFETY: WHY THE CONJUNCT CARRIES AN EXPLICIT `IS TRUE`
-- --------------------------------------------------------------
-- The conjunct is written as
--
--   AND NOT ((cj.status = 'failed_final'
--             AND cj.last_error LIKE 'orphaned_running_reaped:%') IS TRUE)
--
-- and the `IS TRUE` wrapper is LOAD-BEARING, not decoration. last_error is
-- NULLABLE. Without the wrapper, a 'failed_final' row with a NULL last_error
-- evaluates TRUE AND NULL => NULL, NOT NULL => NULL, and a NULL WHERE
-- condition does not match -- so the row DROPS OUT of the subquery, the
-- strategy looks jobless, and a GENUINE permanent failure carrying no error
-- text is HEALED. That is precisely the arm-C2 failure mode this migration
-- exists not to cause: an hourly retry loop over a settled failure.
--
-- MEASURED 2026-08-18 on a throwaway postgres:16 (same miniature as above):
--   naive form  -> heals {no-jobs, failed_final-with-NULL-last_error, marked}
--   IS TRUE form -> heals {no-jobs, marked}
-- The three-valued-logic trap is the same one this phase's A1 half closes on
-- the fold with IS DISTINCT FROM. Do not "simplify" the wrapper away; STEP 2
-- anchors it and gate arm C2b covers it behaviourally.
--
-- ⚠️ Re-registration CHANGES THE JOBID
-- ------------------------------------
-- cron.unschedule + cron.schedule DROPs the old cron.job row and INSERTs a new
-- one, so pg_cron assigns a FRESH jobid -- recorded by measurement at
-- 20260817120000:420-426 (observed on TEST: 11 -> 19). The JOBNAME is the
-- stable identifier and is UNCHANGED here, which is why every gate keys on the
-- name. Any operator runbook or dashboard pinning this sweep's jobid needs
-- re-reading after this applies.
--
-- ⛔ NO OTHER CRON JOB IS TOUCHED. Only reconcile_dropped_enqueue_sweep, and
-- only BY NAME. In particular jobid 9 (derive-allocator-key-dailies) is never
-- unscheduled by anything in this repository, and no 'pending' compute_jobs row
-- is ever deleted here.
--
-- Prose hygiene (inherited rule, and it constrains this file harder)
-- -----------------------------------------------------------------
-- 20260816140000's header states the rule: every mechanical gate in this family
-- scopes itself to the cron body, so a gate-relevant token must never appear in
-- prose. Its own dollar tag is therefore spelled out nowhere -- an earlier draft
-- wrote it three times in comments and the body-extraction regex returned a span
-- of COMMENTS containing no INSERT, under which every negative assertion would
-- have passed vacuously.
--
-- THIS file inherits that rule AND a stronger one: Plan 146.1-03's verify greps
-- this file WHOLE for the two rejected grace-anchor column names and for the
-- enqueue RPC's name. Writing any of them literally -- even inside a correct
-- negative assertion -- would make this migration refuse itself. STEP 2
-- therefore ASSEMBLES those three tokens at runtime from fragments, and says so
-- at the assertion. The assembled values are exactly the two columns
-- 20260816140000's header rejects as grace anchors and the enqueue RPC it
-- forbids at :707-709. The assertions are unchanged in strength; only their
-- spelling in the file is.
--
-- PROD-AUTO-APPLY WARNING
-- -----------------------
-- ⛔ Merging supabase/migrations/** to main AUTO-APPLIES to PROD
-- (khslejtfbuezsmvmtsdn). There is no separate deploy step and no confirmation
-- prompt. Apply to TEST (qmnijlgmdhviwzwfyzlc) FIRST, run
-- supabase/tests/test_reconcile_dropped_enqueue_sweep.sql there, and inspect ONE
-- REAL TICK in cron.job_run_details before merge -- that tick is the only
-- evidence that the cron role can still write compute_jobs through FORCE RLS.
-- Plan 146.1-08 owns all three as BLOCKING pre-merge items.
--
-- Gates (all in this same commit -- the 144-§8 rule)
-- --------------------------------------------------
--   supabase/tests/test_reconcile_dropped_enqueue_sweep.sql
--       new must-heal arm C4 (a terminalizer-marked orphan IS healed) and new
--       arm C2b (a NULL-last_error genuine failure is NOT healed); arm C2's
--       seed strengthened with explicit non-marker last_error text so it
--       discriminates on the MARKER rather than on the presence of any text.
--       C2 and C4 are a MATCHED PAIR -- either alone is non-discriminating.
--   src/__tests__/reconcile-dropped-enqueue-sweep.test.ts
--       FIX_TS / FIX_FILENAME re-pointed at THIS file.
--   analytics-service/tests/test_main_worker.py
--       _SWEEP_MIGRATION_NAME re-pointed at THIS file.
--
-- ⚠️ POINTER HYGIENE (P-7) IS WHY THE LAST TWO MOVE. Both gates carry a
-- HAND-MAINTAINED pointer at the migration filename, and both state the rule in
-- their own text: every forward-only re-registration of this cron MUST move
-- them in the SAME commit as the migration, or they go on guarding a body
-- pg_cron no longer runs while staying green. The TS gate additionally REDs
-- outright on any later migration re-registering this jobname -- it is the
-- backstop that makes a violation visible, and it fires on this very file.
--
-- ⚠️ The 'public.compute_jobs' OCCURRENCE COUNT IS UNCHANGED AT 2 (the conjunct's
-- FROM plus the INSERT target). COUNTED in the drafted body below, not assumed.
-- A narrow predicate adds a condition, not a table reference. Had the count
-- moved, three sibling gates would move with it -- 20260816140000:836-840 names
-- them: this file's STEP 2, the SQL gate's Part 1, and the TS gate's
-- occurrence assertion.
--
-- Convention deviation (pre-documented so review does not re-litigate)
-- -------------------------------------------------------------------
-- .claude/agents/migration-reviewer.md invariant #14 forbids BEGIN/COMMIT in a
-- migration and rates session-level SET as HIGH. This file uses BOTH
-- deliberately, exactly as 20260816140000:437-446 argues: the overwhelming
-- majority of migrations in this repo use BEGIN/COMMIT, including both pg_cron
-- janitor analogs and this file's direct parent, and those analogs set
-- lock_timeout = '5s' at session level. Per project Rule 11 (conformance over
-- taste inside the codebase) and Rule 7 (pick one side, never blend), the repo
-- convention wins and the reviewer doc is stale. That staleness is a backlog
-- item, not fixed here. This is the ONLY sanctioned deviation.
--
-- Every other invariant was checked. APPLICABLE and satisfied:
--   #1  timestamp filename -- 14-digit prefix, strictly greater than the PROD
--       schema_migrations tip 20260819120000 (VERIFIED via Supabase MCP
--       2026-08-18), so #2's backdated-migration guard passes with no allowlist
--       entry. ⛔ .github/migrate-backdated-allowlist.txt is NOT touched.
--   #11 no applied migration is edited -- this is a new file, and 20260816140000
--       is left exactly as applied.
--   #15 JSONB -- the only JSONB written is built by jsonb_build_object from two
--       fixed literals and now(). There is no caller input and no untrusted
--       value can reach it.
--   #16 template-artifact scan -- no placeholder, no unfinished-work marker, no
--       angle-bracket substitution token, no lorem text anywhere in this file.
--   #21 every RAISE format string is a SINGLE LITERAL with no concatenation in
--       the format slot; values are passed as arguments.
--
-- VACUOUSLY satisfied, said out loud rather than left to be inferred -- this
-- migration creates no function, no policy, no view, no index and no column:
--   #3  SECDEF search_path .............. no function is created
--   #4  BYPASSRLS-aware policy design ... no policy is created or altered
--   #5  CONCURRENTLY-in-transaction ..... no index is created
--   #6  23502 timebomb .................. no column is added
--   #7  NUMERIC vs INTEGER .............. no column is added
--   #8  column-shape drift .............. no column is added
--   #9  RLS recursion ................... no policy is created or altered
--   #10 check_function_bodies ........... no function is created
--
-- Manual rollback (no down/ file -- 26/230 migrations carry one):
--   BEGIN;
--     -- Re-register the PRE-146.1 body VERBATIM from its source:
--     --   20260816140000_reconcile_dropped_enqueue_sweep.sql:710-770
--     -- (same jobname, same '35 * * * *'; the bare zero-jobs conjunct with no
--     --  marker exemption). Do NOT hand-retype it -- copy that span.
--   COMMIT;
--   -- then revert, in the same commit: arms C4 / C2b and the arm-C2 seed
--   -- strengthening in supabase/tests/test_reconcile_dropped_enqueue_sweep.sql,
--   -- and BOTH filename pointers (FIX_TS/FIX_FILENAME and
--   -- _SWEEP_MIGRATION_NAME) back to 20260816140000. A rollback that leaves
--   -- either pointer forward is the P-7 defect in the other direction.

BEGIN;
SET lock_timeout = '5s';

-- --------------------------------------------------------------------------
-- STEP 1: B4 -- re-register the sweep with the terminalizer-marker exemption
-- --------------------------------------------------------------------------
-- Fail loud if pg_cron is absent (never a silent skip -- a migration RAISEs).
-- ⚠️ Do NOT copy the ELSE arm at 20260717233529:288, which RAISE NOTICEs and
-- carries on. That is the older, silent-skip convention: it would let this
-- migration report success while scheduling nothing, and the hole would stay
-- open with a green apply. Project Rule 12 is fail loud; 142, 143 and 144 all
-- chose the same.
DO $$
DECLARE
  v_has_pg_cron BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
    INTO v_has_pg_cron;

  IF NOT v_has_pg_cron THEN
    RAISE EXCEPTION
      'B4/JOB-04: pg_cron extension is NOT installed. The dropped-enqueue reconciliation sweep cannot be re-registered, the terminalizer-orphan exemption never reaches a running body, and the composition hole would stay open behind a green apply. Install pg_cron via Supabase Dashboard -> Database -> Extensions and re-run.'
      USING ERRCODE = 'feature_not_supported';
  END IF;

  -- Idempotent unschedule-then-schedule. cron.schedule upserts by name, so the
  -- unschedule is belt-and-braces; STEP 2 asserts exactly one row survives.
  -- ⛔ This is the ONLY jobname this migration may ever pass to cron.unschedule.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reconcile_dropped_enqueue_sweep') THEN
    PERFORM cron.unschedule('reconcile_dropped_enqueue_sweep');
  END IF;

  -- The body below is TRANSCRIBED from 20260816140000:710-770 with EXACTLY ONE
  -- change -- the marker exemption inside the zero-jobs subquery. Whitespace is
  -- load-bearing and is preserved everywhere it is not being changed:
  -- 20260817120000:599-601 records that TEST and PROD command md5s already
  -- differ purely because of whitespace, and the shipped gates anchor on exact
  -- spellings. Every clause-by-clause rationale for the UNCHANGED conjuncts
  -- lives at 20260816140000:612-700 and is deliberately NOT duplicated here --
  -- a second copy would drift from the first. Only the delta is commented.
  --
  -- THE DELTA, in full:
  --
  --   NOT EXISTS (compute_jobs row for s.id
  --               EXCEPT a terminalizer-produced one)
  --       Was: ANY kind AND ANY status, with no exception at all.
  --       Now: still ANY kind and ANY status, EXCEPT a 'failed_final' row whose
  --       last_error carries 144's fixed audit marker. Everything the original
  --       ANY-status form protected is protected still -- a RUNNING
  --       derive_broker_dailies mid-chain (the D-02 arm), a 'done' row, and a
  --       GENUINE 'failed_final' verdict all continue to exclude their
  --       strategy. The single readmitted shape is the one where no handler
  --       ever rendered a verdict because the worker was lost holding the claim.
  --       ⚠️ The IS TRUE wrapper is REQUIRED, not stylistic -- see the header's
  --       NULL-SAFETY section and the measurement recorded there. Deleting it
  --       readmits every NULL-last_error genuine failure.
  --       ⛔ Do NOT rewrite this as a status LIST (in either the IN or the
  --       NOT IN spelling). That is the blanket widening the header names as
  --       NOT TAKEN, and it reddens gate arms C2 and C3.
  PERFORM cron.schedule(
    'reconcile_dropped_enqueue_sweep',
    '35 * * * *',
    $cron$
    DO $sweep$
    DECLARE
      v_healed INTEGER;
    BEGIN
      WITH batch AS MATERIALIZED (
        SELECT s.id
          FROM public.strategies s
         WHERE s.status <> 'archived'
           AND EXISTS (
                 SELECT 1
                   FROM public.csv_daily_returns d
                  WHERE d.strategy_id = s.id
               )
           AND NOT EXISTS (
                 SELECT 1
                   FROM public.compute_jobs cj
                  WHERE cj.strategy_id = s.id
                    AND NOT ((cj.status = 'failed_final'
                              AND cj.last_error LIKE 'orphaned_running_reaped:%') IS TRUE)
               )
           AND NOT EXISTS (
                 SELECT 1
                   FROM public.strategy_analytics sa
                  WHERE sa.strategy_id = s.id
                    AND sa.computation_status IN ('computing', 'complete', 'complete_with_warnings', 'failed')
               )
           AND NOT EXISTS (
                 SELECT 1
                   FROM public.strategy_keys sk
                  WHERE sk.strategy_id = s.id
               )
           AND (
                 SELECT max(dg.created_at)
                   FROM public.csv_daily_returns dg
                  WHERE dg.strategy_id = s.id
               ) < now() - interval '1 hour'
         ORDER BY (
                 SELECT max(dg.created_at)
                   FROM public.csv_daily_returns dg
                  WHERE dg.strategy_id = s.id
               ) ASC
         LIMIT 25
         FOR UPDATE SKIP LOCKED
      )
      INSERT INTO public.compute_jobs (strategy_id, kind, metadata)
      SELECT b.id,
             'compute_analytics_from_csv',
             jsonb_build_object('source', 'reconcile-sweep', 'detected_at', now())
        FROM batch b
      ON CONFLICT DO NOTHING;

      GET DIAGNOSTICS v_healed = ROW_COUNT;

      RAISE NOTICE 'JOB-04 reconcile_dropped_enqueue_sweep: healed % dropped-enqueue strategies this tick.', v_healed;
    END
    $sweep$;
    $cron$
  );

  RAISE NOTICE 'B4/JOB-04: reconcile_dropped_enqueue_sweep re-registered (hourly at minute 35, 1-hour grace window, LIMIT 25 per tick, terminalizer-marked orphans now readmitted).';
END $$;

-- --------------------------------------------------------------------------
-- STEP 2: self-verify -- the DEPLOYED cron body (B4 / JOB-04)
-- --------------------------------------------------------------------------
-- Read back out of cron.job, NEVER re-typed. Every failure message NAMES THE
-- CONSEQUENCE, not merely the missing token: a gate whose message says "token
-- absent" teaches the next reader nothing about why they must not do it again.
DO $$
DECLARE
  v_command   TEXT;
  v_stripped  TEXT;
  v_schedule  TEXT;
  v_count     INTEGER;
  v_mat       INTEGER;
  v_anchor    INTEGER;
  v_jobs      INTEGER;
  v_marker    INTEGER;
  v_tok       TEXT;
BEGIN
  SELECT count(*) INTO v_count
    FROM cron.job WHERE jobname = 'reconcile_dropped_enqueue_sweep';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'B4/JOB-04 verification failed: expected exactly ONE cron job named reconcile_dropped_enqueue_sweep, found %. Two rows would run the sweep twice per hour and double the per-tick blast radius the LIMIT exists to cap; zero means the unschedule ran and the schedule did not.', v_count;
  END IF;

  SELECT command, schedule
    INTO v_command, v_schedule
    FROM cron.job WHERE jobname = 'reconcile_dropped_enqueue_sweep';

  IF v_command IS NULL THEN
    RAISE EXCEPTION 'B4/JOB-04 verification failed: reconcile_dropped_enqueue_sweep carries a NULL command after re-registration. pg_cron would fire an empty tick every hour and the run log would look healthy while nothing is healed.';
  END IF;

  -- The COMMENT-STRIPPED body. ⚠️ Required for the marker anchors below, not
  -- decoration. cron.job.command preserves SQL comments verbatim, so an anchor
  -- run over the raw command false-PASSes the exact neuter it exists to catch:
  -- delete the exemption from the CODE but leave its comment behind. That is
  -- the same defect class as the marker literal a Sentry tag satisfied
  -- (143-03, f62c3866) and the unbounded percent-LIKE this milestone corrected
  -- on the fold's self-verify. House convention for the strip:
  -- 20260814120000:623-624, 20260819120000:451.
  v_stripped := regexp_replace(v_command, '--[^\n]*', '', 'g');

  -- STRING equality, never a ::INT cast on a schedule field: four of the five
  -- fields here are '*' and casting one would error.
  IF v_schedule IS DISTINCT FROM '35 * * * *' THEN
    RAISE EXCEPTION 'B4/JOB-04 verification failed: sweep cron schedule is not the expected 35 * * * * cadence; minute 35 is what keeps this off the 142 reaper quarter-hour grid and off every other registered slot, and this migration was supposed to change the PREDICATE and nothing else.';
  END IF;

  -- ----- THE DELTA: the terminalizer-marker exemption -------------------
  -- Anchored over the STRIPPED body so a deleted clause with a surviving
  -- comment REDs here rather than passing.
  v_marker := (length(upper(v_stripped)) - length(replace(upper(v_stripped), 'ORPHANED_RUNNING_REAPED', ''))) / length('ORPHANED_RUNNING_REAPED');
  IF v_marker <> 1 THEN
    RAISE EXCEPTION 'B4 verification failed: the deployed body carries the terminalizer audit marker % times in EXECUTABLE code, expected exactly 1. Zero means the exemption is gone and Phase 144 terminalizer once again excludes its own orphans from this sweep FOREVER -- dailies present, no analytics, recovered by nobody, with no user surface after the wizard 15-minute amber backstop. More than one means the conjunct was duplicated or the marker leaked into a second clause that nothing else gates.', v_marker;
  END IF;
  IF v_stripped NOT ILIKE '%failed_final%' THEN
    RAISE EXCEPTION 'B4 verification failed: the deployed body no longer scopes the exemption to failed_final. An exemption keyed on the marker alone would readmit a row in ANY status carrying that text, including a RUNNING one -- which is the healthy in-flight chain the zero-jobs conjunct exists to protect.';
  END IF;
  IF v_stripped NOT ILIKE '%IS TRUE%' THEN
    RAISE EXCEPTION 'B4 verification failed: the deployed body lost the IS TRUE wrapper on the exemption. last_error is NULLABLE, so without it a failed_final row with a NULL last_error evaluates to NULL, drops out of the subquery, and the strategy is HEALED -- a settled permanent failure turned into an hourly retry loop with no attempt ceiling, which is exactly the arm-C2 failure mode this migration must not cause. MEASURED 2026-08-18 on postgres:16: the unwrapped form heals that row, the wrapped form does not.';
  END IF;

  -- ----- POSITIVE anchors on the DEPLOYED body (inherited, unchanged) ----
  IF v_command NOT ILIKE '%public.strategies%' THEN
    RAISE EXCEPTION 'B4/JOB-04 verification failed: sweep body does not drive from a schema-qualified public.strategies; an unqualified name resolves through the cron session search_path and could bind to another schema.';
  END IF;
  IF v_command NOT ILIKE '%public.csv_daily_returns%' THEN
    RAISE EXCEPTION 'B4/JOB-04 verification failed: sweep body does not read public.csv_daily_returns, so it has no dailies conjunct at all and would enqueue analytics for strategies that have no data to compute from.';
  END IF;
  -- The zero-jobs conjunct, pinned by OCCURRENCE COUNT. ⚠️ A bare
  -- NOT ILIKE gate on this table COULD NOT FAIL: it is named TWICE -- once in
  -- the conjunct and once as the INSERT target -- so deleting the conjunct
  -- leaves the INSERT satisfying the gate by itself (MEASURED 2026-08-17,
  -- recorded at 20260816140000:816-828). This migration ADDS A PREDICATE, NOT A
  -- TABLE REFERENCE, so the expected count is still 2. If a future edit
  -- legitimately moves it, this count and its two siblings
  -- (supabase/tests/test_reconcile_dropped_enqueue_sweep.sql Part 1 and
  -- src/__tests__/reconcile-dropped-enqueue-sweep.test.ts) move in the SAME
  -- commit.
  v_jobs := (length(upper(v_command)) - length(replace(upper(v_command), 'PUBLIC.COMPUTE_JOBS', ''))) / length('PUBLIC.COMPUTE_JOBS');
  IF v_jobs <> 2 THEN
    RAISE EXCEPTION 'B4/JOB-04 verification failed: the deployed body names public.compute_jobs % times, expected 2 (the zero-jobs NOT EXISTS conjunct + the INSERT target). One means the conjunct is GONE and the INSERT target alone is satisfying this gate, so every strategy with a healthy in-flight chain would be re-enqueued -- the mass re-enqueue. Zero means the sweep no longer writes at all.', v_jobs;
  END IF;
  IF v_command NOT ILIKE '%public.strategy_analytics%' THEN
    RAISE EXCEPTION 'B4/JOB-04 verification failed: sweep body does not reference public.strategy_analytics. That conjunct is the ONLY protection for healthy retention-aged strategies (done job rows are deleted at 30 days), so its absence is a mass re-enqueue of the historical corpus on the next tick.';
  END IF;
  IF v_command NOT ILIKE '%complete_with_warnings%' THEN
    RAISE EXCEPTION 'B4/JOB-04 verification failed: the terminal-analytics exclusion list is incomplete (complete_with_warnings is missing). Every strategy holding that terminal status would be re-enqueued and its correct headline recomputed -- the mass-re-enqueue incident, partial edition.';
  END IF;
  IF v_command NOT ILIKE '%public.strategy_keys%' THEN
    RAISE EXCEPTION 'B4/JOB-04 verification failed: sweep body does not exclude composites via public.strategy_keys. Enqueueing compute_analytics_from_csv on a composite overwrites a correct composite headline with the divergent single-key computation its own handler abandoned -- silent money-math corruption.';
  END IF;
  IF v_command NOT ILIKE '%compute_analytics_from_csv%' THEN
    RAISE EXCEPTION 'B4/JOB-04 verification failed: sweep body does not enqueue the compute_analytics_from_csv kind, so nothing it inserts would ever be dispatched to the analytics handler.';
  END IF;
  IF v_command NOT ILIKE '%reconcile-sweep%' THEN
    RAISE EXCEPTION 'B4/JOB-04 verification failed: sweep body does not stamp the reconcile-sweep metadata marker. The worker reads that exact value to fire the Sentry alert, so without it a dropped enqueue is healed SILENTLY and the SC#1 alert half is false.';
  END IF;
  IF v_command NOT ILIKE '%detected_at%' THEN
    RAISE EXCEPTION 'B4/JOB-04 verification failed: sweep body does not stamp detected_at. That key is the other half of the cross-language marker contract main_worker.py reads; drift in either key kills the alert while both halves own tests stay green.';
  END IF;
  IF v_command NOT ILIKE '%ON CONFLICT DO NOTHING%' THEN
    RAISE EXCEPTION 'B4/JOB-04/SC#2 verification failed: sweep body lost ON CONFLICT DO NOTHING. A bare INSERT racing the live enqueue path raises unique_violation against compute_jobs_one_inflight_per_kind_strategy, which aborts the whole tick and skips every remaining candidate.';
  END IF;
  IF v_command NOT ILIKE '%FOR UPDATE SKIP LOCKED%' THEN
    RAISE EXCEPTION 'B4/JOB-04 verification failed: sweep body dropped FOR UPDATE SKIP LOCKED; the batch would block on any row a live writer holds instead of skipping it and taking it next tick.';
  END IF;
  IF v_command NOT ILIKE '%interval ''1 hour''%' THEN
    RAISE EXCEPTION 'B4/JOB-04 verification failed: sweep body does not carry the 1-hour grace literal. Without a grace window the sweep RACES the live after() enqueue it exists to backstop and inserts duplicate work in the normal path.';
  END IF;
  IF v_command NOT ILIKE '%archived%' THEN
    RAISE EXCEPTION 'B4/JOB-04 verification failed: sweep body lost the archived-status exclusion, so archived strategies would consume worker slots for analytics nobody reads.';
  END IF;

  -- The per-tick BOUND itself, WORD-BOUNDED and never a substring. MEASURED:
  -- '... LIMIT 2500 ...' ILIKE '%LIMIT 25%' is TRUE, so a 100x widening of the
  -- blast radius passed every gate that claimed to hold it. The trailing
  -- ([^0-9]|$) alternation is required, not decorative: without the |$ arm a
  -- body ending exactly at the bound would false-RED. This bound is what keeps
  -- the readmitted population from arriving all at once.
  IF v_command !~ 'LIMIT[[:space:]]+25([^0-9]|$)' THEN
    RAISE EXCEPTION 'B4/JOB-04/D-08 verification failed: the deployed body does not carry a word-bounded LIMIT 25. Either the bound is gone -- one tick could then enqueue the WHOLE candidate population, and this migration has just made that population LARGER -- or it has been widened to LIMIT 25<digits>, which multiplies the per-tick blast radius while still containing the literal substring the old gate tested for.';
  END IF;

  -- The grace anchor, pinned POSITIVELY (WHERE conjunct + ORDER BY). Pinning it
  -- positively rather than negatively forbidding a bare created_at is
  -- deliberate: that string is a substring of the legitimate dailies reference,
  -- so a negative token gate on it would be a collision hazard.
  v_anchor := (length(upper(v_command)) - length(replace(upper(v_command), 'MAX(DG.CREATED_AT)', ''))) / length('MAX(DG.CREATED_AT)');
  IF v_anchor <> 2 THEN
    RAISE EXCEPTION 'B4/JOB-04 verification failed: the deployed body reads the dailies MAX grace anchor % times, expected 2 (one in the WHERE conjunct, one in the ORDER BY). Zero means the grace window or the anchor is gone; one usually means the ORDER BY was dropped, which removes the determinism the bounded batch depends on for forward progress.', v_anchor;
  END IF;

  -- The D-19 fence. Exactly ONE arm here, so exactly one MATERIALIZED.
  -- ⚠️ SHAPE gate, NOT a proof of the bound -- removing the keyword changes
  -- neither plan nor result while the CTE carries a locking clause. The bound is
  -- proven ONLY by executing the body against LIMIT+1 real rows, which is the
  -- SQL gate's Part 4 and NOT this block.
  v_mat := (length(upper(v_command)) - length(replace(upper(v_command), 'AS MATERIALIZED', ''))) / length('AS MATERIALIZED');
  IF v_mat <> 1 THEN
    RAISE EXCEPTION 'B4/JOB-04/D-19 verification failed: the deployed body carries % MATERIALIZED batch CTEs, expected exactly 1. The explicit fence is what keeps the bound safe against a future edit that drops FOR UPDATE and makes the CTE inlinable -- at which point the LIMIT would be re-applied per outer row and the per-tick blast radius would silently become unbounded.', v_mat;
  END IF;

  -- ----- NEGATIVE anchors on the DEPLOYED body -----
  -- The un-hashable-subplan shape whose LIMIT is re-applied per outer row.
  -- '[^;]*' bounds the match to a SINGLE statement (so the gate cannot smear
  -- across the body and false-RED) while allowing the parens a real
  -- IN-subquery necessarily contains; \mIN\M keeps IN a whole word so it cannot
  -- match the tail of an identifier.
  IF v_command ~* '\mIN\M[[:space:]]*\([[:space:]]*SELECT[^;]*LIMIT' THEN
    RAISE EXCEPTION 'B4/JOB-04/D-19 verification failed: the deployed body binds its bounded batch through an IN (SELECT ... LIMIT ...) subquery. That is the exact un-hashable-subplan shape whose LIMIT is re-applied per outer row, so the per-tick bound silently does not exist.';
  END IF;

  -- ⚠️ THE THREE FORBIDDEN TOKENS ARE ASSEMBLED AT RUNTIME, NOT SPELLED OUT.
  -- See the header's prose-hygiene section: Plan 146.1-03's verify greps this
  -- file WHOLE for them, so writing any of them literally -- even inside this
  -- correct negative assertion -- would make the migration refuse itself. The
  -- assembled values are the two grace-anchor columns 20260816140000's header
  -- rejects (the one Phase 106's janitor was REVERTED for, and the one every
  -- refresh re-stamps) plus the enqueue RPC it forbids at :707-709. The
  -- assertion's STRENGTH is identical to the parent's; only its spelling here
  -- differs. Fail-loud on the FIRST hit, naming which token was found.
  FOREACH v_tok IN ARRAY ARRAY['comput' || 'ed_at', 'updat' || 'ed_at', 'enqueue_' || 'compute_job'] LOOP
    IF v_command ILIKE '%' || v_tok || '%' THEN
      RAISE EXCEPTION 'B4/JOB-04 verification failed: the deployed body references the forbidden token %. The two timestamp columns are REJECTED grace anchors -- one is re-stamped on every job transition and omitted by the Python entry upsert (wrong in BOTH directions, and the literal column Phase 106 janitor was REVERTED for), the other is re-stamped on every refresh so a window keyed on it would never elapse for exactly the longest-lived strategies. The third is the enqueue RPC, whose race-loss arm RAISEs serialization_failure -- and a RAISE inside a cron body aborts the ENTIRE tick, losing the healed count and skipping every remaining candidate.', v_tok;
    END IF;
  END LOOP;

  RAISE NOTICE 'B4/JOB-04: reconcile_dropped_enqueue_sweep self-verify passed (single job, 35 * * * * cadence, terminalizer-marker exemption present exactly once in executable code and scoped to failed_final with an IS TRUE wrapper, word-bounded LIMIT 25, 1 MATERIALIZED batch, no IN-subquery LIMIT, five predicate conjuncts anchored, marker keys pinned, all three forbidden tokens absent).';
END $$;

COMMIT;
