-- Test: Phase 119 (SFOX-04) sFOX exchange-value boundary widen
-- (migration 20260718182056_sfox_exchange_boundary_checks.sql).
--
-- Clones the deribit precedent's boundary posture for 'sfox': proves each of the
-- four widened CHECK constraints ADMITS 'sfox' (widened) while a bogus exchange
-- value is STILL REJECTED (not dropped), and compute_jobs.exchange still admits
-- NULL (nullable form preserved). pgTAP is not set up in this project (CLAUDE.md /
-- Lane B), so assertions RAISE EXCEPTION on failure; a clean run prints NOTICEs
-- only. Run with `psql -v ON_ERROR_STOP=1`.
--
-- RED without the migration applied: the 'sfox' INSERT/UPDATE arms below fail the
-- pre-widen CHECK (23514). GREEN once the migration is applied to the project.
--
-- Run order: AFTER migration 20260718182056_sfox_exchange_boundary_checks.sql.
-- Seeds use gen_random_uuid() ids cleaned up at the end, so concurrent CI runs
-- against the shared test project cannot collide.

-- ==========================================================================
-- 1. api_keys.exchange — admit 'sfox', reject a bogus value
-- ==========================================================================
DO $$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_key   uuid := gen_random_uuid();
  v_bogus_rejected boolean := false;
BEGIN
  INSERT INTO auth.users (id, email)
    VALUES (v_owner, 'sfox-sql-' || v_owner || '@invalid.local');
  INSERT INTO public.profiles (id, display_name)
    VALUES (v_owner, 'sfox-owner') ON CONFLICT (id) DO NOTHING;

  -- (a) 'sfox' is ADMITTED (widened).
  INSERT INTO public.api_keys (id, user_id, exchange, label, api_key_encrypted)
    VALUES (v_key, v_owner, 'sfox', 'sfox-key', 'x');
  IF NOT EXISTS (SELECT 1 FROM public.api_keys WHERE id = v_key AND exchange = 'sfox') THEN
    RAISE EXCEPTION 'SFOX-04 (1a): api_keys did not admit exchange=sfox';
  END IF;

  -- (b) a bogus value is STILL REJECTED (widened, not dropped).
  BEGIN
    INSERT INTO public.api_keys (id, user_id, exchange, label, api_key_encrypted)
      VALUES (gen_random_uuid(), v_owner, 'notanexchange', 'bad', 'x');
  EXCEPTION WHEN check_violation THEN
    v_bogus_rejected := true;
  END;
  IF NOT v_bogus_rejected THEN
    RAISE EXCEPTION 'SFOX-04 (1b): api_keys_exchange_check admitted a bogus exchange value';
  END IF;

  DELETE FROM public.api_keys WHERE user_id = v_owner;
  DELETE FROM public.profiles WHERE id = v_owner;
  DELETE FROM auth.users WHERE id = v_owner;

  RAISE NOTICE 'SFOX-04 Part 1: api_keys.exchange admits sfox / rejects bogus OK.';
END $$;

-- ==========================================================================
-- 2. compute_jobs.exchange — admit 'sfox', still admit NULL, reject a bogus value
--    compute_jobs has no user_id; kind is NOT NULL (FK to compute_job_kinds).
-- ==========================================================================
DO $$
DECLARE
  v_bogus_rejected boolean := false;
  v_sfox_id uuid := gen_random_uuid();
  v_null_id uuid := gen_random_uuid();
BEGIN
  -- (a) 'sfox' is ADMITTED.
  INSERT INTO public.compute_jobs (id, kind, exchange, status)
    VALUES (v_sfox_id, 'sync_trades', 'sfox', 'pending');
  IF NOT EXISTS (SELECT 1 FROM public.compute_jobs WHERE id = v_sfox_id AND exchange = 'sfox') THEN
    RAISE EXCEPTION 'SFOX-04 (2a): compute_jobs did not admit exchange=sfox';
  END IF;

  -- (b) NULL exchange still admitted (nullable form preserved).
  INSERT INTO public.compute_jobs (id, kind, exchange, status)
    VALUES (v_null_id, 'sync_trades', NULL, 'pending');
  IF NOT EXISTS (SELECT 1 FROM public.compute_jobs WHERE id = v_null_id AND exchange IS NULL) THEN
    RAISE EXCEPTION 'SFOX-04 (2b): compute_jobs rejected a NULL exchange — nullable form lost';
  END IF;

  -- (c) a bogus value is STILL REJECTED.
  BEGIN
    INSERT INTO public.compute_jobs (id, kind, exchange, status)
      VALUES (gen_random_uuid(), 'sync_trades', 'notanexchange', 'pending');
  EXCEPTION WHEN check_violation THEN
    v_bogus_rejected := true;
  END;
  IF NOT v_bogus_rejected THEN
    RAISE EXCEPTION 'SFOX-04 (2c): compute_jobs_exchange_check admitted a bogus exchange value';
  END IF;

  DELETE FROM public.compute_jobs WHERE id IN (v_sfox_id, v_null_id);

  RAISE NOTICE 'SFOX-04 Part 2: compute_jobs.exchange admits sfox + NULL / rejects bogus OK.';
