-- ==========================================================================
-- Migration 20261128120000: the fenced seed-hold merge RPC.
-- Phase 257 SEEDHOLD, plan 02 (SC-1 enabling half; founder ruling 2026-11-28).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- A sync_trades run derives its fills seed from the strategy's re-read bound, the
-- stored-fill high-water and the daily high-water. When the bound write
-- (set_strategy_fills_reread_bound) cannot land for a whole run, the run reads nothing
-- and holds its own daily store, but other writers still store daily rows, so the next
-- run seeds past the span this run never read. The run therefore has to leave a durable
-- record of its seed that survives every writer of strategy_analytics.data_quality_flags
-- and is not readable by anon.
--
-- Founder ruling 2026-11-28 (AskUserQuestion, recorded in 257-CONTEXT.md), verbatim
-- choice: "Job's private record (Recommended)". The record is the running job's OWN
-- compute_jobs.metadata (service-role only), and the next run reads it back as a further
-- seed term.
--
-- WHAT IT DOES
-- ------------
-- One new service-role-only function:
--   public.set_compute_job_seed_hold(p_job_id uuid, p_claim_token uuid, p_floor_ms bigint)
--   RETURNS boolean
-- It merges {seed_hold_ms: p_floor_ms} into the job's metadata in ONE UPDATE, keeping
-- every other key, and returns FOUND so the caller can tell a write that landed from one
-- that did not.
--   * Fenced exactly like set_compute_job_progress (20260712130000): the write lands only
--     on a running row whose claim token equals the caller's and is not NULL. A stale
--     token (the watchdog reclaimed the job and handed it to a second worker), a NULLed
--     token, a NULL parameter, another status or an unknown id returns false and changes
--     nothing.
--   * Non-object metadata (SQL NULL, JSON null, array, scalar) becomes a fresh object, as
--     mark_compute_job_kept_figures (20261106120000) does: an array merged with an object
--     would otherwise stay an array.
--   * A NULL or negative p_floor_ms raises SQLSTATE 22023 and writes nothing. Zero is
--     accepted (the Deribit reach anchor).
--
-- WHY ONE STATEMENT IS ENOUGH
-- ---------------------------
-- A direct PostgREST update of the column would replace it and lose a concurrent writer's
-- key, the lost-update class Phase 191 REFUSALRACE removed. Under READ COMMITTED, an
-- UPDATE that blocks on a row another transaction is changing re-evaluates its WHERE
-- clause and its SET expressions against the committed row it waited for, so the merge
-- always applies to the latest committed metadata. There is no window between a read and
-- a write because there is no separate read.
--
-- WHAT IT DOES NOT DO
-- -------------------
-- No table, column, policy, index, trigger or cron job changes, and no other function is
-- touched. No caller changes here: the analytics worker's run_sync_trades_job switches
-- in a later plan of this phase, after this migration has applied.
--
-- ACL. Supabase default privileges grant EXECUTE on new functions to anon and
-- authenticated directly, so a revoke from PUBLIC alone leaves them with it: the REVOKE
-- names all three. service_role is the only grantee.
--
-- Plain CREATE FUNCTION, not CREATE OR REPLACE: the name is new, so a collision must fail
-- loud instead of replacing someone else's body.
--
-- The verify block is CATALOGUE-ONLY (pg_proc, proconfig, has_function_privilege,
-- aclexplode). It reads no table, so it applies on schema-only shared TEST exactly as on
-- PROD. The behavioural proof lives in supabase/tests/test_compute_job_seed_hold.sql.
--
-- Rollback: supabase/migrations/down/20261128120000-rollback.sql (manual, never
-- auto-applied).
-- ==========================================================================

SET LOCAL lock_timeout = '3s';

