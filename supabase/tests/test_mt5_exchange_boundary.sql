-- Test: Phase 135 (MT5SRC-03) MT5 exchange-value boundary widen
-- (migration 20260723172032_mt5_exchange_boundary_checks.sql).
--
-- Clones the sFOX precedent's boundary posture for 'mt5': proves each of the
-- four widened CHECK constraints ADMITS 'mt5' (widened) while a bogus exchange
-- value is STILL REJECTED (not dropped), and compute_jobs.exchange still admits
-- NULL (nullable form preserved). pgTAP is not set up in this project (CLAUDE.md /
-- Lane B), so assertions RAISE EXCEPTION on failure; a clean run prints NOTICEs
-- only. Run with `psql -v ON_ERROR_STOP=1`.
--
-- RED without the migration applied: the 'mt5' INSERT arms below fail the
-- pre-widen CHECK (23514). GREEN once the migration is applied to the project.
--
-- Run order: AFTER migration 20260723172032_mt5_exchange_boundary_checks.sql.
-- Seeds use gen_random_uuid() ids cleaned up at the end, so concurrent CI runs
-- against the shared test project cannot collide.
--
-- CI auto-discovers supabase/tests/test_*.sql (ci.yml) — no workflow edit needed.

-- ==========================================================================
-- 1. api_keys.exchange — admit 'mt5', reject a bogus value
-- ==========================================================================
DO $$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_key   uuid := gen_random_uuid();
  v_bogus_rejected boolean := false;
BEGIN
  INSERT INTO auth.users (id, email)
    VALUES (v_owner, 'mt5-sql-' || v_owner || '@invalid.local');
  INSERT INTO public.profiles (id, display_name)
    VALUES (v_owner, 'mt5-owner') ON CONFLICT (id) DO NOTHING;

  -- (a) 'mt5' is ADMITTED (widened).
  INSERT INTO public.api_keys (id, user_id, exchange, label, api_key_encrypted)
    VALUES (v_key, v_owner, 'mt5', 'mt5-key', 'x');
  IF NOT EXISTS (SELECT 1 FROM public.api_keys WHERE id = v_key AND exchange = 'mt5') THEN
    RAISE EXCEPTION 'MT5SRC-03 (1a): api_keys did not admit exchange=mt5';
  END IF;

  -- (b) a bogus value is STILL REJECTED (widened, not dropped).
  BEGIN
    INSERT INTO public.api_keys (id, user_id, exchange, label, api_key_encrypted)
      VALUES (gen_random_uuid(), v_owner, 'notanexchange', 'bad', 'x');
  EXCEPTION WHEN check_violation THEN
    v_bogus_rejected := true;
  END;
  IF NOT v_bogus_rejected THEN
    RAISE EXCEPTION 'MT5SRC-03 (1b): api_keys_exchange_check admitted a bogus exchange value';
  END IF;

  DELETE FROM public.api_keys WHERE user_id = v_owner;
  DELETE FROM public.profiles WHERE id = v_owner;
  DELETE FROM auth.users WHERE id = v_owner;

  RAISE NOTICE 'MT5SRC-03 Part 1: api_keys.exchange admits mt5 / rejects bogus OK.';
END $$;

-- ==========================================================================
-- 2. compute_jobs.exchange — admit 'mt5', still admit NULL, reject a bogus value
--    compute_jobs has no user_id, but two UNRELATED guards constrain the fixture:
--      * compute_jobs_kind_target_coherence — kind='sync_trades' requires a
--        non-null strategy_id (and null portfolio/allocator/api_key). So we seed
--        a strategy and stamp strategy_id on every row.
--      * compute_jobs_one_inflight_per_kind_strategy — a partial unique index
--        forbids two inflight (pending) sync_trades jobs for the same strategy,
--        so we DELETE each row before inserting the next.
--    Both are pre-existing constraints (NOT touched by this migration) — the
--    fixture must satisfy them so the arm under test is the EXCHANGE check alone.
-- ==========================================================================
DO $$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_strat uuid := gen_random_uuid();
  v_bogus_rejected boolean := false;
  v_mt5_id uuid := gen_random_uuid();
  v_null_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, email)
    VALUES (v_owner, 'mt5-cj-' || v_owner || '@invalid.local');
  INSERT INTO public.profiles (id, display_name)
    VALUES (v_owner, 'mt5-cj') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.strategies (id, user_id, name, source)
    VALUES (v_strat, v_owner, 'mt5-cj-strat', 'mt5');

  -- (a) 'mt5' is ADMITTED (delete before (b): one-inflight-per-kind-strategy).
  INSERT INTO public.compute_jobs (id, kind, exchange, status, strategy_id)
    VALUES (v_mt5_id, 'sync_trades', 'mt5', 'pending', v_strat);
  IF NOT EXISTS (SELECT 1 FROM public.compute_jobs WHERE id = v_mt5_id AND exchange = 'mt5') THEN
    RAISE EXCEPTION 'MT5SRC-03 (2a): compute_jobs did not admit exchange=mt5';
  END IF;
  DELETE FROM public.compute_jobs WHERE id = v_mt5_id;

  -- (b) NULL exchange still admitted (nullable form preserved).
  INSERT INTO public.compute_jobs (id, kind, exchange, status, strategy_id)
    VALUES (v_null_id, 'sync_trades', NULL, 'pending', v_strat);
  IF NOT EXISTS (SELECT 1 FROM public.compute_jobs WHERE id = v_null_id AND exchange IS NULL) THEN
    RAISE EXCEPTION 'MT5SRC-03 (2b): compute_jobs rejected a NULL exchange — nullable form lost';
  END IF;
  DELETE FROM public.compute_jobs WHERE id = v_null_id;

  -- (c) a bogus value is STILL REJECTED (the exchange CHECK fires regardless of target).
  BEGIN
    INSERT INTO public.compute_jobs (id, kind, exchange, status, strategy_id)
      VALUES (gen_random_uuid(), 'sync_trades', 'notanexchange', 'pending', v_strat);
  EXCEPTION WHEN check_violation THEN
    v_bogus_rejected := true;
  END;
  IF NOT v_bogus_rejected THEN
    RAISE EXCEPTION 'MT5SRC-03 (2c): compute_jobs_exchange_check admitted a bogus exchange value';
  END IF;

  DELETE FROM public.compute_jobs WHERE strategy_id = v_strat;
  DELETE FROM public.strategies WHERE user_id = v_owner;
  DELETE FROM public.profiles WHERE id = v_owner;
  DELETE FROM auth.users WHERE id = v_owner;

  RAISE NOTICE 'MT5SRC-03 Part 2: compute_jobs.exchange admits mt5 + NULL / rejects bogus OK.';
