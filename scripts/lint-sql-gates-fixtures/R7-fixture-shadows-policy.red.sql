-- RED FIXTURE for R7-fixture-shadows-policy (mechanism 6).
--
-- ⭐ THIS IS THE SECOND MEASURED INSTANCE. The apply list below is the
-- PRE-REPAIR shape of
-- `supabase/tests/test_strategies_private_owner_isolation.sql`, reduced to the
-- two entries that carry the defect. Both files are the REAL ones.
--
--   `scripts/pg-lane/fixtures/01-fixture-core.sql:58` declares
--   `CREATE POLICY strategies_read ON strategies FOR SELECT TO authenticated
--   USING (...)`. `supabase/migrations/20260405061912_rls_policies.sql:28`
--   creates a policy of the SAME NAME on the SAME TABLE with NO role
--   restriction, so production's version covers `anon` and the stand-in does
--   not. CREATE POLICY has no IF NOT EXISTS: the migration's statement raises
--   42710 and is skipped, the stand-in stays in force, and the gate's
--   `RLS 4: anon sees 0 rows for the private strategy` arm passes because anon
--   can never see ANY row — a vacuous PASS, unfalsifiable by any mutation of
--   the policy the arm names.
--
-- The repair, and the escape this rule honours, is the fixture-10 idiom:
-- `scripts/pg-lane/fixtures/10-fixture-strategies-rls-baseline.sql:16` carries
-- `DROP POLICY IF EXISTS strategies_read ON strategies;` between the two, which
-- is exactly the difference between this file and its green twin. Read that
-- fixture's header (:7-16) — it is the specification this rule was written
-- from, and it names the move "the anti-vacuity move".
--
-- ⚠️ SCOPE, STATED. This rule detects the NAME COLLISION. It does NOT detect
-- the other half of fixture 10's finding — the missing GRANTs that let GUARD 6
-- and GUARD 7 catch a 42501 raised by the privilege layer rather than by the
-- trigger they name. Privilege sufficiency is a property of the running
-- cluster, not of the text, and no static rule reaches it.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","supabase/migrations/20260405061912_rls_policies.sql"]}

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'strategies_read') THEN
    RAISE EXCEPTION 'TEST FAILED (FIXTURE R7): strategies_read policy does not exist';
  END IF;
END $$;

COMMIT;
