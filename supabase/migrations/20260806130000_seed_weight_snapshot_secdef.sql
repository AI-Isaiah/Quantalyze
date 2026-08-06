-- Phase 150 / Plan 01 DEVIATION — root-cause fix for a PRODUCTION-BREAKING
-- landmine that has been live since 2026-04-16 and that blocks the OWN-03
-- money path.
-- 2026-08-06.
--
--
-- (a) WHAT IS BROKEN.
-- -------------------
-- `20260416125431_rebalance_drift_check_and_trigger.sql` installed two AFTER
-- INSERT trigger functions that write a companion `weight_snapshots` row:
--   * seed_weight_snapshot_for_portfolio_strategy()  (AFTER INSERT ON portfolio_strategies)
--   * seed_weight_snapshots_for_portfolio()          (AFTER INSERT ON portfolios)
-- Both were created WITHOUT a security context, so both are SECURITY INVOKER
-- (the Postgres default) and their INSERT is evaluated under the RLS of the
-- session that fired the trigger.
--
-- `20260412094451_weight_snapshots.sql:80-90` enables RLS on `weight_snapshots`
-- and denies ALL client writes by design:
--     weight_snapshots_insert_deny  FOR INSERT WITH CHECK (false)
--     weight_snapshots_update_deny  FOR UPDATE USING (false)
--     weight_snapshots_delete_deny  FOR DELETE USING (false)
--
-- The two migrations are individually correct and mutually lethal. Since
-- 2026-04-16, ANY INSERT into `portfolio_strategies` performed by the
-- `authenticated` role fires the INVOKER trigger, whose companion INSERT hits
-- `weight_snapshots_insert_deny`, and the WHOLE statement aborts with:
--
--   ERROR 42501: new row violates row-level security policy for table "weight_snapshots"
--   CONTEXT: SQL statement "INSERT INTO weight_snapshots (...) ON CONFLICT ... DO NOTHING"
--            PL/pgSQL function seed_weight_snapshot_for_portfolio_strategy() line 3
--
-- `ON CONFLICT DO NOTHING` does not rescue it: RLS `WITH CHECK` is evaluated
-- before conflict resolution.
--
-- Service-role writes were never affected (BYPASSRLS), which is why the demo
-- seed, the workers and every server route using the service client kept
-- working and nothing surfaced.
--
--
-- (b) EVIDENCE THAT THIS IS LIVE IN PRODUCTION, NOT THEORETICAL.
-- --------------------------------------------------------------
-- Two SHIPPED components insert `portfolio_strategies` rows straight from the
-- browser under the user's own JWT — `src/components/portfolio/AddToPortfolio.tsx:54`
-- (client `.insert`) and `src/components/portfolio/MigrationWizard.tsx:72`
-- (client `.upsert`). Both have therefore been dead since 2026-04-16.
-- Corroborating census on PROD (khslejtfbuezsmvmtsdn): only 4
-- `portfolio_strategies` rows exist with `added_at` after 2026-04-16, the most
-- recent 2026-04-26 — consistent with the client-direct paths failing and only
-- service-role paths still writing.
-- Catalog state was verified live on BOTH TEST and PROD: `prosecdef = false`
-- for both seed functions on both databases, and the three deny policies are
-- present and identical on both.
--
-- The defect surfaced here because Phase 150's allocation-guard DB test
-- (`supabase/tests/test_capital_ownership_allocation_guard.sql`, case 1) is the
-- first automated test that has ever inserted a `portfolio_strategies` row as
-- the `authenticated` role. Every prior DB test wrote as the seeding role.
--
--
-- (c) WHY THIS BLOCKS PHASE 150 AND CANNOT BE DEFERRED.
-- -----------------------------------------------------
-- OWN-03's whole point is that marked capital becomes an allocation. Plan 05's
-- allocation route inserts into `portfolio_strategies` under the user's
-- context, and Wave 2 builds on it. With the landmine in place, the D-03-A
-- guard installed by `20260806120000_strategies_capital_ownership.sql` can
-- never be observed: the insert dies at 42501 before anyone can tell whether
-- the guard would have admitted it. The phase's positive control is
-- unreachable.
--
--
-- (d) THE FIX, AND WHY IT IS THE ROOT CAUSE AND NOT A BANDAID.
-- ------------------------------------------------------------
-- Make BOTH seed trigger functions SECURITY DEFINER, so the companion write
-- runs as the function owner rather than as the caller.
--
-- The deny policies STAY EXACTLY AS THEY ARE. They are the design: a client
-- must never write `weight_snapshots` directly, because `target_weight` /
-- `actual_weight` are derived allocation history and a client-writable path
-- would let an allocator fabricate it. What the deny policies were never meant
-- to stop is the DATABASE's own bookkeeping trigger. SECURITY DEFINER is
-- exactly that distinction: the trigger write becomes a system write, the
-- client write stays impossible. This is the same argument
-- `20260806120000_strategies_capital_ownership.sql` header §(d.2) already makes
-- for the D-03-A guard.
--
-- Alternatives considered and REJECTED:
--   * Add an INSERT policy to `weight_snapshots` allowing owner-scoped writes.
--     Rejected: it hands every authenticated session a direct write path into
--     derived allocation history with arbitrary weights. It fixes the symptom
--     by deleting the invariant.
--   * Drop the seed triggers. Rejected: the NULL-seeded row is the ground truth
--     for the rebalance_drift null-target guard (20260416125431 header STEP 4);
--     removing it silently changes alerting semantics.
--   * Fix only `seed_weight_snapshot_for_portfolio_strategy()` (the one the
--     Phase 150 test tripped). Rejected: `seed_weight_snapshots_for_portfolio()`
--     is the SAME defect — same INVOKER context, same denied target table. Its
--     fan-out `INSERT ... SELECT` currently inserts zero rows on the ordinary
--     path (the `portfolio_strategies.portfolio_id` FK means no child row can
--     pre-date its parent), so it is LATENT rather than firing — but a restore,
--     a bulk load, or any future deferred-FK path turns it into the same 42501.
--     Fix the class, not the instance.
--
--
-- (e) WHY THE `REVOKE` IS SAFE (the trigger-ACL trap, explicitly cleared).
-- ------------------------------------------------------------------------
-- `20260516170000_match_decisions_visibility_check_secdef_fix.sql` documents
-- this project's one production-breaking ACL incident: a trigger function
-- `PERFORM`ed a SEPARATE helper function that had been REVOKEd, and because a
-- nested function CALL does check EXECUTE, every service-role insert 42501'd.
--
-- That trap does not apply here, for two independent reasons:
--   1. Postgres checks EXECUTE on a trigger function at CREATE TRIGGER time,
--      not when the trigger fires. Firing a trigger never requires the
--      inserting role to hold EXECUTE on the trigger function.
--   2. Neither seed function calls any other function. Their bodies are a bare
--      INSERT (and an INSERT ... SELECT); there is no nested call whose ACL
--      could be checked.
-- So the REVOKE below removes only the ability to invoke these as PostgREST
-- RPCs — which was never possible anyway, since a `RETURNS TRIGGER` function
-- cannot be called directly — while clearing the anon/authenticated
-- SECURITY-DEFINER-executable advisor. Same convention as
-- `guard_allocation_requires_own_capital()`
-- (20260806120000_strategies_capital_ownership.sql:226) and
-- `guard_strategies_publish_transition()` (20260716131000:74).
--
--
-- (f) RE-BASE CHECK (MEMORY `project_cross_cutting_refactor_program`).
-- --------------------------------------------------------------------
-- `grep -rn seed_weight_snapshot supabase/ src/ scripts/ analytics-service/`
-- returns exactly one defining migration — 20260416125431 — plus the generated
-- snapshots under `supabase/schema/functions/`. No later migration redefines
-- either function, and the live bodies on TEST match that file verbatim. The
-- two bodies below are therefore re-based on the LATEST definition, and are
-- BYTE-IDENTICAL to it except for the single added `SECURITY DEFINER` line.
-- That is deliberate: a reviewer diffing `supabase/schema/functions/` should
-- see one added line and nothing else. Unqualified relation names are left as
-- they are because `SET search_path = public, pg_catalog` is pinned on both
-- functions, which is what makes them deterministic.
--
--
-- Ops: merging supabase/migrations/** to main AUTO-APPLIES to PROD
-- (MEMORY `project_supabase_migrate_auto_on_push`). Apply to TEST
-- (qmnijlgmdhviwzwfyzlc) via MCP `apply_migration` BEFORE merge; MCP stamps
-- now(), so the TEST-side timestamp will drift from this filename. Expected.
-- This migration REPAIRS a live PROD defect — applying it to PROD is the point,
-- not a side effect.

BEGIN;

SET LOCAL lock_timeout = '3s';

-- ==========================================================================
-- 1. seed_weight_snapshot_for_portfolio_strategy() -> SECURITY DEFINER
-- ==========================================================================
-- Re-based on 20260416125431_rebalance_drift_check_and_trigger.sql:106-121.
-- The ONLY change is the `SECURITY DEFINER` line.

CREATE OR REPLACE FUNCTION public.seed_weight_snapshot_for_portfolio_strategy()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  INSERT INTO weight_snapshots (
    portfolio_id, strategy_id, snapshot_date, target_weight, actual_weight
  )
  VALUES (
    NEW.portfolio_id, NEW.strategy_id, CURRENT_DATE, NULL, NULL
  )
  ON CONFLICT (portfolio_id, strategy_id, snapshot_date) DO NOTHING;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.seed_weight_snapshot_for_portfolio_strategy() IS
  'Seeds the NULL-weight companion weight_snapshots row for a new portfolio_strategies position (migration 20260416125431). SECURITY DEFINER since 20260806130000: weight_snapshots denies ALL client writes by policy, so under SECURITY INVOKER this trigger aborted every authenticated-role INSERT into portfolio_strategies with 42501 — breaking AddToPortfolio.tsx and MigrationWizard.tsx in production from 2026-04-16. The deny policies are the design and are unchanged; the DEFINER context is what separates the database''s own bookkeeping write from a client write.';

REVOKE ALL ON FUNCTION public.seed_weight_snapshot_for_portfolio_strategy()
  FROM PUBLIC, anon, authenticated;

-- ==========================================================================
-- 2. seed_weight_snapshots_for_portfolio() -> SECURITY DEFINER
-- ==========================================================================
-- Re-based on 20260416125431_rebalance_drift_check_and_trigger.sql:135-150.
-- Same defect class (see header (d), third rejected alternative): latent today
-- only because the portfolio_strategies FK prevents a child row from pre-dating
-- its parent, so the fan-out SELECT currently returns zero rows on the ordinary
-- path. Fixed here so the class is closed, not just the instance that reddened.

CREATE OR REPLACE FUNCTION public.seed_weight_snapshots_for_portfolio()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  INSERT INTO weight_snapshots (
    portfolio_id, strategy_id, snapshot_date, target_weight, actual_weight
  )
  SELECT NEW.id, ps.strategy_id, CURRENT_DATE, NULL, NULL
  FROM portfolio_strategies ps
  WHERE ps.portfolio_id = NEW.id
  ON CONFLICT (portfolio_id, strategy_id, snapshot_date) DO NOTHING;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.seed_weight_snapshots_for_portfolio() IS
  'Fan-out sibling of seed_weight_snapshot_for_portfolio_strategy: seeds NULL-weight weight_snapshots rows for every existing child of a newly inserted portfolio (migration 20260416125431). SECURITY DEFINER since 20260806130000 for the same reason as its sibling — weight_snapshots denies all client writes, so an INVOKER fan-out that finds any child row aborts the parent INSERT with 42501.';

REVOKE ALL ON FUNCTION public.seed_weight_snapshots_for_portfolio()
  FROM PUBLIC, anon, authenticated;

-- ==========================================================================
-- 3. SELF-VERIFYING BLOCK — fail loud at apply if the repair did not land
-- ==========================================================================

DO $$
DECLARE
  fn                RECORD;
  v_force_rls       BOOLEAN;
  v_table_owner     OID;
  v_insert_cnt      INTEGER;
  v_other_cnt       INTEGER;
  v_deny_cnt        INTEGER;
BEGIN
  -- 3a. BOTH functions exist, are SECURITY DEFINER, and keep a pinned
  --     search_path. CREATE OR REPLACE silently keeps the OLD security context
  --     if the new definition omits the clause, so asserting prosecdef is the
  --     only way to know the repair actually took.
  FOR fn IN
    SELECT unnest(ARRAY[
      'seed_weight_snapshot_for_portfolio_strategy',
      'seed_weight_snapshots_for_portfolio'
    ]) AS name
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = fn.name
    ) THEN
      RAISE EXCEPTION 'seed-secdef migration failed: public.%() not found', fn.name;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = fn.name AND p.prosecdef
    ) THEN
      RAISE EXCEPTION
        'seed-secdef migration failed: public.%() is still SECURITY INVOKER — every authenticated INSERT into portfolio_strategies stays broken', fn.name;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = fn.name
        AND array_to_string(COALESCE(p.proconfig, ARRAY[]::text[]), ';') LIKE '%search_path=%public%'
    ) THEN
      RAISE EXCEPTION
        'seed-secdef migration failed: public.%() is SECURITY DEFINER without a pinned search_path — that is a privilege-escalation surface', fn.name;
    END IF;
  END LOOP;

  -- 3b. SECURITY DEFINER only helps if the definer is actually exempt from the
  --     deny policies. Exemption comes from BYPASSRLS or from owning the table
  --     while it is not FORCE-RLS. Assert the precondition rather than assume
  --     it: if a future migration adds FORCE ROW LEVEL SECURITY to
  --     weight_snapshots, this migration's whole premise evaporates and the
  --     42501 comes back silently.
  SELECT c.relforcerowsecurity, c.relowner
    INTO v_force_rls, v_table_owner
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'weight_snapshots';
  IF v_force_rls IS NULL THEN
    RAISE EXCEPTION 'seed-secdef migration failed: public.weight_snapshots not found';
  END IF;
  IF v_force_rls THEN
    RAISE EXCEPTION
      'seed-secdef migration failed: weight_snapshots has FORCE ROW LEVEL SECURITY — the table owner is NOT exempt, so SECURITY DEFINER does not clear the insert-deny policy';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_roles r ON r.oid = p.proowner
    WHERE n.nspname = 'public'
      AND p.proname IN ('seed_weight_snapshot_for_portfolio_strategy',
                        'seed_weight_snapshots_for_portfolio')
      AND NOT r.rolbypassrls
      AND p.proowner <> v_table_owner
  ) THEN
    RAISE EXCEPTION
      'seed-secdef migration failed: a seed function is owned by a role that neither has BYPASSRLS nor owns weight_snapshots — the DEFINER context would still be blocked by weight_snapshots_insert_deny';
  END IF;

  -- 3c. The deny policies are UNTOUCHED. This migration must not have bought
  --     the fix by weakening the invariant; if a later edit swaps the DEFINER
  --     approach for an INSERT policy, this reddens.
  SELECT count(*) INTO v_deny_cnt
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'weight_snapshots'
     AND policyname IN ('weight_snapshots_insert_deny',
                        'weight_snapshots_update_deny',
                        'weight_snapshots_delete_deny');
  IF v_deny_cnt <> 3 THEN
    RAISE EXCEPTION
      'seed-secdef migration failed: expected the 3 weight_snapshots write-deny policies to survive intact, found % — client writes to derived allocation history must stay impossible', v_deny_cnt;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'weight_snapshots'
       AND policyname = 'weight_snapshots_insert_deny'
       AND COALESCE(with_check, '') <> 'false'
  ) THEN
    RAISE EXCEPTION
      'seed-secdef migration failed: weight_snapshots_insert_deny no longer denies unconditionally';
  END IF;

  -- 3d. Both triggers still exist, are enabled, and stay AFTER INSERT only.
  --     CREATE OR REPLACE keeps trigger bindings, but assert it: a trigger that
  --     was disabled or re-scoped would make the repair a no-op.
  SELECT
    count(*) FILTER (WHERE event_manipulation = 'INSERT'),
    count(*) FILTER (WHERE event_manipulation <> 'INSERT')
    INTO v_insert_cnt, v_other_cnt
  FROM information_schema.triggers
  WHERE trigger_schema = 'public'
    AND trigger_name IN ('portfolio_strategies_seed_weight_snapshot_trigger',
                         'portfolios_seed_weight_snapshots_trigger');
  IF v_insert_cnt <> 2 THEN
    RAISE EXCEPTION
      'seed-secdef migration failed: expected 2 INSERT-scoped seed triggers, found %', v_insert_cnt;
  END IF;
  IF v_other_cnt > 0 THEN
    RAISE EXCEPTION
      'seed-secdef migration failed: a seed trigger fires on % non-INSERT event(s)', v_other_cnt;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname IN ('portfolio_strategies_seed_weight_snapshot_trigger',
                      'portfolios_seed_weight_snapshots_trigger')
       AND NOT tgisinternal
       AND tgenabled = 'D'
  ) THEN
    RAISE EXCEPTION 'seed-secdef migration failed: a seed trigger is DISABLED';
  END IF;

  RAISE NOTICE 'seed_weight_snapshot SECURITY DEFINER repair verified (both functions definer + pinned search_path, owner exempt, 3 deny policies intact, both triggers enabled and INSERT-scoped).';
END $$;

COMMIT;
