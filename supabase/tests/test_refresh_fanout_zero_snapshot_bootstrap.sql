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
--     zero snapshots that has no reconstruct job in flight (pending, running,
--     done_pending_children, failed_retry) or done, taking whole books under a
--     per-run cap; qualifying = active, not revoked, sync_status not
--     sign_in_failed or error, not disconnected, not linked to one of its
--     owner's non-archived strategies, and not Deribit. A failed_final
--     reconstruct therefore does not count, and is retried;
--   * THEN enqueue the daily refresh for an eligible key whose owner has
--     snapshots (as before, minus revoked keys), or for an unlinked key on a
--     zero-snapshot book once every qualifying key on that book has a
--     reconstruct job in flight or done (the book is BOOTSTRAPPED);
--   * run the bootstrap loop in its own sub-block, and catch a lost enqueue
--     race (serialization_failure) per key in both loops, so neither can
--     cancel the daily refresh of every allocator.
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
-- On 075's body R, N3c, N4, N4d, N6, N7, C, S, X1, X3 and G can also
-- fail, so none of them may move ahead of Z1 or between Z1 and Z2. Every
-- later group seeds its own fixtures and makes its own call(s) after Z2,
-- never before.
--
-- ⭐ ORDER IS LOAD-BEARING. Each arm must be the FIRST failure under its own
-- mutation (scripts/mutation-runner). File order, fixed:
--   Z1, Z2, N1, R, N2, N3, N3b, N3c, N4, N4d, N5, N6, E, N7, B, F, C, S, X1,
--   X2, X3, G.
-- MATCHED PAIRS: every negative-control key (N1, R, N2, N3, N3b, N3c, N6,
-- N7) differs from a qualifying key in exactly ONE attribute, the one its
-- arm's mutation removes; everything else is active, not revoked, sync_status
-- idle, not disconnected, not Deribit and unlinked. A revoked key seeded
-- inactive, or a disconnected key also revoked, would leave its mutation
-- inert.
-- Each mutation names ONE copy of the predicate by its table alias (book
-- selection bq*, per-key selection rk*, refresh loop ak*/aes, bootstrapped
-- subquery bk*), so an edit of one copy is never inert because another copy
-- still filters the key.
-- Interference walk, each mutation against every EARLIER arm's fixture:
--   Z1   none earlier; the first assertion.
--   Z2   Z1: the reconstruct row still exists with a wrong key, so Z's book is
--        bootstrapped and Z1's refresh is enqueued.
--   N1   Z: Z has no disconnected key.
--   R    Z, N1: N1's only key is disconnected, never eligible.
--   N2   Z, N1, R: R's book has snapshots, so the book selection never takes
--        it; the refresh loop's copy still filters revoked. R runs BEFORE N2:
--        under R's mutation N2's revoked key sits on a vacuously bootstrapped
--        book and would be refreshed.
--   N3, N3b  Z to N2: no earlier fixture has a strategy link; N3's key has no
--        strategy_keys row.
--   N3c  N3, N3b: their links are to live strategies, which the archived term
--        does not affect; N3b's link is the strategy_keys half, not edited.
--   N4   Z to N3c: earlier keys have pending reconstruct rows or none, and a
--        pending row counts under any status rule; each earlier arm asserted
--        right after its own first call.
--   N4d  Z to N4: no earlier fixture has a done reconstruct row; N4's retry
--        row is pending, which the edited list still counts.
--   N5   Z to N4d: R's snapshot book has no qualifying key; the rest are
--        zero-snapshot books already; foreign snapshot books rank behind the
--        century-ahead seeds.
--   N6   Z to N5: no earlier Deribit key.
--   E    Z to N6: no earlier linked key on a snapshot book; N5's key is
--        unlinked.
--   N7   Z to E: every earlier key's sync_status is idle or revoked.
--   B    Z to N7: every earlier zero-snapshot book is bootstrapped or holds no
--        eligible unlinked key, so dropping the conjunct adds no refresh there.
--   F    Z to B: the only earlier failed_final row is N4's, and N4's key
--        also holds its pending retry, so its book is bootstrapped under
--        either rule. F runs AFTER B: B's mutation drops the whole bk*
--        subquery and would refresh F's target first.
--   C    B, F: each has an intermediate book that takes the 26th slot, so
--        its target stays beyond the cap raised by one; B and F run before C.
--   S    B, F, C: their fillers are one-key books, so a per-key check exits
--        at the same point as a per-book check.
--   X1, X2, X3  all earlier: each mutation changes a handler, and only these
--        groups install the fixture trigger that raises; each drops its
--        trigger before its assertion. X1's 40001 is caught per key, so X2's
--        sub-block edit cannot touch it.
--   G    all: changes a grant only; no arm but G reads grants.
-- A reviewer fix that adds an arm or changes a fixture adds its row here and
-- re-walks the table before re-running.
-- No same-day dedup arm: the enqueue helper returns an in-flight row before
-- any INSERT (backed by the in-flight partial unique index), so removing the
-- unique_violation half of the fan-out's per-key handlers or changing the
-- refresh key is inert, and an arm whose every mutation is inert cannot bite.
-- The serialization_failure half is NOT inert and is pinned by X1 (bootstrap
-- loop) and X3 (refresh loop); the bootstrap sub-block by X2.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/test_refresh_fanout_zero_snapshot_bootstrap.sql
--
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/05-fixture-wizard-composite.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/11-fixture-api-keys-created-at.sql","scripts/pg-lane/fixtures/20-fixture-app-role-helper.sql","scripts/pg-lane/fixtures/21-fixture-api-keys-credential-columns.sql","scripts/pg-lane/fixtures/24-fixture-enqueue-compute-job-chain.sql","supabase/migrations/20260513094906_enable_pg_cron.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/36-fixture-compute-jobs-claim-token.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","supabase/migrations/20260418194206_scoring_weight_overrides.sql","supabase/migrations/20260420073003_allocator_holdings.sql","supabase/migrations/20260420213754_allocator_equity_snapshots.sql","supabase/migrations/20260422101911_api_keys_disconnected_at.sql","supabase/migrations/20260527102050_replace_allocator_equity_snapshots.sql","supabase/migrations/20260529160000_allocator_equity_pre_terminus_flag.sql","supabase/migrations/20260602183000_b5b_api_key_delete_atomicity.sql","supabase/migrations/20260602190000_f6_wizard_session_idempotency.sql","supabase/migrations/20260614120000_derive_broker_dailies_kind.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710180000_wizard_composite.sql","supabase/migrations/20260717233529_allocator_equity_derived_surface.sql","supabase/migrations/20260811210000_api_keys_attested_venue.sql","supabase/migrations/20260812083206_api_keys_venue_account_id.sql","supabase/migrations/20260922120000_api_keys_sync_status_sign_in_failed.sql","supabase/migrations/20260925120000_api_keys_account_identity.sql","supabase/migrations/20260927120000_refresh_fanout_bootstraps_zero_snapshot_books.sql"]}

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
  -- RED-UNDER-M: {"arm":"Z2","apply":[{"kind":"edit","file":"supabase/migrations/20260927120000_refresh_fanout_bootstraps_zero_snapshot_books.sql","find":"              p_idempotency_key := 'reconstruct-alloc-' || v_rkey.api_key_id::text || '-initial',","replace":"              p_idempotency_key := 'reconstruct-alloc-' || v_rkey.api_key_id::text || '-initial-mutated',","occurrences":1}]}
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

