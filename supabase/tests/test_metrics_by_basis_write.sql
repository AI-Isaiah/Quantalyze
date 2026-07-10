-- Test for the metrics_json_by_basis WRITE-PATH shape guard (Phase 85 CHECK
-- strategy_analytics_metrics_by_basis_shape) + the Phase 86 stitch_composite
-- job-kind admission (migration 20260710130000). COMP-04 persistence contract.
--
-- The Phase 85 CHECK admits SQL NULL or a jsonb OBJECT; a JSON `null`
-- (jsonb_typeof = 'null') FAILS the CHECK. The carry-forward hazard is that a
-- careless writer persists JSON `null` when a basis is unavailable — this test
-- pins the rejection to the NAMED constraint so a loosened CHECK ships RED, not
-- GREEN. It also proves the new stitch_composite kind is admitted strategy-scoped
-- and rejected api_key-scoped by compute_jobs_kind_target_coherence (the two
-- CHECKs Plan 03's enqueue depends on).
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL `DO $$ ... $$` with
-- RAISE EXCEPTION on failure / RAISE NOTICE on pass, mirroring the other
-- supabase/tests/test_*.sql files. No psql backslash meta-commands. Under
-- `psql -v ON_ERROR_STOP=1` (what .github/workflows/ci.yml `sql-tests` runs) a
-- failed assertion exits non-zero and fails the job. Filename matches the
-- `test_*.sql` glob so the job auto-discovers it against the test project (with
-- migrations 20260710120000 + 20260710130000 applied).
--
-- Negative arms trap check_violation inside a nested BEGIN ... EXCEPTION (an
-- implicit savepoint) and pin CONSTRAINT_NAME via GET STACKED DIAGNOSTICS, so a
-- rejection by the WRONG constraint (or no rejection) fails the test. All
-- fixture work runs inside an explicit transaction ending in ROLLBACK — the
-- shared test DB is never polluted. Synthetic tenant only; no real creds.
--
-- Usage:
--   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_metrics_by_basis_write.sql

-- --------------------------------------------------------------------------
-- Defensive pre-clean (a prior aborted run may have committed synthetic rows).
-- ON DELETE CASCADE chains auth.users -> profiles -> {strategies, api_keys}
-- -> {strategy_analytics, compute_jobs}, so deleting auth.users by email drops
-- the whole subtree.
-- --------------------------------------------------------------------------
DELETE FROM auth.users
  WHERE email = 'test-mbb-write@quantalyze.test';

BEGIN;

DO $$
DECLARE
  uid          UUID := gen_random_uuid();
  key          UUID;
  strat        UUID;
  raised       BOOLEAN;
  v_constraint TEXT;
BEGIN
  -- ----- SEED (seeding/service-role context — bypasses RLS) ---------------
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'test-mbb-write@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'mbb-write tenant', 'test-mbb-write@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;

  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted)
  VALUES (uid, 'binance', 'mbb-write key', 'x') RETURNING id INTO key;
  INSERT INTO strategies (user_id, name, status, strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid, 'mbb-write strategy', 'published', '{}', '{}', '{}', ARRAY['binance'])
  RETURNING id INTO strat;
  INSERT INTO strategy_analytics (strategy_id) VALUES (strat);

  RAISE NOTICE 'Seed OK: uid=% key=% strat=%', uid, key, strat;

  -- ----- ARM 1: SQL NULL passes (basis unavailable → column-wide SQL NULL) --
  UPDATE strategy_analytics SET metrics_json_by_basis = NULL WHERE strategy_id = strat;

  -- ----- ARM 2: empty object passes ({} is a valid object under the CHECK) --
  UPDATE strategy_analytics SET metrics_json_by_basis = '{}'::jsonb WHERE strategy_id = strat;

  -- ----- ARM 3: the Plan 03 writer shape passes ---------------------------
  UPDATE strategy_analytics
     SET metrics_json_by_basis = '{"cash_settlement": {"cumulative_return": 0.62}}'::jsonb
   WHERE strategy_id = strat;

  -- ----- ARM 4: JSON null is REJECTED, pinned to the shape CHECK ----------
  -- The carry-forward hazard: writers must persist SQL NULL, never JSON null.
  -- jsonb 'null' has jsonb_typeof = 'null' (not 'object') → CHECK violation.
  raised := FALSE; v_constraint := NULL;
  BEGIN
    UPDATE strategy_analytics SET metrics_json_by_basis = 'null'::jsonb WHERE strategy_id = strat;
  EXCEPTION WHEN check_violation THEN
    raised := TRUE;
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Arm 4): JSON null was ACCEPTED into metrics_json_by_basis — strategy_analytics_metrics_by_basis_shape CHECK missing or loosened';
  END IF;
  IF v_constraint IS DISTINCT FROM 'strategy_analytics_metrics_by_basis_shape' THEN
    RAISE EXCEPTION 'TEST FAILED (Arm 4): JSON null rejected by the WRONG constraint (expected strategy_analytics_metrics_by_basis_shape, got: %)', v_constraint;
  END IF;

  -- ----- ARM 5: stitch_composite + strategy target passes BOTH CHECKs -----
  -- Requires migration 20260710130000 applied (kind registered + admitted).
  INSERT INTO compute_jobs (strategy_id, kind) VALUES (strat, 'stitch_composite');

  -- ----- ARM 6: stitch_composite + api_key-only target is REJECTED --------
  -- api_key-only target passes the 4-way compute_jobs_target_xor but has no
  -- coherence arm for stitch_composite → rejected by kind_target_coherence.
  -- Pin the constraint so a wrongly-added api_key arm (or a target_xor-only
  -- rejection) fails the test.
  raised := FALSE; v_constraint := NULL;
  BEGIN
    INSERT INTO compute_jobs (api_key_id, kind) VALUES (key, 'stitch_composite');
  EXCEPTION WHEN check_violation THEN
    raised := TRUE;
    GET STACKED DIAGNOSTICS v_constraint = CONSTRAINT_NAME;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Arm 6): stitch_composite with an api_key-only target was ACCEPTED — coherence CHECK admits a target it must reject';
  END IF;
  IF v_constraint IS DISTINCT FROM 'compute_jobs_kind_target_coherence' THEN
    RAISE EXCEPTION 'TEST FAILED (Arm 6): api_key-target stitch_composite rejected by the WRONG constraint (expected compute_jobs_kind_target_coherence, got: %)', v_constraint;
  END IF;

  RAISE NOTICE 'test_metrics_by_basis_write: ALL PASS (shape guard rejects JSON null; stitch_composite admitted strategy-scoped, rejected api_key-scoped).';
END
$$;

ROLLBACK;
