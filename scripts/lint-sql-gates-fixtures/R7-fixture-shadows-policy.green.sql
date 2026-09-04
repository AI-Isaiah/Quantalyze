-- GREEN FIXTURE for R7-fixture-shadows-policy — the repaired idiom, quoted
-- VERBATIM from
-- `supabase/tests/test_strategies_private_owner_isolation.sql:44`.
--
-- The one difference from the red twin is
-- `scripts/pg-lane/fixtures/10-fixture-strategies-rls-baseline.sql`, which sits
-- between 01-fixture-core's stand-in policy and 20260405061912 and carries
-- `DROP POLICY IF EXISTS strategies_read ON strategies;` (:16). The stand-in is
-- gone before the migration runs, so production's role-unrestricted
-- `strategies_read` is the definition the RLS arms measure — including the
-- `anon` case, which the stand-in's `TO authenticated` had made unfalsifiable.
--
-- ⚠️ This list is the real one and is NOT reduced: the three later strategies
-- migrations stay in it, so the "repaired idiom" claim holds for the apply list
-- the gate actually runs rather than for a trimmed version of it.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/10-fixture-strategies-rls-baseline.sql","supabase/migrations/20260405061912_rls_policies.sql","supabase/migrations/20260716130000_strategies_status_private.sql","supabase/migrations/20260716130500_finalize_terminal_status_param.sql","supabase/migrations/20260716131000_guard_strategies_publish_transition.sql"]}

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'strategies_read') THEN
    RAISE EXCEPTION 'TEST FAILED (FIXTURE R7): strategies_read policy does not exist';
  END IF;
END $$;

COMMIT;
