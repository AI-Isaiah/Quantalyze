-- Test for migration 20261027120000 — Phase 167.1.2.1.2 HISTORYREADER, plan 05
-- (D-02, orchestrator decisions O-1, O-2, O-3, O-6).
--
-- WHAT THE MIGRATION DOES. commit_scenario_batch's fingerprint recompute (the
-- `contributing` CTE) now applies the TypeScript reader's D-02 rule
-- (fetchLatestHoldingsPerKey, src/lib/latest-holdings-per-key.ts, the branch
-- after the strict clean-poll one): a key whose NEWEST poll event of ANY outcome
-- (allocator.holdings.sync_completed) is a clean poll (final_status 'complete')
-- that read zero rows (row_count 0), dated the key's own latest rows' day, reads
-- as that day with NO rows. persist_allocator_holdings only upserts, so a
-- position closed and polled empty on the rows' own day leaves that day's earlier
-- rows in place; the strict `poll_day > latest_day` arm cannot see it. The
-- dashboard hides the key (plan 01) and the browser fingerprints what it shows,
-- so without this migration every book-mode commit of such a book would be
-- refused portfolio_fingerprint_stale, and no refresh could clear it.
--
-- pgTAP is not set up in this project, so every assertion RAISEs
-- `TEST FAILED (<arm>)` on failure and a clean run prints NOTICEs only.
-- ⚠️ supabase/tests/test_*.sql is the ONLY DB assertion form that runs in CI.
--
-- THE FIXTURE (allocator A, hand-typed):
--   key-k (binance, its own account) one spot row BTC on 2026-10-10, and two poll
--         events, oldest first: clean row_count 1 asof 2026-10-10, then clean
--         row_count 0 asof 2026-10-10 (the position closed and the next poll
--         read nothing, the same day);
--   key-l (bybit, its own account) one spot row ETH on 2026-10-10 and no event.
-- key-l is the always-kept key: it keeps the dropped fingerprint non-empty (an empty
-- client fingerprint skips the precondition altogether, and the arm would pass
-- vacuously). The reader and the RPC both count `ETH:bybit:spot` only. The literal
-- marked PARITY-FINGERPRINT below is read out of THIS file by
-- src/lib/fingerprint-sameday-empty-parity.test.ts, which computes the same
-- fingerprint through the TypeScript path (fetchLatestHoldingsPerKey,
-- derivePhase07Fields, computeHoldingsFingerprint) on the same rows and events, so
-- the two runtimes are bound to the same bytes.
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
-- mutation (scripts/mutation-runner), and WAIVED_CEILING is 0. Six arms, each its
-- own DO block with its own allocator, in this order (the file stops at the first
-- failure, so every arm above an arm's mutation must still pass under it):
--   sameday-empty-dropped    <- an `edit` that removes same_day_empty from
--                               key_day.has_rows, so key-k reads its rows again.
--                               The first arm: no other arm runs before it.
--   sameday-nonempty-kept    <- an `edit` that turns the row_count <> 0 guard into
--                               FALSE. The tracer's polls read zero rows, so the
--                               guard never matters there and it passes.
--   later-warnings-poll-kept <- an `edit` that filters newest_meta to final_status
--                               'complete'. The tracer's newest poll is already
--                               clean and the nonempty arm's single poll is clean
--                               with one row, so both still pass.
--   warnings-empty-kept      <- an `edit` that turns the final_status guard of
--                               empty_day into FALSE. The arms above never put a
--                               zero-row poll behind a non-clean status (the later
--                               warnings poll reads ONE row, so the row_count guard
--                               still keeps it), so they pass.
--   older-empty-day-kept     <- an `edit` that loosens the equality to <=. Every
--                               arm above has an empty_day equal to the rows' day
--                               or none at all, so none of them can tell = from <=.
--   sameday-empty-sibling-older <- an `edit` that gives a same_day_empty key a NULL day
--                               in key_day. Every arm above puts the emptied key on its
--                               own account, where its day moves no sibling, so none of
--                               them can tell that the day matters.
-- Each keep arm is two-sided: the fingerprint WITH key-k passes the precondition
-- and the one WITHOUT it is refused, so a keep arm cannot pass under a recompute
-- that drops everything.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/test_commit_scenario_batch_fingerprint_sameday_empty.sql
--
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/05-fixture-wizard-composite.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/11-fixture-api-keys-created-at.sql","scripts/pg-lane/fixtures/20-fixture-app-role-helper.sql","scripts/pg-lane/fixtures/21-fixture-api-keys-credential-columns.sql","scripts/pg-lane/fixtures/24-fixture-enqueue-compute-job-chain.sql","supabase/migrations/20260513094906_enable_pg_cron.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/36-fixture-compute-jobs-claim-token.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","supabase/migrations/20260418194206_scoring_weight_overrides.sql","supabase/migrations/20260420073003_allocator_holdings.sql","supabase/migrations/20260420213754_allocator_equity_snapshots.sql","supabase/migrations/20260422101911_api_keys_disconnected_at.sql","supabase/migrations/20260527102050_replace_allocator_equity_snapshots.sql","supabase/migrations/20260529160000_allocator_equity_pre_terminus_flag.sql","supabase/migrations/20260602183000_b5b_api_key_delete_atomicity.sql","supabase/migrations/20260602190000_f6_wizard_session_idempotency.sql","supabase/migrations/20260614120000_derive_broker_dailies_kind.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710180000_wizard_composite.sql","supabase/migrations/20260717233529_allocator_equity_derived_surface.sql","supabase/migrations/20260811210000_api_keys_attested_venue.sql","supabase/migrations/20260812083206_api_keys_venue_account_id.sql","supabase/migrations/20260922120000_api_keys_sync_status_sign_in_failed.sql","supabase/migrations/20260925120000_api_keys_account_identity.sql","supabase/migrations/20260927180000_working_holder_rule_d18.sql","supabase/migrations/20261007120000_api_keys_account_currency.sql","supabase/migrations/20261009130000_revoke_truncate_anon_authenticated.sql","supabase/migrations/20261009150000_revoke_trigger_maintain_anon_authenticated.sql","supabase/migrations/20261010120000_btcusdview_native_balance.sql","scripts/pg-lane/fixtures/38-fixture-commit-scenario-batch-hosts.sql","supabase/migrations/20261011120100_commit_scenario_batch_fingerprint_unpriced.sql","supabase/migrations/20261027120000_commit_scenario_batch_fingerprint_sameday_empty.sql"]}

-- Reap fixtures orphaned by a crashed earlier run. Age-scoped so it can never
-- touch a concurrent run's users. Rows first: allocator_holdings.api_key_id is
-- ON DELETE RESTRICT.
DELETE FROM allocator_holdings
 WHERE allocator_id IN (SELECT id FROM auth.users
                         WHERE email LIKE 'test-fpsd-%@quantalyze.test'
                           AND created_at < now() - INTERVAL '1 hour');
DELETE FROM audit_log
 WHERE user_id IN (SELECT id FROM auth.users
                    WHERE email LIKE 'test-fpsd-%@quantalyze.test'
                      AND created_at < now() - INTERVAL '1 hour');
DELETE FROM auth.users
 WHERE email LIKE 'test-fpsd-%@quantalyze.test'
   AND created_at < now() - INTERVAL '1 hour';

DO $sameday$
DECLARE
  v_run     text := replace(gen_random_uuid()::text, '-', '');
  uid_a     uuid := gen_random_uuid();
  k_k       uuid := gen_random_uuid();
  k_l       uuid := gen_random_uuid();
  -- PARITY-FINGERPRINT(sameday-empty-dropped): ETH:bybit:spot
  v_fp_dropped CONSTANT text := 'ETH:bybit:spot';
  -- The fingerprint a recompute that still counted key-k would hold. It is the
  -- other half of the two-sided arm and is not bound to the TypeScript path.
  v_fp_both    CONSTANT text := 'BTC:binance:spot|ETH:bybit:spot';
  v_res     jsonb;
  v_state   text;
  v_msg     text;
  v_res_b   jsonb;
  v_state_b text;
  v_msg_b   text;
  v_diffs   jsonb := jsonb_build_array(jsonb_build_object('kind', 'gate_unknown_kind'));
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_a, '00000000-0000-0000-0000-000000000000', 'test-fpsd-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid_a, 'fpsd allocator', 'test-fpsd-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (k_k, uid_a, 'binance', 'fpsd key k', 'enc', true),
         (k_l, uid_a, 'bybit',   'fpsd key l', 'enc', true);
  INSERT INTO allocator_holdings
    (allocator_id, api_key_id, venue, symbol, asof, holding_type, side, quantity, value_usd, mark_price)
  VALUES (uid_a, k_k, 'binance', 'BTC', DATE '2026-10-10', 'spot', 'flat', 1, 100, 100),
         (uid_a, k_l, 'bybit',   'ETH', DATE '2026-10-10', 'spot', 'flat', 1, 100, 100);
  -- Explicit, ordered created_at: the newest-event read is `created_at DESC`.
  INSERT INTO audit_log (user_id, action, entity_type, entity_id, metadata, created_at)
  VALUES (uid_a, 'allocator.holdings.sync_completed', 'api_key', k_k,
          '{"final_status": "complete", "row_count": 1, "asof": "2026-10-10"}'::jsonb,
          now() - INTERVAL '2 hours'),
         (uid_a, 'allocator.holdings.sync_completed', 'api_key', k_k,
          '{"final_status": "complete", "row_count": 0, "asof": "2026-10-10"}'::jsonb,
          now() - INTERVAL '1 hour');

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);

  -- ----- sameday-empty-dropped: the newest poll read nothing on the rows' own day ---
  -- Two calls, judged after their ENDs. The fingerprint the reader produces on this
  -- book (ETH:bybit:spot) must NOT be refused: it falls through to the diff loop and
  -- raises 22023 `unknown kind`. The two-token fingerprint (the recompute before this
  -- migration, which still counted key-k's BTC row) MUST be refused, so a recompute
  -- that stops dropping the key is caught from both sides.
  -- RED-UNDER: remove same_day_empty from key_day.has_rows in the migration, so
  --            key-k reads its rows again and the server set is the two tokens.
  -- RED-UNDER-M: {"arm":"sameday-empty-dropped","apply":[{"kind":"edit","file":"supabase/migrations/20261027120000_commit_scenario_batch_fingerprint_sameday_empty.sql","find":"NOT (r.unpriced_after_rows OR r.polled_after_rows OR r.same_day_empty) AS has_rows","replace":"NOT (r.unpriced_after_rows OR r.polled_after_rows) AS has_rows","occurrences":1}]}
  BEGIN
    v_res := public.commit_scenario_batch(uid_a, v_diffs, NULL, NULL, v_fp_dropped);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  BEGIN
    v_res_b := public.commit_scenario_batch(uid_a, v_diffs, NULL, NULL, v_fp_both);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state_b = RETURNED_SQLSTATE, v_msg_b = MESSAGE_TEXT;
  END;
  IF v_res IS NOT NULL OR v_state IS DISTINCT FROM '22023' OR v_msg NOT LIKE '%unknown kind%' THEN
    RAISE EXCEPTION 'TEST FAILED (sameday-empty-dropped): the reader''s fingerprint % was refused or did not reach the diff loop (envelope %, SQLSTATE %, message %).', v_fp_dropped, v_res, v_state, v_msg;
  END IF;
  IF v_state_b IS NOT NULL OR (v_res_b->>'ok')::boolean IS NOT FALSE
     OR v_res_b->'errors'->0->>'code' IS DISTINCT FROM 'portfolio_fingerprint_stale' THEN
    RAISE EXCEPTION 'TEST FAILED (sameday-empty-dropped): the two-token fingerprint % was not refused as portfolio_fingerprint_stale although key-k''s newest poll read nothing on its rows'' own day (envelope %, SQLSTATE %, message %).', v_fp_both, v_res_b, v_state_b, v_msg_b;
  END IF;

  RAISE NOTICE 'PASS (fingerprint sameday-empty): a key whose newest poll read nothing on its rows'' own day drops out of the recompute.';

  -- ----- cleanup: explicit, rather than relying on the cascade ------------------
  -- allocator_holdings.api_key_id is ON DELETE RESTRICT, so the rows go first.
  DELETE FROM allocator_holdings WHERE allocator_id = uid_a;
  DELETE FROM audit_log WHERE user_id = uid_a;
  DELETE FROM api_keys WHERE user_id = uid_a;
  DELETE FROM profiles WHERE id = uid_a;
  DELETE FROM auth.users WHERE id = uid_a;
END $sameday$;

-- ===== sameday-nonempty-kept: the newest poll is clean but read ONE row on the rows' own day =====
-- Own allocator, own fixture. key-k (binance) holds BTC on 2026-10-10; key-l (bybit)
-- holds ETH on 2026-10-10 and is the always-kept key. Poll events, oldest first (the
-- newest-event read is `created_at DESC`, so created_at is explicit):
--   complete row_count 1 asof 2026-10-10
-- The rule keeps key-k, so the fingerprint WITH its token (the reader's output, bound
-- to the TypeScript path below) must NOT be refused, and the fingerprint WITHOUT it
-- (what a recompute that wrongly dropped key-k would hold) MUST be refused.
DO $sdnonempty$
DECLARE
  v_run     text := replace(gen_random_uuid()::text, '-', '');
  uid_a     uuid := gen_random_uuid();
  k_k       uuid := gen_random_uuid();
  k_l       uuid := gen_random_uuid();
  -- PARITY-FINGERPRINT(sameday-nonempty-kept): BTC:binance:spot|ETH:bybit:spot
  v_fp_kept    CONSTANT text := 'BTC:binance:spot|ETH:bybit:spot';
  -- The other half of the two-sided arm; not bound to the TypeScript path.
  v_fp_without CONSTANT text := 'ETH:bybit:spot';
  v_res     jsonb;
  v_state   text;
  v_msg     text;
  v_res_b   jsonb;
  v_state_b text;
  v_msg_b   text;
  v_diffs   jsonb := jsonb_build_array(jsonb_build_object('kind', 'gate_unknown_kind'));
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_a, '00000000-0000-0000-0000-000000000000', 'test-fpsd-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid_a, 'fpsd allocator', 'test-fpsd-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (k_k, uid_a, 'binance', 'fpsd key k', 'enc', true),
         (k_l, uid_a, 'bybit',   'fpsd key l', 'enc', true);
  INSERT INTO allocator_holdings
    (allocator_id, api_key_id, venue, symbol, asof, holding_type, side, quantity, value_usd, mark_price)
  VALUES (uid_a, k_k, 'binance', 'BTC', DATE '2026-10-10', 'spot', 'flat', 1, 100, 100),
         (uid_a, k_l, 'bybit',   'ETH', DATE '2026-10-10', 'spot', 'flat', 1, 100, 100);
  INSERT INTO audit_log (user_id, action, entity_type, entity_id, metadata, created_at)
  VALUES
         (uid_a, 'allocator.holdings.sync_completed', 'api_key', k_k,
          '{"final_status": "complete", "row_count": 1, "asof": "2026-10-10"}'::jsonb,
          now() - INTERVAL '1 hour');

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);

  -- RED-UNDER: remove the row_count <> 0 guard from empty_day in the migration, so a clean poll that
  --            read a row counts as a read-nothing poll and key-k is dropped.
  -- RED-UNDER-M: {"arm":"sameday-nonempty-kept","apply":[{"kind":"edit","file":"supabase/migrations/20261027120000_commit_scenario_batch_fingerprint_sameday_empty.sql","find":"WHEN (e.newest_meta->>'row_count')::numeric <> 0 THEN NULL","replace":"WHEN FALSE THEN NULL","occurrences":1}]}
  BEGIN
    v_res := public.commit_scenario_batch(uid_a, v_diffs, NULL, NULL, v_fp_kept);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  BEGIN
    v_res_b := public.commit_scenario_batch(uid_a, v_diffs, NULL, NULL, v_fp_without);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state_b = RETURNED_SQLSTATE, v_msg_b = MESSAGE_TEXT;
  END;
  IF v_res IS NOT NULL OR v_state IS DISTINCT FROM '22023' OR v_msg NOT LIKE '%unknown kind%' THEN
    RAISE EXCEPTION 'TEST FAILED (sameday-nonempty-kept): the reader''s fingerprint % was refused or did not reach the diff loop (envelope %, SQLSTATE %, message %).', v_fp_kept, v_res, v_state, v_msg;
  END IF;
  IF v_state_b IS NOT NULL OR (v_res_b->>'ok')::boolean IS NOT FALSE
     OR v_res_b->'errors'->0->>'code' IS DISTINCT FROM 'portfolio_fingerprint_stale' THEN
    RAISE EXCEPTION 'TEST FAILED (sameday-nonempty-kept): the fingerprint % without key-k was not refused as portfolio_fingerprint_stale although key-k stays in the recompute (envelope %, SQLSTATE %, message %).', v_fp_without, v_res_b, v_state_b, v_msg_b;
  END IF;

  RAISE NOTICE 'PASS (fingerprint sameday-nonempty-kept): key-k stays in the recompute.';

  DELETE FROM allocator_holdings WHERE allocator_id = uid_a;
  DELETE FROM audit_log WHERE user_id = uid_a;
  DELETE FROM api_keys WHERE user_id = uid_a;
  DELETE FROM profiles WHERE id = uid_a;
  DELETE FROM auth.users WHERE id = uid_a;
