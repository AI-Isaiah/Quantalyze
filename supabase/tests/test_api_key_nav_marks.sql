-- Test: public.api_key_nav_marks (Phase 167.2.1.1.1 NAVMTM, plan 01). Guards
-- migration 20261029120000_api_key_nav_marks.sql.
--
-- Background
-- ----------
-- From the day NAVMTM deploys, every daily ingest stores each key's
-- marked-to-market NAV (equity including open profit), the open profit itself and
-- the mark time, one row per key per UTC day. The table is the storage half of
-- that, proven here at the database boundary before any writer exists:
--   D-01  one owner-readable table, one row per key per day.
--   D-06  write-once. The first writer of a day wins; the worker can add a row and
--         can never change or remove one. service_role has BYPASSRLS, so this is a
--         GRANT property (SELECT and INSERT only), not a policy. Key and account
--         deletion still erase the marks through ON DELETE CASCADE, and that is
--         PROVEN below (arms 6 and 7, research assumption A1), not assumed.
--   D-07  the native amount and unit, the USD figure and the close day used to
--         price it; Deribit (multi-currency) carries a native_detail object.
--   D-03 / D-11  mark_day labels the day that just closed: it is a function of
--         the read instant, (marked_at AT TIME ZONE 'UTC')::date - 1, so a read
--         any time on the following UTC day still carries the same label.
--
-- Arms (LISTED and EXECUTED in this order; the order is LOAD-BEARING because each
-- twin's FIRST `TEST FAILED (N)` must name its own arm, so an arm can only depend
-- on arms listed before it; every arm seeds its own users and keys, except that
-- arm 4 re-uses the mark arm 3 seeded):
--   1  RLS (D-01): the owner reads its own mark, another authenticated user reads
--      none of it, anon reads nothing.
--   2  write-once (D-06): a second insert for the same key and day under
--      ON CONFLICT DO NOTHING leaves the first row byte-identical (to_jsonb), and
--      the service_role insert needs no sequence grant for the identity column.
--   3  service_role UPDATE is refused with a privilege error and the row is
--      unchanged.
--   4  service_role DELETE and TRUNCATE are each refused with a privilege error.
--   5  authenticated INSERT and anon INSERT are each refused by a PRIVILEGE error,
--      not by row-level security: the message is pinned, because FORCE RLS with no
--      write policy would also answer 42501 and hide a stray INSERT grant.
--   6  deleting the key (through delete_allocator_api_key, the app path) removes
--      its marks although service_role holds no DELETE (A1, D-06 cascade).
--   7  deleting the auth user removes the marks (A1, D-06 cascade).
--   8  owner coherence: a mark whose allocator_id is not the key owner is refused
--      by the trigger and nothing is written; a mark for a key that does not exist
--      is refused by the trigger too, ahead of the foreign key.
--   9  the label rule (D-03 / D-11): wrong labels refused (23514), a late write
--      the next UTC day accepted, the first instant of the second day refused,
--      and the label is read in UTC whatever the offset of the literal.
--   10 value checks (each 23514, each naming its own constraint): NaN and
--      infinities, venue outside the closed set, native_detail not an object,
--      price_day without a native unit, native scalars half NULL, a malformed
--      native unit, a row with neither a native unit nor a native_detail; and the
--      three legitimate shapes (USD, BTC with a price day, Deribit) are accepted.
--   11 catalogue: RLS enabled and forced, exactly the owner SELECT policy, the
--      per-role privilege matrix, the trigger present and enabled, its function
--      SECURITY DEFINER with search_path public, pg_catalog.
--
-- ANTI-GREEN-SKIP CONTRACT. Absence of the table is an EXCEPTION, never a skip.
-- Merging supabase/migrations/** applies to PRODUCTION with no human stop, so
-- nothing in the merge path would make a missing object appear. Do not add a
-- presence skip.
--
-- SENTINEL. The final `ALL 11 ARMS EXECUTED (1,...,11)` notice at the foot of this
-- file, before ROLLBACK, joins ci.yml's `sql-tests` sentinel census. That census
-- is moved by plan 02 of this phase, not here.
--
-- Every identity carries a digit. Every `TEST FAILED (N)` raise sits DIRECTLY in
-- the DO body (the mutation runner reads an identity only from a single-frame
-- `inline_code_block` raise); the helpers below return values and never raise an
-- identity.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL DO block, RAISE EXCEPTION on
-- failure, no psql meta-commands. The only UPDATE in this file is one that arm 3
-- expects to be REFUSED. The whole test rolls back. Seed data is synthetic:
-- generated uuids, @invalid.local emails and invented 2026 dates; no message names
-- a uuid or an amount.
--
-- ⭐ RED-UNDER ANNOTATIONS. Each arm below carries a prose `RED-UNDER:` and a
-- machine-readable `RED-UNDER-M:` twin the mutation runner applies on a throwaway
-- pg-lane cluster to PROVE the arm reds on its own, then restores GREEN. Schema:
-- scripts/mutation-runner/GRAMMAR.md. Every twin edits the migration that DEFINES
-- what it mutates, 20261029120000. The migration's own verify block is
-- catalogue-only and asserts only the table, the unique constraint by name, the
-- trigger and the definer function's search_path, so each edit below leaves those
-- standing and the mutated migration applies clean; the gate, not the apply, is
-- what speaks.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/11-fixture-api-keys-created-at.sql","scripts/pg-lane/fixtures/20-fixture-app-role-helper.sql","scripts/pg-lane/fixtures/21-fixture-api-keys-credential-columns.sql","scripts/pg-lane/fixtures/24-fixture-enqueue-compute-job-chain.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","supabase/migrations/20260418194206_scoring_weight_overrides.sql","supabase/migrations/20260420073003_allocator_holdings.sql","supabase/migrations/20260420213754_allocator_equity_snapshots.sql","supabase/migrations/20260527102050_replace_allocator_equity_snapshots.sql","supabase/migrations/20260529160000_allocator_equity_pre_terminus_flag.sql","supabase/migrations/20260602183000_b5b_api_key_delete_atomicity.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710130000_stitch_composite_kind.sql","supabase/migrations/20260717233529_allocator_equity_derived_surface.sql","supabase/migrations/20261029120000_api_key_nav_marks.sql"]}
-- ⚠️ 07-fixture-supabase-default-privileges.sql is what makes the REVOKE falsifiable:
-- the table is created by a migration IN this list, so Supabase's bootstrap default
-- privileges hand anon, authenticated and service_role the ALL grant they hold in
-- production, and arms 3, 4 and 5 can only redden because that grant is there to be
-- withdrawn or not.

BEGIN;

-- Seeds one auth user. pg_temp functions live and die with this transaction and
-- carry no arm.
CREATE FUNCTION pg_temp.nm_user() RETURNS uuid
LANGUAGE plpgsql AS $f$
DECLARE
  v_user uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (v_user, '00000000-0000-0000-0000-000000000000',
          'nm-' || v_user::text || '@invalid.local', now(), now());
  RETURN v_user;
END
$f$;

-- Seeds one api_keys row (and the profile it hangs off) for a user.
CREATE FUNCTION pg_temp.nm_key(p_user uuid) RETURNS uuid
LANGUAGE plpgsql AS $f$
DECLARE
  v_key uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.profiles (id, display_name, role)
  VALUES (p_user, 'nm', 'allocator')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.api_keys (id, user_id, exchange, label, api_key_encrypted)
  VALUES (v_key, p_user, 'binance', 'nm', 'x');
  RETURN v_key;
END
$f$;

-- A valid USD-venue mark as a jsonb row for (key, owner, label day). marked_at is
-- 00:10 UTC on the day AFTER the label, which is the D-03 shape.
CREATE FUNCTION pg_temp.nm_base(p_key uuid, p_alloc uuid, p_day date) RETURNS jsonb
LANGUAGE sql AS $f$
  SELECT jsonb_build_object(
    'api_key_id', p_key,
    'allocator_id', p_alloc,
    'mark_day', p_day,
    'marked_at', ((p_day + 1)::timestamp AT TIME ZONE 'UTC') + interval '10 minutes',
    'venue', 'okx',
    'nav_usd', 1000.50,
    'open_pnl_usd', 12.25,
    'nav_native', 1000.50,
    'open_pnl_native', 12.25,
    'native_unit', 'USD')
$f$;

-- Tries to insert the row described by p_row as the CURRENT role. Returns NULL
-- when the row was stored, else `SQLSTATE|message`. It never raises, so the arm
-- that called it decides what the outcome means.
CREATE FUNCTION pg_temp.nm_try(p_row jsonb) RETURNS text
LANGUAGE plpgsql AS $f$
BEGIN
  INSERT INTO public.api_key_nav_marks
    (api_key_id, allocator_id, mark_day, marked_at, venue, nav_usd, open_pnl_usd,
     nav_native, open_pnl_native, native_unit, price_day, native_detail)
  SELECT r.api_key_id, r.allocator_id, r.mark_day, r.marked_at, r.venue, r.nav_usd,
         r.open_pnl_usd, r.nav_native, r.open_pnl_native, r.native_unit, r.price_day,
         r.native_detail
    FROM jsonb_populate_record(NULL::public.api_key_nav_marks, p_row) r;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE || '|' || SQLERRM;
END
$f$;

DO $$
DECLARE
  v_a      uuid;
  v_b      uuid;
  v_ka     uuid;
  v_kb     uuid;
  v_u      uuid;
  v_k      uuid;
  v_k2     uuid;
  v_n      integer;
  v_cnt    bigint;
  v_state  text;
  v_msg    text;
  v_img0   jsonb;
  v_img1   jsonb;
  v_out    text;
  v_oid    oid := to_regclass('public.api_key_nav_marks');
  v_role   text;
  v_priv   text;
  v_want   boolean;
  v_got    boolean;
  v_cfg    text[];
  v_secdef boolean;
  v_pol    RECORD;
  v_case   RECORD;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (1): public.api_key_nav_marks does not exist - this gate has nothing to test and must not skip';
  END IF;

  -- ===== ARM 1 - owner-only reads (D-01) ====================================
  -- A and B each own one mark. A reads its own and none of B's, B reads its own
  -- and none of A's, anon reads nothing at all (a privilege refusal is the
  -- expected shape; any other error is not swallowed).
  -- RED-UNDER: widen the owner SELECT policy in 20261029120000 to USING (true), the
  --            "the dashboard needs to read these" drift. The policy still EXISTS,
  --            so nothing in the migration notices, and A still reads exactly its
  --            own row, so only the cross-tenant read can see it.
  -- RED-UNDER-M: {"arm":"1","apply":[{"kind":"edit","file":"supabase/migrations/20261029120000_api_key_nav_marks.sql","find":"USING (allocator_id = auth.uid())","replace":"USING (true)","occurrences":1}]}
  v_a := pg_temp.nm_user();
  v_b := pg_temp.nm_user();
  v_ka := pg_temp.nm_key(v_a);
  v_kb := pg_temp.nm_key(v_b);
  SET LOCAL ROLE service_role;
  INSERT INTO public.api_key_nav_marks
    (api_key_id, allocator_id, mark_day, marked_at, venue, nav_usd, open_pnl_usd,
     nav_native, open_pnl_native, native_unit)
  VALUES
    (v_ka, v_a, DATE '2026-03-01', TIMESTAMPTZ '2026-03-02 00:10:00+00', 'okx', 1000.50, 12.25, 1000.50, 12.25, 'USD'),
    (v_kb, v_b, DATE '2026-03-01', TIMESTAMPTZ '2026-03-02 00:10:00+00', 'okx', 2000.50, 22.25, 2000.50, 22.25, 'USD');
  RESET ROLE;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_a::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.api_key_nav_marks WHERE api_key_id = v_ka;
  IF v_n <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (1): the owner reads % of its own marks, expected 1', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.api_key_nav_marks WHERE api_key_id = v_kb;
  IF v_n <> 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (1): authenticated user A reads % of user B''s marks, expected 0 - CROSS-TENANT LEAK', v_n;
  END IF;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_b::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO v_n FROM public.api_key_nav_marks WHERE api_key_id = v_kb;
  IF v_n <> 1 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (1): the owner reads % of its own marks, expected 1', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.api_key_nav_marks WHERE api_key_id = v_ka;
  IF v_n <> 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (1): authenticated user B reads % of user A''s marks, expected 0 - CROSS-TENANT LEAK', v_n;
  END IF;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  SET LOCAL ROLE anon;
  v_n := NULL;
  BEGIN
    SELECT count(*) INTO v_n FROM public.api_key_nav_marks WHERE api_key_id IN (v_ka, v_kb);
  EXCEPTION WHEN insufficient_privilege THEN
    v_n := 0;
  END;
  RESET ROLE;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (1): anon reads % marks, expected 0', v_n;
  END IF;

  -- ===== ARM 2 - write-once, the first writer wins (D-06) ===================
  -- A Deribit-shaped mark is inserted as service_role (the real writer; the
  -- identity column needs no sequence grant, or this insert would raise). A
  -- second insert for the same key and day, with a different NAV and a later
  -- read time, runs under ON CONFLICT DO NOTHING: it must store nothing and the
  -- stored row must be byte-identical (to_jsonb of the whole row) afterwards.
  -- RED-UNDER: widen the UNIQUE constraint in 20261029120000 to
  --            (api_key_id, mark_day, marked_at). The constraint keeps its name, so
  --            the verify block still finds it, but ON CONFLICT (api_key_id,
  --            mark_day) then has no matching arbiter and the second writer either
  --            raises or, with a different read time, stores a second row for the
  --            day: the first writer no longer wins.
  -- RED-UNDER-M: {"arm":"2","apply":[{"kind":"edit","file":"supabase/migrations/20261029120000_api_key_nav_marks.sql","find":"    UNIQUE (api_key_id, mark_day),","replace":"    UNIQUE (api_key_id, mark_day, marked_at),","occurrences":1}]}
  v_u := pg_temp.nm_user();
  v_k := pg_temp.nm_key(v_u);
  SET LOCAL ROLE service_role;
  INSERT INTO public.api_key_nav_marks
    (api_key_id, allocator_id, mark_day, marked_at, venue, nav_usd, open_pnl_usd, native_detail)
  VALUES
    (v_k, v_u, DATE '2026-03-01', TIMESTAMPTZ '2026-03-02 00:10:00+00', 'deribit', 5000.125, -75.5,
     '{"usd_basis": "venue_index_at_marked_at", "currencies": {"BTC": {"equity": 0.1, "open_pnl": -0.001}}}'::jsonb);
  SELECT to_jsonb(m) INTO v_img0 FROM public.api_key_nav_marks m
   WHERE m.api_key_id = v_k AND m.mark_day = DATE '2026-03-01';
  v_state := NULL; v_msg := NULL; v_cnt := NULL;
  BEGIN
    INSERT INTO public.api_key_nav_marks
      (api_key_id, allocator_id, mark_day, marked_at, venue, nav_usd, open_pnl_usd,
       nav_native, open_pnl_native, native_unit)
    VALUES
      (v_k, v_u, DATE '2026-03-01', TIMESTAMPTZ '2026-03-02 05:00:00+00', 'okx', 9999, 1, 9999, 1, 'USD')
    ON CONFLICT (api_key_id, mark_day) DO NOTHING;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_state IS NOT NULL THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (2): the second writer raised % (%) instead of leaving the first row alone', v_state, v_msg;
  END IF;
  IF v_cnt IS DISTINCT FROM 0 THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (2): the second writer stored % row(s), expected 0 (the first writer of a day wins)', COALESCE(v_cnt::text, 'NULL');
  END IF;
  SELECT count(*) INTO v_n FROM public.api_key_nav_marks WHERE api_key_id = v_k;
  SELECT to_jsonb(m) INTO v_img1 FROM public.api_key_nav_marks m
   WHERE m.api_key_id = v_k AND m.mark_day = DATE '2026-03-01';
  RESET ROLE;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (2): % rows are stored for the key and day, expected exactly the first writer''s 1', v_n;
  END IF;
  IF v_img1 IS DISTINCT FROM v_img0 THEN
    RAISE EXCEPTION 'TEST FAILED (2): the stored row changed after the second writer; before % after %', v_img0, v_img1;
  END IF;

  -- ===== ARM 3 - service_role cannot UPDATE a stored mark ===================
  -- The UPDATE below is EXPECTED to be refused. The refusal must be the table
  -- PRIVILEGE (service_role has BYPASSRLS, so nothing else could refuse it), and
  -- the row must be untouched.
  -- RED-UNDER: add UPDATE to the service_role grant in 20261029120000, the "let the
  --            worker correct a bad mark" drift. The UPDATE then succeeds.
  -- RED-UNDER-M: {"arm":"3","apply":[{"kind":"edit","file":"supabase/migrations/20261029120000_api_key_nav_marks.sql","find":"GRANT SELECT, INSERT ON public.api_key_nav_marks TO service_role","replace":"GRANT SELECT, INSERT, UPDATE ON public.api_key_nav_marks TO service_role","occurrences":1}]}
  v_u := pg_temp.nm_user();
  v_k := pg_temp.nm_key(v_u);
  SET LOCAL ROLE service_role;
  INSERT INTO public.api_key_nav_marks
    (api_key_id, allocator_id, mark_day, marked_at, venue, nav_usd, open_pnl_usd,
     nav_native, open_pnl_native, native_unit)
  VALUES
    (v_k, v_u, DATE '2026-03-01', TIMESTAMPTZ '2026-03-02 00:10:00+00', 'okx', 1000.50, 12.25, 1000.50, 12.25, 'USD');
  v_state := NULL; v_msg := NULL;
  BEGIN
    UPDATE public.api_key_nav_marks SET nav_usd = 1 WHERE api_key_id = v_k;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_state IS DISTINCT FROM '42501' OR v_msg NOT LIKE 'permission denied for table api_key_nav_marks%' THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (3): service_role UPDATE answered % (%), expected 42501 permission denied for the table', COALESCE(v_state, 'no error'), COALESCE(v_msg, 'the UPDATE was accepted');
  END IF;
  SELECT count(*) INTO v_n FROM public.api_key_nav_marks WHERE api_key_id = v_k AND nav_usd = 1000.50;
  RESET ROLE;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (3): the stored mark no longer carries its first nav_usd';
  END IF;

  -- ===== ARM 4 - service_role cannot DELETE or TRUNCATE =====================
  -- RED-UNDER: add DELETE to the service_role grant in 20261029120000. The row
  --            can then be removed and re-written, which is exactly what write-once
  --            exists to prevent.
  -- RED-UNDER-M: {"arm":"4","apply":[{"kind":"edit","file":"supabase/migrations/20261029120000_api_key_nav_marks.sql","find":"GRANT SELECT, INSERT ON public.api_key_nav_marks TO service_role","replace":"GRANT SELECT, INSERT, DELETE ON public.api_key_nav_marks TO service_role","occurrences":1}]}
  SET LOCAL ROLE service_role;
  v_state := NULL; v_msg := NULL;
  BEGIN
    DELETE FROM public.api_key_nav_marks WHERE api_key_id = v_k;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_state IS DISTINCT FROM '42501' OR v_msg NOT LIKE 'permission denied for table api_key_nav_marks%' THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (4): service_role DELETE answered % (%), expected 42501 permission denied for the table', COALESCE(v_state, 'no error'), COALESCE(v_msg, 'the DELETE was accepted');
  END IF;
  v_state := NULL; v_msg := NULL;
  BEGIN
    TRUNCATE public.api_key_nav_marks;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_state IS DISTINCT FROM '42501' OR v_msg NOT LIKE 'permission denied for table api_key_nav_marks%' THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (4): service_role TRUNCATE answered % (%), expected 42501 permission denied for the table', COALESCE(v_state, 'no error'), COALESCE(v_msg, 'the TRUNCATE was accepted');
  END IF;
  SELECT count(*) INTO v_n FROM public.api_key_nav_marks WHERE api_key_id = v_k;
  RESET ROLE;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (4): the stored mark is gone after the refused DELETE and TRUNCATE';
  END IF;

  -- ===== ARM 5 - authenticated and anon cannot INSERT =======================
  -- The message is pinned to the PRIVILEGE refusal. With FORCE RLS and no write
  -- policy an authenticated INSERT would ALSO answer 42501 ("new row violates
  -- row-level security policy"), so the SQLSTATE alone cannot tell a withheld
  -- grant from a stray one hidden behind the policy.
  -- RED-UNDER: grant INSERT on the table to authenticated in 20261029120000. The
  --            insert is still refused (no write policy), but by row-level
  --            security, so only the pinned message sees the grant.
  -- RED-UNDER-M: {"arm":"5","apply":[{"kind":"edit","file":"supabase/migrations/20261029120000_api_key_nav_marks.sql","find":"GRANT SELECT ON public.api_key_nav_marks TO authenticated","replace":"GRANT SELECT, INSERT ON public.api_key_nav_marks TO authenticated","occurrences":1}]}
  v_u := pg_temp.nm_user();
  v_k := pg_temp.nm_key(v_u);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_u::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_out := pg_temp.nm_try(pg_temp.nm_base(v_k, v_u, DATE '2026-03-01'));
  RESET ROLE;
  IF v_out IS NULL OR v_out NOT LIKE '42501|permission denied for table api_key_nav_marks%' THEN
    RAISE EXCEPTION 'TEST FAILED (5): authenticated INSERT answered %, expected 42501 permission denied for the table', COALESCE(v_out, 'no error (the row was stored)');
  END IF;
  PERFORM set_config('request.jwt.claims', NULL, true);
  SET LOCAL ROLE anon;
  v_out := pg_temp.nm_try(pg_temp.nm_base(v_k, v_u, DATE '2026-03-01'));
  RESET ROLE;
  IF v_out IS NULL OR v_out NOT LIKE '42501|permission denied for table api_key_nav_marks%' THEN
    RAISE EXCEPTION 'TEST FAILED (5): anon INSERT answered %, expected 42501 permission denied for the table', COALESCE(v_out, 'no error (the row was stored)');
  END IF;
  SELECT count(*) INTO v_n FROM public.api_key_nav_marks WHERE api_key_id = v_k;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (5): % mark(s) were stored by a role that may not write', v_n;
  END IF;

  -- ===== ARM 6 - deleting the key erases its marks (A1, D-06 cascade) =======
  -- The key is deleted the way the app does it, through delete_allocator_api_key
  -- as the owning authenticated user. service_role holds no DELETE on the marks
  -- (arm 4), so the marks can only go through the foreign key's cascade.
  -- RED-UNDER: change the api_key_id foreign key in 20261029120000 from
  --            ON DELETE CASCADE to ON DELETE RESTRICT. The key delete is then
  --            refused (23503) and the marks outlive their key.
  -- RED-UNDER-M: {"arm":"6","apply":[{"kind":"edit","file":"supabase/migrations/20261029120000_api_key_nav_marks.sql","find":"api_key_id       UUID        NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE","replace":"api_key_id       UUID        NOT NULL REFERENCES public.api_keys(id) ON DELETE RESTRICT","occurrences":1}]}
  v_u := pg_temp.nm_user();
  v_k := pg_temp.nm_key(v_u);
  SET LOCAL ROLE service_role;
  INSERT INTO public.api_key_nav_marks
    (api_key_id, allocator_id, mark_day, marked_at, venue, nav_usd, open_pnl_usd,
     nav_native, open_pnl_native, native_unit)
  VALUES
    (v_k, v_u, DATE '2026-03-01', TIMESTAMPTZ '2026-03-02 00:10:00+00', 'okx', 1000.50, 12.25, 1000.50, 12.25, 'USD'),
    (v_k, v_u, DATE '2026-03-02', TIMESTAMPTZ '2026-03-03 00:10:00+00', 'okx', 1010.50, 13.25, 1010.50, 13.25, 'USD');
  RESET ROLE;
  SELECT count(*) INTO v_n FROM public.api_key_nav_marks WHERE api_key_id = v_k;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (6): the seed stored % marks, expected 2', v_n;
  END IF;
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_u::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  v_state := NULL; v_msg := NULL;
  BEGIN
    PERFORM public.delete_allocator_api_key(v_k, false);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (6): deleting the key raised % (%); a key with marks must still be deletable', v_state, v_msg;
  END IF;
  SELECT count(*) INTO v_n FROM public.api_keys WHERE id = v_k;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (6): the key was not deleted, so the cascade was not exercised';
  END IF;
  SELECT count(*) INTO v_n FROM public.api_key_nav_marks WHERE api_key_id = v_k;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (6): % mark(s) outlived their key', v_n;
  END IF;

  -- ===== ARM 7 - deleting the auth user erases the marks (A1, D-06 cascade) =
  -- RED-UNDER: change the allocator_id foreign key in 20261029120000 from
  --            ON DELETE CASCADE to ON DELETE RESTRICT. Deleting the account is
  --            then refused (23503) while a mark still names it.
  -- RED-UNDER-M: {"arm":"7","apply":[{"kind":"edit","file":"supabase/migrations/20261029120000_api_key_nav_marks.sql","find":"allocator_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE","replace":"allocator_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT","occurrences":1}]}
  v_u := pg_temp.nm_user();
  v_k := pg_temp.nm_key(v_u);
  SET LOCAL ROLE service_role;
  INSERT INTO public.api_key_nav_marks
    (api_key_id, allocator_id, mark_day, marked_at, venue, nav_usd, open_pnl_usd,
     nav_native, open_pnl_native, native_unit)
  VALUES
    (v_k, v_u, DATE '2026-03-01', TIMESTAMPTZ '2026-03-02 00:10:00+00', 'okx', 1000.50, 12.25, 1000.50, 12.25, 'USD');
  RESET ROLE;
  v_state := NULL; v_msg := NULL;
  BEGIN
    DELETE FROM auth.users WHERE id = v_u;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (7): deleting the auth user raised % (%); an account with marks must still be deletable', v_state, v_msg;
  END IF;
  SELECT count(*) INTO v_n FROM public.api_key_nav_marks WHERE allocator_id = v_u OR api_key_id = v_k;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (7): % mark(s) outlived their account', v_n;
  END IF;

  -- ===== ARM 8 - owner coherence ============================================
  -- A mark for A's key that names B as its owner is refused by the trigger, and
  -- nothing is stored. A mark for a key that does not exist is refused by the
  -- trigger as well (a BEFORE trigger runs ahead of the foreign key, which would
  -- answer 23503), so both RAISE arms of the function are exercised.
  -- RED-UNDER: make enforce_api_key_nav_marks_owner_coherence in 20261029120000
  --            RETURN NEW before it looks the key up. The trigger still exists
  --            and the function still has the right search_path, so the verify
  --            block passes, and a mark can name another user as its owner.
  -- RED-UNDER-M: {"arm":"8","apply":[{"kind":"edit","file":"supabase/migrations/20261029120000_api_key_nav_marks.sql","find":"  SELECT user_id INTO v_expected_owner","replace":"  RETURN NEW;\n  SELECT user_id INTO v_expected_owner","occurrences":1}]}
  v_a := pg_temp.nm_user();
  v_b := pg_temp.nm_user();
  v_ka := pg_temp.nm_key(v_a);
  SET LOCAL ROLE service_role;
  v_out := pg_temp.nm_try(pg_temp.nm_base(v_ka, v_b, DATE '2026-03-01'));
  RESET ROLE;
  IF v_out IS NULL OR v_out NOT LIKE 'P0001|api_key_nav_marks.allocator_id%must match api_keys.user_id%' THEN
    RAISE EXCEPTION 'TEST FAILED (8): a mark naming another user as its owner answered %, expected the owner-coherence exception', COALESCE(v_out, 'no error (the row was stored)');
  END IF;
  SELECT count(*) INTO v_n FROM public.api_key_nav_marks WHERE api_key_id = v_ka;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (8): % mark(s) were stored for a mismatched owner', v_n;
  END IF;
  SET LOCAL ROLE service_role;
  v_out := pg_temp.nm_try(pg_temp.nm_base(gen_random_uuid(), v_a, DATE '2026-03-01'));
  RESET ROLE;
  IF v_out IS NULL OR v_out NOT LIKE 'P0001|api_key_nav_marks.api_key_id%does not reference an existing api_keys row%' THEN
    RAISE EXCEPTION 'TEST FAILED (8): a mark for a key that does not exist answered %, expected the trigger exception', COALESCE(v_out, 'no error (the row was stored)');
  END IF;

  -- ===== ARM 9 - the label rule (D-03 / D-11) ===============================
  -- mark_day is (marked_at AT TIME ZONE 'UTC')::date - 1. Refused: a label equal
  -- to the read day, a label in the future, a label two days behind (the first
  -- instant of the second day), and a label read in the session offset instead of
  -- UTC. Accepted: a read at 23:59:59 UTC the day after the label (the late
  -- retry of D-11), the first instant of the next day, and the UTC reading of an
  -- offset literal.
  -- RED-UNDER: weaken the label CHECK in 20261029120000 so that a label equal to
  --            the read day is ALSO accepted. Every legitimate seed still passes,
  --            which is why the drift can sit unseen; only a mislabelled row
  --            can see it.
  -- RED-UNDER-M: {"arm":"9","apply":[{"kind":"edit","file":"supabase/migrations/20261029120000_api_key_nav_marks.sql","find":"CHECK (mark_day = (marked_at AT TIME ZONE 'UTC')::date - 1)","replace":"CHECK (mark_day IN ((marked_at AT TIME ZONE 'UTC')::date - 1, (marked_at AT TIME ZONE 'UTC')::date))","occurrences":1}]}
  v_u := pg_temp.nm_user();
  v_k := pg_temp.nm_key(v_u);
  SET LOCAL ROLE service_role;
  -- read 2026-03-02 00:10Z labelled 2026-03-02 (the read day itself)
  v_out := pg_temp.nm_try(pg_temp.nm_base(v_k, v_u, DATE '2026-03-01')
    || '{"mark_day": "2026-03-02"}'::jsonb);
  IF v_out IS NULL OR v_out NOT LIKE '23514|%api_key_nav_marks_label_chk%' THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (9): a mark labelled with its own read day answered %, expected the label check', COALESCE(v_out, 'no error (the row was stored)');
  END IF;
  -- a label in the future
  v_out := pg_temp.nm_try(pg_temp.nm_base(v_k, v_u, DATE '2026-03-01')
    || '{"mark_day": "2026-03-09"}'::jsonb);
  IF v_out IS NULL OR v_out NOT LIKE '23514|%api_key_nav_marks_label_chk%' THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (9): a mark labelled in the future answered %, expected the label check', COALESCE(v_out, 'no error (the row was stored)');
  END IF;
  -- first instant of the SECOND day after the label
  v_out := pg_temp.nm_try(pg_temp.nm_base(v_k, v_u, DATE '2026-03-01')
    || '{"marked_at": "2026-03-03T00:00:00Z"}'::jsonb);
  IF v_out IS NULL OR v_out NOT LIKE '23514|%api_key_nav_marks_label_chk%' THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (9): a read two UTC days after its label answered %, expected the label check', COALESCE(v_out, 'no error (the row was stored)');
  END IF;
  -- the label is read in UTC: 01:10+02:00 on 03-02 is 23:10Z on 03-01, so its
  -- label is 02-28, never 03-01
  v_out := pg_temp.nm_try(pg_temp.nm_base(v_k, v_u, DATE '2026-03-01')
    || '{"marked_at": "2026-03-02T01:10:00+02:00"}'::jsonb);
  IF v_out IS NULL OR v_out NOT LIKE '23514|%api_key_nav_marks_label_chk%' THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (9): an offset read labelled in the offset day answered %, expected the label check', COALESCE(v_out, 'no error (the row was stored)');
  END IF;
  -- accepted: late retry, 23:59:59Z the day after the label
  v_out := pg_temp.nm_try(pg_temp.nm_base(v_k, v_u, DATE '2026-03-01')
    || '{"marked_at": "2026-03-02T23:59:59Z"}'::jsonb);
  IF v_out IS NOT NULL THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (9): a late write at 23:59:59Z the day after its label answered %, expected it to be accepted (D-11)', v_out;
  END IF;
  -- accepted: the first instant of the day after the label
  v_out := pg_temp.nm_try(pg_temp.nm_base(v_k, v_u, DATE '2026-03-02')
    || '{"marked_at": "2026-03-03T00:00:00Z"}'::jsonb);
  IF v_out IS NOT NULL THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (9): a read at 00:00:00Z the day after its label answered %, expected it to be accepted', v_out;
  END IF;
  -- accepted: the offset literal labelled by its UTC reading
  v_out := pg_temp.nm_try(pg_temp.nm_base(v_k, v_u, DATE '2026-02-28')
    || '{"marked_at": "2026-03-02T01:10:00+02:00"}'::jsonb);
  RESET ROLE;
  IF v_out IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (9): an offset read labelled by its UTC day answered %, expected it to be accepted', v_out;
  END IF;

  -- ===== ARM 10 - value checks ==============================================
  -- Each refusal is a CHECK violation (23514) naming its own constraint, so one
  -- check cannot stand in for another. The three legitimate shapes go in first so
  -- the checks are shown not to be over-strict.
  -- RED-UNDER: drop the venue CHECK from 20261029120000. A venue outside the
  --            closed set is then stored, and every later reader that switches on
  --            the venue meets a value it has no branch for.
  -- RED-UNDER-M: {"arm":"10","apply":[{"kind":"edit","file":"supabase/migrations/20261029120000_api_key_nav_marks.sql","find":"  CONSTRAINT api_key_nav_marks_venue_chk\n    CHECK (venue IN ('okx', 'bybit', 'binance', 'deribit', 'mt5', 'sfox')),\n","replace":"","occurrences":1}]}
  v_u := pg_temp.nm_user();
  v_k := pg_temp.nm_key(v_u);
  SET LOCAL ROLE service_role;
  v_out := pg_temp.nm_try(pg_temp.nm_base(v_k, v_u, DATE '2026-03-01'));
  IF v_out IS NOT NULL THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (10): a valid USD-venue mark answered %, expected it to be accepted', v_out;
  END IF;
  v_out := pg_temp.nm_try(pg_temp.nm_base(v_k, v_u, DATE '2026-03-02')
    || '{"venue": "mt5", "native_unit": "BTC", "nav_native": 0.015, "open_pnl_native": 0.0005, "price_day": "2026-03-02"}'::jsonb);
  IF v_out IS NOT NULL THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (10): a valid BTC-unit mark with a price day answered %, expected it to be accepted', v_out;
  END IF;
  v_out := pg_temp.nm_try(pg_temp.nm_base(v_k, v_u, DATE '2026-03-03')
    || '{"venue": "deribit", "native_unit": null, "nav_native": null, "open_pnl_native": null, "native_detail": {"usd_basis": "venue_index_at_marked_at", "currencies": {"BTC": {"equity": 0.1, "open_pnl": -0.001}}}}'::jsonb);
  IF v_out IS NOT NULL THEN
    RESET ROLE;
    RAISE EXCEPTION 'TEST FAILED (10): a valid Deribit mark answered %, expected it to be accepted', v_out;
  END IF;

  FOR v_case IN
    SELECT * FROM (VALUES
      ('NaN nav_usd',               '{"nav_usd": "NaN"}',                                  'api_key_nav_marks_amounts_finite_chk'),
      ('NaN open_pnl_usd',          '{"open_pnl_usd": "NaN"}',                             'api_key_nav_marks_amounts_finite_chk'),
      ('Infinity nav_usd',          '{"nav_usd": "Infinity"}',                             'api_key_nav_marks_amounts_finite_chk'),
      ('-Infinity open_pnl_usd',    '{"open_pnl_usd": "-Infinity"}',                       'api_key_nav_marks_amounts_finite_chk'),
      ('NaN nav_native',            '{"nav_native": "NaN"}',                               'api_key_nav_marks_amounts_finite_chk'),
      ('Infinity open_pnl_native',  '{"open_pnl_native": "Infinity"}',                     'api_key_nav_marks_amounts_finite_chk'),
      ('venue outside the set',     '{"venue": "kraken"}',                                 'api_key_nav_marks_venue_chk'),
      ('native_detail an array',    '{"native_detail": []}',                               'api_key_nav_marks_native_detail_object_chk'),
      ('price_day without a unit',  '{"native_unit": null, "nav_native": null, "open_pnl_native": null, "native_detail": {}, "price_day": "2026-03-02"}', 'api_key_nav_marks_price_day_chk'),
      ('native scalars half NULL',  '{"open_pnl_native": null}',                           'api_key_nav_marks_native_scalars_chk'),
      ('native unit lower case',    '{"native_unit": "usd"}',                              'api_key_nav_marks_native_unit_chk'),
      ('no unit and no detail',     '{"native_unit": null, "nav_native": null, "open_pnl_native": null}', 'api_key_nav_marks_native_basis_chk')
    ) AS t(label, overrides, constraint_name)
  LOOP
    v_out := pg_temp.nm_try(pg_temp.nm_base(v_k, v_u, DATE '2026-03-10') || v_case.overrides::jsonb);
    IF v_out IS NULL OR v_out NOT LIKE ('23514|%"' || v_case.constraint_name || '"%') THEN
      RESET ROLE;
      RAISE EXCEPTION 'TEST FAILED (10): % answered %, expected a 23514 naming %', v_case.label, COALESCE(v_out, 'no error (the row was stored)'), v_case.constraint_name;
    END IF;
  END LOOP;
  RESET ROLE;
  SELECT count(*) INTO v_n FROM public.api_key_nav_marks WHERE api_key_id = v_k AND mark_day = DATE '2026-03-10';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (10): % refused row(s) were stored anyway', v_n;
  END IF;

  -- ===== ARM 11 - catalogue =================================================
  -- RED-UNDER: drop FORCE ROW LEVEL SECURITY from 20261029120000. Every role the
  --            other arms use is a non-owner or BYPASSRLS, so they all still pass;
  --            only the catalogue sees that the table owner is no longer bound by
  --            the policy.
  -- RED-UNDER-M: {"arm":"11","apply":[{"kind":"edit","file":"supabase/migrations/20261029120000_api_key_nav_marks.sql","find":"ALTER TABLE public.api_key_nav_marks FORCE ROW LEVEL SECURITY;\n","replace":"","occurrences":1}]}
  IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = v_oid AND c.relrowsecurity AND c.relforcerowsecurity) THEN
    RAISE EXCEPTION 'TEST FAILED (11): row level security is not both enabled and forced on api_key_nav_marks';
  END IF;

  SELECT count(*) INTO v_n FROM pg_policy p WHERE p.polrelid = v_oid;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (11): % policies exist on api_key_nav_marks, expected exactly the owner SELECT policy', v_n;
  END IF;
  SELECT p.polname, p.polcmd, p.polpermissive,
         (SELECT array_agg(r.rolname::text ORDER BY r.rolname) FROM pg_roles r WHERE r.oid = ANY (p.polroles)) AS roles,
         regexp_replace(pg_get_expr(p.polqual, p.polrelid), '\s', '', 'g') AS qual,
         p.polwithcheck IS NULL AS no_check
    INTO v_pol
    FROM pg_policy p WHERE p.polrelid = v_oid;
  IF v_pol.polname IS DISTINCT FROM 'api_key_nav_marks_owner_select'
     OR v_pol.polcmd IS DISTINCT FROM 'r'
     OR v_pol.roles IS DISTINCT FROM ARRAY['authenticated']::text[]
     OR v_pol.qual IS DISTINCT FROM '(allocator_id=auth.uid())'
     OR NOT v_pol.no_check THEN
    RAISE EXCEPTION 'TEST FAILED (11): the only policy is %, cmd %, roles %, qual %; expected api_key_nav_marks_owner_select, SELECT, {authenticated}, allocator_id = auth.uid()',
      v_pol.polname, v_pol.polcmd, v_pol.roles, v_pol.qual;
  END IF;

  FOR v_role IN SELECT unnest(ARRAY['anon', 'authenticated', 'service_role']) LOOP
    FOREACH v_priv IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
      v_want := (v_role = 'authenticated' AND v_priv = 'SELECT')
             OR (v_role = 'service_role' AND v_priv IN ('SELECT', 'INSERT'));
      v_got := has_table_privilege(v_role, 'public.api_key_nav_marks', v_priv);
      IF v_got IS DISTINCT FROM v_want THEN
        RAISE EXCEPTION 'TEST FAILED (11): % % on api_key_nav_marks is %, expected %', v_role, v_priv, v_got, v_want;
      END IF;
    END LOOP;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                  WHERE t.tgrelid = v_oid AND t.tgname = 'api_key_nav_marks_owner_coherence'
                    AND NOT t.tgisinternal AND t.tgenabled = 'O') THEN
    RAISE EXCEPTION 'TEST FAILED (11): the owner-coherence trigger is missing or not enabled';
  END IF;
  SELECT p.prosecdef, p.proconfig INTO v_secdef, v_cfg
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'enforce_api_key_nav_marks_owner_coherence';
  IF v_secdef IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST FAILED (11): enforce_api_key_nav_marks_owner_coherence is missing or not SECURITY DEFINER';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM unnest(COALESCE(v_cfg, ARRAY[]::text[])) c
                  WHERE regexp_replace(c, '\s', '', 'g') = 'search_path=public,pg_catalog') THEN
    RAISE EXCEPTION 'TEST FAILED (11): enforce_api_key_nav_marks_owner_coherence does not pin search_path to public, pg_catalog';
  END IF;

  RAISE NOTICE 'ALL 11 ARMS EXECUTED (1,2,3,4,5,6,7,8,9,10,11): reads are owner-only and anon reads nothing (1), the first writer of a day wins and the stored row is byte-identical (2), service_role cannot UPDATE (3) or DELETE and TRUNCATE (4), authenticated and anon cannot INSERT and the refusal is the privilege (5), deleting the key (6) and the account (7) erases the marks without a DELETE grant, a mark cannot name another owner (8), the label is the UTC day that just closed and a late write still lands (9), every value check names its own constraint and the legitimate shapes pass (10), RLS is forced, exactly the owner SELECT policy exists, the privilege matrix is exact and the trigger function is a hardened definer (11).';
END $$;

ROLLBACK;