-- ==========================================================================
-- GROUP N1 — a DISCONNECTED key on a zero-snapshot book gets neither job.
-- ==========================================================================
DO $grpn1$
DECLARE
  v_run  text := replace(gen_random_uuid()::text, '-', '');
  v_base timestamptz := now() + INTERVAL '100 years' + INTERVAL '1 day';
  uid    uuid := gen_random_uuid();
  k_n1   uuid := gen_random_uuid();
  v_n    int;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000', 'test-fanout-boot-n1-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid, 'fanout boot N1', 'test-fanout-boot-n1-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, disconnected_at, created_at)
  VALUES (k_n1, uid, 'okx', 'fanout boot N1', 'enc', true, now(), v_base);

  PERFORM public.enqueue_refresh_allocator_equity_for_all();

  -- ----- N1: a disconnected key gets neither job ---------------------------
  -- RED-UNDER: drop the disconnected_at conjunct from EVERY copy (book
  --            selection, per-key selection, refresh loop, bootstrapped
  --            subquery) in migration 20260927120000. The disconnected key
  --            then qualifies and gets a reconstruct and a refresh.
  -- RED-UNDER-M: {"arm":"N1","apply":[{"kind":"edit","file":"supabase/migrations/20260927120000_refresh_fanout_bootstraps_zero_snapshot_books.sql","find":"bq.disconnected_at IS NULL","replace":"TRUE","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260927120000_refresh_fanout_bootstraps_zero_snapshot_books.sql","find":"rk.disconnected_at IS NULL","replace":"TRUE","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260927120000_refresh_fanout_bootstraps_zero_snapshot_books.sql","find":"ak.disconnected_at IS NULL","replace":"TRUE","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260927120000_refresh_fanout_bootstraps_zero_snapshot_books.sql","find":"bk.disconnected_at IS NULL","replace":"TRUE","occurrences":1}]}
  SELECT count(*) INTO v_n
    FROM compute_jobs
   WHERE api_key_id = k_n1
     AND kind IN ('refresh_allocator_equity_daily', 'reconstruct_allocator_history');
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (N1): a soft-disconnected key on a zero-snapshot book got % bootstrap job(s), expected 0. A key the owner disconnected must not be reconstructed or refreshed.', v_n;
  END IF;
END $grpn1$;

-- ==========================================================================
-- GROUP R — a REVOKED key on a book WITH snapshots gets no refresh (edit 1).
-- ==========================================================================
DO $grpr$
DECLARE
  v_run  text := replace(gen_random_uuid()::text, '-', '');
  v_base timestamptz := now() + INTERVAL '100 years' + INTERVAL '2 days';
  uid    uuid := gen_random_uuid();
  k_r    uuid := gen_random_uuid();
  v_n    int;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000', 'test-fanout-boot-r-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid, 'fanout boot R', 'test-fanout-boot-r-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, sync_status, created_at)
  VALUES (k_r, uid, 'okx', 'fanout boot R', 'enc', true, 'revoked', v_base);
  INSERT INTO allocator_equity_snapshots (allocator_id, asof, value_usd, source)
  VALUES (uid, DATE '2026-01-01', 100, 'exchange_primary');

  PERFORM public.enqueue_refresh_allocator_equity_for_all();

  -- ----- R: a revoked key on a snapshot book is no longer refreshed --------
  -- RED-UNDER: drop the revoked conjunct from the refresh loop's copy only in
  --            migration 20260927120000 (075's population, which refreshed a
  --            revoked key every day).
  -- RED-UNDER-M: {"arm":"R","apply":[{"kind":"edit","file":"supabase/migrations/20260927120000_refresh_fanout_bootstraps_zero_snapshot_books.sql","find":"ak.sync_status IS DISTINCT FROM 'revoked'","replace":"TRUE","occurrences":1}]}
  SELECT count(*) INTO v_n
    FROM compute_jobs
   WHERE api_key_id = k_r AND kind = 'refresh_allocator_equity_daily';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (R): a revoked key on a book WITH snapshots got % refresh_allocator_equity_daily job(s), expected 0. A revoked credential cannot be polled; refreshing it only feeds a failing job.', v_n;
  END IF;
END $grpr$;

-- ==========================================================================
-- GROUP N2 — a REVOKED key on a zero-snapshot book gets neither job.
-- ==========================================================================
DO $grpn2$
DECLARE
  v_run  text := replace(gen_random_uuid()::text, '-', '');
  v_base timestamptz := now() + INTERVAL '100 years' + INTERVAL '3 days';
  uid    uuid := gen_random_uuid();
  k_n2   uuid := gen_random_uuid();
  v_n    int;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000', 'test-fanout-boot-n2-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid, 'fanout boot N2', 'test-fanout-boot-n2-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, sync_status, created_at)
  VALUES (k_n2, uid, 'okx', 'fanout boot N2', 'enc', true, 'revoked', v_base);

  PERFORM public.enqueue_refresh_allocator_equity_for_all();

  -- ----- N2: a revoked key on a zero-snapshot book gets neither job --------
  -- RED-UNDER: drop the revoked conjunct from BOTH reconstruct-loop copies
  --            (book selection and per-key selection) in migration
  --            20260927120000. An edit of one copy alone is inert while the
  --            other still filters the key.
  -- RED-UNDER-M: {"arm":"N2","apply":[{"kind":"edit","file":"supabase/migrations/20260927120000_refresh_fanout_bootstraps_zero_snapshot_books.sql","find":"bq.sync_status IS DISTINCT FROM 'revoked'","replace":"TRUE","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260927120000_refresh_fanout_bootstraps_zero_snapshot_books.sql","find":"rk.sync_status IS DISTINCT FROM 'revoked'","replace":"TRUE","occurrences":1}]}
  SELECT count(*) INTO v_n
    FROM compute_jobs
   WHERE api_key_id = k_n2
     AND kind IN ('refresh_allocator_equity_daily', 'reconstruct_allocator_history');
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (N2): a revoked key on a zero-snapshot book got % bootstrap job(s), expected 0. A 30-minute reconstruct of a revoked credential can only fail.', v_n;
  END IF;
END $grpn2$;

-- ==========================================================================
-- GROUP N3 — a key linked to a LIVE own strategy through strategies.api_key_id
-- on a zero-snapshot book gets neither job (manager data stays out of the
-- allocator store).
-- ==========================================================================
DO $grpn3$
DECLARE
  v_run  text := replace(gen_random_uuid()::text, '-', '');
  v_base timestamptz := now() + INTERVAL '100 years' + INTERVAL '4 days';
  uid    uuid := gen_random_uuid();
  k_n3   uuid := gen_random_uuid();
  v_n    int;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000', 'test-fanout-boot-n3-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid, 'fanout boot N3', 'test-fanout-boot-n3-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, created_at)
  VALUES (k_n3, uid, 'okx', 'fanout boot N3', 'enc', true, v_base);
  INSERT INTO strategies (user_id, api_key_id, name, status)
  VALUES (uid, k_n3, 'fanout boot N3', 'draft');

  PERFORM public.enqueue_refresh_allocator_equity_for_all();

  -- ----- N3: a strategy-linked key (direct link) gets neither job ----------
  -- RED-UNDER: drop the strategies.api_key_id half of the discriminator from
  --            EVERY copy in migration 20260927120000. The manager's key then
  --            qualifies and is reconstructed into the allocator store.
  -- RED-UNDER-M: {"arm":"N3","apply":[{"kind":"edit","file":"supabase/migrations/20260927120000_refresh_fanout_bootstraps_zero_snapshot_books.sql","find":"WHERE bqs.api_key_id = bq.id","replace":"WHERE FALSE AND bqs.api_key_id = bq.id","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260927120000_refresh_fanout_bootstraps_zero_snapshot_books.sql","find":"WHERE rks.api_key_id = rk.id","replace":"WHERE FALSE AND rks.api_key_id = rk.id","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260927120000_refresh_fanout_bootstraps_zero_snapshot_books.sql","find":"WHERE aks.api_key_id = ak.id","replace":"WHERE FALSE AND aks.api_key_id = ak.id","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260927120000_refresh_fanout_bootstraps_zero_snapshot_books.sql","find":"WHERE bks.api_key_id = bk.id","replace":"WHERE FALSE AND bks.api_key_id = bk.id","occurrences":1}]}
  SELECT count(*) INTO v_n
    FROM compute_jobs
   WHERE api_key_id = k_n3
     AND kind IN ('refresh_allocator_equity_daily', 'reconstruct_allocator_history');
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (N3): a key linked to its owner''s live strategy through strategies.api_key_id, on a zero-snapshot book, got % bootstrap job(s), expected 0. Manager data would be written into the allocator equity store.', v_n;
  END IF;
END $grpn3$;

