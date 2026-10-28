-- ============================================================================
-- ROLLBACK for 20261101120000_api_key_flow_prices.sql
-- Phase 177 DERIBITFLOWS, plan 02 (SC-3; D-05, FP-6).
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
-- NULL, re-set it before running anything here. What this file undoes:
--   1. Withdraws every table privilege from every role, service_role included, so
--      nothing but the table owner can read or write the kept rows.
--   2. RENAMES the table, and the primary key it owns, aside to *_rolled_back_20261101.
--      The renames are what let the migration be applied again afterwards without a
--      name collision.
--
-- Run it only AFTER the analytics worker that reads and writes this table has been
-- rolled back. Otherwise the worker's store read fails on a missing relation (which it
-- treats as a transient retry, so it never prices a flow without the store).
--
-- ⚠️ DATA IS KEPT (FP-6). This file never removes a table. The rows are a re-derivable
-- cache of public prices, and a plain removal would also be defensible, but it is a
-- founder decision and no part of this file. The rows stay in
-- public.api_key_flow_prices_rolled_back_20261101 (table owner access only), and they
-- still go when their key or their account is deleted, because the foreign key and its
-- cascade are untouched. To get them back after re-applying the migration, copy them
-- across with an INSERT ... SELECT run by the table owner.
--
-- ⚠️ THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations, so after it runs the ledger still records
-- version 20261101120000 as applied while the schema no longer carries it, and
-- `supabase db push` will not re-apply the migration. To re-apply it, delete that
-- ledger row in the same change (or mark it reverted with
-- `supabase migration repair --status reverted 20261101120000` against the intended
-- database, after the marker query above names that database).
--
-- The DO block before the change is a catalogue-only PRECONDITION: it refuses, before
-- anything changes, on a database that does not carry the migration and on one where an
-- earlier rollback already set the table aside. The DO block after the change is
-- catalogue-only too and aborts the whole rollback if the table still resolves under its
-- own name or the renamed table is missing. Neither reads a row.
-- ============================================================================

SET LOCAL lock_timeout = '3s';

-- ───────────── precondition — CATALOGUE ONLY, reads no row
DO $precondition$
BEGIN
  IF to_regclass('public.api_key_flow_prices') IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261101120000 refused: public.api_key_flow_prices is not present, so this database does not carry 20261101120000. Nothing was changed. Run the marker query in CLAUDE.md to see which database this is.';
  END IF;
  IF to_regclass('public.api_key_flow_prices_rolled_back_20261101') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 20261101120000 refused: public.api_key_flow_prices_rolled_back_20261101 already exists, so an earlier rollback already set the table aside. Nothing was changed. Decide what to do with the kept rows first.';
  END IF;
END
$precondition$;

-- 1. Access: no role but the table owner can touch the kept rows.
REVOKE ALL ON TABLE public.api_key_flow_prices FROM PUBLIC, anon, authenticated, service_role;

-- 2. Set the table, and the schema-level name it owns, aside. Renaming a constraint
--    renames the index behind it. Nothing is dropped.
ALTER TABLE public.api_key_flow_prices RENAME TO api_key_flow_prices_rolled_back_20261101;
ALTER TABLE public.api_key_flow_prices_rolled_back_20261101
  RENAME CONSTRAINT api_key_flow_prices_pkey TO api_key_flow_prices_pkey_rolled_back_20261101;

-- ───────────── verify — CATALOGUE ONLY, reads no row
DO $verify$
BEGIN
  IF to_regclass('public.api_key_flow_prices') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 20261101120000 failed: public.api_key_flow_prices still resolves';
  END IF;
  IF to_regclass('public.api_key_flow_prices_rolled_back_20261101') IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261101120000 failed: public.api_key_flow_prices_rolled_back_20261101 is missing, so the kept rows are not where this file says they are';
  END IF;

  RAISE NOTICE 'Rollback 20261101120000: api_key_flow_prices is set aside as api_key_flow_prices_rolled_back_20261101 with every stored row kept and access withdrawn from every role. The migration ledger row is left in place (see the header).';
END
$verify$;
