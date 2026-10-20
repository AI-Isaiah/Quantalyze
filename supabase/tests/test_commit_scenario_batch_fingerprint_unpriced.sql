-- Test for migration 20261011120100 — Phase 170.4 ALLOCHOLDINGS, plan 09, review WR-02
-- (TODOS 170.4-FINGERPRINT-UNPRICED-TWIN).
--
-- RETARGETED 2026-10-20 by Phase 167.1.2.1.2 (O-2): the apply list ends with
-- migration 20261027120000 and the RED-UNDER-M edits target it, so this gate
-- exercises the live commit_scenario_batch body and not the superseded
-- 20261011120100 one (the 167.1.2.1-TWIN-STALE-DEFINITION class).
--
-- WHAT THE MIGRATION DOES. commit_scenario_batch's fingerprint recompute (the
-- `contributing` CTE) now applies the TypeScript reader's native-unpriced rule
-- (fetchLatestHoldingsPerKey, src/lib/latest-holdings-per-key.ts, step 2): a key
-- whose service-written `native_unpriced:<key id>` marker in
-- allocator_equity_derived is dated STRICTLY after its newest rows reads as that
-- day with no rows, so it contributes no token and can move its account's newest
-- day past its siblings'. Before it, an allocator with an unpriced native key
-- could not commit in book mode: the client fingerprint lacked tokens the server
-- still counted, and every commit returned portfolio_fingerprint_stale.
--
-- pgTAP is not set up in this project, so every assertion RAISEs
-- `TEST FAILED (<arm>)` on failure and a clean run prints NOTICEs only.
-- ⚠️ supabase/tests/test_*.sql is the ONLY DB assertion form that runs in CI.
--
-- THE FIXTURE (allocator A, hand-typed):
--   key-u  (mt5, its own account) one spot row ACCOUNT-U on 2026-10-09, and the
--          marker native_unpriced:<key-u> = {"native_unpriced": true, "asof": "2026-10-10"};
--   key-s  (mt5, marked a `duplicate` of key-u) one spot row ACCOUNT-S on 2026-10-09;
--   key-b  (binance, its own account) one spot row BTC on 2026-10-10.
-- The marker makes key-u's reading 2026-10-10 with no rows, which moves the
-- account {key-u, key-s} newest day to 2026-10-10, so key-s (rows on 2026-10-09)
-- drops with it. The reader and the RPC both count `BTC:binance:spot` only. The two
-- literals marked PARITY-FINGERPRINT below are read out of THIS file by
-- src/lib/fingerprint-unpriced-parity.test.ts, which computes the same fingerprints
-- through the TypeScript path (fetchLatestHoldingsPerKey, derivePhase07Fields,
-- computeHoldingsFingerprint) on the same rows, so the two runtimes are bound to
-- the same bytes.
--
-- HOW AN ARM JUDGES "NOT REFUSED". The pg-lane hosts the function through
-- scripts/pg-lane/fixtures/38-fixture-commit-scenario-batch-hosts.sql, which
-- supplies only the objects the recompute and the migration's verify block read.
-- It has no match_decisions, no bridge_outcomes and no idempotency table. Each call
-- therefore passes a diff of an unknown kind and no idempotency key: a fingerprint
-- that matches falls through to the diff loop and raises 22023 `unknown kind`,
-- while a fingerprint that diverges returns ok:false code
-- portfolio_fingerprint_stale BEFORE the loop. The call is captured in an
-- EXCEPTION block and judged after its END, by SQLSTATE, message and envelope
-- (lint rule R1), so a later validation error is judged by its code and never
-- aborts the file.
--
-- ⭐ ORDER IS LOAD-BEARING. Each arm must be the FIRST failure under its own
-- mutation (scripts/mutation-runner), and WAIVED_CEILING is 0:
--   unpriced-dropped     <- an `edit` of the migration that removes the unpriced arm
--                           from key_day (arm older-marker-ignored never runs first);
--   older-marker-ignored <- an `edit` that drops the day comparison, so ANY marker
--                           removes the key (arm unpriced-dropped still passes: its
--                           marker IS dated after the rows).
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/test_commit_scenario_batch_fingerprint_unpriced.sql
--
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/05-fixture-wizard-composite.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/11-fixture-api-keys-created-at.sql","scripts/pg-lane/fixtures/20-fixture-app-role-helper.sql","scripts/pg-lane/fixtures/21-fixture-api-keys-credential-columns.sql","scripts/pg-lane/fixtures/24-fixture-enqueue-compute-job-chain.sql","supabase/migrations/20260513094906_enable_pg_cron.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/36-fixture-compute-jobs-claim-token.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","supabase/migrations/20260418194206_scoring_weight_overrides.sql","supabase/migrations/20260420073003_allocator_holdings.sql","supabase/migrations/20260420213754_allocator_equity_snapshots.sql","supabase/migrations/20260422101911_api_keys_disconnected_at.sql","supabase/migrations/20260527102050_replace_allocator_equity_snapshots.sql","supabase/migrations/20260529160000_allocator_equity_pre_terminus_flag.sql","supabase/migrations/20260602183000_b5b_api_key_delete_atomicity.sql","supabase/migrations/20260602190000_f6_wizard_session_idempotency.sql","supabase/migrations/20260614120000_derive_broker_dailies_kind.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710180000_wizard_composite.sql","supabase/migrations/20260717233529_allocator_equity_derived_surface.sql","supabase/migrations/20260811210000_api_keys_attested_venue.sql","supabase/migrations/20260812083206_api_keys_venue_account_id.sql","supabase/migrations/20260922120000_api_keys_sync_status_sign_in_failed.sql","supabase/migrations/20260925120000_api_keys_account_identity.sql","supabase/migrations/20260927180000_working_holder_rule_d18.sql","supabase/migrations/20261007120000_api_keys_account_currency.sql","supabase/migrations/20261009130000_revoke_truncate_anon_authenticated.sql","supabase/migrations/20261009150000_revoke_trigger_maintain_anon_authenticated.sql","supabase/migrations/20261010120000_btcusdview_native_balance.sql","scripts/pg-lane/fixtures/38-fixture-commit-scenario-batch-hosts.sql","supabase/migrations/20261011120100_commit_scenario_batch_fingerprint_unpriced.sql","supabase/migrations/20261027120000_commit_scenario_batch_fingerprint_sameday_empty.sql"]}