-- ==========================================================================
-- GROUP N3b — a key linked to a LIVE own strategy only through strategy_keys
-- on a zero-snapshot book gets neither job.
-- ==========================================================================
DO $grpn3b$
DECLARE
  v_run  text := replace(gen_random_uuid()::text, '-', '');
  v_base timestamptz := now() + INTERVAL '100 years' + INTERVAL '5 days';
  uid    uuid := gen_random_uuid();
  k_n3b  uuid := gen_random_uuid();
  s_n3b  uuid;
  v_n    int;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000', 'test-fanout-boot-n3b-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid, 'fanout boot N3b', 'test-fanout-boot-n3b-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, created_at)
  VALUES (k_n3b, uid, 'okx', 'fanout boot N3b', 'enc', true, v_base);
  INSERT INTO strategies (user_id, api_key_id, name, status)
  VALUES (uid, NULL, 'fanout boot N3b', 'draft')
  RETURNING id INTO s_n3b;
  INSERT INTO strategy_keys (strategy_id, api_key_id, owner_id, window_start, seq)
  VALUES (s_n3b, k_n3b, uid, CURRENT_DATE - 30, 0);

  PERFORM public.enqueue_refresh_allocator_equity_for_all();

  -- ----- N3b: a strategy-linked key (strategy_keys link) gets neither job --
  -- RED-UNDER: drop the strategy_keys half of the discriminator from EVERY
  --            copy in migration 20260927120000. A composite member key then
  --            qualifies and is reconstructed into the allocator store.
  -- RED-UNDER-M: {"arm":"N3b","apply":[{"kind":"edit","file":"supabase/migrations/20260927120000_refresh_fanout_bootstraps_zero_snapshot_books.sql","find":"WHERE bqsk.api_key_id = bq.id","replace":"WHERE FALSE AND bqsk.api_key_id = bq.id","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260927120000_refresh_fanout_bootstraps_zero_snapshot_books.sql","find":"WHERE rksk.api_key_id = rk.id","replace":"WHERE FALSE AND rksk.api_key_id = rk.id","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260927120000_refresh_fanout_bootstraps_zero_snapshot_books.sql","find":"WHERE aksk.api_key_id = ak.id","replace":"WHERE FALSE AND aksk.api_key_id = ak.id","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260927120000_refresh_fanout_bootstraps_zero_snapshot_books.sql","find":"WHERE bksk.api_key_id = bk.id","replace":"WHERE FALSE AND bksk.api_key_id = bk.id","occurrences":1}]}
  SELECT count(*) INTO v_n
    FROM compute_jobs
   WHERE api_key_id = k_n3b
     AND kind IN ('refresh_allocator_equity_daily', 'reconstruct_allocator_history');
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (N3b): a key linked to its owner''s live strategy only through strategy_keys, on a zero-snapshot book, got % bootstrap job(s), expected 0. A composite member key would be written into the allocator equity store.', v_n;
  END IF;
END $grpn3b$;

-- ==========================================================================
-- GROUP N3c — a key whose ONLY link is an ARCHIVED strategy counts as
-- unlinked (the W-4 rule) and gets both jobs.
-- ==========================================================================
DO $grpn3c$
DECLARE
  v_run  text := replace(gen_random_uuid()::text, '-', '');
  v_base timestamptz := now() + INTERVAL '100 years' + INTERVAL '6 days';
  uid    uuid := gen_random_uuid();
  k_n3c  uuid := gen_random_uuid();
  v_ref  int;
  v_rec  int;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000', 'test-fanout-boot-n3c-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid, 'fanout boot N3c', 'test-fanout-boot-n3c-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, created_at)
  VALUES (k_n3c, uid, 'okx', 'fanout boot N3c', 'enc', true, v_base);
  INSERT INTO strategies (user_id, api_key_id, name, status)
  VALUES (uid, k_n3c, 'fanout boot N3c', 'archived');

  PERFORM public.enqueue_refresh_allocator_equity_for_all();

  -- ----- N3c: an archived-only link counts as unlinked ---------------------
  -- RED-UNDER: drop the archived term from EVERY copy of the strategies.api_key_id
  --            half in migration 20260927120000, so an archived strategy still
  --            counts as coverage and the key is left at zero.
  -- RED-UNDER-M: {"arm":"N3c","apply":[{"kind":"edit","file":"supabase/migrations/20260927120000_refresh_fanout_bootstraps_zero_snapshot_books.sql","find":"bqs.status <> 'archived'","replace":"TRUE","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260927120000_refresh_fanout_bootstraps_zero_snapshot_books.sql","find":"rks.status <> 'archived'","replace":"TRUE","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260927120000_refresh_fanout_bootstraps_zero_snapshot_books.sql","find":"aks.status <> 'archived'","replace":"TRUE","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260927120000_refresh_fanout_bootstraps_zero_snapshot_books.sql","find":"bks.status <> 'archived'","replace":"TRUE","occurrences":1}]}
  SELECT count(*) FILTER (WHERE kind = 'refresh_allocator_equity_daily'),
         count(*) FILTER (WHERE kind = 'reconstruct_allocator_history')
    INTO v_ref, v_rec
    FROM compute_jobs
   WHERE api_key_id = k_n3c;
  IF v_ref <> 1 OR v_rec <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (N3c): a key whose only strategy link is ARCHIVED got % refresh and % reconstruct job(s), expected 1 and 1. The owner archived that strategy, so the key is theirs as an allocator (the W-4 rule deriveStrategyLinkedKeyIds applies).', v_ref, v_rec;
  END IF;
END $grpn3c$;

-- ==========================================================================
-- GROUP N4 — a key whose only reconstruct ended FAILED_FINAL, on a
-- zero-snapshot book: the failed row does not count, so the fan-out enqueues
-- ONE retry, and the refresh is enqueued only because that retry is in
-- flight (review SFH-01).
-- ==========================================================================
DO $grpn4$
DECLARE
  v_run  text := replace(gen_random_uuid()::text, '-', '');
  v_base timestamptz := now() + INTERVAL '100 years' + INTERVAL '7 days';
  uid    uuid := gen_random_uuid();
  k_n4   uuid := gen_random_uuid();
  v_ref  int;
  v_rec  int;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000', 'test-fanout-boot-n4-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid, 'fanout boot N4', 'test-fanout-boot-n4-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, created_at)
  VALUES (k_n4, uid, 'okx', 'fanout boot N4', 'enc', true, v_base);
  -- A failed_final row is outside the in-flight index and the enqueue
  -- helper's pre-check, so the retry really inserts a second row.
  INSERT INTO compute_jobs (kind, api_key_id, status)
  VALUES ('reconstruct_allocator_history', k_n4, 'failed_final');

  PERFORM public.enqueue_refresh_allocator_equity_for_all();

  -- ----- N4: a failed_final reconstruct is retried, never counted as done --
  -- RED-UNDER: count a reconstruct row in ANY status in BOTH reconstruct-loop
  --            copies (bqj, rkj) in migration 20260927120000, as the first
  --            version did. The failed key is then never retried, and a
  --            refresh that writes the book's first row loses its backfill
  --            for good.
  -- RED-UNDER-M: {"arm": "N4", "apply": [{"kind": "edit", "file": "supabase/migrations/20260927120000_refresh_fanout_bootstraps_zero_snapshot_books.sql", "find": "AND bqj.status IN ('pending', 'running', 'done_pending_children', 'failed_retry', 'done')", "replace": "AND TRUE", "occurrences": 1}, {"kind": "edit", "file": "supabase/migrations/20260927120000_refresh_fanout_bootstraps_zero_snapshot_books.sql", "find": "AND rkj.status IN ('pending', 'running', 'done_pending_children', 'failed_retry', 'done')", "replace": "AND TRUE", "occurrences": 1}]}
  SELECT count(*) FILTER (WHERE kind = 'refresh_allocator_equity_daily'),
         count(*) FILTER (WHERE kind = 'reconstruct_allocator_history' AND status <> 'failed_final')
    INTO v_ref, v_rec
    FROM compute_jobs
   WHERE api_key_id = k_n4;
  IF v_ref <> 1 OR v_rec <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (N4): a key whose only reconstruct ended failed_final, on a zero-snapshot book, got % refresh job(s) and % new reconstruct job(s), expected 1 and 1. A failed reconstruct must be retried, not counted as a backfill: otherwise the refresh writes the book''s first row and the key''s history is lost for good.', v_ref, v_rec;
  END IF;
END $grpn4$;

