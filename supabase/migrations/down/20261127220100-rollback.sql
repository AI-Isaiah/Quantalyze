-- ============================================================================
-- ROLLBACK for 20261127220100_api_keys_insert_fence.sql
-- Phase 243 DBBACKSTOP, plan 10 (DBACC-02).
-- ============================================================================
-- Manual, never auto-applied, off the supabase-migrate.yml path.
--
-- ⛔ IT REOPENS DIRECT ADMIN-CLIENT INSERTS WITH A REQUEST-SUPPLIED user_id. Once the fence
-- is dropped, any service_role caller can mint an api_keys row under any user_id again;
-- only the audited writers and plan 05's api_keys_user_id_immutable trigger (which stops a
-- key from being repointed) remain. Run this only as a deliberate, recorded decision.
--
-- ⚠️ THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations, so a later `db push --include-all` does not
-- re-apply the fence by itself.
--
-- ⛔ WHICH DATABASE? Run the marker query FIRST, every time, before this file or any
-- `--linked` command. `current_database()` is `postgres` on both projects and proves
-- nothing:
--   SELECT shobj_description(oid, 'pg_database') AS which_database
--     FROM pg_database WHERE datname = current_database();
-- A NULL answer means the marker was lost: re-set it, do not proceed on a guess.

DROP TRIGGER api_keys_insert_writer_fence ON public.api_keys;
DROP FUNCTION public.enforce_api_keys_insert_writer_fence();