END $$;

-- ==========================================================================
-- 3. strategies.source — admit 'mt5', reject a bogus value
-- ==========================================================================
DO $$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_strat uuid := gen_random_uuid();
  v_bogus_rejected boolean := false;
BEGIN
  INSERT INTO auth.users (id, email)
    VALUES (v_owner, 'mt5-strat-' || v_owner || '@invalid.local');
  INSERT INTO public.profiles (id, display_name)
    VALUES (v_owner, 'mt5-strat') ON CONFLICT (id) DO NOTHING;

  -- (a) source='mt5' is ADMITTED.
  INSERT INTO public.strategies (id, user_id, name, source)
    VALUES (v_strat, v_owner, 'mt5-strat', 'mt5');
  IF NOT EXISTS (SELECT 1 FROM public.strategies WHERE id = v_strat AND source = 'mt5') THEN
    RAISE EXCEPTION 'MT5SRC-03 (3a): strategies did not admit source=mt5';
  END IF;

  -- (b) a bogus value is STILL REJECTED.
  BEGIN
    INSERT INTO public.strategies (id, user_id, name, source)
      VALUES (gen_random_uuid(), v_owner, 'bad', 'notasource');
  EXCEPTION WHEN check_violation THEN
    v_bogus_rejected := true;
  END;
  IF NOT v_bogus_rejected THEN
    RAISE EXCEPTION 'MT5SRC-03 (3b): strategies_source_check admitted a bogus source value';
  END IF;

  DELETE FROM public.strategies WHERE user_id = v_owner;
  DELETE FROM public.profiles WHERE id = v_owner;
  DELETE FROM auth.users WHERE id = v_owner;

  RAISE NOTICE 'MT5SRC-03 Part 3: strategies.source admits mt5 / rejects bogus OK.';
END $$;

-- ==========================================================================
-- 4. strategy_verifications.source — admit 'mt5', reject a bogus value
-- ==========================================================================
DO $$
DECLARE
  v_owner uuid := gen_random_uuid();
  v_strat uuid := gen_random_uuid();
  v_ver   uuid := gen_random_uuid();
  v_bogus_rejected boolean := false;
BEGIN
  INSERT INTO auth.users (id, email)
    VALUES (v_owner, 'mt5-ver-' || v_owner || '@invalid.local');
  INSERT INTO public.profiles (id, display_name)
    VALUES (v_owner, 'mt5-ver') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.strategies (id, user_id, name, source)
    VALUES (v_strat, v_owner, 'mt5-ver-strat', 'mt5');

  -- (a) source='mt5' is ADMITTED. Provide all NOT NULL columns so the source
  --     CHECK is what's under test (not an unrelated NOT NULL violation).
  INSERT INTO public.strategy_verifications
      (id, strategy_id, wizard_session_id, status, trust_tier, flow_type, source)
    VALUES (v_ver, v_strat, gen_random_uuid(), 'validated', 'self_reported', 'onboard', 'mt5');
  IF NOT EXISTS (SELECT 1 FROM public.strategy_verifications WHERE id = v_ver AND source = 'mt5') THEN
    RAISE EXCEPTION 'MT5SRC-03 (4a): strategy_verifications did not admit source=mt5';
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
    RAISE EXCEPTION 'MT5SRC-03 (4b): strategy_verifications_source_check admitted a bogus source value';
  END IF;

  DELETE FROM public.strategy_verifications WHERE strategy_id = v_strat;
  DELETE FROM public.strategies WHERE user_id = v_owner;
  DELETE FROM public.profiles WHERE id = v_owner;
  DELETE FROM auth.users WHERE id = v_owner;

  RAISE NOTICE 'MT5SRC-03 Part 4: strategy_verifications.source admits mt5 / rejects bogus OK.';
END $$;
