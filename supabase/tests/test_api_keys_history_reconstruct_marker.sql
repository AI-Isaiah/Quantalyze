-- Test for migration 20261014120000 — Phase 167.1.2.1 RECONMARKER, plan 01.
--
-- WHAT THE MIGRATION DOES. It gives every API key a durable, per-key marker that
-- its equity-history reconstruct is done (D-04), seeds it from the evidence that
-- survives compute_jobs retention (D-12, D-05, D-15), and makes
-- request_allocator_holdings_sync count a failed_retry reconstruct as in flight
-- and read the marker (SC-5, D-13). This gate pins the columns, their grants,
-- the CHECK, the backfill and the RPC, and (second migration, 20261014120100, D-18)
-- the refusal of worker-only audit actions and entity types by public.log_audit_event.
-- 27 arms: C1, B1-B12, A1-A3, K1, F1, D1-D4, D6, D7, D5, R3, R4 (file order). The
-- PR 1 review round added B9-B12 (SFH-2, WR-01, WR-02) and D6-D7 (O-1).
--
-- Phase 176 LEGACYRETIRE plan 09 (D-04, 2026-10-31): the RPC no longer enqueues a
-- history reconstruct (migration 20261103120000). R3 now proves it enqueues none
-- and exactly one poll job; R1, R2 and R5 tested the removed per-key reconstruct
-- gate (failed_retry, a set marker, a retained done job) and are retired with their
-- subject; R4 is re-pointed at 20261103120000. The count was 30 before this plan.
--
-- pgTAP is not set up in this project, so every assertion RAISEs
-- `TEST FAILED (<arm>)` on failure and a clean run prints NOTICEs only.
-- ⚠️ supabase/tests/test_*.sql is the ONLY DB assertion form that runs in CI.
--
-- ISOLATION BY CONSTRUCTION (the precedent is
-- test_refresh_fanout_zero_snapshot_bootstrap.sql).
--   (i) The whole file is ONE transaction: it opens with BEGIN and closes with
--       ROLLBACK, so no row it seeds, and no job its RPC calls enqueue, outlives
--       it. A RAISE aborts the transaction with the same effect.
--   (ii) Every assertion reads only this file's own synthetic key ids, never a
--       global count: CI runs every supabase/tests file on one database with no
--       per-file reset, and the backfill UPDATE touches every api_keys row on the
--       database, foreign ones included.
-- SERIAL execution: the repo runs supabase/tests/*.sql one file at a time; keep
-- it that way.
--
-- ⭐ ORDER IS LOAD-BEARING. Each arm must be the FIRST failure under its own
-- mutation (scripts/mutation-runner). File order, fixed:
--   C1, B1, B2, B3, B4, B5, B6, B7, B8, B9, B10, B11, B12, A1, A2, A3, K1, F1, D1,
--   D2, D3, D4, D6, D7, D5, R3, R4.
-- C1 reads the catalogue only and runs first, so on a lane without the migration
-- it fails as `TEST FAILED (C1)` instead of as a raw column error. The backfill
-- is called ONCE, in SETUP B, after every B fixture is seeded. The R group runs
-- the RPC as an owner (request.jwt.claims carries the owner's sub) and its SETUP
-- names NO M1 column, so a scratch copy holding SETUP R and R3 runs on the
-- 20261014120000 body (the new migration left out of the apply list), which is how
-- D-04 is proven RED there: that body enqueues one reconstruct for R3's key.
--
-- MATCHED PAIRS: every negative-control key differs from a marked / enqueued key
-- in exactly the ONE attribute its arm's mutation removes (B1: done job vs
-- pending job vs a done job of another kind vs none; B3: a noop vs a complete
-- outcome; B6: entity_type; B7: the short-circuit reason; B8: the audit row's
-- user_id (the key's owner vs another user)).
--
-- APPLY SURVIVAL (the 167.1.2-12 precedent). Every needle the migration's two
-- self-verify blocks assert must still match after EVERY RED-UNDER-M edit, or
-- the mutated apply RAISEs and the runner scores a defect with no arm identity.
-- C1 edits the default AND the verify's expected 'integer/NO/0'. R3 and R4 edit
-- migration 20261103120000, whose verify block asserts no body text (it reads the
-- catalogue only), so each is ONE edit and neither can trip it. A1, A2, A3, K1 and
-- F1 are `sql` steps, which run AFTER the apply and so cannot trip the verify.
--
-- Interference walk, each mutation against every EARLIER arm's fixture:
--   C1   none earlier; the first assertion. Its default edit changes the attempts
--        default only; no later fixture reads attempts.
--   B1   C1: C1 reads the catalogue only. The AND FALSE empties the done-job
--        source; no earlier arm reads a marker.
--   B2   B1: K_done has no audit row, so the success CASE is never read for it.
--   B3   B1, B2: B1's keys have no audit row; B2's keys are success actions, which
--        the widened CASE (IS NOT NULL) marks exactly as before.
--   B4   B1-B3: B2 and B3 keys carry ONE audit row each, so the ordering is moot.
--   B5   B1-B4: no earlier key has a marker before the call, so the guard has
--        nothing to protect there.
--   B6   B1-B5: no earlier audit row has a non-api_key entity_type, and every
--        earlier audit entity_id is its own key.
--   B7   B1-B6: no earlier key carries a short-circuit echo row.
--   B8   B1-B7: every earlier audit row is written with the key owner's user_id,
--        so requiring user_id = the key's owner removes none of their evidence.
--   B9   B1-B8: no earlier key carries a snapshot_lookup_failed row; the dropped
--        conjunct only lets that one flag through. B8's row is complete, not no_data.
--   B10  B1-B9: likewise for sibling_check_failed, which no earlier row sets true.
--   B11  B1-B10: every earlier audit row is dated within the last 30 days, so a
--        dropped lower bound admits nothing it did not already admit.
--   B12  B1-B11: every earlier audit row carries days_written (WR-02 fixtures), so
--        dropping the requirement changes no earlier answer; B7's echo row carries it
--        too, so that arm isolates the reason rule.
--   A1   B1-B12, C1: a GRANT changes no row and no catalogue column shape.
--   A2   A1: A1 reads authenticated's and the anon write bits, A2 the anon SELECT.
--   A3   A1, A2: A1 and A2 never read authenticated's SELECT.
--   K1   A1-A3: none reads the CHECK.
--   F1   all: changes one function grant; no earlier arm reads it.
--   D1   all B/A/K/F: they never call log_audit_event. Disabling the prefix branch
--        leaves D2's exact-name branch and every later arm untouched.
--   D2   D1: D1's action is allocator.equity.*, which the exact-name list never
--        matched; D1's mutation does not touch that list.
--   D3   D1, D2: their calls are refused or (under their mutation) ADMITTED, but
--        they write audit rows for their own key id only, which D3 never reads.
--        D3's edit denies sync_requested, which D1 and D2 do not call.
--   D4   D1-D3: they run as role authenticated; D4's edit refuses service_role
--        too, which only D4 calls as.
--   D6   D1-D4: their calls use entity types api_key / allocator; D6's edit renames
--        only the process_key member of the entity-type list. D4 writes process_key
--        as service_role, which the deny never refuses.
--   D7   D1-D6: likewise for verification_requests_legacy_write.
--   D5   all: changes one function grant; no earlier arm reads it.
--   R3   all B/A/K/F/D: they never call the RPC. The re-inserted enqueue only adds
--        a reconstruct job for R3's own key, which no other arm reads.
--   R4   R3: R3's key has no failed_retry POLL job, so adding failed_retry to the
--        prefetch list changes nothing for it.
-- A reviewer fix that adds an arm or changes a fixture adds its row here and
-- re-walks the table before re-running.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/test_api_keys_history_reconstruct_marker.sql
--
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/05-fixture-wizard-composite.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/11-fixture-api-keys-created-at.sql","scripts/pg-lane/fixtures/20-fixture-app-role-helper.sql","scripts/pg-lane/fixtures/21-fixture-api-keys-credential-columns.sql","scripts/pg-lane/fixtures/24-fixture-enqueue-compute-job-chain.sql","scripts/pg-lane/fixtures/39-fixture-audit-log.sql","supabase/migrations/20260513094906_enable_pg_cron.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/36-fixture-compute-jobs-claim-token.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","supabase/migrations/20260418194206_scoring_weight_overrides.sql","supabase/migrations/20260420073003_allocator_holdings.sql","supabase/migrations/20260420213754_allocator_equity_snapshots.sql","supabase/migrations/20260422101911_api_keys_disconnected_at.sql","supabase/migrations/20260527102050_replace_allocator_equity_snapshots.sql","supabase/migrations/20260529160000_allocator_equity_pre_terminus_flag.sql","supabase/migrations/20260602183000_b5b_api_key_delete_atomicity.sql","supabase/migrations/20260602190000_f6_wizard_session_idempotency.sql","supabase/migrations/20260614120000_derive_broker_dailies_kind.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710180000_wizard_composite.sql","supabase/migrations/20260717233529_allocator_equity_derived_surface.sql","supabase/migrations/20260811210000_api_keys_attested_venue.sql","supabase/migrations/20260812083206_api_keys_venue_account_id.sql","supabase/migrations/20260922120000_api_keys_sync_status_sign_in_failed.sql","supabase/migrations/20260925120000_api_keys_account_identity.sql","supabase/migrations/20260526095850_log_audit_event_null_auth_errcode.sql","supabase/migrations/20260924233749_allocator_sync_restore_inflight_prefetch.sql","supabase/migrations/20261014120000_api_keys_history_reconstruct_marker.sql","supabase/migrations/20261014120100_log_audit_event_deny_worker_only_actions.sql","supabase/migrations/20261103120000_request_allocator_holdings_sync_no_reconstruct.sql"]}

BEGIN;

-- ==========================================================================
-- ARM C1 — the two columns exist with the declared types and default. Read
-- from information_schema ONLY, so a lane without the migration fails as
-- `TEST FAILED (C1)` and not as a column error.
-- ==========================================================================
DO $c1$
BEGIN
  -- ARM C1 BEGIN
  -- ----- C1: history_reconstructed_at is a nullable timestamptz; the attempts
  --           column is an integer, NOT NULL, DEFAULT 0 ------------------------
  -- RED-UNDER: change the attempts column's DEFAULT to 1 in migration
  --            20261014120000's ADD COLUMN, and (LAYERED, apply survival) the
  --            self-verify's expected 'integer/NO/0' to match, or the mutated
  --            apply RAISEs and the runner scores a defect with no arm identity.
  -- RED-UNDER-M: {"arm":"C1","apply":[{"kind":"edit","file":"supabase/migrations/20261014120000_api_keys_history_reconstruct_marker.sql","find":"history_reconstruct_attempts integer NOT NULL DEFAULT 0","replace":"history_reconstruct_attempts integer NOT NULL DEFAULT 1","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261014120000_api_keys_history_reconstruct_marker.sql","find":"'integer/NO/0'","replace":"'integer/NO/1'","occurrences":1}]}
  IF (SELECT string_agg(c.column_name || ':' || c.data_type || '/' || c.is_nullable || '/' || coalesce(c.column_default, '<none>'), ' ' ORDER BY c.column_name)
        FROM information_schema.columns c
       WHERE c.table_schema = 'public' AND c.table_name = 'api_keys'
         AND c.column_name IN ('history_reconstructed_at', 'history_reconstruct_attempts'))
     IS DISTINCT FROM 'history_reconstruct_attempts:integer/NO/0 history_reconstructed_at:timestamp with time zone/YES/<none>' THEN
    RAISE EXCEPTION 'TEST FAILED (C1): public.api_keys must carry history_reconstructed_at (timestamptz, nullable, no default) and history_reconstruct_attempts (integer, NOT NULL, DEFAULT 0); the catalogue reads %.',
      (SELECT string_agg(c.column_name || ':' || c.data_type || '/' || c.is_nullable || '/' || coalesce(c.column_default, '<none>'), ' ' ORDER BY c.column_name)
         FROM information_schema.columns c
        WHERE c.table_schema = 'public' AND c.table_name = 'api_keys'
          AND c.column_name IN ('history_reconstructed_at', 'history_reconstruct_attempts'));
  END IF;
  -- ARM C1 END
END $c1$;

-- ==========================================================================
-- GROUP B — the backfill. SETUP B seeds every key, then calls the backfill
-- ONCE; the arms below read the result.
-- ==========================================================================
DO $grpb$
DECLARE
  v_run      text := replace(gen_random_uuid()::text, '-', '');
  uid_b      uuid := gen_random_uuid();
  k_done     uuid := gen_random_uuid();
  k_none     uuid := gen_random_uuid();
  k_pend     uuid := gen_random_uuid();
  k_oth      uuid := gen_random_uuid();
  k_b2c      uuid := gen_random_uuid();
  k_b2p      uuid := gen_random_uuid();
  k_b2n      uuid := gen_random_uuid();
  k_b3       uuid := gen_random_uuid();
  k_b4       uuid := gen_random_uuid();
  k_b5       uuid := gen_random_uuid();
  k_b6       uuid := gen_random_uuid();
  k_b6b      uuid := gen_random_uuid();
  k_b7       uuid := gen_random_uuid();
  k_b8       uuid := gen_random_uuid();
  k_b9       uuid := gen_random_uuid();
  k_b9t      uuid := gen_random_uuid();
  k_b10      uuid := gen_random_uuid();
  k_b10t     uuid := gen_random_uuid();
  k_b11      uuid := gen_random_uuid();
  k_b11t     uuid := gen_random_uuid();
  k_b12      uuid := gen_random_uuid();
  k_b12t     uuid := gen_random_uuid();
  k_b12n     uuid := gen_random_uuid();
  uid_x      uuid := gen_random_uuid();
  v_done_at  timestamptz := now() - INTERVAL '2 days';
  t_b2c      timestamptz := now() - INTERVAL '10 days';
  t_b2p      timestamptz := now() - INTERVAL '11 days';
  t_b2n      timestamptz := now() - INTERVAL '12 days';
  t_b3       timestamptz := now() - INTERVAL '8 days';
  t_b4_old   timestamptz := now() - INTERVAL '20 days';
  t_b4_new   timestamptz := now() - INTERVAL '9 days';
  t_b5_pre   timestamptz := now() - INTERVAL '30 days';
  t_b5_ev    timestamptz := now() - INTERVAL '3 days';
  t_b6       timestamptz := now() - INTERVAL '7 days';
  t_b7_noop  timestamptz := now() - INTERVAL '10 days';
  t_b7_echo  timestamptz := now() - INTERVAL '3 days';
  t_b8       timestamptz := now() - INTERVAL '5 days';
  t_b9       timestamptz := now() - INTERVAL '6 days';
  t_b10      timestamptz := now() - INTERVAL '4 days';
  -- B11: the two rows differ ONLY in created_at, either side of the heal bound
  -- (2026-04-24 03:12:38+00 in migration 20261014120000).
  t_b11_pre  timestamptz := TIMESTAMPTZ '2026-04-24 03:12:37+00';
  t_b11_post timestamptz := TIMESTAMPTZ '2026-04-24 03:12:39+00';
  t_b12      timestamptz := now() - INTERVAL '4 days';
  t_b12n_old timestamptz := now() - INTERVAL '14 days';
  t_b12n_new timestamptz := now() - INTERVAL '13 days';
  v_at       timestamptz;
  v_n        int;
BEGIN
  -- SETUP B BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_b, '00000000-0000-0000-0000-000000000000', 'test-recon-marker-b-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid_b, 'recon marker B', 'test-recon-marker-b-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  -- B8: ANOTHER user. public.log_audit_event(...) is SECURITY DEFINER, granted to
  -- authenticated, and takes any action, entity_type and entity_id from the
  -- caller (user_id = auth.uid()), so a signed-in user CAN write an
  -- outcome-shaped audit row about a key that is not theirs. The worker writes
  -- through log_audit_event_service with user_id = the key's owner.
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_x, '00000000-0000-0000-0000-000000000000', 'test-recon-marker-x-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid_x, 'recon marker X', 'test-recon-marker-x-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (k_done, uid_b, 'okx', 'recon marker B done', 'enc', true),
         (k_none, uid_b, 'okx', 'recon marker B none', 'enc', true),
         (k_pend, uid_b, 'okx', 'recon marker B pend', 'enc', true),
         (k_oth,  uid_b, 'okx', 'recon marker B oth',  'enc', true),
         (k_b2c,  uid_b, 'okx', 'recon marker B2 complete', 'enc', true),
         (k_b2p,  uid_b, 'okx', 'recon marker B2 partial',  'enc', true),
         (k_b2n,  uid_b, 'okx', 'recon marker B2 no_data',  'enc', true),
         (k_b3,   uid_b, 'okx', 'recon marker B3', 'enc', true),
         (k_b4,   uid_b, 'okx', 'recon marker B4', 'enc', true),
         (k_b5,   uid_b, 'okx', 'recon marker B5', 'enc', true),
         (k_b6,   uid_b, 'okx', 'recon marker B6', 'enc', true),
         (k_b6b,  uid_b, 'okx', 'recon marker B6 action', 'enc', true),
         (k_b7,   uid_b, 'okx', 'recon marker B7', 'enc', true),
         (k_b8,   uid_b, 'okx', 'recon marker B8', 'enc', true),
         (k_b9,   uid_b, 'okx', 'recon marker B9', 'enc', true),
         (k_b9t,  uid_b, 'okx', 'recon marker B9 twin', 'enc', true),
         (k_b10,  uid_b, 'okx', 'recon marker B10', 'enc', true),
         (k_b10t, uid_b, 'okx', 'recon marker B10 twin', 'enc', true),
         (k_b11,  uid_b, 'okx', 'recon marker B11', 'enc', true),
         (k_b11t, uid_b, 'okx', 'recon marker B11 twin', 'enc', true),
         (k_b12,  uid_b, 'okx', 'recon marker B12', 'enc', true),
         (k_b12t, uid_b, 'okx', 'recon marker B12 twin', 'enc', true),
         (k_b12n, uid_b, 'okx', 'recon marker B12 newer forged noop', 'enc', true);

  -- B5: this key ALREADY carries a marker, older than the evidence below.
  UPDATE api_keys SET history_reconstructed_at = t_b5_pre WHERE id = k_b5;

  -- Retained jobs. K_done (B1): a done reconstruct. K_pend: only a PENDING
  -- reconstruct. K_oth: a done job of ANOTHER kind. B3 / B5 / B7: a retained done
  -- reconstruct beside their audit evidence (the no-op also leaves one).
  INSERT INTO compute_jobs (kind, api_key_id, status, updated_at)
  VALUES ('reconstruct_allocator_history', k_done, 'done',    v_done_at),
         ('reconstruct_allocator_history', k_pend, 'pending', v_done_at),
         ('poll_allocator_positions',      k_oth,  'done',    v_done_at),
         ('reconstruct_allocator_history', k_b3,   'done',    t_b3),
         ('reconstruct_allocator_history', k_b5,   'done',    t_b5_ev),
         ('reconstruct_allocator_history', k_b7,   'done',    t_b7_noop);

  -- Retained audit outcome events, written the way the worker writes them
  -- (entity_type 'api_key', entity_id = the key). B2: three success actions with
  -- NO job. B3: a lone no-op. B4: an OLDER no-op then a NEWER complete. B5: a
  -- newer success than the preset marker. B6: a success with another entity_type,
  -- and an api_key event whose action is not an outcome. B7: a no-op, then LATER
  -- the short-circuit's echo of an earlier decision.
  INSERT INTO audit_log (user_id, action, entity_type, entity_id, metadata, created_at)
  VALUES (uid_b, 'allocator.equity.reconstruct_complete',            'api_key',   k_b2c, '{"days_written":3}'::jsonb, t_b2c),
         (uid_b, 'allocator.equity.reconstruct_partial_unsupported', 'api_key',   k_b2p, '{"days_written":3}'::jsonb, t_b2p),
         (uid_b, 'allocator.equity.reconstruct_no_data',             'api_key',   k_b2n, '{"days_written":3}'::jsonb, t_b2n),
         (uid_b, 'allocator.equity.reconstruct_unexpected_noop',     'api_key',   k_b3,  '{"days_written":3}'::jsonb, t_b3),
         (uid_b, 'allocator.equity.reconstruct_unexpected_noop',     'api_key',   k_b4,  '{"days_written":3}'::jsonb, t_b4_old),
         (uid_b, 'allocator.equity.reconstruct_complete',            'api_key',   k_b4,  '{"days_written":3}'::jsonb, t_b4_new),
         (uid_b, 'allocator.equity.reconstruct_complete',            'api_key',   k_b5,  '{"days_written":3}'::jsonb, t_b5_ev),
         (uid_b, 'allocator.equity.reconstruct_complete',            'allocator', k_b6,  '{"days_written":3}'::jsonb, t_b6),
         (uid_b, 'allocator.equity.refresh_held_for_reconstruct',    'api_key',   k_b6b, '{"days_written":3}'::jsonb, t_b6),
         (uid_b, 'allocator.equity.reconstruct_unexpected_noop',     'api_key',   k_b7,  '{"days_written":3}'::jsonb, t_b7_noop),
         (uid_b, 'allocator.equity.reconstruct_complete',            'api_key',   k_b7,
                 '{"reason":"already_reconstructed_for_api_key","days_written":3}'::jsonb, t_b7_echo),
         -- B8: identical to B2's complete row except that its user_id is ANOTHER
         -- user's, as a forged log_audit_event call would write it.
         (uid_x, 'allocator.equity.reconstruct_complete',            'api_key',   k_b8,  '{"days_written":3}'::jsonb, t_b8),
         -- B9: a no_data row from a REFUSED sole-key purge whose snapshot lookup
         -- failed (the worker's snapshot_lookup_failed key), and its twin, the same
         -- row with the lookup healthy. B10: a complete row written while the
         -- sibling check failed (the worker's sibling_check_failed key), and its
         -- twin with the check healthy. Both are shaped like the worker's rows.
         (uid_b, 'allocator.equity.reconstruct_no_data',             'api_key',   k_b9,
                 '{"days_written":0,"purge_refused":true,"snapshot_lookup_failed":true}'::jsonb, t_b9),
         (uid_b, 'allocator.equity.reconstruct_no_data',             'api_key',   k_b9t,
                 '{"days_written":0,"purge_refused":true,"snapshot_lookup_failed":false}'::jsonb, t_b9),
         (uid_b, 'allocator.equity.reconstruct_complete',            'api_key',   k_b10,
                 '{"days_written":3,"sibling_check_failed":true}'::jsonb, t_b10),
         (uid_b, 'allocator.equity.reconstruct_complete',            'api_key',   k_b10t,
                 '{"days_written":3,"sibling_check_failed":false}'::jsonb, t_b10),
         -- B11: a complete row dated just BEFORE the 2026-04-24 heal bound and its
         -- twin just AFTER it, identical in every other attribute.
         (uid_b, 'allocator.equity.reconstruct_complete',            'api_key',   k_b11,
                 '{"days_written":3}'::jsonb, t_b11_pre),
         (uid_b, 'allocator.equity.reconstruct_complete',            'api_key',   k_b11t,
                 '{"days_written":3}'::jsonb, t_b11_post),
         -- B12: a complete row WITHOUT days_written (a row a user forged through
         -- log_audit_event before D-18 shipped carries whatever the caller sent) and
         -- its twin WITH it; and a genuine older complete under a NEWER noop-shaped
         -- row without days_written, which must not un-mark the key.
         (uid_b, 'allocator.equity.reconstruct_complete',            'api_key',   k_b12,
                 '{"venue":"okx"}'::jsonb, t_b12),
         (uid_b, 'allocator.equity.reconstruct_complete',            'api_key',   k_b12t,
                 '{"venue":"okx","days_written":3}'::jsonb, t_b12),
         (uid_b, 'allocator.equity.reconstruct_complete',            'api_key',   k_b12n,
                 '{"days_written":3}'::jsonb, t_b12n_old),
         (uid_b, 'allocator.equity.reconstruct_unexpected_noop',     'api_key',   k_b12n,
                 '{"venue":"okx"}'::jsonb, t_b12n_new);

  PERFORM public.backfill_api_keys_history_reconstructed_at();
  -- SETUP B END

  -- ARM B1 BEGIN
  -- ----- B1: a key with a retained done reconstruct job is marked with that
  --           job's updated_at; a key with no done reconstruct job is not ------
  -- RED-UNDER: make the done-job source of the backfill empty (AND FALSE in the
  --            done_job CTE of migration 20261014120000), so K_done stays NULL.
  --            Dropping the status = 'done' conjunct would NOT bite here (K_done's
  --            only job is done), so it is not the mutation; that conjunct, and
  --            the kind conjunct, are pinned by K_pend and K_oth in this same
  --            assertion and were neutered by hand (SUMMARY, "manual neuters").
  -- RED-UNDER-M: {"arm":"B1","apply":[{"kind":"edit","file":"supabase/migrations/20261014120000_api_keys_history_reconstruct_marker.sql","find":"AND cj.status = 'done'","replace":"AND cj.status = 'done' AND FALSE","occurrences":1}]}
  SELECT history_reconstructed_at INTO v_at FROM api_keys WHERE id = k_done;
  SELECT count(*) INTO v_n
    FROM api_keys
   WHERE id IN (k_none, k_pend, k_oth) AND history_reconstructed_at IS NOT NULL;
  IF v_at IS DISTINCT FROM v_done_at OR v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (B1): the backfill must mark a key whose reconstruct job is done with that job''s updated_at (% expected, % found) and must mark none of the keys without a done reconstruct job (% of 3 were marked).', v_done_at, v_at, v_n;
  END IF;
  -- ARM B1 END

  -- ARM B2 BEGIN
  -- ----- B2 (D-12): a key whose success outcome audit event survives and whose
  --           job was reaped is marked with that event's created_at, for each of
  --           the three success actions ---------------------------------------
  -- RED-UNDER: empty the audit success source in migration 20261014120000 (the
  --            success branch of the evidence CASE yields NULL), so a key with an
  --            audit event and no retained job stays owed.
  -- RED-UNDER-M: {"arm":"B2","apply":[{"kind":"edit","file":"supabase/migrations/20261014120000_api_keys_history_reconstruct_marker.sql","find":"THEN o.created_at","replace":"THEN NULL::timestamptz","occurrences":1}]}
  IF (SELECT history_reconstructed_at FROM api_keys WHERE id = k_b2c) IS DISTINCT FROM t_b2c
     OR (SELECT history_reconstructed_at FROM api_keys WHERE id = k_b2p) IS DISTINCT FROM t_b2p
     OR (SELECT history_reconstructed_at FROM api_keys WHERE id = k_b2n) IS DISTINCT FROM t_b2n THEN
    RAISE EXCEPTION 'TEST FAILED (B2): a key whose newest retained outcome audit event is reconstruct_complete, reconstruct_partial_unsupported or reconstruct_no_data, with no retained job, must be marked with that event''s created_at; the audit_log evidence that survives the 30-day job retention is not being read.';
  END IF;
  -- ARM B2 END

  -- ARM B3 BEGIN
  -- ----- B3 (D-15): a key whose newest outcome event is reconstruct_unexpected_noop
  --           stays owed even though a done job for it is still retained ------
  -- RED-UNDER: add reconstruct_unexpected_noop to the success set in migration
  --            20261014120000 (the evidence CASE accepts any outcome action),
  --            so the anomaly is recorded as a reconstruct.
  -- RED-UNDER-M: {"arm":"B3","apply":[{"kind":"edit","file":"supabase/migrations/20261014120000_api_keys_history_reconstruct_marker.sql","find":"o.action <> 'allocator.equity.reconstruct_unexpected_noop'","replace":"o.action IS NOT NULL","occurrences":1}]}
  IF (SELECT history_reconstructed_at FROM api_keys WHERE id = k_b3) IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (B3): a key whose newest outcome audit event is reconstruct_unexpected_noop (a sole-key DONE that wrote 0 rows from a non-empty payload) must stay owed even when a done reconstruct job is retained; it was marked.';
  END IF;
  -- ARM B3 END

  -- ARM B4 BEGIN
  -- ----- B4: the NEWEST outcome event decides: an older no-op under a newer
  --           complete leaves the key marked with the newer event's time ------
  -- RED-UNDER: order the DISTINCT ON of migration 20261014120000 ascending, so
  --            the OLDEST outcome event decides and the key stays owed.
  -- RED-UNDER-M: {"arm":"B4","apply":[{"kind":"edit","file":"supabase/migrations/20261014120000_api_keys_history_reconstruct_marker.sql","find":"ORDER BY a.entity_id, a.created_at DESC","replace":"ORDER BY a.entity_id, a.created_at ASC","occurrences":1}]}
  IF (SELECT history_reconstructed_at FROM api_keys WHERE id = k_b4) IS DISTINCT FROM t_b4_new THEN
    RAISE EXCEPTION 'TEST FAILED (B4): a key with an older reconstruct_unexpected_noop and a NEWER reconstruct_complete must be marked with the newer event''s created_at; the newest outcome event is not the one deciding.';
  END IF;
  -- ARM B4 END

  -- ARM B5 BEGIN
  -- ----- B5: an already-set marker is never overwritten by a later backfill ---
  -- RED-UNDER: drop the history_reconstructed_at IS NULL guard from the UPDATE
  --            in migration 20261014120000, so newer evidence overwrites the
  --            marker the key already carries.
  -- RED-UNDER-M: {"arm":"B5","apply":[{"kind":"edit","file":"supabase/migrations/20261014120000_api_keys_history_reconstruct_marker.sql","find":"AND k.history_reconstructed_at IS NULL","replace":"AND TRUE","occurrences":1}]}
  IF (SELECT history_reconstructed_at FROM api_keys WHERE id = k_b5) IS DISTINCT FROM t_b5_pre THEN
    RAISE EXCEPTION 'TEST FAILED (B5): a key whose marker was already set must keep it untouched when the backfill runs again with newer evidence; the stored marker was overwritten.';
  END IF;
  -- ARM B5 END

  -- ARM B6 BEGIN
  -- ----- B6: only an api_key outcome event is evidence: a success event whose
  --           entity_type is another type, and an api_key event whose action is
  --           not an outcome, mark nothing ------------------------------------
  -- RED-UNDER: drop the entity_type = 'api_key' filter from migration
  --            20261014120000's audit source, so an event about another entity
  --            type that carries the key's id as entity_id counts. (The action
  --            filter, pinned by K_b6b in this same assertion, was neutered by
  --            hand: SUMMARY, "manual neuters".)
  -- RED-UNDER-M: {"arm":"B6","apply":[{"kind":"edit","file":"supabase/migrations/20261014120000_api_keys_history_reconstruct_marker.sql","find":"WHERE a.entity_type = 'api_key'","replace":"WHERE TRUE","occurrences":1}]}
  IF (SELECT history_reconstructed_at FROM api_keys WHERE id = k_b6) IS NOT NULL
     OR (SELECT history_reconstructed_at FROM api_keys WHERE id = k_b6b) IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (B6): an outcome-shaped audit event whose entity_type is not api_key, or an api_key event whose action is not a reconstruct outcome, must not mark a key; one did.';
  END IF;
  -- ARM B6 END

  -- ARM B7 BEGIN
  -- ----- B7 (revision 1, B1): the short-circuit's echo is not an outcome event:
  --           a no-op followed by a LATER reconstruct_complete whose reason is
  --           already_reconstructed_for_api_key leaves the key owed -----------
  -- RED-UNDER: drop the short-circuit-reason exclusion from migration
  --            20261014120000 (AND FALSE), so the echo is the newest success.
  -- RED-UNDER-M: {"arm":"B7","apply":[{"kind":"edit","file":"supabase/migrations/20261014120000_api_keys_history_reconstruct_marker.sql","find":"AND a.metadata ->> 'reason' IS NOT DISTINCT FROM 'already_reconstructed_for_api_key'","replace":"AND FALSE","occurrences":1}]}
  IF (SELECT history_reconstructed_at FROM api_keys WHERE id = k_b7) IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (B7): a key whose newest crawl outcome is reconstruct_unexpected_noop, followed by a LATER reconstruct_complete with reason already_reconstructed_for_api_key (the worker''s short-circuit echo of an earlier decision), must stay owed; the echo was read as a success.';
  END IF;
  -- ARM B7 END

  -- ARM B8 BEGIN
  -- ----- B8 (D-12, forgeable evidence): an outcome-shaped audit row whose user_id
  --           is NOT the key's owner is not evidence. log_audit_event lets any
  --           signed-in user write such a row for any key id; only the worker
  --           writes rows whose user_id is the key's owner -------------------
  -- RED-UNDER: drop the audit_log.user_id = api_keys.user_id conjunct from
  --            migration 20261014120000's audit source, so a row written by
  --            another user marks the key.
  -- RED-UNDER-M: {"arm":"B8","apply":[{"kind":"edit","file":"supabase/migrations/20261014120000_api_keys_history_reconstruct_marker.sql","find":"AND a.user_id = ak.user_id","replace":"AND TRUE","occurrences":1}]}
  IF (SELECT history_reconstructed_at FROM api_keys WHERE id = k_b8) IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (B8): an outcome-shaped audit event whose user_id is another user''s, not the key owner''s, must not mark the key (any signed-in user can write such a row through log_audit_event); it did.';
  END IF;
  -- ARM B8 END

  -- ARM B9 BEGIN
  -- ----- B9 (SFH-2): a reconstruct_no_data row whose metadata says
  --           snapshot_lookup_failed is a transient failure, not an outcome: it
  --           must not mark the key; the same row with a healthy lookup does -----
  -- RED-UNDER: drop the snapshot_lookup_failed exclusion from migration
  --            20261014120000's audit source (AND FALSE), so the failed-lookup
  --            row is read as the key's no-data outcome.
  -- RED-UNDER-M: {"arm":"B9","apply":[{"kind":"edit","file":"supabase/migrations/20261014120000_api_keys_history_reconstruct_marker.sql","find":"AND a.metadata ->> 'snapshot_lookup_failed' IS NOT DISTINCT FROM 'true'","replace":"AND FALSE","occurrences":1}]}
  IF (SELECT history_reconstructed_at FROM api_keys WHERE id = k_b9) IS NOT NULL
     OR (SELECT history_reconstructed_at FROM api_keys WHERE id = k_b9t) IS DISTINCT FROM t_b9 THEN
    RAISE EXCEPTION 'TEST FAILED (B9): a reconstruct_no_data row with metadata snapshot_lookup_failed = true (the sole-key purge was refused because the snapshot lookup failed) must not mark the key, and the identical row with snapshot_lookup_failed = false must mark it with its created_at; the transient failure was read as an outcome, or the healthy twin was lost.';
  END IF;
  -- ARM B9 END

  -- ARM B10 BEGIN
  -- ----- B10 (SFH-2): a reconstruct_complete row whose metadata says
  --           sibling_check_failed is a transient failure, not an outcome: it
  --           must not mark the key; the same row with a healthy check does ------
  -- RED-UNDER: drop the sibling_check_failed exclusion from migration
  --            20261014120000's audit source (AND FALSE), so a complete row
  --            written while the sibling lookup failed marks the key.
  -- RED-UNDER-M: {"arm":"B10","apply":[{"kind":"edit","file":"supabase/migrations/20261014120000_api_keys_history_reconstruct_marker.sql","find":"AND a.metadata ->> 'sibling_check_failed' IS NOT DISTINCT FROM 'true'","replace":"AND FALSE","occurrences":1}]}
  IF (SELECT history_reconstructed_at FROM api_keys WHERE id = k_b10) IS NOT NULL
     OR (SELECT history_reconstructed_at FROM api_keys WHERE id = k_b10t) IS DISTINCT FROM t_b10 THEN
    RAISE EXCEPTION 'TEST FAILED (B10): a reconstruct_complete row with metadata sibling_check_failed = true (written while the sibling lookup failed, so the purge was skipped fail-safe) must not mark the key, and the identical row with sibling_check_failed = false must mark it with its created_at; the transient failure was read as an outcome, or the healthy twin was lost.';
  END IF;
  -- ARM B10 END

  -- ARM B11 BEGIN
  -- ----- B11 (WR-01): an outcome row older than the 2026-04-24 heal migrations
  --           (which deleted the snapshots and done jobs it described) must not
  --           mark the key; the identical row dated after the heal does ---------
  -- RED-UNDER: drop the created_at lower bound from migration
  --            20261014120000's audit source (AND TRUE), so a pre-heal outcome
  --            marks the key.
  -- RED-UNDER-M: {"arm":"B11","apply":[{"kind":"edit","file":"supabase/migrations/20261014120000_api_keys_history_reconstruct_marker.sql","find":"AND a.created_at >= TIMESTAMPTZ '2026-04-24 03:12:38+00'","replace":"AND TRUE","occurrences":1}]}
  IF (SELECT history_reconstructed_at FROM api_keys WHERE id = k_b11) IS NOT NULL
     OR (SELECT history_reconstructed_at FROM api_keys WHERE id = k_b11t) IS DISTINCT FROM t_b11_post THEN
    RAISE EXCEPTION 'TEST FAILED (B11): a reconstruct_complete row dated before the 2026-04-24 03:12:38+00 heal bound (those migrations deleted the snapshots and done jobs it described) must not mark the key, and the identical row dated after it must mark it with its created_at; the pre-heal outcome was read as evidence, or the post-heal twin was lost.';
  END IF;
  -- ARM B11 END

  -- ARM B12 BEGIN
  -- ----- B12 (WR-02): an outcome row whose metadata lacks days_written (which
  --           every genuine worker outcome row carries) is not evidence: it does
  --           not mark a key and does not un-mark one by being the newest row ----
  -- RED-UNDER: drop the days_written requirement from migration
  --            20261014120000's audit source (AND TRUE), so a shape-less row marks
  --            the key and a newer shape-less noop row decides over a genuine
  --            older complete.
  -- RED-UNDER-M: {"arm":"B12","apply":[{"kind":"edit","file":"supabase/migrations/20261014120000_api_keys_history_reconstruct_marker.sql","find":"AND a.metadata ? 'days_written'","replace":"AND TRUE","occurrences":1}]}
  IF (SELECT history_reconstructed_at FROM api_keys WHERE id = k_b12) IS NOT NULL
     OR (SELECT history_reconstructed_at FROM api_keys WHERE id = k_b12t) IS DISTINCT FROM t_b12
     OR (SELECT history_reconstructed_at FROM api_keys WHERE id = k_b12n) IS DISTINCT FROM t_b12n_old THEN
    RAISE EXCEPTION 'TEST FAILED (B12): an outcome audit row whose metadata lacks days_written (a genuine worker row always has it, a row forged through log_audit_event before D-18 need not) must not mark a key, and the identical row with days_written must; a shape-less newer noop row must not displace a genuine older complete row. A shape-less row was read as evidence.';
  END IF;
  -- ARM B12 END

  RAISE NOTICE 'group B: the backfill marks a key from a retained done job or a newest success outcome event, never from a pending job, another kind, a no-op, an echo or a foreign entity, and never overwrites a marker';
END $grpb$;

-- ==========================================================================
-- GROUP A — the column privileges. has_column_privilege() answers for a named
-- role without becoming it, so no role can leak past an aborted arm.
-- ==========================================================================
DO $grpa$
BEGIN
  -- ARM A1 BEGIN
  -- ----- A1 (T-167.1.2.1-01): neither authenticated nor anon can INSERT or
  --           UPDATE either column: a client that could would forge "reconstructed"
  -- RED-UNDER: GRANT UPDATE (history_reconstructed_at) ON api_keys TO
  --            authenticated on the LIVE database, after the apply.
  -- RED-UNDER-M: {"arm":"A1","apply":[{"kind":"sql","stmt":"GRANT UPDATE (history_reconstructed_at) ON public.api_keys TO authenticated"}]}
  IF has_column_privilege('authenticated', 'public.api_keys', 'history_reconstructed_at', 'INSERT')
     OR has_column_privilege('authenticated', 'public.api_keys', 'history_reconstructed_at', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.api_keys', 'history_reconstruct_attempts', 'INSERT')
     OR has_column_privilege('authenticated', 'public.api_keys', 'history_reconstruct_attempts', 'UPDATE')
     OR has_column_privilege('anon', 'public.api_keys', 'history_reconstructed_at', 'INSERT')
     OR has_column_privilege('anon', 'public.api_keys', 'history_reconstructed_at', 'UPDATE')
     OR has_column_privilege('anon', 'public.api_keys', 'history_reconstruct_attempts', 'INSERT')
     OR has_column_privilege('anon', 'public.api_keys', 'history_reconstruct_attempts', 'UPDATE') THEN
    RAISE EXCEPTION 'TEST FAILED (A1): anon or authenticated can INSERT or UPDATE history_reconstructed_at or history_reconstruct_attempts (T-167.1.2.1-01); only the analytics worker and the fan-out, under service_role, may write them.';
  END IF;
  -- ARM A1 END

  -- ARM A2 BEGIN
  -- ----- A2 (T-167.1.2.1-02): anon can SELECT neither column ------------------
  -- RED-UNDER: GRANT SELECT (history_reconstruct_attempts) ON api_keys TO anon
  --            on the LIVE database.
  -- RED-UNDER-M: {"arm":"A2","apply":[{"kind":"sql","stmt":"GRANT SELECT (history_reconstruct_attempts) ON public.api_keys TO anon"}]}
  IF has_column_privilege('anon', 'public.api_keys', 'history_reconstructed_at', 'SELECT')
     OR has_column_privilege('anon', 'public.api_keys', 'history_reconstruct_attempts', 'SELECT') THEN
    RAISE EXCEPTION 'TEST FAILED (A2): anon holds SELECT on history_reconstructed_at or history_reconstruct_attempts (T-167.1.2.1-02).';
  END IF;
  -- ARM A2 END

  -- ARM A3 BEGIN
  -- ----- A3: authenticated CAN select both: the D-14 reader (plan 06) reads
  --           them under the api_keys_owner row policy -------------------------
  -- RED-UNDER: REVOKE SELECT (history_reconstructed_at) ON api_keys FROM
  --            authenticated on the LIVE database.
  -- RED-UNDER-M: {"arm":"A3","apply":[{"kind":"sql","stmt":"REVOKE SELECT (history_reconstructed_at) ON public.api_keys FROM authenticated"}]}
  IF NOT has_column_privilege('authenticated', 'public.api_keys', 'history_reconstructed_at', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.api_keys', 'history_reconstruct_attempts', 'SELECT') THEN
    RAISE EXCEPTION 'TEST FAILED (A3): authenticated lacks SELECT on history_reconstructed_at or history_reconstruct_attempts, so the owner-scoped reader of PR 2 would answer 42501.';
  END IF;
  -- ARM A3 END
END $grpa$;

-- ==========================================================================
-- ARM K1 — the CHECK refuses a negative attempts count with 23514, and admits 0.
-- ==========================================================================
DO $k1$
DECLARE
  v_run   text := replace(gen_random_uuid()::text, '-', '');
  uid_k   uuid := gen_random_uuid();
  k_k1    uuid := gen_random_uuid();
  v_err   text;
  v_con   text;
  v_n     int;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_k, '00000000-0000-0000-0000-000000000000', 'test-recon-marker-k-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid_k, 'recon marker K', 'test-recon-marker-k-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (k_k1, uid_k, 'okx', 'recon marker K1', 'enc', true);

  -- The refused UPDATE is captured in a handler and judged AFTER its END (lint
  -- rule R1), so a mutation that breaks the UPDATE reddens THIS arm by name.
  v_err := NULL; v_con := NULL;
  BEGIN
    UPDATE api_keys SET history_reconstruct_attempts = -1 WHERE id = k_k1;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_con = CONSTRAINT_NAME;
  END;
  UPDATE api_keys SET history_reconstruct_attempts = 3 WHERE id = k_k1;
  SELECT count(*) INTO v_n FROM api_keys WHERE id = k_k1 AND history_reconstruct_attempts = 3;

  -- ARM K1 BEGIN
  -- ----- K1: -1 is refused 23514 by the named CHECK; 3 is admitted ---------------
  -- RED-UNDER: DROP CONSTRAINT api_keys_history_reconstruct_attempts_nonneg on the
  --            LIVE database, after the apply, so -1 is admitted.
  -- RED-UNDER-M: {"arm":"K1","apply":[{"kind":"sql","stmt":"ALTER TABLE public.api_keys DROP CONSTRAINT api_keys_history_reconstruct_attempts_nonneg"}]}
  IF v_err IS DISTINCT FROM '23514' OR v_con IS DISTINCT FROM 'api_keys_history_reconstruct_attempts_nonneg' OR v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (K1): setting history_reconstruct_attempts to -1 did not raise 23514 on api_keys_history_reconstruct_attempts_nonneg (SQLSTATE %, constraint %), or a valid count of 3 was refused (% of 1 row stored).', v_err, v_con, v_n;
  END IF;
  -- ARM K1 END
END $k1$;

-- ==========================================================================
-- ARM F1 — the backfill function is service_role only.
-- ==========================================================================
DO $f1$
DECLARE
  v_oid oid := to_regprocedure('public.backfill_api_keys_history_reconstructed_at()');
BEGIN
  -- ARM F1 BEGIN
  -- ----- F1 (T-167.1.2.1-03): anon and authenticated cannot EXECUTE the
  --           backfill; service_role can -----------------------------------------
  -- RED-UNDER: GRANT EXECUTE ON FUNCTION public.backfill_api_keys_history_reconstructed_at()
  --            TO authenticated on the LIVE database, after the apply, so the
  --            apply's own self-verify survives.
  -- RED-UNDER-M: {"arm":"F1","apply":[{"kind":"sql","stmt":"GRANT EXECUTE ON FUNCTION public.backfill_api_keys_history_reconstructed_at() TO authenticated"}]}
  IF v_oid IS NULL
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (F1): backfill_api_keys_history_reconstructed_at() is missing (oid %), or anon / authenticated can EXECUTE it, or service_role cannot. It rewrites a column on every api_keys row and only the migration owner and service_role may call it.', v_oid;
  END IF;
  -- ARM F1 END
END $f1$;

-- ==========================================================================
-- GROUP D — public.log_audit_event refuses the worker-only audit actions to a
-- non-service_role caller (D-18, migration 20261014120100). The caller is set
-- through request.jwt.claims, which is what auth.uid() and auth.role() read.
-- Each refused / admitted call is captured in a handler and judged AFTER its END
-- (lint rule R1), so a mutation that breaks a call reddens THAT arm by name.
-- ==========================================================================
DO $grpd$
DECLARE
  v_run   text := replace(gen_random_uuid()::text, '-', '');
  u_d     uuid := gen_random_uuid();
  k_d     uuid := gen_random_uuid();
  k_d6    uuid := gen_random_uuid();
  k_d7    uuid := gen_random_uuid();
  v_e1    text;
  v_e2a   text;
  v_e2b   text;
  v_e2c   text;
  v_e3a   text;
  v_e3b   text;
  v_e4    text;
  v_e4b   text;
  v_e4c   text;
  v_e6    text;
  v_e7    text;
  v_n     int;
  v_m     int;
BEGIN
  -- SETUP D BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (u_d, '00000000-0000-0000-0000-000000000000', 'test-recon-marker-d-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (u_d, 'recon marker D', 'test-recon-marker-d-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (k_d, u_d, 'okx', 'recon marker D', 'enc', true);

  -- An authenticated session.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', u_d, 'role', 'authenticated')::text, true);

  BEGIN
    PERFORM public.log_audit_event('allocator.equity.reconstruct_complete', 'api_key', k_d, '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    v_e1 := SQLSTATE;
  END;
  SELECT count(*) INTO v_n FROM audit_log WHERE entity_id = k_d AND action LIKE 'allocator.equity.%';
  -- SETUP D END

  -- ARM D1 BEGIN
  -- ----- D1 (D-18): an authenticated session calling log_audit_event with an
  --           allocator.equity.* action is refused 22023 and no row is written --
  -- RED-UNDER: disable the allocator.equity. prefix branch of the deny condition
  --            in migration 20261014120100 (AND FALSE; the verify's needles stay
  --            satisfied), which is the 20260526095850 behaviour for that prefix.
  -- RED-UNDER-M: {"arm":"D1","apply":[{"kind":"edit","file":"supabase/migrations/20261014120100_log_audit_event_deny_worker_only_actions.sql","find":"p_action LIKE 'allocator.equity.%'","replace":"p_action LIKE 'allocator.equity.%' AND FALSE","occurrences":1}]}
  IF v_e1 IS DISTINCT FROM '22023' OR v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (D1): an authenticated session writing allocator.equity.reconstruct_complete through log_audit_event must be refused with SQLSTATE 22023 and leave no row; the call raised % and % row(s) were written. Any signed-in user could forge the evidence the reconstruct marker backfill reads.', v_e1, v_n;
  END IF;
  -- ARM D1 END

  -- SETUP D2 BEGIN
  BEGIN
    PERFORM public.log_audit_event('allocator.holdings.sync_completed', 'api_key', k_d, '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    v_e2a := SQLSTATE;
  END;
  BEGIN
    PERFORM public.log_audit_event('allocator.holdings.sync_failed', 'api_key', k_d, '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    v_e2b := SQLSTATE;
  END;
  BEGIN
    PERFORM public.log_audit_event('allocator.holdings.persist_failed', 'api_key', k_d, '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    v_e2c := SQLSTATE;
  END;
  SELECT count(*) INTO v_m
    FROM audit_log
   WHERE entity_id = k_d AND action IN ('allocator.holdings.sync_completed', 'allocator.holdings.sync_failed', 'allocator.holdings.persist_failed');
  -- SETUP D2 END
  -- ARM D2 BEGIN
  -- ----- D2 (D-18): the three worker-only allocator.holdings.* actions are
  --           refused by exact name, and no row is written ---------------------
  -- RED-UNDER: disable the exact-name list of the deny condition in migration
  --            20261014120100 (FALSE AND the IN list), so only the prefix branch
  --            is left.
  -- RED-UNDER-M: {"arm":"D2","apply":[{"kind":"edit","file":"supabase/migrations/20261014120100_log_audit_event_deny_worker_only_actions.sql","find":"OR p_action IN ('allocator.holdings.sync_completed',","replace":"OR FALSE AND p_action IN ('allocator.holdings.sync_completed',","occurrences":1}]}
  IF v_e2a IS DISTINCT FROM '22023' OR v_e2b IS DISTINCT FROM '22023' OR v_e2c IS DISTINCT FROM '22023' OR v_m <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (D2): an authenticated session writing allocator.holdings.sync_completed, sync_failed or persist_failed through log_audit_event must be refused with SQLSTATE 22023 and leave no row; the calls raised %, %, % and % row(s) were written.', v_e2a, v_e2b, v_e2c, v_m;
  END IF;
  -- ARM D2 END

  -- SETUP D3 BEGIN
  BEGIN
    PERFORM public.log_audit_event('allocator.holdings.sync_requested', 'api_key', k_d, '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    v_e3a := SQLSTATE;
  END;
  BEGIN
    PERFORM public.log_audit_event('scenario.commit', 'allocator', u_d, '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    v_e3b := SQLSTATE;
  END;
  SELECT count(*) INTO v_n
    FROM audit_log
   WHERE user_id = u_d
     AND ((action = 'allocator.holdings.sync_requested' AND entity_id = k_d)
          OR (action = 'scenario.commit' AND entity_id = u_d));
  -- SETUP D3 END
  -- ARM D3 BEGIN
  -- ----- D3 (D-18, positive control): the client action a real session writes,
  --           allocator.holdings.sync_requested, and an ordinary action still
  --           succeed and are attributed to the caller ------------------------
  -- RED-UNDER: add allocator.holdings.sync_requested to the exact-name deny list
  --            in migration 20261014120100, so "Sync now" auditing is refused.
  -- RED-UNDER-M: {"arm":"D3","apply":[{"kind":"edit","file":"supabase/migrations/20261014120100_log_audit_event_deny_worker_only_actions.sql","find":"OR p_action IN ('allocator.holdings.sync_completed',","replace":"OR p_action IN ('allocator.holdings.sync_requested', 'allocator.holdings.sync_completed',","occurrences":1}]}
  IF v_e3a IS NOT NULL OR v_e3b IS NOT NULL OR v_n <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (D3): an authenticated session must still be able to write allocator.holdings.sync_requested (the sync route writes it with the user session) and an ordinary action through log_audit_event, attributed to itself; the calls raised % and %, and % of 2 attributed rows exist.', v_e3a, v_e3b, v_n;
  END IF;
  -- ARM D3 END

  -- SETUP D4 BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', u_d, 'role', 'service_role')::text, true);
  BEGIN
    PERFORM public.log_audit_event('allocator.equity.reconstruct_complete', 'api_key', k_d, '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    v_e4 := SQLSTATE;
  END;
  -- O-1: service_role also still writes the two worker-only ENTITY TYPES.
  BEGIN
    PERFORM public.log_audit_event('process_key.entry', 'process_key', k_d, '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    v_e4b := SQLSTATE;
  END;
  BEGIN
    PERFORM public.log_audit_event('insert', 'verification_requests_legacy_write', k_d, '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    v_e4c := SQLSTATE;
  END;
  SELECT count(*) INTO v_n FROM audit_log WHERE entity_id = k_d AND action = 'allocator.equity.reconstruct_complete';
  SELECT count(*) INTO v_m
    FROM audit_log
   WHERE entity_id = k_d AND entity_type IN ('process_key', 'verification_requests_legacy_write');
  PERFORM set_config('request.jwt.claims', '', true);
  -- SETUP D4 END
  -- ARM D4 BEGIN
  -- ----- D4 (D-18): the refusal is for NON-service_role callers: with role
  --           service_role in the claims the same action is written -------------
  -- RED-UNDER: make the deny condition ignore the caller's role in migration
  --            20261014120100 (OR TRUE beside the auth.role() test), so
  --            service_role is refused too.
  -- RED-UNDER-M: {"arm":"D4","apply":[{"kind":"edit","file":"supabase/migrations/20261014120100_log_audit_event_deny_worker_only_actions.sql","find":"AND auth.role() IS DISTINCT FROM 'service_role' THEN","replace":"AND (auth.role() IS DISTINCT FROM 'service_role' OR TRUE) THEN","occurrences":1}]}
  IF v_e4 IS NOT NULL OR v_n <> 1 OR v_e4b IS NOT NULL OR v_e4c IS NOT NULL OR v_m <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (D4): a caller whose auth.role() is service_role must still be able to write allocator.equity.reconstruct_complete and the process_key and verification_requests_legacy_write entity types through log_audit_event; the calls raised %, % and %, % allocator.equity row(s) exist (expected 1) and % worker-only entity-type row(s) exist (expected 2).', v_e4, v_e4b, v_e4c, v_n, v_m;
  END IF;
  -- ARM D4 END

  -- SETUP D6 BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', u_d, 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM public.log_audit_event('process_key.entry', 'process_key', k_d6, '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    v_e6 := SQLSTATE;
  END;
  SELECT count(*) INTO v_n FROM audit_log WHERE entity_id = k_d6;
  -- SETUP D6 END
  -- ARM D6 BEGIN
  -- ----- D6 (O-1): an authenticated session writing entity_type process_key (the
  --           flag-monitor error-rate DENOMINATOR) through log_audit_event is
  --           refused 22023 and no row is written -----------------------------
  -- RED-UNDER: rename the process_key member of the entity-type deny list in
  --            migration 20261014120100 (the verify's unquoted needle survives
  --            the suffix), which is the 20260526095850 behaviour for it.
  -- RED-UNDER-M: {"arm":"D6","apply":[{"kind":"edit","file":"supabase/migrations/20261014120100_log_audit_event_deny_worker_only_actions.sql","find":"p_entity_type IN ('process_key',","replace":"p_entity_type IN ('process_key_x',","occurrences":1}]}
  IF v_e6 IS DISTINCT FROM '22023' OR v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (D6): an authenticated session writing entity_type process_key through log_audit_event must be refused with SQLSTATE 22023 and leave no row; the call raised % and % row(s) were written. Any signed-in user could inflate the flag-monitor error-rate denominator and silence the alert.', v_e6, v_n;
  END IF;
  -- ARM D6 END

  -- SETUP D7 BEGIN
  BEGIN
    PERFORM public.log_audit_event('insert', 'verification_requests_legacy_write', k_d7, '{}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    v_e7 := SQLSTATE;
  END;
  SELECT count(*) INTO v_n FROM audit_log WHERE entity_id = k_d7;
  PERFORM set_config('request.jwt.claims', '', true);
  -- SETUP D7 END
  -- ARM D7 BEGIN
  -- ----- D7 (O-1): an authenticated session writing entity_type
  --           verification_requests_legacy_write (counted by phase19_soak_status)
  --           is refused 22023 and no row is written --------------------------
  -- RED-UNDER: rename the verification_requests_legacy_write member of the
  --            entity-type deny list in migration 20261014120100.
  -- RED-UNDER-M: {"arm":"D7","apply":[{"kind":"edit","file":"supabase/migrations/20261014120100_log_audit_event_deny_worker_only_actions.sql","find":"'verification_requests_legacy_write'))","replace":"'verification_requests_legacy_write_x'))","occurrences":1}]}
  IF v_e7 IS DISTINCT FROM '22023' OR v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (D7): an authenticated session writing entity_type verification_requests_legacy_write through log_audit_event must be refused with SQLSTATE 22023 and leave no row; the call raised % and % row(s) were written.', v_e7, v_n;
  END IF;
  -- ARM D7 END
END $grpd$;

-- ==========================================================================
-- ARM D5 — log_audit_event's ACL is unchanged: anon cannot EXECUTE, authenticated
-- and service_role can.
-- ==========================================================================
DO $d5$
DECLARE
  v_oid oid := to_regprocedure('public.log_audit_event(text,text,uuid,jsonb)');
BEGIN
  -- ARM D5 BEGIN
  -- ----- D5: anon holds no EXECUTE on log_audit_event; authenticated and
  --           service_role hold it -------------------------------------------
  -- RED-UNDER: GRANT EXECUTE ON FUNCTION public.log_audit_event(text,text,uuid,jsonb)
  --            TO anon on the LIVE database, after the apply.
  -- RED-UNDER-M: {"arm":"D5","apply":[{"kind":"sql","stmt":"GRANT EXECUTE ON FUNCTION public.log_audit_event(text,text,uuid,jsonb) TO anon"}]}
  IF v_oid IS NULL
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (D5): log_audit_event(text,text,uuid,jsonb) is missing (oid %), or anon can EXECUTE it, or authenticated / service_role cannot.', v_oid;
  END IF;
  -- ARM D5 END
END $d5$;

-- ==========================================================================
-- GROUP R — request_allocator_holdings_sync (SC-5, D-04, D-13). The caller is
-- the key's owner: request.jwt.claims carries the owner's sub, which is what
-- auth.uid() reads. SETUP R names no M1 column (see the header).
-- ==========================================================================
DO $grpr$
DECLARE
  v_run   text := replace(gen_random_uuid()::text, '-', '');
  u_r     uuid := gen_random_uuid();
  k_r3    uuid := gen_random_uuid();
  k_r4    uuid := gen_random_uuid();
  v_res   jsonb;
  v_n     int;
  v_m     int;
BEGIN
  -- SETUP R BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (u_r, '00000000-0000-0000-0000-000000000000', 'test-recon-marker-r-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (u_r, 'recon marker R', 'test-recon-marker-r-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (k_r3, u_r, 'okx', 'recon marker R3', 'enc', true),
         (k_r4, u_r, 'okx', 'recon marker R4', 'enc', true);
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', u_r)::text, true);
  -- SETUP R END

  -- SETUP R3 BEGIN
  v_res := public.request_allocator_holdings_sync(k_r3);
  -- SETUP R3 END
  -- ARM R3 BEGIN
  -- ----- R3 (D-04): a key with NO reconstruct job and NO marker, synced by its
  --           owner, gets {ok: true, job_id}, exactly ONE poll job and NO
  --           reconstruct job: the RPC no longer enqueues a history reconstruct
  --           (Phase 176 LEGACYRETIRE plan 09) --------------------------------
  -- RED-UNDER: re-insert a reconstruct_allocator_history enqueue (idempotency label
  --            reconstruct-alloc-<key>-initial) ahead of the sync_status UPDATE in
  --            migration 20261103120000, so the RPC enqueues the retired job again
  --            and the key gets one reconstruct job besides its poll job.
  -- RED-UNDER-M: {"arm":"R3","apply":[{"kind":"edit","file":"supabase/migrations/20261103120000_request_allocator_holdings_sync_no_reconstruct.sql","find":"UPDATE api_keys SET sync_status = 'syncing' WHERE id = p_api_key_id;","replace":"PERFORM enqueue_compute_job(p_strategy_id := NULL, p_kind := 'reconstruct_allocator_history', p_idempotency_key := 'reconstruct-alloc-' || p_api_key_id::text || '-initial', p_api_key_id := p_api_key_id); UPDATE api_keys SET sync_status = 'syncing' WHERE id = p_api_key_id;","occurrences":1}]}
  SELECT count(*) INTO v_n
    FROM compute_jobs
   WHERE api_key_id = k_r3
     AND kind = 'reconstruct_allocator_history';
  SELECT count(*) INTO v_m
    FROM compute_jobs
   WHERE api_key_id = k_r3
     AND kind = 'poll_allocator_positions';
  IF (v_res ->> 'ok')::boolean IS NOT TRUE OR (v_res ->> 'job_id') IS NULL OR v_n <> 0 OR v_m <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (R3): request_allocator_holdings_sync must answer {ok, job_id} and enqueue exactly one poll_allocator_positions job and NO reconstruct_allocator_history job (D-04, Phase 176: the history reconstruct is retired); it answered % with % poll job(s) and % reconstruct job(s). Likely cause: the reconstruct enqueue is back in the RPC body.', v_res, v_m, v_n;
  END IF;
  -- ARM R3 END

  -- SETUP R4 BEGIN
  INSERT INTO compute_jobs (kind, api_key_id, status)
  VALUES ('poll_allocator_positions', k_r4, 'failed_retry');
  v_res := public.request_allocator_holdings_sync(k_r4);
  SELECT count(*) INTO v_m
    FROM compute_jobs
   WHERE api_key_id = k_r4 AND kind = 'poll_allocator_positions';
  -- SETUP R4 END
  -- ARM R4 BEGIN
  -- ----- R4 (D-13): a key whose POLL job sits in failed_retry still gets a fresh
  --           poll enqueued, and the RPC does not return already_inflight: the
  --           poll prefetch list is unchanged ----------------------------------
  -- RED-UNDER: add 'failed_retry' to the poll prefetch list in migration
  --            20261103120000, so "Sync now" answers already_inflight for up to an
  --            hour during a poll backoff. One edit: the migration's verify block
  --            asserts no body text, so nothing else needs to move (apply survival).
  -- RED-UNDER-M: {"arm":"R4","apply":[{"kind":"edit","file":"supabase/migrations/20261103120000_request_allocator_holdings_sync_no_reconstruct.sql","find":"AND status IN ('pending', 'running', 'done_pending_children')","replace":"AND status IN ('pending', 'running', 'done_pending_children', 'failed_retry')","occurrences":1}]}
  IF v_res ->> 'already_inflight' IS NOT NULL OR v_m <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (R4): a key whose poll job sits in failed_retry must get a fresh poll job and no already_inflight answer (D-13: the poll prefetch list is pending, running, done_pending_children only); the answer was % and the key has % poll jobs, expected 2.', v_res, v_m;
  END IF;
  -- ARM R4 END

  PERFORM set_config('request.jwt.claims', '', true);
  RAISE NOTICE 'test_api_keys_history_reconstruct_marker: every arm passed, C1 through R4';
END $grpr$;

ROLLBACK;
