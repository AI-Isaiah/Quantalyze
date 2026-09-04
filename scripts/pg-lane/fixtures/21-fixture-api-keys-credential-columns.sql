-- Additive stand-ins for the remaining `api_keys` CREDENTIAL columns that the
-- wizard RPC bodies write. Apply AFTER 03-fixture-compute-jobs.sql, which gives
-- `api_keys` its primary key, `label` and `api_key_encrypted`.
--
-- WHY THESE FIVE AND NOT MORE. `add_wizard_composite_key` and
-- `create_wizard_strategy` (supabase/migrations/20260710180000_wizard_composite.sql,
-- re-based by 20260813150106) both INSERT the same explicit column list:
--     user_id, exchange, label,
--     api_key_encrypted, api_secret_encrypted, passphrase_encrypted,
--     dek_encrypted, nonce, kek_version, is_active, attested_venue
-- Every name on that list except the five below is already supplied — by
-- 02-fixture-sanitize-tables.sql (`user_id`), 03-fixture-compute-jobs.sql
-- (`exchange`, `is_active`, `label`, `api_key_encrypted`) or the REAL migration
-- 20260811210000_api_keys_attested_venue.sql (`attested_venue`). MEASURED on the
-- lane 2026-09-04: without this file the gate dies at
-- `42703 column "api_secret_encrypted" of relation "api_keys" does not exist`,
-- inside that INSERT — so the set is read off the failure, not guessed.
--
-- ⚠️ STAND-IN, NOT THE SCHEMA. Types are the widest thing the RPC parameters
-- can carry, because nothing in the wizard gate family asserts anything ABOUT
-- these columns — they exist so the RPC's INSERT parses and runs. The objects
-- under test are the RPC bodies, their role gate and their grants, all of which
-- come from the real migrations. `attested_venue` is deliberately NOT here: it
-- IS asserted (Part 3d reads it back through the scrub trigger), so it must
-- come from 20260811210000, which also brings the
-- api_keys_attested_venue_matches_exchange CHECK the assertion depends on.
ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS api_secret_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS passphrase_encrypted TEXT,
  ADD COLUMN IF NOT EXISTS dek_encrypted        TEXT,
  ADD COLUMN IF NOT EXISTS nonce                TEXT,
  ADD COLUMN IF NOT EXISTS kek_version          INTEGER;
