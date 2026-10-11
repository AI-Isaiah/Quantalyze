-- Test for migration 20261011120000 — Phase 170.4 ALLOCHOLDINGS, plan 09 (D-10, D-08).
--
-- WHAT THE MIGRATION DOES. allocator_holdings carried ONE unique index,
-- allocator_holdings_owner_venue_symbol_asof_key on (allocator_id, venue,
-- symbol, asof). Two live keys of one allocator on one venue that hold one
-- symbol on one day therefore collapsed into ONE row at ingestion: the second
-- key's upsert overwrote the first's. D-08 ("One Key is One Strategy") says
-- holdings of different keys are never merged, and D-10 carries that into the
-- database: the unique key gains api_key_id, so every key keeps its own row. The
-- migration creates allocator_holdings_owner_venue_symbol_asof_api_key_key on
-- (allocator_id, venue, symbol, asof, api_key_id), drops the four-column index,
-- refreshes the two comments, and touches no policy, grant, trigger or function.
--
-- pgTAP is not set up in this project, so every assertion RAISEs
-- `TEST FAILED (<arm>)` on failure and a clean run prints NOTICEs only.
-- ⚠️ supabase/tests/test_*.sql is the ONLY DB assertion form that runs in CI.
--
-- ⭐ ORDER IS LOAD-BEARING. Each arm below must be the FIRST failure under its
-- own mutation (scripts/mutation-runner), and WAIVED_CEILING is 0, so no arm is
-- waived. The three row arms run first, in one block, and each is judged AFTER
-- its captured statement (lint rule R1: no probe inside an EXCEPTION handler),
-- so a mutation that breaks a statement reddens THAT arm by name and not the
-- file. The three catalogue arms follow and read no row. For every pair of arms,
-- the mutation of the later one leaves the earlier one green:
--   per-key      <- re-create the four-column unique index (the regression)
--   same-key     <- drop the five-column index (arm per-key still admits two keys)
--   arbiter      <- replace the five-column index by one of the SAME NAME that
--                   also carries holding_type (arms per-key and same-key still
--                   pass; the five-column ON CONFLICT then raises 42P10)
--   catalog      <- add a second unique index on (id, asof) (arms 1-3 never
--                   conflict on it)
--   policies     <- DROP POLICY allocator_holdings_owner_select
--   grants-triggers <- GRANT TRIGGER ON allocator_holdings TO anon
--
-- THE EXPECTATIONS IN arms policies AND grants-triggers ARE MEASURED, NOT COPIED.
-- They were read off a pg-lane cluster that had applied every migration in this
-- file's setup list (the table, its RLS, the TRUNCATE and TRIGGER/MAINTAIN
-- revokes), and typed in by hand. The baseline dump is not the lane's state.
-- MAINTAIN is not asserted: it exists only on PostgreSQL 17+, the revoke
-- migration 20261009150000 owns it, and the gate would otherwise be a function
-- of the server major.
--
-- No SET ROLE: has_table_privilege() answers for a named role without becoming
-- it, so no role can leak past an aborted arm.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/test_allocator_holdings_per_key_unique.sql
--
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/05-fixture-wizard-composite.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/11-fixture-api-keys-created-at.sql","scripts/pg-lane/fixtures/20-fixture-app-role-helper.sql","scripts/pg-lane/fixtures/21-fixture-api-keys-credential-columns.sql","scripts/pg-lane/fixtures/24-fixture-enqueue-compute-job-chain.sql","supabase/migrations/20260513094906_enable_pg_cron.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/36-fixture-compute-jobs-claim-token.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","supabase/migrations/20260418194206_scoring_weight_overrides.sql","supabase/migrations/20260420073003_allocator_holdings.sql","supabase/migrations/20260420213754_allocator_equity_snapshots.sql","supabase/migrations/20260422101911_api_keys_disconnected_at.sql","supabase/migrations/20260527102050_replace_allocator_equity_snapshots.sql","supabase/migrations/20260529160000_allocator_equity_pre_terminus_flag.sql","supabase/migrations/20260602183000_b5b_api_key_delete_atomicity.sql","supabase/migrations/20260602190000_f6_wizard_session_idempotency.sql","supabase/migrations/20260614120000_derive_broker_dailies_kind.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710180000_wizard_composite.sql","supabase/migrations/20260717233529_allocator_equity_derived_surface.sql","supabase/migrations/20260811210000_api_keys_attested_venue.sql","supabase/migrations/20260812083206_api_keys_venue_account_id.sql","supabase/migrations/20260922120000_api_keys_sync_status_sign_in_failed.sql","supabase/migrations/20260925120000_api_keys_account_identity.sql","supabase/migrations/20260927180000_working_holder_rule_d18.sql","supabase/migrations/20261007120000_api_keys_account_currency.sql","supabase/migrations/20261009130000_revoke_truncate_anon_authenticated.sql","supabase/migrations/20261009150000_revoke_trigger_maintain_anon_authenticated.sql","supabase/migrations/20261010120000_btcusdview_native_balance.sql","supabase/migrations/20261011120000_allocator_holdings_per_key_unique.sql"]}