END $sdnonempty$;

-- ===== later-warnings-poll-kept: a clean empty poll is followed by a later poll that finished with warnings =====
-- Own allocator, own fixture. key-k (binance) holds BTC on 2026-10-10; key-l (bybit)
-- holds ETH on 2026-10-10 and is the always-kept key. Poll events, oldest first (the
-- newest-event read is `created_at DESC`, so created_at is explicit):
--   complete row_count 0 asof 2026-10-10
--   complete_with_warnings row_count 1 asof 2026-10-10
-- The rule keeps key-k, so the fingerprint WITH its token (the reader's output, bound
-- to the TypeScript path below) must NOT be refused, and the fingerprint WITHOUT it
-- (what a recompute that wrongly dropped key-k would hold) MUST be refused.
DO $laterwarn$
DECLARE
  v_run     text := replace(gen_random_uuid()::text, '-', '');
  uid_a     uuid := gen_random_uuid();
  k_k       uuid := gen_random_uuid();
  k_l       uuid := gen_random_uuid();
  -- PARITY-FINGERPRINT(later-warnings-poll-kept): BTC:binance:spot|ETH:bybit:spot
  v_fp_kept    CONSTANT text := 'BTC:binance:spot|ETH:bybit:spot';
  -- The other half of the two-sided arm; not bound to the TypeScript path.
  v_fp_without CONSTANT text := 'ETH:bybit:spot';
  v_res     jsonb;
  v_state   text;
  v_msg     text;
  v_res_b   jsonb;
  v_state_b text;
  v_msg_b   text;
  v_diffs   jsonb := jsonb_build_array(jsonb_build_object('kind', 'gate_unknown_kind'));
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_a, '00000000-0000-0000-0000-000000000000', 'test-fpsd-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid_a, 'fpsd allocator', 'test-fpsd-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (k_k, uid_a, 'binance', 'fpsd key k', 'enc', true),
         (k_l, uid_a, 'bybit',   'fpsd key l', 'enc', true);
  INSERT INTO allocator_holdings
    (allocator_id, api_key_id, venue, symbol, asof, holding_type, side, quantity, value_usd, mark_price)
  VALUES (uid_a, k_k, 'binance', 'BTC', DATE '2026-10-10', 'spot', 'flat', 1, 100, 100),
         (uid_a, k_l, 'bybit',   'ETH', DATE '2026-10-10', 'spot', 'flat', 1, 100, 100);
  INSERT INTO audit_log (user_id, action, entity_type, entity_id, metadata, created_at)
  VALUES
         (uid_a, 'allocator.holdings.sync_completed', 'api_key', k_k,
          '{"final_status": "complete", "row_count": 0, "asof": "2026-10-10"}'::jsonb,
          now() - INTERVAL '2 hours'),
         (uid_a, 'allocator.holdings.sync_completed', 'api_key', k_k,
          '{"final_status": "complete_with_warnings", "row_count": 1, "asof": "2026-10-10"}'::jsonb,
          now() - INTERVAL '1 hour');

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);

  -- RED-UNDER: filter newest_meta to final_status 'complete' in the migration, so the subquery reads the
  --            older clean empty poll instead of the later warnings poll and key-k is dropped.
  -- RED-UNDER-M: {"arm":"later-warnings-poll-kept","apply":[{"kind":"edit","file":"supabase/migrations/20261027120000_commit_scenario_batch_fingerprint_sameday_empty.sql","find":"-- D-02: no final_status filter: the newest poll of ANY outcome","replace":"AND al.metadata->>'final_status' = 'complete'","occurrences":1}]}
  BEGIN
    v_res := public.commit_scenario_batch(uid_a, v_diffs, NULL, NULL, v_fp_kept);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  BEGIN
    v_res_b := public.commit_scenario_batch(uid_a, v_diffs, NULL, NULL, v_fp_without);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state_b = RETURNED_SQLSTATE, v_msg_b = MESSAGE_TEXT;
  END;
  IF v_res IS NOT NULL OR v_state IS DISTINCT FROM '22023' OR v_msg NOT LIKE '%unknown kind%' THEN
    RAISE EXCEPTION 'TEST FAILED (later-warnings-poll-kept): the reader''s fingerprint % was refused or did not reach the diff loop (envelope %, SQLSTATE %, message %).', v_fp_kept, v_res, v_state, v_msg;
  END IF;
  IF v_state_b IS NOT NULL OR (v_res_b->>'ok')::boolean IS NOT FALSE
     OR v_res_b->'errors'->0->>'code' IS DISTINCT FROM 'portfolio_fingerprint_stale' THEN
    RAISE EXCEPTION 'TEST FAILED (later-warnings-poll-kept): the fingerprint % without key-k was not refused as portfolio_fingerprint_stale although key-k stays in the recompute (envelope %, SQLSTATE %, message %).', v_fp_without, v_res_b, v_state_b, v_msg_b;
  END IF;

  RAISE NOTICE 'PASS (fingerprint later-warnings-poll-kept): key-k stays in the recompute.';

  DELETE FROM allocator_holdings WHERE allocator_id = uid_a;
  DELETE FROM audit_log WHERE user_id = uid_a;
  DELETE FROM api_keys WHERE user_id = uid_a;
  DELETE FROM profiles WHERE id = uid_a;
  DELETE FROM auth.users WHERE id = uid_a;
