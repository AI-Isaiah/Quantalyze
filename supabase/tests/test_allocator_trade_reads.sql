-- Test: public.allocator_trade_reads and public.allocator_trade_read_windows
-- (Phase 171 READCEILING, plan 03). Guards migration
-- 20261030120000_allocator_trade_reads.sql.
--
-- Background
-- ----------
-- An account whose trade history is larger than one worker run can read is read
-- over SEVERAL runs: each run keeps what it has read and the next one carries on
-- from there (D-02, "Resumable across runs"), so a book of any size eventually
-- completes. These two tables are where that progress lives, proven here at the
-- database boundary before any writer exists (nothing writes to them until plan
-- 07 deploys):
--   public.allocator_trade_reads         one STATE row per api key: grid origin,
--                                        read version, claim and stalled-claim
--                                        counters, the last job id, expiry.
--   public.allocator_trade_read_windows  the compact trades of each COMPLETE 7-day
--                                        window as numbered chunks of at most 5,000
--                                        trades, each chunk with its own expiry.
--   TR-2  SERVICE-ROLE ONLY. No owner policy, no allocator_id column, no trigger,
--         no function: nothing in the browser reads these rows, and an owner
--         policy would expose per-fill rows through PostgREST for no consumer.
--         service_role has BYPASSRLS, so the control is the GRANT: service_role
--         holds SELECT, INSERT, UPDATE and DELETE (the counters move and the
--         store is purged) and nothing else; anon and authenticated hold nothing.
--   T-171-09  Both tables erase with their key and with their account. A foreign
--         key cascade runs with the privileges of the table owner, so it is
--         proven below (arms 3 and 4) for both tables and both paths.
--   TR-1 / TR-6  Every value rule is a NAMED CHECK, and each refusal below names
--         its own constraint, so one check cannot stand in for another.
--
-- Arms (LISTED and EXECUTED in this order; the order is LOAD-BEARING because each
-- twin's FIRST `TEST FAILED (N)` must name its own arm, so an arm can only depend
-- on arms listed before it; every arm seeds its own users and keys):
--   1  anon and authenticated each get SELECT and INSERT refused on BOTH tables
--      with 42501 and the pinned text `permission denied for table <name>`
--      (FORCE RLS with no policy would also answer 42501 for an INSERT, so the
--      message is pinned); nothing is stored.
--   2  service_role can INSERT a state row and two single-chunk rows of two
--      different windows, SELECT them back, UPDATE the state row's counters and
--      DELETE one window row. No ON CONFLICT: an upsert target is the app's
--      concern and would make arm 7's twin go red here first.
--   3  state erasure: a state row (and no window row) disappears when its key is
--      deleted through delete_allocator_api_key as the owning user, and another
--      state row disappears when its auth user is deleted; a third user's row stays.
--   4  window erasure: the same two paths for window rows (and no state row).
--   5  state CHECKs: venue, claims, stalled_claims and read_version are each
--      refused with 23514 naming their own constraint; a legitimate row is
--      accepted first.
--   6  window CHECKs: span, trade count, chunk position, array shape and version
--      are each refused with 23514 naming their own constraint; legitimate
--      single-chunk rows are accepted first.
--   7  keys: a second state row for one key is refused 23505 on the state primary
--      key; a second row for the same (key, window start, chunk) is refused 23505
--      on the windows primary key; chunk 1 of the same window is accepted.
--   8  catalogue: row level security enabled AND forced on both, no policy on
--      either, and the exact per-role privilege matrix.
--
-- ORDERING RULE for the twins. Arms 1-6 never store two chunks of ONE window (arm
-- 7's twin narrows the windows primary key to the window), arm 3 seeds only state
-- rows and arm 4 only window rows (so each cascade twin bites its own arm first).
--
-- ANTI-GREEN-SKIP CONTRACT. Absence of either table is an EXCEPTION in arm 1, never
-- a skip. Merging supabase/migrations/** applies to PRODUCTION with no human stop,
-- so nothing in the merge path would make a missing object appear. Do not add a
-- presence skip.
--
-- SENTINEL. The final `ALL 8 ARMS EXECUTED (1,...,8)` notice at the foot of this
-- file, before ROLLBACK, joins ci.yml's `sql-tests` sentinel census. That census
-- (and the mutation floors and every other pin that counts gate files) is moved by
-- plan 06 of this phase, not here.
--
-- Every identity carries a digit. Every `TEST FAILED (N)` raise sits DIRECTLY in
-- the DO body (the mutation runner reads an identity only from a single-frame
-- `inline_code_block` raise); the helpers below return values and never raise an
-- identity.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL DO block, RAISE EXCEPTION on
-- failure, no psql meta-commands. The only UPDATE and DELETE in this file are the
-- ones arm 2 expects to SUCCEED as service_role. The whole test rolls back. Seed
-- data is synthetic: generated uuids, @invalid.local emails and invented
-- millisecond values; no message names a uuid or a trade.
--
-- ⭐ RED-UNDER ANNOTATIONS. Each arm below carries a prose `RED-UNDER:` and a
-- machine-readable `RED-UNDER-M:` twin the mutation runner applies on a throwaway
-- pg-lane cluster to PROVE the arm reds on its own, then restores GREEN. Schema:
-- scripts/mutation-runner/GRAMMAR.md. Every twin edits the migration that DEFINES
-- what it mutates, 20261030120000. The migration's own verify block is
-- catalogue-only and asserts only that both tables resolve and both primary keys
-- exist by name, so each edit below leaves those standing and the mutated
-- migration applies clean; the gate, not the apply, is what speaks.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/11-fixture-api-keys-created-at.sql","scripts/pg-lane/fixtures/20-fixture-app-role-helper.sql","scripts/pg-lane/fixtures/21-fixture-api-keys-credential-columns.sql","scripts/pg-lane/fixtures/24-fixture-enqueue-compute-job-chain.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","supabase/migrations/20260418194206_scoring_weight_overrides.sql","supabase/migrations/20260420073003_allocator_holdings.sql","supabase/migrations/20260420213754_allocator_equity_snapshots.sql","supabase/migrations/20260527102050_replace_allocator_equity_snapshots.sql","supabase/migrations/20260529160000_allocator_equity_pre_terminus_flag.sql","supabase/migrations/20260602183000_b5b_api_key_delete_atomicity.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710130000_stitch_composite_kind.sql","supabase/migrations/20260717233529_allocator_equity_derived_surface.sql","scripts/pg-lane/fixtures/41-fixture-api-keys-user-id-fk.sql","supabase/migrations/20261030120000_allocator_trade_reads.sql"]}
-- ⚠️ 07-fixture-supabase-default-privileges.sql is what makes the REVOKE falsifiable:
-- the tables are created by a migration IN this list, so Supabase's bootstrap default
-- privileges hand anon, authenticated and service_role the ALL grant they hold in
-- production, and arms 1, 2 and 8 can only redden because that grant is there to be
-- withdrawn or not.

BEGIN;

-- Seeds one auth user. pg_temp functions live and die with this transaction and
-- carry no arm.
CREATE FUNCTION pg_temp.tr_user() RETURNS uuid
LANGUAGE plpgsql AS $f$
DECLARE
  v_user uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (v_user, '00000000-0000-0000-0000-000000000000',
          'tr-' || v_user::text || '@invalid.local', now(), now());
  RETURN v_user;
END
$f$;

-- Seeds one api_keys row (and the profile it hangs off) for a user.
CREATE FUNCTION pg_temp.tr_key(p_user uuid) RETURNS uuid
LANGUAGE plpgsql AS $f$
DECLARE
  v_key uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.profiles (id, display_name, role)
  VALUES (p_user, 'tr', 'allocator')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.api_keys (id, user_id, exchange, label, api_key_encrypted)
  VALUES (v_key, p_user, 'bybit', 'tr', 'x');
  RETURN v_key;
END
$f$;

-- A valid state row as a jsonb row for a key. jsonb_populate_record leaves a
-- missing field NULL (it does not apply column defaults), so every NOT NULL column
-- is named here.
CREATE FUNCTION pg_temp.tr_state_base(p_key uuid) RETURNS jsonb
LANGUAGE sql AS $f$
  SELECT jsonb_build_object(
    'api_key_id', p_key,
    'venue', 'bybit',
    'grid_origin_ms', 1760000000000,
    'read_version', 1,
    'claims', 1,
    'stalled_claims', 0,
    'expires_at', now() + interval '7 days')
$f$;

-- A valid window chunk as a jsonb row. n_trades is the length of p_trades when it
-- is an array, so a legitimate row satisfies the array-length rule by construction;
-- a case that needs a wrong count overrides n_trades afterwards.
CREATE FUNCTION pg_temp.tr_win_base(p_key uuid, p_start bigint, p_idx integer,
                                    p_cnt integer, p_trades jsonb) RETURNS jsonb
LANGUAGE sql AS $f$
  SELECT jsonb_build_object(
    'api_key_id', p_key,
    'window_start_ms', p_start,
    'chunk_index', p_idx,
    'chunk_count', p_cnt,
    'window_end_ms', p_start + 604800000,
    'read_version', 1,
    'n_trades', CASE WHEN jsonb_typeof(p_trades) = 'array' THEN jsonb_array_length(p_trades) ELSE 0 END,
    'trades', p_trades,
    'expires_at', now() + interval '7 days')
$f$;

-- Tries to insert the state row described by p_row as the CURRENT role. Returns NULL
-- when the row was stored, else `SQLSTATE|message`. It never raises, so the arm that
-- called it decides what the outcome means.
CREATE FUNCTION pg_temp.tr_try_state(p_row jsonb) RETURNS text
LANGUAGE plpgsql AS $f$
BEGIN
  INSERT INTO public.allocator_trade_reads
    (api_key_id, venue, grid_origin_ms, read_version, claims, stalled_claims,
     last_job_id, expires_at)
  SELECT r.api_key_id, r.venue, r.grid_origin_ms, r.read_version, r.claims,
         r.stalled_claims, r.last_job_id, r.expires_at
    FROM jsonb_populate_record(NULL::public.allocator_trade_reads, p_row) r;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || '|' || SQLERRM;
END
$f$;

-- The same for a window chunk.
CREATE FUNCTION pg_temp.tr_try_win(p_row jsonb) RETURNS text
LANGUAGE plpgsql AS $f$
BEGIN
  INSERT INTO public.allocator_trade_read_windows
    (api_key_id, window_start_ms, chunk_index, chunk_count, window_end_ms,
     read_version, n_trades, trades, expires_at)
  SELECT r.api_key_id, r.window_start_ms, r.chunk_index, r.chunk_count,
         r.window_end_ms, r.read_version, r.n_trades, r.trades, r.expires_at
    FROM jsonb_populate_record(NULL::public.allocator_trade_read_windows, p_row) r;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || '|' || SQLERRM;
END
$f$;

-- Tries to read a count from one of the two tables as the CURRENT role. NULL when
-- the read was allowed, else `SQLSTATE|message`.
CREATE FUNCTION pg_temp.tr_try_sel(p_table text) RETURNS text
LANGUAGE plpgsql AS $f$
DECLARE
  v_n bigint;
BEGIN
  EXECUTE format('SELECT count(*) FROM public.%I', p_table) INTO v_n;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || '|' || SQLERRM;
END
$f$;

DO $$
DECLARE
  v_a      uuid;
  v_b      uuid;
  v_c      uuid;
  v_ka     uuid;
  v_kb     uuid;
  v_kc     uuid;
  v_u      uuid;
  v_k      uuid;
  v_n      integer;
  v_cnt    bigint;
  v_state  text;
  v_msg    text;
  v_out    text;
  v_two    jsonb := '[[1760000000001,"BTCUSDT","buy",0.01,60000.5,600.005,0.1],[1760000000002,"ETHUSDT","sell",0.5,2500.25,1250.125,0.2]]'::jsonb;
  v_oid_s  oid := to_regclass('public.allocator_trade_reads');
  v_oid_w  oid := to_regclass('public.allocator_trade_read_windows');
  v_role   text;
  v_tab    text;
  v_priv   text;
  v_want   boolean;
  v_got    boolean;
  v_case   RECORD;
BEGIN
  IF v_oid_s IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (1): public.allocator_trade_reads does not exist - this gate has nothing to test and must not skip';
  END IF;
  IF v_oid_w IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (1): public.allocator_trade_read_windows does not exist - this gate has nothing to test and must not skip';
  END IF;

  -- ===== ARM 1 - anon and authenticated reach nothing (TR-2, T-171-07/08) ====
  -- Each of the two roles is refused SELECT and INSERT on each of the two tables,
  -- by the table PRIVILEGE: the message is pinned, because FORCE RLS with no policy
  -- would also answer 42501 ("new row violates row-level security policy") and hide
  -- a stray INSERT grant behind it. A SELECT cannot be hidden that way (no policy
  -- means zero rows, not an error), so a stray SELECT grant answers NO error.
  -- RED-UNDER: add a SELECT grant on the windows table for authenticated in
  --            20261030120000, the "the dashboard could show a progress bar"
  --            drift. FORCE RLS with zero policies still shows that role zero rows,
  --            so nothing in the migration notices and no row is ever returned;
  --            only the refusal itself sees the grant.
  -- RED-UNDER-M: {"arm":"1","apply":[{"kind":"edit","file":"supabase/migrations/20261030120000_allocator_trade_reads.sql","find":"GRANT SELECT, INSERT, UPDATE, DELETE ON public.allocator_trade_reads, public.allocator_trade_read_windows TO service_role;","replace":"GRANT SELECT, INSERT, UPDATE, DELETE ON public.allocator_trade_reads, public.allocator_trade_read_windows TO service_role;\nGRANT SELECT ON public.allocator_trade_read_windows TO authenticated;","occurrences":1}]}
  v_a := pg_temp.tr_user();
  v_ka := pg_temp.tr_key(v_a);
  FOREACH v_role IN ARRAY ARRAY['authenticated', 'anon'] LOOP
    PERFORM set_config('request.jwt.claims',
      CASE WHEN v_role = 'authenticated'
           THEN json_build_object('sub', v_a::text, 'role', 'authenticated')::text
           ELSE NULL END, true);
    EXECUTE format('SET LOCAL ROLE %I', v_role);
    FOREACH v_tab IN ARRAY ARRAY['allocator_trade_reads', 'allocator_trade_read_windows'] LOOP
      v_out := pg_temp.tr_try_sel(v_tab);
      IF v_out IS NULL OR v_out NOT LIKE ('42501|permission denied for table ' || v_tab || '%') THEN
        RESET ROLE;
        RAISE EXCEPTION 'TEST FAILED (1): % SELECT on % answered %, expected 42501 permission denied for the table', v_role, v_tab, COALESCE(v_out, 'no error (the read was allowed)');
      END IF;
    END LOOP;
    v_out := pg_temp.tr_try_state(pg_temp.tr_state_base(v_ka));
    IF v_out IS NULL OR v_out NOT LIKE '42501|permission denied for table allocator_trade_reads%' THEN
      RESET ROLE;
      RAISE EXCEPTION 'TEST FAILED (1): % INSERT into allocator_trade_reads answered %, expected 42501 permission denied for the table', v_role, COALESCE(v_out, 'no error (the row was stored)');
    END IF;
    v_out := pg_temp.tr_try_win(pg_temp.tr_win_base(v_ka, 1760400000000, 0, 1, v_two));
    IF v_out IS NULL OR v_out NOT LIKE '42501|permission denied for table allocator_trade_read_windows%' THEN
      RESET ROLE;
      RAISE EXCEPTION 'TEST FAILED (1): % INSERT into allocator_trade_read_windows answered %, expected 42501 permission denied for the table', v_role, COALESCE(v_out, 'no error (the row was stored)');
    END IF;
    RESET ROLE;
  END LOOP;
  PERFORM set_config('request.jwt.claims', NULL, true);
  SELECT (SELECT count(*) FROM public.allocator_trade_reads WHERE api_key_id = v_ka)
       + (SELECT count(*) FROM public.allocator_trade_read_windows WHERE api_key_id = v_ka)
    INTO v_n;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (1): % row(s) were stored by a role that may not write', v_n;
  END IF;

  -- ===== ARM 2 - service_role reads and writes both tables (TR-2) ============
  -- The worker is the only user of these tables. A state row and two single-chunk
  -- rows of two DIFFERENT windows go in, are read back, the state row's counters
  -- are updated and one window row is deleted. Each statement is expected to
  -- succeed with the right row count; a privilege refusal is reported as this arm's
  -- failure, not left to propagate.
  -- RED-UNDER: drop UPDATE and DELETE from the one service_role grant in
  --            20261030120000, the "the worker only needs to append" drift copied
  --            from the write-once NAV table. The worker then cannot move a counter
  --            or purge an expired window.
  -- RED-UNDER-M: {"arm":"2","apply":[{"kind":"edit","file":"supabase/migrations/20261030120000_allocator_trade_reads.sql","find":"GRANT SELECT, INSERT, UPDATE, DELETE ON public.allocator_trade_reads, public.allocator_trade_read_windows TO service_role","replace":"GRANT SELECT, INSERT ON public.allocator_trade_reads, public.allocator_trade_read_windows TO service_role","occurrences":1}]}
  v_u := pg_temp.tr_user();
  v_k := pg_temp.tr_key(v_u);
  SET LOCAL ROLE service_role;
  v_out := pg_temp.tr_try_state(pg_temp.tr_state_base(v_k));
  IF v_out IS NOT NULL THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (2): service_role INSERT into allocator_trade_reads answered %, expected it to be accepted', v_out;
  END IF;
  v_out := pg_temp.tr_try_win(pg_temp.tr_win_base(v_k, 1760400000000, 0, 1, v_two));
  IF v_out IS NOT NULL THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (2): service_role INSERT into allocator_trade_read_windows answered %, expected it to be accepted', v_out;
  END IF;
  v_out := pg_temp.tr_try_win(pg_temp.tr_win_base(v_k, 1761004800000, 0, 1, '[]'::jsonb));
  IF v_out IS NOT NULL THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (2): service_role INSERT of a second window answered %, expected it to be accepted', v_out;
  END IF;
  SELECT count(*) INTO v_n FROM public.allocator_trade_reads WHERE api_key_id = v_k;
  IF v_n <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (2): service_role reads % state row(s) back, expected 1', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.allocator_trade_read_windows WHERE api_key_id = v_k;
  IF v_n <> 2 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (2): service_role reads % window row(s) back, expected 2', v_n;
  END IF;
  v_state := NULL; v_msg := NULL; v_cnt := NULL;
  BEGIN
    UPDATE public.allocator_trade_reads SET stalled_claims = 2, claims = 3 WHERE api_key_id = v_k;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_state IS NOT NULL OR v_cnt IS DISTINCT FROM 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (2): service_role UPDATE of the counters answered % (%), expected 1 row updated', COALESCE(v_state, 'no error'), COALESCE(v_msg, 'rows updated: ' || COALESCE(v_cnt::text, 'NULL'));
  END IF;
  SELECT count(*) INTO v_n FROM public.allocator_trade_reads
   WHERE api_key_id = v_k AND claims = 3 AND stalled_claims = 2;
  IF v_n <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (2): the counters did not move; % row(s) carry the updated values, expected 1', v_n;
  END IF;
  v_state := NULL; v_msg := NULL; v_cnt := NULL;
  BEGIN
    DELETE FROM public.allocator_trade_read_windows WHERE api_key_id = v_k AND window_start_ms = 1760400000000;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_state IS NOT NULL OR v_cnt IS DISTINCT FROM 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (2): service_role DELETE of one window answered % (%), expected 1 row deleted', COALESCE(v_state, 'no error'), COALESCE(v_msg, 'rows deleted: ' || COALESCE(v_cnt::text, 'NULL'));
  END IF;
  SELECT count(*) INTO v_n FROM public.allocator_trade_read_windows WHERE api_key_id = v_k;
  RESET ROLE;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (2): % window row(s) remain after deleting one of two, expected 1', v_n;
  END IF;

  -- ===== ARM 3 - state rows erase with their key and their account (T-171-09) =
  -- ONLY state rows are seeded here (arm 4 seeds only window rows), so the twin that
  -- breaks the state table's cascade bites this arm before the windows arm. A is
  -- deleted through delete_allocator_api_key as the owning user, B through its auth
  -- user, and C's row must still be there afterwards.
  -- RED-UNDER: change the state table's api_key_id foreign key in 20261030120000
  --            from ON DELETE CASCADE to ON DELETE RESTRICT. Deleting the key is
  --            then refused (23503) while a state row still names it, and the read
  --            position outlives its account.
  -- RED-UNDER-M: {"arm":"3","apply":[{"kind":"edit","file":"supabase/migrations/20261030120000_allocator_trade_reads.sql","find":"api_key_id      UUID        PRIMARY KEY REFERENCES public.api_keys(id) ON DELETE CASCADE","replace":"api_key_id      UUID        PRIMARY KEY REFERENCES public.api_keys(id) ON DELETE RESTRICT","occurrences":1}]}
  v_a := pg_temp.tr_user();
  v_b := pg_temp.tr_user();
  v_c := pg_temp.tr_user();
  v_ka := pg_temp.tr_key(v_a);
  v_kb := pg_temp.tr_key(v_b);
  v_kc := pg_temp.tr_key(v_c);
  SET LOCAL ROLE service_role;
  v_out := pg_temp.tr_try_state(pg_temp.tr_state_base(v_ka));
  IF v_out IS NULL THEN v_out := pg_temp.tr_try_state(pg_temp.tr_state_base(v_kb)); END IF;
  IF v_out IS NULL THEN v_out := pg_temp.tr_try_state(pg_temp.tr_state_base(v_kc)); END IF;
  RESET ROLE;
  SELECT count(*) INTO v_n FROM public.allocator_trade_reads WHERE api_key_id IN (v_ka, v_kb, v_kc);
  IF v_out IS NOT NULL OR v_n <> 3 THEN
    RAISE EXCEPTION 'TEST FAILED (3): the seed stored % state row(s) (%), expected 3', v_n, COALESCE(v_out, 'no error');
  END IF;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_state := NULL; v_msg := NULL;
  BEGIN
    PERFORM public.delete_allocator_api_key(v_ka, false);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (3): deleting the key raised % (%); a key with a stored read position must still be deletable', v_state, v_msg;
  END IF;
  SELECT count(*) INTO v_n FROM public.api_keys WHERE id = v_ka;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (3): the key was not deleted, so the cascade was not exercised';
  END IF;
  SELECT count(*) INTO v_n FROM public.allocator_trade_reads WHERE api_key_id = v_ka;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (3): % state row(s) outlived their key', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.allocator_trade_reads WHERE api_key_id IN (v_kb, v_kc);
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (3): deleting one key left % of the other two state rows, expected 2', v_n;
  END IF;
  v_state := NULL; v_msg := NULL;
  BEGIN
    DELETE FROM auth.users WHERE id = v_b;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (3): deleting the auth user raised % (%); an account with a stored read position must still be deletable', v_state, v_msg;
  END IF;
  SELECT count(*) INTO v_n FROM public.allocator_trade_reads WHERE api_key_id = v_kb;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (3): % state row(s) outlived their account', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.allocator_trade_reads WHERE api_key_id = v_kc;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (3): another user''s state row was erased along with an unrelated account (% left, expected 1)', v_n;
  END IF;

  -- ===== ARM 4 - window rows erase with their key and their account (T-171-09)
  -- The same two paths as arm 3, for the stored trades themselves, which are the
  -- rows that matter for erasure (per-fill data). ONLY window rows are seeded.
  -- RED-UNDER: change the windows table's api_key_id foreign key in 20261030120000
  --            from ON DELETE CASCADE to ON DELETE RESTRICT. The key delete is then
  --            refused (23503) and the trades outlive their key.
  -- RED-UNDER-M: {"arm":"4","apply":[{"kind":"edit","file":"supabase/migrations/20261030120000_allocator_trade_reads.sql","find":"api_key_id      UUID        NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE","replace":"api_key_id      UUID        NOT NULL REFERENCES public.api_keys(id) ON DELETE RESTRICT","occurrences":1}]}
  v_a := pg_temp.tr_user();
  v_b := pg_temp.tr_user();
  v_c := pg_temp.tr_user();
  v_ka := pg_temp.tr_key(v_a);
  v_kb := pg_temp.tr_key(v_b);
  v_kc := pg_temp.tr_key(v_c);
  SET LOCAL ROLE service_role;
  v_out := pg_temp.tr_try_win(pg_temp.tr_win_base(v_ka, 1760400000000, 0, 1, v_two));
  IF v_out IS NULL THEN v_out := pg_temp.tr_try_win(pg_temp.tr_win_base(v_kb, 1760400000000, 0, 1, v_two)); END IF;
  IF v_out IS NULL THEN v_out := pg_temp.tr_try_win(pg_temp.tr_win_base(v_kc, 1760400000000, 0, 1, v_two)); END IF;
  RESET ROLE;
  SELECT count(*) INTO v_n FROM public.allocator_trade_read_windows WHERE api_key_id IN (v_ka, v_kb, v_kc);
  IF v_out IS NOT NULL OR v_n <> 3 THEN
    RAISE EXCEPTION 'TEST FAILED (4): the seed stored % window row(s) (%), expected 3', v_n, COALESCE(v_out, 'no error');
  END IF;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_state := NULL; v_msg := NULL;
  BEGIN
    PERFORM public.delete_allocator_api_key(v_ka, false);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (4): deleting the key raised % (%); a key with stored trades must still be deletable', v_state, v_msg;
  END IF;
  SELECT count(*) INTO v_n FROM public.api_keys WHERE id = v_ka;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (4): the key was not deleted, so the cascade was not exercised';
  END IF;
  SELECT count(*) INTO v_n FROM public.allocator_trade_read_windows WHERE api_key_id = v_ka;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (4): % window row(s) outlived their key', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.allocator_trade_read_windows WHERE api_key_id IN (v_kb, v_kc);
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (4): deleting one key left % of the other two window rows, expected 2', v_n;
  END IF;
  v_state := NULL; v_msg := NULL;
  BEGIN
    DELETE FROM auth.users WHERE id = v_b;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (4): deleting the auth user raised % (%); an account with stored trades must still be deletable', v_state, v_msg;
  END IF;
  SELECT count(*) INTO v_n FROM public.allocator_trade_read_windows WHERE api_key_id = v_kb;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (4): % window row(s) outlived their account', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.allocator_trade_read_windows WHERE api_key_id = v_kc;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (4): another user''s window row was erased along with an unrelated account (% left, expected 1)', v_n;
  END IF;

  -- ===== ARM 5 - state value checks (TR-1, TR-5, TR-6) =======================
  -- Each refusal is a CHECK violation (23514) naming its own constraint. The
  -- legitimate row goes in first so the checks are shown not to be over-strict.
  -- RED-UNDER: drop the venue CHECK from 20261030120000. A venue outside the closed
  --            set is then stored, and the day a second venue adopts the store it
  --            does so without anyone having decided that it may.
  -- RED-UNDER-M: {"arm":"5","apply":[{"kind":"edit","file":"supabase/migrations/20261030120000_allocator_trade_reads.sql","find":"  CONSTRAINT allocator_trade_reads_venue_chk\n    CHECK (venue IN ('bybit')),\n","replace":"","occurrences":1}]}
  v_u := pg_temp.tr_user();
  v_k := pg_temp.tr_key(v_u);
  v_b := pg_temp.tr_user();
  v_kb := pg_temp.tr_key(v_b);
  SET LOCAL ROLE service_role;
  v_out := pg_temp.tr_try_state(pg_temp.tr_state_base(v_k));
  IF v_out IS NOT NULL THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (5): a valid state row answered %, expected it to be accepted', v_out;
  END IF;
  FOR v_case IN
    SELECT * FROM (VALUES
      ('venue outside the set',  '{"venue": "okx"}',          'allocator_trade_reads_venue_chk'),
      ('claims below zero',      '{"claims": -1}',            'allocator_trade_reads_counts_chk'),
      ('stalled below zero',     '{"stalled_claims": -1}',    'allocator_trade_reads_counts_chk'),
      ('read version zero',      '{"read_version": 0}',       'allocator_trade_reads_version_chk')
    ) AS t(label, overrides, constraint_name)
  LOOP
    v_out := pg_temp.tr_try_state(pg_temp.tr_state_base(v_kb) || v_case.overrides::jsonb);
    IF v_out IS NULL OR v_out NOT LIKE ('23514|%"' || v_case.constraint_name || '"%') THEN
      RESET ROLE;
      RAISE EXCEPTION 'TEST FAILED (5): % answered %, expected a 23514 naming %', v_case.label, COALESCE(v_out, 'no error (the row was stored)'), v_case.constraint_name;
    END IF;
  END LOOP;
  RESET ROLE;
  SELECT count(*) INTO v_n FROM public.allocator_trade_reads WHERE api_key_id = v_kb;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (5): % refused state row(s) were stored anyway', v_n;
  END IF;

  -- ===== ARM 6 - window value checks (TR-1, TR-5) ============================
  -- Each refusal is a 23514 naming its own constraint. PostgreSQL evaluates CHECK
  -- constraints in name order, so a row that breaks two rules reports the one that
  -- sorts first; every case below breaks exactly one rule, except n_trades -1,
  -- which can never equal an array's length and therefore reports _array_chk (its
  -- name sorts before _count_chk). The upper bound of _count_chk is proven by the
  -- 5001-trade case, whose array length matches its count.
  -- RED-UNDER: drop the chunk-position CHECK from 20261030120000. A chunk whose
  --            index is outside its chunk count (or a window of zero chunks) is then
  --            stored, so a half-written window can no longer be told from a whole
  --            one by its numbering.
  -- RED-UNDER-M: {"arm":"6","apply":[{"kind":"edit","file":"supabase/migrations/20261030120000_allocator_trade_reads.sql","find":"  CONSTRAINT allocator_trade_read_windows_chunk_chk\n    CHECK (chunk_count >= 1 AND chunk_index >= 0 AND chunk_index < chunk_count),\n","replace":"","occurrences":1}]}
  v_u := pg_temp.tr_user();
  v_k := pg_temp.tr_key(v_u);
  SET LOCAL ROLE service_role;
  v_out := pg_temp.tr_try_win(pg_temp.tr_win_base(v_k, 1760000000000, 0, 1, '[]'::jsonb));
  IF v_out IS NOT NULL THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (6): a valid empty single-chunk window answered %, expected it to be accepted', v_out;
  END IF;
  v_out := pg_temp.tr_try_win(pg_temp.tr_win_base(v_k, 1760604800000, 0, 1, v_two));
  IF v_out IS NOT NULL THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (6): a valid 2-trade single-chunk window answered %, expected it to be accepted', v_out;
  END IF;

  FOR v_case IN
    SELECT * FROM (VALUES
      ('end equal to start',       '{"window_end_ms": 1760400000000}',                    'allocator_trade_read_windows_span_chk'),
      ('end before start',         '{"window_end_ms": 1760399999999}',                    'allocator_trade_read_windows_span_chk'),
      ('n_trades below zero',      '{"n_trades": -1}',                                    'allocator_trade_read_windows_array_chk'),
      ('chunk index = chunk count','{"chunk_index": 1, "chunk_count": 1}',                'allocator_trade_read_windows_chunk_chk'),
      ('chunk count zero',         '{"chunk_count": 0}',                                  'allocator_trade_read_windows_chunk_chk'),
      ('chunk index below zero',   '{"chunk_index": -1, "chunk_count": 2}',               'allocator_trade_read_windows_chunk_chk'),
      ('trades an object',         '{"trades": {"a": 1}, "n_trades": 0}',                 'allocator_trade_read_windows_array_chk'),
      ('trades a scalar',          '{"trades": 7, "n_trades": 0}',                        'allocator_trade_read_windows_array_chk'),
      ('array longer than count',  '{"n_trades": 1}',                                     'allocator_trade_read_windows_array_chk'),
      ('array shorter than count', '{"n_trades": 3}',                                     'allocator_trade_read_windows_array_chk'),
      ('read version zero',        '{"read_version": 0}',                                 'allocator_trade_read_windows_version_chk')
    ) AS t(label, overrides, constraint_name)
  LOOP
    v_out := pg_temp.tr_try_win(pg_temp.tr_win_base(v_k, 1760400000000, 0, 1, v_two) || v_case.overrides::jsonb);
    IF v_out IS NULL OR v_out NOT LIKE ('23514|%"' || v_case.constraint_name || '"%') THEN
      RESET ROLE;
      RAISE EXCEPTION 'TEST FAILED (6): % answered %, expected a 23514 naming %', v_case.label, COALESCE(v_out, 'no error (the row was stored)'), v_case.constraint_name;
    END IF;
  END LOOP;
  -- the upper bound: 5001 trades in one chunk, the array length agreeing with the count
  v_out := pg_temp.tr_try_win(pg_temp.tr_win_base(v_k, 1760400000000, 0, 1,
    (SELECT jsonb_agg(jsonb_build_array(i, 'BTCUSDT', 'buy', 1, 1, 1, 0)) FROM generate_series(1, 5001) i)));
  IF v_out IS NULL OR v_out NOT LIKE '23514|%"allocator_trade_read_windows_count_chk"%' THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (6): a 5001-trade chunk answered %, expected a 23514 naming allocator_trade_read_windows_count_chk', COALESCE(v_out, 'no error (the row was stored)');
  END IF;
  -- and the bound itself is accepted: exactly 5000 trades
  v_out := pg_temp.tr_try_win(pg_temp.tr_win_base(v_k, 1761000000000, 0, 1,
    (SELECT jsonb_agg(jsonb_build_array(i, 'BTCUSDT', 'buy', 1, 1, 1, 0)) FROM generate_series(1, 5000) i)));
  RESET ROLE;
  IF v_out IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (6): a 5000-trade chunk answered %, expected it to be accepted', v_out;
  END IF;
  SELECT count(*) INTO v_n FROM public.allocator_trade_read_windows WHERE api_key_id = v_k AND window_start_ms = 1760400000000;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (6): % refused window row(s) were stored anyway', v_n;
  END IF;

  -- ===== ARM 7 - keys (TR-1) =================================================
  -- One state row per key; one row per (key, window start, chunk). Chunk 1 of the
  -- same window is a different row and is accepted.
  -- RED-UNDER: remove chunk_index from the windows primary key in 20261030120000,
  --            leaving (api_key_id, window_start_ms). The constraint keeps its name,
  --            so the verify block still finds it, but a window can then hold only
  --            one chunk and every window of more than 5,000 trades is unstorable.
  -- RED-UNDER-M: {"arm":"7","apply":[{"kind":"edit","file":"supabase/migrations/20261030120000_allocator_trade_reads.sql","find":"PRIMARY KEY (api_key_id, window_start_ms, chunk_index)","replace":"PRIMARY KEY (api_key_id, window_start_ms)","occurrences":1}]}
  v_u := pg_temp.tr_user();
  v_k := pg_temp.tr_key(v_u);
  SET LOCAL ROLE service_role;
  v_out := pg_temp.tr_try_state(pg_temp.tr_state_base(v_k));
  IF v_out IS NOT NULL THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (7): the first state row answered %, expected it to be accepted', v_out;
  END IF;
  v_out := pg_temp.tr_try_state(pg_temp.tr_state_base(v_k));
  IF v_out IS NULL OR v_out NOT LIKE '23505|%"allocator_trade_reads_pkey"%' THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (7): a second state row for one key answered %, expected a 23505 naming allocator_trade_reads_pkey', COALESCE(v_out, 'no error (the row was stored)');
  END IF;
  v_out := pg_temp.tr_try_win(pg_temp.tr_win_base(v_k, 1760400000000, 0, 2, v_two));
  IF v_out IS NOT NULL THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (7): chunk 0 of a 2-chunk window answered %, expected it to be accepted', v_out;
  END IF;
  v_out := pg_temp.tr_try_win(pg_temp.tr_win_base(v_k, 1760400000000, 0, 2, v_two));
  IF v_out IS NULL OR v_out NOT LIKE '23505|%"allocator_trade_read_windows_pkey"%' THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (7): a second row for the same key, window and chunk answered %, expected a 23505 naming allocator_trade_read_windows_pkey', COALESCE(v_out, 'no error (the row was stored)');
  END IF;
  v_out := pg_temp.tr_try_win(pg_temp.tr_win_base(v_k, 1760400000000, 1, 2, '[]'::jsonb));
  RESET ROLE;
  IF v_out IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (7): chunk 1 of the same window answered %, expected it to be accepted as a different row', v_out;
  END IF;
  SELECT count(*) INTO v_n FROM public.allocator_trade_read_windows WHERE api_key_id = v_k;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (7): % chunk row(s) are stored for the window, expected exactly 2', v_n;
  END IF;

  -- ===== ARM 8 - catalogue (TR-2) ============================================
  -- RED-UNDER: drop FORCE ROW LEVEL SECURITY from the state table in
  --            20261030120000. Every role the other arms use is a non-owner or
  --            BYPASSRLS, so they all still pass; only the catalogue sees that the
  --            table owner is no longer bound by the (empty) policy set.
  -- RED-UNDER-M: {"arm":"8","apply":[{"kind":"edit","file":"supabase/migrations/20261030120000_allocator_trade_reads.sql","find":"ALTER TABLE public.allocator_trade_reads FORCE ROW LEVEL SECURITY;\n","replace":"","occurrences":1}]}
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = v_oid_s AND c.relrowsecurity AND c.relforcerowsecurity) THEN
    RAISE EXCEPTION 'TEST FAILED (8): row level security is not both enabled and forced on allocator_trade_reads';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = v_oid_w AND c.relrowsecurity AND c.relforcerowsecurity) THEN
    RAISE EXCEPTION 'TEST FAILED (8): row level security is not both enabled and forced on allocator_trade_read_windows';
  END IF;
  SELECT count(*) INTO v_n FROM pg_policy p WHERE p.polrelid IN (v_oid_s, v_oid_w);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (8): % policies exist on the two trade-read tables, expected none (service-role only by design)', v_n;
  END IF;

  FOREACH v_tab IN ARRAY ARRAY['allocator_trade_reads', 'allocator_trade_read_windows'] LOOP
    FOR v_role IN SELECT unnest(ARRAY['anon', 'authenticated', 'service_role']) LOOP
      FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
        v_want := (v_role = 'service_role' AND v_priv IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE'));
        v_got := has_table_privilege(v_role, 'public.' || v_tab, v_priv);
        IF v_got IS DISTINCT FROM v_want THEN
          RAISE EXCEPTION 'TEST FAILED (8): % % on % is %, expected %', v_role, v_priv, v_tab, v_got, v_want;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'ALL 8 ARMS EXECUTED (1,2,3,4,5,6,7,8): anon and authenticated are refused SELECT and INSERT on both tables by the privilege itself (1), service_role reads, inserts, updates and deletes (2), state rows (3) and stored trades (4) erase with their key and with their account while an unrelated row stays, every state value rule names its own constraint (5), every window value rule names its own constraint and the 5000-trade bound is exact (6), each table keeps one state row per key and one row per key, window and chunk (7), row level security is enabled and forced on both with no policy and the privilege matrix is exact (8).';
END $$;

ROLLBACK;