-- Reap fixtures orphaned by a crashed earlier run. Age-scoped so it can never
-- touch a concurrent run's users. Rows first: allocator_holdings.api_key_id is
-- ON DELETE RESTRICT.
DELETE FROM allocator_holdings
 WHERE allocator_id IN (SELECT id FROM auth.users
                         WHERE email LIKE 'test-ahpk-%@quantalyze.test'
                           AND created_at < now() - INTERVAL '1 hour');
DELETE FROM auth.users
 WHERE email LIKE 'test-ahpk-%@quantalyze.test'
   AND created_at < now() - INTERVAL '1 hour';

DO $rows$
DECLARE
  v_run    text := replace(gen_random_uuid()::text, '-', '');
  uid_a    uuid := gen_random_uuid();
  k_a      uuid := gen_random_uuid();
  k_b      uuid := gen_random_uuid();
  v_err    text;
  v_msg    text;
  v_con    text;
  v_err_b  text;
  v_count  int;
  v_qty_a  numeric;
  v_qty_b  numeric;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_a, '00000000-0000-0000-0000-000000000000', 'test-ahpk-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid_a, 'ahpk allocator', 'test-ahpk-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (k_a, uid_a, 'binance', 'ahpk key a', 'enc', true),
         (k_b, uid_a, 'binance', 'ahpk key b', 'enc', true);

  -- ----- per-key: two keys of one allocator each hold BTC spot on one day -------
  -- The reason the index changed (D-08, D-10): under the four-column key the
  -- second key's row is refused 23505 (the writer's upsert would have
  -- overwritten the first instead), so one key's position vanished from the book.
  -- Both inserts are captured and judged after their END.
  -- RED-UNDER: re-create a unique index on (allocator_id, venue, symbol, asof) on
  --            the LIVE database, the four-column key the migration removed, so
  --            the second key's row for the same symbol and day is refused 23505.
  -- RED-UNDER-M: {"arm":"per-key","apply":[{"kind":"sql","stmt":"CREATE UNIQUE INDEX allocator_holdings_gate_four_column_regress ON public.allocator_holdings (allocator_id, venue, symbol, asof)"}]}
  v_err := NULL; v_err_b := NULL;
  BEGIN
    INSERT INTO allocator_holdings
      (allocator_id, api_key_id, venue, symbol, asof, holding_type, side, quantity, value_usd, mark_price)
    VALUES (uid_a, k_a, 'binance', 'BTC', DATE '2026-10-11', 'spot', 'flat', 1, 100, 100);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE;
  END;
  BEGIN
    INSERT INTO allocator_holdings
      (allocator_id, api_key_id, venue, symbol, asof, holding_type, side, quantity, value_usd, mark_price)
    VALUES (uid_a, k_b, 'binance', 'BTC', DATE '2026-10-11', 'spot', 'flat', 1, 100, 100);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err_b = RETURNED_SQLSTATE;
  END;
  SELECT count(*) INTO v_count FROM allocator_holdings
   WHERE allocator_id = uid_a AND venue = 'binance' AND symbol = 'BTC' AND asof = DATE '2026-10-11';
  IF v_err IS NOT NULL OR v_err_b IS NOT NULL OR v_count <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (per-key): two keys of one allocator could not each hold binance BTC spot on one day (SQLSTATE key a %, key b %; % of 2 rows stored). D-08/D-10: every key keeps its own row.', v_err, v_err_b, v_count;
  END IF;

  -- ----- same-key: one key still cannot hold the same row twice ----------------
  -- Widening the key must not remove the idempotency anchor (INGEST-04): the
  -- writer's retry of one key's poll has to land on its own row. Judged on the
  -- SQLSTATE AND the index name, so a unique index of another shape that happens
  -- to refuse the row does not satisfy it.
  -- RED-UNDER: DROP INDEX allocator_holdings_owner_venue_symbol_asof_api_key_key on
  --            the LIVE database, so a key can insert the same (symbol, day) twice.
  -- RED-UNDER-M: {"arm":"same-key","apply":[{"kind":"sql","stmt":"DROP INDEX public.allocator_holdings_owner_venue_symbol_asof_api_key_key"}]}
  v_err := NULL; v_msg := NULL; v_con := NULL;
  BEGIN
    INSERT INTO allocator_holdings
      (allocator_id, api_key_id, venue, symbol, asof, holding_type, side, quantity, value_usd, mark_price)
    VALUES (uid_a, k_a, 'binance', 'BTC', DATE '2026-10-11', 'spot', 'flat', 2, 200, 100);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT, v_con = CONSTRAINT_NAME;
  END;
  IF v_err IS DISTINCT FROM '23505' OR v_con IS DISTINCT FROM 'allocator_holdings_owner_venue_symbol_asof_api_key_key' THEN
    RAISE EXCEPTION 'TEST FAILED (same-key): a second row for one key, symbol and day did not raise 23505 on allocator_holdings_owner_venue_symbol_asof_api_key_key (SQLSTATE %, constraint %, message %).', v_err, v_con, v_msg;
  END IF;

  -- ----- arbiter: the writer's five-column ON CONFLICT updates in place -----------
  -- analytics-service/services/allocator_positions.py upserts on
  -- HOLDINGS_CONFLICT_TARGET = allocator_id,venue,symbol,asof,api_key_id. Postgres
  -- infers the arbiter from a unique index over EXACTLY those columns; with none
  -- the statement raises 42P10. Key a's row is updated and key b's is untouched.
  -- RED-UNDER: on the LIVE database, replace the five-column index by one of the
  --            same name that also carries holding_type, so the five-column
  --            ON CONFLICT has no arbiter (42P10) while arms per-key and
  --            same-key still pass.
  -- RED-UNDER-M: {"arm":"arbiter","apply":[{"kind":"sql","stmt":"DROP INDEX public.allocator_holdings_owner_venue_symbol_asof_api_key_key"},{"kind":"sql","stmt":"CREATE UNIQUE INDEX allocator_holdings_owner_venue_symbol_asof_api_key_key ON public.allocator_holdings (allocator_id, venue, symbol, asof, api_key_id, holding_type)"}]}
  v_err := NULL; v_msg := NULL;
  BEGIN
    INSERT INTO allocator_holdings
      (allocator_id, api_key_id, venue, symbol, asof, holding_type, side, quantity, value_usd, mark_price)
    VALUES (uid_a, k_a, 'binance', 'BTC', DATE '2026-10-11', 'spot', 'flat', 7, 700, 100)
    ON CONFLICT (allocator_id, venue, symbol, asof, api_key_id)
    DO UPDATE SET quantity = EXCLUDED.quantity, value_usd = EXCLUDED.value_usd;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  SELECT count(*) INTO v_count FROM allocator_holdings
   WHERE allocator_id = uid_a AND venue = 'binance' AND symbol = 'BTC' AND asof = DATE '2026-10-11';
  SELECT quantity INTO v_qty_a FROM allocator_holdings WHERE allocator_id = uid_a AND api_key_id = k_a AND symbol = 'BTC';
  SELECT quantity INTO v_qty_b FROM allocator_holdings WHERE allocator_id = uid_a AND api_key_id = k_b AND symbol = 'BTC';
  IF v_err IS NOT NULL OR v_count <> 2 OR v_qty_a IS DISTINCT FROM 7 OR v_qty_b IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'TEST FAILED (arbiter): ON CONFLICT (allocator_id, venue, symbol, asof, api_key_id) DO UPDATE did not update key a''s row in place and leave key b''s alone (SQLSTATE %, message %; % rows; quantity a %, b %).', v_err, v_msg, v_count, v_qty_a, v_qty_b;
  END IF;

  RAISE NOTICE 'PASS (row arms): two keys hold one symbol on one day, one key cannot hold it twice, and the five-column ON CONFLICT updates in place.';

  -- ----- cleanup: explicit, rather than relying on the cascade ------------------
  -- allocator_holdings.api_key_id is ON DELETE RESTRICT, so the rows go first.
  DELETE FROM allocator_holdings WHERE allocator_id = uid_a;
  DELETE FROM api_keys WHERE user_id = uid_a;
  DELETE FROM auth.users WHERE id = uid_a;
