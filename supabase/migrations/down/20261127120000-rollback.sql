-- ============================================================================
-- ROLLBACK for 20261127120000_client_role_statement_timeout_pin.sql
-- Phase 243 DBBACKSTOP, plan 02 (DBACC-03).
-- ============================================================================
-- Manual, never auto-applied, off the supabase-migrate.yml path.
--
-- ⛔ THIS FILE DOES NOT RESET EITHER ROLE, AND THAT IS THE POINT. The migration
-- restated values the Supabase platform already sets: anon 3s, authenticated 8s. The
-- platform default and the repo's restatement live in the SAME pg_db_role_setting row,
-- so an `ALTER ROLE ... RESET statement_timeout` would delete both and leave anon with
-- NO statement timeout at all, which is the exposure the pin exists to bound.
--
-- So the statements below restate the platform values. Applying this file is a no-op on
-- the live settings by design. To "undo" the pin, delete the repo's claim (the migration
-- and supabase/tests/test_client_role_timeouts.sql), not the setting.
--
-- ⚠️ THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations.
--
-- ⛔ WHICH DATABASE? Run the marker query FIRST, every time, before this file or any
-- `--linked` command. `current_database()` is `postgres` on both projects and proves
-- nothing:
--   SELECT shobj_description(oid, 'pg_database') AS which_database
--     FROM pg_database WHERE datname = current_database();
-- A NULL answer means the marker was lost: re-set it, do not proceed on a guess.

ALTER ROLE anon SET statement_timeout = '3s';
ALTER ROLE authenticated SET statement_timeout = '8s';

NOTIFY pgrst, 'reload config';
