-- Migration 104: Phase 19 / BACKBONE-05 + BACKBONE-08 + BACKBONE-09
-- wizard_session_id UNIQUE INDEX + process_key_long kind + drain RPC
-- + feature_flags kill-switch table.
--
-- Why this migration exists
-- -------------------------
-- Phase 19 unifies the API-key + CSV ingestion paths. Three load-bearing
-- pieces ship here:
--   1. BACKBONE-08: a UNIQUE INDEX on strategy_verifications.wizard_session_id
--      catches wizard double-submits at the DB layer (Postgres 23505 errors
--      converted by the route handler into a 200-with-existing-row response).
--   2. BACKBONE-09: compute_jobs.kind admits 'process_key_long', and the
--      claim RPC stamps unified_backbone_at_claim into metadata at claim time
--      (drain semantics — Pitfall 3: workers MUST read the snapshot, never
--      the live env-var, to avoid mid-flight flag flips killing in-flight work).
--   3. BACKBONE-05: a feature_flags kill-switch table with seeded
--      'process_key_unified_backbone' = 'off' row + RLS.
--
-- CRITICAL ground-truth corrections (C-1, C-2, C-3, D-1):
--   C-1: status enum is 'pending' (NOT 'queued') per migration 032 L112-120.
--        Filtering by status='queued' returns ZERO rows and silently breaks
--        dispatch.
--   C-2: REVOKE ALL ON FUNCTION FROM PUBLIC, anon, authenticated. NO new
--        GRANT issued. RLS does not protect SECURITY DEFINER. service_role
--        bypasses RLS in Supabase by default — workers continue working
--        without explicit GRANT. Granting to authenticated would let any
--        logged-in user claim arbitrary jobs.
--   C-3: schedule column is `next_attempt_at TIMESTAMPTZ` per migration 032
--        L123 + migration 086 L131/L146. NEVER `run_after` (does not exist).
--   D-1: claim must NOT overwrite the original unified_backbone_at_claim
--        snapshot on watchdog re-claim. Use COALESCE so reset_stalled
--        preserves the original value.
--
-- D-3 PostgREST fallback: PostgREST resolves the new 3-arg form via schema
-- cache (reloaded on Supabase function deploy). If a stale cache misses the
-- 3rd arg, the application-side fallback in P7-2 (plan 19-07) issues an
-- alert and retries with the 2-arg form. Verified Supabase project's
-- PostgREST is ≥12 (tolerates default-NULL added args).
--
-- M-1 pre-flight: aborts the migration if any duplicate wizard_session_id
-- rows exist (CREATE UNIQUE INDEX would otherwise fail mid-transaction
-- and leave a partially-applied schema).

BEGIN;

SET lock_timeout = '3s';

-- ==========================================================================
-- M-1 PRE-FLIGHT: abort if duplicate wizard_session_id rows exist
-- ==========================================================================
-- M-1 pre-flight: abort if any duplicate wizard_session_id exists.
-- CREATE UNIQUE INDEX would otherwise fail mid-transaction and leave the
-- migration partially applied. Run against test Supabase project before
-- production push.
DO $$
DECLARE
  v_dups INT;
BEGIN
  SELECT count(*) INTO v_dups FROM (
    SELECT wizard_session_id FROM strategy_verifications
     GROUP BY wizard_session_id HAVING count(*) > 1
  ) AS d;
  IF v_dups > 0 THEN
    RAISE EXCEPTION 'Migration 104 M-1 ABORT: % duplicate wizard_session_id values present; resolve manually before applying UNIQUE INDEX', v_dups
      USING ERRCODE = 'unique_violation';
  END IF;
END $$;

-- ==========================================================================
-- STEP 1 — wizard_session_id UNIQUE INDEX (BACKBONE-08)
-- ==========================================================================
-- Per migration 093 line 80, wizard_session_id is UUID NOT NULL — plain
-- UNIQUE INDEX (no partial WHERE clause) is correct.
CREATE UNIQUE INDEX IF NOT EXISTS strategy_verifications_wizard_session_id_unique_idx
  ON strategy_verifications (wizard_session_id);