-- Reap fixtures orphaned by a crashed earlier run. Age-scoped so it can never
-- touch a concurrent run's users. Rows first: allocator_holdings.api_key_id is
-- ON DELETE RESTRICT.
DELETE FROM allocator_holdings
 WHERE allocator_id IN (SELECT id FROM auth.users
                         WHERE email LIKE 'test-fpu-%@quantalyze.test'
                           AND created_at < now() - INTERVAL '1 hour');
DELETE FROM auth.users
 WHERE email LIKE 'test-fpu-%@quantalyze.test'
   AND created_at < now() - INTERVAL '1 hour';

DO $unpriced$
DECLARE
  v_run     text := replace(gen_random_uuid()::text, '-', '');
  uid_a     uuid := gen_random_uuid();
  k_u       uuid := gen_random_uuid();
  k_s       uuid := gen_random_uuid();
  k_b       uuid := gen_random_uuid();
  -- PARITY-FINGERPRINT(unpriced-dropped): BTC:binance:spot
  v_fp_dropped CONSTANT text := 'BTC:binance:spot';
  -- PARITY-FINGERPRINT(older-marker-ignored): ACCOUNT-S:mt5:spot|ACCOUNT-U:mt5:spot|BTC:binance:spot
  v_fp_older   CONSTANT text := 'ACCOUNT-S:mt5:spot|ACCOUNT-U:mt5:spot|BTC:binance:spot';
  v_res     jsonb;
  v_state   text;
  v_msg     text;
  v_res_b   jsonb;
  v_state_b text;
  v_msg_b   text;
  v_diffs   jsonb := jsonb_build_array(jsonb_build_object('kind', 'gate_unknown_kind'));
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_a, '00000000-0000-0000-0000-000000000000', 'test-fpu-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid_a, 'fpu allocator', 'test-fpu-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (k_u, uid_a, 'mt5', 'fpu key u', 'enc', true),
         (k_b, uid_a, 'binance', 'fpu key b', 'enc', true);
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active,
                        account_share_kind, account_shared_with_api_key_id)
  VALUES (k_s, uid_a, 'mt5', 'fpu key s', 'enc', true, 'duplicate', k_u);
  INSERT INTO allocator_holdings
    (allocator_id, api_key_id, venue, symbol, asof, holding_type, side, quantity, value_usd, mark_price)
  VALUES (uid_a, k_u, 'mt5',     'ACCOUNT-U', DATE '2026-10-09', 'spot', 'flat', 1, 100, 100),
         (uid_a, k_s, 'mt5',     'ACCOUNT-S', DATE '2026-10-09', 'spot', 'flat', 1, 100, 100),
         (uid_a, k_b, 'binance', 'BTC',       DATE '2026-10-10', 'spot', 'flat', 1, 100, 100);
  INSERT INTO allocator_equity_derived (allocator_id, kind, payload)
  VALUES (uid_a, 'native_unpriced:' || k_u::text,
          '{"native_unpriced": true, "asof": "2026-10-10"}'::jsonb);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);

  -- ----- unpriced-dropped: the marker removes key-u and, with it, key-s -----------
  -- Two calls, judged after their ENDs. The fingerprint the reader produces on this
  -- book (BTC:binance:spot) must NOT be refused: it falls through to the diff loop
  -- and raises 22023 `unknown kind`. The three-token fingerprint (today's recompute
  -- before this migration: ACCOUNT-S, ACCOUNT-U and BTC) MUST be refused, so a
  -- recompute that stops dropping the key is caught from both sides.
  -- RED-UNDER: remove the unpriced arm from key_day in the migration, so key-u and
  --            key-s read their rows again and the server set is the three tokens.
  -- RED-UNDER-M: {"arm":"unpriced-dropped","apply":[{"kind":"edit","file":"supabase/migrations/20261027120000_commit_scenario_batch_fingerprint_sameday_empty.sql","find":"CASE WHEN r.unpriced_after_rows THEN p.unpriced_day\n                  WHEN r.polled_after_rows THEN p.poll_day","replace":"CASE WHEN r.polled_after_rows THEN p.poll_day","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261027120000_commit_scenario_batch_fingerprint_sameday_empty.sql","find":"NOT (r.unpriced_after_rows OR r.polled_after_rows OR r.same_day_empty) AS has_rows","replace":"NOT (r.polled_after_rows OR r.same_day_empty) AS has_rows","occurrences":1}]}
  BEGIN
    v_res := public.commit_scenario_batch(uid_a, v_diffs, NULL, NULL, v_fp_dropped);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  BEGIN
    v_res_b := public.commit_scenario_batch(uid_a, v_diffs, NULL, NULL, v_fp_older);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state_b = RETURNED_SQLSTATE, v_msg_b = MESSAGE_TEXT;
  END;
  IF v_res IS NOT NULL OR v_state IS DISTINCT FROM '22023' OR v_msg NOT LIKE '%unknown kind%' THEN
    RAISE EXCEPTION 'TEST FAILED (unpriced-dropped): the reader''s fingerprint % was refused or did not reach the diff loop (envelope %, SQLSTATE %, message %).', v_fp_dropped, v_res, v_state, v_msg;
  END IF;
  IF v_state_b IS NOT NULL OR (v_res_b->>'ok')::boolean IS NOT FALSE
     OR v_res_b->'errors'->0->>'code' IS DISTINCT FROM 'portfolio_fingerprint_stale' THEN
    RAISE EXCEPTION 'TEST FAILED (unpriced-dropped): the three-token fingerprint % was not refused as portfolio_fingerprint_stale although the marker removes key-u and key-s (envelope %, SQLSTATE %, message %).', v_fp_older, v_res_b, v_state_b, v_msg_b;
  END IF;

  -- ----- older-marker-ignored: a marker dated BEFORE the rows removes nothing ------
  -- Same keys, the marker moved to 2026-10-08 (before key-u's rows). The reader's
  -- check is STRICTLY after the key's latest rows, so the marker is ignored and all
  -- three tokens count: the three-token fingerprint is NOT refused.
  -- RED-UNDER: drop the day comparison from unpriced_after_rows in the migration, so
  --            any marker removes its key.
  -- RED-UNDER-M: {"arm":"older-marker-ignored","apply":[{"kind":"edit","file":"supabase/migrations/20261027120000_commit_scenario_batch_fingerprint_sameday_empty.sql","find":"OR p.unpriced_day COLLATE \"C\" > p.latest_day COLLATE \"C\")) AS unpriced_after_rows","replace":"OR TRUE)) AS unpriced_after_rows","occurrences":1}]}
  UPDATE allocator_equity_derived
     SET payload = '{"native_unpriced": true, "asof": "2026-10-08"}'::jsonb
   WHERE allocator_id = uid_a AND kind = 'native_unpriced:' || k_u::text;
  v_res := NULL; v_state := NULL; v_msg := NULL;
  BEGIN
    v_res := public.commit_scenario_batch(uid_a, v_diffs, NULL, NULL, v_fp_older);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_res IS NOT NULL OR v_state IS DISTINCT FROM '22023' OR v_msg NOT LIKE '%unknown kind%' THEN
    RAISE EXCEPTION 'TEST FAILED (older-marker-ignored): with the marker dated before the rows the three-token fingerprint % was refused or did not reach the diff loop (envelope %, SQLSTATE %, message %).', v_fp_older, v_res, v_state, v_msg;
  END IF;

  RAISE NOTICE 'PASS (fingerprint unpriced): a marker dated after the rows drops its key and its account siblings from the recompute; a marker dated before them drops nothing.';

  -- ----- cleanup: explicit, rather than relying on the cascade ------------------
  -- allocator_holdings.api_key_id is ON DELETE RESTRICT, so the rows go first.
  DELETE FROM allocator_equity_derived WHERE allocator_id = uid_a;
  DELETE FROM allocator_holdings WHERE allocator_id = uid_a;
  DELETE FROM api_keys WHERE user_id = uid_a;
  DELETE FROM profiles WHERE id = uid_a;
  DELETE FROM auth.users WHERE id = uid_a;
END $unpriced$;