END $laterwarn$;

-- ===== warnings-empty-kept: the only poll finished with warnings and read zero rows =====
-- Own allocator, own fixture. key-k (binance) holds BTC on 2026-10-10; key-l (bybit)
-- holds ETH on 2026-10-10 and is the always-kept key. Poll events, oldest first (the
-- newest-event read is `created_at DESC`, so created_at is explicit):
--   complete_with_warnings row_count 0 asof 2026-10-10
-- The rule keeps key-k, so the fingerprint WITH its token (the reader's output, bound
-- to the TypeScript path below) must NOT be refused, and the fingerprint WITHOUT it
-- (what a recompute that wrongly dropped key-k would hold) MUST be refused.
DO $warnempty$
DECLARE
  v_run     text := replace(gen_random_uuid()::text, '-', '');
  uid_a     uuid := gen_random_uuid();
  k_k       uuid := gen_random_uuid();
  k_l       uuid := gen_random_uuid();
  -- PARITY-FINGERPRINT(warnings-empty-kept): BTC:binance:spot|ETH:bybit:spot
  v_fp_kept    CONSTANT text := 'BTC:binance:spot|ETH:bybit:spot';
  -- The other half of the two-sided arm; not bound to the TypeScript path.
  v_fp_without CONSTANT text := 'ETH:bybit:spot';
  v_res     jsonb;
  v_state   text;
  v_msg     text;
  v_res_b   jsonb;
  v_state_b text;
  v_msg_b   text;
  v_diffs   jsonb := jsonb_build_array(jsonb_build_object('kind', 'gate_unknown_kind'));
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_a, '00000000-0000-0000-0000-000000000000', 'test-fpsd-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid_a, 'fpsd allocator', 'test-fpsd-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (k_k, uid_a, 'binance', 'fpsd key k', 'enc', true),
         (k_l, uid_a, 'bybit',   'fpsd key l', 'enc', true);
  INSERT INTO allocator_holdings
    (allocator_id, api_key_id, venue, symbol, asof, holding_type, side, quantity, value_usd, mark_price)
  VALUES (uid_a, k_k, 'binance', 'BTC', DATE '2026-10-10', 'spot', 'flat', 1, 100, 100),
         (uid_a, k_l, 'bybit',   'ETH', DATE '2026-10-10', 'spot', 'flat', 1, 100, 100);
  INSERT INTO audit_log (user_id, action, entity_type, entity_id, metadata, created_at)
  VALUES
         (uid_a, 'allocator.holdings.sync_completed', 'api_key', k_k,
          '{"final_status": "complete_with_warnings", "row_count": 0, "asof": "2026-10-10"}'::jsonb,
          now() - INTERVAL '1 hour');

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);

  -- RED-UNDER: remove the final_status guard from empty_day in the migration, so a warnings poll that
  --            read zero rows counts as a clean empty poll and key-k is dropped.
  -- RED-UNDER-M: {"arm":"warnings-empty-kept","apply":[{"kind":"edit","file":"supabase/migrations/20261027120000_commit_scenario_batch_fingerprint_sameday_empty.sql","find":"WHEN e.newest_meta->>'final_status' IS DISTINCT FROM 'complete' THEN NULL","replace":"WHEN FALSE THEN NULL","occurrences":1}]}
  BEGIN
    v_res := public.commit_scenario_batch(uid_a, v_diffs, NULL, NULL, v_fp_kept);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  BEGIN
    v_res_b := public.commit_scenario_batch(uid_a, v_diffs, NULL, NULL, v_fp_without);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state_b = RETURNED_SQLSTATE, v_msg_b = MESSAGE_TEXT;
  END;
  IF v_res IS NOT NULL OR v_state IS DISTINCT FROM '22023' OR v_msg NOT LIKE '%unknown kind%' THEN
    RAISE EXCEPTION 'TEST FAILED (warnings-empty-kept): the reader''s fingerprint % was refused or did not reach the diff loop (envelope %, SQLSTATE %, message %).', v_fp_kept, v_res, v_state, v_msg;
  END IF;
  IF v_state_b IS NOT NULL OR (v_res_b->>'ok')::boolean IS NOT FALSE
     OR v_res_b->'errors'->0->>'code' IS DISTINCT FROM 'portfolio_fingerprint_stale' THEN
    RAISE EXCEPTION 'TEST FAILED (warnings-empty-kept): the fingerprint % without key-k was not refused as portfolio_fingerprint_stale although key-k stays in the recompute (envelope %, SQLSTATE %, message %).', v_fp_without, v_res_b, v_state_b, v_msg_b;
  END IF;

  RAISE NOTICE 'PASS (fingerprint warnings-empty-kept): key-k stays in the recompute.';

  DELETE FROM allocator_holdings WHERE allocator_id = uid_a;
  DELETE FROM audit_log WHERE user_id = uid_a;
  DELETE FROM api_keys WHERE user_id = uid_a;
  DELETE FROM profiles WHERE id = uid_a;
  DELETE FROM auth.users WHERE id = uid_a;
