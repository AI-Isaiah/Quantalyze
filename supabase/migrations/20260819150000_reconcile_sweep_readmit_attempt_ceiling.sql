-- Migration: bound the B4 readmit with an ATTEMPT CEILING (R3, Phase 146.2,
-- v1.19 verification sweep, 2026-08-19)
-- =============================================================================
--
-- Why this migration exists
-- -------------------------
-- 20260819130500 (B4) readmitted terminalizer-produced orphans to the
-- dropped-enqueue reconciliation sweep. It named "an hourly retry loop with no
-- attempt ceiling" THREE TIMES as the failure mode it must not cause -- at its
-- header's NOT-TAKEN section, at its IS TRUE null-safety argument, and in the
-- self-verify message that guards that wrapper -- and it guarded exactly one
-- way in: the NULL-last_error row. It never bounded the loop it deliberately
-- OPENED.
--
-- The open cycle, end to end:
--
--   sweep readmits the strategy  ->  a fresh 'pending' compute_analytics_from_csv
--   row  ->  a worker claims it  ->  the worker is lost (OOM, container kill)
--   ->  the row sits 'running' with no claim progress  ->  144's terminalizer
--   reaps it at 4 h and stamps the fixed audit literal  ->  the strategy's ONLY
--   compute_jobs rows are marked again  ->  the sweep readmits it again.
--
-- Nothing in that cycle counts. A strategy whose input reliably kills its
-- worker -- a pathological CSV, a pathological derive -- rides it forever at
-- one worker slot per ~5 h, and the only visible trace is a growing pile of
-- audit rows nobody reads. R3 asks for the ceiling B4's own comments assume.
--
-- THE ATTEMPT COUNTER ALREADY EXISTS -- ZERO DDL
-- ----------------------------------------------
-- Two shipped facts compose into a counter, so this migration adds no column,
-- no table and no index:
--
--   1. The terminalizer UPDATEs the running row IN PLACE to a persistent
--      'failed_final' marker row (20260817120000:618-622; its own NOTICE at
--      :650 says the rows "survive as failed_final"). The row is not deleted
--      and not reused.
--   2. The sweep INSERTs a BRAND NEW row on each readmission
--      (20260819130500:365-370).
--
-- => every reap-readmit cycle strictly increments the number of marker rows the
-- strategy carries. THE PER-STRATEGY COUNT OF THOSE ROWS IS THE ATTEMPT
-- COUNTER, and it is already gate-pinned on both sides: the terminalizer's own
-- STEP 2 counts the audit literal it stamps (20260817120000:741), so marker
-- drift REDs upstream before it could silently un-key this count.
--
-- ⛔ compute_jobs.attempts / max_attempts / reclaim_count are NOT usable here
-- and must not be substituted. They are PER-JOB worker-retry fields, and the
-- sweep's INSERT names only (strategy_id, kind, metadata) -- so every one of
-- them returns to its column default on each readmission. They count retries
-- WITHIN one job; this ceiling has to count job GENERATIONS across rows.
--
-- THE CEILING VALUE: N = 3, and what 3 actually buys
-- --------------------------------------------------
-- Ratified 2026-08-19 (Phase 146.2 Plan 04 checkpoint, recommended option).
-- Derivation, and the wall-clock is stated as a RANGE because it is a
-- consequence of two schedules rather than a chosen duration:
--
--   * 3 matches the house per-job ceiling. compute_jobs.max_attempts defaults
--     to 3, so "three goes, then it is not a flake" is already this codebase's
--     answer to the same question one layer down. Rule 11: conform.
--   * ONE CYCLE = the terminalizer's 4 h claim window (20260817120000, arm A)
--     PLUS up to 1 h waiting for the next sweep tick (35 * * * *) => ~4-5 h.
--   * The predicate readmits while the count is 0, 1 or 2, so:
--       - a strategy entering with NO job rows at all (the ORIGINAL
--         dropped-enqueue population, count 0) gets at most 3 sweep
--         readmissions => ~12-15 h of cycles before it is set down;
--       - a strategy entering as a TERMINALIZED ORPHAN already carries marker
--         #1 from the death that produced it, so the sweep grants it at most 2
--         further readmissions => ~8-10 h.
--     Both numbers are stated because the second is the smaller one and a
--     header that quoted only the first would overstate the budget.
--
-- The cost of 3 being too LOW is a strategy stranded after a genuine multi-day
-- incident (a wedged gateway, say); it then waits for the retention wall below
-- or for a manual re-enqueue. The cost of 3 being too HIGH is worker slots
-- burned indefinitely on a poisoned input. 3 buys most of a working day of
-- transient-outage tolerance, which is the trade this file takes.
--
-- ⚠️ THE CEILING ONLY STOPS READMISSION. IT NEVER ADDS ONE.
-- --------------------------------------------------------
-- This is the property that keeps arms C2, C2b and C3 of
-- supabase/tests/test_reconcile_dropped_enqueue_sweep.sql green, and it is
-- structural rather than argued: the delta is a conjunct ANDed into an existing
-- WHERE, so the candidate set can only SHRINK. A strategy the pre-ceiling body
-- excluded is excluded still, whatever its marker count.
--
--   * A GENUINE 'failed_final' verdict (arm C2, non-marker last_error) and a
--     NULL-last_error one (arm C2b) are excluded by the UNTOUCHED IS TRUE-
--     wrapped conjunct, exactly as before. This file does not edit that
--     conjunct in any way.
--   * The REFUSED blanket "no NON-TERMINAL row" status-list widening
--     (20260819130500:87-112) stays refused and appears here in NO form,
--     neither the IN nor the NOT IN spelling.
--   * count(*) is never NULL, so the new conjunct carries no three-valued-logic
--     hazard of its own -- a zero-row count is 0 and compares FALSE-or-TRUE,
--     never NULL. That is why it needs no IS TRUE wrapper while the exemption
--     above it does, and the asymmetry is deliberate rather than an oversight.
--
-- ⚠️ KNOWN RESIDUAL, STATED RATHER THAN FIXED: THE 90-DAY WALL
-- ------------------------------------------------------------
-- The bound is N PER RETENTION WINDOW, NOT N FOREVER, and this file does not
-- pretend otherwise. retention_compute_jobs_failed (jobid 8) DELETEs on
-- COALESCE(next_attempt_at, created_at) older than 90 days (20260515210200:
-- 255-259), and the terminalizer deliberately re-stamps next_attempt_at so its
-- marker rows survive the full ninety (20260817120000:244-261 argues exactly
-- this, and its STEP 2 gates the two writes at :728). So each marker row is
-- collected 90 days after its OWN reap: the count is a ROLLING 90-day window,
-- not a hard lifetime total. A strategy that exhausts the ceiling is set down
-- for ~90 days and then gets another N cycles.
--
-- That is a ceiling -- an unbounded hourly loop becomes at most N cycles per
-- quarter -- which is what R3 asks for, so it is filed as an accepted residual
-- and NOT chased with a DDL counter column. If a permanent lifetime bound is
-- ever wanted it needs durable state that outlives retention, which is a
-- schema change and a different decision.
--
-- ⚠️ PRE-EXISTING RESIDUAL THIS DOES NOT CLOSE: the ceiling bounds READMISSION
-- by the sweep. It does not bound a caller who re-enqueues by hand or a future
-- mechanism that writes compute_jobs directly. This conjunct governs one cron
-- body and claims nothing beyond it.
--
-- ⚠️ PREVENTIVE HARDENING, NOT A LIVE BREAK -- AND THE CENSUS IS DATED
-- --------------------------------------------------------------------
-- 20260819130500's header records, MEASURED ON PROD (khslejtfbuezsmvmtsdn) VIA
-- SUPABASE MCP ON 2026-08-18: ZERO compute_jobs rows carry the terminalizer's
-- audit marker, running = 0, pending = 0, and all 122 'failed_final' rows are
-- genuine job failures. If that still holds, the reachable population of THIS
-- file is empty too and no strategy's behaviour changes on apply.
--
-- ⛔ THAT IS A DATED CLAIM AND IT IS ALREADY STALE BY CONSTRUCTION. The
-- orchestrator plan that merges this file RE-COUNTS marked rows on PROD and on
-- TEST immediately before merge. If the count has moved off zero, this
-- paragraph must be corrected here before the merge lands. A census quoted
-- without its date is how a dated claim becomes an assumed fact.
--
-- TRANSCRIPTION DISCIPLINE (inherited, and it is the reason this file is small)
-- ----------------------------------------------------------------------------
-- 20260819130500:290-296 states the rule: the shipped gates anchor on EXACT
-- spellings and TEST/PROD command md5s already differ purely by whitespace, so
-- the body below is transcribed from 20260819130500:317-378 with EXACTLY ONE
-- change and whitespace preserved everywhere it is not being changed. Every
-- clause-by-clause rationale for the UNCHANGED conjuncts lives at
-- 20260816140000:612-700 and the exemption's rationale at 20260819130500:
-- 299-316; neither is duplicated here, because a second copy drifts from the
-- first. Only the delta is commented. ⛔ 20260819130500 itself is NOT edited.
--
-- ⚠️ THE 'public.compute_jobs' OCCURRENCE COUNT MOVES FROM 2 TO 3.
-- ----------------------------------------------------------------
-- COUNTED in the drafted body below, not assumed: the exemption conjunct's
-- FROM, the new ceiling subquery's FROM, and the INSERT target. 20260819130500
-- could honestly say "a narrow predicate adds a condition, not a table
-- reference" because its delta lived INSIDE the existing subquery; this delta
-- is a NEW scalar subquery over the same table, so the count genuinely moves
-- and every sibling that pins it MOVES IN THIS COMMIT.
-- 20260816140000:836-840 names the register:
--   * this file's STEP 2 (re-issued below at 3, with a re-cut message);
--   * supabase/tests/test_reconcile_dropped_enqueue_sweep.sql Part 1;
--   * src/__tests__/reconcile-dropped-enqueue-sweep.test.ts's jobRefs.
-- The audit-marker count in EXECUTABLE code likewise moves from 1 to 2 (the
-- exemption plus the ceiling), and its three siblings move with it. A count
-- left at the old number would RED for the right reason with a message that
-- misdiagnoses it, which is worse than no message.
--
-- ⚠️ Re-registration CHANGES THE JOBID
-- ------------------------------------
-- cron.unschedule + cron.schedule DROPs the old cron.job row and INSERTs a new
-- one, so pg_cron assigns a FRESH jobid (observed on TEST at
-- 20260817120000:420-426: 11 -> 19). The JOBNAME is the stable identifier and
-- is UNCHANGED here, which is why every gate keys on the name. Any operator
-- runbook pinning this sweep's jobid needs re-reading after this applies.
--
-- ⛔ NO OTHER CRON JOB IS TOUCHED. Only reconcile_dropped_enqueue_sweep, and
-- only BY NAME. In particular jobid 9 (derive-allocator-key-dailies) is never
-- unscheduled by anything in this repository, no 'pending' compute_jobs row is
-- ever deleted here, and the process_key_unified_backbone flag row is not read
-- or written.
--
-- Prose hygiene (inherited, and it constrains this file the same way)
-- ------------------------------------------------------------------
-- Every mechanical gate in this family scopes itself to the cron body, so a
-- gate-relevant token must never appear in prose: the body's dollar tag is
-- spelled out NOWHERE in these comments, because the sibling gates extract the
-- body with a non-greedy match on that tag pair and a prose pair would hand
-- them a span of comments containing no INSERT -- under which every negative
-- assertion passes VACUOUSLY. That happened for real once (143-02) and the
-- anti-vacuity assertion that caught it is still in both gates. The two
-- rejected grace-anchor column names and the enqueue RPC's name are likewise
-- never spelled literally; STEP 2 ASSEMBLES them at runtime from fragments and
-- says so at the assertion. Assertion STRENGTH is unchanged; only spelling is.
--
-- PROD-AUTO-APPLY WARNING
-- -----------------------
-- ⛔ Merging supabase/migrations/** to main AUTO-APPLIES to PROD
-- (khslejtfbuezsmvmtsdn). There is no separate deploy step and no confirmation
-- prompt. Apply to TEST (qmnijlgmdhviwzwfyzlc) FIRST, run
-- supabase/tests/test_reconcile_dropped_enqueue_sweep.sql there, and inspect
-- ONE REAL TICK in cron.job_run_details before merge -- that tick is the only
-- evidence that the cron role can still write compute_jobs through FORCE RLS.
-- The phase's migration-gate plan owns all three as BLOCKING pre-merge items,
-- together with a migration-reviewer and an RLS-policy-auditor pass over this
-- file. ⛔ This file is NOT applied by the agent that wrote it.
--
-- Gates (all in this same CHANGE -- the 144-§8 rule)
-- --------------------------------------------------
-- ⚠️ SAID PRECISELY, because "same commit" is the wording the rule is usually
-- quoted in and this change does not literally satisfy it. Every MECHANICAL
-- SIBLING -- the two filename pointers and all four occurrence counts, i.e.
-- exactly the register that goes green-while-guarding-a-superseded-body if it
-- is left behind -- moves in the SAME COMMIT as this file. The two NEW
-- BEHAVIOURAL ARMS land in the immediately following commit on the same branch
-- and in the same PR. That split is safe in the one way the rule cares about:
-- neither commit is a state in which a gate guards a body that is not there.
-- Nothing here may be split across PRs.
--   supabase/tests/test_reconcile_dropped_enqueue_sweep.sql
--       Part 1's two occurrence counts and the word-bounded pins on the ceiling
--       (this commit); new arm C5 (a strategy at the ceiling is NOT readmitted)
--       and its POSITIVE CONTROL C5b (a strategy one below it still IS), plus
--       the whole-block invariant 3 -> 4 (the next commit).
--       ⭐ C5 and C5b are a MATCHED PAIR for the same reason C2 and C4 are:
--       C5 ALONE would pass under a body that readmits NOTHING at all, and C5b
--       ALONE would pass under the pre-ceiling body. Only together do they pin
--       a bound that is present AND not over-tight.
--   src/__tests__/reconcile-dropped-enqueue-sweep.test.ts
--       FIX_TS / FIX_FILENAME re-pointed at THIS file; jobRefs 2 -> 3; the
--       executable marker count 1 -> 2.
--   analytics-service/tests/test_main_worker.py
--       _SWEEP_MIGRATION_NAME re-pointed at THIS file. Its marker CONTRACT is
--       untouched by this migration -- only the pointer moves.
--
-- ⚠️ POINTER HYGIENE (P-7) IS WHY THE LAST TWO MOVE, and both files state the
-- rule in their own text: every forward-only re-registration of this cron MUST
-- move them in the SAME commit as the migration, or they go on guarding a body
-- pg_cron no longer runs while staying green. The TS gate additionally REDs
-- outright on any later migration re-registering this jobname -- it is the
-- backstop that makes a violation visible, and it fires on this very file.
--
-- Convention deviation (pre-documented so review does not re-litigate)
-- -------------------------------------------------------------------
-- .claude/agents/migration-reviewer.md invariant #14 forbids BEGIN/COMMIT in a
-- migration and rates session-level SET as HIGH. This file uses BOTH,
-- deliberately, exactly as 20260816140000:437-446 and 20260819130500:209-217
-- argue: the overwhelming majority of migrations in this repo use BEGIN/COMMIT,
-- including both pg_cron janitor analogs and this file's two ancestors, and
-- those analogs set lock_timeout = '5s' at session level. Per project Rule 11
-- (conformance over taste inside the codebase) and Rule 7 (pick one side, never
-- blend), the repo convention wins and the reviewer doc is stale. That
-- staleness is a backlog item, not fixed here. This is the ONLY sanctioned
-- deviation.
--
-- Every other invariant was checked. APPLICABLE and satisfied:
--   #1  timestamp filename -- 14-digit prefix, strictly greater than every
--       migration currently in supabase/migrations/ (tip 20260819130500), so
--       #2's backdated-migration guard passes with no allowlist entry.
--       ⛔ .github/migrate-backdated-allowlist.txt is NOT touched. The
--       pre-merge gate re-confirms the prefix against the LIVE PROD
--       schema_migrations tip; that check is the merging plan's, not this
--       file's.
--   #11 no applied migration is edited -- this is a new file, and both
--       20260816140000 and 20260819130500 are left exactly as applied.
--   #15 JSONB -- the only JSONB written is built by jsonb_build_object from two
--       fixed literals and now(). There is no caller input and no untrusted
--       value can reach it.
--   #16 template-artifact scan -- no placeholder, no unfinished-work marker and
--       no lorem text anywhere in this file. STATED PRECISELY rather than as a
--       blanket no-angle-brackets claim, because the file does contain one
--       angle-bracket pair: the phrase describing a WIDENED per-tick limit
--       inside a STEP 2 RAISE message, carried verbatim from 20260819130500.
--       That is prose describing a defect, not a substitution token.
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
-- ⚠️ PERFORMANCE NOTE, said plainly. The new scalar subquery runs once per
-- surviving candidate row, over compute_jobs indexed by strategy_id
-- (20260808120000 and the table's own FK index), and only AFTER the three
-- cheaper NOT EXISTS conjuncts have already discarded the corpus. The candidate
-- set is bounded by LIMIT 25 downstream and the sweep runs hourly, so this is
-- not a hot path. No index is added and none is needed.
--
-- Manual rollback (no down/ file -- 26/230 migrations carry one):
--   BEGIN;
--     -- Re-register the PRE-CEILING body VERBATIM from its source:
--     --   20260819130500_reconcile_sweep_readmit_terminalized_orphans.sql:317-378
--     -- (same jobname, same '35 * * * *'; the marker exemption WITHOUT the
--     --  ceiling conjunct). Do NOT hand-retype it -- copy that span.
--   COMMIT;
--   -- then revert, in the same commit: arms C5 / C5b and Part 1's two
--   -- occurrence counts in
--   -- supabase/tests/test_reconcile_dropped_enqueue_sweep.sql, the jobRefs and
--   -- marker counts in src/__tests__/reconcile-dropped-enqueue-sweep.test.ts,
--   -- and BOTH filename pointers (FIX_TS/FIX_FILENAME and
--   -- _SWEEP_MIGRATION_NAME) back to 20260819130500. A rollback that leaves
--   -- either pointer forward is the P-7 defect in the other direction.

BEGIN;
SET lock_timeout = '5s';

-- --------------------------------------------------------------------------
-- STEP 1: R3 -- re-register the sweep with the readmit ATTEMPT CEILING
-- --------------------------------------------------------------------------
-- Fail loud if pg_cron is absent (never a silent skip -- a migration RAISEs).
-- ⚠️ Do NOT copy the ELSE arm at 20260717233529:288, which RAISE NOTICEs and
-- carries on. That is the older, silent-skip convention: it would let this
-- migration report success while scheduling nothing, and the unbounded loop
-- would stay open behind a green apply. Project Rule 12 is fail loud; 142, 143,
-- 144 and 146.1 all chose the same.
DO $$
DECLARE
  v_has_pg_cron BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
    INTO v_has_pg_cron;

  IF NOT v_has_pg_cron THEN
    RAISE EXCEPTION
      'R3/JOB-04: pg_cron extension is NOT installed. The dropped-enqueue reconciliation sweep cannot be re-registered, the readmit attempt ceiling never reaches a running body, and a reaped-orphan retry loop would stay unbounded behind a green apply. Install pg_cron via Supabase Dashboard -> Database -> Extensions and re-run.'
      USING ERRCODE = 'feature_not_supported';
  END IF;

  -- Idempotent unschedule-then-schedule. cron.schedule upserts by name, so the
  -- unschedule is belt-and-braces; STEP 2 asserts exactly one row survives.
  -- ⛔ This is the ONLY jobname this migration may ever pass to cron.unschedule.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reconcile_dropped_enqueue_sweep') THEN
    PERFORM cron.unschedule('reconcile_dropped_enqueue_sweep');
  END IF;

  -- The body below is TRANSCRIBED from 20260819130500:317-378 with EXACTLY ONE
  -- change -- the ceiling conjunct added to the batch CTE's WHERE. Whitespace
  -- is load-bearing and is preserved everywhere it is not being changed (see
  -- the header's transcription-discipline section). Only the delta is
  -- commented; the unchanged clauses' rationale lives in the two ancestors and
  -- is deliberately NOT duplicated here.
  --
  -- THE DELTA, in full:
  --
  --   AND (SELECT count(*) FROM public.compute_jobs cjc
  --         WHERE cjc.strategy_id = s.id
  --           AND cjc.status = 'failed_final'
  --           AND cjc.last_error LIKE 'orphaned_running_reaped:%') < 3
  --       Was: absent -- the readmit had no bound of any kind.
  --       Now: a strategy carrying 3 or more terminalizer-produced marker rows
  --       is no longer readmitted. Each reap-readmit cycle adds exactly one
  --       such row (144 terminalizes IN PLACE, this sweep INSERTs anew), so the
  --       count IS the cycle counter and no column was added to hold it.
  --       ⚠️ This conjunct can only SHRINK the candidate set. It never admits a
  --       strategy the exemption above it excluded, which is what keeps arms
  --       C2 / C2b / C3 green -- see the header.
  --       ⚠️ count(*) is never NULL, so unlike the exemption directly above it
  --       this conjunct needs no IS TRUE wrapper. That asymmetry is deliberate.
  --       ⛔ Do NOT relax '< 3' to '<= 3' or widen the literal. Both are gated
  --       word-bounded in STEP 2 and in the .sql gate's Part 1, and the
  --       behavioural pair C5 / C5b reddens on either.
  --       ⛔ Do NOT rewrite the exemption above as a status LIST (in either the
  --       IN or the NOT IN spelling). That is the blanket widening 146.1 names
  --       as NOT TAKEN, and it reddens gate arms C2 and C3.
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
           AND (
                 SELECT count(*)
                   FROM public.compute_jobs cjc
                  WHERE cjc.strategy_id = s.id
                    AND cjc.status = 'failed_final'
                    AND cjc.last_error LIKE 'orphaned_running_reaped:%'
               ) < 3
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

  RAISE NOTICE 'R3/JOB-04: reconcile_dropped_enqueue_sweep re-registered (hourly at minute 35, 1-hour grace window, LIMIT 25 per tick, terminalizer-marked orphans readmitted at most 3 times per 90-day retention window).';
END $$;

-- --------------------------------------------------------------------------
-- STEP 2: self-verify -- the DEPLOYED cron body (R3 / JOB-04)
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
    RAISE EXCEPTION 'R3/JOB-04 verification failed: expected exactly ONE cron job named reconcile_dropped_enqueue_sweep, found %. Two rows would run the sweep twice per hour and double the per-tick blast radius the LIMIT exists to cap; zero means the unschedule ran and the schedule did not.', v_count;
  END IF;

  SELECT command, schedule
    INTO v_command, v_schedule
    FROM cron.job WHERE jobname = 'reconcile_dropped_enqueue_sweep';

  IF v_command IS NULL THEN
    RAISE EXCEPTION 'R3/JOB-04 verification failed: reconcile_dropped_enqueue_sweep carries a NULL command after re-registration. pg_cron would fire an empty tick every hour and the run log would look healthy while nothing is healed.';
  END IF;

  -- The COMMENT-STRIPPED body. ⚠️ Required for the marker and ceiling anchors
  -- below, not decoration. cron.job.command preserves SQL comments verbatim, so
  -- an anchor run over the raw command false-PASSes the exact neuter it exists
  -- to catch: delete the clause from the CODE but leave its comment behind.
  -- That is the same defect class as the marker literal a Sentry tag satisfied
  -- (143-03, f62c3866) and the unbounded percent-LIKE this milestone corrected
  -- on the fold's self-verify. House convention for the strip:
  -- 20260814120000:623-624, 20260819120000:451, 20260819130500:423.
  v_stripped := regexp_replace(v_command, '--[^\n]*', '', 'g');

  -- STRING equality, never a ::INT cast on a schedule field: four of the five
  -- fields here are '*' and casting one would error.
  IF v_schedule IS DISTINCT FROM '35 * * * *' THEN
    RAISE EXCEPTION 'R3/JOB-04 verification failed: sweep cron schedule is not the expected 35 * * * * cadence; minute 35 is what keeps this off the 142 reaper quarter-hour grid and off every other registered slot, and this migration was supposed to change the PREDICATE and nothing else.';
  END IF;

  -- ----- THE DELTA: the readmit ATTEMPT CEILING -------------------------
  -- Anchored over the STRIPPED body so a deleted clause with a surviving
  -- comment REDs here rather than passing.
  --
  -- (a) THE LITERAL, WORD-BOUNDED and never a substring. The house lesson is
  -- recorded one clause down: '... LIMIT 2500 ...' ILIKE '...LIMIT 25...' is
  -- TRUE, so a 100x widening of the blast radius once passed every gate that
  -- claimed to hold it. The same trap applies here -- a ceiling widened to 30
  -- or 300 contains the digit 3 as a prefix. The \m and \M word bounds are what
  -- make that widening RED. They also reject '<= 3', which would silently buy a
  -- fourth cycle; the exact spelling '< 3' is the ratified one.
  IF v_stripped !~ '<[[:space:]]*\m3\M' THEN
    RAISE EXCEPTION 'R3 verification failed: the deployed body does not carry a word-bounded readmit ceiling of < 3. Either the bound is gone -- and a strategy whose input reliably kills its worker rides the reap-readmit cycle FOREVER at one worker slot every ~5 hours, which is the unbounded hourly retry loop this whole family of gates keeps naming -- or it has been widened to a value that merely STARTS with 3, or relaxed to <= 3, each of which buys cycles nobody ratified while still containing the literal a substring gate would have accepted.';
  END IF;

  -- (b) THE SHAPE, in ORDER: the ceiling must COUNT THE MARKER ROWS and compare
  -- THAT count. Checking the literal alone would pass a body that counts the
  -- wrong thing (all compute_jobs rows, say, which would exclude every healthy
  -- strategy with three historical jobs) or that carries a stray 3 elsewhere.
  -- '[^;]*' bounds the match to the single statement the batch CTE and its
  -- INSERT form, so the gate cannot smear across the body and false-RED.
  IF v_stripped !~* 'count\(\*\)[^;]*orphaned_running_reaped[^;]*<[[:space:]]*\m3\M' THEN
    RAISE EXCEPTION 'R3 verification failed: the deployed body does not compare a COUNT OF TERMINALIZER-MARKED ROWS against the ceiling. The bound is only meaningful if it counts the attempt signal itself -- the per-strategy marker rows, which are the ONLY thing that strictly increments once per reap-readmit cycle. Counting all compute_jobs rows instead would exclude healthy strategies that merely have history; counting nothing and comparing a constant would be a bound that cannot bind.';
  END IF;

  -- (c) THE MARKER, by OCCURRENCE COUNT. It moved from 1 to 2 in this
  -- migration: the inherited exemption plus this ceiling. Both are keyed on
  -- 144's fixed audit literal, whose own 2-occurrence count is gated at
  -- 20260817120000:741 -- so marker drift REDs upstream, in 144's self-verify,
  -- before it could silently un-key either clause here.
  v_marker := (length(upper(v_stripped)) - length(replace(upper(v_stripped), 'ORPHANED_RUNNING_REAPED', ''))) / length('ORPHANED_RUNNING_REAPED');
  IF v_marker <> 2 THEN
    RAISE EXCEPTION 'R3 verification failed: the deployed body carries the terminalizer audit marker % times in EXECUTABLE code, expected exactly 2 (the readmit exemption + this ceiling). One means one of the pair is gone: without the exemption, 144 terminalizer once again excludes its own orphans from this sweep FOREVER; without the ceiling, those readmissions are unbounded. Zero means both are gone. More than two means a clause was duplicated or the marker leaked into a third clause that nothing else gates.', v_marker;
  END IF;

  -- ----- THE INHERITED B4 EXEMPTION, still pinned exactly as shipped -----
  -- ⚠️ This migration does NOT edit the exemption. These two checks are carried
  -- forward verbatim from 20260819130500:438-443 rather than dropped, because
  -- STEP 2 asserts what is DEPLOYED and the deployed body contains both
  -- clauses -- a self-verify that only checked its own delta would go green
  -- over a body that had lost the clause it was built on top of.
  IF v_stripped NOT ILIKE '%failed_final%' THEN
    RAISE EXCEPTION 'R3/B4 verification failed: the deployed body no longer scopes the exemption to failed_final. An exemption keyed on the marker alone would readmit a row in ANY status carrying that text, including a RUNNING one -- which is the healthy in-flight chain the zero-jobs conjunct exists to protect. The ceiling would then be counting a different population than the exemption admits.';
  END IF;
  IF v_stripped NOT ILIKE '%IS TRUE%' THEN
    RAISE EXCEPTION 'R3/B4 verification failed: the deployed body lost the IS TRUE wrapper on the exemption. last_error is NULLABLE, so without it a failed_final row with a NULL last_error evaluates to NULL, drops out of the subquery, and the strategy is HEALED -- a settled permanent failure turned into a retry loop that THIS migration ceiling would not even bound, because such a row carries no marker to count. MEASURED 2026-08-18 on postgres:16: the unwrapped form heals that row, the wrapped form does not.';
  END IF;

  -- ----- POSITIVE anchors on the DEPLOYED body (inherited, unchanged) ----
  IF v_command NOT ILIKE '%public.strategies%' THEN
    RAISE EXCEPTION 'R3/JOB-04 verification failed: sweep body does not drive from a schema-qualified public.strategies; an unqualified name resolves through the cron session search_path and could bind to another schema.';
  END IF;
  IF v_command NOT ILIKE '%public.csv_daily_returns%' THEN
    RAISE EXCEPTION 'R3/JOB-04 verification failed: sweep body does not read public.csv_daily_returns, so it has no dailies conjunct at all and would enqueue analytics for strategies that have no data to compute from.';
  END IF;
  -- The compute_jobs references, pinned by OCCURRENCE COUNT. ⚠️ A bare
  -- NOT ILIKE gate on this table COULD NOT FAIL: the INSERT target alone would
  -- satisfy it, so deleting every predicate that reads the table would pass
  -- (MEASURED 2026-08-17, recorded at 20260816140000:816-828). ⚠️ THE EXPECTED
  -- COUNT MOVED FROM 2 TO 3 IN THIS MIGRATION -- the exemption conjunct's FROM,
  -- the ceiling subquery's FROM, and the INSERT target -- and its two siblings
  -- (supabase/tests/test_reconcile_dropped_enqueue_sweep.sql Part 1 and
  -- src/__tests__/reconcile-dropped-enqueue-sweep.test.ts) moved in the SAME
  -- commit. COUNTED in the drafted body, not assumed.
  v_jobs := (length(upper(v_command)) - length(replace(upper(v_command), 'PUBLIC.COMPUTE_JOBS', ''))) / length('PUBLIC.COMPUTE_JOBS');
  IF v_jobs <> 3 THEN
    RAISE EXCEPTION 'R3/JOB-04 verification failed: the deployed body names public.compute_jobs % times, expected 3 (the zero-jobs NOT EXISTS conjunct + the ceiling subquery + the INSERT target). Two means one of the two predicates is GONE: without the zero-jobs conjunct every strategy with a healthy in-flight chain is re-enqueued -- the mass re-enqueue -- and without the ceiling subquery the reaped-orphan readmission is unbounded again. One means only the INSERT target is left and it is satisfying this gate by itself. Zero means the sweep no longer writes at all.', v_jobs;
  END IF;
  IF v_command NOT ILIKE '%public.strategy_analytics%' THEN
    RAISE EXCEPTION 'R3/JOB-04 verification failed: sweep body does not reference public.strategy_analytics. That conjunct is the ONLY protection for healthy retention-aged strategies (done job rows are deleted at 30 days), so its absence is a mass re-enqueue of the historical corpus on the next tick.';
  END IF;
  IF v_command NOT ILIKE '%complete_with_warnings%' THEN
    RAISE EXCEPTION 'R3/JOB-04 verification failed: the terminal-analytics exclusion list is incomplete (complete_with_warnings is missing). Every strategy holding that terminal status would be re-enqueued and its correct headline recomputed -- the mass-re-enqueue incident, partial edition.';
  END IF;
  IF v_command NOT ILIKE '%public.strategy_keys%' THEN
    RAISE EXCEPTION 'R3/JOB-04 verification failed: sweep body does not exclude composites via public.strategy_keys. Enqueueing compute_analytics_from_csv on a composite overwrites a correct composite headline with the divergent single-key computation its own handler abandoned -- silent money-math corruption.';
  END IF;
  IF v_command NOT ILIKE '%compute_analytics_from_csv%' THEN
    RAISE EXCEPTION 'R3/JOB-04 verification failed: sweep body does not enqueue the compute_analytics_from_csv kind, so nothing it inserts would ever be dispatched to the analytics handler.';
  END IF;
  IF v_command NOT ILIKE '%reconcile-sweep%' THEN
    RAISE EXCEPTION 'R3/JOB-04 verification failed: sweep body does not stamp the reconcile-sweep metadata marker. The worker reads that exact value to fire the Sentry alert, so without it a dropped enqueue is healed SILENTLY and the SC#1 alert half is false.';
  END IF;
  IF v_command NOT ILIKE '%detected_at%' THEN
    RAISE EXCEPTION 'R3/JOB-04 verification failed: sweep body does not stamp detected_at. That key is the other half of the cross-language marker contract main_worker.py reads; drift in either key kills the alert while both halves own tests stay green.';
  END IF;
  IF v_command NOT ILIKE '%ON CONFLICT DO NOTHING%' THEN
    RAISE EXCEPTION 'R3/JOB-04/SC#2 verification failed: sweep body lost ON CONFLICT DO NOTHING. A bare INSERT racing the live enqueue path raises unique_violation against compute_jobs_one_inflight_per_kind_strategy, which aborts the whole tick and skips every remaining candidate.';
  END IF;
  IF v_command NOT ILIKE '%FOR UPDATE SKIP LOCKED%' THEN
    RAISE EXCEPTION 'R3/JOB-04 verification failed: sweep body dropped FOR UPDATE SKIP LOCKED; the batch would block on any row a live writer holds instead of skipping it and taking it next tick.';
  END IF;
  IF v_command NOT ILIKE '%interval ''1 hour''%' THEN
    RAISE EXCEPTION 'R3/JOB-04 verification failed: sweep body does not carry the 1-hour grace literal. Without a grace window the sweep RACES the live after() enqueue it exists to backstop and inserts duplicate work in the normal path.';
  END IF;
  IF v_command NOT ILIKE '%archived%' THEN
    RAISE EXCEPTION 'R3/JOB-04 verification failed: sweep body lost the archived-status exclusion, so archived strategies would consume worker slots for analytics nobody reads.';
  END IF;

  -- The per-tick BOUND itself, WORD-BOUNDED and never a substring. MEASURED:
  -- '... LIMIT 2500 ...' ILIKE '...LIMIT 25...' is TRUE, so a 100x widening of
  -- the blast radius passed every gate that claimed to hold it. The trailing
  -- ([^0-9]|$) alternation is required, not decorative: without the |$ arm a
  -- body ending exactly at the bound would false-RED. This bound and the
  -- readmit ceiling are DIFFERENT bounds and neither substitutes for the other:
  -- LIMIT 25 caps how many strategies one tick may touch, the ceiling caps how
  -- many times ONE strategy may be touched across ticks.
  IF v_command !~ 'LIMIT[[:space:]]+25([^0-9]|$)' THEN
    RAISE EXCEPTION 'R3/JOB-04/D-08 verification failed: the deployed body does not carry a word-bounded LIMIT 25. Either the bound is gone -- one tick could then enqueue the WHOLE candidate population -- or it has been widened to LIMIT 25<digits>, which multiplies the per-tick blast radius while still containing the literal substring the old gate tested for.';
  END IF;

  -- The grace anchor, pinned POSITIVELY (WHERE conjunct + ORDER BY). Pinning it
  -- positively rather than negatively forbidding a bare created_at is
  -- deliberate: that string is a substring of the legitimate dailies reference,
  -- so a negative token gate on it would be a collision hazard.
  v_anchor := (length(upper(v_command)) - length(replace(upper(v_command), 'MAX(DG.CREATED_AT)', ''))) / length('MAX(DG.CREATED_AT)');
  IF v_anchor <> 2 THEN
    RAISE EXCEPTION 'R3/JOB-04 verification failed: the deployed body reads the dailies MAX grace anchor % times, expected 2 (one in the WHERE conjunct, one in the ORDER BY). Zero means the grace window or the anchor is gone; one usually means the ORDER BY was dropped, which removes the determinism the bounded batch depends on for forward progress.', v_anchor;
  END IF;

  -- The D-19 fence. Exactly ONE arm here, so exactly one MATERIALIZED.
  -- ⚠️ SHAPE gate, NOT a proof of the bound -- removing the keyword changes
  -- neither plan nor result while the CTE carries a locking clause. The bound is
  -- proven ONLY by executing the body against LIMIT+1 real rows, which is the
  -- SQL gate's Part 4 and NOT this block.
  v_mat := (length(upper(v_command)) - length(replace(upper(v_command), 'AS MATERIALIZED', ''))) / length('AS MATERIALIZED');
  IF v_mat <> 1 THEN
    RAISE EXCEPTION 'R3/JOB-04/D-19 verification failed: the deployed body carries % MATERIALIZED batch CTEs, expected exactly 1. The explicit fence is what keeps the bound safe against a future edit that drops FOR UPDATE and makes the CTE inlinable -- at which point the LIMIT would be re-applied per outer row and the per-tick blast radius would silently become unbounded.', v_mat;
  END IF;

  -- ----- NEGATIVE anchors on the DEPLOYED body -----
  -- The un-hashable-subplan shape whose LIMIT is re-applied per outer row.
  -- '[^;]*' bounds the match to a SINGLE statement (so the gate cannot smear
  -- across the body and false-RED) while allowing the parens a real
  -- IN-subquery necessarily contains; \mIN\M keeps IN a whole word so it cannot
  -- match the tail of an identifier.
  IF v_command ~* '\mIN\M[[:space:]]*\([[:space:]]*SELECT[^;]*LIMIT' THEN
    RAISE EXCEPTION 'R3/JOB-04/D-19 verification failed: the deployed body binds its bounded batch through an IN (SELECT ... LIMIT ...) subquery. That is the exact un-hashable-subplan shape whose LIMIT is re-applied per outer row, so the per-tick bound silently does not exist.';
  END IF;

  -- ⚠️ THE THREE FORBIDDEN TOKENS ARE ASSEMBLED AT RUNTIME, NOT SPELLED OUT.
  -- See the header's prose-hygiene section: the sibling gates grep this family
  -- of files for them, so writing any of them literally -- even inside this
  -- correct negative assertion -- would make the migration refuse itself. The
  -- assembled values are the two grace-anchor columns 20260816140000's header
  -- rejects (the one Phase 106's janitor was REVERTED for, and the one every
  -- refresh re-stamps) plus the enqueue RPC it forbids at :707-709. The
  -- assertion's STRENGTH is identical to the ancestors'; only its spelling in
  -- this file differs. Fail-loud on the FIRST hit, naming which token was found.
  FOREACH v_tok IN ARRAY ARRAY['comput' || 'ed_at', 'updat' || 'ed_at', 'enqueue_' || 'compute_job'] LOOP
    IF v_command ILIKE '%' || v_tok || '%' THEN
      RAISE EXCEPTION 'R3/JOB-04 verification failed: the deployed body references the forbidden token %. The two timestamp columns are REJECTED grace anchors -- one is re-stamped on every job transition and omitted by the Python entry upsert (wrong in BOTH directions, and the literal column Phase 106 janitor was REVERTED for), the other is re-stamped on every refresh so a window keyed on it would never elapse for exactly the longest-lived strategies. The third is the enqueue RPC, whose race-loss arm RAISEs serialization_failure -- and a RAISE inside a cron body aborts the ENTIRE tick, losing the healed count and skipping every remaining candidate.', v_tok;
    END IF;
  END LOOP;

  RAISE NOTICE 'R3/JOB-04: reconcile_dropped_enqueue_sweep self-verify passed (single job, 35 * * * * cadence, readmit ceiling word-bounded at 3 and comparing a COUNT of terminalizer-marked rows, audit marker present exactly twice in executable code, exemption still scoped to failed_final with its IS TRUE wrapper, 3 public.compute_jobs references, word-bounded LIMIT 25, 1 MATERIALIZED batch, no IN-subquery LIMIT, five predicate conjuncts anchored, marker keys pinned, all three forbidden tokens absent).';
END $$;

COMMIT;