COMMENT ON INDEX strategy_verifications_wizard_session_id_unique_idx IS
  'Phase 19 / BACKBONE-08. Wizard double-submit prevention; route catches 23505 and returns existing row.';

COMMIT;

-- ==========================================================================
-- STEP 2 — compute_jobs.kind CHECK widening (BACKBONE-09) — M-2 BEGIN/COMMIT
-- ==========================================================================
-- M-2: explicit BEGIN/COMMIT around the CHECK swap. Postgres takes ACCESS
-- EXCLUSIVE locks for ALTER TABLE so this is safe in practice; the explicit
-- block makes the intent unambiguous.
BEGIN;
ALTER TABLE compute_jobs DROP CONSTRAINT IF EXISTS compute_jobs_kind_check;
ALTER TABLE compute_jobs ADD CONSTRAINT compute_jobs_kind_check CHECK (kind IN (
  'sync_trades', 'compute_analytics', 'compute_portfolio', 'poll_positions',
  'sync_funding', 'reconcile_strategy', 'compute_intro_snapshot',
  'rescore_allocator', 'poll_allocator_positions',
  'reconstruct_allocator_history', 'refresh_allocator_equity_daily',
  'process_key_long'   -- Phase 19 / BACKBONE-09
));
COMMIT;

BEGIN;

-- ==========================================================================
-- STEP 3 — claim_compute_jobs_with_priority extended for drain (BACKBONE-09)
-- ==========================================================================
-- Body mirrors migration 086's claim_compute_jobs_with_priority verbatim
-- (FOR UPDATE SKIP LOCKED inner SELECT, priority ordering, lock semantics).
-- The only behavioral additions are:
--   (a) 3rd arg p_unified_backbone_active BOOLEAN DEFAULT NULL
--   (b) metadata merge writing unified_backbone_at_claim at claim time
--   (c) D-1 — COALESCE preserves any pre-existing snapshot on watchdog re-claim
-- The status filter ('pending'), schedule column (next_attempt_at), and the
-- REVOKE-but-no-GRANT pattern are LOAD-BEARING per C-1/C-2/C-3.
CREATE OR REPLACE FUNCTION claim_compute_jobs_with_priority(
  p_batch_size INTEGER,
  p_worker_id  TEXT,
  p_unified_backbone_active BOOLEAN DEFAULT NULL  -- Phase 19 / BACKBONE-09 drain
)
RETURNS SETOF compute_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_high_pending INTEGER;
BEGIN
  -- Validation matches migration 086:108-123 verbatim — same lower bound,
  -- same upper cap of 1000 against runaway batches.
  IF p_batch_size IS NULL OR p_batch_size <= 0 THEN
    RAISE EXCEPTION 'claim_compute_jobs_with_priority: p_batch_size must be > 0, got %', p_batch_size
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_batch_size > 1000 THEN
    RAISE EXCEPTION 'claim_compute_jobs_with_priority: p_batch_size % exceeds cap of 1000', p_batch_size
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_worker_id IS NULL OR length(p_worker_id) = 0 THEN
    RAISE EXCEPTION 'claim_compute_jobs_with_priority: p_worker_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Are any normal/high jobs ready to run? Index-only scan via
  -- idx_compute_jobs_priority_pending (migration 086 STEP 2).
  -- C-1: 'pending' (cite migration 032 L112-120). C-3: next_attempt_at
  -- (cite migration 032 L123 + 086 L131/L146).
  SELECT count(*) INTO v_high_pending
    FROM compute_jobs
   WHERE priority IN ('normal','high')
     AND status = 'pending'                                -- C-1
     AND next_attempt_at <= now();                         -- C-3

  -- Atomic claim with priority precedence + throttle guard. The inner
  -- SELECT FOR UPDATE SKIP LOCKED is the same concurrency primitive
  -- used by migration 086:144-153.
  RETURN QUERY
  UPDATE compute_jobs
     SET status     = 'running',
         claimed_at = now(),
         claimed_by = p_worker_id,
         attempts   = attempts + 1,
         -- D-1: COALESCE(metadata->>'unified_backbone_at_claim', ...) preserves the
         -- existing snapshot on watchdog re-claim (reset_stalled would otherwise
         -- overwrite it from the live flag, breaking Pitfall 3 mitigation).
         metadata   = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
           'unified_backbone_at_claim',
           COALESCE(metadata->>'unified_backbone_at_claim',
                    CASE WHEN p_unified_backbone_active IS NULL THEN NULL
                         ELSE p_unified_backbone_active::text
                    END)
         )
   WHERE id IN (
     SELECT id FROM compute_jobs
       WHERE status = 'pending'                            -- C-1: pending, NOT queued
         AND (next_attempt_at IS NULL OR next_attempt_at <= now())  -- C-3
         -- Throttle: if any normal/high pending, exclude low this tick.
         AND (v_high_pending = 0 OR priority IN ('normal','high'))
       ORDER BY
         CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
         next_attempt_at
       LIMIT p_batch_size
       FOR UPDATE SKIP LOCKED
   )
   RETURNING *;