-- ==========================================================================
-- GROUP N4d — a key whose reconstruct is DONE (it wrote no row), on a
-- zero-snapshot book: the book is bootstrapped, so the key gets the refresh
-- and NO second reconstruct (review SFH-01, the sibling of N4).
-- ==========================================================================
DO $grpn4d$
DECLARE
  v_run  text := replace(gen_random_uuid()::text, '-', '');
  v_base timestamptz := now() + INTERVAL '100 years' + INTERVAL '7 days' + INTERVAL '12 hours';
  uid    uuid := gen_random_uuid();
  k_n4d  uuid := gen_random_uuid();
  v_ref  int;
  v_rec  int;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000', 'test-fanout-boot-n4d-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid, 'fanout boot N4d', 'test-fanout-boot-n4d-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, created_at)
  VALUES (k_n4d, uid, 'okx', 'fanout boot N4d', 'enc', true, v_base);
  -- A done row is outside the in-flight index and the enqueue helper's
  -- pre-check too, so a fan-out that ignored it would insert a second row.
  INSERT INTO compute_jobs (kind, api_key_id, status)
  VALUES ('reconstruct_allocator_history', k_n4d, 'done');

  PERFORM public.enqueue_refresh_allocator_equity_for_all();

  -- ----- N4d: a done reconstruct is not repeated --------------------------
  -- RED-UNDER: drop 'done' from the status list of BOTH reconstruct-loop
  --            copies (bqj, rkj) in migration 20260927120000. A key whose
  --            reconstruct finished is then reconstructed again every day.
  -- RED-UNDER-M: {"arm": "N4d", "apply": [{"kind": "edit", "file": "supabase/migrations/20260927120000_refresh_fanout_bootstraps_zero_snapshot_books.sql", "find": "bqj.status IN ('pending', 'running', 'done_pending_children', 'failed_retry', 'done')", "replace": "bqj.status IN ('pending', 'running', 'done_pending_children', 'failed_retry')", "occurrences": 1}, {"kind": "edit", "file": "supabase/migrations/20260927120000_refresh_fanout_bootstraps_zero_snapshot_books.sql", "find": "rkj.status IN ('pending', 'running', 'done_pending_children', 'failed_retry', 'done')", "replace": "rkj.status IN ('pending', 'running', 'done_pending_children', 'failed_retry')", "occurrences": 1}]}
  SELECT count(*) FILTER (WHERE kind = 'refresh_allocator_equity_daily'),
         count(*) FILTER (WHERE kind = 'reconstruct_allocator_history')
    INTO v_ref, v_rec
    FROM compute_jobs
   WHERE api_key_id = k_n4d;
  IF v_ref <> 1 OR v_rec <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (N4d): a key with a DONE reconstruct on a zero-snapshot book got % refresh job(s) and now has % reconstruct row(s), expected 1 and the 1 seeded. A finished reconstruct must not be repeated by the daily fan-out, and its book is bootstrapped.', v_ref, v_rec;
  END IF;
END $grpn4d$;

-- ==========================================================================
-- GROUP N5 — a key with NO reconstruct row on a book WITH snapshots gets the
-- refresh and NO reconstruct (D-17 (c): the 30-day reap of done rows must not
-- turn the arm into a monthly re-reconstruct of every allocator key).
-- ==========================================================================
DO $grpn5$
DECLARE
  v_run  text := replace(gen_random_uuid()::text, '-', '');
  v_base timestamptz := now() + INTERVAL '100 years' + INTERVAL '8 days';
  uid    uuid := gen_random_uuid();
  k_n5   uuid := gen_random_uuid();
  v_ref  int;
  v_rec  int;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000', 'test-fanout-boot-n5-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid, 'fanout boot N5', 'test-fanout-boot-n5-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, created_at)
  VALUES (k_n5, uid, 'okx', 'fanout boot N5', 'enc', true, v_base);
  INSERT INTO allocator_equity_snapshots (allocator_id, asof, value_usd, source)
  VALUES (uid, DATE '2026-01-01', 100, 'exchange_primary');

  PERFORM public.enqueue_refresh_allocator_equity_for_all();

  -- ----- N5: a book with snapshots is never sent a bootstrap reconstruct ---
  -- RED-UNDER: drop the zero-snapshot conjunct from the book selection in
  --            migration 20260927120000. Every key whose done reconstruct row
  --            was reaped after 30 days is then re-reconstructed.
  -- RED-UNDER-M: {"arm":"N5","apply":[{"kind":"edit","file":"supabase/migrations/20260927120000_refresh_fanout_bootstraps_zero_snapshot_books.sql","find":"WHERE bqe.allocator_id = bq.user_id","replace":"WHERE FALSE AND bqe.allocator_id = bq.user_id","occurrences":1}]}
  SELECT count(*) FILTER (WHERE kind = 'refresh_allocator_equity_daily'),
         count(*) FILTER (WHERE kind = 'reconstruct_allocator_history')
    INTO v_ref, v_rec
    FROM compute_jobs
   WHERE api_key_id = k_n5;
  IF v_ref <> 1 OR v_rec <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (N5): a key with no reconstruct row on a book WITH snapshots got % refresh and % reconstruct job(s), expected 1 and 0. A book that already has history must never be sent a bootstrap reconstruct.', v_ref, v_rec;
  END IF;
END $grpn5$;

-- ==========================================================================
-- GROUP N6 — a book whose only unlinked key is DERIBIT, with zero snapshots:
-- the refresh (bootstrapped vacuously) and NO reconstruct (the worker refuses
-- Deribit reconstruction permanently).
-- ==========================================================================
DO $grpn6$
DECLARE
  v_run  text := replace(gen_random_uuid()::text, '-', '');
  v_base timestamptz := now() + INTERVAL '100 years' + INTERVAL '9 days';
  uid    uuid := gen_random_uuid();
  k_n6   uuid := gen_random_uuid();
  v_ref  int;
  v_rec  int;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000', 'test-fanout-boot-n6-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid, 'fanout boot N6', 'test-fanout-boot-n6-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, created_at)
  VALUES (k_n6, uid, 'deribit', 'fanout boot N6', 'enc', true, v_base);

  PERFORM public.enqueue_refresh_allocator_equity_for_all();

  -- ----- N6: a Deribit key is refreshed but never reconstructed ------------
  -- RED-UNDER: drop the Deribit conjunct from BOTH reconstruct-loop copies in
  --            migration 20260927120000 (the bootstrapped copy is left alone).
  --            A reconstruct the worker always refuses would be enqueued.
  -- RED-UNDER-M: {"arm":"N6","apply":[{"kind":"edit","file":"supabase/migrations/20260927120000_refresh_fanout_bootstraps_zero_snapshot_books.sql","find":"lower(bq.exchange) <> 'deribit'","replace":"TRUE","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260927120000_refresh_fanout_bootstraps_zero_snapshot_books.sql","find":"lower(rk.exchange) <> 'deribit'","replace":"TRUE","occurrences":1}]}
  SELECT count(*) FILTER (WHERE kind = 'refresh_allocator_equity_daily'),
         count(*) FILTER (WHERE kind = 'reconstruct_allocator_history')
    INTO v_ref, v_rec
    FROM compute_jobs
   WHERE api_key_id = k_n6;
  IF v_ref <> 1 OR v_rec <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (N6): an unlinked Deribit key on a zero-snapshot book got % refresh and % reconstruct job(s), expected 1 and 0. The worker refuses Deribit reconstruction permanently, and the book is bootstrapped vacuously.', v_ref, v_rec;
  END IF;
END $grpn6$;

-- ==========================================================================
-- GROUP E — the EXISTING population is unchanged: a strategy-linked key on a
-- book WITH snapshots is still refreshed.
-- ==========================================================================
DO $grpe$
DECLARE
  v_run  text := replace(gen_random_uuid()::text, '-', '');
  v_base timestamptz := now() + INTERVAL '100 years' + INTERVAL '10 days';
  uid    uuid := gen_random_uuid();
  k_e    uuid := gen_random_uuid();
  v_n    int;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000', 'test-fanout-boot-e-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid, 'fanout boot E', 'test-fanout-boot-e-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, created_at)
  VALUES (k_e, uid, 'okx', 'fanout boot E', 'enc', true, v_base);
  INSERT INTO strategies (user_id, api_key_id, name, status)
  VALUES (uid, k_e, 'fanout boot E', 'draft');
  INSERT INTO allocator_equity_snapshots (allocator_id, asof, value_usd, source)
  VALUES (uid, DATE '2026-01-01', 100, 'exchange_primary');

  PERFORM public.enqueue_refresh_allocator_equity_for_all();

  -- ----- E: a linked key on a snapshot book keeps its refresh --------------
  -- RED-UNDER: in migration 20260927120000, add a "not strategy-linked"
  --            requirement to the snapshot branch of the refresh conjunct, so
  --            the discriminator leaks into the population 075 already served.
  -- RED-UNDER-M: {"arm":"E","apply":[{"kind":"edit","file":"supabase/migrations/20260927120000_refresh_fanout_bootstraps_zero_snapshot_books.sql","find":"EXISTS (SELECT 1 FROM allocator_equity_snapshots aes WHERE aes.allocator_id = ak.user_id)","replace":"EXISTS (SELECT 1 FROM allocator_equity_snapshots aes WHERE aes.allocator_id = ak.user_id) AND NOT EXISTS (SELECT 1 FROM strategies aesx WHERE aesx.api_key_id = ak.id AND aesx.user_id = ak.user_id AND aesx.status <> 'archived')","occurrences":1}]}
  SELECT count(*) INTO v_n
    FROM compute_jobs
   WHERE api_key_id = k_e AND kind = 'refresh_allocator_equity_daily';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (E): a strategy-linked key on a book WITH snapshots got % refresh_allocator_equity_daily job(s), expected 1. The population migration 075 refreshed must be unchanged apart from revoked keys.', v_n;
  END IF;
