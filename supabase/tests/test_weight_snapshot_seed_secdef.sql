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
--
-- ⭐ RED-UNDER ANNOTATIONS (Phase 164.4). Each assertion below carries a prose
-- `RED-UNDER:` naming the smallest production change that makes it fail, and a
-- machine-readable `RED-UNDER-M:` twin the mutation runner applies on a
-- throwaway pg-lane cluster to PROVE it reds on its OWN arm, then restores
-- GREEN. Schema: scripts/mutation-runner/GRAMMAR.md. The line below declares
-- what the lane applies before this gate.
--
-- ⚠️ 07-fixture-supabase-default-privileges.sql IS LOAD-BEARING. Assertion 2
-- asserts that an `authenticated` INSERT into weight_snapshots is DENIED, and
-- what must do the denying is `weight_snapshots_insert_deny`'s
-- `WITH CHECK (false)` — a POLICY. On a vanilla cluster `authenticated` would
-- never have held the table GRANT either, so the assertion's 42501 would arrive
-- for a completely different reason and the policy could be deleted without the
-- arm noticing. Granting Supabase's bootstrap defaults first is what makes
-- assertion 2's twin (which adds a permissive INSERT policy and expects the
-- write to LAND) falsifiable at all.
--
-- ⛔ THE TWO REAL MIGRATIONS THAT CREATE `portfolio_alerts` ARE NOT LISTED, so
-- 22-fixture-portfolio-alerts.sql stands in for it. 20260416125431 — the
-- migration that installs the two seed triggers under test — re-shapes that
-- table in its STEPs 1-3 before reaching them, and its creators
-- (20260405061911_initial_schema.sql, 20260407075303_portfolio_intelligence.sql)
-- carry the whole Phase-031 schema; the latter was MEASURED unapplicable to a
-- vanilla cluster by plan 164.4-00 (probe 1). No arm here asserts anything about
-- portfolio_alerts — see that fixture's header for the column-by-column
-- derivation off the lane's own failure.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/06-fixture-portfolio-strategies.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/22-fixture-portfolio-alerts.sql","supabase/migrations/20260412094451_weight_snapshots.sql","supabase/migrations/20260416125431_rebalance_drift_check_and_trigger.sql","supabase/migrations/20260806120000_strategies_capital_ownership.sql","supabase/migrations/20260806130000_seed_weight_snapshot_secdef.sql"]}

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
  -- RED-UNDER: seed the companion row with ZERO weights instead of NULL —
  --            `CURRENT_DATE, NULL, NULL` becomes `CURRENT_DATE, 0, 0` in
  --            seed_weight_snapshot_for_portfolio_strategy()'s INSERT in
  --            migration 20260806130000.
  --            ⚠️ Chosen over the obvious "revert SECURITY DEFINER", and the
  --            reason is the point: an INVOKER trigger raises 42501 from
  --            inside the portfolio_strategies INSERT above, which this file
  --            does NOT wrap in a handler — so psql aborts with a raw driver
  --            error naming no arm, and assertion 1 would never get to speak.
  --            The zero-weight seed keeps the write path alive and breaks only
  --            what assertion 1 owns: the null-target ground truth the
  --            rebalance_drift guard reads. A weight of 0 is not "no target",
  --            it is a target of nothing — and the guard would start acting on
  --            it. Assertion 3 covers the DEFINER clause separately.
  -- RED-UNDER-M: {"arm":"1","apply":[{"kind":"edit","file":"supabase/migrations/20260806130000_seed_weight_snapshot_secdef.sql","find":"    NEW.portfolio_id, NEW.strategy_id, CURRENT_DATE, NULL, NULL\n","replace":"    NEW.portfolio_id, NEW.strategy_id, CURRENT_DATE, 0, 0\n","occurrences":1}]}
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

  -- RED-UNDER: add the owner-scoped INSERT policy the header names as the
  --            REJECTED alternative fix — `CREATE POLICY … ON weight_snapshots
  --            FOR INSERT TO authenticated WITH CHECK (true)` on the live
  --            database. RLS ORs permissive policies, so it does not remove
  --            weight_snapshots_insert_deny; it simply makes it irrelevant, and
  --            the direct client write LANDS. That is the whole failure mode
  --            this arm exists for: assertion 1 goes on passing, because a
  --            client-writable path satisfies the seed requirement too. A `sql`
  --            step rather than a migration edit — 20260412094451 pins the deny
  --            policies exactly and deleting one there would change what the
  --            gate asserts instead of breaking it.
  -- RED-UNDER-M: {"arm":"2","apply":[{"kind":"sql","stmt":"CREATE POLICY weight_snapshots_owner_insert ON public.weight_snapshots FOR INSERT TO authenticated WITH CHECK (true)"}]}
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
  -- RED-UNDER: fix the INSTANCE and not the CLASS — drop the `SECURITY DEFINER`
  --            line from the PORTFOLIO-LEVEL fan-out
  --            seed_weight_snapshots_for_portfolio() in migration
  --            20260806130000, leaving its per-row sibling repaired. This is
  --            precisely the shape that migration's own header rejects, and it
  --            is invisible to every behavioural arm: the fan-out is latent
  --            today (the portfolio_strategies FK stops a child row pre-dating
  --            its parent), so assertion 1 still passes and this structural arm
  --            is the only witness. LAYERED: the migration re-asserts prosecdef
  --            over BOTH names in its own STEP 3a and would abort the apply, so
  --            the second edit narrows that loop to the one function still
  --            repaired — which is exactly what a migration shipping the
  --            instance-only fix would have done to its self-check.
  -- RED-UNDER-M: {"arm":"3","apply":[{"kind":"edit","file":"supabase/migrations/20260806130000_seed_weight_snapshot_secdef.sql","find":"CREATE OR REPLACE FUNCTION public.seed_weight_snapshots_for_portfolio()\nRETURNS TRIGGER\nLANGUAGE plpgsql\nSECURITY DEFINER\n","replace":"CREATE OR REPLACE FUNCTION public.seed_weight_snapshots_for_portfolio()\nRETURNS TRIGGER\nLANGUAGE plpgsql\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260806130000_seed_weight_snapshot_secdef.sql","find":"      'seed_weight_snapshot_for_portfolio_strategy',\n      'seed_weight_snapshots_for_portfolio'\n    ]) AS name","replace":"      'seed_weight_snapshot_for_portfolio_strategy'\n    ]) AS name","occurrences":1}]}
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
  -- RED-UNDER: re-own the PORTFOLIO-LEVEL fan-out to a role that is neither
  --            BYPASSRLS nor the owner of weight_snapshots — `ALTER FUNCTION
  --            public.seed_weight_snapshots_for_portfolio() OWNER TO
  --            authenticated` on the live database. SECURITY DEFINER buys
  --            nothing when the definer is itself subject to the deny policy,
  --            which is the gap between assertion 3 and this one: 3 sees the
  --            clause, 4 sees whether the clause MEANS anything.
  --            ⚠️ The other half of this arm — FORCE ROW LEVEL SECURITY — is
  --            deliberately NOT the mutation. The header says why: FORCE-RLS
  --            brings the 42501 back, so assertion 1 reddens first and this arm
  --            never speaks. The fan-out is picked over its per-row sibling for
  --            the same reason as assertion 3's twin: it is latent, so no
  --            behavioural arm pre-empts this one. A `sql` step because no
  --            migration sets the owner — ownership comes from whoever ran the
  --            migration, which is not a byte in the repo.
  -- RED-UNDER-M: {"arm":"4","apply":[{"kind":"sql","stmt":"ALTER FUNCTION public.seed_weight_snapshots_for_portfolio() OWNER TO authenticated"}]}
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
