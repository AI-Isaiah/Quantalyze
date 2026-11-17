-- ============================================================================
-- ROLLBACK for 20261117120000_mt5_server_clock_readings.sql
-- Phase 155.1 SERVERCLOCK, plan 04 (MT5-06; D-14, D-16, D-20(c)).
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
--   2. RENAMES the table, the primary key, the foreign key, the seven named CHECKs, the
--      index and the identity sequence it owns aside to *_rolled_back_20261117, and the
--      trigger function aside the same way. Two of those names would pass PostgreSQL's
--      63-character identifier limit with that suffix and would be silently truncated,
--      so the reason/verdict CHECK and the trigger function carry the shorter suffix
--      _rb_20261117 instead. The renames are what let the migration be applied again
--      afterwards without a name collision.
--
-- Run it only AFTER the analytics worker that writes this table has been rolled back.
-- Otherwise every leased MT5 derive fails its reading insert on a missing relation and
-- ends FAILED transient until the worker or the table is back.
--
-- ⚠️ DATA IS KEPT (D-16, the keep-data rule). This file never removes a table. The rows
-- are the evidence the founder's follow-up session compares, and their removal is a
-- founder decision and no part of this file. They stay in
-- public.mt5_server_clock_readings_rolled_back_20261117 (table owner access only).
--
-- ⚠️ THE KEPT ROWS STAY WRITE-ONCE, AND STILL ERASE WITH THEIR KEY. The trigger
-- mt5_server_clock_readings_write_once is NOT dropped: it stays attached to the renamed
-- table (a trigger follows its table, and the renamed function it calls is bound by
-- identity, not by name), so the kept rows still refuse every UPDATE and direct DELETE.
-- The api_keys foreign key and its cascade are untouched, so a key delete or an account
-- erasure still erases them, nested inside the cascade. Trigger names are per table, so
-- re-applying the migration creates a fresh trigger of the same name on the fresh table
-- without a collision. To get the old rows back after re-applying the migration, copy
-- them across with an INSERT ... SELECT run by the table owner.
--
-- ⚠️ THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations, so after it runs the ledger still records
-- version 20261117120000 as applied while the schema no longer carries it, and
-- `supabase db push` will not re-apply the migration. To re-apply it, delete that
-- ledger row in the same change (or mark it reverted with
-- `supabase migration repair --status reverted 20261117120000` against the intended
-- database, after the marker query above names that database).
--
-- The DO block before the change is a catalogue-only PRECONDITION: it refuses, before
-- anything changes, on a database that does not carry the migration and on one where an
-- earlier rollback already set the table or the function aside. The DO block after the
-- change is catalogue-only too and aborts the whole rollback if the table still resolves
-- under its own name or the renamed table or function is missing. Neither reads a row.
-- ============================================================================

SET LOCAL lock_timeout = '3s';

-- ───────────── precondition — CATALOGUE ONLY, reads no row
DO $precondition$
BEGIN
  IF to_regclass('public.mt5_server_clock_readings') IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261117120000 refused: public.mt5_server_clock_readings is not present, so this database does not carry 20261117120000. Nothing was changed. Run the marker query in CLAUDE.md to see which database this is.';
  END IF;
  IF to_regclass('public.mt5_server_clock_readings_rolled_back_20261117') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 20261117120000 refused: public.mt5_server_clock_readings_rolled_back_20261117 already exists, so an earlier rollback already set the table aside. Nothing was changed. Decide what to do with the kept rows first.';
  END IF;
  IF to_regprocedure('public.enforce_mt5_server_clock_readings_write_once_rb_20261117()') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 20261117120000 refused: the trigger function is already set aside under its set-aside name. Nothing was changed. Decide what to do with the earlier rollback first.';
  END IF;
END
$precondition$;

-- 1. Access: no role but the table owner can touch the kept rows.
REVOKE ALL ON TABLE public.mt5_server_clock_readings FROM PUBLIC, anon, authenticated, service_role;

-- 2. Set the table and every schema-level name it owns aside. Renaming a constraint
--    renames the index behind it. Nothing is dropped.
ALTER TABLE public.mt5_server_clock_readings RENAME TO mt5_server_clock_readings_rolled_back_20261117;

