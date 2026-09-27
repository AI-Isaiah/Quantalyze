-- Test for migration 20260927120000 — Phase 167.1.2 ACCOUNTTRUTH, plan 12,
-- success criterion 7 (a), decision D-17.
--
-- WHAT THE MIGRATION FIXES. public.enqueue_refresh_allocator_equity_for_all()
-- enqueued the daily legacy-equity refresh only for a key whose owner already
-- had an allocator_equity_snapshots row, and a book's first rows come only
-- from a reconstruct_allocator_history job that only a user-initiated sync
-- enqueues. A book at zero stayed at zero. The migration makes the fan-out:
--   * FIRST enqueue one reconstruct_allocator_history job (idempotency key
--     reconstruct-alloc-<key>-initial) for every QUALIFYING key on a book with
--     zero snapshots that has no reconstruct job in any status, taking whole
--     books under a per-run cap; qualifying = active, not revoked, not
--     disconnected, not linked to one of its owner's non-archived strategies,
--     and not Deribit;
--   * THEN enqueue the daily refresh for an eligible key whose owner has
--     snapshots (as before, minus revoked keys), or for an unlinked key on a
--     zero-snapshot book once every qualifying key on that book has a
--     reconstruct job (the book is BOOTSTRAPPED).
--
-- pgTAP is not set up in this project, so every assertion RAISEs
-- `TEST FAILED (<arm>)` on failure and a clean run prints NOTICEs only.
-- ⚠️ supabase/tests/test_*.sql is the ONLY DB assertion form that runs in CI.
--
-- ISOLATION BY CONSTRUCTION (the precedent is test_ledger_refresh_fanout.sql).
--   (i) The whole file is ONE transaction: it opens with BEGIN and closes with
--       ROLLBACK, so no row it seeds and no job its calls enqueue, for its own
--       keys or for any foreign key on the database, outlives it. A RAISE
--       aborts the transaction with the same effect. No reaper is needed.
--   (ii) CI runs every supabase/tests file on ONE database with no per-file
--       reset, so foreign zero-snapshot books can exist while this runs. Every
--       api_keys row this file seeds carries an explicit created_at a CENTURY
--       AHEAD of now(), and each arm group's base is strictly later than every
--       earlier group's. The fan-out takes books newest key first, so each
--       group's books outrank every foreign book and every earlier group's
--       leftover for the cap slots.
--   (iii) Every assertion reads only this file's own key ids, never a global
--       count.
-- Several calls in one transaction are the same UTC day by construction
-- (now() is fixed inside a transaction), and the function's session-level
-- pg_try_advisory_lock is re-entrant and released at the end of each call. The
-- api-key branch of enqueue_compute_job performs no auth.role() check, so this
-- file calls the fan-out directly as the database owner, as pg_cron does.
--
-- SERIAL execution: a concurrent holder of the daily_equity_refresh lock would
-- make a call skip and redden the positive arms for the wrong reason. The repo
-- runs supabase/tests/*.sql one file at a time; keep it that way.
--
-- THE TRACER GROUP (Z) and the RED-on-075 contract. Group Z's seed and call sit
-- OUTSIDE every arm marker and name no object only migration 20260927120000
-- creates, and nothing that can RAISE precedes arm Z1. On migration 075's body
-- the full file must fail with arm Z1 first; with Z1's marked block deleted it
-- must fail with arm Z2. Keep Z1 and Z2 the FIRST TWO assertions in the file.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/test_refresh_fanout_zero_snapshot_bootstrap.sql
--
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/05-fixture-wizard-composite.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/11-fixture-api-keys-created-at.sql","scripts/pg-lane/fixtures/20-fixture-app-role-helper.sql","scripts/pg-lane/fixtures/21-fixture-api-keys-credential-columns.sql","scripts/pg-lane/fixtures/24-fixture-enqueue-compute-job-chain.sql","supabase/migrations/20260513094906_enable_pg_cron.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/36-fixture-compute-jobs-claim-token.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","supabase/migrations/20260418194206_scoring_weight_overrides.sql","supabase/migrations/20260420073003_allocator_holdings.sql","supabase/migrations/20260420213754_allocator_equity_snapshots.sql","supabase/migrations/20260422101911_api_keys_disconnected_at.sql","supabase/migrations/20260527102050_replace_allocator_equity_snapshots.sql","supabase/migrations/20260529160000_allocator_equity_pre_terminus_flag.sql","supabase/migrations/20260602183000_b5b_api_key_delete_atomicity.sql","supabase/migrations/20260602190000_f6_wizard_session_idempotency.sql","supabase/migrations/20260614120000_derive_broker_dailies_kind.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710180000_wizard_composite.sql","supabase/migrations/20260717233529_allocator_equity_derived_surface.sql","supabase/migrations/20260811210000_api_keys_attested_venue.sql","supabase/migrations/20260812083206_api_keys_venue_account_id.sql","supabase/migrations/20260925120000_api_keys_account_identity.sql","supabase/migrations/20260927120000_refresh_fanout_bootstraps_zero_snapshot_books.sql"]}

BEGIN;

-- ==========================================================================
-- GROUP Z — the tracer: one qualifying key on a book with zero snapshots.
-- ==========================================================================
DO $grpz$
DECLARE
  v_run  text := replace(gen_random_uuid()::text, '-', '');
  v_base timestamptz := now() + INTERVAL '100 years';
  uid_z  uuid := gen_random_uuid();
  k_z    uuid := gen_random_uuid();
  v_n    int;
BEGIN
  -- SETUP Z BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_z, '00000000-0000-0000-0000-000000000000', 'test-fanout-boot-z-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid_z, 'fanout boot Z', 'test-fanout-boot-z-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, created_at)
  VALUES (k_z, uid_z, 'okx', 'fanout boot Z', 'enc', true, v_base);

  PERFORM public.enqueue_refresh_allocator_equity_for_all();
  -- SETUP Z END

  -- ARM Z1 BEGIN
  -- ----- Z1: a zero-snapshot book's qualifying key gets its daily refresh ---
  -- RED-UNDER: in migration 20260927120000, restore the refresh loop's plain
  --            snapshot conjunct (the zero-snapshot branch becomes FALSE AND …),
  --            so a book with no snapshot row is never refreshed, as on 075.
  -- RED-UNDER-M: {"arm":"Z1","apply":[{"kind":"edit","file":"supabase/migrations/20260927120000_refresh_fanout_bootstraps_zero_snapshot_books.sql","find":"          OR (\n            NOT EXISTS (SELECT 1 FROM strategies aks","replace":"          OR FALSE AND (\n            NOT EXISTS (SELECT 1 FROM strategies aks","occurrences":1}]}
  SELECT count(*) INTO v_n
    FROM compute_jobs
   WHERE api_key_id = k_z AND kind = 'refresh_allocator_equity_daily';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (Z1): a qualifying key on a book with ZERO equity snapshots got % refresh_allocator_equity_daily job(s), expected exactly 1. The fan-out still requires an existing snapshot, so a book at zero stays at zero forever.', v_n;
  END IF;
  -- ARM Z1 END

  -- ----- Z2: the same call enqueued ONE reconstruct under the RPC's key ----
  -- RED-UNDER: in migration 20260927120000, corrupt the bootstrap enqueue's
  --            idempotency key suffix. The reconstruct row still exists (so the
  --            book stays bootstrapped and Z1 stays green), but it no longer
  --            names the same job request_allocator_holdings_sync names.
  -- RED-UNDER-M: {"arm":"Z2","apply":[{"kind":"edit","file":"supabase/migrations/20260927120000_refresh_fanout_bootstraps_zero_snapshot_books.sql","find":"            p_idempotency_key := 'reconstruct-alloc-' || v_rkey.api_key_id::text || '-initial',","replace":"            p_idempotency_key := 'reconstruct-alloc-' || v_rkey.api_key_id::text || '-initial-mutated',","occurrences":1}]}
  SELECT count(*) INTO v_n
    FROM compute_jobs
   WHERE api_key_id = k_z
     AND kind = 'reconstruct_allocator_history'
     AND idempotency_key = 'reconstruct-alloc-' || k_z::text || '-initial';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (Z2): a qualifying key on a book with ZERO equity snapshots got % reconstruct_allocator_history job(s) keyed reconstruct-alloc-<key>-initial, expected exactly 1. Without it the book''s history is never reconstructed, or the cron path and the connect path name two different jobs.', v_n;
  END IF;

  RAISE NOTICE 'group Z: a zero-snapshot book''s qualifying key got one refresh and one initial reconstruct';
END $grpz$;

ROLLBACK;
