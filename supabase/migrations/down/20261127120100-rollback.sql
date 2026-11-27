-- ============================================================================
-- ROLLBACK for 20261127120100_insert_api_key_rpc_and_user_id_immutable.sql
-- Phase 243 DBBACKSTOP, plan 05 (DBACC-02).
-- ============================================================================
-- Manual, never auto-applied, off the supabase-migrate.yml path.
--
-- ⛔ NEVER RUN THIS ONCE PR-B's ROUTE IS DEPLOYED. From PR-B on, the validate-and-encrypt
-- route (and the seeds and e2e helpers) call public.insert_api_key. Dropping it makes every
-- key connect answer PGRST202 until the function is restored. Before PR-B this file is safe:
-- nothing calls the function.
--
-- ⚠️ THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations.
--
-- Dropping the trigger re-opens api_keys.user_id to any role that can UPDATE it (the table
-- owner and BYPASSRLS service_role). Nothing legitimate updates it, so this loses no
-- function, only the protection.
--
-- ⛔ WHICH DATABASE? Run the marker query FIRST, every time, before this file or any
-- `--linked` command. `current_database()` is `postgres` on both projects and proves
-- nothing:
--   SELECT shobj_description(oid, 'pg_database') AS which_database
--     FROM pg_database WHERE datname = current_database();
-- A NULL answer means the marker was lost: re-set it, do not proceed on a guess.

DROP TRIGGER IF EXISTS api_keys_user_id_immutable ON public.api_keys;
DROP FUNCTION IF EXISTS public.enforce_api_keys_user_id_immutable();
DROP FUNCTION IF EXISTS public.insert_api_key(
  uuid, text, text, text, text, text, text, text, integer, text, text, uuid
);
