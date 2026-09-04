-- Additive stand-in for ONE production constraint that 03-fixture-compute-jobs.sql
-- deliberately leaves off: `strategies.api_key_id` is declared there as a bare
-- `UUID` (:59), because the compute-jobs family only needs the column to exist.
-- Production declares it with its referential action —
-- `api_key_id UUID REFERENCES api_keys ON DELETE SET NULL`
-- (20260405061911_initial_schema.sql:51), and that migration is in no apply list
-- (it seeds a dozen unrelated subsystems and pulls the whole chain in).
--
-- ⛔ WHY IT IS NOT COSMETIC. `test_strategy_keys_publish_integrity.sql`'s Part 4
-- is the SC-4 arm: deleting a PUBLISHED SINGLE-KEY strategy's key must be
-- ALLOWED — the guard is scoped to strategy_keys membership — and the link must
-- then be `SET NULL` by the pre-existing FK. Without the referential action the
-- delete succeeds but `strategies.api_key_id` keeps pointing at a row that no
-- longer exists, and the arm reddens on the FK rather than on the guard
-- (MEASURED 2026-09-04: `TEST FAILED (Part 4): strategies.api_key_id was not SET
-- NULL after the single-key delete`).
--
-- ⚠️ SCOPE. Kept in its own file rather than folded into 03-fixture-compute-jobs.sql
-- on purpose: that fixture is in a dozen apply lists whose gates seed
-- `strategies.api_key_id` values with no matching `api_keys` row, and a
-- retro-fitted FK would abort their seeds. Apply AFTER 03 (which supplies both
-- the column and the `api_keys` primary key). It carries no arm: the object under
-- test is the delete guard, not this constraint.
ALTER TABLE public.strategies DROP CONSTRAINT IF EXISTS strategies_api_key_id_fkey;
ALTER TABLE public.strategies
  ADD CONSTRAINT strategies_api_key_id_fkey
  FOREIGN KEY (api_key_id) REFERENCES public.api_keys(id) ON DELETE SET NULL;
