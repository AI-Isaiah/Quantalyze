-- Referenced by supabase/tests/test_resync_retry_single_job.sql's
-- `RED-UNDER-SETUP` apply list, which is PROVEN GREEN with it (exit 0) and
-- whose three arms all scored `RED (identity ok)` on real lanes, 2026-09-04.
--
-- Additive stand-ins for the columns the two migrations that carry the
-- 9-argument `enqueue_compute_job` forward touch on their way past. Apply AFTER
-- 02-fixture-sanitize-tables.sql and 03-fixture-compute-jobs.sql. Never a
-- second base.
--
-- WHY THIS FILE EXISTS — a RULE-2 requirement, not padding.
-- `20260515210300_scoring_weight_overrides_high_hardening.sql` is the LAST
-- migration that defines `enqueue_compute_job`, the RPC
-- test_resync_retry_single_job.sql assertion (a) calls twice; it builds on the
-- 9-arg body first installed by `20260420073003_allocator_holdings.sql`. Phase
-- 164.4's authoring rule 2 requires a twin to mutate the LAST-defining
-- migration, and the lane must therefore run the body those two install — not
-- the 6-arg one from 20260411144407, whose dedup RETURN behaviour is exactly
-- what assertion (a) pins.
--
-- Both migrations do unrelated hardening on the way. MEASURED on the lane
-- 2026-09-04, one column per observed failure — read off the error, not guessed:
--   * `allocator_preferences.scoring_weight_overrides` —
--     `20260515210300…:192 ERROR 42703 column "scoring_weight_overrides" does
--     not exist`, from its coerce-then-CHECK hardening step. JSONB is the type
--     its own `_scoring_weight_overrides_is_valid(jsonb)` validator takes.
--   * `api_keys.sync_error` — `20260420073003…:315 ERROR 42703 column
--     "sync_error" of relation "api_keys" does not exist`, from the
--     sync_status extension that migration's header calls Landmine 2.
--     03-fixture-compute-jobs.sql already carries its sibling `sync_status`.
--
-- ⚠️ STAND-INS, NOT THE SCHEMA. No arm in any gate using this file asserts
-- anything about `allocator_preferences` or about `api_keys.sync_error`; they
-- are scaffold that lets the two migrations apply so the enqueue_compute_job
-- body under test is the deployed one.
--
-- ⓘ 20260420073003 needs no pg_cron help: its STEP 8 schedule is already gated
-- behind `IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')` and
-- takes the `RAISE NOTICE … skipping schedule (local dev)` arm on this lane.
ALTER TABLE allocator_preferences
  ADD COLUMN IF NOT EXISTS scoring_weight_overrides JSONB;

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS sync_error TEXT;
