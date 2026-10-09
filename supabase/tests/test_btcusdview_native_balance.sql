-- Test for migration 20261010120000 — Phase 164.6.6.2.1 BTCUSDVIEW, plan 01.
--
-- WHAT THE MIGRATION DOES. A native-unit (non-USD) MT5 account's owner must be
-- able to read three api_keys columns in the browser, and the Holdings page
-- must be able to name the unit of a native row. The migration adds the
-- database half of that and nothing that reads it:
--   * api_keys.account_balance_usdt_close_date (date, NULL) — the stored date
--     of the daily BTC close that priced account_balance_usdt (D-17);
--   * allocator_holdings.quantity_unit (text, NULL) with the CHECK
--     allocator_holdings_quantity_unit_code, `^[A-Z]{2,10}$` (T-164.6.6.2.1-04);
--   * GRANT SELECT (account_currency, account_balance_native,
--     account_balance_usdt_close_date) ON public.api_keys TO authenticated
--     (D-07). anon gets nothing, and authenticated gets no write on any of the
--     three: the analytics worker (service role) is the only writer.
--
-- pgTAP is not set up in this project, so every assertion RAISEs
-- `TEST FAILED (<arm>)` on failure and a clean run prints NOTICEs only.
-- ⚠️ supabase/tests/test_*.sql is the ONLY DB assertion form that runs in CI.
--
-- ⭐ ORDER IS LOAD-BEARING. Each arm below must be the FIRST failure under its
-- own mutation (scripts/mutation-runner), and WAIVED_CEILING is 0, so no arm is
-- waived. The four catalogue arms run first and read no row. BTCUSD-unit-check
-- runs last because it is the only arm that writes a row; its mutation (the
-- CHECK dropped) leaves every catalogue arm green, and none of the catalogue
-- mutations touches the CHECK. The unit-check INSERT is captured in an
-- exception handler and judged after its END (lint rule R1), so a mutation
-- that breaks the INSERT reddens THAT arm by name instead of aborting the file.
--
-- No SET ROLE: has_column_privilege() answers for a named role without
-- becoming it, so no role can leak past an aborted arm.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/test_btcusdview_native_balance.sql
--
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/05-fixture-wizard-composite.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/11-fixture-api-keys-created-at.sql","scripts/pg-lane/fixtures/20-fixture-app-role-helper.sql","scripts/pg-lane/fixtures/21-fixture-api-keys-credential-columns.sql","scripts/pg-lane/fixtures/24-fixture-enqueue-compute-job-chain.sql","supabase/migrations/20260513094906_enable_pg_cron.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/36-fixture-compute-jobs-claim-token.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","supabase/migrations/20260418194206_scoring_weight_overrides.sql","supabase/migrations/20260420073003_allocator_holdings.sql","supabase/migrations/20260420213754_allocator_equity_snapshots.sql","supabase/migrations/20260422101911_api_keys_disconnected_at.sql","supabase/migrations/20260527102050_replace_allocator_equity_snapshots.sql","supabase/migrations/20260529160000_allocator_equity_pre_terminus_flag.sql","supabase/migrations/20260602183000_b5b_api_key_delete_atomicity.sql","supabase/migrations/20260602190000_f6_wizard_session_idempotency.sql","supabase/migrations/20260614120000_derive_broker_dailies_kind.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710180000_wizard_composite.sql","supabase/migrations/20260717233529_allocator_equity_derived_surface.sql","supabase/migrations/20260811210000_api_keys_attested_venue.sql","supabase/migrations/20260812083206_api_keys_venue_account_id.sql","supabase/migrations/20260922120000_api_keys_sync_status_sign_in_failed.sql","supabase/migrations/20260925120000_api_keys_account_identity.sql","supabase/migrations/20260927180000_working_holder_rule_d18.sql","supabase/migrations/20261007120000_api_keys_account_currency.sql","supabase/migrations/20261010120000_btcusdview_native_balance.sql"]}

