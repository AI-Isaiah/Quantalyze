-- Migration: restore the LIMIT-25 bound on BOTH arms of the strategy_analytics
-- reaper by forcing single evaluation of the bounded batch. Phase 142.1 D-19,
-- v1.16, 2026-08-03.
-- =============================================================================
--
-- FORWARD-ONLY DELTA on the cron body registered by
-- supabase/migrations/20260802120000_strategy_analytics_stuck_computing_reaper.sql
-- and re-registered by 20260803120000_..._null_stamp_clock_start.sql.
-- Do NOT edit either of those files -- both are already applied.
--
-- WHAT THIS FIXES (D-19) -- discovered by the FIRST end-to-end run of
-- supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql against the
-- TEST project (phase 142.1 plan 07 / D-16). Part 3 arm E went RED.
--
-- THE DEFECT
-- ----------
-- Both arms were written as:
--
--     UPDATE ... WHERE strategy_id IN (
--       SELECT ... ORDER BY ... LIMIT 25 FOR UPDATE SKIP LOCKED )
--
-- `FOR UPDATE` makes the subplan un-hashable, so the planner attaches it as the
-- INNER side of a nested-loop semi-join and RE-EXECUTES it once per outer row.
-- Each re-execution applies its own fresh LIMIT, so the cap is per-rescan, never
-- global. Observed on TEST (Postgres 17.6): 26 seeded stranded rows, zero
-- foreign competitors, ONE tick -> 26 of 26 terminalized. Expected 25.
--
--     Update on strategy_analytics sa
--       ->  Nested Loop Semi Join
--             ->  Index Scan on strategy_analytics sa        (outer)
--             ->  Subquery Scan on "ANY_subquery"            (re-executed)
--                   ->  Limit
--                         ->  LockRows
--
-- Every gate in phases 142 and 142.1 passed over this, because each one greps
-- for the PRESENCE of `LIMIT` / `SKIP LOCKED` in the deployed body -- and the
-- tokens are there. Only executing the body against real rows falsifies it.
--
-- WHY IT MATTERS
-- --------------
-- The bound is a blast-radius control, not a performance tweak. The gate states
-- the harm directly (20260802120000, Part 1 anchor): "an unbounded reaping
-- UPDATE can hold locks across the table during a backlog." Unbounded, a single
-- */15 tick against a backlog of N stranded rows terminalizes ALL of them in one
-- statement and holds row locks on all N for its duration -- on a table every
-- live analytics write touches. The rows it terminalizes are genuinely stranded
-- (>16h, no active job), so this is a lock-duration and blast-radius defect
-- rather than data corruption -- but the advertised bound simply did not exist.
--
-- THE FIX
-- -------
-- `WITH batch AS MATERIALIZED (...)`. An explicitly MATERIALIZED CTE is an
-- optimization fence: Postgres evaluates it EXACTLY ONCE and the UPDATE joins
-- against the stored result.
--
--     Update on strategy_analytics sa
--       CTE batch
--         ->  Limit
--               ->  LockRows
--       ->  Nested Loop
--             ->  CTE Scan on batch
--
-- Verified on TEST before this migration was written: same 26-row seed, one tick
-- -> failed=25, still_computing=1, and the youngest (26th) seed survives.
--
-- ⚠️ MATERIALIZED is REQUIRED and must not be "simplified" away. Since Postgres
-- 12 a bare `WITH` is inlined when referenced once, which reintroduces exactly
-- the re-execution this migration removes. The keyword IS the fix.
--
-- ⚠️ Do NOT rewrite either arm back to `WHERE ... IN (SELECT ... LIMIT n)`, and
-- do not "optimize" the CTE into a FROM-clause subquery: the FROM form was also
-- measured on TEST and reaps 26 of 26 as well, because the planner is equally
-- free to make it the inner side of a nested loop.
--
-- BOTH ARMS carry the defect and both are fixed here. The clock-start arm's
-- harm is milder (it stamps rather than terminalizes) but its bound is stated in
-- the same terms and its budget argument is what the SQL gate's Part 2 arm D
-- determinism note depends on.
--
-- PRESERVED BYTE-FOR-BYTE from the superseded body: both arms' predicates, the
-- four-column SET, ORDER BY / LIMIT 25 / FOR UPDATE SKIP LOCKED, the statement
-- ORDER (clock-start FIRST so a row stamped this tick cannot be reaped by the
-- same tick), the '*/15 * * * *' cadence and the jobname. The ONLY change is the
-- batch-evaluation shape. In particular the single `interval '16 hours'` literal
-- is unchanged and no second interval literal is introduced -- the drift gate
-- (test_main_worker.py::TestReaperThresholdDriftGate) asserts the SET of
-- interval literals in this body equals exactly the canonical Python threshold.
--
-- No explicit BEGIN/COMMIT -- Supabase wraps each migration in one implicit
-- transaction (migration-reviewer invariant #14).

DO $$
DECLARE
  v_has_pg_cron BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
    INTO v_has_pg_cron;

  IF NOT v_has_pg_cron THEN
    RAISE EXCEPTION
      'D-19: pg_cron extension is NOT installed. The strategy_analytics reaper cannot be re-registered with its bounded batch. Install pg_cron via Supabase Dashboard -> Database -> Extensions and re-run.'
      USING ERRCODE = 'feature_not_supported';
  END IF;

  -- SAME jobname: cron.schedule upserts by name, so this REPLACES the unbounded
  -- body rather than adding a second job. STEP 2 asserts exactly one row.
  PERFORM cron.schedule(
    'reap_strategy_analytics_stuck_computing',
    '*/15 * * * *',
    $cron$
    WITH batch AS MATERIALIZED (
      SELECT s.strategy_id
        FROM public.strategy_analytics s
       WHERE s.computation_status = 'computing'
         AND s.computing_started_at IS NULL
         AND NOT EXISTS (
               SELECT 1
                 FROM public.compute_jobs cj
                WHERE cj.strategy_id = s.strategy_id
                  AND cj.status IN ('pending', 'running', 'done_pending_children', 'failed_retry')
             )
       LIMIT 25
       FOR UPDATE SKIP LOCKED
    )
    UPDATE public.strategy_analytics sa
       SET computing_started_at = now()
      FROM batch
     WHERE sa.strategy_id = batch.strategy_id
       AND sa.computation_status = 'computing'
       AND sa.computing_started_at IS NULL;

    WITH batch AS MATERIALIZED (
      SELECT s.strategy_id
        FROM public.strategy_analytics s
       WHERE s.computation_status = 'computing'
         AND s.computing_started_at IS NOT NULL
         AND s.computing_started_at < now() - interval '16 hours'
         AND NOT EXISTS (
               SELECT 1
                 FROM public.compute_jobs cj
                WHERE cj.strategy_id = s.strategy_id
                  AND cj.status IN ('pending', 'running', 'done_pending_children', 'failed_retry')
             )
       ORDER BY s.computing_started_at ASC
       LIMIT 25
       FOR UPDATE SKIP LOCKED
    )
    UPDATE public.strategy_analytics sa
       SET computation_status   = 'failed',
           computation_warned   = FALSE,
           computation_error    = 'Analytics was interrupted before it could finish and did not recover. Retry the sync.',
           computing_started_at = NULL
      FROM batch
     WHERE sa.strategy_id = batch.strategy_id
       AND sa.computation_status = 'computing';
    $cron$
  );

  RAISE NOTICE 'D-19: reap_strategy_analytics_stuck_computing re-registered with MATERIALIZED batch CTEs on both arms (bound restored).';
END $$;

-- --------------------------------------------------------------------------
-- STEP 2: self-verify -- the DEPLOYED body is single-job, bounded, and still
-- carries everything the prior two migrations' gates assert on.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_command TEXT;
  v_count   INTEGER;
  v_mat     INTEGER;
BEGIN
  SELECT count(*) INTO v_count
    FROM cron.job WHERE jobname = 'reap_strategy_analytics_stuck_computing';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'D-19 verification failed: expected exactly ONE cron job named reap_strategy_analytics_stuck_computing, found %.', v_count;
  END IF;

  SELECT command INTO v_command
    FROM cron.job WHERE jobname = 'reap_strategy_analytics_stuck_computing';

  -- The fix itself: BOTH arms must carry the optimization fence.
  v_mat := (length(v_command) - length(replace(upper(v_command), 'AS MATERIALIZED', ''))) / length('AS MATERIALIZED');
  IF v_mat <> 2 THEN
    RAISE EXCEPTION 'D-19 verification failed: the deployed body carries % MATERIALIZED batch CTEs, expected 2 (one per arm). Without the fence the LIMIT is re-applied per outer row and the bound does not exist -- see this migration header for the measured 26-of-26 result.', v_mat;
  END IF;

  -- Regression: an IN-subquery LIMIT anywhere means an arm was reverted.
  IF v_command ~* 'IN\s*\(\s*SELECT[^)]*LIMIT' THEN
    RAISE EXCEPTION 'D-19 verification failed: the deployed body still binds a bounded batch through an IN (SELECT ... LIMIT ...) subquery. That is the exact un-hashable-subplan shape this migration removes.';
  END IF;

  -- Everything the 20260802120000 / 20260803120000 gates already assert.
  IF v_command NOT ILIKE '%computing_started_at IS NULL%' THEN
    RAISE EXCEPTION 'D-19 verification failed: the clock-start arm was lost in the rewrite.';
  END IF;
  IF v_command NOT ILIKE '%interval ''16 hours''%' THEN
    RAISE EXCEPTION 'D-19/JOB-03 verification failed: the 16-hour threshold was lost in the rewrite.';
  END IF;
  IF v_command NOT ILIKE '%computation_warned%' THEN
    RAISE EXCEPTION 'D-19/SI-02 verification failed: the reap arm no longer clears computation_warned, so the status bridge would launder the reap into complete_with_warnings.';
  END IF;
  IF v_command NOT ILIKE '%done_pending_children%' THEN
    RAISE EXCEPTION 'D-19 verification failed: the active-job safety conjunct lost part of the non-terminal status list.';
  END IF;
  IF v_command NOT ILIKE '%FOR UPDATE SKIP LOCKED%' THEN
    RAISE EXCEPTION 'D-19 verification failed: the rewrite dropped FOR UPDATE SKIP LOCKED.';
  END IF;
  IF v_command ILIKE '%computed_at%' THEN
    RAISE EXCEPTION 'D-19 verification failed: the deployed body references computed_at (the Phase 106 janitor bug).';
  END IF;

  RAISE NOTICE 'D-19: deployed cron body verified (single job, 2 MATERIALIZED batches, no IN-subquery LIMIT, all prior anchors intact).';
END $$;
