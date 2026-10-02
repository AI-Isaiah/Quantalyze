-- Additive stand-ins for `test_csv_finalize_atomic_fold.sql`. Apply AFTER
-- 01/02/03 and BEFORE the csv_daily_returns + fold migrations. Never a second
-- base: 01-fixture-core.sql remains the only destructive fixture.
--
-- WHAT IS UNDER TEST HERE, AND WHAT IS SCAFFOLD. The object under test is the
-- REAL `finalize_csv_strategy_with_returns` from the REAL chain
-- 20260819120000 -> 20260819130000 -> 20260819151000, all three of which are in
-- the apply list. Everything this file adds is scaffold those migrations' own
-- pre-flight and the gate's seeds name, and NOTHING it adds carries an arm.
--
-- strategies columns the fold's own INSERT names (20260819151000:393-403) and
-- that 20260728120000's STEP 0 duplicate probe and STEP 1 composite unique
-- index key on. 01-fixture-core.sql created `strategies` before any of those
-- migrations existed, so it has neither column.
ALTER TABLE strategies
  ADD COLUMN IF NOT EXISTS source            TEXT,
  ADD COLUMN IF NOT EXISTS wizard_session_id UUID,
  ADD COLUMN IF NOT EXISTS description       TEXT,
  ADD COLUMN IF NOT EXISTS created_at        TIMESTAMPTZ NOT NULL DEFAULT now();

-- ⭐ WHY THE SIGNUP TRIGGER IS HERE AND NOT LEFT OUT. `strategies.user_id`
-- REFERENCES `profiles` in production too (20260405061911:21), and every arm of
-- this gate seeds ONLY `auth.users` — it relies on production's
-- `on_auth_user_created` trigger (20260405061912:72-83) to mint the matching
-- profiles row. Without it the fold's strategies INSERT dies 23503 on EVERY
-- part, including the parts whose whole claim is that the call was refused
-- BEFORE any write: Part 6's guards would then "pass" on a foreign-key failure
-- rather than on the guard, which is the vacuity class this phase exists to
-- remove. The trigger is a stand-in for that production behaviour; it carries no
-- arm and 20260405061912 is not in the apply list because nothing under test is
-- defined by it.
CREATE OR REPLACE FUNCTION public._fixture_handle_new_user()
 RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $f$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $f$;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public._fixture_handle_new_user();

-- strategy_verifications — the fold's SECOND write. Column set is exactly what
-- the fold's INSERT names (20260819151000:411-417) plus the primary key; the
-- gate only ever COUNTS rows here, so nothing else is required and nothing else
-- is provided.
CREATE TABLE IF NOT EXISTS public.strategy_verifications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id       UUID REFERENCES public.strategies ON DELETE CASCADE,
  wizard_session_id UUID,
  status            TEXT,
  trust_tier        TEXT,
  flow_type         TEXT,
  source            TEXT,
  errors            JSONB,
  correlation_id    UUID
);

-- The gate reads all three tables as the caller role after finalizing, so the
-- API roles need table privileges. 07-fixture-supabase-default-privileges.sql's
-- ALTER DEFAULT PRIVILEGES are NOT retroactive to `strategies`, which
-- 01-fixture-core.sql already created.
GRANT ALL ON public.strategies              TO anon, authenticated, service_role;
GRANT ALL ON public.strategy_verifications  TO anon, authenticated, service_role;
