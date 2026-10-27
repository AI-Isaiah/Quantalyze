-- STAND-IN (lane-only): the production constraint `api_keys.user_id` REFERENCES
-- `public.profiles(id)` ON DELETE CASCADE. Phase 171 READCEILING, plan 03 (T-171-09).
--
-- WHAT IT MIRRORS, by object name, from supabase/schema/baseline.sql (locate by name,
-- never by line: release PRs re-dump the file): constraint `api_keys_user_id_fkey` on
-- public.api_keys. 02-fixture-sanitize-tables.sql declares `api_keys` as a bare
-- `(user_id UUID)` stub and 03-fixture-compute-jobs.sql adds the columns the
-- compute-jobs family needs, none of which is this foreign key. 01-fixture-core.sql
-- DOES model `profiles.id` REFERENCES `auth.users` ON DELETE CASCADE, so with this
-- file the production deletion chain (auth user -> profile -> api key) is complete on
-- the throwaway cluster.
--
-- WHY IT IS NOT COSMETIC. A gate that proves "this table's rows go when the ACCOUNT
-- is deleted" through a table that hangs off `api_keys` (not off `auth.users`
-- directly) can only observe the erasure if the chain is whole. Without this file the
-- account is deleted, the api key survives, and the arm reddens on the fixture rather
-- than on the table under test (MEASURED 2026-10-27, test_allocator_trade_reads.sql
-- arm 3: `1 state row(s) outlived their account`, baseline run, pg-lane only).
--
-- ⚠️ SCOPE. Kept in its own file, like 26-fixture-strategies-api-key-fk.sql, because
-- the many apply lists that carry 02/03 seed `api_keys` rows whose `user_id` has no
-- matching `profiles` row, and a retro-fitted foreign key would abort their seeds.
-- Apply it only in a gate that seeds a profile for every api key it creates. Apply
-- AFTER the migrations that seed api_keys rows, not before: 20260420073003_allocator_holdings.sql
-- seeds `api_keys` rows whose `user_id` names no profile, and the foreign key would abort
-- it (MEASURED 2026-10-27: 23503 at that file). It carries no arm.
ALTER TABLE public.api_keys DROP CONSTRAINT IF EXISTS api_keys_user_id_fkey;
ALTER TABLE public.api_keys
  ADD CONSTRAINT api_keys_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