END $warnempty$;

-- ===== older-empty-day-kept: a clean empty poll dated the day BEFORE the rows =====
-- Own allocator, own fixture. key-k (binance) holds BTC on 2026-10-10; key-l (bybit)
-- holds ETH on 2026-10-10 and is the always-kept key. Poll events, oldest first (the
-- newest-event read is `created_at DESC`, so created_at is explicit):
--   complete row_count 0 asof 2026-10-09
-- The rule keeps key-k, so the fingerprint WITH its token (the reader's output, bound
-- to the TypeScript path below) must NOT be refused, and the fingerprint WITHOUT it
-- (what a recompute that wrongly dropped key-k would hold) MUST be refused.
DO $olderday$
DECLARE
  v_run     text := replace(gen_random_uuid()::text, '-', '');
  uid_a     uuid := gen_random_uuid();
  k_k       uuid := gen_random_uuid();
  k_l       uuid := gen_random_uuid();
  -- PARITY-FINGERPRINT(older-empty-day-kept): BTC:binance:spot|ETH:bybit:spot
  v_fp_kept    CONSTANT text := 'BTC:binance:spot|ETH:bybit:spot';
  -- The other half of the two-sided arm; not bound to the TypeScript path.
  v_fp_without CONSTANT text := 'ETH:bybit:spot';
  v_res     jsonb;
  v_state   text;
  v_msg     text;
  v_res_b   jsonb;
  v_state_b text;
  v_msg_b   text;
  v_diffs   jsonb := jsonb_build_array(jsonb_build_object('kind', 'gate_unknown_kind'));
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_a, '00000000-0000-0000-0000-000000000000', 'test-fpsd-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid_a, 'fpsd allocator', 'test-fpsd-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (k_k, uid_a, 'binance', 'fpsd key k', 'enc', true),
         (k_l, uid_a, 'bybit',   'fpsd key l', 'enc', true);
  INSERT INTO allocator_holdings
    (allocator_id, api_key_id, venue, symbol, asof, holding_type, side, quantity, value_usd, mark_price)
  VALUES (uid_a, k_k, 'binance', 'BTC', DATE '2026-10-10', 'spot', 'flat', 1, 100, 100),
         (uid_a, k_l, 'bybit',   'ETH', DATE '2026-10-10', 'spot', 'flat', 1, 100, 100);
  INSERT INTO audit_log (user_id, action, entity_type, entity_id, metadata, created_at)
  VALUES
         (uid_a, 'allocator.holdings.sync_completed', 'api_key', k_k,
          '{"final_status": "complete", "row_count": 0, "asof": "2026-10-09"}'::jsonb,
          now() - INTERVAL '1 hour');

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);

  -- RED-UNDER: loosen the same_day_empty equality to <= in the migration, so a clean empty poll dated
  --            before the rows' day drops key-k.
  -- RED-UNDER-M: {"arm":"older-empty-day-kept","apply":[{"kind":"edit","file":"supabase/migrations/20261027120000_commit_scenario_batch_fingerprint_sameday_empty.sql","find":"p.empty_day COLLATE \"C\" = p.latest_day COLLATE \"C\"","replace":"p.empty_day COLLATE \"C\" <= p.latest_day COLLATE \"C\"","occurrences":1}]}
  BEGIN
    v_res := public.commit_scenario_batch(uid_a, v_diffs, NULL, NULL, v_fp_kept);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  BEGIN
    v_res_b := public.commit_scenario_batch(uid_a, v_diffs, NULL, NULL, v_fp_without);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state_b = RETURNED_SQLSTATE, v_msg_b = MESSAGE_TEXT;
  END;
  IF v_res IS NOT NULL OR v_state IS DISTINCT FROM '22023' OR v_msg NOT LIKE '%unknown kind%' THEN
    RAISE EXCEPTION 'TEST FAILED (older-empty-day-kept): the reader''s fingerprint % was refused or did not reach the diff loop (envelope %, SQLSTATE %, message %).', v_fp_kept, v_res, v_state, v_msg;
  END IF;
  IF v_state_b IS NOT NULL OR (v_res_b->>'ok')::boolean IS NOT FALSE
     OR v_res_b->'errors'->0->>'code' IS DISTINCT FROM 'portfolio_fingerprint_stale' THEN
    RAISE EXCEPTION 'TEST FAILED (older-empty-day-kept): the fingerprint % without key-k was not refused as portfolio_fingerprint_stale although key-k stays in the recompute (envelope %, SQLSTATE %, message %).', v_fp_without, v_res_b, v_state_b, v_msg_b;
  END IF;

  RAISE NOTICE 'PASS (fingerprint older-empty-day-kept): key-k stays in the recompute.';

  DELETE FROM allocator_holdings WHERE allocator_id = uid_a;
  DELETE FROM audit_log WHERE user_id = uid_a;
  DELETE FROM api_keys WHERE user_id = uid_a;
  DELETE FROM profiles WHERE id = uid_a;
  DELETE FROM auth.users WHERE id = uid_a;
