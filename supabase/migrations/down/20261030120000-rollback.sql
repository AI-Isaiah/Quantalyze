-- ============================================================================
-- ROLLBACK for 20261030120000_allocator_trade_reads.sql
-- Phase 171 READCEILING, plan 03 (SC-1; D-02, TR-7).
-- ============================================================================
-- Manual, off the auto-apply path. Run it as ONE transaction, so it either happens
-- whole or not at all (this file carries no transaction statements, like a migration):
--
--   psql --single-transaction -v ON_ERROR_STOP=1 -f <this file>
--
-- against the database the marker query in CLAUDE.md names. What it undoes:
--   1. Withdraws every table privilege from every role, service_role included, so
--      nothing but the table owner can read or write the kept rows.
--   2. RENAMES both tables, and the primary keys they own, aside to
--      *_rolled_back_20261030. The renames are what let the migration be applied
--      again afterwards without a name collision.
--
-- Run it only AFTER the analytics worker that writes these tables has been rolled
-- back. Otherwise the worker's store calls fail on a missing relation (the worker
-- reads without the store when the tables are absent, but a worker that is mid-write
-- when the rename lands fails that one write).
--
-- ⚠️ DATA IS KEPT (TR-7). This file never removes a table. The rows are transient
-- (they expire after 7 days) and a plain removal would also be defensible, but it is a
-- founder decision and no part of this file. The rows stay in
-- public.allocator_trade_reads_rolled_back_20261030 and
-- public.allocator_trade_read_windows_rolled_back_20261030 (table owner access only),
-- and they still go when their key or their account is deleted, because both foreign
-- keys and their ON DELETE CASCADE are untouched. To get them back after re-applying
-- the migration, copy them across with an INSERT ... SELECT run by the table owner.
--
-- ⚠️ THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations, so after it runs the ledger still records
-- version 20261030120000 as applied while the schema no longer carries it, and
-- `supabase db push` will not re-apply the migration. To re-apply it, delete that
-- ledger row in the same change (or mark it reverted with
-- `supabase migration repair --status reverted 20261030120000` against the intended
-- database, after the marker query in CLAUDE.md names that database).
--
-- The DO block before the change is a catalogue-only PRECONDITION: it refuses, before
-- anything changes, on a database that does not carry the migration and on one where an
-- earlier rollback already set a table aside. The DO block after the change is
-- catalogue-only too and aborts the whole rollback if either table still resolves under
-- its own name or a renamed table is missing. Neither reads a row.
-- ============================================================================

SET LOCAL lock_timeout = '3s';

-- ───────────── precondition — CATALOGUE ONLY, reads no row
DO $precondition$
BEGIN
  IF to_regclass('public.allocator_trade_reads') IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261030120000 refused: public.allocator_trade_reads is not present, so this database does not carry 20261030120000. Nothing was changed. Run the marker query in CLAUDE.md to see which database this is.';
  END IF;
  IF to_regclass('public.allocator_trade_read_windows') IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261030120000 refused: public.allocator_trade_read_windows is not present, so this database does not carry 20261030120000 whole. Nothing was changed. Run the marker query in CLAUDE.md to see which database this is.';
  END IF;
  IF to_regclass('public.allocator_trade_reads_rolled_back_20261030') IS NOT NULL
     OR to_regclass('public.allocator_trade_read_windows_rolled_back_20261030') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 20261030120000 refused: a *_rolled_back_20261030 table already exists, so an earlier rollback already set a table aside. Nothing was changed. Decide what to do with the kept rows first.';
  END IF;
END
$precondition$;

-- 1. Access: no role but the table owner can touch the kept rows.
REVOKE ALL ON TABLE public.allocator_trade_reads, public.allocator_trade_read_windows FROM PUBLIC, anon, authenticated, service_role;

-- 2. Set the tables, and the schema-level names they own, aside. Renaming a constraint
--    renames the index behind it. Nothing is dropped.
ALTER TABLE public.allocator_trade_reads RENAME TO allocator_trade_reads_rolled_back_20261030;
ALTER TABLE public.allocator_trade_reads_rolled_back_20261030
  RENAME CONSTRAINT allocator_trade_reads_pkey TO allocator_trade_reads_pkey_rolled_back_20261030;
ALTER TABLE public.allocator_trade_read_windows RENAME TO allocator_trade_read_windows_rolled_back_20261030;
ALTER TABLE public.allocator_trade_read_windows_rolled_back_20261030
  RENAME CONSTRAINT allocator_trade_read_windows_pkey TO allocator_trade_read_windows_pkey_rolled_back_20261030;

-- ───────────── verify — CATALOGUE ONLY, reads no row
DO $verify$
BEGIN
  IF to_regclass('public.allocator_trade_reads') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 20261030120000 failed: public.allocator_trade_reads still resolves';
  END IF;
  IF to_regclass('public.allocator_trade_read_windows') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 20261030120000 failed: public.allocator_trade_read_windows still resolves';
  END IF;
  IF to_regclass('public.allocator_trade_reads_rolled_back_20261030') IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261030120000 failed: public.allocator_trade_reads_rolled_back_20261030 is missing, so the kept rows are not where this file says they are';
  END IF;
  IF to_regclass('public.allocator_trade_read_windows_rolled_back_20261030') IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261030120000 failed: public.allocator_trade_read_windows_rolled_back_20261030 is missing, so the kept rows are not where this file says they are';
  END IF;

  RAISE NOTICE 'Rollback 20261030120000: allocator_trade_reads and allocator_trade_read_windows are set aside as allocator_trade_reads_rolled_back_20261030 and allocator_trade_read_windows_rolled_back_20261030 with every stored row kept and access withdrawn from every role. The migration ledger row is left in place (see the header).';
END
$verify$;
