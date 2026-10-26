-- ============================================================================
-- ROLLBACK for 20261029120000_api_key_nav_marks.sql
-- Phase 167.2.1.1.1 NAVMTM, plan 01 (SC-1, SC-2; D-01, D-06, D-07, D-11).
-- ============================================================================
-- Manual, off the auto-apply path. Run it as ONE transaction, so it either happens
-- whole or not at all (this file carries no transaction statements, like a migration):
--
--   psql --single-transaction -v ON_ERROR_STOP=1 -f <this file>
--
-- against the database the marker query in CLAUDE.md names. What it undoes:
--   1. Drops the owner-coherence trigger and its function.
--   2. Withdraws every table privilege from every role and drops the owner SELECT
--      policy, so nothing but the table owner can read or write the marks.
--   3. RENAMES the table, and the names it owns in the schema (its primary key, its
--      first-writer unique key, its owner index and its identity sequence), aside to
--      *_rolled_back_20261029. The renames are what let the migration be applied again
--      afterwards without a name collision.
--
-- Run it only AFTER the analytics worker that writes marks, and the app code that
-- reads them (the GDPR export entry for this table among it), have been rolled back.
-- Otherwise the writer fails on a missing table and the export on a missing relation.
--
-- ⚠️ DATA IS KEPT. This file never DROPs the table. A stored mark is a write-once
-- observation of an account's value on a day that has passed: once lost it cannot be
-- read from the venue again, and a mark may already count in what an allocator sees.
-- Removing the rows is a founder decision and no part of this file. They stay in
-- public.api_key_nav_marks_rolled_back_20261029 (table owner access only), and they
-- still go when their key or their account is deleted, because both foreign keys and
-- their ON DELETE CASCADE are untouched. To get them back after re-applying the
-- migration, copy them across with an INSERT ... SELECT run by the table owner.
--
-- ⚠️ THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations, so after it runs the ledger still records
-- version 20261029120000 as applied while the schema no longer carries it, and
-- `supabase db push` will not re-apply the migration. To re-apply it, delete that
-- ledger row in the same change (or mark it reverted with
-- `supabase migration repair --status reverted 20261029120000` against the intended
-- database, after the marker query in CLAUDE.md names that database).
--
-- The DO block before the change is a catalogue-only PRECONDITION: it refuses, before
-- anything changes, on a database that does not carry the migration and on one where an
-- earlier rollback already set the table aside. The DO block after the change is
-- catalogue-only too and aborts the whole rollback if the table still resolves under its
-- own name, the renamed table is missing, or the trigger function survives. Neither
-- reads a row.
-- ============================================================================

SET LOCAL lock_timeout = '3s';

-- ───────────── precondition — CATALOGUE ONLY, reads no row
DO $precondition$
BEGIN
  IF to_regclass('public.api_key_nav_marks') IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261029120000 refused: public.api_key_nav_marks is not present, so this database does not carry 20261029120000. Nothing was changed. Run the marker query in CLAUDE.md to see which database this is.';
  END IF;
  IF to_regclass('public.api_key_nav_marks_rolled_back_20261029') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 20261029120000 refused: public.api_key_nav_marks_rolled_back_20261029 already exists, so an earlier rollback already set a table aside. Nothing was changed. Decide what to do with the kept marks first.';
  END IF;
END
$precondition$;

-- 1. The owner-coherence trigger, then its function.
DROP TRIGGER IF EXISTS api_key_nav_marks_owner_coherence ON public.api_key_nav_marks;
DROP FUNCTION IF EXISTS public.enforce_api_key_nav_marks_owner_coherence();

-- 2. Access: no role but the table owner can touch the kept rows.
REVOKE ALL ON TABLE public.api_key_nav_marks FROM PUBLIC, anon, authenticated, service_role;
DROP POLICY IF EXISTS api_key_nav_marks_owner_select ON public.api_key_nav_marks;

-- 3. Set the table, and the schema-level names it owns, aside. Renaming a constraint
--    renames the index behind it; the owner index and the identity sequence are
--    renamed on their own. Nothing is dropped.
ALTER TABLE public.api_key_nav_marks RENAME TO api_key_nav_marks_rolled_back_20261029;
ALTER TABLE public.api_key_nav_marks_rolled_back_20261029
  RENAME CONSTRAINT api_key_nav_marks_pkey TO api_key_nav_marks_pkey_rolled_back_20261029;
ALTER TABLE public.api_key_nav_marks_rolled_back_20261029
  RENAME CONSTRAINT api_key_nav_marks_key_day_key TO api_key_nav_marks_key_day_key_rolled_back_20261029;
ALTER INDEX public.api_key_nav_marks_allocator_day_idx
  RENAME TO api_key_nav_marks_allocator_day_idx_rolled_back_20261029;
ALTER SEQUENCE public.api_key_nav_marks_id_seq
  RENAME TO api_key_nav_marks_id_seq_rolled_back_20261029;

-- ───────────── verify — CATALOGUE ONLY, reads no row
DO $verify$
BEGIN
  IF to_regclass('public.api_key_nav_marks') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 20261029120000 failed: public.api_key_nav_marks still resolves';
  END IF;
  IF to_regclass('public.api_key_nav_marks_rolled_back_20261029') IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261029120000 failed: public.api_key_nav_marks_rolled_back_20261029 is missing, so the kept marks are not where this file says they are';
  END IF;
  IF to_regprocedure('public.enforce_api_key_nav_marks_owner_coherence()') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 20261029120000 failed: enforce_api_key_nav_marks_owner_coherence survives';
  END IF;

  RAISE NOTICE 'Rollback 20261029120000: api_key_nav_marks is set aside as api_key_nav_marks_rolled_back_20261029 with every stored mark kept, access withdrawn from every role, the trigger and its function dropped. The migration ledger row is left in place (see the header).';
END
$verify$;
