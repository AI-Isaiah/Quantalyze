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
--
-- ⭐ MACHINE-EXECUTABLE TWINS (phase 164.4, REDUNDER-BACKFILL). Each prose
-- RED-UNDER below carries an adjacent `RED-UNDER-M` object that
-- scripts/mutation-runner executes on every push: it mutates COPIES on a
-- throwaway pg-lane cluster, requires the FIRST `TEST FAILED (…)` to name that
-- arm, and restores GREEN. Schema: scripts/mutation-runner/GRAMMAR.md.
-- ⚠️ THE TWO CHECKS ARE LAST-DEFINED IN DIFFERENT MIGRATIONS, and each twin
-- targets whichever LAST defines the constraint it mutates. The shape CHECK is
-- defined ONCE, in 20260710120000. The coherence CHECK is a DROP/ADD chain
-- re-issued in full by twelve migrations, and the last of them is
-- 20260717233529 — NOT 20260710130000, which this file's header names as the
-- migration under test. Mutating 20260710130000's copy would be overwritten by
-- 20260717233529 later in the apply list and would prove nothing, so Arm 6's
-- twin targets 20260717233529. Only arms 4 and 6 are twinned: arms 1, 2, 3 and
-- 5 are positive-path writes that raise nothing, so they are not sections.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710130000_stitch_composite_kind.sql","supabase/migrations/20260717233529_allocator_equity_derived_surface.sql"]}

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
  -- RED-UNDER: widen the strategy_analytics_metrics_by_basis_shape CHECK in
  --            migration 20260710120000 to admit jsonb_typeof 'null' as well
  --            as 'object'. That is exactly the loosening the header calls the
  --            carry-forward hazard: writers that persist JSON `null` for an
  --            unavailable basis stop being rejected, and every reader doing
  --            `metrics->>'basis'` starts seeing a JSON null it cannot tell
  --            from a missing key. The migration's own self-verify only checks
  --            that the COLUMN exists and is nullable (:207-213) — it never
  --            probes the CHECK's rejection behaviour — so the widened
  --            constraint applies perfectly clean. That is precisely why this
  --            arm has to exist: a shape CHECK that stops rejecting is not a
  --            shape CHECK, and nothing upstream of this file would notice.
  -- RED-UNDER-M: {"arm":"Arm 4","apply":[{"kind":"edit","file":"supabase/migrations/20260710120000_strategy_keys.sql","find":"  CHECK (metrics_json_by_basis IS NULL OR jsonb_typeof(metrics_json_by_basis) = 'object');","replace":"  CHECK (metrics_json_by_basis IS NULL OR jsonb_typeof(metrics_json_by_basis) IN ('object', 'null'));","occurrences":1}]}
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
  -- RED-UNDER: in migration 20260717233529 (the LAST migration to re-issue
  --            compute_jobs_kind_target_coherence in full — see the header),
  --            widen the api_key-scoped `derive_broker_dailies` arm to
  --            `kind = ANY (ARRAY['derive_broker_dailies','stitch_composite'])`.
  --            That mints exactly the wrongly-added api_key arm this assertion
  --            names: a stitch_composite job could then be enqueued against a
  --            bare api_key, which the composite stitcher cannot resolve to a
  --            member set, so the job would be claimed and fail per tick rather
  --            than being refused at write time. The migration's own
  --            self-verify (:385) only asserts the constraint text still
  --            matches `%derive_broker_dailies%api_key_id IS NOT NULL%`, which
  --            the widened ARRAY form still satisfies, so the apply is clean.
  -- RED-UNDER-M: {"arm":"Arm 6","apply":[{"kind":"edit","file":"supabase/migrations/20260717233529_allocator_equity_derived_surface.sql","find":"  OR ((kind = 'derive_broker_dailies') AND (api_key_id IS NOT NULL) AND (strategy_id IS NULL) AND (portfolio_id IS NULL) AND (allocator_id IS NULL))","replace":"  OR ((kind = ANY (ARRAY['derive_broker_dailies', 'stitch_composite'])) AND (api_key_id IS NOT NULL) AND (strategy_id IS NULL) AND (portfolio_id IS NULL) AND (allocator_id IS NULL))","occurrences":1}]}
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
