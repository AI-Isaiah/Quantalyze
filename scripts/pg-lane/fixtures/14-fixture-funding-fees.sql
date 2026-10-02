-- Additive stand-ins for `test_funding_fees_rls.sql`. Apply AFTER 01/02/03 and
-- BEFORE 20260416081039_funding_fees.sql. Never a second base.
--
-- The objects under test are the REAL `funding_fees` table and its REAL four
-- policies, created by the REAL migration in the apply list. Everything here is
-- scaffold that migration's STEP 4 and STEP 5 name and that no fixture already
-- provides; nothing here carries an arm.

-- positions — 20260416081039 STEP 4 does `ALTER TABLE positions ADD COLUMN IF
-- NOT EXISTS funding_pnl NUMERIC NOT NULL DEFAULT 0`, and its self-verify then
-- asserts that column exists and is NOT NULL. Only the columns that ALTER and
-- that assertion name are provided; the gate never reads this table.
CREATE TABLE IF NOT EXISTS public.positions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id UUID REFERENCES public.strategies ON DELETE CASCADE,
  symbol      TEXT
);

-- compute_job_kinds — 20260416081039 STEP 5 registers the `sync_funding` kind
-- and its self-verify reads the row back. `name` is the PK in production
-- (migration 032), which is what makes the migration's ON CONFLICT idempotent.
CREATE TABLE IF NOT EXISTS public.compute_job_kinds (
  name TEXT PRIMARY KEY
);

-- ⭐ api_keys table grants. In production `api_keys` is created by
-- 20260405061911_initial_schema.sql under Supabase's project-bootstrap default
-- privileges, so all three API roles hold table privileges on it; on the lane it
-- is created by 02-fixture-sanitize-tables.sql BEFORE
-- 07-fixture-supabase-default-privileges.sql runs, and ALTER DEFAULT PRIVILEGES
-- is not retroactive. Restoring the grant is what lets a MUTATED
-- funding_fees_read that joins through the api-key owner be evaluated at all:
-- without it the policy sub-select is refused 42501 and the arm scores
-- NO-IDENTITY instead of RED. The baseline policy never reads api_keys, so this
-- changes nothing a green run observes.
GRANT ALL ON public.api_keys TO anon, authenticated, service_role;
