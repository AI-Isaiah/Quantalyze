-- Additive stand-ins that let the REAL `20260405061912_rls_policies.sql` be the
-- thing under test for `test_strategies_private_owner_isolation.sql`'s RLS arms,
-- instead of 01-fixture-core.sql's narrower stand-in policy. Apply AFTER
-- 01/02/03 and BEFORE 20260405061912. Never a second base: 01-fixture-core.sql
-- remains the only destructive fixture.
--
-- ⭐ WHY THE STAND-IN POLICY IS DROPPED, AND WHY THAT IS THE ANTI-VACUITY MOVE.
-- 01-fixture-core.sql:58-60 declares `CREATE POLICY strategies_read ON strategies
-- FOR SELECT TO authenticated USING (...)`. Production's definition
-- (20260405061912_rls_policies.sql:28-30) carries NO role restriction, so `anon`
-- IS covered by it. Keeping the stand-in would leave `anon` with no policy at
-- all, and the gate's `RLS 4: anon sees 0 rows for the private strategy` arm
-- would pass because anon can never see ANY row — a vacuous PASS, unfalsifiable
-- by any mutation of the policy the arm names. Dropping the stand-in lets the
-- real migration define the object the arm asserts on.
DROP POLICY IF EXISTS strategies_read ON strategies;

-- ⭐ GRANTS, and why they are not cosmetic either. MEASURED 2026-09-03 on this
-- gate: with 01-fixture-core.sql's `GRANT SELECT ON strategies, profiles TO
-- authenticated` as the only grant, the file still printed `ALL PASS` — but
-- GUARD 6's UPDATE and GUARD 7's INSERT were refused by the *grant* layer with
-- 42501, which is the very SQLSTATE those arms catch and read as proof that the
-- `guard_strategies_publish_transition` TRIGGER fired. Both arms passed for a
-- reason unrelated to the trigger, and `anon` held no SELECT at all so RLS 4 was
-- vacuous too. In production `strategies` is created by
-- 20260405061911_initial_schema.sql under Supabase's project-bootstrap default
-- privileges (the ones 07-fixture-supabase-default-privileges.sql reproduces,
-- which are NOT retroactive to a table 01-fixture-core.sql already created), so
-- all three API roles hold table privileges and RLS + the trigger are the only
-- things that can refuse a write. That is the state these grants restore.
GRANT ALL ON strategies TO anon, authenticated, service_role;

-- strategies.source — 20260411103316_wizard_source_column.sql adds it in
-- production. That migration is NOT in the apply list: nothing under test here
-- is defined by it. The gate seeds a `source='wizard'` draft for the GUARD 5
-- finalize call.
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS source TEXT;

-- profiles.created_at — read by the `public_profiles` view that
-- 20260405061912_rls_policies.sql:17-19 creates. Not an object under test.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;

-- Empty stand-ins for the three relations 20260405061912 enables RLS on and
-- writes policies for, that no fixture in the list creates. Column sets are only
-- what that migration's own policy predicates name — nothing else. These tables
-- carry no arm: the gate never reads them.
CREATE TABLE IF NOT EXISTS discovery_categories (
  id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT
);
CREATE TABLE IF NOT EXISTS contact_requests (
  allocator_id UUID,
  strategy_id  UUID
);
CREATE TABLE IF NOT EXISTS portfolio_strategies (
  portfolio_id UUID,
  strategy_id  UUID
);