END $olderday$;

-- ===== sameday-empty-sibling-older: the emptied key's sibling on the same account read a day OLDER =====
-- Own allocator, own fixture. key-a (binance) holds BTC on 2026-10-10 and its newest poll
-- read nothing the same day (clean, row_count 0, asof 2026-10-10), so it is hidden. key-b
-- (binance) is the same exchange account (a 'duplicate' marker naming key-a) and holds ETH
-- on 2026-10-09 only. key-c (bybit, its own account) holds SOL on 2026-10-10 and is the
-- always-kept key. The hidden key keeps its own day in the account grouping, so the account's
-- newest day is 2026-10-10 and key-b's 2026-10-09 rows drop out: the fingerprint the reader
-- produces (bound to the TypeScript path below) must NOT be refused, and the fingerprint that
-- also carries key-b's token (what a recompute that let the emptied key lose its day would
-- hold) MUST be refused.
DO $sdsibling$
DECLARE
  v_run     text := replace(gen_random_uuid()::text, '-', '');
  uid_a     uuid := gen_random_uuid();
  k_a       uuid := gen_random_uuid();
  k_b       uuid := gen_random_uuid();
  k_c       uuid := gen_random_uuid();
  -- PARITY-FINGERPRINT(sameday-empty-sibling-older): SOL:bybit:spot
  v_fp_dropped CONSTANT text := 'SOL:bybit:spot';
  -- The other half of the two-sided arm; not bound to the TypeScript path.
  v_fp_sibling CONSTANT text := 'ETH:binance:spot|SOL:bybit:spot';
  v_res     jsonb;
  v_state   text;
  v_msg     text;
  v_res_b   jsonb;
  v_state_b text;
  v_msg_b   text;
  v_diffs   jsonb := jsonb_build_array(jsonb_build_object('kind', 'gate_unknown_kind'));
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_a, '00000000-0000-0000-0000-000000000000', 'test-fpsd-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid_a, 'fpsd allocator', 'test-fpsd-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (k_a, uid_a, 'binance', 'fpsd key a', 'enc', true),
         (k_c, uid_a, 'bybit',   'fpsd key c', 'enc', true);
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active,
                        account_shared_with_api_key_id, account_share_kind)
  VALUES (k_b, uid_a, 'binance', 'fpsd key b', 'enc', true, k_a, 'duplicate');
  INSERT INTO allocator_holdings
    (allocator_id, api_key_id, venue, symbol, asof, holding_type, side, quantity, value_usd, mark_price)
  VALUES (uid_a, k_a, 'binance', 'BTC', DATE '2026-10-10', 'spot', 'flat', 1, 100, 100),
         (uid_a, k_b, 'binance', 'ETH', DATE '2026-10-09', 'spot', 'flat', 1, 100, 100),
         (uid_a, k_c, 'bybit',   'SOL', DATE '2026-10-10', 'spot', 'flat', 1, 100, 100);
  INSERT INTO audit_log (user_id, action, entity_type, entity_id, metadata, created_at)
  VALUES (uid_a, 'allocator.holdings.sync_completed', 'api_key', k_a,
          '{"final_status": "complete", "row_count": 0, "asof": "2026-10-10"}'::jsonb,
          now() - INTERVAL '1 hour');

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);

  -- RED-UNDER: give a same_day_empty key a NULL day in key_day in the migration, so the emptied key no
  --            longer moves the account's newest day and key-b's older rows are counted.
  -- RED-UNDER-M: {"arm":"sameday-empty-sibling-older","apply":[{"kind":"edit","file":"supabase/migrations/20261027120000_commit_scenario_batch_fingerprint_sameday_empty.sql","find":"ELSE p.latest_day END AS day","replace":"WHEN r.same_day_empty THEN NULL ELSE p.latest_day END AS day","occurrences":1}]}
  BEGIN
    v_res := public.commit_scenario_batch(uid_a, v_diffs, NULL, NULL, v_fp_dropped);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  BEGIN
    v_res_b := public.commit_scenario_batch(uid_a, v_diffs, NULL, NULL, v_fp_sibling);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state_b = RETURNED_SQLSTATE, v_msg_b = MESSAGE_TEXT;
  END;
  IF v_res IS NOT NULL OR v_state IS DISTINCT FROM '22023' OR v_msg NOT LIKE '%unknown kind%' THEN
    RAISE EXCEPTION 'TEST FAILED (sameday-empty-sibling-older): the reader''s fingerprint % was refused or did not reach the diff loop (envelope %, SQLSTATE %, message %).', v_fp_dropped, v_res, v_state, v_msg;
  END IF;
  IF v_state_b IS NOT NULL OR (v_res_b->>'ok')::boolean IS NOT FALSE
     OR v_res_b->'errors'->0->>'code' IS DISTINCT FROM 'portfolio_fingerprint_stale' THEN
    RAISE EXCEPTION 'TEST FAILED (sameday-empty-sibling-older): the fingerprint % carrying key-b''s older token was not refused as portfolio_fingerprint_stale although the emptied key-a keeps the account at 2026-10-10 (envelope %, SQLSTATE %, message %).', v_fp_sibling, v_res_b, v_state_b, v_msg_b;
  END IF;

  RAISE NOTICE 'PASS (fingerprint sameday-empty-sibling-older): the emptied key keeps its day, so a sibling''s older rows drop out.';

  DELETE FROM allocator_holdings WHERE allocator_id = uid_a;
  DELETE FROM audit_log WHERE user_id = uid_a;
  DELETE FROM api_keys WHERE user_id = uid_a;
  DELETE FROM profiles WHERE id = uid_a;
  DELETE FROM auth.users WHERE id = uid_a;
END $sdsibling$;
