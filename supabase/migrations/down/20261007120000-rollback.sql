-- ============================================================================
-- ROLLBACK for 20261007120000_api_keys_account_currency.sql
-- Phase 164.6.6.2 BTCNATIVE, plan 02 (D-02, D-14).
-- ============================================================================
-- ⛔ ROLL THE READERS BACK FIRST. The analytics worker's derive (plan 03) reads
-- account_currency for the D-03 comparison and writes both columns. Dropping a
-- column under a deployed worker makes its api_keys UPDATE answer a schema-cache
-- miss (PGRST204 / 42703). Revert and DEPLOY the worker before this runs. No
-- TypeScript reads these columns, so there is no Vercel side to roll back.
--
-- Manual, off the auto-apply path. What it drops: the api_keys_account_currency_code
-- CHECK and the two columns account_currency and account_balance_native.
--
-- ⚠️ DATA: every stored account currency and native balance is LOST with the
-- columns. Both are re-derived by the worker's next derive once re-applied.
--
-- ⚠️ THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations, so after it runs the ledger still
-- records version 20261007120000 as applied while the schema no longer carries
-- it. `supabase db push` will therefore NOT re-apply the migration. To re-apply
-- it, delete that ledger row in the same change that re-applies it (or mark it
-- reverted with `supabase migration repair --status reverted 20261007120000`
-- against the intended database, after the marker query in CLAUDE.md names that
-- database). Until then VAC-08's ledger check reports the version as present,
-- which is true of the ledger and false of the schema.
--
-- The DO block at the top is a catalogue-only PRECONDITION: it RAISEs, before any
-- DROP runs, unless both columns the migration added exist. Every DROP below is
-- IF EXISTS, so without it this file run against a database that never had
-- 20261007120000 would drop nothing and still report success.
--
-- The DO block at the end is catalogue-only: it RAISEs, and so aborts the whole
-- rollback, if either column or the constraint survives.
-- ============================================================================

BEGIN;

SET lock_timeout = '3s';

-- ───────────── precondition — CATALOGUE ONLY, reads no row
DO $precondition$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(c, ', ') INTO v_missing
    FROM unnest(ARRAY['account_currency', 'account_balance_native']) AS c
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_attribute
      WHERE attrelid = 'public.api_keys'::regclass
        AND attname = c
        AND NOT attisdropped
   );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 20261007120000 refused: api_keys lacks column(s) % that the migration adds, so this database does not carry 20261007120000. Nothing was dropped. Run the marker query in CLAUDE.md to see which database this is.', v_missing;
  END IF;
END
$precondition$;

ALTER TABLE public.api_keys
  DROP CONSTRAINT IF EXISTS api_keys_account_currency_code;

ALTER TABLE public.api_keys
  DROP COLUMN IF EXISTS account_currency,
  DROP COLUMN IF EXISTS account_balance_native;

-- ───────────── verify — CATALOGUE ONLY
DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.api_keys'::regclass
       AND attname IN ('account_currency', 'account_balance_native')
       AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'Rollback 20261007120000 failed: account_currency or account_balance_native survives on api_keys';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.api_keys'::regclass
       AND conname = 'api_keys_account_currency_code'
  ) THEN
    RAISE EXCEPTION 'Rollback 20261007120000 failed: constraint api_keys_account_currency_code survives';
  END IF;

  RAISE NOTICE 'Rollback 20261007120000: both columns and the currency CHECK are gone. The migration ledger row is left in place (see the header).';
END
$verify$;

COMMIT;