END;
$$;

COMMENT ON FUNCTION claim_compute_jobs_with_priority IS
  'Phase 19 / BACKBONE-09 drain. New 3rd arg p_unified_backbone_active stamps unified_backbone_at_claim into compute_jobs.metadata so workers read the snapshot, never the live env var. Status filter is ''pending'' per migration 032 L112-120 (C-1); schedule column is next_attempt_at per migration 032 L123 (C-3); REVOKE is preserved without re-GRANT to authenticated per migration 086 L163 (C-2); D-1 — COALESCE preserves pre-existing snapshot on watchdog re-claim. PostgREST schema cache reloaded on deploy; ≥v12 tolerates default-NULL added args (D-3).';

-- C-2: REVOKE matches migration 086 line 163 verbatim. NO new GRANT issued.
-- service_role bypasses RLS in Supabase by default — workers continue working
-- via the service-role client without explicit GRANT. Issuing GRANT TO
-- authenticated would expand privilege beyond migration 086's posture and
-- allow any authenticated user to claim arbitrary jobs (RLS does not protect
-- SECURITY DEFINER).
REVOKE ALL ON FUNCTION claim_compute_jobs_with_priority(INTEGER, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;

-- ==========================================================================
-- STEP 4 — feature_flags kill-switch table (BACKBONE-05)
-- ==========================================================================
CREATE TABLE IF NOT EXISTS feature_flags (
  flag_key   TEXT PRIMARY KEY,
  value      TEXT NOT NULL CHECK (value IN ('on', 'off')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);

ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS feature_flags_authenticated_select ON feature_flags;
CREATE POLICY feature_flags_authenticated_select ON feature_flags
  FOR SELECT USING (true);

DROP POLICY IF EXISTS feature_flags_service_all ON feature_flags;
CREATE POLICY feature_flags_service_all ON feature_flags
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

INSERT INTO feature_flags (flag_key, value, updated_by)
  VALUES ('process_key_unified_backbone', 'off', 'migration-104-seed')
  ON CONFLICT (flag_key) DO NOTHING;

COMMENT ON TABLE feature_flags IS
  'Phase 19 / BACKBONE-05. Kill-switch row written by /api/cron/flag-monitor on auto-rollback.';

-- ==========================================================================
-- STEP 5 — Self-verifying DO block (mirror migration 093 STEP 7)
-- ==========================================================================
DO $$
DECLARE
  v_idx_count INT;
  v_kind_check_ok BOOLEAN;
  v_rpc_ok BOOLEAN;
  v_flag_count INT;
  v_rls_count INT;
BEGIN
  -- (a) wizard_session_id UNIQUE INDEX present
  SELECT count(*) INTO v_idx_count FROM pg_indexes
    WHERE schemaname='public'
      AND tablename='strategy_verifications'
      AND indexname='strategy_verifications_wizard_session_id_unique_idx';
  IF v_idx_count <> 1 THEN RAISE EXCEPTION 'Migration 104: wizard_session_id UNIQUE INDEX missing'; END IF;

  -- (b) compute_jobs.kind admits process_key_long
  SELECT EXISTS(
    SELECT 1 FROM information_schema.check_constraints
     WHERE constraint_name='compute_jobs_kind_check'
       AND check_clause LIKE '%process_key_long%'
  ) INTO v_kind_check_ok;
  IF NOT v_kind_check_ok THEN RAISE EXCEPTION 'Migration 104: process_key_long not in compute_jobs_kind_check'; END IF;

  -- (c) claim RPC has 3 args
  SELECT EXISTS(
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
     WHERE n.nspname='public'
       AND p.proname='claim_compute_jobs_with_priority'
       AND p.pronargs = 3
  ) INTO v_rpc_ok;
  IF NOT v_rpc_ok THEN RAISE EXCEPTION 'Migration 104: claim_compute_jobs_with_priority not 3-arg'; END IF;

  -- (d) feature_flags row seeded
  SELECT count(*) INTO v_flag_count FROM feature_flags WHERE flag_key='process_key_unified_backbone';
  IF v_flag_count <> 1 THEN RAISE EXCEPTION 'Migration 104: process_key_unified_backbone row missing'; END IF;

  -- (e) RLS policies present (>= 2)
  SELECT count(*) INTO v_rls_count FROM pg_policies
    WHERE schemaname='public' AND tablename='feature_flags';
  IF v_rls_count < 2 THEN RAISE EXCEPTION 'Migration 104: feature_flags RLS policies missing'; END IF;

  RAISE NOTICE 'Migration 104: column/index/RPC/flag/RLS assertions passed.';
END $$;

-- ==========================================================================
-- STEP 6 — C-1/D-1 functional smoke (SAVEPOINT-rolled-back)
-- ==========================================================================
-- C-1 functional verification: seed a pending row, call the new RPC, assert
-- claim succeeds. Wrapped in a SAVEPOINT so test data is rolled back inside
-- the migration transaction (no commit-time pollution of the queue).
DO $$
DECLARE
  v_test_strategy_id UUID;
  v_test_job_id UUID;
  v_claimed_count INT;
  v_meta_ok BOOLEAN;
BEGIN
  SAVEPOINT migration_104_drain_smoke;
  -- Seed a strategy + pending compute_job
  SELECT id INTO v_test_strategy_id FROM strategies LIMIT 1;
  IF v_test_strategy_id IS NULL THEN
    RAISE NOTICE 'Migration 104: no strategies present, skipping drain functional smoke';
    RELEASE SAVEPOINT migration_104_drain_smoke;
    RETURN;
  END IF;
  INSERT INTO compute_jobs (strategy_id, kind, status, priority, next_attempt_at, metadata)
    VALUES (v_test_strategy_id, 'process_key_long', 'pending', 'normal', now() - interval '1 second', '{}'::jsonb)
    RETURNING id INTO v_test_job_id;

  -- Claim it via the new 3-arg RPC. Filter the resultset to our seeded row
  -- so we don't fail when other pending rows exist concurrently in the queue.
  SELECT count(*) INTO v_claimed_count
    FROM claim_compute_jobs_with_priority(50, 'migration-104-smoke', TRUE) c
   WHERE c.id = v_test_job_id;

  IF v_claimed_count = 0 THEN
    RAISE EXCEPTION 'Migration 104 C-1 smoke FAILED: claim_compute_jobs_with_priority returned no row for our seeded pending job (status enum drift?)';
  END IF;

  -- Assert metadata stamped (D-1)
  SELECT EXISTS(
    SELECT 1 FROM compute_jobs
     WHERE id = v_test_job_id
       AND (metadata->>'unified_backbone_at_claim') = 'true'
  ) INTO v_meta_ok;
  IF NOT v_meta_ok THEN
    RAISE EXCEPTION 'Migration 104 D-1 smoke FAILED: unified_backbone_at_claim not stamped';
  END IF;

  RAISE NOTICE 'Migration 104 C-1/D-1 functional smoke passed (claimed_count=%).', v_claimed_count;
  ROLLBACK TO SAVEPOINT migration_104_drain_smoke;
END $$;

DO $$ BEGIN RAISE NOTICE 'Migration 104: all assertions passed.'; END $$;

COMMIT;

-- ==========================================================================
-- END OF MIGRATION 104
-- ==========================================================================