ALTER TABLE public.mt5_server_clock_readings_rolled_back_20261117
  RENAME CONSTRAINT mt5_server_clock_readings_pkey TO mt5_server_clock_readings_pkey_rolled_back_20261117;
ALTER TABLE public.mt5_server_clock_readings_rolled_back_20261117
  RENAME CONSTRAINT mt5_server_clock_readings_api_key_id_fkey TO mt5_server_clock_readings_api_key_id_fkey_rolled_back_20261117;
ALTER TABLE public.mt5_server_clock_readings_rolled_back_20261117
  RENAME CONSTRAINT mt5_server_clock_readings_rule_chk TO mt5_server_clock_readings_rule_chk_rolled_back_20261117;
ALTER TABLE public.mt5_server_clock_readings_rolled_back_20261117
  RENAME CONSTRAINT mt5_server_clock_readings_verdict_chk TO mt5_server_clock_readings_verdict_chk_rolled_back_20261117;
ALTER TABLE public.mt5_server_clock_readings_rolled_back_20261117
  RENAME CONSTRAINT mt5_server_clock_readings_reason_chk TO mt5_server_clock_readings_reason_chk_rolled_back_20261117;
ALTER TABLE public.mt5_server_clock_readings_rolled_back_20261117
  RENAME CONSTRAINT mt5_server_clock_readings_reason_verdict_chk TO mt5_server_clock_readings_reason_verdict_chk_rb_20261117;
ALTER TABLE public.mt5_server_clock_readings_rolled_back_20261117
  RENAME CONSTRAINT mt5_server_clock_readings_offsets_chk TO mt5_server_clock_readings_offsets_chk_rolled_back_20261117;
ALTER TABLE public.mt5_server_clock_readings_rolled_back_20261117
  RENAME CONSTRAINT mt5_server_clock_readings_hash_chk TO mt5_server_clock_readings_hash_chk_rolled_back_20261117;
ALTER TABLE public.mt5_server_clock_readings_rolled_back_20261117
  RENAME CONSTRAINT mt5_server_clock_readings_counts_chk TO mt5_server_clock_readings_counts_chk_rolled_back_20261117;

ALTER INDEX public.mt5_server_clock_readings_key_read_at_idx
  RENAME TO mt5_server_clock_readings_key_read_at_idx_rolled_back_20261117;
ALTER SEQUENCE public.mt5_server_clock_readings_id_seq
  RENAME TO mt5_server_clock_readings_id_seq_rolled_back_20261117;

-- 3. Set the trigger function aside. The trigger stays on the renamed table and keeps
--    calling it by identity; see the header.
ALTER FUNCTION public.enforce_mt5_server_clock_readings_write_once()
  RENAME TO enforce_mt5_server_clock_readings_write_once_rb_20261117;

-- ───────────── verify — CATALOGUE ONLY, reads no row
DO $verify$
BEGIN
  IF to_regclass('public.mt5_server_clock_readings') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 20261117120000 failed: public.mt5_server_clock_readings still resolves';
  END IF;
  IF to_regclass('public.mt5_server_clock_readings_rolled_back_20261117') IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261117120000 failed: public.mt5_server_clock_readings_rolled_back_20261117 is missing, so the kept rows are not where this file says they are';
  END IF;
  IF to_regprocedure('public.enforce_mt5_server_clock_readings_write_once()') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 20261117120000 failed: public.enforce_mt5_server_clock_readings_write_once() still resolves';
  END IF;
  IF to_regprocedure('public.enforce_mt5_server_clock_readings_write_once_rb_20261117()') IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261117120000 failed: the trigger function is missing under its set-aside name';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgname = 'mt5_server_clock_readings_write_once'
                    AND tgrelid = 'public.mt5_server_clock_readings_rolled_back_20261117'::regclass
                    AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Rollback 20261117120000 failed: the write-once trigger is not attached to the kept table, so the kept rows are no longer write-once';
  END IF;

  RAISE NOTICE 'Rollback 20261117120000: mt5_server_clock_readings is set aside as mt5_server_clock_readings_rolled_back_20261117 with every stored row kept, write-once and access withdrawn from every role. The migration ledger row is left in place (see the header).';
END
$verify$;