END $rows$;


DO $catalog$
DECLARE
  v_unique_count int;
  v_name         text;
  v_cols         text;
  v_pred         boolean;
  v_valid        boolean;
BEGIN
  -- ----- catalog: exactly one non-primary unique index, over the five columns ----
  -- The row arms prove behaviour; this arm proves the SHAPE the writer's pin
  -- (analytics-service/tests/test_persist_holdings_conflict_target.py) binds to:
  -- the five key columns in order, no partial predicate, valid, and no index
  -- under the old name or over the old four columns.
  -- RED-UNDER: CREATE UNIQUE INDEX on (id, asof) on the LIVE database, a second
  --            non-primary unique index that no row arm conflicts on.
  -- RED-UNDER-M: {"arm":"catalog","apply":[{"kind":"sql","stmt":"CREATE UNIQUE INDEX allocator_holdings_gate_extra_unique ON public.allocator_holdings (id, asof)"}]}
  SELECT count(*) INTO v_unique_count
    FROM pg_index i
   WHERE i.indrelid = 'public.allocator_holdings'::regclass
     AND i.indisunique AND NOT i.indisprimary;
  SELECT c.relname,
         (SELECT string_agg(a.attname, ',' ORDER BY k.ord)
            FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
            JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum),
         i.indpred IS NOT NULL,
         i.indisvalid
    INTO v_name, v_cols, v_pred, v_valid
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
   WHERE i.indrelid = 'public.allocator_holdings'::regclass
     AND i.indisunique AND NOT i.indisprimary
   ORDER BY c.relname LIMIT 1;
  IF v_unique_count <> 1
     OR v_name IS DISTINCT FROM 'allocator_holdings_owner_venue_symbol_asof_api_key_key'
     OR v_cols IS DISTINCT FROM 'allocator_id,venue,symbol,asof,api_key_id'
     OR v_pred IS DISTINCT FROM false
     OR v_valid IS DISTINCT FROM true
     OR to_regclass('public.allocator_holdings_owner_venue_symbol_asof_key') IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (catalog): allocator_holdings must carry exactly one non-primary unique index, allocator_holdings_owner_venue_symbol_asof_api_key_key over (allocator_id,venue,symbol,asof,api_key_id), valid and non-partial, and no index under the old name (found % unique index(es); first: % over % partial % valid %).', v_unique_count, v_name, v_cols, v_pred, v_valid;
  END IF;
