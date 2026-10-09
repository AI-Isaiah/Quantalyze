-- ============================================================================
-- ROLLBACK for 20261010120000_btcusdview_native_balance.sql
-- Phase 164.6.6.2.1 BTCUSDVIEW, plan 01 (D-07, D-17, UI-SPEC E and F).
-- ============================================================================
-- ⛔ ROLL THE READERS BACK FIRST. Three deployed things depend on what this file
-- removes:
--   * the browser's key-list projection (plan 15's API_KEY_USER_COLUMNS_ARR
--     roster entries for account_currency, account_balance_native and
--     account_balance_usdt_close_date), which reads the three GRANTed columns;
--   * the analytics worker's derive (plan 10's writer), which writes
--     account_balance_usdt_close_date beside account_balance_usdt;
--   * the positions poll (plan 07's writer), which writes
--     allocator_holdings.quantity_unit.
-- Revert and DEPLOY all three BEFORE this runs. Issuing the REVOKE or the DROPs
-- while a still-deployed frontend projects those columns answers PostgREST 42501
-- (REVOKE) or 42703 (DROP) on every user-scoped api_keys SELECT, and
-- getUserApiKeys deliberately throws, so the allocations and exchanges pages
-- hard-error for every allocator. A still-deployed worker answers a schema-cache
-- miss (PGRST204 / 42703) on its UPDATE.
--
-- Manual, off the auto-apply path. What it undoes: the authenticated SELECT grant
-- on account_currency, account_balance_native and account_balance_usdt_close_date
-- (the first two return to the un-granted state 20261007120000 created them in),
-- the allocator_holdings_quantity_unit_code CHECK, and the two columns this
-- migration added (api_keys.account_balance_usdt_close_date and
-- allocator_holdings.quantity_unit). It does NOT drop account_currency or
-- account_balance_native, which belong to 20261007120000
-- (down/20261007120000-rollback.sql).
--
-- ⚠️ It does NOT restore the pre-migration COMMENT text of account_currency and
-- account_balance_native, which this migration re-stamped. Re-run the COMMENT
-- statements of 20261007120000 if the old wording is wanted.
--
-- ⚠️ DATA: every stored close date and every stored holdings unit is LOST with
-- the columns. Both are re-written by the worker's next derive and the next
-- positions poll once the migration is re-applied.
--
-- ⚠️ THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations, so after it runs the ledger still
-- records version 20261010120000 as applied while the schema no longer carries
-- it. `supabase db push` will therefore NOT re-apply the migration. To re-apply
-- it, delete that ledger row in the same change that re-applies it (or mark it
-- reverted with `supabase migration repair --status reverted 20261010120000`
-- against the intended database, after the marker query in CLAUDE.md names that
-- database). Until then VAC-08's ledger check reports the version as present,
-- which is true of the ledger and false of the schema.
--
-- The DO block at the top is a catalogue-only PRECONDITION: it RAISEs, before
-- anything is revoked or dropped, unless both columns the migration added exist.
-- Every DROP below is IF EXISTS, so without it this file run against a database
-- that never had 20261010120000 would drop nothing and still report success.
--
-- The DO block at the end is catalogue-only: it RAISEs, and so aborts the whole
-- rollback, if a column, the constraint or a grant survives.
-- ============================================================================

BEGIN;

SET lock_timeout = '3s';

-- ───────────── precondition — CATALOGUE ONLY, reads no row
DO $precondition$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.api_keys'::regclass
       AND attname = 'account_balance_usdt_close_date'
       AND NOT attisdropped
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.allocator_holdings'::regclass
       AND attname = 'quantity_unit'
       AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'Rollback 20261010120000 refused: api_keys.account_balance_usdt_close_date or allocator_holdings.quantity_unit is missing, so this database does not carry 20261010120000. Nothing was changed. Run the marker query in CLAUDE.md to see which database this is.';
  END IF;
END
$precondition$;

REVOKE SELECT (account_currency, account_balance_native, account_balance_usdt_close_date)
  ON public.api_keys FROM authenticated;

ALTER TABLE public.allocator_holdings
  DROP CONSTRAINT IF EXISTS allocator_holdings_quantity_unit_code;

ALTER TABLE public.allocator_holdings
  DROP COLUMN IF EXISTS quantity_unit;

ALTER TABLE public.api_keys
  DROP COLUMN IF EXISTS account_balance_usdt_close_date;

-- ───────────── verify — CATALOGUE ONLY
DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.api_keys'::regclass
       AND attname = 'account_balance_usdt_close_date'
       AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'Rollback 20261010120000 failed: api_keys.account_balance_usdt_close_date survives';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.allocator_holdings'::regclass
       AND attname = 'quantity_unit'
       AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'Rollback 20261010120000 failed: allocator_holdings.quantity_unit survives';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.allocator_holdings'::regclass
       AND conname = 'allocator_holdings_quantity_unit_code'
  ) THEN
    RAISE EXCEPTION 'Rollback 20261010120000 failed: constraint allocator_holdings_quantity_unit_code survives';
  END IF;

  IF has_column_privilege('authenticated', 'public.api_keys', 'account_currency', 'SELECT')
     OR has_column_privilege('authenticated', 'public.api_keys', 'account_balance_native', 'SELECT') THEN
    RAISE EXCEPTION 'Rollback 20261010120000 failed: authenticated still holds SELECT on account_currency or account_balance_native';
  END IF;

  RAISE NOTICE 'Rollback 20261010120000: both columns and the unit CHECK are gone, and authenticated no longer reads account_currency or account_balance_native. The migration ledger row is left in place (see the header).';
END
$verify$;

COMMIT;
