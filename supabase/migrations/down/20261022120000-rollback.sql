-- ============================================================================
-- ROLLBACK for 20261022120000_strategies_anon_api_key_id_revoke.sql
-- Phase 170.6.1.1 ANONKEYID, plan 06 (O-1 / D-05).
-- ============================================================================
-- Manual, off the auto-apply path. Restores the table-level privileges anon held on
-- public.strategies immediately before the migration: SELECT, INSERT, UPDATE and
-- DELETE. REFERENCES was never removed, so it is not touched. authenticated and
-- service_role are not touched either: the migration did not move them.
--
-- ⛔ APPLYING THIS FILE REOPENS TWO EXPOSURES. (1) anon can SELECT
-- public.strategies.api_key_id again: a key id is the handle that targets an
-- exchange key, and row-level security never restricts columns. (2) anon holds
-- INSERT, UPDATE and DELETE on public.strategies again, so row-level security is the
-- only layer between a visitor holding the publishable key and a write. Run it only
-- to undo the migration deliberately, and re-apply the migration afterwards.
--
-- Safe for the readers. Every anonymous strategies reader was narrowed to
-- STRATEGY_PUBLIC_COLUMNS (PR-A) and works under either grant shape, so rolling back
-- needs no reader change, and re-applying the migration later needs none either (O-1).
--
-- WHY A TABLE-LEVEL REVOKE FIRST. The migration granted anon column-level SELECT on
-- every column but api_key_id. A table-level GRANT SELECT on top of those would
-- leave the column grants standing as extra ACL entries. `REVOKE SELECT ON TABLE`
-- first clears the table-level privilege and every column-level SELECT grant on the
-- table, so the state afterwards is exactly the pre-migration table-level state and
-- nothing is left over to surprise the re-apply.
--
-- ⚠️ THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations. To re-apply the migration after running
-- this rollback, delete that ledger row in the same change (or
-- `supabase migration repair --status reverted 20261022120000` against the
-- intended database).
--
-- ⛔ WHICH DATABASE? Run the marker query FIRST, every time, before this file or
-- any `--linked` command. `current_database()` is `postgres` on both projects and
-- proves nothing:
--   SELECT shobj_description(oid, 'pg_database') AS which_database
--     FROM pg_database WHERE datname = current_database();
-- A NULL answer means the marker was lost: re-set it, do not proceed on a guess.
--
-- The closing DO block raises unless anon again holds table-level SELECT, INSERT,
-- UPDATE and DELETE and can read api_key_id. The whole file is one transaction, so a
-- failed check changes nothing.

BEGIN;
SET LOCAL lock_timeout = '5s';

REVOKE SELECT ON TABLE public.strategies FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.strategies TO anon;

DO $verify$
DECLARE
  v_rel regclass := 'public.strategies'::regclass;
  v_verb text;
BEGIN
  FOREACH v_verb IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
    IF NOT has_table_privilege('anon', v_rel, v_verb) THEN
      RAISE EXCEPTION 'rollback 20261022120000 failed: anon does not hold table-level % on public.strategies after the re-grant', v_verb;
    END IF;
  END LOOP;

  IF NOT has_column_privilege('anon', v_rel, 'api_key_id', 'SELECT') THEN
    RAISE EXCEPTION 'rollback 20261022120000 failed: anon cannot SELECT public.strategies.api_key_id after the re-grant';
  END IF;
END
$verify$;

COMMIT;