-- ==========================================================================
-- STEP 1: set_compute_job_seed_hold, the fenced merge
-- ==========================================================================
CREATE FUNCTION public.set_compute_job_seed_hold(
  p_job_id      uuid,
  p_claim_token uuid,
  p_floor_ms    bigint
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF p_floor_ms IS NULL OR p_floor_ms < 0 THEN
    RAISE EXCEPTION 'set_compute_job_seed_hold: p_floor_ms must be a non-negative epoch-millisecond value (got %)', p_floor_ms
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE public.compute_jobs
     SET metadata = CASE WHEN jsonb_typeof(metadata) = 'object'
                         THEN metadata
                         ELSE '{}'::jsonb
                    END
                    || jsonb_build_object('seed_hold_ms', p_floor_ms)
   WHERE id = p_job_id
     AND claim_token IS NOT DISTINCT FROM p_claim_token
     AND claim_token IS NOT NULL
     AND status = 'running';
  RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.set_compute_job_seed_hold(uuid, uuid, bigint) IS
  'Phase 257 SEEDHOLD, migration 20261128120000 (founder ruling 2026-11-28, "Job''s private record"): merges {seed_hold_ms: p_floor_ms} into the running job''s own compute_jobs.metadata as ONE UPDATE, keeping every other key, so the next sync_trades run can read the seed this run could not record in the re-read bound. Fenced by claim token like set_compute_job_progress: lands only on a running row whose token matches and is not NULL, otherwise returns false and writes nothing. Non-object metadata becomes a fresh object. A NULL or negative floor raises 22023. Returns FOUND. Service-role only; sole caller is the analytics worker run_sync_trades_job provisional-bound failure arm.';

-- ==========================================================================
-- STEP 2: REVOKE / GRANT EXECUTE (service_role only, grantees named)
-- ==========================================================================
REVOKE ALL ON FUNCTION public.set_compute_job_seed_hold(uuid, uuid, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_compute_job_seed_hold(uuid, uuid, bigint) TO service_role;

-- ==========================================================================
-- STEP 3: self-verify, CATALOGUE ONLY (no table is read)
-- ==========================================================================
DO $$
DECLARE
  v_fn_oid OID;
BEGIN
  SELECT p.oid
    INTO v_fn_oid
    FROM pg_proc p
   WHERE p.proname = 'set_compute_job_seed_hold'
     AND p.pronamespace = 'public'::regnamespace;
  IF v_fn_oid IS NULL THEN
    RAISE EXCEPTION 'Migration 20261128120000: set_compute_job_seed_hold function missing';
  END IF;

  IF NOT COALESCE((SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_fn_oid), false) THEN
    RAISE EXCEPTION 'Migration 20261128120000: set_compute_job_seed_hold is NOT SECURITY DEFINER';
  END IF;

  IF NOT COALESCE((SELECT 'search_path=public, pg_catalog' = ANY(p.proconfig)
                     FROM pg_proc p WHERE p.oid = v_fn_oid), false) THEN
    RAISE EXCEPTION 'Migration 20261128120000: set_compute_job_seed_hold missing SET search_path = public, pg_catalog';
  END IF;

  IF NOT has_function_privilege('service_role', v_fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261128120000: service_role lacks EXECUTE on set_compute_job_seed_hold (the worker cannot call it)';
  END IF;
  IF has_function_privilege('anon', v_fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261128120000: anon can EXECUTE set_compute_job_seed_hold (a SECURITY DEFINER writer exposed through PostgREST)';
  END IF;
  IF has_function_privilege('authenticated', v_fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261128120000: authenticated can EXECUTE set_compute_job_seed_hold (a SECURITY DEFINER writer exposed through PostgREST)';
  END IF;

  -- PUBLIC (grantee 0) must hold no EXECUTE: the grant list is explicit.
  IF EXISTS (SELECT 1
               FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid = v_fn_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261128120000: PUBLIC still holds EXECUTE on set_compute_job_seed_hold';
  END IF;

  RAISE NOTICE 'Migration 20261128120000: set_compute_job_seed_hold installed (catalogue verified: SECDEF, pinned search_path, service_role-only EXECUTE).';
END $$;

-- ==========================================================================
-- END OF MIGRATION 20261128120000
-- ==========================================================================
-- Downstream consumer (a later plan of Phase 257, after this migration has applied):
--   * analytics-service/services/job_worker.py run_sync_trades_job
