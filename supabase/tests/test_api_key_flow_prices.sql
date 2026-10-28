-- Test: public.api_key_flow_prices (Phase 177 DERIBITFLOWS, plan 02). Guards migration
-- 20261101120000_api_key_flow_prices.sql.
--
-- Background
-- ----------
-- A Deribit flow that moved the mark is counted at the open of the 1-minute
-- {CCY}_USDC-PERPETUAL candle that contains it (D-04). D-05 (founder 2026-10-28,
-- "Refuse + store prices") stores each resolved price once and reuses it on later
-- derives, so an old flow is never re-read from the exchange. This table is where
-- those prices live, proven here at the database boundary before any writer exists
-- (nothing writes to it until plan 03's worker code deploys):
--   public.api_key_flow_prices   one row per (api key, instrument, candle minute):
--                                the candle open, the rule it was read under, and
--                                when it was stored.
--   FP-1  PER KEY. The set of stored minutes is the timing of a user's deposits and
--         withdrawals, so it erases with the key and the account.
--   FP-2  Every value rule is a NAMED CHECK, and each refusal below names its own
--         constraint, so one check cannot stand in for another. `source` is a closed
--         set of one so a price stored under another rule is never read as this one.
--   FP-3  WRITE-ONCE IS THE GRANT: service_role holds SELECT and INSERT and nothing
--         else; the primary key is the arbiter of the worker's ON CONFLICT DO NOTHING.
--   D-05  SERVICE-ROLE ONLY. No owner policy, no user-owner column, no trigger, no
--         function: nothing in the browser reads these rows. service_role has
--         BYPASSRLS, so the control is the GRANT; anon and authenticated hold nothing.
--   T-177-08  The table erases with its key and with its account. A foreign key
--         cascade runs with the privileges of the table owner, so it is proven below
--         (arm 6) for both paths although service_role holds no DELETE.
--
-- Arms (LISTED and EXECUTED in this order; the order is LOAD-BEARING because each
-- twin's FIRST `TEST FAILED (N)` must name its own arm, so an arm can only depend
-- on arms listed before it; every arm seeds its own users and keys):
--   1  anon and authenticated each get SELECT and INSERT refused with 42501 and the
--      pinned text `permission denied for table api_key_flow_prices` (forced row
--      level security with no policy would also answer 42501 for an INSERT, so the
--      message is pinned); nothing is stored.
--   2  primary key: as service_role a legitimate row is accepted; an identical second
--      row (same key, instrument, minute AND price) without ON CONFLICT is refused
--      23505 naming api_key_flow_prices_pkey; the same minute for another instrument
--      and another minute for the same instrument are each accepted.
--   3  write-once, the worker's form: an INSERT of the same key with a DIFFERENT price
--      using ON CONFLICT (api_key_id, instrument, minute_ms) DO NOTHING stores nothing
--      (ROW_COUNT 0) and the stored row image is byte-identical; SELECT works.
--   4  service_role cannot UPDATE a stored price (42501, pinned text); the row is unchanged.
--   5  service_role cannot DELETE (identity 5a) or TRUNCATE (identity 5b): 42501, pinned text;
--      the row is still there.
--   6  erasure, both paths, one table: a key deleted through delete_allocator_api_key
--      as its owner takes its rows with it, an auth user deleted takes its rows with it,
--      and a third user's row stays.
--   7  value CHECKs: a legitimate row is accepted first; then each refusal is 23514 naming
--      its own constraint, one identity per rule: price NaN and the infinities (7a), price
--      0 and -1 (7b), minute off the minute grid (7c), a malformed instrument (7d), a
--      foreign source (7e).
--   8  catalogue: row level security enabled AND forced, no policy, and the exact
--      per-role privilege matrix (service_role SELECT and INSERT, nothing else).
--
-- ORDERING RULE for the twins. Arms 1-7 never insert two rows that share (key, minute)
-- with different instruments except where arm 2 means to; arm 2's duplicate carries
-- the SAME price (arm 3's twin widens the primary key by price, and arm 2 must pass
-- under it); every row outside arm 7's refusals is legitimate.
--
-- IDENTITIES. The mutation runner needs ONE unique arm id per twin (GRAMMAR.md, `arm`:
-- unique within the file), and arms 5 and 7 each have several independent defects to
-- prove, so they carry sub-identities 5a/5b and 7a-7e. They are still arms 5 and 7 of
-- the eight below, and the sentinel counts eight.
--
-- ANTI-GREEN-SKIP CONTRACT. Absence of the table is an EXCEPTION in arm 1, never a
-- skip. Merging supabase/migrations/** applies to PRODUCTION with no human stop, so
-- nothing in the merge path would make a missing object appear. Do not add a
-- presence skip.
--
-- SENTINEL. The final `ALL 8 ARMS EXECUTED (1,...,8)` notice at the foot of this
-- file, before ROLLBACK, joins ci.yml's `sql-tests` sentinel census. That census
-- (and the mutation floors and every other pin that counts gate files) is moved by
-- plan 07 of this phase, not here.
--
-- Every identity carries a digit. Every `TEST FAILED (N)` raise sits DIRECTLY in
-- the DO body (the mutation runner reads an identity only from a single-frame
-- `inline_code_block` raise); the helpers below return values and never raise an
-- identity.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL DO block, RAISE EXCEPTION on
-- failure, no psql meta-commands. The only UPDATE, DELETE and TRUNCATE in this file
-- are the ones arms 4 and 5 expect to be REFUSED. The whole test rolls back. Seed data
-- is synthetic: generated uuids, @invalid.local emails, invented millisecond values
-- and prices; no message names a uuid, a price or a minute.
--
-- ⭐ RED-UNDER ANNOTATIONS. Each arm below carries a prose `RED-UNDER:` and a
-- machine-readable `RED-UNDER-M:` twin the mutation runner applies on a throwaway
-- pg-lane cluster to PROVE the arm reds on its own, then restores GREEN. Schema:
-- scripts/mutation-runner/GRAMMAR.md. Every twin edits the migration that DEFINES
-- what it mutates, 20261101120000. The migration's own verify block is
-- catalogue-only and asserts only that the table resolves and its primary key exists
-- by name, so each edit below leaves those standing and the mutated migration applies
-- clean; the gate, not the apply, is what speaks.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/11-fixture-api-keys-created-at.sql","scripts/pg-lane/fixtures/20-fixture-app-role-helper.sql","scripts/pg-lane/fixtures/21-fixture-api-keys-credential-columns.sql","scripts/pg-lane/fixtures/24-fixture-enqueue-compute-job-chain.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","supabase/migrations/20260418194206_scoring_weight_overrides.sql","supabase/migrations/20260420073003_allocator_holdings.sql","supabase/migrations/20260420213754_allocator_equity_snapshots.sql","supabase/migrations/20260527102050_replace_allocator_equity_snapshots.sql","supabase/migrations/20260529160000_allocator_equity_pre_terminus_flag.sql","supabase/migrations/20260602183000_b5b_api_key_delete_atomicity.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710130000_stitch_composite_kind.sql","supabase/migrations/20260717233529_allocator_equity_derived_surface.sql","scripts/pg-lane/fixtures/41-fixture-api-keys-user-id-fk.sql","supabase/migrations/20261101120000_api_key_flow_prices.sql"]}
-- ⚠️ 07-fixture-supabase-default-privileges.sql is what makes the REVOKE falsifiable:
-- the table is created by a migration IN this list, so Supabase's bootstrap default
-- privileges hand anon, authenticated and service_role the ALL grant they hold in
-- production, and arms 1, 4, 5 and 8 can only redden because that grant is there to be
-- withdrawn or not. 41-fixture-api-keys-user-id-fk.sql makes the account deletion
-- reach api_keys.

BEGIN;

-- Seeds one auth user. pg_temp functions live and die with this transaction and
-- carry no arm.
CREATE FUNCTION pg_temp.fp_user() RETURNS uuid
LANGUAGE plpgsql AS $f$
DECLARE
  v_user uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (v_user, '00000000-0000-0000-0000-000000000000',
          'fp-' || v_user::text || '@invalid.local', now(), now());
  RETURN v_user;
END
$f$;

-- Seeds one api_keys row (and the profile it hangs off) for a user.
CREATE FUNCTION pg_temp.fp_key(p_user uuid) RETURNS uuid
LANGUAGE plpgsql AS $f$
DECLARE
  v_key uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.profiles (id, display_name, role)
  VALUES (p_user, 'fp', 'allocator')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.api_keys (id, user_id, exchange, label, api_key_encrypted)
  VALUES (v_key, p_user, 'deribit', 'fp', 'x');
  RETURN v_key;
END
$f$;

-- A valid row as a jsonb row. The price is passed as TEXT so a numeric NaN or
-- Infinity (which jsonb cannot hold as a number) reaches the column through its input
-- function. jsonb_populate_record leaves a missing field NULL (it does not apply
-- column defaults), so every NOT NULL column the INSERT names is set here.
CREATE FUNCTION pg_temp.fp_row(p_key uuid, p_instrument text, p_minute_ms bigint,
                               p_price text) RETURNS jsonb
LANGUAGE sql AS $f$
  SELECT jsonb_build_object(
    'api_key_id', p_key,
    'instrument', p_instrument,
    'minute_ms', p_minute_ms,
    'price', p_price,
    'source', 'deribit_perp_1m_open')
$f$;

-- Tries to insert the row described by p_row as the CURRENT role. Returns 'OK' when
-- the row was stored, else `SQLSTATE|message`. It never raises, so the arm that
-- called it decides what the outcome means.
CREATE FUNCTION pg_temp.fp_try(p_row jsonb) RETURNS text
LANGUAGE plpgsql AS $f$
BEGIN
  INSERT INTO public.api_key_flow_prices (api_key_id, instrument, minute_ms, price, source)
  SELECT r.api_key_id, r.instrument, r.minute_ms, r.price, r.source
    FROM jsonb_populate_record(NULL::public.api_key_flow_prices, p_row) r;
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || '|' || SQLERRM;
END
$f$;

-- Tries to read a count from the table as the CURRENT role. 'OK' when the read was
-- allowed, else `SQLSTATE|message`.
CREATE FUNCTION pg_temp.fp_try_sel() RETURNS text
LANGUAGE plpgsql AS $f$
DECLARE
  v_n bigint;
BEGIN
  SELECT count(*) INTO v_n FROM public.api_key_flow_prices;
  RETURN 'OK';
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
  v_img1   jsonb;
  v_img2   jsonb;
  -- invented candle ticks: both are multiples of 60000
  v_m1     bigint := 1760000040000;
  v_m2     bigint := 1760000100000;
  v_oid    oid := to_regclass('public.api_key_flow_prices');
  v_role   text;
  v_priv   text;
  v_want   boolean;
  v_got    boolean;
  v_case   RECORD;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (1): public.api_key_flow_prices does not exist - this gate has nothing to test and must not skip';
  END IF;

  -- ===== ARM 1 - anon and authenticated reach nothing (D-05, T-177-07) =========
  -- Each of the two roles is refused SELECT and INSERT by the table PRIVILEGE: the
  -- message is pinned, because forced row level security with no policy would also
  -- answer 42501 ("new row violates row-level security policy") and hide a stray
  -- INSERT grant behind it. A SELECT cannot be hidden that way (no policy means zero
  -- rows, not an error), so a stray SELECT grant answers NO error.
  -- RED-UNDER: add a SELECT grant on the table for authenticated in 20261101120000,
  --            the "the dashboard could show the stored prices" drift. Forced row
  --            level security with zero policies still shows that role zero rows, so
  --            nothing in the migration notices and no row is ever returned; only the
  --            refusal itself sees the grant.
-- RED-UNDER-M: {"arm":"1","apply":[{"kind":"edit","file":"supabase/migrations/20261101120000_api_key_flow_prices.sql","find":"GRANT SELECT, INSERT ON public.api_key_flow_prices TO service_role;","replace":"GRANT SELECT, INSERT ON public.api_key_flow_prices TO service_role;\nGRANT SELECT ON public.api_key_flow_prices TO authenticated;","occurrences":1}]}
  v_a := pg_temp.fp_user();
  v_ka := pg_temp.fp_key(v_a);
  FOREACH v_role IN ARRAY ARRAY['authenticated', 'anon'] LOOP
    PERFORM set_config('request.jwt.claims',
      CASE WHEN v_role = 'authenticated'
           THEN json_build_object('sub', v_a::text, 'role', 'authenticated')::text
           ELSE NULL END, true);
    EXECUTE format('SET LOCAL ROLE %I', v_role);
    v_out := pg_temp.fp_try_sel();
    IF v_out NOT LIKE '42501|permission denied for table api_key_flow_prices%' THEN
      RESET ROLE;
      RAISE EXCEPTION 'TEST FAILED (1): % SELECT on api_key_flow_prices answered %, expected 42501 permission denied for the table', v_role, v_out;
    END IF;
    v_out := pg_temp.fp_try(pg_temp.fp_row(v_ka, 'BTC_USDC-PERPETUAL', v_m1, '65000.5'));
    IF v_out NOT LIKE '42501|permission denied for table api_key_flow_prices%' THEN
      RESET ROLE;
      RAISE EXCEPTION 'TEST FAILED (1): % INSERT into api_key_flow_prices answered %, expected 42501 permission denied for the table', v_role, CASE WHEN v_out = 'OK' THEN 'no error (the row was stored)' ELSE v_out END;
    END IF;
    RESET ROLE;
  END LOOP;
  PERFORM set_config('request.jwt.claims', NULL, true);
  SELECT count(*) INTO v_n FROM public.api_key_flow_prices WHERE api_key_id = v_ka;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (1): % row(s) were stored by a role that may not write', v_n;
  END IF;

  -- ===== ARM 2 - the primary key (FP-3) ========================================
  -- One row per (key, instrument, minute). The duplicate carries the SAME price as
  -- the first row and no ON CONFLICT, so the primary key is what refuses it, by name.
  -- A second instrument at the same minute and a second minute for the same
  -- instrument are different rows and are accepted.
  -- RED-UNDER: narrow the primary key in 20261101120000 to (api_key_id, minute_ms),
  --            dropping the instrument. The constraint keeps its name, so the verify
  --            block still finds it, but a minute can then hold the price of only one
  --            currency and a derive that moves a BTC and an ETH flow in the same
  --            minute cannot store both.
-- RED-UNDER-M: {"arm":"2","apply":[{"kind":"edit","file":"supabase/migrations/20261101120000_api_key_flow_prices.sql","find":"PRIMARY KEY (api_key_id, instrument, minute_ms)","replace":"PRIMARY KEY (api_key_id, minute_ms)","occurrences":1}]}
  v_u := pg_temp.fp_user();
  v_k := pg_temp.fp_key(v_u);
  SET LOCAL ROLE service_role;
  v_out := pg_temp.fp_try(pg_temp.fp_row(v_k, 'BTC_USDC-PERPETUAL', v_m1, '65000.5'));
  IF v_out <> 'OK' THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (2): service_role INSERT of a legitimate row answered %, expected it to be accepted', v_out;
  END IF;
  v_out := pg_temp.fp_try(pg_temp.fp_row(v_k, 'BTC_USDC-PERPETUAL', v_m1, '65000.5'));
  IF v_out NOT LIKE '23505|%"api_key_flow_prices_pkey"%' THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (2): an identical second row answered %, expected a 23505 naming api_key_flow_prices_pkey', CASE WHEN v_out = 'OK' THEN 'no error (the row was stored)' ELSE v_out END;
  END IF;
  v_out := pg_temp.fp_try(pg_temp.fp_row(v_k, 'ETH_USDC-PERPETUAL', v_m1, '2500.25'));
  IF v_out <> 'OK' THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (2): the same minute for another instrument answered %, expected it to be accepted as a different row', v_out;
  END IF;
  v_out := pg_temp.fp_try(pg_temp.fp_row(v_k, 'BTC_USDC-PERPETUAL', v_m2, '65010'));
  IF v_out <> 'OK' THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (2): another minute for the same instrument answered %, expected it to be accepted as a different row', v_out;
  END IF;
  SELECT count(*) INTO v_n FROM public.api_key_flow_prices WHERE api_key_id = v_k;
  RESET ROLE;
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'TEST FAILED (2): % row(s) are stored for the key, expected exactly 3', v_n;
  END IF;

  -- ===== ARM 3 - write-once, in the worker's own form (FP-3) ===================
  -- The worker writes ON CONFLICT (api_key_id, instrument, minute_ms) DO NOTHING. A
  -- second price for a stored minute must change nothing: ROW_COUNT 0 and the stored
  -- row image byte-identical. SELECT works with no sequence grant to find.
  -- RED-UNDER: widen the primary key in 20261101120000 to include price. The
  --            constraint keeps its name, an identical duplicate (same price) is still
  --            refused, but the worker's conflict target now matches no constraint,
  --            so every store write fails and a stored price is no longer write-once
  --            by key.
-- RED-UNDER-M: {"arm":"3","apply":[{"kind":"edit","file":"supabase/migrations/20261101120000_api_key_flow_prices.sql","find":"PRIMARY KEY (api_key_id, instrument, minute_ms)","replace":"PRIMARY KEY (api_key_id, instrument, minute_ms, price)","occurrences":1}]}
  v_u := pg_temp.fp_user();
  v_k := pg_temp.fp_key(v_u);
  SET LOCAL ROLE service_role;
  v_out := pg_temp.fp_try(pg_temp.fp_row(v_k, 'BTC_USDC-PERPETUAL', v_m1, '65000.5'));
  IF v_out <> 'OK' THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (3): service_role INSERT of a legitimate row answered %, expected it to be accepted', v_out;
  END IF;
  SELECT to_jsonb(t) INTO v_img1 FROM public.api_key_flow_prices t
   WHERE t.api_key_id = v_k AND t.instrument = 'BTC_USDC-PERPETUAL' AND t.minute_ms = v_m1;
  v_state := NULL; v_msg := NULL; v_cnt := NULL;
  BEGIN
    INSERT INTO public.api_key_flow_prices (api_key_id, instrument, minute_ms, price, source)
    VALUES (v_k, 'BTC_USDC-PERPETUAL', v_m1, 99999.9, 'deribit_perp_1m_open')
    ON CONFLICT (api_key_id, instrument, minute_ms) DO NOTHING;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_state IS NOT NULL OR v_cnt IS DISTINCT FROM 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (3): the worker''s ON CONFLICT DO NOTHING answered % (%), expected 0 rows inserted', COALESCE(v_state, 'no error'), COALESCE(v_msg, 'rows inserted: ' || COALESCE(v_cnt::text, 'NULL'));
  END IF;
  SELECT to_jsonb(t) INTO v_img2 FROM public.api_key_flow_prices t
   WHERE t.api_key_id = v_k AND t.instrument = 'BTC_USDC-PERPETUAL' AND t.minute_ms = v_m1;
  SELECT count(*) INTO v_n FROM public.api_key_flow_prices WHERE api_key_id = v_k;
  RESET ROLE;
  IF v_img1 IS DISTINCT FROM v_img2 THEN
    RAISE EXCEPTION 'TEST FAILED (3): the stored row changed after a second write for the same minute';
  END IF;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (3): % row(s) are stored for the key, expected exactly 1', v_n;
  END IF;

  -- ===== ARM 4 - service_role cannot UPDATE a stored price (FP-3, T-177-06) ====
  -- The refusal is the table PRIVILEGE (42501, pinned text), not a trigger. The row
  -- is read back unchanged.
  -- RED-UNDER: widen the one service_role grant in 20261101120000 to include UPDATE,
  --            the "the worker may want to correct a price" drift. A stored price is
  --            then rewritable, and a derive that read it yesterday and one that reads
  --            it today can count the same flow at two prices.
-- RED-UNDER-M: {"arm":"4","apply":[{"kind":"edit","file":"supabase/migrations/20261101120000_api_key_flow_prices.sql","find":"GRANT SELECT, INSERT ON public.api_key_flow_prices TO service_role;","replace":"GRANT SELECT, INSERT, UPDATE ON public.api_key_flow_prices TO service_role;","occurrences":1}]}
  v_u := pg_temp.fp_user();
  v_k := pg_temp.fp_key(v_u);
  SET LOCAL ROLE service_role;
  v_out := pg_temp.fp_try(pg_temp.fp_row(v_k, 'BTC_USDC-PERPETUAL', v_m1, '65000.5'));
  IF v_out <> 'OK' THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (4): service_role INSERT of a legitimate row answered %, expected it to be accepted', v_out;
  END IF;
  SELECT to_jsonb(t) INTO v_img1 FROM public.api_key_flow_prices t WHERE t.api_key_id = v_k;
  v_state := NULL; v_msg := NULL;
  BEGIN
    UPDATE public.api_key_flow_prices SET price = 1 WHERE api_key_id = v_k;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_state IS DISTINCT FROM '42501' OR v_msg NOT LIKE 'permission denied for table api_key_flow_prices%' THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (4): service_role UPDATE of a stored price answered % (%), expected 42501 permission denied for the table', COALESCE(v_state, 'no error'), COALESCE(v_msg, 'the update ran');
  END IF;
  SELECT to_jsonb(t) INTO v_img2 FROM public.api_key_flow_prices t WHERE t.api_key_id = v_k;
  RESET ROLE;
  IF v_img1 IS DISTINCT FROM v_img2 THEN
    RAISE EXCEPTION 'TEST FAILED (4): the stored row changed although the UPDATE was refused';
  END IF;

  -- ===== ARM 5 - service_role cannot DELETE or TRUNCATE (FP-3, T-177-06) ======
  -- Each is refused by the table PRIVILEGE with the pinned text; the row is still
  -- there afterwards. The TRUNCATE (identity 5b) is attempted after the DELETE (identity
  -- 5a) and its result is checked before anything is counted.
  -- RED-UNDER: widen the one service_role grant in 20261101120000 to include DELETE.
  --            A stored price can then be removed and re-read from the exchange at a
  --            different value.
-- RED-UNDER-M: {"arm":"5a","apply":[{"kind":"edit","file":"supabase/migrations/20261101120000_api_key_flow_prices.sql","find":"GRANT SELECT, INSERT ON public.api_key_flow_prices TO service_role;","replace":"GRANT SELECT, INSERT, DELETE ON public.api_key_flow_prices TO service_role;","occurrences":1}]}
  v_u := pg_temp.fp_user();
  v_k := pg_temp.fp_key(v_u);
  SET LOCAL ROLE service_role;
  v_out := pg_temp.fp_try(pg_temp.fp_row(v_k, 'BTC_USDC-PERPETUAL', v_m1, '65000.5'));
  IF v_out <> 'OK' THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (5a): service_role INSERT of a legitimate row answered %, expected it to be accepted', v_out;
  END IF;
  v_state := NULL; v_msg := NULL;
  BEGIN
    DELETE FROM public.api_key_flow_prices WHERE api_key_id = v_k;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_state IS DISTINCT FROM '42501' OR v_msg NOT LIKE 'permission denied for table api_key_flow_prices%' THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (5a): service_role DELETE answered % (%), expected 42501 permission denied for the table', COALESCE(v_state, 'no error'), COALESCE(v_msg, 'the delete ran');
  END IF;
  -- RED-UNDER: widen the one service_role grant in 20261101120000 to include TRUNCATE.
  --            Every row of every key can then be emptied in one statement, and the
  --            DELETE refusal above never sees it.
-- RED-UNDER-M: {"arm":"5b","apply":[{"kind":"edit","file":"supabase/migrations/20261101120000_api_key_flow_prices.sql","find":"GRANT SELECT, INSERT ON public.api_key_flow_prices TO service_role;","replace":"GRANT SELECT, INSERT, TRUNCATE ON public.api_key_flow_prices TO service_role;","occurrences":1}]}
  v_state := NULL; v_msg := NULL;
  BEGIN
    TRUNCATE public.api_key_flow_prices;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_state IS DISTINCT FROM '42501' OR v_msg NOT LIKE 'permission denied for table api_key_flow_prices%' THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (5b): service_role TRUNCATE answered % (%), expected 42501 permission denied for the table', COALESCE(v_state, 'no error'), COALESCE(v_msg, 'the truncate ran');
  END IF;
  SELECT count(*) INTO v_n FROM public.api_key_flow_prices WHERE api_key_id = v_k;
  RESET ROLE;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (5b): % row(s) remain for the key after the refused DELETE and TRUNCATE, expected 1', v_n;
  END IF;

  -- ===== ARM 6 - rows erase with their key and their account (T-177-08) ========
  -- The two erasure paths, one table. service_role holds no DELETE, so the cascade is
  -- what removes the rows, and it runs with the privileges of the table owner. A is
  -- deleted through delete_allocator_api_key as the owning user, B through its auth
  -- user, and C's row must still be there afterwards. A foreign-key error on either
  -- path is trapped and reported as this arm's failure with its SQLSTATE.
  -- RED-UNDER: change the api_key_id foreign key in 20261101120000 from ON DELETE
  --            CASCADE to ON DELETE NO ACTION. Deleting the key is then refused
  --            (23503) while a stored price still names it, and the timing of a
  --            user's flows outlives their account.
-- RED-UNDER-M: {"arm":"6","apply":[{"kind":"edit","file":"supabase/migrations/20261101120000_api_key_flow_prices.sql","find":"REFERENCES public.api_keys(id) ON DELETE CASCADE","replace":"REFERENCES public.api_keys(id) ON DELETE NO ACTION","occurrences":1}]}
  v_a := pg_temp.fp_user();
  v_b := pg_temp.fp_user();
  v_c := pg_temp.fp_user();
  v_ka := pg_temp.fp_key(v_a);
  v_kb := pg_temp.fp_key(v_b);
  v_kc := pg_temp.fp_key(v_c);
  SET LOCAL ROLE service_role;
  v_out := pg_temp.fp_try(pg_temp.fp_row(v_ka, 'BTC_USDC-PERPETUAL', v_m1, '65000.5'));
  IF v_out = 'OK' THEN v_out := pg_temp.fp_try(pg_temp.fp_row(v_kb, 'BTC_USDC-PERPETUAL', v_m1, '65000.5')); END IF;
  IF v_out = 'OK' THEN v_out := pg_temp.fp_try(pg_temp.fp_row(v_kc, 'BTC_USDC-PERPETUAL', v_m1, '65000.5')); END IF;
  RESET ROLE;
  SELECT count(*) INTO v_n FROM public.api_key_flow_prices WHERE api_key_id IN (v_ka, v_kb, v_kc);
  IF v_out <> 'OK' OR v_n <> 3 THEN
    RAISE EXCEPTION 'TEST FAILED (6): the seed stored % row(s) (%), expected 3', v_n, v_out;
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
    RAISE EXCEPTION 'TEST FAILED (6): deleting the key raised % (%); a key with stored prices must still be deletable', v_state, v_msg;
  END IF;
  SELECT count(*) INTO v_n FROM public.api_keys WHERE id = v_ka;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (6): the key was not deleted, so the cascade was not exercised';
  END IF;
  SELECT count(*) INTO v_n FROM public.api_key_flow_prices WHERE api_key_id = v_ka;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (6): % price row(s) outlived their key', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.api_key_flow_prices WHERE api_key_id IN (v_kb, v_kc);
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (6): deleting one key left % of the other two price rows, expected 2', v_n;
  END IF;
  v_state := NULL; v_msg := NULL;
  BEGIN
    DELETE FROM auth.users WHERE id = v_b;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (6): deleting the auth user raised % (%); an account with stored prices must still be deletable', v_state, v_msg;
  END IF;
  SELECT count(*) INTO v_n FROM public.api_key_flow_prices WHERE api_key_id = v_kb;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (6): % price row(s) outlived their account', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.api_key_flow_prices WHERE api_key_id = v_kc;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (6): another user''s price row was erased along with an unrelated account (% left, expected 1)', v_n;
  END IF;

  -- ===== ARM 7 - value checks (FP-2, D-04, T-177-09) ===========================
  -- Each refusal is a CHECK violation (23514) naming its own constraint. The
  -- legitimate row goes in first so the checks are shown not to be over-strict.
  -- Every case breaks exactly ONE rule (PostgreSQL evaluates CHECK constraints in
  -- name order, so a row that broke two would report the one that sorts first).
  -- 7a: the price rule's NaN half. A numeric NaN sorts above every number, so a plain
  -- "greater than zero" test admits NaN and Infinity.
  -- RED-UNDER: reduce the price CHECK in 20261101120000 to `price > 0`. NaN and
  --            Infinity both pass it and are stored, and a derive multiplies a flow by
  --            them.
-- RED-UNDER-M: {"arm":"7a","apply":[{"kind":"edit","file":"supabase/migrations/20261101120000_api_key_flow_prices.sql","find":"CHECK (price NOT IN ('NaN', 'Infinity', '-Infinity') AND price > 0)","replace":"CHECK (price > 0)","occurrences":1}]}
  v_u := pg_temp.fp_user();
  v_k := pg_temp.fp_key(v_u);
  SET LOCAL ROLE service_role;
  v_out := pg_temp.fp_try(pg_temp.fp_row(v_k, 'BTC_USDC-PERPETUAL', v_m1, '65000.5'));
  IF v_out <> 'OK' THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (7a): a valid row answered %, expected it to be accepted', v_out;
  END IF;
  FOR v_case IN
    SELECT t.label, t.row_json, t.constraint_name FROM (VALUES
      ('price NaN', pg_temp.fp_row(v_k, 'BTC_USDC-PERPETUAL', v_m2, 'NaN'), 'api_key_flow_prices_price_chk'),
      ('price infinite', pg_temp.fp_row(v_k, 'BTC_USDC-PERPETUAL', v_m2, 'Infinity'), 'api_key_flow_prices_price_chk'),
      ('price negative infinite', pg_temp.fp_row(v_k, 'BTC_USDC-PERPETUAL', v_m2, '-Infinity'), 'api_key_flow_prices_price_chk')
    ) AS t(label, row_json, constraint_name)
  LOOP
    v_out := pg_temp.fp_try(v_case.row_json);
    IF v_out NOT LIKE ('23514|%"' || v_case.constraint_name || '"%') THEN
      RESET ROLE;
      RAISE EXCEPTION 'TEST FAILED (7a): % answered %, expected a 23514 naming %', v_case.label, CASE WHEN v_out = 'OK' THEN 'no error (the row was stored)' ELSE v_out END, v_case.constraint_name;
    END IF;
  END LOOP;

  -- 7b: the price rule's positive half.
  -- RED-UNDER: reduce the price CHECK in 20261101120000 to its NOT IN half. NaN and the
  --            infinities are still refused, but 0 and -1 are stored.
-- RED-UNDER-M: {"arm":"7b","apply":[{"kind":"edit","file":"supabase/migrations/20261101120000_api_key_flow_prices.sql","find":"CHECK (price NOT IN ('NaN', 'Infinity', '-Infinity') AND price > 0)","replace":"CHECK (price NOT IN ('NaN', 'Infinity', '-Infinity'))","occurrences":1}]}
  FOR v_case IN
    SELECT t.label, t.row_json, t.constraint_name FROM (VALUES
      ('price zero', pg_temp.fp_row(v_k, 'BTC_USDC-PERPETUAL', v_m2, '0'), 'api_key_flow_prices_price_chk'),
      ('price negative', pg_temp.fp_row(v_k, 'BTC_USDC-PERPETUAL', v_m2, '-1'), 'api_key_flow_prices_price_chk')
    ) AS t(label, row_json, constraint_name)
  LOOP
    v_out := pg_temp.fp_try(v_case.row_json);
    IF v_out NOT LIKE ('23514|%"' || v_case.constraint_name || '"%') THEN
      RESET ROLE;
      RAISE EXCEPTION 'TEST FAILED (7b): % answered %, expected a 23514 naming %', v_case.label, CASE WHEN v_out = 'OK' THEN 'no error (the row was stored)' ELSE v_out END, v_case.constraint_name;
    END IF;
  END LOOP;

  -- 7c: the minute rule.
  -- RED-UNDER: reduce the minute CHECK in 20261101120000 to `minute_ms > 0`. A tick that
  --            is not a minute boundary is stored and never matches a candle again.
-- RED-UNDER-M: {"arm":"7c","apply":[{"kind":"edit","file":"supabase/migrations/20261101120000_api_key_flow_prices.sql","find":"CHECK (minute_ms > 0 AND minute_ms % 60000 = 0)","replace":"CHECK (minute_ms > 0)","occurrences":1}]}
  FOR v_case IN
    SELECT t.label, t.row_json, t.constraint_name FROM (VALUES
      ('minute off the grid', pg_temp.fp_row(v_k, 'BTC_USDC-PERPETUAL', 1760000100001, '65000.5'), 'api_key_flow_prices_minute_chk'),
      ('minute zero', pg_temp.fp_row(v_k, 'BTC_USDC-PERPETUAL', 0, '65000.5'), 'api_key_flow_prices_minute_chk'),
      ('minute negative', pg_temp.fp_row(v_k, 'BTC_USDC-PERPETUAL', -60000, '65000.5'), 'api_key_flow_prices_minute_chk')
    ) AS t(label, row_json, constraint_name)
  LOOP
    v_out := pg_temp.fp_try(v_case.row_json);
    IF v_out NOT LIKE ('23514|%"' || v_case.constraint_name || '"%') THEN
      RESET ROLE;
      RAISE EXCEPTION 'TEST FAILED (7c): % answered %, expected a 23514 naming %', v_case.label, CASE WHEN v_out = 'OK' THEN 'no error (the row was stored)' ELSE v_out END, v_case.constraint_name;
    END IF;
  END LOOP;

  -- 7d: the instrument rule.
  -- RED-UNDER: reduce the instrument CHECK in 20261101120000 to a non-empty test. A
  --            lower-case instrument, one with no currency or a USDT instrument is
  --            stored under a key the worker never asks for.
-- RED-UNDER-M: {"arm":"7d","apply":[{"kind":"edit","file":"supabase/migrations/20261101120000_api_key_flow_prices.sql","find":"CHECK (instrument ~ '^[A-Z0-9]{2,10}_USDC-PERPETUAL$')","replace":"CHECK (instrument <> '')","occurrences":1}]}
  FOR v_case IN
    SELECT t.label, t.row_json, t.constraint_name FROM (VALUES
      ('instrument lower case', pg_temp.fp_row(v_k, 'btc_usdc-perpetual', v_m2, '65000.5'), 'api_key_flow_prices_instrument_chk'),
      ('instrument no currency', pg_temp.fp_row(v_k, 'BTC-PERPETUAL', v_m2, '65000.5'), 'api_key_flow_prices_instrument_chk'),
      ('instrument USDT', pg_temp.fp_row(v_k, 'BTC_USDT-PERPETUAL', v_m2, '65000.5'), 'api_key_flow_prices_instrument_chk'),
      ('instrument currency too long', pg_temp.fp_row(v_k, 'ABCDEFGHIJK_USDC-PERPETUAL', v_m2, '65000.5'), 'api_key_flow_prices_instrument_chk')
    ) AS t(label, row_json, constraint_name)
  LOOP
    v_out := pg_temp.fp_try(v_case.row_json);
    IF v_out NOT LIKE ('23514|%"' || v_case.constraint_name || '"%') THEN
      RESET ROLE;
      RAISE EXCEPTION 'TEST FAILED (7d): % answered %, expected a 23514 naming %', v_case.label, CASE WHEN v_out = 'OK' THEN 'no error (the row was stored)' ELSE v_out END, v_case.constraint_name;
    END IF;
  END LOOP;

  -- 7e: the source rule, then the count of what was stored.
  -- RED-UNDER: widen the source set in 20261101120000 with 'deribit_index'. A price read
  --            under another rule is then stored and later read back as this one.
-- RED-UNDER-M: {"arm":"7e","apply":[{"kind":"edit","file":"supabase/migrations/20261101120000_api_key_flow_prices.sql","find":"CHECK (source IN ('deribit_perp_1m_open'))","replace":"CHECK (source IN ('deribit_perp_1m_open', 'deribit_index'))","occurrences":1}]}
  FOR v_case IN
    SELECT t.label, t.row_json, t.constraint_name FROM (VALUES
      ('source another rule', pg_temp.fp_row(v_k, 'BTC_USDC-PERPETUAL', v_m2, '65000.5') || '{"source": "deribit_index"}'::jsonb, 'api_key_flow_prices_source_chk')
    ) AS t(label, row_json, constraint_name)
  LOOP
    v_out := pg_temp.fp_try(v_case.row_json);
    IF v_out NOT LIKE ('23514|%"' || v_case.constraint_name || '"%') THEN
      RESET ROLE;
      RAISE EXCEPTION 'TEST FAILED (7e): % answered %, expected a 23514 naming %', v_case.label, CASE WHEN v_out = 'OK' THEN 'no error (the row was stored)' ELSE v_out END, v_case.constraint_name;
    END IF;
  END LOOP;
  SELECT count(*) INTO v_n FROM public.api_key_flow_prices WHERE api_key_id = v_k;
  RESET ROLE;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (7e): % row(s) are stored for the key, expected only the one legitimate row', v_n;
  END IF;

  -- ===== ARM 8 - catalogue (D-05) ==============================================
  -- RED-UNDER: drop the FORCE statement from 20261101120000 (ALTER TABLE ... NO FORCE
  --            ROW LEVEL SECURITY is the machine form). Every role the other arms use
  --            is a non-owner or BYPASSRLS, so they all still pass; only the catalogue
  --            sees that the table owner is no longer bound by the (empty) policy set.
-- RED-UNDER-M: {"arm":"8","apply":[{"kind":"edit","file":"supabase/migrations/20261101120000_api_key_flow_prices.sql","find":"ALTER TABLE public.api_key_flow_prices FORCE ROW LEVEL SECURITY;\n","replace":"ALTER TABLE public.api_key_flow_prices NO FORCE ROW LEVEL SECURITY;\n","occurrences":1}]}
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = v_oid AND c.relrowsecurity AND c.relforcerowsecurity) THEN
    RAISE EXCEPTION 'TEST FAILED (8): row level security is not both enabled and forced on api_key_flow_prices';
  END IF;
  SELECT count(*) INTO v_n FROM pg_policy p WHERE p.polrelid = v_oid;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (8): % policies exist on api_key_flow_prices, expected none (service-role only by design)', v_n;
  END IF;

  FOR v_role IN SELECT unnest(ARRAY['anon', 'authenticated', 'service_role']) LOOP
    FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      v_want := (v_role = 'service_role' AND v_priv IN ('SELECT', 'INSERT'));
      v_got := has_table_privilege(v_role, 'public.api_key_flow_prices', v_priv);
      IF v_got IS DISTINCT FROM v_want THEN
        RAISE EXCEPTION 'TEST FAILED (8): % % on api_key_flow_prices is %, expected %', v_role, v_priv, v_got, v_want;
      END IF;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'ALL 8 ARMS EXECUTED (1,2,3,4,5,6,7,8): anon and authenticated are refused SELECT and INSERT by the privilege itself (1), the primary key refuses a duplicate by name and admits another instrument and another minute (2), the worker''s ON CONFLICT DO NOTHING leaves a stored row byte-identical (3), service_role cannot UPDATE (4), DELETE or TRUNCATE (5), rows erase with their key and with their account while an unrelated row stays (6), every value rule names its own constraint (7), row level security is enabled and forced with no policy and the privilege matrix is exact (8).';
END $$;

ROLLBACK;