END $grpe$;

-- ==========================================================================
-- GROUP N7 — a SIGN_IN_FAILED key on one zero-snapshot book and an ERROR key
-- on another: no reconstruct (the exchange refused the credential, so it
-- would fail permanently and spend a cap slot every day), and each still gets
-- its refresh, as on 075 (their books are bootstrapped vacuously). Review
-- SFH-04.
-- ==========================================================================
DO $grpn7$
DECLARE
  v_run  text := replace(gen_random_uuid()::text, '-', '');
  v_base timestamptz := now() + INTERVAL '100 years' + INTERVAL '11 days';
  uid_s  uuid := gen_random_uuid();
  uid_e  uuid := gen_random_uuid();
  k_s    uuid := gen_random_uuid();
  k_e    uuid := gen_random_uuid();
  v_rec  int;
  v_ref  int;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_s, '00000000-0000-0000-0000-000000000000', 'test-fanout-boot-n7s-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid_s, 'fanout boot N7 sign-in', 'test-fanout-boot-n7s-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_e, '00000000-0000-0000-0000-000000000000', 'test-fanout-boot-n7e-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid_e, 'fanout boot N7 error', 'test-fanout-boot-n7e-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, sync_status, created_at)
  VALUES (k_s, uid_s, 'okx', 'fanout boot N7 sign-in', 'enc', true, 'sign_in_failed', v_base + INTERVAL '1 hour'),
         (k_e, uid_e, 'okx', 'fanout boot N7 error',   'enc', true, 'error',          v_base);

  PERFORM public.enqueue_refresh_allocator_equity_for_all();

  -- ----- N7: a refused credential is refreshed but never reconstructed -----
  -- RED-UNDER: drop the sign_in_failed/error conjunct from BOTH
  --            reconstruct-loop copies (bq and rk) in migration 20260927120000.
  --            An edit of one copy alone is inert while the other still
  --            filters the key.
  -- RED-UNDER-M: {"arm": "N7", "apply": [{"kind": "edit", "file": "supabase/migrations/20260927120000_refresh_fanout_bootstraps_zero_snapshot_books.sql", "find": "coalesce(bq.sync_status, '') NOT IN ('sign_in_failed', 'error')", "replace": "TRUE", "occurrences": 1}, {"kind": "edit", "file": "supabase/migrations/20260927120000_refresh_fanout_bootstraps_zero_snapshot_books.sql", "find": "coalesce(rk.sync_status, '') NOT IN ('sign_in_failed', 'error')", "replace": "TRUE", "occurrences": 1}]}
  SELECT count(*) FILTER (WHERE kind = 'reconstruct_allocator_history'),
         count(*) FILTER (WHERE kind = 'refresh_allocator_equity_daily')
    INTO v_rec, v_ref
    FROM compute_jobs
   WHERE api_key_id IN (k_s, k_e);
  IF v_rec <> 0 OR v_ref <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (N7): a sign_in_failed key and an error key, each alone on a zero-snapshot book, got % reconstruct and % refresh job(s) together, expected 0 and 2. A reconstruct against a refused credential fails permanently and spends a cap slot every day; the refresh population is 075''s.', v_rec, v_ref;
  END IF;
END $grpn7$;

-- ==========================================================================
-- GROUP B — a zero-snapshot book BEYOND the cap gets no job of either kind in
-- that call, so no first snapshot row can close its gate before its
-- reconstruct exists; the next call takes it whole (T-167.1.2-58).
-- 25 filler books (newest), then one intermediate book, then the target book
-- (one qualifying key and one Deribit key), so the target sits TWO positions
-- past the cap: the intermediate book absorbs the slot arm C's mutation adds.
-- ==========================================================================
DO $grpb$
DECLARE
  v_run    text := replace(gen_random_uuid()::text, '-', '');
  v_base   timestamptz := now() + INTERVAL '100 years' + INTERVAL '20 days';
  v_users  uuid[];
  uid_mid  uuid := gen_random_uuid();
  uid_t    uuid := gen_random_uuid();
  k_mid    uuid := gen_random_uuid();
  k_t      uuid := gen_random_uuid();
  k_td     uuid := gen_random_uuid();
  v_first  int;
  v_rec_t  int;
  v_ref_t  int;
  v_ref_td int;
BEGIN
  SELECT array_agg(gen_random_uuid()) INTO v_users FROM generate_series(1, 25);
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  SELECT v_users[g], '00000000-0000-0000-0000-000000000000', 'test-fanout-boot-bf' || g || '-' || v_run || '@quantalyze.test', now(), now()
    FROM generate_series(1, 25) g;
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_mid, '00000000-0000-0000-0000-000000000000', 'test-fanout-boot-bm-' || v_run || '@quantalyze.test', now(), now()),
         (uid_t,   '00000000-0000-0000-0000-000000000000', 'test-fanout-boot-bt-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  SELECT v_users[g], 'fanout boot B filler', 'test-fanout-boot-bf' || g || '-' || v_run || '@quantalyze.test'
    FROM generate_series(1, 25) g
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid_mid, 'fanout boot B mid',    'test-fanout-boot-bm-' || v_run || '@quantalyze.test'),
         (uid_t,   'fanout boot B target', 'test-fanout-boot-bt-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, created_at)
  SELECT gen_random_uuid(), v_users[g], 'okx', 'fanout boot B filler', 'enc', true, v_base + INTERVAL '3 hours' + make_interval(mins => g)
    FROM generate_series(1, 25) g;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, created_at)
  VALUES (k_mid, uid_mid, 'okx',     'fanout boot B mid',     'enc', true, v_base + INTERVAL '2 hours'),
         (k_t,   uid_t,   'okx',     'fanout boot B target',  'enc', true, v_base + INTERVAL '1 hour'),
         (k_td,  uid_t,   'deribit', 'fanout boot B deribit', 'enc', true, v_base + INTERVAL '1 hour');

  PERFORM public.enqueue_refresh_allocator_equity_for_all();
  SELECT count(*) INTO v_first
    FROM compute_jobs
   WHERE api_key_id IN (k_t, k_td)
     AND kind IN ('refresh_allocator_equity_daily', 'reconstruct_allocator_history');

  PERFORM public.enqueue_refresh_allocator_equity_for_all();
  SELECT count(*) FILTER (WHERE api_key_id = k_t  AND kind = 'reconstruct_allocator_history'),
         count(*) FILTER (WHERE api_key_id = k_t  AND kind = 'refresh_allocator_equity_daily'),
         count(*) FILTER (WHERE api_key_id = k_td AND kind = 'refresh_allocator_equity_daily')
    INTO v_rec_t, v_ref_t, v_ref_td
    FROM compute_jobs
   WHERE api_key_id IN (k_t, k_td);

  -- ----- B: a book beyond the cap waits, whole, for a later call -----------
  -- RED-UNDER: drop the bootstrapped conjunct from the refresh loop in
  --            migration 20260927120000. The target book beyond the cap is then
  --            refreshed in the first call, and its first snapshot row would
  --            close the zero-snapshot gate before its reconstruct exists.
  -- RED-UNDER-M: {"arm":"B","apply":[{"kind":"edit","file":"supabase/migrations/20260927120000_refresh_fanout_bootstraps_zero_snapshot_books.sql","find":"WHERE bk.user_id = ak.user_id","replace":"WHERE FALSE AND bk.user_id = ak.user_id","occurrences":1}]}
  IF v_first <> 0 OR v_rec_t <> 1 OR v_ref_t <> 1 OR v_ref_td <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (B): a zero-snapshot book beyond the per-run cap got % job(s) in the FIRST call (expected 0), then % reconstruct for its qualifying key and % + % refresh(es) for its two keys in the SECOND call (expected 1, 1, 1). A refreshed key beyond the cap strands its reconstruct at zero forever.', v_first, v_rec_t, v_ref_t, v_ref_td;
  END IF;
