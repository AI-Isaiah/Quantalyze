-- ============================================================================
-- api_keys.account_currency + api_keys.account_balance_native: the account's
-- own currency code and its live balance in that currency
-- (2026-10-07, Phase 164.6.6.2 BTCNATIVE, D-02 and D-14)
-- ============================================================================
--
-- What this is for
-- ----------------
-- An MT5 account can be denominated in BTC (or any non-USD currency). The
-- analytics worker reads that currency from the gateway's account_info() and
-- classifies it (D-02). It stores the code here so a later read can be compared
-- with the stored one (D-03: a currency that CHANGES under a key is refused, not
-- silently re-denominated), and it stores the live equity in that currency in
-- account_balance_native (D-14) instead of writing BTC into
-- account_balance_usdt, which is a USD field. A USD-family key leaves
-- account_balance_native NULL and account_balance_usdt stays the USD figure.
--
-- ⛔ DEPLOY ORDER: THIS SHIPS IN A SINGLE PR, AND NO TYPESCRIPT READS THESE
-- COLUMNS. The only reader and writer is the Python analytics worker (service
-- role). Merging supabase/migrations/** to `main` applies to shared TEST and then
-- to PROD with no human stop, and the Railway worker may deploy before PROD has
-- applied. The worker's write therefore tolerates PostgREST PGRST204 (column not
-- in the schema cache) for that window (CONTEXT, Claude's Discretion; plan 03).
-- There is no Vercel-versus-migration race here, which is the opposite of the
-- hazard 20260920120000 and 20260925120000 document: the key-list SELECT, the
-- API_KEY_USER_COLUMNS allowlist and the ApiKey type are NOT touched, because
-- the factsheet reads the unit from strategy_analytics.data_quality_flags.
--
-- ⛔ NO DATA CENSUS RUNS INSIDE THIS MIGRATION, and no DO block here reads a
-- row. Shared TEST holds PROD's catalogue and none of its data, and a failed
-- TEST apply blocks the PROD apply, so a data-reading DO block that RAISEs on an
-- unexpected count would block a production deploy on an empty database. Every
-- check below is DDL or catalogue-only.
--
-- ⛔ BOTH COLUMNS ARE DELIBERATELY UN-GRANTED. 20260410225608 revoked table-level
-- SELECT on api_keys from anon and authenticated and re-granted a per-column
-- allowlist (src/lib/constants.ts API_KEY_USER_COLUMNS), so a column added later
-- is born un-granted to both roles. account_balance_native is a live balance and
-- must stay that way. No GRANT is issued here and the allowlist is untouched; the
-- post-verify below RAISEs if either role can SELECT either column.
--
-- No function is added, so no SECURITY DEFINER / search_path rule applies.
-- Rollback (manual, off the auto-apply path):
-- supabase/migrations/down/20261007120000-rollback.sql
-- ============================================================================

BEGIN;

SET lock_timeout = '3s';

-- ───────────────────────────── 1. the two columns (no default, no backfill)
ALTER TABLE public.api_keys
  ADD COLUMN account_currency text NULL,
  ADD COLUMN account_balance_native numeric NULL;

-- ─────────── 2. the currency-code CHECK (T-164.6.6.2-06)
-- Guarded on pg_constraint because ADD CONSTRAINT has no IF NOT EXISTS in this
-- PG version (the form of 20260812083206). Added directly rather than NOT VALID +
-- VALIDATE: the columns were created one statement ago, every row is NULL, so
-- validation reads no data. The pattern is the one the worker's classifier
-- enforces, so a garbled string cannot be persisted by any writer.
DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.api_keys'::regclass
       AND conname  = 'api_keys_account_currency_code'
  ) THEN
    ALTER TABLE public.api_keys
      ADD CONSTRAINT api_keys_account_currency_code
      CHECK (account_currency IS NULL OR account_currency ~ '^[A-Z]{2,10}$');
  END IF;
END
$constraint$;

-- ─────────── 3. COMMENTs that say who writes it and why NULL is normal
COMMENT ON COLUMN public.api_keys.account_currency IS
  'Phase 164.6.6.2 D-02. The account''s own currency code as the MT5 gateway '
  'reports it (upper-case, 2 to 10 letters; api_keys_account_currency_code), '
  'e.g. USD or BTC. Written only by the analytics worker''s derive (service '
  'role); no client INSERT or UPDATE path exists. NULL is NORMAL: every non-MT5 '
  'key, and an MT5 key before its first post-deploy derive. A later read that '
  'disagrees with a stored value is refused by the worker (D-03), never '
  'silently re-denominated. Deliberately UN-GRANTED to anon and authenticated '
  '(20260410225608 column-revoke model); nothing user-scoped reads it.';

COMMENT ON COLUMN public.api_keys.account_balance_native IS
  'Phase 164.6.6.2 D-14. The account''s live equity in account_currency units '
  '(e.g. a BTC amount for a BTC-denominated account), written only by the '
  'analytics worker''s derive (service role). A USD-family key leaves this NULL '
  'and account_balance_usdt stays the USD figure: a non-USD amount is never '
  'written into account_balance_usdt. NULL is NORMAL for every non-MT5 key and '
  'for an MT5 key before its first post-deploy derive. Deliberately UN-GRANTED '
  'to anon and authenticated (a live balance); nothing user-scoped reads it.';

-- ───────────── 4. post-verify — CATALOGUE ONLY, passes on an empty database
DO $verify$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(c, ', ') INTO v_missing
    FROM unnest(ARRAY['account_currency', 'account_balance_native']) AS c
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'api_keys' AND column_name = c
   );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 20261007120000 failed: api_keys lacks column(s) %', v_missing;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.api_keys'::regclass
       AND conname = 'api_keys_account_currency_code'
       AND convalidated
  ) THEN
    RAISE EXCEPTION 'Migration 20261007120000 failed: constraint api_keys_account_currency_code is missing or not validated';
  END IF;

  IF has_column_privilege('anon', 'public.api_keys', 'account_currency', 'SELECT') THEN
    RAISE EXCEPTION 'Migration 20261007120000 failed: anon unexpectedly holds SELECT on api_keys.account_currency';
  END IF;
  IF has_column_privilege('authenticated', 'public.api_keys', 'account_currency', 'SELECT') THEN
    RAISE EXCEPTION 'Migration 20261007120000 failed: authenticated unexpectedly holds SELECT on api_keys.account_currency';
  END IF;
  IF has_column_privilege('anon', 'public.api_keys', 'account_balance_native', 'SELECT') THEN
    RAISE EXCEPTION 'Migration 20261007120000 failed: anon unexpectedly holds SELECT on api_keys.account_balance_native';
  END IF;
  IF has_column_privilege('authenticated', 'public.api_keys', 'account_balance_native', 'SELECT') THEN
    RAISE EXCEPTION 'Migration 20261007120000 failed: authenticated unexpectedly holds SELECT on api_keys.account_balance_native';
  END IF;

  RAISE NOTICE 'Migration 20261007120000: account_currency and account_balance_native present, currency CHECK validated, no anon/authenticated SELECT on either.';
END
$verify$;

COMMIT;
