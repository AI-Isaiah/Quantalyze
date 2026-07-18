-- Test: enqueue_derive_broker_dailies_for_allocator_keys fan-out eligibility +
-- derive_allocator_equity kind-CHECK admission + the api_key-coherence-arm
-- SURVIVAL regression. Guards migration
-- 20260717233529_allocator_equity_derived_surface.sql (Phase 115.1 / Q4 +
-- T-115.1-05).
--
-- Three load-bearing properties:
--   1. The recurring key-mode fan-out enqueues EXACTLY the eligible keys
--      (is_active AND sync_status IS DISTINCT FROM 'revoked' AND disconnected_at
--      IS NULL — the role-agnostic eligible_key_predicate / phase35 filter), as
--      api_key-scoped derive_broker_dailies jobs (api_key_id set, all other
--      targets NULL), and a second call does NOT duplicate (in-flight dedup).
--   2. compute_jobs admits derive_allocator_equity with an allocator_id target
--      and REJECTS it with a mis-scoped target (coherence).
--   3. RE-BASE REGRESSION: a derive_broker_dailies row with an api_key_id target
--      still INSERTs — proving the api_key coherence arm SURVIVED the CHECK
--      re-base. This is the exact silent-failure mode migration 20260710130000's
--      header warns about: copying an OLDER coherence def drops the api_key arm
--      and breaks every allocator key-mode derive.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL DO block, RAISE EXCEPTION on
-- failure. No psql meta-commands. Under psql -v ON_ERROR_STOP=1 a failed
-- assertion exits non-zero. The whole test rolls back.
--
-- SERIAL execution: the fan-out uses a SESSION advisory lock; run the sql-tests
-- job serially (the repo already runs supabase/tests/*.sql one file at a time)
-- so a concurrent holder cannot make the fn skip and redden assertion 1.
--
-- Test-DB lag: assertions are gated on the fan-out function being present
-- (NOTICE skip otherwise); the migration is MCP-applied to the TEST project
-- before this runs, so the gate enforces there.
--
-- Usage:
--   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_derive_allocator_keys_fanout.sql

BEGIN;

DO $$
DECLARE
  uid          UUID := gen_random_uuid();
  key_elig     UUID;
  key_revoked  UUID;
  key_disc     UUID;
  key_inact    UUID;
  row_cnt      INTEGER;
  raised       BOOLEAN;
  v_strat      UUID;  v_port UUID;  v_alloc UUID;  v_api UUID;
  v_cron_hour  INT;
BEGIN
  -- ----- presence gate (test-DB lag) -------------------------------------
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'enqueue_derive_broker_dailies_for_allocator_keys'
  ) THEN
    RAISE NOTICE 'SKIP: migration 20260717233529 not yet applied here (fan-out fn absent). Assertions enforce once the test DB catches up.';
    RETURN;
  END IF;

  -- ----- SEED: one allocator + four api_keys of differing eligibility -----
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'aed-fanout-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'aed-fanout', 'aed-fanout-' || uid::text || '@quantalyze.test', 'allocator')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

  -- eligible: active, sync_status NULL, not disconnected
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'binance', 'aed eligible', 'x', TRUE) RETURNING id INTO key_elig;
  -- revoked
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active, sync_status)
  VALUES (uid, 'binance', 'aed revoked', 'x', TRUE, 'revoked') RETURNING id INTO key_revoked;
  -- disconnected
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active, disconnected_at)
  VALUES (uid, 'binance', 'aed disconnected', 'x', TRUE, now()) RETURNING id INTO key_disc;
  -- inactive
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'binance', 'aed inactive', 'x', FALSE) RETURNING id INTO key_inact;

  RAISE NOTICE 'Seed OK: uid=% elig=% revoked=% disc=% inact=%', uid, key_elig, key_revoked, key_disc, key_inact;

  -- ----- ASSERTION 1: fan-out reaches EXACTLY the eligible key ------------
  PERFORM enqueue_derive_broker_dailies_for_allocator_keys();

  SELECT count(*) INTO row_cnt FROM compute_jobs
   WHERE api_key_id = key_elig AND kind = 'derive_broker_dailies' AND status = 'pending';
  IF row_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (1): eligible key got % pending derive_broker_dailies jobs, expected 1', row_cnt;
  END IF;

  -- the eligible job is api_key-scoped: api_key_id set, all other targets NULL
  SELECT strategy_id, portfolio_id, allocator_id, api_key_id
    INTO v_strat, v_port, v_alloc, v_api
    FROM compute_jobs
   WHERE api_key_id = key_elig AND kind = 'derive_broker_dailies' AND status = 'pending'
   LIMIT 1;
  IF v_api IS DISTINCT FROM key_elig OR v_strat IS NOT NULL OR v_port IS NOT NULL OR v_alloc IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (1): eligible job target shape wrong (api_key=% strat=% port=% alloc=%) — expected api_key-only', v_api, v_strat, v_port, v_alloc;
  END IF;

  -- revoked / disconnected / inactive keys get NOTHING
  SELECT count(*) INTO row_cnt FROM compute_jobs
   WHERE api_key_id IN (key_revoked, key_disc, key_inact) AND kind = 'derive_broker_dailies';
  IF row_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (1): ineligible keys got % derive_broker_dailies jobs, expected 0', row_cnt;
  END IF;

  -- ----- ASSERTION 2: second call does NOT duplicate (in-flight dedup) ----
  PERFORM enqueue_derive_broker_dailies_for_allocator_keys();
  SELECT count(*) INTO row_cnt FROM compute_jobs
   WHERE api_key_id = key_elig AND kind = 'derive_broker_dailies' AND status = 'pending';
  IF row_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (2): after second fan-out eligible key has % jobs, expected 1 (dedup)', row_cnt;
  END IF;

  -- ----- ASSERTION 3: derive_allocator_equity admitted with allocator target
  INSERT INTO compute_jobs (allocator_id, kind) VALUES (uid, 'derive_allocator_equity');
  IF NOT EXISTS (
    SELECT 1 FROM compute_jobs WHERE allocator_id = uid AND kind = 'derive_allocator_equity'
  ) THEN
    RAISE EXCEPTION 'TEST FAILED (3): derive_allocator_equity with allocator_id target was not admitted';
  END IF;

  -- ----- ASSERTION 4: derive_allocator_equity REJECTED with mis-scoped target
  -- (api_key_id set → violates the allocator-scoped coherence arm). Using the
  -- inactive key (a valid FK, no in-flight dedup row) isolates the CHECK.
  raised := FALSE;
  BEGIN
    INSERT INTO compute_jobs (api_key_id, kind) VALUES (key_inact, 'derive_allocator_equity');
  EXCEPTION WHEN check_violation THEN
    raised := TRUE;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (4): derive_allocator_equity with an api_key_id target was ACCEPTED — coherence arm missing/loosened';
  END IF;

  -- ----- ASSERTION 5: RE-BASE REGRESSION — api_key arm survived -----------
  -- A derive_broker_dailies row with an api_key_id target MUST still insert.
  -- Use the inactive key (fan-out skipped it → no in-flight dedup conflict) so
  -- a failure here can ONLY mean the api_key coherence arm was dropped.
  raised := FALSE;
  BEGIN
    INSERT INTO compute_jobs (api_key_id, kind) VALUES (key_inact, 'derive_broker_dailies');
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
  END;
  IF raised THEN
    RAISE EXCEPTION 'TEST FAILED (5): a derive_broker_dailies row with an api_key_id target was REJECTED — the api_key coherence arm did NOT survive the CHECK re-base (the exact 20260710130000-warned silent failure)';
  END IF;

  -- ----- ASSERTION 6: cron job registered at a safe hour (1-22) -----------
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'derive-allocator-key-dailies') THEN
      RAISE EXCEPTION 'TEST FAILED (6): cron.job derive-allocator-key-dailies not registered';
    END IF;
    SELECT (split_part(schedule, ' ', 2))::INT INTO v_cron_hour
      FROM cron.job WHERE jobname = 'derive-allocator-key-dailies';
    IF v_cron_hour IS NULL OR v_cron_hour < 1 OR v_cron_hour > 22 THEN
      RAISE EXCEPTION 'TEST FAILED (6): derive-allocator-key-dailies cron hour must stay 1-22 (got %)', v_cron_hour;
    END IF;
  ELSE
    RAISE NOTICE 'pg_cron not present — skipping cron assertion (local dev)';
  END IF;

  RAISE NOTICE 'All derive_broker_dailies fan-out + derive_allocator_equity coherence + re-base regression assertions passed.';

  -- ----- TEARDOWN (belt-and-suspenders; the outer ROLLBACK also discards) -
  DELETE FROM auth.users WHERE id = uid;
END
$$;

ROLLBACK;