END $grpb$;

-- ==========================================================================
-- GROUP F — a zero-snapshot book BEYOND the cap whose only reconstruct ended
-- FAILED_FINAL gets no refresh in that call: in the bootstrapped (bk) copy a
-- failed row does not count, so no refresh row closes the gate before the
-- retry is enqueued (review SFH-01). 25 filler books, one intermediate book
-- (it absorbs the slot arm C's mutation adds), then the target, as in B.
-- ==========================================================================
DO $grpf$
DECLARE
  v_run    text := replace(gen_random_uuid()::text, '-', '');
  v_base   timestamptz := now() + INTERVAL '100 years' + INTERVAL '25 days';
  v_users  uuid[];
  uid_mid  uuid := gen_random_uuid();
  uid_t    uuid := gen_random_uuid();
  k_mid    uuid := gen_random_uuid();
  k_t      uuid := gen_random_uuid();
  v_ref    int;
  v_rec    int;
BEGIN
  SELECT array_agg(gen_random_uuid()) INTO v_users FROM generate_series(1, 25);
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  SELECT v_users[g], '00000000-0000-0000-0000-000000000000', 'test-fanout-boot-ff' || g || '-' || v_run || '@quantalyze.test', now(), now()
    FROM generate_series(1, 25) g;
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_mid, '00000000-0000-0000-0000-000000000000', 'test-fanout-boot-fm-' || v_run || '@quantalyze.test', now(), now()),
         (uid_t,   '00000000-0000-0000-0000-000000000000', 'test-fanout-boot-ft-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  SELECT v_users[g], 'fanout boot F filler', 'test-fanout-boot-ff' || g || '-' || v_run || '@quantalyze.test'
    FROM generate_series(1, 25) g
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid_mid, 'fanout boot F mid',    'test-fanout-boot-fm-' || v_run || '@quantalyze.test'),
         (uid_t,   'fanout boot F target', 'test-fanout-boot-ft-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, created_at)
  SELECT gen_random_uuid(), v_users[g], 'okx', 'fanout boot F filler', 'enc', true, v_base + INTERVAL '3 hours' + make_interval(mins => g)
    FROM generate_series(1, 25) g;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, created_at)
  VALUES (k_mid, uid_mid, 'okx', 'fanout boot F mid',    'enc', true, v_base + INTERVAL '2 hours'),
         (k_t,   uid_t,   'okx', 'fanout boot F target', 'enc', true, v_base + INTERVAL '1 hour');
  INSERT INTO compute_jobs (kind, api_key_id, status)
  VALUES ('reconstruct_allocator_history', k_t, 'failed_final');

  PERFORM public.enqueue_refresh_allocator_equity_for_all();

  -- ----- F: a failed reconstruct never bootstraps a book ------------------
  -- RED-UNDER: count a reconstruct row in ANY status in the bootstrapped
  --            (bkj) copy ONLY in migration 20260927120000. The target book
  --            beyond the cap is then refreshed on its failed row, and that
  --            refresh's first snapshot row strands the key at zero.
  -- RED-UNDER-M: {"arm": "F", "apply": [{"kind": "edit", "file": "supabase/migrations/20260927120000_refresh_fanout_bootstraps_zero_snapshot_books.sql", "find": "AND bkj.status IN ('pending', 'running', 'done_pending_children', 'failed_retry', 'done')", "replace": "AND TRUE", "occurrences": 1}]}
  SELECT count(*) FILTER (WHERE kind = 'refresh_allocator_equity_daily'),
         count(*) FILTER (WHERE kind = 'reconstruct_allocator_history' AND status <> 'failed_final')
    INTO v_ref, v_rec
    FROM compute_jobs
   WHERE api_key_id = k_t;
  IF v_ref <> 0 OR v_rec <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (F): a zero-snapshot book beyond the per-run cap whose only reconstruct ended failed_final got % refresh and % new reconstruct job(s) in that call, expected 0 and 0. A failed reconstruct counted as a backfill lets the refresh write the book''s first row and strand the key at zero.', v_ref, v_rec;
  END IF;
END $grpf$;

-- ==========================================================================
-- GROUP C — the per-run cap: 26 zero-snapshot books with one qualifying key
-- each yield exactly 25 reconstructs and 25 refreshes in one call, and the
-- 26th (oldest) book gets neither.
-- ==========================================================================
DO $grpc$
DECLARE
  v_run   text := replace(gen_random_uuid()::text, '-', '');
  v_base  timestamptz := now() + INTERVAL '100 years' + INTERVAL '30 days';
  v_users uuid[];
  v_keys  uuid[];
  v_rec   int;
  v_ref   int;
  v_last  int;
BEGIN
  SELECT array_agg(gen_random_uuid()) INTO v_users FROM generate_series(1, 26);
  SELECT array_agg(gen_random_uuid()) INTO v_keys  FROM generate_series(1, 26);
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  SELECT v_users[g], '00000000-0000-0000-0000-000000000000', 'test-fanout-boot-c' || g || '-' || v_run || '@quantalyze.test', now(), now()
    FROM generate_series(1, 26) g;
  INSERT INTO profiles (id, display_name, email)
  SELECT v_users[g], 'fanout boot C', 'test-fanout-boot-c' || g || '-' || v_run || '@quantalyze.test'
    FROM generate_series(1, 26) g
  ON CONFLICT (id) DO NOTHING;
  -- g = 1 is the OLDEST key, so its book is the 26th the fan-out reaches.
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, created_at)
  SELECT v_keys[g], v_users[g], 'okx', 'fanout boot C', 'enc', true, v_base + make_interval(mins => g)
    FROM generate_series(1, 26) g;

  PERFORM public.enqueue_refresh_allocator_equity_for_all();

  -- ----- C: the per-run cap holds at 25 ------------------------------------
  -- RED-UNDER: raise the cap constant by exactly one in migration
  --            20260927120000, so the 26th book is bootstrapped too.
  -- RED-UNDER-M: {"arm":"C","apply":[{"kind":"edit","file":"supabase/migrations/20260927120000_refresh_fanout_bootstraps_zero_snapshot_books.sql","find":"v_bootstrap_cap CONSTANT integer := 25;","replace":"v_bootstrap_cap CONSTANT integer := 26;","occurrences":1}]}
  SELECT count(*) FILTER (WHERE kind = 'reconstruct_allocator_history'),
         count(*) FILTER (WHERE kind = 'refresh_allocator_equity_daily'),
         count(*) FILTER (WHERE api_key_id = v_keys[1])
    INTO v_rec, v_ref, v_last
    FROM compute_jobs
   WHERE api_key_id = ANY (v_keys)
     AND kind IN ('refresh_allocator_equity_daily', 'reconstruct_allocator_history');
  IF v_rec <> 25 OR v_ref <> 25 OR v_last <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (C): 26 one-key zero-snapshot books got % reconstruct and % refresh job(s) in one call, and the oldest book % job(s); expected 25, 25 and 0. The first run after apply must not flood the worker with 30-minute reconstructs.', v_rec, v_ref, v_last;
  END IF;
END $grpc$;

-- ==========================================================================
-- GROUP S — a book is never split: a TWO-key zero-snapshot book reached when
-- the running count is one below the cap gets BOTH reconstructs.
-- ==========================================================================
DO $grps$
DECLARE
  v_run   text := replace(gen_random_uuid()::text, '-', '');
  v_base  timestamptz := now() + INTERVAL '100 years' + INTERVAL '40 days';
  v_users uuid[];
  uid_s   uuid := gen_random_uuid();
  k_s1    uuid := gen_random_uuid();
  k_s2    uuid := gen_random_uuid();
  v_rec1  int;
  v_rec2  int;
