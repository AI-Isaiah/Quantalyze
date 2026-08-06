-- Regression test for the weight_snapshots seed-trigger landmine repaired by
--   * 20260806130000_seed_weight_snapshot_secdef.sql
--
-- The bug (live in PRODUCTION 2026-04-16 → 2026-08-06)
-- ----------------------------------------------------
-- `20260416125431` installed two AFTER INSERT trigger functions that write a
-- companion `weight_snapshots` row. Both were SECURITY INVOKER (no clause =
-- the Postgres default), so their INSERT ran under the RLS of the firing
-- session. `20260412094451:80-82` denies ALL client INSERTs into
-- `weight_snapshots` with `WITH CHECK (false)`. Result: every
-- `authenticated`-role INSERT into `portfolio_strategies` aborted with
--
--   42501 new row violates row-level security policy for table "weight_snapshots"
--
-- which killed the two shipped browser-direct writes — AddToPortfolio.tsx:54
-- and MigrationWizard.tsx:72 — for nearly four months. Service-role writes were
-- unaffected (BYPASSRLS), which is why nothing surfaced until Phase 150's
-- allocation-guard test became the first automated test to insert a
-- `portfolio_strategies` row as the `authenticated` role.
--
-- Why this file exists SEPARATELY from the allocation-guard test
-- --------------------------------------------------------------
-- `test_capital_ownership_allocation_guard.sql` case 1 does redden if the fix
-- is reverted — but it reddens with a raw 42501 out of an unrelated table,
-- which reads as "the OWN-03 guard over-blocks" and sends the next reader down
-- the wrong path entirely. This file names the actual invariant so the failure
-- message points at the real cause. It also covers the arm the guard test
-- cannot see at all: that the repair did NOT buy itself by weakening the deny
-- policies.
--
-- Assertions:
--   1. BEHAVIOURAL (the bug): an `authenticated`-role INSERT into
--      `portfolio_strategies` SUCCEEDS and the companion `weight_snapshots` row
--      is seeded with NULL target/actual. Fails with 42501 without the fix.
--   2. INVARIANT NOT WEAKENED: a DIRECT `authenticated` INSERT into
--      `weight_snapshots` is STILL denied. The deny policies are the design —
--      derived allocation history must never be client-writable — and the
--      alternative fix (an owner-scoped INSERT policy) would pass assertion 1
--      while silently deleting this one.
--   3. STRUCTURAL: both seed functions are `prosecdef` with a pinned
--      `search_path`. Assertion 1 only exercises the per-row sibling; the
--      portfolio-level fan-out is latent today (the `portfolio_strategies`
--      FK stops a child row pre-dating its parent) so no behavioural case can
--      reach it, and latent defence that no test can see is defence that gets
--      reverted in the next refactor.
--   4. STRUCTURAL: the DEFINER context is actually exempt — `weight_snapshots`
--      is not FORCE-RLS and each function's owner either has BYPASSRLS or owns
--      the table. If a future migration adds FORCE ROW LEVEL SECURITY, the
--      42501 returns and assertion 1 alone would be a puzzling regression.
--
-- House convention: plain PL/pgSQL `DO $$ ... $$` with RAISE EXCEPTION on
-- failure (pgTAP is NOT installed — 0 of the existing supabase/tests/*.sql use
-- plan/ok/finish), run by .github/workflows/ci.yml `sql-tests` under
-- `psql -v ON_ERROR_STOP=1`.
--
-- Hygiene (shared TEST DB): every fixture row is created inside this file's own
-- transaction with generated UUIDs, every predicate names those ids, there is
-- no table-wide mutation, and the transaction ends in ROLLBACK.
--
-- Usage:
--   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_weight_snapshot_seed_secdef.sql

-- Defensive pre-clean, scoped to this file's OWN sentinel email.
DELETE FROM auth.users
  WHERE email = 'test-weight-snapshot-seed@quantalyze.test';

BEGIN;

DO $$
DECLARE
  uid_a     UUID := gen_random_uuid();
  port_a    UUID;
  strat_a   UUID;
  row_cnt   INTEGER;
  denied    BOOLEAN;
  v_force   BOOLEAN;
  v_owner   OID;
  fn        RECORD;
BEGIN
  -- ======================================================================
  -- SEED (seeding/service-role context — bypasses RLS)
  -- ======================================================================
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_a, '00000000-0000-0000-0000-000000000000',
          'test-weight-snapshot-seed@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_a, 'weight-snapshot seed probe',
          'test-weight-snapshot-seed@quantalyze.test', 'allocator')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;

  INSERT INTO portfolios (user_id, name)
  VALUES (uid_a, 'weight-snapshot seed book')
  RETURNING id INTO port_a;

  -- own_capital so the Phase 150 D-03-A guard admits the insert; this file is
  -- about the seed trigger, not about the ownership mark.
  INSERT INTO strategies (user_id, name, status, capital_ownership,
                          strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid_a, 'weight-snapshot seed strat', 'private', 'own_capital',
          '{}', '{}', '{}', ARRAY['binance'])
  RETURNING id INTO strat_a;

  -- ======================================================================
  -- Everything below runs as the AUTHENTICATED role with A's JWT — the same
  -- context AddToPortfolio.tsx:54 and MigrationWizard.tsx:72 run in.
  -- ======================================================================
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- ----- 1: the bug itself ------------------------------------------------
  -- Without the SECURITY DEFINER repair this statement raises
  -- `42501 new row violates row-level security policy for table
  -- "weight_snapshots"` from inside seed_weight_snapshot_for_portfolio_strategy().
  INSERT INTO portfolio_strategies (portfolio_id, strategy_id, allocated_amount)
  VALUES (port_a, strat_a, 100000);

  SELECT count(*) INTO row_cnt
    FROM portfolio_strategies
   WHERE portfolio_id = port_a AND strategy_id = strat_a;
  IF row_cnt <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION
      'TEST FAILED (1): an authenticated INSERT into portfolio_strategies did not land (% rows) — the browser-direct allocation paths are dead', row_cnt;
  END IF;

  RESET ROLE;

  -- The companion row must exist, with NULL target/actual (the rebalance_drift
  -- null-target guard's ground truth). Read as the seeding role: the trigger's
  -- write is the thing under test, not the reader's RLS.
  SELECT count(*) INTO row_cnt
    FROM weight_snapshots
   WHERE portfolio_id = port_a AND strategy_id = strat_a
     AND snapshot_date = CURRENT_DATE
     AND target_weight IS NULL AND actual_weight IS NULL;
  IF row_cnt <> 1 THEN
    RAISE EXCEPTION
      'TEST FAILED (1): the seed trigger did not write the NULL-weight companion weight_snapshots row (% matching rows) — the rebalance_drift null-target guard has lost its ground truth', row_cnt;
  END IF;

  -- ----- 2: the invariant the fix must NOT have weakened -------------------
  -- An owner-scoped INSERT policy on weight_snapshots would satisfy case 1 and
  -- silently hand every session a write path into derived allocation history.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  denied := FALSE;
  BEGIN
    INSERT INTO weight_snapshots (portfolio_id, strategy_id, snapshot_date,
                                  target_weight, actual_weight)
    VALUES (port_a, strat_a, CURRENT_DATE - 1, 0.99, 0.99);
  EXCEPTION WHEN insufficient_privilege THEN
    denied := TRUE;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  IF NOT denied THEN
    RAISE EXCEPTION
      'TEST FAILED (2): an authenticated session wrote weight_snapshots DIRECTLY — the seed-trigger repair leaked a client write path into derived allocation history; the deny policies are the design, the DEFINER context is the fix';
  END IF;

  -- ----- 3: both seed functions are SECURITY DEFINER + pinned search_path --
  FOR fn IN
    SELECT unnest(ARRAY[
      'seed_weight_snapshot_for_portfolio_strategy',
      'seed_weight_snapshots_for_portfolio'
    ]) AS name
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = fn.name AND p.prosecdef
    ) THEN
      RAISE EXCEPTION
        'TEST FAILED (3): public.%() is SECURITY INVOKER — its weight_snapshots write runs under the caller''s RLS and the insert-deny policy kills the whole statement', fn.name;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = fn.name
        AND array_to_string(COALESCE(p.proconfig, ARRAY[]::text[]), ';') LIKE '%search_path=%public%'
    ) THEN
      RAISE EXCEPTION
        'TEST FAILED (3): public.%() is SECURITY DEFINER without a pinned search_path', fn.name;
    END IF;
  END LOOP;

  -- ----- 4: the DEFINER context is genuinely exempt ------------------------
  SELECT c.relforcerowsecurity, c.relowner
    INTO v_force, v_owner
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'weight_snapshots';
  IF v_force THEN
    RAISE EXCEPTION
      'TEST FAILED (4): weight_snapshots has FORCE ROW LEVEL SECURITY — the owner is no longer exempt and SECURITY DEFINER stops clearing the insert-deny policy';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_roles r ON r.oid = p.proowner
    WHERE n.nspname = 'public'
      AND p.proname IN ('seed_weight_snapshot_for_portfolio_strategy',
                        'seed_weight_snapshots_for_portfolio')
      AND NOT r.rolbypassrls
      AND p.proowner <> v_owner
  ) THEN
    RAISE EXCEPTION
      'TEST FAILED (4): a seed function is owned by a role that neither has BYPASSRLS nor owns weight_snapshots — the DEFINER context is still blocked';
  END IF;

  RAISE NOTICE 'test_weight_snapshot_seed_secdef: ALL PASS (authenticated allocation seeds its companion row, direct client writes still denied, both seed functions DEFINER + pinned, owner exempt).';
END
$$;

ROLLBACK;