DO $grants$
BEGIN
  -- ----- BTCUSD-grant: authenticated can SELECT all three owner-readable columns
  -- Without these three grants the key card (D-07, D-17) answers 42501 on every
  -- key list the moment the roster names them.
  -- RED-UNDER: REVOKE SELECT (account_balance_usdt_close_date) ON api_keys FROM
  --            authenticated on the LIVE database. The key card could not read
  --            the date of the close that priced the USD figure.
  -- RED-UNDER-M: {"arm":"BTCUSD-grant","apply":[{"kind":"sql","stmt":"REVOKE SELECT (account_balance_usdt_close_date) ON public.api_keys FROM authenticated"}]}
  IF NOT has_column_privilege('authenticated', 'public.api_keys', 'account_currency', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.api_keys', 'account_balance_native', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.api_keys', 'account_balance_usdt_close_date', 'SELECT') THEN
    RAISE EXCEPTION 'TEST FAILED (BTCUSD-grant): authenticated lacks SELECT on account_currency, account_balance_native or account_balance_usdt_close_date, so the key card cannot read the native balance or the date of the close that priced its USD figure.';
  END IF;

  -- ----- BTCUSD-noanon: anon can NOT read any of the three ---------------------
  -- A live balance and its currency are the owner's, never the public's
  -- (T-164.6.6.2.1-01).
  -- RED-UNDER: GRANT SELECT (account_balance_native) ON api_keys TO anon on the
  --            LIVE database.
  -- RED-UNDER-M: {"arm":"BTCUSD-noanon","apply":[{"kind":"sql","stmt":"GRANT SELECT (account_balance_native) ON public.api_keys TO anon"}]}
  IF has_column_privilege('anon', 'public.api_keys', 'account_currency', 'SELECT')
     OR has_column_privilege('anon', 'public.api_keys', 'account_balance_native', 'SELECT')
     OR has_column_privilege('anon', 'public.api_keys', 'account_balance_usdt_close_date', 'SELECT') THEN
    RAISE EXCEPTION 'TEST FAILED (BTCUSD-noanon): anon holds SELECT on account_currency, account_balance_native or account_balance_usdt_close_date (T-164.6.6.2.1-01).';
  END IF;

  -- ----- BTCUSD-nowrite: authenticated can NOT write any of the three ----------
  -- Only the analytics worker (service role) writes them. A browser session
  -- that could UPDATE the close date or the native balance could forge the
  -- figures the key card shows (T-164.6.6.2.1-02).
  -- RED-UNDER: GRANT UPDATE (account_balance_usdt_close_date) ON api_keys TO
  --            authenticated on the LIVE database.
  -- RED-UNDER-M: {"arm":"BTCUSD-nowrite","apply":[{"kind":"sql","stmt":"GRANT UPDATE (account_balance_usdt_close_date) ON public.api_keys TO authenticated"}]}
  IF has_column_privilege('authenticated', 'public.api_keys', 'account_currency', 'INSERT')
     OR has_column_privilege('authenticated', 'public.api_keys', 'account_currency', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.api_keys', 'account_balance_native', 'INSERT')
     OR has_column_privilege('authenticated', 'public.api_keys', 'account_balance_native', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.api_keys', 'account_balance_usdt_close_date', 'INSERT')
     OR has_column_privilege('authenticated', 'public.api_keys', 'account_balance_usdt_close_date', 'UPDATE') THEN
    RAISE EXCEPTION 'TEST FAILED (BTCUSD-nowrite): authenticated can INSERT or UPDATE account_currency, account_balance_native or account_balance_usdt_close_date (T-164.6.6.2.1-02).';
  END IF;

  -- ----- BTCUSD-closedate-type: the close date is a DATE -------------------------
  -- UI-SPEC E prints "at {Mon D} close" from this column. A text column would
  -- admit "yesterday" or a viewer-clock string, and a timestamp would carry a
  -- time of day the daily close does not have.
  -- RED-UNDER: ALTER COLUMN account_balance_usdt_close_date TYPE text on the
  --            LIVE database.
  -- RED-UNDER-M: {"arm":"BTCUSD-closedate-type","apply":[{"kind":"sql","stmt":"ALTER TABLE public.api_keys ALTER COLUMN account_balance_usdt_close_date TYPE text"}]}
  IF (SELECT data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'api_keys'
         AND column_name = 'account_balance_usdt_close_date') IS DISTINCT FROM 'date' THEN
    RAISE EXCEPTION 'TEST FAILED (BTCUSD-closedate-type): api_keys.account_balance_usdt_close_date is missing or is not of type date.';
  END IF;

  RAISE NOTICE 'PASS (BTCUSD catalogue): authenticated reads the three columns and writes none; anon reads none; the close date is a date.';
END $grants$;


-- Reap fixtures orphaned by a crashed earlier run. Age-scoped so it can never
-- touch a concurrent run's users.
DELETE FROM auth.users
 WHERE email LIKE 'test-btcusd-unit-%@quantalyze.test'
   AND created_at < now() - INTERVAL '1 hour';

DO $unit$
DECLARE
  v_run    text := replace(gen_random_uuid()::text, '-', '');
  uid_a    uuid := gen_random_uuid();
  k_a      uuid := gen_random_uuid();
  v_err    text;
  v_msg    text;
  v_con    text;
  v_count  int;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_a, '00000000-0000-0000-0000-000000000000', 'test-btcusd-unit-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid_a, 'btcusd unit', 'test-btcusd-unit-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (k_a, uid_a, 'okx', 'btcusd unit key', 'enc', true);

  -- ----- BTCUSD-unit-check: a lower-case unit is refused 23514 by the named CHECK
  -- The Holdings Quantity cell renders quantity_unit as label text (UI-SPEC F),
  -- so a garbled string must not be storable (T-164.6.6.2.1-04). The refused
  -- INSERT is captured; the upper-case code and NULL (every existing row's
  -- meaning) must be ADMITTED, so a CHECK that refuses everything is red too.
  -- RED-UNDER: drop the allocator_holdings_quantity_unit_code CHECK on the LIVE
  --            database, so 'btc' is admitted and no 23514 is raised.
  -- RED-UNDER-M: {"arm":"BTCUSD-unit-check","apply":[{"kind":"sql","stmt":"ALTER TABLE public.allocator_holdings DROP CONSTRAINT allocator_holdings_quantity_unit_code"}]}
  v_err := NULL; v_msg := NULL; v_con := NULL;
  BEGIN
    INSERT INTO allocator_holdings
      (allocator_id, api_key_id, venue, symbol, asof, holding_type, side,
       quantity, value_usd, mark_price, quantity_unit)
    VALUES (uid_a, k_a, 'okx', 'BTCLOWER', CURRENT_DATE, 'spot', 'flat', 1, 1, 1, 'btc');
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT, v_con = CONSTRAINT_NAME;
  END;
  IF v_err IS DISTINCT FROM '23514' OR v_con IS DISTINCT FROM 'allocator_holdings_quantity_unit_code' THEN
    RAISE EXCEPTION 'TEST FAILED (BTCUSD-unit-check): inserting quantity_unit = ''btc'' did not raise 23514 on allocator_holdings_quantity_unit_code (SQLSTATE %, constraint %, message %).', v_err, v_con, v_msg;
  END IF;

  v_err := NULL; v_msg := NULL;
  BEGIN
    INSERT INTO allocator_holdings
      (allocator_id, api_key_id, venue, symbol, asof, holding_type, side,
       quantity, value_usd, mark_price, quantity_unit)
    VALUES (uid_a, k_a, 'okx', 'BTCUPPER', CURRENT_DATE, 'spot', 'flat', 1, 1, 1, 'BTC'),
           (uid_a, k_a, 'okx', 'BTCNULL',  CURRENT_DATE, 'spot', 'flat', 1, 1, 1, NULL);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  SELECT count(*) INTO v_count FROM allocator_holdings
   WHERE allocator_id = uid_a AND symbol IN ('BTCUPPER', 'BTCNULL');
  IF v_err IS NOT NULL OR v_count <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (BTCUSD-unit-check): quantity_unit = ''BTC'' or NULL was refused (SQLSTATE %, message %; % of 2 rows stored).', v_err, v_msg, v_count;
  END IF;

  RAISE NOTICE 'PASS (BTCUSD unit): ''btc'' refused 23514 on allocator_holdings_quantity_unit_code; ''BTC'' and NULL admitted.';

  -- ----- cleanup: explicit, rather than relying on the cascade ----------------
  -- allocator_holdings.api_key_id is ON DELETE RESTRICT, so the rows go first.
  DELETE FROM allocator_holdings WHERE allocator_id = uid_a;
  DELETE FROM api_keys WHERE user_id = uid_a;
  DELETE FROM auth.users WHERE id = uid_a;
END $unit$;