BEGIN
  SELECT array_agg(gen_random_uuid()) INTO v_users FROM generate_series(1, 24);
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  SELECT v_users[g], '00000000-0000-0000-0000-000000000000', 'test-fanout-boot-sf' || g || '-' || v_run || '@quantalyze.test', now(), now()
    FROM generate_series(1, 24) g;
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_s, '00000000-0000-0000-0000-000000000000', 'test-fanout-boot-s-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  SELECT v_users[g], 'fanout boot S filler', 'test-fanout-boot-sf' || g || '-' || v_run || '@quantalyze.test'
    FROM generate_series(1, 24) g
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid_s, 'fanout boot S', 'test-fanout-boot-s-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, created_at)
  SELECT gen_random_uuid(), v_users[g], 'okx', 'fanout boot S filler', 'enc', true, v_base + INTERVAL '1 hour' + make_interval(mins => g)
    FROM generate_series(1, 24) g;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, created_at)
  VALUES (k_s1, uid_s, 'okx',   'fanout boot S one', 'enc', true, v_base + INTERVAL '30 minutes'),
         (k_s2, uid_s, 'bybit', 'fanout boot S two', 'enc', true, v_base + INTERVAL '20 minutes');

  PERFORM public.enqueue_refresh_allocator_equity_for_all();

  -- ----- S: the cap is checked per BOOK, never per key ---------------------
  -- RED-UNDER: in migration 20260927120000, move the cap check from before
  --            each book to before each key. The two-key book is then split:
  --            one key reconstructed, the sibling left for a run whose gate
  --            the first key's snapshot row has already closed.
  -- RED-UNDER-M: {"arm":"S","apply":[{"kind":"edit","file":"supabase/migrations/20260927120000_refresh_fanout_bootstraps_zero_snapshot_books.sql","find":"        EXIT WHEN v_bootstrap_enqueued >= v_bootstrap_cap;\n        FOR v_rkey IN","replace":"        FOR v_rkey IN","occurrences":1},{"kind":"insert-after","file":"supabase/migrations/20260927120000_refresh_fanout_bootstraps_zero_snapshot_books.sql","anchor":"          ORDER BY rk.created_at DESC, rk.id\n        LOOP","text":"\n          EXIT WHEN v_bootstrap_enqueued >= v_bootstrap_cap;","occurrences":1}]}
  SELECT count(*) FILTER (WHERE api_key_id = k_s1),
         count(*) FILTER (WHERE api_key_id = k_s2)
    INTO v_rec1, v_rec2
    FROM compute_jobs
   WHERE api_key_id IN (k_s1, k_s2)
     AND kind = 'reconstruct_allocator_history';
  IF v_rec1 <> 1 OR v_rec2 <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (S): a two-key zero-snapshot book reached one below the cap got % and % reconstruct job(s) for its keys, expected 1 and 1. A split book strands the sibling key at zero.', v_rec1, v_rec2;
  END IF;
END $grps$;

-- ==========================================================================
-- GROUP X1 — a lost enqueue race in the BOOTSTRAP loop skips one key, not the
-- run (review SFH-02). A fixture trigger raises serialization_failure (40001,
-- the enqueue helper's lost-race signal) for one key's reconstruct; an older
-- book's key must still get its reconstruct in the same call.
-- ==========================================================================
DO $grpx1$
DECLARE
  v_run  text := replace(gen_random_uuid()::text, '-', '');
  v_base timestamptz := now() + INTERVAL '100 years' + INTERVAL '50 days';
  uid_a  uuid := gen_random_uuid();
  uid_b  uuid := gen_random_uuid();
  k_refused uuid := gen_random_uuid();
  k_b    uuid := gen_random_uuid();
  v_rec_b int;
  v_ref_a int;
  v_err  text;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_a, '00000000-0000-0000-0000-000000000000', 'test-fanout-boot-x1a-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid_a, 'fanout boot X1 refused', 'test-fanout-boot-x1a-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_b, '00000000-0000-0000-0000-000000000000', 'test-fanout-boot-x1b-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid_b, 'fanout boot X1 other', 'test-fanout-boot-x1b-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, created_at)
  VALUES (k_refused, uid_a, 'okx', 'fanout boot X1 refused', 'enc', true, v_base + INTERVAL '2 hours'),
         (k_b,       uid_b, 'okx', 'fanout boot X1 other',   'enc', true, v_base + INTERVAL '1 hour');
  CREATE FUNCTION public._fanout_boot_refuse() RETURNS trigger
  LANGUAGE plpgsql AS $f$
  BEGIN
    RAISE EXCEPTION USING ERRCODE = TG_ARGV[0], MESSAGE = 'test_refresh_fanout_zero_snapshot_bootstrap: fixture refusal';
  END $f$;
  EXECUTE format('CREATE TRIGGER _fanout_boot_refuse BEFORE INSERT ON public.compute_jobs FOR EACH ROW WHEN (NEW.api_key_id = %L::uuid AND NEW.kind = %L) EXECUTE FUNCTION public._fanout_boot_refuse(%L)', k_refused, 'reconstruct_allocator_history', '40001');

  v_err := NULL;
  BEGIN
    PERFORM public.enqueue_refresh_allocator_equity_for_all();
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLSTATE;
  END;

  DROP TRIGGER _fanout_boot_refuse ON public.compute_jobs;
  DROP FUNCTION public._fanout_boot_refuse();

  -- ----- X1 ---
  -- RED-UNDER: catch unique_violation ONLY in the bootstrap loop's per-key
  --            handler in migration 20260927120000. The 40001 then reaches the
  --            sub-block, which rolls back every bootstrap enqueue of the run,
  --            so one lost race costs every book its reconstruct that day.
  -- RED-UNDER-M: {"arm": "X1", "apply": [{"kind": "edit", "file": "supabase/migrations/20260927120000_refresh_fanout_bootstraps_zero_snapshot_books.sql", "find": "EXCEPTION WHEN unique_violation OR serialization_failure THEN\n            RAISE WARNING 'enqueue_refresh_allocator_equity_for_all: reconstruct enqueue skipped", "replace": "EXCEPTION WHEN unique_violation THEN\n            RAISE WARNING 'enqueue_refresh_allocator_equity_for_all: reconstruct enqueue skipped", "occurrences": 1}]}
  SELECT count(*) FILTER (WHERE api_key_id = k_b AND kind = 'reconstruct_allocator_history'),
         count(*) FILTER (WHERE api_key_id = k_refused AND kind = 'refresh_allocator_equity_daily')
    INTO v_rec_b, v_ref_a
    FROM compute_jobs
   WHERE api_key_id IN (k_refused, k_b);
  IF v_err IS NOT NULL OR v_rec_b <> 1 OR v_ref_a <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (X1): with one key''s reconstruct enqueue losing a race (40001), the call raised SQLSTATE % (expected none), another book''s key got % reconstruct job(s) (expected 1), and the refused key got % refresh job(s) (expected 0). One lost race must skip one key, not the whole bootstrap.', v_err, v_rec_b, v_ref_a;
  END IF;
END $grpx1$;

