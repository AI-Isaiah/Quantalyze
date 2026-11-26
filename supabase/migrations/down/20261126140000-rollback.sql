-- ============================================================================
-- ROLLBACK for 20261126140000_mt5_terminal_lease.sql
-- Phase 230 MT5NIGHTLY, plan 01 (MT5D-02).
-- ============================================================================
-- Manual, off the auto-apply path. Run it as ONE transaction, so it either happens
-- whole or not at all (this file carries no transaction statements, like a migration):
--
--   psql --single-transaction -v ON_ERROR_STOP=1 -f <this file>
--
-- against the database the marker query in CLAUDE.md names. Run that query FIRST:
--
--   SELECT shobj_description(oid, 'pg_database') AS which_database
--     FROM pg_database WHERE datname = current_database();
--
-- current_database() is `postgres` on BOTH projects and proves nothing; if the marker is
-- NULL, re-set it before running anything here.
--
-- What this file undoes: it drops public.acquire_mt5_terminal_lease(text, uuid, text,
-- text, integer), public.renew_mt5_terminal_lease(text, uuid, integer),
-- public.release_mt5_terminal_lease(text, uuid) and the table public.mt5_terminal_leases.
-- The table holds one row per terminal and nothing else (no user data, no history), so
-- dropping it loses only the current lease state, which a restarted worker rebuilds by
-- acquiring again.
--
-- ORDER WITH THE WORKERS. This file does NOT need the analytics services rolled back
-- first. The Python lease client (plan 04) treats a missing lease RPC (SQLSTATE 42883, or
-- the PostgREST spelling PGRST202 for a function absent from its schema cache) as "use
-- the in-process lock only" and says so loudly in the log, which is the behaviour before
-- this phase. A lease held at the moment of the drop simply stops being enforced across
-- processes.
--
-- ⚠️ THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations, so after it runs the ledger still records
-- version 20261126140000 as applied while the schema no longer carries the objects, and
-- `supabase db push` will not re-apply the migration. To re-apply it, delete that ledger
-- row in the same change (or mark it reverted with
-- `supabase migration repair --status reverted 20261126140000` against the intended
-- database, after the marker query above names that database).
-- ============================================================================

SET LOCAL lock_timeout = '3s';

-- ───────────── precondition — CATALOGUE ONLY, reads no row
DO $precondition$
BEGIN
  IF to_regprocedure('public.acquire_mt5_terminal_lease(text,uuid,text,text,integer)') IS NULL
     OR to_regprocedure('public.renew_mt5_terminal_lease(text,uuid,integer)') IS NULL
     OR to_regprocedure('public.release_mt5_terminal_lease(text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261126140000 refused: one of the three MT5 terminal lease functions is not present, so this database does not carry 20261126140000 whole. Nothing was changed. Run the marker query in CLAUDE.md to see which database this is.';
  END IF;
END
$precondition$;

DROP FUNCTION public.acquire_mt5_terminal_lease(text, uuid, text, text, integer);
DROP FUNCTION public.renew_mt5_terminal_lease(text, uuid, integer);
DROP FUNCTION public.release_mt5_terminal_lease(text, uuid);
DROP TABLE public.mt5_terminal_leases;

-- ───────────── verify — CATALOGUE ONLY, reads no row
DO $verify$
BEGIN
  IF to_regprocedure('public.acquire_mt5_terminal_lease(text,uuid,text,text,integer)') IS NOT NULL
     OR to_regprocedure('public.renew_mt5_terminal_lease(text,uuid,integer)') IS NOT NULL
     OR to_regprocedure('public.release_mt5_terminal_lease(text,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 20261126140000 failed: a lease function still resolves';
  END IF;
  IF to_regclass('public.mt5_terminal_leases') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 20261126140000 failed: public.mt5_terminal_leases still resolves';
  END IF;

  RAISE NOTICE 'Rollback 20261126140000: the three lease functions and public.mt5_terminal_leases dropped. The migration ledger row is left in place (see the header).';
END
$verify$;
