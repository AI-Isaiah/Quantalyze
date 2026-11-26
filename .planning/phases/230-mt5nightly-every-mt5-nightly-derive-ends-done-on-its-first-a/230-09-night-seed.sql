-- Scratch seed for the MT5D-02 nightly evidence query (Phase 230 plan 09). Never committed.
-- Run as the lane's postgres role on the PRIVATE local-stack lane ONLY (after
-- `scripts/local-stack/run.sh up` and `--assert-local-handoff`). It COMMITS: the night query
-- runs in a second psql call. Every seeded job is created at 2026-11-26T00:40:00Z.
-- Expected night-query row for night_start 2026-11-26T00:30:00Z, night_end 2026-11-26T01:30:00Z:
--   3|3|2|1|0|1|0|1|0
-- Insert shapes are copied from supabase/tests/test_compute_job_attempt_failures.sql (arm E1)
-- and test_cleanup_orphaned_api_keys_sweep.sql (strategy_keys). One owner for every row, for the
-- strategies_api_key ownership and strategy_keys owner-coherence triggers.
DO $seed$
DECLARE
  uid      UUID := gen_random_uuid();
  k_mt5_a  UUID;  -- MT5 key, also strategies.api_key_id of s_a (join path 2)
  k_mt5_b  UUID;  -- MT5 key reached only through strategy_keys (join path 3)
  k_other  UUID;  -- non-MT5 key: its derive job must not count
  s_a      UUID;
  s_b      UUID;
  j_decoy  UUID;
  j_attempt2 UUID;
  t0       TIMESTAMPTZ := TIMESTAMPTZ '2026-11-26T00:40:00Z';
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000', 'nn-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'nn', 'nn-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'nn mt5 a', 'x', TRUE) RETURNING id INTO k_mt5_a;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'nn mt5 b', 'x', TRUE) RETURNING id INTO k_mt5_b;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'binance', 'nn other', 'x', TRUE) RETURNING id INTO k_other;

  -- s_a: strategy whose own key is the MT5 key. s_b: api_key_id stays NULL, linked only
  -- through strategy_keys, so that join path is exercised on its own.
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k_mt5_a, 'nn s_a') RETURNING id INTO s_a;
  INSERT INTO strategies (user_id, name) VALUES (uid, 'nn s_b') RETURNING id INTO s_b;
  INSERT INTO public.strategy_keys (strategy_id, api_key_id, owner_id, window_start, seq)
  VALUES (s_b, k_mt5_b, uid, DATE '2025-08-01', 0);

  -- Join path 1: key-scoped MT5 derive job, done, attempts 1.
  INSERT INTO compute_jobs (api_key_id, kind, status, attempts, created_at)
  VALUES (k_mt5_a, 'derive_broker_dailies', 'done', 1, t0);
  -- Join path 2: strategy-scoped through strategies.api_key_id, done, attempts 2 (+ its ledger row).
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, created_at)
  VALUES (s_a, 'derive_broker_dailies', 'done', 2, t0) RETURNING id INTO j_attempt2;
  -- Join path 3: strategy-scoped through strategy_keys, done, attempts 1.
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, created_at)
  VALUES (s_b, 'derive_broker_dailies', 'done', 1, t0);
  -- Decoy: non-MT5 key-scoped derive job at attempts 2 (+ its own ledger row). Must not count.
  INSERT INTO compute_jobs (api_key_id, kind, status, attempts, created_at)
  VALUES (k_other, 'derive_broker_dailies', 'done', 2, t0) RETURNING id INTO j_decoy;
  -- Guard read: an MT5 holdings poll at attempts 1 (poll_second_attempts must read 0).
  INSERT INTO compute_jobs (api_key_id, kind, status, attempts, created_at)
  VALUES (k_mt5_a, 'poll_allocator_positions', 'done', 1, t0);

  -- Ledger: one error row for the attempts-2 MT5 job, one for the non-MT5 decoy.
  INSERT INTO compute_job_attempt_failures
    (job_id, kind, strategy_id, job_created_at, attempt, cause_class, error_kind, recorded_at)
  VALUES (j_attempt2, 'derive_broker_dailies', s_a, t0, 1, 'error', 'transient', t0 + interval '1 minute');
  INSERT INTO compute_job_attempt_failures
    (job_id, kind, api_key_id, job_created_at, attempt, cause_class, error_kind, recorded_at)
  VALUES (j_decoy, 'derive_broker_dailies', k_other, t0, 1, 'error', 'transient', t0 + interval '1 minute');

  -- One lease row whose last site is a job-terminal site.
  INSERT INTO public.mt5_terminal_leases (terminal_digest, owner_token, holder, site, acquired_at, expires_at)
  VALUES (repeat('a', 64), NULL, 'house', 'derive_broker_dailies', t0, t0);
END
$seed$;