-- ==========================================================================
-- GROUP X2 — an error in the BOOTSTRAP loop never cancels the refresh loop
-- (review SFH-02). A fixture trigger raises P0001 for one key's reconstruct;
-- a key on a book WITH snapshots must still get its refresh in the same call,
-- and the refused key's book, whose reconstruct was rolled back, must not.
-- ==========================================================================
DO $grpx2$
DECLARE
  v_run  text := replace(gen_random_uuid()::text, '-', '');
  v_base timestamptz := now() + INTERVAL '100 years' + INTERVAL '51 days';
  uid_c  uuid := gen_random_uuid();
  uid_d  uuid := gen_random_uuid();
  k_refused uuid := gen_random_uuid();
  k_d    uuid := gen_random_uuid();
  v_ref_d int;
  v_ref_c int;
  v_err  text;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_c, '00000000-0000-0000-0000-000000000000', 'test-fanout-boot-x2c-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid_c, 'fanout boot X2 refused', 'test-fanout-boot-x2c-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_d, '00000000-0000-0000-0000-000000000000', 'test-fanout-boot-x2d-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid_d, 'fanout boot X2 snapshot', 'test-fanout-boot-x2d-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, created_at)
  VALUES (k_refused, uid_c, 'okx', 'fanout boot X2 refused',  'enc', true, v_base + INTERVAL '2 hours'),
         (k_d,       uid_d, 'okx', 'fanout boot X2 snapshot', 'enc', true, v_base + INTERVAL '1 hour');
  INSERT INTO allocator_equity_snapshots (allocator_id, asof, value_usd, source)
  VALUES (uid_d, DATE '2026-01-01', 100, 'exchange_primary');
  CREATE FUNCTION public._fanout_boot_refuse() RETURNS trigger
  LANGUAGE plpgsql AS $f$
  BEGIN
    RAISE EXCEPTION USING ERRCODE = TG_ARGV[0], MESSAGE = 'test_refresh_fanout_zero_snapshot_bootstrap: fixture refusal';
  END $f$;
  EXECUTE format('CREATE TRIGGER _fanout_boot_refuse BEFORE INSERT ON public.compute_jobs FOR EACH ROW WHEN (NEW.api_key_id = %L::uuid AND NEW.kind = %L) EXECUTE FUNCTION public._fanout_boot_refuse(%L)', k_refused, 'reconstruct_allocator_history', 'P0001');

  v_err := NULL;
  BEGIN
    PERFORM public.enqueue_refresh_allocator_equity_for_all();
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLSTATE;
  END;

  DROP TRIGGER _fanout_boot_refuse ON public.compute_jobs;
  DROP FUNCTION public._fanout_boot_refuse();

  -- ----- X2 ---
  -- RED-UNDER: make the bootstrap sub-block's WHEN OTHERS re-raise in
  --            migration 20260927120000. The error then unwinds the whole
  --            function, and no allocator gets its daily refresh that day.
  -- RED-UNDER-M: {"arm": "X2", "apply": [{"kind": "edit", "file": "supabase/migrations/20260927120000_refresh_fanout_bootstraps_zero_snapshot_books.sql", "find": "      RAISE WARNING 'enqueue_refresh_allocator_equity_for_all: the bootstrap loop failed and was rolled back; the refresh loop still runs (SQLSTATE %: %)', SQLSTATE, SQLERRM;", "replace": "      RAISE;", "occurrences": 1}]}
  SELECT count(*) FILTER (WHERE api_key_id = k_d AND kind = 'refresh_allocator_equity_daily'),
         count(*) FILTER (WHERE api_key_id = k_refused AND kind = 'refresh_allocator_equity_daily')
    INTO v_ref_d, v_ref_c
    FROM compute_jobs
   WHERE api_key_id IN (k_refused, k_d);
  IF v_err IS NOT NULL OR v_ref_d <> 1 OR v_ref_c <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (X2): with the bootstrap loop failing (P0001), the call raised SQLSTATE % (expected none), a key on a book WITH snapshots got % refresh job(s) (expected 1), and the refused zero-snapshot key got % (expected 0). A bootstrap error must never cancel the daily refresh of every allocator.', v_err, v_ref_d, v_ref_c;
  END IF;
END $grpx2$;

-- ==========================================================================
-- GROUP X3 — a lost enqueue race in the REFRESH loop skips one key, not the
-- run (review SFH-02). A fixture trigger raises serialization_failure (40001)
-- for one snapshot book's refresh; another snapshot book's key must still get
-- its refresh in the same call.
-- ==========================================================================
DO $grpx3$
DECLARE
  v_run  text := replace(gen_random_uuid()::text, '-', '');
  v_base timestamptz := now() + INTERVAL '100 years' + INTERVAL '52 days';
  uid_e  uuid := gen_random_uuid();
  uid_f  uuid := gen_random_uuid();
  k_refused uuid := gen_random_uuid();
  k_f    uuid := gen_random_uuid();
  v_ref_f int;
  v_err  text;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_e, '00000000-0000-0000-0000-000000000000', 'test-fanout-boot-x3e-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid_e, 'fanout boot X3 refused', 'test-fanout-boot-x3e-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_f, '00000000-0000-0000-0000-000000000000', 'test-fanout-boot-x3f-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid_f, 'fanout boot X3 other', 'test-fanout-boot-x3f-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, created_at)
  VALUES (k_refused, uid_e, 'okx', 'fanout boot X3 refused', 'enc', true, v_base + INTERVAL '2 hours'),
         (k_f,       uid_f, 'okx', 'fanout boot X3 other',   'enc', true, v_base + INTERVAL '1 hour');
  INSERT INTO allocator_equity_snapshots (allocator_id, asof, value_usd, source)
  VALUES (uid_e, DATE '2026-01-01', 100, 'exchange_primary'),
         (uid_f, DATE '2026-01-01', 100, 'exchange_primary');
  CREATE FUNCTION public._fanout_boot_refuse() RETURNS trigger
  LANGUAGE plpgsql AS $f$
  BEGIN
    RAISE EXCEPTION USING ERRCODE = TG_ARGV[0], MESSAGE = 'test_refresh_fanout_zero_snapshot_bootstrap: fixture refusal';
  END $f$;
  EXECUTE format('CREATE TRIGGER _fanout_boot_refuse BEFORE INSERT ON public.compute_jobs FOR EACH ROW WHEN (NEW.api_key_id = %L::uuid AND NEW.kind = %L) EXECUTE FUNCTION public._fanout_boot_refuse(%L)', k_refused, 'refresh_allocator_equity_daily', '40001');

  v_err := NULL;
  BEGIN
    PERFORM public.enqueue_refresh_allocator_equity_for_all();
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLSTATE;
  END;

  DROP TRIGGER _fanout_boot_refuse ON public.compute_jobs;
  DROP FUNCTION public._fanout_boot_refuse();

  -- ----- X3 ---
  -- RED-UNDER: catch unique_violation ONLY in the refresh loop's per-key
  --            handler in migration 20260927120000 (075's handler). The 40001
  --            then unwinds the whole function, and no allocator gets its
  --            daily refresh that day.
  -- RED-UNDER-M: {"arm": "X3", "apply": [{"kind": "edit", "file": "supabase/migrations/20260927120000_refresh_fanout_bootstraps_zero_snapshot_books.sql", "find": "EXCEPTION WHEN unique_violation OR serialization_failure THEN\n        RAISE WARNING 'enqueue_refresh_allocator_equity_for_all: refresh enqueue skipped", "replace": "EXCEPTION WHEN unique_violation THEN\n        RAISE WARNING 'enqueue_refresh_allocator_equity_for_all: refresh enqueue skipped", "occurrences": 1}]}
  SELECT count(*) INTO v_ref_f
    FROM compute_jobs
   WHERE api_key_id = k_f AND kind = 'refresh_allocator_equity_daily';
  IF v_err IS NOT NULL OR v_ref_f <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (X3): with one key''s refresh enqueue losing a race (40001), the call raised SQLSTATE % (expected none) and another snapshot book''s key got % refresh job(s) (expected 1). One lost race must skip one key, not the daily refresh of every allocator.', v_err, v_ref_f;
  END IF;
END $grpx3$;

-- ==========================================================================
-- GROUP G — the grants: anon and authenticated cannot EXECUTE the fan-out;
-- service_role can. The apply-time self-verify runs once and can be undone
-- afterwards; this arm re-checks it on every corpus run.
-- ==========================================================================
DO $grpg$
DECLARE
  v_oid oid := to_regprocedure('public.enqueue_refresh_allocator_equity_for_all()');
BEGIN
  -- ----- G: a cross-tenant SECURITY DEFINER enqueue is service_role only ---
  -- RED-UNDER: grant EXECUTE to authenticated AFTER the self-verify block in
  --            migration 20260927120000, so the apply survives and any
  --            signed-in user could fan out reconstructs for every book.
  -- RED-UNDER-M: {"arm":"G","apply":[{"kind":"insert-after","file":"supabase/migrations/20260927120000_refresh_fanout_bootstraps_zero_snapshot_books.sql","anchor":"END $selfverify$;","text":"\nGRANT EXECUTE ON FUNCTION public.enqueue_refresh_allocator_equity_for_all() TO authenticated;","occurrences":1}]}
  IF v_oid IS NULL
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (G): enqueue_refresh_allocator_equity_for_all() is missing (oid %), or anon / authenticated can EXECUTE it, or service_role cannot. It is a cross-tenant SECURITY DEFINER enqueue that only pg_cron may call.', v_oid;
  END IF;

  RAISE NOTICE 'test_refresh_fanout_zero_snapshot_bootstrap: every arm passed, Z1 through G';
END $grpg$;

ROLLBACK;