END $$;

-- ==========================================================================
-- 3. strategies.source — admit 'sfox', reject a bogus value
-- ==========================================================================
DO $$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_strat uuid := gen_random_uuid();
  v_bogus_rejected boolean := false;
BEGIN
  INSERT INTO auth.users (id, email)
    VALUES (v_owner, 'sfox-strat-' || v_owner || '@invalid.local');
  INSERT INTO public.profiles (id, display_name)
    VALUES (v_owner, 'sfox-strat') ON CONFLICT (id) DO NOTHING;

  -- (a) source='sfox' is ADMITTED.
  INSERT INTO public.strategies (id, user_id, name, source)
    VALUES (v_strat, v_owner, 'sfox-strat', 'sfox');
  IF NOT EXISTS (SELECT 1 FROM public.strategies WHERE id = v_strat AND source = 'sfox') THEN
    RAISE EXCEPTION 'SFOX-04 (3a): strategies did not admit source=sfox';
  END IF;

  -- (b) a bogus value is STILL REJECTED.
  BEGIN
    INSERT INTO public.strategies (id, user_id, name, source)
      VALUES (gen_random_uuid(), v_owner, 'bad', 'notasource');
  EXCEPTION WHEN check_violation THEN
    v_bogus_rejected := true;
  END;
  IF NOT v_bogus_rejected THEN
    RAISE EXCEPTION 'SFOX-04 (3b): strategies_source_check admitted a bogus source value';
  END IF;

  DELETE FROM public.strategies WHERE user_id = v_owner;
  DELETE FROM public.profiles WHERE id = v_owner;
  DELETE FROM auth.users WHERE id = v_owner;

  RAISE NOTICE 'SFOX-04 Part 3: strategies.source admits sfox / rejects bogus OK.';
END $$;

-- ==========================================================================
-- 4. strategy_verifications.source — admit 'sfox', reject a bogus value
-- ==========================================================================
DO $$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_strat uuid := gen_random_uuid();
  v_ver   uuid := gen_random_uuid();
  v_bogus_rejected boolean := false;
BEGIN
  INSERT INTO auth.users (id, email)
    VALUES (v_owner, 'sfox-ver-' || v_owner || '@invalid.local');
  INSERT INTO public.profiles (id, display_name)
    VALUES (v_owner, 'sfox-ver') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.strategies (id, user_id, name, source)
    VALUES (v_strat, v_owner, 'sfox-ver-strat', 'sfox');

  -- (a) source='sfox' is ADMITTED. Provide all NOT NULL columns so the source
  --     CHECK is what's under test (not an unrelated NOT NULL violation).
  INSERT INTO public.strategy_verifications
      (id, strategy_id, wizard_session_id, status, trust_tier, flow_type, source)
    VALUES (v_ver, v_strat, gen_random_uuid(), 'validated', 'self_reported', 'onboard', 'sfox');
  IF NOT EXISTS (SELECT 1 FROM public.strategy_verifications WHERE id = v_ver AND source = 'sfox') THEN
    RAISE EXCEPTION 'SFOX-04 (4a): strategy_verifications did not admit source=sfox';
  END IF;

  -- (b) a bogus value is STILL REJECTED.
  BEGIN
    INSERT INTO public.strategy_verifications
        (id, strategy_id, wizard_session_id, status, trust_tier, flow_type, source)
      VALUES (gen_random_uuid(), v_strat, gen_random_uuid(), 'validated', 'self_reported', 'onboard', 'notasource');
  EXCEPTION WHEN check_violation THEN
    v_bogus_rejected := true;
  END;
  IF NOT v_bogus_rejected THEN
    RAISE EXCEPTION 'SFOX-04 (4b): strategy_verifications_source_check admitted a bogus source value';
  END IF;

  DELETE FROM public.strategy_verifications WHERE strategy_id = v_strat;
  DELETE FROM public.strategies WHERE user_id = v_owner;
  DELETE FROM public.profiles WHERE id = v_owner;
  DELETE FROM auth.users WHERE id = v_owner;

  RAISE NOTICE 'SFOX-04 Part 4: strategy_verifications.source admits sfox / rejects bogus OK.';
END $$;