END $catalog$;


DO $policies$
DECLARE
  v_actual   text;
  v_expected text;
  v_rls      boolean;
BEGIN
  -- ----- policies: the three policies are byte-unchanged -----------------------
  -- The migration touches no policy (T-170.4-23). The expectation is the text
  -- MEASURED on the lane after the setup list, typed by hand: name, command,
  -- USING, WITH CHECK and the role list ({0} is PUBLIC).
  -- RED-UNDER: DROP POLICY allocator_holdings_owner_select on the LIVE database,
  --            so an owner could no longer read their own holdings.
  -- RED-UNDER-M: {"arm":"policies","apply":[{"kind":"sql","stmt":"DROP POLICY allocator_holdings_owner_select ON public.allocator_holdings"}]}
  SELECT string_agg(polname::text || '|' || polcmd::text || '|' || coalesce(pg_get_expr(polqual, polrelid), '')
                    || '|' || coalesce(pg_get_expr(polwithcheck, polrelid), '') || '|' || polroles::text,
                    E'\n' ORDER BY polname)
    INTO v_actual
    FROM pg_policy WHERE polrelid = 'public.allocator_holdings'::regclass;
  v_expected :=
    'allocator_holdings_admin_select|r|current_user_has_app_role(ARRAY[''admin''::text])||{0}' || E'\n' ||
    'allocator_holdings_owner_select|r|(allocator_id = auth.uid())||{0}' || E'\n' ||
    'allocator_holdings_service_all|*|(auth.role() = ''service_role''::text)|(auth.role() = ''service_role''::text)|{0}';
  SELECT relrowsecurity INTO v_rls FROM pg_class WHERE oid = 'public.allocator_holdings'::regclass;
  IF v_actual IS DISTINCT FROM v_expected OR v_rls IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST FAILED (policies): the allocator_holdings policies differ from the lane-measured expectation or RLS is off (RLS %). Actual: %', v_rls, v_actual;
  END IF;
