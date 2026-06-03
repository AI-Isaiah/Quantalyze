-- Test: claim_compute_jobs_with_priority partition-dedupe contract
-- (M-1124).
--
--   M-1124 — when two ready failed_retry rows share the same dedupe
--     partition key (kind, strategy_id), a single claim batch must
--     deduplicate them to exactly ONE survivor before the batch UPDATE
--     flips failed_retry -> running. Without the dedupe both rows would be
--     flipped to 'running' in one UPDATE and the partial unique index
--     `compute_jobs_one_inflight_per_kind_strategy` (mig 032) would raise
--     23505 (unique_violation), aborting the claim. The dedupe lives in the
--     RPC's `ranked`/`deduped` CTEs via the per-partition `rn_s = 1` filter
--     (latest body: migration 20260603120000_compute_jobs_rpc_clear_error_and_gin_fanin.sql).
--
-- The Python-side TestClaimDedupe (analytics-service/tests/test_main_worker.py)
-- MOCKS the RPC, so it cannot observe this server-side invariant; the only
-- other gate is a structural prosrc presence check. This file exercises the
-- LIVE RPC against the test project so the dedupe is verified by behavior,
-- not by string-matching the function body.
--
-- pgTAP is not set up in this project (CLAUDE.md / Lane B), so assertions
-- RAISE EXCEPTION on failure; a clean run prints NOTICEs only. Run under
-- `psql -v ON_ERROR_STOP=1`. Run order: AFTER migration 20260603120000.
--
-- Part 2 seeds gen_random_uuid() ids inside an explicit BEGIN/ROLLBACK so a
-- concurrent CI run against the shared test project cannot collide and no row
-- is left behind even on assertion failure. Every count assertion is scoped
-- to the seeded strategy_id so committed rows from a concurrent run cannot
-- perturb it (red-team A, the same pattern the sibling
-- test_compute_jobs_rpc_error_clear_and_fanin.sql uses).

-- ==========================================================================
-- Part 1 — structural: the live priority claim RPC still carries the
-- per-partition `rn_s = 1` dedupe filter. Zero side effects; fails on a
-- revert that drops the strategy-partition dedupe (the exact neuter that
-- makes Part 2's RAISE fire).
-- ==========================================================================
DO $$
DECLARE
  v_claimp TEXT := pg_get_functiondef('claim_compute_jobs_with_priority(integer,text,boolean)'::regprocedure);
BEGIN
  -- The strategy-partition dedupe: `(strategy_id IS NULL OR kind =
  -- 'compute_intro_snapshot' OR rn_s = 1)`. The `rn_s = 1` term is what
  -- collapses two same-(kind,strategy_id) candidates to one survivor.
  IF v_claimp !~* 'rn_s\s*=\s*1' THEN
    RAISE EXCEPTION 'M-1124: priority claim RPC lost the rn_s = 1 strategy-partition dedupe filter';
  END IF;
  IF v_claimp !~* 'PARTITION\s+BY\s+kind\s*,\s*strategy_id' THEN
    RAISE EXCEPTION 'M-1124: priority claim RPC lost the (kind, strategy_id) row_number partition';
  END IF;

  RAISE NOTICE 'Part 1 OK: priority claim RPC carries the rn_s = 1 (kind, strategy_id) dedupe filter.';
END $$;

-- ==========================================================================
-- Part 2 — functional: two ready failed_retry rows sharing
-- (compute_analytics, strategy_id) are deduped to exactly ONE survivor by a
-- single batch claim, and exactly one row flips to running with no 23505.
-- Isolated in a transaction that always rolls back.
-- ==========================================================================
BEGIN;
DO $$
DECLARE
  v_user    uuid := gen_random_uuid();
  v_strat   uuid;
  v_claimed int;
  v_running int;
BEGIN
  -- FK chain: compute_jobs.strategy_id -> strategies.id -> profiles.id ->
  -- auth.users.id. handle_new_user auto-creates the profile; absorb it.
  INSERT INTO auth.users (id, email)
    VALUES (v_user, 'dedupe-sql-' || v_user || '@invalid.local');
  INSERT INTO public.profiles (id, display_name)
    VALUES (v_user, 'dedupe-test') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.strategies (user_id, name)
    VALUES (v_user, 'dedupe-strat') RETURNING id INTO v_strat;

  -- TWO failed_retry rows sharing (kind, strategy_id); both DUE and dated at
  -- the unix epoch + high priority so the claim batch (size 5) must consider
  -- BOTH. Absent the dedupe, the single batch UPDATE flips both
  -- failed_retry -> running and the partial unique index
  -- compute_jobs_one_inflight_per_kind_strategy raises 23505. With the
  -- dedupe present, exactly one survives the rn_s = 1 filter.
  INSERT INTO public.compute_jobs
      (id, kind, strategy_id, status, priority, attempts, next_attempt_at, claim_token)
    VALUES
      (gen_random_uuid(), 'compute_analytics', v_strat, 'failed_retry', 'high', 1,
       TIMESTAMPTZ '1970-01-01 00:00:00+00', NULL),
      (gen_random_uuid(), 'compute_analytics', v_strat, 'failed_retry', 'high', 1,
       TIMESTAMPTZ '1970-01-01 00:00:01+00', NULL);

  -- Claim a batch of 5. The RPC RETURNS SETOF compute_jobs, so the returned
  -- rows carry strategy_id; scope the survivor count to the seeded strategy
  -- so any concurrent committed claim in the shared test project cannot
  -- inflate it (red-team A).
  SELECT count(*) INTO v_claimed
    FROM public.claim_compute_jobs_with_priority(5, 'dedupe-worker-' || v_user, NULL)
   WHERE strategy_id = v_strat;

  -- The dedupe must return exactly ONE survivor for this partition AND must
  -- not raise 23505 (a 23505 would have already aborted this DO block).
  IF v_claimed <> 1 THEN
    RAISE EXCEPTION 'M-1124: expected exactly 1 deduped survivor for (compute_analytics, %), got %',
      v_strat, v_claimed;
  END IF;

  -- And exactly one of the two seeded rows is now running (the other is
  -- left untouched as failed_retry). Scoped to the seeded strategy_id.
  SELECT count(*) INTO v_running
    FROM public.compute_jobs
   WHERE strategy_id = v_strat AND status = 'running';
  IF v_running <> 1 THEN
    RAISE EXCEPTION 'M-1124: dedupe flipped <>1 row to running for % (got %)', v_strat, v_running;
  END IF;

  RAISE NOTICE 'M-1124 OK: same-partition batch claim deduped to 1 survivor, no 23505.';
END $$;
ROLLBACK;
