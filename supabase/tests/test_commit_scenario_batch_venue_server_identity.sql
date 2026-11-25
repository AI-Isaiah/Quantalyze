-- Test for migration 20261125151936 (commit_scenario_batch groups keys by the canonical
-- (exchange, login, server) identity) - Phase 225 ONEACCOUNTONCE, plan 16 (CONN-03,
-- CONTEXT Q6 item 1, PR-3 review CR-01).
--
-- WHAT THE MIGRATION DOES. commit_scenario_batch's fingerprint recompute joined an
-- owner's keys into one account on (exchange, login) alone. The browser
-- (accountIdentityTokens, plan 15) and the derive (account_identity_tokens, plan 14)
-- now count one login on two set servers as two accounts, so the recompute must too,
-- or every book-mode commit of that owner is refused portfolio_fingerprint_stale. The
-- shared identity rule, clause by clause, is one arm each below:
--   * one login on two set servers is two accounts; the same set server is one;
--   * the exchange partitions both the join and the per-login server count, and the
--     exchange is compared case-blind;
--   * a key with no server joins its login while the login carries at most one
--     distinct server, and has no identity (its own account) when it carries two or
--     more, including two unknowns that never join each other and three servers;
--   * a login that carries no server at all is one account;
--   * the shared-account markers still link a key that has no identity, whether the
--     key is ambiguous or has no login at all.
-- The server is compared as stored: srv-a and SRV-A are two accounts, and nothing is
-- trimmed or folded (the shared fixture's server-is-compared-as-stored case). The
-- migration does no lower() on the server, and the CHECK refuses blank, so there is no
-- SQL arm for it beyond the by-construction fact that the recompute reads the column
-- as stored.
--
-- pgTAP is not set up in this project, so every assertion RAISEs
-- `TEST FAILED (<arm>)` on failure and a clean run prints NOTICEs only.
-- supabase/tests/test_*.sql is the ONLY DB assertion form that runs in CI.
--
-- THE FIXTURES (allocator A per arm, hand-typed). Every key carries one spot row on
-- 2026-11-09 (older) or 2026-11-10 (newer), and within one account only the keys at
-- the account's newest day contribute (SFH-C4-01), so an arm tells "one account" from
-- "two accounts" by whether the older row is in the fingerprint. An always-kept okx
-- key with no login (SOL) keeps every fingerprint non-empty (an empty client
-- fingerprint skips the precondition altogether and the arm would pass vacuously).
-- At most one LIVE key per (owner, exchange, login), the rest disconnected, so the
-- login-only identity index the lane carries cannot refuse a fixture insert. Every
-- literal marked PARITY-FINGERPRINT is read out of THIS file by
-- src/lib/fingerprint-venue-server-parity.test.ts, which computes the same
-- fingerprint through the TypeScript path (fetchLatestHoldingsPerKey with keys that
-- carry venue_server, derivePhase07Fields, computeHoldingsFingerprint) on the same
-- rows, so the two runtimes are bound to the same bytes. That test fails when a marker
-- here has no TypeScript case.
--
-- THE exchange-case ARM BUILT THE STORED-'MT5' FORM. The pg-lane api_keys carries no
-- api_keys_exchange_check (measured: its pg_constraint list has none), so an 'MT5' key
-- is storable here and the arm asserts one account with a literal. On PROD that CHECK
-- refuses a mixed-case exchange, so there the case-fold is defence in depth.
--
-- HOW AN ARM JUDGES "NOT REFUSED". The pg-lane hosts the function through
-- scripts/pg-lane/fixtures/38-fixture-commit-scenario-batch-hosts.sql, which supplies
-- only the objects the recompute and the migration's verify block read. It has no
-- match_decisions, no bridge_outcomes and no idempotency table. Each call therefore
-- passes a diff of an unknown kind and no idempotency key: a fingerprint that matches
-- falls through to the diff loop and raises 22023 `unknown kind`, while a fingerprint
-- that diverges returns ok:false code portfolio_fingerprint_stale BEFORE the loop. The
-- call is captured in an EXCEPTION block and judged after its END, by SQLSTATE,
-- message and envelope (lint rule R1).
--
-- ORDER IS LOAD-BEARING. Each arm must be the FIRST failure under its own mutation
-- (scripts/mutation-runner), and WAIVED_CEILING is 0. Every arm is its own DO block
-- with its own allocator; the file stops at the first failure, so every arm above an
-- arm's mutation must still pass under it. The order was found by running the file
-- under each twin, not by reasoning:
--   two-servers-two-accounts           <- replace the identity_server equality of the first account_edges arm with TRUE.
-- Each arm is two-sided: the reader's fingerprint passes the precondition and the one a
-- mutated recompute would hold is refused.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/test_commit_scenario_batch_venue_server_identity.sql
--
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/05-fixture-wizard-composite.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/11-fixture-api-keys-created-at.sql","scripts/pg-lane/fixtures/20-fixture-app-role-helper.sql","scripts/pg-lane/fixtures/21-fixture-api-keys-credential-columns.sql","scripts/pg-lane/fixtures/24-fixture-enqueue-compute-job-chain.sql","supabase/migrations/20260513094906_enable_pg_cron.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/36-fixture-compute-jobs-claim-token.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","supabase/migrations/20260418194206_scoring_weight_overrides.sql","supabase/migrations/20260420073003_allocator_holdings.sql","supabase/migrations/20260420213754_allocator_equity_snapshots.sql","supabase/migrations/20260422101911_api_keys_disconnected_at.sql","supabase/migrations/20260527102050_replace_allocator_equity_snapshots.sql","supabase/migrations/20260529160000_allocator_equity_pre_terminus_flag.sql","supabase/migrations/20260602183000_b5b_api_key_delete_atomicity.sql","supabase/migrations/20260602190000_f6_wizard_session_idempotency.sql","supabase/migrations/20260614120000_derive_broker_dailies_kind.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710180000_wizard_composite.sql","supabase/migrations/20260717233529_allocator_equity_derived_surface.sql","supabase/migrations/20260811210000_api_keys_attested_venue.sql","supabase/migrations/20260812083206_api_keys_venue_account_id.sql","supabase/migrations/20260922120000_api_keys_sync_status_sign_in_failed.sql","supabase/migrations/20260925120000_api_keys_account_identity.sql","supabase/migrations/20260927180000_working_holder_rule_d18.sql","supabase/migrations/20261007120000_api_keys_account_currency.sql","supabase/migrations/20261009130000_revoke_truncate_anon_authenticated.sql","supabase/migrations/20261009150000_revoke_trigger_maintain_anon_authenticated.sql","supabase/migrations/20261010120000_btcusdview_native_balance.sql","scripts/pg-lane/fixtures/38-fixture-commit-scenario-batch-hosts.sql","supabase/migrations/20261011120100_commit_scenario_batch_fingerprint_unpriced.sql","supabase/migrations/20261027120000_commit_scenario_batch_fingerprint_sameday_empty.sql","supabase/migrations/20261123180000_api_keys_venue_server.sql","supabase/migrations/20261125151936_commit_scenario_batch_venue_server_identity.sql"]}

-- Reap fixtures orphaned by a crashed earlier run. Age-scoped so it can never touch a
-- concurrent run's users. Rows first: allocator_holdings.api_key_id is ON DELETE RESTRICT.
DELETE FROM allocator_holdings
 WHERE allocator_id IN (SELECT id FROM auth.users
                         WHERE email LIKE 'test-fpvs-%@quantalyze.test'
                           AND created_at < now() - INTERVAL '1 hour');
DELETE FROM api_keys
 WHERE user_id IN (SELECT id FROM auth.users
                    WHERE email LIKE 'test-fpvs-%@quantalyze.test'
                      AND created_at < now() - INTERVAL '1 hour');
DELETE FROM auth.users
 WHERE email LIKE 'test-fpvs-%@quantalyze.test'
   AND created_at < now() - INTERVAL '1 hour';

-- ===== two-servers-two-accounts: One MT5 login on two set servers is two accounts, so the older srv-a key's row still counts beside the newer srv-b key's row. A login-only join would make them one account and drop the older row. =====
-- Own allocator, own fixture (every key one spot row; at most one LIVE key per
-- (owner, exchange, login), the rest disconnected, so the login-only identity index
-- the lane carries cannot refuse a fixture insert). The reader's fingerprint (bound
-- to the TypeScript path) must NOT be refused; the fingerprint a recompute with the
-- mutated rule would hold MUST be refused, so neither side passes vacuously.
DO $vsrv2$
DECLARE
  v_run     text := replace(gen_random_uuid()::text, '-', '');
  uid_a     uuid := gen_random_uuid();
  k_a       uuid := gen_random_uuid();
  k_b       uuid := gen_random_uuid();
  k_z       uuid := gen_random_uuid();
  -- PARITY-FINGERPRINT(two-servers-two-accounts): BTC:mt5:spot|ETH:mt5:spot|SOL:okx:spot
  v_fp_right CONSTANT text := 'BTC:mt5:spot|ETH:mt5:spot|SOL:okx:spot';
  -- The other half of the two-sided arm; not bound to the TypeScript path.
  v_fp_wrong CONSTANT text := 'ETH:mt5:spot|SOL:okx:spot';
  v_res     jsonb;
  v_state   text;
  v_msg     text;
  v_res_b   jsonb;
  v_state_b text;
  v_msg_b   text;
  v_diffs   jsonb := jsonb_build_array(jsonb_build_object('kind', 'gate_unknown_kind'));
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_a, '00000000-0000-0000-0000-000000000000', 'test-fpvs-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid_a, 'fpvs allocator', 'test-fpvs-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO api_keys
    (id, user_id, exchange, label, api_key_encrypted, is_active, venue_account_id, venue_server,
     disconnected_at, account_share_kind, account_shared_with_api_key_id)
  VALUES
    (k_a, uid_a, 'mt5', 'fpvs k_a', 'enc', true, 'L1001', 'srv-a', NULL, NULL, NULL),
    (k_b, uid_a, 'mt5', 'fpvs k_b', 'enc', true, 'L1001', 'srv-b', now(), NULL, NULL),
    (k_z, uid_a, 'okx', 'fpvs k_z', 'enc', true, NULL, NULL, NULL, NULL, NULL);
  INSERT INTO allocator_holdings
    (allocator_id, api_key_id, venue, symbol, asof, holding_type, side, quantity, value_usd, mark_price)
  VALUES
         (uid_a, k_a, 'mt5', 'BTC', DATE '2026-11-09', 'spot', 'flat', 1, 100, 100),
         (uid_a, k_b, 'mt5', 'ETH', DATE '2026-11-10', 'spot', 'flat', 1, 100, 100),
         (uid_a, k_z, 'okx', 'SOL', DATE '2026-11-10', 'spot', 'flat', 1, 100, 100);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);

  -- RED-UNDER: replace the identity_server equality of the first account_edges arm with TRUE, which restores the login-only join, so srv-a and srv-b are one account and the older srv-a row drops out.
  -- RED-UNDER-M: {"arm":"two-servers-two-accounts","apply":[{"kind":"edit","file":"supabase/migrations/20261125151936_commit_scenario_batch_venue_server_identity.sql","find":"b.identity_server = a.identity_server","replace":"TRUE","occurrences":1}]}
  BEGIN
    v_res := public.commit_scenario_batch(uid_a, v_diffs, NULL, NULL, v_fp_right);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  BEGIN
    v_res_b := public.commit_scenario_batch(uid_a, v_diffs, NULL, NULL, v_fp_wrong);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state_b = RETURNED_SQLSTATE, v_msg_b = MESSAGE_TEXT;
  END;
  IF v_res IS NOT NULL OR v_state IS DISTINCT FROM '22023' OR v_msg NOT LIKE '%unknown kind%' THEN
    RAISE EXCEPTION 'TEST FAILED (two-servers-two-accounts): the reader''s fingerprint % was refused or did not reach the diff loop (envelope %, SQLSTATE %, message %).', v_fp_right, v_res, v_state, v_msg;
  END IF;
  IF v_state_b IS NOT NULL OR (v_res_b->>'ok')::boolean IS NOT FALSE
     OR v_res_b->'errors'->0->>'code' IS DISTINCT FROM 'portfolio_fingerprint_stale' THEN
    RAISE EXCEPTION 'TEST FAILED (two-servers-two-accounts): the fingerprint % was not refused as portfolio_fingerprint_stale (envelope %, SQLSTATE %, message %).', v_fp_wrong, v_res_b, v_state_b, v_msg_b;
  END IF;

  RAISE NOTICE 'PASS (fingerprint venue-server identity): two-servers-two-accounts.';

  -- ----- cleanup: explicit, rather than relying on the cascade ------------------
  DELETE FROM allocator_holdings WHERE allocator_id = uid_a;
  DELETE FROM api_keys WHERE user_id = uid_a;
  DELETE FROM profiles WHERE id = uid_a;
  DELETE FROM auth.users WHERE id = uid_a;
END $vsrv2$;