END $policies$;


DO $grants$
DECLARE
  v_anon   text;
  v_authd  text;
  v_svc    text;
  v_trg    text;
BEGIN
  -- ----- grants-triggers: table privileges and the two triggers are unchanged ----
  -- anon and authenticated hold the Supabase default DML privileges (RLS is what
  -- confines them); TRUNCATE and TRIGGER were revoked from both by 20261009130000
  -- and 20261009150000; service_role holds everything. tgtype is compared whole
  -- (23 = ROW|BEFORE|INSERT|UPDATE, 19 = ROW|BEFORE|UPDATE), never by one bit.
  -- RED-UNDER: GRANT TRIGGER ON allocator_holdings TO anon on the LIVE database.
  -- RED-UNDER-M: {"arm":"grants-triggers","apply":[{"kind":"sql","stmt":"GRANT TRIGGER ON public.allocator_holdings TO anon"}]}
  SELECT string_agg(v.verb, ',' ORDER BY v.verb) INTO v_anon
    FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS v(verb)
   WHERE has_table_privilege('anon', 'public.allocator_holdings', v.verb);
  SELECT string_agg(v.verb, ',' ORDER BY v.verb) INTO v_authd
    FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS v(verb)
   WHERE has_table_privilege('authenticated', 'public.allocator_holdings', v.verb);
  SELECT string_agg(v.verb, ',' ORDER BY v.verb) INTO v_svc
    FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS v(verb)
   WHERE has_table_privilege('service_role', 'public.allocator_holdings', v.verb);
  SELECT string_agg(tgname || '=' || tgtype::text, ',' ORDER BY tgname) INTO v_trg
    FROM pg_trigger
   WHERE tgrelid = 'public.allocator_holdings'::regclass AND NOT tgisinternal;
  IF v_anon IS DISTINCT FROM 'DELETE,INSERT,REFERENCES,SELECT,UPDATE'
     OR v_authd IS DISTINCT FROM 'DELETE,INSERT,REFERENCES,SELECT,UPDATE'
     OR v_svc IS DISTINCT FROM 'DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE'
     OR v_trg IS DISTINCT FROM 'allocator_holdings_enforce_owner_coherence=23,allocator_holdings_set_updated_at=19' THEN
    RAISE EXCEPTION 'TEST FAILED (grants-triggers): allocator_holdings privileges or triggers differ from the lane-measured expectation (anon %, authenticated %, service_role %, triggers %).', v_anon, v_authd, v_svc, v_trg;
  END IF;

  RAISE NOTICE 'PASS (allocator_holdings per-key unique): one five-column unique index, three policies and the grants and triggers unchanged.';
END $grants$;
