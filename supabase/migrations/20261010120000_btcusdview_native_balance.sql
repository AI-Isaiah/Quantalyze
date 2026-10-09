-- ============================================================================
-- Owner-readable native balance + the stored close date + a stored holdings unit
-- (2026-10-10, Phase 164.6.6.2.1 BTCUSDVIEW, plan 01; D-07, D-17, UI-SPEC E and F)
-- ============================================================================
--
-- What this is for
-- ----------------
-- A native-unit (non-USD, e.g. BTC-denominated) MT5 account also gets a USD
-- view in this phase. Three things need a database home first:
--
--   * D-07: the key's OWNER reads api_keys.account_currency and
--     api_keys.account_balance_native in the browser (the key card shows the
--     native balance). Both were created UN-GRANTED by 20261007120000. This
--     migration GRANTs SELECT on them to `authenticated` only. Row scope is the
--     existing owner RLS on api_keys, so one user never reads another's balance.
--   * D-17 / UI-SPEC E: the key card prints the USD figure as "approximately
--     $26,100 at Oct 8 close". The date must be the STORED date of the daily BTC
--     close that priced api_keys.account_balance_usdt, never the viewer's clock.
--     api_keys.account_balance_usdt_close_date (date, NULL) is that field. NULL
--     means no USD value was priced. It is GRANTed to `authenticated` for read.
--   * UI-SPEC F: the Holdings Quantity cell for a native-unit account row names
--     its unit from a stored unit ON THE ROW, never inferred from the symbol or
--     the mark. allocator_holdings.quantity_unit (text, NULL, CHECK
--     `^[A-Z]{2,10}$`) is that field. Chosen over raw_payload->>'currency'
--     because sFOX rows already store an ASSET code under that key (a BTC spot
--     row would read as a native-unit account row), and over a join to the key's
--     account_currency because UI-SPEC F binds the unit to the row itself.
--     NULL keeps every existing row's meaning. allocator_holdings already
--     carries table-level SELECT with owner RLS, so the new column inherits it
--     and no grant changes there.
--
-- Nothing here is writable by a client: no INSERT or UPDATE grant is issued, so
-- the analytics worker (service role) stays the only writer of all three api_keys
-- columns and of quantity_unit. anon is granted nothing.
--
-- ⛔⛔ DEPLOY ORDER — THIS PR (PR 1 OF THE PHASE) CARRIES THE SCHEMA AND THE
-- GRANT AND NOTHING THAT READS THEM. The code PR (the rest of the phase's plans)
-- adds account_currency, account_balance_native and account_balance_usdt_close_date
-- to API_KEY_USER_COLUMNS_ARR (src/lib/constants.ts) and merges ONLY AFTER PROD
-- HAS APPLIED THIS MIGRATION. Same hazard and same remedy as 20260920120000: a
-- roster ahead of the GRANT makes every user-scoped api_keys SELECT answer
-- PostgREST 42501 "permission denied for column", and getUserApiKeys deliberately
-- throws, so the allocations and exchanges pages hard-error for every allocator.
-- Merging supabase/migrations/** to `main` applies to shared TEST and then to
-- PROD with NO human stop, and the Vercel build has no ordering against it, which
-- is why the split is the control and careful sequencing is not.
-- src/lib/sec-005-live-probe.test.ts's roster-subset-of-GRANT arm confirms the
-- order: a GRANT ahead of the roster (this PR) passes; the reverse is what it
-- catches.
--
-- ROLLBACK ORDER (the same hazard, in reverse): revert the roster and the
-- writers FIRST and let that deployment land, THEN run
-- supabase/migrations/down/20261010120000-rollback.sql. Issuing the REVOKE first,
-- while a still-deployed frontend projects the columns, reproduces the 42501
-- outage in reverse.
--
-- ⛔ NO DATA CENSUS RUNS INSIDE THIS MIGRATION, and no DO block here reads a
-- row. Shared TEST holds PROD's catalogue and none of its data, and a failed
-- TEST apply blocks the PROD apply, so a data-reading DO block that RAISEs on an
-- unexpected count would block a production deploy on an empty database. Every
-- check below is DDL or catalogue-only (scripts/lint-migration-data-dependence.mjs).
--
-- No function is added or redefined, so no SECURITY DEFINER / search_path rule
-- applies and there is no CREATE OR REPLACE to re-base.
-- Rollback (manual, off the auto-apply path):
-- supabase/migrations/down/20261010120000-rollback.sql
-- ============================================================================

BEGIN;

SET lock_timeout = '3s';

-- ───────────────────────────── 1. api_keys.account_balance_usdt_close_date
-- No default, no backfill: NULL means no USD value was priced.
ALTER TABLE public.api_keys
  ADD COLUMN account_balance_usdt_close_date date NULL;

-- ───────────────────────────── 2. allocator_holdings.quantity_unit + its CHECK
ALTER TABLE public.allocator_holdings
  ADD COLUMN quantity_unit text NULL;

-- Guarded on pg_constraint because ADD CONSTRAINT has no IF NOT EXISTS in this PG
-- version (the form of 20261007120000). Added directly rather than NOT VALID +
-- VALIDATE: the column was created one statement ago, every row is NULL, so
-- validation reads no data. The pattern is the one api_keys_account_currency_code
-- enforces, so a unit written beside a currency obeys the same shape.
DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.allocator_holdings'::regclass
       AND conname  = 'allocator_holdings_quantity_unit_code'
  ) THEN
    ALTER TABLE public.allocator_holdings
      ADD CONSTRAINT allocator_holdings_quantity_unit_code
      CHECK (quantity_unit IS NULL OR quantity_unit ~ '^[A-Z]{2,10}$');
  END IF;
END
$constraint$;

-- ───────────────────────────── 3. the owner-only column GRANT (D-07, D-17)
-- authenticated only. No anon grant. No INSERT or UPDATE grant on any column.
GRANT SELECT (account_currency, account_balance_native, account_balance_usdt_close_date) ON public.api_keys TO authenticated;

-- ───────────────────────────── 4. COMMENTs
-- Re-stamp the two 20261007120000 COMMENTs: they say "Deliberately UN-GRANTED ...
-- nothing user-scoped reads it", which the GRANT above makes false. A COMMENT
-- reads no row and cannot fail the self-verify below.
COMMENT ON COLUMN public.api_keys.account_currency IS
  'Phase 164.6.6.2 D-02, RE-STAMPED by 164.6.6.2.1 D-07. The account''s own '
  'currency code as the MT5 gateway reports it (upper-case, 2 to 10 letters; '
  'api_keys_account_currency_code), e.g. USD or BTC. Written only by the '
  'analytics worker''s derive (service role); no client INSERT or UPDATE path '
  'exists. NULL is NORMAL: every non-MT5 key, and an MT5 key before its first '
  'post-deploy derive. A later read that disagrees with a stored value is '
  'refused by the worker (D-03), never silently re-denominated. READABLE BY '
  'authenticated (column GRANT, 20261010120000), scoped by the owner RLS on '
  'api_keys, so the key''s owner sees its currency on the key card. The prior '
  'form of this comment said it was un-granted and that nothing user-scoped '
  'read it: both are now false by design. anon still has NO grant '
  '(20260410225608 column-revoke model).';

COMMENT ON COLUMN public.api_keys.account_balance_native IS
  'Phase 164.6.6.2 D-14, RE-STAMPED by 164.6.6.2.1 D-07. The account''s live '
  'equity in account_currency units (e.g. a BTC amount for a BTC-denominated '
  'account), written only by the analytics worker''s derive (service role). A '
  'USD-family key leaves this NULL and account_balance_usdt stays the USD '
  'figure: a non-USD amount is never written into account_balance_usdt. NULL is '
  'NORMAL for every non-MT5 key and for an MT5 key before its first post-deploy '
  'derive. READABLE BY authenticated (column GRANT, 20261010120000), scoped by '
  'the owner RLS on api_keys, so the key''s owner sees its native balance on the '
  'key card. The prior form of this comment said it was un-granted and that '
  'nothing user-scoped read it: both are now false by design. anon still has NO '
  'grant (20260410225608 column-revoke model); it is a live balance.';

COMMENT ON COLUMN public.api_keys.account_balance_usdt_close_date IS
  'Phase 164.6.6.2.1 D-17. For a native-unit key, the date of the stored daily '
  'BTC close that priced account_balance_usdt: the latest completed UTC day''s '
  'close at derive time. The key card prints it as "at {Mon D} close", so it '
  'is a STORED date and never the viewer''s clock. Written only by the analytics '
  'worker''s derive beside account_balance_usdt (service role); no client INSERT '
  'or UPDATE path exists. NULL means no USD value was priced, and is NORMAL for '
  'every USD-family and non-MT5 key. READABLE BY authenticated (column GRANT, '
  '20261010120000), scoped by the owner RLS on api_keys. anon has NO grant.';

COMMENT ON COLUMN public.allocator_holdings.quantity_unit IS
  'Phase 164.6.6.2.1 UI-SPEC F. The unit this row''s quantity is in, for a '
  'native-unit MT5 account row: an upper-case code, 2 to 10 letters '
  '(allocator_holdings_quantity_unit_code), e.g. BTC. Written only by the '
  'positions poll (service role) for a native-unit account row. NULL keeps the '
  'meaning every existing row already has (quantity in the row''s own asset or '
  'contract units), and is NORMAL. The Holdings page renders a unit only from '
  'this column, never inferred from the symbol or the mark.';

-- ───────────── 5. self-verify — CATALOGUE ONLY, passes on an empty database
DO $verify$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(c, ', ') INTO v_missing
    FROM unnest(ARRAY['account_currency', 'account_balance_native', 'account_balance_usdt_close_date']) AS c
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'api_keys' AND column_name = c
   );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 20261010120000 failed: api_keys lacks column(s) %', v_missing;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'allocator_holdings'
       AND column_name = 'quantity_unit'
  ) THEN
    RAISE EXCEPTION 'Migration 20261010120000 failed: allocator_holdings lacks column quantity_unit';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.allocator_holdings'::regclass
       AND conname = 'allocator_holdings_quantity_unit_code'
       AND convalidated
  ) THEN
    RAISE EXCEPTION 'Migration 20261010120000 failed: constraint allocator_holdings_quantity_unit_code is missing or not validated';
  END IF;

  IF NOT has_column_privilege('authenticated', 'public.api_keys', 'account_currency', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.api_keys', 'account_balance_native', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.api_keys', 'account_balance_usdt_close_date', 'SELECT') THEN
    RAISE EXCEPTION 'Migration 20261010120000 failed: authenticated lacks SELECT on account_currency, account_balance_native or account_balance_usdt_close_date';
  END IF;

  -- Anti-leak: anon MUST NOT hold any of the three (migration 20260410225608's
  -- REVOKE-then-allowlist model). If it does, that REVOKE is not holding.
  IF has_column_privilege('anon', 'public.api_keys', 'account_currency', 'SELECT')
     OR has_column_privilege('anon', 'public.api_keys', 'account_balance_native', 'SELECT')
     OR has_column_privilege('anon', 'public.api_keys', 'account_balance_usdt_close_date', 'SELECT') THEN
    RAISE EXCEPTION 'Migration 20261010120000 failed: anon unexpectedly holds SELECT on account_currency, account_balance_native or account_balance_usdt_close_date (migration 20260410225608 REVOKE broken?)';
  END IF;

  -- The worker is the only writer: authenticated holds no write on any of them.
  IF has_column_privilege('authenticated', 'public.api_keys', 'account_currency', 'INSERT')
     OR has_column_privilege('authenticated', 'public.api_keys', 'account_currency', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.api_keys', 'account_balance_native', 'INSERT')
     OR has_column_privilege('authenticated', 'public.api_keys', 'account_balance_native', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.api_keys', 'account_balance_usdt_close_date', 'INSERT')
     OR has_column_privilege('authenticated', 'public.api_keys', 'account_balance_usdt_close_date', 'UPDATE') THEN
    RAISE EXCEPTION 'Migration 20261010120000 failed: authenticated unexpectedly holds INSERT or UPDATE on account_currency, account_balance_native or account_balance_usdt_close_date';
  END IF;

  RAISE NOTICE 'Migration 20261010120000: close-date and quantity_unit columns present, unit CHECK validated, authenticated can SELECT the three api_keys columns and write none, anon holds none.';
END
$verify$;

COMMIT;
